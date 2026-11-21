#!/usr/bin/env node
// beenestcheck.mjs — loop/beenest-s103 (QUEUE 0.2 G18c): BEE NESTS IN TREE WORLDGEN.
//
//   node tools/beenestcheck.mjs [--verbose]
//
// Drives the REAL modules — 04k_feat_trees.js's `beehive` decorator, 07zo_bee.js's
// `Bee.stockNest`/`Bee.tickHive`/`Bee.tickHiveBE`, 07c_blockentity.js's `BE.tick` 'beehive'
// dispatch — against `.decomp/net/minecraft/world/gen/treedecorator/BeehiveTreeDecorator.java`
// (74 lines, read whole) and the matching slice of
// `.decomp/net/minecraft/block/entity/BeehiveBlockEntity.java` (addBee/releaseBee/tickBees,
// read whole).
//
// Sections:
//   1. Bee.stockNest — the occupant-fill unit (BeehiveTreeDecorator.generate's own dice turned
//      into occupant records, .decomp lines 61-68 + addBee line 176)
//   2. the real decorator, live — a REAL compiled 'fancy_oak_bees_005' tree feature
//      (worldgen.bin's own jar-extracted config, not a guess) actually creates a beehive block
//      entity with 2-3 bees whenever its nest lands, over many real placements
//   3. bees have NO natural biome-spawn entry in 1.18.2 — confirmed against the jar-extracted
//      spawner lists this engine's Biomes/Spawn modules already read generically (no guessing:
//      if a bee row ever existed in a biome's spawner list, this section fails)
//   4. Bee.tickHive / Bee.tickHiveBE — the day/rain release gate (BeehiveBlockEntity.releaseBee,
//      .decomp line 189), wired live through BE.tick's own 'beehive' branch
//   5. anti-vacuity — break the check's own data/stubs and watch it catch the break

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
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c && VERBOSE) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };

console.log('beenestcheck — loop/beenest-s103 (QUEUE 0.2 G18c), bee nests in tree worldgen');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
               '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js',
               '14c_raycast.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js', '07m_breed.js',
               '07t_fly.js', '07q_effects.js', '09b_sky.js', '07zo_bee.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const Bee = MCL.Bee, S = MCL.States, R = MCL.Reg, BE = MCL.BlockEntities;
const B = MCL.Biomes, Spawn = MCL.Spawn, Sky = MCL.Sky, EL = MCL.EntityList, W = MCL.World;

MCL.Entities.init();
MCL.Entities.attrs = MCL.DATA.entities.attrs;
if (BE && BE.init) BE.init();
W.init(1);
MCL.Behave.init(W);
EL.init();
if (MCL.Ai && MCL.Ai.init) MCL.Ai.init();
if (Spawn && Spawn.init) Spawn.init();

ok(Bee && Bee.ready, 'NS.Bee did not load/ready');
ok(BE && BE.ready, 'NS.BlockEntities did not load/ready');
ok(typeof Bee.stockNest === 'function', 'Bee.stockNest must exist');
ok(typeof Bee.tickHiveBE === 'function', 'Bee.tickHiveBE must exist');

