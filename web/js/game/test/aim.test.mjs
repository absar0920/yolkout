import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aimDir, shotDirs } from "../../../../shared/ref/sim.mjs";

const weapons = JSON.parse(readFileSync(new URL("../../../../shared/data/weapons.json", import.meta.url)));
const yaw = 0.7, pitch = -0.25;
const crosshair = aimDir(yaw, pitch);
let checks = 0;

for (const [id, weapon] of Object.entries(weapons.weapons)) {
  if (weapon.pellets !== 1) continue; // shotgun pellets intentionally form a cone
  for (const aiming of [false, true]) {
    for (const moving of [false, true]) {
      const spread = (aiming ? weapon.adsSpread : weapon.hipSpread) +
        (moving ? weapon.moveSpread : 0) + weapon.bloomMax;
      const direction = shotDirs(7, 11, yaw, pitch, spread, 1)[0];
      assert.ok(Math.hypot(...direction.map((v, i) => v - crosshair[i])) < 1e-12,
        `${id} must shoot through the crosshair while ${moving ? "moving" : "still"}${aiming ? " and aiming" : ""}`);
      checks++;
    }
  }
}

assert.ok(checks > 0);
console.log(`aim.test: ${checks} crosshair checks OK`);
