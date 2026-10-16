#!/usr/bin/env node
// brewingcheck.mjs — PASS 17 JOB 1 (G19b), the BREWING STAND screen (the last G19b unit).
//
//   node tools/brewingcheck.mjs [--verbose]
//
// The menu is `BrewingStandScreenHandler` (.decomp): three bottle slots that take ONE bottle each,
// an ingredient slot, a blaze-powder slot, then the player's backpack and hotbar. The brewing TICK
// is G23's — until it lands the counters stay put — so this check drives the counters by hand and
// asserts what the SCREEN does with them.
//
// Sections:
//   1. shape — 41 slots, the five ARE `be.items`, close/reopen loses nothing
//   2. what each slot accepts, and the one-bottle cap
//   3. shift-click routing, including vanilla's blaze-powder oddity
//   4. the gauge, arrow and bubbles are functions of the counters (three values each)
//   5. the block opens the screen; the owed list no longer names it
//   6. anti-vacuity: each rule is broken in turn and its assertion must fail

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js', '14d_survival.js',
               '14g_menu.js', '07q_effects.js', '07z_potion.js', '07zzq_brewing.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js', '07f_redstone.js',
               '14b_physics.js', '07i_entitylist.js', '13_input.js', '15b_gui.js', '15_hud.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.Recipes.init({ recipes: b64('recipes.bin'), recipesBytes: rdj('recipes.meta.json').jsonBytes });
MCL.BlockEntities.init();

const Inv = MCL.Inventory, M = MCL.Menu, BE = MCL.BlockEntities;
const stk = (n, c) => Inv.stack(n, c === undefined ? 1 : c);
const nameOf = (s) => (Inv.isEmpty(s) ? '' : MCL.Items.nameOf(s.i));

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c && VERBOSE) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };

console.log('brewingcheck — PASS 17 JOB 1 (G19b), the brewing stand screen');

const newPlayer = () => ({ menu: { inventory: Inv.create() }, xpTotal: 0 });
const fresh = () => { BE.clear(); return BE.create(0, 4, 0, 'brewing_stand'); };
const click = (m, slot, button, type, P) => M.doClick(m, slot, button, type, P);

// ═══════════ 1. shape ═══════════════════════════════════════════════════════════════════════
say('\n1. shape, and a close/reopen that loses nothing');
{
  const be = fresh(); const P = newPlayer();
  ok(be.items.length === 5 && be.brewTime === 0 && be.fuel === 0, 'a fresh brewing stand entity has 5 slots and both counters at 0');
  let m = M.brewingMenu(be, P.menu.inventory);
  ok(m.slots.length === 41, `a brewing menu has 41 slots, got ${m.slots.length}`);
  P.menu.inventory && Inv.add(P.menu.inventory, stk('blaze_powder', 5));
  // put a blaze powder in through a real click sequence: pick it up from the hotbar, click slot 4
  const hot = 32;                                     // hotbar slot 0 is menu slot 32
  ok(nameOf(M.slotGet(m.slots[hot])) === 'blaze_powder', 'the player\'s hotbar shows through the menu at 32..40');
  click(m, hot, 0, M.PICKUP, P);
  click(m, 4, 0, M.PICKUP, P);
  ok(be.items[4] && nameOf(be.items[4]) === 'blaze_powder' && be.items[4].n === 5, 'a click sequence puts blaze powder in the fuel slot of the ENTITY');
  m = M.brewingMenu(be, P.menu.inventory);
  ok(nameOf(M.slotGet(m.slots[4])) === 'blaze_powder', 'reopening over the same entity finds it (the screen edits no copy)');
}

// ═══════════ 2. acceptance ══════════════════════════════════════════════════════════════════
say('\n2. what each slot accepts');
{
  const be = fresh(); const P = newPlayer(); const m = M.brewingMenu(be, P.menu.inventory);
  const may = (i, n) => M.slotMayPlace(m.slots[i], stk(n));
  for (const b of ['potion', 'splash_potion', 'lingering_potion', 'glass_bottle']) ok(may(0, b) && may(2, b), `a bottle slot takes ${b}`);
  ok(!may(1, 'water_bucket') && !may(1, 'stone') && !may(0, 'nether_wart'), 'a bottle slot refuses everything else');
  ok(may(4, 'blaze_powder') && !may(4, 'nether_wart') && !may(4, 'coal'), 'the fuel slot takes blaze powder only');
  for (const n of M.BREW_INGREDIENTS) ok(may(3, n), `the ingredient slot takes ${n}`);
  ok(M.BREW_INGREDIENTS.length === 17, 'seventeen ingredients, the registry\'s count');
  ok(!may(3, 'stone') && !may(3, 'glass_bottle') && !may(3, 'coal'), 'the ingredient slot refuses non-ingredients');
  ok(M.slotMaxStack(m.slots[0], stk('potion')) === 1, 'a bottle slot holds ONE');
  ok(M.slotMaxStack(m.slots[3], stk('nether_wart')) === 64 && M.slotMaxStack(m.slots[4], stk('blaze_powder')) === 64, 'ingredient and fuel slots hold a stack');
  // a stack of glass bottles clicked onto a bottle slot leaves the rest in hand
  Inv.add(P.menu.inventory, stk('glass_bottle', 3));
  click(m, 32, 0, M.PICKUP, P); click(m, 1, 0, M.PICKUP, P);
  ok(be.items[1] && be.items[1].n === 1 && M.getCarried(m) && M.getCarried(m).n === 2, 'three bottles onto one bottle slot: one goes in, two stay in hand');
}

