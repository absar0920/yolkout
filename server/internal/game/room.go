package game

import (
	"encoding/json"
	"log"
	"math"
	"math/rand/v2"
	"runtime/debug"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"yolkout/server/internal/data"
	"yolkout/server/internal/sim"
)

const (
	stateLive  = 0
	stateEnded = 1
)

// jitterBuffer is the input backlog (in ticks) the room keeps before it
// consumes more than one input per tick; it absorbs batched and jittery
// client sends so remote players move one step per tick.
const jitterBuffer = 3

// roomEvent is a join or leave queued by a connection goroutine.
type roomEvent struct {
	join  bool
	c     *Client
	hello hello
}

type histEntry struct {
	tick    int64
	x, y, z float64
	alive   bool
}

// Player is one egg in a room (human or bot).
type Player struct {
	ID     int
	Name   string
	Team   int
	Cls    string // primary for the next spawn
	CurCls string // primary of the current life
	Cos    Cos
	client *Client
	bot    *botBrain

	PS    sim.PlayerState
	WS    sim.WeaponState
	Defs  *sim.Defs
	Yaw   float64
	Pitch float64
	Slot  int
	Btns  int

	Alive          bool
	HP             float64
	SH             int
	RespawnAt      int64
	ProtUntil      int64 // spawn protection active while k < ProtUntil
	LastDamageTick int64
	FuryUntil      int64
	Carrying       int // team of the egg being carried (0 none)

	Score, Kills, Deaths, Streak int
	Headshots, BestStreak, Caps  int
	scoreBanked                  int

	Ack    uint32
	tokens int
	starve int
	fired  bool
	ping   int

	hist []histEntry
	out  [][]byte
}

func (p *Player) protected(k int64) bool { return p.Alive && k < p.ProtUntil }

func (p *Player) histAt(j int64) (histEntry, bool) {
	if j < 0 {
		return histEntry{}, false
	}
	e := p.hist[int(j%int64(len(p.hist)))]
	return e, e.tick == j
}

// proj is a live projectile plus the combat data it carries.
type proj struct {
	*sim.Projectile
	weapon    string
	damage    float64
	splash    float64
	knockback float64
	team      int
}

type pickupState struct {
	avail     bool
	respawnAt int64
}

type egg struct {
	state    int // 0 home, 1 carried, 2 dropped
	pos      [3]float64
	carrier  int
	dropTick int64
}

// Room is one match instance. All game state is owned by its goroutine.
type Room struct {
	mgr     *Manager
	g       *data.Game
	C       *sim.Consts
	Code    string
	Priv    bool
	Mode    *data.Mode
	created int64

	// guarded by mgr.mu
	reserved int

	mu       sync.Mutex
	events   []roomEvent
	stop     chan struct{}
	stopOnce sync.Once

	curK   atomic.Int64
	curN   atomic.Int64
	curMap atomic.Pointer[string]

	MapID string
	Map   *data.Map
	World *sim.World
	killY float64

	k        int64
	players  []*Player // ascending id
	nextPID  int
	nextPrID int
	projs    []*proj
	pickups  []pickupState
	eggs     [3]egg
	nests    [3][3]float64
	hasNests bool

	state    int
	endTick  int64
	interEnd int64
	nextMap  string
	ts       [3]int
	sbDirty  bool
	humans   int
	emptyAt  int64
	hadHuman bool        // a human was ever welcomed (unused private rooms expire fast)
	dead     atomic.Bool // the room goroutine crashed; matchmaking must skip it

	botWorld sim.World
	nav      *navGraph
	navS     navSearch
	acts     []sim.Action
	dirs     [][3]float64
	scratch  []byte
	rng      *rand.Rand
}

func newRoom(m *Manager, code string, md *data.Mode, mapID string, priv bool, seq int64) *Room {
	r := &Room{mgr: m, g: m.G, C: m.C, Code: code, Priv: priv, Mode: md, created: seq, stop: make(chan struct{}),
		nextPID: 1, nextPrID: 1, rng: rand.New(rand.NewPCG(rand.Uint64(), uint64(seq)))}
	r.loadMap(mapID)
	r.resetMatch()
	return r
}

func (r *Room) ticks(sec float64) int64 {
	return int64(math.Round(sec * float64(r.g.Rules.Net.TickRate)))
}

