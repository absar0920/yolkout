// Six original large arenas. Broad loops and clear landmarks make the mazes
// readable in motion; each centre screen protects the opposing team spawns.
import { MapBuilder } from "./lib.mjs";

const PI = Math.PI;
const MODES = ["ffa", "teams", "nest"];

function shell(m, halfX, halfZ, ground, edge, height = 3.4) {
  m.box(-halfX, -1, -halfZ, halfX, 0, halfZ, ground);
  m.box(-halfX, 0, -halfZ, halfX, height, -halfZ + 0.8, edge);
  m.box(-halfX, 0, halfZ - 0.8, halfX, height, halfZ, edge);
  m.box(-halfX, 0, -halfZ + 0.8, -halfX + 0.8, height, halfZ - 0.8, edge);
  m.box(halfX - 0.8, 0, -halfZ + 0.8, halfX, height, halfZ - 0.8, edge);
}

function basesZ(m, spawnZ, nestZ, ffaX, ffaZ, { xs = [-13, -8, -3, 3, 8, 13], yawOffset = () => 0, ffaYaw } = {}) {
  for (const sign of [-1, 1]) {
    const team = sign < 0 ? 1 : 2;
    for (const x of xs) m.spawn(sign < 0 ? x : -x, 0, sign * spawnZ,
      sign < 0 ? PI + yawOffset(x) : yawOffset(x), team);
    m.nest(team, 0, 0, sign * nestZ);
  }
  for (const x of [-ffaX, ffaX]) for (const z of [-ffaZ, ffaZ])
    m.spawn(x, 0, z, ffaYaw ? ffaYaw(x, z) : (x < 0 ? -PI / 2 : PI / 2), 0);
}

function basesX(m, spawnX, nestX, ffaX, ffaZ, { positions = [-13, -8, -3, 3, 8, 13].map(z => [spawnX, z]), ffaYaw } = {}) {
  for (const sign of [-1, 1]) {
    const team = sign < 0 ? 1 : 2;
    for (const [x, z] of positions) m.spawn(sign * x, 0, sign < 0 ? z : -z,
      sign < 0 ? -PI / 2 : PI / 2, team);
    m.nest(team, sign * nestX, 0, 0);
  }
  for (const x of [-ffaX, ffaX]) for (const z of [-ffaZ, ffaZ])
    m.spawn(x, 0, z, ffaYaw ? ffaYaw(x, z) : (z < 0 ? PI : 0), 0);
}

