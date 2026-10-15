// Server tick estimation (PROTOCOL.md section 3).
// estK = k + (now - recvTime)/dtMs, kept as a smoothed offset between the local
// clock and server ticks that is nudged by at most 10 % of the error per snapshot
// and never goes backwards. renderTick = estK - interpDelayMs/dtMs.

export class TickClock {
  constructor(tickRate = 60, interpDelayMs = 100) {
    this.dtMs = 1000 / tickRate;
    this.interpTicks = interpDelayMs / this.dtMs;
    this.offset = null; // serverTick - now/dtMs
    this.last = -Infinity;
    this.lastErr = 0;
  }

  /** Feed a snapshot (or welcome / pong) tick k received at local time `now` (ms). */
  sample(k, now) {
    const s = k - now / this.dtMs;
    if (this.offset === null) { this.offset = s; return; }
    const err = s - this.offset;
    this.lastErr = err;
    // A huge error (tab was frozen, server hiccup, first match after reconnect): resync.
    if (Math.abs(err) > 60) { this.offset = s; this.last = -Infinity; return; }
    this.offset += err * 0.1;
  }

  get synced() { return this.offset !== null; }

  /** Estimated current server tick (fractional, monotonic). */
  est(now) {
    if (this.offset === null) return 0;
    const v = now / this.dtMs + this.offset;
    if (v < this.last) return this.last;
    this.last = v;
    return v;
  }

  /** Tick at which remote players are rendered. */
  renderTick(now) {
    return this.est(now) - this.interpTicks;
  }

  reset() { this.offset = null; this.last = -Infinity; }
}
