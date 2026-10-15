// lockstep/pilotplan.mjs -- #6574: the pure scheduling of pilot.mjs (no Java, no server), so tools/pilotplancheck.mjs can prove it.
// One salt costs ~110 s of real-server time (two server boots), '--seeds 20' ~37 min, and a worker's command is limited to ~10 min.
// So pilot.mjs (1) skips every (lane, salt) already in its cache, (2) runs `jobs` salts at once, (3) STOPS STARTING salts when the
// next one could not finish inside the budget and says so with a 'partial' line; re-running the same command continues from the cache.
export const DEFAULT_EST_MS = 130e3;
export const taskKey = (t) => `${t.lane}-${t.salt}`;
/** #7542: the runner cache is per machine, so a salt a previous worker finished on another runner was lost and every worker restarted the ~37 min pilot.
 *  Finished salts are also written next to the code (pilot-results/<srcHash>/, committed with the branch); these are the keys to copy from there into the local cache. */
export const seedFromShared = (keys, local, shared) => keys.filter((k) => shared.has(k) && !local.has(k));
export const taskList = (lanes, from, n) => lanes.flatMap((lane) => Array.from({ length: n }, (_, i) => ({ lane, salt: from + i })));
/** #7474 (Dan, 14 Oct): a salt whose two REAL-SERVER runs differ is SERVER-UNSTABLE - no engine can match it, so it is excluded and the next
 *  salt replaces it, until n STABLE salts (up to n replacements per lane). Un-run salts count as stable until they say otherwise. */
export function planTasks(lanes, from, n, results = {}) {
  const out = [];
  for (const lane of lanes) {
    let stable = 0;
    for (let s = from; stable < n && s < from + 2 * n; s++) {
      const t = { lane, salt: s }; out.push(t);
      const r = results[taskKey(t)];
      if (!r || r.same) stable++;
    }
  }
  return out;
}
/** tasks whose result is already cached vs still to run (order kept) */
export function partition(tasks, cached) {
  const done = [], pending = [];
  for (const t of tasks) (cached[taskKey(t)] ? done : pending).push(t);
  return { done, pending };
}
/** a salt takes as long as the slowest finished one (+15 %: parallel jobs slow each other down), else the default */
export const estimate = (durationsMs) => (durationsMs.length ? Math.max(...durationsMs) * 1.15 : DEFAULT_EST_MS);
/** may another salt START now? It must fit the job cap and finish inside the budget; the first salt of a call always starts (progress). */
export function mayStart({ elapsedMs, budgetMs, estMs, running, jobs, pending, startedThisCall }) {
  if (pending <= 0 || running >= jobs) return false;
  if (running === 0 && startedThisCall === 0) return true;
  return elapsedMs + estMs <= budgetMs;
}
/** the last line pilot.mjs prints */
export function summary({ tasks, results, lanes, from, n, again }) {
  const res = (t) => results[taskKey(t)];
  const unstable = tasks.filter((t) => res(t) && !res(t).same).map(({ lane, salt }) => ({ lane, salt }));
  const remaining = tasks.filter((t) => !res(t)).length;
  // a lane that ran every planned salt and still has fewer than n stable ones (replacements ran out) is a real failure; otherwise unstable salts are just excluded
  const short = lanes.filter((l) => tasks.filter((t) => t.lane === l && res(t) && res(t).same).length < n && !tasks.some((t) => t.lane === l && !res(t)));
  const bad = unstable.filter((u) => short.includes(u.lane));
  if (remaining) return { pilot: 'partial', lanes, from, seeds: n, finished: tasks.length - remaining, remaining, divergences: bad, unstable, again };
  return from === 0 && n >= 20 ? { pilot: 'done', runs: lanes.length * n, divergences: bad, unstable } : { pilot: 'chunk', lanes, from, seeds: n, divergences: bad, unstable };
}
