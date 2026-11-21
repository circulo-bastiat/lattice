#!/usr/bin/env node
// enderman11589check.mjs — #11589: proves 07zg_enderman.js's Material.blocksMovement port (blocksMovementAt) through the
// real entry point Enderman.teleportBox: solid floors stop the walk-down; water/lava/cobweb/bamboo sapling/carpet do not.
import { loadEngine, initRegistry } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const MCL = loadEngine({ extra: ['07zg_enderman.js'], dom: false, ...(patch ? { patch } : {}) });
  initRegistry(MCL);
  const S = MCL.States, E = MCL.Enderman, o = {}, cells = new Map();
  MCL.World = { BOTTOM_Y: -64, getBlock: (x, y, z) => cells.get(x + ',' + y + ',' + z) || 0 };
  MCL.Physics = { shapeAt: () => null };
  const col = (z, ...layers) => { cells.clear(); layers.forEach(([y, n]) => cells.set('0,' + y + ',' + z, S.stateOf(n))); };
  const land = (z, ...layers) => { col(z, ...layers); const e = { x: 0.5, y: 0, z: z + 0.5 }; return E.teleportBox(e, 0.5, 12, z + 0.5) ? e.y : null; };
  o.stone = land(0, [9, 'stone']) === 10;
  o.water = land(0, [9, 'water'], [8, 'stone']) === null;
  o.lava = land(0, [9, 'lava'], [8, 'stone']) === null;
  o.cobweb = land(0, [9, 'cobweb'], [8, 'stone']) === 9;
  o.bamboo = land(0, [9, 'bamboo_sapling'], [8, 'stone']) === 9;
  o.carpet = land(0, [9, 'white_carpet'], [8, 'stone']) === 9;
  o.void = land(0) === null;
  return o;
}
const A = trial(null);
for (const k of Object.keys(A)) ok(A[k], 'scenario ' + k + ' ' + JSON.stringify(A));
const F = '07zg_enderman.js';
const T = 'return S.solidMat[b] === 1 && b !== id.cobweb && b !== id.bamboo_sapling && b !== id.water && b !== id.lava;';
const BR = [
  ['stone', T, 'return false;'],
  ['water', T, 'return S.solidMat[b] === 1 || b === id.water;'],
  ['lava', T, 'return S.solidMat[b] === 1 || b === id.lava;'],
  ['cobweb', ' && b !== id.cobweb', ''],
  ['bamboo', ' && b !== id.bamboo_sapling', ''],
  ['carpet', 'S.solidMat[b] === 1 &&', 'S.solidMat[b] !== 7 &&'],
  ['void', 'if (!blocksMovementAt(bx, by - 1, bz)) return false;\n    var ey = y - (by0 - by), hw', 'var ey = y - (by0 - by), hw'],
];
for (const [key, a, b] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((f, s) => { if (f === F && s.includes(a)) { hit = true; return s.replace(a, b); } return s; }); } catch { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  ok(!X[key], 'anti-vacuity: break ' + key);
  if (!X[key]) console.log('  ✓ break caught: ' + key);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `enderman11589check: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
