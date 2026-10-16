package game

import (
	"math"
	"sort"

	"yolkout/server/internal/data"
	"yolkout/server/internal/sim"
)

// applyInput records an input's aim state and simulates it when allowed.
func (r *Room) applyInput(p *Player, in *sim.Input, live bool) {
	if math.IsNaN(in.Rt) {
		in.Rt = float64(r.k)
	}
	r.simulate(p, in, live)
}

// simulate runs one input for p (if alive and the match is live) and
// resolves its weapon actions.
func (r *Room) simulate(p *Player, in *sim.Input, live bool) {
	p.Yaw = in.Yaw
	p.Pitch = sim.ClampPitch(r.C, in.Pitch)
	// inputs sent while dead must not change the loadout picked at respawn
	if p.Alive && (in.Slot == 0 || in.Slot == 1) {
		p.Slot = in.Slot
	}
	p.Btns = in.Buttons
	if !p.Alive || !live {
		return
	}
	r.acts = sim.SimulateInput(r.acts[:0], r.World, r.C, p.Defs, &p.PS, &p.WS, in)
	for i := range r.acts {
		a := r.acts[i]
		switch a.A {
		case sim.ActFire:
			p.ProtUntil = 0
			p.fired = true
			r.fire(p, in, &a)
		case sim.ActMelee:
			// the swing starts: others see it now, the hit resolves on meleeHit after the windup
			p.ProtUntil = 0
			r.except(p.ID, mustJSON(meleeMsg{T: "melee", ID: p.ID, W: p.Defs.Melee.ID}))
		case sim.ActMeleeHit:
			r.meleeHit(p, in)
		case sim.ActGrenade:
			p.ProtUntil = 0
			p.threw = true
			r.throwGrenade(p, in)
		}
		if !p.Alive { // e.g. killed by own explosion
			return
		}
	}
}

func (p *Player) eye(C *sim.Consts) [3]float64 {
	return [3]float64{p.PS.X, p.PS.Y + C.EyeHeight, p.PS.Z}
}

func (p *Player) dmgMul(r *Room) float64 {
	if p != nil && p.FuryUntil > r.k {
		for _, s := range r.g.Rules.Streaks {
			if s.ID == "fury" && s.DmgMul > 0 {
				return s.DmgMul
			}
		}
		return 1.5
	}
	return 1
}

func (r *Room) enemies(a, b *Player) bool {
	if a.ID == b.ID {
		return false
	}
	if r.Mode.Teams && !r.g.Rules.Combat.FriendlyFire && a.Team == b.Team {
		return false
	}
	return true
}

type target struct {
	p       *Player
	x, y, z float64
}

// rewound returns the lag-compensated positions of every eligible target
// for a shooter whose input was sampled at render tick rt (PROTOCOL.md 9.3).
func (r *Room) rewound(shooter *Player, rt float64) []target {
	lo := float64(r.k - int64(r.g.Rules.Net.MaxRewindTicks))
	if lo < float64(r.k-int64(len(shooter.hist))+1) {
		lo = float64(r.k - int64(len(shooter.hist)) + 1)
	}
	lo = math.Max(0, lo)
	rt = math.Max(lo, math.Min(float64(r.k), rt))
	f := int64(math.Floor(rt))
	c := int64(math.Ceil(rt))
	frac := rt - float64(f)
	out := make([]target, 0, len(r.players))
	for _, p := range r.players {
		if !p.Alive || !r.enemies(shooter, p) {
			continue
		}
		a, okA := r.posAt(p, f)
		b, okB := r.posAt(p, c)
		if !okA || !okB || !a.alive || !b.alive {
			continue
		}
		out = append(out, target{p: p, x: a.x + (b.x-a.x)*frac, y: a.y + (b.y-a.y)*frac, z: a.z + (b.z-a.z)*frac})
	}
	return out
}

func (r *Room) posAt(p *Player, j int64) (histEntry, bool) {
	if j >= r.k {
		return histEntry{tick: j, x: p.PS.X, y: p.PS.Y, z: p.PS.Z, alive: p.Alive}, true
	}
	return p.histAt(j)
}

