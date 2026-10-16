#!/usr/bin/env node
// spawnercheck.mjs — loop/spawner-s114 (PLAN G18c, D-395's own remainder): the MONSTER SPAWNER
// block's ENTITY ASSIGNMENT (`07zs_spawner.js`'s own `Spawner.assign`/`pickDungeonEntity`) and
// CAVE SPIDER (roster/motion/poison wiring). `spawncheck.mjs` §5 already proves
// `Spawn.tickSpawner`'s own tick/delay/range/cap mechanics against a synthetic block entity —
// this file does NOT re-prove those. What it proves is the OTHER half: that a spawner a real
// worldgen feature places actually GETS an entity id, not the empty cage D-141 shipped, and
// that cave_spider exists end to end the way spider does (D-390's motion set, Ai.ROSTER,
// dims/attrs already jar-extracted, and its own poison-on-hit — .decomp/net/minecraft/entity/
// mob/CaveSpiderEntity.java, read whole).
//
//   node tools/spawnercheck.mjs [--verbose]

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };

console.log('spawnercheck -- loop/spawner-s114, the monster spawner block + cave spider');

const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js',
               '07_world.js', '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js',
               '07e_loot.js', '07f_redstone.js', '07h_entities.js', '14b_physics.js',
               '14c_raycast.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js',
               '07q_effects.js', '14e_gamemode.js', '14i_hand.js', '14j_combat.js',
               '14l_use.js', '07zs_spawner.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
const R = MCL.Reg, S = MCL.States, IT = MCL.Items;

MCL.Entities.init();
MCL.EntityList.init();
MCL.Ai.init();

// -- the world: usecheck.mjs's own flat-array adapter, so B.changed wires block entities
// through Behave exactly the way the real game does when a block is placed by hand. --------
const N = 32, MID = 16;
const cells = new Uint16Array(N * N * N);
const idx = (x, y, z) => (((y + MID) * N + (z + MID)) * N + (x + MID));
const inside = (x, y, z) => [x, y, z].every((v) => v + MID >= 0 && v + MID < N);
const W = {
  getBlock: (x, y, z) => (inside(x, y, z) ? cells[idx(x, y, z)] : 0),
  setBlock(x, y, z, id) {
    if (!inside(x, y, z)) return false;
    cells[idx(x, y, z)] = id;
    if (B.ready) B.changed(x, y, z);
    return true;
  },
  poke(x, y, z, id) { if (inside(x, y, z)) cells[idx(x, y, z)] = id; },
  blockLightAt: () => 15,
  light: 0,
  getLight() { return W.light; },
  clear() { cells.fill(0); },
};
MCL.World = W;
const B = MCL.Behave;
B.init(W);
MCL.BlockEntities.init();
B.clearSchedule();
MCL.Use.init(W);
const BE = MCL.BlockEntities, U = MCL.Use, EL = MCL.EntityList, Sp = MCL.Spawner;

ok(!!Sp, 'NS.Spawner exists (07zs_spawner.js loaded)');
ok(typeof Sp.assign === 'function', 'Spawner.assign exists');
ok(typeof Sp.pickDungeonEntity === 'function', 'Spawner.pickDungeonEntity exists');
ok(!!MCL.CaveSpider && typeof MCL.CaveSpider.onHit === 'function', 'NS.CaveSpider.onHit exists');

// ------------------------------------------------- 1. Spawner.assign
say('\n1. Spawner.assign -- creates/updates the mob_spawner block entity');
{
  BE.clear();
  ok(Sp.assign(10, 65, 10, 'skeleton') === true, 'assign reports success once BlockEntities is up');
  const e = BE.get(10, 65, 10);
  ok(!!e && e.type === 'mob_spawner', 'a real mob_spawner block entity now exists at that cell');
  ok(e.entity === 'skeleton', 'and it carries the entity id, not the "pig" default (07c own make())');
  ok(e.delay === 20 && e.minDelay === 200 && e.maxDelay === 800 && e.count === 4 &&
     e.spawnRange === 4 && e.maxNearbyEntities === 6 && e.requiredPlayerRange === 16,
     'every OTHER field stays BaseSpawner own default -- setEntityId is the only one D-395 own callers touch');

  e.delay = 555;
  ok(Sp.assign(10, 65, 10, 'zombie') === true, 'assign on an existing spawner still succeeds');
  const e2 = BE.get(10, 65, 10);
  ok(e2 === e, 'the SAME block entity object -- assign does not recreate a live spawner (BE.onChanged own "do not clobber" rule)');
  ok(e2.entity === 'zombie' && e2.delay === 555, 'the entity id changed and the non-default delay was left alone');

  const savedBE = MCL.BlockEntities;
  MCL.BlockEntities = undefined;
  okAv(Sp.assign(11, 65, 11, 'spider') === false, 'assign refuses (returns false) when NS.BlockEntities is not in this JS context');
  MCL.BlockEntities = savedBE;
  ok(!BE.get(11, 65, 11), 'and nothing was created behind that refusal');
}
say(`   ${pass} ok`);

