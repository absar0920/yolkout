// Data-driven first-person action timelines (docs/V2_SPEC.md 5.4).
//
// A timeline is a plain object sampled by anims.js at a normalised time f in [0, 1] (reload/switch/grenade)
// or in seconds (cycle/melee: `unit: "s"`, `end` = length in seconds).
//
//   gun:   [[t, [x,y,z], [rx,ry,rz], ease]]   additive gunRoot offset (view space metres / radians)
//   L, R:  [[t, target, ease]]                hand targets; the hand blends from key i to key i+1
//   parts: { bolt|lift|pump|slide: [[t, v, ease]] }   v = fraction of the part's travel (lift = of travel.lift)
//   item:  { part, keys: [[t, pose, ease]], vis: [[t, bool]] }   a gun part carried by the L hand
//   ev:    [[t, type, arg]]                   one-shot events (sounds, casings, drops)
//   show:  { melee|nade: [[t, bool]] }        held-item visibility
//
// Hand targets: "rg" / "lg" (rightGrip / leftGrip socket with the socket's pose), {s: socket, o?, go?, pose?},
// {g: [x,y,z], r?: [rx,ry,rz], pose?} free in gunRoot space (gun units), {v: [..], r?, pose?} free in view space
// (metres), {item: 1, pose?, go?} = on the carried item's grip anchor. `o` offsets in the socket frame, `go` in
// gunRoot space (gun units).
// Item poses: "rest", {d: x} (rest + travel axis * x), {g: [..], r?: [..]} free in gun space, {s: socket, o?, r?}.
// Ease names: see springs.js EASE (s = smoothstep default, back = overshoot return, out, in, lin).

const D = Math.PI / 180;
/** Live overrides for tuning poses from the browser console (debug only). */
export const TUNE = {};
const Z3 = [0, 0, 0];

/** Off-screen point below the gun for the L hand / carried items (gun units, gunRoot space). */
export const OFF = [-0.15, -0.45, 0.1];

function rest(t, e = "s") { return [t, Z3, Z3, e]; }

// ----------------------------------------------------------------- reloads

/** Rifle / SMG magazine swap. o: {empty, cant (rad), slap (poacher HK slap), boltSlap (frittata palm)} */
function magReload(o) {
  const E = !!o.empty, c = o.cant;
  // raise the gun toward the middle and roll its magwell toward the camera so the swap is in view
  const P = TUNE.magP || [-0.07, 0.075, -0.03], R = TUNE.magR || [14 * D, 16 * D, c];
  const Pb = [P[0], P[1] + 0.015, P[2]], Rb = [R[0] - 3 * D, R[1], R[2] * 0.95];
  const gun = [
    rest(0), [0.1, P, R], [0.6, P, R],
    [0.645, Pb, Rb, "out"], [0.7, P, R],
    [0.85, [P[0] * 0.4, P[1] * 0.4, 0], [R[0] * 0.4, R[1] * 0.4, R[2] * 0.4]], rest(1, "back"),
  ];
  const OFFR = [0.5, 0.2, -0.3];
  const item = {
    part: "mag",
    keys: [[0, "rest"], [0.22, "rest"], [0.3, { d: 0.16 }, "in"], [0.42, { g: [OFF[0] + 0.05, OFF[1], OFF[2]], r: OFFR }],
      [0.47, { g: [OFF[0] + 0.05, OFF[1], OFF[2]], r: OFFR }], [0.58, { d: 0.06 }, "out"], [0.62, { d: 0.05 }], [0.66, "rest", "in"]],
    vis: E ? [[0, true], [0.3, false], [0.42, true]] : [[0, true]],
  };
  const L = [[0, "lg"], [0.1, "lg"], [0.22, { item: 1, pose: "pinch" }], [0.665, { item: 1, pose: "pinch" }],
    [0.685, { item: 1, pose: "palm", go: [0, -0.035, 0] }, "out"], [0.7, { item: 1, pose: "palm", go: [0, -0.012, 0] }, "in"]];
  const parts = {};
  const ev = [[0.26, "snd", "mag_out"], [0.655, "snd", "mag_in"], [0.7, "snd", "mag_slap"]];
  if (E) {
    ev.push([0.3, "drop", "mag"]);
    if (o.boltSlap) {
      // frittata: the bolt is locked back; L palm slaps the release
      parts.bolt = [[0, 1], [0.76, 1], [0.79, 0, "in"]];
      L.push([0.75, { s: "chargeGrip", pose: "palm", go: [-0.03, 0, 0] }], [0.78, { s: "chargeGrip", pose: "palm" }, "in"], [0.81, { s: "chargeGrip", pose: "palm", go: [-0.04, 0.01, 0] }, "out"]);
      ev.push([0.785, "snd", "bolt"]);
    } else if (o.slap) {
      // poacher HK slap: pull the cocking tube back, then slap it down
      parts.bolt = [[0, 0], [0.75, 0], [0.79, 1, "out"], [0.82, 1], [0.835, 0, "in"]];
      L.push([0.75, { s: "chargeGrip", pose: "pinch" }], [0.82, { s: "chargeGrip", pose: "pinch" }], [0.835, { s: "chargeGrip", pose: "palm", go: [0, 0.02, 0] }, "in"], [0.85, { s: "chargeGrip", pose: "palm", go: [-0.02, 0.05, 0] }, "out"]);
      ev.push([0.79, "snd", "bolt"], [0.835, "snd", "mag_slap"]);
    } else {
      parts.bolt = [[0, 0], [0.77, 0], [0.8, 1, "out"], [0.815, 0, "in"]];
      L.push([0.765, { s: "chargeGrip", pose: "pinch" }], [0.8, { s: "chargeGrip", pose: "pinch" }], [0.83, { s: "chargeGrip", pose: "open", go: [-0.02, 0.03, 0.05] }, "out"]);
      ev.push([0.8, "snd", "bolt"]);
    }
    L.push([0.92, "lg"], [1, "lg"]);
  } else {
    L.push([0.85, "lg"], [1, "lg"]);
  }
  return { name: "reload", gun, L, R: [[0, "rg"], [1, "rg"]], parts, item, ev };
}

