// Procedural models: egg players (toon shell with a painted face, cracks, hats, stamps, team band,
// floating gloved hands holding a TP gun, stubby shoes, nameplate), pickups, nests, golden eggs and
// projectiles. The art itself lives in ./art/ (see docs/V2_SPEC.md section 4); this module keeps the
// v1 API (EggAvatar, buildPickup, buildNest, ...) on top of it. No asset files.

import * as THREE from "../../vendor/three.module.min.js";
import { textTexture } from "../engine/textures.js";
import { buildGun as artBuildGun, buildGrenade as artBuildGrenade, buildRocket, buildMelee, addOutline, toonMaterial, fxMaterial, PAL } from "./art/index.js";
import { MeshBuilder, mergeStatic, bevelCyl, roundedBox, ellipsoid, latheN, tube, torus, wavyTorus, capsule, trs, cachedGeo } from "./art/geom.js";
import { tpHandGeometry } from "./art/hands.js";
import { eggGeometry as artEggGeometry, eggRadiusAt as artEggRadiusAt, shellTexture as artShellTexture, shellMaterial, shoeGeometry, crackStage } from "./art/egg.js";

// ------------------------------------------------------------------ re-exports (v1 API)

export const eggRadiusAt = artEggRadiusAt;
export function eggGeometry() { return artEggGeometry(); }
export const shellTexture = artShellTexture;
/** Gun model (FP LOD by default): {group, muzzle, sockets, parts, travel, ...}; see art/guns.js. */
export const buildGun = artBuildGun;
/** Quiche Bomb: a THREE.Group that also has {group, sockets: {grip}, parts: {spark}}. */
export const buildGrenade = artBuildGrenade;
/** Launcher projectile: the souffle rocket (TP LOD), nose along -Z. */
export function buildShell() { return buildRocket({ lod: "tp" }).group; }
/** v1 helper: a rolling pin lying along Z. */
export function buildRollingPin() {
  const m = buildMelee("rollingpin", { lod: "fp" });
  m.group.rotation.x = -Math.PI / 2;
  m.group.position.z = 0.28;
  const g = new THREE.Group();
  g.add(m.group);
  return g;
}
/** Merge every plain mesh under `group` into one vertex-coloured toon mesh (v1 name). */
export function mergeGroup(group) { return mergeStatic(group); }

// ------------------------------------------------------------------ small helpers

const tm = (c, o) => toonMaterial(c, o);
function mesh(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  return m;
}
const glowMat = (c) => { const m = tm(c, { emissive: c }); return m; };

// ------------------------------------------------------------------ hats

const templates = new Map();
function cached(key, make) {
  if (!templates.has(key)) templates.set(key, make());
  return templates.get(key).clone(true);
}

/** Hat group sitting on top of the egg (origin = egg top, y = 1.5 local). */
export function buildHat(def) {
  if (!def || def.shape === "none") return new THREE.Group();
  return cached(`hat:${def.id}`, () => { const g = makeHat(def); mergeStatic(g); g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); return g; });
}