// Offset hedge rows are broken into many gates.
// The paired overlooks and bright central pavilion make the four loops legible.
export function hedgeMaze() {
  const m = new MapBuilder({
    id: "hedge_maze", name: "Hedge Maze",
    desc: "Looping garden passages circle a pale pavilion and two raised lookout terraces.",
    modes: MODES, bounds: { min: [-44, -8, -44], max: [44, 22, 44] },
    palette: { sky: "#8bc4d7", skyHorizon: "#d7eac9", fog: "#a8c7a3", fogNear: 38, fogFar: 118,
      ambient: "#e5f3d5", ambientIntensity: 0.7, hemiGround: "#526b42",
      sun: "#fff3c8", sunIntensity: 1.05, sunDir: [-0.45, -1, 0.35] },
    materials: {
      garden_dirt: { color: "#af9974", rough: 1 },
      hedge_grass: { color: "#3e7954", rough: 1 },
      hedge_light_grass: { color: "#76a66a", rough: 1 },
      pale_stone: { color: "#d9d5b7", rough: 0.95 },
      flower_pink: { color: "#e88d9e", rough: 1 },
    },
  });
  shell(m, 44, 44, "garden_dirt", "hedge_grass", 3.6);
  // This solid row blocks base-to-base sightlines; both ends remain open.
  m.box(-19, 0, -2.5, 19, 3.6, 2.5, "hedge_grass");
  m.box(-4, 3.6, -2, 4, 4.2, 2, "pale_stone");
  m.box(-1, 4.2, -1, 1, 6, 1, "pale_stone");
  for (const x of [-17, -8, 8, 17])
    m.box(x - 0.55, 2.9, -2.65, x + 0.55, 3.3, -2.48, "hedge_light_grass", { solid: false });
  m.sym2(() => {
    for (const [x, z0, z1] of [
      [-36, -31, -10], [-27, -25, -8], [-15, -30, -19], [-15, -15, -7],
      [13, -31, -20], [13, -16, -7], [25, -27, -10], [34, -31, -12],
    ]) m.box(x, 0, z0, x + 1.8, 3.1, z1, "hedge_grass");
    for (const [x0, x1, z] of [
      [-34, -21, -25], [-8, 7, -27], [19, 35, -22],
      [-36, -20, -12], [-11, 4, -13], [18, 34, -10],
    ]) m.box(x0, 0, z, x1, 2.9, z + 1.6, "hedge_grass");
    // A terrace has two stair approaches and a walkable top, not a dead end.
    m.box(29, 0, -5, 35, 1.5, 5, "pale_stone");
    m.stairs("+z", -8, 30, 34, 3, "pale_stone", { rise: 0.5, run: 1 });
    m.stairs("-z", 8, 30, 34, 3, "pale_stone", { rise: 0.5, run: 1 });
    m.box(29, 1.5, -4.8, 29.3, 2.2, 4.8, "flower_pink", { solid: false });
    m.pickup("shield", 32, 1.5, 0);
    m.pickup("hp", -21, 0, -17);
    m.pickup("ammo", 21, 0, -31);
  });
  for (const z of [-39, 39]) m.box(-5, 0.01, z, 5, 0.03, z + 0.5, "flower_pink", { solid: false });
  // The flower gate and path mark the first bend from the southern base.
  m.sym2(() => {
    m.box(-12, 0.015, -36, -11, 0.045, -17, "pale_stone", { solid: false });
    m.box(-12, 0.016, -18, 8, 0.046, -17, "pale_stone", { solid: false });
    m.box(-15, 3.55, -26.3, -10.5, 4.15, -26, "pale_stone", { solid: false });
    m.box(-15, 4.15, -26.3, -10.5, 4.42, -26, "flower_pink", { solid: false });
    m.box(-10.5, 0, -26.3, -10.1, 3.55, -26, "pale_stone");
    m.box(-13, 2.1, -24, -12.8, 3.8, -22.5, "flower_pink", { solid: false });
    m.box(9.5, 0.015, -36, 10.5, 0.045, -17, "pale_stone", { solid: false });
    m.box(10, 0.016, -18, 20, 0.046, -17, "pale_stone", { solid: false });
    m.box(7, 3.55, -27.3, 13, 4.15, -27, "pale_stone", { solid: false });
    m.box(7, 4.15, -27.3, 13, 4.42, -27, "flower_pink", { solid: false });
    m.box(7, 0, -27.3, 7.4, 3.55, -27, "pale_stone");
    m.box(12.6, 0, -27.3, 13, 3.55, -27, "pale_stone");
  });
  const hedgeTurn = { "-11.5": 0, "-8": -0.35, "-3": -0.55,
    "3": 0.6, "8": 0.3, "13": -0.3 };
  basesZ(m, 37, 40, 39, 16, {
    xs: [-11.5, -8, -3, 3, 8, 13],
    yawOffset: x => hedgeTurn[x],
    ffaYaw: (x, z) => Math.atan2(Math.sign(x) * 6, Math.sign(z) * 15),
  });
  return m.build();
}

