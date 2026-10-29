#!/usr/bin/env bash
# Register CV fonts with fontconfig. Safe to run more than once.
# System packages (TeX Live, fonts) come from the Cloud Agent image.
set -euo pipefail

TEX_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -w /etc/fonts/conf.d ]]; then
  CONF_DIR="/etc/fonts/conf.d"
else
  CONF_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/fontconfig/conf.d"
fi
CONF_FILE="$CONF_DIR/99-academic-cv.conf"

mkdir -p "$CONF_DIR"

candidate_dirs=(
  /usr/share/texlive/texmf-dist/fonts/opentype
  /usr/share/texlive/texmf-dist/fonts/truetype
  /usr/share/texmf/fonts/opentype
  /usr/share/texmf/fonts/truetype
  "$TEX_DIR/fonts"
)

TMP_CONF="$(mktemp)"
{
  echo '<?xml version="1.0"?>'
  echo '<!DOCTYPE fontconfig SYSTEM "fonts.dtd">'
  echo '<fontconfig>'
  for dir in "${candidate_dirs[@]}"; do
    if [[ -d "$dir" ]]; then
      echo "  <dir>${dir}</dir>"
    fi
  done
  echo '</fontconfig>'
} >"$TMP_CONF"

if [[ ! -f "$CONF_FILE" ]] || ! cmp -s "$TMP_CONF" "$CONF_FILE"; then
  mv "$TMP_CONF" "$CONF_FILE"
else
  rm -f "$TMP_CONF"
fi
fc-cache >/dev/null
echo "fontconfig: ${CONF_FILE}"

for cmd in xelatex latexmk fc-list; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "missing command: ${cmd}" >&2
    exit 1
  fi
done
echo "xelatex: $(command -v xelatex)"
echo "latexmk: $(command -v latexmk)"

# FontAwesome is the TeX Live OpenType family from texlive-fonts-extra.
required_fonts=(
  "Roboto"
  "Source Sans Pro"
  "FontAwesome"
  "Latin Modern Math"
)
missing=0
for name in "${required_fonts[@]}"; do
  matches="$(fc-list "$name" file)"
  if [[ -n "$matches" ]]; then
    echo "resolved: ${name}"
  else
    echo "unresolved: ${name}" >&2
    missing=1
  fi
done

if [[ "$missing" -ne 0 ]]; then
  exit 1
fi
