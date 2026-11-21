#!/usr/bin/env node
// mineshaftwirecheck.mjs — #11472: 04s_struct_mineshaft.js is WIRED (classmap static false positive).
// Its maker is attached by string key: ST.register('mineshaft', maker) -> ST.makers -> ST.init resolves the
// configured structures (mineshaft, mineshaft_mesa) -> ST.startsOfRegion/startsNear (the path Gen.genColumn's
// structure pass walks). The static map cannot see a string key. Requires real starts with pieces, and that
// cutting the register key removes them.
import { loadEngine } from './loadsrc.mjs';
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const M = loadEngine({ extra: ['07l_spawn.js'], dom: false, ...(patch ? { patch } : {}) });
  M.Gen.init(1337, Object.assign(M.Gen.defaults(), { climate: 'vanilla' }));
  const ST = M.Structures; let n = 0; M.Dim.cur = 'overworld';
  ST.sets.forEach((set, si) => {
    if (!set.members.some((m) => /^mineshaft/.test(m.name || (m.def && m.def.name) || ''))) return;
    for (let rz = -40; rz < 40 && n < 3; rz++) for (let rx = -40; rx < 40 && n < 3; rx++)
      for (const x of ST.startsOfRegion(si, rx, rz)) if (/^mineshaft/.test(x.def.name) && x.pieces.length > 1) n++;
  });
  return n;
}
ok(trial() > 0, 'no mineshaft start with pieces through startsOfRegion');
const F = '04s_struct_mineshaft.js';
breaks++;
const cut = (f, t) => f === F ? t.replace("ST.register('mineshaft'", "ST.register('_cut_mineshaft'") : t;
const t = fs.readFileSync(path.join(root, 'src', F), 'utf8');
if (cut(F, t) === t) fails.push('no-op break (pattern not found)');
let got; try { got = trial(cut); } catch (e) { got = 0; }
ok(!(got > 0), 'anti-vacuity: register key cut must remove mineshafts');
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
