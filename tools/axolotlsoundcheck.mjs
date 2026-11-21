#!/usr/bin/env node
// axolotlsoundcheck.mjs — #1360: AxolotlEntity attack (tryAttack), splash and swim sound ids.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const MCL = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '07zm_axolotl.js', '07zzp_mobvoice.js'], dom: false });
let fails = 0, breaks = 0, pass = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL ' + m); } else pass++; };
const mobSounds = {};
for (const l of readFileSync(fileURLToPath(new URL('./golden/mob-sounds-1.18.2.tsv', import.meta.url)), 'utf8').split(/\r?\n/)) { if (!l || l[0] === '#') continue; const c = l.split('\t'); mobSounds[c[0]] = c.slice(2); }
MCL.DATA = Object.assign({}, MCL.DATA, { mobSounds });
const MV = MCL.MobVoice;
const ax = { type: 'axolotl' };
function verdict() {
  return MV.waterSound(ax, 'swim') === 'entity.axolotl.swim' && MV.waterSound(ax, 'splash') === 'entity.axolotl.splash' &&
    MV.waterSound(ax, 'small_fall') === 'entity.generic.small_fall' && MV.waterSound({ type: 'cow' }, 'swim') === 'entity.generic.swim';
}
ok(verdict(), 'axolotl swim/splash ids; falls and other mobs stay generic');
const played = [];
MCL.Sound = { ready: true, play: (id, o) => { played.push([id, o]); return true; } };
function attackOk() {
  played.length = 0;
  MCL.Combat = { mobAttack: () => true };
  const Ax = MCL.Axolotl; if (!Ax || !Ax.FightGoal) return false;
  const e = { type: 'axolotl', x: 0, y: 64, z: 0, target: { x: 0.5, y: 64, z: 0, width: 0.4 }, ai: {} };
  const g = new Ax.FightGoal(e, {}); g.start(); g.tick();
  return played.length === 1 && played[0][0] === 'entity.axolotl.attack' && played[0][1].volume === 1 && played[0][1].pitch === 1;
}
const wsv = MV.waterSound;
MV.waterSound = (e, k) => wsv({ type: 'cow' }, k); if (!verdict()) breaks++; MV.waterSound = wsv;
ok(attackOk(), 'FightGoal plays entity.axolotl.attack (1,1) on a landed hit');
const em = MV.emit; MV.emit = () => false; if (!attackOk()) breaks++; MV.emit = em;
// playing dead: timer still rolls and resets, but nothing is emitted (AxolotlEntity.playAmbientSound)
function deadSilent(dead) {
  played.length = 0;
  const e = { type: 'axolotl', x: 0, y: 64, z: 0, health: 14, inWater: true, playingDead: dead, ambientSoundChance: 1e6 };
  const r = MV.tickAmbient(e);
  return !played.length && !r && e.ambientSoundChance < 0;
}
ok(!deadSilent(false), 'control: a live axolotl does emit');
ok(deadSilent(true), 'playing-dead axolotl: ambient silent, timer reset');
const pk = MV.pick; MV.pick = (e, k) => pk({ ...e, playingDead: false }, k); if (!deadSilent(true)) breaks++; MV.pick = pk;
ok(breaks === 3, breaks + ' breaks caught');
console.log(`\n${pass} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
