#!/usr/bin/env node
// snowgolemwandercheck.mjs — #1189: SnowGolemEntity.initGoals priority 2 is WanderAroundFarGoal(1.0, 1.0000001E-5F)
// (.decomp WanderAroundFarGoal.java:19-30): in water -> FuzzyTargeting.find(15,7); else nextFloat() >= probability ?
// FuzzyTargeting.find(10,7) : NoPenaltyTargeting. The roster must hold Ai.WanderAroundFarGoal there, not the
// NoPenalty-only Ai.WaterAvoidingRandomStrollGoal.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODS = []; for (const m of readFileSync(join(ROOT, 'build.mjs'), 'utf8').matchAll(/'(07[0-9a-z_]+\.js)'/g)) if (!MODS.includes(m[1])) MODS.push(m[1]);
const M = loadEngine({ extra: ['14b_physics.js', '07_world.js'].concat(MODS.filter((f) => f !== '07_world.js')) });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Breed.init && M.Breed.init(); M.Mount.init(); M.Ai.init();
const Ai = M.Ai, EL = M.EntityList;
console.log('snowgolemwandercheck — snow_golem wanders with WanderAroundFarGoal(1.0, 1.0000001E-5F)');

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function wander(e) {
  const en = e.ai.entries.find((x) => x.priority === 2);
  return en && en.goal;
}
function verdict(e) {
  const g = wander(e);
  return !!g && g.probability === 1.0000001e-5 && g.waterRadius === 15 && g.dryRadius === 10 && g.constructor !== Ai.WaterAvoidingRandomStrollGoal;
}
const e = EL.spawn('snow_golem', 0, 9, 0);
ok(!!e && !!e.ai, 'snow_golem spawns with an ai');
ok(verdict(e), 'priority 2 is a WanderAroundFar goal with probability 1.0000001E-5 and the 15/10 radii');
ok(typeof Ai.WanderAroundFarGoal === 'function', 'Ai.WanderAroundFarGoal exists');

// anti-vacuity: break the roster in three ways, each must be noticed
const en = e.ai.entries.find((x) => x.priority === 2), orig = en.goal;
en.goal = new Ai.WaterAvoidingRandomStrollGoal(e, 1.0, Math.random); breaks++; ok(!verdict(e), 'break 1 (old NoPenalty stroll) not noticed'); console.log(' ✓ break 1: old stroll goal noticed');
en.goal = new Ai.WanderAroundFarGoal(e, 1.0, Math.random, 0.001); breaks++; ok(!verdict(e), 'break 2 (probability 0.001) not noticed'); console.log(' ✓ break 2: probability 0.001 noticed');
en.goal = new Ai.WanderAroundFarGoal(e, 1.0, Math.random, 1.0000001e-5); en.goal.waterRadius = 10; breaks++; ok(!verdict(e), 'break 3 (water radius 10) not noticed'); console.log(' ✓ break 3: water radius 10 noticed');
en.goal = orig;
ok(verdict(e), 'restored roster passes again');

console.log((fails.length ? 'FAIL\n' + fails.map((f) => ' x ' + f).join('\n') + '\n' : '') + 'snowgolemwandercheck: ' + pass + ' assertions, ' + fails.length + ' failures, ' + breaks + ' breaks caught');
process.exit(fails.length ? 1 : 0);
