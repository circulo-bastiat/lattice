// #10419: where a brain role run STARTS. The Hyper-V VM is gone (Dan, 27 Oct: "the entire project on github"), and the private repo has no hosted minutes,
// so with BRAIN_RUNNER=mirror every role start (commander, fixer, requests, reviewer, enlarger, tester, waker-less roles) is a workflow_dispatch of
// role-run.yml on the public mirror, driven by the mirror token. Without it (a VM brain) the dispatch is brain.yml on the private repo, as before.
// Inputs carry the mail text (`reason`); the mirror's logs are public, so role-run.yml never prints inputs (its run-name is only the role).
import { plan as packPlan, dispatchPacks } from './workerpack.mjs';
export const hostedBrain = (env = process.env) => env.BRAIN_RUNNER === 'mirror' || env.MCLITE_HOSTED === '1';

/** workflow_dispatch inputs of a PUBLIC repo are shown on the run page: a reason may carry only a bus comment id (`bus:<id>`, the job reads the text itself with the
 *  private token) or a short fixed phrase with no free text. Anything else (mail text, issue titles) is replaced. */
export const safeReason = (r) => (/^bus:\d+$/.test(r || '') || /^(fill|review #\d+|test slot \d+|ladder|health|started by)[A-Za-z0-9 #().:_,-]{0,60}$/.test(r || '')) ? r : 'hosted brain start';

/** The request {url, body} that starts `inp` ({role, reason, account}); pure, so the check can read it. */
export function roleStart(inp, { env = process.env, ref = 'master' } = {}) {
  const hosted = hostedBrain(env);
  const inputs = Object.fromEntries(Object.entries({ ...inp, ...(hosted && inp.reason !== undefined ? { reason: safeReason(inp.reason) } : {}) }).filter(([, v]) => v !== undefined && v !== ''));
  if (hostedBrain(env)) return { mirror: true, url: `https://api.github.com/repos/${env.MIRROR_REPO}/actions/workflows/role-run.yml/dispatches`, body: { ref: 'main', inputs } };
  return { mirror: false, url: '/repos/{repo}/actions/workflows/brain.yml/dispatches', body: { ref, inputs } };
}

/** Start a role run. `waker` has no Claude session and no hosted meaning (the tick IS the waker): it is a no-op when hosted. */
export async function startRole(inp, { env = process.env, ghImpl, f = fetch } = {}) {
  if (hostedBrain(env) && inp.role === 'waker') return { skipped: 'waker' };
  // a worker claims its own issue first (go.mjs start): on the mirror that is worker-pack.yml, never a bare role run
  if (hostedBrain(env) && inp.role === 'worker') return { packs: await dispatchPacks({ repo: env.MIRROR_REPO, token: env.MIRROR_TOKEN, bodies: packPlan({ n: 1, account: inp.account || '' }), f }) };
  const r = roleStart(inp, { env });
  if (!r.mirror) return ghImpl('POST', r.url, r.body);
  if (!env.MIRROR_REPO || !env.MIRROR_TOKEN) throw new Error('no mirror credentials');
  const H = { authorization: `Bearer ${env.MIRROR_TOKEN}`, accept: 'application/vnd.github+json' };
  let ref = 'main';
  try { const i = await f(`https://api.github.com/repos/${env.MIRROR_REPO}`, { headers: H }); if (i.ok) ref = (await i.json()).default_branch || 'main'; } catch { /* keep main */ }
  const res = await f(r.url, { method: 'POST', headers: H, body: JSON.stringify({ ...r.body, ref }) });
  if (res.status === 404) throw new Error(`role-run.yml is not published on the mirror's ${ref} branch (dispatch -> 404): run node tools/infra/mirror.mjs publish-workflows`);
  if (!res.ok) throw new Error(`role-run dispatch -> ${res.status}`);
  return { status: res.status };
}