const dome = (r, s = 14, p0 = 0, pl = Math.PI * 2) => new THREE.SphereGeometry(r, s, Math.round(s / 2), p0, pl, 0, Math.PI / 2);
function makeHat(def) {
  const g = new THREE.Group();
  const c = def.colors || ["#ffffff"];
  const c0 = c[0], c1 = c[1] || c0, c2 = c[2] || c1;
  const shade = (hex, k) => "#" + new THREE.Color(hex).multiplyScalar(k).getHexString();
  switch (def.shape) {
    case "toque":
      g.add(mesh(bevelCyl(0.21, 0.205, 0.16, 20, 0.02, 1), tm(c0), 0, -0.02, 0));
      g.add(mesh(latheN([[0.214, -0.035, 1, 0], [0.214, 0.035, 1, 0]], 20), tm(shade(c0, 0.9)), 0, -0.06, 0));
      for (const [x, y, z, r] of [[0, 0.21, 0, 0.2], [0.13, 0.15, 0.07, 0.15], [-0.12, 0.16, -0.06, 0.15], [0.0, 0.14, -0.15, 0.13]]) {
        g.add(mesh(ellipsoid(r, r * 0.85, r, 10, 6), tm(c0), x, y, z));
      }
      break;
    case "cap":
      g.add(mesh(dome(0.255), tm(c0), 0, -0.1, 0));
      for (let i = 0; i < 6; i++) g.add(mesh(new THREE.BoxGeometry(0.008, 0.005, 0.25), tm(shade(c0, 0.8)), 0, 0.02, 0, 0, (i * Math.PI) / 6, 0));
      { const brim = mesh(bevelCyl(0.2, 0.2, 0.024, 20, 0.01, 1), tm(c1), 0, -0.1, -0.2, -0.12, 0, 0); brim.scale.set(1, 1, 0.85); g.add(brim); }
      g.add(mesh(ellipsoid(0.035, 0.022, 0.035, 10, 6), tm(c1), 0, 0.15, 0));
      break;
    case "beanie":
      g.add(mesh(dome(0.275), tm(c0), 0, -0.13, 0));
      g.add(mesh(bevelCyl(0.288, 0.292, 0.11, 22, 0.02, 1), tm(c1), 0, -0.12, 0));
      for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; g.add(mesh(new THREE.BoxGeometry(0.014, 0.1, 0.01), tm(shade(c1, 0.85)), Math.sin(a) * 0.292, -0.12, Math.cos(a) * 0.292, 0, a, 0)); }
      g.add(mesh(new THREE.IcosahedronGeometry(0.085, 1), tm(c1), 0, 0.18, 0));
      break;
    case "tophat":
      g.add(mesh(bevelCyl(0.34, 0.34, 0.03, 20, 0.012, 1), tm(c0), 0, -0.05, 0));
      g.add(mesh(bevelCyl(0.205, 0.215, 0.42, 18, 0.02, 1), tm(c0), 0, 0.17, 0));
      g.add(mesh(bevelCyl(0.218, 0.22, 0.07, 22, 0.006, 1), tm(c1), 0, 0.02, 0));
      g.add(mesh(roundedBox(0.05, 0.05, 0.02, 0.008, 1), tm("#f2c94c"), 0, 0.02, -0.22));
      break;
    case "cowboy": {
      const brim = mesh(wavyTorus(0.4, 0.035, 2, 0.04, 5, 28), tm(c0), 0, -0.04, 0);
      brim.scale.set(1, 1.0, 0.85);
      g.add(brim);
      const flat = mesh(bevelCyl(0.42, 0.42, 0.02, 20, 0, 0), tm(c0), 0, -0.06, 0);
      flat.scale.set(1, 1, 0.85);
      g.add(flat);
      g.add(mesh(bevelCyl(0.17, 0.235, 0.3, 14, 0.05, 2), tm(c0), 0, 0.09, 0));
      g.add(mesh(latheN([[0.24, -0.025, 1, 0], [0.24, 0.025, 1, 0]], 14), tm(c1 === c0 ? "#3d2a1a" : c1), 0, -0.01, 0));
      g.add(mesh(ellipsoid(0.05, 0.02, 0.18, 8, 4), tm(shade(c0, 0.8)), 0, 0.235, 0));
      break;
    }
    case "crown":
      g.add(mesh(latheN([[0.22, -0.07, 1, 0], [0.22, 0.07, 1, 0], [0.205, 0.07, -1, 0], [0.205, -0.07, -1, 0]], 24), tm(c0, { rim: 0.6 }), 0, 0, 0));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        g.add(mesh(new THREE.ConeGeometry(0.06, 0.15, 8), tm(c0, { rim: 0.6 }), Math.sin(a) * 0.205, 0.14, Math.cos(a) * 0.205));
        g.add(mesh(ellipsoid(0.022, 0.022, 0.022, 6, 4), tm(c0), Math.sin(a) * 0.205, 0.22, Math.cos(a) * 0.205));
        g.add(mesh(new THREE.OctahedronGeometry(0.03, 0), tm(i % 2 ? "#3aa0ff" : "#d62839"), Math.sin(a) * 0.225, 0.0, Math.cos(a) * 0.225));
      }
      break;
    case "halo":
      g.add(mesh(torus(0.24, 0.032, 6, 24), glowMat(c0), 0, 0.25, 0, Math.PI / 2, 0, 0));
      break;
    case "propeller": {
      for (let i = 0; i < 8; i++) g.add(mesh(dome(0.245, 2, (i * Math.PI) / 4, Math.PI / 4), tm([c0, c1, c0, c2][i % 4]), 0, -0.1, 0));
      g.add(mesh(bevelCyl(0.014, 0.014, 0.14, 8, 0.004, 1), tm("#444"), 0, 0.17, 0));
      const prop = new THREE.Group();
      prop.position.y = 0.245;
      prop.add(mesh(ellipsoid(0.26, 0.008, 0.045, 8, 3), tm(c1), 0, 0, 0, 0, 0, 0.12));
      prop.add(mesh(ellipsoid(0.045, 0.008, 0.26, 8, 3), tm(c2), 0, 0, 0, -0.12, 0, 0));
      prop.add(mesh(ellipsoid(0.026, 0.02, 0.026, 6, 4), tm("#f2c94c"), 0, 0.01, 0));
      mergeStatic(prop);
      prop.userData.spin = 12;
      g.add(prop);
      break;
    }
    case "viking":
      g.add(mesh(dome(0.28), tm(c0, { rim: 0.5 }), 0, -0.13, 0));
      g.add(mesh(bevelCyl(0.287, 0.287, 0.05, 22, 0.01, 1), tm("#7a5a32"), 0, -0.12, 0));
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; g.add(mesh(new THREE.OctahedronGeometry(0.016, 0), tm("#d9c27a"), Math.sin(a) * 0.29, -0.12, Math.cos(a) * 0.29)); }
      for (const s of [-1, 1]) {
        g.add(mesh(capsule(0.042, 0.012, 0.28, 7, 2, 1), tm(c1), s * 0.25, -0.06, 0, 0, 0, -s * 0.75));
      }
      break;
    case "sprout":
      g.add(mesh(tube([[0, -0.04, 0], [0.01, 0.05, 0], [-0.01, 0.13, 0]], 0.013, 6, 5), tm(c0), 0, 0, 0));
      for (const s of [-1, 1]) {
        const l = mesh(ellipsoid(0.09, 0.022, 0.05, 10, 5), tm(c0), s * 0.08, 0.15, 0);
        l.rotation.z = s * 0.45;
        g.add(l);
      }
      break;
    case "headband": {
      const r = eggRadiusAt(1.2) + 0.012;
      g.add(mesh(latheN([[r, -0.045, 1, 0], [r + 0.01, 0, 1, 0], [r, 0.045, 1, 0]], 26), tm(c0), 0, -0.3, 0));
      g.add(mesh(ellipsoid(0.03, 0.03, 0.025, 8, 6), tm(c0), 0, -0.3, r + 0.01));
      g.add(mesh(roundedBox(0.045, 0.14, 0.012, 0.01, 1), tm(c0), 0.05, -0.37, r + 0.02, 0.2, 0, 0.5));
      g.add(mesh(roundedBox(0.045, 0.12, 0.012, 0.01, 1), tm(c0), -0.04, -0.37, r + 0.02, 0.2, 0, -0.4));
      break;
    }
    case "pot":
      g.add(mesh(bevelCyl(0.27, 0.285, 0.24, 24, 0.02, 1), tm(c0, { rim: 0.6 }), 0, -0.02, 0));
      g.add(mesh(torus(0.29, 0.016, 4, 20), tm(c0, { rim: 0.6 }), 0, 0.1, 0, Math.PI / 2, 0, 0));
      g.add(mesh(roundedBox(0.06, 0.035, 0.36, 0.014, 1), tm(c1), 0, 0.03, 0.42));
      g.add(mesh(torus(0.022, 0.007, 4, 10), tm(c1), 0, 0.03, 0.6, Math.PI / 2, 0, 0));
      break;
    case "beret": {
      const b = mesh(ellipsoid(0.29, 0.09, 0.27, 18, 9), tm(c0), 0.05, 0.0, 0);
      b.rotation.z = -0.25;
      g.add(b);
      g.add(mesh(bevelCyl(0.012, 0.012, 0.06, 6, 0.003, 1), tm(c0), 0.04, 0.09, 0));
      break;
    }
    default:
      break;
  }
  return g;
}

