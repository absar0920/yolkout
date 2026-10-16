// Package sim is the Go port of shared/ref/sim.mjs: movement and collision,
// the weapon state machine, deterministic spread, rays and projectiles.
//
// It must stay line-for-line equivalent to the JavaScript reference and pass
// shared/testvectors/*.json. Arithmetic order matches the JS exactly. Every
// product that the compiler could fuse into an FMA (a*b+c) is wrapped in an
// explicit float64(...) conversion, which the Go spec guarantees rounds, so
// results are identical on amd64 and arm64.
package sim

import (
	"math"

	"yolkout/server/internal/data"
)

// Key bits.
const (
	KeyFwd   = 1
	KeyBack  = 2
	KeyLeft  = 4
	KeyRight = 8
	KeyJump  = 16
)

// Button bits.
const (
	BtnFire    = 1
	BtnAim     = 2
	BtnReload  = 4
	BtnGrenade = 8
	BtnMelee   = 16
)

// Hit zones (ZONE in sim.mjs). 0 = none (splash, fall).
const (
	ZoneNone = 0
	ZoneHead = 1
	ZoneBody = 2
	ZoneArm  = 3
	ZoneLeg  = 4
)

// Consts is the flattened constant bag (makeConsts in sim.mjs).
type Consts struct {
	Dt                   float64
	HalfWidth            float64
	Height               float64
	EyeHeight            float64
	HitCenterY           float64
	HitRadii             [3]float64
	HeadshotY            float64
	LegY                 float64
	ArmLat               float64
	MaxPitch             float64
	MoveSpeed            float64
	GroundAccel          float64
	GroundDecel          float64
	AirAccel             float64
	Gravity              float64
	JumpVelocity         float64
	TerminalVelocity     float64
	MaxHorizontalSpeed   float64
	StepHeight           float64
	AdsMoveMul           float64
	Eps                  float64
	MovingSpeedThreshold float64
	CoyoteTicks          int
}

// MakeConsts flattens rules.json.
func MakeConsts(r *data.Rules) *Consts {
	return &Consts{
		Dt:        1 / float64(r.Net.TickRate),
		HalfWidth: r.Player.HalfWidth, Height: r.Player.Height, EyeHeight: r.Player.EyeHeight,
		HitCenterY: r.Player.HitCenterY, HitRadii: r.Player.HitRadii, HeadshotY: r.Player.HeadshotY, MaxPitch: r.Player.MaxPitch,
		LegY: r.Player.LegY, ArmLat: r.Player.ArmLat,
		MoveSpeed: r.Move.MoveSpeed, GroundAccel: r.Move.GroundAccel, GroundDecel: r.Move.GroundDecel, AirAccel: r.Move.AirAccel,
		Gravity: r.Move.Gravity, JumpVelocity: r.Move.JumpVelocity, TerminalVelocity: r.Move.TerminalVelocity,
		MaxHorizontalSpeed: r.Move.MaxHorizontalSpeed, StepHeight: r.Move.StepHeight, AdsMoveMul: r.Move.AdsMoveMul,
		Eps: r.Move.Eps, MovingSpeedThreshold: r.Combat.MovingSpeedThreshold, CoyoteTicks: r.Move.CoyoteTicks,
	}
}

// mul returns a*b rounded to float64 (blocks FMA fusion).
func mul(a, b float64) float64 { return float64(a * b) }

// ---------------------------------------------------------------- world

// World is the collision world: flat [minx,miny,minz,maxx,maxy,maxz]* boxes.
type World struct {
	Boxes     []float64
	Count     int
	BoundsMin [3]float64
	BoundsMax [3]float64
}

