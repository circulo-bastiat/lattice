#!/usr/bin/env node
// combatrngcheck.mjs — #6215: no unseeded Math.random in combat/spawn; world stream reproduces per seed.
// Anti-vacuity (D-30): a Math.random left in the source must be caught.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const FILES = ['src/14j_combat.js', 'src/07l_spawn.js'];
const count = (txt) => (txt.match(/Math\.random/g) || []).length;
const fails = []; let breaks = 0;
const srcs = FILES.map((f) => readFileSync(join(MCLITE_ROOT, f), 'utf8'));
srcs.forEach((t, i) => { if (count(t)) fails.push(`${FILES[i]} has ${count(t)} Math.random`); });
if (count(srcs[0] + '\nvar x = Math.random();') === 0) fails.push('anti-vacuity: leftover not caught'); else { breaks++; console.log("✓ fault caught"); }
const EXTRA = ['02m_jrandom.js', '07_world.js', '07i_entitylist.js'];
function volley(seed) {
  const M = loadEngine({ extra: EXTRA, dom: false });
  M.World.init(seed);
  const out = []; for (let i = 0; i < 10; i++) out.push(M.EntityList.wr());
  return out.join(',');
}
const a = volley(777), b = volley(777), c = volley(778);
if (a !== b) fails.push('same seed, different volley');
if (a === c) fails.push('different seeds, same volley'); else { breaks++; console.log("✓ fault caught"); }
if (fails.length) { console.log('combatrngcheck FAIL\n' + fails.join('\n')); process.exit(1); }
console.log(`\n4 checks passed, 0 failures, ${breaks} breaks caught`);
