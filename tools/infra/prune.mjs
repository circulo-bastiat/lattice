#!/usr/bin/env node
// tools/infra/prune.mjs - dead branches go by themselves (#125 cleaning; Dan: never by a session's discipline).
// Run by the brain's health pass at most once a day (tools/brain/brain.mjs), or by hand:
//   node tools/infra/prune.mjs [--dry]
// The decision is pruneVerdict() (pure, tested by prunecheck.mjs). A branch with an OPEN PR is never touched.
import { pathToFileURL } from 'node:url';
import { gh, ghAll } from './gh.mjs';

const H = 3600e3;
const KEEP = /^(master|main|phone-latest|gh-pages)$/;
/** b = {name, date (ms of its tip commit), msg (tip commit subject), openPR, mergedPR, issueClosed (bool|null)} */
export function pruneVerdict(b, now) {
  const age = now - b.date;
  if (KEEP.test(b.name) || b.openPR) return null;
  if (b.mergedPR) return 'its PR merged';
  if (/^(wip\/)?work\/\d+-/.test(b.name) && b.issueClosed) return 'its issue is closed';
  if (/^work\//.test(b.name) && /^(handoff: released|takeover: )/.test(b.msg) && age > 24 * H) return 'released and untouched for 24 h';
  if (/^wip\/work\//.test(b.name) && age > 72 * H) return 'autosave untouched for 3 days';
  if (/^work\//.test(b.name) && /^land #/.test(b.msg) && age > 24 * H) return 'no commits of its own for 24 h';
  if (/^(claude\/|cloud\/|cloud-merged$|infra\/)/.test(b.name) && age > 48 * H) return 'session/one-off branch untouched for 2 days';
  if (/^rescue\//.test(b.name) && age > 7 * 24 * H) return 'rescue branch older than a week';
  return null;
}

export async function prune({ dry = false, now = Date.now(), log = console.log } = {}) {
  const [branches, open, closed] = await Promise.all([ghAll('/repos/{repo}/branches'),
    ghAll('/repos/{repo}/pulls?state=open'), ghAll('/repos/{repo}/pulls?state=closed&sort=updated&direction=desc')]);
  const openHeads = new Set(open.map((p) => p.head.ref));
  const merged = new Map(closed.filter((p) => p.merged_at).map((p) => [p.head.ref, p.head.sha]));
  const issueState = new Map(); let n = 0;
  for (const br of branches) {
    if (KEEP.test(br.name) || openHeads.has(br.name)) continue;
    const c = await gh('GET', `/repos/{repo}/commits/${br.commit.sha}`);
    const num = (br.name.match(/^(?:wip\/)?work\/(\d+)-/) || [])[1];
    if (num && !issueState.has(num)) issueState.set(num, (await gh('GET', `/repos/{repo}/issues/${num}`, null, { ok404: true }))?.state === 'closed');
    const b = { name: br.name, date: Date.parse(c.commit.committer.date), msg: c.commit.message.split('\n')[0],
      openPR: false, mergedPR: merged.get(br.name) === br.commit.sha, issueClosed: num ? issueState.get(num) : null };
    const why = pruneVerdict(b, now);
    if (!why) continue;
    n++; log(`${dry ? 'would delete' : 'delete'} ${br.name} - ${why}`);
    if (!dry) await gh('DELETE', `/repos/{repo}/git/refs/heads/${br.name.split('/').map(encodeURIComponent).join('/')}`, null, { ok404: true }).catch((e) => log(`  failed: ${e.message}`));
  }
  log(`prune: ${n} branch(es) ${dry ? 'would go' : 'deleted'} of ${branches.length}`);
  return n;
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) await prune({ dry: process.argv.includes('--dry') });