function pistolReload(o) {
  const E = !!o.empty, c = TUNE.pistolCant ?? -28 * D;
  const P = TUNE.pistolP || [-0.04, 0.06, 0.0], R = TUNE.pistolR || [18 * D, 14 * D, c];
  const gun = [rest(0), [0.1, P, R], [0.58, P, R], [0.6, [0, 0.032, 0], [3 * D, 0, c], "out"], [0.66, P, R],
    [0.8, [0, 0.012, 0], [3 * D, 0, c * 0.5]], rest(1, "back")];
  const OFFR = [0.3, 0.4, -0.5];
  const item = {
    part: "mag",
    keys: [[0, "rest"], [0.16, "rest"], [0.19, { d: 0.05 }, "in"], [0.3, { g: [OFF[0], OFF[1], OFF[2]], r: OFFR }],
      [0.38, { g: [OFF[0], OFF[1], OFF[2]], r: OFFR }], [0.52, { d: 0.06 }, "out"], [0.56, { d: 0.05 }], [0.61, "rest", "in"]],
    vis: [[0, true], [0.19, false], [0.36, true]],
  };
  const L = [[0, "lg"], [0.14, "lg"], [0.3, { item: 1, pose: "pinch" }], [0.615, { item: 1, pose: "pinch" }],
    [0.635, { item: 1, pose: "palm", go: [0, -0.03, 0] }, "out"], [0.655, { item: 1, pose: "palm", go: [0, -0.01, 0] }, "in"]];
  const ev = [[0.18, "snd", "mag_out"], [0.19, "drop", "mag"], [0.6, "snd", "mag_in"]];
  const parts = {};
  if (E) {
    parts.slide = [[0, 1], [0.7, 1], [0.735, 1.12, "out"], [0.755, 0, "in"]];
    L.push([0.69, { s: "chargeGrip", pose: "pinch" }], [0.735, { s: "chargeGrip", pose: "pinch" }], [0.77, { s: "chargeGrip", pose: "open", go: [-0.03, 0.03, 0.06] }, "out"]);
    ev.push([0.74, "snd", "slide"]);
    L.push([0.9, "lg"], [1, "lg"]);
  } else {
    L.push([0.8, "lg"], [1, "lg"]);
  }
  return { name: "reload", gun, L, R: [[0, "rg"], [1, "rg"]], parts, item, ev };
}

