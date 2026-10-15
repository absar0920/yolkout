// Yolkout game client core: owns the renderer, network connection, prediction,
// interpolation, effects and input, and reports UI state through callbacks.
// See web/js/main.js / shared/CLIENT_API.md for the public API.

import * as THREE from "../../vendor/three.module.min.js";
import * as Phys from "../engine/physics.js";
import { Renderer } from "../engine/renderer.js";
import { buildMapMesh } from "../engine/mapmesh.js";
import { Connection } from "../net/connection.js";
import { LocalServer } from "../net/localserver.js";
import { TickClock } from "../net/clock.js";
import { SnapshotBuffer } from "../net/interp.js";
import { EggAvatar, buildPickup, buildNest, buildGoldenEgg, buildGrenade, buildShell } from "./models.js";
import { ViewModel } from "./viewmodel.js";
import { Effects } from "./effects.js";
import { Input } from "./input.js";
import { Overlay } from "./overlay.js";
import { loadAudio, play, playAt } from "./audiohook.js";

const { KEY, BTN } = Phys;

export const DEFAULT_SETTINGS = {
  sensitivity: 1.0,        // mouse multiplier (1.0 = 0.0022 rad per pixel)
  adsSensitivity: 0.85,    // extra multiplier while aiming (also scaled by the fov ratio)
  invertY: false,
  fov: 75,                 // vertical field of view, degrees
  quality: "high",         // "low" | "medium" | "high"
  shadows: true,
  pixelRatioCap: 1.5,
  showDebug: false,
  showFps: false,
  crosshair: true,
  crosshairColor: "#ffffff",
  toggleAds: false,
  viewBob: true,
  gamepadSensitivity: 1.0,
  rawInput: false,
  clickToLock: true,
  nameplates: true,
  binds: null,             // partial override of input.DEFAULT_BINDS
};

const tmpV = new THREE.Vector3();
const FLAG = { ALIVE: 1, GROUND: 2, AIM: 4, RELOAD: 8, PROT: 16, CARRY: 32, FURY: 64, SWITCH: 128, FIRED: 256 };

export class Game {
  constructor(data, opts) {
    this.data = data;
    this.C = data.C;
    this.opts = opts;
    this.cb = opts.callbacks || {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, opts.settings || {});
    this.name = opts.name || "";
    this.cls = data.weapons.primaries.includes(opts.cls) ? opts.cls : data.weapons.defaultPrimary;
    this.cos = Object.assign({}, data.cosmetics.defaults, opts.cosmetics || {});

    // DOM: container + canvas
    let canvas = opts.canvas || null;
    let container = opts.container || (canvas && canvas.parentElement) || document.body;
    if (!canvas) {
      canvas = document.createElement("canvas");
      container.appendChild(canvas);
      this._ownCanvas = true;
    }
    if (!canvas.style.width) Object.assign(canvas.style, { width: "100%", height: "100%", display: "block" });
    canvas.hidden = false;
    if (getComputedStyle(container).position === "static") container.style.position = "relative";
    this.canvas = canvas;
    this.container = container;

    this.R = new Renderer(canvas, this.settings);
    this.overlay = new Overlay(container);
    this.effects = new Effects(this.R, Phys, { lowFx: this.settings.quality === "low" });
    this.vm = new ViewModel(this.R);
    this.input = new Input(canvas, {
      onLockChange: (locked) => this._onLock(locked),
      onScoreboard: (v) => { this.sbVisible = v; this._cb("onScoreboardToggle", v); if (v) this._emitScoreboard(); },
      onChat: (team) => this._openChat(team),
      onWheel: () => { this.input.slot = this.input.slot ? 0 : 1; },
      onMenu: () => { this.input.unlock(); this._setPaused(true); },
      onLockError: () => this._cb("onPointerLockError"),
    }, this.settings);

    this.clock = new TickClock(data.rules.net.tickRate, data.rules.net.interpDelayMs);
    this.snaps = new SnapshotBuffer(Math.round(data.rules.net.interpDelayMs / (1000 / data.rules.net.tickRate)));
    this.DT = 1 / data.rules.net.tickRate;

    this.roster = new Map();
    this.avatars = new Map();
    this.remote = new Map(); // id -> {x,y,z,yaw,pitch,flags,alive,team, step}
    this.projMeshes = new Map();
    this.pickups = [];
    this.pk = "";
    this.nests = [];
    this.eggs = new Map();
    this.obj = null;

    this.myId = 0;
    this.room = null;
    this.match = { state: "live", tl: 0, tlAt: 0, ts: [0, 0], limit: 0, mode: "", map: "" };
    this.predictor = null;
    this.alive = false;
    this.hp = 0; this.sh = 0; this.fury = 0;
    this.yaw = 0; this.pitch = 0;
    this.recoilBack = 0;   // pitch to recover
    this.camKick = 0;
    this.adsT = 0;
    this.seq = 0;
    this.unsent = [];
    this.lastSend = 0;
    this.acc = 0;
    this.corr = new THREE.Vector3();
    this.deathCam = null;
    this.respawnAt = 0;
    this.killer = null;
    this.paused = false;
    this.chatOpen = false;
    this.sbVisible = false;
    this.loading = true;
    this.queue = [];
    this.stopped = false;
    this.mapMesh = null;
    this.mapJson = null;
    this.world = null;
    this.frames = 0; this.fps = 0; this.fpsT = 0;
    this.hudT = 0;
    this.stepDist = 0;
    this.wasGround = true;
    this.fallVy = 0;
    this.lastErr = 0;
    this.tAnim = 0;
    this.myStreak = 0;
    this.lastFrame = performance.now();
    loadAudio();
  }

  _cb(name, ...args) {
    const f = this.cb[name];
    if (typeof f === "function") {
      try { f(...args); } catch (e) { console.error(`callback ${name}`, e); }
    }
  }

  // ---------------------------------------------------------------- connection

  async connect() {
    const o = this.opts;
    let socketFactory = null;
    if (o.offline) {
      const ls = new LocalServer(this.data, { mode: o.mode, map: o.map, bots: o.bots ?? 5, difficulty: o.difficulty ?? 0.5 });
      await ls.init();
      this.local = ls;
      socketFactory = () => ls.socket();
    }
    this.conn = new Connection({ url: o.url, socketFactory });
    this.conn.onAny = (m) => this._onMsg(m);
    this.conn.onClose = (reason) => {
      this._cb("onDisconnect", reason);
      this.disconnected = reason;
      this.input.unlock();
    };
    const hello = {
      name: this.name, cls: this.cls, cos: this.cos, mode: o.mode || "", map: o.map || "",
      room: o.roomCode ? String(o.roomCode).toUpperCase() : "", create: o.createRoom ? 1 : 0,
    };
    const welcome = await this.conn.connect(hello);
    await this._onWelcome(welcome);
    return welcome;
  }

