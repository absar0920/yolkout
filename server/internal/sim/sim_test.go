package sim

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"testing"

	"yolkout/server/internal/data"
)

// The module lives in server/, this package in server/internal/sim.
const sharedDir = "../../../shared"

var game *data.Game

func loadGame(t *testing.T) *data.Game {
	t.Helper()
	if game == nil {
		g, err := data.Load(filepath.Join(sharedDir, "data"))
		if err != nil {
			t.Fatal(err)
		}
		game = g
	}
	return game
}

func readVec(t *testing.T, name string, v any) {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(sharedDir, "testvectors", name))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, v); err != nil {
		t.Fatal(err)
	}
}

const tol = 1e-9

func near(a, b float64) bool {
	if a == b {
		return true
	}
	return math.Abs(a-b) <= tol
}

func TestMovementVectors(t *testing.T) {
	g := loadGame(t)
	C := MakeConsts(g.Rules)
	var vec struct {
		Dt    float64
		Cases []struct {
			Name    string
			Map     string
			Start   [3]float64
			Primary string
			Inputs  [][5]float64
			Expect  [][7]float64
		}
	}
	readVec(t, "movement.json", &vec)
	if !near(vec.Dt, C.Dt) {
		t.Fatalf("dt mismatch %v vs %v", vec.Dt, C.Dt)
	}
	if len(vec.Cases) == 0 {
		t.Fatal("no cases")
	}
	for _, c := range vec.Cases {
		w := MakeWorld(g.Maps[c.Map])
		defs := DefsFor(g.Weapons, c.Primary)
		ps := PlayerState{X: c.Start[0], Y: c.Start[1], Z: c.Start[2]}
		ws := NewWeaponState(defs)
		var acts []Action
		for i, in := range c.Inputs {
			input := Input{Seq: uint32(i + 1), Keys: int(in[0]), Yaw: in[1], Pitch: in[2], Buttons: int(in[3]), Slot: int(in[4])}
			acts = SimulateInput(acts[:0], w, C, defs, &ps, &ws, &input)
			got := [7]float64{ps.X, ps.Y, ps.Z, ps.VX, ps.VY, ps.VZ, b2f(ps.OnGround)}
			for j := range got {
				if !near(got[j], c.Expect[i][j]) {
					t.Fatalf("%s input %d field %d: got %v want %v (state %v want %v)", c.Name, i, j, got[j], c.Expect[i][j], got, c.Expect[i])
				}
			}
		}
	}
}

func TestWeaponVectors(t *testing.T) {
	g := loadGame(t)
	C := MakeConsts(g.Rules)
	var vec struct {
		Cases []struct {
			Name    string
			Primary string
			Inputs  [][3]int
			Expect  []struct {
				Ws   [14]float64
				Acts [][]json.RawMessage
			}
		}
	}
	readVec(t, "weapons.json", &vec)
	intField := map[int]bool{0: true, 1: true, 2: true, 3: true, 4: true, 5: true, 9: true, 13: true}
	for _, c := range vec.Cases {
		defs := DefsFor(g.Weapons, c.Primary)
		ws := NewWeaponState(defs)
		for i, in := range c.Inputs {
			acts := WeaponTick(nil, &ws, in[0], in[1], defs, C.Dt, in[2] == 1)
			got := ws.Array()
			exp := c.Expect[i]
			for j := range got {
				if intField[j] {
					if got[j] != exp.Ws[j] {
						t.Fatalf("%s tick %d ws[%d]: got %v want %v", c.Name, i, j, got[j], exp.Ws[j])
					}
				} else if !near(got[j], exp.Ws[j]) {
					t.Fatalf("%s tick %d ws[%d]: got %v want %v", c.Name, i, j, got[j], exp.Ws[j])
				}
			}
			if len(acts) != len(exp.Acts) {
				t.Fatalf("%s tick %d: %d acts, want %d", c.Name, i, len(acts), len(exp.Acts))
			}
			for k, a := range acts {
				var name string
				_ = json.Unmarshal(exp.Acts[k][0], &name)
				if ActName(a.A) != name {
					t.Fatalf("%s tick %d act %d: %s want %s", c.Name, i, k, ActName(a.A), name)
				}
				switch name {
				case "fire":
					var slot, pellets int
					var spread float64
					_ = json.Unmarshal(exp.Acts[k][1], &slot)
					_ = json.Unmarshal(exp.Acts[k][2], &spread)
					_ = json.Unmarshal(exp.Acts[k][3], &pellets)
					if a.Slot != slot || a.Pellets != pellets || !near(a.Spread, spread) {
						t.Fatalf("%s tick %d fire: got %+v want %d %v %d", c.Name, i, a, slot, spread, pellets)
					}
				case "switch":
					var slot int
					_ = json.Unmarshal(exp.Acts[k][1], &slot)
					if a.Slot != slot {
						t.Fatalf("%s tick %d switch slot %d want %d", c.Name, i, a.Slot, slot)
					}
				}
			}
		}
	}
}

