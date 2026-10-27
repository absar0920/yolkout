// Client physics / net tests (no browser needed).
//   node --import ./web/js/engine/test/register.mjs web/js/engine/test/physics.test.mjs
// Checks:
//   1. web/js/engine/physics.js (Predictor over the shared sim) against shared/testvectors/{movement,weapons}.json
//   2. shared/physics_vectors.json: wire quantisation, prediction from raw view angles, reconciliation, angle lerp
//   3. TickClock monotonic estimate and SnapshotBuffer interpolation
//   4. offline LocalServer + Connection protocol smoke test (welcome, snapshots, ack, events)
import { readFileSync } from "node:fs";
import * as Phys from "../physics.js";
import { TickClock } from "../../net/clock.js";
import { SnapshotBuffer } from "../../net/interp.js";
import { Connection } from "../../net/connection.js";
import { LocalServer } from "../../net/localserver.js";

const ROOT = new URL("../../../../", import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, ROOT), "utf8"));
const data = await Phys.loadData(async (p) => read(`shared/data/${p}`));
const C = data.C;
const TOL = 1e-9;
let fails = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { fails++; if (fails < 30) console.error("FAIL", msg); } }
const near = (a, b) => Math.abs(a - b) <= TOL;
const arrNear = (a, b) => a.length === b.length && a.every((v, i) => (typeof v === "number" ? near(v, b[i]) : v === b[i]));
const stateArr = (ps) => [ps.x, ps.y, ps.z, ps.vx, ps.vy, ps.vz, ps.onGround ? 1 : 0, ps.coy];