// ------------------------------------------------- 2. Spawner.pickDungeonEntity -- the weights
say('\n2. Spawner.pickDungeonEntity -- DungeonFeature.MOB_SPAWNER_ENTITIES (.decomp:26-28,134-136)');
{
  ok(Sp.DUNGEON_ENTITIES.length === 4, '4-element table, same length as MOB_SPAWNER_ENTITIES');
  ok(Sp.DUNGEON_ENTITIES.join(',') === 'skeleton,zombie,zombie,spider',
     'skeleton, zombie, zombie, spider -- Util.getRandom own index order');

  let rng = 20260924 >>> 0;
  const nextInt = (bound) => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; return (rng >>> 8) % bound; };
  const counts = { skeleton: 0, zombie: 0, spider: 0 };
  const TRIALS = 40000;
  for (let i = 0; i < TRIALS; i++) counts[Sp.pickDungeonEntity(nextInt)]++;
  ok(Math.abs(counts.skeleton / TRIALS - 0.25) < 0.02, `skeleton ~1/4, got ${(counts.skeleton / TRIALS).toFixed(3)}`);
  ok(Math.abs(counts.zombie / TRIALS - 0.5) < 0.02, `zombie ~1/2, got ${(counts.zombie / TRIALS).toFixed(3)}`);
  ok(Math.abs(counts.spider / TRIALS - 0.25) < 0.02, `spider ~1/4, got ${(counts.spider / TRIALS).toFixed(3)}`);

  const alwaysZero = () => 0;
  const skewed = { skeleton: 0, zombie: 0, spider: 0 };
  for (let i = 0; i < 100; i++) skewed[Sp.pickDungeonEntity(alwaysZero)]++;
  okAv(skewed.skeleton === 100 && skewed.zombie === 0 && skewed.spider === 0,
       'a degenerate nextInt(always 0) lands skeleton every time -- the weight table is really read, not faked flat');
}
say(`   ${pass} ok`);

// ------------------------------------------------- 3. cave_spider -- end to end, mirroring spider
say('\n3. cave_spider exists end to end (motion/dims/attrs/roster), mirroring spider');
{
  ok(EL.canSpawn('cave_spider'), "EL.canSpawn('cave_spider') -- D.entities.motion now carries it (07i_entitylist.js)");
  const mot = EL.motionFor('cave_spider'), motSpider = EL.motionFor('spider');
  ok(!!mot && mot[0] === motSpider[0] && mot[1] === motSpider[1],
     'cave_spider motion equals spider own -- CaveSpiderEntity.java overrides no travel/gravity method (.decomp, read whole)');
  const dim = MCL.Entities.dimensions('cave_spider');
  ok(!!dim && dim.width === 0.7 && dim.height === 0.5, `cave_spider is 0.7x0.5 (jar-extracted types table), got ${JSON.stringify(dim)}`);
  const attrs = MCL.Entities.attrsOf('cave_spider');
  ok(!!attrs && attrs.hp === 12, `cave_spider max health is 12 (createCaveSpiderAttributes, .decomp:26-27), got ${attrs && attrs.hp}`);
  ok(MCL.Ai.ROSTER.cave_spider === MCL.Ai.ROSTER.spider,
     'Ai.ROSTER.cave_spider is spider own goal function -- CaveSpiderEntity declares no initGoals override (.decomp, read whole)');

  EL.clear();
  const mob = EL.spawn('cave_spider', 20.5, 65, 20.5);
  ok(!!mob && mob.type === 'cave_spider', 'EL.spawn actually produces a live, drawable cave_spider');

  okAv(!EL.canSpawn('cave_spider_typo_'), 'a nonsense type name is correctly refused -- canSpawn is not vacuously true');
}
say(`   ${pass} ok`);

