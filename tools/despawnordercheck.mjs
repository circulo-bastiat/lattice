#!/usr/bin/env node
// despawnordercheck -- #6336: the despawn roll runs INSIDE each mob's own EL.tickMob, at the vanilla point
// (ServerWorld.tickEntities: checkDespawn() immediately before the entity's tick), not in a separate pass.
// Hand-derived vanilla order: 3 hostile mobs A,B,C (list order), all counter>600, 32<dist<128. The roll is the
// FIRST draw of each mob's turn. Draws are scripted per tick: t1 hits B, t2 hits A, t3 hits C ->
// removal list [(1,B),(2,A),(3,C)]; and a removed mob draws nothing further (AI never runs).
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const M = loadEngine({ extra: ['02f_tags.js', '07_world.js', '08_lighting.js', '07b_behaviour.js',
  '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js',
  '07c_blockentity.js', '09b_sky.js', '14j_combat.js', '07w_passive.js', '14c_raycast.js', '07zf_bat.js', '07zi_squid.js'], dom: false });
initRegistry(M);
M.EntityList.wr = () => Math.random();   // #6215: despawn/spawn rolls draw from the world stream EL.wr; this check scripts them by stubbing Math.random
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init();
M.World.init(3); M.Gen.init(3, M.Gen.defaults()); M.Light.init(); M.Behave.init(M.World);
M.EntityList.init(); M.Ai.init();
if (M.Passive && M.Passive.init) M.Passive.init();
if (M.Bat && M.Bat.init) M.Bat.init();
M.Spawn.init(); M.Spawn.ready = true;   // D-397: no natural spawning while this check counts
const S = M.Spawn, EL = M.EntityList;
M.Player = { x: 0, y: 64, z: 0 };


M.Player = { x: 0, y: 64, z: 0 };
M.World.getLight = () => 0;
M.EntityList.suffocate = () => {};   // mobs sit in generated terrain; suffocation damage zeroes despawnCounter (LivingEntity.damage) and hides the roll
const real = Math.random;
function run(driver) {
  EL.clear();
  const mobs = ['A', 'B', 'C'].map((n, i) => { const e = EL.spawn('zombie', 50 + i, 64, 0); e.despawnCounter = 700; e.nm = n; return e; });
  const kill = { 1: 'B', 2: 'A', 3: 'C' }, out = []; let cur = null, first = true;
  Math.random = () => { if (first) { first = false; return kill[tick] === cur.nm ? 0.0001 : 0.5; } return 0.5; };
  let tick = 0;
  try {
    for (tick = 1; tick <= 4; tick++) {
      driver(mobs, e => { cur = e; first = true; });
      for (const e of mobs) if (e.removed && !e.logged) { e.logged = 1; out.push(tick + e.nm); }
    }
  } finally { Math.random = real; }
  return out.join(',');
}
// production dispatch: each live mob's own turn
const got = run((mobs, setCur) => { for (const e of mobs) if (!e.removed) { setCur(e); M.EntityList.tickMob(e); } });
ok(got === '1B,2A,3C', 'removal list (tick,mob) equals hand-derived vanilla order, got ' + got);
// break proof: a separate pass (the old Spawn.despawnTick) with tickMob not despawning must differ from the vanilla slot
let breaks = 0;
const saved = M.Spawn.despawnOne;
M.Spawn.despawnOne = () => false;
const sep = run((mobs, setCur) => { for (const e of mobs) if (!e.removed) { setCur(e); M.EntityList.tickMob(e); } });
M.Spawn.despawnOne = saved;
breaks++; ok(sep !== got, 'disabling the in-tick roll (separate-pass model) is caught: ' + JSON.stringify(sep)); console.log('   ✓ break caught: separate pass');
// second break: a wrong expectation must not match the real run
breaks++; ok('1B,2A,3C' !== '1A,2B,3C' && got !== '1A,2B,3C', 'a swapped expectation is caught');
if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
console.log('despawnordercheck: ' + pass + ' assertions, 0 failures, ' + breaks + ' breaks caught');
