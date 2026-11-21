#!/usr/bin/env node
// loomscreen11623check.mjs — #11623 (AUDIT-MAP). LoomScreen in 15_hud.js: openLoom, slot/button geometry, loomClick, entry points.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, SRC, MCLITE_ROOT } from './loadsrc.mjs';
let N = 0;
const use = readFileSync(SRC + '/14l_use.js', 'utf8');
const hudSrc = readFileSync(SRC + '/15_hud.js', 'utf8');
const imeta = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'items.meta.json'), 'utf8'));
const itemsBin = readFileSync(join(MCLITE_ROOT, 'assets', 'items.bin')).toString('base64');
function run(patch) {
  const f = [];
  const ok = (c, m) => { N++; if (!c) f.push(m); };
  try {
    const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '14g_menu.js', '14g2_invclasses.js', '07zzq_loom.js', '15_hud.js'], ...(patch ? { patch: (fn, t) => (fn === '15_hud.js' ? patch(t) : t) } : {}) });
    M.Items.init({ items: itemsBin, itemsBytes: imeta.rawBytes });
    const H = M.Hud, I = (n) => M.Items.of(n);
    const st = (n) => ({ i: I(n), n: 1, d: 0 });
    const inv = M.Inventory.create ? M.Inventory.create() : null;
    M.Player = { menu: { inventory: inv }, syncHotbar() {} };
    H.open = (s) => { H.screen = s; };
    ok(H.openLoom() === true && H.screen === 'loom' && H.loomMenu && H.loomScroll === 0, 'openLoom opens the loom menu');
    M.Player = null; ok(H.openLoom() === false, 'openLoom refuses without a player');
    M.Player = { menu: { inventory: inv }, syncHotbar() {} };
    H.openLoom();
    const m = H.loomMenu, S = 2;
    H.loomOrigin = { x: 100, y: 50, s: S };
    const gui = (x, y) => [100 + (x + 3) * S, 50 + (y + 3) * S];
    const click = (x, y, b, sh) => { const p = gui(x, y); return H.loomClick(p[0], p[1], b | 0, !!sh); };
    // banner/dye slots take items by clicking at the vanilla slot coordinates
    m.input.set(0, st('white_banner')); m.input.set(1, st('red_dye'));
    click(60, 13);                          // first pattern button
    ok(m.selected === 1, 'first button selects pattern 1');
    ok(m.slots[3] && M.Menu.slotGet(m.slots[3]) && M.Menu.slotGet(m.slots[3]).t.BlockEntityTag.Patterns.length === 1, 'output slot shows the patterned banner');
    click(60 + 14 * 3, 13 + 14 * 3); ok(m.selected === 16, 'last visible button (col 3,row 3) = 16');
    click(60 + 14, 13); ok(m.selected === 2, 'button width 14 steps 14');
    click(60 + 14, 13 + 14); ok(m.selected === 6, 'row 2 col 1 = 6');
    click(60 + 14 * 4, 13); ok(m.selected === 6, 'outside the grid selects nothing');
    H.loomScroll = 1; click(60, 13); ok(m.selected === 5, 'scrolled one row: first button is 5');
    H.loomScroll = 99; click(60, 13); ok(m.selected === 21, 'scroll clamps to max row 5 (34 buttons: first is 21)');
    H.loomScroll = 0;
    // every slot at its vanilla corner: both inside corners hit it, one pixel-quarter outside does not
    const SL = (i) => i === 0 ? [13, 26] : i === 1 ? [33, 26] : i === 2 ? [23, 45] : i === 3 ? [143, 58] : i < 31 ? [8 + ((i - 4) % 9) * 18, 84 + (((i - 4) / 9) | 0) * 18] : [8 + (i - 31) * 18, 142];
    const fresh = (i, n) => { H.openLoom(); H.loomOrigin = { x: 100, y: 50, s: S }; M.Menu.slotSet(H.loomMenu.slots[i], { i: I('stick'), n: n || i + 1, d: 0 }); return H.loomMenu; };
    const at = (gx, gy, b, sh) => H.loomClick(100 + gx * S, 50 + gy * S, b | 0, !!sh);
    const carried = (mm) => { const c = M.Menu.getCarried(mm); return c ? c.n : 0; };
    for (let i = 0; i < 40; i++) {
      const [x, y] = SL(i);
      for (const [dx, dy] of [[0.25, 0.25], [15.75, 15.75]]) { const mm = fresh(i); at(x + dx, y + dy); ok(carried(mm) === i + 1, 'slot ' + i + ' hit at ' + dx); }
      for (const [dx, dy] of [[-0.25, 0.25], [16.25, 0.25], [0.25, -0.25], [0.25, 16.25]]) { const mm = fresh(i); at(x + dx, y + dy); ok(carried(mm) !== i + 1, 'slot ' + i + ' miss at ' + dx + ',' + dy); }
    }
    // button edges
    const sel = (gx, gy) => { H.openLoom(); H.loomOrigin = { x: 100, y: 50, s: S }; const mm = H.loomMenu; mm.input.set(0, st('white_banner')); mm.input.set(1, st('red_dye')); H.loomScroll = 0; at(gx, gy); return mm.selected; };
    ok(sel(60.25, 13.25) === 1 && sel(73.75, 26.75) === 1 && sel(59.75, 13.25) === 0 && sel(60.25, 12.75) === 0, 'button 1 corners');
    ok(sel(115.75, 13.25) === 4 && sel(116.25, 13.25) === 0 && sel(60.25, 27.25) === 5 && sel(60.25, 68.75) === 13 && sel(60.25, 69.25) === 0, 'button grid far edges');
    // shift-click quick-moves, right click takes half
    { const mm = fresh(31, 7); at(8, 142, 0, true); ok(!M.Menu.slotGet(mm.slots[31]) || M.Menu.slotGet(mm.slots[31]).n !== 7, 'shift-click moves the hotbar stack'); ok(carried(mm) === 0, 'shift-click does not pick up'); }
    { const mm = fresh(4, 10); at(8, 84, 2); ok(carried(mm) === 5, 'right-click takes half'); }
    { const mm = fresh(4, 10); at(8, 84, 0); ok(carried(mm) === 10, 'left-click takes all'); }
    { const mm = fresh(4, 10); at(8, 84, 0); ok(at(-50, -50, 0) === true && carried(mm) === 0, 'outside click drops the carried stack'); }
    // outside click with carried stack drops it (OUTSIDE)
    m.input.set(0, null); M.Menu.setCarried && M.Menu.setCarried(m, null);
    ok(H.loomClick(-5, -5, 0, false) === true, 'outside click handled');
    H.loomMenu = null; ok(H.loomClick(1, 1, 0, false) === false, 'no menu: click unhandled');
    ok(/H\.screen === 'loom'\) H\.drawLoom\(c\)/.test(hudSrc) && /H\.loomClick\(mx, my, button \| 0,/.test(hudSrc) && /H\.loomScroll = \(H\.loomScroll \| 0\) \+/.test(hudSrc), 'hud entry points');
    ok(/isBlock\(state, 'loom'\)/.test(use) && /HdL\.openLoom/.test(use), 'use-block entry point');
  } catch (e) { f.push('threw: ' + e.message); }
  return f;
}
const base = run(null);
if (base.length) { console.log('FAIL baseline: ' + base.join('; ')); process.exit(1); }
const inLoom = (t, a, b) => { const k = t.indexOf('H.loomClick = '); return t.slice(0, k) + t.slice(k).replace(a, b); };
const muts = [
  ['button x origin', (t) => t.replace('out.push([list[k], 60 + (q % 4) * 14, 13', 'out.push([list[k], 61 + (q % 4) * 14, 13')],
  ['button row pitch', (t) => t.replace('13 + ((q / 4) | 0) * 14]', '13 + ((q / 4) | 0) * 15]')],
  ['button columns', (t) => t.replace('(q % 4) * 14', '(q % 3) * 14')],
  ['button size hit', (t) => t.replace('px < bs[k][1] + 14 && py >= bs[k][2] && py < bs[k][2] + 14', 'px < bs[k][1] + 12 && py >= bs[k][2] && py < bs[k][2] + 14')],
  ['visible rows', (t) => t.replace('(H.loomScroll + 4) * 4', '(H.loomScroll + 3) * 4')],
  ['scroll clamp', (t) => t.replace('Math.ceil(list.length / 4) - 4', 'Math.ceil(list.length / 4) - 3')],
  ['output slot', (t) => t.replace('[143, 58]', '[143, 57]')],
  ['banner slot', (t) => t.replace('[13, 26]', '[14, 26]')],
  ['dye slot', (t) => t.replace('[33, 26]', '[34, 26]')],
  ['pattern slot', (t) => t.replace('[23, 45]', '[23, 46]')],
  ['backpack slot', (t) => t.replace('8 + (q % 9) * 18, 84 + ((q / 9) | 0) * 18]; }\n    return [8 + (i - 31)', '8 + (q % 9) * 18, 85 + ((q / 9) | 0) * 18]; }\n    return [8 + (i - 31)')],
  ['hotbar slot', (t) => t.replace('[8 + (i - 31) * 18, 142]', '[8 + (i - 31) * 18, 141]')],
  ['slot size', (t) => t.replace('px < p[0] + 16 && py >= p[1] && py < p[1] + 16) return i;\n    }\n    return -1;\n  }\n  /** The pattern', 'px < p[0] + 15 && py >= p[1] && py < p[1] + 16) return i;\n    }\n    return -1;\n  }\n  /** The pattern')],
  ['button select', (t) => t.replace('m.button(bs[k][0]);', 'void 0;')],
  ['open sets screen', (t) => t.replace("H.open('loom');", '')],
  ['open needs menu', (t) => t.replace('!M.loomMenu || !P || !P.menu) return false;\n    H.loomMenu', '!M.loomMenu) return false;\n    H.loomMenu')],
  ['shift quick-move', (t) => inLoom(t, 'else if (shift) M.doClick', 'else if (false) M.doClick')],
  ['right click', (t) => inLoom(t, 'var b = button === 2 ? 1 : 0;', 'var b = 0;')],
  ['scroll reset', (t) => t.replace('H.loomScroll = 0;\n    H.open', 'H.open')],
];
let caught = 0; const missed = [];
for (const [name, fn] of muts) {
  const probe = (t) => { const o = fn(t); if (o === t) throw new Error('mutant did not change source: ' + name); return o; };
  let f; try { f = run(probe); } catch (e) { if (/did not change/.test(e.message)) { console.log('FAIL ' + e.message); process.exit(1); } f = ['threw']; }
  if (f.length) { caught++; console.log('   ✓ cutting ' + name + ' fails: ' + f[0].slice(0, 70)); } else { missed.push(name); console.log('  FAIL cutting ' + name + ' went unnoticed'); }
}
console.log(` assertions passed .. ${N / (muts.length + 1) | 0}`);
console.log(` failures ........... ${missed.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(missed.length ? 1 : 0);
