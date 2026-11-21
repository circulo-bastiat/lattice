#!/usr/bin/env node
// #11557: ShipwreckFeature (net/minecraft/world/gen/feature/ShipwreckFeature) is wired: ST.register('shipwreck') in 04w makes starts with pieces through startsNear in this check (breaks caught when its key is cut).
// structrestwirecheck.mjs — #11471: 04w_struct_rest.js is WIRED (classmap static false positive).
// Its makers (shipwreck, buried_treasure, nether_fossil, bastion_remnant = JigsawFeature) are attached by
// string name: ST.register(type, maker) -> ST.makers[type] -> ST.init resolves each configured structure
// -> ST.startsNear (the path Gen.genColumn's structure pass walks). The static map cannot see a string key.
// This drives that real path and requires starts with pieces of each kind. Anti-vacuity: renaming a
// register key, or cutting the module's registrations, removes that structure.
import { loadEngine } from './loadsrc.mjs';
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const WANT = { overworld: ['shipwreck', 'buried_treasure'], the_nether: ['nether_fossil', 'bastion_remnant'] };
function trial(patch, only) {
  const M = loadEngine({ extra: ['07l_spawn.js'], dom: false, ...(patch ? { patch } : {}) });
  M.Gen.init(1337, Object.assign(M.Gen.defaults(), { climate: 'vanilla' }));
  const ST = M.Structures, got = {};
  for (const dim of Object.keys(WANT)) for (const n of WANT[dim]) {
    if (only && only !== n) continue;
    M.Dim.cur = dim;
    // the real start decision, region by region, for the one structure set that holds this member
    const lim = n === 'buried_treasure' ? 120 : 12;
    ST.sets.forEach((set, si) => {
      if (!set.members.some((m) => (m.name || (m.def && m.def.name)) === n)) return;
      for (let rz = -lim; rz < lim; rz++) for (let rx = -lim; rx < lim; rx++)
        for (const x of ST.startsOfRegion(si, rx, rz)) if (x.def.name === n && x.pieces.length) got[n] = (got[n] || 0) + 1;
    });
  }
  M.Dim.cur = 'overworld';
  return got;
}
const A = trial();
for (const n of ['shipwreck', 'buried_treasure', 'nether_fossil', 'bastion_remnant']) ok(A[n] > 0, 'no ' + n + ' start with pieces through startsNear');
const F = '04w_struct_rest.js';
const cuts = [];
for (const n of ['shipwreck', 'buried_treasure', 'nether_fossil', 'bastion_remnant'])
  cuts.push([n + ' register key cut', n, (f, t) => f === F ? t.replace("ST.register('" + n + "'", "ST.register('_cut_" + n + "'") : t]);
for (const [name, n, p] of cuts) {
  breaks++;
  const t = fs.readFileSync(path.join(root, 'src', F), 'utf8');
  if (p(F, t) === t) fails.push('no-op break (pattern not found): ' + name);
  let got; try { got = trial(p, n); } catch (e) { got = {}; }
  ok(!(got[n] > 0), 'anti-vacuity: ' + name + ' must remove ' + n);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
