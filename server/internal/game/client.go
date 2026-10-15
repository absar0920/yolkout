package game

import (
	"encoding/json"
	"io"
	"math"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"

	"yolkout/server/internal/sim"
)

// frame is one outgoing WebSocket text frame. close=true sends the frame
// (if any) and then a close frame, and ends the connection.
type frame struct {
	data  []byte
	close bool
	code  int
}

// bucket is a simple token bucket.
type bucket struct {
	tokens, rate, burst float64
	last                time.Time
}

func newBucket(rate, burst float64) bucket { return bucket{tokens: burst, rate: rate, burst: burst} }

func (b *bucket) take(now time.Time) bool {
	if !b.last.IsZero() {
		b.tokens = math.Min(b.burst, b.tokens+now.Sub(b.last).Seconds()*b.rate)
	}
	b.last = now
	if b.tokens >= 1 {
		b.tokens--
		return true
	}
	return false
}

// ldReq is a pending loadout change.
type ldReq struct {
	cls *string
	cos *cosIn
}

type chatReq struct {
	m    string
	team bool
}

// Client is one WebSocket connection. The read goroutine fills the inbox
// (guarded by mu); the room goroutine drains it once per tick.
type Client struct {
	conn  *websocket.Conn
	mgr   *Manager
	send  chan frame
	done  chan struct{}
	wdone chan struct{} // closed when writePump exits
	once  sync.Once

	closing atomic.Bool
	room    atomic.Pointer[Room]

	// queued is owned by the room goroutine (inputs moved out of the inbox).
	queued []sim.Input

	mu        sync.Mutex
	inputs    []sim.Input
	lastSeq   uint32
	lds       []ldReq
	chats     []chatReq
	notes     []string
	rtt       int
	lastInput time.Time
	badInputs int
}

func newClient(conn *websocket.Conn, mgr *Manager) *Client {
	return &Client{conn: conn, mgr: mgr, send: make(chan frame, 256), done: make(chan struct{}), wdone: make(chan struct{}), lastInput: time.Now()}
}

// SendFrame queues one frame; a client that cannot keep up is dropped.
func (c *Client) SendFrame(b []byte) {
	if c.closing.Load() {
		return
	}
	select {
	case c.send <- frame{data: b}:
	default:
		c.kill()
	}
}

// fail sends an err message and closes the connection.
func (c *Client) fail(code string) {
	if c.closing.Swap(true) {
		return
	}
	select {
	case c.send <- frame{data: encodeErr(code), close: true, code: websocket.ClosePolicyViolation}:
	default:
		c.kill()
	}
}

// closeGoingAway closes with 1001 after flushing an optional message.
func (c *Client) closeGoingAway(msg []byte) {
	if c.closing.Swap(true) {
		return
	}
	select {
	case c.send <- frame{data: msg, close: true, code: websocket.CloseGoingAway}:
	default:
		c.kill()
	}
}

func (c *Client) kill() {
	c.once.Do(func() {
		c.closing.Store(true)
		close(c.done)
		if c.conn != nil {
			_ = c.conn.Close()
		}
	})
}

// compressMin is the smallest frame worth deflating (when the peer negotiated it).
const compressMin = 256

func (c *Client) writePump() {
	defer close(c.wdone)
	defer c.kill()
	for {
		select {
		case <-c.done:
			return
		case f := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if f.data != nil {
				c.conn.EnableWriteCompression(len(f.data) >= compressMin)
				if err := c.conn.WriteMessage(websocket.TextMessage, f.data); err != nil {
					return
				}
			}
			if f.close {
				_ = c.conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(f.code, ""), time.Now().Add(2*time.Second))
				time.Sleep(50 * time.Millisecond)
				return
			}
		}
	}
}

// readFrame reads one text frame of at most limit bytes.
// Returns ("", errCode) for protocol problems, or a network error.
func (c *Client) readFrame(limit int) ([]byte, string, error) {
	mt, r, err := c.conn.NextReader()
	if err != nil {
		return nil, "", err
	}
	b, err := io.ReadAll(io.LimitReader(r, int64(limit)+1))
	if err != nil {
		return nil, "", err
	}
	if len(b) > limit {
		return nil, "too_big", nil
	}
	if mt != websocket.TextMessage {
		return nil, "bad_msg", nil
	}
	return b, "", nil
}

