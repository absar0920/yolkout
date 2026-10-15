# Yolkout client API (for the UI layer)

The game client lives in `web/js/` (`main.js`, `engine/`, `net/`, `game/`). The UI (menus, HUD,
killfeed, scoreboard, chat) imports it and drives it through one function, `startGame`. The UI
owns `web/index.html`, `web/css/` and `web/js/audio.js`. The game owns the WebGL canvas and a 2D
overlay canvas: crosshair, hit markers, damage arrows, sniper scope, low-health vignette and the
debug panel.

```js
import { startGame, loadGameData, DEFAULT_SETTINGS, DEFAULT_BINDS } from "/js/main.js";
```

The page must provide the import map `{"three": "/vendor/three.module.min.js", "yolkout/sim": "/ref/sim.mjs"}`.
The current `index.html` already has it. The client imports three.js by a relative path to `/vendor/`, so both
specifiers resolve to the same module instance.

## `loadGameData(base = "/data/") -> Promise<data>`

Loads and caches `rules`, `weapons`, `modes`, `cosmetics` and `mapIndex` (the parsed JSON files).
The UI can use it for menus: weapon stats, cosmetic lists, map and mode names.
`data.map(id)` returns `{json, world}` for one map. `startGame` calls `loadGameData` itself, and the result is cached.

## `startGame(opts) -> Promise<controller>`

The promise resolves after `welcome` arrives and the map has loaded. The game is then rendering and the
player spawns right away. It rejects with an `Error` that has a `code` (`room_full`, `no_room`,
`server_full`, `version`, `bad_hello`, `unavailable`, `socket`, `timeout`, ...) and `message`.

| opt | type | meaning |
|---|---|---|
| `container` | Element | the element the game fills. It must have a size. The canvas and overlay are absolutely positioned inside it (`position: relative` is applied if it is `static`). |
| `canvas` | HTMLCanvasElement | optional existing canvas, for example `#game`. It is un-hidden. If omitted, one is created in `container`. |
| `name` | string | display name (the server sanitises it) |
| `cls` | string | primary weapon id from `weapons.primaries` |
| `cosmetics` | `{hat, color, stamp}` | cosmetic ids from `cosmetics.json` |
| `mode` | `"ffa" \| "teams" \| "nest"` | quickplay mode, or the mode of a created room |
| `map` | string | preferred map when creating a room (`""` = random) |
| `roomCode` | string | join a private room by code (`""` = quickplay) |
| `createRoom` | bool | create a private room. The code arrives in `onRoom` and in `controller.room.code`. |
| `offline` | bool | practice against bots, all inside the browser with no server (`net/localserver.js`) |
| `bots`, `difficulty` | number | offline only: bot count (0–11, default 5) and skill (0–1, default 0.5) |
| `url` | string | WebSocket URL override (default `ws(s)://<page host>/ws`) |
| `settings` | object | see Settings |
| `callbacks` | object | see Callbacks. Every callback is optional, and exceptions inside them are caught. |

Call `stop()` on the previous controller before starting a new game.

### Controller

| member | meaning |
|---|---|
| `stop()` | close the socket, stop rendering, remove the canvases the game created, and free GPU memory |
| `sendChat(text, teamOnly=false)` | send a chat line (at most 120 characters) and leave chat mode. Call `resume()` afterwards, inside the same key or click handler, to re-lock the mouse. |
| `cancelChat()` | leave chat mode without sending. Call `resume()` afterwards. |
| `setSettings(partial)` | apply settings live |
| `setLoadout({cls, cosmetics})` | sends `ld`. A new primary applies at the next spawn; cosmetics apply immediately. |
| `pause()` | release pointer lock. Input is ignored and the game keeps running, because this is multiplayer. |
| `resume()` | request pointer lock (**must be called from a user gesture**). Paused state ends when the lock is granted. |
| `lockPointer()` | request pointer lock (user gesture), for example from a "click to play" overlay |
| `getState()` | the same object as the latest `onHud(state)` |
| `room` | `{code, mode, map, priv, max}` |
| `paused`, `myId` | read-only |