// 1a. movement vectors through the Predictor
{
  const v = read("shared/testvectors/movement.json");
  for (const c of v.cases) {
    const { world } = await data.map(c.map);
    const pr = new Phys.Predictor(world, C, data.defs(c.primary));
    pr.reset(c.start[0], c.start[1], c.start[2]);
    pr.ps.onGround = false; // vectors start from Sim.newPlayerState (fresh, airborne)
    c.inputs.forEach((inp, i) => {
      pr.step({ seq: i + 1, keys: inp[0], yaw: inp[1], pitch: inp[2], buttons: inp[3], slot: inp[4] });
      ok(arrNear(stateArr(pr.ps), c.expect[i]), `movement ${c.name} tick ${i}: ${stateArr(pr.ps)} vs ${c.expect[i]}`);
    });
  }
}
// 1b. weapon vectors
{
  const v = read("shared/testvectors/weapons.json");
  for (const c of v.cases) {
    const d = data.defs(c.primary, c.melee);
    const ws = Phys.newWeaponState(d.w[0], d.w[1], d.grenade);
    c.inputs.forEach(([b, s, mv], i) => {
      const acts = Phys.weaponTick(ws, b, s, d, C.dt, mv === 1)
        .map((a) => (a.a === "fire" ? ["fire", a.slot, a.spread, a.pellets] : a.a === "switch" ? ["switch", a.slot] : [a.a]));
      ok(arrNear(Phys.weaponStateToArray(ws), c.expect[i].ws), `weapons ${c.name} tick ${i}`);
      ok(JSON.stringify(acts) === JSON.stringify(c.expect[i].acts) || acts.every((a, j) => arrNear(a, c.expect[i].acts[j] || [])), `weapons acts ${c.name} tick ${i}`);
    });
  }
}
// 2. client vectors
{
  const v = read("shared/physics_vectors.json");
  for (const [raw, w] of v.quant.yaw) {
    const got = Phys.wireYaw(raw);
    ok(got === w, `wireYaw(${raw}) = ${got}, want ${w}`);
    ok(got > -Math.PI && got <= Math.PI, `wireYaw range ${got}`);
    ok(Math.round(got * 1e4) / 1e4 === got, `wireYaw q4 ${got}`);
  }
  for (const [raw, w] of v.quant.pitch) ok(Phys.wirePitch(raw) === w, `wirePitch(${raw})`);
  for (const [raw, w] of v.quant.norm) ok(near(Phys.normYaw(raw), w), `normYaw(${raw})`);
  for (const c of v.predict) {
    const { world } = await data.map(c.map);
    const pr = new Phys.Predictor(world, C, data.defs(c.primary, c.melee));
    pr.reset(...c.start);
    c.raw.forEach((x, i) => {
      const e = Phys.makeInputEntry(i + 1, x[0], x[1], x[2], x[3], x[4], 0, C.maxPitch);
      ok(JSON.stringify(e.slice(0, 6)) === JSON.stringify(c.wire[i]), `predict ${c.name} wire ${i}: ${e} vs ${c.wire[i]}`);
      const acts = pr.step(Phys.entryToInput(e));
      ok(arrNear(stateArr(pr.ps), c.expect[i]), `predict ${c.name} state ${i}`);
      const a = acts.map((q) => q.a === "fire" ? ["fire", q.slot, q.spread, q.pellets] : q.a === "switch" ? ["switch", q.slot] : [q.a]);
      ok(a.length === c.acts[i].length && a.every((q, j) => arrNear(q, c.acts[i][j])), `predict ${c.name} acts ${i}`);
    });
    ok(arrNear(Phys.weaponStateToArray(pr.ws), c.finalWs), `predict ${c.name} final ws`);
  }
  for (const c of v.reconcile) {
    ok(c.maxCorrection <= 1e-9, `reconcile ${c.name} correction ${c.maxCorrection}`);
    const { world } = await data.map(c.map);
    const defs = data.defs(c.primary);
    // Straight prediction must equal "reconcile at snapshot then replay" at each stored point.
    for (const s of c.snaps) {
      const pr = new Phys.Predictor(world, C, defs);
      pr.reset(...c.start);
      for (let i = 0; i < s.at; i++) pr.step(Phys.entryToInput(c.wire[i]));
      const straight = stateArr(pr.ps);
      pr.reconcile(s.me, s.a);
      ok(pr.pending.length === s.pending, `reconcile ${c.name} pending at ${s.at}`);
      ok(arrNear(stateArr(pr.ps), s.after) && arrNear(straight, s.after), `reconcile ${c.name} at ${s.at}`);
    }
  }
  for (const [a, b, t, w] of v.interp) ok(near(Phys.lerpAngle(a, b, t), w), `lerpAngle(${a},${b},${t})`);
}
// 2b. reconcile corrects a mispredicted state (server knockback) and keeps the prev/cur pair sane
{
  const { world, json } = await data.map("countertop");
  const sp = json.spawns[0];
  const pr = new Phys.Predictor(world, C, data.defs("benedict"));
  pr.reset(...sp.pos);
  for (let i = 1; i <= 10; i++) pr.step({ seq: i, keys: Phys.KEY.FWD, yaw: sp.yaw, pitch: 0, buttons: 0, slot: 0 });
  const me = { x: sp.pos[0], y: sp.pos[1] + 0.3, z: sp.pos[2], vx: 3, vy: 5, vz: 0, g: 0, ws: Phys.weaponStateToArray(pr.ws) };
  const d = pr.reconcile(me, 4);
  ok(pr.pending.length === 6, "reconcile drops acked inputs");
  ok(Math.hypot(...d) > 0.1, "reconcile reports correction");
  ok(pr.prev && Math.hypot(pr.ps.x - pr.prev.x, pr.ps.z - pr.prev.z) < 0.5, "prev is one tick behind");
}
// 3. clock + interpolation
{
  const ck = new TickClock(60, 100);
  ck.sample(1000, 0);
  ok(near(ck.est(0), 1000), "clock first sample");
  ok(near(ck.renderTick(0), 994), "render tick = est - 6");
  ck.sample(1002, 50); // arrives late -> estimate nudged, never backwards
  const e1 = ck.est(50);
  ck.sample(1001, 51);
  ok(ck.est(51) >= e1, "clock monotonic");
  const sb = new SnapshotBuffer(6);
  sb.push({ k: 10, p: [[2, 0, 0, 0, 3.0, 0, 100, 0, 3, 0]], pr: [[5, 0, 2, 0, 1, 0, 0, 0, 0]] });
  sb.push({ k: 12, p: [[2, 1, 0, 2, -3.0, 0.2, 90, 0, 3, 0]], pr: [[5, 0, 2, 1, 1, 0, 0, 0, 0]] });
  let got = null;
  sb.samplePlayers(11, (id, x, y, z, yaw, pitch) => { got = [id, x, y, z, yaw, pitch]; });
  ok(got && near(got[1], 0.5) && near(got[3], 1) && near(got[5], 0.1), `interp position ${got}`);
  ok(got && Math.abs(Math.abs(got[4]) - Math.PI) < 0.01, `interp yaw shortest arc ${got && got[4]}`);
  sb.samplePlayers(30, (id, x) => { got = x; });
  ok(near(got, 1 + 0.5 * 6), `extrapolation capped at 6 ticks: ${got}`);
  sb.push({ k: 14, p: [[2, 20, 0, 2, 0, 0, 100, 0, 3, 0]], pr: [] });
  sb.samplePlayers(13, (id, x) => { got = x; });
  ok(near(got, 1), `teleport is not lerped: ${got}`);
  let pcount = 0;
  sb.sampleProjectiles(13, () => pcount++);
  ok(pcount === 0, "exploded projectile hidden");
}
// 4. offline server protocol smoke test
{
  const ls = new LocalServer(data, { mode: "teams", bots: 5, difficulty: 0.9 });
  await ls.init();
  const conn = new Connection({ socketFactory: () => ls.socket() });
  const seen = {};
  let lastSnap = null, snaps = 0;
  conn.onAny = (m) => { seen[m.t] = (seen[m.t] || 0) + 1; if (m.t === "s") { lastSnap = m; snaps++; } };
  const w = await conn.connect({ name: "Tester!!", cls: "deviler", mel: "pan", cos: { hat: "chef" }, mode: "teams", map: "", room: "", create: 0 });
  ok(w.t === "welcome" && w.id > 0 && w.room.code === "LOCAL", "welcome");
  ok(w.players.find((p) => p.id === w.id).n === "Tester", "name sanitised");
  ok(w.players.find((p) => p.id === w.id).mel === "pan", "roster mel from hello");
  ok(w.players.every((p) => data.weapons.melees.includes(p.mel)), "every roster entry has a valid mel");
  const pus = [];
  conn.on("pu", (m) => pus.push(m));
  conn.send({ t: "ld", mel: "whisk" });
  // drive 60 Hz inputs for ~3 s
  let seq = 0;
  const t0 = performance.now();
  await new Promise((res) => {
    const iv = setInterval(() => {
      const b = [];
      for (let i = 0; i < 2; i++) { seq++; b.push(Phys.makeInputEntry(seq, Phys.KEY.FWD, 0.5, 0, seq % 20 < 2 ? 1 : 0, 0, ls.k - 6)); }
      conn.send({ t: "i", b });
      if (performance.now() - t0 > 3000) { clearInterval(iv); res(); }
    }, 33);
  });
  conn.close();
  ok(seen.spawn >= 6, `spawns ${seen.spawn}`);
  ok(seen.join === 5, `joins ${seen.join}`);
  ok(snaps > 70, `snapshots ${snaps} in 3 s`);
  ok(lastSnap && lastSnap.a > 100 && lastSnap.a <= seq, `ack ${lastSnap && lastSnap.a} / seq ${seq}`);
  ok(lastSnap && lastSnap.p.length === 6 && Array.isArray(lastSnap.me.ws) && lastSnap.me.ws.length === 15 && Number.isInteger(lastSnap.me.cy), "snapshot shape");
  ok(pus.some((m) => m.p.id === w.id && m.p.mel === "whisk"), "ld mel -> pu");
  ok(ls.human.mel === "whisk" && ls.human.spawnMel === "pan", "ld mel applies at the next spawn only");
  ok(seen.sb >= 2, "scoreboard");
  console.log("offline smoke:", JSON.stringify(seen));
}

