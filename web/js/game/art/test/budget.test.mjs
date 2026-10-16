// Node test (no DOM): art API shape + geometry budgets from docs/V2_SPEC.md 4.3 - 4.6.
// Run: node web/js/game/art/test/budget.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import * as THREE from "../../../../vendor/three.module.min.js";
import {
  buildGun, buildHand, buildMelee, buildGrenade, buildRocket, buildCasing, toonMaterial, addOutline, setOutlineQuality, modelStats, HAND_POSES, MELEE_IDS, GUN_IDS,
} from "../index.js";

const W = JSON.parse(fs.readFileSync(new URL("../../../../../shared/data/weapons.json", import.meta.url), "utf8"));
let checks = 0;
const ok = (c, msg) => { assert.ok(c, msg); checks++; };

// every weapon id in the data has a real design
for (const id of [...W.primaries, W.secondary]) ok(GUN_IDS.includes(id), `gun design for ${id}`);
for (const id of W.melees || [W.melee]) ok(MELEE_IDS.includes(id), `melee design for ${id}`);
ok(HAND_POSES.length === 8, "8 hand poses");

const MAG = new Set(["benedict", "frittata", "poacher", "overeasy", "coddler"]);
const v = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
for (const id of GUN_IDS) {
  for (const lod of ["fp", "tp"]) {
    const g = buildGun(id, { lod });
    const st = g.stats;
    if (lod === "fp") ok(st.tris <= 3000 && st.drawCalls <= 5, `${id} fp budget ${st.tris} tris ${st.drawCalls} dc`);
    else ok(st.tris <= 800 && st.drawCalls <= 2, `${id} tp budget ${st.tris} tris ${st.drawCalls} dc`);
    ok(g.group.isGroup && g.muzzle.isVector3, `${id} group + muzzle`);
    for (const k of ["muzzle", "sight", "rightGrip", "leftGrip"]) ok(g.sockets[k] && g.sockets[k].isObject3D, `${id}/${lod} socket ${k}`);
    ok(g.sockets.rightGrip.userData.pose === "trigger", `${id} rightGrip pose`);
    ok(["grip", "cup"].includes(g.sockets.leftGrip.userData.pose), `${id} leftGrip pose`);
    ok(g.muzzle.distanceTo(g.sockets.muzzle.position) < 1e-9, `${id} muzzle == sockets.muzzle`);
    if (MAG.has(id)) {
      ok(g.parts.mag && g.sockets.magGrip, `${id}/${lod} mag + magGrip`);
      ok(g.sockets.magGrip.parent === g.parts.mag, `${id}/${lod} magGrip child of mag`);
      ok(g.travel.mag && g.travel.mag.dist > 0, `${id} travel.mag`);
    }
    if (lod !== "fp") continue;
    ok(!!g.parts.trigger, `${id} trigger part`);
    for (const [name, part] of Object.entries(g.parts)) {
      ok(part.userData.rest && part.userData.rest.position.isVector3 && part.userData.rest.quaternion.isQuaternion, `${id} part ${name} rest`);
    }
    if (id !== "souffle") ok(g.sockets.ejector && g.sockets.chargeGrip, `${id} ejector + chargeGrip`);
    else ok(!g.sockets.ejector && !g.sockets.chargeGrip && g.sockets.tubeBack && g.sockets.loadPort && g.parts.rocket && g.travel.rocket, "souffle launcher sockets");
    if (MAG.has(id)) ok(g.sockets.magWell, `${id} magWell`);
    if (id === "deviler") ok(g.parts.pump && g.parts.shell && !g.parts.shell.visible && g.sockets.loadPort && g.travel.pump && g.sockets.leftGrip.parent === g.parts.pump, "deviler pump/shell");
    if (id === "piercer") ok(g.parts.bolt && g.parts.clip && !g.parts.clip.visible && g.travel.bolt.lift > 0 && g.sockets.chargeGrip.parent === g.parts.bolt && g.sockets.loadPort, "piercer bolt/clip");
    if (id === "coddler") ok(g.parts.slide && g.travel.slide && g.sockets.chargeGrip.parent === g.parts.slide, "coddler slide");
    if (["benedict", "frittata", "poacher", "overeasy"].includes(id)) ok(g.parts.bolt && g.travel.bolt && g.sockets.chargeGrip.parent === g.parts.bolt, `${id} bolt`);
    // hands placed on the sockets match exactly
    for (const [side, sock] of [["R", g.sockets.rightGrip], ["L", g.sockets.leftGrip]]) {
      const h = buildHand(side, { lod: "fp" });
      h.setPose(sock.userData.pose);
      sock.add(h.group);
      g.group.updateMatrixWorld(true);
      h.group.matrixWorld.decompose(v, q, s);
      const sv = new THREE.Vector3().setFromMatrixPosition(sock.matrixWorld);
      ok(v.distanceTo(sv) < 1e-9 && Math.abs(s.x - 1) < 1e-9, `${id} ${side} hand on socket`);
    }
    g.dispose();
  }
}

// hands
for (const side of ["L", "R"]) {
  const fp = buildHand(side, { lod: "fp", color: "#9fd6e0" });
  ok(fp.mesh.isSkinnedMesh && fp.skeleton.bones.length === 16, `${side} fp hand skinned 16 bones`);
  const st = modelStats(fp.group);
  ok(st.tris <= 1200 && st.drawCalls === 1 && st.outlineCalls === 1, `${side} fp hand budget ${st.tris}`);
  for (const p of HAND_POSES) { fp.setPose(p); fp.setPose("open", p, 0.5); }
  ok(fp.points.hold && fp.points.pinch && fp.points.palm, `${side} hand points`);
  fp.setColor("#ff0000");
  const tp = buildHand(side, { lod: "tp" });
  ok(modelStats(tp.group).tris <= 150, `${side} tp hand <= 150 tris (${modelStats(tp.group).tris})`);
  for (const p of HAND_POSES) tp.setPose(p);
}

// melee
for (const id of MELEE_IDS) {
  const fp = buildMelee(id, { lod: "fp" }), tp = buildMelee(id, { lod: "tp" });
  ok(fp.stats.tris <= 1500 && fp.stats.drawCalls === 1, `${id} fp melee ${fp.stats.tris}`);
  ok(tp.stats.tris <= 300 && tp.stats.drawCalls === 1, `${id} tp melee ${tp.stats.tris}`);
  ok(fp.sockets.grip && fp.sockets.impact && fp.sockets.impact.position.y > 0.1, `${id} sockets`);
}

// throwables
const n = buildGrenade({ lod: "fp" });
ok(n.isObject3D && n.group === n && n.sockets.grip && n.parts.spark, "grenade api");
const r = buildRocket({ lod: "tp" });
ok(r.group && r.sockets.nose.position.z < 0 && r.sockets.tail.position.z > 0 && r.parts.flame && !r.parts.flame.visible, "rocket api");
for (const k of ["brass", "shell"]) {
  const g = buildCasing(k);
  ok(g.index.count / 3 <= 60 && g.attributes.color && g.attributes.aFx, `casing ${k} <= 60 tris`);
}

// materials are cached + outlines toggle
ok(toonMaterial("#123456") === toonMaterial("#123456"), "toon material cache");
const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), toonMaterial("#ffffff"));
const ol = addOutline(box, { width: 0.01 });
ok(ol.length === 1 && box.geometry.attributes.outlineNormal, "outline added");
setOutlineQuality("low");
ok(ol[0].material.visible === false, "low hides outlines");
setOutlineQuality("high");
ok(ol[0].material.visible === true, "high shows outlines");

console.log(`art budget test: ${checks} checks OK`);
