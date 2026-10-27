// Seven original large arenas built for long-range duels. All geometry is
// box-based so the shared client and server use exactly the same collisions.
import { MapBuilder } from "./lib.mjs";

const ALL = ["ffa", "teams", "nest"];
const yawToward = (x, z, tx, tz) => Math.atan2(x - tx, z - tz);

function arena({ id, name, desc, hx, hz, palette, materials, floor, edge }) {
  const m = new MapBuilder({
    id, name, desc, modes: ALL,
    bounds: { min: [-hx, -12, -hz], max: [hx, 32, hz] },
    killY: -12, palette, materials,
  });
  m.box(-hx, -1, -hz, hx, 0, hz, floor);
  // Full floor coverage, with solid perimeter rails to make the playable
  // footprint and its exits unambiguous from ground level.
  m.box(-hx, 0, -hz, hx, 3, -hz + 0.6, edge);
  m.box(-hx, 0, hz - 0.6, hx, 3, hz, edge);
  m.box(-hx, 0, -hz + 0.6, -hx + 0.6, 3, hz - 0.6, edge);
  m.box(hx - 0.6, 0, -hz + 0.6, hx, 3, hz - 0.6, edge);
  return m;
}

// Called from sym2. Opposing spawn pockets face an offset gate: the center
// opening is walkable, yet no direct ray through it reaches a home spawn.
function homeHalf(m, hz, wall, trim) {
  const gateZ = -hz + 14;
  m.box(-29, 0, gateZ, -6, 3, gateZ + 1.5, wall);
  m.box(6, 0, gateZ, 29, 3, gateZ + 1.5, wall);
  m.box(-8, 0, gateZ - 4.2, 8, 3.5, gateZ - 2.8, wall);
  // Material bands and buttresses break up the protective barrier's facade.
  for (const x of [-25, -18, -11, 11, 18, 25]) {
    m.box(x - 0.45, 0, gateZ - 0.35, x + 0.45, 3.35, gateZ + 1.85, trim);
  }
  m.box(-29, 2.85, gateZ - 0.2, -6, 3.3, gateZ + 1.7, trim);
  m.box(6, 2.85, gateZ - 0.2, 29, 3.3, gateZ + 1.7, trim);
  m.nest(1, 0, 0, -hz + 6);
  for (const [x, z] of [[-26, 5], [-22, 6], [-18, 5], [18, 5], [22, 6], [26, 5]]) {
    // Each start sees a diagonal route through the broad center gate. The
    // near baffle stays between a direct base-to-base ray and either spawn.
    const spawnZ = -hz + z;
    m.spawn(x, 0, spawnZ, yawToward(x, spawnZ, x < 0 ? -5 : 5, gateZ), 1);
  }
}

function freeSpawns(m, hx, hz) {
  // Side entries look along a flank into the arena, rather than out at the
  // perimeter wall or straight into the nearest terrace.
  for (const x of [-hx + 5, hx - 5]) {
    for (const z of [-hz + 9, 0, hz - 9]) {
      const tx = z === 0 ? x + (x < 0 ? 2 : -2) : x < 0 ? -hx + 19 : hx - 19;
      const tz = z < 0 ? z + 17 : z > 0 ? z - 17 : x < 0 ? -25 : 25;
      m.spawn(x, 0, z, yawToward(x, z, tx, tz), 0);
    }
  }
}

function twinSupplies(m, x, z) {
  m.pickup("hp", -x, 0, -z);
  m.pickup("ammo", x, 0, -z);
  m.pickup("hp", x, 0, z);
  m.pickup("ammo", -x, 0, z);
}

