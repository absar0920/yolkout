// Pooled visual effects. Everything is instanced or pooled: no allocations of
// meshes/materials during play.
//  - tracers (moving bullet streaks), muzzle flashes for remote players
//  - particles (sparks, dust, yolk droplets, shell shards, explosion debris/smoke)
//  - decals (bullet holes, yolk splats) on world surfaces
//  - explosions (stepped-colour toon fireball + shock ring + debris + light flash)
//  - casings (instanced brass / shotgun shells ejected from the first-person gun)
//  - cartoon star muzzle flashes, rocket smoke trails
//
// Tracers are drawn from tail to head and never past their impact point (docs/V2_SPEC.md 6): the streak box
// spans local z in [-1, 0], is rotated so -Z points along the shot and is composed at the TAIL with
// scale z = head - tail, so its far end is the head, which is clamped to the impact distance L.

import * as THREE from "../../vendor/three.module.min.js";
import { radialTexture, holeTexture, splatTexture } from "../engine/textures.js";
import { buildCasing, fxMaterial } from "./art/index.js";

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1);
const _c = new THREE.Color(), _fwd = new THREE.Vector3(0, 0, -1), _qr = new THREE.Quaternion();
const _e = new THREE.Euler();

/**
 * Visible segment of a tracer: distances along its direction from its start, tail <= head <= L.
 * out = [tail, head]. Pure (exported for tests).
 */
export function tracerSegment(tr, out = [0, 0]) {
  const travel = tr.t * tr.speed;
  const head = Math.min(tr.L, travel);
  const tail = Math.min(head, Math.max(0, travel - tr.len));
  out[0] = tail; out[1] = head;
  return out;
}

const _seg = [0, 0];
/** Instance matrix of a tracer streak box (geometry z in [-1, 0]); far end = head. Returns false when spent. */
export function tracerMatrix(tr, out) {
  tracerSegment(tr, _seg);
  const tail = _seg[0], head = _seg[1];
  if (tail >= tr.L - 0.01) return false;
  _p.set(tr.sx + tr.dx * tail, tr.sy + tr.dy * tail, tr.sz + tr.dz * tail);
  _b.set(tr.dx, tr.dy, tr.dz);
  _q.setFromUnitVectors(_fwd, _b);
  _s.set(tr.width, tr.width, Math.max(1e-4, head - tail));
  out.compose(_p, _q, _s);
  return true;
}

let starTex = null;
/** Cartoon 8-point star (additive muzzle flash). */
function starTexture() {
  if (starTex || typeof document === "undefined") return starTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,235,1)"); grad.addColorStop(0.4, "rgba(255,210,80,0.95)"); grad.addColorStop(1, "rgba(255,110,20,0)");
  g.fillStyle = grad;
  g.beginPath();
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, r = i % 2 ? 24 : 62; g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r); }
  g.closePath(); g.fill();
  starTex = new THREE.CanvasTexture(c);
  starTex.colorSpace = THREE.SRGBColorSpace;
  return starTex;
}

/**
 * Set an InstancedMesh's live count and upload only that range. Nothing is uploaded when no
 * instance is live (count 0 draws nothing), instead of the whole pool every frame.
 */
function uploadInstances(mesh, n) {
  mesh.count = n;
  if (n === 0) return;
  const im = mesh.instanceMatrix;
  im.clearUpdateRanges();
  im.addUpdateRange(0, n * 16);
  im.needsUpdate = true;
  const ic = mesh.instanceColor;
  if (ic) {
    ic.clearUpdateRanges();
    ic.addUpdateRange(0, n * 3);
    ic.needsUpdate = true;
  }
}

