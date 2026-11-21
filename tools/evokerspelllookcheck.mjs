#!/usr/bin/env node
// evokerspelllookcheck.mjs — #1126. SpellcastingIllager LookAtTargetGoal: start clears the path, tick = LookControl (rate-limited), spellTicks-- is mobTick.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
console.log('evokerspelllookcheck — #1126 casting look is rate-limited, spellTicks counts in mobTick');
const MODS = []; for (const m of readFileSync(join(ROOT, 'build.mjs'), 'utf8').matchAll(/'(07[0-9a-z_]+\.js)'/g)) if (!MODS.includes(m[1])) MODS.push(m[1]);
const M = loadEngine({ extra: ['14b_physics.js', '07_world.js'].concat(MODS.filter((f) => f !== '07_world.js')) });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Breed.init && M.Breed.init(); M.Mount.init(); M.Ai.init();
const Ai = M.Ai, EL = M.EntityList;
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const SP = M.Spell;
function run(tag, goalFn, tickFn) {
  const e = EL.spawn('evoker', 0, 9, 0);
  const t = EL.spawn('villager', 10, 9, 0);   // due east: wanted head yaw is far from 0
  e.target = t; e.yaw = 0; e.yHeadRot = 0; e.path = [1]; e.spellTicks = 5;
  const g = new (goalFn || SP.LookAtTargetGoal)(e);
  Ai.tickHead(e); e.yHeadRot = 0; g.start();
  ok(e.path === null, tag + 'start() clears the path');
  g.tick(); Ai.tickHead(e);
  ok(e.yaw === 0, tag + 'tick never writes e.yaw');
  ok(Math.abs(e.yHeadRot || 0) > 0 && Math.abs(e.yHeadRot) < 0.6, tag + 'head turn is rate-limited, got ' + e.yHeadRot);
  const n = e.spellTicks; g.tick(); ok(e.spellTicks === n, tag + 'goal tick does not decrement spellTicks');
  (tickFn || SP.mobTick)(e); ok(e.spellTicks === n - 1, tag + 'mobTick decrements spellTicks');
}
run('', null, null);
let breaks = 0;
{ const before = fails.length;
  run('BREAK ', function (e) { this.start = () => {}; this.stop = () => {};
    this.tick = () => { e.yaw = Math.atan2(10, 0); if (e.spellTicks > 0) e.spellTicks--; }; }, () => {});
  if (fails.length > before) { breaks++; console.log(' ✓ break noticed'); } fails.length = before; }
for (const f of fails) console.log(' x ' + f);
console.log('\nevokerspelllookcheck: ' + pass + ' assertions, ' + fails.length + ' failures, ' + breaks + ' breaks caught');
process.exit(fails.length || breaks < 1 ? 1 : 0);
