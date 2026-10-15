package game

import (
	"compress/flate"
	"log"
	"math/rand/v2"
	"net/http"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"

	"yolkout/server/internal/data"
	"yolkout/server/internal/sim"
	"yolkout/server/internal/stats"
)

// Config is the server-wide configuration.
type Config struct {
	MaxRooms        int
	MaxPrivateRooms int // cap on private rooms so public matchmaking always has room (default MaxRooms/2)
	MaxConns        int
	MaxConnsPerIP   int  // live sockets per client IP (default 8, < 0 = unlimited)
	TrustProxy      bool // key per-IP limits on the last X-Forwarded-For entry
	LimitLoopback   bool // apply per-IP limits to loopback clients too (tests)
	BotFill         int  // fill rooms with bots up to this many players (0 = no bots)
	AnyOrigin       bool
	EmptyGrace      time.Duration // private room lifetime when empty (default 60s)
	UnusedGrace     time.Duration // lifetime of a private room no human ever entered (default 5s)
}

// Manager owns the rooms and matchmaking.
type Manager struct {
	G     *data.Game
	C     *sim.Consts
	Cfg   Config
	Stats *stats.Store

	mu       sync.Mutex
	rooms    map[string]*Room
	ips      map[string]*ipState // per-IP limits (limits.go)
	seq      int64
	shutdown bool
	wg       sync.WaitGroup // room goroutines
	writers  sync.WaitGroup // client write pumps (so shutdown can flush the final notice + close frame)

	conns    atomic.Int64
	nav      navCache // per-map bot nav graphs
	upgrader websocket.Upgrader
}

// NewManager creates a manager.
func NewManager(g *data.Game, cfg Config, st *stats.Store) *Manager {
	if cfg.MaxRooms <= 0 {
		cfg.MaxRooms = 200
	}
	if cfg.MaxPrivateRooms <= 0 {
		cfg.MaxPrivateRooms = max(1, cfg.MaxRooms/2)
	}
	if cfg.MaxConns <= 0 {
		cfg.MaxConns = 4000
	}
	if cfg.MaxConnsPerIP == 0 {
		cfg.MaxConnsPerIP = 8
	}
	if cfg.UnusedGrace <= 0 {
		cfg.UnusedGrace = 5 * time.Second
	}
	if cfg.EmptyGrace <= 0 {
		cfg.EmptyGrace = 60 * time.Second
	}
	m := &Manager{G: g, C: sim.MakeConsts(g.Rules), Cfg: cfg, Stats: st, rooms: map[string]*Room{}, ips: map[string]*ipState{}}
	// permessage-deflate (no context takeover) roughly halves snapshot bandwidth; small
	// frames are sent uncompressed (see writePump).
	m.upgrader = websocket.Upgrader{ReadBufferSize: 4096, WriteBufferSize: 8192, EnableCompression: true}
	if cfg.AnyOrigin {
		m.upgrader.CheckOrigin = func(*http.Request) bool { return true }
	}
	return m
}

// ServeHTTP lets the manager be mounted directly (tests).
func (m *Manager) ServeHTTP(w http.ResponseWriter, r *http.Request) { m.ServeWS(w, r) }

// ServeWS upgrades /ws requests.
func (m *Manager) ServeWS(w http.ResponseWriter, r *http.Request) {
	ip := m.clientIP(r)
	if !m.acquireIP(ip) {
		http.Error(w, "too many connections", http.StatusTooManyRequests)
		return
	}
	defer m.releaseIP(ip)
	if m.conns.Add(1) > int64(m.Cfg.MaxConns) {
		m.conns.Add(-1)
		http.Error(w, "server full", http.StatusServiceUnavailable)
		return
	}
	conn, err := m.upgrader.Upgrade(w, r, nil)
	if err != nil {
		m.conns.Add(-1)
		return
	}
	_ = conn.SetCompressionLevel(flate.BestSpeed)
	c := newClient(conn, m)
	c.ip = ip
	m.mu.Lock()
	down := m.shutdown
	m.mu.Unlock()
	if down {
		m.goWriter(c)
		c.fail("unavailable")
		m.conns.Add(-1)
		return
	}
	c.serve()
}

