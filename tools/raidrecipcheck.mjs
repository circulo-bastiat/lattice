#!/usr/bin/env node
// raidrecipcheck.mjs — #4117: every illager ActiveTargetGoal(mob, X.class, ...) 3/4-arg constructor means
// reciprocalChance 10 (canStart: nextInt(10)!=0 refuses). Vindicator/pillager/ravager/evoker/illusioner target
// selectors (Player/Merchant/IronGolem) must all carry it. Break proof: zero it, each mob must then fail.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODS = []; for (const m of readFileSync(join(ROOT, 'build.mjs'), 'utf8').matchAll(/'(07[0-9a-z_]+\.js)'/g)) if (!MODS.includes(m[1])) MODS.push(m[1]);
const M = loadEngine({ extra: ['14b_physics.js', '07_world.js'].concat(MODS.filter((f) => f !== '07_world.js')) });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Breed.init && M.Breed.init(); M.Mount.init(); M.Ai.init();
const Ai = M.Ai, W = M.World, CH = M.CH;
W.init(1);
for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
const MOBS = ['vindicator', 'pillager', 'ravager', 'evoker', 'illusioner'];
function bad(mutate) {
  const out = [];
  for (const t of MOBS) {
    const e = M.EntityList.spawn(t, 0, 9, 0);
    const gs = e.ai.entries.filter((en) => en.goal instanceof Ai.NearestAttackableTargetGoal);
    if (gs.length !== 3) out.push(t + ': ' + gs.length + ' ActiveTargetGoals (want 3)');
    for (const en of gs) { if (mutate) en.goal.reciprocalChance = 0; if (en.goal.reciprocalChance !== 10) out.push(t + ' p' + en.priority + ': reciprocalChance ' + en.goal.reciprocalChance); }
  }
  return out;
}
const real = bad(false);
real.forEach((l) => console.log('FAIL ' + l));
const broken = bad(true);
if (broken.length < MOBS.length * 3) { console.log('FAIL anti-vacuity: break not caught'); process.exit(1); }
console.log('raidrecipcheck: ' + (real.length ? real.length + ' failures' : 'ok') + ', ' + broken.length + ' breaks caught');
process.exit(real.length ? 1 : 0);
