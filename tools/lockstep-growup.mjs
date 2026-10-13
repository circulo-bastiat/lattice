#!/usr/bin/env node
// lockstep-growup -- #6933 (G17-L193): lockstep scenario 'growup', 20 salts. A baby cow, pig, sheep and chicken, a scripted player feeding the right
// food at tick 100 and 400 (PassiveEntity.interactMob: growUp((int)((float)(-age/20)*0.1F), true) -- int divide, float multiply, truncate; growUp:
// age += n*20 capped at 0, forcedAge banked, happyTicksRemaining 40), the age walking +1 a tick (tickMovement), the growth puff on happyTicks%4==0.
// Per tick: age, isBaby, model scale input, growing particles, item count, hitbox (changes the tick the age reaches 0). The reference is written
// from .decomp PassiveEntity, not from src/07m_breed.js.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ENT = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'entities.json'), 'utf8'));
const SALTS = 20, TICKS = 1500, f = Math.fround;
const stream = (salt) => { let s = (salt * 2654435761 + 4242) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const MOBS = [['cow', 'wheat', 1200, 40], ['pig', 'carrot', 24000, 0], ['sheep', 'wheat', 1800, 90], ['chicken', 'wheat_seeds', 500, 20]];
const FEED = [100, 400];
const startAge = (m, salt, r) => -(m[2] + m[3] * salt + Math.floor(r() * 50));
const dim = (type) => ENT.types[type];

function engine(salt, patch) {
  const M = loadEngine({ patch, extra: ['07h_entities.js', '07m_breed.js'], dom: false });
  M.DATA = Object.assign({}, M.DATA, { entities: ENT }); M.Entities.init(); M.Breed.init();
  let puffs = 0; M.Particle = { spawn() { puffs++; } };
  const r = stream(salt), Br = M.Breed;
  const mobs = MOBS.map((m) => { const e = { type: m[0], x: 0, y: 64, z: 0, growAge: 0, isBaby: false }; Br.setAge(e, startAge(m, salt, r)); Br.refreshDimensions(e); return { e, item: m[1], stack: 64 }; });
  const rows = [];
  for (let t = 0; t < TICKS; t++) {
    const row = [];
    for (const m of mobs) {
      const e = m.e;
      if (FEED.includes(t)) Br.interact(e, m.item, { consume: (n) => { m.stack -= n; } });
      const before = puffs;
      Br.tickAge(e);
      row.push([e.growAge, Br.isBaby(e), Br.isBaby(e) ? Br.C.babyScale : 1, puffs - before, m.stack, e.width, e.height].join(','));
    }
    rows.push(row.join('|'));
  }
  return rows;
}

function reference(salt) {
  const r = stream(salt);
  const mobs = MOBS.map((m) => ({ type: m[0], age: startAge(m, salt, r), forced: 0, happy: 0, stack: 64 }));
  const rows = [];
  for (let t = 0; t < TICKS; t++) {
    const row = [];
    for (const m of mobs) {
      const item = MOBS.find((x) => x[0] === m.type);
      if (FEED.includes(t) && item) {
        const old = m.age;
        if (old === 0) { /* adult would fall in love; not part of this scenario once grown (cooldown or love) */ m.stack--; }
        else if (old < 0) {
          m.stack--;
          let a = old + Math.trunc(f(Math.trunc(-old / 20) * f(0.1))) * 20;
          if (a > 0) a = 0;
          m.forced += a - old;
          if (m.happy === 0) m.happy = 40;
          m.age = a;
          if (m.age === 0) m.age = m.forced;
        }
      }
      let puff = 0;
      if (m.age < 0) m.age++; else if (m.age > 0) m.age--;
      if (m.happy > 0) { if (m.happy % 4 === 0) puff = 1; m.happy--; }
      const d = dim(m.type), baby = m.age < 0, s = baby ? 0.5 : 1;
      row.push([m.age, baby, s, puff, m.stack, d[0] * s, d[1] * s].join(','));
    }
    rows.push(row.join('|'));
  }
  return rows;
}

function run(patch) {
  let bad = 0, first = '';
  for (let s = 1; s <= SALTS; s++) {
    let a, b;
    try { a = engine(s, patch); } catch (e) { return { bad: 1, first: 'engine threw ' + e.message }; }
    b = reference(s);
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { bad++; if (!first) first = `salt ${s} tick ${i}: engine ${a[i]} ref ${b[i]}`; break; }
  }
  return { bad, first };
}

const base = run();
let ok = base.bad === 0, caught = 0;
const breaks = [
  ['food speedup age/20 -> age/10', (file, s) => file === '07m_breed.js' ? s.replace('Math.trunc(-age / 20)', 'Math.trunc(-age / 10)') : s],
  ['adult hitbox one tick late', (file, s) => file === '07m_breed.js' ? s.replace('if (wasBaby !== e.isBaby) Br.refreshDimensions(e);', 'if (wasBaby !== e.isBaby) e._late = 1;').replace('if (e.dead) return;\n    var age = Br.getAge(e);', 'if (e.dead) return;\n    if (e._late) { e._late = 0; Br.refreshDimensions(e); }\n    var age = Br.getAge(e);') : s],
  ['ageUp unit 20 -> 10', (file, s) => file === '07m_breed.js' ? s.replace('(amount | 0) * Br.C.ageUpUnit', '(amount | 0) * 10') : s],
  ['growth puff interval 4 -> 5', (file, s) => file === '07m_breed.js' ? s.replace('e.forcedAgeTimer % Br.C.growParticleInterval', 'e.forcedAgeTimer % 5') : s],
];
for (const [name, p] of breaks) {
  const x = run(p);
  if (x.bad > 0) caught++; else { ok = false; console.log('NOT CAUGHT: ' + name); }
}
console.log(`growup: ${caught} breaks caught, ${base.bad} divergences${base.first ? " " + base.first : ""}`);
process.exit(ok && caught === breaks.length ? 0 : 1);
