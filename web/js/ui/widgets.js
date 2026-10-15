// Reusable accessible widgets.

import { h, clear } from "./dom.js";
import { sfx } from "../audio.js";

/**
 * Accessible radio group made of buttons (roving tabindex, arrow keys, Home/End).
 * items: [{id, label (string|Node), content (Node|Node[]), title}]
 */
export function radioGroup(host, items, selected, onSelect, { label = "", className = "" } = {}) {
  clear(host);
  host.setAttribute("role", "radiogroup");
  if (label) host.setAttribute("aria-label", label);
  const btns = [];
  const select = (id, focus = false, fire = true) => {
    for (const b of btns) {
      const on = b.dataset.id === id;
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
      b.classList.toggle("selected", on);
      if (on && focus) b.focus();
    }
    if (fire) onSelect(id);
  };
  for (const it of items) {
    const b = h("button", {
      type: "button", role: "radio", class: className || null, title: it.title || null,
      dataset: { id: it.id }, "aria-label": typeof it.label === "string" && it.content ? it.label : null,
    }, it.content || it.label);
    b.addEventListener("click", () => { sfx.play("ui_click"); select(it.id); });
    b.addEventListener("keydown", (e) => {
      const i = btns.indexOf(b);
      let j = -1;
      const cols = Math.max(1, Math.round(host.clientWidth / Math.max(1, b.offsetWidth)));
      if (e.key === "ArrowRight") j = i + 1;
      else if (e.key === "ArrowLeft") j = i - 1;
      else if (e.key === "ArrowDown") j = i + (host.dataset.vertical ? 1 : cols);
      else if (e.key === "ArrowUp") j = i - (host.dataset.vertical ? 1 : cols);
      else if (e.key === "Home") j = 0;
      else if (e.key === "End") j = btns.length - 1;
      else return;
      e.preventDefault();
      j = Math.max(0, Math.min(btns.length - 1, j));
      sfx.play("ui_hover");
      select(btns[j].dataset.id, true);
    });
    btns.push(b);
    host.appendChild(b);
  }
  if (!btns.some((b) => b.dataset.id === selected) && btns[0]) selected = btns[0].dataset.id;
  select(selected, false, false);
  return { select: (id) => select(id, false, false), buttons: btns };
}

/** Labelled range slider row. format(v) -> display text. */
export function slider({ id, label, min, max, step, value, format = (v) => String(v), onInput }) {
  const out = h("output", { for: id, class: "range-val" }, format(value));
  const input = h("input", { type: "range", id, min, max, step, value: String(value) });
  input.addEventListener("input", () => { const v = parseFloat(input.value); out.textContent = format(v); onInput(v); });
  return { row: h("div.field.range-row", h("label", { for: id }, label), input, out), input, out };
}

/** Labelled checkbox (switch styling). */
export function toggle({ id, label, checked, onChange, hint }) {
  const input = h("input", { type: "checkbox", id, role: "switch", checked: !!checked });
  input.addEventListener("change", () => { sfx.play("ui_click"); onChange(input.checked); });
  return { row: h("div.field.toggle-row", h("label", { for: id }, label, hint ? h("small", hint) : null), input), input };
}

export function select({ id, label, options, value, onChange }) {
  const sel = h("select", { id }, options.map(([v, t]) => h("option", { value: v, selected: v === value }, t)));
  sel.addEventListener("change", () => { sfx.play("ui_click"); onChange(sel.value); });
  return { row: h("div.field.select-row", h("label", { for: id }, label), sel), input: sel };
}

/** Wire a <dialog>: close buttons, backdrop click, sounds. Returns {open, close}. */
export function dialog(el, { onOpen, onClose } = {}) {
  el.addEventListener("click", (e) => {
    if (e.target === el) { el.close(); return; } // backdrop
    if (e.target.closest("[data-close]")) el.close();
  });
  el.addEventListener("close", () => { sfx.play("ui_back"); onClose && onClose(); });
  return {
    open() {
      if (el.open) return;
      sfx.play("ui_click");
      onOpen && onOpen();
      if (typeof el.showModal === "function") el.showModal(); else el.setAttribute("open", "");
    },
    close() { if (el.open) el.close(); },
    get isOpen() { return el.open; },
  };
}
