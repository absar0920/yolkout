<p align="center"><img src="web/assets/logo.svg" alt="Yolkout" width="420"></p>

# Yolkout

**Yolkout** is a free, fast multiplayer first-person shooter that runs in the browser. Every player is an armed egg.
It has arcade movement, seven primary weapons plus a sidearm, grenades and a rolling-pin melee, killstreaks, and three modes
(Free-For-All, Team Scramble, Nest Raid) on four hand-built arenas. You crack eggs, not wallets: **there are no ads, no
analytics, no trackers and no purchases, and every cosmetic is unlocked for everyone.**

Yolkout is an original game in the "egg shooter" genre. All code, names, maps, weapons, art, sounds and data in this repo are original.

## Quick start

```bash
make run            # Go server + web client on http://localhost:8080
make test           # offline tests: maps, JS syntax, sim + prediction vectors, go vet, go test -race
make bots           # protocol + load test: 24 clients in 2 rooms for 30 s against a fresh server
make e2e            # headless-Chromium end-to-end test, screenshots in scripts/screenshots/
make build          # single static binary -> bin/yolkout
make docker         # tiny scratch image (binary + static files)
make help           # every target
```

Requirements: Go >= 1.23 and Node 22. Node is only used for scripts and tests, never at runtime.
`make e2e` installs Playwright and Chromium into `scripts/node_modules` on first use (`make deps`).

Open http://localhost:8080, type a name and press **PLAY**. Quickplay drops you into the fullest public room for the chosen
mode, and server bots fill the room up to 4 players while you wait for humans. **Practice vs bots** runs a complete
in-browser server and works offline. **Create room** makes a private room. Share its 6-character code or the `?room=CODE` link.

## Controls

| Action | Keyboard / mouse | Gamepad (standard) |
|---|---|---|
| Move | `W A S D` or arrow keys | left stick |
| Look | mouse (pointer lock: click the game) | right stick |
| Fire | left mouse button | RT |
| Aim down sights | right mouse button (hold, or toggle in Settings) | LT |
| Jump | `Space` | A |
| Reload | `R` | X |
| Grenade | `G` or middle mouse button | RB |
| Melee (rolling pin) | `F`, `V`, `3` or mouse side buttons | B or R3 |
| Swap weapon | `Q` / `E`, mouse wheel, or `1` primary / `2` sidearm | Y or LB |
| Scoreboard | hold `Tab` | Back |
| Chat / team chat | `Enter` or `T` / `Y` | |
| Pause menu | `Esc` | Start |

Every key can be rebound in **Settings**, which also has sensitivity, ADS sensitivity, invert Y, field of view,
graphics quality, shadows, an FPS counter, view bob, name tags, crosshair colour and volume.

## Game content

| Weapon | Class | Notes |
|---|---|---|
| Benedict AR | Assault rifle | full-auto all-rounder |
| Deviler | Shotgun | 10-pellet pump |
| Poacher | SMG | fastest fire rate and movement |
| Shell Piercer | Sniper | a headshot kills in one hit |
| Frittata-3 | Burst rifle | 3-round burst |
| Over Easy | Marksman | semi-auto, 2 headshots kill |
| Souffle Launcher | Launcher | splash shells |
| Coddler | Pistol (everyone) | infinite reserve |
| Quiche Bomb | Grenade | bouncing, 1.8 s fuse |
| Rolling Pin | Melee | 50 damage bonk |

* **Maps:** **Barnyard Brawl** (a barn with a hayloft, coops, silos), **Countertop** (a giant kitchen with a sink canyon, a spoon bridge and a pancake tower),
  **The Hatchery** (an egg factory with a catwalk ring and a central pit), **Sunrise Diner** (booths, a rooftop under the neon sign, trailers).
* **Modes:**
  * **Free-For-All:** first to 25 kills, 8 min.
  * **Team Scramble:** Sunnies vs Speckles, first team to 50 kills, 10 min.
  * **Nest Raid:** steal the enemy's Golden Egg and bring it to your nest, 3 captures.
* **Pickups:** Toast Soldier (+40 hp), Hard-Boiled Shell (+50 shield), Egg Carton (ammo and a grenade).
* **Killstreaks:** 3 kills gives Second Breakfast (refill), 5 gives Hard-Boiled (full shield), 8 gives Hot Sauce (1.5x damage for 15 s).
* **Cosmetics:** 12 shell colours, 14 hats (including none) and 11 stamps, all free.

## Monorepo layout

