// Browser end-to-end test for Yolkout (Playwright + headless Chromium, software GL).
//
//   cd scripts && npm install && npx playwright install chromium   (once)
//   node scripts/e2e.mjs [--url http://localhost:18400] [--server bin/yolkout] [--headed] [--out scripts/screenshots]
//
// Expects a running server at --url (make e2e starts one). Exits non-zero on any failure.
// Flows: home screen (desktop + 390 px phone), loadout, settings, online quickplay
// (render check, HUD, move, fire, reload, scoreboard, chat, pause), private room create + join
// by a second browser context, offline practice vs bots (with a forced death to time the respawn), and the v2
// mechanics in practice (melee loadout, straight rocket, scopes, health cracks, tracers stop at walls).
// With --server <binary>, it also starts its own short-match server (FFA time limit 25 s, no bots, on
// --url's port + 1) to drive a real match end -> results -> intermission -> next map, and then
// stops that server (SIGTERM) to check the disconnect screen.

import { chromium } from "playwright";
import { mkdirSync, mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const CODE_LEN = JSON.parse(readFileSync(join(here, "../shared/data/rules.json"), "utf8")).rooms.codeLength;
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "1"]);
  return acc;
}, []));
const BASE = (args.url || process.env.E2E_URL || "http://localhost:18400").replace(/\/$/, "");
const OUT = resolve(args.out || join(here, "screenshots"));
const HEADED = !!args.headed;
const SERVER_BIN = args.server ? resolve(args.server) : "";
const REPO = resolve(here, "..");
mkdirSync(OUT, { recursive: true });

// Hard stop so a wedged browser can never hang CI.
setTimeout(() => { console.log("FAIL  e2e watchdog: run exceeded 12 minutes"); process.exit(2); }, 12 * 60 * 1000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let failures = 0;
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
}

const launchArgs = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
  "--autoplay-policy=no-user-gesture-required", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"];
async function launch() {
  try {
    return await chromium.launch({ headless: !HEADED, args: launchArgs });
  } catch (e) {
    for (const p of ["/usr/bin/chromium-browser", "/usr/bin/chromium", "/usr/bin/google-chrome", "/snap/bin/chromium"]) {
      try { return await chromium.launch({ headless: !HEADED, executablePath: p, args: launchArgs }); } catch { /* next */ }
    }
    throw e;
  }
}

