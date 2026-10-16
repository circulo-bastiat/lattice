// tools/infra/land.mjs <pr> - run by .github/workflows/land.yml on a self-hosted runner. Never by a session.
// Test-merge the PR onto master, build, core suite; green -> merge through the API pinned to the tested head sha;
// conflict or red -> back to the queue with the branch KEPT (label needs-rebase on the issue, comment says why).
import { updateLocalCopy } from './localcopy.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, symlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gh, ghAll, ROOT, findUnder, busIssue } from './gh.mjs';
import { withHostRetry } from './hostload.mjs';
import { mergeLists } from './listmerge.mjs';
import { orderQueue } from './queueorder.mjs';
import { pickBatch, mergeBatch, BATCH_DEFAULT } from './landbatch.mjs';
import { dirtyTracked } from './landtree.mjs';
import { syncGolden } from './golden.mjs';

const sh = (c, a, o = {}) => spawnSync(c, a, { cwd: ROOT, encoding: 'utf8', ...o });
// #6767 (Dan, 13 Oct): TEST_REMOTE=mirror runs the core + anti-vacuity suites on free hosted runners in the public test mirror
// (tools/infra/mirror.mjs pushes a scrubbed snapshot of this merged tree and returns its output); build + merge stay here.
const REMOTE = process.env.MCLITE_TEST_REMOTE === 'mirror';
const suite = (args, o = {}) => REMOTE
  ? sh('node', ['tools/infra/mirror.mjs', 'run', '--', ...args], { maxBuffer: 1 << 26, timeout: 95 * 60e3 })
  : sh('node', ['tools/suite.mjs', ...args], { maxBuffer: 1 << 26, env: { ...process.env, MCLITE_PRESET: 'medium' }, ...o });
// actions/checkout already stored the job's credentials for github.com; adding our own header makes GitHub
// reject the request ("Duplicate header: Authorization"), and an error message would print it.
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
// GitHub's concurrency group keeps only the NEWEST pending run and cancels the others, so a lander run never lands
// "its" PR only: it drains EVERY open PR labelled `land`, oldest first. Any surviving run empties the whole queue.
import { setPriority, constants as OS } from 'node:os';
import { logEvidence } from './browserslots.mjs';
import { sweep as rebaseSweep } from './autorebase.mjs';
import { guard, APPROVAL } from './verifierguard.mjs';
try { setPriority(0, OS.priority.PRIORITY_BELOW_NORMAL); } catch { /* #3921: not permitted: run as before */ }
logEvidence('lander start', ROOT);
try { const w = syncGolden(ROOT); if (w.length) console.log(`golden: ${w.length} referee golden file(s) copied from the store branch (${w.slice(0, 6).join(', ')}${w.length > 6 ? ' ...' : ''})`); } catch (e) { console.log('golden sync failed (refchecks may SKIP):', String(e.message).slice(0, 160)); }   // #6524
const HOSTED = process.env.MCLITE_HOSTED === '1';   // a GitHub-hosted runner (Dan, 6 Oct): no PC folders, no Projects copy here
const DATA = process.env.MCLITE_DATA;   // data folders: this machine's synced Projects\mclite (set at SETUP-PC time)
for (const d of ['jars', '.mcdata', '.mcsnd', '.chromium', '.decomp'])   // never assets/: it is generated per checkout (D-6)
  if (DATA && existsSync(join(DATA, d)) && !existsSync(join(ROOT, d))) symlinkSync(join(DATA, d), join(ROOT, d), 'junction');
git('config', 'user.name', 'MC-Lite lander'); git('config', 'user.email', 'lander@mclite.invalid');

// What a bounce comment shows: the RED rows and each failed stage's own output, never the raw tail (28 Sept: the tail
// was the suite's skip list, so three bounces said nothing about which check was red).
export function reds(out) {
  const keep = []; const seen = new Set(); let block = 0;
  for (const l of (out || '').split('\n')) {
    if (/^ [✓✗·] \S+\s+\d+ ms/.test(l) || /^(skipped|===)/.test(l)) block = 0;   // a stage's block ends at the next row
    if (/^ ✗ /.test(l) && !seen.has(l)) { seen.add(l); keep.push(l); }
    if (/^──── .* FAILED ────/.test(l)) { block = 26; keep.push(''); }
    if (block) { keep.push(l); block--; }
  }
  return keep.length ? keep.join('\n').slice(0, 3500) : out;
}

