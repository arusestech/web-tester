#!/usr/bin/env sh
# Resolve Node runtime + bundled browsers. Sets NODE_EXE. Sourced by wigo-web-tester.sh / run.sh
# No network access is attempted here (closed-network safe).
ROOT="$(cd "$(dirname "$0")" && pwd)"
NODE_EXE=""
case "$(uname -s)" in
  Darwin) [ -x "$ROOT/runtime/mac/node" ] && NODE_EXE="$ROOT/runtime/mac/node" ;;
  *)      [ -x "$ROOT/runtime/linux/node" ] && NODE_EXE="$ROOT/runtime/linux/node" ;;
esac
if [ -z "$NODE_EXE" ] && command -v node >/dev/null 2>&1; then NODE_EXE="$(command -v node)"; fi
if [ -z "$NODE_EXE" ]; then
  echo "[ERROR] Node.js not found. Install Node 20+ or use the bundle that includes runtime/<os>/node."
  exit 1
fi
[ -d "$ROOT/browsers" ] && export PLAYWRIGHT_BROWSERS_PATH="$ROOT/browsers"
if [ ! -d "$ROOT/node_modules/playwright" ]; then
  echo "[ERROR] node_modules/playwright missing. Use the bundled zip, or run 'npm install' on a PC with internet."
  exit 1
fi
export NODE_EXE
