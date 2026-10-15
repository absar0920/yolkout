// Yolkout canonical shared simulation (reference implementation).
//
// This file is THE source of truth for deterministic gameplay math that must
// agree between the browser client (prediction) and the Go server (authority):
//   - movement / AABB collision / step-up / step-down
//   - weapon state machine (fire timing, ammo, reload, switch, bloom, burst)
//   - deterministic per-shot spread RNG (mulberry32)
//   - ray vs AABB, ray vs egg ellipsoid, damage falloff
//
// The client imports it directly (served at /ref/sim.mjs). The Go server ports
// it line-for-line (server/sim) and must pass shared/testvectors/*.json.
// Pure functions, no dependencies, no allocation in hot paths except results.
// All numbers are IEEE-754 float64. Do not reorder arithmetic.

export const KEY = { FWD: 1, BACK: 2, LEFT: 4, RIGHT: 8, JUMP: 16 };
export const BTN = { FIRE: 1, AIM: 2, RELOAD: 4, GRENADE: 8, MELEE: 16 };

// ---------------------------------------------------------------- constants

/** Flatten rules.json into the constant bag the sim uses. */
export function makeConsts(rules) {
  const p = rules.player, m = rules.move, n = rules.net, c = rules.combat;
  return {
    dt: 1 / n.tickRate,
    halfWidth: p.halfWidth, height: p.height, eyeHeight: p.eyeHeight,
    hitCenterY: p.hitCenterY, hitRadii: p.hitRadii, headshotY: p.headshotY, maxPitch: p.maxPitch,
    moveSpeed: m.moveSpeed, groundAccel: m.groundAccel, airAccel: m.airAccel,
    gravity: m.gravity, jumpVelocity: m.jumpVelocity, terminalVelocity: m.terminalVelocity,
    maxHorizontalSpeed: m.maxHorizontalSpeed, stepHeight: m.stepHeight, adsMoveMul: m.adsMoveMul,
    eps: m.eps, movingSpeedThreshold: c.movingSpeedThreshold,
  };
}

// ---------------------------------------------------------------- world

/**
 * Build the collision world from a map JSON.
 * Solids = every box whose `solid` is not false, followed by 4 implicit
 * boundary walls just outside bounds (x and z sides, full bounds height).
 * Box order does not affect results (clip uses min/max reductions).
 * Returns { boxes: Float64Array [minx,miny,minz,maxx,maxy,maxz]*, count, bounds }.
 */
export function makeWorld(map) {
  const list = [];
  for (const b of map.boxes) if (b.solid !== false) list.push([b.min[0], b.min[1], b.min[2], b.max[0], b.max[1], b.max[2]]);
  const bn = map.bounds.min, bx = map.bounds.max;
  list.push([bn[0] - 1, bn[1], bn[2] - 1, bn[0], bx[1], bx[2] + 1]); // -X wall
  list.push([bx[0], bn[1], bn[2] - 1, bx[0] + 1, bx[1], bx[2] + 1]); // +X wall
  list.push([bn[0] - 1, bn[1], bn[2] - 1, bx[0] + 1, bx[1], bn[2]]); // -Z wall
  list.push([bn[0] - 1, bn[1], bx[2], bx[0] + 1, bx[1], bx[2] + 1]); // +Z wall
  const boxes = new Float64Array(list.length * 6);
  list.forEach((b, i) => boxes.set(b, i * 6));
  return { boxes, count: list.length, bounds: map.bounds };
}

// ---------------------------------------------------------------- movement

/** Player physics state. onGround is a boolean. */
export function newPlayerState(x, y, z) {
  return { x, y, z, vx: 0, vy: 0, vz: 0, onGround: false };
}

/**
 * Largest movement along `axis` (0=x,1=y,2=z) not exceeding `delta` (sign kept)
 * such that the player's AABB does not enter any solid. Does NOT mutate st.
 * Only boxes overlapping the player on the two other axes (shrunk by eps) and
 * lying entirely ahead of the player's leading face (within eps) can clip.
 */
