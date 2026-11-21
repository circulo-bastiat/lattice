# Sourced by every lattice workflow step that touches code, issues, accounts or usage (#8913). The mirror's job logs are public:
# the command's stdout+stderr go to $RUNNER_TEMP/out.log (never uploaded); the log gets only the exit code and elapsed seconds.
silent() {
  local name="$1" t0 rc; shift
  t0=$(date +%s)
  "$@" >> "${RUNNER_TEMP:-/tmp}/out.log" 2>&1
  rc=$?
  echo "[silent] $name exit=$rc elapsed=$(( $(date +%s) - t0 ))s"
  return $rc
}
