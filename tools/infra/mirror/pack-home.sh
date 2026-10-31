# Sourced by worker-pack.yml AFTER the private source is cloned (#8992). Builds the brain's machine-local home (tools/brain/home.mjs BRAIN_HOME) on a
# fresh hosted runner from secrets passed as ENV VARS (never arguments): a hosted job has no ~/.brain, and launch.mjs needs tokens/<account>.txt and github-token.
# Prints NOTHING (the mirror's job log is public).  env: CLAUDE_TOKEN_MAX CLAUDE_TOKEN_PRO MCLITE_PAT MIRROR_REPO MIRROR_TOKEN; BRAIN_HOME optional.
pack_home() {
  local h="${BRAIN_HOME:-$HOME/.brain}"
  ( umask 077; mkdir -p "$h/tokens" "$h/logs"
    [ -n "$CLAUDE_TOKEN_MAX" ] && printf '%s' "$CLAUDE_TOKEN_MAX" > "$h/tokens/max.txt"
    [ -n "$CLAUDE_TOKEN_PRO" ] && printf '%s' "$CLAUDE_TOKEN_PRO" > "$h/tokens/pro.txt"
    [ -n "$MCLITE_PAT" ] && printf '%s' "$MCLITE_PAT" > "$h/github-token"
    if [ -n "$MIRROR_REPO" ] && [ -n "$MIRROR_TOKEN" ]; then printf '%s' "$MIRROR_REPO" > "$h/mirror-repo"; printf '%s' "$MIRROR_TOKEN" > "$h/mirror-token"; fi
    true ) || return 1
  export BRAIN_HOME="$h"
  [ -s "$h/github-token" ] && { [ -s "$h/tokens/max.txt" ] || [ -s "$h/tokens/pro.txt" ]; }
}