/** Pump shotgun: shells pushed one by one into the loading gate. n >= 1 shells. */
function shellReload(o) {
  const n = Math.max(1, o.n | 0), E = !!o.empty, c = TUNE.shellCant ?? -58 * D;
  // roll the loading gate (under the receiver) toward the camera
  const P = TUNE.shellP || [-0.07, 0.085, 0.0], R = TUNE.shellR || [16 * D, 14 * D, c];
  const gun = [rest(0), [0.1, P, R]];
  // fixed per-shell tempo (the sim reload always lasts reloadTime): a short top-up waits on the raised gun first
  const span = Math.min(0.76 / n, 0.16), t0 = 0.86 - n * span;
  const PORT_OUT = { s: "loadPort", o: [0, 0, 0.075], r: [0, 0, 0] };
  const PORT_IN = { s: "loadPort", o: [0, 0, -0.035], r: [0, 0, 0] };
  const OFFP = { g: [OFF[0] + 0.04, OFF[1] + 0.05, OFF[2] - 0.1], r: [0.6, 0.3, 0] };
  const keys = [[0, OFFP]], vis = [[0, false]], ev = [];
  const L = [[0, "lg"], [Math.max(0.1, t0 - 0.12), "lg"], [t0 + 0.1 * span, { g: OFFP.g, r: OFFP.r, pose: "pinch" }]];
  for (let i = 0; i < n; i++) {
    const a = t0 + i * span, u = (x) => a + x * span;
    keys.push([u(0.12), OFFP], [u(0.35), PORT_OUT, "out"], [u(0.72), PORT_IN, "in"], [u(0.82), PORT_IN]);
    if (i < n - 1) keys.push([u(1), OFFP, "s"]);
    vis.push([u(0.02), true], [u(0.76), false]);
    if (i === 0) L.push([u(0.3), { item: 1, pose: "pinch" }]);
    L.push([u(0.72), { item: 1, pose: "pinch" }], [u(0.8), { item: 1, pose: "palm", go: [0, -0.02, 0.01] }, "out"]);
    if (i < n - 1) L.push([u(0.9), { item: 1, pose: "pinch" }]);
    gun.push([u(0.7), P, R], [u(0.75), [P[0], P[1] + 0.012, P[2]], [R[0] - 2.5 * D, 0, c], "out"], [u(0.85), P, R]);
    ev.push([u(0.7), "snd", "shell_in"]);
  }
  gun.push([0.86, P, R]);
  const parts = {};
  if (E) {
    L.push([0.89, "lg"]);
    parts.pump = [[0, 0], [0.9, 0], [0.925, 1, "out"], [0.95, 0, "in"]];
    ev.push([0.91, "snd", "pump"]);
    gun.push([0.9, [-0.01, 0.015, 0.01], [3 * D, 0, c * 0.5]], [0.95, [-0.01, 0.015, 0.0], [6 * D, 0, c * 0.4]]);
  } else {
    L.push([0.92, "lg"]);
  }
  L.push([1, "lg"]);
  gun.push(rest(1, "back"));
  return { name: "reload", gun, L, R: [[0, "rg"], [1, "rg"]], parts, item: { part: "shell", keys, vis }, ev };
}

/** Bolt sniper with a 4-round stripper clip. */
function clipReload(o) {
  const E = !!o.empty, c = TUNE.clipCant ?? 22 * D;
  // the clip guide is on top: raise and roll the top toward the camera
  const P = TUNE.clipP || [-0.06, 0.04, -0.07], R = TUNE.clipR || [8 * D, 12 * D, c];
  const gun = [rest(0), [0.08, P, R], [0.46, P, R], [0.5, [0, 0.012, 0], [2 * D, 0, c], "out"], [0.54, P, R],
    [0.58, [0, 0.012, 0], [2 * D, 0, c], "out"], [0.62, P, R], [0.84, P, R], rest(1, "back")];
  const ABOVE = { g: [0, 0.235, 0.0] }, SEAT = "rest", PUSHED = { g: [0, 0.17, 0.0] };
  const OFFC = { g: [OFF[0], OFF[1] + 0.1, OFF[2] - 0.05], r: [0.4, 0.2, 0.6] };
  const FLICK = { g: [0.22, 0.42, 0.05], r: [0.6, 0.9, -1.4] };
  const item = {
    part: "clip",
    keys: [[0, OFFC], [0.29, OFFC], [0.4, ABOVE, "out"], [0.46, SEAT], [0.5, { g: [0, 0.155, 0] }], [0.54, { g: [0, 0.16, 0] }],
      [0.58, { g: [0, 0.148, 0] }], [0.62, PUSHED], [0.66, FLICK, "out"]],
    vis: [[0, false], [0.27, true], [0.66, false]],
  };
  const L = [[0, "lg"], [0.24, "lg"], [0.31, { item: 1, pose: "pinch" }], [0.46, { item: 1, pose: "pinch" }],
    [0.5, { item: 1, pose: "point", go: [0, -0.012, 0] }, "in"], [0.54, { item: 1, pose: "point" }], [0.58, { item: 1, pose: "point", go: [0, -0.012, 0] }, "in"],
    [0.62, { item: 1, pose: "pinch" }], [0.66, { item: 1, pose: "open" }, "out"], [0.8, "lg"], [1, "lg"]];
  const Rh = [[0, "rg"], [0.08, { s: "chargeGrip", pose: "pinch" }], [0.84, { s: "chargeGrip", pose: "pinch" }], [0.96, "rg"], [1, "rg"]];
  const parts = {
    lift: [[0, 0], [0.08, 0], [0.16, 1, "out"], [0.78, 1], [0.84, 0, "in"]],
    bolt: [[0, 0], [0.16, 0], [0.24, 1, "out"], [0.7, 1], [0.78, 0, "in"]],
  };
  const ev = [[0.2, "snd", "bolt"], [0.5, "snd", "shell_in"], [0.58, "snd", "shell_in"], [0.65, "drop", "clip"], [0.75, "snd", "bolt"]];
  if (E) ev.push([0.22, "eject", "brass"]);
  return { name: "reload", gun, L, R: Rh, parts, item, ev };
}

