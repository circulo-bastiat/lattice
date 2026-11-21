#!/usr/bin/env node
// irongolemwandercheck.mjs — #1189: SnowGolemEntity.initGoals priority 2 is WanderAroundFarGoal(1.0, 1.0000001E-5F)
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
console.log('irongolemwandercheck — IronGolemWanderAroundGoal: chance 240, falls back to a random stroll with no villager');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const Ai = M.Ai, EL = M.EntityList;
const e = { x: 0, y: 9, z: 0, despawnCounter: 0 };
const seq = (...v) => { let i = 0; return () => v[Math.min(i++, v.length - 1)]; };
function rate(Goal) { const g = new Goal(e, 0.6, { random: seq(0.006, 0.9), villagers: () => [] }); return g.canUse(); }
function fallback(Goal) { const g = new Goal(e, 0.6, { random: seq(0.001, 0.9), villagers: () => [] }); return g.canUse(); }
ok(!rate(Ai.IronGolemWanderAroundGoal), 'roll 0.006 passes (chance 120, not 240)');
ok(fallback(Ai.IronGolemWanderAroundGoal), 'no villager: no random-range fallback');
// anti-vacuity: break the goal two ways
const Orig = Ai.IronGolemWanderAroundGoal.__orig || Ai.IronGolemWanderAroundGoal;
const src = Orig.toString();
const mk = (s) => new Function('Ai', 'NS', 'return ' + s)(Ai, M);
breaks++; ok(rate(mk(src.replace(', 240)', ')'))), 'break 1 (chance 120) not noticed'); console.log(' ✓ break 1: chance 120 noticed');
breaks++; ok(!fallback(mk(src.replace('if (!eligible.length) { mode = inner; return true; }', 'if (!eligible.length) return false;'))), 'break 2 (no fallback) not noticed'); console.log(' ✓ break 2: missing fallback noticed');
console.log((fails.length ? 'FAIL\n' + fails.map((f) => ' x ' + f).join('\n') + '\n' : '') + 'irongolemwandercheck: ' + pass + ' assertions, ' + fails.length + ' failures, ' + breaks + ' breaks caught');
process.exit(fails.length ? 1 : 0);
