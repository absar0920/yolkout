// Loadout & style screen: primary weapon with stat bars, shell colour / hat / stamp,
// live preview (2D SVG instantly, upgraded to the real 3D avatar when WebGL is available).

import { $, h, clear, fill } from "./dom.js";
import { radioGroup } from "./widgets.js";
import { eggSVG, swatchSVG } from "./egg2d.js";
import { gunIcon, grenadeIcon, meleeIcon } from "./icons.js";
import { weaponStats } from "./data.js";
import { saveProfile } from "./store.js";
import { sfx } from "../audio.js";

const STAT_ROWS = [
  ["damage", "Damage", (r) => `${Math.round(r.damage)}${r.pellets > 1 ? "" : ""}`],
  ["rpm", "Fire rate", (r) => `${Math.round(r.rpm)} rpm`],
  ["range", "Range", (r) => `${Math.round(r.range)} m`],
  ["accuracy", "Accuracy", (r) => `${Math.round(r.accuracy * 100)}%`],
  ["mobility", "Mobility", (r) => `${Math.round(r.mobility * 100)}%`],
  ["mag", "Magazine", (r) => `${r.mag}`],
];

export function initLoadout(app) {
  const { data, profile } = app;
  const W = data.weapons;
  const CM = data.cosmetics;
  const stats = weaponStats(W);
  const root = $("#loadout");
  const list = $("#weapon-list");
  const detail = $("#weapon-detail");
  const grid = $("#cos-grid");
  const stage = $("#preview-stage");
  const caption = $("#preview-caption");
  let tab = "color";
  let draft = null; // {cls, cos}
  let onDone = null;
  let p3d = null;
  let p3dPending = false;
  let returnFocus = null;

  function renderPreview() {
    const hatName = (CM.hats.find((x) => x.id === draft.cos.hat) || {}).name || "";
    const colName = (CM.colors.find((x) => x.id === draft.cos.color) || {}).name || "";
    const stName = (CM.stamps.find((x) => x.id === draft.cos.stamp) || {}).name || "";
    caption.textContent = [colName, hatName !== "No Hat" ? hatName : "", stName !== "Blank" ? stName : ""].filter(Boolean).join(" · ");
    if (p3d) { p3d.set(draft.cos, draft.cls); return; }
    const old = stage.querySelector(".egg2d");
    const svg = eggSVG(CM, draft.cos, { title: "Preview of your egg" });
    if (old) old.replaceWith(svg); else stage.appendChild(svg);
  }

  async function try3D() {
    if (p3d || p3dPending) return;
    p3dPending = true;
    stage.classList.add("loading3d");
    try {
      const { mountPreview3D } = await import("./preview3d.js");
      const ctl = await mountPreview3D(stage, draft.cos, draft.cls);
      if (ctl && !root.hidden) {
        p3d = ctl;
        stage.classList.add("has3d");
        renderPreview();
      } else if (ctl) ctl.dispose();
    } catch (e) {
      console.warn(e);
    } finally {
      p3dPending = false;
      stage.classList.remove("loading3d");
    }
  }

  function renderWeapons() {
    radioGroup(list, W.primaries.filter((id) => W.weapons[id]).map((id) => {
      const w = W.weapons[id];
      return { id, label: `${w.name}, ${w.class}`, content: [gunIcon(id, w.class), h("span.w-text", h("b", w.name), h("small", w.class))] };
    }), draft.cls, (id) => { draft.cls = id; renderDetail(); renderPreview(); }, { label: "Primary weapon", className: "weapon-btn" });
    list.dataset.vertical = "1";
    renderDetail();
  }

  function renderDetail() {
    const w = W.weapons[draft.cls];
    const st = stats[draft.cls];
    if (!w || !st) { clear(detail); return; }
    const raw = Object.assign({ pellets: w.pellets }, st.raw);
    const rows = STAT_ROWS.map(([k, label, fmt]) => h("div.stat",
      h("span.stat-label", label),
      h("span.stat-bar", { role: "meter", "aria-label": label, "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(st[k] * 100)) },
        h("i", { style: { width: `${Math.round(st[k] * 100)}%` } })),
      h("span.stat-val", fmt(raw))));
    const mode = { auto: "Full auto", semi: "Semi auto", burst: `${w.burstCount}-round burst` }[w.fireMode] || w.fireMode;
    const extras = [];
    if (w.pellets > 1) extras.push(`${w.pellets} pellets`);
    if (w.kind === "projectile" && w.projectile) extras.push(`${w.projectile.splashRadius} m splash`);
    extras.push(`${w.headMul}x headshot`);
    extras.push(`${w.reloadTime}s reload`);
    fill(detail, 
      h("div.wd-head", gunIcon(draft.cls, w.class), h("div", h("h3", w.name), h("p.wd-class", `${w.class} · ${mode}`))),
      h("p.wd-desc", w.desc || ""),
      h("div.stats", rows),
      h("p.wd-extra", extras.join(" · ")),
    );
  }

  function renderKit() {
    const sec = W.weapons[W.secondary], gr = W.weapons[W.grenade], me = W.weapons[W.melee];
    fill($("#kit-list"), 
      sec ? h("li", gunIcon(W.secondary, sec.class), h("span", h("b", sec.name), h("small", `${sec.class} · infinite spare mags`))) : null,
      gr ? h("li", grenadeIcon(), h("span", h("b", gr.name), h("small", `Grenade · start with ${gr.startCount}, carry ${gr.maxCount}`))) : null,
      me ? h("li", meleeIcon(), h("span", h("b", me.name), h("small", `Melee · ${me.damage} damage`))) : null,
    );
  }

  function renderTab() {
    for (const b of root.querySelectorAll("[role=tab]")) {
      const on = b.dataset.tab === tab;
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
    }
    grid.setAttribute("aria-labelledby", "tab-" + tab);
    if (tab === "color") {
      radioGroup(grid, CM.colors.map((c) => ({ id: c.id, label: c.name, title: c.name, content: [swatchSVG(c), h("span.cos-name", c.name)] })),
        draft.cos.color, (id) => { draft.cos.color = id; renderPreview(); }, { label: "Shell colour", className: "cos-btn" });
    } else if (tab === "hat") {
      radioGroup(grid, CM.hats.map((x) => ({ id: x.id, label: x.name, title: x.name,
        content: [eggSVG(CM, { color: draft.cos.color, hat: x.id, stamp: "none" }, { only: "hat" }), h("span.cos-name", x.name)] })),
      draft.cos.hat, (id) => { draft.cos.hat = id; renderPreview(); }, { label: "Hat", className: "cos-btn" });
    } else {
      radioGroup(grid, CM.stamps.map((x) => ({ id: x.id, label: x.name, title: x.name,
        content: [eggSVG(CM, { color: draft.cos.color, hat: "none", stamp: x.id }, { only: "stamp", eyes: false }), h("span.cos-name", x.name)] })),
      draft.cos.stamp, (id) => { draft.cos.stamp = id; renderPreview(); }, { label: "Stamp", className: "cos-btn" });
    }
  }

  const tabs = Array.from(root.querySelectorAll("[role=tab]"));
  tabs.forEach((b, i) => {
    b.addEventListener("click", () => { sfx.play("ui_click"); tab = b.dataset.tab; renderTab(); });
    b.addEventListener("keydown", (e) => {
      let j = -1;
      if (e.key === "ArrowRight") j = (i + 1) % tabs.length;
      else if (e.key === "ArrowLeft") j = (i - 1 + tabs.length) % tabs.length;
      if (j < 0) return;
      e.preventDefault();
      tab = tabs[j].dataset.tab;
      renderTab();
      tabs[j].focus();
    });
  });

  $("#loadout-random").addEventListener("click", () => {
    sfx.play("pickup");
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)].id;
    draft.cos = { color: pick(CM.colors), hat: pick(CM.hats), stamp: pick(CM.stamps) };
    renderTab();
    renderPreview();
  });

  const finish = (save) => {
    if (save) {
      profile.cls = draft.cls;
      profile.cos = Object.assign({}, draft.cos);
      saveProfile(profile);
      sfx.play("pickup");
    } else sfx.play("ui_back");
    root.hidden = true;
    if (p3d) { p3d.dispose(); p3d = null; stage.classList.remove("has3d"); }
    const cb = onDone;
    onDone = null;
    if (cb) cb(save);
    if (returnFocus && returnFocus.isConnected) returnFocus.focus();
  };
  $("#loadout-done").addEventListener("click", () => finish(true));
  $("#loadout-back").addEventListener("click", () => finish(false));
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); finish(false); }
  });

  renderKit();

  return {
    /** Open the screen. done(saved) runs on close. */
    open(done, { inGame = false } = {}) {
      returnFocus = document.activeElement;
      draft = { cls: profile.cls, cos: Object.assign({}, profile.cos) };
      onDone = done;
      root.classList.toggle("in-game", inGame);
      $("#loadout-note").textContent = inGame ? "Your new primary is issued at your next respawn. Style changes apply right away." : "";
      root.hidden = false;
      renderWeapons();
      renderTab();
      renderPreview();
      $("#loadout-done").focus();
      try3D();
    },
    close: () => finish(false),
    get isOpen() { return !root.hidden; },
  };
}
