# Yolkout Wire Protocol and Game Rules (v1)

> Protocol version **1**, gameplay data **v2**: hit zones with per-weapon multipliers (9.3), a melee loadout
> with windup and knockback (`mel`, 9.1, 9.3), coyote time and ground deceleration (8), and a straight-flying
> launcher shell (9.4). Every v2 wire field is additive; v1 readers can ignore it.

This document is the **authoritative contract** between the browser client (`web/`) and the
Go server (`server/`). Both sides are built independently from it. If code and this document
disagree, this document wins; fix the code (or change this document first, then both sides).

Numeric tuning lives in `shared/data/*.json`. Both sides MUST load those files instead of
hard-coding values; the numbers quoted here are the shipped defaults, given for reference.
Deterministic math (movement, weapon timing, spread RNG, ray tests, projectiles) has a
canonical JavaScript implementation in **`shared/ref/sim.mjs`**. The client imports it as-is.
The server ports it line for line to Go and MUST pass `shared/testvectors/*.json`.

Contents:

1. Conventions
2. Transport and HTTP endpoints
3. Timing
4. Connection lifecycle and handshake
5. Client to server messages
6. Server to client messages
7. Snapshot format
8. Simulation: movement and collision
9. Combat: weapons, hitscan, projectiles, damage
10. Health, pickups, spawning, killstreaks
11. Modes, scoring and match flow
12. Rooms and matchmaking
13. Rate limits, validation, disconnects
14. Client obligations (prediction, reconciliation, interpolation)
15. Server tick order
16. Data file formats
17. Conformance tests
18. Implementation notes (extensions in the shipped server and client)

---

## 1. Conventions

* **Units:** 1 world unit is roughly 1 metre. Time in seconds unless a field says `ms`. Angles in radians.
* **Axes:** right-handed, **Y up** (same as three.js). Ground is usually at `y = 0`.
* **Player position** `(x, y, z)` is the **bottom centre of the feet** (bottom-centre of the collision AABB).
* **yaw:** rotation about +Y. `yaw = 0` looks toward **-Z**. Positive yaw turns left (counter-clockwise seen from above).
  Forward = `(-sin yaw, 0, -cos yaw)`, Right = `(cos yaw, 0, -sin yaw)`. Wire yaw is normalised to `(-PI, PI]`.
* **pitch:** positive looks up. Clamped to `[-maxPitch, +maxPitch]`, `maxPitch = 1.5`.
  Aim vector = `(-sin yaw * cos pitch, sin pitch, -cos yaw * cos pitch)`.
* **Ids:** player ids and projectile ids are positive integers, unique in their room for the room's lifetime
  (never reused). `0` means "nobody" or "the world".
* **Teams:** `0` = no team (FFA), `1` = Sunnies (gold `#ffc23d`), `2` = Speckles (blue `#4aa8ff`).
* **Booleans** on the wire are `0` or `1` integers, never `true` or `false`. The one exception is `hello.create`, which accepts both.
* **Weapon ids, class ids, cosmetic ids, map ids, mode ids** are the string keys in `shared/data`.
* **Quantisation:** where a field says "q2", the sender rounds it to 2 decimals (`Math.round(v*100)/100`),
  "q3" means 3 decimals, and so on. Fields marked "full" are sent at full float64 precision (shortest round-trip repr).

## 2. Transport and HTTP endpoints

One HTTP server (the Go binary) serves everything on one port (default `:8080`).

| Path | What |
|---|---|
| `GET /` and other static paths | files from `web/` (`index.html`, `css/`, `js/`, `assets/`, `vendor/`) |
| `GET /data/...` | files from `shared/data/` (rules, weapons, modes, cosmetics, maps) |
| `GET /ref/...` | files from `shared/ref/` (`sim.mjs`, the shared deterministic sim) |
| `GET /healthz` | `200 ok` |
| `GET /api/rooms` | `{"rooms":[{"code":"K7Q2MX","mode":"ffa","map":"barnyard","n":5,"max":12}]}`: **public** rooms only |
| `GET /ws` | WebSocket upgrade (game protocol) |

Static serving requirements (for speed): `.mjs` and `.js` use `Content-Type: text/javascript`. Gzip text
types (`html, css, js, mjs, json, svg`) when the request sends `Accept-Encoding: gzip`, caching the compressed bytes in memory.
`/vendor/*` sends `Cache-Control: public, max-age=31536000, immutable`. Everything else sends `Cache-Control: no-cache`
with an `ETag` or `Last-Modified` header.

**WebSocket:** URL is `ws(s)://<host>/ws` (same origin as the page). Only **text frames** carrying UTF-8 JSON.
Client to server: each frame holds exactly **one JSON object**. Server to client: a frame holds **either one
JSON object or a JSON array of objects** (the server batches all messages from one tick into one frame);
clients MUST accept both forms. Every message object has a string type field `"t"`.
The server rejects any client frame larger than `maxMessageBytes = 4096`.
The server offers **permessage-deflate** (no context takeover) and compresses frames of 256 bytes or more when the client accepts it;
browsers negotiate it automatically. It is transparent to message handling.

## 3. Timing

| Constant | Value | Source |
|---|---|---|
| Simulation tick rate | **60 Hz**, `dt = 1/60` exactly | `rules.net.tickRate` |
| Snapshot rate | every **2** ticks (30 Hz) | `rules.net.snapshotEvery` |
| Client remote-interpolation delay | **100 ms** (6 ticks) | `rules.net.interpDelayMs` |
| Max lag-compensation rewind | **18 ticks** (300 ms) | `rules.net.maxRewindTicks` |
| Lag-comp history kept | 32 ticks | `rules.net.historyTicks` |

* `k` = server tick number for a room: an integer that starts at 0 when the room is created and never resets (not even between matches).
* The client sends **one input per 1/60 s fixed tick** (fixed-step accumulator driven by `requestAnimationFrame`) and
  MAY batch up to 8 consecutive inputs into one `i` message (normally 1 or 2).
* **Server tick estimate (client):** on each snapshot, `estK = k + (now - recvTime)/dtMs`. Keep a smoothed offset between
  local clock and server ticks; nudge by at most 10 % of the error per snapshot so it never jumps backwards.
* **Render tick** `rt` = `estK - interpDelayMs/dtMs` = the (fractional) server tick at which the client is drawing remote
  players. It is sent with every input and used for lag compensation (section 9.3).

## 4. Connection lifecycle and handshake

```
client                                   server
  | -- WS connect /ws ----------------------> |
  | -- {"t":"hello",...} -------------------> |   (must arrive within 3 s)
  | <------------- {"t":"welcome",...} ------ |   or {"t":"err",...} followed by close
  | <------------- {"t":"spawn",...} -------- |   (the joining player spawns immediately)
  | <------------- {"t":"s",...} (30 Hz) ---- |
  | -- {"t":"i",...} (60 Hz) ---------------> |
  | -- {"t":"ping",...} (every 2 s) --------> |
  | <------------- {"t":"pong",...} --------- |
```

Closing the socket means leaving the room. No explicit leave message exists.

### 4.1 `hello` (client to server, first and only once)

