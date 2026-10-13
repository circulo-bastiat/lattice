// tools/turnbudgetcheck.mjs - #5010 (Dan, 10 Oct): a worker run has a turn budget (hard stop 60, land the tested part by ~30 tool calls) and a VM worker
// never claims an issue labelled needs-java. Anti-vacuity below.
import { readFileSync } from 'node:fs';
const rd = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const SRC = { roles: rd('./brain/roles.json'), go: rd('./go.mjs') };
const verdict = (S) => {
  const bad = []; let C; try { C = JSON.parse(S.roles); } catch { return ['roles.json is not valid JSON']; }
  const w = C.roles.worker || {};
  if (!(w.maxTurns > 0 && w.maxTurns <= 60)) bad.push(`worker maxTurns is ${w.maxTurns} (must be <= 60)`);
  if (!/TURN BUDGET/.test(w.prompt || '')) bad.push('the worker prompt has no TURN BUDGET');
  if (!/about 30 tool calls/.test(w.prompt || '') || !/for the part that is tested/.test(w.prompt || '')) bad.push('the worker prompt does not tell it to land the tested part by ~30 tool calls');
  if (!/hard stop is turn 60/.test(w.prompt || '')) bad.push('the worker prompt does not name the hard stop');
  if (!/\(vm && \(lab\(i, 'needs-pc'\) \|\| lab\(i, 'pc-gpu'\) \|\| lab\(i, 'needs-java'\)\)\)/.test(S.go)) bad.push('a VM worker still claims needs-java issues');
  return bad;
};
const mut = (fn) => (S) => { const C = JSON.parse(S.roles); fn(C); return { ...S, roles: JSON.stringify(C) }; };
const BREAKS = [
  ['worker 150 turns', mut((C) => { C.roles.worker.maxTurns = 150; })],
  ['worker 61 turns', mut((C) => { C.roles.worker.maxTurns = 61; })],
  ['no turn budget text', mut((C) => { C.roles.worker.prompt = C.roles.worker.prompt.replace('TURN BUDGET', 'TURNS'); })],
  ['no 30-call rule', mut((C) => { C.roles.worker.prompt = C.roles.worker.prompt.replace('about 30 tool calls', 'a while'); })],
  ['no part landing', mut((C) => { C.roles.worker.prompt = C.roles.worker.prompt.replace('for the part that is tested', 'for it'); })],
  ['no hard stop named', mut((C) => { C.roles.worker.prompt = C.roles.worker.prompt.replace('hard stop is turn 60', 'hard stop exists'); })],
  ['needs-java claimable on the VM', (S) => ({ ...S, go: S.go.replace(" || lab(i, 'needs-java')", '') })],
  ['roles.json broken', (S) => ({ ...S, roles: '{' })],
];
const real = verdict(SRC); let caught = 0;
for (const [n, mk] of BREAKS) { if (verdict(mk(SRC)).length) caught++; else console.log(' NOT CAUGHT:', n); }
for (const x of real) console.log(' FAIL:', x);
console.log(`turnbudgetcheck: ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
