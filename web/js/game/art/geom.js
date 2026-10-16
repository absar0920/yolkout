// Procedural geometry helpers for the cartoon art: rounded (bevelled) boxes, bevelled cylinders,
// lathes with explicit normals, capsules, tubes, a merging MeshBuilder that bakes colour + fx
// attributes into one vertex-coloured mesh per animated part, and model statistics.

import * as THREE from "../../../vendor/three.module.min.js";
import { fxMaterial } from "./toon.js";

const geoCache = new Map();
/** Cache a geometry by key (shared between every model instance). */
export function cachedGeo(key, make) {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}

// ------------------------------------------------------------------ primitives

function axisCoords(half, r, seg) {
  if (seg <= 0 || r <= 0) return [-half, half];
  const inner = Math.max(0, half - r);
  const out = [];
  for (let k = 0; k <= seg; k++) out.push(-inner - r * Math.tan((Math.PI / 4) * (1 - k / seg)));
  for (let k = seg; k >= 0; k--) out.push(inner + r * Math.tan((Math.PI / 4) * (1 - k / seg)));
  // dedupe the centre when inner == 0
  return out.filter((v, i) => i === 0 || Math.abs(v - out[i - 1]) > 1e-7);
}

const FACES = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];
const axisOf = (a) => (a[0] ? 0 : a[1] ? 1 : 2);

/**
 * Box with rounded edges and corners (radius r, seg arc segments per 45 degrees; seg 0 = plain box).
 * Normals are analytic, so shared edge vertices shade smoothly.
 */
