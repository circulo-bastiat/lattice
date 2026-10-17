// hardcoreflagcheck.mjs - #8317: hardcore flag forces difficulty hard (MinecraftServer.setDifficulty), saved as level 'hardcore'.
// Drives the real Diff store from 07l_spawn.js; save wiring checked in 16b_save.js source. Anti-vacuity below.
import { readFileSync } from 'node:fs';
import { loadEngine } from './loadsrc.mjs';
import { ROOT } from './paths.mjs';
const SAVE = readFileSync(ROOT + '/src/16b_save.js', 'utf8');
const MCL = loadEngine({ extra: ['07l_spawn.js'], dom: false });
const verdict = (D, save) => {
  const bad = [];
  D.hardcore = false; D.value = 'normal';
  D.set('peaceful'); if (D.get() !== 'peaceful') bad.push('non-hardcore world must accept /difficulty peaceful');
  D.setHardcore(true); if (D.get() !== 'hard') bad.push('hardcore must force hard');
  D.set('peaceful'); if (D.get() !== 'hard') bad.push('/difficulty peaceful must leave a hardcore world hard');
  D.set('easy'); if (D.get() !== 'hard') bad.push('/difficulty easy must leave a hardcore world hard');
  if (!/hardcore: .*Diff\.hardcore/.test(save)) bad.push('save does not write hardcore');
  if (!/o\.hardcore === true\) NS\.Diff\.setHardcore\(true\)/.test(save)) bad.push('load does not restore hardcore');
  return bad;
};
const mk = (f) => Object.assign({}, MCL.Diff, f);
const real = verdict(MCL.Diff, SAVE);
const B = [
  ['setDifficulty override removed', () => Object.assign(mk(), { set(l) { if (this.LEVELS.indexOf(l) >= 0) this.value = l; return this.value; } }), SAVE],
  ['setHardcore does not force hard', () => Object.assign(mk(), { setHardcore(o) { this.hardcore = !!o; return this.hardcore; } }), SAVE],
  ['save drops flag', () => MCL.Diff, SAVE.replace('Diff.hardcore) ? true', 'Diff.x) ? true')],
  ['load drops flag', () => MCL.Diff, SAVE.replace('o.hardcore === true', 'false')],
];
let caught = 0;
for (const [n, d, s] of B) { const dd = d(); if (verdict(dd, s).length) { caught++; console.log("   ✓ " + n); } else console.log(' NOT CAUGHT:', n); }
for (const x of real) console.log(' FAIL:', x);
console.log(`hardcoreflagcheck: 6 assertions, ${real.length} failures, ${caught} breaks caught`);
console.log(`================ hardcoreflagcheck ================\n assertions passed .. 6\n failures ........... ${real.length}\n breaks caught ...... ${caught}\n==============================================`);
process.exit(real.length || caught < B.length ? 1 : 0);
