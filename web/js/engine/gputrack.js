// Per-renderer GPU resource tracking.
//
// three.js frees a geometry / material / texture's GPU copy through a 'dispose' listener that each WebGLRenderer
// adds the first time it uploads the object. The art library keeps geometries, materials and textures in
// module-level caches that live for the whole page, so those listeners (closures over the renderer's internals)
// would keep every old WebGLRenderer reachable after leave/rejoin or a closed loadout preview.
//
// trackRenderer(renderer) records every 'dispose' listener the renderer adds while it renders or compiles. Its
// release() calls exactly those listeners (freeing only THIS renderer's copies, so another live renderer that
// shares the cached art keeps its buffers and programs) and leaves the cached JS objects in place for the next
// renderer to upload again.

import * as THREE from "../../vendor/three.module.min.js";

const proto = THREE.EventDispatcher.prototype;
let current = null; // registry of the renderer currently rendering / compiling
const owner = new WeakMap(); // listener fn -> registry (each renderer has its own listener closures)

if (!proto.__yoGpuTrack) {
  const add = proto.addEventListener, rem = proto.removeEventListener;
  proto.addEventListener = function (type, fn) {
    add.call(this, type, fn);
    if (type === "dispose" && current) {
      let s = current.get(this);
      if (!s) current.set(this, (s = new Set()));
      s.add(fn);
      owner.set(fn, current);
    }
  };
  proto.removeEventListener = function (type, fn) {
    rem.call(this, type, fn);
    if (type === "dispose") {
      const reg = owner.get(fn);
      const s = reg && reg.get(this);
      if (s) { s.delete(fn); if (!s.size) reg.delete(this); }
    }
  };
  proto.__yoGpuTrack = true;
}

const WRAP = ["render", "compile", "compileAsync", "initTexture", "initRenderTarget", "setRenderTarget", "copyFramebufferToTexture", "copyTextureToTexture"];

/** Start tracking `renderer`. Returns {release(), size()}; call release() BEFORE renderer.dispose(). */
export function trackRenderer(renderer) {
  const reg = new Map(), orig = {};
  for (const k of WRAP) {
    const f = renderer[k];
    if (typeof f !== "function") continue;
    orig[k] = f;
    renderer[k] = function (...args) {
      const prev = current;
      current = reg;
      try { return f.apply(renderer, args); } finally { current = prev; }
    };
  }
  return {
    size() { let n = 0; for (const s of reg.values()) n += s.size; return n; },
    release() {
      for (const [target, set] of [...reg]) {
        for (const fn of [...set]) {
          try { fn.call(target, { type: "dispose", target }); } catch { /* context already gone */ }
        }
      }
      reg.clear();
      Object.assign(renderer, orig); // back to the plain methods (three defines them per instance)
    },
  };
}
