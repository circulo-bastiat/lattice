#!/usr/bin/env node
// ridertamerngcheck.mjs — #6440: mount/patrol/spellcaster/trader/trade/tame/breed rolls never use Math.random.
// (1) no Math.random in the seven files (comments stripped); (2) the fallback stream is a JRandom replay.
// Anti-vacuity (D-30): a stripped-comment scan of a poisoned source must flag, and swapped draws must disagree.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const FILES = ['07r_mount', '07x_patrol', '07v_spell', '07zt_wtrader', '07p_trade', '07n_tame', '07m_breed'];
const strip = (s) => s.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
const bad = (s) => /Math\.random/.test(strip(s));
const fails = [];
for (const f of FILES) if (bad(readFileSync(join(MCLITE_ROOT, 'src', f + '.js'), 'utf8'))) fails.push(f + ' still uses Math.random');
const M = loadEngine({ extra: ['02m_jrandom.js'], dom: false });
const a = new M.JRandom(0x6440), b = new M.JRandom(0x6440);
const x = [a.nextDouble(), a.nextInt(5)], y = [b.nextDouble(), b.nextInt(5)];
if (x.join() !== y.join()) fails.push('JRandom replay differs');
let breaks = 0;
if (bad('var x = Math.random();')) breaks++; else fails.push('anti-vacuity: poisoned source not flagged');
const c = new M.JRandom(0x6440); const sw = [c.nextInt(5), c.nextDouble()];
if (sw.join() !== x.join()) breaks++; else fails.push('anti-vacuity: swapped draws not caught');
if (fails.length) { console.log('ridertamerngcheck FAIL\n' + fails.join('\n')); process.exit(1); }
console.log(`\n${FILES.length + 1} assertions, 0 failures, ${breaks} breaks caught`);
