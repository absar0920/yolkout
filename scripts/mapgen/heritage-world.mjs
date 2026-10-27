// Original arenas informed by landscapes and building traditions around the world.
// These are fictional play spaces, not reconstructions of archaeological sites.
// Coordinates: Y is up and the main ground surface is y = 0.
import { MapBuilder } from "./lib.mjs";

const PI = Math.PI;
const ALL = ["ffa", "teams", "nest"];

function ground(m, halfX, halfZ, mat) {
  m.box(-halfX, -1, -halfZ, halfX, 0, halfZ, mat);
}

function edgeWalls(m, halfX, halfZ, mat) {
  m.box(-halfX, 0, -halfZ, halfX, 2.5, -halfZ + 0.5, mat);
  m.box(-halfX, 0, halfZ - 0.5, halfX, 2.5, halfZ, mat);
  m.box(-halfX, 0, -halfZ + 0.5, -halfX + 0.5, 2.5, halfZ - 0.5, mat);
  m.box(halfX - 0.5, 0, -halfZ + 0.5, halfX, 2.5, halfZ - 0.5, mat);
}

// ------------------------------------------------------------ Highland Caravan
export function highlandCaravan() {
  const m = new MapBuilder({
    id: "highland_caravan", name: "Highland Caravan",
    desc: "A highland trade road winds between red-earth terraces, canvas stalls, and a climbable stone pass.",
    modes: ALL,
    bounds: { min: [-30, -10, -30], max: [30, 30, 30] },
    palette: {
      sky: "#84b6d4", skyHorizon: "#e4c29d", fog: "#c5b09a", fogNear: 42, fogFar: 135,
      ambient: "#f8e7d3", ambientIntensity: 0.62, hemiGround: "#a45637",
      sun: "#ffe4b0", sunIntensity: 1.3, sunDir: [-0.6, -1, 0.3],
    },
    materials: {
      redEarth: { color: "#a65c3f", rough: 1 },
      ochreDust: { color: "#d39a5d", rough: 1 },
      sandstone: { color: "#9c7955", rough: 1 },
      darkStone: { color: "#5d5350", rough: 1 },
      canvas: { color: "#ebd1a0", rough: 0.9 },
      indigoCloth: { color: "#576888", rough: 0.85 },
      tradeWood: { color: "#755540", rough: 0.95 },
    },
  });
  ground(m, 30, 30, "redEarth");
  edgeWalls(m, 30, 30, "darkStone");
  // The long pass screens both bases. Its summit is the third crossing;
  // generous outside gaps form two flanking routes.
  m.box(-16, 0, -3, 16, 4, 3, "sandstone");
  m.stairs("+z", -9, -2.3, 2.3, 12, "darkStone", { rise: 1 / 3, run: 0.5 });
  m.stairs("-z", 9, -2.3, 2.3, 12, "darkStone", { rise: 1 / 3, run: 0.5 });
  // Alternating stone courses and shallow buttresses turn the long pass
  // into a dry-stone retaining wall when seen from the road below.
  for (const face of [-1, 1]) {
    const z0 = face < 0 ? -3.28 : 3.02, z1 = z0 + 0.26;
    for (const x of [-14, -10, -6, 6, 10, 14]) {
      m.box(x - 0.65, 0, z0, x + 0.65, 3.5, z1, "darkStone", { solid: false });
      m.box(x - 0.8, 3.5, z0 - 0.08, x + 0.8, 3.85, z1 + 0.08, "sandstone", { solid: false });
    }
    for (const [a, b] of [[-15.8, -3], [3, 15.8]]) {
      m.box(a, 1.15, z0 - 0.05, b, 1.42, z1 + 0.05, "ochreDust", { solid: false });
      m.box(a, 2.75, z0 - 0.04, b, 2.97, z1 + 0.04, "ochreDust", { solid: false });
    }
  }
  for (const x of [-12, -6, 6, 12]) m.box(x - 0.25, 4, -3, x + 0.25, 5.1, -2.5, "darkStone");
  m.box(-15.8, 4, -3, -3, 4.7, -2.5, "darkStone");
  m.box(3, 4, -3, 15.8, 4.7, -2.5, "darkStone");
  m.box(-15.8, 4, 2.5, -3, 4.7, 3, "darkStone");
  m.box(3, 4, 2.5, 15.8, 4.7, 3, "darkStone");
  m.pickup("shield", 0, 4, 0);
  m.sym2(() => {
    // Switchback tracks and low terrace retaining walls.
    m.box(-2.2, 0, -29, 2.2, 0.03, -9.5, "ochreDust", { solid: false });
    m.box(-28, 0, -15, -3, 0.03, -11.5, "ochreDust", { solid: false });
    m.box(3, 0, -17, 28, 0.03, -13.5, "ochreDust", { solid: false });
    m.box(-24, 0, -8, -18, 1.1, -6.8, "sandstone");
    m.box(-23, 1.1, -8, -19, 2.1, -7.2, "darkStone");
    m.box(18, 0, -9, 25, 1.1, -7.8, "sandstone");
    m.box(19, 1.1, -9, 24, 2.1, -8.3, "darkStone");
    m.box(-26, 0, -2, -23, 2.7, 1, "darkStone");
    m.box(23, 0, -2, 26, 2.7, 1, "darkStone");
    // Trading camp on the home side; tent awnings are visual only.
    m.box(-20, 0, -23, -15, 2.6, -22.5, "tradeWood");
    m.box(-20, 0, -23, -19.5, 2.6, -17, "tradeWood");
    m.box(-20.4, 2.6, -23.4, -14.6, 3, -16.6, "canvas", { solid: false });
    m.box(15, 0, -23, 20, 1.2, -21, "tradeWood");
    m.box(14.6, 2.7, -24, 20.4, 3, -17.3, "indigoCloth", { solid: false });
    m.box(14.8, 0, -24, 15.2, 2.7, -17.3, "tradeWood");
    m.box(19.8, 0, -24, 20.2, 2.7, -17.3, "tradeWood");
    // Staggered crates give cover in the approach without closing the route.
    m.box(-11, 0, -16, -8.5, 1.3, -14, "tradeWood");
    m.box(8, 0, -12, 10.5, 1.5, -10, "tradeWood");
    m.box(-14, 0, -5.5, -12, 1.6, -4, "darkStone");
    m.box(11, 0, -7, 13, 1.3, -5.5, "darkStone");
    m.nest(1, 0, 0, -26);
    for (const [x, z] of [[-10, -25], [-5, -26], [5, -26], [10, -25], [-8, -20], [8, -20]]) m.spawn(x, 0, z, PI, 1);
    for (const [x, z, yaw] of [[-26, -18, PI / 2], [25, -15, -PI / 2], [-20, -4, PI / 2], [20, -4, -PI / 2]]) m.spawn(x, 0, z, yaw, 0);
    m.pickup("hp", -25, 0, -12);
    m.pickup("ammo", 25, 0, -11);
    m.pickup("hp", -6, 0, -11);
  });
  return m.build();
}

