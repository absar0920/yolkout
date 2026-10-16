// Toon shading for Yolkout's cartoon art: a shared 3-step gradient ramp, a rim/fresnel term,
// per-vertex "fx" (glow + cuff tint) for merged vertex-coloured meshes, inverted-hull outlines
// and the palette. Every material is cached by key; nothing here allocates per instance.

import * as THREE from "../../../vendor/three.module.min.js";

// ------------------------------------------------------------------ palette

export const PAL = {
  ink: "#1e1622",
  metal: "#2a2c33",
  metalMid: "#3c3f48",
  metalHi: "#5a5e6a",
  glove: "#fbfaf6",
  gloveShade: "#e8e3d8",
  wood: "#c9a26b",
  woodDark: "#8a6238",
  brass: "#e2b04a",
  copper: "#d07a3e",
  rubber: "#24232a",
  yolk: "#f7b52c",
  yolkHot: "#ff9a1f",
  lens: "#16202b",
  glint: "#9fe8ff",
  white: "#f2f0ea",
  red: "#d23b2f",
  benedict: ["#3a3f46", "#f29e38"],
  deviler: ["#b8432f", "#c9a26b"],
  poacher: ["#2f8f88", "#efe8d6"],
  piercer: ["#56683f", "#26262b"],
  frittata: ["#f0bf3c", "#33333a"],
  overeasy: ["#f2f0ea", "#f7b52c"],
  souffle: ["#b05587", "#ffd34d"],
  coddler: ["#5b6270", "#e2dccb"],
};

// ------------------------------------------------------------------ ramp

let ramp = null;
/** Shared 3-band toon ramp (levels 0.42 / 0.72 / 1.0, nearest filtering). */
export function rampTexture(levels = [0.42, 0.72, 1.0]) {
  if (ramp && levels.length === 3 && levels[0] === 0.42) return ramp;
  const data = new Uint8Array(levels.map((v) => Math.round(v * 255)));
  const t = new THREE.DataTexture(data, levels.length, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  if (levels.length === 3 && levels[0] === 0.42) ramp = t;
  return t;
}

// ------------------------------------------------------------------ toon material

// One onBeforeCompile for every toon material, so three shares programs between them.
// YO_FX (merged meshes): attribute aFx = (glow, tint). glow 1 = unlit emissive colour, tint 1 = uTint.
const VERT_PARS = `#include <common>
#ifdef YO_FX
attribute vec2 aFx;
varying vec2 vFx;
#endif`;
const VERT_MAIN = `#include <begin_vertex>
#ifdef YO_FX
vFx = aFx;
#endif`;
const FRAG_PARS = `#include <common>
uniform float uRim;
uniform vec3 uRimColor;
#ifdef YO_FX
uniform vec3 uTint;
varying vec2 vFx;
#endif`;
const FRAG_COLOR = `#include <color_fragment>
#ifdef YO_FX
diffuseColor.rgb = mix(diffuseColor.rgb, uTint, vFx.y);
#endif`;
const FRAG_OUT = `float yoRim = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);
outgoingLight += uRimColor * uRim * yoRim;
#ifdef YO_FX
outgoingLight = mix(outgoingLight, diffuseColor.rgb * 1.15 + uRimColor * uRim * yoRim * 0.5, vFx.x);
#endif
#include <opaque_fragment>`;

function toonCompile(shader) {
  const u = this.userData.yo;
  shader.uniforms.uRim = u.uRim;
  shader.uniforms.uRimColor = u.uRimColor;
  if (u.uTint) shader.uniforms.uTint = u.uTint;
  shader.vertexShader = shader.vertexShader.replace("#include <common>", VERT_PARS).replace("#include <begin_vertex>", VERT_MAIN);
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", FRAG_PARS)
    .replace("#include <color_fragment>", FRAG_COLOR)
    .replace("#include <opaque_fragment>", FRAG_OUT);
}
function toonKey() { return "yo-toon-1"; }

const toonCache = new Map();
/**
 * Shared toon material. opts: {map, vertexColors, emissive, emissiveIntensity, rim=0.35, rimColor="#fff3d6",
 * fx (merged-mesh glow/tint attribute), tint (css, with fx), side, transparent, opacity, flatShading}.
 * `skinning` is accepted for API symmetry (three enables skinning per mesh automatically).
 */
export function toonMaterial(color = "#ffffff", opts = {}) {
  const rim = opts.rim ?? 0.35, rimColor = opts.rimColor || "#fff3d6";
  const key = [color, opts.map ? opts.map.uuid : "", opts.vertexColors ? 1 : 0, opts.fx ? 1 : 0, opts.tint || "",
    opts.emissive || "", opts.emissiveIntensity ?? 1, rim, rimColor, opts.side ?? 0, opts.transparent ? opts.opacity ?? 1 : "", opts.flatShading ? 1 : 0].join("|");
  let m = toonCache.get(key);
  if (m) return m;
  m = new THREE.MeshToonMaterial({
    color: new THREE.Color(color), gradientMap: rampTexture(), map: opts.map || null,
    vertexColors: !!(opts.vertexColors || opts.fx), side: opts.side ?? THREE.FrontSide,
    transparent: !!opts.transparent, opacity: opts.opacity ?? 1,
  });
  if (opts.flatShading) m.flatShading = true;
  if (opts.emissive) { m.emissive = new THREE.Color(opts.emissive); m.emissiveIntensity = opts.emissiveIntensity ?? 1; }
  m.userData.yo = { uRim: { value: rim }, uRimColor: { value: new THREE.Color(rimColor) } };
  if (opts.fx) {
    m.defines = { YO_FX: "" };
    m.userData.yo.uTint = { value: new THREE.Color(opts.tint || "#ffffff") };
  }
  m.onBeforeCompile = toonCompile;
  m.customProgramCacheKey = toonKey;
  m.name = `toon:${key}`;
  toonCache.set(key, m);
  return m;
}

/** The single material every merged (vertex-coloured, glow/tint attribute) mesh uses. */
export function fxMaterial(tint = "#ffffff", rim = 0.35) {
  return toonMaterial("#ffffff", { fx: true, tint, rim });
}

export function toonCompileHook() { return { onBeforeCompile: toonCompile, key: toonKey }; }

// ------------------------------------------------------------------ outlines

const OUT_PARS = `#include <common>
attribute vec3 outlineNormal;
uniform float uOW;`;
const OUT_MAIN = `vec3 transformed = vec3(position) + outlineNormal * uOW;
#ifdef USE_ALPHAHASH
vPosition = vec3(position);
#endif`;
function outlineCompile(shader) {
  shader.uniforms.uOW = this.userData.uOW;
  shader.vertexShader = shader.vertexShader.replace("#include <common>", OUT_PARS).replace("#include <begin_vertex>", OUT_MAIN);
}
function outlineKey() { return "yo-outline-1"; }

let outlineQuality = "high";
const outlineMats = new Map();
function outlineMaterial(width, color) {
  const key = `${width}|${color}`;
  let m = outlineMats.get(key);
  if (m) return m;
  m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), side: THREE.BackSide });
  m.userData.uOW = { value: width };
  m.onBeforeCompile = outlineCompile;
  m.customProgramCacheKey = outlineKey;
  m.visible = outlineQuality !== "low";
  m.name = `outline:${key}`;
  outlineMats.set(key, m);
  return m;
}

