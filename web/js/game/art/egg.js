// The egg: lathe shell profile, shell colour/stamp texture, the shell shader (toon ramp + rim, a painted
// cartoon face with blink / brows / pupils / mouth, team band and health-based cracks with a pulsing
// yolk glow at stage 3, all in ONE draw call), the shared crack texture and the stubby shoes.

import * as THREE from "../../../vendor/three.module.min.js";
import { rampTexture, PAL } from "./toon.js";
import { latheN, ellipsoid, MeshBuilder, paint, trs, cachedGeo } from "./geom.js";

// ------------------------------------------------------------------ profile + geometry

export const EGG_H = 1.5, EGG_R = 0.42;
function eggProfile(n = 22) {
  const raw = [];
  let maxR = 0;
  for (let i = 0; i <= n; i++) {
    const th = (i / n) * Math.PI;
    const y = (EGG_H / 2) * (1 - Math.cos(th));
    const r = Math.sin(th) * (1 + 0.13 * Math.cos(th));
    raw.push([r, y]);
    if (r > maxR) maxR = r;
  }
  return raw.map(([r, y]) => new THREE.Vector2(Math.max(0, (r / maxR) * EGG_R), y));
}
const PROFILE = eggProfile();
export const EGG_PROFILE = PROFILE;

/** Shell radius at height y (0..1.5) above the feet. */
export function eggRadiusAt(y) {
  const p = PROFILE;
  for (let i = 1; i < p.length; i++) {
    if (p[i].y >= y) {
      const a = p[i - 1], b = p[i], t = (y - a.y) / Math.max(1e-6, b.y - a.y);
      return a.x + (b.x - a.x) * t;
    }
  }
  return 0;
}

/** Shell geometry (lathe, 30 radial segments, analytic normals, uv u=0.5 at the front -Z). <= 1,400 tris. */
export function eggGeometry(radial = 30) {
  return cachedGeo(`egg:${radial}`, () => {
    const pts = PROFILE.map((p, j) => {
      const a = PROFILE[Math.max(0, j - 1)], b = PROFILE[Math.min(PROFILE.length - 1, j + 1)];
      const dr = b.x - a.x, dy = b.y - a.y;
      let nr = dy, ny = -dr;
      if (j === 0) { nr = 0; ny = -1; }
      if (j === PROFILE.length - 1) { nr = 0; ny = 1; }
      return [p.x, p.y, nr, ny];
    });
    return latheN(pts, radial);
  });
}