func (r *Room) loadMap(id string) {
	r.MapID = id
	r.Map = r.g.Maps[id]
	r.World = sim.MakeWorld(r.Map)
	r.nav = r.mgr.nav.get(r.Map, r.C)
	r.killY = r.Map.KillYValue()
	idc := id
	r.curMap.Store(&idc)
	r.hasNests = false
	var have [3]bool
	for _, n := range r.Map.Nests {
		if n.Team == 1 || n.Team == 2 {
			r.nests[n.Team] = n.Pos
			have[n.Team] = true
		}
	}
	r.hasNests = have[1] && have[2] && r.Mode.Objective == "nest"
}

// resetMatch resets scores, pickups and objective for a new match.
func (r *Room) resetMatch() {
	r.state = stateLive
	r.endTick = r.k + r.ticks(r.Mode.TimeLimitSec)
	r.ts = [3]int{}
	r.pickups = make([]pickupState, len(r.Map.Pickups))
	for i := range r.pickups {
		r.pickups[i].avail = true
	}
	for t := 1; t <= 2; t++ {
		r.eggs[t] = egg{pos: r.nests[t]}
	}
	r.projs = r.projs[:0]
	for _, p := range r.players {
		r.bankScore(p)
		p.Score, p.Kills, p.Deaths, p.Streak, p.Carrying, p.FuryUntil = 0, 0, 0, 0, 0, 0
		p.scoreBanked = 0
	}
	r.sbDirty = true
}

func (r *Room) enqueue(e roomEvent) {
	r.mu.Lock()
	r.events = append(r.events, e)
	r.mu.Unlock()
}

func (r *Room) byID(id int) *Player {
	i := sort.Search(len(r.players), func(i int) bool { return r.players[i].ID >= id })
	if i < len(r.players) && r.players[i].ID == id {
		return r.players[i]
	}
	return nil
}

// ---------------------------------------------------------------- messaging

func (r *Room) to(p *Player, msg []byte) {
	if p != nil && p.client != nil {
		p.out = append(p.out, msg)
	}
}

func (r *Room) all(msg []byte) {
	for _, p := range r.players {
		r.to(p, msg)
	}
}

func (r *Room) except(id int, msg []byte) {
	for _, p := range r.players {
		if p.ID != id {
			r.to(p, msg)
		}
	}
}

func (r *Room) sys(m string) { r.all(mustJSON(sysMsg{T: "sys", M: m})) }

func (r *Room) roster(p *Player) rosterJSON {
	rj := rosterJSON{ID: p.ID, N: p.Name, Tm: p.Team, Cls: p.Cls, Cos: p.Cos, Sc: p.Score, Ki: p.Kills, De: p.Deaths, St: p.Streak, Al: b2i(p.Alive)}
	if p.bot != nil {
		rj.Bot = 1
	}
	return rj
}

func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}

func (r *Room) pkString() string {
	b := make([]byte, len(r.pickups))
	for i, pk := range r.pickups {
		b[i] = '0'
		if pk.avail {
			b[i] = '1'
		}
	}
	return string(b)
}

func (r *Room) objJSON() []byte {
	if !r.hasNests {
		return []byte("null")
	}
	var b []byte
	b = append(b, '[')
	for t := 1; t <= 2; t++ {
		if t > 1 {
			b = append(b, ',')
		}
		e := &r.eggs[t]
		pos := r.eggPos(t)
		b = append(b, '[')
		b = appendInt(b, t)
		b = append(b, ',')
		b = appendInt(b, e.state)
		for _, v := range pos {
			b = append(b, ',')
			b = appendQ(b, v, 2)
		}
		b = append(b, ',')
		b = appendInt(b, e.carrier)
		b = append(b, ']')
	}
	return append(b, ']')
}

func (r *Room) timeLeft() float64 {
	if r.state != stateLive {
		return 0
	}
	return q(math.Max(0, float64(r.endTick-r.k)/float64(r.g.Rules.Net.TickRate)), 2)
}

func (r *Room) teamScores() [2]int { return [2]int{r.ts[1], r.ts[2]} }

func (r *Room) sbRows() [][6]int {
	rows := make([][6]int, 0, len(r.players))
	for _, p := range r.players {
		rows = append(rows, [6]int{p.ID, p.Score, p.Kills, p.Deaths, p.Streak, p.ping})
	}
	return rows
}

