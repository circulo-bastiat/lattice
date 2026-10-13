#!/usr/bin/env node
// villagertypecheck.mjs — loop/vtype-s105: the villager biome TYPE substrate, whole.
// Drives the REAL modules (Prof.typeAtBiome/typeForBiomeName, 07o_profession.js;
// EL.DEFAULTS.villager, 07i_entitylist.js; Zv.spawnInit, 07zr_zvillager.js) against
// `.decomp/net/minecraft/village/VillagerType.java` (66 lines, read whole: the 7-constant
// enum + `BIOME_TO_TYPE` map + `forBiome`) and `.decomp/net/minecraft/entity/passive/
// VillagerEntity.java:748-754` / `.decomp/net/minecraft/entity/mob/ZombieVillagerEntity.java
// :320-321` (both `initialize()`'s own `VillagerType.forBiome(world.getBiome(pos))` call).
//
//   node tools/villagertypecheck.mjs [--verbose]
//
// Sections:
//   1. Prof.typeForBiomeName / Prof.TYPE_BIOMES -- the transcribed BIOME_TO_TYPE table, all
//      28 biome keys, the 7 types, and the orElse(PLAINS) default for anything not listed
//   2. Prof.typeAtBiome -- the world-position wrapper (W.biomeAt -> B.name -> the table)
//   3. EL.DEFAULTS.villager -- a natural/egg villager rolls type from its OWN spawn biome;
//      opts.villagerType (command/egg/restore) wins over the roll
//   4. Zv.spawnInit (zombie_villager) -- the identical roll + opts-wins shape
//   5. both conversion directions carry the SOURCE type across, never re-rolling it off the
//      conversion's own spawn biome (kill-conversion, and the golden-apple cure)
//   6. mob-NBT round trip -- Mb.fieldsFor carries villagerType for both species, and a real
//      serializeAll/restoreAll cycle preserves it through EL.spawn's opts-wins path
//   7. anti-vacuity -- break the table and the wiring, both must actually be caught

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

console.log('villagertypecheck -- loop/vtype-s105, villager biome TYPE substrate, whole');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
               '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
               '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js',
               '07m_breed.js', '07o_profession.js', '07p_trade.js', '07zk_undead.js',
               '07zr_zvillager.js', '07zw_mobnbt.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const EL = MCL.EntityList, Ai = MCL.Ai, Spawn = MCL.Spawn, Ent = MCL.Entities;
const Zv = MCL.ZVillager, Prof = MCL.Profession, Mb = MCL.MobNbt;
const W = MCL.World, S = MCL.States;
const CH = MCL.CH;

MCL.Entities.init();
Ent.attrs = MCL.DATA.entities.attrs;
W.init(1);
MCL.Behave.init(W);
EL.init();
Ai.init();
Spawn.init();
Prof.init();

for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}

ok(Prof && Prof.ready, 'NS.Profession did not load/ready');
ok(Zv && Zv.ready, 'NS.ZVillager did not load/ready');
ok(Mb && Mb.ready, 'NS.MobNbt did not load/ready');

// -- 1. Prof.typeForBiomeName / Prof.TYPE_BIOMES -------------------------------------------
say('1. Prof.typeForBiomeName -- the transcribed BIOME_TO_TYPE table (.decomp VillagerType.java:22-50)');
{
  // .decomp VillagerType.java:22-50, resolved through BiomeKeys.java's field_NNNNN constants --
  // 4 (desert) + 3 (jungle) + 3 (savanna) + 11 (snow) + 1 (swamp) + 6 (taiga) = 28 keys total.
  const expect = {
    desert: ['badlands', 'desert', 'eroded_badlands', 'wooded_badlands'],
    jungle: ['bamboo_jungle', 'jungle', 'sparse_jungle'],
    savanna: ['savanna', 'savanna_plateau', 'windswept_savanna'],
    snow: ['deep_frozen_ocean', 'frozen_ocean', 'frozen_river', 'ice_spikes', 'snowy_beach',
      'snowy_taiga', 'snowy_plains', 'grove', 'snowy_slopes', 'frozen_peaks', 'jagged_peaks'],
    swamp: ['swamp'],
    taiga: ['old_growth_spruce_taiga', 'old_growth_pine_taiga', 'windswept_gravelly_hills',
      'windswept_hills', 'taiga', 'windswept_forest']
  };
  let total = 0;
  for (const type in expect) {
    for (const biome of expect[type]) {
      total++;
      ok(Prof.typeForBiomeName(biome) === type,
        `${biome} must roll ${type} (got ${Prof.typeForBiomeName(biome)})`);
    }
  }
  ok(total === 28, `the transcribed table must have exactly 28 biome keys -- counted ${total}`);
  ok(Object.keys(expect).length === 7 - 1, 'PLAINS is never a map VALUE (6 non-plains types), only the orElse default');

  // biomes NOT in the map fall through forBiome's own orElse(PLAINS), .decomp:66.
  for (const notMapped of ['plains', 'forest', 'ocean', 'river', 'mushroom_fields', 'the_end', 'nether_wastes', 'nonexistent_biome']) {
    ok(Prof.typeForBiomeName(notMapped) === 'plains', `${notMapped} must default to plains (not in BIOME_TO_TYPE)`);
  }
  ok(Prof.typeForBiomeName(undefined) === 'plains', 'a missing biome name must default to plains, not throw');
}

