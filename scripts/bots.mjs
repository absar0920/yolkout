// Protocol + load test for the Yolkout server (no dependencies: Node 22 global WebSocket).
//
//   node scripts/bots.mjs [--url ws://localhost:18400/ws] [--n 24] [--secs 30] [--pid <server pid>] [--json]
//
// Phase 1, protocol checks: version mismatch -> err version, oversized frame -> err too_big,
//   malformed JSON -> err bad_msg, unknown room code -> err no_room, ping/pong, ld -> pu broadcast,
//   melee loadout (hello.mel, ld.mel -> pu, the next spawn's mel, unknown mel -> default) and splash z 0.
// Phase 2, load: N clients (default 24) split across two rooms: half in a public quickplay FFA room,
//   half in a private Team Scramble room (one creates it, the rest join by code). Every client
//   sends 60 Hz inputs batched in pairs, aims at the nearest enemy from snapshots, strafes, jumps,
//   fires, reloads and throws grenades. Chat is sent and must reach the room.
// Asserts: welcome/spawn for everyone, snapshot rate ~30/s, the ack keeps advancing, kills and
//   respawns happen in both rooms, chat is delivered, the private room holds exactly its members,
//   every client stays connected, and /healthz is still OK at the end.
// Reports: per-client bandwidth (down/up), snapshot interval mean/p95/p99/max, server tick rate
//   measured from snapshot k, RTT, and server CPU/RSS when --pid is given.

import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "1"]);
  return acc;
}, []));
const URL_ = args.url || process.env.BOTS_URL || "ws://localhost:18400/ws";
const HTTP = URL_.replace(/^ws/, "http").replace(/\/ws$/, "");
const N = Math.max(2, +(args.n || 24));
const SECS = +(args.secs || 30);
const PID = args.pid ? +args.pid : 0;
const CODE_LEN = JSON.parse(readFileSync(new URL("../shared/data/rules.json", import.meta.url), "utf8")).rooms.codeLength;
const CLASSES = ["benedict", "deviler", "poacher", "piercer", "frittata", "overeasy", "souffle"];
const q = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a <= -Math.PI) a += 2 * Math.PI; return a; };

const results = [];
let failures = 0;
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
}

/** Open a socket and collect every message; resolves when open. */
function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL_);
    const c = { ws, msgs: [], closed: null, waiters: [] };
    ws.onopen = () => resolve(c);
    ws.onerror = () => reject(new Error("socket error"));
    ws.onclose = (e) => { c.closed = { code: e.code, reason: e.reason }; for (const w of c.waiters.splice(0)) w(); };
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      for (const x of Array.isArray(m) ? m : [m]) c.msgs.push(x);
      for (const w of c.waiters.splice(0)) w();
    };
  });
}
async function waitFor(c, pred, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) {
    const m = c.msgs.find(pred);
    if (m) return m;
    if (c.closed || Date.now() > end) return null;
    await new Promise((r) => { c.waiters.push(r); setTimeout(r, 50); });
  }
}
const hello = (o = {}) => JSON.stringify(Object.assign({ t: "hello", v: 1, name: "Probe", cls: "benedict", cos: { hat: "none", color: "classic", stamp: "none" }, mode: "ffa", map: "", room: "", create: 0 }, o));

