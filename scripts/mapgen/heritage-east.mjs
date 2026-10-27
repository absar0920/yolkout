// Original arenas inspired by landscapes and historic engineering. Every
// footprint and route here is authored for Yolkout;
// the maps do not reproduce protected monuments or sacred/funerary structures.
import { MapBuilder } from "./lib.mjs";

const PI = Math.PI;
const MODES = ["ffa", "teams", "nest"];

function enclosure(m, halfX, halfZ, mat, height = 3) {
  m.box(-halfX, 0, -halfZ, halfX, height, -halfZ + 0.6, mat);
  m.box(-halfX, 0, halfZ - 0.6, halfX, height, halfZ, mat);
  m.box(-halfX, 0, -halfZ + 0.6, -halfX + 0.6, height, halfZ - 0.6, mat);
  m.box(halfX - 0.6, 0, -halfZ + 0.6, halfX, height, halfZ - 0.6, mat);
}

function team(m, positions, nestZ, yaw = PI) {
  for (const [x, z] of positions) m.spawn(x, 0, z, yaw, 1);
  m.nest(1, 0, 0, nestZ);
}

export function roseGorge() {
  const m = new MapBuilder({
    id: "rose_gorge", name: "Rose Gorge",
    desc: "Wind through rose sandstone and a dry watercourse, then fight across the ledges above the canyon.",
    modes: MODES, bounds: { min: [-30, -4, -28], max: [30, 24, 28] },
    palette: {
      sky: "#7eabcb", skyHorizon: "#eac2a8", fog: "#bc8f84", fogNear: 40, fogFar: 120,
      ambient: "#ffe1ce", ambientIntensity: 0.55, hemiGround: "#9d614f",
      sun: "#fff0d6", sunIntensity: 1.35, sunDir: [-0.55, -1, 0.25],
    },
    materials: {
      roseSand: { color: "#b77762", rough: 1 },
      roseRock: { color: "#955c54", rough: 1 },
      roseLight: { color: "#da9b78", rough: 1 },
      roseStrata: { color: "#d59670", rough: 1 },
      channel: { color: "#ccad8c", rough: 1 },
      canyonShade: { color: "#704a50", rough: 1 },
    },
  });
  m.box(-30, -2, -28, 30, 0, 28, "roseSand");
  enclosure(m, 30, 28, "roseRock", 8);
  // Two opposing cliff faces overlap in plan. Crossing the middle requires a
  // lateral turn, so neither base can see into the other through the canyon.
  m.sym2(() => {
    m.box(-29.4, 0, -3.2, 8, 6.2, -1.4, "roseRock");
    // Broken horizontal bands and projecting shelves make the face read as
    // layered sandstone at ground level. These are visual-only surfaces.
    for (const [x0, x1, y, thickness, mat] of [
      [-29, -19, 0.85, 0.18, "roseStrata"], [-17, -2, 0.62, 0.15, "roseLight"],
      [0, 7.5, 1.08, 0.22, "roseStrata"], [-27, -13, 2.1, 0.2, "roseLight"],
      [-10, 6.5, 2.85, 0.18, "roseStrata"], [-29, -24, 3.8, 0.16, "roseStrata"],
      [-21, -5, 4.4, 0.28, "roseLight"], [-2, 8, 5.25, 0.2, "roseStrata"],
    ]) m.box(x0, y, -3.31, x1, y + thickness, -3.2, mat, { solid: false });
    for (const [x0, x1, y] of [[-26, -21, 3.1], [-15, -10, 1.55], [-3, 4, 3.7]]) {
      m.box(x0, y, -1.4, x1, y + 0.18, -1.29, "roseLight", { solid: false });
    }
    for (const [x0, x1, h] of [[-28, -24, 1.2], [-19, -16, 0.7], [-10, -6, 1.7], [0, 3, 0.9]]) {
      m.box(x0, 6.2, -3.2, x1, 6.2 + h, -1.4, "roseLight");
    }
    m.box(-24, 4.1, -3.4, -17, 4.5, -3.19, "roseStrata", { solid: false });
    m.box(-5, 2.25, -3.4, 4, 2.55, -3.19, "roseStrata", { solid: false });
  });
  m.box(-1.2, 0, -27, 1.2, 0.025, 27, "channel", { solid: false });
  m.box(-29, 0, -0.65, 29, 0.025, 0.65, "channel", { solid: false });
  m.sym2(() => {
    // Offset ledges, shelves, and boulder stacks make the open approaches
    // playable without turning the gorge into a single firing lane.
    m.box(-25, 0, -13, -20, 1.5, -7, "roseRock");
    m.stairs("+z", -16, -24, -22, 3, "roseLight", { rise: 0.5, run: 1 });
    m.box(20, 0, -18, 25, 1.5, -13, "roseLight");
    m.box(21, 1.5, -17, 24, 2.5, -14, "roseRock");
    m.box(-16, 0, -10, -13, 2.5, -7.5, "roseLight");
    m.box(-15, 2.5, -9.5, -13.5, 3.5, -8, "canyonShade");
    m.box(11, 0, -11, 14, 2.2, -8, "roseRock");
    m.box(-27, 0, -23, -24, 2, -20, "roseLight");
    m.box(24, 0, -8, 27, 1.2, -5, "roseLight");
    team(m, [[-13, -24], [-6.5, -24], [0, -23], [6.5, -24], [13, -24], [0, -18.5]], -25.5);
    m.spawn(-23, 0, -18, PI / 2, 0);
    m.spawn(17, 0, -19, -PI / 2, 0);
    m.spawn(-18, 0, -5, 0, 0);
    m.pickup("hp", -26, 0, -5);
    m.pickup("ammo", 23, 0, -11);
    m.pickup("hp", -22, 1.5, -9);
  });
  m.pickup("shield", 0, 0, 0);
  return m.build();
}