func (r *Room) sendSB() {
	r.all(mustJSON(sbMsg{T: "sb", P: r.sbRows(), Ts: r.teamScores(), Tl: r.timeLeft()}))
}

// ---------------------------------------------------------------- run loop

func (r *Room) run() {
	defer func() {
		if e := recover(); e != nil {
			log.Printf("room %s panic: %v\n%s", r.Code, e, debug.Stack())
			// unregister unconditionally: clients still hold reservations, and
			// leave() never deletes a private room
			r.dead.Store(true)
			r.mgr.mu.Lock()
			if r.mgr.rooms[r.Code] == r {
				delete(r.mgr.rooms, r.Code)
			}
			r.mgr.mu.Unlock()
			func() {
				defer func() { _ = recover() }() // the room state may be what panicked
				r.closeAll()
			}()
			// joins queued before the room was unregistered get "unavailable"
			for i := 0; i < 10; i++ {
				r.drainEvents()
				time.Sleep(20 * time.Millisecond)
			}
		}
	}()
	dt := time.Second / time.Duration(r.g.Rules.Net.TickRate)
	next := time.Now()
	for {
		select {
		case <-r.stop:
			r.closeAll()
			return
		default:
		}
		r.tick()
		grace := r.mgr.Cfg.EmptyGrace
		if !r.hadHuman {
			grace = min(grace, r.mgr.Cfg.UnusedGrace)
		}
		if r.Priv && r.humans == 0 && r.k-r.emptyAt > r.ticks(grace.Seconds()) {
			if r.mgr.tryRemoveEmpty(r) {
				r.closeAll()
				return
			}
		}
		next = next.Add(dt)
		now := time.Now()
		if d := next.Sub(now); d > 0 {
			select {
			case <-r.stop:
				r.closeAll()
				return
			case <-time.After(d):
			}
		} else if -d > 250*time.Millisecond {
			next = now // fell far behind: don't try to catch up
		}
	}
}

// closeAll tells every client the room is going away and closes them.
func (r *Room) closeAll() {
	msg := mustJSON(sysMsg{T: "sys", M: "Server is restarting. Please rejoin in a moment."})
	for _, p := range r.players {
		if p.client != nil {
			r.bankScore(p)
			p.client.closeGoingAway(msg)
		}
	}
	r.drainEvents() // close clients that were queued to join
}

func (r *Room) drainEvents() {
	r.mu.Lock()
	ev := r.events
	r.events = nil
	r.mu.Unlock()
	for _, e := range ev {
		if e.join {
			e.c.fail("unavailable")
		}
	}
}

// tick runs one simulation step in the order of PROTOCOL.md section 15.
func (r *Room) tick() {
	r.curK.Store(r.k)
	live := r.state == stateLive

	// 1. joins and leaves
	r.processEvents()
	r.manageBots()
	r.drainInboxes()

	// 2. inputs
	tokenMax := r.g.Rules.Net.InputTokenMax
	maxPer := r.g.Rules.Net.MaxInputsPerTick
	for _, p := range r.players {
		if p.bot != nil {
			r.botThink(p)
		}
		p.tokens = min(tokenMax, p.tokens+1)
		// De-jitter: one input per tick, so a player advances one sim step per
		// tick even though clients send in batches. Catch up faster only once
		// the backlog grows past the jitter buffer.
		limit := 1
		if len(p.pending()) > jitterBuffer {
			limit = maxPer
		}
		consumed := 0
		for len(p.pending()) > 0 && p.tokens >= 1 && consumed < limit {
			in := p.popInput()
			p.tokens--
			consumed++
			p.Ack = in.Seq
			r.applyInput(p, &in, live)
		}
		if consumed > 0 {
			p.starve = 0
		} else {
			p.starve++
			if p.starve >= r.g.Rules.Net.StarveTicks && p.Alive && live {
				// null input: movement only (keys 0). The weapon state machine is
				// not ticked, so held buttons, bursts and timers resume exactly as
				// the client predicted when its delayed inputs arrive.
				sim.StepMove(r.World, r.C, &p.PS, 0, p.Yaw, sim.SpeedMulFor(r.C, p.Defs, &p.WS, 0))
			}
		}
	}

	if live {
		// 3. projectiles
		r.stepProjectiles()
		// 4. kill-Y
		for _, p := range r.players {
			if p.Alive && p.PS.Y < r.killY {
				r.kill(p, p.ID, "fall", false)
			}
		}
		// 5. pickups, objective, regen, fury, protection, respawns
		r.stepPickups()
		r.stepNests()
		r.stepVitals()
	}

	// 6. lag-comp history
	for _, p := range r.players {
		p.hist[int(r.k%int64(len(p.hist)))] = histEntry{tick: r.k, x: p.PS.X, y: p.PS.Y, z: p.PS.Z, alive: p.Alive}
	}

	// 7. match flow
	r.stepMatch()

	// 8. snapshots and scoreboard
	if r.k%int64(r.g.Rules.Net.TickRate) == 0 || r.sbDirty {
		r.sendSB()
		r.sbDirty = false
	}
	if r.k%int64(r.g.Rules.Net.SnapshotEvery) == 0 {
		r.sendSnapshots()
	}
	if r.k%int64(r.g.Rules.Net.TickRate) == 0 {
		r.checkIdle()
	}

	// 9. flush
	r.flush()

	// 10.
	r.curN.Store(int64(len(r.players)))
	r.k++
}

