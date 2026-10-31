// relaypollcheck (#10420): the polled relay replays each claude/** branch exactly once per head. Then each rule is broken to prove the check fails.
const SRC = await import('./infra/relaypoll.mjs');
const A = 'a'.repeat(40), B = 'b'.repeat(40);
function verdict(M) {
  const bad = [];
  const p = M.plan([{ name: 'claude/x', sha: A }], {});
  if (p.length !== 1 || p[0].before !== M.ZERO || p[0].after !== A) bad.push('a new branch is not replayed from zero');
  if (M.plan([{ name: 'claude/x', sha: A }], { 'claude/x': A }).length) bad.push('an already relayed head is replayed');
  const q = M.plan([{ name: 'claude/x', sha: B }], { 'claude/x': A });
  if (q.length !== 1 || q[0].before !== A) bad.push('a moved head does not resume from the mark');
  if (M.plan([{ name: 'work/1-x', sha: A }], {}).length) bad.push('a non-claude branch is relayed');
  if (M.plan(null, null).length) bad.push('null input');
  return bad;
}
import fs from 'node:fs';
const wf = (t) => /^  relay:\n    if: vars\.BRAIN_RUNNER != 'mirror'/m.test(t);
const WF = fs.readFileSync('.github/workflows/relay.yml', 'utf8');
const w = (f) => ({ ...SRC, plan: f });
const breaks = [
  w(() => []), w((b) => b.map((x) => ({ branch: x.name, before: SRC.ZERO, after: x.sha }))),
  w((b, d) => SRC.plan(b, {}).map((x) => ({ ...x, before: d && d[x.branch] || SRC.ZERO }))),
  w((b, d) => (b || []).map((x) => ({ branch: x.name, before: (d || {})[x.name] || SRC.ZERO, after: x.sha }))),
  w((b, d) => SRC.plan((b || []).map((x) => ({ ...x, name: x.name.replace(/^work\//, 'claude/') })), d)),
  null,
];
let bad = verdict(SRC); if (!wf(WF)) bad.push('relay.yml still runs on the PC when BRAIN_RUNNER=mirror');
bad.forEach((b) => console.log('FAIL', b));
let caught = 0; breaks.forEach((B2, i) => { if (B2 === null) { if (!wf(WF.replace(/    if: vars\.BRAIN_RUNNER.*\n/, ''))) caught++; else console.log('NOT CAUGHT: relay gate'); return; } let v; try { v = verdict(B2); } catch { v = ["threw"]; } if (v.length) caught++; else console.log('NOT CAUGHT: break #' + (i + 1)); });
console.log(`relaypollcheck: ${bad.length} failed; ${caught} breaks caught (of ${breaks.length})`);
if (caught < breaks.length) bad = bad.concat('vacuous');
process.exit(bad.length ? 1 : 0);