export function cloudTerrace() {
  const m = new MapBuilder({
    id: "cloud_terrace", name: "Cloud Terrace",
    desc: "Climb a misty ridge by staggered stairways or flank through the lower terrace fields.",
    modes: MODES, bounds: { min: [-28, -4, -28], max: [28, 24, 28] },
    palette: {
      sky: "#a5cbd2", skyHorizon: "#d9e5d4", fog: "#b7c9bc", fogNear: 28, fogFar: 100,
      ambient: "#e9f4e6", ambientIntensity: 0.62, hemiGround: "#6b795b",
      sun: "#fff3d8", sunIntensity: 1.0, sunDir: [0.45, -1, -0.3],
    },
    materials: {
      cloudGrass: { color: "#70916c", rough: 1 },
      ridgeStone: { color: "#82918b", rough: 1 },
      paleStone: { color: "#acb8a9", rough: 1 },
      terraceSoil: { color: "#847e69", rough: 1 },
      mistMoss: { color: "#5b7867", rough: 1 },
      terraceLine: { color: "#c3bba0", rough: 1 },
    },
  });
  m.box(-28, -2, -28, 28, 0, 28, "cloudGrass");
  enclosure(m, 28, 28, "ridgeStone", 3.5);
  // The ridge is a genuine second fighting level. Ground-level routes remain
  // open around both ends; four stairs create independent upper approaches.
  m.box(-17, 0, -4, 17, 2.5, 4, "ridgeStone");
  m.box(-16.5, 2.5, -3.5, 16.5, 2.53, 3.5, "paleStone", { solid: false });
  m.sym2(() => {
    // Thin segmented retaining courses soften the monolithic ridge face.
    for (const [x0, x1, y] of [
      [-16, -7, 0.48], [-5, 5, 0.76], [7, 16, 0.5],
      [-15, -3, 1.42], [-1, 10, 1.68], [12, 16, 1.35],
      [-16, -10, 2.13], [-8, 3, 2.18], [5, 16, 2.12],
    ]) m.box(x0, y, -4.09, x1, y + 0.13, -3.99, "terraceLine", { solid: false });
    m.box(-17, 2.5, -4.03, 17, 2.65, -3.62, "terraceSoil", { solid: false });
  });
  m.sym2(() => {
    m.stairs("+z", -9, -12, -9, 5, "paleStone", { rise: 0.5, run: 1 });
    m.stairs("+z", -9, 8, 11, 5, "paleStone", { rise: 0.5, run: 1 });
    // Side shelves are optional flank perches, not one-way drops.
    m.box(-24, 0, -13, -19, 1, -7, "terraceSoil");
    m.stairs("+z", -15, -23, -21, 2, "paleStone", { rise: 0.5, run: 1 });
    m.box(-23.5, 1, -12.5, -19.5, 1.04, -7.5, "mistMoss", { solid: false });
    m.box(19, 0, -13, 22, 1, -10, "ridgeStone");
    m.box(-15, 0, -13, -9, 0.8, -12.2, "ridgeStone");
    m.box(4, 0, -15, 10, 0.8, -14.2, "ridgeStone");
    m.box(14, 0, -20, 16.2, 1.3, -17.8, "paleStone");
    m.box(-17, 0, -20, -14.8, 1.3, -17.8, "paleStone");
    m.box(-5, 0, -11, -2.5, 0.7, -9.8, "terraceSoil");
    // Soil strips and stone rows show successive agricultural contours from
    // the upper camera without changing the traversable field surface.
    for (const [x0, x1, z] of [[-16, -7, -18], [2, 16, -17], [-7, 4, -12]]) {
      m.box(x0, 0, z, x1, 0.035, z + 1.35, "terraceSoil", { solid: false });
      m.box(x0, 0.035, z + 1.25, x1, 0.09, z + 1.42, "terraceLine", { solid: false });
    }
    m.box(-26, 0, -22, -25.1, 2.8, -21.1, "ridgeStone");
    m.box(-26.5, 2.8, -22.5, -24.6, 3.8, -20.6, "mistMoss");
    m.box(24.8, 0, -13.2, 25.7, 2.4, -12.3, "ridgeStone");
    m.box(24.4, 2.4, -13.6, 26.1, 3.25, -11.9, "mistMoss");
    team(m, [[-13, -24], [-6.5, -24], [0, -23], [6.5, -24], [13, -24], [0, -18.5]], -25.5);
    m.spawn(-24.5, 0, -3, 0, 0);
    m.spawn(22, 0, -16, PI / 2, 0);
    m.spawn(-5, 0, -15.5, 0, 0);
    m.pickup("hp", -25, 0, -2);
    m.pickup("ammo", 22, 0, -7);
    m.pickup("hp", -21, 1, -9);
  });
  m.box(-6, 2.5, -0.8, -4, 3.4, 0.8, "mistMoss");
  m.box(4, 2.5, -0.8, 6, 3.4, 0.8, "mistMoss");
  m.pickup("shield", 0, 2.5, 0);
  return m.build();
}

