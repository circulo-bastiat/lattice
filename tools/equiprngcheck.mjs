#!/usr/bin/env node
// equiprngcheck.mjs — #6449: equipment/squid/dolphin/snow golem/zombie villager/llama/flyer/villager-brain files never use Math.random.
// (1) no Math.random in the named files (comments stripped); (2) the fallback NS.fbRand equals a JRandom replay.
// Anti-vacuity (D-30): a replay with swapped draws must disagree.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const FILES = ['07y_equip', '07zi_squid', '07zz2_dolphin', '07zq_snowgolem', '07zr_zvillager', '07ze_llama', '07t_fly', '07zv_villagerbrain'];
const fails = [];
for (const f of FILES) {
  const t = readFileSync(join(MCLITE_ROOT, 'src', f + '.js'), 'utf8').replace(/^\s*(\/\/|\*).*$/gm, '').replace(/\/\/.*$/gm, '');
  if (/Math\.random/.test(t)) fails.push(f + ' still uses Math.random');
}
function run(swap) {
  const M = loadEngine({ extra: ['02m_jrandom.js'], dom: false });
  const r = new M.JRandom(0x6449n), got = [], want = [];
  for (let i = 0; i < 20; i++) got.push(M.fbRand());
  for (let i = 0; i < 20; i++) want.push(r.nextDouble());
  if (swap) want.reverse();
  return got.join() === want.join();
}
if (!run(false)) fails.push('fbRand stream differs from the JRandom replay');
let breaks = 0;
if (!run(true)) { breaks++; console.log('✓ fault (swapped draws) caught'); } else fails.push('anti-vacuity: swapped draws not caught');
if (fails.length) { console.log('equiprngcheck FAIL\n' + fails.join('\n')); process.exit(1); }
console.log(`\n${2 - fails.length} checks passed, 0 failures, ${breaks} breaks caught`);
