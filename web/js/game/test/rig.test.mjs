// Node test (no DOM): every first-person timeline keeps the hands on their sockets wherever a key says so
// (docs/V2_SPEC.md 7, item 6), and no hand teleports between samples.
// Run: node web/js/game/test/rig.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import * as THREE from "../../../vendor/three.module.min.js";
import { ViewModel, GUN_SCALE } from "../viewmodel.js";
import { SOCK } from "../vm/rig.js";

const W = JSON.parse(fs.readFileSync(new URL("../../../../shared/data/weapons.json", import.meta.url), "utf8"));
const data = { weapons: W };
const R = { vmCamera: new THREE.PerspectiveCamera(62, 16 / 9, 0.01, 10), vmFlash: { intensity: 0 } };
const vm = new ViewModel(R, data);
const st = { speed: 0, vx: 0, vz: 0, vy: 0, yaw: 0, onGround: true, ads: 0, adsTime: 0.2, reloadFrac: -1, switchFrac: -1, scoped: false, bob: true, mag: 3, alive: true };

const GUNS = [...W.primaries, W.secondary];
const MELEES = W.melees || [W.melee];
const TOL = 0.01 * GUN_SCALE; // 0.01 gun units, in view metres
let checks = 0, worst = 0, worstJump = 0;
const pS = new THREE.Vector3(), pH = new THREE.Vector3();

function socketOf(target) {
  if (typeof target === "string") return SOCK[target] || target;
  if (target && target.s && !target.o && !target.go && !target.r) return target.s;
  if (target && target.item && !target.go) return "item";
  return null;
}

function checkFrame(label, tl, f) {
  for (const side of ["L", "R"]) {
    const keys = tl && tl[side];
    if (!keys) continue;
    // the key segment around f
    let i = 0;
    while (i < keys.length - 1 && f >= keys[i + 1][0]) i++;
    const a = keys[i][1], b = keys[Math.min(keys.length - 1, i + 1)][1];
    const exact = Math.abs(keys[i][0] - f) < 1e-9;
    const sa = socketOf(a), sb = socketOf(b);
    let sock = null;
    if (exact && sa) sock = sa; else if (sa && sa === sb && JSON.stringify(a) === JSON.stringify(b)) sock = sa;
    if (!sock) continue;
    const g = vm.current;
    const obj = sock === "item" ? vm._itemAnchor : g.sockets[sock];
    if (!obj) continue;
    obj.updateWorldMatrix(true, false);
    pS.setFromMatrixPosition(obj.matrixWorld);
    pH.setFromMatrixPosition(vm.hands[side].group.matrixWorld);
    const d = pS.distanceTo(pH);
    worst = Math.max(worst, d);
    assert.ok(d <= TOL, `${label} ${side} at f=${f.toFixed(3)}: hand ${d.toFixed(4)} m from ${sock}`);
    checks++;
  }
}

function run(label, name, id, opts = {}) {
  const tl0 = (() => { vm.freezeEmpty = !!opts.empty; vm.freeze(name, 0); vm.update(1 / 60, st); return vm.activeTl; })();
  assert.ok(tl0, `${label}: timeline exists`);
  const end = tl0.unit === "s" ? tl0.end : 1;
  const fr = new Set();
  for (let i = 0; i <= 50; i++) fr.add(i / 50);
  for (const side of ["L", "R"]) for (const k of tl0[side] || []) fr.add(Math.min(1, k[0] / end));
  const list = [...fr].sort((x, y) => x - y);
  const prev = { L: null, R: null };
  const secs = tl0.unit === "s" ? tl0.end : (opts.dur || 2);
  let lastFrac = 0;
  for (const frac of list) {
    const dts = (frac - lastFrac) * secs;
    lastFrac = frac;
    vm.freeze(name, frac);
    vm.update(1 / 60, st);
    const tl = vm.activeTl;
    const f = tl.unit === "s" ? frac * tl.end : frac;
    checkFrame(label, tl, f);
    for (const side of ["L", "R"]) {
      const p = new THREE.Vector3().setFromMatrixPosition(vm.hands[side].group.matrixWorld);
      assert.ok(Number.isFinite(p.x + p.y + p.z), `${label} ${side} finite`);
      if (prev[side]) {
        const j = p.distanceTo(prev[side]);
        // a teleport: a big step in (almost) no time, or faster than a melee strike
        assert.ok(!(j > 0.05 && dts < 0.004), `${label} ${side} teleports ${j.toFixed(3)} m at f=${frac.toFixed(3)}`);
        if (dts > 1e-4) { const sp = j / dts; worstJump = Math.max(worstJump, sp); assert.ok(sp < (/melee|grenade/.test(label) ? 25 : 9), `${label} ${side} moves ${sp.toFixed(1)} m/s at f=${frac.toFixed(3)}`); }
      }
      prev[side] = p;
    }
  }
}

for (const id of GUNS) {
  vm.freeze(null);
  vm.setWeapon(id, { draw: false });
  vm.setMelee(MELEES[0]);
  const w = W.weapons[id];
  run(`${id}/idle-reload-tactical`, "reload", id, { empty: false, dur: w.reloadTime });
  run(`${id}/reload-empty`, "reload", id, { empty: true, dur: w.reloadTime });
  if (w.cycle && w.cycle !== "none") run(`${id}/cycle`, "cycle", id);
  for (const m of MELEES) { vm.setMelee(m); run(`${id}/melee-${m}`, "melee", id); }
  run(`${id}/reload-timed`, "reload", id, { dur: w.reloadTime });
  run(`${id}/grenade`, "grenade", id, { dur: 0.6 });
  run(`${id}/switch`, "switch", id, { dur: w.switchTime });
}
// idle: hands exactly on their grips
for (const id of GUNS) {
  vm.freeze(null);
  vm.setWeapon(id, { draw: false });
  for (let i = 0; i < 20; i++) vm.update(1 / 60, st);
  for (const [side, s] of [["R", "rightGrip"], ["L", "leftGrip"]]) {
    vm.current.sockets[s].updateWorldMatrix(true, false);
    const d = pS.setFromMatrixPosition(vm.current.sockets[s].matrixWorld).distanceTo(pH.setFromMatrixPosition(vm.hands[side].group.matrixWorld));
    assert.ok(d <= TOL, `${id} idle ${side} on ${s} (${d})`);
    checks++;
  }
}
assert.ok(worstJump < 25, `fastest hand ${worstJump.toFixed(2)} m/s`);
console.log(`rig.test: ${checks} socket checks OK (worst ${worst.toExponential(2)} m, fastest hand ${worstJump.toFixed(2)} m/s)`);