// ---------------------------------------------------------------- Ridge Watch
export function ridgeWatch() {
  const m = arena({
    id: "ridge_watch", name: "Ridge Watch",
    desc: "Twin stone overlooks command a long saddle, while the lower trails cross beneath their sightlines.",
    hx: 48, hz: 46, floor: "dryGrass", edge: "slateRidge",
    palette: {
      sky: "#7294a5", skyHorizon: "#d4c2a4", fog: "#a6b4aa", fogNear: 70, fogFar: 165,
      ambient: "#e3e1ce", ambientIntensity: 0.66, hemiGround: "#746b52",
      sun: "#f8e8bf", sunIntensity: 1.15, sunDir: [-0.5, -1, 0.35],
    },
    materials: {
      dryGrass: { color: "#8a9a6a", rough: 1 },
      slateRidge: { color: "#657174", rough: 1 },
      paleStone: { color: "#b2aa91", rough: 1 },
      gravel: { color: "#9d947e", rough: 1 },
      signalMetal: { color: "#a98657", rough: 0.75 },
    },
  });
  // Two broad, reachable shelves frame the central saddle rather than
  // forming a single dominant perch.
  for (const [x0, x1] of [[-31, -17], [17, 31]]) {
    m.box(x0, 0, -14, x1, 3, 14, "slateRidge");
    m.stairs("+z", -20, x0 + 3, x1 - 3, 12, "paleStone", { rise: 0.25, run: 0.5 });
    m.stairs("-z", 20, x0 + 3, x1 - 3, 12, "paleStone", { rise: 0.25, run: 0.5 });
    for (const z of [-10, 0, 10]) {
      m.box(x0 + 1.2, 3, z - 1.8, x0 + 2.1, 4.1, z + 1.8, "paleStone");
      m.box(x1 - 2.1, 3, z - 1.8, x1 - 1.2, 4.1, z + 1.8, "paleStone");
    }
    m.box(x0 + 4, 3, -2, x1 - 4, 4.2, 2, "slateRidge");
  }
  // Narrow, offset rocks let a sniper read the whole saddle without owning it.
  for (const [x, z, w] of [[-9, -9, 3], [7, -5, 4], [-5, 4, 3], [10, 10, 3]]) {
    m.box(x - w / 2, 0, z - 1.3, x + w / 2, 1.8, z + 1.3, "paleStone");
    m.box(x - w / 2 + 0.3, 1.8, z - 0.9, x + w / 2 - 0.3, 2.25, z + 0.9, "slateRidge");
  }
  // Paired signal masts are visual landmarks, with cover at their bases.
  for (const x of [-24, 24]) {
    m.box(x - 0.4, 4.2, -0.4, x + 0.4, 10, 0.4, "signalMetal", { solid: false });
    m.box(x - 2.5, 9.4, -0.3, x + 2.5, 9.8, 0.3, "signalMetal", { solid: false });
  }
  m.box(-3.5, 0, -1.7, 3.5, 1.2, 1.7, "slateRidge");
  m.pickup("shield", 0, 0, 5);
  m.sym2(() => {
    homeHalf(m, 46, "slateRidge", "paleStone");
    m.box(-37, 0, -24, -34, 2.2, -21, "slateRidge");
    m.box(33, 0, -26, 37, 1.7, -23, "paleStone");
    m.box(-12, 0, -25, -8, 1.4, -22, "paleStone");
    m.box(8, 0, -23, 12, 1.4, -20, "slateRidge");
    m.box(-41, 0, -11, -38, 1.6, -7, "slateRidge");
    m.box(38, 0, -10, 41, 1.6, -6, "slateRidge");
  });
  twinSupplies(m, 35, 18);
  m.pickup("ammo", -24, 3, 7);
  m.pickup("ammo", 24, 3, -7);
  freeSpawns(m, 48, 46);
  return m.build();
}

