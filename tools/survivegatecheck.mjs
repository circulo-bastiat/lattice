#!/usr/bin/env node
// survivegatecheck.mjs — #19 (KW-25): WORLDGEN ASKS THE SAME SURVIVAL RULE THE LIVE GAME DOES.
//
//   node tools/survivegatecheck.mjs
//
// `NS.Survive` (src/02k_survive.js) is vanilla's `canSurvive` rules written once against a LEVEL. The
// live world's level is `World`; worldgen's is the scratch buffer in `Features.supported`, and the
// chunk workers answer the eleven block tags the rules ask out of `worldgen.bin` (`WG.ruleTag`)
// because `02f_tags.js` is main-thread only. Four things can rot, and each has a section:
//
//   1. THE ELEVEN TAGS ARE ONE LIST in the rules' source, the packer and the runtime, so a twelfth
//      question cannot be added to a rule and silently answered "cannot tell" on the workers.
//   2. THE WORKERS' ANSWER IS THE MAIN THREAD'S, for every real state — not a sample.
//   3. THE WRITE DOOR APPLIES THE RULE: a rail, a lever and a cactus have no support class, so before
//      #19 they were placed anywhere; a vine keeps a good face and loses a dead one; a lichen is
//      refused on the first dead face; a cocoa looks along its facing.
//   4. ANTI-VACUITY: each of those is broken on purpose and must be caught.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };

console.log('survivegatecheck — #19: one survival rule, two doors');

const M = loadEngine({ extra: ['02f_tags.js'] });
const SR = M.States, R = M.Reg, F = M.Features, CFG = M.CFG;
M.Gen.init(1337, M.Gen.defaults());
ok(SR.ready && M.Survive, 'the state tables and NS.Survive are up');

// ═══════════════ 1. the eleven tags are one list ═══════════════════════════════════════════
console.log('\n 1. the tags the rules ask are the tags the packer ships and the workers index');
const rd = (f) => readFileSync(join(MCLITE_ROOT, f), 'utf8');
const rules = rd('src/02k_survive.js');
const asked = new Set();
for (const m of rules.matchAll(/tagQ\(L, '([a-z_]+)'/g)) asked.add(m[1]);
for (const m of rules.matchAll(/L\.tag\('([a-z_]+)'/g)) asked.add(m[1]);
const listOf = (src, re) => { const m = src.match(re); return m ? [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]) : []; };
const packed = new Set(listOf(rd('tools/pack-worldgen.mjs'), /const RULE_TAGS = \[([^\]]*)\]/));
const indexed = new Set(listOf(rd('src/02c_states.js'), /var names = \[([^\]]*'fence_gates'[^\]]*)\]/));
ok(asked.size >= 10, `the rules ask ${asked.size} tags — the scan read nothing`);
const same = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
ok(same(asked, packed), `the rules ask {${[...asked].sort()}} but pack-worldgen ships {${[...packed].sort()}}`);
ok(same(asked, indexed), `the rules ask {${[...asked].sort()}} but States indexes {${[...indexed].sort()}}`);

// ═══════════════ 2. worker answer == main-thread answer, every state ═══════════════════════
console.log('\n 2. States.inRuleTag answers exactly what Tags.stateIn does, for every state');
{
  let checked = 0, differ = 0, first = '';
  for (const t of asked) {
    for (let st = 1; st < SR.count; st++) {
      const a = SR.inRuleTag(t, st), b = M.Tags.stateIn(t, st) ? 1 : 0;
      checked++;
      if (a !== b) { differ++; if (!first) first = `${t} / ${SR.name(st)}: worker ${a}, main ${b}`; }
    }
  }
  ok(checked > 100000, `only ${checked} (tag,state) pairs compared`);
  ok(differ === 0, `${differ} of ${checked} answers differ — first ${first}`);
  ok(SR.inRuleTag('not_a_rule_tag', 1) === -1, 'a tag that is not one of the eleven answers -1 ("cannot tell"), not 0');
  // anti-vacuity: drop grass_block from #dirt in the worker table and the comparison must see it
  const set = SR.ruleTagSet.dirt, g = SR.block[SR.stateOf('grass_block')], keep = set[g];
  set[g] = 0;
  okAv(SR.inRuleTag('dirt', SR.stateOf('grass_block')) !== (M.Tags.stateIn('dirt', SR.stateOf('grass_block')) ? 1 : 0),
       'removing grass_block from the worker #dirt set is a visible disagreement');
  set[g] = keep;
}

