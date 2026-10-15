package web

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStatic(t *testing.T) {
	dir := t.TempDir()
	js := strings.Repeat("export const a = 1;\n", 200)
	os.MkdirAll(filepath.Join(dir, "vendor"), 0o755)
	os.WriteFile(filepath.Join(dir, "index.html"), []byte("<!doctype html><title>x</title>"), 0o644)
	os.WriteFile(filepath.Join(dir, "a.mjs"), []byte(js), 0o644)
	os.WriteFile(filepath.Join(dir, "vendor", "v.js"), []byte(js), 0o644)
	os.WriteFile(filepath.Join(dir, ".secret"), []byte("no"), 0o644)
	h := NewDir(dir, "/vendor/")

	get := func(p string, hdr map[string]string) *httptest.ResponseRecorder {
		req := httptest.NewRequest("GET", p, nil)
		for k, v := range hdr {
			req.Header.Set(k, v)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}
	r := get("/", nil)
	if r.Code != 200 || !strings.HasPrefix(r.Header().Get("Content-Type"), "text/html") {
		t.Fatalf("index: %d %s", r.Code, r.Header().Get("Content-Type"))
	}
	r = get("/a.mjs", map[string]string{"Accept-Encoding": "gzip, br"})
	if r.Code != 200 || r.Header().Get("Content-Encoding") != "gzip" || !strings.HasPrefix(r.Header().Get("Content-Type"), "text/javascript") {
		t.Fatalf("mjs: %d %v", r.Code, r.Header())
	}
	zr, err := gzip.NewReader(bytes.NewReader(r.Body.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	plain, _ := io.ReadAll(zr)
	if string(plain) != js {
		t.Fatal("gzip body mismatch")
	}
	if r.Header().Get("Cache-Control") != "no-cache" || r.Header().Get("ETag") == "" {
		t.Fatalf("cache headers: %v", r.Header())
	}
	tag := r.Header().Get("ETag")
	r = get("/a.mjs", map[string]string{"Accept-Encoding": "gzip", "If-None-Match": tag})
	if r.Code != http.StatusNotModified {
		t.Fatalf("etag revalidation: %d", r.Code)
	}
	r = get("/a.mjs", nil)
	if r.Header().Get("Content-Encoding") != "" || r.Body.String() != js {
		t.Fatal("identity body")
	}
	r = get("/vendor/v.js", nil)
	if !strings.Contains(r.Header().Get("Cache-Control"), "immutable") {
		t.Fatalf("vendor cache: %v", r.Header())
	}
	for _, p := range []string{"/.secret", "/../etc/passwd", "/nope.js"} {
		if r = get(p, nil); r.Code != 404 {
			t.Fatalf("%s: %d", p, r.Code)
		}
	}
}
