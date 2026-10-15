// 2D SVG egg with cosmetics (colour, hat, stamp). Instant, no WebGL: used on the home screen,
// in the cosmetic pickers and as the loadout preview fallback.

import { s } from "./dom.js";

let uid = 0;
const EGG = "M100 62C150 62 172 132 172 170C172 212 140 238 100 238C60 238 28 212 28 170C28 132 50 62 100 62Z";
const INK = "#232129";

function shade(hex, amt) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(c + (amt > 0 ? (255 - c) * amt : c * amt))));
  const r = f(n >> 16), g = f((n >> 8) & 255), b = f(n & 255);
  return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

const SPECKS = (() => {
  let x = 12345;
  const rnd = () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; };
  const out = [];
  for (let i = 0; i < 34; i++) out.push([30 + rnd() * 140, 66 + rnd() * 170, 2 + rnd() * 4]);
  return out;
})();

const st = { stroke: INK, "stroke-width": 4, "stroke-linejoin": "round", "stroke-linecap": "round" };

function hatShape(def) {
  if (!def || def.shape === "none") return null;
  const c = def.colors || ["#888888"];
  const c0 = c[0], c1 = c[1] || shade(c0, -0.25), c2 = c[2] || c1;
  const g = s("g", { class: "hat" });
  const add = (tag, attrs) => g.appendChild(s(tag, Object.assign({}, st, attrs)));
  switch (def.shape) {
    case "toque":
      add("path", { d: "M70 70C52 66 52 40 72 40C70 22 92 16 100 28C110 14 132 22 128 40C148 40 148 66 130 70Z", fill: c0 });
      add("rect", { x: 70, y: 60, width: 60, height: 22, rx: 4, fill: shade(c0, -0.06) });
      add("path", { d: "M88 50V60M100 46V60M112 50V60", fill: "none", "stroke-width": 2.5, opacity: 0.4 });
      break;
    case "cap":
      add("path", { d: "M62 86Q62 42 100 40Q138 42 138 86Z", fill: c0 });
      add("path", { d: "M100 40V86M80 46Q76 64 76 86M120 46Q124 64 124 86", fill: "none", "stroke-width": 2.5, opacity: 0.35 });
      add("path", { d: "M56 86Q100 108 144 86Q100 94 56 86Z", fill: shade(c0, -0.15) });
      add("circle", { cx: 100, cy: 41, r: 5, fill: c1 });
      break;
    case "beanie":
      add("path", { d: "M62 88Q62 34 100 32Q138 34 138 88Z", fill: c0 });
      add("rect", { x: 58, y: 76, width: 84, height: 18, rx: 7, fill: c1 });
      add("path", { d: "M72 79v12M86 79v12M100 79v12M114 79v12M128 79v12", fill: "none", "stroke-width": 2, opacity: 0.35 });
      add("circle", { cx: 100, cy: 28, r: 11, fill: c1 });
      break;
    case "tophat":
      add("rect", { x: 72, y: 14, width: 56, height: 62, rx: 4, fill: c0 });
      add("rect", { x: 72, y: 56, width: 56, height: 12, fill: c1, "stroke-width": 3 });
      add("ellipse", { cx: 100, cy: 76, rx: 50, ry: 9, fill: c0 });
      add("path", { d: "M80 22v28", stroke: "#ffffff", "stroke-width": 3, opacity: 0.25, fill: "none" });
      break;
    case "cowboy":
      add("path", { d: "M66 78Q62 38 86 34Q100 46 114 34Q138 38 134 78Z", fill: shade(c0, -0.1) });
      add("rect", { x: 66, y: 64, width: 68, height: 10, fill: shade(c0, -0.45), "stroke-width": 3 });
      add("path", { d: "M26 74Q44 96 100 86Q156 96 174 74Q160 68 140 74Q100 84 60 74Q40 68 26 74Z", fill: c0 });
      break;
    case "crown":
      add("path", { d: "M64 80V38L80 56L92 28L100 48L108 28L120 56L136 38V80Z", fill: c0 });
      add("rect", { x: 64, y: 68, width: 72, height: 12, fill: shade(c0, -0.15), "stroke-width": 3 });
      add("circle", { cx: 82, cy: 74, r: 4, fill: "#e63946", "stroke-width": 2 });
      add("circle", { cx: 100, cy: 74, r: 4, fill: "#4aa8ff", "stroke-width": 2 });
      add("circle", { cx: 118, cy: 74, r: 4, fill: "#2a9d8f", "stroke-width": 2 });
      break;
    case "halo":
      g.appendChild(s("ellipse", { cx: 100, cy: 38, rx: 36, ry: 10, fill: "none", stroke: c0, "stroke-width": 16, opacity: 0.3 }));
      g.appendChild(s("ellipse", { cx: 100, cy: 38, rx: 36, ry: 10, fill: "none", stroke: INK, "stroke-width": 10 }));
      g.appendChild(s("ellipse", { cx: 100, cy: 38, rx: 36, ry: 10, fill: "none", stroke: c0, "stroke-width": 5 }));
      break;
    case "propeller":
      add("path", { d: "M66 80Q66 46 100 44Q134 46 134 80Z", fill: c0 });
      add("path", { d: "M100 44Q88 60 88 80H112Q112 60 100 44Z", fill: c1, "stroke-width": 2.5 });
      add("path", { d: "M100 44V30", fill: "none" });
      add("ellipse", { cx: 84, cy: 28, rx: 17, ry: 5, fill: c2, class: "spin" });
      add("ellipse", { cx: 116, cy: 28, rx: 17, ry: 5, fill: c0, class: "spin" });
      add("circle", { cx: 100, cy: 28, r: 4, fill: c1, "stroke-width": 2.5 });
      break;
    case "viking":
      add("path", { d: "M64 66Q34 62 34 24Q48 50 72 56Z", fill: c1 });
      add("path", { d: "M136 66Q166 62 166 24Q152 50 128 56Z", fill: c1 });
      add("path", { d: "M60 86Q60 38 100 36Q140 38 140 86Z", fill: c0 });
      add("rect", { x: 56, y: 76, width: 88, height: 14, rx: 4, fill: shade(c0, -0.2), "stroke-width": 3 });
      add("path", { d: "M100 38V76", fill: "none", "stroke-width": 3 });
      for (const x of [70, 86, 114, 130]) g.appendChild(s("circle", { cx: x, cy: 83, r: 2.2, fill: INK }));
      break;
    case "sprout":
      add("path", { d: "M100 66Q97 52 102 36", fill: "none", stroke: shade(c0, -0.35), "stroke-width": 6 });
      add("path", { d: "M100 66Q97 52 102 36", fill: "none", stroke: c0, "stroke-width": 2.5 });
      add("path", { d: "M101 46Q82 26 68 40Q84 54 101 46Z", fill: c0, "stroke-width": 3.5 });
      add("path", { d: "M102 40Q122 16 138 30Q122 48 102 40Z", fill: c0, "stroke-width": 3.5 });
      break;
    case "headband":
      add("path", { d: "M150 102L176 92L170 110Z", fill: c0, "stroke-width": 3 });
      add("path", { d: "M150 108L178 118L162 126Z", fill: c0, "stroke-width": 3 });
      add("path", { d: "M44 104Q100 84 156 104L158 118Q100 98 42 118Z", fill: c0 });
      break;
    case "pot":
      add("rect", { x: 136, y: 48, width: 50, height: 10, rx: 5, fill: c1 });
      add("path", { d: "M62 86L66 34H134L138 86Z", fill: c0 });
      add("ellipse", { cx: 100, cy: 34, rx: 34, ry: 6, fill: shade(c0, 0.25) });
      add("rect", { x: 58, y: 78, width: 84, height: 10, rx: 4, fill: shade(c0, -0.15), "stroke-width": 3 });
      break;
    case "beret":
      add("ellipse", { cx: 96, cy: 64, rx: 52, ry: 17, fill: c0, transform: "rotate(-8 96 64)" });
      add("circle", { cx: 102, cy: 46, r: 4.5, fill: shade(c0, -0.2), "stroke-width": 3 });
      break;
    default:
      return null;
  }
  return g;
}