// ------------------------------------------------------------------ pickups / nests / golden egg

const propTemplates = new Map();
function fromTemplate(key, make) {
  if (!propTemplates.has(key)) propTemplates.set(key, make());
  return propTemplates.get(key).clone(true);
}

export function buildPickup(type) {
  const g = fromTemplate(`pickup|${type}`, () => makePickup(type));
  g.userData.inner = g.children[0];
  return g;
}

function makePickup(type) {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  inner.position.y = 0.55;
  g.add(inner);
  if (type === "hp") {
    // toast soldier: a chunky toast slice with a butter pat and a red cross
    inner.add(mesh(roundedBox(0.44, 0.48, 0.09, 0.05, 2), tm("#d99a52"), 0, 0, 0));
    inner.add(mesh(roundedBox(0.36, 0.38, 0.1, 0.04, 2), tm("#f6d39a"), 0, -0.015, 0));
    for (const s of [-1, 1]) inner.add(mesh(ellipsoid(0.1, 0.09, 0.05, 12, 8), tm("#d99a52"), s * 0.13, 0.2, 0));
    inner.add(mesh(roundedBox(0.13, 0.05, 0.11, 0.015, 1), tm("#fff1a6"), 0.06, 0.08, 0.02, 0, 0, 0.15));
    inner.add(mesh(roundedBox(0.07, 0.2, 0.11, 0.02, 1), tm("#e8423f"), 0, -0.06, 0.012));
    inner.add(mesh(roundedBox(0.2, 0.07, 0.11, 0.02, 1), tm("#e8423f"), 0, -0.06, 0.013));
  } else if (type === "shield") {
    const e = mesh(artEggGeometry(), tm("#7fd3ff", { rim: 0.8, rimColor: "#e6fbff" }), 0, -0.25, 0);
    e.scale.setScalar(0.38);
    inner.add(e);
    inner.add(mesh(torus(0.23, 0.02, 6, 28), glowMat("#9fe8ff"), 0, 0.03, 0, Math.PI / 2, 0, 0));
    for (let i = 0; i < 3; i++) inner.add(mesh(new THREE.OctahedronGeometry(0.03, 0), glowMat("#e6fbff"), Math.sin(i * 2.1) * 0.24, 0.03, Math.cos(i * 2.1) * 0.24));
  } else {
    // egg carton with ammo
    inner.add(mesh(roundedBox(0.52, 0.16, 0.32, 0.04, 1), tm("#d9c6a5"), 0, -0.05, 0));
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      inner.add(mesh(ellipsoid(0.065, 0.085, 0.065, 10, 7), tm("#f5efe3"), -0.16 + i * 0.16, 0.06, -0.07 + j * 0.14));
    }
    inner.add(mesh(roundedBox(0.54, 0.035, 0.34, 0.012, 1), tm("#7da35a"), 0, 0.0, 0));
    for (let i = 0; i < 3; i++) inner.add(mesh(bevelCyl(0.018, 0.018, 0.09, 8, 0.004, 1), tm(PAL.brass), -0.12 + i * 0.12, 0.0, 0.2, Math.PI / 2, 0, 0));
  }
  const ringColor = type === "hp" ? "#ff6b5a" : type === "shield" ? "#6cc9ff" : "#9fd36b";
  const ring = mesh(cachedGeo("pring", () => new THREE.RingGeometry(0.32, 0.45, 32)), new THREE.MeshBasicMaterial({
    color: new THREE.Color(ringColor), transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide,
  }), 0, 0.03, 0, -Math.PI / 2, 0, 0);
  g.add(ring);
  mergeStatic(inner);
  inner.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export function buildNest(teamColor) {
  return fromTemplate(`nest|${teamColor}`, () => makeNest(teamColor));
}

function makeNest(teamColor) {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  body.add(mesh(wavyTorus(0.76, 0.2, 11, 0.04, 8, 44), tm("#c9a24b"), 0, 0.16, 0));
  body.add(mesh(bevelCyl(0.8, 0.8, 0.06, 28, 0.02, 1), tm("#a07e36"), 0, 0.03, 0));
  // twigs poking out of the rim
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.2, r = 0.78;
    body.add(mesh(tube([[Math.cos(a) * r, 0.1, Math.sin(a) * r], [Math.cos(a + 0.25) * (r + 0.12), 0.24, Math.sin(a + 0.25) * (r + 0.12)]], 0.016, 2, 4), tm(i % 2 ? "#8a6a2e" : "#d9b45c"), 0, 0, 0));
  }
  body.add(mesh(bevelCyl(0.03, 0.035, 2.4, 8, 0.01, 1), tm("#8a6a3a"), 0.9, 1.2, 0));
  body.add(mesh(ellipsoid(0.05, 0.05, 0.05, 8, 6), tm("#f2c94c"), 0.9, 2.42, 0));
  mergeStatic(body);
  const ring = mesh(cachedGeo("nring", () => new THREE.RingGeometry(1.05, 1.2, 40)), new THREE.MeshBasicMaterial({
    color: new THREE.Color(teamColor), transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide,
  }), 0, 0.04, 0, -Math.PI / 2, 0, 0);
  g.add(ring);
  const flag = mesh(roundedBox(0.52, 0.32, 0.02, 0.01, 1), tm(teamColor), 1.17, 2.2, 0);
  g.add(flag);
  g.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
  return g;
}

