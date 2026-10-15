// Command yolkout is the Yolkout game server: authoritative simulation,
// WebSocket endpoint (/ws) and static file server for the web client.
//
// SCAFFOLD STUB: the server builder replaces the /ws handler with the real
// room/matchmaking/simulation implementation described in shared/PROTOCOL.md.
package main

import (
	"flag"
	"log"
	"net/http"
	"path/filepath"

	"github.com/gorilla/websocket"
)

func main() {
	addr := flag.String("addr", ":8080", "listen address")
	webDir := flag.String("web", "../web", "static web client directory")
	sharedDir := flag.String("shared", "../shared", "shared directory (data/ and ref/ are served from here)")
	flag.Parse()

	mux := http.NewServeMux()
	mux.Handle("/data/", http.StripPrefix("/data/", http.FileServer(http.Dir(filepath.Join(*sharedDir, "data")))))
	mux.Handle("/ref/", http.StripPrefix("/ref/", http.FileServer(http.Dir(filepath.Join(*sharedDir, "ref")))))
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("ok")) })
	mux.HandleFunc("/ws", wsStub)
	mux.Handle("/", http.FileServer(http.Dir(*webDir)))

	log.Printf("yolkout listening on %s (web=%s shared=%s)", *addr, *webDir, *sharedDir)
	log.Fatal(http.ListenAndServe(*addr, mux))
}

var upgrader = websocket.Upgrader{ReadBufferSize: 4096, WriteBufferSize: 16384}

func wsStub(w http.ResponseWriter, r *http.Request) {
	c, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer c.Close()
	_ = c.WriteMessage(websocket.TextMessage, []byte(`{"t":"err","code":"unavailable","msg":"server not implemented yet"}`))
}