```
server/     Go module "yolkout/server": authoritative 60 Hz game server, rooms/matchmaking, server bots,
            WebSocket endpoint /ws, JSON APIs, static file server (web/, /data, /ref). One binary.
web/        Static client: no build step, no framework, native ES modules.
  index.html, css/style.css, manifest.webmanifest, assets/ (logo, icons, og image)
  js/ui/          menus, loadout, settings, HUD, dialogs (entry point: js/ui/app.js)
  js/main.js      game client API: startGame(opts) -> controller (see shared/CLIENT_API.md)
  js/game/        game loop, input, models, first-person viewmodel, effects, overlay, audio hook
  js/engine/      renderer, map meshing, procedural textures, prediction (physics.js), tests in engine/test/
  js/net/         WebSocket connection, tick clock, snapshot interpolation, offline practice server
  js/audio.js     procedural sound effects (Web Audio, nothing downloaded)
  vendor/         pinned three.js
shared/
  PROTOCOL.md       THE wire + gameplay contract (read this first)
  CLIENT_API.md     the client API between web/js/ui and web/js/main.js
  data/             rules.json, weapons.json, modes.json, cosmetics.json, maps/*.json (+ maps/index.json)
  ref/sim.mjs       canonical deterministic sim (movement, collision, weapon timing, spread RNG, rays, projectiles)
  testvectors/      golden outputs of ref/sim.mjs; the Go port must match them
  physics_vectors.json  client prediction/reconciliation vectors; the Go sim replays them too
scripts/
  bots.mjs          protocol + load test (no dependencies)
  e2e.mjs           browser end-to-end test (Playwright)
  bots/bots.mjs     simple random-walk bots for a running server (make bots-wander)
  mapgen/           map source code; `make maps` emits shared/data/maps/*.json
  validate-maps.mjs schema, collision, spawn, floor-coverage, reachability and spawn-sightline checks
  gen-testvectors.mjs
```

## Architecture

* **Authoritative server** (Go): each room is one goroutine with a fixed **60 Hz** simulation and **30 Hz** snapshots.
  The server owns hits, damage, pickups, objectives and scores. It lag-compensates hitscan and melee by rewinding targets
  to the client's render tick (up to 300 ms). Each connection has its own read and write goroutines, rate limits,
  an input token bucket (anti speed-hack) and a bounded send queue, so a slow client is dropped instead of stalling a room.
  Rooms run at most one input per player per tick while the backlog is small (a 3-input jitter buffer), so remote
  players advance one step per tick even though clients send in batches. Per-IP limits cap live sockets (8),
  private-room creation (3/min) and wrong room codes (10/min); loopback is exempt, and `-trustproxy` keys them on
  `X-Forwarded-For` behind a reverse proxy. At most half of `-maxrooms` can be private.
* **Server bots** path-find on a per-map 0.5 u walk/jump/drop graph (A*, the same graph `validate-maps.mjs` checks),
  split into attackers and defenders in Nest Raid, and keep pushing the objective while shooting.
* **Client** (three.js): predicts its own movement and weapon state with the *same* `shared/ref/sim.mjs` code
  (served at `/ref/sim.mjs` and imported as `yolkout/sim`). It reconciles against each snapshot (ack + full-precision `me`
  state, replaying unacknowledged inputs) and interpolates remote players and projectiles 100 ms behind.
* **Determinism:** shot spread comes from a seeded mulberry32 keyed by (player, input seq, pellet), so the client's tracers match the server's hits.
  Collision is AABB-only (maps are boxes, and ramps are 0.5 u stair steps), with Quake-style step-up and step-down. The Go port
  matches the JS reference within 1e-9 on every test vector, including the client's own prediction vectors on all four maps.
* **Wire:** compact JSON over WebSocket. Snapshots use positional arrays. The server batches each tick's messages into one frame
  and compresses frames of 256 bytes or more with permessage-deflate (BestSpeed, no context takeover).
* **Data flows one way:** `shared/data` is loaded by the server from disk (`-shared ../shared`) and by the client over HTTP
  (`/data/...`). Change tuning in JSON, never in code.
* **UI:** the menu paints from plain HTML/CSS immediately. three.js and the game modules load in the background
  (`requestIdleCallback`), so the first click on PLAY is fast.

### Performance (measured with `make bots`, `make bench` and `make e2e` on a 4-vCPU cloud VM)