```json
{"t":"hello","v":1,"name":"Eggbert","cls":"benedict","mel":"pan",
 "cos":{"hat":"chef","color":"brown","stamp":"star"},
 "mode":"ffa","map":"","room":"","create":0}
```

| Field | Type | Meaning |
|---|---|---|
| `v` | int | protocol version, must equal `rules.net.protocolVersion` (1). Otherwise `err version`. |
| `name` | string | display name; sanitised by the server (section 13.3) |
| `cls` | string | primary weapon id from `weapons.primaries`; unknown values become `weapons.defaultPrimary` |
| `mel` | string | melee id from `weapons.melees` (`rollingpin`, `pan`, `whisk`, `spatula`); unknown or missing values become `weapons.defaultMelee` |
| `cos` | object | `{hat,color,stamp}` cosmetic ids; unknown or missing ids become `cosmetics.defaults` |
| `mode` | string | `"ffa"`, `"teams"` or `"nest"`; used for quickplay or `create`. Unknown values become `modes.defaultMode` |
| `map` | string | preferred map id when a room is **created**; `""` = random from the mode's `maps` |
| `room` | string | room code to join (case-insensitive). `""` = quickplay |
| `create` | 0/1 | 1 = create a new **private** room with `mode`/`map` (ignores `room`) |

### 4.2 `welcome` (server to client)

```json
{"t":"welcome","v":1,"id":7,
 "room":{"code":"K7Q2MX","mode":"ffa","map":"barnyard","priv":0,"max":12},
 "tr":60,"se":2,"k":12345,
 "players":[ROSTER, ...],
 "match":{"state":"live","tl":431.5,"ts":[0,0],"limit":25},
 "pk":"110111111","o":null}
```

| Field | Meaning |
|---|---|
| `id` | your player id |
| `room` | `code` (5 chars), `mode`, `map` (id; the client fetches `/data/maps/<map>.json`), `priv` (0/1), `max` (12) |
| `tr` / `se` | tick rate / snapshot every N ticks |
| `k` | current server tick |
| `players` | full roster including you (ROSTER objects, section 6.1) |
| `match` | `state` = `"live"` or `"ended"`; `tl` = seconds left (float); `ts` = `[team1Score, team2Score]` (zeros in FFA); `limit` = mode `scoreLimit` |
| `pk` | pickup availability string (section 7) |
| `o` | objective state (section 7) or `null` |

Right after `welcome` the server spawns the player (sends `spawn` to everyone, including the joiner) and the next snapshot includes them.

## 5. Client to server messages

| `t` | Shape | Notes |
|---|---|---|
| `hello` | section 4.1 | first message only |
| `i` | `{"t":"i","b":[[seq,keys,yaw,pitch,buttons,slot,rt], ...]}` | input batch, 1 to 8 entries, oldest first |
| `ld` | `{"t":"ld","cls":"deviler","mel":"whisk","cos":{"hat":"cap","color":"mint","stamp":"none"},"hold":0}` | all fields optional. `cls` and `mel` take effect at the **next spawn**, `cos` immediately; when any of the three is present (an `ld` holding only `mel` is valid) the server answers by broadcasting `pu`. An unknown `cls` or `mel` is ignored. `hold:1` (only honoured while dead) keeps the player down while they pick a loadout, for at most **10 s** past their normal respawn time; `hold:0` releases it (respawning at once if the timer has passed). Spawning always clears the hold. |
| `chat` | `{"t":"chat","m":"gg","tm":0}` | `tm` 1 = team-only (team modes) |
| `ping` | `{"t":"ping","c":123456,"rtt":48}` | `c` = client clock ms (integer). `rtt` = last measured RTT ms (display only). |

### 5.1 Input entry `[seq, keys, yaw, pitch, buttons, slot, rt]`

| # | Field | Type | Meaning |
|---|---|---|---|
| 0 | `seq` | uint32 | starts at 1 and grows by exactly 1 per client tick. The server ignores any entry with `seq <= lastReceivedSeq`. |
| 1 | `keys` | int | bitmask: `1` FWD, `2` BACK, `4` LEFT, `8` RIGHT, `16` JUMP (held) |
| 2 | `yaw` | float q4 | absolute yaw for this tick, normalised to (-PI, PI] |
| 3 | `pitch` | float q4 | absolute pitch for this tick (the server clamps it to +-1.5) |
| 4 | `buttons` | int | bitmask: `1` FIRE (held), `2` AIM (held), `4` RELOAD, `8` GRENADE, `16` MELEE (all sent as "held" state; edges are derived in the sim) |
| 5 | `slot` | int | desired weapon slot: `0` primary, `1` secondary |
| 6 | `rt` | float q2 | client render tick (section 3) when this input was sampled |

**The client MUST apply the same q4 rounding to yaw/pitch before using them in its own prediction**, so both sides
feed identical numbers to the sim. Recoil and camera kick are client-side changes to the aim. They reach the server
only through the absolute yaw/pitch in inputs.

## 6. Server to client messages

| `t` | Shape | Sent to |
|---|---|---|
| `welcome` | section 4.2 | joiner |
| `s` | snapshot, section 7 | everyone, each with their own `a` and `me` |
| `join` | `{"t":"join","p":ROSTER}` | everyone except the joiner |
| `leave` | `{"t":"leave","id":7}` | everyone |
| `pu` | `{"t":"pu","p":ROSTER}`: roster update (loadout, cosmetics, team change) | everyone |
| `spawn` | `{"t":"spawn","id":7,"x":1.5,"y":0,"z":-3,"yaw":3.1416,"cls":"benedict","mel":"pan","tm":1}` | everyone |
| `shot` | `{"t":"shot","id":7,"w":"benedict","o":[x,y,z],"e":[[x,y,z,h], [x,y,z,2,zone], ...]}` | everyone **except the shooter** |
| `melee` | `{"t":"melee","id":7,"w":"pan"}` | everyone except the attacker, when the swing **starts** |
| `boom` | `{"t":"boom","id":31,"k":0,"o":7,"x":..,"y":..,"z":..,"r":5.0}` | everyone |
| `hit` | `{"t":"hit","a":7,"v":3,"d":50,"hs":1,"z":1,"hp":50,"sh":0,"w":"benedict","ax":..,"ay":..,"az":..}` | attacker and victim only |
| `kill` | `{"t":"kill","k":7,"v":3,"w":"benedict","hs":1,"z":1,"st":4,"rs":3}` | everyone |
| `streak` | `{"t":"streak","id":7,"n":5,"r":"shell"}` | everyone |
| `pick` | `{"t":"pick","i":2,"id":7,"ty":"hp"}` | everyone |
| `flag` | `{"t":"flag","ev":"take","tm":2,"id":7}` | everyone |
| `chat` | `{"t":"chat","id":7,"m":"gg","tm":0}` | everyone (or the team only if `tm` = 1) |
| `sys` | `{"t":"sys","m":"Eggbert joined"}` | varies |
| `sb` | `{"t":"sb","p":[[id,score,kills,deaths,streak,ping], ...],"ts":[t1,t2],"tl":312.4}` | everyone, every 1 s and right after any kill or capture |
| `end` | `{"t":"end","wt":1,"wp":7,"in":10,"next":"diner","sb":{"p":[...],"ts":[50,41]}}` | everyone |
| `start` | `{"t":"start","mode":"teams","map":"diner","tl":600,"ts":[0,0],"limit":50,"pk":"1111111","o":null}` | everyone |
| `pong` | `{"t":"pong","c":123456,"k":12401}` | pinger |
| `err` | `{"t":"err","code":"room_full","msg":"Room is full"}` | the offending client; the server closes the socket after any `err` |

