package game

import (
	"math"
	"strings"
	"testing"

	"yolkout/server/internal/sim"
)

func TestJoinWelcomeSpawnSnapshot(t *testing.T) {
	h := newHarness(t, "ffa", 0)
	c, p := h.join("Eggbert", "benedict")
	ms := msgs(t, c)
	if len(ms) < 3 || ms[0]["t"] != "welcome" {
		t.Fatalf("first message should be welcome, got %v", ms)
	}
	w := ms[0]
	if int(w["id"].(float64)) != p.ID || w["tr"].(float64) != 60 || w["se"].(float64) != 2 {
		t.Fatalf("welcome: %v", w)
	}
	room := w["room"].(map[string]any)
	if room["code"] != "TESTX" || room["mode"] != "ffa" || room["map"] != "flat" || room["max"].(float64) != 12 {
		t.Fatalf("room: %v", room)
	}
	if len(ofType(ms, "spawn")) != 1 {
		t.Fatalf("expected a spawn: %v", ms)
	}
	s := ofType(ms, "s")
	if len(s) != 1 {
		t.Fatalf("expected one snapshot on tick 0: %v", ms)
	}
	me := s[0]["me"].(map[string]any)
	if me["al"].(float64) != 1 || me["hp"].(float64) != 100 || len(me["ws"].([]any)) != 15 {
		t.Fatalf("me: %v", me)
	}
	pl := s[0]["p"].([]any)
	if len(pl) != 1 || len(pl[0].([]any)) != 10 {
		t.Fatalf("p: %v", pl)
	}
	flags := int(pl[0].([]any)[8].(float64))
	if flags&flAlive == 0 || flags&flProtected == 0 {
		t.Fatalf("flags %d", flags)
	}
	if s[0]["pk"] != "111" || s[0]["o"] != nil {
		t.Fatalf("pk/o: %v %v", s[0]["pk"], s[0]["o"])
	}
	// second player gets join for the first? first gets join for the second
	c2, _ := h.join("Second", "deviler")
	if len(ofType(msgs(t, c), "join")) != 1 {
		t.Fatal("existing player should see join")
	}
	if w2 := ofType(msgs(t, c2), "welcome"); len(w2) != 1 || len(w2[0]["players"].([]any)) != 2 {
		t.Fatal("second welcome roster should have 2 players")
	}
}

func TestAckAndPrediction(t *testing.T) {
	h := newHarness(t, "ffa", 0)
	c, p := h.join("A", "benedict")
	h.place(p, 0, 0, 0)
	// replay the same inputs through the sim locally and compare with server state
	ps := p.PS
	ws := p.WS
	defs := p.Defs
	for i := 0; i < 30; i++ {
		h.input(c, sim.KeyFwd|sim.KeyLeft, 0.5, 0, 0, 0)
		in := sim.Input{Seq: uint32(i + 1), Keys: sim.KeyFwd | sim.KeyLeft, Yaw: 0.5}
		sim.SimulateInput(nil, h.r.World, h.r.C, defs, &ps, &ws, &in)
		h.r.tick()
	}
	if p.Ack != 30 {
		t.Fatalf("ack %d", p.Ack)
	}
	if p.PS != ps {
		t.Fatalf("server %+v != local %+v", p.PS, ps)
	}
	snaps := ofType(msgs(t, c), "s")
	last := snaps[len(snaps)-1]
	if last["a"].(float64) < 28 {
		t.Fatalf("snapshot ack %v", last["a"])
	}
}

func TestInputTokenBucketLimitsSpeed(t *testing.T) {
	h := newHarness(t, "ffa", 0)
	c, p := h.join("A", "benedict")
	h.ticks(10) // bank the maximum number of tokens
	for i := 0; i < 16; i++ {
		h.input(c, sim.KeyFwd, 0, 0, 0, 0)
	}
	last := uint32(0)
	for i := 0; i < 10; i++ {
		h.r.tick()
		if p.Ack-last > uint32(h.g.Rules.Net.MaxInputsPerTick) {
			t.Fatalf("consumed %d inputs in one tick", p.Ack-last)
		}
		last = p.Ack
	}
	// 6 banked tokens + 1 per tick
	if want := uint32(h.g.Rules.Net.InputTokenMax + 10 - 1); p.Ack > want+1 {
		t.Fatalf("consumed %d inputs in 10 ticks (max %d)", p.Ack, want+1)
	}
}

