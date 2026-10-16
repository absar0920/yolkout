// First-person view model: the held gun and the two cartoon gloves, drawn in their own scene/camera
// (renderer.vmScene / vmCamera). Pose layers (docs/V2_SPEC.md 5.3) are summed on gunRoot: base hip/ADS,
// idle breathing, walk bob, look sway, strafe tilt, jump/land, recoil springs and the action layer
// (reload / bolt + pump cycles / melee / grenade / switch timelines from vm/timelines.js). Hands are placed
// by vm/rig.js on the gun's sockets or on free targets and blend between targets, so nothing teleports.
// Everything per frame is preallocated: update() does not allocate.

import * as THREE from "../../vendor/three.module.min.js";
import { buildGun, buildHand, buildMelee, buildGrenade, setOutlineQuality } from "./art/index.js";
import { Spring, clamp01, smooth } from "./vm/springs.js";
import { sampleGun, sampleScalar, sampleStep, sampleTargets, crossEvents, tlEnd } from "./vm/anims.js";
import { reloadTimeline, cycleTimeline, meleeTimeline, grenadeTimeline, switchTimeline, drawTimeline, SWAP_AT } from "./vm/timelines.js";
import { Rig, makeAnchor } from "./vm/rig.js";

export const GUN_SCALE = 0.55;
const D = Math.PI / 180;
const XFADE = 0.12; // seconds to blend out of an interrupted pose

// Hip framing per gun (view space metres): held a little forward with an inward yaw and a slight cant, so the
// left side of the gun and the gloved grip hand read clearly instead of a foreshortened stock filling the corner.
const HIP = {
  default: { p: [0.18, -0.19, -0.45], r: [0.03, 0.2, -0.06] },
  poacher: { p: [0.17, -0.175, -0.43], r: [0.03, 0.2, -0.06] },
  piercer: { p: [0.18, -0.19, -0.44], r: [0.03, 0.18, -0.05] },
  deviler: { p: [0.18, -0.19, -0.44], r: [0.03, 0.2, -0.06] },
  souffle: { p: [0.2, -0.24, -0.42], r: [0.02, 0.14, -0.04] },
  coddler: { p: [0.15, -0.16, -0.42], r: [0.02, 0.16, -0.05] },
};
// ADS: distance from the eye to the sight socket (m); the pistol is held at arm's length
const ADS_EYE = { coddler: 0.24, poacher: 0.24 };
// Per weapon-class recoil impulses (5.3 table): back z (m), rotX (rad), rotZ random (rad)
const RECOIL = {
  "Assault Rifle": [0.035, 3 * D, 0.6 * D], "Burst Rifle": [0.035, 3 * D, 0.6 * D], SMG: [0.025, 2 * D, 0.8 * D],
  Marksman: [0.05, 5 * D, 0.5 * D], Sniper: [0.09, 9 * D, 0], Shotgun: [0.1, 12 * D, 1 * D], Launcher: [0.12, 6 * D, 0],
  Pistol: [0.04, 8 * D, 1 * D],
};
const FLASH_SIZE = { Shotgun: 0.3, Sniper: 0.28, Launcher: 0.36, Pistol: 0.17, SMG: 0.17, Marksman: 0.22 };
const PEAK = 13.416 * Math.E; // critically damped k=180: initial velocity per unit peak displacement
const PART_DEFAULT_HIDDEN = new Set(["shell", "clip"]);
const PART_KEYS = ["bolt", "lift", "pump", "slide"], TRAVEL_KEYS = ["bolt", "pump", "slide"];