// Container stacks form a staggered grid; the climbable centre stack is a
// third crossing between the two broad lanes around its ends.
export function cargoGrid() {
  const m = new MapBuilder({
    id: "cargo_grid", name: "Cargo Grid",
    desc: "Staggered freight stacks and a central crane bridge split a wide loading yard into looping lanes.",
    modes: MODES, bounds: { min: [-48, -8, -42], max: [48, 24, 42] },
    palette: { sky: "#8cb3cb", skyHorizon: "#e3c7a0", fog: "#a6acac", fogNear: 43, fogFar: 130,
      ambient: "#dce7e9", ambientIntensity: 0.63, hemiGround: "#596572",
      sun: "#ffe0af", sunIntensity: 1.15, sunDir: [0.5, -1, -0.3] },
    materials: {
      yard_asphalt: { color: "#656b70", rough: 1 },
      fence_metal: { color: "#697780", rough: 0.75 },
      cargo_red: { color: "#aa5148", rough: 0.82 },
      cargo_blue: { color: "#4c7891", rough: 0.82 },
      cargo_yellow: { color: "#c49c50", rough: 0.82 },
      crane_steel: { color: "#a6b1b2", rough: 0.55 },
      lane_paint: { color: "#dfc875", rough: 1 },
    },
  });
  shell(m, 48, 42, "yard_asphalt", "fence_metal", 4.2);
  m.box(-20, 0, -3, 20, 3, 3, "cargo_red");
  m.stairs("+z", -9, -2, 2, 6, "crane_steel", { rise: 0.5, run: 1 });
  m.stairs("-z", 9, -2, 2, 6, "crane_steel", { rise: 0.5, run: 1 });
  m.box(-20, 2.65, -3.08, 20, 2.9, -2.98, "lane_paint", { solid: false });
  m.box(-20, 2.65, 2.98, 20, 2.9, 3.08, "lane_paint", { solid: false });
  m.pickup("shield", 0, 3, 0);
  m.sym2(() => {
    for (const [x0, x1, z0, z1, mat] of [
      [-37, -29, -29, -23, "cargo_blue"], [-23, -15, -21, -15, "cargo_yellow"],
      [-7, 1, -29, -23, "cargo_red"], [11, 19, -25, -19, "cargo_blue"],
      [27, 35, -30, -24, "cargo_yellow"], [-38, -30, -12, -6, "cargo_red"],
      [-14, -7, -12, -6, "cargo_blue"], [8, 15, -15, -9, "cargo_yellow"],
      [29, 37, -13, -7, "cargo_red"],
    ]) m.box(x0, 0, z0, x1, 2.8, z1, mat);
    m.box(-37, 2.8, -29, -29, 5.1, -23, "cargo_yellow");
    m.box(27, 2.8, -30, 35, 5.1, -24, "cargo_blue");
    for (const x of [-40, -26, -12, 2, 16, 30, 43])
      m.box(x, 0.01, -34, x + 0.18, 0.03, -7, "lane_paint", { solid: false });
    m.pickup("hp", -25, 0, -28);
    m.pickup("ammo", 23, 0, -13);
  });
  // A skyline crane marks centre without adding cover at player height.
  for (const x of [-43, 42]) m.box(x, 0, -5, x + 1, 7, -4, "crane_steel");
  m.box(-43, 7, -5, 43, 7.45, -4, "cargo_yellow", { solid: false });
  basesZ(m, 35, 38.5, 42, 17, {
    yawOffset: x => x === -3 ? 0.65 : x === 13 ? -0.5 : 0,
  });
  return m.build();
}

// Blue water channels and low traversable weirs separate the pump galleries.
// The dry centre spine has a raised maintenance crossing.
export function drainworks() {
  const m = new MapBuilder({
    id: "drainworks", name: "Drainworks",
    desc: "Water channels, pump galleries and a walkable central weir make three crossings through an open utility plant.",
    modes: MODES, bounds: { min: [-44, -8, -46], max: [44, 24, 46] },
    palette: { sky: "#7c9cb3", skyHorizon: "#bed5cf", fog: "#91b4b7", fogNear: 36, fogFar: 120,
      ambient: "#d4ebeb", ambientIntensity: 0.65, hemiGround: "#4d6567",
      sun: "#ebf3e2", sunIntensity: 0.95, sunDir: [-0.3, -1, 0.55] },
    materials: {
      service_concrete: { color: "#808e91", rough: 1 },
      dark_concrete: { color: "#566b71", rough: 1 },
      canal_water: { color: "#5babb4", rough: 0.28 },
      pipe_metal: { color: "#a0b8b8", rough: 0.55 },
      safety_paint: { color: "#e5b963", rough: 1 },
      moss_grass: { color: "#648b7b", rough: 1 },
    },
  });
  shell(m, 44, 46, "service_concrete", "dark_concrete", 4);
  m.box(-3, 0, -20, 3, 3.5, 20, "dark_concrete");
  m.stairs("+x", -10, -2.5, 2.5, 7, "service_concrete", { rise: 0.5, run: 1 });
  m.stairs("-x", 10, -2.5, 2.5, 7, "service_concrete", { rise: 0.5, run: 1 });
  m.box(-3, 3.5, -20, 3, 3.75, -19.5, "safety_paint", { solid: false });
  m.box(-3, 3.5, 19.5, 3, 3.75, 20, "safety_paint", { solid: false });
  m.pickup("shield", 0, 3.5, 0);
  for (const z of [-32, 28]) {
    m.box(-42, 0.01, z, 42, 0.03, z + 4, "canal_water", { solid: false });
    for (const x of [-32, -8, 16])
      m.box(x, 0.03, z, x + 5, 0.06, z + 4, "safety_paint", { solid: false });
  }
  m.sym2(() => {
    // Split galleries leave doors on both sides of each pump block.
    m.box(-30, 0, -23, -18, 3.2, -20, "dark_concrete");
    m.box(-30, 0, 20, -18, 3.2, 23, "dark_concrete");
    m.box(-29, 0, -16, -26, 3.1, -4, "dark_concrete");
    m.box(-29, 0, 4, -26, 3.1, 16, "dark_concrete");
    m.box(-21, 0, -13, -18, 2.8, -2, "pipe_metal");
    m.box(-21, 0, 2, -18, 2.8, 13, "pipe_metal");
    for (const z of [-26, -17, 15, 24])
      m.box(-38, 0, z, -34, 1.5, z + 2.5, "pipe_metal");
    for (const z of [-19, -8, 8, 19])
      m.box(-15, 0, z, -12, 1.4, z + 3, "dark_concrete");
    m.box(-29, 3.1, -16, -26, 3.4, 16, "safety_paint", { solid: false });
    m.pickup("hp", -32, 0, -18);
    m.pickup("ammo", -12, 0, 34);
  });
  basesX(m, 37, 40, 13, 39, {
    positions: [38, 35.5, 33].flatMap(x => [[x, -19], [x, 19]]),
    ffaYaw: (x, z) => z < 0 ? PI + Math.sign(x) * 0.3 : -Math.sign(x) * 0.3,
  });
  return m.build();
}

