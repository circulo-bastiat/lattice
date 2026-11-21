#!/usr/bin/env node
// silverfish11586check.mjs — #11586: proves 07zn_silverfish.js (InfestedBlock pairs/onBreak, SilverfishEntity goals:
// CallForHelpGoal, WanderAndInfestGoal, pathFavor). Each source break must fail its row.
import { loadEngine, initRegistry } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const MCL = loadEngine({ extra: ['07zn_silverfish.js'], dom: false, ...(patch ? { patch } : {}) });
  initRegistry(MCL);
  const SF = MCL.Silverfish, S = MCL.States, o = {};
  const cells = new Map(); const spawned = [];
  const put = (x, y, z, n) => cells.set(x + ',' + y + ',' + z, S.stateOf(n));
  MCL.World = { getBlock: (x, y, z) => cells.get(x + ',' + y + ',' + z) || 0,
    setBlock: (x, y, z, s) => { if (s) cells.set(x + ',' + y + ',' + z, s); else cells.delete(x + ',' + y + ',' + z); return true; } };
  MCL.EntityList = { ready: true, spawn: (n, x, y, z) => { const e = { n, x, y, z }; spawned.push(e); return e; } };
  MCL.Particle = null; MCL.Sound = null; MCL.Physics = { solidAt: () => false };
  const nm = (x, y, z) => S.name(MCL.World.getBlock(x, y, z));
  // InfestedBlock pairs
  o.pairs = SF.PAIRS.length === 7 && SF.isInfestable('stone_bricks') && !SF.isInfestable('infested_stone') && SF.isInfested('infested_chiseled_stone_bricks') && !SF.isInfested('stone');
  o.toInf = S.name(SF.toInfestedState(S.stateOf('cobblestone'))) === 'infested_cobblestone' && S.name(SF.toInfestedState(S.stateOf('chiseled_stone_bricks'))) === 'infested_chiseled_stone_bricks';
  o.toReg = S.name(SF.toRegularState(S.stateOf('infested_deepslate'))) === 'deepslate' && SF.toRegularState(S.stateOf('stone')) === null;
  const ax = S.stateOf('deepslate') + 1;
  o.axis = S.name(SF.toInfestedState(ax)) === 'infested_deepslate' && SF.toInfestedState(ax) !== S.stateOf('infested_deepslate') && SF.toRegularState(SF.toInfestedState(ax)) === ax;
  // onBreak
  SF.onBreak(5, 6, 7, false);
  o.spawnPos = spawned.length === 1 && spawned[0].n === 'silverfish' && spawned[0].x === 5.5 && spawned[0].y === 6 && spawned[0].z === 7.5;
  SF.onBreak(1, 1, 1, true); o.silk = spawned.length === 1;
  MCL.Commands = { ruleGet: () => 'false' }; SF.onBreak(1, 1, 1, false); o.rule = spawned.length === 1; MCL.Commands = null;
  // CallForHelpGoal
  const e = { x: 0.5, y: 10, z: 0.5 };
  put(3, 10, 0, 'infested_stone');
  let g = new SF.CallForHelpGoal(e, { random: () => 0.9 });
  o.idle = g.canUse() === false; g.onHurt(); o.armed = g.canUse() === true;
  for (let i = 0; i < 19; i++) g.tick();
  o.delay = nm(3, 10, 0) === 'infested_stone' && spawned.length === 1;
  g.tick();
  o.breaks = nm(3, 10, 0) === 'air' && spawned.length === 2;
  put(0, 12, 0, 'infested_cobblestone'); g = new SF.CallForHelpGoal(e, { random: () => 0.9, mobGriefing: () => false }); g.onHurt();
  for (let i = 0; i < 20; i++) g.tick();
  o.revert = nm(0, 12, 0) === 'cobblestone' && spawned.length === 2;
  put(10, 15, 10, 'infested_stone'); put(11, 10, 0, 'infested_stone'); g = new SF.CallForHelpGoal(e, { random: () => 0.9 }); g.onHurt();
  for (let i = 0; i < 20; i++) g.tick();
  o.range = nm(10, 15, 10) === 'air' && nm(11, 10, 0) === 'infested_stone';
  // WanderAndInfestGoal: adjacent infestable block is converted and the mob removed
  const e2 = { x: 20.5, y: 10, z: 20.5 }; put(21, 10, 20, 'stone');
  const w = new SF.WanderAndInfestGoal(e2, 1.0, { random: () => 0 });
  o.canInfest = w.canUse() === true; w.start();
  o.infest = nm(21, 10, 20) === 'infested_stone' && e2.removed === true;
  const e3 = { x: 40.5, y: 10, z: 40.5, target: {} }; put(41, 10, 40, 'stone');
  o.target = new SF.WanderAndInfestGoal(e3, 1.0, { random: () => 0 }).canUse() === false;
  const e4 = { x: 60.5, y: 10, z: 60.5 }; put(61, 10, 60, 'stone');
  o.grief = new SF.WanderAndInfestGoal(e4, 1.0, { random: () => 0, mobGriefing: () => false }).canUse() === false;
  put(61, 10, 60, 'dirt'); const w5 = new SF.WanderAndInfestGoal(e4, 1.0, { random: () => 0 }); const c5 = w5.canUse(); w5.start();
  o.nonInfestable = c5 === false && e4.removed !== true && nm(61, 10, 60) === 'dirt';
  // pathFavor
  put(80, 9, 80, 'stone_bricks'); put(81, 9, 80, 'dirt');
  o.favor = SF.pathFavor(80, 10, 80) === 10 && SF.pathFavor(81, 10, 80) === 0;
  return o;
}
const A = trial(null);
for (const k of Object.keys(A)) ok(A[k], 'scenario ' + k + ' ' + JSON.stringify(A));
const F = '07zn_silverfish.js';
const BR = [
  ['pairs', "['chiseled_stone_bricks', 'infested_chiseled_stone_bricks']", "['x_none', 'y_none']"],
  ['toInf', 'SF.TO_INFESTED[SF.PAIRS[i][0]] = SF.PAIRS[i][1];', ''],
  ['toReg', 'SF.TO_REGULAR[SF.PAIRS[i][1]] = SF.PAIRS[i][0];', ''],
  ['axis', 'var local = state - R.realFirst[block];', 'var local = 0;'],
  ['spawnPos', "spawn('silverfish', x + 0.5, y, z + 0.5, {})", "spawn('silverfish', x + 0.5, y + 0.5, z + 0.5, {})"],
  ['silk', 'if (!doTileDrops || silkTouch) return;', 'if (!doTileDrops) return;'],
  ['rule', "doTileDrops = NS.Commands.ruleGet('doTileDrops') !== 'false'", 'doTileDrops = true'],
  ['armed', 'this.canUse = function () { return delay > 0; };', 'this.canUse = function () { return false; };'],
  ['delay', 'SF.CALL_FOR_HELP_DELAY = 20;', 'SF.CALL_FOR_HELP_DELAY = 5;'],
  ['breaks', 'W.setBlock(bx, by, bz, 0);', ''],
  ['revert', 'if (reg !== null) W.setBlock(bx, by, bz, reg);', ''],
  ['range', 'dx <= 10 && dx >= -10', 'dx <= 20 && dx >= -20'],
  ['infest', 'e.removed = true;', ''],
  ['target', 'if (e.target) return false;', ''],
  ['grief', 'if (mobGriefing() && rand() < 0.1) {', 'if (rand() < 0.1) {'],
  ['nonInfestable', 'if (!SF.isInfestable(SR.name(st))) return null;', ''],
  ['favor', 'return st && SF.isInfestable(SR.name(st)) ? 10 : 0;', 'return 0;'],
];
for (const [key, a, b] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((f, s) => { if (f === F && s.includes(a)) { hit = true; return s.replace(a, b); } return s; }); } catch { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  ok(!X[key], 'anti-vacuity: break ' + key);
  if (!X[key]) console.log('  ✓ break caught: ' + key);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `silverfish11586check: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
