#!/usr/bin/env node
// lockstep-ambientsound -- #6931 (G17-L191): lockstep scenario 'ambientsound', 20 salts. Seven idle mobs for 6000 ticks; per tick the sounds list
// (id, volume, pitch) and the ambientSoundTime counter of NS.MobVoice.tickAmbient are compared with MobEntity.baseTick
// (`nextInt(1000) < ambientSoundTime++`, then resetSoundDelay = -getMinAmbientSoundDelay and playAmbientSound: getSoundVolume, getSoundPitch),
// exact doubles. Bat: BatEntity.getAmbientSound (roosting -> nextInt(4) != 0 silent), volume 0.1, pitch x0.95.
import { loadEngine } from './loadsrc.mjs';

const SALTS = 20, TICKS = 6000;
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
// type, ambient event, min delay, volume (MobEntity.getSoundVolume), pitch factor
const MOBS = [
  ['cow', 'entity.cow.ambient', 120, 0.4, 1], ['zombie', 'entity.zombie.ambient', 80, 1, 1], ['villager', 'entity.villager.ambient', 80, 1, 1],
  ['bat', 'entity.bat.ambient', 80, 0.1, 0.95], ['pig', 'entity.pig.ambient', 120, 1, 1], ['sheep', 'entity.sheep.ambient', 120, 1, 1],
  ['skeleton', 'entity.skeleton.ambient', 80, 1, 1],
];
const roost = (salt) => salt % 2 === 1;

function engine(salt, patch) {
  const M = loadEngine({ patch, extra: ['19_data.gen.js', '07zzp_mobvoice.js'], dom: false });
  const r = stream(salt), log = [];
  M.MobVoice.GATED = false;
  M.Sound = { play: (n, o) => { log.push(n + ',' + o.volume + ',' + o.pitch + ',' + o.source); return true; } };
  const mobs = MOBS.map((m) => ({ type: m[0], health: 20, x: 0.5, y: 64, z: 0.5, roosting: m[0] === 'bat' && roost(salt) }));
  const saved = Math.random; Math.random = r;
  const rows = [];
  try {
    for (let t = 0; t < TICKS; t++) {
      log.length = 0;
      for (const e of mobs) M.MobVoice.tickAmbient(e);
      rows.push(mobs.map((e) => e.ambientSoundChance).join(',') + '|' + log.join(';'));
    }
  } finally { Math.random = saved; }
  return rows;
}

function reference(salt) {
  const r = stream(salt), rows = [], c = MOBS.map(() => 0);
  for (let t = 0; t < TICKS; t++) {
    const log = [];
    MOBS.forEach((m, i) => {
      if (Math.floor(r() * 1000) < c[i]++) {
        c[i] = -m[2];
        if (m[0] === 'bat' && roost(salt) && Math.floor(r() * 4) !== 0) return;
        const pitch = ((r() - r()) * 0.2 + 1) * m[4];
        log.push(m[1] + ',' + m[3] + ',' + pitch + ',neutral');
        if (m[0] === 'zombie' || m[0] === 'skeleton') log[log.length - 1] = log[log.length - 1].replace(',neutral', ',hostile');
      }
      void m;
    });
    rows.push(c.join(',') + '|' + log.join(';'));
  }
  return rows;
}

let sounds = 0;
function run(patch) {
  let bad = 0, first = '';
  for (let s = 1; s <= SALTS; s++) {
    const a = engine(s, patch), b = reference(s);
    for (let i = 0; i < TICKS; i++) {
      if (!patch && b[i].split('|')[1]) sounds++;
      if (a[i] !== b[i]) { bad++; if (!first) first = `salt ${s} tick ${i}: engine ${a[i]} ref ${b[i]}`; break; }
    }
  }
  return { bad, first };
}

const base = run();
let ok = base.bad === 0 && sounds > 100, caught = 0;
const P = (a, b) => (n, s) => { if (n !== '07zzp_mobvoice.js') return s; if (!s.includes(a)) throw new Error('break pattern missing: ' + a); return s.replace(a, b); };
const breaks = [
  ['roll 1000 -> 999', P('Math.floor(rnd() * 1000) < e.ambientSoundChance++', 'Math.floor(rnd() * 999) < e.ambientSoundChance++')],
  ['counter reset to 1 instead of -delay', P('e.ambientSoundChance = -MV.delay(e);\n      var ev', 'e.ambientSoundChance = 1;\n      var ev')],
  ['cow delay 120 -> 80', P("parseInt(r[I.delay], 10) : 80", "parseInt(r[I.delay], 10) - 40 : 80")],
  ['bat pitch x0.95 dropped', P("p * 0.95", 'p')],
];
for (const [name, p] of breaks) {
  const x = run(p);
  if (x.bad > 0) caught++; else { ok = false; console.log('NOT CAUGHT: ' + name); }
}
console.log(`ambientsound: ${caught} breaks caught, ${base.bad} divergences, ${sounds} sounds${base.first ? " " + base.first : ""}`);
process.exit(ok && caught === breaks.length ? 0 : 1);
