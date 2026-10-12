#!/bin/sh
# Run the backend checks under the txiki.js runtime. An existing runtime is
# reused when present (TJS environment variable or `tjs` in PATH), otherwise the
# tinyjs release is fetched into .tinyjs-cli first.
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)

TJS_BIN="${TJS:-}"
if [ -z "$TJS_BIN" ] && [ -x "$ROOT/.tinyjs-cli/bin/tjs" ]; then TJS_BIN="$ROOT/.tinyjs-cli/bin/tjs"; fi
if [ -z "$TJS_BIN" ] && command -v tjs >/dev/null 2>&1; then TJS_BIN=$(command -v tjs); fi
if [ -z "$TJS_BIN" ]; then
  sh "$ROOT/scripts/get-tjs.sh" >/dev/null
  TJS_BIN="$ROOT/.tinyjs-cli/bin/tjs"
fi

echo "runtime: $TJS_BIN ($("$TJS_BIN" --version 2>/dev/null || echo unknown))"
exec "$TJS_BIN" run "$ROOT/tests/backend.test.js"
