// Tiny DOM helpers. All user-provided text goes through textContent (never innerHTML).

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/**
 * h("div.card#id", {attr: v, on: {click}}, ...children)
 * Children: strings (as text), nodes, arrays, null/false (skipped).
 */
export function h(tag, attrs, ...kids) {
  const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(tag);
  const el = document.createElement((m && m[1]) || "div");
  if (m && m[2]) {
    for (const part of m[2].match(/[.#][\w-]+/g)) {
      if (part[0] === ".") el.classList.add(part.slice(1));
      else el.id = part.slice(1);
    }
  }
  if (attrs && (typeof attrs !== "object" || attrs instanceof Node || Array.isArray(attrs))) {
    kids.unshift(attrs);
    attrs = null;
  }
  if (attrs) setAttrs(el, attrs);
  append(el, kids);
  return el;
}

export function setAttrs(el, attrs) {
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "on") for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k === "text") el.textContent = v;
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
}

export function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false || k === true) continue;
    el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}

const SVGNS = "http://www.w3.org/2000/svg";
/** SVG element: s("path", {d: "..."}, ...children) */
export function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== undefined && v !== null && v !== false) el.setAttribute(k, String(v));
  for (const k of kids.flat(Infinity)) if (k) el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export function show(el, on = true) { if (el) el.hidden = !on; }

/** Format seconds as m:ss. */
export function mmss(sec) {
  const t = Math.max(0, Math.ceil(sec || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

/** Human key name for a KeyboardEvent.code. */
export function keyName(code) {
  if (!code) return "-";
  const map = {
    Space: "Space", Enter: "Enter", Tab: "Tab", Escape: "Esc", Backspace: "Bksp", ShiftLeft: "L-Shift", ShiftRight: "R-Shift",
    ControlLeft: "L-Ctrl", ControlRight: "R-Ctrl", AltLeft: "L-Alt", AltRight: "R-Alt", ArrowUp: "Up", ArrowDown: "Down",
    ArrowLeft: "Left", ArrowRight: "Right", CapsLock: "Caps", Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[",
    BracketRight: "]", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Backslash: "\\",
  };
  if (map[code]) return map[code];
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return "Num " + code.slice(6);
  return code;
}

/** Simple transient toast in #toasts. */
export function toast(msg, kind = "info", ms = 3200) {
  const host = document.getElementById("toasts");
  if (!host) return;
  const t = h("div.toast", { role: kind === "error" ? "alert" : "status" }, msg);
  t.classList.add("toast-" + kind);
  host.appendChild(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 300); }, ms);
}

export function debounce(fn, ms) {
  let id = 0;
  return (...a) => { clearTimeout(id); id = setTimeout(() => fn(...a), ms); };
}

/** Append children, skipping null/false (Element.append would print "null"). */
export function put(el, ...kids) { return append(el, kids); }

/** Replace all children. */
export function fill(el, ...kids) { clear(el); return append(el, kids); }
