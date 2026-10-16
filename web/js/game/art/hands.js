// Cartoon gloved hands (floating, Rayman style: eggs have no arms).
// FP: one SkinnedMesh with 16 bones and rigid weights (wrist, 4 finger chains x 3, thumb x 3; the
// 4th "pinky-ring" chain carries no geometry: classic 3-finger cartoon glove), poses are joint-angle
// tables blended per bone with slerp. TP: three baked low-poly variants (grip / open / fist) swapped
// on one mesh.
//
// Hand frame (both LODs): origin = grip centre. In "grip" the fist closes around a 0.022 m bar along
// local X through the origin. "open": fingers point -Z, back of the hand faces +Y, R thumb toward -X,
// L thumb toward +X. Points: hold (grip centre), pinch (thumb/index meeting point), palm (palm centre,
// facing -Y).

import * as THREE from "../../../vendor/three.module.min.js";
import { MeshBuilder, capsule, roundedBox, roundedBar, torus, latheN, ellipsoid, tube, paint, trs, cachedGeo } from "./geom.js";
import { fxMaterial, addOutline, PAL } from "./toon.js";

export const HAND_POSES = ["open", "grip", "trigger", "pinch", "point", "fist", "cup", "palm"];

const PY = 0.05, PZ = 0.014; // palm centre (R hand)
const PALM = [0.1, 0.05, 0.088];
const FR = 0.0145; // finger radius

// Bone table for the RIGHT hand. pos is relative to the parent bone; rest = euler (XYZ) of the rest pose.
// Fingers: index (-X, toward the thumb), middle, ring, and the geometry-less pinky-ring chain.
const FINGERS = [
  { x: -0.032, z: -0.022, len: [0.031, 0.024, 0.02], spread: 0.07 },
  { x: 0.0, z: -0.026, len: [0.034, 0.026, 0.021], spread: 0.0 },
  { x: 0.032, z: -0.022, len: [0.03, 0.023, 0.019], spread: -0.07 },
  { x: 0.047, z: -0.012, len: [0.02, 0.016, 0.014], spread: -0.12, ghost: true },
];
const THUMB = { pos: [-0.046, 0.036, 0.02], rest: [-0.25, 0.75, 0.35], len: [0.03, 0.025, 0.021], r: 0.0165 };

function boneDefs() {
  const defs = [{ name: "wrist", parent: -1, pos: [0, 0, 0], rest: [0, 0, 0] }];
  FINGERS.forEach((f, i) => {
    const a = defs.length;
    defs.push({ name: `f${i}a`, parent: 0, pos: [f.x, PY - 0.008, f.z], rest: [0, f.spread, 0], len: f.len[0], r0: FR + 0.0005, r1: FR, ghost: f.ghost, seg: 0 });
    defs.push({ name: `f${i}b`, parent: a, pos: [0, 0, -f.len[0]], rest: [0, 0, 0], len: f.len[1], r0: FR, r1: FR - 0.0005, ghost: f.ghost, seg: 1 });
    defs.push({ name: `f${i}c`, parent: a + 1, pos: [0, 0, -f.len[1]], rest: [0, 0, 0], len: f.len[2], r0: FR - 0.0005, r1: FR - 0.001, ghost: f.ghost, seg: 2 });
  });
  const t = defs.length;
  defs.push({ name: "t0", parent: 0, pos: THUMB.pos, rest: THUMB.rest, len: THUMB.len[0], r0: THUMB.r + 0.002, r1: THUMB.r, seg: 0 });
  defs.push({ name: "t1", parent: t, pos: [0, 0, -THUMB.len[0]], rest: [0, 0, 0], len: THUMB.len[1], r0: THUMB.r, r1: THUMB.r - 0.001, seg: 1 });
  defs.push({ name: "t2", parent: t + 1, pos: [0, 0, -THUMB.len[1]], rest: [0, 0, 0], len: THUMB.len[2], r0: THUMB.r - 0.001, r1: THUMB.r - 0.002, seg: 2 });
  return defs;
}
const BONES = boneDefs(); // 16