Clicking the game canvas also requests pointer lock (setting `clickToLock`).

## Callbacks

| callback | argument |
|---|---|
| `onHud(state)` | about 15 times per second. `state` is described below. |
| `onKillfeed(ev)` | `{killer:{id,name,team,me}, victim:{...}, weapon, weaponName, headshot, streak, suicide, respawnSec, meKiller, meVictim}` (`weapon` is `"fall"` for falls) |
| `onScoreboard(data)` | `{players:[{id,name,team,score,kills,deaths,streak,ping,alive,me,cls}] sorted, teamScores:[t1,t2], timeLeft, mode, modeName, limit, myId, myTeam, teams:[{id,name,color}]}`. Sent on every `sb` (1 Hz, and after kills), on join/leave, and when Tab is pressed. |
| `onScoreboardToggle(visible)` | Tab (or gamepad Back) held or released |
| `onChat(msg)` | `{id, name, team, text, teamOnly, me, system:false}`, or for system lines (joins, leaves, server `sys`) `{system:true, text}`. Render as text, never as HTML. |
| `onChatOpen({teamOnly})` | Enter or T (all chat), Y (team chat) pressed in game. The pointer is already unlocked; show the input. |
| `onMatchStart(info)` | after welcome and after every `start`: `{mode, modeName, map, mapName, timeLeft, limit, teams, myTeam, myTeamName, myTeamColor, roomCode}` |
| `onMatchEnd(data)` | `{winnerTeam, winnerTeamName, winnerTeamColor, winnerPlayer:{id,name,team,me}\|null, draw, iWon, intermission (s), nextMap, nextMapName, players:[...] as in onScoreboard, teamScores, mode, myId}` |
| `onDisconnect(reason)` | `{code, msg}` when the socket closes (server `err` code, `"restart"` for a graceful server shutdown (close 1001), `"socket"`, `"map"`, ...) |
| `onPing(ms)` | every 2 s |
| `onRoom(info)` | after welcome: `{code, mode, map, private, max, id, offline}` |
| `onPauseChange(paused)` | pointer lock lost (Esc) or regained. Show or hide the pause menu. |
| `onPointerLockError()` | the browser refused pointer lock, for example when re-locking too soon after Esc |
| `onStreak(ev)` | `{id,name,team,me, n, reward, rewardName, desc}` |
| `onPickup(ev)` | `{id,name,team,me, index, type, pickupName}` |
| `onFlag(ev)` | Nest Raid: `{ev:"take"\|"drop"\|"return"\|"cap", team, teamName, teamColor, id, name, me, mine}`. `team` is the team whose egg it is. `mine` means it is your team's egg. |
| `onHitConfirm(ev)` | you damaged someone: `{victim, damage, headshot, hp, sh, weapon}` |
| `onDamaged(ev)` | you took damage: `{attacker, damage, headshot, hp, sh, weapon, from:[x,y,z]}` |
| `onSpawn(ev)` | you spawned: `{x,y,z,cls}` |

### HUD state (`onHud` / `getState()`)

```js
{
  connected, offline, paused, chatOpen, pointerLocked,
  alive, hp, maxHp, shield, maxShield, fury /* seconds left */, streak,
  weapon: { id, name, class, slot, mag, magSize, reserve /* -1 = infinite */, reloading, reloadFrac /* 0..1 */, switching },
  primary: { id, name, class, slot, mag, magSize, reserve }, secondary: { ... },
  grenades, maxGrenades, ads, scoped, spawnProtected, carrying,
  respawnIn /* s, 0 when alive */, killer: { id, name, team, me } | null,
  match: { state /* "live" | "ended" */, mode, modeName, map, mapName, timeLeft, teamScores, limit, teams, myTeam, myScore, myKills, myDeaths },
  room: { code, private } | null,
  objective: [{ team, state /* home|carried|dropped */, carrier, pos }] | null,
  ping, fps, myId
}
```