// 4b. practice only fetches the selected map at startup and waits for a later map to load.
{
  const requested = [];
  let releaseNext;
  const nextReady = new Promise((resolve) => { releaseNext = resolve; });
  const practiceData = {
    ...data,
    modes: { ...data.modes, modes: { ...data.modes.modes,
      ffa: { ...data.modes.modes.ffa, maps: ["barnyard", "countertop"] } } },
    async map(id) {
      requested.push(id);
      if (id === "countertop") await nextReady;
      return data.map(id);
    },
  };
  const ls = new LocalServer(practiceData, { mode: "ffa", map: "barnyard", bots: 0 });
  await ls.init();
  ok(JSON.stringify(requested) === JSON.stringify(["barnyard"]), "practice startup fetches only the selected map");
  ls._hello({ name: "Tester", cls: "benedict", mel: "pan", cos: {} });
  ls.stop(); // drive intermission ticks by hand
  ls._end();
  ok(JSON.stringify(requested) === JSON.stringify(["barnyard", "countertop"]), "practice prefetches the next map at intermission");
  ls.nextStartK = ls.k;
  ls._tick();
  ok(ls.state === "ended" && ls.mapId === "barnyard", "practice waits for the next map before starting");
  releaseNext();
  await new Promise((resolve) => setTimeout(resolve, 0));
  ls._tick();
  ok(ls.state === "live" && ls.mapId === "countertop" && ls.world === ls.maps.countertop.world,
    "practice switches map and collision world after loading");
}