export function buildGoldenEgg(teamColor) {
  return fromTemplate(`gegg|${teamColor}`, () => makeGoldenEgg(teamColor));
}

function makeGoldenEgg(teamColor) {
  const g = new THREE.Group();
  const e = new THREE.Mesh(artEggGeometry(), tm("#f2c94c", { emissive: teamColor, emissiveIntensity: 0.22, rim: 0.7, rimColor: "#fff6c8" }));
  e.scale.setScalar(0.42);
  e.castShadow = true;
  g.add(e);
  return g;
}

// ------------------------------------------------------------------ egg avatar

// TP hold: gun-root (right grip) offset from the shoulder pivot, per gun.
const TP_HOLD = {
  default: [0.04, -0.08, -0.3],
  souffle: [0.06, -0.14, -0.14],
  coddler: [-0.02, -0.04, -0.4],
  deviler: [0.04, -0.08, -0.28],
  piercer: [0.04, -0.09, -0.26],
};
// Melee swing keys (body space): [t, pos, handle dir]. Times are fractions of the 0.35 s swing.
const SWINGS = {
  sweep: [[0, [0.42, 0.95, -0.25], [0.5, 0.3, -0.8]], [0.3, [0.5, 1.0, -0.05], [0.8, 0.35, 0.3]], [0.45, [0.05, 0.92, -0.6], [-0.7, 0.15, -0.7]], [0.7, [-0.25, 0.88, -0.4], [-0.95, 0.05, 0.2]], [1, [0.3, 0.85, -0.35], [0.2, 0.6, -0.7]]],
  overhead: [[0, [0.35, 1.0, -0.35], [0, 0.8, -0.6]], [0.3, [0.3, 1.5, 0.0], [0, 0.85, 0.5]], [0.45, [0.15, 0.85, -0.62], [0, -0.25, -1]], [0.7, [0.15, 0.62, -0.5], [0, -0.75, -0.6]], [1, [0.3, 0.85, -0.35], [0, 0.6, -0.7]]],
  jab: [[0, [0.35, 0.92, -0.3], [0, 0.1, -1]], [0.3, [0.38, 0.92, -0.12], [0.1, 0.1, -1]], [0.45, [0.18, 0.95, -0.85], [0, 0.05, -1]], [0.7, [0.25, 0.92, -0.5], [0, 0.1, -1]], [1, [0.3, 0.85, -0.35], [0, 0.4, -0.9]]],
  uppercut: [[0, [0.35, 0.8, -0.35], [0, -0.3, -0.9]], [0.3, [0.35, 0.45, -0.3], [0, -0.55, -0.8]], [0.45, [0.25, 1.2, -0.58], [0, 0.8, -0.5]], [0.7, [0.2, 1.38, -0.3], [0, 0.95, 0.2]], [1, [0.3, 0.85, -0.35], [0, 0.6, -0.7]]],
};
const SWING_DUR = 0.35;
const TP_GUN_SCALE = 1.2; // chunky cartoon read at distance (hands scale with the sockets)
const _sGun = new THREE.Vector3(TP_GUN_SCALE, TP_GUN_SCALE, TP_GUN_SCALE);
const NADE_DUR = 0.4;

const _mA = new THREE.Matrix4(), _mB = new THREE.Matrix4(), _mC = new THREE.Matrix4();
const _pA = new THREE.Vector3(), _pB = new THREE.Vector3(), _qA = new THREE.Quaternion(), _qB = new THREE.Quaternion(), _sA = new THREE.Vector3(), _sB = new THREE.Vector3();
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);
const _chain = [];
const _sky = new THREE.Color("#fff3d6"), _cyan = new THREE.Color("#7fe8ff");

/** Matrix of obj relative to `stop` (an ancestor), from local matrices (updates them). */
function chainMatrix(obj, stop, out) {
  _chain.length = 0;
  for (let o = obj; o && o !== stop; o = o.parent) _chain.push(o);
  out.identity();
  for (let i = _chain.length - 1; i >= 0; i--) {
    const o = _chain[i];
    if (o.matrixAutoUpdate) o.updateMatrix();
    out.multiply(o.matrix);
  }
  return out;
}
const smooth = (x) => x * x * (3 - 2 * x);
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** Hand-in-body orientation for holding a melee whose handle points along `h` (R hand: head out of the thumb side). */
function meleeQuat(h, out) {
  _v1.set(h[0], h[1], h[2]).normalize();
  // fingers wrap perpendicular to the handle, roughly toward -X/-Z
  _v2.set(-0.4, 0.0, -0.9);
  _v2.addScaledVector(_v1, -_v2.dot(_v1));
  if (_v2.lengthSq() < 1e-4) _v2.set(0, -1, 0).addScaledVector(_v1, _v1.y);
  _v2.normalize();
  // local X = -handle (R hold faces the thumb side), local Z = -fingers, Y = Z x X
  _v3.copy(_v1).negate();
  const z = _v2.negate();
  const y = _pB.crossVectors(z, _v3).normalize();
  _mC.makeBasis(_v3, y, z);
  return out.setFromRotationMatrix(_mC);
}

