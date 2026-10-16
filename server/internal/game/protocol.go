package game

import (
	"encoding/json"
	"math"
	"strconv"
	"unicode/utf8"
)

// ---------------------------------------------------------------- JSON output helpers
//
// Hot messages (snapshots, shots) are hand-encoded with these appenders to
// avoid reflection and garbage; rare messages use encoding/json.

// appendFloat appends v in the same shortest round-trip form encoding/json
// (and JavaScript) uses. NaN and Inf become 0, -0 becomes 0.
func appendFloat(b []byte, v float64) []byte {
	if math.IsNaN(v) || math.IsInf(v, 0) || v == 0 {
		return append(b, '0')
	}
	abs := math.Abs(v)
	f := byte('f')
	if abs < 1e-6 || abs >= 1e21 {
		f = 'e'
	}
	b = strconv.AppendFloat(b, v, f, -1, 64)
	if f == 'e' {
		n := len(b)
		if n >= 4 && b[n-4] == 'e' && b[n-3] == '-' && b[n-2] == '0' {
			b[n-2] = b[n-1]
			b = b[:n-1]
		}
	}
	return b
}

var pow10 = [...]float64{1, 10, 100, 1000, 10000}

// q rounds v to d decimals like JavaScript Math.round(v*10^d)/10^d.
func q(v float64, d int) float64 {
	p := pow10[d]
	return math.Floor(v*p+0.5) / p
}

func appendQ(b []byte, v float64, d int) []byte { return appendFloat(b, q(v, d)) }

func appendInt(b []byte, v int) []byte { return strconv.AppendInt(b, int64(v), 10) }

func appendBool(b []byte, v bool) []byte {
	if v {
		return append(b, '1')
	}
	return append(b, '0')
}

const hexDigits = "0123456789abcdef"

// appendString appends a JSON string literal.
func appendString(b []byte, s string) []byte {
	b = append(b, '"')
	for i := 0; i < len(s); {
		c := s[i]
		if c < utf8.RuneSelf {
			switch {
			case c == '"' || c == '\\':
				b = append(b, '\\', c)
			case c < 0x20:
				b = append(b, '\\', 'u', '0', '0', hexDigits[c>>4], hexDigits[c&15])
			default:
				b = append(b, c)
			}
			i++
			continue
		}
		r, size := utf8.DecodeRuneInString(s[i:])
		switch {
		case r == utf8.RuneError && size == 1:
			b = append(b, `�`...)
		case r == ' ' || r == ' ':
			b = append(b, '\\', 'u', '2', '0', '2', hexDigits[r&15])
		default:
			b = append(b, s[i:i+size]...)
		}
		i += size
	}
	return append(b, '"')
}

// mustJSON marshals v (used for rare messages; v is always encodable).
func mustJSON(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}

// ---------------------------------------------------------------- outgoing message shapes

// Cos is a cosmetic loadout.
type Cos struct {
	Hat   string `json:"hat"`
	Color string `json:"color"`
	Stamp string `json:"stamp"`
}

// rosterJSON is the ROSTER object (PROTOCOL.md 6.1). "bot" is an extra
// field (1 for server-side bots); clients may ignore it.
type rosterJSON struct {
	ID  int    `json:"id"`
	N   string `json:"n"`
	Tm  int    `json:"tm"`
	Cls string `json:"cls"`
	Mel string `json:"mel"`
	Cos Cos    `json:"cos"`
	Sc  int    `json:"sc"`
	Ki  int    `json:"ki"`
	De  int    `json:"de"`
	St  int    `json:"st"`
	Al  int    `json:"al"`
	Bot int    `json:"bot,omitempty"`
}

type roomJSON struct {
	Code string `json:"code"`
	Mode string `json:"mode"`
	Map  string `json:"map"`
	Priv int    `json:"priv"`
	Max  int    `json:"max"`
}

type matchJSON struct {
	State string  `json:"state"`
	Tl    float64 `json:"tl"`
	Ts    [2]int  `json:"ts"`
	Limit int     `json:"limit"`
}

type welcomeJSON struct {
	T       string          `json:"t"`
	V       int             `json:"v"`
	ID      int             `json:"id"`
	Room    roomJSON        `json:"room"`
	Tr      int             `json:"tr"`
	Se      int             `json:"se"`
	K       int64           `json:"k"`
	Players []rosterJSON    `json:"players"`
	Match   matchJSON       `json:"match"`
	Pk      string          `json:"pk"`
	O       json.RawMessage `json:"o"`
}

type rosterMsg struct {
	T string     `json:"t"`
	P rosterJSON `json:"p"`
}

type spawnMsg struct {
	T   string  `json:"t"`
	ID  int     `json:"id"`
	X   float64 `json:"x"`
	Y   float64 `json:"y"`
	Z   float64 `json:"z"`
	Yaw float64 `json:"yaw"`
	Cls string  `json:"cls"`
	Mel string  `json:"mel"`
	Tm  int     `json:"tm"`
}

