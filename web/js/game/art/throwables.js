// Throwables and projectiles: the Quiche Bomb (a crimped pie grenade with a fuse), the Souffle rocket
// (a puffy golden dome rising out of a fluted ramekin body, 4 cartoon fins, nozzle, additive flame)
// and tiny casings for the instanced brass / shell pool.

import * as THREE from "../../../vendor/three.module.min.js";
import { MeshBuilder, latheN, ellipsoid, tube, wavyTorus, flutedCyl, bevelCyl, torus, extrudeShape, paint, trs, cachedGeo, fxMesh, withFx, aimQuat } from "./geom.js";
import { addOutline, PAL } from "./toon.js";

const fpOrTp = (lod) => (lod === "tp" ? "tp" : "fp");

// ------------------------------------------------------------------ quiche bomb

function quicheGeometry(lod) {
  return cachedGeo(`quiche:${lod}`, () => {
    const fp = lod === "fp";
    const B = new MeshBuilder();
    const crust = paint("#d38b45"), crustHi = paint("#e9ac62"), fill = paint("#ffd34d"), spot = paint("#f0a63a", 0, 0, 0), herb = paint("#5f9e48", 0, 0, 0), dark = paint("#3a2c22");
    // crust bowl
    B.add("s", latheN([[0, -0.05, 0, -1], [0.095, -0.05, 0, -1], [0.108, -0.046, 0.6, -0.8], [0.116, -0.035, 0.95, -0.3], [0.128, 0.012, 0.97, -0.2], [0.13, 0.02, 0.9, 0.4]], fp ? 20 : 10), crust);
    // filling top (slightly domed custard)
    B.add("s", latheN([[0.118, 0.016, 0.3, 0.95], [0.08, 0.032, 0.15, 1], [0.0, 0.038, 0, 1]], fp ? 20 : 10), fill);
    // crimped rim
    B.add("s", wavyTorus(0.122, 0.019, 9, 0.006, fp ? 6 : 4, fp ? 54 : 18), crustHi, trs([0, 0.022, 0]));
    if (fp) {
      // bubbly filling spots and herb flecks
      const spots = [[0.04, 0.02, 0.018], [-0.05, 0.03, 0.014], [0.0, -0.055, 0.016], [-0.02, 0.0, 0.012], [0.065, -0.035, 0.011], [-0.07, -0.02, 0.01]];
      for (const [x, z, r] of spots) B.add("s", ellipsoid(r, r * 0.3, r, 8, 4), spot, trs([x, 0.034 - Math.hypot(x, z) * 0.05, z]));
      for (const [x, z, a] of [[0.02, 0.05, 0.4], [-0.04, -0.045, 1.4], [0.07, 0.01, 2.2], [-0.075, 0.03, 0.9], [0.03, -0.02, 2.8]]) {
        B.add("s", ellipsoid(0.009, 0.003, 0.004, 6, 3), herb, trs([x, 0.0365 - Math.hypot(x, z) * 0.05, z], [0, a, 0]));
      }
    } else {
      B.add("s", ellipsoid(0.03, 0.006, 0.03, 6, 3), spot, trs([0.03, 0.033, 0.01]));
    }
    // fuse wick
    B.add("s", tube([[0, 0.034, 0], [0.006, 0.07, 0.012], [0.024, 0.098, 0.006], [0.036, 0.112, -0.004]], fp ? 0.0065 : 0.008, fp ? 10 : 3, fp ? 6 : 4), dark);
    return B.merge("s");
  });
}

function sparkGeometry(lod) {
  return cachedGeo(`spark:${lod}`, () => {
    const B = new MeshBuilder();
    B.add("s", new THREE.OctahedronGeometry(0.016, 0), paint("#fff2a0", 1), trs([0, 0, 0], [0.3, 0.4, 0]));
    B.add("s", new THREE.OctahedronGeometry(0.013, 0), paint("#ff8a1f", 1), trs([0, 0, 0], [0.9, 0, 0.8], [1.4, 0.6, 1.4]));
    return B.merge("s");
  });
}

/** Quiche Bomb. Returns a THREE.Group that also carries {group, sockets: {grip}, parts: {spark}}. */
export function buildGrenade(opts = {}) {
  const lod = fpOrTp(opts.lod);
  const g = new THREE.Group();
  g.name = "quiche";
  const body = fxMesh(quicheGeometry(lod));
  g.add(body);
  const spark = new THREE.Group();
  spark.name = "spark";
  spark.position.set(0.036, 0.114, -0.004);
  const sm = fxMesh(sparkGeometry(lod));
  sm.castShadow = false;
  spark.add(sm);
  spark.userData.rest = { position: spark.position.clone(), quaternion: spark.quaternion.clone() };
  g.add(spark);
  if (lod === "fp") addOutline(body, { width: 0.0045 });
  const grip = new THREE.Object3D();
  grip.name = "grip";
  // held from below at the back of the rim: hand bar along the rim tangent, palm up under the crust
  grip.position.set(0, -0.03, 0.105);
  grip.quaternion.copy(aimQuat([0, 0, -1], [0, -1, 0]));
  g.add(grip);
  g.group = g;
  g.sockets = { grip };
  g.parts = { spark };
  return g;
}

// ------------------------------------------------------------------ souffle rocket

