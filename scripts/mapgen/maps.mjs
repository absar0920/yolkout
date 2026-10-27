// Original Yolkout arenas. Coordinates: Y up, ground top at y=0 unless noted.
// Team 1 (Sunnies) and Team 2 (Speckles) halves are 180/90-degree rotations so layouts are fair.
import { MapBuilder } from "./lib.mjs";
import { EAST_MAPS } from "./heritage-east.mjs";
import { WORLD_MAPS } from "./heritage-world.mjs";
import { MIDDLE_MAPS } from "./heritage-middle.mjs";
import { LARGE_WILD_MAPS } from "./large_wild.mjs";
import { LARGE_PRECISION_MAPS } from "./large_precision.mjs";
import { LARGE_MAZE_MAPS } from "./large_mazes.mjs";

const PI = Math.PI;
const ALL = ["ffa", "teams", "nest"];

// ------------------------------------------------------------------ Barnyard
export function barnyard() {
  const m = new MapBuilder({
    id: "barnyard", name: "Barnyard Brawl",
    desc: "A red barn with a hayloft, two chicken coops and a lot of hay to hide behind.",
    modes: ALL,
    bounds: { min: [-32, -10, -32], max: [32, 30, 32] },
    palette: {
      sky: "#8fd3ff", skyHorizon: "#d8f1ff", fog: "#cdeeff", fogNear: 40, fogFar: 130,
      ambient: "#ffffff", ambientIntensity: 0.55, hemiGround: "#6dbb4a",
      sun: "#fff1d6", sunIntensity: 1.25, sunDir: [-0.45, -1, -0.3],
    },
  });
  m.box(-32, -1, -32, 32, 0, 32, "grass");
  // dirt paths
  m.box(-2.5, 0, -24, 2.5, 0.02, 24, "dirt", { solid: false });
  m.box(-24, 0, -2, 24, 0.02, 2, "dirt", { solid: false });

  m.sym2(() => {
    // perimeter fence (two of four sides here, the rest via symmetry)
    m.box(-32, 0, -32, 32, 2.5, -31.5, "fence");
    m.box(-32, 0, -31.5, -31.5, 2.5, 32, "fence");

    // ---- barn: north wall + west wall + west hayloft (rotated copy gives the rest)
    m.wall("x", -8, 8, -6, -5.5, 0, 7, "barnred", [[-2.5, 2.5, 0, 4.5], [-6.5, -4.5, 4.5, 6], [4.5, 6.5, 4.5, 6]]);
    m.wall("z", -5.5, 5.5, -8, -7.5, 0, 7, "barnred", [[-3, 0, 0, 2.8], [-4.5, -3.5, 4.5, 6]]);
    // hayloft (top y = 3.5) + stairs along the west wall
    m.box(-7.5, 3, -5.5, -3, 3.5, 1.1, "plank");
    m.stairs("-x", -1, 1.1, 2.6, 7, "plank"); // rises toward the west wall, top step meets the loft edge
    m.box(-3.2, 3.5, -5.5, -3, 4.5, -2, "plank"); // railing
    // hay inside the barn, under the loft
    m.box(-7.3, 0, -5.3, -5.3, 1, -3.3, "hay");
    m.box(-7.3, 0, 3, -5.3, 1, 5, "hay");

    // ---- chicken coop (team 1 base on the north side)
    m.box(-6, 0, -30, 6, 3.5, -29.5, "barntrim");
    m.wall("z", -29.5, -24, -6, -5.5, 0, 3.5, "barntrim", [[-28, -26, 1.2, 2.4]]);
    m.wall("z", -29.5, -24, 5.5, 6, 0, 3.5, "barntrim", [[-28, -26, 1.2, 2.4]]);
    m.box(-6.5, 3.5, -30, 6.5, 4, -23.5, "roof");
    m.box(-6.5, 4, -24, -1.5, 4.6, -23.5, "barntrim"); // parapet, gap in the middle
    m.box(1.5, 4, -24, 6.5, 4.6, -23.5, "barntrim");
    m.stairs("-z", -23.5, 6.5, 8, 8, "plank");
    m.box(-4.5, 0, -29.4, -2.5, 0.8, -28.4, "hay"); // nesting boxes
    m.box(2.5, 0, -29.4, 4.5, 0.8, -28.4, "hay");
    m.nest(1, 0, 0, -27);

    // ---- yard cover
    m.box(-20, 0, -20, -16, 10, -16, "metal"); // silo
    m.box(-20.4, 10, -20.4, -15.6, 10.8, -15.6, "roof");
    m.box(-18, 0, -14.3, -8, 1, -14, "fence"); // low fences
    m.box(10, 0, -14.3, 20, 1, -14, "fence");
    m.box(24, 0, -12, 24.3, 1, -4, "fence");
    m.box(10, 0, -11, 14, 0.8, -10, "water"); // trough
    m.box(11.5, 0, -12.6, 13.5, 1.6, -11.4, "hay"); // stacked bale: breaks the east spawn-to-spawn sightline
    // tractor
    m.box(-22, 0, -4, -18, 1.6, -1, "tractor");
    m.box(-21.5, 1.6, -3.5, -19.5, 3, -1.5, "glass");
    m.box(-22.4, 0, -4.4, -21.4, 1.5, -3.2, "tire");
    m.box(-18.6, 0, -4.4, -17.6, 1.5, -3.2, "tire");
    // hay bale pyramid (jump-climbable, top y = 3)
    m.box(18, 0, -24, 24, 1, -18, "hay");
    m.box(19, 1, -23, 24, 2, -19, "hay");
    m.box(20.5, 2, -22.5, 24, 3, -19.5, "hay");
    // scattered bales
    m.box(-14, 0, -24, -12, 1, -23, "hay");
    m.box(-13.5, 1, -24, -12.5, 2, -23, "hay");
    m.box(12, 0, -4, 14, 1, -3, "hay");
    m.box(-26, 0, 6, -25, 1, 8, "hay");
    m.box(-4, 0, -12, -2, 1.2, -10.5, "crate");

    // ---- spawns (team 1 north, FFA-only scattered)
    for (const [x, z] of [[-3.5, -26.5], [3.5, -26.5], [-10, -27], [10.5, -26], [-13, -21], [13, -21]]) m.spawn(x, 0, z, PI, 1);
    m.spawn(-26, 0, -14, PI * 0.75, 0);
    m.spawn(-14, 0, -2, -PI / 2, 0);
    m.spawn(18, 0, -10, PI / 2, 0);
    m.spawn(-5, 3.5, -4, -PI / 2, 0);

    // ---- pickups
    m.pickup("hp", -24, 0, 0);
    m.pickup("ammo", -12, 0, -18);
    m.pickup("hp", -5, 3.5, -1);
    m.pickup("ammo", 22.3, 3, -21);
  });
  // centre of barn (not mirrored)
  m.box(-1.5, 0, -1, 1.5, 1.2, 1, "hay");
  m.box(-0.75, 1.2, -0.5, 0.75, 2.2, 0.5, "hay");
  m.box(-8.5, 7, -6.5, 8.5, 7.5, 6.5, "roof");
  m.box(-8.5, 7.5, -3.5, 8.5, 8.5, 3.5, "roof");
  m.pickup("shield", 0, 2.2, 0);
  return m.build();
}