async function protocolChecks() {
  let c = await connect();
  c.ws.send(hello({ v: 99 }));
  let e = await waitFor(c, (m) => m.t === "err");
  check("protocol: wrong version -> err version", e && e.code === "version", e && e.code);
  await waitFor(c, () => false, 500);
  check("protocol: socket closed after err", !!c.closed);

  c = await connect();
  c.ws.send(hello({ create: 1, mode: "ffa" }));
  const w = await waitFor(c, (m) => m.t === "welcome");
  check("protocol: create private room", w && w.room.priv === 1 && new RegExp(`^[A-Z2-9]{${CODE_LEN}}$`).test(w.room.code), w && w.room.code);
  check("protocol: welcome fields", w && w.tr === 60 && w.se === 2 && Array.isArray(w.players) && w.match && typeof w.pk === "string");
  const sp = await waitFor(c, (m) => m.t === "spawn" && w && m.id === w.id);
  check("protocol: spawn after welcome", !!sp);
  const s = await waitFor(c, (m) => m.t === "s" && m.me);
  check("protocol: snapshot with me/ws/cy", s && Array.isArray(s.me.ws) && s.me.ws.length === 15 && Number.isInteger(s.me.cy) && Array.isArray(s.p));
  c.ws.send(JSON.stringify({ t: "ping", c: 4242, rtt: 0 }));
  const pong = await waitFor(c, (m) => m.t === "pong" && m.c === 4242);
  check("protocol: ping -> pong", !!pong);
  c.ws.send(JSON.stringify({ t: "ld", cls: "deviler", cos: { hat: "cap", color: "mint", stamp: "star" } }));
  const pu = await waitFor(c, (m) => m.t === "pu" && m.p && m.p.cls === "deviler");
  check("protocol: ld -> pu roster update", !!pu, pu && JSON.stringify(pu.p.cos));
  // a second client joins by lowercase code and sees the first in the roster
  const c2 = await connect();
  c2.ws.send(hello({ name: "Probe Two", room: w.room.code.toLowerCase() }));
  const w2 = await waitFor(c2, (m) => m.t === "welcome");
  check("protocol: join by code (case-insensitive)", w2 && w2.room.code === w.room.code && w2.players.some((p) => p.id === w.id));
  const j = await waitFor(c, (m) => m.t === "join" && w2 && m.p.id === w2.id);
  check("protocol: join broadcast to the room", !!j);
  c2.ws.send(JSON.stringify({ t: "chat", m: "  hi <b>there</b>\u0007 ", tm: 0 }));
  const ch = await waitFor(c, (m) => m.t === "chat" && w2 && m.id === w2.id);
  check("protocol: chat delivered and sanitised", ch && ch.m === "hi <b>there</b>", ch && JSON.stringify(ch.m));
  c2.ws.close();
  const lv = await waitFor(c, (m) => m.t === "leave" && w2 && m.id === w2.id);
  check("protocol: leave broadcast", !!lv);
  // oversized frame
  c.ws.send(JSON.stringify({ t: "chat", m: "x".repeat(5000) }));
  e = await waitFor(c, (m) => m.t === "err");
  check("protocol: >4096 byte frame -> err too_big", e && e.code === "too_big", e && e.code);

  await meleeLoadoutChecks();

  c = await connect();
  c.ws.send(hello({ room: "QQQQQQ" }));
  e = await waitFor(c, (m) => m.t === "err");
  check("protocol: unknown room -> err no_room", e && e.code === "no_room", e && e.code);

  c = await connect();
  c.ws.send("{not json");
  e = await waitFor(c, (m) => m.t === "err");
  check("protocol: malformed JSON -> err bad_msg", e && (e.code === "bad_msg" || e.code === "bad_hello"), e && e.code);
}

/** Send 60 Hz inputs from c while step(i) returns [keys, yaw, pitch, buttons] (or null to stop). */
function driveInputs(c, step, maxMs) {
  return new Promise((resolve) => {
    let seq = 0, i = 0;
    const t0 = Date.now();
    const iv = setInterval(() => {
      const b = [];
      for (let n = 0; n < 2; n++) {
        const r = step(i++);
        if (!r || Date.now() - t0 > maxMs || c.closed) { clearInterval(iv); resolve(!!r && !c.closed); return; }
        const snap = c.msgs.findLast((m) => m.t === "s");
        b.push([++seq, r[0], r[1], r[2], r[3], 0, snap ? snap.k - 6 : 0]);
      }
      c.ws.send(JSON.stringify({ t: "i", b }));
    }, 33);
  });
}

