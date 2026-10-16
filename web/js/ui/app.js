// Yolkout UI entry point: boots menus from /data, starts/stops game sessions through the
// client API in /js/main.js (loaded lazily so the home screen paints instantly).

import { $, toast } from "./dom.js";
import { loadMenuData } from "./data.js";
import { loadProfile, saveProfile, loadSettings } from "./store.js";
import { initHome } from "./home.js";
import { initLoadout } from "./loadout.js";
import { initSettings } from "./settings.js";
import { initHelp, initLeaderboard, initAbout } from "./panels.js";
import { initHud } from "./hud.js";
import { sfx } from "../audio.js";

const app = {
  data: null,
  profile: loadProfile(),
  settings: loadSettings(),
  game: null,
  session: null, // last start options (for reconnect)
  starting: 0,
};
sfx.setVolume(app.settings.volume);

let mainMod = null;
const loadMain = () => (mainMod ||= import("../main.js").catch((e) => { mainMod = null; throw e; }));

function ensureProfile(data) {
  const P = app.profile;
  const W = data.weapons;
  if (!W.primaries.includes(P.cls)) P.cls = W.defaultPrimary || W.primaries[0];
  const C = data.cosmetics;
  const cos = Object.assign({}, C.defaults, P.cos || {});
  if (!C.colors.some((c) => c.id === cos.color)) cos.color = C.defaults.color;
  if (!C.hats.some((c) => c.id === cos.hat)) cos.hat = C.defaults.hat;
  if (!C.stamps.some((c) => c.id === cos.stamp)) cos.stamp = C.defaults.stamp;
  P.cos = cos;
  saveProfile(P);
}

function setLoading(on, text = "") {
  const el = $("#loading");
  el.hidden = !on;
  if (text) $("#loading-text").textContent = text;
  if (on) $("#loading-cancel").focus();
}

function showScreen(which) {
  if (which === "home") {
    $("#game-root").hidden = true;
    app.hud.hide();
    app.home.show();
    document.body.classList.remove("in-game");
  } else {
    app.home.hide();
    $("#game-root").hidden = false;
    document.body.classList.add("in-game");
  }
}

const ERR = {
  room_full: "That room is full.",
  no_room: "No room with that code. Check it and try again.",
  server_full: "The server is full right now. Try again in a moment.",
  too_many: "Too many attempts. Wait a minute and try again.",
  version: "Your game is out of date. Reload the page.",
  socket: "Can't reach the game server. Try Practice mode to play offline.",
  timeout: "The server took too long to answer.",
  unavailable: "Online play isn't available on this server yet. Try Practice mode.",
  bad_hello: "The server rejected the join request.",
};

app.sessionSeq = 0;

app.play = async function play(opts) {
  if (app.starting) return;
  // unique per start (app.starting is reset to 0 by Cancel, so it cannot identify a session)
  const token = ++app.sessionSeq;
  app.starting = token;
  sfx.unlock();
  sfx.play("ui_click");
  const label = opts.offline ? "Warming up the practice range..." : opts.roomCode ? `Joining room ${opts.roomCode}...` : opts.createRoom ? "Creating a private room..." : "Finding a match...";
  setLoading(true, label);
  let cancelled = false;
  app.cancelStart = () => { cancelled = true; };
  // A cancelled start may still be connecting while the next one runs: it must not touch the
  // screen, #game-root or the shared HUD callbacks once it is no longer the current session.
  const current = () => !cancelled && app.sessionSeq === token;
  let host = null;
  try {
    const main = await loadMain();
    if (!current()) return;
    const root = $("#game-root");
    root.textContent = "";
    root.hidden = false; // renderer measures its container
    host = document.createElement("div"); // this session's own container
    host.className = "game-session";
    root.appendChild(host);
    app.hud.reset();
    const callbacks = {};
    for (const [k, f] of Object.entries(app.hud.callbacks)) callbacks[k] = typeof f === "function" ? (...a) => (current() ? f(...a) : undefined) : f;
    const P = app.profile;
    app.session = Object.assign({}, opts);
    const game = await main.startGame({
      container: host,
      name: P.name,
      cls: P.cls,
      primaryWeapon: P.cls,
      cosmetics: P.cos,
      mode: opts.mode || P.mode,
      map: opts.map || "",
      roomCode: opts.roomCode || "",
      createRoom: !!opts.createRoom,
      offline: !!opts.offline,
      bots: P.practiceBots ?? 5,
      difficulty: P.practiceDifficulty ?? 0.5,
      settings: Object.assign({}, app.settings),
      callbacks,
    });
    if (!current()) {
      try { game.stop(); } catch { /* ignore */ }
      host.remove();
      if (app.sessionSeq === token) showScreen("home");
      return;
    }
    app.game = game;
    app.hud.attach(game);
    showScreen("game");
    app.hud.start();
  } catch (e) {
    console.error(e);
    if (host) host.remove();
    if (app.sessionSeq === token) showScreen("home");
    if (current()) {
      toast(ERR[e && e.code] || (e && e.message) || "Could not start the game.", "error", 5200);
      sfx.play("empty");
    }
  } finally {
    if (token === app.starting) app.starting = 0;
    app.cancelStart = null;
    setLoading(false);
  }
};

