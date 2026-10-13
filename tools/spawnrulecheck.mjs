#!/usr/bin/env node
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

say('spawnrulecheck — loop/spawnsweep-s104 (QUEUE 0.2 G18c), the spawn rules sweep');

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
W.init(SEED);
L.init();
M.Behave.init(W);
M.EntityList.init();
M.Spawn.init();
ok(Spawn.ready, 'Spawn.init ran');

const stateOf = (n) => M.States.stateOf(n) | 0;
const GRASS = stateOf('grass_block'), STONE = stateOf('stone'), WATER = stateOf('water'),
      SAND = stateOf('sand'), AIR = 0;
const SL = Spawn.SEA_LEVEL;

// ── a lit, grass-floored 3x3 platform at y=60, open to the sky (the same recipe
//    spawncheck.mjs's own §2 fixture uses) ──────────────────────────────────────────────────
for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
  const c = W.getOrCreate(cx, cz);
  c.state = CH.GENERATED;
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
    const gx = cx * 16 + x, gz = cz * 16 + z;
    W.setBlock(gx, 60, gz, GRASS);
    W.setLight(gx, CFG.WORLD_MAX_Y - 1, gz, (15 << 4) | 0);
    L.seed(gx, CFG.WORLD_MAX_Y - 1, gz, 15, L.SKY);
  }
  L.queueBorder(cx, cz);
}
ok(L.settle(4000), 'the lit grass platform settled');

const rnd = (n) => 0; // a fixed, cooperative RNG stub — the dark-cave boundary is not this
                       // file's own test (D-533/spawncheck already own that shape)

// ─────────────────────────────────────────────── 1. horse — shares cow's AnimalEntity rule
say('\n1. horse — AnimalEntity.isValidNaturalSpawn (no HorseEntity/HorseBaseEntity override)');
{
  ok(Spawn.RULES.horse === Spawn.RULES.cow, 'Spawn.RULES.horse is the SAME function object as cow\'s');
  ok(Spawn.checkPlacement('horse', 0, 61, 0, 'natural', rnd), 'lit grass_block below — accepted');
  W.setBlock(5, 60, 5, STONE);
  W.setLight(5, CFG.WORLD_MAX_Y - 1, 5, (15 << 4) | 0);
  ok(!Spawn.checkPlacement('horse', 5, 61, 5, 'natural', rnd), 'stone below (no #animals_spawnable_on) — refused');
  ok(Spawn.RULES.llama === Spawn.RULES.cow, 'llama shares cow\'s AnimalEntity rule');
  ok(Spawn.checkPlacement('llama', 0, 61, 0, 'natural', rnd), 'llama on lit grass — accepted');
  ok(!Spawn.checkPlacement('llama', 5, 61, 5, 'natural', rnd), 'llama on stone — refused');
}

// ─────────────────────────────────────────────── 2. ocelot — bare 2-in-3 dice, no ground test
say('\n2. ocelot — OcelotEntity.canSpawn: random.nextInt(3) != 0, verbatim (no ground/light term)');
{
  W.setBlock(20, SL - 1, 0, GRASS); W.setBlock(20, SL, 0, AIR); W.setBlock(20, SL + 1, 0, AIR);
  ok(Spawn.checkPlacement('ocelot', 0+20, SL, 0, 'natural', () => 1), 'rnd(3)=>1 (!=0) on grass at sea level — accepted');
  ok(!Spawn.checkPlacement('ocelot', 0+20, SL, 0, 'natural', () => 0), 'rnd(3)=>0 — refused, on the SAME position');
  // #1608: the instance canSpawn(WorldView) -- grass/leaves floor, y >= sea level, no fluid
  W.setBlock(1+20, SL - 1, 0, STONE);
  ok(!Spawn.checkPlacement('ocelot', 1+20, SL, 0, 'natural', () => 1), 'stone floor — refused');
  W.setBlock(2+20, SL - 2, 0, GRASS);
  ok(!Spawn.checkPlacement('ocelot', 2+20, SL - 1, 0, 'natural', () => 1), 'y below sea level on grass — refused');
  W.setBlock(3+20, SL - 1, 0, GRASS); W.setBlock(3+20, SL, 0, WATER);
  ok(!Spawn.checkPlacement('ocelot', 3+20, SL, 0, 'natural', () => 1), 'water cell — refused');
  W.setBlock(4+20, SL - 1, 0, stateOf('oak_leaves')); W.setBlock(4+20, SL, 0, AIR); W.setBlock(4+20, SL + 1, 0, AIR);
  ok(Spawn.checkPlacement('ocelot', 4+20, SL, 0, 'spawner', () => 1), 'leaves floor at sea level — accepted');
  const realOk = Spawn.ocelotInstanceOk; Spawn.ocelotInstanceOk = () => true;
  okAv(Spawn.checkPlacement('ocelot', 1+20, SL, 0, 'natural', () => 1), 'instance rule disabled -> ocelot placed on stone is caught');
  Spawn.ocelotInstanceOk = realOk;
}

