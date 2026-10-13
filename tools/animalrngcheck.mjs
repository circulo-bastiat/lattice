#!/usr/bin/env node
// animalrngcheck.mjs — #6437: fox / goat / rabbit / polar bear draw from the mob's e.random, never Math.random.
// (1) no Math.random in the four files (comments stripped); (2) rolls with a mob in hand come off e.random in
// vanilla order: Goat.spawnInit (one nextFloat < 0.02) equals a JRandom replay; Fox.sniffRoll one nextFloat.
// Anti-vacuity (D-30): a replay with swapped draws must disagree.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const FILES = ['07zj_fox.js', '07zj_goat.js', '07zh_rabbit.js', '07zj_polarbear.js'];
const fails = [];
for (const f of FILES)
  if (/Math\.random/.test(readFileSync(join(MCLITE_ROOT, 'src', f), 'utf8').replace(/^\s*(\/\/|\*|\/\*).*$/gm, ''))) fails.push(f + ' still uses Math.random');
const M = loadEngine({ extra: ['02m_jrandom.js', ...FILES], dom: false });
const Gt = M.Goat || M.Goats, Fx = M.Fox;
function run(swap) {
  let ok = true;
  for (let i = 0; i < 40; i++) {
    const seed = 1000 + i;
    const e = { random: new M.JRandom(seed) }, f = { random: new M.JRandom(seed), x: 0, y: 0, z: 0 };
    Gt.spawnInit(e);
    const r = new M.JRandom(seed);
    if (swap) r.nextInt();
    ok = ok && e.screaming === (r.nextFloat() < Gt.SCREAMING_CHANCE);
    const r2 = new M.JRandom(seed);
    if (swap) r2.nextInt();
    const hit = Fx.sniffRoll(f);
    ok = ok && hit === (r2.nextFloat() < 0.05) && f.random.nextInt() === r2.nextInt();
  }
  return ok;
}
try { if (!run(false)) fails.push('seeded goat/fox rolls differ from the JRandom replay'); } catch (x) { fails.push('run threw: ' + x.message); }
let breaks = 0;
try { if (!run(true)) { breaks++; console.log('✓ fault (swapped draws) caught'); } else fails.push('anti-vacuity: swapped draws not caught'); } catch (x) { breaks++; }
if (fails.length) { console.log('animalrngcheck FAIL\n' + fails.join('\n')); process.exit(1); }
console.log(`\n${2 - fails.length} checks passed, 0 failures, ${breaks} breaks caught`);