type pelletDamage struct {
	p    *Player
	sum  float64
	zone int // best zone over this victim's pellets (smallest non-zero id: head > body > arm > leg)
}

func (r *Room) fire(p *Player, in *sim.Input, a *sim.Action) {
	w := p.Defs.W[a.Slot]
	r.dirs = sim.ShotDirs(r.dirs[:0], uint32(p.ID), in.Seq, in.Yaw, a.Pitch, a.Spread, a.Pellets)
	o := p.eye(r.C)
	if w.Kind == "projectile" && w.Projectile != nil {
		d := r.dirs[0]
		r.launch(p, w.ID, w.Projectile, w.Damage, o, d, 0.6, [3]float64{d[0] * w.Projectile.Speed, d[1] * w.Projectile.Speed, d[2] * w.Projectile.Speed})
		return
	}
	targets := r.rewound(p, in.Rt)
	var hits []pelletDamage
	shot := make([]byte, 0, 64+len(r.dirs)*40)
	shot = append(shot, `{"t":"shot","id":`...)
	shot = appendInt(shot, p.ID)
	shot = append(shot, `,"w":`...)
	shot = appendString(shot, w.ID)
	shot = append(shot, `,"o":[`...)
	shot = appendQ(shot, o[0], 2)
	shot = append(shot, ',')
	shot = appendQ(shot, o[1], 2)
	shot = append(shot, ',')
	shot = appendQ(shot, o[2], 2)
	shot = append(shot, `],"e":[`...)
	for i, d := range r.dirs {
		tw := sim.RaycastWorld(r.World, o[0], o[1], o[2], d[0], d[1], d[2], w.Range)
		limit := w.Range
		if tw >= 0 {
			limit = tw
		}
		best, bt := -1, limit
		for ti := range targets {
			t := &targets[ti]
			if th := sim.RayEgg(r.C, o[0], o[1], o[2], d[0], d[1], d[2], t.x, t.y, t.z, bt, 0); th >= 0 && (best < 0 || th < bt) {
				best, bt = ti, th
			}
		}
		h, end, zone := 0, w.Range, 0
		if best >= 0 {
			h, end = 2, bt
			t := &targets[best]
			hx, hy, hz := o[0]+float64(d[0]*bt), o[1]+float64(d[1]*bt), o[2]+float64(d[2]*bt)
			zone = sim.HitZone(r.C, hx, hy, hz, t.x, t.y, t.z, d[0], d[2])
			dmg := float64(float64(sim.FalloffDamage(w, bt)*sim.ZoneMul(w, zone)) * p.dmgMul(r))
			found := false
			for k := range hits {
				if hits[k].p == t.p {
					hits[k].sum += dmg
					hits[k].zone = min(hits[k].zone, zone)
					found = true
				}
			}
			if !found {
				hits = append(hits, pelletDamage{p: t.p, sum: dmg, zone: zone})
			}
		} else if tw >= 0 {
			h, end = 1, tw
		}
		if i > 0 {
			shot = append(shot, ',')
		}
		shot = append(shot, '[')
		shot = appendQ(shot, o[0]+d[0]*end, 2)
		shot = append(shot, ',')
		shot = appendQ(shot, o[1]+d[1]*end, 2)
		shot = append(shot, ',')
		shot = appendQ(shot, o[2]+d[2]*end, 2)
		shot = append(shot, ',')
		shot = appendInt(shot, h)
		if h == 2 {
			shot = append(shot, ',')
			shot = appendInt(shot, zone)
		}
		shot = append(shot, ']')
	}
	shot = append(shot, "]}"...)
	r.except(p.ID, shot)
	sort.Slice(hits, func(i, j int) bool { return hits[i].p.ID < hits[j].p.ID })
	for _, h := range hits {
		if h.p.protected(r.k) {
			continue
		}
		dmg := int(math.Floor(h.sum + 0.5))
		if dmg < 1 {
			dmg = 1
		}
		r.damage(h.p, p.ID, dmg, h.zone, w.ID, o)
		if !p.Alive {
			return
		}
	}
}

