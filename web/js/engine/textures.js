// Procedural canvas textures (no image assets). Textures are near-white detail maps
// that get multiplied by the material colour, so one texture serves many colours.
// Every texture is generated once and cached.

import * as THREE from "../../vendor/three.module.min.js";

const cache = new Map();

// Small deterministic RNG so textures look the same every load.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w, h = w) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}

function noise(ctx, w, h, r, amount, size = 1, base = 255) {
  for (let i = 0; i < (w * h) / (size * size) * 0.5; i++) {
    const v = Math.round(base - r() * amount);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(Math.floor(r() * w), Math.floor(r() * h), size, size);
  }
}

const gens = {
  plain(ctx, w, h, r) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); noise(ctx, w, h, r, 18, 2); },
  grass(ctx, w, h, r) {
    ctx.fillStyle = "#f2f2f2"; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const v = 200 + Math.floor(r() * 55);
      ctx.strokeStyle = `rgb(${v},${v},${v})`;
      const x = r() * w, y = r() * h;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (r() - 0.5) * 3, y - 2 - r() * 4); ctx.stroke();
    }
  },
  dirt(ctx, w, h, r) { ctx.fillStyle = "#eee"; ctx.fillRect(0, 0, w, h); noise(ctx, w, h, r, 60, 2, 250); noise(ctx, w, h, r, 40, 4, 240); },
  wood(ctx, w, h, r) {
    ctx.fillStyle = "#f0f0f0"; ctx.fillRect(0, 0, w, h);
    const boards = 4;
    for (let b = 0; b < boards; b++) {
      const y0 = (b * h) / boards;
      const tone = 225 + Math.floor(r() * 30);
      ctx.fillStyle = `rgb(${tone},${tone},${tone})`;
      ctx.fillRect(0, y0, w, h / boards);
      for (let i = 0; i < 10; i++) {
        const v = tone - 15 - Math.floor(r() * 25);
        ctx.strokeStyle = `rgba(${v},${v},${v},0.6)`;
        ctx.beginPath();
        const yy = y0 + r() * (h / boards);
        ctx.moveTo(0, yy);
        ctx.bezierCurveTo(w * 0.3, yy + (r() - 0.5) * 6, w * 0.6, yy + (r() - 0.5) * 6, w, yy);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(90,90,90,0.55)"; ctx.fillRect(0, y0, w, 2);
      ctx.fillRect(Math.floor(r() * w), y0, 2, h / boards);
    }
  },
  crate(ctx, w, h, r) {
    gens.wood(ctx, w, h, r);
    ctx.strokeStyle = "rgba(80,60,40,0.75)"; ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(6, 6); ctx.lineTo(w - 6, h - 6); ctx.stroke();
  },
  hay(ctx, w, h, r) {
    ctx.fillStyle = "#e6e6e6"; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 700; i++) {
      const v = 190 + Math.floor(r() * 65);
      ctx.strokeStyle = `rgb(${v},${v},${v})`; ctx.lineWidth = 1 + r();
      const x = r() * w, y = r() * h, a = (r() - 0.5) * 0.8;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * 14, y + Math.sin(a) * 14); ctx.stroke();
    }
  },
  metal(ctx, w, h, r) {
    ctx.fillStyle = "#ececec"; ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y++) {
      const v = 225 + Math.floor(r() * 30);
      ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.fillRect(0, y, w, 1);
    }
    ctx.fillStyle = "rgba(120,120,120,0.5)";
    for (const [x, y] of [[8, 8], [w - 10, 8], [8, h - 10], [w - 10, h - 10]]) { ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 6.3); ctx.fill(); }
  },
  tile(ctx, w, h, r) {
    ctx.fillStyle = "#fafafa"; ctx.fillRect(0, 0, w, h);
    noise(ctx, w, h, r, 12, 2);
    ctx.fillStyle = "rgba(150,150,150,0.8)";
    const n = 4;
    for (let i = 0; i <= n; i++) { ctx.fillRect((i * w) / n - 1, 0, 2, h); ctx.fillRect(0, (i * h) / n - 1, w, 2); }
  },
  checker(ctx, w, h, r) {
    const n = 4;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      ctx.fillStyle = (i + j) % 2 ? "#3a3a3a" : "#ffffff";
      ctx.fillRect((i * w) / n, (j * h) / n, w / n, h / n);
    }
    noise(ctx, w, h, r, 10, 2, 255);
  },
  concrete(ctx, w, h, r) {
    ctx.fillStyle = "#f0f0f0"; ctx.fillRect(0, 0, w, h);
    noise(ctx, w, h, r, 45, 1, 245); noise(ctx, w, h, r, 30, 3, 240);
    ctx.fillStyle = "rgba(130,130,130,0.35)"; ctx.fillRect(0, h / 2, w, 1); ctx.fillRect(w / 2, 0, 1, h);
  },
  asphalt(ctx, w, h, r) { ctx.fillStyle = "#e8e8e8"; ctx.fillRect(0, 0, w, h); noise(ctx, w, h, r, 90, 1, 255); },
  grate(ctx, w, h, r) {
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(40,40,40,0.85)";
    const n = 8;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) ctx.fillRect((i * w) / n + 3, (j * h) / n + 3, w / n - 6, h / n - 6);
  },
  hazard(ctx, w, h) {
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#2a2a2a";
    for (let i = -h; i < w; i += 32) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 16, 0); ctx.lineTo(i + 16 + h, h); ctx.lineTo(i + h, h); ctx.fill(); }
  },
  roof(ctx, w, h, r) {
    ctx.fillStyle = "#f0f0f0"; ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) {
      const g = ctx.createLinearGradient(x, 0, x + 16, 0);
      g.addColorStop(0, "#c8c8c8"); g.addColorStop(0.5, "#ffffff"); g.addColorStop(1, "#c8c8c8");
      ctx.fillStyle = g; ctx.fillRect(x, 0, 16, h);
    }
    noise(ctx, w, h, r, 20, 2, 255);
  },
  siding(ctx, w, h, r) {
    ctx.fillStyle = "#f2f2f2"; ctx.fillRect(0, 0, w, h);
    noise(ctx, w, h, r, 20, 2);
    ctx.fillStyle = "rgba(70,70,70,0.45)";
    for (let x = 0; x < w; x += 16) ctx.fillRect(x, 0, 2, h);
  },
  bread(ctx, w, h, r) {
    ctx.fillStyle = "#f4f4f4"; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      const v = 185 + Math.floor(r() * 50);
      ctx.fillStyle = `rgba(${v},${v},${v},0.8)`;
      ctx.beginPath(); ctx.ellipse(r() * w, r() * h, 1 + r() * 3, 1 + r() * 2, r() * 3, 0, 6.3); ctx.fill();
    }
  },
  cardboard(ctx, w, h, r) {
    ctx.fillStyle = "#f2f2f2"; ctx.fillRect(0, 0, w, h);
    noise(ctx, w, h, r, 25, 2);
    ctx.fillStyle = "rgba(120,120,120,0.25)";
    for (let y = 0; y < h; y += 6) ctx.fillRect(0, y, w, 1);
    ctx.fillStyle = "rgba(160,120,60,0.35)"; ctx.fillRect(0, h * 0.45, w, h * 0.1);
  },
  fabric(ctx, w, h, r) {
    ctx.fillStyle = "#f6f6f6"; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    for (let y = 0; y < h; y += 16) ctx.fillRect(0, y, w, 2);
    noise(ctx, w, h, r, 15, 2);
  },
  water(ctx, w, h, r) {
    ctx.fillStyle = "#eaeaea"; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 2;
    for (let i = 0; i < 14; i++) {
      const x = r() * w, y = r() * h;
      ctx.beginPath(); ctx.arc(x, y, 4 + r() * 8, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
    }
  },
  glow(ctx, w, h) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#ffffff"); g.addColorStop(0.5, "#e8e8e8"); g.addColorStop(1, "#ffffff");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  },
};

