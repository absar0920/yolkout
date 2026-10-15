// Generate shared/testvectors/*.json from the canonical JS sim (shared/ref/sim.mjs).
// The Go port (server/sim) must reproduce these within 1e-9 (positions) / exactly (ints).
// Usage: node scripts/gen-testvectors.mjs        Verify: node scripts/gen-testvectors.mjs --check
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as S from "../shared/ref/sim.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const J = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));
const rules = J("shared/data/rules.json"), weapons = J("shared/data/weapons.json");
const C = S.makeConsts(rules);
const { FWD, BACK, LEFT, RIGHT, JUMP } = S.KEY;
const { FIRE, AIM, RELOAD, GRENADE, MELEE } = S.BTN;
const PI = Math.PI;

// ---------------------------------------------------------------- movement
const seg = (n, keys, yaw, pitch = 0, buttons = 0, slot = 0) => Array.from({ length: n }, () => [keys, yaw, pitch, buttons, slot]);
const moveCases = [
  { name: "idle_settle", map: "barnyard", start: [10, 0.4, 10], inputs: seg(40, 0, 0) },
  { name: "walk_into_coop_back_wall", map: "barnyard", start: [-3.5, 0, -26.5], inputs: seg(90, FWD, 0) },
  { name: "jump_in_place", map: "barnyard", start: [10, 0, 10], inputs: [...seg(1, 0, 0), ...seg(1, JUMP, 0), ...seg(60, 0, 0)] },
  { name: "strafe_diagonal_then_stop", map: "barnyard", start: [10, 0, 10], inputs: [...seg(60, FWD | RIGHT, 0.7), ...seg(40, 0, 0.7)] },
  { name: "bunny_hop_backwards", map: "barnyard", start: [12, 0, 12], inputs: seg(120, BACK | LEFT | JUMP, -1.2) },
  { name: "climb_loft_stairs", map: "barnyard", start: [0.5, 0, 1.85], inputs: [...seg(56, FWD, PI / 2), ...seg(60, FWD, 0)] },
  { name: "walk_off_coop_roof", map: "barnyard", start: [0, 4, -27], inputs: seg(120, FWD, PI) },
  { name: "jump_onto_centre_hay", map: "barnyard", start: [0, 0, 3], inputs: [...seg(8, FWD, 0), ...seg(1, FWD | JUMP, 0), ...seg(60, FWD, 0)] },
  { name: "pancake_tower_climb", map: "countertop", start: [-20, 0, 15.5], inputs: seg(160, FWD, 0) },
  { name: "sink_drop_and_exit", map: "countertop", start: [-8, 0, -3.2], inputs: [...seg(70, FWD, -PI / 2), ...seg(120, FWD, PI / 2)] },
  { name: "ads_slow_walk", map: "diner", start: [-20, 0, 0], inputs: seg(60, FWD, -PI / 2, 0, AIM) },
  { name: "trailer_pallet_jumps", map: "diner", start: [6.5, 0, 14.5], inputs: [...seg(10, FWD, PI / 2), ...seg(1, FWD | JUMP, PI / 2), ...seg(30, FWD, PI / 2), ...seg(1, FWD | JUMP, PI / 2), ...seg(30, FWD, PI / 2), ...seg(1, FWD | JUMP, PI / 2), ...seg(40, FWD, PI / 2)] },
];
const worlds = {};
const worldFor = (id) => (worlds[id] ??= S.makeWorld(J(`shared/data/maps/${id}.json`)));
const defs = S.defsFor(weapons, "benedict");
const state = (p) => [p.x, p.y, p.z, p.vx, p.vy, p.vz, p.onGround ? 1 : 0];
const movement = moveCases.map((c) => {
  const w = worldFor(c.map);
  const ps = S.newPlayerState(...c.start);
  const ws = S.newWeaponState(defs.w[0], defs.w[1], defs.grenade);
  const expect = c.inputs.map(([keys, yaw, pitch, buttons, slot], i) => {
    S.simulateInput(w, C, defs, ps, ws, { seq: i + 1, keys, yaw, pitch, buttons, slot });
    return state(ps);
  });
  return { ...c, primary: "benedict", expect };
});

