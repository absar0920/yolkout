// 2D overlay canvas drawn by the game on top of the 3D view (pointer-events: none):
// dynamic crosshair, hit markers per hit zone, damage-direction indicators, full-screen scopes
// (sniper / marksman / rocket launcher), health-based shell cracks, low-health vignette,
// spawn-protection tint and the optional debug panel.
// Health/ammo/killfeed/scoreboard/chat are left to the UI (callbacks).
// Crack layers are pre-rendered to offscreen canvases on resize, so draw() only blits them.

const TAU = Math.PI * 2;

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Collect a jagged branching crack as polylines [[x,y,w]...] starting at (x,y) heading `ang`. */
function crackLines(rng, x, y, ang, len, w, depth, out) {
  const pts = [[x, y, w]];
  let cx = x, cy = y, a = ang, left = len, ww = w;
  const step = Math.max(8, len * 0.15);
  while (left > 0) {
    const s = step * (0.6 + rng() * 0.8);
    a += (rng() - 0.5) * 0.75;
    cx += Math.cos(a) * s; cy += Math.sin(a) * s;
    left -= s;
    ww = Math.max(2, ww * 0.94);
    pts.push([cx, cy, ww]);
    if (depth > 0 && rng() < 0.3) crackLines(rng, cx, cy, a + (rng() < 0.5 ? -1 : 1) * (0.6 + rng() * 0.6), left * (0.3 + rng() * 0.35), ww * 0.75, depth - 1, out);
  }
  out.push(pts);
  return out;
}

function strokeCracks(g, lines, pr) {
  g.lineCap = "round"; g.lineJoin = "round";
  // dark line + 1 px offset highlight
  for (const pass of [0, 1]) {
    g.strokeStyle = pass === 0 ? "rgba(40,25,15,0.8)" : "rgba(255,255,255,0.6)";
    for (const pts of lines) {
      for (let i = 1; i < pts.length; i++) {
        g.lineWidth = pass === 0 ? pts[i][2] * pr : Math.max(1, pts[i][2] * 0.3) * pr;
        g.beginPath();
        const o = pass === 0 ? 0 : pr;
        g.moveTo(pts[i - 1][0] + o, pts[i - 1][1] + o);
        g.lineTo(pts[i][0] + o, pts[i][1] + o);
        g.stroke();
      }
    }
  }
}

function makeLayer(W, H) {
  const c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(W, H) : Object.assign(document.createElement("canvas"), { width: W, height: H });
  return c;
}

export class Overlay {
  constructor(container) {
    this.c = document.createElement("canvas");
    this.c.className = "yo-overlay";
    Object.assign(this.c.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none", zIndex: "2" });
    container.appendChild(this.c);
    this.ctx = this.c.getContext("2d");
    this.hits = [];   // {t, zone, kill}
    this.dmg = [];    // {t, ax, az, amount}
    this.bursts = []; // {t, ax, az}
    this.flashRed = 0;
    this.w = 0; this.h = 0;
    this.layers = null; this.layerKey = "";
    this.crackA = [0, 0, 0];
    this.scopeT = 0; this.scopeOn = false;
    this.time = 0;
    this.resize();
  }

  resize() {
    const r = this.c.getBoundingClientRect();
    const pr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(r.width * pr)), h = Math.max(1, Math.round(r.height * pr));
    if (w !== this.c.width || h !== this.c.height) { this.c.width = w; this.c.height = h; }
    this.pr = pr; this.w = w; this.h = h;
  }

  /** zone: 1 head, 2 body, 3 arm, 4 leg (a boolean is read as headshot yes/no); kill: the hit killed. */
  hitMarker(zone, kill) {
    if (typeof zone === "boolean") zone = zone ? 1 : 2;
    this.hits.push({ t: 0, zone: zone | 0, kill: !!kill });
    if (this.hits.length > 6) this.hits.shift();
  }