/** Track console errors, uncaught exceptions and failed same-origin requests for a page. */
function watch(page, label) {
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(`[${label}] console: ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`[${label}] pageerror: ${e.message}`));
  page.on("requestfailed", (r) => {
    if (r.url().startsWith(BASE) && !/net::ERR_ABORTED/.test(r.failure()?.errorText || "")) errors.push(`[${label}] requestfailed: ${r.url()} ${r.failure()?.errorText}`);
  });
  page.on("response", (r) => { if (r.url().startsWith(BASE) && r.status() >= 400) errors.push(`[${label}] HTTP ${r.status()} ${r.url()}`); });
  return errors;
}

/** Pixel statistics of a PNG screenshot, decoded in the page with a 2D canvas. */
async function pixelStats(page, png) {
  if (!png) return { colors: 0, mean: 0, std: 0, missing: true };
  const b64 = png.toString("base64");
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    const w = (c.width = Math.min(320, img.width)), h = (c.height = Math.round(img.height * (w / img.width)));
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    const colors = new Set();
    let sum = 0, sum2 = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      sum += l; sum2 += l * l; n++;
      colors.add((d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | (d[i + 2] >> 3));
    }
    const mean = sum / n;
    return { colors: colors.size, mean: +mean.toFixed(1), std: +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(1) };
  }, b64);
}

const ONLY = args.only ? String(args.only).split(",") : null;
const want = (name) => !ONLY || ONLY.includes(name);

const state = (page) => page.evaluate(() => {
  const g = window.__yolkoutUI && window.__yolkoutUI.game;
  if (!g) return null;
  const s = g.getState();
  const P = g._game.predictor;
  return { ...JSON.parse(JSON.stringify(s)), pos: P ? [P.ps.x, P.ps.y, P.ps.z] : null, seq: g._game.seq, snaps: g._game.lastSnapK ?? -1,
    locked: !!document.pointerLockElement, inputSlot: g._game.input.slot, inputEnabled: g._game.input.enabled };
});

async function shot(page, name, el) {
  const path = join(OUT, name + ".png");
  try {
    const buf = el ? await page.locator(el).screenshot({ path, timeout: 45000 }) : await page.screenshot({ path, timeout: 45000 });
    return { path, buf };
  } catch (e) {
    // Headless software GL occasionally stalls the compositor; a missing screenshot alone is not a failure.
    console.log(`      (screenshot ${name} skipped: ${String(e.message).split("\n")[0]})`);
    return { path, buf: null };
  }
}

async function enterGame(page) {
  // The click-to-play overlay requests pointer lock (a trusted click from Playwright).
  // Software GL renders a few fps, so Playwright's actionability waits (stable box) can time out:
  // click the button's centre directly instead.
  const ctp = page.locator("#click-to-play button");
  for (let i = 0; i < 12; i++) {
    const locked = await page.evaluate(() => !!document.pointerLockElement);
    if (locked) return true;
    const box = (await ctp.isVisible().catch(() => false)) ? await ctp.boundingBox().catch(() => null) : null;
    const vp = page.viewportSize();
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    else await page.mouse.click(vp.width / 2, vp.height / 2);
    await sleep(400);
  }
  return page.evaluate(() => !!document.pointerLockElement);
}

async function home(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = watch(page, "home");
  const t0 = Date.now();
  await page.goto(BASE + "/", { waitUntil: "load" });
  await page.waitForSelector("body.ready", { timeout: 15000 });
  check("home: boots (body.ready)", true, `${Date.now() - t0} ms`);
  check("home: mode picker rendered", (await page.locator("#mode-picker [role=radio], #mode-picker button, #mode-picker input").count()) >= 3);
  check("home: map select populated", (await page.locator("#map-select option").count()) >= 2);
  await sleep(600);
  const rooms = await page.locator("#rooms-list li").count();
  check("home: room list rendered", rooms >= 1, `${rooms} rows`);
  const h = await shot(page, "01-home");
  const ps = await pixelStats(page, h.buf);
  check("home: screenshot non-blank", ps.colors > 50 && ps.std > 10, JSON.stringify(ps));

  // loadout
  await page.click("#loadout-btn");
  await page.waitForSelector("#loadout:not([hidden])");
  check("loadout: 7 primaries listed", (await page.locator("#weapon-list [role=radio], #weapon-list button").count()) >= 7);
  await page.locator("#weapon-list [role=radio], #weapon-list button").nth(1).click();
  const melees = await page.locator("#melee-list [role=radio]").count();
  check("loadout: melee picker lists 4 melees (pick one)", melees === 4, String(melees));
  await page.locator('#melee-list [role=radio][data-id="pan"]').click();
  const meleeOn = await page.locator('#melee-list [role=radio][aria-checked="true"]').count();
  const kitPan = await page.locator("#kit-list").innerText();
  check("loadout: exactly one melee selected, shown in the kit list", meleeOn === 1 && /Frying Pan/.test(kitPan), kitPan.replace(/\s+/g, " "));
  for (const tab of ["hat", "stamp", "color"]) {
    await page.click(`#tab-${tab}`);
    check(`loadout: ${tab} tab has options`, (await page.locator("#cos-grid [role=radio], #cos-grid button").count()) >= 4);
  }
  await page.locator("#cos-grid [role=radio], #cos-grid button").nth(3).click();
  await sleep(1500); // allow the 3D preview to replace the 2D egg
  await shot(page, "02-loadout");
  await page.click("#loadout-done");
  await page.waitForSelector("#home:not([hidden])");
  const prof = await page.evaluate(() => JSON.parse(JSON.stringify(window.__yolkoutUI.profile)));
  check("loadout: saved to profile", !!prof.cls && !!prof.cos && prof.mel === "pan", `${prof.cls} ${prof.mel} ${JSON.stringify(prof.cos)}`);
  check("home: melee chip shows the chosen melee", /Frying Pan/.test(await page.locator("#home-weapon").innerText()));

  // settings + help + leaderboard + about dialogs
  for (const [btn, dlg, name] of [["#open-settings", "#dlg-settings", "03-settings"], ["#open-help", "#dlg-help", "04-help"], ["#open-leaderboard", "#dlg-leaderboard", "05-leaderboard"], ["#open-about", "#dlg-about", null]]) {
    await page.click(btn);
    await page.waitForSelector(`${dlg}[open]`, { timeout: 3000 }).catch(() => {});
    const open = await page.locator(`${dlg}[open]`).count();
    check(`dialog ${dlg} opens`, open === 1);
    await sleep(400);
    if (name) await shot(page, name);
    await page.keyboard.press("Escape");
    await sleep(200);
  }
  check("home: no console errors", errors.length === 0, errors.slice(0, 5).join(" | "));
  await ctx.close();

  // phone width
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const mp = await m.newPage();
  const merr = watch(mp, "mobile");
  await mp.goto(BASE + "/");
  await mp.waitForSelector("body.ready");
  await sleep(500);
  const ov = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("mobile 390px: no horizontal scroll", ov <= 0, `overflow ${ov}px`);
  await shot(mp, "06-home-mobile");
  check("mobile: no console errors", merr.length === 0, merr.slice(0, 5).join(" | "));
  await m.close();
}