// A city block on a single rooftop plane: two climbable plant-room roofs and
// the central service core give high and low loops without an exposed edge.
export function rooftopBlock() {
  const m = new MapBuilder({
    id: "rooftop_block", name: "Rooftop Block",
    desc: "Raised plant-room roofs, service cores and open sky alleys above a compact night-time block.",
    modes: MODES, bounds: { min: [-46, -8, -44], max: [46, 24, 44] },
    palette: { sky: "#617592", skyHorizon: "#b9a9a7", fog: "#7b8999", fogNear: 35, fogFar: 115,
      ambient: "#c6cee0", ambientIntensity: 0.62, hemiGround: "#4e5065",
      sun: "#e5d2c3", sunIntensity: 0.85, sunDir: [0.45, -1, 0.25] },
    materials: {
      roof_tar: { color: "#64646f", rough: 1 },
      tower_concrete: { color: "#a5a0a2", rough: 1 },
      roof_brick: { color: "#9b7773", rough: 1 },
      vent_metal: { color: "#6b7d87", rough: 0.7 },
      glass_blue: { color: "#a3cad5", rough: 0.25 },
      safety_paint: { color: "#e3b77a", rough: 1 },
    },
  });
  shell(m, 46, 44, "roof_tar", "roof_brick", 4);
  m.box(-4, 0, -19, 4, 4.2, 19, "tower_concrete");
  m.box(-4, 1.3, -19.06, 4, 2.8, -18.94, "glass_blue", { solid: false });
  m.box(-4, 1.3, 18.94, 4, 2.8, 19.06, "glass_blue", { solid: false });
  m.box(-1.2, 4.2, -3, 1.2, 7, 3, "vent_metal");
  m.sym2(() => {
    m.box(-28, 0, -14, -16, 2, 14, "tower_concrete");
    m.stairs("+x", -33, -2, 2, 4, "roof_brick", { rise: 0.5, run: 1.25 });
    m.stairs("+z", -19, -19, -17, 4, "roof_brick", { rise: 0.5, run: 1.25 });
    m.box(-28, 2, -14, -16, 2.3, -13.5, "safety_paint", { solid: false });
    m.box(-25, 2, -8, -23, 3, -5, "vent_metal");
    m.box(-21, 2, 4, -19, 2.8, 7, "vent_metal");
    m.box(-36, 0, -31, -32, 2.5, -27, "roof_brick");
    m.box(-36, 0, 27, -32, 2.5, 31, "roof_brick");
    m.box(-14, 0, -29, -10, 1.4, -26, "vent_metal");
    m.box(-14, 0, 26, -10, 1.4, 29, "vent_metal");
    // Offset plant rooms make the north and south roof lanes into cover-rich
    // loops. Their staggered gaps preserve a clear route around the core.
    m.box(-28, 0, -34, -23, 2.4, -29, "roof_brick");
    m.box(-21, 0, -35, -18, 1.7, -32, "vent_metal");
    m.box(-30, 0, 22, -26, 2.4, 26, "roof_brick");
    m.box(-23, 0, 30, -19, 1.8, 33, "vent_metal");
    m.box(-10, 0, -21, -7, 1.8, -17, "vent_metal");
    m.box(-9, 0, 19, -6, 1.6, 23, "roof_brick");
    m.box(-31, 0, -10, -29, 1.3, -7, "vent_metal");
    m.box(-31, 0, 7, -29, 1.3, 10, "vent_metal");
    // Eye-level colored panels make the two elevated roofs easy to call out.
    m.box(-27.5, 2.5, 13.9, -17, 3.5, 14.02, "glass_blue", { solid: false });
    m.box(-28.5, 1.05, -14.02, -16, 1.28, -13.9, "safety_paint", { solid: false });
    m.box(-30, 2.8, -31, -26, 3.4, -30.6, "glass_blue", { solid: false });
    m.pickup("hp", -19, 2, 10);
    m.pickup("ammo", -10, 0, 34);
  });
  m.pickup("shield", 0, 0, 27);
  basesX(m, 38, 42, 11, 37, {
    positions: [38, 35.5, 33].flatMap(x => [[x, -18], [x, 18]]),
    ffaYaw: (x, z) => z < 0 ? PI + Math.sign(x) * 0.32 : -Math.sign(x) * 0.32,
  });
  return m.build();
}

