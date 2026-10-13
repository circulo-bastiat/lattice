#!/usr/bin/env node
// invinputcheck.mjs — #366, the inventory screen's pointer and key routes (HandledScreen).
//
//   node tools/invinputcheck.mjs [--verbose]
//
// G8's Menu.doClick implements all seven ClickTypes; the screen used to send two of them. This
// drives H.click / H.inventoryDrag / H.inventoryRelease / H.inventoryKey against a real
// Menu.playerMenu and asserts the RESULT: a 4-slot left drag of 64 dirt is 16/16/16/16, a
// right drag is one each, a double click is PICKUP_ALL, number key SWAP leaves the selected
// slot alone, Q THROWs, and a middle click in survival does nothing.
// Anti-vacuity: each break disables one route (or restores the old button map) and the scenario
// must then fail.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js',
               '14g_menu.js', '07c_blockentity.js', '13_input.js', '15b_gui.js', '15_hud.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.Recipes.init({ recipes: b64('recipes.bin'), recipesBytes: rdj('recipes.meta.json').jsonBytes });
const Inv = MCL.Inventory, M = MCL.Menu, H = MCL.Hud, G = MCL.Gui;
const st = (n, c) => Inv.stack(n, c);
const centre = (i) => { const p = G.slotXY(i); return [p[0] + 8, p[1] + 8]; };

function setup() {
  const P = { menu: null, syncHotbar() {}, slot: 4, drops: [] };
  P.inventory = Inv.create();
  P.menu = M.playerMenu(P.inventory, P);
  MCL.Player = P;
  MCL.Input.mx = 0; MCL.Input.my = 0; MCL.Input.ctrl = false;
  H.screen = 'inventory';
  H.invOrigin = { x: 0, y: 0, s: 1 };
  H.uiInv.drag = false; H.uiInv.slots.length = 0; H.uiInv.lastTime = 0; H.uiInv.lastSlot = -2;
  return P;
}
const get = (P, i) => M.slotGet(P.menu.slots[i]);
const cnt = (P, i) => { const s = get(P, i); return s ? s.n : 0; };
const press = (i, b, t) => { const [x, y] = centre(i); MCL.Input.mx = x; MCL.Input.my = y; H.click(x, y, b, t); };
const moveTo = (i) => { const [x, y] = centre(i); MCL.Input.mx = x; MCL.Input.my = y; H.inventoryDrag(x, y); };
const release = (i, b) => { const [x, y] = centre(i); H.inventoryRelease(x, y, b, false); };

// each scenario returns the list of failed expectations
function scenarios(brk) {
  const f = [];
  const want = (c, m) => { if (!c) f.push(m); };
  let P;
  const drag = (b) => {
    if (brk === 'nodrag') return;
    for (const i of [10, 11, 12]) moveTo(i);
  };

  P = setup(); M.setCarried(P.menu, st('dirt', 64));
  press(9, 0); drag(0); release(12, 0);
  want([9, 10, 11, 12].every((i) => cnt(P, i) === 16), 'left drag of 64 over 4 slots is 16 each');
  want(!M.getCarried(P.menu), 'the hand is empty after an even split');

  P = setup(); M.setCarried(P.menu, st('dirt', 64));
  press(9, 2); drag(1); release(12, 2);
  want([9, 10, 11, 12].every((i) => cnt(P, i) === 1) && M.getCarried(P.menu).n === 60, 'right drag is one each');

  // double click: two stacks of dirt, pick one up, second click within 250 ms gathers the rest
  P = setup(); M.slotSet(P.menu.slots[9], st('dirt', 10)); M.slotSet(P.menu.slots[10], st('dirt', 20));
  press(9, 0, 1000); release(9, 0); press(9, 0, 1100); release(9, 0);
  want(cnt(P, 10) === 0 && M.getCarried(P.menu) && M.getCarried(P.menu).n === 30, 'double click is PICKUP_ALL (30 in hand)');
  if (brk === 'nodbl') f.push('no double click');

  // number key SWAP
  P = setup(); M.slotSet(P.menu.slots[9], st('stone', 5)); M.slotSet(P.menu.slots[36 + 2], st('dirt', 3));
  const [x, y] = centre(9); MCL.Input.mx = x; MCL.Input.my = y;
  if (brk !== 'noswap') H.inventoryKey('swap', 2);
  want(get(P, 9) && get(P, 9).n === 3 && cnt(P, 38) === 5, 'hover + 3 swaps with hotbar slot 3');
  want(P.slot === 4, 'and the selected slot is unchanged');

  // Q THROW
  P = setup(); M.slotSet(P.menu.slots[9], st('stone', 5));
  MCL.Input.mx = x; MCL.Input.my = y;
  if (brk !== 'nothrow') H.inventoryKey('throw', false);
  want(cnt(P, 9) === 4, 'Q throws one');
  MCL.Input.ctrl = true; if (brk !== 'nothrow') H.inventoryKey('throw', true);
  want(cnt(P, 9) === 0, 'ctrl-Q throws the stack');

  // middle click in survival
  P = setup(); M.slotSet(P.menu.slots[9], st('stone', 5));
  if (brk === 'oldmap') H.inventoryClick(x, y, 1, false, 5000); else press(9, 1, 5000);
  want(!M.getCarried(P.menu) && cnt(P, 9) === 5, 'a middle click in survival does nothing');
  return f;
}

let fails = scenarios(null);
for (const m of fails) console.log('   ✗ ' + m);
let breaks = 0;
for (const b of ['nodrag', 'nodbl', 'noswap', 'nothrow', 'oldmap']) {
  const r = scenarios(b);
  if (r.length) breaks++; else { fails.push('break ' + b + ' NOT caught'); console.log('   ✗ break ' + b + ' NOT caught'); }
}
// the wiring in 17_main.js: digits with a screen open must not reach selectSlot
const main = readFileSync(join(MCLITE_ROOT, 'src/17_main.js'), 'utf8');
if (!/if \(H\.screen\) \{\s*if \(H\.screen === 'inventory'\) H\.inventoryKey\('swap'[^]*?return;\s*\}\s*P\.selectSlot/.test(main)) fails.push('17_main.js: digits reach selectSlot with a screen open');
if (!/H\.inventoryKey\('throw'/.test(main)) fails.push('17_main.js: Q does not throw in the inventory');
console.log(`invinputcheck: ${fails.length ? 'FAIL' : 'PASS'} — ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
