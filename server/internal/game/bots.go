package game

import (
	"math"

	"yolkout/server/internal/sim"
)

// Server-side bots fill rooms so a solo player always has someone to fight.
// They produce one input per tick through the same input path as humans, so
// they obey identical movement, weapon and hit rules.

var botNames = []string{
	"Shelldon", "Eggward", "Yolanda", "Scramblina", "Benny Poach", "Albumen", "Eggsworth", "Cluckers",
	"Henrietta", "Coddington", "Yolkster", "Sunny Sid", "Omeletta", "Hardy Boyle", "Brunchbot", "Pip Shellby",
	"Dr Dippy", "Crackers", "Nugget", "Fryday",
}

type botBrain struct {
	queue []sim.Input
	seq   uint32
	skill float64

	target   int
	seenAt   int64
	lastSeen int64
	lastPos  [3]float64
	nextLook int64

	goal      [3]float64
	goalUntil int64
	hasGoal   bool

	moveYaw  float64
	replanAt int64
	jump     int

	viewYaw, viewPitch float64
	errYaw, errPitch   float64
	errUntil           int64

	strafe      float64
	strafeUntil int64

	stuckX, stuckZ float64
	stuckAt        int64

	tap      bool
	nextNade int64
	role     int // nest mode: 0 attacker, 1 defender

	path     []int32 // cached nav path toward pathGoal
	pathGoal int
	pathPos  int
}

func wrapAngle(a float64) float64 {
	a = math.Remainder(a, 2*math.Pi)
	if a <= -math.Pi {
		a += 2 * math.Pi
	}
	return a
}

// yawTo returns the yaw that faces from (x,z) toward (tx,tz).
func yawTo(x, z, tx, tz float64) float64 { return math.Atan2(-(tx - x), -(tz - z)) }

func (r *Room) botCount() int {
	n := 0
	for _, p := range r.players {
		if p.bot != nil {
			n++
		}
	}
	return n
}

// manageBots keeps the number of bots at max(0, fill - humans) while any
// human is present, adding at most one bot per tick.
func (r *Room) manageBots() {
	maxP := r.g.Rules.Net.MaxPlayersPerRoom
	want := 0
	if r.humans > 0 {
		want = max(0, min(r.mgr.Cfg.BotFill-r.humans, maxP-r.humans))
	}
	n := r.botCount()
	for n > want && r.removeOneBot() {
		n--
	}
	if n < want && len(r.players) < maxP {
		r.addBot()
	}
}

func (r *Room) removeOneBot() bool {
	var n [3]int
	for _, p := range r.players {
		n[p.Team]++
	}
	big := 0
	if r.Mode.Teams {
		big = 1
		if n[2] > n[1] {
			big = 2
		}
	}
	var pick *Player
	for _, p := range r.players {
		if p.bot == nil {
			continue
		}
		if pick == nil || (p.Team == big && pick.Team != big) || (p.Team == pick.Team && p.ID > pick.ID) {
			pick = p
		}
	}
	if pick == nil {
		return false
	}
	r.removePlayer(pick)
	return true
}

func (r *Room) addBot() {
	used := map[string]bool{}
	for _, p := range r.players {
		used[p.Name] = true
	}
	name := ""
	off := r.rng.IntN(len(botNames))
	for i := range botNames {
		if n := botNames[(off+i)%len(botNames)]; !used[n] {
			name = n
			break
		}
	}
	if name == "" {
		name = "Bot " + string(rune('A'+r.rng.IntN(26)))
	}
	prim := r.g.Weapons.Primaries
	cs := r.g.Cosmetics
	cos := Cos{Hat: cs.Hats[r.rng.IntN(len(cs.Hats))].ID, Color: cs.Colors[r.rng.IntN(len(cs.Colors))].ID, Stamp: cs.Stamps[r.rng.IntN(len(cs.Stamps))].ID}
	p := r.newPlayer(name, prim[r.rng.IntN(len(prim))], cos)
	p.bot = &botBrain{skill: 0.25 + 0.5*r.rng.Float64(), role: p.ID % 2}
	r.insert(p)
	r.except(p.ID, mustJSON(rosterMsg{T: "join", P: r.roster(p)}))
	r.spawn(p)
	r.sbDirty = true
}

func (b *botBrain) onSpawn(r *Room, p *Player) {
	b.viewYaw, b.viewPitch, b.moveYaw = p.Yaw, 0, p.Yaw
	b.target, b.hasGoal, b.replanAt = 0, false, 0
	b.stuckX, b.stuckZ, b.stuckAt = p.PS.X, p.PS.Z, r.k
	if r.hasNests {
		// split each team's bots evenly into attackers and defenders (teams can change on rebalance)
		var n [2]int
		for _, o := range r.players {
			if o != p && o.bot != nil && o.Team == p.Team {
				n[o.bot.role]++
			}
		}
		b.role = 0
		if n[0] > n[1] {
			b.role = 1
		}
	}
}

