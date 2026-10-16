# Yolkout v2: implementation spec (damage zones, cartoon art pass, hands, animations, fixes)

Status: binding contract for three parallel builders. **A** = sim/server/data, **B** = art, **C** = first-person/effects.
The builders do not talk to each other. Where this spec gives a number, a name or a signature, use exactly that.
Where it says SHOULD, it is a recommendation. Where it says MUST, it is required and will be checked.

Contents

0. Research summary (why these numbers / this look)
1. File ownership
2. Cross-module contract (data fields, wire fields, JS APIs)
3. Builder A: sim, server, data, protocol, loadout
4. Builder B: art modules, models, egg avatar, cracks
5. Builder C: first-person hands/animation, scopes, overlay, effects, camera, tracer fix
6. Root cause of the "white lines behind the wall" bug
7. Acceptance criteria and tests (per user item)
8. Performance and payload budgets
9. Ports, processes, integration order

---

## 0. Research summary

### 0.1 PUBG damage model (community datamines, pubg.wiki.gg; the developer does not publish values)

| Class | Head | Torso | Limbs | Typical base damage | Notes |
|---|---|---|---|---|---|
| Assault rifle | 2.35 | 1.0 | ~0.9 | M416 40, SCAR-L 42, M16A4 43, AKM 47 | (M416 head 94 = 40 x 2.35) |
| DMR | 2.35 | 1.05 | ~0.95 | Mini 14 48, SKS 53, SLR 56 | (Mini 14 body 50.4 = 48 x 1.05) |
| Sniper (bolt) | 2.5 | 1.3 | ~0.95 | M24 75, Kar98k 79, AWM 105 | (Kar98k body 102.7 = 79 x 1.3) |
| SMG | 2.1 | 1.05 | 1.3 | Vector 31, MP5K 33, UMP45 41 | limbs > torso to offset vests |
| Shotgun (9 pellets) | ~1.5 | 0.9 | 1.05 | S1897/S686 26 per pellet | strong falloff, min 4 per pellet in range |
| Pistol | 2.1 | 1.0 | 1.05 | P92 34, P1911 42, R1895 64 | |

Falloff: rifles keep near-full damage over typical fight ranges (drop-off begins far out). Shotguns lose damage quickly.
Relative body damage per hit with AR = 1.0: SMG ~0.8, pistol ~0.85, DMR ~1.3, sniper ~2.5 (body, including the 1.3 torso multiplier), shotgun ~5 (whole shell).

**Adaptation to Yolkout:** eggs have 100 HP plus up to 50 shield, no armour tiers and arcade TTK. We keep PUBG's **ordering and ratios**,
compress the head multipliers by about 15 % (big head zone, high rate of fire), and drop PUBG's "limbs above torso" quirk for SMG and shotgun,
because that quirk exists only to offset body armour, which Yolkout does not have.

### 0.2 Cartoon art direction (references: Valve's "Illustrative Rendering in Team Fortress 2", stylised weapon art write-ups on 80.lv, three.js `MeshToonMaterial` docs)

* **Read the silhouette first.** Chunky, exaggerated proportions: magazines, muzzles, sights and grips about 1.2 to 1.4 times realistic size.
  Give each gun one or two standout features, such as a big drum, a fluted ramekin muzzle or a giant scope, not detail everywhere.
* **Forward-facing planes that catch light:** bevelled edges on every box (rounded boxes), so highlights and rim light have something to grab.
* **Shading:** a 3-band toon ramp (stepped `gradientMap` with nearest filtering), warm key light and cool shadow,
  plus a rim/fresnel term for separation from the background. Saturated base colours with darker accent "trim".
* **Outlines:** an inverted hull (a back-face copy pushed out along smoothed normals, flat dark colour `#1e1622`) on hero objects only
  (first-person gun, hands, egg shells), so the cost stays under control.
* **Moving parts worth animating.** Every gun gets a real reload mechanism (mag, bolt, pump, slide, rocket) as a separate part.
* **Reload beats** use pose-to-pose with anticipation, overshoot and settle: cant, release, swap off-screen (the hand goes "behind the camera"),
  insert with an impact bump, chamber, then return with a small overshoot. No pops at the start or end.

---

## 1. File ownership

Edit only files you own. If you need something in another builder's file, write it in your return value. Never edit it yourself.

