#!/usr/bin/env bash
# Assembles the distributable zip: launchers + the full game + the no-dependency
# single-file fallback. Run from anywhere; paths are resolved relative to this
# script.
#
#   ./scripts/make-package.sh   ->   dist-package/alley-kings.zip

set -euo pipefail
cd "$(dirname "$0")/.."

OUT="dist-package"
STAGE="${OUT}/alley-kings"

echo "==> Building the served game (with Havok physics)"
npx vite build --outDir package/game --emptyOutDir --sourcemap false

echo "==> Building the single-file fallback"
npm run build:standalone

echo "==> Staging"
rm -rf "$OUT"
mkdir -p "$STAGE"
cp -r package/game "$STAGE/game"
cp package/serve.mjs package/README.txt package/PLAY-WINDOWS.bat "$STAGE/"
cp package/PLAY-mac-linux.command "$STAGE/"
cp dist-standalone/alley-kings.html "$STAGE/alley-kings-single-file.html"
chmod +x "$STAGE/PLAY-mac-linux.command" "$STAGE/serve.mjs"

echo "==> Zipping"
( cd "$OUT" && zip -rq alley-kings.zip alley-kings )

echo ""
echo "Done: ${OUT}/alley-kings.zip"
du -h "${OUT}/alley-kings.zip"