/** A context with low graphics settings: headless Chromium renders WebGL in software. */
async function gameContext(browser, viewport = { width: 800, height: 450 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(() => {
    try {
      if (!localStorage.getItem("yolkout.settings.v1")) localStorage.setItem("yolkout.settings.v1", JSON.stringify({ quality: "low", shadows: false, volume: 0 }));
    } catch { /* ignore */ }
  });
  return ctx;
}

async function online(browser) {
  const ctx = await gameContext(browser);
  const page = await ctx.newPage();
  const errors = watch(page, "online");
  await page.goto(BASE + "/");
  await page.waitForSelector("body.ready");
  await page.fill("#name-input", "E2E Tester");
  await page.locator("#name-input").blur();
  const t0 = Date.now();
  await page.click("#play-btn");
  await page.waitForSelector("#hud:not([hidden])", { timeout: 20000 });
  check("online: joined match, HUD visible", true, `${Date.now() - t0} ms to HUD`);
  check("online: canvas present", (await page.locator("#game-root canvas").count()) >= 1);
  const locked = await enterGame(page);
  check("online: pointer lock acquired", locked);
  await sleep(2500);
  let s = await state(page);
  check("online: connected", s && s.connected, s ? `alive ${s.alive} hp ${s.hp} room ${s.room && s.room.code} map ${s.match.map}` : "no state");
  check("online: snapshots arriving", s && s.snaps > 0, s ? `k=${s.snaps}` : "");
  const g = await shot(page, "10-online-game");
  const gp = await pixelStats(page, g.buf);
  check("online: game canvas renders (non-blank)", gp.colors > 80 && gp.std > 8, JSON.stringify(gp));
  const hudTxt = await page.evaluate(() => ({ hp: document.getElementById("hp-num").textContent, mag: document.getElementById("ammo-mag").textContent, w: document.getElementById("w-name").textContent, timer: document.getElementById("hud-timer").textContent }));
  check("online: HUD shows hp/ammo/weapon/timer", hudTxt.hp !== "" && hudTxt.w !== "" && /\d+:\d\d/.test(hudTxt.timer), JSON.stringify(hudTxt));

  // move
  const p0 = (await state(page)).pos;
  await page.keyboard.down("KeyW");
  await page.keyboard.down("KeyA");
  await sleep(900);
  await page.keyboard.up("KeyA");
  await page.mouse.move(560, 270);
  await page.keyboard.press("Space");
  await sleep(600);
  await page.keyboard.up("KeyW");
  await sleep(300);
  s = await state(page);
  const moved = p0 && s.pos ? Math.hypot(s.pos[0] - p0[0], s.pos[2] - p0[2]) : 0;
  check("online: WASD moves the egg", moved > 1 || !s.alive, `moved ${moved.toFixed(2)} u`);
  // Software GL runs at a few fps and synthetic input is delivered late, and bots may kill us
  // mid-action, so each action is retried (re-locking, waiting to be alive) up to 3 times.
  const ready = async () => {
    await enterGame(page);
    await page.waitForFunction(() => { const s = window.__yolkoutUI.game.getState(); return s.alive && !s.weapon.reloading && !s.weapon.switching; }, null, { timeout: 12000 }).catch(() => {});
  };
  const attempt = async (name, fn) => {
    let last = "";
    for (let i = 0; i < 3; i++) {
      await ready();
      const r = await fn();
      last = r.detail + (i ? ` (try ${i + 1})` : "");
      if (r.ok) return check(name, true, last);
    }
    check(name, false, last);
  };
  await attempt("online: firing spends ammo", async () => {
    const a = await state(page);
    await page.mouse.down(); await sleep(700); await page.mouse.up(); await sleep(300);
    const b = await state(page);
    return { ok: b.weapon.mag < a.weapon.mag || b.weapon.reloading, detail: `${a.weapon.mag} -> ${b.weapon.mag}` };
  });
  await shot(page, "11-online-firing");
  await attempt("online: R starts a reload", async () => {
    if ((await state(page)).weapon.mag === (await state(page)).weapon.magSize) { await page.mouse.down(); await sleep(400); await page.mouse.up(); await sleep(200); }
    await page.keyboard.press("KeyR");
    await sleep(250);
    const b = await state(page);
    return { ok: b.weapon.reloading || b.weapon.mag === b.weapon.magSize, detail: `reloading=${b.weapon.reloading} mag=${b.weapon.mag}` };
  });
  await attempt("online: Q swaps to the sidearm", async () => {
    const a = await state(page);
    await page.keyboard.press("KeyQ");
    await page.waitForFunction((sl) => window.__yolkoutUI.game.getState().weapon.slot !== sl, a.weapon.slot, { timeout: 2000 }).catch(() => {});
    const b = await state(page);
    return { ok: b.weapon.slot !== a.weapon.slot, detail: `slot ${a.weapon.slot} -> ${b.weapon.slot} (locked ${b.locked})` };
  });
  await page.keyboard.press("KeyQ");
  await page.keyboard.press("KeyG");
  await page.keyboard.press("KeyF");
  await sleep(600);

  // scoreboard
  await page.keyboard.down("Tab");
  await sleep(400);
  const sbVis = await page.locator("#scoreboard").isVisible();
  const sbRows = await page.locator("#scoreboard tr, #scoreboard li, #scoreboard .sb-row").count();
  await shot(page, "12-online-scoreboard");
  await page.keyboard.up("Tab");
  await sleep(200);
  check("online: Tab shows scoreboard", sbVis && sbRows >= 2, `rows ${sbRows}`);
  check("online: scoreboard hides on release", !(await page.locator("#scoreboard").isVisible()));

  // chat
  await page.keyboard.press("Enter");
  await page.waitForSelector("#chat-form:not([hidden])", { timeout: 3000 }).catch(() => {});
  const chatOpen = await page.locator("#chat-form").isVisible();
  check("online: Enter opens chat", chatOpen);
  if (chatOpen) {
    await page.keyboard.type("hello from e2e");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => [...document.querySelectorAll("#chat-log li")].some((l) => l.textContent.includes("hello from e2e")), null, { timeout: 4000 }).catch(() => {});
    const got = await page.evaluate(() => [...document.querySelectorAll("#chat-log li")].some((l) => l.textContent.includes("hello from e2e")));
    check("online: chat message echoed by server", got);
    await enterGame(page);
  }

  // let the bots play a while: kills / killfeed
  // (software GL makes every synthetic input event slow, so keep them few)
  await page.keyboard.down("KeyW");
  for (let i = 0; i < 4; i++) { await page.mouse.move(480 + (i % 2 ? 90 : -90), 270); await page.mouse.down(); await sleep(700); await page.mouse.up(); }
  await page.keyboard.up("KeyW");
  await page.waitForFunction(() => document.querySelectorAll("#killfeed li").length > 0, null, { timeout: 25000 }).catch(() => {});
  const kf = await page.locator("#killfeed li").count();
  check("online: killfeed shows kills (bots fighting)", kf > 0, `${kf} entries`);
  await shot(page, "13-online-killfeed");

  // pause
  await ready();
  await page.keyboard.press("Escape");
  await page.waitForSelector("#pause:not([hidden])", { timeout: 4000 }).catch(() => {});
  const pauseVis = await page.locator("#pause").isVisible();
  check("online: Esc shows pause menu", pauseVis, `locked after Esc: ${(await state(page)).locked}`);
  await shot(page, "14-online-pause");
  s = await state(page);
  check("online: still connected after 20 s", s && s.connected, s ? `ping ${s.ping} fps ${s.fps}` : "");
  const fps = s ? s.fps : 0;
  if (pauseVis) { const b = await page.locator("#pause-leave").boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); }
  else await page.evaluate(() => window.__yolkoutUI.leave());
  await page.waitForSelector("#home:not([hidden])", { timeout: 5000 });
  check("online: leave returns to menu", true);
  check("online: no console errors", errors.length === 0, errors.slice(0, 5).join(" | "));
  await ctx.close();
  return fps;
}