// ------------------------------------------------------------------ shell texture (colour + speckles + stamp)

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
/** Shell colour texture: base + speckles + stamp (front of the egg is u = 0.5). */
export function shellTexture(colorDef, stampDef) {
  const key = `${colorDef.id}|${stampDef ? stampDef.id : ""}`;
  if (shellCache.has(key)) return shellCache.get(key);
  const W = 512, H = 256;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  ctx.fillStyle = colorDef.shell; ctx.fillRect(0, 0, W, H);
  // soft painted value variation (cartoon "hand-painted" shell)
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "rgba(255,255,255,0.16)"); g.addColorStop(0.45, "rgba(255,255,255,0)"); g.addColorStop(1, "rgba(0,0,0,0.1)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  let a = 1337;
  const r = () => ((a = (a * 1103515245 + 12345) >>> 0) / 4294967296);
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = "#000";
  for (let i = 0; i < 40; i++) { ctx.beginPath(); ctx.ellipse(r() * W, r() * H, 12 + r() * 30, 6 + r() * 14, r() * 3, 0, 6.3); ctx.fill(); }
  ctx.globalAlpha = 1;
  if (colorDef.speckle) {
    ctx.fillStyle = colorDef.speckle;
    for (let i = 0; i < 220; i++) {
      ctx.globalAlpha = 0.4 + r() * 0.55;
      const x = r() * W, y = r() * H;
      // keep the face area (front, eye height) clean-ish
      if (Math.abs(x - W / 2) < 60 && y > H * 0.18 && y < H * 0.42 && r() < 0.8) continue;
      ctx.beginPath(); ctx.ellipse(x, y, 2 + r() * 6, 2 + r() * 4.5, r() * 3, 0, 6.3); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  if (stampDef && stampDef.glyph) {
    if (stampDef.glyph === "stripes") {
      ctx.fillStyle = stampDef.color;
      ctx.fillRect(W * 0.5 - 44, 0, 24, H); ctx.fillRect(W * 0.5 + 20, 0, 24, H);
    } else {
      // stamp on the belly (front, below the face), with a dark ink rim for the cartoon look
      ctx.save();
      ctx.shadowColor = "rgba(30,22,34,0.55)"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 3;
      drawGlyph(ctx, stampDef.glyph, W * 0.5, H * 0.64, 24, stampDef.color);
      ctx.restore();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  shellCache.set(key, tex);
  return tex;
}

// ------------------------------------------------------------------ crack texture

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let crackTex = null;
/**
 * Shared crack texture (512x256): R = stage-1 lines, G = stage-2 extra lines, B = stage-3 extra lines,
 * A = blurred stage-3 mask (yolk glow). Generated once.
 */
export function crackTexture() {
  if (crackTex) return crackTex;
  const W = 512, H = 256;
  const R = rng(4242);
  const layer = () => { const c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d"); x.fillStyle = "#000"; x.fillRect(0, 0, W, H); return [c, x]; };
  const crack = (ctx, x0, y0, len, width, depth) => {
    // jagged branching polyline; drawn 3x (u wrap)
    let x = x0, y = y0, ang = R() * Math.PI * 2;
    const pts = [[x, y]];
    const steps = Math.max(3, Math.round(len / 14));
    for (let i = 0; i < steps; i++) {
      ang += (R() - 0.5) * 1.3;
      const st = 9 + R() * 12;
      x += Math.cos(ang) * st; y += Math.sin(ang) * st * 0.8;
      y = Math.max(6, Math.min(H - 6, y));
      pts.push([x, y]);
      if (depth > 0 && R() < 0.33) crack(ctx, x, y, len * (0.35 + R() * 0.3), Math.max(1.4, width * 0.6), depth - 1);
    }
    for (const off of [-W, 0, W]) {
      ctx.beginPath();
      pts.forEach(([px, py], i) => (i ? ctx.lineTo(px + off, py) : ctx.moveTo(px + off, py)));
      ctx.lineWidth = width; ctx.lineJoin = "miter"; ctx.lineCap = "round"; ctx.strokeStyle = "#fff"; ctx.stroke();
    }
    return pts;
  };
  const [c1, x1] = layer(), [c2, x2] = layer(), [c3, x3] = layer(), [c4, x4] = layer();
  // stage 1: a few hairline cracks around the shoulders / back
  for (let i = 0; i < 7; i++) crack(x1, ((i + 0.3 * R()) / 7) * W, (0.14 + 0.24 * R()) * H, 80 + R() * 40, 5, 1);
  // stage 2: longer cracks all around the body
  for (let i = 0; i < 6; i++) crack(x2, ((i + 0.5 + 0.3 * R()) / 6) * W, (0.36 + 0.34 * R()) * H, 120 + R() * 50, 5.5, 2);
  // stage 3: big shattering cracks + impact stars
  const big = [];
  for (const [u, v] of [[0.2, 0.15], [0.55, 0.42], [0.58, 0.78], [0.9, 0.25], [0.36, 0.72], [0.08, 0.88]]) {
    for (let k = 0; k < 4; k++) big.push(crack(x3, u * W, v * H, 60 + R() * 70, 6, 2));
  }
  // yolk mask: thick blurred strokes along the stage-3 cracks
  x4.filter = "blur(5px)";
  for (const pts of big) for (const off of [-W, 0, W]) {
    x4.beginPath();
    pts.forEach(([px, py], i) => (i ? x4.lineTo(px + off, py) : x4.moveTo(px + off, py)));
    x4.lineWidth = 9; x4.strokeStyle = "#fff"; x4.lineCap = "round"; x4.stroke();
  }
  x4.filter = "none";
  const out = document.createElement("canvas"); out.width = W; out.height = H;
  const xo = out.getContext("2d");
  const img = xo.createImageData(W, H);
  const d1 = x1.getImageData(0, 0, W, H).data, d2 = x2.getImageData(0, 0, W, H).data, d3 = x3.getImageData(0, 0, W, H).data, d4 = x4.getImageData(0, 0, W, H).data;
  for (let i = 0; i < W * H * 4; i += 4) {
    img.data[i] = d1[i]; img.data[i + 1] = d2[i]; img.data[i + 2] = d3[i]; img.data[i + 3] = d4[i];
  }
  xo.putImageData(img, 0, 0);
  crackTex = new THREE.CanvasTexture(out);
  crackTex.colorSpace = THREE.NoColorSpace;
  crackTex.wrapS = THREE.RepeatWrapping;
  crackTex.premultiplyAlpha = false;
  crackTex.anisotropy = 4;
  return crackTex;
}

// ------------------------------------------------------------------ shell shader

const SHELL_VERT_PARS = `#include <common>
varying vec3 vObjPos;`;
const SHELL_VERT_MAIN = `#include <begin_vertex>
vObjPos = position;`;
const SHELL_FRAG_PARS = `#include <common>
uniform float uRim;
uniform vec3 uRimColor;
uniform sampler2D uCrackMap;
uniform float uCrack, uCrackFlash, uCrackU, uTime;
uniform vec3 uCrackColor, uYolk;
uniform float uBlink, uBrow, uMouth, uFace, uBand;
uniform vec2 uLook;
uniform vec3 uBandColor, uSclera, uInk, uBrowColor;
varying vec3 vObjPos;
float yoAA(float d) { float w = fwidth(d) * 0.75; return 1.0 - smoothstep(-w, w, d); }
float yoSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }`;
const SHELL_FRAG_FACE = `#include <color_fragment>
{
  // team band
  float bd = abs(vObjPos.y - 0.42) - 0.034;
  diffuseColor.rgb = mix(diffuseColor.rgb, uBandColor, uBand * yoAA(bd));
  float bdEdge = abs(bd) - 0.004;
  diffuseColor.rgb = mix(diffuseColor.rgb, uInk, uBand * yoAA(bdEdge) * 0.6);
  // painted cartoon face on the front (-Z), projected from the front
  if (vObjPos.z < -0.05 && uFace > 0.5) {
    vec2 f = vObjPos.xy;
    vec3 base = diffuseColor.rgb;
    vec3 col = base;
    for (int i = 0; i < 2; i++) {
      float s = i == 0 ? -1.0 : 1.0;
      vec2 c = vec2(s * 0.122, 1.0);
      vec2 rad = vec2(0.074, 0.098);
      vec2 q = (f - c) / rad;
      float d = (length(q) - 1.0) * rad.x;
      float lidY = c.y + rad.y * (1.0 - 2.05 * uBlink);
      float open = 1.0 - smoothstep(lidY - 0.003, lidY + 0.003, f.y);
      float inside = yoAA(d);
      // ink rim, closed lid (shell tone), sclera
      col = mix(col, uInk, yoAA(d - 0.009));
      col = mix(col, base * 0.86, inside * (1.0 - open));
      float sc = inside * open;
      col = mix(col, uSclera, sc);
      // pupil + glint
      vec2 pc = c + vec2(-s * 0.012 + uLook.x * 0.022, -0.012 + uLook.y * 0.03);
      float pd = length((f - pc) / vec2(0.042, 0.052)) - 1.0;
      col = mix(col, uInk, yoAA(pd * 0.042) * sc);
      float gd = length(f - (pc + vec2(0.014, 0.02))) - 0.012;
      col = mix(col, uSclera, yoAA(gd) * sc);
      float gd2 = length(f - (pc + vec2(-0.012, -0.018))) - 0.005;
      col = mix(col, uSclera, yoAA(gd2) * sc * 0.8);
      // eyelid line when (half) closed
      float lid = abs(f.y - lidY) - 0.006;
      col = mix(col, uInk, yoAA(lid) * yoAA(d - 0.009) * step(0.04, uBlink));
      // brow: inner end (toward the centre) moves with uBrow (+1 angry: inner down, -1 worried: inner up)
      vec2 bi = c + vec2(-s * 0.05, 0.128 - 0.035 * uBrow);
      vec2 bo = c + vec2(s * 0.062, 0.14 + 0.012 * uBrow);
      float bw = yoSeg(f, bi, bo) - 0.0155;
      col = mix(col, uBrowColor, yoAA(bw));
    }
    // mouth: a small curve (uMouth +1 smile, 0 flat, -1 frown); open "o" when very hurt
    float mx = clamp(f.x, -0.05, 0.05);
    float my = 0.835 + uMouth * (mx * mx * 9.0 - 0.012);
    float md = length(vec2(f.x - mx, f.y - my)) - 0.0075;
    float oh = length((f - vec2(0.0, 0.83)) / vec2(0.022, 0.028)) - 1.0;
    col = mix(col, uInk, uMouth > -0.9 ? yoAA(md) : yoAA(oh * 0.022));
    diffuseColor.rgb = col;
  }
  // cracks: R = stage 1, G = stage 2, B = stage 3 (+ A = yolk glow mask)
  #ifdef USE_MAP
  vec4 ck = texture2D(uCrackMap, vec2(vMapUv.x + uCrackU, vMapUv.y));
  #else
  vec4 ck = vec4(0.0);
  #endif
  float k1 = clamp((uCrack - 0.25) * 2.0, 0.0, 1.0), k2 = clamp((uCrack - 1.25) * 2.0, 0.0, 1.0), k3 = clamp((uCrack - 2.25) * 2.0, 0.0, 1.0);
  float cr = max(ck.r * k1, max(ck.g * k2, ck.b * k3));
  vec3 crc = mix(uCrackColor, uYolk, k3 * ck.a * 0.3);
  crc = mix(crc, vec3(1.0, 0.86, 0.55), uCrackFlash * 0.75);
  diffuseColor.rgb = mix(diffuseColor.rgb, crc, cr * 0.9);
  totalEmissiveRadiance += uYolk * ck.a * k3 * 0.4 * (0.8 + 0.2 * sin(uTime * 6.0));
  totalEmissiveRadiance += uYolk * cr * uCrackFlash * 0.6;
}`;
const SHELL_FRAG_OUT = `float yoRim = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);
outgoingLight += uRimColor * uRim * yoRim;
#include <opaque_fragment>`;

function shellCompile(shader) {
  const u = this.userData.yo;
  Object.assign(shader.uniforms, u);
  shader.vertexShader = shader.vertexShader.replace("#include <common>", SHELL_VERT_PARS).replace("#include <begin_vertex>", SHELL_VERT_MAIN);
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", SHELL_FRAG_PARS)
    .replace("#include <color_fragment>", SHELL_FRAG_FACE)
    .replace("#include <opaque_fragment>", SHELL_FRAG_OUT);
}
function shellKey() { return "yo-shell-1"; }

/** Per-avatar shell material (toon + face + band + cracks). uniforms live in material.userData.yo. */
export function shellMaterial(map) {
  const m = new THREE.MeshToonMaterial({ color: 0xffffff, map: map || null, gradientMap: rampTexture() });
  m.userData.yo = {
    uRim: { value: 0.32 }, uRimColor: { value: new THREE.Color("#fff3d6") },
    uCrackMap: { value: crackTexture() }, uCrack: { value: 0 }, uCrackFlash: { value: 0 }, uCrackU: { value: 0 }, uTime: { value: 0 },
    uCrackColor: { value: new THREE.Color("#3b2616") }, uYolk: { value: new THREE.Color("#ffb21a") },
    uBlink: { value: 0 }, uBrow: { value: 0 }, uMouth: { value: 0.6 }, uFace: { value: 1 }, uBand: { value: 0 },
    uLook: { value: new THREE.Vector2() },
    uBandColor: { value: new THREE.Color("#ffffff") }, uSclera: { value: new THREE.Color("#ffffff") },
    uInk: { value: new THREE.Color(PAL.ink) }, uBrowColor: { value: new THREE.Color("#3b2a20") },
  };
  m.onBeforeCompile = shellCompile;
  m.customProgramCacheKey = shellKey;
  return m;
}

/** Hook the crack uniforms into a shell material (no-op when already a shell material). */
export function applyCrack(material) {
  if (material.userData.yo && material.userData.yo.uCrack) return material;
  const fresh = shellMaterial(material.map);
  material.userData.yo = fresh.userData.yo;
  material.gradientMap = fresh.gradientMap;
  material.onBeforeCompile = shellCompile;
  material.customProgramCacheKey = shellKey;
  material.needsUpdate = true;
  fresh.dispose();
  return material;
}

/** Set crack stage (0..3, fractional eases between stages) and flash (0..1) on a shell material. */
export function setCrack(material, stage, flash = 0) {
  const u = material.userData.yo;
  if (!u || !u.uCrack) return;
  u.uCrack.value = stage;
  u.uCrackFlash.value = flash;
}

// ------------------------------------------------------------------ shoes

/** Stubby cartoon shoe (left or right is the same shape), toe toward -Z, sole at y = 0. */
export function shoeGeometry(color = "#d0573f") {
  return cachedGeo(`shoe:${color}`, () => {
    const B = new MeshBuilder();
    B.add("s", ellipsoid(0.085, 0.06, 0.12, 8, 5), paint(color), trs([0, 0.058, -0.02]));
    B.add("s", ellipsoid(0.09, 0.024, 0.126, 8, 3), paint("#f4efe6"), trs([0, 0.018, -0.02]));
    B.add("s", ellipsoid(0.05, 0.026, 0.04, 5, 3), paint("#ffffff"), trs([0, 0.09, -0.085], [0.5, 0, 0]));
    return B.merge("s");
  });
}

export const CRACK_STAGES = [0.75, 0.5, 0.25];
/** Crack stage from hp fraction: >= 0.75 -> 0, >= 0.5 -> 1, >= 0.25 -> 2, else 3. */
export function crackStage(hpFrac) {
  return hpFrac >= 0.75 ? 0 : hpFrac >= 0.5 ? 1 : hpFrac >= 0.25 ? 2 : 3;
}