  async _onWelcome(w) {
    this.myId = w.id;
    this.room = w.room;
    this.clock.sample(w.k, performance.now());
    for (const p of w.players) this._rosterSet(p);
    this.match = { state: w.match.state, tl: w.match.tl, tlAt: performance.now(), ts: w.match.ts || [0, 0],
      limit: w.match.limit, mode: w.room.mode, map: w.room.map };
    this.pk = w.pk || "";
    this.obj = w.o || null;
    await this._loadMap(w.room.map);
    this._cb("onRoom", { code: w.room.code, mode: w.room.mode, map: w.room.map, private: !!w.room.priv, max: w.room.max, id: w.id, offline: !!this.local });
    this._drain();
    this._cb("onMatchStart", this._matchInfo());
    this._raf = requestAnimationFrame((t) => this._frame(t));
  }

  _drain() {
    this.loading = false;
    const q = this.queue;
    this.queue = [];
    for (const m of q) {
      this._handle(m);
      if (this.loading) { this.queue.push(...q.slice(q.indexOf(m) + 1)); return; }
    }
  }

  _onMsg(m) {
    if (this.loading) { this.queue.push(m); return; }
    this._handle(m);
  }

  // ---------------------------------------------------------------- map

  async _loadMap(id) {
    this.loading = true;
    const { json, world } = await this.data.map(id);
    if (this.stopped) return;
    if (this.mapMesh) { this.R.scene.remove(this.mapMesh.group); this.mapMesh.dispose(); }
    for (const p of this.pickups) this.R.scene.remove(p.group);
    for (const n of this.nests) this.R.scene.remove(n);
    for (const e of this.eggs.values()) this.R.scene.remove(e);
    for (const m of this.projMeshes.values()) this.R.scene.remove(m);
    this.pickups = []; this.nests = []; this.eggs.clear(); this.projMeshes.clear();
    this.mapJson = json;
    this.world = world;
    this.mapMesh = buildMapMesh(json, { anisotropy: this.settings.quality === "low" ? 1 : 4 });
    this.R.scene.add(this.mapMesh.group);
    this.R.setPalette(json.palette || {}, json.bounds);
    this.effects.setWorld(world);
    json.pickups.forEach((pu) => {
      const g = buildPickup(pu.type);
      g.position.set(pu.pos[0], pu.pos[1], pu.pos[2]);
      this.R.scene.add(g);
      this.pickups.push({ group: g, type: pu.type, pos: pu.pos });
    });
    const modeDef = this.data.modes.modes[this.match.mode];
    if (modeDef && modeDef.objective === "nest") {
      for (const n of json.nests || []) {
        const color = this._teamColor(n.team);
        const g = buildNest(color);
        g.position.set(n.pos[0], n.pos[1], n.pos[2]);
        this.R.scene.add(g);
        this.nests.push(g);
        const egg = buildGoldenEgg(color);
        egg.position.set(n.pos[0], n.pos[1] + 0.25, n.pos[2]);
        this.R.scene.add(egg);
        this.eggs.set(n.team, egg);
      }
    }
    if (this.predictor) this.predictor.setWorld(world);
    this.snaps.clear();
    this.unsent.length = 0;
    // Pre-link the map's shader programs in parallel (KHR_parallel_shader_compile) so the first
    // frames don't hitch; bounded so a slow driver never delays joining by more than ~1.5 s.
    const r = this.R.renderer;
    if (r.compileAsync) {
      await Promise.race([r.compileAsync(this.R.scene, this.R.camera).catch(() => {}), new Promise((res) => setTimeout(res, 1500))]);
    }
  }

  _teamColor(t) {
    const T = this.data.modes.teams[String(t)];
    return T ? T.color : "#ffffff";
  }
  _teamName(t) {
    const T = this.data.modes.teams[String(t)];
    return T ? T.name : "";
  }
  _isTeams() {
    const m = this.data.modes.modes[this.match.mode];
    return !!(m && m.teams);
  }

  // ---------------------------------------------------------------- roster / avatars

  _rosterSet(p) {
    const prev = this.roster.get(p.id);
    const r = Object.assign(prev || { spawnCls: p.cls, ping: 0 }, p);
    this.roster.set(p.id, r);
    if (p.id === this.myId) { this.myTeam = p.tm; this.myStreak = p.st || 0; return r; }
    let av = this.avatars.get(p.id);
    if (!av) {
      av = new EggAvatar(this.data, { name: p.n, team: this._isTeams() ? p.tm : 0, teamColor: this._teamColor(p.tm), cos: p.cos || {},
        cls: r.spawnCls || p.cls, nameplate: this.settings.nameplates !== false });
      av.setVisible(false);
      this.R.scene.add(av.root);
      this.avatars.set(p.id, av);
    } else {
      if (JSON.stringify(av.cos) !== JSON.stringify(p.cos)) av.setCosmetics(p.cos || {});
      const tm = this._isTeams() ? p.tm : 0;
      if (av.team !== tm) av.setTeam(tm, this._teamColor(p.tm));
      if (av.name !== p.n) av.setName(p.n);
    }
    return r;
  }

  _removePlayer(id) {
    this.roster.delete(id);
    const av = this.avatars.get(id);
    if (av) { this.R.scene.remove(av.root); av.dispose(); this.avatars.delete(id); }
    this.remote.delete(id);
  }

  _name(id) {
    if (!id) return "";
    const r = this.roster.get(id);
    return r ? r.n : `#${id}`;
  }

  _who(id) {
    const r = this.roster.get(id);
    return { id, name: r ? r.n : id ? `#${id}` : "", team: r ? r.tm : 0, me: id === this.myId };
  }

  _weaponName(w) {
    if (w === "fall") return "Gravity";
    const d = this.data.weapons.weapons[w];
    return d ? d.name : w;
  }

  // ---------------------------------------------------------------- messages