async function privateRooms(browser) {
  const a = await gameContext(browser, { width: 800, height: 450 });
  const b = await gameContext(browser, { width: 800, height: 450 });
  const pa = await a.newPage(), pb = await b.newPage();
  const errors = [...watch(pa, "privA")];
  const errB = watch(pb, "privB");
  await pa.goto(BASE + "/");
  await pa.waitForSelector("body.ready");
  await pa.fill("#name-input", "Host Egg");
  await pa.click("#create-btn");
  await pa.waitForSelector("#hud:not([hidden])", { timeout: 20000 });
  const code = await pa.evaluate(() => window.__yolkoutUI.game.room.code);
  const priv = await pa.evaluate(() => window.__yolkoutUI.game.room.priv);
  check("private: room created", new RegExp(`^[A-Z0-9]{${CODE_LEN}}$`).test(code) && priv === 1, code);
  const url = await pa.evaluate(() => location.search);
  check("private: invite link in URL", url.includes(code), url);
  const listed = await (await fetch(BASE + "/api/rooms")).json();
  check("private: not listed publicly", !listed.rooms.some((r) => r.code === code));
  await pb.goto(BASE + "/?room=" + code);
  await pb.waitForSelector("body.ready");
  const filled = await pb.inputValue("#code-input");
  check("private: ?room= fills the code", filled.toUpperCase() === code, filled);
  await pb.fill("#name-input", "Guest Egg");
  await pb.click("#join-btn");
  await pb.waitForSelector("#hud:not([hidden])", { timeout: 20000 });
  const codeB = await pb.evaluate(() => window.__yolkoutUI.game.room.code);
  check("private: second player joins by code", codeB === code, codeB);
  await sleep(1500);
  const names = await pa.evaluate(() => [...window.__yolkoutUI.game._game.roster.values()].map((r) => r.n || r.name));
  check("private: host sees guest in roster", names.some((n) => /Guest/.test(n)), names.join(","));
  check("private: invited players only (no bots)", names.length === 2, names.join(","));
  // bad code
  const pc = await b.newPage();
  const errC = [];
  pc.on("pageerror", (e) => errC.push(e.message));
  await pc.goto(BASE + "/");
  await pc.waitForSelector("body.ready");
  await pc.fill("#code-input", "ZZZZZZ");
  await pc.click("#join-btn");
  // the join loads the game modules first (cold on a loaded machine), then the server answers "no room"
  await pc.waitForFunction(() => /no room|code/i.test(document.getElementById("toasts").textContent), null, { timeout: 8000 }).catch(() => {});
  const toastTxt = await pc.evaluate(() => document.getElementById("toasts").textContent);
  check("private: unknown code shows an error toast", /no room|code/i.test(toastTxt), toastTxt.slice(0, 80));
  check("private: still on home after bad code", await pc.locator("#home").isVisible());
  await shot(pa, "20-private-host");
  errors.push(...errB, ...errC);
  // the bad-code join logs the rejection via console.error by design; ignore that one
  const real = errors.filter((e) => !/no_room|No room/i.test(e));
  check("private: no console errors", real.length === 0, real.slice(0, 5).join(" | "));
  await a.close();
  await b.close();
}