// MakeWorld builds the collision world from a map: every solid box followed
// by 4 implicit boundary walls just outside bounds.
func MakeWorld(m *data.Map) *World {
	w := &World{BoundsMin: m.Bounds.Min, BoundsMax: m.Bounds.Max}
	for _, b := range m.Boxes {
		if b.Solid != nil && !*b.Solid {
			continue
		}
		w.Boxes = append(w.Boxes, b.Min[0], b.Min[1], b.Min[2], b.Max[0], b.Max[1], b.Max[2])
	}
	bn, bx := m.Bounds.Min, m.Bounds.Max
	w.Boxes = append(w.Boxes,
		bn[0]-1, bn[1], bn[2]-1, bn[0], bx[1], bx[2]+1, // -X
		bx[0], bn[1], bn[2]-1, bx[0]+1, bx[1], bx[2]+1, // +X
		bn[0]-1, bn[1], bn[2]-1, bx[0]+1, bx[1], bn[2], // -Z
		bn[0]-1, bn[1], bx[2], bx[0]+1, bx[1], bx[2]+1, // +Z
	)
	w.Count = len(w.Boxes) / 6
	return w
}

// ---------------------------------------------------------------- movement

// PlayerState is the physics state of one player. Coy is the coyote-time
// counter: a jump is still allowed while Coy > 0 after leaving the ground.
type PlayerState struct {
	X, Y, Z    float64
	VX, VY, VZ float64
	OnGround   bool
	Coy        int
}

// ClipAxis returns the largest movement along axis (0=x,1=y,2=z) not
// exceeding delta such that the player AABB does not enter a solid.
func ClipAxis(w *World, C *Consts, st *PlayerState, axis int, delta float64) float64 {
	if delta == 0 {
		return 0
	}
	hw, e, B, n := C.HalfWidth, C.Eps, w.Boxes, w.Count
	pmin := [3]float64{st.X - hw, st.Y, st.Z - hw}
	pmax := [3]float64{st.X + hw, st.Y + C.Height, st.Z + hw}
	o1, o2 := (axis+1)%3, (axis+2)%3
	positive := delta > 0
	for i := 0; i < n; i++ {
		o := i * 6
		if !(pmin[o1] < B[o+3+o1]-e && pmax[o1] > B[o+o1]+e) {
			continue
		}
		if !(pmin[o2] < B[o+3+o2]-e && pmax[o2] > B[o+o2]+e) {
			continue
		}
		if positive {
			bmin := B[o+axis]
			if bmin >= pmax[axis]-e {
				if d := bmin - pmax[axis]; d < delta {
					delta = d
				}
			}
		} else {
			bmax := B[o+3+axis]
			if bmax <= pmin[axis]+e {
				if d := bmax - pmin[axis]; d > delta {
					delta = d
				}
			}
		}
	}
	if positive {
		if delta < 0 {
			delta = 0
		}
	} else if delta > 0 {
		delta = 0
	}
	return delta
}

// OverlapsSolid reports whether the player AABB at (x,y,z) overlaps a solid.
func OverlapsSolid(w *World, C *Consts, x, y, z float64) bool {
	hw, e, B := C.HalfWidth, C.Eps, w.Boxes
	for i := 0; i < w.Count; i++ {
		o := i * 6
		if x-hw < B[o+3]-e && x+hw > B[o]+e &&
			y < B[o+4]-e && y+C.Height > B[o+1]+e &&
			z-hw < B[o+5]-e && z+hw > B[o+2]+e {
			return true
		}
	}
	return false
}

func b2f(b bool) float64 {
	if b {
		return 1
	}
	return 0
}

