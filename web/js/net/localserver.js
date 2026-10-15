// Offline practice server: a small in-browser implementation of the server side of
// PROTOCOL.md (sections 4-11, 15) for one human plus bots. It exists so the game can
// be played (and the client tested) with no network, and it speaks the exact wire
// protocol through a WebSocket-like object so the client code path is identical.
//
// Simplifications vs the Go server: a single human client, no rate limiting, no
// rooms/matchmaking (one private room), the code is always "LOCAL".

import * as Sim from "../engine/physics.js";

const BOT_NAMES = ["Eggward", "Shelldon", "Yolanda", "Hardboil", "Sunnyside", "Scrambles", "Omeletta",
  "Crackers", "Dippy", "Benny", "Huevo", "Albumen", "Coddle", "Brunchy", "Speckle", "Toasty"];

const F = { ALIVE: 1, GROUND: 2, AIM: 4, RELOAD: 8, PROT: 16, CARRY: 32, FURY: 64, SWITCH: 128, FIRED: 256 };

const JITTER_BUFFER = 3; // inputs of backlog before the room consumes more than one per tick
const OCT_KEYS = [Sim.KEY.FWD, Sim.KEY.FWD | Sim.KEY.LEFT, Sim.KEY.LEFT, Sim.KEY.BACK | Sim.KEY.LEFT, Sim.KEY.BACK,
  Sim.KEY.BACK | Sim.KEY.RIGHT, Sim.KEY.RIGHT, Sim.KEY.FWD | Sim.KEY.RIGHT];
function hypot2(dx, dz) { return Math.sqrt(dx * dx + dz * dz); }
function rnd(a, b) { return a + Math.random() * (b - a); }

export class LocalServer {
  /**
   * @param {object} data   result of physics.loadData()
   * @param {object} o      {mode, map, bots (count), difficulty 0..1}
   */
  constructor(data, o = {}) {
    this.d = data;
    this.C = data.C;
    this.rules = data.rules;
    this.modeId = data.modes.modes[o.mode] ? o.mode : data.modes.defaultMode;
    this.mode = data.modes.modes[this.modeId];
    this.wantMap = o.map && this.mode.maps.includes(o.map) ? o.map : "";
    this.botCount = Math.max(0, Math.min(11, o.bots ?? 5));
    this.difficulty = Math.max(0, Math.min(1, o.difficulty ?? 0.5));
    this.k = 0;
    this.players = new Map();
    this.nextId = 1;
    this.nextProj = 1;
    this.proj = [];
    this.human = null;
    this.out = [];
    this.history = []; // ring of {k, pos: Map(id -> [x,y,z,alive])}
    this.timer = 0;
    this.sock = null;
    this.maps = {};
  }

  /** Load every map of the mode (they are small) so match rotation is synchronous. */
  async init() {
    await Promise.all(this.mode.maps.map(async (id) => { this.maps[id] = await this.d.map(id); }));
  }

  /** A WebSocket-like object for the Connection class. */
  socket() {
    const srv = this;
    const s = {
      readyState: 0, onopen: null, onmessage: null, onclose: null, onerror: null,
      send(str) { if (s.readyState === 1) srv._recv(str); },
      close() {
        if (s.readyState === 3) return;
        s.readyState = 3; srv.stop();
        setTimeout(() => s.onclose && s.onclose({ code: 1000 }), 0);
      },
    };
    this.sock = s;
    setTimeout(() => { s.readyState = 1; s.onopen && s.onopen(); }, 0);
    return s;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = 0;
  }

  _emit(msg) { this.out.push(msg); }
  _toHuman(id, msg) { if (this.human && id === this.human.id) this.out.push(msg); }

  _flush() {
    if (!this.out.length || !this.sock || this.sock.readyState !== 1) { this.out.length = 0; return; }
    const frame = JSON.stringify(this.out.length === 1 ? this.out[0] : this.out);
    this.out = [];
    // deliver asynchronously like a socket would
    queueMicrotask(() => this.sock && this.sock.onmessage && this.sock.onmessage({ data: frame }));
  }

  // ------------------------------------------------------------------ messages in

  _recv(str) {
    let m;
    try { m = JSON.parse(str); } catch { return; }
    if (!m || typeof m.t !== "string") return;
    if (m.t === "hello") return this._hello(m);
    const P = this.human;
    if (!P) return;
    switch (m.t) {
      case "i":
        if (!Array.isArray(m.b)) return;
        for (const e of m.b.slice(0, 8)) {
          if (!Array.isArray(e) || e.length < 7) continue;
          const seq = e[0];
          if (!(seq > P.lastSeq)) continue;
          if (!Number.isFinite(e[2]) || !Number.isFinite(e[3])) continue;
          P.lastSeq = seq;
          P.queue.push({ seq, keys: e[1] & 31, yaw: e[2], pitch: Math.max(-1.5, Math.min(1.5, e[3])), buttons: e[4] & 31,
            slot: e[5] === 0 || e[5] === 1 ? e[5] : P.ws.slot, rt: Number.isFinite(e[6]) ? e[6] : this.k });
          if (P.queue.length > 16) P.queue.shift();
        }
        break;
      case "ping":
        this._emit({ t: "pong", c: m.c, k: this.k });
        this._flush();
        break;
      case "chat": {
        const txt = String(m.m || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 120);
        if (txt) { this._emit({ t: "chat", id: P.id, m: txt, tm: m.tm ? 1 : 0 }); this._botReply(txt); }
        break;
      }
      case "ld":
        if (m.cls && this.d.weapons.weapons[m.cls] && this.d.weapons.primaries.includes(m.cls)) P.cls = m.cls;
        if (m.cos && typeof m.cos === "object") P.cos = this._cos(m.cos);
        this._emit({ t: "pu", p: this._roster(P) });
        break;
    }
  }

