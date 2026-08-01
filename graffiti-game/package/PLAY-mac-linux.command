#!/usr/bin/env bash
# Alley Kings launcher — macOS and Linux.
#
# Serves the game on localhost and opens your browser. The game must be served
# over HTTP rather than opened as a file, because browsers block WebAssembly and
# ES modules on file:// origins and the physics engine is a WASM module.
#
# Tries whatever is already on the machine, in order of how good the experience
# is, and only falls back to browser flags if nothing can serve files.

set -u
cd "$(dirname "$0")" || exit 1

PORT="${PORT:-8765}"
URL="http://localhost:${PORT}/"

banner() {
  echo ""
  echo "  ================================================"
  echo "   ALLEY KINGS"
  echo "  ================================================"
  echo ""
}

open_browser() {
  sleep 1
  if command -v open >/dev/null 2>&1; then
    open "$1"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$1" >/dev/null 2>&1
  fi
}

serve_and_wait() {
  echo "  Serving at ${URL}"
  echo ""
  echo "  Your browser should open in a moment."
  echo "  If it does not, paste that address into it."
  echo ""
  echo "  Leave this window open while you play."
  echo "  Press Ctrl+C here when you are finished."
  echo ""
  open_browser "$URL" &
  "$@"
}

banner

# 1. Node — best option: it also opens the browser for us.
if command -v node >/dev/null 2>&1; then
  echo "  Using Node to serve the game."
  echo ""
  echo "  Leave this window open while you play."
  echo "  Press Ctrl+C here when you are finished."
  PORT="$PORT" exec node serve.mjs
fi

# 2. Python 3 — present on most Macs and virtually every Linux box.
if command -v python3 >/dev/null 2>&1; then
  echo "  Using Python to serve the game."
  serve_and_wait python3 -m http.server "$PORT" --bind 127.0.0.1 --directory game
  exit 0
fi

if command -v python >/dev/null 2>&1 && python -c "import sys; sys.exit(0 if sys.version_info[0]==3 else 1)" 2>/dev/null; then
  echo "  Using Python to serve the game."
  serve_and_wait python -m http.server "$PORT" --bind 127.0.0.1 --directory game
  exit 0
fi

# 3. Nothing can serve files. Launch a Chromium browser with local file access
#    enabled instead, using a throwaway profile so the flag actually applies
#    (an already-running Chrome would otherwise swallow the request and ignore
#    it). Saves live in that profile, so they persist between launches.
echo "  No Node or Python found, falling back to launching a browser directly."
echo ""
PROFILE="$(pwd)/.browser-profile"
GAME_FILE="file://$(pwd)/game/index.html"

for BROWSER in \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
  "/Applications/Chromium.app/Contents/MacOS/Chromium" \
  "$(command -v google-chrome || true)" \
  "$(command -v chromium || true)" \
  "$(command -v chromium-browser || true)" \
  "$(command -v microsoft-edge || true)"
do
  if [ -n "$BROWSER" ] && [ -x "$BROWSER" ]; then
    echo "  Launching: $BROWSER"
    echo "  Close that browser window when you are finished."
    "$BROWSER" --allow-file-access-from-files --user-data-dir="$PROFILE" "$GAME_FILE"
    exit 0
  fi
done

echo "  Could not find a way to run the game automatically."
echo ""
echo "  Two options:"
echo "    1. Install Node.js from https://nodejs.org and run this again."
echo "    2. Open 'alley-kings-single-file.html' in this folder — it needs"
echo "       nothing at all, but the loose bins and bottles will not move."
echo ""
read -r -p "  Press Enter to close." _
