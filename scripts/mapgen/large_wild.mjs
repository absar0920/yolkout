// Seven original, large outdoor arenas. Water is a shallow visual surface over
// walkable ground: the game has no swimming movement or buoyancy physics.
import { MapBuilder } from "./lib.mjs";

const MODES = ["ffa", "teams", "nest"];
const yawTo = (x, z, tx, tz) => Math.atan2(x - tx, z - tz);

function arena(meta, halfX, halfZ, floor, rim) {
  const m = new MapBuilder({ ...meta, modes: MODES, bounds: { min: [-halfX, -8, -halfZ], max: [halfX, 28, halfZ] } });
  m.box(-halfX, -1, -halfZ, halfX, 0, halfZ, floor);
  m.box(-halfX, 0, -halfZ, halfX, 3, -halfZ + 0.7, rim);
  m.box(-halfX, 0, halfZ - 0.7, halfX, 3, halfZ, rim);
  m.box(-halfX, 0, -halfZ + 0.7, -halfX + 0.7, 3, halfZ - 0.7, rim);
  m.box(halfX - 0.7, 0, -halfZ + 0.7, halfX, 3, halfZ - 0.7, rim);
  return m;
}

function eastWestStarts(m, farX) {
  m.sym2(() => {
    m.nest(1, -farX, 0, 0);
    // Face the visible end of the spawn screen, not the wall's broadside.
    for (const z of [-12, -6, 6, 12]) m.spawn(-farX, 0, z, yawTo(-farX, z, -25, Math.sign(z) * 36), 1);
    for (const z of [-8, 8]) m.spawn(-farX + 4, 0, z, yawTo(-farX + 4, z, -25, Math.sign(z) * 36), 1);
  });
}

function northSouthStarts(m, farZ) {
  m.sym2(() => {
    m.nest(1, 0, 0, -farZ);
    for (const x of [-12, -6, 6, 12]) m.spawn(x, 0, -farZ, yawTo(x, -farZ, Math.sign(x) * 36, -23), 1);
    for (const x of [-8, 8]) m.spawn(x, 0, -farZ + 4, yawTo(x, -farZ + 4, Math.sign(x) * 36, -23), 1);
  });
}

function conifer(m, x, z, height, trunk, dark, light, size = 1) {
  const t = 0.55 * size;
  m.box(x - t, 0, z - t, x + t, height, z + t, trunk);
  const w = 2.3 * size;
  m.box(x - w, height - 1.2, z - w, x + w, height + 0.3, z + w, dark, { solid: false });
  m.box(x - w * 0.7, height + 0.3, z - w * 0.7, x + w * 0.7, height + 1.5, z + w * 0.7, light, { solid: false });
}

function tent(m, x, z, canvas, frame) {
  for (const dx of [-2.2, 2.2]) for (const dz of [-1.6, 1.6])
    m.box(x + dx - 0.13, 0, z + dz - 0.13, x + dx + 0.13, 2.1, z + dz + 0.13, frame);
  m.box(x - 2.45, 2.1, z - 1.85, x + 2.45, 2.42, z + 1.85, canvas);
  m.box(x - 2.3, 0, z + 1.48, x + 2.3, 0.7, z + 1.75, canvas);
}

function cabin(m, x, z, wall, roof) {
  // An open-front cabin: a 2.6u doorway admits players and shots.
  m.box(x - 4, 0, z - 3, x + 4, 3, z - 2.55, wall);
  m.box(x - 4, 0, z - 3, x - 3.55, 3, z + 3, wall);
  m.box(x + 3.55, 0, z - 3, x + 4, 3, z + 3, wall);
  m.box(x - 4, 0, z + 2.55, x - 1.3, 3, z + 3, wall);
  m.box(x + 1.3, 0, z + 2.55, x + 4, 3, z + 3, wall);
  m.box(x - 4.35, 3, z - 3.35, x + 4.35, 3.4, z + 3.35, roof);
}

