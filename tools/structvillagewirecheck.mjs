#!/usr/bin/env node
// #11561: VillageFeature (net/minecraft/world/gen/feature/VillageFeature) is wired: ST.register('village') in 04v makes starts with pieces through startsOfRegion in this check (breaks caught when its key is cut).
// structvillagewirecheck.mjs — #11477: 04v_struct_village.js is WIRED (classmap static false positive).
// VillageFeature's makers ('village', 'pillager_outpost') attach by string key: ST.register(type, maker) ->
// ST.makers[type] -> ST.init resolves each configured structure -> ST.startsOfRegion (the path Gen.genColumn's
// structure pass walks). The static map cannot follow a string key. This drives that path and requires starts
// with pieces of each kind. Anti-vacuity: renaming a register key removes that structure.
import { loadEngine } from './loadsrc.mjs';
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const KINDS = ['village', 'pillager_outpost'];
function trial(patch, only) {
  const M = loadEngine({ extra: ['07l_spawn.js'], dom: false, ...(patch ? { patch } : {}) });
  M.Gen.init(1337, Object.assign(M.Gen.defaults(), { climate: 'vanilla' }));
  const ST = M.Structures, got = {};
  M.Dim.cur = 'overworld';
  ST.sets.forEach((set, si) => {
    const types = set.members.map((m) => (m.def || m).type);
    if (!types.some((t) => KINDS.includes(t))) return;
    for (let rz = -30; rz < 30; rz++) for (let rx = -30; rx < 30; rx++)
      for (const x of ST.startsOfRegion(si, rx, rz)) if (KINDS.includes(x.def.type) && x.pieces.length) {
        if (only && x.def.type !== only) continue;
        got[x.def.type] = (got[x.def.type] || 0) + 1;
      }
  });
  return got;
}
const A = trial();
for (const k of KINDS) ok(A[k] > 0, 'no ' + k + ' start with pieces through startsOfRegion');
const F = '04v_struct_village.js';
for (const k of KINDS) {
  breaks++;
  const p = (f, t) => f === F ? t.replace("ST.register('" + k + "'", "ST.register('_cut_" + k + "'") : t;
  const t = fs.readFileSync(path.join(root, 'src', F), 'utf8');
  if (p(F, t) === t) fails.push('no-op break (pattern not found): ' + k);
  let got; try { got = trial(p, k); } catch (e) { got = {}; }
  ok(!(got[k] > 0), 'anti-vacuity: cutting register(' + k + ') must remove it');
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
