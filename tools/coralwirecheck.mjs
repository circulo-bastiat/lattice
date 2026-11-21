#!/usr/bin/env node
// coralwirecheck.mjs — #11468: 04q_feat_coral.js is WIRED (classmap said unwired: a static false positive,
// the module reaches the engine through Features.register + the biome feature lists, not through NS.X.y = ...).
//   1. the three generators are registered and warm_ocean's feature list names coral_tree/claw/mushroom
//   2. each configured feature, run through the worldgen's own placement driver (Features.placeAt) in a
//      water column, writes coral blocks
//   3. anti-vacuity: with a register line cut, the same run places nothing / init fails
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const SRC = join(MCLITE_ROOT, 'src');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

const KINDS = ['coral_tree', 'coral_claw', 'coral_mushroom'];
function trial(patch) {
  const M = loadEngine({ extra: ['07_world.js'], dom: false, ...(patch ? { patch } : {}) });
  const F = M.Features, S = M.States;
  M.Gen.init(20260924, Object.assign(M.Gen.defaults(), { climate: 'vanilla', features: true }));
  F.init(M.Gen);
  const STONE = S.stateOf('stone'), WATER = S.stateOf('water');
  const W = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
  const get = (x, y, z) => W.has(key(x, y, z)) ? W.get(key(x, y, z)) : (y < 40 ? STONE : y < 63 ? WATER : 0);
  const world = { getBlock: get, setBlock: (x, y, z, id) => { W.set(key(x, y, z), id); return true; } };
  // the biome's own placed feature (warm_ocean's feature list), compiled by Features.init
  const pf = F.placedList.find((p) => (p.name || (p.gen && p.gen.name)) === 'warm_ocean_vegetation');
  const kinds = pf && pf.gen && pf.gen.opts ? pf.gen.opts.map((o) => o.gen && o.gen.kind) : [];
  let wrote = 0;
  for (let seed = 1; seed <= 12; seed++) wrote += Math.max(0, F.placeAt(world, 'warm_ocean_vegetation', 8, 41, 8, seed * 977));
  const blocks = new Set(); for (const f of ['tube', 'brain', 'bubble', 'fire', 'horn']) for (const d of ['', 'dead_']) blocks.add(S.stateOf(d + f + '_coral_block'));
  let coral = 0; for (const id of W.values()) if (blocks.has(id)) coral++;
  return { kinds, wrote, coral };
}
const A = trial();
for (const k of KINDS) ok(A.kinds.includes(k), 'warm_ocean_vegetation compiles to ' + k);
ok(A.wrote > 0, 'placing warm_ocean_vegetation in water writes blocks (' + A.wrote + ')');
ok(A.coral > 0, 'and they are coral blocks (' + A.coral + ')');
for (const n of KINDS) {
  breaks++;
  let got;
  try { got = trial((f, t) => f === '04q_feat_coral.js' ? t.replace("F.register('" + n + "'", "void ('" + n + "'") : t); } catch (e) { got = { kinds: [] }; }
  ok(!got.kinds.includes(n), 'anti-vacuity: cutting register ' + n + ' must unwire it');
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
