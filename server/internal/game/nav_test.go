package game

import "testing"

// Every spawn must have a nav path to both nests and every pickup, or bots cannot play the map.
func TestNavGraphConnectsObjectives(t *testing.T) {
	g := loadGame(t)
	m := NewManager(g, Config{}, nil)
	nestMode := g.Modes.Modes["nest"]
	for _, mapID := range nestMode.Maps {
		r := newRoom(m, "NAV01", nestMode, mapID, false, 1)
		var goals [][3]float64
		for _, n := range r.Map.Nests {
			goals = append(goals, n.Pos)
		}
		for _, pk := range r.Map.Pickups {
			goals = append(goals, pk.Pos)
		}
		for i, s := range r.Map.Spawns {
			a := r.nav.nodeAt(s.Pos[0], s.Pos[1], s.Pos[2])
			for _, gp := range goals {
				if r.navS.findPath(r.nav, a, r.nav.nodeAt(gp[0], gp[1], gp[2])) == nil {
					t.Errorf("%s: no nav path from spawn %d to %v", mapID, i, gp)
				}
			}
		}
	}
}
