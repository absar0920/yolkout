package game

import "testing"

// BenchmarkRoomTick12 measures one 60 Hz tick of a full room (1 human + 11 bots).
func BenchmarkRoomTick12(b *testing.B) {
	g := loadGame(b)
	m := NewManager(g, Config{BotFill: 12}, nil)
	r := newRoom(m, "BENCH", g.Modes.Modes["ffa"], "hatchery", false, 1)
	c := &Client{mgr: m, send: make(chan frame, 1<<20), done: make(chan struct{})}
	r.enqueue(roomEvent{join: true, c: c, hello: hello{name: "H", cls: "benedict", cos: defaultCos(g)}})
	r.reserved = 1
	for i := 0; i < 600; i++ {
		r.tick()
		for len(c.send) > 0 {
			<-c.send
		}
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		r.tick()
		for len(c.send) > 0 {
			<-c.send
		}
	}
}
