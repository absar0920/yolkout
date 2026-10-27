// Original arenas informed by historic building materials and landscapes.
// Coordinates are Y-up; a character stands at y=0 on the main walking floor.
import { MapBuilder } from "./lib.mjs";

const PI = Math.PI;
const ALL = ["ffa", "teams", "nest"];

// A dry-stone court with four open approaches, broken arc walls and a central marker.
export function graniteRing() {
  const m = new MapBuilder({
    id: "granite_ring", name: "Granite Ring",
    desc: "A sunlit dry-stone court: enter through the broken ring or circle its outer paths.",
    modes: ALL, bounds: { min: [-30, -8, -30], max: [30, 20, 30] },
    palette: {
      sky: "#a9d7e3", skyHorizon: "#efe0bb", fog: "#d6d0b6", fogNear: 35, fogFar: 112,
      ambient: "#fff6e5", ambientIntensity: 0.65, hemiGround: "#877b58",
      sun: "#ffe2a9", sunIntensity: 1.2, sunDir: [-0.55, -1, 0.25],
    },
    materials: {
      ochre_dirt: { color: "#b39b72", rough: 1 },
      granite_stone: { color: "#827d6e", rough: 1 },
      pale_granite: { color: "#b4aa8d", rough: 1 },
      mossy_stone: { color: "#777d63", rough: 1 },
      dry_grass: { color: "#b5aa66", rough: 1 },
    },
  });
  m.box(-30, -1, -30, 30, 0, 30, "ochre_dirt");
  // Dry-stone boundary stands just inside the implicit collision limit.
  for (const x of [-30, 29.2]) {
    m.box(x, 0, -30, x + 0.8, 2.8, 30, "granite_stone");
    m.box(x, 2.8, -30, x + 0.8, 3.12, 30, "pale_granite");
    const face = x < 0 ? x + 0.8 : x;
    for (const y of [0.9, 1.95])
      m.box(face - 0.06, y, -30, face + 0.06, y + 0.18, 30, "pale_granite", { solid: false });
  }
  for (const z of [-30, 29.2]) {
    m.box(-30, 0, z, 30, 2.8, z + 0.8, "granite_stone");
    m.box(-30, 2.8, z, 30, 3.12, z + 0.8, "pale_granite");
    const face = z < 0 ? z + 0.8 : z;
    for (const y of [0.9, 1.95])
      m.box(-30, y, face - 0.06, 30, y + 0.18, face + 0.06, "pale_granite", { solid: false });
  }
  for (const z of [-25, 25]) m.box(-30, 0.01, z - 1, 30, 0.03, z + 1, "dry_grass", { solid: false });
  // Four broken arcs leave a broad gate on each side of the court.
  for (const x of [-11, 10]) for (const [z0, z1] of [[-11, -3], [3, 11]]) {
    m.box(x, 0, z0, x + 1, 3.2, z1, "granite_stone");
    m.box(x - 0.13, 3.2, z0, x + 1.13, 3.42, z1, "pale_granite");
  }
  for (const z of [-11, 10]) for (const [x0, x1] of [[-11, -3], [3, 11]]) {
    m.box(x0, 0, z, x1, 3.2, z + 1, "granite_stone");
    m.box(x0, 3.2, z - 0.13, x1, 3.42, z + 1.13, "pale_granite");
  }
  // Uneven courses and a broken sightline in the otherwise open court.
  m.box(-2.5, 0, -2, 2.5, 3.8, 2, "mossy_stone");
  m.box(-1.8, 3.8, -1.4, 1.8, 4.4, 1.4, "pale_granite");
  for (const y of [0.95, 2.05])
    m.box(-2.57, y, -2.07, 2.57, y + 0.2, 2.07, "pale_granite", { solid: false });
  m.box(-5, 0, 6, -3, 1.1, 8, "pale_granite");
  m.box(3, 0, -8, 5, 1.1, -6, "pale_granite");
  m.sym2(() => {
    // The screened team court has two exits, north and south. It conceals spawns.
    m.box(-19, 0, -12, -18, 3.8, 12, "granite_stone");
    m.box(-18.06, 1.25, -12, -17.94, 1.45, 12, "pale_granite", { solid: false });
    m.box(-27, 0, -13, -19, 1.2, -12, "pale_granite");
    m.box(-27, 0, 12, -19, 1.2, 13, "pale_granite");
    m.box(-22, 0, -22, -18, 2.4, -19, "mossy_stone");
    m.box(-16, 0, 17, -12, 1.3, 19, "granite_stone");
    m.box(-16, 0, -18, -13, 1.1, -16, "pale_granite");
    m.box(-6, 0, 17, -4, 2.5, 20, "granite_stone");
    m.box(-6.2, 2.5, 16.8, -3.8, 2.8, 20.2, "pale_granite");
    m.box(-28, 0, 17, -26, 1.6, 19, "mossy_stone");
    m.box(-24, 0, -25, -22, 2.1, -23, "mossy_stone");
    for (const [x, z] of [[-27, -9], [-27, -2], [-27, 5], [-23, -7], [-23, 0], [-23, 8]])
      m.spawn(x, 0, z, -PI / 2, 1);
    m.nest(1, -25, 0, 0);
    m.spawn(-14, 0, 0, -PI / 2, 0);
    m.spawn(-8, 0, -17, PI / 2, 0);
    m.pickup("hp", -23, 0, 18);
    m.pickup("ammo", -13, 0, -23);
  });
  m.pickup("shield", 0, 0, 7);
  return m.build();
}