  damage(ax, az, amount) {
    this.dmg.push({ t: 0, ax, az, amount }); if (this.dmg.length > 8) this.dmg.shift();
    this.bursts.push({ t: 0, ax, az, seed: (Math.random() * 1e9) | 0 }); if (this.bursts.length > 4) this.bursts.shift();
    this.flashRed = Math.min(0.5, this.flashRed + amount / 120);
  }

  /** Crack stage for an hp fraction (same thresholds as EggAvatar.crackStage). */
  static crackStage(f) { return f >= 0.75 ? 0 : f >= 0.5 ? 1 : f >= 0.25 ? 2 : 3; }

  _buildLayers() {
    const W = this.w, H = this.h, pr = this.pr;
    const key = `${W}x${H}`;
    if (this.layerKey === key && this.layers) return;
    this.layerKey = key;
    const m = Math.min(W, H);
    const rng = mulberry(0x5eed);
    const corner = (x, y, base, n, len) => {
      const lines = [];
      for (let i = 0; i < n; i++) crackLines(rng, x, y, base + (i / Math.max(1, n - 1) - 0.5) * 1.0 + (rng() - 0.5) * 0.2, len * (0.7 + rng() * 0.5), 10, 2, lines);
      return lines;
    };
    const specs = [
      [corner(0, H, -Math.PI / 4, 3, m * 0.42)],
      [corner(W, 0, (3 * Math.PI) / 4, 3, m * 0.4), corner(0, H * 0.55, -0.15, 1, m * 0.2)],
      [corner(W, H, (-3 * Math.PI) / 4, 4, m * 0.45), corner(0, 0, Math.PI / 4, 2, m * 0.26), corner(W * 0.5, H, -Math.PI / 2, 2, m * 0.22)],
    ];
    this.layers = specs.map((groups) => {
      const c = makeLayer(W, H);
      const g = c.getContext("2d");
      for (const lines of groups) strokeCracks(g, lines, pr);
      return c;
    });
    // a small radial burst used for the damage-direction flash
    const bs = Math.round(m * 0.2);
    const b = makeLayer(bs, bs);
    const bg = b.getContext("2d");
    const lines = [];
    const r2 = mulberry(0xb0057);
    for (let i = 0; i < 6; i++) crackLines(r2, bs / 2, bs / 2, (i / 6) * TAU + r2() * 0.5, bs * 0.45, 2.4, 1, lines);
    strokeCracks(bg, lines, pr);
    this.burstLayer = b;
  }

