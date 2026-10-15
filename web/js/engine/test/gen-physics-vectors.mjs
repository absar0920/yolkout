// Generates shared/physics_vectors.json: client-side prediction vectors on top of the
// shared sim (wire quantisation, prediction from raw view angles, reconciliation replay,
// angle interpolation). Run:
//   node --import ./web/js/engine/test/register.mjs web/js/engine/test/gen-physics-vectors.mjs [--check]
import { readFileSync, writeFileSync } from "node:fs";
import * as Phys from "../physics.js";

const ROOT = new URL("../../../../", import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, ROOT), "utf8"));
const data = await Phys.loadData(async (p) => read(`shared/data/${p}`));
const C = data.C;

function rng(seed) { const r = Phys.mulberry32(seed); return () => r(); }

// ---- quantisation
const r0 = rng(42);
const quant = { yaw: [], pitch: [], norm: [] };
const yawSamples = [0, Math.PI, -Math.PI, 3.14159, 3.14155, -3.14155, 2 * Math.PI, -2 * Math.PI + 0.1, 7.5, -7.5, 1e-9, -1e-9, 0.00005, -0.00005, 1.23456789];
for (let i = 0; i < 25; i++) yawSamples.push((r0() - 0.5) * 20);
for (const y of yawSamples) quant.yaw.push([y, Phys.wireYaw(y)]);
for (const p of [0, 1.5, -1.5, 1.50004, 2, -2, 0.123456, -0.00004, 0.99995]) quant.pitch.push([p, Phys.wirePitch(p)]);
for (const y of [0, 4, -4, Math.PI, -Math.PI, 10, -10, 3 * Math.PI]) quant.norm.push([y, Phys.normYaw(y)]);

// ---- prediction scenarios from raw view angles
const K = Phys.KEY, B = Phys.BTN;
function script(seed, n) {
  const r = rng(seed);
  const out = [];
  let yaw = (r() - 0.5) * 6, pitch = 0, keys = K.FWD, buttons = 0, slot = 0;
  for (let i = 0; i < n; i++) {
    if (r() < 0.06) keys = [K.FWD, K.FWD | K.LEFT, K.FWD | K.RIGHT, K.BACK, K.LEFT, K.RIGHT, K.FWD | K.JUMP, 0][Math.floor(r() * 8)];
    if (r() < 0.03) keys |= K.JUMP; else if (r() < 0.2) keys &= ~K.JUMP;
    yaw += (r() - 0.5) * 0.09; pitch = Math.max(-1.6, Math.min(1.6, pitch + (r() - 0.5) * 0.05));
    buttons = 0;
    if (r() < 0.35) buttons |= B.FIRE;
    if (r() < 0.2) buttons |= B.AIM;
    if (r() < 0.01) buttons |= B.RELOAD;
    if (r() < 0.005) buttons |= B.GRENADE;
    if (r() < 0.005) buttons |= B.MELEE;
    if (r() < 0.01) slot = 1 - slot;
    out.push([keys, yaw, pitch, buttons, slot]);
  }
  return out;
}
const cases = [];
const maps = ["barnyard", "countertop", "hatchery", "diner"];
const classes = data.weapons.primaries;
let ci = 0;
for (const id of maps) {
  const { json, world } = await data.map(id);
  for (const si of [0, 7]) {
    const sp = json.spawns[si % json.spawns.length];
    const cls = classes[ci++ % classes.length];
    const raw = script(1000 + ci, 150);
    const pr = new Phys.Predictor(world, C, data.defs(cls));
    pr.reset(sp.pos[0], sp.pos[1], sp.pos[2]);
    const wire = [], expect = [], acts = [];
    raw.forEach((x, i) => {
      const e = Phys.makeInputEntry(i + 1, x[0], x[1], x[2], x[3], x[4], 0, C.maxPitch);
      wire.push(e.slice(0, 6));
      const a = pr.step(Phys.entryToInput(e));
      const ps = pr.ps;
      expect.push([ps.x, ps.y, ps.z, ps.vx, ps.vy, ps.vz, ps.onGround ? 1 : 0]);
      acts.push(a.map((q) => q.a === "fire" ? ["fire", q.slot, q.spread, q.pellets] : q.a === "switch" ? ["switch", q.slot] : [q.a]));
    });
    cases.push({ name: `${id}_spawn${si}_${cls}`, map: id, primary: cls, start: sp.pos, raw, wire, expect, acts,
      finalWs: Phys.weaponStateToArray(pr.ws) });
  }
}