/** Merged rocket geometry (nose at -Z, origin at the centre, length 0.5). */
export function rocketGeometry(lod = "fp") {
  return cachedGeo(`rocket:${lod}`, () => {
    const fp = lod === "fp";
    const B = new MeshBuilder();
    const rad = fp ? 18 : 8;
    const toZ = (m) => m.multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)); // lathe +Y -> -Z
    // puffy golden dome (nose)
    B.add("s", latheN([[0.074, 0, 1, 0.1], [0.079, 0.03, 0.9, 0.45], [0.066, 0.072, 0.6, 0.8], [0.036, 0.1, 0.3, 0.95], [0.0, 0.108, 0, 1]], rad), paint("#eab04c"), toZ(trs([0, 0, -0.14])));
    if (fp) B.add("s", latheN([[0.057, 0.082, 0.5, 0.86], [0.034, 0.097, 0.3, 0.95], [0.0, 0.1055, 0, 1]], rad), paint("#f7d68a"), toZ(trs([0, 0, -0.1405])));
    // overflowing puffy lip where the souffle rises over the ramekin
    B.add("s", torus(0.072, 0.019, fp ? 6 : 4, fp ? 20 : 8), paint("#e2a443"), trs([0, 0, -0.132]));
    // fluted ramekin body (cream) with a gold band
    B.add("s", flutedCyl(0.058, 0.17, 14, 0.005, fp ? 56 : 14, 1), paint("#f4ead8"), toZ(trs([0, 0, -0.035])));
    B.add("s", bevelCyl(0.064, 0.064, 0.022, rad, fp ? 0.006 : 0, fp ? 1 : 0), paint(PAL.souffle[1]), toZ(trs([0, 0, 0.055])));
    // tail cone + nozzle
    B.add("s", latheN([[0.06, 0.0, 1, 0.2], [0.045, 0.07, 1, 0.35], [0.034, 0.1, 1, 0.3]], rad), paint(PAL.souffle[0]), toZ(trs([0, 0, 0.115]).multiply(new THREE.Matrix4().makeRotationX(Math.PI))));
    B.add("s", latheN([[0.026, 0, -1, 0], [0.026, 0.0, 0, -1], [0.034, 0.0, 0.3, -1], [0.042, 0.042, 1, -0.3], [0.036, 0.046, 0, 1], [0.03, 0.04, -1, 0.2]], rad), paint(PAL.metal), toZ(trs([0, 0, 0.205]).multiply(new THREE.Matrix4().makeRotationX(Math.PI))));
    // 4 cartoon fins (rounded swept plates)
    const fin = extrudeShape([[0, 0], [0.036, -0.01], [0.046, 0.024], [0.038, 0.07], [0, 0.056]], 0.008, fp ? 0.003 : 0, 1);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const m = new THREE.Matrix4().makeRotationZ(a).multiply(trs([0.05, 0, 0.13], [Math.PI / 2, 0, 0]));
      B.add("s", fin, paint(PAL.souffle[0]), m);
    }
    return B.merge("s");
  });
}

const flameMats = {};
function flameMaterial() {
  if (!flameMats.m) {
    flameMats.m = new THREE.MeshBasicMaterial({ color: 0xffa53a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  }
  return flameMats.m;
}

/** Souffle rocket: {group, sockets: {tail, nose}, parts: {flame}}. -Z = nose. */
export function buildRocket(opts = {}) {
  const lod = fpOrTp(opts.lod);
  const g = new THREE.Group();
  g.name = "rocket";
  const body = fxMesh(rocketGeometry(lod));
  g.add(body);
  if (lod === "fp") addOutline(body, { width: 0.0045 });
  const flame = new THREE.Mesh(cachedGeo("rocket:flame", () => {
    const c = new THREE.ConeGeometry(0.036, 0.26, 10, 1, true);
    c.rotateX(Math.PI / 2); // tip toward +Z
    c.translate(0, 0, 0.13);
    return c;
  }), flameMaterial());
  flame.name = "flame";
  flame.position.set(0, 0, 0.25);
  flame.visible = false;
  flame.castShadow = false;
  flame.userData.noOutline = true;
  g.add(flame);
  const tail = new THREE.Object3D(); tail.name = "tail"; tail.position.set(0, 0, 0.25); g.add(tail);
  const nose = new THREE.Object3D(); nose.name = "nose"; nose.position.set(0, 0, -0.25); g.add(nose);
  return { group: g, sockets: { tail, nose }, parts: { flame } };
}

// ------------------------------------------------------------------ casings

/** Tiny casing geometry (<= 60 tris) with vertex colours + aFx (use with the fx material or any toon material). */
export function buildCasing(kind = "brass") {
  return cachedGeo(`casing:${kind}`, () => {
    const B = new MeshBuilder();
    if (kind === "shell") {
      // red plastic hull + brass head, 0.06 long along Z
      B.add("s", latheN([[0.0, 0.0, 0, -1], [0.0118, 0.0, 0.3, -1], [0.0118, 0.016, 1, 0], [0.0108, 0.016, 0, 1]], 6), paint(PAL.brass), trs([0, 0, 0.03], [-Math.PI / 2, 0, 0]));
      B.add("s", latheN([[0.0108, 0.016, 1, 0], [0.0108, 0.058, 1, 0.2], [0.0, 0.06, 0, 1]], 6), paint("#d6352a"), trs([0, 0, 0.03], [-Math.PI / 2, 0, 0]));
    } else {
      B.add("s", latheN([[0.0, 0.0, 0, -1], [0.0062, 0.0, 0.3, -1], [0.0062, 0.016, 1, 0], [0.0045, 0.02, 1, 0.5], [0.0045, 0.025, 1, 0], [0, 0.025, 0, 1]], 6), paint(PAL.brass), trs([0, 0, 0.0125], [-Math.PI / 2, 0, 0]));
    }
    return withFx(B.merge("s"));
  });
}