/** Choose a texture generator from a material name. */
export function textureKindFor(name) {
  const n = name.toLowerCase();
  const rules = [
    [/grass|lawn/, "grass"], [/dirt|mud|sand/, "dirt"], [/crate|pallet/, "crate"],
    [/plank|wood|fence|board|cutting/, "wood"], [/hay|straw/, "hay"],
    [/grate|vent/, "grate"], [/hazard|stripe/, "hazard"], [/roof|tin/, "roof"],
    [/check/, "checker"], [/tile/, "tile"], [/asphalt|road|tar/, "asphalt"],
    [/concrete|stone|counter/, "concrete"], [/metal|steel|chrome|dumpster|toaster|trailer|belt|car/, "metal"],
    [/barnred|wall|dinerwall|siding/, "siding"], [/bread|pancake|toast|butter/, "bread"],
    [/cardboard|box/, "cardboard"], [/vinyl|fabric|cloth|tire/, "fabric"], [/water/, "water"],
    [/glow|neon|light/, "glow"],
  ];
  for (const [re, k] of rules) if (re.test(n)) return k;
  return "plain";
}

/** Cached detail texture by kind (RepeatWrapping, sRGB). */
export function detailTexture(kind, anisotropy = 4) {
  if (cache.has(kind)) return cache.get(kind);
  const size = 128;
  const c = canvas(size);
  const ctx = c.getContext("2d");
  const r = rng([...kind].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7));
  (gens[kind] || gens.plain)(ctx, size, size, r);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  cache.set(kind, tex);
  return tex;
}

