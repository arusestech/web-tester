#!/usr/bin/env sh
# WIGO Web Tester - terminal launcher (Linux / macOS / Git Bash)
#   ./run.sh                    GUI
#   ./run.sh scenarios/x.json   run directly
#   ./run.sh cli                terminal interactive
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
. "$DIR/bin/env.sh" || exit 1
exec "$NODE_EXE" cli.js "$@"
