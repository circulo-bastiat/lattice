#!/usr/bin/env node
// brewregcheck.mjs — G23 (#299), `BrewingRecipeRegistry` (src/07zzq_brewing.js), the recipe tree.
//
//   node tools/brewregcheck.mjs [--verbose]
//
// Sections:
//   1. referee — every registerDefaults row re-derived from .decomp (Items.java / Potions.java
//      field names resolved), compared row for row, in order, with the module's tables
//   2. awkward + sugar = swiftness, and sugar does nothing else to awkward
//   3. redstone extends (Potions.java's long_ duration), glowstone amplifies AND shortens,
//      fermented spider eye inverts swiftness -> slowness
//   4. gunpowder -> splash, dragon's breath -> lingering (the potion carried over)
//   5. isValidIngredient / isPotionType / hasRecipe / craft's no-match, and the menu reads it
//   6. anti-vacuity: every (input, ingredient) has one output; a broken table row is caught

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const DEC = join(MCLITE_ROOT, '.decomp', 'net', 'minecraft');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

const EXTRA = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '14g_menu.js', '07q_effects.js',
               '07z_potion.js', '07zzq_brewing.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });

const Inv = MCL.Inventory, Br = MCL.Brewing, Po = MCL.Potion, M = MCL.Menu;
const nameOf = (s) => (Inv.isEmpty(s) ? '' : MCL.Items.nameOf(s.i));
const pot = (item, p) => Br.potionStack(item, p);
const ing = (n) => Inv.stack(n, 1);

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); if (VERBOSE) console.log((c ? '   ✓ ' : '   ✗ ') + m); return c; };
let breaks = 0;
const say = (s) => { if (VERBOSE) console.log(s); };

console.log('brewregcheck — G23 (#299), BrewingRecipeRegistry');

