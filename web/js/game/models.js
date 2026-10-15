// Procedural models: egg players (lathe shell, eyes, hats, stamps, team band,
// nameplate), weapon models, pickups, nests, golden eggs and projectiles.
// Everything is generated from primitives and canvas textures (no asset files).

import * as THREE from "../../vendor/three.module.min.js";
import { textTexture } from "../engine/textures.js";

// ------------------------------------------------------------------ egg shape

// Egg profile: height 1.5 (collision box), max radius 0.42, wider at the bottom.
const EGG_H = 1.5, EGG_R = 0.42;
function eggProfile(n = 22) {
  const pts = [];
  let maxR = 0;
  const raw = [];
  for (let i = 0; i <= n; i++) {
    const th = (i / n) * Math.PI;
    const y = (EGG_H / 2) * (1 - Math.cos(th));
    const r = Math.sin(th) * (1 + 0.13 * Math.cos(th));
    raw.push([r, y]);
    if (r > maxR) maxR = r;
  }
  for (const [r, y] of raw) pts.push(new THREE.Vector2(Math.max(0.0005, (r / maxR) * EGG_R), y));
  return { pts, maxR };
}
const PROFILE = eggProfile();
/** Shell radius at height y (0..1.5) above the feet. */
export function eggRadiusAt(y) {
  const p = PROFILE.pts;
  for (let i = 1; i < p.length; i++) {
    if (p[i].y >= y) {
      const a = p[i - 1], b = p[i], t = (y - a.y) / Math.max(1e-6, b.y - a.y);
      return a.x + (b.x - a.x) * t;
    }
  }
  return 0;
}

let eggGeo = null;
export function eggGeometry() {
  if (!eggGeo) eggGeo = new THREE.LatheGeometry(PROFILE.pts, 28);
  return eggGeo;
}

// ------------------------------------------------------------------ shell texture

