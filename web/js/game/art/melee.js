// Kitchen melee weapons: rolling pin, cast-iron frying pan, whisk, slotted spatula.
// Frame: the handle runs along local +Y from sockets.grip (at the origin); sockets.impact sits on the
// striking face. sockets.grip's local X is the handle axis, so attaching grip to a hand's points.hold
// lays the handle along the fist's bar.

import * as THREE from "../../../vendor/three.module.min.js";
import { MeshBuilder, latheN, bevelCyl, ellipsoid, tube, torus, roundedBox, extrudeWithHoles, roundRectPts, paint, trs, cachedGeo, fxMesh, basisQuat, modelStats } from "./geom.js";
import { addOutline, PAL } from "./toon.js";

export const MELEE_IDS = ["rollingpin", "pan", "whisk", "spatula"];

const DESIGNS = {
  rollingpin(B, fp) {
    const rad = fp ? 18 : 8;
    const wood = paint("#e3b77d"), woodHi = paint("#efcb95"), handle = paint("#a8693f"), ring = paint("#7a4526");
    // right handle (the grip), then the barrel, then the far handle
    B.add("s", bevelCyl(0.019, 0.021, 0.12, fp ? 12 : 6, fp ? 0.006 : 0, fp ? 1 : 0), handle, trs([0, 0.0, 0]));
    B.add("s", ellipsoid(0.026, 0.02, 0.026, fp ? 10 : 6, fp ? 6 : 4), handle, trs([0, -0.064, 0]));
    B.add("s", bevelCyl(0.054, 0.054, 0.36, rad, fp ? 0.016 : 0, fp ? 2 : 0), wood, trs([0, 0.25, 0]));
    if (fp) {
      // wood grain bands + rings where the handles meet the barrel
      for (const y of [0.13, 0.37]) B.add("s", bevelCyl(0.04, 0.04, 0.012, 14, 0.004, 1), ring, trs([0, y, 0]));
      for (const y of [0.18, 0.25, 0.32]) B.add("s", latheN([[0.0545, -0.004, 1, 0], [0.0548, 0.004, 1, 0]], 18), woodHi, trs([0, y, 0]));
    }
    B.add("s", bevelCyl(0.019, 0.021, 0.12, fp ? 12 : 6, fp ? 0.006 : 0, fp ? 1 : 0), handle, trs([0, 0.495, 0], [Math.PI, 0, 0]));
    B.add("s", ellipsoid(0.026, 0.02, 0.026, fp ? 10 : 6, fp ? 6 : 4), handle, trs([0, 0.56, 0]));
    return { impact: [0, 0.25, -0.054], len: 0.6 };
  },
  pan(B, fp) {
    const rad = fp ? 28 : 10;
    const iron = paint("#2b2a30"), ironHi = paint("#45444d"), copper = paint(PAL.copper), leather = paint("#7a4a2a"), wrap = paint("#5a3420");
    // leather-wrapped handle along +Y, hanging hole at the end
    B.add("s", roundedBox(0.032, 0.2, 0.02, 0.009, fp ? 1 : 0), leather, trs([0, 0.03, 0]));
    if (fp) for (let i = 0; i < 6; i++) B.add("s", roundedBox(0.035, 0.008, 0.023, 0.003, 0), wrap, trs([0, -0.05 + i * 0.03, 0], [0, 0, 0.12]));
    B.add("s", roundedBox(0.03, 0.08, 0.016, 0.006, fp ? 1 : 0), iron, trs([0, 0.165, 0]));
    B.add("s", torus(0.014, 0.0055, fp ? 6 : 4, fp ? 12 : 6), iron, trs([0, -0.085, 0]));
    // pan: lathe around its own axis (pointing +Z = the cooking side faces the holder), bottom = striking face
    const panM = trs([0, 0.345, 0], [Math.PI / 2, 0, 0]); // lathe +Y -> +Z
    B.add("s", latheN([
      [0, -0.012, 0, -1], [0.12, -0.012, 0, -1], [0.138, -0.004, 0.7, -0.7], [0.152, 0.028, 0.97, -0.25], [0.158, 0.04, 0.6, 0.8],
      [0.15, 0.042, -0.3, 0.95], [0.142, 0.03, -0.97, 0.2], [0.128, 0.002, -0.4, 0.9], [0.0, 0.002, 0, 1],
    ], rad), iron, panM);
    // copper rim ring + cooking-surface rings
    B.add("s", torus(0.155, 0.0065, fp ? 6 : 3, rad), copper, trs([0, 0.345, 0.041]));
    if (fp) {
      B.add("s", latheN([[0.09, 0.0025, 0, 1], [0.095, 0.0025, 0, 1]], rad), ironHi, panM);
      B.add("s", latheN([[0.045, 0.0025, 0, 1], [0.05, 0.0025, 0, 1]], rad), ironHi, panM);
      // cast logo bump on the bottom
      B.add("s", bevelCyl(0.03, 0.03, 0.004, 16, 0.002, 1), ironHi, trs([0, 0.345, -0.014], [Math.PI / 2, 0, 0]));
    }
    return { impact: [0, 0.345, -0.014], len: 0.5 };
  },
  whisk(B, fp) {
    const steel = paint("#c8ccd4"), steelDk = paint("#8f95a0"), grip = paint("#e2483d");
    // coloured rubber grip + steel collar
    B.add("s", bevelCyl(0.018, 0.02, 0.12, fp ? 12 : 6, fp ? 0.007 : 0, fp ? 1 : 0), grip, trs([0, 0.0, 0]));
    if (fp) for (const y of [-0.035, 0.0, 0.035]) B.add("s", latheN([[0.0205, -0.004, 1, 0], [0.0215, 0, 1, 0], [0.0205, 0.004, 1, 0]], 12), paint("#c23a31"), trs([0, y, 0]));
    B.add("s", bevelCyl(0.016, 0.021, 0.04, fp ? 12 : 6, fp ? 0.004 : 0, fp ? 1 : 0), steelDk, trs([0, 0.08, 0]));
    B.add("s", torus(0.013, 0.004, 4, 8), steel, trs([0, -0.072, 0]));
    // 4 wire loops (8 wires): teardrop loops from the collar through a bulb
    const loop = [];
    const N = fp ? 20 : 8;
    for (let i = 0; i < N; i++) {
      const t = i / N;
      const a = t * Math.PI * 2;
      // teardrop: x = sin(a) * bulb, y from collar (0.1) to tip (0.33)
      const y = 0.1 + (1 - Math.cos(a)) * 0.115;
      const x = Math.sin(a) * 0.05 * Math.pow(Math.sin(a / 2), 0.6);
      loop.push([x, y, 0]);
    }
    const loopGeo = tube(loop, fp ? 0.0032 : 0.005, fp ? 28 : 7, fp ? 4 : 3, true);
    for (let k = 0; k < 4; k++) B.add("s", loopGeo, steel, trs([0, 0, 0], [0, (k * Math.PI) / 4, 0]));
    return { impact: [0, 0.33, 0], len: 0.42 };
  },
  spatula(B, fp) {
    const red = paint("#d23b2f"), redDk = paint("#a52a22"), steel = paint("#cfd3da"), steelDk = paint("#8f95a0");
    B.add("s", roundedBox(0.03, 0.15, 0.022, 0.01, fp ? 1 : 0), red, trs([0, 0.01, 0]));
    if (fp) B.add("s", roundedBox(0.032, 0.012, 0.024, 0.004, 0), redDk, trs([0, -0.035, 0]));
    B.add("s", torus(0.009, 0.0035, 4, 8), redDk, trs([0, -0.054, 0]));
    // rivets
    if (fp) for (const y of [0.0, 0.05]) B.add("s", bevelCyl(0.0045, 0.0045, 0.026, 8, 0.0015, 1), steel, trs([0, y, 0], [Math.PI / 2, 0, 0]));
    // offset neck
    B.add("s", tube([[0, 0.08, 0], [0, 0.13, 0.004], [0, 0.17, 0.02], [0, 0.2, 0.024]], fp ? 0.0065 : 0.008, fp ? 8 : 3, fp ? 6 : 4), steelDk);
    // slotted blade
    const slots = [];
    if (fp) for (const x of [-0.03, 0, 0.03]) slots.push(roundRectPts(0.012, 0.075, 0.005, 2, x, 0.005).reverse());
    const blade = extrudeWithHoles(roundRectPts(0.115, 0.13, 0.02, fp ? 4 : 1), slots, 0.005, fp ? 0.0018 : 0, 1);
    B.add("s", blade, steel, trs([0, 0.265, 0.026], [-0.12, 0, 0]));
    return { impact: [0, 0.27, 0.02], len: 0.4 };
  },
};

