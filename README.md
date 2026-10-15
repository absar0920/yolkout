<p align="center"><img src="web/assets/logo.svg" alt="Yolkout" width="420"></p>

# Yolkout

**Yolkout** is a free, fast, browser-based multiplayer first-person shooter where every player is an armed egg.
It has arcade movement, seven weapon classes, grenades, a rolling-pin melee, killstreaks, and three modes
(Free-For-All, Team Scramble, Nest Raid) on four hand-built arenas. You crack eggs, not wallets. **There are no ads, no
analytics, no trackers and no purchases. Every cosmetic is unlocked for everyone.**

Yolkout is an original game in the "egg shooter" genre. All code, names, maps, weapons, art and data in this repo are original.

## Quick start

```bash
make run            # Go server + web client on http://localhost:8080
make bots BOTS=8    # 8 headless protocol bots join quickplay FFA
make test           # map validation + JS reference vectors + go vet/test
make build          # single static binary -> bin/yolkout
make docker         # tiny scratch image (binary + static files)
```

Requirements: Go >= 1.23 and Node 22 (Node is used only for scripts and tests, never at runtime).

## Monorepo layout

```
server/     Go module "yolkout/server": authoritative 60 Hz game server, rooms/matchmaking,
            WebSocket endpoint /ws, static file server (web/, /data, /ref). One binary.
web/        Static client: index.html, css/, js/ (native ES modules, no build step, no framework),
            assets/ (logo.svg, favicon.svg), vendor/ (pinned three.js).
shared/
  PROTOCOL.md       THE wire + gameplay contract (read this first)
  data/             rules.json, weapons.json, modes.json, cosmetics.json, maps/*.json (+ maps/index.json)
  ref/sim.mjs       canonical deterministic sim (movement, collision, weapon timing, spread RNG, rays, projectiles)
  testvectors/      golden outputs of ref/sim.mjs; the Go port must match them
scripts/
  mapgen/           map source code (lib.mjs helpers + maps.mjs), `make maps` emits shared/data/maps/*.json
  validate-maps.mjs schema, collision, spawn, floor-coverage and reachability checks
  gen-testvectors.mjs
  bots/bots.mjs     protocol/load-test bots (no dependencies)
```

## Architecture

* **Authoritative server** (Go): fixed **60 Hz** simulation and **30 Hz** snapshots. The server owns hits, damage, pickups, objectives
  and scores. It lag-compensates hitscan by rewinding targets to the client's render tick (up to 300 ms).
* **Client** (three.js): predicts its own movement and weapon state with the *same* `shared/ref/sim.mjs` code. It reconciles
  against each snapshot (ack + full-precision `me` state, replaying unacknowledged inputs). It interpolates remote players 100 ms behind.
* **Determinism:** shot spread comes from a seeded mulberry32 keyed by (player, input seq, pellet), so client tracers match server hits.
  Collision is AABB-only (maps are boxes, and ramps are 0.5 u stair steps), with Quake-style step-up and step-down.
* **Wire:** compact JSON over WebSocket. Snapshots use positional arrays. The server batches each tick's messages into one frame.
* **Speed:** no build step, no framework, gzip and immutable caching for vendor files. The client payload is three.js (about 190 KB gzipped) plus a few small ES modules and JSON files.

Data flows one way. `shared/data` is loaded by the server from disk (`-shared ../shared`) and by the client over HTTP
(`/data/...`). Change tuning in JSON, never in code.

## Game content

| Weapon | Class | Notes |
|---|---|---|
| Benedict AR | Assault rifle | full-auto all-rounder |
| Deviler | Shotgun | 10-pellet pump |
| Poacher | SMG | fastest fire rate and movement |
| Shell Piercer | Sniper | headshots one-shot |
| Frittata-3 | Burst rifle | 3-round burst |
| Over Easy | Marksman | semi-auto, 2 headshots kill |
| Souffle Launcher | Launcher | splash shells |
| Coddler | Pistol (everyone) | infinite reserve |
| Quiche Bomb | Grenade | bouncing, 1.8 s fuse |
| Rolling Pin | Melee | 50 damage bonk |

Maps: **Barnyard Brawl** (barn with a hayloft, coops, silos), **Countertop** (a giant kitchen with a sink canyon, a spoon bridge and a pancake tower),
**The Hatchery** (an egg factory with a catwalk ring and a central pit), **Sunrise Diner** (booths, a rooftop under the neon sign, trailers).
Modes: **Free-For-All**, **Team Scramble** (Sunnies vs Speckles), **Nest Raid** (steal the enemy's Golden Egg).

## Third-party

* [three.js](https://threejs.org) **r185 (npm `three@0.185.1`)**, MIT, vendored in `web/vendor/`
  (`three.module.min.js` + `three.core.min.js`; see `web/vendor/LICENSE-three.txt`). The import map in `index.html` maps `"three"` to it.
* [gorilla/websocket](https://github.com/gorilla/websocket) v1.5.3, BSD-2.

## Contributing rules

* Edit `shared/PROTOCOL.md` **before** changing wire behaviour on either side.
* After changing `shared/ref/sim.mjs` or `rules.json`/`weapons.json`, run `make vectors` and update the Go port until `make test` passes.
* Maps are code: edit `scripts/mapgen/maps.mjs`, then run `make maps`. Never hand-edit the generated JSON.
