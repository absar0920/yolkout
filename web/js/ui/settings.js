// Settings dialog: controls, video, audio, key bindings (with rebinding).

import { $, h, clear, keyName, put } from "./dom.js";
import { slider, toggle, select, dialog } from "./widgets.js";
import { saveSettings, UI_DEFAULT_SETTINGS } from "./store.js";
import { sfx } from "../audio.js";

// Mirror of the game's input.DEFAULT_BINDS (replaced by the real one when it loads).
let DEFAULT_BINDS = {
  fwd: ["KeyW", "ArrowUp"], back: ["KeyS", "ArrowDown"], left: ["KeyA", "ArrowLeft"], right: ["KeyD", "ArrowRight"],
  jump: ["Space"], reload: ["KeyR"], grenade: ["KeyG"], melee: ["KeyF", "KeyV"],
  swap: ["KeyQ", "KeyE"], primary: ["Digit1"], secondary: ["Digit2"], meleeKey: ["Digit3"],
  aim: [], fire: [], scoreboard: ["Tab"], chat: ["Enter", "KeyT"], teamChat: ["KeyY"],
};

export const BIND_LABELS = [
  ["fwd", "Move forward"], ["back", "Move back"], ["left", "Strafe left"], ["right", "Strafe right"], ["jump", "Jump"],
  ["reload", "Reload"], ["grenade", "Throw grenade"], ["melee", "Melee"], ["swap", "Swap weapon"],
  ["primary", "Primary weapon"], ["secondary", "Sidearm"], ["fire", "Fire (extra key)"], ["aim", "Aim (extra key)"],
  ["scoreboard", "Scoreboard"], ["chat", "Chat"], ["teamChat", "Team chat"],
];

export function getDefaultBinds() { return DEFAULT_BINDS; }

export function effectiveBinds(settings) {
  return Object.assign({}, DEFAULT_BINDS, settings.binds || {});
}

