# Yolkout monorepo tasks. Requires Go (>= 1.23) and Node 22.
export PATH := $(HOME)/.local/go/bin:$(HOME)/go/bin:$(PATH)

ADDR    ?= :8080
BIN     ?= bin/yolkout
BOTS    ?= 8
MODE    ?= ffa
SECS    ?= 30
WSURL   ?= ws://localhost$(ADDR)/ws

.PHONY: run build test test-go test-js fmt vet maps validate vectors bots docker clean

run: ## run the server with the web client on $(ADDR)
	cd server && go run . -addr $(ADDR) -web ../web -shared ../shared

build: ## build a single static binary into bin/
	cd server && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o ../$(BIN) .

test: test-js test-go ## run all tests

test-go:
	cd server && go vet ./... && go test ./...

test-js: validate
	node scripts/gen-testvectors.mjs --check

fmt: ## format Go code
	cd server && gofmt -s -w .

vet:
	cd server && go vet ./...

maps: ## regenerate shared/data/maps/*.json from scripts/mapgen and validate them
	node scripts/mapgen/build.mjs
	node scripts/validate-maps.mjs

validate:
	node scripts/validate-maps.mjs

vectors: ## regenerate shared/testvectors from the reference sim
	node scripts/gen-testvectors.mjs

bots: ## connect $(BOTS) protocol bots to $(WSURL) for $(SECS)s
	node scripts/bots/bots.mjs --url $(WSURL) --n $(BOTS) --mode $(MODE) --secs $(SECS)

docker:
	docker build -t yolkout .

clean:
	rm -rf bin
