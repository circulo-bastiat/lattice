#!/usr/bin/env node
// statsitemscheck.mjs -- issue 11045: every vanilla incrementStat(MINED|CRAFTED|USED|BROKEN|PICKED_UP|DROPPED) site
// in .decomp has its counter in src/, and the counters reach the Statistics screen's item rows.
import { readFileSync } from 'node:fs';
import { loadEngine, MCLITE_ROOT as R } from './loadsrc.mjs';
const A = R + 'assets/';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const caught = (c, m) => { breaks++; if (!c) fails.push('anti-vacuity: ' + m); };
const rd = (f) => readFileSync(R + f, 'utf8');
const dec = (f) => rd('.decomp/net/minecraft/' + f);

// Stats.java field -> type, derived (not hard-coded) from the decomp
const types = {};
for (const m of dec('stat/Stats.java').matchAll(/(field_\d+) = registerType\("(\w+)"/g)) types[m[1]] = m[2];
const T = (n) => Object.keys(types).find((k) => types[k] === n);
ok(T('used') === 'field_15372' && T('broken') === 'field_15383' && T('picked_up') === 'field_15392', 'Stats.java type fields resolved');
// vanilla sites: file contains the type field
const vanilla = (file, type) => new RegExp('Stats\\.' + T(type) + '\\.getOrCreateStat').test(dec(file));
const SITES = [
  // [vanilla file, type, src file, src evidence regex, label]
  ['entity/ItemEntity.java', 'picked_up', 'src/14_player.js', /increase\(NS\.Stats\.statName\('picked_up'/, 'ItemEntity pickup'],
  ['item/BowItem.java', 'used', 'src/14l_use.js', /Use\.countUsed\('bow'\)/, 'BowItem'],
  ['item/CrossbowItem.java', 'used', 'src/14l_use.js', /Use\.countUsed\('crossbow'\)/, 'CrossbowItem shoot'],
  ['item/TridentItem.java', 'used', 'src/14l_use.js', /Use\.countUsed\('trident'\);[^\n]*\n\s*t\.loyalty/, 'TridentItem throw'],
  ['item/TridentItem.java', 'used', 'src/14l_use.js', /Use\.countUsed\('trident'\);[^\n]*riptide/, 'TridentItem riptide'],
  ['entity/player/PlayerEntity.java', 'used', 'src/14l_use.js', /Use\.countUsed\('shield'\)/, 'damageShield'],
  ['entity/player/PlayerEntity.java', 'used', 'src/14l_use.js', /Use\.countUsed\(name\);[^\n]*eatFood/, 'eatFood / drink finish'],
  ['entity/LivingEntity.java', 'used', 'src/14d_survival.js', /countUsed\('totem_of_undying'\)/, 'tryUseTotem'],
  ['item/ItemStack.java', 'used', 'src/14l_use.js', /r === 'item' \|\| r === 'place'[^\n]*Use\.countUsed\(nm0\)/, 'useOnBlock / use generic'],
  ['entity/player/PlayerEntity.java', 'dropped', 'src/14_player.js', /statName\('dropped'/, 'dropItem'],
  ['item/ItemStack.java', 'broken', 'src/14l_use.js', /statName\('broken'/, 'damage break'],
  ['block/Block.java', 'mined', 'src/14_player.js', /statName\('mined'/, 'Block.afterBreak'],
];
function verify(srcOf, tag) {
  for (const [vf, ty, sf, re, label] of SITES) {
    ok(vanilla(vf, ty) || ty === 'mined' || ty === 'broken' || ty === 'dropped', tag + ': vanilla site exists ' + label);
    ok(re.test(srcOf(sf)), tag + ': src wires ' + label);
  }
}
verify(rd, 'src');
for (const [, , sf, re, label] of SITES) {
  const n0 = fails.length;
  const mut = (f) => (f === sf ? rd(f).replace(re, '/*dropped*/') : rd(f));
  verify(mut, 'drop');
  caught(fails.length > n0, 'dropped call site detected: ' + label);
  fails.length = n0;
}

// crafted: CraftingResultSlot/FurnaceOutputSlot flag and the counter
const M = loadEngine({ extra: ['02g_items.js', '07zzo_stats.js', '14g_menu.js', '14g2_invclasses.js', '15fs_stats.js'] });
M.Items.init({ items: readFileSync(A + 'items.bin').toString('base64'), itemsBytes: JSON.parse(readFileSync(A + 'items.meta.json', 'utf8')).rawBytes });
const St = M.Stats, SS = M.StatsScreen;
St.reset();
M.Menu.craftedStat({ i: M.Items.of('stick'), n: 4 }, 4);
ok(St.get(St.statName('crafted', 'stick')) === 4, 'craftedStat adds the count');
const row = SS.items().find((r) => r.id === 'stick');
ok(row && row.cells.join() === '0,0,4,0,0,0', 'Statistics row shows crafted 4');
St.set(St.statName('used', 'stick'), 2); St.set(St.statName('picked_up', 'stick'), 5);
ok(SS.items().find((r) => r.id === 'stick').cells.join() === '0,0,4,2,5,0', 'used/picked_up columns line up');
{ const n0 = fails.length; const sv = St.map; St.map = Object.create(null); St.set(St.statName('crafted', 'stick'), 5);
  ok(SS.items().find((r) => r.id === 'stick').cells.join() === '0,0,4,2,5,0', 'skew'); caught(fails.length > n0, 'skewed crafted count detected'); fails.length = n0; St.map = sv; }
const menu = rd('src/14g_menu.js');
ok(/if \(sl\.crafted && st\) Menu\.craftedStat/.test(menu), 'onTake counts crafted slots');
{ const n0 = fails.length; ok(/if \(sl\.crafted && st\) Menu\.craftedStat/.test(menu.replace('Menu.craftedStat(st, st.n)', '')), 'x'); caught(fails.length > n0, 'removed craft counting detected'); fails.length = n0; }

for (const f of fails) console.log('FAIL ' + f);
console.log(`${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