function stampShape(def, eggClip) {
  if (!def || !def.glyph) return null;
  const col = def.color || INK;
  const g = s("g", { class: "stamp", transform: "translate(100 182)" });
  const add = (tag, attrs) => g.appendChild(s(tag, attrs));
  switch (def.glyph) {
    case "star": {
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 9 : 22, a = -Math.PI / 2 + (i * Math.PI) / 5;
        pts.push(`${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`);
      }
      add("polygon", { points: pts.join(" "), fill: col, stroke: shade(col, -0.35), "stroke-width": 2, "stroke-linejoin": "round" });
      break;
    }
    case "heart":
      add("path", { d: "M0 16C-24 0 -20 -20 -7 -18C-2 -17 0 -13 0 -11C0 -13 2 -17 7 -18C20 -20 24 0 0 16Z", fill: col, stroke: shade(col, -0.35), "stroke-width": 2 });
      break;
    case "bolt":
      add("polygon", { points: "-4,-22 12,-22 3,-5 14,-5 -7,22 -1,2 -11,2", fill: col, stroke: shade(col, -0.4), "stroke-width": 2, "stroke-linejoin": "round" });
      break;
    case "skull":
      add("path", { d: "M-16 -2C-16 -16 -8 -21 0 -21C8 -21 16 -16 16 -2C16 5 12 8 10 9V16H-10V9C-12 8 -16 5 -16 -2Z", fill: col });
      add("circle", { cx: -6.5, cy: -3, r: 4.5, fill: "#ffffff" });
      add("circle", { cx: 6.5, cy: -3, r: 4.5, fill: "#ffffff" });
      add("path", { d: "M-4 16V11M0 16V11M4 16V11", stroke: "#ffffff", "stroke-width": 1.8 });
      break;
    case "flame":
      add("path", { d: "M0 -22C11 -9 15 0 11 11C9 17 4 19 0 19C-7 19 -13 15 -13 6C-13 -2 -7 -5 -4 -11C-2 -5 2 -3 2 -7C2 -13 0 -17 0 -22Z", fill: col });
      add("path", { d: "M0 2C5 7 5 13 0 15C-5 13 -5 7 0 2Z", fill: "#ffd166" });
      break;
    case "leaf":
      add("path", { d: "M-15 16C-17 -10 6 -21 17 -19C17 1 4 18 -15 16Z", fill: col });
      add("path", { d: "M-12 13Q2 0 12 -14", stroke: shade(col, 0.4), "stroke-width": 2, fill: "none" });
      break;
    case "target":
      add("circle", { r: 19, fill: "#ffffff", stroke: col, "stroke-width": 5 });
      add("circle", { r: 10, fill: "none", stroke: col, "stroke-width": 5 });
      add("circle", { r: 3.5, fill: col });
      break;
    case "stripes": {
      const sg = s("g", { "clip-path": eggClip });
      sg.appendChild(s("rect", { x: 82, y: 50, width: 10, height: 200, fill: col }));
      sg.appendChild(s("rect", { x: 108, y: 50, width: 10, height: 200, fill: col }));
      return sg;
    }
    case "smile":
      add("circle", { r: 19, fill: "#ffd60a", stroke: col, "stroke-width": 3 });
      add("circle", { cx: -6, cy: -5, r: 2.6, fill: col });
      add("circle", { cx: 6, cy: -5, r: 2.6, fill: col });
      add("path", { d: "M-9 4Q0 13 9 4", stroke: col, "stroke-width": 3, fill: "none", "stroke-linecap": "round" });
      break;
    case "seven":
      add("path", { d: "M-11 -16H11L-3 18", stroke: col, "stroke-width": 8, fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" });
      break;
    default:
      return null;
  }
  return g;
}

/**
 * Build an egg SVG.
 * @param {object} cm   cosmetics.json
 * @param {object} cos  {hat,color,stamp}
 * @param {object} [o]  {only: "hat"|"stamp"|"color" (thumbnail focusing on one part), title, eyes}
 */
export function eggSVG(cm, cos = {}, o = {}) {
  const id = "e" + (++uid);
  const color = cm.colors.find((c) => c.id === cos.color) || cm.colors[0];
  const hat = cm.hats.find((h) => h.id === cos.hat);
  const stamp = cm.stamps.find((x) => x.id === cos.stamp);
  const vb = o.only === "hat" ? "20 0 160 130" : o.only === "stamp" ? "50 130 100 100" : "0 0 200 250";
  const root = s("svg", { viewBox: vb, class: "egg2d", role: o.title ? "img" : "presentation", "aria-hidden": o.title ? null : "true" });
  if (o.title) root.appendChild(s("title", {}, o.title));
  const defs = s("defs");
  defs.appendChild(s("clipPath", { id: id + "c" }, s("path", { d: EGG })));
  defs.appendChild(s("radialGradient", { id: id + "h", cx: "0.36", cy: "0.3", r: "0.75" },
    s("stop", { offset: "0", "stop-color": "#ffffff", "stop-opacity": "0.55" }),
    s("stop", { offset: "0.45", "stop-color": "#ffffff", "stop-opacity": "0" }),
    s("stop", { offset: "1", "stop-color": "#000000", "stop-opacity": "0.22" })));
  root.appendChild(defs);
  const clip = `url(#${id}c)`;
  if (o.only !== "hat") {
    root.appendChild(s("ellipse", { cx: 100, cy: 240, rx: 58, ry: 7, fill: "#000", opacity: o.only ? 0 : 0.15 }));
    root.appendChild(s("path", { d: EGG, fill: color.shell }));
    if (color.speckle) {
      const g = s("g", { "clip-path": clip, fill: color.speckle, opacity: 0.85 });
      for (const [x, y, r] of SPECKS) g.appendChild(s("ellipse", { cx: x.toFixed(1), cy: y.toFixed(1), rx: r.toFixed(1), ry: (r * 0.75).toFixed(1) }));
      root.appendChild(g);
    }
    const sp = stampShape(stamp, clip);
    if (sp) root.appendChild(sp);
    root.appendChild(s("path", { d: EGG, fill: `url(#${id}h)` }));
    if (o.eyes !== false) {
      for (const x of [80, 120]) {
        root.appendChild(s("ellipse", { cx: x, cy: 128, rx: 7.5, ry: 11, fill: INK }));
        root.appendChild(s("circle", { cx: x + 2.5, cy: 123, r: 2.6, fill: "#ffffff" }));
      }
    }
    root.appendChild(s("path", { d: EGG, fill: "none", stroke: INK, "stroke-width": 5 }));
  } else {
    root.appendChild(s("path", { d: EGG, fill: color.shell, stroke: INK, "stroke-width": 5, opacity: 0.35 }));
  }
  const hs = hatShape(hat);
  if (hs) root.appendChild(hs);
  return root;
}

/** Small colour swatch egg (no hat, no eyes). */
export function swatchSVG(color) {
  const root = s("svg", { viewBox: "20 52 160 196", class: "egg2d swatch", "aria-hidden": "true" });
  root.appendChild(s("path", { d: EGG, fill: color.shell, stroke: INK, "stroke-width": 8 }));
  if (color.speckle) {
    const g = s("g", { fill: color.speckle });
    for (const [x, y, r] of SPECKS.slice(0, 14)) {
      if (Math.hypot((x - 100) / 64, (y - 160) / 90) < 0.85) g.appendChild(s("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: (r * 1.4).toFixed(1) }));
    }
    root.appendChild(g);
  }
  return root;
}
