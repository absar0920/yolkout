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
const state = (p) => [p.x, p.y, p.z, p.vx, p.vy, p.vz, p.onGround ? 1 : 0, p.coy];

// Coyote time: walk off the coop roof and press jump `late` ticks after the first airborne tick.
function coyoteCase(name, late, wantJump) {
  const w = worldFor("barnyard"), start = [0, 4, -27], yaw = PI;
  const ps = S.newPlayerState(...start), ws = S.newWeaponState(defs.w[0], defs.w[1], defs.grenade);
  let wasGround = false, drop = -1;
  for (let i = 0; i < 200 && drop < 0; i++) {
    S.simulateInput(w, C, defs, ps, ws, { seq: i + 1, keys: FWD, yaw, pitch: 0, buttons: 0, slot: 0 });
    if (ps.onGround) wasGround = true;
    else if (wasGround) drop = i;
  }
  if (drop < 0) throw new Error("coyote case: never left the roof");
  const inputs = [...seg(drop + late, FWD, yaw), ...seg(1, FWD | JUMP, yaw), ...seg(30, FWD, yaw)];
  const c = { name, map: "barnyard", start, inputs };
  // sanity: the jump input must (or must not) launch the egg upward
  const p2 = S.newPlayerState(...start), w2 = S.newWeaponState(defs.w[0], defs.w[1], defs.grenade);
  let vyBefore = 0;
  inputs.forEach(([keys, y], i) => {
    if (i === drop + late) vyBefore = p2.vy;
    S.simulateInput(w, C, defs, p2, w2, { seq: i + 1, keys, yaw: y, pitch: 0, buttons: 0, slot: 0 });
    if (i === drop + late && (p2.vy > vyBefore) !== wantJump) throw new Error(`coyote case ${name}: jump=${p2.vy > vyBefore}`);
  });
  return c;
}
moveCases.push(coyoteCase("coyote_jump_after_ledge", 3, true), coyoteCase("coyote_expired", 8, false));
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
  { name: "pan_windup_then_hit", primary: "benedict", melee: "pan", inputs: [...wseg(1, MELEE), ...wseg(14, 0), ...wseg(1, FIRE), ...wseg(50, FIRE), ...wseg(1, MELEE), ...wseg(70, 0)] },
  { name: "whisk_spam_cooldown", primary: "poacher", melee: "whisk", inputs: [...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap(() => [...wseg(3, MELEE), ...wseg(3, 0)]), ...wseg(40, 0)] },
  { name: "melee_cancels_reload_with_windup", primary: "frittata", melee: "spatula", inputs: [...wseg(4, FIRE), ...wseg(20, 0), ...wseg(1, RELOAD), ...wseg(30, 0), ...wseg(1, MELEE), ...wseg(10, FIRE), ...wseg(40, 0), ...wseg(1, RELOAD), ...wseg(140, 0)] },
  { name: "bogus_melee_uses_default", primary: "deviler", melee: "bogus", inputs: [...wseg(1, MELEE), ...wseg(60, 0)] },
];
const weaponVec = weaponCases.map((c) => {
  const d = S.defsFor(weapons, c.primary, c.melee);
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
// hit zones: [hx,hy,hz, px,py,pz, dx,dz] -> zone. Egg at feet p; shots mostly along -Z (lateral axis = X).
const armX = C.armLat * C.hitRadii[0];
const hitZone = [
  [0, 1.3, 0.2, 0, 0, 0, 0, -1], // head (top cap)
  [0, C.headshotY, 0.4, 0, 0, 0, 0, -1], // ly == headshotY: head (inclusive)
  [0, C.headshotY - 1e-9, 0.4, 0, 0, 0, 0, -1], // just under: body
  [0, 0.75, 0.42, 0, 0, 0, 0, -1], // dead centre: body
  [0, 0.1, 0.3, 0, 0, 0, 0, -1], // feet: leg
  [0, C.legY, 0.4, 0, 0, 0, 0, -1], // ly == legY: body (legs are strictly below)
  [0, C.legY - 1e-9, 0.4, 0, 0, 0, 0, -1], // just under legY: leg
  [0.38, 0.7, 0.1, 0, 0, 0, 0, -1], // right edge: arm
  [-0.38, 0.7, 0.1, 0, 0, 0, 0, -1], // left edge: arm
  [armX, 0.7, 0.2, 0, 0, 0, 0, -1], // lat == armLat (as computed): boundary
  [armX - 1e-6, 0.7, 0.2, 0, 0, 0, 0, -1], // just inside: body
  [0.38, 1.2, 0.1, 0, 0, 0, 0, -1], // edge above the head line: head wins
  [0.38, 0.2, 0.1, 0, 0, 0, 0, -1], // edge below legY: leg wins
  [0.1, 0.7, 0.38, 0, 0, 0, 0, -1], // shot along -Z: z offset is depth, not lateral -> body
  [0.1, 0.7, 0.38, 0, 0, 0, -1, 0], // same point, shot along -X: lateral = z -> arm
  [0.1, 0.7, -0.38, 0, 0, 0, 1, 0], // other side, shot along +X -> arm
  [0.3, 0.8, 0.3, 0, 0, 0, 0, 0], // vertical ray (dx = dz = 0): body
  [10.35, 5.7, -3.2, 10, 5, -3, 0.6, -0.8], // offset egg, diagonal ray
  [10.05, 5.7, -3.0, 10, 5, -3, 0.6, -0.8], // offset egg, diagonal ray near the axis -> body
  [3.3, 2.2, 1.0, 3, 1.0, 1.25, 0.7071067811865476, 0.7071067811865476], // head on a raised egg
].map(([hx, hy, hz, px, py, pz, dx, dz]) => ({ h: [hx, hy, hz], p: [px, py, pz], d: [dx, dz], zone: S.hitZone(C, hx, hy, hz, px, py, pz, dx, dz) }));
// melee zones: [ox,oy,oz, yaw,pitch, px,py,pz] -> zone on the real (uninflated) egg (PROTOCOL 9.3).
const meleeZone = [
  [0, 1.3, 0, 0, -0.8, 0, 0, -0.75], // touching, aiming at the feet: body (not head from the eye inside the inflated egg)
  [0, 1.3, 0, 0, -0.4, 0, 0, -0.75], // touching, belly: body
  [0, 1.3, 0, 0, 0, 0, 0, -0.75], // touching, level at eye height: head
  [0, 1.3, 0, 0, -0.6, 0, 0, -1.0], // 1 m, belly: body
  [0, 1.3, 0, 0, -0.8, 0, 0, -1.7], // 1.7 m, low: leg
  [0, 1.3, 0, 0, -0.1, 0, 0, -1.7], // 1.7 m, top cap: head
  [0, 1.3, 0, 0.35, -0.3, 0, 0, -1.2], // off-axis: arm
  [0.3, 1.3, 0, 0, -0.35, 0, 0, -1.0], // aim slightly right of the axis: body
  [0, 1.3, 0, 0, 1.2, 0, 0, -1.0], // aiming up past the egg: pulled onto the surface (head)
  [0, 1.3, 0, Math.PI, -0.5, 0, 0, -1.0], // facing away (closest point is the eye itself)
  [5, 3.3, 5, 0.6, -0.5, 4.2, 2, 4.1], // raised, offset egg
].map(([ox, oy, oz, yaw, pitch, px, py, pz]) => { const d = S.aimDir(yaw, pitch); return { o: [ox, oy, oz], d, p: [px, py, pz], zone: S.meleeZone(C, ox, oy, oz, d[0], d[1], d[2], px, py, pz) }; });
const zoneMul = [...weapons.primaries, weapons.secondary, ...weapons.melees, weapons.grenade].flatMap((id) => [0, 1, 2, 3, 4].map((z) => ({ weapon: id, zone: z, mul: S.zoneMul(weapons.weapons[id], z) })));

const files = {
  "movement.json": { note: "state = [x,y,z,vx,vy,vz,onGround,coy] after each input; input = [keys,yaw,pitch,buttons,slot]; seq = index+1; weapons from 'primary'", dt: C.dt, cases: movement },
  "weapons.json": { note: "input = [buttons, slot, moving]; defs = defsFor(primary, melee); expect[i].ws = weapon state array (15 entries) after tick i; acts = actions emitted", dt: C.dt, cases: weaponVec },
  "math.json": { rng, seeds, dirs, egg, casts, falloff, hitZone, meleeZone, zoneMul },
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