  _botReply(txt) {
    if (!/\b(gg|hi|hello|hey|nice|lol)\b/i.test(txt) || Math.random() < 0.4) return;
    const bots = [...this.players.values()].filter((p) => p.bot);
    if (!bots.length) return;
    const b = bots[Math.floor(Math.random() * bots.length)];
    const lines = ["gg", "eggcellent", "you're toast", "sunny side up!", "nice shot", "cluck cluck"];
    setTimeout(() => { if (this.timer) { this._emit({ t: "chat", id: b.id, m: lines[Math.floor(Math.random() * lines.length)], tm: 0 }); } }, 600 + Math.random() * 1200);
  }

  _cos(c) {
    const cm = this.d.cosmetics, def = cm.defaults;
    const has = (list, id) => list.some((x) => x.id === id);
    return {
      hat: has(cm.hats, c.hat) ? c.hat : def.hat,
      color: has(cm.colors, c.color) ? c.color : def.color,
      stamp: has(cm.stamps, c.stamp) ? c.stamp : def.stamp,
    };
  }

  _name(n) {
    let s = String(n || "").normalize("NFC").replace(/[^A-Za-z0-9 _.-]/g, "").replace(/ +/g, " ").trim().slice(0, 16);
    if (!s) s = "Egg" + String(Math.floor(Math.random() * 1000)).padStart(3, "0");
    return s;
  }

  _hello(m) {
    if (this.human) return;
    const W = this.d.weapons;
    this.matchMap = this.wantMap || this.mode.maps[Math.floor(Math.random() * this.mode.maps.length)];
    this._setMap(this.matchMap);
    this._resetMatch();
    const P = this._addPlayer(this._name(m.name), W.primaries.includes(m.cls) ? m.cls : W.defaultPrimary, this._cos(m.cos || {}), null);
    this.human = P;
    this._emit({
      t: "welcome", v: 1, id: P.id,
      room: { code: "LOCAL", mode: this.modeId, map: this.matchMap, priv: 1, max: this.rules.net.maxPlayersPerRoom },
      tr: this.rules.net.tickRate, se: this.rules.net.snapshotEvery, k: this.k,
      players: [...this.players.values()].map((p) => this._roster(p)),
      match: { state: "live", tl: this._tl(), ts: this.ts.slice(), limit: this.mode.scoreLimit },
      pk: this._pk(), o: this._obj(),
    });
    this._spawn(P);
    const names = BOT_NAMES.slice().sort(() => Math.random() - 0.5);
    for (let i = 0; i < this.botCount; i++) {
      const W2 = W.primaries;
      const name = names[i % names.length];
      const b = this._addPlayer(name, W2[Math.floor(Math.random() * W2.length)], this._randCos(), this._newBot());
      this._emit({ t: "join", p: this._roster(b) });
      this._spawn(b);
    }
    this._flush();
    let last = performance.now(), acc = 0;
    const dtMs = 1000 / this.rules.net.tickRate;
    this.timer = setInterval(() => {
      const now = performance.now();
      acc += now - last; last = now;
      let n = 0;
      // Catch up to 1 s per callback: when the page renders slowly the timer fires late, and a
      // small cap would make offline game time (respawns, timers, bots) run in slow motion.
      while (acc >= dtMs && n < 60) { this._tick(); acc -= dtMs; n++; }
      if (acc > dtMs * 60) acc = 0;
    }, 4);
  }

  _randCos() {
    const cm = this.d.cosmetics;
    const pick = (l) => l[Math.floor(Math.random() * l.length)].id;
    return { hat: pick(cm.hats), color: pick(cm.colors), stamp: pick(cm.stamps) };
  }

  _newBot() {
    return { target: 0, wp: null, strafe: 1, strafeT: 0, jumpT: rnd(1, 4), stuck: 0, retarget: 0,
      aimErrY: 0, aimErrP: 0, errT: 0, seq: 0, react: 0, fireT: 0, nadeT: rnd(4, 10) };
  }

  _addPlayer(name, cls, cos, bot) {
    const id = this.nextId++;
    let tm = 0;
    if (this.mode.teams) {
      let n1 = 0, n2 = 0;
      for (const p of this.players.values()) { if (p.tm === 1) n1++; else if (p.tm === 2) n2++; }
      tm = n1 < n2 ? 1 : n2 < n1 ? 2 : this.ts[0] < this.ts[1] ? 1 : this.ts[1] < this.ts[0] ? 2 : 1;
    }
    const defs = this.d.defs(cls);
    const P = {
      id, n: name, tm, cls, spawnCls: cls, cos, sc: 0, ki: 0, de: 0, st: 0, alive: false,
      ps: Sim.newPlayerState(0, 0, 0), defs, ws: Sim.newWeaponState(defs.w[0], defs.w[1], defs.grenade),
      hp: 0, sh: 0, lastDmgK: -1e9, respawnAt: 0, protEnd: 0, furyEnd: 0, queue: [], ack: 0, lastSeq: 0,
      yaw: 0, pitch: 0, slot: 0, aim: 0, fired: false, starve: 0, tokens: 6, bot, carry: 0, joinK: this.k,
    };
    this.players.set(id, P);
    return P;
  }

  _roster(p) {
    return { id: p.id, n: p.n, tm: p.tm, cls: p.cls, cos: p.cos, sc: p.sc, ki: p.ki, de: p.de, st: p.st, al: p.alive ? 1 : 0 };
  }

  _setMap(id) {
    this.mapId = id;
    this.map = this.maps[id].json;
    this.world = this.maps[id].world;
    this.killY = this.map.killY ?? this.map.bounds.min[1];
  }

  _resetMatch() {
    this.state = "live";
    this.ts = [0, 0];
    this.endK = this.k + Math.round(this.mode.timeLimitSec * this.rules.net.tickRate);
    this.pickAvail = this.map.pickups.map(() => 1);
    this.pickAt = this.map.pickups.map(() => 0);
    this.proj = [];
    this.eggs = {};
    if (this.mode.objective === "nest") {
      for (const n of this.map.nests) this.eggs[n.team] = { st: 0, x: n.pos[0], y: n.pos[1], z: n.pos[2], c: 0, at: 0, home: n.pos };
    }
    this.sbDirty = true;
  }

