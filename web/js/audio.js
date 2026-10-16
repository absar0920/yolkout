// Yolkout procedural sound effects (WebAudio, no audio files).
//
//   import { sfx } from "/js/audio.js";
//   sfx.play(name, { volume, pan, dist, local, victim });
//   sfx.setVolume(0..1);
//
// Every sound is a small synth recipe (noise bursts + oscillator sweeps). On the first user
// gesture the AudioContext is created and every recipe is pre-rendered once into an AudioBuffer
// with an OfflineAudioContext, so a play() is just one BufferSource + gain (+ pan/filter): cheap
// enough for a 15 shots/s SMG with a dozen players. Until rendering finishes, recipes run live.
//
// Names: shoot_<weaponId> for every weapon in shared/data/weapons.json (unknown ids fall back to
// a generic rifle), reload, hit, headshot, kill, death_crack, explode, jump, land, footstep, pickup,
// grenade_throw, empty, ui_click, plus UI extras: ui_hover, ui_back, streak, flag, chat, match_end,
// countdown, hurt; v2: shoot_<meleeId> swings, melee_hit_<meleeId>, melee_thud, hit_limb and the reload/cycle beats
// reload_start, mag_out, mag_in, mag_slap, bolt, pump, shell_in, slide, rocket_load (played by the first-person
// animation at the matching frame; gun shots no longer bake in a pump/bolt click).

const MAX_VOICES = 40;

// ------------------------------------------------------------------ building blocks

let noiseBuf = null;
function noise(ctx) {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
  const len = Math.floor(ctx.sampleRate * 1.5);
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  let s = 0x2f6b1d3; // deterministic xorshift so pre-renders are stable
  for (let i = 0; i < len; i++) {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    d[i] = ((s >>> 0) / 4294967296) * 2 - 1;
  }
  noiseBuf = b;
  return b;
}

/** Envelope helper: attack to `peak` then exponential-ish decay to silence over `dur`. */
function env(g, t, peak, attack, dur) {
  const p = g.gain;
  p.setValueAtTime(0.0001, t);
  p.linearRampToValueAtTime(peak, t + attack);
  p.exponentialRampToValueAtTime(0.0001, t + Math.max(attack + 0.005, dur));
}

/** Filtered noise burst. */
function nz(ctx, out, t, { dur = 0.1, gain = 0.5, type = "lowpass", f = 1000, f1 = 0, q = 0.7, attack = 0.002, offset = 0 }) {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  const flt = ctx.createBiquadFilter();
  flt.type = type;
  flt.frequency.setValueAtTime(f, t);
  if (f1) flt.frequency.exponentialRampToValueAtTime(f1, t + dur);
  flt.Q.value = q;
  const g = ctx.createGain();
  env(g, t, gain, attack, dur);
  src.connect(flt).connect(g).connect(out);
  src.start(t, offset);
  src.stop(t + dur + 0.02);
}