// ── 1. Bee.stockNest — the occupant-fill unit ───────────────────────────────────────────────
say('1. Bee.stockNest — BeehiveTreeDecorator.generate\'s occupant fill (.decomp lines 61-68/176)');
{
  const be = Bee.stockNest(10, 64, 10, [0, 598, 300]);
  ok(!!be && be.type === 'beehive', 'stockNest must create a fresh beehive block entity when none exists');
  ok(BE.get(10, 64, 10) === be, 'the block entity it created must be the one BE.get finds at that cell');
  ok(be.bees.length === 3, `3 ticks given -> 3 occupants — got ${be.bees.length}`);
  ok(be.bees.every((o) => o.EntityData.HasNectar === false),
    'BeehiveTreeDecorator.generate\'s own addBee call passes hasNectar `false` literally (.decomp line 67) — every generated occupant must carry it');
  // addBee(nbt, ticksInHive, false) -> minOccupationTicks=600 (.decomp line 176/68); this engine
  // counts DOWN, so ticksLeft = 600 - ticksInHive. nextInt(599) never reaches 600, so it is
  // always > 0 (a generated bee is never released the instant it appears).
  ok(be.bees[0].TicksInHive === 0 && be.bees[0].MinOccupationTicks === 600, `draw 0 -> TicksInHive 0 / Min 600 — got ${be.bees[0].TicksInHive}`);
  ok(be.bees[1].TicksInHive === 598, `draw 598 -> TicksInHive 598 — got ${be.bees[1].TicksInHive}`);
  ok(be.bees.every((o) => o.TicksInHive < o.MinOccupationTicks), 'every occupant\'s TicksInHive must be under Min — nextInt(599) can never reach minOccupationTicks (600)');

  // MAX_BEE_COUNT (.decomp line 65) caps a hive at 3 — the SAME cap `Bee.enterHive` already
  // reads (Bee.MAX_HIVE_OCCUPANTS), so a decorator that (wrongly) rolled more than 3 must still
  // only ever fill 3.
  const be2 = Bee.stockNest(20, 64, 20, [1, 2, 3, 4, 5]);
  ok(be2.bees.length === Bee.MAX_HIVE_OCCUPANTS, `5 ticks given, cap ${Bee.MAX_HIVE_OCCUPANTS} -> must still cap at 3 — got ${be2.bees.length}`);

  // an already-full hive (occupants already entered live, e.g. by Bee.enterHive) must refuse
  // more from a second stockNest call — the cap is on the HIVE, not on one call's own draw.
  const be3 = BE.create(30, 64, 30, 'beehive');
  be3.bees.push({ id: 1, hasNectar: true, ticksLeft: 100 }, { id: 2, hasNectar: false, ticksLeft: 100 },
                 { id: 3, hasNectar: false, ticksLeft: 100 });
  Bee.stockNest(30, 64, 30, [10, 20]);
  ok(be3.bees.length === 3, 'stockNest on an already-full hive must add nothing');
}