// #5760: the single path and the batch path share these.
const BATCH = Number(process.env.MCLITE_LAND_BATCH ?? BATCH_DEFAULT);   // PRs tested together; 0 or 1 = the old one-at-a-time lander
let batchOff = 0;   // single-PR rounds still to run after a red batch (finds the culprit exactly as before)
const pendingAfter = [];   // the async bookkeeping of landed PRs; awaited before the auto-rebase sweep and before the run ends

const bounceOne = async (n, issue, why, detail) => {
  await gh('POST', `/repos/{repo}/issues/${n}/comments`, { body: `**Lander:** ${why}\n\n\`\`\`\n${(detail || '').slice(-3500)}\n\`\`\`` });
  await gh('DELETE', `/repos/{repo}/issues/${n}/labels/land`).catch(() => {});
  if (issue) await gh('POST', `/repos/{repo}/issues/${issue}/labels`, { labels: ['needs-rebase'] });
  console.log('BOUNCED', n, why); return 'bounced';
};

// ANTI-VACUITY, enforced here instead of trusted to the session (D-30): every check the given PRs ADD must break its own
// data and report it caught ("<n> breaks caught", n > 0), or the lander will not merge it. null = fine, else {why, out}.
function antiVacuity(ranges) {
  const added = ranges.flatMap((r) => git('diff', '--name-only', '--diff-filter=A', r, '--', 'tools/stages.d/').split('\n').filter(Boolean));
  const ids = added.flatMap((f) => { try { return JSON.parse(readFileSync(join(ROOT, f), 'utf8')).map((e) => e.id); } catch { return []; } });
  if (!ids.length) return null;
  const v = suite(['--fast', '--only', ids.join(',')]);
  const vacuous = ids.filter((id) => { const line = (v.stdout.match(new RegExp(`^.*\\s${id}\\s.*$`, 'm')) || [''])[0];
    return !/[1-9]\d*\s+(deliberate\s+)?breaks?\s+caught/i.test(line) && !/·/.test(line.slice(0, 3)); });
  return vacuous.length ? { why: `anti-vacuity: ${vacuous.join(', ')} never shows it can fail - a new check must break its own data and report "<n> breaks caught" (D-30).`, out: v.stdout.slice(-2500), ids: vacuous } : null;
}

// the push: the API merge pinned to the tested head sha. Returns null when merged, else the error.
async function apiMerge(n, pr) {
  const merge = () => gh('PUT', `/repos/{repo}/pulls/${n}/merge`, { merge_method: 'merge', sha: pr.head.sha, commit_title: `land #${n}: ${pr.title}` });
  try { await merge(); return null; }
  catch (e) {
    // #94: the workflow's own token may not write .github/workflows/* (28 Sept: PR #93 was tested green, then refused
    // with "without `workflows` permission"). Retry once as Dan's PAT (Projects/_secrets), which may.
    const f = /workflows?`? permission/i.test(e.message) ? findUnder(join('_secrets', 'github-token.txt')) : null;
    let e2 = e;
    if (f) {
      const old = process.env.GH_TOKEN;
      process.env.GH_TOKEN = readFileSync(f, 'utf8').trim();
      try { await merge(); e2 = null; console.log(`merged #${n} as the PAT (it changes a workflow file)`); } catch (x) { e2 = x; }
      if (old === undefined) delete process.env.GH_TOKEN; else process.env.GH_TOKEN = old;
    }
    return e2;
  }
}

// the bookkeeping after a merge: nothing here can fail a landing, and the batch path runs it in the background (pendingAfter)
async function afterMerge(n, pr, issue) {
  if (issue) await gh('DELETE', `/repos/{repo}/issues/${issue}/labels/needs-rebase`).catch(() => {});
  // GitHub's "Closes #N" keyword in the PR body does NOT auto-close the issue when the merge happens through this
  // API token/proxy (verified: #56 and #58 both stayed open after their landing PRs merged with "Closes #N" bodies,
  // which is why they kept resurfacing in the queue as "already done" loops) - close it explicitly, every time.
  const part = (pr.body || '').includes('<!-- mclite:part -->');   // #4646: `done --part`: tested work lands, the issue stays open and unblocked
  if (issue && part) {
    const owed = ((pr.body || '').match(/\*\*Owed[^\n]*/) || ['(see the PR)'])[0];
    await gh('POST', `/repos/{repo}/issues/${issue}/comments`, { body: `**Partly landed** by #${n} (the issue stays open). ${owed}` }).catch(() => {});
    await gh('DELETE', `/repos/{repo}/issues/${issue}/labels/blocked`).catch(() => {});
  } else if (issue) await gh('PATCH', `/repos/{repo}/issues/${issue}`, { state: 'closed', state_reason: 'completed' }).catch((e) => console.log('issue close failed', e.message));
  await gh('DELETE', `/repos/{repo}/git/refs/heads/${pr.head.ref}`).catch(() => {});
  console.log('LANDED', n);
}

