#!/usr/bin/env node
// containerscreens11725check.mjs — #11725: StonecutterScreen / CartographyTableScreen / Generic3x3ContainerScreen
// (H.openStonecutter/stonecutterSlotXY/At/RecipeAt/stonecutterClick, H.openCartography/cartXY/cartAt/cartographyClick, H.openDispenser)
// and their dispatch from H.draw, proven with source breaks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const grab = (s, re, what) => { const m = re.exec(s); if (!m) throw new Error('missing ' + what); return m[0]; };
const HUD = readFileSync(join(ROOT, 'src/15_hud.js'), 'utf8');
function trial(patch) {
  const h = patch ? patch(HUD) : HUD, o = {};
  const calls = []; let opened = null; let canCraft = true;
  const sm = { recipes: new Array(14).fill(0).map((_, i) => ({ result: i })), selected: -1, canCraft: () => canCraft, refresh() {}, onButtonClick: (i) => calls.push(['btn', i]) };
  const NS = { Player: { menu: { inventory: {} } },
    Menu: { stonecutterMenu: () => sm, cartographyMenu: () => ({ slots: [], refresh() {} }), dispenserMenu: (be) => ({ be }), OUTSIDE: -999, PICKUP: 0, QUICK_MOVE: 1,
      doClick: (m, s, b, t) => calls.push([s, t]) },
    BlockEntities: { get: (x) => (x === 1 ? { type: 'dropper' } : x === 2 ? { type: 'chest' } : null) } };
  const H = { open: (n) => { opened = n; } };
  const src = grab(h, /H\.openStonecutter = function[\s\S]*?\n  \};/, 'os') + grab(h, /H\.stonecutterSlotXY = function[\s\S]*?\n  \};/, 'sxy')
    + grab(h, /H\.stonecutterSlotAt = function[\s\S]*?\n  \};/, 'sat') + grab(h, /H\.stonecutterRecipeAt = function[\s\S]*?\n  \};/, 'sra')
    + grab(h, /H\.stonecutterClick = function[\s\S]*?\n  \};/, 'sc') + grab(h, /H\.openCartography = function[\s\S]*?\n  \};/, 'oc')
    + grab(h, /function cartXY[\s\S]*?\n  \}\n  function cartAt[\s\S]*?\n  \}\n/, 'cart') + 'H.cartAt = cartAt;'
    + grab(h, /H\.cartographyClick = function[\s\S]*?\n  \};/, 'cc') + grab(h, /H\.openDispenser = function[\s\S]*?\n  \};/, 'od');
  new Function('H', 'NS', src)(H, NS);
  o.stOpen = H.openStonecutter(1, 2, 3) === true && opened === 'stonecutter' && H.stonecutterScroll === 0;
  o.stSlots = H.stonecutterSlotAt(21, 34) === 0 && H.stonecutterSlotAt(144, 34) === 1 && H.stonecutterSlotAt(9, 85) === 2 && H.stonecutterSlotAt(9, 143) === 29 && H.stonecutterSlotAt(0, 0) === -1;
  o.stRecipe = H.stonecutterRecipeAt(53, 15) === 0 && H.stonecutterRecipeAt(53 + 16, 15 + 18) === 5 && H.stonecutterRecipeAt(0, 0) === -1 && H.stonecutterRecipeAt(53, 49) === 4;
  H.stonecutterScroll = 1; o.stScroll = H.stonecutterRecipeAt(53, 15) === 4;
  H.stonecutterScroll = 0; canCraft = false; o.stCan = H.stonecutterRecipeAt(53, 15) === -1; canCraft = true;
  H.stonecutterOrigin = { x: 100, y: 100, s: 2 };
  calls.length = 0; H.stonecutterClick(100 + 53 * 2, 100 + 15 * 2, 0, false); o.stBtn = calls.length === 1 && calls[0][0] === 'btn' && calls[0][1] === 0;
  calls.length = 0; H.stonecutterClick(100 + 21 * 2, 100 + 34 * 2, 0, true); o.stShift = calls.length === 1 && calls[0][0] === 0 && calls[0][1] === 1;
  calls.length = 0; H.stonecutterClick(0, 0, 0, false); o.stOut = calls.length === 1 && calls[0][0] === -999;
  o.caOpen = H.openCartography() === true && opened === 'cartography';
  o.caSlots = H.cartAt(16, 16) === 0 && H.cartAt(16, 53) === 1 && H.cartAt(146, 40) === 2 && H.cartAt(9, 85) === 3 && H.cartAt(9, 143) === 30 && H.cartAt(0, 0) === -1;
  H.cartOrigin = { x: 100, y: 100, s: 2 };
  calls.length = 0; H.cartographyClick(100 + 16 * 2, 100 + 16 * 2, 0, true); o.caShift = calls.length === 1 && calls[0][0] === 0 && calls[0][1] === 1;
  calls.length = 0; H.cartographyClick(0, 0, 0, false); o.caOut = calls.length === 1 && calls[0][0] === -999;
  opened = null; o.dpGate = H.openDispenser(1, 0, 0) === true && opened === 'dispenser' && H.openDispenser(2, 0, 0) === false && H.openDispenser(3, 0, 0) === false;
  o.reach = /H\.screen === 'stonecutter'\) H\.drawStonecutter\(c\)/.test(h) && /H\.screen === 'cartography'\) H\.drawCartography\(c\)/.test(h) && /H\.screen === 'dispenser'\) H\.drawDispenser\(c\)/.test(h);
  return o;
}
const base = trial(); for (const [k, v] of Object.entries(base)) ok(v, 'baseline ' + k);
const BR = [
  ['stOut', 'if (i === 1) return [143, 33];', 'if (i === 1) return [150, 33];', ['stSlots']],
  ['stHotbar', 'return [8 + (i - 29) * 18, 142];', 'return [8 + (i - 28) * 18, 142];', ['stSlots']],
  ['stCols', 'k % 4) * 16), dy', 'k % 3) * 16), dy', ['stRecipe']],
  ['stRowH', '(k / 4) | 0) * 18);\n      if (dx', '(k / 4) | 0) * 16);\n      if (dx', ['stRecipe']],
  ['stScroll', 'var off = (H.stonecutterScroll | 0) * 4;', 'var off = 0;', ['stScroll']],
  ['stCan', 'if (!m || !m.canCraft()) return -1;\n    var off', 'if (!m) return -1;\n    var off', ['stCan']],
  ['stBtn', 'if (ri >= 0) { m.onButtonClick(ri); return true; }', 'if (ri >= 0) { return true; }', ['stBtn']],
  ['stShift', 'else if (shift) M.doClick(m, slot, 0, M.QUICK_MOVE, P);\n    else M.doClick(m, slot, b, M.PICKUP, P);\n    m.refresh();\n    if (P && P.syncHotbar) P.syncHotbar();\n    return true;\n  };\n\n  H.cartographyClick', 'else M.doClick(m, slot, b, M.PICKUP, P);\n    m.refresh();\n    if (P && P.syncHotbar) P.syncHotbar();\n    return true;\n  };\n\n  H.cartographyClick', ['stShift']],
  ['stOpenScroll', 'H.stonecutterScroll = 0;\n    H.open', 'H.open', ['stOpen']],
  ['caOut', 'if (i === 2) return [145, 39];', 'if (i === 2) return [145, 45];', ['caSlots']],
  ['caHotbar', 'return [8 + (i - 30) * 18, 142];', 'return [8 + (i - 29) * 18, 142];', ['caSlots']],
  ['caOpen', "H.open('cartography');", "H.open('inventory');", ['caOpen']],
  ['dpGate', "(be.type !== 'dispenser' && be.type !== 'dropper')", "(false)", ['dpGate']],
  ['dpDropper', "be.type !== 'dropper'", "be.type !== 'droppr'", ['dpGate']],
  ['undispatched', "H.screen === 'cartography') H.drawCartography(c)", "H.screen === 'cartography') 0", ['reach']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  const p = (s) => { const j = s.indexOf(a); if (j >= 0) { hit = true; return s.slice(0, j) + b + s.slice(j + a.length); } return s; };
  try { X = trial(p); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key + ' ' + JSON.stringify(X));
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(`containerscreens11725check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