// A high mesa divides the arena; paths pass around both ends and over the crest.
export function mesaAlcove() {
  const m = new MapBuilder({
    id: "mesa_alcove", name: "Mesa Alcove",
    desc: "A sandstone ridge, sheltered shelves and two canyon bypasses beneath a wide desert sky.",
    modes: ALL, bounds: { min: [-32, -8, -26], max: [32, 22, 26] },
    palette: {
      sky: "#6fb4e9", skyHorizon: "#f6cf9b", fog: "#d6b78e", fogNear: 42, fogFar: 124,
      ambient: "#ffe9d1", ambientIntensity: 0.62, hemiGround: "#9a6d50",
      sun: "#fff0c9", sunIntensity: 1.3, sunDir: [0.6, -1, -0.35],
    },
    materials: {
      red_sand: { color: "#b87e5b", rough: 1 },
      sandstone_cliff: { color: "#c9956d", rough: 1 },
      sandstone_strata: { color: "#e3ae7e", rough: 1 },
      shaded_rock: { color: "#926d59", rough: 1 },
      turquoise_paint: { color: "#67afb0", rough: 0.8 },
    },
  });
  m.box(-32, -1, -26, 32, 0, 26, "red_sand");
  // Tall canyon rims make the play bounds visible from every approach.
  for (const x of [-32, 30.9]) {
    m.box(x, 0, -26, x + 1.1, 6.2, 26, "sandstone_cliff");
    const face = x < 0 ? x + 1.1 : x;
    for (const y of [1.35, 3.05, 4.8])
      m.box(face - 0.08, y, -26, face + 0.08, y + 0.25, 26, "sandstone_strata", { solid: false });
    for (const z of [-23, -9, 6, 19])
      m.box(x, 6.2, z, x + 1.1, 7.2, z + 3, "shaded_rock");
  }
  for (const z of [-26, 24.9]) {
    m.box(-32, 0, z, 32, 6.2, z + 1.1, "sandstone_cliff");
    const face = z < 0 ? z + 1.1 : z;
    for (const y of [1.35, 3.05, 4.8])
      m.box(-32, y, face - 0.08, 32, y + 0.25, face + 0.08, "sandstone_strata", { solid: false });
  }
  // Wide enough for a duel on top, tall enough to hide both team approaches.
  m.box(-4, 0, -18, 4, 4, 18, "sandstone_cliff");
  m.box(-3.5, 4, -18, 3.5, 4.6, -13, "sandstone_strata");
  m.box(-3.5, 4, 13, 3.5, 4.6, 18, "sandstone_strata");
  m.box(-1.2, 4, -12, 1.2, 5.4, -10, "shaded_rock");
  m.box(-1.2, 4, 10, 1.2, 5.4, 12, "shaded_rock");
  for (const y of [1.1, 2.25, 3.35]) for (const x of [-4.06, 4.01])
    m.box(x, y, -18, x + 0.05, y + 0.16, 18, "sandstone_strata", { solid: false });
  for (const y of [1.1, 2.25, 3.35]) for (const z of [-18.06, 18.01])
    m.box(-4, y, z, 4, y + 0.16, z + 0.05, "sandstone_strata", { solid: false });
  m.sym2(() => {
    // Offset stairways make an elevated middle route. Their final step meets the crest.
    m.stairs("+x", -10, -2.5, -0.5, 8, "sandstone_strata", { rise: 0.5, run: 0.75 });
    // Open-front shelves suggest cliff alcoves without enclosing an objective.
    m.box(-18, 0, -14, -12, 1.5, -9, "sandstone_cliff");
    m.stairs("+x", -19.8, -13.5, -11.5, 3, "sandstone_strata");
    m.box(-18, 1.5, -14, -17.5, 4.5, -9, "shaded_rock");
    m.box(-18, 4.5, -14, -12, 5, -9, "sandstone_cliff");
    m.box(-18.1, 2.2, -12.6, -18.04, 3.3, -10.5, "turquoise_paint", { solid: false });
    m.box(-17.4, 1.5, -13.5, -15.4, 1.75, -12.8, "sandstone_strata");
    m.box(-14.8, 1.5, -10.2, -12.8, 1.8, -9.5, "sandstone_strata");
    m.box(-30, 0, -23, -28.8, 5.5, -16, "shaded_rock");
    m.box(-29.7, 5.5, -22.5, -29.1, 6.2, -20.3, "sandstone_strata");
    m.box(-22, 0, 14, -19, 1.2, 17, "sandstone_strata");
    m.box(-15, 0, 7, -13, 2.4, 10, "shaded_rock");
    m.box(-13.2, 0, -22, -11.5, 1.5, -20.4, "sandstone_cliff");
    m.box(-8.5, 0, 9, -7, 2, 10.5, "shaded_rock");
    for (const [x, z] of [[-27, -9], [-27, -3], [-27, 3], [-27, 9], [-23, -7], [-23, 7]])
      m.spawn(x, 0, z, -PI / 2, 1);
    m.nest(1, -27, 0, 0);
    m.spawn(-12, 0, 17, -PI / 2, 0);
    m.spawn(-16, 0, 0, -PI / 2, 0);
    m.pickup("hp", -19, 0, 20);
    m.pickup("ammo", -11, 0, -18);
  });
  m.pickup("shield", 0, 4, 0);
  return m.build();
}