// Golden row blocks leave frequent cross-passages. Watch decks at the east and
// west edges and an orange wind marker above centre distinguish this from hedges.
export function cornMaze() {
  const m = new MapBuilder({
    id: "corn_maze", name: "Corn Maze",
    desc: "Harvested cross paths loop between tall corn rows, paired timber decks and an orange wind marker.",
    modes: MODES, bounds: { min: [-44, -8, -48], max: [44, 22, 48] },
    palette: { sky: "#80c1e2", skyHorizon: "#ebd7ac", fog: "#d6c38f", fogNear: 40, fogFar: 126,
      ambient: "#fff0cb", ambientIntensity: 0.68, hemiGround: "#8e7950",
      sun: "#ffdf9c", sunIntensity: 1.18, sunDir: [-0.55, -1, 0.25] },
    materials: {
      harvest_dirt: { color: "#a98b63", rough: 1 },
      corn_grass: { color: "#ba9e43", rough: 1 },
      corn_leaf_grass: { color: "#758f45", rough: 1 },
      weather_wood: { color: "#8a704d", rough: 0.95 },
      marker_orange: { color: "#e28a39", rough: 0.75 },
    },
  });
  shell(m, 44, 48, "harvest_dirt", "corn_grass", 3.6);
  m.box(-20, 0, -2.5, 20, 3.2, 2.5, "corn_grass");
  m.box(-1, 3.2, -1, 1, 7, 1, "weather_wood");
  m.box(-4, 5.7, -0.16, 4, 6.05, 0.16, "marker_orange", { solid: false });
  m.box(-0.16, 5.7, -4, 0.16, 6.05, 4, "marker_orange", { solid: false });
  m.sym2(() => {
    for (const x of [-34, -24, -14, -4, 6, 16, 26, 36]) {
      m.box(x, 0, -33, x + 1.7, 3, -22, "corn_grass");
      m.box(x, 0, -17, x + 1.7, 3, -8, "corn_grass");
      m.box(x, 2.35, -33, x + 1.7, 2.65, -22, "corn_leaf_grass", { solid: false });
    }
    for (const [x0, x1, z] of [
      [-41, -27, -27], [-19, -7, -27], [2, 14, -27], [21, 39, -27],
      [-38, -24, -13], [-14, -1, -13], [11, 24, -13], [31, 39, -13],
    ]) m.box(x0, 0, z, x1, 2.8, z + 1.5, "corn_grass");
    m.box(27, 0, -5, 35, 1.5, 5, "weather_wood");
    m.stairs("+z", -8, 29, 33, 3, "weather_wood", { rise: 0.5, run: 1 });
    m.stairs("-z", 8, 29, 33, 3, "weather_wood", { rise: 0.5, run: 1 });
    m.box(27, 1.5, -4.7, 27.3, 2.3, 4.7, "marker_orange", { solid: false });
    m.pickup("shield", 31, 1.5, 0);
    m.pickup("hp", -8, 0, -20);
    m.pickup("ammo", 22, 0, -36);
  });
  // Orange ribbons identify the gap into the first corn crossing.
  m.sym2(() => {
    m.box(-27.16, 1.4, -27.12, -26.96, 2.9, -25.2, "marker_orange", { solid: false });
    m.box(-24.04, 1.4, -27.12, -23.84, 2.9, -25.2, "marker_orange", { solid: false });
    m.box(-27.1, 3, -27.12, -23.85, 3.4, -26.86, "weather_wood", { solid: false });
    m.box(-27.1, 3.4, -27.12, -23.85, 3.7, -26.86, "marker_orange", { solid: false });
  });
  basesZ(m, 40, 44, 40, 19, { xs: [-26, -21, -6, 0, 18, 20] });
  return m.build();
}