Field notes:

* **`shot.e`** holds one entry per pellet: the end point (q2) plus `h` = `0` reached max range, `1` hit world, `2` hit a player.
  Only when `h == 2` a 5th element follows: the **zone** that pellet hit (9.3). `o` = muzzle origin (the shooter's eye, q2).
  Launcher shots do **not** produce `shot`; the projectile appears in snapshots.
* **`melee`**: sent when a swing **starts** (sim action `melee`); `w` = the attacker's melee id for this life. The hit itself
  resolves `windup` seconds later (sim action `meleeHit`) and arrives as a normal `hit`.
* **Zones** (`z`): `0` none (splash, fall), `1` head, `2` body, `3` arm, `4` leg (9.3).
* **`hit`**: `d` = integer total damage of this event (before shield absorption), `z` = hit zone (for a multi-pellet shot the best
  zone over that victim's pellets, priority head > body > arm > leg, i.e. the smallest non-zero id), `hs` = `z == 1`,
  `hp`/`sh` = victim values after the hit, `w` = weapon id (`quiche` for grenades, the melee id such as `pan` for melee),
  `ax,ay,az` = source position (attacker eye for bullets and melee, explosion centre for splash), q2. The client uses it for hit markers and damage-direction arrows.
* **`kill`**: `k` = killer id (`k == v` for suicide; `0` for world), `w` = weapon id (the melee id for melee kills) or `"fall"`,
  `z` = zone of the killing blow (0 for splash or fall), `hs` = 1 if the killing blow was a headshot (`z == 1`),
  `st` = killer's streak after this kill (0 on suicide), `rs` = victim respawn seconds.
* **`flag.ev`**: `"take"` (enemy picked up the egg of team `tm`), `"drop"` (carrier died or left), `"return"`
  (`id` returned it, or `id` 0 for an automatic return), `"cap"` (`id` captured the egg of team `tm`).
* **`end`**: `wt` = winning team (0 in FFA or on a draw), `wp` = winning player in FFA (0 otherwise), `in` = seconds until
  `start`, `next` = next map id. After `start` the client loads the new map. Fresh `spawn` events and snapshots follow.
* **err codes:** `bad_hello`, `version`, `room_full`, `no_room`, `server_full`, `rate`, `too_many`, `too_big`, `idle`, `bad_msg`, `unavailable`.

### 6.1 ROSTER object

```json
{"id":7,"n":"Eggbert","tm":0,"cls":"benedict","mel":"pan","cos":{"hat":"chef","color":"brown","stamp":"star"},
 "sc":0,"ki":0,"de":0,"st":0,"al":1}
```
`n` name, `tm` team, `cls` current (next-spawn) primary, `mel` next-spawn melee (the melee of the current life is in `spawn.mel`), `sc` score, `ki` kills, `de` deaths, `st` current streak, `al` alive.

## 7. Snapshot format (`s`)

```json
{"t":"s","k":12400,"a":5521,
 "me":{"x":1.2345678901234,"y":0,"z":-3.5,"vx":0.1,"vy":0,"vz":-5.9,"g":1,"cy":6,"al":1,"hp":76,"sh":0,
       "ws":[0,17,10,90,-1,2,0.0333,0,0,0,0.012,0,0,1,0],"fu":0},
 "p":[[7,1.23,0,-3.5,3.142,-0.052,76,0,3,0], [3,-10.5,3.5,2.25,0.5,0.1,100,50,1,1]],
 "pr":[[31,0,7,4.12,1.05,-2.2,3.1,-4.0,1.2]],
 "pk":"110111111",
 "o":[[1,0,0,0,-27,0],[2,1,4.2,0,10.1,7]]}
```

| Field | Meaning |
|---|---|
| `k` | server tick at which this state was taken (end of tick `k`) |
| `a` | **ack**: the highest input `seq` from *this receiving client* that the server has applied (0 = none yet) |
| `me` | the receiving player's authoritative state at **full precision**: position, velocity, `g` onGround, `cy` coyote ticks left (int, sim state `coy`), `al` alive, `hp` (integer, see 10.1), `sh` shield (integer), `ws` weapon state array, `fu` fury seconds left (0 = none) |
| `p` | every player in the room (dead ones too, with flag bit 1 cleared): `[id, x, y, z, yaw, pitch, hp, sh, flags, slot]`. Positions q2, yaw/pitch q3. |
| `pr` | live projectiles: `[id, kind, owner, x, y, z, vx, vy, vz]`. kind `0` grenade, `1` launcher shell. Position q2, velocity q1. |
| `pk` | one character per map pickup in map order: `"1"` = available, `"0"` = taken and waiting to respawn |
| `o` | `null` except in `nest` mode: `[[team, state, x, y, z, carrierId], ...]` for teams 1 and 2. `state` 0 = at home, 1 = carried, 2 = dropped. Position q2. |

**Player `flags` bits:** `1` alive, `2` onGround, `4` aiming (AIM held), `8` reloading, `16` spawn-protected,
`32` carrying an egg, `64` fury active, `128` switching weapons, `256` fired since the previous snapshot,
`512` threw a grenade since the previous snapshot (cleared like `256`).

**Weapon state array `ws`** (order is fixed; see `weaponStateToArray` in sim.mjs):
`[slot, mag0, mag1, res0, res1, gren, cd, rl, sw, bl, bloom, mt, gt, pb, mw]`.
`slot` current slot, `mag*` magazine rounds, `res*` reserve (-1 = infinite), `gren` grenades, `cd` fire cooldown s,
`rl` reload time left s, `sw` switch time left s, `bl` burst shots left, `bloom` current bloom rad, `mt` melee cooldown s,
`gt` grenade cooldown s, `pb` buttons of the last applied input, `mw` melee windup left s (v2; readers treat a missing 15th element as 0).

## 8. Simulation: movement and collision

The canonical implementation is `stepMove` / `clipAxis` in `shared/ref/sim.mjs`. This section restates it.

### 8.1 Constants (`rules.json`)

| Name | Value | Meaning |
|---|---|---|
| `halfWidth` | 0.35 | collision AABB half-extent in X and Z (box is 0.7 x 1.5 x 0.7) |
| `height` | 1.5 | collision AABB height |
| `eyeHeight` | 1.3 | camera and shot origin above the feet |
| `moveSpeed` | 6.0 | max ground speed (u/s), times the weapon `moveMul`, times `adsMoveMul` 0.65 while AIM is held |
| `groundAccel` | 12.0 | ground velocity approach rate (1/s) while a move key is held |
| `groundDecel` | 16.0 | ground approach rate (1/s) with no move key (friction: stops quicker than it starts) |
| `airAccel` | 3.5 | air approach rate (1/s), only while a move key is held |
| `coyoteTicks` | 6 | ticks after leaving the ground during which JUMP still works (coyote time, 0.1 s) |
| `gravity` | 24.0 | u/s^2 down |
| `jumpVelocity` | 8.2 | initial vy on jump (apex of about 1.40 u) |
| `terminalVelocity` | 25.0 | max fall speed |
| `maxHorizontalSpeed` | 20.0 | hard clamp on horizontal speed (knockback) |
| `stepHeight` | 0.55 | auto step-up and step-down height (stairs use 0.5 rises) |
| `headshotY` / `legY` / `armLat` | 1.08 / 0.32 / 0.78 | hit-zone boundaries (`rules.player`, 9.3) |
| `eps` | 1e-6 | contact tolerance |

### 8.2 World

Solids = every map box whose `solid` is not `false`, **plus 4 implicit boundary walls** just outside `bounds` on the X and Z
sides (1 unit thick, full bounds height). See `makeWorld`. There is no implicit floor or ceiling. A player whose
`y < killY` (default `bounds.min.y`) dies (weapon `"fall"`).

### 8.3 One movement tick (`stepMove(world, C, st, keys, yaw, speedMul)`)

```
mz = FWD - BACK ; mx = RIGHT - LEFT                (each 0/1)
wish = (-sin(yaw)*mz + cos(yaw)*mx,  -cos(yaw)*mz - sin(yaw)*mx);  normalise if length > 0
speed = moveSpeed * speedMul
if onGround:            k = min(1, (wish != 0 ? groundAccel : groundDecel)*dt); v.xz += (wish*speed - v.xz) * k
elif wish != 0:         k = min(1, airAccel*dt);    v.xz += (wish*speed - v.xz) * k
clamp |v.xz| to maxHorizontalSpeed
if JUMP and (onGround or coy > 0):   vy = jumpVelocity; onGround = false; coy = 0
vy -= gravity*dt; vy = max(vy, -terminalVelocity)
canStep = onGround
dx = vx*dt; dz = vz*dt
ax = clipAxis(X, dx); x += ax;  az = clipAxis(Z, dz); z += az
if canStep and (ax != dx or az != dz):            # step-up attempt
    save A = (x,y,z); restore start position
    up = clipAxis(Y, +stepHeight); y += up
    bx = clipAxis(X, dx); x += bx; bz = clipAxis(Z, dz); z += bz
    down = clipAxis(Y, -up); y += down
    if bx^2+bz^2 > ax^2+az^2 + 1e-12: ax,az = bx,bz  else restore A
if ax != dx: vx = 0 ;  if az != dz: vz = 0
dy = vy*dt; ay = clipAxis(Y, dy); y += ay
if ay != dy:                 onGround = (dy < 0); vy = 0
elif canStep and vy <= 0:    # step-down snap
    sd = clipAxis(Y, -stepHeight)
    if sd != -stepHeight: y += sd; onGround = true; vy = 0   else onGround = false
else:                        onGround = false
coy = onGround ? coyoteTicks : max(0, coy - 1)       # coyote counter (state field `coy`, wire `me.cy`)
```
Knockback anywhere (explosions, melee) sets `coy = 0` together with `onGround = false`. A fresh spawn has `coy = 0`.

### 8.4 `clipAxis(axis, delta)`: swept AABB clip (does not mutate)

For the player AABB `[x-hw, y, z-hw] .. [x+hw, y+height, z+hw]`, consider each solid box that overlaps it on **both other
axes** with the strict, eps-shrunk test `pmin < bmax - eps && pmax > bmin + eps`. If `delta > 0` and `bmin[axis] >= pmax[axis] - eps`,
then `delta = min(delta, bmin[axis] - pmax[axis])`. If `delta < 0` and `bmax[axis] <= pmin[axis] + eps`, then
`delta = max(delta, bmax[axis] - pmin[axis])`. Finally, if the sign of delta flipped, use 0. Boxes the player already overlaps never clip
(no push-out), so thin boxes cannot be tunnelled through and box order does not matter.

### 8.5 Per-input step (`simulateInput`)

```
pitch = clamp(input.pitch, -maxPitch, maxPitch)
speedMul = weapons[ws.slot].moveMul * (AIM held ? adsMoveMul : 1)     # slot BEFORE this tick's switch
stepMove(...)
moving = !onGround || hypot(vx, vz) > movingSpeedThreshold (1.0)
actions = weaponTick(ws, buttons, slot, defs, dt, moving)
```
Then the caller resolves the actions (section 9) using the **post-movement** position.

**Floating point:** both sides use float64. Go: build with the default `GOAMD64=v1` and do not hand-fuse
multiply-adds. Wrap products in explicit `float64(...)` conversions where the Go compiler could fuse them on arm64.
`Math.sin` and `math.Sin` can differ in the last ulp; reconciliation (section 14) absorbs this. Test vectors use a tolerance of 1e-9.

## 9. Combat

### 9.1 Weapon state machine (`weaponTick`)

Per input, after movement, with `pressed = buttons & ~pb`:

1. `cd -= dt`; `mt = max(0, mt-dt)`; `gt = max(0, gt-dt)`. If `mw > 0`: `mw -= dt`, and when that makes `mw <= 1e-9`, set `mw = 0` and emit `meleeHit`.
2. **Switch:** if `slot` is 0 or 1 and differs from the current slot, set `slot`, `sw = switchTime(new)`, `rl = 0`, `bl = 0`, and emit `switch`.
   Otherwise, if `sw > 0`, `sw = max(0, sw - dt)`.
3. `bloom = max(0, bloom - bloomRecover*dt)` (weapon in the current slot).
4. **Reload progress:** if `rl > 0`: `rl -= dt`. If that makes `rl <= 0`: `rl = 0` and refill
   (`take = min(magSize-mag, reserve)`, or the full amount when reserve is -1).
5. **Manual reload:** RELOAD pressed, `rl == 0`, `sw == 0`, `mag < magSize`, `reserve != 0`: `rl = reloadTime`, `bl = 0`.
6. **Melee:** MELEE pressed, `mt == 0`, `sw == 0`: `mt = melee.cooldown`, `mw = melee.windup`, cancel reload (`rl = 0`), `bl = 0`, emit `melee`
   (the swing starts). If `windup` is 0, emit `meleeHit` in the same tick. `melee` is the player's melee for this life (`defsFor(weapons, cls, mel)`).
7. **Grenade:** GRENADE pressed, `gt == 0`, `gren > 0`, `sw == 0`: `gren -= 1`, `gt = grenade.cooldown` (0.8), emit `grenade`.
8. **Fire intent:** `auto` = FIRE held. `semi` = FIRE pressed. `burst`: if FIRE pressed, `bl == 0` and `cd <= 0`, set `bl = burstCount`. Intent is then `bl > 0`.
9. If intent and `sw == 0`, `rl == 0`, `mt == 0`, `cd <= 0`:
   * If `mag == 0`: `bl = 0`. If reserve != 0, start the reload.
   * Otherwise: `spread = (AIM ? adsSpread : hipSpread) + (moving ? moveSpread : 0) + bloom`; `mag -= 1`;
     `bloom = min(bloomMax, bloom + bloomPerShot)`; `cd += fireInterval`; for burst weapons, `bl -= 1` and when it reaches 0, `cd += burstDelay`.
     Emit `fire{slot, spread, pellets}`. If the mag is now empty and reserve != 0, start the reload (auto-reload).
10. If nothing fired and `cd < 0`: `cd = 0`. Finally `pb = buttons`.

Fire carries sub-tick leftover (`cd += interval`), so the average fire rate matches `fireInterval` exactly.
At most one shot happens per tick.

### 9.2 Deterministic spread

Pellet `i` of the shot produced by input `seq` of player `pid`:
`seed = uint32( (seq*0x9E3779B1) ^ (pid*0x85EBCA77) ^ ((i+1)*0xC2B2AE3D) )` (32-bit wrapping multiplies),
`rng = mulberry32(seed)`, `u1 = rng()`, `u2 = rng()`, `r = spread*sqrt(u1)`, `th = 2*PI*u2`,
`dir = normalize(f + R*(r*cos th) + U*(r*sin th))` with `f` = aim vector, `R = (cos yaw, 0, -sin yaw)`, `U = R x f`.
The client draws its own tracers with exactly these directions, so its tracers match the server's hits.

### 9.3 Hitscan resolution (server)

For each `fire` action of a `hitscan` weapon:

* Origin `O` = shooter eye `(x, y + eyeHeight, z)` after this input's movement. Directions are from 9.2.
* `tw = raycastWorld(O, dir, range)` (or `range` on a miss).
* **Lag compensation:** `rt' = clamp(input.rt, k - maxRewindTicks, k)`. Each other player's position is linearly interpolated
  from the history entries at `floor(rt')` and `ceil(rt')`. A target is eligible only if it is alive now and was alive in both
  history entries. Skip the shooter. Skip teammates in team modes (`friendlyFire = false`).
* Nearest target `tp = rayEgg(O, dir, targetPos, tw)`. Egg ellipsoid: centre `pos + (0, hitCenterY=0.75, 0)`,
  radii `(0.42, 0.75, 0.42)`. Hit point `H = O + dir*tp`.
* **Hit zone** `zone = hitZone(C, H, targetPos, dir.x, dir.z)` (sim.mjs), with `ly = H.y - target.y`:
  `ly >= headshotY (1.08)` head (1); else `ly < legY (0.32)` leg (4); else, when the ray has a horizontal part, the lateral offset of `H`
  from the egg axis perpendicular to the shot, `lat = |(H.x-x)*(-dz/hl) + (H.z-z)*(dx/hl)| / hitRadii[0]`, gives arm (3) if `lat >= armLat (0.78)`;
  otherwise body (2). The lateral test is shooter-relative (no target yaw is needed in lag-comp history), and the TP hands are drawn at the silhouette edges.
* Pellet damage = `falloffDamage(w, tp) * zoneMul(w, zone) * attackerDmgMul` (fury 1.5, else 1), where `zoneMul` is `w.zones[head|body|arm|leg]`
  (a def without `zones`, i.e. melee, uses `headMul` on the head and 1 elsewhere). Falloff: full
  `damage` up to `falloffStart`, then linear to `minDamage` at `falloffEnd`, then constant.
* Sum the pellet damage per victim for this shot. The applied damage is `floor(sum + 0.5)` (minimum 1). The event zone `z` is the smallest non-zero
  zone among that victim's pellets (head > body > arm > leg) and `hs = (z == 1)`.
* A spawn-protected target still stops the bullet but takes 0 damage (no `hit` event).
* Broadcast `shot` with each pellet's end point and type (to everyone except the shooter).

**Melee** (four weapons, one per loadout: `weapons.melees`, picked with `hello.mel` / `ld.mel`):
on the `melee` action end spawn protection and broadcast `{"t":"melee","id":..,"w":meleeId}` to everyone except the attacker.
On the later `meleeHit` action (after `windup`), resolve the hit with **that input's** yaw, pitch, `rt` and post-movement eye: direction = aim vector
(no spread), `rayEgg` with radii inflated by the melee's `inflate`, its `range`, the same lag-compensated targets, blocked by world (`raycastWorld`).
Only the nearest victim is hit. The zone is taken on the inflated hit point; damage `floor(damage * zoneMul(m, zone) * dmgMul + 0.5)` (only the head
gets `headMul`; `hs = (zone == 1)`). Then, if the victim is still alive and `knockback K > 0`: `k = normalize(victim.xz - attacker.xz)`
(the horizontal aim direction if that length is below 1e-6), `v.x += k.x*K; v.z += k.z*K; v.y += K*meleeKnockUp (0.35); onGround = false; coy = 0`.
Spawn-protected victims take no damage and no knockback. The `hit` and `kill` weapon id is the melee id.

| melee | swing | damage | headMul | range | inflate | windup s | cooldown s | knockback |
|---|---|---|---|---|---|---|---|---|
| `rollingpin` Rolling Pin (default) | sweep | 50 | 1.2 | 2.0 | 0.30 | 0.10 | 0.65 | 3 |
| `pan` Frying Pan | overhead | 60 | 1.5 | 1.9 | 0.35 | 0.18 | 0.95 | 6 |
| `whisk` Whisk | jab | 34 | 1.25 | 1.7 | 0.25 | 0.05 | 0.40 | 0 |
| `spatula` Spatula | uppercut | 40 | 1.1 | 2.2 | 0.45 | 0.08 | 0.60 | 9 |

**Damage table (v2, PUBG-style ratios adapted to 100 hp eggs; no shield, inside `falloffStart`):**

| Weapon | zones head / body / arm / leg | damage per hit body / head / limbs | shots to kill body / head / limbs |
|---|---|---|---|
| Benedict AR | 2.0 / 1.0 / 0.9 / 0.9 | 25 / 50 / 23 | 4 / 2 / 5 |
| Frittata-3 | 2.0 / 1.0 / 0.9 / 0.9 | 28 / 56 / 25 | 4 / 2 / 4 |
| Poacher SMG | 1.8 / 1.05 / 1.0 / 1.0 | 20 / 34 / 19 | 5 / 3 / 6 |
| Over Easy DMR | 2.0 / 1.05 / 0.95 / 0.95 | 36 / 68 / 32 | 3 / 2 / 4 |
| Shell Piercer | 2.15 / 1.3 / 0.95 / 0.95 | 94 / 155 / 68 | 2 / 1 (also through a full 50 shield) / 2 |
| Deviler (all 9 pellets) | 1.3 / 0.9 / 0.9 / 0.9 | 105 / 152 / 105 | 1 point-blank |
| Coddler | 1.8 / 1.0 / 1.0 / 1.0 | 22 / 40 / 22 | 5 / 3 / 5 |
| Rolling Pin / Pan / Whisk / Spatula | head bonus only | 50/60, 60/90, 34/43, 40/44 (body/head) | 2, 2 (1 head + 1), 3, 3 |

Splash (grenade, launcher) has `z = 0` and is never a headshot.

### 9.4 Projectiles

* **Launcher fire** (`kind: "projectile"`): `dir` from 9.2 (pellets 1). Spawn at `eye + dir*0.6`. If `raycastWorld(eye, dir, 0.6)` hits,
  explode at that point immediately. Velocity = `dir * projectile.speed` (36 u/s). The shell has `gravity 0`, so it flies in a **straight line**
  (no drop) until it hits something or its `life` (3.0 s) runs out.
* **Grenade throw:** `dir` = aim vector. Spawn at `eye + dir*0.5` (explode immediately on a wall within 0.5).
  Velocity = `dir*throwSpeed + (0, throwUp, 0) + playerVelocity*inheritVel`.
* Each tick, in creation order: for **kind 1** first test the segment from `p` to `p + v'*dt`, where `v'` is the velocity after this tick's gravity (`vy' = vy - gravity*dt`, the same segment `stepProjectile` uses),
  against the **current** (not rewound) eggs of all alive players except the owner, using `rayEgg(..., inflate = radius)`.
  If a player is hit before the world, explode at the hit point. Otherwise call `stepProjectile` (sim.mjs): gravity, segment
  vs world. Shells explode on impact (backed off 0.05). Grenades bounce: the normal component is reflected and scaled by `bounce` (0.4),
  the tangential components scale by `friction` (0.7). A grenade comes to rest on a floor when its speed drops below 1. Grenades ignore players.
  When `life` runs out (shell 3.0 s, grenade fuse 1.8 s), it explodes in place.
* **Explosion** at `E` with `splashRadius R`, `damage D`, `knockback K`: for every alive player, `c = pos + (0, 0.75, 0)`, `d = |c - E|`.
  If `d < R` and there is line of sight (`raycastWorld(E, normalize(c-E), d)` misses, OR the same test to the eye point misses):
  `s = 1 - d/R`. `dmg = floor(D*s*(victim == owner ? selfSplashMul(0.5) : 1)*ownerDmgMul + 0.5)`.
  Teammates other than the owner are unaffected. Knockback: `v += normalize(c-E)*K*s`, `vy += knockbackUp(2.0)*s`, `onGround = false`, `coy = 0`
  (if `d < 1e-6`, use `(0,1,0)`). Send `boom`, then `hit` for each damaged player.

### 9.5 Applying damage

```
if victim.spawnProtected or !victim.alive: ignore
absorb = min(victim.sh, dmg); victim.sh -= absorb; victim.hp -= dmg - absorb
victim.lastDamageTick = k
send hit (attacker & victim)
if victim.hp <= 0: kill(victim, attacker, weapon, zone)          # headshot = (zone == 1)
```
**kill:** victim `alive = false`, `hp = 0`, `deaths += 1`, `streak = 0`, `respawnAt = now + mode.respawnSec`. Drop the egg if carried.
The victim's live projectiles stay in play. If `attacker != victim` and `attacker != 0`: `kills += 1`, `streak += 1`, score
`points.kill` (+ `points.headshotBonus` if headshot), team score per mode, streak rewards (10.4). Broadcast `kill`, then `sb`.

## 10. Health, pickups, spawning, killstreaks

### 10.1 Health

* `maxHp = 100`, shield `sh` 0..`maxShield = 50`. Damage hits the shield first (9.5).
* Regen: when alive and `k - lastDamageTick >= regenDelay*tickRate` (5 s), `hp = min(maxHp, hp + regenRate*dt)` (20 hp/s). Shield never regenerates.
* `hp` is a float internally. On the wire `hp = ceil(hp)` (an integer), and 0 when dead.

### 10.2 Pickups (`rules.pickups`)

Each map pickup has `type` and `pos`, and is identified by its index in the map's `pickups` array.
Each tick, for each available pickup, alive players are checked in ascending id order. A player picks it up when
`hypot(px - x, pz - z) <= radius (1.0)` and `y - 0.5 <= py <= y + 1.8`, **and** it is useful:

| type | name | effect | useful if | respawn |
|---|---|---|---|---|
| `hp` | Toast Soldier | `hp = min(100, hp + 40)` | `hp < 100` | 20 s |
| `shield` | Hard-Boiled Shell | `sh = min(50, sh + 50)` | `sh < 50` | 30 s |
| `ammo` | Egg Carton | primary reserve reset to the weapon's `reserve`; `gren = min(maxCount, gren + 1)` | reserve below full or `gren < maxCount` | 15 s |

Broadcast `pick`. The `pk` string reflects availability. All pickups are available at match start.

### 10.3 Spawning

* Candidates: FFA uses **all** spawns. Team modes use spawns with `team ==` the player's team. If none exist, fall back to all spawns.
* Score each candidate = distance to the nearest **living enemy** (FFA: any other living player), or infinity if there are none.
  Pick randomly among the 3 best-scoring candidates.
* Spawned state: pos = spawn pos, `yaw` = spawn yaw, pitch 0, velocity 0, `onGround = true`, `hp = 100`, `sh = 0`,
  `coy = 0`, fresh weapon state for the player's current `cls` and `mel` (`newWeaponState`, defs `defsFor(weapons, cls, mel)`), fury off,
  **spawn protection for 2.0 s**. Protection ends early on the first fire, melee (swing start) or grenade action. The `spawn` event carries `mel`.
* Respawn happens automatically `mode.respawnSec` after death (FFA 3 s, Teams 4 s, Nest Raid 5 s).

### 10.4 Killstreak rewards (`rules.streaks`): applied when the killer's streak **reaches** the value

| at | id | name | effect |
|---|---|---|---|
| 3 | `refill` | Second Breakfast | primary mag and reserve full, `gren = min(maxCount, gren+1)` |
| 5 | `shell` | Hard-Boiled | `sh = maxShield` |
| 8 | `fury` | Hot Sauce | damage multiplier 1.5 for 15 s (flag 64, `me.fu`) |

Each reward broadcasts `streak` and adds `points.streakBonus` (50) to the killer's score. Weapon-state changes made by the server
(refill, pickups) reach the client through `me.ws` on the next snapshot.

## 11. Modes, scoring and match flow (`modes.json`)

| id | name | teams | win condition | time | respawn |
|---|---|---|---|---|---|
| `ffa` | Free-For-All | no | a player reaches **25 kills** | 8 min | 3 s |
| `teams` | Team Scramble | 2 | team kill count reaches **50** | 10 min | 4 s |
| `nest` | Nest Raid | 2 | **3 captures** | 10 min | 5 s |

**Scores:** player `sc` gets `kill 100`, `headshotBonus 25`, `streakBonus 50`, and in nest mode `capture 300`, `return 50`,
`carrierKill 50` (killing an enemy carrier), `take 25`. Team score (`ts`): Teams = kills of enemies, Nest = captures.
Suicides and falls change nothing except `deaths`.

**Time-out winner:** FFA = most kills, then higher `sc`, then fewer deaths, then lower id. Team modes = higher team score, otherwise a draw (`wt = 0`).

**Nest Raid rules** (each team `T` has one egg and one nest from the map's `nests`):
* `touch` = `hypot(dx,dz) <= nest.touchRadius (1.2)` and `|dy| <= 1.5`.
* Egg **home** (state 0): an alive enemy of `T` touching it takes it (state 1, carrier = them, `flag take`).
* Egg **carried** (state 1): position = carrier position. If the carrier touches **their own** team's nest while their own egg is
  home, it is a capture (state 0 for egg `T`, team score +1, `flag cap`).
* Egg **dropped** (state 2): created when the carrier dies or leaves, at the carrier's position snapped down to the floor
  (`raycastWorld` straight down from `y + 0.1`). If no floor is found or the floor is below `killY + 1`, the egg returns immediately.
  A team-`T` player touching it returns it (`flag return`, +50). An enemy touching it takes it. After 20 s (`dropReturnSec`) it auto-returns (`id` 0).
* One player can carry only one egg. Carrying does not change movement.

**Match flow:** `live`, then when a limit or the time is reached, `end` (state `"ended"`, 10 s intermission). During
intermission inputs are acked but **not simulated**, nobody takes damage, and snapshots continue. Then `start` fires:
the next map is random from the mode's `maps`, excluding the current one when possible. All scores, streaks and pickups reset. Teams are
rebalanced: while `|n1 - n2| > 1`, move the most recently joined player of the bigger team. Then everyone respawns
(`spawn` events) and the state becomes `"live"`. The tick counter `k` keeps counting. Clients drop pending inputs on `start`.

## 12. Rooms and matchmaking

* Max **12 players** per room (`rules.net.maxPlayersPerRoom`).
* **Room code:** 6 characters (`rules.rooms.codeLength`) from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. Codes are matched case-insensitively and are unique among live rooms.
* **Quickplay** (`room == ""`, `create == 0`): join the **public** room of the requested mode that has the most players but fewer than 12
  (ties: the oldest room). If there is none, create a public room (map = `hello.map` if valid for the mode, else random).
* **Create private** (`create == 1`): new private room with `mode` and `map`. The creator gets the code in `welcome.room.code`. Private rooms never appear in quickplay or `/api/rooms`.
* **Join by code:** `room == "K7Q2MX"`. Error `no_room` if no such room exists, `room_full` if it has 12 players. The joiner's `mode`/`map` are ignored.
* **Team assignment on join:** the smaller team. On a tie, the team with the lower score. On a further tie, team 1.
* Empty public rooms are destroyed immediately. Empty private rooms are destroyed after 60 s, or after 5 s if no player ever entered them.
* Server-wide: `-maxrooms` flag (default 200). Beyond it, new rooms fail with `server_full`. At most half of the rooms may be private
  (a create beyond that also gets `server_full`), so quickplay always has room.

## 13. Rate limits, validation, disconnects

### 13.1 Limits (per connection)

| What | Limit | On violation |
|---|---|---|
| frame size | 4096 bytes | `err too_big`, close |
| all messages | token bucket 120/s, burst 120 | `err rate`, close |
| inputs per `i` batch | 8 | extra entries ignored |
| input queue | 16 entries | oldest dropped |
| input **consumption** | token bucket: +1 token per tick, max 6. Each consumed input costs 1. One input per tick while at most 3 are queued (jitter buffer); max 2 per tick (`maxInputsPerTick`) beyond that. | inputs wait in the queue (anti speed-hack, de-jitter) |
| `chat` | 1/s, burst 3, at most 120 characters | dropped, `sys` notice |
| `ld` | 2/s | dropped |
| `ping` | 2/s | dropped |
| `hello` | first message, within 3 s, once | `err bad_hello`, close |
| idle (no inputs) | 120 s without an accepted input (empty batches do not count) | `err idle`, close |
| skipped `seq`s | budget of 32, refilled 0.25/s (spread is seeded by `seq`, so seqs cannot be shopped for) | the input is dropped |

**Input starvation:** if a live player has no queued input for `starveTicks = 10` consecutive ticks, the server runs a
null **movement** step (`stepMove` with keys 0 and the last yaw, speed multiplier for buttons 0) each tick until inputs arrive.
The weapon state machine is **not** ticked, so held buttons, bursts and timers continue exactly as the client predicted.
This does **not** advance the ack. Reconciliation fixes the client's position.

**Per-IP limits (server):** at most `-maxconnsperip` (default 8) live sockets per client IP (HTTP 429 before the upgrade),
3 private-room creates per minute and 10 unknown-code joins per minute (then `err too_many` until the budget refills).
Loopback clients are exempt; behind a reverse proxy run with `-trustproxy` so the last `X-Forwarded-For` entry is used.

### 13.2 Input validation

`keys &= 31`, `buttons &= 31`. yaw and pitch must be finite (otherwise drop the entry and count it as a violation). The pitch is clamped.
`slot` not in {0,1} keeps the current slot, and inputs consumed while the player is dead never change it. `rt` not finite is treated as `k`. `seq` must be an integer > last received.
Unknown message types are ignored. Malformed JSON gives `err bad_msg` and a close.

### 13.3 Text sanitisation

**Names:** NFC, keep only `[A-Za-z0-9 _.-]`, collapse runs of spaces, trim, cut to 16 characters. If empty, use `"Egg" + 3 random digits`.
Duplicate names are allowed. **Chat:** strip control characters, trim, cut to 120 runes, drop if empty. Clients render all text as text (never HTML).

## 14. Client obligations

1. **Fixed-step loop:** accumulate real time and run 0..N sim ticks of 1/60 s per frame (cap at 8 per frame).
   Each tick: sample input, `seq++`, round yaw/pitch to q4, `simulateInput(...)` on the local predicted state,
   play local effects for `fire` actions using `shotDirs(myId, seq, ...)`, store the input as pending, and send it.
2. **Reconciliation on each snapshot:** if `me.al == 1`, set the predicted player state from `me` (x,y,z,vx,vy,vz,g, and `coy = me.cy`)
   and the weapon state from `me.ws`, drop pending inputs with `seq <= a`, and replay the remaining ones through `simulateInput`
   **without** re-playing effects. Smooth the visual error: when the corrected render position differs by less than 1 unit, decay the offset over about 100 ms. Otherwise snap.
   If `me.al == 0`, stop predicting (dead camera) but keep sending inputs.
3. **Remote players:** buffer the snapshots and render each other player at render tick `rt` by linearly interpolating
   between the two snapshots that bracket it (yaw by the shortest arc). Extrapolate at most 100 ms if the buffer runs dry.
   Projectiles are interpolated the same way.
4. **Render interpolation for the local player:** draw between the previous and current predicted tick using the accumulator alpha.
5. **On `start`:** load the new map, reset prediction, clear pending inputs.

## 15. Server tick order (each 1/60 s, per room)

1. Accept joins and leaves (send `welcome`/`join`/`leave`; spawn the joiners).
2. For each player in ascending id: refill 1 input token (max 6). Then while the queue is non-empty, tokens >= 1 and fewer than the
   per-tick limit have been consumed this tick (1, or 2 when more than 3 inputs are queued):
   pop an input and set `ack = seq`. If the player is alive and the match is live, run `simulateInput` and resolve its actions in order (9.3 and 9.4),
   ending spawn protection on fire, melee or grenade. Then apply input starvation (13.1).
3. Step projectiles (9.4) in creation order and resolve explosions.
4. Kill-Y check (`y < killY`: die with weapon `fall`, killer = self).
5. Pickups (10.2), nest objective (11), regen, fury expiry, spawn-protection expiry, respawns (`k >= respawnAt`).
6. Record lag-comp history for tick `k` (position + alive for every player).
7. Match timer and limit check (may send `end`). During intermission, count down to `start`.
8. If `k % snapshotEvery == 0`, build and send snapshots. Send `sb` once per second (and after kills and captures).
9. Flush all messages queued this tick to each client as **one frame** (a JSON array) in generation order, with the snapshot last.
10. `k += 1`.

## 16. Data file formats (`shared/data`)

* **`rules.json`**: the constants used throughout this document: `net`, `player`, `move`, `combat`, `pickups`, `streaks`, `rooms`.
* **`weapons.json`** (version 2): `primaries` (selectable class ids), `secondary`, `grenade`, `melee` (= the default melee, kept for v1 readers),
  `melees` (selectable melee ids), `defaultMelee`, `defaultPrimary`, and `weapons{id: def}`.
  Hitscan and projectile defs have: `name, class, slot, kind ("hitscan"|"projectile"), fireMode ("auto"|"semi"|"burst"), fireInterval, burstCount,
  burstDelay, damage, minDamage, falloffStart, falloffEnd, range, headMul, pellets, magSize, reserve (-1 = infinite), reloadTime,
  switchTime, hipSpread, adsSpread, moveSpread, bloomPerShot, bloomMax, bloomRecover, recoil{pitch,yaw,recover} (client only),
  adsFov (degrees, client only), moveMul`, plus `projectile{kind,speed,gravity,radius,life,splashRadius,knockback,fuse,bounce,friction}`.
  Every hitscan gun has `zones{head,body,arm,leg}` (`headMul` mirrors `zones.head`). Client-only fields: `scope` (`"none"|"sniper"|"marksman"|"rocket"`),
  `adsTime` (s), `reloadStyle` (`"mag"|"shells"|"clip"|"rocket"|"pistol"`), `eject` (`"brass"|"shell"|"none"`), `cycle` (`"none"|"bolt"|"pump"`).
  The grenade def has `damage,startCount,maxCount,cooldown,throwSpeed,throwUp,inheritVel,projectile{...}`.
  Melee defs have `name, class:"Melee", kind:"melee", desc, damage, headMul, range, inflate, cooldown, windup, knockback`, plus client-only `swing`
  (`"sweep"|"overhead"|"jab"|"uppercut"`). Both servers refuse to start (and the JS loader throws) unless every `melees` id is a melee with
  `0 <= windup < cooldown`, `defaultMelee` is listed, and every hitscan gun has 4 positive `zones`.
* **`modes.json`**: `modes{id:{name,short,desc,teams,objective,scoreLimit,scoreUnit,timeLimitSec,respawnSec,points{...},nest?,maps[]}}`, `teams{1,2}`.
* **`cosmetics.json`**: `defaults`, `colors[{id,name,shell,speckle}]`, `hats[{id,name,shape,colors}]`, `stamps[{id,name,glyph,color}]`.
  Everything is free and always unlocked. The client renders hats and stamps procedurally from `shape`/`glyph`.
* **`maps/index.json`**: `{maps:[{id,name,desc,modes}]}`.
* **`maps/<id>.json`**:
  ```
  { format: 1, id, name, desc, author, modes: [..],
    bounds: {min:[x,y,z], max:[x,y,z]}, killY,
    palette: {sky, skyHorizon, fog, fogNear, fogFar, ambient, ambientIntensity, hemiGround, sun, sunIntensity, sunDir:[x,y,z]},
    materials: { name: {color, rough, emissive?} },
    boxes:   [ {min:[x,y,z], max:[x,y,z], mat, solid?: false} ],   // solid defaults to true; solid:false = visual only (decals)
    spawns:  [ {pos:[x,y,z], yaw, team: 0|1|2} ],                   // team 0 = FFA-only spawn
    pickups: [ {type: "hp"|"shield"|"ammo", pos:[x,y,z]} ],
    nests:   [ {team: 1|2, pos:[x,y,z]} ] }
  ```
  Maps are generated by `scripts/mapgen/` (`make maps`) and checked by `scripts/validate-maps.mjs`. Do not hand-edit the JSON.

## 17. Conformance tests

* `shared/testvectors/movement.json`: per case, a map, start position, a list of inputs `[keys,yaw,pitch,buttons,slot]` (seq = index+1,
  primary `benedict`), and the expected `[x,y,z,vx,vy,vz,onGround,coy]` after each input (`simulateInput` from a fresh state), including
  the coyote-time cases `coyote_jump_after_ledge` and `coyote_expired`.
* `shared/testvectors/weapons.json`: per case, a primary, an optional melee and inputs `[buttons, slot, moving]` with the expected 15-element `ws`
  array and actions per tick (`meleeHit` included).
* `shared/testvectors/math.json`: mulberry32 outputs, shot seeds, `shotDirs`, `rayEgg`, `raycastWorld`, `falloffDamage`, `hitZone`, `zoneMul`.
* Regenerate with `node scripts/gen-testvectors.mjs`. Check that the JS ref still matches with `--check`. The Go port's `go test` loads these files
  (path relative to the server module: `../shared/testvectors`) and requires `|a-b| <= 1e-9` for floats and exact equality for integers.

## 18. Implementation notes (extensions in the shipped server and client)

These are additive and backwards compatible. Clients must ignore unknown fields.

* **ROSTER** objects for server-controlled bots carry `"bot":1`. Bots fill a room up to `-bots` players (default 4)
  while at least one human is present, and leave to make room for joining humans.
* **`/api/rooms`** entries add `humans` (`n` counts bots too).
* **`/api/stats?by=score|kills|wins|kd|streak|captures&n=25`** returns the leaderboard
  `{by,online,rooms,tracked,top:[{n,ki,de,hs,sc,wi,mp,bs,ca,t}]}` (keyed by display name, case-insensitive).
* **`pong`** is sent immediately as its own frame (not batched with the tick) so RTT is accurate.
* **`ld`**: cosmetic fields left out keep their current values; unknown ids reset to the defaults.
* A team-only `chat` in FFA is delivered as public chat with `tm:0`. Chat sanitising also strips bidi control characters.
* An out-of-range `yaw` is wrapped into (-PI, PI] instead of being dropped. Clients send at most +-3.1415 at the edge, because q4 of PI is 3.1416, which is outside the range.
* Spawn-protected players get no splash knockback. Launcher shells explode on contact with teammates of the owner but do not damage them.
* A dropped egg with no floor under it sends only `flag return` (id 0) without a preceding `drop`.
* Over the `-maxconns` cap the server answers HTTP 503 before the WebSocket upgrade (instead of `err server_full`); over the per-IP cap, HTTP 429.
* Binary frames get `err bad_msg`. Any first message other than a valid `hello` gets `err bad_hello`.
