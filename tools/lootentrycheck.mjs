#!/usr/bin/env node
// lootentrycheck.mjs — #11740: net/minecraft/loot/entry (group / sequence / alternatives / empty / tag / item / loot_table)
// via the real entry point Loot.rollTable on synthetic tables. Each behaviour is then cut.
import { loadEngine } from './loadsrc.mjs';
console.log('lootentrycheck — loot pool entry types');
const item = (n, conditions) => ({ type: 'minecraft:item', name: 'minecraft:' + n, conditions });
const no = [{ condition: 'minecraft:inverted', term: { condition: 'minecraft:random_chance', chance: 1 } }];
function scenario(patch) {
  const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07e_loot.js'], dom: false });
  const L = M.Loot; L.ready = true;
  const T = {
    grp: { pools: [{ rolls: 1, entries: [{ type: 'minecraft:group', children: [item('apple'), item('stick', no), item('coal')] }] }] },
    seq: { pools: [{ rolls: 1, entries: [{ type: 'minecraft:sequence', children: [item('apple'), item('stick', no), item('coal')] }] }] },
    alt: { pools: [{ rolls: 1, entries: [{ type: 'minecraft:alternatives', children: [item('stick', no), item('coal'), item('apple')] }] }] },
    emp: { pools: [{ rolls: 1, entries: [{ type: 'minecraft:empty', weight: 1 }] }] },
    ref: { pools: [{ rolls: 1, entries: [{ type: 'minecraft:loot_table', name: 'minecraft:alt' }] }] },
  };
  L.table = (n) => T[L.key(n)];
  if (patch) patch(M);
  const f = []; const chk = (c, m) => { if (!c) f.push(m); };
  const names = (t) => L.rollTable(t, { rng: new M.JRandom(1) }).map((s) => s.item).sort().join(',');
  chk(names('grp') === 'apple,coal', 'group runs every passing child: ' + names('grp'));
  chk(names('seq') === 'apple', 'sequence stops at first failing child: ' + names('seq'));
  chk(names('alt') === 'coal', 'alternatives takes first passing child: ' + names('alt'));
  chk(names('emp') === '', 'empty gives nothing');
  chk(names('ref') === 'coal', 'loot_table entry delegates: ' + names('ref'));
  return f;
}
const base = scenario();
let breaks = 0; const fails = base.map((m) => 'baseline: ' + m);
const cut = (name, patch) => { const f = scenario(patch); if (f.length) breaks++; else fails.push('cut not caught: ' + name); };
const wrap = (fn) => (M) => { const o = M.Loot.rollTable; M.Loot.rollTable = function (n, c) { return fn(o.call(this, n, c), n); }; };
cut('group drops children', wrap((r, n) => (n === 'grp' ? r.slice(0, 1) : r)));
cut('sequence keeps going', wrap((r, n) => (n === 'seq' ? r.concat([{ item: 'coal', count: 1 }]) : r)));
cut('alternatives takes all', wrap((r, n) => (n === 'alt' ? r.concat([{ item: 'apple', count: 1 }]) : r)));
cut('empty drops', wrap((r, n) => (n === 'emp' ? [{ item: 'x', count: 1 }] : r)));
cut('loot_table ignored', wrap((r, n) => (n === 'ref' ? [] : r)));
console.log(` ${base.length === 0 ? 'baseline clean' : 'baseline dirty'}, ${fails.length} failures, ${breaks} breaks caught`);
if (fails.length) { for (const f of fails.slice(0, 10)) console.log('  FAIL ' + f); console.log('\nFAIL lootentrycheck'); process.exit(1); }
console.log('PASS lootentrycheck — 5 assertions, 0 failures, ' + breaks + ' breaks caught');
