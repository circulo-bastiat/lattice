#!/usr/bin/env node
// lockstep-endermite -- #6894 (G17-L177): lockstep scenario 'endermite', 20 salts, 2600 ticks. Three endermites (one from a pearl landing, one natural,
// one name-tagged/persistent) run the engine's real Endermite.tick against EndermiteEntity.tickMovement (.decomp:139-145): if (!isPersistent()) lifeTime++;
// if (lifeTime >= 2400) discard(). 1.18.2 has no playerSpawned flag (a pearl mite is an ordinary mite), so pearl and natural despawn identically, on tick
// index 2399; only the persistent one survives. Per tick: lifeTime and removed. Target/attack damage live in the goal roster, not in this module.
import { loadEngine } from './loadsrc.mjs';

const SALTS = 20, TICKS = 2600;

function engine(salt, patch) {
  const M = loadEngine({ patch, extra: ['07zn2_endermite.js'], dom: false });
  const start = salt * 7 % 50;   // a mite that already has some age (saved Lifetime)
  const mites = [0, 1, 2].map((i) => ({ type: 'endermite', x: 10 + i, y: 64, z: 0, lifeTime: i === 0 ? 0 : start, persistent: i === 2 }));
  const rows = [];
  for (let t = 0; t < TICKS; t++) {
    mites.forEach((m) => { M.Endermite.tick(m); });
    rows.push(mites.map((m) => m.lifeTime + ':' + !!m.removed).join('|'));
  }
  return rows;
}

function reference(salt) {
  const start = salt * 7 % 50;
  const mites = [0, 1, 2].map((i) => ({ life: i === 0 ? 0 : start, per: i === 2, gone: false }));
  const rows = [];
  for (let t = 0; t < TICKS; t++) {
    mites.forEach((m) => { if (m.gone) return; if (!m.per) m.life++; if (m.life >= 2400) m.gone = true; });
    rows.push(mites.map((m) => m.life + ':' + m.gone).join('|'));
  }
  return rows;
}

function run(patch) {
  let bad = 0, first = '';
  for (let s = 1; s <= SALTS; s++) {
    const a = engine(s, patch), b = reference(s);
    for (let i = 0; i < TICKS; i++) if (a[i] !== b[i]) { bad++; if (!first) first = `salt ${s} tick ${i}: engine ${a[i]} ref ${b[i]}`; break; }
  }
  return { bad, first };
}

const base = run();
let ok = base.bad === 0, caught = 0;
const P = (a, b) => (f, s) => f === '07zn2_endermite.js' ? s.replace(a, b) : s;
const breaks = [
  ['despawn >= 2400 -> > 2400', P('>= Em.DESPAWN_TIME', '> Em.DESPAWN_TIME')],
  ['despawn time 2400 -> 2399', P('Em.DESPAWN_TIME = 2400', 'Em.DESPAWN_TIME = 2399')],
  ['persistent still ages', P('if (!e.persistent) e.lifeTime', 'if (true) e.lifeTime')],
];
for (const [name, p] of breaks) {
  const x = run(p);
  if (x.bad > 0) caught++; else { ok = false; console.log('NOT CAUGHT: ' + name); }
}
console.log(`endermite: ${caught} breaks caught, ${base.bad} divergences${base.first ? " " + base.first : ""}`);
process.exit(ok && caught === breaks.length ? 0 : 1);