// A street grid around an open forum, with scorched homes and roofless courtyards.
export function ashQuarter() {
  const m = new MapBuilder({
    id: "ash_quarter", name: "Ash Quarter",
    desc: "Roofless courtyards and charcoal streets lead to a columned square.",
    modes: ALL, bounds: { min: [-30, -8, -30], max: [30, 18, 30] },
    palette: {
      sky: "#b8c0c0", skyHorizon: "#dfc4ab", fog: "#b7aba1", fogNear: 31, fogFar: 99,
      ambient: "#efe8dd", ambientIntensity: 0.58, hemiGround: "#5c5752",
      sun: "#ffdfbd", sunIntensity: 1.05, sunDir: [-0.3, -1, 0.55],
    },
    materials: {
      ash_paving: { color: "#8d8580", rough: 1 },
      tuff_stone: { color: "#b4a18f", rough: 1 },
      charred_brick: { color: "#745e55", rough: 1 },
      red_terracotta: { color: "#b57156", rough: 0.95 },
      marble_stone: { color: "#d5c9b8", rough: 0.8 },
      soot_dirt: { color: "#55504b", rough: 1 },
    },
  });
  m.box(-30, -1, -30, 30, 0, 30, "ash_paving");
  // A continuous ruined foundation makes the boundary readable; taller piers
  // give its skyline the broken rhythm of a city wall.
  for (const x of [-30, 29.2]) {
    m.box(x, 0, -30, x + 0.8, 2.8, 30, "charred_brick");
    const face = x < 0 ? x + 0.8 : x;
    for (const y of [0.95, 1.9])
      m.box(face - 0.06, y, -30, face + 0.06, y + 0.18, 30, "red_terracotta", { solid: false });
    for (const z of [-24, -12, 0, 12, 24])
      m.box(x, 2.8, z, x + 0.8, 4.1, z + 1.2, "tuff_stone");
  }
  for (const z of [-30, 29.2]) {
    m.box(-30, 0, z, 30, 2.8, z + 0.8, "charred_brick");
    const face = z < 0 ? z + 0.8 : z;
    for (const y of [0.95, 1.9])
      m.box(-30, y, face - 0.06, 30, y + 0.18, face + 0.06, "red_terracotta", { solid: false });
    for (const x of [-24, -12, 0, 12, 24])
      m.box(x, 2.8, z, x + 1.2, 4.1, z + 0.8, "tuff_stone");
  }
  for (const x of [-18, 17]) m.box(x, 0.01, -30, x + 1, 0.03, 30, "soot_dirt", { solid: false });
  for (const z of [-1.8, 1.6]) m.box(-30, 0.01, z, 30, 0.03, z + 0.2, "charred_brick", { solid: false });
  m.box(-7, 0.01, -7, 7, 0.03, 7, "marble_stone", { solid: false });
  // The forum has four isolated columns, providing cover without sealing any lane.
  for (const x of [-5.5, 5.5]) for (const z of [-5.5, 5.5]) {
    m.box(x - 0.5, 0, z - 0.5, x + 0.5, 3.5, z + 0.5, "marble_stone");
    m.box(x - 0.7, 3.5, z - 0.7, x + 0.7, 3.9, z + 0.7, "tuff_stone");
  }
  m.box(-1.4, 0, -1.4, 1.4, 1.5, 1.4, "red_terracotta");
  m.box(-1.46, 0.85, -1.46, 1.46, 1.05, 1.46, "marble_stone", { solid: false });
  m.sym2(() => {
    // A single standing facade hides each team from its opponent's spawn.
    m.box(-19, 0, -12, -18, 3.8, 12, "charred_brick");
    for (const y of [1.1, 2.35])
      m.box(-18.06, y, -12, -17.94, y + 0.2, 12, "red_terracotta", { solid: false });
    m.box(-27, 0, -13, -19, 1.4, -12, "tuff_stone");
    m.box(-27, 0, 12, -19, 1.4, 13, "tuff_stone");
    // Broken houses create short perpendicular alleys and court entries.
    m.box(-16, 0, -23, -15.4, 3.5, -16, "tuff_stone");
    m.box(-16, 0, -23, -10, 3.5, -22.4, "charred_brick");
    m.box(-10.6, 0, -23, -10, 2.4, -19, "red_terracotta");
    m.box(-15, 0, 16, -14.4, 2.8, 23, "charred_brick");
    m.box(-15, 0, 22.4, -8, 3.2, 23, "tuff_stone");
    m.box(-8.6, 0, 19, -8, 1.5, 23, "red_terracotta");
    m.box(-11, 0, -7, -9, 1, -4, "red_terracotta");
    m.box(-11, 0, 8, -8, 1.2, 10, "charred_brick");
    m.box(-5, 0, -21, -3.8, 3.6, -19.8, "tuff_stone");
    m.box(-5.2, 3.6, -22, -3.6, 3.95, -19.6, "marble_stone");
    m.box(-18, 0, 19, -16.8, 2.1, 20.2, "tuff_stone");
    m.box(-7, 0, 11, -5.5, 0.65, 12.5, "charred_brick");
    m.box(-7, 0, -12.5, -5.5, 0.65, -11, "charred_brick");
    m.box(-17.5, 0.02, -25, -12, 0.04, -24, "red_terracotta", { solid: false });
    for (const [x, z] of [[-27, -7], [-27, 0], [-27, 7], [-23, -9], [-23, -2], [-23, 5]])
      m.spawn(x, 0, z, -PI / 2, 1);
    m.nest(1, -25, 0, 0);
    m.spawn(-8, 0, 0, PI / 2, 0);
    m.spawn(-5, 0, -17, 0, 0);
    m.pickup("hp", -13, 0, -9);
    m.pickup("ammo", -11, 0, 15);
  });
  m.pickup("shield", 0, 0, 5);
  return m.build();
}