// ------------------------------------------------------------------ Countertop
export function countertop() {
  const m = new MapBuilder({
    id: "countertop", name: "Countertop",
    desc: "Egg-sized warfare on a giant kitchen counter: sink canyon, spoon bridge, pancake tower.",
    modes: ALL,
    bounds: { min: [-28, -12, -20], max: [28, 30, 20] },
    palette: {
      sky: "#fff3e0", skyHorizon: "#ffe6c4", fog: "#f7e7cf", fogNear: 35, fogFar: 110,
      ambient: "#fff7ec", ambientIntensity: 0.7, hemiGround: "#d9d2c5",
      sun: "#fffaf0", sunIntensity: 1.0, sunDir: [0.3, -1, 0.45],
    },
  });
  // counter slab with a sink hole x,z in [-5,5]x[-4,4]
  m.box(-28, -4, -20, -5, 0, 20, "counter");
  m.box(5, -4, -20, 28, 0, 20, "counter");
  m.box(-5, -4, -20, 5, 0, -4, "counter");
  m.box(-5, -4, 4, 5, 0, 20, "counter");
  m.box(-5, -4, -4, 5, -3, 4, "steel"); // sink basin floor (top -3)
  m.box(-28, 0, -20, 28, 10, -19.5, "tile"); // backsplash
  m.box(-28, 0, 19.6, 28, 0.4, 20, "wood"); // front lip
  // faucet (centre back) + spoon bridge
  m.box(-0.75, 0, -6, 0.75, 6, -4.8, "steel");
  m.box(-0.6, 5, -4.8, 0.6, 5.8, -1.5, "steel");
  m.box(-6, 0, -0.5, 6, 0.3, 0.5, "wood");
  m.pickup("shield", 0, 0.3, 0);

  m.sym2(() => {
    // sink stairs (from basin floor -3 up to 0)
    m.stairs("-x", -1, -3.8, -2.6, 6, "jar", { y0: -3 });
    m.box(2, -3, -3.5, 3.5, -2, -2.5, "butter", {}); // sponge
    // toaster
    m.box(-17, 0, -16, -11, 5, -12, "toaster");
    m.box(-16, 5, -15.4, -12, 5.2, -14.6, "steel", { solid: false });
    m.box(-16, 5, -13.4, -12, 5.2, -12.6, "steel", { solid: false });
    // tall cereal box + fallen cereal box with measuring-cup step
    m.box(-22, 0, -9, -19, 9, -7, "cardboard");
    m.box(-9, 0, 10, -3, 1.9, 13, "cardboard");
    m.box(-10.2, 0, 10.5, -9, 0.9, 11.7, "jar");
    // cutting board + pancake stack (stepped, top y = 3.0)
    m.box(-24, 0, 6, -16, 0.5, 14, "wood");
    for (let k = 0; k < 5; k++) m.box(-23 + 0.5 * k, 0.5 + 0.5 * k, 7 + 0.5 * k, -17 - 0.5 * k, 1 + 0.5 * k, 13 - 0.5 * k, "pancake");
    // spice jars
    m.box(-12, 0, -4, -10.5, 3, -2.5, "spice");
    m.box(-12, 0, 2.5, -10.5, 2.2, 4, "jar");
    m.box(-6, 0, -12, -4.5, 3.4, -10.5, "spice");
    m.box(-15, 0, 15, -13.5, 2.6, 16.5, "spice");
    // bread basket (team 1 base)
    m.box(-27.5, 0, -4.5, -27, 1.2, 4.5, "bread");
    m.box(-27, 0, -4.5, -22, 1.2, -4, "bread");
    m.box(-27, 0, 4, -22, 1.2, 4.5, "bread");
    m.nest(1, -25, 0, 0);
    // butter dish in front of the base: blocks the spawn-to-spawn sightline down the bridge lane
    m.box(-19.5, 0, -2.5, -18.5, 2.5, 2.5, "butter");

    for (const [x, z] of [[-24.5, -2], [-24.5, 2], [-26, -10], [-26, 10], [-21, -2], [-21, -17.5]]) m.spawn(x, 0, z, -PI / 2, 1);
    m.spawn(-12, 0, 0, -PI / 2, 0);
    m.spawn(-14, 0, 17.5, PI, 0);
    m.spawn(-6, 0, -16, 0, 0);
    m.spawn(-10, 0, 7, -PI / 2, 0);

    m.pickup("hp", -14, 0, 6);
    m.pickup("ammo", -20, 3, 10);
    m.pickup("hp", 2, -3, 2);
    m.pickup("ammo", -8, 0, -18);
  });
  return m.build();
}

