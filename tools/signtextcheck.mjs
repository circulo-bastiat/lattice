#!/usr/bin/env node
// signtextcheck.mjs — #6374: sign text layout (4 lines, dye colour, glow outline, 90 px width clip).
import { loadEngine, initRegistry } from './loadsrc.mjs';
const M = loadEngine({ extra: ['02g_items.js', '02f_tags.js', '07b_behaviour.js', '07c_blockentity.js'], dom: false });
initRegistry(M);
M.BlockEntities.init();
const BE = M.BlockEntities;
const w = s => s.length * 6;
function run(BE) {
  const f = [];
  const ok = (c, m) => { if (!c) f.push(m); };
  const mk = (lines, color, glowing) => ({ lines, color, glowing });
  let L = BE.signTextLayout(mk(['hi', '', 'abc', 'x'], 'black', false), w);
  ok(L.length === 3 && L[0].x === -6 && L[0].y === -20 && L[1].y === 0 && L[2].y === 10, 'positions: centred, y=i*10-20');
  ok(L[0].color === 0 && L[0].outline === -1, 'plain black: black, no outline');
  L = BE.signTextLayout(mk(['a'], 'red', false), w);
  ok(L[0].color === 0x660000 && L[0].outline === -1, 'dyed red is 0.4 dimmed');
  L = BE.signTextLayout(mk(['a'], 'red', true), w);
  ok(L[0].color === 0xFF0000 && L[0].outline === 0x660000, 'glowing red: full fill, dim outline');
  L = BE.signTextLayout(mk(['a'], 'black', true), w);
  ok(L[0].color === 0 && L[0].outline === 0xF0EBCC, 'glowing black: 0xF0EBCC outline');
  L = BE.signTextLayout(mk(['x'.repeat(40)], 'black', false), w);
  ok(L[0].text.length === 15 && w(L[0].text) <= 90, 'clipped to 90 px');
  return f;
}
const f = run(BE);
let breaks = 0;
const orig = BE.signTextLayout;
const saveMax = BE.SIGN_MAX_WIDTH;
BE.SIGN_MAX_WIDTH = 1e9; if (run(BE).length) breaks++; BE.SIGN_MAX_WIDTH = saveMax;
BE.signTextLayout = (e, wd) => orig(e, wd).map(q => ({ ...q, outline: -1 })); if (run(BE).length) breaks++;
BE.signTextLayout = orig;
if (breaks !== 2) f.push('breaks not caught');
console.log(f.length ? f.join('\n') : `${6} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(f.length ? 1 : 0);