function starTexture() {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,235,1)"); grad.addColorStop(0.35, "rgba(255,214,90,0.95)"); grad.addColorStop(1, "rgba(255,120,20,0)");
  g.fillStyle = grad;
  g.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2, r = i % 2 ? 26 : 62;
    g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
  }
  g.closePath(); g.fill();
  g.fillStyle = "rgba(255,255,240,1)";
  g.beginPath(); g.arc(64, 64, 14, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class HandState {
  constructor() { this.p = new THREE.Vector3(); this.q = new THREE.Quaternion(); this.pose = "open"; this.poseB = "open"; this.u = 0; }
  copy(o) { this.p.copy(o.p); this.q.copy(o.q); this.pose = o.pose; this.poseB = o.poseB; this.u = o.u; return this; }
}

export class ViewModel {
  constructor(renderer, data = null) {
    this.r = renderer;
    this.data = data;
    this.W = data && data.weapons ? data.weapons.weapons : {};
    this.root = new THREE.Group();
    this.root.name = "vmRoot";
    this.r.vmCamera.add(this.root);
    this.gunRoot = new THREE.Group();
    this.gunRoot.scale.setScalar(GUN_SCALE);
    this.root.add(this.gunRoot);
    this.rig = new Rig(this.root, this.gunRoot, GUN_SCALE);

    this.handColor = "#f4efe4";
    this.hands = { L: buildHand("L", { lod: "fp", color: this.handColor }), R: buildHand("R", { lod: "fp", color: this.handColor }) };
    for (const k of ["L", "R"]) {
      const g = this.hands[k].group;
      g.matrixAutoUpdate = false;
      g.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; } });
      this.root.add(g);
    }
    this.pinchL = this.hands.L.points.pinch.position.clone();

    this.guns = new Map();
    this.current = null;
    this.currentId = "";
    this.pendingId = "";
    this.def = null;
    this.melees = new Map();
    this.meleeId = "";
    this.melee = null;
    this.nade = buildGrenade({ lod: "fp" });
    this.nadeGroup = this.nade.group || this.nade;
    this.nadeGroup.matrixAutoUpdate = false;
    this.nadeGroup.visible = false;
    this.root.add(this.nadeGroup);

    // muzzle flash: a cartoon star sprite
    const tex = starTexture();
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, fog: false }));
    this.flash.visible = false;
    this.flash.renderOrder = 10;
    this.root.add(this.flash);
    this.flashT = 0; this.flashSize = 0.22;

    // dropped mags / flicked clips (short-lived, view space)
    this.drops = [];

    // layers
    this.t = 0;
    this.adsLin = 0; this.adsBlend = 0;
    this.bobPhase = 0; this.bobAmt = 0;
    this.lookDX = 0; this.lookDY = 0;
    this.swayY = new Spring(120, 18); this.swayX = new Spring(120, 18);
    this.tilt = 0;
    this.jump = new Spring(160, 18);
    this.recZ = new Spring(180, 26.8); this.recX = new Spring(180, 26.8); this.recRZ = new Spring(180, 26.8); this.recY = new Spring(180, 26.8);
    this.wasGround = true;
    this.triggerT = 1;
    this.kickT = 9; this.kickPart = "";
    this.slideLocked = false;
    this.loaded = true;

    // action state
    this.act = null;             // {tl, t, dur, kind}
    this.reloadTl = null; this.reloadKey = "";
    this.activeTl = null;
    this.lastF = -1;
    this.xf = 1;
    this.frozen = null;
    this._evCb = (ty, a) => this._ev(ty, a);
    this.onEvent = null;         // (type, arg) => void: "snd" name | "eject" kind | "strike" | "release" | "swap"

    // per-frame outputs (and the crossfade snapshot)
    this.out = { gp: new THREE.Vector3(), gr: new THREE.Vector3(), L: new HandState(), R: new HandState(), parts: { bolt: 0, lift: 0, pump: 0, slide: 0 } };
    this.snap = { gp: new THREE.Vector3(), gr: new THREE.Vector3(), L: new HandState(), R: new HandState(), parts: { bolt: 0, lift: 0, pump: 0, slide: 0 } };
    this._tA = { a: null, b: null, u: 0 };
    this._p = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._p2 = new THREE.Vector3(); this._q2 = new THREE.Quaternion();
    this._v = new THREE.Vector3(); this._e = new THREE.Euler(); this._m = new THREE.Matrix4(); this._m2 = new THREE.Matrix4(); this._s = new THREE.Vector3();
    this._base = new THREE.Vector3(); this._baseR = new THREE.Vector3(); this._ads = new THREE.Vector3();
    this.lastSt = { speed: 0, vx: 0, vz: 0, yaw: 0, onGround: true, ads: 0, adsTime: 0.2, reloadFrac: -1, switchFrac: -1, scoped: false, bob: true, mag: 1, alive: true, vy: 0 };
  }

  // ---------------------------------------------------------------- setup

  _gun(id) {
    let g = this.guns.get(id);
    if (!g) {
      g = buildGun(id, { lod: "fp" });
      g.group.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
      g.anchors = {};
      for (const k of ["shell", "clip", "rocket"]) if (g.parts[k]) { const a = makeAnchor(k, this.pinchL); g.parts[k].add(a); g.anchors[k] = a; }
      if (g.sockets.magGrip) g.anchors.mag = g.sockets.magGrip;
      // the trigger part rotates about its pivot
      g.group.visible = false;
      this.gunRoot.add(g.group);
      // drop clones for detachable parts (share geometry + materials)
      g.dropSrc = {};
      for (const k of ["mag", "clip"]) {
        if (!g.parts[k]) continue;
        const src = g.parts[k].children.find((c) => c.isMesh);
        if (!src) continue;
        const d = src.clone();
        d.matrixAutoUpdate = false;
        d.visible = false;
        this.root.add(d);
        const drop = { obj: d, t: 9, p: new THREE.Vector3(), q: new THREE.Quaternion(), v: new THREE.Vector3(), w: new THREE.Vector3() };
        this.drops.push(drop);
        g.dropSrc[k] = drop;
      }
      this.guns.set(id, g);
    }
    return g;
  }

  _show(id) {
    if (this.current) this.current.group.visible = false;
    this.current = this._gun(id);
    this.currentId = id;
    this.def = this.W[id] || null;
    this.current.group.visible = true;
    this.rig.gun = this.current;
    const cls = this.def ? this.def.class : "";
    this.flashSize = FLASH_SIZE[cls] || 0.22;
    this.slideLocked = false;
    this.reloadTl = null;
    this._resetParts();
  }

  _resetParts() {
    const g = this.current;
    if (!g) return;
    for (const [k, p] of Object.entries(g.parts)) {
      const r = p.userData.rest;
      if (r) { p.position.copy(r.position); p.quaternion.copy(r.quaternion); }
      p.visible = !PART_DEFAULT_HIDDEN.has(k);
    }
  }

  /** Show weapon `id`. draw: play the holster (old) / draw (new) switch animation. */
  setWeapon(id, { draw = true, dur } = {}) {
    if (!id) return;
    if (id === this.currentId && !this.pendingId) return;
    if (id === this.pendingId) return;
    const sw = dur ?? (this.W[id] ? this.W[id].switchTime : 0.35) ?? 0.35;
    if (!draw || !this.current) {
      this.pendingId = "";
      this._show(id);
      if (draw) this._start(drawTimeline(), Math.max(0.15, sw * (1 - SWAP_AT)), "switch");
      else if (this.act && this.act.kind === "switch") this.act = null;
      return;
    }
    this.pendingId = id;
    this._start(switchTimeline(), Math.max(0.15, sw), "switch");
  }

  setMelee(id) {
    if (!id || id === this.meleeId) return;
    this.meleeId = id;
    let m = this.melees.get(id);
    if (!m) {
      m = buildMelee(id, { lod: "fp" });
      m.group.matrixAutoUpdate = false;
      m.group.visible = false;
      m.group.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; } });
      m.gripInv = new THREE.Matrix4();
      m.sockets.grip.updateMatrix();
      m.gripInv.copy(m.sockets.grip.matrix).invert();
      this.root.add(m.group);
      this.melees.set(id, m);
    }
    if (this.melee && this.melee !== m) this.melee.group.visible = false;
    this.melee = m;
  }

  setHandColor(css) {
    if (!css || css === this.handColor) return;
    this.handColor = css;
    this.hands.L.setColor(css); this.hands.R.setColor(css);
  }

  setQuality(q) { setOutlineQuality(q === "low" ? "low" : q || "high"); }

  // ---------------------------------------------------------------- actions

  _start(tl, dur, kind) {
    this.act = { tl, t: 0, dur: Math.max(1e-3, dur), kind };
  }

  /** opts {strength, ads, lastRound} */
  fire({ ads = false, lastRound = false } = {}) {
    const def = this.def;
    const cls = def ? def.class : "Assault Rifle";
    const rc = RECOIL[cls] || RECOIL["Assault Rifle"];
    const m = ads ? 0.45 : 1;
    this.recZ.impulse(rc[0] * PEAK * m);
    this.recX.impulse(rc[1] * PEAK * m);
    this.recRZ.impulse((Math.random() * 2 - 1) * rc[2] * PEAK * m);
    this.recY.impulse((Math.random() * 2 - 1) * rc[2] * 0.5 * PEAK * m);
    this.flashT = 0.05;
    this.flash.material.rotation = Math.random() * Math.PI;
    if (this.r.vmFlash) this.r.vmFlash.intensity = 4;
    this.triggerT = 0;
    const g = this.current;
    if (!g) return;
    if (g.parts.slide) { this.kickPart = "slide"; this.kickT = 0; if (lastRound) this.slideLocked = true; }
    else if (g.parts.bolt && (!def || def.cycle !== "bolt")) { this.kickPart = "bolt"; this.kickT = 0; }
    if (g.parts.rocket) { this.loaded = false; }
    const cyc = def && def.cycle && def.cycle !== "none" ? cycleTimeline(def.cycle) : null;
    if (cyc && !(def.cycle === "bolt" && lastRound)) this._start(cyc, 1, "cycle");
    if (def && def.eject && def.eject !== "none" && (!def.cycle || def.cycle === "none")) this._emit("eject", def.eject);
  }

  /** Local reload started: {empty, mag, magSize, reloadTime}. */
  reloadStart({ empty, mag = 0, magSize = 1 } = {}) {
    this.reloadInfo = { empty: !!empty, n: Math.max(1, magSize - mag) };
    this.reloadTl = null;
    if (this.act && this.act.kind === "cycle") this.act = null;
  }
  reloadCancel() { this.reloadTl = null; }

  meleeStart(id) {
    if (id) this.setMelee(id);
    const m = this.W[this.meleeId] || {};
    const tl = meleeTimeline(m.swing || "sweep", m.windup ?? 0.1, m.cooldown ?? 0.65);
    this._start(tl, 1, "melee");
    this.meleeHitKind = -1;
  }
  /** hitKind 0 miss | 1 world | 2 egg */
  meleeHit(hitKind = 0) {
    this.meleeHitKind = hitKind;
    if (hitKind > 0) { this.recZ.impulse(-0.03 * PEAK); this.recX.impulse((hitKind === 2 ? -4 : 3) * D * PEAK); }
  }
  throwNade() { this._start(grenadeTimeline(), 0.6, "grenade"); }
  land(strength) { this.jump.impulse(-Math.min(0.06, Math.max(0, strength) * 0.06) * 13.416 * Math.E); }
  /** Mouse delta in pixels (for sway). */
  look(dx, dy) { this.lookDX += dx; this.lookDY += dy; }

  _emit(type, arg) { if (this.onEvent) { try { this.onEvent(type, arg); } catch (e) { console.error("vm event", e); } } }

  // ---------------------------------------------------------------- debug

  /** Pose the view model at timeline `name` at fraction frac and stop its time (debug / screenshots). */
  freeze(name, frac = 0.5) {
    if (!name) { this.frozen = null; return; }
    const def = this.def || {};
    this.frozen = { name, frac };
    this.act = null; this.reloadTl = null;
    if (name === "reload") {
      this.reloadInfo = { empty: frac < 0 ? false : !!this.freezeEmpty, n: Math.max(1, (def.magSize || 5) - 2) };
    } else if (name === "cycle") {
      const tl = cycleTimeline(def.cycle);
      if (tl) this.act = { tl, t: frac * tl.end, dur: 1, kind: "cycle" };
    } else if (name === "melee") {
      this.meleeStart(this.meleeId);
      this.act.t = frac * this.act.tl.end;
    } else if (name === "grenade") {
      this._start(grenadeTimeline(), 0.6, "grenade"); this.act.t = frac * 0.6;
    } else if (name === "switch") {
      this._start(switchTimeline(), 1, "switch"); this.act.t = frac;
    } else if (name === "fire") {
      this.fire({ ads: false });
      for (let i = 0; i < 4; i++) this._springs(1 / 120);
      this.flashT = 0.05;
    }
    this.xf = 1;
  }

  // ---------------------------------------------------------------- per frame

  _springs(dt) {
    this.recZ.update(dt); this.recX.update(dt); this.recRZ.update(dt); this.recY.update(dt);
    this.swayX.update(dt); this.swayY.update(dt); this.jump.update(dt);
  }

  /**
   * st: {speed, vx, vz, vy, yaw, onGround, ads (0..1 target), adsTime, adsBlend? (overrides), reloadFrac (-1 = none),
   *      switchFrac, scoped (scope type != none), bob (setting), mag, alive}
   */
  update(dt, st) {
    this.lastSt = st;
    const fz = this.frozen;
    const adt = fz ? 0 : dt;
    this.t += adt;
    const g = this.current;

    // ---- ADS blend: smoothstep over adsTime
    const target = st.ads ? 1 : 0;
    const rate = 1 / Math.max(0.05, st.adsTime || 0.2);
    this.adsLin += Math.sign(target - this.adsLin) * Math.min(Math.abs(target - this.adsLin), dt * rate);
    this.adsBlend = st.adsBlend !== undefined ? st.adsBlend : smooth(this.adsLin);
    const ads = this.adsBlend;

    // ---- layer inputs
    const ground = !!st.onGround;
    if (this.wasGround && !ground && (st.vy || 0) > 1) this.jump.impulse(0.02 * 13.416 * Math.E);
    this.wasGround = ground;
    const k60 = dt > 0 ? (1 / 60) / dt : 1;
    // the gun lags behind the look direction (turn right -> it yaws left relative to the view)
    this.swayY.target = Math.max(-0.05, Math.min(0.05, this.lookDX * 0.0011 * k60));
    this.swayX.target = Math.max(-0.05, Math.min(0.05, -this.lookDY * 0.0011 * k60));
    this.lookDX = 0; this.lookDY = 0;
    if (!fz) this._springs(dt);
    const moveSpeed = 6;
    const sp = st.speed || 0;
    const bobTarget = ground ? Math.min(1, sp / 6) : 0;
    this.bobAmt += (bobTarget - this.bobAmt) * Math.min(1, dt * 10);
    this.bobPhase += sp * adt * 1.9;
    const lat = (st.vx || 0) * Math.cos(st.yaw || 0) - (st.vz || 0) * Math.sin(st.yaw || 0);
    this.tilt += (-0.06 * lat / moveSpeed - this.tilt) * Math.min(1, dt * 8);
    this.triggerT += adt;
    this.kickT += adt;
    if (this.flashT > 0) this.flashT -= adt;

    // ---- active timeline
    let tl = null, f = 0;
    const act = this.act;
    if (fz && fz.name === "reload") {
      tl = this._reloadTl(st, true);
      f = fz.frac;
    } else if (act) {
      if (act.kind === "cycle" && st.reloadFrac >= 0) this.act = null;
      else {
        act.t += adt;
        if (act.kind === "switch" && st.switchFrac >= 0 && !fz) act.t = Math.max(act.t, st.switchFrac * act.dur);
        f = act.tl.unit === "s" ? act.t : act.t / act.dur;
        if (f >= tlEnd(act.tl) && !fz) {
          // finish: fire the remaining events at the end
          crossEvents(act.tl.ev, this.activeTl === act.tl ? this.lastF : -1, tlEnd(act.tl), this._evCb);
          if (act.kind === "switch" && this.pendingId) { this._show(this.pendingId); this.pendingId = ""; }
          this.act = null;
        } else tl = act.tl;
      }
    }
    if (!tl && !this.act && st.reloadFrac >= 0 && !(fz && fz.name !== "reload")) {
      tl = this._reloadTl(st, false);
      f = st.reloadFrac;
    }
    if (st.reloadFrac < 0 && !(fz && fz.name === "reload")) { this.reloadTl = null; if (!tl || tl.name !== "reload") this.reloadInfo = null; }

    if (tl !== this.activeTl) {
      // pose changed source: crossfade from where everything is now
      this._snapshot();
      this.xf = fz ? 1 : 0;
      // starting part-way (resumed reload, frozen pose): skip the beats already behind us
      this.lastF = fz || f > 0.02 ? f : -1;
      this.activeTl = tl;
      this._itemPart = null;
      this._resetParts();
    }
    if (tl) {
      crossEvents(tl.ev, this.lastF, f, this._evCb);
      this.lastF = f;
    }
    this.xf = Math.min(1, this.xf + dt / XFADE);
    const xf = smooth(this.xf);

    // ---- gun base + layers -> gunRoot
    const o = this.out;
    if (tl) sampleGun(tl.gun, f, o.gp, o.gr); else { o.gp.set(0, 0, 0); o.gr.set(0, 0, 0); }
    if (xf < 1) { o.gp.lerpVectors(this.snap.gp, o.gp, xf); o.gr.lerpVectors(this.snap.gr, o.gr, xf); }
    const hip = this.hipOverride || HIP[this.currentId] || HIP.default;
    const base = this._base.set(hip.p[0], hip.p[1], hip.p[2]);
    const baseR = this._baseR.set(hip.r[0], hip.r[1], hip.r[2]);
    if (g && g.sockets.sight && ads > 0) {
      const sl = g.sockets.sight.position;
      this._ads.set(-GUN_SCALE * sl.x, -GUN_SCALE * sl.y, -(ADS_EYE[this.currentId] ?? 0.11) - GUN_SCALE * sl.z);
      base.lerp(this._ads, ads);
      baseR.multiplyScalar(1 - ads);
    }
    const breathe = 1 - 0.8 * ads;
    const bobK = this.bobAmt * (1 - 0.85 * ads) * (st.bob === false ? 0.2 : 1);
    const ph = this.bobPhase;
    const swayK = 1 - 0.7 * ads;
    const gp = this.gunRoot.position, gr = this.gunRoot.rotation;
    gp.set(
      base.x + 0.012 * Math.sin(ph) * bobK + this.swayY.x * 0.4 * swayK * -0.6 + o.gp.x,
      base.y + 0.002 * Math.sin(1.6 * this.t) * breathe - 0.014 * Math.abs(Math.cos(ph)) * bobK - this.swayX.x * 0.4 * swayK * 0.6 + this.jump.x + o.gp.y,
      base.z + this.recZ.x + o.gp.z,
    );
    gr.set(
      baseR.x + 0.004 * Math.sin(1.1 * this.t) * breathe + this.recX.x - this.swayX.x * swayK + o.gr.x,
      baseR.y + this.recY.x + this.swayY.x * swayK + o.gr.y,
      baseR.z + 0.015 * Math.sin(ph) * bobK + this.tilt * (1 - 0.5 * ads) + this.recRZ.x - this.swayY.x * 0.5 * swayK + o.gr.z,
    );

    // ---- parts
    if (g) this._applyParts(tl, f, xf, st);
    this.root.updateMatrixWorld(true);
    this.rig.beginFrame();

    // ---- hands
    this.rig.anchor = this._itemAnchor || null;
    this._hand("L", tl ? tl.L : null, f, xf);
    this._hand("R", tl ? tl.R : null, f, xf);

    // ---- held items: melee in R, quiche in L
    const showMelee = !!(tl && tl.show && tl.show.melee && sampleStep(tl.show.melee, f, false));
    if (this.melee) {
      this.melee.group.visible = showMelee;
      if (showMelee) this._attach(this.melee.group, this.hands.R, this.melee.gripInv);
    }
    const showNade = !!(tl && tl.show && tl.show.nade && sampleStep(tl.show.nade, f, false));
    this.nadeGroup.visible = showNade;
    if (showNade) {
      if (!this._nadeInv) {
        this._nadeInv = new THREE.Matrix4();
        const gs = this.nade.sockets && this.nade.sockets.grip;
        if (gs) { gs.updateMatrix(); this._nadeInv.copy(gs.matrix).invert(); }
      }
      this._attach(this.nadeGroup, this.hands.L, this._nadeInv);
      const sp2 = this.nade.parts && this.nade.parts.spark;
      if (sp2) sp2.scale.setScalar(0.7 + Math.random() * 0.6);
    }

    // ---- visibility: scope hides the gun and hands
    const scopedNow = !!st.scoped && ads > 0.9 && !(this.act && (this.act.kind === "melee" || this.act.kind === "grenade"));
    this.gunRoot.visible = !scopedNow;
    this.hands.L.group.visible = this.hands.R.group.visible = !scopedNow;

    // ---- muzzle flash
    if (this.flashT > 0 && g && g.sockets.muzzle && !scopedNow) {
      this.flash.visible = true;
      this._p.setFromMatrixPosition(g.sockets.muzzle.matrixWorld).applyMatrix4(this.rig.rootInv);
      this._v.set(0, 0, -1).applyQuaternion(this.gunRoot.quaternion).multiplyScalar(0.03);
      this.flash.position.copy(this._p).add(this._v);
      this.flash.scale.setScalar(this.flashSize * (0.8 + Math.random() * 0.4) * (1 - 0.3 * ads));
    } else this.flash.visible = false;

    // ---- drops
    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i];
      if (d.t > 0.6) { d.obj.visible = false; continue; }
      d.t += dt;
      d.v.y -= 9 * dt;
      d.p.addScaledVector(d.v, dt);
      this._q.setFromEuler(this._e.set(d.w.x * dt, d.w.y * dt, d.w.z * dt));
      d.q.multiply(this._q);
      d.obj.matrix.compose(d.p, d.q, this._s.set(GUN_SCALE, GUN_SCALE, GUN_SCALE));
      d.obj.matrixWorldNeedsUpdate = true;
      d.obj.visible = d.t < 0.55 && d.p.y > -0.9;
    }
  }

  _reloadTl(st, forFreeze) {
    const def = this.def || {};
    const info = this.reloadInfo || { empty: (st.mag | 0) === 0, n: Math.max(1, (def.magSize || 1) - (st.mag | 0)) };
    const key = `${this.currentId}|${info.empty ? 1 : 0}|${info.n}`;
    if (!this.reloadTl || this.reloadKey !== key) {
      this.reloadTl = reloadTimeline(def.reloadStyle || "mag", { id: this.currentId, empty: info.empty, n: info.n });
      this.reloadKey = key;
    }
    if (!forFreeze) this.reloadInfo = info;
    return this.reloadTl;
  }

  _ev(type, arg) {
    if (type === "drop") return this._drop(arg);
    if (type === "swap") { if (this.pendingId) { this._show(this.pendingId); this.pendingId = ""; this._snapParts(); } return; }
    if (type === "strike" && this.meleeId === "pan") this.recX.impulse(-3 * D * PEAK);
    this._emit(type, arg);
  }

  _snapParts() { const s = this.snap.parts, p = this.out.parts; s.bolt = p.bolt; s.lift = p.lift; s.pump = p.pump; s.slide = p.slide; }

  _drop(kind) {
    const g = this.current;
    if (!g || !g.parts[kind] || !g.dropSrc[kind]) return;
    const d = g.dropSrc[kind];
    const part = g.parts[kind];
    const mesh = part.children.find((c) => c.isMesh);
    (mesh || part).updateMatrixWorld(true);
    this._m.multiplyMatrices(this.rig.rootInv, (mesh || part).matrixWorld);
    this._m.decompose(d.p, d.q, this._s);
    if (kind === "clip") { d.v.set(0.9, 1.4, -0.1).applyQuaternion(this.gunRoot.quaternion); d.w.set(4, 9, -6); }
    else { d.v.set(0, -0.6, 0.1).applyQuaternion(this.gunRoot.quaternion); d.w.set(2.5, 0.5, 1.5); }
    d.t = 0;
    d.obj.visible = true;
  }

  _snapshot() {
    const s = this.snap, o = this.out;
    s.gp.copy(o.gp); s.gr.copy(o.gr);
    s.L.copy(o.L); s.R.copy(o.R);
    this._snapParts();
  }

  _applyParts(tl, f, xf, st) {
    const g = this.current, P = this.out.parts, S = this.snap.parts, def = this.def || {};
    const tp = tl ? tl.parts : null;
    // fire kick (bolt carrier / slide): back fast, forward slower
    const kk = this.kickT;
    const kick = kk < 0.025 ? kk / 0.025 : kk < 0.085 ? 1 - (kk - 0.025) / 0.06 : 0;
    for (const k of PART_KEYS) {
      let v = tp && tp[k] ? sampleScalar(tp[k], f, 0) : 0;
      if (k === "slide" && this.slideLocked && !(tp && tp.slide)) v = 1;
      if (xf < 1) v = S[k] + (v - S[k]) * xf;
      P[k] = v;
    }
    if (tp && tp.slide && f > 0.75) this.slideLocked = false;
    if ((this.kickPart === "bolt" || this.kickPart === "slide") && kick > 0) P[this.kickPart] = Math.max(P[this.kickPart], kick);
    const tr = g.travel || {};
    for (const k of TRAVEL_KEYS) {
      const part = g.parts[k];
      if (!part || !part.userData.rest) continue;
      const t = tr[k];
      const r = part.userData.rest;
      part.position.copy(r.position);
      if (t) part.position.addScaledVector(this._v.set(t.axis[0], t.axis[1], t.axis[2]).normalize(), t.dist * P[k]);
      part.quaternion.copy(r.quaternion);
      if (k === "bolt" && t && t.lift) part.quaternion.multiply(this._q.setFromAxisAngle(this._v.set(0, 0, 1), t.lift * P.lift));
    }
    if (g.parts.trigger && g.parts.trigger.userData.rest) {
      const pull = this.triggerT < 0.05 ? 1 : this.triggerT < 0.12 ? 1 - (this.triggerT - 0.05) / 0.07 : 0;
      g.parts.trigger.quaternion.copy(g.parts.trigger.userData.rest.quaternion).multiply(this._q.setFromAxisAngle(this._v.set(1, 0, 0), pull * 0.4));
    }
    // carried item
    this._itemAnchor = null;
    const it = tl && tl.item;
    if (it && g.parts[it.part]) {
      const part = g.parts[it.part];
      const keys = it.keys;
      const s = sampleTargets(keys, f, this._tA);
      this._itemPose(part, s.a, it.part, this._p, this._q);
      this._itemPose(part, s.b, it.part, this._p2, this._q2);
      part.position.lerpVectors(this._p, this._p2, s.u);
      part.quaternion.slerpQuaternions(this._q, this._q2, s.u);
      part.visible = sampleStep(it.vis, f, true);
      this._itemAnchor = g.anchors[it.part] || null;
      if (it.part === "rocket" && f > 0.5) this.loaded = true;
    } else if (g.parts.rocket) {
      if (!tl && (st.mag | 0) > 0) this.loaded = true;
      if (!tl && (st.mag | 0) === 0) this.loaded = false;
      g.parts.rocket.visible = this.loaded;
    }
  }

  _itemPose(part, pose, kind, p, q) {
    const g = this.current, r = part.userData.rest;
    if (!pose || pose === "rest") { p.copy(r.position); q.copy(r.quaternion); return; }
    if (pose.d !== undefined) {
      const t = g.travel[kind];
      p.copy(r.position);
      if (t) p.addScaledVector(this._v.set(t.axis[0], t.axis[1], t.axis[2]).normalize(), pose.d);
      q.copy(r.quaternion);
      return;
    }
    if (pose.g) {
      p.set(pose.g[0], pose.g[1], pose.g[2]);
      if (pose.r) q.setFromEuler(this._e.set(pose.r[0], pose.r[1], pose.r[2])); else q.copy(r.quaternion);
      return;
    }
    if (pose.s) {
      const s = g.sockets[pose.s];
      if (!s) { p.copy(r.position); q.copy(r.quaternion); return; }
      q.copy(s.quaternion);
      if (pose.r) q.multiply(this._q2.setFromEuler(this._e.set(pose.r[0], pose.r[1], pose.r[2])));
      p.copy(s.position);
      if (pose.o) p.add(this._v.set(pose.o[0], pose.o[1], pose.o[2]).applyQuaternion(s.quaternion));
    }
  }

  _hand(side, keys, f, xf) {
    const H = this.hands[side], o = this.out[side], rig = this.rig;
    const def = side === "R" ? "rg" : "lg";
    let a = def, b = def, u = 0;
    if (keys && keys.length) { const s = sampleTargets(keys, f, this._tA); a = s.a || def; b = s.b || def; u = s.u; }
    if (!rig.resolve(a, this._p, this._q)) { this._p.set(0, -1, 0); this._q.identity(); }
    if (b !== a) {
      if (rig.resolve(b, this._p2, this._q2)) { this._p.lerp(this._p2, u); this._q.slerp(this._q2, u); }
    }
    o.p.copy(this._p); o.q.copy(this._q);
    o.pose = rig.poseOf(a, side); o.poseB = rig.poseOf(b, side); o.u = u;
    let pa = o.pose, pb = o.poseB, pu = u;
    // trigger pull on the firing hand
    if (side === "R" && pa === "trigger" && pb === "trigger") {
      const pull = this.triggerT < 0.05 ? this.triggerT / 0.05 : this.triggerT < 0.11 ? 1 - (this.triggerT - 0.05) / 0.06 : 0;
      pb = "grip"; pu = pull * 0.7;
    }
    if (xf < 1) {
      const sn = this.snap[side];
      this._p.lerpVectors(sn.p, o.p, xf);
      this._q.slerpQuaternions(sn.q, o.q, xf);
      H.setPose(sn.u < 0.5 ? sn.pose : sn.poseB, pu < 0.5 ? pa : pb, xf);
    } else {
      this._p.copy(o.p); this._q.copy(o.q);
      H.setPose(pa, pb, pu);
    }
    H.group.matrix.compose(this._p, this._q, this._s.set(GUN_SCALE, GUN_SCALE, GUN_SCALE));
    H.group.matrixWorldNeedsUpdate = true;
    H.group.updateMatrixWorld(true);
  }

  /** item.matrix = hold.world * inverse(grip) (in root space). */
  _attach(group, hand, gripInv) {
    const hold = hand.points.hold;
    hold.updateWorldMatrix(true, false);
    this._m.multiplyMatrices(this.rig.rootInv, hold.matrixWorld).multiply(gripInv);
    group.matrix.copy(this._m);
    group.matrixWorldNeedsUpdate = true;
  }

  setVisible(v) { this.root.visible = v; }

  /** Map a view-model point (root space) to the world through the main camera so it lands on the same pixel. */
  _toWorld(camera, p, out) {
    const vc = this.r.vmCamera;
    const z = Math.min(-0.05, p.z);
    const tv = Math.tan((vc.fov * Math.PI) / 360), tm = Math.tan((camera.fov * Math.PI) / 360);
    const k = tm / tv;
    out.set(p.x * k, p.y * k, z);
    return out.applyMatrix4(camera.matrixWorld);
  }

  /** Muzzle position in world space (for tracers), given the main camera. */
  muzzleWorld(camera, out = new THREE.Vector3()) {
    const g = this.current;
    if (!g || !g.sockets.muzzle) { out.set(0.1, -0.1, -0.6); return out.applyMatrix4(camera.matrixWorld); }
    this.root.updateMatrixWorld(true);
    this._p.setFromMatrixPosition(g.sockets.muzzle.matrixWorld).applyMatrix4(this._m2.copy(this.root.matrixWorld).invert());
    // the gun is hidden while scoped: start from just below the eye instead
    if (!this.gunRoot.visible) this._p.set(0, -0.06, -0.3);
    return this._toWorld(camera, this._p, out);
  }

  /** Ejector position (world) and ejection direction (world, unit) for casings. */
  ejectorWorld(camera, out = new THREE.Vector3(), dirOut = new THREE.Vector3()) {
    const g = this.current;
    const s = g && (g.sockets.ejector || g.sockets.muzzle);
    if (!s) { out.set(0.1, -0.1, -0.4).applyMatrix4(camera.matrixWorld); dirOut.set(1, 0.5, 0).applyQuaternion(camera.quaternion).normalize(); return out; }
    this.root.updateMatrixWorld(true);
    this._m2.copy(this.root.matrixWorld).invert();
    this._p.setFromMatrixPosition(s.matrixWorld).applyMatrix4(this._m2);
    if (!this.gunRoot.visible) this._p.set(0.08, -0.08, -0.25);
    this._toWorld(camera, this._p, out);
    s.getWorldQuaternion(this._q);
    dirOut.set(1, 0, 0).applyQuaternion(this._q).applyQuaternion(camera.quaternion).normalize();
    return out;
  }

  dispose() {
    for (const g of this.guns.values()) g.dispose();
    for (const m of this.melees.values()) m.dispose();
    for (const h of Object.values(this.hands)) h.dispose();
    for (const d of this.drops) d.obj.removeFromParent();
    if (this.flash.material.map) this.flash.material.map.dispose();
    this.flash.material.dispose();
    this.root.removeFromParent();
  }
}
