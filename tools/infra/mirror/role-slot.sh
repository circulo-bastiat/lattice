# Sourced by role-run.yml (#10419): one brain role run, the same sequence brain.yml's `run` job runs on the VM (launch.mjs, from master's own code), in the
# private clone. Output goes through silent() (public log); a failure posts its last lines to the PRIVATE bus (`to: log`), the only place it is readable.
# role_slot <dir>   env: BRAIN_HOME ROLE REASON ACCOUNT
role_post() {   # role_post <text>: one line to the private bus, never to stdout
  ( cd "$ROLE_DIR" && TXT="$1" node -e "import('./tools/brain/home.mjs').then((m) => m.post('log', process.env.TXT)).catch(() => {})" >/dev/null 2>&1 ) || true
}
role_slot() {
  local dir="$1" rc tailx
  ROLE_DIR="$dir"; cd "$dir" || return 1
  export GH_TOKEN="$(cat "$BRAIN_HOME/github-token")" GIT_TERMINAL_PROMPT=0 MCLITE_BRAIN=1 MCLITE_RUN_ACCOUNT="$ACCOUNT"
  git config user.name "mclite brain"; git config user.email "brain@mclite.local"
  git config --global url."https://x-access-token:${GH_TOKEN}@github.com/".insteadOf "https://github.com/" || true
  [ "$ACCOUNT" = phase ] && export MCLITE_LANE=phase
  # the dispatch carries only `bus:<comment id>` (public repo: the mail text must not be an input); expand it here with the private token
  case "$REASON" in bus:[0-9]*) REASON="$(BUSID="${REASON#bus:}" node -e "import('./tools/brain/route.mjs').then(async (r) => { const { gh } = await import('./tools/infra/gh.mjs'); const { CFG } = await import('./tools/brain/home.mjs'); const c = await gh('GET', '/repos/{repo}/issues/comments/' + process.env.BUSID); const d = r.routeComment(c.body, CFG); console.log((d.reason || 'mail') + ' (bus message ' + c.id + ')'); }).catch(() => console.log('mail (unreadable)'))" 2>/dev/null | tr '\r\n' '  ')";; esac
  export REASON
  node tools/brain/launch.mjs --role "$ROLE" --reason "$REASON" ${ACCOUNT:+--account "$ACCOUNT"} > .git/launch.log 2>&1; rc=$?
  if [ $rc -ne 0 ]; then
    tailx="$(tail -c 700 .git/launch.log | tr '\n' ' ')"
    role_post "brain: $ROLE launch FAILED on the mirror (exit $rc): $tailx"
  fi
  return $rc
}