export function reservoirGrove() {
  const m = new MapBuilder({
    id: "reservoir_grove", name: "Reservoir Grove",
    desc: "Cross a forested hydraulic work by shallow basin, raised bridge, or the outer embankments.",
    modes: MODES, bounds: { min: [-28, -4, -28], max: [28, 24, 28] },
    palette: {
      sky: "#8fc4bc", skyHorizon: "#d5dec1", fog: "#a4bda8", fogNear: 34, fogFar: 105,
      ambient: "#eaf1dc", ambientIntensity: 0.58, hemiGround: "#51745b",
      sun: "#fff1d2", sunIntensity: 1.05, sunDir: [-0.3, -1, 0.5],
    },
    materials: {
      groveEarth: { color: "#6d825d", rough: 1 },
      laterite: { color: "#a56855", rough: 1 },
      mossStone: { color: "#788d72", rough: 1 },
      basinWater: { color: "#4e9ba1", rough: 0.25 },
      bridgeWood: { color: "#a18760", rough: 0.9 },
      trunk: { color: "#665747", rough: 1 },
      canopy: { color: "#3e6d58", rough: 1 },
      canopyLight: { color: "#608363", rough: 1 },
      basinEdge: { color: "#b48c69", rough: 1 },
    },
  });
  m.box(-28, -2, -28, 28, 0, 28, "groveEarth");
  enclosure(m, 28, 28, "laterite", 3.5);
  // Blue stone inlay suggests shallow water while keeping all crossings
  // compatible with the game's ground movement and hit detection.
  m.box(-14, 0, -8, 14, 0.025, 8, "basinWater", { solid: false });
  for (const [x0, x1, z] of [[-11, -5, -5.8], [4, 10, -3.5], [-10, -3, 4.4], [5, 12, 6.5]]) {
    m.box(x0, 0.027, z, x1, 0.037, z + 0.1, "canopyLight", { solid: false });
  }
  m.box(-2.4, 0, -8, 2.4, 0.45, 8, "bridgeWood");
  m.box(-13, 0, -1.3, 13, 0.45, 1.3, "bridgeWood");
  m.box(-14, 0, -8.5, -12.6, 0.85, -2.2, "basinEdge");
  m.box(-14, 0, 2.2, -12.6, 0.85, 8.5, "basinEdge");
  m.box(12.6, 0, -8.5, 14, 0.85, -2.2, "basinEdge");
  m.box(12.6, 0, 2.2, 14, 0.85, 8.5, "basinEdge");
  m.box(-3, 0, -3, 3, 4.2, 3, "mossStone"); // sluice house, not a shrine
  m.box(-3.2, 4.2, -3.2, 3.2, 4.65, 3.2, "laterite");
  for (const x of [-2, 0, 2]) {
    m.box(x - 0.16, 0.6, -3.07, x + 0.16, 3.4, -2.98, "basinEdge", { solid: false });
    m.box(x - 0.16, 0.6, 2.98, x + 0.16, 3.4, 3.07, "basinEdge", { solid: false });
  }
  m.sym2(() => {
    // The old embankment fully screens each base. Two wide outer exits feed
    // the bridge, basin floor, and perimeter tree line.
    m.box(-18, 0, -14.5, 18, 4, -13.2, "laterite");
    m.box(-24, 0, -15, -22.5, 2.2, -8, "mossStone");
    m.box(22.5, 0, -15, 24, 2.2, -8, "mossStone");
    m.box(-12, 0, -9, -5, 0.7, -8.2, "mossStone");
    m.box(5, 0, -9, 12, 0.7, -8.2, "mossStone");
    for (const [x, z] of [[-21, -4], [21, -2], [-19, -20]]) {
      m.box(x - 0.6, 0, z - 0.6, x + 0.6, 4.5, z + 0.6, "trunk");
      m.box(x - 2, 4.5, z - 2, x + 2, 5.7, z + 2, "canopy");
      m.box(x - 1.35, 5.7, z - 1.35, x + 1.35, 6.3, z + 1.35, "canopyLight");
    }
    // Small raised bank markers pick out the two reservoir approaches.
    m.box(-16.5, 0, -10, -15.5, 2.3, -9, "mossStone");
    m.box(15.5, 0, -10, 16.5, 2.3, -9, "mossStone");
    m.box(-21, 0, -11.5, -18.5, 0.7, -10.5, "basinEdge");
    m.box(18.5, 0, -11.5, 21, 0.7, -10.5, "basinEdge");
    m.box(-10, 0, -20, -7, 1.2, -18, "mossStone");
    m.box(8, 0, -19, 11, 1.2, -17, "mossStone");
    team(m, [[-13, -24], [-6.5, -24], [0, -23], [6.5, -24], [13, -24], [0, -18.5]], -25.5);
    m.spawn(-25, 0, -18, PI / 2, 0);
    m.spawn(25, 0, -6, -PI / 2, 0);
    m.spawn(-17, 0, -7, 0, 0);
    m.pickup("hp", -20, 0, -9);
    m.pickup("ammo", 19, 0, -10);
    m.pickup("hp", -11, 0, -4);
  });
  m.pickup("shield", 0, 0.45, -6);
  m.pickup("shield", 0, 0.45, 6);
  return m.build();
}