| Builder | Owns (create or edit) |
|---|---|
| **A** sim/server/data | `shared/**` (PROTOCOL.md, CLIENT_API.md, data/*.json, ref/sim.mjs, testvectors/**, physics_vectors.json); `server/**`; `web/js/engine/physics.js`; `web/js/engine/test/{physics.test.mjs,gen-physics-vectors.mjs,register.mjs,sim-loader.mjs,netcheck.mjs}`; `web/js/net/localserver.js`, `web/js/net/connection.js`; `scripts/**` **except** `scripts/art-gallery.mjs` and `scripts/fp-shots.mjs`; `Makefile`; `README.md`; UI melee picker and stats only: `web/js/ui/{loadout.js,home.js,app.js,store.js,data.js,icons.js}` |
| **B** art | NEW `web/js/game/art/**` (including `art/test/**`); `web/js/game/models.js`; `web/js/engine/textures.js`; `web/js/ui/preview3d.js` (only to pass the melee through, keeping its exports); `scripts/art-gallery.mjs` |
| **C** first-person/effects | `web/js/game/{viewmodel.js,overlay.js,effects.js,game.js,input.js,audiohook.js}`; NEW `web/js/game/vm/**`; NEW `web/js/game/test/**`; `web/js/audio.js`; `web/js/engine/renderer.js`; `web/js/net/interp.js`, `web/js/net/clock.js`; `web/js/main.js`; `web/js/ui/hud.js`, `web/js/ui/settings.js` (new toggles only); `web/index.html`; `web/css/style.css`; `web/js/engine/test/dev.html`; `scripts/fp-shots.mjs` |
| nobody | `web/js/engine/mapmesh.js`, `scripts/mapgen/**` outputs, the other `web/js/ui/*` files, `web/vendor/**`. Do not touch them. |

Notes:
* A's UI picker MUST reuse the existing picker widget and classes in `loadout.js` (the same picker as the primary, `className: "weapon-btn"`),
  so it needs **no CSS change**. CSS and `index.html` belong to C.
* `make test` must run C's and B's node tests. **A adds this to `test-js` in the Makefile**:
  `for f in web/js/game/test/*.test.mjs web/js/game/art/test/*.test.mjs; do [ -e "$$f" ] && node "$$f" || exit 1; done`
  (it skips missing globs). A also adds `make art-shots` = `node scripts/art-gallery.mjs` and `make fp-shots` = `node scripts/fp-shots.mjs`.
  These two are **not** part of `make test`.

---

## 2. Cross-module contract

### 2.1 Data (`shared/data`, written by A, read by all)

**`rules.json` additions/changes**

```jsonc
"player": { ...unchanged..., "headshotY": 1.08, "legY": 0.32, "armLat": 0.78 },
"move": { "moveSpeed": 6.0, "groundAccel": 12.0, "groundDecel": 16.0, "airAccel": 3.5, "gravity": 24.0,
          "jumpVelocity": 8.2, "terminalVelocity": 25.0, "maxHorizontalSpeed": 20.0, "stepHeight": 0.55,
          "adsMoveMul": 0.65, "coyoteTicks": 6, "eps": 1e-06 },
"combat": { ...unchanged..., "meleeKnockUp": 0.35 }
```

**`weapons.json`**: the complete new file is given in section 3.2. Every builder may rely on these fields:

* Top level: `primaries`, `secondary`, `grenade`, `melee` (= the default melee, kept for old readers), **`melees`** `["rollingpin","pan","whisk","spatula"]`,
  **`defaultMelee`** `"rollingpin"`, `defaultPrimary`.
* Every gun: the old fields, plus **`zones`** `{head, body, arm, leg}`. `headMul` is kept equal to `zones.head`.
  Client-only fields: **`scope`** (`"none"|"sniper"|"marksman"|"rocket"`), **`adsTime`** (s), **`reloadStyle`**
  (`"mag"|"shells"|"clip"|"rocket"|"pistol"`), **`eject`** (`"brass"|"shell"|"none"`), **`cycle`** (`"none"|"bolt"|"pump"`; the post-shot manual action).
* Every melee: `name, class:"Melee", kind:"melee", desc, damage, headMul, range, inflate, cooldown, windup, knockback`, plus client-only `swing`
  (`"sweep"|"overhead"|"jab"|"uppercut"`).

### 2.2 Wire additions (PROTOCOL.md, written by A, consumed by C). All are additive. Protocol version stays 1.

| Where | Field | Meaning |
|---|---|---|
| `hello` | `mel` string | melee id from `weapons.melees`. Unknown or missing values become `weapons.defaultMelee`. |
| `ld` | `mel` string | takes effect at the next spawn, like `cls`. It triggers a `pu` broadcast. |
| ROSTER | `mel` | next-spawn melee |
| `spawn` | `mel` | melee for this life |
| `hit` | `z` int | hit zone: `0` none (splash, fall), `1` head, `2` body, `3` arm, `4` leg. For multi-pellet shots it is the best zone, using the priority head > body > arm > leg, which is the smallest non-zero id. `hs` stays and equals `z == 1`. |
| `kill` | `z` int | zone of the killing blow (0 for splash or fall) |
| `shot.e[i]` | 5th element | present only when `h == 2`: the zone of that pellet (`[x,y,z,2,zone]`) |
| `melee` | `w` string | the attacker's melee id. It is sent when the swing **starts** (action `melee`). The hit itself comes later as `hit`. |
| snapshot `me` | `cy` int | coyote ticks left (sim state, needed for reconciliation) |
| `me.ws` | 15th element `mw` | melee windup left (s). Array: `[slot, mag0, mag1, res0, res1, gren, cd, rl, sw, bl, bloom, mt, gt, pb, mw]` |
| player flags | `512` | threw a grenade since the previous snapshot (cleared like `256`) |

### 2.3 Shared sim API (`shared/ref/sim.mjs`, A; used by C through `physics.js`)

```js
export const ZONE = { NONE: 0, HEAD: 1, BODY: 2, ARM: 3, LEG: 4 };
export function hitZone(C, hx, hy, hz, px, py, pz, dx, dz) -> 0..4
export function zoneMul(w, zone) -> number
export function defsFor(weaponsJson, primaryId, meleeId) -> { w:[p, s], grenade, melee }
// weaponTick may now emit {a:"meleeHit"} in addition to the existing actions
// player state gains `coy` (int); weapon state gains `mw` (float)
```

`physics.js` (A): `loadData(...).defs(cls, mel)`; `Predictor` copies and reconciles `coy` (`ps.coy = me.cy | 0`) and `ws.mw`.

### 2.4 Art API (B writes, C imports **only** from `web/js/game/art/index.js`)

```js
// all builders return NEW object instances that share geometries and materials (parts animate independently per instance)
export function buildGun(id, opts = { lod: "fp" | "tp" }) -> GunModel
export function buildHand(side /* "L" | "R" */, opts = { lod: "fp" | "tp", color: "#f4efe4" /* cuff colour */ }) -> HandModel
export function buildMelee(id, opts = { lod }) -> MeleeModel
export function buildGrenade(opts = { lod }) -> { group, sockets: { grip }, parts: { spark } }
export function buildRocket(opts = { lod }) -> { group, sockets: { tail, nose }, parts: { flame } }   // -Z = nose
export function buildCasing(kind /* "brass" | "shell" */) -> THREE.BufferGeometry   // for C's instanced pool
export function toonMaterial(color, opts = {}) -> THREE.Material                     // shared, cached by key
export function addOutline(object3D, { width, color } = {}) -> THREE.Object3D[]   // inverted hull meshes added as children
export function setOutlineQuality(q /* "low"|"medium"|"high" */)                      // low = outlines hidden
export function modelStats(object3D) -> { tris, drawCalls }
export const HAND_POSES = ["open","grip","trigger","pinch","point","fist","cup","palm"];
export const MELEE_IDS = ["rollingpin","pan","whisk","spatula"];
```

**GunModel**
```js
{
  id, lod,
  group: THREE.Group,          // gun root. Frame: origin = right-hand grip point, -Z forward (muzzle), +Y up, +X right; metres at TP scale
  muzzle: THREE.Vector3,       // legacy: muzzle position in gun-root space (= sockets.muzzle position)
  sockets: {                   // THREE.Object3D children; follow animated parts they belong to
    muzzle,      // -Z = fire direction
    ejector,     // +X = ejection direction (absent when eject == "none")
    sight,       // ADS eye line: the camera looks along this socket's -Z through its origin
    rightGrip,   // place the R hand group here with pose userData.pose (normally "trigger")
    leftGrip,    // L hand: foregrip / handguard / pump / launcher front grip / pistol support ("cup")
    magGrip,     // child of parts.mag: L hand "pinch" (absent when there is no mag)
    chargeGrip,  // charging handle / bolt knob / pump grip / slide serrations (absent for the launcher)
    loadPort,    // shotgun loading gate / sniper clip guide / launcher tube front; -Z = insertion direction
    magWell,     // where a new mag's top must be aligned before insertion (mag guns and pistol)
    tubeBack,    // launcher only: backblast point
  },
  parts: {                     // THREE.Object3D; userData.rest = {position: Vector3, quaternion: Quaternion}
    mag?, bolt?, slide?, pump?, rocket?, shell?, clip?, trigger?, sightGlass?
  },
  travel: {                    // animation metadata, in gun-root space
    bolt?:  { axis: [0,0,1], dist: 0.05, lift?: 1.05 /* rad, sniper bolt rotation about its own -Z axis before travel */ },
    slide?: { axis: [0,0,1], dist: 0.045 },
    pump?:  { axis: [0,0,1], dist: 0.09 },
    mag?:   { axis: [0,-1,0.15], dist: 0.16 },   // drop direction (normalised by C)
    rocket?:{ axis: [0,0,-1], dist: 0.28 },      // insertion path from tubeFront outward
  },
  stats: { tris, drawCalls },
  dispose(),                   // frees only per-instance resources (shared geometry is cached)
}
```
Part conventions: `shell` (shotgun) and `clip` (sniper) are **hidden templates**. C may reparent them (move them to a hand) and show them.
`rocket` is visible while loaded. The R hand on `rightGrip` with pose `"trigger"` and the L hand on `leftGrip` with `sockets.leftGrip.userData.pose` MUST look like a correct grip
**with the hand group's world transform exactly equal to the socket's world transform (scale 1)**. B is responsible for this match, because B makes both the hands and the sockets.

**HandModel**
```js
{
  side, lod,
  group: THREE.Group,          // frame: origin = grip centre. In "grip" the fist closes around a 0.022 m bar along local X through the origin.
                               // "open": fingers point -Z, back of the hand faces +Y; R thumb toward -X, L thumb toward +X.
  points: { hold, pinch, palm }, // THREE.Object3D children: where held items attach (hold = grip centre), the pinch point, the palm-centre push point
  setPose(a, b = a, t = 0),    // blend pose a to pose b by t (0..1); names from HAND_POSES; cheap enough to call every frame
  setColor(css),               // cuff colour (the local player's shell colour)
  dispose(),
}
```
Held-item rule: an item with a `sockets.grip` is attached so that `item.sockets.grip` world transform == `hand.points.hold` world transform
(C computes `item.group.matrix = hold.matrixWorld * inverse(grip.matrix)` in the shared parent space).

**MeleeModel**: `{ id, group, sockets: { grip, impact }, stats, dispose() }`. Frame: the handle runs along local +Y from `grip` and the striking face is at `impact`.

**EggAvatar** (`models.js`, B). The constructor and all existing members stay (`root, plate, shellColor, setCosmetics, setTeam, setName,
setWeapon, setCarry, muzzleWorld, fire, melee, update, setVisible, dispose`). Additions:
```js
new EggAvatar(data, { name, team, teamColor, cos, cls, mel = data.weapons.defaultMelee || data.weapons.melee, nameplate, lod: "tp" })
setMelee(id)
melee(id?)                 // start the TP swing for this melee (id defaults to the avatar's melee)
throwNade()
setHealth(hpFrac, shFrac = 0) // 0..1; drives crack stage + expression; call every frame (cheap: dirty check)
update(st, dt, t)          // st: {x,y,z,yaw,pitch,flags,hp?,sh?}; flag 8 rising edge starts the reload timeline (weapon reloadTime from data),
                           // 128 = switching (gun dips), 4 = aiming pose, 512 rising edge = throwNade()
