// Small inline SVG icons (weapon silhouettes + UI glyphs). All shapes are original.

import { s } from "./dom.js";

// [x, y, w, h, rx?] rectangles in a 120x40 box, side view facing right
const GUNS = {
  benedict: [[4, 14, 18, 10, 2], [20, 12, 52, 10], [72, 15, 32, 4], [44, 22, 9, 12], [26, 22, 7, 10], [40, 8, 14, 4]],
  deviler: [[2, 15, 22, 9, 2], [24, 13, 30, 9], [54, 13, 56, 4], [60, 18, 30, 5, 2], [28, 22, 7, 9]],
  poacher: [[26, 12, 40, 11, 2], [66, 15, 16, 4], [40, 23, 7, 14], [30, 23, 7, 9], [8, 14, 18, 3], [8, 14, 3, 9]],
  piercer: [[2, 14, 26, 10, 2], [28, 13, 36, 8], [64, 15, 52, 3], [34, 5, 30, 6, 3], [32, 21, 7, 10], [48, 21, 8, 7]],
  frittata: [[6, 13, 30, 11, 2], [36, 12, 34, 10], [70, 15, 30, 4], [16, 24, 9, 10], [44, 22, 7, 10], [46, 7, 18, 5]],
  overeasy: [[4, 14, 22, 9, 2], [26, 12, 44, 9], [70, 15, 40, 3], [36, 6, 22, 5, 2], [46, 21, 8, 10], [30, 21, 7, 10]],
  souffle: [[10, 10, 88, 14, 7], [40, 24, 8, 10], [30, 4, 10, 6], [94, 8, 10, 18, 3]],
  coddler: [[30, 12, 40, 9, 2], [32, 21, 10, 16, 2], [70, 14, 8, 4]],
};
const BY_CLASS = { "Assault Rifle": "benedict", Shotgun: "deviler", SMG: "poacher", Sniper: "piercer", "Burst Rifle": "frittata", Marksman: "overeasy", Launcher: "souffle", Pistol: "coddler" };

export function gunIcon(id, cls) {
  const parts = GUNS[id] || GUNS[BY_CLASS[cls]] || GUNS.benedict;
  const svg = s("svg", { viewBox: "0 0 120 40", class: "gun-icon", "aria-hidden": "true" });
  for (const [x, y, w, h, rx] of parts) svg.appendChild(s("rect", { x, y, width: w, height: h, rx: rx || 1.5, fill: "currentColor" }));
  return svg;
}

export function grenadeIcon() {
  return s("svg", { viewBox: "0 0 40 40", class: "mini-icon", "aria-hidden": "true" },
    s("ellipse", { cx: 20, cy: 23, rx: 11, ry: 13, fill: "currentColor" }),
    s("rect", { x: 15, y: 6, width: 10, height: 6, rx: 2, fill: "currentColor" }),
    s("path", { d: "M25 9Q32 6 31 14", stroke: "currentColor", "stroke-width": 2.5, fill: "none" }));
}

// Melee silhouettes, drawn lying flat (handle on the left) in a 120x40 box.
const rr = (x, y, w, hh, r) => `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${hh - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(hh - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}Z`;
const circ = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
const MELEES = {
  rollingpin: () => [
    s("rect", { x: 2, y: 16, width: 18, height: 8, rx: 4, fill: "currentColor" }),
    s("rect", { x: 18, y: 9, width: 84, height: 22, rx: 9, fill: "currentColor" }),
    s("rect", { x: 100, y: 16, width: 18, height: 8, rx: 4, fill: "currentColor" }),
  ],
  pan: () => [
    // leather-wrapped handle with a hanging hole, cast-iron skillet with a rim ring
    s("path", { d: rr(2, 16, 50, 8, 4) + circ(9, 20, 2), "fill-rule": "evenodd", fill: "currentColor" }),
    s("path", { d: circ(83, 20, 19) + circ(83, 20, 14.5), "fill-rule": "evenodd", fill: "currentColor" }),
    s("circle", { cx: 83, cy: 20, r: 12, fill: "currentColor", opacity: 0.55 }),
  ],
  whisk: () => [
    s("rect", { x: 2, y: 15.5, width: 42, height: 9, rx: 4.5, fill: "currentColor" }),
    ...[17, 11, 5].map((ry) => s("ellipse", { cx: 80, cy: 20, rx: 36, ry, fill: "none", stroke: "currentColor", "stroke-width": 2.6 })),
    s("rect", { x: 42, y: 17, width: 8, height: 6, rx: 2, fill: "currentColor" }),
  ],
  spatula: () => [
    s("rect", { x: 2, y: 16, width: 52, height: 8, rx: 4, fill: "currentColor" }),
    s("rect", { x: 52, y: 17.5, width: 14, height: 5, rx: 1.5, fill: "currentColor" }),
    s("path", { d: rr(64, 5, 54, 30, 7) + rr(73, 11, 36, 3.5, 1.7) + rr(73, 18.25, 36, 3.5, 1.7) + rr(73, 25.5, 36, 3.5, 1.7), "fill-rule": "evenodd", fill: "currentColor" }),
  ],
};

/**
 * Melee icon. meleeIcon(id) draws the square mini icon (the item tilted, for kit lists and the
 * kill feed); meleeIcon(id, {wide: true}) draws it lying flat in the 120x40 gun-icon box.
 * meleeIcon() with no id draws the rolling pin.
 */
export function meleeIcon(id = "rollingpin", { wide = false } = {}) {
  const parts = (MELEES[id] || MELEES.rollingpin)();
  if (wide) return s("svg", { viewBox: "0 0 120 40", class: "gun-icon melee-icon", "aria-hidden": "true" }, ...parts);
  return s("svg", { viewBox: "0 0 40 40", class: "mini-icon", "aria-hidden": "true" },
    s("g", { transform: "translate(20 20) rotate(-35) scale(0.31) translate(-60 -20)" }, ...parts));
}

export function skullIcon() {
  return s("svg", { viewBox: "0 0 24 24", class: "mini-icon", "aria-hidden": "true" },
    s("path", { d: "M12 2C6.5 2 4 6 4 10c0 3 1.6 4.6 3 5.3V19h10v-3.7c1.4-.7 3-2.3 3-5.3 0-4-2.5-8-8-8Z", fill: "currentColor" }),
    s("circle", { cx: 8.8, cy: 10.5, r: 2.2, fill: "var(--hud-bg, #232129)" }),
    s("circle", { cx: 15.2, cy: 10.5, r: 2.2, fill: "var(--hud-bg, #232129)" }));
}

export function crackIcon() {
  return s("svg", { viewBox: "0 0 24 24", class: "mini-icon hs-icon", "aria-hidden": "true" },
    s("path", { d: "M12 2C17 2 20 9 20 14c0 4.4-3.6 8-8 8s-8-3.6-8-8C4 9 7 2 12 2Z", fill: "currentColor" }),
    s("path", { d: "M5 11l3.5 2 2.5-3 2.5 3 2.5-2.5 3 1.5", stroke: "#232129", "stroke-width": 1.8, fill: "none", "stroke-linejoin": "round" }));
}

export function eggIcon(color = "currentColor") {
  return s("svg", { viewBox: "0 0 24 28", class: "mini-icon", "aria-hidden": "true" },
    s("path", { d: "M12 2C18 2 21 11 21 17c0 5-4 9-9 9s-9-4-9-9C3 11 6 2 12 2Z", fill: color, stroke: "#232129", "stroke-width": 2 }));
}