// Poses (RIGHT hand): f = per finger [a, b, c] flexion about local X (negative curls toward the palm),
// s = extra spread per finger (about Y), t = thumb base euler delta [x, y, z] + [b, c] flexion.
const POSE_DEF = {
  open: { f: [[-0.08, -0.1, -0.06], [-0.08, -0.1, -0.06], [-0.1, -0.12, -0.08], [-0.1, -0.1, -0.1]], s: [0.04, 0, -0.04, -0.06], t: [0.1, 0.05, 0, -0.1, -0.08] },
  grip: { f: [[-1.15, -0.75, -0.75], [-1.2, -0.75, -0.8], [-1.25, -0.8, -0.8], [-1.3, -0.9, -0.8]], s: [-0.04, 0, 0.04, 0.06], t: [-0.85, -0.25, 0.55, -0.55, -0.45] },
  trigger: { f: [[-0.1, -1.25, -1.0], [-1.2, -0.75, -0.8], [-1.25, -0.8, -0.8], [-1.3, -0.9, -0.8]], s: [0.07, 0, 0.04, 0.06], t: [-0.85, -0.25, 0.55, -0.55, -0.45] },
  pinch: { f: [[-0.7, -0.5, -0.3], [-0.85, -0.7, -0.45], [-1.2, -1.2, -0.9], [-1.3, -1.2, -0.9]], s: [-0.05, 0, 0.05, 0.08], t: [-0.7, -0.4, 0.3, -0.1, -0.1] },
  point: { f: [[0.0, 0.0, 0.0], [-1.55, -1.5, -1.1], [-1.55, -1.5, -1.1], [-1.55, -1.5, -1.1]], s: [0.02, 0, 0, 0], t: [-0.5, -0.35, 0.45, -0.5, -0.3] },
  fist: { f: [[-1.5, -1.55, -1.2], [-1.55, -1.55, -1.2], [-1.55, -1.6, -1.2], [-1.55, -1.6, -1.2]], s: [-0.03, 0, 0.03, 0.05], t: [-0.95, -0.55, 0.65, -0.55, -0.5] },
  cup: { f: [[-0.45, -0.55, -0.4], [-0.5, -0.6, -0.45], [-0.55, -0.65, -0.5], [-0.6, -0.7, -0.5]], s: [0.02, 0, -0.02, -0.03], t: [-0.25, -0.1, 0.15, -0.3, -0.2] },
  palm: { f: [[0.06, 0.06, 0.03], [0.06, 0.06, 0.03], [0.06, 0.06, 0.03], [0.06, 0.06, 0.03]], s: [0.07, 0, -0.07, -0.1], t: [0.25, 0.25, -0.1, 0.0, 0.0] },
};

const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
/** Quaternions per bone for a pose (RIGHT hand). */
function poseQuats(name) {
  const P = POSE_DEF[name] || POSE_DEF.open;
  return BONES.map((b, i) => {
    const rest = new THREE.Quaternion().setFromEuler(_e.set(b.rest[0], b.rest[1], b.rest[2]));
    let d = [0, 0, 0];
    if (i >= 1 && i <= 12) {
      const fi = Math.floor((i - 1) / 3), j = (i - 1) % 3;
      d = [P.f[fi][j], j === 0 ? P.s[fi] : 0, 0];
    } else if (i === 13) d = [P.t[0], P.t[1], P.t[2]];
    else if (i === 14) d = [P.t[3], 0, 0];
    else if (i === 15) d = [P.t[4], 0, 0];
    _q.setFromEuler(_e.set(d[0], d[1], d[2]));
    return rest.multiply(_q);
  });
}
const mirrorQ = (q) => new THREE.Quaternion(q.x, -q.y, -q.z, q.w);

const POSE_Q = { R: {}, L: {} };
for (const n of HAND_POSES) {
  POSE_Q.R[n] = poseQuats(n);
  POSE_Q.L[n] = POSE_Q.R[n].map(mirrorQ);
}

