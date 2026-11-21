#!/usr/bin/env node
// redstone11592check.mjs — #11592: proves 07f_redstone.js ObserverBlock, RedstoneLampBlock, RedstoneTorchBlock,
// RepeaterBlock, StainedGlassBlock (never conducts), TargetBlock, ChestBlockEntity.getOpenCount and TickPriority
// through Behave.tick / Rs.targetHit / Rs.signal. Each source break must fail its row.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const EXTRA = ['02f_tags.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js', '14b_physics.js', '07f_redstone.js'];
function trial(patch) {
  const M = loadEngine({ extra: EXTRA, dom: false, ...(patch ? { patch } : {}) });
  const W = M.World, B = M.Behave, S = M.States, Rs = M.Redstone, BE = M.BlockEntities, o = {};
  B.init(W); BE.init(); Rs.init(); W.init(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) { const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
  const put = (x, y, z, n, props) => { let st = S.stateOf(n) | 0; for (const k of Object.keys(props || {})) st = B.setProp(st, k, props[k]); W.setBlock(x, y, z, st); if (B.changed) B.changed(x, y, z); Rs.update(x, y, z); };
  const prop = (x, y, z, k) => Number(B.propName(W.getBlock(x, y, z), k));
  const run = (n) => { for (let i = 0; i < n; i++) B.tick(); };
  const floor = (y) => { for (let x = -3; x <= 8; x++) for (let z = -3; z <= 3; z++) put(x, y, z, 'stone'); };
  floor(63);
  // lamp: lit when powered, goes out through its scheduled tick (4 ticks) once power is gone
  put(0, 64, 0, 'redstone_lamp'); put(1, 64, 0, 'redstone_block');
  run(1); o.lampOn = Rs.boolProp(W.getBlock(0, 64, 0), 'lit');
  put(1, 64, 0, 'air'); run(1); const still = Rs.boolProp(W.getBlock(0, 64, 0), 'lit'); run(6);
  o.lampOff = still && (Rs.boolProp(W.getBlock(0, 64, 0), 'lit') === false);
  // torch: on a block, lit; powering the block turns it off after its 2 tick delay
  put(0, 64, 2, 'stone'); put(0, 65, 2, 'redstone_torch');
  run(2); o.torchOn = (Rs.boolProp(W.getBlock(0, 65, 2), 'lit') === true);
  put(1, 64, 2, 'lever', { face: 'wall', facing: 'east', powered: true }); run(3);
  o.torchOff = (Rs.boolProp(W.getBlock(0, 65, 2), 'lit') === false);
  // repeater: facing east, input from a redstone block at west, delay 2 ticks per setting (delay 1 = 2 ticks)
  put(3, 64, -2, 'redstone_block'); put(4, 64, -2, 'repeater', { facing: 'west', delay: 1 });
  o.repDelay = Rs.repeaterDelay(W.getBlock(4, 64, -2)) === 2;
  B.schedule && 0;
  Rs.diodeCheck(4, 64, -2); const e0 = (Rs.boolProp(W.getBlock(4, 64, -2), 'powered') === false); run(3);
  o.repPowers = e0 && (Rs.boolProp(W.getBlock(4, 64, -2), 'powered') === true);
  put(3, 64, -2, 'air'); run(4); o.repOff = (Rs.boolProp(W.getBlock(4, 64, -2), 'powered') === false);
  // TickPriority: -3..0 and the diode choice of priority
  o.prio = Rs.PRIO_EXTREMELY_HIGH === -3 && Rs.PRIO_VERY_HIGH === -2 && Rs.PRIO_HIGH === -1 && Rs.PRIO_NORMAL === 0;
  const seen = []; const sch = B.schedule; B.schedule = function (x, y, z, d, p) { seen.push(p); return true; };
  put(6, 64, 1, 'repeater', { facing: 'west', delay: 1, powered: false });
  put(5, 64, 1, 'redstone_block'); seen.length = 0; Rs.diodeCheck(6, 64, 1);
  const turnOn = seen[0];
  put(6, 64, 1, 'repeater', { facing: 'west', delay: 1, powered: true }); put(5, 64, 1, 'air'); seen.length = 0; Rs.diodeCheck(6, 64, 1);
  const turnOff = seen[0];
  put(5, 64, 1, 'redstone_block'); put(6, 64, 1, 'repeater', { facing: 'west', delay: 1, powered: false });
  put(7, 64, 1, 'repeater', { facing: 'north', delay: 1 }); seen.length = 0; Rs.diodeCheck(6, 64, 1);
  const front = seen[0];
  B.schedule = sch;
  o.prioPick = turnOn === -1 && turnOff === -2 && front === -3;
  // observer: facing east, powered output goes backwards (west); only when powered and dir == facing
  put(0, 64, -3, 'observer', { facing: 'east', powered: true });
  const ob = W.getBlock(0, 64, -3);
  o.obsSig = Rs.signal(ob, Rs.facingDir(ob), 0, 64, -3) === 15;
  const n15 = [0, 1, 2, 3, 4, 5].filter(d => Rs.signal(ob, d, 0, 64, -3) === 15).length;
  o.obsOne = n15 === 1;
  put(0, 64, -3, 'observer', { facing: 'east', powered: false });
  o.obsOff = [0, 1, 2, 3, 4, 5].every(d => Rs.signal(W.getBlock(0, 64, -3), d, 0, 64, -3) === 0);
  // stained glass never conducts, stone does
  o.glass = Rs.isConductor(S.stateOf('red_stained_glass')) === false && Rs.isConductor(S.stateOf('stone')) === true;
  // target: centre hit = 15, edge hit lower, resets to 0 on its scheduled tick
  put(4, 64, 3, 'target');
  const c = Rs.targetHit(4, 64, 3, 4, 4.5, 64.5, 3.0, false, null);
  o.tgtHit = c === 15 && prop(4, 64, 3, 'power') === 15 && Rs.signal(W.getBlock(4, 64, 3), 1, 4, 64, 3) === 15;
  run(9); o.tgtReset = prop(4, 64, 3, 'power') === 0;
  const lo = Rs.targetHit(4, 64, 3, 4, 4.95, 64.5, 3.0, false, null);
  o.tgtEdge = lo > 0 && lo < 15;
  // chest block entity open count: trapped chest signal = opener count clamped 0..15
  put(7, 64, -2, 'trapped_chest'); const be = BE.get(7, 64, -2);
  o.chestBE = !!be; if (be) { be.open = 0; const z = Rs.chestOpenSignal(7, 64, -2); be.open = 2; const two = Rs.chestOpenSignal(7, 64, -2); be.open = 99; const big = Rs.chestOpenSignal(7, 64, -2);
    o.chestCount = z === 0 && two === 2 && big === 15; }
  return o;
}
const A = trial(null);
for (const k of Object.keys(A)) ok(A[k], 'scenario ' + k + ' ' + JSON.stringify(A));
const BR = [
  ['lampOff', /if \(boolProp\(st, 'lit'\) && !\(Rs\.receivedPower\(x, y, z\) > 0\)\)/, "if (false)"],
  ['prio', /Rs\.PRIO_EXTREMELY_HIGH = -3;/, 'Rs.PRIO_EXTREMELY_HIGH = -1;'],
  ['prioPick', /\? Rs\.PRIO_EXTREMELY_HIGH\n\s*: \(powered \? Rs\.PRIO_VERY_HIGH : Rs\.PRIO_HIGH\)/, '? Rs.PRIO_HIGH : Rs.PRIO_HIGH'],
  ['repDelay', /Rs\.repeaterDelay = function \(state\) \{ return \(B\.propName\(state, 'delay'\) \| 0\) \* 2; \}/, "Rs.repeaterDelay = function (state) { return (B.propName(state, 'delay') | 0) * 3; }"],
  ['tgtReset', /if \(\(B\.propName\(st, 'power'\) \| 0\) !== 0\) \{\n\s*W\.setBlock\(x, y, z, B\.setProp\(st, 'power', 0\)\);/, "if (false) {"],
  ['tgtHit', /Math\.ceil\(15 \* Math\.min/, 'Math.ceil(7 * Math.min'],
  ['chestCount', /return n < 0 \? 0 : \(n > Rs\.MAX \? Rs\.MAX : n\);/, 'return n ? 15 : 0;'],
  ['glass', /'brown_stained_glass', 'green_stained_glass', 'red_stained_glass'/g, "'xred_stained_glass'"],
  ['obsSig', /return facingDir\(state\) === dir \? Rs\.MAX : 0;/, 'return facingDir(state) !== dir ? Rs.MAX : 0;'],
];
for (const [key, re, rep] of BR) {
  breaks++;
  const src = readFileSync(join(MCLITE_ROOT, 'src/07f_redstone.js'), 'utf8');
  if (!re.test(src)) { fails.push('no-op break: ' + key); continue; }
  let B; try { B = trial((f, s) => f === '07f_redstone.js' ? s.replace(re, rep) : s); } catch { B = {}; }
  ok(!B[key], 'anti-vacuity: break ' + key);
  if (!B[key]) console.log('  ✓ break caught: ' + key);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `redstone11592check: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