// ------------------------------------------------------------- Quarry Lookout
export function quarryLookout() {
  const m = arena({
    id: "quarry_lookout", name: "Quarry Lookout",
    desc: "Working terraces overlook a broad cut; stone stacks and haul lanes offer routes through the open floor.",
    hx: 46, hz: 46, floor: "quarryDust", edge: "graniteWall",
    palette: {
      sky: "#b7bdc3", skyHorizon: "#e0d5c4", fog: "#c8c4b9", fogNear: 75, fogFar: 170,
      ambient: "#ecedea", ambientIntensity: 0.66, hemiGround: "#756e67",
      sun: "#ffedcd", sunIntensity: 1.2, sunDir: [0.6, -1, 0.2],
    },
    materials: {
      quarryDust: { color: "#aaa398", rough: 1 },
      graniteWall: { color: "#747773", rough: 1 },
      cutStone: { color: "#c5bba9", rough: 1 },
      oxidizedMetal: { color: "#98765b", rough: 0.8 },
      chalkMark: { color: "#ded5bd", rough: 1 },
    },
  });
  // Terraces deliberately stop short of both arena ends; the central floor
  // and two outside haul lanes remain connected without jumps.
  for (const [x0, x1] of [[-33, -22], [22, 33]]) {
    m.box(x0, 0, -18, x1, 2.5, 18, "graniteWall");
    m.stairs("+z", -23, x0 + 2, x1 - 2, 10, "cutStone", { rise: 0.25, run: 0.5 });
    m.stairs("-z", 23, x0 + 2, x1 - 2, 10, "cutStone", { rise: 0.25, run: 0.5 });
    for (const z of [-13, -4, 5, 14]) {
      m.box(x0 + 0.7, 2.5, z - 1.7, x0 + 1.4, 3.5, z + 1.7, "cutStone");
      m.box(x1 - 1.4, 2.5, z - 1.7, x1 - 0.7, 3.5, z + 1.7, "cutStone");
    }
  }
  // Different block sizes form a broken diagonal of cover across the cut.
  for (const [x, z, w, h] of [[-14, -11, 5, 2.1], [-5, -5, 3, 1.4], [7, -10, 4, 1.7],
                            [14, 5, 5, 2.2], [3, 8, 3, 1.3], [-11, 12, 4, 1.8]]) {
    m.box(x - w / 2, 0, z - 1.2, x + w / 2, h, z + 1.2, "cutStone");
    m.box(x - w / 2 + 0.2, h, z - 1.1, x + w / 2 - 0.2, h + 0.25, z + 1.1, "chalkMark", { solid: false });
  }
  // Cable cranes mark opposite overlooks without creating extra platforms.
  m.sym2(() => {
    homeHalf(m, 46, "graniteWall", "cutStone");
    m.box(-36, 0, -13, -35.2, 8.5, -12.2, "oxidizedMetal");
    m.box(-36, 8.2, -13, -23, 8.8, -12.2, "oxidizedMetal", { solid: false });
    m.box(-24.5, 4, -12.7, -24, 8.2, -12.4, "oxidizedMetal", { solid: false });
    m.box(35, 0, -27, 39, 1.7, -25, "cutStone");
    m.box(-14, 0, -27, -10, 1.5, -25, "graniteWall");
    m.box(8, 0, -23, 13, 1.6, -21, "cutStone");
  });
  m.pickup("shield", 0, 0, 1);
  twinSupplies(m, 38, 20);
  m.pickup("ammo", -27, 2.5, 0);
  m.pickup("ammo", 27, 2.5, 0);
  freeSpawns(m, 46, 46);
  return m.build();
}

// ------------------------------------------------------------- Desert Airfield
export function desertAirfield() {
  const m = arena({
    id: "desert_airfield", name: "Desert Airfield",
    desc: "A long exposed runway links two blast shelters; hangars and a raised control deck flank the strip.",
    hx: 50, hz: 42, floor: "desertSand", edge: "blastConcrete",
    palette: {
      sky: "#78b9cf", skyHorizon: "#f0d29d", fog: "#dfc69f", fogNear: 78, fogFar: 178,
      ambient: "#ffeacf", ambientIntensity: 0.65, hemiGround: "#b48354",
      sun: "#fff0c9", sunIntensity: 1.35, sunDir: [-0.6, -1, 0.1],
    },
    materials: {
      desertSand: { color: "#cbb084", rough: 1 },
      runwayAsphalt: { color: "#666969", rough: 1 },
      runwayPaint: { color: "#efe6cb", rough: 1 },
      blastConcrete: { color: "#a4a197", rough: 1 },
      hangarMetal: { color: "#8d9a9c", rough: 0.75 },
      fadedStripe: { color: "#cd8c5d", rough: 1 },
    },
  });
  m.box(-8, 0, -27, 8, 0.035, 27, "runwayAsphalt", { solid: false });
  for (const z of [-22, -14, -6, 2, 10, 18]) {
    m.box(-0.25, 0.04, z, 0.25, 0.065, z + 3, "runwayPaint", { solid: false });
  }
  for (const x of [-7.2, 7.2]) {
    m.box(x - 0.1, 0.04, -27, x + 0.1, 0.065, 27, "runwayPaint", { solid: false });
  }
  // Low offset barriers preserve a clear 50u firing lane but make crossing
  // the strip a sequence of short moves between cover.
  m.box(-5.7, 0, -8, -2, 1.4, -6.7, "blastConcrete");
  m.box(2.1, 0, 5.8, 5.9, 1.4, 7.1, "blastConcrete");
  m.box(-2.3, 0, -0.9, 2.3, 1.1, 0.9, "blastConcrete");
  m.pickup("shield", 0, 0, 3.5);
  m.sym2(() => {
    homeHalf(m, 42, "blastConcrete", "fadedStripe");
    // Open-sided maintenance hangar, with an interior lane and two entrances.
    m.box(-37, 0, -20, -36.2, 4.2, -8, "hangarMetal");
    m.box(-37, 0, -20, -24, 4.2, -19.2, "hangarMetal");
    m.box(-37.4, 4.2, -20.4, -23.6, 4.7, -7.6, "hangarMetal", { solid: false });
    for (const z of [-17, -13, -9]) m.box(-36.1, 1.4, z - 0.2, -35.8, 3.3, z + 0.2, "fadedStripe", { solid: false });
    m.box(-33, 0, -16, -29, 1.7, -13.5, "blastConcrete");
    m.box(-29, 0, -11, -25, 1.7, -8.5, "blastConcrete");
    // Opposite control deck offers a counter-angle reachable from both ends.
    m.box(24, 0, -14, 35, 3, -6, "blastConcrete");
    m.stairs("+z", -18.8, 27, 32, 8, "blastConcrete", { rise: 0.375, run: 0.6 });
    m.stairs("-z", -1.2, 27, 32, 8, "blastConcrete", { rise: 0.375, run: 0.6 });
    m.box(24.5, 3, -13.5, 25.2, 4.1, -10.5, "hangarMetal");
    m.box(33.8, 3, -9.5, 34.5, 4.1, -6.5, "hangarMetal");
    m.box(26, 3, -10.7, 32, 3.5, -9.8, "hangarMetal");
    m.box(15, 0, -23, 18.5, 1.4, -21, "blastConcrete");
    m.box(-18.5, 0, -24, -15, 1.4, -22, "blastConcrete");
    m.box(-41, 0, -5, -38, 1.6, -1.5, "hangarMetal");
  });
  twinSupplies(m, 41, 17);
  m.pickup("ammo", 29, 3, -8);
  m.pickup("ammo", -29, 3, 8);
  freeSpawns(m, 50, 42);
  return m.build();
}