export function clipAxis(world, C, st, axis, delta) {
  if (delta === 0) return 0;
  const hw = C.halfWidth, e = C.eps, B = world.boxes, n = world.count;
  const pmin0 = st.x - hw, pmin1 = st.y, pmin2 = st.z - hw;
  const pmax0 = st.x + hw, pmax1 = st.y + C.height, pmax2 = st.z + hw;
  const pmin = [pmin0, pmin1, pmin2], pmax = [pmax0, pmax1, pmax2];
  const o1 = (axis + 1) % 3, o2 = (axis + 2) % 3;
  const positive = delta > 0;
  for (let i = 0; i < n; i++) {
    const o = i * 6;
    if (!(pmin[o1] < B[o + 3 + o1] - e && pmax[o1] > B[o + o1] + e)) continue;
    if (!(pmin[o2] < B[o + 3 + o2] - e && pmax[o2] > B[o + o2] + e)) continue;
    if (positive) {
      const bmin = B[o + axis];
      if (bmin >= pmax[axis] - e) { const d = bmin - pmax[axis]; if (d < delta) delta = d; }
    } else {
      const bmax = B[o + 3 + axis];
      if (bmax <= pmin[axis] + e) { const d = bmax - pmin[axis]; if (d > delta) delta = d; }
    }
  }
  if (positive ? delta < 0 : delta > 0) delta = 0;
  return delta;
}

/** Does the player AABB at (x,y,z) overlap any solid (strictly, shrunk by eps)? */
export function overlapsSolid(world, C, x, y, z) {
  const hw = C.halfWidth, e = C.eps, B = world.boxes;
  for (let i = 0; i < world.count; i++) {
    const o = i * 6;
    if (x - hw < B[o + 3] - e && x + hw > B[o] + e &&
        y < B[o + 4] - e && y + C.height > B[o + 1] + e &&
        z - hw < B[o + 5] - e && z + hw > B[o + 2] + e) return true;
  }
  return false;
}

/**
 * Advance one fixed tick of movement. Mutates st.
 * keys: KEY bitmask. yaw: radians (0 faces -Z, positive turns left / CCW seen from above).
 * speedMul: active weapon moveMul * (AIM held ? adsMoveMul : 1).
 */
export function stepMove(world, C, st, keys, yaw, speedMul) {
  const dt = C.dt;
  const sy = Math.sin(yaw), cy = Math.cos(yaw);
  const mz = ((keys & KEY.FWD) ? 1 : 0) - ((keys & KEY.BACK) ? 1 : 0);
  const mx = ((keys & KEY.RIGHT) ? 1 : 0) - ((keys & KEY.LEFT) ? 1 : 0);
  // forward = (-sin yaw, 0, -cos yaw), right = (cos yaw, 0, -sin yaw)
  let wx = -sy * mz + cy * mx;
  let wz = -cy * mz - sy * mx;
  const len = Math.sqrt(wx * wx + wz * wz);
  if (len > 0) { wx = wx / len; wz = wz / len; }
  const speed = C.moveSpeed * speedMul;

  if (st.onGround) {
    const k = Math.min(1, C.groundAccel * dt);
    st.vx += (wx * speed - st.vx) * k;
    st.vz += (wz * speed - st.vz) * k;
  } else if (len > 0) {
    const k = Math.min(1, C.airAccel * dt);
    st.vx += (wx * speed - st.vx) * k;
    st.vz += (wz * speed - st.vz) * k;
  }
  const hs = Math.sqrt(st.vx * st.vx + st.vz * st.vz);
  if (hs > C.maxHorizontalSpeed) { const f = C.maxHorizontalSpeed / hs; st.vx *= f; st.vz *= f; }

  if ((keys & KEY.JUMP) && st.onGround) { st.vy = C.jumpVelocity; st.onGround = false; }

  st.vy -= C.gravity * dt;
  if (st.vy < -C.terminalVelocity) st.vy = -C.terminalVelocity;

  const canStep = st.onGround; // still grounded after jump check
  const dx = st.vx * dt, dz = st.vz * dt;

  // Horizontal: X then Z.
  const sx = st.x, sy0 = st.y, sz = st.z;
  let ax = clipAxis(world, C, st, 0, dx); st.x += ax;
  let az = clipAxis(world, C, st, 2, dz); st.z += az;

  // Step-up attempt (Quake style): lift, move, drop; keep if it went farther.
  if (canStep && (ax !== dx || az !== dz)) {
    const x1 = st.x, y1 = st.y, z1 = st.z;
    st.x = sx; st.y = sy0; st.z = sz;
    const up = clipAxis(world, C, st, 1, C.stepHeight); st.y += up;
    const bx = clipAxis(world, C, st, 0, dx); st.x += bx;
    const bz = clipAxis(world, C, st, 2, dz); st.z += bz;
    const down = clipAxis(world, C, st, 1, -up); st.y += down;
    if (bx * bx + bz * bz > ax * ax + az * az + 1e-12) { ax = bx; az = bz; }
    else { st.x = x1; st.y = y1; st.z = z1; }
  }
  if (ax !== dx) st.vx = 0;
  if (az !== dz) st.vz = 0;

  // Vertical.
  const dy = st.vy * dt;
  const ay = clipAxis(world, C, st, 1, dy);
  st.y += ay;
  if (ay !== dy) {
    st.onGround = dy < 0;
    st.vy = 0;
  } else if (canStep && st.vy <= 0) {
    // Step-down snap: keep walking down stairs instead of hopping.
    const sd = clipAxis(world, C, st, 1, -C.stepHeight);
    if (sd !== -C.stepHeight) { st.y += sd; st.onGround = true; st.vy = 0; }
    else st.onGround = false;
  } else {
    st.onGround = false;
  }
}

