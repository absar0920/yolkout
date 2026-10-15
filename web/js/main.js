// Yolkout game client: public integration API (used by the UI layer).
// Full reference: shared/CLIENT_API.md
//
//   import { startGame, loadGameData, DEFAULT_SETTINGS } from "/js/main.js";
//
//   const game = await startGame({
//     container,              // element the game fills (position: relative is applied if static)
//     canvas,                 // optional existing <canvas>; created inside container if absent
//     name: "Eggbert",        // display name (server sanitises)
//     cls: "benedict",        // primary weapon id (weapons.primaries)
//     cosmetics: { hat, color, stamp },
//     mode: "ffa",            // "ffa" | "teams" | "nest" (quickplay / create)
//     map: "",                // preferred map when creating a room ("" = random)
//     roomCode: "",           // join a private room by code ("" = quickplay)
//     createRoom: false,      // true = create a private room (code arrives in onRoom)
//     offline: false,         // true = practice vs bots in the browser, no server
//     bots: 5, difficulty: 0.5, // offline only
//     url: undefined,         // websocket url (default ws(s)://<host>/ws)
//     settings: { ...DEFAULT_SETTINGS },
//     callbacks: {
//       onHud(state), onKillfeed(ev), onScoreboard(data), onScoreboardToggle(visible),
//       onChat(msg), onChatOpen({teamOnly}), onMatchStart(info), onMatchEnd(data),
//       onDisconnect(reason), onPing(ms), onRoom(info), onPauseChange(paused),
//       onStreak(ev), onPickup(ev), onFlag(ev), onHitConfirm(ev), onDamaged(ev), onSpawn(ev)
//     },
//   });
//   // resolves after `welcome` + map load; rejects with Error{code} (room_full, no_room, version, socket, timeout, ...)
//
//   game.stop()                       leave the room and free everything
//   game.sendChat(text, teamOnly)     send chat and close the chat state (call resume() afterwards)
//   game.setSettings(partial)         live settings change
//   game.setLoadout({cls, cosmetics}) primary applies at next spawn, cosmetics immediately
//   game.pause() / game.resume()      release / re-acquire pointer lock (resume must run in a user gesture)
//   game.lockPointer()                request pointer lock (user gesture)
//   game.getState()                   same object as the last onHud(state)
//   game.room                         {code, mode, map, priv, max}
//
// The game draws the crosshair, hit markers, damage arrows, scope and debug panel on its own
// overlay canvas inside `container`; everything else (health, ammo, killfeed, scoreboard, chat,
// menus) is the UI's job, fed by the callbacks above.

import { loadData } from "./engine/physics.js";
import { Game, DEFAULT_SETTINGS } from "./game/game.js";
import { DEFAULT_BINDS } from "./game/input.js";

export { DEFAULT_SETTINGS, DEFAULT_BINDS };

let dataPromise = null;

/**
 * Fetch and cache all shared data (rules, weapons, modes, cosmetics, map index).
 * The UI can use it for menus (weapon stats, cosmetic lists, map names).
 */
export function loadGameData(base = "/data/") {
  if (!dataPromise) {
    const root = base.endsWith("/") ? base : base + "/";
    const fetchJson = async (p) => {
      const r = await fetch(root + p, { cache: "no-cache" });
      if (!r.ok) throw new Error(`GET ${root + p}: ${r.status}`);
      return r.json();
    };
    dataPromise = loadData(fetchJson).catch((e) => { dataPromise = null; throw e; });
  }
  return dataPromise;
}

/** Start a game session. See the header comment / shared/CLIENT_API.md. */
export async function startGame(opts = {}) {
  const data = await loadGameData(opts.dataBase);
  const game = new Game(data, opts);
  try {
    await game.connect();
  } catch (e) {
    game.stop();
    throw e;
  }
  return {
    stop: () => game.stop(),
    sendChat: (text, teamOnly = false) => game.sendChat(text, teamOnly),
    cancelChat: () => game.closeChat(),
    setSettings: (s) => game.setSettings(s),
    setLoadout: (l) => game.setLoadout(l),
    pause: () => game.pause(),
    resume: () => game.resume(),
    lockPointer: () => game.input.lock(),
    getState: () => game.hudState(),
    get room() { return game.room; },
    get paused() { return game.paused; },
    get myId() { return game.myId; },
    /** escape hatch for debugging / tests */
    _game: game,
  };
}
