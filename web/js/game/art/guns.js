// Cartoon guns, two LODs. Frame: origin = right-hand grip point, -Z forward (muzzle), +Y up, +X right,
// metres at TP scale. Each gun is built from bevelled primitives into one merged vertex-coloured static
// mesh plus one merged mesh per animated part (mag, bolt, slide, pump, rocket, shell, clip, trigger,
// sightGlass). Sockets carry userData.pose (+ userData.hand) for hand placement. TP keeps only the mag
// as a separate part; everything else is merged into the static mesh.

import * as THREE from "../../../vendor/three.module.min.js";
import {
  MeshBuilder, roundedBox, roundedBar, bevelCyl, ringTube, ellipsoid, tube, latheN, torus, flutedCyl, wavyTorus, extrudeShape,
  paint, trs, fxMesh, aimQuat, modelStats,
} from "./geom.js";
import { fxMaterial, toonMaterial, addOutline, PAL } from "./toon.js";
import { pinchPoint } from "./hands.js";
import { rocketGeometry } from "./throwables.js";

export const GUN_IDS = ["benedict", "deviler", "poacher", "piercer", "frittata", "overeasy", "souffle", "coddler"];
const TP_KEEP = new Set(["static", "mag", "rocket"]); // rocket: the launcher warhead hides after a shot (EggAvatar)
const HIDDEN = new Set(["shell", "clip"]);
const NO_OUTLINE = new Set(["trigger", "sightGlass", "rocket"]);

const AXM = {
  y: new THREE.Matrix4(),
  z: new THREE.Matrix4().makeRotationX(Math.PI / 2), // +Y -> +Z
  x: new THREE.Matrix4().makeRotationZ(-Math.PI / 2), // +Y -> +X
};

class Kit {
  constructor(lod) {
    this.lod = lod;
    this.fp = lod === "fp";
    this.B = new MeshBuilder();
    this.pivots = {};
    this.sockets = [];
    this.travel = {};
    this.meta = {};
  }
  _part(part) {
    if (this.fp) return part;
    if (HIDDEN.has(part)) return null;
    return TP_KEEP.has(part) ? part : "static";
  }
  _add(part, geo, color, m, o) {
    if ((o.fp && !this.fp) || (o.tp && this.fp)) return;
    const p = this._part(part);
    if (!p) return;
    this.B.add(p, geo, color === null ? null : paint(color, o.glow || 0, o.tint || 0), m);
  }
  /** Rounded box: p centre, s size [w,h,d]; o {r (abs radius), rr (relative), rot, seg, scale, fp, tp, glow}. */
  box(part, color, p, s, o = {}) {
    if ((o.fp && !this.fp) || (o.tp && this.fp)) return;
    const mn = Math.min(s[0], s[1], s[2]);
    let seg = this.fp ? Math.min(o.seg ?? 1, o.hero ? 2 : 1) : 0;
    if (mn < 0.014 && !o.hero) seg = 0; // too small for a visible bevel
    const r = o.r ?? mn * (o.rr ?? 0.2);
    const m = trs(p, o.rot || [0, 0, 0], o.scale ?? 1);
    // long parts: extruded rounded section (bevels along the length only) - a fraction of the triangles
    const L = Math.max(s[0], s[1], s[2]);
    const ax = s.indexOf(L), others = s.filter((_, i) => i !== ax);
    if (o.bar && this.fp) {
      // forced bar along Z (rings around rounded parts, e.g. pump grooves)
      this._add(part, roundedBar(s[0], s[1], s[2], r, o.hero ? 3 : 2), color, m, o);
      return;
    }
    const tpBar = !this.fp && mn >= 0.03 && o.seg !== 0;
    if ((seg > 0 || tpBar) && o.seg !== 0 && !o.box && L >= 2.2 * Math.max(...others)) {
      const bseg = this.fp ? (o.hero ? 3 : 2) : 1;
      let g;
      if (ax === 2) g = roundedBar(s[0], s[1], s[2], r * (o.hero ? 1.25 : 1.1), bseg);
      else if (ax === 0) { g = roundedBar(s[2], s[1], s[0], r * 1.1, bseg); g.rotateY(Math.PI / 2); }
      else { g = roundedBar(s[0], s[2], s[1], r * 1.1, bseg); g.rotateX(-Math.PI / 2); }
      this._add(part, g, color, m, o);
      return;
    }
    this._add(part, roundedBox(s[0], s[1], s[2], r, seg), color, m, o);
  }
  /** Cylinder along o.axis (default z): radius r at the -axis end, o.r2 at the +axis end. */
  cyl(part, color, p, r, len, o = {}) {
    if ((o.fp && !this.fp) || (o.tp && this.fp)) return;
    const rmax = Math.max(r, o.r2 ?? r);
    const radial = o.seg ?? (this.fp ? (rmax < 0.012 ? 8 : rmax < 0.022 ? 12 : 16) : (rmax < 0.02 ? 6 : 8));
    const bev = this.fp && rmax >= 0.012 ? (o.bevel ?? Math.min(r, o.r2 ?? r) * 0.25) : 0;
    const g = bevelCyl(o.r2 ?? r, r, len, radial, bev, this.fp && bev > 0 ? 1 : 0, o.caps || [true, true]);
    const m = trs(p, o.rot || [0, 0, 0], o.scale ?? 1).multiply(AXM[o.axis || "z"]);
    this._add(part, g, color, m, o);
  }
  ring(part, color, p, r, ri, len, o = {}) {
    if ((o.fp && !this.fp) || (o.tp && this.fp)) return;
    const g = ringTube(r, ri, len, o.seg ?? (this.fp ? (r < 0.02 ? 12 : 16) : 8), 0);
    this._add(part, g, color, trs(p, o.rot || [0, 0, 0], o.scale ?? 1).multiply(AXM[o.axis || "z"]), o);
  }
  sph(part, color, p, rad, o = {}) {
    if ((o.fp && !this.fp) || (o.tp && this.fp)) return;
    const big = Math.max(rad[0], rad[1], rad[2]) > 0.012;
    const g = ellipsoid(rad[0], rad[1], rad[2], o.ws ?? (this.fp ? (big ? 10 : 7) : 5), o.hs ?? (this.fp ? (big ? 6 : 5) : 3));
    this._add(part, g, color, trs(p, o.rot || [0, 0, 0]), o);
  }
  tube(part, color, pts, r, o = {}) {
    if ((o.fp && !this.fp) || (o.tp && this.fp)) return;
    this._add(part, tube(pts, r, o.n ?? (this.fp ? 12 : 4), o.radial ?? (this.fp ? 6 : 4), !!o.closed), color, new THREE.Matrix4(), o);
  }
  geo(part, color, g, m, o = {}) { this._add(part, g, color, m || new THREE.Matrix4(), o); }
  pivot(part, p) { this.pivots[part] = p; }
  /** Socket at gun-space position p with quaternion q (default identity); ud = userData (pose, hand). */
  socket(name, part, p, q, ud = {}) { this.sockets.push({ name, part, p, q: q || new THREE.Quaternion(), ud }); }
  /** Hand socket whose pinch point lands on `target`, hand fingers along `fwd`, back of hand along `up`. */
  pinchSocket(name, part, target, fwd, up, side, ud = {}) {
    const q = aimQuat(fwd, up);
    const pp = pinchPoint(side).applyQuaternion(q);
    this.socket(name, part, [target[0] - pp.x, target[1] - pp.y, target[2] - pp.z], q, Object.assign({ pose: "pinch", hand: side }, ud));
  }
  /** Hand socket gripping a bar (hand origin = bar centre) with fingers along `fwd`, back of hand along `up`. */
  gripSocket(name, part, p, fwd, up, pose, side, ud = {}) {
    this.socket(name, part, p, aimQuat(fwd, up), Object.assign({ pose, hand: side }, ud));
  }
}