/** Oscillator with a pitch sweep. */
function osc(ctx, out, t, { type = "sine", f = 440, f1 = 0, dur = 0.1, gain = 0.4, attack = 0.002, curve = "exp" }) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f1) {
    if (curve === "lin") o.frequency.linearRampToValueAtTime(f1, t + dur);
    else o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  }
  const g = ctx.createGain();
  env(g, t, gain, attack, dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

const click = (ctx, out, t, f = 3500, gain = 0.35, dur = 0.018) => nz(ctx, out, t, { type: "bandpass", f, q: 2.5, dur, gain, attack: 0.001 });

// ------------------------------------------------------------------ guns

// crack = bright transient, body = low sweep "thump", tail = rumbling noise, extra = mechanics
const GUN = {
  benedict:  { crack: [2600, 0.06, 0.85], body: [170, 58, 0.10, 0.75], tail: [950, 0.20, 0.32] },
  deviler:   { crack: [1700, 0.10, 1.00], body: [120, 38, 0.22, 1.00], tail: [620, 0.50, 0.60] },
  poacher:   { crack: [3300, 0.04, 0.70], body: [230, 90, 0.06, 0.55], tail: [1500, 0.11, 0.24] },
  piercer:   { crack: [2300, 0.09, 1.00], body: [95, 32, 0.28, 1.00], tail: [700, 0.95, 0.50] },
  frittata:  { crack: [2900, 0.05, 0.80], body: [190, 70, 0.08, 0.70], tail: [1150, 0.16, 0.30] },
  overeasy:  { crack: [2450, 0.07, 0.92], body: [140, 52, 0.15, 0.88], tail: [900, 0.38, 0.40] },
  coddler:   { crack: [3100, 0.05, 0.72], body: [270, 100, 0.06, 0.55], tail: [1600, 0.10, 0.24] },
};

function gun(p) {
  return {
    len: Math.max(0.2, (p.tail ? p.tail[1] : 0.2) + 0.05, p.pump ? p.pump + 0.25 : 0, p.bolt ? p.bolt + 0.3 : 0),
    fn(ctx, out, t) {
      const [cf, cd, cg] = p.crack;
      nz(ctx, out, t, { type: "highpass", f: cf, dur: cd, gain: cg, q: 0.9 });
      const [b0, b1, bd, bg] = p.body;
      osc(ctx, out, t, { type: "sine", f: b0, f1: b1, dur: bd, gain: bg });
      osc(ctx, out, t, { type: "triangle", f: b0 * 2.1, f1: b1 * 1.5, dur: bd * 0.6, gain: bg * 0.25 });
      if (p.tail) nz(ctx, out, t + 0.004, { type: "lowpass", f: p.tail[0], f1: p.tail[0] * 0.35, dur: p.tail[1], gain: p.tail[2], attack: 0.006 });
      if (p.pump) { click(ctx, out, t + p.pump, 2200, 0.25, 0.03); click(ctx, out, t + p.pump + 0.12, 1700, 0.3, 0.04); }
      if (p.bolt) { click(ctx, out, t + p.bolt, 2600, 0.2, 0.025); click(ctx, out, t + p.bolt + 0.16, 1900, 0.28, 0.035); }
    },
  };
}

const R = {}; // name -> {len, fn}
for (const [id, p] of Object.entries(GUN)) R["shoot_" + id] = gun(p);

R.shoot_souffle = {
  len: 0.45,
  fn(ctx, out, t) {
    osc(ctx, out, t, { f: 260, f1: 62, dur: 0.32, gain: 1.0 });
    nz(ctx, out, t, { type: "lowpass", f: 520, f1: 200, dur: 0.28, gain: 0.55, attack: 0.004 });
    osc(ctx, out, t + 0.03, { type: "sine", f: 900, f1: 1500, dur: 0.3, gain: 0.07, attack: 0.03 });
    click(ctx, out, t, 1500, 0.3, 0.02);
  },
};
R.grenade_throw = {
  len: 0.32,
  fn(ctx, out, t) {
    click(ctx, out, t, 4200, 0.3, 0.012);
    click(ctx, out, t + 0.03, 2800, 0.2, 0.012);
    nz(ctx, out, t + 0.05, { type: "bandpass", f: 500, f1: 1900, q: 1.4, dur: 0.24, gain: 0.45, attack: 0.06 });
  },
};
R.shoot_quiche = R.grenade_throw;
R.shoot_rollingpin = {
  len: 0.26,
  fn(ctx, out, t) {
    nz(ctx, out, t, { type: "bandpass", f: 380, f1: 1700, q: 1.8, dur: 0.2, gain: 0.55, attack: 0.05 });
    osc(ctx, out, t + 0.12, { type: "triangle", f: 210, f1: 150, dur: 0.07, gain: 0.25 });
  },
};

// melee swings: each kitchen tool has its own whoosh, and its own impact
R.shoot_pan = {
  len: 0.36,
  fn(ctx, out, t) {
    nz(ctx, out, t, { type: "bandpass", f: 260, f1: 1100, q: 1.4, dur: 0.3, gain: 0.6, attack: 0.09 });
    osc(ctx, out, t + 0.02, { type: "triangle", f: 820, f1: 760, dur: 0.12, gain: 0.05 });
  },
};
R.shoot_whisk = {
  len: 0.16,
  fn(ctx, out, t) {
    nz(ctx, out, t, { type: "bandpass", f: 1400, f1: 3200, q: 2.2, dur: 0.12, gain: 0.45, attack: 0.025 });
    for (let i = 0; i < 3; i++) click(ctx, out, t + 0.02 + i * 0.018, 5200 - i * 400, 0.06, 0.008);
  },
};
R.shoot_spatula = {
  len: 0.24,
  fn(ctx, out, t) {
    nz(ctx, out, t, { type: "bandpass", f: 600, f1: 1500, q: 1.1, dur: 0.2, gain: 0.5, attack: 0.04 });
    osc(ctx, out, t + 0.06, { type: "sine", f: 300, f1: 520, dur: 0.1, gain: 0.08 });
  },
};
R.melee_hit_rollingpin = {
  len: 0.22,
  fn(ctx, out, t) {
    // hollow wooden BONK
    osc(ctx, out, t, { type: "sine", f: 520, f1: 260, dur: 0.16, gain: 0.7 });
    osc(ctx, out, t, { type: "triangle", f: 1040, f1: 700, dur: 0.06, gain: 0.25 });
    click(ctx, out, t, 2200, 0.4, 0.02);
  },
};
R.melee_hit_pan = {
  len: 1.0,
  fn(ctx, out, t) {
    // cast-iron CLANG: inharmonic partials ringing out
    click(ctx, out, t, 3000, 0.6, 0.02);
    [[410, 0.5, 0.9], [1067, 0.3, 0.7], [1786, 0.18, 0.5], [2690, 0.1, 0.35], [3412, 0.06, 0.25]].forEach(([f, g, d]) =>
      osc(ctx, out, t, { type: "sine", f, f1: f * 0.995, dur: d, gain: g, attack: 0.001 }));
    nz(ctx, out, t, { type: "highpass", f: 3000, dur: 0.08, gain: 0.3 });
  },
};
R.melee_hit_whisk = {
  len: 0.12,
  fn(ctx, out, t) {
    for (let i = 0; i < 4; i++) click(ctx, out, t + i * 0.012, 4800 + i * 500, 0.3, 0.01);
    osc(ctx, out, t, { type: "triangle", f: 2400, f1: 1800, dur: 0.05, gain: 0.12 });
  },
};
R.melee_hit_spatula = {
  len: 0.16,
  fn(ctx, out, t) {
    // flat SLAP
    nz(ctx, out, t, { type: "bandpass", f: 1300, q: 0.9, dur: 0.06, gain: 0.8, attack: 0.001 });
    osc(ctx, out, t, { type: "sine", f: 240, f1: 120, dur: 0.1, gain: 0.45 });
  },
};
R.melee_thud = {
  len: 0.14,
  fn(ctx, out, t) {
    nz(ctx, out, t, { type: "lowpass", f: 700, f1: 200, dur: 0.1, gain: 0.6 });
    osc(ctx, out, t, { type: "sine", f: 160, f1: 70, dur: 0.1, gain: 0.5 });
  },
};

// reload / cycle beats (emitted by the first-person animation at the matching frame)
R.reload_start = {
  len: 0.1,
  fn(ctx, out, t) { nz(ctx, out, t, { type: "bandpass", f: 900, f1: 600, q: 1.2, dur: 0.08, gain: 0.16, attack: 0.01 }); },
};
R.mag_out = {
  len: 0.14,
  fn(ctx, out, t) {
    click(ctx, out, t, 3000, 0.32, 0.02);
    nz(ctx, out, t + 0.02, { type: "bandpass", f: 1100, f1: 700, q: 1.4, dur: 0.09, gain: 0.2 });
  },
};
R.mag_in = {
  len: 0.12,
  fn(ctx, out, t) {
    click(ctx, out, t, 1500, 0.5, 0.035);
    osc(ctx, out, t, { type: "square", f: 520, f1: 380, dur: 0.035, gain: 0.08 });
    click(ctx, out, t + 0.04, 2600, 0.3, 0.02);
  },
};
R.mag_slap = {
  len: 0.07,
  fn(ctx, out, t) { nz(ctx, out, t, { type: "bandpass", f: 900, q: 1, dur: 0.05, gain: 0.35, attack: 0.001 }); click(ctx, out, t, 2000, 0.2, 0.015); },
};
R.bolt = {
  len: 0.2,
  fn(ctx, out, t) {
    click(ctx, out, t, 2600, 0.3, 0.025);
    nz(ctx, out, t + 0.01, { type: "highpass", f: 2400, dur: 0.06, gain: 0.15, attack: 0.01 });
    click(ctx, out, t + 0.12, 1900, 0.36, 0.035);
  },
};
R.pump = {
  len: 0.24,
  fn(ctx, out, t) {
    click(ctx, out, t, 2200, 0.35, 0.03);
    nz(ctx, out, t + 0.01, { type: "bandpass", f: 1500, q: 1.5, dur: 0.07, gain: 0.18 });
    click(ctx, out, t + 0.14, 1700, 0.42, 0.04);
  },
};
R.shell_in = {
  len: 0.08,
  fn(ctx, out, t) { click(ctx, out, t, 2300, 0.38, 0.025); osc(ctx, out, t, { type: "square", f: 700, f1: 520, dur: 0.02, gain: 0.05 }); },
};
R.slide = {
  len: 0.16,
  fn(ctx, out, t) {
    nz(ctx, out, t, { type: "highpass", f: 2600, dur: 0.05, gain: 0.2, attack: 0.005 });
    click(ctx, out, t + 0.06, 2100, 0.45, 0.03);
  },
};
R.rocket_load = {
  len: 0.3,
  fn(ctx, out, t) {
    nz(ctx, out, t, { type: "bandpass", f: 500, f1: 300, q: 1.2, dur: 0.12, gain: 0.3, attack: 0.03 });
    osc(ctx, out, t + 0.1, { type: "sine", f: 180, f1: 110, dur: 0.12, gain: 0.5 });
    click(ctx, out, t + 0.1, 1200, 0.5, 0.04);
  },
};

// ------------------------------------------------------------------ feedback

R.reload = {
  len: 0.62,
  fn(ctx, out, t) {
    click(ctx, out, t, 3000, 0.3, 0.02);
    nz(ctx, out, t + 0.05, { type: "bandpass", f: 900, f1: 600, q: 1.2, dur: 0.1, gain: 0.18 });
    click(ctx, out, t + 0.3, 1500, 0.45, 0.04);
    osc(ctx, out, t + 0.3, { type: "square", f: 520, f1: 380, dur: 0.035, gain: 0.08 });
    nz(ctx, out, t + 0.45, { type: "highpass", f: 2400, dur: 0.07, gain: 0.22, attack: 0.02 });
    click(ctx, out, t + 0.54, 2600, 0.38, 0.025);
  },
};
R.hit = {
  len: 0.09,
  fn(ctx, out, t) {
    osc(ctx, out, t, { type: "sine", f: 1450, f1: 1000, dur: 0.06, gain: 0.45 });
    click(ctx, out, t, 3800, 0.25, 0.02);
  },
};
R.hit_limb = {
  len: 0.07,
  fn(ctx, out, t) {
    osc(ctx, out, t, { type: "sine", f: 1150, f1: 900, dur: 0.045, gain: 0.3 });
    click(ctx, out, t, 3200, 0.15, 0.015);
  },
};
R.hurt = {
  len: 0.2,
  fn(ctx, out, t) {
    osc(ctx, out, t, { type: "sine", f: 210, f1: 75, dur: 0.16, gain: 0.7 });
    nz(ctx, out, t, { type: "lowpass", f: 900, f1: 300, dur: 0.12, gain: 0.35 });
  },
};
R.headshot = {
  len: 0.42,
  fn(ctx, out, t) {
    click(ctx, out, t, 4200, 0.35, 0.02);
    osc(ctx, out, t, { type: "sine", f: 1760, dur: 0.38, gain: 0.32 });
    osc(ctx, out, t, { type: "sine", f: 2640, dur: 0.22, gain: 0.16 });
    osc(ctx, out, t, { type: "triangle", f: 1320, f1: 1200, dur: 0.12, gain: 0.2 });
  },
};
R.kill = {
  len: 0.5,
  fn(ctx, out, t) {
    nz(ctx, out, t, { type: "bandpass", f: 2600, q: 1.2, dur: 0.07, gain: 0.35 });
    osc(ctx, out, t, { type: "triangle", f: 660, dur: 0.16, gain: 0.35 });
    osc(ctx, out, t + 0.075, { type: "triangle", f: 990, dur: 0.38, gain: 0.35 });
    osc(ctx, out, t + 0.075, { type: "sine", f: 1980, dur: 0.24, gain: 0.08 });
  },
};
R.death_crack = {
  len: 0.5,
  fn(ctx, out, t) {
    // a fast cluster of shell cracks, then a wet splat
    const offs = [0, 0.018, 0.031, 0.05, 0.072, 0.09];
    offs.forEach((o, i) => click(ctx, out, t + o, 2400 + ((i * 1373) % 2600), 0.42 - i * 0.04, 0.014));
    nz(ctx, out, t + 0.07, { type: "lowpass", f: 700, f1: 160, q: 3, dur: 0.3, gain: 0.55, attack: 0.01 });
    osc(ctx, out, t + 0.07, { type: "sine", f: 190, f1: 55, dur: 0.24, gain: 0.45 });
  },
};
R.explode = {
  len: 1.3,
  fn(ctx, out, t) {
    nz(ctx, out, t, { type: "lowpass", f: 2400, f1: 110, dur: 1.15, gain: 1.0, attack: 0.004 });
    osc(ctx, out, t, { type: "sine", f: 95, f1: 28, dur: 0.75, gain: 1.0 });
    nz(ctx, out, t, { type: "highpass", f: 1800, dur: 0.12, gain: 0.5 });
    for (let i = 0; i < 6; i++) click(ctx, out, t + 0.08 + i * 0.07 + (i % 2) * 0.02, 1200 + i * 300, 0.12, 0.02);
  },
};
R.jump = {
  len: 0.14,
  fn(ctx, out, t) {
    osc(ctx, out, t, { type: "sine", f: 300, f1: 540, dur: 0.11, gain: 0.25, attack: 0.008 });
    nz(ctx, out, t, { type: "lowpass", f: 500, dur: 0.05, gain: 0.15 });
  },
};
R.land = {
  len: 0.14,
  fn(ctx, out, t) {
    nz(ctx, out, t, { type: "lowpass", f: 420, f1: 180, dur: 0.1, gain: 0.6 });
    osc(ctx, out, t, { type: "sine", f: 130, f1: 60, dur: 0.09, gain: 0.45 });
  },
};
R.footstep = {
  len: 0.08,
  fn(ctx, out, t) {
    nz(ctx, out, t, { type: "bandpass", f: 650, q: 1.1, dur: 0.06, gain: 0.5 });
    osc(ctx, out, t, { type: "sine", f: 110, f1: 70, dur: 0.05, gain: 0.25 });
  },
};
R.pickup = {
  len: 0.3,
  fn(ctx, out, t) {
    [660, 880, 1320].forEach((f, i) => osc(ctx, out, t + i * 0.06, { type: "triangle", f, dur: 0.14, gain: 0.3 }));
  },
};
R.empty = {
  len: 0.06,
  fn(ctx, out, t) {
    click(ctx, out, t, 4200, 0.4, 0.015);
    osc(ctx, out, t, { type: "square", f: 1900, f1: 1500, dur: 0.012, gain: 0.06 });
  },
};

// ------------------------------------------------------------------ UI

R.ui_click = {
  len: 0.07,
  fn(ctx, out, t) { osc(ctx, out, t, { type: "sine", f: 880, f1: 1320, dur: 0.05, gain: 0.25, attack: 0.003 }); },
};
R.ui_hover = {
  len: 0.04,
  fn(ctx, out, t) { osc(ctx, out, t, { type: "sine", f: 1500, dur: 0.025, gain: 0.06, attack: 0.002 }); },
};
R.ui_back = {
  len: 0.08,
  fn(ctx, out, t) { osc(ctx, out, t, { type: "sine", f: 1100, f1: 700, dur: 0.06, gain: 0.22, attack: 0.003 }); },
};
R.chat = {
  len: 0.12,
  fn(ctx, out, t) {
    osc(ctx, out, t, { type: "sine", f: 1200, dur: 0.05, gain: 0.12 });
    osc(ctx, out, t + 0.05, { type: "sine", f: 1600, dur: 0.06, gain: 0.1 });
  },
};
R.streak = {
  len: 0.7,
  fn(ctx, out, t) {
    [523, 659, 784, 1047].forEach((f, i) => osc(ctx, out, t + i * 0.07, { type: "triangle", f, dur: 0.35, gain: 0.26 }));
    osc(ctx, out, t + 0.28, { type: "sine", f: 2093, dur: 0.4, gain: 0.07 });
  },
};
R.flag = {
  len: 0.5,
  fn(ctx, out, t) {
    osc(ctx, out, t, { type: "square", f: 440, dur: 0.12, gain: 0.08 });
    osc(ctx, out, t + 0.12, { type: "square", f: 587, dur: 0.12, gain: 0.08 });
    osc(ctx, out, t + 0.24, { type: "triangle", f: 880, dur: 0.24, gain: 0.25 });
  },
};
R.countdown = {
  len: 0.16,
  fn(ctx, out, t) { osc(ctx, out, t, { type: "triangle", f: 740, dur: 0.12, gain: 0.25 }); },
};
R.match_end = {
  len: 1.2,
  fn(ctx, out, t) {
    [392, 523, 659, 784].forEach((f, i) => osc(ctx, out, t + i * 0.12, { type: "triangle", f, dur: 0.5, gain: 0.25 }));
    osc(ctx, out, t + 0.48, { type: "triangle", f: 1047, dur: 0.7, gain: 0.25 });
  },
};

// ------------------------------------------------------------------ engine

const state = {
  ctx: null,
  master: null,
  volume: 0.8,
  buffers: new Map(),
  rendered: false,
  voices: 0,
  last: new Map(),
  listening: false,
};

function recipe(name) {
  if (R[name]) return R[name];
  if (name.startsWith("shoot_")) return R.shoot_benedict; // unknown weapon id: generic rifle
  return null;
}

function createCtx() {
  if (state.ctx) return state.ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    const ctx = new AC({ latencyHint: "interactive" });
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.18;
    const master = ctx.createGain();
    master.gain.value = curve(state.volume);
    master.connect(comp).connect(ctx.destination);
    state.ctx = ctx;
    state.master = master;
  } catch {
    state.ctx = null;
  }
  return state.ctx;
}