static crackStage(hpFrac) -> 0|1|2|3   // >= 0.75: 0, >= 0.5: 1, >= 0.25: 2, else 3
```
`models.js` keeps its other exports (`buildPickup, buildNest, buildGoldenEgg, buildGrenade, buildShell, buildGun, buildRollingPin, mergeGroup,
eggGeometry, eggRadiusAt, shellTexture, buildHat`). `buildGun`/`buildGrenade` are re-exported from `art/index.js`
(`buildGun(id)` still has `.group` and `.muzzle`). `buildShell()` returns `buildRocket({lod:"tp"}).group`.

---

## 3. Builder A: sim, server, data, protocol, loadout

### 3.1 Hit zones (exact)

The hitbox is unchanged: an ellipsoid with centre `feet + (0, 0.75, 0)` and radii `(0.42, 0.75, 0.42)` (melee: radii + inflate).
Hit point `h = O + d*t`. Zones in hitbox-local coordinates (`ly = hy - py`):

```js
export const ZONE = { NONE: 0, HEAD: 1, BODY: 2, ARM: 3, LEG: 4 };
/** Zone of a hit at (hx,hy,hz) on the egg standing at (px,py,pz), for a ray whose direction has horizontal part (dx,dz). */
export function hitZone(C, hx, hy, hz, px, py, pz, dx, dz) {
  const ly = hy - py;
  if (ly >= C.headshotY) return ZONE.HEAD;          // top cap, 1.08 and up
  if (ly < C.legY) return ZONE.LEG;                 // bottom 0.32 (the feet)
  const hl = Math.sqrt(dx * dx + dz * dz);
  if (hl > 1e-6) {
    // lateral offset from the egg axis, perpendicular to the shot (as seen by the shooter), normalised by the x radius
    const lat = Math.abs((hx - px) * (-dz / hl) + (hz - pz) * (dx / hl)) / C.hitRadii[0];
    if (lat >= C.armLat) return ZONE.ARM;           // outer 22 % of each side in the mid band, where the hands are drawn
  }
  return ZONE.BODY;
}
export function zoneMul(w, zone) {
  const z = w.zones;
  if (!z) return zone === ZONE.HEAD ? (w.headMul ?? 1) : 1;   // melee: head bonus only
  return zone === ZONE.HEAD ? z.head : zone === ZONE.BODY ? z.body : zone === ZONE.ARM ? z.arm : zone === ZONE.LEG ? z.leg : 1;
}
```
`makeConsts` adds `legY, armLat` (from `rules.player`), `groundDecel, coyoteTicks` (from `rules.move`). The Go port mirrors these names (`HitZone`, `ZoneMul`).
The lateral test is shooter-relative on purpose: it needs no target yaw in lag-comp history, and it matches what the shooter sees,
because B draws the TP hands at the silhouette edges.

**Hitscan damage (server and localserver):** per pellet: `zone = hitZone(C, hit, targetPos, d[0], d[2])`,
`dmg = falloffDamage(w, t) * zoneMul(w, zone) * attackerDmgMul`. Sum per victim. The applied damage is `max(1, floor(sum + 0.5))`. The event `z` is the min non-zero zone over that victim's pellets.
**Melee:** compute the zone on the real egg with `meleeZone(C, eye, dir, victimPos)` (closest point of the aim ray to the egg centre, see PROTOCOL 9.3; the inflated hit point overstated headshots). `dmg = floor(m.damage * zoneMul(m, zone) * dmgMul + 0.5)` (only the head gets `headMul`). `hs = zone == 1`.
**Splash** (grenade, launcher): `z = 0`, never a headshot. This is unchanged.

### 3.2 `weapons.json` (complete. Copy it exactly. `notes` updated.)

```json
{
  "version": 2,
  "notes": "All angles in radians, times in seconds, distances in world units (1 unit ~ 1 m). reserve -1 = infinite. spread = cone half-angle. damage is per bullet/pellet before falloff; final = falloff(damage) * zones[zone] * streak multiplier. headMul mirrors zones.head. scope/adsTime/reloadStyle/eject/cycle/swing are client-only.",
  "primaries": ["benedict", "deviler", "poacher", "piercer", "frittata", "overeasy", "souffle"],
  "secondary": "coddler",
  "grenade": "quiche",
  "melee": "rollingpin",
  "melees": ["rollingpin", "pan", "whisk", "spatula"],
  "defaultMelee": "rollingpin",
  "defaultPrimary": "benedict",
  "weapons": {
    "benedict": {
      "name": "Benedict AR", "class": "Assault Rifle", "slot": 0, "kind": "hitscan",
      "desc": "Reliable full-auto all-rounder.",
      "fireMode": "auto", "fireInterval": 0.1, "burstCount": 0, "burstDelay": 0,
      "damage": 25, "minDamage": 17, "falloffStart": 25, "falloffEnd": 60, "range": 120, "headMul": 2.0, "pellets": 1,
      "zones": { "head": 2.0, "body": 1.0, "arm": 0.9, "leg": 0.9 },
      "magSize": 30, "reserve": 120, "reloadTime": 2.0, "switchTime": 0.35,
      "hipSpread": 0.035, "adsSpread": 0.008, "moveSpread": 0.03,
      "bloomPerShot": 0.006, "bloomMax": 0.03, "bloomRecover": 0.15,
      "recoil": { "pitch": 0.012, "yaw": 0.004, "recover": 0.25 },
      "adsFov": 55, "adsTime": 0.18, "scope": "none", "reloadStyle": "mag", "eject": "brass", "cycle": "none", "moveMul": 0.95
    },
    "deviler": {
      "name": "Deviler", "class": "Shotgun", "slot": 0, "kind": "hitscan",
      "desc": "Pump-action pellet spray. Devastating up close.",
      "fireMode": "semi", "fireInterval": 0.85, "burstCount": 0, "burstDelay": 0,
      "damage": 13, "minDamage": 3, "falloffStart": 5, "falloffEnd": 16, "range": 30, "headMul": 1.3, "pellets": 9,
      "zones": { "head": 1.3, "body": 0.9, "arm": 0.9, "leg": 0.9 },
      "magSize": 5, "reserve": 25, "reloadTime": 2.6, "switchTime": 0.35,
      "hipSpread": 0.095, "adsSpread": 0.07, "moveSpread": 0.0,
      "bloomPerShot": 0.0, "bloomMax": 0.0, "bloomRecover": 1.0,
      "recoil": { "pitch": 0.06, "yaw": 0.01, "recover": 0.3 },
      "adsFov": 65, "adsTime": 0.2, "scope": "none", "reloadStyle": "shells", "eject": "shell", "cycle": "pump", "moveMul": 1.0
    },
    "poacher": {
      "name": "Poacher", "class": "SMG", "slot": 0, "kind": "hitscan",
      "desc": "Fast-firing, fast-moving close-range hose.",
      "fireMode": "auto", "fireInterval": 0.0667, "burstCount": 0, "burstDelay": 0,
      "damage": 19, "minDamage": 11, "falloffStart": 12, "falloffEnd": 35, "range": 80, "headMul": 1.8, "pellets": 1,
      "zones": { "head": 1.8, "body": 1.05, "arm": 1.0, "leg": 1.0 },
      "magSize": 35, "reserve": 175, "reloadTime": 1.7, "switchTime": 0.3,
      "hipSpread": 0.045, "adsSpread": 0.025, "moveSpread": 0.015,
      "bloomPerShot": 0.004, "bloomMax": 0.03, "bloomRecover": 0.2,
      "recoil": { "pitch": 0.008, "yaw": 0.006, "recover": 0.3 },
      "adsFov": 62, "adsTime": 0.15, "scope": "none", "reloadStyle": "mag", "eject": "brass", "cycle": "none", "moveMul": 1.08
    },
    "piercer": {
      "name": "Shell Piercer", "class": "Sniper", "slot": 0, "kind": "hitscan",
      "desc": "Bolt-action long gun. Headshots crack any egg, even a hard-boiled one.",
      "fireMode": "semi", "fireInterval": 1.33, "burstCount": 0, "burstDelay": 0,
      "damage": 72, "minDamage": 72, "falloffStart": 200, "falloffEnd": 200, "range": 200, "headMul": 2.15, "pellets": 1,
      "zones": { "head": 2.15, "body": 1.3, "arm": 0.95, "leg": 0.95 },
      "magSize": 4, "reserve": 20, "reloadTime": 3.0, "switchTime": 0.45,
      "hipSpread": 0.12, "adsSpread": 0.0, "moveSpread": 0.08,
      "bloomPerShot": 0.0, "bloomMax": 0.0, "bloomRecover": 1.0,
      "recoil": { "pitch": 0.08, "yaw": 0.0, "recover": 0.2 },
      "adsFov": 20, "adsTime": 0.28, "scope": "sniper", "reloadStyle": "clip", "eject": "brass", "cycle": "bolt", "moveMul": 0.88
    },
    "frittata": {
      "name": "Frittata-3", "class": "Burst Rifle", "slot": 0, "kind": "hitscan",
      "desc": "Three-round burst. Rewards precise follow-ups.",
      "fireMode": "burst", "fireInterval": 0.07, "burstCount": 3, "burstDelay": 0.31,
      "damage": 28, "minDamage": 19, "falloffStart": 30, "falloffEnd": 70, "range": 140, "headMul": 2.0, "pellets": 1,
      "zones": { "head": 2.0, "body": 1.0, "arm": 0.9, "leg": 0.9 },
      "magSize": 24, "reserve": 96, "reloadTime": 2.1, "switchTime": 0.35,
      "hipSpread": 0.03, "adsSpread": 0.005, "moveSpread": 0.025,
      "bloomPerShot": 0.003, "bloomMax": 0.012, "bloomRecover": 0.1,
      "recoil": { "pitch": 0.01, "yaw": 0.003, "recover": 0.3 },
      "adsFov": 48, "adsTime": 0.18, "scope": "none", "reloadStyle": "mag", "eject": "brass", "cycle": "none", "moveMul": 0.95
    },
    "overeasy": {
      "name": "Over Easy", "class": "Marksman", "slot": 0, "kind": "hitscan",
      "desc": "Semi-auto marksman rifle. Two headshots and they're scrambled.",
      "fireMode": "semi", "fireInterval": 0.24, "burstCount": 0, "burstDelay": 0,
      "damage": 34, "minDamage": 27, "falloffStart": 45, "falloffEnd": 100, "range": 160, "headMul": 2.0, "pellets": 1,
      "zones": { "head": 2.0, "body": 1.05, "arm": 0.95, "leg": 0.95 },
      "magSize": 12, "reserve": 60, "reloadTime": 2.2, "switchTime": 0.4,
      "hipSpread": 0.05, "adsSpread": 0.002, "moveSpread": 0.03,
      "bloomPerShot": 0.01, "bloomMax": 0.03, "bloomRecover": 0.12,
      "recoil": { "pitch": 0.03, "yaw": 0.004, "recover": 0.25 },
      "adsFov": 35, "adsTime": 0.24, "scope": "marksman", "reloadStyle": "mag", "eject": "brass", "cycle": "none", "moveMul": 0.95
    },
    "souffle": {
      "name": "Souffle Launcher", "class": "Launcher", "slot": 0, "kind": "projectile",
      "desc": "Fires a straight-flying souffle rocket that bursts on impact.",
      "fireMode": "semi", "fireInterval": 1.0, "burstCount": 0, "burstDelay": 0,
      "damage": 130, "minDamage": 0, "falloffStart": 0, "falloffEnd": 0, "range": 0, "headMul": 1.0, "pellets": 1,
      "magSize": 1, "reserve": 6, "reloadTime": 2.0, "switchTime": 0.45,
      "hipSpread": 0.02, "adsSpread": 0.0, "moveSpread": 0.01,
      "bloomPerShot": 0.0, "bloomMax": 0.0, "bloomRecover": 1.0,
      "recoil": { "pitch": 0.05, "yaw": 0.0, "recover": 0.2 },
      "adsFov": 40, "adsTime": 0.26, "scope": "rocket", "reloadStyle": "rocket", "eject": "none", "cycle": "none", "moveMul": 0.85,
      "projectile": { "kind": 1, "speed": 36, "gravity": 0, "radius": 0.18, "life": 3.0, "splashRadius": 4.0, "knockback": 9, "fuse": 0, "bounce": 0, "friction": 0 }
    },
    "coddler": {
      "name": "Coddler", "class": "Pistol", "slot": 1, "kind": "hitscan",
      "desc": "Shared sidearm with endless spare mags.",
      "fireMode": "semi", "fireInterval": 0.16, "burstCount": 0, "burstDelay": 0,
      "damage": 22, "minDamage": 14, "falloffStart": 15, "falloffEnd": 40, "range": 100, "headMul": 1.8, "pellets": 1,
      "zones": { "head": 1.8, "body": 1.0, "arm": 1.0, "leg": 1.0 },
      "magSize": 10, "reserve": -1, "reloadTime": 1.4, "switchTime": 0.25,
      "hipSpread": 0.03, "adsSpread": 0.01, "moveSpread": 0.015,
      "bloomPerShot": 0.008, "bloomMax": 0.03, "bloomRecover": 0.15,
      "recoil": { "pitch": 0.02, "yaw": 0.004, "recover": 0.3 },
      "adsFov": 60, "adsTime": 0.14, "scope": "none", "reloadStyle": "pistol", "eject": "brass", "cycle": "none", "moveMul": 1.05
    },
    "quiche": {
      "name": "Quiche Bomb", "class": "Grenade", "kind": "grenade",
      "desc": "Bouncy timed explosive. Cook up some chaos.",
      "damage": 120, "startCount": 2, "maxCount": 3, "cooldown": 0.8,
      "throwSpeed": 16, "throwUp": 3, "inheritVel": 0.5,
      "projectile": { "kind": 0, "speed": 16, "gravity": 24, "radius": 0.15, "life": 1.8, "splashRadius": 5.0, "knockback": 10, "fuse": 1.8, "bounce": 0.4, "friction": 0.7 }
    },
    "rollingpin": {
      "name": "Rolling Pin", "class": "Melee", "kind": "melee", "swing": "sweep",
      "desc": "Bonk. Quick sideways swing, solid reach.",
      "damage": 50, "headMul": 1.2, "range": 2.0, "inflate": 0.3, "cooldown": 0.65, "windup": 0.1, "knockback": 3
    },
    "pan": {
      "name": "Frying Pan", "class": "Melee", "kind": "melee", "swing": "overhead",
      "desc": "Heavy cast-iron overhead CLANG. Slow, huge head bonk, big shove.",
      "damage": 60, "headMul": 1.5, "range": 1.9, "inflate": 0.35, "cooldown": 0.95, "windup": 0.18, "knockback": 6
    },
    "whisk": {
      "name": "Whisk", "class": "Melee", "kind": "melee", "swing": "jab",
      "desc": "Lightning-fast jabs. Low damage, tiny windup.",
      "damage": 34, "headMul": 1.25, "range": 1.7, "inflate": 0.25, "cooldown": 0.4, "windup": 0.05, "knockback": 0
    },
    "spatula": {
      "name": "Spatula", "class": "Melee", "kind": "melee", "swing": "uppercut",
      "desc": "Wide scooping flip that launches eggs into the air.",
      "damage": 40, "headMul": 1.1, "range": 2.2, "inflate": 0.45, "cooldown": 0.6, "windup": 0.08, "knockback": 9
    }
  }
}
```

Data validation (Go `data.go` and the JS loaders): every id in `melees` exists with kind `melee`, `0 <= windup < cooldown`, every hitscan gun has `zones` with 4 positive numbers,
`defaultMelee` is in `melees`.

**Resulting kill table (100 HP, no shield, inside falloffStart).** Put this in PROTOCOL.md 9 and README.

| Weapon | body / head / arm-leg damage per hit | shots to kill body / head / limbs |
|---|---|---|
| Benedict AR | 25 / 50 / 23 | 4 / 2 / 5 |
| Frittata-3 | 28 / 56 / 25 | 4 / 2 / 4 |
| Poacher SMG | 20 / 34 / 19 | 5 / 3 / 6 |
| Over Easy DMR | 36 / 68 / 32 | 3 / 2 / 4 |
| Shell Piercer | 94 / 155 / 68 | 2 / 1 (also through a full 50 shield) / 2 |
| Deviler (all 9 pellets) | 105 / 152 / 105 | 1 point-blank |
| Coddler | 22 / 40 / 22 | 5 / 3 / 5 |
| Rolling Pin / Pan / Whisk / Spatula | 50/60, 60/90, 34/43, 40/44 (body/head) | 2, 2 (1 head + 1), 3, 3 |

### 3.3 Melee loadout and windup (sim)

* `defsFor(weaponsJson, primaryId, meleeId)`: `melee = W[meleeId]` if it is in `weaponsJson.melees`, else `W[weaponsJson.defaultMelee || weaponsJson.melee]`.
* Weapon state gains `mw: 0`. Wire array index 14. `weaponStateFromArray` reads `a[14] ?? 0`.
* `weaponTick` changes (in this order; everything else is unchanged):
  ```js
  ws.cd -= dt; ws.mt = Math.max(0, ws.mt - dt); ws.gt = Math.max(0, ws.gt - dt);
  if (ws.mw > 0) { ws.mw -= dt; if (ws.mw <= 1e-9) { ws.mw = 0; out.push({ a: "meleeHit" }); } }
  // ... switching, bloom, reload progress, manual reload (unchanged) ...
  if ((pressed & BTN.MELEE) && ws.mt === 0 && ws.sw === 0) {
    ws.mt = defs.melee.cooldown; ws.mw = defs.melee.windup || 0; ws.rl = 0; ws.bl = 0; out.push({ a: "melee" });
    if (ws.mw <= 1e-9) { ws.mw = 0; out.push({ a: "meleeHit" }); }
  }
  ```
  Fire is still blocked while `mt > 0`. Go: `ActMeleeHit` with action name `"meleeHit"` in the vectors.
* Server and localserver: on `melee`, end spawn protection and broadcast `{"t":"melee","id":..,"w":meleeId}` (except to the attacker).
  On `meleeHit`, resolve the hit with **this input's** yaw, pitch, rt and post-movement eye (the same algorithm as v1: the world blocks, the nearest rewound egg
  with `inflate`, `range`). Then apply the zone damage. Then, if the victim is still alive and `knockback > 0`, apply knockback:
  `k = normalize(victimPos.xz - attackerPos.xz)` (if the length is below 1e-6, use the horizontal aim direction), `v.x += k.x*K; v.z += k.z*K; v.y += K*meleeKnockUp; onGround = false; coy = 0`.
  Spawn-protected victims take no damage and no knockback. The kill-feed weapon id is the melee id.
* Bots (Go `bots.go` and localserver): pick a random melee from `melees` at join, the same way they pick a primary. The rest of the melee behaviour is unchanged.

### 3.4 Loadout protocol (both servers)

* `hello.mel`, `ld.mel` (next spawn, `pu` broadcast; an `ld` that holds only `mel` is valid), ROSTER `mel`, `spawn.mel`. Player fields `Mel` (next) and `CurMel` (this life),
  so `Defs` are rebuilt at spawn with `DefsFor(w, cls, mel)`.
* `scripts/bots.mjs` protocol checks: hello with `mel:"pan"` gives a roster `mel` of `"pan"`. `ld {mel:"whisk"}` gives a `pu` with `mel` of `"whisk"`. After death, the next `spawn` has `mel` of `"whisk"`. `mel:"bogus"` gives `rollingpin`.
* UI (A): `store.js` profile gets `mel` (default `""`, normalised in `app.js` to `defaultMelee` like `cls`). `app.js` passes `mel` to `startGame({..., mel})`
  and to `setLoadout({cls, mel, cosmetics})`. `loadout.js` adds a **"Melee (pick one)"** picker under the primary picker (same widget). Each entry shows the name, `damage` and the swing speed
  (`cooldown`). It replaces the fixed rolling-pin line in the kit list with the chosen melee. `home.js` shows the chosen melee next to the primary chip.
  `icons.js`: `meleeIcon(id)` draws 4 distinct small SVGs (pin, pan, whisk, spatula); the old `meleeIcon()` with no argument draws the pin.
  `data.js` and the loadout stats use `damage * zones.body` for the damage bar and show `"<head>x head · <arm>x limbs"` in the extras.
  `preview3d` `set(cos, cls, mel)`: A passes the 3rd argument; B's preview handles it.
* `CLIENT_API.md`: `startGame` opt `mel`. `setLoadout({cls, mel, cosmetics, hold})`. `onHitConfirm`/`onDamaged` gain `zone`. `onKillfeed` gains `zone`.
  `hudState()` gains `melee: {id, name, ready}`. C implements these. A documents them.

### 3.5 Movement (sim): smoother feel, exact

```js
// stepMove, ground branch:
if (st.onGround) {
  const k = Math.min(1, (len > 0 ? C.groundAccel : C.groundDecel) * dt);
  st.vx += (wx * speed - st.vx) * k;
  st.vz += (wz * speed - st.vz) * k;
} else if (len > 0) { /* air branch unchanged, uses airAccel 3.5 */ }
// jump (replaces the old onGround-only test):
if ((keys & KEY.JUMP) && (st.onGround || st.coy > 0)) { st.vy = C.jumpVelocity; st.onGround = false; st.coy = 0; }
// ... everything else unchanged ...
// very last line of stepMove:
st.coy = st.onGround ? C.coyoteTicks : (st.coy > 0 ? st.coy - 1 : 0);
```
`newPlayerState` gains `coy: 0`. Knockback anywhere (explosions, melee) sets `coy = 0` together with `onGround = false`. Snapshot `me.cy = coy`.
Movement vector state arrays become `[x,y,z,vx,vy,vz,onGround,coy]`. Add vector cases `coyote_jump_after_ledge` (walk off a ledge, press jump 3 ticks later: it jumps)
and `coyote_expired` (jump 8 ticks later: it does not). Regenerate `make vectors` and `physics_vectors.json` (gen-physics-vectors.mjs). The Go port must pass with 1e-9 tolerance.

### 3.6 Rocket (sim data plus a check)

Gravity 0 makes the shell fly in a straight line. The code paths do not change (`stepProjectile` already uses `pr.gravity`). Add a Go test and a localserver node check: a shell fired level from (0,5,0)
toward -Z keeps `|y - y0| < 1e-9` every tick until impact or life end. Bots' lead logic is unchanged (no drop compensation exists).

### 3.7 Tests A must add or update

* `math.json`: a `hitZone` block with at least 16 cases (each zone, both sides, a vertical ray `dx=dz=0` gives BODY, the boundaries `ly == legY` and `lat == armLat` are inclusive as coded).
* `weapons.json` vectors: `pan_windup_then_hit` (melee press, `meleeHit` exactly when the windup elapses), `whisk_spam_cooldown`, `melee_cancels_reload_with_windup`.
* Go tests: per-zone damage for each gun (the table in 3.2), shotgun 9-pellet point-blank kill, sniper head through a 50 shield, melee hit delayed by the windup ticks, knockback velocity,
  `hit.z` and `kill.z` on the wire, `ld.mel` at next spawn, unknown `mel` uses the default, straight rocket.
* The localserver smoke test in `make test-js` covers `mel` and zone `z` on `hit`.
* `make test`, `make bots` and `make e2e` all pass. The e2e loadout screenshot shows the melee picker.

---

## 4. Builder B: art

### 4.1 Module layout (all new, `web/js/game/art/`)

| file | content |
|---|---|
| `index.js` | re-exports the public API in 2.4 (C imports only this) |
| `toon.js` | `toonMaterial`, the gradient ramp, the rim patch, the outline material and `addOutline`, `setOutlineQuality`, palette constants |
| `geom.js` | `roundedBox(w,h,d,r,seg)`, `bevelCyl(rt,rb,h,seg,bevel)`, `tube`, a lathe helper, `mergeStatic(group)` (merge static meshes by material into vertex-coloured meshes), `smoothNormalsFor(geo)` (cached averaged normals for outlines), `modelStats` |
| `guns.js` | `buildGun` for all 8 guns, both LODs |
| `hands.js` | `buildHand` (a skinned glove with 16 bones, rigid weights) and the pose table |
| `melee.js` | `buildMelee` (4 melees) |
| `throwables.js` | `buildGrenade`, `buildRocket`, `buildCasing` |
| `egg.js` | the egg shell profile, feet, face (eyes, brows), crack texture and shader patch: `applyCrack(material)`, `setCrack(material, stage, flash)` |
| `test/gallery.html` | a gallery page (import map as in dev.html): `?view=guns|hands|melee|eggs|throwables&lod=fp|tp`, a turntable, and `window.__stats` with tris and draw calls per model |
| `test/budget.test.mjs` | optional node test that does not need DOM (geometry-only budgets) |

**First deliverable (do this first, before polishing):** `index.js` with every export working, using simple placeholder geometry with **correct sockets and parts**.
C develops against it while you build the real models. Never break an export's signature after that.

### 4.2 Look

* **Materials:** `toonMaterial(color, {map, vertexColors, emissive, rim=0.35, rimColor="#fff3d6", skinning})` = `MeshToonMaterial` with a shared 3-step
  `gradientMap` (DataTexture with levels `[0.42, 0.72, 1.0]`, NearestFilter), plus a rim term injected with `onBeforeCompile`:
  `outgoingLight += rimColor * rim * pow(1.0 - saturate(dot(normal, normalize(vViewPosition * -1.0))), 3.0)`. Use one `customProgramCacheKey` per
  feature set (at most 3 program variants: plain, map, skinned). Cache materials by key. Never create one per instance, except the per-avatar shell material.
* **Outline:** an inverted hull. `MeshBasicMaterial({color:"#1e1622", side:BackSide})` patched to push vertices along a cached smoothed-normal attribute
  `outlineNormal` by `width` (FP gun and hands: `0.0045` gun units; egg shell: `0.012`; nothing else). It is skinning-aware for hands. One outline mesh per
  merged mesh. `setOutlineQuality("low")` hides all outlines. C calls it from the graphics quality setting.
* **Palette** (keep the identity colours of each weapon and accent them): Benedict `#3a3f46` with hollandaise orange `#f29e38`; Deviler paprika red `#b8432f`
  with wood `#c9a26b`; Poacher teal `#2f8f88` with cream `#efe8d6`; Piercer olive `#56683f` with black `#26262b`; Frittata egg-yellow `#f0bf3c` with charcoal `#33333a`;
  Over Easy egg-white `#f2f0ea` with yolk `#f7b52c`; Souffle magenta `#b05587` with gold `#ffd34d`; Coddler slate `#5b6270` with bone `#e2dccb`.
  Metal dark `#2a2c33`. Gloves white `#fbfaf6` with the cuff in the shell colour. Emissive accents (yolk dot sights, scope lens glint) only through `emissive`.
