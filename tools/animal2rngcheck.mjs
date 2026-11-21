#!/usr/bin/env node
// animal2rngcheck.mjs — #6438: panda/turtle/axolotl/bee files never draw from Math.random.
// (1) no Math.random in the four files (comments stripped); (2) a seeded JRandom replay of the fallback
// stream equals what the file's RNDFB yields; anti-vacuity (D-30): swapped draws must disagree.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MCLITE_ROOT } from './loadsrc.mjs';
const src = (f) => readFileSync(join(MCLITE_ROOT, f), 'utf8');
const files = ['src/07zl_panda.js', 'src/07zp_turtle.js', 'src/07zm_axolotl.js', 'src/07zo_bee.js'];
const fails = [];
for (const f of files) {
  const t = src(f).replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
  if (/Math\.random/.test(t)) fails.push(f + ' still uses Math.random');
  if (!/function RNDFB/.test(t)) fails.push(f + ' has no RNDFB fallback');
}
const js = src('src/02m_jrandom.js');
const NS = {}; new Function('MCL', js)(NS);
const stream = (swap) => { const a = new NS.JRandom(0x6438), b = new NS.JRandom(0x6438); const o = [];
  for (let i = 0; i < 20; i++) { const x = a.nextDouble(); let y; if (swap) { y = b.nextInt(); } else y = b.nextDouble(); o.push(x === y); } return o.every(Boolean); };
if (!stream(false)) fails.push('replay of the fallback order differs');
let breaks = 0;
if (!stream(true)) { breaks++; console.log('✓ fault (swapped draws) caught'); } else fails.push('anti-vacuity: swapped draws not caught');
if (fails.length) { console.log('animal2rngcheck FAIL\n' + fails.join('\n')); process.exit(1); }
console.log(`\n${files.length * 2 + 1} checks passed, 0 failures, ${breaks} breaks caught`);