// ------------------------------------------------- 4. CaveSpider.onHit -- poison, difficulty-gated
say('\n4. CaveSpider.onHit -- CaveSpiderEntity.tryAttack (.decomp:29-46): 7s NORMAL, 15s HARD, none EASY/PEACEFUL');
{
  const CS = MCL.CaveSpider, Diff = MCL.Diff, Eff = MCL.Effects;
  const attacker = { type: 'cave_spider' };
  const mkTarget = () => ({ type: 'pig', health: 10, x: 0, y: 64, z: 0 });   // D-647: a zombie is undead and refuses poison

  const savedDiff = Diff.value;
  Diff.value = 'normal';
  let target = mkTarget();
  CS.onHit(attacker, target);
  ok(Eff.hasStatusEffect(target, 'poison'), 'NORMAL: a landed hit applies poison');
  ok(target.effects.poison.duration === 140, `NORMAL duration is 7*20=140 ticks, got ${target.effects.poison.duration}`);

  Diff.value = 'hard';
  target = mkTarget();
  CS.onHit(attacker, target);
  ok(Eff.hasStatusEffect(target, 'poison') && target.effects.poison.duration === 300,
     `HARD duration is 15*20=300 ticks, got ${target.effects && target.effects.poison && target.effects.poison.duration}`);

  Diff.value = 'easy';
  target = mkTarget();
  CS.onHit(attacker, target);
  ok(!Eff.hasStatusEffect(target, 'poison'), 'EASY: no poison at all');

  Diff.value = 'peaceful';
  target = mkTarget();
  CS.onHit(attacker, target);
  ok(!Eff.hasStatusEffect(target, 'poison'), 'PEACEFUL: no poison at all');

  Diff.value = 'hard';
  target = mkTarget();
  CS.onHit({ type: 'spider' }, target);
  ok(!Eff.hasStatusEffect(target, 'poison'), 'a plain spider hit does not poison -- SpiderEntity.tryAttack has no such override');

  const savedTicks = CS.POISON_TICKS.normal;
  CS.POISON_TICKS.normal = 0;
  Diff.value = 'normal';
  target = mkTarget();
  CS.onHit(attacker, target);
  okAv(!Eff.hasStatusEffect(target, 'poison'), 'zeroing POISON_TICKS.normal really turns the NORMAL hit into a non-event -- the mechanism is under test');
  CS.POISON_TICKS.normal = savedTicks;

  Diff.value = savedDiff;
}
say(`   ${pass} ok`);

// ------------------------------------------------- 5. spawn egg ON a spawner (14l_use.js)
say('\n5. spawn egg right-clicked on a spawner sets its entity and spawns nothing');
{
  const def = (n) => S.stateOf(n);
  const stackOf = (name) => { const i = IT.of(name); return i < 0 ? null : { i: i, n: 1, d: 0 }; };
  function mkPlayer(o) {
    o = o || {};
    return { mode: 1, instabuild: o.instabuild !== false, mayBuild: true, crouching: false,
             slot: 0, yaw: 0, hasTarget: true, tx: 0, ty: 0, tz: 0, tface: 1,
             _stack: o.stack || null, heldItem() { return this._stack; }, syncHotbar() {},
             placeBlock() { return false; } };
  }

  W.clear(); BE.clear();
  W.poke(0, 0, 0, def('spawner'));
  B.changed(0, 0, 0);
  const be0 = BE.get(0, 0, 0);
  ok(!!be0 && be0.entity === 'pig', 'a spawner block entity exists with BlockEntities own "pig" default before any egg is used');

  const P = mkPlayer({ stack: stackOf('cave_spider_spawn_egg') });
  EL.clear();
  const res = U.itemUseOn(P, 0, 0, 0, 1, W.getBlock(0, 0, 0), P._stack);
  ok(res === true, 'the interaction is consumed (SUCCESS), matching SpawnEggItem.useOnBlock');
  ok(BE.get(0, 0, 0).entity === 'cave_spider', 'the spawner OWN entity is now set from the egg, cave_spider not the type it started with');
  ok(EL.list.length === 0, 'and no mob was spawned -- a spawn egg on a spawner configures it, it does not spawn');

  ok(P._stack.n === 1, 'creative (instabuild) -- the egg stack is not spent');
  const P2 = mkPlayer({ stack: stackOf('cave_spider_spawn_egg'), instabuild: false });
  U.itemUseOn(P2, 0, 0, 0, 1, W.getBlock(0, 0, 0), P2._stack);
  ok((MCL.Inventory && MCL.Inventory.isEmpty) ? MCL.Inventory.isEmpty(P2._stack) : (P2._stack.n <= 0),
     'survival -- the same interaction spends the egg (Use.damage own instabuild check, D-351)');

  W.clear(); EL.clear();
  W.poke(0, 0, 0, def('grass_block'));
  const P3 = mkPlayer({ stack: stackOf('cow_spawn_egg') });
  const res3 = U.itemUseOn(P3, 0, 0, 0, 1, W.getBlock(0, 0, 0), P3._stack);
  okAv(res3 === true && EL.list.length === 1 && EL.list[0].type === 'cow',
       'the SAME item on grass takes the ordinary spawn-egg path and spawns a live cow -- the spawner branch did not swallow every egg use');
}
say(`   ${pass} ok`);

