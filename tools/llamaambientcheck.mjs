#!/usr/bin/env node
// llamaambientcheck.mjs -- #1868: llama ambient timer starts at 0 and resets to -mobSounds.llama[5] (400, HorseBaseEntity.getMinAmbientSoundDelay).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({ extra: ['07zzp_mobvoice.js', '07ze_llama.js'], dom: false });
const Ll = M.Llama || M.Ll;
let fails = 0, breaks = 0, pass = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL ' + m); } else pass++; };
const brk = (c, m) => { breaks++; ok(c, 'break caught: ' + m); };
const row = readFileSync(fileURLToPath(new URL('./golden/mob-sounds-1.18.2.tsv', import.meta.url)), 'utf8').split(/\r?\n/).find((l) => l.startsWith('llama\t'));
const delay = +row.split('\t').slice(2)[5];
function run() {
  const real = M.fbRand, e = { type: 'llama', x: 0, y: 0, z: 0 }; let n = 0;
  Ll.playAmbient = () => n++;
  M.fbRand = () => 0;
  try { Ll.tickSounds(e); const start = e.ambientChance; Ll.tickSounds(e); return { start, n, reset: e.ambientChance }; } finally { M.fbRand = real; }
}
const r = run();
ok(delay === 400, 'table delay 400');
ok(r.start === 1, 'timer starts at 0 (first tick leaves 1)');
ok(r.n === 1 && r.reset === -delay, 'resets to -mobSounds.llama[5]');
brk(-80 !== -delay, 'old -80 reset would differ from table');
Ll.playAmbient = () => {}; const e = { type: 'llama' }; Math.random = () => 0; Ll.tickSounds(e); Ll.tickSounds(e);
brk(e.ambientChance !== -80, 'reset is not -80');
// #4430: non-lethal hurt resets the timer (MobEntity.playHurtSound -> resetSoundDelay); death does not
Ll.playSound = () => {};
const h = { type: 'llama', ambientChance: 900, health: 5 }; Ll.onDamaged(h);
ok(h.ambientChance === -delay, 'hurt resets ambient timer to -400');
const d = { type: 'llama', ambientChance: 900, health: 0 }; Ll.onDamaged(d);
ok(d.ambientChance === 900, 'death leaves the ambient timer');
brk(h.ambientChance !== 900, 'hurt changes the timer (unreset 900 would differ)');
console.log(`llamaambientcheck: ${pass} passed, ${fails} failed, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
