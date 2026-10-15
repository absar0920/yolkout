package game

import (
	"encoding/json"
	"math"
	"testing"
	"time"
)

func TestAppendFloat(t *testing.T) {
	cases := map[float64]string{0: "0", math.Copysign(0, -1): "0", 1: "1", -2.5: "-2.5", 0.1: "0.1", 1e-7: "1e-7", 1.2345678901234: "1.2345678901234",
		1e21: "1e+21", 123456789012: "123456789012", math.NaN(): "0", math.Inf(1): "0"}
	for v, want := range cases {
		if got := string(appendFloat(nil, v)); got != want {
			t.Errorf("appendFloat(%v) = %s want %s", v, got, want)
		}
	}
	// round trip at full precision
	for _, v := range []float64{0.016666666666666666, -3.0000000000000004, 1.0 / 3} {
		var back float64
		if err := json.Unmarshal(appendFloat(nil, v), &back); err != nil || back != v {
			t.Errorf("round trip %v -> %v", v, back)
		}
	}
}

func TestQuantize(t *testing.T) {
	if q(1.005, 2) != 1 && q(1.005, 2) != 1.01 {
		t.Fatal("q")
	}
	if q(3.14159, 3) != 3.142 || q(-0.0049, 2) != 0 || q(2.5, 0) != 3 || q(-2.5, 0) != -2 {
		t.Fatalf("q: %v %v %v %v", q(3.14159, 3), q(-0.0049, 2), q(2.5, 0), q(-2.5, 0))
	}
}

func TestAppendString(t *testing.T) {
	for _, s := range []string{"plain", `quo"te`, "back\\slash", "ctl\x01\n", "üñí", " sep", "bad\xffutf"} {
		b := appendString(nil, s)
		var back string
		if err := json.Unmarshal(b, &back); err != nil {
			t.Fatalf("%q -> %s: %v", s, b, err)
		}
		if s != "bad\xffutf" && back != s {
			t.Fatalf("%q round-trips to %q", s, back)
		}
	}
}

func TestSanitizeName(t *testing.T) {
	cases := map[string]string{
		"Eggbert":                 "Eggbert",
		"  Big   Egg  ":           "Big Egg",
		"<script>x</script>":      "scriptxscript",
		"averyveryverylongname12": "averyveryveryl" + "on",
		"Zoë":                     "Zo",
	}
	for in, want := range cases {
		if got := SanitizeName(in); got != want {
			t.Errorf("SanitizeName(%q) = %q want %q", in, got, want)
		}
	}
	if n := SanitizeName("!!!"); len(n) != 6 || n[:3] != "Egg" {
		t.Errorf("empty name -> %q", n)
	}
}

func TestSanitizeChat(t *testing.T) {
	if got := SanitizeChat("  hi\x00 there‮  ", 120); got != "hi there" {
		t.Fatalf("%q", got)
	}
	long := ""
	for i := 0; i < 200; i++ {
		long += "é"
	}
	if got := SanitizeChat(long, 120); len([]rune(got)) != 120 {
		t.Fatal("chat length")
	}
	if SanitizeChat(" \t\n ", 120) != "" {
		t.Fatal("empty chat")
	}
}

func TestDecodeHelloAndTruthy(t *testing.T) {
	var m inMsg
	raw := `{"t":"hello","v":1,"name":"Eggbert","cls":"deviler","cos":{"hat":"chef","color":"nope"},"mode":"teams","map":"","room":"k7q2m","create":true}`
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		t.Fatal(err)
	}
	if m.T != "hello" || m.V != 1 || *m.Cls != "deviler" || !truthy(m.Create) || m.Cos.Stamp != nil {
		t.Fatalf("%+v", m)
	}
	for in, want := range map[string]bool{"0": false, "1": true, "false": false, "true": true, "": false} {
		if truthy(json.RawMessage(in)) != want {
			t.Errorf("truthy(%s)", in)
		}
	}
	g := loadGame(t)
	h := helloFor(g, &m)
	if h.cls != "deviler" || h.cos.Hat != "chef" || h.cos.Color != "classic" || h.cos.Stamp != "none" {
		t.Fatalf("helloFor %+v", h)
	}
	bad := "nope"
	m.Cls = &bad
	if helloFor(g, &m).cls != g.Weapons.DefaultPrimary {
		t.Fatal("unknown class should become default")
	}
}

func TestPushInputsValidation(t *testing.T) {
	g := loadGame(t)
	m := NewManager(g, Config{}, nil)
	c := &Client{mgr: m}
	ok := c.pushInputs([][]float64{
		{1, 255, 0.5, 0.1, 255, 0, 10},
		{1, 1, 0, 0, 0, 0, 10},   // duplicate seq: ignored
		{2, 1, 4.0, 0, 0, 7, 10}, // yaw wrapped, bad slot kept as -1
		{3.5, 1, 0, 0, 0, 0, 10}, // non-integer seq
		{4, 1},                   // short
		{5, 1, 0, 0, 0, 1, 10},
	}, time.Now())
	if !ok {
		t.Fatal("should not drop")
	}
	if len(c.inputs) != 3 {
		t.Fatalf("queued %d", len(c.inputs))
	}
	if c.inputs[0].Keys != 31 || c.inputs[0].Buttons != 31 {
		t.Fatal("masks")
	}
	if y := c.inputs[1].Yaw; y > math.Pi || y <= -math.Pi || math.Abs(y-(4.0-2*math.Pi)) > 1e-12 {
		t.Fatalf("yaw wrap %v", y)
	}
	if c.inputs[1].Slot != -1 || c.inputs[2].Slot != 1 {
		t.Fatal("slot")
	}
	// queue cap
	var many [][]float64
	for i := 0; i < 8; i++ {
		many = append(many, []float64{float64(10 + i), 0, 0, 0, 0, 0, 0})
	}
	c.pushInputs(many, time.Now())
	c.pushInputs([][]float64{{30, 0, 0, 0, 0, 0, 0}, {31, 0, 0, 0, 0, 0, 0}, {32, 0, 0, 0, 0, 0, 0}, {33, 0, 0, 0, 0, 0, 0}, {34, 0, 0, 0, 0, 0, 0}, {35, 0, 0, 0, 0, 0, 0}, {36, 0, 0, 0, 0, 0, 0}, {37, 0, 0, 0, 0, 0, 0}, {38, 0, 0, 0, 0, 0, 0}}, time.Now())
	if len(c.inputs) != g.Rules.Net.InputQueueMax || c.inputs[len(c.inputs)-1].Seq != 37 {
		t.Fatalf("queue len %d last %d", len(c.inputs), c.inputs[len(c.inputs)-1].Seq)
	}
}
