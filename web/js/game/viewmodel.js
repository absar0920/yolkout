// First-person view model: the held weapon drawn in its own scene/camera
// (renderer.vmScene) with bob, sway, recoil kick, muzzle flash, reload / switch /
// melee / grenade animations and an ADS pose.

import * as THREE from "../../vendor/three.module.min.js";
import { buildGun, buildRollingPin, buildGrenade } from "./models.js";
import { radialTexture } from "../engine/textures.js";

const HIP = new THREE.Vector3(0.21, -0.2, -0.52);
const ADS = new THREE.Vector3(0, -0.098, -0.34);
const GUN_SCALE = 0.55;

export class ViewModel {
  constructor(renderer) {
    this.r = renderer;
    this.root = new THREE.Group();
    this.r.vmCamera.add(this.root);
    this.gunRoot = new THREE.Group();
    this.gunRoot.scale.setScalar(GUN_SCALE);
    this.root.add(this.gunRoot);
    this.guns = new Map();
    this.current = null;
    this.currentId = "";
    this.muzzle = new THREE.Vector3();
    this.pin = buildRollingPin();
    this.pin.visible = false;
    this.root.add(this.pin);
    this.nade = buildGrenade();
    this.nade.visible = false;
    this.nade.scale.setScalar(0.8);
    this.root.add(this.nade);
    // muzzle flash: an additive star sprite pair
    const fm = new THREE.SpriteMaterial({ map: radialTexture("flash", "rgba(255,240,180,1)", "rgba(255,140,30,0)"),
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true });
    this.flash = new THREE.Sprite(fm);
    this.flash.scale.setScalar(0.22);
    this.flash.visible = false;
    this.gunRoot.add(this.flash);
    this.t = 0;
    this.kick = 0; this.kickRot = 0; this.kickSide = 0;
    this.sway = new THREE.Vector2();
    this.swayV = new THREE.Vector2();
    this.flashT = 0;
    this.meleeT = 0; this.nadeT = 0;
    this.ads = 0;
    this.bobPhase = 0;
    this.landDip = 0;
  }

  setWeapon(id) {
    if (id === this.currentId) return;
    this.currentId = id;
    if (this.current) this.current.group.visible = false;
    if (!this.guns.has(id)) {
      const g = buildGun(id);
      g.group.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
      this.gunRoot.add(g.group);
      this.guns.set(id, g);
    }
    this.current = this.guns.get(id);
    this.current.group.visible = true;
    this.flash.position.copy(this.current.muzzle).add(new THREE.Vector3(0, 0, -0.06));
  }

  fire(strength = 1) {
    this.kick = Math.min(1.6, this.kick + 0.55 * strength);
    this.kickRot = Math.min(1.6, this.kickRot + 0.6 * strength);
    this.kickSide = (Math.random() - 0.5) * strength;
    this.flashT = 0.05;
    this.flash.material.rotation = Math.random() * Math.PI;
    this.r.vmFlash.intensity = 4;
  }

  melee() { this.meleeT = 1; }
  throwNade() { this.nadeT = 1; }
  land(strength) { this.landDip = Math.min(1, this.landDip + strength); }

  /** Mouse delta in pixels for sway. */
  look(dx, dy) {
    this.swayV.x += dx * 0.00012;
    this.swayV.y += dy * 0.00012;
  }

