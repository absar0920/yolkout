package game

import (
	"encoding/json"
	"math"
	"sort"

	"yolkout/server/internal/data"
	"yolkout/server/internal/sim"
)

// pickTeam implements PROTOCOL.md 12: smaller team, then lower team score, then team 1.
func (r *Room) pickTeam() int {
	if !r.Mode.Teams {
		return 0
	}
	var n [3]int
	for _, p := range r.players {
		if p.Team == 1 || p.Team == 2 {
			n[p.Team]++
		}
	}
	switch {
	case n[1] < n[2]:
		return 1
	case n[2] < n[1]:
		return 2
	case r.ts[2] < r.ts[1]:
		return 2
	}
	return 1
}

// spawn places p at a spawn point chosen per PROTOCOL.md 10.3.
// respawnHoldMaxSec caps how long a dead player choosing a loadout can delay
// their respawn past the normal timer (PROTOCOL.md, ld message).
const respawnHoldMaxSec = 10

func (r *Room) spawn(p *Player) {
	p.HoldRespawn = false
	var cands []data.Spawn
	if r.Mode.Teams {
		for _, s := range r.Map.Spawns {
			if s.Team == p.Team {
				cands = append(cands, s)
			}
		}
	}
	if len(cands) == 0 {
		cands = r.Map.Spawns
	}
	type scored struct {
		s data.Spawn
		d float64
	}
	sc := make([]scored, len(cands))
	for i, s := range cands {
		best := math.Inf(1)
		for _, o := range r.players {
			if o == p || !o.Alive || (r.Mode.Teams && o.Team == p.Team) {
				continue
			}
			dx, dy, dz := o.PS.X-s.Pos[0], o.PS.Y-s.Pos[1], o.PS.Z-s.Pos[2]
			best = math.Min(best, math.Sqrt(dx*dx+dy*dy+dz*dz))
		}
		sc[i] = scored{s, best}
	}
	sort.SliceStable(sc, func(i, j int) bool { return sc[i].d > sc[j].d })
	n := min(3, len(sc))
	s := sc[r.rng.IntN(n)].s

	p.CurCls = p.Cls
	p.Defs = sim.DefsFor(r.g.Weapons, p.CurCls)
	p.WS = sim.NewWeaponState(p.Defs)
	p.PS = sim.PlayerState{X: s.Pos[0], Y: s.Pos[1], Z: s.Pos[2], OnGround: true}
	p.Yaw, p.Pitch, p.Slot, p.Btns = s.Yaw, 0, 0, 0
	p.Alive = true
	p.HP = r.g.Rules.Combat.MaxHp
	p.SH = 0
	p.FuryUntil = 0
	p.Carrying = 0
	p.ProtUntil = r.k + r.ticks(r.g.Rules.Combat.SpawnProtection)
	p.LastDamageTick = r.k
	if p.bot != nil {
		p.bot.onSpawn(r, p)
	}
	r.all(mustJSON(spawnMsg{T: "spawn", ID: p.ID, X: s.Pos[0], Y: s.Pos[1], Z: s.Pos[2], Yaw: s.Yaw, Cls: p.CurCls, Tm: p.Team}))
}

// stepPickups: respawn timers, then collection in map order / ascending id.
func (r *Room) stepPickups() {
	pr := &r.g.Rules.Pickups
	cb := &r.g.Rules.Combat
	for i := range r.pickups {
		pk := &r.pickups[i]
		if !pk.avail {
			if r.k >= pk.respawnAt {
				pk.avail = true
			} else {
				continue
			}
		}
		def := r.Map.Pickups[i]
		ty := pr.Types[def.Type]
		for _, p := range r.players {
			if !p.Alive {
				continue
			}
			if math.Hypot(p.PS.X-def.Pos[0], p.PS.Z-def.Pos[2]) > pr.Radius || p.PS.Y < def.Pos[1]-0.5 || p.PS.Y > def.Pos[1]+1.8 {
				continue
			}
			used := false
			switch def.Type {
			case "hp":
				if p.HP < cb.MaxHp {
					p.HP = math.Min(cb.MaxHp, p.HP+ty.Amount)
					used = true
				}
			case "shield":
				if float64(p.SH) < cb.MaxShield {
					p.SH = int(math.Min(cb.MaxShield, float64(p.SH)+ty.Amount))
					used = true
				}
			case "ammo":
				w := p.Defs.W[0]
				gm := p.Defs.Grenade.MaxCount
				if (w.Reserve >= 0 && p.WS.Res[0] < w.Reserve) || p.WS.Gren < gm {
					p.WS.Res[0] = w.Reserve
					g := ty.Grenades
					if g == 0 {
						g = 1
					}
					p.WS.Gren = min(gm, p.WS.Gren+g)
					used = true
				}
			}
			if used {
				pk.avail = false
				pk.respawnAt = r.k + r.ticks(ty.Respawn)
				r.all(mustJSON(pickMsg{T: "pick", I: i, ID: p.ID, Ty: def.Type}))
				break
			}
		}
	}
}

