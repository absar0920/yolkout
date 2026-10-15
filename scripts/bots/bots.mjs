// Headless protocol bots for load and protocol testing (no deps; Node 22 global WebSocket).
// Usage: node scripts/bots/bots.mjs --url ws://localhost:8080/ws --n 8 --mode ffa [--room CODE] [--secs 60] [--quiet]
// Each bot follows shared/PROTOCOL.md: hello, then 60 Hz inputs batched 2 per message, a ping every 2 s,
// and wanders/strafes/jumps/shoots at random. It prints a summary per bot at the end.

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "1"]);
  return acc;
}, []));
const URL_ = args.url || "ws://localhost:8080/ws";
const N = +(args.n || 4), MODE = args.mode || "ffa", ROOM = args.room || "", SECS = +(args.secs || 30), QUIET = !!args.quiet;
const CLASSES = ["benedict", "deviler", "poacher", "piercer", "frittata", "overeasy", "souffle"];
const q = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

function runBot(n) {
  return new Promise((resolve) => {
    const st = { n, id: 0, room: "", snaps: 0, msgs: 0, kills: 0, deaths: 0, rtt: 0, errors: [], seq: 0, k: 0, kAt: 0 };
    const ws = new WebSocket(URL_);
    let yaw = Math.random() * 6.28 - 3.14, keys = 1, buttons = 0, timer, pinger, pending = [];
    const send = (o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
    ws.onopen = () => send({ t: "hello", v: 1, name: `Bot${n}`, cls: CLASSES[n % CLASSES.length],
      cos: { hat: "none", color: "classic", stamp: "none" }, mode: MODE, map: "", room: ROOM, create: 0 });
    const handle = (m) => {
      st.msgs++;
      switch (m.t) {
        case "welcome":
          st.id = m.id; st.room = m.room.code; st.k = m.k; st.kAt = Date.now();
          if (!QUIET) console.log(`bot${n}: welcome id=${m.id} room=${m.room.code} mode=${m.room.mode} map=${m.room.map} players=${m.players.length}`);
          timer = setInterval(tick, 1000 / 60);
          pinger = setInterval(() => send({ t: "ping", c: Date.now(), rtt: st.rtt }), 2000);
          break;
        case "s": st.snaps++; st.k = m.k; st.kAt = Date.now(); break;
        case "pong": st.rtt = Date.now() - m.c; break;
        case "kill": if (m.k === st.id && m.v !== st.id) st.kills++; if (m.v === st.id) st.deaths++; break;
        case "err": st.errors.push(m.code); break;
      }
    };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { st.errors.push("badjson"); return; }
      if (Array.isArray(m)) m.forEach(handle); else handle(m);
    };
    function tick() {
      st.seq++;
      if (Math.random() < 0.02) yaw = q(yaw + (Math.random() - 0.5) * 2, 4);
      if (yaw > Math.PI) yaw -= 2 * Math.PI; if (yaw <= -Math.PI) yaw += 2 * Math.PI;
      if (Math.random() < 0.03) keys = [1, 1 | 4, 1 | 8, 2, 4, 8, 1 | 16][Math.floor(Math.random() * 7)];
      buttons = Math.random() < 0.3 ? 1 : 0;
      if (Math.random() < 0.005) buttons |= 8;
      if (Math.random() < 0.005) buttons |= 4;
      const rt = q(st.k + (Date.now() - st.kAt) / (1000 / 60) - 6, 2);
      pending.push([st.seq, keys, q(yaw, 4), 0, buttons, 0, rt]);
      if (pending.length >= 2) { send({ t: "i", b: pending }); pending = []; }
    }
    const finish = () => { clearInterval(timer); clearInterval(pinger); resolve(st); };
    ws.onclose = finish;
    ws.onerror = () => { st.errors.push("socket"); };
    setTimeout(() => { try { ws.close(); } catch {} finish(); }, SECS * 1000);
  });
}

const results = await Promise.all(Array.from({ length: N }, (_, i) => new Promise((r) => setTimeout(() => runBot(i + 1).then(r), i * 100))));
let ok = true;
for (const s of results) {
  const rate = s.snaps / SECS;
  if (!s.id || s.errors.length) ok = false;
  console.log(`bot${s.n}: id=${s.id} room=${s.room} snaps=${s.snaps} (${rate.toFixed(1)}/s) msgs=${s.msgs} rtt=${s.rtt}ms kills=${s.kills} deaths=${s.deaths} errors=${s.errors.join(",") || "-"}`);
}
process.exit(ok ? 0 : 1);