/** Build an Object3D bone chain for `side` posed at `pose`; returns {root, bones}. Used for baking + pinch points. */
function evalBones(side, pose) {
  const bones = BONES.map((b) => {
    const o = new THREE.Bone();
    o.name = b.name;
    o.position.set(side === "L" ? -b.pos[0] : b.pos[0], b.pos[1], b.pos[2]);
    return o;
  });
  BONES.forEach((b, i) => { if (b.parent >= 0) bones[b.parent].add(bones[i]); });
  const q = POSE_Q[side][pose];
  bones.forEach((o, i) => o.quaternion.copy(q[i]));
  bones[0].updateMatrixWorld(true);
  return { root: bones[0], bones };
}

// pinch point = midpoint of the index tip and thumb tip in the pinch pose (R hand)
const PINCH_R = (() => {
  const { bones } = evalBones("R", "pinch");
  const tip = (i, len) => new THREE.Vector3(0, 0, -len).applyMatrix4(bones[i].matrixWorld);
  const a = tip(3, BONES[3].len), b = tip(15, BONES[15].len);
  return a.add(b).multiplyScalar(0.5);
})();
const PALM_R = new THREE.Vector3(0, PY - PALM[1] / 2, PZ);

// ------------------------------------------------------------------ geometry (FP, skinned)

const capsuleZ = (r0, r1, len, seg, c0, c1) => {
  const g = capsule(r0, r1, len, seg, c0, c1);
  g.rotateX(-Math.PI / 2); // +Y -> -Z
  return g;
};

function addGloveBody(B, part, lod, boneOf) {
  const W = paint(PAL.glove), S = paint(PAL.gloveShade), T = paint("#ffffff", 0, 1);
  const fp = lod === "fp";
  // palm (puffy rounded block)
  B.add(part, cachedGeo(`hand:palm:${lod}`, () => roundedBar(PALM[0], PALM[1], PALM[2], 0.024, fp ? 3 : 1)), W, trs([0, PY, PZ]), boneOf(0));
  // puffy knuckle ridge across the front of the palm (hides the finger roots)
  B.add(part, cachedGeo(`hand:knuckle:${lod}`, () => capsule(0.02, 0.02, PALM[0] - 0.04, fp ? 8 : 5, 2, 2).rotateZ(-Math.PI / 2).translate(-(PALM[0] - 0.04) / 2, 0, 0)), W, trs([0, PY - 0.004, PZ - PALM[2] / 2 + 0.008], [0, 0, 0], [1, 1.05, 0.9]), boneOf(0));
  if (fp) {
    // the three stitched lines on the back of a cartoon glove
    for (const x of [-0.024, 0, 0.024]) B.add(part, cachedGeo("hand:stitch", () => roundedBox(0.0055, 0.004, 0.038, 0.0018, 0)), S, trs([x, PY + PALM[1] / 2 - 0.0005, PZ + 0.008]), boneOf(0));
  }
  // rolled cuff (tinted with the player's shell colour) + tapered sleeve stub
  B.add(part, cachedGeo(`hand:cuff:${lod}`, () => torus(0.034, 0.011, fp ? 4 : 4, fp ? 12 : 8)), T, trs([0, PY - 0.002, PZ + PALM[2] / 2 + 0.008], [0, 0, 0], [1.2, 0.84, 1.15]), boneOf(0));
  B.add(part, cachedGeo(`hand:stub:${lod}`, () => {
    const g = latheN([[0.03, 0, 1, 0], [0.031, 0.024, 1, 0.05], [0.026, 0.04, 0.7, 0.7], [0.014, 0.05, 0.3, 0.95], [0.0, 0.053, 0, 1]], fp ? 10 : 6);
    g.rotateX(Math.PI / 2); // +Y -> +Z
    return g;
  }), T, trs([0, PY - 0.002, PZ + PALM[2] / 2 + 0.01], [0, 0, 0], [1.15, 0.78, 1]), boneOf(0));
}

/** World matrices of the RIGHT-hand bones in the rest (bind) pose. */
function restMatrices() {
  const bones = BONES.map((b) => { const o = new THREE.Object3D(); o.position.fromArray(b.pos); o.rotation.set(b.rest[0], b.rest[1], b.rest[2]); return o; });
  BONES.forEach((b, i) => { if (b.parent >= 0) bones[b.parent].add(bones[i]); });
  bones[0].updateMatrixWorld(true);
  return bones.map((o) => o.matrixWorld.clone());
}