  /**
   * st: {speed (horizontal u/s), onGround, ads (0..1), reload (0..1 progress or -1), switching (0..1 or -1),
   *      scoped (bool: hide gun at full ADS), bob (setting)}
   */
  update(dt, st) {
    this.t += dt;
    this.ads += ((st.ads ? 1 : 0) - this.ads) * Math.min(1, dt * 14);
    const ads = this.ads;
    // sway spring
    this.sway.x += this.swayV.x; this.sway.y += this.swayV.y;
    this.swayV.multiplyScalar(0.0);
    this.sway.multiplyScalar(Math.max(0, 1 - dt * 10));
    this.sway.clampScalar(-0.06, 0.06);
    // bob
    const moving = st.onGround ? Math.min(1, st.speed / 6) : 0;
    this.bobPhase += dt * (5 + st.speed * 1.2) * (moving > 0.05 ? 1 : 0.3);
    const bobAmt = (st.bob === false ? 0.2 : 1) * (1 - ads * 0.85);
    const bx = Math.sin(this.bobPhase) * 0.012 * moving * bobAmt;
    const by = -Math.abs(Math.cos(this.bobPhase)) * 0.014 * moving * bobAmt + Math.sin(this.t * 1.6) * 0.002 * (1 - ads);
    // recoil
    this.kick = Math.max(0, this.kick - dt * 9);
    this.kickRot = Math.max(0, this.kickRot - dt * 7);
    this.landDip = Math.max(0, this.landDip - dt * 4);
    // base pose
    const p = this.gunRoot.position;
    p.lerpVectors(HIP, ADS, ads);
    p.x += bx - this.sway.x * (1 - ads * 0.7) + this.kickSide * 0.01 * this.kick;
    p.y += by + this.sway.y * (1 - ads * 0.7) - this.landDip * 0.05;
    p.z += this.kick * (0.06 - ads * 0.03);
    let rx = this.kickRot * (0.12 - ads * 0.07), ry = 0, rz = 0;
    // reload: dip down and roll
    if (st.reload >= 0) {
      const s = Math.sin(Math.min(1, st.reload) * Math.PI);
      p.y -= s * 0.16; rx -= s * 0.5; rz += s * 0.6;
    }
    // switch: lower then raise
    if (st.switching >= 0) {
      const s = 1 - st.switching; // 1 at start -> 0
      p.y -= s * 0.3; rx -= s * 0.8;
    }
    // melee: swing the rolling pin across, lower the gun
    if (this.meleeT > 0) {
      this.meleeT = Math.max(0, this.meleeT - dt * 3.2);
      const m = 1 - this.meleeT;
      const s = Math.sin(m * Math.PI);
      this.pin.visible = true;
      this.pin.position.set(0.35 - m * 0.6, -0.15 + s * 0.08, -0.55 - s * 0.15);
      this.pin.rotation.set(0.2, 0.9 - m * 1.8, 0.4 - m * 0.8);
      p.y -= s * 0.25; p.x += s * 0.1;
    } else this.pin.visible = false;
    // grenade: hand up and forward
    if (this.nadeT > 0) {
      this.nadeT = Math.max(0, this.nadeT - dt * 3.5);
      const m = 1 - this.nadeT;
      this.nade.visible = m < 0.55;
      this.nade.position.set(-0.22 + m * 0.1, -0.2 + Math.sin(m * Math.PI) * 0.25, -0.55 - m * 0.5);
      p.y -= Math.sin(m * Math.PI) * 0.12;
    } else this.nade.visible = false;
    this.gunRoot.rotation.set(rx - this.sway.y * 2 * (1 - ads), ry - this.sway.x * 2 * (1 - ads), rz + this.sway.x * 1.5);
    this.gunRoot.visible = !(st.scoped && ads > 0.9);
    // flash
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flash.visible = this.gunRoot.visible;
      this.flash.scale.setScalar(0.16 + Math.random() * 0.1);
    } else this.flash.visible = false;
  }

  setVisible(v) { this.root.visible = v; }

  /** Approximate muzzle position in world space (for tracers), given the main camera. */
  muzzleWorld(camera, out = new THREE.Vector3()) {
    // map the view-model muzzle into the main camera frame (same orientation, different fov)
    const m = this.current ? this.current.muzzle : new THREE.Vector3(0, 0, -0.5);
    out.copy(m).multiplyScalar(GUN_SCALE).applyEuler(this.gunRoot.rotation).add(this.gunRoot.position);
    out.applyMatrix4(camera.matrixWorld);
    return out;
  }
}