// StepMove advances one fixed tick of movement (stepMove in sim.mjs).
func StepMove(w *World, C *Consts, st *PlayerState, keys int, yaw, speedMul float64) {
	dt := C.Dt
	sy, cy := math.Sin(yaw), math.Cos(yaw)
	mz := b2f(keys&KeyFwd != 0) - b2f(keys&KeyBack != 0)
	mx := b2f(keys&KeyRight != 0) - b2f(keys&KeyLeft != 0)
	wx := mul(-sy, mz) + mul(cy, mx)
	wz := mul(-cy, mz) - mul(sy, mx)
	length := math.Sqrt(mul(wx, wx) + mul(wz, wz))
	if length > 0 {
		wx = wx / length
		wz = wz / length
	}
	speed := mul(C.MoveSpeed, speedMul)

	if st.OnGround {
		acc := C.GroundDecel
		if length > 0 {
			acc = C.GroundAccel
		}
		k := math.Min(1, mul(acc, dt))
		st.VX += mul(mul(wx, speed)-st.VX, k)
		st.VZ += mul(mul(wz, speed)-st.VZ, k)
	} else if length > 0 {
		k := math.Min(1, mul(C.AirAccel, dt))
		st.VX += mul(mul(wx, speed)-st.VX, k)
		st.VZ += mul(mul(wz, speed)-st.VZ, k)
	}
	hs := math.Sqrt(mul(st.VX, st.VX) + mul(st.VZ, st.VZ))
	if hs > C.MaxHorizontalSpeed {
		f := C.MaxHorizontalSpeed / hs
		st.VX = mul(st.VX, f)
		st.VZ = mul(st.VZ, f)
	}

	if keys&KeyJump != 0 && (st.OnGround || st.Coy > 0) {
		st.VY = C.JumpVelocity
		st.OnGround = false
		st.Coy = 0
	}

	st.VY -= mul(C.Gravity, dt)
	if st.VY < -C.TerminalVelocity {
		st.VY = -C.TerminalVelocity
	}

	canStep := st.OnGround
	dx, dz := mul(st.VX, dt), mul(st.VZ, dt)

	sx, sy0, sz := st.X, st.Y, st.Z
	ax := ClipAxis(w, C, st, 0, dx)
	st.X += ax
	az := ClipAxis(w, C, st, 2, dz)
	st.Z += az

	if canStep && (ax != dx || az != dz) {
		x1, y1, z1 := st.X, st.Y, st.Z
		st.X, st.Y, st.Z = sx, sy0, sz
		up := ClipAxis(w, C, st, 1, C.StepHeight)
		st.Y += up
		bx := ClipAxis(w, C, st, 0, dx)
		st.X += bx
		bz := ClipAxis(w, C, st, 2, dz)
		st.Z += bz
		down := ClipAxis(w, C, st, 1, -up)
		st.Y += down
		if mul(bx, bx)+mul(bz, bz) > mul(ax, ax)+mul(az, az)+1e-12 {
			ax, az = bx, bz
		} else {
			st.X, st.Y, st.Z = x1, y1, z1
		}
	}
	if ax != dx {
		st.VX = 0
	}
	if az != dz {
		st.VZ = 0
	}

	dy := mul(st.VY, dt)
	ay := ClipAxis(w, C, st, 1, dy)
	st.Y += ay
	if ay != dy {
		st.OnGround = dy < 0
		st.VY = 0
	} else if canStep && st.VY <= 0 {
		sd := ClipAxis(w, C, st, 1, -C.StepHeight)
		if sd != -C.StepHeight {
			st.Y += sd
			st.OnGround = true
			st.VY = 0
		} else {
			st.OnGround = false
		}
	} else {
		st.OnGround = false
	}
	switch {
	case st.OnGround:
		st.Coy = C.CoyoteTicks
	case st.Coy > 0:
		st.Coy--
	default:
		st.Coy = 0
	}
}

// ---------------------------------------------------------------- RNG / aim

// Mulberry32 is the mulberry32 PRNG.
type Mulberry32 struct{ a uint32 }

// NewMulberry32 seeds a generator.
func NewMulberry32(seed uint32) *Mulberry32 { return &Mulberry32{a: seed} }

// Next returns a float in [0,1).
func (m *Mulberry32) Next() float64 {
	m.a += 0x6D2B79F5
	a := m.a
	t := (a ^ (a >> 15)) * (1 | a)
	t = (t + (t^(t>>7))*(61|t)) ^ t
	return float64(t^(t>>14)) / 4294967296
}

// ShotSeed is the per-pellet seed.
func ShotSeed(pid, seq uint32, pellet int) uint32 {
	return (seq * 0x9E3779B1) ^ (pid * 0x85EBCA77) ^ (uint32(pellet+1) * 0xC2B2AE3D)
}

// AimDir is the unit aim vector from yaw/pitch.
func AimDir(yaw, pitch float64) [3]float64 {
	cp := math.Cos(pitch)
	return [3]float64{mul(-math.Sin(yaw), cp), math.Sin(pitch), mul(-math.Cos(yaw), cp)}
}

