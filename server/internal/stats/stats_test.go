package stats

import (
	"path/filepath"
	"testing"
)

func TestSaveLoadRoundTrip(t *testing.T) {
	p := filepath.Join(t.TempDir(), "sub", "stats.json")
	s, err := Open(p)
	if err != nil {
		t.Fatal(err)
	}
	s.AddKill("Eggbert", true, 3)
	s.AddKill("eggbert", false, 5)
	s.AddDeath("Yolko")
	s.AddScore("Eggbert", 250)
	s.AddMatch("Eggbert", true)
	if err := s.Save(); err != nil {
		t.Fatal(err)
	}
	s2, err := Open(p)
	if err != nil {
		t.Fatal(err)
	}
	top := s2.Top("score", 10)
	if len(top) != 2 || top[0].Kills != 2 || top[0].Headshots != 1 || top[0].BestStreak != 5 || top[0].Score != 250 || top[0].Wins != 1 {
		t.Fatalf("bad top: %+v", top)
	}
	if s2.Len() != 2 {
		t.Fatalf("len %d", s2.Len())
	}
}