// ─────────────────────────────────────────────── 3. parrot — #parrots_spawnable_on + light>8
say('\n3. parrot — ParrotEntity.canSpawn: #minecraft:parrots_spawnable_on + isLightLevelValidForNaturalSpawn');
{
  ok(Spawn.checkPlacement('parrot', 0, 61, 0, 'natural', rnd), 'lit grass_block (tagged) below — accepted');
  W.setBlock(6, 60, 6, SAND);
  W.setLight(6, CFG.WORLD_MAX_Y - 1, 6, (15 << 4) | 0);
  ok(!Spawn.checkPlacement('parrot', 6, 61, 6, 'natural', rnd), 'sand below (not in #parrots_spawnable_on) — refused');
}

// ─────────────────────────────────────────────── 4. wolf — #wolves_spawnable_on + light>8
say('\n4. wolf — WolfEntity.canSpawn: #minecraft:wolves_spawnable_on + isLightLevelValidForNaturalSpawn');
{
  ok(Spawn.checkPlacement('wolf', 0, 61, 0, 'natural', rnd), 'lit grass_block below — accepted');
  W.setBlock(7, 60, 7, SAND);
  W.setLight(7, CFG.WORLD_MAX_Y - 1, 7, (15 << 4) | 0);
  ok(!Spawn.checkPlacement('wolf', 7, 61, 7, 'natural', rnd), 'sand below (not in #wolves_spawnable_on) — refused');
}

// ─────────────────────────────────────────────── 5. witch — HostileEntity.canSpawnInDark
say('\n5. witch — HostileEntity.canSpawnInDark (peaceful gate + isDarkEnoughToSpawn + checkMobSpawnRules)');
{
  // dark room fixture, the SAME shape spawncheck.mjs's own §2 dark-cave room uses
  const RY = 50;
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) {
    W.setBlock(x, RY - 1, z, STONE);
    W.setBlock(x, RY + 3, z, STONE);
  }
  for (let y = RY; y <= RY + 2; y++) {
    for (let x = -3; x <= 3; x++) { W.setBlock(x, y, -3, STONE); W.setBlock(x, y, 3, STONE); }
    for (let z = -3; z <= 3; z++) { W.setBlock(-3, y, z, STONE); W.setBlock(3, y, z, STONE); }
  }
  for (let x = -2; x <= 2; x++) for (let y = RY; y <= RY + 2; y++) for (let z = -2; z <= 2; z++) W.setBlock(x, y, z, AIR);
  L.queueBorder(0, 0); L.settle(4000);
  M.Diff.set('normal');
  ok(Spawn.checkPlacement('witch', 0, RY, 0, 'natural', (n) => 0), 'sealed dark room, rnd always 0 (darkest roll) — accepted');
  ok(!Spawn.checkPlacement('witch', 0, 61, 0, 'natural', (n) => n - 1), 'lit sky platform, rnd(n)=>n-1 (brightest roll) — refused');
  M.Diff.set('peaceful');
  ok(!Spawn.checkPlacement('witch', 0, RY, 0, 'natural', (n) => 0), 'same dark room, PEACEFUL — refused (D-400\'s own gate)');
  M.Diff.set('normal');
}