// stepVitals: regen, fury expiry, spawn protection expiry, respawns.
func (r *Room) stepVitals() {
	cb := &r.g.Rules.Combat
	for _, p := range r.players {
		if p.Alive {
			if r.k-p.LastDamageTick >= r.ticks(cb.RegenDelay) && p.HP < cb.MaxHp {
				p.HP = math.Min(cb.MaxHp, p.HP+cb.RegenRate*r.C.Dt)
			}
			if p.FuryUntil != 0 && r.k >= p.FuryUntil {
				p.FuryUntil = 0
			}
			if p.ProtUntil != 0 && r.k >= p.ProtUntil {
				p.ProtUntil = 0
			}
		} else if r.k >= p.RespawnAt && !(p.HoldRespawn && r.k < p.RespawnAt+r.ticks(respawnHoldMaxSec)) {
			r.spawn(p)
		}
	}
}

// ---------------------------------------------------------------- nest raid

func (r *Room) touch(p *Player, pos [3]float64) bool {
	tr := 1.2
	if r.Mode.Nest != nil {
		tr = r.Mode.Nest.TouchRadius
	}
	return math.Hypot(p.PS.X-pos[0], p.PS.Z-pos[2]) <= tr && math.Abs(p.PS.Y-pos[1]) <= 1.5
}

func (r *Room) eggPos(t int) [3]float64 {
	e := &r.eggs[t]
	if e.state == 1 {
		if c := r.byID(e.carrier); c != nil {
			return [3]float64{c.PS.X, c.PS.Y, c.PS.Z}
		}
	}
	return e.pos
}

func (r *Room) flag(ev string, t, id int) {
	r.all(mustJSON(flagMsg{T: "flag", Ev: ev, Tm: t, ID: id}))
}

func (r *Room) takeEgg(t int, p *Player) {
	e := &r.eggs[t]
	e.state, e.carrier = 1, p.ID
	p.Carrying = t
	p.Score += r.Mode.Points["take"]
	r.flag("take", t, p.ID)
	r.sbDirty = true
}

func (r *Room) returnEgg(t int, by *Player) {
	r.eggs[t] = egg{pos: r.nests[t]}
	id := 0
	if by != nil {
		id = by.ID
		by.Score += r.Mode.Points["return"]
		r.sbDirty = true
	}
	r.flag("return", t, id)
}

// dropEgg drops the egg p carries at p's position snapped to the floor.
func (r *Room) dropEgg(p *Player) {
	t := p.Carrying
	p.Carrying = 0
	if t == 0 {
		return
	}
	e := &r.eggs[t]
	oy := p.PS.Y + 0.1
	h := sim.RaycastWorld(r.World, p.PS.X, oy, p.PS.Z, 0, -1, 0, oy-r.killY+50)
	if h < 0 || oy-h < r.killY+1 {
		r.returnEgg(t, nil)
		return
	}
	*e = egg{state: 2, pos: [3]float64{p.PS.X, oy - h, p.PS.Z}, dropTick: r.k}
	r.flag("drop", t, p.ID)
}

func (r *Room) stepNests() {
	if !r.hasNests {
		return
	}
	dropTicks := r.ticks(20)
	if r.Mode.Nest != nil {
		dropTicks = r.ticks(r.Mode.Nest.DropReturnSec)
	}
	for t := 1; t <= 2; t++ {
		e := &r.eggs[t]
		switch e.state {
		case 0:
			for _, p := range r.players {
				if p.Alive && p.Team != t && p.Team != 0 && p.Carrying == 0 && r.touch(p, e.pos) {
					r.takeEgg(t, p)
					break
				}
			}
		case 1:
			c := r.byID(e.carrier)
			if c == nil || !c.Alive {
				// should not happen (drop on death/leave); recover.
				r.returnEgg(t, nil)
				continue
			}
			e.pos = [3]float64{c.PS.X, c.PS.Y, c.PS.Z}
			own := c.Team
			if (own == 1 || own == 2) && r.eggs[own].state == 0 && r.touch(c, r.nests[own]) {
				r.eggs[t] = egg{pos: r.nests[t]}
				c.Carrying = 0
				c.Caps++
				r.ts[own]++
				c.Score += r.Mode.Points["capture"]
				r.flag("cap", t, c.ID)
				r.sbDirty = true
				if s := r.mgr.Stats; s != nil && c.client != nil {
					s.AddCapture(c.Name)
				}
			}
		case 2:
			if r.k-e.dropTick >= dropTicks {
				r.returnEgg(t, nil)
				continue
			}
			for _, p := range r.players {
				if !p.Alive || !r.touch(p, e.pos) {
					continue
				}
				if p.Team == t {
					r.returnEgg(t, p)
					break
				}
				if p.Team != 0 && p.Carrying == 0 {
					r.takeEgg(t, p)
					break
				}
			}
		}
	}
}