// ═══════════════ 3. the write door applies the rule ════════════════════════════════════════
console.log('\n 3. Features.setBlock refuses what the jar rule refuses');
const MINY = CFG.WORLD_MIN_Y, H = CFG.CHUNK_H;
const CX = 3, CZ = 3;                                  // an arbitrary target chunk, far from any seam
const stateWith = (name, props) => {
  const base = SR.stateOf(name);
  outer: for (let s = 1; s < SR.count; s++) {
    if (SR.block[s] !== SR.block[base]) continue;
    for (const k of Object.keys(props)) {
      const pi = R.PROP[k], pv = R.PVAL[props[k]];
      if (pi === undefined || pv === undefined || SR.propValue(s, pi) !== pv) continue outer;
    }
    return s;
  }
  return 0;
};
const WX = CX * 16 + 8, WZ = CZ * 16 + 8, WY = 100;
// place `st` at the centre of an otherwise-empty chunk with `nbrs` = [[dx,dy,dz,name|state]]
function place(nbrs, st) {
  const SB = new Uint16Array(H * 256);
  const at = (x, y, z) => ((y - MINY) << 8) | ((z - CZ * 16) << 4) | (x - CX * 16);
  for (const [dx, dy, dz, n] of nbrs) SB[at(WX + dx, WY + dy, WZ + dz)] = typeof n === 'number' ? n : SR.stateOf(n);
  const r = F.api.setBlock(SB, CX, CZ, WX, WY, WZ, typeof st === 'number' ? st : SR.stateOf(st));
  return r === 1;
}
const trial = (label, nbrs, st, want) => ok(place(nbrs, st) === want, `${label}: expected ${want ? 'placed' : 'refused'}`);
// rail: a RIGID face below. No support class, so worldgen used to write it in mid-air.
trial('a rail is placed on stone', [[0, -1, 0, 'stone']], 'rail', true);
trial('a rail in mid-air is refused (no support class: only the jar rule says so)', [], 'rail', false);
trial('a cactus is refused where it touches stone', [[0, -1, 0, 'sand'], [1, 0, 0, 'stone']], 'cactus', false);
trial('and placed on sand with clear sides', [[0, -1, 0, 'sand']], 'cactus', true);
const vineNW = stateWith('vine', { north: 'true', south: 'false', east: 'false', west: 'true', up: 'false' });
trial('a vine with one good side and one dead side is placed (vanilla drops the dead face)', [[0, 0, -1, 'stone']], vineNW, true);
trial('and with both sides dead it is refused', [], vineNW, false);
const lichenDU = stateWith('glow_lichen', { down: 'true', up: 'true', north: 'false', south: 'false', east: 'false', west: 'false' });
trial('glow lichen with a dead face is refused, all-or-nothing', [[0, -1, 0, 'stone']], lichenDU, false);
const lichenD = stateWith('glow_lichen', { down: 'true', up: 'false', north: 'false', south: 'false', east: 'false', west: 'false' });
trial('and placed when its one face is on stone', [[0, -1, 0, 'stone']], lichenD, true);
// tag rules, answered by the worker table: a small dripleaf needs its own tag; a dandelion needs #dirt
trial('a small dripleaf is placed on clay (#small_dripleaf_placeable, answered from worldgen.bin)', [[0, -1, 0, 'clay']], stateWith('small_dripleaf', { half: 'lower' }), true);
trial('and refused on stone', [[0, -1, 0, 'stone']], stateWith('small_dripleaf', { half: 'lower' }), false);
trial('its upper half is placed on its own lower half', [[0, -1, 0, stateWith('small_dripleaf', { half: 'lower' })]], stateWith('small_dripleaf', { half: 'upper' }), true);
trial('and refused on clay (the upper half never asks the ground)', [[0, -1, 0, 'clay']], stateWith('small_dripleaf', { half: 'upper' }), false);
trial('a bamboo sapling is placed on dirt (#bamboo_plantable_on)', [[0, -1, 0, 'dirt']], 'bamboo', true);
// the stem is NOT asked at write time: block_column writes the stem before the head above it
trial('a big dripleaf stem is written with air above it (block_column never asks — vanilla parity)',
      [[0, -1, 0, 'clay']], stateWith('big_dripleaf_stem', {}), true);
// cocoa looks ALONG its facing, at a jungle log
trial('cocoa facing a jungle log is placed', [[0, 0, -1, 'jungle_log']], stateWith('cocoa', { facing: 'north', age: '0' }), true);
trial('and refused when it faces air, even with a log behind it', [[0, 0, 1, 'jungle_log']], stateWith('cocoa', { facing: 'north', age: '0' }), false);

// ═══════════════ 4. anti-vacuity: the door, broken ═════════════════════════════════════════
console.log('\n 4. break the door and watch the trials fail');
{
  const keep = M.Survive.eval;
  M.Survive.eval = () => -1;                          // pre-#19 worldgen: the class alone decides
  okAv(place([], 'rail') === true, 'with the rule stubbed out a rail is placed in mid-air again');
  okAv(place([[0, -1, 0, 'stone']], lichenDU) === true, 'with the rule stubbed out a lichen with a dead face is placed');
  M.Survive.eval = keep;
  okAv(place([], 'rail') === false, 'and with the rule back the same rail is refused');
  // a level that cannot answer tags must fall through, not refuse: the rule says -1, the class decides
  const dead = { miss: false, getBlock: () => 0, loadedAt: () => true, tag: () => -1, light: () => -1, sky: () => -1 };
  const dandelion = SR.stateOf('dandelion');
  okAv(M.Survive.eval(dead, 0, 0, 0, dandelion, SR.rule[dandelion]) === -1, 'a level with no tag answers makes the bush rule "no opinion" (-1)');
  const yes = Object.assign({}, dead, { tag: () => 1 });
  okAv(M.Survive.eval(yes, 0, 0, 0, dandelion, SR.rule[dandelion]) === 1, 'and a level that answers yes makes it 1');
}

console.log('\n==============================================================================');
console.log(` survivegatecheck: ${pass} assertions, ${fails.length} failed, ${breaks} breaks caught`);
for (const f of fails) console.log('   x ' + f);
process.exit(fails.length ? 1 : 0);