// meleeHit resolves a melee swing once its windup has elapsed, with this
// input's aim, render tick and post-movement eye (PROTOCOL.md 9.3).
func (r *Room) meleeHit(p *Player, in *sim.Input) {
	m := p.Defs.Melee
	o := p.eye(r.C)
	d := sim.AimDir(in.Yaw, p.Pitch)
	tw := sim.RaycastWorld(r.World, o[0], o[1], o[2], d[0], d[1], d[2], m.Range)
	limit := m.Range
	if tw >= 0 {
		limit = tw
	}
	var victim *Player
	var vt target
	for _, t := range r.rewound(p, in.Rt) {
		if th := sim.RayEgg(r.C, o[0], o[1], o[2], d[0], d[1], d[2], t.x, t.y, t.z, limit, m.Inflate); th >= 0 && th <= limit {
			victim, vt, limit = t.p, t, th
		}
	}
	if victim == nil || victim.protected(r.k) {
		return
	}
	zone := sim.MeleeZone(r.C, o[0], o[1], o[2], d[0], d[1], d[2], vt.x, vt.y, vt.z)
	r.damage(victim, p.ID, int(math.Floor(float64(float64(m.Damage*sim.ZoneMul(m, zone))*p.dmgMul(r))+0.5)), zone, m.ID, o)
	if K := m.Knockback; K > 0 && victim.Alive && !victim.protected(r.k) {
		kx, kz := victim.PS.X-p.PS.X, victim.PS.Z-p.PS.Z
		l := math.Sqrt(kx*kx + kz*kz)
		if l < 1e-6 {
			kx, kz, l = -math.Sin(in.Yaw), -math.Cos(in.Yaw), 1
		}
		kx, kz = kx/l, kz/l
		victim.PS.VX += kx * K
		victim.PS.VZ += kz * K
		victim.PS.VY += K * r.g.Rules.Combat.MeleeKnockUp
		victim.PS.OnGround = false
		victim.PS.Coy = 0
	}
}

func (r *Room) throwGrenade(p *Player, in *sim.Input) {
	gd := p.Defs.Grenade
	d := sim.AimDir(in.Yaw, p.Pitch)
	v := [3]float64{
		d[0]*gd.ThrowSpeed + p.PS.VX*gd.InheritVel,
		d[1]*gd.ThrowSpeed + gd.ThrowUp + p.PS.VY*gd.InheritVel,
		d[2]*gd.ThrowSpeed + p.PS.VZ*gd.InheritVel,
	}
	r.launch(p, gd.ID, gd.Projectile, gd.Damage, p.eye(r.C), d, 0.5, v)
}

// launch spawns a projectile at eye+dir*off, or explodes it at once if a
// wall is closer than off.
func (r *Room) launch(p *Player, weapon string, def *data.ProjectileDef, damage float64, eye, d [3]float64, off float64, v [3]float64) {
	pr := &proj{weapon: weapon, damage: damage, splash: def.SplashRadius, knockback: def.Knockback, team: p.Team}
	id := r.nextPrID
	r.nextPrID++
	if t := sim.RaycastWorld(r.World, eye[0], eye[1], eye[2], d[0], d[1], d[2], off); t >= 0 {
		pr.Projectile = sim.NewProjectile(id, p.ID, def, eye[0], eye[1], eye[2], 0, 0, 0)
		r.explode(pr, [3]float64{eye[0] + d[0]*t, eye[1] + d[1]*t, eye[2] + d[2]*t})
		return
	}
	pr.Projectile = sim.NewProjectile(id, p.ID, def, eye[0]+d[0]*off, eye[1]+d[1]*off, eye[2]+d[2]*off, v[0], v[1], v[2])
	r.projs = append(r.projs, pr)
}