/** Averaged (position-welded) normals, cached on the geometry as attribute `outlineNormal`. */
export function smoothNormalsFor(geo) {
  if (geo.attributes.outlineNormal) return geo.attributes.outlineNormal;
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const n = pos.count;
  const out = new Float32Array(n * 3);
  const map = new Map();
  const q = 1e4;
  const keys = new Array(n);
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos.getX(i) * q)},${Math.round(pos.getY(i) * q)},${Math.round(pos.getZ(i) * q)}`;
    keys[i] = k;
    let acc = map.get(k);
    if (!acc) { acc = [0, 0, 0]; map.set(k, acc); }
    if (nor) { acc[0] += nor.getX(i); acc[1] += nor.getY(i); acc[2] += nor.getZ(i); }
  }
  const mask = geo.userData && geo.userData.olMask;
  for (let i = 0; i < n; i++) {
    const a = map.get(keys[i]);
    const L = (Math.hypot(a[0], a[1], a[2]) || 1) / (mask ? mask[i] : 1);
    out[i * 3] = a[0] / L; out[i * 3 + 1] = a[1] / L; out[i * 3 + 2] = a[2] / L;
  }
  const attr = new THREE.BufferAttribute(out, 3);
  geo.setAttribute("outlineNormal", attr);
  return attr;
}

/**
 * Add inverted-hull outline meshes as children of every mesh under `object3D`
 * (skips other outlines, sprites, points and meshes flagged userData.noOutline).
 * Skinned meshes get a skinned outline bound to the same skeleton. Returns the outline meshes.
 */
export function addOutline(object3D, { width = 0.0045, color = PAL.ink } = {}) {
  const mat = outlineMaterial(width, color);
  const targets = [];
  object3D.traverse((o) => {
    if (o.isMesh && !o.userData.isOutline && !o.userData.noOutline && !o.isInstancedMesh) targets.push(o);
  });
  const out = [];
  for (const o of targets) {
    smoothNormalsFor(o.geometry);
    let m;
    if (o.isSkinnedMesh) {
      m = new THREE.SkinnedMesh(o.geometry, mat);
      m.bind(o.skeleton, o.bindMatrix);
    } else {
      m = new THREE.Mesh(o.geometry, mat);
    }
    m.userData.isOutline = true;
    m.castShadow = false;
    m.receiveShadow = false;
    m.frustumCulled = o.frustumCulled;
    if (o.boundingSphere && o.isSkinnedMesh) m.boundingSphere = o.boundingSphere;
    m.renderOrder = o.renderOrder;
    m.raycast = () => {};
    o.add(m);
    out.push(m);
  }
  return out;
}

/** "low" hides every outline; "medium" and "high" show them. */
export function setOutlineQuality(q) {
  outlineQuality = q || "high";
  for (const m of outlineMats.values()) m.visible = outlineQuality !== "low";
}
export function getOutlineQuality() { return outlineQuality; }