  _tl() { return Math.max(0, (this.endK - this.k) / this.rules.net.tickRate); }
  _pk() { return this.pickAvail.join(""); }
  _obj() {
    if (this.mode.objective !== "nest") return null;
    return [1, 2].filter((t) => this.eggs[t]).map((t) => {
      const e = this.eggs[t];
      return [t, e.st, Sim.q2(e.x), Sim.q2(e.y), Sim.q2(e.z), e.c];
    });
  }

  // ------------------------------------------------------------------ spawning

  _spawn(P) {
    const sp = this.map.spawns;
    let cands = this.mode.teams ? sp.filter((s) => s.team === P.tm) : sp;
    if (!cands.length) cands = sp;
    const scored = cands.map((s) => {
      let best = Infinity;
      for (const o of this.players.values()) {
        if (o === P || !o.alive) continue;
        if (this.mode.teams && o.tm === P.tm) continue;
        const d = Math.hypot(o.ps.x - s.pos[0], o.ps.y - s.pos[1], o.ps.z - s.pos[2]);
        if (d < best) best = d;
      }
      return { s, d: best };
    }).sort((a, b) => b.d - a.d);
    const top = scored.slice(0, 3);
    const s = top[Math.floor(Math.random() * top.length)].s;
    P.spawnCls = P.cls;
    P.defs = this.d.defs(P.cls);
    P.ps = Sim.newPlayerState(s.pos[0], s.pos[1], s.pos[2]);
    P.ps.onGround = true;
    P.ws = Sim.newWeaponState(P.defs.w[0], P.defs.w[1], P.defs.grenade);
    P.yaw = s.yaw; P.pitch = 0; P.slot = 0;
    P.hp = this.rules.combat.maxHp; P.sh = 0; P.alive = true;
    P.lastDmgK = -1e9; P.furyEnd = 0; P.carry = 0;
    P.protEnd = this.k + Math.round(this.rules.combat.spawnProtection * this.rules.net.tickRate);
    P.starve = 0;
    if (P.bot) {
      P.bot.target = 0; P.bot.wp = null; P.bot.react = 0;
      if (this.mode.objective === "nest") {
        // split each team's bots evenly into attackers (0) and defenders (1)
        const n = [0, 0];
        for (const o of this.players.values()) if (o !== P && o.bot && o.tm === P.tm) n[o.bot.role || 0]++;
        P.bot.role = n[0] > n[1] ? 1 : 0;
      }
    }
    this._emit({ t: "spawn", id: P.id, x: s.pos[0], y: s.pos[1], z: s.pos[2], yaw: s.yaw, cls: P.cls, tm: P.tm });
  }

  // ------------------------------------------------------------------ tick

  _tick() {
    const live = this.state === "live";
    const tr = this.rules.net.tickRate;
    // 2. inputs
    for (const P of [...this.players.values()].sort((a, b) => a.id - b.id)) {
      if (P.bot) {
        if (P.alive && live) this._run(P, this._botInput(P));
        continue;
      }
      P.tokens = Math.min(this.rules.net.inputTokenMax, P.tokens + 1);
      let used = 0;
      // de-jitter (as the Go room): one input per tick unless the backlog exceeds the jitter buffer
      const limit = P.queue.length > JITTER_BUFFER ? this.rules.net.maxInputsPerTick : 1;
      while (P.queue.length && P.tokens >= 1 && used < limit) {
        const inp = P.queue.shift();
        P.tokens -= 1; used++;
        P.ack = inp.seq;
        P.yaw = inp.yaw; P.pitch = inp.pitch;
        if (P.alive) P.slot = inp.slot; // inputs sent while dead must not change the fresh loadout
        if (P.alive && live) this._run(P, inp);
      }
      if (used) P.starve = 0;
      else if (++P.starve >= this.rules.net.starveTicks && P.alive && live) {
        // null input: movement only, the weapon state is left exactly as the client predicted it
        Sim.stepMove(this.world, this.C, P.ps, 0, P.yaw, Sim.speedMulFor(this.C, P.defs, P.ws, 0));
      }
    }
    // 3. projectiles
    this._stepProjectiles();
    // 4. kill Y
    for (const P of this.players.values()) {
      if (P.alive && P.ps.y < this.killY) this._kill(P, P, "fall", 0);
    }
    // 5. pickups, objective, regen, fury, protection, respawn
    if (live) { this._pickups(); this._nest(); }
    const C = this.rules.combat;
    for (const P of this.players.values()) {
      if (P.alive) {
        if (this.k - P.lastDmgK >= C.regenDelay * tr && P.hp < C.maxHp) P.hp = Math.min(C.maxHp, P.hp + C.regenRate / tr);
        if (P.furyEnd && this.k >= P.furyEnd) P.furyEnd = 0;
      } else if (live && P.respawnAt && this.k >= P.respawnAt) {
        P.respawnAt = 0;
        this._spawn(P);
      }
    }
    // 6. lag-comp history
    const pos = new Map();
    for (const P of this.players.values()) pos.set(P.id, [P.ps.x, P.ps.y, P.ps.z, P.alive]);
    this.history.push({ k: this.k, pos });
    if (this.history.length > this.rules.net.historyTicks) this.history.shift();
    // 7. match timer
    if (live) {
      if (this.k >= this.endK) this._end();
    } else if (this.k >= this.nextStartK) this._start();
    // 8. snapshots & scoreboard
    if (this.k % this.rules.net.snapshotEvery === 0 && this.human) this._snapshot();
    if (this.k % tr === 0 || this.sbDirty) this._sb();
    // 9. flush
    this._flush();
    this.k++;
  }

