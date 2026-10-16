// Art gallery for docs/V2_SPEC.md section 4.8: renders every asset in a grid with the in-game lighting,
// exposes window.__stats (tris / draw calls per model) and window.__ready.
import * as THREE from "../../../../vendor/three.module.min.js";
import {
  buildGun, buildHand, buildMelee, buildGrenade, buildRocket, buildCasing, modelStats, HAND_POSES, MELEE_IDS, GUN_IDS, fxMaterial, setOutlineQuality,
} from "../index.js";
import { EggAvatar, buildPickup, buildNest, buildGoldenEgg, buildHat } from "../../models.js";

const q = new URLSearchParams(location.search);
const view = q.get("view") || "guns";
const lod = q.get("lod") || "fp";
const only = q.get("id") || "";
const quality = q.get("q") || "high";
setOutlineQuality(quality);

const canvas = document.getElementById("c");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.debug.checkShaderErrors = true;
const W = window.innerWidth, H = window.innerHeight;
renderer.setSize(W, H, false);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#cfe9f7");
const hemi = new THREE.HemisphereLight(0xffffff, 0x6dbb4a, 1.43);
const sun = new THREE.DirectionalLight(0xfff1d6, 3.0);
sun.position.set(45, 100, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera; sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 1; sc.far = 300;
scene.add(hemi, sun, sun.target);
const fpLights = view === "guns" && lod === "fp";
if (fpLights) { hemi.intensity = 1.29; sun.intensity = 2.4; sun.position.set(40, 100, 60); }

const stats = {};
window.__stats = stats;
const cells = [];
const labels = document.getElementById("labels");
document.getElementById("title").textContent = `${view} ${lod}${only ? " " + only : ""}`;

let data = null;
async function loadData() {
  const j = (p) => fetch(`/data/${p}`).then((r) => r.json());
  const [weapons, cosmetics, rules] = await Promise.all([j("weapons.json"), j("cosmetics.json"), j("rules.json")]);
  return { weapons, cosmetics, rules };
}

/** Add a cell: obj placed at slot i; cam options {pos (relative to the anchor), look}. */
function cell(name, obj, camPos, look, o = {}) {
  const i = cells.length;
  const anchor = new THREE.Vector3((i % 10) * 40, 0, Math.floor(i / 10) * 40);
  const holder = new THREE.Group();
  holder.position.copy(anchor);
  holder.add(obj);
  scene.add(holder);
  if (o.ground) {
    const g = new THREE.Mesh(new THREE.CircleGeometry(o.ground, 40), new THREE.MeshLambertMaterial({ color: o.groundColor || "#b7d9a0" }));
    g.rotation.x = -Math.PI / 2;
    g.receiveShadow = true;
    holder.add(g);
  }
  const cam = new THREE.PerspectiveCamera(o.fov || 30, 1, 0.01, 100);
  cam.position.copy(anchor).add(new THREE.Vector3(...camPos));
  cam.lookAt(anchor.clone().add(new THREE.Vector3(...look)));
  const c = { name, obj, cam, holder, statsOf: o.statsOf || obj, label: o.label ?? name, update: o.update };
  cells.push(c);
  return c;
}

function layout(cols) {
  const rows = Math.ceil(cells.length / cols);
  const cw = W / cols, ch = (H - 36) / rows;
  cells.forEach((c, i) => {
    c.rect = [(i % cols) * cw, 36 + Math.floor(i / cols) * ch, cw, ch];
    c.cam.aspect = cw / ch;
    c.cam.updateProjectionMatrix();
    const s = c.fixedStats || modelStats(c.statsOf);
    stats[c.name] = s;
    const d = document.createElement("div");
    d.className = "lbl";
    d.style.left = `${c.rect[0] + 8}px`;
    d.style.top = `${c.rect[1] + c.rect[3] - 26}px`;
    d.innerHTML = `${c.label}<small>${s.tris} tris · ${s.drawCalls} dc${s.outlineCalls ? ` +${s.outlineCalls} ol` : ""}</small>`;
    labels.appendChild(d);
  });
}

function render(t = 0) {
  renderer.setScissorTest(true);
  for (const c of cells) {
    if (c.update) c.update(t);
    const [x, y, w, h] = c.rect;
    const yy = H - y - h;
    renderer.setViewport(x, yy, w, h);
    renderer.setScissor(x, yy, w, h);
    renderer.render(scene, c.cam);
  }
}

function attachHands(gun, color = "#e0573b") {
  const hands = [];
  const rs = gun.sockets.rightGrip, ls = gun.sockets.leftGrip;
  if (rs) { const h = buildHand("R", { lod: gun.lod, color }); h.setPose(rs.userData.pose || "trigger"); rs.add(h.group); hands.push(h); }
  if (ls) { const h = buildHand("L", { lod: gun.lod, color }); h.setPose(ls.userData.pose || "grip"); ls.add(h.group); hands.push(h); }
  return hands;
}

const views = {
  guns() {
    const ids = only ? [only] : GUN_IDS;
    for (const id of ids) {
      const gun = buildGun(id, { lod });
      const g = new THREE.Group();
      g.add(gun.group);
      const box = new THREE.Box3().setFromObject(gun.group);
      if (lod === "fp") attachHands(gun);
      const ctr = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
      const d = Math.max(0.55, Math.max(size.x, size.y, size.z)) * (only ? 1.9 : 2.25);
      const camPos = lod === "fp" ? [ctr.x + d * 0.62, ctr.y + d * 0.3, ctr.z + d * 0.5] : [ctr.x + d * 0.85, ctr.y + d * 0.25, ctr.z + d * 0.1];
      const c = cell(id, g, camPos, [ctr.x, ctr.y, ctr.z], { statsOf: gun.group, fov: 32 });
      stats[`${id}:${lod}`] = gun.stats;
      void c;
    }
    layout(only ? 1 : 4);
  },
  fpview() {
    // what the player sees: the v1 view-model framing (gunRoot scale 0.55 at HIP (0.2, -0.2, -0.5), vm fov 62)
    const ids = only ? [only] : GUN_IDS;
    for (const id of ids) {
      const gun = buildGun(id, { lod: "fp" });
      attachHands(gun, "#f2b6c6");
      const root = new THREE.Group();
      const hp = (q.get("hip") || "0.2,-0.2,-0.5").split(",").map(Number);
      root.position.set(hp[0], 1.3 + hp[1], hp[2]);
      root.scale.setScalar(0.55);
      root.add(gun.group);
      if (q.get("ads")) {
        // ADS: sight line on the view axis
        gun.group.updateMatrixWorld(true);
        const s = gun.sockets.sight.position;
        root.position.set(-s.x * 0.55, 1.3 - s.y * 0.55, -0.11 - s.z * 0.55);
      }
      const c = cell(id, root, [0, 1.3, 0], [0, 1.3, -1], { statsOf: gun.group, fov: 62 });
      c.fixedStats = gun.stats;
    }
    layout(only ? 1 : 2);
  },
  hands() {
    for (const side of ["R", "L"]) for (const pose of HAND_POSES) {
      const h = buildHand(side, { lod, color: "#e0573b" });
      h.setPose(pose);
      const g = new THREE.Group();
      g.add(h.group);
      if (["grip", "trigger", "fist"].includes(pose)) {
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.16, 16), fxMaterial());
        bar.geometry.setAttribute("color", new THREE.Float32BufferAttribute(new Array(bar.geometry.attributes.position.count * 3).fill(0.25), 3));
        bar.geometry.setAttribute("aFx", new THREE.Float32BufferAttribute(new Array(bar.geometry.attributes.position.count * 2).fill(0), 2));
        bar.rotation.z = Math.PI / 2;
        g.add(bar);
      }
      const s = side === "R" ? 1 : -1;
      const sc = lod === "tp" ? 1.35 : 1;
      const fl = q.get("flip") ? -1 : 1;
      cell(`${side}-${pose}`, g, [0.32 * s * sc * fl, 0.26 * sc, -0.34 * sc], [0, 0.02 * sc, -0.02 * sc], { statsOf: h.group, fov: 34 });
    }
    layout(8);
  },
  melee() {
    for (const L of ["fp", "tp"]) for (const id of MELEE_IDS) {
      const m = buildMelee(id, { lod: L });
      const g = new THREE.Group();
      g.add(m.group);
      g.rotation.z = -0.5;
      if (L === "fp") {
        const h = buildHand("R", { lod: "fp", color: "#e0573b" });
        h.setPose("grip");
        // item.matrix = hold * inverse(grip): place the hand at the grip socket
        m.sockets.grip.add(h.group);
        h.group.rotation.y = Math.PI; // inverse of the R hold point's turn
      }
      const c = cell(`${id}-${L}`, g, [0.55, 0.45, 0.95], [0, 0.18, 0], { statsOf: m.group, fov: 34 });
      c.fixedStats = m.stats;
    }
    layout(4);
  },
  throwables() {
    for (const L of ["fp", "tp"]) {
      const n = buildGrenade({ lod: L });
      cell(`grenade-${L}`, n, [0.28, 0.3, 0.32], [0, 0.02, 0], { fov: 34 });
    }
    for (const L of ["fp", "tp"]) {
      const r = buildRocket({ lod: L });
      r.parts.flame.visible = true;
      r.group.rotation.y = Math.PI / 2;
      cell(`rocket-${L}`, r.group, [0.35, 0.3, 0.75], [0, 0, 0], { fov: 34 });
    }
    for (const k of ["brass", "shell"]) {
      const m = new THREE.Mesh(buildCasing(k), fxMaterial());
      m.rotation.y = 0.8;
      cell(`casing-${k}`, m, [0.12, 0.1, 0.16], [0, 0, 0], { fov: 34 });
    }
    layout(3);
  },
  async eggs() {
    const colors = ["classic", "robin", "charcoal"];
    const hps = [1, 0.62, 0.38, 0.12];
    for (const c of colors) for (const hp of hps) {
      const av = new EggAvatar(data, { cos: { color: c, hat: "none", stamp: c === "robin" ? "star" : "none" }, cls: "benedict", nameplate: false, id: colors.indexOf(c) * 7 + 3 });
      av.setHealth(hp, 0);
      for (let i = 0; i < 40; i++) av.update({ x: 0, y: 0, z: 0, yaw: Math.PI + 0.5, pitch: 0, flags: 3 }, 1 / 30, i / 30);
      cell(`${c}-hp${Math.round(hp * 100)}`, av.root, [0.6, 1.25, 3.6], [0, 0.82, 0], { fov: 30, ground: 1.2, update: (t) => av.update({ x: av.root.position.x, y: 0, z: av.root.position.z, yaw: Math.PI + 0.5, pitch: 0, flags: 3 }, 0, 2 + t) });
    }
    layout(4);
  },
  async holding() {
    const ids = only ? [only] : GUN_IDS;
    const cols = ["lava", "robin", "classic", "mint", "goldleaf", "lavender", "rose", "charcoal"];
    const hats = ["chef", "cowboy", "beanie", "cap", "tophat", "viking", "crown", "propeller"];
    ids.forEach((id, i) => {
      const av = new EggAvatar(data, { cos: { color: cols[i % 8], hat: hats[i % 8], stamp: "star" }, cls: id, nameplate: false, id: i + 1 });
      av.setHealth(1, 0);
      const st = { x: 0, y: 0, z: 0, yaw: Math.PI + 0.65, pitch: 0.05, flags: 3 };
      for (let k = 0; k < 30; k++) av.update(st, 1 / 30, k / 30);
      cell(`egg-${id}`, av.root, [-1.1, 1.4, 3.9], [0.05, 0.85, -0.3], { fov: 34, ground: 1.4, statsOf: av.root });
      stats[`egg-${id}:parts`] = { shell: modelStats(av.shell).tris, limbs: modelStats(av.limbs).tris, gun: av.gun.stats.tris, hat: modelStats(av.hat).tris };
    });
    layout(only ? 1 : 4);
  },
  async anim() {
    // TP animation keyframes: reload, melee swings, grenade throw, switch, aim. Each starts 0.25 s before
    // the frame of interest and steps at 60 fps so the blend weights settle like in game.
    const base = { x: 0, y: 0, z: 0, yaw: Math.PI + +(q.get("yaw") ?? 0.75), pitch: 0, flags: 3 };
    const R = (frac) => (av) => { av.update({ ...base, flags: 3 | 8 }, 1 / 60, 0); av.anim.reloadT = av.anim.reloadDur * frac - 0.25; return [3 | 8, 15]; };
    const M = (id, at) => (av) => { av.setMelee(id); av.melee(); av.anim.meleeT = 0; return [3, Math.round(at * 60)]; };
    const shots = [
      ["reload-20", "benedict", R(0.2)], ["reload-50", "benedict", R(0.5)], ["shells-40", "deviler", R(0.4)], ["rocket-40", "souffle", R(0.4)],
      ["pin-strike", "benedict", M("rollingpin", 0.16)], ["pan-windup", "poacher", M("pan", 0.1)], ["pan-strike", "poacher", M("pan", 0.17)], ["whisk-jab", "coddler", M("whisk", 0.17)],
      ["spatula-up", "frittata", M("spatula", 0.2)],
      ["grenade", "overeasy", (av) => { av.throwNade(); return [3, 9]; }],
      ["switch", "piercer", (av) => { av.anim.switchT = 0; return [3, 12]; }],
      ["aim", "benedict", () => [7, 15]],
    ];
    shots.forEach(([name, gun, fn], i) => {
      const av = new EggAvatar(data, { cos: { color: ["lava", "robin", "mint", "classic"][i % 4], hat: "none", stamp: "none" }, cls: gun, nameplate: false, id: i });
      for (let k = 0; k < 10; k++) av.update(base, 1 / 30, k / 30);
      const [fl, steps] = fn(av);
      for (let k = 0; k < steps; k++) av.update({ ...base, flags: fl }, 1 / 60, 1 + k / 60);
      cell(name, av.root, [-1.3, 1.6, 4.0], [0.05, 0.95, -0.3], { fov: 38, ground: 1.4, statsOf: av.root });
    });
    layout(4);
  },
  props() {
    for (const t of ["hp", "shield", "ammo"]) cell(`pickup-${t}`, buildPickup(t), [0.9, 1.0, 1.4], [0, 0.5, 0], { fov: 34, ground: 0.8 });
    cell("nest", buildNest("#ff5a4a"), [2.4, 2.4, 3.6], [0.3, 0.8, 0], { fov: 40 });
    cell("golden-egg", buildGoldenEgg("#ff5a4a"), [0.6, 0.6, 1.1], [0, 0.3, 0], { fov: 34, ground: 0.6 });
    layout(5);
  },
  hats() {
    for (const h of data.cosmetics.hats) {
      if (h.shape === "none") continue;
      const av = new EggAvatar(data, { cos: { color: "classic", hat: h.id, stamp: "none" }, cls: "coddler", nameplate: false });
      for (let k = 0; k < 5; k++) av.update({ x: 0, y: 0, z: 0, yaw: Math.PI - 0.4, pitch: 0, flags: 3 }, 1 / 30, k / 30);
      cell(h.id, av.root, [0.6, 1.9, 2.6], [0, 1.2, 0], { fov: 34, ground: 1, statsOf: av.hat });
      stats[`hat:${h.id}`] = modelStats(av.hat);
    }
    layout(5);
  },
};

const errors = [];
window.__errors = errors;
window.addEventListener("error", (e) => errors.push(String(e.message)));
try {
  data = await loadData();
  await (views[view] || views.guns)();
  // warm + render a few frames
  render(0);
  let t = 0;
  const loop = () => { t += 1 / 60; render(t); if (!window.__freeze) requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  window.__ready = true;
  window.__info = { calls: renderer.info.render.calls, programs: renderer.info.programs.length };
} catch (e) {
  errors.push(String(e && e.stack || e));
  window.__ready = true;
  document.getElementById("title").textContent = "ERROR " + e;
}
