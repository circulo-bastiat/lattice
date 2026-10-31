// tools/handoffstuckcheck.mjs - #4998 (Dan, 10 Oct): (1) claim() skips + blocks a RED issue whose hand-offs all say "already passes, no code change"
// (the real #2059 text below); (2) brain.yml heals a stale runner workspace BEFORE actions/checkout in both jobs. Anti-vacuity below.
import { readFileSync } from 'node:fs';
import { stuckByHandoffs, blockedByHandoffs } from './infra/handoffstuck.mjs';
const rd = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const SRC = { go: rd('./go.mjs'), yml: rd('../.github/workflows/brain.yml'), stuck: rd('./infra/handoffstuck.mjs') };
const H = (t) => ({ body: `**Hand-off** (2026-10-10T18:25Z)\n\n${t}\n\n**Try:** build ok` });
const STUCK = [H('#2059: mountcheck passes on current tree; no code change needed'), { body: 'a human comment' }, H('#2059: mountcheck passes on current tree, merged with master; no code change needed'), H('#2059: mountcheck passes on current tree (239 assertions); no code change needed')];
const REAL = [H('#12: fixed the hitbox, pushed'), H('#12: still red on the second case, continuing'), H('#12: wired the check'), H('#12: mountcheck passes on current tree')];
const PL = { body: '**Partly landed** by #9 (the issue stays open). owed: the rest' };
const seq = (s) => s.split(' ').map((k) => (k === 'H' ? H('#1: slice') : PL));
const verdict = (S, stuck = stuckByHandoffs, blocked = blockedByHandoffs) => {
  const bad = [];
  if (blocked(seq('H H H')) !== true) bad.push('[H,H,H] is not blocked');
  if (blocked(seq('H PL H H')) !== false) bad.push('[H,PL,H,H] is blocked');
  if (blocked(seq('H H PL H H H')) !== true) bad.push('[H,H,PL,H,H,H] is not blocked');
  if (blocked([H('a'), H('b'), { body: '<!-- outcome:landed -->\nlanded' }, H('c')]) !== false) bad.push('an outcome:landed comment does not reset the count');
  if (!/if \(blockedByHandoffs\(cs\)\) \{ await gh\('POST', `\/repos\/\{repo\}\/issues\/\$\{num\}\/labels`, \{ labels: \['blocked', 'handoff-blocked'\] \}\)/.test(S.go)) bad.push('done does not block through blockedByHandoffs');
  if (stuck(STUCK) !== true) bad.push('the #2059 hand-offs are not recognised as stuck');
  if (stuck(REAL) !== false) bad.push('an issue with real progress is called stuck');
  if (stuck([H('#4948: re-queued the PR without changing any code'), H('#4948: I re-queued PR #4948 for the lander without changing any code, so it may bounce again')]) !== true) bad.push('the #4948 wording (re-queued twice, no code) is not recognised');
  if (!/last = 3, need = 2/.test(S.stuck)) bad.push('handoffstuck.mjs does not count 2 of the last 3 hand-offs');
  if (stuck([H('#1: no code change needed')]) !== false) bad.push('one hand-off alone is called stuck');
  if (stuck([{ body: 'passes on current tree, no code change' }, { body: 'no code change' }, { body: 'already passes' }]) !== false) bad.push('plain comments count as hand-offs');
  if (!/import \{ stuckByHandoffs(, handoffVerdict)?(, blockedByHandoffs)? \} from '\.\/infra\/handoffstuck\.mjs'/.test(S.go)) bad.push('go.mjs does not import the helper');
  if (!/async function claim\(issue, inReview\) \{\s*\n\s*if \(!opt\('--issue'\) && issue\.labels\.some\(\(l\) => \/\^\(red-check\|needs-rebase\)\$\/\.test\(l\.name\)\)\)/.test(S.go)) bad.push('claim() does not test red-check/needs-rebase issues first (and never on --issue)');
  if (!/stuckByHandoffs\(cs\)\) \{ await gh\('POST', `\/repos\/\{repo\}\/issues\/\$\{issue\.number\}\/labels`, \{ labels: \['blocked'\] \}\)[\s\S]{0,200}return null;/.test(S.go)) bad.push('claim() does not label blocked and return null on a stuck issue');
  const parts = S.yml.split(/\n  (?=route:|run:)/).filter((x) => /^(route|run):/.test(x));
  if (parts.length !== 2) bad.push('brain.yml jobs route/run not found');
  for (const p of parts) {
    const h = p.indexOf('rm -f .git/index'), c = p.indexOf('actions/checkout@v4');
    if (!(h > 0 && c > h)) bad.push(`brain.yml ${p.slice(0, 5).replace(':', '')} job has no workspace heal before checkout`);
    if (h > 0 && !/git reset -q --hard HEAD[^\n]*\|\| true/.test(p)) bad.push(`brain.yml ${p.slice(0, 5).replace(':', '')} heal can fail the job`);
  }
  return bad;
};
const BREAKS = [
  ['helper needs 3 of 4 again', (S) => ({ ...S, stuck: S.stuck.replace('last = 3, need = 2', 'last = 4, need = 3') })],
  ['go.mjs drops the import', (S) => ({ ...S, go: S.go.replace("import { stuckByHandoffs, handoffVerdict, blockedByHandoffs } from './infra/handoffstuck.mjs';", '') })],
  ['claim never tests', (S) => ({ ...S, go: S.go.replace("if (!opt('--issue') && issue.labels.some", "if (false && issue.labels.some") })],
  ['claim tests on --issue too', (S) => ({ ...S, go: S.go.replace("if (!opt('--issue') && issue.labels.some", "if (issue.labels.some") })],
  ['claim forgets to return', (S) => ({ ...S, go: S.go.replace("labelled blocked, not claimed.`); return null; }", "labelled blocked, not claimed.`); }") })],
  ['claim forgets the label', (S) => ({ ...S, go: S.go.replace("{ labels: ['blocked'] }).catch(() => {}); console.log(`#${issue.number}: its", "{ labels: ['x'] }).catch(() => {}); console.log(`#${issue.number}: its") })],
  ['done blocks on the raw count', (S) => ({ ...S, go: S.go.replace('if (blockedByHandoffs(cs)) {', 'if (n >= 3) {') })],
  ['route heal removed', (S) => ({ ...S, yml: S.yml.replace('rm -f .git/index .git/index.lock;', 'true;') })],
  ['heal after checkout in run', (S) => { const a = S.yml.lastIndexOf('      - name: heal a stale runner workspace'); const blk = S.yml.slice(a, S.yml.indexOf('\n      - uses:', a) + 1); const y = S.yml.slice(0, a) + S.yml.slice(a + blk.length); const c = y.indexOf('actions/checkout@v4', a - 10); const e = y.indexOf('\n      - shell: bash', c); return { ...S, yml: y.slice(0, e + 1) + blk + y.slice(e + 1) }; }],
  ['heal can fail the job', (S) => ({ ...S, yml: S.yml.replace(/git reset -q --hard HEAD >\/dev\/null 2>&1 \|\| true/g, 'git reset -q --hard HEAD') })],
];
const real = verdict(SRC); let caught = 0;
for (const [n, mk] of BREAKS) { const m = mk(SRC); if (verdict(m).length) caught++; else console.log(' NOT CAUGHT:', n); }
if (!verdict(SRC, () => true).length) { console.log(' NOT CAUGHT: helper always true'); } else caught++;
const naive = (cs) => cs.filter((c) => c.body.startsWith('**Hand-off**')).length >= 3;   // the pre-#10355 rule
if (!verdict(SRC, stuckByHandoffs, naive).length) { console.log(' NOT CAUGHT: raw hand-off count'); } else caught++;
const total = BREAKS.length + 2;
for (const x of real) console.log(' FAIL:', x);
console.log(`handoffstuckcheck: ${caught} breaks caught (of ${total})`);
process.exit(real.length || caught < total ? 1 : 0);