let avatarSeq = 0;

/**
 * One player's 3D representation (remote players; also the death cam / lobby preview).
 * Local frame: feet at origin, facing -Z.
 */
export class EggAvatar {
  constructor(data, { name = "", team = 0, teamColor = "#ffffff", cos = {}, cls = "benedict", mel, nameplate = true, lod = "tp", id } = {}) {
    this.data = data;
    this.lod = lod;
    this.root = new THREE.Group();
    this.body = new THREE.Group(); // squash/lean pivot at the feet
    this.root.add(this.body);
    this.shellMat = shellMaterial(null);
    this.u = this.shellMat.userData.yo;
    const seed = id != null ? (Number(id) || [...String(id)].reduce((a, c) => a * 31 + c.charCodeAt(0), 7)) : ++avatarSeq;
    this.u.uCrackU.value = ((seed * 0.6180339887) % 1 + 1) % 1;
    this.shell = new THREE.Mesh(artEggGeometry(), this.shellMat);
    this.shell.castShadow = true;
    this.body.add(this.shell);
    this.outlines = addOutline(this.shell, { width: 0.012 });
    // hat
    this.hatAnchor = new THREE.Group();
    this.hatAnchor.position.y = 1.47;
    this.body.add(this.hatAnchor);
    this.spinners = [];
    // gun pivot (shoulder) rotates with pitch
    this.gunPivot = new THREE.Group();
    this.gunPivot.position.set(0.17, 0.84, -0.12);
    this.body.add(this.gunPivot);
    this.gunHolder = new THREE.Group();
    this.gunPivot.add(this.gunHolder);
    this.gun = null;
    this.muzzleLocal = new THREE.Vector3();
    // floating hands + shoes: one skinned mesh, 4 rigid bones
    this._buildLimbs();
    // melee (visible only while swinging)
    this.meleeModel = null;
    this.meleeId = "";
    // carried golden egg
    this.carry = null;
    // nameplate
    this.plate = null;
    this.nameplateOn = nameplate;
    this.name = name;
    this.team = team;
    this.teamColor = teamColor;
    this.weaponId = "";
    this.cls = cls;
    this.hpFrac = 1; this.shFrac = 0;
    this._lastL = new THREE.Matrix4(); this._lastR = new THREE.Matrix4();
    this.anim = {
      walk: 0, squash: 0, recoil: 0, prevG: true, vy: 0, lastY: 0, lean: 0, aim: 0,
      meleeT: -1, swing: "sweep", reloadT: -1, reloadDur: 2, switchT: -1, nadeT: -1, fireT: 9,
      blinkT: -1, nextBlink: 1 + Math.random() * 3, brow: 0, mouth: 0.6, crack: 0, flash: 0, prevFlags: 0,
      wL: 0, wR: 0, magOff: 0,
    };
    this.setCosmetics(cos);
    this.setTeam(team, teamColor);
    this.setName(name);
    this.setWeapon(cls);
    this.setMelee(mel || (data.weapons && (data.weapons.defaultMelee || data.weapons.melee)) || "rollingpin");
  }