export class Effects {
  constructor(renderer, sim, opts = {}) {
    this.r = renderer;
    this.scene = renderer.scene;
    this.sim = sim; // physics module (raycastWorldN etc.)
    this.world = null;
    this.lowFx = !!opts.lowFx;
    this.group = new THREE.Group();
    this.scene.add(this.group);

    // tracers
    this.maxTracers = 64;
    this.tracers = [];
    const tg = new THREE.BoxGeometry(1, 1, 1);
    tg.translate(0, 0, -0.5);
    const tmat = new THREE.MeshBasicMaterial({
      color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false,
    });
    // streak gradient (dim tail -> bright head) and a fade close to the camera, so a shot passing right by
    // your head reads as a quick flick instead of a wide white bar across the screen
    tmat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying float vTrHead;\nvarying float vTrNear;")
        .replace("#include <project_vertex>", "#include <project_vertex>\nvTrHead = clamp(-position.z, 0.0, 1.0);\nvTrNear = smoothstep(0.4, 3.5, -mvPosition.z);");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vTrHead;\nvarying float vTrNear;")
        .replace("#include <opaque_fragment>", "#include <opaque_fragment>\ngl_FragColor.rgb *= (0.3 + 0.7 * vTrHead) * vTrNear;");
    };
    tmat.customProgramCacheKey = () => "tracerFade";
    this.tracerMesh = new THREE.InstancedMesh(tg, tmat, this.maxTracers);
    this.tracerMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.maxTracers * 3), 3);
    this.tracerMesh.count = 0;
    this.tracerMesh.frustumCulled = false;
    this.group.add(this.tracerMesh);

    // particles
    this.maxParts = this.lowFx ? 300 : 900;
    this.parts = [];
    const pg = new THREE.BoxGeometry(1, 1, 1);
    this.partMesh = new THREE.InstancedMesh(pg, new THREE.MeshLambertMaterial({ color: 0xffffff }), this.maxParts);
    this.partMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.maxParts * 3), 3);
    this.partMesh.count = 0;
    this.partMesh.frustumCulled = false;
    this.group.add(this.partMesh);
    // glowing particles (sparks, fire)
    this.maxGlow = 300;
    this.glow = [];
    this.glowMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: radialTexture("spark"), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false,
    }), this.maxGlow);
    this.glowMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.maxGlow * 3), 3);
    this.glowMesh.count = 0;
    this.glowMesh.frustumCulled = false;
    this.group.add(this.glowMesh);
    // smoke puffs (normal blending, soft)
    this.maxSmoke = 120;
    this.smoke = [];
    this.smokeMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: radialTexture("smoke", "rgba(255,255,255,0.4)", "rgba(255,255,255,0)"), transparent: true, depthWrite: false,
    }), this.maxSmoke);
    this.smokeMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.maxSmoke * 3), 3);
    this.smokeMesh.count = 0;
    this.smokeMesh.frustumCulled = false;
    this.group.add(this.smokeMesh);

    // decals
    this.holes = this._decalPool(holeTexture(), this.lowFx ? 48 : 128, 0.16);
    this.splats = this._decalPool(splatTexture(), 40, 1);

    // explosions: stepped-colour toon fireball (flat-shaded icosahedron puff) + inner core + shock ring
    this.booms = [];
    const ballGeo = new THREE.IcosahedronGeometry(1, 1);
    const coreGeo = new THREE.IcosahedronGeometry(0.62, 1);
    const ringGeo = new THREE.RingGeometry(0.8, 1, 32);
    for (let i = 0; i < 6; i++) {
      const ball = new THREE.Mesh(ballGeo, new THREE.MeshBasicMaterial({ color: 0xffb03a, transparent: true, opacity: 0, depthWrite: false, fog: false }));
      const core = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ color: 0xfff6c8, transparent: true, opacity: 0, depthWrite: false, fog: false }));
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: 0xfff1c4, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, fog: false,
      }));
      ring.rotation.x = -Math.PI / 2;
      ball.visible = ring.visible = core.visible = false;
      ball.renderOrder = 2; core.renderOrder = 3;
      this.group.add(ball, core, ring);
      this.booms.push({ ball, core, ring, t: 0, dur: 0.5, r: 1, active: false, spin: 0 });
    }

    // remote muzzle flashes: cartoon stars
    this.flashes = [];
    for (let i = 0; i < 8; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTexture() || radialTexture("flash", "rgba(255,240,180,1)", "rgba(255,140,30,0)"),
        blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
      s.visible = false;
      this.group.add(s);
      this.flashes.push({ s, t: 0, size: 0.5 });
    }

    // casings: one instanced pool per kind (brass / shotgun shell), fixed size, no growth
    this.maxCasings = 40;
    this.casings = [];
    this.casingMesh = {};
    for (const kind of ["brass", "shell"]) {
      const m = new THREE.InstancedMesh(buildCasing(kind), fxMaterial("#ffffff", 0.35, { tag: "inst" }), this.maxCasings);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = false;
      this.group.add(m);
      this.casingMesh[kind] = m;
    }
    this.trailT = 0;
    this.timeScale = 1;
    this.shake = 0;
  }

  setWorld(world) { this.world = world; this.clear(); }

  _decalPool(tex, n, size) {
    const mat = new THREE.MeshLambertMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, n);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.receiveShadow = false;
    this.group.add(mesh);
    return { mesh, n, size, next: 0, used: 0 };
  }

  clear() {
    this.tracers.length = 0; this.parts.length = 0; this.glow.length = 0; this.smoke.length = 0;
    for (const d of [this.holes, this.splats]) { d.used = 0; d.next = 0; d.mesh.count = 0; }
    for (const b of this.booms) { b.active = false; b.ball.visible = b.ring.visible = b.core.visible = false; }
    this.casings.length = 0;
    for (const k in this.casingMesh) this.casingMesh[k].count = 0;
  }

  // ---------------------------------------------------------------- spawners

  tracer(sx, sy, sz, ex, ey, ez, color = 0xffe08a, width = 0.025) {
    let L = Math.hypot(ex - sx, ey - sy, ez - sz);
    if (L < 0.5) return;
    const dx = (ex - sx) / L, dy = (ey - sy) / L, dz = (ez - sz) / L;
    // stop just in front of the surface (q2 endpoints can sit slightly inside it)
    L -= 0.02;
    if (this.tracers.length >= this.maxTracers) this.tracers.shift();
    this.tracers.push({ sx, sy, sz, dx, dy, dz, L, t: 0, speed: 240, len: Math.min(5, L * 0.5), color, width });
  }

  /**
   * Tracer for a shot from eye E toward its end point H (the true first hit, or the range end), drawn from the
   * muzzle M when that is safe. local: the shooter is the local player (no tracer when the hit is very close).
   */
  shotTracer(E, M, H, color, width, local = false) {
    let dx = H[0] - E[0], dy = H[1] - E[1], dz = H[2] - E[2];
    const tHit = Math.hypot(dx, dy, dz);
    if (tHit < 1e-4) return;
    dx /= tHit; dy /= tHit; dz /= tHit;
    if (local && tHit < 1.5) return;
    let sx = M[0], sy = M[1], sz = M[2];
    const mx = sx - E[0], my = sy - E[1], mz = sz - E[2];
    const mL = Math.hypot(mx, my, mz);
    let clip = mx * dx + my * dy + mz * dz >= tHit - 0.3;
    if (!clip && this.world && mL > 1e-4) {
      // the muzzle pokes through a wall (hugging it) or sits inside geometry: start on the eye ray instead
      const t = this.sim.raycastWorld(this.world, E[0], E[1], E[2], mx / mL, my / mL, mz / mL, mL);
      if (t >= 0) clip = true;
    }
    if (!clip && this.world) {
      // the muzzle sits lower than the eye: the muzzle -> impact line can cross low cover (a crate, a rail, a
      // ledge) that the eye ray clears, which drew the streak through the cover and out the far side.
      const hx = H[0] - sx, hy = H[1] - sy, hz = H[2] - sz;
      const hL = Math.hypot(hx, hy, hz);
      if (hL > 1e-4) {
        const t = this.sim.raycastWorld(this.world, sx, sy, sz, hx / hL, hy / hL, hz / hL, hL);
        if (t >= 0 && t < hL - 0.05) clip = true;
      }
    }
    if (clip) {
      if (tHit - 0.5 < 0.6) return;
      sx = E[0] + dx * 0.5; sy = E[1] + dy * 0.5; sz = E[2] + dz * 0.5;
    }
    let ex = H[0], ey = H[1], ez = H[2];
    if (this.world) {
      // last guard on the segment actually drawn: a remote shot's origin and end points are quantised (q2), so a ray
      // that grazes a wall edge on the server can clip it here; never draw past the first solid this client sees
      const fx = ex - sx, fy = ey - sy, fz = ez - sz;
      const fL = Math.hypot(fx, fy, fz);
      if (fL > 1e-4) {
        const t = this.sim.raycastWorld(this.world, sx, sy, sz, fx / fL, fy / fL, fz / fL, fL);
        if (t >= 0 && t < fL - 0.02) {
          if (t < 0.6) return;
          ex = sx + (fx / fL) * t; ey = sy + (fy / fL) * t; ez = sz + (fz / fL) * t;
        }
      }
    }
    this.tracer(sx, sy, sz, ex, ey, ez, color, width);
  }

  _part(arr, max, p) {
    if (arr.length >= max) arr[Math.floor(Math.random() * arr.length)] = p;
    else arr.push(p);
  }

  /** Generic burst. o: {count, color, colors[], speed, up, size, life, gravity, drag, flat, floorY, spread} */
  burst(x, y, z, nx, ny, nz, o) {
    const n = this.lowFx ? Math.ceil(o.count / 2) : o.count;
    for (let i = 0; i < n; i++) {
      const col = o.colors ? o.colors[i % o.colors.length] : o.color;
      _c.set(col);
      let vx = (Math.random() - 0.5) * 2, vy = (Math.random() - 0.5) * 2, vz = (Math.random() - 0.5) * 2;
      const sp = o.spread ?? 0.8;
      vx = nx + vx * sp; vy = ny + vy * sp + (o.up || 0); vz = nz + vz * sp;
      if (o.hemi) { const dn = vx * nx + vy * ny + vz * nz; if (dn < 0.05) { vx -= (dn - 0.05) * nx * 2; vy -= (dn - 0.05) * ny * 2; vz -= (dn - 0.05) * nz * 2; } }
      const l = Math.hypot(vx, vy, vz) || 1;
      const speed = o.speed * (0.4 + Math.random() * 0.8);
      this._part(this.parts, this.maxParts, {
        x, y, z, vx: (vx / l) * speed, vy: (vy / l) * speed, vz: (vz / l) * speed,
        life: o.life * (0.6 + Math.random() * 0.6), t: 0, size: o.size * (0.6 + Math.random() * 0.8),
        r: _c.r, g: _c.g, b: _c.b, grav: o.gravity ?? 18, drag: o.drag ?? 0.5, flat: o.flat || 0,
        ax: Math.random() - 0.5, ay: Math.random() - 0.5, az: Math.random() - 0.5, spin: (Math.random() - 0.5) * 20, ang: Math.random() * 6,
        floor: o.floorY ?? -1e9, rest: false,
      });
    }
  }

  sparks(x, y, z, nx, ny, nz, count = 6, color = 0xffd27a, size = 0.12, speed = 6) {
    for (let i = 0; i < count; i++) {
      _c.set(color);
      let vx = nx + (Math.random() - 0.5) * 1.6, vy = ny + (Math.random() - 0.5) * 1.6 + 0.3, vz = nz + (Math.random() - 0.5) * 1.6;
      const dn = vx * nx + vy * ny + vz * nz;
      if (dn < 0.05) { vx -= (dn - 0.05) * nx * 2; vy -= (dn - 0.05) * ny * 2; vz -= (dn - 0.05) * nz * 2; } // stay in front of the surface
      const s = speed * (0.4 + Math.random() * 0.8);
      this._part(this.glow, this.maxGlow, { x, y, z, vx: vx * s, vy: vy * s, vz: vz * s, t: 0, life: 0.15 + Math.random() * 0.2,
        size: size * (0.6 + Math.random() * 0.8), r: _c.r, g: _c.g, b: _c.b, grav: 10 });
    }
  }

  puff(x, y, z, count, color, size, life, rise = 0.6, spread = 1) {
    for (let i = 0; i < count; i++) {
      _c.set(color);
      this._part(this.smoke, this.maxSmoke, {
        x: x + (Math.random() - 0.5) * spread, y: y + (Math.random() - 0.5) * spread * 0.6, z: z + (Math.random() - 0.5) * spread,
        vx: (Math.random() - 0.5) * 1.2, vy: rise * (0.5 + Math.random()), vz: (Math.random() - 0.5) * 1.2,
        t: 0, life: life * (0.7 + Math.random() * 0.6), size: size * (0.7 + Math.random() * 0.6), r: _c.r, g: _c.g, b: _c.b, grow: 1.6,
      });
    }
  }

  decal(pool, x, y, z, nx, ny, nz, size, color = 0xffffff, rot = Math.random() * Math.PI * 2) {
    const i = pool.next;
    pool.next = (pool.next + 1) % pool.n;
    pool.used = Math.min(pool.n, pool.used + 1);
    _a.set(nx, ny, nz).normalize();
    _q.setFromUnitVectors(_z, _a);
    _q.multiply(_qr.setFromAxisAngle(_z, rot));
    _p.set(x + nx * 0.012, y + ny * 0.012, z + nz * 0.012);
    _s.set(size, size, size);
    _m.compose(_p, _q, _s);
    pool.mesh.setMatrixAt(i, _m);
    _c.set(color);
    pool.mesh.setColorAt(i, _c);
    pool.mesh.count = pool.used;
    pool.mesh.instanceMatrix.needsUpdate = true;
    pool.mesh.instanceColor.needsUpdate = true;
  }

  /** Bullet impact on the world at (x,y,z) for a shot travelling along d. */
  impactWorld(x, y, z, d, matColor = 0xbbbbbb) {
    let nx = -d[0], ny = -d[1], nz = -d[2];
    if (this.world) {
      // find the surface normal by re-casting a short ray toward the hit point
      const h = this.sim.raycastWorldN(this.world, x - d[0] * 0.3, y - d[1] * 0.3, z - d[2] * 0.3, d[0], d[1], d[2], 0.6);
      if (h && !h.inside) { nx = h.n[0]; ny = h.n[1]; nz = h.n[2]; }
    }
    this.decal(this.holes, x, y, z, nx, ny, nz, this.holes.size * (0.8 + Math.random() * 0.5));
    const px = x + nx * 0.02, py = y + ny * 0.02, pz = z + nz * 0.02;
    this.sparks(px, py, pz, nx, ny, nz, 4);
    this.burst(px, py, pz, nx, ny, nz, { count: 4, color: matColor, speed: 3, size: 0.05, life: 0.5, gravity: 14, spread: 0.7, hemi: true });
  }

  /** Bullet hitting an egg: yolk droplets + shell flecks. */
  impactEgg(x, y, z, d, shellColor = "#f4efe4", headshot = false) {
    const n = headshot ? 12 : 7;
    this.burst(x, y, z, -d[0], -d[1] + 0.3, -d[2], { count: n, colors: ["#ffc21a", "#ffb000", shellColor], speed: 4, size: 0.07, life: 0.6, gravity: 16, spread: 0.9 });
  }

  /** Egg death: shell shards fly, yolk splashes, splat decal on the floor. */
  crack(x, y, z, shellColor = "#f4efe4", vx = 0, vy = 0, vz = 0) {
    let floorY = y;
    if (this.world) {
      const t = this.sim.raycastWorld(this.world, x, y + 0.5, z, 0, -1, 0, 6);
      floorY = t >= 0 ? y + 0.5 - t : y - 6;
    }
    // shell shards
    this.burst(x, y + 0.75, z, vx * 0.1, 0.6, vz * 0.1, { count: 26, color: shellColor, speed: 6, size: 0.16, life: 2.2, gravity: 20, flat: 1, floorY, spread: 1.1, up: 0.3 });
    // yolk blobs
    this.burst(x, y + 0.6, z, 0, 0.8, 0, { count: 18, colors: ["#ffc21a", "#ffad0a", "#ffd84d"], speed: 4.5, size: 0.12, life: 1.6, gravity: 22, floorY, spread: 1 });
    // white of the egg
    this.burst(x, y + 0.6, z, 0, 0.6, 0, { count: 8, color: "#fffdf2", speed: 3, size: 0.1, life: 1.2, gravity: 22, floorY, spread: 1 });
    if (floorY > y - 5) this.decal(this.splats, x, floorY + 0.005, z, 0, 1, 0, 1.4 + Math.random() * 0.5, 0xffbe1f);
  }

  /** Yolk splat on a wall/floor (e.g. under the egg of a hit near a surface). */
  splat(x, y, z, nx, ny, nz, size = 0.6) { this.decal(this.splats, x, y, z, nx, ny, nz, size, 0xffbe1f); }

  explosion(x, y, z, r, camPos) {
    const b = this.booms.find((e) => !e.active) || this.booms[0];
    b.active = true; b.t = 0; b.dur = 0.55; b.r = r; b.spin = Math.random() * 6;
    b.ball.position.set(x, y, z);
    b.core.position.set(x, y, z);
    b.ring.position.set(x, y + 0.05, z);
    b.ball.visible = b.ring.visible = b.core.visible = true;
    this.sparks(x, y, z, 0, 0.5, 0, this.lowFx ? 10 : 22, 0xffb347, 0.35, 10);
    this.burst(x, y, z, 0, 0.6, 0, { count: 14, colors: ["#3a3027", "#6b5a45", "#ffb347", "#ffd34d"], speed: 9, size: 0.13, life: 1.2, gravity: 20, spread: 1.2, floorY: y - 0.2 });
    this.puff(x, y + 0.3, z, this.lowFx ? 3 : 8, "#9a928a", 0.9, 1.3, 1.0, r * 0.35);
    this.r.flashAt(x, y + 0.5, z, 12, r * 3, 0.22, 0xffa040);
    if (camPos) {
      const d = Math.hypot(camPos.x - x, camPos.y - y, camPos.z - z);
      this.shake = Math.max(this.shake, Math.max(0, 1 - d / (r * 3.5)));
    }
    if (this.world) this.decal(this.holes, x, y, z, 0, 1, 0, Math.min(2.5, r * 0.5), 0x333333);
  }

  /** Smoke puff behind a flying rocket (rate-limited by the caller's dt). */
  rocketTrail(x, y, z, dt, st = this) {
    st.trailT = (st.trailT || 0) - dt * this.timeScale;
    if (st.trailT > 0) return;
    st.trailT = 0.03;
    this.puff(x, y, z, 1, "#fff3d0", 0.22, 0.55, 0.25, 0.04);
    if (!this.lowFx) this.sparks(x, y, z, 0, 0.2, 0, 1, 0xffa53a, 0.14, 1.5);
  }

  /** Eject a casing at world position pos with direction dir (unit) plus the shooter's velocity vel. */
  casing(kind, pos, dir, vel) {
    const mesh = this.casingMesh[kind] || this.casingMesh.brass;
    if (!mesh) return;
    let c = null;
    if (this.casings.length >= this.maxCasings) { c = this.casings.shift(); } else c = {};
    const sp = 1.6 + Math.random() * 0.8;
    c.kind = kind === "shell" ? "shell" : "brass";
    c.x = pos.x; c.y = pos.y; c.z = pos.z;
    c.vx = dir.x * sp + (vel ? vel.x : 0); c.vy = dir.y * sp + 1.2 + Math.random() * 0.6 + (vel ? Math.max(0, vel.y) : 0); c.vz = dir.z * sp + (vel ? vel.z : 0);
    c.rx = Math.random() * 6; c.ry = Math.random() * 6; c.rz = 0;
    c.wx = (Math.random() - 0.5) * 30; c.wy = (Math.random() - 0.5) * 20; c.wz = (Math.random() - 0.5) * 30;
    c.t = 0; c.life = 1.2; c.bounced = false;
    c.floor = -1e9;
    if (this.world) {
      // one downward ray at spawn finds the floor for the single bounce
      const t = this.sim.raycastWorld(this.world, pos.x, pos.y, pos.z, 0, -1, 0, 4);
      c.floor = t >= 0 ? pos.y - t : pos.y - 4;
    }
    this.casings.push(c);
  }

  muzzleFlash(pos, size = 0.5) {
    const f = this.flashes.find((e) => e.t <= 0) || this.flashes[0];
    f.t = 0.05;
    f.size = size;
    f.s.position.copy(pos);
    f.s.scale.setScalar(size);
    f.s.material.rotation = Math.random() * Math.PI;
    f.s.visible = true;
    this.r.flashAt(pos.x, pos.y, pos.z, 3, 6, 0.05);
  }

  // ---------------------------------------------------------------- update

  update(dt, camera) {
    dt *= this.timeScale; // debug: 0 freezes every effect in place (screenshots)
    // tracers: tail -> head, the head never passes the impact point
    const tm = this.tracerMesh;
    let n = 0;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.t += dt;
      if (!tracerMatrix(t, _m)) { this.tracers.splice(i, 1); continue; }
      tm.setMatrixAt(n, _m);
      _c.set(t.color);
      tm.setColorAt(n, _c);
      n++;
    }
    uploadInstances(tm, n);

    // particles
    const pm = this.partMesh;
    n = 0;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.t += dt;
      if (p.t >= p.life) { this.parts[i] = this.parts[this.parts.length - 1]; this.parts.pop(); continue; }
      if (!p.rest) {
        p.vy -= p.grav * dt;
        const dr = Math.max(0, 1 - p.drag * dt);
        p.vx *= dr; p.vz *= dr;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.ang += p.spin * dt;
        if (p.y < p.floor + p.size * 0.2) {
          p.y = p.floor + p.size * 0.2;
          if (Math.abs(p.vy) < 2) { p.rest = true; p.ang = Math.round(p.ang / Math.PI) * Math.PI; }
          p.vy = -p.vy * 0.3; p.vx *= 0.5; p.vz *= 0.5;
        }
      }
      const fade = p.t > p.life - 0.3 ? Math.max(0, (p.life - p.t) / 0.3) : 1;
      _a.set(p.ax, p.ay, p.az).normalize();
      _q.setFromAxisAngle(_a, p.ang);
      const s = p.size * fade;
      _s.set(s, p.flat ? s * 0.25 : s, s);
      _p.set(p.x, p.y, p.z);
      _m.compose(_p, _q, _s);
      pm.setMatrixAt(n, _m);
      _c.setRGB(p.r, p.g, p.b);
      pm.setColorAt(n, _c);
      n++;
    }
    uploadInstances(pm, n);

    // billboards (glow + smoke) face the camera
    const cq = camera.quaternion;
    const gm = this.glowMesh;
    n = 0;
    for (let i = this.glow.length - 1; i >= 0; i--) {
      const p = this.glow[i];
      p.t += dt;
      if (p.t >= p.life) { this.glow[i] = this.glow[this.glow.length - 1]; this.glow.pop(); continue; }
      p.vy -= p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const f = 1 - p.t / p.life;
      _p.set(p.x, p.y, p.z); _s.setScalar(p.size * (0.4 + f * 0.6));
      _m.compose(_p, cq, _s);
      gm.setMatrixAt(n, _m);
      _c.setRGB(p.r * f, p.g * f, p.b * f);
      gm.setColorAt(n, _c);
      n++;
    }
    uploadInstances(gm, n);

    const sm = this.smokeMesh;
    n = 0;
    for (let i = this.smoke.length - 1; i >= 0; i--) {
      const p = this.smoke[i];
      p.t += dt;
      if (p.t >= p.life) { this.smoke[i] = this.smoke[this.smoke.length - 1]; this.smoke.pop(); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const f = p.t / p.life;
      const shrink = f > 0.6 ? Math.max(0, 1 - (f - 0.6) / 0.4) : 1;
      _p.set(p.x, p.y, p.z); _s.setScalar(p.size * (1 + f * p.grow) * shrink);
      _m.compose(_p, cq, _s);
      sm.setMatrixAt(n, _m);
      const k = 1 - f; // fade via colour toward fog-ish (normal blending uses alpha from texture)
      _c.setRGB(p.r * (0.6 + 0.4 * k), p.g * (0.6 + 0.4 * k), p.b * (0.6 + 0.4 * k));
      sm.setColorAt(n, _c);
      n++;
    }
    uploadInstances(sm, n);
    this.smokeMesh.material.opacity = 1;

    // explosions: stepped toon colours (white core -> yellow -> orange -> red -> smoke grey)
    for (const b of this.booms) {
      if (!b.active) continue;
      b.t += dt;
      const f = b.t / b.dur;
      if (f >= 1) { b.active = false; b.ball.visible = b.ring.visible = b.core.visible = false; continue; }
      const e = 1 - Math.pow(1 - f, 3);
      b.ball.scale.setScalar(Math.max(0.01, b.r * (0.25 + 0.5 * e)));
      b.ball.rotation.set(b.spin, b.spin * 0.7 + f, 0);
      const step = f < 0.18 ? 0 : f < 0.4 ? 1 : f < 0.65 ? 2 : 3;
      b.ball.material.color.setHex([0xffd24a, 0xffa22e, 0xe5562a, 0x6f6660][step]);
      b.ball.material.opacity = step === 3 ? (1 - f) * 2.2 : 0.95;
      b.core.scale.setScalar(Math.max(0.01, b.r * (0.3 + 0.35 * e) * Math.max(0, 1 - f * 1.6)));
      b.core.material.opacity = f < 0.5 ? 1 : 0;
      b.core.material.color.setHex(f < 0.15 ? 0xffffff : 0xfff0a0);
      b.ring.scale.setScalar(Math.max(0.01, b.r * (0.2 + e)));
      b.ring.material.opacity = (1 - f) * 0.7;
    }
    // remote muzzle flashes
    for (const f of this.flashes) {
      if (f.t > 0) { f.t -= dt; f.s.scale.setScalar(f.size * (0.8 + Math.random() * 0.4)); if (f.t <= 0) f.s.visible = false; }
    }
    // casings
    const cnt = { brass: 0, shell: 0 };
    for (let i = this.casings.length - 1; i >= 0; i--) {
      const c = this.casings[i];
      c.t += dt;
      if (c.t >= c.life) { this.casings.splice(i, 1); continue; }
      c.vy -= 16 * dt;
      c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
      c.rx += c.wx * dt; c.ry += c.wy * dt; c.rz += c.wz * dt;
      if (c.y < c.floor + 0.012) {
        c.y = c.floor + 0.012;
        if (!c.bounced) { c.bounced = true; c.vy = Math.abs(c.vy) * 0.35; c.vx *= 0.45; c.vz *= 0.45; c.wx *= 0.4; c.wz *= 0.4; }
        else { c.vy = 0; c.vx *= 0.8; c.vz *= 0.8; c.wx = c.wz = 0; c.rx = Math.PI / 2; }
      }
      const mesh = this.casingMesh[c.kind];
      const k = cnt[c.kind]++;
      const sc = c.t > c.life - 0.15 ? Math.max(0.01, (c.life - c.t) / 0.15) : 1;
      _p.set(c.x, c.y, c.z); _q.setFromEuler(_e.set(c.rx, c.ry, c.rz)); _s.setScalar(sc * (c.kind === "shell" ? 1.1 : 1.6));
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(k, _m);
    }
    for (const k in this.casingMesh) uploadInstances(this.casingMesh[k], cnt[k]);
    this.shake = Math.max(0, this.shake - dt * 2.5);
  }

  dispose() {
    const shared = new Set(Object.values(this.casingMesh).map((m) => m.geometry));
    const sharedMat = new Set(Object.values(this.casingMesh).map((m) => m.material));
    this.group.traverse((o) => {
      if (o.geometry && !shared.has(o.geometry)) o.geometry.dispose();
      if (o.material && !sharedMat.has(o.material)) o.material.dispose();
    });
    this.scene.remove(this.group);
  }
}