// ------------------------------------------------------------ Atlantic Outpost
export function atlanticOutpost() {
  const m = new MapBuilder({
    id: "atlantic_outpost", name: "Atlantic Outpost",
    desc: "Turf-covered halls, timber sheds, and a windy coastal landing create three paths around a longhouse.",
    modes: ALL,
    bounds: { min: [-32, -10, -26], max: [32, 28, 26] },
    palette: {
      sky: "#708fa7", skyHorizon: "#c2d3d3", fog: "#b7c8c8", fogNear: 30, fogFar: 108,
      ambient: "#dfecf1", ambientIntensity: 0.68, hemiGround: "#476e55",
      sun: "#f5e5c7", sunIntensity: 0.9, sunDir: [0.5, -1, -0.4],
    },
    materials: {
      heath: { color: "#678568", rough: 1 },
      shore: { color: "#a9a08a", rough: 1 },
      turf: { color: "#5c7650", rough: 1 },
      fieldstone: { color: "#777f7d", rough: 1 },
      weatherwood: { color: "#74634f", rough: 0.95 },
      driftwood: { color: "#a69477", rough: 1 },
      seaWater: { color: "#7ba4ae", rough: 0.3 },
    },
  });
  ground(m, 32, 26, "heath");
  edgeWalls(m, 32, 26, "fieldstone");
  m.box(-31.5, 0, -25.5, -27, 0.035, 25.5, "shore", { solid: false });
  m.box(-31.3, 0.04, -25.4, -29.5, 0.06, 25.4, "seaWater", { solid: false });
  // Longhouse walls face the two teams; the open gable ends invite a loop
  // through the interior and around the beach and inland sides.
  m.box(-13, 0, -6, 13, 3.6, -5.5, "fieldstone");
  m.box(-13, 0, 5.5, 13, 3.6, 6, "fieldstone");
  m.box(-13.5, 3.6, -6.5, 13.5, 4, 6.5, "turf");
  // Posts, low stone plinths, and small shuttered windows break up the
  // longhouse's two otherwise featureless outer elevations.
  for (const face of [-1, 1]) {
    const z0 = face < 0 ? -6.3 : 6.02, z1 = z0 + 0.28;
    m.box(-13, 0.1, z0 - 0.08, 13, 0.72, z1 + 0.08, "fieldstone", { solid: false });
    m.box(-13, 3.08, z0 - 0.08, 13, 3.4, z1 + 0.08, "weatherwood", { solid: false });
    for (const x of [-12, -8, -4, 4, 8, 12]) {
      m.box(x - 0.25, 0.55, z0, x + 0.25, 3.42, z1, "weatherwood", { solid: false });
      m.box(x - 0.48, 3.35, z0 - 0.06, x + 0.48, 3.6, z1 + 0.06, "driftwood", { solid: false });
    }
    for (const x of [-10, -6, 6, 10]) {
      m.box(x - 0.8, 1.58, z0 - 0.05, x + 0.8, 2.48, z1 + 0.05, "weatherwood", { solid: false });
      m.box(x - 0.92, 2.48, z0 - 0.09, x + 0.92, 2.67, z1 + 0.09, "driftwood", { solid: false });
    }
  }
  // A broken ridge leaves the shield visible and room to cross the roof.
  m.box(-11, 4, -1, -2, 4.75, 1, "turf");
  m.box(2, 4, -1, 11, 4.75, 1, "turf");
  m.box(-5, 0, -1.2, 5, 1.2, 1.2, "fieldstone");
  m.box(-1.2, 1.2, -0.7, 1.2, 2.3, 0.7, "fieldstone");
  // A protected roof route is reachable by gable-side staircases.
  m.stairs("-x", 19, -2, 1.2, 10, "driftwood", { rise: 0.4, run: 0.55 });
  m.stairs("+x", -19, -1.2, 2, 10, "driftwood", { rise: 0.4, run: 0.55 });
  m.pickup("shield", 0, 4, 0);
  m.sym2(() => {
    // North camp: paired turf stores give sheltered fights behind the base.
    m.box(-25, 0, -19, -18, 3.2, -18.5, "fieldstone");
    m.box(-25, 0, -19, -24.5, 3.2, -11.5, "fieldstone");
    m.box(-25.3, 3.2, -19.3, -17.7, 3.7, -11.2, "turf");
    m.box(18, 0, -19, 25, 2.8, -18.5, "weatherwood");
    m.box(24.5, 0, -19, 25, 2.8, -11, "weatherwood");
    m.box(17.7, 2.8, -19.3, 25.3, 3.2, -10.7, "turf");
    // Landing deck and fish-drying racks. Parallel rails leave wide passages.
    m.box(-30, 0, -9, -24, 0.4, -7.8, "driftwood");
    m.box(-30, 0, -4, -24, 0.4, -2.8, "driftwood");
    m.box(20, 0, -8, 20.5, 2, -3, "weatherwood");
    m.box(24, 0, -8, 24.5, 2, -3, "weatherwood");
    m.box(20, 2, -8, 24.5, 2.3, -7.5, "driftwood");
    m.box(-17, 0, -12, -14, 1.5, -10, "fieldstone");
    m.box(11, 0, -14, 14, 1.5, -12, "fieldstone");
    m.box(-7, 0, -15, -4.5, 1.2, -13, "weatherwood");
    m.box(4, 0, -12, 6.5, 1.2, -10, "weatherwood");
    m.nest(1, 0, 0, -22.5);
    for (const [x, z] of [[-9, -22], [-4, -23], [4, -23], [9, -22], [-9, -18], [9, -18]]) m.spawn(x, 0, z, PI, 1);
    for (const [x, z, yaw] of [[-28, -15, PI / 2], [28, -15, -PI / 2], [-20, -4, PI / 2], [22, -1, -PI / 2]]) m.spawn(x, 0, z, yaw, 0);
    m.pickup("hp", -20, 0, -9);
    m.pickup("ammo", 17, 0, -9);
    m.pickup("hp", 0, 0, -11);
  });
  return m.build();
}