  _snapshot() {
    const H = this.human;
    const p = [];
    for (const P of this.players.values()) {
      let fl = 0;
      if (P.alive) fl |= F.ALIVE;
      if (P.ps.onGround) fl |= F.GROUND;
      if (P.aim) fl |= F.AIM;
      if (P.ws.rl > 0) fl |= F.RELOAD;
      if (P.alive && this.k < P.protEnd) fl |= F.PROT;
      if (P.carry) fl |= F.CARRY;
      if (P.furyEnd) fl |= F.FURY;
      if (P.ws.sw > 0) fl |= F.SWITCH;
      if (P.fired) fl |= F.FIRED;
      P.fired = false;
      p.push([P.id, Sim.q2(P.ps.x), Sim.q2(P.ps.y), Sim.q2(P.ps.z), Sim.q3(P.yaw), Sim.q3(P.pitch),
        P.alive ? Math.ceil(P.hp) : 0, P.sh, fl, P.ws.slot]);
    }
    const pr = this.proj.map((r) => [r.id, r.kind, r.owner, Sim.q2(r.x), Sim.q2(r.y), Sim.q2(r.z),
      Math.round(r.vx * 10) / 10, Math.round(r.vy * 10) / 10, Math.round(r.vz * 10) / 10]);
    this._emit({
      t: "s", k: this.k, a: H.ack,
      me: { x: H.ps.x, y: H.ps.y, z: H.ps.z, vx: H.ps.vx, vy: H.ps.vy, vz: H.ps.vz, g: H.ps.onGround ? 1 : 0,
        al: H.alive ? 1 : 0, hp: H.alive ? Math.ceil(H.hp) : 0, sh: H.sh, ws: Sim.weaponStateToArray(H.ws),
        fu: H.furyEnd ? Math.max(0, (H.furyEnd - this.k) / this.rules.net.tickRate) : 0 },
      p, pr, pk: this._pk(), o: this._obj(),
    });
  }

  _sb() {
    this.sbDirty = false;
    this._emit({ t: "sb", p: [...this.players.values()].map((P) => [P.id, P.sc, P.ki, P.de, P.st, 0]),
      ts: this.ts.slice(), tl: Math.round(this._tl() * 10) / 10 });
  }

  // ------------------------------------------------------------------ combat

  _run(P, inp) {
    const acts = Sim.simulateInput(this.world, this.C, P.defs, P.ps, P.ws, inp);
    P.yaw = inp.yaw; P.pitch = inp.pitch; P.slot = inp.slot;
    P.aim = (inp.buttons & Sim.BTN.AIM) ? 1 : 0;
    for (const a of acts) {
      if (a.a === "fire") {
        P.protEnd = 0; P.fired = true;
        const w = P.defs.w[a.slot];
        if (w.kind === "projectile") this._launch(P, inp, a, w);
        else this._hitscan(P, inp, a, w);
      } else if (a.a === "melee") { P.protEnd = 0; this._melee(P, inp); }
      else if (a.a === "grenade") { P.protEnd = 0; this._throw(P, inp); }
    }
  }

  _targets(P, rt) {
    // Lag-compensated positions (section 9.3)
    const maxR = this.rules.net.maxRewindTicks;
    const r = Math.max(this.k - maxR, Math.min(this.k, Number.isFinite(rt) ? rt : this.k));
    const h0 = this.history.find((h) => h.k === Math.floor(r));
    const h1 = this.history.find((h) => h.k === Math.ceil(r));
    const t = r - Math.floor(r);
    const out = [];
    for (const o of this.players.values()) {
      if (o === P || !o.alive) continue;
      if (this.mode.teams && o.tm === P.tm) continue;
      let x = o.ps.x, y = o.ps.y, z = o.ps.z;
      if (h0 && h1) {
        const a = h0.pos.get(o.id), b = h1.pos.get(o.id);
        if (!a || !b || !a[3] || !b[3]) continue;
        x = a[0] + (b[0] - a[0]) * t; y = a[1] + (b[1] - a[1]) * t; z = a[2] + (b[2] - a[2]) * t;
      }
      out.push({ o, x, y, z });
    }
    return out;
  }

  _dmgMul(P) { return P.furyEnd ? this.rules.streaks.find((s) => s.id === "fury").dmgMul : 1; }

  _hitscan(P, inp, a, w) {
    const C = this.C;
    const ox = P.ps.x, oy = P.ps.y + C.eyeHeight, oz = P.ps.z;
    const dirs = Sim.shotDirs(P.id, P.bot ? P.bot.seq : inp.seq, inp.yaw, a.pitch, a.spread, a.pellets);
    const tg = this._targets(P, P.bot ? this.k : inp.rt);
    const perVictim = new Map();
    const ends = [];
    for (const d of dirs) {
      let tw = Sim.raycastWorld(this.world, ox, oy, oz, d[0], d[1], d[2], w.range);
      let h = tw < 0 ? 0 : 1;
      if (tw < 0) tw = w.range;
      let best = null, bt = tw;
      for (const T of tg) {
        const t = Sim.rayEgg(C, ox, oy, oz, d[0], d[1], d[2], T.x, T.y, T.z, bt);
        if (t >= 0 && t <= bt) { bt = t; best = T; }
      }
      if (best) {
        h = 2;
        const hy = oy + d[1] * bt;
        const hs = hy >= best.y + C.headshotY;
        const dmg = Sim.falloffDamage(w, bt) * (hs ? w.headMul : 1) * this._dmgMul(P);
        const acc = perVictim.get(best.o) || { d: 0, hs: false };
        acc.d += dmg; acc.hs = acc.hs || hs;
        perVictim.set(best.o, acc);
      }
      ends.push([Sim.q2(ox + d[0] * bt), Sim.q2(oy + d[1] * bt), Sim.q2(oz + d[2] * bt), h]);
    }
    if (P !== this.human) this._emit({ t: "shot", id: P.id, w: this._wid(P, a.slot), o: [Sim.q2(ox), Sim.q2(oy), Sim.q2(oz)], e: ends });
    for (const [V, acc] of perVictim) {
      if (V.alive && this.k < V.protEnd) continue;
      this._damage(V, P, Math.max(1, Math.floor(acc.d + 0.5)), this._wid(P, a.slot), acc.hs ? 1 : 0, ox, oy, oz);
    }
  }