  _handle(m) {
    const now = performance.now();
    switch (m.t) {
      case "s": return this._onSnapshot(m, now);
      case "join":
        this._rosterSet(m.p);
        this._cb("onChat", { system: true, text: `${m.p.n} joined`, id: 0 });
        break;
      case "leave": {
        const n = this._name(m.id);
        this._removePlayer(m.id);
        if (n) this._cb("onChat", { system: true, text: `${n} left`, id: 0 });
        this._emitScoreboard();
        break;
      }
      case "pu": this._rosterSet(m.p); this._emitScoreboard(); break;
      case "spawn": this._onSpawn(m); break;
      case "shot": this._onShot(m); break;
      case "melee": {
        const av = this.avatars.get(m.id);
        if (av) { av.melee(); playAt("shoot_rollingpin", av.root.position.x, av.root.position.y, av.root.position.z, this._listener(), 0.7); }
        break;
      }
      case "boom": this._onBoom(m); break;
      case "hit": this._onHit(m); break;
      case "kill": this._onKill(m, now); break;
      case "streak": {
        const r = this.roster.get(m.id);
        if (r) r.st = m.n;
        const def = (this.data.rules.streaks || []).find((s) => s.id === m.r);
        this._cb("onStreak", { ...this._who(m.id), n: m.n, reward: m.r, rewardName: def ? def.name : m.r, desc: def ? def.desc : "" });
        if (m.id === this.myId) play("pickup", { volume: 1, local: true });
        break;
      }
      case "pick": {
        if (m.id === this.myId) play("pickup", { volume: 1, local: true });
        const p = this.pickups[m.i];
        if (p) p.group.visible = false;
        const T = this.data.rules.pickups.types[m.ty];
        this._cb("onPickup", { ...this._who(m.id), index: m.i, type: m.ty, pickupName: T ? T.name : m.ty });
        break;
      }
      case "flag":
        this._cb("onFlag", { ev: m.ev, team: m.tm, teamName: this._teamName(m.tm), teamColor: this._teamColor(m.tm), ...this._who(m.id),
          mine: m.tm === this.myTeam });
        play(m.ev === "cap" ? "kill" : "ui_click", { volume: 0.8, local: false });
        break;
      case "chat": {
        const r = this.roster.get(m.id);
        this._cb("onChat", { id: m.id, name: r ? r.n : "?", team: r ? r.tm : 0, text: String(m.m), teamOnly: !!m.tm, me: m.id === this.myId, system: false });
        break;
      }
      case "sys": this._cb("onChat", { system: true, text: String(m.m), id: 0 }); break;
      case "sb": this._onScoreboard(m, now); break;
      case "end": this._onEnd(m); break;
      case "start": this._onStart(m); break;
      case "pong":
        this.ping = this.conn.rtt;
        this._cb("onPing", this.ping);
        break;
      case "err": this.lastErrMsg = m; break;
      default: break;
    }
  }

  _onSnapshot(m, now) {
    this.clock.sample(m.k, now);
    this.snaps.push(m);
    this.lastSnapK = m.k;
    if (typeof m.pk === "string") this.pk = m.pk;
    this.obj = m.o || null;
    // remote fire flag for projectile weapons (hitscan shots arrive as `shot`)
    for (const p of m.p || []) {
      if (p[0] === this.myId) continue;
      if (p[8] & FLAG.FIRED) {
        const r = this.roster.get(p[0]);
        const wid = p[9] === 1 ? this.data.weapons.secondary : (r && r.spawnCls) || "";
        const w = this.data.weapons.weapons[wid];
        if (w && w.kind === "projectile") {
          const av = this.avatars.get(p[0]);
          if (av) {
            av.fire();
            this.effects.muzzleFlash(av.muzzleWorld(tmpV));
            playAt(`shoot_${wid}`, p[1], p[2], p[3], this._listener(), 1);
          }
        }
      }
      const r = this.roster.get(p[0]);
      if (r) r.al = p[8] & 1;
    }
    const me = m.me;
    if (!me) return;
    this.hp = me.hp; this.sh = me.sh; this.fury = me.fu || 0;
    if (me.al) {
      if (!this.predictor) this._ensurePredictor(me.x, me.y, me.z);
      if (!this.alive) {
        // alive on the server but we have not seen our spawn yet (or missed it): adopt
        this.alive = true;
        this.deathCam = null;
        this.predictor.pending.length = 0;
      }
      const d = this.predictor.reconcile(me, m.a);
      const err = Math.hypot(d[0], d[1], d[2]);
      this.lastErr = err;
      if (err > 0) {
        if (err < 1) this.corr.x -= d[0], this.corr.y -= d[1], this.corr.z -= d[2];
        else this.corr.set(0, 0, 0);
      }
    } else if (this.alive) {
      this.alive = false;
      if (!this.deathCam) this._startDeathCam(me.x, me.y, me.z, 0);
    }
  }

  _ensurePredictor(x, y, z) {
    const r = this.roster.get(this.myId);
    const defs = this.data.defs(r ? r.spawnCls || r.cls : this.cls);
    if (!this.predictor) this.predictor = new Phys.Predictor(this.world, this.C, defs);
    this.predictor.reset(x, y, z, defs);
  }

  _onSpawn(m) {
    const r = this.roster.get(m.id);
    if (r) { r.spawnCls = m.cls; r.al = 1; if (m.tm !== undefined) r.tm = m.tm; }
    if (m.id === this.myId) {
      if (m.tm !== undefined) this.myTeam = m.tm;
      this._ensurePredictor(m.x, m.y, m.z);
      this.yaw = m.yaw; this.pitch = 0; this.recoilBack = 0;
      this.alive = true;
      this.deathCam = null;
      this.killer = null;
      this.respawnAt = 0;
      this.corr.set(0, 0, 0);
      this.input.slot = 0;
      this.hp = this.data.rules.combat.maxHp; this.sh = 0;
      this.vm.setWeapon(m.cls);
      this._cb("onSpawn", { x: m.x, y: m.y, z: m.z, cls: m.cls });
    } else {
      const av = this.avatars.get(m.id);
      if (av) { av.setWeapon(m.cls); av.deadUntilSpawn = false; }
    }
  }

  _listener() {
    const c = this.R.camera.position;
    return { x: c.x, y: c.y, z: c.z, yaw: this.deathCam ? this.R.camera.rotation.y : this.yaw };
  }

  _onShot(m) {
    const av = this.avatars.get(m.id);
    let ox = m.o[0], oy = m.o[1], oz = m.o[2];
    if (av && av.root.visible) {
      av.fire();
      const mz = av.muzzleWorld(tmpV);
      ox = mz.x; oy = mz.y; oz = mz.z;
      this.effects.muzzleFlash(mz);
    }
    const w = this.data.weapons.weapons[m.w];
    const many = (m.e || []).length > 3;
    for (const e of m.e || []) {
      const d = [e[0] - m.o[0], e[1] - m.o[1], e[2] - m.o[2]];
      const L = Math.hypot(d[0], d[1], d[2]) || 1;
      d[0] /= L; d[1] /= L; d[2] /= L;
      this.effects.tracer(ox, oy, oz, e[0], e[1], e[2], 0xffe08a, many ? 0.015 : 0.025);
      if (e[3] === 1) this.effects.impactWorld(e[0], e[1], e[2], d);
      else if (e[3] === 2) this.effects.impactEgg(e[0], e[1], e[2], d);
    }
    if (w) playAt(`shoot_${m.w}`, ox, oy, oz, this._listener(), 1);
  }