async function practice(browser) {
  const ctx = await gameContext(browser);
  const page = await ctx.newPage();
  const errors = watch(page, "practice");
  await page.goto(BASE + "/");
  await page.waitForSelector("body.ready");
  await page.click("#practice-btn");
  await page.waitForSelector("#hud:not([hidden])", { timeout: 20000 });
  await enterGame(page);
  await sleep(2000);
  let s = await state(page);
  check("practice: offline game running", s && s.offline && s.connected, s ? `alive ${s.alive} map ${s.match.map}` : "");
  const g = await shot(page, "30-practice");
  const gp = await pixelStats(page, g.buf);
  check("practice: canvas renders (non-blank)", gp.colors > 80 && gp.std > 8, JSON.stringify(gp));
  // force a death through the in-browser server, then time the respawn in the page
  // (FFA: 3 s of game time; wall time checks that offline time doesn't run in slow motion)
  await page.waitForFunction(() => window.__yolkoutUI.game._game.local.human.alive, null, { timeout: 10000 }).catch(() => {});
  const r = await page.evaluate(() => new Promise((resolve) => {
    const g = window.__yolkoutUI.game._game, L = g.local;
    const k0 = L.k, t0 = performance.now();
    // hook the spawn itself: polling from the page would be late whenever a software-GL frame is slow
    let spawnK = -1, spawnT = 0;
    const orig = L._spawn;
    L._spawn = function (P) { if (P === L.human && spawnK < 0) { spawnK = L.k; spawnT = performance.now(); } return orig.call(this, P); };
    L._kill(L.human, L.human, "fall", 0);
    let sawDead = false;
    const iv = setInterval(() => {
      const s = window.__yolkoutUI.game.getState();
      if (!s.alive) sawDead = true;
      if (spawnK >= 0) { clearInterval(iv); L._spawn = orig; resolve({ sawDead, ticks: spawnK - k0, wall: (spawnT - t0) / 1000 }); }
      else if (performance.now() - t0 > 15000) { clearInterval(iv); L._spawn = orig; resolve({ sawDead, ticks: -1, wall: 15 }); }
    }, 20);
  }));
  await shot(page, "31-practice-respawned");
  check("practice: forced death shows in the HUD state", r.sawDead);
  check("practice: respawn after 3 s of game time", Math.abs(r.ticks / 60 - 3) < 0.1, `${(r.ticks / 60).toFixed(2)} s game time`);
  check("practice: respawn wall time ~3 s (no slow motion)", r.wall > 2.5 && r.wall < 5, `${r.wall.toFixed(2)} s wall`);
  const deadShot = await page.locator("#hud-respawn").count();
  check("practice: respawn panel exists", deadShot === 1);
  // change loadout from the death screen: respawn is held while choosing, then you drop in with the new gun
  await page.evaluate(() => { const L = window.__yolkoutUI.game._game.local; L._kill(L.human, L.human, "fall", 0); });
  await page.waitForSelector("#respawn-loadout:not([hidden])", { state: "visible", timeout: 5000 }).catch(() => {});
  // L works while the mouse is locked; the button works when it isn't
  await page.keyboard.press("KeyL");
  await sleep(300);
  let via = "L key";
  if (!(await page.locator("#loadout:not([hidden])").count())) { via = "button"; await page.click("#respawn-loadout", { timeout: 5000 }).catch(() => {}); }
  const ldOpen = await page.locator("#loadout:not([hidden])").count();
  check("practice: death-screen loadout opens", ldOpen === 1, `via ${via}`);
  await sleep(5000); // past the 3 s respawn timer
  const held = await page.evaluate(() => { const H = window.__yolkoutUI.game._game.local.human; return { alive: H.alive, hold: !!H.hold, cls: H.cls, mel: H.mel }; });
  check("practice: respawn held while choosing", !held.alive && held.hold, JSON.stringify(held));
  const pick = await page.evaluate((cur) => {
    const b = [...document.querySelectorAll("#weapon-list .weapon-btn")].find((x) => x.getAttribute("aria-checked") !== "true");
    if (b) b.click();
    const m = [...document.querySelectorAll("#melee-list .weapon-btn")].find((x) => x.getAttribute("aria-checked") !== "true");
    if (m) m.click();
    return (b ? b.dataset.id || b.textContent.trim() : "") + "/" + (m ? m.dataset.id : "");
  }, held.cls);
  await page.click("#loadout-done");
  await sleep(500);
  const after = await page.evaluate(() => { const H = window.__yolkoutUI.game._game.local.human; return { alive: H.alive, hold: !!H.hold, cls: H.cls, spawnCls: H.spawnCls, mel: H.mel, spawnMel: H.spawnMel }; });
  check("practice: save respawns at once with the new primary", after.alive && !after.hold && after.spawnCls !== held.cls && after.spawnCls === after.cls, `${held.cls} -> ${JSON.stringify(after)} (${pick})`);
  check("practice: ... and the new melee", after.spawnMel !== held.mel && after.spawnMel === after.mel, `${held.mel} -> ${after.spawnMel} (${pick})`);
  check("practice: no console errors", errors.length === 0, errors.slice(0, 5).join(" | "));
  await ctx.close();
}