* **Proportions:** chunky, with rounded bevels on every box (radius about 15 % of the smallest side, 2 segments FP / 1 segment TP). Oversized mags, muzzles and sights.
  Visible screws or rivets on FP only (merged).

### 4.3 Guns (both LODs; sockets and parts as in 2.4; approximate lengths along -Z)

| id | length | design | parts |
|---|---|---|---|
| benedict | 0.78 | rounded AR receiver, curved "banana" mag, carry rail with a yolk red-dot sight (emissive dot `#ff9a1f` on a dark lens), 3-port muzzle brake, orange stripe | mag, bolt (charging handle, top-rear), trigger |
| frittata | 0.72 | flat, wide "omelette" futuristic bullpup-ish body, holographic sight (thin emissive ring), short straight mag | mag, bolt, trigger, sightGlass |
| poacher | 0.55 | compact SMG, vertical stick mag ahead of the grip, ring sight, folded wire stock, vertical foregrip (leftGrip) | mag, bolt (side cocking tube, chargeGrip front-left), trigger |
| overeasy | 0.86 | white marksman rifle with yolk accents, mid scope with a lens glint, box mag | mag, bolt, trigger |
| piercer | 1.05 | long olive bolt rifle, giant scope with front and rear lens caps, bolt knob with a big ball, muzzle can, folded bipod | bolt (lift + travel), clip (hidden stripper clip with 4 rounds), trigger |
| deviler | 0.85 | pump shotgun: fat barrel and a tube magazine below, grooved wooden pump (leftGrip on the pump), big brass bead, loadPort under the receiver | pump, shell (hidden red shell with a brass base), trigger |
| souffle | 0.95 | magenta launch tube over the shoulder, fluted "ramekin" muzzle rim, flared rear with hazard stripes, flip-up frame sight, front grip | rocket (warhead at the front, visible when loaded) |
| coddler | 0.24 | chunky cartoon pistol, 3-dot sights, oversized hammer, serrations | slide, mag, trigger |

