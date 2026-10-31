// lockstepplancheck (#9364 R1/R4): RUNS lockstepPlan on fixture trees: matching inputs -> credited without a pilot; one byte changed -> pilot required;
// doctored stored results (foreign inputs, no inputs, same:false) are refused. Prints '<n> breaks caught'.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { currentInputs, SHARED } from './referee/lockstep/inputs.mjs';
import { symlinkSync } from 'node:fs';
import { lockstepPlan, creditedStageIds } from './infra/lockstepplan.mjs';
let fails = 0, breaks = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL: ' + m); } };
const tree = (laneText = '// cow') => { const root = mkdtempSync(join(tmpdir(), 'lsp-'));
  const put = (f, t) => { mkdirSync(join(root, f, '..'), { recursive: true }); writeFileSync(join(root, f), t); };
  for (const f of SHARED) put(f, 'shared ' + f + '\n'); put('referee/lanes.d/cow.json', '{"cow":1}'); put('referee/lockstep/cowlane.mjs', laneText); return root; };
const store = (dir, lane, mk, n = 20) => { mkdirSync(dir, { recursive: true }); for (let s = 0; s < n; s++) writeFileSync(join(dir, `${lane}-${s}.json`), JSON.stringify({ lane, salt: s, same: true, ...mk(s) })); };
const A = tree(), out = mkdtempSync(join(tmpdir(), 'lspr-')), good = join(out, 'good');
store(good, 'cow', () => ({ inputs: currentInputs('cow', A) }));
const plan = (root, d, lane = 'cow') => lockstepPlan({ lanes: [lane], root, dirs: [d] });
const must = (c, m) => ok(c, m);
// each rule returns true when the plan behaves as required; a doctored case must flip it
const cases = [
  ['matching inputs are credited without a pilot', () => plan(A, good).credited.cow === 20 && !plan(A, good).needPilot.length, null],
  ['one byte changed -> a pilot is required for all 20 salts', () => { const p = plan(tree('// cow!'), good); return !p.credited.cow && p.needPilot[0].missing.length === 20; }, null],
  ['foreign inputs refused', () => { const d = join(out, 'f'); store(d, 'cow', () => ({ inputs: { x: 'y' } })); return !!plan(A, d).needPilot.length; }, null],
  ['no inputs refused', () => { const d = join(out, 'n'); store(d, 'cow', () => ({})); return !!plan(A, d).needPilot.length; }, null],
  ['a diverging (same:false) result is not credited', () => { const d = join(out, 'd'); store(d, 'cow', () => ({ inputs: currentInputs('cow', A), same: false })); return !!plan(A, d).needPilot.length; }, null],
  ['shard: creditedStageIds skips the credited lane stage only', () => { const W = mkdtempSync(join(tmpdir(), 'lspw-')); symlinkSync(A, join(W, 'tools')); const ids = ['lockstep-cow', 'other']; const g = creditedStageIds(ids, W, out); const w2 = mkdtempSync(join(tmpdir(), 'lspw-')); symlinkSync(tree('// cow!'), join(w2, 'tools')); return g.length === 1 && g[0] === 'lockstep-cow' && !creditedStageIds(ids, w2, out).length; }, null],
  ['19 of 20 salts -> pilot for the missing one only', () => { const d = join(out, 's'); store(d, 'cow', () => ({ inputs: currentInputs('cow', A) }), 19); const p = plan(A, d); return p.needPilot[0].missing.join() === '19'; }, null],
];
for (const [m, f] of cases) must(f(), m);
// anti-vacuity: a planner that credits everything / nothing must fail the cases
const sabotage = { 'credits everything': () => ({ credited: { cow: 20 }, needPilot: [] }), 'credits nothing': () => ({ credited: {}, needPilot: [{ lane: 'cow', missing: [0] }] }) };
for (const [name, fake] of Object.entries(sabotage)) {
  const real = plan; let bad = 0;
  for (const [m, f] of cases) { const body = f.toString(); const r = (() => { try { return new Function('plan', 'tree', 'store', 'out', 'good', 'A', 'currentInputs', 'join', 'return (' + body + ')()')(() => fake(), tree, store, out, good, A, currentInputs, join); } catch { return false; } })(); if (!r) bad++; }
  if (bad) { breaks++; } else { fails++; console.log('FAIL: planner that ' + name + ' passes every case'); }
}
rmSync(out, { recursive: true, force: true });
console.log(`lockstepplancheck: ${cases.length} cases, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