// v2 mechanics in practice mode: melee loadout persisted + applied at spawn, straight rocket, full-screen scopes,
// health-driven shell cracks (own overlay + other eggs), tracers never pass a wall, no console errors.
async function v2(browser) {
  const ctx = await gameContext(browser, { width: 960, height: 540 });
  const page = await ctx.newPage();
  const errors = watch(page, "v2");
  await page.goto(BASE + "/");
  await page.waitForSelector("body.ready");
  await page.click("#loadout-btn");
  await page.waitForSelector("#loadout:not([hidden])");
  await page.locator('#weapon-list [role=radio][data-id="souffle"]').click();
  await page.locator('#melee-list [role=radio][data-id="whisk"]').click();
  await page.click("#loadout-done");
  await page.waitForSelector("#home:not([hidden])");
  await page.reload();
  await page.waitForSelector("body.ready");
  const prof = await page.evaluate(() => JSON.parse(JSON.stringify(window.__yolkoutUI.profile)));
  check("v2: melee + primary persist across a reload", prof.mel === "whisk" && prof.cls === "souffle", `${prof.cls} ${prof.mel}`);
  await page.click("#practice-btn");
  await page.waitForSelector("#hud:not([hidden])", { timeout: 20000 });
  await enterGame(page);
  await page.waitForFunction(() => { const g = window.__yolkoutUI.game; return g && g._game.local && g._game.local.human.alive && g._game.predictor; }, null, { timeout: 15000 });
  await sleep(800);
  const sp = await page.evaluate(() => {
    const g = window.__yolkoutUI.game._game, H = g.local.human, hs = g.hudState ? g.hudState() : null;
    return { spawnMel: H.spawnMel, mel: H.mel, defsMel: H.defs && H.defs.melee && H.defs.melee.id, vm: g.vm.meleeId,
      predMel: g.predictor.defs.melee && g.predictor.defs.melee.id, hud: hs && hs.melee ? hs.melee.id : null, cls: H.spawnCls || H.cls };
  });
  check("v2: chosen melee applied at spawn (server, predictor, view model)", sp.spawnMel === "whisk" && sp.vm === "whisk" && (sp.predMel || "whisk") === "whisk", JSON.stringify(sp));

  // ---- full-screen scope with the launcher
  const scopeOn = async () => {
    await page.evaluate(() => window.__yolkoutUI.game._game.debugHooks().setAds(true));
    const on = await page.waitForFunction(() => window.__yolkoutUI.game._game.overlay.scopeOn, null, { timeout: 4000 }).then(() => true).catch(() => false);
    return { on };
  };
  let sc = await scopeOn();
  await shot(page, "40-v2-scope-launcher");
  check("v2: ADS with the launcher shows the full-screen scope", sc.on, JSON.stringify(sc));
  await page.evaluate(() => window.__yolkoutUI.game._game.debugHooks().setAds(false));
  await sleep(400);
  const off = await page.evaluate(() => window.__yolkoutUI.game._game.overlay.scopeOn);
  check("v2: scope closes when ADS is released", !off);

  // ---- rocket flies straight: fire into open space, sample the server projectile and the drawn mesh
  const rk = await page.evaluate(async () => {
    const g = window.__yolkoutUI.game._game, Y = g.debugHooks(), Phys = await import("/js/engine/physics.js");
    const L = g.local, H = L.human;
    H.hp = 1e9; // keep the test egg alive while bots roam
    const s = Y.state();
    let yaw = null, bestT = 0;
    for (let k = 0; k < 72; k++) {
      const a = (k / 72) * Math.PI * 2, d = Phys.aimDir(a, 0.12);
      let t = Phys.raycastWorld(g.world, s.x, s.y + g.C.eyeHeight, s.z, d[0], d[1], d[2], 60);
      if (t < 0) t = 60;
      if (t > bestT) { bestT = t; yaw = a; }
    }
    Y.camAt(s.x, s.y, s.z, yaw, 0.12); // aim a little up: gravity would bend this into an arc
    await new Promise((r) => setTimeout(r, 300));
    const before = new Set(L.proj.map((p) => p.id));
    const S = [], M = [], t0 = performance.now();
    let id = null;
    // record every simulation step (frames are slow on software GL, so several ticks run per frame)
    const oS = L._stepProjectiles, oP = g._stepPredicted;
    L._stepProjectiles = function () {
      const r = oS.apply(this, arguments);
      const pr = L.proj.find((p) => p.kind === 1 && p.owner === H.id && !before.has(p.id) && (id === null || p.id === id));
      if (pr) { id = pr.id; S.push([pr.x, pr.y, pr.z, pr.vy]); }
      return r;
    };
    g._stepPredicted = function () {
      const r = oP.apply(this, arguments);
      for (const pp of g.predProj) if (pp.kind === 1 && !pp.exploded) M.push([pp.pr.x, pp.pr.y, pp.pr.z]);
      return r;
    };
    Y.fire(2);
    await new Promise((resolve) => {
      const iv = setInterval(() => {
        const alive = id !== null && L.proj.some((p) => p.id === id);
        if ((id !== null && !alive) || performance.now() - t0 > 2500) { clearInterval(iv); resolve(); }
      }, 20);
    });
    L._stepProjectiles = oS; g._stepPredicted = oP;
    // largest distance of any sample from the line through the first and last samples
    const dev = (P) => {
      if (P.length < 3) return -1;
      const a = P[0], b = P[P.length - 1], ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], n = Math.hypot(...ab);
      let m = 0;
      for (const p of P) {
        const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
        const cx = ap[1] * ab[2] - ap[2] * ab[1], cy = ap[2] * ab[0] - ap[0] * ab[2], cz = ap[0] * ab[1] - ap[1] * ab[0];
        m = Math.max(m, Math.hypot(cx, cy, cz) / n);
      }
      return m;
    };
    const len = (P) => (P.length > 1 ? Math.hypot(P[P.length - 1][0] - P[0][0], P[P.length - 1][1] - P[0][1], P[P.length - 1][2] - P[0][2]) : 0);
    const vys = S.map((p) => p[3]);
    return { n: S.length, dist: +len(S).toFixed(2), dev: +dev(S).toFixed(5), vy: vys.length ? +(Math.max(...vys) - Math.min(...vys)).toFixed(6) : -1,
      rise: S.length > 1 ? +(S[S.length - 1][1] - S[0][1]).toFixed(2) : 0, mn: M.length, mdist: +len(M).toFixed(2), mdev: +dev(M).toFixed(4) };
  });
  check("v2: rocket flies straight (server projectile: constant vy, collinear path)", rk.n >= 4 && rk.dist > 3 && rk.vy === 0 && rk.dev >= 0 && rk.dev < 0.01, JSON.stringify(rk));
  check("v2: drawn rocket flies straight too", rk.mn >= 3 && rk.mdev >= 0 && rk.mdev < 0.03, JSON.stringify(rk));
  await sleep(2500); // past the launcher reload

  // ---- swap primary to the sniper (through the loadout API + a respawn) and scope again
  await page.evaluate(() => { const g = window.__yolkoutUI.game._game; g.local.human.hp = 100; g.local._kill(g.local.human, g.local.human, "fall", 0); window.__yolkoutUI.game.setLoadout({ cls: "piercer" }); });
  await page.waitForFunction(() => { const g = window.__yolkoutUI.game._game; return g.local.human.alive && g.vm.currentId === "piercer"; }, null, { timeout: 10000 }).catch(() => {});
  await sleep(600);
  sc = await scopeOn();
  await shot(page, "41-v2-scope-sniper");
  check("v2: ADS with the sniper shows the full-screen scope", sc.on, JSON.stringify(sc));
  await page.evaluate(() => window.__yolkoutUI.game._game.debugHooks().setAds(false));
  await sleep(300);

  // ---- cracks follow health: own screen overlay and other eggs' shells
  const cr = await page.evaluate(async () => {
    const g = window.__yolkoutUI.game._game, L = g.local, H = L.human;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = {};
    H.protEnd = 1e12; // no bot damage while the test sets hp by hand
    for (const hp of [100, 60, 35, 12, 100]) {
      H.hp = hp; H.lastDmgK = 1e12;
      await wait(700);
      out["me" + hp + (out["me" + hp] ? "b" : "")] = g.overlay.crackA.map((v) => +v.toFixed(2)).join("/");
    }
    const bot = [...L.players.values()].find((p) => p !== H && p.alive && g.avatars.get(p.id));
    if (bot) {
      const av = g.avatars.get(bot.id);
      bot.protEnd = 1e12; bot.hp = 100; await wait(500); out.bot100 = +av.anim.crack.toFixed(2);
      bot.hp = 15; bot.lastDmgK = 1e12; await wait(700); out.bot15 = +av.anim.crack.toFixed(2);
      bot.hp = 100; bot.protEnd = 0;
    }
    H.protEnd = 0;
    return out;
  });
  const st = (k) => (cr[k] || "").split("/").map(Number);
  const okMe = st("me100").every((v) => v < 0.05) && st("me60")[0] > 0.9 && st("me60")[1] < 0.1 && st("me35")[1] > 0.9 && st("me12")[2] > 0.9 && st("me100b").every((v) => v < 0.05);
  check("v2: own shell cracks grow as hp drops and heal back", okMe, JSON.stringify(cr));
  check("v2: other eggs' shells crack with their health", cr.bot100 === undefined || (cr.bot100 < 0.2 && cr.bot15 > 2.5), `bot crack stage ${cr.bot100} -> ${cr.bot15}`);

  // ---- wall shot: rifle + shotgun tracers never reach past the first solid hit
  for (const cls of ["benedict", "deviler"]) {
    await page.evaluate((cls) => { const g = window.__yolkoutUI.game._game; g.local.human.hp = 100; g.local._kill(g.local.human, g.local.human, "fall", 0); window.__yolkoutUI.game.setLoadout({ cls }); }, cls);
    await page.waitForFunction((cls) => { const g = window.__yolkoutUI.game._game; return g.local.human.alive && g.vm.currentId === cls; }, cls, { timeout: 10000 }).catch(() => {});
    await sleep(500);
    const res = await page.evaluate(async (gid) => {
      const g = window.__yolkoutUI.game._game, Y = g.debugHooks(), Phys = await import("/js/engine/physics.js");
      g.local.human.hp = 1e9;
      const s = Y.state(), eyeH = g.C.eyeHeight;
      let best = null;
      for (let k = 0; k < 96 && !best; k++) {
        const yaw = (k / 96) * Math.PI * 2, d = Phys.aimDir(yaw, 0);
        const t = Phys.raycastWorld(g.world, s.x, s.y + eyeH, s.z, d[0], d[1], d[2], 20);
        if (t < 3 || t > 14) continue;
        best = { yaw, d, t };
      }
      if (!best) return { err: "no wall found" };
      Y.camAt(s.x + best.d[0] * (best.t - 2), s.y, s.z + best.d[2] * (best.t - 2), best.yaw, 0);
      const holes0 = g.effects.holes.used, ring = g.effects.holes.next ?? null;
      await new Promise((r) => setTimeout(r, 300));
      Y.fire(gid === "deviler" ? 3 : 40);
      const out = { bad: 0, n: 0, maxOver: -9 };
      const s1 = Y.state(), s0 = [s1.x, s1.y + eyeH, s1.z].map((v) => +v.toFixed(2));
      const t0 = performance.now();
      while (performance.now() - t0 < (gid === "deviler" ? 700 : 1000)) {
        for (const tr of g.effects.tracers) {
          const head = Math.min(tr.L, tr.t * tr.speed);
          const tw = Phys.raycastWorld(g.world, tr.sx, tr.sy, tr.sz, tr.dx, tr.dy, tr.dz, 200);
          if (tw < 0) continue;
          out.n++;
          out.maxOver = Math.max(out.maxOver, head - tw);
          if (head > tw + 0.02) { out.bad++; if (!out.ex || out.ex.length < 4) (out.ex = out.ex || []).push({ c: tr.color.toString(16), s: [tr.sx, tr.sy, tr.sz].map((v) => +v.toFixed(2)), d: [tr.dx, tr.dy, tr.dz].map((v) => +v.toFixed(3)), L: +tr.L.toFixed(2), head: +head.toFixed(2), tw: +tw.toFixed(2), me: s0 }); }
        }
        await new Promise((r) => requestAnimationFrame(r));
      }
      out.holes = g.effects.holes.used - holes0;
      if (out.holes <= 0 && ring !== null) out.holes = (g.effects.holes.next ?? ring) !== ring ? 1 : 0; // pool already full
      return out;
    }, cls);
    check(`v2: ${cls} tracers stop at the wall`, !res.err && res.bad === 0 && res.holes > 0, JSON.stringify(res));
  }
  await shot(page, "42-v2-wall");
  check("v2: no console errors", errors.length === 0, errors.slice(0, 5).join(" | "));
  await ctx.close();
}