func TestStarvationNullInput(t *testing.T) {
	h := newHarness(t, "ffa", 0)
	_, p := h.join("A", "benedict")
	h.place(p, 0, 3, 0) // in the air
	p.PS.OnGround = false
	h.ticks(60)
	if p.PS.Y != 0 || !p.PS.OnGround {
		t.Fatalf("starved player should fall to the floor: %+v", p.PS)
	}
	if p.Ack != 0 {
		t.Fatal("null inputs must not ack")
	}
}

func setupDuel(t *testing.T, mode, cls string) (*harness, *Client, *Player, *Player) {
	h := newHarness(t, mode, 0)
	c, a := h.join("Shooter", cls)
	_, v := h.join("Victim", "benedict")
	h.place(a, 0, 0, 10)
	h.place(v, 0, 0, 0)
	h.ticks(20) // fill history at these positions
	msgs(t, c)
	return h, c, a, v
}

func TestHitscanBodyDamage(t *testing.T) {
	h, c, _, v := setupDuel(t, "ffa", "benedict")
	pitch := math.Atan2(0.75-1.3, 10)
	h.input(c, 0, 0, pitch, sim.BtnFire|sim.BtnAim, 0)
	h.r.tick()
	if v.HP != 75 {
		t.Fatalf("victim hp %v, want 75", v.HP)
	}
	ms := msgs(t, c)
	hits := ofType(ms, "hit")
	if len(hits) != 1 || hits[0]["d"].(float64) != 25 || hits[0]["hs"].(float64) != 0 || hits[0]["z"].(float64) != 2 || hits[0]["hp"].(float64) != 75 {
		t.Fatalf("hit: %v", hits)
	}
	if len(ofType(ms, "shot")) != 0 {
		t.Fatal("shooter must not receive own shot")
	}
}

func TestHitscanHeadshot(t *testing.T) {
	h, c, _, v := setupDuel(t, "ffa", "overeasy")
	pitch := math.Atan2(1.3-1.3, 10) // eye level: hits the top of the egg
	h.input(c, 0, 0, pitch, sim.BtnFire|sim.BtnAim, 0)
	h.r.tick()
	want := 100 - math.Floor(34*2.0+0.5)
	if v.HP != want {
		t.Fatalf("victim hp %v want %v", v.HP, want)
	}
}

func TestShieldAbsorbsFirst(t *testing.T) {
	h, c, _, v := setupDuel(t, "ffa", "benedict")
	v.SH = 10
	h.input(c, 0, 0, math.Atan2(0.75-1.3, 10), sim.BtnFire|sim.BtnAim, 0)
	h.r.tick()
	if v.SH != 0 || v.HP != 85 {
		t.Fatalf("sh %d hp %v", v.SH, v.HP)
	}
}

func TestSpawnProtectionBlocksDamage(t *testing.T) {
	h, c, _, v := setupDuel(t, "ffa", "benedict")
	v.ProtUntil = h.r.k + 100
	h.input(c, 0, 0, math.Atan2(0.75-1.3, 10), sim.BtnFire|sim.BtnAim, 0)
	h.r.tick()
	if v.HP != 100 {
		t.Fatal("protected victim took damage")
	}
	if len(ofType(msgs(t, c), "hit")) != 0 {
		t.Fatal("no hit event for protected victim")
	}
}

func TestFiringEndsOwnProtection(t *testing.T) {
	h, c, a, _ := setupDuel(t, "ffa", "benedict")
	a.ProtUntil = h.r.k + 100
	h.input(c, 0, math.Pi, 0, sim.BtnFire, 0) // shoot away
	h.r.tick()
	if a.protected(h.r.k) {
		t.Fatal("protection should end on fire")
	}
}

func TestTeammatesNotDamaged(t *testing.T) {
	h, c, a, v := setupDuel(t, "teams", "benedict")
	v.Team = a.Team
	h.input(c, 0, 0, math.Atan2(0.75-1.3, 10), sim.BtnFire|sim.BtnAim, 0)
	h.r.tick()
	if v.HP != 100 {
		t.Fatal("friendly fire")
	}
}

