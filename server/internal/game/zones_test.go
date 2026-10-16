package game

import (
	"math"
	"testing"

	"yolkout/server/internal/data"
	"yolkout/server/internal/sim"
)

// V2 combat: hit zones, per-weapon zone multipliers, melee variety (windup,
// knockback, loadout) and the straight-flying launcher shell.

// joinWith adds a human with a primary and a melee and processes the join tick.
func (h *harness) joinWith(name, cls, mel string) (*Client, *Player) {
	c := h.fakeClient()
	h.r.enqueue(roomEvent{join: true, c: c, hello: hello{name: name, cls: cls, mel: mel, cos: defaultCos(h.g)}})
	h.m.mu.Lock()
	h.r.reserved++
	h.m.mu.Unlock()
	h.r.tick()
	for _, p := range h.r.players {
		if p.client == c {
			return c, p
		}
	}
	h.t.Fatal("player not added")
	return nil, nil
}

// noSpread returns a copy of w that always shoots dead straight.
func noSpread(w *data.Weapon) *data.Weapon {
	c := *w
	c.HipSpread, c.AdsSpread, c.MoveSpread, c.BloomPerShot, c.BloomMax = 0, 0, 0, 0, 0
	return &c
}

// aimAt returns the yaw/pitch that look from eye e at point p.
func aimAt(e, p [3]float64) (float64, float64) {
	dx, dy, dz := p[0]-e[0], p[1]-e[1], p[2]-e[2]
	return math.Atan2(-dx, -dz), math.Atan2(dy, math.Hypot(dx, dz))
}

// zoneDuel: victim (lower id, so it moves before the attacker each tick) at the
// origin, attacker 4 units away on +Z, history filled.
func zoneDuel(t *testing.T, cls, mel string) (*harness, *Client, *Client, *Player, *Player) {
	h := newHarness(t, "ffa", 0)
	cv, v := h.joinWith("Victim", "benedict", "rollingpin")
	ca, a := h.joinWith("Shooter", cls, mel)
	h.place(v, 0, 0, 0)
	h.place(a, 0, 0, 4)
	h.ticks(20)
	msgs(t, ca)
	msgs(t, cv)
	return h, ca, cv, a, v
}

var zoneAim = map[int][3]float64{
	sim.ZoneHead: {0, 1.3, 0},
	sim.ZoneBody: {0, 0.75, 0},
	sim.ZoneArm:  {0.36, 0.75, 0},
	sim.ZoneLeg:  {0, 0.15, 0},
}

// shootZone fires one spread-free shot of weapon id at the given zone and returns the hit message.
func shootZone(t *testing.T, h *harness, c *Client, a, v *Player, id string, zone int) map[string]any {
	t.Helper()
	w := noSpread(h.g.Weapon(id))
	a.Defs = &sim.Defs{W: [2]*data.Weapon{w, h.g.Weapon(h.g.Weapons.Secondary)}, Grenade: a.Defs.Grenade, Melee: a.Defs.Melee}
	a.WS = sim.NewWeaponState(a.Defs)
	h.place(v, 0, 0, 0)
	h.place(a, 0, 0, 4)
	v.HP, v.SH = 1000, 0
	yaw, pitch := aimAt(a.eye(h.r.C), zoneAim[zone])
	h.input(c, 0, yaw, pitch, sim.BtnFire|sim.BtnAim, 0)
	h.r.tick()
	hits := ofType(msgs(t, c), "hit")
	if len(hits) != 1 {
		t.Fatalf("%s zone %d: %d hit messages", id, zone, len(hits))
	}
	return hits[0]
}

