#!/usr/bin/env node
// evokerlookcheck.mjs — #649. EvokerEntity.initGoals: 8 WanderAroundGoal(0.6) (plain), 9 LookAtEntityGoal(Player,3),
// 10 LookAtEntityGoal(MobEntity,8). Live: an idle evoker turns its head to a villager within 8 blocks.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
console.log('evokerlookcheck — #649 evoker goal roster (priority 8 wander, 10 mob look)');
const MODS = []; for (const m of readFileSync(join(ROOT, 'build.mjs'), 'utf8').matchAll(/'(07[0-9a-z_]+\.js)'/g)) if (!MODS.includes(m[1])) MODS.push(m[1]);
const M = loadEngine({ extra: ['14b_physics.js', '07_world.js'].concat(MODS.filter((f) => f !== '07_world.js')) });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Breed.init && M.Breed.init(); M.Mount.init(); M.Ai.init();
const Ai = M.Ai, EL = M.EntityList;
Math.random = () => 0;   // #4282: pin LookAtEntityGoal's 0.02 start roll
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

function run(Wander, Look, tag) {
  const e = EL.spawn('evoker', 0, 9, 0);
  const at = (p) => e.ai.entries.filter((x) => x.priority === p).map((x) => x.goal);
  ok(at(8).length === 1 && at(8)[0] instanceof Wander, tag + 'priority 8 is WanderAroundGoal');
  ok(at(10).length === 1 && at(10)[0] instanceof Look, tag + 'priority 10 is the mob look goal');
  ok(at(9).length === 1 && at(9)[0] instanceof Ai.LookAtPlayerGoal, tag + 'priority 9 stays the player look goal');
  // live: the mob-look goal picks a villager 5 blocks away, and not one 12 away
  const g = at(10)[0];
  if (g && g.canUse) {
    const v = EL.spawn('villager', 5, 9, 0);
    let hit = false; for (let i = 0; i < 2000 && !hit; i++) hit = g.canUse();   // the 0.02 start roll is the goal's own seeded rand now
    ok(hit === true, tag + 'a villager within 8 blocks is looked at');
    v.x = 12; let far = false; for (let i = 0; i < 2000; i++) far = far || g.canUse(); ok(far === false, tag + 'a villager 12 blocks away is not');
    EL.remove && EL.remove(v);
  } else ok(false, tag + 'no mob look goal to exercise');
}
run(Ai.WanderAroundGoal, Ai.LookAtMobGoal || function () {}, '');
// anti-vacuity: break the roster's own expectations and demand each is noticed
let breaks = 0;
{ const before = fails.length; run(Ai.WaterAvoidingRandomStrollGoal, Ai.LookAtPlayerGoal, 'BREAK '); 
  if (fails.length > before) { breaks++; console.log(" ✓ break noticed"); } fails.length = before; }
{ const w = Ai.LookAtMobGoal; Ai.LookAtMobGoal = function () { this.canUse = () => false; this.canContinueToUse = () => false; this.start = this.stop = this.tick = () => {}; };
  Ai.ROSTER.evoker && (void 0); const before = fails.length; const e = EL.spawn('evoker', 0, 9, 0);
  const g = e.ai.entries.filter((x) => x.priority === 10).map((x) => x.goal)[0];
  ok(g && g.canUse(), 'BREAK dead mob-look goal'); if (fails.length > before) { breaks++; console.log(" ✓ break noticed"); } fails.length = before; Ai.LookAtMobGoal = w; }
for (const f of fails) console.log(' x ' + f);
console.log('\nevokerlookcheck: ' + pass + ' assertions, ' + fails.length + ' failures, ' + breaks + ' breaks caught');
process.exit(fails.length || breaks < 2 ? 1 : 0);