## Settings (`DEFAULT_SETTINGS`)

| key | default | meaning |
|---|---|---|
| `sensitivity` | 1.0 | mouse multiplier (1.0 = 0.0022 rad per pixel) |
| `adsSensitivity` | 0.85 | extra multiplier while aiming. It is also scaled by the zoom. |
| `invertY` | false | |
| `fov` | 75 | vertical FOV in degrees. Aiming down sights blends to the weapon's `adsFov`. |
| `quality` | `"high"` | `"low"` (no shadows, pixel ratio 1, fewer particles), `"medium"` (1024 shadows), `"high"` (2048 shadows, MSAA) |
| `shadows` | true | |
| `pixelRatioCap` | 1.5 | |
| `showDebug` | false | debug panel: fps, ping, ticks, ack, pending inputs, interpolation buffer, corrections, draw calls, traffic |
| `showFps` | false | small fps and ping line |
| `crosshair`, `crosshairColor` | true, `#ffffff` | |
| `toggleAds` | false | right mouse toggles aim instead of holding it |
| `viewBob` | true | |
| `gamepadSensitivity` | 1.0 | |
| `rawInput` | false | request `unadjustedMovement` pointer lock |
| `clickToLock` | true | clicking the canvas locks the pointer |
| `nameplates` | true | |
| `binds` | null | partial override of `DEFAULT_BINDS` (`{fwd:["KeyW"], ...}`, values are `KeyboardEvent.code` lists) |

## Controls

| Input | Action |
|---|---|
| WASD or arrows | move |
| Space | jump |
| Left mouse | fire |
| Right mouse | aim (ADS) |
| R | reload |
| G or middle mouse | grenade |
| F, V, 3, or mouse side buttons | melee |
| Q, E or mouse wheel | swap weapon |
| 1 / 2 | primary / sidearm |
| Tab | scoreboard |
| Enter or T | chat |
| Y | team chat |
| Esc | release mouse, which triggers `onPauseChange(true)` |

**Gamepad (standard mapping):**

| Gamepad | Action |
|---|---|
| Left stick | move |
| Right stick | look |
| A | jump |
| RT | fire |
| LT | aim |
| X | reload |
| RB | grenade |
| B or R3 | melee |
| Y or LB | swap |
| Back | scoreboard |
| Start | pause |

There is no sprint: the protocol has no sprint input. The game auto-switches to the sidearm when the primary is completely out of ammo.

## Audio

The game calls `sfx.play(name, opts)` from `web/js/audio.js` if that module exists. A missing module or an error inside it is ignored.

`name` is one of:
- `shoot_<weaponId>` (`shoot_rollingpin` is used for melee swings)
- `reload`, `hit`, `headshot`, `kill`, `death_crack`, `explode`
- `jump`, `land`, `footstep`, `pickup`, `grenade_throw`, `empty`, `ui_click`

`opts` is `{volume: 0..1, pan: -1..1, dist, local}`. `volume` already includes distance falloff, and `local` means the local player caused the sound.

## Layering

The game's overlay canvas uses `z-index: 2` and `pointer-events: none`. Put HUD elements above it (`z-index` ≥ 3).

## Dev and testing

- `/js/engine/test/dev.html?offline=1&mode=ffa&map=barnyard&cls=benedict&bots=5` runs the game with no UI and the debug panel on. Drop `offline=1` to use the server.
- `node --import ./web/js/engine/test/register.mjs web/js/engine/test/physics.test.mjs` runs the prediction, quantisation, reconciliation and interpolation vectors and an offline protocol smoke test.
- `node --import ./web/js/engine/test/register.mjs web/js/engine/test/gen-physics-vectors.mjs [--check]` regenerates or checks `shared/physics_vectors.json`.
- `node --import ./web/js/engine/test/register.mjs web/js/engine/test/netcheck.mjs ws://localhost:8080/ws 10` runs a headless client against a live server and reports reconciliation error.
