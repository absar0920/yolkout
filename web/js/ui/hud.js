// In-game HUD: vitals, ammo, timer, objective, killfeed, chat, scoreboard, respawn, streak
// toasts, pause menu, click-to-play, match results and disconnect screens.
// The game itself draws the crosshair, hit markers, damage arrows, scope and vignette on its own
// overlay canvas; this module never duplicates those.

import { $, h, clear, mmss, fill, put, keyName } from "./dom.js";
import { crackIcon, skullIcon, eggIcon, gunIcon } from "./icons.js";
import { sfx } from "../audio.js";
import { effectiveBinds } from "./settings.js";

const KILLFEED_MAX = 6;
const KILLFEED_MS = 7000;
const CHAT_MAX = 40;

export function initHud(app) {
  const { data } = app;
  const teamsDef = data.modes.teams || {};
  const teamColor = (t) => (teamsDef[t] && teamsDef[t].color) || "#ffffff";
  const teamName = (t) => (teamsDef[t] && teamsDef[t].name) || "";

  const root = $("#hud");
  const E = (id) => document.getElementById(id);
  const el = {
    room: E("hud-room"), ping: E("hud-ping"), net: E("hud-net"),
    timer: E("hud-timer"), objective: E("hud-objective"),
    killfeed: E("killfeed"), callout: E("hud-callout"), toasts: E("hud-toasts"),
    respawn: E("hud-respawn"), killerName: E("killer-name"), killerWeapon: E("killer-weapon"), respawnCount: E("respawn-count"), respawnLabel: E("respawn-label"), respawnTitle: E("respawn-title"), respawnLoadout: E("respawn-loadout"), respawnKey: document.querySelector("#respawn-loadout kbd"),
    chips: E("hud-chips"), prot: E("chip-prot"), fury: E("chip-fury"), streak: E("chip-streak"), carry: E("chip-carry"),
    vitals: E("vitals"), hpFill: E("hp-fill"), shRing: E("sh-ring"), hpNum: E("hp-num"), shNum: E("sh-num"),
    weapon: E("weapon-panel"), wName: E("w-name"), wIcon: E("w-icon"), mag: E("ammo-mag"), res: E("ammo-res"), reload: E("reload-bar"), reloadFill: E("reload-fill"),
    ammoHint: E("ammo-hint"), slot0: E("slot-0"), slot1: E("slot-1"), gren: E("gren-pips"),
    chat: E("chat"), chatLog: E("chat-log"), chatForm: E("chat-form"), chatInput: E("chat-input"), chatScope: E("chat-scope"),
    sb: E("scoreboard"), pause: E("pause"), clickPlay: E("click-to-play"), end: E("match-end"), disc: E("disconnected"),
    pauseCode: E("pause-code"), pauseInfo: E("pause-info"),
  };

  let game = null;
  const st = {
    locked: false, paused: false, chatOpen: false, chatTeam: false, ended: false, disc: null, started: false,
    sbVisible: false, sb: null, mode: "", teams: false, myTeam: 0, myId: 0, room: null, lastDeath: null,
    endTimer: 0, endAt: 0, hud: null, objKey: "", gameOver: false,
  };
  const cache = new Map();
  const set = (node, key, val, prop = "textContent") => {
    const k = key;
    if (cache.get(k) === val) return;
    cache.set(k, val);
    if (prop === "textContent") node.textContent = val;
    else if (prop === "hidden") node.hidden = !!val;
    else if (prop.startsWith("attr:")) node.setAttribute(prop.slice(5), val);
    else if (prop.startsWith("class:")) node.classList.toggle(prop.slice(6), !!val);
    else if (prop.startsWith("style:")) node.style.setProperty(prop.slice(6), val);
  };

  // ------------------------------------------------------------ overlays

  function updateOverlays() {
    const disc = !!st.disc;
    el.disc.hidden = !disc;
    el.end.hidden = disc || !st.ended;
    el.pause.hidden = disc || st.ended || !st.paused || app.isMenuOpen();
    el.clickPlay.hidden = disc || !st.started || st.paused || st.locked || st.chatOpen || st.ended || app.isMenuOpen();
    root.classList.toggle("is-paused", st.paused);
    root.classList.toggle("is-unlocked", !st.locked);
    if (!el.pause.hidden && !el.pause.contains(document.activeElement)) {
      const b = $("#pause-resume");
      if (b) b.focus({ preventScroll: true });
    }
  }
  document.addEventListener("pointerlockchange", () => {
    st.locked = !!document.pointerLockElement;
    updateOverlays();
  });

  const resume = () => {
    if (!game) return;
    sfx.play("ui_click");
    try { game.resume(); } catch (e) { console.warn(e); }
  };
  el.clickPlay.addEventListener("click", resume);
  $("#pause-resume").addEventListener("click", resume);
  $("#pause-leave").addEventListener("click", () => { sfx.play("ui_back"); app.leave(); });
  $("#pause-settings").addEventListener("click", () => app.openSettings());
  $("#pause-help").addEventListener("click", () => app.openHelp());
  $("#pause-loadout").addEventListener("click", () => app.openLoadoutInGame());
  $("#respawn-loadout").addEventListener("click", () => { if (game) game.pause(); app.openLoadoutInGame(); });
  $("#end-leave").addEventListener("click", () => { sfx.play("ui_back"); app.leave(); });
  $("#disc-menu").addEventListener("click", () => app.leave());
  $("#disc-retry").addEventListener("click", () => app.reconnect());
  $("#pause-copy").addEventListener("click", async () => {
    const url = inviteUrl();
    try { await navigator.clipboard.writeText(url); toastHud("Invite link copied", "info"); } catch { window.prompt("Copy this invite link:", url); }
  });

  function inviteUrl() {
    const u = new URL(location.href);
    u.search = "";
    u.hash = "";
    if (st.room && st.room.code) u.searchParams.set("room", st.room.code);
    return u.toString();
  }

  // ------------------------------------------------------------ chat

  function addChat(msg) {
    const li = h("li.chat-line");
    if (msg.system) {
      li.classList.add("sys");
      li.textContent = msg.text;
    } else {
      const nm = h("b.chat-name", (msg.teamOnly ? "[team] " : "") + (msg.name || "?") + ":");
      if (st.teams && msg.team) nm.style.color = teamColor(msg.team);
      else if (msg.me) nm.classList.add("me");
      put(li, nm, " ", h("span", msg.text));
      if (!msg.me) sfx.play("chat", { volume: 0.5 });
    }
    li.dataset.t = String(Date.now());
    el.chatLog.appendChild(li);
    while (el.chatLog.children.length > CHAT_MAX) el.chatLog.firstChild.remove();
    el.chatLog.scrollTop = el.chatLog.scrollHeight;
  }
  function openChat(teamOnly) {
    st.chatOpen = true;
    st.chatTeam = !!teamOnly;
    el.chatScope.textContent = teamOnly ? "Team" : "All";
    el.chatScope.classList.toggle("team", !!teamOnly);
    el.chatForm.hidden = false;
    el.chat.classList.add("open");
    el.chatInput.value = "";
    setTimeout(() => el.chatInput.focus(), 0);
    updateOverlays();
  }
  function closeChat() {
    st.chatOpen = false;
    el.chatForm.hidden = true;
    el.chat.classList.remove("open");
    el.chatInput.blur();
    updateOverlays();
  }
  el.chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!game) return;
    const text = el.chatInput.value.trim();
    if (text) game.sendChat(text, st.chatTeam); else if (game.cancelChat) game.cancelChat();
    closeChat();
    resume();
  });
  el.chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (game && game.cancelChat) game.cancelChat();
      closeChat();
    } else if (e.key === "Tab" && st.teams) {
      e.preventDefault();
      st.chatTeam = !st.chatTeam;
      el.chatScope.textContent = st.chatTeam ? "Team" : "All";
      el.chatScope.classList.toggle("team", st.chatTeam);
    }
  });

  // ------------------------------------------------------------ toasts / callouts

  function toastHud(text, kind = "info", color) {
    const t = h("div.hud-toast", text);
    t.classList.add("k-" + kind);
    if (color) t.style.setProperty("--accent", color);
    el.toasts.appendChild(t);
    while (el.toasts.children.length > 4) el.toasts.firstChild.remove();
    setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 400); }, 3200);
  }
  let calloutTimer = 0;
  function callout(main, sub, kind = "kill") {
    fill(el.callout, h("div.co-main", main), sub ? h("div.co-sub", sub) : null);
    el.callout.className = "callout show k-" + kind;
    clearTimeout(calloutTimer);
    calloutTimer = setTimeout(() => { el.callout.className = "callout"; }, 1900);
  }

  // ------------------------------------------------------------ killfeed

  function nameSpan(who) {
    const sp = h("span.kf-name", who && who.name ? who.name : "?");
    if (who && who.me) sp.classList.add("me");
    if (st.teams && who && who.team) sp.style.color = teamColor(who.team);
    return sp;
  }
  function addKill(ev) {
    const li = h("li.kf-entry");
    if (ev.meKiller || ev.meVictim) li.classList.add("involved");
    const wpn = data.weapons.weapons[ev.weapon];
    const wchip = h("span.kf-weapon", { title: ev.weaponName || ev.weapon }, ev.weapon === "fall" ? "fell" : ev.weaponName || ev.weapon);
    if (ev.suicide) {
      put(li, skullIcon(), nameSpan(ev.victim), wchip);
    } else {
      put(li, nameSpan(ev.killer), wpn && wpn.slot !== undefined ? gunIcon(ev.weapon, wpn.class) : null, wchip, ev.headshot ? crackIcon() : null, nameSpan(ev.victim));
    }
    el.killfeed.appendChild(li);
    while (el.killfeed.children.length > KILLFEED_MAX) el.killfeed.firstChild.remove();
    setTimeout(() => { li.classList.add("out"); setTimeout(() => li.remove(), 400); }, KILLFEED_MS);

    if (ev.meKiller) {
      const sub = [];
      if (ev.headshot) sub.push("Headshot!");
      if (ev.streak >= 2) sub.push(`${ev.streak} in a row`);
      callout(h("span", "Cracked ", nameSpan(ev.victim)), sub.join(" · "), ev.headshot ? "hs" : "kill");
    }
    if (ev.meVictim) {
      st.lastDeath = { killer: ev.suicide ? null : ev.killer, weaponName: ev.weapon === "fall" ? "a long fall" : ev.weaponName, headshot: ev.headshot, suicide: ev.suicide };
    }
  }

  // ------------------------------------------------------------ scoreboard

  function scoreTable(rows, { compact = false } = {}) {
    const head = h("tr", h("th", { scope: "col", class: "sb-name" }, "Egg"), h("th", { scope: "col" }, "Score"), h("th", { scope: "col" }, "K"),
      h("th", { scope: "col" }, "D"), compact ? null : h("th", { scope: "col" }, "Streak"), compact ? null : h("th", { scope: "col" }, "Ping"));
    const body = rows.map((r, i) => {
      const tr = h("tr", { class: [r.me ? "me" : "", r.alive === false ? "dead" : ""].join(" ").trim() || null },
        h("th", { scope: "row", class: "sb-name" }, h("span.sb-rank", String(i + 1)), h("span.sb-n", r.name)),
        h("td", String(r.score)), h("td", String(r.kills)), h("td", String(r.deaths)),
        compact ? null : h("td", r.streak >= 2 ? String(r.streak) : "-"), compact ? null : h("td", r.ping ? String(r.ping) : "-"));
      return tr;
    });
    return h("table.sb-table", h("thead", head), h("tbody", body));
  }
  function renderScoreboard() {
    const d = st.sb;
    if (!d) return;
    const title = h("div.sb-title", h("b", d.modeName || ""), h("span", (st.room && st.room.mapName) || ""), h("span.sb-time", mmss(d.timeLeft)));
    let content;
    if (d.teams && d.teams.length) {
      content = h("div.sb-teams", d.teams.map((t, i) => h("section.sb-team", { style: { "--team": t.color } },
        h("header", h("b", t.name), h("span.sb-tscore", String((d.teamScores || [])[i] ?? 0))),
        scoreTable(d.players.filter((p) => p.team === t.id)))));
    } else {
      content = scoreTable(d.players);
    }
    fill(el.sb, title, content, h("p.sb-foot", `First to ${d.limit} · ${d.players.length} eggs`));
  }

  // ------------------------------------------------------------ objective

  function buildObjective(mode) {
    clear(el.objective);
    // the elements are new: forget their cached values so updateObjective() writes them again
    for (const k of cache.keys()) if (k.startsWith("obj")) cache.delete(k);
    st.objKey = mode;
    const md = data.modes.modes[mode] || {};
    el.objective.dataset.mode = mode;
    if (md.teams) {
      for (const t of [1, 2]) {
        const box = h("div.obj-team", { id: `obj-t${t}`, style: { "--team": teamColor(t) } },
          md.objective === "nest" ? h("span.obj-egg", { id: `obj-egg${t}` }, eggIcon(teamColor(t))) : null,
          h("span.obj-tname", teamName(t)),
          h("b.obj-score", { id: `obj-s${t}` }, "0"),
          h("span.obj-bar", h("i", { id: `obj-b${t}` })),
          md.objective === "nest" ? h("small.obj-state", { id: `obj-st${t}` }, "Home") : null);
        el.objective.appendChild(box);
      }
    } else {
      put(el.objective, h("div.obj-ffa", h("span", "You "), h("b", { id: "obj-me" }, "0"), h("span.obj-sep", "/"), h("span", { id: "obj-limit" }, String(md.scoreLimit || "")),
        h("span.obj-lead", { id: "obj-lead" })));
    }
  }
  function updateObjective(s) {
    const m = s.match;
    if (m.mode !== st.objKey) buildObjective(m.mode);
    const md = data.modes.modes[m.mode] || {};
    const limit = m.limit || md.scoreLimit || 1;
    if (md.teams) {
      for (const t of [1, 2]) {
        const sc = m.teamScores[t - 1] || 0;
        set(E(`obj-s${t}`), `objs${t}`, String(sc));
        set(E(`obj-b${t}`), `objb${t}`, `${Math.min(100, (sc / limit) * 100)}%`, "style:width");
        set(E(`obj-t${t}`), `objmine${t}`, t === m.myTeam, "class:mine");
        if (md.objective === "nest") {
          const o = (s.objective || []).find((x) => x.team === t);
          const label = !o ? "Home" : o.state === "carried" ? `Taken by ${o.carrier ? o.carrier.name : "?"}` : o.state === "dropped" ? "Dropped!" : "Safe at home";
          set(E(`obj-st${t}`), `objst${t}`, label);
          set(E(`obj-t${t}`), `objstate${t}`, o ? o.state : "home", "attr:data-state");
        }
      }
    } else {
      set(E("obj-me"), "objme", String(m.myKills));
      set(E("obj-limit"), "objlim", String(limit));
      const lead = st.sb && st.sb.players && st.sb.players[0];
      const txt = lead && lead.kills > 0 ? (lead.me ? "You lead!" : `Leader: ${lead.name} ${lead.kills}`) : "";
      set(E("obj-lead"), "objlead", txt);
    }
  }

  // ------------------------------------------------------------ main HUD render

  function render(s) {
    st.hud = s;
    st.myId = s.myId;
    if (s.paused !== st.paused) { st.paused = s.paused; updateOverlays(); }
    // vitals
    const hp = Math.max(0, Math.ceil(s.hp || 0));
    const frac = Math.max(0, Math.min(1, (s.hp || 0) / (s.maxHp || 100)));
    set(el.hpNum, "hp", s.alive ? String(hp) : "0");
    set(el.hpFill, "hpy", (6 + (1 - frac) * 70).toFixed(1), "attr:y");
    set(el.vitals, "hplow", s.alive && frac <= 0.3, "class:low");
    set(el.vitals, "hpmid", s.alive && frac > 0.3 && frac <= 0.6, "class:mid");
    const sh = Math.max(0, Math.round(s.shield || 0));
    set(el.shRing, "sh", `${((sh / (s.maxShield || 50)) * 100).toFixed(1)} 100`, "attr:stroke-dasharray");
    set(el.shNum, "shn", sh > 0 ? `+${sh}` : "");
    set(el.vitals, "dead", !s.alive, "class:dead");

    // weapon
    const w = s.weapon;
    if (w) {
      set(el.wName, "wn", w.name);
      if (cache.get("wicon") !== w.id) { cache.set("wicon", w.id); clear(el.wIcon).appendChild(gunIcon(w.id, w.class)); }
      set(el.mag, "mag", String(w.mag));
      set(el.res, "res", w.reserve < 0 ? "∞" : String(w.reserve));
      const low = w.mag <= Math.ceil(w.magSize * 0.25);
      set(el.weapon, "wlow", low, "class:low");
      set(el.weapon, "wempty", w.mag === 0, "class:empty");
      set(el.reload, "rl", !w.reloading, "hidden");
      if (w.reloading) el.reloadFill.style.width = `${Math.round(w.reloadFrac * 100)}%`;
      const hint = w.reloading ? "Reloading" : w.switching ? "Switching" : w.mag === 0 ? (w.reserve === 0 ? "Out of ammo: switch weapon" : "Press R to reload") : "";
      set(el.ammoHint, "hint", hint);
      set(el.slot0, "s0", w.slot === 0, "class:active");
      set(el.slot1, "s1", w.slot === 1, "class:active");
    }
    if (s.primary) set(el.slot0.querySelector("span"), "s0n", s.primary.name);
    if (s.secondary) set(el.slot1.querySelector("span"), "s1n", s.secondary.name);
    const gk = `${s.grenades}/${s.maxGrenades}`;
    if (cache.get("gren") !== gk) {
      cache.set("gren", gk);
      clear(el.gren);
      for (let i = 0; i < s.maxGrenades; i++) el.gren.appendChild(h("i", { class: i < s.grenades ? "on" : null }));
      el.gren.setAttribute("aria-label", `${s.grenades} grenades`);
    }

    // chips
    set(el.prot, "prot", !(s.alive && s.spawnProtected), "hidden");
    set(el.fury, "fury", !(s.fury > 0), "hidden");
    if (s.fury > 0) set(el.fury, "furyt", `Hot Sauce ${Math.ceil(s.fury)}s`);
    set(el.streak, "streak", !(s.streak >= 2), "hidden");
    if (s.streak >= 2) set(el.streak, "streakt", `${s.streak} streak`);
    set(el.carry, "carry", !s.carrying, "hidden");

    // timer + objective
    const m = s.match;
    if (m.state === "live") {
      set(el.timer, "timer", mmss(m.timeLeft));
      set(el.timer, "urgent", m.timeLeft <= 30, "class:urgent");
    } else {
      set(el.timer, "timer", "Intermission");
      set(el.timer, "urgent", false, "class:urgent");
    }
    st.teams = !!m.teams;
    st.myTeam = m.myTeam;
    updateObjective(s);

    // respawn panel
    const showResp = !s.alive && m.state === "live" && st.started;
    set(el.respawn, "resp", !showResp, "hidden");
    if (showResp) {
      const d = st.lastDeath;
      const who = s.killer || (d && d.killer);
      if (d && d.suicide) {
        set(el.respawnTitle, "rt", d.weaponName === "a long fall" ? "You took a long fall" : "You cracked yourself");
        set(el.killerName, "kn", "");
        set(el.killerWeapon, "kw", "");
      } else {
        set(el.respawnTitle, "rt", "Cracked by");
        set(el.killerName, "kn", who ? who.name : "someone");
        set(el.killerWeapon, "kw", d ? `with ${d.weaponName}${d.headshot ? " (headshot)" : ""}` : "");
        if (who && st.teams && who.team) el.killerName.style.color = teamColor(who.team); else el.killerName.style.color = "";
      }
      const soon = s.respawnIn > 0.05;
      set(el.respawnKey, "rk", keyName((effectiveBinds(app.settings).loadout || [])[0]));
      set(el.respawnLoadout, "rlh", !!s.respawnHeld || app.isMenuOpen(), "hidden");
      set(el.respawnLabel, "rl", s.respawnHeld ? (soon ? "Choosing loadout · respawn in" : "Respawning") : soon ? "Respawning in" : "Respawning");
      set(el.respawnCount, "rc", soon ? s.respawnIn.toFixed(1) : "...");
    }

    // network
    if (s.offline) {
      set(el.ping, "ping", "Practice");
      set(el.net, "netq", "good", "attr:data-q");
    } else {
      const p = s.ping || 0;
      set(el.ping, "ping", p ? `${p} ms` : "-- ms");
      set(el.net, "netq", !s.connected ? "bad" : p < 90 ? "good" : p < 170 ? "ok" : "bad", "attr:data-q");
    }
    // live scoreboard clock
    if (st.sbVisible && st.sb) {
      const t = el.sb.querySelector(".sb-time");
      if (t) t.textContent = mmss(m.timeLeft);
    }
  }

  // ------------------------------------------------------------ match end

  function renderEnd(d) {
    const box = $("#end-body");
    let title, cls;
    if (d.draw) { title = "Draw!"; cls = "draw"; }
    else if (d.winnerTeam) { title = d.iWon ? "Victory!" : `${d.winnerTeamName} win`; cls = d.iWon ? "win" : "lose"; }
    else if (d.winnerPlayer) { title = d.iWon ? "You win!" : `${d.winnerPlayer.name} wins`; cls = d.iWon ? "win" : "lose"; }
    else { title = "Match over"; cls = "draw"; }
    const me = d.players.find((p) => p.me);
    const myRank = d.players.findIndex((p) => p.me) + 1;
    const parts = [h("h2.end-title", { class: cls }, title)];
    if (d.teamScores && d.winnerTeam !== undefined && (data.modes.modes[d.mode] || {}).teams) {
      parts.push(h("div.end-teams", [1, 2].map((t) => h("div.end-team", { style: { "--team": teamColor(t) } }, h("span", teamName(t)), h("b", String(d.teamScores[t - 1] || 0))))));
    }
    if (me) {
      const kd = (me.kills / Math.max(1, me.deaths)).toFixed(2);
      parts.push(h("div.end-me",
        h("div", h("b", `#${myRank}`), h("small", "Place")),
        h("div", h("b", String(me.score)), h("small", "Score")),
        h("div", h("b", String(me.kills)), h("small", "Kills")),
        h("div", h("b", String(me.deaths)), h("small", "Deaths")),
        h("div", h("b", kd), h("small", "K/D"))));
    }
    parts.push(h("div.end-table", scoreTable(d.players.slice(0, 12), { compact: true })));
    parts.push(h("p.end-next", { id: "end-next" }, ""));
    fill(box, ...parts);
    st.endAt = performance.now() + (d.intermission || 10) * 1000;
    const tick = () => {
      const left = Math.max(0, Math.ceil((st.endAt - performance.now()) / 1000));
      const n = E("end-next");
      if (n) n.textContent = `Next up: ${d.nextMapName || d.nextMap || "new map"} in ${left}s`;
    };
    tick();
    clearInterval(st.endTimer);
    st.endTimer = setInterval(tick, 250);
  }

  // ------------------------------------------------------------ callbacks for startGame()

  const callbacks = {
    onHud: render,
    onKillfeed: addKill,
    onScoreboard(d) { st.sb = d; if (st.sbVisible) renderScoreboard(); },
    onScoreboardToggle(v) {
      st.sbVisible = !!v;
      el.sb.hidden = !v;
      root.classList.toggle("sb-open", !!v);
      if (v) renderScoreboard();
    },
    onChat: addChat,
    onChatOpen: ({ teamOnly } = {}) => openChat(teamOnly),
    onRoom(info) {
      st.room = Object.assign({}, info, { mapName: (data.mapIndex.maps.find((m) => m.id === info.map) || {}).name || info.map });
      app.onRoom && app.onRoom(info);
      const md = data.modes.modes[info.mode] || {};
      set(el.room, "room", `${md.short || info.mode} · ${st.room.mapName}${info.private && !info.offline ? ` · ${info.code}` : ""}`);
      el.pauseCode.hidden = !info.private || !!info.offline;
      if (info.private) $("#pause-code-val").textContent = info.code;
    },
    onMatchStart(info) {
      st.started = true;
      st.ended = false;
      st.mode = info.mode;
      st.teams = !!info.teams;
      st.myTeam = info.myTeam;
      clearInterval(st.endTimer);
      if (st.room) {
        st.room.map = info.map;
        st.room.mapName = info.mapName;
        const md = data.modes.modes[info.mode] || {};
        set(el.room, "room", `${md.short || info.mode} · ${info.mapName}${st.room.private && !st.room.offline ? ` · ${st.room.code}` : ""}`);
      }
      el.pauseInfo.textContent = `${info.modeName} on ${info.mapName}`;
      buildObjective(info.mode);
      callout(info.mapName, info.teams ? h("span", "You're on the ", h("b", { style: { color: info.myTeamColor } }, info.myTeamName)) : info.modeName, "start");
      updateOverlays();
    },
    onMatchEnd(d) {
      st.ended = true;
      renderEnd(d);
      sfx.play("match_end");
      updateOverlays();
    },
    onDisconnect(reason) {
      if (st.gameOver) return;
      st.disc = reason || { code: "socket", msg: "Connection lost" };
      $("#disc-msg").textContent = errorText(st.disc);
      $("#disc-retry").hidden = ["version", "bad_hello"].includes(st.disc.code);
      updateOverlays();
      $("#disc-menu").focus();
    },
    onPing(ms) {
      if (st.hud && st.hud.offline) return;
      set(el.ping, "ping", `${Math.round(ms)} ms`);
    },
    onPauseChange(p) {
      st.paused = !!p;
      if (p && el.sb && !el.sb.hidden) { st.sbVisible = false; el.sb.hidden = true; root.classList.remove("sb-open"); }
      updateOverlays();
    },
    onStreak(ev) {
      if (ev.me) {
        sfx.play("streak");
        callout(ev.rewardName, `${ev.n} kill streak · ${ev.desc}`, "streak");
      } else {
        toastHud(`${ev.name} is on a ${ev.n} kill streak (${ev.rewardName})`, "streak", st.teams && ev.team ? teamColor(ev.team) : undefined);
      }
    },
    onPickup(ev) {
      if (ev.me) toastHud(`${ev.name}`, "pickup");
    },
    onFlag(ev) {
      sfx.play("flag", { volume: 0.8 });
      const who = ev.name || "";
      const mine = ev.mine; // the egg belongs to my team
      let text;
      switch (ev.ev) {
        case "take": text = mine ? `${who} took your egg!` : ev.me ? "You have their egg! Bring it home!" : `${who} took the ${ev.teamName} egg`; break;
        case "drop": text = mine ? "Your egg was dropped! Return it!" : `The ${ev.teamName} egg was dropped`; break;
        case "return": text = ev.id ? `${who} returned the ${ev.teamName} egg` : `The ${ev.teamName} egg returned home`; break;
        case "cap": text = ev.me ? "You scored a capture!" : `${who} captured the ${ev.teamName} egg!`; break;
        default: text = ev.ev;
      }
      toastHud(text, mine && ev.ev === "take" ? "alert" : "flag", ev.teamColor);
      if (ev.ev === "cap") callout(ev.me ? "Capture!" : `${who} scored`, `${ev.teamName} egg captured`, "streak");
    },
    onHitConfirm() { /* hit markers are drawn by the game overlay */ },
    onDamaged() {
      el.vitals.classList.remove("hurt");
      void el.vitals.offsetWidth;
      el.vitals.classList.add("hurt");
    },
    onSpawn() { st.lastDeath = null; },
    onLoadoutRequest() { if (!app.isMenuOpen()) app.openLoadoutInGame(); },
  };

  function errorText(r) {
    const map = {
      room_full: "That room is full.", no_room: "That room doesn't exist (any more).", server_full: "The server is full right now. Try again soon.",
      version: "Your game is out of date. Reload the page.", socket: "Lost connection to the server.", timeout: "The server did not answer.",
      idle: "You were idle for too long.", rate: "Too many messages: disconnected.", too_many: "Too many attempts. Wait a minute and try again.", too_big: "Message too large: disconnected.",
      bad_msg: "Protocol error: disconnected.", bad_hello: "The server rejected the join request.", unavailable: "Online play is unavailable on this server.",
      closed: "You left the game.", map: "Could not load the map.", restart: "The server is restarting. Reconnect in a few seconds.",
    };
    return (r && map[r.code]) || (r && r.msg) || "Disconnected.";
  }

  return {
    callbacks,
    errorText,
    attach(g) { game = g; },
    start() {
      root.hidden = false;
      updateOverlays();
    },
    reset() {
      Object.assign(st, { locked: !!document.pointerLockElement, paused: false, chatOpen: false, ended: false, disc: null, started: false, sbVisible: false, sb: null, lastDeath: null, hud: null, objKey: "", gameOver: false, room: null });
      cache.clear();
      clearInterval(st.endTimer);
      clear(el.killfeed); clear(el.chatLog); clear(el.toasts); clear(el.objective);
      el.sb.hidden = true; root.classList.remove("sb-open"); el.chatForm.hidden = true; el.chat.classList.remove("open");
      el.respawn.hidden = true;
      el.callout.className = "callout";
      el.room.textContent = "";
      updateOverlays();
    },
    hide() {
      st.gameOver = true;
      game = null;
      clearInterval(st.endTimer);
      root.hidden = true;
    },
    refreshOverlays: updateOverlays,
    get chatOpen() { return st.chatOpen; },
  };
}
