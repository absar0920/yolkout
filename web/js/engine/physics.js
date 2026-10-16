// Yolkout client physics / prediction module.
//
// The deterministic math (movement, collision, weapon state machine, spread RNG,
// ray tests, projectiles) is NOT re-implemented here: it is re-exported from the
// canonical shared sim (shared/ref/sim.mjs, served at /ref/sim.mjs and mapped to
// the bare specifier "yolkout/sim" by the page's import map). This file adds the
// client-side pieces of PROTOCOL.md section 14 on top of it:
//   - wire quantisation (q4 yaw/pitch, q2 rt) and yaw normalisation (section 1, 5.1)
//   - Predictor: local prediction + reconciliation (replay of unacked inputs)
//   - angle helpers used by interpolation (shortest-arc yaw lerp)
// Pure module: no DOM, no three.js. Runs under Node for tests
// (see web/js/engine/test/physics.test.mjs, which maps "yolkout/sim" with a loader hook).

import * as Sim from "yolkout/sim";

export * from "yolkout/sim";
export { Sim };

const TAU = Math.PI * 2;

/** Round to d decimals exactly the way PROTOCOL.md "qN" fields require. */
export function q(v, d) {
  const m = 10 ** d;
  return Math.round(v * m) / m;
}
export const q2 = (v) => Math.round(v * 100) / 100;
export const q3 = (v) => Math.round(v * 1000) / 1000;
export const q4 = (v) => Math.round(v * 10000) / 10000;

/** Normalise an angle to (-PI, PI]. */
export function normYaw(a) {
  if (!Number.isFinite(a)) return 0;
  a = a % TAU;
  if (a > Math.PI) a -= TAU;
  else if (a <= -Math.PI) a += TAU;
  return a;
}

/**
 * Wire yaw: normalised to (-PI, PI] and then rounded to q4, staying inside the
 * interval (q4(PI) = 3.1416 > PI, so the edge is pulled to +-3.1415).
 */
export function wireYaw(a) {
  let r = q4(normYaw(a));
  if (r > Math.PI) r = 3.1415;
  else if (r <= -Math.PI) r = -3.1415;
  return r === 0 ? 0 : r; // no -0 on the wire
}

/** Wire pitch: clamped to +-maxPitch then q4. */
export function wirePitch(p, maxPitch = 1.5) {
  const r = q4(Math.max(-maxPitch, Math.min(maxPitch, Number.isFinite(p) ? p : 0)));
  return r === 0 ? 0 : r;
}

/** Shortest signed angular difference b - a in (-PI, PI]. */
export function angleDiff(a, b) {
  return normYaw(b - a);
}

