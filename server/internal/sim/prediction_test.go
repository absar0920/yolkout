package sim

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// TestClientPredictionVectors replays shared/physics_vectors.json (generated from the web
// client's Predictor on the real maps with every primary) through the Go sim. If this
// passes, the server simulates exactly what the browser predicts for the same wire inputs,
// so reconciliation corrections stay at zero.
func TestClientPredictionVectors(t *testing.T) {
	g := loadGame(t)
	C := MakeConsts(g.Rules)
	b, err := os.ReadFile(filepath.Join(sharedDir, "physics_vectors.json"))
	if err != nil {
		t.Skip("no physics_vectors.json:", err)
	}
	var vec struct {
		Predict []struct {
			Name    string
			Map     string
			Primary string
			Melee   string
			Start   [3]float64
			Wire    [][6]float64
			Expect  [][8]float64
			FinalWs [15]float64
		}
	}
	if err := json.Unmarshal(b, &vec); err != nil {
		t.Fatal(err)
	}
	if len(vec.Predict) == 0 {
		t.Fatal("no prediction cases")
	}
	for _, c := range vec.Predict {
		m := g.Maps[c.Map]
		if m == nil {
			t.Fatalf("%s: unknown map %q", c.Name, c.Map)
		}
		w := MakeWorld(m)
		defs := DefsFor(g.Weapons, c.Primary, c.Melee)
		ps := PlayerState{X: c.Start[0], Y: c.Start[1], Z: c.Start[2], OnGround: true}
		ws := NewWeaponState(defs)
		var acts []Action
		for i, e := range c.Wire {
			in := Input{Seq: uint32(e[0]), Keys: int(e[1]), Yaw: e[2], Pitch: e[3], Buttons: int(e[4]), Slot: int(e[5])}
			acts = SimulateInput(acts[:0], w, C, defs, &ps, &ws, &in)
			got := [8]float64{ps.X, ps.Y, ps.Z, ps.VX, ps.VY, ps.VZ, b2f(ps.OnGround), float64(ps.Coy)}
			for j := range got {
				if !near(got[j], c.Expect[i][j]) {
					t.Fatalf("%s input %d field %d: got %v want %v", c.Name, i, j, got[j], c.Expect[i][j])
				}
			}
		}
		got := ws.Array()
		for j := range got {
			if !near(got[j], c.FinalWs[j]) {
				t.Fatalf("%s final ws[%d]: got %v want %v", c.Name, j, got[j], c.FinalWs[j])
			}
		}
	}
}