export function roundedBox(w, h, d, r = Math.min(w, h, d) * 0.15, seg = 1) {
  const half = [w / 2, h / 2, d / 2];
  r = Math.min(r, ...half);
  const inner = half.map((x) => Math.max(0, x - r));
  const pos = [], nor = [], idx = [];
  for (const f of FACES) {
    const ua = axisOf(f.u), va = axisOf(f.v), na = axisOf(f.n);
    const cu = axisCoords(half[ua], r, seg), cv = axisCoords(half[va], r, seg);
    const base = pos.length / 3;
    for (let j = 0; j < cv.length; j++) {
      for (let i = 0; i < cu.length; i++) {
        const p = [0, 0, 0];
        p[na] = f.n[na] * half[na];
        p[ua] += f.u[ua] * cu[i];
        p[va] += f.v[va] * cv[j];
        if (seg > 0 && r > 0) {
          const q = p.map((x, a) => Math.max(-inner[a], Math.min(inner[a], x)));
          let nx = p[0] - q[0], ny = p[1] - q[1], nz = p[2] - q[2];
          const L = Math.hypot(nx, ny, nz) || 1;
          nx /= L; ny /= L; nz /= L;
          pos.push(q[0] + nx * r, q[1] + ny * r, q[2] + nz * r);
          nor.push(nx, ny, nz);
        } else {
          pos.push(p[0], p[1], p[2]);
          nor.push(f.n[0], f.n[1], f.n[2]);
        }
      }
    }
    const nu = cu.length;
    for (let j = 0; j < cv.length - 1; j++) {
      for (let i = 0; i < nu - 1; i++) {
        const a = base + j * nu + i, b = a + 1, c = a + nu + 1, e = a + nu;
        idx.push(a, b, c, a, c, e);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/**
 * Lathe around +Y from a profile of [r, y, nr, ny] points (explicit normals).
 * Points with a repeated (r, y) and different normals make hard edges.
 */
export function latheN(profile, seg = 16, phiStart = 0, phiLen = Math.PI * 2) {
  const pos = [], nor = [], uv = [], idx = [];
  const closed = Math.abs(phiLen - Math.PI * 2) < 1e-6;
  const cols = closed ? seg + 1 : seg + 1;
  for (let i = 0; i < cols; i++) {
    const phi = phiStart + (i / seg) * phiLen;
    const s = Math.sin(phi), c = Math.cos(phi);
    for (let j = 0; j < profile.length; j++) {
      const [r, y, nr, ny] = profile[j];
      pos.push(r * s, y, r * c);
      const L = Math.hypot(nr, ny) || 1;
      nor.push((nr / L) * s, ny / L, (nr / L) * c);
      uv.push(i / seg, j / (profile.length - 1));
    }
  }
  const P = profile.length;
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < P - 1; j++) {
      const a = i * P + j, b = (i + 1) * P + j, c = (i + 1) * P + j + 1, d = i * P + j + 1;
      if (profile[j][0] === profile[j + 1][0] && profile[j][1] === profile[j + 1][1]) continue;
      if (profile[j][0] !== 0) idx.push(a, b, d);
      if (profile[j + 1][0] !== 0) idx.push(b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function arc(out, cx, cy, r, a0, a1, n) {
  for (let k = 0; k <= n; k++) {
    const a = a0 + ((a1 - a0) * k) / n;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, Math.cos(a), Math.sin(a)]);
  }
}

/** Cylinder along Y with rounded rim bevels (bevel = radius of the rounded edge). caps: [bottom, top]. */
export function bevelCyl(rt, rb, h, seg = 16, bevel = Math.min(rt, rb) * 0.2, bseg = 1, caps = [true, true]) {
  const p = [];
  const hy = h / 2;
  const b = Math.min(bevel, Math.min(rt, rb) * 0.9, hy * 0.9);
  const slope = Math.atan2(rb - rt, h); // side normal tilt
  if (caps[0]) {
    p.push([0, -hy, 0, -1]);
    if (b > 0 && bseg > 0) arc(p, rb - b, -hy + b, b, -Math.PI / 2, slope, bseg);
    else { p.push([rb, -hy, 0, -1]); p.push([rb, -hy, Math.cos(slope), Math.sin(slope)]); }
  } else p.push([rb, -hy, Math.cos(slope), Math.sin(slope)]);
  if (caps[1]) {
    if (b > 0 && bseg > 0) arc(p, rt - b, hy - b, b, slope, Math.PI / 2, bseg);
    else { p.push([rt, hy, Math.cos(slope), Math.sin(slope)]); p.push([rt, hy, 0, 1]); }
    p.push([0, hy, 0, 1]);
  } else p.push([rt, hy, Math.cos(slope), Math.sin(slope)]);
  return latheN(p, seg);
}

/** Hollow ring along Y (outer r, inner ri, height h) with rounded lips. */
export function ringTube(r, ri, h, seg = 16, bseg = 1) {
  const t = (r - ri) / 2, hy = h / 2, b = Math.min(t, hy) * 0.9;
  const p = [];
  if (bseg <= 0) {
    p.push([r, -hy, 1, 0], [r, hy, 1, 0], [r, hy, 0, 1], [ri, hy, 0, 1], [ri, hy, -1, 0], [ri, -hy, -1, 0], [ri, -hy, 0, -1], [r, -hy, 0, -1]);
    return latheN(p, seg);
  }
  // outer wall bottom -> top, top lip, inner wall top -> bottom, bottom lip (closed loop)
  p.push([r, -hy + b, 1, 0], [r, hy - b, 1, 0]);
  arc(p, r - b, hy - b, b, 0, Math.PI / 2, bseg);
  arc(p, ri + b, hy - b, b, Math.PI / 2, Math.PI, bseg);
  p.push([ri, hy - b, -1, 0], [ri, -hy + b, -1, 0]);
  arc(p, ri + b, -hy + b, b, Math.PI, Math.PI * 1.5, bseg);
  arc(p, r - b, -hy + b, b, -Math.PI / 2, 0, bseg);
  return latheN(p, seg);
}

/** Capsule along +Y from y=0 to y=len (end caps centred on the ends), radius r0 at the start, r1 at the end. */
export function capsule(r0, r1, len, seg = 8, cseg = 2, cseg1 = cseg) {
  const p = [];
  arc(p, 0, 0, r0, -Math.PI / 2, 0, cseg);
  arc(p, 0, len, r1, 0, Math.PI / 2, cseg1);
  for (const q of p) if (Math.abs(q[0]) < 1e-9) q[0] = 0;
  return latheN(p, seg);
}

/** Ellipsoid (sphere scaled by rx, ry, rz) with correct normals. */
export function ellipsoid(rx, ry, rz, ws = 12, hs = 8) {
  const g = new THREE.SphereGeometry(1, ws, hs);
  g.deleteAttribute("uv");
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) * rx, p.getY(i) * ry, p.getZ(i) * rz);
    const nx = n.getX(i) / rx, ny = n.getY(i) / ry, nz = n.getZ(i) / rz, L = Math.hypot(nx, ny, nz) || 1;
    n.setXYZ(i, nx / L, ny / L, nz / L);
  }
  return g;
}

/** Tube along a smooth curve through `points` ([x,y,z] arrays). */
export function tube(points, radius, tubular = 16, radial = 6, closed = false) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])), closed, "centripetal");
  const g = new THREE.TubeGeometry(curve, tubular, radius, radial, closed);
  g.deleteAttribute("uv");
  return g;
}