// ---------------------------------------------------------------- weapons
const wseg = (n, buttons, slot = 0, moving = 0) => Array.from({ length: n }, () => [buttons, slot, moving]);
const weaponCases = [
  { name: "benedict_hold_fire_to_empty_and_autoreload", primary: "benedict", inputs: [...wseg(220, FIRE), ...wseg(20, 0)] },
  { name: "benedict_moving_ads_taps", primary: "benedict", inputs: [...wseg(3, FIRE | AIM, 0, 1), ...wseg(10, AIM, 0, 1), ...wseg(3, FIRE | AIM, 0, 1), ...wseg(5, 0)] },
  { name: "switch_to_pistol_and_tap", primary: "deviler", inputs: [...wseg(2, FIRE), ...wseg(5, 0, 1), ...wseg(20, 0, 1), ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].flatMap(() => [...wseg(6, FIRE, 1), ...wseg(6, 0, 1)])] },
  { name: "frittata_bursts", primary: "frittata", inputs: [...wseg(2, FIRE), ...wseg(30, 0), ...wseg(60, FIRE)] },
  { name: "manual_reload_then_melee_cancel", primary: "poacher", inputs: [...wseg(10, FIRE), ...wseg(1, RELOAD), ...wseg(30, 0), ...wseg(1, MELEE), ...wseg(60, 0), ...wseg(1, RELOAD), ...wseg(120, 0)] },
  { name: "grenades_and_cooldown", primary: "piercer", inputs: [...wseg(1, GRENADE), ...wseg(1, 0), ...wseg(1, GRENADE), ...wseg(60, 0), ...wseg(1, GRENADE), ...wseg(1, 0), ...wseg(1, GRENADE), ...wseg(5, FIRE | AIM), ...wseg(100, 0), ...wseg(3, FIRE)] },
  { name: "switch_spam_cancels_reload", primary: "overeasy", inputs: [...wseg(1, FIRE), ...wseg(1, RELOAD), ...wseg(10, 0, 1), ...wseg(10, 0, 0), ...wseg(140, 0, 0), ...wseg(1, FIRE)] },
];
const weaponVec = weaponCases.map((c) => {
  const d = S.defsFor(weapons, c.primary);
  const ws = S.newWeaponState(d.w[0], d.w[1], d.grenade);
  const expect = c.inputs.map(([buttons, slot, moving]) => {
    const acts = S.weaponTick(ws, buttons, slot, d, C.dt, moving === 1);
    return { ws: S.weaponStateToArray(ws), acts: acts.map((a) => (a.a === "fire" ? ["fire", a.slot, a.spread, a.pellets] : a.a === "switch" ? ["switch", a.slot] : [a.a])) };
  });
  return { ...c, expect };
});

// ---------------------------------------------------------------- rng / aim / rays
const rngSeeds = [0, 1, 42, 0xdeadbeef, 4294967295];
const rng = rngSeeds.map((s) => { const r = S.mulberry32(s); return { seed: s, out: [r(), r(), r(), r()] }; });
const seeds = [[1, 1, 0], [7, 1234, 0], [7, 1234, 9], [12, 4294967295, 3], [65535, 99999, 1]].map(([pid, seq, pel]) => ({ pid, seq, pellet: pel, seed: S.shotSeed(pid, seq, pel) }));
const dirs = [[3, 500, 0.3, -0.1, 0.1, 10], [9, 77, -2.5, 0.8, 0.035, 1], [1, 1, 0, 0, 0, 1], [5, 31337, 3.1, -1.4, 0.12, 3]]
  .map(([pid, seq, yaw, pitch, spread, pellets]) => ({ pid, seq, yaw, pitch, spread, pellets, dirs: S.shotDirs(pid, seq, yaw, pitch, spread, pellets) }));
const egg = [
  [0, 1.3, 0, 0, 0, -1, 0, 0, -10, 100, 0],
  [0, 1.3, 0, 0, 0, -1, 0.3, 0, -10, 100, 0],
  [0, 1.3, 0, 0, 0, -1, 0.5, 0, -10, 100, 0],
  [0, 1.3, 0, 0, 0, -1, 0.5, 0, -10, 100, 0.3],
  [2, 3, 2, -0.5773502691896258, -0.5773502691896258, -0.5773502691896258, 0, 0, 0, 100, 0],
  [0, 1.3, 0, 0, 0, 1, 0, 0, -10, 100, 0],
].map(([ox, oy, oz, dx, dy, dz, px, py, pz, tmax, inflate]) => {
  const t = S.rayEgg(C, ox, oy, oz, dx, dy, dz, px, py, pz, tmax, inflate);
  return { o: [ox, oy, oz], d: [dx, dy, dz], p: [px, py, pz], tmax, inflate, t, head: t >= 0 ? (oy + dy * t >= py + C.headshotY ? 1 : 0) : 0 };
});
const bw = worldFor("barnyard");
const casts = [[0, 1.3, -20, 0, 0, 1, 100], [0, 1.3, 20, 0, -0.2, -0.98, 100], [-20, 5, 0, 1, 0, 0, 200], [30, 1, 30, 0, 1, 0, 50]]
  .map(([ox, oy, oz, dx, dy, dz, tmax]) => { const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l; return { map: "barnyard", o: [ox, oy, oz], d: [dx, dy, dz], tmax, t: S.raycastWorld(bw, ox, oy, oz, dx, dy, dz, tmax) }; });
const falloff = ["benedict", "deviler", "piercer", "coddler"].flatMap((id) => [0, 5, 18, 30, 45, 100].map((d) => ({ weapon: id, d, dmg: S.falloffDamage(weapons.weapons[id], d) })));

const files = {
  "movement.json": { note: "state = [x,y,z,vx,vy,vz,onGround] after each input; input = [keys,yaw,pitch,buttons,slot]; seq = index+1; weapons from 'primary'", dt: C.dt, cases: movement },
  "weapons.json": { note: "input = [buttons, slot, moving]; expect[i].ws = weapon state array after tick i; acts = actions emitted", dt: C.dt, cases: weaponVec },
  "math.json": { rng, seeds, dirs, egg, casts, falloff },
};
const outDir = join(root, "shared/testvectors");
mkdirSync(outDir, { recursive: true });
const check = process.argv.includes("--check");
let bad = 0;
for (const [f, v] of Object.entries(files)) {
  const txt = JSON.stringify(v) + "\n";
  if (check) { if (readFileSync(join(outDir, f), "utf8") !== txt) { console.log(`MISMATCH ${f}`); bad++; } else console.log(`ok ${f}`); }
  else { writeFileSync(join(outDir, f), txt); console.log(`wrote ${f} (${txt.length} bytes)`); }
}
process.exit(bad ? 1 : 0);
