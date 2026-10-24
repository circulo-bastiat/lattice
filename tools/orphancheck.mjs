// tools/orphancheck.mjs - #8977: a worker run that ends with no PR and no new code releases its claim at once. RUNS releaseOrphan against a fake GitHub
// (records every call) for four branches, and checks launch.mjs calls it on the not-produced path. Anti-vacuity below.
import { readFileSync } from 'node:fs';
const rd = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const SRC = { orphan: rd('./brain/orphan.mjs'), launch: rd('./brain/launch.mjs') };
const load = (src) => import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
// fake GitHub: branch -> { pr, msg }
const fake = (b) => { const calls = []; const gh = async (m, p, body) => { calls.push([m, p, body]);
  if (p === '/repos/{repo}') return { owner: { login: 'o' } };
  if (p.startsWith('/repos/{repo}/pulls')) return b.pr ? [{ number: 1 }] : [];
  if (p.startsWith('/repos/{repo}/git/ref/heads/')) return { object: { sha: 'S1' } };
  if (p === '/repos/{repo}/git/commits/S1') return { message: b.msg, tree: { sha: 'T1' } };
  if (m === 'POST' && p === '/repos/{repo}/git/commits') return { sha: 'S2' };
  if (m === 'PATCH') return {};
  throw new Error('unexpected ' + m + ' ' + p); }; return { gh, calls }; };
async function verdict(S) {
  const bad = []; let M; try { M = await load(S.orphan); } catch (e) { return [`orphan.mjs does not load: ${e.message}`]; }
  const run = async (b) => { const f = fake(b); const r = await M.releaseOrphan({ gh: f.gh, branch: 'work/9-x' }).catch((e) => ({ err: e.message })); return { r, calls: f.calls }; };
  const wrote = (c) => c.filter(([m]) => m === 'POST' || m === 'PATCH');
  const a = await run({ pr: false, msg: 'land #1: master commit' });
  const post = a.calls.find(([m, p]) => m === 'POST' && p.endsWith('/git/commits')), patch = a.calls.find(([m]) => m === 'PATCH');
  if (!a.r.released) bad.push('an orphan claim (no PR, tip is a plain commit) is not released');
  if (!post || !/^handoff: released/.test(post[2].message) || post[2].tree !== 'T1' || post[2].parents[0] !== 'S1') bad.push('the release is not an empty `handoff: released` commit on top of the head');
  if (!patch || patch[2].force !== false || patch[2].sha !== 'S2' || !patch[1].endsWith('heads/work/9-x')) bad.push('the release does not fast-forward the branch (force false)');
  const b = await run({ pr: true, msg: 'x' }); if (b.r.released || wrote(b.calls).length) bad.push('a branch with an open PR is released');
  const c = await run({ pr: false, msg: 'handoff: released (not finished)' }); if (c.r.released || wrote(c.calls).length) bad.push('an already released branch is released again');
  const d = await M.releaseOrphan({ gh: fake({}).gh, branch: '' }); if (d.released) bad.push('an empty branch name is released');
  if (!/import \{ releaseOrphan \} from '\.\/orphan\.mjs'/.test(S.launch)) bad.push('launch.mjs does not import orphan.mjs');
  if (!/if \(!produced && branch\) \{ try \{ await releaseOrphan\(\{ gh, branch \}\)/.test(S.launch)) bad.push('launch.mjs does not release the claim of a run that produced nothing');
  if (S.launch.indexOf('releaseOrphan({ gh, branch })') > S.launch.indexOf('const v = burnVerdict(')) bad.push('the release comes after the burn verdict (a blocked issue would keep its claim)');
  return bad;
}
const sub = (k, a, b) => (S) => { if (!S[k].includes(a)) throw new Error('break target missing: ' + a); return { ...S, [k]: S[k].replace(a, b) }; };
const BREAKS = [
  ['no PATCH', sub('orphan', "await gh('PATCH'", "await gh('GET'")],
  ['force push', sub('orphan', 'force: false', 'force: true')],
  ['PR ignored', sub('orphan', 'if ((prs || []).length)', 'if (false)')],
  ['released twice', sub('orphan', "if (/^handoff: released/.test(head.message || ''))", 'if (false)')],
  ['wrong tree', sub('orphan', 'tree: head.tree.sha', "tree: 'x'")],
  ['wrong parent', sub('orphan', 'parents: [sha]', 'parents: []')],
  ['message not a release', sub('orphan', "message: 'handoff: released (the run", "message: 'done (the run")],
  ['empty branch', sub('orphan', "if (!branch) return { released: false, why: 'no branch' };", '')],
  ['not imported', sub('launch', "import { releaseOrphan } from './orphan.mjs';", '')],
  ['not called', sub('launch', 'await releaseOrphan({ gh, branch })', 'await Promise.resolve({ gh, branch })')],
  ['released even when produced', sub('launch', 'if (!produced && branch) {', 'if (branch) {')],
];
const real = await verdict(SRC); let caught = 0;
for (const [n, mk] of BREAKS) { let m; try { m = mk(SRC); } catch (e) { console.log(' BAD BREAK:', n, e.message); continue; } if ((await verdict(m)).length) caught++; else console.log(' NOT CAUGHT:', n); }
for (const x of real) console.log(' FAIL:', x);
console.log(`orphancheck: ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
