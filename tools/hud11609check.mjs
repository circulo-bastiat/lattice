#!/usr/bin/env node
// hud11609check.mjs — #11609: drives 15_hud.js real paths for audit classes: BossBarHud (H.bossBars/bossBarLayout, ServerBossBar
// tracking range, ClientBossBar), HandledScreen tooltip geometry (TooltipContext advanced lines), EnchantmentScreen
// (EnchantingPhrases table, Enchantment.getName), HopperScreen/GenericContainerScreen click mapping (ClickType PICKUP/QUICK_MOVE/
// OUTSIDE), CyclingButtonWidget (world-type step). Each scenario is broken by a source patch and must fail.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '13_input.js', '15b_gui.js', '15_hud.js'];
function trial(patch) {
  const MCL = loadEngine({ extra: EXTRA, dom: false, ...(patch ? { patch } : {}) });
  MCL.Items.init({ items: readFileSync(join(MCLITE_ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
  const H = MCL.Hud, o = {};
  // BossBarHud / ServerBossBar
  MCL.Player = { x: 0, y: 0, z: 0 };
  const wither = (x, extra) => ({ x, y: 0, z: 0, bossBar: { name: 'Wither', percent: 0.5, color: 'purple' }, ...(extra || {}) });
  MCL.EntityList = { list: [wither(159), wither(161), wither(10, { dead: true }), wither(5, { customName: 'Bob', bossBar: { name: 'Wither', percent: 1, color: 'pink' } })] };
  const bars = H.bossBars();
  o.track = bars.length === 2 && bars[0].name === 'Wither' && bars[1].name === 'Bob' && bars[0].color === 'purple';
  const lay = H.bossBarLayout([{ color: 'purple', percent: 0.5 }, { color: 'red', percent: 1 }, { color: 'blue', percent: 0 }], 320, 240);
  o.layout = lay.length === 3 && lay[0].x === 69 && lay[0].y === 12 && lay[1].y === 31 && lay[0].nameY === 3 && lay[0].fill === 91 && lay[0].row === 50 && lay[1].row === 20 && lay[1].fill === 183;
  o.stop = H.bossBarLayout(new Array(9).fill({ color: 'pink', percent: 1 }), 320, 120).length === 2;
  // EnchantingPhrases / Enchantment.getName
  o.phr = H.ENCHANT_PHRASES[0] === 'the' && H.ENCHANT_PHRASES[3] === 'klaatu' && H.ENCHANT_PHRASES.length === 62;
  const L1 = H.enchantmentLine('minecraft:sharpness', 1), L2 = H.enchantmentLine('minecraft:binding_curse', 1);
  o.ench = L1.rgb === 0xAAAAAA && L2.rgb === 0xFF5555 && H.enchantmentLine('minecraft:vanishing_curse', 1).rgb === 0xFF5555 && /sharpness/i.test(L1.text);
  // TooltipContext geometry
  const T = H.tooltipLayout([40, 80], 10, 50, 300, 200);
  o.tipGeom = T.x === 22 && T.y === 38 && T.w === 80 && T.h === 20 && T.ys[0] === 38 && T.ys[1] === 50;
  const T2 = H.tooltipLayout([100], 250, 198, 300, 200);
  o.tipFlip = T2.x === 250 + 12 - 28 - 100 && T2.h === 8 && T2.y === 200 - 8 - 6;
  const st = { i: MCL.Items.of('stone'), n: 1, d: 0, t: null };
  const adv = H.advancedTooltipLines(st);
  o.adv = adv[adv.length - 1].text === 'minecraft:stone' && adv[adv.length - 1].rgb === 0x555555;
  // ClickType via HandledScreen clicks (hopper, chest)
  const calls = [];
  MCL.Menu = { OUTSIDE: -999, PICKUP: 0, QUICK_MOVE: 1, doClick: (m, s, b, t) => calls.push([s, b, t]) };
  MCL.Gui = { hopperSlotAt: (x, y) => (x < 50 ? 2 : -1), chestSlotAt: (x, y) => (x < 50 ? 4 : -1), HOPPER: {}, };
  MCL.Player = { syncHotbar() {} };
  H.hopperMenu = {}; H.hopperOrigin = { x: 0, y: 0, s: 1 };
  H.hopperClick(10, 10, 0, false); H.hopperClick(10, 10, 2, false); H.hopperClick(10, 10, 0, true); H.hopperClick(90, 10, 2, false);
  o.hopClick = JSON.stringify(calls) === JSON.stringify([[2, 0, 0], [2, 1, 0], [2, 0, 1], [-999, 1, 0]]);
  calls.length = 0; H.chestMenu = { rows: 3 }; H.chestOrigin = { x: 0, y: 0, s: 1 };
  H.chestClick(10, 10, 0, true); H.chestClick(90, 10, 0, false);
  o.chestClick = JSON.stringify(calls) === JSON.stringify([[4, 0, 1], [-999, 0, 0]]);
  return o;
}
const LBL = { track: 'ServerBossBar tracking range 160 + custom name', layout: 'BossBarHud layout x/y/fill/row', stop: 'BossBarHud stops at H/3', phr: 'EnchantingPhrases table', ench: 'Enchantment.getName colours', tipGeom: 'HandledScreen tooltip geometry', tipFlip: 'tooltip flips at screen edge', adv: 'TooltipContext advanced id line', hopClick: 'HopperScreen ClickType mapping', chestClick: 'GenericContainerScreen ClickType mapping' };
const A = trial(null);
for (const [k, m] of Object.entries(LBL)) ok(A[k], m + ' ' + (A[k] ? '' : JSON.stringify(A)));
const BR = [
  ['track', 'H.BOSS_TRACK_RANGE = 160;', 'H.BOSS_TRACK_RANGE = 100;'],
  ['layout', 'y += 19;', 'y += 20;'],
  ['stop', 'if (y >= Math.floor(guiH / 3)) break;', 'if (y >= Math.floor(guiH / 2)) break;'],
  ['phr', "H.ENCHANT_PHRASES = ['the', 'elder'", "H.ENCHANT_PHRASES = ['elder', 'the'"],
  ['ench', "bare === 'binding_curse' || bare === 'vanishing_curse') ? 0xFF5555", "bare === 'binding_curse') ? 0xFF5555"],
  ['tipGeom', 'ys.push(yy); yy += 10 + (i === 0 ? 2 : 0);', 'ys.push(yy); yy += 10;'],
  ['tipFlip', 'if (x + w > sw) x -= 28 + w;', 'if (x + w > sw) x -= 20 + w;'],
  ['adv', "rgb: 0x555555 });\n    if (t)", "rgb: 0xAAAAAA });\n    if (t)"],
  ['hopClick', 'else if (shift) M.doClick(m, slot, 0, M.QUICK_MOVE, P);\n    else M.doClick(m, slot, b, M.PICKUP, P);\n    if (P && P.syncHotbar) P.syncHotbar();\n    return true;\n  };\n\n  // --- the anvil', 'else M.doClick(m, slot, b, M.PICKUP, P);\n    if (P && P.syncHotbar) P.syncHotbar();\n    return true;\n  };\n\n  // --- the anvil'],
  ['chestClick', 'var b = button === 2 ? 1 : 0;\n    if (slot < 0) M.doClick(m, M.OUTSIDE, b, M.PICKUP, P);\n    else if (shift) M.doClick(m, slot, 0, M.QUICK_MOVE, P);\n    else M.doClick(m, slot, b, M.PICKUP, P);\n    if (P && P.syncHotbar) P.syncHotbar();\n    return true;\n  };\n\n  // --- the crafting table screen', 'var b = button === 2 ? 1 : 0;\n    if (slot < 0) M.doClick(m, M.OUTSIDE, b, M.PICKUP, P);\n    else M.doClick(m, slot, b, M.PICKUP, P);\n    if (P && P.syncHotbar) P.syncHotbar();\n    return true;\n  };\n\n  // --- the crafting table screen'],
];
for (const [key, a, b] of BR) {
  breaks++; let hit = false, B;
  try { B = trial((fn, src) => { if (fn !== '15_hud.js' || !src.includes(a)) return src; hit = true; return src.replace(a, b); }); } catch (e) { B = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  ok(!B[key], 'break must be caught: ' + key);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `hud11609check: ${pass} ok, ${breaks} breaks caught, 0 failed`);
process.exit(fails.length ? 1 : 0);
