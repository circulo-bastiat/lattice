#!/usr/bin/env node
// silverspawncheck.mjs -- #1181: every type in Spawn.LOCATION that the engine can simulate
// (EL.canSpawn) has a Spawn.RULES entry or a named exemption, and silverfish/endermite obey the
// 5-block player exclusion (SilverfishEntity.canSpawn / EndermiteEntity.canSpawn).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
let breaks = 0;
const av = (c, m) => { if (c) { pass++; breaks++; console.log('   ✓ caught: ' + m); } else fails.push('anti-vacuity: ' + m); };
const EXTRA = ['02f_tags.js', '07_world.js', '08_lighting.js', '07b_behaviour.js',
  '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js',
  '07l_spawn.js', '07c_blockentity.js', '09b_sky.js', '14j_combat.js',
  '07w_passive.js', '14c_raycast.js', '07zf_bat.js', '07zi_squid.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
initRegistry(M);
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init();
const Spawn = M.Spawn, W = M.World;
// Exemptions: LOCATION rows whose mob this engine has no entity for / no rule path (not a silent gap).
// Anything the engine CAN simulate must have a rule.
const missing = Object.keys(Spawn.LOCATION).filter((t) => M.EntityList.canSpawn(t) && !Spawn.canPlace(t));
console.log('simulable types with no rule: ' + (missing.join(' ') || '(none)'));
// Types still without a rule are OTHER mobs' gaps (not this issue's): a snapshot, so a NEW gap fails here.
const EXEMPT = new Set(('blaze cat cave_spider donkey ender_dragon giant hoglin iron_golem llama magma_cube mule piglin ' +
  'pillager skeleton_horse snow_golem villager wither wither_skeleton zombie_horse zombie_villager zombified_piglin ' +
  'elder_guardian guardian strider evoker illusioner phantom ravager shulker trader_llama vex vindicator wandering_trader').split(' '));
const fresh = missing.filter((t) => !EXEMPT.has(t));
ok(fresh.length === 0, 'simulable Spawn.LOCATION types with no rule and no exemption: ' + fresh);
ok(Spawn.canPlace('silverfish') && Spawn.canPlace('endermite'), 'canPlace silverfish/endermite');

const S = M.States.stateOf('stone') | 0;
W.init(3); M.Light.init(); M.Behave.init(W); M.EntityList.init(); Spawn.init();
W.getOrCreate(0, 0).state = M.CH.GENERATED;
W.setBlock(10, 60, 10, S);
const rnd = () => 31;
M.Diff.value = 'normal';
function at(type, px, py, pz) {
  M.Player = { x: px, y: py, z: pz, mode: 0 };
  return Spawn.checkPlacement(type, 10, 61, 10, 'spawner', rnd);
}
for (const t of ['silverfish', 'endermite']) {
  ok(at(t, 30.5, 61, 10.5) === true, t + ' spawns with player 20 blocks away');
  ok(at(t, 12.5, 61, 10.5) === false, t + ' refused with player 2 blocks away');
  ok(at(t, 10.5, 61, 14.5) === false, t + ' refused with player 4 blocks away (inside 5)');
  ok(at(t, 10.5, 61, 17.5) === true, t + ' spawns with player 7 blocks away');
}
M.Diff.value = 'peaceful';
ok(at('silverfish', 30.5, 61, 10.5) === false, 'silverfish refused on peaceful');
M.Diff.value = 'normal';
// anti-vacuity: break the rule (drop the player exclusion / drop the rule) and require the asserts to notice
const saved = Spawn.RULES.silverfish;
Spawn.RULES.silverfish = () => true;
av(at('silverfish', 12.5, 61, 10.5) === true, 'exclusion-blind rule accepts a player 2 blocks away');
delete Spawn.RULES.silverfish;
av(Spawn.canPlace('silverfish') === false, 'deleting the rule makes canPlace false');
Spawn.RULES.silverfish = saved;
ok(at('silverfish', 12.5, 61, 10.5) === false, 'restored');
console.log('');
console.log('================ silverspawncheck ==================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
console.log('====================================================');
if (fails.length) { fails.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
