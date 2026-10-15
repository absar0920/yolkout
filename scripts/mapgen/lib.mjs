// Map-building helpers. Maps are authored as code here and emitted to
// shared/data/maps/<id>.json (the JSON is what server + client load).
// Everything is axis-aligned boxes; ramps are stair-steps (rise <= 0.5).

const r3 = (v) => Math.round(v * 1000) / 1000 + 0; // +0 normalises -0
const normYaw = (y) => {
  while (y > Math.PI) y -= 2 * Math.PI;
  while (y <= -Math.PI) y += 2 * Math.PI;
  return r3(y);
};

export const MATERIALS = {
  grass:     { color: "#6dbb4a", rough: 1.0 },
  dirt:      { color: "#9b7448", rough: 1.0 },
  fence:     { color: "#e8dcc2", rough: 0.9 },
  barnred:   { color: "#b33a32", rough: 0.9 },
  barntrim:  { color: "#f2ede4", rough: 0.9 },
  plank:     { color: "#b98a52", rough: 0.9 },
  roof:      { color: "#5a5f66", rough: 0.8 },
  hay:       { color: "#e8c25a", rough: 1.0 },
  metal:     { color: "#9aa3ad", rough: 0.45 },
  rust:      { color: "#a35a33", rough: 0.8 },
  water:     { color: "#5fb0d8", rough: 0.2 },
  tractor:   { color: "#3f8f3a", rough: 0.6 },
  tire:      { color: "#2a2a2e", rough: 1.0 },
  counter:   { color: "#d9d2c5", rough: 0.5 },
  tile:      { color: "#f4f1ea", rough: 0.4 },
  steel:     { color: "#c3cad1", rough: 0.3 },
  wood:      { color: "#c8955a", rough: 0.8 },
  cardboard: { color: "#e2a94b", rough: 1.0 },
  toaster:   { color: "#e2574c", rough: 0.35 },
  pancake:   { color: "#e0a458", rough: 0.9 },
  butter:    { color: "#ffe89a", rough: 0.6 },
  jar:       { color: "#cfe8d6", rough: 0.3 },
  spice:     { color: "#b5452f", rough: 0.8 },
  bread:     { color: "#c98a3f", rough: 1.0 },
  concrete:  { color: "#8e949a", rough: 1.0 },
  grate:     { color: "#5d6670", rough: 0.6 },
  hazard:    { color: "#f2c230", rough: 0.7 },
  belt:      { color: "#33373d", rough: 0.9 },
  crate:     { color: "#b07b45", rough: 0.9 },
  incubator: { color: "#e9edf0", rough: 0.4 },
  glow:      { color: "#ffb347", rough: 0.5, emissive: "#ff9a1f" },
  asphalt:   { color: "#4a4d52", rough: 1.0 },
  paint:     { color: "#f2f2f2", rough: 1.0 },
  chrome:    { color: "#d7dde3", rough: 0.2 },
  dinerwall: { color: "#7fd1c7", rough: 0.6 },
  checker:   { color: "#efe9df", rough: 0.6 },
  vinyl:     { color: "#d8403f", rough: 0.6 },
  neon:      { color: "#ff5fa2", rough: 0.4, emissive: "#ff2d86" },
  car1:      { color: "#3d7cc9", rough: 0.4 },
  car2:      { color: "#e8b13a", rough: 0.4 },
  glass:     { color: "#a9d6e5", rough: 0.1 },
  dumpster:  { color: "#2f6b45", rough: 0.7 },
  trailer:   { color: "#e6e6e6", rough: 0.6 },
  pallet:    { color: "#a8794a", rough: 1.0 },
};

const swapTeam = (t) => (t === 1 ? 2 : t === 2 ? 1 : 0);