  _buildLimbs() {
    const geo = cachedGeo("avatar:limbs", () => {
      const B = new MeshBuilder();
      B.add("l", tpHandGeometry("R", "grip"), null, null, 0);
      B.add("l", tpHandGeometry("L", "grip"), null, null, 1);
      B.add("l", shoeGeometry(), null, trs([0, 0, 0], [0, -0.12, 0]), 2);
      B.add("l", shoeGeometry(), null, trs([0, 0, 0], [0, 0.12, 0]), 3);
      return B.merge("l", { skinned: true });
    });
    const bones = [new THREE.Bone(), new THREE.Bone(), new THREE.Bone(), new THREE.Bone()];
    bones[0].name = "handR"; bones[1].name = "handL"; bones[2].name = "footR"; bones[3].name = "footL";
    bones[0].matrixAutoUpdate = false; bones[1].matrixAutoUpdate = false;
    this.body.add(bones[0], bones[1]);
    bones[2].position.set(0.15, 0, -0.12);
    bones[3].position.set(-0.15, 0, -0.12);
    this.root.add(bones[2], bones[3]);
    this.limbs = new THREE.SkinnedMesh(geo, fxMaterial("#f4efe4"));
    const I = new THREE.Matrix4();
    this.limbs.bind(new THREE.Skeleton(bones, [I, I.clone(), I.clone(), I.clone()]), I.clone());
    this.limbs.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.8, -0.2), 1.45);
    this.limbs.castShadow = true;
    this.root.add(this.limbs);
    this.bones = bones;
    // R hand hold point (thumb side) for the melee
    this.holdR = new THREE.Object3D();
    this.holdR.rotation.y = Math.PI;
    bones[0].add(this.holdR);
  }

  setCosmetics(cos) {
    const cm = this.data.cosmetics;
    const color = cm.colors.find((c) => c.id === cos.color) || cm.colors.find((c) => c.id === cm.defaults.color) || cm.colors[0];
    const stamp = cm.stamps.find((s) => s.id === cos.stamp) || null;
    const hat = cm.hats.find((h) => h.id === cos.hat) || null;
    this.shellMat.map = shellTexture(color, stamp);
    this.shellMat.needsUpdate = true;
    this.shellColor = color.shell;
    // dark shells get light brows so the face reads
    const lum = new THREE.Color(color.shell).getHSL({}).l;
    this.u.uBrowColor.value.set(lum < 0.3 ? "#f4efe4" : "#3b2a20");
    // cracks show the pale inner membrane on dark shells, dark lines on light ones
    this.u.uCrackColor.value.set(lum < 0.3 ? "#efe3cc" : "#3b2616");
    this.limbs.material = fxMaterial(color.shell);
    this.hatAnchor.clear();
    this.hat = buildHat(hat);
    this.hatAnchor.add(this.hat);
    this.spinners.length = 0;
    this.hat.traverse((o) => { if (o.userData.spin) this.spinners.push(o); });
    this.cos = cos;
  }

  setTeam(team, color) {
    this.team = team;
    this.teamColor = color;
    this.u.uBand.value = team > 0 ? 1 : 0;
    if (team > 0) this.u.uBandColor.value.set(color);
    if (this.name) this.setName(this.name);
  }

  setName(name) {
    this.name = name;
    if (!this.nameplateOn) return;
    if (this.plate) { this.root.remove(this.plate); this.plate.material.map.dispose(); this.plate.material.dispose(); }
    const tex = textTexture(name, this.team > 0 ? this.teamColor : "#ffffff");
    const m = new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true, fog: false });
    this.plate = new THREE.Sprite(m);
    this.plate.scale.set(1.6, 0.4, 1);
    this.plate.position.y = 2.15;
    this.plate.renderOrder = 5;
    this.root.add(this.plate);
  }

  setWeapon(id) {
    if (id === this.weaponId) return;
    this.weaponId = id;
    if (this.gun) this.gun.dispose();
    this.gun = artBuildGun(id, { lod: "tp" });
    const hold = TP_HOLD[id] || TP_HOLD.default;
    this.gun.group.position.set(hold[0], hold[1], hold[2]);
    this.gun.group.rotation.y = 0.08;
    this.gun.group.scale.setScalar(TP_GUN_SCALE);
    this.gunHolder.add(this.gun.group);
    this.gun.group.updateMatrix();
    this.muzzleLocal.copy(this.gun.muzzle).applyMatrix4(this.gun.group.matrix);
    const w = this.data.weapons && this.data.weapons.weapons ? this.data.weapons.weapons[id] : null;
    this.reloadStyle = (w && w.reloadStyle) || ({ deviler: "shells", piercer: "clip", souffle: "rocket", coddler: "pistol" }[id] || "mag");
    this.anim && (this.anim.reloadT = -1, this.anim.magOff = 0);
  }

  /** Choose this avatar's melee (shown during swings). */
  setMelee(id) {
    if (!id || id === this.meleeId) return;
    this.meleeId = id;
    if (this.meleeModel) this.meleeModel.dispose();
    this.meleeModel = buildMelee(id, { lod: "tp" });
    const g = this.meleeModel.group, grip = this.meleeModel.sockets.grip;
    // item.matrix = hold * inverse(grip)
    grip.updateMatrix();
    g.matrix.copy(grip.matrix).invert();
    g.matrix.decompose(g.position, g.quaternion, g.scale);
    g.scale.setScalar(1.25);
    g.visible = false;
    this.holdR.add(g);
    const w = this.data.weapons && this.data.weapons.weapons ? this.data.weapons.weapons[id] : null;
    this.swingType = (w && w.swing) || ({ pan: "overhead", whisk: "jab", spatula: "uppercut" }[id] || "sweep");
  }

  setCarry(on, color) {
    if (on && !this.carry) {
      this.carry = buildGoldenEgg(color || "#f2c94c");
      this.carry.position.set(0, 0.75, 0.45);
      this.carry.rotation.x = 0.4;
      this.body.add(this.carry);
    } else if (!on && this.carry) {
      this.body.remove(this.carry);
      this.carry = null;
    }
  }

  /** World position of the gun muzzle. */
  muzzleWorld(out = new THREE.Vector3()) {
    this.root.updateMatrixWorld(true);
    return out.setFromMatrixPosition(this.gun.sockets.muzzle.matrixWorld);
  }

  fire() { this.anim.recoil = 1; this.anim.fireT = 0; }
  /** Start the TP melee swing (id defaults to the avatar's melee). */
  melee(id) {
    if (id) this.setMelee(id);
    this.anim.meleeT = 0;
    this.anim.swing = SWINGS[this.swingType] ? this.swingType : "sweep";
  }
  throwNade() { this.anim.nadeT = 0; }

  /** Health fractions 0..1: drives the crack stage, the flash on damage, the shield rim and the expression. */
  setHealth(hpFrac, shFrac = 0) {
    hpFrac = clamp01(hpFrac); shFrac = clamp01(shFrac);
    if (hpFrac < this.hpFrac - 0.004) this.anim.flash = 1;
    this.hpFrac = hpFrac;
    this.shFrac = shFrac;
  }
  static crackStage(hpFrac) { return crackStage(hpFrac); }

  /**
   * Per-frame pose. st: {x,y,z,yaw,pitch,flags,hp?,sh?}, dt seconds, t time seconds.
   * Flags: 2 ground, 4 aiming, 8 reloading (rising edge starts the reload), 16 protected, 64 fury,
   * 128 switching, 512 threw a grenade (rising edge).
   */
  update(st, dt, t) {
    const a = this.anim;
    const r = this.root;
    const flags = st.flags | 0;
    if (st.hp != null) {
      const C = this.data.rules && this.data.rules.combat;
      this.setHealth(st.hp / ((C && C.maxHp) || 100), (st.sh || 0) / ((C && C.maxShield) || 50));
    }
    const dx = st.x - r.position.x, dz = st.z - r.position.z;
    const sp = dt > 0 ? Math.min(12, Math.hypot(dx, dz) / dt) : 0;
    const vy = dt > 0 ? (st.y - a.lastY) / dt : 0;
    a.lastY = st.y;
    r.position.set(st.x, st.y, st.z);
    r.rotation.y = st.yaw;
    const onGround = (flags & 2) !== 0;
    if (onGround && !a.prevG && a.vy < -4) a.squash = Math.min(1, -a.vy / 14);
    a.prevG = onGround;
    a.vy = vy;
    const spf = Math.min(1, sp / 6);
    a.walk += dt * sp * 2.2;
    a.squash = Math.max(0, a.squash - dt * 5);
    const bob = onGround ? Math.abs(Math.sin(a.walk)) * spf * 0.06 : 0;
    const sq = a.squash * 0.18;
    this.body.scale.set(1 + sq * 0.6, 1 - sq + (onGround ? 0 : 0.04), 1 + sq * 0.6);
    this.body.position.y = bob;
    a.lean += (spf * 0.12 - a.lean) * Math.min(1, dt * 8);
    this.body.rotation.x = -a.lean;
    this.body.rotation.z = Math.sin(a.walk) * 0.05 * spf;

    // edges
    const rise = flags & ~a.prevFlags;
    a.prevFlags = flags;
    if (rise & 8) {
      const w = this.data.weapons && this.data.weapons.weapons ? this.data.weapons.weapons[this.weaponId] : null;
      a.reloadT = 0; a.reloadDur = (w && w.reloadTime) || 2;
    }
    if (!(flags & 8) && a.reloadT >= 0 && a.reloadT < a.reloadDur * 0.97) a.reloadT = -1; // cancelled
    if (rise & 128) a.switchT = 0;
    if (rise & 512) a.nadeT = 0;

    // timers
    a.fireT += dt;
    if (a.reloadT >= 0) { a.reloadT += dt; if (a.reloadT > a.reloadDur) a.reloadT = -1; }
    if (a.switchT >= 0) { a.switchT += dt; if (a.switchT > 0.4) a.switchT = -1; }
    if (a.meleeT >= 0) { a.meleeT += dt; if (a.meleeT > SWING_DUR) a.meleeT = -1; }
    if (a.nadeT >= 0) { a.nadeT += dt; if (a.nadeT > NADE_DUR) a.nadeT = -1; }

    // gun pose: pitch, aim raise, recoil, switch / melee dips
    a.recoil = Math.max(0, a.recoil - dt * 8);
    a.aim += (((flags & 4) ? 1 : 0) - a.aim) * Math.min(1, dt * 10);
    const sw = a.switchT >= 0 ? Math.sin(Math.PI * clamp01(a.switchT / 0.4)) : 0;
    const md = a.meleeT >= 0 ? Math.sin(Math.PI * clamp01(a.meleeT / SWING_DUR)) : 0;
    const nd = a.nadeT >= 0 ? Math.sin(Math.PI * clamp01(a.nadeT / NADE_DUR)) * 0.5 : 0;
    this.gunPivot.rotation.x = st.pitch + a.recoil * 0.2 - sw * 0.8 - md * 0.55 - nd * 0.3;
    this.gunPivot.rotation.z = -md * 0.25;
    this.gunHolder.position.set(-a.aim * 0.07, a.aim * 0.06 - sw * 0.08, a.recoil * 0.06 + md * 0.06);
    this.gunHolder.rotation.y = -md * 0.2;

    // reload: mag offset along its travel axis
    let reloadL = 0, rf = a.reloadT >= 0 ? a.reloadT / a.reloadDur : -1;
    const g = this.gun;
    let magOff = 0;
    if (rf >= 0) {
      reloadL = smooth(clamp01(rf / 0.12)) * (1 - smooth(clamp01((rf - 0.82) / 0.13)));
      if (g.parts.mag) {
        magOff = rf < 0.15 ? 0 : rf < 0.3 ? smooth((rf - 0.15) / 0.15) * 0.12 : rf < 0.45 ? 0.12 + smooth((rf - 0.3) / 0.15) * 0.28
          : rf < 0.65 ? 0.4 - smooth((rf - 0.45) / 0.2) * 0.28 : rf < 0.78 ? 0.12 - smooth((rf - 0.65) / 0.13) * 0.12 : 0;
      }
    }
    if (g.parts.mag) {
      const m = g.parts.mag, ax = g.travel.mag ? g.travel.mag.axis : [0, -1, 0];
      _v1.set(ax[0], ax[1], ax[2]).normalize();
      m.position.copy(m.userData.rest.position).addScaledVector(_v1, magOff);
    }

    // hand targets (body space)
    chainMatrix(g.sockets.rightGrip, this.body, _mA);
    const lg = g.sockets.leftGrip || g.sockets.rightGrip;
    chainMatrix(lg, this.body, _mB);
    // L hand
    let wL = 0;
    if (reloadL > 0) {
      wL = reloadL;
      if (g.parts.mag && g.sockets.magGrip) {
        chainMatrix(g.sockets.magGrip, this.body, _mC);
      } else {
        // shells / clip / rocket: hand works around the load port
        const lp = g.sockets.loadPort || g.sockets.muzzle;
        chainMatrix(lp, this.body, _mC);
        _mC.decompose(_pA, _qA, _sA);
        _mB.decompose(_pB, _qB, _sB);
        if (this.reloadStyle === "rocket") {
          const push = rf < 0.3 ? 0.3 : rf < 0.65 ? 0.3 - smooth((rf - 0.3) / 0.35) * 0.3 : 0;
          _pA.y -= 0.06; _pA.z -= push;
        } else {
          const n = this.reloadStyle === "clip" ? 2 : 3;
          const ph = clamp01((rf - 0.12) / 0.7);
          _pA.y -= 0.05 + Math.abs(Math.sin(ph * Math.PI * n)) * 0.16;
        }
        _mC.compose(_pA, _qB, _sGun);
      }
    } else if (a.nadeT >= 0) {
      const f = a.nadeT / NADE_DUR;
      wL = Math.sin(Math.PI * clamp01(f)) ;
      wL = Math.min(1, wL * 1.6);
      const up = smooth(clamp01(f / 0.4)), fw = smooth(clamp01((f - 0.35) / 0.35));
      _pA.set(-0.28 + fw * 0.1, 1.05 + up * 0.35 - fw * 0.25, 0.05 - fw * 0.7);
      _qA.setFromEuler(_e1.set(-0.5 - fw * 1.2, 0.3, 0.2));
      _mC.compose(_pA, _qA, _sGun);
    }
    a.wL += (wL - a.wL) * Math.min(1, dt * 18);
    if (wL > 0) this._lastL.copy(_mC);
    this._blendBone(this.bones[1], _mB, this._lastL, a.wL);

    // R hand: melee swing
    let wR = 0;
    if (a.meleeT >= 0 && this.meleeModel) {
      const f = a.meleeT / SWING_DUR;
      wR = smooth(clamp01(f / 0.12)) * (1 - smooth(clamp01((f - 0.82) / 0.18)));
      const keys = SWINGS[a.swing];
      let i = 0;
      while (i < keys.length - 2 && f > keys[i + 1][0]) i++;
      const k0 = keys[i], k1 = keys[i + 1];
      const u = smooth(clamp01((f - k0[0]) / Math.max(1e-6, k1[0] - k0[0])));
      _pA.fromArray(k0[1]).lerp(_v2.fromArray(k1[1]), u);
      meleeQuat(k0[2], _qA);
      meleeQuat(k1[2], _qB);
      _qA.slerp(_qB, u);
      this._lastR.compose(_pA, _qA, _sGun);
    }
    a.wR += (wR - a.wR) * Math.min(1, dt * 22);
    if (this.meleeModel) this.meleeModel.group.visible = a.wR > 0.2;
    this._blendBone(this.bones[0], _mA, this._lastR, a.wR);

    // feet: pat while walking, squash on landing
    const lift = onGround ? spf : 0;
    for (let s = 0; s < 2; s++) {
      const fb = this.bones[2 + s];
      const ph = a.walk + s * Math.PI;
      fb.position.y = Math.max(0, Math.sin(ph)) * 0.07 * lift + (onGround ? 0 : 0.03);
      fb.position.z = -0.12 + Math.cos(ph) * 0.08 * lift;
      fb.rotation.x = Math.sin(ph) * 0.35 * lift;
      fb.scale.set(1 + a.squash * 0.25, 1 - a.squash * 0.35, 1 + a.squash * 0.2);
    }

    // face: blink, brows, mouth, look
    if (a.blinkT >= 0) { a.blinkT += dt; if (a.blinkT > 0.12) { a.blinkT = -1; a.nextBlink = 2 + Math.random() * 3; } }
    else { a.nextBlink -= dt; if (a.nextBlink <= 0) a.blinkT = 0; }
    const u = this.u;
    u.uBlink.value = a.blinkT >= 0 ? Math.sin(Math.PI * clamp01(a.blinkT / 0.12)) : 0;
    const browT = a.fireT < 1 || a.meleeT >= 0 ? 1 : this.hpFrac < 0.35 ? -1 : 0;
    a.brow += (browT - a.brow) * Math.min(1, dt * 10);
    u.uBrow.value = a.brow;
    const mouthT = this.hpFrac < 0.2 ? -1 : this.hpFrac < 0.35 ? -0.5 : a.fireT < 1 ? 0.1 : 0.6;
    a.mouth += (mouthT - a.mouth) * Math.min(1, dt * 8);
    u.uMouth.value = a.mouth;
    u.uLook.value.set(0, Math.max(-1, Math.min(1, st.pitch * 0.9)));

    // cracks (ease toward the stage over ~0.25 s), damage flash, shield rim
    const target = crackStage(this.hpFrac);
    a.crack += (target - a.crack) * Math.min(1, dt * 12);
    a.flash = Math.max(0, a.flash - dt / 0.25);
    u.uCrack.value = a.crack;
    u.uCrackFlash.value = a.flash;
    u.uTime.value = t;
    u.uRim.value = 0.32 + this.shFrac * 0.45;
    u.uRimColor.value.copy(_sky).lerp(_cyan, this.shFrac);

    // effects by flag
    const prot = (flags & 16) !== 0, fury = (flags & 64) !== 0;
    this.shellMat.emissive.setRGB(fury ? 0.45 + Math.sin(t * 10) * 0.15 : prot ? 0.25 + Math.sin(t * 14) * 0.2 : 0, fury ? 0.05 : prot ? 0.25 + Math.sin(t * 14) * 0.2 : 0, prot && !fury ? 0.3 + Math.sin(t * 14) * 0.2 : 0);
    for (const o of this.spinners) o.rotation.y += dt * o.userData.spin;
    if (this.carry) this.carry.rotation.y += dt * 2;
  }

  _blendBone(bone, base, target, w) {
    if (!target || w < 1e-3) { bone.matrix.copy(base); }
    else {
      base.decompose(_pA, _qA, _sA);
      target.decompose(_pB, _qB, _sB);
      _pA.lerp(_pB, w);
      _qA.slerp(_qB, w);
      _sA.lerp(_sB, w);
      bone.matrix.compose(_pA, _qA, _sA);
    }
    bone.matrixWorldNeedsUpdate = true;
  }

  setVisible(v) { this.root.visible = v; }

  dispose() {
    if (this.plate) { this.plate.material.map.dispose(); this.plate.material.dispose(); }
    if (this.gun) this.gun.dispose();
    if (this.meleeModel) this.meleeModel.dispose();
    this.limbs.skeleton.dispose();
    this.shellMat.dispose();
  }
}
const _e1 = new THREE.Euler();