export function tuffLabyrinth() {
  const m = new MapBuilder({
    id: "tuff_labyrinth", name: "Tuff Labyrinth",
    desc: "Duck around eroded rock screens and short covered passages beneath pale volcanic pinnacles.",
    modes: MODES, bounds: { min: [-30, -4, -28], max: [30, 24, 28] },
    palette: {
      sky: "#83b6cf", skyHorizon: "#e4d2b9", fog: "#c7b9a4", fogNear: 38, fogFar: 115,
      ambient: "#f6e5cf", ambientIntensity: 0.63, hemiGround: "#a78d72",
      sun: "#fff4db", sunIntensity: 1.2, sunDir: [0.52, -1, -0.25],
    },
    materials: {
      tuffGround: { color: "#c2ad8c", rough: 1 },
      tuffRock: { color: "#a89176", rough: 1 },
      tuffLight: { color: "#e2c9a2", rough: 1 },
      capstone: { color: "#877563", rough: 1 },
      caveShade: { color: "#79685d", rough: 1 },
      tuffStrata: { color: "#d5b895", rough: 1 },
    },
  });
  m.box(-30, -2, -28, 30, 0, 28, "tuffGround");
  enclosure(m, 30, 28, "tuffRock", 4.5);
  // Broken central escarpment has two covered passages and two wide outside
  // routes. Offset baffles prevent the tunnel openings from being sniping tubes.
  m.box(-24, 0, -1.3, -16, 5.2, 1.3, "tuffRock");
  m.box(-10, 0, -1.3, 10, 5.2, 1.3, "tuffRock");
  m.box(16, 0, -1.3, 24, 5.2, 1.3, "tuffRock");
  for (const x of [-16, 10]) m.box(x, 3.8, -2, x + 6, 4.4, 2, "capstone");
  for (const [x0, x1, y] of [[-23, -17, 0.9], [-9, -3, 1.5], [0, 9, 1.0], [17, 23, 2.2], [-9, 5, 3.2]]) {
    m.box(x0, y, -1.39, x1, y + 0.16, -1.29, "tuffStrata", { solid: false });
    m.box(-x1, y, 1.29, -x0, y + 0.16, 1.39, "tuffStrata", { solid: false });
  }
  for (const [x0, x1] of [[-24, -21], [-9, -6], [-1, 2], [7, 10], [18, 22]]) {
    m.box(x0, 5.2, -1.3, x1, 6.1, 1.3, "tuffLight");
  }
  m.box(-15.9, 0, -1.2, -10.1, 0.045, 1.2, "caveShade", { solid: false });
  m.box(10.1, 0, -1.2, 15.9, 0.045, 1.2, "caveShade", { solid: false });
  m.sym2(() => {
    // Two offset outcrops make a serpentine base exit, like the larger
    // covered passages in the centre of the field.
    m.box(-18, 0, -15, -2, 4.2, -13.5, "tuffRock");
    m.box(2, 0, -15, 18, 4.2, -13.5, "tuffRock");
    m.box(-4, 0, -11.5, 4, 3.8, -10, "tuffRock");
    m.box(-17, 0, -7, -10, 3.5, -5.2, "tuffRock");
    m.box(10, 0, -7, 17, 3.5, -5.2, "tuffRock");
    m.box(-16, 3.5, -7.2, -11, 3.8, -5, "capstone");
    m.box(11, 3.5, -7.2, 16, 3.8, -5, "capstone");
    for (const [x, z] of [[-25, -9], [24, -4], [-23, -20]]) {
      m.box(x - 1.25, 0, z - 1.25, x + 1.25, 4.1, z + 1.25, "tuffRock");
      m.box(x - 1.7, 4.1, z - 1.7, x + 1.7, 4.7, z + 1.7, "capstone");
      m.box(x - 1.25, 2.6, z - 1.35, x + 1.25, 2.75, z - 1.24, "tuffStrata", { solid: false });
    }
    m.box(-8, 0, -21, -5, 1.1, -19, "tuffLight");
    m.box(8, 0, -20, 11, 1.1, -18, "tuffLight");
    m.box(-28, 0, -4, -27, 2.8, 2, "caveShade");
    team(m, [[-13, -24], [-6.5, -24], [0, -23], [6.5, -24], [13, -24], [0, -18.5]], -25.5);
    m.spawn(-28, 0, -16, PI / 2, 0);
    m.spawn(26, 0, -10, -PI / 2, 0);
    m.spawn(-6, 0, -9, 0, 0);
    m.pickup("hp", -23, 0, -4);
    m.pickup("ammo", 22, 0, -11);
    m.pickup("hp", 0, 0, -4);
  });
  m.pickup("shield", -13, 0, 0);
  m.pickup("shield", 13, 0, 0);
  return m.build();
}