/** Interpolate angles along the shortest arc. */
export function lerpAngle(a, b, t) {
  return normYaw(a + angleDiff(a, b) * t);
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Build the wire input entry [seq,keys,yaw,pitch,buttons,slot,rt] (section 5.1). */
export function makeInputEntry(seq, keys, yaw, pitch, buttons, slot, rt, maxPitch = 1.5) {
  return [seq >>> 0, keys & 31, wireYaw(yaw), wirePitch(pitch, maxPitch), buttons & 31, slot === 1 ? 1 : 0, q2(rt)];
}

/** Input object as consumed by Sim.simulateInput, from a wire entry. */
export function entryToInput(e) {
  return { seq: e[0], keys: e[1], yaw: e[2], pitch: e[3], buttons: e[4], slot: e[5] };
}

/**
 * Validate the weapons.json contract the sim relies on (the Go server checks the same at boot):
 * every id in `melees` is a melee with 0 <= windup < cooldown, `defaultMelee` is listed, and
 * every hitscan gun has `zones` with 4 positive multipliers. Throws on a broken file.
 */
export function validateWeapons(weapons) {
  const W = weapons.weapons || {};
  const melees = Array.isArray(weapons.melees) && weapons.melees.length ? weapons.melees : [weapons.melee];
  for (const id of melees) {
    const m = W[id];
    if (!m || m.kind !== "melee") throw new Error(`weapons.json: melees entry "${id}" is not a melee weapon`);
    const wu = m.windup || 0;
    if (!(wu >= 0 && wu < m.cooldown)) throw new Error(`weapons.json: melee "${id}" needs 0 <= windup < cooldown`);
  }
  const def = weapons.defaultMelee || weapons.melee;
  if (!melees.includes(def)) throw new Error(`weapons.json: defaultMelee "${def}" is not in melees`);
  for (const [id, w] of Object.entries(W)) {
    if (w.kind !== "hitscan") continue;
    const z = w.zones;
    if (!z || !(z.head > 0 && z.body > 0 && z.arm > 0 && z.leg > 0)) throw new Error(`weapons.json: hitscan weapon "${id}" needs zones`);
  }
  return true;
}

/** Melee id for a requested one: listed ids pass, anything else becomes weapons.defaultMelee. */
export function meleeId(weapons, id) {
  const list = weapons.melees || [weapons.melee];
  return list.includes(id) ? id : (weapons.defaultMelee || weapons.melee);
}

/** Load every shared data file the client and the sim need. fetchJson(path) -> Promise<object>. */
export async function loadData(fetchJson) {
  const [rules, weapons, modes, cosmetics, mapIndex] = await Promise.all([
    fetchJson("rules.json"), fetchJson("weapons.json"), fetchJson("modes.json"),
    fetchJson("cosmetics.json"), fetchJson("maps/index.json"),
  ]);
  validateWeapons(weapons);
  const C = Sim.makeConsts(rules);
  const maps = new Map();
  return {
    rules, weapons, modes, cosmetics, mapIndex, C,
    /** Fetch + cache a map JSON together with its collision world. */
    async map(id) {
      if (!maps.has(id)) {
        maps.set(id, fetchJson(`maps/${id}.json`).then((json) => ({ json, world: Sim.makeWorld(json) })));
      }
      try { return await maps.get(id); } catch (e) { maps.delete(id); throw e; }
    },
    /** Loadout defs for a primary and a melee (unknown or missing ids use the defaults). */
    defs(cls, mel) { return Sim.defsFor(weapons, cls, mel); },
  };
}

function copyPs(ps) {
  return { x: ps.x, y: ps.y, z: ps.z, vx: ps.vx, vy: ps.vy, vz: ps.vz, onGround: ps.onGround, coy: ps.coy | 0 };
}

/**
 * Local-player predictor (PROTOCOL.md section 14, items 1, 2 and 4).
 *
 *   const p = new Predictor(world, C, defs);
 *   p.reset(x, y, z);                 // on spawn
 *   const acts = p.step(input);        // once per fixed tick; input already quantised
 *   const err = p.reconcile(me, ack);  // on each snapshot with me.al == 1
 *
 * step() stores the input as pending; reconcile() adopts the authoritative state,
 * drops pending inputs with seq <= ack and replays the rest without effects.
 * `prev` holds the state before the latest step so the renderer can interpolate.
 */
export class Predictor {
  constructor(world, C, defs, maxPending = 240) {
    this.world = world;
    this.C = C;
    this.defs = defs;
    this.maxPending = maxPending;
    this.ps = Sim.newPlayerState(0, 0, 0);
    this.ws = Sim.newWeaponState(defs.w[0], defs.w[1], defs.grenade);
    this.prev = copyPs(this.ps);
    this.pending = [];
    this.lastAck = 0;
    this.replayed = 0;
  }

  /** Fresh spawn state (section 10.3): onGround true, velocity 0, fresh weapon state. */
  reset(x, y, z, defs = this.defs) {
    this.defs = defs;
    this.ps = Sim.newPlayerState(x, y, z);
    this.ps.onGround = true;
    this.ws = Sim.newWeaponState(defs.w[0], defs.w[1], defs.grenade);
    this.prev = copyPs(this.ps);
    this.pending.length = 0;
  }

  setWorld(world) { this.world = world; }

  /** Predict one input ({seq,keys,yaw,pitch,buttons,slot}); returns the sim actions. */
  step(input) {
    this.prev = copyPs(this.ps);
    const acts = Sim.simulateInput(this.world, this.C, this.defs, this.ps, this.ws, input);
    this.pending.push(input);
    if (this.pending.length > this.maxPending) this.pending.splice(0, this.pending.length - this.maxPending);
    return acts;
  }

  /**
   * Adopt the server state `me` (snapshot field) acked at `ack` and replay the unacked inputs.
   * Returns [dx,dy,dz] = new predicted position minus the old predicted position
   * (the caller turns it into a decaying visual offset).
   */
  reconcile(me, ack) {
    const ox = this.ps.x, oy = this.ps.y, oz = this.ps.z;
    const ps = this.ps;
    ps.x = me.x; ps.y = me.y; ps.z = me.z;
    ps.vx = me.vx; ps.vy = me.vy; ps.vz = me.vz;
    ps.onGround = !!me.g;
    ps.coy = me.cy | 0;
    if (Array.isArray(me.ws)) this.ws = Sim.weaponStateFromArray(me.ws);
    this.lastAck = ack;
    let drop = 0;
    while (drop < this.pending.length && this.pending[drop].seq <= ack) drop++;
    if (drop) this.pending.splice(0, drop);
    // Replay: all but the last input rebuild the state; `prev` is the state before the last.
    const n = this.pending.length;
    for (let i = 0; i < n; i++) {
      if (i === n - 1) this.prev = copyPs(ps);
      Sim.simulateInput(this.world, this.C, this.defs, ps, this.ws, this.pending[i]);
    }
    if (n === 0) this.prev = copyPs(ps);
    this.replayed = n;
    return [ps.x - ox, ps.y - oy, ps.z - oz];
  }

  /** Eye position of the current predicted state. */
  eye() { return [this.ps.x, this.ps.y + this.C.eyeHeight, this.ps.z]; }

  /** Interpolated feet position between the previous and current tick. */
  lerpPos(alpha, out = [0, 0, 0]) {
    const a = this.prev, b = this.ps;
    out[0] = a.x + (b.x - a.x) * alpha;
    out[1] = a.y + (b.y - a.y) * alpha;
    out[2] = a.z + (b.z - a.z) * alpha;
    return out;
  }
}

/**
 * Simple predicted local hit test used only for visuals (tracer end / impact),
 * never for damage: nearest of world and the given egg positions.
 * targets: iterable of {id, x, y, z}. Returns {t, kind: 0 miss | 1 world | 2 player, id}.
 */
export function traceShot(world, C, ox, oy, oz, d, range, targets, skipId = 0) {
  let t = Sim.raycastWorld(world, ox, oy, oz, d[0], d[1], d[2], range);
  let kind = t < 0 ? 0 : 1;
  if (t < 0) t = range;
  let id = 0;
  if (targets) {
    for (const p of targets) {
      if (p.id === skipId) continue;
      const tp = Sim.rayEgg(C, ox, oy, oz, d[0], d[1], d[2], p.x, p.y, p.z, t);
      if (tp >= 0 && tp <= t) { t = tp; kind = 2; id = p.id; }
    }
  }
  return { t, kind, id };
}
