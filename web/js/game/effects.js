// Pooled visual effects. Everything is instanced or pooled: no allocations of
// meshes/materials during play.
//  - tracers (moving bullet streaks), muzzle flashes for remote players
//  - particles (sparks, dust, yolk droplets, shell shards, explosion debris/smoke)
//  - decals (bullet holes, yolk splats) on world surfaces
//  - explosions (fireball + shock ring + light flash)

import * as THREE from "../../vendor/three.module.min.js";
import { radialTexture, holeTexture, splatTexture } from "../engine/textures.js";

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1);
const _c = new THREE.Color(), _fwd = new THREE.Vector3(0, 0, -1), _qr = new THREE.Quaternion();

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
    this.tracerMesh = new THREE.InstancedMesh(tg, new THREE.MeshBasicMaterial({
      color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false,
    }), this.maxTracers);
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

    // explosions
    this.booms = [];
    for (let i = 0; i < 6; i++) {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), new THREE.MeshBasicMaterial({
        color: 0xffb03a, transparent: true, opacity: 0, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
      }));
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 32), new THREE.MeshBasicMaterial({
        color: 0xfff1c4, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: false,
      }));
      ring.rotation.x = -Math.PI / 2;
      ball.visible = ring.visible = false;
      this.group.add(ball, ring);
      this.booms.push({ ball, ring, t: 0, dur: 0.5, r: 1, active: false });
    }

    // remote muzzle flashes
    this.flashes = [];
    for (let i = 0; i < 8; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture("flash", "rgba(255,240,180,1)", "rgba(255,140,30,0)"),
        blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.visible = false;
      this.group.add(s);
      this.flashes.push({ s, t: 0 });
    }
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
    for (const b of this.booms) { b.active = false; b.ball.visible = b.ring.visible = false; }
  }

  // ---------------------------------------------------------------- spawners

  tracer(sx, sy, sz, ex, ey, ez, color = 0xffe08a, width = 0.025) {
    if (this.tracers.length >= this.maxTracers) this.tracers.shift();
    const L = Math.hypot(ex - sx, ey - sy, ez - sz);
    if (L < 0.5) return;
    this.tracers.push({ sx, sy, sz, dx: (ex - sx) / L, dy: (ey - sy) / L, dz: (ez - sz) / L, L, t: 0, speed: 240, len: Math.min(5, L * 0.5), color, width });
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
      const vx = nx + (Math.random() - 0.5) * 1.6, vy = ny + (Math.random() - 0.5) * 1.6 + 0.3, vz = nz + (Math.random() - 0.5) * 1.6;
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
    this.sparks(x, y, z, nx, ny, nz, 4);
    this.burst(x, y, z, nx, ny, nz, { count: 4, color: matColor, speed: 3, size: 0.05, life: 0.5, gravity: 14, spread: 0.7 });
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
    b.active = true; b.t = 0; b.dur = 0.45; b.r = r;
    b.ball.position.set(x, y, z);
    b.ring.position.set(x, y + 0.05, z);
    b.ball.visible = b.ring.visible = true;
    this.sparks(x, y, z, 0, 0.5, 0, this.lowFx ? 10 : 24, 0xffb347, 0.35, 10);
    this.burst(x, y, z, 0, 0.6, 0, { count: 14, colors: ["#3a3027", "#6b5a45", "#ffb347"], speed: 9, size: 0.12, life: 1.2, gravity: 20, spread: 1.2, floorY: y - 0.2 });
    this.puff(x, y + 0.3, z, this.lowFx ? 3 : 7, "#8a837a", 0.9, 1.2, 1.0, r * 0.35);
    this.r.flashAt(x, y + 0.5, z, 12, r * 3, 0.22, 0xffa040);
    if (camPos) {
      const d = Math.hypot(camPos.x - x, camPos.y - y, camPos.z - z);
      this.shake = Math.max(this.shake, Math.max(0, 1 - d / (r * 3.5)));
    }
    if (this.world) this.decal(this.holes, x, y, z, 0, 1, 0, Math.min(2.5, r * 0.5), 0x333333);
  }

  muzzleFlash(pos) {
    const f = this.flashes.find((e) => e.t <= 0) || this.flashes[0];
    f.t = 0.05;
    f.s.position.copy(pos);
    f.s.scale.setScalar(0.5);
    f.s.visible = true;
    this.r.flashAt(pos.x, pos.y, pos.z, 3, 6, 0.05);
  }

  // ---------------------------------------------------------------- update

  update(dt, camera) {
    // tracers
    const tm = this.tracerMesh;
    let n = 0;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.t += dt;
      const head = Math.min(t.L, t.t * t.speed);
      const tail = Math.max(0, head - t.len);
      if (tail >= t.L - 0.01) { this.tracers.splice(i, 1); continue; }
      _a.set(t.sx + t.dx * head, t.sy + t.dy * head, t.sz + t.dz * head);
      _b.set(t.dx, t.dy, t.dz);
      _q.setFromUnitVectors(_fwd, _b);
      _s.set(t.width, t.width, Math.max(0.01, head - tail));
      _m.compose(_a, _q, _s);
      tm.setMatrixAt(n, _m);
      _c.set(t.color);
      tm.setColorAt(n, _c);
      n++;
    }
    tm.count = n;
    tm.instanceMatrix.needsUpdate = true;
    if (tm.instanceColor) tm.instanceColor.needsUpdate = true;

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
    pm.count = n;
    pm.instanceMatrix.needsUpdate = true;
    if (pm.instanceColor) pm.instanceColor.needsUpdate = true;

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
    gm.count = n;
    gm.instanceMatrix.needsUpdate = true;
    if (gm.instanceColor) gm.instanceColor.needsUpdate = true;

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
    sm.count = n;
    sm.instanceMatrix.needsUpdate = true;
    if (sm.instanceColor) sm.instanceColor.needsUpdate = true;
    this.smokeMesh.material.opacity = 1;

    // explosions
    for (const b of this.booms) {
      if (!b.active) continue;
      b.t += dt;
      const f = b.t / b.dur;
      if (f >= 1) { b.active = false; b.ball.visible = b.ring.visible = false; continue; }
      const e = 1 - Math.pow(1 - f, 3);
      b.ball.scale.setScalar(Math.max(0.01, b.r * (0.25 + 0.55 * e)));
      b.ball.material.opacity = (1 - f) * 0.9;
      b.ball.material.color.setRGB(1, 0.75 - f * 0.4, 0.3 - f * 0.25);
      b.ring.scale.setScalar(Math.max(0.01, b.r * (0.2 + e)));
      b.ring.material.opacity = (1 - f) * 0.6;
    }
    // remote muzzle flashes
    for (const f of this.flashes) {
      if (f.t > 0) { f.t -= dt; if (f.t <= 0) f.s.visible = false; }
    }
    this.shake = Math.max(0, this.shake - dt * 2.5);
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    this.scene.remove(this.group);
  }
}