// ---------------------------------------------------------------- RNG / aim

/** mulberry32 PRNG; returns a function yielding floats in [0,1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Per-pellet seed: uint32 of (seq*0x9E3779B1) ^ (pid*0x85EBCA77) ^ ((pellet+1)*0xC2B2AE3D). */
export function shotSeed(pid, seq, pellet) {
  return (Math.imul(seq >>> 0, 0x9E3779B1) ^ Math.imul(pid >>> 0, 0x85EBCA77) ^ Math.imul((pellet + 1) >>> 0, 0xC2B2AE3D)) >>> 0;
}

/** Unit aim vector from yaw/pitch. */
export function aimDir(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

/**
 * Pellet directions for one shot. For pellet i: rng = mulberry32(shotSeed(pid,seq,i));
 * u1 = rng(), u2 = rng(); r = spread*sqrt(u1); th = 2*PI*u2;
 * d = normalize(f + R*(r*cos th) + U*(r*sin th)) with f = aimDir, R = (cos yaw,0,-sin yaw), U = R x f.
 */
export function shotDirs(pid, seq, yaw, pitch, spread, pellets) {
  const f = aimDir(yaw, pitch);
  const R = [Math.cos(yaw), 0, -Math.sin(yaw)];
  // U = R x f
  const U = [R[1] * f[2] - R[2] * f[1], R[2] * f[0] - R[0] * f[2], R[0] * f[1] - R[1] * f[0]];
  const out = [];
  for (let i = 0; i < pellets; i++) {
    const rng = mulberry32(shotSeed(pid, seq, i));
    const u1 = rng(), u2 = rng();
    const r = spread * Math.sqrt(u1), th = 2 * Math.PI * u2;
    const a = r * Math.cos(th), b = r * Math.sin(th);
    let x = f[0] + R[0] * a + U[0] * b, y = f[1] + R[1] * a + U[1] * b, z = f[2] + R[2] * a + U[2] * b;
    const l = Math.sqrt(x * x + y * y + z * z);
    out.push([x / l, y / l, z / l]);
  }
  return out;
}

// ---------------------------------------------------------------- rays

/** Slab test. Returns entry t in [0,tmax] or -1. Origin inside box returns 0. */
export function rayBox(ox, oy, oz, dx, dy, dz, B, o, tmax) {
  let t0 = 0, t1 = tmax;
  const org = [ox, oy, oz], dir = [dx, dy, dz];
  for (let a = 0; a < 3; a++) {
    const mn = B[o + a], mx = B[o + 3 + a], d = dir[a], p = org[a];
    if (d === 0) { if (p < mn || p > mx) return -1; continue; }
    let ta = (mn - p) / d, tb = (mx - p) / d;
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return -1;
  }
  return t0;
}

/** Nearest solid hit along ray within tmax: returns t or -1. */
export function raycastWorld(world, ox, oy, oz, dx, dy, dz, tmax) {
  let best = -1;
  for (let i = 0; i < world.count; i++) {
    const t = rayBox(ox, oy, oz, dx, dy, dz, world.boxes, i * 6, best < 0 ? tmax : best);
    if (t >= 0 && (best < 0 || t < best)) best = t;
  }
  return best;
}

/**
 * Ray vs egg ellipsoid of a player standing at feet (px,py,pz):
 * center (px, py+hitCenterY, pz), radii hitRadii (each + inflate).
 * Returns t in [0,tmax] or -1. Headshot iff hit point y >= py + headshotY.
 */
export function rayEgg(C, ox, oy, oz, dx, dy, dz, px, py, pz, tmax, inflate = 0) {
  const rx = C.hitRadii[0] + inflate, ry = C.hitRadii[1] + inflate, rz = C.hitRadii[2] + inflate;
  const qx = (ox - px) / rx, qy = (oy - (py + C.hitCenterY)) / ry, qz = (oz - pz) / rz;
  const ex = dx / rx, ey = dy / ry, ez = dz / rz;
  const a = ex * ex + ey * ey + ez * ez;
  const b = 2 * (qx * ex + qy * ey + qz * ez);
  const c = qx * qx + qy * qy + qz * qz - 1;
  if (c <= 0) return 0; // origin inside
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t < 0 || t > tmax) return -1;
  return t;
}