| | |
|---|---|
| Server tick, full 12-player room | ~150 µs (`BenchmarkRoomTick12`), against a 16.7 ms budget |
| 24 clients in 2 rooms | 60.0 ticks/s, snapshots every 33.3 ms (p99 38 ms), server ~20 % of one core, ~19 MB RSS |
| Downstream per client (12-player room) | ~27 KB/s of JSON, ~14 KB/s on the wire with deflate |
| Upstream per client | ~2.5 KB/s (60 inputs/s, batched in pairs) |
| Client payload | three.js (~190 KB gzipped) + at most ~145 KB gzipped of game/UI modules, data and assets (only one map is fetched per match); no build step |
| Home screen ready | ~0.3 s locally |

## Server flags

| flag | default | meaning |
|---|---|---|
| `-addr` | `:8080` (`YOLKOUT_ADDR`, or `PORT`) | listen address |
| `-web` | `../web` | static client directory |
| `-shared` | `../shared` | serves `data/` at `/data/` and `ref/` at `/ref/` |
| `-data` | `<shared>/data` | game data directory |
| `-stats` | `yolkout-stats.json` | leaderboard file (`""` = memory only) |
| `-bots` | `4` | fill rooms with server bots up to N players while a human is present (0 = off) |
| `-maxrooms` | `200` | live room cap |
| `-maxconns` | `4000` | WebSocket connection cap |
| `-maxconnsperip` | `8` | WebSocket connections per client IP (-1 = unlimited; loopback is exempt) |
| `-trustproxy` | off | take the client IP from the last `X-Forwarded-For` entry (only behind your own proxy) |
| `-anyorigin` | off | accept cross-origin WebSocket upgrades |

Endpoints: `/` (client), `/data/*`, `/ref/sim.mjs`, `/ws`, `/healthz`, `/api/rooms`, `/api/stats?by=score|kills|wins|kd|streak|captures`.
See `server/README.md`. The Docker image keeps the leaderboard in the `/app/var` volume.

## Testing

| Command | What it checks |
|---|---|
| `make test-go` | `go vet` and `go test -race`: the sim port against `shared/testvectors` and `shared/physics_vectors.json`, rooms, matchmaking, combat (lag compensation, splash, melee), all three modes, the WebSocket protocol, HTTP static serving, stats |
| `make test-js` | map validation (reachability, spawns, floors), `node --check` on every module, the JS reference vectors, client prediction/reconciliation/interpolation (7,341 checks) and an offline protocol smoke run |
| `make bots` | starts a fresh server on port 18400. **Protocol checks:** version mismatch, oversized frames, malformed JSON, unknown room code, ping/pong, loadout updates, join by code, joins and leaves, chat sanitising. **Load:** 24 clients in 2 rooms (public FFA and private Team Scramble) aim, move, fire and throw grenades for 30 s. It asserts 30 snapshots/s and 60 ticks/s, that acks advance, that kills and respawns happen in both rooms, that chat stays inside each room, and that nobody disconnects. It then reports bandwidth, snapshot jitter, RTT and server CPU/RSS. |
| `make e2e` | headless Chromium (software WebGL). It covers the home screen (desktop and 390 px phone), the loadout, all dialogs, online quickplay (non-blank render check, HUD, moving, firing, reloading, swapping, scoreboard, chat, killfeed, pause, leaving), creating a private room and joining it from a second browser, a bad room code, and practice mode with a timed respawn. It also starts a short-match server to drive a real match end, the results screen, the next map, and the disconnect screen on server shutdown. It fails on any console error. Screenshots go to `scripts/screenshots/`. |
| `make bench` | Go benchmark of a full room tick |

`web/js/engine/test/dev.html` runs the game without the menus (`?offline=1&mode=ffa&map=barnyard`).
`web/js/engine/test/netcheck.mjs <ws-url> <secs>` runs a headless client against a live server and reports prediction error.

## Third-party

* [three.js](https://threejs.org) **r185 (npm `three@0.185.1`)**, MIT, vendored in `web/vendor/`
  (`three.module.min.js` + `three.core.min.js`; see `web/vendor/LICENSE-three.txt`).
* [gorilla/websocket](https://github.com/gorilla/websocket) v1.5.3 (BSD-2) and [golang.org/x/text](https://pkg.go.dev/golang.org/x/text) v0.21.0 (BSD-3) for name normalisation.
* Dev only: [Playwright](https://playwright.dev) (Apache-2.0) for `make e2e`.

## Contributing rules

* Edit `shared/PROTOCOL.md` **before** changing wire behaviour on either side.
* After changing `shared/ref/sim.mjs` or `rules.json`/`weapons.json`, run `make vectors` and update the Go port until `make test` passes.
* Maps are code: edit `scripts/mapgen/maps.mjs`, then run `make maps`. Never hand-edit the generated JSON.
* Before pushing, run `make test bots e2e`.
