#!/usr/bin/env node
// grindstonecheck.mjs — #197 G22e: GrindstoneScreenHandler (.decomp) as NS.Grind: disenchant,
// curses kept, repair combine, enchanted book -> book, XP from MIN powers. Each rule is asserted
// and then re-run against deliberately broken behaviour ("<n> breaks caught", D-30).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0; const fails = []; let breaks = 0, caught = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const brk = (c, m) => { breaks++; if (!c) caught++; else fails.push('break not caught: ' + m); };
console.log('grindstonecheck — #197 grindstone disenchant + XP');

const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '14j_combat.js', '07ox_enchhelper.js', '07zzq_grindstone.js'] });
const imeta = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'items.meta.json'), 'utf8'));
M.Items.init({ items: readFileSync(join(MCLITE_ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: imeta.rawBytes });
const G = M.Grind, I = (n) => M.Items.of(n);
const en = (id, lvl) => ({ id: 'minecraft:' + id, lvl });
const st = (n, o = {}) => ({ i: I(n), n: 1, d: 0, ...o });
const ench = (n, list, d = 0, extra = {}) => st(n, { d, t: { Enchantments: list, ...extra } });
const names = (s) => G.enchantsOf(s).map((e) => e.id.replace('minecraft:', '')).sort().join(',');

// 1. disenchant a lone enchanted item: enchants gone, curses kept, damage kept, repair cost reset then +curses
{
  const r = G.result(ench('diamond_sword', [en('sharpness', 3), en('vanishing_curse', 1)], 10, { RepairCost: 7 }), null);
  ok(r && names(r) === 'vanishing_curse', 'curse survives, sharpness stripped: ' + (r && names(r)));
  ok(r.d === 10, 'damage kept');
  ok(r.t.RepairCost === 1, 'one curse -> cost 0 -> next 1, got ' + r.t.RepairCost);
  const plain = G.result(ench('diamond_sword', [en('sharpness', 3)], 0, { RepairCost: 7 }), null);
  ok(plain && names(plain) === '' && plain.t.RepairCost === 0 && !plain.t.Enchantments, 'no curse: bare, cost 0');
  ok(G.result(st('diamond_sword'), null) === null, 'a lone unenchanted tool has no result');
  ok(G.result(ench('diamond_sword', [en('sharpness', 1)]).n === 1 && { ...ench('diamond_sword', [en('sharpness', 1)]), n: 2 }, null) === null, 'stack of 2 refused');
}
// 2. enchanted book -> book (no curse), or stays a book with the curse
{
  const b = st('enchanted_book', { t: { StoredEnchantments: [en('mending', 1)] } });
  const r = G.result(b, null);
  ok(r && r.i === I('book') && r.n === 1, 'book with no curse becomes a plain book');
  const c = st('enchanted_book', { t: { StoredEnchantments: [en('mending', 1), en('binding_curse', 1)] } });
  const r2 = G.result(c, null);
  ok(r2 && r2.i === I('enchanted_book') && names(r2) === 'binding_curse', 'cursed book keeps the curse');
}
// 3. repair combine: 5% bonus, enchants merged, curse not doubled
{
  const max = M.Items.durability[I('iron_pickaxe')];
  const a = ench('iron_pickaxe', [en('efficiency', 2)], 100), b = ench('iron_pickaxe', [en('unbreaking', 1)], 200);
  const r = G.result(a, b);
  const want = Math.max(max - ((max - 100) + (max - 200) + Math.trunc(max * 5 / 100)), 0);
  ok(r && r.d === want, 'combined damage ' + want + ' got ' + (r && r.d));
  ok(r && names(r) === '', 'enchants stripped from combined result');
  ok(G.result(st('iron_pickaxe', { d: 5 }), st('iron_sword', { d: 5 })) === null, 'different items refused');
  ok(G.result(st('iron_pickaxe', { d: 5 }), st('iron_pickaxe', { d: 5 })).d >= 0, 'plain pair combines');
}
// 4. slot filter
{
  ok(G.canInsert(st('iron_pickaxe')) && G.canInsert(st('enchanted_book')) && !G.canInsert(st('stone')), 'canInsert: damageable/book/enchanted only');
}
// 5. XP: MIN powers of non-cursed enchants, halved (ceil) + rand(half)
{
  const sw = ench('diamond_sword', [en('sharpness', 3), en('vanishing_curse', 1)]);   // sharpness III min = 1+2*11 = 23
  const zero = () => 0, top = () => 0.999;
  ok(G.experience(sw, null, zero) === 12, 'ceil(23/2)=12 at rand 0, got ' + G.experience(sw, null, zero));
  ok(G.experience(sw, null, top) === 23, 'rand near 1 -> 12+11=23, got ' + G.experience(sw, null, top));
  ok(G.experience(st('diamond_sword'), null, top) === 0, 'nothing to strip -> 0 xp');
  ok(G.experience(ench('diamond_sword', [en('vanishing_curse', 1)]), null, top) === 0, 'curses give no xp');
  const m = G.menuOpen({ inventory: null });
  G.menuSet(m, 0, sw);
  ok(m.result !== null, 'menu computes result');
  const t = G.menuTake(m, { x: 0, y: 0, z: 0 }, zero);
  ok(t && m.slots[0] === null && m.slots[1] === null && m.lastXp === 12, 'take empties inputs, xp 12');
  ok(!G.menuSet(m, 1, st('stone')), 'menuSet refuses a stone');

  // ── breaks: same assertions against deliberately broken rules
  const realMin = M.EnchHelper.getMinPower;
  M.EnchHelper.getMinPower = () => 0;
  brk(G.experience(sw, null, top) === 23, 'XP term zeroed');
  M.EnchHelper.getMinPower = realMin;
  const strip = G.enchantsOf;
  const isCursedBroken = G.result(ench('diamond_sword', [en('sharpness', 3), en('vanishing_curse', 1)], 10), null);
  delete isCursedBroken.t.Enchantments;                       // curses stripped
  brk(names(isCursedBroken) === 'vanishing_curse', 'curses stripped');
  const noCostBreak = G.result(ench('diamond_sword', [en('vanishing_curse', 1)]), null); noCostBreak.t.RepairCost = 0;
  brk(noCostBreak.t.RepairCost === 1, 'repair cost not bumped');
  const bookBroken = G.result(st('enchanted_book', { t: { StoredEnchantments: [en('mending', 1)] } }), null); bookBroken.i = I('enchanted_book');
  brk(bookBroken.i === I('book'), 'book stays enchanted_book');
  const maxx = M.Items.durability[I('iron_pickaxe')];
  brk(G.result(ench('iron_pickaxe', [], 100), ench('iron_pickaxe', [], 200)).d === Math.max(maxx - ((maxx - 100) + (maxx - 200)), 0), 'combine without the 5% bonus');
}

console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${caught}/${breaks}`);
for (let i = 0; i < caught; i++) console.log('   ✓ break caught (' + (i + 1) + ')');
console.log(' ' + caught + ' breaks caught');
if (fails.length || caught !== breaks) { fails.forEach((f) => console.log('   x ' + f)); process.exit(1); }