// ------------------------------------------------------------- Forest Causeway
export function forestCauseway() {
  const m = new MapBuilder({
    id: "forest_causeway", name: "Forest Causeway",
    desc: "A raised red-stone road cuts through rainforest, with open canopy trails on both sides.",
    modes: ALL,
    bounds: { min: [-32, -10, -32], max: [32, 30, 32] },
    palette: {
      sky: "#497665", skyHorizon: "#a8c8a6", fog: "#9abda2", fogNear: 26, fogFar: 105,
      ambient: "#d4ebce", ambientIntensity: 0.68, hemiGround: "#375943",
      sun: "#f3e9bc", sunIntensity: 0.95, sunDir: [-0.25, -1, 0.65],
    },
    materials: {
      jungleFloor: { color: "#526744", rough: 1 },
      laterite: { color: "#a65f45", rough: 1 },
      wetStone: { color: "#6c7965", rough: 1 },
      leaf: { color: "#376b46", rough: 1 },
      leafLight: { color: "#58895a", rough: 1 },
      bark: { color: "#695741", rough: 1 },
      silt: { color: "#8c8765", rough: 1 },
    },
  });
  ground(m, 32, 32, "jungleFloor");
  edgeWalls(m, 32, 32, "wetStone");
  // A raised road screens the bases, while offset breaks in its retaining
  // walls create a sheltered, winding passage under the deck. The forest
  // trails still round either end of the road.
  m.box(-4.5, 0, -16, -3.3, 3, -8, "laterite");
  m.box(-4.5, 0, -5, -3.3, 3, 16, "laterite");
  m.box(3.3, 0, -16, 4.5, 3, 5, "laterite");
  m.box(3.3, 0, 8, 4.5, 3, 16, "laterite");
  m.box(-4.5, 2.55, -16, 4.5, 3, 16, "laterite");
  m.stairs("+x", -10, -2.5, 2.5, 12, "wetStone", { rise: 0.25, run: 0.5 });
  m.stairs("-x", 10, -2.5, 2.5, 12, "wetStone", { rise: 0.25, run: 0.5 });
  // The walls carry staggered courses, square stone braces, and climbing
  // foliage. Braces skip the passage openings; relief stays visual.
  for (const face of [-1, 1]) {
    const x0 = face < 0 ? -4.8 : 4.52, x1 = x0 + 0.28;
    for (const z of [-13, -9, -5, 5, 9, 13]) {
      if ((face < 0 && z === -5) || (face > 0 && z === 5)) continue;
      m.box(x0 - 0.06, 0, z - 0.67, x1 + 0.06, 2.65, z + 0.67, "wetStone", { solid: false });
      m.box(x0 - 0.12, 2.62, z - 0.85, x1 + 0.12, 2.9, z + 0.85, "laterite", { solid: false });
    }
    for (const z of [-11, -3, 3, 11]) {
      m.box(x0, 1.1, z - 1.8, x1, 1.32, z + 1.8, "wetStone", { solid: false });
      m.box(x0 - 0.1, 2.7, z - 0.4, x1 + 0.1, 3.4, z + 0.4, "leaf", { solid: false });
    }
  }
  for (const z of [-12, -6, 6, 12]) {
    m.box(-4, 3, z - 0.2, -3.4, 3.8, z + 0.2, "wetStone");
    m.box(3.4, 3, z - 0.2, 4, 3.8, z + 0.2, "wetStone");
  }
  m.pickup("shield", 0, 3, 0);
  m.sym2(() => {
    // Clearings and shallow rain channels frame the main lanes.
    m.box(-30, 0, -19, -6, 0.03, -16.5, "silt", { solid: false });
    m.box(-30, 0, 16.5, -6, 0.03, 19, "silt", { solid: false });
    m.box(-28, 0, -11, -12, 0.025, -8, "silt", { solid: false });
    m.box(-28, 0, 8, -12, 0.025, 11, "silt", { solid: false });
    // Incomplete stone platforms mark an old road without recreating a site.
    m.box(-23, 0, -15, -18, 1.3, -12, "laterite");
    m.box(-23, 1.3, -15, -20, 2.2, -13.5, "wetStone");
    m.box(-19, 0, 12, -14, 1.1, 15, "laterite");
    m.box(-13, 0, -6, -11, 2.2, -3.5, "wetStone");
    m.box(-16, 0, 4.5, -13.5, 1.6, 6.5, "wetStone");
    for (const [x, z, h] of [[-27, -28, 6], [-15, -25, 5.5], [-28, -2, 6.5], [-24, 24, 5.8], [-13, 27, 5.2]]) {
      m.box(x - 0.6, 0, z - 0.6, x + 0.6, h, z + 0.6, "bark");
      m.box(x - 2.3, h - 0.2, z - 2.3, x + 2.3, h + 1.1, z + 2.3, "leaf", { solid: false });
      m.box(x - 1.7, h + 1.1, z - 1.7, x + 1.7, h + 1.8, z + 1.7, "leafLight", { solid: false });
    }
    m.nest(1, -27, 0, 0);
    for (const [x, z] of [[-27, -9], [-27, -4], [-27, 4], [-27, 9], [-22, -7], [-22, 7]]) m.spawn(x, 0, z, -PI / 2, 1);
    for (const [x, z, yaw] of [[-26, -21, 0], [-17, -18, PI / 2], [-14, 0, -PI / 2], [-24, 19, PI]]) m.spawn(x, 0, z, yaw, 0);
    m.pickup("hp", -27, 0, -15);
    m.pickup("ammo", -16, 0, 19);
    m.pickup("hp", -12, 0, -11);
  });
  return m.build();
}