/** Melee loadout over the wire: hello.mel, ld.mel -> pu, applied at the next spawn, unknown -> default. */
async function meleeLoadoutChecks() {
  const c = await connect();
  c.ws.send(hello({ name: "Pan Probe", create: 1, mode: "ffa", cls: "souffle", mel: "pan" }));
  const w = await waitFor(c, (m) => m.t === "welcome");
  const me = w && w.players.find((p) => p.id === w.id);
  check("melee: hello mel -> roster mel", me && me.mel === "pan", me && me.mel);
  const sp0 = await waitFor(c, (m) => m.t === "spawn" && w && m.id === w.id);
  check("melee: first spawn carries mel", sp0 && sp0.mel === "pan", sp0 && sp0.mel);
  c.ws.send(JSON.stringify({ t: "ld", mel: "whisk" }));
  const pu = await waitFor(c, (m) => m.t === "pu" && m.p && w && m.p.id === w.id && m.p.mel === "whisk");
  check("melee: ld {mel} alone -> pu with the new mel", !!pu, pu && pu.p.mel);
  // die to our own launcher shells (straight down: about 54 self damage each) to get a fresh spawn
  const dead = () => c.msgs.some((m) => m.t === "kill" && w && m.v === w.id);
  await driveInputs(c, (i) => (dead() ? null : [0, 0, -1.5, i % 8 < 2 ? 1 : 0]), 12000);
  const kill = c.msgs.find((m) => m.t === "kill" && w && m.v === w.id);
  check("melee: launcher self-kill (setup)", !!kill, kill && JSON.stringify(kill));
  const splash = c.msgs.filter((m) => m.t === "hit" && w && m.v === w.id);
  check("protocol: splash hits carry z 0 and no headshot", splash.length > 0 && splash.every((m) => m.z === 0 && m.hs === 0), JSON.stringify(splash.map((m) => [m.d, m.z])));
  check("protocol: kill carries z", kill && kill.z === 0, kill && String(kill.z));
  const sp1 = await waitFor(c, (m) => m.t === "spawn" && w && m.id === w.id && m !== sp0, 8000);
  check("melee: next spawn uses the ld mel", sp1 && sp1.mel === "whisk", sp1 && sp1.mel);
  // unknown melee ids fall back to the default
  const c2 = await connect();
  c2.ws.send(hello({ name: "Bogus Probe", room: w ? w.room.code : "", mel: "bogus" }));
  const w2 = await waitFor(c2, (m) => m.t === "welcome");
  const me2 = w2 && w2.players.find((p) => p.id === w2.id);
  check("melee: unknown hello mel -> rollingpin", me2 && me2.mel === "rollingpin", me2 && me2.mel);
  check("melee: every roster entry has a mel", w2 && w2.players.every((p) => typeof p.mel === "string" && p.mel));
  c2.ws.close();
  c.ws.close();
}

