// waterloggingcheck.mjs — #10622: waterlogging vs the real 1.18.2 data (pc blocks.json, generated
// from the server's own block registry).
//
//   node tools/waterloggingcheck.mjs
//
// For every state of every block with a `waterlogged` property: the engine's property value, its
// `waterIn` cell flag and its `fluidKind`/`fluidAmt` (vanilla getFluidState) must equal the data's;
// the block's default state must agree; and the named water-filled blocks (kelp, seagrass, bubble
// column) hold water with no property. Anti-vacuity: the comparison is re-run on corrupted copies.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

const M = loadEngine({ extra: ['02f_tags.js'], dom: false });
initRegistry(M);
const SR = M.States, R = M.Reg;
const pc = JSON.parse(readFileSync(join(MCLITE_ROOT, '.mcdata', 'pc', 'blocks.json'), 'utf8'));
const fails = []; let pass = 0;
const ok = (c, m) => { if (c) pass++; else if (fails.length < 30) fails.push(m); return c; };

// the vanilla fact: value of `waterlogged` in local state index i (last property varies fastest)
function wlOf(b, i) {
  let stride = 1, v = null;
  for (let k = b.states.length - 1; k >= 0; k--) {
    const p = b.states[k], n = p.num_values, idx = Math.floor(i / stride) % n;
    if (p.name === 'waterlogged') v = idx === 0; // bool values are listed true,false
    stride *= n;
  }
  return v;
}

// compare; `mut` lets the anti-vacuity pass corrupt either side
function compare(blocks, getWl, getIn, getKind) {
  let bad = 0, checked = 0;
  for (const b of blocks) {
    if (!b.states.some(p => p.name === 'waterlogged')) continue;
    const base = SR.stateOf(b.name) - (b.defaultState - b.minStateId);
    for (let i = 0; i <= b.maxStateId - b.minStateId; i++) {
      const st = base + i, want = wlOf(b, i); checked++;
      if (getWl(st, b, i) !== want || getIn(st) !== (want ? 1 : 0) || getKind(st) !== (want ? 1 : 0)) bad++;
    }
  }
  return { bad, checked };
}
const realWl = (st) => SR.propValue(st, R.PROP.waterlogged) === R.PVAL['true'];
const realIn = (st) => SR.waterIn[st] ? 1 : 0;
const realKind = (st) => SR.fluidKind[st] === 1 ? 1 : 0;

const wlBlocks = pc.filter(b => b.states.some(p => p.name === 'waterlogged'));
ok(wlBlocks.length >= 50, 'data has the waterloggable blocks (' + wlBlocks.length + ')');
const r = compare(pc, realWl, realIn, realKind);
ok(r.checked > 2000, 'states checked: ' + r.checked);
ok(r.bad === 0, r.bad + ' waterlogged states disagree with the real data');

// defaults: vanilla default state's waterlogged value (sea_pickle/conduit/kelp-like default true)
for (const b of wlBlocks) {
  const d = SR.stateOf(b.name);
  ok(realWl(d) === wlOf(b, b.defaultState - b.minStateId), b.name + ' default waterlogged differs');
  ok(SR.name(d) === b.name, b.name + ' name round-trip');
}
ok(realWl(SR.stateOf('sea_pickle')) && realWl(SR.stateOf('conduit')), 'sea_pickle and conduit default waterlogged');
ok(!realWl(SR.stateOf('oak_slab')), 'oak_slab defaults dry');

// property-less water holders; water block itself
for (const n of ['kelp', 'kelp_plant', 'seagrass', 'tall_seagrass', 'bubble_column'])
  ok(SR.waterIn[SR.stateOf(n)] === 1 && SR.fluidKind[SR.stateOf(n)] === 1, n + ' holds water');
ok(SR.fluidKind[SR.stateOf('water')] === 1 && SR.fluidKind[SR.stateOf('lava')] === 2, 'water/lava fluid kinds');
ok(!SR.waterIn[SR.stateOf('stone')] && !SR.fluidKind[SR.stateOf('stone')], 'stone holds no fluid');
// every waterIn state is explained by the data (waterlogged=true) or the named list
const named = new Set(['water', 'kelp', 'kelp_plant', 'seagrass', 'tall_seagrass', 'bubble_column']);
const wlNames = new Set(wlBlocks.map(b => b.name));
let extra = 0;
for (let st = 1; st < SR.count; st++) if (SR.waterIn[st]) {
  const nm = SR.name(st);
  if (!(named.has(nm) || (wlNames.has(nm) && realWl(st)))) extra++;
}
ok(extra === 0, extra + ' waterIn states are not waterlogged/named in the real data');

// anti-vacuity: corrupted comparisons must be caught
let breaks = 0;
const brk = (label, res) => { if (res.bad > 0) { breaks++; pass++; } else fails.push('anti-vacuity: ' + label + ' not caught'); };
brk('flipped property', compare(pc, (st, b, i) => !realWl(st), realIn, realKind));
brk('flipped waterIn', compare(pc, realWl, (st) => 1 - realIn(st), realKind));
brk('dropped fluidKind', compare(pc, realWl, realIn, () => 0));
{ const s = SR.stateOf('oak_slab'); const save = SR.waterIn.slice(); for (let i = 0; i < 6; i++) SR.waterIn[s + i] ^= 1;
  brk('engine table tampered', compare(pc, realWl, realIn, realKind)); SR.waterIn.set(save); }
brk('shifted state ids', compare(pc.map(b => ({ ...b, defaultState: b.defaultState + 1 })), realWl, realIn, realKind));

console.log(fails.length ? 'FAIL\n' + fails.join('\n') : pass + ' assertions, 0 failures, ' + breaks + ' breaks caught');
process.exit(fails.length ? 1 : 0);