// ------------------------------------------------------------- Monolith Gardens
export function monolithGardens() {
  const m = new MapBuilder({
    id: "monolith_gardens", name: "Monolith Gardens",
    desc: "A climbable rock garden rises above mirrored water rills, terraces, and flowering courtyards.",
    modes: ALL,
    bounds: { min: [-32, -10, -30], max: [32, 30, 30] },
    palette: {
      sky: "#a8d6d4", skyHorizon: "#f2d9aa", fog: "#d3d4bd", fogNear: 38, fogFar: 125,
      ambient: "#ecf4df", ambientIntensity: 0.65, hemiGround: "#678b68",
      sun: "#fff0c7", sunIntensity: 1.2, sunDir: [0.7, -1, -0.25],
    },
    materials: {
      gardenSoil: { color: "#75865e", rough: 1 },
      granite: { color: "#7b786d", rough: 1 },
      paleStone: { color: "#c5b397", rough: 1 },
      lotusWater: { color: "#79b8b0", rough: 0.25 },
      flowering: { color: "#d384a2", rough: 1 },
      foliage: { color: "#4a815f", rough: 1 },
      timber: { color: "#82634a", rough: 0.95 },
    },
  });
  ground(m, 32, 30, "gardenSoil");
  edgeWalls(m, 32, 30, "paleStone");
  // Broad rock summit is a contested third lane between north and south
  // garden routes. Side stairways climb from both home approaches.
  m.box(-11, 0, -9, 11, 5, 9, "granite");
  m.stairs("+x", -18, -2.2, 2.2, 10, "paleStone", { rise: 0.5, run: 0.7 });
  m.stairs("-x", 18, -2.2, 2.2, 10, "paleStone", { rise: 0.5, run: 0.7 });
  // Narrow ledges and discontinuous strata make the mass read as layered
  // exposed rock instead of a flat cube, without changing its collision.
  for (const face of [-1, 1]) {
    const x0 = face < 0 ? -11.38 : 11.02, x1 = x0 + 0.36;
    for (const [z0, z1, y0, y1] of [
      [-8.8, -5.7, 0.5, 1.05], [-5.1, -2.8, 2.2, 2.65],
      [2.8, 5.2, 1.25, 1.7], [5.9, 8.9, 3.35, 3.85],
    ]) m.box(x0, y0, z0, x1, y1, z1, "paleStone", { solid: false });
    for (const z of [-7, -3.5, 3.5, 7]) {
      m.box(x0 - 0.05, 4.1, z - 0.9, x1 + 0.05, 4.45, z + 0.9, "granite", { solid: false });
      m.box(x0 - 0.08, 4.45, z - 0.45, x1 + 0.08, 4.74, z + 0.45, "foliage", { solid: false });
    }
  }
  for (const z of [-9.22, 9.02]) for (const x of [-8, -3, 3, 8]) {
    m.box(x - 1, 1.85, z, x + 1, 2.18, z + 0.2, "paleStone", { solid: false });
    m.box(x - 0.6, 3.45, z, x + 0.6, 3.74, z + 0.2, "foliage", { solid: false });
  }
  m.box(-5, 5, -8, 5, 5.6, -7.4, "paleStone");
  m.box(-5, 5, 7.4, 5, 5.6, 8, "paleStone");
  m.pickup("shield", 0, 5, 0);
  m.sym2(() => {
    // Flat water channels are decorative; every courtyard remains walkable.
    m.box(-30, 0, -24, -14, 0.04, -21, "lotusWater", { solid: false });
    m.box(-30, 0, 21, -14, 0.04, 24, "lotusWater", { solid: false });
    m.box(-30, 0, -24.5, -14, 0.35, -24, "paleStone");
    m.box(-30, 0, -21, -14, 0.35, -20.5, "paleStone");
    m.box(-30, 0, 20.5, -14, 0.35, 21, "paleStone");
    m.box(-30, 0, 24, -14, 0.35, 24.5, "paleStone");
    // Planters and arbor posts set a rhythm through the side routes.
    m.box(-22, 0, -15, -18, 1.1, -12, "paleStone");
    m.box(-21.5, 1.1, -14.6, -18.5, 1.35, -12.4, "flowering", { solid: false });
    m.box(-22, 0, 12, -18, 1.1, 15, "paleStone");
    m.box(-21.5, 1.1, 12.4, -18.5, 1.35, 14.6, "foliage", { solid: false });
    m.box(-15, 0, -19, -14.4, 3.5, -16, "timber");
    m.box(-15, 0, 16, -14.4, 3.5, 19, "timber");
    m.box(-15, 3.5, -19, -14.4, 3.9, 19, "timber", { solid: false });
    m.box(-14.3, 0, -6.5, -12.5, 1.5, -4.5, "granite");
    m.box(-14.3, 0, 4.5, -12.5, 1.5, 6.5, "granite");
    m.box(-27, 0, -18, -25, 1.4, -16, "paleStone");
    m.box(-27, 0, 16, -25, 1.4, 18, "paleStone");
    m.nest(1, -27, 0, 0);
    for (const [x, z] of [[-27, -9], [-27, -4], [-27, 4], [-27, 9], [-22, -7], [-22, 7]]) m.spawn(x, 0, z, -PI / 2, 1);
    for (const [x, z, yaw] of [[-26, -27, PI / 2], [-19, -10, 0], [-16, 11, PI], [-25, 27, -PI / 2]]) m.spawn(x, 0, z, yaw, 0);
    m.pickup("hp", -24, 0, -18);
    m.pickup("ammo", -24, 0, 18);
    m.pickup("hp", -15, 0, -11);
  });
  return m.build();
}

