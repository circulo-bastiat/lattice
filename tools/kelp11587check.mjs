#!/usr/bin/env node
// kelp11587check.mjs — #11587: proves 09c_weather.js's KelpPlantBlock / SeagrassBlock / TallSeagrassBlock
// (getFluidState = still water, unconditionally) through Weather.fluidOf / Weather.fluidHeight. Each cut must fail its row.
import { loadEngine } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const NAMES = ['kelp_plant', 'seagrass', 'tall_seagrass'];
function trial(patch) {
  const MCL = loadEngine({ extra: ['09c_weather.js'], dom: false, ...(patch ? { patch } : {}) });
  const S = MCL.States, Wx = MCL.Weather, o = {}, cells = new Map();
  MCL.World = { getBlock: (x, y, z) => cells.get(x + ',' + y + ',' + z) || 0 };
  for (const n of NAMES) {
    const f = Wx.fluidOf(S.stateOf(n));
    o[n] = f[0] === 1 && f[1] === 8;
  }
  cells.set('0,0,0', S.stateOf('kelp_plant'));
  o.height = Math.abs(Wx.fluidHeight(0, 0, 0) - 8 / 9) < 1e-6;
  cells.set('0,1,0', S.stateOf('tall_seagrass'));
  o.heightFull = Wx.fluidHeight(0, 0, 0) === 1;
  o.stone = Wx.fluidOf(S.stateOf('stone'))[0] === 0;
  return o;
}
const A = trial(null);
for (const k of Object.keys(A)) ok(A[k], 'scenario ' + k);
const F = '09c_weather.js';
const BR = [
  ['kelp_plant', 'id.kelp, id.kelp_plant,', 'id.kelp,'],
  ['seagrass', 'id.kelp_plant, id.seagrass,', 'id.kelp_plant,'],
  ['tall_seagrass', 'id.seagrass, id.tall_seagrass,', 'id.seagrass,'],
  ['height', 'if (K.alwaysWater.indexOf(b) >= 0) return [FLUID_WATER, 8];', 'if (K.alwaysWater.indexOf(b) >= 0) return [FLUID_WATER, 4];'],
  ['heightFull', 'if (Wx.fluidOf(W.getBlock(x, y + 1, z))[0] === f[0]) return 1;', ''],
];
for (const [key, a, b] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((f, s) => { if (f === F && s.includes(a)) { hit = true; return s.replace(a, b); } return s; }); } catch { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  ok(!X[key], 'anti-vacuity: break ' + key);
  if (!X[key]) console.log('  ✓ break caught: ' + key);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `kelp11587check: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