// A forest campground with a playable raised lookout over the central fire ring.
export function pineCamp() {
  const m = arena({
    id: "pine_camp", name: "Pine Camp",
    desc: "Three trails wind around a pine campground and converge at a climbable fire lookout.",
    palette: {
      sky: "#709db0", skyHorizon: "#c1cbb1", fog: "#9eae9c", fogNear: 43, fogFar: 155,
      ambient: "#e5ead6", ambientIntensity: 0.64, hemiGround: "#455840",
      sun: "#ffe6b6", sunIntensity: 1.08, sunDir: [-0.55, -1, 0.25],
    },
    materials: {
      pineFloor: { color: "#6e7756", rough: 1 },
      pineNeedles: { color: "#8a7954", rough: 1 },
      campStone: { color: "#77796e", rough: 1 },
      pineBark: { color: "#655442", rough: 1 },
      pineDark: { color: "#395d44", rough: 1 },
      pineLight: { color: "#547b50", rough: 1 },
      campWood: { color: "#a17c54", rough: 0.95 },
      tentOchre: { color: "#c69a63", rough: 0.9 },
      ember: { color: "#efac59", rough: 0.7, emissive: "#cb6339" },
    },
  }, 44, 44, "pineFloor", "campStone");
  for (const z of [-31, 27]) m.box(-40, 0.01, z, 40, 0.035, z + 3, "pineNeedles", { solid: false });
  m.sym2(() => {
    // Worn tracks remain visible from the protected spawn clearing.
    m.box(-40, 0.01, -30, -36, 0.035, 30, "pineNeedles", { solid: false });
  });
  m.sym2(() => {
    // A rock-backed windbreak hides the team clearing; exits are at both ends.
    m.box(-29, 0, -18, -27.8, 3.6, 18, "campStone");
    m.box(-29.2, 1.15, -18, -29, 1.34, 18, "pineNeedles", { solid: false });
    for (const [z, h] of [[-15, 2.3], [-8, 3.1], [1, 2.7], [9, 3.25], [16, 2.5]]) {
      m.box(-29.8, 0, z - 0.55, -28.9, h, z + 0.55, "campStone");
      m.box(-30, h, z - 0.7, -28.75, h + 0.22, z + 0.7, "pineNeedles", { solid: false });
    }
    for (const [x, z, h] of [[-22, -28, 6.4], [-10, -27, 7], [-24, 24, 6.7], [-8, 23, 7.2]])
      conifer(m, x, z, h, "pineBark", "pineDark", "pineLight");
    tent(m, -34, -25, "tentOchre", "campWood");
    tent(m, -34, 25, "tentOchre", "campWood");
    m.box(-19, 0, -4, -10, 1.2, -2.8, "pineBark");
    m.box(-17, 0, 4.5, -14, 2.4, 9, "campStone");
    m.box(-12, 0, -19, -9, 1.5, -15, "campStone");
    m.box(-24, 0, 0.5, -22.5, 2.1, 3, "campWood");
    for (const [x, z, tx, tz] of [[-31, -35, 0, 0], [-12, -34, 5, 0], [-33, 34, 0, 0], [-14, 31, 0, 0]])
      m.spawn(x, 0, z, yawTo(x, z, tx, tz), 0);
    m.pickup("hp", -23, 0, -12);
    m.pickup("ammo", -11, 0, 13);
  });
  // Open space under the deck has 2.55u of headroom, and both stairs reach it.
  for (const x of [-4.6, 4.6]) for (const z of [-4.6, 4.6])
    m.box(x - 0.25, 0, z - 0.25, x + 0.25, 2.55, z + 0.25, "campWood");
  m.box(-5, 2.55, -5, 5, 3, 5, "campWood");
  m.stairs("+x", -11, -2, 2, 12, "campWood", { rise: 0.25, run: 0.5 });
  m.stairs("-x", 11, -2, 2, 12, "campWood", { rise: 0.25, run: 0.5 });
  m.box(-2, 0, -13, 2, 0.9, -9, "campStone");
  m.box(-0.8, 0.9, -11.8, 0.8, 1.5, -10.2, "ember", { solid: false });
  m.pickup("shield", 0, 3, 0);
  eastWestStarts(m, 38);
  return m.build();
}