func TestMathVectors(t *testing.T) {
	g := loadGame(t)
	C := MakeConsts(g.Rules)
	var vec struct {
		Rng []struct {
			Seed uint32
			Out  []float64
		}
		Seeds []struct {
			Pid, Seq uint32
			Pellet   int
			Seed     uint32
		}
		Dirs []struct {
			Pid, Seq           uint32
			Yaw, Pitch, Spread float64
			Pellets            int
			Dirs               [][3]float64
		}
		Egg []struct {
			O, D, P       [3]float64
			Tmax, Inflate float64
			T             float64
			Head          int
		}
		Casts []struct {
			Map  string
			O, D [3]float64
			Tmax float64
			T    float64
		}
		Falloff []struct {
			Weapon string
			D      float64
			Dmg    float64
		}
	}
	readVec(t, "math.json", &vec)
	for _, r := range vec.Rng {
		m := NewMulberry32(r.Seed)
		for i, want := range r.Out {
			if got := m.Next(); got != want {
				t.Fatalf("rng seed %d #%d: %v want %v", r.Seed, i, got, want)
			}
		}
	}
	for _, s := range vec.Seeds {
		if got := ShotSeed(s.Pid, s.Seq, s.Pellet); got != s.Seed {
			t.Fatalf("seed %+v: got %d", s, got)
		}
	}
	for _, d := range vec.Dirs {
		got := ShotDirs(nil, d.Pid, d.Seq, d.Yaw, d.Pitch, d.Spread, d.Pellets)
		if len(got) != len(d.Dirs) {
			t.Fatalf("dirs len")
		}
		for i := range got {
			for j := 0; j < 3; j++ {
				if !near(got[i][j], d.Dirs[i][j]) {
					t.Fatalf("dirs %+v pellet %d: %v want %v", d, i, got[i], d.Dirs[i])
				}
			}
		}
	}
	for _, e := range vec.Egg {
		tt := RayEgg(C, e.O[0], e.O[1], e.O[2], e.D[0], e.D[1], e.D[2], e.P[0], e.P[1], e.P[2], e.Tmax, e.Inflate)
		if !near(tt, e.T) {
			t.Fatalf("egg %+v: got %v", e, tt)
		}
		head := 0
		if tt >= 0 && e.O[1]+e.D[1]*tt >= e.P[1]+C.HeadshotY {
			head = 1
		}
		if head != e.Head {
			t.Fatalf("egg head %+v", e)
		}
	}
	for _, c := range vec.Casts {
		w := MakeWorld(g.Maps[c.Map])
		if got := RaycastWorld(w, c.O[0], c.O[1], c.O[2], c.D[0], c.D[1], c.D[2], c.Tmax); !near(got, c.T) {
			t.Fatalf("cast %+v: got %v", c, got)
		}
	}
	for _, f := range vec.Falloff {
		if got := FalloffDamage(g.Weapon(f.Weapon), f.D); !near(got, f.Dmg) {
			t.Fatalf("falloff %+v: got %v", f, got)
		}
	}
}

func TestProjectileGrenadeBouncesAndRests(t *testing.T) {
	g := loadGame(t)
	w := MakeWorld(g.Maps["barnyard"])
	def := g.Weapon("quiche").Projectile
	pr := NewProjectile(1, 1, def, 10, 1, 10, 3, 2, 0)
	bounced, rested := false, false
	for i := 0; i < 200; i++ {
		vy := pr.VY
		ex, _ := StepProjectile(w, pr, 1.0/60)
		if pr.VY > 0 && vy < 0 {
			bounced = true
		}
		if pr.Rest {
			rested = true
		}
		if ex {
			break
		}
		if pr.Y < -0.01 {
			t.Fatalf("grenade fell through floor: y=%v", pr.Y)
		}
	}
	if !bounced || !rested {
		t.Fatalf("bounced=%v rested=%v", bounced, rested)
	}
}

func TestShellExplodesOnWall(t *testing.T) {
	g := loadGame(t)
	w := MakeWorld(g.Maps["barnyard"])
	def := g.Weapon("souffle").Projectile
	// fire straight down from 2 units up: must explode just above the floor.
	pr := NewProjectile(1, 1, def, 10, 2, 10, 0, -30, 0)
	for i := 0; i < 60; i++ {
		if ex, p := StepProjectile(w, pr, 1.0/60); ex {
			if p[1] < 0 || p[1] > 0.1 {
				t.Fatalf("explode y=%v", p[1])
			}
			return
		}
	}
	t.Fatal("shell never exploded")
}

func TestClipAxisNoTunnel(t *testing.T) {
	g := loadGame(t)
	C := MakeConsts(g.Rules)
	w := &World{Boxes: []float64{-1, 0, -5, 1, 3, -4.9}, Count: 1}
	st := PlayerState{X: 0, Y: 0, Z: 0}
	// move a long way toward -Z through a 0.1 thick wall
	d := ClipAxis(w, C, &st, 2, -50)
	if !near(d, -(4.65-0.0)) && math.Abs(d+4.55) > 1e-9 {
		t.Fatalf("clip = %v", d)
	}
	if OverlapsSolid(w, C, st.X, st.Y, st.Z+d) {
		t.Fatal("overlap after clip")
	}
	_ = g
}

func TestSubWorldSameResults(t *testing.T) {
	g := loadGame(t)
	C := MakeConsts(g.Rules)
	for _, id := range []string{"barnyard", "hatchery"} {
		w := MakeWorld(g.Maps[id])
		var sub World
		for i := 0; i < 200; i++ {
			x, z := float64(i%20)*2.5-25, float64(i/20)*5-25
			SubWorld(&sub, w, [3]float64{x - 8, -75, z - 8}, [3]float64{x + 8, 10, z + 8})
			a := PlayerState{X: x, Y: 0.01, Z: z}
			b := a
			for k := 0; k < 14; k++ {
				StepMove(w, C, &a, KeyFwd, float64(i)*0.7, 1)
				StepMove(&sub, C, &b, KeyFwd, float64(i)*0.7, 1)
			}
			if a != b {
				t.Fatalf("%s #%d: full %+v sub %+v", id, i, a, b)
			}
		}
	}
}