// Brick compounds and shady trees frame a broad river margin and a central rise.
export function riverbendPlain() {
  const m = new MapBuilder({
    id: "riverbend_plain", name: "Riverbend Plain",
    desc: "Warm brick terraces and shady paths border a pale, winding river.",
    modes: ALL, bounds: { min: [-30, -8, -28], max: [30, 20, 28] },
    palette: {
      sky: "#a0cde8", skyHorizon: "#e8d2ad", fog: "#d4c7a9", fogNear: 40, fogFar: 118,
      ambient: "#fff2d9", ambientIntensity: 0.65, hemiGround: "#807550",
      sun: "#ffe2a2", sunIntensity: 1.2, sunDir: [0.4, -1, 0.5],
    },
    materials: {
      sandy_dirt: { color: "#bea77a", rough: 1 },
      river_water: { color: "#77aeb6", rough: 0.25 },
      laterite_brick: { color: "#a35e48", rough: 1 },
      warm_brick: { color: "#c88560", rough: 1 },
      pale_stone: { color: "#d2b994", rough: 1 },
      teak_wood: { color: "#805c42", rough: 0.9 },
      leaf_grass: { color: "#71916b", rough: 1 },
    },
  });
  m.box(-30, -1, -28, 30, 0, 28, "sandy_dirt");
  // A stepped earth bank and tree line close the horizon before the collision edge.
  for (const x of [-30, 29.1]) {
    m.box(x, 0, -28, x + 0.9, 2.6, 28, "sandy_dirt");
    m.box(x, 2.6, -28, x + 0.9, 2.85, 28, "leaf_grass");
    const shelf = x < 0 ? -29.1 : 28.4;
    m.box(shelf, 0, -28, shelf + 0.7, 0.5, 28, "pale_stone");
  }
  for (const z of [-28, 27.1]) {
    m.box(-30, 0, z, 30, 2.6, z + 0.9, "sandy_dirt");
    m.box(-30, 2.6, z, 30, 2.85, z + 0.9, "leaf_grass");
    const shelf = z < 0 ? -27.1 : 26.4;
    m.box(-30, 0, shelf, 30, 0.5, shelf + 0.7, "pale_stone");
  }
  for (const x of [-22, -12, -2, 8, 18]) for (const z of [-25.8, 25.8]) {
    m.box(x - 0.45, 0, z - 0.45, x + 0.45, 3.1, z + 0.45, "teak_wood");
    m.box(x - 1.8, 3.1, z - 1.6, x + 1.8, 4.4, z + 1.6, "leaf_grass", { solid: false });
  }
  // Shallow river scenery remains walkable, while the banks add a low step.
  m.box(-30, 0.01, 18, -7, 0.03, 24, "river_water", { solid: false });
  m.box(-7, 0.01, 20, 12, 0.03, 26, "river_water", { solid: false });
  m.box(12, 0.01, 17, 30, 0.03, 23, "river_water", { solid: false });
  m.box(-30, 0, 17.4, -7, 0.45, 18, "pale_stone");
  m.box(-7, 0, 19.4, 12, 0.45, 20, "pale_stone");
  m.box(12, 0, 16.4, 30, 0.45, 17, "pale_stone");
  m.box(-2, 0.04, 18, 2, 0.08, 26, "teak_wood", { solid: false });
  // The stepped brick marker is a navigable landmark only around its base.
  m.box(-5, 0, -5, 5, 2.3, 5, "laterite_brick");
  for (const y of [0.65, 1.75])
    m.box(-5.08, y, -5.08, 5.08, y + 0.16, 5.08, "warm_brick", { solid: false });
  m.box(-5.08, 1.1, -5.08, 5.08, 1.25, 5.08, "warm_brick", { solid: false });
  m.box(-3.7, 2.3, -3.7, 3.7, 3.2, 3.7, "warm_brick");
  m.box(-2.1, 3.2, -2.1, 2.1, 4.5, 2.1, "pale_stone");
  m.sym2(() => {
    m.stairs("+x", -8, -1.2, 1.2, 5, "warm_brick", { rise: 0.46, run: 0.6 });
    m.box(-19, 0, -12, -18, 3.6, 12, "laterite_brick");
    m.box(-18.07, 1.25, -12, -17.93, 1.5, 12, "warm_brick", { solid: false });
    m.box(-27, 0, -13, -19, 0.9, -12, "warm_brick");
    m.box(-27, 0, 12, -19, 0.9, 13, "warm_brick");
    // A roofed but open arcade and a small square court.
    for (const x of [-15, -10]) for (const z of [-14, -8])
      m.box(x - 0.4, 0, z - 0.4, x + 0.4, 3.2, z + 0.4, "laterite_brick");
    m.box(-16, 3.2, -15, -9, 3.7, -7, "teak_wood");
    m.box(-14, 0, 9, -13.2, 1.3, 14, "warm_brick");
    m.box(-14, 0, 13.2, -8, 1.3, 14, "warm_brick");
    m.box(-9, 0, 9, -8.2, 1.3, 12, "warm_brick");
    m.box(-12, 0, -5, -10.5, 1.1, -3.5, "warm_brick");
    m.box(-16, 0, 16, -14.5, 1.2, 17.5, "pale_stone");
    // Trees give the open plains pockets of soft cover and a green silhouette.
    for (const [x, z] of [[-8, -22], [-7, 14]]) {
      m.box(x - 0.5, 0, z - 0.5, x + 0.5, 3, z + 0.5, "teak_wood");
      m.box(x - 2.4, 3, z - 2.4, x + 2.4, 4.2, z + 2.4, "leaf_grass", { solid: false });
    }
    for (const [x, z] of [[-26, -8], [-26, -3], [-26, 3], [-26, 8], [-23, -6], [-23, 6]])
      m.spawn(x, 0, z, -PI / 2, 1);
    m.nest(1, -25, 0, 0);
    m.spawn(-8, 0, 3, -PI / 2, 0);
    m.spawn(-12, 0, -19, PI / 2, 0);
    m.pickup("hp", -11, 0, 5);
    m.pickup("ammo", -23, 0, 21);
  });
  m.pickup("shield", 0, 0, 10);
  return m.build();
}