// ---------------------------------------------------------------- match flow

func (r *Room) limitReached() bool {
	lim := r.Mode.ScoreLimit
	if lim <= 0 {
		return false
	}
	if r.Mode.Teams {
		return r.ts[1] >= lim || r.ts[2] >= lim
	}
	for _, p := range r.players {
		if p.Kills >= lim {
			return true
		}
	}
	return false
}

// ffaRanking sorts by kills desc, score desc, deaths asc, id asc.
func (r *Room) ffaRanking() []*Player {
	ps := append([]*Player(nil), r.players...)
	sort.SliceStable(ps, func(i, j int) bool {
		a, b := ps[i], ps[j]
		if a.Kills != b.Kills {
			return a.Kills > b.Kills
		}
		if a.Score != b.Score {
			return a.Score > b.Score
		}
		if a.Deaths != b.Deaths {
			return a.Deaths < b.Deaths
		}
		return a.ID < b.ID
	})
	return ps
}

func (r *Room) stepMatch() {
	switch r.state {
	case stateLive:
		if r.limitReached() || r.k >= r.endTick {
			r.endMatch()
		}
	case stateEnded:
		if r.k >= r.interEnd {
			r.beginMatch()
		}
	}
}

func (r *Room) endMatch() {
	r.state = stateEnded
	r.interEnd = r.k + r.ticks(r.g.Rules.Rooms.IntermissionSec)
	wt, wp := 0, 0
	if r.Mode.Teams {
		if r.ts[1] > r.ts[2] {
			wt = 1
		} else if r.ts[2] > r.ts[1] {
			wt = 2
		}
	} else if rk := r.ffaRanking(); len(rk) > 0 {
		wp = rk[0].ID
	}
	// next map: random from the mode's maps, excluding the current one when possible
	var opts []string
	for _, m := range r.Mode.Maps {
		if m != r.MapID {
			opts = append(opts, m)
		}
	}
	if len(opts) == 0 {
		opts = r.Mode.Maps
	}
	r.nextMap = opts[r.rng.IntN(len(opts))]
	r.projs = r.projs[:0]
	for t := 1; t <= 2; t++ {
		r.eggs[t] = egg{pos: r.nests[t]}
	}
	for _, p := range r.players {
		p.Carrying = 0
		if s := r.mgr.Stats; s != nil && p.client != nil {
			won := (wt != 0 && p.Team == wt) || (wp != 0 && p.ID == wp)
			r.bankScore(p)
			s.AddMatch(p.Name, won)
		}
	}
	r.all(mustJSON(endMsg{T: "end", Wt: wt, Wp: wp, In: r.g.Rules.Rooms.IntermissionSec, Next: r.nextMap,
		Sb: sbJSON{P: r.sbRows(), Ts: r.teamScores()}}))
}

func (r *Room) beginMatch() {
	r.loadMap(r.nextMap)
	r.resetMatch()
	r.rebalance()
	r.all(mustJSON(startMsg{T: "start", Mode: r.Mode.ID, Map: r.MapID, Tl: r.timeLeft(), Ts: r.teamScores(),
		Limit: r.Mode.ScoreLimit, Pk: r.pkString(), O: json.RawMessage(r.objJSON())}))
	for _, p := range r.players {
		if p.client != nil {
			p.client.queued = p.client.queued[:0]
		}
		if p.bot != nil {
			p.bot.queue = p.bot.queue[:0]
		}
		p.Alive = false
		for i := range p.hist {
			p.hist[i].tick = -1
		}
	}
	for _, p := range r.players {
		r.spawn(p)
	}
	r.sbDirty = true
}

// rebalance moves the most recently joined player of the bigger team while
// the teams differ by more than one.
func (r *Room) rebalance() {
	if !r.Mode.Teams {
		return
	}
	for {
		var n [3]int
		for _, p := range r.players {
			n[p.Team]++
		}
		big, small := 1, 2
		if n[2] > n[1] {
			big, small = 2, 1
		}
		if n[big]-n[small] <= 1 {
			return
		}
		for i := len(r.players) - 1; i >= 0; i-- {
			if p := r.players[i]; p.Team == big {
				p.Team = small
				r.all(mustJSON(rosterMsg{T: "pu", P: r.roster(p)}))
				break
			}
		}
	}
}
