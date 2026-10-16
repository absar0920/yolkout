// Headless prediction/reconciliation check against a running server.
//   node --import ./web/js/engine/test/register.mjs web/js/engine/test/netcheck.mjs ws://localhost:8080/ws [seconds]
// Drives a 60 Hz client with the real Predictor + Connection, moves/jumps/fires at random and
// reports the reconciliation error distribution (should be ~0 except after knockback/death).
import { readFileSync } from "node:fs";
import * as Phys from "../physics.js";
import { Connection } from "../../net/connection.js";
import { TickClock } from "../../net/clock.js";

const url = process.argv[2] || "ws://localhost:8080/ws";
const secs = +(process.argv[3] || 10);
const ROOT = new URL("../../../../", import.meta.url);
const data = await Phys.loadData(async (p) => JSON.parse(readFileSync(new URL(`shared/data/${p}`, ROOT), "utf8")));
const C = data.C;
const conn = new Connection({ url });
const clock = new TickClock(60, 100);
let pred = null, alive = false, seq = 0, myId = 0, world = null;
const errs = [];
let deaths = 0, snaps = 0, hits = 0;
conn.onAny = (m) => {
  if (m.t === "s") {
    snaps++;
    clock.sample(m.k, performance.now());
    if (m.me && m.me.al && pred) {
      if (!alive) { alive = true; pred.pending.length = 0; }
      const d = pred.reconcile(m.me, m.a);
      errs.push(Math.hypot(...d));
    } else if (m.me && !m.me.al) alive = false;
  } else if (m.t === "spawn" && m.id === myId) {
    pred.reset(m.x, m.y, m.z, data.defs(m.cls, m.mel)); alive = true;
  } else if (m.t === "kill" && m.v === myId) { deaths++; alive = false; }
  else if (m.t === "hit" && m.a === myId) hits++;
};
const w = await conn.connect({ name: "NetCheck", cls: "poacher", cos: {}, mode: "ffa", map: "", room: "", create: 0 });
myId = w.id;
world = (await data.map(w.room.map)).world;
clock.sample(w.k, performance.now());
pred = new Phys.Predictor(world, C, data.defs("poacher"));
let yaw = 0, keys = Phys.KEY.FWD, unsent = [];
const t0 = performance.now();
let next = t0;
await new Promise((res) => {
  const loop = () => {
    const now = performance.now();
    while (next <= now) {
      next += 1000 / 60;
      seq++;
      if (Math.random() < 0.03) keys = [1, 5, 9, 2, 4, 8, 17, 1][Math.floor(Math.random() * 8)];
      yaw += (Math.random() - 0.5) * 0.1;
      const buttons = (Math.random() < 0.3 ? 1 : 0) | (Math.random() < 0.02 ? 16 : 0); // fire + occasional melee (windup state mw)
      const e = Phys.makeInputEntry(seq, keys, yaw, 0, buttons, 0, clock.renderTick(now));
      unsent.push(e);
      if (pred && alive) pred.step(Phys.entryToInput(e));
    }
    if (unsent.length >= 2) { conn.sendInputs(unsent); unsent = []; }
    if (now - t0 > secs * 1000) return res();
    setTimeout(loop, 4);
  };
  loop();
});
conn.close();
errs.sort((a, b) => a - b);
const pct = (p) => errs.length ? errs[Math.min(errs.length - 1, Math.floor(errs.length * p))] : 0;
const nonzero = errs.filter((e) => e > 1e-6).length;
console.log(`room ${w.room.code} map ${w.room.map}: snaps ${snaps}, reconciles ${errs.length}, corrections>1e-6: ${nonzero}, p50 ${pct(0.5).toExponential(2)} p99 ${pct(0.99).toExponential(2)} max ${pct(1).toExponential(2)}; hits ${hits} deaths ${deaths}`);
process.exit(0);
