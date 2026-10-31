#!/usr/bin/env node
// lockstep-spiderjockey -- #8721 (G18c-L18): lockstep scenario 'spiderjockey', 20 salts. Reference = SpiderEntity.initialize (.decomp SpiderEntity.java:152-175):
// nextInt(100)==0 -> a skeleton rider mounted on the spider; then, for fresh SpiderData, difficulty HARD and nextFloat < 0.1 * clampedLocalDifficulty ->
// SpiderData.setEffect nextInt(5): 0-1 speed, 2 strength, 3 regeneration, 4 invisibility. CaveSpiderEntity.initialize (:54) returns the data untouched: NO rolls.
// 1000 spawns per difficulty and per mob per salt, one stream; the engine's real Undead.trySpiderJockey / trySpiderEffect are compared per spawn.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const SALTS = 20, N = 1000, TIME = 1400000, INH = 3600000;
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
const TABLE = ['speed', 'speed', 'strength', 'regeneration', 'invisibility'];

function engine(salt, patch) {
  const M = loadEngine({ patch, dom: false, extra: ['07_world.js', '07h_entities.js', '07m_breed.js', '07y_equip.js', '07zk_undead.js', '07k_goals.js'] });
  M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
  M.Entities.init(); M.Breed.ready = true;
  const r = stream(salt), rows = [];
  for (const mob of ['spider', 'cave_spider']) for (const d of ['easy', 'normal', 'hard']) {
    M.Diff = M.Difficulty = { isHard: () => d === 'hard', get: () => d };
    M.Equip.at = () => ({ difficulty: d, time: TIME, inhabited: INH });
    for (let i = 0; i < N; i++) {
      const sp = { type: mob, x: 0, y: 64, z: 0, height: 0.9 };
      const sk = M.Undead.trySpiderJockey(sp, r, { spawnSkeleton: () => ({ type: 'skeleton', x: 0, y: 64, z: 0 }) });
      const eff = M.Undead.trySpiderEffect(sp, r, {});
      rows.push([mob, d, !!sk, sk ? sk.type : '-', eff || '-'].join(','));
    }
  }
  return rows;
}

function reference(salt) {
  const r = stream(salt), rows = [];
  for (const mob of ['spider', 'cave_spider']) for (const d of ['easy', 'normal', 'hard']) {
    const c = clampedOf(d, TIME);
    for (let i = 0; i < N; i++) {
      let jockey = false, eff = '-';
      if (mob === 'spider') {
        jockey = r() < 0.01;
        if (d === 'hard' && r() < f(0.1 * c)) eff = TABLE[Math.floor(r() * 5)];
      }
      rows.push([mob, d, jockey, jockey ? 'skeleton' : '-', eff].join(','));
    }
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
const U = (a, b) => (fl, s) => { if (fl !== '07zk_undead.js') return s; if (!s.includes(a)) throw new Error('break target not found: ' + a); return s.replace(a, b); };
const breaks = [
  ['jockey chance 0.01 -> 0.02', U('Undead.SPIDER_JOCKEY_CHANCE = 0.01', 'Undead.SPIDER_JOCKEY_CHANCE = 0.02')],
  ['effect chance 0.1 -> 0.2', U('Undead.SPIDER_EFFECT_CHANCE = 0.1', 'Undead.SPIDER_EFFECT_CHANCE = 0.2')],
  ['effect table strength -> regeneration', U("'speed', 'speed', 'strength'", "'speed', 'speed', 'regeneration'")],
  ['effect on every difficulty', U('!Diff.isHard || !Diff.isHard()', 'false')],
];
for (const [name, p] of breaks) {
  const x = run(p);
  if (x.bad > 0) caught++; else { ok = false; console.log('NOT CAUGHT: ' + name); }
}
console.log(`spiderjockey: ${SALTS} salts, ${caught} breaks caught, ${base.bad} divergences, ${SALTS * 6 * N} assertions, ${base.bad} failures${base.first ? " " + base.first : ""}`);
process.exit(ok && caught === breaks.length ? 0 : 1);