func (m *Manager) newCode() string {
	al := m.G.Rules.Rooms.CodeAlphabet
	n := m.G.Rules.Rooms.CodeLength
	for {
		b := make([]byte, n)
		for i := range b {
			b[i] = al[rand.IntN(len(al))]
		}
		if m.rooms[string(b)] == nil {
			return string(b)
		}
	}
}

func (m *Manager) modeFor(id string) *data.Mode {
	if md := m.G.Modes.Modes[id]; md != nil {
		return md
	}
	return m.G.Modes.Modes[m.G.Modes.DefaultMode]
}

func (m *Manager) mapFor(md *data.Mode, id string) string {
	for _, x := range md.Maps {
		if x == id {
			return id
		}
	}
	return md.Maps[rand.IntN(len(md.Maps))]
}

// createRoomLocked makes and starts a room. Caller holds m.mu.
func (m *Manager) createRoomLocked(md *data.Mode, mapID string, priv bool) *Room {
	if len(m.rooms) >= m.Cfg.MaxRooms {
		return nil
	}
	if priv {
		n := 0
		for _, x := range m.rooms {
			if x.Priv {
				n++
			}
		}
		if n >= m.Cfg.MaxPrivateRooms {
			return nil
		}
	}
	m.seq++
	r := newRoom(m, m.newCode(), md, mapID, priv, m.seq)
	m.rooms[r.Code] = r
	m.wg.Add(1)
	go func() {
		defer m.wg.Done()
		r.run()
	}()
	log.Printf("room %s created (mode=%s map=%s priv=%v, %d rooms)", r.Code, md.ID, mapID, priv, len(m.rooms))
	return r
}

// CreateRoom creates a room (used by tests and tools).
func (m *Manager) CreateRoom(mode, mapID string, priv bool) *Room {
	m.mu.Lock()
	defer m.mu.Unlock()
	md := m.modeFor(mode)
	return m.createRoomLocked(md, m.mapFor(md, mapID), priv)
}

// join performs matchmaking for a hello and queues the join on the room.
// Returns an err code or "".
func (m *Manager) join(c *Client, h *inMsg) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.shutdown {
		return "unavailable"
	}
	maxP := m.G.Rules.Net.MaxPlayersPerRoom
	md := m.modeFor(h.Mode)
	now := time.Now()
	var r *Room
	switch {
	case truthy(h.Create):
		if c.ip != "" && m.ipLocked(c.ip, now).creates.avail(now) < 1 {
			return "too_many"
		}
		r = m.createRoomLocked(md, m.mapFor(md, h.Map), true)
		if r == nil {
			return "server_full"
		}
		if c.ip != "" {
			m.ipLocked(c.ip, now).creates.take(now)
		}
	case strings.TrimSpace(h.Room) != "":
		var ips *ipState
		if c.ip != "" {
			if ips = m.ipLocked(c.ip, now); ips.misses.avail(now) < 1 {
				return "too_many" // too many wrong codes: cool down before guessing again
			}
		}
		r = m.rooms[strings.ToUpper(strings.TrimSpace(h.Room))]
		if r == nil || r.dead.Load() {
			if ips != nil {
				ips.misses.take(now)
			}
			return "no_room"
		}
		if r.reserved >= maxP {
			return "room_full"
		}
	default:
		for _, x := range m.rooms {
			if x.Priv || x.Mode.ID != md.ID || x.reserved >= maxP || x.dead.Load() {
				continue
			}
			if r == nil || x.reserved > r.reserved || (x.reserved == r.reserved && x.created < r.created) {
				r = x
			}
		}
		if r == nil {
			r = m.createRoomLocked(md, m.mapFor(md, h.Map), false)
			if r == nil {
				return "server_full"
			}
		}
	}
	r.reserved++
	c.room.Store(r)
	r.enqueue(roomEvent{join: true, c: c, hello: helloFor(m.G, h)})
	return ""
}

// leave is called by the connection goroutine when the socket closes.
func (m *Manager) leave(c *Client, r *Room) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r.reserved--
	r.enqueue(roomEvent{c: c})
	if r.reserved <= 0 && !r.Priv && m.rooms[r.Code] == r {
		delete(m.rooms, r.Code)
		r.stopOnce.Do(func() { close(r.stop) })
		log.Printf("room %s closed (empty, %d rooms)", r.Code, len(m.rooms))
	}
}

