// #10420: the full suite and the lockstep pilot farm with NO machine of Dan's. Their private workflows (full-suite.yml's full-pc job and pilot-farm.yml) run on a PC / VM
// runner; hosted, the same work is the PUBLIC mirror's full-run.yml / farm-run.yml (private checkout by PAT, silent). The brain's health pass reads and dispatches them
// through `makeGhw`, a gh() that rewrites only these two workflow names to the mirror's and leaves every other call alone.
import { hostedBrain } from './roledispatch.mjs';
export const WF_MAP = { 'full-suite.yml': 'full-run.yml', 'pilot-farm.yml': 'farm-run.yml' };

export function makeGhw(gh, env = process.env, f = fetch) {
  return async function ghw(method, path, body, opts) {
    const m = /^\/repos\/\{repo\}\/actions\/workflows\/(full-suite\.yml|pilot-farm\.yml)(.*)$/.exec(path || '');
    if (!m || !hostedBrain(env)) return gh(method, path, body, opts);
    if (!env.MIRROR_REPO || !env.MIRROR_TOKEN) throw new Error('no mirror credentials');
    const H = { authorization: `Bearer ${env.MIRROR_TOKEN}`, accept: 'application/vnd.github+json' }, base = `https://api.github.com/repos/${env.MIRROR_REPO}`;
    let ref = 'main';
    try { const i = await f(base, { headers: H }); if (i.ok) ref = (await i.json()).default_branch || 'main'; } catch { /* keep main */ }
    const url = `${base}/actions/workflows/${WF_MAP[m[1]]}${m[2]}`;
    if (method === 'POST') {
      const r = await f(url, { method: 'POST', headers: H, body: JSON.stringify({ ...(body || {}), ref }) });
      if (r.status === 404) throw new Error(`${WF_MAP[m[1]]} is not published on the mirror's ${ref} branch (dispatch -> 404): run node tools/infra/mirror.mjs publish-workflows`);
      if (!r.ok) throw new Error(`${WF_MAP[m[1]]} dispatch -> ${r.status}`);
      return {};
    }
    const r = await f(url, { headers: H });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`${WF_MAP[m[1]]} read -> ${r.status}`);
    return r.json();
  };
}