The launcher loads **from the front** (the warhead stays visible in the muzzle when loaded): `loadPort` = tube front, `-Z` = outward, `travel.rocket.dist` = 0.28.
FP LOD caps: 3,000 tris, at most 5 draw calls before outlines (1 merged static mesh + each animated part, merged within the part).
TP LOD caps: 800 tris, at most 2 draw calls (static + mag; the other parts may be merged into static at TP because TP anims move only the mag and the hands).
TP must still expose `sockets.rightGrip, leftGrip, muzzle, magGrip` (magGrip may be on the static mesh at TP).

### 4.4 Hands

* FP glove: a cartoon 4-finger glove (3 fingers + thumb, like classic cartoon gloves), puffy, white, with a rolled cuff in the shell colour and a short tapered sleeve stub
  (0.12 long) so the cut looks deliberate (floating Rayman-style hands; eggs have no arms). Size: palm width 0.1 (about 1.2 times realistic), so it reads at FP scale.
  One `SkinnedMesh` with 16 bones: wrist, 3 fingers x 3 joints, a 4th "pinky-ring" finger x 3, thumb x 3. Rigid weights (1.0). Poses are joint-angle tables. `setPose(a,b,t)` slerps per bone.
  At most 1,200 tris per hand, 1 draw call plus 1 outline.
* TP glove: the same silhouette at 150 tris or fewer. Poses `grip/open/fist` are enough (other names map to the nearest of these). It may be non-skinned (3 baked variants swapped).
* Pose intent: `grip` = full wrap around the X bar; `trigger` = grip with the index finger along the trigger, curled 40 %; `pinch` = thumb and index/middle meeting at `points.pinch`
  (mag, shell, clip, bolt knob); `cup` = support-hand cup under a pistol; `palm` = flat push (mag slap, rocket push); `open`, `point`, `fist` as named.

### 4.5 Melee, throwables

* `rollingpin` (wood, two handles; grip on the right handle), `pan` (cast-iron skillet: black pan with a copper rim ring, a leather-wrapped handle and a hanging hole),
  `whisk` (8 wire loops, low-poly tube arcs merged, steel handle with a coloured grip), `spatula` (slotted flipper blade, red handle). FP ≤ 1,500 tris, TP ≤ 300 tris.
* `buildGrenade`: the Quiche Bomb as a pie: a scalloped crimped crust rim, a golden top with bubbly filling spots and a cartoon fuse wick. `parts.spark` is a small emissive tip that C flickers.
* `buildRocket`: a souffle warhead: a puffy golden dome that rises over a ramekin-fluted body, 4 cartoon fins, a nozzle. `parts.flame` is an additive cone hidden by default. Length 0.5.
* `buildCasing("brass"|"shell")`: a tiny geometry (≤ 60 tris) for C's instanced casing pool.

### 4.6 Egg avatar (TP)

* Shell: keep the lathe profile and collision proportions (height 1.5, radius 0.42). Use the shell texture with the toon material, an outline at quality ≥ medium, and the crack patch.
  At most 1,400 tris for the shell.
* Face: big cartoon eyes (white sclera disc on the shell + black pupil + glint) and eyebrows. Blink at a random interval of 2 to 5 s (0.12 s).
  Brows go angry within 1 s of firing and worried when hp is below 35 %. Merge the face into 1 draw call (the brows may be a second one if they animate).
* Feet: two stubby rounded shoes at the bottom front (inside y 0..0.12) that pat during walking (phase-locked to the existing walk value), squash on landing.
* Hands: TP gloves attached to the TP gun's `rightGrip` and `leftGrip` (both hands follow pitch and recoil). Melee: the right hand leaves the gun and swings the melee model
  (`buildMelee(mel,{lod:"tp"})`, visible only during the swing) with the swing type of `weapons[mel].swing`, 0.35 s. The gun dips during it.
  Reload: on the rising edge of flag 8, play a 4-key TP timeline over `reloadTime` (the left hand to the mag, the mag drops 0.12, the hand goes down, comes back and inserts; shotgun: 3 hand dips; launcher: a front load).
  Grenade (flag 512 or `throwNade()`): the left hand goes up and forward, 0.4 s. Switch (flag 128): the gun dips and returns.
