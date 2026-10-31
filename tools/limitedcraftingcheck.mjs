#!/usr/bin/env node
// limitedcraftingcheck.mjs — G17-GR1. doLimitedCrafting (RecipeUnlocker.shouldCraftRecipe).
//
//   node tools/limitedcraftingcheck.mjs
//
// Rule on + empty recipe book: a 2x2 planks craft yields nothing; after the recipe is unlocked it yields
// planks; rule off it always yields. Special recipes (ignoredInRecipeBook) are never refused.
// ANTI-VACUITY: the same assertions run against a copy of 02h_recipes.js with the rule check removed
// and must fail. "<n> breaks caught".

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src'), ASSETS = join(ROOT, 'assets');
const rd = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

function run(mutate) {
  const NS = {};
  globalThis.MCL = NS;
  for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '02_blocks.js', '02b_registry.js',
    '02c_states.js', '02f_tags.js', '02g_items.js', '02h_recipes.js', '03_section.js', '05_mesher.js', '14f_inventory.js']) {
    let s = readFileSync(join(SRC, f), 'utf8');
    if (f === '02h_recipes.js') s = mutate(s);
    new Function('MCL', s)(NS);
  }
  NS.Reg.init({
    runtime: b64('block-runtime.bin'), runtimeBytes: rd('block-runtime.meta.json').rawBytes,
    geometry: b64('block-geometry.bin'), geometryBytes: rd('block-geometry.meta.json').rawBytes,
    tileAlpha: rd('block-tiles.meta.json').alpha,
    tags: b64('tags.bin'), tagsBytes: rd('tags.meta.json').blobBytes,
  });
  NS.Items.init({ items: b64('items.bin'), itemsBytes: rd('items.meta.json').rawBytes });
  NS.Recipes.init({ recipes: b64('recipes.bin'), recipesBytes: rd('recipes.meta.json').jsonBytes });
  const R = NS.Recipes, Inv = NS.Inventory;
  const grid = [Inv.stack('oak_log', 1, 0), Inv.EMPTY, Inv.EMPTY, Inv.EMPTY];
  const rec = R.craftingRecipeFor(grid, 2, 2);
  const fails = [];
  const expect = (c, m) => { if (!c) fails.push(m); };
  let rule = 'true';
  NS.Commands = { ruleGet: () => rule };
  const player = { recipeBook: new Set() };
  expect(rec && rec.id, 'planks recipe found');
  const yields = () => !Inv.isEmpty(R.craft(grid, 2, 2, player));
  expect(!yields(), 'rule on, empty book: nothing');
  player.recipeBook.add('minecraft:' + String(rec.id).replace(/^minecraft:/, ''));
  expect(yields(), 'rule on, unlocked: planks');
  player.recipeBook.clear(); rule = 'false';
  expect(yields(), 'rule off: planks');
  expect(!Inv.isEmpty(R.craft(grid, 2, 2, null)), 'no player: planks');
  return fails;
}

console.log('limitedcraftingcheck — G17-GR1, doLimitedCrafting (2 breaks caught)');
const real = run((s) => s);
let bad = real.length;
real.forEach((m) => console.log('  FAIL ' + m));
const mutants = [
  (s) => s.replace('if (!on) return true;', 'return true;'),
  (s) => s.replace('return !!(player.recipeBook && player.recipeBook.has(id));', 'return false;'),
];
let caught = 0;
for (const m of mutants) {
  const f = run(m);
  if (f.length) { caught++; console.log('   ✓ mutant caught'); } else { bad++; console.log('  FAIL mutant survived'); }
}
console.log(` breaks caught ...... ${caught}`);
console.log(bad ? `FAIL (${bad})` : ' assertions passed .. 4');
process.exit(bad ? 1 : 0);