  _wid(P, slot) { return slot === 0 ? P.spawnCls : this.d.weapons.secondary; }

  _melee(P, inp) {
    const C = this.C, M = P.defs.melee;
    const ox = P.ps.x, oy = P.ps.y + C.eyeHeight, oz = P.ps.z;
    const d = Sim.aimDir(inp.yaw, inp.pitch);
    let tw = Sim.raycastWorld(this.world, ox, oy, oz, d[0], d[1], d[2], M.range);
    if (tw < 0) tw = M.range;
    let best = null, bt = tw;
    for (const T of this._targets(P, P.bot ? this.k : inp.rt)) {
      const t = Sim.rayEgg(C, ox, oy, oz, d[0], d[1], d[2], T.x, T.y, T.z, bt, M.inflate);
      if (t >= 0 && t <= bt) { bt = t; best = T; }
    }
    if (P !== this.human) this._emit({ t: "melee", id: P.id });
    if (best && !(this.k < best.o.protEnd)) this._damage(best.o, P, Math.floor(M.damage * this._dmgMul(P) + 0.5), this.d.weapons.melee, 0, ox, oy, oz);
  }

  _launch(P, inp, a, w) {
    const C = this.C;
    const ex = P.ps.x, ey = P.ps.y + C.eyeHeight, ez = P.ps.z;
    const d = Sim.shotDirs(P.id, P.bot ? P.bot.seq : inp.seq, inp.yaw, a.pitch, a.spread, 1)[0];
    const pd = w.projectile;
    this._spawnProj(P, pd, ex, ey, ez, d, 0.6, d[0] * pd.speed, d[1] * pd.speed, d[2] * pd.speed, w.damage, this._wid(P, a.slot));
  }

  _throw(P, inp) {
    const C = this.C, G = P.defs.grenade, pd = G.projectile;
    const ex = P.ps.x, ey = P.ps.y + C.eyeHeight, ez = P.ps.z;
    const d = Sim.aimDir(inp.yaw, inp.pitch);
    this._spawnProj(P, pd, ex, ey, ez, d, 0.5,
      d[0] * G.throwSpeed + P.ps.vx * G.inheritVel, d[1] * G.throwSpeed + G.throwUp + P.ps.vy * G.inheritVel,
      d[2] * G.throwSpeed + P.ps.vz * G.inheritVel, G.damage, this.d.weapons.grenade);
  }

  _spawnProj(P, pd, ex, ey, ez, d, off, vx, vy, vz, dmg, wid) {
    const t = Sim.raycastWorld(this.world, ex, ey, ez, d[0], d[1], d[2], off);
    const meta = { dmg, R: pd.splashRadius, K: pd.knockback, w: wid };
    if (t >= 0) { this._explode(this.nextProj++, pd.kind, P.id, ex + d[0] * t, ey + d[1] * t, ez + d[2] * t, meta); return; }
    const pr = Sim.newProjectile(this.nextProj++, P.id, pd, ex + d[0] * off, ey + d[1] * off, ez + d[2] * off, vx, vy, vz);
    pr.meta = meta;
    this.proj.push(pr);
  }

  _stepProjectiles() {
    const C = this.C, dt = C.dt;
    const keep = [];
    for (const pr of this.proj) {
      if (pr.kind === 1) {
        const vy2 = pr.vy - pr.gravity * dt;
        const sx = pr.vx * dt, sy = vy2 * dt, sz = pr.vz * dt;
        const len = Math.sqrt(sx * sx + sy * sy + sz * sz);
        if (len > 0) {
          const dx = sx / len, dy = sy / len, dz = sz / len;
          let tw = Sim.raycastWorld(this.world, pr.x, pr.y, pr.z, dx, dy, dz, len);
          if (tw < 0) tw = len;
          let hit = -1;
          for (const o of this.players.values()) {
            if (!o.alive || o.id === pr.owner) continue;
            const t = Sim.rayEgg(C, pr.x, pr.y, pr.z, dx, dy, dz, o.ps.x, o.ps.y, o.ps.z, tw, pr.radius);
            if (t >= 0 && t < tw && (hit < 0 || t < hit)) hit = t;
          }
          if (hit >= 0) { this._explode(pr.id, 1, pr.owner, pr.x + dx * hit, pr.y + dy * hit, pr.z + dz * hit, pr.meta); continue; }
        }
      }
      const r = Sim.stepProjectile(this.world, pr, dt);
      if (r && r.explode) this._explode(pr.id, pr.kind, pr.owner, r.x, r.y, r.z, pr.meta);
      else keep.push(pr);
    }
    this.proj = keep;
  }

