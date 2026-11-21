#!/usr/bin/env node
// irongolemcheck.mjs — #734: iron golem PlayerCreated + CarvedPumpkinBlock's iron-golem T pattern.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const brk = (c, m) => { if (c) breaks++; else fails.push('anti-vacuity: ' + m); };

const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07h_entities.js', '14b_physics.js',
          '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14j_combat.js', '07zw_mobnbt.js',
          '07zq_snowgolem.js'],
  dom: false
});
initRegistry(M);
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8'))
});
M.Entities.init(); M.EntityList.init(); M.Ai.init();
if (M.Combat && M.Combat.init) M.Combat.init();
const SR = M.States, EL = M.EntityList, SG = M.SnowGolem, Ai = M.Ai;

const CELLS = new Map(); const key = (x, y, z) => x + ',' + y + ',' + z;
M.World = { getBlock: (x, y, z) => CELLS.get(key(x, y, z)) || 0,
  setBlock: (x, y, z, s) => { CELLS.set(key(x, y, z), s); return true; }, biomeAt: () => 0, heightAt: () => 0, get: () => null };
const st = (n) => SR.stateOf(n);
const T = (ax, head) => {
  EL.clear(); CELLS.clear();
  const dx = ax ? 0 : 1, dz = ax ? 1 : 0, x = 5, z = 5, y = 66;
  for (let k = -1; k <= 1; k++) CELLS.set(key(x + k * dx, y - 1, z + k * dz), st('iron_block'));
  CELLS.set(key(x, y - 2, z), st('iron_block'));
  CELLS.set(key(x, y, z), st(head));
  return [x, y, z];
};

for (const ax of [0, 1]) for (const head of ['carved_pumpkin', 'jack_o_lantern']) {
  const [x, y, z] = T(ax, head);
  const g = SG.onBlockAdded(x, y, z);
  ok(g && g.type === 'iron_golem' && g.playerCreated === true, `T ax${ax} ${head}: player-created iron golem spawned`);
  let left = 0; CELLS.forEach((v) => { if (v) left++; });
  ok(left === 0, `T ax${ax} ${head}: all 5 blocks cleared (left ${left})`);
}
{ // break: missing arm, blocked corner, plain pumpkin
  let [x, y, z] = T(0, 'carved_pumpkin'); CELLS.delete(key(x + 1, y - 1, z));
  brk(SG.onBlockAdded(x, y, z) === null, 'T missing an arm must build nothing');
  [x, y, z] = T(0, 'carved_pumpkin'); CELLS.set(key(x + 1, y, z), st('stone'));
  brk(SG.onBlockAdded(x, y, z) === null, 'T with a block beside the head must build nothing');
  [x, y, z] = T(0, 'pumpkin');
  brk(SG.onBlockAdded(x, y, z) === null, 'uncarved pumpkin must build nothing');
}
// stepHeight (#2617): IronGolemEntity ctor sets 1.0F
{
  const g = EL.spawn('iron_golem', 1, 64, 1, {});
  ok(g.stepHeight === 1 && g.maxUpStep === 1, 'iron golem stepHeight is 1.0');
  brk(EL.spawn('zombie', 1, 64, 1, {}).stepHeight !== 1, 'zombie keeps default step height');
}
// canTarget
const player = M.Player || {}; M.Player = player; player.type = 'player';
const golem = (pc) => ({ type: 'iron_golem', playerCreated: pc });
ok(Ai.canTargetLiving(player, golem(false)) === true, 'village golem can target a player');
brk(Ai.canTargetLiving(player, golem(true)) === false, 'player-created golem must not target a player');
brk(Ai.canTargetLiving({ type: 'creeper' }, golem(false)) === false, 'iron golem never targets a creeper');
ok(Ai.canTargetLiving({ type: 'zombie' }, golem(true)) === true, 'player-created golem still targets a zombie');
// NBT
{
  const g = EL.spawn('iron_golem', 1, 64, 1, {}); g.playerCreated = true;
  const nb = M.MobNbt || M.Mobnbt;
  ok(!!nb, 'nbt module lookup');
  const src = readFileSync(join(MCLITE_ROOT, 'src', '07zw_mobnbt.js'), 'utf8');
  ok(/iron_golem: \['playerCreated'/.test(src), 'mobnbt persists playerCreated');
  brk(!/iron_golem: \['playerCreatedX'/.test(src), 'mangled NBT row is not present');
}
// IronGolemEntity.pushAway: 1-in-20 retarget of a colliding non-creeper monster
{
  const old = EL.random; const spawn = (t) => { EL.clear(); const g = EL.spawn('iron_golem', 1, 64, 1, {}); const m = EL.spawn(t, 1, 64, 1, {}); g.target = null; return [g, m]; };
  EL.random = () => 0;
  let [g, m] = spawn('zombie'); EL.pushAround(g);
  ok(g.target === m, 'golem targets a colliding zombie when nextInt(20)==0');
  [g, m] = spawn('creeper'); EL.pushAround(g);
  brk(g.target !== m, 'golem never targets a colliding creeper');
  EL.random = () => 0.5;
  [g, m] = spawn('zombie'); EL.pushAround(g);
  brk(g.target !== m, 'no target when the 1-in-20 roll misses');
  EL.random = old;
}
// #3676: ActiveTargetGoal(Mob,5,false,false,filter): 1/3 roll, line of sight, +-4 vertical box
{
  EL.clear(); const g = EL.spawn('iron_golem', 1, 64, 1, {});
  const good = (x) => x.reciprocalChance === 5 && x.sight === true;
  const tg = g.ai.entries.filter((en) => en.priority === 3 && en.goal.getCandidates).map((en) => en.goal)[0];
  ok(!!tg, 'golem has a NearestAttackableTargetGoal');
  if (tg) {
    ok(good(tg), 'golem mob-target goal: reciprocalChance 5, sight');
    brk(!good(new Ai.NearestAttackableTargetGoal(g, () => [])), 'a bare goal (the old registration) is noticed');
  }
}
console.log(`\n${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
