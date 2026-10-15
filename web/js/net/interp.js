// Snapshot buffer + remote interpolation (PROTOCOL.md section 14, item 3).
// Remote players and projectiles are drawn at render tick rt by linearly
// interpolating the two snapshots that bracket it (yaw by the shortest arc),
// extrapolating at most `maxExtrapTicks` (100 ms) when the buffer runs dry.

const TAU = Math.PI * 2;
function norm(a) {
  a %= TAU;
  if (a > Math.PI) a -= TAU; else if (a <= -Math.PI) a += TAU;
  return a;
}
const lerpA = (a, b, t) => norm(a + norm(b - a) * t);

/** Distance (units) between two consecutive samples above which we snap instead of lerping (respawn). */
const TELEPORT = 4.5;

export class SnapshotBuffer {
  constructor(maxExtrapTicks = 6, keep = 40) {
    this.maxExtrap = maxExtrapTicks;
    this.keep = keep;
    this.snaps = []; // {k, players: Map(id -> arr), proj: Map(id -> arr)}
  }

  clear() { this.snaps.length = 0; }

  get length() { return this.snaps.length; }
  get latest() { return this.snaps[this.snaps.length - 1] || null; }

  push(snap) {
    const players = new Map();
    for (const p of snap.p || []) players.set(p[0], p);
    const proj = new Map();
    for (const r of snap.pr || []) proj.set(r[0], r);
    const s = { k: snap.k, players, proj };
    const arr = this.snaps;
    // Keep ordered by k; drop duplicates / out-of-order older ones.
    if (arr.length && snap.k <= arr[arr.length - 1].k) {
      if (snap.k === arr[arr.length - 1].k) arr[arr.length - 1] = s;
      return;
    }
    arr.push(s);
    if (arr.length > this.keep) arr.splice(0, arr.length - this.keep);
  }

  /** Bracketing pair for rt: returns [s0, s1, t] (t may exceed 1 for extrapolation, capped). */
  _bracket(rt) {
    const a = this.snaps;
    const n = a.length;
    if (!n) return null;
    if (n === 1 || rt <= a[0].k) return [a[0], a[0], 0];
    for (let i = n - 1; i > 0; i--) {
      if (a[i - 1].k <= rt) {
        const s0 = a[i - 1], s1 = a[i];
        if (rt <= s1.k) return [s0, s1, (rt - s0.k) / (s1.k - s0.k)];
        // rt past the newest snapshot: extrapolate up to maxExtrap ticks.
        const over = Math.min(rt - s1.k, this.maxExtrap);
        return [s0, s1, 1 + over / (s1.k - s0.k)];
      }
    }
    return [a[0], a[0], 0];
  }

  /**
   * Interpolated state of every player at rt.
   * Calls fn(id, x, y, z, yaw, pitch, hp, sh, flags, slot, s1arr) for each player in the newest bracket snapshot.
   */
  samplePlayers(rt, fn) {
    const br = this._bracket(rt);
    if (!br) return;
    const [s0, s1, t] = br;
    const near = t < 0.5 ? s0 : s1;
    for (const [id, b] of s1.players) {
      const a = s0.players.get(id);
      if (!a || t === 0 && s0 === s1) { fn(id, b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b); continue; }
      const dx = b[1] - a[1], dy = b[2] - a[2], dz = b[3] - a[3];
      const alive0 = a[8] & 1, alive1 = b[8] & 1;
      if (dx * dx + dy * dy + dz * dz > TELEPORT * TELEPORT || alive0 !== alive1) {
        // Teleport / respawn / death: no lerp, switch to the new sample once we reach it.
        const pick = t >= 1 ? b : a;
        fn(id, pick[1], pick[2], pick[3], pick[4], pick[5], pick[6], pick[7], pick[8], pick[9], b);
        continue;
      }
      const f = near.players.get(id) || b;
      fn(id, a[1] + dx * t, a[2] + dy * t, a[3] + dz * t, lerpA(a[4], b[4], Math.min(t, 1)),
        a[5] + (b[5] - a[5]) * Math.min(t, 1), f[6], f[7], f[8], f[9], b);
    }
  }

  /** Interpolated projectiles at rt: fn(id, kind, owner, x, y, z, vx, vy, vz). */
  sampleProjectiles(rt, fn) {
    const br = this._bracket(rt);
    if (!br) return;
    const [s0, s1, t] = br;
    // Projectiles that exist in s0 but not s1 have exploded: hide them.
    // Projectiles only in s1 appear at their s1 position (scaled back along velocity).
    const dtTicks = (s1.k - s0.k) || 1;
    for (const [id, b] of s1.proj) {
      const a = s0.proj.get(id);
      if (!a) {
        if (t >= 1) {
          const e = (t - 1) * dtTicks / 60;
          fn(id, b[1], b[2], b[3] + b[6] * e, b[4] + b[7] * e, b[5] + b[8] * e, b[6], b[7], b[8]);
        }
        continue;
      }
      fn(id, b[1], b[2], a[3] + (b[3] - a[3]) * t, a[4] + (b[4] - a[4]) * t, a[5] + (b[5] - a[5]) * t, b[6], b[7], b[8]);
    }
  }

  /** Raw position of player id at rt (for death cam / effects). */
  playerAt(rt, id) {
    let out = null;
    this.samplePlayers(rt, (pid, x, y, z, yaw, pitch, hp, sh, flags) => { if (pid === id) out = { x, y, z, yaw, pitch, hp, sh, flags }; });
    return out;
  }
}
