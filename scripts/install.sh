#!/usr/bin/env bash
set -euo pipefail

REPO="${PRIXMAVIZ_REPO:-https://github.com/MichaelDanCurtis/PrixmaViz}"
DEST="${PRIXMAVIZ_DEST:-$HOME/.local/bin}"

OS=$(uname -s)
ARCH=$(uname -m)
case "$OS-$ARCH" in
  Darwin-arm64)  TARGET="darwin-arm64" ;;
  Darwin-x86_64) TARGET="darwin-x64" ;;
  Linux-x86_64)  TARGET="linux-x64" ;;
  *) echo "Unsupported platform: $OS-$ARCH"; exit 1 ;;
esac

mkdir -p "$DEST"
URL="$REPO/releases/latest/download/prixmaviz-server-$TARGET"
echo "Downloading $URL..."
curl -fsSL -o "$DEST/prixmaviz-server" "$URL"
chmod +x "$DEST/prixmaviz-server"

echo
echo "Installed to $DEST/prixmaviz-server"
echo
echo "Add this to your Claude Code config (~/Library/Application Support/Claude/claude_desktop_config.json on macOS):"
echo
cat <<JSON
{
  "mcpServers": {
    "prixmaviz": {
      "command": "$DEST/prixmaviz-server",
      "args": ["--mcp"]
    }
  }
}
JSON