// ShotDirs returns the pellet directions for one shot (appended to out).
func ShotDirs(out [][3]float64, pid, seq uint32, yaw, pitch, spread float64, pellets int) [][3]float64 {
	f := AimDir(yaw, pitch)
	R := [3]float64{math.Cos(yaw), 0, -math.Sin(yaw)}
	U := [3]float64{
		mul(R[1], f[2]) - mul(R[2], f[1]),
		mul(R[2], f[0]) - mul(R[0], f[2]),
		mul(R[0], f[1]) - mul(R[1], f[0]),
	}
	for i := 0; i < pellets; i++ {
		rng := NewMulberry32(ShotSeed(pid, seq, i))
		u1 := rng.Next()
		u2 := rng.Next()
		r := mul(spread, math.Sqrt(u1))
		th := mul(2*math.Pi, u2)
		a, b := mul(r, math.Cos(th)), mul(r, math.Sin(th))
		x := f[0] + mul(R[0], a) + mul(U[0], b)
		y := f[1] + mul(R[1], a) + mul(U[1], b)
		z := f[2] + mul(R[2], a) + mul(U[2], b)
		l := math.Sqrt(mul(x, x) + mul(y, y) + mul(z, z))
		out = append(out, [3]float64{x / l, y / l, z / l})
	}
	return out
}

// ---------------------------------------------------------------- rays

// RayBox is the slab test: entry t in [0,tmax] or -1.
func RayBox(ox, oy, oz, dx, dy, dz float64, B []float64, o int, tmax float64) float64 {
	t0, t1 := 0.0, tmax
	org := [3]float64{ox, oy, oz}
	dir := [3]float64{dx, dy, dz}
	for a := 0; a < 3; a++ {
		mn, mx, d, p := B[o+a], B[o+3+a], dir[a], org[a]
		if d == 0 {
			if p < mn || p > mx {
				return -1
			}
			continue
		}
		ta, tb := (mn-p)/d, (mx-p)/d
		if ta > tb {
			ta, tb = tb, ta
		}
		if ta > t0 {
			t0 = ta
		}
		if tb < t1 {
			t1 = tb
		}
		if t0 > t1 {
			return -1
		}
	}
	return t0
}

// RaycastWorld returns the nearest solid hit t within tmax, or -1.
func RaycastWorld(w *World, ox, oy, oz, dx, dy, dz, tmax float64) float64 {
	best := -1.0
	for i := 0; i < w.Count; i++ {
		lim := tmax
		if best >= 0 {
			lim = best
		}
		t := RayBox(ox, oy, oz, dx, dy, dz, w.Boxes, i*6, lim)
		if t >= 0 && (best < 0 || t < best) {
			best = t
		}
	}
	return best
}

// RayEgg tests a ray against the egg ellipsoid of a player at feet (px,py,pz).
func RayEgg(C *Consts, ox, oy, oz, dx, dy, dz, px, py, pz, tmax, inflate float64) float64 {
	rx, ry, rz := C.HitRadii[0]+inflate, C.HitRadii[1]+inflate, C.HitRadii[2]+inflate
	qx, qy, qz := (ox-px)/rx, (oy-(py+C.HitCenterY))/ry, (oz-pz)/rz
	ex, ey, ez := dx/rx, dy/ry, dz/rz
	a := mul(ex, ex) + mul(ey, ey) + mul(ez, ez)
	b := mul(2, mul(qx, ex)+mul(qy, ey)+mul(qz, ez))
	c := mul(qx, qx) + mul(qy, qy) + mul(qz, qz) - 1
	if c <= 0 {
		return 0
	}
	disc := mul(b, b) - mul(mul(4, a), c)
	if disc < 0 {
		return -1
	}
	t := (-b - math.Sqrt(disc)) / mul(2, a)
	if t < 0 || t > tmax {
		return -1
	}
	return t
}

// HitZone is the zone of a hit at (hx,hy,hz) on the egg standing at feet
// (px,py,pz), for a ray whose direction has horizontal part (dx,dz).
func HitZone(C *Consts, hx, hy, hz, px, py, pz, dx, dz float64) int {
	ly := hy - py
	if ly >= C.HeadshotY {
		return ZoneHead
	}
	if ly < C.LegY {
		return ZoneLeg
	}
	hl := math.Sqrt(mul(dx, dx) + mul(dz, dz))
	if hl > 1e-6 {
		lat := math.Abs(mul(hx-px, -dz/hl)+mul(hz-pz, dx/hl)) / C.HitRadii[0]
		if lat >= C.ArmLat {
			return ZoneArm
		}
	}
	return ZoneBody
}