function drawGlyph(ctx, glyph, cx, cy, s, color) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = color; ctx.strokeStyle = color;
  ctx.lineWidth = s * 0.14; ctx.lineCap = "round"; ctx.lineJoin = "round";
  const P = (pts) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * s, y * s) : ctx.moveTo(x * s, y * s))); ctx.closePath(); ctx.fill(); };
  switch (glyph) {
    case "star": {
      const pts = [];
      for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.42 : 1, a = -Math.PI / 2 + (i * Math.PI) / 5; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
      P(pts); break;
    }
    case "heart":
      ctx.beginPath(); ctx.moveTo(0, s * 0.9);
      ctx.bezierCurveTo(-s * 1.2, 0, -s * 0.6, -s * 0.95, 0, -s * 0.35);
      ctx.bezierCurveTo(s * 0.6, -s * 0.95, s * 1.2, 0, 0, s * 0.9); ctx.fill(); break;
    case "bolt": P([[0.15, -1], [-0.55, 0.12], [-0.05, 0.12], [-0.2, 1], [0.55, -0.15], [0.05, -0.15]]); break;
    case "skull":
      ctx.beginPath(); ctx.ellipse(0, -s * 0.12, s * 0.75, s * 0.7, 0, 0, 6.3); ctx.fill();
      ctx.fillRect(-s * 0.4, s * 0.3, s * 0.8, s * 0.45);
      ctx.fillStyle = "#ffe066";
      ctx.beginPath(); ctx.arc(-s * 0.28, -s * 0.15, s * 0.2, 0, 6.3); ctx.arc(s * 0.28, -s * 0.15, s * 0.2, 0, 6.3); ctx.fill();
      break;
    case "flame":
      ctx.beginPath(); ctx.moveTo(0, -s);
      ctx.bezierCurveTo(s * 0.9, -s * 0.2, s * 0.8, s * 0.9, 0, s * 0.9);
      ctx.bezierCurveTo(-s * 0.8, s * 0.9, -s * 0.9, -s * 0.1, -s * 0.2, -s * 0.4);
      ctx.bezierCurveTo(-s * 0.1, -s * 0.1, 0, -s * 0.5, 0, -s); ctx.fill(); break;
    case "leaf":
      ctx.beginPath(); ctx.moveTo(0, -s);
      ctx.quadraticCurveTo(s * 0.9, 0, 0, s * 0.9); ctx.quadraticCurveTo(-s * 0.9, 0, 0, -s); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.6)"; ctx.lineWidth = s * 0.07;
      ctx.beginPath(); ctx.moveTo(0, -s * 0.8); ctx.lineTo(0, s * 0.8); ctx.stroke(); break;
    case "target":
      for (const [r, c] of [[1, color], [0.7, "#ffffff"], [0.42, color], [0.15, "#ffffff"]]) {
        ctx.fillStyle = c; ctx.beginPath(); ctx.arc(0, 0, r * s, 0, 6.3); ctx.fill();
      }
      break;
    case "smile":
      ctx.beginPath(); ctx.arc(0, 0, s * 0.95, 0, 6.3); ctx.lineWidth = s * 0.12; ctx.stroke();
      ctx.beginPath(); ctx.arc(-s * 0.32, -s * 0.25, s * 0.12, 0, 6.3); ctx.arc(s * 0.32, -s * 0.25, s * 0.12, 0, 6.3); ctx.fill();
      ctx.beginPath(); ctx.arc(0, s * 0.05, s * 0.55, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke(); break;
    case "seven":
      ctx.font = `900 ${Math.round(s * 2)}px system-ui, sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("7", 0, s * 0.08); break;
    default: break;
  }
  ctx.restore();
}

const shellCache = new Map();
/** Shell colour texture: base + speckles + stamp (front of egg is u = 0.5). */
export function shellTexture(colorDef, stampDef) {
  const key = `${colorDef.id}|${stampDef ? stampDef.id : ""}`;
  if (shellCache.has(key)) return shellCache.get(key);
  const W = 256, H = 128;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  ctx.fillStyle = colorDef.shell; ctx.fillRect(0, 0, W, H);
  // subtle vertical shading band for depth
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "rgba(255,255,255,0.18)"); g.addColorStop(0.5, "rgba(255,255,255,0)"); g.addColorStop(1, "rgba(0,0,0,0.12)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  if (colorDef.speckle) {
    let a = 1337;
    const r = () => ((a = (a * 1103515245 + 12345) >>> 0) / 4294967296);
    ctx.fillStyle = colorDef.speckle;
    for (let i = 0; i < 160; i++) {
      ctx.globalAlpha = 0.35 + r() * 0.6;
      ctx.beginPath(); ctx.ellipse(r() * W, r() * H, 1 + r() * 3.5, 1 + r() * 2.5, r() * 3, 0, 6.3); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  if (stampDef && stampDef.glyph) {
    if (stampDef.glyph === "stripes") {
      ctx.fillStyle = stampDef.color;
      ctx.fillRect(W * 0.5 - 22, 0, 12, H); ctx.fillRect(W * 0.5 + 10, 0, 12, H);
    } else {
      // stamp on the belly (front, below the eyes); v ~ 0.6 from top
      drawGlyph(ctx, stampDef.glyph, W * 0.5, H * 0.62, 13, stampDef.color);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  shellCache.set(key, tex);
  return tex;
}

// ------------------------------------------------------------------ materials

const matCache = new Map();
function lam(color, extra) {
  const key = `${color}|${extra ? JSON.stringify(extra) : ""}`;
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshLambertMaterial(Object.assign({ color: new THREE.Color(color) }, extra || {})));
  return matCache.get(key);
}
function phong(color, shininess = 50) {
  const key = `phong|${color}|${shininess}`;
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshPhongMaterial({ color: new THREE.Color(color), shininess, specular: 0x444444 }));
  return matCache.get(key);
}
const geoCache = new Map();
function G(key, make) { if (!geoCache.has(key)) geoCache.set(key, make()); return geoCache.get(key); }
const box = (w, h, d) => G(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
const cyl = (rt, rb, h, s = 12) => G(`c${rt},${rb},${h},${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s));
const sph = (r, ws = 12, hs = 8) => G(`s${r},${ws},${hs}`, () => new THREE.SphereGeometry(r, ws, hs));
const tor = (r, t, rs = 8, ts = 20) => G(`t${r},${t},${rs},${ts}`, () => new THREE.TorusGeometry(r, t, rs, ts));
const cone = (r, h, s = 12) => G(`k${r},${h},${s}`, () => new THREE.ConeGeometry(r, h, s));

function mesh(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  return m;
}

// ------------------------------------------------------------------ merging

const mergedMats = {};
function mergedMaterial(kind) {
  if (!mergedMats[kind]) {
    mergedMats[kind] = kind === "phong"
      ? new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 40, specular: 0x333333 })
      : new THREE.MeshLambertMaterial({ vertexColors: true });
  }
  return mergedMats[kind];
}

