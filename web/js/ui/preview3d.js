// Optional live 3D loadout preview: the real in-game EggAvatar on a turntable.
// Loaded lazily (pulls in three.js + the game's models). Any failure resolves to null and the
// caller keeps the 2D SVG preview.

let mods = null;

async function loadMods() {
  if (!mods) {
    mods = Promise.all([
      import("../../vendor/three.module.min.js"),
      import("../game/models.js"),
      import("../main.js"),
    ]).then(([THREE, models, main]) => ({ THREE, models, main }));
  }
  return mods;
}

let glOK = null;

/** WebGL support, probed once: every probe context counts against the browser's live-context cap. */
function webglOK() {
  if (glOK === null) {
    try {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl2") || c.getContext("webgl");
      glOK = !!gl;
      if (gl) gl.getExtension("WEBGL_lose_context")?.loseContext();
    } catch { glOK = false; }
  }
  return glOK;
}

function releaseRenderer(renderer) {
  renderer.dispose();
  renderer.forceContextLoss();
}

/**
 * Mount a 3D preview into `host`. Returns a controller {set(cos, cls, mel), dispose()} or null.
 * mel (optional) is the melee id; changing it plays that melee's swing once so the player sees it.
 */
export async function mountPreview3D(host, cos, cls, mel) {
  if (!webglOK()) return null;
  let M;
  let data;
  try {
    M = await loadMods();
    data = await M.main.loadGameData();
  } catch (e) {
    console.warn("3D preview unavailable", e);
    return null;
  }
  const { THREE, models } = M;
  if (!models.EggAvatar) return null;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  } catch { return null; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const canvas = renderer.domElement;
  canvas.className = "preview3d";
  canvas.setAttribute("aria-label", "3D preview of your egg. Drag to rotate.");
  canvas.setAttribute("role", "img");
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  cam.position.set(0, 1.15, 3.7);
  cam.lookAt(0, 0.85, 0);
  scene.add(new THREE.HemisphereLight(0xfff4dc, 0x6a5a48, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(2.5, 4, 3);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x8fd3ff, 1.1);
  rim.position.set(-3, 2, -3);
  scene.add(rim);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(0.9, 32), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.16 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.002;
  scene.add(floor);

  let avatar;
  try {
    avatar = new models.EggAvatar(data, { cos, cls, mel: mel || undefined, nameplate: false });
  } catch (e) {
    console.warn("3D preview avatar failed", e);
    releaseRenderer(renderer);
    canvas.remove();
    return null;
  }
  scene.add(avatar.root);

  // The avatar faces -Z and the camera sits on +Z, so yaw = PI faces the viewer.
  let yaw = Math.PI - 0.35;
  let vel = 0;
  let dragging = false, lastX = 0, idle = 0;
  const onDown = (e) => { dragging = true; lastX = e.clientX; canvas.setPointerCapture(e.pointerId); };
  const onMove = (e) => { if (!dragging) return; const dx = e.clientX - lastX; lastX = e.clientX; yaw += dx * 0.012; vel = dx * 0.7; idle = 0; };
  const onUp = () => { dragging = false; };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);

  let raf = 0, last = performance.now(), t = 0, alive = true;
  const size = () => {
    const r = host.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), hgt = Math.max(1, Math.round(r.height));
    if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(hgt * renderer.getPixelRatio())) {
      renderer.setSize(w, hgt, false);
      cam.aspect = w / hgt;
      cam.updateProjectionMatrix();
    }
  };
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const frame = (now) => {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    if (document.hidden || !canvas.isConnected || canvas.offsetParent === null) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    if (!dragging) {
      idle += dt;
      // ease back toward a gentle sway around facing the viewer
      vel *= Math.exp(-dt * 3);
      yaw += vel * dt * 0.02;
      const target = Math.PI - 0.35 + (reduce ? 0 : Math.sin(t * 0.7) * 0.45);
      if (idle > 1.2) {
        const TAU = Math.PI * 2;
        const d = ((((target - yaw) % TAU) + TAU * 1.5) % TAU) - Math.PI; // shortest arc
        yaw += d * Math.min(1, dt * 1.5);
      }
    }
    size();
    avatar.update({ x: 0, y: 0, z: 0, yaw, pitch: Math.sin(t * 0.8) * 0.06, flags: 2 }, dt, t);
    renderer.render(scene, cam);
  };
  raf = requestAnimationFrame(frame);

  return {
    set(nextCos, nextCls, nextMel) {
      try {
        if (nextCos) avatar.setCosmetics(nextCos);
        if (nextCls) avatar.setWeapon(nextCls);
        if (nextMel && nextMel !== avatar.meleeId && avatar.setMelee) { avatar.setMelee(nextMel); avatar.melee(); }
      } catch (e) { console.warn(e); }
    },
    dispose() {
      alive = false;
      cancelAnimationFrame(raf);
      try { avatar.dispose(); } catch { /* ignore */ }
      floor.geometry.dispose();
      floor.material.dispose();
      releaseRenderer(renderer);
      canvas.remove();
    },
  };
}
