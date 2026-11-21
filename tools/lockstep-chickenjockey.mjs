#!/usr/bin/env node
// lockstep-chickenjockey -- #6898 (G17-L181): lockstep scenario 'chickenjockey', 20 salts. Reference = ZombieEntity.initialize (.decomp:441-469: shouldBeBaby
// nextFloat<0.05, then if(nextFloat<0.05) mount a free chicken within 5x3x5 [none -> nothing, NO second roll] else if(nextFloat<0.05) fresh chicken jockey),
// Zombie.BABY_SPEED_BOOST (+0.5 MULTIPLY_BASE -> 0.23*1.5), ZombieEntity.getXpToDrop (baby: 5*2.5 -> 12, adult 5) and MobEntity daylight burn (no helmet ->
// setOnFireFor(8)). 100 spawns per salt, each rolled on one stream; the engine's real Undead.rollBaby/tryChickenJockey, Ai.movementSpeedOf, Xp.xpToDrop and
// Cb.tickDaylightBurn are compared with the reference per spawn (day and night). Attack reach is owed (see the issue note).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const SALTS = 20, N = 100;
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };

function engine(salt, patch) {
  const M = loadEngine({ patch, dom: false, extra: ['07_world.js', '07h_entities.js', '07m_breed.js', '07zk_undead.js', '07k_goals.js', '14j_combat.js', '07zz_xporb.js'] });
  M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
  M.Entities.init(); M.Breed.ready = true;
  const r = stream(salt), rows = [];
  for (const day of [true, false]) {
    M.Sky = { isDay: () => day, darknessNow: () => 0, weather: null };
    M.World = Object.assign(M.World || {}, { getLight: () => 15 << 4, canSeeSky: () => true });
    for (let i = 0; i < N; i++) {
      const z = { type: 'zombie', growAge: 0, x: 0, y: 64, z: 0, height: 1.95 };
      if (M.Undead.rollBaby(r)) z.growAge = -24000;
      const chickenNear = (i % 3) === 0;
      const jc = M.Undead.tryChickenJockey(z, r, { findChicken: () => chickenNear ? { type: 'chicken' } : null, spawnChicken: () => ({ type: 'chicken' }) });
      const baby = z.growAge < 0;
      z.fire = 0; z.onFireTicks = 0;
      const burned = M.Combat.tickDaylightBurn(z, () => 0);
      rows.push([day, baby, !!jc, M.Ai.movementSpeedOf(z).toFixed(6), M.Xp.xpToDrop(z, r), burned].join(','));
    }
  }
  return rows;
}

function reference(salt) {
  const r = stream(salt), rows = [];
  for (const day of [true, false]) for (let i = 0; i < N; i++) {
    const baby = r() < 0.05;
    let jockey = false;
    if (baby) { if (r() < 0.05) jockey = (i % 3) === 0; else if (r() < 0.05) jockey = true; }
    rows.push([day, baby, jockey, (0.23 * (baby ? 1.5 : 1)).toFixed(6), baby ? 12 : 5, day].join(','));
  }
  return rows;
}

function run(patch) {
  let bad = 0, first = '';
  for (let s = 1; s <= SALTS; s++) {
    let a, b;
    try { a = engine(s, patch); b = reference(s); } catch (e) { return { bad: 1, first: 'threw ' + e.message }; }
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { bad++; if (!first) first = `salt ${s} spawn ${i}: engine ${a[i]} ref ${b[i]}`; break; }
  }
  return { bad, first };
}

const base = run();
let ok = base.bad === 0, caught = 0;
const breaks = [
  ['baby speed +0.5 -> +0.4', (f, s) => f === '07k_goals.js' ? s.replace('NS.Breed.isBaby(e)) base *= 1.5;', 'NS.Breed.isBaby(e)) base *= 1.4;') : s],
  ['baby xp 2.5 -> 2', (f, s) => f === '07zz_xporb.js' ? s.replace('base * 2.5', 'base * 2') : s],
  ['baby chance 0.05 -> 0.06', (f, s) => f === '07zk_undead.js' ? s.replace('Undead.BABY_CHANCE = 0.05', 'Undead.BABY_CHANCE = 0.06') : s],
  ['jockey chance 0.05 -> 0.06', (f, s) => f === '07zk_undead.js' ? s.replace('Undead.CHICKEN_JOCKEY_ROLL_CHANCE = 0.05', 'Undead.CHICKEN_JOCKEY_ROLL_CHANCE = 0.06') : s],
];
for (const [name, p] of breaks) {
  const x = run(p);
  if (x.bad > 0) caught++; else { ok = false; console.log('NOT CAUGHT: ' + name); }
}
console.log(`chickenjockey: ${caught} breaks caught, ${base.bad} divergences${base.first ? ' ' + base.first : ''}`);
process.exit(ok && caught === breaks.length ? 0 : 1);
