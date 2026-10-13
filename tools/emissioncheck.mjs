#!/usr/bin/env node
// emissioncheck.mjs — block-light emission is per STATE (#356).
//
// Vanilla Blocks.java sets luminance with a lambda over the state (createLightLevelFromLitBlockState,
// CandleBlock.STATE_TO_LUMINANCE, SeaPickleBlock, RespawnAnchorBlock.getLightLevel, LightBlock, CaveVines,
// GlowLichenBlock). This decodes every real state's properties by its own mixed-radix walk and asserts
// States.emit against those lambdas; then named lit/unlit rows; then proves it can fail.
import { loadEngine } from './loadsrc.mjs';

const M = loadEngine({});
const R = M.Reg, S = M.States;
const fails = []; let pass = 0, breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
console.log('emissioncheck — per-state block light emission');

// decode a real state into {prop: valueName}, without using States.propValue
function props(st) {
  const b = S.block[st], local = st - R.realFirst[b], o = {};
  for (let k = R.propFirst[b]; k < R.propFirst[b + 1]; k++)
    o[R.propNames[R.propId[k]]] = R.valueNames[R.propVals[R.propValOff[k] + (((local / R.propStride[k]) | 0) % R.propValN[k])]];
  return o;
}
const T = 'true', LIT = { furnace: 13, smoker: 13, blast_furnace: 13, redstone_ore: 9, deepslate_redstone_ore: 9,
  redstone_torch: 7, redstone_wall_torch: 7, redstone_lamp: 15, campfire: 15, soul_campfire: 10 };
function expected(name, p) {
  if (LIT[name] !== undefined) return p.lit === T ? LIT[name] : 0;
  if (name === 'candle' || name.endsWith('_candle')) return p.lit === T ? 3 * +p.candles : 0;
  if (name.endsWith('candle_cake')) return p.lit === T ? 3 : 0;
  if (name === 'sea_pickle') return p.waterlogged === T ? 3 + 3 * +p.pickles : 0;
  if (name === 'respawn_anchor') return Math.floor(+p.charges / 4 * 15);
  if (name === 'light') return +p.level;
  if (name === 'cave_vines' || name === 'cave_vines_plant') return p.berries === T ? 14 : 0;
  if (name === 'glow_lichen') return ['north', 'east', 'south', 'west', 'up', 'down'].some((d) => p[d] === T) ? 7 : 0;
  return undefined;
}

function sweep() {
  let bad = 0, n = 0;
  for (let b = 0; b < R.blockCount; b++) {
    for (let st = R.realFirst[b]; st < R.realFirst[b + 1]; st++) {
      const e = expected(R.names[b], props(st));
      if (e === undefined) continue;
      n++;
      if (S.emit[st] !== e) { bad++; if (bad <= 3 && !breaking) fails.push(`${R.names[b]} ${JSON.stringify(props(st))}: emit ${S.emit[st]}, vanilla ${e}`); }
    }
  }
  return { bad, n };
}
let breaking = false;
const r = sweep();
ok(r.n > 400 && r.bad === 0, `every per-state emitter matches (${r.n} states, ${r.bad} wrong)`);

// named rows
const row = (name, want) => {
  const b = R.index ? R.index[name] : R.names.indexOf(name);
  for (const [pr, val, e] of want) {
    let hit = 0;
    for (let st = R.realFirst[b]; st < R.realFirst[b + 1]; st++) {
      const p = props(st);
      if (pr.every(([k, v]) => p[k] === v)) { hit++; ok(S.emit[st] === e, `${name} ${pr.map((x) => x.join('=')).join(',')} -> ${e}, got ${S.emit[st]}`); }
    }
    ok(hit > 0, `${name} row ${val} matched a state`);
  }
};
row('redstone_lamp', [[[['lit', 'true']], 'lit', 15], [[['lit', 'false']], 'unlit', 0]]);
row('furnace', [[[['lit', 'true']], 'lit', 13], [[['lit', 'false']], 'unlit', 0]]);
row('redstone_torch', [[[['lit', 'true']], 'lit', 7], [[['lit', 'false']], 'unlit', 0]]);
row('campfire', [[[['lit', 'true']], 'lit', 15], [[['lit', 'false']], 'unlit', 0]]);
row('soul_campfire', [[[['lit', 'true']], 'lit', 10], [[['lit', 'false']], 'unlit', 0]]);
row('candle', [[[['lit', 'true'], ['candles', '4']], '4 lit', 12], [[['lit', 'false'], ['candles', '4']], '4 unlit', 0]]);
row('light', [[[['level', '3']], 'level 3', 3]]);
row('sea_pickle', [[[['waterlogged', 'true'], ['pickles', '4']], 'wet 4', 15], [[['waterlogged', 'false'], ['pickles', '4']], 'dry', 0]]);
row('respawn_anchor', [[[['charges', '0']], '0', 0], [[['charges', '4']], '4', 15]]);
row('glow_lichen', [[[['north', 'true'], ['south', 'false'], ['east', 'false'], ['west', 'false'], ['up', 'false'], ['down', 'false']], 'a face', 7]]);
row('cave_vines', [[[['berries', 'true']], 'berries', 14], [[['berries', 'false']], 'bare', 0]]);

// anti-vacuity: refill per block (the bug) and per-state tampering must each be caught
const saved = S.emit.slice();
const caught = (m) => { const q = sweep(); if (q.bad > 0) { breaks++; console.log('   ✓ break caught: ' + m); } else fails.push('anti-vacuity: ' + m + ' not caught'); S.emit.set(saved); };
breaking = true;
for (let b = 0; b < R.blockCount; b++) for (let st = R.realFirst[b]; st < R.realFirst[b + 1]; st++) S.emit[st] = R.emit[b];
caught('emission refilled per block from the dataset');
S.emit[S.stateOf('redstone_lamp')] = 0; S.emit[S.stateOf('redstone_lamp') + 1] = 0; S.emit.fill(0, R.realFirst[R.names.indexOf('light')], R.realFirst[R.names.indexOf('light') + 1]);
caught('lamp and light zeroed');
{ const b = R.names.indexOf('sea_pickle'); S.emit.fill(6, R.realFirst[b], R.realFirst[b + 1]); caught('sea pickle flat 6'); }

if (fails.length) { console.log('FAIL'); fails.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
console.log(` assertions passed ... ${pass}\n failures ........... 0\n breaks caught ...... ${breaks}`);