  _onBoom(m) {
    this.effects.explosion(m.x, m.y, m.z, m.r || 4, this.R.camera.position);
    playAt("explode", m.x, m.y, m.z, this._listener(), 1.2, 70);
    const mesh = this.projMeshes.get(m.id);
    if (mesh) { this.R.scene.remove(mesh); this.projMeshes.delete(m.id); }
    this.boomed = this.boomed || new Set();
    this.boomed.add(m.id);
    if (this.boomed.size > 64) this.boomed.delete(this.boomed.values().next().value);
  }

  _onHit(m) {
    if (m.a === this.myId && m.v !== this.myId) {
      this.overlay.hitMarker(!!m.hs, m.hp <= 0);
      play(m.hs ? "headshot" : "hit", { volume: 1, local: true });
      this._cb("onHitConfirm", { victim: this._who(m.v), damage: m.d, headshot: !!m.hs, hp: m.hp, sh: m.sh, weapon: m.w });
    }
    if (m.v === this.myId) {
      this.hp = m.hp; this.sh = m.sh;
      if (m.a !== this.myId || m.w === this.data.weapons.grenade || this.data.weapons.weapons[m.w]?.kind === "projectile") {
        this.overlay.damage(m.ax, m.az, m.d);
      }
      this.camKick += 0.02;
      play("hit", { volume: 0.6, local: true, victim: true });
      this._cb("onDamaged", { attacker: this._who(m.a), damage: m.d, headshot: !!m.hs, hp: m.hp, sh: m.sh, weapon: m.w, from: [m.ax, m.ay, m.az] });
    }
  }

  _onKill(m, now) {
    const victim = this.roster.get(m.v);
    const killer = this.roster.get(m.k);
    if (victim) { victim.de = (victim.de || 0) + 1; victim.st = 0; victim.al = 0; }
    if (killer && m.k !== m.v) { killer.ki = (killer.ki || 0) + 1; killer.st = m.st; }
    if (m.k === this.myId && m.v !== this.myId) { this.myStreak = m.st; play("kill", { volume: 1, local: true }); this.overlay.hitMarker(!!m.hs, true); }
    // death effect
    let px, py, pz, color = "#f4efe4";
    if (m.v === this.myId) {
      const ps = this.predictor ? this.predictor.ps : { x: 0, y: 0, z: 0 };
      px = ps.x; py = ps.y; pz = ps.z;
      const c = this.data.cosmetics.colors.find((c) => c.id === this.cos.color);
      if (c) color = c.shell;
    } else {
      const av = this.avatars.get(m.v);
      if (av) { px = av.root.position.x; py = av.root.position.y; pz = av.root.position.z; color = av.shellColor || color; av.setVisible(false); av.deadUntilSpawn = true; }
    }
    if (px !== undefined) {
      this.effects.crack(px, py, pz, color);
      playAt("death_crack", px, py + 0.8, pz, this._listener(), 1, 60);
    }
    if (m.v === this.myId) {
      this.alive = false;
      this.myStreak = 0;
      this.killer = m.k && m.k !== m.v ? m.k : 0;
      this.respawnAt = now + (m.rs || 3) * 1000;
      this._startDeathCam(px ?? 0, py ?? 0, pz ?? 0, this.killer);
      this.input.clearHeld();
    }
    this._cb("onKillfeed", {
      killer: this._who(m.k), victim: this._who(m.v), weapon: m.w, weaponName: this._weaponName(m.w), headshot: !!m.hs,
      streak: m.st, suicide: m.k === m.v || m.k === 0, respawnSec: m.rs, meKiller: m.k === this.myId && m.v !== this.myId, meVictim: m.v === this.myId,
    });
  }

  _onScoreboard(m, now) {
    for (const row of m.p || []) {
      const r = this.roster.get(row[0]);
      if (!r) continue;
      r.sc = row[1]; r.ki = row[2]; r.de = row[3]; r.st = row[4]; r.ping = row[5];
      if (row[0] === this.myId) this.myStreak = row[4];
    }
    if (m.ts) this.match.ts = m.ts;
    if (typeof m.tl === "number") { this.match.tl = m.tl; this.match.tlAt = now; }
    this._emitScoreboard();
  }