export class MapBuilder {
  constructor(meta) {
    this.meta = meta;
    this.boxes = []; this.spawns = []; this.pickups = []; this.nests = [];
  }
  box(x0, y0, z0, x1, y1, z1, mat, extra = {}) {
    const b = {
      min: [r3(Math.min(x0, x1)), r3(Math.min(y0, y1)), r3(Math.min(z0, z1))],
      max: [r3(Math.max(x0, x1)), r3(Math.max(y0, y1)), r3(Math.max(z0, z1))],
      mat, ...extra,
    };
    if (!MATERIALS[mat]) throw new Error(`unknown material ${mat}`);
    this.boxes.push(b);
    return b;
  }
  /**
   * Wall slab along `axis` ("x" or "z"): spans [a0,a1] along axis, [t0,t1] across, [y0,y1] up,
   * minus rectangular openings [[a0,a1,y0,y1],...]. Decomposed into a few boxes.
   */
  wall(axis, a0, a1, t0, t1, y0, y1, mat, openings = []) {
    const as = new Set([a0, a1]), ys = new Set([y0, y1]);
    for (const [oa0, oa1, oy0, oy1] of openings) { as.add(oa0); as.add(oa1); ys.add(oy0); ys.add(oy1); }
    const A = [...as].filter((v) => v >= a0 && v <= a1).sort((p, q) => p - q);
    const Y = [...ys].filter((v) => v >= y0 && v <= y1).sort((p, q) => p - q);
    for (let j = 0; j < Y.length - 1; j++) {
      let run = null;
      const flush = (end) => { if (run !== null) { this._wallBox(axis, run, end, t0, t1, Y[j], Y[j + 1], mat); run = null; } };
      for (let i = 0; i < A.length - 1; i++) {
        const ca = (A[i] + A[i + 1]) / 2, cy = (Y[j] + Y[j + 1]) / 2;
        const hole = openings.some(([oa0, oa1, oy0, oy1]) => ca > oa0 && ca < oa1 && cy > oy0 && cy < oy1);
        if (hole) flush(A[i]); else if (run === null) run = A[i];
      }
      flush(A[A.length - 1]);
    }
  }
  _wallBox(axis, a0, a1, t0, t1, y0, y1, mat) {
    if (axis === "x") this.box(a0, y0, t0, a1, y1, t1, mat);
    else this.box(t0, y0, a0, t1, y1, a1, mat);
  }
  /**
   * Solid stair: `steps` boxes stacked from y0, each `rise` taller, `run` deep,
   * starting at edge coordinate `start` along dir ("+x","-x","+z","-z"), spanning [w0,w1] across.
   */
  stairs(dir, start, w0, w1, steps, mat, { y0 = 0, rise = 0.5, run = 0.6 } = {}) {
    const sgn = dir[0] === "+" ? 1 : -1, ax = dir[1];
    for (let i = 0; i < steps; i++) {
      const a = start + sgn * run * i, b = start + sgn * run * (i + 1);
      const top = y0 + rise * (i + 1);
      if (ax === "x") this.box(a, y0, w0, b, top, w1, mat);
      else this.box(w0, y0, a, w1, top, b, mat);
    }
  }
  spawn(x, y, z, yaw, team = 0) { this.spawns.push({ pos: [r3(x), r3(y), r3(z)], yaw: normYaw(yaw), team }); }
  pickup(type, x, y, z) { this.pickups.push({ type, pos: [r3(x), r3(y), r3(z)] }); }
  nest(team, x, y, z) { this.nests.push({ team, pos: [r3(x), r3(y), r3(z)] }); }

  _mark() { return [this.boxes.length, this.spawns.length, this.pickups.length, this.nests.length]; }
  /** Run fn, then add copies of everything it created rotated by 180 deg about the Y axis (teams swapped). */
  sym2(fn) {
    const [b0, s0, p0, n0] = this._mark(); fn(this);
    const B = this.boxes.slice(b0), S = this.spawns.slice(s0), P = this.pickups.slice(p0), N = this.nests.slice(n0);
    for (const b of B) this.box(-b.max[0], b.min[1], -b.max[2], -b.min[0], b.max[1], -b.min[2], b.mat, extraOf(b));
    for (const s of S) this.spawn(-s.pos[0], s.pos[1], -s.pos[2], s.yaw + Math.PI, swapTeam(s.team));
    for (const p of P) this.pickup(p.type, -p.pos[0], p.pos[1], -p.pos[2]);
    for (const n of N) this.nest(swapTeam(n.team), -n.pos[0], n.pos[1], -n.pos[2]);
  }
  /**
   * Run fn(q) for q=0..3 where the builder is pre-rotated by q*90 deg:
   * (x,z) -> (-z,x) per step; yaw -> yaw - PI/2 per step. teamOf(q, team) maps teams.
   */
  sym4(fn, teamOf = (q, t) => t) {
    for (let q = 0; q < 4; q++) {
      const [b0, s0, p0, n0] = this._mark(); fn(this, q);
      const B = this.boxes.splice(b0), S = this.spawns.splice(s0), P = this.pickups.splice(p0), N = this.nests.splice(n0);
      const rot = (x, z) => { for (let i = 0; i < q; i++) [x, z] = [-z, x]; return [x, z]; };
      for (const b of B) {
        const [ax, az] = rot(b.min[0], b.min[2]), [bx, bz] = rot(b.max[0], b.max[2]);
        this.box(ax, b.min[1], az, bx, b.max[1], bz, b.mat, extraOf(b));
      }
      for (const s of S) { const [x, z] = rot(s.pos[0], s.pos[2]); this.spawn(x, s.pos[1], z, s.yaw - q * Math.PI / 2, teamOf(q, s.team)); }
      for (const p of P) { const [x, z] = rot(p.pos[0], p.pos[2]); this.pickup(p.type, x, p.pos[1], z); }
      for (const n of N) { const [x, z] = rot(n.pos[0], n.pos[2]); this.nest(teamOf(q, n.team), x, n.pos[1], z); }
    }
  }
  build() {
    const used = [...new Set(this.boxes.map((b) => b.mat))].sort();
    const materials = Object.fromEntries(used.map((m) => [m, MATERIALS[m]]));
    const m = this.meta;
    return {
      format: 1, id: m.id, name: m.name, desc: m.desc, author: "Yolkout", modes: m.modes,
      bounds: m.bounds, killY: m.killY ?? m.bounds.min[1],
      palette: m.palette, materials,
      boxes: this.boxes, spawns: this.spawns, pickups: this.pickups, nests: this.nests,
    };
  }
}
function extraOf(b) { const { min, max, mat, ...rest } = b; return rest; }