// A shallow lake occupies the north half; shores, piers and cabin yards loop it.
export function lakesideCabins() {
  const m = arena({
    id: "lakeside_cabins", name: "Lakeside Cabins",
    desc: "Circle a lake by cabin yards, shoreline shallows, or a raised pier and island crossing.",
    palette: {
      sky: "#79aecd", skyHorizon: "#d3dcc5", fog: "#a8bfc2", fogNear: 44, fogFar: 160,
      ambient: "#e6f2eb", ambientIntensity: 0.66, hemiGround: "#4f7161",
      sun: "#fff0c9", sunIntensity: 1.15, sunDir: [0.5, -1, 0.3],
    },
    materials: {
      lakeGrass: { color: "#738769", rough: 1 },
      lakeShore: { color: "#b9a88b", rough: 1 },
      lakeWater: { color: "#65a5bb", rough: 0.25 },
      lakeStone: { color: "#7b8582", rough: 1 },
      cabinWood: { color: "#9a7453", rough: 0.95 },
      cabinRoof: { color: "#5d675d", rough: 1 },
      dockWood: { color: "#ad9270", rough: 0.9 },
      lakePine: { color: "#4e7656", rough: 1 },
      lakeBark: { color: "#6b5c4b", rough: 1 },
    },
  }, 46, 42, "lakeGrass", "lakeStone");
  m.box(-45, 0, 5, 45, 0.04, 40, "lakeWater", { solid: false });
  m.box(-45, 0.041, 3.8, 45, 0.065, 5.2, "lakeShore", { solid: false });
  m.box(-45, 0.041, 39, 45, 0.065, 40.3, "lakeShore", { solid: false });
  for (const side of [-1, 1]) {
    const sx = (x) => side * x;
    // Sand tracks mark the protected shoreline corridor and its southern exit.
    m.box(sx(42), 0.01, -31, sx(37), 0.035, 4, "lakeShore", { solid: false });
    m.box(sx(42), 0.01, -31, sx(24), 0.035, -28, "lakeShore", { solid: false });
  }
  m.sym2(() => {
    // Each cabin-side timber screen makes the base a protected yard.
    m.box(-30.5, 0, -17.5, -29.5, 3.5, 17.5, "cabinWood");
    for (const z of [-12, -4, 4, 12])
      m.box(-30.7, 2.7, z - 0.6, -29.3, 3.05, z + 0.6, "cabinRoof");
    for (const z of [-15, -7, 1, 9, 16])
      m.box(-31, 0, z - 0.25, -29.4, 3.7, z + 0.25, "dockWood");
    cabin(m, -19, -22, "cabinWood", "cabinRoof");
    cabin(m, -13, 26, "cabinWood", "cabinRoof");
    for (const [x, z] of [[-24, -32], [-8, -31], [-35, 29]])
      conifer(m, x, z, 6.5, "lakeBark", "lakePine", "lakePine");
    m.box(-24, 0, -10, -20, 1.5, -7, "lakeStone");
    m.box(-23, 0, 12, -19, 1.2, 14, "dockWood");
    m.box(-12, 0, -13, -9, 1.7, -10, "lakeStone");
    m.pickup("hp", -26, 0, -24);
    m.pickup("ammo", -22, 0, 31);
  });
  // Three crossings meet at a low island; every water cell has solid ground.
  m.box(-38, 0, 10, 38, 0.5, 13.5, "dockWood");
  m.box(-8, 0, 16, 8, 0.5, 31, "lakeShore");
  m.box(-8, 0.5, 21.5, 8, 1, 25, "dockWood");
  m.box(-2.5, 0, 5, 2.5, 0.5, 31, "dockWood");
  m.box(-14, 0, -14, 14, 0.5, -10.5, "lakeShore");
  for (const [x, z] of [[-6, 18], [6, 18], [-6, 29], [6, 29]])
    m.box(x - 0.3, 0.5, z - 0.3, x + 0.3, 2, z + 0.3, "dockWood");
  m.box(-5, 0, -2.5, -3, 1.3, -0.5, "lakeStone");
  m.box(3, 0, -1.5, 5, 1.3, 0.5, "lakeStone");
  m.sym2(() => {
    // Low tied-up boats break the otherwise long shoreline sightline.
    m.box(-18, 0, 15.5, -13, 1.1, 17.3, "cabinWood");
    m.box(-17.5, 1.1, 15.8, -13.5, 1.35, 17, "dockWood");
    m.box(-29, 0, -4, -25, 1.4, -2.5, "lakeStone");
  });
  m.pickup("shield", 0, 1, 23);
  // Both teams begin on dry south-shore ground; mirrored x coordinates keep
  // their distance to the north water route and south cabin route equal.
  for (const side of [-1, 1]) {
    const sx = (x) => side * x;
    for (const [x, z, y] of [[36, -31, 0], [10, -34, 0], [21, 1, 0], [5, 28, 0.5]]) {
      const px = sx(x);
      m.spawn(px, y, z, yawTo(px, z, 0, z > 10 ? 8 : 0), 0);
    }
  }
  for (const side of [-1, 1]) {
    const sx = (x) => side * x;
    m.nest(side < 0 ? 1 : 2, sx(41), 0, -4);
    for (const [x, z] of [[40, -14], [40, -9], [40, -4], [40, 2], [36, -12], [36, 3]]) {
      const px = sx(x), north = z > 0;
      m.spawn(px, 0, z, yawTo(px, z, sx(24), north ? 38 : -30), side < 0 ? 1 : 2);
    }
  }
  return m.build();
}