// -- 2. Prof.typeAtBiome ---------------------------------------------------------------------
say('2. Prof.typeAtBiome -- W.biomeAt -> B.name -> the table');
{
  const saveBiomeAt = W.biomeAt, saveBiomes = MCL.Biomes;

  W.biomeAt = () => 7;
  MCL.Biomes = { ready: true, name: (idx) => (idx === 7 ? 'jungle' : 'plains') };
  ok(Prof.typeAtBiome(100, 200) === 'jungle', 'typeAtBiome must resolve the live biome index through B.name into the table');

  MCL.Biomes = { ready: true, name: (idx) => (idx === 7 ? 'snowy_taiga' : 'plains') };
  ok(Prof.typeAtBiome(100, 200) === 'snow', 'a different index->name mapping must change the answer (not memoized on position)');

  // no world/biomes wired yet (e.g. a bare command-console context) must never throw, defaults plains
  MCL.Biomes = saveBiomes; W.biomeAt = saveBiomeAt;
  const savedReady = MCL.Biomes.ready;
  MCL.Biomes.ready = false;
  ok(Prof.typeAtBiome(0, 0) === 'plains', 'Biomes not ready yet must default to plains, not throw');
  MCL.Biomes.ready = savedReady;
}

// -- 3. EL.DEFAULTS.villager -----------------------------------------------------------------
say('3. EL.spawn(villager) -- rolls type off ITS OWN spawn biome; opts.villagerType wins');
{
  const saveBiomeAt = W.biomeAt, saveBiomes = MCL.Biomes;
  W.biomeAt = () => 1;
  MCL.Biomes = { ready: true, name: () => 'savanna' };

  const v = EL.spawn('villager', 5, 64, 5, {});
  ok(!!v, 'EL.spawn(villager) must succeed');
  ok(v.villagerType === 'savanna', `a natural/egg villager spawned over a savanna biome must roll savanna -- got ${v.villagerType}`);

  const forced = EL.spawn('villager', 5, 64, 5, { villagerType: 'taiga' });
  ok(forced.villagerType === 'taiga', 'opts.villagerType must win over the biome roll');

  W.biomeAt = saveBiomeAt; MCL.Biomes = saveBiomes;
  // no biome reader at all -- must still default to plains, never throw or leave it undefined.
  const bare = EL.spawn('villager', 5, 64, 5, {});
  ok(bare.villagerType === 'plains', `with no live biome reader the default must be plains -- got ${bare.villagerType}`);
  ok(bare.profession === 'none', 'the pre-existing profession default must be untouched by this change');
}

// -- 4. Zv.spawnInit (zombie_villager) --------------------------------------------------------
say('4. EL.spawn(zombie_villager) / Zv.spawnInit -- the identical roll + opts-wins shape');
{
  const saveBiomeAt = W.biomeAt, saveBiomes = MCL.Biomes;
  W.biomeAt = () => 2;
  MCL.Biomes = { ready: true, name: () => 'badlands' };

  const zv = EL.spawn('zombie_villager', 8, 64, 8, {});
  ok(!!zv, 'EL.spawn(zombie_villager) must succeed');
  ok(zv.villagerType === 'desert', `a natural/egg zombie villager spawned over badlands must roll desert -- got ${zv.villagerType}`);

  const forced = EL.spawn('zombie_villager', 8, 64, 8, { villagerType: 'swamp' });
  ok(forced.villagerType === 'swamp', 'opts.villagerType must win over Zv.spawnInit\'s own roll');

  W.biomeAt = saveBiomeAt; MCL.Biomes = saveBiomes;
  const bare = EL.spawn('zombie_villager', 8, 64, 8, {});
  ok(bare.villagerType === 'plains', `with no live biome reader the default must be plains -- got ${bare.villagerType}`);
}

// -- 5. both conversion directions carry the SOURCE type, never re-rolling ------------------
say('5. conversion carries the SOURCE villagerType across, not the conversion site\'s own biome');
{
  const saveBiomeAt = W.biomeAt, saveBiomes = MCL.Biomes;
  W.biomeAt = () => 3;
  MCL.Biomes = { ready: true, name: () => 'jungle' };   // the CONVERSION site's biome -- must be ignored

  const v = EL.spawn('villager', 40, 64, 40, {});
  v.villagerType = 'desert';   // the SOURCE villager's own (previously rolled/loaded) type
  const zv = Zv.convertVillagerToZombie(v, 'hard', () => 0);
  ok(!!zv, 'a HARD kill must convert');
  ok(zv.villagerType === 'desert', `kill-conversion must carry the villager's OWN type across, not re-roll off the jungle kill site -- got ${zv.villagerType}`);

  zv.villagerType = 'swamp';
  zv.converting = true; zv.conversionTimer = 1;
  const cured = Zv.finishConversion(zv);
  ok(!!cured, 'finishConversion must produce a villager');
  ok(cured.villagerType === 'swamp', `the cure must carry the zombie villager's OWN type across, not re-roll off the jungle cure site -- got ${cured.villagerType}`);

  W.biomeAt = saveBiomeAt; MCL.Biomes = saveBiomes;
}

