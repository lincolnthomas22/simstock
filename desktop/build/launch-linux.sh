#!/bin/sh
# SimStock, started the way Linux needs it started.
#
# Point Steam's launch options at this file rather than at the binary. It asks
# the game itself whether Chromium can sandbox on this machine, and hands over
# with or without --no-sandbox accordingly.
#
# The reason it exists: the Linux build ships a `chrome-sandbox` helper that has
# to be owned by root with the setuid bit set. A Steam depot does not carry
# setuid bits and Steam's pressure-vessel container does not add them, so on a
# Steam Deck the helper is there but not trusted, and Chromium aborts before
# drawing a window. The player presses Play and nothing happens.
#
# The switch has to be set before the process starts. sandbox.js explains why
# doing it from inside the app does not work.
set -eu

HERE=$(dirname "$(readlink -f "$0")")
GAME="$HERE/SimStock"

if [ ! -x "$GAME" ]; then
  echo "launch: cannot find the game next to this script ($GAME)" >&2
  exit 1
fi

# The probe is the same file the app itself uses. It is listed in asarUnpack so
# it exists as a real file here as well as inside the archive — one set of
# rules, one answer, no second copy to drift.
PROBE="$HERE/resources/app.asar.unpacked/sandbox.js"

# If the probe is missing or will not run, fall through to --no-sandbox. A game
# that starts with one layer less beats a game that does not start.
if [ -f "$PROBE" ] && ELECTRON_RUN_AS_NODE=1 "$GAME" "$PROBE" >/dev/null 2>&1; then
  exec "$GAME" "$@"
fi

exec "$GAME" --no-sandbox "$@"