func (p *Player) pending() []sim.Input {
	if p.bot != nil {
		return p.bot.queue
	}
	return p.client.queued
}

func (p *Player) popInput() sim.Input {
	if p.bot != nil {
		in := p.bot.queue[0]
		p.bot.queue = p.bot.queue[1:]
		return in
	}
	in := p.client.queued[0]
	p.client.queued = p.client.queued[1:]
	return in
}

// drainInboxes moves each client's inbox into room-owned queues and handles
// loadout, chat and notices.
func (r *Room) drainInboxes() {
	for _, p := range r.players {
		c := p.client
		if c == nil {
			continue
		}
		c.mu.Lock()
		c.queued = append(c.queued, c.inputs...)
		c.inputs = c.inputs[:0]
		lds, chats, notes := c.lds, c.chats, c.notes
		c.lds, c.chats, c.notes = nil, nil, nil
		p.ping = c.rtt
		c.mu.Unlock()
		if over := len(c.queued) - r.g.Rules.Net.InputQueueMax; over > 0 {
			c.queued = c.queued[over:]
		}
		for _, n := range notes {
			r.to(p, mustJSON(sysMsg{T: "sys", M: n}))
		}
		for _, ld := range lds {
			if ld.cls != nil && r.g.IsPrimary(*ld.cls) {
				p.Cls = *ld.cls
			}
			p.Cos = applyCos(r.g, p.Cos, ld.cos)
			r.all(mustJSON(rosterMsg{T: "pu", P: r.roster(p)}))
		}
		for _, ch := range chats {
			m := SanitizeChat(ch.m, 120)
			if m == "" {
				continue
			}
			team := ch.team && r.Mode.Teams
			msg := mustJSON(chatMsg{T: "chat", ID: p.ID, M: m, Tm: b2i(team)})
			if team {
				for _, o := range r.players {
					if o.Team == p.Team {
						r.to(o, msg)
					}
				}
			} else {
				r.all(msg)
			}
		}
	}
}

func (r *Room) checkIdle() {
	idle := time.Duration(r.g.Rules.Net.IdleTimeoutSec * float64(time.Second))
	now := time.Now()
	for _, p := range r.players {
		if p.client == nil {
			continue
		}
		p.client.mu.Lock()
		last := p.client.lastInput
		p.client.mu.Unlock()
		if now.Sub(last) > idle {
			p.client.fail("idle")
		}
	}
}

func (r *Room) processEvents() {
	r.mu.Lock()
	ev := r.events
	r.events = nil
	r.mu.Unlock()
	for _, e := range ev {
		if e.join {
			r.addHuman(e.c, e.hello)
		} else {
			r.removeClient(e.c)
		}
	}
}

func (r *Room) newPlayer(name, cls string, cos Cos) *Player {
	p := &Player{ID: r.nextPID, Name: name, Cls: cls, CurCls: cls, Cos: cos, hist: make([]histEntry, max(2, r.g.Rules.Net.HistoryTicks))}
	for i := range p.hist {
		p.hist[i].tick = -1
	}
	r.nextPID++
	p.Defs = sim.DefsFor(r.g.Weapons, cls)
	p.WS = sim.NewWeaponState(p.Defs)
	return p
}