// --------------------------------------------------------------- Beacon Cliffs
export function beaconCliffs() {
  const m = arena({
    id: "beacon_cliffs", name: "Beacon Cliffs",
    desc: "Two exposed signal cliffs face across a salt-worn crossing, with lower coastal trails beneath them.",
    hx: 46, hz: 45, floor: "saltRock", edge: "darkCliff",
    palette: {
      sky: "#5c96b7", skyHorizon: "#bad5d8", fog: "#9dbfca", fogNear: 65, fogFar: 165,
      ambient: "#d9e7e9", ambientIntensity: 0.68, hemiGround: "#5f7880",
      sun: "#fff1ce", sunIntensity: 1.1, sunDir: [0.5, -1, -0.4],
    },
    materials: {
      saltRock: { color: "#aeb4ad", rough: 1 },
      darkCliff: { color: "#667c83", rough: 1 },
      chalkCliff: { color: "#d8d5bf", rough: 1 },
      tideStone: { color: "#829da2", rough: 1 },
      beaconMetal: { color: "#826f58", rough: 0.7 },
      beaconLight: { color: "#ffd77e", rough: 0.4, emissive: "#ffc768" },
    },
  });
  // A cliff on each diagonal gives both teams a powerful but flankable
  // perch. A lower open crossing is the direct route between objectives.
  m.sym2(() => {
    homeHalf(m, 45, "darkCliff", "chalkCliff");
    m.box(-35, 0, -16, -19, 4, -4, "darkCliff");
    m.stairs("+z", -22, -31, -23, 12, "chalkCliff", { rise: 1 / 3, run: 0.5 });
    m.stairs("-z", 2, -31, -23, 12, "chalkCliff", { rise: 1 / 3, run: 0.5 });
    for (const x of [-33, -28, -23]) {
      m.box(x - 0.5, 4, -15.5, x + 0.5, 5.2, -14.4, "chalkCliff");
      m.box(x - 0.5, 4, -5.6, x + 0.5, 5.2, -4.5, "chalkCliff");
    }
    // Beacon mast is narrow; its base supplies a piece of perch cover.
    m.box(-28.4, 4, -10.5, -25.6, 6, -7.7, "chalkCliff");
    m.box(-27.5, 6, -9.6, -26.5, 11.5, -8.6, "beaconMetal");
    m.box(-28.3, 11.5, -10.4, -25.7, 12.5, -7.8, "beaconLight", { solid: false });
    m.box(-38, 0, -29, -34, 2.1, -25.5, "darkCliff");
    m.box(34, 0, -25, 38, 1.7, -22, "chalkCliff");
    m.box(-40, 0, -2, -37, 1.5, 2, "tideStone");
    m.box(36, 0, -7, 39, 1.5, -3, "tideStone");
    // Parallel low ribs interrupt a cross-map shot without sealing a lane.
    m.box(-14, 0, -16, -9, 2, -14.4, "darkCliff");
    m.box(7, 0, -20, 12, 1.6, -18.3, "chalkCliff");
  });
  m.box(-8, 0, -2.2, -3, 1.5, 0, "tideStone");
  m.box(3, 0, 0, 8, 1.5, 2.2, "tideStone");
  m.box(-1.5, 0, -3, 1.5, 1.8, 3, "darkCliff");
  m.pickup("shield", 0, 0, 7);
  twinSupplies(m, 38, 19);
  m.pickup("ammo", -21, 4, -10);
  m.pickup("ammo", 21, 4, 10);
  freeSpawns(m, 46, 45);
  return m.build();
}

