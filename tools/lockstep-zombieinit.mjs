#!/usr/bin/env node
// lockstep-zombieinit -- #6938 (G17-L198): lockstep scenario 'zombieinit', 20 salts. Reference = ZombieEntity.initialize (.decomp ZombieEntity.java:442-478) +
// applyAttributeModifiers (:497-520): canPickUpLoot nextFloat<0.55*clamped, shouldBeBaby nextFloat<0.05, jockey rolls, door roll nextFloat<clamped*0.1, then
// initAttributes (spawn_reinforcements nextDouble*0.1), "Random spawn bonus" knockback nextDouble*0.05, follow-range bonus nextDouble*1.5*clamped (>1 -> MULTIPLY_TOTAL),
// leader nextFloat<clamped*0.05 -> reinforcements +[0.5,0.75), max_health x(1+[1,4)), canBreakDoors. 300 summons per salt at easy/normal/hard, day and night
// (LocalDifficulty.getClampedLocalDifficulty, time 1.4M ticks, chunk inhabited time full). The engine's real Undead/Equip code is compared per spawn.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const SALTS = 20, N = 300, TIME = 1400000, INH = 3600000;
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const f = Math.fround, cl = (v, a, b) => v < a ? a : v > b ? b : v;

// vanilla LocalDifficulty (independent of the engine)
function clampedOf(d, dayTime) {
  const id = { easy: 1, normal: 2, hard: 3 }[d];
  const moon = [1.0, 0.75, 0.5, 0.25, 0.0, 0.25, 0.5, 0.75][Math.floor(dayTime / 24000) % 8];
  let fl = 0.75; const g = f(cl(f((dayTime - 72000) / 1440000), 0, 1) * 0.25); fl += g;
  let h = 0; h += cl(INH / 3600000, 0, 1) * (d === 'hard' ? 1.0 : 0.75); h += cl(moon * 0.25, 0, g);
  if (d === 'easy') h *= 0.5; fl += h;
  const raw = f(id * fl);
  return raw < 2 ? 0 : raw > 4 ? 1 : f((raw - 2) / 2);
}
const row = (day, d, baby, jc, pick, door, rb, rm, kb, fr, leader, mh) => [day, d, baby, jc, pick, door, rb.toFixed(12), rm.toFixed(12), kb.toFixed(12), fr.toFixed(9), leader, mh.toFixed(9)].join(',');

function engine(salt, patch) {
  const M = loadEngine({ patch, dom: false, extra: ['07_world.js', '07h_entities.js', '07m_breed.js', '07y_equip.js', '07zk_undead.js', '07k_goals.js'] });
  M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
  M.Entities.init(); M.Breed.ready = true;
  const r = stream(salt), rows = [];
  for (const day of [true, false]) for (const d of ['easy', 'normal', 'hard']) {
    const clamped = M.Equip.clampedLocalDifficulty({ difficulty: d, time: day ? TIME : TIME + 13000, inhabited: INH });
    for (let i = 0; i < N; i++) {
      const z = { type: 'zombie', growAge: 0, x: 0, y: 64, z: 0, height: 1.95 };
      const pick = r() < 0.55 * clamped;
      const baby = M.Undead.rollBaby(r);
      let jc = false;
      if (baby) { z.growAge = -24000; jc = !!M.Undead.tryChickenJockey(z, r, { findChicken: () => (i % 3) === 0 ? { type: 'chicken' } : null, spawnChicken: () => ({ type: 'chicken' }) }); }
      M.Undead.initZombieAttributes(z, r, clamped);
      rows.push(row(day, d, baby, jc, pick, !!z.canBreakDoors, z.reinforceBase, z.reinforceMods, z.knockbackResistance, z.followRange, !!z.zombieLeader, z.maxHealth || 20));
    }
  }
  return rows;
}

function reference(salt) {
  const r = stream(salt), rows = [];
  for (const day of [true, false]) for (const d of ['easy', 'normal', 'hard']) {
    const c = clampedOf(d, day ? TIME : TIME + 13000);
    for (let i = 0; i < N; i++) {
      const pick = r() < f(0.55 * c);
      const baby = r() < 0.05;
      let jc = false;
      if (baby) { if (r() < 0.05) jc = (i % 3) === 0; else if (r() < 0.05) jc = true; }
      let door = r() < f(c * 0.1);
      const rb = r() * 0.1, kb = cl(r() * 0.05, 0, 1);
      const fb = r() * 1.5 * c, fr = fb > 1 ? Math.min(2048, 35 * (1 + fb)) : 35;
      let rm = 0, leader = false, mh = 20;
      if (r() < f(c * 0.05)) { leader = true; rm += r() * 0.25 + 0.5; mh = Math.min(1024, 20 * (1 + (r() * 3 + 1))); door = true; }
      rows.push(row(day, d, baby, jc, pick, door, rb, rm, kb, fr, leader, mh));
    }
  }
  return rows;
}

function run(patch) {
  let bad = 0, first = '';
  for (let s = 1; s <= SALTS; s++) {
    let a, b;
    try { a = engine(s, patch); b = reference(s); } catch (e) { return { bad: 1, first: 'threw ' + e.message }; }
    for (let i = 0; i < b.length; i++) if (a[i] !== b[i]) { bad++; if (!first) first = `salt ${s} spawn ${i}: engine ${a[i]} ref ${b[i]}`; break; }
  }
  return { bad, first };
}

const base = run();
let ok = base.bad === 0, caught = 0;
const U = (a, b) => (f, s) => f === '07zk_undead.js' ? s.replace(a, b) : s;
const breaks = [
  ['baby chance 0.05 -> 0.06', U('Undead.BABY_CHANCE = 0.05', 'Undead.BABY_CHANCE = 0.06')],
  ['leader chance 0.05 -> 0.06', U('rnd() < clamped * 0.05', 'rnd() < clamped * 0.06')],
  ['door chance 0.1 -> 0.2', U('rnd() < clamped * 0.1;', 'rnd() < clamped * 0.2;')],
  ['leader roll order swapped', U('e.reinforceMods += rnd() * 0.25 + 0.5;\n      var hb = rnd() * 3.0 + 1.0;', 'var hb = rnd() * 3.0 + 1.0;\n      e.reinforceMods += rnd() * 0.25 + 0.5;')],
];
for (const [name, p] of breaks) {
  const x = run(p);
  if (x.bad > 0) caught++; else { ok = false; console.log('NOT CAUGHT: ' + name); }
}
console.log(`zombieinit: ${caught} breaks caught, ${base.bad} divergences${base.first ? ' ' + base.first : ''}`);
process.exit(ok && caught === breaks.length ? 0 : 1);
