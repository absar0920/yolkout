package game

import (
	"math"
	"sync"

	"yolkout/server/internal/data"
	"yolkout/server/internal/sim"
)

// Coarse walk/jump/drop graph for bot pathfinding: the Go port of the
// reachability graph in scripts/validate-maps.mjs. One node per standable
// box top in each 0.5u grid cell; edges join 4-neighbour cells the player can
// walk, step, jump up (<= safe jump height) or drop between.

const navCell = 0.5

type navNode struct {
	i, k  int32
	x, z  float64
	h     float64
	edges []int32
}

type navGraph struct {
	min    [3]float64
	nx, nz int
	cells  [][]int32 // per cell: node ids, by cell index i*nz+k
	nodes  []navNode
}

// navCache builds each map's graph once per process (maps are immutable).
type navCache struct {
	mu sync.Mutex
	m  map[*data.Map]*navEntry
}

type navEntry struct {
	once sync.Once
	g    *navGraph
}

func (c *navCache) get(m *data.Map, C *sim.Consts) *navGraph {
	c.mu.Lock()
	if c.m == nil {
		c.m = map[*data.Map]*navEntry{}
	}
	e := c.m[m]
	if e == nil {
		e = &navEntry{}
		c.m[m] = e
	}
	c.mu.Unlock()
	e.once.Do(func() { e.g = buildNav(m, C) })
	return e.g
}

func buildNav(m *data.Map, C *sim.Consts) *navGraph {
	w := sim.MakeWorld(m)
	bmin, bmax := m.Bounds.Min, m.Bounds.Max
	g := &navGraph{min: bmin, nx: int(math.Round((bmax[0] - bmin[0]) / navCell)), nz: int(math.Round((bmax[2] - bmin[2]) / navCell))}
	if g.nx <= 0 || g.nz <= 0 {
		return g
	}
	jumpUp := C.JumpVelocity*C.JumpVelocity/(2*C.Gravity) - 0.15
	probe := *C
	probe.HalfWidth = 0.2

	// bin boxes by cell (with a 1u margin) so every overlap test only sees nearby boxes
	n := g.nx * g.nz
	bins := make([][]int32, n)
	for b := 0; b < w.Count; b++ {
		o := b * 6
		i0, i1 := g.cellRange(w.Boxes[o]-1, w.Boxes[o+3]+1, 0)
		k0, k1 := g.cellRange(w.Boxes[o+2]-1, w.Boxes[o+5]+1, 2)
		for i := i0; i <= i1; i++ {
			for k := k0; k <= k1; k++ {
				bins[i*g.nz+k] = append(bins[i*g.nz+k], int32(b))
			}
		}
	}
	local := func(ci int, dst *sim.World) *sim.World {
		dst.Boxes = dst.Boxes[:0]
		for _, b := range bins[ci] {
			dst.Boxes = append(dst.Boxes, w.Boxes[b*6:b*6+6]...)
		}
		dst.Count = len(dst.Boxes) / 6
		return dst
	}

	g.cells = make([][]int32, n)
	var lw sim.World
	hw := C.HalfWidth - 0.05
	for i := 0; i < g.nx; i++ {
		for k := 0; k < g.nz; k++ {
			ci := i*g.nz + k
			cx, cz := bmin[0]+navCell*(float64(i)+0.5), bmin[2]+navCell*(float64(k)+0.5)
			lwp := local(ci, &lw)
			var tops []float64
			for b := 0; b < lwp.Count; b++ {
				B := lwp.Boxes[b*6:]
				if cx+hw > B[0] && cx-hw < B[3] && cz+hw > B[2] && cz-hw < B[5] {
					h, dup := B[4], false
					for _, t := range tops {
						dup = dup || t == h
					}
					if !dup {
						tops = append(tops, h)
					}
				}
			}
			for _, h := range tops {
				if !sim.OverlapsSolid(lwp, C, cx, h, cz) {
					g.cells[ci] = append(g.cells[ci], int32(len(g.nodes)))
					g.nodes = append(g.nodes, navNode{i: int32(i), k: int32(k), x: cx, z: cz, h: h})
				}
			}
		}
	}
	dirs := [4][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}}
	for id := range g.nodes {
		nd := &g.nodes[id]
		lwp := local(int(nd.i)*g.nz+int(nd.k), &lw)
		for _, d := range dirs {
			ni, nk := int(nd.i)+d[0], int(nd.k)+d[1]
			if ni < 0 || nk < 0 || ni >= g.nx || nk >= g.nz {
				continue
			}
			for _, mid := range g.cells[ni*g.nz+nk] {
				mn := &g.nodes[mid]
				dh := mn.h - nd.h
				if dh > jumpUp {
					continue
				}
				top := math.Max(nd.h, mn.h)
				if sim.OverlapsSolid(lwp, &probe, (nd.x+mn.x)/2, top+0.001, (nd.z+mn.z)/2) {
					continue
				}
				if dh > C.StepHeight && sim.OverlapsSolid(lwp, &probe, nd.x, mn.h+0.001, nd.z) {
					continue // no headroom to jump
				}
				nd.edges = append(nd.edges, mid)
			}
		}
	}
	return g
}