/** Torus in the XY plane (around Z). */
export function torus(r, t, rs = 6, ts = 16, arcLen = Math.PI * 2) {
  const g = new THREE.TorusGeometry(r, t, rs, ts, arcLen);
  g.deleteAttribute("uv");
  return g;
}

/** Extruded 2D shape (points [x,y]) along Z with a small bevel; centred on z. */
export function extrudeShape(pts, depth, bevel = 0.004, curveSeg = 1) {
  const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: curveSeg, steps: 1 });
  g.translate(0, 0, -depth / 2);
  g.deleteAttribute("uv");
  return g.index ? g : indexify(g);
}

function indexify(g) {
  const n = g.attributes.position.count;
  const idx = new Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  g.setIndex(idx);
  return g;
}

// ------------------------------------------------------------------ paint + builder

const paintCache = new Map();
/** A paint: linear colour + glow (0..1, unlit emissive look) + tint (0..1, replaced by the material's uTint). */
export function paint(css, glow = 0, tint = 0, ol = 1) {
  const key = `${css}|${glow}|${tint}|${ol}`;
  let p = paintCache.get(key);
  if (!p) { p = { color: new THREE.Color(css), glow, tint, ol }; paintCache.set(key, p); }
  return p;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _n3 = new THREE.Matrix3(), _v = new THREE.Vector3();

/** Matrix from position [x,y,z], euler [rx,ry,rz] (XYZ) and scale (number or [sx,sy,sz]). */
export function trs(p = [0, 0, 0], r = [0, 0, 0], s = 1, out = new THREE.Matrix4()) {
  _e.set(r[0] || 0, r[1] || 0, r[2] || 0, r[3] || "XYZ");
  _q.setFromEuler(_e);
  if (typeof s === "number") _s.set(s, s, s); else _s.set(s[0], s[1], s[2]);
  _p.set(p[0], p[1], p[2]);
  return out.compose(_p, _q, _s);
}

/**
 * Collects primitives into named buckets and merges each bucket into one BufferGeometry with
 * position, normal, color and aFx (glow, tint) attributes (plus skinIndex/skinWeight when `bone` is given).
 */
export class MeshBuilder {
  constructor() { this.buckets = new Map(); }
  /** Add geometry `geo` with paint `pt` to bucket `part`, transformed by matrix `m` (Matrix4) or trs args. */
  add(part, geo, pt, m, bone = -1) {
    let b = this.buckets.get(part);
    if (!b) { b = []; this.buckets.set(part, b); }
    b.push({ geo, pt, m: m ? m.clone() : new THREE.Matrix4(), bone });
    return this;
  }
  has(part) { return this.buckets.has(part) && this.buckets.get(part).length > 0; }
  /** Merge one bucket. */
  merge(part, { skinned = false } = {}) {
    const items = this.buckets.get(part) || [];
    let nv = 0, ni = 0;
    for (const it of items) { nv += it.geo.attributes.position.count; ni += it.geo.index ? it.geo.index.count : it.geo.attributes.position.count; }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), fx = new Float32Array(nv * 2);
    const si = skinned ? new Uint16Array(nv * 4) : null, sw = skinned ? new Float32Array(nv * 4) : null;
    const index = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    const needMask = items.some((it) => it.pt && it.pt.ol !== 1);
    const olm = needMask ? new Float32Array(nv) : null;
    let vo = 0, io = 0;
    for (const it of items) {
      const g = it.geo, P = g.attributes.position, N = g.attributes.normal;
      _n3.getNormalMatrix(it.m);
      const flip = it.m.determinant() < 0;
      for (let i = 0; i < P.count; i++) {
        _v.set(P.getX(i), P.getY(i), P.getZ(i)).applyMatrix4(it.m);
        pos[(vo + i) * 3] = _v.x; pos[(vo + i) * 3 + 1] = _v.y; pos[(vo + i) * 3 + 2] = _v.z;
        if (N) _v.set(N.getX(i), N.getY(i), N.getZ(i)).applyMatrix3(_n3).normalize(); else _v.set(0, 1, 0);
        nor[(vo + i) * 3] = _v.x; nor[(vo + i) * 3 + 1] = _v.y; nor[(vo + i) * 3 + 2] = _v.z;
        if (it.pt) {
          col[(vo + i) * 3] = it.pt.color.r; col[(vo + i) * 3 + 1] = it.pt.color.g; col[(vo + i) * 3 + 2] = it.pt.color.b;
          fx[(vo + i) * 2] = it.pt.glow; fx[(vo + i) * 2 + 1] = it.pt.tint;
        } else {
          const C = g.attributes.color, F = g.attributes.aFx;
          col[(vo + i) * 3] = C ? C.getX(i) : 1; col[(vo + i) * 3 + 1] = C ? C.getY(i) : 1; col[(vo + i) * 3 + 2] = C ? C.getZ(i) : 1;
          fx[(vo + i) * 2] = F ? F.getX(i) : 0; fx[(vo + i) * 2 + 1] = F ? F.getY(i) : 0;
        }
        if (skinned) { si[(vo + i) * 4] = Math.max(0, it.bone); sw[(vo + i) * 4] = 1; }
        if (olm) olm[vo + i] = it.pt ? it.pt.ol : 1;
      }
      if (g.index) {
        const I = g.index.array;
        for (let k = 0; k < I.length; k += 3) {
          if (flip) { index[io++] = I[k] + vo; index[io++] = I[k + 2] + vo; index[io++] = I[k + 1] + vo; }
          else { index[io++] = I[k] + vo; index[io++] = I[k + 1] + vo; index[io++] = I[k + 2] + vo; }
        }
      } else {
        for (let k = 0; k < P.count; k += 3) {
          if (flip) { index[io++] = k + vo; index[io++] = k + 2 + vo; index[io++] = k + 1 + vo; }
          else { index[io++] = k + vo; index[io++] = k + 1 + vo; index[io++] = k + 2 + vo; }
        }
      }
      vo += P.count;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    out.setAttribute("color", new THREE.BufferAttribute(col, 3));
    out.setAttribute("aFx", new THREE.BufferAttribute(fx, 2));
    if (olm) out.userData.olMask = olm; // per-vertex outline width scale (0 = no outline), used by smoothNormalsFor
    if (skinned) {
      out.setAttribute("skinIndex", new THREE.BufferAttribute(si, 4));
      out.setAttribute("skinWeight", new THREE.BufferAttribute(sw, 4));
    }
    out.setIndex(new THREE.BufferAttribute(index, 1));
    out.computeBoundingSphere();
    out.computeBoundingBox();
    return out;
  }
  parts() { return [...this.buckets.keys()]; }
}

/** A mesh using the shared fx material (castShadow on). */
export function fxMesh(geo, tint) {
  const m = new THREE.Mesh(geo, fxMaterial(tint));
  m.castShadow = true;
  return m;
}

/** Ensure a geometry carries the aFx + color attributes the fx material expects. */
export function withFx(geo, css = "#ffffff", glow = 0, tint = 0) {
  const n = geo.attributes.position.count;
  if (!geo.attributes.color) {
    const c = new THREE.Color(css), a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    geo.setAttribute("color", new THREE.BufferAttribute(a, 3));
  }
  if (!geo.attributes.aFx) {
    const f = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { f[i * 2] = glow; f[i * 2 + 1] = tint; }
    geo.setAttribute("aFx", new THREE.BufferAttribute(f, 2));
  }
  return geo;
}

/**
 * Merge every static mesh under `group` (not skinned, not under userData.noMerge / userData.spin,
 * opaque, no texture map) into one vertex-coloured fx mesh. Material colour becomes vertex colour;
 * material.userData.glow (or a non-black emissive) becomes the glow channel. Returns the group.
 */
export function mergeStatic(group) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const B = new MeshBuilder();
  const remove = [];
  const skip = (o) => { for (let p = o; p && p !== group; p = p.parent) if (p.userData.noMerge || p.userData.spin) return true; return false; };
  group.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || o.userData.isOutline || skip(o)) return;
    const m = o.material;
    if (!m || Array.isArray(m) || m.map || m.transparent || !m.color) return;
    let css = "#" + m.color.getHexString(THREE.SRGBColorSpace), glow = m.userData.glow || 0;
    if (m.emissive && m.emissive.getHex() !== 0) { css = "#" + m.emissive.getHexString(THREE.SRGBColorSpace); glow = Math.max(glow, 0.85); }
    if (o.geometry.attributes.color && o.geometry.attributes.aFx) {
      B.add("all", o.geometry, null, new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)); // keep its colours
    } else {
      B.add("all", o.geometry, paint(css, glow, m.userData.tint || 0), new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    }
    remove.push(o);
  });
  if (!remove.length) return group;
  for (const o of remove) o.parent.remove(o);
  group.add(fxMesh(B.merge("all")));
  return group;
}

