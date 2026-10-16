// Art gallery screenshots + budget check (docs/V2_SPEC.md 4.8).
// Starts a tiny static server (/ -> web/, /data/ -> shared/data/, /ref/ -> shared/ref/), opens the gallery
// in headless Chromium (SwiftShader GL), writes scripts/screenshots/art/*.png, prints a budget table and
// exits non-zero when a cap is exceeded or the page logs errors.
// Usage: node scripts/art-gallery.mjs [--port 18850] [--only guns,eggs]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "scripts/screenshots/art");
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const PORT = +arg("port", process.env.ART_PORT || 18850);
const ONLY = (arg("only", "") || "").split(",").filter(Boolean);

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".css": "text/css" };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file;
  if (u.startsWith("/data/")) file = path.join(ROOT, "shared/data", u.slice(6));
  else if (u.startsWith("/ref/")) file = path.join(ROOT, "shared/ref", u.slice(5));
  else file = path.join(ROOT, "web", u === "/" ? "index.html" : u);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(buf);
  });
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

const { chromium } = await import(path.join(ROOT, "scripts/node_modules/playwright/index.mjs"));
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const GUNS = ["benedict", "deviler", "poacher", "piercer", "frittata", "overeasy", "souffle", "coddler"];
const shots = [
  ["guns-fp.png", "view=guns&lod=fp", [1600, 900]],
  ...GUNS.map((id) => [`guns-fp-${id}.png`, `view=guns&lod=fp&id=${id}`, [1000, 700]]),
  ["guns-tp.png", "view=guns&lod=tp", [1600, 800]],
  ["fpview.png", "view=fpview", [1600, 1800]],
  ...GUNS.map((id) => [`fpview-${id}.png`, `view=fpview&id=${id}`, [1280, 720]]),
  ["fpview-ads.png", "view=fpview&ads=1", [1600, 1800]],
  ["hands-poses.png", "view=hands&lod=fp", [1800, 640]],
  ["hands-poses-thumbside.png", "view=hands&lod=fp&flip=1", [1800, 640]],
  ["hands-tp.png", "view=hands&lod=tp", [1800, 640]],
  ["melee.png", "view=melee", [1400, 800]],
  ["throwables.png", "view=throwables", [1200, 800]],
  ["eggs-cracks.png", "view=eggs", [1400, 1050]],
  ["holding.png", "view=holding", [1600, 900]],
  ...GUNS.map((id) => [`egg-holding-${id}.png`, `view=holding&id=${id}`, [800, 800]]),
  ["anim-tp.png", "view=anim", [1600, 1000]],
  ["props.png", "view=props", [1600, 420]],
  ["hats.png", "view=hats", [1500, 900]],
];
fs.mkdirSync(OUT, { recursive: true });
const allStats = {};
const problems = [];
try {
  for (const [file, qs, [w, h]] of shots) {
    if (ONLY.length && !ONLY.some((o) => file.includes(o))) continue;
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const logs = [];
    page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") logs.push(`${m.type()}: ${m.text()}`); });
    page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
    await page.goto(`http://127.0.0.1:${PORT}/js/game/art/test/gallery.html?${qs}`);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
    await page.waitForTimeout(400);
    const res = await page.evaluate(() => ({ stats: window.__stats, errors: window.__errors, info: window.__info }));
    await page.screenshot({ path: path.join(OUT, file) });
    const errs = [...(res.errors || []), ...logs.filter((l) => !/GPU stall|swiftshader|WebGL-|Automatic fallback/i.test(l))];
    if (errs.length) problems.push(`${file}: ${errs.join(" | ")}`);
    Object.assign(allStats, res.stats);
    console.log(`wrote ${file}${res.info ? ` (programs ${res.info.programs})` : ""}`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

// budgets (spec 4.3 - 4.6)
const caps = [];
for (const id of GUNS) {
  caps.push([`${id}:fp`, 3000, 5], [`${id}:tp`, 800, 2]);
}
for (const s of ["R", "L"]) for (const p of ["open", "grip", "trigger", "pinch", "point", "fist", "cup", "palm"]) caps.push([`${s}-${p}`, null, null, "hand"]);
for (const m of ["rollingpin", "pan", "whisk", "spatula"]) caps.push([`${m}-fp`, 1500, 1], [`${m}-tp`, 300, 1]);
for (const id of GUNS) caps.push([`egg-${id}`, 3200, 9]);
const rows = [];
for (const [name, maxT, maxD, kind] of caps) {
  const s = allStats[name];
  if (!s) continue;
  let tMax = maxT, dMax = maxD;
  if (kind === "hand") { const tp = s.tris < 400; tMax = tp ? 150 : 1200; dMax = 1; }
  const ok = s.tris <= tMax && s.drawCalls <= dMax;
  rows.push(`${ok ? "ok  " : "FAIL"} ${name.padEnd(18)} tris ${String(s.tris).padStart(5)} / ${tMax}   draws ${s.drawCalls} / ${dMax}${s.outlineCalls ? `  (+${s.outlineCalls} outline)` : ""}`);
  if (!ok) problems.push(`budget ${name}: ${s.tris} tris, ${s.drawCalls} draws`);
}
console.log(rows.join("\n"));
for (const [k, v] of Object.entries(allStats)) if (k.endsWith(":parts")) {
  console.log(`     ${k.padEnd(22)} ${JSON.stringify(v)}`);
  // spec 4.6: shell <= 1,400; shell + face + feet <= 2,000; TP hands <= 300 (limbs = 2 hands + 2 shoes); TP gun <= 800
  if (v.shell > 1400 || v.limbs > 600 || v.shell + v.limbs > 2300 || v.gun > 800) problems.push(`budget ${k}: ${JSON.stringify(v)}`);
}
for (const [k, v] of Object.entries(allStats)) if (k.startsWith("hat:")) console.log(`     ${k.padEnd(22)} ${v.tris} tris`);
if (problems.length) { console.error("\nPROBLEMS:\n" + problems.join("\n")); process.exit(1); }
console.log("art gallery OK");