// 5. localserver combat: hit zones on the wire, melee windup + knockback, bogus mel, straight rocket
{
  const ls = new LocalServer(data, { mode: "ffa", bots: 0 });
  await ls.init();
  const conn = new Connection({ socketFactory: () => ls.socket() });
  const evs = [];
  conn.onAny = (m) => evs.push(m);
  const w = await conn.connect({ name: "Z", cls: "benedict", mel: "bogus", mode: "ffa", map: "", room: "", create: 0 });
  ok(w.players.find((p) => p.id === w.id).mel === data.weapons.defaultMelee, "bogus mel -> defaultMelee");
  ls.stop(); // drive ticks by hand
  // a flat open arena so nothing blocks the test shots
  ls.world = Phys.makeWorld({ boxes: [{ min: [-40, -1, -40], max: [40, 0, 40] }], bounds: { min: [-40, -10, -40], max: [40, 30, 40] } });
  const H = ls.human;
  const V = ls._addPlayer("Dummy", "benedict", "pan", { hat: "none", color: "classic", stamp: "none" }, null);
  ls._spawn(V);
  const place = (P, x, y, z) => { P.ps = Phys.newPlayerState(x, y, z); P.ps.onGround = true; P.protEnd = 0; };
  const run = (inp) => { H.queue.push(inp); ls._tick(); };
  let seq = 1000;
  const shoot = (pitch, buttons = Phys.BTN.FIRE | Phys.BTN.AIM) => { run({ seq: ++seq, keys: 0, yaw: 0, pitch, buttons, slot: 0, rt: ls.k }); run({ seq: ++seq, keys: 0, yaw: 0, pitch, buttons: 0, slot: 0, rt: ls.k }); };
  const hitsFor = () => evs.filter((m) => m.t === "hit" && m.v === V.id);
  const settle = () => new Promise((r) => setTimeout(r, 0)); // frames are delivered in a microtask
  // head, body, leg from 10 u away (benedict 25 dmg, zones 2.0/1.0/0.9)
  const cases = [[1.25, 1, 50], [0.75, 2, 25], [0.15, 4, 23]];
  for (const [hy, zone, dmg] of cases) {
    place(H, 0, 0, 10); place(V, 0, 0, 0); V.hp = 100; V.sh = 0; H.ws = Phys.newWeaponState(H.defs.w[0], H.defs.w[1], H.defs.grenade);
    for (let i = 0; i < 20; i++) ls._tick();
    evs.length = 0;
    shoot(Math.atan2(hy - C.eyeHeight, 10 - 0.42));
    await settle();
    const h = hitsFor()[0];
    ok(h && h.z === zone && h.d === dmg && h.hs === (zone === 1 ? 1 : 0), `localserver zone ${zone}: ${JSON.stringify(h)}`);
  }
  // melee: pan windup 0.18 s -> the hit lands 11 ticks after the press, then knockback
  place(H, 0, 0, 1.6); place(V, 0, 0, 0); V.hp = 100;
  H.defs = data.defs("benedict", "pan"); H.spawnMel = "pan"; H.ws = Phys.newWeaponState(H.defs.w[0], H.defs.w[1], H.defs.grenade);
  for (let i = 0; i < 20; i++) ls._tick();
  evs.length = 0;
  run({ seq: ++seq, keys: 0, yaw: 0, pitch: -0.45, buttons: Phys.BTN.MELEE, slot: 0, rt: ls.k });
  let at = -1, kv = null;
  for (let i = 1; i < 20 && at < 0; i++) {
    run({ seq: ++seq, keys: 0, yaw: 0, pitch: -0.45, buttons: 0, slot: 0, rt: ls.k });
    if (V.hp < 100) { at = i; kv = [V.ps.vx, V.ps.vy, V.ps.vz]; }
  }
  await settle();
  const mh = hitsFor()[0];
  ok(evs.some((m) => m.t === "melee") === false, "own melee is not echoed to the attacker");
  ok(at === 11 && mh && mh.w === "pan" && mh.d === 60 && mh.z === 2, `pan hit after the windup: tick ${at} ${JSON.stringify(mh)}`);
  // (the victim then takes its own starved movement tick in the same server tick: gravity only)
  ok(kv && Math.abs(kv[2] + 6) < 1e-9 && Math.abs(kv[1] - (6 * data.rules.combat.meleeKnockUp - C.gravity * C.dt)) < 1e-9, `pan knockback ${kv}`);
  // straight rocket: gravity 0, fired level from (0,5,0) toward -Z
  const pd = data.weapons.weapons.souffle.projectile;
  const { world } = await data.map("barnyard");
  const pr = Phys.newProjectile(1, 1, pd, 0, 5, 0, 0, 0, -pd.speed);
  let straight = true, n = 0;
  for (; n < 400; n++) { const r = Phys.stepProjectile(world, pr, C.dt); if (Math.abs(pr.y - 5) >= 1e-9 || (r && Math.abs(r.y - 5) >= 1e-9)) straight = false; if (r) break; }
  ok(pd.gravity === 0 && straight && n > 1, `rocket flies straight (${n} ticks)`);
  conn.close();
}

console.log(`${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
