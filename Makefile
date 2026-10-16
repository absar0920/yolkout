# Yolkout monorepo tasks. Requires Go (>= 1.23) and Node 22.
export PATH := $(HOME)/.local/go/bin:$(HOME)/go/bin:$(PATH)
SHELL := /bin/bash

ADDR      ?= :8080
BIN       ?= bin/yolkout
TEST_PORT ?= 18400
TEST_URL  := http://127.0.0.1:$(TEST_PORT)
N         ?= 24
SECS      ?= 30
BOTS      ?= 8
MODE      ?= ffa
WSURL     ?= ws://localhost$(ADDR)/ws

# Start $(BIN) on $(TEST_PORT) for the duration of one recipe and always stop it.
define with_server
	@set -e; \
	./$(BIN) -addr 127.0.0.1:$(TEST_PORT) -web web -shared shared -stats "" > bin/test-server.log 2>&1 & pid=$$!; \
	trap 'kill $$pid 2>/dev/null; wait $$pid 2>/dev/null || true' EXIT; \
	for i in $$(seq 1 50); do curl -sf $(TEST_URL)/healthz >/dev/null && break; sleep 0.1; done; \
	$(1)
endef

.PHONY: help run build test test-go test-js check-js bench bots bots-wander e2e art-shots fp-shots v2-shots deps fmt vet maps validate vectors docker clean

help: ## list targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-12s %s\n", $$1, $$2}'

run: ## run the server with the web client on $(ADDR) (http://localhost:8080)
	cd server && go run . -addr $(ADDR) -web ../web -shared ../shared

build: ## build a single static binary into bin/
	cd server && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o ../$(BIN) .

test: test-js test-go ## all offline tests: maps, JS syntax + sim/prediction vectors, go vet + go test -race

test-go: ## go vet + race-enabled Go tests (sim vectors, rooms, combat, modes, ws, http)
	cd server && go vet ./... && go test -race ./...

test-js: validate check-js ## map validation, JS reference vectors, client prediction tests
	node scripts/gen-testvectors.mjs --check
	node --import ./web/js/engine/test/register.mjs web/js/engine/test/gen-physics-vectors.mjs --check
	node --import ./web/js/engine/test/register.mjs web/js/engine/test/physics.test.mjs
	@for f in web/js/game/test/*.test.mjs web/js/game/art/test/*.test.mjs; do [ -e "$$f" ] && echo "node $$f" && node "$$f" || [ ! -e "$$f" ] || exit 1; done

check-js: ## node --check every JS module in web/, shared/ and scripts/
	@n=0; for f in $$(find web shared scripts -name '*.js' -o -name '*.mjs' | grep -v -e node_modules -e '^web/vendor/'); do \
		node --check $$f || exit 1; n=$$((n+1)); done; echo "node --check: $$n files OK"

bench: ## Go benchmarks (room tick cost with 12 players)
	cd server && go test -run '^$$' -bench . -benchmem ./internal/game/

bots: build ## protocol + load test: $(N) clients across 2 rooms for $(SECS)s against a fresh server
	$(call with_server,node scripts/bots.mjs --url ws://127.0.0.1:$(TEST_PORT)/ws --n $(N) --secs $(SECS) --pid $$pid)

bots-wander: ## connect $(BOTS) random-walk bots to a running server at $(WSURL)
	node scripts/bots/bots.mjs --url $(WSURL) --n $(BOTS) --mode $(MODE) --secs $(SECS)

deps: ## install Playwright + Chromium for the browser e2e test (scripts/node_modules)
	cd scripts && npm install --no-audit --no-fund && npx playwright install chromium

e2e: build ## browser end-to-end test (headless Chromium) against a fresh server; screenshots in scripts/screenshots/
	@test -d scripts/node_modules/playwright || $(MAKE) deps
	$(call with_server,node scripts/e2e.mjs --url $(TEST_URL) --server $(BIN))

art-shots: ## render the art gallery (models, hands, cracks) to scripts/screenshots/art/ and check model budgets
	node scripts/art-gallery.mjs

v2-shots: ## final v2 screenshot set (every FP weapon, scopes, pan swing, cracked eggs, in-match) to scripts/screenshots/v2/
	node scripts/v2-shots.mjs

fp-shots: ## render first-person view-model, scope, crack and wall-tracer shots to scripts/screenshots/fp/
	node scripts/fp-shots.mjs

fmt: ## format Go code
	cd server && gofmt -s -w .

vet:
	cd server && go vet ./...

maps: ## regenerate shared/data/maps/*.json from scripts/mapgen and validate them
	node scripts/mapgen/build.mjs
	node scripts/validate-maps.mjs

validate:
	node scripts/validate-maps.mjs

vectors: ## regenerate shared/testvectors and shared/physics_vectors.json from the reference sim
	node scripts/gen-testvectors.mjs
	node --import ./web/js/engine/test/register.mjs web/js/engine/test/gen-physics-vectors.mjs

docker: ## build the scratch image (binary + static files)
	docker build -t yolkout .

clean:
	rm -rf bin scripts/screenshots