* Cracks: one shared crack texture (512x256 canvas, generated once): R = stage-1 lines, G = stage-2 extra lines, B = stage-3 extra lines, A = a blurred stage-3 mask for the yolk glow.
  The shader patch on the shell material: `c = max(R*step(.5,s), max(G*step(1.5,s), B*step(2.5,s)))`, `diffuse = mix(diffuse, #3b2616, c*0.9)`.
  At stage 3 add emissive yolk `#ffb21a * A * 0.55 * (0.8+0.2*sin(t*6))`. Uniforms per avatar: `uCrack` (it eases to the target stage over 0.25 s),
  `uCrackFlash` (set to 1 when hp drops, decays over 0.25 s, brightens the lines), and `uCrackU` (a per-avatar u offset derived from the player id, so eggs differ).
  There is no extra draw call.
* Budget per avatar: at most 2,000 tris for the egg (shell + face + feet), plus the TP gun at 800 or less and the hands at 300 or less. At most 9 draw calls at high quality, at most 7 at low.

### 4.7 Other models and textures

Restyle `buildPickup`, `buildNest` and `buildGoldenEgg` with the toon materials (same APIs, merged). `textures.js`: keep every existing export and its behaviour (maps use it).
You may add `rampTexture(levels)` and `crackTexture()` there or in `art/toon.js`. `preview3d.js`: `set(cos, cls, mel)` shows the egg with hands and the gun; the 3rd argument is optional.

### 4.8 B's screenshots (`scripts/art-gallery.mjs`)

The script starts a tiny Node static server on its port (`/` maps to `web/`, `/data/` to `shared/data/`, `/ref/` to `shared/ref/`) and opens `gallery.html` in Playwright chromium
(`--use-gl=angle --use-angle=swiftshader`). It writes `scripts/screenshots/art/`:
`guns-fp-<id>.png` (3/4 view **with both FP hands attached via sockets**), `guns-tp.png` (lineup), `hands-poses.png` (all 8 poses, both sides),
`melee.png`, `throwables.png`, `eggs-cracks.png` (3 colours x 4 crack stages), `egg-holding-<id>.png` (TP egg with hands and the gun, 3/4 front).
It prints a budget table from `window.__stats` and exits non-zero if any cap in sections 4.3 to 4.6 is exceeded. Review every PNG with the Read tool and iterate until each looks polished.

---

## 5. Builder C: first person, effects, overlay, camera

### 5.1 Structure

`viewmodel.js` keeps `class ViewModel` with the methods game.js uses, extended as below. The animation code lives in new `web/js/game/vm/`:
`springs.js` (critically damped springs), `timelines.js` (data-driven keyframe tables per weapon and melee), `rig.js` (hands to sockets, IK-lite blending), `anims.js` (the state machine).

```js
class ViewModel {
  constructor(renderer, data)
  setWeapon(id, { draw = true })            // starts holster(old)/draw(new) when draw
  setMelee(id)
  setHandColor(css)
  fire({ strength, ads, lastRound })        // per-class kick + part motion + casing + cycle (bolt/pump) scheduling
  reloadStart({ empty, mag, magSize, reserve, reloadTime })   // n shells = min(magSize - mag, reserve)   // C's game.js calls it on the local "reload" action
  reloadCancel()
  meleeStart(id) ; meleeHit(hitKind /* 0 miss | 1 world | 2 egg */)
  throwNade()
  land(strength) ; look(dx, dy)
  update(dt, st)   // st: {speed, vx, vz, yaw, onGround, ads (0..1 target), adsTime, reloadFrac, switchFrac, scoped, bob, mag, alive}
  muzzleWorld(camera, out) ; ejectorWorld(camera, out, dirOut)
  setQuality(q)                              // forwards to art setOutlineQuality
}
```

### 5.2 Rig rules

* The gun and hands live under `gunRoot` (scale `0.55`, the existing VM scale) in `renderer.vmScene`. Build guns with `buildGun(id,{lod:"fp"})` and hands with `buildHand("L"/"R",{lod:"fp", color: shell colour})`, once each, cached.
* Each hand has a **target**: either `{socket: name}` (its world transform = the socket's world transform; the pose comes from the timeline or the socket's `userData.pose`)
  or `{free: {p:[x,y,z], r:[rx,ry,rz]}}` in gunRoot space (used off-screen or while carrying a mag, shell, clip or rocket).
  Switching targets **blends**: position lerp plus quaternion slerp over the key's duration, with easing. No hand may teleport. That is the whole "IK-lite".
* Held objects (a new mag, a shell, a clip, a rocket, the grenade, the melee) attach at `hand.points.pinch` or `hold`. The mag part is reparented to the hand when "out", and back to the gun at rest on insert.
  An "empty" mag drop detaches into a short-lived world-free fall (gravity 9, a spin, hidden after 0.5 s or off-screen).
* All temporaries are preallocated. No `new` in `update()`.

### 5.3 Pose layers (summed in this order on gunRoot)

1. **Base** = lerp(HIP `(0.2, -0.2, -0.5)`, ADS) by `adsBlend`. ADS position = `(0, 0, -0.11) - R_ads * (0.55 * sightLocal)`, where `sightLocal` = `sockets.sight`
   position in gun space, so the sight line sits exactly on the view axis. `adsBlend` follows a smoothstep over `adsTime` (it is not exponential).
2. **Idle breathing**: y `0.002*sin(1.6t)`, rotX `0.004*sin(1.1t)`, scaled by `(1 - 0.8*ads)`.
3. **Walk bob** (distance-driven, `phase += speed*dt*1.9`): x `0.012 sin(phase)`, y `-0.014 |cos(phase)|`, rotZ `0.015 sin(phase)`, times `min(1, speed/6) * (1 - 0.85*ads) * (bob ? 1 : 0.2)`.
4. **Look sway**: a rotational lag spring (k 120, damping 18, max 0.05 rad) driven by mouse delta, and a positional lag of 0.4 times that.
5. **Strafe tilt**: rotZ target `-0.06 * lateralVel/moveSpeed`, rate 8/s.
6. **Jump/land**: on jump, gun y `+0.02`, then a spring. On land, y dip `min(0.06, |fallVy|*0.003)` through a spring (k 160, c 18).
7. **Recoil** (critically damped springs, k 180): per class impulses (ADS multiplies them by 0.45):

| class | back z | rotX | rotZ random | part motion |
|---|---|---|---|---|
| AR / burst | 0.035 | 3 deg | ±0.6 deg | bolt back `travel.dist` in 0.02 s, forward in 0.05 s; brass from the ejector |
| SMG | 0.025 | 2 deg | ±0.8 deg | the same |
| DMR | 0.05 | 5 deg | ±0.5 deg | the same |
| Sniper | 0.09 | 9 deg | 0 | then the bolt cycle (5.4) |
| Shotgun | 0.10 | 12 deg | ±1 deg | then the pump cycle (5.4) |
| Launcher | 0.12 | 6 deg | 0 | `parts.rocket` hidden; backblast smoke from `tubeBack` |
| Pistol | 0.04 | 8 deg (snap) | ±1 deg | slide back 0.03 s, forward 0.06 s; it stays back after the last round (`lastRound`) until the reload rack |

   The R-hand pose blends `trigger` to `grip` for 0.05 s on every shot (a trigger pull).
8. **Action layer** (reload / cycle / melee / grenade / switch timelines). It owns the hand targets and the part offsets while active.

### 5.4 Timelines (normalised to the sim duration; the real duration comes from data)

Times are fractions of `reloadTime`, unless the row says otherwise. "L" and "R" are hands. "Cant" = rotZ of the gun. Every return ends with a `back` ease (overshoot ≤ 6 %).
"Empty" = mag 0 when the reload started. Sounds are emitted at the marked times (5.8).

**benedict / frittata / overeasy (style "mag")**
| t | action |
|---|---|
| 0.00-0.10 | cant +25 deg (overeasy +30), pitch +8 deg, move (+0.03, -0.02) |
| 0.10-0.22 | L leftGrip to magGrip (pinch) |
| 0.22-0.30 | mag out along `travel.mag` (dist 0.16) with L. `mag_out`. Empty: the mag detaches and drops; L continues empty |
| 0.30-0.50 | L down off-screen to gunRoot `(−0.15, −0.45, 0.1)`. The new mag appears in L at 0.42 |
| 0.50-0.62 | L brings the mag to `magWell − travel.mag*0.10` |
| 0.62-0.68 | insert to rest, gun bump y +0.015, rotX −3 deg. `mag_in` |
| 0.68-0.71 | L palm slap on the mag bottom (`palm`) |
| 0.71-0.85 | empty: L to chargeGrip, pull `bolt` back over 0.05 and snap forward. `bolt` (frittata: L palm slaps the bolt release, bolt snaps forward). Tactical: L to leftGrip |
| 0.85-1.00 | return to idle (empty: L chargeGrip to leftGrip during 0.85-0.92) |

**poacher (mag, SMG)**: the same beats with cant −20 deg (left), at 0.71-0.85 empty: L to chargeGrip (front-left tube), pull back, slap down ("HK slap").

**piercer (style "clip", 4 rounds)**
| t | action |
|---|---|
| 0.00-0.08 | cant −15 deg, raise 0.02. R rightGrip to chargeGrip (pinch) |
| 0.08-0.16 | bolt lift (`travel.bolt.lift`) |
| 0.16-0.24 | bolt back (`travel.bolt.dist`). Empty: a brass casing ejects at 0.22. `bolt` |
| 0.24-0.34 | L leftGrip to off-screen and back holding `parts.clip` |
| 0.34-0.46 | L aligns the clip over `loadPort` |
| 0.46-0.62 | L thumb pushes the rounds down in 2 pushes (0.50, 0.58). `shell_in` each |
| 0.62-0.70 | L flicks the empty clip away (it detaches and flies +X+Y, fading 0.3 s) |
| 0.70-0.80 | L back to leftGrip. R bolt forward 0.70-0.78, bolt down 0.78-0.84. `bolt` |
| 0.84-1.00 | R to rightGrip, return |

