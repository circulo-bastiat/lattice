#!/usr/bin/env node
// luckcheck.mjs - #5788: the luck attribute (Luck/Bad Luck effects) shifts loot-pool weights exactly as
// LootPoolEntry.getWeight(luck) = max(floor(weight + quality * luck), 0), through Loot.rollTable(ctx.luck).
// Exact, not statistical: the pool's weighted pick is enumerated over EVERY rng.nextInt(total) value.
// ANTI-VACUITY: luck ignored; luck applied to weight instead of quality - both must be caught.
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({ extra: ['07q_effects.js', '07e_loot.js'] });
const E = M.Effects, L = M.Loot;
const fails = []; let N = 0, caught = 0;
const ok = (c, m) => { N++; if (!c) fails.push(m); };
const BR = ['junk', 'treasure', 'fish'], NAMES = { 'gameplay/fishing/junk': 'junk', 'gameplay/fishing/treasure': 'treasure', 'gameplay/fishing/fish': 'fish' };
const top = L.table('gameplay/fishing');
// Turn the three sub-table entries into leaf items so each enumerated pick is directly classifiable.
const leaf = top.pools[0].entries.map((e) => ({ type: 'item', name: NAMES[e.name], weight: e.weight, quality: e.quality, conditions: e.conditions }));
const pickCounts = (luck, entries) => {
  const saved = top.pools[0].entries; top.pools[0].entries = entries;
  let total = -1; const counts = { junk: 0, treasure: 0, fish: 0 };
  const probe = { nextInt: (n) => { total = n; return 0; }, nextFloat: () => 0 };
  L.rollTable('gameplay/fishing', { rng: probe, luck, openWater: true });
  for (let v = 0; v < total; v++) {
    const r = L.rollTable('gameplay/fishing', { rng: { nextInt: () => v, nextFloat: () => 0 }, luck, openWater: true });
    counts[String(r[0].item).replace(/^minecraft:/, '')]++;
  }
  top.pools[0].entries = saved; return { total, counts };
};
const expectW = (luck, qOf) => leaf.map((e) => Math.max(Math.floor(e.weight + qOf(e) * luck), 0));
const same = (got, exp) => BR.every((b, i) => got.counts[b] === exp[i]);
// player luck comes from the attribute: luck = +1/level, unluck = -1/level (StatusEffects.LUCK/UNLUCK)
const P = (name, amp) => { const p = { type: 'player', x: 0, y: 0, z: 0 }; if (name) E.addStatusEffect(p, name, 600, amp); return p; };
ok(E.luckOf(P()) === 0, 'no effect: luck 0');
ok(E.luckOf(P('luck', 0)) === 1 && E.luckOf(P('luck', 1)) === 2, 'Luck I/II = +1/+2');
ok(E.luckOf(P('unluck', 0)) === -1 && E.luckOf(P('unluck', 2)) === -3, 'Bad Luck I/III = -1/-3');
const cases = [['luck 0', P(), 0], ['Luck II', P('luck', 1), 2], ['Bad Luck III', P('unluck', 2), -3]];
for (const [n, p, lk] of cases) {
  const exp = expectW(lk, (e) => e.quality);
  const got = pickCounts(E.luckOf(p), leaf);
  ok(got.total === exp.reduce((a, b) => a + b, 0), `${n}: total ${got.total} == sum of floor(w+q*luck)`);
  ok(same(got, exp), `${n}: junk/treasure/fish = ${exp.join('/')} (got ${BR.map((b) => got.counts[b]).join('/')})`);
}
ok(same(pickCounts(0, leaf), [10, 5, 85]), 'luck 0 equals today: 10/5/85');
ok(pickCounts(2, leaf).counts.treasure > 5 && pickCounts(-3, leaf).counts.treasure < 5, 'Luck raises, Bad Luck lowers treasure');
// bonus_rolls: rolls = rolls + floor(bonus_rolls * luck)
const bt = { pools: [{ rolls: 1, bonus_rolls: 0.5, entries: [{ type: 'item', name: 'stick' }] }] };
const roll = (luck) => { const orig = L.table; L.table = () => bt; const s = L.rollTable('x', { rng: { nextInt: () => 0, nextFloat: () => 0 }, luck }); L.table = orig; return s[0] ? s[0].count : 0; };
ok(roll(0) === 1, 'bonus_rolls: luck 0 -> 1 roll');
ok(roll(4) === 3, `bonus_rolls 0.5*luck 4 -> 3 rolls (got ${roll(4)})`);
// ---- anti-vacuity: wrong models must disagree with the engine
const expLuck = expectW(2, (e) => e.quality);
const ignored = pickCounts(0, leaf);
if (!same(ignored, expLuck)) { caught++; console.log('   ✓ break caught: luck ignored'); } else fails.push('anti-vacuity: luck ignored not caught');
const onWeight = leaf.map((e) => ({ ...e, quality: 0, weight: e.weight + 0 }));
if (!same(pickCounts(2, onWeight), expLuck)) { caught++; console.log('   ✓ break caught: quality dropped'); } else fails.push('anti-vacuity: quality dropped not caught');
const swapped = leaf.map((e) => ({ ...e, weight: e.quality, quality: e.weight }));
if (!same(pickCounts(2, swapped), expLuck)) { caught++; console.log('   ✓ break caught: luck applied to weight not quality'); } else fails.push('anti-vacuity: luck applied to weight not quality not caught');
console.log(`luckcheck: ${N} assertions, ${fails.length} failures, ${caught} breaks caught`);
for (const f of fails) console.log('  ✗ ' + f);
process.exit(fails.length || caught < 3 ? 1 : 0);