func TestShotgunPelletsSum(t *testing.T) {
	h, c, _, v := setupDuel(t, "ffa", "deviler")
	h.place(v, 0, 0, 7) // 3 units away
	h.ticks(20)
	h.input(c, 0, 0, math.Atan2(0.75-1.3, 3), sim.BtnFire, 0)
	h.r.tick()
	dmg := 100 - v.HP
	if dmg < 50 {
		t.Fatalf("point-blank shotgun did only %v", dmg)
	}
	hits := ofType(msgs(t, c), "hit")
	if len(hits) != 1 {
		t.Fatalf("pellets must be summed into one hit event, got %d", len(hits))
	}
}

func TestLagCompensationRewinds(t *testing.T) {
	h, c, _, v := setupDuel(t, "ffa", "overeasy")
	// victim was at x=0 for the last 20 ticks; now it moves 3 units aside.
	past := float64(h.r.k - 6)
	v.PS.X = 3
	h.r.tick()
	// shooting at the old position with rt in the past must hit
	c.mu.Lock()
	c.lastSeq++
	c.inputs = append(c.inputs, sim.Input{Seq: c.lastSeq, Pitch: math.Atan2(0.75-1.3, 10), Buttons: sim.BtnFire | sim.BtnAim, Rt: past})
	c.mu.Unlock()
	h.r.tick()
	if v.HP == 100 {
		t.Fatal("rewound shot should hit the old position")
	}
	// a shot at the old position with rt = now must miss
	hp := v.HP
	h.ticks(20)
	c.mu.Lock()
	c.lastSeq++
	c.inputs = append(c.inputs, sim.Input{Seq: c.lastSeq, Pitch: math.Atan2(0.75-1.3, 10), Buttons: sim.BtnFire | sim.BtnAim, Rt: float64(h.r.k)})
	c.mu.Unlock()
	h.r.tick()
	if v.HP < hp {
		t.Fatal("unrewound shot hit a player who moved away")
	}
}

func TestKillScoringAndStreaks(t *testing.T) {
	h, c, a, v := setupDuel(t, "teams", "piercer")
	if a.Team == v.Team {
		t.Fatal("teams should be split")
	}
	for kill := 1; kill <= 3; kill++ {
		h.place(v, 0, 0, 0)
		v.Alive, v.HP, v.SH = true, 100, 0
		h.ticks(20)
		a.WS.Cd, a.WS.Rl = 0, 0
		a.WS.Mag[0] = 4
		h.input(c, 0, 0, 0, sim.BtnAim, 0) // release fire (semi)
		h.input(c, 0, 0, 0, sim.BtnFire|sim.BtnAim, 0)
		h.ticks(2)
		if v.Alive {
			t.Fatalf("kill %d: sniper headshot should kill (hp %v)", kill, v.HP)
		}
	}
	if a.Kills != 3 || a.Streak != 3 || v.Deaths != 3 {
		t.Fatalf("kills %d streak %d deaths %d", a.Kills, a.Streak, v.Deaths)
	}
	pts := h.r.Mode.Points
	if want := 3*(pts["kill"]+pts["headshotBonus"]) + pts["streakBonus"]; a.Score != want {
		t.Fatalf("score %d want %d", a.Score, want)
	}
	if h.r.ts[a.Team] != 3 {
		t.Fatalf("team score %v", h.r.ts)
	}
	ms := msgs(t, c)
	if st := ofType(ms, "streak"); len(st) != 1 || st[0]["r"] != "refill" {
		t.Fatalf("streak events %v", st)
	}
	if a.WS.Res[0] != a.Defs.W[0].Reserve || a.WS.Mag[0] != a.Defs.W[0].MagSize {
		t.Fatal("refill reward not applied")
	}
	kills := ofType(ms, "kill")
	if len(kills) != 3 || kills[2]["st"].(float64) != 3 || kills[2]["hs"].(float64) != 1 || kills[2]["rs"].(float64) != 4 {
		t.Fatalf("kill events %v", kills)
	}
	if len(ofType(ms, "sb")) == 0 {
		t.Fatal("expected sb after kills")
	}
	// respawn after respawnSec
	h.ticks(int(h.r.ticks(h.r.Mode.RespawnSec)) + 1)
	if !v.Alive || v.HP != 100 || !v.protected(h.r.k) {
		t.Fatal("victim should have respawned with protection")
	}
}

