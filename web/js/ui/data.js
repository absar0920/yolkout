// Menu data: fetched directly from /data/... so the home screen never waits for three.js.

let cache = null;

async function json(url) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(`GET ${url}: ${r.status}`);
  return r.json();
}

export function loadMenuData() {
  if (!cache) {
    cache = Promise.all([
      json("/data/weapons.json"),
      json("/data/cosmetics.json"),
      json("/data/modes.json"),
      json("/data/maps/index.json"),
      json("/data/rules.json"),
    ]).then(([weapons, cosmetics, modes, mapIndex, rules]) => ({ weapons, cosmetics, modes, mapIndex, rules }))
      .catch((e) => { cache = null; throw e; });
  }
  return cache;
}

/** Normalised 0..1 stats for the loadout stat bars, relative to the other primaries. */
export function weaponStats(W) {
  const raw = {};
  for (const id of [...W.primaries, W.secondary]) {
    const w = W.weapons[id];
    if (!w) continue;
    const perShot = w.damage * (w.pellets || 1);
    const interval = w.fireMode === "burst" && w.burstCount > 0
      ? (w.burstCount * w.fireInterval + w.burstDelay) / w.burstCount
      : w.fireInterval;
    const rpm = 60 / interval;
    const dps = perShot / interval;
    const range = w.kind === "projectile" ? 60 : Math.max(w.falloffEnd || 0, Math.min(w.range || 0, 120) * 0.5);
    const accuracy = 1 - Math.min(1, (w.adsSpread * 6 + w.hipSpread * 2 + (w.bloomMax || 0) * 4));
    raw[id] = { damage: perShot, rpm, dps, range, accuracy, mobility: w.moveMul, mag: w.magSize, reload: w.reloadTime };
  }
  const keys = ["damage", "rpm", "dps", "range", "accuracy", "mobility", "mag"];
  const max = {};
  const min = {};
  for (const k of keys) {
    max[k] = Math.max(...Object.values(raw).map((r) => r[k]));
    min[k] = Math.min(...Object.values(raw).map((r) => r[k]));
  }
  const out = {};
  for (const [id, r] of Object.entries(raw)) {
    out[id] = { raw: r };
    for (const k of keys) {
      if (k === "mobility") out[id][k] = 0.2 + 0.8 * ((r[k] - min[k]) / Math.max(1e-6, max[k] - min[k]));
      else if (k === "accuracy") out[id][k] = Math.max(0.08, r[k]);
      else out[id][k] = Math.max(0.06, Math.sqrt(r[k] / max[k]));
    }
  }
  return out;
}