app.leave = function leave() {
  const g = app.game;
  app.game = null;
  if (g) { try { g.stop(); } catch (e) { console.warn(e); } }
  if (document.pointerLockElement) { try { document.exitPointerLock(); } catch { /* ignore */ } }
  $("#game-root").textContent = "";
  try { history.replaceState(null, "", location.pathname); } catch { /* ignore */ }
  showScreen("home");
  $("#play-btn").focus();
};

app.reconnect = function reconnect() {
  const opts = app.session ? Object.assign({}, app.session) : {};
  if (app.lastRoom && app.lastRoom.private) { opts.roomCode = app.lastRoom.code; opts.createRoom = false; }
  app.leave();
  app.play(opts);
};

app.onRoom = function onRoom(info) {
  app.lastRoom = info;
  if (info.private && !info.offline) {
    try { history.replaceState(null, "", `${location.pathname}?room=${encodeURIComponent(info.code)}`); } catch { /* ignore */ }
    toast(`Private room ${info.code}: share the code or the page link with friends.`, "info", 6000);
  }
};

app.applySettings = function applySettings(patch) {
  if (app.game) { try { app.game.setSettings(patch); } catch (e) { console.warn(e); } }
};

app.isMenuOpen = () => !!(app.loadout && app.loadout.isOpen) || !!document.querySelector("dialog[open]");
app.onDialogClosed = () => { if (app.hud) app.hud.refreshOverlays(); };

app.openSettings = () => { app.settingsDlg.open(); app.hud.refreshOverlays(); };
app.openHelp = () => { app.helpDlg.open(); app.hud.refreshOverlays(); };
app.openLoadoutInGame = () => {
  const g = app.game;
  const dead = !!(g && !g.getState().alive);
  // While dead, ask the server to hold the respawn so you come back with the new gun.
  if (dead) { try { g.setLoadout({ hold: true }); } catch (e) { console.warn(e); } }
  app.loadout.open((saved) => {
    const game = app.game;
    if (game) {
      const stillDead = !game.getState().alive;
      const patch = saved ? { cls: app.profile.cls, cosmetics: app.profile.cos } : {};
      if (dead) patch.hold = false;
      if (saved || dead) { try { game.setLoadout(patch); } catch (e) { console.warn(e); } }
      if (saved) toast(stillDead ? "Loadout saved: respawning with your new primary." : "Loadout saved: new primary at your next respawn.", "info");
      // Saving from the death screen drops you straight back in (the click is the user gesture pointer lock needs).
      if (saved && dead) { try { game.resume(); } catch (e) { console.warn(e); } }
    }
    app.hud.refreshOverlays();
  }, { inGame: true, dead });
  app.hud.refreshOverlays();
};

async function boot() {
  try {
    app.data = await loadMenuData();
  } catch (e) {
    console.error(e);
    $("#boot-error").hidden = false;
    $("#boot-retry").addEventListener("click", () => location.reload());
    return;
  }
  ensureProfile(app.data);
  app.hud = initHud(app);
  app.home = initHome(app);
  app.loadout = initLoadout(app);
  app.settingsDlg = initSettings(app);
  app.helpDlg = initHelp(app);
  app.lbDlg = initLeaderboard(app);
  app.aboutDlg = initAbout(app);

  $("#open-settings").addEventListener("click", () => app.settingsDlg.open());
  $("#open-help").addEventListener("click", () => app.helpDlg.open());
  $("#open-leaderboard").addEventListener("click", () => app.lbDlg.open());
  $("#open-about").addEventListener("click", () => app.aboutDlg.open());
  $("#footer-about").addEventListener("click", () => app.aboutDlg.open());
  $("#loadout-btn").addEventListener("click", () => {
    sfx.play("ui_click");
    app.home.hide();
    app.loadout.open(() => app.home.show());
  });
  $("#loading-cancel").addEventListener("click", () => {
    if (app.cancelStart) app.cancelStart();
    app.starting = 0;
    setLoading(false);
    showScreen("home");
  });
  // small hover ticks on primary buttons (desktop only)
  document.addEventListener("pointerover", (e) => {
    if (e.pointerType !== "mouse") return;
    const b = e.target.closest && e.target.closest(".btn-play, .top-nav button");
    if (b && !b.contains(e.relatedTarget)) sfx.play("ui_hover");
  });

  document.body.classList.add("ready");
  showScreen("home");

  // Warm the game modules (three.js, sim) in the background once the menu is up.
  const warm = () => loadMain().then((m) => m.loadGameData && m.loadGameData()).catch(() => {});
  if ("requestIdleCallback" in window) requestIdleCallback(warm, { timeout: 2500 }); else setTimeout(warm, 1200);

  window.addEventListener("beforeunload", () => { if (app.game) { try { app.game.stop(); } catch { /* ignore */ } } });
}

// Debug/test handle (no secrets; lets tests drive the UI).
window.__yolkoutUI = app;

boot();
