// How-to-play, leaderboard and about dialogs.

import { $, h, clear, keyName, fill } from "./dom.js";
import { dialog } from "./widgets.js";
import { gunIcon, grenadeIcon, meleeIcon } from "./icons.js";
import { effectiveBinds } from "./settings.js";
import { sfx } from "../audio.js";

export function initHelp(app) {
  const { data } = app;
  const body = $("#help-body");
  const keys = (action, max = 3) => {
    const b = (effectiveBinds(app.settings)[action] || []).slice(0, max);
    return b.length ? b.map((c) => h("kbd", keyName(c))) : [h("kbd", "-")];
  };
  function render() {
    const W = data.weapons;
    const P = data.rules.pickups.types;
    fill(body, 
      h("section.help-section",
        h("h3", "Controls"),
        h("dl.controls",
          h("dt", keys("fwd", 1), keys("left", 1), keys("back", 1), keys("right", 1)), h("dd", "Move"),
          h("dt", keys("jump")), h("dd", "Jump"),
          h("dt", h("kbd", "Mouse")), h("dd", "Look around"),
          h("dt", h("kbd", "Left click")), h("dd", "Fire"),
          h("dt", h("kbd", "Right click"), keys("aim")), h("dd", "Aim down sights (slower but steadier)"),
          h("dt", keys("reload")), h("dd", "Reload"),
          h("dt", keys("grenade"), h("kbd", "Middle click")), h("dd", "Throw a grenade"),
          h("dt", keys("melee")), h("dd", "Melee bonk"),
          h("dt", keys("swap"), h("kbd", "Wheel"), keys("primary"), keys("secondary")), h("dd", "Switch weapon"),
          h("dt", keys("scoreboard")), h("dd", "Scoreboard (hold)"),
          h("dt", keys("chat"), keys("teamChat")), h("dd", "Chat / team chat"),
          h("dt", keys("loadout")), h("dd", "Change loadout while dead (holds your respawn up to 10 s)"),
          h("dt", h("kbd", "Esc")), h("dd", "Pause menu"),
        ),
        h("p.hint", "Gamepads work too: sticks to move and look, triggers to aim and fire."),
      ),
      h("section.help-section",
        h("h3", "Modes"),
        h("ul.help-list", Object.values(data.modes.modes).map((m) =>
          h("li", h("b", m.name), ` — ${m.desc} `, h("small", `First to ${m.scoreLimit} ${m.scoreUnit === "teamKills" ? "team kills" : m.scoreUnit}, ${Math.round(m.timeLimitSec / 60)} min, respawn ${m.respawnSec}s.`)))),
      ),
      h("section.help-section",
        h("h3", "Arsenal"),
        h("p", "Pick one primary in the loadout. Everyone also carries a sidearm, grenades and a melee weapon."),
        h("ul.help-weapons", [...W.primaries, W.secondary].map((id) => {
          const w = W.weapons[id];
          return w ? h("li", gunIcon(id, w.class), h("span", h("b", w.name), h("small", `${w.class}. ${w.desc || ""}`))) : null;
        }),
        W.weapons[W.grenade] ? h("li", grenadeIcon(), h("span", h("b", W.weapons[W.grenade].name), h("small", W.weapons[W.grenade].desc || ""))) : null,
        W.weapons[W.melee] ? h("li", meleeIcon(), h("span", h("b", W.weapons[W.melee].name), h("small", W.weapons[W.melee].desc || ""))) : null),
      ),
      h("section.help-section",
        h("h3", "Health, pickups and streaks"),
        h("p", `You have ${data.rules.combat.maxHp} health plus up to ${data.rules.combat.maxShield} shield. Health regenerates after ${data.rules.combat.regenDelay}s without damage. Headshots hurt more. You get ${data.rules.combat.spawnProtection}s of spawn protection, which ends early when you attack.`),
        h("ul.help-list",
          Object.entries(P).map(([k, t]) => h("li", h("b", t.name), " — ", k === "hp" ? `+${t.amount} health` : k === "shield" ? `+${t.amount} shield` : "refills primary ammo and a grenade", h("small", ` (respawns in ${t.respawn}s)`))),
        ),
        h("ul.help-list",
          (data.rules.streaks || []).map((s) => h("li", h("b", `${s.at} kills: ${s.name}`), ` — ${s.desc}`))),
      ),
    );
  }
  return dialog($("#dlg-help"), { onOpen: render, onClose: () => app.onDialogClosed && app.onDialogClosed("help") });
}

export function initLeaderboard() {
  const body = $("#lb-body");
  const meta = $("#lb-meta");
  const tabs = Array.from(document.querySelectorAll("#lb-tabs [role=tab]"));
  let by = "score";
  let seq = 0;
  async function load() {
    const my = ++seq;
    for (const t of tabs) t.setAttribute("aria-selected", t.dataset.by === by ? "true" : "false");
    clear(body).appendChild(h("p.lb-empty", "Loading..."));
    try {
      const r = await fetch(`/api/stats?by=${encodeURIComponent(by)}&n=25`, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      if (my !== seq) return;
      meta.textContent = `${j.online ?? 0} online now · ${j.rooms ?? 0} rooms · ${j.tracked ?? 0} players tracked`;
      const top = Array.isArray(j.top) ? j.top : [];
      if (!top.length) { clear(body).appendChild(h("p.lb-empty", "No scores yet. Go crack some eggs!")); return; }
      const col = { score: "sc", kills: "ki", wins: "wi", kd: "kd", streak: "bs", captures: "ca" }[by] || "sc";
      const tbl = h("table.lb-table",
        h("thead", h("tr", ["#", "Name", "Score", "Kills", "Deaths", "K/D", "Wins", "Best streak"].map((t) => h("th", { scope: "col" }, t)))),
        h("tbody", top.map((e, i) => {
          const kd = (e.ki || 0) / Math.max(1, e.de || 0);
          const cells = [
            ["", i + 1], ["name", e.n], ["sc", e.sc || 0], ["ki", e.ki || 0], ["de", e.de || 0], ["kd", kd.toFixed(2)], ["wi", e.wi || 0], ["bs", e.bs || 0],
          ];
          return h("tr", cells.map(([k, v], ci) => (ci === 1 ? h("th", { scope: "row" }, String(v)) : h("td", { class: k === col ? "hl" : null }, String(v)))));
        })));
      clear(body).appendChild(tbl);
    } catch {
      if (my !== seq) return;
      meta.textContent = "";
      clear(body).appendChild(h("p.lb-empty", "The leaderboard is not available right now."));
    }
  }
  tabs.forEach((t) => t.addEventListener("click", () => { sfx.play("ui_click"); by = t.dataset.by; load(); }));
  return dialog($("#dlg-leaderboard"), { onOpen: load });
}

export function initAbout() {
  return dialog($("#dlg-about"));
}