  _scoreRows(p) {
    const rows = (p || [...this.roster.values()].map((r) => [r.id, r.sc || 0, r.ki || 0, r.de || 0, r.st || 0, r.ping || 0]))
      .map((row) => {
        const r = this.roster.get(row[0]) || {};
        return { id: row[0], name: r.n || `#${row[0]}`, team: r.tm || 0, score: row[1], kills: row[2], deaths: row[3], streak: row[4], ping: row[5],
          alive: !!r.al, me: row[0] === this.myId, cls: r.spawnCls || r.cls };
      });
    rows.sort((a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths || a.id - b.id);
    return rows;
  }

  _emitScoreboard() {
    if (!this.myId) return;
    this._cb("onScoreboard", {
      players: this._scoreRows(), teamScores: this.match.ts.slice(), timeLeft: this._timeLeft(), mode: this.match.mode,
      modeName: this.data.modes.modes[this.match.mode]?.name || this.match.mode, limit: this.match.limit, myId: this.myId,
      myTeam: this.myTeam || 0, teams: this._isTeams() ? [1, 2].map((t) => ({ id: t, name: this._teamName(t), color: this._teamColor(t) })) : [],
    });
  }

  _onEnd(m) {
    this.match.state = "ended";
    const rows = this._scoreRows(m.sb && m.sb.p);
    const ts = (m.sb && m.sb.ts) || this.match.ts;
    this.match.ts = ts;
    const nextMap = this.data.mapIndex.maps.find((x) => x.id === m.next);
    this._cb("onMatchEnd", {
      winnerTeam: m.wt, winnerTeamName: m.wt ? this._teamName(m.wt) : "", winnerTeamColor: m.wt ? this._teamColor(m.wt) : "",
      winnerPlayer: m.wp ? this._who(m.wp) : null, draw: this._isTeams() && !m.wt,
      iWon: (m.wp && m.wp === this.myId) || (m.wt && m.wt === this.myTeam) || false,
      intermission: m.in, nextMap: m.next, nextMapName: nextMap ? nextMap.name : m.next,
      players: rows, teamScores: ts, mode: this.match.mode, myId: this.myId,
    });
    this.input.clearHeld();
  }

  _onStart(m) {
    this.match = { state: "live", tl: m.tl, tlAt: performance.now(), ts: m.ts || [0, 0], limit: m.limit, mode: m.mode, map: m.map };
    this.pk = m.pk || "";
    this.obj = m.o || null;
    for (const r of this.roster.values()) { r.sc = 0; r.ki = 0; r.de = 0; r.st = 0; }
    this.myStreak = 0;
    this.alive = false;
    if (this.predictor) this.predictor.pending.length = 0;
    this.unsent.length = 0;
    this.effects.clear();
    // rebuild avatars' team colours if the mode changed
    for (const r of this.roster.values()) this._rosterSet(r);
    this.loading = true;
    this._loadMap(m.map).then(() => {
      this._drain();
      this._cb("onMatchStart", this._matchInfo());
      this._emitScoreboard();
    }).catch((e) => {
      console.error("map load failed", e);
      this._cb("onDisconnect", { code: "map", msg: `Could not load map ${m.map}` });
    });
  }

  _matchInfo() {
    const md = this.data.modes.modes[this.match.mode] || {};
    const mi = this.data.mapIndex.maps.find((x) => x.id === this.match.map);
    return { mode: this.match.mode, modeName: md.name || this.match.mode, map: this.match.map, mapName: mi ? mi.name : this.match.map,
      timeLeft: this._timeLeft(), limit: this.match.limit, teams: !!md.teams, myTeam: this.myTeam || 0,
      myTeamName: this._teamName(this.myTeam), myTeamColor: this._teamColor(this.myTeam), roomCode: this.room ? this.room.code : "" };
  }

  _timeLeft() {
    if (this.match.state !== "live") return Math.max(0, this.match.tl);
    return Math.max(0, this.match.tl - (performance.now() - this.match.tlAt) / 1000);
  }

  // ---------------------------------------------------------------- pause / chat

  _onLock(locked) {
    if (locked) {
      this._setPaused(false);
    } else if (!this.chatOpen && !this.stopped) {
      this._setPaused(true);
    }
  }

  _setPaused(p) {
    if (this.paused === p) return;
    this.paused = p;
    this.input.enabled = !p && !this.chatOpen;
    if (p) this.input.clearHeld();
    this._cb("onPauseChange", p);
  }

  _openChat(team) {
    this.chatOpen = true;
    this.input.enabled = false;
    this.input.clearHeld();
    this._cb("onChatOpen", { teamOnly: !!team && this._isTeams() });
    this.input.unlock();
  }

  closeChat() {
    this.chatOpen = false;
    this.input.enabled = !this.paused;
  }

  // ---------------------------------------------------------------- death cam

  _startDeathCam(x, y, z, killer) {
    // fell out of the map: watch from the last place we stood instead of the void
    const killY = this.mapJson ? (this.mapJson.killY ?? this.mapJson.bounds.min[1]) : -1e9;
    if (y < killY + 3 && this.lastGround) [x, y, z] = this.lastGround;
    this.deathCam = { x, y, z, killer, t: 0, yaw: this.yaw };
  }

  // ---------------------------------------------------------------- frame loop

  _frame(now) {
    if (this.stopped) return;
    this._raf = requestAnimationFrame((t) => this._frame(t));
    let dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.25) dt = 0.25;
    this.tAnim += dt;
    this.frames++;
    this.fpsT += dt;
    if (this.fpsT >= 0.5) { this.fps = Math.round(this.frames / this.fpsT); this.frames = 0; this.fpsT = 0; }

    this.input.pollGamepad(dt);
    this._look(dt);

    if (!this.loading && this.conn && !this.disconnected) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= this.DT && n < 8) { this._tick(now); this.acc -= this.DT; n++; }
      if (this.acc > this.DT * 8) this.acc = 0;
      if (this.unsent.length >= 2 || (this.unsent.length && now - this.lastSend > 30)) {
        this.conn.sendInputs(this.unsent);
        this.unsent.length = 0;
        this.lastSend = now;
      }
    }
    try {
      this._render(dt, now);
    } catch (e) {
      console.error("render", e);
    }
  }

  _look(dt) {
    const [dx, dy] = this.input.takeLook();
    const s = this.settings;
    const zoom = this.R.camera.fov / s.fov;
    const adsMul = this.adsT > 0.5 ? s.adsSensitivity * zoom : 1;
    const k = 0.0022 * s.sensitivity * adsMul;
    const inv = s.invertY ? -1 : 1;
    if (this.alive && !this.paused) {
      this.yaw -= dx * k;
      this.pitch -= dy * k * inv;
      this.yaw -= this.input.pad.lookX * adsMul;
      this.pitch -= this.input.pad.lookY * adsMul * inv;
      this.vm.look(dx, dy);
    }
    // recoil recovery: pull back a share of the kick
    if (this.recoilBack > 0) {
      const w = this._curWeapon();
      const rate = w && w.recoil ? 1 / Math.max(0.05, w.recoil.recover) : 4;
      const r = Math.min(this.recoilBack, this.recoilBack * Math.min(1, dt * rate * 3) + dt * 0.02);
      this.pitch -= r;
      this.recoilBack -= r;
    }
    this.yaw = Phys.normYaw(this.yaw);
    this.pitch = Math.max(-this.C.maxPitch, Math.min(this.C.maxPitch, this.pitch));
    this.camKick = Math.max(0, this.camKick - dt * 0.4) * Math.max(0, 1 - dt * 10);
  }

  _curWeapon() {
    if (!this.predictor) return null;
    return this.predictor.defs.w[this.predictor.ws.slot];
  }

  _tick(now) {
    this.seq++;
    const smp = this.input.sample();
    let buttons = smp.buttons;
    const live = this.match.state === "live";
    const P = this.predictor;
    // auto-switch to the sidearm when the primary is completely dry
    if (P && this.alive && (buttons & BTN.FIRE) && P.ws.slot === 0 && P.ws.mag[0] === 0 && P.ws.res[0] === 0 && P.ws.rl === 0) this.input.slot = 1;
    const slot = this.input.slot;
    const rt = this.clock.synced ? this.clock.renderTick(now) : 0;
    const entry = Phys.makeInputEntry(this.seq, this.alive && !this.paused ? smp.keys : 0, this.yaw, this.pitch, this.alive ? buttons : 0, slot, rt, this.C.maxPitch);
    this.unsent.push(entry);
    if (this.unsent.length > 8) { this.conn.sendInputs(this.unsent); this.unsent.length = 0; this.lastSend = now; }
    if (!P || !this.alive || !live) return;
    const wsb = P.ws;
    const s0 = wsb.slot, mag0 = wsb.mag[s0], res0 = wsb.res[s0];
    const pressedFire = (entry[4] & BTN.FIRE) && !(wsb.pb & BTN.FIRE);
    const wasGround = P.ps.onGround;
    const acts = P.step(Phys.entryToInput(entry));
    this._localActs(acts, entry);
    if (pressedFire && mag0 === 0 && res0 === 0 && !acts.some((a) => a.a === "fire")) play("empty", { volume: 0.7, local: true });
    // movement sounds
    const ps = P.ps;
    if (wasGround && !ps.onGround && ps.vy > 1) play("jump", { volume: 0.6, local: true });
    if (!wasGround && ps.onGround && this.fallVy < -6) {
      play("land", { volume: Math.min(1, -this.fallVy / 18), local: true });
      this.vm.land(Math.min(1, -this.fallVy / 20));
    }
    this.fallVy = ps.vy;
    if (ps.onGround) {
      this.lastGround = [ps.x, ps.y, ps.z];
      const sp = Math.hypot(ps.vx, ps.vz);
      this.stepDist += sp * this.DT;
      if (this.stepDist > 2.3) { this.stepDist = 0; if (sp > 2) play("footstep", { volume: 0.35, local: true }); }
    }
  }

  _localActs(acts, entry) {
    const P = this.predictor;
    for (const a of acts) {
      if (a.a === "fire") {
        const w = P.defs.w[a.slot];
        const wid = a.slot === 0 ? (this.roster.get(this.myId)?.spawnCls || this.cls) : this.data.weapons.secondary;
        play(`shoot_${wid}`, { volume: 1, local: true });
        const ads = (entry[4] & BTN.AIM) !== 0;
        const rc = w.recoil || { pitch: 0.01, yaw: 0 };
        const kick = rc.pitch * (ads ? 0.7 : 1);
        this.pitch += kick;
        this.recoilBack += kick * 0.85;
        this.yaw += (Math.random() - 0.5) * 2 * rc.yaw;
        this.camKick += kick * 0.6;
        this.vm.fire(Math.min(2, 0.6 + rc.pitch * 15));
        const cam = this.R.camera;
        cam.updateMatrixWorld();
        const muzzle = this.vm.muzzleWorld(cam, new THREE.Vector3());
        this.R.flashAt(muzzle.x, muzzle.y, muzzle.z, 2.5, 6, 0.05);
        if (w.kind === "hitscan") {
          const dirs = Phys.shotDirs(this.myId, entry[0], entry[2], a.pitch, a.spread, a.pellets);
          const [ex, ey, ez] = P.eye();
          const targets = this._targets();
          for (const d of dirs) {
            const tr = Phys.traceShot(this.world, this.C, ex, ey, ez, d, w.range, targets, this.myId);
            const hx = ex + d[0] * tr.t, hy = ey + d[1] * tr.t, hz = ez + d[2] * tr.t;
            this.effects.tracer(muzzle.x, muzzle.y, muzzle.z, hx, hy, hz, 0xfff0b0, dirs.length > 3 ? 0.012 : 0.02);
            if (tr.kind === 1) this.effects.impactWorld(hx, hy, hz, d);
            else if (tr.kind === 2) {
              const av = this.avatars.get(tr.id);
              const tp = targets.find((t) => t.id === tr.id);
              this.effects.impactEgg(hx, hy, hz, d, av ? av.shellColor : undefined, tp && hy >= tp.y + this.C.headshotY);
            }
          }
        }
      } else if (a.a === "melee") {
        this.vm.melee();
        play("shoot_rollingpin", { volume: 0.9, local: true });
      } else if (a.a === "grenade") {
        this.vm.throwNade();
        play("grenade_throw", { volume: 0.9, local: true });
      } else if (a.a === "reload") {
        play("reload", { volume: 0.8, local: true });
      } else if (a.a === "switch") {
        const wid = a.slot === 0 ? (this.roster.get(this.myId)?.spawnCls || this.cls) : this.data.weapons.secondary;
        this.vm.setWeapon(wid);
        play("ui_click", { volume: 0.5, local: true });
      }
    }
  }

  /** Remote eggs as drawn (interpolated at rt) that the local player could hit. */
  _targets() {
    const out = [];
    const teams = this._isTeams();
    for (const [id, st] of this.remote) {
      if (!st.alive) continue;
      if (teams && st.team === this.myTeam) continue;
      out.push({ id, x: st.x, y: st.y, z: st.z });
    }
    return out;
  }

  // ---------------------------------------------------------------- render

  _render(dt, now) {
    const R = this.R, cam = R.camera;
    const alpha = Math.min(1, this.acc / this.DT);
    const P = this.predictor;
    // local ads blend / weapon
    const w = this._curWeapon();
    const aiming = this.alive && this.input.aimHeld() && P && P.ws.sw === 0 && P.ws.rl === 0;
    this.adsT += ((aiming ? 1 : 0) - this.adsT) * Math.min(1, dt * 14);
    // correction offset decays over ~100 ms
    this.corr.multiplyScalar(Math.exp(-dt / 0.05));

    if (this.alive && P) {
      const p = P.lerpPos(alpha, [0, 0, 0]);
      cam.position.set(p[0] + this.corr.x, p[1] + this.corr.y + this.C.eyeHeight, p[2] + this.corr.z);
      cam.rotation.set(this.pitch + this.camKick, this.yaw, 0);
    } else if (this.deathCam) {
      this._deathCamUpdate(dt);
    }
    if (this.effects.shake > 0) {
      const s = this.effects.shake * 0.04;
      cam.rotation.x += (Math.random() - 0.5) * s;
      cam.rotation.y += (Math.random() - 0.5) * s;
    }
    // fov
    const baseFov = this.settings.fov;
    const fov = w && this.alive ? baseFov + ((w.adsFov || baseFov) - baseFov) * this.adsT : baseFov;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }

    // remote players at the render tick
    const rt = this.clock.renderTick(now);
    const seen = new Set();
    const teams = this._isTeams();
    const L = this._listener();
    this.snaps.samplePlayers(rt, (id, x, y, z, yaw, pitch, hp, sh, flags, slot) => {
      if (id === this.myId) return;
      const av = this.avatars.get(id);
      const r = this.roster.get(id);
      if (!av || !r) return;
      seen.add(id);
      const alive = (flags & FLAG.ALIVE) !== 0;
      let st = this.remote.get(id);
      if (!st) { st = { x, y, z, step: 0 }; this.remote.set(id, st); }
      const moved = Math.hypot(x - st.x, z - st.z);
      st.x = x; st.y = y; st.z = z; st.yaw = yaw; st.pitch = pitch; st.flags = flags; st.alive = alive; st.team = r.tm; st.hp = hp;
      av.setVisible(alive && !av.deadUntilSpawn);
      if (!alive) return;
      av.setWeapon(slot === 1 ? this.data.weapons.secondary : r.spawnCls || r.cls);
      av.setCarry((flags & FLAG.CARRY) !== 0, this._teamColor(r.tm === 1 ? 2 : 1));
      av.update({ x, y, z, yaw, pitch: (flags & FLAG.RELOAD) ? pitch - 0.7 : pitch, flags }, dt, this.tAnim);
      if (av.plate) {
        const d = Math.hypot(x - cam.position.x, z - cam.position.z);
        av.plate.visible = this.settings.nameplates !== false && ((teams && r.tm === this.myTeam) || d < 28);
      }
      if (flags & FLAG.GROUND) {
        st.step += moved;
        if (st.step > 2.4) { st.step = 0; if (moved / Math.max(dt, 1e-3) > 2) playAt("footstep", x, y, z, L, 0.5, 25); }
      }
    });
    for (const [id, av] of this.avatars) if (!seen.has(id)) { av.setVisible(false); this.remote.delete(id); }

    // projectiles
    const live = new Set();
    this.snaps.sampleProjectiles(rt, (id, kind, owner, x, y, z) => {
      if (this.boomed && this.boomed.has(id)) return;
      live.add(id);
      let m = this.projMeshes.get(id);
      if (!m) {
        m = kind === 0 ? buildGrenade() : buildShell();
        this.projMeshes.set(id, m);
        R.scene.add(m);
      }
      m.position.set(x, y, z);
      m.rotation.x += dt * 9; m.rotation.z += dt * 5;
      if (kind === 1 && Math.random() < 0.5) this.effects.puff(x, y, z, 1, "#fff2c0", 0.25, 0.4, 0.2, 0.05);
    });
    for (const [id, m] of this.projMeshes) if (!live.has(id)) { R.scene.remove(m); this.projMeshes.delete(id); }

    // pickups
    for (let i = 0; i < this.pickups.length; i++) {
      const p = this.pickups[i];
      p.group.visible = this.pk[i] !== "0";
      if (p.group.visible) {
        const inner = p.group.userData.inner;
        inner.rotation.y += dt * 1.6;
        inner.position.y = 0.55 + Math.sin(this.tAnim * 2.2 + i) * 0.08;
      }
    }
    // nest eggs
    if (this.obj && this.eggs.size) {
      for (const o of this.obj) {
        const egg = this.eggs.get(o[0]);
        if (!egg) continue;
        // carried eggs are drawn on the carrier's back (avatar), hide the world one
        if (o[1] === 1) { egg.visible = o[5] === this.myId; if (egg.visible && P) egg.position.set(P.ps.x, P.ps.y + 1.9, P.ps.z); continue; }
        egg.visible = true;
        egg.position.set(o[2], o[3] + 0.25 + Math.sin(this.tAnim * 2) * 0.06, o[4]);
        egg.rotation.y += dt;
      }
    }

    this.effects.update(dt, cam);
    const reloadFrac = P && P.ws.rl > 0 && w ? 1 - P.ws.rl / w.reloadTime : -1;
    const sw = P && P.ws.sw > 0 && w ? 1 - P.ws.sw / w.switchTime : -1;
    const scoped = !!(w && w.adsFov && w.adsFov <= 36);
    this.vm.setVisible(this.alive && !!P);
    if (P) {
      this.vm.update(dt, { speed: Math.hypot(P.ps.vx, P.ps.vz), onGround: P.ps.onGround, ads: aiming, reload: reloadFrac,
        switching: sw, scoped, bob: this.settings.viewBob });
    }
    R.update(dt);
    R.render(this.alive && !!P);

    // overlay
    let spreadPx = 8;
    if (w && P) {
      const moving = !P.ps.onGround || Math.hypot(P.ps.vx, P.ps.vz) > this.C.movingSpeedThreshold;
      const spread = (aiming ? w.adsSpread : w.hipSpread) + (moving ? w.moveSpread : 0) + P.ws.bloom;
      spreadPx = (Math.tan(spread) / Math.tan((cam.fov * Math.PI) / 360)) * (R.height / 2);
    }
    const debug = this.settings.showDebug ? this._debugLines() : this.settings.showFps ? [`${this.fps} fps  ${Math.round(this.ping || 0)} ms`] : null;
    this.overlay.draw({
      dt, crosshair: this.settings.crosshair !== false, color: this.settings.crosshairColor, spreadPx, ads: this.adsT, scoped,
      alive: this.alive, hp: this.hp, maxHp: this.data.rules.combat.maxHp, prot: this._myFlags() & FLAG.PROT, yaw: this.yaw,
      px: cam.position.x, pz: cam.position.z, debug, fury: this.fury > 0, hideCrosshair: this.match.state !== "live",
    });

    this.hudT -= dt;
    if (this.hudT <= 0) { this.hudT = 1 / 15; this._cb("onHud", this.hudState()); }
  }

  _deathCamUpdate(dt) {
    const dc = this.deathCam, cam = this.R.camera;
    dc.t += dt;
    let tx = dc.x, ty = dc.y + 0.8, tz = dc.z;
    const k = dc.killer ? this.remote.get(dc.killer) : null;
    if (k && k.alive && dc.t > 0.8) { tx = k.x; ty = k.y + 1.0; tz = k.z; }
    const ang = dc.yaw + Math.PI + dc.t * 0.35;
    const dist = 3.2 + Math.min(1.5, dc.t * 1.2);
    let cx = dc.x + Math.sin(ang) * dist, cy = dc.y + 2.2 + Math.min(1, dc.t * 0.8), cz = dc.z + Math.cos(ang) * dist;
    if (this.world) {
      const ox = dc.x, oy = dc.y + 1.2, oz = dc.z;
      const dx = cx - ox, dy = cy - oy, dz = cz - oz;
      const L = Math.hypot(dx, dy, dz);
      const t = Phys.raycastWorld(this.world, ox, oy, oz, dx / L, dy / L, dz / L, L);
      if (t >= 0) { const f = Math.max(0.2, t - 0.3) / L; cx = ox + dx * f; cy = oy + dy * f; cz = oz + dz * f; }
    }
    cam.position.lerp(tmpV.set(cx, cy, cz), Math.min(1, dt * 6));
    const m = new THREE.Matrix4().lookAt(cam.position, tmpV.set(tx, ty, tz), new THREE.Vector3(0, 1, 0));
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    cam.quaternion.slerp(q, Math.min(1, dt * 5));
    cam.rotation.setFromQuaternion(cam.quaternion, "YXZ");
  }

  _debugLines() {
    const now = performance.now();
    const P = this.predictor;
    const est = this.clock.est(now);
    const info = this.R.renderer.info;
    return [
      `${this.fps} fps  ping ${Math.round(this.ping || 0)} ms  ${this.local ? "OFFLINE" : "online"}`,
      `tick est ${est.toFixed(1)}  snap ${this.lastSnapK ?? "-"}  rt ${this.clock.renderTick(now).toFixed(1)}`,
      `seq ${this.seq}  ack ${P ? P.lastAck : 0}  pending ${P ? P.pending.length : 0}`,
      `buffer ${this.snaps.length}  corr ${this.lastErr.toFixed(4)}`,
      P ? `pos ${P.ps.x.toFixed(2)} ${P.ps.y.toFixed(2)} ${P.ps.z.toFixed(2)} g${P.ps.onGround ? 1 : 0}` : "pos -",
      `draws ${info.render.calls}  tris ${info.render.triangles}`,
      `net in ${(this.conn ? this.conn.bytesIn / 1024 : 0).toFixed(0)} KB  out ${(this.conn ? this.conn.bytesOut / 1024 : 0).toFixed(0)} KB`,
    ];
  }

  _myFlags() {
    const s = this.snaps.latest;
    const a = s && s.players.get(this.myId);
    return a ? a[8] : 0;
  }

  /** Snapshot of everything the HUD needs (also returned by controller.getState()). */
  hudState() {
    const P = this.predictor;
    const W = this.data.weapons;
    const r = this.roster.get(this.myId);
    const pri = r ? r.spawnCls || r.cls : this.cls;
    const weaponInfo = (slot) => {
      if (!P) return null;
      const id = slot === 0 ? pri : W.secondary;
      const d = P.defs.w[slot];
      return { id, name: d.name, class: d.class, slot, mag: P.ws.mag[slot], magSize: d.magSize, reserve: P.ws.res[slot] };
    };
    const cur = P ? P.ws.slot : 0;
    const wcur = P ? P.defs.w[cur] : null;
    const md = this.data.modes.modes[this.match.mode] || {};
    let objective = null;
    if (this.obj) {
      objective = this.obj.map((o) => ({ team: o[0], state: ["home", "carried", "dropped"][o[1]] || "home", carrier: o[5] ? this._who(o[5]) : null,
        pos: [o[2], o[3], o[4]] }));
    }
    const myFlags = this._myFlags();
    return {
      connected: !this.disconnected, offline: !!this.local, paused: this.paused, chatOpen: this.chatOpen, pointerLocked: this.input.locked,
      alive: this.alive, hp: this.hp, maxHp: this.data.rules.combat.maxHp, shield: this.sh, maxShield: this.data.rules.combat.maxShield,
      fury: this.fury, streak: this.myStreak || 0,
      weapon: P ? Object.assign(weaponInfo(cur), { reloading: P.ws.rl > 0, reloadFrac: P.ws.rl > 0 ? 1 - P.ws.rl / wcur.reloadTime : 0, switching: P.ws.sw > 0 }) : null,
      primary: weaponInfo(0), secondary: weaponInfo(1),
      grenades: P ? P.ws.gren : 0, maxGrenades: W.weapons[W.grenade].maxCount,
      ads: this.adsT > 0.5, scoped: !!(wcur && wcur.adsFov <= 36 && this.adsT > 0.9),
      spawnProtected: (myFlags & FLAG.PROT) !== 0, carrying: (myFlags & FLAG.CARRY) !== 0,
      respawnIn: this.alive ? 0 : this.respawnAt ? Math.max(0, (this.respawnAt - performance.now()) / 1000) : 0,
      killer: !this.alive && this.killer ? this._who(this.killer) : null,
      match: { state: this.match.state, mode: this.match.mode, modeName: md.name || this.match.mode, map: this.match.map,
        mapName: (this.data.mapIndex.maps.find((x) => x.id === this.match.map) || {}).name || this.match.map,
        timeLeft: this._timeLeft(), teamScores: this.match.ts.slice(), limit: this.match.limit, teams: !!md.teams,
        myTeam: this.myTeam || 0, myScore: r ? r.sc || 0 : 0, myKills: r ? r.ki || 0 : 0, myDeaths: r ? r.de || 0 : 0 },
      room: this.room ? { code: this.room.code, private: !!this.room.priv } : null,
      objective, ping: Math.round(this.ping || 0), fps: this.fps, myId: this.myId,
    };
  }

  // ---------------------------------------------------------------- public helpers

  sendChat(text, teamOnly = false) {
    const t = String(text || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 120);
    if (t && this.conn) this.conn.send({ t: "chat", m: t, tm: teamOnly ? 1 : 0 });
    this.closeChat();
  }

  setLoadout({ cls, cosmetics } = {}) {
    const msg = { t: "ld" };
    if (cls && this.data.weapons.primaries.includes(cls)) { msg.cls = cls; this.cls = cls; }
    if (cosmetics) { this.cos = Object.assign({}, this.cos, cosmetics); msg.cos = this.cos; }
    if (this.conn) this.conn.send(msg);
  }

  setSettings(s) {
    Object.assign(this.settings, s || {});
    this.R.applySettings(this.settings);
    this.input.setSettings(this.settings);
    for (const av of this.avatars.values()) if (av.plate) av.plate.visible = this.settings.nameplates !== false;
  }

  pause() { this.input.unlock(); this._setPaused(true); }
  /** Leave chat/menu. Must run inside a user gesture (click / key) so pointer lock can be re-acquired. */
  resume() {
    this.chatOpen = false;
    if (document.pointerLockElement === this.canvas || this.input.gamepadActive || !this.canvas.requestPointerLock) {
      this._setPaused(false);
      this.input.enabled = true;
      return;
    }
    // paused flips to false when the lock is actually granted (_onLock)
    this.input.enabled = !this.paused;
    this.input.lock();
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    cancelAnimationFrame(this._raf);
    try { this.conn && this.conn.close(); } catch { /* ignore */ }
    if (this.local) this.local.stop();
    this.input.dispose();
    this.overlay.dispose();
    this.effects.dispose();
    for (const av of this.avatars.values()) av.dispose();
    if (this.mapMesh) this.mapMesh.dispose();
    this.R.dispose();
    if (this._ownCanvas) this.canvas.remove();
  }
}

export { KEY, BTN };
