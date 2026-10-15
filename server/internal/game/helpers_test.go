package game

import (
	"encoding/json"
	"path/filepath"
	"testing"

	"yolkout/server/internal/data"
	"yolkout/server/internal/sim"
)

const sharedDir = "../../../shared"

func loadGame(t testing.TB) *data.Game {
	t.Helper()
	g, err := data.Load(filepath.Join(sharedDir, "data"))
	if err != nil {
		t.Fatal(err)
	}
	// a flat open test arena: floor at y=0, 80x80
	f := false
	_ = f
	m := &data.Map{Format: 1, ID: "flat", Name: "Flat", Modes: []string{"ffa", "teams", "nest"}}
	m.Bounds.Min = [3]float64{-40, -10, -40}
	m.Bounds.Max = [3]float64{40, 30, 40}
	m.Boxes = []data.Box{{Min: [3]float64{-40, -1, -40}, Max: [3]float64{40, 0, 40}, Mat: "x"}}
	m.Spawns = []data.Spawn{{Pos: [3]float64{-30, 0, -30}, Team: 1}, {Pos: [3]float64{30, 0, 30}, Team: 2}, {Pos: [3]float64{-30, 0, 30}, Team: 0}, {Pos: [3]float64{30, 0, -30}, Team: 0}}
	m.Pickups = []data.Pickup{{Type: "hp", Pos: [3]float64{5, 0, 5}}, {Type: "ammo", Pos: [3]float64{-5, 0, -5}}, {Type: "shield", Pos: [3]float64{5, 0, -5}}}
	m.Nests = []data.Nest{{Team: 1, Pos: [3]float64{-20, 0, 0}}, {Team: 2, Pos: [3]float64{20, 0, 0}}}
	g.Maps["flat"] = m
	return g
}

type harness struct {
	t *testing.T
	g *data.Game
	m *Manager
	r *Room
}

func newHarness(t *testing.T, mode string, bots int) *harness {
	g := loadGame(t)
	m := NewManager(g, Config{BotFill: bots}, nil)
	r := newRoom(m, "TESTX", g.Modes.Modes[mode], "flat", false, 1)
	return &harness{t: t, g: g, m: m, r: r}
}

func (h *harness) fakeClient() *Client {
	return &Client{mgr: h.m, send: make(chan frame, 100000), done: make(chan struct{})}
}

// join adds a human and processes the join tick.
func (h *harness) join(name, cls string) (*Client, *Player) {
	c := h.fakeClient()
	h.r.enqueue(roomEvent{join: true, c: c, hello: hello{name: name, cls: cls, cos: defaultCos(h.g)}})
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

// msgs drains every message sent to c, flattening array frames.
func msgs(t testing.TB, c *Client) []map[string]any {
	var out []map[string]any
	for {
		select {
		case f := <-c.send:
			if len(f.data) == 0 {
				continue
			}
			var arr []map[string]any
			if f.data[0] == '[' {
				if err := json.Unmarshal(f.data, &arr); err != nil {
					t.Fatalf("bad frame json: %v: %s", err, f.data)
				}
			} else {
				var one map[string]any
				if err := json.Unmarshal(f.data, &one); err != nil {
					t.Fatalf("bad frame json: %v: %s", err, f.data)
				}
				arr = []map[string]any{one}
			}
			out = append(out, arr...)
		default:
			return out
		}
	}
}

func ofType(ms []map[string]any, t string) []map[string]any {
	var out []map[string]any
	for _, m := range ms {
		if m["t"] == t {
			out = append(out, m)
		}
	}
	return out
}

// place puts p at (x,y,z) standing, unprotected.
func (h *harness) place(p *Player, x, y, z float64) {
	p.PS = sim.PlayerState{X: x, Y: y, Z: z, OnGround: true}
	p.ProtUntil = 0
}

// input queues one input for c with the next seq.
func (h *harness) input(c *Client, keys int, yaw, pitch float64, buttons, slot int) {
	c.mu.Lock()
	c.lastSeq++
	c.inputs = append(c.inputs, sim.Input{Seq: c.lastSeq, Keys: keys, Yaw: yaw, Pitch: pitch, Buttons: buttons, Slot: slot, Rt: float64(h.r.k)})
	c.mu.Unlock()
}

func (h *harness) ticks(n int) {
	for i := 0; i < n; i++ {
		h.r.tick()
	}
}