// ═══════════ 3. shift-click ═════════════════════════════════════════════════════════════════
say('\n3. shift-click routing');
{
  const be = fresh(); const P = newPlayer(); const m = M.brewingMenu(be, P.menu.inventory);
  const I = P.menu.inventory;
  Inv.setItem(I, 0, stk('nether_wart', 8));           // -> ingredient slot
  Inv.setItem(I, 1, stk('potion', 1));                // -> first free bottle slot
  Inv.setItem(I, 2, stk('potion', 1));
  Inv.setItem(I, 3, stk('stone', 4));                 // hotbar -> backpack
  Inv.setItem(I, 9, stk('cobblestone', 4));           // backpack -> hotbar
  click(m, 32, 0, M.QUICK_MOVE, P);
  ok(nameOf(be.items[3]) === 'nether_wart' && be.items[3].n === 8, 'shift-clicking nether wart fills the ingredient slot');
  click(m, 33, 0, M.QUICK_MOVE, P); click(m, 34, 0, M.QUICK_MOVE, P);
  ok(nameOf(be.items[0]) === 'potion' && nameOf(be.items[1]) === 'potion' && !be.items[2], 'two potions take bottle slots 0 and 1 in order');
  const has = (lo, hi, n) => { for (let k = lo; k < hi; k++) if (nameOf(M.slotGet(m.slots[k])) === n) return true; return false; };
  click(m, 35, 0, M.QUICK_MOVE, P);
  ok(Inv.isEmpty(M.slotGet(m.slots[35])) && has(5, 32, 'stone'), 'a non-brewing hotbar stack goes to the backpack');
  click(m, 5, 0, M.QUICK_MOVE, P);
  ok(Inv.isEmpty(M.slotGet(m.slots[5])) && has(32, 41, 'cobblestone'), 'a non-brewing backpack stack goes to the hotbar');
  // out of the stand: shift-click a bottle back into the player
  click(m, 0, 0, M.QUICK_MOVE, P);
  ok(!be.items[0], 'shift-clicking a bottle out empties the slot');
  ok([...Array(41)].some((_, k) => k >= 5 && nameOf(M.slotGet(m.slots[k])) === 'potion'), 'and the potion is in the player\'s inventory');

  // vanilla's blaze-powder oddity: fuel slot first; a full fuel slot sends the powder to the INGREDIENT slot
  const be2 = fresh(); const P2 = newPlayer(); const m2 = M.brewingMenu(be2, P2.menu.inventory);
  Inv.setItem(P2.menu.inventory, 0, stk('blaze_powder', 10));
  click(m2, 32, 0, M.QUICK_MOVE, P2);
  ok(be2.items[4] && be2.items[4].n === 10 && !be2.items[3], 'blaze powder goes to the FUEL slot first, not the ingredient slot');
  Inv.setItem(P2.menu.inventory, 1, stk('blaze_powder', 64));
  be2.items[4] = stk('blaze_powder', 64);
  click(m2, 33, 0, M.QUICK_MOVE, P2);
  ok(be2.items[3] && nameOf(be2.items[3]) === 'blaze_powder', 'with the fuel slot full, blaze powder falls through to the ingredient slot (it is one)');
}

// ═══════════ 4. the gauge, arrow and bubbles ═════════════════════════════════════════════════
say('\n4. the counters');
{
  const be = fresh();
  const fw = (f) => { be.fuel = f; return M.brewingFuelWidth(be); };
  ok(fw(0) === 0 && fw(1) === 1 && fw(10) === 9 && fw(20) === 18, `fuel width at 0/1/10/20 is 0/1/9/18, got ${[0, 1, 10, 20].map(fw)}`);
  const ah = (t) => { be.brewTime = t; return M.brewingArrowHeight(be); };
  ok(ah(0) === 0 && ah(400) === 0 && ah(200) === 14 && ah(1) === 27 && ah(399) === 0, `arrow height at 0/400/200/1/399 is 0/0/14/27/0, got ${[0, 400, 200, 1, 399].map(ah)}`);
  const bh = (t) => { be.brewTime = t; return M.brewingBubbleHeight(be); };
  ok(bh(0) === 0 && bh(400) === 29 * 0 + M.BREW_BUBBLES[200 % 7] && bh(2) === 24 && bh(12) === 0, `bubbles: 0 → 0; 400 → table[${200 % 7}]; 2 → 24; 12 → 0, got ${[0, 400, 2, 12].map(bh)}`);
  okAv(fw(10) !== fw(20) && fw(20) !== fw(0), 'the gauge is not a constant');
  okAv(ah(100) !== ah(300), 'the arrow is not a constant');
  okAv(bh(2) !== bh(4), 'the bubbles change with the counter');
}