// visible reports line of sight from p's eye to o's body centre.
func (r *Room) visible(p, o *Player) (float64, bool) {
	ex, ey, ez := p.PS.X, p.PS.Y+r.C.EyeHeight, p.PS.Z
	dx, dy, dz := o.PS.X-ex, o.PS.Y+0.9-ey, o.PS.Z-ez
	d := math.Sqrt(dx*dx + dy*dy + dz*dz)
	if d < 1e-6 {
		return 0, true
	}
	return d, sim.RaycastWorld(r.World, ex, ey, ez, dx/d, dy/d, dz/d, d) < 0
}

func (r *Room) botChooseGoal(p *Player, b *botBrain) {
	b.hasGoal = true
	b.goalUntil = r.k + r.ticks(6+6*r.rng.Float64())
	if r.hasNests {
		own, enemy := p.Team, 3-p.Team
		switch {
		case p.Carrying != 0:
			b.goal, b.goalUntil = r.nests[own], r.k+r.ticks(4)
			return
		case r.eggs[own].state != 0:
			b.goal, b.goalUntil = r.eggPos(own), r.k+r.ticks(2)
			return
		case b.role == 0 && r.eggs[enemy].state != 1:
			b.goal, b.goalUntil = r.eggPos(enemy), r.k+r.ticks(4)
			return
		case b.role == 1 && r.rng.Float64() < 0.5:
			n := r.nests[own]
			b.goal = [3]float64{n[0] + r.rng.Float64()*8 - 4, n[1], n[2] + r.rng.Float64()*8 - 4}
			return
		}
	}
	if b.lastSeen > 0 && r.k-b.lastSeen < r.ticks(4) {
		b.goal, b.goalUntil = b.lastPos, r.k+r.ticks(3)
		return
	}
	if p.HP < 60 {
		best := math.Inf(1)
		for i, pk := range r.Map.Pickups {
			if pk.Type == "hp" && r.pickups[i].avail {
				if d := math.Hypot(pk.Pos[0]-p.PS.X, pk.Pos[2]-p.PS.Z); d < best && d < 30 {
					best, b.goal = d, pk.Pos
				}
			}
		}
		if !math.IsInf(best, 1) {
			return
		}
	}
	// wander: a random pickup or spawn point that is not right here
	n := len(r.Map.Pickups) + len(r.Map.Spawns)
	for try := 0; try < 6; try++ {
		i := r.rng.IntN(n)
		var pos [3]float64
		if i < len(r.Map.Pickups) {
			pos = r.Map.Pickups[i].Pos
		} else {
			pos = r.Map.Spawns[i-len(r.Map.Pickups)].Pos
		}
		if math.Hypot(pos[0]-p.PS.X, pos[2]-p.PS.Z) > 8 {
			b.goal = pos
			return
		}
	}
	// any enemy as a last resort
	for _, o := range r.players {
		if o.Alive && r.enemies(p, o) {
			b.goal = [3]float64{o.PS.X, o.PS.Y, o.PS.Z}
			return
		}
	}
	b.goal = [3]float64{p.PS.X + r.rng.Float64()*20 - 10, p.PS.Y, p.PS.Z + r.rng.Float64()*20 - 10}
}

// safeAhead simulates walking toward yaw for n ticks and returns how much
// closer it gets to the goal (or -inf when it would fall into the void).
func (r *Room) botProbe(w *sim.World, p *Player, yaw float64, jump bool, goal [3]float64, n int) float64 {
	ps := p.PS
	ps.OnGround = p.PS.OnGround
	keys := sim.KeyFwd
	mul := p.Defs.W[p.WS.Slot].MoveMul
	for i := 0; i < n; i++ {
		k := keys
		if jump && i == 0 {
			k |= sim.KeyJump
		}
		sim.StepMove(w, r.C, &ps, k, yaw, mul)
	}
	// look for floor under the end point
	h := sim.RaycastWorld(w, ps.X, ps.Y+0.2, ps.Z, 0, -1, 0, 8)
	if ps.Y < r.killY+3 || (h < 0 && ps.Y-r.killY > 0) {
		if h < 0 {
			// no floor within 8 units: only acceptable if something is far below and above killY
			h2 := sim.RaycastWorld(w, ps.X, ps.Y+0.2, ps.Z, 0, -1, 0, 60)
			if h2 < 0 || ps.Y+0.2-h2 < r.killY+2 {
				return math.Inf(-1)
			}
		} else {
			return math.Inf(-1)
		}
	}
	d0 := math.Hypot(goal[0]-p.PS.X, goal[2]-p.PS.Z)
	d1 := math.Hypot(goal[0]-ps.X, goal[2]-ps.Z)
	moved := math.Hypot(ps.X-p.PS.X, ps.Z-p.PS.Z)
	return (d0 - d1) + 0.15*moved
}

