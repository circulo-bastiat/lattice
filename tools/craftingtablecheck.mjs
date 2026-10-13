#!/usr/bin/env node
// craftingtablecheck.mjs — PASS 17 JOB 1 (G19b), the crafting table screen (D-405), session 44.
//
//   node tools/craftingtablecheck.mjs [--verbose]
//
// ⚠ WHY THIS IS NOT craftcheck.mjs's JOB. `craftcheck.mjs` proves `Recipes.craft(grid, w, h)`
// itself — the matcher — against every recipe in the game, by calling it directly with an array.
// It never goes anywhere near a menu, a slot, or a click, and it never asked what happens to the
// grid's own contents once a result is TAKEN. Reading `Menu.playerMenu` and the old
// `Hud.refreshCraftResult` this session found the answer was: nothing. `m.grid` was set on the
// menu and never read again outside the recompute — the result slot had no `onTake` at all, so
// every survival recipe ever crafted through the player's own 2x2 screen was FREE, silently,
// since G9 shipped (D-405). This file proves the fix (`craftingTaken`, `14g_menu.js`) for BOTH
// grids it now guards — the player's persistent 2x2 and the crafting table's own fresh 3x3 —
// because a fix proven on only the new screen would leave the older, more-played bug unverified.
// §1-2 set the grid directly (`m.grid.set`) — the geometry/click-routing itself is §3's and
// `guicheck.mjs`'s job, not this file's — and drive every TAKE through a real `Menu.doClick`,
// which is the only path that can exercise `onTake` at all.
//
// ⚠ RUNS HEADLESS. `Hud.openCraftingTable`/`drawCrafting`/`craftingClick`/`close` touch no canvas
// and no DOM beyond `NS.Input.uiOpen`/`releaseLock`/`requestLock`, exactly like `chestcheck.mjs`
// and `enderchestcheck.mjs` before it. No browser has run this session either — nothing here
// claims the screen has been SEEN drawn correctly, only that its click machine and its one truly
// new mechanic (the result slot consuming the grid) behave.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js',
               '14g_menu.js', '07c_blockentity.js', '13_input.js', '15_hud.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.Recipes.init({ recipes: b64('recipes.bin'), recipesBytes: rdj('recipes.meta.json').jsonBytes });
MCL.BlockEntities.init();

const Inv = MCL.Inventory, M = MCL.Menu, H = MCL.Hud, S = MCL.States, R = MCL.Recipes;
const st = (n, c) => Inv.stack(n, c === undefined ? 1 : c);
const nameOf = (s) => (Inv.isEmpty(s) ? '' : MCL.Items.nameOf(s.i));

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { ok(c, m); if (c && VERBOSE) console.log('   ✓ ' + m.replace(/^anti-vacuity: /, '')); };
const say = (s) => { if (VERBOSE) console.log('   ' + s); };

const CT_STATE = S.stateOf('crafting_table');
const OTHER_STATE = S.stateOf('stone');

function fakeWorld(state) { return { getBlock: () => state }; }
function newPlayer() {
  var P = { menu: { inventory: Inv.create() } };
  MCL.Player = P;
  return P;
}

console.log('craftingtablecheck — PASS 17 JOB 1 (G19b), the crafting table screen (D-405)');

// ═══════════ 1. opening — a real crafting_table state, and nothing else ═══════════════════════
say('\n1. Hud.openCraftingTable — only over a real crafting table, and it is a FRESH menu every time');
{
  var P = newPlayer();
  MCL.World = fakeWorld(CT_STATE);
  ok(H.openCraftingTable(0, 0, 0) === true, 'opening over a real crafting_table state succeeds');
  ok(H.screen === 'crafting', 'H.screen is "crafting"');
  var m1 = H.craftingMenu;
  ok(!!m1 && m1.slots.length === 46, `the menu has 46 slots (1 result + 9 grid + 27 backpack + 9 hotbar), got ${m1 && m1.slots.length}`);
  H.close();
  ok(H.screen === null, 'closing clears H.screen');

  MCL.World = fakeWorld(OTHER_STATE);
  var P2 = newPlayer();
  ok(H.openCraftingTable(0, 0, 0) === false, 'opening over stone (not a crafting table) refuses');
  ok(H.screen === null, 'and opens no screen at all');

  MCL.World = fakeWorld(CT_STATE);
  var P3 = newPlayer();
  H.openCraftingTable(1, 1, 1);
  var mA = H.craftingMenu;
  H.close();
  H.openCraftingTable(1, 1, 1);
  var mB = H.craftingMenu;
  ok(mA !== mB, "two opens at the same position build two DIFFERENT menu objects — no per-position state, per Menu.craftingMenu's own header");
  H.close();
}