// --------------------------------------------------------------- shared bits

const RAKE = 0.28; // pistol grip rake (top forward)
function pistolGrip(k, color, o = {}) {
  const rake = o.rake ?? RAKE;
  const h = o.h ?? 0.118, w = o.w ?? 0.042, d = o.d ?? 0.056;
  k.box("static", color, [0, -0.014, 0.006], [w, h, d], { rot: [-rake, 0, 0], r: 0.014 });
  if (o.panel) {
    // contrasting grip panels with finger grooves (FP)
    k.box("static", o.panel, [0, -0.018, 0.012], [w + 0.006, h * 0.72, d * 0.66], { rot: [-rake, 0, 0], r: 0.01, fp: true });
  }
  if (k.fp && !o.noGrooves) {
    for (let i = 0; i < 3; i++) {
      const y = -0.045 + i * 0.026;
      k.box("static", PAL.ink, [0, y, -0.02 + y * Math.tan(rake) * -1 - 0.004], [w * 0.7, 0.006, 0.01], { rot: [-rake, 0, 0], seg: 0, fp: true });
    }
  }
  // base plate
  k.box("static", o.base ?? PAL.metal, [0, -0.074, 0.024], [w + 0.006, 0.014, d + 0.006], { rot: [-rake, 0, 0], r: 0.006 });
}
function triggerGroup(k, color = PAL.metal, z = -0.043, guard = PAL.metal, o = {}) {
  const gy = o.gy ?? 0.0;
  // guard: bottom bar + front post
  k.box("static", guard, [0, gy, z - 0.008], [0.016, 0.012, 0.078], { r: 0.005 });
  k.box("static", guard, [0, gy + 0.018, z - 0.046], [0.016, 0.042, 0.012], { r: 0.005 });
  // trigger blade (part, pivots at its top)
  k.pivot("trigger", [0, gy + 0.042, z]);
  k.box("trigger", color, [0, gy + 0.026, z + 0.002], [0.009, 0.032, 0.012], { rot: [0.25, 0, 0], r: 0.004 });
  k.box("trigger", color, [0, gy + 0.011, z + 0.008], [0.009, 0.012, 0.014], { rot: [0.7, 0, 0], r: 0.004, fp: true });
}
function rightGripSocket(k, rake = RAKE, twist = 0.45) {
  // bar (hand X) along the raked grip; forearm (hand +Z) perpendicular to it, swung out to the right so the
  // cuff clears the sight line
  const X = new THREE.Vector3(0, -Math.cos(rake), Math.sin(rake));
  const Z = new THREE.Vector3(twist, Math.sin(rake), Math.cos(rake)).normalize();
  const Y = new THREE.Vector3().crossVectors(Z, X).normalize();
  k.gripSocket("rightGrip", "static", [0.0, 0.0, 0.0], [-Z.x, -Z.y, -Z.z], [Y.x, Y.y, Y.z], "trigger", "R");
}
/** Underhand L grip on a horizontal bar along Z centred at p (fingers wrap the right side). */
function handguardSocket(k, name, part, p, ud = {}) {
  // fingers wrap up the far (right) side, thumb along the near side, forearm angled back-down-left toward the shooter
  k.gripSocket(name, part, p, [0.8, 0.32, -0.5], [0.3, -0.95, 0.05], ud.pose || "grip", "L", ud);
}
/** L hand on a vertical foregrip at p (thumb on top). */
function foregripSocket(k, p, rake = 0) {
  k.gripSocket("leftGrip", "static", p, [0, -Math.sin(rake), -Math.cos(rake)], [-1, 0, 0], "grip", "L");
}
function screws(k, pts, r = 0.0055) {
  if (!k.fp) return;
  for (const [x, y, z] of pts) k.cyl("static", PAL.metalHi, [x, y, z], r, 0.004, { axis: "x", seg: 6, bevel: 0 });
}
function ejector(k, p) {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(1, 0.55, 0.3).normalize());
  k.socket("ejector", "static", p, q);
}
/** Socket looking down the sight line (-Z) from p. */
function sight(k, p) { k.socket("sight", "static", p); }
function muzzle(k, p) { k.socket("muzzle", "static", p); k.meta.muzzle = p; }

// --------------------------------------------------------------- designs

