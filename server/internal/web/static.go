// Package web serves static files fast: correct MIME types, in-memory gzip
// cache for text types, strong ETags, and long-lived caching for /vendor/.
package web

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

var types = map[string]string{
	".html":        "text/html; charset=utf-8",
	".htm":         "text/html; charset=utf-8",
	".css":         "text/css; charset=utf-8",
	".js":          "text/javascript; charset=utf-8",
	".mjs":         "text/javascript; charset=utf-8",
	".json":        "application/json; charset=utf-8",
	".map":         "application/json; charset=utf-8",
	".svg":         "image/svg+xml",
	".txt":         "text/plain; charset=utf-8",
	".md":          "text/markdown; charset=utf-8",
	".png":         "image/png",
	".jpg":         "image/jpeg",
	".jpeg":        "image/jpeg",
	".webp":        "image/webp",
	".gif":         "image/gif",
	".ico":         "image/x-icon",
	".woff":        "font/woff",
	".woff2":       "font/woff2",
	".wasm":        "application/wasm",
	".mp3":         "audio/mpeg",
	".ogg":         "audio/ogg",
	".wav":         "audio/wav",
	".webm":        "video/webm",
	".glb":         "model/gltf-binary",
	".webmanifest": "application/manifest+json",
}

var compressible = map[string]bool{".html": true, ".htm": true, ".css": true, ".js": true, ".mjs": true, ".json": true,
	".map": true, ".svg": true, ".txt": true, ".md": true, ".webmanifest": true, ".wasm": true}

// ContentType returns the MIME type for a file name.
func ContentType(name string) string {
	ext := strings.ToLower(filepath.Ext(name))
	if t, ok := types[ext]; ok {
		return t
	}
	if t := mime.TypeByExtension(ext); t != "" {
		return t
	}
	return "application/octet-stream"
}

type entry struct {
	mod    time.Time
	size   int64
	data   []byte
	gz     []byte
	etag   string
	gzEtag string
	ctype  string
}

// Dir serves the files under Root. Paths under any of Immutable get a
// one-year immutable cache; everything else gets no-cache + ETag.
type Dir struct {
	Root      string
	Immutable []string
	MaxFile   int64

	mu    sync.RWMutex
	cache map[string]*entry
}

// NewDir creates a static handler for root.
func NewDir(root string, immutable ...string) *Dir {
	return &Dir{Root: root, Immutable: immutable, MaxFile: 32 << 20, cache: map[string]*entry{}}
}

func (d *Dir) load(rel string) (*entry, int) {
	full := filepath.Join(d.Root, filepath.FromSlash(rel))
	st, err := os.Stat(full)
	if err != nil {
		return nil, http.StatusNotFound
	}
	if st.IsDir() {
		full = filepath.Join(full, "index.html")
		rel = path.Join(rel, "index.html")
		if st, err = os.Stat(full); err != nil || st.IsDir() {
			return nil, http.StatusNotFound
		}
	}
	if !st.Mode().IsRegular() || st.Size() > d.MaxFile {
		return nil, http.StatusNotFound
	}
	d.mu.RLock()
	e := d.cache[full]
	d.mu.RUnlock()
	if e != nil && e.mod.Equal(st.ModTime()) && e.size == st.Size() {
		return e, 0
	}
	b, err := os.ReadFile(full)
	if err != nil {
		return nil, http.StatusNotFound
	}
	sum := sha256.Sum256(b)
	tag := hex.EncodeToString(sum[:8])
	e = &entry{mod: st.ModTime(), size: st.Size(), data: b, etag: `"` + tag + `"`, ctype: ContentType(full)}
	if compressible[strings.ToLower(filepath.Ext(full))] && len(b) > 256 {
		var buf bytes.Buffer
		zw, _ := gzip.NewWriterLevel(&buf, gzip.BestCompression)
		_, _ = zw.Write(b)
		_ = zw.Close()
		if buf.Len() < len(b) {
			e.gz = buf.Bytes()
			e.gzEtag = `"` + tag + `-gz"`
		}
	}
	d.mu.Lock()
	d.cache[full] = e
	d.mu.Unlock()
	return e, 0
}

func acceptsGzip(r *http.Request) bool {
	for _, part := range strings.Split(r.Header.Get("Accept-Encoding"), ",") {
		f := strings.Fields(strings.ReplaceAll(part, ";", " "))
		if len(f) == 0 || (f[0] != "gzip" && f[0] != "*") {
			continue
		}
		ok := true
		for _, p := range f[1:] {
			if v, found := strings.CutPrefix(p, "q="); found {
				if q, err := strconv.ParseFloat(v, 64); err == nil && q == 0 {
					ok = false
				}
			}
		}
		if ok {
			return true
		}
	}
	return false
}

func etagMatch(header, tag string) bool {
	if header == "" {
		return false
	}
	for _, t := range strings.Split(header, ",") {
		t = strings.TrimSpace(t)
		t = strings.TrimPrefix(t, "W/")
		if t == tag || t == "*" {
			return true
		}
	}
	return false
}

func (d *Dir) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	p := r.URL.Path
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	clean := path.Clean(p)
	for _, seg := range strings.Split(clean, "/") {
		if strings.HasPrefix(seg, ".") && seg != "" {
			http.NotFound(w, r) // no dotfiles, no traversal
			return
		}
	}
	rel := strings.TrimPrefix(clean, "/")
	e, code := d.load(rel)
	if e == nil {
		http.Error(w, http.StatusText(code), code)
		return
	}
	h := w.Header()
	h.Set("Content-Type", e.ctype)
	h.Set("X-Content-Type-Options", "nosniff")
	immutable := false
	for _, pre := range d.Immutable {
		if strings.HasPrefix(clean, pre) {
			immutable = true
		}
	}
	if immutable {
		h.Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		h.Set("Cache-Control", "no-cache")
	}
	h.Set("Last-Modified", e.mod.UTC().Format(http.TimeFormat))
	body, tag := e.data, e.etag
	if e.gz != nil {
		h.Set("Vary", "Accept-Encoding")
		if acceptsGzip(r) {
			body, tag = e.gz, e.gzEtag
			h.Set("Content-Encoding", "gzip")
		}
	}
	h.Set("ETag", tag)
	if etagMatch(r.Header.Get("If-None-Match"), tag) {
		h.Del("Content-Encoding")
		w.WriteHeader(http.StatusNotModified)
		return
	}
	if r.Header.Get("If-None-Match") == "" {
		if ims, err := http.ParseTime(r.Header.Get("If-Modified-Since")); err == nil && !e.mod.Truncate(time.Second).After(ims) {
			h.Del("Content-Encoding")
			w.WriteHeader(http.StatusNotModified)
			return
		}
	}
	h.Set("Content-Length", strconv.Itoa(len(body)))
	if r.Method == http.MethodHead {
		return
	}
	_, _ = w.Write(body)
}