function buildFpGeometry() {
  const B = new MeshBuilder();
  const rest = restMatrices();
  addGloveBody(B, "hand", "fp", (i) => i);
  const W = paint(PAL.glove);
  BONES.forEach((b, i) => {
    if (i === 0 || b.ghost) return;
    const c0 = b.seg === 0 ? 1 : 2, c1 = b.seg === 2 ? 2 : 1;
    const len = b.seg === 2 ? b.len - b.r1 * 0.6 : b.len;
    B.add("hand", capsuleZ(b.r0, b.r1, len, 7, c0, c1), W, rest[i], i);
  });
  return B.merge("hand", { skinned: true });
}

function mirrorGeometry(src) {
  const g = src.clone();
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) { p.setX(i, -p.getX(i)); n.setX(i, -n.getX(i)); }
  const I = g.index.array;
  for (let k = 0; k < I.length; k += 3) { const t = I[k + 1]; I[k + 1] = I[k + 2]; I[k + 2] = t; }
  return g;
}

const fpGeo = { R: null, L: null };
function fpGeometry(side) {
  if (!fpGeo.R) fpGeo.R = buildFpGeometry();
  if (side === "L" && !fpGeo.L) fpGeo.L = mirrorGeometry(fpGeo.R);
  return fpGeo[side];
}

// ------------------------------------------------------------------ geometry (TP, baked variants)

export const TP_HAND_SCALE = 1.35;
const TP_VARIANT = { grip: "grip", trigger: "grip", cup: "grip", pinch: "grip", open: "open", palm: "open", point: "open", fist: "fist" };

/** Baked low-poly TP glove for `side` at pose grip|open|fist (<= 150 tris, scaled by TP_HAND_SCALE). */
export function tpHandGeometry(side, variant = "grip") {
  return cachedGeo(`hand:tp:${side}:${variant}`, () => {
    const B = new MeshBuilder();
    const W = paint(PAL.glove), T = paint("#ffffff", 0, 1);
    const sc = TP_HAND_SCALE;
    const S = (m) => new THREE.Matrix4().makeScale(sc, sc, sc).multiply(m);
    B.add("h", cachedGeo("hand:tp:palm", () => ellipsoid(PALM[0] / 2, PALM[1] / 2 + 0.002, PALM[2] / 2 + 0.004, 6, 4)), W, S(trs([0, PY, PZ])));
    B.add("h", cachedGeo("hand:tp:cuff", () => { const g = latheN([[0.046, -0.012, 1, 0], [0.046, 0.012, 1, 0]], 6); g.rotateX(Math.PI / 2); return g; }), T,
      S(trs([0, PY - 0.002, PZ + PALM[2] / 2 + 0.008], [0, 0, 0], [1.1, 0.75, 1])));
    const { bones } = evalBones(side, variant);
    const chains = [[1, 2, 3], [4, 5, 6], [7, 8, 9], [13, 14, 15]];
    for (const ch of chains) {
      const pts = [];
      for (const i of ch) pts.push(new THREE.Vector3().setFromMatrixPosition(bones[i].matrixWorld));
      pts.push(new THREE.Vector3(0, 0, -BONES[ch[2]].len).applyMatrix4(bones[ch[2]].matrixWorld));
      const r = ch[0] === 13 ? THUMB.r : FR;
      const g = tube(pts.map((v) => [v.x, v.y, v.z]), r * 1.05, 3, 4, false);
      B.add("h", g, W, S(new THREE.Matrix4()));
    }
    return B.merge("h");
  });
}

// ------------------------------------------------------------------ HandModel

