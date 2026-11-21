// powdersnowjumpcheck.mjs -- #951: generic Ai.PowderSnowJumpGoal (PowderSnowJumpGoal.java) is wired at
// silverfish/endermite/rabbit (1) and fox (0), only fires for powder_snow_walkable_mobs, and jumps.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; if (c) pass++; else fails.push('anti-vacuity: ' + m); };

const M = loadEngine({
  extra: ['07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
          '14i_hand.js', '14j_combat.js', '14d_survival.js', '07q_effects.js', '07z_potion.js',
          '07v_spell.js', '07k_goals.js', '07t_fly.js', '07s_raid.js', '07zn_silverfish.js', '07zn2_endermite.js', '07zh_rabbit.js', '07zj_fox.js']
});
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8'))
});
M.Entities.init(); M.EntityList.init(); M.Hand.init(); M.Combat.init(); M.Ai.init(); M.Raid.init();
const EL = M.EntityList, Ai = M.Ai;
M.Player = null;

function has(e) { return e.ai.entries.some(x => x.goal instanceof Ai.PowderSnowJumpGoal); }
function pri(e) { const x = e.ai.entries.find(x => x.goal instanceof Ai.PowderSnowJumpGoal); return x && x.priority; }
for (const [t, p] of [['silverfish', 1], ['endermite', 1], ['rabbit', 1], ['fox', 0]]) {
  const e = EL.spawn(t, 0, 30, 0);
  ok(has(e) && pri(e) === p, t + ' has PowderSnowJumpGoal at priority ' + p);
  EL.clear();
}
{
  const g = EL.spawn('goat', 0, 30, 0);
  okAv(!has(g), 'goat (not a vanilla user) has no PowderSnowJumpGoal');
  EL.clear();
}

// behaviour against a fake world: powder snow at the mob's feet cell, air above
let snowState = 0;
const snowId = M.Reg.names.indexOf('powder_snow');
for (let s = 1; s < M.States.block.length; s++) if (M.States.block[s] === snowId) { snowState = s; break; }
ok(snowState > 0, 'found the powder_snow state');
const stoneState = M.States.block.findIndex(b => b === M.Reg.names.indexOf('stone'));
const realBlockAt = M.Physics.blockAt;
function run(type, inSnow, headSolid) {
  const e = EL.spawn(type, 0.5, 30, 0.5);
  M.Physics.blockAt = (x, y, z) => (y === 30 && inSnow) ? snowState : (y === 31 && headSolid ? stoneState : 0);
  const realSolid = M.Physics.solidAt;
  M.Physics.solidAt = (x, y, z) => headSolid && y === 31;
  const g = new Ai.PowderSnowJumpGoal(e);
  e.jumping = false;
  const used = g.canUse();
  if (used) g.tick();
  M.Physics.blockAt = realBlockAt; M.Physics.solidAt = realSolid;
  EL.clear();
  return used && e.jumping === true;
}
ok(run('rabbit', true, false) === true, 'rabbit in powder snow jumps');
okAv(run('rabbit', false, false) === false, 'rabbit on dry land does not jump');
okAv(run('rabbit', true, true) === false, 'rabbit with a solid block above the head does not jump');
okAv(run('cow', true, false) === false, 'cow (not in powder_snow_walkable_mobs) does not jump');

console.log('');
if (fails.length) { for (const f of fails) console.log('  - ' + f); console.log(`${pass} ok, ${breaks} breaks caught, ${fails.length} FAILED`); process.exit(1); }
console.log(`PASS powdersnowjumpcheck -- ${pass} ok, ${breaks} breaks caught`);