async function matchLifecycle(browser) {
  const port = +new URL(BASE).port + 1;
  const base2 = `http://127.0.0.1:${port}`;
  const dir = mkdtempSync(join(tmpdir(), "yolkout-e2e-"));
  cpSync(join(REPO, "shared", "data"), join(dir, "data"), { recursive: true });
  const mf = join(dir, "data", "modes.json");
  const modes = JSON.parse(readFileSync(mf, "utf8"));
  modes.modes.ffa.timeLimitSec = 25;
  writeFileSync(mf, JSON.stringify(modes));
  const srv = spawn(SERVER_BIN, ["-addr", `127.0.0.1:${port}`, "-web", join(REPO, "web"), "-shared", join(REPO, "shared"), "-data", join(dir, "data"), "-stats", "", "-bots", "0"], { stdio: ["ignore", "pipe", "pipe"] });
  let srvLog = "";
  srv.stdout.on("data", (d) => (srvLog += d));
  srv.stderr.on("data", (d) => (srvLog += d));
  try {
    for (let i = 0; i < 50; i++) { try { if ((await fetch(base2 + "/healthz")).ok) break; } catch { /* starting */ } await sleep(100); }
    const ctx = await gameContext(browser);
    const page = await ctx.newPage();
    const errors = watch(page, "match");
    await page.goto(base2 + "/");
    await page.waitForSelector("body.ready");
    await page.fill("#name-input", "Lifecycle Egg");
    await page.click("#play-btn");
    await page.waitForSelector("#hud:not([hidden])", { timeout: 20000 });
    // (no pointer lock here: nothing below needs input, and a locked pointer makes headless
    // software GL stall screenshots)
    const map0 = (await state(page)).match.map;
    await page.waitForSelector("#match-end:not([hidden])", { timeout: 40000 }).catch(() => {});
    const endVis = await page.locator("#match-end").isVisible();
    check("match: results screen at time limit", endVis);
    const endTxt = endVis ? await page.locator("#end-body").innerText() : "";
    check("match: results list players", /Lifecycle Egg/.test(endTxt), endTxt.replace(/\s+/g, " ").slice(0, 120));
    await shot(page, "40-match-results");
    // 10 s intermission, then `start` loads the next map
    await page.waitForFunction((m0) => { const g = window.__yolkoutUI.game; const s = g && g.getState(); return s && s.match.state === "live" && s.match.map !== m0; }, map0, { timeout: 25000 }).catch(() => {});
    const s1 = await state(page);
    check("match: next match starts on a new map", s1 && s1.match.state === "live" && s1.match.map !== map0, `${map0} -> ${s1 && s1.match.map}`);
    await page.waitForFunction(() => window.__yolkoutUI.game.getState().alive, null, { timeout: 8000 }).catch(() => {});
    check("match: respawned after start", (await state(page)).alive);
    check("match: results screen hidden after start", !(await page.locator("#match-end").isVisible()));
    await sleep(1000);
    await shot(page, "41-match-next-map");
    // graceful shutdown -> disconnect screen
    srv.kill("SIGTERM");
    await page.waitForSelector("#disconnected:not([hidden])", { timeout: 8000 }).catch(() => {});
    const disc = await page.locator("#disconnected").isVisible();
    const discMsg = disc ? await page.locator("#disc-msg").innerText() : "";
    check("match: server shutdown shows the disconnect screen", disc && /restart/i.test(discMsg), discMsg.slice(0, 80));
    await shot(page, "42-disconnected");
    const real = errors.filter((e) => !/WebSocket|ERR_CONNECTION_REFUSED|socket/i.test(e));
    check("match: no console errors", real.length === 0, real.slice(0, 5).join(" | "));
    await ctx.close();
  } finally {
    if (srv.exitCode === null) srv.kill("SIGKILL");
    rmSync(dir, { recursive: true, force: true });
    if (process.env.E2E_DEBUG) console.log(srvLog);
  }
}

const browser = await launch();
console.log(`e2e against ${BASE} with ${browser.version()}`);
let fps = 0;
try {
  if (want("home")) await home(browser);
  if (want("online")) fps = await online(browser);
  if (want("private")) await privateRooms(browser);
  if (want("practice")) await practice(browser);
  if (want("v2")) await v2(browser);
  if (SERVER_BIN && want("match")) await matchLifecycle(browser);
  else console.log("(skipping match lifecycle: pass --server <binary> to run it)");
} catch (e) {
  check("e2e run finished without exceptions", false, e.stack || String(e));
} finally {
  await browser.close();
}
console.log(`\n${results.length - failures}/${results.length} checks passed; software-GL fps ${fps}; screenshots in ${OUT}`);
process.exit(failures ? 1 : 0);