/**
 * Collapse every plain (untextured, opaque, non-emissive) Lambert/Phong mesh under `group`
 * into one vertex-coloured mesh per material kind. Subtrees flagged with userData.spin
 * (animated parts) and special materials are left alone. Cuts avatar draw calls ~5x.
 */
export function mergeGroup(group) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = { lambert: [], phong: [] };
  const remove = [];
  const animated = (o) => { for (let p = o; p && p !== group; p = p.parent) if (p.userData.spin) return true; return false; };
  group.traverse((o) => {
    if (!o.isMesh || o === group || animated(o)) return;
    const m = o.material;
    if (!(m.isMeshLambertMaterial || m.isMeshPhongMaterial) || m.map || m.transparent || m.vertexColors) return;
    if (m.emissive && m.emissive.getHex() !== 0) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    buckets[m.isMeshPhongMaterial ? "phong" : "lambert"].push([g, m.color]);
    remove.push(o);
  });
  for (const o of remove) o.parent.remove(o);
  for (const kind of ["lambert", "phong"]) {
    const parts = buckets[kind];
    if (!parts.length) continue;
    let n = 0;
    for (const [g] of parts) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
    let o = 0;
    for (const [g, c] of parts) {
      const cnt = g.attributes.position.count;
      pos.set(g.attributes.position.array, o * 3);
      nor.set(g.attributes.normal.array, o * 3);
      for (let i = 0; i < cnt; i++) { col[(o + i) * 3] = c.r; col[(o + i) * 3 + 1] = c.g; col[(o + i) * 3 + 2] = c.b; }
      o += cnt;
      g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    const mm = new THREE.Mesh(geo, mergedMaterial(kind));
    mm.castShadow = true;
    group.add(mm);
  }
  return group;
}

const templates = new Map();
function cached(key, make) {
  if (!templates.has(key)) templates.set(key, mergeGroup(make()));
  return templates.get(key).clone(true);
}

// ------------------------------------------------------------------ hats

/** Hat group sitting on top of the egg (origin = egg top, y = 1.5 local). */
export function buildHat(def) {
  if (!def || def.shape === "none") return new THREE.Group();
  return cached(`hat:${def.id}`, () => makeHat(def));
}