// A lattice of low boardwalks preserves multiple crossing choices in a marsh.
export function marshBoardwalk() {
  const m = arena({
    id: "marsh_boardwalk", name: "Marsh Boardwalk",
    desc: "Fight across a lattice of raised wooden paths, shallow marsh, and a central observation deck.",
    palette: {
      sky: "#8da99f", skyHorizon: "#d7d7b5", fog: "#a8b9a8", fogNear: 34, fogFar: 145,
      ambient: "#e5e8d5", ambientIntensity: 0.66, hemiGround: "#475d4d",
      sun: "#f4e6bd", sunIntensity: 0.95, sunDir: [-0.3, -1, 0.55],
    },
    materials: {
      marshEarth: { color: "#6a7257", rough: 1 },
      marshWater: { color: "#689b98", rough: 0.28 },
      boardWood: { color: "#9b8866", rough: 0.95 },
      darkWood: { color: "#685d48", rough: 1 },
      reedGreen: { color: "#829364", rough: 1 },
      marshStone: { color: "#777e70", rough: 1 },
      cypressBark: { color: "#5d5445", rough: 1 },
      cypressLeaf: { color: "#4e715e", rough: 1 },
    },
  }, 45, 45, "marshEarth", "darkWood");
  m.box(-40, 0, -34, 40, 0.035, 34, "marshWater", { solid: false });
  m.sym2(() => {
    m.box(-18, 0, -29, 18, 3.5, -27.9, "darkWood");
    for (const x of [-15, -5, 5, 15]) m.box(x - 0.25, 3.5, -29.1, x + 0.25, 4.1, -27.8, "boardWood");
    for (const [x, z] of [[-30, -18], [29, -17], [-25, -4], [28, -3]]) {
      m.box(x - 0.65, 0, z - 0.65, x + 0.65, 4.7, z + 0.65, "cypressBark");
      m.box(x - 2, 4.7, z - 2, x + 2, 5.8, z + 2, "cypressLeaf", { solid: false });
    }
    for (const [x, z] of [[-36, -14], [-12, -21], [13, -21], [34, -8]])
      m.box(x - 1.1, 0, z - 0.5, x + 1.1, 1.8, z + 0.5, "marshStone");
    for (const [x, z, tx, tz] of [[-33, -34, 0, 0], [32, -34, 0, 0], [-41, -2, -19, 0], [41, -8, 19, -18]])
      m.spawn(x, 0, z, yawTo(x, z, tx, tz), 0);
    m.pickup("hp", -34, 0, -23);
    m.pickup("ammo", 30, 0, -23);
  });
  // The boardwalk is only half a unit high; players can step on and off it.
  for (const x of [-19, 0, 19]) m.box(x - 1.9, 0, -36, x + 1.9, 0.5, 36, "boardWood");
  for (const z of [-17, 17]) m.box(-36, 0, z - 1.8, 36, 0.5, z + 1.8, "boardWood");
  m.box(-5, 0, -5, 5, 1, 5, "boardWood");
  for (const x of [-4.5, 4.5]) for (const z of [-4.5, 4.5])
    m.box(x - 0.25, 1, z - 0.25, x + 0.25, 3.6, z + 0.25, "darkWood");
  m.box(-5, 3.6, -5, 5, 4, 5, "reedGreen");
  m.box(-7.5, 0, -7.5, -5.5, 1.5, -5.5, "marshStone");
  m.box(5.5, 0, 5.5, 7.5, 1.5, 7.5, "marshStone");
  m.sym2(() => {
    m.box(-12, 0, -9, -8.5, 1.5, -7.6, "darkWood");
    m.box(8.5, 0, -13, 12, 1.5, -11.6, "darkWood");
    m.box(-31, 0, 8, -28, 1.7, 10, "marshStone");
  });
  for (const [x, z] of [[-26, 11], [-13, 28], [12, -28], [27, -12]]) {
    m.box(x - 1, 0, z - 0.3, x + 1, 1.6, z + 0.3, "reedGreen", { solid: false });
    m.box(x - 0.3, 0, z - 1, x + 0.3, 1.6, z + 1, "reedGreen", { solid: false });
  }
  m.pickup("shield", 0, 1, 0);
  northSouthStarts(m, 39);
  return m.build();
}