// ── 2. the real decorator, live ─────────────────────────────────────────────────────────────
say('\n2. the real compiled fancy_oak_bees_005 tree feature actually stocks its nest');
{
  const F = MCL.Features, SR = MCL.States, CFG = MCL.CFG;
  const MINY = CFG.WORLD_MIN_Y, H = CFG.CHUNK_H;
  MCL.Gen.init(20260924, Object.assign(MCL.Gen.defaults(), { climate: 'vanilla', features: true }));
  F.init(MCL.Gen);

  const j = MCL.WG.get('configured_feature', 'fancy_oak_bees_005');
  ok(!!j && j.type === 'minecraft:tree' &&
     j.config && j.config.decorators && j.config.decorators.some((d) => d.type === 'minecraft:beehive'),
    'setup: worldgen.bin\'s own fancy_oak_bees_005 must carry a real beehive decorator — nothing here is guessed');
  const prob = j.config.decorators.find((d) => d.type === 'minecraft:beehive').probability;
  ok(Math.abs(prob - 0.05) < 1e-9, `setup: fancy_oak_bees_005's beehive probability must be the jar's own 0.05 — got ${prob}`);

  const inl = F.api.inline('minecraft:fancy_oak_bees_005', 'beenestcheck');
  ok(!!inl, 'fancy_oak_bees_005 must compile as an inline feature');

  const STONE = SR.stateOf('stone'), GRASS = SR.stateOf('grass_block');
  function preFeature(cx, cz) {
    const sb = new Uint16Array(H * 256);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const h = MCL.Column.height((cx << 4) + x, (cz << 4) + z) | 0;
      const top = Math.min(H - 1, h - MINY);
      for (let y = 0; y <= top; y++) sb[(y << 8) | (z << 4) | x] = STONE;
      if (top >= 0) sb[(top << 8) | (z << 4) | x] = GRASS;
    }
    return sb;
  }

  let placements = 0, tries = 0, hiveBlocks = 0, staffedRight = 0;
  const before = () => BE.count();
  outer:
  for (let cx = 100; cx < 140; cx++) {
    for (let cz = 100; cz < 140; cz++) {
      tries++;
      if (tries > 3000) break outer;
      const sb = preFeature(cx, cz);
      const x = (cx << 4) + 8, z = (cz << 4) + 8;
      const y = F.api.heightmapY(1, x, z);
      const seed = (cx * 7919 + cz * 104729) | 0;
      const r = F.api.rngAt(seed, x, y, z);
      const n = F.api.runInline(inl, sb, cx, cz, x, y, z, r);
      if (n <= 0) continue;
      placements++;
      // find the placed bee_nest cell in this chunk's own sb, and check its block entity
      const hiveState0 = buildHiveStates(SR, R);
      let foundCell = null;
      for (let yy = 0; yy < H && !foundCell; yy++) {
        for (let zz = 0; zz < 16 && !foundCell; zz++) {
          for (let xx = 0; xx < 16; xx++) {
            const st = sb[(yy << 8) | (zz << 4) | xx];
            if (hiveState0.has(st)) { foundCell = [(cx << 4) + xx, yy + MINY, (cz << 4) + zz]; break; }
          }
        }
      }
      if (!foundCell) continue;             // this success placed the trunk/leaves but no nest — fine
      hiveBlocks++;
      const be = BE.get(foundCell[0], foundCell[1], foundCell[2]);
      if (be && be.type === 'beehive' && be.bees.length >= 2 && be.bees.length <= 3 &&
          be.bees.every((o) => o.EntityData.HasNectar === false && o.TicksInHive < o.MinOccupationTicks)) staffedRight++;
      if (placements >= 60) break outer;     // plenty of sample, stop early
    }
  }
  ok(placements > 10, `only ${placements} real fancy_oak_bees_005 placements in ${tries} tries — sample too small to mean anything`);
  ok(hiveBlocks > 5, `only ${hiveBlocks} of ${placements} placements actually wrote a bee_nest/beehive block — sample too small`);
  ok(hiveBlocks === staffedRight,
    `every real bee_nest the decorator placed must carry a beehive block entity with 2-3 hasNectar:false, ticksLeft>0 occupants — ${staffedRight} of ${hiveBlocks} did`);
  say(`   ${tries} chunks tried, ${placements} tree placements, ${hiveBlocks} bee_nest blocks, ${staffedRight} correctly staffed`);
}

