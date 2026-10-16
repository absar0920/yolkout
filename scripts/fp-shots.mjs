// First-person screenshots + checks (docs/V2_SPEC.md 5.11 / 7).
// Starts a tiny static server (/ -> web/, /data/ -> shared/data/, /ref/ -> shared/ref/), opens the dev harness
// (dev.html?offline=1&bots=0&debug=1) in headless Chromium (SwiftShader GL) and drives window.__yo:
//   <id>-idle / -ads / -fire / -reload-{15,35,55,75,92} for all 8 guns, <id>-cycle-40 (piercer, deviler),
//   melee-<id>-{pre,strike,follow}, grenade-release, switch-35, scope-{sniper,marksman,rocket},
//   cracks-{90,60,40,15}, hitmarkers, wall-front / wall-back (tracers never pass the wall), stairs (camera smoothness).
// Writes scripts/screenshots/fp/*.png and exits non-zero on a failed check or page errors.
// Usage: node scripts/fp-shots.mjs [--port 18901] [--only idle,reload,melee,scope,cracks,wall,stairs,misc] [--guns benedict,coddler]
//        [--url http://127.0.0.1:18900]   (use a running Go server instead of the static server; still offline practice)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "scripts/screenshots/fp");
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const PORT = +arg("port", process.env.FP_PORT || 18901);
const ONLY = (arg("only", "") || "").split(",").filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);
const ALL_GUNS = ["benedict", "deviler", "poacher", "piercer", "frittata", "overeasy", "souffle", "coddler"];
const GUNS = (arg("guns", "") || "").split(",").filter(Boolean);
const guns = GUNS.length ? GUNS : ALL_GUNS;
const MELEES = ["rollingpin", "pan", "whisk", "spatula"];
const W = JSON.parse(fs.readFileSync(path.join(ROOT, "shared/data/weapons.json"), "utf8")).weapons;
const MAP = arg("map", "barnyard");
const VIEW = [1280, 720];

let base = arg("url", "");
let server = null;
if (!base) {
  const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".css": "text/css" };
  server = http.createServer((req, res) => {
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
  base = `http://127.0.0.1:${PORT}`;
}

const { chromium } = await import(path.join(ROOT, "scripts/node_modules/playwright/index.mjs"));
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
fs.mkdirSync(OUT, { recursive: true });
const problems = [];
const results = {};
const IGNORE = /GPU stall|swiftshader|WebGL-|Automatic fallback|AudioContext|pointer ?lock|requestPointerLock/i;

async function open(qs, label) {
  const page = await browser.newPage({ viewport: { width: VIEW[0], height: VIEW[1] } });
  page.__logs = [];
  page.on("console", (m) => { if (m.type() === "error") page.__logs.push(`${m.type()}: ${m.text()}`); });
  page.on("pageerror", (e) => page.__logs.push(`pageerror: ${e.message}`));
  await page.goto(`${base}/js/engine/test/dev.html?offline=1&bots=0&debug=1&hud=0&map=${MAP}&${qs}`);
  await page.waitForFunction(() => window.__ready === true || window.__err, null, { timeout: 120000 });
  const err = await page.evaluate(() => window.__err || null);
  if (err) throw new Error(`${label}: ${err}`);
  await page.waitForFunction(() => window.__yo && window.__yo.state().alive, null, { timeout: 30000 });
  // a calm spot facing open space: keep the spawn, look level
  await page.evaluate(() => { const s = window.__yo.state(); window.__yo.camAt(s.x, s.y, s.z, s.yaw, -0.05); });
  await page.waitForTimeout(600);
  page.__label = label;
  return page;
}

async function close(page) {
  const errs = page.__logs.filter((l) => !IGNORE.test(l));
  if (errs.length) problems.push(`${page.__label}: ${errs.join(" | ")}`);
  await page.close();
}

async function shot(page, file, wait = 250) {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: path.join(OUT, file) });
  console.log(`wrote ${file}`);
}

const check = (ok, msg) => { if (!ok) problems.push(msg); console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); };

