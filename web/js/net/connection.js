// WebSocket transport for the Yolkout protocol (PROTOCOL.md sections 2, 4, 5, 6).
// - client frames: exactly one JSON object each
// - server frames: one object OR an array of objects (per-tick batch); both accepted
// - ping every 2 s, RTT measured from pong.c
// The transport can be a real WebSocket or any object with the same surface
// (send, close, readyState, onopen, onmessage, onclose, onerror), e.g. the
// offline LocalServer socket in ./localserver.js.

export const PROTOCOL_VERSION = 1;

/** Default endpoint: same origin as the page. */
export function defaultWsUrl() {
  if (typeof location === "undefined") return "ws://localhost:8080/ws";
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
}

export class Connection {
  /**
   * @param {object} o
   * @param {string} [o.url] ws url (defaults to same origin /ws)
   * @param {() => object} [o.socketFactory] returns a WebSocket-like object (offline mode)
   */
  constructor(o = {}) {
    this.url = o.url || defaultWsUrl();
    this.socketFactory = o.socketFactory || null;
    this.ws = null;
    this.handlers = new Map();
    this.onAny = null;      // (msg) => void, called for every message after typed handlers
    this.onClose = null;    // (reason {code,msg}) => void
    this.rtt = 0;
    this.bytesIn = 0;
    this.bytesOut = 0;
    this.msgsIn = 0;
    this.closed = false;
    this._pingTimer = 0;
    this._lastErr = null;
  }

  on(type, fn) { this.handlers.set(type, fn); return this; }

  /** Open the socket, send hello, resolve with the welcome message (rejects on err / close). */
  connect(hello) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (reason) => {
        if (settled) return;
        settled = true;
        reject(Object.assign(new Error(reason.msg || reason.code || "connection failed"), { code: reason.code || "socket" }));
      };
      let ws;
      try {
        ws = this.socketFactory ? this.socketFactory() : new WebSocket(this.url);
      } catch (e) {
        fail({ code: "socket", msg: String(e && e.message || e) });
        return;
      }
      this.ws = ws;
      const timeout = setTimeout(() => fail({ code: "timeout", msg: "Server did not answer" }), 12000);
      ws.onopen = () => {
        this.send(Object.assign({ t: "hello", v: PROTOCOL_VERSION }, hello));
      };
      ws.onmessage = (ev) => {
        const data = ev.data;
        if (typeof data !== "string") return; // text frames only
        this.bytesIn += data.length;
        let m;
        try { m = JSON.parse(data); } catch { return; }
        const list = Array.isArray(m) ? m : [m];
        for (const msg of list) {
          if (!msg || typeof msg.t !== "string") continue;
          this.msgsIn++;
          if (!settled) {
            if (msg.t === "welcome") {
              settled = true;
              clearTimeout(timeout);
              this._startPing();
              resolve(msg);
              continue;
            }
            if (msg.t === "err") {
              clearTimeout(timeout);
              this._lastErr = msg;
              fail(msg);
              continue;
            }
          }
          this._dispatch(msg);
        }
      };
      ws.onerror = () => { /* onclose follows */ };
      ws.onclose = (ev) => {
        clearTimeout(timeout);
        this._stopPing();
        const reason = this._lastErr
          ? { code: this._lastErr.code, msg: this._lastErr.msg || this._lastErr.code }
          : this.closed ? { code: "closed", msg: "Left the game" }
          : ev && ev.code === 1001 ? { code: "restart", msg: "The server is restarting" } // graceful shutdown (going away)
          : { code: "socket", msg: `Connection lost${ev && ev.code ? ` (${ev.code})` : ""}` };
        if (!settled) fail(reason);
        const wasClosed = this.closed;
        this.closed = true;
        if (settled && this.onClose && !wasClosed) this.onClose(reason);
      };
    });
  }

  _dispatch(msg) {
    if (msg.t === "pong") {
      const now = Math.floor(performance.now());
      if (typeof msg.c === "number") this.rtt = Math.max(0, now - msg.c);
    }
    if (msg.t === "err") this._lastErr = msg;
    const h = this.handlers.get(msg.t);
    if (h) {
      try { h(msg); } catch (e) { console.error(`handler ${msg.t}`, e); }
    }
    if (this.onAny) {
      try { this.onAny(msg); } catch (e) { console.error("onAny", e); }
    }
  }

  _startPing() {
    this._stopPing();
    const ping = () => this.send({ t: "ping", c: Math.floor(performance.now()), rtt: Math.round(this.rtt) });
    ping();
    this._pingTimer = setInterval(ping, 2000);
  }

  _stopPing() {
    if (this._pingTimer) clearInterval(this._pingTimer);
    this._pingTimer = 0;
  }

  get open() { return !!this.ws && this.ws.readyState === 1 && !this.closed; }

  send(obj) {
    if (!this.ws || this.ws.readyState !== 1) return false;
    const s = JSON.stringify(obj);
    if (s.length > 4096) return false; // server limit (maxMessageBytes)
    this.bytesOut += s.length;
    this.ws.send(s);
    return true;
  }

  sendInputs(entries) {
    // at most 8 per batch (maxInputsPerBatch)
    for (let i = 0; i < entries.length; i += 8) this.send({ t: "i", b: entries.slice(i, i + 8) });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this._stopPing();
    try { this.ws && this.ws.close(1000, "bye"); } catch { /* ignore */ }
  }
}
