# Sourced by worker-pack.yml (#8992): one worker slot, the same sequence brain.yml runs on the VM (claim + workspace BEFORE any Claude starts, then
# prelaunch, then launch.mjs), in its own copy of the source. Every command's output goes through silent() (public log); a failure posts its last
# lines to the PRIVATE bus (`to: log`), which is the only place a hosted worker's problems are readable.
# pack_slot <dir> [<pinned issue>]   env: BRAIN_HOME ACCOUNT (may be empty)
pack_post() {   # pack_post <text>: one line to the private bus, never to stdout
  ( cd "$PACK_DIR" && TXT="$1" node -e "import('./tools/brain/home.mjs').then((m) => m.post('log', process.env.TXT)).catch(() => {})" >/dev/null 2>&1 ) || true
}
pack_slot() {
  local dir="$1" pin="$2" rc tailx
  PACK_DIR="$dir"; cd "$dir" || return 1
  export GH_TOKEN="$(cat "$BRAIN_HOME/github-token")" GIT_TERMINAL_PROMPT=0 MCLITE_BRAIN=1 MCLITE_RUN_ACCOUNT="$ACCOUNT"
  git config user.name "mclite brain"; git config user.email "brain@mclite.local"
  git config --global url."https://x-access-token:${GH_TOKEN}@github.com/".insteadOf "https://github.com/" || true
  rm -f .git/mclite-brief.txt
  [ "$ACCOUNT" = phase ] && export MCLITE_LANE=phase   # #9735: the phase lane pack (account phase): the claim takes phase issues only
  if ! MCLITE_WHO=worker timeout 1800 flock "$BRAIN_HOME/start.lock" node tools/go.mjs start ${pin:+--issue "$pin"} > .git/mclite-brief.txt 2>&1 || ! grep -q '^## YOUR ISSUE' .git/mclite-brief.txt; then
    if grep -q 'nothing to claim' .git/mclite-brief.txt; then mkdir -p "$BRAIN_HOME"; date +%s > "$BRAIN_HOME/noclaim-${ACCOUNT:-default}"; [ -f "$BRAIN_HOME/noclaim-posted" ] || { pack_post "noclaim: ${ACCOUNT:-default} (#9735: a packed worker found nothing to claim; the fill holds this pool 20 min)"; touch "$BRAIN_HOME/noclaim-posted"; }; return 0; fi
    tailx="$(tail -3 .git/mclite-brief.txt | tr '\n' ' ' | cut -c1-300)"
    pack_post "brain: packed worker not started - go.mjs start failed on the mirror (no Claude session spent): $tailx"
    return 0
  fi
  if node tools/infra/prelaunch.mjs .git/mclite-brief.txt 2>/dev/null | grep -q '^SATISFIED'; then return 0; fi
  node tools/brain/launch.mjs --role worker --reason "fill (packed on the mirror)" ${ACCOUNT:+--account "$ACCOUNT"} > .git/launch.log 2>&1; rc=$?
  if [ $rc -ne 0 ]; then
    tailx="$(tail -c 700 .git/launch.log | tr '\n' ' ')"
    pack_post "brain: packed worker launch FAILED on the mirror (exit $rc): $tailx"
  fi
  return $rc
}