// ------------------------------------------------- 6. worldgen wiring -- smoke test, not a vanilla fact
say('\n6. the two worldgen callers actually call Spawner.assign (wiring smoke test)');
{
  const dungeonSrc = readFileSync(join(MCLITE_ROOT, 'src', '04n_feat_terrain.js'), 'utf8');
  const mineshaftSrc = readFileSync(join(MCLITE_ROOT, 'src', '04s_struct_mineshaft.js'), 'utf8');
  ok(dungeonSrc.includes('NS.Spawner.assign') && dungeonSrc.includes('NS.Spawner.pickDungeonEntity'),
     'the dungeon monster_room feature calls Spawner.pickDungeonEntity + Spawner.assign at its own SPAWNER cell');
  ok(mineshaftSrc.includes("NS.Spawner.assign(hx, p.y0, hz, 'cave_spider')"),
     "the mineshaft spider-corridor feature calls Spawner.assign with 'cave_spider' at its own cage cell");
  const strongholdSrc = readFileSync(join(MCLITE_ROOT, 'src', '04x_struct_stronghold.js'), 'utf8');
  ok(strongholdSrc.includes("'silverfish'"), 'the stronghold portal room names its silverfish spawner (#855)');
}
say(`   ${pass} ok`);

// ------------------------------------------------- 7. Spawner.OWED held closed
say('\n7. Spawner.OWED is held closed, the same shape Spawn.OWED/EL.owed() already use');
{
  ok(Array.isArray(Sp.OWED), `${Sp.OWED && Sp.OWED.length} owed gaps named (all struck is allowed, #5186)`);
  const unnamed = Sp.OWED.filter((s) => typeof s !== 'string' || s.length < 10);
  ok(unnamed.length === 0, 'every owed entry is a real sentence, not a placeholder');
}
say(`   ${pass} ok`);

// ------------------------------------------------- 8. #3753 types with no/pillager SpawnRestriction place from a spawner
say('\n8. vindicator/evoker/ravager/... (canSpawnInDark / canMobSpawn) and pillager (PatrolEntity.canSpawn) spawn from a spawner');
{
  W.clear(); MCL.Spawn.CLEAR_CHECK = false;   // the box-clearance half needs real chunks; this proves the rule gate
  for (const t of ['vindicator', 'evoker', 'illusioner', 'ravager', 'vex', 'shulker', 'phantom', 'giant', 'wandering_trader', 'pillager']) {
    W.light = 0;
    okAv(MCL.Spawn.canPlace(t) && MCL.Spawn.checkPlacement(t, 0, 0, 0, 'spawner'), `${t} places from a spawner in an open dark cell`);
  }
  W.light = 15;
  okAv(!MCL.Spawn.checkPlacement('pillager', 0, 0, 0, 'spawner'), 'pillager refuses at block light > 8');
  okAv(!MCL.Spawn.checkPlacement('vindicator', 0, 0, 0, 'spawner'), 'vindicator refuses in light (HostileEntity.canSpawnInDark, #5124)');
  W.light = 0;
}
say(`   ${pass} ok`);

// ------------------------------------------------- summary
console.log(`\n${fails.length === 0 ? 'PASS' : 'FAIL'}  ${pass} ok, ${fails.length} failed (${breaks} anti-vacuity checks)`);
if (fails.length) {
  for (const f of fails.slice(0, 40)) console.log('  x ' + f);
  process.exit(1);
}
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}`);
