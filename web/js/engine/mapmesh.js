// Map geometry: every box of the map JSON is merged into ONE BufferGeometry per
// material (one draw call per material), with world-space UVs so the procedural
// detail textures tile at a constant density, and vertex colours for cheap fake AO
// plus a per-box tint jitter so repeated boxes don't look identical.

import * as THREE from "../../vendor/three.module.min.js";
import { detailTexture, textureKindFor } from "./textures.js";

// texture world size (units per repeat) per kind
const TILE = { grass: 4, dirt: 4, wood: 2.5, crate: 1, hay: 2, metal: 2, tile: 2, checker: 2, concrete: 4, asphalt: 4,
  grate: 2, hazard: 1.5, roof: 3, siding: 2, bread: 2, cardboard: 1.5, fabric: 1, water: 4, glow: 1, plain: 3 };

function hash(i) {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// face definitions: normal axis, sign, and the 4 corners as (bit x, bit y, bit z) of min/max
const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];

/**
 * Build the visual map. Returns {group, dispose()}.
 * opts: {anisotropy, shadows}
 */
export function buildMapMesh(map, opts = {}) {
  const group = new THREE.Group();
  group.name = `map:${map.id}`;
  const byMat = new Map();
  map.boxes.forEach((b, i) => {
    if (!byMat.has(b.mat)) byMat.set(b.mat, []);
    byMat.get(b.mat).push([b, i]);
  });
  const groundY = 0.001;
  const disposables = [];
  for (const [matName, list] of byMat) {
    const md = map.materials[matName] || { color: "#cccccc", rough: 1 };
    const kind = textureKindFor(matName);
    const tile = TILE[kind] || 3;
    const nFaces = list.length * 6;
    const pos = new Float32Array(nFaces * 4 * 3), nor = new Float32Array(nFaces * 4 * 3);
    const uv = new Float32Array(nFaces * 4 * 2), col = new Float32Array(nFaces * 4 * 3);
    const idx = [];
    let v = 0;
    for (const [b, bi] of list) {
      const mn = b.min, mx = b.max;
      const tint = 0.93 + hash(bi) * 0.1;
      const sx = mx[0] - mn[0], sz = mx[2] - mn[2], sy = mx[1] - mn[1];
      for (const f of FACES) {
        if (f.n[1] === -1 && mn[1] <= groundY) continue; // bottom faces on/under the ground are never seen
        // degenerate (paper-thin decals keep only top face)
        if (b.solid === false && sy < 0.05 && f.n[1] !== 1) continue;
        const base = v;
        for (const c of f.c) {
          const x = c[0] ? mx[0] : mn[0], y = c[1] ? mx[1] : mn[1], z = c[2] ? mx[2] : mn[2];
          pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
          nor[v * 3] = f.n[0]; nor[v * 3 + 1] = f.n[1]; nor[v * 3 + 2] = f.n[2];
          let u, w;
          if (f.n[0] !== 0) { u = -z * f.n[0]; w = y; }
          else if (f.n[1] !== 0) { u = x; w = z * -f.n[1]; }
          else { u = x * f.n[2]; w = y; }
          // crates use per-box UVs (one crate pattern per face)
          if (kind === "crate") {
            if (f.n[0] !== 0) { u = (c[2] ? 1 : 0) * Math.max(1, Math.round(sz)); w = c[1] ? Math.max(1, Math.round(sy)) : 0; }
            else if (f.n[1] !== 0) { u = (c[0] ? 1 : 0) * Math.max(1, Math.round(sx)); w = (c[2] ? 1 : 0) * Math.max(1, Math.round(sz)); }
            else { u = (c[0] ? 1 : 0) * Math.max(1, Math.round(sx)); w = c[1] ? Math.max(1, Math.round(sy)) : 0; }
            uv[v * 2] = u; uv[v * 2 + 1] = w;
          } else {
            uv[v * 2] = u / tile; uv[v * 2 + 1] = w / tile;
          }
          // fake AO: darker at the bottom of walls, darker on bottom faces
          let ao = 1;
          if (f.n[1] === 0) ao = c[1] ? 1 : (sy > 0.6 ? 0.72 : 0.85);
          else if (f.n[1] < 0) ao = 0.6;
          const s = ao * tint;
          col[v * 3] = s; col[v * 3 + 1] = s; col[v * 3 + 2] = s;
          v++;
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos.subarray(0, v * 3), 3));
    g.setAttribute("normal", new THREE.BufferAttribute(nor.subarray(0, v * 3), 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv.subarray(0, v * 2), 2));
    g.setAttribute("color", new THREE.BufferAttribute(col.subarray(0, v * 3), 3));
    g.setIndex(v > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();

    const isGlass = /glass|jar/.test(matName), isWater = /water/.test(matName);
    const params = {
      color: new THREE.Color(md.color), map: detailTexture(kind, opts.anisotropy || 4), vertexColors: true,
    };
    let mat;
    if (md.emissive) {
      mat = new THREE.MeshLambertMaterial(Object.assign(params, { emissive: new THREE.Color(md.emissive), emissiveIntensity: 0.9 }));
    } else if ((md.rough ?? 1) < 0.5) {
      mat = new THREE.MeshPhongMaterial(Object.assign(params, { shininess: Math.round((1 - md.rough) * 60), specular: new THREE.Color(0x2a2a2a) }));
    } else {
      mat = new THREE.MeshLambertMaterial(params);
    }
    if (isGlass || isWater) {
      mat.transparent = true;
      mat.opacity = isGlass ? 0.38 : 0.82;
      mat.depthWrite = !isGlass;
    }
    const decalOnly = list.every(([b]) => b.solid === false);
    if (decalOnly) { mat.polygonOffset = true; mat.polygonOffsetFactor = -1; mat.polygonOffsetUnits = -1; }
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = `mat:${matName}`;
    mesh.castShadow = !isGlass && !isWater && !decalOnly;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    if (isGlass) mesh.renderOrder = 2;
    group.add(mesh);
    disposables.push(g, mat);
  }
  group.matrixAutoUpdate = false;
  return {
    group,
    dispose() { for (const d of disposables) d.dispose(); },
  };
}