// Low islands, three causeways and a central split wall make water a spatial feature.
export function basaltChannels() {
  const m = new MapBuilder({
    id: "basalt_channels", name: "Basalt Channels",
    desc: "Basalt islets and narrow causeways cross reflective, ankle-deep channels.",
    modes: ALL, bounds: { min: [-30, -8, -30], max: [30, 18, 30] },
    palette: {
      sky: "#7a9ead", skyHorizon: "#d0c8ad", fog: "#879da0", fogNear: 30, fogFar: 102,
      ambient: "#d8e9e6", ambientIntensity: 0.68, hemiGround: "#3f5754",
      sun: "#f8ddb0", sunIntensity: 0.95, sunDir: [-0.5, -1, -0.3],
    },
    materials: {
      channel_silt: { color: "#586d70", rough: 1 },
      channel_water: { color: "#5e9faa", rough: 0.2 },
      basalt_stone: { color: "#4a555b", rough: 1 },
      blue_basalt: { color: "#677981", rough: 1 },
      salt_rock: { color: "#afb4aa", rough: 1 },
      moss_grass: { color: "#7c9477", rough: 1 },
    },
  });
  m.box(-30, -2, -30, 30, -0.5, 30, "channel_silt");
  // Basalt seawalls rise from the channel floor at every map edge.
  for (const x of [-30, 29.2]) {
    m.box(x, -1.5, -30, x + 0.8, 3, 30, "basalt_stone");
    m.box(x, 3, -30, x + 0.8, 3.3, 30, "salt_rock");
    const face = x < 0 ? x + 0.8 : x;
    m.box(face - 0.06, 1.1, -30, face + 0.06, 1.3, 30, "blue_basalt", { solid: false });
  }
  for (const z of [-30, 29.2]) {
    m.box(-30, -1.5, z, 30, 3, z + 0.8, "basalt_stone");
    m.box(-30, 3, z, 30, 3.3, z + 0.8, "salt_rock");
    const face = z < 0 ? z + 0.8 : z;
    m.box(-30, 1.1, face - 0.06, 30, 1.3, face + 0.06, "blue_basalt", { solid: false });
  }
  m.box(-30, -0.48, -30, 30, -0.46, 30, "channel_water", { solid: false });
  m.box(-4, -1.5, -12, 4, 0, 12, "basalt_stone");
  // A screen across the central islet hides opposite team spawns. Walk around either end.
  m.box(-1, 0, -10, 1, 4, 10, "blue_basalt");
  m.box(-1.3, 4, -10, 1.3, 4.4, 10, "salt_rock");
  for (const z of [-9, -5, -1, 3, 7])
    m.box(-1.08, 1.5, z, 1.08, 1.65, z + 0.6, "salt_rock", { solid: false });
  for (const z of [-8, -4, 0, 4, 8]) {
    m.box(-1.13, 0, z, -1.02, 3.1, z + 0.2, "salt_rock", { solid: false });
    m.box(1.02, 0, z, 1.13, 3.1, z + 0.2, "salt_rock", { solid: false });
  }
  for (const [z0, z1] of [[-16, -13], [13, 16]]) {
    m.box(-8, -1.5, z0, 8, 0, z1, "basalt_stone");
    m.box(-7.5, 0.01, z0 + 0.5, 7.5, 0.03, z1 - 0.5, "salt_rock", { solid: false });
    m.box(-8, 0, z0, 8, 0.45, z0 + 0.45, "blue_basalt");
    m.box(-8, 0, z1 - 0.45, 8, 0.45, z1, "blue_basalt");
  }
  m.sym2(() => {
    m.box(-30, -1.5, -21, -8, 0, 21, "basalt_stone");
    m.box(-8.06, -0.5, -20, -7.94, -0.3, 20, "salt_rock", { solid: false });
    m.box(-8, -1.5, -2, -4, 0, 2, "blue_basalt"); // middle causeway
    m.stairs("-x", -6.5, -8, -6, 3, "blue_basalt", { y0: -0.5, rise: 0.5, run: 0.5 });
    m.box(-20, 0, -18, -17, 2.8, -15, "blue_basalt");
    m.box(-15, 0, 14, -12, 2.4, 17, "blue_basalt");
    m.box(-18, -1.5, 24, -16.4, 2, 25.6, "blue_basalt");
    m.box(-12.8, -1.5, 23, -11.5, 1.8, 24.3, "salt_rock");
    m.box(-28, 0, -17, -27.2, 1.5, -11, "blue_basalt");
    m.box(-24, 0, 11, -22.5, 1, 12.5, "salt_rock");
    m.box(-11, 0, -11, -9, 1.5, -9, "salt_rock");
    m.box(-27, 0.01, 15, -21, 0.03, 19, "moss_grass", { solid: false });
    for (const [x, z] of [[-26, -8], [-26, -3], [-26, 3], [-26, 8], [-22, -6], [-22, 6]])
      m.spawn(x, 0, z, -PI / 2, 1);
    m.nest(1, -25, 0, 0);
    m.spawn(-3, 0, 8, -PI / 2, 0);
    m.spawn(-6, 0, -14.5, 0, 0);
    m.pickup("hp", -15, 0, 6);
    m.pickup("ammo", -24, 0, -16);
  });
  m.pickup("shield", 0, 0, 11);
  return m.build();
}

export const MIDDLE_MAPS = [graniteRing, mesaAlcove, ashQuarter, riverbendPlain, basaltChannels];