// ------------------------------------------------------------------ stats

/** Triangles and draw calls of the visible meshes under object3D (outlines counted separately). */
export function modelStats(object3D) {
  let tris = 0, drawCalls = 0, outlineTris = 0, outlineCalls = 0;
  const vis = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  object3D.traverse((o) => {
    if (!(o.isMesh || o.isSprite) || !vis(o)) return;
    const mat = o.material;
    if (mat && mat.visible === false) return;
    let t = 2;
    if (o.isMesh) {
      const g = o.geometry;
      t = (g.index ? g.index.count : g.attributes.position.count) / 3;
      if (g.drawRange && g.drawRange.count !== Infinity) t = Math.min(t, g.drawRange.count / 3);
      if (o.isInstancedMesh) t *= o.count;
    }
    if (o.userData.isOutline) { outlineTris += t; outlineCalls++; } else { tris += t; drawCalls++; }
  });
  return { tris: Math.round(tris), drawCalls, outlineTris: Math.round(outlineTris), outlineCalls };
}

/**
 * Parametric surface: fn(u, v, out:Vector3) with u, v in [0, 1]. nu x nv quads; closedU / closedV weld the seams
 * (smooth normals across them). flip reverses the winding. Normals are computed from the welded mesh.
 */
export function paramSurface(fn, nu, nv, { closedU = false, closedV = false, flip = false } = {}) {
  const cu = closedU ? nu : nu + 1, cv = closedV ? nv : nv + 1;
  const pos = new Float32Array(cu * cv * 3), idx = [];
  const v3 = new THREE.Vector3();
  for (let j = 0; j < cv; j++) for (let i = 0; i < cu; i++) {
    fn(i / nu, j / nv, v3);
    const k = (j * cu + i) * 3;
    pos[k] = v3.x; pos[k + 1] = v3.y; pos[k + 2] = v3.z;
  }
  const id = (i, j) => (j % cv) * cu + (i % cu);
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = id(i, j), b = id(i + 1, j), c = id(i + 1, j + 1), d = id(i, j + 1);
    if (flip) idx.push(a, d, c, a, c, b); else idx.push(a, b, c, a, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Torus around Y (in the XZ plane) whose major radius ripples with n bumps (crimped pie crusts, ramekin flutes). */
export function wavyTorus(R, t, n, amp, rs = 6, ts = 48) {
  return paramSurface((u, v, out) => {
    const th = u * Math.PI * 2, ph = v * Math.PI * 2;
    const r = R + amp * Math.cos(th * n);
    const tt = t * (1 + (amp / Math.max(1e-6, t)) * 0.25 * Math.cos(th * n));
    out.set(Math.cos(th) * (r + tt * Math.cos(ph)), tt * Math.sin(ph), Math.sin(th) * (r + tt * Math.cos(ph)));
  }, ts, rs, { closedU: true, closedV: true, flip: true });
}

/** Fluted cylinder along Y (ramekin): radius r rippled by n flutes of depth amp, height h, closed caps optional. */
export function flutedCyl(r, h, n, amp, radial = 48, rings = 2) {
  return paramSurface((u, v, out) => {
    const th = u * Math.PI * 2;
    const rr = r + amp * Math.abs(Math.cos(th * n * 0.5));
    out.set(Math.sin(th) * rr, (v - 0.5) * h, Math.cos(th) * rr);
  }, radial, rings, { closedU: true });
}

/** Extruded shape with holes (arrays of [x,y] point lists). */
export function extrudeWithHoles(pts, holes, depth, bevel = 0.003, curveSeg = 1) {
  const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) s.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: curveSeg, steps: 1, curveSegments: 6 });
  g.translate(0, 0, -depth / 2);
  g.deleteAttribute("uv");
  return g.index ? g : indexify(g);
}