function makeHat(def) {
  const g = new THREE.Group();
  const c = def.colors || ["#ffffff"];
  const c0 = c[0], c1 = c[1] || c0, c2 = c[2] || c1;
  switch (def.shape) {
    case "toque":
      g.add(mesh(cyl(0.2, 0.2, 0.2, 16), lam(c0), 0, -0.02, 0));
      g.add(mesh(sph(0.26, 14, 10), lam(c0), 0, 0.2, 0));
      g.add(mesh(sph(0.16, 10, 8), lam(c0), 0.14, 0.2, 0.08));
      g.add(mesh(sph(0.16, 10, 8), lam(c0), -0.14, 0.22, -0.06));
      break;
    case "cap":
      g.add(mesh(G("capdome", () => new THREE.SphereGeometry(0.25, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)), lam(c0), 0, -0.1, 0));
      { const brim = mesh(cyl(0.2, 0.2, 0.025, 16), lam(c0), 0, -0.1, -0.2); brim.scale.set(1, 1, 0.8); g.add(brim); }
      g.add(mesh(box(0.06, 0.06, 0.06), lam(c1), 0, 0.15, 0));
      break;
    case "beanie":
      g.add(mesh(G("beanie", () => new THREE.SphereGeometry(0.27, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)), lam(c0), 0, -0.12, 0));
      g.add(mesh(cyl(0.275, 0.285, 0.1, 16), lam(c1), 0, -0.12, 0));
      g.add(mesh(sph(0.08, 8, 6), lam(c1), 0, 0.16, 0));
      break;
    case "tophat":
      g.add(mesh(cyl(0.34, 0.34, 0.03, 18), lam(c0), 0, -0.05, 0));
      g.add(mesh(cyl(0.2, 0.21, 0.42, 18), lam(c0), 0, 0.17, 0));
      g.add(mesh(cyl(0.212, 0.215, 0.07, 18), lam(c1), 0, 0.02, 0));
      break;
    case "cowboy": {
      const brim = mesh(cyl(0.48, 0.48, 0.03, 20), lam(c0), 0, -0.06, 0);
      brim.scale.set(1, 1, 0.85);
      g.add(brim);
      g.add(mesh(cyl(0.17, 0.23, 0.3, 14), lam(c0), 0, 0.09, 0));
      g.add(mesh(cyl(0.235, 0.235, 0.05, 14), lam("#3d2a1a"), 0, -0.01, 0));
      break;
    }
    case "crown":
      g.add(mesh(cyl(0.22, 0.22, 0.14, 16, true), phong(c0, 80), 0, 0.0, 0));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        g.add(mesh(cone(0.06, 0.14, 6), phong(c0, 80), Math.sin(a) * 0.2, 0.13, Math.cos(a) * 0.2));
        g.add(mesh(sph(0.03, 6, 4), lam("#d62839"), Math.sin(a) * 0.222, 0.02, Math.cos(a) * 0.222));
      }
      break;
    case "halo":
      g.add(mesh(tor(0.24, 0.035, 8, 24), lam(c0, { emissive: new THREE.Color(c0), emissiveIntensity: 0.8 }), 0, 0.25, 0, Math.PI / 2, 0, 0));
      break;
    case "propeller": {
      g.add(mesh(G("propdome", () => new THREE.SphereGeometry(0.24, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)), lam(c0), 0, -0.1, 0));
      g.add(mesh(cyl(0.015, 0.015, 0.14, 6), lam("#444"), 0, 0.17, 0));
      const prop = new THREE.Group();
      prop.position.y = 0.24;
      prop.add(mesh(box(0.5, 0.012, 0.07), lam(c1), 0, 0, 0));
      prop.add(mesh(box(0.07, 0.012, 0.5), lam(c2), 0, 0, 0));
      prop.userData.spin = 12;
      g.add(prop);
      break;
    }
    case "viking":
      g.add(mesh(G("vikdome", () => new THREE.SphereGeometry(0.28, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)), phong(c0, 60), 0, -0.13, 0));
      g.add(mesh(cyl(0.285, 0.285, 0.05, 16), lam("#7a5a32"), 0, -0.12, 0));
      for (const s of [-1, 1]) {
        const h = mesh(cone(0.06, 0.3, 8), lam(c1), s * 0.3, 0.05, 0, 0, 0, -s * 0.9);
        g.add(h);
      }
      break;
    case "sprout":
      g.add(mesh(cyl(0.012, 0.015, 0.2, 5), lam(c0), 0, 0.05, 0));
      for (const s of [-1, 1]) {
        const l = mesh(sph(0.08, 8, 6), lam(c0), s * 0.07, 0.15, 0);
        l.scale.set(1, 0.3, 0.55);
        l.rotation.z = s * 0.4;
        g.add(l);
      }
      break;
    case "headband": {
      const r = eggRadiusAt(1.2) + 0.012;
      g.add(mesh(cyl(r, r + 0.01, 0.08, 20, true), lam(c0), 0, -0.3, 0));
      g.add(mesh(box(0.05, 0.12, 0.03), lam(c0), 0.06, -0.33, r, 0, 0, 0.5));
      break;
    }
    case "pot":
      g.add(mesh(cyl(0.28, 0.26, 0.24, 18), phong(c0, 90), 0, -0.02, 0));
      g.add(mesh(cyl(0.295, 0.295, 0.025, 18), phong(c0, 90), 0, 0.1, 0));
      g.add(mesh(box(0.06, 0.035, 0.38), lam(c1), 0, 0.03, 0.42));
      break;
    case "beret": {
      const b = mesh(sph(0.27, 14, 8), lam(c0), 0.05, 0.0, 0);
      b.scale.set(1.05, 0.32, 1.0);
      b.rotation.z = -0.25;
      g.add(b);
      g.add(mesh(cyl(0.012, 0.012, 0.06, 5), lam(c0), 0.04, 0.09, 0));
      break;
    }
    default:
      break;
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// ------------------------------------------------------------------ guns

// Original weapon designs, built in a -Z-forward frame with the grip at the origin.
// Each returns {group, muzzle: Vector3 (local), length}.
const GUN_STYLE = {
  benedict: { body: "#3a3f46", acc: "#f29e38", len: 0.62, barrel: 0.3, mag: "box", stock: 1 },
  deviler: { body: "#6b2e2e", acc: "#c9a26b", len: 0.66, barrel: 0.42, mag: "none", stock: 1, double: 1 },
  poacher: { body: "#2f6f6a", acc: "#e8e3d3", len: 0.45, barrel: 0.16, mag: "stick", stock: 0 },
  piercer: { body: "#4a5a3a", acc: "#2b2b2b", len: 0.82, barrel: 0.5, mag: "box", stock: 1, scope: 1 },
  frittata: { body: "#e0b03a", acc: "#3a3a3a", len: 0.6, barrel: 0.28, mag: "box", stock: 1, rail: 1 },
  overeasy: { body: "#ececec", acc: "#f2b632", len: 0.7, barrel: 0.38, mag: "box", stock: 1, scope: 1 },
  souffle: { body: "#a8577e", acc: "#ffd34d", len: 0.6, barrel: 0.0, mag: "none", stock: 0, tube: 1 },
  coddler: { body: "#555b66", acc: "#d9d4c4", len: 0.26, barrel: 0.08, mag: "none", stock: 0, pistol: 1 },
};

export function buildGun(id) {
  const muzzle = gunMuzzle(id);
  return { group: cached(`gun:${id}`, () => makeGun(id).group), muzzle };
}

const muzzles = new Map();
function gunMuzzle(id) {
  if (!muzzles.has(id)) muzzles.set(id, makeGun(id).muzzle);
  return muzzles.get(id).clone();
}

function makeGun(id) {
  const s = GUN_STYLE[id] || GUN_STYLE.benedict;
  const g = new THREE.Group();
  const body = phong(s.body, 30), acc = lam(s.acc), dark = phong("#222428", 40);
  let muzzleZ;
  if (s.tube) {
    g.add(mesh(cyl(0.085, 0.085, 0.62, 14), body, 0, 0.08, -0.22, Math.PI / 2, 0, 0));
    g.add(mesh(cyl(0.1, 0.1, 0.06, 14), acc, 0, 0.08, -0.52, Math.PI / 2, 0, 0));
    g.add(mesh(cyl(0.095, 0.095, 0.05, 14), acc, 0, 0.08, 0.06, Math.PI / 2, 0, 0));
    g.add(mesh(box(0.05, 0.13, 0.07), dark, 0, -0.04, 0));
    g.add(mesh(box(0.04, 0.05, 0.12), dark, 0.0, 0.18, -0.12));
    muzzleZ = -0.56;
  } else if (s.pistol) {
    g.add(mesh(box(0.06, 0.07, 0.24), body, 0, 0.06, -0.08));
    g.add(mesh(box(0.05, 0.13, 0.06), dark, 0, -0.03, 0.0, 0.25, 0, 0));
    g.add(mesh(box(0.062, 0.02, 0.2), acc, 0, 0.1, -0.08));
    muzzleZ = -0.21;
  } else {
    const L = s.len;
    // receiver
    g.add(mesh(box(0.08, 0.1, L * 0.55), body, 0, 0.06, -L * 0.2));
    // barrel(s)
    if (s.double) {
      g.add(mesh(cyl(0.022, 0.022, s.barrel, 10), dark, -0.022, 0.08, -L * 0.47 - s.barrel / 2 + 0.05, Math.PI / 2, 0, 0));
      g.add(mesh(cyl(0.022, 0.022, s.barrel, 10), dark, 0.022, 0.08, -L * 0.47 - s.barrel / 2 + 0.05, Math.PI / 2, 0, 0));
      g.add(mesh(box(0.09, 0.05, 0.2), acc, 0, 0.03, -L * 0.55));
    } else {
      g.add(mesh(cyl(0.018, 0.02, s.barrel, 10), dark, 0, 0.07, -L * 0.47 - s.barrel / 2 + 0.05, Math.PI / 2, 0, 0));
      g.add(mesh(box(0.07, 0.06, 0.16), acc, 0, 0.05, -L * 0.48));
    }
    muzzleZ = -L * 0.47 - s.barrel + 0.05;
    // grip
    g.add(mesh(box(0.05, 0.13, 0.06), dark, 0, -0.03, 0.02, 0.3, 0, 0));
    // magazine
    if (s.mag === "box") g.add(mesh(box(0.05, 0.14, 0.08), dark, 0, -0.04, -L * 0.25, -0.15, 0, 0));
    if (s.mag === "stick") g.add(mesh(box(0.04, 0.18, 0.05), acc, 0, -0.06, -L * 0.22));
    // stock
    if (s.stock) g.add(mesh(box(0.06, 0.1, 0.2), acc, 0, 0.03, 0.15));
    if (s.scope) {
      g.add(mesh(cyl(0.03, 0.03, 0.26, 10), dark, 0, 0.15, -L * 0.2, Math.PI / 2, 0, 0));
      g.add(mesh(cyl(0.04, 0.04, 0.04, 10), dark, 0, 0.15, -L * 0.2 - 0.13, Math.PI / 2, 0, 0));
      g.add(mesh(box(0.02, 0.04, 0.03), dark, 0, 0.12, -L * 0.2));
    }
    if (s.rail) g.add(mesh(box(0.03, 0.03, L * 0.4), dark, 0, 0.125, -L * 0.25));
    if (!s.scope && !s.rail) g.add(mesh(box(0.02, 0.03, 0.02), dark, 0, 0.125, -L * 0.42));
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { group: g, muzzle: new THREE.Vector3(0, s.tube ? 0.08 : 0.07, muzzleZ) };
}

export function buildRollingPin() {
  const g = new THREE.Group();
  g.add(mesh(cyl(0.05, 0.05, 0.42, 14), lam("#e3c08d"), 0, 0, 0, Math.PI / 2, 0, 0));
  g.add(mesh(cyl(0.018, 0.018, 0.14, 8), lam("#a8774a"), 0, 0, 0.27, Math.PI / 2, 0, 0));
  g.add(mesh(cyl(0.018, 0.018, 0.14, 8), lam("#a8774a"), 0, 0, -0.27, Math.PI / 2, 0, 0));
  return g;
}

/** Quiche-bomb grenade: a small pie with a golden top and a fuse sprout. */
export function buildGrenade() { return cached("grenade", makeGrenade); }
function makeGrenade() {
  const g = new THREE.Group();
  g.add(mesh(cyl(0.14, 0.11, 0.09, 14), lam("#c98a3f"), 0, 0, 0));
  g.add(mesh(cyl(0.12, 0.12, 0.02, 14), lam("#ffd34d"), 0, 0.05, 0));
  g.add(mesh(cyl(0.008, 0.008, 0.08, 4), lam("#333"), 0, 0.1, 0));
  g.add(mesh(sph(0.015, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff5a1f }), 0, 0.14, 0));
  return g;
}

/** Launcher shell: a glowing yolk orb. */
export function buildShell() { return cached("shell", makeShell); }
function makeShell() {
  const g = new THREE.Group();
  g.add(mesh(sph(0.15, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffc21a })));
  g.add(mesh(sph(0.2, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff9a1f, transparent: true, opacity: 0.35, depthWrite: false })));
  return g;
}