// ZoneMul is the damage multiplier of a zone for w (melee: head bonus only).
func ZoneMul(w *data.Weapon, zone int) float64 {
	z := w.Zones
	if z == nil {
		if zone == ZoneHead && w.HeadMul != 0 { // a missing headMul (JSON null/absent) means 1, as in sim.mjs
			return w.HeadMul
		}
		return 1
	}
	switch zone {
	case ZoneHead:
		return z.Head
	case ZoneBody:
		return z.Body
	case ZoneArm:
		return z.Arm
	case ZoneLeg:
		return z.Leg
	}
	return 1
}

// FalloffDamage is one pellet's damage at distance d.
func FalloffDamage(w *data.Weapon, d float64) float64 {
	if d <= w.FalloffStart || w.FalloffEnd <= w.FalloffStart {
		return w.Damage
	}
	if d >= w.FalloffEnd {
		return w.MinDamage
	}
	f := (d - w.FalloffStart) / (w.FalloffEnd - w.FalloffStart)
	return w.Damage + mul(w.MinDamage-w.Damage, f)
}

// SplashScale is the splash damage/knockback scale (0..1).
func SplashScale(radius, d float64) float64 {
	if d >= radius {
		return 0
	}
	return 1 - d/radius
}

// ---------------------------------------------------------------- weapons

// Defs are the weapon definitions of one loadout.
type Defs struct {
	W       [2]*data.Weapon
	Grenade *data.Weapon
	Melee   *data.Weapon
}

// DefsFor resolves defs for a primary and a melee id (unknown ids use the defaults).
func DefsFor(wj *data.Weapons, primaryID, meleeID string) *Defs {
	p := wj.Weapons[primaryID]
	if p == nil {
		p = wj.Weapons[wj.DefaultPrimary]
	}
	var ml *data.Weapon
	for _, id := range wj.Melees {
		if id == meleeID {
			ml = wj.Weapons[id]
			break
		}
	}
	if ml == nil {
		def := wj.DefaultMelee
		if def == "" {
			def = wj.Melee
		}
		ml = wj.Weapons[def]
	}
	return &Defs{W: [2]*data.Weapon{p, wj.Weapons[wj.Secondary]}, Grenade: wj.Weapons[wj.Grenade], Melee: ml}
}

// WeaponState mirrors the JS weapon state object.
type WeaponState struct {
	Slot  int
	Mag   [2]int
	Res   [2]int
	Gren  int
	Cd    float64
	Rl    float64
	Sw    float64
	Bl    int
	Bloom float64
	Mt    float64
	Gt    float64
	Pb    int
	Mw    float64 // melee windup left
}

// NewWeaponState returns a fresh loadout state.
func NewWeaponState(d *Defs) WeaponState {
	return WeaponState{Mag: [2]int{d.W[0].MagSize, d.W[1].MagSize}, Res: [2]int{d.W[0].Reserve, d.W[1].Reserve}, Gren: d.Grenade.StartCount}
}

// Array returns the wire order [slot,mag0,mag1,res0,res1,gren,cd,rl,sw,bl,bloom,mt,gt,pb,mw].
func (ws *WeaponState) Array() [15]float64 {
	return [15]float64{float64(ws.Slot), float64(ws.Mag[0]), float64(ws.Mag[1]), float64(ws.Res[0]), float64(ws.Res[1]), float64(ws.Gren),
		ws.Cd, ws.Rl, ws.Sw, float64(ws.Bl), ws.Bloom, ws.Mt, ws.Gt, float64(ws.Pb), ws.Mw}
}

// Action kinds.
const (
	ActFire = iota + 1
	ActMelee
	ActGrenade
	ActReload
	ActSwitch
	ActMeleeHit
)

