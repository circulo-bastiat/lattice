// vexlookcheck.mjs -- #764: VexEntity.initGoals' LookAtEntityGoal(Player,3F,1F) at 9 and
// LookAtEntityGoal(Mob,8F) at 10 are wired; the roster matches goals 0,4,8,9,10 + targets 1,2,3.
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
          '07v_spell.js', '07k_goals.js', '07t_fly.js', '07s_raid.js']
});
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8'))
});
M.Entities.init(); M.EntityList.init(); M.Hand.init(); M.Combat.init(); M.Ai.init(); M.Raid.init();
const EL = M.EntityList, Ai = M.Ai;
Math.random = () => 0;   // #4282: pin LookAtEntityGoal's 0.02 start roll

function roster(e) { return e.ai.entries.map(x => x.priority + (x.flags & Ai.TARGET ? 't' : 'g')).sort().join(','); }
function build() {
  M.Player = null;
  const vex = EL.spawn('vex', 0, 30, 0);
  return vex;
}
{
  const vex = build();
  const got = roster(vex);
  ok(got === '0g,0g,10g,1t,2t,3t,4g,8g,9g', 'vex roster is goals 0,4,8,9,10 + targets 1,2,3, got ' + got);
  okAv(roster({ ai: { entries: vex.ai.entries.filter(x => x.priority !== 10) } }) !== '0g,0g,10g,1t,2t,3t,4g,8g,9g',
    'dropping priority 10 makes the roster comparison fail');
  const e10 = vex.ai.entries.find(x => x.priority === 10);
  ok(e10 && e10.goal instanceof Ai.LookAtMobGoal && (e10.flags & Ai.LOOK), 'priority 10 is a LOOK LookAtMobGoal');
  EL.clear();
}
// behaviour: an idle vex turns its head to a mob within 8, not one outside
function looked(dist) {
  const vex = EL.spawn('vex', 0, 30, 0);
  EL.spawn('cow', dist, 30, 0);
  const calls = [];
  vex.look = { setLookAt: (x, y, z) => calls.push([x, y, z]) };
  const goal = new Ai.LookAtMobGoal(vex, { entities: () => EL.list }, 8.0);
  let used = goal.canUse();
  if (used) { goal.start(); goal.tick(); }
  EL.clear();
  return used && calls.length === 1 && calls[0][0] === dist ? 'looked' : (used ? 'bad' : 'idle');
}
ok(looked(5) === 'looked', 'a mob 5 blocks away is picked');
okAv(looked(20) === 'idle', 'a mob 20 blocks away is not picked');

// VexLookAtTargetGoal accepts cave_air (world.isAir), refuses stone
{
  const caveAir = M.States.isAir.findIndex((v, i) => v && i !== 0);
  const stone = M.States.isAir.findIndex(v => !v);
  const pick = (id) => {
    const vex = EL.spawn('vex', 0, 30, 0);
    let moved = 0;
    vex.flyMove = { isMoving: () => false, moveTo: () => { moved++; } };
    const saved = M.Physics.blockAt;
    M.Physics.blockAt = () => id;
    const g = new Ai.VexLookAtTargetGoal(vex, { random: () => 0.5 });
    g.tick();
    M.Physics.blockAt = saved; EL.clear();
    return moved;
  };
  ok(caveAir > 0, 'a non-zero air state exists');
  ok(pick(caveAir) === 1, 'cave_air is accepted');
  okAv(pick(stone) === 0, 'a solid state is refused');
}
console.log('');
if (fails.length) { for (const f of fails) console.log('  - ' + f); console.log(`${pass} ok, ${breaks} breaks caught, ${fails.length} FAILED`); process.exit(1); }
console.log(`PASS vexlookcheck -- ${pass} ok, ${breaks} breaks caught`);
