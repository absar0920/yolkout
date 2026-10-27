// Regenerate shared/data/maps/*.json from maps.mjs.  Usage: node scripts/mapgen/build.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_MAPS, MAP_GROUPS } from "./maps.mjs";

const out = join(dirname(fileURLToPath(import.meta.url)), "../../shared/data/maps");
mkdirSync(out, { recursive: true });
const index = [];
const groupFor = new Map(MAP_GROUPS.flatMap((group) => group.builders.map((make) => [make, group.label])));
for (const make of ALL_MAPS) {
  const map = make();
  // one box per line keeps diffs readable and the file compact
  writeFileSync(join(out, `${map.id}.json`), serialize(map));
  index.push({ id: map.id, name: map.name, desc: map.desc, modes: map.modes, group: groupFor.get(make) });
  console.log(`${map.id}: ${map.boxes.length} boxes, ${map.spawns.length} spawns, ${map.pickups.length} pickups, ${map.nests.length} nests`);
}
writeFileSync(join(out, "index.json"), JSON.stringify({ maps: index }, null, 2) + "\n");

// Pretty top level, one compact line per array element / object entry.
function serialize(map) {
  const parts = Object.entries(map).map(([k, v]) => {
    if (Array.isArray(v) && v.length && typeof v[0] === "object") {
      return `  ${JSON.stringify(k)}: [\n${v.map((e) => "    " + JSON.stringify(e)).join(",\n")}\n  ]`;
    }
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const inner = Object.entries(v).map(([k2, v2]) => `    ${JSON.stringify(k2)}: ${JSON.stringify(v2)}`).join(",\n");
      return `  ${JSON.stringify(k)}: {\n${inner}\n  }`;
    }
    return `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`;
  });
  return `{\n${parts.join(",\n")}\n}\n`;
}
