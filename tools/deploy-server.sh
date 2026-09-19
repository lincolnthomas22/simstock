#!/usr/bin/env bash
#
# Deploys the match server to Fly.io and points the game at it.
#
#   ./tools/deploy-server.sh
#
# It checks what it needs first, deploys, waits for the server to answer, and
# then offers to write the address into game.js so nobody has to type one.
# Nothing is changed until it says what it is about to do.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*"; }
die()  { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

# ---------- what this needs ----------
if ! command -v flyctl >/dev/null 2>&1 && ! command -v fly >/dev/null 2>&1; then
  # Git Bash on Windows is a Unix-looking shell on a machine that needs the
  # Windows installer, so telling everyone to pipe install.sh into sh is wrong
  # for whoever is most likely to be reading this.
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
      die "flyctl is not installed.

  On Windows, install it from PowerShell, not from here. Open PowerShell and run:

      iwr https://fly.io/install.ps1 -useb | iex

  Then close this window, open Git Bash again, and re-run this script." ;;
    *)
      die "flyctl is not installed. Get it with:

      curl -L https://fly.io/install.sh | sh

  Then open a new terminal and run this again." ;;
  esac
fi
FLY=$(command -v flyctl || command -v fly)

if ! "$FLY" auth whoami >/dev/null 2>&1; then
  die "You are not signed in to Fly. Run:
    $FLY auth login"
fi
bold "Signed in to Fly as $("$FLY" auth whoami)"

[ -f fly.toml ] || die "fly.toml is missing. Run this from a checkout of the repository."
[ -f Dockerfile ] || die "Dockerfile is missing. Run this from a checkout of the repository."

APP=$(sed -n 's/^app *= *"\(.*\)"/\1/p' fly.toml | head -1)
[ -n "$APP" ] || die "Could not read the app name out of fly.toml."

# ---------- create the app, the first time ----------
if "$FLY" status --app "$APP" >/dev/null 2>&1; then
  bold "App '$APP' already exists; deploying over it."
else
  bold "Creating '$APP'."
  warn "App names are global on Fly, so if that one is taken, edit the 'app' line"
  warn "in fly.toml to something else and run this again."
  REGION=$(sed -n 's/^primary_region *= *"\(.*\)"/\1/p' fly.toml | head -1)
  # --copy-config keeps the fly.toml in the repository rather than writing a new one.
  "$FLY" launch --no-deploy --copy-config --name "$APP" --region "${REGION:-iad}" --yes
fi

# ---------- deploy ----------
bold "Building and deploying. The image carries sim.js from the repository root,"
bold "so this has to run from here rather than from server/."
"$FLY" deploy --app "$APP"

# ---------- wait for it to actually answer ----------
HOST="$APP.fly.dev"
bold "Waiting for https://$HOST/health"
for i in $(seq 1 30); do
  if curl -fsS --max-time 10 "https://$HOST/health" >/dev/null 2>&1; then
    echo
    bold "Up:"
    curl -fsS "https://$HOST/health"
    echo
    ADDRESS="wss://$HOST"
    break
  fi
  sleep 4
done
[ -n "${ADDRESS:-}" ] || die "The server did not answer in two minutes. Check: $FLY logs --app $APP"

# ---------- point the game at it ----------
bold "Match server address: $ADDRESS"
CURRENT=$(sed -n "s/^  const DEFAULT_SERVER = '\(.*\)';/\1/p" game.js | head -1)
if [ "$CURRENT" = "$ADDRESS" ]; then
  bold "game.js already points at it. Nothing else to do."
  exit 0
fi

echo
echo "game.js currently has DEFAULT_SERVER = '${CURRENT}'."
read -r -p "Set it to $ADDRESS? [y/N] " reply
case "$reply" in
  [yY]*)
    # The address is a URL, so a delimiter that cannot appear in one.
    sed -i.bak "s|^  const DEFAULT_SERVER = '.*';|  const DEFAULT_SERVER = '$ADDRESS';|" game.js
    rm -f game.js.bak
    grep -n "^  const DEFAULT_SERVER" game.js
    echo
    bold "Done. Commit and push, and the live site connects on its own:"
    echo "    git add game.js && git commit -m 'Point the lobby at the deployed match server' && git push"
    ;;
  *)
    echo "Left alone. To do it later, set this line in game.js:"
    echo "    const DEFAULT_SERVER = '$ADDRESS';"
    ;;
esac