func TestFallDeath(t *testing.T) {
	h := newHarness(t, "ffa", 0)
	c, p := h.join("A", "benedict")
	p.PS.Y = h.r.killY - 1
	h.r.tick()
	if p.Alive || p.Deaths != 1 || p.Kills != 0 {
		t.Fatal("fall should kill without a kill credit")
	}
	k := ofType(msgs(t, c), "kill")
	if len(k) != 1 || k[0]["w"] != "fall" || k[0]["k"].(float64) != float64(p.ID) || k[0]["st"].(float64) != 0 {
		t.Fatalf("kill msg %v", k)
	}
}

func TestLauncherSplashAndSelfDamage(t *testing.T) {
	h, c, a, v := setupDuel(t, "ffa", "souffle")
	h.place(v, 0, 0, 7)
	h.ticks(20)
	// fire straight down at own feet: self damage is halved, victim 3 units away takes splash
	h.input(c, 0, 0, -1.5, sim.BtnFire, 0)
	h.ticks(3)
	ms := msgs(t, c)
	if len(ofType(ms, "boom")) != 1 {
		t.Fatalf("expected one boom: %v", ofType(ms, "boom"))
	}
	if a.HP >= 100 || v.HP >= 100 {
		t.Fatalf("splash: shooter %v victim %v", a.HP, v.HP)
	}
	if !(a.PS.VY > 0) {
		t.Fatal("knockback should launch the shooter up")
	}
}

func TestGrenadeArcAndFuse(t *testing.T) {
	h, c, a, _ := setupDuel(t, "ffa", "benedict")
	h.input(c, 0, math.Pi, 0.3, sim.BtnGrenade, 0)
	h.r.tick()
	if len(h.r.projs) != 1 || a.WS.Gren != 1 {
		t.Fatalf("grenade not thrown: %d projs, %d left", len(h.r.projs), a.WS.Gren)
	}
	snaps := ofType(msgs(t, c), "s")
	_ = snaps
	h.ticks(int(h.r.ticks(1.8)) + 2)
	if len(h.r.projs) != 0 {
		t.Fatal("grenade should explode after the fuse")
	}
	if len(ofType(msgs(t, c), "boom")) != 1 {
		t.Fatal("expected boom")
	}
}

func TestMelee(t *testing.T) {
	h, c, _, v := setupDuel(t, "ffa", "benedict")
	h.place(v, 0, 0, 8.8)
	h.ticks(20)
	h.input(c, 0, 0, -0.7, sim.BtnMelee, 0)
	// rolling pin windup 0.1 s: the hit lands 6 inputs after the press
	for i := 0; i < 6; i++ {
		h.r.tick()
		if v.HP != 100 {
			t.Fatalf("melee hit before the windup elapsed (tick %d)", i)
		}
		h.input(c, 0, 0, -0.7, 0, 0)
	}
	h.r.tick()
	if v.HP != 50 {
		t.Fatalf("melee hp %v", v.HP)
	}
}

func TestRegen(t *testing.T) {
	h := newHarness(t, "ffa", 0)
	_, p := h.join("A", "benedict")
	p.HP = 50
	p.LastDamageTick = h.r.k
	h.ticks(int(h.r.ticks(5)) - 2)
	if p.HP != 50 {
		t.Fatal("regen too early")
	}
	h.ticks(62)
	if p.HP < 69 || p.HP > 71 {
		t.Fatalf("regen hp %v", p.HP)
	}
}

func TestPickups(t *testing.T) {
	h := newHarness(t, "ffa", 0)
	c, p := h.join("A", "benedict")
	p.HP = 30
	p.LastDamageTick = h.r.k
	h.place(p, 5, 0, 5)
	h.r.tick()
	if p.HP != 70 || h.r.pickups[0].avail {
		t.Fatalf("hp pickup: hp %v", p.HP)
	}
	if pk := ofType(msgs(t, c), "pick"); len(pk) != 1 || pk[0]["ty"] != "hp" {
		t.Fatal("pick event")
	}
	// shield
	h.place(p, 5, 0, -5)
	h.r.tick()
	if p.SH != 50 {
		t.Fatalf("shield %d", p.SH)
	}
	// ammo is not useful when full
	p.WS.Gren = p.Defs.Grenade.MaxCount
	h.place(p, -5, 0, -5)
	h.r.tick()
	if !h.r.pickups[1].avail {
		t.Fatal("ammo picked while full")
	}
	p.WS.Res[0] = 0
	p.WS.Gren = 1
	h.r.tick()
	if h.r.pickups[1].avail || p.WS.Res[0] != p.Defs.W[0].Reserve || p.WS.Gren != 2 {
		t.Fatalf("ammo pickup: res %d gren %d", p.WS.Res[0], p.WS.Gren)
	}
	h.ticks(int(h.r.ticks(20)) + 1)
	if !h.r.pickups[0].avail {
		t.Fatal("hp pickup should respawn after 20s")
	}
}

