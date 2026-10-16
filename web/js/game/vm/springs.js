// Small allocation-free animation helpers for the first-person rig: damped springs and easing curves.

/** Scalar damped spring x'' = k (target - x) - c x'. Critically damped when c = 2 sqrt(k). */
export class Spring {
  constructor(k = 180, c = 2 * Math.sqrt(180), x = 0) { this.k = k; this.c = c; this.x = x; this.v = 0; this.target = 0; }
  impulse(dv) { this.v += dv; }
  update(dt) {
    // semi-implicit Euler in fixed sub-steps (stable for the stiff springs used here)
    let left = Math.min(dt, 0.1);
    while (left > 1e-6) {
      const h = Math.min(left, 1 / 240);
      this.v += (this.k * (this.target - this.x) - this.c * this.v) * h;
      this.x += this.v * h;
      left -= h;
    }
    return this.x;
  }
  reset(x = 0) { this.x = x; this.v = 0; this.target = x; }
}

/** Three independent springs (position / rotation offsets). */
export class Spring3 {
  constructor(k, c) { this.x = new Spring(k, c); this.y = new Spring(k, c); this.z = new Spring(k, c); }
  impulse(x, y, z) { this.x.v += x; this.y.v += y; this.z.v += z; }
  update(dt) { this.x.update(dt); this.y.update(dt); this.z.update(dt); }
  reset() { this.x.reset(); this.y.reset(); this.z.reset(); }
}

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smooth = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
export const smoother = (t) => { t = clamp01(t); return t * t * t * (t * (t * 6 - 15) + 10); };
export const easeOut = (t) => { t = clamp01(t); return 1 - (1 - t) * (1 - t); };
export const easeIn = (t) => { t = clamp01(t); return t * t; };
/** Ease out with an overshoot of about `s * 0.1` (s = 1.0 gives ~6 %). */
export const backOut = (t, s = 1.0) => { t = clamp01(t) - 1; return 1 + t * t * ((s + 1) * t + s); };
export const EASE = { lin: clamp01, s: smooth, ss: smoother, out: easeOut, in: easeIn, back: (t) => backOut(t, 0.9) };
