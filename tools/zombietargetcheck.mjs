#!/usr/bin/env node
// zombietargetcheck.mjs — #1238. ZombieEntity.initCustomGoals targetSelector rows (.decomp):
// 1 RevengeGoal, 2 ActiveTargetGoal<Player>, 3 ActiveTargetGoal<IronGolem>, 5 ActiveTargetGoal<Turtle, BABY_TURTLE_ON_LAND>; plus 3 Merchant (existing). Checked for zombie.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
console.log('zombietargetcheck — zombie target goals vs ZombieEntity.initCustomGoals');
const MODS = []; for (const m of readFileSync(join(ROOT, 'build.mjs'), 'utf8').matchAll(/'(07[0-9a-z_]+\.js)'/g)) if (!MODS.includes(m[1])) MODS.push(m[1]);
const M = loadEngine({ extra: ['14b_physics.js', '07_world.js'].concat(MODS.filter((f) => f !== '07_world.js')) });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Breed.init && M.Breed.init(); M.Mount.init(); M.Ai.init();
const Ai = M.Ai, EL = M.EntityList;
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };

function targetRows(type, variant) {
  const gs = new Ai.GoalSelector(), rows = [];
  const orig = Ai.NearestAttackableTargetGoal, origAdd = Ai.GoalSelector.prototype.add;
  const fake = { type, x: 0, y: 0, z: 0 };
  const ctx = { players: () => [], golems: () => ['G'], random: Math.random, onShoot() {} };
  Ai.NearestAttackableTargetGoal = function (e, cands, opts) { this.cands = cands; this.opts = opts || {}; this.canUse = () => false; };
  Ai.GoalSelector.prototype.add = function (pri, flags, goal) { if (goal instanceof Ai.NearestAttackableTargetGoal) rows.push({ pri, goal }); return origAdd.apply(this, arguments); };
  try { (variant || Ai.ROSTER[type])(fake, ctx); } finally { Ai.NearestAttackableTargetGoal = orig; Ai.GoalSelector.prototype.add = origAdd; }
  return rows;
}
const golemRow = (rows) => rows.find((r) => r.pri === 3 && r.goal.cands().join() === 'G');
const turtleRow = (rows) => rows.find((r) => r.pri === 5 && r.goal.cands.toString().includes('turtle'));
function judge(type, rows, expectPiglin) {
  ok(rows.filter((r) => r.pri === 2).length === 1, type + ': Player target at 2');
  const g = golemRow(rows), t = turtleRow(rows);
  ok(!!g, type + ': ActiveTargetGoal<IronGolem> at 3');
  ok(g && g.goal.opts.mustSee && g.goal.opts.reciprocalChance === 10, type + ': golem goal checkVisibility + reciprocal 10');
  ok(!!t, type + ': ActiveTargetGoal<Turtle> at 5');
  ok(t && t.goal.opts.reciprocalChance === 10, type + ': turtle goal reciprocal 10');
  return t;
}
for (const [type, piglin] of [['zombie', false]]) {
  const rows = targetRows(type);
  const t = judge(type, rows, piglin);
  if (type === 'zombie' && t) {
    // BABY_TURTLE_ON_LAND_FILTER: only a baby turtle out of water is a candidate
    const save = EL.list; const mk = (b, w) => ({ type: 'turtle', isBaby: b, inWater: w, x: 0, y: 0, z: 0 });
    EL.list = [mk(true, false), mk(false, false), mk(true, true)];
    ok(t.goal.cands().length === 1, 'turtle filter keeps only baby-on-land');
    EL.list = save;
  }
}
// anti-vacuity: a roster missing each row must be noticed
let breaks = 0;
for (const [label, drop] of [['golem goal removed', (r) => r.filter((x) => x !== golemRow(r))], ['turtle goal removed', (r) => r.filter((x) => x !== turtleRow(r))]]) {
  const before = fails.length, rows = drop(targetRows('zombie'));
  judge('mutant(' + label + ')', rows, false);
  if (fails.length > before) { breaks++; fails.length = before; console.log(' ✓ ' + label + ': noticed'); } else fails.push('anti-vacuity: ' + label + ' unnoticed');
}
if (fails.length) { console.log('FAIL:'); fails.forEach((f) => console.log(' x ' + f)); }
console.log('\nzombietargetcheck: ' + pass + ' assertions, ' + fails.length + ' failures, ' + breaks + ' breaks caught');
process.exit(fails.length ? 1 : 0);