// --------------------------------------------------------------- Volcanic Coast
export function volcanicCoast() {
  const m = new MapBuilder({
    id: "volcanic_coast", name: "Volcanic Coast",
    desc: "A basalt terrace between a sea shelf and an inland quarry, with black-stone columns for cover.",
    modes: ALL,
    bounds: { min: [-33, -10, -33], max: [33, 30, 33] },
    palette: {
      sky: "#89abb5", skyHorizon: "#dfb99f", fog: "#b6aead", fogNear: 35, fogFar: 120,
      ambient: "#d9e2e3", ambientIntensity: 0.62, hemiGround: "#4c4844",
      sun: "#f5d6af", sunIntensity: 1.2, sunDir: [-0.5, -1, -0.3],
    },
    materials: {
      ash: { color: "#54504e", rough: 1 },
      basalt: { color: "#343d42", rough: 1 },
      redScoria: { color: "#80564d", rough: 1 },
      pumice: { color: "#99958a", rough: 1 },
      tideWater: { color: "#5a98a4", rough: 0.25 },
      beach: { color: "#a0987f", rough: 1 },
      lichen: { color: "#8a9f75", rough: 1 },
    },
  });
  ground(m, 33, 33, "ash");
  edgeWalls(m, 33, 33, "basalt");
  m.box(-32.5, 0, -32.5, -27, 0.035, 32.5, "beach", { solid: false });
  m.box(-32.3, 0.04, -32.3, -30, 0.06, 32.3, "tideWater", { solid: false });
  // A rectangular lava shelf screens opposite spawns. Players can climb it
  // or route along either side between tide pools and the quarry.
  m.box(-15, 0, -7, 15, 4, 7, "basalt");
  m.stairs("+z", -13, -9, -5, 12, "pumice", { rise: 1 / 3, run: 0.5 });
  m.stairs("-z", 13, 5, 9, 12, "pumice", { rise: 1 / 3, run: 0.5 });
  // Broken basalt columns and mineral bands make the shelf's long walls
  // feel like a quarried volcanic outcrop. The relief has no collision.
  for (const face of [-1, 1]) {
    const z0 = face < 0 ? -7.35 : 7.02, z1 = z0 + 0.33;
    for (const x of [-13.5, -10, -3.5, 0, 3.5, 10, 13.5]) {
      const h = 2.5 + (Math.abs(x) % 3) * 0.45;
      m.box(x - 0.52, 0, z0, x + 0.52, h, z1, "basalt", { solid: false });
      m.box(x - 0.66, h, z0 - 0.07, x + 0.66, h + 0.23, z1 + 0.07, "pumice", { solid: false });
    }
    for (const [a, b] of [[-14.6, -3.8], [-3.1, 3.1], [3.8, 14.6]]) {
      m.box(a, 1.12, z0 - 0.05, b, 1.4, z1 + 0.05, "redScoria", { solid: false });
      m.box(a, 2.85, z0 - 0.04, b, 3.05, z1 + 0.04, "pumice", { solid: false });
    }
  }
  for (const [x, w, h] of [[-13, 1.7, 0.45], [-4, 2.4, 0.7], [7, 1.5, 0.5], [12, 1.8, 0.85]]) {
    m.box(x - w / 2, 4, -6.7, x + w / 2, 4 + h, -5.9, "basalt");
    m.box(-x - w / 2, 4, 5.9, -x + w / 2, 4 + h, 6.7, "basalt");
  }
  // The opposing stair placements create an S-shaped summit fight.
  m.box(-3, 4, -1.5, -1.8, 5.2, 1.5, "redScoria");
  m.box(1.8, 4, -1.5, 3, 5.2, 1.5, "redScoria");
  m.pickup("shield", 0, 4, 0);
  m.sym2(() => {
    m.box(-28, 0, -22, -17, 0.03, -18, "beach", { solid: false });
    m.box(17, 0, -23, 28, 0.03, -20, "redScoria", { solid: false });
    // Column garden near the west coast, stacked quarry blocks east.
    for (const [x, z, h] of [[-25, -14, 3.5], [-21, -8, 2.5], [-23, -2, 4.4], [-18, -20, 2.1], [23, -15, 4], [20, -4, 3]]) {
      m.box(x - 0.7, 0, z - 0.7, x + 0.7, h, z + 0.7, "basalt");
      m.box(x - 0.9, h, z - 0.9, x + 0.9, h + 0.3, z + 0.9, "lichen", { solid: false });
    }
    m.box(17, 0, -10, 22, 1.1, -8, "pumice");
    m.box(19, 1.1, -10, 22, 2.2, -8, "basalt");
    m.box(24, 0, -8, 28, 1.1, -6, "pumice");
    m.box(-13, 0, -19, -11, 1.5, -16, "redScoria");
    m.box(10, 0, -18, 12.5, 1.5, -15, "redScoria");
    m.box(-24, 0, 7, -17, 1.2, 8.2, "basalt");
    m.box(17, 0, 8, 24, 1.2, 9.2, "basalt");
    m.nest(1, 0, 0, -29);
    for (const [x, z] of [[-11, -28], [-5, -29], [5, -29], [11, -28], [-9, -23], [9, -23]]) m.spawn(x, 0, z, PI, 1);
    for (const [x, z, yaw] of [[-29, -24, PI / 2], [28, -25, -PI / 2], [-19, -5, PI / 2], [26, -2, -PI / 2]]) m.spawn(x, 0, z, yaw, 0);
    m.pickup("hp", -26, 0, -9);
    m.pickup("ammo", 26, 0, -12);
    m.pickup("hp", 0, 0, -17);
  });
  return m.build();
}

