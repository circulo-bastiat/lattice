#!/bin/bash
# #10418: the hosted tick has no ~/.brain, but the fill's holds, cooldowns and mail dedupe live in BRAIN_HOME (history.json ...). `restore` clones the private
# repo's usage-data branch into ./ud (home/ = BRAIN_HOME); `save` pushes ./ud as ONE commit (force: the branch never grows). Run from the dir holding ./work.
# Called through silent(): nothing here may be read from the public log.
set -u
G() { git -c credential.helper= -c user.name=tick -c user.email=tick@x "$@"; }
U="$(git -C work remote get-url origin)"
case "${1:-}" in
  restore)
    rm -rf ud
    G clone -q --depth 1 -b usage-data "$U" ud || { G init -q ud && G -C ud checkout -q --orphan usage-data && G -C ud remote add origin "$U"; }
    mkdir -p ud/home
    # #10653: a clone stamps every file with the clone time, but the brain reads a noclaim marker's AGE from its mtime (brain.mjs noClaimHold): without this every
    # marker looked "just written" on every tick and held its pool forever (no hosted worker from 22:50Z to 03:48Z, 30 Oct). Age = the epoch in the file (s or ms).
    for f in ud/home/noclaim-*; do [ -f "$f" ] || continue; v=$(tr -dc 0-9 < "$f"); [ -n "$v" ] || continue; [ "${#v}" -gt 11 ] && v=$((v / 1000)); touch -d "@$v" "$f"; done ;;
  save)
    cp work/usage.json ud/usage.json 2>/dev/null
    cd ud && G checkout -q --orphan snap && G add -A -f . && G commit -qm tick && G push -q -f origin snap:usage-data ;;
  *) echo "usage: tick-state.sh restore|save"; exit 2 ;;
esac