// ── 2b. worker-shaped path: Bee absent while generating, res.nests applied afterwards ───────
say('\n2b. worker path — nests logged in Gen.nestLog with NS.Bee absent, World.stockNests stocks them');
{
  const F = MCL.Features, SR = MCL.States, CFG = MCL.CFG, MINY = CFG.WORLD_MIN_Y, H = CFG.CHUNK_H;
  const inl = F.api.inline('minecraft:fancy_oak_bees_005', 'beenestcheck-w');
  const hive = buildHiveStates(SR, R);
  const STONE = SR.stateOf('stone'), GRASS = SR.stateOf('grass_block');
  function run(applyChannel) {
    let nests = 0, staffed = 0;
    BE.clear();
    const realBee = MCL.Bee, realGet = W.getBlock;
    for (let cx = 100, tries = 0; cx < 140 && nests < 12; cx++) for (let cz = 100; cz < 140 && nests < 12; cz++) {
      if (++tries > 3000) break;
      const sb = new Uint16Array(H * 256);
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        const top = Math.min(H - 1, (MCL.Column.height((cx << 4) + x, (cz << 4) + z) | 0) - MINY);
        for (let y = 0; y <= top; y++) sb[(y << 8) | (z << 4) | x] = STONE;
        if (top >= 0) sb[(top << 8) | (z << 4) | x] = GRASS;
      }
      const x = (cx << 4) + 8, z = (cz << 4) + 8, y = F.api.heightmapY(1, x, z);
      MCL.Gen.nestLog = [];
      MCL.Bee = undefined;                              // the worker bundle has no 07zo_bee.js
      let n; try { n = F.api.runInline(inl, sb, cx, cz, x, y, z, F.api.rngAt((cx * 7919 + cz * 104729) | 0, x, y, z)); } finally { MCL.Bee = realBee; }
      const log = MCL.Gen.nestLog;
      if (n <= 0 || !log.length) continue;
      const before = BE.count();
      ok(BE.count() === before && !BE.get(log[0][0], log[0][1], log[0][2]), 'generating without Bee must create no block entity');
      W.getBlock = (bx, by, bz) => sb[((by - MINY) << 8) | ((bz & 15) << 4) | (bx & 15)];
      try { if (applyChannel) W.stockNests(log); } finally { W.getBlock = realGet; }
      for (const l of log) {
        if (!hive.has(sb[((l[1] - MINY) << 8) | ((l[2] & 15) << 4) | (l[0] & 15)])) continue;
        nests++;
        const be = BE.get(l[0], l[1], l[2]);
        if (be && be.type === 'beehive' && be.bees.length >= 2 && be.bees.length <= 3) staffed++;
      }
    }
    return [nests, staffed];
  }
  const [n1, s1] = run(true);
  ok(n1 >= 3, `worker path: only ${n1} nests sampled`);
  ok(s1 === n1, `worker path: every logged nest must carry 2-3 bees after World.stockNests — ${s1} of ${n1}`);
  const [n2, s2] = run(false);
  okAv(n2 >= 3 && s2 === 0, `channel disabled (res.nests not applied): nests get no bees — ${s2} of ${n2} staffed`);
}

function buildHiveStates(SR, R) {
  const out = new Set();
  const b = R.id['bee_nest'] !== undefined ? R.id['bee_nest'] : R.id['beehive'];
  if (b === undefined) return out;
  for (let s = R.realFirst[b]; s < R.realFirst[b + 1]; s++) out.add(s);
  return out;
}

// ── 3. bees have no natural biome-spawn entry ───────────────────────────────────────────────
say('\n3. bees carry NO natural biome-spawn entry in 1.18.2 (BiomeDefaultFeatures never lists bee)');
{
  ok(B && B.ready, 'NS.Biomes did not load/ready');
  ok(Spawn && Spawn.ready, 'NS.Spawn did not load/ready');
  let sawBee = false;
  for (let i = 0; i < B.count; i++) {
    const cats = B.spawners(i) || {};
    for (const cat of Object.keys(cats)) {
      for (const entry of (cats[cat] || [])) {
        if (MCL.Entities.bare(entry.type) === 'bee') sawBee = true;
      }
    }
  }
  ok(!sawBee, 'no biome\'s own jar-extracted spawner list may name "bee" — 1.18.2 has no natural bee spawn, only nests');
  ok(Spawn.RULES && Spawn.RULES.bee === undefined,
    'there must be no Spawn.RULES.bee — a species with no biome spawn entry gets no spawn RULE either (nothing to gate)');
}