// ---------------------------------------------------------------- Glacier Pass
export function glacierPass() {
  const m = arena({
    id: "glacier_pass", name: "Glacier Pass",
    desc: "A raised ice traverse overlooks a sheltered underpass; broken blue ridges split the snowy side routes.",
    hx: 48, hz: 46, floor: "packedSnow", edge: "iceCliff",
    palette: {
      sky: "#7eaccc", skyHorizon: "#d8ebef", fog: "#bbd8e5", fogNear: 58, fogFar: 158,
      ambient: "#e5f3fb", ambientIntensity: 0.72, hemiGround: "#7895a9",
      sun: "#f5faff", sunIntensity: 1.0, sunDir: [-0.3, -1, 0.55],
    },
    materials: {
      packedSnow: { color: "#dce8e7", rough: 1 },
      iceCliff: { color: "#7ba6b7", rough: 0.65 },
      blueIce: { color: "#a5d1d7", rough: 0.5 },
      frostStone: { color: "#92aab0", rough: 1 },
      driftSnow: { color: "#f1f4ed", rough: 1 },
    },
  });
  // The long bridge creates a high north/south rifle lane and an open
  // east/west crossing underneath. Both ends have broad stair approaches.
  m.box(-5, 2.6, -18, 5, 3, 18, "blueIce");
  m.box(-5, 0, -18, 5, 2.6, -15, "iceCliff");
  m.box(-5, 0, 15, 5, 2.6, 18, "iceCliff");
  m.stairs("+z", -24, -4.3, 4.3, 12, "frostStone", { rise: 0.25, run: 0.5 });
  m.stairs("-z", 24, -4.3, 4.3, 12, "frostStone", { rise: 0.25, run: 0.5 });
  for (const z of [-13, -5, 4, 12]) {
    m.box(-5, 3, z - 1.5, -4.35, 4, z + 1.5, "iceCliff");
    m.box(4.35, 3, z - 1.5, 5, 4, z + 1.5, "iceCliff");
  }
  // Thin visual striations read as ice layering without closing the tunnel.
  for (const y of [0.7, 1.55, 2.35]) {
    m.box(-5.14, y, -14.5, -4.99, y + 0.15, 14.5, "driftSnow", { solid: false });
    m.box(4.99, y, -14.5, 5.14, y + 0.15, 14.5, "driftSnow", { solid: false });
  }
  m.sym2(() => {
    homeHalf(m, 46, "iceCliff", "driftSnow");
    // Jagged ridges provide alternating cover beside the open traverse.
    m.box(-31, 0, -15, -19, 1.7, -12, "iceCliff");
    m.box(-28, 1.7, -15, -22, 2.5, -12.6, "blueIce");
    m.box(19, 0, -11, 31, 2, -8, "iceCliff");
    m.box(22, 2, -10.6, 28, 2.7, -8.4, "blueIce");
    m.box(-37, 0, -26, -33, 2.1, -23, "frostStone");
    m.box(33, 0, -24, 37, 2, -21, "blueIce");
    m.box(-17, 0, -27, -14, 1.5, -24, "iceCliff");
    m.box(14, 0, -25, 17, 1.5, -22, "iceCliff");
    m.box(-32, 0, -3, -29, 1.4, 0, "blueIce");
    m.box(29, 0, -4, 32, 1.4, -1, "blueIce");
  });
  m.box(-15, 0, -2, -11, 1.8, 1, "frostStone");
  m.box(11, 0, -1, 15, 1.8, 2, "frostStone");
  m.pickup("shield", 0, 3, 0);
  twinSupplies(m, 39, 19);
  m.pickup("ammo", -27, 0, 4);
  m.pickup("ammo", 27, 0, -4);
  freeSpawns(m, 48, 46);
  return m.build();
}