**Post-shot bolt cycle** (`cycle:"bolt"`, seconds after the shot, inside fireInterval 1.33): R to chargeGrip 0.18-0.30, lift 0.30-0.40, back 0.40-0.52 (brass at 0.48, `bolt`),
forward 0.52-0.64, down 0.64-0.72, R to rightGrip 0.72-0.86. A reload or switch cancels it. While scoped, show only a scope bounce (the gun is hidden).

**deviler (style "shells")**: `N = magSize − mag` at reload start (≥ 1).
| t | action |
|---|---|
| 0.00-0.10 | cant +35 deg (the loadPort turns toward the camera), raise 0.03 |
| 0.10-0.86 | N equal slots. Per slot (as a fraction of the slot): 0-0.35 L down off-screen and back with `parts.shell` (pinch); 0.35-0.75 push the shell into `loadPort` along its -Z (shell hidden at the end); `shell_in` at 0.7; gun bump. 0.75-1 L hovers by the port |
| 0.86-0.97 | empty: L to leftGrip (pump), pump back `travel.pump.dist` and forward. `pump`. Otherwise L to leftGrip |
| 0.97-1.00 | return |

**Post-shot pump** (`cycle:"pump"`, seconds after the shot): pump back 0.12-0.30 (a shell casing ejects at 0.25, `pump`), forward 0.30-0.45, gun rotX +4 deg during it.

**souffle (style "rocket", front load)**
| t | action |
|---|---|
| 0.00-0.14 | yaw the muzzle +35 deg toward the screen centre, pitch −10 deg, move left 0.05 |
| 0.14-0.30 | L leftGrip to off-screen |
| 0.30-0.48 | L returns holding a `buildRocket({lod:"fp"})`, tail first, aligned with `loadPort` −Z outward at distance `travel.rocket.dist` |
| 0.48-0.66 | slide in along the axis to rest. At the end, hide the hand rocket and show `parts.rocket` |
| 0.66-0.72 | L palm push/twist. `rocket_load` (clunk) |
| 0.72-0.86 | L back to leftGrip |
| 0.86-1.00 | return |

**coddler (style "pistol")**
| t | action |
|---|---|
| 0.00-0.10 | cant +20 deg, raise 0.02 |
| 0.10-0.22 | R thumb release: the mag drops (always detaches) at 0.18. `mag_out` |
| 0.14-0.36 | L cup to off-screen |
| 0.36-0.56 | L returns with a mag to `magWell` |
| 0.56-0.64 | insert. `mag_in` |
| 0.66-0.78 | empty only: L overhand rack (L to chargeGrip, slide back and snap). `slide` |
| 0.78-1.00 | L to cup on leftGrip, return |

**Melee** (seconds, from the `melee` action; `w = windup`, `cd = cooldown` of the chosen melee). The gun and L lower and roll out (y −0.25, rotZ −0.4) during 0..0.08,
then return during the last 0.15 s of `cd`. R leaves rightGrip and holds the melee at `points.hold` from t = 0 (the melee becomes visible). The strike frame is exactly at `t = w`, which is when
`meleeHit` arrives from the local sim. Then play an impact reaction: `hitKind` 2 = a stop-jolt plus a `bonk`/`clang`, 1 = a bounce-back plus `thud`, 0 = a follow-through.

| swing | windup pose (0..w) | strike (w−0.03..w+0.06) | follow (..w+0.25) | recover (..cd) |
|---|---|---|---|---|
| sweep (rollingpin) | pull right (+0.25 x, yaw +40 deg) | sweep across to (−0.3 x, yaw −50 deg) | continue left 0.1 | ease back, melee hidden at cd−0.1 |
| overhead (pan) | lift (y +0.25, rotX +70 deg back) | smash down to centre (rotX −40 deg), camera shake 0.15 | settle low | raise and return |
| jab (whisk) | pull back z +0.1 | thrust z −0.35 with rotZ +90 deg | retract | rest |
| uppercut (spatula) | low (y −0.2, rotX −40 deg) | scoop up (y +0.15, rotX +60 deg) | the blade flips 30 deg | return |

**Grenade** (0.6 s total): L from the bottom-left already holds the quiche at 0.00-0.06 (spark flicker), cocks back 0.06-0.10, **release at 0.10**
(hide the held quiche; the projectile is the real one), follow-through to 0.30, L returns off-screen 0.30-0.45, and the gun dips 0.02 throughout. C SHOULD draw a locally predicted
quiche or rocket (`Sim.newProjectile` / `Sim.stepProjectile` from the same eye, dir and velocity as the server) and hide the matching snapshot projectile (`owner == myId`, same kind,
spawned within 300 ms) so your own throws and rockets appear at once. If you do not do this, at least keep the hand anim.

**Switch**: during the first 35 % of `switchTime`, the old gun lowers (y −0.3, rotX −45 deg) with the hands attached. Swap the models at 35 %. The new gun rises from below in the remaining 65 % with an overshoot.

### 5.5 Scopes (overlay.js)

The scope type is `w.scope` (fallback: `"sniper"` when `adsFov <= 36`, else `"none"`). The scope is active when `adsBlend > 0.9`. It fades in over 0.08 s with a brief black iris. The gun is hidden while it is active.
The lens circle radius is `0.46*min(W,H)`, with full black outside, a 2 px dark-grey bezel ring and an edge-darkening gradient.