// Staggered cliff walls form a broad S bend; rim shelves offer optional height.
export function canyonCamp() {
  const m = arena({
    id: "canyon_camp", name: "Canyon Camp",
    desc: "A winding dry wash links sheltered canyon camps below two climbable rim shelves.",
    palette: {
      sky: "#8ea9c5", skyHorizon: "#e9b99a", fog: "#c79c83", fogNear: 48, fogFar: 170,
      ambient: "#ffe5c9", ambientIntensity: 0.6, hemiGround: "#9b6953",
      sun: "#ffe3ac", sunIntensity: 1.3, sunDir: [-0.65, -1, 0.4],
    },
    materials: {
      canyonSand: { color: "#bd8b6c", rough: 1 },
      canyonRock: { color: "#9e6252", rough: 1 },
      canyonLight: { color: "#d8a07a", rough: 1 },
      canyonShade: { color: "#755252", rough: 1 },
      dryWash: { color: "#d8b294", rough: 1 },
      campCanvas: { color: "#d6b18a", rough: 0.9 },
      campPole: { color: "#76604a", rough: 1 },
    },
  }, 48, 42, "canyonSand", "canyonRock");
  // Offset long walls make the middle lane bend while wide end gaps loop it.
  m.sym2(() => {
    m.box(-31, 0, -18, -29.5, 4.2, 18, "canyonRock");
    for (const [z, h] of [[-15, 2.1], [-8, 3.5], [0, 2.8], [8, 3.8], [15, 2.4]])
      m.box(-31.9, 0, z - 1.1, -30.8, h, z + 1.1, "canyonShade");
    for (const y of [0.85, 2.2, 3.55])
      m.box(-32, y, -18, -31.85, y + 0.18, 18, "canyonLight", { solid: false });
    m.box(-18, 0, -18, 7, 5.2, -14, "canyonRock");
    m.box(-16, 0, -18, -11, 2, -14, "canyonLight");
    for (const y of [1.05, 2.6, 4.1])
      m.box(-17.8, y, -18.12, 6.8, y + 0.17, -17.99, "canyonLight", { solid: false });
    // The rim shelf is low enough to reach by a six-step ascent.
    m.box(-25, 0, -29, -15, 3, -22, "canyonLight");
    m.stairs("+x", -31, -27, -24, 6, "canyonRock", { rise: 0.5, run: 1 });
    m.box(-24, 3, -28.7, -22, 3.8, -27.8, "canyonShade");
    m.box(-19, 3, -23, -16, 3.8, -22.2, "canyonShade");
    m.box(-27, 0, 23, -22, 1.5, 26, "canyonShade");
    m.box(-6, 0, 23, -2.5, 2.2, 26, "canyonRock");
    m.box(-10, 0, -30, -6, 1.7, -27, "canyonShade");
    m.box(-13, 0, 7, -10, 2.3, 10, "canyonLight");
    m.box(-23, 0, 0, -20, 1.5, 3, "canyonShade");
    tent(m, -40, -26, "campCanvas", "campPole");
    tent(m, -40, 26, "campCanvas", "campPole");
    for (const [x, z, tx, tz] of [[-36, -34, -18, 0], [-12, -33, 20, -23], [-36, 35, 0, 0], [-9, 29, -20, -5]])
      m.spawn(x, 0, z, yawTo(x, z, tx, tz), 0);
    m.pickup("hp", -27, 0, 9);
    m.pickup("ammo", -13, 0, 26);
  });
  for (const [x, z, sx, sz] of [[-25, -5, 16, 3], [-5, 4, 17, 3], [18, -4, 17, 3]])
    m.box(x, 0.01, z, x + sx, 0.035, z + sz, "dryWash", { solid: false });
  m.box(-4, 0, -4, 4, 2.2, 4, "canyonRock");
  m.box(-2.8, 2.2, -2.8, 2.8, 2.8, 2.8, "canyonLight");
  m.box(-9, 0, 8, -6, 1.5, 10, "canyonShade");
  m.box(6, 0, -10, 9, 1.5, -8, "canyonShade");
  m.pickup("shield", 0, 0, -9);
  eastWestStarts(m, 41);
  return m.build();
}

