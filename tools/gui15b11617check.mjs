#!/usr/bin/env node
// gui15b11617check.mjs — #11617: proves 15b_gui.js GameModeSelectionScreen (GmSwitcher), SleepingChatScreen (sleepScreen/sleepLeave),
// CraftingScreen/ShulkerBoxScreen/HorseScreenHandler/ShulkerBoxScreenHandler geometry + reachability, with source breaks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const rd = (f) => readFileSync(join(ROOT, 'src', f), 'utf8');
function trial(patch) {
  const o = {}; const ran = []; let woke = null;
  const Gm = { SURVIVAL: 0, CREATIVE: 1, ADVENTURE: 2, SPECTATOR: 3, name: (m) => ['survival', 'creative', 'adventure', 'spectator'][m] };
  const NS = { Gamemode: Gm, Commands: { run: (c) => { ran.push(c); return { lines: [c] }; } },
    Sleep: { wake: (P, r) => { woke = [P, r]; } } };
  let s = rd('15b_gui.js'); if (patch) s = patch(s);
  new Function('MCL', s)(NS);
  const G = NS.Gui, S = G.GmSwitcher;
  // GameModeSelectionScreen
  const P = { mode: 0, opLevel: 2 };
  o.gsOpen = S.press(P) === true && S.open && S.sel === 1;
  S.press(P); o.gsNext = S.sel === 2; S.press(P); S.press(P); o.gsWrap = S.sel === 0;
  o.gsRelease = S.release(P) && ran[0] === '/gamemode creative' && !S.open;
  S.press(P); o.gsSame = S.sel === 1 && S.release(P) === null && ran.length === 1;
  o.gsPerm = S.press({ mode: 0, opLevel: 1 }) === false && !S.open;
  ran.length = 0; S.toggle({ mode: 0, opLevel: 2 }); o.togSpec = ran[0] === '/gamemode spectator';
  S.toggle({ mode: 3, prevMode: 2, opLevel: 2 }); o.togPrev = ran[1] === '/gamemode adventure';
  S.toggle({ mode: 3, opLevel: 2 }); o.togNone = ran[2] === '/gamemode creative';
  // SleepingChatScreen
  const sc = G.sleepScreen(400, 300);
  o.sleepBtn = sc.x === 100 && sc.y === 260 && sc.w === 200 && sc.h === 20 && sc.label === 'Leave Bed';
  const pl = {}; G.sleepLeave(pl); o.sleepLeave = woke && woke[0] === pl && woke[1] === true;
  // CraftingScreen
  o.craftRes = G.craftSlotXY(0).join() === '124,35' && G.craftSlotXY(1).join() === '30,17' && G.craftSlotXY(9).join() === '66,53';
  o.craftInv = G.craftSlotXY(10).join() === '8,84' && G.craftSlotXY(37).join() === '8,142' && G.craftSlotXY(45).join() === '152,142' && G.craftSlotXY(36).join() === '152,120';
  o.craftAt = G.craftSlotAt(125, 36) === 0 && G.craftSlotAt(31, 18) === 1 && G.craftSlotAt(0, 0) === -1;
  o.craftTitle = G.CRAFTING.title.x === 29 && G.CRAFTING.inventoryLabel.y === 72;
  // ShulkerBoxScreen / ShulkerBoxScreenHandler
  o.shDim = G.SHULKER.w === 176 && G.SHULKER.h === 166 && G.SHULKER.inventoryLabel.y === 72;
  o.shSlots = G.chestSlotXY(0, 3, true).join() === '8,18' && G.chestSlotXY(27, 3, true).join() === '8,84' && G.chestSlotXY(54, 3, true).join() === '8,142';
  o.shAt = G.chestSlotAt(9, 85, 3, true) === 27 && G.chestSlotAt(9, 143, 3, true) === 54;
  // HorseScreenHandler
  o.hs = G.horseSlotXY(0).join() === '8,18' && G.horseSlotXY(1).join() === '8,36' && G.horseSlotXY(2).join() === '8,84' && G.horseSlotXY(29).join() === '8,142';
  o.hsChest = G.horseSlotXY(2, true).join() === '80,18' && G.horseSlotXY(3, true).join() === '98,18' && G.horseSlotXY(7, true).join() === '80,36' && G.horseSlotXY(17, true).join() === '8,84';
  o.hsAt = G.horseSlotAt(9, 19) === 0 && G.horseSlotAt(9, 37) === 1 && G.horseSlotAt(81, 19, true) === 2;
  // reachability from real entry points
  const hud = rd('15_hud.js'), main = rd('17_main.js');
  o.reachCraft = hud.includes('g.CRAFTING') && hud.includes('g.craftSlotXY(i)');
  o.reachShulker = hud.includes('g.chestSlotXY(i, rows, isShulker)') && hud.includes("tex === 'shulker_box'");
  o.reachHorse = hud.includes('g.horseSlotXY(i, chest)') && hud.includes('horseSlotAt(');
  o.reachGm = main.includes('Gui.GmSwitcher.press(P)') && main.includes('Gui.GmSwitcher.release(P)') && main.includes('Gui.GmSwitcher.toggle(P)');
  return o;
}
const A = trial(null);
for (const k of Object.keys(A)) ok(A[k], 'scenario ' + k);
const BR = [
  ['gsOrder', "['creative', 'survival', 'adventure', 'spectator']", "['survival', 'creative', 'adventure', 'spectator']", ['gsOpen']],
  ['gsWrap', '(GS.sel + 1) % GS.ICONS.length', 'Math.min(GS.sel + 1, 3)', ['gsWrap']],
  ['gsSame', 'name === NS.Gamemode.name(P.mode | 0)) return null', 'false) return null', ['gsSame']],
  ['gsPerm', 'P.opLevel >= 2', 'true', ['gsPerm']],
  ['togPrev', "Gm.name(P.prevMode === undefined", "Gm.name(P.prevMode === 9", ['togNone']],
  ['sleepY', 'y: h - 40', 'y: h - 30', ['sleepBtn']],
  ['sleepLabel', "G.LANG_STOP_SLEEPING = 'Leave Bed'", "G.LANG_STOP_SLEEPING = 'Leave'", ['sleepBtn']],
  ['sleepWake', 'NS.Sleep.wake(P, true)', 'NS.Sleep.wake(P, false)', ['sleepLeave']],
  ['craftGrid', 'grid: [30, 17]', 'grid: [30, 18]', ['craftRes']],
  ['craftResult', 'result: [124, 35]', 'result: [124, 36]', ['craftRes']],
  ['craftTitle', 'title: { x: 29, y: 6 }', 'title: { x: 8, y: 6 }', ['craftTitle']],
  ['craftBands', 'if (i < 37) { var m = i - 10;', 'if (i < 36) { var m = i - 10;', ['craftInv']],
  ['shMain', 'main: [8, 84], hotbar: [8, 142] },\n    // The villager', 'main: [8, 102], hotbar: [8, 142] },\n    // The villager', ['shSlots']],
  ['shLabel', 'inventoryLabel: { x: 8, y: 72 },\n               main', 'inventoryLabel: { x: 8, y: 73 },\n               main', ['shDim']],
  ['shFlag', 'var iy = shulker ? G.SHULKER.main[1]', 'var iy = false ? G.SHULKER.main[1]', ['shSlots']],
  ['horseSaddle', 'saddle: [8, 18]', 'saddle: [8, 19]', ['hs']],
  ['horseMain', 'main: [8, 84],\n      hotbar: [8, 142],\n      title: { x: 8, y: 6 },\n      // `HorseScreen', 'main: [8, 102],\n      hotbar: [8, 142],\n      title: { x: 8, y: 6 },\n      // `HorseScreen', ['hs']],
  ['horseChestX', 'V.chest.x + 1 + col * V.chest.cellW', 'V.chest.x + col * V.chest.cellW', ['hsChest']],
  ['horseBase', 'var base = cols > 0 ? 2 + 3 * cols : 2;', 'var base = 2;', ['hsChest']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((s) => { if (s.includes(a)) { hit = true; return s.split(a).join(b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(`gui15b11617check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
