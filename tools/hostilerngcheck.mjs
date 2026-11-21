#!/usr/bin/env node
// hostilerngcheck.mjs — #6439: hostile special-roll files draw from a JRandom stream, never Math.random.
// (1) no Math.random in slime/shulker/phantom/ghast/wither/piglin (comments stripped); (2) the fallback stream equals a
// JRandom replay (0x6439); (3) Slime.play-free roll: ctx randomOf(e) draws e.random.nextDouble in order.
// Anti-vacuity (D-30): a replay with swapped draws must disagree.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const FILES = ['07zd_slime', '07zzk_shulker', '07zz1_phantom', '07zzi_ghast', '07zzm_wither', '07zzf_piglin'];
const fails = [];
for (const f of FILES) {
  const t = readFileSync(join(MCLITE_ROOT, 'src/' + f + '.js'), 'utf8').replace(/^\s*(\/\/|\*).*$/gm, '').replace(/\/\/.*$/gm, '');
  if (/Math\.random/.test(t)) fails.push(f + ' still uses Math.random');
  if (!/function RNDFB/.test(t)) fails.push(f + ' has no RNDFB fallback');
}
const M = loadEngine({ extra: ['02m_jrandom.js', '07i_entitylist.js'], dom: false });
function run(swap) {
  const e = { random: new M.JRandom(12345n) };
  const f = M.EntityList.randomOf(e);
  const got = [f(), f()];
  const r = new M.JRandom(12345n);
  const a = r.nextDouble(), b = r.nextDouble();
  const want = swap ? [b, a] : [a, b];
  return got.join() === want.join();
}
if (!run(false)) fails.push('randomOf(e) differs from the JRandom replay');
let breaks = 0;
if (!run(true)) { breaks++; console.log('✓ fault (swapped draws) caught'); } else fails.push('anti-vacuity: swapped draws not caught');
if (fails.length) { console.log('hostilerngcheck FAIL\n' + fails.join('\n')); process.exit(1); }
console.log(`\n${FILES.length + 1} checks passed, 0 failures, ${breaks} breaks caught`);