// ------------------------------------------------------------------ pickups / nests

// Pickups, nests and golden eggs are built once per type / team colour and cloned (sharing
// geometry and materials), so a map change creates no new GPU resources.
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
    // toast soldier: a slice of toast with a butter pat
    inner.add(mesh(box(0.42, 0.46, 0.08), lam("#e0a458"), 0, 0, 0));
    inner.add(mesh(box(0.34, 0.38, 0.09), lam("#f6d39a"), 0, -0.01, 0));
    inner.add(mesh(box(0.14, 0.04, 0.1), lam("#fff1a6"), 0, 0.05, 0.02));
    inner.add(mesh(box(0.06, 0.2, 0.1), lam("#e8423f"), 0, -0.06, 0.05));
    inner.add(mesh(box(0.2, 0.06, 0.1), lam("#e8423f"), 0, -0.06, 0.051));
  } else if (type === "shield") {
    const e = mesh(eggGeometry(), phong("#7fd3ff", 90), 0, -0.25, 0);
    e.scale.setScalar(0.38);
    inner.add(e);
    inner.add(mesh(tor(0.22, 0.02, 6, 20), lam("#ffffff", { emissive: new THREE.Color("#7fd3ff"), emissiveIntensity: 0.6 }), 0, 0.02, 0, Math.PI / 2, 0, 0));
  } else {
    // egg carton with ammo
    inner.add(mesh(box(0.5, 0.16, 0.3), lam("#d9c6a5"), 0, -0.05, 0));
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      inner.add(mesh(sph(0.07, 8, 6), lam("#f5efe3"), -0.16 + i * 0.16, 0.05, -0.07 + j * 0.14));
    }
    inner.add(mesh(box(0.5, 0.03, 0.32), lam("#7da35a"), 0, 0.0, 0));
  }
  // glow disc on the floor
  const ringColor = type === "hp" ? "#ff6b5a" : type === "shield" ? "#6cc9ff" : "#9fd36b";
  const ring = mesh(G("pring", () => new THREE.RingGeometry(0.32, 0.45, 24)), new THREE.MeshBasicMaterial({
    color: new THREE.Color(ringColor), transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide,
  }), 0, 0.03, 0, -Math.PI / 2, 0, 0);
  g.add(ring);
  inner.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  mergeGroup(inner);
  return g;
}