async function landOne(n) {
  const pr = await gh('GET', `/repos/{repo}/pulls/${n}`);
  if (pr.state !== 'open' || !pr.labels.some((l) => l.name === 'land')) return 'skipped';
  const issue = (pr.head.ref.match(/^work\/(\d+)-/) || [])[1];
  if (issue && (await gh('GET', `/repos/{repo}/issues/${issue}`)).state === 'closed') {   // closed as obsolete meanwhile
    await gh('POST', `/repos/{repo}/issues/${n}/comments`, { body: `**Lander:** issue #${issue} was closed while this was in progress, so this is not landed. Reopen the issue to land it.` });
    await gh('PATCH', `/repos/{repo}/pulls/${n}`, { state: 'closed' });
    console.log('REFUSED', n, 'issue closed'); return 'refused';
  }
  const bounce = (why, detail) => bounceOne(n, issue, why, detail);
  git('fetch', '-q', 'origin', '+refs/heads/master:refs/remotes/origin/master', `+pull/${n}/head:pr`);   // explicit: never a stale master
  git('reset', '-q', '--hard', 'origin/master');
  // #4972: a tree that is dirty right after `reset --hard` is the LANDER's fault (10 Oct: CRLF blobs under eol=lf bounced every PR for 90 min).
  // Do not blame the PR: keep its `land` label, raise ONE severe issue, and let the next run retry.
  const dirty = dirtyTracked(sh('git', ['status', '--porcelain']).stdout);
  if (dirty.length) {
    const title = 'INFRA (severe): the lander tree is dirty right after reset --hard, so no PR can land';
    const body = `Seen while landing #${n}: \`git status\` after \`reset --hard origin/master\` lists ${dirty.length} tracked file(s): ${dirty.slice(0, 12).join(', ')}. Usually a CRLF blob under eol=lf (run \`node tools/eolcheck.mjs\`). The PR keeps its \`land\` label.`;
    const open = await gh('GET', '/repos/{repo}/issues?labels=lander-dirty&state=open&per_page=5').catch(() => []);
    if (open.length) await gh('POST', `/repos/{repo}/issues/${open[0].number}/comments`, { body }).catch(() => {});
    else await gh('POST', '/repos/{repo}/issues', { title, body, labels: ['lander-dirty', 'bug', 'severe', 'infra'] }).catch(() => {});
    console.log('LANDER TREE DIRTY', n, dirty.slice(0, 12).join(', ')); return 'skipped';
  }
  { // #7766: a PR that weakens the verifier's own files waits for a `**Commander` note
    const rd = (ref, f) => { const r = sh('git', ['show', `${ref}:${f}`]); return r.status ? null : r.stdout; };
    const files = git('diff', '--name-only', 'origin/master...pr').split('\n').filter(Boolean).map((path) => ({ path, before: rd('origin/master', path), after: rd('pr', path) }));
    const g = guard({ files, set: JSON.parse(readFileSync(join(ROOT, 'tools/protected.json'), 'utf8')) });
    if (g.holds.length && !(await ghAll(`/repos/{repo}/issues/${n}/comments`)).some((c) => APPROVAL.test(c.body || ''))) {
      await gh('POST', `/repos/{repo}/issues/${n}/labels`, { labels: ['verifier-change'] }).catch(() => {});
      await gh('DELETE', `/repos/{repo}/issues/${n}/labels/land`).catch(() => {});
      await gh('POST', `/repos/{repo}/issues/${n}/comments`, { body: `**Lander:** HELD for the commander (#7766, verifier-change). Rules hit:\n- ${g.holds.join('\n- ')}\nA comment starting \`**Commander\` approves it; re-label \`land\` after.` });
      console.log('HELD', n, g.holds.join('; ')); return 'held';
    }
  }
  const m = sh('git', ['merge', '--no-ff', '-q', '-m', `land #${n}`, 'pr']);
  if (m.status) {
    // #1612: conflicts ONLY in the shared ratchet lists are finished by a 3-way merge by key (tools/infra/listmerge.mjs);
    // the build and core suite below judge the result like any other merge
    const why = mergeLists(ROOT);
    if (why) { sh('git', ['merge', '--abort']); return bounce('conflicts with master; the next session rebases this branch (it is kept).', m.stdout + m.stderr + '\n(list auto-merge: ' + why + ')'); }
    console.log(`#${n}: the conflicts were only in the shared lists; merged them by key`);
  }
  // #1632: a red that carries a host-load signature (out of memory, never reached the game) is re-run before it bounces
  const retry = (run) => withHostRetry(run, { log: (m) => console.log(`#${n}: ${m}`) });
  const b = retry(() => sh('node', ['tools/suite.mjs', '--fast', '--to', 'build'], { maxBuffer: 1 << 26 }));   // generate assets/ + build
  if (b.status) return bounce('the build fails on master + this PR.', reds(b.stdout + b.stderr));
  const s = retry(() => suite(['--core']));
  if (s.status) return bounce('the core suite is red on master + this PR.', reds(s.stdout + s.stderr));
  // ANTI-VACUITY, enforced here instead of trusted to the session (D-30): every check this PR ADDS must break its own
  // data and report it caught ("<n> breaks caught", n > 0), or the lander will not merge it
  const av = antiVacuity(['origin/master...pr']);
  if (av) return bounce(av.why, av.out);
  const refused = await apiMerge(n, pr);
  if (refused) return bounce(`GitHub refused the merge (${refused.message}); the next session updates this branch from master (it is kept).`, '');   // never crash the queue
  await afterMerge(n, pr, issue); return 'landed';
}

