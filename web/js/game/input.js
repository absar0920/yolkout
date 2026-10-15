// Keyboard / mouse / gamepad input with pointer lock.
// The game samples input once per fixed 60 Hz tick via sample(); presses shorter
// than a tick are latched so semi-auto taps, reload, grenade and melee are never lost.

import { KEY, BTN } from "../engine/physics.js";

export const DEFAULT_BINDS = {
  fwd: ["KeyW", "ArrowUp"], back: ["KeyS", "ArrowDown"], left: ["KeyA", "ArrowLeft"], right: ["KeyD", "ArrowRight"],
  jump: ["Space"], reload: ["KeyR"], grenade: ["KeyG"], melee: ["KeyF", "KeyV"],
  swap: ["KeyQ", "KeyE"], primary: ["Digit1"], secondary: ["Digit2"], meleeKey: ["Digit3"],
  aim: [], fire: [], scoreboard: ["Tab"], chat: ["Enter", "KeyT"], teamChat: ["KeyY"],
};

export class Input {
  /**
   * @param {HTMLElement} el     element that receives clicks / pointer lock (the canvas)
   * @param {object} cb          {onLockChange(locked), onScoreboard(show), onChat(teamOnly), onLook(dx,dy), onWheel(dir)}
   * @param {object} settings    {sensitivity, adsSensitivity, invertY, toggleAds, binds, gamepadSensitivity}
   */
  constructor(el, cb, settings) {
    this.el = el;
    this.cb = cb;
    this.settings = settings;
    this.binds = Object.assign({}, DEFAULT_BINDS, settings.binds || {});
    this.held = new Set();
    this.mouseButtons = 0;
    this.latched = 0; // buttons pressed since last sample
    this.lookDX = 0; this.lookDY = 0;
    this.slot = 0;
    this.locked = false;
    this.enabled = true; // false while chat/menu is open
    this.adsToggled = false;
    this.pad = { idx: -1, prev: [], lookX: 0, lookY: 0, moveX: 0, moveY: 0, fire: false, aim: false };
    this.scoreHeld = false;

    this._kd = (e) => this._key(e, true);
    this._ku = (e) => this._key(e, false);
    this._md = (e) => this._mouse(e, true);
    this._mu = (e) => this._mouse(e, false);
    this._mm = (e) => {
      if (!this.locked) return;
      // ignore absurd spikes some browsers emit on lock
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.lookDX += e.movementX; this.lookDY += e.movementY;
    };
    this._wh = (e) => { if (this.locked) { e.preventDefault(); this.cb.onWheel && this.cb.onWheel(Math.sign(e.deltaY)); } };
    this._plc = () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.el;
      if (!this.locked) { this.held.clear(); this.mouseButtons = 0; }
      if (was !== this.locked && this.cb.onLockChange) this.cb.onLockChange(this.locked);
    };
    this._blur = () => { this.held.clear(); this.mouseButtons = 0; this._setScore(false); };
    this._ctx = (e) => e.preventDefault();
    this._click = () => { if (!this.locked && this.enabled && this.settings.clickToLock !== false) this.lock(); };
    window.addEventListener("keydown", this._kd);
    window.addEventListener("keyup", this._ku);
    el.addEventListener("mousedown", this._md);
    window.addEventListener("mouseup", this._mu);
    window.addEventListener("mousemove", this._mm);
    el.addEventListener("wheel", this._wh, { passive: false });
    el.addEventListener("contextmenu", this._ctx);
    el.addEventListener("click", this._click);
    document.addEventListener("pointerlockchange", this._plc);
    this._ple = () => { this.cb.onLockError && this.cb.onLockError(); };
    document.addEventListener("pointerlockerror", this._ple);
    window.addEventListener("blur", this._blur);
  }

  dispose() {
    window.removeEventListener("keydown", this._kd);
    window.removeEventListener("keyup", this._ku);
    this.el.removeEventListener("mousedown", this._md);
    window.removeEventListener("mouseup", this._mu);
    window.removeEventListener("mousemove", this._mm);
    this.el.removeEventListener("wheel", this._wh);
    this.el.removeEventListener("contextmenu", this._ctx);
    this.el.removeEventListener("click", this._click);
    document.removeEventListener("pointerlockchange", this._plc);
    document.removeEventListener("pointerlockerror", this._ple);
    window.removeEventListener("blur", this._blur);
    this.unlock();
  }

  setSettings(s) {
    this.settings = s;
    this.binds = Object.assign({}, DEFAULT_BINDS, s.binds || {});
  }

  lock() {
    if (!this.el.requestPointerLock) return;
    try {
      const p = this.el.requestPointerLock({ unadjustedMovement: !!this.settings.rawInput });
      if (p && p.catch) p.catch(() => { try { this.el.requestPointerLock(); } catch { /* ignore */ } });
    } catch { /* ignore */ }
  }
  unlock() { if (document.pointerLockElement === this.el) document.exitPointerLock(); }

  _is(action, code) { const b = this.binds[action]; return !!b && b.includes(code); }

  _setScore(v) {
    if (v === this.scoreHeld) return;
    this.scoreHeld = v;
    this.cb.onScoreboard && this.cb.onScoreboard(v);
  }

  _key(e, down) {
    const code = e.code;
    const typing = e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable);
    if (typing) return;
    if (this._is("scoreboard", code) && (this.locked || !down)) { if (this.locked) e.preventDefault(); this._setScore(down && this.locked); return; }
    if (!this.enabled) { if (!down) this.held.delete(code); return; }
    // Browsers normally swallow Esc to release pointer lock; if the key reaches us while
    // locked (embedded/automated browsers, some kiosk modes), release it ourselves.
    if (down && this.locked && code === "Escape") { e.preventDefault(); this.cb.onMenu && this.cb.onMenu(); return; }
    if (down && this.locked && (this._is("chat", code) || this._is("teamChat", code))) {
      e.preventDefault();
      this.held.clear(); this.mouseButtons = 0;
      this.cb.onChat && this.cb.onChat(this._is("teamChat", code));
      return;
    }
    if (!this.locked) { if (!down) this.held.delete(code); return; }
    if (code === "Space" || code.startsWith("Arrow") || code === "Tab") e.preventDefault();
    if (down) {
      if (e.repeat) return;
      this.held.add(code);
      if (this._is("reload", code)) this.latched |= BTN.RELOAD;
      if (this._is("grenade", code)) this.latched |= BTN.GRENADE;
      if (this._is("melee", code) || this._is("meleeKey", code)) this.latched |= BTN.MELEE;
      if (this._is("fire", code)) this.latched |= BTN.FIRE;
      if (this._is("swap", code)) this.slot = this.slot ? 0 : 1;
      if (this._is("primary", code)) this.slot = 0;
      if (this._is("secondary", code)) this.slot = 1;
      if (this._is("aim", code) && this.settings.toggleAds) this.adsToggled = !this.adsToggled;
    } else {
      this.held.delete(code);
    }
  }

  _mouse(e, down) {
    if (!this.locked || !this.enabled) { if (!down) this.mouseButtons &= ~(1 << e.button); return; }
    e.preventDefault();
    const bit = 1 << e.button;
    if (down) {
      this.mouseButtons |= bit;
      if (e.button === 0) this.latched |= BTN.FIRE;
      if (e.button === 2 && this.settings.toggleAds) this.adsToggled = !this.adsToggled;
      if (e.button === 1) this.latched |= BTN.GRENADE;
      if (e.button === 3 || e.button === 4) this.latched |= BTN.MELEE;
    } else this.mouseButtons &= ~bit;
  }

  _held(action) {
    const b = this.binds[action];
    if (!b) return false;
    for (const c of b) if (this.held.has(c)) return true;
    return false;
  }

  /** Poll the gamepad once per frame (standard mapping). Returns look delta in radians-ish units. */
  pollGamepad(dt) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (const p of pads) if (p && p.connected && p.mapping === "standard") { gp = p; break; }
    if (!gp) for (const p of pads) if (p && p.connected) { gp = p; break; }
    const P = this.pad;
    if (!gp) { P.idx = -1; P.moveX = P.moveY = 0; P.fire = P.aim = false; return; }
    P.idx = gp.index;
    const dz = (v, d = 0.18) => (Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d));
    P.moveX = dz(gp.axes[0] || 0); P.moveY = dz(gp.axes[1] || 0);
    const lx = dz(gp.axes[2] || 0, 0.12), ly = dz(gp.axes[3] || 0, 0.12);
    const sens = (this.settings.gamepadSensitivity ?? 1) * 3.2;
    const curve = (v) => Math.sign(v) * v * v;
    if (this.enabled) {
      P.lookX = curve(lx) * sens * dt;
      P.lookY = curve(ly) * sens * dt;
    } else P.lookX = P.lookY = 0;
    const b = (i) => !!(gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.4));
    const edge = (i) => b(i) && !P.prev[i];
    if (this.enabled) {
      P.fire = b(7); P.aim = b(6);
      if (edge(7)) this.latched |= BTN.FIRE;
      if (edge(2)) this.latched |= BTN.RELOAD;
      if (edge(5)) this.latched |= BTN.GRENADE;
      if (edge(1) || edge(11)) this.latched |= BTN.MELEE;
      if (edge(3) || edge(4)) this.slot = this.slot ? 0 : 1;
      if (edge(8)) this._setScore(true);
      if (!b(8) && P.prev[8]) this._setScore(false);
      if (edge(9) && this.cb.onMenu) this.cb.onMenu();
    }
    P.jump = this.enabled && b(0);
    for (let i = 0; i < gp.buttons.length; i++) P.prev[i] = b(i);
  }

  get gamepadActive() { return this.pad.idx >= 0; }

  /** Consume accumulated mouse movement (pixels). */
  takeLook() {
    const dx = this.lookDX, dy = this.lookDY;
    this.lookDX = 0; this.lookDY = 0;
    return [dx, dy];
  }

  aimHeld() {
    if (!this.enabled) return false;
    if (this.settings.toggleAds) return this.adsToggled;
    return (this.locked && ((this.mouseButtons & 4) !== 0 || this._held("aim"))) || this.pad.aim;
  }

  /** Sample keys/buttons for one tick. */
  sample() {
    let keys = 0, buttons = 0;
    const active = this.enabled && (this.locked || this.pad.idx >= 0);
    if (active) {
      if (this._held("fwd") || this.pad.moveY < -0.3) keys |= KEY.FWD;
      if (this._held("back") || this.pad.moveY > 0.3) keys |= KEY.BACK;
      if (this._held("left") || this.pad.moveX < -0.3) keys |= KEY.LEFT;
      if (this._held("right") || this.pad.moveX > 0.3) keys |= KEY.RIGHT;
      if (this._held("jump") || this.pad.jump) keys |= KEY.JUMP;
      if ((this.locked && (this.mouseButtons & 1)) || this._held("fire") || this.pad.fire) buttons |= BTN.FIRE;
      if (this.aimHeld()) buttons |= BTN.AIM;
      buttons |= this.latched;
    }
    this.latched = 0;
    return { keys, buttons, slot: this.slot };
  }

  clearHeld() { this.held.clear(); this.mouseButtons = 0; this.latched = 0; this.adsToggled = false; }
}
