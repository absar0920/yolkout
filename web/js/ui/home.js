// Home screen: name, mode, map, quickplay, practice, private rooms, live room browser.

import { $, h, clear, toast, debounce, fill } from "./dom.js";
import { radioGroup } from "./widgets.js";
import { eggSVG } from "./egg2d.js";
import { gunIcon } from "./icons.js";
import { saveProfile, randomName, cleanName } from "./store.js";
import { sfx } from "../audio.js";

const ROOM_POLL_MS = 8000;

export function initHome(app) {
  const { data, profile } = app;
  const root = $("#home");
  const nameInput = $("#name-input");
  const modeHost = $("#mode-picker");
  const mapSel = $("#map-select");
  const codeInput = $("#code-input");
  const roomsList = $("#rooms-list");
  const onlineEl = $("#online-count");
  const alphabet = (data.rules.rooms && data.rules.rooms.codeAlphabet) || "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const codeLen = (data.rules.rooms && data.rules.rooms.codeLength) || 5;
  const codeRe = new RegExp(`^[${alphabet}]{${codeLen}}$`);
  codeInput.maxLength = codeLen;

  // ---------- name
  nameInput.value = profile.name || "";
  nameInput.placeholder = "Egg" + Math.floor(Math.random() * 900 + 100);
  const saveName = debounce(() => { profile.name = cleanName(nameInput.value); saveProfile(profile); }, 250);
  nameInput.addEventListener("input", saveName);
  nameInput.addEventListener("blur", () => {
    const c = cleanName(nameInput.value);
    if (c !== nameInput.value) nameInput.value = c;
    profile.name = c;
    saveProfile(profile);
  });
  $("#name-random").addEventListener("click", () => {
    sfx.play("ui_click");
    nameInput.value = randomName();
    profile.name = nameInput.value;
    saveProfile(profile);
  });

  // ---------- mode + map
  const modeIds = Object.keys(data.modes.modes);
  if (!modeIds.includes(profile.mode)) profile.mode = data.modes.defaultMode || modeIds[0];
  const modeDesc = $("#mode-desc");
  radioGroup(modeHost, modeIds.map((id) => {
    const m = data.modes.modes[id];
    return { id, label: m.name, title: m.desc, content: [h("span.mode-short", m.short), h("span.mode-name", m.name)] };
  }), profile.mode, (id) => {
    profile.mode = id;
    saveProfile(profile);
    fillMaps();
    modeDesc.textContent = data.modes.modes[id].desc;
  }, { label: "Game mode", className: "mode-btn" });
  modeDesc.textContent = data.modes.modes[profile.mode].desc;

  function fillMaps() {
    const allowed = data.modes.modes[profile.mode].maps || [];
    const maps = data.mapIndex.maps.filter((m) => allowed.includes(m.id));
    clear(mapSel);
    mapSel.appendChild(h("option", { value: "" }, "Any map"));
    for (const m of maps) mapSel.appendChild(h("option", { value: m.id }, m.name));
    if (!maps.some((m) => m.id === profile.map)) profile.map = "";
    mapSel.value = profile.map;
    mapSel.title = (maps.find((m) => m.id === profile.map) || {}).desc || "Pick a random map from the rotation";
  }
  mapSel.addEventListener("change", () => {
    profile.map = mapSel.value;
    saveProfile(profile);
    mapSel.title = (data.mapIndex.maps.find((m) => m.id === profile.map) || {}).desc || "";
  });
  fillMaps();

  // ---------- actions
  const ensureName = () => {
    let n = cleanName(nameInput.value);
    if (!n) { n = randomName(); nameInput.value = n; }
    profile.name = n;
    saveProfile(profile);
    return n;
  };
  $("#play-btn").addEventListener("click", () => {
    ensureName();
    app.play({ mode: profile.mode, map: profile.map });
  });
  $("#practice-btn").addEventListener("click", () => {
    ensureName();
    app.play({ mode: profile.mode, map: profile.map, offline: true });
  });
  $("#create-btn").addEventListener("click", () => {
    ensureName();
    app.play({ mode: profile.mode, map: profile.map, createRoom: true });
  });
  codeInput.addEventListener("input", () => {
    const v = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, codeLen);
    if (v !== codeInput.value) codeInput.value = v;
    codeInput.setCustomValidity("");
  });
  $("#join-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const code = codeInput.value.toUpperCase();
    if (!codeRe.test(code)) {
      codeInput.setCustomValidity(`Room codes are ${codeLen} letters/numbers`);
      codeInput.reportValidity();
      sfx.play("empty");
      return;
    }
    ensureName();
    app.play({ roomCode: code });
  });

  // ---------- home egg
  const eggHost = $("#home-egg");
  const wName = $("#home-weapon");
  function renderEgg() {
    clear(eggHost).appendChild(eggSVG(data.cosmetics, profile.cos, { title: "Your egg" }));
    const w = data.weapons.weapons[profile.cls];
    fill(wName, gunIcon(profile.cls, w && w.class), h("span", h("b", w ? w.name : ""), h("small", w ? w.class : "")));
  }
  renderEgg();

  // ---------- rooms
  let pollId = 0;
  let lastRooms = null;
  const modeName = (id) => (data.modes.modes[id] || {}).short || id;
  const mapName = (id) => (data.mapIndex.maps.find((m) => m.id === id) || {}).name || id;
  async function refreshRooms(manual = false) {
    if (manual) sfx.play("ui_click");
    const btn = $("#rooms-refresh");
    btn.classList.add("spin");
    try {
      const r = await fetch("/api/rooms", { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      lastRooms = Array.isArray(j.rooms) ? j.rooms : [];
      renderRooms();
    } catch {
      clear(roomsList).appendChild(h("li.rooms-empty", "Can't reach the room list right now. Practice mode works offline."));
      onlineEl.textContent = "";
    } finally {
      setTimeout(() => btn.classList.remove("spin"), 300);
    }
  }
  function renderRooms() {
    const rooms = (lastRooms || []).slice().sort((a, b) => b.n - a.n);
    const total = rooms.reduce((s, r) => s + (r.humans ?? r.n ?? 0), 0);
    onlineEl.textContent = rooms.length ? `${total} player${total === 1 ? "" : "s"} in ${rooms.length} room${rooms.length === 1 ? "" : "s"}` : "";
    clear(roomsList);
    if (!rooms.length) {
      roomsList.appendChild(h("li.rooms-empty", "No public rooms yet. Hit PLAY and start one!"));
      return;
    }
    for (const r of rooms) {
      const full = r.n >= r.max;
      const join = h("button.btn.btn-small", { type: "button", disabled: full, "aria-label": `Join ${modeName(r.mode)} on ${mapName(r.map)}, room ${r.code}` }, full ? "Full" : "Join");
      join.addEventListener("click", () => { ensureName(); app.play({ roomCode: r.code }); });
      roomsList.appendChild(h("li.room-row",
        h("span.badge", { dataset: { mode: r.mode } }, modeName(r.mode)),
        h("span.room-map", h("b", mapName(r.map)), h("small", r.code)),
        h("span.room-fill", { title: `${r.n} of ${r.max} players` },
          h("span.fill-bar", h("i", { style: { width: `${Math.round((r.n / Math.max(1, r.max)) * 100)}%` } })),
          h("small", `${r.n}/${r.max}`)),
        join));
    }
  }
  $("#rooms-refresh").addEventListener("click", () => refreshRooms(true));

  function startPolling() {
    stopPolling();
    refreshRooms();
    pollId = setInterval(() => { if (!document.hidden) refreshRooms(); }, ROOM_POLL_MS);
  }
  function stopPolling() { clearInterval(pollId); pollId = 0; }

  // ---------- mobile notice
  const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches && !window.matchMedia("(any-pointer: fine)").matches;
  if (coarse) $("#mobile-note").hidden = false;

  // ---------- deep link ?room=CODE
  try {
    const q = new URLSearchParams(location.search).get("room");
    if (q && codeRe.test(q.toUpperCase())) {
      codeInput.value = q.toUpperCase();
      toast(`Invite for room ${q.toUpperCase()}: enter a name and press Join.`, "info", 5000);
      setTimeout(() => $("#join-btn").focus(), 50);
    }
  } catch { /* ignore */ }

  return {
    show() { root.hidden = false; startPolling(); renderEgg(); },
    hide() { root.hidden = true; stopPolling(); },
    refreshEgg: renderEgg,
  };
}