// Broad walkable shallows keep every landing escapable; bridges lead to islets.
export function islandCrossings() {
  const m = arena({
    id: "island_crossings", name: "Island Crossings",
    desc: "Choose a bridge, a string of sandy islets, or the shallow lagoon between two camp shores.",
    palette: {
      sky: "#71b4cb", skyHorizon: "#c8ddd1", fog: "#a2cad0", fogNear: 48, fogFar: 165,
      ambient: "#eaf5ec", ambientIntensity: 0.69, hemiGround: "#668474",
      sun: "#fff3ce", sunIntensity: 1.2, sunDir: [0.4, -1, -0.5],
    },
    materials: {
      islandSand: { color: "#c5b393", rough: 1 },
      islandWater: { color: "#5da9b8", rough: 0.25 },
      islandStone: { color: "#7d8b85", rough: 1 },
      paleSand: { color: "#e1cb9e", rough: 1 },
      driftWood: { color: "#96795d", rough: 1 },
      duneGrass: { color: "#849a65", rough: 1 },
      seaPine: { color: "#476d5f", rough: 1 },
      seaBark: { color: "#685c4c", rough: 1 },
    },
  }, 44, 44, "islandSand", "islandStone");
  m.box(-34, 0, -29, 34, 0.035, 29, "islandWater", { solid: false });
  m.sym2(() => {
    // A dune-backed landing screens the teams and directs them around its tips.
    m.box(-30, 0, -18, -28.8, 3.5, 18, "paleSand");
    for (const z of [-14, -5, 5, 14])
      m.box(-30.15, 1.25, z - 1.5, -29.97, 1.47, z + 1.5, "duneGrass", { solid: false });
    for (const z of [-15, -7, 2, 11])
      m.box(-31.3, 0, z - 1.3, -29.9, 0.9, z + 1.3, "islandStone");
    m.box(-24, 0, -27, -18, 0.5, -20, "paleSand");
    m.box(-19, 0, 18, -11, 0.5, 25, "paleSand");
    m.box(-10, 0, -8, -5, 0.5, -3, "paleSand");
    m.box(-17, 0, -2, -13, 1.3, 0, "islandStone");
    m.box(-21, 0, 9, -18, 1.2, 11, "driftWood");
    m.box(-27, 0, -8, -24, 2.2, -5, "islandStone");
    m.box(-25, 0, 13, -22, 2.2, 16, "islandStone");
    m.box(-10, 0, -17, -7, 2.2, -14, "islandStone");
    for (const [x, z] of [[-35, -31], [-10, -34], [-37, 32]])
      conifer(m, x, z, 5.2, "seaBark", "seaPine", "seaPine", 0.9);
    for (const [x, z] of [[-37, -34], [-12, -34], [-37, 35], [-15, 31]])
      m.spawn(x, 0, z, yawTo(x, z, 0, 0), 0);
    m.pickup("hp", -25, 0, 6);
    m.pickup("ammo", -16, 0.5, 21);
  });
  // Two raised plank crossings, a central islet and open water all connect.
  m.box(-27, 0, -23, 27, 0.5, -19, "driftWood");
  m.box(-27, 0, 19, 27, 0.5, 23, "driftWood");
  m.box(-7, 0, -7, 7, 0.5, 7, "paleSand");
  for (const [x, z] of [[-22, -3], [-13, 5], [13, -5], [22, 3]])
    m.box(x - 2.5, 0, z - 2.5, x + 2.5, 0.5, z + 2.5, "paleSand");
  m.box(-3.5, 0.5, -3.5, -2, 1.45, -2, "islandStone");
  m.box(2, 0.5, 2, 3.5, 1.45, 3.5, "islandStone");
  m.box(-6, 0, 31, 6, 0.035, 34, "duneGrass", { solid: false });
  m.box(-6, 0, -34, 6, 0.035, -31, "duneGrass", { solid: false });
  m.pickup("shield", 0, 0.5, 0);
  eastWestStarts(m, 39);
  return m.build();
}