export function boulderBazaar() {
  const m = new MapBuilder({
    id: "boulder_bazaar", name: "Boulder Bazaar",
    desc: "A pillared trading street sits among granite boulders, with open riverbed flanks on both sides.",
    modes: MODES, bounds: { min: [-30, -4, -28], max: [30, 24, 28] },
    palette: {
      sky: "#a3c7d5", skyHorizon: "#e5d7ab", fog: "#c9ba99", fogNear: 38, fogFar: 120,
      ambient: "#fff0cf", ambientIntensity: 0.58, hemiGround: "#9a8659",
      sun: "#fff0bf", sunIntensity: 1.27, sunDir: [-0.52, -1, 0.18],
    },
    materials: {
      bazaarEarth: { color: "#aa946c", rough: 1 },
      granite: { color: "#81796d", rough: 1 },
      warmGranite: { color: "#a39a84", rough: 1 },
      arcade: { color: "#c2a978", rough: 1 },
      awning: { color: "#bb7951", rough: 0.9 },
      riverSilt: { color: "#8d8e7b", rough: 1 },
      saffronCloth: { color: "#d6a443", rough: 0.95 },
      indigoCloth: { color: "#597f8d", rough: 0.95 },
      marketBasket: { color: "#aa764d", rough: 1 },
    },
  });
  m.box(-30, -2, -28, 30, 0, 28, "bazaarEarth");
  enclosure(m, 30, 28, "granite", 3.5);
  m.box(-29, 0, -6, 29, 0.025, 6, "riverSilt", { solid: false });
  m.box(-18, 0, -6, 18, 0.06, 6, "arcade", { solid: false });
  // Pillared arcade: a long covered lane plus open flanks. All stalls are
  // original simple forms and leave walkable aisles around them.
  for (const x of [-16, -8, 0, 8, 16]) for (const z of [-5, 5]) {
    m.box(x - 0.55, 0, z - 0.55, x + 0.55, 4.3, z + 0.55, "granite");
    m.box(x - 0.75, 2.6, z - 0.6, x + 0.75, 2.8, z + 0.6, "warmGranite", { solid: false });
  }
  m.box(-18, 4.3, -6, 18, 4.75, 6, "awning");
  m.box(-18, 3.8, -6.1, 18, 4.3, -5.85, "warmGranite", { solid: false });
  m.box(-18, 3.8, 5.85, 18, 4.3, 6.1, "warmGranite", { solid: false });
  for (const [x, mat] of [[-17, "saffronCloth"], [-10, "indigoCloth"], [-3, "saffronCloth"], [4, "indigoCloth"], [11, "saffronCloth"]]) {
    m.box(x, 4.76, -5.7, x + 5.5, 4.8, 5.7, mat, { solid: false });
    m.box(x, 3.45, -6.13, x + 5.5, 4.05, -6.03, mat, { solid: false });
    m.box(x, 3.45, 6.03, x + 5.5, 4.05, 6.13, mat, { solid: false });
  }
  m.box(-16, 0, -0.8, -5, 1.45, 0.8, "arcade");
  m.box(-2.5, 0, -0.8, 2.5, 1.45, 0.8, "arcade");
  m.box(5, 0, -0.8, 16, 1.45, 0.8, "arcade");
  for (const [x, mat] of [[-14, "saffronCloth"], [-10, "indigoCloth"], [-1, "marketBasket"], [8, "indigoCloth"], [12, "saffronCloth"]]) {
    m.box(x, 1.45, -0.65, x + 1.3, 1.7, 0.65, mat, { solid: false });
  }
  m.box(-14, 0, 2.1, -12.8, 0.9, 3.2, "marketBasket");
  m.box(12.8, 0, -3.2, 14, 0.9, -2.1, "marketBasket");
  m.sym2(() => {
    // A broad boulder ridge screens the spawn. Players may leave on either
    // side and choose the arcade, the boulder field, or the outer riverbed.
    m.box(-17, 0, -14, -5, 3.5, -12.7, "granite");
    m.box(5, 0, -14, 17, 3.5, -12.7, "granite");
    m.box(-6, 0, -11, 6, 3.2, -9, "warmGranite");
    m.box(-24, 0, -18, -20, 2, -14, "granite");
    m.box(-23, 2, -17, -21, 3.1, -15, "warmGranite");
    m.box(-23.5, 0.65, -18.08, -20.6, 0.78, -17.98, "warmGranite", { solid: false });
    m.box(20, 0, -21, 25, 1.5, -17, "warmGranite");
    m.box(21, 1.5, -20, 24, 2.6, -18, "granite");
    m.box(20.3, 0.7, -21.08, 24.7, 0.85, -20.98, "granite", { solid: false });
    m.box(-27, 0, -9, -23, 2.1, -6, "granite");
    m.box(23, 0, -10, 27, 1.7, -7, "granite");
    m.box(-11, 0, -10, -8, 1.1, -8, "warmGranite");
    m.box(9, 0, -10, 12, 1.1, -8, "warmGranite");
    m.box(-19, 0, -23, -18, 1.8, -18, "arcade");
    team(m, [[-13, -24], [-6.5, -24], [0, -23], [6.5, -24], [13, -24], [0, -18.5]], -25.5);
    m.spawn(-27, 0, -16, PI / 2, 0);
    m.spawn(25, 0, -12, -PI / 2, 0);
    m.spawn(-20, 0, -2, 0, 0);
    m.pickup("hp", -21, 0, -11);
    m.pickup("ammo", 20, 0, -9);
    m.pickup("hp", -12, 0, -3);
  });
  m.pickup("shield", 0, 0, -3);
  m.pickup("shield", 0, 0, 3);
  return m.build();
}

export const EAST_MAPS = [roseGorge, cloudTerrace, reservoirGrove, tuffLabyrinth, boulderBazaar];
