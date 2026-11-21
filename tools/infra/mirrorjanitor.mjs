// tools/infra/mirrorjanitor.mjs - #9709 (22 Oct): result branches a killed run left on the PUBLIC mirror (r/<id>.<i>, p/<id>, t/<id>, f/<id>) are
// deleted once they are older than 12 h (no job lives 6 h), at most `cap` per pass. planJanitor() is pure; runJanitor() does the calls.
export const PREFIXES = ['r/', 'p/', 't/', 'f/'], MAX_AGE_H = 12;
/** refs: [{name: 'r/abc.3', date: ISO}] -> names to delete (oldest first, at most cap). */
export function planJanitor(refs, now, cap = 60, maxAgeH = MAX_AGE_H) {
  return refs.filter((r) => PREFIXES.some((p) => r.name.startsWith(p)) && now - Date.parse(r.date) > maxAgeH * 3600e3)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date)).slice(0, cap).map((r) => r.name);
}
/** {repo, token, now, cap, fetchFn} -> {deleted, failed, seen} */
export async function runJanitor({ repo, token, now = Date.now(), cap = 60, fetchFn = fetch }) {
  const [owner, name] = String(repo).split('/'), H = { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/vnd.github+json' };
  const refs = [];
  for (const pre of PREFIXES) {
    let after = null;
    for (let page = 0; page < 30; page++) {
      const q = `query($o:String!,$n:String!,$p:String!,$a:String){repository(owner:$o,name:$n){refs(refPrefix:$p,first:100,after:$a){nodes{name target{... on Commit{committedDate}}} pageInfo{hasNextPage endCursor}}}}`;
      const r = await fetchFn('https://api.github.com/graphql', { method: 'POST', headers: H, body: JSON.stringify({ query: q, variables: { o: owner, n: name, p: 'refs/heads/' + pre, a: after } }) });
      const j = await r.json(), R = j && j.data && j.data.repository && j.data.repository.refs; if (!R) break;
      for (const x of R.nodes) refs.push({ name: pre + x.name, date: (x.target && x.target.committedDate) || new Date(now).toISOString() });
      if (!R.pageInfo.hasNextPage) break; after = R.pageInfo.endCursor;
    }
  }
  const del = planJanitor(refs, now, cap), out = { deleted: 0, failed: 0, seen: refs.length };
  for (const n of del) { const r = await fetchFn(`https://api.github.com/repos/${repo}/git/refs/heads/${n}`, { method: 'DELETE', headers: H }); if (r.status === 204 || r.status === 422 || r.status === 404) out.deleted++; else out.failed++; }
  return out;
}
