#!/usr/bin/env node
// redlitcheck.mjs — #4946: every redstone powered-state VISUAL against vanilla.
//  1. redstone_wire's tint is the 16-step power ramp (RedstoneWireBlock.COLORS), not the biome grass map, and rises with power.
//  2. each component's powered/lit/extended state meshes to DIFFERENT quads (model or tile) than its off state (vanilla blockstate JSON).
//  3. block-light of lit lamp/torch/ore (emitstatecheck owns the full table; spot-checked here with the visual flip).
// Anti-vacuity: breaks its own data (flat ramp, identical models, dead emission) and must fail each.
import { loadEngine } from './loadsrc.mjs';
const MCL = loadEngine({});
const S = MCL.States, R = MCL.Reg, M = MCL.Mesher;
const st = (n, props) => { let s = S.stateOf(n); if (!s) throw new Error('no block ' + n); for (const [p, v] of Object.entries(props || {})) s = S.withProp(s, R.PROP[p], R.PVAL[String(v)]); return s; };
function quads(state) {
  const vs = R.toVisual[state], out = [];
  for (let g = 0; g < R.groupCount(vs); g++) {
    const p = R.partFor(vs, g, 0, 0, 0);
    for (let q = R.partOff[p]; q < R.partOff[p + 1]; q++) out.push(R.qTile[q] + ':' + Array.from(R.qPos.subarray(q * 12, q * 12 + 12)).join(','));
  }
  return out.sort().join('|');
}
// [block, off props, on props]. NOT listed because vanilla's blockstate is identical for both (only light/particles/BE differ): lit ores,
// daylight power, lectern has_book, tripwire attached. All below have a differing blockstate model in 1.18.2
const PAIRS = [
  ['redstone_lamp', { lit: false }, { lit: true }], ['redstone_torch', { lit: false }, { lit: true }],
  ['redstone_wall_torch', { lit: false, facing: 'north' }, { lit: true, facing: 'north' }],
  ['repeater', { powered: false, facing: 'north', delay: 1, locked: false }, { powered: true, facing: 'north', delay: 1, locked: false }],
  ['comparator', { powered: false, facing: 'north', mode: 'compare' }, { powered: true, facing: 'north', mode: 'compare' }],
  ['comparator', { powered: false, facing: 'north', mode: 'compare' }, { powered: false, facing: 'north', mode: 'subtract' }],
  ['observer', { powered: false, facing: 'north' }, { powered: true, facing: 'north' }],
  ['powered_rail', { powered: false, shape: 'north_south' }, { powered: true, shape: 'north_south' }],
  ['detector_rail', { powered: false, shape: 'north_south' }, { powered: true, shape: 'north_south' }],
  ['activator_rail', { powered: false, shape: 'north_south' }, { powered: true, shape: 'north_south' }],
  ['piston', { extended: false, facing: 'north' }, { extended: true, facing: 'north' }],
  ['sticky_piston', { extended: false, facing: 'north' }, { extended: true, facing: 'north' }],
  ['piston_head', { type: 'normal', facing: 'north', short: false }, { type: 'sticky', facing: 'north', short: false }],
  ['lever', { powered: false, face: 'wall', facing: 'north' }, { powered: true, face: 'wall', facing: 'north' }],
  ['stone_button', { powered: false, face: 'wall', facing: 'north' }, { powered: true, face: 'wall', facing: 'north' }],
  ['oak_button', { powered: false, face: 'wall', facing: 'north' }, { powered: true, face: 'wall', facing: 'north' }],
  ['stone_pressure_plate', { powered: false }, { powered: true }], ['oak_pressure_plate', { powered: false }, { powered: true }],
  ['heavy_weighted_pressure_plate', { power: 0 }, { power: 1 }], ['light_weighted_pressure_plate', { power: 0 }, { power: 1 }],
  ['daylight_detector', { inverted: false, power: 0 }, { inverted: true, power: 0 }],
  ['tripwire_hook', { powered: false, attached: false, facing: 'north' }, { powered: true, attached: true, facing: 'north' }],
  ['target', null, null], // no state: always the same model (vanilla: power is not visual)
  ['bell', { attachment: 'floor', facing: 'north', powered: false }, { attachment: 'ceiling', facing: 'north', powered: false }],
  ['sculk_sensor', { sculk_sensor_phase: 'inactive', power: 0, waterlogged: false }, { sculk_sensor_phase: 'active', power: 0, waterlogged: false }],
  ['redstone_wire', { north: 'none', south: 'none', east: 'none', west: 'none', power: 0 }, { north: 'side', south: 'side', east: 'none', west: 'none', power: 0 }],
  ['redstone_wire', { north: 'side', south: 'side', east: 'none', west: 'none', power: 0 }, { north: 'up', south: 'side', east: 'none', west: 'none', power: 0 }],
];
function run(brk) {
  const bad = [];
  // 1. wire ramp
  const prev = [-1, -1, -1];
  for (let p = 0; p < 16; p++) {
    const t = M.wireTint(st('redstone_wire', { power: p }));
    if (!t) { bad.push('wire power ' + p + ' untinted'); continue; }
    const c = brk === 'ramp' ? [3, 0, 0] : t;
    const vr = Math.round((p > 0 ? 0.4 + 0.6 * p / 15 : 0.3) * 7), vg = Math.round(Math.max(0, 0.7 * (p / 15) ** 2 - 0.5) * 7);
    if (c[0] !== vr || c[1] !== vg || c[2] !== 0) bad.push(`wire power ${p}: ${c}, want ${[vr, vg, 0]}`);
    if (c[0] < prev[0]) bad.push('red not monotonic at ' + p);
    prev[0] = c[0];
  }
  if (M.wireTint(st('redstone_wire', { power: 0 }))[0] >= M.wireTint(st('redstone_wire', { power: 15 }))[0]) bad.push('power 0 not darker than 15');
  if (M.wireTint(st('stone')) !== null || M.wireTint(st('grass_block')) !== null) bad.push('non-wire tinted');
  // 2. visual flips
  for (const [n, a, b] of PAIRS) {
    if (!a) { if (!S.stateOf(n)) bad.push('no ' + n); continue; }
    const qa = quads(st(n, a)), qb = brk === 'model' ? qa : quads(st(n, b));
    if (qa === qb) bad.push(`${n} ${JSON.stringify(a)} vs ${JSON.stringify(b)}: same quads`);
  }
  // 3. light flips with the visual
  for (const n of ['redstone_lamp', 'redstone_torch', 'redstone_ore']) {
    const on = S.emit[st(n, { lit: true })] - (brk === 'emit' ? 99 : 0), off = S.emit[st(n, { lit: false })];
    const want = { redstone_lamp: 15, redstone_torch: 7, redstone_ore: 9 }[n];
    if (on !== want || off !== 0) bad.push(`${n} emit lit ${on} unlit ${off}`);
  }
  return bad;
}
const base = run();
if (base.length) { console.log('FAIL\n ' + base.join('\n ')); process.exit(1); }
let caught = 0;
for (const b of ['ramp', 'model', 'emit']) if (run(b).length) { caught++; console.log('✓ break ' + b + ' caught'); }
if (caught !== 3) { console.log('FAIL: only ' + caught + '/3 breaks caught'); process.exit(1); }
console.log(`OK  ${16 + PAIRS.length + 3} checks passed, 0 failures; wire ramp x16, ${PAIRS.length} visual pairs, 3 emit; ${caught} breaks caught`);
