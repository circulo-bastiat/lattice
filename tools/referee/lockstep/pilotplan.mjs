// lockstep/pilotplan.mjs -- #6574: the pure scheduling of pilot.mjs (no Java, no server), so tools/pilotplancheck.mjs can prove it.
// One salt costs ~110 s of real-server time (two server boots), '--seeds 20' ~37 min, and a worker's command is limited to ~10 min.
// So pilot.mjs (1) skips every (lane, salt) already in its cache, (2) runs `jobs` salts at once, (3) STOPS STARTING salts when the
// next one could not finish inside the budget and says so with a 'partial' line; re-running the same command continues from the cache.
export const DEFAULT_EST_MS = 130e3;
export const taskKey = (t) => `${t.lane}-${t.salt}`;
export const taskList = (lanes, from, n) => lanes.flatMap((lane) => Array.from({ length: n }, (_, i) => ({ lane, salt: from + i })));
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
  const bad = tasks.filter((t) => results[taskKey(t)] && !results[taskKey(t)].same).map(({ lane, salt }) => ({ lane, salt }));
  const remaining = tasks.filter((t) => !results[taskKey(t)]).length;
  if (remaining) return { pilot: 'partial', lanes, from, seeds: n, finished: tasks.length - remaining, remaining, divergences: bad, again };
  return from === 0 && n >= 20 ? { pilot: 'done', runs: lanes.length * n, divergences: bad } : { pilot: 'chunk', lanes, from, seeds: n, divergences: bad };
}