/** Damage of one bullet/pellet at distance d (before head multiplier). */
export function falloffDamage(w, d) {
  if (d <= w.falloffStart || w.falloffEnd <= w.falloffStart) return w.damage;
  if (d >= w.falloffEnd) return w.minDamage;
  const f = (d - w.falloffStart) / (w.falloffEnd - w.falloffStart);
  return w.damage + (w.minDamage - w.damage) * f;
}

/** Splash damage/knockback scale at distance d from explosion center (0..1). */
export function splashScale(radius, d) {
  if (d >= radius) return 0;
  return 1 - d / radius;
}

// ---------------------------------------------------------------- weapons

/**
 * Weapon state. Wire order (snapshot me.ws):
 * [slot, mag0, mag1, res0, res1, gren, cd, rl, sw, bl, bloom, mt, gt, pb]
 */
export function newWeaponState(primary, secondary, grenade) {
  return {
    slot: 0, mag: [primary.magSize, secondary.magSize], res: [primary.reserve, secondary.reserve],
    gren: grenade.startCount, cd: 0, rl: 0, sw: 0, bl: 0, bloom: 0, mt: 0, gt: 0, pb: 0,
  };
}
export function weaponStateToArray(ws) {
  return [ws.slot, ws.mag[0], ws.mag[1], ws.res[0], ws.res[1], ws.gren, ws.cd, ws.rl, ws.sw, ws.bl, ws.bloom, ws.mt, ws.gt, ws.pb];
}
export function weaponStateFromArray(a) {
  return { slot: a[0], mag: [a[1], a[2]], res: [a[3], a[4]], gren: a[5], cd: a[6], rl: a[7], sw: a[8], bl: a[9], bloom: a[10], mt: a[11], gt: a[12], pb: a[13] };
}

function refill(ws, w, s) {
  const need = w.magSize - ws.mag[s];
  const take = ws.res[s] < 0 ? need : Math.min(need, ws.res[s]);
  ws.mag[s] += take;
  if (ws.res[s] >= 0) ws.res[s] -= take;
}

/**
 * One tick of weapon logic. Mutates ws. Returns actions:
 *   {a:"fire", slot, spread, pellets}   -> caller builds shotDirs(pid, seq, yaw, pitch, spread, pellets)
 *   {a:"melee"} | {a:"grenade"} | {a:"reload"} (reload started) | {a:"switch", slot}
 * defs = { w: [primaryDef, secondaryDef], grenade: grenadeDef, melee: meleeDef }
 * moving = !onGround || horizontal speed > movingSpeedThreshold (state AFTER this tick's movement).
 */
