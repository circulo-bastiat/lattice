#!/usr/bin/env node
// recipebook11627check.mjs — #11627: proves 15n_recipebook.js RecipeBookResults (paging), RecipeBookWidget (refreshResults/click/key/layout),
// RecipeResultCollection (craftable/fitting), ClientRecipeBook (buildCollections), RecipeBookGroup (TABS/groupOf), RecipeMatcher (assign/countCrafts),
// InputSlotFiller (fill/restore), RecipeGridAligner (alignRecipeToGrid). Behaviour + reachability from Hud + SOURCE breaks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, ASSETS, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const rd = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
function trial(patch) {
  const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js', '15n_recipebook.js'], patch: patch ? (f, s) => (f === '15n_recipebook.js' ? patch(s) : s) : undefined });
  M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: rd('items.meta.json').rawBytes });
  M.Recipes.init({ recipes: readFileSync(join(ASSETS, 'recipes.bin')).toString('base64'), recipesBytes: rd('recipes.meta.json').jsonBytes });
  const U = M.RecipeBookUI, R = M.Recipes, I = M.Inventory, o = {};
  const rec = (n) => R.byType[R.SHAPED].find((r) => r.id.replace('minecraft:', '') === n);
  const sh = rec('crafting_table'), stick = rec('stick');
  const mkGrid = (n) => { const a = new Array(n).fill(null); return { get: (i) => a[i], set: (i, s) => { a[i] = I.isEmpty(s) ? null : s; }, a }; };
  // RecipeBookResults: 20 per page, next/prev, label, reset
  const P = U.pages(), mk = (n) => Array.from({ length: n }, (_, i) => ({ i }));
  U.setResults(P, mk(45), true); U.next(P);
  o.pages = P.pageCount === 3 && P.page === 1 && U.pageItems(P).length === 20 && U.pageLabel(P) === '2/3';
  U.prev(P); U.prev(P); o.prevClamp = P.page === 0;
  U.setResults(P, mk(45), true); U.next(P); U.setResults(P, mk(45), true); o.resetPage = P.page === 0;
  // RecipeResultCollection: fitting / craftable
  const col = U.collection([sh], (r) => r.id), book = new Set([sh.id]), bk = { has: (id) => book.has(id) };
  U.initialize(col, bk); o.init = U.isInitialized(col);
  U.computeCraftables(col, () => true, 2, 2, bk); o.craft = U.hasCraftable(col) && U.hasFitting(col);
  U.computeCraftables(col, () => false, 2, 2, bk); o.noCraft = !U.hasCraftable(col) && U.hasFitting(col);
  U.computeCraftables(col, () => true, 2, 2, { has: () => false }); o.bookless = !U.hasFitting(col);
  U.computeCraftables(col, () => true, 1, 1, bk); o.noFit = !U.hasFitting(col) && !U.hasCraftable(col);
  // RecipeBookGroup + ClientRecipeBook
  o.tabs = U.TABS.join() === 'search,equipment,building,misc,redstone';
  const cb = U.buildCollections();
  o.groups = cb.search.length > 100 && cb.building.length > 10 && cb.equipment.length > 5 && cb.redstone.length > 3
    && cb.search.length === cb.equipment.length + cb.building.length + cb.misc.length + cb.redstone.length;
  o.groupOf = U.groupOf(stick) === 'misc' && U.groupOf(rec('oak_stairs')) === 'building' && U.groupOf(rec('diamond_sword')) === 'equipment';
  // RecipeMatcher
  const av = { [M.Items.of('oak_planks')]: 10 };
  o.canMake = U.canMake(av, sh) && !U.canMake({}, sh);
  o.countCrafts = U.countCrafts(av, sh) === 2 && U.countCrafts({ [M.Items.of('oak_planks')]: 64 }, stick) === 32;
  o.assignNeed = U.assign(av, sh, 3) === null && U.assign(av, sh, 2) !== null;
  // RecipeGridAligner
  const sl = (r, w, h) => U.alignRecipeToGrid(w, h, 0, r, r.k).map((e) => e.slot).join();
  o.align = sl(sh, 3, 3) === '1,2,4,5' && sl(stick, 3, 3) === '2,5' && sl(sh, 2, 2) === '1,2,3,4';
  // InputSlotFiller
  const inv = I.create(); inv.slots[0] = I.stack('oak_planks', 10); let g = mkGrid(9);
  o.fillOne = U.fill(inv, g, 3, 3, sh, false) === true && g.a[0].n === 1 && inv.slots[0].n === 6;
  inv.slots[0] = I.stack('oak_planks', 10); g = mkGrid(9);
  U.fill(inv, g, 3, 3, sh, true); o.fillAll = g.a[0].n === 2 && inv.slots[0].n === 2;
  const inv2 = I.create(); g = mkGrid(9);
  o.fillFail = U.fill(inv2, g, 3, 3, sh, false) === false && g.a.every((x) => !x);
  const inv3 = I.create(); inv3.slots[0] = I.stack('oak_planks', 4); g = mkGrid(9); g.set(0, I.stack('oak_planks', 1));
  U.fill(inv3, g, 3, 3, sh, false); o.fillReturns = g.a[0] && g.a[0].n === 1 && g.a[3] && g.a[3].n === 1 && inv3.slots[0].n === 1;
  // RecipeBookWidget: layout + click + key
  o.layout = U.layout(500, 300, 176, false, true).x === 177 + Math.floor((500 - 176 - 200) / 2) && U.layout(300, 300, 176, true, true).x === 62;
  M.Player = { recipeBook: new Set(['minecraft:crafting_table', 'minecraft:stick']) };
  const ctl = U.ctl('crafting'), inv4 = I.create(); inv4.slots[0] = I.stack('oak_planks', 10); g = mkGrid(9);
  ctl.toggle(); ctl.refresh(inv4, g, true);
  o.widgetList = ctl.pages.cols.length === 2 && ctl.visibleTabs().length >= 2;
  const L = U.layout(500, 300, 176, false, true), i0 = U.pageItems(ctl.pages).findIndex((c) => c.recipes[0] === sh), xy = U.resultXY(L, i0);
  o.widgetClick = ctl.click(xy[0] + 2, xy[1] + 2, false, inv4, g, 500, 300) === true && g.a[0] && g.a[0].n === 1;
  ctl.click(L.search[0] + 1, L.search[1] + 1, false, inv4, g, 500, 300); 'sti'.split('').forEach((ch) => ctl.key('Key', ch, inv4, g));
  o.widgetKey = ctl.search === 'sti' && ctl.pages.cols.length === 1;
  return o;
}
const A0 = trial(null);
for (const k of Object.keys(A0)) ok(A0[k], 'scenario ' + k);
const hud = readFileSync(join(MCLITE_ROOT, 'src', '15_hud.js'), 'utf8');
ok(/NS\.RecipeBookUI;\s*if \(!R/.test(hud) && /R\.ctl\(kind\)/.test(hud), 'reach: Hud builds the controller');
ok(/rb\.click\(/.test(hud) && /rb\.key\(/.test(hud) && /R\.layout\(/.test(hud) && /RecipeBookUI\.ghostItem\(/.test(hud), 'reach: Hud click/key/layout/ghost');
ok(/15n_recipebook\.js/.test(readFileSync(join(MCLITE_ROOT, 'build.mjs'), 'utf8')), 'reach: build ships the module');
const BR = [
  ['pageSize', 'RB.PAGE_SIZE = 20;', 'RB.PAGE_SIZE = 30;', ['pages']],
  ['prevGuard', 'RB.prevVisible = function (p) { return p.pageCount > 1 && p.page > 0; };', 'RB.prevVisible = function (p) { return true; };', ['prevClamp']],
  ['resetPage', 'if (p.pageCount <= p.page || reset) p.page = 0;', 'if (p.pageCount <= p.page) p.page = 0;', ['resetPage']],
  ['fitRule', 'return w >= rec.w && h >= rec.h;', 'return true;', ['noFit']],
  ['craftRule', 'if (f && canMake(r))', 'if (canMake(r))', ['noFit']],
  ['bookGate', 'RB.fits(r, w, h) && book.has(r.id)', 'RB.fits(r, w, h)', ['bookless']],
  ['tabOrder', "['search', 'equipment', 'building', 'misc', 'redstone']", "['search', 'building', 'equipment', 'misc', 'redstone']", ['tabs']],
  ['groupBuilding', "lang === 'itemGroup.buildingBlocks') return 'building'", "lang === 'itemGroup.buildingBlocks') return 'misc'", ['groupOf', 'groups']],
  ['searchAll', 'out.search.push(c);', '', ['groups']],
  ['matchN', 'left[k] >= n &&', 'left[k] >= 1 &&', ['assignNeed']],
  ['countCap', 'for (var n = 64; n >= 1; n--)', 'for (var n = 1; n >= 1; n--)', ['countCrafts', 'fillAll']],
  ['alignShift', 'if (s === resultSlot) s++;', '', ['align']],
  ['fillReturnGrid', 'if (I.add(inv, g) > 0) return restore(); grid.set(i, null);', 'grid.set(i, null);', ['fillReturns']],
  ['fillAmount', 'amount = all ? count : 1', 'amount = 1', ['fillAll']],
  ['layoutShift', 'open && !narrow ? 177', 'false ? 177', ['layout']],
  ['clickFill', 'if (craftable) RB.fill(inv, grid, c.gw, c.gh, rec, shift);', 'if (false) 0;', ['widgetClick']],
  ['keyType', 'c.search = RB.clampSearch(c.search + key)', 'void 0', ['widgetKey']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((s) => { if (s.includes(a)) { hit = true; return s.split(a).join(b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(`recipebook11627check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