// #5760: the merge train. ONE tester: the PRs merge onto master one after another, ONE build + core + anti-vacuity run judges the lot, then the
// pushes go out in order (each pinned to its tested head sha; the tested tree is what lands) and the bookkeeping runs in the background while the
// next batch is already building. Returns the number landed (>= 0, the round is done) or -1 (nothing batched: the single path takes this round).
// Any red or refusal pushes NOTHING further and backs off to single-PR rounds, which find the culprit exactly as before.
async function landBatch(nums) {
  const prs = [];
  for (const n of nums) {
    const pr = await gh('GET', `/repos/{repo}/pulls/${n}`);
    if (pr.state !== 'open' || !pr.labels.some((l) => l.name === 'land')) continue;
    const issue = (pr.head.ref.match(/^work\/(\d+)-/) || [])[1];
    if (issue && (await gh('GET', `/repos/{repo}/issues/${issue}`)).state === 'closed') continue;   // the single path refuses it, with its comment
    prs.push({ n, pr, issue, ref: `pr${n}` });
  }
  if (prs.length < 2) return -1;
  git('fetch', '-q', 'origin', '+refs/heads/master:refs/remotes/origin/master', ...prs.map((p) => `+pull/${p.n}/head:pr${p.n}`));
  git('reset', '-q', '--hard', 'origin/master');
  if (dirtyTracked(sh('git', ['status', '--porcelain']).stdout).length) return -1;   // the single path raises the lander-dirty issue
  const { members, excluded } = mergeBatch(sh, prs, () => mergeLists(ROOT));
  console.log(`batch of ${prs.length}: ${members.length} merged (${members.map((n) => '#' + n).join(' ')})` + (excluded.length ? `; left for the single path: ${excluded.map((n) => '#' + n).join(' ')}` : ''));
  if (members.length < 2) return -1;
  const retry = (run) => withHostRetry(run, { log: (m) => console.log(`batch: ${m}`) });
  const red = (what) => { batchOff = 3; console.log(`batch RED (${what}): nothing pushed, the next 3 rounds take one PR at a time`); return 0; };
  const b = retry(() => sh('node', ['tools/suite.mjs', '--fast', '--to', 'build'], { maxBuffer: 1 << 26 }));
  if (b.status) return red('build');
  const s = retry(() => suite(['--core']));
  if (s.status) return red('core');
  const av = antiVacuity(members.map((n) => `origin/master...pr${n}`));
  if (av) {   // #6428: bounce exactly the PRs that ADD a vacuous check and keep batching the rest (no batchOff: the culprit is gone, not unknown)
    const culprits = members.filter((n) => git('diff', '--name-only', '--diff-filter=A', `origin/master...pr${n}`, '--', 'tools/stages.d/').split('\n').filter(Boolean)
      .some((f) => { try { return JSON.parse(readFileSync(join(ROOT, f), 'utf8')).some((e) => av.ids.includes(e.id)); } catch { return false; } }));
    if (!culprits.length) return red('anti-vacuity');
    for (const n of culprits) { const p = prs.find((x) => x.n === n); await bounceOne(n, p.issue, av.why, av.out); }
    return 0;
  }
  let count = 0;
  for (const n of members) {
    const p = prs.find((x) => x.n === n);
    const err = await apiMerge(n, p.pr);
    if (err) { batchOff = 3; console.log(`batch: GitHub refused #${n} (${String(err.message).slice(0, 160)}); pushing stops here, the rest stay queued and the single path takes over`); break; }
    count++;
    pendingAfter.push(afterMerge(n, p.pr, p.issue).catch((e) => console.log('bookkeeping failed', n, String(e.message).slice(0, 120))));
  }
  return count;
}