// Neon storefronts border parallel alleys; a lit walkable skybridge and two
// broad perimeter turns let players change lanes without a blind dead end.
export function neonLanes() {
  const m = new MapBuilder({
    id: "neon_lanes", name: "Neon Lanes",
    desc: "A night market of luminous alleys, staggered kiosks and a high central skybridge.",
    modes: MODES, bounds: { min: [-44, -8, -44], max: [44, 22, 44] },
    palette: { sky: "#27304b", skyHorizon: "#655976", fog: "#4f526a", fogNear: 26, fogFar: 99,
      ambient: "#bbc5e9", ambientIntensity: 0.68, hemiGround: "#343348",
      sun: "#a2c4ff", sunIntensity: 0.75, sunDir: [0.5, -1, -0.4] },
    materials: {
      street_asphalt: { color: "#4b4b62", rough: 1 },
      black_brick: { color: "#34364c", rough: 1 },
      kiosk_blue: { color: "#5380aa", rough: 0.8 },
      kiosk_red: { color: "#a95871", rough: 0.8 },
      steel_metal: { color: "#8b9caf", rough: 0.6 },
      neon_pink: { color: "#ff79b4", rough: 0.4, emissive: "#e64d95" },
      neon_cyan: { color: "#70d8e3", rough: 0.4, emissive: "#49bdca" },
      neon_yellow: { color: "#f2d47c", rough: 0.4, emissive: "#d9a93d" },
    },
  });
  shell(m, 44, 44, "street_asphalt", "black_brick", 4.2);
  m.box(-3, 0, -20, 3, 3.5, 20, "kiosk_blue");
  m.stairs("+x", -10, -2.5, 2.5, 7, "steel_metal", { rise: 0.5, run: 1 });
  m.stairs("-x", 10, -2.5, 2.5, 7, "steel_metal", { rise: 0.5, run: 1 });
  m.box(-3.05, 1.3, -19, -2.98, 1.6, 19, "neon_pink", { solid: false });
  m.box(2.98, 2.4, -19, 3.05, 2.7, 19, "neon_cyan", { solid: false });
  m.pickup("shield", 0, 3.5, 0);
  for (const z of [-32, -22, -11, 10, 21, 31])
    m.box(-43, 0.01, z, 43, 0.035, z + 0.22, "neon_yellow", { solid: false });
  m.sym2(() => {
    for (const [x0, x1, z0, z1, mat] of [
      [-34, -28, -30, -25, "kiosk_blue"], [-33, -27, -15, -10, "kiosk_red"],
      [-34, -28, 9, 15, "kiosk_blue"], [-34, -28, 26, 31, "kiosk_red"],
      [-20, -15, -25, -21, "kiosk_red"], [-19, -14, -5, -1, "kiosk_blue"],
      [-20, -15, 18, 23, "kiosk_red"], [-11, -7, -34, -28, "black_brick"],
      [-11, -7, 28, 34, "black_brick"],
    ]) m.box(x0, 0, z0, x1, 2.8, z1, mat);
    for (const [x, z, mat] of [[-34, -30, "neon_cyan"], [-33, -15, "neon_pink"], [-34, 9, "neon_yellow"], [-34, 26, "neon_cyan"]])
      m.box(x - 0.06, 1.5, z, x + 6.06, 2.1, z + 0.09, mat, { solid: false });
    m.box(-40, 0, -24, -38, 3.2, -14, "steel_metal");
    m.box(-39.5, 3.2, -24, -38.5, 4.1, -14, "neon_pink", { solid: false });
    m.pickup("hp", -24, 0, -9);
    m.pickup("ammo", -13, 0, 14);
  });
  basesX(m, 37, 40, 12, 37, {
    positions: [-19, -5, -2, 2, 5, 19].map(z => [37, z]),
  });
  return m.build();
}

export const LARGE_MAZE_MAPS = [hedgeMaze, cargoGrid, drainworks, rooftopBlock, cornMaze, neonLanes];
export const LARGE_MAZES = LARGE_MAZE_MAPS;
