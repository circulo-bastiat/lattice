#!/usr/bin/env node
// enchtable11585check.mjs — #11585: proves 07oy_enchtable.js's EnchantingTableBlock (bookshelf census via Hud.openEnchanting),
// SwordItem (weapon target: sword offers/gets weapon enchants, enchantability by tier) and EnchantmentScreenHandler
// (offers a function of seed+shelves; Menu.enchantClick applies seed+button roll, costs lapis/levels). Each source break must fail its row.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '02i_text.js', '14f_inventory.js', '14d_survival.js',
  '07ox_enchhelper.js', '07oy_enchtable.js', '14g_menu.js', '14g2_invclasses.js', '07c_blockentity.js', '13_input.js', '15b_gui.js', '15_hud.js'];
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const MCL = loadEngine({ extra: EXTRA, dom: false, ...(patch ? { patch } : {}) });
  MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  MCL.Recipes.init({ recipes: b64('recipes.bin'), recipesBytes: rdj('recipes.meta.json').jsonBytes });
  MCL.Text.init({ lang: b64('lang.bin'), langBytes: rdj('lang.meta.json').rawBytes,
    langOverrides: readFileSync(join(ASSETS, 'lang-overrides.json'), 'utf8') });
  const Inv = MCL.Inventory; const stk = (n, c) => Inv.stack(n, c === undefined ? 1 : c); const M = MCL.Menu, H = MCL.Hud, ET = MCL.EnchTable, Sv = MCL.Survival, S = MCL.States, o = {};
  Math.random = () => 0.5;
  const cells = new Map();
  const put = (x, y, z, n) => cells.set(x + ',' + y + ',' + z, S.stateOf(n));
  MCL.World = { getBlock: (x, y, z) => cells.get(x + ',' + y + ',' + z) || 0 };
  put(0, 0, 0, 'enchanting_table');
  for (const f of ET.BOOKSHELF_OFFSETS) if (f[1] === 0) put(f[0], 0, f[2], 'bookshelf');
  const player = (lvl) => {
    const P = { menu: { inventory: Inv.create() }, xpTotal: 0, instabuild: false, dropped: [], dropStack(s) { this.dropped.push(s); } };
    Sv.fromJSON(P, null); P.xpTotal = Sv.totalXpFor(lvl); Sv.syncXp(P); MCL.Player = P; P.enchantSeed = 777; return P;
  };
  const look = (item, lapis) => {
    H.openEnchanting(0, 0, 0); const m = H.enchantMenu;
    m.table.set(0, item); m.table.set(1, stk('lapis_lazuli', lapis === undefined ? 3 : lapis)); M.enchantRefresh(m); return m;
  };
  const shut = () => { H.enchantMenu.table.set(0, null); H.enchantMenu.table.set(1, null); H.close(); };
  // EnchantingTableBlock: 16 shelves at table height seen across air; a torch hides 3; cave_air is air
  let P = player(30), m = look(stk('diamond_sword'));
  o.shelves = m.shelves === 16; o.cap = m.offers.power[2] === ET.requiredLevel(new ET.Random(777), 2, 15, ET.info('diamond_sword')); shut();
  put(0, 1, 2, 'bookshelf'); put(0, 1, 1, 'air'); m = look(stk('diamond_sword')); o.upper = m.shelves === 17; shut(); cells.delete('0,1,2');
  put(1, 0, 0, 'torch'); m = look(stk('diamond_sword')); o.hide = m.shelves === 13; shut();
  put(1, 0, 0, 'cave_air'); m = look(stk('diamond_sword')); o.caveAir = m.shelves === 16; shut();
  cells.delete('1,0,0');
  // SwordItem: enchantability by tier, weapon target, no table sharpness-for-axe
  const en = (n) => { const i = ET.info(n); return i && i.ench; };
  o.tier = en('wooden_sword') === 15 && en('stone_sword') === 5 && en('iron_sword') === 14 && en('golden_sword') === 22 && en('diamond_sword') === 10 && en('netherite_sword') === 15;
  o.target = ET.info('iron_sword').targets.includes('weapon') && !ET.info('iron_axe').targets.includes('weapon');
  o.stoneLow = (() => { const r = ET.generate(new ET.Random(5), ET.info('golden_sword'), 30); return r.length > 0 && r.every((e) => MCL.EnchHelper.ENCH[e.id].target === 'weapon' || MCL.EnchHelper.ENCH[e.id].target === 'breakable'); })();
  o.zero = (() => { for (let sd = 1; sd < 200; sd++) { const f = ET.offers(sd, 0, stk('stone_sword')); for (let b = 0; b < 3; b++) if (f.power[b] === 0) return true; } return false; })();
  o.enchantable = ET.isEnchantable(stk('iron_sword')) && !ET.isEnchantable(stk('stick')) && !ET.isEnchantable(stk('iron_sword', 2));
  // EnchantmentScreenHandler: offers deterministic in seed; click applies roll for seed+button
  P = player(60); m = look(stk("diamond_sword")); const pw = m.offers.power.slice(), idv = m.offers.id.slice(), lv = m.offers.level.slice();
  const again = ET.offers(777, m.shelves, stk('diamond_sword'));
  o.offers = JSON.stringify(again) === JSON.stringify(m.offers) && pw.every((x) => x > 0) && pw[0] <= pw[1] && pw[1] <= pw[2];
  const exp = ET.rollWith(new ET.Random(779), ET.info('diamond_sword'), pw[2]);
  o.clue3 = [0, 1, 2].every((b) => { const r = new ET.Random(777 + b), L = ET.rollWith(r, ET.info('diamond_sword'), pw[b]), e = L[r.nextInt(L.length)]; return e.id === idv[b] && e.level === lv[b]; });
  const lvl0 = P.xpLevel | 0;
  o.click = M.enchantClick(m, P, 2) === true;
  const got = m.table.get(0) && m.table.get(0).t && m.table.get(0).t.Enchantments || [];
  o.applied = got.length === exp.length && exp.length > 0 && got.every((g, k) => g.id === 'minecraft:' + exp[k].id && g.lvl === exp[k].level);
  o.clue = got.some((g) => g.id === 'minecraft:' + idv[2] && g.lvl === lv[2]);
  o.lapis = m.table.get(1) === null || m.table.get(1).n === 0;
  o.levels = (P.xpLevel | 0) === lvl0 - 3;
  o.reseed = P.enchantSeed !== 777 && m.seed === (P.enchantSeed | 0);
  o.noRe = M.enchantClick(m, P, 0) === false;  // enchanted already -> offers zero
  shut();
  // not enough lapis / levels
  P = player(30); m = look(stk('diamond_sword'), 1); o.needLapis = M.enchantClick(m, P, 2) === false; shut();
  P = player(1); m = look(stk('diamond_sword')); o.needLevel = M.enchantClick(m, P, 2) === false; shut();
  return o;
}
const A = trial(null);
for (const k of Object.keys(A)) ok(A[k], 'scenario ' + k + ' ' + JSON.stringify(A));
const F = '07oy_enchtable.js';
const BR = [
  ['hide', "ET.isAirName(blockAt(x + ((o[0] / 2) | 0), y + o[1], z + ((o[2] / 2) | 0)))", 'true'],
  ['caveAir', "name === 'air' || name === 'cave_air' || name === 'void_air'", "name === 'air'"],
  ['upper', 'for (var dy = 0; dy <= 1; dy++)', 'for (var dy = 0; dy <= 0; dy++)'],
  ['cap', 'if (shelves > 15) shelves = 15;', ''],
  ['tier', 'stone: 5,', 'stone: 9,'],
  ['target', "m[2] === 'sword' ? 'weapon' : 'digger'", "'weapon'"],
  ['enchantable', 'if (!st || st.n !== 1) return false;', 'if (!st) return false;'],
  ['zero', 'if (o.power[b] < b + 1) o.power[b] = 0;', ''],
  ['clue3', 'var r2 = new JRandom(seed + b);', 'var r2 = new JRandom(seed);'],
  ['clue3', 'var e = list[r2.nextInt(list.length)];', 'var e = list[(r2.nextInt(list.length) + 1) % list.length];'],
  ['reseed', 'return ((rng ? rng() : Math.random()) * 4294967296 | 0);', 'return 777;'],
  ['applied', 'return ET.rollWith(new JRandom(seed + button), info, power);', 'return ET.rollWith(new JRandom(seed), info, power);'],
];
for (const [key, a, b] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((f, s) => { if (f === F && s.includes(a)) { hit = true; return s.replace(a, b); } return s; }); } catch { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  ok(!X[key], 'anti-vacuity: break ' + key);
  if (!X[key]) console.log('  ✓ break caught: ' + key);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `enchtable11585check: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