// ═══════════ 2. the 3x3 grid computes through the real matcher ════════════════════════════════
say('\n2. a grid filled by hand produces the real recipe result');
{
  var P = newPlayer();
  MCL.World = fakeWorld(CT_STATE);
  H.openCraftingTable(2, 2, 2);
  var m = H.craftingMenu;
  // four oak planks in the top-left 2x2 of the 3x3 grid (indices 0,1,3,4) is a crafting table
  [0, 1, 3, 4].forEach((gi) => m.grid.set(gi, st('oak_planks', 1)));
  H.refreshCraftingResult();
  var out = M.slotGet(m.slots[0]);
  ok(!Inv.isEmpty(out) && nameOf(out) === 'crafting_table', `4 oak planks in a 2x2 block of the 3x3 grid crafts a crafting table, got ${JSON.stringify(out)}`);
  H.close();
}

// ═══════════ 3. THE NEW MECHANIC: taking the result consumes the grid — D-405 ═════════════════
say('\n3. taking the result removes exactly one item from every occupied grid cell (D-405)');
{
  var P = newPlayer();
  MCL.World = fakeWorld(CT_STATE);
  H.openCraftingTable(3, 3, 3);
  var m = H.craftingMenu;
  // a stick: two planks stacked in one column — grid indices 0 and 3 of the 3x3 (menu slots 1, 4)
  m.grid.set(0, st('oak_planks', 1));
  m.grid.set(3, st('oak_planks', 1));
  H.refreshCraftingResult();
  ok(nameOf(M.slotGet(m.slots[0])) === 'stick', `the grid matches "stick", got ${JSON.stringify(M.slotGet(m.slots[0]))}`);
  var before0 = m.grid.get(0), before3 = m.grid.get(3);
  ok(before0 && before0.n === 1 && before3 && before3.n === 1, 'both grid cells hold exactly 1 plank before the take');

  M.doClick(m, 0, 0, M.PICKUP, {});          // TAKE the result — the real click path, menu slot 0
  var carried = M.getCarried(m);
  ok(!Inv.isEmpty(carried) && nameOf(carried) === 'stick', `the stick is now carried, got ${JSON.stringify(carried)}`);
  var after0 = m.grid.get(0), after3 = m.grid.get(3);
  okAv(Inv.isEmpty(after0) && Inv.isEmpty(after3), `BOTH grid cells are now empty — before the fix they would still read ${JSON.stringify(before0)}/${JSON.stringify(before3)}`);
  H.close();
}

// ═══════════ 3b. a grid cell holding more than one loses exactly one, not the whole stack ═════
say('\n3b. a grid cell stacked past 1 loses exactly one from itself, the rest stays put');
{
  var P = newPlayer();
  MCL.World = fakeWorld(CT_STATE);
  H.openCraftingTable(4, 4, 4);
  var m = H.craftingMenu;
  m.grid.set(0, st('oak_log', 5));           // FIVE logs stacked in one cell — one-log-in crafts planks
  H.refreshCraftingResult();
  ok(nameOf(M.slotGet(m.slots[0])) === 'oak_planks', `one oak log (however many are stacked with it) crafts oak_planks, got ${JSON.stringify(M.slotGet(m.slots[0]))}`);
  M.doClick(m, 0, 0, M.PICKUP, {});
  var after = m.grid.get(0);
  ok(after && after.n === 4, `the stack of 5 logs lost exactly ONE, not the whole stack — got ${JSON.stringify(after)}`);
  H.close();
}

// ═══════════ 3c. KW-5: a crafting-remainder ingredient leaves its own remainder, not nothing ═══
say('\n3c. taking a result made from a remainder item (cake, D-361\'s own Use.OWED gap) leaves the remainder behind');
{
  var P = newPlayer();
  MCL.World = fakeWorld(CT_STATE);
  H.openCraftingTable(3, 30, 3);
  var m = H.craftingMenu;
  // recipe "cake" off the real table (craftcheck's own ingredient ids 68/69/70/58): three
  // milk_bucket top row, sugar/egg/sugar middle, three wheat bottom -- read from R.ings, not
  // typed by hand, so a recipe-data change cannot silently stop testing what this section claims.
  var cake = R.byType[R.SHAPED].find(function (r) { return r.id === 'cake'; });
  ok(!!cake, 'the "cake" shaped recipe is in the table');
  var wanted = ['milk_bucket', 'milk_bucket', 'milk_bucket', 'sugar', 'egg', 'sugar', 'wheat', 'wheat', 'wheat'];
  for (var gi = 0; gi < 9; gi++) {
    ok(R.ings[cake.k[gi]].length === 1 && R.ings[cake.k[gi]][0] === wanted[gi],
      'cake grid cell ' + gi + ' wants exactly "' + wanted[gi] + '", the table says ' + JSON.stringify(R.ings[cake.k[gi]]));
    m.grid.set(gi, st(wanted[gi], 1));
  }
  H.refreshCraftingResult();
  ok(nameOf(M.slotGet(m.slots[0])) === 'cake', 'the filled grid crafts "cake", got ' + JSON.stringify(M.slotGet(m.slots[0])));

  M.doClick(m, 0, 0, M.PICKUP, {});          // TAKE the cake — the real click path
  okAv(nameOf(M.getCarried(m)) === 'cake', 'the cake is now carried');
  [0, 1, 2].forEach(function (gi) {
    var after = m.grid.get(gi);
    okAv(!Inv.isEmpty(after) && nameOf(after) === 'bucket' && after.n === 1,
      'grid cell ' + gi + ' (a milk_bucket) now holds one empty bucket instead of going empty, got ' + JSON.stringify(after));
  });
  [3, 4, 5, 6, 7, 8].forEach(function (gi) {
    var after = m.grid.get(gi);
    okAv(Inv.isEmpty(after), 'grid cell ' + gi + ' (sugar/egg/wheat, no remainder) is empty, got ' + JSON.stringify(after));
  });
  H.close();
}

