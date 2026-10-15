package game

import (
	"net"
	"net/http"
	"strings"
	"time"
)

// Per-IP abuse limits (all guarded by Manager.mu):
//   - live WebSocket connections per IP (Config.MaxConnsPerIP)
//   - private room creation: 3 per minute per IP
//   - failed join-by-code lookups: 10 per minute per IP, then code joins are
//     refused with "rate" until the bucket refills (stops code guessing)
// Loopback clients are exempt unless Config.LimitLoopback is set, so local
// tools and a reverse proxy on the same host (without -trustproxy) keep working.

const (
	createRate, createBurst = 3.0 / 60, 3
	missRate, missBurst     = 10.0 / 60, 10
	ipPruneAt               = 4096
	seqGapRate, seqGapBurst = 0.25, 32 // skipped input seqs per second / banked
)

type ipState struct {
	conns   int
	creates bucket
	misses  bucket
	seen    time.Time
}

// avail refills the bucket to now and returns the tokens available.
func (b *bucket) avail(now time.Time) float64 {
	if !b.last.IsZero() {
		b.tokens = min(b.burst, b.tokens+now.Sub(b.last).Seconds()*b.rate)
	}
	b.last = now
	return b.tokens
}

// clientIP returns the address per-IP limits are keyed on ("" = unlimited).
func (m *Manager) clientIP(r *http.Request) string {
	host := r.RemoteAddr
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	if m.Cfg.TrustProxy {
		// the rightmost entry is the one our own proxy appended
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			parts := strings.Split(xff, ",")
			if ip := strings.TrimSpace(parts[len(parts)-1]); ip != "" {
				return ip
			}
		}
	}
	if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() && !m.Cfg.LimitLoopback {
		return ""
	}
	return host
}

// ipLocked returns the state for ip, creating it. Caller holds m.mu.
func (m *Manager) ipLocked(ip string, now time.Time) *ipState {
	s := m.ips[ip]
	if s == nil {
		if len(m.ips) >= ipPruneAt {
			for k, v := range m.ips {
				if v.conns == 0 && now.Sub(v.seen) > 10*time.Minute {
					delete(m.ips, k)
				}
			}
		}
		s = &ipState{creates: newBucket(createRate, createBurst), misses: newBucket(missRate, missBurst)}
		m.ips[ip] = s
	}
	s.seen = now
	return s
}

// acquireIP reserves a connection slot for ip; false when it is over the cap.
func (m *Manager) acquireIP(ip string) bool {
	if ip == "" || m.Cfg.MaxConnsPerIP < 0 {
		return true
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	s := m.ipLocked(ip, time.Now())
	if s.conns >= m.Cfg.MaxConnsPerIP {
		return false
	}
	s.conns++
	return true
}

func (m *Manager) releaseIP(ip string) {
	if ip == "" || m.Cfg.MaxConnsPerIP < 0 {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if s := m.ips[ip]; s != nil && s.conns > 0 {
		s.conns--
	}
}