func TestZoneDamageTable(t *testing.T) {
	// PROTOCOL.md 9 kill table: damage per hit (all pellets for the shotgun) inside falloffStart
	want := map[string][4]int{ // head, body, arm, leg
		"benedict": {50, 25, 23, 23},
		"frittata": {56, 28, 25, 25},
		"poacher":  {34, 20, 19, 19},
		"overeasy": {68, 36, 32, 32},
		"piercer":  {155, 94, 68, 68},
		"deviler":  {152, 105, 105, 105},
		"coddler":  {40, 22, 22, 22},
	}
	h, c, _, a, v := zoneDuel(t, "benedict", "")
	for id, dmg := range want {
		w := h.g.Weapon(id)
		for i, zone := range []int{sim.ZoneHead, sim.ZoneBody, sim.ZoneArm, sim.ZoneLeg} {
			hit := shootZone(t, h, c, a, v, id, zone)
			if int(hit["z"].(float64)) != zone || int(hit["d"].(float64)) != dmg[i] || (hit["hs"].(float64) == 1) != (zone == sim.ZoneHead) {
				t.Fatalf("%s zone %d: hit %v, want d=%d", id, zone, hit, dmg[i])
			}
			// the formula, too: falloff(damage) * zones[zone] * pellets
			f := math.Floor(w.Damage*sim.ZoneMul(w, zone)*float64(w.Pellets) + 0.5)
			if int(f) != dmg[i] {
				t.Fatalf("%s zone %d: table %d vs formula %v", id, zone, dmg[i], f)
			}
		}
	}
}

func TestShotWireZone(t *testing.T) {
	h, c, cv, a, v := zoneDuel(t, "benedict", "")
	shootZone(t, h, c, a, v, "benedict", sim.ZoneLeg)
	shots := ofType(msgs(t, cv), "shot")
	if len(shots) != 1 {
		t.Fatalf("victim should see the shot: %v", shots)
	}
	e := shots[0]["e"].([]any)[0].([]any)
	if len(e) != 5 || e[3].(float64) != 2 || e[4].(float64) != sim.ZoneLeg {
		t.Fatalf("shot.e with a player hit carries the zone: %v", e)
	}
	// a miss has no 5th element
	a.WS = sim.NewWeaponState(a.Defs)
	h.input(c, 0, math.Pi, 0, sim.BtnFire, 0)
	h.r.tick()
	shots = ofType(msgs(t, cv), "shot")
	if len(shots) != 1 || len(shots[0]["e"].([]any)[0].([]any)) != 4 {
		t.Fatalf("miss: %v", shots)
	}
}

func TestSniperHeadshotThroughFullShield(t *testing.T) {
	h, c, cv, a, v := zoneDuel(t, "piercer", "")
	a.Defs.W[0] = noSpread(a.Defs.W[0])
	h.place(v, 0, 0, 0)
	h.place(a, 0, 0, 4)
	v.HP, v.SH = 100, int(h.g.Rules.Combat.MaxShield)
	yaw, pitch := aimAt(a.eye(h.r.C), zoneAim[sim.ZoneHead])
	h.input(c, 0, yaw, pitch, sim.BtnFire|sim.BtnAim, 0)
	h.r.tick()
	if v.Alive {
		t.Fatalf("a Piercer headshot must crack a full-shield egg: hp %v sh %d", v.HP, v.SH)
	}
	kills := ofType(msgs(t, cv), "kill")
	if len(kills) != 1 || kills[0]["z"].(float64) != sim.ZoneHead || kills[0]["hs"].(float64) != 1 || kills[0]["w"] != "piercer" {
		t.Fatalf("kill: %v", kills)
	}
	// a body shot does not one-shot (94 < 100)
	h2, c2, _, a2, v2 := zoneDuel(t, "piercer", "")
	a2.Defs.W[0] = noSpread(a2.Defs.W[0])
	yaw, pitch = aimAt(a2.eye(h2.r.C), zoneAim[sim.ZoneBody])
	h2.input(c2, 0, yaw, pitch, sim.BtnFire|sim.BtnAim, 0)
	h2.r.tick()
	if !v2.Alive || v2.HP != 6 {
		t.Fatalf("piercer body shot: alive %v hp %v", v2.Alive, v2.HP)
	}
}