let landed = 0;
const T0 = Date.now();   // land.yml kills a job at 60 min; stop at 45 and hand over (below) so a long queue is never cut mid-PR
for (let round = 0; round < 50 && Date.now() - T0 < 45 * 60e3; round++) {
  const queue = orderQueue(await gh('GET', '/repos/{repo}/issues?state=open&labels=land&sort=created&direction=asc&per_page=100'));   // #2632: `priority` PRs first
  if (!queue.length) break;
  const take = pickBatch(queue, BATCH, batchOff);   // #5760: the merge train; [] = the old one-at-a-time round
  if (take.length) {
    let k = -1;
    try { k = await landBatch(take); } catch (e) { console.log('batch path failed, the single path takes over:', String(e.message).slice(0, 200)); batchOff = 3; }
    if (k >= 0) { landed += k; continue; }
  }
  if (batchOff > 0) batchOff--;
  const r = await landOne(queue[0]);
  if (r === 'landed') landed++;
}
await Promise.all(pendingAfter);   // #5760: the background bookkeeping of the batches, before the sweep and the end of the run
// 30 Sept: a run stops after 50 rounds or 45 minutes; with no workers pushing, nothing else would start the next run and the rest of
// the queue sat. Still PRs labelled land -> this run dispatches the next lander run itself.
{ const left = (await gh('GET', '/repos/{repo}/issues?state=open&labels=land&per_page=1')).filter((i) => i.pull_request).length;
  if (left) await gh('POST', '/repos/{repo}/actions/workflows/land.yml/dispatches', { ref: 'master' }).then(() => console.log('queue not empty (50 rounds / 45 min): next lander run dispatched')).catch((e) => console.log('lander re-dispatch failed:', e.message)); }
// a merge made with the workflow's own token does not fire `push` workflows, so start the full suite explicitly
if (landed && !HOSTED && !REMOTE) await gh('POST', '/repos/{repo}/actions/workflows/full-suite.yml/dispatches', { ref: 'master' }).catch((e) => console.log('full-suite not dispatched:', e.message));   // hosted / TEST_REMOTE=mirror: the 2-hourly schedule runs the full suite (a run costs ~90-130 runner-minutes; #7698: a dispatch per landing ran it 15x in 8 h)
if (landed && HOSTED) await gh('POST', '/repos/{repo}/actions/workflows/localcopy.yml/dispatches', { ref: 'master' }).catch((e) => console.log('localcopy not dispatched:', e.message));   // the PC copy updates on the PC
else if (landed) { try { updateLocalCopy(DATA); } catch (e) { console.log('Projects copy not updated:', e.message); } }   // #1684: do not wait for a full suite that every landing cancels
// #4976 (10 Oct: 90 min of bounces waited on the brain VM's 15-min health pass, which was itself down): the lander re-queues the PRs it just
// bounced for a conflict that GitHub says is clean, itself, on this machine, right now. Labelling `land` fires land.yml again, so the loop closes
// with no other component. The second pass is for GitHub's lazy `mergeable` (null until the first read computed it).
try {
  const post = (to, text) => busIssue().then((b) => gh('POST', `/repos/{repo}/issues/${b}/comments`, { body: `to: ${to}\nfrom: lander\n\n${text}` }));
  for (let pass = 0; pass < 2; pass++) {
    const r = await rebaseSweep({ gh, ghAll, post });
    for (const a of r.acts) console.log('auto-rebase:', a);
    for (const e of r.errors) console.log('auto-rebase error:', e);
    if (pass === 0) await new Promise((res) => setTimeout(res, 20e3));
  }
} catch (e) { console.log('auto-rebase sweep failed:', String(e.message).slice(0, 200)); }
console.log(`queue drained: ${landed} landed`);
// a hosted run leaves no PC log file (sessions cannot download job logs): one bus line is the record
if (HOSTED && landed) await gh('POST', `/repos/{repo}/issues/${await busIssue()}/comments`, { body: `to: log\nfrom: lander\n\nlander (hosted, ${Math.round((Date.now() - T0) / 60000)} min): ${landed} landed` }).catch(() => {});
logEvidence('lander end', ROOT);