// ---- reconciliation: server runs the same inputs; client gets snapshots acking with lag
const recon = [];
for (const [id, lag] of [["barnyard", 6], ["hatchery", 11], ["diner", 3]]) {
  const { json, world } = await data.map(id);
  const sp = json.spawns[2];
  const raw = script(77 + lag, 180);
  const defs = data.defs("poacher");
  const srv = { ps: Phys.newPlayerState(...sp.pos), ws: Phys.newWeaponState(defs.w[0], defs.w[1], defs.grenade) };
  srv.ps.onGround = true;
  const cl = new Phys.Predictor(world, C, defs);
  cl.reset(...sp.pos);
  const entries = raw.map((x, i) => Phys.makeInputEntry(i + 1, x[0], x[1], x[2], x[3], x[4], 0));
  const snaps = [];
  let maxErr = 0;
  for (let i = 0; i < entries.length; i++) {
    cl.step(Phys.entryToInput(entries[i]));
    const si = i - lag; // the server has applied inputs up to si
    if (si >= 0) {
      Phys.simulateInput(world, C, defs, srv.ps, srv.ws, Phys.entryToInput(entries[si]));
      if (si % 2 === 1) {
        const me = { x: srv.ps.x, y: srv.ps.y, z: srv.ps.z, vx: srv.ps.vx, vy: srv.ps.vy, vz: srv.ps.vz, g: srv.ps.onGround ? 1 : 0, ws: Phys.weaponStateToArray(srv.ws) };
        const d = cl.reconcile(me, si + 1);
        const e = Math.hypot(...d);
        if (e > maxErr) maxErr = e;
        snaps.push({ at: i + 1, a: si + 1, me, pending: cl.pending.length, after: [cl.ps.x, cl.ps.y, cl.ps.z, cl.ps.vx, cl.ps.vy, cl.ps.vz, cl.ps.onGround ? 1 : 0] });
      }
    }
  }
  recon.push({ name: `${id}_lag${lag}`, map: id, primary: "poacher", start: sp.pos, wire: entries.map((e) => e.slice(0, 6)), snaps: snaps.filter((_, k) => k % 6 === 0), maxCorrection: maxErr });
}

// ---- angle interpolation
const interp = [];
for (const [a, b, t] of [[3, -3, 0.5], [-3, 3, 0.5], [0.1, -0.1, 0.25], [1, 2, 0.75], [-3.1, 3.1, 0.1], [2.9, -2.9, 1]]) interp.push([a, b, t, Phys.lerpAngle(a, b, t)]);

const out = {
  note: "Client prediction vectors (generated by web/js/engine/test/gen-physics-vectors.mjs from shared/ref/sim.mjs + web/js/engine/physics.js). " +
    "quant.yaw/pitch: [raw, wire] after normalise+q4 (yaw kept inside (-PI,PI]). predict: raw = [keys,yawRaw,pitchRaw,buttons,slot]; wire = [seq,keys,yaw,pitch,buttons,slot] as sent; " +
    "expect[i] = [x,y,z,vx,vy,vz,onGround] after simulateInput of wire[i]; acts[i] = weapon actions; finalWs = ws array at the end. " +
    "reconcile: the server applies wire inputs `lag` ticks late and snapshots every 2 ticks; snaps[].after is the client state after reconcile+replay (must equal straight prediction, maxCorrection ~0). interp: [a,b,t,lerpAngle].",
  dt: C.dt, quant, predict: cases, reconcile: recon, interp,
};
const json = JSON.stringify(out);
const path = new URL("shared/physics_vectors.json", ROOT);
if (process.argv.includes("--check")) {
  const cur = readFileSync(path, "utf8");
  if (cur.trim() !== json) { console.error("physics_vectors.json is stale: regenerate"); process.exit(1); }
  console.log("physics_vectors.json up to date");
} else {
  writeFileSync(path, json + "\n");
  console.log(`wrote ${path.pathname} (${(json.length / 1024).toFixed(0)} KB, ${cases.length} predict cases, ${recon.length} reconcile cases)`);
}
