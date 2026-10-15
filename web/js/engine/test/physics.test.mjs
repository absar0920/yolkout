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
const stateArr = (ps) => [ps.x, ps.y, ps.z, ps.vx, ps.vy, ps.vz, ps.onGround ? 1 : 0];

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
    const d = data.defs(c.primary);
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
    const pr = new Phys.Predictor(world, C, data.defs(c.primary));
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
  const w = await conn.connect({ name: "Tester!!", cls: "deviler", cos: { hat: "chef" }, mode: "teams", map: "", room: "", create: 0 });
  ok(w.t === "welcome" && w.id > 0 && w.room.code === "LOCAL", "welcome");
  ok(w.players.find((p) => p.id === w.id).n === "Tester", "name sanitised");
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
  ok(lastSnap && lastSnap.p.length === 6 && Array.isArray(lastSnap.me.ws) && lastSnap.me.ws.length === 14, "snapshot shape");
  ok(seen.sb >= 2, "scoreboard");
  console.log("offline smoke:", JSON.stringify(seen));
}

console.log(`${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