const curve = (v) => v * v; // perceptual-ish slider

async function prerender() {
  const ctx = state.ctx;
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!ctx || !OAC || state.rendered) return;
  state.rendered = true;
  const rate = ctx.sampleRate;
  const names = Object.keys(R);
  for (const name of names) {
    const r = R[name];
    try {
      const len = Math.ceil((r.len + 0.05) * rate);
      const oc = new OAC(1, len, rate);
      r.fn(oc, oc.destination, 0.001);
      state.buffers.set(name, await oc.startRendering());
    } catch { /* fall back to live synthesis for this one */ }
  }
}

function unlock() {
  const ctx = createCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  if (ctx.state !== "closed") {
    if (!state.rendered) prerender();
  }
  if (ctx.state === "running") detach();
}

const GESTURES = ["pointerdown", "keydown", "touchend", "mousedown"];
function onGesture() { unlock(); }
function attach() {
  if (state.listening || typeof window === "undefined") return;
  state.listening = true;
  for (const ev of GESTURES) window.addEventListener(ev, onGesture, { capture: true, passive: true });
}
function detach() {
  if (!state.listening) return;
  state.listening = false;
  for (const ev of GESTURES) window.removeEventListener(ev, onGesture, { capture: true });
}

function play(name, opts = {}) {
  const ctx = state.ctx;
  if (!ctx || ctx.state !== "running" || state.volume <= 0) {
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
    return;
  }
  if (name === "hit" && opts.victim) name = "hurt";
  const r = recipe(name);
  if (!r) return;
  const vol = Math.max(0, Math.min(1.5, opts.volume ?? 1));
  if (vol < 0.01) return;
  const now = ctx.currentTime;
  // de-dupe identical remote sounds landing in the same few ms (e.g. a shotgun volley)
  if (!opts.local) {
    const lt = state.last.get(name) || 0;
    if (now - lt < 0.018) return;
  }
  state.last.set(name, now);
  if (state.voices >= MAX_VOICES) return;

  let node = ctx.createGain();
  node.gain.value = vol;
  const chain = [node];
  const dist = opts.dist || 0;
  if (dist > 10) {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = Math.max(700, 16000 * Math.pow(1 - Math.min(1, dist / 80), 2));
    chain.push(lp);
  }
  if (opts.pan && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, opts.pan)) * 0.8;
    chain.push(p);
  }
  for (let i = 0; i < chain.length - 1; i++) chain[i].connect(chain[i + 1]);
  chain[chain.length - 1].connect(state.master);

  state.voices++;
  const done = () => { state.voices = Math.max(0, state.voices - 1); try { node.disconnect(); } catch { /* ignore */ } };
  const buf = state.buffers.get(name) || (name.startsWith("shoot_") && !R[name] ? state.buffers.get("shoot_benedict") : null);
  if (buf) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const varies = name === "footstep" ? 0.16 : name.startsWith("shoot_") ? 0.05 : name.startsWith("ui_") ? 0 : 0.03;
    src.playbackRate.value = 1 + (Math.random() - 0.5) * varies;
    src.connect(node);
    src.onended = done;
    src.start(now);
  } else {
    try { r.fn(ctx, node, now + 0.001); } catch { /* ignore */ }
    setTimeout(done, (r.len + 0.1) * 1000);
  }
}

function setVolume(v) {
  const n = Number(v);
  state.volume = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.8;
  if (state.master && state.ctx) state.master.gain.setTargetAtTime(curve(state.volume), state.ctx.currentTime, 0.02);
}

export const sfx = {
  play,
  setVolume,
  unlock,
  get volume() { return state.volume; },
  get ready() { return !!state.ctx && state.ctx.state === "running"; },
  names: () => Object.keys(R),
};

export default sfx;

attach();
