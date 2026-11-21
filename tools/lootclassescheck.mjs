#!/usr/bin/env node
// lootclassescheck.mjs — #11692: TimeCheckLootCondition, LootContext, EnchantWithLevelsLootFunction,
// SetDamageLootFunction, LootNumberProvider/UniformLootNumberProvider (src/07e_loot.js), via the real
// entry points Loot.rollTable (gameplay/fishing/treasure + junk) and Loot.testPredicate. Each is then cut.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const A = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
console.log('lootclassescheck — loot number providers, set_damage, enchant_with_levels, time_check');

function scenario(patch) {
  const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07e_loot.js', '07ox_enchhelper.js'], dom: false });
  M.Items.init({ items: readFileSync(join(A, 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.Loot.init({ loot: readFileSync(join(A, 'loot.bin')).toString('base64'), lootBytes: rdj('loot.meta.json').jsonBytes });
  if (patch) patch(M);
  const L = M.Loot, f = []; const chk = (c, m) => { if (!c) f.push(m); };
  const roll = (name, s) => L.rollTable(name, { rng: new M.JRandom(s), luck: 0, openWater: true });
  // set_damage (uniform 0..0.25 remaining): damage = floor((1-u)*max) in (0.75*max-1, max], and it varies
  let rods = 0, dmg = new Set(), ench = 0, enchOk = true, books = 0;
  for (let s = 1; s <= 600; s++) {
    for (const st of roll('gameplay/fishing/treasure', s)) {
      if (st.item === 'fishing_rod' || st.item === 'bow') {
        const mx = M.Items.durability[M.Items.of(st.item)];
        rods++; dmg.add(st.d);
        chk(st.d >= Math.floor(0.75 * mx) && st.d <= mx, 'damage range ' + st.item + ' ' + st.d);
        if (!(st.ench && st.ench.length)) enchOk = false; else ench++;
      }
      if (st.item === 'enchanted_book') { books++; if (!(st.ench && st.ench.length)) enchOk = false; }
    }
  }
  chk(rods > 20 && dmg.size > 10, 'set_damage varies (uniform draw): ' + dmg.size);
  chk(enchOk && ench > 20 && books > 5, 'enchant_with_levels 20 enchants every treasure item');
  // junk: set_damage on fishing_rod 0..0.9
  let jd = new Set();
  for (let s = 1; s <= 800; s++) for (const st of roll('gameplay/fishing/junk', s)) if (st.item === 'fishing_rod') jd.add(st.d);
  chk(jd.size > 5 && Math.min(...jd) >= 6, 'junk rod damage spread');
  // time_check with period + min/max, and exact value
  L.registerPredicate('t_range', { condition: 'minecraft:time_check', period: 24000, value: { min: 0, max: 12000 } });
  L.registerPredicate('t_exact', { condition: 'minecraft:time_check', value: 5 });
  const T = (id, t) => L.testPredicate(id, { dayTime: t, rng: new M.JRandom(1) });
  chk(T('t_range', 6000) === true && T('t_range', 18000) === false, 'time_check range');
  chk(T('t_range', 24000 + 6000) === true && T('t_range', 48000 + 18000) === false, 'time_check period wraps');
  chk(T('t_exact', 5) === true && T('t_exact', 6) === false, 'time_check exact');
  return f;
}
const base = scenario();
let breaks = 0; const fails = base.map((m) => 'baseline: ' + m);
const cut = (name, patch) => { const f = scenario(patch); if (f.length) breaks++; else fails.push('cut not caught: ' + name); };
const wrapTable = (fn) => (M) => { const o = M.Loot.rollTable; M.Loot.rollTable = function (n, c) { return fn(o.call(this, n, c), n); }; };
cut('set_damage dropped', wrapTable((r) => { for (const s of r) s.d = 0; return r; }));
cut('set_damage undamaged', wrapTable((r) => { for (const s of r) if (s.d !== undefined) s.d = 0; return r; }));
cut('uniform constant', wrapTable((r) => { for (const s of r) if (s.d !== undefined) s.d = 5; return r; }));
cut('enchant_with_levels dropped', wrapTable((r) => { for (const s of r) s.ench = []; return r; }));
cut('time_check ignores period', (M) => { const o = M.Loot.testPredicate; M.Loot.testPredicate = (id, c) => o.call(M.Loot, id, Object.assign({}, c, { dayTime: Math.min(c.dayTime, 23999) })); });
cut('time_check always true', (M) => { M.Loot.testPredicate = () => true; });
cut('time_check inverted', (M) => { const o = M.Loot.testPredicate; M.Loot.testPredicate = (id, c) => !o.call(M.Loot, id, c); });
console.log(` ${base.length === 0 ? 'baseline clean' : 'baseline dirty'}, ${fails.length} failures, ${breaks} breaks caught`);
if (fails.length) { for (const f of fails.slice(0, 10)) console.log('  FAIL ' + f); console.log('\nFAIL lootclassescheck'); process.exit(1); }
console.log('PASS lootclassescheck — 7 assertions, 0 failures, ' + breaks + ' breaks caught');
