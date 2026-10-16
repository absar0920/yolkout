// Final v2 screenshot set (scripts/screenshots/v2/): first-person view of every weapon, ADS, rocket + sniper scopes,
// a frying-pan swing, a remote egg at low health (shell cracks), the TP launcher firing / reloading and an in-match scene.
// Usage: node scripts/v2-shots.mjs [--port 18980]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "scripts/screenshots/v2");
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const PORT = +arg("port", 18980);
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
fs.mkdirSync(OUT, { recursive: true });
const problems = [];
const IGNORE = /GPU stall|swiftshader|WebGL-|Automatic fallback|AudioContext|pointer ?lock|requestPointerLock/i;
const GUNS = ["benedict", "deviler", "poacher", "piercer", "frittata", "overeasy", "souffle", "coddler"];

async function open(qs) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.__logs = [];
  page.on("console", (m) => { if (m.type() === "error" && !IGNORE.test(m.text())) page.__logs.push(m.text()); });
  page.on("pageerror", (e) => page.__logs.push(`pageerror: ${e.message}`));
  await page.goto(`http://127.0.0.1:${PORT}/js/engine/test/dev.html?offline=1&debug=1&hud=0&map=barnyard&${qs}`);
  await page.waitForFunction(() => window.__ready === true || window.__err, null, { timeout: 120000 });
  const err = await page.evaluate(() => window.__err || null);
  if (err) throw new Error(err);
  await page.waitForFunction(() => window.__yo && window.__yo.state().alive, null, { timeout: 60000 });
  await page.evaluate(() => { const s = window.__yo.state(); window.__yo.camAt(s.x, s.y, s.z, s.yaw, -0.05); });
  await page.waitForTimeout(600);
  return page;
}
const shot = async (page, file, wait = 300) => { await page.waitForTimeout(wait); await page.screenshot({ path: path.join(OUT, file) }); console.log(`wrote v2/${file}`); };
const done = async (page, label) => { if (page.__logs.length) problems.push(`${label}: ${page.__logs.slice(0, 3).join(" | ")}`); await page.close(); };
/** Respawn the local player with primary `cls` (practice server). */
async function loadout(page, cls, mel) {
  await page.evaluate(([cls, mel]) => {
    const g = window.__yo.game;
    g.local._kill(g.local.human, g.local.human, "fall", 0);
    window.__g.setLoadout(mel ? { cls, mel } : { cls });
  }, [cls, mel]);
  await page.waitForFunction((cls) => { const g = window.__yo.game; return g.local.human.alive && g.vm.currentId === cls; }, cls, { timeout: 15000 });
  await page.evaluate(() => { const g = window.__yo.game; g.local.human.protEnd = 1e12; g.local.human.hp = 1e9; const s = window.__yo.state(); window.__yo.camAt(s.x, s.y, s.z, s.yaw, -0.05); });
  await page.waitForTimeout(900);
}