const templates = new Map();
function template(id, lod) {
  const key = `${id}:${lod}`;
  let t = templates.get(key);
  if (!t) {
    const B = new MeshBuilder();
    const info = (DESIGNS[id] || DESIGNS.rollingpin)(B, lod === "fp");
    t = { geo: B.merge("s"), info };
    templates.set(key, t);
  }
  return t;
}

/** Melee model: {id, group, sockets: {grip, impact}, stats, dispose()}. */
export function buildMelee(id = "rollingpin", opts = {}) {
  const lod = opts.lod === "tp" ? "tp" : "fp";
  if (!DESIGNS[id]) id = "rollingpin";
  const t = template(id, lod);
  const group = new THREE.Group();
  group.name = `melee:${id}`;
  const mesh = fxMesh(t.geo);
  group.add(mesh);
  if (lod === "fp") addOutline(mesh, { width: 0.0045 });
  const grip = new THREE.Object3D();
  grip.name = "grip";
  grip.quaternion.copy(basisQuat([0, 1, 0], [1, 0, 0])); // local X = handle axis
  group.add(grip);
  const impact = new THREE.Object3D();
  impact.name = "impact";
  impact.position.fromArray(t.info.impact);
  group.add(impact);
  const stats = modelStats(group);
  return { id, lod, group, sockets: { grip, impact }, stats, length: t.info.len, dispose() { group.removeFromParent(); } };
}

/** Legacy v1 helper: the rolling pin lying along Z (the old buildRollingPin frame). */
export function legacyRollingPin() {
  const m = buildMelee("rollingpin", { lod: "fp" });
  m.group.rotation.x = Math.PI / 2;
  m.group.position.z = -0.25;
  const g = new THREE.Group();
  g.add(m.group);
  return g;
}
