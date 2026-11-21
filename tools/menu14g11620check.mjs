#!/usr/bin/env node
// menu14g11620check.mjs — #11620: proves 14g_menu.js BrewingStandScreen (gauges), BrewingStandScreenHandler, ForgingScreenHandler
// (Menu.smithingMenu), Property (the furnace/brewing data-slot counters), CraftingResultSlot, FurnaceFuelSlot, FurnaceOutputSlot,
// ShulkerBoxSlot. Behaviour through real clicks, reachability from Hud/Use, and SOURCE breaks (the real text is edited before it loads).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const A = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
const b64 = (f) => readFileSync(join(A, f)).toString('base64');
const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js', '14d_survival.js',
  '14g_menu.js', '14g2_invclasses.js', '07q_effects.js', '07z_potion.js', '07zzq_brewing.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js', '07f_redstone.js',
  '14b_physics.js', '07i_entitylist.js', '13_input.js', '15b_gui.js', '15_hud.js'];
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const MCL = loadEngine({ extra: EXTRA, dom: false, patch: patch ? (f, s) => (f === '14g_menu.js' ? patch(s) : s) : undefined });
  MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  MCL.Recipes.init({ recipes: b64('recipes.bin'), recipesBytes: rdj('recipes.meta.json').jsonBytes });
  MCL.BlockEntities.init();
  const Inv = MCL.Inventory, M = MCL.Menu, BE = MCL.BlockEntities, o = {};
  const stk = (n, c) => Inv.stack(n, c === undefined ? 1 : c);
  const nm = (s) => (Inv.isEmpty(s) ? '' : MCL.Items.nameOf(s.i));
  const P = () => ({ menu: { inventory: Inv.create() }, xpTotal: 0 });
  const click = (m, s, b, t, p) => M.doClick(m, s, b, t, p);
  // BrewingStandScreenHandler slots
  BE.clear(); let be = BE.create(0, 4, 0, 'brewing_stand'); let p = P();
  let m = M.brewingMenu(be, p.menu.inventory);
  const may = (i, n) => M.slotMayPlace(m.slots[i], stk(n));
  o.brSlots = m.slots.length === 41;
  o.brBottle = may(0, 'potion') && may(2, 'glass_bottle') && !may(1, 'stone') && M.slotMaxStack(m.slots[0], stk('glass_bottle')) === 1;
  o.brFuel = may(4, 'blaze_powder') && !may(4, 'coal') && !may(4, 'nether_wart');
  o.brIng = may(3, 'nether_wart') && !may(3, 'stone');
  Inv.setItem(p.menu.inventory, 0, stk('nether_wart', 8)); Inv.setItem(p.menu.inventory, 1, stk('potion', 1));
  click(m, 32, 0, M.QUICK_MOVE, p); click(m, 33, 0, M.QUICK_MOVE, p);
  o.brQuick = nm(be.items[3]) === 'nether_wart' && nm(be.items[0]) === 'potion';
  Inv.setItem(p.menu.inventory, 2, stk('blaze_powder', 10)); click(m, 34, 0, M.QUICK_MOVE, p);
  o.brBlaze = be.items[4] && be.items[4].n === 10 && nm(be.items[3]) === 'nether_wart';
  // BrewingStandScreen gauges (Property: fuel / brewTime data slots)
  const fw = (f) => { be.fuel = f; return M.brewingFuelWidth(be); };
  const ah = (t) => { be.brewTime = t; return M.brewingArrowHeight(be); };
  const bh = (t) => { be.brewTime = t; return M.brewingBubbleHeight(be); };
  o.brGauge = fw(0) === 0 && fw(10) === 9 && fw(20) === 18 && ah(400) === 0 && ah(200) === 14 && ah(1) === 27 && bh(0) === 0 && bh(2) === 24;
  // FurnaceFuelSlot / FurnaceOutputSlot + Property (lit / burn progress)
  BE.clear(); const fb = BE.create(1, 0, 0, 'furnace'); p = P(); m = M.furnaceMenu(fb, p.menu.inventory);
  const fmay = (i, n) => M.slotMayPlace(m.slots[i], stk(n));
  o.fuelSlot = fmay(1, 'coal') && fmay(1, 'bucket') && !fmay(1, 'stone') && M.slotMaxStack(m.slots[1], stk('bucket')) === 1 && M.slotMaxStack(m.slots[1], stk('coal')) === 64;
  o.outSlot = !fmay(2, 'iron_ingot') && !fmay(2, 'stone');
  fb.items[2] = stk('iron_ingot', 3); fb.recipesUsed = { x: { n: 10, xp: 1 } };
  click(m, 2, 0, M.PICKUP, p);
  o.outTake = nm(M.getCarried(m)) === 'iron_ingot' && p.xpTotal === 10 && Object.keys(fb.recipesUsed).length === 0;
  fb.burnTime = 100; fb.burnDuration = 200; fb.cookTime = 50; fb.cookTimeTotal = 200;
  o.furnaceProp = M.furnaceIsLit(fb) && M.furnaceLitProgress(fb) === 6 && M.furnaceBurnProgress(fb) === 6;
  fb.cookTime = 0; o.furnaceProp0 = M.furnaceBurnProgress(fb) === 0;
  // CraftingResultSlot
  p = P(); m = M.craftingMenu(p.menu.inventory, p);
  o.crNoPlace = !M.slotMayPlace(m.slots[0], stk('stone')) && m.slots[0].crafted === true && m.slots[0].noDrag === true;
  m.grid.set(0, stk('oak_planks', 2)); m.result.set(0, stk('stick', 4));
  click(m, 0, 0, M.PICKUP, p);
  o.crTake = nm(M.getCarried(m)) === 'stick' && M.getCarried(m).n === 4 && m.grid.get(0) && m.grid.get(0).n === 1;
  // ShulkerBoxSlot
  BE.clear(); const sb = BE.create(2, 0, 0, 'shulker_box'); p = P(); m = M.chestMenu(sb, p.menu.inventory, 3, true);
  o.shNo = !M.slotMayPlace(m.slots[0], stk('shulker_box')) && !M.slotMayPlace(m.slots[5], stk('red_shulker_box')) && M.slotMayPlace(m.slots[0], stk('stone'));
  o.shPlayerOk = M.slotMayPlace(m.slots[27], stk('shulker_box'));
  const ch = M.chestMenu(sb, p.menu.inventory, 3, false); o.chestOk = M.slotMayPlace(ch.slots[0], stk('shulker_box'));
  // ForgingScreenHandler (smithing)
  p = P(); m = M.smithingMenu(p.menu.inventory, {});
  o.fgShape = m.slots.length === 39 && !M.slotMayPlace(m.slots[2], stk('stone'));
  Inv.setItem(p.menu.inventory, 0, stk('stone', 4)); click(m, 3 + 27, 0, M.QUICK_MOVE, p);
  o.fgQuick = !Inv.isEmpty(M.slotGet(m.slots[0])) || !Inv.isEmpty(M.slotGet(m.slots[1])) || Inv.isEmpty(M.slotGet(m.slots[30]));
  m.input.set(0, stk('stone', 1)); m.input.set(1, null); m.refresh();
  o.fgNoResult = Inv.isEmpty(M.slotGet(m.slots[2]));
  // reachability from real entry points
  const rd = (f) => readFileSync(join(MCLITE_ROOT, 'src', f), 'utf8'), hud = rd('15_hud.js'), use = rd('14l_use.js');
  o.reachBrew = /M\.brewingMenu\(/.test(hud) && hud.includes('brewingFuelWidth') && /openBrewing/.test(use);
  o.reachFurn = /M\.furnaceMenu\(/.test(hud) && hud.includes('furnaceLitProgress') && /openFurnace/.test(use);
  o.reachCraft = /M\.craftingMenu\(/.test(hud) && /openCraftingTable/.test(use);
  o.reachShulker = /M\.chestMenu\(be, P\.menu\.inventory, 3, be\.type === 'shulker_box'\)/.test(hud);
  return o;
}
const A0 = trial(null);
for (const k of Object.keys(A0)) ok(A0[k], 'scenario ' + k);
const BR = [
  ['brBottleCap', 'cap: 1, mayPlace: Menu.brewingIsBottle', 'cap: 64, mayPlace: Menu.brewingIsBottle', ['brBottle']],
  ['brFuelPlace', 'Menu.slot(bc, 4, { mayPlace: Menu.brewingIsFuel })', 'Menu.slot(bc, 4, { mayPlace: Menu.brewingIsIngredient })', ['brFuel']],
  ['brIngPlace', 'Menu.slot(bc, 3, { mayPlace: Menu.brewingIsIngredient })', 'Menu.slot(bc, 3, {})', ['brIng']],
  ['brQuickBottle', 'Menu.moveItemStackTo(mm, live, 0, 3, false)', 'Menu.moveItemStackTo(mm, live, 5, 6, false)', ['brQuick']],
  ['brBlazeOdd', 'Menu.moveItemStackTo(mm, live, 4, 5, false) ||', 'Menu.moveItemStackTo(mm, live, 3, 4, false) ||', ['brBlaze']],
  ['brFuelWidth', 'Menu.brewingFuelWidth = function (be) {', 'Menu.brewingFuelWidth = function (be) { return 5;', ['brGauge']],
  ['brArrow', 'Menu.brewingArrowHeight = function (be) {', 'Menu.brewingArrowHeight = function (be) { return 0;', ['brGauge']],
  ['fuelBucket', 'return isBucketStack(st) ? 1 : 64;', 'return 64;', ['fuelSlot']],
  ['fuelPlace', 'return isFuel(st) || isBucketStack(st);', 'return true;', ['fuelSlot']],
  ['outPlace', "mayPlace: function () { return false; }, crafted: true,\n      onTake: function (pl) { Menu.furnaceAwardXp", "mayPlace: function () { return true; }, crafted: true,\n      onTake: function (pl) { Menu.furnaceAwardXp", ['outSlot']],
  ['outXp', 'onTake: function (pl) { Menu.furnaceAwardXp(be, pl); }', 'onTake: function (pl) { }', ['outTake']],
  ['litProgress', 'return ((be.burnTime | 0) * 13 / d) | 0;', 'return ((be.burnTime | 0) * 14 / d) | 0;', ['furnaceProp']],
  ['burnProgress', '((c * 24 / t) | 0)', '((c * 23 / t) | 0)', ['furnaceProp']],
  ['crPlace', 'slots.push(Menu.slot(result, 0, { mayPlace: never, noDrag: true, cap: 64, crafted: true,\n      onTake: function () { craftingTaken(grid, 9); } }));', 'slots.push(Menu.slot(result, 0, { noDrag: true, cap: 64, crafted: true,\n      onTake: function () { craftingTaken(grid, 9); } }));', ['crNoPlace']],
  ['crConsume', 'onTake: function () { craftingTaken(grid, 9); } }));', 'onTake: function () { }}));', ['crTake']],
  ['shNest', 'noNest ? { mayPlace: noShulker } : null', 'null', ['shNo']],
  ['shAll', 'noNest ? { mayPlace: noShulker } : null', '{ mayPlace: noShulker }', ['chestOk']],
  ['fgResultPlace', 'slots.push(Menu.slot(result, 0, { mayPlace: never, noDrag: true,\n      mayPickup', 'slots.push(Menu.slot(result, 0, { noDrag: true,\n      mayPickup', ['fgShape']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((s) => { if (s.includes(a)) { hit = true; return s.split(a).join(b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(`menu14g11620check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