func TestFFAMatchEndAndRestart(t *testing.T) {
	h := newHarness(t, "ffa", 0)
	c, a := h.join("A", "benedict")
	_, b := h.join("B", "benedict")
	a.Kills = h.r.Mode.ScoreLimit
	h.r.tick()
	ms := msgs(t, c)
	end := ofType(ms, "end")
	if len(end) != 1 || int(end[0]["wp"].(float64)) != a.ID || end[0]["wt"].(float64) != 0 {
		t.Fatalf("end: %v", end)
	}
	if h.r.state != stateEnded {
		t.Fatal("state should be ended")
	}
	next := end[0]["next"].(string)
	// no damage during intermission
	b.HP = 100
	h.r.damage(b, a.ID, 50, sim.ZoneBody, "benedict", [3]float64{})
	if b.HP != 100 {
		t.Fatal("damage during intermission")
	}
	h.ticks(int(h.r.ticks(10)) + 1)
	ms = msgs(t, c)
	st := ofType(ms, "start")
	if len(st) != 1 || st[0]["map"] != next || h.r.MapID != next {
		t.Fatalf("start: %v", st)
	}
	if a.Kills != 0 || a.Score != 0 || h.r.state != stateLive {
		t.Fatal("scores not reset")
	}
	if len(ofType(ms, "spawn")) != 2 {
		t.Fatal("everyone should respawn at start")
	}
}

func TestTimeoutDrawTeams(t *testing.T) {
	h := newHarness(t, "teams", 0)
	c, _ := h.join("A", "benedict")
	h.join("B", "benedict")
	h.r.endTick = h.r.k + 1
	h.ticks(2)
	end := ofType(msgs(t, c), "end")
	if len(end) != 1 || end[0]["wt"].(float64) != 0 {
		t.Fatalf("expected draw: %v", end)
	}
}

func TestTeamBalanceAndRebalance(t *testing.T) {
	h := newHarness(t, "teams", 0)
	var ps []*Player
	for i := 0; i < 5; i++ {
		_, p := h.join(string(rune('A'+i)), "benedict")
		ps = append(ps, p)
	}
	n := [3]int{}
	for _, p := range ps {
		n[p.Team]++
	}
	if n[1] != 3 || n[2] != 2 {
		t.Fatalf("join balance %v", n)
	}
	// unbalance by hand, then start a match
	for _, p := range ps {
		p.Team = 1
	}
	h.r.nextMap = "flat"
	h.r.beginMatch()
	n = [3]int{}
	for _, p := range ps {
		n[p.Team]++
	}
	if n[1]-n[2] > 1 || n[2]-n[1] > 1 {
		t.Fatalf("rebalance %v", n)
	}
	if ps[4].Team != 2 || ps[3].Team != 2 {
		t.Fatal("most recently joined players should move")
	}
}

