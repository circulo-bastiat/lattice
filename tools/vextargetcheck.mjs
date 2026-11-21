#!/usr/bin/env node
// vextargetcheck.mjs — #4283: vex ActiveTargetGoal(Player,true) = 1-in-10 delay + visibility + 60-tick unseen drop.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const M = loadEngine({
  extra: ['07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
          '14i_hand.js', '14j_combat.js', '14d_survival.js', '07q_effects.js', '07z_potion.js',
          '07v_spell.js', '07k_goals.js', '07t_fly.js', '07s_raid.js']
});
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Hand.init(); M.Combat.init(); M.Ai.init(); M.Raid.init();
M.World.init(1);
const bad = [];
const check = (v) => {
  const g = v.ai.entries.filter((en) => en.priority === 3 && en.goal.maxNoSight !== undefined).map((en) => en.goal);
  if (g.length !== 1) return ['no vex ActiveTargetGoal at priority 3'];
  const r = [];
  if (!g[0].sight) r.push('sight off');
  if (g[0].reciprocalChance !== 10) r.push('reciprocalChance ' + g[0].reciprocalChance);
  if (g[0].maxNoSight !== 60) r.push('maxNoSight ' + g[0].maxNoSight);
  return r;
};
const v = M.EntityList.spawn('vex', 0.5, 8, 0.5);
for (const m of check(v)) bad.push('vex target goal: ' + m);
// anti-vacuity: a goal missing the opts must be flagged
const fake = { ai: { entries: [{ priority: 3, goal: { maxNoSight: 60, sight: false, reciprocalChance: 0 } }] } };
const breaks = check(fake).length === 2 ? 1 : 0;
if (!breaks) bad.push('anti-vacuity: broken goal not flagged');
if (bad.length) { console.log('FAILED:\n  - ' + bad.join('\n  - ')); process.exit(1); }
console.log(`PASS vextargetcheck — 4 assertions, ${breaks} breaks caught, 0 failure(s)`);