// ═══════════ 4. anti-vacuity: a mismatched grid produces nothing, and taking nothing changes nothing ═══
say('\n4. anti-vacuity: break it, and it must be caught');
{
  var P = newPlayer();
  MCL.World = fakeWorld(CT_STATE);
  H.openCraftingTable(5, 5, 5);
  var m = H.craftingMenu;
  H.refreshCraftingResult();
  okAv(Inv.isEmpty(M.slotGet(m.slots[0])), 'an empty grid crafts nothing at all');

  m.grid.set(0, st('dirt', 1));              // one dirt, alone, in the grid
  H.refreshCraftingResult();
  okAv(Inv.isEmpty(M.slotGet(m.slots[0])), 'one dirt block alone in the 3x3 grid matches no recipe');
  var beforeDirt = m.grid.get(0);
  ok(beforeDirt && beforeDirt.n === 1, 'and it is still sitting in the grid, unconsumed, because there was never a result to take');
  H.close();
}

// ═══════════ 5. closing with items still in the grid returns them to the player, not the void ═══
say('\n5. closing the screen with unfinished ingredients still in the grid returns them');
{
  var P = newPlayer();
  MCL.World = fakeWorld(CT_STATE);
  H.openCraftingTable(6, 6, 6);
  var m = H.craftingMenu;
  m.grid.set(0, st('cobblestone', 1));       // one cobblestone left sitting in the grid
  ok(!Inv.isEmpty(m.grid.get(0)), 'the cobblestone is in the grid before close');
  H.close();
  var total = 0;
  for (var i = 0; i < Inv.SIZE; i++) {
    var s = Inv.getItem(P.menu.inventory, i);
    if (s && MCL.Items.nameOf(s.i) === 'cobblestone') total += s.n;
  }
  okAv(total === 1, `the cobblestone came back to the player's own inventory on close, found ${total}`);
}

// ═══════════ 6. THE OLDER BUG, SAME FIX: the player's own 2x2 now consumes too (D-405) ════════
say("\n6. the player's own 2x2 grid (Menu.playerMenu) is fixed by the SAME change");
{
  var P = newPlayer();
  P.menu = MCL.Menu.playerMenu(Inv.create(), P);
  // 2x2 grid is menu slots 1..4 / m.grid indices 0..3; two planks in one column crafts a stick
  P.menu.grid.set(0, st('oak_planks', 1));
  P.menu.grid.set(2, st('oak_planks', 1));
  var grid = []; for (var gi = 0; gi < 4; gi++) grid.push(P.menu.grid.get(gi));
  var res = R.craft(grid, 2, 2);
  P.menu.result.set(0, Inv.isEmpty(res) ? null : res);
  ok(nameOf(M.slotGet(P.menu.slots[0])) === 'stick', `the player's own 2x2 grid still matches "stick", got ${JSON.stringify(M.slotGet(P.menu.slots[0]))}`);
  M.doClick(P.menu, 0, 0, M.PICKUP, {});     // take it, through the real click path
  okAv(Inv.isEmpty(P.menu.grid.get(0)) && Inv.isEmpty(P.menu.grid.get(2)),
    "BOTH planks are gone from the player's own persistent 2x2 grid — this is D-405's actual bug, now closed here too");
}

console.log('\n================ craftingtablecheck ================');
console.log(' assertions passed .. ' + pass);
console.log(' failures ........... ' + fails.length);
if (fails.length) { fails.forEach((f) => console.log('   ✗ ' + f)); process.exitCode = 1; }
console.log('===========================================');