export function weaponTick(ws, buttons, slotReq, defs, dt, moving) {
  const out = [];
  const pressed = buttons & ~ws.pb;
  ws.cd -= dt;
  ws.mt = Math.max(0, ws.mt - dt);
  ws.gt = Math.max(0, ws.gt - dt);

  // Switching
  if ((slotReq === 0 || slotReq === 1) && slotReq !== ws.slot) {
    ws.slot = slotReq; ws.sw = defs.w[slotReq].switchTime; ws.rl = 0; ws.bl = 0;
    out.push({ a: "switch", slot: slotReq });
  } else if (ws.sw > 0) {
    ws.sw = Math.max(0, ws.sw - dt);
  }
  const s = ws.slot, w = defs.w[s];
  ws.bloom = Math.max(0, ws.bloom - w.bloomRecover * dt);

  // Reload progress
  if (ws.rl > 0) {
    ws.rl -= dt;
    if (ws.rl <= 0) { ws.rl = 0; refill(ws, w, s); }
  }
  // Manual reload
  if ((pressed & BTN.RELOAD) && ws.rl === 0 && ws.sw === 0 && ws.mag[s] < w.magSize && ws.res[s] !== 0) {
    ws.rl = w.reloadTime; ws.bl = 0; out.push({ a: "reload" });
  }
  // Melee (cancels reload)
  if ((pressed & BTN.MELEE) && ws.mt === 0 && ws.sw === 0) {
    ws.mt = defs.melee.cooldown; ws.rl = 0; ws.bl = 0; out.push({ a: "melee" });
  }
  // Grenade
  if ((pressed & BTN.GRENADE) && ws.gt === 0 && ws.gren > 0 && ws.sw === 0) {
    ws.gren -= 1; ws.gt = defs.grenade.cooldown; out.push({ a: "grenade" });
  }
  // Fire
  let want;
  if (w.fireMode === "auto") want = (buttons & BTN.FIRE) !== 0;
  else if (w.fireMode === "semi") want = (pressed & BTN.FIRE) !== 0;
  else { // burst
    if ((pressed & BTN.FIRE) && ws.bl === 0 && ws.cd <= 0) ws.bl = w.burstCount;
    want = ws.bl > 0;
  }
  let fired = false;
  if (want && ws.sw === 0 && ws.rl === 0 && ws.mt === 0 && ws.cd <= 0) {
    if (ws.mag[s] === 0) {
      ws.bl = 0;
      if (ws.res[s] !== 0) { ws.rl = w.reloadTime; out.push({ a: "reload" }); }
    } else {
      const aimEff = (buttons & BTN.AIM) !== 0;
      const spread = (aimEff ? w.adsSpread : w.hipSpread) + (moving ? w.moveSpread : 0) + ws.bloom;
      ws.mag[s] -= 1;
      ws.bloom = Math.min(w.bloomMax, ws.bloom + w.bloomPerShot);
      ws.cd += w.fireInterval;
      if (w.fireMode === "burst") { ws.bl -= 1; if (ws.bl === 0) ws.cd += w.burstDelay; }
      fired = true;
      out.push({ a: "fire", slot: s, spread, pellets: w.pellets });
      if (ws.mag[s] === 0 && ws.res[s] !== 0) { ws.rl = w.reloadTime; ws.bl = 0; out.push({ a: "reload" }); }
    }
  }
  if (!fired && ws.cd < 0) ws.cd = 0;
  ws.pb = buttons;
  return out;
}

/** Movement speed multiplier for this tick (uses slot BEFORE this tick's switch). */
export function speedMulFor(C, defs, ws, buttons) {
  return defs.w[ws.slot].moveMul * ((buttons & BTN.AIM) ? C.adsMoveMul : 1);
}

/**
 * Full per-input step used by both sides: movement then weapons.
 * input = { seq, keys, yaw, pitch, buttons, slot }. Returns weapon actions.
 */
export function simulateInput(world, C, defs, ps, ws, input) {
  const pitch = Math.max(-C.maxPitch, Math.min(C.maxPitch, input.pitch));
  stepMove(world, C, ps, input.keys, input.yaw, speedMulFor(C, defs, ws, input.buttons));
  const moving = !ps.onGround || Math.sqrt(ps.vx * ps.vx + ps.vz * ps.vz) > C.movingSpeedThreshold;
  const acts = weaponTick(ws, input.buttons, input.slot, defs, C.dt, moving);
  for (const a of acts) if (a.a === "fire") a.pitch = pitch;
  return acts;
}

/** Resolve defs for a player's class from weapons.json. */
export function defsFor(weaponsJson, primaryId) {
  const W = weaponsJson.weapons;
  const p = W[primaryId] || W[weaponsJson.defaultPrimary];
  return { w: [p, W[weaponsJson.secondary]], grenade: W[weaponsJson.grenade], melee: W[weaponsJson.melee] };
}

