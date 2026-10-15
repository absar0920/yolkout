# syntax=docker/dockerfile:1
# --- build stage: static Go binary
FROM golang:1.25-alpine AS build
WORKDIR /src/server
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
RUN CGO_ENABLED=0 GOAMD64=v1 go build -trimpath -ldflags="-s -w" -o /out/yolkout .

# --- final stage: just the binary + static files (~ a few MB)
FROM scratch
COPY --from=build /out/yolkout /app/yolkout
COPY web/ /app/web/
COPY shared/ /app/shared/
WORKDIR /app
EXPOSE 8080
USER 65534:65534
ENTRYPOINT ["/app/yolkout", "-addr", ":8080", "-web", "/app/web", "-shared", "/app/shared"]