func TestShotgunPointBlankKill(t *testing.T) {
	h, c, cv, a, v := zoneDuel(t, "deviler", "")
	h.place(a, 0, 0, 1.6)
	h.ticks(20)
	msgs(t, c)
	msgs(t, cv)
	yaw, pitch := aimAt(a.eye(h.r.C), zoneAim[sim.ZoneBody])
	h.input(c, 0, yaw, pitch, sim.BtnFire|sim.BtnAim, 0) // real spread: all 9 pellets land at 1.2 u
	h.r.tick()
	if v.Alive {
		t.Fatalf("one Deviler shell point blank should kill: hp %v", v.HP)
	}
	hits := ofType(msgs(t, c), "hit")
	if len(hits) != 1 || hits[0]["d"].(float64) < 100 || hits[0]["z"].(float64) != sim.ZoneBody {
		t.Fatalf("hit %v", hits)
	}
}

func TestSplashHasNoZone(t *testing.T) {
	h, c, _, a, v := zoneDuel(t, "souffle", "")
	h.place(v, 0, 0, 3)
	h.ticks(20)
	msgs(t, c)
	h.input(c, 0, 0, -1.5, sim.BtnFire, 0)
	h.ticks(3)
	hits := ofType(msgs(t, c), "hit")
	if len(hits) == 0 {
		t.Fatal("expected splash hits")
	}
	for _, m := range hits {
		if m["z"].(float64) != 0 || m["hs"].(float64) != 0 {
			t.Fatalf("splash must have z 0: %v", m)
		}
	}
	_ = a
}

// meleeAt queues a melee press and then idle inputs; returns the number of
// ticks after the press at which the victim lost hp (or -1).
func meleeAt(h *harness, c *Client, v *Player, yaw, pitch float64, max int) int {
	hp := v.HP
	h.input(c, 0, yaw, pitch, sim.BtnMelee, 0)
	h.r.tick()
	if v.HP != hp {
		return 0
	}
	for i := 1; i <= max; i++ {
		h.input(c, 0, yaw, pitch, 0, 0)
		h.r.tick()
		if v.HP != hp || !v.Alive {
			return i
		}
	}
	return -1
}

func TestMeleeWindupPerWeapon(t *testing.T) {
	for _, id := range []string{"rollingpin", "pan", "whisk", "spatula"} {
		h, c, cv, a, v := zoneDuel(t, "benedict", id)
		if a.CurMel != id || a.Defs.Melee.ID != id {
			t.Fatalf("%s: player melee %q / defs %q", id, a.CurMel, a.Defs.Melee.ID)
		}
		h.place(a, 0, 0, 1.5)
		h.ticks(20)
		msgs(t, c)
		msgs(t, cv)
		m := h.g.Weapon(id)
		// the zone is taken on the inflated hit point, so aim low to land a body hit
		yaw, pitch := aimAt(a.eye(h.r.C), [3]float64{0, 0.5, 0})
		at := meleeAt(h, c, v, yaw, pitch, 40)
		wantAt := int(math.Ceil(m.Windup*60 - 1e-6))
		if at != wantAt {
			t.Fatalf("%s: hit landed %d ticks after the press, want %d (windup %v)", id, at, wantAt, m.Windup)
		}
		hits := ofType(msgs(t, c), "hit")
		if len(hits) != 1 || hits[0]["w"] != id || int(hits[0]["d"].(float64)) != int(m.Damage) || hits[0]["z"].(float64) != sim.ZoneBody {
			t.Fatalf("%s: hit %v", id, hits)
		}
		swings := ofType(msgs(t, cv), "melee")
		if len(swings) != 1 || swings[0]["w"] != id {
			t.Fatalf("%s: others must see the swing start with the melee id: %v", id, swings)
		}
		// knockback: away from the attacker plus a little lift; the victim moved before the attacker this tick
		K := m.Knockback
		if K > 0 {
			if math.Abs(v.PS.VZ+K) > 1e-9 || math.Abs(v.PS.VY-K*h.g.Rules.Combat.MeleeKnockUp) > 1e-9 || v.PS.OnGround || v.PS.Coy != 0 {
				t.Fatalf("%s knockback: %+v", id, v.PS)
			}
		} else if v.PS.VZ != 0 || v.PS.VY != 0 {
			t.Fatalf("%s: no knockback expected: %+v", id, v.PS)
		}
	}
}

