#!/usr/bin/env node
// oxidize11580check.mjs — #11580: proves 07zze_oxidize.js's Degradable/Oxidizable/OxidizableBlock/Slab/Stairs through
// Behave.randomTick (the real random-tick entry, rules table wired at Behave.init) and HoneycombItem via Ox.waxed/unwaxed
// (what 14l_use.js calls). Each source break must fail its row.
import { loadEngine } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const EXTRA = ['02f_tags.js', '07_world.js', '07b_behaviour.js', '07zze_oxidize.js'];
function trial(patch) {
  const M = loadEngine({ extra: EXTRA, dom: false, ...(patch ? { patch } : {}) });
  const W = M.World, S = M.States, R = M.Reg, B = M.Behave, Ox = M.Oxidize, o = {};
  W.init(1);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
  B.init(W);
  const st = (n) => S.stateOf(n), nm = (s) => R.names[S.block[s]];
  const seq = (l, f = 0.99) => { let i = 0; return () => (i < l.length ? l[i++] : f); };
  const put = (x, y, z, n) => W.setBlock(x, y, z, st(n));
  const clear = () => { for (let x = -8; x <= 8; x++) for (let y = 60; y <= 70; y++) for (let z = -8; z <= 8; z++) W.setBlock(x, y, z, 0); };
  const tick = (x, y, z, r) => B.randomTick(x, y, z, r);
  // OxidizableBlock / Slab / Stairs: each family steps up a tier through the real rule table
  for (const [k, a, b] of [['block', 'copper_block', 'exposed_copper'], ['slab', 'cut_copper_slab', 'exposed_cut_copper_slab'], ['stairs', 'cut_copper_stairs', 'exposed_cut_copper_stairs']]) {
    clear(); put(0, 64, 0, a);
    o[k] = tick(0, 64, 0, seq([0, 0])) === true && nm(W.getBlock(0, 64, 0)) === b;
  }
  clear(); put(0, 64, 0, 'weathered_cut_copper_stairs');
  o.chain = tick(0, 64, 0, seq([0, 0])) && nm(W.getBlock(0, 64, 0)) === 'oxidized_cut_copper_stairs';
  // oxidized never ticks
  clear(); put(0, 64, 0, 'oxidized_copper');
  o.oxidizedInert = !B.hasRandomTick(st('oxidized_copper')) && tick(0, 64, 0, seq([0, 0])) === false;
  // tickDegradation chance gate 0.05688889
  clear(); put(0, 64, 0, 'copper_block');
  o.gate = tick(0, 64, 0, seq([0.0569, 0])) === false && nm(W.getBlock(0, 64, 0)) === 'copper_block';
  // tryDegrade: 0.75 mult at UNAFFECTED, 0.76 fails
  o.mult = tick(0, 64, 0, seq([0, 0.76])) === false && tick(0, 64, 0, seq([0, 0.74])) === true;
  // Degradable census: lower-level neighbour within Manhattan 4 vetoes; at 5 does not
  clear(); put(0, 64, 0, 'exposed_copper'); put(2, 64, 2, 'copper_block');
  o.veto = tick(0, 64, 0, seq([0, 0])) === false && nm(W.getBlock(0, 64, 0)) === 'exposed_copper';
  clear(); put(0, 64, 0, 'exposed_copper'); put(3, 64, 2, 'copper_block');
  o.range = tick(0, 64, 0, seq([0, 0])) === true;
  // same-level neighbour: chance (1/2)^2 = 0.25
  clear(); put(0, 64, 0, 'exposed_copper'); put(1, 64, 0, 'exposed_copper');
  o.census = tick(0, 64, 0, seq([0, 0.26])) === false && tick(0, 64, 0, seq([0, 0.24])) === true;
  // waxed copper is not oxidizable
  clear(); put(0, 64, 0, 'waxed_copper_block');
  o.waxedInert = tick(0, 64, 0, seq([0, 0])) === false;
  // HoneycombItem: 16 pairs, state properties carried
  o.pairs = Ox.waxPairs() === 16;
  const stairs = B.setProp(st('weathered_cut_copper_stairs'), 'facing', 'west');
  const w = Ox.waxed(stairs);
  o.wax = w !== null && nm(w) === 'waxed_weathered_cut_copper_stairs' ;
  o.waxProps = w !== null && Ox.unwaxed(w) === stairs;
  o.waxNone = Ox.waxed(st('stone')) === null && Ox.waxed(w) === null && Ox.unwaxed(stairs) === null;
  return o;
}
const A = trial(null);
for (const k of Object.keys(A)) ok(A[k], 'scenario ' + k + ' ' + JSON.stringify(A));
const BR = [
  ['stairs', "['cut_copper_stairs', 'exposed_cut_copper_stairs'], ", ''],
  ['slab', "['cut_copper_slab', 'exposed_cut_copper_slab'], ", ''],
  ['block', "['copper_block', 'exposed_copper'], ", ''],
  ['oxidizedInert', 'return Object.keys(up).map(Number);', 'return Object.keys(up).concat(Object.keys(down)).map(Number);'],
  ['gate', 'if (rnd() < Ox.TICK_CHANCE)', 'if (true)'],
  ['mult', 'f * f * (me === 0 ? Ox.UNAFFECTED_MULT : 1)', 'f * f'],
  ['veto', 'if (l < me) return false;', ''],
  ['range', 'Ox.RANGE = 4;', 'Ox.RANGE = 5;'],
  ['census', 'var f = (higher + 1) / (higher + same + 1);', 'var f = 1;'],
  ['pairs', "var a = R.id[n], b = R.id['waxed_' + n];\n      if (a === undefined || b === undefined) continue;", "var a = R.id[n], b = R.id['waxed_' + n];\n      if (a === undefined || b === undefined || n === 'cut_copper') continue;"],
  ['waxProps', 'return b === undefined ? null : Ox.withBlock(st, b); };\n\n  Ox.OWED', 'return null; };\n\n  Ox.OWED'],
];
for (const [key, a, b] of BR) {
  breaks++;
  let hit = false, X;
  try { X = trial((f, s) => { if (f === '07zze_oxidize.js' && s.includes(a)) { hit = true; return s.replace(a, b); } return s; }); } catch { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  ok(!X[key], 'anti-vacuity: break ' + key);
  if (!X[key]) console.log('  ✓ break caught: ' + key);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `oxidize11580check: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
