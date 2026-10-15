// Package data loads the shared game data files (shared/data/*.json):
// rules, weapons, modes, cosmetics and maps. Both the server and the browser
// client read these same files; nothing here is hard-coded.
package data

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
)

// Rules mirrors shared/data/rules.json.
type Rules struct {
	Version int `json:"version"`
	Net     struct {
		ProtocolVersion   int     `json:"protocolVersion"`
		TickRate          int     `json:"tickRate"`
		SnapshotEvery     int     `json:"snapshotEvery"`
		InterpDelayMs     float64 `json:"interpDelayMs"`
		MaxRewindTicks    int     `json:"maxRewindTicks"`
		HistoryTicks      int     `json:"historyTicks"`
		MaxInputsPerTick  int     `json:"maxInputsPerTick"`
		InputQueueMax     int     `json:"inputQueueMax"`
		InputTokenMax     int     `json:"inputTokenMax"`
		StarveTicks       int     `json:"starveTicks"`
		MaxPlayersPerRoom int     `json:"maxPlayersPerRoom"`
		IdleTimeoutSec    float64 `json:"idleTimeoutSec"`
		MaxMessageBytes   int     `json:"maxMessageBytes"`
		MaxInputsPerBatch int     `json:"maxInputsPerBatch"`
		HelloTimeoutSec   float64 `json:"helloTimeoutSec"`
	} `json:"net"`
	Player struct {
		HalfWidth  float64    `json:"halfWidth"`
		Height     float64    `json:"height"`
		EyeHeight  float64    `json:"eyeHeight"`
		HitCenterY float64    `json:"hitCenterY"`
		HitRadii   [3]float64 `json:"hitRadii"`
		HeadshotY  float64    `json:"headshotY"`
		MaxPitch   float64    `json:"maxPitch"`
	} `json:"player"`
	Move struct {
		MoveSpeed          float64 `json:"moveSpeed"`
		GroundAccel        float64 `json:"groundAccel"`
		AirAccel           float64 `json:"airAccel"`
		Gravity            float64 `json:"gravity"`
		JumpVelocity       float64 `json:"jumpVelocity"`
		TerminalVelocity   float64 `json:"terminalVelocity"`
		MaxHorizontalSpeed float64 `json:"maxHorizontalSpeed"`
		StepHeight         float64 `json:"stepHeight"`
		AdsMoveMul         float64 `json:"adsMoveMul"`
		Eps                float64 `json:"eps"`
	} `json:"move"`
	Combat struct {
		MaxHp                float64 `json:"maxHp"`
		MaxShield            float64 `json:"maxShield"`
		RegenDelay           float64 `json:"regenDelay"`
		RegenRate            float64 `json:"regenRate"`
		SpawnProtection      float64 `json:"spawnProtection"`
		SelfSplashMul        float64 `json:"selfSplashMul"`
		FriendlyFire         bool    `json:"friendlyFire"`
		MovingSpeedThreshold float64 `json:"movingSpeedThreshold"`
		KnockbackUp          float64 `json:"knockbackUp"`
	} `json:"combat"`
	Pickups struct {
		Radius float64               `json:"radius"`
		Types  map[string]PickupType `json:"types"`
	} `json:"pickups"`
	Streaks []Streak `json:"streaks"`
	Rooms   struct {
		CodeAlphabet    string  `json:"codeAlphabet"`
		CodeLength      int     `json:"codeLength"`
		IntermissionSec float64 `json:"intermissionSec"`
	} `json:"rooms"`
}

// PickupType is one entry of rules.pickups.types.
type PickupType struct {
	Name     string  `json:"name"`
	Amount   float64 `json:"amount"`
	Grenades int     `json:"grenades"`
	Respawn  float64 `json:"respawn"`
}

// Streak is one killstreak reward.
type Streak struct {
	At       int     `json:"at"`
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Desc     string  `json:"desc"`
	DmgMul   float64 `json:"dmgMul"`
	Duration float64 `json:"duration"`
}

// ProjectileDef is a weapon's projectile block.
type ProjectileDef struct {
	Kind         int     `json:"kind"`
	Speed        float64 `json:"speed"`
	Gravity      float64 `json:"gravity"`
	Radius       float64 `json:"radius"`
	Life         float64 `json:"life"`
	SplashRadius float64 `json:"splashRadius"`
	Knockback    float64 `json:"knockback"`
	Fuse         float64 `json:"fuse"`
	Bounce       float64 `json:"bounce"`
	Friction     float64 `json:"friction"`
}