/** One load-test client. */
function bot(n, { room = "", create = 0, mode = "ffa" } = {}) {
  return new Promise((resolve) => {
    const st = { n, id: 0, room: "", priv: 0, snaps: 0, snapTimes: [], firstK: -1, firstKAt: 0, lastK: -1, lastKAt: 0, acks: [0, 0],
      bytesIn: 0, wireIn: 0, bytesOut: 0, framesIn: 0, kills: 0, deaths: 0, spawns: 0, respawns: 0, chatsIn: 0, chatFrom: new Set() /* texts */, rtts: [],
      errors: [], closed: null, players: new Map(), team: 0, startedAt: 0, endedAt: 0, shots: 0, hits: 0, badZones: 0, zoneHits: [0, 0, 0, 0, 0] };
    const ws = new WebSocket(URL_);
    let seq = 0, k = 0, kAt = 0, timer = 0, pinger = 0, pending = [], yaw = 0, pitch = 0, keys = 1, wasDead = false;
    let strafeT = 0, strafe = 4;
    const send = (o) => { if (ws.readyState === 1) { const s = JSON.stringify(o); st.bytesOut += s.length; ws.send(s); } };
    ws.onopen = () => {
      st.deflate = /permessage-deflate/.test(ws.extensions || "");
      const h = hello({ name: `LoadBot ${n}`, cls: CLASSES[n % CLASSES.length], mode, room, create, cos: { hat: ["none", "chef", "cap"][n % 3], color: "classic", stamp: "none" } });
      st.bytesOut += h.length;
      ws.send(h);
    };
    const handle = (m) => {
      switch (m.t) {
        case "welcome":
          st.id = m.id; st.room = m.room.code; st.priv = m.room.priv; k = m.k; kAt = Date.now(); st.startedAt = Date.now();
          for (const p of m.players) st.players.set(p.id, p);
          st.team = (m.players.find((p) => p.id === m.id) || {}).tm || 0;
          timer = setInterval(tick, 1000 / 60);
          pinger = setInterval(() => send({ t: "ping", c: Date.now(), rtt: st.rtts.at(-1) || 0 }), 2000);
          if (st.onWelcome) st.onWelcome(st);
          break;
        case "s": {
          const now = Date.now();
          st.snaps++;
          st.snapTimes.push(now);
          if (st.firstK < 0) { st.firstK = m.k; st.firstKAt = now; }
          st.lastK = m.k; st.lastKAt = now; k = m.k; kAt = now;
          st.acks[1] = m.a; if (!st.acks[0]) st.acks[0] = m.a;
          st.snap = m;
          if (m.me) { if (m.me.al === 0) wasDead = true; }
          break;
        }
        case "join": st.players.set(m.p.id, m.p); break;
        case "pu": st.players.set(m.p.id, m.p); if (m.p.id === st.id) st.team = m.p.tm; break;
        case "leave": st.players.delete(m.id); break;
        case "spawn":
          if (m.id === st.id) { st.spawns++; if (wasDead) { st.respawns++; wasDead = false; } if (m.tm) st.team = m.tm; }
          break;
        case "kill":
          if (m.k === st.id && m.v !== st.id) st.kills++;
          if (m.v === st.id) { st.deaths++; wasDead = true; }
          break;
        case "hit":
          if (m.a === st.id) st.hits++;
          if (!(Number.isInteger(m.z) && m.z >= 0 && m.z <= 4) || (m.hs === 1) !== (m.z === 1)) st.badZones++;
          if (m.a === st.id && m.z >= 1) st.zoneHits[m.z]++;
          break;
        case "chat": st.chatsIn++; st.chatFrom.add(m.m); break;
        case "pong": st.rtts.push(Date.now() - m.c); break;
        case "err": st.errors.push(m.code); break;
      }
    };
    ws.onmessage = (ev) => {
      st.bytesIn += ev.data.length; st.framesIn++;
      // wire estimate: the server deflates frames >= 256 bytes (permessage-deflate, no context
      // takeover, BestSpeed) when the client negotiated it, which browsers and Node 22 do.
      // Sampled (1 frame in 8) so the estimate does not load the test's own event loop.
      const len = ev.data.length;
      if (len >= 256 && st.deflate) {
        if (st.framesIn % 8 === 1) st.ratio = (deflateRawSync(ev.data, { level: 1 }).length - 4) / len;
        st.wireIn += Math.round(len * (st.ratio || 0.5)) + 4;
      } else st.wireIn += len + (len < 126 ? 2 : 4);
      let m; try { m = JSON.parse(ev.data); } catch { st.errors.push("badjson"); return; }
      if (Array.isArray(m)) m.forEach(handle); else handle(m);
    };
    function aim() {
      const s = st.snap;
      if (!s || !s.me) return;
      const me = s.me;
      let best = null, bd = 1e9;
      for (const p of s.p) {
        if (p[0] === st.id || !(p[8] & 1)) continue;
        const r = st.players.get(p[0]);
        if (st.team && r && r.tm === st.team) continue;
        const d = Math.hypot(p[1] - me.x, p[3] - me.z);
        if (d < bd) { bd = d; best = p; }
      }
      if (!best) return null;
      const dx = best[1] - me.x, dy = best[2] + 0.8 - (me.y + 1.3), dz = best[3] - me.z;
      yaw = wrap(Math.atan2(-dx, -dz) + (Math.random() - 0.5) * 0.08);
      pitch = Math.max(-1.5, Math.min(1.5, Math.atan2(dy, Math.hypot(dx, dz)) + (Math.random() - 0.5) * 0.04));
      return bd;
    }
    function tick() {
      seq++;
      const d = aim();
      if (--strafeT <= 0) { strafeT = 20 + Math.floor(Math.random() * 40); strafe = [1, 1 | 4, 1 | 8, 4, 8, 2 | 4, 2 | 8][Math.floor(Math.random() * 7)]; }
      keys = strafe | (Math.random() < 0.02 ? 16 : 0);
      if (d != null && d < 6) keys &= ~1;
      let buttons = 0;
      if (d != null && d < 60) { buttons |= 1; st.shots++; }
      if (Math.random() < 0.004) buttons |= 8; // grenade
      if (Math.random() < 0.003) buttons |= 4; // reload
      if (d != null && d < 2 && Math.random() < 0.2) buttons |= 16; // melee
      const rt = q(k + (Date.now() - kAt) / (1000 / 60) - 6, 2);
      pending.push([seq, keys, q(yaw, 4), q(pitch, 4), buttons, 0, rt]);
      if (pending.length >= 2) { send({ t: "i", b: pending }); pending = []; }
    }
    st.chat = (text) => send({ t: "chat", m: text, tm: 0 });
    st.stop = () => { clearInterval(timer); clearInterval(pinger); st.endedAt = Date.now(); try { ws.close(); } catch { /* ignore */ } };
    ws.onclose = (e) => { st.closed = st.closed || { code: e.code, at: Date.now() }; clearInterval(timer); clearInterval(pinger); };
    ws.onerror = () => st.errors.push("socket");
    resolve(st);
  });
}

