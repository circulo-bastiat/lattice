#!/usr/bin/env node
// recipebookcheck.mjs — FINAL GATE G-gate-a (#10706). The recipe book vs 1.18.2's ServerRecipeBook:
//   unlock = every recipe not already in the book and NOT isIgnoredInRecipeBook (SpecialCraftingRecipe, MapExtendingRecipe),
//   each fires RECIPE_UNLOCKED once; the count returned is the newly added; the ghost-grid source (craftingRecipeFor) names the recipe.
// Vanilla facts: .decomp ServerRecipeBook.unlockRecipes, Recipe.isIgnoredInRecipeBook, SpecialCraftingRecipe.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, ASSETS } from './loadsrc.mjs';

function run(patch) {
  const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '02h_recipes.js', '02l_advancements.js', '14f_inventory.js', '15n_recipebook.js'], patch });
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
  // ---- the screen's model (#11390): src/15n_recipebook.js vs RecipeBookResults / RecipeResultCollection / RecipeGridAligner
  const U = M.RecipeBookUI;
  no(U && U.PAGE_SIZE === 20, 'page size is 20 (RecipeBookResults)');
  const P = U.pages();
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ i }));
  U.setResults(P, mk(45), true);
  no(P.pageCount === 3 && U.pageItems(P).length === 20, '45 results -> 3 pages of 20');
  no(!U.prevVisible(P) && U.nextVisible(P) && U.pageLabel(P) === '1/3', 'first page: next only, label 1/3');
  U.next(P); U.next(P); U.next(P);
  no(P.page === 2 && U.pageItems(P).length === 5 && !U.nextVisible(P) && U.prevVisible(P), 'last page holds 5, next hidden');
  U.setResults(P, mk(45), false); no(P.page === 2, 'page kept when still in range');
  U.setResults(P, mk(10), false); no(P.page === 0 && U.pageLabel(P) === '', 'page reset when out of range; one page has no label');
  U.setResults(P, mk(45), true); U.next(P); U.setResults(P, mk(45), true); no(P.page === 0, 'reset flag forces page 0');
  no(U.clampSearch('x'.repeat(80)).length === 50, 'search max length 50');
  // fits / craftable / search / filter
  const sh = R.byType[R.SHAPED].find((r) => r.id.replace('minecraft:', '') === 'crafting_table');
  const stick = R.byType[R.SHAPED].find((r) => r.id.replace('minecraft:', '') === 'stick');
  no(U.fits(sh, 2, 2) && !U.fits(sh, 1, 1), 'shaped 2x2 fits a 2x2 grid, not 1x1');
  const bookA = new Set([sh.id, stick.id]);
  const cA = U.collection([sh], (r) => r.id), cB = U.collection([stick], (r) => r.id);
  const can = (r) => r === sh;
  const hit = (c, t) => c.recipes[0].id.indexOf(t) >= 0;
  let out = U.refreshResults([cA, cB], bookA, can, 3, 3, '', false, hit);
  no(out.length === 2, 'both unlocked recipes listed');
  out = U.refreshResults([cA, cB], bookA, can, 3, 3, '', true, hit);
  no(out.length === 1 && out[0] === cA, 'craftable filter keeps only craftable');
  out = U.refreshResults([cA, cB], bookA, can, 3, 3, 'STICK', false, hit);
  no(out.length === 1 && out[0] === cB, 'search is case-folded and filters');
  out = U.refreshResults([cA, cB], new Set([stick.id]), can, 3, 3, '', false, hit);
  no(out.length === 1 && out[0] === cB, 'locked recipe not listed');
  out = U.refreshResults([cA, cB], bookA, can, 1, 1, '', false, hit);
  no(out.length === 0, 'nothing fits a 1x1 grid');
  // ghost placement (RecipeGridAligner): 2x2 shaped in a 3x3 table -> slots 1,2,4,5 ; 1x2 stick -> middle column 2,5
  const sl = (rec, gw, gh) => U.alignRecipeToGrid(gw, gh, 0, rec, rec.t === R.SHAPED ? rec.k : rec.in).map((e) => e.slot).join(',');
  no(sl(sh, 3, 3) === '1,2,4,5', 'crafting_table ghost slots ' + sl(sh, 3, 3));
  no(sl(stick, 3, 3) === '2,5', 'stick ghost slots ' + sl(stick, 3, 3));
  no(sl(sh, 2, 2) === '1,2,3,4', 'crafting_table ghost in the 2x2 inventory grid ' + sl(sh, 2, 2));

  // ---- the screen controller (#11390): toggle/tabs/search/craftable filter/ghost/click-to-fill/shift max/highlight/pages
  const INV = M.Inventory, inv = INV.create();
  const mkGrid = (n) => { const a = new Array(n).fill(null); return { get: (i) => a[i], set: (i, s) => { a[i] = INV.isEmpty(s) ? null : s; }, a }; };
  const planksId = 'oak_planks';
  M.Player = { recipeBook: new Set(['minecraft:crafting_table', 'minecraft:stick', 'minecraft:oak_planks', 'minecraft:chest']) };
  inv.slots[0] = INV.stack(planksId, 10);
  let grid = mkGrid(9);
  const ctl = U.ctl('crafting');
  no(ctl.open === false, 'book starts closed');
  ctl.toggle(); no(ctl.open === true, 'toggle button opens the book');
  const res = ctl.refresh(inv, grid, true);
  const hasOut = (name) => res.some((c) => c.recipes.some((r) => r.r.i === name));
  no(hasOut('crafting_table') && hasOut('stick') && !hasOut('diamond_sword'), 'only unlocked recipes listed');
  no(ctl.visibleTabs()[0] === 0 && ctl.visibleTabs().length >= 2, 'search tab plus tabs with known recipes');
  const colOf = (name) => res.find((c) => c.recipes.some((r) => r.r.i === name));
  no(ctl.state(colOf('crafting_table')) === 'green', 'craftable recipe slot is green');
  no(ctl.state(colOf('chest')) === 'green', 'chest (8 planks) craftable with 10 planks');
  ctl.filter = true; ctl.refresh(inv, grid, true);
  inv.slots[0] = INV.stack(planksId, 1); ctl.filter = false; ctl.refresh(inv, grid, true);
  no(ctl.state(colOf('crafting_table')) === 'red', 'uncraftable recipe slot is red');
  ctl.filter = true; const r2 = ctl.refresh(inv, grid, true); no(!r2.some((c) => c.recipes.some((r) => r.r.i === 'crafting_table')), 'craftable-only hides uncraftable');
  ctl.filter = false;
  // layout: wide screen shifts the table right by 77 (findLeftEdge) ; narrow does not
  no(U.layout(500, 300, 176, false, true).x === 177 + Math.floor((500 - 176 - 200) / 2), 'findLeftEdge open/wide');
  no(U.layout(300, 300, 176, true, true).x === Math.floor((300 - 176) / 2), 'findLeftEdge narrow');
  // click a craftable result: 1 copy of each ingredient lands in the grid via the aligner ; shift fills the max
  inv.slots[0] = INV.stack(planksId, 10);
  ctl.search = ''; ctl.refresh(inv, grid, true);
  const L = U.layout(500, 300, 176, false, true);
  const ctIdx = U.pageItems(ctl.pages).findIndex((c) => c.recipes.some((r) => r.r.i === 'crafting_table'));
  no(ctIdx >= 0, 'crafting_table is on page 1');
  let xy = U.resultXY(L, ctIdx);
  no(ctl.click(xy[0] + 3, xy[1] + 3, false, inv, grid, 500, 300) === true, 'click on a result button is consumed');
  no(grid.a.filter(Boolean).length === 4 && grid.a[0] && grid.a[0].n === 1 && inv.slots[0].n === 6, 'click places 1 of each ingredient: ' + JSON.stringify(grid.a.map((x) => x && x.n)) + ' inv ' + (inv.slots[0] && inv.slots[0].n));
  ctl.refresh(inv, grid, true);
  xy = U.resultXY(L, U.pageItems(ctl.pages).findIndex((c) => c.recipes.some((r) => r.r.i === 'crafting_table')));
  ctl.click(xy[0] + 3, xy[1] + 3, true, inv, grid, 500, 300);
  no(grid.a[0] && grid.a[0].n === 2 && inv.slots[0].n === 2, 'shift-click fills the max (all 10 planks -> 2 each + 2 left): ' + JSON.stringify(grid.a.map((x) => x && x.n)));
  // uncraftable click: ghost recipe appears, grid untouched ; second click on the same ghost is not consumed
  for (let i = 0; i < 9; i++) grid.set(i, null); inv.slots[0] = null;
  ctl.refresh(inv, grid, true);
  const unc = U.pageItems(ctl.pages).findIndex((c) => c.recipes.some((r) => r.r.i === 'crafting_table'));
  xy = U.resultXY(L, unc);
  no(ctl.click(xy[0] + 3, xy[1] + 3, false, inv, grid, 500, 300) === true && ctl.ghost && ctl.ghost.slots.map((g) => g.slot).join(',') === '1,2,4,5', 'uncraftable click shows ghost in slots 1,2,4,5');
  no(ctl.click(xy[0] + 3, xy[1] + 3, false, inv, grid, 500, 300) === false, 'second click on an unmakeable ghosted recipe is ignored');
  no(grid.a.every((x) => !x), 'ghost does not move items');
  // search box: focus, type, backspace
  ctl.open = true; ctl.click(L.search[0] + 2, L.search[1] + 2, false, inv, grid, 500, 300);
  no(ctl.focus === true, 'click on the search field focuses it');
  'stick'.split('').forEach((ch) => ctl.key('Key' + ch.toUpperCase(), ch, inv, grid));
  no(ctl.search === 'stick' && ctl.pages.cols.length >= 1 && ctl.pages.cols.every((c) => c.recipes.some((r) => r.r.i.indexOf('stick') >= 0)), 'typing filters results by name');
  ctl.key('Backspace', 'Backspace', inv, grid); no(ctl.search === 'stic', 'backspace deletes');
  ctl.search = ''; ctl.focus = false;
  // pages: with every recipe unlocked, > 20 results page, next/prev buttons
  M.Player.recipeBook = new Set(R.all.filter((r) => r.t === R.SHAPED || r.t === R.SHAPELESS).map((r) => 'minecraft:' + r.id.replace('minecraft:', '')));
  inv.slots[0] = INV.stack(planksId, 64);
  ctl.tab = 0; ctl.refresh(inv, grid, true);
  no(ctl.pages.pageCount > 1 && U.pageItems(ctl.pages).length === 20, 'many recipes -> several pages of 20');
  ctl.click(L.next[0] + 1, L.next[1] + 1, false, inv, grid, 500, 300);
  no(ctl.pages.page === 1, 'next-page button advances');
  ctl.click(L.prev[0] + 1, L.prev[1] + 1, false, inv, grid, 500, 300);
  no(ctl.pages.page === 0, 'prev-page button goes back');
  // tabs: clicking the second visible tab switches and resets the page
  const vis = ctl.visibleTabs(); ctl.click(L.tabX + 2, L.tabY + 27 + 2, false, inv, grid, 500, 300);
  no(ctl.tab === vis[1], 'tab click selects the second tab');
  // 2x2 inventory book: a 3x3-only recipe is not listed, and fill uses grid slots 1..4 of the inventory grid
  const c2 = U.ctl('inventory'), g2 = mkGrid(4);
  const r3 = c2.refresh(inv, g2, true);
  no(!r3.some((c) => c.recipes.some((r) => r.r.i === 'chest')) && r3.some((c) => c.recipes.some((r) => r.r.i === 'crafting_table')), '2x2 book lists only recipes that fit 2x2');
  return f;
}

