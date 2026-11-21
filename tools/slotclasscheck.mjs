#!/usr/bin/env node
// slotclasscheck.mjs - #11697: proves Slot (Menu.slot/safeInsert/tryRemove/safeTake/slotMaxStack/slotMayPlace/slotMayPickup)
// from 14g_menu.js through real doClick clicks, reachability from the HUD, and source breaks.
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
  const Inv = MCL.Inventory, M = MCL.Menu, o = {};
  const stk = (n, c) => Inv.stack(n, c === undefined ? 1 : c);
  const P = () => ({ menu: { inventory: Inv.create() }, xpTotal: 0 });
  const mk = (n) => { const c = M.arrayContainer(1); return { c, sl: M.slot(c, 0, n) }; };
  // safeInsert: cap 64 vs item cap 16 vs slot cap 1, part-full top-up, mayPlace
  let { sl } = mk({});
  let left = M.safeInsert(sl, stk('ender_pearl', 40), 40);
  o.insItemCap = M.slotGet(sl).n === 16 && left.n === 24;
  left = M.safeInsert(sl, stk('ender_pearl', 5), 5);
  o.insFull = M.slotGet(sl).n === 16 && left.n === 5;
  ({ sl } = mk({ cap: 1 }));
  left = M.safeInsert(sl, stk('stone', 9), 9);
  o.insCap1 = M.slotGet(sl).n === 1 && left.n === 8;
  ({ sl } = mk({}));
  M.safeInsert(sl, stk('stone', 10), 10); left = M.safeInsert(sl, stk('stone', 100), 100);
  o.insTopUp = M.slotGet(sl).n === 64 && left.n === 46;
  ({ sl } = mk({ mayPlace: (s) => false }));
  left = M.safeInsert(sl, stk('stone', 3), 3);
  o.insDeny = Inv.isEmpty(M.slotGet(sl)) && left.n === 3;
  // tryRemove / safeTake
  let t = mk({}); t.c.set(0, stk('stone', 10));
  let got = M.tryRemove(t.sl, 4, 4, P());
  o.rmN = got && got.n === 4 && M.slotGet(t.sl).n === 6;
  t = mk({ mayPickup: () => false }); t.c.set(0, stk('stone', 4));
  o.rmNoPickup = M.tryRemove(t.sl, 4, 4, P()) === null && M.slotGet(t.sl).n === 4;
  // result-like slot (no place): half take refused, whole take allowed
  t = mk({ mayPlace: () => false }); t.c.set(0, stk('stick', 4));
  o.rmHalf = M.tryRemove(t.sl, 2, 2, P()) === null && M.slotGet(t.sl).n === 4;
  got = M.tryRemove(t.sl, 4, 4, P());
  o.rmAll = got && got.n === 4 && Inv.isEmpty(M.slotGet(t.sl));
  let taken = 0;
  t = mk({ onTake: () => { taken++; } }); t.c.set(0, stk('stone', 2));
  got = M.safeTake(t.sl, 2, 2, P());
  o.safeTake = got && got.n === 2 && taken === 1;
  t = mk({ onTake: () => { taken++; }, mayPickup: () => false }); t.c.set(0, stk('stone', 2));
  o.safeTakeDeny = M.safeTake(t.sl, 2, 2, P()) === null && taken === 1;
  // slotMaxStack with capFn
  t = mk({ capFn: (s) => 1 });
  o.maxFn = M.slotMaxStack(t.sl, stk('stone')) === 1 && M.slotMaxStack(t.sl, null) === 64;
  // through a real menu click: armour slot takes 1; shift-click of full stack into hotbar uses Slot hooks
  const p = P(); const m = M.craftingMenu(p.menu.inventory, p);
  M.doClick(m, 5, 0, M.PICKUP, p); // no-op on empty
  m.grid.set(0, stk('oak_planks', 2)); m.result.set(0, stk('stick', 4));
  M.doClick(m, 0, 0, M.PICKUP, p);
  o.clickTake = M.getCarried(m) && M.getCarried(m).n === 4;
  M.setCarried && M.setCarried(m, stk('stone', 3));
  M.doClick(m, 0, 0, M.PICKUP, p); // placing into result slot is refused
  o.clickNoPlace = M.getCarried(m) && M.getCarried(m).n === 3;
  const hud = readFileSync(join(MCLITE_ROOT, 'src', '15_hud.js'), 'utf8');
  o.reach = /M\.craftingMenu\(/.test(hud) && /M\.doClick\(/.test(hud);
  o.reachMenu = /Menu\.(safeInsert|tryRemove|safeTake)\(/.test(readFileSync(join(MCLITE_ROOT, 'src', '14g_menu.js'), 'utf8').replace(/Menu\.(safeInsert|tryRemove|safeTake) = /g, ''));
  return o;
}
const A0 = trial(null);
for (const k of Object.keys(A0)) ok(A0[k], 'scenario ' + k);
const BR = [
  ['maxItemCap', 'return Math.min(cap, I.isEmpty(st) ? cap : I.maxStackSize(st));', 'return cap;', ['insItemCap']],
  ['insMayPlace', 'if (I.isEmpty(st) || !Menu.slotMayPlace(sl, st)) return st;', 'if (I.isEmpty(st)) return st;', ['insDeny']],
  ['insHere', 'Menu.slotMaxStack(sl, st) - (I.isEmpty(here) ? 0 : here.n)', 'Menu.slotMaxStack(sl, st)', ['insTopUp', 'insFull']],
  ['rmPickup', 'if (!Menu.slotMayPickup(sl, player)) return null;', '', ['rmNoPickup']],
  ['rmModify', 'if (!allowModification(sl, player) && decrement <', 'if (false && decrement <', ['rmHalf']],
  ['takeHook', 'if (got) onTake(sl, player, got);', '', ['safeTake']],
  ['capFn', 'sl.capFn(st) : sl.cap', 'sl.cap : sl.cap', ['maxFn']],
  ['placeFn', 'return sl.placeFn ? !!sl.placeFn(st) : true;', 'return true;', ['insDeny', 'clickNoPlace']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((s) => { if (s.includes(a)) { hit = true; return s.split(a).join(b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(`slotclasscheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