// cellRange returns the clamped cell index range covering [lo, hi] on axis a (0 or 2).
func (g *navGraph) cellRange(lo, hi float64, a int) (int, int) {
	nmax := g.nx - 1
	if a == 2 {
		nmax = g.nz - 1
	}
	c0 := int(math.Floor((lo - g.min[a]) / navCell))
	c1 := int(math.Floor((hi - g.min[a]) / navCell))
	return max(0, min(nmax, c0)), max(0, min(nmax, c1))
}

// nodeAt returns the node that best matches a standing point (x, y, z): the
// nearest one within 1.5u horizontally whose top is at or a little above y,
// preferring tops right under the point. -1 when there is none.
func (g *navGraph) nodeAt(x, y, z float64) int {
	if g == nil || len(g.nodes) == 0 {
		return -1
	}
	i0, i1 := g.cellRange(x-1.5, x+1.5, 0)
	k0, k1 := g.cellRange(z-1.5, z+1.5, 2)
	best, bestS := -1, math.Inf(1)
	for i := i0; i <= i1; i++ {
		for k := k0; k <= k1; k++ {
			for _, id := range g.cells[i*g.nz+k] {
				nd := &g.nodes[id]
				if nd.h > y+0.6 {
					continue
				}
				s := math.Hypot(nd.x-x, nd.z-z) + 0.5*(y-nd.h)
				if s < bestS {
					best, bestS = int(id), s
				}
			}
		}
	}
	return best
}

// navSearch is per-room A* scratch (rooms are single-goroutine).
type navSearch struct {
	gen  uint32
	seen []uint32
	cost []float32
	from []int32
	open navHeap
	path []int32
}

type navItem struct {
	f  float32
	id int32
}

// navHeap is a binary min-heap on f (typed, no interface boxing).
type navHeap []navItem

func (h *navHeap) push(it navItem) {
	*h = append(*h, it)
	a := *h
	for i := len(a) - 1; i > 0; {
		p := (i - 1) / 2
		if a[p].f <= a[i].f {
			break
		}
		a[p], a[i] = a[i], a[p]
		i = p
	}
}

func (h *navHeap) pop() navItem {
	a := *h
	top := a[0]
	n := len(a) - 1
	a[0] = a[n]
	a = a[:n]
	for i := 0; ; {
		l, m := 2*i+1, i
		if l < n && a[l].f < a[m].f {
			m = l
		}
		if l+1 < n && a[l+1].f < a[m].f {
			m = l + 1
		}
		if m == i {
			break
		}
		a[m], a[i] = a[i], a[m]
		i = m
	}
	*h = a
	return top
}

// findPath runs A* from node a to node b and returns the node ids from a to b
// (reusing s.path), or nil when b is unreachable.
func (s *navSearch) findPath(g *navGraph, a, b int) []int32 {
	if g == nil || a < 0 || b < 0 {
		return nil
	}
	n := len(g.nodes)
	if len(s.seen) != n {
		s.seen, s.cost, s.from, s.gen = make([]uint32, n), make([]float32, n), make([]int32, n), 0
	}
	s.gen++
	if s.gen == 0 {
		clear(s.seen)
		s.gen = 1
	}
	gx, gz := g.nodes[b].x, g.nodes[b].z
	hf := func(id int32) float32 {
		nd := &g.nodes[id]
		dx, dz := nd.x-gx, nd.z-gz
		return float32(math.Sqrt(dx*dx + dz*dz))
	}
	s.open = s.open[:0]
	s.seen[a], s.cost[a], s.from[a] = s.gen, 0, -1
	s.open.push(navItem{f: hf(int32(a)), id: int32(a)})
	found := false
	for len(s.open) > 0 {
		it := s.open.pop()
		v := it.id
		if int(v) == b {
			found = true
			break
		}
		if it.f-hf(v) > s.cost[v]+1e-4 {
			continue // stale entry
		}
		nv := &g.nodes[v]
		for _, w := range nv.edges {
			c := s.cost[v] + navCell
			if dh := g.nodes[w].h - nv.h; dh > 0.6 {
				c += 4 * navCell // prefer stairs and ramps over jumps
			}
			if s.seen[w] != s.gen || c < s.cost[w] {
				s.seen[w], s.cost[w], s.from[w] = s.gen, c, v
				s.open.push(navItem{f: c + hf(w), id: w})
			}
		}
	}
	if !found {
		return nil
	}
	s.path = s.path[:0]
	for v := int32(b); v >= 0; v = s.from[v] {
		s.path = append(s.path, v)
	}
	for i, j := 0, len(s.path)-1; i < j; i, j = i+1, j-1 {
		s.path[i], s.path[j] = s.path[j], s.path[i]
	}
	return s.path
}