  /**
   * s: {dt, crosshair, color, spreadPx, ads (0..1), scope ("none"|"sniper"|"marksman"|"rocket"), alive, hp, maxHp, prot,
   *     yaw, px, pz, debug (null | string[]), fury, hideCrosshair, cracks (bool), fov (deg, current), loaded, reloading}
   */
  draw(s) {
    this.resize();
    const ctx = this.ctx, W = this.w, H = this.h, pr = this.pr;
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2;
    const dt = s.dt;
    this.time += dt;
    const hpF = s.maxHp > 0 ? Math.max(0, s.hp) / s.maxHp : 1;
    const stage = s.alive ? Overlay.crackStage(hpF) : 0;

    // vignette: low health / damage flash / fury (halved while big cracks show, so they do not double up)
    this.flashRed = Math.max(0, this.flashRed - dt * 0.9);
    const low = s.alive ? Math.max(0, 1 - s.hp / (s.maxHp * 0.45)) : 0;
    let red = Math.min(0.75, this.flashRed + low * 0.45);
    if (s.cracks !== false && stage >= 2) red *= 0.5;
    if (red > 0.01) {
      const g = ctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.3, cx, cy, Math.max(W, H) * 0.7);
      g.addColorStop(0, "rgba(200,20,10,0)"); g.addColorStop(1, `rgba(200,20,10,${red})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    if (s.fury) {
      const g = ctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.4, cx, cy, Math.max(W, H) * 0.75);
      g.addColorStop(0, "rgba(255,80,0,0)"); g.addColorStop(1, "rgba(255,80,0,0.22)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    if (s.prot && s.alive) {
      ctx.strokeStyle = "rgba(140,220,255,0.35)"; ctx.lineWidth = 10 * pr;
      ctx.strokeRect(0, 0, W, H);
    }

    // scope
    const scopeType = s.scope && s.scope !== "none" ? s.scope : null;
    const scoped = !!scopeType && s.ads > 0.9 && s.alive;
    if (scoped && !this.scopeOn) this.scopeT = 0;
    this.scopeOn = scoped;
    if (scoped) {
      this.scopeT += dt;
      this._scope(scopeType, s);
    } else if (s.crosshair && s.alive && !s.hideCrosshair) {
      this._crosshair(s);
    }

    // shell cracks (local player health)
    if (s.cracks !== false) {
      this._buildLayers();
      for (let i = 0; i < 3; i++) {
        const target = stage >= i + 1 ? 1 : 0;
        const a = this.crackA[i];
        this.crackA[i] = a + Math.sign(target - a) * Math.min(Math.abs(target - a), dt / 0.3);
        if (this.crackA[i] > 0.005) { ctx.globalAlpha = this.crackA[i]; ctx.drawImage(this.layers[i], 0, 0); }
      }
      ctx.globalAlpha = 1;
      if (this.crackA[2] > 0.01) {
        // yolk seeping in at the edges, pulsing at 1.2 Hz
        const p = 0.5 + 0.5 * Math.sin(this.time * TAU * 1.2);
        const g = ctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.38, cx, cy, Math.max(W, H) * 0.72);
        g.addColorStop(0, "rgba(255,178,26,0)"); g.addColorStop(1, `rgba(255,178,26,${(0.16 + 0.12 * p) * this.crackA[2]})`);
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      }
      // crack burst at the screen edge toward the damage source
      for (let i = this.bursts.length - 1; i >= 0; i--) {
        const b = this.bursts[i];
        b.t += dt;
        if (b.t > 0.6) { this.bursts.splice(i, 1); continue; }
        const wx = b.ax - s.px, wz = b.az - s.pz;
        const ang = Math.atan2(-wx, -wz) - s.yaw;
        const sa = -ang - Math.PI / 2;
        const ex = cx + Math.cos(sa) * W * 0.45, ey = cy + Math.sin(sa) * H * 0.45;
        const bl = this.burstLayer, k = 1 + b.t * 0.6;
        ctx.globalAlpha = Math.max(0, 1 - b.t / 0.6);
        ctx.save(); ctx.translate(ex, ey); ctx.rotate(sa + (b.seed % 7)); ctx.scale(k, k);
        ctx.drawImage(bl, -bl.width / 2, -bl.height / 2);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    } else this.crackA.fill(0);

    // hit markers
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (!h.hold) h.t += dt; // hold: debug screenshots keep the marker up
      const life = h.kill ? 0.45 : h.zone === 1 ? 0.35 : 0.25;
      if (h.t > life) { this.hits.splice(i, 1); continue; }
      const a = 1 - h.t / life;
      const sc = h.kill ? 1.5 : h.zone === 1 ? 1.3 : h.zone >= 3 ? 0.7 : 1;
      const r0 = (7 * sc + h.t * 30) * pr, r1 = r0 + 7 * sc * pr;
      const col = h.kill ? `rgba(255,70,50,${a})` : h.zone === 1 ? `rgba(255,200,40,${a})` : h.zone >= 3 ? `rgba(200,200,200,${a})` : `rgba(255,255,255,${a})`;
      ctx.lineCap = "round";
      ctx.strokeStyle = `rgba(0,0,0,${a * 0.5})`;
      ctx.lineWidth = (h.kill ? 3.2 : 2.4) * sc * pr + 2 * pr;
      this._x(cx, cy, r0, r1);
      ctx.strokeStyle = col;
      ctx.lineWidth = (h.kill ? 3.2 : 2.4) * Math.max(0.8, sc * 0.9) * pr;
      this._x(cx, cy, r0, r1);
      if (h.zone === 1 && !h.kill) {
        // tiny shell-crack glyph above the marker
        const gy = cy - r1 - 7 * pr, gx = cx;
        ctx.strokeStyle = col; ctx.lineWidth = 1.6 * pr;
        ctx.beginPath();
        ctx.moveTo(gx - 6 * pr, gy - 3 * pr); ctx.lineTo(gx - 2 * pr, gy + 2 * pr); ctx.lineTo(gx + 1 * pr, gy - 2 * pr);
        ctx.lineTo(gx + 4 * pr, gy + 3 * pr); ctx.lineTo(gx + 7 * pr, gy - 1 * pr);
        ctx.stroke();
      }
    }

    // damage direction arcs
    for (let i = this.dmg.length - 1; i >= 0; i--) {
      const d = this.dmg[i];
      d.t += dt;
      if (d.t > 1.4) { this.dmg.splice(i, 1); continue; }
      const a = Math.min(1, (1.4 - d.t) / 0.6);
      const wx = d.ax - s.px, wz = d.az - s.pz;
      const ang = Math.atan2(-wx, -wz) - s.yaw; // 0 = in front
      const sa = -ang - Math.PI / 2; // canvas angle (0 = right), up = -PI/2
      const R = Math.min(W, H) * 0.16;
      ctx.strokeStyle = `rgba(255,40,30,${0.85 * a})`;
      ctx.lineWidth = (6 + Math.min(10, d.amount / 8)) * pr;
      ctx.beginPath(); ctx.arc(cx, cy, R, sa - 0.32, sa + 0.32); ctx.stroke();
    }

    if (s.debug) {
      ctx.font = `${12 * pr}px ui-monospace, monospace`;
      const lines = s.debug;
      const bw = 250 * pr, bh = (lines.length * 15 + 10) * pr;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(8 * pr, 8 * pr, bw, bh);
      ctx.fillStyle = "#b8ff9a";
      lines.forEach((l, i) => ctx.fillText(l, 14 * pr, (24 + i * 15) * pr));
    }
  }

  _x(cx, cy, r0, r1) {
    const ctx = this.ctx;
    ctx.beginPath();
    for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      ctx.moveTo(cx + sx * r0 * 0.707, cy + sy * r0 * 0.707);
      ctx.lineTo(cx + sx * r1 * 0.707, cy + sy * r1 * 0.707);
    }
    ctx.stroke();
  }

  _crosshair(s) {
    const ctx = this.ctx, pr = this.pr, cx = this.w / 2, cy = this.h / 2;
    const gap = Math.max(4 * pr, Math.min(120 * pr, s.spreadPx * pr)) * (1 - s.ads * 0.6);
    const len = 7 * pr, th = 2 * pr;
    ctx.globalAlpha = 1 - s.ads * 0.6;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    const tick = (x, y, w, h) => { ctx.fillRect(x - pr, y - pr, w + 2 * pr, h + 2 * pr); };
    tick(cx - gap - len, cy - th / 2, len, th); tick(cx + gap, cy - th / 2, len, th);
    tick(cx - th / 2, cy - gap - len, th, len); tick(cx - th / 2, cy + gap, th, len);
    ctx.fillStyle = s.color || "#ffffff";
    ctx.fillRect(cx - gap - len, cy - th / 2, len, th); ctx.fillRect(cx + gap, cy - th / 2, len, th);
    ctx.fillRect(cx - th / 2, cy - gap - len, th, len); ctx.fillRect(cx - th / 2, cy + gap, th, len);
    ctx.fillRect(cx - pr, cy - pr, 2 * pr, 2 * pr);
    ctx.globalAlpha = 1;
  }

  _scope(type, s) {
    const ctx = this.ctx, W = this.w, H = this.h, pr = this.pr, cx = W / 2, cy = H / 2;
    const R = Math.min(W, H) * 0.46;
    // brief black iris opening over ~0.08 s
    const open = Math.min(1, this.scopeT / 0.08);
    const r = R * (0.15 + 0.85 * open * (2 - open));
    ctx.save();
    // lens tint
    const tint = type === "rocket" ? "rgba(255,170,60,0.06)" : type === "marksman" ? "rgba(255,220,150,0.04)" : "rgba(120,200,190,0.05)";
    ctx.fillStyle = tint;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.clip();
    if (type === "rocket") this._reticleRocket(cx, cy, r, s);
    else if (type === "marksman") this._reticleMarksman(cx, cy, r);
    else this._reticleSniper(cx, cy, r);
    // edge darkening inside the lens
    const g = ctx.createRadialGradient(cx, cy, r * 0.78, cx, cy, r);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.65)");
    ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
    // full black outside + bezel
    ctx.fillStyle = "#000";
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.arc(cx, cy, r, 0, TAU, true); ctx.fill("evenodd");
    ctx.strokeStyle = "#3a3a3e"; ctx.lineWidth = 2 * pr;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
    if (type === "rocket") {
      // orange / black hazard dash ring on the bezel
      ctx.lineWidth = 7 * pr;
      ctx.strokeStyle = "#16130f";
      ctx.beginPath(); ctx.arc(cx, cy, r + 5 * pr, 0, TAU); ctx.stroke();
      ctx.strokeStyle = "#ff9a1f";
      ctx.setLineDash([14 * pr, 14 * pr]);
      ctx.beginPath(); ctx.arc(cx, cy, r + 5 * pr, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      // labels
      ctx.font = `700 ${Math.round(15 * pr)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillStyle = "#ffb347";
      ctx.fillText("SOUFFLE", cx, cy - r + 30 * pr);
      const loaded = s.loaded !== false && !s.reloading;
      const txt = loaded ? "LOADED" : "RELOADING";
      ctx.font = `700 ${Math.round(13 * pr)}px ui-sans-serif, system-ui, sans-serif`;
      const tw = ctx.measureText(txt).width;
      const by = cy + r - 26 * pr;
      ctx.fillStyle = loaded ? "#6fe36a" : "#ff4a3a";
      ctx.beginPath(); ctx.arc(cx - tw / 2 - 10 * pr, by - 4.5 * pr, 4.5 * pr, 0, TAU); ctx.fill();
      ctx.fillText(txt, cx + 4 * pr, by);
      ctx.textAlign = "start";
    }
    if (open < 1) {
      ctx.fillStyle = `rgba(0,0,0,${(1 - open) * 0.8})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  _reticleSniper(cx, cy, r) {
    const ctx = this.ctx, pr = this.pr;
    ctx.strokeStyle = "rgba(0,0,0,0.9)";
    ctx.lineWidth = 1.2 * pr;
    ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.stroke();
    // thick posts from 70 % of the radius outward
    ctx.lineWidth = 6 * pr;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy); ctx.lineTo(cx - r * 0.7, cy); ctx.moveTo(cx + r * 0.7, cy); ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy + r * 0.7); ctx.lineTo(cx, cy + r); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy - r * 0.7);
    ctx.stroke();
    // mil dots every 0.1 r
    ctx.fillStyle = "rgba(0,0,0,0.9)";
    for (let i = 1; i < 7; i++) {
      const d = i * r * 0.1, rr = 2.2 * pr;
      for (const [x, y] of [[cx + d, cy], [cx - d, cy], [cx, cy + d], [cx, cy - d]]) { ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.fill(); }
    }
    ctx.fillStyle = "rgba(255,40,40,0.95)";
    ctx.beginPath(); ctx.arc(cx, cy, 2 * pr, 0, TAU); ctx.fill();
  }

  _reticleMarksman(cx, cy, r) {
    const ctx = this.ctx, pr = this.pr;
    ctx.strokeStyle = "rgba(20,14,8,0.85)"; ctx.lineWidth = 1 * pr;
    ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx - r * 0.12, cy); ctx.moveTo(cx + r * 0.12, cy); ctx.lineTo(cx + r, cy); ctx.stroke();
    ctx.lineWidth = 4 * pr;
    ctx.beginPath(); ctx.moveTo(cx, cy + r * 0.75); ctx.lineTo(cx, cy + r); ctx.stroke();
    // amber chevron
    const k = 14 * pr;
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.lineWidth = 5 * pr;
    ctx.beginPath(); ctx.moveTo(cx - k, cy + k * 0.95); ctx.lineTo(cx, cy); ctx.lineTo(cx + k, cy + k * 0.95); ctx.stroke();
    ctx.strokeStyle = "#ffb12e"; ctx.lineWidth = 3 * pr;
    ctx.beginPath(); ctx.moveTo(cx - k, cy + k * 0.95); ctx.lineTo(cx, cy); ctx.lineTo(cx + k, cy + k * 0.95); ctx.stroke();
    // holdover ticks
    ctx.strokeStyle = "rgba(255,177,46,0.9)"; ctx.lineWidth = 2 * pr;
    for (let i = 1; i <= 3; i++) {
      const y = cy + k * 0.95 + i * r * 0.09, w = r * (0.07 - i * 0.012);
      ctx.beginPath(); ctx.moveTo(cx - w, y); ctx.lineTo(cx + w, y); ctx.stroke();
    }
  }

  _reticleRocket(cx, cy, r, s) {
    const ctx = this.ctx, pr = this.pr, H = this.h;
    const amber = "rgba(255,170,50,0.95)", dark = "rgba(0,0,0,0.55)";
    const cr = 0.016 * H;
    const both = (fn) => { ctx.strokeStyle = dark; ctx.lineWidth = 4 * pr; fn(); ctx.strokeStyle = amber; ctx.lineWidth = 2 * pr; fn(); };
    // hairlines with a central gap
    const gap = cr * 2.6;
    both(() => {
      ctx.beginPath();
      ctx.moveTo(cx - r, cy); ctx.lineTo(cx - gap, cy); ctx.moveTo(cx + gap, cy); ctx.lineTo(cx + r, cy);
      ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy - gap); ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, cy + r);
      ctx.stroke();
    });
    // centre ring + 4 corner brackets
    both(() => { ctx.beginPath(); ctx.arc(cx, cy, cr, 0, TAU); ctx.stroke(); });
    const b = cr * 2.2, bl = cr * 0.9;
    both(() => {
      ctx.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        ctx.moveTo(cx + sx * b, cy + sy * (b - bl)); ctx.lineTo(cx + sx * b, cy + sy * b); ctx.lineTo(cx + sx * (b - bl), cy + sy * b);
      }
      ctx.stroke();
    });
    // egg-stadia rangefinder: an egg (0.84 u wide, 1.5 u tall) at 15, 30 and 60 u
    const fov = ((s.fov || 40) * Math.PI) / 180;
    const k = (H / 2) / Math.tan(fov / 2);
    let y = cy + b + 12 * pr;
    ctx.font = `700 ${Math.round(12 * pr)}px ui-sans-serif, system-ui, sans-serif`;
    for (const d of [15, 30, 60]) {
      const w = (0.84 / d) * k, h = (1.5 / d) * k;
      const ey = y + h / 2;
      both(() => {
        ctx.beginPath();
        // egg outline: narrower top half
        ctx.ellipse(cx, ey + h * 0.06, w / 2, h * 0.44, 0, 0, Math.PI);
        ctx.ellipse(cx, ey + h * 0.06, w / 2 * 0.98, h * 0.56, 0, Math.PI, TAU);
        ctx.stroke();
      });
      ctx.fillStyle = dark; ctx.fillText(String(d), cx + w / 2 + 7 * pr + pr, ey + 4 * pr + pr);
      ctx.fillStyle = amber; ctx.fillText(String(d), cx + w / 2 + 7 * pr, ey + 4 * pr);
      y += h + 8 * pr;
    }
  }

  dispose() { this.c.remove(); }
}
