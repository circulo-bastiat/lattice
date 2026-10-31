#!/bin/bash
# #10419: the hosted tick reads the PRIVATE repo's variables every tick (the phone's worker switch, `go.mjs loop`, FULL_MODE, ...) into an env file, like tools/brain/tick.sh does in the VM.
# Called through silent(); writes only `export NAME=value` lines (values from a fixed list) to $1.
set -u
OUT="$1"; : > "$OUT"
REPO="${MCLITE_REPO:?}"; T="${GH_TOKEN:?}"
for v in FILL_WORKERS FILL_WORKERS_MAX FILL_WORKERS_PRO FILL_TESTERS FULL_MODE FARM_FIRST; do
  x="$(curl -fsS -H "Authorization: Bearer $T" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$REPO/actions/variables/$v" 2>/dev/null | sed -n 's/.*"value": *"\([^"]*\)".*/\1/p')"
  [ -n "$x" ] && printf 'export %s=%q\n' "$v" "$x" >> "$OUT"
done
true