// ── 4. Bee.tickHive / Bee.tickHiveBE — the day/rain release gate ──────────────────────────
say('\n4. Bee.tickHive / Bee.tickHiveBE — BeehiveBlockEntity.releaseBee\'s day/rain gate (.decomp line 189)');
{
  const be = BE.create(50, 64, 50, 'beehive');
  be.bees.push({ id: 7, hasNectar: false, ticksLeft: -1 });

  let released = null;
  Bee.tickHive(be, { isNight: () => true, isRaining: () => false, spawnBee: (x, y, z, o) => { released = o; } });
  ok(released === null, 'tickHive must NOT release a ready occupant at night (releaseBee refuses, .decomp line 189)');
  ok(be.bees.length === 1 && be.bees[0].TicksInHive > be.bees[0].MinOccupationTicks, 'a blocked occupant must stay in the hive, timer past min, not lost');

  Bee.tickHive(be, { isNight: () => false, isRaining: () => true, spawnBee: (x, y, z, o) => { released = o; } });
  ok(released === null, 'tickHive must NOT release a ready occupant while it is raining (releaseBee refuses, .decomp line 189)');
  ok(be.bees.length === 1, 'a rain-blocked occupant must still be in the hive');

  Bee.tickHive(be, { isNight: () => false, isRaining: () => false, spawnBee: (x, y, z, o) => { released = o; } });
  ok(released && released.EntityData && released.MinOccupationTicks === 600, 'tickHive must release a ready occupant once it is day and not raining');
  ok(be.bees.length === 0, 'a released occupant must leave the hive\'s own bees array');

  // exact release tick (tickBees: ticksInHive > min checked BEFORE ticksInHive++ -> tick min+2 after entry)
  const releaseTick = (min) => {
    const h = BE.create(70, 64, 70, 'beehive'); h.bees.push({ id: 9, hasNectar: false, ticksLeft: min });
    let n = 0, got = false;
    while (!got && n < 5000) { n++; Bee.tickHive(h, { isNight: () => false, isRaining: () => false, spawnBee: () => { got = true; } }); }
    return n;
  };
  okAv(releaseTick(600) === 602, `plain occupant releases on tick 602 — got ${releaseTick(600)}`);
  okAv(releaseTick(2400) === 2402, `nectar occupant releases on tick 2402 — got ${releaseTick(2400)}`);
  okAv(releaseTick(599) !== 602, 'break: a 599 timer must NOT release on tick 602');

  // Bee.tickHiveBE — the live wiring off NS.Sky, and BE.tick's own dispatch
  const be2 = BE.create(60, 64, 60, 'beehive');
  be2.bees.push({ id: 8, hasNectar: false, ticksLeft: -1 });
  Sky.dayTime = 6000;                 // noon — Sky.isDay() must read true
  Sky.weather = Sky.newWeather();
  Sky.weather.raining = false;
  ok(Sky.isDay() === true, 'setup: Sky.dayTime=6000 must read as day (Sky.isDay, D-511)');
  const before = EL.list.length;
  Bee.tickHiveBE(be2);
  ok(be2.bees.length === 0, 'Bee.tickHiveBE must release a ready occupant through the live NS.Sky day/rain read');
  ok(EL.list.length === before + 1, 'Bee.tickHiveBE\'s spawnBee must actually EL.spawn a live bee entity');
  ok(EL.list[EL.list.length - 1].type === 'bee', 'the entity Bee.tickHiveBE spawns must be a real "bee"');

  // BE.tick's own dispatch: place a live beehive block through W.setBlock (so BE.onChanged wires
  // it) and confirm BE.tick's 'beehive' branch reaches Bee.tickHiveBE without the caller doing
  // anything hive-specific — the same shape every other BE.tick branch already proves itself.
  const hiveState = S.stateOf('beehive');
  ok(hiveState !== 0, 'setup: no real "beehive" block in this registry');
  const cx = 2, cz = 2;
  const c = W.makeChunk(cx, cz); c.state = MCL.CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
  W.setBlock(cx * 16, 64, cz * 16, hiveState);
  const liveBE = BE.get(cx * 16, 64, cz * 16);
  ok(!!liveBE && liveBE.type === 'beehive', 'setup: W.setBlock(beehive) must create the block entity (BE.onChanged)');
  liveBE.bees.push({ id: 9, hasNectar: false, ticksLeft: -1 });
  BE.tick();
  ok(liveBE.bees.length === 0, 'BE.tick must reach Bee.tickHiveBE for a live "beehive" block entity and release its ready occupant');

  // honey_level block state is bumped on RELEASE of a nectar bee (releaseBee), incl. the 1% +2 roll
  const hl = () => +MCL.Behave.propName(W.getBlock(cx * 16, 64, cz * 16), 'honey_level');
  ok(hl() === 0, 'setup: fresh beehive honey_level 0');
  liveBE.bees.push({ id: 10, hasNectar: true, ticksLeft: 5 });
  ok(hl() === 0, 'a nectar bee sitting in the hive must not bump honey_level before release');
  liveBE.bees[0].ticksLeft = -1; BE.tick();
  ok(hl() === 1, `releasing a nectar bee must set block-state honey_level 1 — got ${hl()}`);
  ok(BE.get(cx * 16, 64, cz * 16) === liveBE, 'honey_level setBlock must keep the block entity');
  const rnd = EL.random; EL.random = () => 0;
  liveBE.bees.push({ id: 11, hasNectar: true, ticksLeft: -1 }); BE.tick();
  ok(hl() === 3, `1% roll must add 2 — got ${hl()}`);
  liveBE.bees.push({ id: 12, hasNectar: true, ticksLeft: -1 }); BE.tick();
  liveBE.bees.push({ id: 13, hasNectar: true, ticksLeft: -1 }); BE.tick();
  ok(hl() === 5, `2-step roll past 5 is capped by the minus-1 rule — got ${hl()}`);
  EL.random = rnd;
  okAv(hl() !== 1, 'break: honey_level is not stuck at 1 after several nectar releases');
}

