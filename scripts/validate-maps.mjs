// Validate shared/data/maps/*.json:
//  - schema sanity (min<max, known materials, modes, everything inside bounds)
//  - floor coverage (no holes to the void inside bounds)
//  - spawns/pickups/nests: not inside solids, standing exactly on a floor top, enough team spawns
//  - reachability: every spawn/pickup/nest is in the same strongly-connected walk/jump/drop
//    graph as the first spawn, with no large reachable one-way areas
//    (coarse 0.5u grid using the canonical physics constants)
//  - spawn safety (team modes): no team-1 spawn has a clear line from its eye to the body centre
//    of a team-2 spawn inside fog range, so nobody can snipe the enemy spawn from their own base
// Usage: node scripts/validate-maps.mjs [mapId...]   (exit 1 on any error)
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeConsts, makeWorld, overlapsSolid, raycastWorld } from "../shared/ref/sim.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "shared/data");
const rules = JSON.parse(readFileSync(join(dataDir, "rules.json"), "utf8"));
const modes = JSON.parse(readFileSync(join(dataDir, "modes.json"), "utf8"));
const C = makeConsts(rules);
const JUMP_UP = (C.jumpVelocity * C.jumpVelocity) / (2 * C.gravity) - 0.15; // safe climb height
const PROBE = { ...C, halfWidth: 0.2 }; // thin probe for passages between grid cells
const PICKUP_TYPES = Object.keys(rules.pickups.types);

const want = process.argv.slice(2);
const files = readdirSync(join(dataDir, "maps")).filter((f) => f.endsWith(".json") && f !== "index.json");
const index = JSON.parse(readFileSync(join(dataDir, "maps", "index.json"), "utf8"));
const loaded = new Map();
let failed = false;

