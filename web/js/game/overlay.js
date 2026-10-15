// 2D overlay canvas drawn by the game on top of the 3D view (pointer-events: none):
// dynamic crosshair, hit markers, damage-direction indicators, sniper scope,
// low-health vignette, spawn-protection tint, and the optional debug panel.
// Health/ammo/killfeed/scoreboard/chat are left to the UI (callbacks).

export class Overlay {
  constructor(container) {
    this.c = document.createElement("canvas");
    this.c.className = "yo-overlay";
    Object.assign(this.c.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none", zIndex: "2" });
    container.appendChild(this.c);
    this.ctx = this.c.getContext("2d");
    this.hits = [];   // {t, hs, kill}
    this.dmg = [];    // {t, ax, az, amount}
    this.flashRed = 0;
    this.w = 0; this.h = 0;
    this.resize();
  }

  resize() {
    const r = this.c.getBoundingClientRect();
    const pr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(r.width * pr)), h = Math.max(1, Math.round(r.height * pr));
    if (w !== this.c.width || h !== this.c.height) { this.c.width = w; this.c.height = h; }
    this.pr = pr; this.w = w; this.h = h;
  }

  hitMarker(hs, kill) { this.hits.push({ t: 0, hs, kill }); if (this.hits.length > 6) this.hits.shift(); }
  damage(ax, az, amount) { this.dmg.push({ t: 0, ax, az, amount }); if (this.dmg.length > 8) this.dmg.shift(); this.flashRed = Math.min(0.5, this.flashRed + amount / 120); }

  /**
   * s: {dt, crosshair (bool), color, spreadPx, ads (0..1), scoped, alive, hp, maxHp, prot, yaw, px, pz,
   *     debug (null | string[]), fury, hideCrosshair}
   */
  draw(s) {
    this.resize();
    const ctx = this.ctx, W = this.w, H = this.h, pr = this.pr;
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2;
    const dt = s.dt;

    // vignette: low health / damage flash / fury
    this.flashRed = Math.max(0, this.flashRed - dt * 0.9);
    const low = s.alive ? Math.max(0, 1 - s.hp / (s.maxHp * 0.45)) : 0;
    const red = Math.min(0.75, this.flashRed + low * 0.45);
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
    if (s.scoped && s.ads > 0.9 && s.alive) {
      const r = Math.min(W, H) * 0.42;
      ctx.fillStyle = "#000";
      ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.arc(cx, cy, r, 0, Math.PI * 2, true); ctx.fill("evenodd");
      ctx.strokeStyle = "rgba(0,0,0,0.85)"; ctx.lineWidth = 1.5 * pr;
      ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.stroke();
      ctx.lineWidth = 4 * pr;
      ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx - r * 0.25, cy); ctx.moveTo(cx + r * 0.25, cy); ctx.lineTo(cx + r, cy);
      ctx.moveTo(cx, cy + r * 0.25); ctx.lineTo(cx, cy + r); ctx.stroke();
      ctx.fillStyle = "rgba(255,40,40,0.9)";
      ctx.beginPath(); ctx.arc(cx, cy, 2 * pr, 0, 6.3); ctx.fill();
      const g = ctx.createRadialGradient(cx, cy, r * 0.85, cx, cy, r);
      g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.6)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.3); ctx.fill();
    } else if (s.crosshair && s.alive && !s.hideCrosshair) {
      // dynamic crosshair: four ticks pushed out by the current spread
      const gap = Math.max(4 * pr, Math.min(120 * pr, s.spreadPx * pr)) * (1 - s.ads * 0.6);
      const len = 7 * pr, th = 2 * pr;
      const alpha = 1 - s.ads * 0.6;
      ctx.globalAlpha = alpha;
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

    // hit markers
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      h.t += dt;
      const life = h.kill ? 0.45 : 0.25;
      if (h.t > life) { this.hits.splice(i, 1); continue; }
      const a = 1 - h.t / life;
      const r0 = (h.kill ? 9 : 7) * pr + h.t * 30 * pr, r1 = r0 + (h.kill ? 10 : 7) * pr;
      ctx.strokeStyle = h.kill ? `rgba(255,70,50,${a})` : h.hs ? `rgba(255,200,40,${a})` : `rgba(255,255,255,${a})`;
      ctx.lineWidth = (h.kill ? 3.2 : 2.4) * pr;
      ctx.beginPath();
      for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        ctx.moveTo(cx + sx * r0 * 0.707, cy + sy * r0 * 0.707);
        ctx.lineTo(cx + sx * r1 * 0.707, cy + sy * r1 * 0.707);
      }
      ctx.stroke();
    }

    // damage direction arcs
    for (let i = this.dmg.length - 1; i >= 0; i--) {
      const d = this.dmg[i];
      d.t += dt;
      if (d.t > 1.4) { this.dmg.splice(i, 1); continue; }
      const a = Math.min(1, (1.4 - d.t) / 0.6);
      // angle of source relative to view: yaw 0 looks -Z; screen up = forward
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
      const bw = 230 * pr, bh = (lines.length * 15 + 10) * pr;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(8 * pr, 8 * pr, bw, bh);
      ctx.fillStyle = "#b8ff9a";
      lines.forEach((l, i) => ctx.fillText(l, 14 * pr, (24 + i * 15) * pr));
    }
  }

  dispose() { this.c.remove(); }
}