func TestPanHeadBonk(t *testing.T) {
	h, c, _, a, v := zoneDuel(t, "benedict", "pan")
	h.place(a, 0, 0, 1.2)
	h.ticks(20)
	msgs(t, c)
	yaw, pitch := aimAt(a.eye(h.r.C), [3]float64{0, 1.45, 0})
	meleeAt(h, c, v, yaw, pitch, 20)
	hits := ofType(msgs(t, c), "hit")
	if len(hits) != 1 || hits[0]["z"].(float64) != sim.ZoneHead || hits[0]["d"].(float64) != 90 || hits[0]["hs"].(float64) != 1 {
		t.Fatalf("pan head: %v", hits)
	}
}

func TestMeleeMissAndProtectedVictim(t *testing.T) {
	h, c, _, a, v := zoneDuel(t, "benedict", "spatula")
	h.place(a, 0, 0, 1.2)
	h.ticks(20)
	v.ProtUntil = h.r.k + 1000
	yaw, pitch := aimAt(a.eye(h.r.C), zoneAim[sim.ZoneBody])
	if at := meleeAt(h, c, v, yaw, pitch, 20); at != -1 || v.PS.VZ != 0 || v.PS.VY != 0 {
		t.Fatalf("protected victim: hit at %d, vel %+v", at, v.PS)
	}
	v.ProtUntil = 0
	h.ticks(60) // cooldown
	if at := meleeAt(h, c, v, yaw+math.Pi, 0, 20); at != -1 {
		t.Fatalf("swing the other way must miss: %d", at)
	}
}

func TestMeleeLoadoutNextSpawn(t *testing.T) {
	h := newHarness(t, "ffa", 0)
	c, p := h.joinWith("A", "benedict", "pan")
	c2, _ := h.joinWith("B", "benedict", "bogus")
	var roster []map[string]any
	for _, m := range ofType(msgs(t, c2), "welcome") {
		for _, x := range m["players"].([]any) {
			roster = append(roster, x.(map[string]any))
		}
	}
	if len(roster) != 2 || roster[0]["mel"] != "pan" || roster[1]["mel"] != "rollingpin" {
		t.Fatalf("roster mel (bogus -> default): %v", roster)
	}
	mel, bad := "whisk", "nope"
	c.mu.Lock()
	c.lds = append(c.lds, ldReq{mel: &mel})
	c.mu.Unlock()
	h.r.tick()
	if p.Mel != "whisk" || p.CurMel != "pan" || p.Defs.Melee.ID != "pan" {
		t.Fatalf("ld mel: next %q cur %q defs %q", p.Mel, p.CurMel, p.Defs.Melee.ID)
	}
	pu := ofType(msgs(t, c2), "pu")
	if len(pu) != 1 || pu[0]["p"].(map[string]any)["mel"] != "whisk" {
		t.Fatalf("ld with only mel must broadcast pu: %v", pu)
	}
	c.mu.Lock()
	c.lds = append(c.lds, ldReq{mel: &bad})
	c.mu.Unlock()
	h.r.tick()
	if p.Mel != "whisk" {
		t.Fatal("an unknown ld mel is ignored")
	}
	h.r.kill(p, 0, "fall", sim.ZoneNone)
	h.ticks(int(h.r.ticks(h.r.Mode.RespawnSec)) + 2)
	if !p.Alive || p.CurMel != "whisk" || p.Defs.Melee.ID != "whisk" {
		t.Fatalf("respawn melee: alive %v cur %q", p.Alive, p.CurMel)
	}
	var sp map[string]any
	for _, m := range ofType(msgs(t, c2), "spawn") {
		if int(m["id"].(float64)) == p.ID {
			sp = m
		}
	}
	if sp == nil || sp["mel"] != "whisk" {
		t.Fatalf("spawn mel: %v", sp)
	}
}

