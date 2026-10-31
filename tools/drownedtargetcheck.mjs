#!/usr/bin/env node
// drownedtargetcheck.mjs — #1238. ZombieEntity.initCustomGoals targetSelector rows (.decomp):
// 1 RevengeGoal, 2 ActiveTargetGoal<Player>, 3 ActiveTargetGoal<IronGolem>, 5 ActiveTargetGoal<Turtle, BABY_TURTLE_ON_LAND>; plus 3 Merchant (existing). Checked for zombie.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
console.log('drownedtargetcheck — drowned target goals vs DrownedEntity.initCustomGoals');
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
// DrownedEntity.initCustomGoals: ActiveTargetGoal(Player,10,true,false,..) mustSee, (Merchant,false), (IronGolem,true), (Axolotl,true,false), (Turtle,10,true,false,filter) checkVisibility=true; all reciprocalChance 10
const want = [[2, 'player', true], [3, 'merchant', false], [3, 'iron_golem', true], [3, 'axolotl', true], [5, 'turtle', true]];
function judge(label, rows) {
  want.forEach(([pri, name, ms], i) => {
    const r = rows.filter((x) => x.pri === pri)[name === 'player' || name === 'turtle' ? 0 : ['merchant', 'iron_golem', 'axolotl'].indexOf(name)];
    ok(!!r, label + ': ' + name + ' goal at ' + pri);
    if (!r) return;
    ok(r.goal.opts.reciprocalChance === 10, label + ': ' + name + ' reciprocalChance 10');
    ok(!!r.goal.opts.mustSee === ms, label + ': ' + name + ' mustSee ' + ms);
    ok(name === 'merchant' || !!r.goal.opts.sight === ms || name === 'player', label + ': ' + name + ' sight');
    ok(name === 'player' || r.goal.opts.livingBox === true, label + ': ' + name + ' livingBox');
  });
}
judge('drowned', targetRows('drowned'));
// anti-vacuity: a roster missing each row must be noticed
let breaks = 0;
for (const [label, f] of [['player reciprocalChance dropped', (r) => { delete r[0].goal.opts.reciprocalChance; }], ['golem mustSee dropped', (r) => { delete r[2].goal.opts.mustSee; }], ['turtle mustSee dropped', (r) => { delete r[4].goal.opts.mustSee; }], ['axolotl goal removed', (r) => { r.splice(3, 1); }]]) {
  const before = fails.length, rows = targetRows('drowned').sort((a, b) => a.pri - b.pri);
  f(rows); judge('mutant(' + label + ')', rows);
  if (fails.length > before) { breaks++; fails.length = before; console.log(' ✓ ' + label + ': noticed'); } else fails.push('anti-vacuity: ' + label + ' unnoticed');
}
if (fails.length) { console.log('FAIL:'); fails.forEach((f) => console.log(' x ' + f)); }
console.log('\ndrownedtargetcheck: ' + pass + ' assertions, ' + fails.length + ' failures, ' + breaks + ' breaks caught');
process.exit(fails.length ? 1 : 0);
