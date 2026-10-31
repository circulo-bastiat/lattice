// ladder.mjs - #4975: the self-healing ladder. ONE symptom, one detector, a fixed ladder of pre-approved automatic rungs, a page only at the top.
// Two watchers call climb() from different failure domains (the brain health pass on the VM, vmwatch.tick on the PC); neither needs
// hosted minutes. stalled()/climb() are pure over injected rungs (laddercheck drives them through the four 9-10 Oct standstills).
// Decision: docs/decisions/4975-self-healing-ladder.md. No new alarm: the page is the one the health pass already sends.
export const STALL_MIN = 45, BEAT_MIN = 45, REARM_MIN = 120;

/** The symptom: nothing merged AND no worker/tester ran for 45 min while work is claimable. Unknown inputs (null) never stall. */
export function stalled({ now, lastMergeAt, lastRunAt, claimable, capped = false }) {
  if (capped || !(claimable > 0) || !lastMergeAt) return false;   // #5105: every account at its usage cap is the caps' wait, not a fault
  return now - lastMergeAt >= STALL_MIN * 60e3 && now - (lastRunAt || 0) >= STALL_MIN * 60e3;
}

/** One tick. st = {i, paged} (persisted by the caller); rungs = [{name, run: async () => line | null}] - null = nothing to fix here,
 *  so the climb goes on in the same tick; a line = it acted, wait a tick to see whether it worked. Recovery resets the state.
 *  -> {st, acted: rung name | 'page' | null}. say() is the one bus line per rung. */
export async function climb({ st, isStalled, rungs, say, page, save = async () => {}, now = Date.now() }) {
  if (!isStalled) return { st: { i: 0, paged: false }, acted: null };
  st = { i: st?.i || 0, paged: !!st?.paged, ...(st?.pagedAt ? { pagedAt: st.pagedAt } : {}) };
  // #5105: a page is not the end - a stall that outlives REARM_MIN climbs the ladder again (11 Oct: paged once, then silent for 7 h)
  if (st.paged && now - (st.pagedAt || 0) >= REARM_MIN * 60e3) st = { i: 0, paged: false };
  for (; st.i < rungs.length; st.i++) {
    let line = null;
    await save({ ...st, i: st.i + 1 });   // #5105: recorded BEFORE the rung runs - a rung that kills this process must not run again next pass
    try { line = await rungs[st.i].run(); } catch (e) { line = `failed: ${String(e.message || e).slice(0, 120)}`; }
    if (line) { await say(`ladder: ${rungs[st.i].name} - ${line}`); st.i++; return { st, acted: rungs[st.i - 1].name }; }
  }
  if (st.paged) return { st, acted: null };
  st.paged = true; st.pagedAt = now; await page('the self-healing ladder (#4975) tried every rung and work is still stalled'); await say('ladder: page - every rung tried, Dan told');
  return { st, acted: 'page' };
}

/** #5105: true when EVERY account in MCLITE_USAGE (u = {at, accounts: {name: {window, week}}}) is at its usage cap (route.usageCap with the
 *  account's own week cap). Unknown or stale usage = false (a blind watcher must not call a real stall a cap). */
export function allCapped(cfg, u, now, usageCap, accountWeekCap) {
  const A = u && u.accounts ? Object.entries(u.accounts).filter(([, a]) => a && a.window) : [];
  if (!A.length) return false;
  return A.every(([name, a]) => usageCap(cfg, { window: a.window, week: a.week, at: u.at, weekCap: accountWeekCap(cfg, name) }, now) === 0);
}

/** The rungs that need only GitHub (so either watcher can run them). local = {clearNoclaim, freeDisk, restartRunners}: each async () => line | null,
 *  this watcher's own machine. Order is the issue's: fill, noclaim, disk, services, smoke, TEST_RUNNER, bounced PRs. */
export function rungs({ gh, local = {}, sweep, now = Date.now(), start = (inp) => gh('POST', '/repos/{repo}/actions/workflows/brain.yml/dispatches', { ref: 'master', inputs: inp }) }) {   // #10419: `start` = where a role run begins (brain.mjs passes roledispatch.startRole)
  const none = async () => null, L = (k) => local[k] || none;
  return [
    { name: 'restart-fill', run: async () => { await start({ role: 'waker', reason: `ladder ${new Date(now).toISOString()}` }); return 'dispatched a waker'; } },
    { name: 'clear-noclaim', run: L('clearNoclaim') },
    { name: 'free-disk', run: L('freeDisk') },
    { name: 'restart-runners', run: L('restartRunners') },
    { name: 'rerun-smoke', run: async () => { await gh('POST', '/repos/{repo}/actions/workflows/smoke.yml/dispatches', { ref: 'master' }); return 'dispatched smoke.yml'; } },
    { name: 'flip-test-runner', run: async () => {   // the mode whose land/full-suite runs sit queued >20 min is the one that is not working
      const tr = (await gh('GET', '/repos/{repo}/actions/variables/TEST_RUNNER', null, { ok404: true }))?.value;
      if (tr === 'lattice') return null;   // #10420: the lander runs on the mirror; there is no pc/hosted pair to flip between
      const cur = tr === 'pc' ? 'pc' : 'hosted', to = cur === 'pc' ? 'hosted' : 'pc';
      const q = (await gh('GET', '/repos/{repo}/actions/workflows/land.yml/runs?status=queued&per_page=20')).workflow_runs || [];
      if (!q.some((r) => now - Date.parse(r.created_at) > 20 * 60e3)) return null;
      const body = { name: 'TEST_RUNNER', value: to };
      if ((await gh('PATCH', '/repos/{repo}/actions/variables/TEST_RUNNER', body, { ok404: true })) === null) await gh('POST', '/repos/{repo}/actions/variables', body);
      return `land runs sat queued on ${cur}: TEST_RUNNER=${to}`; } },
    { name: 'relabel-bounced', run: async () => { const r = await sweep(); return r.acts.length ? r.acts.join(', ') : null; } },
  ];
}