// serve runs the connection: hello, join, then the read loop.
func (c *Client) serve() {
	m := c.mgr
	net := &m.G.Rules.Net
	m.goWriter(c)
	defer func() {
		if r := c.room.Load(); r != nil {
			m.leave(c, r)
		}
		if c.closing.Load() { // let the writer flush a final err/close frame
			select {
			case <-c.wdone:
			case <-time.After(3 * time.Second):
			}
		}
		c.kill()
		m.conns.Add(-1)
	}()
	c.conn.SetReadLimit(1 << 16)
	_ = c.conn.SetReadDeadline(time.Now().Add(time.Duration(net.HelloTimeoutSec * float64(time.Second))))
	b, code, err := c.readFrame(net.MaxMessageBytes)
	if err != nil {
		return
	}
	if code != "" {
		c.fail(code)
		return
	}
	var h inMsg
	if json.Unmarshal(b, &h) != nil || h.T != "hello" {
		c.fail("bad_hello")
		return
	}
	if h.V != net.ProtocolVersion {
		c.fail("version")
		return
	}
	if code := m.join(c, &h); code != "" {
		c.fail(code)
		return
	}
	all := newBucket(120, 120)
	chatB, ldB, pingB := newBucket(1, 3), newBucket(2, 2), newBucket(2, 2)
	for {
		_ = c.conn.SetReadDeadline(time.Now().Add(30 * time.Second))
		b, code, err := c.readFrame(net.MaxMessageBytes)
		if err != nil || c.closing.Load() {
			return
		}
		if code != "" {
			c.fail(code)
			return
		}
		now := time.Now()
		if !all.take(now) {
			c.fail("rate")
			return
		}
		var msg inMsg
		if json.Unmarshal(b, &msg) != nil {
			c.fail("bad_msg")
			return
		}
		switch msg.T {
		case "i":
			if !c.pushInputs(msg.B, now) {
				c.fail("bad_msg")
				return
			}
		case "ping":
			if !pingB.take(now) {
				continue
			}
			c.mu.Lock()
			c.rtt = int(math.Max(0, math.Min(9999, msg.Rtt)))
			c.mu.Unlock()
			var k int64
			if r := c.room.Load(); r != nil {
				k = r.curK.Load()
			}
			out := append([]byte(`{"t":"pong","c":`), appendFloat(nil, msg.C)...)
			out = append(out, `,"k":`...)
			out = appendInt(out, int(k))
			out = append(out, '}')
			c.SendFrame(out)
		case "ld":
			if !ldB.take(now) {
				continue
			}
			c.mu.Lock()
			if len(c.lds) < 4 {
				c.lds = append(c.lds, ldReq{cls: msg.Cls, cos: msg.Cos})
			}
			c.mu.Unlock()
		case "chat":
			ok := chatB.take(now)
			c.mu.Lock()
			if ok {
				if len(c.chats) < 4 {
					c.chats = append(c.chats, chatReq{m: msg.M, team: msg.Tm == 1})
				}
			} else if len(c.notes) < 2 {
				c.notes = append(c.notes, "You are chatting too fast.")
			}
			c.mu.Unlock()
		default:
			// unknown and repeated hello messages are ignored
		}
	}
}

// pushInputs validates an input batch (PROTOCOL.md 13.2) and queues it.
// Returns false when the client should be dropped for repeated garbage.
func (c *Client) pushInputs(entries [][]float64, now time.Time) bool {
	net := &c.mgr.G.Rules.Net
	if len(entries) > net.MaxInputsPerBatch {
		entries = entries[:net.MaxInputsPerBatch]
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, e := range entries {
		if len(e) < 7 {
			c.badInputs++
			continue
		}
		seq := e[0]
		if seq != math.Trunc(seq) || seq <= float64(c.lastSeq) || seq > math.MaxUint32 {
			continue
		}
		yaw, pitch := e[2], e[3]
		if math.IsNaN(yaw) || math.IsInf(yaw, 0) || math.IsNaN(pitch) || math.IsInf(pitch, 0) {
			c.badInputs++
			continue
		}
		if yaw > math.Pi || yaw <= -math.Pi {
			yaw = math.Remainder(yaw, 2*math.Pi)
			if yaw <= -math.Pi {
				yaw += 2 * math.Pi
			}
		}
		slot := -1
		if e[5] == 0 || e[5] == 1 {
			slot = int(e[5])
		}
		rt := e[6]
		if math.IsNaN(rt) || math.IsInf(rt, 0) {
			rt = math.NaN() // treated as "now" by the room
		}
		c.lastSeq = uint32(seq)
		c.inputs = append(c.inputs, sim.Input{Seq: uint32(seq), Keys: int(e[1]) & 31, Yaw: yaw, Pitch: pitch,
			Buttons: int(e[4]) & 31, Slot: slot, Rt: rt})
	}
	if over := len(c.inputs) - net.InputQueueMax; over > 0 {
		c.inputs = append(c.inputs[:0], c.inputs[over:]...)
	}
	c.lastInput = now
	return c.badInputs < 600
}
