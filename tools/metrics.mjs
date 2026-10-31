// tools/metrics.mjs - #7771: bus -> _status/metrics.json (append-only, keyed by run id) + _status/metrics.html.  `metrics.mjs [--print]`
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { gh, ghAll, busIssue } from './infra/gh.mjs';
import { parseRun, merge, summarize, html } from './infra/metrics.mjs';
const F = '_status/metrics.json';
export const load = () => existsSync(F) ? JSON.parse(readFileSync(F, 'utf8')) : { runs: [], snaps: [] };
export async function refresh() {
  let store = load(); const now = Date.now();
  const cs = await ghAll(`/repos/{repo}/issues/${await busIssue()}/comments?since=${new Date(now - 8 * 864e5).toISOString()}`);
  store = merge(store, cs.map(parseRun));
  const q = await ghAll('/repos/{repo}/issues?state=open&per_page=100').catch(() => []);
  store.snaps = [...(store.snaps || []), { at: new Date(now).toISOString(), open: q.filter((i) => !i.pull_request).length }].slice(-700);
  mkdirSync('_status', { recursive: true }); writeFileSync(F, JSON.stringify(store));
  writeFileSync('_status/metrics.html', html(store, now, store.snaps.at(-1)));
  return store;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const s = await refresh(), d = summarize(s, Date.now(), 864e5); delete d.perIssueUsd; console.log(JSON.stringify(d));
}
