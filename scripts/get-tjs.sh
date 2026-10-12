#!/bin/sh
# Fetch the tinyjs release for this OS and architecture into .tinyjs-cli, verify
# its checksum and print the paths. Used by CI and by the test scripts; nothing
# is installed system-wide and no sudo is involved.
#
#   sh scripts/get-tjs.sh [version]        # default: TINYJS_VERSION or v0.50.1
#   prints: TINYJS=<dir>/tinyjs   TJS=<dir>/bin/tjs
set -eu

VERSION="${1:-${TINYJS_VERSION:-v0.50.1}}"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DEST="${TINYJS_HOME:-$ROOT/.tinyjs-cli}"

case "$(uname -s)" in
  Linux) PLAT=linux ;;
  Darwin) PLAT=macos ;;
  *) echo "unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac

case "$(uname -m)" in
  x86_64|amd64) CPU=x86_64 ;;
  arm64|aarch64) CPU=arm64 ;;
  *) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

ASSET="tinyjs-${PLAT}-${CPU}.tar.gz"
BASE="https://github.com/tarwin/tinyjsapp/releases/download/${VERSION}"

if [ -x "$DEST/bin/tjs" ] && [ -f "$DEST/.version" ] && [ "$(cat "$DEST/.version")" = "$VERSION" ]; then
  echo "tinyjs $VERSION is already in $DEST" >&2
else
  TMP=$(mktemp -d)
  trap 'rm -rf "$TMP"' EXIT INT TERM
  echo "downloading $ASSET ($VERSION)" >&2
  curl -fsSL -o "$TMP/$ASSET" "$BASE/$ASSET"
  curl -fsSL -o "$TMP/checksums.txt" "$BASE/checksums.txt"

  if command -v shasum >/dev/null 2>&1; then SHA="shasum -a 256"; else SHA="sha256sum"; fi
  if ! (cd "$TMP" && grep " $ASSET\$" checksums.txt | $SHA -c - >/dev/null); then
    echo "checksum mismatch for $ASSET — refusing to install" >&2
    exit 1
  fi

  rm -rf "$DEST"
  mkdir -p "$DEST"
  tar -xzf "$TMP/$ASSET" -C "$DEST" --strip-components 1
  echo "$VERSION" > "$DEST/.version"
  echo "installed tinyjs $VERSION into $DEST" >&2
fi

echo "TINYJS=$DEST/tinyjs"
echo "TJS=$DEST/bin/tjs"
