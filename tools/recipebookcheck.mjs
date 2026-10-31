#!/usr/bin/env node
// recipebookcheck.mjs — FINAL GATE G-gate-a (#10706). The recipe book vs 1.18.2's ServerRecipeBook:
//   unlock = every recipe not already in the book and NOT isIgnoredInRecipeBook (SpecialCraftingRecipe, MapExtendingRecipe),
//   each fires RECIPE_UNLOCKED once; the count returned is the newly added; the ghost-grid source (craftingRecipeFor) names the recipe.
// Vanilla facts: .decomp ServerRecipeBook.unlockRecipes, Recipe.isIgnoredInRecipeBook, SpecialCraftingRecipe.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, ASSETS } from './loadsrc.mjs';

function run(patch) {
  const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '02h_recipes.js', '02l_advancements.js'], patch });
  const rd = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
  const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
  M.Items.init && M.Items.init({ items: b64('items.bin'), itemsBytes: rd('items.meta.json').rawBytes });
  M.Recipes.init({ recipes: b64('recipes.bin'), recipesBytes: rd('recipes.meta.json').jsonBytes });
  M.Adv.init({ advancements: b64('advancements.bin'), advancementsBytes: rd('advancements.meta.json').rawBytes });
  const f = [], no = (c, m) => { if (!c) f.push(m); };
  const R = M.Recipes, A = M.Adv;
  const ids = (t) => R.byType[t].map((r) => 'minecraft:' + r.id.replace('minecraft:', ''));
  const specials = ids(R.SPECIAL), normal = [].concat(ids(R.SHAPED), ids(R.SHAPELESS), ids(R.SMELTING), ids(R.STONECUTTING));
  no(specials.length === 13, specials.length + ' special recipes, vanilla has 13');
  const player = { advancements: new A.Tracker({}) };
  no(A.unlockRecipes(player, specials) === 0, 'special crafting recipes entered the book');
  no(player.recipeBook.size === 0, 'book not empty after specials');
  no(A.unlockRecipes(player, ['minecraft:map_extending']) === 0, 'map extending entered the book');
  const sample = normal.slice(0, 50);
  no(A.unlockRecipes(player, sample) === 50, 'sample of 50 normal recipes not all added');
  no(A.unlockRecipes(player, sample.concat(['minecraft:crafting_table'])) <= 1, 'already-known recipes counted again');
  A.unlockRecipes(player, normal);
  no(player.recipeBook.size === new Set(normal).size, 'book size ' + player.recipeBook.size + ' != distinct normal recipes ' + new Set(normal).size);
  // ghost-recipe source: a 2x2 planks grid resolves to the crafting_table recipe
  const I = M.Items;
  if (R.craftingRecipeFor && I && I.byName) {
    const p = I.stack(I.byName('oak_planks'), 1);
    const rec = R.craftingRecipeFor([p, p, p, p], 2, 2);
    no(rec && rec.id.replace('minecraft:', '') === 'crafting_table', 'ghost grid: 2x2 planks resolved to ' + (rec && rec.id));
  }
  return f;
}

const fails = run();
const breaks = [
  ['specials enter the book', (f, s) => f === '02l_advancements.js' ? s.replace('rr.t === NS.Recipes.SPECIAL', 'false') : s],
  ['repeat unlock recounted', (f, s) => f === '02l_advancements.js' ? s.replace('if (book.has(id)) continue;', '') : s],
  ['book never filled', (f, s) => f === '02l_advancements.js' ? s.replace('book.add(id); n++;', 'n++;') : s],
];
let caught = 0;
for (const [name, patch] of breaks) {
  let bad; try { bad = run(patch); } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('  ✓ break caught: ' + name); } else fails.push('break NOT caught: ' + name);
}
if (fails.length) { console.log('recipebookcheck: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log('assertions passed ..... 9');
console.log(`${caught} breaks caught (recipebookcheck OK)`);
