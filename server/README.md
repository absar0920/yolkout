# Yolkout server

Single Go binary: authoritative 60 Hz game server, WebSocket endpoint, JSON APIs
and the static file server for `web/`. The wire contract is `../shared/PROTOCOL.md`.
Every tuning number comes from `../shared/data/*.json`.

```
make run                        # from the repo root: http://localhost:8080
cd server && go test -race ./...
```

## Flags (env var in brackets)

| flag | default | meaning |
|---|---|---|
| `-addr` | `:8080` (`YOLKOUT_ADDR`, or `PORT`) | listen address |
| `-web` | `../web` (`YOLKOUT_WEB`) | static client directory |
| `-shared` | `../shared` (`YOLKOUT_SHARED`) | serves `data/` at `/data/` and `ref/` at `/ref/` |
| `-data` | `<shared>/data` (`YOLKOUT_DATA`) | game data directory |
| `-stats` | `yolkout-stats.json` (`YOLKOUT_STATS`) | leaderboard file (`""` = memory only) |
| `-bots` | `4` (`YOLKOUT_BOTS`) | fill rooms with server bots up to N players (0 = off) |
| `-maxrooms` | `200` (`YOLKOUT_MAXROOMS`) | live room cap (`server_full` beyond) |
| `-maxconns` | `4000` (`YOLKOUT_MAXCONNS`) | WebSocket connection cap (HTTP 503 beyond) |
| `-anyorigin` | off (`YOLKOUT_ANYORIGIN=1`) | accept cross-origin WebSocket upgrades |

## HTTP

* `/` static files from `web/`, `/data/...`, `/ref/sim.mjs`. Gzip (cached in memory) for text types,
  strong ETags, `no-cache` everywhere except `/vendor/*` (`immutable`, 1 year).
* `/healthz` returns `ok`.
* `/api/rooms` returns `{"rooms":[{code,mode,map,n,humans,max}]}` for public rooms. `n` includes bots.
* `/api/stats?by=score|kills|wins|kd|streak|captures&n=25` returns
  `{by,online,rooms,tracked,top:[{n,ki,de,hs,sc,wi,mp,bs,ca,t}]}`.
* `/ws` is the game protocol. permessage-deflate is negotiated when the client offers it (browsers do); frames of 256 bytes or more are
  compressed at BestSpeed, which roughly halves snapshot bandwidth.

## Layout

* `internal/sim`: line-for-line port of `shared/ref/sim.mjs`. Its tests replay `shared/testvectors`.
* `internal/data`: loaders for `shared/data`.
* `internal/game`: connections, matchmaking, rooms (one goroutine each, tick order of PROTOCOL.md 15),
  combat (lag-compensated hitscan, melee, projectiles, splash), modes (FFA, Team Scramble, Nest Raid),
  pickups, killstreaks and bots.
* `internal/stats`: leaderboard, saved atomically (temp file, fsync, rename) every 30 s and on shutdown.
* `internal/web`: static file handler.

SIGINT or SIGTERM stops accepting connections, sends every player a notice, closes the
sockets with code 1001 and saves stats.