const DESIGNS = {
  benedict(k) {
    const [B, A] = PAL.benedict;
    const B2 = "#464c55", M = PAL.metal;
    // upper + lower receiver
    k.box("static", B, [0, 0.098, -0.04], [0.064, 0.072, 0.3], { r: 0.014, hero: true });
    k.box("static", B2, [0, 0.046, -0.035], [0.058, 0.05, 0.2], { r: 0.012 });
    k.box("static", B2, [0, 0.03, -0.106], [0.068, 0.04, 0.088], { r: 0.012 }); // flared magwell
    // ejection port + forward assist + screws
    k.box("static", PAL.ink, [0.032, 0.1, -0.03], [0.004, 0.024, 0.06], { seg: 0, fp: true });
    screws(k, [[0.03, 0.05, 0.02], [0.03, 0.05, -0.1]]);
    // handguard with orange stripe + vents
    k.box("static", B, [0, 0.096, -0.31], [0.074, 0.076, 0.24], { r: 0.018, hero: true });
    k.box("static", A, [0, 0.08, -0.31], [0.077, 0.016, 0.21], { r: 0.006, seg: k.fp ? 1 : 0 });
    if (k.fp) for (const z of [-0.25, -0.31, -0.37]) for (const x of [-0.038, 0.038]) k.box("static", PAL.ink, [x, 0.108, z], [0.003, 0.016, 0.034], { seg: 0 });
    k.box("static", M, [0, 0.137, -0.31], [0.03, 0.01, 0.2], { r: 0.003, seg: 0 });
    // barrel + 3-port muzzle brake
    k.cyl("static", M, [0, 0.1, -0.47], 0.015, 0.1, { bevel: 0 });
    k.cyl("static", M, [0, 0.1, -0.52], 0.026, 0.078, { bevel: 0.006, seg: k.fp ? 16 : 8 });
    if (k.fp) for (const z of [-0.502, -0.52, -0.538]) k.cyl("static", PAL.ink, [0, 0.1, z], 0.0268, 0.007, { bevel: 0, seg: 16, caps: [false, false] });
    k.cyl("static", A, [0, 0.1, -0.441], 0.021, 0.018, { bevel: 0.004 }); // orange gas block ring
    muzzle(k, [0, 0.1, -0.562]);
    // carry rail + teeth
    k.box("static", M, [0, 0.141, -0.07], [0.034, 0.014, 0.24], { r: 0.004 });
    if (k.fp) for (let i = 0; i < 9; i++) k.box("static", "#1f2126", [0, 0.149, 0.04 - i * 0.026], [0.036, 0.005, 0.01], { seg: 0 });
    // yolk red-dot: base, hood ring (look through), floating emissive dot, yolk knob on top
    k.box("static", M, [0, 0.157, -0.06], [0.034, 0.018, 0.07], { r: 0.006 });
    k.ring("static", B, [0, 0.19, -0.06], 0.029, 0.022, 0.06, { seg: k.fp ? 16 : 8 });
    k.sph("static", PAL.yolkHot, [0, 0.19, -0.09], [0.0042, 0.0042, 0.0042], { glow: 1, ws: 8, hs: 6, fp: true });
    k.sph("static", A, [0, 0.222, -0.06], [0.012, 0.009, 0.016], {});
    k.cyl("static", A, [0.03, 0.19, -0.06], 0.008, 0.01, { axis: "x", fp: true });
    sight(k, [0, 0.19, -0.02]);
    // stock with orange cheek pad + rubber butt pad
    k.cyl("static", M, [0, 0.098, 0.09], 0.017, 0.07, {});
    k.box("static", B, [0, 0.088, 0.165], [0.054, 0.09, 0.17], { r: 0.016 });
    k.box("static", A, [0, 0.128, 0.165], [0.05, 0.016, 0.14], { r: 0.006 });
    k.box("static", PAL.rubber, [0, 0.084, 0.255], [0.058, 0.104, 0.02], { r: 0.008 });
    // pistol grip + trigger
    pistolGrip(k, "#2c3036");
    triggerGroup(k);
    rightGripSocket(k);
    handguardSocket(k, "leftGrip", "static", [-0.012, 0.072, -0.33]);
    // charging handle (bolt part): T-handle at the top rear, pulled straight back
    k.pivot("bolt", [0, 0.127, 0.11]);
    k.box("bolt", M, [0, 0.127, 0.098], [0.016, 0.012, 0.03], { r: 0.004 });
    k.box("bolt", A, [0, 0.127, 0.118], [0.064, 0.014, 0.016], { r: 0.006 });
    k.travel.bolt = { axis: [0, 0, 1], dist: 0.05 };
    k.pinchSocket("chargeGrip", "bolt", [-0.03, 0.127, 0.118], [0.35, -0.55, -0.75], [-0.4, 0.8, -0.3], "L");
    // curved banana mag (part): origin at the mag top
    k.pivot("mag", [0, 0.02, -0.106]);
    k.box("mag", "#2c3036", [0, -0.012, -0.106], [0.05, 0.072, 0.078], { r: 0.012 });
    k.box("mag", "#2c3036", [0, -0.074, -0.118], [0.05, 0.068, 0.078], { r: 0.012, rot: [0.22, 0, 0] });
    k.box("mag", "#2c3036", [0, -0.132, -0.142], [0.05, 0.064, 0.078], { r: 0.012, rot: [0.44, 0, 0] });
    k.box("mag", A, [0, -0.168, -0.162], [0.058, 0.018, 0.088], { r: 0.007, rot: [0.5, 0, 0] });
    if (k.fp) for (const [y, z, a] of [[-0.012, -0.106, 0], [-0.074, -0.118, 0.22], [-0.132, -0.142, 0.44]]) {
      k.box("mag", "#40454d", [0, y, z], [0.053, 0.05, 0.012], { r: 0.003, seg: 0, rot: [a, 0, 0] });
    }
    k.travel.mag = { axis: [0, -1, 0.15], dist: 0.16 };
    k.pinchSocket("magGrip", "mag", [-0.026, -0.085, -0.13], [0.0, 0.75, -0.66], [-1, 0, 0], "L");
    k.socket("magWell", "static", [0, 0.02, -0.106]);
    ejector(k, [0.034, 0.1, -0.03]);
  },

  frittata(k) {
    const [Y, C] = PAL.frittata;
    const Ylt = "#f7d064", M = PAL.metal;
    // flat wide omelette body: yellow top half folded over a charcoal underside
    k.box("static", Y, [0, 0.092, -0.04], [0.086, 0.07, 0.46], { r: 0.03, hero: true });
    k.box("static", C, [0, 0.05, -0.02], [0.08, 0.05, 0.42], { r: 0.022, hero: true });
    k.box("static", Ylt, [0, 0.128, -0.06], [0.06, 0.008, 0.34], { r: 0.004, fp: true });
    // omelette fold seam + toasted spots
    k.box("static", "#e0a52a", [0, 0.066, -0.04], [0.089, 0.01, 0.44], { r: 0.004 });
    if (k.fp) for (const [x, z, r] of [[0.012, 0.08, 0.016], [-0.016, -0.06, 0.012], [0.01, -0.17, 0.014], [-0.02, 0.15, 0.01]]) {
      k.sph("static", "#e3a52e", [x, 0.1265, z], [r, 0.002, r * 1.3], { ws: 8, hs: 3 });
    }
    // butt (bullpup) + pad
    k.box("static", PAL.rubber, [0, 0.075, 0.2], [0.07, 0.11, 0.03], { r: 0.012 });
    // shroud, barrel, muzzle
    k.box("static", C, [0, 0.096, -0.33], [0.06, 0.06, 0.12], { r: 0.016 });
    k.cyl("static", M, [0, 0.1, -0.42], 0.016, 0.07, { bevel: 0 });
    k.cyl("static", C, [0, 0.1, -0.47], 0.024, 0.06, { bevel: 0.006 });
    k.cyl("static", Y, [0, 0.1, -0.5], 0.026, 0.014, { bevel: 0.004, fp: true });
    muzzle(k, [0, 0.1, -0.508]);
    // holographic sight: frame posts + thin emissive ring + glass (part)
    k.box("static", C, [0, 0.14, -0.09], [0.05, 0.016, 0.08], { r: 0.006 });
    k.box("static", C, [0.027, 0.178, -0.11], [0.01, 0.07, 0.03], { r: 0.004 });
    k.box("static", C, [-0.027, 0.178, -0.11], [0.01, 0.07, 0.03], { r: 0.004 });
    k.box("static", C, [0, 0.214, -0.11], [0.064, 0.01, 0.034], { r: 0.004 });
    const ring = torus(0.012, 0.0013, 4, 24);
    k.geo("static", PAL.yolkHot, ring, trs([0, 0.18, -0.11]), { glow: 1, fp: true });
    k.sph("static", PAL.yolkHot, [0, 0.18, -0.11], [0.0022, 0.0022, 0.0022], { glow: 1, ws: 6, hs: 4, fp: true });
    k.pivot("sightGlass", [0, 0.18, -0.105]);
    k.box("sightGlass", "#9fe8ff", [0, 0.178, -0.105], [0.044, 0.062, 0.003], { r: 0.001, seg: 0 });
    sight(k, [0, 0.18, -0.03]);
    // grip + trigger forward of the mag (bullpup)
    pistolGrip(k, C);
    triggerGroup(k, M, -0.043, C);
    rightGripSocket(k);
    handguardSocket(k, "leftGrip", "static", [-0.016, 0.03, -0.24]);
    // side charging knob on the left front, slides back
    k.pivot("bolt", [-0.046, 0.1, -0.17]);
    k.box("bolt", C, [-0.046, 0.1, -0.17], [0.012, 0.016, 0.034], { r: 0.005 });
    k.sph("bolt", Y, [-0.056, 0.1, -0.17], [0.01, 0.01, 0.01], {});
    k.travel.bolt = { axis: [0, 0, 1], dist: 0.06 };
    k.pinchSocket("chargeGrip", "bolt", [-0.058, 0.1, -0.17], [0.3, 0.2, -0.93], [-0.9, 0.3, 0], "L");
    // short straight mag behind the grip
    k.pivot("mag", [0, 0.03, 0.095]);
    k.box("mag", C, [0, -0.02, 0.095], [0.048, 0.1, 0.068], { r: 0.012 });
    k.box("mag", Y, [0, -0.074, 0.095], [0.054, 0.016, 0.076], { r: 0.007 });
    k.travel.mag = { axis: [0, -1, 0.05], dist: 0.16 };
    k.pinchSocket("magGrip", "mag", [-0.025, -0.045, 0.075], [0.0, 0.7, -0.7], [-1, 0, 0], "L");
    k.socket("magWell", "static", [0, 0.03, 0.095]);
    ejector(k, [0.044, 0.095, 0.02]);
  },

  poacher(k) {
    const [T, Cr] = PAL.poacher;
    const T2 = "#267670", M = PAL.metal;
    // receiver
    k.box("static", T, [0, 0.092, -0.08], [0.06, 0.076, 0.32], { r: 0.016, hero: true });
    k.box("static", T2, [0, 0.046, -0.04], [0.054, 0.034, 0.17], { r: 0.01 });
    // cream front handguard + barrel nub + ring muzzle
    k.box("static", Cr, [0, 0.088, -0.28], [0.064, 0.066, 0.1], { r: 0.016 });
    if (k.fp) for (const z of [-0.255, -0.28, -0.305]) k.box("static", "#d8cfb8", [0, 0.123, z], [0.05, 0.004, 0.01], { seg: 0 });
    k.cyl("static", M, [0, 0.096, -0.355], 0.014, 0.05, { bevel: 0 });
    k.ring("static", M, [0, 0.096, -0.39], 0.022, 0.012, 0.03);
    muzzle(k, [0, 0.096, -0.405]);
    // ring sight (rear ring + front post)
    k.ring("static", M, [0, 0.152, 0.03], 0.016, 0.01, 0.01, { seg: k.fp ? 16 : 6 });
    k.box("static", M, [0, 0.135, 0.03], [0.008, 0.012, 0.01], { seg: 0 });
    k.box("static", M, [0, 0.142, -0.3], [0.006, 0.03, 0.01], { seg: 0 });
    k.sph("static", PAL.yolkHot, [0, 0.158, -0.3], [0.0035, 0.0035, 0.0035], { glow: 1, ws: 6, hs: 4, fp: true });
    sight(k, [0, 0.152, 0.036]);
    // folded wire stock along the right side
    k.tube("static", M, [[0.034, 0.11, 0.07], [0.04, 0.11, -0.05], [0.04, 0.085, -0.16]], 0.005, {});
    k.tube("static", M, [[0.034, 0.06, 0.07], [0.04, 0.06, -0.05], [0.04, 0.085, -0.16]], 0.005, {});
    k.box("static", PAL.rubber, [0.036, 0.085, 0.08], [0.012, 0.07, 0.02], { r: 0.005 });
    k.box("static", T, [0, 0.092, 0.08], [0.056, 0.07, 0.012], { r: 0.008 });
    // grip + trigger, vertical foregrip
    pistolGrip(k, T2);
    triggerGroup(k);
    rightGripSocket(k);
    k.box("static", T2, [0, 0.0, -0.245], [0.04, 0.1, 0.044], { r: 0.014, rot: [0.08, 0, 0], hero: true });
    k.box("static", Cr, [0, -0.052, -0.248], [0.046, 0.014, 0.05], { r: 0.006 });
    foregripSocket(k, [0, 0.0, -0.245], -0.08);
    // cocking tube (bolt part) along the top left with a knob at the front
    k.cyl("static", T2, [-0.024, 0.138, -0.15], 0.012, 0.22, {});
    k.pivot("bolt", [-0.034, 0.138, -0.25]);
    k.box("bolt", Cr, [-0.04, 0.138, -0.25], [0.022, 0.014, 0.014], { r: 0.005 });
    k.travel.bolt = { axis: [0, 0, 1], dist: 0.05 };
    k.pinchSocket("chargeGrip", "bolt", [-0.052, 0.138, -0.25], [0.3, -0.2, -0.93], [-0.7, 0.7, 0], "L");
    // stick mag ahead of the grip
    k.pivot("mag", [0, 0.032, -0.09]);
    k.box("mag", M, [0, -0.05, -0.095], [0.036, 0.17, 0.05], { r: 0.01, rot: [0.08, 0, 0] });
    k.box("mag", Cr, [0, -0.138, -0.102], [0.042, 0.016, 0.058], { r: 0.006, rot: [0.08, 0, 0] });
    if (k.fp) k.box("mag", "#3a3c45", [0, -0.04, -0.095], [0.039, 0.11, 0.012], { seg: 0, rot: [0.08, 0, 0] });
    k.travel.mag = { axis: [0, -1, 0.08], dist: 0.16 };
    k.pinchSocket("magGrip", "mag", [-0.02, -0.09, -0.1], [0.0, 0.8, -0.6], [-1, 0, 0], "L");
    k.socket("magWell", "static", [0, 0.032, -0.09]);
    ejector(k, [0.031, 0.1, -0.04]);
  },

  overeasy(k) {
    const [W, Y] = PAL.overeasy;
    const W2 = "#dcd8cd", M = PAL.metal;
    // receiver + handguard (white) with yolk stripe
    k.box("static", W, [0, 0.096, -0.06], [0.062, 0.08, 0.32], { r: 0.016, hero: true });
    k.box("static", W2, [0, 0.046, -0.05], [0.056, 0.04, 0.2], { r: 0.012 });
    k.box("static", W, [0, 0.096, -0.34], [0.07, 0.07, 0.24], { r: 0.02, hero: true });
    k.box("static", Y, [0, 0.096, -0.34], [0.073, 0.02, 0.22], { r: 0.008 });
    // barrel + yolk muzzle
    k.cyl("static", M, [0, 0.1, -0.52], 0.015, 0.14, { bevel: 0 });
    k.cyl("static", Y, [0, 0.1, -0.585], 0.024, 0.05, { bevel: 0.007 });
    if (k.fp) k.cyl("static", PAL.ink, [0, 0.1, -0.6], 0.0245, 0.006, { bevel: 0, seg: 16 });
    muzzle(k, [0, 0.1, -0.612]);
    // stock: white skeleton with a yolk cheek riser
    k.box("static", W, [0, 0.07, 0.16], [0.054, 0.05, 0.22], { r: 0.016 });
    k.box("static", W, [0, 0.112, 0.15], [0.05, 0.03, 0.2], { r: 0.012 });
    k.box("static", Y, [0, 0.136, 0.15], [0.046, 0.02, 0.15], { r: 0.008 });
    k.box("static", PAL.rubber, [0, 0.088, 0.27], [0.058, 0.1, 0.022], { r: 0.008 });
    // scope: tube + objective + eyepiece + rings + lens glint
    const SY = 0.19;
    k.cyl("static", M, [0, SY, -0.08], 0.022, 0.2, { bevel: 0.004 });
    k.cyl("static", M, [0, SY, -0.205], 0.034, 0.06, { r2: 0.023, bevel: 0.006, seg: k.fp ? 20 : 8 });
    k.cyl("static", M, [0, SY, 0.045], 0.026, 0.05, { r2: 0.03, bevel: 0.006 });
    k.cyl("static", Y, [0, SY, -0.225], 0.035, 0.012, { bevel: 0.003, seg: k.fp ? 20 : 8 });
    k.cyl("static", PAL.lens, [0, SY, -0.236], 0.029, 0.006, { bevel: 0, seg: 20, fp: true });
    k.sph("static", PAL.glint, [0.01, SY + 0.01, -0.239], [0.008, 0.006, 0.002], { glow: 1, ws: 8, hs: 4, fp: true });
    k.cyl("static", PAL.lens, [0, SY, 0.071], 0.024, 0.004, { bevel: 0, seg: 16, fp: true });
    for (const z of [-0.13, -0.0]) {
      k.box("static", Y, [0, SY - 0.03, z], [0.03, 0.04, 0.022], { r: 0.006 });
      k.ring("static", Y, [0, SY, z], 0.027, 0.021, 0.022, { fp: true });
    }
    k.cyl("static", Y, [0, SY + 0.03, -0.07], 0.012, 0.016, { axis: "y", fp: true });
    k.cyl("static", Y, [0.03, SY, -0.07], 0.011, 0.014, { axis: "x", fp: true });
    sight(k, [0, SY, 0.1]);
    pistolGrip(k, W2, { panel: Y });
    triggerGroup(k);
    rightGripSocket(k);
    handguardSocket(k, "leftGrip", "static", [-0.012, 0.07, -0.33]);
    // right-side charging knob (bolt part)
    k.pivot("bolt", [0.034, 0.105, 0.0]);
    k.box("bolt", M, [0.04, 0.105, 0.0], [0.016, 0.012, 0.016], { r: 0.004 });
    k.sph("bolt", Y, [0.052, 0.105, 0.0], [0.011, 0.011, 0.011], {});
    k.travel.bolt = { axis: [0, 0, 1], dist: 0.05 };
    k.pinchSocket("chargeGrip", "bolt", [0.056, 0.105, 0.0], [-0.3, -0.2, -0.93], [0.9, 0.3, 0], "L");
    ejector(k, [0.032, 0.105, -0.05]);
    // box mag
    k.pivot("mag", [0, 0.028, -0.105]);
    k.box("mag", "#33343b", [0, -0.024, -0.108], [0.048, 0.1, 0.076], { r: 0.012, rot: [0.1, 0, 0] });
    k.box("mag", Y, [0, -0.078, -0.114], [0.054, 0.016, 0.084], { r: 0.007, rot: [0.1, 0, 0] });
    k.travel.mag = { axis: [0, -1, 0.12], dist: 0.16 };
    k.pinchSocket("magGrip", "mag", [-0.025, -0.05, -0.12], [0.0, 0.75, -0.66], [-1, 0, 0], "L");
    k.socket("magWell", "static", [0, 0.028, -0.105]);
  },

  piercer(k) {
    const [O, K] = PAL.piercer;
    const O2 = "#6b7f4f", M = PAL.metal;
    // chunky thumbhole stock + fore-end in olive
    k.box("static", O, [0, 0.06, 0.16], [0.058, 0.1, 0.24], { r: 0.022, hero: true });
    k.box("static", O2, [0, 0.12, 0.17], [0.05, 0.03, 0.18], { r: 0.012 });
    k.box("static", K, [0, 0.06, 0.29], [0.062, 0.12, 0.024], { r: 0.008 });
    k.box("static", O, [0, 0.05, -0.04], [0.06, 0.06, 0.16], { r: 0.016 });
    k.box("static", O, [0, 0.07, -0.29], [0.062, 0.05, 0.36], { r: 0.018 });
    if (k.fp) for (const z of [-0.2, -0.26, -0.32, -0.38]) k.box("static", O2, [0, 0.045, z], [0.064, 0.008, 0.03], { seg: 0 });
    // round receiver + heavy barrel + muzzle can
    k.cyl("static", K, [0, 0.105, -0.06], 0.03, 0.26, { bevel: 0.008, seg: k.fp ? 18 : 8 });
    k.cyl("static", M, [0, 0.105, -0.44], 0.019, 0.36, { r2: 0.022, bevel: 0 });
    k.cyl("static", K, [0, 0.105, -0.68], 0.032, 0.14, { bevel: 0.01, seg: k.fp ? 18 : 8 });
    if (k.fp) for (const z of [-0.64, -0.68, -0.72]) k.cyl("static", O, [0, 0.105, z], 0.0325, 0.01, { bevel: 0, seg: 16, caps: [false, false] });
    muzzle(k, [0, 0.105, -0.752]);
    // giant scope with lens caps flipped up
    const SY = 0.205;
    k.cyl("static", K, [0, SY, -0.06], 0.026, 0.26, { bevel: 0.004 });
    k.cyl("static", K, [0, SY, -0.235], 0.046, 0.1, { r2: 0.027, bevel: 0.008, seg: k.fp ? 18 : 8 });
    k.cyl("static", K, [0, SY, 0.1], 0.03, 0.07, { r2: 0.036, bevel: 0.008, seg: k.fp ? 18 : 8 });
    k.cyl("static", O, [0, SY, -0.28], 0.047, 0.014, { bevel: 0.004, seg: k.fp ? 18 : 8 });
    k.cyl("static", PAL.lens, [0, SY, -0.286], 0.04, 0.006, { bevel: 0, seg: 18, fp: true, caps: [true, false] });
    k.sph("static", PAL.glint, [0.014, SY + 0.016, -0.29], [0.011, 0.007, 0.002], { glow: 1, ws: 8, hs: 4, fp: true });
    // flip-up caps, hinged on the top edge of each bell and swung open past vertical (raised CAP_E above the scope line)
    const CAP_E = 0.8;
    const cap = (lensZ, bellR, capR, dir) => {
      const hy = SY + bellR + 0.002;
      k.box("static", O2, [0, hy + 0.002, lensZ], [0.014, 0.008, 0.012], { r: 0.002, seg: 0 });
      k.cyl("static", O, [0, hy + Math.sin(CAP_E) * capR, lensZ + dir * Math.cos(CAP_E) * capR], capR, 0.01,
        { rot: [dir * (Math.PI / 2 - CAP_E), 0, 0], bevel: 0, seg: k.fp ? 16 : 6 });
    };
    cap(-0.288, 0.047, 0.046, -1);
    cap(0.137, 0.036, 0.036, 1);
    k.cyl("static", PAL.lens, [0, SY, 0.137], 0.03, 0.004, { bevel: 0, seg: 16, fp: true });
    // turrets + rings
    k.cyl("static", O, [0, SY + 0.04, -0.06], 0.017, 0.03, { axis: "y" });
    k.cyl("static", O, [0.04, SY, -0.06], 0.016, 0.028, { axis: "x" });
    if (k.fp) k.cyl("static", K, [0, SY + 0.056, -0.06], 0.0175, 0.004, { axis: "y", bevel: 0 });
    for (const z of [-0.14, 0.03]) k.box("static", K, [0, (SY + 0.105) / 2 + 0.01, z], [0.034, SY - 0.105 - 0.01, 0.024], { r: 0.006 });
    sight(k, [0, SY, 0.17]);
    // folded bipod under the fore-end
    for (const x of [-0.016, 0.016]) k.cyl("static", M, [x, 0.035, -0.37], 0.006, 0.16, { bevel: 0, seg: 8 });
    k.box("static", M, [0, 0.042, -0.45], [0.044, 0.016, 0.026], { r: 0.005 });
    // grip + trigger
    pistolGrip(k, O2, { rake: 0.32 });
    triggerGroup(k, M, -0.043, K);
    rightGripSocket(k, 0.32);
    handguardSocket(k, "leftGrip", "static", [-0.012, 0.045, -0.3]);
    // bolt (part): axis along the receiver, handle out to the right with a big ball knob
    k.pivot("bolt", [0, 0.105, 0.05]);
    k.cyl("bolt", M, [0, 0.105, 0.05], 0.018, 0.08, { bevel: 0.004 });
    k.tube("bolt", M, [[0.01, 0.105, 0.075], [0.04, 0.098, 0.08], [0.066, 0.082, 0.085]], 0.0065, {});
    k.sph("bolt", K, [0.072, 0.078, 0.086], [0.017, 0.017, 0.017], {});
    k.travel.bolt = { axis: [0, 0, 1], dist: 0.075, lift: 1.05 };
    k.pinchSocket("chargeGrip", "bolt", [0.072, 0.078, 0.086], [-0.4, 0.3, -0.87], [0.8, 0.5, 0.2], "R");
    // stripper clip with 4 rounds (hidden template), origin at its centre
    k.pivot("clip", [0, 0.16, 0.0]);
    k.box("clip", M, [0, 0.16 + 0.03, 0], [0.012, 0.006, 0.06], { r: 0.002, seg: 0 });
    for (let i = 0; i < 4; i++) {
      const z = -0.021 + i * 0.014;
      k.cyl("clip", PAL.brass, [0, 0.16 + 0.003, z], 0.0062, 0.05, { axis: "y", seg: 8, bevel: 0 });
      k.cyl("clip", "#b0702e", [0, 0.16 - 0.03, z], 0.0035, 0.012, { axis: "y", seg: 6, r2: 0.0062, bevel: 0 });
    }
    k.socket("loadPort", "static", [0, 0.142, 0.03], new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
    ejector(k, [0.032, 0.11, 0.02]);
  },

  deviler(k) {
    const [R, Wd] = PAL.deviler;
    const Rd = "#93331f", Wdk = PAL.woodDark, M = PAL.metal;
    // receiver
    k.box("static", R, [0, 0.086, -0.03], [0.066, 0.092, 0.2], { r: 0.018, hero: true });
    k.box("static", Rd, [0, 0.047, -0.04], [0.062, 0.03, 0.16], { r: 0.01 });
    if (k.fp) {
      // devil flame decal stripes on the receiver
      k.box("static", PAL.yolk, [0.0335, 0.098, -0.03], [0.002, 0.012, 0.13], { seg: 0 });
      k.box("static", PAL.yolk, [-0.0335, 0.098, -0.03], [0.002, 0.012, 0.13], { seg: 0 });
    }
    screws(k, [[0.034, 0.07, 0.03], [-0.034, 0.07, 0.03], [0.034, 0.07, -0.09], [-0.034, 0.07, -0.09]]);
    // fat barrel over the tube magazine, clamp ring, brass bead
    k.cyl("static", M, [0, 0.112, -0.37], 0.025, 0.5, { bevel: 0.006, seg: k.fp ? 18 : 8 });
    k.cyl("static", M, [0, 0.065, -0.33], 0.019, 0.42, { bevel: 0.005 });
    k.box("static", R, [0, 0.09, -0.57], [0.056, 0.076, 0.03], { r: 0.012 });
    if (k.fp) k.cyl("static", PAL.ink, [0, 0.112, -0.62], 0.0255, 0.004, { bevel: 0, seg: 18 });
    k.sph("static", PAL.brass, [0, 0.142, -0.6], [0.009, 0.009, 0.009], {});
    k.box("static", M, [0, 0.14, -0.05], [0.012, 0.012, 0.03], { r: 0.003, seg: 0 });
    muzzle(k, [0, 0.112, -0.622]);
    sight(k, [0, 0.152, 0.04]);
    // wooden stock with a drop at the heel
    k.box("static", Wd, [0, 0.07, 0.16], [0.054, 0.08, 0.22], { r: 0.022, rot: [0.12, 0, 0], hero: true });
    k.box("static", Wd, [0, 0.07, 0.06], [0.05, 0.07, 0.06], { r: 0.016 });
    k.box("static", PAL.rubber, [0, 0.056, 0.272], [0.058, 0.104, 0.02], { r: 0.008, rot: [0.12, 0, 0] });
    k.box("static", Wdk, [0, 0.106 - 0.004, 0.16], [0.056, 0.008, 0.2], { r: 0.003, rot: [0.12, 0, 0] });
    // wooden pistol grip
    pistolGrip(k, Wd, { base: Wdk });
    triggerGroup(k);
    rightGripSocket(k);
    // grooved wooden pump (part) around the tube mag
    k.pivot("pump", [0, 0.065, -0.3]);
    k.box("pump", Wd, [0, 0.065, -0.3], [0.062, 0.058, 0.17], { r: 0.022, hero: true });
    if (k.fp) for (let i = 0; i < 6; i++) k.box("pump", Wdk, [0, 0.065, -0.245 - i * 0.022], [0.0635, 0.0595, 0.006], { r: 0.0225, bar: true });
    k.travel.pump = { axis: [0, 0, 1], dist: 0.09 };
    handguardSocket(k, "leftGrip", "pump", [-0.012, 0.05, -0.3]);
    handguardSocket(k, "chargeGrip", "pump", [-0.012, 0.05, -0.3]);
    // loading gate under the receiver; the shell is pushed up + forward into the tube
    k.box("static", PAL.ink, [0, 0.03, -0.05], [0.03, 0.004, 0.07], { seg: 0, fp: true });
    k.socket("loadPort", "static", [0, 0.03, -0.03], aimQuat([0, 0.45, -0.89], [0, 0.89, 0.45]));
    // shell (hidden template): red hull + brass head, along Z, origin at its centre
    k.pivot("shell", [0, -0.05, 0.0]);
    k.cyl("shell", "#d6352a", [0, -0.05, -0.006], 0.0118, 0.048, { bevel: 0.002, seg: 12 });
    k.cyl("shell", PAL.brass, [0, -0.05, 0.024], 0.0124, 0.014, { bevel: 0.002, seg: 12 });
    ejector(k, [0.034, 0.095, -0.03]);
  },

  souffle(k) {
    const [Mg, G] = PAL.souffle;
    const Mg2 = "#8f3f6c", M = PAL.metal;
    const TY = 0.165;
    // launch tube (magenta), rear flare with hazard stripes
    k.ring("static", Mg, [0, TY, -0.07], 0.07, 0.061, 0.74, { seg: k.fp ? 24 : 10 });
    // dark liner inside the tube (inward-facing), so the bore reads as a deep hole from behind
    if (k.fp) k.geo("static", PAL.ink, latheN([[0.0602, 0.33, -1, 0], [0.0602, -0.37, -1, 0]], 20), trs([0, TY, -0.07], [Math.PI / 2, 0, 0]));
    k.cyl("static", PAL.ink, [0, TY, 0.24], 0.062, 0.01, { bevel: 0, seg: k.fp ? 16 : 6 });
    k.cyl("static", PAL.ink, [0, TY, -0.3], 0.062, 0.01, { bevel: 0, seg: 16, fp: true });
    k.cyl("static", Mg2, [0, TY, 0.33], 0.072, 0.08, { r2: 0.09, bevel: 0, seg: k.fp ? 24 : 10, caps: [false, false] });
    for (let i = 0; i < (k.fp ? 4 : 1); i++) {
      const z = 0.3 + i * 0.022;
      k.cyl("static", i % 2 ? PAL.ink : G, [0, TY, z], 0.074 + i * 0.005, 0.012, { r2: 0.078 + i * 0.005, bevel: 0, seg: k.fp ? 24 : 10, caps: [false, false] });
    }
    k.ring("static", G, [0, TY, 0.375], 0.092, 0.08, 0.016, { seg: k.fp ? 24 : 10 });
    // fluted ramekin muzzle rim (gold)
    if (k.fp) k.geo("static", G, flutedCyl(0.08, 0.06, 16, 0.006, 64, 1), trs([0, TY, -0.47], [Math.PI / 2, 0, 0]));
    else k.cyl("static", G, [0, TY, -0.47], 0.083, 0.06, { caps: [false, false] });
    if (k.fp) k.geo("static", G, wavyTorus(0.078, 0.012, 16, 0.003, 4, 48), trs([0, TY, -0.5], [Math.PI / 2, 0, 0]));
    k.ring("static", "#e8b830", [0, TY, -0.44], 0.084, 0.07, 0.008, { seg: k.fp ? 24 : 10 });
    // body bands + trigger housing under the tube
    k.cyl("static", G, [0, TY, -0.25], 0.073, 0.03, { bevel: 0.006, seg: k.fp ? 24 : 10 });
    k.cyl("static", G, [0, TY, 0.12], 0.073, 0.03, { bevel: 0.006, seg: k.fp ? 24 : 10 });
    k.box("static", Mg2, [0, 0.075, -0.02], [0.05, 0.07, 0.17], { r: 0.014 });
    // flip-up frame sight on the left + rear peep
    k.box("static", M, [-0.07, 0.205, -0.12], [0.024, 0.012, 0.04], { r: 0.004 });
    k.box("static", G, [-0.078, 0.258, -0.12], [0.006, 0.1, 0.006], { r: 0.002, seg: 0 });
    k.box("static", G, [-0.042, 0.258, -0.12], [0.006, 0.1, 0.006], { r: 0.002, seg: 0 });
    k.box("static", G, [-0.06, 0.306, -0.12], [0.042, 0.006, 0.006], { r: 0.002, seg: 0 });
    k.box("static", G, [-0.06, 0.212, -0.12], [0.042, 0.006, 0.006], { r: 0.002, seg: 0 });
    k.box("static", G, [-0.06, 0.244, -0.12], [0.03, 0.002, 0.004], { seg: 0, fp: true });
    k.box("static", G, [-0.06, 0.26, -0.12], [0.002, 0.06, 0.004], { seg: 0, fp: true });
    k.box("static", M, [-0.07, 0.225, 0.1], [0.02, 0.04, 0.012], { r: 0.004 });
    k.ring("static", M, [-0.06, 0.258, 0.1], 0.012, 0.006, 0.008, { seg: 12 });
    sight(k, [-0.06, 0.258, 0.16]);
    // grips
    pistolGrip(k, Mg2);
    triggerGroup(k, M, -0.043, M, { gy: 0.0 });
    rightGripSocket(k);
    k.box("static", Mg2, [0, 0.03, -0.27], [0.04, 0.1, 0.044], { r: 0.014, rot: [0.1, 0, 0], hero: true });
    k.box("static", G, [0, -0.022, -0.274], [0.046, 0.014, 0.05], { r: 0.006 });
    foregripSocket(k, [0, 0.025, -0.27], -0.1);
    // rocket (visible when loaded): warhead pokes out of the ramekin
    k.pivot("rocket", [0, TY, -0.36]);
    if (k.fp) k.geo("rocket", null, rocketGeometry("tp"), trs([0, TY, -0.36]));
    else k.sph("rocket", "#eab04c", [0, TY, -0.56], [0.06, 0.06, 0.07], {});
    k.travel.rocket = { axis: [0, 0, -1], dist: 0.28 };
    k.socket("loadPort", "static", [0, TY, -0.5]);
    k.socket("tubeBack", "static", [0, TY, 0.38], new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
    muzzle(k, [0, TY, -0.62]);
  },

  coddler(k) {
    const [S, Bn] = PAL.coddler;
    const S2 = "#4a505c", M = PAL.metal;
    // slide (part) with serrations + 3-dot sights
    k.pivot("slide", [0, 0.078, -0.07]);
    k.box("slide", S, [0, 0.078, -0.07], [0.05, 0.052, 0.24], { r: 0.014, hero: true });
    if (k.fp) for (let i = 0; i < 5; i++) k.box("slide", S2, [0, 0.082, 0.03 - i * 0.011], [0.052, 0.034, 0.004], { seg: 0 });
    k.box("slide", M, [0, 0.11, -0.18], [0.008, 0.014, 0.012], { r: 0.003, seg: 0 });
    for (const x of [-0.0105, 0.0105]) k.box("slide", M, [x, 0.111, 0.035], [0.01, 0.016, 0.012], { r: 0.003, seg: 0 });
    k.sph("slide", "#ffffff", [0, 0.115, -0.187], [0.003, 0.003, 0.002], { glow: 1, ws: 6, hs: 4, fp: true });
    k.sph("slide", "#ffffff", [-0.0105, 0.115, 0.028], [0.003, 0.003, 0.002], { glow: 1, ws: 6, hs: 4, fp: true });
    k.sph("slide", "#ffffff", [0.0105, 0.115, 0.028], [0.003, 0.003, 0.002], { glow: 1, ws: 6, hs: 4, fp: true });
    k.cyl("slide", PAL.ink, [0, 0.078, -0.191], 0.011, 0.004, { bevel: 0, seg: 12, fp: true });
    k.box("slide", PAL.ink, [0.025, 0.088, -0.05], [0.002, 0.018, 0.04], { seg: 0, fp: true });
    k.travel.slide = { axis: [0, 0, 1], dist: 0.045 };
    k.pinchSocket("chargeGrip", "slide", [-0.026, 0.085, 0.02], [0.35, -0.6, -0.72], [-0.6, 0.6, 0.2], "L");
    // frame (bone accents), dust cover, oversized hammer
    k.box("static", S2, [0, 0.038, -0.07], [0.044, 0.034, 0.2], { r: 0.01 });
    k.box("static", Bn, [0, 0.03, -0.14], [0.046, 0.014, 0.06], { r: 0.005 });
    k.box("static", M, [0, 0.082, 0.07], [0.016, 0.022, 0.024], { r: 0.005, rot: [-0.7, 0, 0] });
    k.sph("static", M, [0, 0.088, 0.088], [0.012, 0.007, 0.014], { rot: [-0.3, 0, 0] });
    // chunky grip with bone panels
    pistolGrip(k, S2, { panel: Bn, rake: 0.2, h: 0.112, d: 0.054, noGrooves: true });
    triggerGroup(k, M, -0.04, S2, { gy: 0.004 });
    rightGripSocket(k, 0.2);
    // support hand cups under the firing hand
    k.gripSocket("leftGrip", "static", [-0.028, -0.052, 0.004], [0.62, 0.15, -0.77], [-0.45, -0.89, 0.05], "cup", "L");
    // mag (part): mostly inside the grip, floor plate visible
    k.pivot("mag", [0, 0.03, 0.002]);
    k.box("mag", M, [0, -0.025, 0.012], [0.032, 0.1, 0.044], { r: 0.008, rot: [-0.2, 0, 0], seg: 0 });
    k.box("mag", Bn, [0, -0.082, 0.024], [0.048, 0.014, 0.06], { r: 0.006, rot: [-0.2, 0, 0] });
    k.travel.mag = { axis: [0, -1, 0.2], dist: 0.12 };
    k.pinchSocket("magGrip", "mag", [-0.022, -0.082, 0.03], [0.05, 0.85, -0.5], [-1, 0, 0], "L");
    k.socket("magWell", "static", [0, 0.03, 0.002]);
    muzzle(k, [0, 0.078, -0.195]);
    sight(k, [0, 0.117, 0.05]);
    ejector(k, [0.026, 0.09, -0.05]);
  },
};

// --------------------------------------------------------------- templates + instances

const templates = new Map();
function template(id, lod) {
  const key = `${id}:${lod}`;
  let t = templates.get(key);
  if (t) return t;
  const k = new Kit(lod);
  (DESIGNS[id] || DESIGNS.benedict)(k);
  const geos = {};
  for (const part of k.B.parts()) {
    const g = k.B.merge(part);
    const pv = part === "static" ? null : k.pivots[part] || [0, 0, 0];
    if (pv) g.translate(-pv[0], -pv[1], -pv[2]);
    g.computeBoundingSphere();
    geos[part] = g;
  }
  t = { id, lod, geos, pivots: k.pivots, sockets: k.sockets, travel: k.travel, muzzle: k.meta.muzzle || [0, 0.1, -0.5] };
  templates.set(key, t);
  return t;
}

let glassMat = null;
function sightGlassMaterial() {
  if (!glassMat) glassMat = toonMaterial("#bdf3ff", { transparent: true, opacity: 0.22, rim: 0.6, rimColor: "#9fe8ff" });
  return glassMat;
}

/**
 * Build a gun instance (new Object3Ds sharing cached geometry/materials).
 * Returns GunModel {id, lod, group, muzzle, sockets, parts, travel, stats, dispose()}.
 */
export function buildGun(id, opts = {}) {
  const lod = opts.lod === "tp" ? "tp" : "fp";
  if (!DESIGNS[id]) id = "benedict";
  const t = template(id, lod);
  const group = new THREE.Group();
  group.name = `gun:${id}:${lod}`;
  const parts = {};
  const meshes = [];
  for (const part of Object.keys(t.geos)) {
    const mat = part === "sightGlass" ? sightGlassMaterial() : fxMaterial();
    const mesh = new THREE.Mesh(t.geos[part], mat);
    mesh.castShadow = lod === "tp" && part !== "sightGlass";
    mesh.name = part;
    if (part === "static") { group.add(mesh); meshes.push([part, mesh]); continue; }
    const holder = new THREE.Group();
    holder.name = part;
    holder.position.fromArray(t.pivots[part] || [0, 0, 0]);
    holder.add(mesh);
    holder.userData.rest = { position: holder.position.clone(), quaternion: holder.quaternion.clone() };
    if (HIDDEN.has(part)) holder.visible = false;
    group.add(holder);
    parts[part] = holder;
    meshes.push([part, mesh]);
  }
  if (lod === "fp") for (const [part, mesh] of meshes) if (!NO_OUTLINE.has(part)) addOutline(mesh, { width: 0.0045 });
  const sockets = {};
  for (const s of t.sockets) {
    const o = new THREE.Object3D();
    o.name = s.name;
    let parent = group, pv = [0, 0, 0];
    if (s.part !== "static" && parts[s.part]) { parent = parts[s.part]; pv = t.pivots[s.part] || pv; }
    o.position.set(s.p[0] - pv[0], s.p[1] - pv[1], s.p[2] - pv[2]);
    o.quaternion.copy(s.q);
    Object.assign(o.userData, s.ud);
    parent.add(o);
    sockets[s.name] = o;
  }
  const stats = modelStats(group);
  const model = {
    id, lod, group, sockets, parts,
    muzzle: sockets.muzzle ? sockets.muzzle.position.clone() : new THREE.Vector3(...t.muzzle),
    travel: JSON.parse(JSON.stringify(t.travel)),
    stats,
    dispose() { group.removeFromParent(); },
  };
  group.userData.gun = model;
  return model;
}

/** Template info without building an instance (budget tests). */
export function gunTemplateStats(id, lod) {
  const t = template(id, lod);
  let tris = 0, drawCalls = 0;
  for (const [part, g] of Object.entries(t.geos)) {
    if (HIDDEN.has(part)) continue;
    tris += g.index.count / 3;
    drawCalls++;
  }
  return { tris, drawCalls };
}
