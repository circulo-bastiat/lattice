#!/usr/bin/env node
// furnacescreen11725check.mjs — #11725: proves AbstractFurnaceScreen / FurnaceScreen / BlastFurnaceScreen / SmokerScreen
// (H.openFurnace type gate, H.drawFurnace flame+arrow, H.furnaceClick, Gui.furnaceSlotXY/At) and their entry point (Use -> Hud.openFurnace) with source breaks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const rd = (f) => readFileSync(join(ROOT, 'src', f), 'utf8');
const grab = (s, re, what) => { const m = re.exec(s); if (!m) throw new Error('missing ' + what); return m[0]; };
function trial(hp, gp, up) {
  let h = rd('15_hud.js'), g = rd('15b_gui.js'), u = rd('14l_use.js');
  if (hp) h = hp(h); if (gp) g = gp(g); if (up) u = up(u);
  const o = {};
  const G = { FURNACE: { w: 176, h: 166, input: [56, 17], fuel: [56, 53], result: [116, 35], main: [8, 84], hotbar: [8, 142],
    flame: { sx: 176, sy: 0, w: 14, x: 56, y: 36 }, arrow: { sx: 176, sy: 14, h: 16, x: 79, y: 34 }, title: { y: 6 }, inventoryLabel: { x: 8, y: 72 } }, SLOT: 18 };
  new Function('G', grab(g, /G\.furnaceSlotXY = function[\s\S]*?\n  \};/, 'xy') + grab(g, /G\.furnaceSlotAt = function[\s\S]*?\n  \};/, 'at'))(G);
  o.slots = G.furnaceSlotAt(57, 18) === 0 && G.furnaceSlotAt(57, 54) === 1 && G.furnaceSlotAt(117, 36) === 2 && G.furnaceSlotAt(9, 143) === 30 && G.furnaceSlotAt(0, 0) === -1;
  const calls = []; let opened = null;
  const be = { type: 'furnace', burnTime: 5 };
  const NS = { BlockEntities: { get: (x, y, z) => (x === 1 ? be : null) }, Player: { menu: { inventory: {} } },
    Menu: { furnaceMenu: (b) => ({ be: b, slots: [] }), furnaceIsLit: (b) => b.burnTime > 0, furnaceLitProgress: () => 4, furnaceBurnProgress: () => 9,
      slotGet: () => null, getCarried: () => null, OUTSIDE: -999, PICKUP: 0, QUICK_MOVE: 1, doClick: (m, s, b, t) => calls.push([s, t]) },
    Gui: Object.assign(G, { ready: true, dim() {}, blit: (c, n, r) => calls.push(['blit', r.slice()]), text() {}, textWidth: () => 10 }), Inventory: { isEmpty: () => true } };
  const H = { w: 400, h: 300, scale: 2, open: (n) => { opened = n; }, displayName: () => 'Furnace', drawItem() {}, drawInventoryFallback() {}, drawStackTooltip() {} };
  const src = grab(h, /H\.openFurnace = function[\s\S]*?\n  \};/, 'open') + grab(h, /H\.drawFurnace = function[\s\S]*?\n  \};/, 'draw') + grab(h, /H\.furnaceClick = function[\s\S]*?\n  \};/, 'click');
  new Function('H', 'NS', src)(H, NS);
  for (const t of ['furnace', 'blast_furnace', 'smoker']) { be.type = t; opened = null; if (!H.openFurnace(1, 0, 0) || opened !== 'furnace') o.types = false; }
  if (o.types === undefined) o.types = true;
  be.type = 'chest'; o.gate = H.openFurnace(1, 0, 0) === false && H.openFurnace(2, 0, 0) === false;
  be.type = 'smoker'; H.openFurnace(1, 0, 0);
  calls.length = 0; H.drawFurnace({});
  const bl = calls.filter((c) => c[0] === 'blit');
  o.bg = bl.length === 3 && bl[0][1][2] === 176;
  o.flame = bl[1] && bl[1][1][1] === 0 + 8 && bl[1][1][3] === 5;
  o.arrow = bl[2] && bl[2][1][2] === 10 && bl[2][1][0] === 176 && bl[2][1][1] === 14;
  be.burnTime = 0; calls.length = 0; H.drawFurnace({});
  o.unlit = calls.filter((c) => c[0] === 'blit').length === 2;
  calls.length = 0; H.furnaceClick(200, 150, 0, false);
  o.outside = calls.length === 1 && calls[0][0] === -999;
  calls.length = 0; const ox = H.furnaceOrigin.x, oy = H.furnaceOrigin.y;
  H.furnaceClick(ox + 57 * 2, oy + 18 * 2, 0, true);
  o.shift = calls.length === 1 && calls[0][0] === 0 && calls[0][1] === 1;
  o.reach = /beTypeHere === 'furnace' \|\| beTypeHere === 'blast_furnace' \|\| beTypeHere === 'smoker'\) \{[\s\S]{0,200}HdF\.openFurnace\(x, y, z\)/.test(u) && /H\.screen === 'furnace'\) H\.drawFurnace\(c\)/.test(h);
  return o;
}
const base = trial(); for (const [k, v] of Object.entries(base)) ok(v, 'baseline ' + k);
const BR = [
  ['noSmoker', 'h', " && be.type !== 'smoker'", '', ['gate', 'types']],
  ['noBlast', 'h', " && be.type !== 'blast_furnace'", '', ['types']],
  ['anyBE', 'h', "if (!be || (be.type !== 'furnace' && be.type !== 'blast_furnace' && be.type !== 'smoker')) return false;", 'if (!be) return false;', ['gate']],
  ['flameAlways', 'h', 'if (M.furnaceIsLit(be)) {', 'if (true) {', ['unlit']],
  ['flameRise', 'h', 'F.sy + 12 - l,', 'F.sy,', ['flame']],
  ['arrowWidth', 'h', 'b + 1, A.h]', 'b, A.h]', ['arrow']],
  ['noShift', 'h', 'else if (shift) M.doClick(m, slot, 0, M.QUICK_MOVE, P);', 'else if (shift) M.doClick(m, slot, 0, M.PICKUP, P);', ['shift']],
  ['outside', 'h', 'if (slot < 0) M.doClick(m, M.OUTSIDE, b, M.PICKUP, P);', 'if (slot < 0) return true;', ['outside']],
  ['slotFuel', 'g', 'if (i === 1) return [V.fuel[0], V.fuel[1]];', 'if (i === 1) return [V.input[0], V.input[1]];', ['slots']],
  ['hotbar', 'g', 'V.hotbar[0] + (i - 30) * S', 'V.hotbar[0] + (i - 29) * S', ['slots']],
  ['unwired', 'u', 'HdF.openFurnace(x, y, z)', 'false', ['reach']],
  ['undispatched', 'h', "H.screen === 'furnace') H.drawFurnace(c)", "H.screen === 'furnace') 0", ['reach']],
];
for (const [key, w, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  const p = (s) => { const i = s.indexOf('H.furnaceClick = function'); const from = (w === 'h' && (key === 'noShift' || key === 'outside') && i >= 0) ? i : 0; const j = s.indexOf(a, from); if (j >= 0) { hit = true; return s.slice(0, j) + b + s.slice(j + a.length); } return s; };
  try { X = trial(w === 'h' ? p : null, w === 'g' ? p : null, w === 'u' ? p : null); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key + ' ' + JSON.stringify(X));
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(`furnacescreen11725check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
