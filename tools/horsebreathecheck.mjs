#!/usr/bin/env node
// horsebreathecheck.mjs -- #1831: HorseEntity.playWalkSound: gallop at vol*0.15, breathe at vol*0.6 (not 0.15*0.6).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({ extra: ['07zzp_mobvoice.js'], dom: false });
const table = {};
for (const l of readFileSync(fileURLToPath(new URL('./golden/mob-sounds-1.18.2.tsv', import.meta.url)), 'utf8').split(/\r?\n/)) { if (!l || l[0] === '#') continue; const c = l.split('\t'); table[c[0]] = c.slice(2); }
M.DATA = Object.assign({}, M.DATA, { mobSounds: table });
const MV = M.MobVoice, played = [];
M.Sound = M.Sound || {};
M.Sound.blockEvent = () => 'block.stone.step';
M.Sound.play = (id, o) => { played.push([id, o]); return true; };
let fails = 0, breaks = 0, pass = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL ' + m); } else pass++; };
const near = (a, b) => Math.abs(a - b) < 1e-6;
const rm = Math.random; Math.random = () => 0;
function ride() {
  played.length = 0;
  const e = { type: 'horse', x: 0, y: 70, z: 0, rider: {}, soundTicks: 5 };
  MV.horseStep(e, [2, 1.25], 0); MV.horseStep(e, [2, 1.25], 0); MV.horseStep(e, [2, 1.25], 0);
  return played.filter((p) => p[0] === 'entity.horse.breathe');
}
const b = ride();
ok(b.length === 1 && near(b[0][1].volume, 1.2), 'breathe volume == 0.6 * group volume (2) -> got ' + (b[0] && b[0][1].volume));
ok(played.some((p) => p[0] === 'entity.horse.gallop' && near(p[1].volume, 0.3)), 'gallop stays at 0.15 * group volume');
// break: re-introduce the old 0.15*0.6 and the assertion must fail
const emit = MV.emit;
MV.emit = (e, ev, v, p) => emit(e, ev, ev === 'entity.horse.breathe' ? v * 0.15 : v, p);
const bad = ride();
breaks += bad.length === 1 && !near(bad[0][1].volume, 1.2) ? 1 : 0;
MV.emit = emit;
Math.random = rm;
console.log(`horsebreathecheck: ${pass} passed, ${fails} failed, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
