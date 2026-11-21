#!/usr/bin/env node
// projrngcheck.mjs — #6441: projectile/explosion/potion/firework/orb/cart/lightning files never call Math.random.
// World-level rolls draw from NS.wrand (world.random, a JRandom); entity rolls from e.random.
// Anti-vacuity (D-30): a JRandom replay with swapped draws must disagree.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const fails = []; let breaks = 0;
const files = ['07zzd_throw', '07za_explosion', '07z_potion', '07zzy_firework', '07zz_xporb', '07zzr_minecart', '07zzc_lightning'];
for (const f of files) {
  const t = readFileSync(join(MCLITE_ROOT, 'src/' + f + '.js'), 'utf8').replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
  if (/Math\.random/.test(t)) fails.push(f + ' still uses Math.random');
}
function run(swap) {
  const M = loadEngine({ extra: ['02m_jrandom.js'], dom: false });
  const seed = BigInt.asIntN(64, 0n * 25214903917n + 11n);
  const r = new M.JRandom(seed), got = [], want = [];
  for (let i = 0; i < 10; i++) got.push(M.wrand());
  for (let i = 0; i < 10; i++) want.push(r.nextDouble());
  if (swap) { const t = want[0]; want[0] = want[1]; want[1] = t; }
  return got.join() === want.join();
}
if (!run(false)) fails.push('NS.wrand differs from the JRandom replay');
if (!run(true)) { breaks++; console.log('✓ fault (swapped draws) caught'); } else fails.push('anti-vacuity: swapped draws not caught');
if (fails.length) { console.log('projrngcheck FAIL\n' + fails.join('\n')); process.exit(1); }
console.log(`\n${files.length + 1} checks passed, 0 failures, ${breaks} breaks caught`);