// ═══════════ 1. referee ═════════════════════════════════════════════════════════════════════
say('\n1. registerDefaults re-derived from .decomp');
const itemSrc = readFileSync(join(DEC, 'item', 'Items.java'), 'utf8');
const potSrc = readFileSync(join(DEC, 'potion', 'Potions.java'), 'utf8');
const regSrc = readFileSync(join(DEC, 'recipe', 'BrewingRecipeRegistry.java'), 'utf8');
const itemName = {}, potName = {}, potRows = {};
for (const m of itemSrc.matchAll(/(field_\d+) = register\(\s*"(\w+)"/g)) itemName[m[1]] = m[2];
for (const seg of potSrc.split('public static final Potion ').slice(1)) {
  const m = /^(field_\d+) = register\(\s*"(\w+)"/.exec(seg); if (!m) continue;
  potName[m[1]] = m[2];
  potRows[m[2]] = [...seg.matchAll(/new StatusEffectInstance\(StatusEffects\.field_\d+(?:, (\d+)(?:, (\d+))?)?\)/g)]
    .map((r) => [r[1] === undefined ? 0 : +r[1], r[2] === undefined ? 0 : +r[2]]);
}
const defaults = regSrc.slice(regSrc.indexOf('registerDefaults()'));
const refTypes = [...defaults.matchAll(/registerPotionType\(Items\.(field_\d+)\)/g)].map((m) => itemName[m[1]]);
const refItem = [...defaults.matchAll(/registerItemRecipe\(Items\.(field_\d+), Items\.(field_\d+), Items\.(field_\d+)\)/g)]
  .map((m) => [itemName[m[1]], itemName[m[2]], itemName[m[3]]]);
const refPotion = [...defaults.matchAll(/registerPotionRecipe\(Potions\.(field_\d+), Items\.(field_\d+), Potions\.(field_\d+)\)/g)]
  .map((m) => [potName[m[1]], itemName[m[2]], potName[m[3]]]);
const rowDiff = (mine, ref) => {
  const bad = [];
  for (let k = 0; k < Math.max(mine.length, ref.length); k++)
    if (JSON.stringify(mine[k]) !== JSON.stringify(ref[k])) bad.push(k + ':' + JSON.stringify(mine[k]) + '≠' + JSON.stringify(ref[k]));
  return bad;
};
const refereeOk = () => rowDiff(Br.POTION_TYPES, refTypes).length === 0 && rowDiff(Br.ITEM_RECIPES, refItem).length === 0 &&
  rowDiff(Br.POTION_RECIPES, refPotion).length === 0;
ok(refTypes.length === 3 && refItem.length === 2 && refPotion.length > 50 &&
   refPotion.every((r) => r.every(Boolean)) && refItem.every((r) => r.every(Boolean)),
   `the referee resolves every field (3 types, 2 item rows, ${refPotion.length} potion rows)`);
ok(rowDiff(Br.POTION_TYPES, refTypes).length === 0, 'POTION_TYPES equal registerPotionType, in order');
ok(rowDiff(Br.ITEM_RECIPES, refItem).length === 0, `ITEM_RECIPES equal registerItemRecipe (${rowDiff(Br.ITEM_RECIPES, refItem).join(' ')})`);
ok(rowDiff(Br.POTION_RECIPES, refPotion).length === 0, `POTION_RECIPES equal registerPotionRecipe row for row (${rowDiff(Br.POTION_RECIPES, refPotion).join(' ')})`);
for (const r of Br.POTION_RECIPES) if (!ok(Po.POTIONS[r[0]] && Po.POTIONS[r[2]], `${r.join(' + ')}: both potions are in Po.POTIONS`)) break;
for (const r of Br.POTION_RECIPES.concat(Br.ITEM_RECIPES)) if (!ok(MCL.Items.of(r[1]) >= 0, `${r[1]} is a registered item`)) break;

// ═══════════ 2. awkward + sugar ═════════════════════════════════════════════════════════════
say('\n2. awkward + sugar = swiftness and nothing else');
const outsFor = (input, ingredient) => Br.POTION_RECIPES.filter((r) => r[0] === input && r[1] === ingredient).map((r) => r[2]);
const sugarOk = () => {
  const out = Br.craft(ing('sugar'), pot('potion', 'awkward'));
  return nameOf(out) === 'potion' && Br.potionOf(out) === 'swiftness' && out.n === 1 &&
    outsFor('awkward', 'sugar').length === 1 && outsFor('awkward', 'sugar')[0] === 'swiftness';
};
ok(sugarOk(), 'craft(sugar, awkward potion) = a swiftness potion, and the table has exactly that one row');
ok(Br.hasRecipe(pot('potion', 'awkward'), ing('sugar')), 'hasRecipe(awkward, sugar)');
ok(Br.potionOf(Br.craft(ing('sugar'), pot('potion', 'water'))) === 'mundane', 'sugar on a WATER bottle makes mundane, not swiftness');
ok(Br.potionOf(Br.craft(ing('sugar'), pot('potion', 'thick'))) === 'thick' && !Br.hasRecipe(pot('potion', 'thick'), ing('sugar')),
   'sugar on thick has no recipe: craft returns the input unchanged');

// ═══════════ 3. redstone / glowstone / fermented spider eye ═════════════════════════════════
say('\n3. the three modifiers');
const eff = (p) => Po.POTIONS[p].effects[0];
{
  const out = Br.craft(ing('redstone'), pot('potion', 'swiftness'));
  ok(Br.potionOf(out) === 'long_swiftness', 'swiftness + redstone = long_swiftness');
  ok(eff('long_swiftness').duration === potRows.long_swiftness[0][0] && eff('long_swiftness').duration > eff('swiftness').duration,
     `long_swiftness lasts Potions.java's ${potRows.long_swiftness[0][0]} ticks, longer than swiftness`);
  let extendOk = true;
  for (const r of Br.POTION_RECIPES) if (r[1] === 'redstone' && r[0] !== 'water') {
    const a = Po.POTIONS[r[0]].effects, b = Po.POTIONS[r[2]].effects;
    if (!(r[2] === 'long_' + r[0] && b[0].duration === potRows[r[2]][0][0] && b[0].duration > a[0].duration && b[0].amplifier === a[0].amplifier)) extendOk = false;
  }
  ok(extendOk, 'every redstone row maps X -> long_X, same amplifier, Potions.java\'s longer duration');
}
{
  const out = Br.craft(ing('glowstone_dust'), pot('potion', 'swiftness'));
  ok(Br.potionOf(out) === 'strong_swiftness', 'swiftness + glowstone = strong_swiftness');
  ok(eff('strong_swiftness').amplifier > eff('swiftness').amplifier && eff('strong_swiftness').duration < eff('swiftness').duration,
     'strong_swiftness is amplified AND shorter');
  let ampOk = true;
  for (const r of Br.POTION_RECIPES) if (r[1] === 'glowstone_dust' && r[0] !== 'water') {
    const a = Po.POTIONS[r[0]].effects[0], b = Po.POTIONS[r[2]].effects[0];
    if (!(r[2] === 'strong_' + r[0] && b.amplifier > a.amplifier && b.duration <= a.duration)) ampOk = false;
  }
  ok(ampOk, 'every glowstone row maps X -> strong_X, amplified, never longer (turtle master and the instants keep theirs)');
}
{
  const out = Br.craft(ing('fermented_spider_eye'), pot('potion', 'swiftness'));
  ok(Br.potionOf(out) === 'slowness', 'swiftness + fermented spider eye = slowness');
  ok(Br.potionOf(Br.craft(ing('fermented_spider_eye'), pot('potion', 'long_swiftness'))) === 'long_slowness', 'long_swiftness inverts to long_slowness');
  ok(Br.potionOf(Br.craft(ing('fermented_spider_eye'), pot('potion', 'strong_swiftness'))) === 'strong_swiftness',
     'strong_swiftness has NO inversion in 1.18.2: craft returns it unchanged');
}

// ═══════════ 4. gunpowder / dragon's breath ═════════════════════════════════════════════════
say('\n4. the item recipes');
const splashOk = () => { const o = Br.craft(ing('gunpowder'), pot('potion', 'strong_healing'));
  return nameOf(o) === 'splash_potion' && Br.potionOf(o) === 'strong_healing' && o.n === 1; };
const lingerOk = () => { const o = Br.craft(ing('dragon_breath'), pot('splash_potion', 'long_poison'));
  return nameOf(o) === 'lingering_potion' && Br.potionOf(o) === 'long_poison'; };
ok(splashOk(), 'gunpowder turns a potion into a splash potion, the potion carried over');
ok(lingerOk(), 'dragon\'s breath turns a splash potion into a lingering potion, the potion carried over');
{ const o = Br.craft(ing('gunpowder'), pot('potion', 'empty'));
  ok(nameOf(o) === 'splash_potion' && !Inv.tagOf(o), 'an uncraftable (empty) potion still becomes a splash, still with no Potion tag'); }
ok(!Br.hasRecipe(pot('potion', 'awkward'), ing('dragon_breath')), 'dragon\'s breath does nothing to a plain potion');
ok(!Br.hasRecipe(pot('lingering_potion', 'swiftness'), ing('gunpowder')), 'gunpowder does nothing to a lingering potion');

// ═══════════ 5. predicates, and the menu reads the registry ═════════════════════════════════
say('\n5. predicates');
ok(Br.isValidIngredient(ing('nether_wart')) && Br.isValidIngredient(ing('dragon_breath')) && !Br.isValidIngredient(ing('diamond')),
   'isValidIngredient: nether wart and dragon\'s breath yes, diamond no');
ok(!Br.isValidIngredient(Inv.EMPTY), 'isValidIngredient(empty) is false');
ok(Br.isPotionType(pot('lingering_potion', 'water')) && !Br.isPotionType(ing('glass_bottle')), 'isPotionType: lingering yes, glass bottle no');
ok(!Br.hasRecipe(Inv.stack('glass_bottle', 1), ing('nether_wart')), 'hasRecipe refuses a non-potion input before looking at recipes');
ok(Br.isBrewable('long_invisibility') && !Br.isBrewable('luck') && !Br.isBrewable('water'), 'isBrewable: long_invisibility yes, luck and water no');
{ const tagged = Inv.stack('potion', 1, 0, { Potion: 'minecraft:awkward', CustomPotionEffects: [{ effect: 'luck', duration: 5, amplifier: 0 }] });
  const o = Br.craft(ing('sugar'), tagged);
  ok(Br.potionOf(o) === 'swiftness' && !Inv.tagOf(o).CustomPotionEffects, 'craft builds a fresh stack: other tags are dropped'); }
{ const s = pot('potion', 'awkward'); ok(Br.craft(Inv.EMPTY, s) === s, 'no match returns the input itself'); }
ok(Br.potionOf(Inv.stack('potion', 1, 0, { Potion: 'minecraft:nonsense' })) === 'empty', 'an unknown Potion id reads as empty');
const reg = Br.ingredients();
ok(reg.length === new Set(refItem.concat(refPotion).map((r) => r[1])).size, `the registry has ${reg.length} distinct ingredients, the referee's count`);
ok(JSON.stringify(M.BREW_INGREDIENTS) === JSON.stringify(reg), 'Menu.BREW_INGREDIENTS is the registry\'s list');
ok(reg.every((n) => M.brewingIsIngredient(ing(n))) && !M.brewingIsIngredient(ing('diamond')), 'the menu\'s ingredient slot asks the registry');

// ═══════════ 6. anti-vacuity ════════════════════════════════════════════════════════════════
say('\n6. anti-vacuity');
const uniqueOk = () => {
  const seen = new Set();
  for (const r of Br.POTION_RECIPES) { const k = r[0] + '|' + r[1]; if (seen.has(k)) return false; seen.add(k); }
  for (const r of Br.ITEM_RECIPES) { const k = 'item:' + r[0] + '|' + r[1]; if (seen.has(k)) return false; seen.add(k); }
  return true;
};
ok(uniqueOk(), 'every ingredient maps to exactly one output per input');
const breakIt = (label, good, brk) => {
  ok(good(), `${label}: the assertion passes on clean data`);
  const undo = brk(); let r; try { r = good(); } finally { undo(); }
  breaks++;
  ok(!r, `${label}: the assertion FAILS once the data is broken`);
  if (!r) console.log(`   ✓ break caught: ${label}`);
};
const swapRow = (tbl, k, row) => { const v = tbl[k]; tbl[k] = row; return () => { tbl[k] = v; }; };
const findRow = (tbl, a, b) => tbl.findIndex((r) => r[0] === a && r[1] === b);
breakIt('awkward + sugar -> slowness', () => sugarOk() && refereeOk(),
  () => swapRow(Br.POTION_RECIPES, findRow(Br.POTION_RECIPES, 'awkward', 'sugar'), ['awkward', 'sugar', 'slowness']));
breakIt('a second awkward + sugar row', () => sugarOk() && uniqueOk(),
  () => { Br.POTION_RECIPES.push(['awkward', 'sugar', 'leaping']); return () => Br.POTION_RECIPES.pop(); });
breakIt('redstone row points at strong_', refereeOk,
  () => swapRow(Br.POTION_RECIPES, findRow(Br.POTION_RECIPES, 'poison', 'redstone'), ['poison', 'redstone', 'strong_poison']));
breakIt('gunpowder makes a lingering potion', () => splashOk() && refereeOk(),
  () => swapRow(Br.ITEM_RECIPES, 0, ['potion', 'gunpowder', 'lingering_potion']));
breakIt('dragon\'s breath row dropped', () => lingerOk() && refereeOk(),
  () => { const v = Br.ITEM_RECIPES.pop(); return () => Br.ITEM_RECIPES.push(v); });
breakIt('rows out of order', refereeOk,
  () => { const a = Br.POTION_RECIPES[3]; Br.POTION_RECIPES[3] = Br.POTION_RECIPES[4]; Br.POTION_RECIPES[4] = a;
    return () => { const b = Br.POTION_RECIPES[3]; Br.POTION_RECIPES[3] = Br.POTION_RECIPES[4]; Br.POTION_RECIPES[4] = b; }; });
breakIt('glass bottle counted as a potion type', () => !Br.hasRecipe(Inv.stack('glass_bottle', 1), ing('nether_wart')),
  () => { Br.POTION_TYPES.push('glass_bottle'); Br.ITEM_RECIPES.push(['glass_bottle', 'nether_wart', 'potion']);
    return () => { Br.POTION_TYPES.pop(); Br.ITEM_RECIPES.pop(); }; });

console.log('\n============== brewregcheck ===============');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
console.log('===========================================');
if (fails.length) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
console.log(`${breaks} breaks caught`);