func TestNestRaidCapture(t *testing.T) {
	h := newHarness(t, "nest", 0)
	c, a := h.join("A", "benedict")
	_, b := h.join("B", "benedict")
	if a.Team != 1 || b.Team != 2 {
		t.Fatalf("teams %d %d", a.Team, b.Team)
	}
	h.place(b, 30, 0, 30)
	// A walks onto team 2's nest and takes their egg
	h.place(a, 20, 0, 0)
	h.r.tick()
	if h.r.eggs[2].state != 1 || a.Carrying != 2 {
		t.Fatalf("take failed: %+v", h.r.eggs[2])
	}
	// then to own nest: capture
	h.place(a, -20, 0, 0.5)
	h.r.tick()
	if h.r.ts[1] != 1 || a.Carrying != 0 || h.r.eggs[2].state != 0 {
		t.Fatalf("capture failed: ts %v", h.r.ts)
	}
	ms := msgs(t, c)
	fl := ofType(ms, "flag")
	if len(fl) != 2 || fl[0]["ev"] != "take" || fl[1]["ev"] != "cap" || fl[1]["tm"].(float64) != 2 {
		t.Fatalf("flags %v", fl)
	}
	pts := h.r.Mode.Points
	if a.Score != pts["take"]+pts["capture"] {
		t.Fatalf("score %d", a.Score)
	}
	// take again, die: egg dropped; teammate B returns it
	h.place(a, 20, 0, 0)
	h.r.tick()
	h.place(a, 10, 0, 0)
	h.r.tick()
	h.r.kill(a, b.ID, "benedict", sim.ZoneBody)
	if h.r.eggs[2].state != 2 || b.Score < pts["kill"]+pts["carrierKill"] {
		t.Fatalf("drop: %+v score %d", h.r.eggs[2], b.Score)
	}
	h.place(b, 10, 0, 0.5)
	h.r.tick()
	if h.r.eggs[2].state != 0 {
		t.Fatal("teammate should return the dropped egg")
	}
	snap := ofType(msgs(t, c), "s")
	o := snap[len(snap)-1]["o"].([]any)
	if len(o) != 2 || len(o[0].([]any)) != 6 {
		t.Fatalf("objective %v", o)
	}
}

func TestNestNoCaptureWhileOwnEggAway(t *testing.T) {
	h := newHarness(t, "nest", 0)
	_, a := h.join("A", "benedict")
	_, b := h.join("B", "benedict")
	h.place(a, 20, 0, 0) // A takes egg 2
	h.place(b, -20, 0, 0)
	h.r.tick() // B takes egg 1
	if a.Carrying != 2 || b.Carrying != 1 {
		t.Fatal("both should carry")
	}
	h.place(a, -20, 0, 0)
	h.place(b, 20, 0, 0)
	h.r.tick()
	if h.r.ts[1] != 0 || h.r.ts[2] != 0 {
		t.Fatal("cannot capture while own egg is away")
	}
}

func TestLoadoutAndChat(t *testing.T) {
	h := newHarness(t, "teams", 0)
	c, p := h.join("A", "benedict")
	c2, _ := h.join("B", "benedict")
	cls := "deviler"
	hat, bad := "chef", "nope"
	c.mu.Lock()
	c.lds = append(c.lds, ldReq{cls: &cls, cos: &cosIn{Hat: &hat, Color: &bad}})
	c.chats = append(c.chats, chatReq{m: "  gg\x07 wp  ", team: false}, chatReq{m: "team only", team: true})
	c.mu.Unlock()
	h.r.tick()
	if p.Cls != "deviler" || p.CurCls != "benedict" || p.Cos.Hat != "chef" || p.Cos.Color != "classic" {
		t.Fatalf("ld: %+v %+v", p.Cls, p.Cos)
	}
	ms := msgs(t, c2)
	if len(ofType(ms, "pu")) != 1 {
		t.Fatal("pu broadcast")
	}
	chats := ofType(ms, "chat")
	if len(chats) != 1 || chats[0]["m"] != "gg wp" {
		t.Fatalf("other team should only get the public chat: %v", chats)
	}
	if len(ofType(msgs(t, c), "chat")) != 2 {
		t.Fatal("sender sees both")
	}
}

func TestBotsFillAndFight(t *testing.T) {
	g := loadGame(t)
	for _, mapID := range []string{"barnyard", "countertop", "hatchery", "diner"} {
		for _, mode := range []string{"ffa", "nest"} {
			m := NewManager(g, Config{BotFill: 6}, nil)
			r := newRoom(m, "BOTS1", g.Modes.Modes[mode], mapID, false, 1)
			h := &harness{t: t, g: g, m: m, r: r}
			c, human := h.join("Human", "benedict")
			human.ProtUntil = math.MaxInt64 // keep the spectator alive
			h.ticks(10)
			if n := r.botCount(); n != 5 {
				t.Fatalf("%s: want 5 bots, got %d", mapID, n)
			}
			falls, kills := 0, 0
			moved := 0.0
			start := map[int][2]float64{}
			for _, p := range r.players {
				start[p.ID] = [2]float64{p.PS.X, p.PS.Z}
			}
			for i := 0; i < 60*60; i++ {
				r.tick()
				if i%30 == 0 {
					for _, m := range ofType(msgs(t, c), "kill") {
						if m["w"] == "fall" {
							falls++
						} else {
							kills++
						}
					}
				}
			}
			for _, p := range r.players {
				if p.bot != nil {
					moved += math.Hypot(p.PS.X-start[p.ID][0], p.PS.Z-start[p.ID][1])
				}
			}
			t.Logf("%s/%s: 60s with 5 bots: %d kills, %d falls, state=%d", mapID, mode, kills, falls, r.state)
			if kills == 0 {
				t.Errorf("%s/%s: bots never killed anyone in 60s", mapID, mode)
			}
			if falls > 6 {
				t.Errorf("%s/%s: bots fell out %d times", mapID, mode, falls)
			}
			// human leaves: bots go away
			r.enqueue(roomEvent{c: c})
			r.tick()
			if r.botCount() != 0 {
				t.Fatalf("bots should leave with the last human")
			}
		}
	}
}