// ---------------------------------------------------------------- projectiles

/** Like raycastWorld but also returns the entry face normal. null on miss. */
export function raycastWorldN(world, ox, oy, oz, dx, dy, dz, tmax) {
  let best = null;
  const B = world.boxes, org = [ox, oy, oz], dir = [dx, dy, dz];
  for (let i = 0; i < world.count; i++) {
    const o = i * 6;
    let t0 = 0, t1 = best ? best.t : tmax, ax = -1, miss = false;
    for (let a = 0; a < 3; a++) {
      const mn = B[o + a], mx = B[o + 3 + a], d = dir[a], p = org[a];
      if (d === 0) { if (p < mn || p > mx) { miss = true; break; } continue; }
      let ta = (mn - p) / d, tb = (mx - p) / d;
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      if (ta > t0) { t0 = ta; ax = a; }
      if (tb < t1) t1 = tb;
      if (t0 > t1) { miss = true; break; }
    }
    if (miss) continue;
    if (!best || t0 < best.t) {
      const n = [0, 0, 0];
      if (ax < 0) n[1] = 1; else n[ax] = dir[ax] > 0 ? -1 : 1; // ax<0: origin inside the box
      best = { t: t0, n, inside: ax < 0 };
    }
  }
  return best;
}

/**
 * Create a projectile from a weapon/grenade projectile def.
 * kind 0 = grenade (bounces, explodes when fuse runs out), kind 1 = launcher shell (explodes on impact or when life runs out).
 */
export function newProjectile(id, owner, def, x, y, z, vx, vy, vz) {
  return { id, owner, kind: def.kind, x, y, z, vx, vy, vz, gravity: def.gravity, radius: def.radius,
    bounce: def.bounce, friction: def.friction, life: def.kind === 0 ? def.fuse : def.life, rest: false };
}

/**
 * Advance one projectile one tick against the world (players are tested by the server separately
 * using rayEgg with inflate = radius along the same segment BEFORE calling this; see PROTOCOL.md 9.4).
 * Mutates pr. Returns null, or {explode:true, x,y,z} when it must explode this tick.
 */
export function stepProjectile(world, pr, dt) {
  pr.life -= dt;
  if (!pr.rest) {
    pr.vy -= pr.gravity * dt;
    const sx = pr.vx * dt, sy = pr.vy * dt, sz = pr.vz * dt;
    const len = Math.sqrt(sx * sx + sy * sy + sz * sz);
    if (len > 0) {
      const dx = sx / len, dy = sy / len, dz = sz / len;
      const h = raycastWorldN(world, pr.x, pr.y, pr.z, dx, dy, dz, len);
      if (h) {
        const hx = pr.x + dx * h.t, hy = pr.y + dy * h.t, hz = pr.z + dz * h.t;
        if (pr.kind === 1) return { explode: true, x: hx - dx * 0.05, y: hy - dy * 0.05, z: hz - dz * 0.05 };
        // grenade bounce: reflect normal component, damp tangential
        const n = h.n;
        const vn = pr.vx * n[0] + pr.vy * n[1] + pr.vz * n[2];
        let nvx = pr.vx - vn * n[0], nvy = pr.vy - vn * n[1], nvz = pr.vz - vn * n[2];
        nvx *= pr.friction; nvy *= pr.friction; nvz *= pr.friction;
        pr.vx = nvx - vn * n[0] * pr.bounce; pr.vy = nvy - vn * n[1] * pr.bounce; pr.vz = nvz - vn * n[2] * pr.bounce;
        pr.x = hx + n[0] * 0.01; pr.y = hy + n[1] * 0.01; pr.z = hz + n[2] * 0.01;
        if (n[1] === 1 && Math.sqrt(pr.vx * pr.vx + pr.vy * pr.vy + pr.vz * pr.vz) < 1.0) { pr.vx = 0; pr.vy = 0; pr.vz = 0; pr.rest = true; }
      } else {
        pr.x += sx; pr.y += sy; pr.z += sz;
      }
    }
  }
  if (pr.life <= 0) return { explode: true, x: pr.x, y: pr.y, z: pr.z };
  return null;
}
