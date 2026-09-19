#!/usr/bin/env sh
# WIGO Web Tester - GUI launcher (Linux / macOS)
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
. "$DIR/bin/env.sh" || exit 1
exec "$NODE_EXE" cli.js gui "$@"
