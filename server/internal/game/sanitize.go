package game

import (
	"math/rand/v2"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
)

const maxNameLen = 16

// SanitizeName implements PROTOCOL.md 13.3: NFC, keep [A-Za-z0-9 _.-],
// collapse spaces, trim, cut to 16; empty becomes "Egg" + 3 digits.
func SanitizeName(s string) string {
	s = norm.NFC.String(s)
	var b strings.Builder
	space := false
	for _, r := range s {
		ok := (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '.' || r == '-' || r == ' '
		if !ok {
			continue
		}
		if r == ' ' {
			if space {
				continue
			}
			space = true
		} else {
			space = false
		}
		b.WriteRune(r)
	}
	out := strings.TrimSpace(b.String())
	if len(out) > maxNameLen {
		out = strings.TrimSpace(out[:maxNameLen])
	}
	if out == "" {
		out = "Egg" + strconv.Itoa(100+rand.IntN(900))
	}
	return out
}

// SanitizeChat strips control (and bidi formatting) characters, trims and
// cuts to maxRunes. Returns "" if nothing is left.
func SanitizeChat(s string, maxRunes int) string {
	if !utf8.ValidString(s) {
		s = strings.ToValidUTF8(s, "")
	}
	var b strings.Builder
	n := 0
	for _, r := range s {
		if unicode.IsControl(r) || isBidi(r) || r == utf8.RuneError {
			continue
		}
		b.WriteRune(r)
		n++
	}
	out := strings.TrimSpace(b.String())
	if utf8.RuneCountInString(out) > maxRunes {
		rs := []rune(out)
		out = strings.TrimSpace(string(rs[:maxRunes]))
	}
	return out
}

func isBidi(r rune) bool {
	return (r >= 0x202A && r <= 0x202E) || (r >= 0x2066 && r <= 0x2069) || r == 0x200E || r == 0x200F || r == 0x061C
}
