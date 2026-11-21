#!/usr/bin/env node
// pattern11603check.mjs — #11603: proves 07zq_snowgolem.js's BlockPattern/BlockPatternBuilder/CachedBlockPosition
// stand-ins (SG.searchGolemPattern, searchIronGolemPattern, tryConstruct) through the entry point SG.onBlockAdded, with SOURCE breaks.
import { loadEngine } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const F = '07zq_snowgolem.js';
function trial(patch) {
  const M = loadEngine({ extra: ['07zq_snowgolem.js'], dom: false, ...(patch ? { patch } : {}) });
  const S = M.States, SG = M.SnowGolem, o = {};
  const cells = new Map(); const k = (x, y, z) => x + ',' + y + ',' + z;
  M.World = { getBlock: (x, y, z) => cells.get(k(x, y, z)) || 0, setBlock: (x, y, z, s) => cells.set(k(x, y, z), s) };
  let spawned = [];
  M.EntityList = { spawn: (t, x, y, z) => { const e = { type: t, x, y, z }; spawned.push(e); return e; } };
  const put = (x, y, z, n) => cells.set(k(x, y, z), S.stateOf(n));
  const nm = (x, y, z) => { const s = cells.get(k(x, y, z)); return s ? M.Reg.names[S.block[s]] : 'air'; };
  const reset = () => { cells.clear(); spawned = []; };
  // snow golem: snow, snow, head
  put(0, 1, 0, 'snow_block'); put(0, 2, 0, 'snow_block'); put(0, 3, 0, 'carved_pumpkin');
  const g = SG.onBlockAdded(0, 3, 0);
  o.snowBuilt = !!g && g.type === 'snow_golem' && g.x === 0.5 && Math.abs(g.y - 1.05) < 1e-9 && g.z === 0.5;
  o.snowCleared = nm(0, 1, 0) === 'air' && nm(0, 2, 0) === 'air' && nm(0, 3, 0) === 'air';
  reset(); put(0, 1, 0, 'snow_block'); put(0, 2, 0, 'snow_block'); put(0, 3, 0, 'pumpkin');
  o.plainPumpkin = SG.onBlockAdded(0, 3, 0) === null && spawned.length === 0;
  reset(); put(0, 1, 0, 'dirt'); put(0, 2, 0, 'snow_block'); put(0, 3, 0, 'jack_o_lantern');
  o.badBody = SG.onBlockAdded(0, 3, 0) === null && nm(0, 2, 0) === 'snow_block';
  reset(); put(0, 1, 0, 'snow_block'); put(0, 2, 0, 'snow_block'); put(0, 3, 0, 'jack_o_lantern');
  o.lantern = !!SG.onBlockAdded(0, 3, 0);
  // iron golem T
  const T = (arm) => { reset(); for (const dx of [-1, 0, 1]) put(dx, 2, 0, 'iron_block'); put(0, 1, 0, 'iron_block'); put(0, 3, 0, 'carved_pumpkin'); if (arm) put(arm, 3, 0, 'stone'); };
  T(); const ig = SG.onBlockAdded(0, 3, 0);
  o.ironBuilt = !!ig && ig.type === 'iron_golem' && ig.playerCreated === true;
  o.ironCleared = nm(1, 2, 0) === 'air' && nm(-1, 2, 0) === 'air' && nm(0, 1, 0) === 'air';
  reset(); for (const dz of [-1, 0, 1]) put(0, 2, dz, 'iron_block'); put(0, 1, 0, 'iron_block'); put(0, 3, 0, 'carved_pumpkin');
  o.ironZAxis = !!SG.onBlockAdded(0, 3, 0);
  T(1); o.ironBlockedHead = SG.onBlockAdded(0, 3, 0) === null;
  T(); put(1, 1, 0, 'stone'); o.ironBlockedStem = SG.onBlockAdded(0, 3, 0) === null;
  // placed block a snow block (not head) builds nothing
  reset(); put(0, 1, 0, 'snow_block'); put(0, 2, 0, 'snow_block'); put(0, 3, 0, 'carved_pumpkin');
  o.snowPlaced = SG.onBlockAdded(0, 2, 0) === null;
  return o;
}
const A = trial(null);
for (const k of Object.keys(A)) ok(A[k], 'scenario ' + k + ' ' + JSON.stringify(A));
const BR = [
  ['snowBody', "snow1 === 'snow_block' && snow2 === 'snow_block'", "snow1 === 'snow_block'", ['badBody']],
  ['clearBottom', "world.setBlock(match.headX, match.headY - 2, match.headZ, 'air');", '', ['snowCleared']],
  ['spawnY', 'match.headY - 2 + 0.05', 'match.headY + 0.05', ['snowBuilt']],
  ['ironArm', '[dx, 0, dz, 0], [-dx, 0, -dz, 0]', '[dx, 0, dz, 1], [-dx, 0, -dz, 0]', ['ironBuilt', 'ironBlockedHead']],
  ['ironStem', '[dx, -2, dz, 0], [-dx, -2, -dz, 0]', '[dx, -2, dz, 1], [-dx, -2, -dz, 0]', ['ironBuilt']],
  ['axis', 'ax === 0 ? 0 : 1;', 'ax === 0 ? 0 : 0;', ['ironZAxis']],
  ['ironFlag', 'g.playerCreated = true;', '', ['ironBuilt']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((f, s) => { if (f === F && s.includes(a)) { hit = true; return s.replace(a, b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key + ' ' + JSON.stringify(X));
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `pattern11603check: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
