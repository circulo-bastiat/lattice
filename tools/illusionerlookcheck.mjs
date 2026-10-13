#!/usr/bin/env node
// illusionerlookcheck.mjs — #1027. IllusionerEntity.java:70 LookAtEntityGoal(MobEntity, 8.0F) at priority 10.
// Goal-priority table: 0 Float, 1 LookAtTarget, 4 GiveInvis, 5 Blind, 6 Bow, 8 Wander, 9 LookPlayer, 10 LookMob.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
console.log('illusionerlookcheck — #1027 illusioner mob-look goal');
const MODS = []; for (const m of readFileSync(join(ROOT, 'build.mjs'), 'utf8').matchAll(/'(07[0-9a-z_]+\.js)'/g)) if (!MODS.includes(m[1])) MODS.push(m[1]);
const M = loadEngine({ extra: ['14b_physics.js', '07_world.js'].concat(MODS.filter((f) => f !== '07_world.js')) });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Breed.init && M.Breed.init(); M.Mount.init(); M.Ai.init();
const Ai = M.Ai, EL = M.EntityList;
Math.random = () => 0;   // #4282: pin LookAtEntityGoal's 0.02 start roll
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

function run(Look, tag) {
  const e = EL.spawn('illusioner', 0, 9, 0);
  const at = (p) => e.ai.entries.filter((x) => x.priority === p && !(x.flags & Ai.TARGET)).map((x) => x.goal);
  ok(at(9).length === 1 && at(9)[0] instanceof Ai.LookAtPlayerGoal, tag + 'priority 9 is the player look goal');
  ok(at(10).length === 1 && at(10)[0] instanceof Look, tag + 'priority 10 is the mob look goal');
  ok(at(8).length === 1 && at(8)[0].constructor === Ai.WanderAroundGoal, tag + 'priority 8 is exactly WanderAroundGoal (#1260)');
  const g = at(10)[0];
  if (g && g.canUse) {
    const v = EL.spawn('villager', 5, 9, 0);
    ok(g.canUse() === true, tag + 'a villager within 8 blocks is looked at');
    v.x = 12; ok(g.canUse() === false, tag + 'a villager 12 blocks away is not');
    EL.remove && EL.remove(v);
  } else ok(false, tag + 'no mob look goal to exercise');
}
run(Ai.LookAtMobGoal || function () {}, '');
let breaks = 0;
{ const before = fails.length; run(Ai.LookAtPlayerGoal, 'BREAK ');
  if (fails.length > before) { breaks++; console.log(' ✓ break noticed'); } fails.length = before; }
{ const w = Ai.LookAtMobGoal; Ai.LookAtMobGoal = function () { this.canUse = () => false; this.canContinueToUse = () => false; this.start = this.stop = this.tick = () => {}; };
  const before = fails.length; const e = EL.spawn('illusioner', 0, 9, 0);
  const g = e.ai.entries.filter((x) => x.priority === 10).map((x) => x.goal)[0];
  ok(g && g.canUse(), 'BREAK dead mob-look goal'); if (fails.length > before) { breaks++; console.log(' ✓ break noticed'); } fails.length = before; Ai.LookAtMobGoal = w; }
{ const w = Ai.WanderAroundGoal; Ai.WanderAroundGoal = function () {}; const before = fails.length; run(Ai.LookAtMobGoal, 'BREAK wander ');
  if (fails.length > before) { breaks++; console.log(' ✓ break noticed'); } fails.length = before; Ai.WanderAroundGoal = w; }
for (const f of fails) console.log(' x ' + f);
console.log('\nillusionerlookcheck: ' + pass + ' assertions, ' + fails.length + ' failures, ' + breaks + ' breaks caught');
process.exit(fails.length || breaks < 3 ? 1 : 0);