// ═══════════ 5. the block, and the owed list ═════════════════════════════════════════════════
say('\n5. wiring');
{
  const src = readFileSync(join(MCLITE_ROOT, 'src/14l_use.js'), 'utf8');
  ok(/beTypeHere === 'brewing_stand'/.test(src) && /openBrewing/.test(src), 'Use routes a brewing_stand block entity to Hud.openBrewing');
  ok(typeof MCL.Hud.openBrewing === 'function' && typeof MCL.Hud.drawBrewing === 'function' && typeof MCL.Hud.brewingClick === 'function', 'the Hud has open/draw/click for it');
  const be = fresh(); const P = newPlayer(); MCL.Player = P;
  ok(MCL.Hud.openBrewing(0, 4, 0) === true && MCL.Hud.screen === 'brewing', 'Hud.openBrewing opens the screen over the entity');
  MCL.Hud.close();
  ok(MCL.Hud.screen === null && MCL.Hud.brewingMenu === null, 'closing lets go of the menu');
  okAv(MCL.Hud.openBrewing(9, 9, 9) === false, 'a cell with no brewing stand refuses to open');
  const own = BE.create(0, 4, 0, 'furnace');
  okAv(MCL.Hud.openBrewing(0, 4, 0) === false && own.type === 'furnace', 'a furnace at the cell is not a brewing stand');
}

// ═══════════ 6. anti-vacuity: break the data, the check must notice ═════════════════════════
say('\n6. breaks');
{
  const gaugeOk = () => { const be = fresh(); const fw = (f) => { be.fuel = f; return M.brewingFuelWidth(be); };
    return fw(0) === 0 && fw(10) === 9 && fw(20) === 18; };
  const arrowOk = () => { const be = fresh(); const ah = (t) => { be.brewTime = t; return M.brewingArrowHeight(be); };
    return ah(0) === 0 && ah(200) === 14 && ah(1) === 27; };
  const copyOk = () => { const be = fresh(); const P = newPlayer(); Inv.setItem(P.menu.inventory, 0, stk('blaze_powder', 5));
    const m = M.brewingMenu(be, P.menu.inventory); click(m, 32, 0, M.QUICK_MOVE, P);
    return !!be.items[4] && be.items[4].n === 5; };
  const fuelOk = () => { const be = fresh(); const m = M.brewingMenu(be, Inv.create());
    return M.slotMayPlace(m.slots[4], stk('blaze_powder')) && !M.slotMayPlace(m.slots[4], stk('coal')); };
  const capOk = () => { const be = fresh(); const m = M.brewingMenu(be, Inv.create()); return M.slotMaxStack(m.slots[0], stk('potion')) === 1; };
  const ingOk = () => { const be = fresh(); const m = M.brewingMenu(be, Inv.create());
    return M.BREW_INGREDIENTS.every((n) => M.slotMayPlace(m.slots[3], stk(n))); };
  const breakIt = (label, good, brk) => {
    const clean = good(); breaks++; ok(clean, `${label}: the assertion passes on clean data`);
    let broke; try { broke = brk(); } catch (e) { broke = () => 0; }
    let r; try { r = good(); } finally { broke(); }
    ok(!r, `${label}: the assertion FAILS once the data is broken`);
    if (!r) console.log(`   ✓ break caught: ${label}`);
  };
  const save = (o, k) => { const v = o[k]; return () => { o[k] = v; }; };
  breakIt('constant fuel counter', gaugeOk, () => { const u = save(M, 'brewingFuelWidth'); M.brewingFuelWidth = () => 5; return u; });
  breakIt('constant arrow', arrowOk, () => { const u = save(M, 'brewingArrowHeight'); M.brewingArrowHeight = () => 0; return u; });
  breakIt('edit a copy', copyOk, () => { const u = save(M, 'brewingMenu'); const f = M.brewingMenu;
    M.brewingMenu = (be, inv) => f(Object.assign({}, be, { items: be.items.slice() }), inv); return u; });
  breakIt('fuel slot takes anything', fuelOk, () => { const u = save(M, 'slotMayPlace'); M.slotMayPlace = () => true; return u; });
  breakIt('bottle slot holds a stack', capOk, () => { const u = save(M, 'slotMaxStack'); M.slotMaxStack = () => 64; return u; });
  breakIt('an ingredient dropped', ingOk, () => { const u = save(M, 'slotMayPlace'); const f = M.slotMayPlace;
    M.slotMayPlace = (sl, st) => (nameOf(st) === 'nether_wart' ? false : f(sl, st)); return u; });
}

console.log('\n============== brewingcheck ===============');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
console.log('===========================================');
if (fails.length) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