// Weapon is any entry of weapons.json "weapons" (gun, grenade or melee).
type Weapon struct {
	ID           string         `json:"-"`
	Name         string         `json:"name"`
	Class        string         `json:"class"`
	Slot         int            `json:"slot"`
	Kind         string         `json:"kind"`
	FireMode     string         `json:"fireMode"`
	FireInterval float64        `json:"fireInterval"`
	BurstCount   int            `json:"burstCount"`
	BurstDelay   float64        `json:"burstDelay"`
	Damage       float64        `json:"damage"`
	MinDamage    float64        `json:"minDamage"`
	FalloffStart float64        `json:"falloffStart"`
	FalloffEnd   float64        `json:"falloffEnd"`
	Range        float64        `json:"range"`
	HeadMul      float64        `json:"headMul"`
	Pellets      int            `json:"pellets"`
	MagSize      int            `json:"magSize"`
	Reserve      int            `json:"reserve"`
	ReloadTime   float64        `json:"reloadTime"`
	SwitchTime   float64        `json:"switchTime"`
	HipSpread    float64        `json:"hipSpread"`
	AdsSpread    float64        `json:"adsSpread"`
	MoveSpread   float64        `json:"moveSpread"`
	BloomPerShot float64        `json:"bloomPerShot"`
	BloomMax     float64        `json:"bloomMax"`
	BloomRecover float64        `json:"bloomRecover"`
	MoveMul      float64        `json:"moveMul"`
	Projectile   *ProjectileDef `json:"projectile"`
	// grenade
	StartCount int     `json:"startCount"`
	MaxCount   int     `json:"maxCount"`
	Cooldown   float64 `json:"cooldown"`
	ThrowSpeed float64 `json:"throwSpeed"`
	ThrowUp    float64 `json:"throwUp"`
	InheritVel float64 `json:"inheritVel"`
	// melee
	Inflate float64 `json:"inflate"`
}

// Weapons mirrors shared/data/weapons.json.
type Weapons struct {
	Primaries      []string           `json:"primaries"`
	Secondary      string             `json:"secondary"`
	Grenade        string             `json:"grenade"`
	Melee          string             `json:"melee"`
	DefaultPrimary string             `json:"defaultPrimary"`
	Weapons        map[string]*Weapon `json:"weapons"`
}

// Mode is one game mode.
type Mode struct {
	ID           string         `json:"-"`
	Name         string         `json:"name"`
	Short        string         `json:"short"`
	Teams        bool           `json:"teams"`
	Objective    string         `json:"objective"`
	ScoreLimit   int            `json:"scoreLimit"`
	ScoreUnit    string         `json:"scoreUnit"`
	TimeLimitSec float64        `json:"timeLimitSec"`
	RespawnSec   float64        `json:"respawnSec"`
	Points       map[string]int `json:"points"`
	Nest         *struct {
		TouchRadius   float64 `json:"touchRadius"`
		DropReturnSec float64 `json:"dropReturnSec"`
	} `json:"nest"`
	Maps []string `json:"maps"`
}

// Modes mirrors shared/data/modes.json.
type Modes struct {
	DefaultMode string           `json:"defaultMode"`
	Modes       map[string]*Mode `json:"modes"`
}

// Cosmetics mirrors shared/data/cosmetics.json (only ids matter to the server).
type Cosmetics struct {
	Defaults struct {
		Hat   string `json:"hat"`
		Color string `json:"color"`
		Stamp string `json:"stamp"`
	} `json:"defaults"`
	Colors []struct {
		ID string `json:"id"`
	} `json:"colors"`
	Hats []struct {
		ID string `json:"id"`
	} `json:"hats"`
	Stamps []struct {
		ID string `json:"id"`
	} `json:"stamps"`
	ColorSet, HatSet, StampSet map[string]bool `json:"-"`
}

// Box is one map box.
type Box struct {
	Min   [3]float64 `json:"min"`
	Max   [3]float64 `json:"max"`
	Mat   string     `json:"mat"`
	Solid *bool      `json:"solid"`
}

// Spawn is one spawn point.
type Spawn struct {
	Pos  [3]float64 `json:"pos"`
	Yaw  float64    `json:"yaw"`
	Team int        `json:"team"`
}

// Pickup is one map pickup.
type Pickup struct {
	Type string     `json:"type"`
	Pos  [3]float64 `json:"pos"`
}

// Nest is a team's egg nest.
type Nest struct {
	Team int        `json:"team"`
	Pos  [3]float64 `json:"pos"`
}