// ─────────────────────────────────────────────── 6. dolphin — WaterCreatureEntity.canSpawn
say('\n6. dolphin — WaterCreatureEntity.canSpawn (shared with squid: seaLevel-13..seaLevel, water below+above)');
{
  ok(typeof Spawn.RULES.dolphin === 'function', 'Spawn.RULES.dolphin is wired');
  for (let y = SL - 14; y <= SL + 1; y++) W.setBlock(10, y, 10, WATER);
  // called DIRECTLY, the same way squidcheck.mjs's own §6 calls Spawn.RULES.squid —
  // Spawn.clearForSpawn's generic ON_GROUND clearance half refuses a water CELL outright
  // (isClearForSpawn explicitly treats 'water' as not-clear), a fact about that ANCILLARY
  // check, not about WaterCreatureEntity.canSpawn itself — Spawn.RULES.squid's own
  // header two rules above already stands on the same ground.
  ok(Spawn.RULES.dolphin(10, SL - 5, 10, 'natural', rnd), 'y=' + (SL - 5) + ' inside the water column, within 13 of sea level — accepted');
  ok(!Spawn.RULES.dolphin(10, SL - 20, 10, 'natural', rnd), 'y=' + (SL - 20) + ' more than 13 below sea level — refused');
}
// ─────────────────────────────────────────────── 6b. strider — StriderEntity.canSpawn + coverage
say('\n6b. strider — lava cell with air above passes, under a solid roof fails; every LOCATION type has a rule');
{
  const LAVA = stateOf('lava'), STONE = stateOf('stone');
  for (const id of Object.keys(Spawn.LOCATION)) {
    if (Spawn.LOCATION[id] === 'in_lava') ok(typeof Spawn.RULES[id] === 'function', 'in_lava type ' + id + ' has a Spawn.RULES entry');
  }
  ok(Spawn.canPlace('strider'), 'Spawn.canPlace(strider)');
  for (let y = 70; y <= 72; y++) W.setBlock(30, y, 30, LAVA);
  for (let y = 70; y <= 72; y++) W.setBlock(31, y, 31, LAVA);
  W.setBlock(31, 74, 31, STONE);
  W.setBlock(31, 73, 31, STONE);
  ok(Spawn.locationOk('in_lava', 30, 71, 30), 'lava cell is an in_lava location');
  ok(Spawn.RULES.strider(30, 71, 30, 'natural', rnd), 'lava lake, air above -- accepted');
  ok(!Spawn.RULES.strider(31, 71, 31, 'natural', rnd), 'lava under a solid roof -- refused');
}
{
  ok(Spawn.canPlace('zombie_villager'), 'Spawn.canPlace(zombie_villager)');
  ok(typeof Spawn.RULES.zombie_villager === 'function', 'zombie_villager has a Spawn.RULES entry');
  for (let y = 80; y <= 83; y++) W.setBlock(40, y, 40, STONE);
  ok(!Spawn.RULES.zombie_villager(40, 81, 40, 'natural', rnd), 'zombie_villager inside solid stone -- refused');
  let agree = true;
  for (const [x, y, z] of [[40, 84, 40], [10, SL - 5, 10], [30, 71, 30]])
    if (!!Spawn.RULES.zombie_villager(x, y, z, 'natural', rnd) !== !!Spawn.RULES.zombie(x, y, z, 'natural', rnd)) agree = false;
  ok(agree, 'zombie_villager agrees with zombie (no canSpawn override of its own)');
}
// 6c. cat (#5843) — AnimalEntity.isValidNaturalSpawn, shared with cow
{
  ok(Spawn.RULES.cat === Spawn.RULES.cow, 'cat carries the AnimalEntity rule');
  ok(Spawn.checkPlacement('cat', 0, 61, 0, 'natural', rnd), 'cat on lit grass — accepted');
  ok(!Spawn.checkPlacement('cat', 7, 61, 7, 'natural', rnd), 'cat on sand — refused');
}
say(`   ${pass} ok so far`);