* **sniper**: thin full crosshair, thick posts from 70 % of the radius outward, mil-dot hash marks every `0.1 r` on both axes, a 2 px red centre dot, a faint blue-green lens tint `rgba(120,200,190,0.05)`.
* **marksman**: amber chevron `^` at the centre, with 3 short horizontal holdover ticks below and a thin horizontal line.
* **rocket** (the launcher's own reticle): warm amber tint `rgba(255,170,60,0.06)`. A centre hollow circle (radius `0.016 H`) with 4 corner brackets. Horizontal and vertical hairlines with a central gap.
  Below the centre is an **egg-stadia rangefinder**: hollow egg outlines whose width equals an egg (0.84 u) at **15, 30 and 60 u** for the current FOV
  (`px = (0.84/d) / tan(fov/2) * H/2`), stacked down the vertical line with labels `15`, `30`, `60`. The bezel has an orange/black hazard dash ring. The bottom shows `LOADED` (green dot) or `RELOADING` (red).
  Top text: `SOUFFLE`. No drop marks (the rocket flies straight).

### 5.6 Overlay: hit markers, cracks

* `hitMarker(zone, kill)`: zone 1 is a gold X at 1.3x size with a tiny shell-crack glyph; 2 is white; 3 and 4 are light grey at 0.7x; a kill is red at 1.5x. Use `z` from `hit` (fallback `hs ? 1 : 2`).
  Sounds: `headshot`, `hit`, `hit_limb`.
* **Screen cracks** (the local player): stage from `hp/maxHp` as in `EggAvatar.crackStage` (shield ignored). Pre-render 3 stage layers to offscreen canvases on resize
  (seeded RNG, jagged branching polylines from the screen corners: stage 1 is the bottom-left corner, stage 2 adds the top-right, stage 3 adds the bottom-right plus an amber yolk edge tint that pulses at 1.2 Hz).
  Each line is a dark line `rgba(40,25,15,0.75)` plus a 1 px offset highlight `rgba(255,255,255,0.55)`. Layers fade in and out over 0.3 s (regen heals them). On every damage taken, flash a short
  crack burst at the screen edge in the damage direction (it fades over 0.6 s). Reduce the existing low-hp red vignette by 50 % while stage ≥ 2, so they do not double up. Setting `shellCracks` (default on) is in `settings.js`.
* The HUD (`hud.js`): the HP egg icon gets the class `crack-1|2|3`, with CSS crack lines (a small inline SVG background). The melee chip shows the chosen melee name and a cooldown fill.

### 5.7 Effects (effects.js)

* **Tracer fix (MUST, see section 6):** the tracer box spans **tail to head**. `tail = max(0, head − len)`, `head = min(L, t*speed)`. Compose the instance at the **tail** point with scale z = `head − tail`
  (the geometry spans local z ∈ [−1, 0], and rotation maps −Z to the direction). Export the pure helper `tracerSegment(tr, outStartEnd)`. Both local and remote shots, every pellet:
  * Pull the end point back by 0.02 along the direction (q2 endpoints from the server can sit up to 0.009 inside a wall).
  * Start clipping: let `E` be the eye (local: `P.eye()`, remote: `shot.o`) and `M` the muzzle. If `raycastWorld(E → M)` hits (the muzzle pokes through a wall), or `dot(M − E, d) >= tHit − 0.3`, start at `E + d*0.5` instead.
    For the local player, if `tHit < 1.5`, draw no tracer (impact effects only).
* Impacts: sparks and chips spawn at `hit + n*0.02` with a velocity hemisphere around the face normal `n` from `raycastWorldN` (`-d` if the origin is inside). Nothing may spawn or travel behind the surface on the first frame.
* New pools: brass and shell casings (InstancedMesh from `buildCasing`, ≤ 40 live, life 1.2 s, ejected from the ejector socket mapped to world, one floor bounce via a single downward raycast at spawn),
  cartoon star muzzle flashes (an instanced star texture quad, size per class), a rocket trail (`parts.flame` visible plus smoke puffs every 0.03 s), and a toon explosion (a stepped-colour fireball plus a ring plus debris).
* The rocket projectile (kind 1) uses `buildRocket({lod:"tp"}).group`, oriented along the interpolated velocity (`setFromUnitVectors((0,0,−1), v̂)`), with no random spin. Grenades spin as before.

### 5.8 Audio (audio.js, procedural)

Add: `shoot_pan` (metal clang whoosh), `shoot_whisk` (light whoosh), `shoot_spatula` (flat whoosh), `melee_hit_<id>` (bonk / CLANG / tick / slap), `mag_out`, `mag_in`, `bolt`, `pump`,
`shell_in`, `slide`, `rocket_load`, `hit_limb`. Keep every existing name.

### 5.9 Camera smoothing and render interpolation (game.js)

* Keep the predicted-position interpolation `P.lerpPos(alpha)` and the reconciliation offset decay (it is `exp(-dt/0.05)` today; use `exp(-dt/0.06)`).
* **Step smoothing (new):** after each tick, if the player was grounded before and after and `dy = ps.y − prev.y` satisfies `0.05 < |dy| <= stepHeight + 0.01`, add `stepOff −= dy`.
  The camera y uses `+ stepOff`, and `stepOff *= exp(−dt/0.075)` per frame (clamped to ±0.6). There must be no 0.5 u jumps on stairs.
* Landing: camera dip spring `y −= min(0.12, |fallVy|*0.005)` (k 140, c 16) plus the view-model `land()`. Strafe roll: `roll = −0.012 * lateralVel/moveSpeed` (rate 8/s), only when viewBob is on.
* ADS FOV: lerp `cam.fov` with the same smoothstep `adsBlend` over `adsTime` (not the exponential `dt*14`).
* Remote avatars: pass `hp` from the snapshot (`p[6]`) to `av.setHealth(hp/maxHp, sh/maxShield)`. Stop faking the reload pose with `pitch − 0.7`. Call `av.melee(m.w)` on `melee`.
  Use the `mel` from the roster and spawn for `EggAvatar` and `setMelee`.
* Local predictor: `this.data.defs(spawnCls, spawnMel)`. Handle the `meleeHit` local action: a visual trace (`traceShot` with `range` and inflate is enough to choose `hitKind`), then `vm.meleeHit(kind)`.
* `hello.mel` from `opts.mel` (validated against `weapons.melees`). `setLoadout({mel})`.

### 5.10 Debug hooks for screenshots

`dev.html` accepts `?mel=pan&cls=deviler&bots=0&hp=40&debug=1`. When `debug=1`, set `window.__yo = { game, vm, overlay, effects, freeze(name, frac), setHp(hp), setAds(on), fire(), camAt(x,y,z,yaw,pitch) }`.
`freeze(name, frac)` poses the view model at the timeline `name` (`reload|cycle|melee|grenade|switch|idle|fire`) at fraction `frac` and stops time for the view model.

### 5.11 C's screenshots (`scripts/fp-shots.mjs`)

The script uses the same static-server approach as 4.8 and opens `dev.html?offline=1&bots=0&debug=1`. It writes `scripts/screenshots/fp/`:
`<id>-idle.png`, `<id>-ads.png`, `<id>-fire.png`, `<id>-reload-{15,35,55,75,92}.png` for all 8 guns, `<id>-cycle-40.png` (piercer, deviler),
`melee-<id>-{pre,strike,follow}.png` for the 4 melees, `grenade-release.png`, `switch-35.png`, `scope-sniper.png`, `scope-marksman.png`, `scope-rocket.png`,
`cracks-{90,60,40,15}.png`, `wall-front.png`, `wall-back.png` (section 7, item 7). Review every PNG with the Read tool and iterate until each looks good.

---

## 6. Root cause of the "white lines behind the wall" bug (verified)

`effects.js` builds the tracer box with `BoxGeometry(1,1,1).translate(0,0,-0.5)` (local z ∈ [−1, 0]) and rotates it with
`setFromUnitVectors((0,0,−1), dir)`, so local −Z maps to the **forward** direction. It then composes the instance at the **head** position with scale z = `head − tail`.
The box therefore spans **head to head + dir*(head − tail)**, which is *ahead* of the bullet. When the head reaches the impact point (`head = L`), the drawn streak covers
`[L, L + min(5, L/2)]`: up to 5 units **behind the wall**. The streak is additive white-yellow (`0xfff0b0` local, `0xffe08a` remote), which is exactly the "white lines on the other side of the wall".
Checked numerically: head at x=10 toward +X gives a box spanning x 10..15. The decals and endpoints are correct (`traceShot`, server `shot.e`). Only the streak placement is wrong.
It affects local and remote shots and every shotgun pellet equally.
Two secondary contributors that C also fixes (5.7): the muzzle can be past a wall when you hug it (the view-model muzzle is about 0.8 u ahead of the eye; a TP gun can be inside walls),
and q2-rounded remote endpoints can be slightly inside the surface.

---

## 7. Acceptance criteria per user item

| # | Item | Pass when | How it is tested |
|---|---|---|---|
| 1 | PUBG-like damage | Every value in the table in 3.2 holds on both servers. `hit.z` and `kill.z` are correct. Hit markers differ per zone. | A: Go tests plus math vectors plus a localserver smoke run. C: a `hitMarker` zone screenshot (`fp/hitmarkers.png`, 4 markers drawn by a debug call) |
| 2 | Cartoon models | Toon ramp, rim and outlines are visible. Silhouettes are chunky. Every model is within budget. | B: `art/*.png` reviewed, with the budget table passing. C: `fp/<id>-idle.png` |
| 3 | Cracks | TP eggs show 4 distinct stages with a yolk glow at stage 3. The FP screen shows corner cracks per stage and heals with regen. | B: `eggs-cracks.png`. C: `cracks-{90,60,40,15}.png` |
| 4 | Smooth movement | Vectors pass with the new constants and coyote time. The camera never jumps more than 0.12 u between frames on stairs at 60 fps. No reconciliation jitter in the debug `corr` while walking offline. | A: vectors and Go. C: fp-shots walks a staircase via `camAt` plus inputs, logs the per-frame camera y and asserts the max delta |
| 5 | Melee variety | 4 melees. The loadout lets you pick exactly one. It applies at the next spawn. Each has its own stats, windup, sound and FP/TP animation. | A: bots.mjs `mel` checks, the e2e loadout screenshot. C: `melee-*.png` |
| 6 | Hands | FP and TP gloves hold every gun by its sockets. Contact holds in idle, fire, ADS, reload, melee, grenade and switch (no floating gap over 0.01 gun units at any keyframe). | B: `guns-fp-*.png`, `egg-holding-*.png`. C: all `fp/*` frames plus a node test `web/js/game/test/rig.test.mjs` that runs every timeline at 50 samples and asserts the hand-to-socket distance ≤ 0.01 wherever a key says `{socket}` |
| 7 | Wall tracer bug | No tracer pixel ever appears beyond its impact point. | C: `web/js/game/test/tracer.test.mjs` (node, three imported directly: for random L and t, the transformed box's far end lies at ≤ L + 1e-6 along dir). fp-shots: stand 2 u from a wall, fire 10 rounds plus a shotgun shell, assert through `__yo.effects` that every live tracer's far point satisfies `dot(far − impact, dir) ≤ 0.02`, and save `wall-front.png` and `wall-back.png` (camera behind the wall facing it) with no streaks visible |
| 8 | Rocket straight plus scope | The shell's y stays constant on a level shot. ADS on the launcher shows the full-screen rocket reticle (5.5), with the gun hidden. | A: Go and localserver tests. C: `scope-rocket.png` vs `scope-sniper.png` look distinct |
| 9 | Reload animations | Every gun's reload follows its 5.4 timeline, synced to `reloadTime`, with parts moving and sounds at the beats. The empty and tactical variants differ for mag guns and the pistol. Shells are counted for the shotgun. | C: `<id>-reload-*.png` reviewed, plus the rig test |

Global: `make test`, `make bots` and `make e2e` pass with **no console errors**. The e2e screenshots look correct (review `scripts/screenshots/10-online-game.png` and `30-practice.png`).

---

## 8. Performance and payload budgets

* Target 60 fps or better on mid hardware. In a 12-player match at high quality: **≤ 260 draw calls and ≤ 150k triangles**, where the map is what it is today.
  At low quality, outlines are off and avatars use ≤ 7 draw calls each.
* FP (gun, hands, held item, outlines): ≤ 16 draw calls, ≤ 9k tris. Each TP avatar: ≤ 9 draw calls, ≤ 3.2k tris. Effects: ≤ 14 draw calls (instanced pools), with a fixed pool size and no growth.
* Shader programs: ≤ 6 new variants in total (toon plain, map, skinned; outline plain, skinned; crack shell). Warm them at map load (`renderer.compile`) so the first shot does not hitch.
* No per-frame allocations in `vm/*`, the avatar `update`, effects `update` or overlay `draw` (the crack layers are pre-rendered).
* Geometry and materials are shared through caches. Everything per instance is disposed in `dispose()`/`stop()`. `renderer.info.memory.geometries` must return to its baseline after 3 match starts in a row (C checks this in the debug panel or fp-shots).
* Payload: the new `art/` plus `vm/` code ≤ 70 KB gzipped. No new binary assets (everything is procedural). The total client payload stays under the README's figure plus 80 KB.

---

## 9. Ports, processes, integration order

* Port ranges, unless your task gives others: **A 18500-18519, B 18520-18539, C 18540-18559**. Kill every server and browser you start.
* No git commits.
* Each side runs on its own:
  * B's first deliverable is the API-complete `art/index.js` with placeholders. C codes against section 2.4 and must not fork it.
  * C reads every new data or wire field **with fallbacks** (`w.zones`, `w.scope`, `w.adsTime ?? 0.2`, `m.z ?? (m.hs ? 1 : 2)`, `roster.mel ?? weapons.defaultMelee ?? weapons.melee`, `ws.mw ?? 0`),
    so it works before and after A lands.
  * A keeps every old field (`headMul`, `melee`, 14-element `ws` readers tolerate 15).
* Whatever you change outside your files' scope goes in your return value as a precise request (file, function, change).