// ActName returns the test-vector name of an action kind.
func ActName(a int) string {
	switch a {
	case ActFire:
		return "fire"
	case ActMelee:
		return "melee"
	case ActGrenade:
		return "grenade"
	case ActReload:
		return "reload"
	case ActSwitch:
		return "switch"
	case ActMeleeHit:
		return "meleeHit"
	}
	return "?"
}

// Action is one weapon action emitted by WeaponTick.
type Action struct {
	A       int
	Slot    int
	Spread  float64
	Pellets int
	Pitch   float64 // set by SimulateInput for fire
}

func refill(ws *WeaponState, w *data.Weapon, s int) {
	need := w.MagSize - ws.Mag[s]
	take := need
	if ws.Res[s] >= 0 && ws.Res[s] < need {
		take = ws.Res[s]
	}
	ws.Mag[s] += take
	if ws.Res[s] >= 0 {
		ws.Res[s] -= take
	}
}

// WeaponTick runs one tick of weapon logic, appending actions to out.
func WeaponTick(out []Action, ws *WeaponState, buttons, slotReq int, defs *Defs, dt float64, moving bool) []Action {
	pressed := buttons &^ ws.Pb
	ws.Cd -= dt
	ws.Mt = math.Max(0, ws.Mt-dt)
	ws.Gt = math.Max(0, ws.Gt-dt)
	if ws.Mw > 0 {
		ws.Mw -= dt
		if ws.Mw <= 1e-9 {
			ws.Mw = 0
			out = append(out, Action{A: ActMeleeHit})
		}
	}

	if (slotReq == 0 || slotReq == 1) && slotReq != ws.Slot {
		ws.Slot = slotReq
		ws.Sw = defs.W[slotReq].SwitchTime
		ws.Rl = 0
		ws.Bl = 0
		out = append(out, Action{A: ActSwitch, Slot: slotReq})
	} else if ws.Sw > 0 {
		ws.Sw = math.Max(0, ws.Sw-dt)
	}
	s := ws.Slot
	w := defs.W[s]
	ws.Bloom = math.Max(0, ws.Bloom-mul(w.BloomRecover, dt))

	if ws.Rl > 0 {
		ws.Rl -= dt
		if ws.Rl <= 0 {
			ws.Rl = 0
			refill(ws, w, s)
		}
	}
	if pressed&BtnReload != 0 && ws.Rl == 0 && ws.Sw == 0 && ws.Mag[s] < w.MagSize && ws.Res[s] != 0 {
		ws.Rl = w.ReloadTime
		ws.Bl = 0
		out = append(out, Action{A: ActReload})
	}
	if pressed&BtnMelee != 0 && ws.Mt == 0 && ws.Sw == 0 {
		ws.Mt = defs.Melee.Cooldown
		ws.Mw = defs.Melee.Windup
		ws.Rl = 0
		ws.Bl = 0
		out = append(out, Action{A: ActMelee})
		if ws.Mw <= 1e-9 {
			ws.Mw = 0
			out = append(out, Action{A: ActMeleeHit})
		}
	}
	if pressed&BtnGrenade != 0 && ws.Gt == 0 && ws.Gren > 0 && ws.Sw == 0 {
		ws.Gren--
		ws.Gt = defs.Grenade.Cooldown
		out = append(out, Action{A: ActGrenade})
	}
	var want bool
	switch w.FireMode {
	case "auto":
		want = buttons&BtnFire != 0
	case "semi":
		want = pressed&BtnFire != 0
	default: // burst
		if pressed&BtnFire != 0 && ws.Bl == 0 && ws.Cd <= 0 {
			ws.Bl = w.BurstCount
		}
		want = ws.Bl > 0
	}
	fired := false
	if want && ws.Sw == 0 && ws.Rl == 0 && ws.Mt == 0 && ws.Cd <= 0 {
		if ws.Mag[s] == 0 {
			ws.Bl = 0
			if ws.Res[s] != 0 {
				ws.Rl = w.ReloadTime
				out = append(out, Action{A: ActReload})
			}
		} else {
			spread := w.HipSpread
			if buttons&BtnAim != 0 {
				spread = w.AdsSpread
			}
			mv := 0.0
			if moving {
				mv = w.MoveSpread
			}
			spread = spread + mv + ws.Bloom
			ws.Mag[s]--
			ws.Bloom = math.Min(w.BloomMax, ws.Bloom+w.BloomPerShot)
			ws.Cd += w.FireInterval
			if w.FireMode == "burst" {
				ws.Bl--
				if ws.Bl == 0 {
					ws.Cd += w.BurstDelay
				}
			}
			fired = true
			out = append(out, Action{A: ActFire, Slot: s, Spread: spread, Pellets: w.Pellets})
			if ws.Mag[s] == 0 && ws.Res[s] != 0 {
				ws.Rl = w.ReloadTime
				ws.Bl = 0
				out = append(out, Action{A: ActReload})
			}
		}
	}
	if !fired && ws.Cd < 0 {
		ws.Cd = 0
	}
	ws.Pb = buttons
	return out
}

