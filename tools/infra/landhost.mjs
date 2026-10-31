// #10420: the lander with NO machine of Dan's. TEST_RUNNER=lattice (a private repo variable): the private repo's land.yml runs nothing (its jobs are for `pc`,
// `mirror` and `hosted` and the repo has no hosted minutes); the hosted brain tick starts the PUBLIC mirror's land.yml (#8916: private checkout by PAT, test, merge
// through the private API, silent) whenever PRs wait and none is running. land.mjs drains the whole `land` queue per run, so one run at a time is the whole job.
export const latticeLander = (v) => v === 'lattice';
export const LAND_COOLDOWN_MS = 4 * 60e3;   // a run dispatched a moment ago may not be listed as queued yet

/** pure: dispatch when PRs wait, no lattice land run is queued/running and we did not dispatch in the last 4 minutes. `prs` = PR numbers labelled land, oldest first. */
export function landTickDecision({ prs, active, lastDispatchAt, now = Date.now() }) {
  if (!prs || !prs.length) return { do: 'none', why: 'nothing waits' };
  if (active > 0) return { do: 'none', why: 'a run is active' };
  if (lastDispatchAt && now - lastDispatchAt < LAND_COOLDOWN_MS) return { do: 'none', why: 'dispatched a moment ago' };
  return { do: 'dispatch', pr: prs[0] };
}
const H = (token) => ({ authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' });
export async function activeLandRuns({ repo, token, f = fetch }) {
  let n = 0;
  for (const st of ['queued', 'in_progress']) {
    const r = await f(`https://api.github.com/repos/${repo}/actions/workflows/land.yml/runs?status=${st}&per_page=20`, { headers: H(token) });
    if (!r.ok) throw new Error(`land runs -> ${r.status}`);
    n += ((await r.json()).workflow_runs || []).length;
  }
  return n;
}
export async function dispatchLand({ repo, token, pr, f = fetch }) {
  let ref = 'main';
  try { const i = await f(`https://api.github.com/repos/${repo}`, { headers: H(token) }); if (i.ok) ref = (await i.json()).default_branch || 'main'; } catch { /* keep main */ }
  const r = await f(`https://api.github.com/repos/${repo}/actions/workflows/land.yml/dispatches`, { method: 'POST', headers: H(token), body: JSON.stringify({ ref, inputs: { pr: String(pr) } }) });
  if (r.status === 404) throw new Error(`land.yml is not published on the mirror's ${ref} branch (dispatch -> 404): run node tools/infra/mirror.mjs publish-workflows`);
  if (!r.ok) throw new Error(`land dispatch -> ${r.status}`);
}