func TestHelloMel(t *testing.T) {
	g := loadGame(t)
	for in, want := range map[string]string{"pan": "pan", "spatula": "spatula", "bogus": "rollingpin", "benedict": "rollingpin", "": "rollingpin"} {
		m := inMsg{T: "hello"}
		if in != "" {
			s := in
			m.Mel = &s
		}
		if got := helloFor(g, &m).mel; got != want {
			t.Fatalf("hello mel %q -> %q, want %q", in, got, want)
		}
	}
}

func TestGrenadeThrowFlag(t *testing.T) {
	h, c, cv, _, _ := zoneDuel(t, "benedict", "")
	h.input(c, 0, math.Pi, 0.3, sim.BtnGrenade, 0)
	h.ticks(2)
	found := false
	for _, s := range ofType(msgs(t, cv), "s") {
		for _, row := range s["p"].([]any) {
			r := row.([]any)
			if int(r[0].(float64)) == 2 && int(r[8].(float64))&flThrew != 0 {
				found = true
			}
		}
	}
	if !found {
		t.Fatal("snapshot flag 512 after a grenade throw")
	}
	h.ticks(4)
	for _, s := range ofType(msgs(t, cv), "s") {
		for _, row := range s["p"].([]any) {
			r := row.([]any)
			if int(r[8].(float64))&flThrew != 0 {
				t.Fatal("flag 512 must clear after one snapshot")
			}
		}
	}
}

func TestRocketFliesStraight(t *testing.T) {
	h, c, _, a, _ := zoneDuel(t, "souffle", "")
	h.place(a, 0, 0, 30)
	h.ticks(2)
	a.WS = sim.NewWeaponState(a.Defs)
	a.Defs.W[0] = noSpread(a.Defs.W[0])
	h.input(c, 0, math.Pi/2, 0, sim.BtnFire, 0) // level, toward -X (open floor)
	h.r.tick()
	if len(h.r.projs) != 1 {
		t.Fatalf("expected a shell, got %d", len(h.r.projs))
	}
	y0 := h.r.projs[0].Y
	for i := 0; i < 60 && len(h.r.projs) == 1; i++ {
		if math.Abs(h.r.projs[0].Y-y0) > 1e-9 || h.r.projs[0].VY != 0 {
			t.Fatalf("tick %d: shell y %v (start %v), vy %v", i, h.r.projs[0].Y, y0, h.r.projs[0].VY)
		}
		h.r.tick()
	}
}

func TestBotsPickMelees(t *testing.T) {
	g := loadGame(t)
	m := NewManager(g, Config{BotFill: 12}, nil)
	r := newRoom(m, "BOTSM", g.Modes.Modes["ffa"], "flat", false, 1)
	h := &harness{t: t, g: g, m: m, r: r}
	h.join("Human", "benedict")
	h.ticks(20)
	seen := map[string]bool{}
	for _, p := range r.players {
		if p.bot == nil {
			continue
		}
		if !g.IsMelee(p.Mel) || p.Defs.Melee.ID != p.CurMel {
			t.Fatalf("bot %s melee %q defs %q", p.Name, p.Mel, p.Defs.Melee.ID)
		}
		seen[p.Mel] = true
	}
	if len(seen) < 2 {
		t.Fatalf("11 bots should carry a variety of melees: %v", seen)
	}
}
