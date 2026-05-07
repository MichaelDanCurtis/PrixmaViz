#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

bun run build:web
bun run --filter @prixmaviz/server embed

ROOT=$(pwd)
BIN_DIR="$ROOT/src-tauri/binaries"
mkdir -p "$BIN_DIR"

build_one() {
  local target="$1"
  local triple="$2"
  local ext="${3:-}"
  echo "Building for $triple..."
  cd "$ROOT/packages/server"
  bun build ./src/index.ts --compile --target="$target" \
    --outfile "$BIN_DIR/prixmaviz-server-${triple}${ext}"
  cd "$ROOT"
}

case "$(uname)-$(uname -m)" in
  Darwin-arm64) build_one bun-darwin-arm64 aarch64-apple-darwin ;;
  Darwin-x86_64) build_one bun-darwin-x64 x86_64-apple-darwin ;;
  Linux-x86_64) build_one bun-linux-x64 x86_64-unknown-linux-gnu ;;
  *) echo "unknown host: $(uname)-$(uname -m)"; exit 1 ;;
esac

echo "sidecar built into $BIN_DIR"