// ------------------------------------------------------------- Windfarm Heights
export function windfarmHeights() {
  const m = arena({
    id: "windfarm_heights", name: "Windfarm Heights",
    desc: "Service platforms and turbine foundations punctuate an open highland of long diagonal firing lanes.",
    hx: 50, hz: 50, floor: "windGrass", edge: "ridgeStone",
    palette: {
      sky: "#76a8c2", skyHorizon: "#c8d6b4", fog: "#b7cbbf", fogNear: 76, fogFar: 180,
      ambient: "#e4edd8", ambientIntensity: 0.7, hemiGround: "#66866a",
      sun: "#f8efcf", sunIntensity: 1.15, sunDir: [0.35, -1, -0.5],
    },
    materials: {
      windGrass: { color: "#7fa27d", rough: 1 },
      ridgeStone: { color: "#727f79", rough: 1 },
      serviceConcrete: { color: "#b1b6ad", rough: 1 },
      turbineMetal: { color: "#d1d9d2", rough: 0.45 },
      turbineShadow: { color: "#84938d", rough: 0.7 },
      serviceRoad: { color: "#adae98", rough: 1 },
    },
  });
  m.box(-5, 0, -38, 5, 0.035, 38, "serviceRoad", { solid: false });
  m.box(-42, 0, -2.4, 42, 0.035, 2.4, "serviceRoad", { solid: false });
  // Low switching station in the center interrupts both principal lanes.
  m.box(-8, 0, -3, -3, 2.1, 3, "serviceConcrete");
  m.box(3, 0, -3, 8, 2.1, 3, "serviceConcrete");
  m.box(-2.2, 0, -1.2, 2.2, 1.4, 1.2, "turbineShadow");
  m.pickup("shield", 0, 0, 5);
  m.sym2(() => {
    homeHalf(m, 50, "ridgeStone", "serviceConcrete");
    // Balanced service deck; the two separate stair runs invite flanks.
    m.box(-30, 0, -20, -18, 2.5, -8, "ridgeStone");
    m.stairs("+z", -25, -27, -21, 10, "serviceConcrete", { rise: 0.25, run: 0.5 });
    m.stairs("-z", -3, -27, -21, 10, "serviceConcrete", { rise: 0.25, run: 0.5 });
    m.box(-29.3, 2.5, -19.3, -28.5, 3.6, -16, "serviceConcrete");
    m.box(-19.5, 2.5, -12, -18.7, 3.6, -8.7, "serviceConcrete");
    m.box(-27, 2.5, -12.5, -22, 3.35, -11.3, "turbineShadow");
    // Two turbines per half define perspective and intermittent hard cover.
    for (const [x, z] of [[-35, -5], [35, -25]]) {
      m.box(x - 2, 0, z - 2, x + 2, 1.1, z + 2, "serviceConcrete");
      m.box(x - 0.65, 1.1, z - 0.65, x + 0.65, 12.5, z + 0.65, "turbineMetal");
      m.box(x - 5.8, 11.3, z - 0.16, x + 5.8, 11.65, z + 0.16, "turbineMetal", { solid: false });
      m.box(x - 0.16, 7, z - 0.16, x + 0.16, 15.8, z + 0.16, "turbineMetal", { solid: false });
    }
    m.box(17, 0, -28, 21, 1.6, -25, "serviceConcrete");
    m.box(-16, 0, -31, -12, 1.6, -28, "serviceConcrete");
    m.box(30, 0, -13, 33, 1.3, -9, "ridgeStone");
    m.box(-39, 0, -28, -36, 1.4, -24, "ridgeStone");
    m.box(13, 0, -15, 17, 1.4, -12, "turbineShadow");
  });
  twinSupplies(m, 42, 23);
  m.pickup("ammo", -24, 2.5, -15);
  m.pickup("ammo", 24, 2.5, 15);
  freeSpawns(m, 50, 50);
  return m.build();
}