export function initSettings(app) {
  const el = $("#dlg-settings");
  const body = $("#settings-body");
  let capture = null; // {action, btn}

  const apply = (patch) => {
    Object.assign(app.settings, patch);
    saveSettings(app.settings);
    if ("volume" in patch) sfx.setVolume(app.settings.volume);
    app.applySettings(patch);
  };

  // Try to pick up the game's real default binds (cheap module, no three.js).
  import("../game/input.js").then((m) => { if (m && m.DEFAULT_BINDS) { DEFAULT_BINDS = m.DEFAULT_BINDS; if (dlg.isOpen) render(); } }).catch(() => {});

  function section(title, ...rows) {
    return h("section.settings-section", h("h3", title), ...rows);
  }

  function render() {
    const S = app.settings;
    clear(body);
    const pct = (v) => `${Math.round(v * 100)}%`;
    put(body, 
      section("Mouse & controls",
        slider({ id: "set-sens", label: "Mouse sensitivity", min: 0.1, max: 5, step: 0.05, value: S.sensitivity, format: (v) => v.toFixed(2), onInput: (v) => apply({ sensitivity: v }) }).row,
        slider({ id: "set-ads", label: "Aim sensitivity", min: 0.2, max: 2, step: 0.05, value: S.adsSensitivity, format: (v) => v.toFixed(2), onInput: (v) => apply({ adsSensitivity: v }) }).row,
        toggle({ id: "set-invert", label: "Invert mouse Y", checked: S.invertY, onChange: (v) => apply({ invertY: v }) }).row,
        toggle({ id: "set-toggleads", label: "Toggle aim", hint: "Click right mouse once to aim, again to stop", checked: S.toggleAds, onChange: (v) => apply({ toggleAds: v }) }).row,
        toggle({ id: "set-raw", label: "Raw mouse input", hint: "Skips OS acceleration where supported", checked: S.rawInput, onChange: (v) => apply({ rawInput: v }) }).row,
        slider({ id: "set-pad", label: "Gamepad look speed", min: 0.2, max: 3, step: 0.05, value: S.gamepadSensitivity, format: (v) => v.toFixed(2), onInput: (v) => apply({ gamepadSensitivity: v }) }).row,
      ),
      section("Video",
        slider({ id: "set-fov", label: "Field of view", min: 60, max: 110, step: 1, value: S.fov, format: (v) => `${v}°`, onInput: (v) => apply({ fov: v }) }).row,
        select({ id: "set-quality", label: "Graphics quality", value: S.quality, options: [["low", "Low (fastest)"], ["medium", "Medium"], ["high", "High"]],
          onChange: (v) => apply({ quality: v, shadows: v !== "low" ? S.shadows : false }) }).row,
        toggle({ id: "set-shadows", label: "Shadows", checked: S.shadows, onChange: (v) => apply({ shadows: v }) }).row,
        toggle({ id: "set-fps", label: "Show FPS and ping", checked: S.showFps, onChange: (v) => apply({ showFps: v }) }).row,
        toggle({ id: "set-bob", label: "View bob", checked: S.viewBob, onChange: (v) => apply({ viewBob: v }) }).row,
        toggle({ id: "set-plates", label: "Name tags", checked: S.nameplates, onChange: (v) => apply({ nameplates: v }) }).row,
        toggle({ id: "set-xhair", label: "Crosshair", checked: S.crosshair, onChange: (v) => apply({ crosshair: v }) }).row,
        h("div.field.select-row",
          h("label", { for: "set-xcolor" }, "Crosshair colour"),
          (() => {
            const i = h("input", { type: "color", id: "set-xcolor", value: S.crosshairColor || "#ffffff" });
            i.addEventListener("input", () => apply({ crosshairColor: i.value }));
            return i;
          })()),
        h("p.hint", "Quality and shadow changes may take effect at the next map load."),
      ),
      section("Audio",
        slider({ id: "set-vol", label: "Master volume", min: 0, max: 1, step: 0.01, value: S.volume, format: pct, onInput: (v) => apply({ volume: v }) }).row,
        h("div.field", h("span"), (() => {
          const b = h("button.btn.btn-small", { type: "button" }, "Test sound");
          let i = 0;
          const names = ["shoot_benedict", "headshot", "kill", "explode", "pickup"];
          b.addEventListener("click", () => { sfx.unlock(); setTimeout(() => sfx.play(names[i++ % names.length], { local: true }), 30); });
          return b;
        })()),
      ),
      section("Key bindings", bindsTable(),
        h("p.hint", "Click a key to rebind it, then press the new key (Esc cancels, Backspace clears). Left mouse fires, right mouse aims, mouse wheel swaps weapons."),
        (() => {
          const b = h("button.btn.btn-small.btn-ghost", { type: "button" }, "Reset key bindings");
          b.addEventListener("click", () => { apply({ binds: null }); render(); });
          return b;
        })()),
      h("div.settings-foot", (() => {
        const b = h("button.btn.btn-ghost", { type: "button" }, "Reset all settings");
        b.addEventListener("click", () => {
          if (!confirm("Reset every setting to its default?")) return;
          Object.keys(app.settings).forEach((k) => delete app.settings[k]);
          apply(Object.assign({}, UI_DEFAULT_SETTINGS));
          render();
        });
        return b;
      })()),
    );
  }

  function bindsTable() {
    const binds = effectiveBinds(app.settings);
    const tbl = h("table.binds", h("thead", h("tr", h("th", { scope: "col" }, "Action"), h("th", { scope: "col" }, "Key"), h("th", { scope: "col" }, "Also"))));
    const tb = h("tbody");
    for (const [action, label] of BIND_LABELS) {
      const keys = binds[action] || [];
      const cell = (idx) => {
        const b = h("button.keycap", { type: "button", "aria-label": `${label}: ${keys[idx] ? keyName(keys[idx]) : "unbound"}. Press to rebind.` }, keys[idx] ? keyName(keys[idx]) : "-");
        b.addEventListener("click", () => startCapture(action, idx, b));
        return h("td", b);
      };
      tb.appendChild(h("tr", h("th", { scope: "row" }, label), cell(0), cell(1)));
    }
    tb.appendChild(h("tr.fixed", h("th", { scope: "row" }, "Fire / Aim"), h("td", h("span.keycap.static", "LMB")), h("td", h("span.keycap.static", "RMB"))));
    tb.appendChild(h("tr.fixed", h("th", { scope: "row" }, "Pause / menu"), h("td", h("span.keycap.static", "Esc")), h("td")));
    tbl.appendChild(tb);
    return tbl;
  }

  function startCapture(action, idx, btn) {
    stopCapture();
    capture = { action, idx, btn };
    btn.classList.add("capturing");
    btn.textContent = "Press a key";
    sfx.play("ui_click");
  }
  function stopCapture() {
    if (capture) capture.btn.classList.remove("capturing");
    capture = null;
  }
  // capture phase so the dialog's Esc handling and the game's input never see it
  window.addEventListener("keydown", (e) => {
    if (!capture) return;
    e.preventDefault();
    e.stopPropagation();
    const { action, idx } = capture;
    if (e.code === "Escape") { stopCapture(); render(); return; }
    const binds = JSON.parse(JSON.stringify(effectiveBinds(app.settings)));
    const list = (binds[action] || []).slice();
    if (e.code === "Backspace" || e.code === "Delete") list.splice(idx, 1);
    else {
      // a key does one thing: remove it from other actions (except chat/teamChat pairs stay separate)
      for (const k of Object.keys(binds)) binds[k] = (binds[k] || []).filter((c) => c !== e.code);
      const cur = (binds[action] || []).slice();
      cur[idx] = e.code;
      binds[action] = cur.filter(Boolean);
      stopCapture();
      apply({ binds });
      sfx.play("pickup");
      render();
      return;
    }
    binds[action] = list;
    stopCapture();
    apply({ binds });
    render();
  }, true);

  const dlg = dialog(el, { onOpen: render, onClose: () => { stopCapture(); app.onDialogClosed && app.onDialogClosed("settings"); } });
  el.addEventListener("cancel", (e) => { if (capture) e.preventDefault(); });
  return dlg;
}
