#!/usr/bin/env node
// lootfunctioncheck.mjs — #11741: net/minecraft/loot/function data functions, via the real entry point Loot.rollTable.
import { loadEngine } from './loadsrc.mjs';
console.log('lootfunctioncheck — loot item functions');
const fns = {
  set_name: [{ function: 'set_name', name: 'Hi' }, (s) => s.nbt && s.nbt.name === 'Hi'],
  set_lore: [{ function: 'set_lore', lore: ['a', 'b'] }, (s) => s.nbt && s.nbt.lore.join() === 'a,b'],
  set_nbt: [{ function: 'set_nbt', tag: '{x:1}' }, (s) => s.nbt && s.nbt.tag === '{x:1}'],
  set_enchantments: [{ function: 'set_enchantments', enchantments: { 'minecraft:sharpness': 3 } }, (s) => s.ench && s.ench[0].id === 'sharpness' && s.ench[0].lvl === 3],
  enchant_randomly: [{ function: 'enchant_randomly', enchantments: ['minecraft:mending'] }, (s) => s.ench && s.ench[0].id === 'mending'],
  set_loot_table: [{ function: 'set_loot_table', name: 'minecraft:chests/x', seed: 5 }, (s) => s.nbt && s.nbt.lootTable.name === 'chests/x' && s.nbt.lootTable.seed === 5],
  set_stew_effect: [{ function: 'set_stew_effect', effects: [{ type: 'minecraft:night_vision', duration: 100 }] }, (s) => s.nbt && s.nbt.stewEffect.id === 'night_vision' && s.nbt.stewEffect.duration === 100],
  set_banner_pattern: [{ function: 'set_banner_pattern', patterns: [{ pattern: 'creeper', color: 'red' }], append: true }, (s) => s.nbt && s.nbt.patterns.length === 1],
  set_attributes: [{ function: 'set_attributes', modifiers: [{ attribute: 'minecraft:generic.max_health', operation: 'addition', amount: 4, name: 'n' }] }, (s) => s.nbt && s.nbt.attributes[0].amount === 4],
  exploration_map: [{ function: 'exploration_map', destination: 'minecraft:mansion', decoration: 'mansion' }, (s) => s.nbt && s.nbt.map.decoration === 'mansion' && s.nbt.map.zoom === 2],
};
function scenario(patch) {
  const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07e_loot.js'], dom: false });
  const L = M.Loot; L.ready = true;
  const T = {};
  for (const k in fns) T[k] = { pools: [{ rolls: 1, entries: [{ type: 'minecraft:item', name: 'minecraft:book', functions: [fns[k][0]] }] }] };
  L.table = (n) => T[L.key(n)];
  if (patch) patch(M);
  const f = [];
  for (const k in fns) { const r = L.rollTable(k, { rng: new M.JRandom(1) }); if (!(r.length === 1 && fns[k][1](r[0]))) f.push(k + ' wrong: ' + JSON.stringify(r)); }
  return f;
}
const base = scenario();
let breaks = 0; const fails = base.map((m) => 'baseline: ' + m);
for (const k in fns) {
  const f = scenario((M) => { const o = M.Loot.rollTable; M.Loot.rollTable = function (n, c) { const r = o.call(this, n, c); if (n === k) r.forEach((s) => { delete s.nbt; delete s.ench; }); return r; }; });
  if (f.length) breaks++; else fails.push('cut not caught: ' + k);
}
console.log(` ${base.length === 0 ? 'baseline clean' : 'baseline dirty'}, ${fails.length} failures, ${breaks} breaks caught`);
if (fails.length) { for (const f of fails.slice(0, 10)) console.log('  FAIL ' + f); console.log('\nFAIL lootfunctioncheck'); process.exit(1); }
console.log('PASS lootfunctioncheck — ' + Object.keys(fns).length + ' assertions, 0 failures, ' + breaks + ' breaks caught');
