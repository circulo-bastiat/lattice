#!/usr/bin/env node
// lootconditioncheck.mjs — #11739: weather_check, value_check, reference, entity_scores conditions (src/07e_loot.js),
// through the real entry Loot.testPredicate. Each is then cut.
import { loadEngine } from './loadsrc.mjs';
console.log('lootconditioncheck — loot conditions');
function scenario(patch) {
  const M = loadEngine({ extra: ['07e_loot.js', '07zzo2_scoreboard.js'], dom: false });
  if (patch) patch(M);
  const L = M.Loot, f = [], chk = (c, m) => { if (!c) f.push(m); };
  L.clearPredicates();
  const t = (j, ctx) => L.testPredicate('t', ctx || {}) , reg = (id, j) => L.registerPredicate(id, j);
  reg('t', { condition: 'weather_check', raining: true });
  chk(t('t', { isRaining: () => true, isThundering: () => false }) && !L.testPredicate('t', { isRaining: () => false }), 'raining');
  reg('t', { condition: 'weather_check', thundering: false });
  chk(L.testPredicate('t', { isRaining: () => true, isThundering: () => false }) && !L.testPredicate('t', { isThundering: () => true }), 'thundering');
  reg('t', { condition: 'value_check', value: 5, range: { min: 3, max: 6 } });
  chk(L.testPredicate('t', {}), 'value in range');
  reg('t', { condition: 'value_check', value: 9, range: { min: 3, max: 6 } });
  chk(!L.testPredicate('t', {}), 'value out of range');
  reg('a', { condition: 'weather_check', raining: true });
  reg('t', { condition: 'reference', name: 'a' });
  chk(L.testPredicate('t', { isRaining: () => true }) && !L.testPredicate('t', { isRaining: () => false }), 'reference');
  reg('x', { condition: 'reference', name: 'y' }); reg('y', { condition: 'reference', name: 'x' });
  chk(!L.testPredicate('x', {}), 'recursive reference fails');
  chk(!L.testPredicate('missing', {}), 'unknown');
  reg('t', { condition: 'reference', name: 'nope' });
  chk(!L.testPredicate('t', {}), 'unknown reference');
  const SB = M.Scoreboard;
  if (SB) {
    SB.reset(); const o = { name: 'k' }; SB.objectives.k = o; SB.scores.k = { bob: 4 };
    reg('t', { condition: 'entity_scores', entity: 'this', scores: { k: { min: 3, max: 5 } } });
    chk(L.testPredicate('t', { name: 'bob', noEntity: false }), 'score in range');
    chk(!L.testPredicate('t', { name: 'amy' }), 'no score');
    reg('t', { condition: 'entity_scores', entity: 'this', scores: { k: 9 } });
    chk(!L.testPredicate('t', { name: 'bob' }), 'score out of range');
  } else f.push('no scoreboard');
  return f;
}
const base = scenario();
let breaks = 0; const fails = base.map((m) => 'baseline: ' + m);
const cut = (n, p) => { if (scenario(p).length) breaks++; else fails.push('cut not caught: ' + n); };
cut('predicates cleared', (M) => { M.Loot.registerPredicate = () => {}; });
cut('testPredicate true', (M) => { M.Loot.testPredicate = () => true; });
cut('testPredicate false', (M) => { M.Loot.testPredicate = () => false; });
cut('scoreboard gone', (M) => { M.Scoreboard = undefined; });
cut('operator test true', (M) => { M.Loot.BoundedIntUnaryOperator.prototype.test = () => true; });
console.log(` ${fails.length} failures, ${breaks} breaks caught`);
if (fails.length) { for (const f of fails) console.log('  FAIL ' + f); console.log('\nFAIL lootconditioncheck'); process.exit(1); }
console.log('PASS lootconditioncheck — ' + breaks + ' breaks caught');