/** Launcher front load: the rocket goes in tail first at the muzzle. */
function rocketReload() {
  const P = TUNE.rocketP || [-0.06, 0.03, -0.02], R = TUNE.rocketR || [-6 * D, 35 * D, 8 * D];
  const gun = [rest(0), [0.14, P, R], [0.64, P, R], [0.68, [P[0], P[1], P[2] + 0.02], [R[0] - 2 * D, R[1], R[2]], "out"], [0.72, P, R],
    [0.86, [P[0] * 0.5, 0, 0], [R[0] * 0.4, R[1] * 0.4, 0]], rest(1, "back")];
  const OFFR = { g: [OFF[0] - 0.05, OFF[1], OFF[2] - 0.3], r: [0.5, 0.0, 0.3] };
  const item = {
    part: "rocket",
    keys: [[0, OFFR], [0.3, OFFR], [0.46, { d: 0.3 }, "out"], [0.48, { d: 0.28 }], [0.66, "rest", "s"]],
    vis: [[0, false], [0.27, true]],
  };
  const L = [[0, "lg"], [0.14, "lg"], [0.3, { item: 1, pose: "grip" }], [0.64, { item: 1, pose: "grip" }],
    [0.68, { item: 1, pose: "palm", go: [0, 0.0, -0.03] }, "out"], [0.72, { item: 1, pose: "palm" }], [0.86, "lg"], [1, "lg"]];
  const ev = [[0.67, "snd", "rocket_load"]];
  return { name: "reload", gun, L, R: [[0, "rg"], [1, "rg"]], parts: {}, item, ev };
}

/**
 * Reload timeline for a weapon. style from weapons.json reloadStyle; ctx {id, empty, n (shells to load)}.
 */
export function reloadTimeline(style, ctx = {}) {
  switch (style) {
    case "shells": return shellReload(ctx);
    case "clip": return clipReload(ctx);
    case "rocket": return rocketReload(ctx);
    case "pistol": return pistolReload(ctx);
    default: {
      const id = ctx.id || "";
      const cant = TUNE.cant ?? (id === "poacher" ? -32 * D : id === "overeasy" ? -38 * D : -35 * D);
      return magReload({ empty: ctx.empty, cant, slap: id === "poacher", boltSlap: id === "frittata" });
    }
  }
}

// ----------------------------------------------------------------- post-shot cycles (seconds)

export function cycleTimeline(kind) {
  if (kind === "bolt") {
    return {
      name: "cycle", unit: "s", end: 0.9,
      gun: [rest(0), [0.25, [0, 0.01, 0], [2 * D, 0, -8 * D]], [0.72, [0, 0.01, 0], [2 * D, 0, -8 * D]], rest(0.9, "back")],
      R: [[0, "rg"], [0.18, "rg"], [0.3, { s: "chargeGrip", pose: "pinch" }], [0.72, { s: "chargeGrip", pose: "pinch" }], [0.86, "rg"], [0.9, "rg"]],
      L: [[0, "lg"], [0.9, "lg"]],
      parts: { lift: [[0, 0], [0.3, 0], [0.4, 1, "out"], [0.64, 1], [0.72, 0, "in"]], bolt: [[0, 0], [0.4, 0], [0.52, 1, "out"], [0.64, 0, "in"]] },
      ev: [[0.44, "snd", "bolt"], [0.48, "eject", "brass"]],
    };
  }
  if (kind === "pump") {
    return {
      name: "cycle", unit: "s", end: 0.5,
      gun: [rest(0), [0.12, [0, 0, 0], [0, 0, 0]], [0.3, [0, 0.005, 0.01], [4 * D, 0, 2 * D]], rest(0.5, "back")],
      R: [[0, "rg"], [0.5, "rg"]], L: [[0, "lg"], [0.5, "lg"]],
      parts: { pump: [[0, 0], [0.12, 0], [0.3, 1, "out"], [0.45, 0, "in"]] },
      ev: [[0.14, "snd", "pump"], [0.25, "eject", "shell"]],
    };
  }
  return null;
}

