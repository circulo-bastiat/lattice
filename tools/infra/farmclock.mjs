// farmclock.mjs (22 Oct, Dan: the farm must be a constant source of work): GitHub drops cron ticks (5 full-suite runs on 18 Oct, not 12), so the brain tick - the
// real clock, like fullDispatchDue (#9180) - dispatches pilot-farm.yml when its newest run is old and nothing is running. `runs` = workflow_runs, newest first.
export const farmAgeMin = (runs, now) => { const r = (runs || []).find((x) => x && x.created_at); return r ? Math.round((now - Date.parse(r.created_at)) / 60e3) : null; };
export function farmDispatchDue(runs, now, lastDispatch = 0, { maxAgeMin = 140, everyMin = 60 } = {}) {
  if (!Array.isArray(runs)) return false;                                                   // unreadable = unknown, never dispatch blind
  if (runs.some((r) => r && (r.status === 'in_progress' || r.status === 'queued'))) return false;
  if (now - lastDispatch < everyMin * 60e3) return false;
  const age = farmAgeMin(runs, now);
  return age === null || age > maxAgeMin;                                                   // no run at all = never started = due
}