// botWaypoint returns the point the bot should head for to reach its goal:
// the farthest node of the nav-graph path (up to ~6u ahead) that it can see
// clearly, so bots route through doorways instead of pushing into walls.
// Falls back to the goal itself when there is no path.
func (r *Room) botWaypoint(p *Player, b *botBrain) [3]float64 {
	g := r.nav
	x, y, z := p.PS.X, p.PS.Y, p.PS.Z
	t := g.nodeAt(b.goal[0], b.goal[1], b.goal[2])
	// follow the cached path while the bot is still on it (its furthest node within 1u)
	at := -1
	if t == b.pathGoal && len(b.path) > 0 {
		for j := b.pathPos; j < len(b.path) && j < b.pathPos+24; j++ {
			nd := &g.nodes[b.path[j]]
			if math.Abs(nd.h-y) < 0.6 && math.Hypot(nd.x-x, nd.z-z) <= 1 {
				at = j
			}
		}
	}
	if at < 0 {
		b.path = append(b.path[:0], r.navS.findPath(g, g.nodeAt(x, y, z), t)...)
		b.pathGoal, at = t, 0
	}
	b.pathPos = at
	path := b.path[at:]
	if len(path) < 2 {
		b.path = b.path[:0]
		return b.goal
	}
	pick := path[1]
	for j := 1; j < len(path) && j <= 12; j++ {
		nd := &g.nodes[path[j]]
		if j > 1 && !r.navClear(x, y, z, nd.x, nd.h, nd.z) {
			break
		}
		pick = path[j]
		if nd.h > y+r.C.StepHeight {
			break // needs a jump: go for this ledge first
		}
	}
	nd := &g.nodes[pick]
	// keep the steering point at least 3u out so the move probe has something to approach
	dx, dz := nd.x-x, nd.z-z
	if d := math.Hypot(dx, dz); d > 1e-6 && d < 3 && pick != path[len(path)-1] && math.Abs(nd.h-y) < 0.3 {
		dx, dz = dx/d*3, dz/d*3
	}
	return [3]float64{x + dx, nd.h, z + dz}
}

// navClear reports whether a body-wide corridor from a standing point to a
// node is free at knee and chest height (two rays offset sideways each).
func (r *Room) navClear(x, y, z, tx, ty, tz float64) bool {
	dx, dz := tx-x, tz-z
	d := math.Hypot(dx, dz)
	if d < 1e-6 {
		return true
	}
	ux, uz := dx/d, dz/d
	px, pz := -uz*r.C.HalfWidth, ux*r.C.HalfWidth
	for _, hgt := range [...]float64{0.6, 1.2} {
		y0, y1 := y+hgt, ty+hgt
		for _, s := range [...]float64{-1, 1} {
			ox, oz := x+px*s, z+pz*s
			ex, ey, ez := tx+px*s-ox, y1-y0, tz+pz*s-oz
			L := math.Sqrt(ex*ex + ey*ey + ez*ez)
			if sim.RaycastWorld(r.World, ox, y0, oz, ex/L, ey/L, ez/L, L) >= 0 {
				return false
			}
		}
	}
	return true
}

func (r *Room) botNavigate(p *Player, b *botBrain, wantYaw float64, steer [3]float64) {
	offs := [...]float64{0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.4, -2.4, math.Pi}
	best, bestYaw, bestJump := math.Inf(-1), wantYaw, false
	goal := steer
	if b.target != 0 {
		// in combat: score candidates by how well they keep us moving safely
		goal = [3]float64{p.PS.X - math.Sin(wantYaw)*10, p.PS.Y, p.PS.Z - math.Cos(wantYaw)*10}
	}
	// 14 ticks at <= 20 u/s horizontal stays within 5 units; falls within 6;
	// the floor probe reaches 60 below. Boxes outside this region cannot matter.
	x, y0, z := p.PS.X, p.PS.Y, p.PS.Z
	lw := sim.SubWorld(&r.botWorld, r.World, [3]float64{x - 8, y0 - 75, z - 8}, [3]float64{x + 8, y0 + 10, z + 8})
	for _, o := range offs {
		y := wrapAngle(wantYaw + o)
		for _, j := range [...]bool{false, true} {
			s := r.botProbe(lw, p, y, j, goal, 14) - math.Abs(o)*0.25
			if j {
				s -= 0.2
			}
			if s > best {
				best, bestYaw, bestJump = s, y, j
			}
		}
	}
	if math.IsInf(best, -1) {
		bestYaw = wrapAngle(wantYaw + math.Pi)
	}
	b.moveYaw = bestYaw
	if bestJump {
		b.jump = 2
	}
}