/** Rounded-rectangle outline as [x,y] points (for extrusions). */
export function roundRectPts(w, h, r, n = 4, cx = 0, cy = 0) {
  const pts = [];
  const corners = [[w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, Math.PI / 2], [-w / 2 + r, -h / 2 + r, Math.PI], [w / 2 - r, -h / 2 + r, Math.PI * 1.5]];
  for (const [x, y, a0] of corners) for (let k = 0; k <= n; k++) {
    const a = a0 + (k / n) * (Math.PI / 2);
    pts.push([cx + x + Math.cos(a) * r, cy + y + Math.sin(a) * r]);
  }
  return pts;
}

/** Quaternion whose local -Z points along `fwd` and local +Y along `up` (orthogonalised). */
export function aimQuat(fwd, up) {
  const z = new THREE.Vector3(-fwd[0], -fwd[1], -fwd[2]).normalize();
  const y = new THREE.Vector3(up[0], up[1], up[2]);
  y.addScaledVector(z, -y.dot(z)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}
/** Quaternion whose local +X points along `xAxis` and local +Y along `yAxis` (orthogonalised). */
export function basisQuat(xAxis, yAxis) {
  const x = new THREE.Vector3(...xAxis).normalize();
  const y = new THREE.Vector3(...yAxis);
  y.addScaledVector(x, -y.dot(x)).normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

/**
 * Bar: a rounded-rectangle cross-section (sx by sy, corner radius r, seg arc points per corner - 1)
 * extruded along Z (length len) with flat end caps. Much cheaper than roundedBox for long parts.
 */
export function roundedBar(sx, sy, len, r, seg = 2) {
  r = Math.min(r, sx / 2 - 1e-5, sy / 2 - 1e-5);
  const ring = [];
  const corners = [[sx / 2 - r, sy / 2 - r, 0], [-sx / 2 + r, sy / 2 - r, Math.PI / 2], [-sx / 2 + r, -sy / 2 + r, Math.PI], [sx / 2 - r, -sy / 2 + r, Math.PI * 1.5]];
  for (const [cx, cy, a0] of corners) for (let k = 0; k <= seg; k++) {
    const a = a0 + (k / seg) * (Math.PI / 2);
    ring.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, Math.cos(a), Math.sin(a)]);
  }
  const n = ring.length, hz = len / 2;
  const pos = [], nor = [], idx = [];
  for (const z of [-hz, hz]) for (const [x, y, nx, ny] of ring) { pos.push(x, y, z); nor.push(nx, ny, 0); }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = i, b = j, c = n + j, d = n + i;
    idx.push(a, b, c, a, c, d);
  }
  // caps (fan from the centre)
  for (const [z, s] of [[-hz, -1], [hz, 1]]) {
    const base = pos.length / 3;
    pos.push(0, 0, z); nor.push(0, 0, s);
    for (const [x, y] of ring) { pos.push(x, y, z); nor.push(0, 0, s); }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (s > 0) idx.push(base, base + 1 + i, base + 1 + j); else idx.push(base, base + 1 + j, base + 1 + i);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}