func (r *Room) insert(p *Player) {
	r.players = append(r.players, p) // ids only grow, so this stays sorted
	p.Team = r.pickTeam()
}

func (r *Room) addHuman(c *Client, h hello) {
	if c.closing.Load() {
		return
	}
	maxP := r.g.Rules.Net.MaxPlayersPerRoom
	for len(r.players) >= maxP && r.removeOneBot() {
	}
	p := r.newPlayer(h.name, h.cls, h.cos)
	p.client = c
	c.mu.Lock()
	c.lastInput = time.Now()
	c.mu.Unlock()
	r.insert(p)
	r.humans++
	r.hadHuman = true
	r.welcome(p)
	r.except(p.ID, mustJSON(rosterMsg{T: "join", P: r.roster(p)}))
	r.except(p.ID, mustJSON(sysMsg{T: "sys", M: p.Name + " joined"}))
	r.spawn(p)
	r.sbDirty = true
}

func (r *Room) welcome(p *Player) {
	ps := make([]rosterJSON, 0, len(r.players))
	for _, o := range r.players {
		ps = append(ps, r.roster(o))
	}
	st := "live"
	if r.state != stateLive {
		st = "ended"
	}
	r.to(p, mustJSON(welcomeJSON{T: "welcome", V: r.g.Rules.Net.ProtocolVersion, ID: p.ID,
		Room: roomJSON{Code: r.Code, Mode: r.Mode.ID, Map: r.MapID, Priv: b2i(r.Priv), Max: r.g.Rules.Net.MaxPlayersPerRoom},
		Tr:   r.g.Rules.Net.TickRate, Se: r.g.Rules.Net.SnapshotEvery, K: r.k, Players: ps,
		Match: matchJSON{State: st, Tl: r.timeLeft(), Ts: r.teamScores(), Limit: r.Mode.ScoreLimit},
		Pk:    r.pkString(), O: json.RawMessage(r.objJSON())}))
}

func (r *Room) removeClient(c *Client) {
	for _, p := range r.players {
		if p.client == c {
			r.removePlayer(p)
			r.humans--
			if r.humans == 0 {
				r.emptyAt = r.k
			}
			return
		}
	}
}

func (r *Room) removePlayer(p *Player) {
	if p.Carrying != 0 {
		r.dropEgg(p)
	}
	r.bankScore(p)
	i := sort.Search(len(r.players), func(i int) bool { return r.players[i].ID >= p.ID })
	r.players = append(r.players[:i], r.players[i+1:]...)
	r.all(mustJSON(idMsg{T: "leave", ID: p.ID}))
	r.all(mustJSON(sysMsg{T: "sys", M: p.Name + " left"}))
	r.sbDirty = true
}

// bankScore adds the not-yet-recorded part of a human's score to stats.
func (r *Room) bankScore(p *Player) {
	if p.client == nil || r.mgr.Stats == nil {
		return
	}
	if d := p.Score - p.scoreBanked; d > 0 {
		r.mgr.Stats.AddScore(p.Name, d)
	}
	p.scoreBanked = p.Score
}

// ---------------------------------------------------------------- snapshots

