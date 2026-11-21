#!/usr/bin/env bash
# Build the Reedance Studio installer.
#
# Usage:
#   scripts/build-installer.sh            # Windows NSIS installer (.exe)
#   scripts/build-installer.sh win        # same as above
#   scripts/build-installer.sh linux      # Linux .deb installer
#   scripts/build-installer.sh appimage   # Linux AppImage (single file)
#
# The build needs the Electron runtime, which electron-builder downloads from
# GitHub release assets. Run this on a machine with normal internet access
# (the sandbox used for development blocks the GitHub release CDN).
set -euo pipefail

cd "$(dirname "$0")/.."

target="${1:-win}"

echo "→ building the app (main + preload + renderer)"
npm run build

case "$target" in
  win)
    echo "→ packaging Windows NSIS installer"
    npx electron-builder --win nsis --x64 --publish never
    ;;
  linux)
    echo "→ packaging Linux .deb installer"
    npx electron-builder --linux deb --x64 --publish never
    ;;
  appimage)
    echo "→ packaging Linux AppImage"
    npx electron-builder --linux AppImage --x64 --publish never
    ;;
  *)
    echo "unknown target '$target' (use: win | linux | appimage)" >&2
    exit 1
    ;;
esac

echo "→ installer written under release/:"
ls -1 release/*.${target##*-} 2>/dev/null || ls -1 release/
