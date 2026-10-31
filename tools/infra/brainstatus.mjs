// #10457: `go.mjs status` said "brain OFFLINE" while the hosted brain (BRAIN_RUNNER=mirror) ran roles: it read only the self-hosted `brain` runners of the retired VM.
// The brain is ONLINE when a VM runner is online OR the hosted brain is on (variable, or this process's env) OR a role run was seen recently (role-run.yml on the mirror).
export const RECENT_MIN = 90;
export function brainState({ runners = [], variable = null, env = {}, roleRuns = [], now = Date.now() } = {}) {
  const vm = runners.filter((r) => r.status === 'online').length;
  const hosted = variable === 'mirror' || env.BRAIN_RUNNER === 'mirror' || env.MCLITE_HOSTED === '1';
  const last = roleRuns.map((r) => Date.parse(r.created_at || r.run_started_at || 0)).filter((t) => t > 0).sort((a, b) => b - a)[0] || 0;
  const recent = last > 0 && now - last < RECENT_MIN * 60e3;
  const online = vm > 0 || hosted || recent;
  return { online, vm, hosted, lastRoleRun: last ? new Date(last).toISOString() : null, recent };
}
export function brainLines(s, registered = 0) {
  const req = `requests role (#7686): ${s.online ? 'online' : 'OFFLINE'}`;
  const main = s.hosted ? `brain HOSTED on the GitHub mirror (brain-tick chain, BRAIN_RUNNER=mirror; last role run ${s.lastRoleRun || 'not seen'}) - mail to commander/fixer starts a role run within ~5 min; --to dan reaches Dan's phone`
    : s.vm ? `brain ${s.vm}/${registered} runners online - mail to commander/fixer wakes them; --to dan reaches Dan's phone`
    : s.recent ? `brain online: a hosted role run was seen ${s.lastRoleRun} - mail to commander/fixer starts a role run`
    : `brain OFFLINE (${registered} registered, no hosted role run seen recently) - mail to commander wakes nobody; use the wake line in _status/commander-wake.md`;
  return { req, main };
}
