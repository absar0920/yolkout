// Guarded audio hook. The UI owns web/js/audio.js, which exports
//   sfx.play(name, opts)
// with names: shoot_<weaponId>, reload, hit, headshot, kill, death_crack, explode, jump,
// land, footstep, pickup, grenade_throw, empty, ui_click.
// If that module is missing or throws, every call here is a silent no-op.
//
// opts passed by the game: {volume 0..1 (already distance-attenuated), pan -1..1,
// dist (units from the listener, 0 = local player), local (bool: caused by the local player)}

let impl = null;
let loading = null;

export function loadAudio() {
  if (!loading) {
    loading = import("../audio.js")
      .then((m) => { const s = m && (m.sfx || (m.default && m.default.sfx) || m.default); if (s && typeof s.play === "function") impl = s; })
      .catch(() => { impl = null; });
  }
  return loading;
}

export function play(name, opts) {
  if (!impl) return;
  try { impl.play(name, opts || {}); } catch { /* audio must never break the game */ }
}

/** Positional helper: volume falloff + stereo pan from the listener pose. */
export function playAt(name, x, y, z, L, base = 1, range = 45) {
  if (!impl) return;
  const dx = x - L.x, dy = y - L.y, dz = z - L.z;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d > range) return;
  const vol = base * Math.max(0, 1 - d / range) ** 1.5;
  if (vol < 0.02) return;
  // listener right vector = (cos yaw, 0, -sin yaw)
  const rx = Math.cos(L.yaw), rz = -Math.sin(L.yaw);
  const pan = d > 0.01 ? Math.max(-1, Math.min(1, (dx * rx + dz * rz) / d)) : 0;
  play(name, { volume: vol, pan, dist: d, local: false });
}
