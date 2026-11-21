# Sourced by the lattice workflows (#10420) after a silent() step failed: the public log has only the exit code, so the last lines of the step's output
# (RUNNER_TEMP/out.log, tokens scrubbed) go to the PRIVATE bus as `to: log` by API, the only place they are readable. failpost <label> [dir]
failpost() {
  local t
  t="$(tail -c 900 "${RUNNER_TEMP:-/tmp}/out.log" 2>/dev/null | tr '\n' ' ' | sed -E 's/(ghp_|github_pat_|ghs_|sk-ant-)[A-Za-z0-9_-]+/<token>/g')"
  ( cd "${2:-work}" && TXT="mirror: $1 FAILED: $t" node -e "import('./tools/brain/home.mjs').then((m) => m.post('log', process.env.TXT)).catch(() => {})" >/dev/null 2>&1 ) || true
}