for (const f of files) {
  const map = JSON.parse(readFileSync(join(dataDir, "maps", f), "utf8"));
  if (want.length && !want.includes(map.id)) continue;
  loaded.set(map.id, map);
  const errs = [], warns = [];
  const E = (m) => errs.push(m), W = (m) => warns.push(m);
  const world = makeWorld(map);
  const bmin = map.bounds.min, bmax = map.bounds.max;
  const solids = map.boxes.filter((b) => b.solid !== false);

  // ---- schema
  if (map.format !== 1) E("format must be 1");
  if (`${map.id}.json` !== f) E(`id ${map.id} does not match filename ${f}`);
  for (const k of ["id", "name", "modes", "bounds", "palette", "materials", "boxes", "spawns", "pickups", "nests"]) if (!(k in map)) E(`missing ${k}`);
  for (const md of map.modes) if (!modes.modes[md]) E(`unknown mode ${md}`);
  map.boxes.forEach((b, i) => {
    for (let a = 0; a < 3; a++) {
      if (!(b.min[a] < b.max[a])) E(`box ${i} degenerate on axis ${a}`);
      if (b.min[a] < bmin[a] - 1e-9 || b.max[a] > bmax[a] + 1e-9) E(`box ${i} outside bounds`);
    }
    if (!map.materials[b.mat]) E(`box ${i} unknown material ${b.mat}`);
    if (b.solid !== false && Math.min(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) < 0.2) W(`box ${i} thinner than 0.2`);
  });
  if (map.boxes.length > 600) W(`many boxes (${map.boxes.length})`);
  const span = [bmax[0] - bmin[0], bmax[2] - bmin[2]];
  if (Math.max(...span) < 40 || Math.max(...span) > 110) W(`map span ${span} outside 40..110`);

  // ---- floor coverage: every 1u cell centre inside bounds has some solid under it
  let holes = 0;
  for (let x = bmin[0] + 0.5; x < bmax[0]; x += 1) for (let z = bmin[2] + 0.5; z < bmax[2]; z += 1) {
    if (!solids.some((b) => x > b.min[0] && x < b.max[0] && z > b.min[2] && z < b.max[2] && b.max[1] <= 0.001 + 50)) holes++;
  }
  if (holes) E(`${holes} floor holes (void under some cells)`);

  // ---- placed points
  const supported = (p) => solids.some((b) => Math.abs(b.max[1] - p[1]) < 1e-6 &&
    p[0] + C.halfWidth > b.min[0] && p[0] - C.halfWidth < b.max[0] && p[2] + C.halfWidth > b.min[2] && p[2] - C.halfWidth < b.max[2]);
  const checkPoint = (label, p) => {
    for (let a = 0; a < 3; a++) if (p[a] < bmin[a] || p[a] > bmax[a]) E(`${label} outside bounds`);
    if (overlapsSolid(world, C, p[0], p[1], p[2])) E(`${label} at ${p} is inside a solid`);
    if (!supported(p)) E(`${label} at ${p} is not standing on a floor top`);
  };
  map.spawns.forEach((s, i) => { checkPoint(`spawn ${i}`, s.pos); if (![0, 1, 2].includes(s.team)) E(`spawn ${i} bad team`); if (typeof s.yaw !== "number") E(`spawn ${i} yaw`); });
  map.pickups.forEach((p, i) => { checkPoint(`pickup ${i}`, p.pos); if (!PICKUP_TYPES.includes(p.type)) E(`pickup ${i} bad type ${p.type}`); });
  map.nests.forEach((n, i) => checkPoint(`nest ${i}`, n.pos));
  const t1 = map.spawns.filter((s) => s.team === 1).length, t2 = map.spawns.filter((s) => s.team === 2).length;
  if (map.spawns.length < 12) E(`need >= 12 spawns, have ${map.spawns.length}`);
  if ((map.modes.includes("teams") || map.modes.includes("nest")) && (t1 < 6 || t2 < 6)) E(`need >= 6 spawns per team (have ${t1}/${t2})`);
  if (map.modes.includes("nest")) for (const t of [1, 2]) if (map.nests.filter((n) => n.team === t).length !== 1) E(`need exactly one nest for team ${t}`);
  // spawn-to-enemy-spawn sightlines (eye -> body centre)
  if (map.modes.includes("teams") || map.modes.includes("nest")) {
    const fogFar = (map.palette && map.palette.fogFar) || Infinity;
    for (const a of map.spawns.filter((s) => s.team === 1)) for (const b of map.spawns.filter((s) => s.team === 2)) {
      const o = [a.pos[0], a.pos[1] + C.eyeHeight, a.pos[2]];
      const d = [b.pos[0] - o[0], b.pos[1] + 0.9 - o[1], b.pos[2] - o[2]];
      const L = Math.hypot(d[0], d[1], d[2]);
      if (L < fogFar && raycastWorld(world, o[0], o[1], o[2], d[0] / L, d[1] / L, d[2] / L, L) < 0) {
        E(`team-1 spawn ${a.pos} can see team-2 spawn ${b.pos} (${L.toFixed(1)}u): add cover or move a spawn`);
      }
    }
  }
  for (let i = 0; i < map.spawns.length; i++) for (let j = i + 1; j < map.spawns.length; j++) {
    const a = map.spawns[i].pos, b = map.spawns[j].pos;
    if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1.2) E(`spawns ${i} and ${j} overlap`);
  }

  // ---- reachability graph on a 0.5 grid
  const G = 0.5, nx = Math.round((bmax[0] - bmin[0]) / G), nz = Math.round((bmax[2] - bmin[2]) / G);
  const cellNodes = new Map(); // cellIdx -> [{h,id}]
  const nodes = [];
  for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
    const cx = bmin[0] + G * (i + 0.5), cz = bmin[2] + G * (k + 0.5);
    const hw = C.halfWidth - 0.05; // boxes under the (slightly shrunk) footprint can support the player
    const tops = [...new Set(solids.filter((b) => cx + hw > b.min[0] && cx - hw < b.max[0] && cz + hw > b.min[2] && cz - hw < b.max[2]).map((b) => b.max[1]))];
    const list = [];
    for (const h of tops) if (!overlapsSolid(world, C, cx, h, cz)) { const id = nodes.length; nodes.push({ id, i, k, h, cx, cz }); list.push({ h, id }); }
    if (list.length) cellNodes.set(i * nz + k, list);
  }
  const fwd = nodes.map(() => []), rev = nodes.map(() => []);
  for (const n of nodes) {
    for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = n.i + di, nk = n.k + dk;
      if (ni < 0 || nk < 0 || ni >= nx || nk >= nz) continue;
      const list = cellNodes.get(ni * nz + nk); if (!list) continue;
      for (const m of list) {
        const dh = m.h - n.h;
        if (dh > JUMP_UP) continue;
        const top = Math.max(n.h, m.h);
        const mx = (n.cx + nodes[m.id].cx) / 2, mz = (n.cz + nodes[m.id].cz) / 2;
        if (overlapsSolid(world, PROBE, mx, top + 0.001, mz)) continue;
        if (dh > C.stepHeight && overlapsSolid(world, PROBE, n.cx, m.h + 0.001, n.cz)) continue; // headroom to jump
        fwd[n.id].push(m.id); rev[m.id].push(n.id);
      }
    }
  }
  const nodeFor = (p) => {
    let best = -1, bd = Infinity;
    for (const n of nodes) {
      if (Math.abs(n.h - p[1]) > 1e-6) continue;
      const d = Math.hypot(n.cx - p[0], n.cz - p[2]);
      if (d < bd && d <= 0.75) { bd = d; best = n.id; }
    }
    return best;
  };
  const bfs = (start, adj) => { const seen = new Uint8Array(nodes.length); const q = [start]; seen[start] = 1; while (q.length) { const v = q.pop(); for (const w of adj[v]) if (!seen[w]) { seen[w] = 1; q.push(w); } } return seen; };
  const targets = [
    ...map.spawns.map((s, i) => [`spawn ${i}`, s.pos]),
    ...map.pickups.map((p, i) => [`pickup ${i} (${p.type})`, p.pos]),
    ...map.nests.map((n, i) => [`nest ${i}`, n.pos]),
  ];
  const start = nodeFor(map.spawns[0].pos);
  let reach = 0;
  if (start < 0) E("spawn 0 has no walk node");
  else {
    const a = bfs(start, fwd), b = bfs(start, rev);
    for (const [label, p] of targets) {
      const id = nodeFor(p);
      if (id < 0) { E(`${label} has no walk node`); continue; }
      if (!a[id]) E(`${label} at ${p} unreachable from spawn 0`);
      else if (!b[id]) E(`${label} at ${p} is a dead end (cannot get back)`);
      else reach++;
    }
    const stranded = nodes.filter((n) => a[n.id] && !b[n.id]);
    if (stranded.length) {
      const sample = stranded.slice(0, 3).map((n) => `(${n.cx}, ${n.h}, ${n.cz})`).join(", ");
      // Small isolated slivers can be artifacts of the coarse probe. A larger cluster is
      // a gameplay trap, such as a sunken channel a player can drop into but not exit.
      const report = `${stranded.length} reachable walk nodes cannot return to a spawn; examples: ${sample}`;
      if (stranded.length > 16) E(report);
      else W(report);
    }
  }

  const ok = errs.length === 0;
  failed ||= !ok;
  console.log(`${ok ? "OK  " : "FAIL"} ${map.id.padEnd(11)} ${map.boxes.length} boxes, ${map.spawns.length} spawns (T1 ${t1}/T2 ${t2}), ${map.pickups.length} pickups, ${map.nests.length} nests, ${nodes.length} walk nodes, ${reach}/${targets.length} targets connected`);
  for (const e of errs) console.log("   error:", e);
  for (const w of warns) console.log("   warn: ", w);
}
if (!want.length) {
  const errors = [];
  const ids = index.maps.map((m) => m.id);
  const fileIds = files.map((f) => f.slice(0, -5));
  for (const id of ids) if (ids.filter((x) => x === id).length !== 1) errors.push(`duplicate index id ${id}`);
  for (const id of ids) if (!fileIds.includes(id)) errors.push(`index refers to missing map ${id}`);
  for (const id of fileIds) if (!ids.includes(id)) errors.push(`map ${id} is absent from index`);
  for (const entry of index.maps) {
    const map = loaded.get(entry.id);
    if (typeof entry.group !== "string" || !entry.group.trim()) errors.push(`${entry.id} has no map group`);
    if (map && (entry.name !== map.name || entry.desc !== map.desc ||
      JSON.stringify([...entry.modes].sort()) !== JSON.stringify([...map.modes].sort()))) {
      errors.push(`${entry.id} metadata disagrees between index and map file`);
    }
  }
  for (const [modeId, mode] of Object.entries(modes.modes)) {
    for (const id of mode.maps) if (!ids.includes(id)) errors.push(`${modeId} rotation refers to missing map ${id}`);
    for (const id of ids) {
      const advertised = index.maps.find((m) => m.id === id)?.modes?.includes(modeId);
      if (advertised !== mode.maps.includes(id)) errors.push(`${id} and ${modeId} disagree between index and mode rotation`);
    }
    if (new Set(mode.maps).size !== mode.maps.length) errors.push(`${modeId} rotation has duplicate maps`);
  }
  if (errors.length) {
    failed = true;
    for (const error of errors) console.log("   error:", error);
  }
}
process.exit(failed ? 1 : 0);