try {
  // ---- first person: every weapon idle + ADS, scopes, pan swing
  {
    const page = await open("bots=0&cls=benedict&mel=pan");
    for (const id of GUNS) {
      await page.evaluate((id) => { window.__yo.vm.setWeapon(id, { draw: false }); window.__yo.freeze("idle", 0); }, id);
      await shot(page, `fp-${id}.png`, 500);
    }
    await page.evaluate(() => { window.__yo.vm.setWeapon("benedict", { draw: false }); window.__yo.freeze(null); });
    for (const [id, file] of [["piercer", "scope-sniper.png"], ["souffle", "scope-rocket.png"]]) {
      await loadout(page, id);
      await page.evaluate(() => window.__yo.setAds(true));
      await shot(page, file, 1200);
      await page.evaluate(() => window.__yo.setAds(false));
    }
    await loadout(page, "benedict", "pan");
    const pan = await page.evaluate(() => { const w = window.__yo.game.data.weapons.weapons.pan; return { w: w.windup, cd: w.cooldown }; });
    for (const [k, t] of [["windup", pan.w * 0.7], ["strike", pan.w], ["follow", pan.w + 0.15]]) {
      await page.evaluate((f) => window.__yo.freeze("melee", f), t / pan.cd);
      await shot(page, `melee-pan-${k}.png`, 300);
    }
    await page.evaluate(() => window.__yo.freeze("grenade", 0.04 / 0.6));
    await shot(page, "grenade-windup.png", 300);
    await page.evaluate(() => window.__yo.freeze("reload", 0.45, { empty: true }));
    await shot(page, "reload-benedict-45.png", 300);
    await page.evaluate(() => window.__yo.freeze(null));
    // own low health: screen cracks
    await page.evaluate(() => window.__yo.setHp(18));
    await shot(page, "fp-low-health-cracks.png", 1200);
    await page.evaluate(() => window.__yo.setHp(null));
    await done(page, "first-person");
  }
  // ---- third person: a bot at low health, its launcher firing / reloading, and an in-match scene
  {
    const page = await open("bots=4&cls=overeasy&mel=spatula");
    const r = await page.evaluate(async () => {
      const g = window.__yo.game, L = g.local, H = L.human;
      H.protEnd = 1e12; H.hp = 1e9;
      const bot = [...L.players.values()].find((p) => p !== H && p.bot && p.alive);
      if (!bot) return { err: "no bot" };
      // park the bot in the open (a clear line of 8 m+), facing us, hurt
      const s = window.__yo.state(), Phys = await import("/js/engine/physics.js"), eye = g.C.eyeHeight;
      let yaw = 0;
      for (let k = 0; k < 64; k++) {
        const a = (k / 64) * Math.PI * 2, d = Phys.aimDir(a, 0);
        const t = Phys.raycastWorld(g.world, s.x, s.y + 0.3, s.z, d[0], 0, d[2], 9);
        const t2 = Phys.raycastWorld(g.world, s.x, s.y + eye, s.z, d[0], 0, d[2], 9);
        if (t < 0 && t2 < 0) { yaw = a; break; }
      }
      const dir = Phys.aimDir(yaw, 0);
      const bx = s.x + dir[0] * 3.2, bz = s.z + dir[2] * 3.2;
      const pose = () => {
        bot.ps.x = bx; bot.ps.y = s.y; bot.ps.z = bz; bot.ps.vx = bot.ps.vy = bot.ps.vz = 0; bot.yaw = yaw + Math.PI;
        bot.protEnd = 1e12; bot.hp = 18; bot.lastDmgK = 1e12;
        if (bot.bot) { bot.bot.seq = bot.bot.seq || 0; }
      };
      for (const o of L.players.values()) if (o !== H && o !== bot) { o.ps.x = s.x + 40; o.protEnd = 1e12; }
      window.__pose = setInterval(pose, 5);
      pose();
      window.__yo.camAt(s.x, s.y, s.z, yaw, -0.08);
      window.__shotYaw = yaw;
      return { id: bot.id };
    });
    if (r.err) problems.push(r.err);
    await page.waitForTimeout(1500);
    await shot(page, "tp-egg-low-health-cracks.png", 200);
    // the TP launcher: warhead hidden after a shot, slides back in during the reload
    const tp = await page.evaluate(async () => {
      const g = window.__yo.game;
      const M = await import("/js/game/models.js");
      const av = new M.EggAvatar(g.data, { name: "", cos: { color: "lava" }, cls: "souffle", nameplate: false, id: 77 });
      const st = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, flags: 3 };
      av.update(st, 1 / 60, 0);
      const out = { idle: av.gun.parts.rocket.visible };
      av.fire(); av.update(st, 1 / 60, 0);
      out.afterFire = av.gun.parts.rocket.visible;
      const W = g.data.weapons.weapons.souffle;
      let t = 0; const seen = [];
      av.update({ ...st, flags: 3 | 8 }, 1 / 60, 0);
      for (let i = 0; i < Math.round(W.reloadTime * 60); i++) { av.update({ ...st, flags: 3 | 8 }, 1 / 60, (t += 1 / 60)); if (i % 20 === 0) seen.push(av.gun.parts.rocket.visible ? 1 : 0); }
      out.reload = seen.join("");
      out.end = av.gun.parts.rocket.visible;
      av.dispose();
      return out;
    });
    console.log("TP launcher warhead:", JSON.stringify(tp));
    if (tp.idle !== true || tp.afterFire !== false || tp.end !== true) problems.push(`TP launcher warhead ${JSON.stringify(tp)}`);
    await page.evaluate(() => { clearInterval(window.__pose); const g = window.__yo.game; for (const o of g.local.players.values()) o.protEnd = 0; g.local.human.protEnd = 1e12; });
    await page.waitForTimeout(6000);
    await page.evaluate(() => { const s = window.__yo.state(); window.__yo.camAt(s.x, s.y, s.z, window.__shotYaw || s.yaw, -0.03); });
    await shot(page, "in-match.png", 2500);
    await done(page, "third-person");
  }
} catch (e) {
  problems.push(String(e && e.stack || e));
} finally {
  await browser.close();
  server.close();
}
if (problems.length) { console.log("PROBLEMS:\n" + problems.join("\n")); process.exit(1); }
console.log("v2-shots: OK");