// A frozen stream divides two snowy camps, with three easy crossings.
export function frozenCreek() {
  const m = arena({
    id: "frozen_creek", name: "Frozen Creek",
    desc: "Cross a frozen creek by three footbridges or its level ice, then circle snowy shelters.",
    palette: {
      sky: "#8aa9cb", skyHorizon: "#dce8ea", fog: "#b9ced7", fogNear: 38, fogFar: 150,
      ambient: "#edf4fc", ambientIntensity: 0.7, hemiGround: "#8aabb8",
      sun: "#fff5dc", sunIntensity: 0.92, sunDir: [-0.48, -1, 0.3],
    },
    materials: {
      snow: { color: "#d7e4e5", rough: 1 },
      ice: { color: "#9fc9d2", rough: 0.35 },
      deepIce: { color: "#76aabf", rough: 0.35 },
      snowBank: { color: "#b6ccd0", rough: 1 },
      coldStone: { color: "#788c99", rough: 1 },
      frostWood: { color: "#827c70", rough: 1 },
      firNeedles: { color: "#537777", rough: 1 },
      firBark: { color: "#636666", rough: 1 },
    },
  }, 44, 42, "snow", "coldStone");
  m.box(-40, 0, -8, 40, 0.035, 8, "ice", { solid: false });
  for (const x of [-32, -16, 4, 23])
    m.box(x, 0.036, -2.5, x + 9, 0.055, 0.5, "deepIce", { solid: false });
  m.sym2(() => {
    // High snowbanks keep opposing spawn tents out of line of sight.
    m.box(-18, 0, -28.5, 18, 3.6, -27.3, "snowBank");
    for (const x of [-14, -5, 5, 14])
      m.box(x - 1.5, 1.25, -28.65, x + 1.5, 1.45, -28.48, "snow", { solid: false });
    cabin(m, -28, -19, "frostWood", "snowBank");
    cabin(m, 27, -19, "frostWood", "snowBank");
    for (const [x, z] of [[-37, -28], [36, -27], [-33, -12], [30, -10]])
      conifer(m, x, z, 5.6, "firBark", "firNeedles", "firNeedles", 0.9);
    m.box(-37, 0, -4, -33, 1.6, -2, "coldStone");
    m.box(32, 0, -18, 36, 1.6, -16, "coldStone");
    m.box(-16, 0, -3, -13, 1.7, -0.5, "coldStone");
    m.box(13, 0, -1.2, 16, 1.7, 1.3, "coldStone");
    m.box(-15, 0, -16, -7, 1.1, -14, "frostWood");
    m.box(8, 0, -13, 13, 1.4, -11, "coldStone");
    for (const [x, z] of [[-34, -35], [34, -35], [-38, -10], [38, -11]])
      m.spawn(x, 0, z, yawTo(x, z, 0, 0), 0);
    m.pickup("hp", -28, 0, -12);
    m.pickup("ammo", 24, 0, -24);
  });
  // All banks and bridge decks are a 0.5u step above the level creek bed.
  for (const [x0, x1] of [[-40, -27], [-13, 13], [27, 40]]) {
    m.box(x0, 0, -9.5, x1, 0.5, -8, "snowBank");
    m.box(x0, 0, 8, x1, 0.5, 9.5, "snowBank");
  }
  for (const x of [-24, 0, 24]) m.box(x - 2.2, 0, -11, x + 2.2, 0.5, 11, "frostWood");
  for (const x of [-24, 0, 24]) for (const z of [-8, 8])
    m.box(x - 2.4, 0.5, z - 0.22, x + 2.4, 1.1, z + 0.22, "coldStone");
  m.pickup("shield", 0, 0.5, 0);
  northSouthStarts(m, 36);
  return m.build();
}