// ------------------------------------------------------------------- Coral Port
export function coralPort() {
  const m = new MapBuilder({
    id: "coral_port", name: "Coral Port",
    desc: "A coral-stone trade port has a roof route above its storehouse, markets to one side, and quays to the other.",
    modes: ALL,
    bounds: { min: [-32, -10, -28], max: [32, 30, 28] },
    palette: {
      sky: "#88c7d7", skyHorizon: "#f5d9ab", fog: "#c7d8d4", fogNear: 40, fogFar: 128,
      ambient: "#fff0d8", ambientIntensity: 0.65, hemiGround: "#b9aa85",
      sun: "#fff2cc", sunIntensity: 1.25, sunDir: [0.55, -1, 0.3],
    },
    materials: {
      coralSand: { color: "#c6b890", rough: 1 },
      coralStone: { color: "#e1d6bc", rough: 1 },
      limestone: { color: "#bba98d", rough: 1 },
      blueWater: { color: "#60b7c2", rough: 0.25 },
      harborWood: { color: "#8c684c", rough: 0.9 },
      sailcloth: { color: "#f4e4c7", rough: 0.85 },
      spiceRed: { color: "#bd6754", rough: 1 },
      turquoise: { color: "#488e98", rough: 0.7 },
    },
  });
  ground(m, 32, 28, "coralSand");
  edgeWalls(m, 32, 28, "coralStone");
  m.box(26, 0, -27.5, 31.5, 0.04, 27.5, "blueWater", { solid: false });
  // Opposing walls of the storehouse prevent direct base-to-base fire;
  // its open ends, roof, market lane, and quay lane all remain playable.
  m.box(-14, 0, -5, 14, 4, -4.5, "coralStone");
  m.box(-14, 0, 4.5, 14, 4, 5, "coralStone");
  m.box(-14.5, 4, -5.5, 14.5, 4.5, 5.5, "limestone");
  // Regular carved piers and bright shutter panels give the long storehouse
  // a recognizable port facade. They sit entirely outside collision space.
  for (const face of [-1, 1]) {
    const z0 = face < 0 ? -5.35 : 5.03, z1 = z0 + 0.3;
    m.box(-14, 0.25, z0 - 0.08, 14, 0.72, z1 + 0.08, "limestone", { solid: false });
    m.box(-14, 3.55, z0 - 0.1, 14, 3.87, z1 + 0.1, "limestone", { solid: false });
    for (const x of [-12, -8, -4, 0, 4, 8, 12]) {
      m.box(x - 0.38, 0.65, z0, x + 0.38, 3.55, z1, "limestone", { solid: false });
      m.box(x - 0.62, 3.3, z0 - 0.05, x + 0.62, 3.55, z1 + 0.05, "coralStone", { solid: false });
    }
    for (const [x, color] of [[-10, "turquoise"], [-6, "spiceRed"], [-2, "turquoise"], [2, "turquoise"], [6, "spiceRed"], [10, "turquoise"]]) {
      m.box(x - 1.15, 1.35, z0 - 0.05, x + 1.15, 2.62, z1 + 0.05, color, { solid: false });
      m.box(x - 1.35, 2.62, z0 - 0.1, x + 1.35, 2.87, z1 + 0.1, "coralStone", { solid: false });
    }
  }
  for (const x of [-12, -8, -4, 0, 4, 8, 12]) {
    m.box(x - 0.45, 4.5, -5.4, x + 0.45, 5.08, -4.7, "coralStone");
    m.box(x - 0.45, 4.5, 4.7, x + 0.45, 5.08, 5.4, "coralStone");
  }
  m.box(-2, 0, -1.2, 2, 2, 1.2, "harborWood");
  m.stairs("-x", 19.9, -2, 1, 9, "coralStone", { rise: 0.5, run: 0.6 });
  m.stairs("+x", -19.9, -1, 2, 9, "coralStone", { rise: 0.5, run: 0.6 });
  m.pickup("shield", 0, 4.5, 0);
  m.sym2(() => {
    // Covered arcade on the market side; its roof is purely scenery.
    m.box(-25, 0, -21, -24.5, 3.1, -13, "coralStone");
    m.box(-18, 0, -21, -17.5, 3.1, -13, "coralStone");
    m.box(-25, 3.1, -21, -17.5, 3.5, -13, "sailcloth", { solid: false });
    m.box(-23, 0, -17, -20, 1.1, -15, "spiceRed");
    m.box(-25, 0, -9, -20, 1.4, -7, "harborWood");
    m.box(-23.5, 1.4, -9, -21.5, 2.4, -7, "turquoise");
    // Quay edge, mooring posts, and cargo stacks on the sea side.
    m.box(18, 0, -19, 25, 0.5, -17.5, "harborWood");
    m.box(18, 0, -9, 25, 0.5, -7.5, "harborWood");
    m.box(24, 0, -20, 24.6, 2.3, -19.4, "harborWood");
    m.box(24, 0, -8, 24.6, 2.3, -7.4, "harborWood");
    m.box(17, 0, -13, 20, 1.4, -10, "harborWood");
    m.box(19, 1.4, -12, 21, 2.6, -10, "limestone");
    m.box(-10, 0, -13, -7, 1.5, -11, "limestone");
    m.box(7, 0, -16, 10, 1.5, -14, "spiceRed");
    m.box(-4, 0, -11, -2, 1.2, -9, "harborWood");
    m.box(2, 0, -12, 4, 1.2, -10, "harborWood");
    m.nest(1, 0, 0, -24);
    for (const [x, z] of [[-10, -23], [-5, -24], [5, -24], [10, -23], [-8, -19], [8, -19]]) m.spawn(x, 0, z, PI, 1);
    for (const [x, z, yaw] of [[-28, -11, PI / 2], [22, -13, -PI / 2], [-20, -4, PI / 2], [22, -3, -PI / 2]]) m.spawn(x, 0, z, yaw, 0);
    m.pickup("hp", -27, 0, -8);
    m.pickup("ammo", 23, 0, -11);
    m.pickup("hp", 0, 0, -8);
  });
  return m.build();
}

export const WORLD_MAPS = [highlandCaravan, atlanticOutpost, forestCauseway, monolithGardens, volcanicCoast, coralPort];
