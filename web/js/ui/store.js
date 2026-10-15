// Persistent profile + settings in localStorage (every access guarded: private windows,
// blocked storage and quota errors must never break the page).

const PROFILE_KEY = "yolkout.profile.v1";
const SETTINGS_KEY = "yolkout.settings.v1";

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function write(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ }
}

/** Settings the UI exposes. Keys match the game client's DEFAULT_SETTINGS (plus `volume`). */
export const UI_DEFAULT_SETTINGS = {
  sensitivity: 1.0,
  adsSensitivity: 0.85,
  invertY: false,
  fov: 75,
  quality: "high",
  shadows: true,
  showFps: false,
  showDebug: false,
  crosshair: true,
  crosshairColor: "#ffffff",
  toggleAds: false,
  viewBob: true,
  nameplates: true,
  rawInput: false,
  gamepadSensitivity: 1.0,
  volume: 0.8,
  binds: null,
};

export const DEFAULT_PROFILE = {
  name: "",
  cls: "",
  cos: null,
  mode: "ffa",
  map: "",
  practiceBots: 5,
  practiceDifficulty: 0.5,
};

export function loadProfile() {
  const p = Object.assign({}, DEFAULT_PROFILE, read(PROFILE_KEY) || {});
  if (typeof p.name !== "string") p.name = "";
  return p;
}
export function saveProfile(p) { write(PROFILE_KEY, p); }

export function loadSettings() {
  const s = Object.assign({}, UI_DEFAULT_SETTINGS, read(SETTINGS_KEY) || {});
  // sanitise numeric ranges
  const clamp = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
  s.sensitivity = clamp(s.sensitivity, 0.1, 5, 1);
  s.adsSensitivity = clamp(s.adsSensitivity, 0.1, 2, 0.85);
  s.fov = clamp(s.fov, 60, 110, 75);
  s.volume = clamp(s.volume, 0, 1, 0.8);
  s.gamepadSensitivity = clamp(s.gamepadSensitivity, 0.2, 3, 1);
  if (!["low", "medium", "high"].includes(s.quality)) s.quality = "high";
  if (s.binds && typeof s.binds !== "object") s.binds = null;
  return s;
}
export function saveSettings(s) { write(SETTINGS_KEY, s); }

/** Random friendly default name (clients only suggest it; the server sanitises). */
export function randomName() {
  const a = ["Sunny", "Scrambled", "Crispy", "Poached", "Boiled", "Fluffy", "Speckled", "Golden", "Runny", "Deviled", "Brave", "Zesty"];
  const b = ["Yolk", "Egg", "Shell", "Omelet", "Benny", "Frittata", "Quiche", "Nugget", "Crumpet", "Waffle", "Muffin", "Bagel"];
  const r = (arr) => arr[Math.floor(Math.random() * arr.length)];
  return (r(a) + r(b)).slice(0, 14) + Math.floor(Math.random() * 90 + 10);
}

/** Same rule as the server (PROTOCOL 13.3), applied client side for display. */
export function cleanName(n) {
  return String(n || "").normalize("NFC").replace(/[^A-Za-z0-9 _.-]/g, "").replace(/ +/g, " ").trim().slice(0, 16);
}