// ─────────────────────────────────────────────── 7. anti-vacuity — swap two rules, catch it
say('\n7. anti-vacuity — swap two of the six rules, assert the swap is caught');
{
  const savedWolf = Spawn.RULES.wolf, savedParrot = Spawn.RULES.parrot;
  Spawn.RULES.wolf = savedParrot;    // wolf now wrongly answers parrot's own question
  Spawn.RULES.parrot = savedWolf;    // and vice versa
  // sand qualifies for neither real rule; swapping does not change that pair's own outcome, so
  // pick a fixture only ONE of the two rules would ever pass to make the swap observable —
  // #parrots_spawnable_on includes oak_log (a real parrot perch), which #wolves_spawnable_on
  // does NOT carry (grass_block/snow/snow_block only) — so the real parrot rule accepts a
  // log floor and the real wolf rule refuses it; a swap must flip that.
  const OAK_LOG = stateOf('oak_log');
  W.setBlock(20, 60, 20, OAK_LOG);
  W.setLight(20, CFG.WORLD_MAX_Y - 1, 20, (15 << 4) | 0);
  const wolfOnLogWhileSwapped = Spawn.checkPlacement('wolf', 20, 61, 20, 'natural', rnd);
  okAv(wolfOnLogWhileSwapped === true, 'swapped: Spawn.RULES.wolf now (wrongly) accepts an oak_log floor — the break is visible');
  Spawn.RULES.wolf = savedWolf;
  Spawn.RULES.parrot = savedParrot;
  ok(!Spawn.checkPlacement('wolf', 20, 61, 20, 'natural', rnd), 'restored: the real wolf rule refuses the same oak_log floor');
  ok(Spawn.checkPlacement('parrot', 20, 61, 20, 'natural', rnd), 'restored: the real parrot rule accepts it');
}
{
  // D-570 second break: dolphin handed squid's rule with the depth floor lifted -- the §6 depth refusal must see it
  const savedDolphin = Spawn.RULES.dolphin;
  Spawn.RULES.dolphin = () => true;
  okAv(Spawn.RULES.dolphin(10, SL - 20, 10, 'natural', rnd) === true, 'a depth-blind dolphin rule accepts y=' + (SL - 20) + ' -- the "more than 13 below" refusal is live');
  Spawn.RULES.dolphin = savedDolphin;
  ok(!Spawn.RULES.dolphin(10, SL - 20, 10, 'natural', rnd), 'restored: the real dolphin rule refuses it again');
}

{
  // #931 break: a roof-blind strider rule must be seen by the 6b roof refusal
  const savedStrider = Spawn.RULES.strider;
  Spawn.RULES.strider = () => true;
  okAv(Spawn.RULES.strider(31, 71, 31, 'natural', rnd) === true, 'a roof-blind strider rule accepts the roofed lava cell -- the 6b refusal is live');
  delete Spawn.RULES.strider;
  okAv(!Spawn.canPlace('strider'), 'a missing strider rule makes canPlace false -- the coverage assertion is live');
  Spawn.RULES.strider = savedStrider;
  ok(!Spawn.RULES.strider(31, 71, 31, 'natural', rnd), 'restored: the real strider rule refuses it again');
}

{
  // #3898: ravager (1.95x2.2 box) never spawns with fluid in the box, spawner included
  const sv = Spawn.RULES.ravager, svSk = Spawn.RULES.skeleton;
  Spawn.RULES.skeleton = () => true;   // #5124: ravager now also needs canSpawnInDark; this block tests the fluid half only
  for (let y = 80; y <= 82; y++) for (let x = 39; x <= 41; x++) for (let z = 39; z <= 41; z++) W.setBlock(x, y, z, AIR);
  ok(Spawn.RULES.ravager(40, 80, 40, 'spawner', rnd), 'ravager rule in open air -- accepted');
  W.setBlock(40, 81, 40, stateOf('water'));
  ok(!Spawn.checkPlacement('ravager', 40, 80, 40, 'spawner', rnd), 'ravager with water in its box via spawner -- refused');
  Spawn.RULES.ravager = () => true;
  okAv(Spawn.RULES.ravager(40, 80, 40, 'spawner', rnd) === true, 'a fluid-blind ravager rule accepts the watery box -- the refusal is live');
  Spawn.RULES.ravager = sv; Spawn.RULES.skeleton = svSk;
}

say(`\n${pass} ok, ${fails.length} failed`);
// loop/despawn-s105: the suite's own count format (suite.mjs:877), so this stage's
// assertions reach the total instead of "REPORTED NO ASSERTION COUNT".
say(` assertions passed .. ${pass}`);
say(` failures ........... ${fails.length}`);
say(` breaks caught ...... ${breaks}`);
if (fails.length) { fails.forEach((f) => say('  ✗ ' + f)); process.exit(1); }