export function buildNest(teamColor) {
  return fromTemplate(`nest|${teamColor}`, () => makeNest(teamColor));
}

function makeNest(teamColor) {
  const g = new THREE.Group();
  const straw = lam("#c9a24b");
  g.add(mesh(tor(0.75, 0.2, 8, 22), straw, 0, 0.15, 0, Math.PI / 2, 0, 0));
  g.add(mesh(cyl(0.8, 0.8, 0.06, 22), lam("#a07e36"), 0, 0.03, 0));
  const ring = mesh(G("nring", () => new THREE.RingGeometry(1.05, 1.2, 32)), new THREE.MeshBasicMaterial({
    color: new THREE.Color(teamColor), transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide,
  }), 0, 0.04, 0, -Math.PI / 2, 0, 0);
  g.add(ring);
  const pole = mesh(cyl(0.03, 0.03, 2.4, 6), lam("#8a6a3a"), 0.9, 1.2, 0);
  g.add(pole);
  const flag = mesh(box(0.5, 0.32, 0.02), lam(teamColor), 1.15, 2.2, 0);
  g.add(flag);
  g.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
  return g;
}

export function buildGoldenEgg(teamColor) {
  return fromTemplate(`gegg|${teamColor}`, () => makeGoldenEgg(teamColor));
}