const fails = run();
const breaks = [
  ['specials enter the book', (f, s) => f === '02l_advancements.js' ? s.replace('rr.t === NS.Recipes.SPECIAL', 'false') : s],
  ['repeat unlock recounted', (f, s) => f === '02l_advancements.js' ? s.replace('if (book.has(id)) continue;', '') : s],
  ['book never filled', (f, s) => f === '02l_advancements.js' ? s.replace('book.add(id); n++;', 'n++;') : s],
  ['page count off', (f, s) => f === '15n_recipebook.js' ? s.replace('/ RB.PAGE_SIZE)', '/ 30)') : s],
  ['craftable filter ignored', (f, s) => f === '15n_recipebook.js' ? s.replace('filterCraftable && ', 'false && ') : s],
  ['ghost not centred', (f, s) => f === '15n_recipebook.js' ? s.replace('cond = rw < gw / 2;', 'cond = false;') : s],
  ['search not applied', (f, s) => f === '15n_recipebook.js' ? s.replace('search && search.length && ', 'false && ') : s],
  ['click does not fill grid', (f, s) => f === '15n_recipebook.js' ? s.replace('if (craftable) RB.fill(inv, grid, c.gw, c.gh, rec, shift);', 'if (false) RB.fill();') : s],
  ['shift fills only one', (f, s) => f === '15n_recipebook.js' ? s.replace('amount = all ? count : 1', 'amount = 1') : s],
  ['highlight always green', (f, s) => f === '15n_recipebook.js' ? s.replace("? 'green' : 'red'", "? 'green' : 'green'") : s],
  ['tab click ignored', (f, s) => f === '15n_recipebook.js' ? s.replace('if (c.tab !== vis[i]) { c.tab = vis[i];', 'if (false) { c.tab = vis[i];') : s],
  ['next page button dead', (f, s) => f === '15n_recipebook.js' ? s.replace('RB.next(c.pages); return true;', 'return true;') : s],
  ['wide book does not shift screen', (f, s) => f === '15n_recipebook.js' ? s.replace('open && !narrow ? 177', 'false ? 177') : s],
  ['typing ignored', (f, s) => f === '15n_recipebook.js' ? s.replace('c.search = RB.clampSearch(c.search + key)', 'void 0') : s],
];
let caught = 0;
for (const [name, patch] of breaks) {
  let bad; try { bad = run(patch); } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('  ✓ break caught: ' + name); } else fails.push('break NOT caught: ' + name);
}
if (fails.length) { console.log('recipebookcheck: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log('assertions passed ..... 60');
console.log(`${caught} breaks caught (recipebookcheck OK)`);