type hitMsg struct {
	T  string  `json:"t"`
	A  int     `json:"a"`
	V  int     `json:"v"`
	D  int     `json:"d"`
	Hs int     `json:"hs"`
	Z  int     `json:"z"`
	Hp int     `json:"hp"`
	Sh int     `json:"sh"`
	W  string  `json:"w"`
	Ax float64 `json:"ax"`
	Ay float64 `json:"ay"`
	Az float64 `json:"az"`
}

type killMsg struct {
	T  string  `json:"t"`
	K  int     `json:"k"`
	V  int     `json:"v"`
	W  string  `json:"w"`
	Hs int     `json:"hs"`
	Z  int     `json:"z"`
	St int     `json:"st"`
	Rs float64 `json:"rs"`
}

type boomMsg struct {
	T  string  `json:"t"`
	ID int     `json:"id"`
	K  int     `json:"k"`
	O  int     `json:"o"`
	X  float64 `json:"x"`
	Y  float64 `json:"y"`
	Z  float64 `json:"z"`
	R  float64 `json:"r"`
}

type streakMsg struct {
	T  string `json:"t"`
	ID int    `json:"id"`
	N  int    `json:"n"`
	R  string `json:"r"`
}

type pickMsg struct {
	T  string `json:"t"`
	I  int    `json:"i"`
	ID int    `json:"id"`
	Ty string `json:"ty"`
}

type flagMsg struct {
	T  string `json:"t"`
	Ev string `json:"ev"`
	Tm int    `json:"tm"`
	ID int    `json:"id"`
}

type chatMsg struct {
	T  string `json:"t"`
	ID int    `json:"id"`
	M  string `json:"m"`
	Tm int    `json:"tm"`
}

type sysMsg struct {
	T string `json:"t"`
	M string `json:"m"`
}

type idMsg struct {
	T  string `json:"t"`
	ID int    `json:"id"`
}

type meleeMsg struct {
	T  string `json:"t"`
	ID int    `json:"id"`
	W  string `json:"w"`
}

type sbJSON struct {
	P  [][6]int `json:"p"`
	Ts [2]int   `json:"ts"`
}

type sbMsg struct {
	T  string   `json:"t"`
	P  [][6]int `json:"p"`
	Ts [2]int   `json:"ts"`
	Tl float64  `json:"tl"`
}

type endMsg struct {
	T    string  `json:"t"`
	Wt   int     `json:"wt"`
	Wp   int     `json:"wp"`
	In   float64 `json:"in"`
	Next string  `json:"next"`
	Sb   sbJSON  `json:"sb"`
}

type startMsg struct {
	T     string          `json:"t"`
	Mode  string          `json:"mode"`
	Map   string          `json:"map"`
	Tl    float64         `json:"tl"`
	Ts    [2]int          `json:"ts"`
	Limit int             `json:"limit"`
	Pk    string          `json:"pk"`
	O     json.RawMessage `json:"o"`
}

type errMsg struct {
	T    string `json:"t"`
	Code string `json:"code"`
	Msg  string `json:"msg"`
}

var errText = map[string]string{
	"bad_hello":   "Expected a valid hello message",
	"version":     "Protocol version mismatch; please reload",
	"room_full":   "Room is full",
	"no_room":     "No room with that code",
	"server_full": "Server is full, try again soon",
	"rate":        "Too many messages",
	"too_many":    "Too many attempts, wait a minute and try again",
	"too_big":     "Message too large",
	"idle":        "Disconnected for inactivity",
	"bad_msg":     "Malformed message",
	"unavailable": "Server is shutting down",
}

func encodeErr(code string) []byte {
	m := errText[code]
	if m == "" {
		m = code
	}
	return mustJSON(errMsg{T: "err", Code: code, Msg: m})
}

// ---------------------------------------------------------------- incoming

// inMsg is a superset of every client message (hello, i, ld, chat, ping).
type inMsg struct {
	T string `json:"t"`
	// hello
	V      int             `json:"v"`
	Name   string          `json:"name"`
	Cls    *string         `json:"cls"`
	Mel    *string         `json:"mel"`
	Cos    *cosIn          `json:"cos"`
	Hold   *int            `json:"hold"` // ld: 1 = keep me dead while I pick a loadout, 0 = release
	Mode   string          `json:"mode"`
	Map    string          `json:"map"`
	Room   string          `json:"room"`
	Create json.RawMessage `json:"create"`
	// i
	B [][]float64 `json:"b"`
	// chat
	M  string  `json:"m"`
	Tm float64 `json:"tm"`
	// ping
	C   float64 `json:"c"`
	Rtt float64 `json:"rtt"`
}

type cosIn struct {
	Hat   *string `json:"hat"`
	Color *string `json:"color"`
	Stamp *string `json:"stamp"`
}

// truthy decodes hello.create: 0/1 or true/false.
func truthy(raw json.RawMessage) bool {
	switch string(raw) {
	case "1", "true", `"1"`:
		return true
	}
	if len(raw) > 0 {
		var f float64
		if json.Unmarshal(raw, &f) == nil {
			return f != 0
		}
	}
	return false
}