// ------------------------------------------------------------------ Hatchery
export function hatchery() {
  const m = new MapBuilder({
    id: "hatchery", name: "The Hatchery",
    desc: "An industrial egg plant: incubator rooms, conveyor lanes, a catwalk ring and the central pit.",
    modes: ALL,
    bounds: { min: [-30, -12, -30], max: [30, 30, 30] },
    palette: {
      sky: "#2b3440", skyHorizon: "#46525f", fog: "#38424e", fogNear: 25, fogFar: 95,
      ambient: "#cfe0ff", ambientIntensity: 0.6, hemiGround: "#5d6670",
      sun: "#ffe2b8", sunIntensity: 0.95, sunDir: [0.35, -1, 0.2],
    },
  });
  // q0 room = team 1, q2 room = team 2, q1/q3 neutral
  const teamOf = (q, t) => (t === 0 ? 0 : q === 0 ? 1 : q === 2 ? 2 : 0);
  m.sym4((b, q) => {
    b.box(-30, -4, -30, 6, 0, -6, "concrete"); // pinwheel floor slab
    b.box(-6, -4, -6, 0, -2.5, 0, "grate"); // pit floor quarter (top -2.5)
    b.stairs("-z", -3, -5.5, -4, 5, "hazard", { y0: -2.5 }); // pit exit
    // catwalk ring segment + corner pillar + stairs
    b.box(-10, 3.6, -10, 8, 4, -8, "grate");
    b.box(-10, 0, -10, -9.4, 3.6, -9.4, "metal");
    b.stairs("+x", -2, -11.5, -10, 8, "hazard");
    // bridge from ring to the corner room roof (L shape)
    b.box(-18, 3.6, -10, -10, 4, -8.5, "grate");
    b.box(-19.5, 3.6, -18, -18, 4, -8.5, "grate");
    // incubator room
    b.box(-29, 0, -29, -28.5, 3.6, -18, "incubator");
    b.box(-28.5, 0, -29, -18, 3.6, -28.5, "incubator");
    b.wall("z", -28.5, -18, -18.5, -18, 0, 3.6, "incubator", [[-25, -22, 0, 2.6], [-27.5, -26.5, 1.2, 2.4]]);
    b.wall("x", -28.5, -18.5, -18.5, -18, 0, 3.6, "incubator", [[-25, -22, 0, 2.6], [-27.5, -26.5, 1.2, 2.4]]);
    b.box(-29, 3.6, -29, -18, 4, -18, "metal"); // roof (top 4)
    b.box(-28.5, 0, -26, -27.6, 1.2, -23.5, "glow"); // incubator racks
    b.box(-26, 0, -28.5, -23.5, 1.2, -27.6, "glow");
    // conveyor lane + crates
    b.box(-24, 0, -16, -12, 1, -14.5, "belt");
    b.box(-16, 1, -16, -14.5, 2, -14.5, "crate");
    b.box(-22, 1, -16, -20.5, 1.8, -14.5, "crate");
    // big pillars + crate stacks
    b.box(-16, 0, -6, -14.8, 5, -4.8, "concrete");
    b.box(-6, 0, -22, -3, 1.2, -19, "crate");
    b.box(-5, 1.2, -21.5, -3.5, 2.4, -20, "crate");
    b.box(-24, 0, -8, -22.8, 1.4, -2, "hazard");

    for (const [x, z] of [[-27, -27], [-27, -21], [-21, -27], [-21, -21], [-16, -24]]) b.spawn(x, 0, z, -PI * 0.75, 1);
    b.spawn(-24, 0, -11, -PI * 0.75, 1);
    b.spawn(-4, 4, -9, -PI / 2, 0);
    b.nest(1, -23.5, 0, -23.5);

    b.pickup("hp", -16, 0, -10);
    b.pickup("ammo", -24, 4, -24);
    if (q === 0 || q === 2) b.pickup("shield", -3, -2.5, -3);
  }, teamOf);
  // central incubator column
  m.box(-1.5, -2.5, -1.5, 1.5, 6, 1.5, "incubator");
  m.box(-1.6, 2.4, -1.6, 1.6, 2.8, 1.6, "glow", { solid: false });
  // keep only the two team nests (q1/q3 nests became team 0)
  m.nests = m.nests.filter((n) => n.team !== 0);
  return m.build();
}