// ----------------------------------------------------------------- melee (seconds; w = windup, cd = cooldown)

// R hand view-space poses per swing type: v = hand position (metres), head = where the melee points,
// back = where the back of the glove faces. The melee is held at points.hold (handle out of the thumb side).
const SW = {
  sweep: {
    rest: { v: [0.22, -0.27, -0.45], head: [-0.25, 0.85, -0.45], back: [1, 0, 0.3] },
    wind: { v: [0.27, -0.14, -0.44], head: [0.7, 0.55, 0.2], back: [0, 0.3, 1] },
    wind2: { v: [0.29, -0.12, -0.43], head: [0.72, 0.5, 0.3], back: [0, 0.3, 1] },
    strike: { v: [-0.04, -0.14, -0.47], head: [-0.85, 0.3, -0.45], back: [0, 0.6, -1] },
    follow: { v: [-0.25, -0.19, -0.43], head: [-0.85, 0.15, 0.3], back: [0, 0.6, -1] },
    low: { v: [-0.05, -0.5, -0.35], head: [-0.4, 0.6, -0.4], back: [1, 0, 0.3] },
  },
  overhead: {
    rest: { v: [0.2, -0.28, -0.45], head: [-0.1, 0.75, -0.65], back: [1, 0, 0] },
    wind: { v: [0.2, -0.07, -0.42], head: [0.15, 0.75, 0.6], back: [1, 0, 0] },
    wind2: { v: [0.2, -0.05, -0.41], head: [0.12, 0.65, 0.75], back: [1, 0, 0] },
    // the pan comes down big and close, right onto the crosshair, then bounces off
    strike: { v: [0.05, 0.03, -0.29], head: [0, -0.2, -0.98], back: [1, 0, 0] },
    follow: { v: [0.06, -0.12, -0.33], head: [0, -0.7, -0.7], back: [1, 0, 0] },
    low: { v: [0.15, -0.5, -0.4], head: [0, 0.5, -0.85], back: [1, 0, 0] },
  },
  jab: {
    rest: { v: [0.21, -0.25, -0.42], head: [-0.2, 0.55, -0.8], back: [1, 0.3, 0] },
    wind: { v: [0.22, -0.2, -0.36], head: [-0.2, 0.6, -0.75], back: [1, 0.3, 0] },
    wind2: { v: [0.22, -0.19, -0.34], head: [-0.2, 0.6, -0.75], back: [1, 0.3, 0] },
    strike: { v: [0.07, -0.13, -0.56], head: [-0.4, 0.45, -0.8], back: [0.4, 1, 0] },
    follow: { v: [0.1, -0.15, -0.5], head: [-0.35, 0.5, -0.8], back: [0.6, 1, 0] },
    low: { v: [0.2, -0.46, -0.36], head: [-0.1, 0.6, -0.8], back: [1, 0.3, 0] },
  },
  uppercut: {
    rest: { v: [0.21, -0.27, -0.44], head: [-0.15, 0.6, -0.8], back: [1, 0, 0] },
    wind: { v: [0.18, -0.27, -0.42], head: [-0.1, -0.15, -1], back: [1, 0, 0] },
    wind2: { v: [0.17, -0.29, -0.41], head: [-0.1, -0.2, -1], back: [1, 0, 0] },
    strike: { v: [0.07, -0.1, -0.46], head: [-0.1, 0.8, -0.6], back: [1, 0, 0] },
    follow: { v: [0.06, -0.02, -0.44], head: [-0.05, 0.95, 0.3], back: [1, 0, 0] },
    low: { v: [0.16, -0.55, -0.38], head: [-0.1, 0.5, -0.85], back: [1, 0, 0] },
  },
};

