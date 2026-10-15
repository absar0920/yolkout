// Command yolkout is the Yolkout game server: authoritative 60 Hz simulation,
// WebSocket endpoint (/ws), JSON APIs and a static file server for the web
// client, all in one binary. See shared/PROTOCOL.md.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"yolkout/server/internal/data"
	"yolkout/server/internal/game"
	"yolkout/server/internal/stats"
	"yolkout/server/internal/web"
)

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if v, err := strconv.Atoi(os.Getenv(key)); err == nil {
		return v
	}
	return def
}

func main() {
	defAddr := ":8080"
	if p := os.Getenv("PORT"); p != "" {
		defAddr = ":" + p
	}
	addr := flag.String("addr", env("YOLKOUT_ADDR", defAddr), "listen address (env YOLKOUT_ADDR or PORT)")
	webDir := flag.String("web", env("YOLKOUT_WEB", "../web"), "static web client directory (env YOLKOUT_WEB)")
	sharedDir := flag.String("shared", env("YOLKOUT_SHARED", "../shared"), "shared directory; data/ and ref/ are served from it (env YOLKOUT_SHARED)")
	dataDir := flag.String("data", env("YOLKOUT_DATA", ""), "game data directory (default <shared>/data; env YOLKOUT_DATA)")
	statsPath := flag.String("stats", env("YOLKOUT_STATS", "yolkout-stats.json"), "leaderboard file; empty = memory only (env YOLKOUT_STATS)")
	bots := flag.Int("bots", envInt("YOLKOUT_BOTS", 4), "fill rooms with bots up to this many players; 0 disables (env YOLKOUT_BOTS)")
	maxRooms := flag.Int("maxrooms", envInt("YOLKOUT_MAXROOMS", 200), "maximum live rooms (env YOLKOUT_MAXROOMS)")
	maxConns := flag.Int("maxconns", envInt("YOLKOUT_MAXCONNS", 4000), "maximum WebSocket connections (env YOLKOUT_MAXCONNS)")
	anyOrigin := flag.Bool("anyorigin", os.Getenv("YOLKOUT_ANYORIGIN") == "1", "accept WebSocket upgrades from any Origin (env YOLKOUT_ANYORIGIN=1)")
	flag.Parse()
	if *dataDir == "" {
		*dataDir = filepath.Join(*sharedDir, "data")
	}

	g, err := data.Load(*dataDir)
	if err != nil {
		log.Fatalf("loading game data from %s: %v", *dataDir, err)
	}
	st, err := stats.Open(*statsPath)
	if err != nil {
		log.Printf("stats: %v (starting with an empty leaderboard)", err)
	}
	mgr := game.NewManager(g, game.Config{MaxRooms: *maxRooms, MaxConns: *maxConns, BotFill: *bots, AnyOrigin: *anyOrigin}, st)

	mux := http.NewServeMux()
	mux.Handle("/data/", http.StripPrefix("/data", web.NewDir(*dataDir)))
	mux.Handle("/ref/", http.StripPrefix("/ref", web.NewDir(filepath.Join(*sharedDir, "ref"))))
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write([]byte("ok"))
	})
	mux.HandleFunc("/api/rooms", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, map[string]any{"rooms": mgr.PublicRooms()})
	})
	mux.HandleFunc("/api/stats", func(w http.ResponseWriter, r *http.Request) {
		by := r.URL.Query().Get("by")
		n, _ := strconv.Atoi(r.URL.Query().Get("n"))
		if n <= 0 || n > 100 {
			n = 25
		}
		rooms, players := mgr.Counts()
		writeJSON(w, map[string]any{"by": orDefault(by, "score"), "online": players, "rooms": rooms, "tracked": st.Len(), "top": st.Top(by, n)})
	})
	mux.HandleFunc("/ws", mgr.ServeWS)
	mux.Handle("/", web.NewDir(*webDir, "/vendor/"))

	srv := &http.Server{Addr: *addr, Handler: mux, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 120 * time.Second}

	// periodic stats save
	stopSave := make(chan struct{})
	go func() {
		t := time.NewTicker(30 * time.Second)
		defer t.Stop()
		lastErr := ""
		for {
			select {
			case <-t.C:
				err := st.Save()
				if err != nil && err.Error() != lastErr {
					log.Printf("stats save: %v (set -stats to a writable path, or -stats \"\" for memory only)", err)
				}
				lastErr = ""
				if err != nil {
					lastErr = err.Error()
				}
			case <-stopSave:
				return
			}
		}
	}()

	errc := make(chan error, 1)
	go func() {
		log.Printf("yolkout listening on %s (web=%s data=%s bots=%d)", *addr, *webDir, *dataDir, *bots)
		errc <- srv.ListenAndServe()
	}()
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	select {
	case s := <-sig:
		log.Printf("received %v, shutting down", s)
	case err := <-errc:
		if !errors.Is(err, http.ErrServerClosed) {
			log.Printf("server error: %v", err)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx) // stop accepting; WebSockets are hijacked and closed by the manager
	mgr.Shutdown(3 * time.Second)
	close(stopSave)
	if err := st.Save(); err != nil {
		log.Printf("stats save: %v", err)
	}
	log.Printf("bye")
}

func orDefault(s, d string) string {
	if s == "" {
		return d
	}
	return s
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(v)
}