func (r *Room) sendSnapshots() {
	// common tail: "p":[...],"pr":[...],"pk":"...","o":...}
	b := r.scratch[:0]
	b = append(b, `,"p":[`...)
	for i, p := range r.players {
		if i > 0 {
			b = append(b, ',')
		}
		b = append(b, '[')
		b = appendInt(b, p.ID)
		b = append(b, ',')
		b = appendQ(b, p.PS.X, 2)
		b = append(b, ',')
		b = appendQ(b, p.PS.Y, 2)
		b = append(b, ',')
		b = appendQ(b, p.PS.Z, 2)
		b = append(b, ',')
		b = appendQ(b, p.Yaw, 3)
		b = append(b, ',')
		b = appendQ(b, p.Pitch, 3)
		b = append(b, ',')
		b = appendInt(b, p.wireHP())
		b = append(b, ',')
		b = appendInt(b, p.SH)
		b = append(b, ',')
		b = appendInt(b, r.flags(p))
		b = append(b, ',')
		b = appendInt(b, p.WS.Slot)
		b = append(b, ']')
		p.fired = false
	}
	b = append(b, `],"pr":[`...)
	for i, pr := range r.projs {
		if i > 0 {
			b = append(b, ',')
		}
		b = append(b, '[')
		b = appendInt(b, pr.ID)
		b = append(b, ',')
		b = appendInt(b, pr.Kind)
		b = append(b, ',')
		b = appendInt(b, pr.Owner)
		for _, v := range [3]float64{pr.X, pr.Y, pr.Z} {
			b = append(b, ',')
			b = appendQ(b, v, 2)
		}
		for _, v := range [3]float64{pr.VX, pr.VY, pr.VZ} {
			b = append(b, ',')
			b = appendQ(b, v, 1)
		}
		b = append(b, ']')
	}
	b = append(b, `],"pk":"`...)
	b = append(b, r.pkString()...)
	b = append(b, `","o":`...)
	b = append(b, r.objJSON()...)
	b = append(b, '}')
	r.scratch = b
	k := r.k
	for _, p := range r.players {
		if p.client == nil {
			continue
		}
		m := make([]byte, 0, len(b)+320)
		m = append(m, `{"t":"s","k":`...)
		m = appendInt(m, int(k))
		m = append(m, `,"a":`...)
		m = appendInt(m, int(p.Ack))
		m = append(m, `,"me":{"x":`...)
		m = appendFloat(m, p.PS.X)
		m = append(m, `,"y":`...)
		m = appendFloat(m, p.PS.Y)
		m = append(m, `,"z":`...)
		m = appendFloat(m, p.PS.Z)
		m = append(m, `,"vx":`...)
		m = appendFloat(m, p.PS.VX)
		m = append(m, `,"vy":`...)
		m = appendFloat(m, p.PS.VY)
		m = append(m, `,"vz":`...)
		m = appendFloat(m, p.PS.VZ)
		m = append(m, `,"g":`...)
		m = appendBool(m, p.PS.OnGround)
		m = append(m, `,"al":`...)
		m = appendBool(m, p.Alive)
		m = append(m, `,"hp":`...)
		m = appendInt(m, p.wireHP())
		m = append(m, `,"sh":`...)
		m = appendInt(m, p.SH)
		m = append(m, `,"ws":[`...)
		for i, v := range p.WS.Array() {
			if i > 0 {
				m = append(m, ',')
			}
			m = appendFloat(m, v)
		}
		m = append(m, `],"fu":`...)
		fu := 0.0
		if p.FuryUntil > k {
			fu = q(float64(p.FuryUntil-k)/float64(r.g.Rules.Net.TickRate), 2)
		}
		m = appendFloat(m, fu)
		m = append(m, '}')
		m = append(m, b...)
		p.out = append(p.out, m)
	}
}

func (p *Player) wireHP() int {
	if !p.Alive {
		return 0
	}
	return int(math.Max(0, math.Ceil(p.HP)))
}

// Player flag bits (PROTOCOL.md 7).
const (
	flAlive     = 1
	flGround    = 2
	flAim       = 4
	flReload    = 8
	flProtected = 16
	flCarry     = 32
	flFury      = 64
	flSwitch    = 128
	flFired     = 256
)

func (r *Room) flags(p *Player) int {
	f := 0
	if p.Alive {
		f |= flAlive
	}
	if p.PS.OnGround {
		f |= flGround
	}
	if p.Btns&sim.BtnAim != 0 {
		f |= flAim
	}
	if p.WS.Rl > 0 {
		f |= flReload
	}
	if p.protected(r.k) {
		f |= flProtected
	}
	if p.Carrying != 0 {
		f |= flCarry
	}
	if p.FuryUntil > r.k {
		f |= flFury
	}
	if p.WS.Sw > 0 {
		f |= flSwitch
	}
	if p.fired {
		f |= flFired
	}
	return f
}

func (r *Room) flush() {
	for _, p := range r.players {
		if p.client == nil || len(p.out) == 0 {
			p.out = p.out[:0]
			continue
		}
		var f []byte
		if len(p.out) == 1 {
			f = p.out[0]
		} else {
			n := 2
			for _, m := range p.out {
				n += len(m) + 1
			}
			f = make([]byte, 0, n)
			f = append(f, '[')
			for i, m := range p.out {
				if i > 0 {
					f = append(f, ',')
				}
				f = append(f, m...)
			}
			f = append(f, ']')
		}
		p.client.SendFrame(f)
		p.out = p.out[:0]
	}
}