  _explode(id, kind, owner, x, y, z, meta) {
    this._emit({ t: "boom", id, k: kind, o: owner, x: Sim.q2(x), y: Sim.q2(y), z: Sim.q2(z), r: meta.R });
    if (this.state !== "live") return;
    const C = this.C, R = meta.R;
    const O = this.players.get(owner);
    const mul = O ? this._dmgMul(O) : 1;
    for (const V of this.players.values()) {
      if (!V.alive) continue;
      if (this.mode.teams && O && V.tm === O.tm && V !== O) continue;
      const cx = V.ps.x, cy = V.ps.y + C.hitCenterY, cz = V.ps.z;
      let dx = cx - x, dy = cy - y, dz = cz - z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d >= R) continue;
      let los = true;
      if (d > 1e-6) {
        const t = Sim.raycastWorld(this.world, x, y, z, dx / d, dy / d, dz / d, d);
        if (t >= 0) {
          const ey = V.ps.y + C.eyeHeight, ex2 = cx - x, ey2 = ey - y, ez2 = cz - z;
          const d2 = Math.sqrt(ex2 * ex2 + ey2 * ey2 + ez2 * ez2);
          los = d2 > 1e-6 && Sim.raycastWorld(this.world, x, y, z, ex2 / d2, ey2 / d2, ez2 / d2, d2) < 0;
        }
      }
      if (!los) continue;
      const s = 1 - d / R;
      const dmg = Math.floor(meta.dmg * s * (V === O ? this.rules.combat.selfSplashMul : 1) * mul + 0.5);
      let nx = 0, ny = 1, nz = 0;
      if (d >= 1e-6) { nx = dx / d; ny = dy / d; nz = dz / d; }
      V.ps.vx += nx * meta.K * s; V.ps.vy += ny * meta.K * s + this.rules.combat.knockbackUp * s; V.ps.vz += nz * meta.K * s;
      V.ps.onGround = false;
      if (dmg > 0 && !(this.k < V.protEnd)) this._damage(V, O || V, dmg, meta.w, 0, x, y, z);
    }
  }

  _damage(V, A, dmg, wid, hs, ax, ay, az) {
    if (!V.alive || this.k < V.protEnd || this.state !== "live") return;
    const absorb = Math.min(V.sh, dmg);
    V.sh -= absorb; V.hp -= dmg - absorb;
    V.lastDmgK = this.k;
    const msg = { t: "hit", a: A.id, v: V.id, d: dmg, hs, hp: Math.max(0, Math.ceil(V.hp)), sh: V.sh, w: wid, ax: Sim.q2(ax), ay: Sim.q2(ay), az: Sim.q2(az) };
    if (this.human && (A.id === this.human.id || V.id === this.human.id)) this._emit(msg);
    if (V.bot && A !== V) { V.bot.target = A.id; V.bot.react = Math.min(V.bot.react, 4); }
    if (V.hp <= 0) this._kill(V, A, wid, hs);
  }

  _kill(V, A, wid, hs) {
    const pts = this.mode.points;
    V.alive = false; V.hp = 0; V.de++; V.st = 0;
    V.respawnAt = this.k + Math.round(this.mode.respawnSec * this.rules.net.tickRate);
    const wasCarrier = V.carry;
    if (V.carry) this._dropEgg(V);
    let st = 0;
    if (A && A !== V && A.id) {
      A.ki++; A.st++; st = A.st;
      A.sc += pts.kill + (hs ? pts.headshotBonus : 0);
      if (wasCarrier && pts.carrierKill) A.sc += pts.carrierKill;
      if (this.mode.scoreUnit === "teamKills" && A.tm) this.ts[A.tm - 1]++;
    }
    this._emit({ t: "kill", k: A ? A.id : 0, v: V.id, w: wid, hs, st, rs: this.mode.respawnSec });
    if (A && A !== V) {
      for (const s of this.rules.streaks) {
        if (A.st !== s.at) continue;
        if (s.id === "refill") {
          const w0 = A.defs.w[0];
          A.ws.mag[0] = w0.magSize; A.ws.res[0] = w0.reserve;
          A.ws.gren = Math.min(A.defs.grenade.maxCount, A.ws.gren + 1);
        } else if (s.id === "shell") A.sh = this.rules.combat.maxShield;
        else if (s.id === "fury") A.furyEnd = this.k + Math.round(s.duration * this.rules.net.tickRate);
        A.sc += pts.streakBonus;
        this._emit({ t: "streak", id: A.id, n: s.at, r: s.id });
      }
    }
    this.sbDirty = true;
    if (this.state === "live") {
      if (this.mode.scoreUnit === "kills" && A && A.ki >= this.mode.scoreLimit) this._end();
      if (this.mode.scoreUnit === "teamKills" && (this.ts[0] >= this.mode.scoreLimit || this.ts[1] >= this.mode.scoreLimit)) this._end();
    }
  }

  // ------------------------------------------------------------------ pickups & nest

  _pickups() {
    const pk = this.rules.pickups;
    const ids = [...this.players.values()].sort((a, b) => a.id - b.id);
    this.map.pickups.forEach((pu, i) => {
      if (!this.pickAvail[i]) {
        if (this.k >= this.pickAt[i]) this.pickAvail[i] = 1;
        return;
      }
      for (const P of ids) {
        if (!P.alive) continue;
        if (hypot2(P.ps.x - pu.pos[0], P.ps.z - pu.pos[2]) > pk.radius) continue;
        if (P.ps.y < pu.pos[1] - 0.5 || P.ps.y > pu.pos[1] + 1.8) continue;
        const T = pk.types[pu.type];
        const C = this.rules.combat;
        let used = false;
        if (pu.type === "hp" && P.hp < C.maxHp) { P.hp = Math.min(C.maxHp, P.hp + T.amount); used = true; }
        else if (pu.type === "shield" && P.sh < C.maxShield) { P.sh = Math.min(C.maxShield, P.sh + T.amount); used = true; }
        else if (pu.type === "ammo") {
          const w0 = P.defs.w[0], g = P.defs.grenade;
          if ((w0.reserve >= 0 && P.ws.res[0] < w0.reserve) || P.ws.gren < g.maxCount) {
            P.ws.res[0] = w0.reserve; P.ws.gren = Math.min(g.maxCount, P.ws.gren + (T.grenades || 1)); used = true;
          }
        }
        if (used) {
          this.pickAvail[i] = 0;
          this.pickAt[i] = this.k + Math.round(T.respawn * this.rules.net.tickRate);
          this._emit({ t: "pick", i, id: P.id, ty: pu.type });
          break;
        }
      }
    });
  }

  _touch(P, x, y, z) {
    return hypot2(P.ps.x - x, P.ps.z - z) <= this.mode.nest.touchRadius && Math.abs(P.ps.y - y) <= 1.5;
  }

  _nest() {
    if (this.mode.objective !== "nest") return;
    const pts = this.mode.points;
    for (const T of [1, 2]) {
      const e = this.eggs[T];
      if (!e) continue;
      if (e.st === 1) {
        const c = this.players.get(e.c);
        if (!c || !c.alive) { if (c) this._dropEgg(c); else this._returnEgg(T, 0); continue; }
        e.x = c.ps.x; e.y = c.ps.y; e.z = c.ps.z;
        const own = this.eggs[c.tm];
        const nest = this.map.nests.find((n) => n.team === c.tm);
        if (nest && own && own.st === 0 && this._touch(c, nest.pos[0], nest.pos[1], nest.pos[2])) {
          c.carry = 0; c.sc += pts.capture;
          this.ts[c.tm - 1]++;
          this._emit({ t: "flag", ev: "cap", tm: T, id: c.id });
          this._resetEgg(T);
          this.sbDirty = true;
          if (this.ts[c.tm - 1] >= this.mode.scoreLimit) this._end();
        }
        continue;
      }
      for (const P of this.players.values()) {
        if (!P.alive || !this._touch(P, e.x, e.y, e.z)) continue;
        if (P.tm !== T && !P.carry) {
          e.st = 1; e.c = P.id; P.carry = T; P.sc += pts.take;
          this._emit({ t: "flag", ev: "take", tm: T, id: P.id });
          break;
        }
        if (P.tm === T && e.st === 2) {
          P.sc += pts.return;
          this._returnEgg(T, P.id);
          break;
        }
      }
      if (e.st === 2 && this.k >= e.at) this._returnEgg(T, 0);
    }
  }

  _resetEgg(T) {
    const e = this.eggs[T];
    e.st = 0; e.c = 0; e.x = e.home[0]; e.y = e.home[1]; e.z = e.home[2];
  }

  _returnEgg(T, id) {
    this._resetEgg(T);
    this._emit({ t: "flag", ev: "return", tm: T, id });
  }

  _dropEgg(P) {
    const T = P.carry;
    P.carry = 0;
    const e = this.eggs[T];
    if (!e) return;
    this._emit({ t: "flag", ev: "drop", tm: T, id: P.id });
    const t = Sim.raycastWorld(this.world, P.ps.x, P.ps.y + 0.1, P.ps.z, 0, -1, 0, 1000);
    const fy = P.ps.y + 0.1 - t;
    if (t < 0 || fy < this.killY + 1) { this._returnEgg(T, 0); return; }
    e.st = 2; e.c = 0; e.x = P.ps.x; e.y = fy; e.z = P.ps.z;
    e.at = this.k + Math.round(this.mode.nest.dropReturnSec * this.rules.net.tickRate);
  }

  // ------------------------------------------------------------------ match flow

  _end() {
    if (this.state !== "live") return;
    this.state = "ended";
    let wt = 0, wp = 0;
    const ps = [...this.players.values()];
    if (this.mode.teams) wt = this.ts[0] > this.ts[1] ? 1 : this.ts[1] > this.ts[0] ? 2 : 0;
    else if (ps.length) {
      ps.sort((a, b) => b.ki - a.ki || b.sc - a.sc || a.de - b.de || a.id - b.id);
      wp = ps[0].id;
    }
    const maps = this.mode.maps.filter((m) => m !== this.mapId);
    this.nextMap = (maps.length ? maps : this.mode.maps)[Math.floor(Math.random() * (maps.length || this.mode.maps.length))];
    const inSec = this.rules.rooms.intermissionSec;
    this.nextStartK = this.k + inSec * this.rules.net.tickRate;
    this._emit({ t: "end", wt, wp, in: inSec, next: this.nextMap,
      sb: { p: [...this.players.values()].map((P) => [P.id, P.sc, P.ki, P.de, P.st, 0]), ts: this.ts.slice() } });
  }

  _start() {
    this._setMap(this.nextMap);
    this._resetMatch();
    for (const P of this.players.values()) { P.sc = 0; P.ki = 0; P.de = 0; P.st = 0; P.carry = 0; P.alive = false; P.respawnAt = 0; }
    if (this.mode.teams) {
      for (;;) {
        const t1 = [...this.players.values()].filter((p) => p.tm === 1), t2 = [...this.players.values()].filter((p) => p.tm === 2);
        if (Math.abs(t1.length - t2.length) <= 1) break;
        const big = t1.length > t2.length ? t1 : t2;
        const mv = big.sort((a, b) => b.joinK - a.joinK || b.id - a.id)[0];
        mv.tm = mv.tm === 1 ? 2 : 1;
        this._emit({ t: "pu", p: this._roster(mv) });
      }
    }
    this._emit({ t: "start", mode: this.modeId, map: this.mapId, tl: this.mode.timeLimitSec, ts: [0, 0], limit: this.mode.scoreLimit, pk: this._pk(), o: this._obj() });
    if (this.human) this.human.queue.length = 0;
    for (const P of this.players.values()) this._spawn(P);
  }

  // ------------------------------------------------------------------ bots

  /** Nest Raid goal for bot P (as the Go server's botChooseGoal), or null to fight/wander. */
  _botObjective(P) {
    if (this.mode.objective !== "nest") return null;
    const own = this.eggs[P.tm], enemy = this.eggs[3 - P.tm];
    if (!own || !enemy) return null;
    const b = P.bot;
    if (P.carry) return own.home;
    if (own.st !== 0) return [own.x, own.y, own.z];
    if (b.role === 0 && enemy.st !== 1) return [enemy.x, enemy.y, enemy.z];
    if (b.role === 1) {
      // defenders patrol around their own nest
      if (!b.patrol || hypot2(b.patrol[0] - P.ps.x, b.patrol[2] - P.ps.z) < 1.5 || b.stuck > 90) {
        b.patrol = [own.home[0] + rnd(-4, 4), own.home[1], own.home[2] + rnd(-4, 4)];
      }
      return b.patrol;
    }
    return null;
  }

  _botInput(P) {
    const b = P.bot, C = this.C, dt = C.dt;
    b.seq++;
    const skill = this.difficulty;
    const eyeY = P.ps.y + C.eyeHeight;
    // (re)acquire target
    if (--b.retarget <= 0) {
      b.retarget = 8;
      let best = null, bd = 55;
      for (const o of this.players.values()) {
        if (o === P || !o.alive || (this.mode.teams && o.tm === P.tm)) continue;
        const dx = o.ps.x - P.ps.x, dy = o.ps.y + 1.0 - eyeY, dz = o.ps.z - P.ps.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > bd || d < 1e-3) continue;
        if (Sim.raycastWorld(this.world, P.ps.x, eyeY, P.ps.z, dx / d, dy / d, dz / d, d) >= 0) continue;
        best = o; bd = d;
      }
      const nt = best ? best.id : 0;
      if (nt !== b.target) { b.target = nt; b.react = Math.round(rnd(14, 30) * (1.4 - skill)); }
    }
    const T = b.target ? this.players.get(b.target) : null;
    let keys = 0, buttons = 0;
    let wantYaw = P.yaw, wantPitch = 0;
    const w = P.defs.w[P.ws.slot];
    const goal = this._botObjective(P);
    // carriers run home and attackers keep pushing the objective, shooting on the move, unless the fight is close
    const pushing = goal && T && T.alive && (P.carry || (b.role === 0 && hypot2(T.ps.x - P.ps.x, T.ps.z - P.ps.z) > 10));
    if (T && T.alive) {
      const dx = T.ps.x + T.ps.vx * 0.1 - P.ps.x, dz = T.ps.z + T.ps.vz * 0.1 - P.ps.z;
      const dy = T.ps.y + 0.85 - eyeY;
      const hd = Math.sqrt(dx * dx + dz * dz);
      if ((b.errT -= dt) <= 0) {
        b.errT = rnd(0.3, 0.8);
        const e = 0.09 * (1.25 - skill);
        b.aimErrY = rnd(-e, e); b.aimErrP = rnd(-e, e) * 0.6;
      }
      wantYaw = Math.atan2(-dx, -dz) + b.aimErrY;
      wantPitch = Math.atan2(dy, hd) + b.aimErrP;
      if (w.kind === "projectile") wantPitch -= 0.04;
      if (pushing) {
        // move toward the objective relative to where we are looking
        const mv = Math.atan2(-(goal[0] - P.ps.x), -(goal[2] - P.ps.z));
        keys |= OCT_KEYS[((Math.round(Sim.normYaw(mv - P.yaw) / (Math.PI / 4)) % 8) + 8) % 8];
      } else {
        // strafe & range keeping
        if ((b.strafeT -= dt) <= 0) { b.strafeT = rnd(0.4, 1.4); b.strafe = Math.random() < 0.5 ? -1 : 1; }
        keys |= b.strafe > 0 ? Sim.KEY.RIGHT : Sim.KEY.LEFT;
        const ideal = w.fireMode === "semi" && w.pellets > 1 ? 6 : w.adsFov < 40 ? 28 : 14;
        if (hd > ideal + 4) keys |= Sim.KEY.FWD; else if (hd < ideal - 4) keys |= Sim.KEY.BACK;
      }
      const err = Math.abs(Sim.normYaw(wantYaw - P.yaw)) + Math.abs(wantPitch - P.pitch);
      if (b.react > 0) b.react--;
      else if (err < 0.15 + 2 / Math.max(4, hd)) {
        if (w.fireMode === "auto") buttons |= Sim.BTN.FIRE;
        else if ((b.fireT -= dt) <= 0) { buttons |= Sim.BTN.FIRE; b.fireT = Math.max(w.fireInterval, 0.18) * rnd(1, 1.8); }
      }
      if (w.adsFov < 40 && hd > 12) buttons |= Sim.BTN.AIM;
      if (hd < 2.2 && P.ws.mt === 0 && Math.random() < 0.2) buttons |= Sim.BTN.MELEE;
      if ((b.nadeT -= dt) <= 0 && hd > 7 && hd < 22) { buttons |= Sim.BTN.GRENADE; b.nadeT = rnd(8, 16); }
      // switch to pistol when out of primary ammo
      if (P.ws.mag[0] === 0 && P.ws.res[0] === 0) P.slot = 1;
    } else {
      if (goal) {
        b.wp = goal;
        if (b.stuck > 90) b.stuck = 0;
      } else if (!b.wp || hypot2(b.wp[0] - P.ps.x, b.wp[2] - P.ps.z) < 2 || b.stuck > 90) {
        // wander between spawns and pickups
        const pts = this.map.pickups.map((p) => p.pos).concat(this.map.spawns.map((s) => s.pos));
        b.wp = pts[Math.floor(Math.random() * pts.length)];
        b.stuck = 0;
      }
      wantYaw = Math.atan2(-(b.wp[0] - P.ps.x), -(b.wp[2] - P.ps.z));
      wantPitch = 0;
      keys |= Sim.KEY.FWD;
      if (hypot2(P.ps.vx, P.ps.vz) < 1.2) { b.stuck++; if (b.stuck > 20) keys |= Sim.KEY.JUMP; } else b.stuck = Math.max(0, b.stuck - 1);
      if (P.ws.mag[P.ws.slot] < w.magSize * 0.5 && P.ws.rl === 0) buttons |= (b.seq & 1) ? Sim.BTN.RELOAD : 0;
      if (P.ws.mag[0] > 0 || P.ws.res[0] !== 0) P.slot = 0;
    }
    if ((b.jumpT -= dt) <= 0) { b.jumpT = rnd(1.5, 5); keys |= Sim.KEY.JUMP; }
    // turn toward the wanted angles at a limited rate
    const rate = (3 + 7 * skill) * dt;
    const dyaw = Sim.normYaw(wantYaw - P.yaw);
    const yaw = Sim.wireYaw(P.yaw + Math.max(-rate, Math.min(rate, dyaw)));
    const pitch = Sim.wirePitch(P.pitch + Math.max(-rate, Math.min(rate, wantPitch - P.pitch)));
    return { seq: b.seq, keys, yaw, pitch, buttons, slot: P.slot, rt: this.k };
  }
}
