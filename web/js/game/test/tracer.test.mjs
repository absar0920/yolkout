// Node test: a tracer streak never extends past its impact point (docs/V2_SPEC.md 6 / 7 item 7).
// The streak geometry is the effects.js box (z in [-1, 0]); for random shots and times every transformed
// corner must lie at <= L along the shot direction (and >= 0, never behind the muzzle).
// Run: node web/js/game/test/tracer.test.mjs
import assert from "node:assert/strict";
import * as THREE from "../../../vendor/three.module.min.js";
import { tracerSegment, tracerMatrix, Effects } from "../effects.js";
import * as Sim from "../../../../shared/ref/sim.mjs";

const geo = new THREE.BoxGeometry(1, 1, 1);
geo.translate(0, 0, -0.5);
const pos = geo.attributes.position;
const m = new THREE.Matrix4(), v = new THREE.Vector3(), dir = new THREE.Vector3(), o = new THREE.Vector3();
let rnd = 12345;
const rand = () => ((rnd = (rnd * 1103515245 + 12345) >>> 0) / 4294967296);
let checks = 0, drawn = 0;
for (let i = 0; i < 4000; i++) {
  dir.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
  if (dir.lengthSq() < 1e-4) continue;
  dir.normalize();
  o.set(rand() * 100 - 50, rand() * 20, rand() * 100 - 50);
  const L = 0.5 + rand() * 120;
  const tr = { sx: o.x, sy: o.y, sz: o.z, dx: dir.x, dy: dir.y, dz: dir.z, L, t: rand() * (L / 240 + 0.1), speed: 240, len: Math.min(5, L * 0.5), width: 0.02 };
  const seg = tracerSegment(tr);
  assert.ok(seg[0] >= 0 && seg[1] <= L + 1e-9 && seg[0] <= seg[1], "segment within [0, L]");
  if (!tracerMatrix(tr, m)) continue;
  drawn++;
  let far = -Infinity, near = Infinity;
  for (let k = 0; k < pos.count; k++) {
    v.fromBufferAttribute(pos, k).applyMatrix4(m).sub(o);
    const along = v.dot(dir);
    far = Math.max(far, along); near = Math.min(near, along);
  }
  assert.ok(far <= L + 1e-6, `streak far end ${far} beyond impact ${L}`);
  assert.ok(near >= -1e-6, `streak starts behind the muzzle (${near})`);
  assert.ok(Math.abs(far - seg[1]) < 1e-6, `far end ${far} == head ${seg[1]}`);
  checks++;
}
// Once the streak reaches a wall, its tail must keep moving until the whole streak disappears.
{
  const tr = { sx: 0, sy: 0, sz: 0, dx: 1, dy: 0, dz: 0, L: 10, t: 1, speed: 240, len: 5, width: 0.02 };
  assert.equal(tracerMatrix(tr, m), false, "streak leaves the wall instead of remaining stuck there");
  checks++;
}
// remote egg behind low cover: the eye ray clears a crate, the (lower) muzzle -> impact line does not.
// The streak must start on the eye line, never cut through the crate and out of its far side.
{
  const world = Sim.makeWorld({ boxes: [{ min: [4, 0, -1], max: [5, 1, 1] }, { min: [20, 0, -5], max: [21, 5, 5] }], bounds: { min: [-30, 0, -30], max: [30, 10, 30] } });
  const fx = { world, sim: Sim, made: [], tracer(...a) { this.made.push(a); } };
  const E = [0, 1.5, 0];
  const tw = Sim.raycastWorld(world, E[0], E[1], E[2], 1, 0, 0, 100);
  assert.ok(Math.abs(tw - 20) < 1e-9, "eye ray reaches the far wall");
  const H = [20, 1.5, 0];
  for (const M of [[0.3, 0.8, 0.2], [0.4, 0.9, -0.3]]) {
    fx.made.length = 0;
    Effects.prototype.shotTracer.call(fx, E, M, H, 0xffffff, 0.02, false);
    assert.equal(fx.made.length, 1, "one streak");
    const [sx, sy, sz, ex, ey, ez] = fx.made[0];
    const L = Math.hypot(ex - sx, ey - sy, ez - sz);
    const t = Sim.raycastWorld(world, sx, sy, sz, (ex - sx) / L, (ey - sy) / L, (ez - sz) / L, L);
    assert.ok(t < 0 || t >= L - 0.05, `streak crosses cover at ${t} of ${L}`);
    checks++;
  }
  // a clear line keeps the muzzle start
  fx.made.length = 0;
  Effects.prototype.shotTracer.call(fx, E, [0.3, 1.3, 0.2], H, 0xffffff, 0.02, false);
  assert.ok(fx.made.length === 1 && Math.abs(fx.made[0][1] - 1.3) < 1e-9, "clear muzzle line starts at the muzzle");
  checks++;
}
console.log(`tracer.test: ${checks} checks OK (${drawn} streaks drawn)`);