// SpeedMulFor is the movement speed multiplier (slot BEFORE this tick's switch).
func SpeedMulFor(C *Consts, defs *Defs, ws *WeaponState, buttons int) float64 {
	m := 1.0
	if buttons&BtnAim != 0 {
		m = C.AdsMoveMul
	}
	return mul(defs.W[ws.Slot].MoveMul, m)
}

// Input is one input entry.
type Input struct {
	Seq     uint32
	Keys    int
	Yaw     float64
	Pitch   float64
	Buttons int
	Slot    int
	Rt      float64
}

// ClampPitch clamps pitch to [-maxPitch, maxPitch].
func ClampPitch(C *Consts, p float64) float64 {
	return math.Max(-C.MaxPitch, math.Min(C.MaxPitch, p))
}

// SimulateInput runs movement then weapons; returns the weapon actions.
func SimulateInput(out []Action, w *World, C *Consts, defs *Defs, ps *PlayerState, ws *WeaponState, in *Input) []Action {
	pitch := ClampPitch(C, in.Pitch)
	StepMove(w, C, ps, in.Keys, in.Yaw, SpeedMulFor(C, defs, ws, in.Buttons))
	moving := !ps.OnGround || math.Sqrt(mul(ps.VX, ps.VX)+mul(ps.VZ, ps.VZ)) > C.MovingSpeedThreshold
	n := len(out)
	out = WeaponTick(out, ws, in.Buttons, in.Slot, defs, C.Dt, moving)
	for i := n; i < len(out); i++ {
		if out[i].A == ActFire {
			out[i].Pitch = pitch
		}
	}
	return out
}

// ---------------------------------------------------------------- projectiles

// Hit is a raycastWorldN result.
type Hit struct {
	T      float64
	N      [3]float64
	Inside bool
}

// RaycastWorldN is RaycastWorld that also returns the entry face normal.
func RaycastWorldN(w *World, ox, oy, oz, dx, dy, dz, tmax float64) (Hit, bool) {
	var best Hit
	found := false
	B := w.Boxes
	org := [3]float64{ox, oy, oz}
	dir := [3]float64{dx, dy, dz}
	for i := 0; i < w.Count; i++ {
		o := i * 6
		t0, t1, ax, miss := 0.0, tmax, -1, false
		if found {
			t1 = best.T
		}
		for a := 0; a < 3; a++ {
			mn, mx, d, p := B[o+a], B[o+3+a], dir[a], org[a]
			if d == 0 {
				if p < mn || p > mx {
					miss = true
					break
				}
				continue
			}
			ta, tb := (mn-p)/d, (mx-p)/d
			if ta > tb {
				ta, tb = tb, ta
			}
			if ta > t0 {
				t0 = ta
				ax = a
			}
			if tb < t1 {
				t1 = tb
			}
			if t0 > t1 {
				miss = true
				break
			}
		}
		if miss {
			continue
		}
		if !found || t0 < best.T {
			var n [3]float64
			if ax < 0 {
				n[1] = 1
			} else if dir[ax] > 0 {
				n[ax] = -1
			} else {
				n[ax] = 1
			}
			best = Hit{T: t0, N: n, Inside: ax < 0}
			found = true
		}
	}
	return best, found
}

