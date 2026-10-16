// Timeline sampling for the first-person rig (allocation-free).
// Keys are [t, ...values, ease]; the ease of key i+1 shapes the segment from key i to key i+1.

import { EASE, clamp01 } from "./springs.js";

/** Segment lookup result (reused). */
export const SEG = { i0: 0, i1: 0, u: 0 };

/** Find the segment around time f in keys (sorted by key[0]); eIdx = index of the ease name in a key. */
export function seg(keys, f, eIdx) {
  const n = keys.length;
  if (n === 0) { SEG.i0 = SEG.i1 = -1; SEG.u = 0; return SEG; }
  if (f <= keys[0][0] || n === 1) { SEG.i0 = SEG.i1 = 0; SEG.u = 0; return SEG; }
  if (f >= keys[n - 1][0]) { SEG.i0 = SEG.i1 = n - 1; SEG.u = 0; return SEG; }
  let i = 0;
  while (i < n - 2 && f >= keys[i + 1][0]) i++;
  const a = keys[i][0], b = keys[i + 1][0];
  const raw = b > a ? clamp01((f - a) / (b - a)) : 1;
  const e = EASE[keys[i + 1][eIdx]] || EASE.s;
  SEG.i0 = i; SEG.i1 = i + 1; SEG.u = e(raw);
  return SEG;
}

/** Gun offset keys [t, [x,y,z], [rx,ry,rz], ease] -> pos/rot (Vector3-likes with x,y,z). */
export function sampleGun(keys, f, pos, rot) {
  if (!keys || !keys.length) { pos.x = pos.y = pos.z = 0; rot.x = rot.y = rot.z = 0; return; }
  const s = seg(keys, f, 3);
  const A = keys[s.i0], B = keys[s.i1], u = s.u;
  pos.x = A[1][0] + (B[1][0] - A[1][0]) * u; pos.y = A[1][1] + (B[1][1] - A[1][1]) * u; pos.z = A[1][2] + (B[1][2] - A[1][2]) * u;
  rot.x = A[2][0] + (B[2][0] - A[2][0]) * u; rot.y = A[2][1] + (B[2][1] - A[2][1]) * u; rot.z = A[2][2] + (B[2][2] - A[2][2]) * u;
}

/** Scalar keys [t, v, ease]. */
export function sampleScalar(keys, f, def = 0) {
  if (!keys || !keys.length) return def;
  const s = seg(keys, f, 2);
  const a = keys[s.i0][1], b = keys[s.i1][1];
  return a + (b - a) * s.u;
}

/** Step keys [t, bool] -> value of the last key with t <= f. */
export function sampleStep(keys, f, def) {
  if (!keys || !keys.length) return def;
  let v = def;
  for (let i = 0; i < keys.length; i++) { if (keys[i][0] <= f) v = keys[i][1]; else break; }
  return v;
}

/** Target keys [t, target, ease] -> {a, b, u} (reused out object). */
export function sampleTargets(keys, f, out) {
  const s = seg(keys, f, 2);
  if (s.i0 < 0) { out.a = out.b = null; out.u = 0; return out; }
  out.a = keys[s.i0][1]; out.b = keys[s.i1][1]; out.u = s.u;
  return out;
}

/** Fire every event with lastF < t <= f (or t == 0 when starting). cb(type, arg, t). */
export function crossEvents(ev, lastF, f, cb) {
  if (!ev) return;
  for (let i = 0; i < ev.length; i++) {
    const t = ev[i][0];
    if ((t > lastF && t <= f) || (lastF < 0 && t === 0)) cb(ev[i][1], ev[i][2], t);
  }
}

/** Length of a timeline in its own time unit (1 for normalised timelines). */
export function tlEnd(tl) { return tl.unit === "s" ? tl.end : 1; }
