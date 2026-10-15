package game

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"yolkout/server/internal/sim"
)

func limitServer(t *testing.T, cfg Config) (*Manager, string) {
	g := loadGame(t)
	cfg.LimitLoopback = true
	m := NewManager(g, cfg, nil)
	srv := httptest.NewServer(m)
	t.Cleanup(func() { m.Shutdown(2 * time.Second); srv.Close() })
	return m, "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
}

func sayHello(t *testing.T, url, body string) map[string]any {
	t.Helper()
	c := dialWS(t, url)
	defer c.Close()
	_ = c.WriteMessage(websocket.TextMessage, []byte(body))
	for {
		_ = c.SetReadDeadline(time.Now().Add(2 * time.Second))
		_, b, err := c.ReadMessage()
		if err != nil {
			t.Fatalf("hello %s: %v", body, err)
		}
		if s := string(b); strings.Contains(s, `"t":"welcome"`) {
			return map[string]any{"t": "welcome"}
		} else if strings.Contains(s, `"t":"err"`) {
			i := strings.Index(s, `"code":"`) + 8
			return map[string]any{"t": "err", "code": s[i : i+strings.IndexByte(s[i:], '"')]}
		}
	}
}

func TestPerIPConnectionCap(t *testing.T) {
	_, url := limitServer(t, Config{MaxConnsPerIP: 3})
	var conns []*websocket.Conn
	for i := 0; i < 3; i++ {
		conns = append(conns, dialWS(t, url))
	}
	_, resp, err := websocket.DefaultDialer.Dial(url, nil)
	if err == nil || resp == nil || resp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("4th connection from one IP should get 429, got %v %v", resp, err)
	}
	conns[0].Close()
	deadline := time.Now().Add(15 * time.Second) // the server notices the close within the hello timeout
	for {
		c, _, err := websocket.DefaultDialer.Dial(url, nil)
		if err == nil {
			c.Close()
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("slot never freed after close")
		}
		time.Sleep(50 * time.Millisecond)
	}
	for _, c := range conns[1:] {
		c.Close()
	}
}

func TestPrivateRoomCreateLimits(t *testing.T) {
	m, url := limitServer(t, Config{MaxRooms: 4, MaxConnsPerIP: -1})
	create := `{"t":"hello","v":1,"create":1}`
	for i := 0; i < 2; i++ {
		if r := sayHello(t, url, create); r["t"] != "welcome" {
			t.Fatalf("create %d: %v", i, r)
		}
	}
	// private rooms are capped at MaxRooms/2, so public play still has slots
	if r := sayHello(t, url, create); r["code"] != "server_full" {
		t.Fatalf("3rd private room should be refused: %v", r)
	}
	if r := sayHello(t, url, `{"t":"hello","v":1}`); r["t"] != "welcome" {
		t.Fatalf("public quickplay must still work: %v", r)
	}
	// per-IP create rate (3 per minute): the refused create above did not spend a token
	m.mu.Lock()
	m.Cfg.MaxPrivateRooms = 100
	m.mu.Unlock()
	if r := sayHello(t, url, create); r["t"] != "welcome" {
		t.Fatalf("3rd create within budget: %v", r)
	}
	if r := sayHello(t, url, create); r["code"] != "too_many" {
		t.Fatalf("4th create within a minute should be rate limited: %v", r)
	}
}

func TestUnusedPrivateRoomExpiresFast(t *testing.T) {
	m, url := limitServer(t, Config{MaxConnsPerIP: -1, UnusedGrace: 100 * time.Millisecond})
	m.mu.Lock()
	r := m.createRoomLocked(m.modeFor("ffa"), "barnyard", true)
	m.mu.Unlock()
	_ = url
	deadline := time.Now().Add(3 * time.Second)
	for {
		m.mu.Lock()
		alive := m.rooms[r.Code] == r
		m.mu.Unlock()
		if !alive {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("never-used private room was not removed")
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestRoomCodeGuessingIsRateLimited(t *testing.T) {
	_, url := limitServer(t, Config{MaxConnsPerIP: -1})
	for i := 0; i < missBurst; i++ {
		if r := sayHello(t, url, `{"t":"hello","v":1,"room":"QQQQQQ"}`); r["code"] != "no_room" {
			t.Fatalf("guess %d: %v", i, r)
		}
	}
	if r := sayHello(t, url, `{"t":"hello","v":1,"room":"QQQQQQ"}`); r["code"] != "too_many" {
		t.Fatalf("guessing should be cut off: %v", r)
	}
}

func TestPanickedPrivateRoomIsUnregistered(t *testing.T) {
	m, url := limitServer(t, Config{MaxConnsPerIP: -1})
	c := dialWS(t, url)
	defer c.Close()
	_ = c.WriteMessage(websocket.TextMessage, []byte(`{"t":"hello","v":1,"create":1}`))
	w := readUntil(t, c, "welcome", 2*time.Second)
	code := w["room"].(map[string]any)["code"].(string)
	m.mu.Lock()
	r := m.rooms[code]
	m.mu.Unlock()
	r.enqueue(roomEvent{join: true, c: nil}) // nil client: addHuman panics in the room goroutine
	deadline := time.Now().Add(3 * time.Second)
	for {
		m.mu.Lock()
		_, still := m.rooms[code]
		m.mu.Unlock()
		if !still {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("crashed private room still registered")
		}
		time.Sleep(20 * time.Millisecond)
	}
	if r := sayHello(t, url, `{"t":"hello","v":1,"room":"`+code+`"}`); r["code"] != "no_room" {
		t.Fatalf("join to crashed room: %v", r)
	}
}

// The server consumes one input per tick while the backlog is small, so a
// batch of two never moves a player two steps in one tick.
func TestInputDejitter(t *testing.T) {
	h := newHarness(t, "ffa", 0)
	c, p := h.join("A", "benedict")
	h.ticks(10)
	for i := 0; i < 2; i++ {
		h.input(c, sim.KeyFwd, 0, 0, 0, 0)
	}
	a0 := p.Ack
	h.r.tick()
	if p.Ack-a0 != 1 {
		t.Fatalf("consumed %d inputs from a 2-input batch in one tick", p.Ack-a0)
	}
	h.r.tick()
	if p.Ack-a0 != 2 {
		t.Fatalf("second input not consumed on the next tick")
	}
}

// Starvation null inputs move the player but leave the weapon state alone, so
// a held trigger is not seen as a new press when the delayed inputs arrive.
func TestStarvationKeepsWeaponState(t *testing.T) {
	h := newHarness(t, "ffa", 0)
	c, p := h.join("A", "frittata") // burst rifle
	h.place(p, 0, 0, 0)
	h.ticks(5)
	h.input(c, 0, 0, 0, sim.BtnFire, 0)
	h.r.tick()
	ws0 := p.WS
	h.ticks(30) // starve
	if p.WS.Pb != ws0.Pb || p.WS.Mag != ws0.Mag || p.WS.Bl != ws0.Bl {
		t.Fatalf("null inputs changed weapon state: %+v -> %+v", ws0, p.WS)
	}
}

// Inputs sent while dead (still carrying the old slot) must not switch weapons
// right after respawn.
func TestDeadInputsDoNotSetSlot(t *testing.T) {
	h := newHarness(t, "ffa", 0)
	c, p := h.join("A", "benedict")
	p.Alive = false
	h.input(c, 0, 0, 0, 0, 1)
	h.r.tick()
	if p.Slot != 0 {
		t.Fatalf("dead input changed slot to %d", p.Slot)
	}
}
