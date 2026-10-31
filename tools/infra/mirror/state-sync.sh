#!/bin/bash
# #10420: the hosted full/farm runs have no persistent disk. Their state (full-last-failed.json, tia-history.jsonl, timing feed ... = MCLITE_DATA / MCLITE_PROJECTS) lives on a
# branch of the PRIVATE repo, force-pushed as ONE commit (never grows), exactly like tick-state.sh does for the tick. Run from the dir holding ./work.
#   state-sync.sh restore <branch> <dir>      state-sync.sh save <branch> <dir>
# Called through silent(): nothing here may be read from the public log.
set -u
G() { git -c credential.helper= -c user.name=state -c user.email=state@x "$@"; }
U="$(git -C work remote get-url origin)"; B="${2:?branch}"; D="${3:?dir}"
case "${1:-}" in
  restore)
    rm -rf "$D"; mkdir -p "$(dirname "$D")"
    G clone -q --depth 1 -b "$B" "$U" "$D" || { G init -q "$D" && G -C "$D" checkout -q --orphan "$B" && G -C "$D" remote add origin "$U"; }
    mkdir -p "$D/data" "$D/proj/_status" ;;
  save)
    cd "$D" && G checkout -q --orphan snap && G add -A -f . && G commit -qm state && G push -q -f origin "snap:$B" ;;
  *) echo "usage: state-sync.sh restore|save <branch> <dir>"; exit 2 ;;
esac
