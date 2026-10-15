package game

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func dialWS(t *testing.T, url string) *websocket.Conn {
	t.Helper()
	c, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

// readUntil reads frames until a message of type typ arrives (or times out).
func readUntil(t *testing.T, c *websocket.Conn, typ string, d time.Duration) map[string]any {
	t.Helper()
	deadline := time.Now().Add(d)
	for time.Now().Before(deadline) {
		_ = c.SetReadDeadline(deadline)
		_, b, err := c.ReadMessage()
		if err != nil {
			t.Fatalf("waiting for %s: %v", typ, err)
		}
		var arr []map[string]any
		if b[0] == '[' {
			if err := json.Unmarshal(b, &arr); err != nil {
				t.Fatalf("bad json %s", b)
			}
		} else {
			var m map[string]any
			if err := json.Unmarshal(b, &m); err != nil {
				t.Fatalf("bad json %s", b)
			}
			arr = append(arr, m)
		}
		for _, m := range arr {
			if m["t"] == typ {
				return m
			}
		}
	}
	t.Fatalf("timeout waiting for %s", typ)
	return nil
}

func TestWebSocketEndToEnd(t *testing.T) {
	g := loadGame(t)
	m := NewManager(g, Config{BotFill: 3}, nil)
	srv := httptest.NewServer(m)
	defer srv.Close()
	defer m.Shutdown(2 * time.Second)
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"

	c := dialWS(t, url)
	defer c.Close()
	hello := `{"t":"hello","v":1,"name":"Tester","cls":"poacher","cos":{"hat":"cap","color":"mint","stamp":"star"},"mode":"ffa","map":"diner","room":"","create":0}`
	if err := c.WriteMessage(websocket.TextMessage, []byte(hello)); err != nil {
		t.Fatal(err)
	}
	w := readUntil(t, c, "welcome", 2*time.Second)
	room := w["room"].(map[string]any)
	if room["map"] != "diner" || room["mode"] != "ffa" || len(room["code"].(string)) != g.Rules.Rooms.CodeLength {
		t.Fatalf("welcome %v", w)
	}
	readUntil(t, c, "spawn", time.Second)
	s := readUntil(t, c, "s", time.Second)
	if s["me"] == nil {
		t.Fatal("snapshot without me")
	}
	// send inputs and a ping; expect acks and a pong
	for i := 1; i <= 20; i++ {
		_ = c.WriteMessage(websocket.TextMessage, []byte(`{"t":"i","b":[[`+itoa(i)+`,1,0.5,0,0,0,0]]}`))
	}
	_ = c.WriteMessage(websocket.TextMessage, []byte(`{"t":"ping","c":123456,"rtt":0}`))
	p := readUntil(t, c, "pong", time.Second)
	if p["c"].(float64) != 123456 {
		t.Fatalf("pong %v", p)
	}
	deadline := time.Now().Add(2 * time.Second)
	for {
		s = readUntil(t, c, "s", time.Second)
		if s["a"].(float64) == 20 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("ack never reached 20: %v", s["a"])
		}
	}
	// bots joined
	if n := len(s["p"].([]any)); n != 3 {
		t.Fatalf("expected 3 players (1 + 2 bots), got %d", n)
	}
	// public room listed
	if rooms := m.PublicRooms(); len(rooms) != 1 || rooms[0].Humans != 1 {
		t.Fatalf("rooms %+v", rooms)
	}

	// join by code from a second client; then a bad code and a bad version
	c2 := dialWS(t, url)
	defer c2.Close()
	_ = c2.WriteMessage(websocket.TextMessage, []byte(`{"t":"hello","v":1,"name":"Two","room":"`+strings.ToLower(room["code"].(string))+`"}`))
	w2 := readUntil(t, c2, "welcome", 2*time.Second)
	if w2["room"].(map[string]any)["code"] != room["code"] {
		t.Fatal("join by code went elsewhere")
	}
	c3 := dialWS(t, url)
	defer c3.Close()
	_ = c3.WriteMessage(websocket.TextMessage, []byte(`{"t":"hello","v":1,"room":"ZZZZZ"}`))
	if e := readUntil(t, c3, "err", time.Second); e["code"] != "no_room" {
		t.Fatalf("err %v", e)
	}
	c4 := dialWS(t, url)
	defer c4.Close()
	_ = c4.WriteMessage(websocket.TextMessage, []byte(`{"t":"hello","v":99}`))
	if e := readUntil(t, c4, "err", time.Second); e["code"] != "version" {
		t.Fatalf("err %v", e)
	}
	c5 := dialWS(t, url)
	defer c5.Close()
	_ = c5.WriteMessage(websocket.TextMessage, []byte(`{"t":"hello","v":1,"create":1,"mode":"nest"}`))
	w5 := readUntil(t, c5, "welcome", time.Second)
	if w5["room"].(map[string]any)["priv"].(float64) != 1 || w5["o"] == nil {
		t.Fatalf("private nest room %v", w5)
	}
	if len(m.PublicRooms()) != 1 {
		t.Fatal("private rooms must not be listed")
	}
	// oversize frame
	_ = c5.WriteMessage(websocket.TextMessage, []byte(`{"t":"chat","m":"`+strings.Repeat("x", 5000)+`"}`))
	if e := readUntil(t, c5, "err", time.Second); e["code"] != "too_big" {
		t.Fatalf("err %v", e)
	}
	// malformed json
	_ = c2.WriteMessage(websocket.TextMessage, []byte(`{nope`))
	if e := readUntil(t, c2, "err", time.Second); e["code"] != "bad_msg" {
		t.Fatalf("err %v", e)
	}
	// closing the last human destroys the public room
	c.Close()
	deadline = time.Now().Add(2 * time.Second)
	for len(m.PublicRooms()) != 0 {
		if time.Now().After(deadline) {
			t.Fatal("public room not destroyed after everyone left")
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func itoa(i int) string { return strings.TrimSpace(strings.Repeat(" ", 0) + string(appendInt(nil, i))) }

// Regression: Shutdown must not return before the "restarting" notice and the 1001 close
// frame are on the wire (the process exits right after it).
func TestShutdownFlushesGoingAway(t *testing.T) {
	g := loadGame(t)
	m := NewManager(g, Config{BotFill: 0}, nil)
	srv := httptest.NewServer(m)
	defer srv.Close()
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
	c := dialWS(t, url)
	defer c.Close()
	if err := c.WriteMessage(websocket.TextMessage, []byte(`{"t":"hello","v":1,"name":"Bye","mode":"ffa"}`)); err != nil {
		t.Fatal(err)
	}
	readUntil(t, c, "welcome", 2*time.Second)
	m.Shutdown(3 * time.Second)
	sys := readUntil(t, c, "sys", time.Second)
	if !strings.Contains(sys["m"].(string), "restarting") {
		t.Fatalf("sys %v", sys)
	}
	_ = c.SetReadDeadline(time.Now().Add(time.Second))
	for {
		_, _, err := c.ReadMessage()
		if err == nil {
			continue
		}
		if !websocket.IsCloseError(err, websocket.CloseGoingAway) {
			t.Fatalf("want close 1001, got %v", err)
		}
		break
	}
}