// Projectile is a live grenade (kind 0) or launcher shell (kind 1).
type Projectile struct {
	ID, Owner, Kind  int
	X, Y, Z          float64
	VX, VY, VZ       float64
	Gravity, Radius  float64
	Bounce, Friction float64
	Life             float64
	Rest             bool
}

// NewProjectile creates a projectile from a def.
func NewProjectile(id, owner int, def *data.ProjectileDef, x, y, z, vx, vy, vz float64) *Projectile {
	life := def.Life
	if def.Kind == 0 {
		life = def.Fuse
	}
	return &Projectile{ID: id, Owner: owner, Kind: def.Kind, X: x, Y: y, Z: z, VX: vx, VY: vy, VZ: vz,
		Gravity: def.Gravity, Radius: def.Radius, Bounce: def.Bounce, Friction: def.Friction, Life: life}
}

// StepProjectile advances one projectile one tick against the world.
// Returns explode=true and the explosion point when it must explode.
func StepProjectile(w *World, pr *Projectile, dt float64) (bool, [3]float64) {
	pr.Life -= dt
	if !pr.Rest {
		pr.VY -= mul(pr.Gravity, dt)
		sx, sy, sz := mul(pr.VX, dt), mul(pr.VY, dt), mul(pr.VZ, dt)
		l := math.Sqrt(mul(sx, sx) + mul(sy, sy) + mul(sz, sz))
		if l > 0 {
			dx, dy, dz := sx/l, sy/l, sz/l
			if h, ok := RaycastWorldN(w, pr.X, pr.Y, pr.Z, dx, dy, dz, l); ok {
				hx, hy, hz := pr.X+mul(dx, h.T), pr.Y+mul(dy, h.T), pr.Z+mul(dz, h.T)
				if pr.Kind == 1 {
					return true, [3]float64{hx - mul(dx, 0.05), hy - mul(dy, 0.05), hz - mul(dz, 0.05)}
				}
				n := h.N
				vn := mul(pr.VX, n[0]) + mul(pr.VY, n[1]) + mul(pr.VZ, n[2])
				nvx, nvy, nvz := pr.VX-mul(vn, n[0]), pr.VY-mul(vn, n[1]), pr.VZ-mul(vn, n[2])
				nvx = mul(nvx, pr.Friction)
				nvy = mul(nvy, pr.Friction)
				nvz = mul(nvz, pr.Friction)
				pr.VX = nvx - mul(mul(vn, n[0]), pr.Bounce)
				pr.VY = nvy - mul(mul(vn, n[1]), pr.Bounce)
				pr.VZ = nvz - mul(mul(vn, n[2]), pr.Bounce)
				pr.X, pr.Y, pr.Z = hx+mul(n[0], 0.01), hy+mul(n[1], 0.01), hz+mul(n[2], 0.01)
				if n[1] == 1 && math.Sqrt(mul(pr.VX, pr.VX)+mul(pr.VY, pr.VY)+mul(pr.VZ, pr.VZ)) < 1.0 {
					pr.VX, pr.VY, pr.VZ = 0, 0, 0
					pr.Rest = true
				}
			} else {
				pr.X += sx
				pr.Y += sy
				pr.Z += sz
			}
		}
	}
	if pr.Life <= 0 {
		return true, [3]float64{pr.X, pr.Y, pr.Z}
	}
	return false, [3]float64{}
}

// SubWorld fills dst with the boxes of w that intersect the region
// [mn, mx]. Any query (clip, raycast) that stays inside the region gives the
// same result on dst as on w. Used to speed up bot look-ahead.
func SubWorld(dst, w *World, mn, mx [3]float64) *World {
	dst.Boxes = dst.Boxes[:0]
	B := w.Boxes
	for i := 0; i < w.Count; i++ {
		o := i * 6
		if B[o] > mx[0] || B[o+3] < mn[0] || B[o+1] > mx[1] || B[o+4] < mn[1] || B[o+2] > mx[2] || B[o+5] < mn[2] {
			continue
		}
		dst.Boxes = append(dst.Boxes, B[o:o+6]...)
	}
	dst.Count = len(dst.Boxes) / 6
	dst.BoundsMin, dst.BoundsMax = w.BoundsMin, w.BoundsMax
	return dst
}