// Map mirrors shared/data/maps/<id>.json (render-only fields are ignored).
type Map struct {
	Format int      `json:"format"`
	ID     string   `json:"id"`
	Name   string   `json:"name"`
	Modes  []string `json:"modes"`
	Bounds struct {
		Min [3]float64 `json:"min"`
		Max [3]float64 `json:"max"`
	} `json:"bounds"`
	KillY   *float64 `json:"killY"`
	Boxes   []Box    `json:"boxes"`
	Spawns  []Spawn  `json:"spawns"`
	Pickups []Pickup `json:"pickups"`
	Nests   []Nest   `json:"nests"`
}

// KillYValue returns killY, defaulting to bounds.min.y.
func (m *Map) KillYValue() float64 {
	if m.KillY != nil {
		return *m.KillY
	}
	return m.Bounds.Min[1]
}

// Game bundles every data file.
type Game struct {
	Dir       string
	Rules     *Rules
	Weapons   *Weapons
	Modes     *Modes
	Cosmetics *Cosmetics
	Maps      map[string]*Map
	MapIDs    []string
}

func readJSON(path string, v any) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(b, v); err != nil {
		return fmt.Errorf("%s: %w", path, err)
	}
	return nil
}

// Load reads every data file from dir (normally shared/data) and validates
// cross references.
func Load(dir string) (*Game, error) {
	g := &Game{Dir: dir, Rules: &Rules{}, Weapons: &Weapons{}, Modes: &Modes{}, Cosmetics: &Cosmetics{}, Maps: map[string]*Map{}}
	for _, f := range []struct {
		name string
		v    any
	}{{"rules.json", g.Rules}, {"weapons.json", g.Weapons}, {"modes.json", g.Modes}, {"cosmetics.json", g.Cosmetics}} {
		if err := readJSON(filepath.Join(dir, f.name), f.v); err != nil {
			return nil, err
		}
	}
	for id, w := range g.Weapons.Weapons {
		w.ID = id
	}
	for _, id := range append([]string{g.Weapons.Secondary, g.Weapons.Grenade, g.Weapons.Melee, g.Weapons.DefaultPrimary}, g.Weapons.Primaries...) {
		if g.Weapons.Weapons[id] == nil {
			return nil, fmt.Errorf("weapons.json: missing weapon %q", id)
		}
	}
	if g.Weapons.Weapons[g.Weapons.Grenade].Projectile == nil {
		return nil, fmt.Errorf("weapons.json: grenade has no projectile block")
	}
	for id, m := range g.Modes.Modes {
		m.ID = id
		if m.Points == nil {
			m.Points = map[string]int{}
		}
	}
	if g.Modes.Modes[g.Modes.DefaultMode] == nil {
		return nil, fmt.Errorf("modes.json: bad defaultMode")
	}
	c := g.Cosmetics
	c.ColorSet, c.HatSet, c.StampSet = map[string]bool{}, map[string]bool{}, map[string]bool{}
	for _, x := range c.Colors {
		c.ColorSet[x.ID] = true
	}
	for _, x := range c.Hats {
		c.HatSet[x.ID] = true
	}
	for _, x := range c.Stamps {
		c.StampSet[x.ID] = true
	}
	var idx struct {
		Maps []struct {
			ID string `json:"id"`
		} `json:"maps"`
	}
	if err := readJSON(filepath.Join(dir, "maps", "index.json"), &idx); err != nil {
		return nil, err
	}
	for _, e := range idx.Maps {
		m := &Map{}
		if err := readJSON(filepath.Join(dir, "maps", e.ID+".json"), m); err != nil {
			return nil, err
		}
		if m.ID == "" {
			m.ID = e.ID
		}
		if len(m.Spawns) == 0 {
			return nil, fmt.Errorf("map %s has no spawns", e.ID)
		}
		g.Maps[e.ID] = m
		g.MapIDs = append(g.MapIDs, e.ID)
	}
	sort.Strings(g.MapIDs)
	for _, m := range g.Modes.Modes {
		ok := m.Maps[:0]
		for _, id := range m.Maps {
			if g.Maps[id] != nil {
				ok = append(ok, id)
			}
		}
		m.Maps = ok
		if len(m.Maps) == 0 {
			return nil, fmt.Errorf("mode %s has no loadable maps", m.ID)
		}
	}
	if g.Rules.Net.TickRate <= 0 || g.Rules.Net.SnapshotEvery <= 0 {
		return nil, fmt.Errorf("rules.json: bad tick rate")
	}
	return g, nil
}

// Weapon returns a weapon def by id (nil if unknown).
func (g *Game) Weapon(id string) *Weapon { return g.Weapons.Weapons[id] }

// IsPrimary reports whether id is a selectable primary.
func (g *Game) IsPrimary(id string) bool {
	for _, p := range g.Weapons.Primaries {
		if p == id {
			return true
		}
	}
	return false
}
