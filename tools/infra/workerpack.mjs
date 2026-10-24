// workerpack.mjs - #8914 (OFF-THE-PC U3): with repo variable WORKER_RUNNER=mirror the brain fill packs its workers into hosted jobs on the
// lattice mirror (worker-pack.yml, up to PACK_MAX Claude workers per job) instead of one VM job per worker. WORKER_RUNNER=vm (default) = old path.
// Pure rules; workerpackcheck proves them. Secrets are never arguments: the job reads them from lattice secrets by account name.
export const PACK_MAX = 4;
export const runnerMode = (v) => (String(v || '').trim().toLowerCase() === 'mirror' ? 'mirror' : 'vm');
/** n workers -> pack sizes, each 1..max, as even as possible (7 -> 4,3 ; 5 -> 3,2), so no job is left with one lonely worker when it can be avoided. */
export function packSizes(n, max = PACK_MAX) {
  n = Math.max(0, Math.floor(n) || 0); max = Math.max(1, Math.floor(max) || 1);
  const jobs = Math.ceil(n / max), out = [];
  for (let i = 0; i < jobs; i++) out.push(Math.floor(n / jobs) + (i < n % jobs ? 1 : 0));
  return out;
}
/** Group claimed issue numbers (csv per job) into packs. Issues not yet claimed: pass a count with `count` and each worker claims its own. */
export function groupIssues(issues, max = PACK_MAX) {
  const a = [...new Set((issues || []).map(Number).filter((x) => Number.isInteger(x) && x > 0))];
  const out = []; let i = 0;
  for (const s of packSizes(a.length, max)) { out.push(a.slice(i, i + s)); i += s; }
  return out;
}
const ACCOUNT = /^[A-Za-z0-9_-]{1,32}$/;
/** workflow_dispatch body for one pack. Only issue numbers, a count and an account NAME - a secret-looking value throws. */
export function dispatchBody({ issues = [], count = 0, account = '', ref = 'main' }) {   // #8992: the mirror's default branch is main (there is no master there)
  const csv = issues.map(Number).filter((x) => Number.isInteger(x) && x > 0).join(',');
  const workers = csv ? csv.split(',').length : Math.max(1, Math.min(PACK_MAX, Math.floor(count) || 1));
  if (account && !ACCOUNT.test(account)) throw new Error('account must be a plain name');
  const inputs = { issues: csv, workers: String(workers) }; if (account) inputs.account = account;
  return { ref, inputs };
}
/** Jobs the fill dispatches for `n` workers: the plan the brain executes and mirrorcap counts (one hosted job per pack). */
export function plan({ n, issues = [], account = '', max = PACK_MAX }) {
  const groups = issues.length ? groupIssues(issues, max).map((g) => ({ issues: g })) : packSizes(n, max).map((c) => ({ count: c }));
  return groups.map((g) => dispatchBody({ ...g, account }));
}
/** Hosted jobs workers occupy (for mirrorcap): each pack is one job. */
export const jobsFor = (n, max = PACK_MAX) => packSizes(n, max).length;
/** Dispatch the packs on the mirror. The ref is the mirror's REAL default branch (read from the repo, `main` if unreadable), never a literal `master` (#8992: lattice has no
 *  master, GitHub answered 404 and the fill silently fell back to the VM). A 404 names the cause: worker-pack.yml is not published on that branch. */
export async function dispatchPacks({ repo, token, bodies, f = fetch }) {
  if (!repo || !token) throw new Error('no mirror credentials');
  const H = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' };
  let ref = 'main';
  try { const r = await f(`https://api.github.com/repos/${repo}`, { headers: H }); if (r.ok) ref = (await r.json()).default_branch || 'main'; } catch { /* keep main */ }
  for (const b of bodies) {
    const r = await f(`https://api.github.com/repos/${repo}/actions/workflows/worker-pack.yml/dispatches`, { method: 'POST', headers: H, body: JSON.stringify({ ...b, ref }) });
    if (r.status === 404) throw new Error(`worker-pack.yml is not published on the mirror's ${ref} branch (dispatch -> 404): run node tools/infra/mirror.mjs publish-workflows`);
    if (!r.ok) throw new Error(`worker-pack dispatch -> ${r.status}`);
  }
  return bodies.length;
}

/** #9324 (Dan, 21 Oct: "Move Max+Pro to mirror"): the opaque run-name tag of a reserve pool = its index in roles.json accounts (public logs never name an account). */
export const poolTag = (accounts, name) => { const i = (accounts || []).findIndex((a) => a.name === name); return i < 0 ? '' : 'p' + i; };
/** Workers each pool tag holds on the mirror now, from worker-pack run names `worker-pack <tag> x<n>` (queued + in progress). */
export function packCounts(runs) {
  const out = {};
  for (const r of runs || []) { const m = /^worker-pack (p\d+) x(\d+)$/.exec(r.display_title || r.name || ''); if (m) out[m[1]] = (out[m[1]] || 0) + Number(m[2]); }
  return out;
}
export async function mirrorPackRuns({ repo, token, f = fetch }) {
  if (!repo || !token) throw new Error('no mirror credentials');
  const H = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' }, runs = [];
  for (const st of ['queued', 'in_progress']) {
    const r = await f(`https://api.github.com/repos/${repo}/actions/workflows/worker-pack.yml/runs?status=${st}&per_page=100`, { headers: H });
    if (!r.ok) throw new Error(`worker-pack runs -> ${r.status}`);
    runs.push(...((await r.json()).workflow_runs || []));
  }
  return runs;
}