// Broad loops thread a ring of huge trunks, fern banks and an old fallen log.
export function redwoodTrails() {
  const m = arena({
    id: "redwood_trails", name: "Redwood Trails",
    desc: "Wind around giant trunks, fallen logs and a dry creek to contest a climbable central stump.",
    palette: {
      sky: "#75988e", skyHorizon: "#bbd1bb", fog: "#9fbba5", fogNear: 32, fogFar: 150,
      ambient: "#dbe9d4", ambientIntensity: 0.58, hemiGround: "#4b5e48",
      sun: "#f5ebc5", sunIntensity: 0.82, sunDir: [0.4, -1, -0.52],
    },
    materials: {
      forestSoil: { color: "#6e795c", rough: 1 },
      redwoodBark: { color: "#865b49", rough: 1 },
      redwoodHeart: { color: "#a76f51", rough: 1 },
      redwoodLeaf: { color: "#456d58", rough: 1 },
      fern: { color: "#5b865b", rough: 1 },
      fernLight: { color: "#83a16c", rough: 1 },
      creekGravel: { color: "#999b82", rough: 1 },
      trailSoil: { color: "#987d60", rough: 1 },
      forestStone: { color: "#6a7971", rough: 1 },
    },
  }, 48, 46, "forestSoil", "forestStone");
  // The two broad, low trails ring the center and flank the fallen-log walls.
  for (const z of [-26, 23]) m.box(-43, 0.01, z, 43, 0.035, z + 3, "trailSoil", { solid: false });
  for (const x of [-40, 37]) m.box(x, 0.01, -38, x + 3, 0.035, 38, "trailSoil", { solid: false });
  m.sym2(() => {
    // A fallen giant shields the camp clearing. Its textured end is solid.
    m.box(-32, 0, -19, -30.4, 3.8, 19, "redwoodBark");
    m.box(-32.3, 0.65, -19, -32, 0.92, 19, "redwoodHeart", { solid: false });
    for (const [z, w] of [[-16, 1.3], [-8, 1.7], [1, 1.2], [10, 1.5], [17, 1.1]]) {
      m.box(-33, 0, z - w, -31.8, 1.1, z + w, "redwoodHeart");
      m.box(-32.5, 3.8, z - w, -30.3, 4.2, z + w, "redwoodBark");
    }
    for (const [x, z, h] of [[-24, -33, 9], [-10, -32, 10], [-25, 31, 8.5], [-9, 28, 10.5], [-19, -13, 9.5], [-16, 15, 9]])
      conifer(m, x, z, h, "redwoodBark", "redwoodLeaf", "fern", 1.55);
    m.box(-25, 0, -6, -19, 1.2, -4.5, "redwoodBark");
    m.box(-26, 0, 5, -22, 1.2, 6.5, "redwoodHeart");
    m.box(-13, 0, -21, -10, 2.1, -18, "forestStone");
    m.box(-22, 0, 22, -19, 1.4, 25, "forestStone");
    for (const [x, z, tx, tz] of [[-39, -34, 0, 0], [-12, -40, 9, 0], [-39, 34, 0, 0], [-13, 38, -7, 0]])
      m.spawn(x, 0, z, yawTo(x, z, tx, tz), 0);
    m.pickup("hp", -28, 0, -23);
    m.pickup("ammo", -11, 0, 22);
  });
  m.box(-36, 0.01, -2, 36, 0.035, 1, "creekGravel", { solid: false });
  // The central stump is reachable by two low root steps.
  m.box(-5, 0, -5, 5, 1, 5, "redwoodHeart");
  m.box(-8, 0, -2, -5, 0.5, 2, "redwoodBark");
  m.box(5, 0, -2, 8, 0.5, 2, "redwoodBark");
  m.box(-4, 1, -4, 4, 1.15, 4, "redwoodBark", { solid: false });
  for (const [x, z] of [[-7, -13], [7, 13], [-4, 15], [4, -15]]) {
    m.box(x - 1.8, 0, z - 1.8, x + 1.8, 1.1, z + 1.8, "fern", { solid: false });
    m.box(x - 1.2, 1.1, z - 1.2, x + 1.2, 1.5, z + 1.2, "fernLight", { solid: false });
  }
  m.pickup("shield", 0, 1, 0);
  eastWestStarts(m, 42);
  return m.build();
}

export const LARGE_WILD_MAPS = [
  pineCamp, lakesideCabins, marshBoardwalk, canyonCamp,
  islandCrossings, frozenCreek, redwoodTrails,
];
