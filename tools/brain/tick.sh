#!/bin/bash
# tools/brain/tick.sh - THE BRAIN'S OWN CLOCK (19 Oct, Dan: "a permanent solution"). A systemd timer in the brain VM runs this every 2 min.
# Why: GitHub throttles Actions cron on this account (24 h: schedules fired every 2-8 h, brain.yml's */5 never), and after #8893 bus comments
# no longer run the fill, so a late GitHub tick left 0 workers for hours. This clock does not go through GitHub's scheduler at all: it keeps
# its own clone of master current, reads the repo variables the workflow would pass, and runs `health --if-due` + `fill` (both idempotent,
# so a concurrent GitHub tick is harmless). Every run stamps ~/.brain/tick.json; `go.mjs status` / the health pass report a stale stamp.
set -u
exec 9>"$HOME/.brain/tick.lock"; flock -n 9 || exit 0
REPO="${BRAIN_REPO:-owner/mclite}"; DIR="$HOME/brain-tick/repo"; T="$(cat "$HOME/.brain/github-token")"
AUTH="http.https://github.com/.extraheader=AUTHORIZATION: basic $(printf 'x-access-token:%s' "$T" | base64 -w0)"
mkdir -p "$HOME/brain-tick"
if [ ! -d "$DIR/.git" ]; then git -c "$AUTH" clone -q --depth 1 "https://github.com/$REPO.git" "$DIR" || { echo "clone failed"; exit 1; }; fi
cd "$DIR" || exit 1
rm -f .git/index.lock
git -c "$AUTH" fetch -q --depth 1 origin master && git reset -q --hard FETCH_HEAD || echo "fetch failed - running the last good copy"
# #9665: systemd runs the INSTALLED copy (~/brain-tick/tick.sh, put there once by vm-setup.sh); it must follow master's tick.sh or no change to it ever runs
# (19-22 Oct: the FULL_MODE and #9544 MIRROR_* exports never ran). Replace it and re-run once.
# (a master tick.sh that does not even parse is never installed: the clock keeps the copy that works)
if [ -z "${TICK_UPDATED:-}" ] && [ -s "$DIR/tools/brain/tick.sh" ] && ! cmp -s "$DIR/tools/brain/tick.sh" "$0" && bash -n "$DIR/tools/brain/tick.sh"; then
  cp "$DIR/tools/brain/tick.sh" "$0.new" && chmod +x "$0.new" && mv -f "$0.new" "$0" && { echo "tick.sh: installed copy updated from master, re-running"; exec 9>&-; TICK_UPDATED=1 exec "$0"; }
fi
vars() { curl -fsS -H "Authorization: Bearer $T" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$REPO/actions/variables/$1" 2>/dev/null | sed -n 's/.*"value": *"\([^"]*\)".*/\1/p'; }
for v in FILL_WORKERS FILL_WORKERS_MAX FILL_WORKERS_PRO FILL_TESTERS FULL_MODE; do x="$(vars $v)"; [ -n "$x" ] && export "$v=$x"; done
export GH_TOKEN="$T" NODE_OPTIONS=--dns-result-order=ipv4first
# #9544: the fill dispatches worker packs and reads the mirror headroom with these (WORKER_RUNNER=mirror); without them every worker ran in the VM
[ -r "$HOME/.brain/mirror-token" ] && export MIRROR_TOKEN="$(cat "$HOME/.brain/mirror-token")"
[ -r "$HOME/.brain/mirror-repo" ] && export MIRROR_REPO="$(cat "$HOME/.brain/mirror-repo")"
# the mirror's own GitHub App identity (tools/infra/apptoken.mjs), when its creds were copied here: tools/infra/mirror.mjs then mints its own tokens
[ -r "$HOME/.brain/mirror-app-id.txt" ] && [ -r "$HOME/.brain/mirror-app.pem" ] && export MIRROR_APP_ID="$(cat "$HOME/.brain/mirror-app-id.txt")" MIRROR_APP_KEY="$(cat "$HOME/.brain/mirror-app.pem")" && { AT="$(node tools/infra/apptoken.mjs 2>/dev/null)" && [ -n "$AT" ] && MIRROR_TOKEN="$AT"; }
node tools/brain/brain.mjs health --if-due || true
node tools/brain/brain.mjs fill || true
printf '{"at":"%s","sha":"%s"}\n' "$(date -u +%FT%TZ)" "$(git rev-parse --short HEAD)" > "$HOME/.brain/tick.json"