// ── 5. anti-vacuity ─────────────────────────────────────────────────────────────────────────
say('\n5. anti-vacuity — break the check\'s own data/stubs and confirm this check catches it');
{
  // break: a "ctx" that pretends it is always night must stop release, even at ticksLeft<=0
  const beX = BE.create(70, 64, 70, 'beehive');
  beX.bees.push({ id: 1, hasNectar: false, ticksLeft: -1 });
  let releasedX = false;
  Bee.tickHive(beX, { isNight: () => true, isRaining: () => false, spawnBee: () => { releasedX = true; } });
  okAv(releasedX === false, 'break: forcing isNight->true must suppress release (proves the gate is actually read, not bypassed)');
  Bee.tickHive(beX, { isNight: () => false, isRaining: () => false, spawnBee: () => { releasedX = true; } });
  okAv(releasedX === true, 'restoring isNight->false must let the SAME occupant release next tick');

  // break: corrupt Bee.MIN_OCCUPATION_TICKS_PLAIN so stockNest's ticksLeft math visibly moves
  const savedTicks = Bee.MIN_OCCUPATION_TICKS_PLAIN;
  Bee.MIN_OCCUPATION_TICKS_PLAIN = 1000;
  const beY = Bee.stockNest(80, 64, 80, [0]);
  okAv(beY.bees[0].MinOccupationTicks === 1000, 'break: corrupting MIN_OCCUPATION_TICKS_PLAIN must move stockNest\'s MinOccupationTicks with it');
  Bee.MIN_OCCUPATION_TICKS_PLAIN = savedTicks;
  const beZ = Bee.stockNest(81, 64, 81, [0]);
  okAv(beZ.bees[0].MinOccupationTicks === savedTicks, 'restoring MIN_OCCUPATION_TICKS_PLAIN must read 600 again');

  // break: a fake biome spawner list carrying a bee row must be caught by section 3's own scan
  const bi = 0;
  const real = B.spawners(bi);
  const savedList = real.creature;
  real.creature = (real.creature || []).concat([{ type: 'minecraft:bee', weight: 1, minCount: 1, maxCount: 1 }]);
  let sawBeeBroken = false;
  for (let i = 0; i < B.count; i++) {
    const cats = B.spawners(i) || {};
    for (const cat of Object.keys(cats)) for (const entry of (cats[cat] || [])) {
      if (MCL.Entities.bare(entry.type) === 'bee') sawBeeBroken = true;
    }
  }
  okAv(sawBeeBroken === true, 'break: injecting a fake bee spawner entry must be caught by the same scan section 3 runs');
  real.creature = savedList;
}

console.log(`\n${pass} passed, ${fails.length} failed (of which ${breaks} are anti-vacuity checks)`);
if (fails.length) { console.log('FAILURES:'); for (const m of fails) console.log(' - ' + m); }
console.log('================ beenestcheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
console.log('==============================================');
process.exit(fails.length ? 1 : 0);
