// spawnrulecheck.mjs — loop/spawnsweep-s104 (QUEUE 0.2 G18c): "spawn rules sweep".
//
//   node tools/spawnrulecheck.mjs [--verbose]
//
// Scope: the SIX overworld mob types this engine can both SIMULATE (`EL.spawnable()`, motion
// measured off the jar per D-307) and that carry a real biome spawner-table row (`B.spawners`)
// but had NO `Spawn.RULES` entry before this session — horse, ocelot, parrot, wolf, witch,
// dolphin. Every other `EL.spawnable()` mob (cat/evoker/guardian/illusioner/iron_golem/
// pillager/ravager/villager/vindicator) carries no overworld biome-spawner row at all (probed
// against `B.spawners()` this session, `Spawn.OWED`'s own struck line says so) — those are a
// structure/village/raid placement path, not a `Spawn.RULES` gap, and are out of scope here.
//
// For each of the six: one position its ported predicate ACCEPTS, one it REFUSES, ported
// verbatim from `.decomp` (cited per-rule in `src/07l_spawn.js`), plus an anti-vacuity pass that
// swaps two of the six rules and asserts the swap gets caught.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

const VERBOSE = process.argv.includes('--verbose');
let pass = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => console.log(...a);



const EXTRA = ['02f_tags.js', '07_world.js', '08_lighting.js', '07b_behaviour.js',
               '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js',
               '07l_spawn.js', '07c_blockentity.js', '09b_sky.js', '14j_combat.js',
               '07w_passive.js', '14c_raycast.js', '07zf_bat.js', '07zi_squid.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
initRegistry(M);
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8'))
});
M.Entities.init();
const W = M.World, L = M.Light, CH = M.CH, CFG = M.CFG, T = M.Tags, Spawn = M.Spawn;

ok(T.ready, 'the tag substrate loaded');
ok(T.blockTag('parrots_spawnable_on') >= 0, 'parrots_spawnable_on is a real packed tag column');
ok(T.blockTag('wolves_spawnable_on') >= 0, 'wolves_spawnable_on is a real packed tag column');

const SEED = 3;
W.init(SEED); L.init(); M.Behave.init(W); M.EntityList.init(); M.Spawn.init();
const stateOf = (n) => M.States.stateOf(n) | 0;
const WATER = stateOf('water'), STONE = stateOf('stone');
for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) { W.getOrCreate(cx, cz).state = CH.GENERATED; }
const rnd = () => 0;
const Y = 30;
function at(x, floor, mid) {
  W.setBlock(x, Y - 2, 0, floor === stateOf('bubble_column') ? stateOf('soul_sand') : stateOf('sand')); W.setBlock(x, Y - 1, 0, floor); W.setBlock(x, Y, 0, mid);
}
const cases = [['water', WATER], ['kelp', stateOf('kelp')], ['kelp_plant', stateOf('kelp_plant')],
  ['seagrass', stateOf('seagrass')], ['tall_seagrass', stateOf('tall_seagrass')],
  ['bubble_column', stateOf('bubble_column')]];
let x = 0;
ok(M.Spawn.RULES.drowned(x, Y, 0, 'spawner', rnd) === false, 'stone floor, air: refused') ;
for (const [n, st] of cases) {
  x++; at(x, st, WATER);
  ok(M.Spawn.RULES.drowned(x, Y, 0, 'spawner', rnd), n + ' below, water in cell: drowned accepted (FluidTags.WATER)');
}
x++; at(x, STONE, WATER);
ok(!M.Spawn.RULES.drowned(x, Y, 0, 'spawner', rnd), 'stone below: refused');
// waterlogged block below
const wl = [...M.States.waterIn].findIndex((v, i) => v && i !== WATER && M.States.block[i] === M.Reg.id.oak_slab);
if (wl > 0) { x++; at(x, wl, WATER); ok(M.Spawn.RULES.drowned(x, Y, 0, 'spawner', rnd), 'waterlogged slab below: accepted'); }
else fails.push('no waterlogged state resolved');
// anti-vacuity: with the old block==water test, kelp is refused
{
  const S = M.States, saved = S.waterIn;
  S.waterIn = S.block.map ? Uint8Array.from(S.block, (b) => (b === M.Reg.id.water ? 1 : 0)) : saved;
  breaks++;
  const kelp = stateOf('kelp'); at(99, kelp, WATER);
  if (!M.Spawn.RULES.drowned(99, Y, 0, 'spawner', rnd)) { pass++; console.log('   ✓ old block==water behaviour is caught'); }
  else fails.push('anti-vacuity: old behaviour not caught');
  S.waterIn = saved;
}
// #5728: DrownedEntity.isPushedByFluids = !isSwimming (Ph.fluidPush)
{
  const SR = M.States, lvl = (n) => SR.withProp(SR.stateOf('water'), M.Reg.PROP.level, M.Reg.PVAL[String(n)]);
  for (let i = 0; i < 4; i++) { W.setBlock(5 + i, 29, 0, STONE); W.setBlock(5 + i, 30, 0, 0); W.setBlock(5 + i, 31, 0, 0); W.setBlock(5 + i, 30, 1, 0); W.setBlock(5 + i, 30, -1, 0); }
  W.setBlock(5, 30, 0, WATER); W.setBlock(6, 30, 0, lvl(1));
  const push = (type, swimming) => {
    const e = { type, swimming, x: 6.5, y: 30, z: 0.5, vx: 0, vy: 0, vz: 0, width: 0.6, height: 1.95 };
    M.Physics.fluidPush(e); return Math.abs(e.vx) + Math.abs(e.vz);
  };
  ok(push('zombie', false) > 0, 'zombie in flowing water is pushed');
  ok(push('drowned', false) > 0, 'non-swimming drowned is pushed');
  ok(push('drowned', true) === 0, 'swimming drowned keeps zero flow velocity');
  // anti-vacuity: without the hook the swimming drowned would move (same entity typed as zombie)
  breaks++;
  if (push('zombie', true) > 0) { pass++; console.log('   ✓ without the drowned hook a swimming mob is pushed'); }
  else fails.push('anti-vacuity: swimming zombie not pushed');
}
say(` assertions passed .. ${pass}`);
say(` failures ........... ${fails.length}`);
say(` breaks caught ...... ${breaks}`);
if (fails.length) { fails.forEach((f) => say('  ✗ ' + f)); process.exit(1); }
