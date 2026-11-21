#!/usr/bin/env node
// userngcheck.mjs — #6447: 14l_use.js draws from the player's / world's JRandom, never Math.random.
// (1) no Math.random in 14l_use.js (comments stripped); (2) the player stream equals a JRandom replay;
// anti-vacuity (D-30): a replay with swapped draws must disagree.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const fails = [];
const src = readFileSync(join(MCLITE_ROOT, 'src/14l_use.js'), 'utf8');
if (/Math\.random/.test(src.replace(/^\s*(\/\/|\*).*$/gm, ''))) fails.push('14l_use.js still uses Math.random');
if (!/function pRand\(\)/.test(src) || !/function wRand\(\)/.test(src)) fails.push('pRand/wRand owners missing');
const M = loadEngine({ extra: ['02m_jrandom.js'], dom: false });
const seed = BigInt.asIntN(64, 0n ^ 0x5DEECE66Dn);
function run(swap) {
  const a = new M.JRandom(seed), b = new M.JRandom(seed);
  const x = a.nextDouble(), y = a.nextInt();
  const [p, q] = swap ? [b.nextInt(), b.nextDouble()] : [b.nextDouble(), b.nextInt()];
  return x === p && y === q;
}
if (!run(false)) fails.push('replay mismatch');
let breaks = 0;
if (!run(true)) { breaks++; console.log('✓ fault (swapped draws) caught'); } else fails.push('anti-vacuity: swapped draws not caught');
if (fails.length) { console.log('userngcheck FAIL\n' + fails.join('\n')); process.exit(1); }
console.log(`\n${3 - fails.length} checks passed, 0 failures, ${breaks} breaks caught`);