// tryRemoveEmpty removes an empty room (private rooms after the grace period).
func (m *Manager) tryRemoveEmpty(r *Room) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if r.reserved > 0 {
		return false
	}
	if m.rooms[r.Code] == r {
		delete(m.rooms, r.Code)
		log.Printf("room %s closed (empty, %d rooms)", r.Code, len(m.rooms))
	}
	return true
}

// RoomInfo is one /api/rooms entry.
type RoomInfo struct {
	Code   string `json:"code"`
	Mode   string `json:"mode"`
	Map    string `json:"map"`
	N      int    `json:"n"`
	Humans int    `json:"humans"`
	Max    int    `json:"max"`
}

// PublicRooms lists public rooms (most players first).
func (m *Manager) PublicRooms() []RoomInfo {
	m.mu.Lock()
	out := make([]RoomInfo, 0, len(m.rooms))
	for _, r := range m.rooms {
		if r.Priv {
			continue
		}
		out = append(out, RoomInfo{Code: r.Code, Mode: r.Mode.ID, Map: *r.curMap.Load(), N: int(r.curN.Load()), Humans: r.reserved, Max: m.G.Rules.Net.MaxPlayersPerRoom})
	}
	m.mu.Unlock()
	sort.Slice(out, func(i, j int) bool {
		if out[i].N != out[j].N {
			return out[i].N > out[j].N
		}
		return out[i].Code < out[j].Code
	})
	return out
}

// Counts returns (rooms, connected players).
func (m *Manager) Counts() (int, int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := 0
	for _, r := range m.rooms {
		n += r.reserved
	}
	return len(m.rooms), n
}

// Shutdown stops all rooms (each tells its clients and closes them) and
// waits up to the deadline.
func (m *Manager) Shutdown(timeout time.Duration) {
	m.mu.Lock()
	m.shutdown = true
	for code, r := range m.rooms {
		r.stopOnce.Do(func() { close(r.stop) })
		delete(m.rooms, code)
	}
	m.mu.Unlock()
	deadline := time.After(timeout)
	done := make(chan struct{})
	go func() { m.wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-deadline:
		return
	}
	// Rooms queued "Server is restarting" + a 1001 close for every player; wait for the
	// writers to put them on the wire before the process exits.
	flushed := make(chan struct{})
	go func() { m.writers.Wait(); close(flushed) }()
	select {
	case <-flushed:
	case <-deadline:
	}
}

// goWriter starts c's write pump, tracked for graceful shutdown.
func (m *Manager) goWriter(c *Client) {
	m.writers.Add(1)
	go func() {
		defer m.writers.Done()
		c.writePump()
	}()
}

// hello is a validated hello.
type hello struct {
	name string
	cls  string
	cos  Cos
}

func helloFor(g *data.Game, h *inMsg) hello {
	cls := g.Weapons.DefaultPrimary
	if h.Cls != nil && g.IsPrimary(*h.Cls) {
		cls = *h.Cls
	}
	return hello{name: SanitizeName(h.Name), cls: cls, cos: applyCos(g, defaultCos(g), h.Cos)}
}

func defaultCos(g *data.Game) Cos {
	d := g.Cosmetics.Defaults
	return Cos{Hat: d.Hat, Color: d.Color, Stamp: d.Stamp}
}

// applyCos applies a cosmetic request on top of cur: unknown ids become the
// defaults, missing fields keep cur (for hello, cur is the defaults).
func applyCos(g *data.Game, cur Cos, in *cosIn) Cos {
	if in == nil {
		return cur
	}
	d := defaultCos(g)
	pick := func(v *string, set map[string]bool, cur, def string) string {
		switch {
		case v == nil:
			return cur
		case set[*v]:
			return *v
		}
		return def
	}
	return Cos{Hat: pick(in.Hat, g.Cosmetics.HatSet, cur.Hat, d.Hat), Color: pick(in.Color, g.Cosmetics.ColorSet, cur.Color, d.Color),
		Stamp: pick(in.Stamp, g.Cosmetics.StampSet, cur.Stamp, d.Stamp)}
}