export function meleeTimeline(swing, w = 0.1, cd = 0.65) {
  const S = (TUNE.sw && TUNE.sw[swing]) || SW[swing] || SW.sweep;
  w = Math.max(0.03, w);
  cd = Math.max(w + 0.3, cd);
  const V = (k, pose = "fist") => Object.assign({ pose }, S[k]);
  const ws = Math.min(0.07, w * 0.5);
  // contact pose ON the hit: the sim's meleeHit, the vm.meleeHit recoil and the 'strike' event all fire at w.
  // A windup too short for a cock-back (whisk, spatula) strikes straight from the ready pose.
  const R = [[0, "rg"], [ws, V("rest"), "out"]];
  if (w - ws >= 0.05) R.push([Math.max(ws + 0.01, w - 0.06), V("wind"), "s"], [w - 0.04, V("wind2"), "in"]);
  R.push(
    [w, V("strike"), "in"],
    [w + 0.2, V("follow"), "out"],
    [Math.max(w + 0.28, cd - 0.13), V("low"), "s"],
    [cd, "rg", "s"],
  );
  const down = [0.02, -0.25, 0.02], roll = [-0.15, 0.1, -0.4];
  const gun = [rest(0), [0.08, down, roll, "out"], [Math.max(0.09, cd - 0.15), down, roll], rest(cd, "back")];
  if (swing === "overhead") gun.splice(2, 0, [w, [0.02, -0.28, 0.02], [-0.2, 0.1, -0.45], "in"]);
  const ev = [[w, "strike", ""]];
  return {
    name: "melee", unit: "s", end: cd, strikeAt: w,
    gun, R, L: [[0, "lg"], [cd, "lg"]], parts: {},
    show: { melee: [[0, false], [ws * 0.5, true], [cd - 0.1, false]] }, ev,
  };
}

// ----------------------------------------------------------------- grenade (0.6 s, normalised)

export function grenadeTimeline() {
  // The sim throws on the key press and the predicted quiche appears 0.08 s later (game.js _predictProjectile
  // showAt), so the whole throw happens up front: a short cock back, the forward release at 0.075 s (the in-hand
  // quiche hides on the same frame the flying one shows), then a long follow-through and recovery.
  const T = 0.6, s = (x) => x / T, REL = s(0.075);
  const v = (p, r, pose = "grip") => ({ v: p, r, pose });
  const L = [
    [0, "lg"],
    [s(0.035), v([-0.23, -0.1, -0.33], [0.9, -0.6, -0.9]), "out"],
    [REL, v([-0.08, -0.11, -0.6], [-0.2, -0.25, -0.75], "open"), "s"],
    [s(0.16), v([-0.02, -0.2, -0.72], [-0.45, -0.2, -0.7], "open"), "out"],
    [s(0.34), v([-0.2, -0.52, -0.42], [0.2, -0.3, -0.5], "open")],
    [1, "lg"],
  ];
  return {
    name: "grenade", dur: T,
    gun: [rest(0), [s(0.04), [0.012, -0.02, 0.012], [-2 * D, 0, -3 * D], "out"], [s(0.09), [0.004, -0.03, -0.004], [-4 * D, 0, -2 * D], "in"],
      [s(0.34), [0.01, -0.02, 0.01], [-2 * D, 0, -3 * D]], rest(1, "back")],
    L, R: [[0, "rg"], [1, "rg"]], parts: {},
    show: { nade: [[0, true], [REL, false]] },
    ev: [[REL, "release", ""]],
  };
}

// ----------------------------------------------------------------- switch (normalised over switchTime)

export const SWAP_AT = 0.35;
export function switchTimeline() {
  const lowP = [0.02, -0.3, 0.05], lowR = [-45 * D, 0.1, -0.2];
  return {
    name: "switch",
    gun: [rest(0), [SWAP_AT, lowP, lowR, "in"], [SWAP_AT + 0.001, lowP, lowR, "lin"], rest(1, "back")],
    L: [[0, "lg"], [1, "lg"]], R: [[0, "rg"], [1, "rg"]], parts: {},
    ev: [[SWAP_AT, "swap", ""]],
  };
}

/** Draw only (spawn): the new gun rises from below. */
export function drawTimeline() {
  const lowP = [0.02, -0.3, 0.05], lowR = [-45 * D, 0.1, -0.2];
  return { name: "switch", gun: [[0, lowP, lowR], rest(1, "back")], L: [[0, "lg"], [1, "lg"]], R: [[0, "rg"], [1, "rg"]], parts: {}, ev: [] };
}