// botThink queues this tick's input for bot p.
func (r *Room) botThink(p *Player) {
	b := p.bot
	b.seq++
	in := sim.Input{Seq: b.seq, Yaw: b.viewYaw, Pitch: b.viewPitch, Slot: 0, Rt: float64(r.k)}
	if !p.Alive || r.state != stateLive {
		if !p.Alive && r.rng.Float64() < 0.002 {
			prim := r.g.Weapons.Primaries
			p.Cls = prim[r.rng.IntN(len(prim))]
		}
		b.queue = append(b.queue[:0], in)
		return
	}
	dt := r.C.Dt

	// perception
	if r.k >= b.nextLook {
		b.nextLook = r.k + 4
		var best *Player
		bestD := 70.0
		if cur := r.byID(b.target); cur != nil && cur.Alive {
			if d, ok := r.visible(p, cur); ok && d < bestD {
				best, bestD = cur, d*0.7 // stickiness
			}
		}
		for _, o := range r.players {
			if o == best || !o.Alive || !r.enemies(p, o) {
				continue
			}
			if d, ok := r.visible(p, o); ok && d < bestD {
				best, bestD = o, d
			}
		}
		if best == nil {
			b.target = 0
		} else {
			if best.ID != b.target {
				b.seenAt = r.k
				b.errYaw = (r.rng.Float64()*2 - 1) * (0.25 * (1.2 - b.skill))
				b.errPitch = (r.rng.Float64()*2 - 1) * (0.12 * (1.2 - b.skill))
				b.errUntil = r.k + r.ticks(0.5)
			}
			b.target = best.ID
			b.lastSeen = r.k
			b.lastPos = [3]float64{best.PS.X, best.PS.Y, best.PS.Z}
		}
	}
	tgt := r.byID(b.target)
	if tgt != nil && !tgt.Alive {
		tgt, b.target = nil, 0
	}

	// goals and movement
	if !b.hasGoal || r.k >= b.goalUntil || math.Hypot(b.goal[0]-p.PS.X, b.goal[2]-p.PS.Z) < 1.5 {
		r.botChooseGoal(p, b)
	}
	if r.hasNests && (p.Carrying != 0) && b.goal != r.nests[p.Team] {
		r.botChooseGoal(p, b)
	}
	dist := 0.0
	var aimPt [3]float64
	w := p.Defs.W[p.WS.Slot]
	if tgt != nil {
		aimPt = [3]float64{tgt.PS.X, tgt.PS.Y + 0.85, tgt.PS.Z}
		if w.Kind == "projectile" {
			aimPt[1] = tgt.PS.Y + 0.15
		}
		dist = math.Hypot(aimPt[0]-p.PS.X, aimPt[2]-p.PS.Z)
		if w.Kind == "projectile" && w.Projectile != nil {
			lead := dist / w.Projectile.Speed
			aimPt[0] += tgt.PS.VX * lead
			aimPt[2] += tgt.PS.VZ * lead
		}
	}
	if r.k >= b.replanAt {
		b.replanAt = r.k + 10 + int64(r.rng.IntN(6))
		steer := r.botWaypoint(p, b)
		want := yawTo(p.PS.X, p.PS.Z, steer[0], steer[2])
		// carriers run home; attackers keep pushing the objective (shooting on the move) unless the fight is close
		pushing := r.hasNests && (p.Carrying != 0 || (b.role == 0 && dist > 10))
		if tgt != nil && !pushing {
			toT := yawTo(p.PS.X, p.PS.Z, tgt.PS.X, tgt.PS.Z)
			pref := 12.0
			if w.FireMode == "semi" && w.Pellets > 1 {
				pref = 5
			} else if w.HipSpread >= 0.1 || w.Kind == "projectile" {
				pref = 22
			}
			if r.k >= b.strafeUntil {
				b.strafe = []float64{-1.3, 1.3, -0.8, 0.8}[r.rng.IntN(4)]
				b.strafeUntil = r.k + r.ticks(0.5+r.rng.Float64())
			}
			switch {
			case dist > pref+4:
				want = wrapAngle(toT + b.strafe*0.4)
			case dist < pref-4:
				want = wrapAngle(toT + math.Pi + b.strafe*0.4)
			default:
				want = wrapAngle(toT + b.strafe)
			}
		}
		r.botNavigate(p, b, want, steer)
	}
	// stuck detection
	if r.k-b.stuckAt >= 30 {
		if math.Hypot(p.PS.X-b.stuckX, p.PS.Z-b.stuckZ) < 0.6 {
			b.jump = 2
			b.moveYaw = wrapAngle(b.moveYaw + (r.rng.Float64()*2-1)*2.5)
			b.hasGoal = false
			b.replanAt = r.k + 20
		}
		b.stuckX, b.stuckZ, b.stuckAt = p.PS.X, p.PS.Z, r.k
	}

	// aim
	wantYaw, wantPitch := b.moveYaw, 0.0
	if tgt != nil {
		ex, ey, ez := p.PS.X, p.PS.Y+r.C.EyeHeight, p.PS.Z
		dx, dy, dz := aimPt[0]-ex, aimPt[1]-ey, aimPt[2]-ez
		wantYaw = math.Atan2(-dx, -dz)
		wantPitch = math.Atan2(dy, math.Hypot(dx, dz))
		if r.k >= b.errUntil {
			sc := 0.025 + 0.09*(1-b.skill)
			b.errYaw = (r.rng.Float64()*2 - 1) * sc
			b.errPitch = (r.rng.Float64()*2 - 1) * sc * 0.6
			b.errUntil = r.k + r.ticks(0.3+0.4*r.rng.Float64())
		}
		wantYaw += b.errYaw
		wantPitch += b.errPitch
	}
	turn := (2.5 + 5*b.skill) * dt
	dy := wrapAngle(wantYaw - b.viewYaw)
	b.viewYaw = wrapAngle(b.viewYaw + math.Max(-turn, math.Min(turn, dy)))
	dp := wantPitch - b.viewPitch
	b.viewPitch = sim.ClampPitch(r.C, b.viewPitch+math.Max(-turn, math.Min(turn, dp)))

	// keys: move toward moveYaw relative to the view
	keys := 0
	oct := int(math.Round(wrapAngle(b.moveYaw-b.viewYaw)/(math.Pi/4))) & 7
	keys = [8]int{sim.KeyFwd, sim.KeyFwd | sim.KeyLeft, sim.KeyLeft, sim.KeyBack | sim.KeyLeft, sim.KeyBack,
		sim.KeyBack | sim.KeyRight, sim.KeyRight, sim.KeyFwd | sim.KeyRight}[oct]
	if b.jump > 0 {
		keys |= sim.KeyJump
		b.jump--
	}

	// buttons
	btn := 0
	slot := 0
	if p.WS.Mag[0] == 0 && p.WS.Res[0] == 0 {
		slot = 1
	}
	b.tap = !b.tap
	if tgt != nil {
		errAng := math.Abs(wrapAngle(wantYaw-b.errYaw-b.viewYaw)) + math.Abs(wantPitch-b.errPitch-b.viewPitch)
		tol := math.Max(0.03, math.Atan2(0.5, math.Max(dist, 0.1))) + math.Abs(b.errYaw)
		react := r.ticks(0.55 - 0.35*b.skill)
		rng := w.Range
		if w.Kind == "projectile" {
			rng = 45
		}
		if w.Pellets > 1 {
			rng = math.Min(rng, 18)
		}
		if w.HipSpread >= 0.1 && w.Pellets == 1 {
			btn |= sim.BtnAim
		} else if dist > 18 && w.AdsSpread < w.HipSpread/2 {
			btn |= sim.BtnAim
		}
		if r.k-b.seenAt >= react && errAng < tol && dist <= rng*0.9 {
			if w.FireMode == "auto" || b.tap {
				btn |= sim.BtnFire
			}
		}
		if dist < 1.8 && b.tap {
			btn |= sim.BtnMelee
		}
		if dist > 8 && dist < 24 && p.WS.Gren > 0 && r.k >= b.nextNade && r.rng.Float64() < 0.01 {
			btn |= sim.BtnGrenade
			b.nextNade = r.k + r.ticks(6+6*r.rng.Float64())
		}
	} else if p.WS.Mag[p.WS.Slot] < w.MagSize/2 && p.WS.Res[p.WS.Slot] != 0 && b.tap {
		btn |= sim.BtnReload
	}
	in.Keys = keys
	in.Yaw = q(b.viewYaw, 4)
	in.Pitch = q(b.viewPitch, 4)
	in.Buttons = btn
	in.Slot = slot
	b.queue = append(b.queue[:0], in)
}
