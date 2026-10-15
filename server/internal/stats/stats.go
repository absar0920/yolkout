// Package stats keeps a small persistent leaderboard (JSON file, written
// atomically via temp file + rename). Names are not authenticated; this is
// a casual, per-server "hall of fame".
package stats

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// Entry is one player's lifetime totals.
type Entry struct {
	Name       string `json:"n"`
	Kills      int    `json:"ki"`
	Deaths     int    `json:"de"`
	Headshots  int    `json:"hs"`
	Score      int    `json:"sc"`
	Wins       int    `json:"wi"`
	Matches    int    `json:"mp"`
	BestStreak int    `json:"bs"`
	Captures   int    `json:"ca"`
	Last       int64  `json:"t"`
}

// Store is the leaderboard.
type Store struct {
	path string
	max  int

	mu    sync.Mutex
	m     map[string]*Entry
	dirty bool
	saved time.Time
}

type fileFormat struct {
	Version int      `json:"version"`
	Players []*Entry `json:"players"`
}

// Open loads path (a missing file is fine). path "" keeps stats in memory only.
func Open(path string) (*Store, error) {
	s := &Store{path: path, max: 20000, m: map[string]*Entry{}}
	if path == "" {
		return s, nil
	}
	b, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return s, err
	}
	var f fileFormat
	if err := json.Unmarshal(b, &f); err != nil {
		return s, err
	}
	for _, e := range f.Players {
		if e != nil && e.Name != "" {
			s.m[key(e.Name)] = e
		}
	}
	return s, nil
}

func key(name string) string { return strings.ToLower(name) }

func (s *Store) update(name string, fn func(e *Entry)) {
	if name == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	e := s.m[key(name)]
	if e == nil {
		if len(s.m) >= s.max {
			s.pruneLocked()
		}
		e = &Entry{Name: name}
		s.m[key(name)] = e
	}
	e.Name = name
	e.Last = time.Now().Unix()
	fn(e)
	s.dirty = true
}

// pruneLocked drops the 10% least valuable entries.
func (s *Store) pruneLocked() {
	all := make([]*Entry, 0, len(s.m))
	for _, e := range s.m {
		all = append(all, e)
	}
	sort.Slice(all, func(i, j int) bool {
		if all[i].Score != all[j].Score {
			return all[i].Score < all[j].Score
		}
		return all[i].Last < all[j].Last
	})
	for _, e := range all[:len(all)/10+1] {
		delete(s.m, key(e.Name))
	}
}

// AddKill records a kill (and the killer's current streak).
func (s *Store) AddKill(name string, headshot bool, streak int) {
	s.update(name, func(e *Entry) {
		e.Kills++
		if headshot {
			e.Headshots++
		}
		if streak > e.BestStreak {
			e.BestStreak = streak
		}
	})
}

// AddDeath records a death.
func (s *Store) AddDeath(name string) { s.update(name, func(e *Entry) { e.Deaths++ }) }

// AddScore adds score points.
func (s *Store) AddScore(name string, n int) { s.update(name, func(e *Entry) { e.Score += n }) }

// AddCapture records a Nest Raid capture.
func (s *Store) AddCapture(name string) { s.update(name, func(e *Entry) { e.Captures++ }) }

// AddMatch records a finished match.
func (s *Store) AddMatch(name string, won bool) {
	s.update(name, func(e *Entry) {
		e.Matches++
		if won {
			e.Wins++
		}
	})
}

// Top returns up to n entries ordered by field ("score", "kills", "wins", "kd", "streak").
func (s *Store) Top(by string, n int) []Entry {
	s.mu.Lock()
	all := make([]Entry, 0, len(s.m))
	for _, e := range s.m {
		all = append(all, *e)
	}
	s.mu.Unlock()
	val := func(e *Entry) float64 {
		switch by {
		case "kills":
			return float64(e.Kills)
		case "wins":
			return float64(e.Wins)
		case "streak":
			return float64(e.BestStreak)
		case "kd":
			if e.Kills < 10 {
				return -1
			}
			return float64(e.Kills) / float64(max(1, e.Deaths))
		case "captures":
			return float64(e.Captures)
		}
		return float64(e.Score)
	}
	sort.Slice(all, func(i, j int) bool {
		a, b := val(&all[i]), val(&all[j])
		if a != b {
			return a > b
		}
		return strings.ToLower(all[i].Name) < strings.ToLower(all[j].Name)
	})
	if len(all) > n {
		all = all[:n]
	}
	return all
}

// Len returns the number of tracked players.
func (s *Store) Len() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.m)
}

// Save writes the file atomically if anything changed.
func (s *Store) Save() error {
	if s.path == "" {
		return nil
	}
	s.mu.Lock()
	if !s.dirty {
		s.mu.Unlock()
		return nil
	}
	f := fileFormat{Version: 1, Players: make([]*Entry, 0, len(s.m))}
	for _, e := range s.m {
		c := *e
		f.Players = append(f.Players, &c)
	}
	s.dirty = false
	s.mu.Unlock()
	sort.Slice(f.Players, func(i, j int) bool { return key(f.Players[i].Name) < key(f.Players[j].Name) })
	b, err := json.Marshal(f)
	if err != nil {
		return err
	}
	if err := writeAtomic(s.path, b); err != nil {
		s.mu.Lock()
		s.dirty = true
		s.mu.Unlock()
		return err
	}
	return nil
}

func writeAtomic(path string, b []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".stats-*.tmp")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name) // no-op after a successful rename
	if _, err := tmp.Write(b); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(name, path); err != nil {
		return err
	}
	if d, err := os.Open(dir); err == nil {
		_ = d.Sync()
		d.Close()
	}
	return nil
}
