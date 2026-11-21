// autorebasecheck.mjs - #4589: bounced merge-conflict PRs re-queue themselves. Scenarios run on the real
// tools/infra/autorebase.mjs and on broken copies; each break must be caught ("<n> breaks caught").
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), 'infra', 'autorebase.mjs');
const src = readFileSync(SRC, 'utf8');
const NOW = Date.parse('2026-10-20T00:00:00Z'), OLD = '2026-10-01T00:00:00Z', FRESH = '2026-10-19T00:00:00Z';
const conflict = { body: '**Lander:** conflicts with master; the next session rebases this branch (it is kept).' };
const red = { body: '**Lander:** the core suite is red on master + this PR.' };
const mk = (o = {}) => ({ pr: { labels: [], mergeable: true, updated_at: FRESH, ...(o.pr || {}) }, issue: { state: 'open', labels: [], ...(o.issue || {}) }, comments: o.comments || [conflict], issueComments: o.issueComments || [], now: NOW });
const scenarios = async (M) => {
  const bad = [], d = (o) => M.decide(mk(o));
  if (d() !== 'requeue') bad.push('clean-merging conflict bounce not re-queued: ' + d());
  if (d({ pr: { mergeable: false } }) !== 'none') bad.push('a true conflict must be left to a worker');
  if (d({ pr: { mergeable: null } }) !== 'none') bad.push('mergeable=null (not computed yet) was re-queued');
  if (d({ pr: { labels: [{ name: 'land' }] } }) !== 'none') bad.push('an already-queued PR was touched');
  if (d({ comments: [red] }) !== 'none') bad.push('a red (non-conflict) bounce was re-queued');
  if (d({ comments: [] }) !== 'none') bad.push('a PR the lander never bounced was re-queued');
  if (d({ comments: [conflict, red] }) !== 'none') bad.push('only the LATEST lander verdict counts');
  if (d({ issue: { state: 'closed' }, pr: { updated_at: OLD } }) !== 'close') bad.push('stale PR with closed issue not closed');
  if (d({ issue: { state: 'closed' } }) === 'close') bad.push('a recently active PR was closed');
  if (d({ issue: { state: 'open' }, pr: { updated_at: OLD } }) === 'close') bad.push('an old PR with an OPEN issue was closed');
  if (d({ comments: [conflict, conflict] }) !== 'requeue') bad.push('second bounce should still re-queue');
  if (d({ comments: [conflict, conflict, conflict], pr: { mergeable: false } }) !== 'block') bad.push('third conflict bounce not blocked');
  const unblock = { body: '**Commander (14 Oct):** unblocked. Rebase onto master.' };
  if (d({ comments: [conflict, conflict, conflict, unblock], pr: { mergeable: false } }) !== 'none') bad.push('a commander unblock did not restart the bounce count (re-blocked at once)');
  if (d({ comments: [conflict, conflict, conflict, unblock, conflict], pr: { mergeable: true } }) !== 'requeue') bad.push('one bounce after an unblock must re-queue, not block');
  if (d({ comments: [conflict, unblock, conflict, conflict, conflict], pr: { mergeable: false } }) !== 'block') bad.push('three bounces AFTER an unblock must block again');
  const at = (t, c) => ({ ...c, created_at: t }), onIssue = [at('2026-10-14T18:45:00Z', unblock)];   // #7514: the unblock note lives on the ISSUE
  const old3 = [at('2026-10-13T10:00:00Z', conflict), at('2026-10-13T12:00:00Z', conflict), at('2026-10-13T18:00:00Z', conflict)];
  if (d({ comments: old3, issueComments: onIssue, pr: { mergeable: false } }) !== 'none') bad.push('an unblock note on the ISSUE did not restart the bounce count (re-blocked at once)');
  if (d({ comments: [...old3, at('2026-10-14T19:00:00Z', conflict)], issueComments: onIssue, pr: { mergeable: true } }) !== 'requeue') bad.push('one bounce after an issue-side unblock must re-queue, not block');
  if (d({ comments: [...old3, at('2026-10-14T19:00:00Z', conflict), at('2026-10-14T20:00:00Z', conflict), at('2026-10-14T21:00:00Z', conflict)], issueComments: onIssue, pr: { mergeable: false } }) !== 'block') bad.push('three bounces AFTER an issue-side unblock must block again');
  if (d({ comments: [conflict, conflict, conflict], issue: { labels: [{ name: 'blocked' }] } }) !== 'none') bad.push('an already blocked issue was blocked again');
  // sweep: the error path mails fixer + commander-facing errors and never throws or retries
  let calls = 0;
  const gh = async (m, p) => { calls++; if (/pulls\/7$/.test(p)) throw new Error('API down'); return m === 'GET' && /pulls\/8$/.test(p) ? { labels: [], mergeable: true, updated_at: FRESH } : m === 'GET' && /issues\/8$/.test(p) ? { state: 'open', labels: [] } : {}; };
  const ghAll = async (p) => p.includes('labels=needs-rebase') ? [{ number: 7 }, { number: 8 }] : p.includes('/pulls?') ? [{ number: 7, labels: [], head: { ref: 'work/7-x' } }, { number: 8, labels: [], head: { ref: 'work/8-y' } }] : [conflict];
  const r = await M.sweep({ gh, ghAll, post: async () => {}, now: NOW });
  if (r.errors.length !== 1 || !/#7/.test(r.errors[0])) bad.push('a failing PR was not reported as an error: ' + JSON.stringify(r));
  if (r.acts.join() !== '#8 requeue') bad.push('one PR failing stopped the others: ' + JSON.stringify(r));
  return bad;
};
const fails = (await scenarios(await import(pathToFileURL(SRC).href))).map((x) => 'real: ' + x);
const BREAKS = [
  ['pr is re-queued while a true conflict', "pr.mergeable === true ? 'requeue' : 'none'", "'requeue'"],
  ['mergeable null re-queued', "pr.mergeable === true ?", "pr.mergeable !== false ?"],
  ['red bounces re-queued', "!CONFLICT.test(lander[lander.length - 1].body)) return 'none'", "false) return 'none'"],
  ['never blocks', ">= MAX_BOUNCES) return", ">= 1e9) return"],
  ['blocks twice', "lab(issue, 'blocked') ? 'none' : 'block'", "'block'"],
  ['stale PRs never closed', "now - Date.parse(pr.updated_at) > STALE_MS", "false"],
  ['open issue PRs closed', "issue.state === 'closed' && now", "now"],
  ['land PRs touched', "if (lab(pr, 'land')) return 'none';", ''],
  ['an error aborts the sweep', "errors.push(`#${p.number}", "throw new Error(`#${p.number}"],
  ['bounce limit is 5', "MAX_BOUNCES = 3", "MAX_BOUNCES = 5"],
  ['unblock note on the issue ignored', '...comments, ...issueComments]', '...comments]'],
  ['unblock note never restarts the count', "const reset = comments.reduce((n, c, i) => (UNBLOCK.test(c.body || '') ? i : n), -1);", 'const reset = -1;'],
];
let caught = 0;
for (const [name, from, to] of BREAKS) {
  if (!src.includes(from)) { fails.push(`break "${name}": autorebase.mjs no longer contains ${from}`); continue; }
  const dir = mkdtempSync(join(tmpdir(), 'arc-')), f = join(dir, 'a.mjs');
  writeFileSync(f, src.split(from).join(to));
  let bad; try { bad = await scenarios(await import(pathToFileURL(f).href)); } catch { bad = ['threw']; }
  if (bad.length) { caught++; console.log(`  ✓ break caught: ${name}`); } else fails.push(`break NOT caught: ${name}`);
  rmSync(dir, { recursive: true, force: true });
}
console.log(`autorebasecheck: ${caught} breaks caught (of ${BREAKS.length})`);
for (const x of fails) console.log(`  ✗ ${x}`);
console.log(` assertions passed .... ${23 - fails.filter((x) => x.startsWith('real')).length}`);
process.exit(fails.length ? 1 : 0);
