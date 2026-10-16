// Yolkout cartoon art library: the only module other game code imports for art (see docs/V2_SPEC.md 2.4).
// All builders return NEW object instances that share cached geometries and materials, so parts
// animate independently per instance.

export { buildGun, GUN_IDS } from "./guns.js";
export { buildHand, HAND_POSES, TP_HAND_SCALE } from "./hands.js";
export { buildMelee, MELEE_IDS } from "./melee.js";
export { buildGrenade, buildRocket, buildCasing } from "./throwables.js";
export { toonMaterial, fxMaterial, taggedMaterial, retagMaterials, addOutline, setOutlineQuality, getOutlineQuality, rampTexture, PAL } from "./toon.js";
export { modelStats } from "./geom.js";
export { crackTexture, crackStage, applyCrack, setCrack, eggGeometry, eggRadiusAt } from "./egg.js";
