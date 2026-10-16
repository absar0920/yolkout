// IK-lite for the first-person hands: every hand target resolves to a transform in view-model root space
// (the frame of renderer.vmCamera); a hand blends between two targets with lerp + slerp. A hand placed on a
// socket gets exactly the socket's world transform (gun scale included), which is what the art library
// designs its grips for (docs/V2_SPEC.md 2.4 / 5.2). Allocation-free after construction.

import * as THREE from "../../../vendor/three.module.min.js";

const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _e = new THREE.Euler(), _q = new THREE.Quaternion();
const _v = new THREE.Vector3(), _s = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);

export const SOCK = { rg: "rightGrip", lg: "leftGrip" };

/**
 * Hand anchors on carried items that have no hand socket of their own (item part frame, gun units).
 * pinch: the hand's pinch point lands on `at`; hold: the hand origin (grip centre) lands on `at`. r = hand euler.
 */
export const ANCHORS = {
  // fingers = where the glove's fingers point, back = where the back of the glove faces (item frame)
  shell: { mode: "pinch", at: [0, -0.004, 0.026], fingers: [0, 0.3, -1], back: [0, -1, 0] },
  clip: { mode: "pinch", at: [-0.004, 0.03, 0.0], fingers: [1, -0.35, 0], back: [0, 1, 0.45] },
  rocket: { mode: "hold", at: [0, -0.07, 0.06], fingers: [-1, 0.35, 0], back: [0, -1, 0] },
};

export class Rig {
  constructor(root, gunRoot, scale) {
    this.root = root;
    this.gunRoot = gunRoot;
    this.S = scale;
    this.gun = null;
    this.anchor = null;          // Object3D the {item} target follows
    this.rootInv = new THREE.Matrix4();
  }

  /** Call once per frame after the gun/part transforms are final and matrices updated. */
  beginFrame() { this.rootInv.copy(this.root.matrixWorld).invert(); }

  socket(name) {
    const g = this.gun;
    if (!g) return null;
    return g.sockets[SOCK[name] || name] || null;
  }

  /** Pose name a target asks for (falls back to the socket's userData.pose). */
  poseOf(t, side) {
    if (!t) return "open";
    if (typeof t === "string") { const s = this.socket(t); return (s && s.userData.pose) || (t === "rg" ? "trigger" : "grip"); }
    if (t.pose) return t.pose;
    if (t.s) { const s = this.socket(t.s); return (s && s.userData.pose) || "grip"; }
    return side === "R" ? "grip" : "grip";
  }

  /** Resolve a target to root-space position p and quaternion q. Returns false when unresolvable. */
  resolve(t, p, q) {
    if (!t) return false;
    let ok = true;
    if (typeof t === "string" || t.s) {
      const s = this.socket(typeof t === "string" ? t : t.s);
      if (!s) ok = false;
      else {
        _m.multiplyMatrices(this.rootInv, s.matrixWorld);
        if (t.o) _m.multiply(_m2.makeTranslation(t.o[0], t.o[1], t.o[2]));
        if (t.r) _m.multiply(_m2.makeRotationFromEuler(_e.set(t.r[0], t.r[1], t.r[2])));
      }
    } else if (t.item) {
      if (!this.anchor) ok = false;
      else _m.multiplyMatrices(this.rootInv, this.anchor.matrixWorld);
    } else if (t.g) {
      _m2.compose(_v.set(t.g[0], t.g[1], t.g[2]), t.r ? _q.setFromEuler(_e.set(t.r[0], t.r[1], t.r[2])) : _q.identity(), _one);
      _m.multiplyMatrices(this.gunRoot.matrix, _m2);
    } else if (t.v) {
      if (t.head) headQuat(t.head, t.back || [0, 1, 0], _q);
      else if (t.r) _q.setFromEuler(_e.set(t.r[0], t.r[1], t.r[2]));
      else _q.identity();
      _m.compose(_v.set(t.v[0], t.v[1], t.v[2]), _q, _s.set(this.S, this.S, this.S));
    } else ok = false;
    if (!ok) {
      // unknown socket: fall back to the right grip so a hand never flies off
      const s = this.socket("rg");
      if (!s) return false;
      _m.multiplyMatrices(this.rootInv, s.matrixWorld);
    }
    _m.decompose(p, q, _s);
    if (t.go) {
      _v.set(t.go[0], t.go[1], t.go[2]).applyQuaternion(this.gunRoot.quaternion).multiplyScalar(this.S);
      p.add(_v);
    }
    return true;
  }
}

const _hx = new THREE.Vector3(), _hy = new THREE.Vector3(), _hz = new THREE.Vector3(), _hm = new THREE.Matrix4();
/**
 * Hand orientation from intent: `head` = where a held item points (the fist's thumb side, hand -X),
 * `back` = where the back of the hand faces (hand +Y, orthogonalised against head).
 */
export function headQuat(head, back, out) {
  _hx.set(-head[0], -head[1], -head[2]).normalize();
  _hy.set(back[0], back[1], back[2]);
  _hy.addScaledVector(_hx, -_hy.dot(_hx));
  if (_hy.lengthSq() < 1e-6) _hy.set(0, 0, 1).addScaledVector(_hx, -_hx.z);
  _hy.normalize();
  _hz.crossVectors(_hx, _hy);
  _hm.makeBasis(_hx, _hy, _hz);
  return out.setFromRotationMatrix(_hm);
}

/** Build the hand anchor Object3D for a carried part (child of the part). pinchLocal = L hand pinch point. */
export function makeAnchor(kind, pinchLocal) {
  const a = ANCHORS[kind];
  const o = new THREE.Object3D();
  o.name = `vmAnchor:${kind}`;
  if (!a) return o;
  if (a.fingers) {
    // hand basis: Z = -fingers, Y = back (orthogonalised), X = Y x Z
    _hz.set(-a.fingers[0], -a.fingers[1], -a.fingers[2]).normalize();
    _hy.set(a.back[0], a.back[1], a.back[2]);
    _hy.addScaledVector(_hz, -_hy.dot(_hz)).normalize();
    _hx.crossVectors(_hy, _hz);
    o.quaternion.setFromRotationMatrix(_hm.makeBasis(_hx, _hy, _hz));
  } else o.quaternion.setFromEuler(_e.set(a.r[0], a.r[1], a.r[2]));
  o.position.set(a.at[0], a.at[1], a.at[2]);
  if (a.mode === "pinch" && pinchLocal) o.position.sub(_v.copy(pinchLocal).applyQuaternion(o.quaternion));
  return o;
}