// stepProjectiles advances projectiles in creation order (PROTOCOL.md 9.4).
func (r *Room) stepProjectiles() {
	dt := r.C.Dt
	keep := r.projs[:0]
	list := r.projs
	r.projs = nil // explosions never add projectiles, but keep iteration safe
	for _, pr := range list {
		if pr.Kind == 1 {
			vy := pr.VY - pr.Gravity*dt
			sx, sy, sz := pr.VX*dt, vy*dt, pr.VZ*dt
			l := math.Sqrt(sx*sx + sy*sy + sz*sz)
			if l > 0 {
				dx, dy, dz := sx/l, sy/l, sz/l
				tw := sim.RaycastWorld(r.World, pr.X, pr.Y, pr.Z, dx, dy, dz, l)
				lim := l
				if tw >= 0 {
					lim = tw
				}
				hitT := -1.0
				for _, p := range r.players {
					if !p.Alive || p.ID == pr.Owner {
						continue
					}
					if t := sim.RayEgg(r.C, pr.X, pr.Y, pr.Z, dx, dy, dz, p.PS.X, p.PS.Y, p.PS.Z, lim, pr.Radius); t >= 0 && (hitT < 0 || t < hitT) {
						hitT = t
						lim = t
					}
				}
				if hitT >= 0 && (tw < 0 || hitT < tw) {
					r.explode(pr, [3]float64{pr.X + dx*hitT, pr.Y + dy*hitT, pr.Z + dz*hitT})
					continue
				}
			}
		}
		if ex, at := sim.StepProjectile(r.World, pr.Projectile, dt); ex {
			r.explode(pr, at)
			continue
		}
		keep = append(keep, pr)
	}
	r.projs = append(keep, r.projs...)
}

// explode resolves splash damage and knockback at E.
func (r *Room) explode(pr *proj, E [3]float64) {
	R := pr.splash
	r.all(mustJSON(boomMsg{T: "boom", ID: pr.ID, K: pr.Kind, O: pr.Owner, X: q(E[0], 2), Y: q(E[1], 2), Z: q(E[2], 2), R: R}))
	owner := r.byID(pr.Owner)
	ownerMul := owner.dmgMul(r)
	if owner == nil {
		ownerMul = 1
	}
	cb := r.g.Rules.Combat
	type dmgHit struct {
		p   *Player
		dmg int
	}
	var hits []dmgHit
	for _, p := range r.players {
		if !p.Alive {
			continue
		}
		if r.Mode.Teams && !cb.FriendlyFire && p.ID != pr.Owner && p.Team == pr.team {
			continue
		}
		c := [3]float64{p.PS.X, p.PS.Y + r.C.HitCenterY, p.PS.Z}
		dx, dy, dz := c[0]-E[0], c[1]-E[1], c[2]-E[2]
		d := math.Sqrt(dx*dx + dy*dy + dz*dz)
		if d >= R {
			continue
		}
		n := [3]float64{0, 1, 0}
		if d >= 1e-6 {
			n = [3]float64{dx / d, dy / d, dz / d}
			if sim.RaycastWorld(r.World, E[0], E[1], E[2], n[0], n[1], n[2], d) >= 0 {
				ey := p.PS.Y + r.C.EyeHeight
				ex, eyy, ez := p.PS.X-E[0], ey-E[1], p.PS.Z-E[2]
				de := math.Sqrt(ex*ex + eyy*eyy + ez*ez)
				if de < 1e-6 {
					// eye at the explosion centre: visible
				} else if sim.RaycastWorld(r.World, E[0], E[1], E[2], ex/de, eyy/de, ez/de, de) >= 0 {
					continue
				}
			}
		}
		if p.protected(r.k) {
			continue
		}
		s := sim.SplashScale(R, d)
		self := 1.0
		if p.ID == pr.Owner {
			self = cb.SelfSplashMul
		}
		dmg := int(math.Floor(pr.damage*s*self*ownerMul + 0.5))
		p.PS.VX += n[0] * pr.knockback * s
		p.PS.VY += n[1]*pr.knockback*s + cb.KnockbackUp*s
		p.PS.VZ += n[2] * pr.knockback * s
		p.PS.OnGround = false
		p.PS.Coy = 0
		if dmg >= 1 {
			hits = append(hits, dmgHit{p, dmg})
		}
	}
	for _, h := range hits {
		killer := pr.Owner
		if owner == nil {
			killer = 0
		}
		r.damage(h.p, killer, h.dmg, sim.ZoneNone, pr.weapon, E)
	}
}