function procStat(pid) {
  try {
    const f = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1].split(" ");
    const ticks = +f[11] + +f[12]; // utime + stime (fields 14,15)
    const rss = +readFileSync(`/proc/${pid}/statm`, "utf8").split(" ")[1] * 4096;
    return { ticks, rss };
  } catch { return null; }
}

const pct = (arr, p) => { if (!arr.length) return 0; const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };

async function load() {
  const half = Math.ceil(N / 2);
  console.log(`\nload: ${N} clients (${half} public FFA quickplay + ${N - half} private Team Scramble) for ${SECS}s`);
  const before = PID ? procStat(PID) : null;
  const t0 = Date.now();
  const bots = [];
  for (let i = 0; i < half; i++) { bots.push(await bot(i + 1, { mode: "ffa" })); await sleep(40); }
  const host = await bot(half + 1, { create: 1, mode: "teams" });
  bots.push(host);
  const code = await new Promise((r) => { if (host.room) r(host.room); else host.onWelcome = (s) => r(s.room); setTimeout(() => r(host.room), 5000); });
  check("load: private room created", !!code, code);
  for (let i = half + 1; i < N; i++) { bots.push(await bot(i + 1, { room: code })); await sleep(40); }
  await sleep(1500);
  const publicRooms = new Set(bots.slice(0, half).map((b) => b.room));
  check("load: all clients welcomed", bots.every((b) => b.id > 0), `${bots.filter((b) => b.id).length}/${N}`);
  check("load: public clients share one quickplay room", publicRooms.size === 1 && !publicRooms.has(code), [...publicRooms].join(","));
  check("load: private clients all in the private room", bots.slice(half).every((b) => b.room === code && b.priv === 1));
  const api = await (await fetch(HTTP + "/api/rooms")).json();
  check("load: private room hidden from /api/rooms", !api.rooms.some((r) => r.code === code), JSON.stringify(api.rooms));
  const pub = api.rooms.find((r) => publicRooms.has(r.code));
  check("load: public room listed with all its humans (server bots make room)", pub && (pub.humans ?? pub.n) === half && pub.n >= half && pub.n <= 12, pub && `n=${pub.n} humans=${pub.humans}`);

  // chat round: one bot in each room speaks
  await sleep(1000);
  bots[0].chat("gg from the public room");
  host.chat("hello private room");
  const runEnd = t0 + SECS * 1000;
  while (Date.now() < runEnd) {
    await sleep(1000);
    if (bots.some((b) => b.closed)) break;
  }
  const after = PID ? procStat(PID) : null;
  const wall = (Date.now() - t0) / 1000;
  for (const b of bots) b.stop();
  await sleep(300);

  // ---- assertions
  const live = bots.filter((b) => b.snapTimes.length > 10);
  const rates = live.map((b) => (b.snaps - 1) / ((b.lastKAt - b.snapTimes[0]) / 1000));
  const minRate = Math.min(...rates), maxRate = Math.max(...rates);
  check("load: snapshot rate 30/s for every client", rates.length === N && minRate > 28.5 && maxRate < 31.5, `min ${minRate.toFixed(2)} max ${maxRate.toFixed(2)}`);
  const tickRates = live.map((b) => (b.lastK - b.firstK) / ((b.lastKAt - b.firstKAt) / 1000));
  const meanTick = tickRates.reduce((a, b) => a + b, 0) / tickRates.length;
  check("load: server ticks at 60 Hz", meanTick > 59 && meanTick < 61, `${meanTick.toFixed(2)} ticks/s`);
  check("load: acks advance (inputs applied)", bots.every((b) => b.acks[1] > b.acks[0] + 60 * (SECS - 5) * 0.9), `min ack gain ${Math.min(...bots.map((b) => b.acks[1] - b.acks[0]))}`);
  const pubKills = bots.slice(0, half).reduce((a, b) => a + b.kills, 0), privKills = bots.slice(half).reduce((a, b) => a + b.kills, 0);
  check("load: kills happen in the public room", pubKills > 0, `${pubKills} kills`);
  check("load: kills happen in the private room", privKills > 0, `${privKills} kills`);
  const respawns = bots.reduce((a, b) => a + b.respawns, 0), deaths = bots.reduce((a, b) => a + b.deaths, 0);
  check("load: dead players respawn", respawns > 0 && respawns >= deaths - N, `${deaths} deaths, ${respawns} respawns`);
  check("load: hits confirmed to attackers", bots.reduce((a, b) => a + b.hits, 0) > 0, `${bots.reduce((a, b) => a + b.hits, 0)} hits`);
  const zh = [1, 2, 3, 4].map((z) => bots.reduce((a, b) => a + b.zoneHits[z], 0));
  check("load: hit events carry a valid zone (hs == z is head)", bots.every((b) => b.badZones === 0) && zh[1] > 0, `head/body/arm/leg ${zh.join("/")}`);
  // player ids are per room (both rooms have an id 1), so match chat by text
  const PUB = "gg from the public room", PRIV = "hello private room";
  check("load: public chat reached the public room only", bots.slice(0, half).every((b) => b.chatFrom.has(PUB)) && !bots.slice(half).some((b) => b.chatFrom.has(PUB)));
  check("load: private chat stayed in the private room", bots.slice(half).every((b) => b.chatFrom.has(PRIV)) && !bots.slice(0, half).some((b) => b.chatFrom.has(PRIV)));
  const errs = bots.flatMap((b) => b.errors);
  check("load: no err messages", errs.length === 0, errs.slice(0, 5).join(","));
  const early = bots.filter((b) => b.closed && b.closed.at < b.endedAt - 100);
  check("load: nobody disconnected early", early.length === 0, early.map((b) => b.n).join(","));
  let healthy = false;
  try { healthy = (await (await fetch(HTTP + "/healthz")).text()) === "ok"; } catch { /* ignore */ }
  check("load: server alive after the run (/healthz)", healthy);

  // ---- report
  const intervals = [];
  for (const b of live) for (let i = 1; i < b.snapTimes.length; i++) intervals.push(b.snapTimes[i] - b.snapTimes[i - 1]);
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const down = bots.map((b) => b.bytesIn / ((b.lastKAt - b.startedAt) / 1000) / 1024);
  const wire = bots.map((b) => b.wireIn / ((b.lastKAt - b.startedAt) / 1000) / 1024);
  const up = bots.map((b) => b.bytesOut / ((b.endedAt - b.startedAt) / 1000) / 1024);
  const rtts = bots.flatMap((b) => b.rtts);
  const avg = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const report = {
    clients: N, seconds: +wall.toFixed(1),
    bandwidthPerClientKBps: { downPayloadMean: +avg(down).toFixed(2), downPayloadMax: +Math.max(...down).toFixed(2),
      downWireMean: +avg(wire).toFixed(2), deflate: bots.every((b) => b.deflate), upPayloadMean: +avg(up).toFixed(2) },
    framesPerClientPerSec: +avg(bots.map((b) => b.framesIn / ((b.lastKAt - b.startedAt) / 1000))).toFixed(1),
    snapshotIntervalMs: { mean: +mean.toFixed(2), p50: pct(intervals, 0.5), p95: pct(intervals, 0.95), p99: pct(intervals, 0.99), max: Math.max(...intervals) },
    serverTicksPerSec: +meanTick.toFixed(2),
    rttMs: { mean: +avg(rtts).toFixed(1), p99: pct(rtts, 0.99) },
    kills: pubKills + privKills, deaths, respawns,
  };
  if (before && after) {
    const hz = 100; // USER_HZ on Linux
    report.serverCpuPercent = +(((after.ticks - before.ticks) / hz) / wall * 100).toFixed(1);
    report.serverRssMB = +(after.rss / 1048576).toFixed(1);
  }
  console.log("\nreport " + JSON.stringify(report, null, 2));
  return report;
}

console.log(`bots against ${URL_}`);
try {
  await protocolChecks();
  await load();
} catch (e) {
  check("run finished without exceptions", false, e.stack || String(e));
}
console.log(`\n${results.length - failures}/${results.length} checks passed`);
process.exit(failures ? 1 : 0);