function makeGoldenEgg(teamColor) {
  const g = new THREE.Group();
  const e = new THREE.Mesh(eggGeometry(), new THREE.MeshPhongMaterial({
    color: 0xf2c94c, emissive: new THREE.Color(teamColor), emissiveIntensity: 0.25, shininess: 100, specular: 0x886622,
  }));
  e.scale.setScalar(0.42);
  e.castShadow = true;
  g.add(e);
  return g;
}

// ------------------------------------------------------------------ egg avatar

/**
 * One player's 3D representation (remote players; also used for the death cam / lobby).
 * Local frame: feet at origin, facing -Z.
 */
export class EggAvatar {
  constructor(data, { name = "", team = 0, teamColor = "#ffffff", cos = {}, cls = "benedict", nameplate = true } = {}) {
    this.data = data;
    this.root = new THREE.Group();
    this.body = new THREE.Group(); // squash/lean pivot at the feet
    this.root.add(this.body);
    this.shellMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.shell = new THREE.Mesh(eggGeometry(), this.shellMat);
    this.shell.castShadow = true;
    this.shell.receiveShadow = false;
    this.body.add(this.shell);
    // eyes
    const eyeY = 1.0;
    const er = eggRadiusAt(eyeY);
    this.body.add(cached("eyes", () => {
      const eyes = new THREE.Group();
      const eyeMat = lam("#1d1b1a"), glint = lam("#ffffff");
      for (const s of [-1, 1]) {
        const eye = mesh(sph(0.055, 10, 8), eyeMat, s * 0.13, eyeY, -er * 0.94);
        eye.scale.set(0.8, 1.25, 0.5);
        eyes.add(eye);
        eyes.add(mesh(sph(0.016, 6, 4), glint, s * 0.13 + 0.015, eyeY + 0.03, -er * 0.94 - 0.03));
      }
      return eyes;
    }));
    // team band
    this.band = mesh(cyl(eggRadiusAt(0.45) + 0.012, eggRadiusAt(0.38) + 0.012, 0.07, 24, true), lam("#ffffff"), 0, 0.42, 0);
    this.band.visible = false;
    this.body.add(this.band);
    // hat
    this.hatAnchor = new THREE.Group();
    this.hatAnchor.position.y = 1.47;
    this.body.add(this.hatAnchor);
    // gun pivot (shoulder) rotates with pitch
    this.gunPivot = new THREE.Group();
    this.gunPivot.position.set(0.3, 0.86, -0.18);
    this.body.add(this.gunPivot);
    this.gunHolder = new THREE.Group();
    this.gunPivot.add(this.gunHolder);
    this.muzzleLocal = new THREE.Vector3();
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
    this.anim = { walk: 0, squash: 0, recoil: 0, melee: 0, prevG: true, vy: 0, lastY: 0, lean: 0 };
    this.setCosmetics(cos);
    this.setTeam(team, teamColor);
    this.setName(name);
    this.setWeapon(cls);
  }