// damage applies damage per PROTOCOL.md 9.5. zone is the hit zone (0 for
// splash and falls; 1 = head counts as a headshot). src is the hit source position.
func (r *Room) damage(v *Player, attacker int, dmg int, zone int, weapon string, src [3]float64) {
	if !v.Alive || v.protected(r.k) || r.state != stateLive {
		return
	}
	absorb := min(v.SH, dmg)
	v.SH -= absorb
	v.HP -= float64(dmg - absorb)
	v.LastDamageTick = r.k
	hs := zone == sim.ZoneHead
	msg := mustJSON(hitMsg{T: "hit", A: attacker, V: v.ID, D: dmg, Hs: b2i(hs), Z: zone, Hp: v.wireHPAfter(), Sh: v.SH, W: weapon,
		Ax: q(src[0], 2), Ay: q(src[1], 2), Az: q(src[2], 2)})
	r.to(v, msg)
	if attacker != v.ID {
		r.to(r.byID(attacker), msg)
	}
	if v.HP <= 0 {
		r.kill(v, attacker, weapon, zone)
	}
}

func (p *Player) wireHPAfter() int { return int(math.Max(0, math.Ceil(p.HP))) }

// kill handles a death (PROTOCOL.md 9.5 and 10.4).
func (r *Room) kill(v *Player, killerID int, weapon string, zone int) {
	if !v.Alive {
		return
	}
	hs := zone == sim.ZoneHead
	wasCarrier := v.Carrying != 0
	v.Alive = false
	v.HP = 0
	v.Deaths++
	v.Streak = 0
	v.RespawnAt = r.k + r.ticks(r.Mode.RespawnSec)
	if wasCarrier {
		r.dropEgg(v)
	}
	killer := r.byID(killerID)
	if killer == nil && killerID != v.ID {
		killerID = 0
	}
	st := 0
	pts := r.Mode.Points
	if killer != nil && killer != v {
		killer.Kills++
		killer.Streak++
		killer.BestStreak = max(killer.BestStreak, killer.Streak)
		killer.Score += pts["kill"]
		if hs {
			killer.Score += pts["headshotBonus"]
			killer.Headshots++
		}
		if r.Mode.Teams && r.Mode.Objective != "nest" && killer.Team != v.Team {
			r.ts[killer.Team]++
		}
		if wasCarrier && r.Mode.Objective == "nest" {
			killer.Score += pts["carrierKill"]
		}
		st = killer.Streak
	}
	r.all(mustJSON(killMsg{T: "kill", K: killerID, V: v.ID, W: weapon, Hs: b2i(hs), Z: zone, St: st, Rs: r.Mode.RespawnSec}))
	if killer != nil && killer != v {
		r.streakRewards(killer)
		if s := r.mgr.Stats; s != nil && killer.client != nil {
			s.AddKill(killer.Name, hs, killer.Streak)
		}
	}
	if s := r.mgr.Stats; s != nil && v.client != nil {
		s.AddDeath(v.Name)
	}
	r.sbDirty = true
}

func (r *Room) streakRewards(p *Player) {
	for _, s := range r.g.Rules.Streaks {
		if p.Streak != s.At {
			continue
		}
		switch s.ID {
		case "refill":
			w := p.Defs.W[0]
			p.WS.Mag[0] = w.MagSize
			p.WS.Res[0] = w.Reserve
			p.WS.Gren = min(p.Defs.Grenade.MaxCount, p.WS.Gren+1)
		case "shell":
			p.SH = int(r.g.Rules.Combat.MaxShield)
		case "fury":
			p.FuryUntil = r.k + r.ticks(s.Duration)
		}
		p.Score += r.Mode.Points["streakBonus"]
		r.all(mustJSON(streakMsg{T: "streak", ID: p.ID, N: p.Streak, R: s.ID}))
	}
}
