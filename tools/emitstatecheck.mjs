#!/usr/bin/env node
// emitstatecheck.mjs — #406: block-light emission is per STATE (vanilla `AbstractBlockState.getLuminance`), not per block.
// Known vanilla values (Blocks.java lambdas, tools/golden/luminance-1.18.2.tsv) against SR.emit[state], plus a full sweep:
// every state of every golden block must equal an independent evaluation of its rule. Anti-vacuity: reverting SR.emit to
// the per-block value must fail the same checks.
import { readFileSync } from 'node:fs';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const MCL = loadEngine({});
const SR = MCL.States, R = MCL.Reg;
function st(name, props) {
  let s = SR.stateOf(name);
  if (!s) throw new Error('no block ' + name);
  for (const [p, v] of Object.entries(props || {})) {
    if (R.PROP[p] === undefined) throw new Error(name + ' has no property ' + p);
    s = SR.withProp(s, R.PROP[p], R.PVAL[String(v)]);
  }
  return s;
}
const cases = [
  ['furnace lit', 'furnace', { lit: true }, 13], ['furnace unlit', 'furnace', { lit: false }, 0],
  ['smoker lit', 'smoker', { lit: true }, 13], ['smoker unlit', 'smoker', { lit: false }, 0],
  ['blast_furnace lit', 'blast_furnace', { lit: true }, 13], ['blast_furnace unlit', 'blast_furnace', { lit: false }, 0],
  ['redstone_ore lit', 'redstone_ore', { lit: true }, 9], ['redstone_ore unlit', 'redstone_ore', { lit: false }, 0],
  ['redstone_lamp lit', 'redstone_lamp', { lit: true }, 15], ['redstone_lamp unlit', 'redstone_lamp', { lit: false }, 0],
  ['campfire lit', 'campfire', { lit: true }, 15], ['campfire unlit', 'campfire', { lit: false }, 0],
  ['candle 1 lit', 'candle', { candles: 1, lit: true }, 3], ['candle 4 lit', 'candle', { candles: 4, lit: true }, 12],
  ['candle 4 unlit', 'candle', { candles: 4, lit: false }, 0], ['candle_cake lit', 'candle_cake', { lit: true }, 3],
  ['light 0', 'light', { level: 0 }, 0], ['light 3', 'light', { level: 3 }, 3], ['light 15', 'light', { level: 15 }, 15],
  ['sea_pickle 1 wet', 'sea_pickle', { pickles: 1, waterlogged: true }, 6], ['sea_pickle 4 wet', 'sea_pickle', { pickles: 4, waterlogged: true }, 15],
  ['sea_pickle 4 dry', 'sea_pickle', { pickles: 4, waterlogged: false }, 0],
  ['respawn_anchor 0', 'respawn_anchor', { charges: 0 }, 0], ['respawn_anchor 1', 'respawn_anchor', { charges: 1 }, 3],
  ['respawn_anchor 4', 'respawn_anchor', { charges: 4 }, 15],
  ['cave_vines berries', 'cave_vines', { berries: true }, 14], ['cave_vines bare', 'cave_vines', { berries: false }, 0],
  ['torch', 'torch', {}, 14],
];
function run() {
  const bad = [];
  for (const [label, name, props, want] of cases) {
    const got = SR.emit[st(name, props)];
    if (got !== want) bad.push(`${label}: ${got}, want ${want}`);
  }
  // sweep: every state of a `lit`/`candles`/`level` block against the rule, read from the golden
  const rows = readFileSync(MCLITE_ROOT + 'tools/golden/luminance-1.18.2.tsv', 'utf8').split(/\r?\n/).filter((l) => l && l[0] !== '#').map((l) => l.split('\t'));
  for (const [name, rule, k] of rows) {
    const b = R.id[name]; if (b === undefined) { bad.push('block missing: ' + name); continue; }
    for (let s = R.realFirst[b]; s < R.realFirst[b + 1]; s++) {
      const has = (p) => R.PROP[p] !== undefined;
      const val = (p) => R.valueNames[SR.propValue(s, R.PROP[p])];
      let want = null;
      if (rule === 'const') want = +k;
      else if (rule === 'lit') want = val('lit') === 'true' ? +k : 0;
      else if (rule === 'candles') want = val('lit') === 'true' ? 3 * +val('candles') : 0;
      else if (rule === 'level') want = +val('level');
      else if (rule === 'pickle') want = val('waterlogged') === 'true' ? 3 + 3 * +val('pickles') : 0;
      else if (rule === 'berries') want = val('berries') === 'true' ? +k : 0;
      else if (rule === 'anchor') want = Math.floor(+val('charges') / 4 * 15);
      if (want !== null && SR.emit[s] !== want) { bad.push(`${name} state ${s - R.realFirst[b]}: ${SR.emit[s]}, want ${want}`); break; }
    }
  }
  return bad;
}
const bad = run();
for (const b of bad.slice(0, 20)) console.error(' x ' + b);
let breaks = 0;
// break 1: per-block emission (the #406 bug)
const saved = SR.emit.slice();
for (let s = 0; s < SR.count; s++) SR.emit[s] = R.emit[SR.block[s]];
if (run().length) breaks++; else console.error(' x break "per-block emit" was NOT caught');
// break 2: one state off by one
SR.emit.set(saved);
SR.emit[st('furnace', { lit: true })] = 12;
if (run().length) breaks++; else console.error(' x break "furnace 12" was NOT caught');
SR.emit.set(saved);
console.log(` ${cases.length} cases, ${bad.length} failures, ${breaks} breaks caught`);
if (bad.length || breaks < 2) process.exit(1);