  setCosmetics(cos) {
    const cm = this.data.cosmetics;
    const color = cm.colors.find((c) => c.id === cos.color) || cm.colors.find((c) => c.id === cm.defaults.color) || cm.colors[0];
    const stamp = cm.stamps.find((s) => s.id === cos.stamp) || null;
    const hat = cm.hats.find((h) => h.id === cos.hat) || null;
    this.shellMat.map = shellTexture(color, stamp);
    this.shellMat.needsUpdate = true;
    this.shellColor = color.shell;
    this.hatAnchor.clear();
    this.hat = buildHat(hat);
    this.hatAnchor.add(this.hat);
    this.cos = cos;
  }

  setTeam(team, color) {
    this.team = team;
    this.teamColor = color;
    this.band.visible = team > 0;
    if (team > 0) this.band.material = lam(color);
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
    this.gunHolder.clear();
    const { group, muzzle } = buildGun(id);
    this.gunHolder.add(group);
    this.muzzleLocal.copy(muzzle);
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
    return out.copy(this.muzzleLocal).applyMatrix4(this.gunHolder.matrixWorld);
  }

  fire() { this.anim.recoil = 1; }
  melee() { this.anim.melee = 1; }

  /**
   * Per-frame pose. st: {x,y,z,yaw,pitch,flags}, dt seconds, t time seconds.
   */
  update(st, dt, t) {
    const a = this.anim;
    const r = this.root;
    const dx = st.x - r.position.x, dz = st.z - r.position.z;
    const sp = dt > 0 ? Math.min(12, Math.hypot(dx, dz) / dt) : 0;
    const vy = dt > 0 ? (st.y - a.lastY) / dt : 0;
    a.lastY = st.y;
    r.position.set(st.x, st.y, st.z);
    r.rotation.y = st.yaw;
    const onGround = (st.flags & 2) !== 0;
    if (onGround && !a.prevG && a.vy < -4) a.squash = Math.min(1, -a.vy / 14);
    a.prevG = onGround;
    a.vy = vy;
    a.walk += dt * sp * 2.2;
    a.squash = Math.max(0, a.squash - dt * 5);
    const bob = onGround ? Math.abs(Math.sin(a.walk)) * Math.min(1, sp / 6) * 0.06 : 0;
    const sq = a.squash * 0.18;
    this.body.scale.set(1 + sq * 0.6, 1 - sq + (onGround ? 0 : 0.04), 1 + sq * 0.6);
    this.body.position.y = bob;
    // lean into movement
    const lean = Math.min(1, sp / 6) * 0.12;
    a.lean += (lean - a.lean) * Math.min(1, dt * 8);
    this.body.rotation.x = -a.lean;
    this.body.rotation.z = Math.sin(a.walk) * 0.05 * Math.min(1, sp / 6);
    // gun pitch + recoil + melee swing
    a.recoil = Math.max(0, a.recoil - dt * 8);
    a.melee = Math.max(0, a.melee - dt * 3.5);
    this.gunPivot.rotation.x = st.pitch + a.recoil * 0.25 - Math.sin(a.melee * Math.PI) * 1.2;
    this.gunHolder.position.z = a.recoil * 0.06;
    // effects by flag
    const prot = (st.flags & 16) !== 0, fury = (st.flags & 64) !== 0;
    this.shellMat.emissive.setRGB(fury ? 0.45 + Math.sin(t * 10) * 0.15 : prot ? 0.25 + Math.sin(t * 14) * 0.2 : 0, fury ? 0.05 : prot ? 0.25 + Math.sin(t * 14) * 0.2 : 0, prot && !fury ? 0.3 + Math.sin(t * 14) * 0.2 : 0);
    // spin props
    if (this.hat) this.hat.traverse((o) => { if (o.userData.spin) o.rotation.y += dt * o.userData.spin; });
    if (this.carry) this.carry.rotation.y += dt * 2;
  }

  setVisible(v) { this.root.visible = v; }

  dispose() {
    if (this.plate) { this.plate.material.map.dispose(); this.plate.material.dispose(); }
    this.shellMat.dispose();
  }
}
