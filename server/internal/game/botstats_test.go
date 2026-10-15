package game

import (
	"math"
	"os"
	"strconv"
	"testing"
)

// botStats runs a headless match (one parked human plus bots) and reports
// kills, objective events and how long alive bots stood still.
func botStats(t *testing.T, mapID, mode string, fill int, seconds int) (kills, takes, caps int, still float64) {
	g := loadGame(t)
	m := NewManager(g, Config{BotFill: fill}, nil)
	r := newRoom(m, "BSTAT", g.Modes.Modes[mode], mapID, false, 1)
	h := &harness{t: t, g: g, m: m, r: r}
	c, human := h.join("Human", "benedict")
	human.ProtUntil = math.MaxInt64
	human.PS.Y = -1000 // parked out of the way; protected so never killed
	human.Alive = false
	tr := g.Rules.Net.TickRate
	last := map[int][2]float64{}
	for i := 0; i < tr*seconds; i++ {
		r.tick()
		if i%tr == 0 {
			for _, p := range r.players {
				if p.bot == nil || !p.Alive {
					delete(last, p.ID)
					continue
				}
				if l, ok := last[p.ID]; ok && math.Hypot(p.PS.X-l[0], p.PS.Z-l[1]) < 0.5 {
					still++
				}
				last[p.ID] = [2]float64{p.PS.X, p.PS.Z}
			}
			for _, ms := range msgs(t, c) {
				switch ms["t"] {
				case "kill":
					kills++
				case "flag":
					switch ms["ev"] {
					case "take":
						takes++
					case "cap":
						caps++
					}
				}
			}
		}
	}
	return
}

// TestBotStats is a manual balance probe: YOLKOUT_BOTSTATS=<seconds> go test -run TestBotStats -v
func TestBotStats(t *testing.T) {
	sec, _ := strconv.Atoi(os.Getenv("YOLKOUT_BOTSTATS"))
	if sec <= 0 {
		t.Skip("set YOLKOUT_BOTSTATS=<seconds>")
	}
	for _, mode := range []string{"nest", "ffa"} {
		for _, mapID := range []string{"barnyard", "countertop", "hatchery", "diner"} {
			k, tk, cp, st := botStats(t, mapID, mode, 10, sec)
			t.Logf("%-5s %-10s kills %3d takes %2d caps %2d still %4.0f bot-s", mode, mapID, k, tk, cp, st)
		}
	}
}