/** Soft round alpha sprite (particles, decals, flashes). */
export function radialTexture(key = "soft", inner = "rgba(255,255,255,1)", outer = "rgba(255,255,255,0)") {
  const id = `radial:${key}`;
  if (cache.has(id)) return cache.get(id);
  const c = canvas(64);
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, inner); g.addColorStop(1, outer);
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(id, tex);
  return tex;
}

/** Bullet-hole decal: dark centre with a cracked rim. */
export function holeTexture() {
  if (cache.has("hole")) return cache.get("hole");
  const c = canvas(64);
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, "rgba(20,15,10,1)"); g.addColorStop(0.35, "rgba(30,25,20,0.9)"); g.addColorStop(1, "rgba(30,25,20,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = "rgba(20,15,10,0.6)"; ctx.lineWidth = 1.5;
  const r = rng(99);
  for (let i = 0; i < 6; i++) {
    const a = r() * 6.28;
    ctx.beginPath(); ctx.moveTo(32, 32); ctx.lineTo(32 + Math.cos(a) * (14 + r() * 14), 32 + Math.sin(a) * (14 + r() * 14)); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set("hole", tex);
  return tex;
}

/** Yolk splat decal (white-ish; tinted yellow by material colour). */
export function splatTexture() {
  if (cache.has("splat")) return cache.get("splat");
  const c = canvas(128);
  const ctx = c.getContext("2d");
  const r = rng(1234);
  ctx.fillStyle = "rgba(255,255,255,1)";
  ctx.beginPath(); ctx.arc(64, 64, 30, 0, 6.3); ctx.fill();
  for (let i = 0; i < 16; i++) {
    const a = r() * 6.28, d = 28 + r() * 30, s = 4 + r() * 10;
    ctx.beginPath(); ctx.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, s, 0, 6.3); ctx.fill();
    ctx.beginPath(); ctx.moveTo(64, 64); ctx.lineTo(64 + Math.cos(a - 0.12) * d, 64 + Math.sin(a - 0.12) * d);
    ctx.lineTo(64 + Math.cos(a + 0.12) * d, 64 + Math.sin(a + 0.12) * d); ctx.fill();
  }
  // orange-ish centre (rendered via vertex colour multiply: keep RGB white, alpha shape)
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set("splat", tex);
  return tex;
}

/** Text sprite canvas (nameplates). Returns {texture, aspect}. */
export function textTexture(text, color = "#ffffff", opts = {}) {
  const font = opts.font || "bold 40px system-ui, sans-serif";
  const c = canvas(256, 64);
  const ctx = c.getContext("2d");
  ctx.font = font;
  const tw = Math.min(250, ctx.measureText(text).width + 24);
  ctx.clearRect(0, 0, 256, 64);
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  const x0 = 128 - tw / 2;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x0, 8, tw, 48, 14); else ctx.rect(x0, 8, tw, 48);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 34, 240);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

export function disposeTextureCache() {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}