func TestBotsMakeRoomForHumans(t *testing.T) {
	h := newHarness(t, "ffa", 12)
	h.join("A", "benedict")
	h.ticks(20)
	if len(h.r.players) != 12 {
		t.Fatalf("players %d", len(h.r.players))
	}
	h.join("B", "benedict")
	if len(h.r.players) != 12 || h.r.botCount() != 10 {
		t.Fatalf("players %d bots %d", len(h.r.players), h.r.botCount())
	}
}

func TestSnapshotIsValidJSONWithProjectiles(t *testing.T) {
	h, c, _, _ := setupDuel(t, "ffa", "souffle")
	h.input(c, 0, math.Pi, 0.2, sim.BtnFire, 0)
	h.ticks(4)
	snaps := ofType(msgs(t, c), "s")
	found := false
	for _, s := range snaps {
		if pr := s["pr"].([]any); len(pr) == 1 && len(pr[0].([]any)) == 9 {
			found = true
		}
	}
	if !found {
		t.Fatal("projectile missing from snapshots")
	}
	if !strings.Contains(string(h.r.scratch), `"pk":"`) {
		t.Fatal("scratch")
	}
}

func TestEarlyRewindDoesNotPanic(t *testing.T) {
	h := newHarness(t, "ffa", 0)
	c, _ := h.join("A", "benedict")
	h.join("B", "benedict")
	c.mu.Lock()
	c.lastSeq++
	c.inputs = append(c.inputs, sim.Input{Seq: c.lastSeq, Buttons: sim.BtnFire, Rt: -6})
	c.mu.Unlock()
	h.ticks(2)
}

// A dead player picking a loadout holds their respawn (capped) and comes back
// with the new primary as soon as they save.
func TestLoadoutHoldDelaysRespawn(t *testing.T) {
	h := newHarness(t, "ffa", 0)
	c, a := h.join("A", "benedict")
	_, b := h.join("B", "benedict")
	h.ticks(2)
	hold := func(v int, cls *string) {
		c.mu.Lock()
		c.lds = append(c.lds, ldReq{cls: cls, hold: &v})
		c.mu.Unlock()
		h.r.tick()
	}
	h.r.kill(a, b.ID, "benedict", sim.ZoneBody)
	hold(1, nil)
	if !a.HoldRespawn {
		t.Fatal("hold not set while dead")
	}
	h.ticks(int(h.r.RespawnAtDelta(a)) + 30)
	if a.Alive {
		t.Fatal("respawned while holding")
	}
	cls := "piercer"
	hold(0, &cls)
	if !a.Alive || a.CurCls != "piercer" || a.HoldRespawn {
		t.Fatalf("after save: alive=%v cls=%s hold=%v", a.Alive, a.CurCls, a.HoldRespawn)
	}

	// the hold is capped
	h.r.kill(a, b.ID, "benedict", sim.ZoneBody)
	hold(1, nil)
	h.ticks(int(h.r.RespawnAtDelta(a)+h.r.ticks(respawnHoldMaxSec)) + 2)
	if !a.Alive {
		t.Fatal("hold should expire")
	}

	// hold is ignored while alive
	hold(1, nil)
	if a.HoldRespawn {
		t.Fatal("hold set while alive")
	}
}

// RespawnAtDelta is the number of ticks until p's normal respawn time.
func (r *Room) RespawnAtDelta(p *Player) int64 { return max(0, p.RespawnAt-r.k) }