// -- 6. mob-NBT round trip --------------------------------------------------------------------
say('6. mob NBT -- Mb.fieldsFor carries villagerType; a real save/restore cycle preserves it');
{
  ok(Mb.fieldsFor('villager').indexOf('villagerType') !== -1, 'villagerType must be in the villager NBT field list');
  ok(Mb.fieldsFor('zombie_villager').indexOf('villagerType') !== -1, 'villagerType must be in the zombie_villager NBT field list');

  const saveBiomeAt = W.biomeAt, saveBiomes = MCL.Biomes;
  W.biomeAt = () => 0; MCL.Biomes = { ready: true, name: () => 'plains' };

  const v = EL.spawn('villager', 60, 64, 60, {});
  v.villagerType = 'jungle';
  const records = Mb.serializeAll().filter((r) => r.type === 'villager' && r.x === 60);
  ok(records.length === 1 && records[0].villagerType === 'jungle', 'serializeAll must capture the rolled/forced villagerType');

  // restore over a DIFFERENT live biome -- opts.villagerType from the record must still win.
  MCL.Biomes = { ready: true, name: () => 'desert' };
  if (EL.remove) EL.remove(v); else v.removed = true;
  const n = Mb.restoreAll(records);
  ok(n === 1, 'restoreAll must restore exactly one record');
  const restored = EL.list.find((e) => e && e.type === 'villager' && e.x === 60 && !e.removed);
  ok(!!restored && restored.villagerType === 'jungle', `a restored villager must keep its saved type, not re-roll off the reload-time biome -- got ${restored && restored.villagerType}`);

  W.biomeAt = saveBiomeAt; MCL.Biomes = saveBiomes;
}

// -- 7. anti-vacuity ---------------------------------------------------------------------------
say('7. anti-vacuity -- break the table and the wiring, both must actually be caught');
{
  // 7a. corrupt the public table and rebuild the derived map through the same Prof.init()
  //     path professioncheck.mjs already uses for Prof.WORKSTATIONS.
  const realDesert = Prof.TYPE_BIOMES.desert;
  Prof.TYPE_BIOMES.desert = ['badlands'];   // drop 'desert' itself from its own type on purpose
  Prof.init();
  okAv(Prof.typeForBiomeName('desert') !== 'desert', 'a biome dropped from its own row falls back to plains -- the row-membership check is live');
  Prof.TYPE_BIOMES.desert = realDesert;
  Prof.init();
  ok(Prof.typeForBiomeName('desert') === 'desert', 'the table must be restored correctly after the break');

  // 7b. break EL.DEFAULTS.villager's own wiring by blinding NS.Profession, and confirm the
  //     natural-spawn roll assertion above would have caught it (a live re-run of §3's own shape).
  const realTypeAtBiome = Prof.typeAtBiome;
  Prof.typeAtBiome = undefined;
  const saveBiomeAt = W.biomeAt, saveBiomes = MCL.Biomes;
  W.biomeAt = () => 1; MCL.Biomes = { ready: true, name: () => 'savanna' };
  const blinded = EL.spawn('villager', 70, 64, 70, {});
  okAv(blinded.villagerType === 'plains' && blinded.villagerType !== 'savanna',
    'blinding Prof.typeAtBiome collapses the roll to plains -- the savanna assertion in §3 is live, not vacuous');
  Prof.typeAtBiome = realTypeAtBiome;
  W.biomeAt = saveBiomeAt; MCL.Biomes = saveBiomes;

  // 7c. break the kill-conversion's own "carry across" line and confirm §5 would have caught it.
  W.biomeAt = () => 3; MCL.Biomes = { ready: true, name: () => 'jungle' };
  const v2 = EL.spawn('villager', 80, 64, 80, {});
  v2.villagerType = 'desert';
  const realDataFromVillager = Zv.dataFromVillager;
  Zv.dataFromVillager = function (villager) {
    const d = realDataFromVillager(villager);
    d.villagerType = undefined;   // simulate "forgot to carry it" -- Zv.spawnInit then re-rolls off the kill site
    return d;
  };
  const zv2 = Zv.convertVillagerToZombie(v2, 'hard', () => 0);
  okAv(zv2.villagerType !== 'desert', 'dropping villagerType from the kill-conversion payload is caught (it re-rolls off the jungle kill site instead)');
  Zv.dataFromVillager = realDataFromVillager;
  W.biomeAt = saveBiomeAt; MCL.Biomes = saveBiomes;
}

console.log('================ villagertypecheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
console.log('==================================================');
process.exit(fails.length ? 1 : 0);