class FPHand {
  constructor(side, color) {
    this.side = side;
    this.lod = "fp";
    this.group = new THREE.Group();
    this.group.name = `hand${side}`;
    const geo = fpGeometry(side);
    const bones = BONES.map((b) => {
      const o = new THREE.Bone();
      o.name = b.name;
      o.position.set(side === "L" ? -b.pos[0] : b.pos[0], b.pos[1], b.pos[2]);
      return o;
    });
    BONES.forEach((b, i) => { if (b.parent >= 0) bones[b.parent].add(bones[i]); });
    const q = POSE_Q[side].open;
    bones.forEach((o, i) => o.quaternion.copy(q[i]));
    this.mesh = new THREE.SkinnedMesh(geo, fxMaterial(color));
    this.mesh.add(bones[0]);
    this.group.add(this.mesh);
    // bind in the rest (unposed) pose
    bones.forEach((o, i) => o.quaternion.setFromEuler(_e.set(BONES[i].rest[0], side === "L" ? -BONES[i].rest[1] : BONES[i].rest[1], side === "L" ? -BONES[i].rest[2] : BONES[i].rest[2])));
    this.mesh.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(bones);
    this.mesh.bind(this.skeleton, new THREE.Matrix4());
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.bones = bones;
    this.outlines = addOutline(this.mesh, { width: 0.0045 });
    const mx = side === "L" ? -1 : 1;
    this.points = { hold: new THREE.Object3D(), pinch: new THREE.Object3D(), palm: new THREE.Object3D() };
    this.points.pinch.position.set(PINCH_R.x * mx, PINCH_R.y, PINCH_R.z);
    this.points.palm.position.copy(PALM_R);
    this.points.palm.rotation.x = Math.PI / 2; // palm point: local -Z... +Z faces out of the palm (-Y of the hand)
    // hold: grip centre; its local +X points out of the thumb side of the fist on both hands (R is turned about Y)
    if (side === "R") this.points.hold.rotation.y = Math.PI;
    for (const k in this.points) { this.points[k].name = k; bones[0].add(this.points[k]); }
    this._a = ""; this._b = ""; this._t = -1;
    this.setPose("open");
  }
  setPose(a, b = a, t = 0) {
    if (a === this._a && b === this._b && t === this._t) return;
    this._a = a; this._b = b; this._t = t;
    const QA = POSE_Q[this.side][a] || POSE_Q[this.side].open, QB = POSE_Q[this.side][b] || QA;
    for (let i = 0; i < this.bones.length; i++) this.bones[i].quaternion.slerpQuaternions(QA[i], QB[i], t);
  }
  setColor(css) { this.mesh.material = fxMaterial(css); }
  dispose() { this.group.removeFromParent(); this.skeleton.dispose(); }
}

class TPHand {
  constructor(side, color) {
    this.side = side;
    this.lod = "tp";
    this.group = new THREE.Group();
    this.group.name = `handTP${side}`;
    this.mesh = new THREE.Mesh(tpHandGeometry(side, "grip"), fxMaterial(color));
    this.mesh.castShadow = true;
    this.group.add(this.mesh);
    const mx = side === "L" ? -1 : 1, s = TP_HAND_SCALE;
    this.points = { hold: new THREE.Object3D(), pinch: new THREE.Object3D(), palm: new THREE.Object3D() };
    this.points.pinch.position.set(PINCH_R.x * mx * s, PINCH_R.y * s, PINCH_R.z * s);
    this.points.palm.position.copy(PALM_R).multiplyScalar(s);
    this.points.palm.rotation.x = Math.PI / 2;
    if (side === "R") this.points.hold.rotation.y = Math.PI;
    for (const k in this.points) { this.points[k].name = k; this.group.add(this.points[k]); }
    this.variant = "grip";
  }
  setPose(a, b = a, t = 0) {
    const v = TP_VARIANT[t < 0.5 ? a : b] || "grip";
    if (v === this.variant) return;
    this.variant = v;
    this.mesh.geometry = tpHandGeometry(this.side, v);
  }
  setColor(css) { this.mesh.material = fxMaterial(css); }
  dispose() { this.group.removeFromParent(); }
}

/** Gloved hand. side "L" | "R"; opts {lod: "fp"|"tp", color: cuff css colour}. */
export function buildHand(side = "R", opts = {}) {
  const s = side === "L" ? "L" : "R";
  const color = opts.color || "#f4efe4";
  return opts.lod === "tp" ? new TPHand(s, color) : new FPHand(s, color);
}

/** Pinch point (hand space, unscaled) for side; used by guns to place pinch sockets. */
export function pinchPoint(side = "R") { return new THREE.Vector3(PINCH_R.x * (side === "L" ? -1 : 1), PINCH_R.y, PINCH_R.z); }
export function palmPoint() { return PALM_R.clone(); }