// --------------------------------------------------------------- Dry Reservoir
export function dryReservoir() {
  const m = arena({
    id: "dry_reservoir", name: "Dry Reservoir",
    desc: "A drained basin surrounds a three-gate spillway; raised service banks give long views across the silt.",
    hx: 48, hz: 45, floor: "drySilt", edge: "concreteBank",
    palette: {
      sky: "#a1b8bc", skyHorizon: "#dfc9aa", fog: "#c4c4b1", fogNear: 76, fogFar: 172,
      ambient: "#e9e5d7", ambientIntensity: 0.67, hemiGround: "#8e7867",
      sun: "#f9e9c7", sunIntensity: 1.15, sunDir: [-0.5, -1, -0.15],
    },
    materials: {
      drySilt: { color: "#a39377", rough: 1 },
      concreteBank: { color: "#999c92", rough: 1 },
      stainedConcrete: { color: "#737f7b", rough: 1 },
      spillwayMetal: { color: "#716f65", rough: 0.7 },
      sedimentLine: { color: "#c2b499", rough: 1 },
    },
  });
  // The wide weir blocks the straight shot through the basin, but three
  // gates plus open ends keep five ground-level cross routes available.
  m.wall("x", -28, 28, -2, 2, 0, 2.8, "concreteBank", [
    [-17, -11, 0, 2.8], [-2.5, 2.5, 0, 2.8], [11, 17, 0, 2.8],
  ]);
  for (const x of [-27, -20, -8, 8, 20, 27]) {
    m.box(x - 0.35, 0, -2.35, x + 0.35, 3.1, -1.95, "stainedConcrete", { solid: false });
    m.box(x - 0.35, 0, 1.95, x + 0.35, 3.1, 2.35, "stainedConcrete", { solid: false });
  }
  for (const x of [-14, 0, 14]) {
    m.box(x - 0.25, 2.65, -2.25, x + 0.25, 3.2, 2.25, "spillwayMetal", { solid: false });
  }
  // Thin sediment strata explain the drained waterline without adding
  // player collisions or concealing a shot.
  for (const z of [-16, -8, 7, 15]) {
    m.box(-27, 0, z, 27, 0.03, z + 0.35, "sedimentLine", { solid: false });
  }
  for (const [x0, x1] of [[-36, -28], [28, 36]]) {
    m.box(x0, 0, -19, x1, 3.2, 19, "concreteBank");
    m.stairs("+z", -25, x0 + 1, x1 - 1, 8, "stainedConcrete", { rise: 0.4, run: 0.75 });
    m.stairs("-z", 25, x0 + 1, x1 - 1, 8, "stainedConcrete", { rise: 0.4, run: 0.75 });
    for (const z of [-13, -3, 7]) {
      m.box(x0 + 0.6, 3.2, z - 2, x0 + 1.4, 4.2, z + 2, "stainedConcrete");
      m.box(x1 - 1.4, 3.2, z - 2, x1 - 0.6, 4.2, z + 2, "stainedConcrete");
    }
  }
  m.sym2(() => {
    homeHalf(m, 45, "concreteBank", "stainedConcrete");
    // The intake chamber and pipe sections create middle-distance cover.
    m.box(-2.5, 0, -13, 2.5, 3.4, -9, "stainedConcrete");
    m.box(-3.2, 3.4, -13.7, 3.2, 3.8, -8.3, "concreteBank", { solid: false });
    m.box(-17, 0, -22, -13, 1.4, -19, "concreteBank");
    m.box(13, 0, -25, 17, 1.4, -22, "stainedConcrete");
    m.box(-40, 0, -18, -37, 2.1, -14, "concreteBank");
    m.box(37, 0, -22, 40, 2.1, -18, "concreteBank");
    m.box(-23, 0, -7, -19, 1.4, -5, "stainedConcrete");
    m.box(19, 0, -9, 23, 1.4, -7, "stainedConcrete");
  });
  m.pickup("shield", 0, 0, 0);
  twinSupplies(m, 40, 24);
  m.pickup("ammo", -32, 3.2, 9);
  m.pickup("ammo", 32, 3.2, -9);
  freeSpawns(m, 48, 45);
  return m.build();
}

export const LARGE_PRECISION_MAPS = [
  ridgeWatch, quarryLookout, desertAirfield, beaconCliffs,
  glacierPass, windfarmHeights, dryReservoir,
];
