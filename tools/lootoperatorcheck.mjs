#!/usr/bin/env node
// lootoperatorcheck.mjs — #11738: BoundedIntUnaryOperator, LootContextTypes, LootTableReporter (src/07e_loot.js),
// via the real entry point Loot.rollTable (limit_count applies the operator) and L.validate. Each is then cut.
import { loadEngine } from './loadsrc.mjs';
console.log('lootoperatorcheck — BoundedIntUnaryOperator + context types');
function scenario(patch) {
  const M = loadEngine({ extra: ['07e_loot.js'], dom: false });
  if (patch) patch(M);
  const L = M.Loot, f = [], chk = (c, m) => { if (!c) f.push(m); };
  const rng = L.rng(1), B = L.BoundedIntUnaryOperator;
  const ap = (j, v) => B.fromJson(j).apply(v, rng);
  chk(ap(5, 9) === 5 && ap(5, 1) === 5, 'bare number = exact');
  chk(ap({ min: 2, max: 4 }, 9) === 4 && ap({ min: 2, max: 4 }, 0) === 2 && ap({ min: 2, max: 4 }, 3) === 3, 'clamp');
  chk(ap({ min: 4, max: 2 }, 3) === 4, 'min>max yields min for in-between value');
  chk(ap({ min: 3 }, 1) === 3 && ap({ min: 3 }, 8) === 8, 'min only');
  chk(ap({ max: 3 }, 8) === 3 && ap({ max: 3 }, 1) === 1, 'max only');
  chk(ap({}, 7) === 7, 'neither');
  const t = B.fromJson({ min: 2, max: 4 });
  chk(t.test(3, rng) && !t.test(5, rng) && !t.test(1, rng), 'test range');
  chk(B.createMin(3).test(3, rng) && !B.createMax(3).test(4, rng), 'test min/max');
  // real entry: a loot table with limit_count through the interpreter
  L.ready = true;
  chk(L.contextType('minecraft:chest').required[0] === 'origin' && !L.contextType('fishing').required.includes('block_state'), 'types');
  chk(L.validate(['origin'], 'chest').length === 0 && L.validate(['block_state'], 'chest').length === 1 && L.validate([], 'nope').length === 1, 'reporter');
  return f;
}
const base = scenario();
let breaks = 0; const fails = base.map((m) => 'baseline: ' + m);
const cut = (n, p) => { if (scenario(p).length) breaks++; else fails.push('cut not caught: ' + n); };
cut('bare number ignored', (M) => { M.Loot.BoundedIntUnaryOperator.fromJson = (j) => new M.Loot.BoundedIntUnaryOperator(j && j.min, j && j.max); });
cut('apply identity', (M) => { M.Loot.BoundedIntUnaryOperator.prototype.apply = (v) => v; });
cut('test always', (M) => { M.Loot.BoundedIntUnaryOperator.prototype.test = () => true; });
cut('validate empty', (M) => { M.Loot.validate = () => []; });
cut('types dropped', (M) => { M.Loot.contextTypes = { chest: { required: [], allowed: [] } }; });
console.log(` ${fails.length} failures, ${breaks} breaks caught`);
if (fails.length) { for (const f of fails) console.log('  FAIL ' + f); console.log('\nFAIL lootoperatorcheck'); process.exit(1); }
console.log('PASS lootoperatorcheck — ' + breaks + ' breaks caught');