try {
  // ------------------------------------------------------------- per gun
  if (want("idle") || want("reload") || want("ads") || want("fire")) {
    for (const id of guns) {
      const isSec = id === "coddler";
      const page = await open(`cls=${isSec ? "benedict" : id}&mel=pan`, id);
      if (isSec) { await page.evaluate(() => window.__yo.setWeapon(1)); await page.waitForTimeout(900); }
      const y = (fn, ...a) => page.evaluate(fn, ...a);
      if (want("idle")) { await y(() => window.__yo.freeze("idle", 0)); await shot(page, `${id}-idle.png`); }
      if (want("fire")) { await y(() => window.__yo.freeze("fire", 0)); await shot(page, `${id}-fire.png`, 50); await y(() => window.__yo.freeze(null)); }
      if (want("ads")) {
        await y(() => { window.__yo.freeze(null); window.__yo.setAds(true); });
        await shot(page, `${id}-ads.png`, 900);
        await y(() => window.__yo.setAds(false));
        await page.waitForTimeout(500);
      }
      if (want("reload")) {
        for (const f of [15, 35, 55, 75, 92]) {
          await y((ff) => window.__yo.freeze("reload", ff / 100, { empty: true }), f);
          await shot(page, `${id}-reload-${f}.png`, 120);
        }
        if (W[id].cycle && W[id].cycle !== "none") {
          await y(() => window.__yo.freeze("cycle", 0.4));
          await shot(page, `${id}-cycle-40.png`, 120);
        }
        await y(() => window.__yo.freeze(null));
      }
      await close(page);
    }
  }

  // ------------------------------------------------------------- melee, grenade, switch
  if (want("melee") || want("misc")) {
    const page = await open("cls=benedict&mel=rollingpin", "melee");
    const y = (fn, ...a) => page.evaluate(fn, ...a);
    if (want("melee")) {
      for (const m of MELEES) {
        const d = W[m];
        const pts = { pre: d.windup * 0.8, strike: d.windup + 0.05, follow: d.windup + 0.2 };
        await y((mm) => window.__yo.vm.setMelee(mm), m);
        for (const [k, t] of Object.entries(pts)) {
          await y(([f]) => window.__yo.freeze("melee", f), [t / d.cooldown]);
          await shot(page, `melee-${m}-${k}.png`, 120);
        }
      }
    }
    if (want("misc")) {
      await y(() => window.__yo.freeze("grenade", 0.11 / 0.6));
      await shot(page, "grenade-release.png", 120);
      await y(() => window.__yo.freeze("grenade", 0.05 / 0.6));
      await shot(page, "grenade-hold.png", 120);
      await y(() => window.__yo.freeze("switch", 0.35));
      await shot(page, "switch-35.png", 120);
      await y(() => window.__yo.freeze(null));
      // hit markers: head, body, limb, kill
      await y(() => { const o = window.__yo.overlay; o.hits.length = 0; o.hitMarker(1, false); o.hits[0].t = 0.04; o.hits[0].hold = true; });
      await shot(page, "hitmarker-head.png", 300);
      await y(() => { const o = window.__yo.overlay; o.hits.length = 0; o.hitMarker(2, false); o.hits[0].t = 0.04; o.hits[0].hold = true; });
      await shot(page, "hitmarker-body.png", 300);
      await y(() => { const o = window.__yo.overlay; o.hits.length = 0; o.hitMarker(3, false); o.hits[0].t = 0.04; o.hits[0].hold = true; });
      await shot(page, "hitmarker-limb.png", 300);
      await y(() => { const o = window.__yo.overlay; o.hits.length = 0; o.hitMarker(1, true); o.hits[0].t = 0.04; o.hits[0].hold = true; });
      await shot(page, "hitmarker-kill.png", 300);
      await y(() => { window.__yo.overlay.hits.length = 0; });
    }
    await close(page);
  }

  // ------------------------------------------------------------- scopes
  if (want("scope")) {
    for (const [id, file] of [["piercer", "scope-sniper.png"], ["overeasy", "scope-marksman.png"], ["souffle", "scope-rocket.png"]]) {
      const page = await open(`cls=${id}`, `scope-${id}`);
      await page.evaluate(() => window.__yo.setAds(true));
      await shot(page, file, 1200);
      const vis = await page.evaluate(() => window.__yo.vm.gunRoot.visible);
      check(!vis, `${id}: gun hidden while scoped`);
      await close(page);
    }
  }

  // ------------------------------------------------------------- cracks
  if (want("cracks")) {
    const page = await open("cls=benedict", "cracks");
    for (const hp of [90, 60, 40, 15]) {
      await page.evaluate((h) => window.__yo.setHp(h), hp);
      await shot(page, `cracks-${hp}.png`, 700);
    }
    await page.evaluate(() => window.__yo.overlay.damage(0, 0, 30));
    await shot(page, "cracks-hit.png", 60);
    await close(page);
  }

  // ------------------------------------------------------------- wall tracer test (section 6 bug)
  if (want("wall")) {
    for (const id of ["benedict", "deviler"]) {
      const page = await open(`cls=${id}`, `wall-${id}`);
      const res = await page.evaluate(async (gid) => {
        const Y = window.__yo, g = Y.game, Phys = await import("/js/engine/physics.js");
        const s = Y.state();
        const eyeH = g.C.eyeHeight;
        // find a wall 4..14 u away with open floor in front of it and room behind it
        let best = null;
        for (let k = 0; k < 64 && !best; k++) {
          const yaw = (k / 64) * Math.PI * 2;
          const d = Phys.aimDir(yaw, 0);
          const t = Phys.raycastWorld(g.world, s.x, s.y + eyeH, s.z, d[0], d[1], d[2], 20);
          if (t < 4 || t > 14) continue;
          // thickness: come back from 12 u behind the hit
          const hx = s.x + d[0] * t, hz = s.z + d[2] * t;
          const bx = hx + d[0] * 12, bz = hz + d[2] * 12;
          const tb = Phys.raycastWorld(g.world, bx, s.y + eyeH, bz, -d[0], 0, -d[2], 12);
          if (tb < 0 || 12 - tb > 3) continue;
          const thick = 12 - tb;
          // behind: a free spot 3 u behind the back face
          const back = [hx + d[0] * (thick + 3), hz + d[2] * (thick + 3)];
          if (Phys.overlapsSolid(g.world, g.C, back[0], s.y, back[1])) continue;
          best = { yaw, d, t, thick, back };
        }
        if (!best) return { err: "no wall found" };
        // stand 2 u in front of the wall, facing it
        const fx = s.x + best.d[0] * (best.t - 2), fz = s.z + best.d[2] * (best.t - 2);
        Y.camAt(fx, s.y, fz, best.yaw, 0);
        await new Promise((r) => setTimeout(r, 300));
        Y.fire(gid === "deviler" ? 3 : 66);
        const out = { bad: [], n: 0, maxOver: -1 };
        const t0 = performance.now();
        while (performance.now() - t0 < (gid === "deviler" ? 600 : 1300)) {
          for (const tr of g.effects.tracers) {
            const head = Math.min(tr.L, tr.t * tr.speed);
            const tw = Phys.raycastWorld(g.world, tr.sx, tr.sy, tr.sz, tr.dx, tr.dy, tr.dz, 200);
            if (tw < 0) continue;
            out.n++;
            out.maxOver = Math.max(out.maxOver, head - tw);
            if (head > tw + 0.02) out.bad.push([head, tw]);
          }
          await new Promise((r) => requestAnimationFrame(r));
        }
        return { ...out, wall: best, fx, fz, holes: g.effects.holes.used };
      }, id);
      if (res.err) { check(false, `${id} wall test: ${res.err}`); await close(page); continue; }
      check(res.n > 0 && res.bad.length === 0, `${id}: ${res.n} tracer samples, none beyond the wall (max overshoot ${res.maxOver.toFixed(3)} u, holes ${res.holes})`);
      // freeze effects mid-flight of a fresh volley and look at it from both sides
      await page.evaluate((gid) => { window.__yo.fire(gid === "deviler" ? 3 : 8); }, id);
      await page.waitForFunction(() => window.__yo.game.effects.tracers.length > 0, null, { timeout: 3000 }).catch(() => {});
      await page.evaluate(() => { window.__yo.effects.timeScale = 0; });
      await shot(page, `wall-front-${id}.png`, 100);
      await page.evaluate((r) => {
        const Y = window.__yo, s = Y.state();
        Y.camAt(r.wall.back[0], s.y, r.wall.back[1], r.wall.yaw + Math.PI, 0);
      }, res);
      await shot(page, `wall-back-${id}.png`, 400);
      if (id === "benedict") {
        fs.copyFileSync(path.join(OUT, "wall-front-benedict.png"), path.join(OUT, "wall-front.png"));
        fs.copyFileSync(path.join(OUT, "wall-back-benedict.png"), path.join(OUT, "wall-back.png"));
      }
      await close(page);
    }
  }

  // ------------------------------------------------------------- stairs: camera never jumps
  if (want("stairs")) {
    const page = await open("cls=benedict", "stairs");
    const res = await page.evaluate(async () => {
      const Y = window.__yo, g = Y.game, Phys = await import("/js/engine/physics.js");
      const b = g.mapJson.bounds;
      // find a 0.5 u step: two ground heights 0.6 u apart differing by ~0.5
      const ground = (x, z) => { const t = Phys.raycastWorld(g.world, x, b.max[1] + 1, z, 0, -1, 0, b.max[1] - b.min[1] + 4); return t < 0 ? null : b.max[1] + 1 - t; };
      let found = null;
      for (let x = b.min[0] + 2; x < b.max[0] - 2 && !found; x += 0.5) {
        for (let z = b.min[2] + 2; z < b.max[2] - 2 && !found; z += 0.5) {
          const g0 = ground(x, z);
          if (g0 == null) continue;
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const g1 = ground(x + dx * 0.6, z + dz * 0.6), g2 = ground(x + dx * 1.2, z + dz * 1.2), g3 = ground(x + dx * 1.8, z + dz * 1.8);
            if (g1 == null || g2 == null || g3 == null) continue;
            if (Math.abs(g1 - g0 - 0.5) < 0.05 && Math.abs(g2 - g1 - 0.5) < 0.05 && g3 >= g2 - 0.01 && !Phys.overlapsSolid(g.world, g.C, x, g0 + 0.01, z)) {
              found = { x, z, y: g0, yaw: Math.atan2(-dx, -dz) };
              break;
            }
          }
        }
      }
      if (!found) return { err: "no stairs found" };
      Y.camAt(found.x, found.y + 0.01, found.z, found.yaw, 0);
      await new Promise((r) => setTimeout(r, 400));
      // drive the game loop at an exact 60 fps (SwiftShader renders far slower): own the frame clock, skip GPU work
      const raf = window.requestAnimationFrame, render = g.R.render;
      window.requestAnimationFrame = () => 0;
      g.R.render = () => {};
      await new Promise((r) => setTimeout(r, 300));
      let t = g.lastFrame;
      const ys = [], errs = [];
      Y.walk(Y.KEY.FWD, 90);
      // exact 1/60 s steps, paced to the wall clock so the in-browser server ticks along in real time
      const wall0 = performance.now();
      let lastCorr = -99;
      const clean = [];
      for (let i = 0; i < 110; i++) {
        t += 1000 / 60;
        const ack0 = g.predictor.lastAck;
        g._frame(t);
        ys.push(g.R.camera.position.y);
        errs.push(+g.lastErr.toFixed(3));
        if (g.predictor.lastAck !== ack0 && g.lastErr > 1e-3) lastCorr = i;
        // only grounded walking counts (a jump or a fall off the top is real vertical motion)
        clean.push(i - lastCorr > 8 && g.predictor.ps.onGround && g.predictor.prev.onGround);
        const due = wall0 + (i + 1) * (1000 / 60) - performance.now();
        await new Promise((r) => setTimeout(r, Math.max(0, due)));
      }
      g.R.render = render;
      window.requestAnimationFrame = raf;
      g.lastFrame = performance.now();
      g._raf = raf((tt) => g._frame(tt));
      // frames right after a reconciliation correction are excluded: on a loaded test machine the in-browser
      // server's timer jitters against the synthetic 60 fps clock (corrections are measured separately)
      let maxD = 0, corrFrames = 0;
      for (let i = 1; i < ys.length; i++) { if (clean[i]) maxD = Math.max(maxD, Math.abs(ys[i] - ys[i - 1])); else corrFrames++; }
      const d = ys.slice(1).map((y, i) => +(y - ys[i]).toFixed(3));
      return { found, frames: ys.length, maxD, corrFrames, rise: Math.max(...ys) - ys[0], deltas: d.join(" "), errs: errs.join(" ") };
    });
    if (res.err) check(false, `stairs: ${res.err}`);
    else check(res.maxD <= 0.12 && res.rise > 0.4, `stairs: camera rose up to ${res.rise.toFixed(2)} u over ${res.frames} frames, max per-frame step ${res.maxD.toFixed(3)} u (<= 0.12; ${res.corrFrames} frames airborne or near a harness-timing correction excluded)`);
    results.stairs = res;
    if (res.deltas) console.log(`stairs per-frame camera dy: ${res.deltas}\nreconcile err: ${res.errs}`);
    await close(page);
  }
} catch (e) {
  problems.push(`exception: ${e.stack || e}`);
} finally {
  await browser.close();
  if (server) server.close();
}
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("fp-shots: all checks OK");