// ------------------------------------------------------------------ Diner
export function diner() {
  const m = new MapBuilder({
    id: "diner", name: "Sunrise Diner",
    desc: "A roadside diner at dawn: booth fights inside, roof duels under the neon sign, cars and trailers outside.",
    modes: ALL,
    bounds: { min: [-28, -10, -22], max: [28, 30, 22] },
    palette: {
      sky: "#ffb48a", skyHorizon: "#ffd9a8", fog: "#f7c39b", fogNear: 35, fogFar: 115,
      ambient: "#ffe7d6", ambientIntensity: 0.55, hemiGround: "#4a4d52",
      sun: "#ffc27a", sunIntensity: 1.3, sunDir: [0.8, -0.55, 0.25],
    },
  });
  m.box(-28, -1, -22, 28, 0, 22, "asphalt");
  m.box(-14, 0, -6, 14, 0.05, 6, "checker", { solid: false }); // diner floor decal
  // counter + roof + sign (centred)
  m.box(-6, 0, -0.6, 6, 1.1, 0.6, "chrome");
  m.box(-14.5, 4, -6.5, 14.5, 4.5, 6.5, "roof");
  m.box(-5, 6, -0.2, 5, 8, 0.2, "neon");
  m.pickup("shield", 0, 4.5, -3);

  m.sym2(() => {
    // walls: north (z -6..-5.5) with windows + door, west (x -14..-13.5) with door
    m.wall("x", -14, 14, -6, -5.5, 0, 4, "dinerwall", [[-12, -8.5, 1, 2.6], [-6, -1, 1, 2.6], [1, 4, 1, 2.6], [7, 9, 0, 2.6], [10, 12.5, 1, 2.6]]);
    m.wall("z", -5.5, 5.5, -14, -13.5, 0, 4, "dinerwall", [[-1.5, 1.5, 0, 2.6], [-4.5, -2.5, 1, 2.6]]);
    // booths along the north wall (seat backs 1.3 high)
    for (const x of [-12, -6.5, -1]) {
      m.box(x, 0, -5.5, x + 0.4, 1.3, -3.8, "vinyl");
      m.box(x + 0.4, 0, -5.4, x + 2.6, 0.9, -4.0, "chrome"); // table
      m.box(x + 2.6, 0, -5.5, x + 3, 1.3, -3.8, "vinyl");
    }
    // stools along the counter
    for (const x of [-5, -3, -1]) m.box(x - 0.3, 0, 1.2, x + 0.3, 0.7, 1.8, "vinyl");
    // kitchen pass + grill block (west end)
    m.box(-13.5, 0, 2.5, -10, 1.1, 5.5, "steel");
    // host stand by the west window: breaks the spawn-to-spawn sightline through both doors
    m.box(-12.5, 0, -3.5, -11.5, 1.5, -2.3, "chrome");
    // roof sign post + AC units
    m.box(-4.5, 4.5, -0.2, -4, 6, 0.2, "chrome");
    m.box(-11, 4.5, -3, -9, 5.7, -1, "metal");
    // roof stairs outside the north wall
    m.stairs("+x", -13, -8, -6.5, 9, "pallet");
    // parking lot: cars
    m.box(-21, 0, -16, -19, 1.1, -12, "car1");
    m.box(-20.9, 1.1, -15, -19.1, 1.9, -13, "glass");
    m.box(-9, 0, -14, -5, 1.1, -12, "car2");
    m.box(-8, 1.1, -13.9, -6, 1.9, -12.1, "glass");
    // dumpster + trailer with pallet steps
    m.box(-24, 0, 4, -21, 1.3, 6, "dumpster");
    m.box(-10, 0, 13, 2, 3.5, 16, "trailer");
    m.stairs("-x", 4.7, 13, 16, 3, "pallet", { rise: 1, run: 0.9 });
    // lot dividers
    m.box(-18, 0, -20, -17.6, 0.6, -10, "paint");
    m.box(-15, 0, -11, -13, 1.6, -9, "dumpster"); // recycling bin: cover across the lot lane
    m.box(14, 0, -21.5, 22, 1, -21, "paint");
    m.nest(1, -25, 0, 0);

    for (const [x, z] of [[-25, -4], [-25, 4], [-23, -10], [-23, 10], [-26, -17], [-20, 1]]) m.spawn(x, 0, z, -PI / 2, 1);
    m.spawn(-11, 0, -2, -PI / 2, 0);
    m.spawn(-6, 4.5, 4, -PI / 2, 0);
    m.spawn(-14, 0, -18, 0, 0);
    m.spawn(-14, 0, 18, PI, 0);

    m.pickup("hp", -10, 0, -2.5);
    m.pickup("ammo", -20, 0, 8);
    m.pickup("hp", -4, 3.5, 14.5);
  });
  return m.build();
}

export const MAP_GROUPS = [
  { label: "Original arenas", builders: [barnyard, countertop, hatchery, diner] },
  { label: "Historic landscapes", builders: [...EAST_MAPS, ...MIDDLE_MAPS, ...WORLD_MAPS] },
  { label: "Outdoors and water", builders: LARGE_WILD_MAPS },
  { label: "Long range", builders: LARGE_PRECISION_MAPS },
  { label: "Mazes and city", builders: LARGE_MAZE_MAPS },
];

export const ALL_MAPS = MAP_GROUPS.flatMap((group) => group.builders);
