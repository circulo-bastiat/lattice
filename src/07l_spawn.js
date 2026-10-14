// 07l_spawn.js — PLAN G18c (PASS 16 JOB 2): SPAWNING. D-393.
// Runs on: MAIN THREAD ONLY. No DOM.
//
// ⚠⚠ SCOPE, STATED PLAINLY BECAUSE THE PROJECT'S OWN RULE IS "NAME WHAT IS OWED, NEVER GUESS
// IT". `EL.spawn` refuses everything but `cow` and `zombie` (D-307/D-390's closed motion set)
// and `Ai.ROSTER` wires goals for only those two (D-382). So THIS file's placement RULES are
// jar-verified for exactly those two mobs — the only two this engine can bring to life — and
// every other type a biome's spawner list names (spider, skeleton, creeper, squid, …) is
// correctly REFUSED by `EL.spawn` the same way a spawn egg for one already is (`14l_use.js`).
// The monster SPAWNER BLOCK (JOB 2's own §2.3) IS built here, as of D-395 — `Spawn.tickSpawner`,
// dispatched from `BlockEntities.tick()`. It shares this file's own category caps rather than
// inventing a second one, per `docs/archive/NEXT.md`'s own acceptance for the job; its one open piece
// (the spinning miniature-mob DRAW) is a renderer concern and stays on `Spawn.OWED`.
//
// ── THE THREE THINGS THIS FILE OWES TO THE BYTECODE, NOT TO MEMORY (D-263) ──────────────────
//   1. `MobCategory` (obfuscated `ayb`, 1.18.2): its <clinit> is eight `new ayb(name, ordinal,
//      jsonName, cap, isFriendly, isPersistent, despawnDistance)` calls, read directly — see
//      `Spawn.CATEGORY` below for the anchors. Every category shares a hard-coded
//      `noDespawnDistance` of 32 (a literal `bipush 32` inside the constructor, independent of
//      every category's own arguments) except `WATER_AMBIENT`, whose `despawnDistance` is 64
//      where every other category's is 128 — the "32/128 bands" `docs/archive/NEXT.md` already named.
//   2. `Animal.checkAnimalSpawnRules` (obfuscated `bid.b`, cow's own superclass): the block
//      BELOW must carry `#minecraft:animals_spawnable_on` (the jar's own tag file has exactly
//      one member, `grass_block`) AND `Animal.isBrightEnoughToSpawn` — `getRawBrightness(pos,0)
//      > 8`, read straight off the `bipush 8; if_icmple` in `bid.a(bzy,gj)`.
//   3. `Monster.checkMonsterSpawnRules` (obfuscated `bmd.b`, zombie's own superclass — `bmw`
//      declares no override, so zombie uses this unchanged): difficulty != PEACEFUL. D-400
//      (PASS 16, session 38) gives this engine its first real difficulty STATE (`NS.Diff`,
//      default `'normal'`), and this file's own `Diff.isPeaceful()` gate is its first live
//      reader — no longer always-true, honestly gated on a value nothing in play can set yet
//      (no `/difficulty` command — D-327, `Diff.OWED`). AND `isDarkEnoughToSpawn` (`bmd.a`: sky
//      brightness at the position must be `<= random.nextInt(32)`, block brightness must be 0, and
//      the local raw brightness — this engine's overworld has no dimension ceiling, so the
//      jar's ceiling branch never applies here — must be `<= random.nextInt(8)`) AND
//      `Mob.checkMobSpawnRules` (obfuscated `aya.a`: reason is SPAWNER, or the block below
//      "is a valid spawn" — approximated here as a solid top face, `B.faceSturdy(below, 1)`;
//      the real predicate is `BlockBehaviour.isValidSpawn`, which additionally reads the
//      block's own light EMISSION on the ~20 blocks that override it, and that per-block table
//      is NOT extracted this session — named on `Spawn.OWED`).
//
// THE SEARCH ALGORITHM IS VANILLA'S (#166, G18c-c): `Spawn.spawnForChunk` is `SpawnHelper.spawnEntitiesInChunk` draw for
// draw (random chunk position, 3 tries, ceil(nextFloat*4) pack steps with nextInt(6)-nextInt(6) jitter, the 576
// player-distance and 24-block world-spawn rules, per-type limitPerChunk) and `Spawn.tick` is `tickChunks`
// (every ticking chunk, shuffled, `creature` only on time % 400 == 0), with `SpawnHelper.Info`'s counts and
// GravityField/spawn_costs. `spawntravcheck` proves it against a draw-sequence oracle. Still named, not done:
// structure spawn lists (swamp hut, fortress, monument), `isSpaceEmpty`'s ENTITY half, a default world
// spawn when `/setworldspawn` was never run, SpawnDensityCapper's per-player half (never binds with one
// player), TropicalFish `commonSpawn`.

(function (NS) {
  'use strict';

  var Spawn = NS.Spawn = { ready: false };

  // ── D-400 (PASS 16, session 38): THE DIFFICULTY SYSTEM — ITS FIRST REAL STATE, NOT YET A
  // COMMAND. Vanilla keeps difficulty per-world (`LevelData.difficulty`, one of
  // peaceful/easy/normal/hard); this engine had NO such state at all before this session, so
  // `checkMonsterSpawnRules`'s own PEACEFUL half (this file) and `BreakDoorGoal`'s own HARD half
  // (`Ai.OWED`, D-399) were both hard-wired OPEN — honestly named as gaps, not silently wrong.
  // `NS.Diff` is the shared store both real consumers now read; `Diff.OWED` says what is still
  // missing, starting with the command itself: Dan pulled `/difficulty` explicitly (D-327 —
  // "dont worry about /difficulty until all its wirings are implemented fully") because storing
  // a difficulty that changed nothing would be the command as theatre. Two real readers is
  // still short of "all its wirings" (damage scaling, hunger's own difficulty branch, zombie
  // reinforcements and more are still open), so the command stays unregistered — `Diff.set()` is
  // reachable from a test or the console, not from play. Defaulting to `'normal'` reproduces
  // exactly this engine's PRE-D-400 behaviour for the peaceful gate (normal != peaceful, so
  // spawning is unaffected) while CORRECTING the door-break gate, which previously fired at any
  // difficulty — `'normal'` is not `'hard'`, so `BreakDoorGoal` now correctly does nothing by
  // default until something sets `Diff` to hard, matching vanilla rather than the old always-on
  // approximation.
  var Diff = NS.Diff = { value: 'normal' };
  Diff.LEVELS = ['peaceful', 'easy', 'normal', 'hard'];
  // The live-consumer honesty mechanism `Commands.RULES_LIVE` already uses for gamerules —
  // a difficulty level that is stored and read by nothing would be the same silent gap.
  Diff.LIVE = { peacefulGate: 'Spawn.checkMonsterSpawnRules (zombie/skeleton)', hardGate: 'Ai.BreakDoorGoal',
    // loop s111 — the player-side wirings (14d_survival.js) and persistence (16b_save.js):
    damageScaling: 'Survival.hurt (PlayerEntity.damage isScaledWithDifficulty)',
    hunger: 'Survival.tick (HungerManager.update: PEACEFUL food floor, starvation gate)',
    peacefulRegen: 'Survival.tick (PlayerEntity.tickMovement PEACEFUL heal/refill)',
    saved: '16b_save.js S.save/S.load' };
  Diff.get = function () { return Diff.value; };
  Diff.set = function (level) {
    if (Diff.LEVELS.indexOf(level) < 0) return Diff.value;
    return (Diff.value = level);
  };
  Diff.isPeaceful = function () { return Diff.value === 'peaceful'; };
  Diff.isHard = function () { return Diff.value === 'hard'; };
  // LocalDifficulty is REAL and regional now (07y_equip.js Eq.localDifficulty(Eq.at(pos)):
  // global level, day clock, moon, and each chunk's own inhabited time, saved with the world).
  Diff.OWED = [];   // struck (#5059): /difficulty is registered in 15g_commands.js through Diff.set

  // ── D-393: MobCategory, out of `ayb`'s <clinit> (1.18.2) ──────────────────────────────────
  // name -> { cap, friendly, persistent, noDespawn, despawn }. Every biome's own `spawners`
  // object (`B.spawners`, D-119's pass-through) is keyed by exactly these eight strings.
  Spawn.CATEGORY = {
    monster:                     { cap: 70, friendly: false, persistent: false, noDespawn: 32, despawn: 128 },
    creature:                    { cap: 10, friendly: true,  persistent: true,  noDespawn: 32, despawn: 128 },
    ambient:                     { cap: 15, friendly: true,  persistent: false, noDespawn: 32, despawn: 128 },
    axolotls:                    { cap: 5,  friendly: true,  persistent: false, noDespawn: 32, despawn: 128 },
    underground_water_creature:  { cap: 5,  friendly: true,  persistent: false, noDespawn: 32, despawn: 128 },
    water_creature:               { cap: 5,  friendly: true,  persistent: false, noDespawn: 32, despawn: 128 },
    water_ambient:                { cap: 20, friendly: true,  persistent: false, noDespawn: 32, despawn: 64  },
    misc:                         { cap: -1, friendly: true,  persistent: true,  noDespawn: 32, despawn: 128 }
  };

  /** Vanilla never naturally spawns MISC through a biome's own list (every biome's own `misc`
   *  array is empty in 1.18.2 — `B.spawners` proves it every time this runs, not assumed). */
  Spawn.NATURAL_CATEGORIES = ['monster', 'creature', 'ambient', 'axolotls',
    'underground_water_creature', 'water_creature', 'water_ambient'];

  // ── the closed set of placement RULES, same refusal shape `EL.spawn` already uses ─────────
  // A type with no entry here is not "a generic mob"; `Spawn.canPlace` says no, exactly the way
  // `EL.motionFor` says no for a type nobody measured (see the file header).
  Spawn.RULES = {
    /** Animal.checkAnimalSpawnRules (`bid.b`): grass below, and bright enough. */
    cow: function (x, y, z) {
      var W = NS.World;
      var below = W.getBlock(x, y - 1, z);
      if (below === 0) return false;
      if (!W.tagBelow('animals_spawnable_on', below)) return false;
      return isBrightEnoughToSpawn(x, y, z);
    },
    // QUEUE 0.2 (G18c): sheep/chicken/pig each declare no `checkAnimalSpawnRules` override of
    // their own (`.decomp`'s SheepEntity/ChickenEntity/PigEntity, read in full — no override
    // method present) — same base-`Animal` rule cow's own entry above already implements, not
    // a fresh read. Sharing `Spawn.RULES.cow`'s own function object rather than retyping it: a
    // future correction to the base rule (e.g. D-393's own "20 blocks that override light
    // emission" gap closing) then fixes all four at once instead of three copies drifting.
    sheep: null, chicken: null, pig: null,
    /** Monster.checkMonsterSpawnRules (`bmd.b`), via isDarkEnoughToSpawn + checkMobSpawnRules. */
    zombie: function (x, y, z, reason, rnd) {
      if (Diff.isPeaceful()) return false;   // D-400: Monster.checkMonsterSpawnRules's own gate
      if (!isDarkEnoughToSpawn(x, y, z, rnd)) return false;
      return checkMobSpawnRules(x, y, z, reason);
    },
    /** ZombieVillagerEntity declares no canSpawn: SpawnRestriction registers it ON_GROUND with the Monster rule, same as zombie. */
    zombie_villager: function (x, y, z, reason, rnd) { return Spawn.RULES.zombie.call(this, x, y, z, reason, rnd); },
    /** loop/zombievariants-s100 (QUEUE 0.2 G18c) -- `HuskEntity.canSpawn` (.decomp, read
     *  whole): `canSpawnInDark` (== zombie's own rule above, `HostileEntity.canSpawnInDark`,
     *  verbatim) AND (the spawn reason is SPAWNER, or `world.isSkyVisible(pos)`) -- a desert
     *  husk only replaces a surface zombie, never a cave one. `reason === 'spawner'` is the
     *  SAME string `checkMobSpawnRules` (below in this file) already special-cases.
     */
    husk: function (x, y, z, reason, rnd) {
      if (Diff.isPeaceful()) return false;
      if (!isDarkEnoughToSpawn(x, y, z, rnd)) return false;
      if (!checkMobSpawnRules(x, y, z, reason)) return false;
      if (reason === 'spawner') return true;
      return !!(NS.World.canSeeSky && NS.World.canSeeSky(x, y, z));
    },
    /** D-396, bytecode-verified #5124: `skeleton` (`bml`) registers `HostileEntity.canSpawnInDark` (`bmd.b`)
     *  in SpawnRestriction -- no override of its own, same as zombie (tools/golden/spawn-predicates-1.18.2.tsv). */
    skeleton: function (x, y, z, reason, rnd) {
      if (Diff.isPeaceful()) return false;   // D-400: same gate, same superclass as zombie
      if (!isDarkEnoughToSpawn(x, y, z, rnd)) return false;
      return checkMobSpawnRules(x, y, z, reason);
    },
    /** loop/zombievariants-s100 (QUEUE 0.2 G18c) -- `StrayEntity.canSpawn` (.decomp, read
     *  whole): the SAME `canSpawnInDark` skeleton's own rule above already implements, AND
     *  (spawner reason, or sky-visible ABOVE the powder-snow stack the position climbs
     *  through) -- a snowy-surface stray never replaces a skeleton standing under a solid
     *  roof, and climbing through powder snow (a snowy-slopes surface feature) does not
     *  itself block the sky check the way a normal block would.
     */
    stray: function (x, y, z, reason, rnd) {
      if (Diff.isPeaceful()) return false;
      if (!isDarkEnoughToSpawn(x, y, z, rnd)) return false;
      if (!checkMobSpawnRules(x, y, z, reason)) return false;
      if (reason === 'spawner') return true;
      var W = NS.World, R = NS.Reg, S = NS.States;
      var cy = y + 1;
      for (var guard = 0; guard < 64; guard++) {
        var st = W.getBlock(x, cy, z);
        if (!(st > 0 && S && R && S.block[st] === R.id.powder_snow)) break;
        cy++;
      }
      return !!(W.canSeeSky && W.canSeeSky(x, cy - 1, z));
    },
    /** D-401 (session 39): `spider` (`bmo`) — its own 20-method class was read IN FULL for
     *  PASS 16 JOB 1's rostering work and declares no `checkMonsterSpawnRules`-shaped static
     *  override, so the base `Monster` rule applies exactly as it does for zombie/skeleton.
     *  This entry is MORE verified than skeleton's own above: skeleton's "no override" is a
     *  same-shape assumption (D-396 names it), spider's is a full read of the whole class. */
    spider: function (x, y, z, reason, rnd) {
      if (Diff.isPeaceful()) return false;
      if (!isDarkEnoughToSpawn(x, y, z, rnd)) return false;
      return checkMobSpawnRules(x, y, z, reason);
    },
    /** loop/creeper-s95 — `creeper` (`blp`, .decomp/net/minecraft/entity/mob/CreeperEntity.java,
     *  read in full): declares no `checkMonsterSpawnRules`-shaped override of its own and no
     *  `checkSpawnRules` override either (only `initGoals`/`tick`/`explode`/nbt/interact are
     *  overridden), so it is a direct `Monster` subclass using the base rule unchanged — same
     *  shape as zombie/skeleton/spider above. */
    creeper: function (x, y, z, reason, rnd) {
      if (Diff.isPeaceful()) return false;
      if (!isDarkEnoughToSpawn(x, y, z, rnd)) return false;
      return checkMobSpawnRules(x, y, z, reason);
    },
    /** loop/enderman-s98 -- `enderman` (`bmy`, .decomp/net/minecraft/entity/mob/EndermanEntity
     *  .java, read in full): declares no `checkMonsterSpawnRules`-shaped override and no
     *  `checkSpawnRules` override either (only `initGoals`/`mobTick`/`damage`/teleport/carried-
     *  block/nbt are overridden) -- same shape as zombie/skeleton/spider/creeper above, a direct
     *  `Monster` subclass using the base rule unchanged (real END-dimension-only placement
     *  quirks do not apply -- this engine has no End dimension, Spawn.OWED already names that
     *  gap generally). */
    enderman: function (x, y, z, reason, rnd) {
      if (Diff.isPeaceful()) return false;
      if (!isDarkEnoughToSpawn(x, y, z, rnd)) return false;
      return checkMobSpawnRules(x, y, z, reason);
    },
    /** loop/zombievariants-s100 (QUEUE 0.2 G18c) -- `DrownedEntity.canSpawn` (.decomp, read
     *  whole; a STATIC `SpawnRestriction` predicate, the SAME "does not chain through
     *  `checkMobSpawnRules`" shape `Spawn.RULES.squid`'s own header already names, not
     *  `Monster.checkMonsterSpawnRules`):
     *    - the block BELOW the position must be water (`getFluidState(pos.down())`);
     *    - `isSpawnDark` (== `isDarkEnoughToSpawn` below, the SAME function zombie/skeleton's
     *      own rules already share) AND (spawner reason, or the position ITSELF is water);
     *    - river/frozen_river biomes: `nextInt(15) == 0` and nothing else (rivers are always
     *      shallow); every OTHER biome: `nextInt(40) == 0` AND `y < seaLevel - 5`
     *      (`isValidSpawnDepth`).
     *  `BiomeKeys.field_9438`/`field_9463` = "river"/"frozen_river" (`.decomp/net/minecraft/
     *  world/biome/BiomeKeys.java`, read for the literal string, the SAME discipline
     *  `Spawn.RULES.polar_bear`'s own header already used for frozen_ocean/deep_frozen_ocean).
     */
    drowned: function (x, y, z, reason, rnd) {
      var W = NS.World, R = NS.Reg, S = NS.States, B = NS.Biomes;
      function isWaterAt(bx, by, bz) {
        var st = W.getBlock(bx, by, bz);
        return st > 0 && S && S.waterIn[st] === 1; // FluidTags.WATER: water, waterlogged, kelp, seagrass, bubble column
      }
      if (!isWaterAt(x, y - 1, z)) return false;
      if (Diff.isPeaceful()) return false;
      if (!isDarkEnoughToSpawn(x, y, z, rnd)) return false;
      if (reason !== 'spawner' && !isWaterAt(x, y, z)) return false;
      var name = null;
      if (B && B.ready) {
        var biome = B.at(W.biomeAt(Math.floor(x), Math.floor(z)));
        if (biome) name = biome.name;
      }
      if (name === 'minecraft:river' || name === 'minecraft:frozen_river') {
        return rnd(15) === 0;
      }
      if (rnd(40) !== 0) return false;
      return y < Spawn.SEA_LEVEL - 5;
    },
    // loop/slime-s97 (QUEUE 0.2 G18c) -- `SlimeEntity.canSpawn` (.decomp, read whole; a STATIC
    // `SpawnRestriction` predicate, not `Monster.checkMonsterSpawnRules` -- slime is the one
    // overworld hostile that does NOT use the zombie/skeleton/spider/creeper base rule above).
    // TWO independent branches, either one accepted:
    //   1. SWAMP, 50 < y < 70, nextFloat()<0.5, nextFloat()<world.getMoonSize() (full moon
    //      only ever clears it), light <= nextInt(8) -- the "swamp at night" spawn.
    //   2. a SLIME CHUNK (`ChunkRandom.getSlimeRandom`, the world-seed-keyed per-chunk formula,
    //      `Sl.isSlimeChunk`/`Sl.getSlimeRandom`, 07zd_slime.js), nextInt(10)==0, y < 40 -- the
    //      "slime chunk underground" spawn, reachable in ANY biome (`plains.json`'s own
    //      `entities/monster` list carries the identical `slime` weight-100 row swamp.json
    //      does; only swamp ALSO carries the extra weight-1 row this branch's own first half
    //      answers for -- both branches share this one rule, matching the jar's one method).
    // ⚠ `world instanceof StructureWorldAccess` (branch 2's own outer guard) is true for every
    // real placement attempt this engine ever makes (there is no other kind of world) -- named,
    // not modelled as a possible `false`, the same "trivially true engine-internal type check"
    // standing already applied to spider's `IronGolemEntity` target (07k_goals.js) before an
    // iron golem entity existed. `Sl.OWED` carries the two float rolls' own gap: this engine's
    // natural-spawn `rnd` is `Spawn.randInt` (an UNSEEDED `NS.EntityList.wr` wrapper, this file's own
    // header) with no `nextFloat`-shaped sibling to inject, so both rolls use `NS.EntityList.wr()`
    // directly rather than widen `rnd`'s own contract for two callers -- `slimecheck` forces
    // each roll's own branch by stubbing `NS.EntityList.wr`, the technique this file's own natural
    // spawner already has no seeded-determinism claim to preserve.
    slime: function (x, y, z, reason, rnd) {
      if (Diff.isPeaceful()) return false;   // SlimeEntity.canSpawn's own getDifficulty()!=PEACEFUL gate
      var W = NS.World, B = NS.Biomes, Sky = NS.Sky, EL = NS.EntityList;
      var isSwamp = false;
      if (B && B.ready) {
        try { isSwamp = B.name(W.biomeAt(x, z)) === 'minecraft:swamp'; } catch (e) { isSwamp = false; }
      }
      if (isSwamp && y > 50 && y < 70 && NS.EntityList.wr() < 0.5) {
        var moon = 0;
        if (Sky && Sky.moonPhase && Sky.dayTime !== undefined && EL && EL.MOON_SIZES) {
          moon = EL.MOON_SIZES[Sky.moonPhase(Sky.dayTime)];
        }
        if (NS.EntityList.wr() < moon) {
          // `World.getLightLevel(pos)` -- same `max(block, sky - darkness)` formula
          // `isDarkEnoughToSpawn`'s own `local` already computes (D-511), duplicated rather
          // than shared: that function's OTHER two gates (the `sky > rnd(32)` / `blk > 0` pair)
          // are `Monster.checkMonsterSpawnRules`'s own, not part of this bespoke rule at all.
          var L = W.getLight(x, y, z);
          var sky = (L >> 4) & 15, blk = L & 15;
          var dark = (Sky && Sky.darknessNow) ? (Sky.isThundering() ? 10 : Sky.darknessNow()) : 0;
          var local = Math.max(blk, sky - dark);
          if (local <= rnd(8)) return checkMobSpawnRules(x, y, z, reason);
        }
      }
      var Sl = NS.Slime;
      var slimeChunk = (Sl && Sl.isSlimeChunk) ? Sl.isSlimeChunk(x >> 4, z >> 4, W.seed64) : false;
      if (rnd(10) === 0 && slimeChunk && y < 40) return checkMobSpawnRules(x, y, z, reason);
      return false;
    }
  };

  // #1005 -- `MagmaCubeEntity.canMagmaCubeSpawn` = difficulty != PEACEFUL only (no light, no biome, no
  // floor test) and `canSpawn(WorldView)` = `!containsFluid(box)`: a magma cube never spawns in lava.
  /** `!world.containsFluid(box)` for a box of half-width hw, height h at the cell (x,y,z). */
  function boxFluidFree(x, y, z, hw, h) {
    var W = NS.World, R = NS.Reg;
    var x0 = x + 0.5 - hw, x1 = x + 0.5 + hw, z0 = z + 0.5 - hw, z1 = z + 0.5 + hw;
    for (var bx = Math.floor(x0); bx <= Math.floor(x1 - 1e-7); bx++)
      for (var by = Math.floor(y); by <= Math.floor(y + h - 1e-7); by++)
        for (var bz = Math.floor(z0); bz <= Math.floor(z1 - 1e-7); bz++) {
          var nm = R.names[NS.States.block[W.getBlock(bx, by, bz)]];
          if (nm === 'water' || nm === 'lava' || nm === 'bubble_column') return false;
        }
    return true;
  }
  Spawn.RULES.magma_cube = function (x, y, z) {
    if (Diff.isPeaceful()) return false;
    var dim = NS.Entities.dimensions('magma_cube');
    return boxFluidFree(x, y, z, dim ? dim.width * 0.255 * 0.5 : 0.255, dim ? dim.height * 0.255 : 0.52);   // size-1 box (0.255F * size)
  };
  /** #3898 -- `RavagerEntity.canSpawn(WorldView)` = `!containsFluid(box)`; no SpawnRestriction otherwise. */
  Spawn.RULES.ravager = function (x, y, z, reason, rnd) {
    if (!Spawn.RULES.skeleton(x, y, z, reason, rnd)) return false;   // #5124: HostileEntity.canSpawnInDark
    var dim = NS.Entities.dimensions('ravager');
    return boxFluidFree(x, y, z, dim ? dim.width * 0.5 : 0.975, dim ? dim.height : 2.2);
  };

  // QUEUE 0.2 (G18c): sheep/chicken/pig share cow's own function object (see the
  // `sheep: null, chicken: null, pig: null,` placeholder above, in the same rule shape).
  /** `PatrolEntity.canSpawn` (PatrolEntity.java:93-95): BLOCK light > 8 refuses, then
   *  `canSpawnIgnoreLightLevel` = not peaceful + checkMobSpawnRules. */
  Spawn.RULES.pillager = function (x, y, z, reason) {
    if ((NS.World.getLight(x, y, z) & 15) > 8) return false;
    if (Diff.isPeaceful()) return false;
    return checkMobSpawnRules(x, y, z, reason);
  };
  /** #5124 (G18c-V1): javap of SpawnRestriction.<clinit> (tools/golden/spawn-predicates-1.18.2.tsv) -- vindicator,
   *  evoker, illusioner, vex and giant register HostileEntity.canSpawnInDark (same rule as zombie/skeleton),
   *  trader_llama registers AnimalEntity.isValidNaturalSpawn (cow's rule); an earlier "NO SpawnRestriction
   *  entry" claim here was wrong. Only shulker/phantom/wandering_trader use MobEntity.canMobSpawn (the
   *  block-below check), approximated by true here. */
  Spawn.RULES.vindicator = Spawn.RULES.evoker = Spawn.RULES.illusioner =
    Spawn.RULES.vex = Spawn.RULES.giant = Spawn.RULES.skeleton;
  Spawn.RULES.trader_llama = Spawn.RULES.cow;
  Spawn.RULES.shulker = Spawn.RULES.phantom = Spawn.RULES.wandering_trader = function () { return true; };
  Spawn.RULES.sheep = Spawn.RULES.chicken = Spawn.RULES.pig = Spawn.RULES.cow;
  /** #1290: wither_skeleton registers HostileEntity::canSpawnInDark (SpawnRestriction), the same rule skeleton uses. */
  Spawn.RULES.wither_skeleton = Spawn.RULES.skeleton;

  /** loop/rabbit-s98 (QUEUE 0.2 G18c) -- `RabbitEntity.canSpawn`/`AnimalEntity.isValidNaturalSpawn`
   *  (.decomp, read in full): the block below must carry `#minecraft:rabbits_spawnable_on`
   *  (grass_block/snow/snow_block/sand -- the jar's own tag file, not re-typed here) AND
   *  `isLightLevelValidForNaturalSpawn` -- `getBaseLightLevel(pos,0) > 8`, the SAME formula
   *  `Animal.isBrightEnoughToSpawn` already implements above (both read the jar's identical
   *  one-liner; `isBrightEnoughToSpawn` is reused rather than duplicated). */
  Spawn.RULES.rabbit = function (x, y, z) {
    var W = NS.World;
    var below = W.getBlock(x, y - 1, z);
    if (below === 0) return false;
    if (!W.tagBelow('rabbits_spawnable_on', below)) return false;
    return isBrightEnoughToSpawn(x, y, z);
  };

  /** loop/fox-s99 (QUEUE 0.2 G18c) -- `FoxEntity.canSpawn` (.decomp, read in full) VERBATIM,
   *  the SAME two-part shape rabbit's own rule above already uses: the block below must
   *  carry `#minecraft:foxes_spawnable_on` (`BlockTags.field_35574`) AND
   *  `isLightLevelValidForNaturalSpawn` -- `AnimalEntity`'s own static method, the identical
   *  one rabbit's own `canSpawn` already calls (`isBrightEnoughToSpawn` below). Taiga/grove/
   *  snowy is where vanilla's BIOME SPAWN LISTS place fox -- `canSpawn` itself carries no
   *  biome test at all (07zj_fox.js's own header names this the same standing gap rabbit's
   *  header already found). */
  Spawn.RULES.fox = function (x, y, z) {
    var W = NS.World;
    var below = W.getBlock(x, y - 1, z);
    if (below === 0) return false;
    if (!W.tagBelow('foxes_spawnable_on', below)) return false;
    return isBrightEnoughToSpawn(x, y, z);
  };

  /** loop/goat-s99 (QUEUE 0.2 G18c) -- `GoatEntity.canSpawn`/`AnimalEntity.isValidNaturalSpawn`
   *  (.decomp, read in full): the block below must carry `#minecraft:goats_spawnable_on`
   *  (`BlockTags.field_35569` -- snowy slopes/jagged peaks/frozen peaks' own terrain blocks,
   *  the jar's own tag file, not re-typed here) AND `isLightLevelValidForNaturalSpawn` -- the
   *  SAME `getBaseLightLevel(pos,0) > 8` formula `Spawn.RULES.rabbit` just above already
   *  implements as `isBrightEnoughToSpawn` (reused, not duplicated) -- `Gt.SPAWNABLE_ON_TAG`
   *  (07zj_goat.js) names the tag rather than a second literal copy of it.
   */
  Spawn.RULES.goat = function (x, y, z) {
    var W = NS.World, Gt = NS.Goat;
    var below = W.getBlock(x, y - 1, z);
    if (below === 0) return false;
    if (!W.tagBelow((Gt && Gt.SPAWNABLE_ON_TAG) || 'goats_spawnable_on', below)) return false;
    return isBrightEnoughToSpawn(x, y, z);
  };

  /** loop/panda-axolotl-s101 (QUEUE 0.2 G18c) -- `PandaEntity` declares no `canSpawn` override
   *  of its own (`.decomp`, read in full this pass -- grepped for the method, none present):
   *  it falls straight through to `AnimalEntity.isValidNaturalSpawn`, the SAME
   *  `#minecraft:animals_spawnable_on` + light rule `cow`'s own rule already implements.
   *  `Spawn.RULES.panda` is that SAME function object, shared -- the identical precedent
   *  `Spawn.RULES.sheep = Spawn.RULES.chicken = Spawn.RULES.pig = Spawn.RULES.cow` already
   *  sets a few lines up this file. Which biome even offers a panda (bamboo_jungle/jungle) is
   *  that biome's own spawner-list weight, read generically off `assets/` the same way every
   *  other rostered animal's biome placement already is. */
  Spawn.RULES.panda = Spawn.RULES.cow;
  /** #5843: SpawnRestriction.java:128 registers CAT as ON_GROUND + AnimalEntity::isValidNaturalSpawn,
   *  the SAME rule as cow (CatEntity has no canSpawn override), shared as panda is. */
  Spawn.RULES.cat = Spawn.RULES.cow;

  /** loop/panda-axolotl-s101 (QUEUE 0.2 G18c) -- `AxolotlEntity.canSpawn(EntityType,
   *  ServerWorldAccess, SpawnReason, BlockPos, Random)` (.decomp, the STATIC overload
   *  `SpawnRestriction.register` actually calls, read in full): the block below must carry
   *  `#minecraft:axolotls_spawnable_on` (`BlockTags.field_35568`, `.decomp/net/minecraft/tag/
   *  BlockTags.java:131`) -- ⚠ AND NOTHING ELSE. Unlike every other animal's `canSpawn` rule in
   *  this file, there is NO `isLightLevelValidForNaturalSpawn` call anywhere in this method
   *  (read the jar's own one-line body literally: lush caves is dark and axolotls spawn there
   *  regardless). The INSTANCE-side `canSpawn(WorldView)` override (`doesNotIntersectEntities`)
   *  is a generic no-entity-overlap check every placement attempt already gets for free
   *  (`Spawn.canPlace`'s own caller, this file's header) and is not re-checked here. */
  Spawn.RULES.axolotl = function (x, y, z) {
    var W = NS.World;
    var below = W.getBlock(x, y - 1, z);
    if (below === 0) return false;
    return !!W.tagBelow('axolotls_spawnable_on', below);
  };

  /** loop/turtle-s102 (QUEUE 0.2 G18 mobs) -- `TurtleEntity.canSpawn(EntityType,
   *  WorldAccess, SpawnReason, BlockPos, Random)` (.decomp, static overload, read in full):
   *  `pos.getY() < world.getSeaLevel() + 4 && TurtleEggBlock.isSandBelow(world, pos) &&
   *  isLightLevelValidForNaturalSpawn(world, pos)`, verbatim. `TurtleEggBlock.isSandBelow`
   *  has no decompiled class body in this worktree (`.decomp/names.tsv`'s own TurtleEggBlock
   *  rows only) -- read as `#minecraft:sand` off `W.tagBelow('sand', ...)`, the SAME tag
   *  07_world.js's own beach-detection already reads, rather than guessed (07zp_turtle.js's
   *  own header names this the one fact it borrows live). */
  Spawn.RULES.turtle = function (x, y, z) {
    var W = NS.World;
    if (y >= Spawn.SEA_LEVEL + 4) return false;
    var below = W.getBlock(x, y - 1, z);
    if (below === 0) return false;
    if (!W.tagBelow('sand', below)) return false;
    return isBrightEnoughToSpawn(x, y, z);
  };

  /** D-533 (G18c) -- `BatEntity.canSpawn` (.decomp BatEntity.java:193-207, `Bat.lightRule`,
   *  07zf_bat.js) then `MobEntity.canMobSpawn` (= this file's checkMobSpawnRules). The light is
   *  `WorldView.getLightLevel(pos)` -- max(block, sky - ambientDarkness), the same value
   *  isDarkEnoughToSpawn computes below. The halloween window reads the REAL date, as vanilla. */
  Spawn.RULES.bat = function (x, y, z, reason, rnd) {
    var W = NS.World, S = NS.Sky, Bt = NS.Bat;
    if (!Bt) return false;
    var L = W.getLight(x, y, z);
    var sky = (L >> 4) & 15, blk = L & 15;
    var dark = (S && S.darknessNow) ? S.darknessNow() : 0;
    var light = Math.max(blk, sky - dark);
    if (!Bt.lightRule(y, light, Spawn.SEA_LEVEL, rnd, Bt.isHalloween())) return false;
    return checkMobSpawnRules(x, y, z, reason);
  };
  Spawn.SEA_LEVEL = 63;   // NoiseGeneratorSettings overworld seaLevel (04_worldgen.js's own 63)

  /** loop/squid-s98 (QUEUE 0.2 G18c) -- `WaterCreatureEntity.canSpawn` (`Sq.canSpawn`,
   *  07zi_squid.js) VERBATIM, and ONLY that -- unlike `BatEntity.canSpawn` (whose own body
   *  ends by calling `MobEntity.canMobSpawn`, which is why `Spawn.RULES.bat` above chains
   *  `checkMobSpawnRules` on), `WaterCreatureEntity.canSpawn`'s own body (.decomp, read whole)
   *  never calls it at all: no solid-ground requirement, by design -- a squid spawns freely
   *  inside an open water column.
   */
  Spawn.RULES.squid = function (x, y, z, _reason, _rnd) {
    return !!(NS.Squid && NS.Squid.canSpawn(x, y, z, Spawn.SEA_LEVEL));
  };
  /** `GuardianEntity.canSpawn` (.decomp GuardianEntity.java:323-328): (nextInt(20)==0 || !isSkyVisibleAllowingSea(pos))
   *  && difficulty != PEACEFUL && (SPAWNER || fluid(pos) is water) && fluid(pos.down()) is water. Reached only through
   *  the ocean monument's `spawn_overrides.monster` (Structures.spawnOverride; no biome lists a guardian). */
  function skyVisibleAllowingSea(x, y, z) {
    var W = NS.World, S = NS.States, R = NS.Reg, sea = Spawn.SEA_LEVEL;
    if (y >= sea) return !!W.canSeeSky(x, y, z);
    if (!W.canSeeSky(x, sea, z)) return false;
    for (var yy = sea - 1; yy > y; yy--) {                // WorldView.isSkyVisibleAllowingSea :94-99
      var st = W.getBlock(x, yy, z), b = S.block[st];
      if (st > 0 && S.atten[st] > 0 && b !== R.id.water && b !== R.id.lava) return false;
    }
    return true;
  }
  Spawn.RULES.guardian = function (x, y, z, reason, rnd) {
    var W = NS.World, S = NS.States;
    var up = W.getBlock(x, y, z), dn = W.getBlock(x, y - 1, z);
    return (rnd(20) === 0 || !skyVisibleAllowingSea(x, y, z)) && !Diff.isPeaceful() &&
      (reason === 'spawner' || (up > 0 && S.waterIn[up] === 1)) && dn > 0 && S.waterIn[dn] === 1;
  };
  /** `GlowSquidEntity.canSpawn` (`Sq.glowCanSpawn`) -- NO `canMobSpawn` tail: the jar's own
   *  static method (unlike `squid`'s, which chains through `WaterCreatureEntity.canSpawn` then
   *  `SpawnRestriction.canSpawn`'s shared `Mob.checkMobSpawnRules`) is registered ALONE and is
   *  everything `SpawnRestriction.canSpawn` calls for this type. */
  Spawn.RULES.glow_squid = function (x, y, z) {
    return !!(NS.Squid && NS.Squid.glowCanSpawn(x, y, z, Spawn.SEA_LEVEL));
  };

  /** Dan's scheduled parallel night, QUEUE 0.2 (G18c) -- `PolarBearEntity.canSpawn` (.decomp,
   *  read in full; 07zj_polarbear.js's own header names the two exact literals below). Two
   *  BlockTags (`.decomp/net/minecraft/tag/BlockTags.java`, read for the literal STRING each
   *  field registers, not just its obfuscated name): `field_35567` = "animals_spawnable_on"
   *  (the generic `AnimalEntity.isValidNaturalSpawn` tag every other animal rule already reads
   *  via `W.tagBelow`) and `field_35572` = "polar_bears_spawnable_on_in_frozen_ocean" (this
   *  mob's own special-case tag, checked ONLY inside the two frozen-ocean biomes). Two
   *  BiomeKeys (`.decomp/net/minecraft/world/biome/BiomeKeys.java`, same read): `field_9435` =
   *  "frozen_ocean", `field_9418` = "deep_frozen_ocean" -- NOT frozen_river, see
   *  07zj_polarbear.js's own header for why that distinction is called out by name. Both
   *  branches share `isLightLevelValidForNaturalSpawn`/`Animal.isBrightEnoughToSpawn`'s own
   *  identical `> 8` formula, the SAME `isBrightEnoughToSpawn` helper rabbit's own rule above
   *  already reuses rather than re-typing a third `> 8` literal. */
  /** s101 -- `MooshroomEntity.canSpawn` (.decomp) verbatim: the block below carries
   *  `#mooshrooms_spawnable_on` (BlockTags.field_35570) and the animal light rule. */
  Spawn.RULES.mooshroom = function (x, y, z) {
    var W = NS.World;
    var below = W.getBlock(x, y - 1, z);
    if (below === 0) return false;
    if (!W.tagBelow('mooshrooms_spawnable_on', below)) return false;
    return isBrightEnoughToSpawn(x, y, z);
  };
  Spawn.RULES.polar_bear = function (x, y, z) {
    var W = NS.World, B = NS.Biomes;
    var below = W.getBlock(x, y - 1, z);
    if (below === 0) return false;
    var name = null;
    if (B && B.ready) {
      var biome = B.at(W.biomeAt(Math.floor(x), Math.floor(z)));
      if (biome) name = biome.name;
    }
    if (name === 'frozen_ocean' || name === 'deep_frozen_ocean') {
      if (!isBrightEnoughToSpawn(x, y, z)) return false;
      return !!W.tagBelow('polar_bears_spawnable_on_in_frozen_ocean', below);
    }
    if (!W.tagBelow('animals_spawnable_on', below)) return false;
    return isBrightEnoughToSpawn(x, y, z);
  };

  /** loop/fish-s99 (QUEUE 0.2 G18c) -- `WaterCreatureEntity.canSpawn` (`Fish.canSpawn`,
   *  07zj_fish.js) verbatim, the SAME body `Sq.canSpawn`/`Spawn.RULES.squid` immediately above
   *  already use off the shared superclass -- cod/salmon/pufferfish do not override it.
   */
  Spawn.RULES.cod = function (x, y, z, _reason, _rnd) {
    return !!(NS.Fish && NS.Fish.canSpawn(x, y, z, Spawn.SEA_LEVEL));
  };
  Spawn.RULES.salmon = function (x, y, z, _reason, _rnd) {
    return !!(NS.Fish && NS.Fish.canSpawn(x, y, z, Spawn.SEA_LEVEL));
  };
  Spawn.RULES.pufferfish = function (x, y, z, _reason, _rnd) {
    return !!(NS.Fish && NS.Fish.canSpawn(x, y, z, Spawn.SEA_LEVEL));
  };
  /** `TropicalFishEntity.canTropicalFishSpawn` (`Fish.tropicalCanSpawn`) -- registered ALONE,
   *  same standing as `glow_squid`'s own row above (no `canMobSpawn` tail either). */
  Spawn.RULES.tropical_fish = function (x, y, z, _reason, _rnd) {
    return !!(NS.Fish && NS.Fish.tropicalCanSpawn(x, y, z, Spawn.SEA_LEVEL));
  };

  /** loop/spawnsweep-s104 (QUEUE 0.2 G18c) -- `HorseEntity` declares no `canSpawn` override of
   *  its own, and neither does its abstract parent `HorseBaseEntity` (.decomp, both read whole,
   *  no such method present) -- it falls straight through to `AnimalEntity.isValidNaturalSpawn`,
   *  the SAME `#minecraft:animals_spawnable_on` + light rule `cow`'s own rule already implements
   *  (.decomp/net/minecraft/entity/passive/AnimalEntity.java:107-109). Shared function object,
   *  the same precedent `Spawn.RULES.panda = Spawn.RULES.cow` already sets. */
  Spawn.RULES.horse = Spawn.RULES.cow;
  Spawn.RULES.donkey = Spawn.RULES.cow;
  Spawn.RULES.llama = Spawn.RULES.cow;

  /** #645 -- `GhastEntity.canSpawn` (.decomp GhastEntity.java:115-117): `difficulty != PEACEFUL &&
   *  random.nextInt(20) == 0 && MobEntity.canMobSpawn` -- a bare 1-in-20 roll ahead of the
   *  generic tail (`checkMobSpawnRules`, the same `canMobSpawn` every rule here chains to). The
   *  roll is drawn only after the difficulty gate, matching the Java short-circuit order. */
  Spawn.RULES.ghast = function (x, y, z, reason, rnd) {
    if (Diff.isPeaceful()) return false;
    if (rnd(20) !== 0) return false;
    return checkMobSpawnRules(x, y, z, reason);
  };

  /** #1223 -- `ZombifiedPiglinEntity.canSpawn(EntityType, WorldAccess, SpawnReason, BlockPos, Random)`
   *  (.decomp): `difficulty != PEACEFUL && !getBlockState(pos.down()).isOf(NETHER_WART_BLOCK)` --
   *  the whole static body, no `canMobSpawn` tail. Registering it is what lets the nether biomes'
   *  own `spawners` rows (nether_wastes 100 / crimson_forest 1) place packs naturally. */
  Spawn.RULES.zombified_piglin = function (x, y, z) {
    if (Diff.isPeaceful()) return false;
    var st = NS.World.getBlock(x, y - 1, z);
    return NS.States.block[st] !== NS.Reg.id.nether_wart_block;
  };

  /** #2008 -- `PiglinEntity.canSpawn` (.decomp): `!getBlockState(pos.down()).isOf(NETHER_WART_BLOCK)`,
   *  the whole body -- no difficulty gate (unlike the zombified piglin) and no `canMobSpawn` tail. */
  Spawn.RULES.piglin = function (x, y, z) {
    return NS.States.block[NS.World.getBlock(x, y - 1, z)] !== NS.Reg.id.nether_wart_block;
  };

  /** #2753 -- `HoglinEntity.canSpawn` (.decomp): same whole body as `PiglinEntity.canSpawn`. */
  Spawn.RULES.hoglin = Spawn.RULES.piglin;

  /** #931 -- `StriderEntity.canSpawn` (.decomp StriderEntity.java:94-102): walk up from the cell
   *  while the fluid there is lava, then that cell's block must be air. No `canMobSpawn` tail
   *  (the jar's static rule is the whole body); the in_lava location half is `Spawn.locationOk`. */
  Spawn.RULES.strider = function (x, y, z) {
    var W = NS.World, S = NS.States, R = NS.Reg, top = NS.CFG.WORLD_MAX_Y, st;
    do { y++; st = W.getBlock(x, y, z); } while (y < top && st > 0 && S.block[st] === R.id.lava);
    return st === 0 || S.block[st] === R.id.cave_air;
  };

  /** loop/spawnsweep-s104 (QUEUE 0.2 G18c) -- `OcelotEntity.canSpawn(EntityType, WorldAccess,
   *  SpawnReason, BlockPos, Random)` (.decomp/net/minecraft/entity/passive/OcelotEntity.java:
   *  242-244, the STATIC overload `SpawnRestriction.register` calls, read in full): the ENTIRE
   *  body is `random.nextInt(3) != 0` -- a bare 2-in-3 chance, no ground/light test at all (the
   *  INSTANCE-side `canSpawn(WorldView)` a few lines below it, sea-level/leaf-litter and all, is
   *  the generic no-overlap check `Spawn.canPlace`'s own caller already gets for free, the same
   *  standing `axolotl`'s own header above already names for its own instance-side override). */
  Spawn.RULES.ocelot = function (x, y, z, _reason, rnd) {
    return rnd(3) !== 0;
  };

  /** loop/spawnsweep-s104 (QUEUE 0.2 G18c) -- `ParrotEntity.canSpawn` (.decomp/net/minecraft/
   *  entity/passive/ParrotEntity.java:302-304, static overload, read in full): the block below
   *  must carry `#minecraft:parrots_spawnable_on` (`BlockTags.field_35571`, .decomp/net/
   *  minecraft/tag/BlockTags.java:134 -- read for the literal STRING, not just the obfuscated
   *  field) AND `isLightLevelValidForNaturalSpawn` -- the SAME `getBaseLightLevel(pos,0) > 8`
   *  formula `isBrightEnoughToSpawn` below already implements (AnimalEntity.java:111-113,
   *  verified identical body), reused rather than duplicated. */
  Spawn.RULES.parrot = function (x, y, z) {
    var W = NS.World;
    var below = W.getBlock(x, y - 1, z);
    if (below === 0) return false;
    if (!W.tagBelow('parrots_spawnable_on', below)) return false;
    return isBrightEnoughToSpawn(x, y, z);
  };

  /** loop/spawnsweep-s104 (QUEUE 0.2 G18c) -- `WolfEntity.canSpawn` (.decomp/net/minecraft/
   *  entity/passive/WolfEntity.java:524-526, static overload, read in full): the block below
   *  must carry `#minecraft:wolves_spawnable_on` (`BlockTags.field_35575`, .decomp/net/
   *  minecraft/tag/BlockTags.java:138, literal string read) AND `isLightLevelValidForNaturalSpawn`
   *  -- same formula/reuse as `parrot`'s own rule immediately above. */
  Spawn.RULES.wolf = function (x, y, z) {
    var W = NS.World;
    var below = W.getBlock(x, y - 1, z);
    if (below === 0) return false;
    if (!W.tagBelow('wolves_spawnable_on', below)) return false;
    return isBrightEnoughToSpawn(x, y, z);
  };

  /** loop/spawnsweep-s104 (QUEUE 0.2 G18c) -- `WitchEntity` declares no `canSpawn`-shaped
   *  override of its own, and neither does its parent `RaiderEntity` (.decomp/net/minecraft/
   *  entity/mob/WitchEntity.java and the RaiderEntity rows in `.decomp/names.tsv` -- grepped in
   *  full, no `canSpawn`/`canSpawnInDark`-shaped method present on either class; RaiderEntity
   *  itself is not decompiled in this worktree, the same standing gap D-396 already names for
   *  skeleton's own "no override" claim, not bytecode-verified with the same confidence a full
   *  class read would give). It is a direct `HostileEntity` subclass, so `SpawnRestriction`
   *  registers it with `HostileEntity::canSpawnInDark` (.decomp/net/minecraft/entity/mob/
   *  HostileEntity.java:97-99) -- the SAME peaceful-gate + `isDarkEnoughToSpawn` +
   *  `checkMobSpawnRules` shape zombie/skeleton/spider/creeper/enderman's own rules above
   *  already implement, verbatim. */
  Spawn.RULES.witch = function (x, y, z, reason, rnd) {
    if (Diff.isPeaceful()) return false;
    if (!isDarkEnoughToSpawn(x, y, z, rnd)) return false;
    return checkMobSpawnRules(x, y, z, reason);
  };

  /** #1181 -- `SilverfishEntity.canSpawn` / `EndermiteEntity.canSpawn` (.decomp/net/minecraft/
   *  entity/mob/SilverfishEntity.java:128-135, EndermiteEntity.java:145-152, read in full):
   *  `canSpawnIgnoreLightLevel` (peaceful gate + `checkMobSpawnRules`, NO darkness test) and
   *  `getClosestPlayer(x+.5, y+.5, z+.5, 5.0, true) == null` (ignoreCreative: a creative or
   *  spectator player does not block). A spawner reaches this too (`checkMobSpawnRules` is true
   *  for a spawner, but the 5-block player exclusion still applies, exactly as vanilla). */
  function noPlayerWithin5(x, y, z) {
    var P = NS.Player;
    if (!P || typeof P.x !== 'number') return true;
    var Gm = NS.Gamemode;
    if (Gm && (P.mode === Gm.CREATIVE || P.mode === Gm.SPECTATOR)) return true;
    var dx = P.x - (x + 0.5), dy = P.y - (y + 0.5), dz = P.z - (z + 0.5);
    return dx * dx + dy * dy + dz * dz >= 25;
  }
  /** #1958 -- blaze registers HostileEntity::canSpawnIgnoreLightLevel (SpawnRestriction.java:81, EntityType.field_6099):
   *  peaceful gate + checkMobSpawnRules, no darkness test (fortress spawns are structure-driven). */
  Spawn.RULES.blaze = function (x, y, z, reason) {
    if (Diff.isPeaceful()) return false;
    return checkMobSpawnRules(x, y, z, reason);
  };
  Spawn.RULES.silverfish = Spawn.RULES.endermite = function (x, y, z, reason) {
    if (Diff.isPeaceful()) return false;
    if (!checkMobSpawnRules(x, y, z, reason)) return false;
    return noPlayerWithin5(x, y, z);
  };

  /** loop/spawnsweep-s104 (QUEUE 0.2 G18c) -- `DolphinEntity` declares no `canSpawn` override of
   *  its own (.decomp/net/minecraft/entity/passive/DolphinEntity.java, read in full -- grepped
   *  for the method, none present): it is a direct `WaterCreatureEntity` subclass (unlike squid,
   *  which ALSO gets this rule but is registered with it as its own type's rule too), so the
   *  SAME static `WaterCreatureEntity.canSpawn` (.decomp/net/minecraft/entity/mob/
   *  WaterCreatureEntity.java:77-83: seaLevel-13 <= y <= seaLevel, fluid below is water, block
   *  above is the water block) that `Spawn.RULES.squid` above already ports (`NS.Squid.canSpawn`,
   *  07zi_squid.js's own `Sq.canSpawn`) applies here verbatim -- same function, shared, not
   *  retyped a second time. */
  Spawn.RULES.dolphin = function (x, y, z, _reason, _rnd) {
    return !!(NS.Squid && NS.Squid.canSpawn(x, y, z, Spawn.SEA_LEVEL));
  };

  /** `Animal.isBrightEnoughToSpawn` — `bid.a`: `getRawBrightness(pos, 0) > 8`. */
  function isBrightEnoughToSpawn(x, y, z) {
    return NS.World.rawBrightness(x, y, z) > 8;
  }

  /** `Monster.isDarkEnoughToSpawn` — `bmd.a`, overworld shape (no dimension ceiling here). */
  function isDarkEnoughToSpawn(x, y, z, rnd) {
    var W = NS.World;
    var L = W.getLight(x, y, z);
    var sky = (L >> 4) & 15, blk = L & 15;
    if (sky > rnd(32)) return false;
    if (blk > 0) return false;
    // `world.getLightLevel(pos)` = `getBaseLightLevel(pos, ambientDarkness)` = max(block,
    // sky - darkness) (LightingProvider.getLight); under thunder the darkness is a flat 10
    // (HostileEntity.isSpawnDark, .decomp HostileEntity.java:86-94). D-511: this used to read
    // the RAW stored light, so open sky at midnight was 15 and no monster ever spawned on the
    // surface at night.
    var S = NS.Sky;
    var dark = (S && S.darknessNow) ? (S.isThundering() ? 10 : S.darknessNow()) : 0;
    var local = Math.max(blk, sky - dark);
    return local <= rnd(8);
  }

  /** `Mob.checkMobSpawnRules` — `aya.a`: reason is SPAWNER, or the ground below
   *  `AbstractBlockState.allowsSpawning` (`BlockBehaviour.java:409`, `.decomp/net/minecraft/
   *  block/AbstractBlock.java`). The default predicate (no override) is
   *  `isSideSolidFullSquare(UP)` — a solid top face, `B.faceSturdy(below, 1)`, this file's own
   *  prior approximation, unchanged as the FLOOR. loop/spawn-cap now also reads
   *  `.decomp/net/minecraft/block/Blocks.java`'s own per-block `.allowsSpawning(...)`
   *  overrides for every block id this engine actually registers, SCOPED to the mob types
   *  this file's own header already closes the set to (`EL.spawnable()`/`Spawn.RULES`):
   *    - glass/tinted_glass/stained-glass (Blocks.java:243 `.allowsSpawning(Blocks::never)`,
   *      :3186 tinted_glass same, `createStainedGlassBlock` same) — ALWAYS false, no mob
   *      this engine simulates is exempted (there is no exemption in the jar at all: the
   *      predicate is the literal `never`, not type-gated).
   *    - ice/frosted_ice (Blocks.java:765/1970 `$$3 == EntityType.field_6042`) and
   *      magma_block (Blocks.java:1981 `$$3.isFireImmune()`) — field_6042 is
   *      `PolarBearEntity` (`.decomp/net/minecraft/entity/EntityType.java:435`); ALWAYS
   *      false here because this engine simulates no polar bear and no fire-immune mob
   *      (`EL.spawnable()`, D-307/D-390's closed motion set) — named as a scope limit, not
   *      claimed as the general rule.
   *    - leaves (oak/birch/spruce — `Blocks.java:3508 createLeavesBlock` ->
   *      `canSpawnOnLeaves`, `Blocks.java:3453`: `$$3 == EntityType.field_6081 ||
   *      $$3 == EntityType.field_6104` = ocelot/parrot ONLY) — ALWAYS false here because
   *      neither `Spawn.RULES.ocelot` (a bare `nextInt(3)` roll, no ground test at all) nor
   *      `Spawn.RULES.parrot` (its own `parrots_spawnable_on` tag test) ever CALLS this
   *      function — every type that does reach `checkMobSpawnRules` (zombie/husk/skeleton/
   *      stray/spider/creeper/enderman/witch/bat) is refused on leaves in the jar too, so
   *      "always false" is exact for the closed set, not an approximation of a type check
   *      this file skipped — `Spawn.OWED` still names this as the one place a FUTURE mob
   *      would need this function widened to take a type argument. */
  Spawn.NO_SPAWN_BLOCKS = {
    glass: 1, tinted_glass: 1, ice: 1, frosted_ice: 1, magma_block: 1,
    oak_leaves: 1, birch_leaves: 1, spruce_leaves: 1
  };
  function checkMobSpawnRules(x, y, z, reason) {
    if (reason === 'spawner') return true;
    var W = NS.World, B = NS.Behave, S = NS.States, R = NS.Reg;
    var below = W.getBlock(x, y - 1, z);
    if (below === 0) return false;
    var nm = (S && R) ? R.names[S.block[below]] : null;
    if (nm && (Spawn.NO_SPAWN_BLOCKS[nm] === 1 || nm.slice(-14) === '_stained_glass')) return false;
    return !!(B && B.faceSturdy && B.faceSturdy(below, 1));
  }

  var RANDOM_Y_CATEGORY = { monster: 1, underground_water_creature: 1, ambient: 1, water_creature: 1,
    water_ambient: 1, axolotls: 1 };
  Spawn.RANDOM_Y_CATEGORY = RANDOM_Y_CATEGORY;

  /** Can this engine even evaluate a placement rule for `type`? Mirrors `EL.canSpawn`. */
  Spawn.canPlace = function (type) { return !!Spawn.RULES[NS.Entities.bare(type)]; };

  /**
   * checkPlacement(type, x, y, z, reason, rnd) — the closed-set dispatcher. `rnd` is an
   * injection point (D-333's own reasoning: a check that wants to force the dark-cave boundary
   * cannot do it against `NS.EntityList.wr`), defaulting to it when the caller passes none.
   */
  Spawn.checkPlacement = function (type, x, y, z, reason, rnd) {
    var f = Spawn.RULES[NS.Entities.bare(type)];
    if (!f) return false;
    // D-488: `SpawnHelper.canSpawn(ON_GROUND, …)` + `world.isSpaceEmpty(type box)` come FIRST in
    // vanilla's `SpawnHelper.canSpawn(world, group, …, pos, sqDist)`, before the per-type rule. This
    // engine had only the per-type rule, and a dark cell inside solid stone with stone under it
    // passes that: ~60 zombies/skeletons/spiders a minute were born inside rock and suffocated,
    // dropping ~5 item entities a second into every world.
    // cloud owed-spawn-owed: the clearance half is `SpawnHelper.canSpawn(Location, …)` with the
    // type's OWN `SpawnRestriction` location (Spawn.LOCATION), no longer ON_GROUND for every type
    // -- ON_GROUND refuses a water cell, so no axolotl/squid/fish/dolphin/drowned/guardian could
    // ever be placed naturally. Vanilla's order: location, then the per-type rule, then
    // `isSpaceEmpty`. A SPAWNER asks no location at all (`MobSpawnerLogic.serverTick`:
    // `isSpaceEmpty` + `SpawnRestriction.canSpawn` only, .decomp MobSpawnerLogic.java:97/109).
    reason = reason || 'natural';
    var bare = NS.Entities.bare(type);
    if (Spawn.CLEAR_CHECK && reason !== 'spawner' && !Spawn.locationOk(Spawn.locationOf(bare), x, y, z)) return false;
    // #1161: the ON_GROUND floor half (`below.allowsSpawning(world, below, type)`, SpawnHelper.java:
    // 312-313) belongs to the LOCATION, not to each type's rule -- a rule with no floor test of its
    // own (ocelot's bare `nextInt(3) != 0`) was placed over open water / in mid-air.
    if (Spawn.CLEAR_CHECK && reason !== 'spawner' && Spawn.locationOf(bare) === 'on_ground' && !Spawn.floorAllows(bare, x, y, z)) return false;
    if (!f(x, y, z, reason, rnd || Spawn.randInt)) return false;
    if (bare === 'ocelot' && !Spawn.ocelotInstanceOk(x, y, z)) return false;
    return !Spawn.CLEAR_CHECK || Spawn.spaceEmpty(type, x, y, z);
  };

  /** #1608 -- `OcelotEntity.canSpawn(WorldView)` (.decomp OcelotEntity.java:247-261), the INSTANCE
   *  overload `MobEntity.canSpawn(world, reason)` runs on every spawn (natural, spawner): no fluid in
   *  the box (approximated by the cell and the one above), y >= sea level, and the block below is
   *  grass_block or in #leaves. The no-entity-overlap half is `Spawn.spaceEmpty`. */
  Spawn.ocelotInstanceOk = function (x, y, z) {
    var W = NS.World, S = NS.States, R = NS.Reg;
    if (y < Spawn.SEA_LEVEL) return false;
    var a = W.getBlock(x, y, z), b = W.getBlock(x, y + 1, z);
    if ((a > 0 && (S.waterIn[a] || S.block[a] === R.id.lava)) || (b > 0 && (S.waterIn[b] || S.block[b] === R.id.lava))) return false;
    var below = W.getBlock(x, y - 1, z);
    if (below === 0) return false;
    var nm = R.names[S.block[below]];
    return nm === 'grass_block' || /_leaves$/.test(nm);
  };

  /** `BlockState.allowsSpawning(world, below, type)` for the cell under (x, y, z): the default is a
   *  solid top face; glass never; leaves only ocelot/parrot (Blocks.canSpawnOnLeaves); ice only
   *  polar_bear (Blocks.java:765/1970). The magma-block fire-immune exemption is not modelled (no
   *  fire-immune type reaches it, Spawn.NO_SPAWN_BLOCKS). */
  Spawn.floorAllows = function (type, x, y, z) {
    var W = NS.World, S = NS.States, R = NS.Reg, B = NS.Behave;
    var below = W.getBlock(x, y - 1, z);
    if (below === 0) return false;
    var nm = R.names[S.block[below]], bare = NS.Entities.bare(type);
    if (/_leaves$/.test(nm)) return bare === 'ocelot' || bare === 'parrot';
    if (bare === 'polar_bear' && (nm === 'ice' || nm === 'frosted_ice')) return !!(B && B.faceSturdy && B.faceSturdy(below, 1));
    if (Spawn.NO_SPAWN_BLOCKS[nm] === 1 || nm.slice(-14) === '_stained_glass') return false;
    return !!(B && B.faceSturdy && B.faceSturdy(below, 1));
  };

  /** `SpawnRestriction.register(type, Location, …)` for every type it registers, read out of
   *  `.decomp` by `tools/spawnloc-decomp.mjs` (printed, pasted, and re-derived by
   *  `spawnloccheck` in both directions -- never typed). A type it never registers is
   *  NO_RESTRICTIONS (`getLocation`'s own null branch): `Spawn.locationOf` returns 'none'. */
  Spawn.LOCATION = (function () {
    var t = {}, G = {
      on_ground: 'bat blaze cat cave_spider chicken cow creeper donkey ender_dragon enderman endermite ghast giant ' +
        'goat hoglin horse husk iron_golem llama magma_cube mooshroom mule ocelot parrot pig piglin pillager ' +
        'polar_bear rabbit sheep silverfish skeleton skeleton_horse slime snow_golem spider stray turtle villager ' +
        'witch wither wither_skeleton wolf zombie zombie_horse zombie_villager zombified_piglin',
      in_water: 'axolotl cod dolphin drowned elder_guardian glow_squid guardian pufferfish salmon squid tropical_fish',
      in_lava: 'strider',
      none: 'evoker fox illusioner panda phantom ravager shulker trader_llama vex vindicator wandering_trader'
    };
    for (var loc in G) G[loc].split(' ').forEach(function (id) { t[id] = loc; });
    return t;
  })();
  Spawn.locationOf = function (type) { return Spawn.LOCATION[NS.Entities.bare(type)] || 'none'; };

  /** `SpawnHelper.canSpawn(Location, WorldView, BlockPos, EntityType)` (.decomp SpawnHelper.java).
   *  on_ground's `allowsSpawning` floor half is each RULE's own (unchanged); its clearance half is
   *  isClearForSpawn on the cell and the cell above. in_water: the cell's fluid is water
   *  (`S.waterIn`: water, waterlogged, bubble column -- FluidTags.WATER) and the block above is
   *  not `isSolidBlock`. in_lava: the cell's fluid is lava. none: always. */
  Spawn.locationOk = function (loc, x, y, z) {
    var W = NS.World, S = NS.States, R = NS.Reg, Ph = NS.Physics;
    if (loc === 'none') return true;
    var st = W.getBlock(x, y, z);
    if (loc === 'in_water') {
      if (!(st > 0 && S.waterIn[st])) return false;
      var up = W.getBlock(x, y + 1, z);
      return !(up > 0 && Ph && S.solid[up] === 1 && Ph.shapesForState(up) === Ph.FULL_CUBE);
    }
    if (loc === 'in_lava') return st > 0 && S.block[st] === R.id.lava;
    return isClearForSpawn(st) && isClearForSpawn(W.getBlock(x, y + 1, z));
  };

  /** `SpawnHelper.canSpawn(ON_GROUND, world, pos, type)` whole: the floor's allowsSpawning plus the
   *  cell and the cell above clear. WanderingTraderManager.getNearbySpawnPos passes ON_GROUND for the
   *  trader and its llamas whatever their own registered Location is (.decomp:129-142). */
  Spawn.canSpawnOnGround = function (type, x, y, z) {
    return Spawn.floorAllows(type, x, y, z) && Spawn.locationOk('on_ground', x, y, z);
  };

  /** spawncheck's anti-vacuity turns this off; nothing else may. */
  Spawn.CLEAR_CHECK = true;

  /** `SpawnHelper.isClearForSpawn` (Yarn): not a full-cube collision, not a redstone power source,
   *  no fluid, not in `#prevent_mob_spawning_inside` (rails). `EntityType.isInvalidSpawn` is
   *  `Spawn.isInvalidSpawn(type, x, y, z)`, applied by clearForSpawn (the only caller with a type). */
  // loop/golempos: `noFluid` is vanilla's own fourth argument — `IronGolemEntity.canSpawn` passes
  // `Fluids.EMPTY.getDefaultState()` for the golem's OWN cell (.decomp IronGolemEntity.java:338),
  // so a golem may be summoned standing in water; every other caller passes the cell's fluid.
  function isClearForSpawn(st, noFluid) {
    if (st === 0) return true;
    var S = NS.States, R = NS.Reg, Ph = NS.Physics;
    if (Ph && S.solid[st] === 1 && Ph.shapesForState(st) === Ph.FULL_CUBE) return false;
    if (NS.Redstone && NS.Redstone.isSignalSource && NS.Redstone.isSignalSource(st)) return false;
    var nm = R.names[S.block[st]];
    if (!noFluid) {
      if (nm === 'water' || nm === 'lava' || nm === 'bubble_column') return false;
      var wl = R.PROP.waterlogged;
      if (wl !== undefined) { var v = S.propValue(st, wl); if (v >= 0 && R.valueNames[v] === 'true') return false; }
    }
    if (NS.World.tagBelow('prevent_mob_spawning_inside', st)) return false;
    return true;
  }

  Spawn.isClearForSpawn = isClearForSpawn;

  /** `EntityType.canSpawnInside` (.decomp EntityType.java allowSpawningInside calls). */
  var SPAWN_INSIDE = { fox: 'sweet_berry_bush', polar_bear: 'powder_snow', snow_golem: 'powder_snow',
    stray: 'powder_snow', wither: 'wither_rose', wither_skeleton: 'wither_rose' };
  var INVALID_SPAWN = ['wither_rose', 'sweet_berry_bush', 'powder_snow'];

  /** `EntityType.isInvalidSpawn` (EntityType.java:870-878) for the cell (x,y,z). */
  Spawn.isInvalidSpawn = function (type, x, y, z) {
    var st = NS.World.getBlock(x, y, z), nm = NS.Reg.names[NS.States.block[st]];
    if (SPAWN_INSIDE[type] === nm) return false;
    if (!(NS.Entities.fireImmune && NS.Entities.fireImmune(type)) && NS.Ai.inflictsFireDamage(x, y, z)) return true;
    return INVALID_SPAWN.indexOf(nm) >= 0;
  };

  /** ON_GROUND `SpawnHelper.canSpawn`'s clearance half (the `allowsSpawning` floor half is each
   *  RULE's own), then `isSpaceEmpty` over the type's box centred at (x+0.5, y, z+0.5). */
  Spawn.clearForSpawn = function (type, x, y, z) {
    var W = NS.World;
    if (!isClearForSpawn(W.getBlock(x, y, z)) || !isClearForSpawn(W.getBlock(x, y + 1, z))) return false;
    if (Spawn.isInvalidSpawn(type, x, y, z) || Spawn.isInvalidSpawn(type, x, y + 1, z)) return false;
    return Spawn.spaceEmpty(type, x, y, z);
  };

  /** `world.isSpaceEmpty(type.createSimpleBoundingBox(x + 0.5, y, z + 0.5))` -- block collisions. */
  Spawn.spaceEmpty = function (type, x, y, z) { return Spawn.spaceEmptyAt(type, x + 0.5, y, z + 0.5); };

  /** `isSpaceEmpty(createSimpleBoundingBox(cx, y, cz))` at real (double) coordinates. */
  Spawn.spaceEmptyAt = function (type, cx, y, cz, noEntities) {
    var Ph = NS.Physics;
    var dim = NS.Entities.dimensions(type);
    if (!dim || !Ph) return true;
    var hw = dim.width * 0.5;
    var x0 = cx - hw, x1 = cx + hw, y0 = y, y1 = y + dim.height, z0 = cz - hw, z1 = cz + hw;
    for (var bx = Math.floor(x0); bx <= Math.floor(x1 - 1e-7); bx++)
      for (var by = Math.floor(y0); by <= Math.floor(y1 - 1e-7); by++)
        for (var bz = Math.floor(z0); bz <= Math.floor(z1 - 1e-7); bz++) {
          var sh = Ph.shapeAt(bx, by, bz);
          if (!sh) continue;
          for (var k = 0; k < sh.length; k++) {
            var b = sh[k];
            if (bx + b[0] < x1 && bx + b[3] > x0 && by + b[1] < y1 && by + b[4] > y0 && bz + b[2] < z1 && bz + b[5] > z0) return false;
          }
        }
    return noEntities || !Spawn.ENTITY_CHECK || Spawn.entitiesClear(x0, y0, z0, x1, y1, z1);
  };

  /** Turn off to see the block-only check (anti-vacuity). */
  Spawn.ENTITY_CHECK = true;
  var INTERSECTING = { boat: 1, tnt: 1, falling_block: 1, end_crystal: 1, armor_stand: 1 };

  /** `EntityView.doesNotIntersectEntities(null, box)`: any live entity with `intersectionChecked`
   *  (LivingEntity, boat, tnt, falling block, end crystal, armor stand) overlapping the box; a
   *  spectator player does not count (not in getOtherEntities). */
  Spawn.entitiesClear = function (x0, y0, z0, x1, y1, z1) {
    var EL = NS.EntityList, list = EL && EL.list, Ent = NS.Entities;
    if (list) for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o.dead || o.removed) continue;
      var t = o.type;
      if (!(INTERSECTING[t] || (Ent.isLiving && Ent.isLiving(t)))) continue;
      if (t === 'armor_stand' && o.marker) continue;
      var d = Ent.dimensions(t);
      if (!d) continue;
      var hw = d.width * 0.5;
      if (o.x - hw < x1 && o.x + hw > x0 && o.y < y1 && o.y + d.height > y0 && o.z - hw < z1 && o.z + hw > z0) return false;
    }
    var P = NS.Player;
    if (P && !P.dead && P.mode !== 3 && P.x !== undefined &&
        P.x - 0.3 < x1 && P.x + 0.3 > x0 && P.y < y1 && P.y + 1.8 > y0 && P.z - 0.3 < z1 && P.z + 0.3 > z0) return false;
    return true;
  };

  /** `java.util.Random.nextInt(bound)`-shaped: [0, bound). Overridable by a check. */
  Spawn.randInt = function (bound) { return Math.floor(NS.EntityList.wr() * bound); };

  // ── type -> category, read off the biomes' OWN spawner lists, not re-declared here ────────
  // A type appears in exactly one category across all 61 biomes in 1.18.2; scanning every
  // biome once and keeping the union is how this stays true the day a biome's list changes,
  // instead of drifting the way a hand-typed copy would (D-119's rule, applied to a reverse
  // index instead of to the forward one).
  var typeCategory = null;
  function ensureTypeCategory() {
    if (typeCategory) return typeCategory;
    typeCategory = {};
    var B = NS.Biomes;
    if (!B || !B.ready) return typeCategory;
    for (var i = 0; i < B.count; i++) {
      var sp = B.spawners(i);
      for (var cat in sp) {
        var list = sp[cat];
        for (var j = 0; j < list.length; j++) {
          typeCategory[NS.Entities.bare(list[j].type)] = cat;
        }
      }
    }
    return typeCategory;
  }
  Spawn.categoryOf = function (type) { return ensureTypeCategory()[NS.Entities.bare(type)] || null; };

  // ── the live count a category's cap is measured against ───────────────────────────────────
  /** SpawnHelper.Info.spawningChunkCount (`.decomp/net/minecraft/world/SpawnHelper.java:432
   *  Info's own constructor field`) — `ServerChunkManager.tickChunks` (`.decomp/net/minecraft/
   *  server/world/ServerChunkManager.java:341` `this.ticketManager.getTickedChunkCount()`)
   *  passes it in as the count of TICKING chunks, not every loaded one. This engine's own
   *  ticking-chunk gate is `W.tickingAt` (D-452, simulation-distance-scoped) — counted here
   *  directly off `W.chunks` rather than approximated by a circle-area formula, so an
   *  irregular resident set (a fresh join, a `renderDistance` edit) is exact, not assumed
   *  circular. */
  Spawn.spawningChunkCount = function () {
    var W = NS.World, n = 0;
    if (!W || !W.chunks) return 0;
    W.chunks.forEach(function (c) {
      var bx = c.cx << 4, bz = c.cz << 4;
      if (W.loadedAt(bx, bz) && W.tickingAt(bx, bz)) n++;
    });
    return n;
  };

  /** SpawnHelper.Info.isBelowCap (`.decomp/net/minecraft/world/SpawnHelper.java:484-486`,
   *  verbatim): `capacity * spawningChunkCount / CHUNK_AREA`, CHUNK_AREA = 17² = 289
   *  (`SpawnHelper.java:55`, `Spawn.CATEGORY`'s header already cites this file). Integer
   *  (floor) division, matching Java's `int / int`. `cap < 0` (MISC) is never scaled — MISC
   *  is never a NATURAL_CATEGORIES member (see the comment just above `Spawn.NATURAL_
   *  CATEGORIES` itself) so this is reachable only from a caller passing a made-up category.
   *
   *  loop/spawn-cap — the OTHER half of `isBelowCap`'s own real caller, `SpawnDensityCapper.
   *  canSpawn` (`.decomp/net/minecraft/world/SpawnDensityCapper.java:34-42`), is a PER-PLAYER
   *  density check against the group's own UNSCALED `getCapacity()` — read in full and NOT
   *  separately modelled: `SpawnDensityCapper.increaseDensity` is called once per (player,
   *  existing non-persistent mob) pair a player is WATCHING (`getPlayersWatchingChunk`), and
   *  this engine has exactly one player who watches every ticking chunk that exists — so its
   *  own per-player density for a group is the SAME count `Spawn.liveCount(category)` already
   *  computes globally. Since `spawningChunkCount <= CHUNK_AREA` whenever `Spawn.
   *  SEARCH_MAX_XZ`/simulation distance stays at its shipped default (`effectiveSimDistance()
   *  <= 8` -> at most 17x17 = 289 ticking chunks, `W.tickingAt`'s own circle is <= that
   *  square), `categoryCap(cat) <= rule.cap` always holds here, so the density capper's own
   *  unscaled-cap gate can never bind tighter than the scaled gate below already does for
   *  this engine's single player — named here with the reasoning shown, not silently skipped. */
  Spawn.categoryCap = function (category) {
    var rule = Spawn.CATEGORY[category];
    if (!rule || rule.cap < 0) return -1;
    return Math.floor(rule.cap * Spawn.spawningChunkCount() / 289);
  };

  Spawn.liveCount = function (category) {
    var EL = NS.EntityList, n = 0;
    if (!EL || !EL.list) return 0;
    for (var i = 0; i < EL.list.length; i++) {
      var e = EL.list[i];
      if (e.removed) continue;
      // loop/despawn-s105: SpawnHelper.setupSpawn (.decomp :65-83) -- a persistent or riding
      // MobEntity is not counted at all, and the group is the TYPE's own SpawnGroup
      // (EntityType), not whichever biome list it was first seen in.
      var t = Spawn.DESPAWN_TYPES && Spawn.DESPAWN_TYPES[NS.Entities ? NS.Entities.bare(e.type) : e.type];
      if (t && (e.persistent || e.vehicle)) continue;
      if ((t ? t[0] : Spawn.categoryOf(e.type)) === category) n++;
    }
    return n;
  };

  /** `ServerWorldAccess.getEntitiesByClass(ChickenEntity.class, box.expand(5,3,5),
   *  EntityPredicates.NOT_MOUNTED)`, `.get(0)` (ZombieEntity.java:456-459) -- NOT_MOUNTED is
   *  `!entity.hasVehicle()`, i.e. this engine's own `!chicken.vehicle` (a chicken can be
   *  someone's VEHICLE, `chicken.passenger`, and still be picked -- it is the CHICKEN's own
   *  mount state that must be free, not whether it already carries a rider). First match in
   *  list order, same "no distance sort" shape `.get(0)` itself has. */
  function findNearbyFreeChicken(EL, zb) {
    var list = EL.all ? EL.all() : [];
    var hx = 5, hy = 3, hz = 5;
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (!c || c.type !== 'chicken' || c.dead || c.removed || c.vehicle) continue;
      if (Math.abs(c.x - zb.x) > hx || Math.abs(c.z - zb.z) > hz) continue;
      if (Math.abs(c.y - zb.y) > hy) continue;
      return c;
    }
    return null;
  }

  /** The pick table for (biome, category) at a position: the covering structure's override if
   *  any (`Structures.spawnOverride`), else the biome's own list. */
  Spawn.spawnList = function (biomeIdx, category, x, y, z) {
    var W = NS.World, S = NS.States, R = NS.Reg, nb = false;
    if (category === 'monster' && W && S && R) { var below = W.getBlock(x, y - 1, z); nb = below > 0 && S.block[below] === R.id.nether_bricks; }
    var ov = NS.Structures && NS.Structures.spawnOverride ? NS.Structures.spawnOverride(x, y, z, category, nb) : null;
    if (ov) return ov;
    var sp = NS.Biomes.spawners(biomeIdx);
    return sp && sp[category];
  };

  function pickWeighted(list, rnd) {
    var total = 0, i;
    for (i = 0; i < list.length; i++) total += list[i].weight;
    if (total <= 0) return null;
    var r = rnd(total);
    for (i = 0; i < list.length; i++) {
      r -= list[i].weight;
      if (r < 0) return list[i];
    }
    return list[list.length - 1];
  }

  Spawn.pickWeighted = pickWeighted;   // lockstep-structurespawns drives the real weighted pick

  /** The per-type "one extra line on a natural placement" hooks (MobEntity.initialize overrides) -- shared by
   *  `Spawn.attempt` and `Spawn.spawnForChunk`. `e` may be null (refused by EL.spawn). */
  function afterNaturalSpawn(e, type, rnd, packData) {
    var EL = NS.EntityList;
    // s98 -- `RaiderEntity.initialize`: a NATURALLY spawned witch may never join a raid.
    if (e && type === 'witch') e.canJoinRaid = false;
    // #3104: zombie_villager is its OWN weight-5 biome spawner row (pack of 1); no zombie->zombie_villager swap here.
    // loop/jockey (QUEUE 0.2, this unit) -- `ZombieEntity.initialize`'s own baby roll
    // (`shouldBeBaby`, 5%) then, for a baby, its two independent chicken-jockey rolls
    // (.decomp:451-469), wired at the SAME "one extra per-type line on a natural placement"
    // slot the witch line above uses. `frnd` is
    // a PROBABILITY source (NS.EntityList.wr-shaped, `EL.random || NS.EntityList.wr` -- the SAME
    // injection point `Zv.tickOne` already uses), deliberately NOT `rnd` (`Spawn.randInt`,
    // an INTEGER-bound source this loop's own placement math uses it for) -- the two are not
    // interchangeable.
    if (e && NS.Undead && NS.Undead.ready && NS.Undead.CHICKEN_JOCKEY_FAMILY[type]) {
      var frnd = (EL.random || NS.EntityList.wr);
      if ((e.growAge | 0) < 0) {   // D-672: the 5% baby roll is EL.spawn's now (every initialize path)
        NS.Undead.tryChickenJockey(e, frnd, {
          findChicken: function (zb) { return findNearbyFreeChicken(EL, zb); },
          spawnChicken: function (zb) { return EL.spawn('chicken', zb.x, zb.y, zb.z, {}); }
        });
      }
    }
    // loop/jockey -- `SpiderEntity.initialize` (.decomp:152-168): the 1/100 skeleton-rider
    // roll and the HARD-only status-effect roll are two SEPARATE, INDEPENDENT things off the
    // SAME natural placement (a jockey spider can also carry the potion effect).
    if (e && type === 'spider' && NS.Undead && NS.Undead.ready) {
      var sfrnd = (EL.random || NS.EntityList.wr);
      NS.Undead.trySpiderJockey(e, sfrnd, {
        spawnSkeleton: function (sp) { return EL.spawn('skeleton', sp.x, sp.y, sp.z, {}); }
      });
      NS.Undead.trySpiderEffect(e, sfrnd, packData);
    }
  }

  // ── NaturalSpawner traversal: SpawnHelper.spawn / spawnEntitiesInChunk (#166, G18c-c) ──────
  // Every literal below is read off `.decomp/net/minecraft/world/SpawnHelper.java` (spawncheck's
  // spawntravcheck re-greps them from the jar source, so a drifted constant fails):
  //   TRIES 3 (`$$12 < 3`), PACK_RANDOM_MAX 4.0F (`ceil(nextFloat() * 4.0F)`), JITTER 6
  //   (`nextInt(6) - nextInt(6)`, x then z), MIN_PLAYER_DIST2 576 (`$$3 <= 576.0` -> refuse),
  //   SPAWN_POINT_RADIUS 24 (`isWithinDistance(.., 24.0)` -> refuse), MUSHROOM_SKIP 0.98F.
  Spawn.TRAVERSAL = { TRIES: 3, PACK_RANDOM_MAX: 4, JITTER: 6, MIN_PLAYER_DIST2: 576,
    SPAWN_POINT_RADIUS: 24, MUSHROOM_SKIP: 0.98, DEFAULT_LIMIT_PER_CHUNK: 4, RARE_PERIOD: 400 };

  /** `MobEntity.getLimitPerChunk` overrides (.decomp entity/**): default 4; Wolf 8, FishEntity 8
   *  (cod/pufferfish/tropical_fish via SchoolingFishEntity.getMaxGroupSize), Salmon 5, HorseBase 6
   *  (horse/donkey/mule/llama/trader_llama/skeleton_horse/zombie_horse), Pillager 1, Ghast 1. */
  Spawn.LIMIT_PER_CHUNK = { wolf: 8, cod: 8, pufferfish: 8, tropical_fish: 8, salmon: 5,
    horse: 6, donkey: 6, mule: 6, llama: 6, trader_llama: 6, skeleton_horse: 6, zombie_horse: 6,
    pillager: 1, ghast: 1 };
  Spawn.limitPerChunk = function (type) {
    var v = Spawn.LIMIT_PER_CHUNK[NS.Entities.bare(type)];
    return v === undefined ? Spawn.TRAVERSAL.DEFAULT_LIMIT_PER_CHUNK : v;
  };

  /** The `java.util.Random` shape the traversal draws from: `nextInt(bound)`, `nextFloat()`.
   *  Default is this engine's own `Spawn.randInt`/`NS.EntityList.wr`; a check injects a scripted one
   *  and reads the exact call sequence back. */
  Spawn.defaultRng = {
    nextInt: function (b) { return Spawn.randInt(b); },
    nextFloat: function () { return NS.EntityList.wr(); }
  };

  /** `ServerWorld.getSpawnPos()`: `/setworldspawn`'s value when one exists (else the level spawn
   *  recorded in the save at world creation, #6791). */
  Spawn.worldSpawn = function () { return (NS.Commands && NS.Commands.worldSpawn) || (NS.Save && NS.Save.worldSpawn) || null; };

  /** `GravityField` (.decomp util/math/GravityField.java): points of (pos, mass); `calculate` sums
   *  mass/sqrt(d2) over every point (infinite at d2 == 0), times the candidate's own mass. */
  function GravityField() { this.points = []; }
  GravityField.prototype.addPoint = function (x, y, z, mass) {
    if (mass !== 0) this.points.push([x, y, z, mass]);
  };
  GravityField.prototype.calculate = function (x, y, z, mass) {
    if (mass === 0) return 0;
    var sum = 0;
    for (var i = 0; i < this.points.length; i++) {
      var p = this.points[i], dx = p[0] - x, dy = p[1] - y, dz = p[2] - z;
      var d2 = dx * dx + dy * dy + dz * dz;
      sum += d2 === 0 ? Infinity : p[3] / Math.sqrt(d2);
    }
    return sum * mass;
  };
  Spawn.GravityField = GravityField;

  /** `SpawnSettings.getSpawnDensity(type)` for the biome at (x, z): `{limit: energy_budget,
   *  mass: charge}` from the biome's own `spawn_costs` (B.spawnCosts), or null. */
  Spawn.spawnDensity = function (type, x, z) {
    var W = NS.World, B = NS.Biomes;
    if (!W || !B || !B.spawnCosts) return null;
    var costs = B.spawnCosts(W.biomeAt(x, z));
    var c = costs && (costs['minecraft:' + NS.Entities.bare(type)] || costs[NS.Entities.bare(type)]);
    return c ? { limit: +c.energy_budget, mass: +c.charge } : null;
  };

  /** One live entity's SpawnGroup as `setupSpawn` counts it, or null if it is not counted. */
  function countedGroup(e) {
    if (e.removed) return null;
    var t = Spawn.DESPAWN_TYPES && Spawn.DESPAWN_TYPES[NS.Entities.bare(e.type)];
    if (t && (e.persistent || e.vehicle)) return null;
    return t ? t[0] : Spawn.categoryOf(e.type);
  }

  /** `SpawnHelper.setupSpawn` -> `Info`: per-group counts plus the GravityField of every counted
   *  entity whose biome carries a spawn cost for its type. */
  Spawn.setupInfo = function () {
    var EL = NS.EntityList, info = { chunkCount: Spawn.spawningChunkCount(), counts: {}, field: new GravityField() };
    if (!EL || !EL.list) return info;
    for (var i = 0; i < EL.list.length; i++) {
      var e = EL.list[i], g = countedGroup(e);
      if (!g) continue;
      var d = Spawn.spawnDensity(e.type, Math.floor(e.x), Math.floor(e.z));
      if (d) info.field.addPoint(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z), d.mass);
      info.counts[g] = (info.counts[g] | 0) + 1;
    }
    return info;
  };
  /** `Info.isBelowCap` (capacity * spawningChunkCount / 289 vs the live count). */
  Spawn.infoBelowCap = function (info, cat) {
    var rule = Spawn.CATEGORY[cat];
    return (info.counts[cat] | 0) < Math.floor(rule.cap * info.chunkCount / 289);
  };
  /** `Info.test`: the GravityField energy at the candidate cell must not exceed the biome's budget. */
  function infoTest(info, type, x, y, z) {
    var d = Spawn.spawnDensity(type, x, z);
    if (!d) return true;
    return info.field.calculate(x, y, z, d.mass) <= d.limit;
  }
  Spawn.infoTest = infoTest;
  /** `Info.run`: a placed mob joins the field and its group's count. */
  function infoRun(info, cat, type, x, y, z) {
    var d = Spawn.spawnDensity(type, x, z);
    info.field.addPoint(x, y, z, d ? d.mass : 0);
    info.counts[cat] = (info.counts[cat] | 0) + 1;
  }

  /** `SpawnHelper.isAcceptableSpawnPosition`: d2 > 576, outside 24 blocks of the world spawn, and
   *  in the chunk being spawned in or in a ticking chunk. */
  Spawn.isAcceptablePosition = function (cx, cz, x, y, z, d2) {
    var T = Spawn.TRAVERSAL;
    if (d2 <= T.MIN_PLAYER_DIST2) return false;
    var sp = Spawn.worldSpawn();
    if (sp) {
      var dx = sp.x - (x + 0.5), dy = sp.y - y, dz = sp.z - (z + 0.5);
      if (dx * dx + dy * dy + dz * dz < T.SPAWN_POINT_RADIUS * T.SPAWN_POINT_RADIUS) return false;
    }
    if (!NS.World.loadedAt(x, z)) return false;           // a ticking chunk is a loaded one
    return ((x >> 4) === cx && (z >> 4) === cz) || !!NS.World.tickingAt(x, z);
  };

  function isSolidBlockAt(x, y, z) {
    var st = NS.World.getBlock(x, y, z), S = NS.States, Ph = NS.Physics;
    return st > 0 && S.solid[st] === 1 && !!Ph && Ph.shapesForState(st) === Ph.FULL_CUBE;
  }

  /** `SpawnHelper.spawnEntitiesInChunk(group, world, chunk, checker, runner)` for chunk (cx, cz).
   *  Returns the number placed. `ctx = {rng, info}`; each is optional (defaults: Spawn.defaultRng,
   *  a fresh `setupInfo`). RNG draw order is vanilla's, call for call (spawntravcheck). */
  Spawn.spawnForChunk = function (cx, cz, category, ctx) {
    ctx = ctx || {};
    var rng = ctx.rng || Spawn.defaultRng, info = ctx.info || Spawn.setupInfo();
    var W = NS.World, P = NS.Player, B = NS.Biomes, EL = NS.EntityList, T = Spawn.TRAVERSAL;
    var rnd = function (b) { return rng.nextInt(b); };
    // getRandomPosInChunkSection: x, z, then `nextBetween(bottom, sampleHeightmap + 1)`
    var bottom = NS.CFG.WORLD_MIN_Y;
    var sx = (cx << 4) + rng.nextInt(16), sz = (cz << 4) + rng.nextInt(16);
    var top = W.heightAt(sx, sz) + 2;                 // first free Y (heightAt + 1), + 1
    var sy = rng.nextInt(top - bottom + 1) + bottom;
    if (sy < bottom + 1) return 0;
    if (isSolidBlockAt(sx, sy, sz)) return 0;
    var made = 0;
    for (var t = 0; t < T.TRIES; t++) {
      var x = sx, z = sz, entry = null, spawnedHere = 0, packData = {};
      var packLen = Math.ceil(Math.fround(rng.nextFloat() * T.PACK_RANDOM_MAX));
      for (var n = 0; n < packLen; n++) {
        x += rng.nextInt(T.JITTER) - rng.nextInt(T.JITTER);
        z += rng.nextInt(T.JITTER) - rng.nextInt(T.JITTER);
        var px = x + 0.5, pz = z + 0.5;
        if (!P) continue;                                            // getClosestPlayer == null
        var ddx = P.x - px, ddy = P.y - sy, ddz = P.z - pz, d2 = ddx * ddx + ddy * ddy + ddz * ddz;
        if (!Spawn.isAcceptablePosition(cx, cz, x, sy, z, d2)) continue;
        if (!entry) {
          // pickRandomSpawnEntry: monsters in a mushroom biome are skipped 98% of the time
          var bi = W.biomeAt(x, z), list = Spawn.spawnList(bi, category, x, sy, z);   // #165: a covering structure's spawn_overrides win (ChunkGenerator.getEntitySpawnList)
          if (category === 'monster' && /mushroom/.test(B.name(bi)) && rng.nextFloat() < T.MUSHROOM_SKIP) break;
          entry = list && list.length ? pickWeighted(list, rnd) : null;
          if (!entry) break;
          packLen = entry.minCount + rng.nextInt(1 + entry.maxCount - entry.minCount);
        }
        var type = NS.Entities.bare(entry.type);
        // SpawnHelper.canSpawn(..): far-from-player, location + rule + space (Spawn.checkPlacement,
        // in vanilla's order), then Info.test
        var range = Spawn.CATEGORY[category].despawn;
        if (d2 > range * range && !Spawn.spawnableFarFromPlayer(type)) continue;
        if (!EL.canSpawn(type) || !Spawn.canPlace(type)) continue;
        if (!Spawn.checkPlacement(type, x, sy, z, 'natural', rnd)) continue;
        if (!infoTest(info, type, x, sy, z)) continue;
        rng.nextFloat();                                             // refreshPositionAndAngles yaw
        if (d2 > range * range && Spawn.canImmediatelyDespawn({ type: type }, d2)) continue;  // isValidSpawn
        var e = EL.spawn(type, px, sy, pz, { spawnIdx: spawnedHere, packData: packData });
        if (!e) continue;
        afterNaturalSpawn(e, type, rnd, packData);
        infoRun(info, category, type, x, sy, z);
        made++; spawnedHere++;
        if (made >= Spawn.limitPerChunk(type)) return made;
        if (type === 'tropical_fish' && e.fishCommonSpawn === false) break;   // spawnsTooManyForEachTry
      }
    }
    return made;
  };

  Spawn.afterNaturalSpawn = afterNaturalSpawn;   // lockstep-spawn's oracle places through the same per-type hook

  /** `EntityType.isSpawnableFarFromPlayer`: the Builder default is group == CREATURE || MISC
   *  (EntityType.java:998); only pillager and shulker add `.spawnableFarFromPlayer()`. */
  Spawn.spawnableFarFromPlayer = function (type) {
    var bare = NS.Entities.bare(type), g = Spawn.categoryOf(bare);
    return g === 'creature' || g === 'misc' || bare === 'pillager' || bare === 'shulker';
  };

  /** `ServerChunkManager.tickChunks` -> `SpawnHelper.spawn` for every ticking chunk (shuffled),
   *  every group whose `spawn` flags allow it. `creature` is the rare group: only on
   *  `time % 400 == 0`. Peaceful difficulty turns monsters off (`spawnMonsters`). */
  Spawn.tick = function (ctx) {
    if (!Spawn.ready) return 0;
    var P = NS.Player, W = NS.World, EL = NS.EntityList, B = NS.Biomes;
    if (!P || !W || !EL || !EL.ready || !B || !B.ready) return 0;
    ctx = ctx || {};
    var rng = ctx.rng || Spawn.defaultRng, info = ctx.info || Spawn.setupInfo();
    var rare = ctx.rare !== undefined ? ctx.rare
      : ((NS.Behave && NS.Behave.gameTime) | 0) % Spawn.TRAVERSAL.RARE_PERIOD === 0;
    var monsters = !Diff.isPeaceful();
    var chunks = [];
    W.chunks.forEach(function (c) {
      var bx = c.cx << 4, bz = c.cz << 4;
      if (W.loadedAt(bx, bz) && W.tickingAt(bx, bz)) chunks.push(c);
    });
    for (var i = chunks.length - 1; i > 0; i--) {         // Collections.shuffle
      var j = rng.nextInt(i + 1), tmp = chunks[i]; chunks[i] = chunks[j]; chunks[j] = tmp;
    }
    var spawned = 0;
    for (var k = 0; k < chunks.length; k++) {
      for (var ci = 0; ci < Spawn.NATURAL_CATEGORIES.length; ci++) {
        var cat = Spawn.NATURAL_CATEGORIES[ci];
        if (cat === 'monster' ? !monsters : false) continue;
        if (cat === 'creature' && !rare) continue;
        if (!Spawn.infoBelowCap(info, cat)) continue;
        spawned += Spawn.spawnForChunk(chunks[k].cx, chunks[k].cz, cat, { rng: rng, info: info });
      }
    }
    return spawned;
  };

  /** One category, one random ticking chunk, one `spawnEntitiesInChunk` -- a check's/console's
   *  handle on the traversal (the real cycle is `Spawn.tick`). True when something was placed. */
  Spawn.attempt = function (category) {
    var W = NS.World, chunks = [];
    if (!W || !W.chunks) return false;
    W.chunks.forEach(function (c) {
      var bx = c.cx << 4, bz = c.cz << 4;
      if (W.loadedAt(bx, bz) && W.tickingAt(bx, bz)) chunks.push(c);
    });
    if (!chunks.length) return false;
    var info = Spawn.setupInfo();
    if (!Spawn.infoBelowCap(info, category)) return false;
    var c = chunks[Spawn.randInt(chunks.length)];
    return Spawn.spawnForChunk(c.cx, c.cz, category, { info: info }) > 0;
  };

  // ── despawn: distance bands, out of `ayb`'s own fields (D-393) ────────────────────────────
  // loop/despawn-s105 (QUEUE 0.2 G18c, `Spawn.OWED`'s despawn line): `MobEntity.checkDespawn`
  // (.decomp MobEntity.java:655-679) transcribed WHOLE. The roll is `despawnCounter > 600 &&
  // random.nextInt(800) == 0` (:670) -- the 1/800 was right, the >600 idle gate was missing, so
  // a mob that had just been near the player could vanish the very next tick it stepped past 32.
  // `despawnCounter` itself: +1 every tick in `tickNewAi` (:683); +2 more for a HostileEntity
  // whose eye brightness is > 0.5 (HostileEntity.java:43-48) and +2 always for a RaiderEntity
  // (RaiderEntity.java:112-114, which overrides it); reset to 0 when within the 32 band (:673),
  // when persistent or riding (`cannotDespawn` = `hasVehicle`, :646-648; the else at :677), and
  // on every `LivingEntity.damage` that gets past the dead/fire-immune gates (LivingEntity.java
  // :1039, wired in 14j_combat.js's `Cb.hurt`).
  Spawn.DESPAWN_ROLL_ODDS = 1 / 800;      // random.nextInt(800) == 0, MobEntity.java:670
  Spawn.DESPAWN_IDLE_TICKS = 600;         // despawnCounter > 600, MobEntity.java:670

  // Every MobEntity type's own SpawnGroup (EntityType.java's `Builder.create(..., SpawnGroup.X)`),
  // which class in its own extends-chain first overrides `canImmediatelyDespawn`, and which
  // (if any) overrides `updateDespawnCounter` -- derived from .decomp, and re-derived by
  // tools/despawncheck.mjs every run (the check owns none of it: rule 3, D-329).
  //   [spawnGroup, despawnKind, counterBump]
  //   despawnKind: mob (MobEntity:642, true) · animal (AnimalEntity:121, false) · never
  //   (GolemEntity:44/VillagerEntity:536/WanderingTraderEntity:163, false) · cat (CatEntity:466)
  //   · ocelot (OcelotEntity:129) · chicken (ChickenEntity:163) · fish (FishEntity:59 /
  //   AxolotlEntity:521) · unpersisted (HoglinEntity:206/PiglinEntity:218) · zvillager
  //   (ZombieVillagerEntity:173) · raider (RaiderEntity:254 -> PatrolEntity:100 -> Mob)
  /** `MobEntity.isDisallowedInPeaceful` (`.decomp/net/minecraft/entity/mob/MobEntity.java:
   *  650-652`, default `false`), overridden `true` on `HostileEntity` (`HostileEntity.java:52-54`,
   *  so every raider, zombie/skeleton kin, guardian, blaze, vex, zoglin, piglin_brute ...),
   *  `GhastEntity.java:64`, `PhantomEntity.java:112`, `WitherEntity`, and `getSize() > 0` on
   *  `SlimeEntity.java:117` (slime AND magma_cube -- `setSize` clamps to 1..127, SlimeEntity.java:
   *  76, so it is always true); `PiglinEntity.java:213` overrides back to `false`. Derived over
   *  every type in `Spawn.DESPAWN_TYPES` by walking each class's extends-chain in `.decomp`
   *  (orchestrator fix at merge, session 107: the worker's 9-entry table missed 23 and wrongly
   *  exempted slime). */
  Spawn.PEACEFUL_DISALLOWED = {
    blaze: 1, cave_spider: 1, creeper: 1, drowned: 1, elder_guardian: 1, enderman: 1, endermite: 1,
    evoker: 1, ghast: 1, giant: 1, guardian: 1, husk: 1, illusioner: 1, magma_cube: 1, phantom: 1,
    piglin_brute: 1, pillager: 1, ravager: 1, silverfish: 1, skeleton: 1, slime: 1, spider: 1,
    stray: 1, vex: 1, vindicator: 1, witch: 1, wither: 1, wither_skeleton: 1, zoglin: 1, zombie: 1,
    zombie_villager: 1, zombified_piglin: 1
  };

  Spawn.DESPAWN_TYPES = {
    axolotl: ['axolotls', 'fish', 0],
    bat: ['ambient', 'mob', 0],
    bee: ['creature', 'animal', 0],
    blaze: ['monster', 'mob', 'light'],
    cat: ['creature', 'cat', 0],
    cave_spider: ['monster', 'mob', 'light'],
    chicken: ['creature', 'chicken', 0],
    cod: ['water_ambient', 'fish', 0],
    cow: ['creature', 'animal', 0],
    creeper: ['monster', 'mob', 'light'],
    dolphin: ['water_creature', 'mob', 0],
    donkey: ['creature', 'animal', 0],
    drowned: ['monster', 'mob', 'light'],
    elder_guardian: ['monster', 'mob', 'light'],
    ender_dragon: ['monster', 'mob', 0],
    enderman: ['monster', 'mob', 'light'],
    endermite: ['monster', 'mob', 'light'],
    evoker: ['monster', 'raider', 'always'],
    fox: ['creature', 'animal', 0],
    ghast: ['monster', 'mob', 0],
    giant: ['monster', 'mob', 'light'],
    glow_squid: ['underground_water_creature', 'mob', 0],
    goat: ['creature', 'animal', 0],
    guardian: ['monster', 'mob', 'light'],
    hoglin: ['monster', 'unpersisted', 0],
    horse: ['creature', 'animal', 0],
    husk: ['monster', 'mob', 'light'],
    illusioner: ['monster', 'raider', 'always'],
    iron_golem: ['misc', 'never', 0],
    llama: ['creature', 'animal', 0],
    magma_cube: ['monster', 'mob', 0],
    mooshroom: ['creature', 'animal', 0],
    mule: ['creature', 'animal', 0],
    ocelot: ['creature', 'ocelot', 0],
    panda: ['creature', 'animal', 0],
    parrot: ['creature', 'animal', 0],
    phantom: ['monster', 'mob', 0],
    pig: ['creature', 'animal', 0],
    piglin: ['monster', 'unpersisted', 'light'],
    piglin_brute: ['monster', 'mob', 'light'],
    pillager: ['monster', 'raider', 'always'],
    polar_bear: ['creature', 'animal', 0],
    pufferfish: ['water_ambient', 'fish', 0],
    rabbit: ['creature', 'animal', 0],
    ravager: ['monster', 'raider', 'always'],
    salmon: ['water_ambient', 'fish', 0],
    sheep: ['creature', 'animal', 0],
    shulker: ['monster', 'never', 0],
    silverfish: ['monster', 'mob', 'light'],
    skeleton: ['monster', 'mob', 'light'],
    skeleton_horse: ['creature', 'animal', 0],
    slime: ['monster', 'mob', 0],
    snow_golem: ['misc', 'never', 0],
    spider: ['monster', 'mob', 'light'],
    squid: ['water_creature', 'mob', 0],
    stray: ['monster', 'mob', 'light'],
    strider: ['creature', 'animal', 0],
    trader_llama: ['creature', 'animal', 0],
    tropical_fish: ['water_ambient', 'fish', 0],
    turtle: ['creature', 'animal', 0],
    vex: ['monster', 'mob', 'light'],
    villager: ['misc', 'never', 0],
    vindicator: ['monster', 'raider', 'always'],
    wandering_trader: ['creature', 'never', 0],
    witch: ['monster', 'raider', 'always'],
    wither: ['monster', 'never', 'light'],  // WitherEntity.checkDespawn:485 -- peaceful discard, else counter = 0, never a distance/idle despawn
    wither_skeleton: ['monster', 'mob', 'light'],
    wolf: ['creature', 'animal', 0],
    zoglin: ['monster', 'mob', 'light'],
    zombie: ['monster', 'mob', 'light'],
    zombie_horse: ['creature', 'animal', 0],
    zombie_villager: ['monster', 'zvillager', 'light'],
    zombified_piglin: ['monster', 'mob', 'light']

  };

  /** `canImmediatelyDespawn(sqDist)`, per the override the type's own class chain reaches. */
  Spawn.canImmediatelyDespawn = function (e, d2) {
    var t = Spawn.DESPAWN_TYPES[NS.Entities ? NS.Entities.bare(e.type) : e.type];
    if (!t) return false;
    switch (t[1]) {
      case 'mob': return true;
      case 'animal': case 'never': return false;
      case 'cat': return !e.tamed && (e.age | 0) > 2400;
      // OcelotEntity.isTrusting: e.trusting (Tm.feedOcelot).
      case 'ocelot': return !e.trusting && (e.age | 0) > 2400;
      // ChickenEntity.hasJockey() (.decomp:180-182) -- loop/jockey: real now, Passive.setChickenJockey.
      case 'chicken': return !!e.hasJockey;
      case 'fish': return !e.fromBucket && !e.customName;
      case 'unpersisted': return !e.persistent;
      case 'zvillager': return !e.converting && !((e.tradeXp | 0) > 0);
      case 'raider':
        if (e.raidId != null) return false;                        // RaiderEntity:254
        return !e.patrolling || d2 > 16384;                         // PatrolEntity:100
    }
    return true;
  };

  /** `getBrightnessAtEyes() > 0.5` (Entity.java:1184, WorldView.getBrightness:107 ->
   *  DimensionType.computeBrightnessByLightLevel:212-220 at the overworld's ambientLight 0,
   *  light = max(block, sky - ambientDarkness), WorldView.getLightLevel:160). */
  Spawn.brightAtEyes = function (e) {
    var W = NS.World, S = NS.Sky;
    if (!W || !W.getLight) return false;
    var y = Math.floor(e.y + (e.eyeHeight || (e.height || 0) * 0.85));
    var L = W.getLight(Math.floor(e.x), y, Math.floor(e.z));
    var sky = (L >> 4) & 15, blk = L & 15;
    var dark = (S && S.darknessNow) ? S.darknessNow() : 0;
    var l = Math.max(blk, sky - dark);
    // FLOAT arithmetic, as the jar computes it: light 12 -> 0.8f / 1.5999999f = 0.50000006f,
    // which IS > 0.5 -- so a hostile at light 12 (not 13) already counts up at +3.
    var fr = Math.fround, f = fr(l / 15);
    return fr(f / fr(4 - fr(3 * f))) > 0.5;
  };

  Spawn.despawnTick = function () {
    var EL = NS.EntityList;
    if (!EL || !EL.list) return 0;
    var n = 0;
    for (var i = 0; i < EL.list.length; i++) if (Spawn.despawnOne(EL.list[i])) n++;
    return n;
  };

  // #6336: one mob's `checkDespawn` + `tickNewAi` counter step, called from EL.tickMob at the top of the
  // entity's own turn (ServerWorld.tickEntities: checkDespawn(), then tickEntity). Returns true if removed.
  Spawn.despawnOne = function (e) {
    var EL = NS.EntityList, P = NS.Player;
    if (!EL || !P) return false;
    var n = 0;
    do {
      if (e.removed) break;
      var bareType = NS.Entities ? NS.Entities.bare(e.type) : e.type;
      var t = Spawn.DESPAWN_TYPES[bareType];
      if (!t) break;                         // not a MobEntity -- checkDespawn is Mob's own
      var rule = Spawn.CATEGORY[t[0]];
      if (!rule) break;
      // loop/spawn-cap -- `MobEntity.checkDespawn`'s OWN first branch (`.decomp/net/
      // minecraft/entity/mob/MobEntity.java:656-657`, ahead of the persistent/distance branch
      // below, and unconditional on persistent/tamed status): `difficulty == PEACEFUL &&
      // isDisallowedInPeaceful()` -> `discard()` -- which types are disallowed is
      // Spawn.PEACEFUL_DISALLOWED's own header (every HostileEntity, ghast, phantom, wither,
      // slime/magma_cube; tools/spawncapcheck.mjs re-derives it from .decomp each run).
      if (Diff.isPeaceful() && Spawn.PEACEFUL_DISALLOWED[bareType] === 1) {
        EL.remove(e); return true;
      }
      // `checkDespawn` runs BEFORE the entity's own tick (ServerWorld.tickEntity order), so it
      // reads the counter as last tick left it; the increments below are this tick's tickNewAi.
      if (bareType === 'wither') {
        e.despawnCounter = 0;                   // WitherEntity.checkDespawn:489
      } else if (e.persistent || e.vehicle || e.fromBucket || (bareType === 'enderman' && e.carriedBlock != null)) {
        e.despawnCounter = 0;                   // MobEntity:677; EndermanEntity.cannotDespawn: || carried block
      } else {
        var dx = e.x - P.x, dy = e.y - P.y, dz = e.z - P.z;
        var d2 = dx * dx + dy * dy + dz * dz;
        var far = rule.despawn * rule.despawn, near = rule.noDespawn * rule.noDespawn;
        if (d2 > far && Spawn.canImmediatelyDespawn(e, d2)) { EL.remove(e); return true; }
        if ((e.despawnCounter | 0) > Spawn.DESPAWN_IDLE_TICKS && NS.EntityList.wr() < Spawn.DESPAWN_ROLL_ODDS &&
            d2 > near && Spawn.canImmediatelyDespawn(e, d2)) { EL.remove(e); return true; }
        if (d2 < near) e.despawnCounter = 0;    // MobEntity:672-673
      }
      // loop/spawn-cap: `tickNewAi` (this counter's own +1/+2 source, MobEntity:683) is only
      // ever called from `LivingEntity.travel` behind `canMoveVoluntarily()`
      // (`.decomp/net/minecraft/entity/LivingEntity.java:2513`), and MobEntity's own override
      // of that (`.decomp/net/minecraft/entity/mob/MobEntity.java:1272`) is
      // `super.canMoveVoluntarily() && !this.isAiDisabled()` -- an AI-disabled (`NoAI`-tagged)
      // mob never reaches `tickNewAi` at all, so its despawnCounter FREEZES rather than
      // climbing. `e.aiDisabled` has no setter anywhere in this engine yet (no `/data merge`,
      // no NoAI-tagged spawn-egg path -- 07zd_slime.js's own header already names the same
      // gap for split children), so this branch is dead code today and a no-op change in
      // practice; it is still written to the real rule rather than left silently wrong for
      // the day something DOES set the field.
      if (!e.aiDisabled) {
        var c = (e.despawnCounter | 0);
        if (t[2] === 'always') c += 2;            // RaiderEntity.updateDespawnCounter
        else if (t[2] === 'light' && Spawn.brightAtEyes(e)) c += 2;   // HostileEntity's
        e.despawnCounter = c + 1;                 // tickNewAi, MobEntity:683
      }
    } while (false);
    return false;
  };

  // ── D-395 (JOB 2.3): THE MONSTER SPAWNER BLOCK — the THIRD spawn source, sharing the SAME
  // category cap `Spawn.attempt`/`Spawn.tick` already enforce, per `docs/archive/NEXT.md`'s own
  // acceptance for this job. `BaseSpawner.serverTick`, transcribed at the level this engine can
  // reach without a client-only spin animation to drive: `isNearPlayer` gates the whole tick
  // (`requiredPlayerRange`, default 16 — a spawner nobody is near does not even count down);
  // then the count-down (`spawnDelay`, the block entity's own `e.delay`, D-208's default of 20
  // before the FIRST roll); then, once it reaches zero, up to `spawnCount` (default 4) attempts
  // inside a `2*spawnRange` (default 4) cube centred on the block, each ALSO checked against
  // this file's own `Spawn.checkPlacement` (reason `'spawner'`, so `checkMobSpawnRules`'s
  // ground-below half is skipped exactly as it is for a natural spawn in a cave, but
  // `isDarkEnoughToSpawn` still runs — a zombie spawner in a lit room correctly produces
  // nothing, matching real spawner behaviour) — gated FIRST by `maxNearbyEntities` (default 6,
  // vanilla's own box: the spawner's 1×1×1 cell inflated by `spawnRange` in every direction) and
  // by the mob's own CATEGORY CAP, the same `Spawn.CATEGORY`/`Spawn.liveCount` `Spawn.tick`
  // already reads — a full server of zombies does not get MORE zombies from standing on a
  // spawner. A landed spawn re-rolls `e.delay` to `[minDelay, maxDelay]` (200..800) whether or
  // not every attempt in the batch succeeded, matching `BaseSpawner.delay`'s own unconditional
  // reset at the end of `serverTick`.
  Spawn.SPAWNER_DEFAULTS = { spawnRange: 4, requiredPlayerRange: 16, maxNearbyEntities: 6 };

  /** Java subclasses whose instances `getNonSpectatingEntities(entity.getClass(), ..)` also counts (Class.isInstance). */
  Spawn.SPAWNER_SUBCLASSES = {
    zombie: ['husk', 'drowned', 'zombie_villager', 'zombified_piglin'], spider: ['cave_spider'],
    slime: ['magma_cube'], cow: ['mooshroom'], guardian: ['elder_guardian']
  };

  /** `MobSpawnerLogic.serverTick`'s count: same class, bounding box INTERSECTING the spawner cell inflated by `spawnRange`. */
  Spawn.nearbySpawnedCount = function (e, type, spawnRange) {
    var EL = NS.EntityList;
    if (!EL || !EL.list) return 0;
    var sub = Spawn.SPAWNER_SUBCLASSES[type], n = 0;
    for (var i = 0; i < EL.list.length; i++) {
      var o = EL.list[i];
      if (o.removed || !(o.type === type || (sub && sub.indexOf(o.type) >= 0))) continue;
      var hw = (o.width || 0) / 2, h = o.height || 0;
      if (o.x + hw <= e.x - spawnRange || o.x - hw >= e.x + 1 + spawnRange ||
          o.y + h <= e.y - spawnRange || o.y >= e.y + 1 + spawnRange ||
          o.z + hw <= e.z - spawnRange || o.z - hw >= e.z + 1 + spawnRange) continue;
      n++;
    }
    return n;
  };

  /**
   * `BaseSpawner.serverTick`, dispatched from `BlockEntities.tick()` for every `mob_spawner`.
   * `e` is the block entity: `entity`, `delay`, `minDelay`, `maxDelay`, `count`, `spawnRange`,
   * `maxNearbyEntities`, `requiredPlayerRange` — `07c_blockentity.js`'s own defaults, D-395.
   */
  Spawn.tickSpawner = function (e) {
    var P = NS.Player, EL = NS.EntityList;
    if (!Spawn.ready || !P || !EL || !EL.ready) return false;
    var reqRange = e.requiredPlayerRange !== undefined ? e.requiredPlayerRange : Spawn.SPAWNER_DEFAULTS.requiredPlayerRange;
    var cx = e.x + 0.5, cy = e.y + 0.5, cz = e.z + 0.5;
    var dx = P.x - cx, dy = P.y - cy, dz = P.z - cz;
    var Gm = NS.Gm;
    if (P.dead || P.health <= 0 || (Gm && P.mode === Gm.SPECTATOR)) return false;   // EntityView.isPlayerInRange: EXCEPT_SPECTATOR + VALID_LIVING_ENTITY
    if (dx * dx + dy * dy + dz * dz >= reqRange * reqRange) return false;   // strict < (BaseSpawner.isNearPlayer)
    var rnd = Spawn.randInt;
    var min = e.minDelay !== undefined ? e.minDelay : 200, max = e.maxDelay !== undefined ? e.maxDelay : 800;
    if (e.delay === -1) e.delay = max <= min ? min : min + rnd(max - min);   // serverTick: spawnDelay == -1 ('unset') -> updateSpawns first
    if (e.delay > 0) { e.delay--; return false; }

    var type = NS.Entities.bare(e.entity || 'pig');
    var spawnRange = e.spawnRange !== undefined ? e.spawnRange : Spawn.SPAWNER_DEFAULTS.spawnRange;
    var maxNearby = e.maxNearbyEntities !== undefined ? e.maxNearbyEntities : Spawn.SPAWNER_DEFAULTS.maxNearbyEntities;
    var count = e.count || 4;
    var spawnedAny = false, early = !(EL.canSpawn(type) && Spawn.canPlace(type));   // unknown/unloadable id: updateSpawns + return

    if (!early) {
      for (var i = 0; i < count; i++) {
        var px = cx + (NS.EntityList.wr() - NS.EntityList.wr()) * spawnRange;
        var py = e.y + rnd(3) - 1;
        var pz = cz + (NS.EntityList.wr() - NS.EntityList.wr()) * spawnRange;
        if (!Spawn.checkPlacement(type, Math.floor(px), Math.floor(py), Math.floor(pz), 'spawner', rnd)) continue;
        if (maxNearby > 0 && Spawn.nearbySpawnedCount(e, type, spawnRange) >= maxNearby) { early = true; break; }   // after placement, as vanilla
        var ent = EL.spawn(type, px, py, pz);
        if (ent) {
          spawnedAny = true;
          if (NS.Spawner && NS.Spawner.applyEntityNbt) NS.Spawner.applyEntityNbt(ent, e.spawnData);   // SpawnData entity NBT -> the mob
          var Px = NS.Particle;   // syncWorldEvent(2004) then MobEntity.playSpawnEffects()
          if (Px && Px.worldEvent) Px.worldEvent(2004, e.x, e.y, e.z, 0);
          if (Px && Px.spawnEffects && NS.Entities.isLiving(type)) Px.spawnEffects(ent);
        }
      }
    }
    // MobSpawnerLogic.serverTick: updateSpawns only if something spawned or on an early return; an all-'continue' batch leaves delay 0 (retry next tick).
    if (!spawnedAny && !early) return false;
    e.delay = max <= min ? min : min + rnd(max - min);   // MobSpawnerLogic.updateSpawns: nextInt(max-min), so [min,max-1]
    if (NS.Spawner && NS.Spawner.updateSpawnEntry) NS.Spawner.updateSpawnEntry(e, rnd);   // updateSpawns: SpawnPotentials.getOrEmpty -> setSpawnEntry
    return spawnedAny;
  };

  /** Every gap this stage names rather than silently leaves. `spawncheck.mjs` holds this list
   *  closed the same way `EL.owed()`/`Use.OWED` are held closed elsewhere. */
  Spawn.OWED = [
    // struck #6337: the spawner's spinning miniature-mob DRAW is watched by tools/spawnerdraw.mjs (browser stage).
    'loop/spawn-cap: checkMobSpawnRules now reads BlockBehaviour.isValidSpawn\'s real per-block ' +
      'overrides (glass/tinted_glass/stained-glass/ice/frosted_ice/magma_block/leaves, ' +
      'Blocks.java, scoped to the mobs EL.spawnable() actually simulates) on top of the solid-' +
      'top-face default — the ~15 remaining overridden blocks (crimson/warped trapdoors, spawn ' +
      'chunk / enderman-only / fire-immune-only predicates on blocks no simulated mob type can ' +
      'ever satisfy anyway) are not tabled because no `Spawn.RULES` type can reach a different ' +
      'answer through them than the solid-top-face default already gives',
    // struck loop/despawn-s105: the despawn roll (1/800 AND the >600 despawnCounter gate), the
    // counter's own +1/+2 bookkeeping and every canImmediatelyDespawn override -- Spawn.despawnTick.
    'despawn is ticked from Spawn.despawnOne, called from EL.tickMob (#6336, vanilla checkDespawn slot) -- loop/spawn-cap struck the ' +
      '\'AI disabled still counts up\' half: despawnTick now freezes despawnCounter while ' +
      'e.aiDisabled is set (MobEntity:1272\'s own canMoveVoluntarily gate), though nothing in ' +
      'this engine can set that field yet'
    // struck loop/despawn-s105: Spawn.liveCount counts by the type's own SpawnGroup and skips
    // persistent/riding mobs (SpawnHelper.setupSpawn :65-83).
    // struck loop/spawn-cap: the category cap now scales by Spawn.spawningChunkCount() the
    // same way SpawnHelper.Info.isBelowCap does (capacity * spawningChunkCount / 289,
    // Spawn.categoryCap); the per-player SpawnDensityCapper is read in full and reasoned, not
    // modelled, in Spawn.categoryCap's own header -- provably redundant with the scaled cap
    // for this engine's single player at its shipped simulation-distance default.
    // struck D-511: isDarkEnoughToSpawn subtracts Sky.darknessNow() (World.calculateAmbientDarkness)
    // struck loop/spawnsweep-s104: the ONLY six engine-simulatable overworld mobs (EL.spawnable(),
    // motion-measured) that also carry a real biome spawner-table entry and had no Spawn.RULES
    // yet -- horse (loop/spawnsweep-s104's own Spawn.RULES.horse, shares cow's rule), ocelot,
    // parrot, wolf, witch, dolphin (shares squid's WaterCreatureEntity.canSpawn) -- are now wired.
    // Every OTHER EL.spawnable() type (cat/evoker/guardian/illusioner/iron_golem/pillager/
    // ravager/villager/vindicator, plus the non-mob entities) carries NO overworld biome
    // spawner-table row at all (probed against B.spawners() this session) -- guardian's own
    // ocean-monument structure spawner (now built: #1600, Spawn.RULES.guardian), villages, raids and illager patrols are a different
    // placement path this unit did not build, not a Spawn.RULES gap; named here rather than left unsaid.
    // struck D-511: SpawnRestriction.java:111 registers SKELETON with HostileEntity::canSpawnInDark
    // loop/fish-s99 (QUEUE 0.2 G18c): struck for water_ambient -- cod/salmon/pufferfish/
    // tropical_fish are now placeable (Spawn.RULES.cod/.salmon/.pufferfish/.tropical_fish).
    // water_creature was already struck by loop/squid-s98 without updating this line's own
    // text -- left as-is, not this unit's own line to rewrite twice.
    // struck cloud owed-spawn-owed: the axolotls category's placement (IN_WATER) -- Spawn.LOCATION.
  ];


  // ═══════════════ ROW 0.2 REMAINDER — the reputation/gossip substrate and the VILLAGE SPAWN
  // TRIGGER, javap'd off `.decomp/net/minecraft/village/{VillagerGossips,VillageGossipType}.java`
  // and `.decomp/net/minecraft/entity/passive/VillagerEntity.java` (`summonGolem`/
  // `canSummonGolem`/`spawnIronGolem`/`getHighestOpenPositionOnOffset`, `onInteractionWith`,
  // `InteractionObserver`/`EntityInteraction`, `.decomp/net/minecraft/entity/{EntityInteraction,
  // InteractionObserver}.java`) and `.decomp/.../ai/brain/sensor/GolemLastSeenSensor.java`.
  var Village = NS.Village = {};
  Village.ready = false;

  // `VillageGossipType`'s own <clinit>, javap'd verbatim: (key, multiplier, maxValue, decay,
  // shareDecrement). `share` is read by `Village.shareGossipFrom` below (s101).
  Village.GOSSIP = {
    major_negative: { mult: -5, max: 100, decay: 10, share: 10 },
    minor_negative: { mult: -1, max: 200, decay: 20, share: 20 },
    minor_positive: { mult: 1, max: 200, decay: 1, share: 5 },
    major_positive: { mult: 5, max: 100, decay: 0, share: 100 },
    trading: { mult: 1, max: 25, decay: 2, share: 20 }
  };

  // ⚠⚠ THE ONE-PLAYER COLLAPSE (see `07k_goals.js`'s own header on the same fact). Vanilla's
  // `VillagerGossips.entityReputation` is a `Map<UUID, Reputation>` — one bucket PER WITNESSED
  // ENTITY. This engine has exactly one entity that can ever be gossiped about (`NS.Player`,
  // the only possible attacker/trader/curer — `14j_combat.js`'s own header), so `e.gossip` is a
  // SINGLE `Reputation` bucket (`{type: value}`), not a map keyed by who it is about. Re-adding
  // the UUID dimension is a mechanical change the day a second player (or golem-vs-mob gossip)
  // exists; the SUM each function below returns is exactly what the map version would give for
  // that one entry.

  /** `VillagerGossips.startGossip`/`Reputation`'s own merge — `mergeReputation` clamps the SUM
   *  to `maxValue` (or keeps the larger of the two operands if the sum overshoots it), then
   *  `Reputation.clamp` drops the type below 2 (its own "obsolete" floor). */
  Village.startGossip = function (e, type, amount) {
    var t = Village.GOSSIP[type];
    if (!t || !e) return;
    if (!e.gossip) e.gossip = {};
    var cur = e.gossip[type] || 0;
    var sum = cur + amount;
    var val = sum > t.max ? Math.max(t.max, cur) : sum;
    if (val < 2) delete e.gossip[type]; else e.gossip[type] = val;
  };

  /** `VillagerEntity.getReputation(player)` — `VillagerGossips.getReputationFor(uuid, $$0 ->
   *  true)`: every gossip type counts, each weighted by its own `multiplier`. */
  Village.getReputation = function (e) {
    if (!e || !e.gossip) return 0;
    var sum = 0;
    for (var k in e.gossip) { var t = Village.GOSSIP[k]; if (t) sum += e.gossip[k] * t.mult; }
    return sum;
  };

  /** `VillagerEntity.decayGossip`/`VillagerGossips.Reputation.decay` — once every real day
   *  (24000 ticks, `lastGossipDecayTime`), every held gossip type ages down by its own `decay`,
   *  dropped once it falls under 2. */
  Village.decayGossip = function (e, now) {
    if (e.gossipLastDecay === undefined) { e.gossipLastDecay = now; return; }
    if (now - e.gossipLastDecay < 24000) return;
    e.gossipLastDecay = now;
    if (!e.gossip) return;
    for (var k in e.gossip) {
      var t = Village.GOSSIP[k];
      var v = e.gossip[k] - t.decay;
      if (v < 2) delete e.gossip[k]; else e.gossip[k] = v;
    }
  };

  /** Every live villager within an (dx,dy,dz) box of `e` — `ServerWorld.getNonSpectatingEntities
   *  (VillagerEntity.class, box)`'s own shape, `summonGolem`'s own (10,10,10) box in particular.
   *  Includes `e` itself, matching the jar (the box always contains its own centre). */
  Village.nearbyVillagers = function (e, dx, dy, dz) {
    var out = [];
    if (!NS.EntityList) return out;
    var list = NS.EntityList.list;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o.type !== 'villager' || o.removed || o.dead) continue;
      if (Math.abs(o.x - e.x) > dx || Math.abs(o.y - e.y) > dy || Math.abs(o.z - e.z) > dz) continue;
      out.push(o);
    }
    return out;
  };

  // `EntityInteraction`/`InteractionObserver` (`.decomp/net/minecraft/entity/`) — the four
  // gossip-generating events, javap'd: VILLAGER_HURT -> minor_negative(25) (`VillagerEntity.
  // setAttacker`, `handleInteraction(field_18476,...)`), VILLAGER_KILLED -> major_negative(25)
  // BROADCAST to every villager that had the victim in its own target cache (`notifyDeath`,
  // `handleInteraction(field_18477,...)` per observer — approximated here as every OTHER
  // villager in the SAME (10,10,10) box `summonGolem` itself uses, since this engine keeps no
  // per-villager visibility cache — named, not the jar's own radius), TRADE -> trading(2)
  // (`onInteractionWith(field_18478,...)`, `Trade.attempt`'s own call site) and
  // ZOMBIE_VILLAGER_CURED -> major_positive(20)+minor_positive(25) — OWED: this engine has no
  // zombie-villager-cure mechanic at all (`ZombieVillagerEntity` cure timer unbuilt), so that
  // fourth trigger cannot exist yet; named on `Village.OWED` below rather than guessed at.
  Village.onHurt = function (e, byEntity) {
    if (!e || e.type !== 'villager' || byEntity !== NS.Player) return;
    Village.startGossip(e, 'minor_negative', 25);
    if (e.dead && !e.gossipDeathReported) {
      e.gossipDeathReported = true;
      var obs = Village.deathObservers(e);
      for (var i = 0; i < obs.length; i++) Village.startGossip(obs[i], 'major_negative', 25);
    }
  };

  /** `VillagerEntity.notifyDeath` (.decomp VillagerEntity.java): VILLAGER_KILLED goes to every
   *  InteractionObserver (villager) in the victim's VISIBLE_MOBS `LivingTargetCache` — the MOBS
   *  list (NearestLivingEntitiesSensor: alive, not self, in the bounding box expanded by 16)
   *  filtered by `Sensor.TARGET_PREDICATE` (`createNonAttackable().setBaseMaxDistance(16)`:
   *  squared distance <= max(16 * observer.getAttackDistanceScalingFactor(victim), 2)^2, and
   *  the victim can SEE the observer — `Ai.canSee`). Fresh scan for MOBS, the same collapse
   *  `senseIronGolem` makes. */
  Village.attackDistanceScale = function (o) {
    // LivingEntity.getAttackDistanceScalingFactor: villagers never sneak; the mob-head clause
    // needs a skeleton/zombie/creeper base, never a villager victim. Invisible: 0.7 * max(0.1,
    // getArmorVisibility()) — worn armour pieces / 4.
    var ES = NS.Effects;
    if (!ES || !ES.hasStatusEffect || !ES.hasStatusEffect(o, 'invisibility')) return 1;
    var worn = 0, IT = NS.Items, Eq = NS.Equip;
    if (IT && Eq && Eq.getEquipped && o.equip) {
      var sl = [IT.FEET, IT.LEGS, IT.CHEST, IT.HEAD];
      for (var i = 0; i < 4; i++) if (Eq.getEquipped(o, sl[i])) worn++;
    }
    return 0.7 * Math.max(0.1, worn / 4);
  };
  Village.deathObservers = function (e) {
    var out = [], r = Village.MOBS_RANGE, Ai = NS.Ai;
    var list = NS.EntityList ? NS.EntityList.list : [];
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o === e || o.type !== 'villager' || o.removed || o.dead) continue;
      var dx = o.x - e.x, dy = o.y - e.y, dz = o.z - e.z;
      if (Math.abs(dx) > r || Math.abs(dy) > r || Math.abs(dz) > r) continue;
      var d = Math.max(Village.TARGET_MAX_DIST * Village.attackDistanceScale(o), 2);
      if (dx * dx + dy * dy + dz * dz > d * d) continue;
      if (Ai && Ai.canSee && !Ai.canSee(e, o)) continue;
      out.push(o);
    }
    return out;
  };
  Village.onTrade = function (e, player) {
    if (!e || e.type !== 'villager' || player !== NS.Player) return;
    Village.startGossip(e, 'trading', 2);
  };

  // ── THE VILLAGE SPAWN TRIGGER — `VillagerEntity.summonGolem`/`canSummonGolem`, javap'd.
  // Real vanilla only ever calls `summonGolem` from `talkWithVillager` (two villagers, chatting,
  // once every up-to-1200-tick window each) and PanicTask (07zv3_vbpanic.js, quorum 3). Here too:
  // `Village.talkWithVillager` calls `Village.summonGolem(...,SUMMON_QUORUM)`, and the talk is
  // `GatherItemsVillagerTask`'s own per-tick body (07zv6_vbgather.js) — no population poll.
  //
  // STRUCK loop/sleep-s104: `canSummonGolem`'s `hasRecentlySlept` gate used to be un-
  // reproduced here ("every villager behaves as if it always just slept") because no sleep/bed
  // AI existed to read. `07zv_villagerbrain.js`'s own `VB.tick` now sleeps villagers for real
  // (a claimed HOME bed, the VILLAGER_DEFAULT schedule's own REST window) and sets
  // `e.vbLastSlept`; `Village.hasRecentlySlept`, just below, reads it.
  Village.GOLEM_DETECTED_TICKS = 600;     // GolemLastSeenSensor.rememberIronGolem's own literal
  Village.MOBS_RANGE = 16;              // NearestLivingEntitiesSensor: expand(16.0, 16.0, 16.0)
  Village.TARGET_MAX_DIST = 16;         // Sensor.TARGET_PREDICATE: setBaseMaxDistance(16.0)
  Village.SUMMON_QUORUM = 5;              // VillagerEntity.talkWithVillager's own summonGolem(...,5) arg

  // loop/sleep-s104 -- VillagerEntity.hasRecentlySlept (.decomp VillagerEntity.java:996-999):
  // `now - LAST_SLEPT < 24000L`. `e.vbLastSlept` is the LAST_SLEPT memory this engine tracks,
  // written by 07zv_villagerbrain.js's own `VB.tick` when a villager actually sleeps in a
  // claimed HOME bed -- closes this file's own OWED line below (was: every villager always
  // eligible, no sleep AI existed to read at all).
  Village.HAS_RECENTLY_SLEPT_WINDOW = 24000;
  Village.hasRecentlySlept = function (e, now) {
    return e.vbLastSlept !== undefined && (now - e.vbLastSlept) < Village.HAS_RECENTLY_SLEPT_WINDOW;
  };

  // `VillagerEntity.canSummonGolem` (.decomp VillagerEntity.java:894): `!hasRecentlySlept() ->
  // false; else !hasMemoryModule(GOLEM_DETECTED_RECENTLY)`. `e.golemDetectedUntil > now` IS this
  // engine's own GOLEM_DETECTED_RECENTLY memory presence test (set by `summonGolem`'s own success
  // below, read nowhere else) -- unchanged; only the hasRecentlySlept half, above, is new.
  Village.canSummonGolem = function (e, now) {
    if (!Village.hasRecentlySlept(e, now)) return false;
    return !(e.golemDetectedUntil > now);
  };

  /** `Material.blocksLight()` for a block (Yarn; Mojang `isSolidBlocking`), asked by
   *  `getHighestOpenPositionOnOffset` of the cell under the candidate. Derived, not guessed:
   *  every `Material` in .decomp block/Material.java built with `notSolid()` also calls
   *  `lightPassesThrough()` EXCEPT `POWDER_SNOW`, and the SOLID materials that call it are
   *  COBWEB/TNT/LEAVES/GLASS/ICE/CACTUS (+ the unnamed-in-Yarn glass-like ones). Mapped onto
   *  blocks through tools/golden/block-materials-1.18.2.tsv, that is exactly the two lists
   *  below; golemposcheck.mjs re-derives both from the jar data and fails on any drift. */
  Village.SOLID_LIGHT_PASSES = [
    'acacia_leaves', 'azalea_leaves', 'beacon', 'birch_leaves', 'cactus', 'cobweb', 'conduit',
    'dark_oak_leaves', 'flowering_azalea_leaves', 'frosted_ice', 'glass', 'glass_pane', 'glowstone',
    'ice', 'jungle_leaves', 'oak_leaves', 'sea_lantern', 'spruce_leaves', 'tinted_glass', 'tnt'
  ].concat(['black', 'blue', 'brown', 'cyan', 'gray', 'green', 'light_blue', 'light_gray', 'lime',
    'magenta', 'orange', 'pink', 'purple', 'red', 'white', 'yellow'].reduce(function (a, c) {
    return a.concat([c + '_stained_glass', c + '_stained_glass_pane']);
  }, []));
  Village.NONSOLID_BLOCKS_LIGHT = ['powder_snow'];
  var lightPass = null, lightBlock = null;
  Village.materialBlocksLight = function (st) {
    if (!(st > 0)) return false;                       // AIR: lightPassesThrough
    var S = NS.States, R = NS.Reg;
    if (!lightPass) {
      lightPass = Object.create(null); lightBlock = Object.create(null);
      Village.SOLID_LIGHT_PASSES.forEach(function (n) { lightPass[n] = 1; });
      Village.NONSOLID_BLOCKS_LIGHT.forEach(function (n) { lightBlock[n] = 1; });
    }
    var b = S.block[st], nm = R.names[b];
    if (S.solidMat && S.solidMat[b] === 1) return lightPass[nm] !== 1;
    return lightBlock[nm] === 1;
  };
  /** `BlockState.isAir() || getMaterial().isLiquid()` — liquid MATERIAL is water, lava and
   *  bubble_column (Material.java: WATER/BUBBLE_COLUMN/LAVA are the three `.liquid()` builds);
   *  a waterlogged block is not a liquid material. */
  Village.airOrLiquid = function (st) {
    if (!(st > 0)) return true;
    var nm = NS.Reg.names[NS.States.block[st]];
    return nm === 'air' || nm === 'cave_air' || nm === 'void_air' ||
      nm === 'water' || nm === 'lava' || nm === 'bubble_column';
  };

  /** `VillagerEntity.getHighestOpenPositionOnOffset` (.decomp VillagerEntity.java:922-938),
   *  whole: start 6 above the villager's block at the (dx,dz) offset and walk DOWN; the first
   *  cell (from +6 to -6) that is air-or-liquid with a light-blocking material under it is the
   *  answer, else null. Only the column's own two questions — the golem's own canSpawn is
   *  asked after, by the caller, exactly as `spawnIronGolem` does. */
  Village.highestOpenOnOffset = function (bx, by, bz, dx, dz) {
    var W = NS.World;
    var x = bx + dx, z = bz + dz;
    for (var y = by + 6; y >= by - 6; y--) {
      if (Village.airOrLiquid(W.getBlock(x, y, z)) && Village.materialBlocksLight(W.getBlock(x, y - 1, z))) {
        return { x: x, y: y, z: z };
      }
    }
    return null;
  };

  /** `IronGolemEntity.canSpawn(WorldView)` (.decomp IronGolemEntity.java:324-341): a solid top
   *  surface below; the two cells above the feet clear for spawning WITH their fluid; the feet
   *  cell clear with an EMPTY fluid (so water at the feet is fine); and no other
   *  `intersectionChecked` entity (every LivingEntity, the player, primed TNT, a falling block —
   *  LivingEntity.java:239 etc.) inside the golem's box. `canSpawn(world, MOB_SUMMONED)` is
   *  `getPathfindingFavor >= 0`, and PathAwareEntity's own favour is a flat 0 — always true, so
   *  not modelled as a separate question. */
  Village.golemCanSpawnAt = function (x, y, z) {
    var W = NS.World, B = NS.Behave;
    var below = W.getBlock(x, y - 1, z);
    if (!(below > 0) || !(B && B.faceSturdy && B.faceSturdy(below, 1))) return false;
    for (var k = 1; k < 3; k++) if (!isClearForSpawn(W.getBlock(x, y + k, z), false)) return false;
    if (!isClearForSpawn(W.getBlock(x, y, z), true)) return false;
    var dim = NS.Entities.dimensions('iron_golem');
    var hw = dim.width / 2, cx = x + 0.5, cz = z + 0.5;
    var x0 = cx - hw, x1 = cx + hw, y0 = y, y1 = y + dim.height, z0 = cz - hw, z1 = cz + hw;
    var EL = NS.EntityList, list = (EL && EL.list) || [];
    var others = list.slice();
    if (NS.Player && NS.Player.x !== undefined) others.push(NS.Player);
    for (var i = 0; i < others.length; i++) {
      var o = others[i];
      if (o.removed || o.dead) continue;
      var isPlayer = o === NS.Player;
      var bare = isPlayer ? null : NS.Entities.bare(o.type);
      if (!isPlayer && !(NS.Entities.isLiving(bare) || bare === 'tnt' || bare === 'falling_block')) continue;
      var ow = isPlayer ? 0.3 : (o.width || 0) / 2, oh = isPlayer ? (o.height || 1.8) : (o.height || 0);
      if (o.x - ow < x1 && o.x + ow > x0 && o.y < y1 && o.y + oh > y0 && o.z - ow < z1 && o.z + ow > z0) return false;
    }
    return true;
  };

  /** `VillagerEntity.spawnIronGolem` (.decomp VillagerEntity.java:898-919): ten tries, each at
   *  (nextInt(16)-8, nextInt(16)-8) from the villager's block; a column answer the golem cannot
   *  spawn at is discarded and the NEXT try is taken (not the next cell down). */
  Village.findGolemSpawnPos = function (e, rand) {
    var W = NS.World;
    if (!W || !W.getBlock) return null;
    var bx = Math.floor(e.x), bz = Math.floor(e.z), by = Math.floor(e.y);
    for (var t = 0; t < 10; t++) {
      var dx = Math.floor(rand() * 16) - 8, dz = Math.floor(rand() * 16) - 8;
      var p = Village.highestOpenOnOffset(bx, by, bz, dx, dz);
      if (p && Village.golemCanSpawnAt(p.x, p.y, p.z)) return { x: p.x + 0.5, y: p.y, z: p.z + 0.5 };
    }
    return null;
  };

  /** `VillagerEntity.summonGolem(world, time, required)` (.decomp VillagerEntity.java:879-891):
   *  the eligible villagers in the (10,10,10) box, `limit(5)`, must number >= `required`; on a
   *  spawned golem EVERY villager in the box (`$$4`, not the filtered list) remembers it. Called
   *  by `talkWithVillager` (required 5) — no poll. */
  Village.summonGolem = function (e, now, rand, required) {
    if (!Village.canSummonGolem(e, now)) return null;
    var all = Village.nearbyVillagers(e, 10, 10, 10);
    var ok = all.filter(function (v) { return Village.canSummonGolem(v, now); }).slice(0, 5);
    if (ok.length < required) return null;
    if (!NS.EntityList || !NS.EntityList.ready || !NS.EntityList.spawn) return null;
    var pos = Village.findGolemSpawnPos(e, rand);
    if (!pos) return null;
    var g = NS.EntityList.spawn('iron_golem', pos.x, pos.y, pos.z);
    if (g) for (var i = 0; i < all.length; i++) all[i].golemDetectedUntil = now + Village.GOLEM_DETECTED_TICKS;
    return g || null;
  };

  // ── GOSSIP SHARING (s101) — `VillagerGossips.pickGossips`/`shareGossipFrom` and
  // `VillagerEntity.talkWithVillager`, .decomp verbatim. pickGossips: every held (target,type)
  // entry weighted by |value| (a cumulative table, `nextInt(total)` + binarySearch), `count`
  // draws into an IDENTITY set (a repeat draw adds nothing). shareGossipFrom: each picked entry's
  // value minus its type's shareDecrement, kept only if >= 2, merged with `VillagerGossips::max`
  // (NOT the clamped sum startGossip uses). talkWithVillager: only when BOTH villagers are
  // outside their own 1200-tick gossipStartTime window; the CALLER receives (this.gossip.
  // shareGossipFrom($$1.gossip ...)), both windows restart. With one player the UUID map
  // collapses to e.gossip (the ONE-PLAYER COLLAPSE above).
  Village.TALK_WINDOW = 1200;           // talkWithVillager's own 1200L literal
  Village.TALK_SHARE_COUNT = 10;        // talkWithVillager's own shareGossipFrom(..., 10)
  Village.pickGossips = function (src, rand, count) {
    var entries = [];
    if (src && src.gossip) for (var k in src.gossip) if (Village.GOSSIP[k]) entries.push(k);
    if (!entries.length) return [];
    var cum = new Array(entries.length), total = 0;
    for (var i = 0; i < entries.length; i++) { total += Math.abs(src.gossip[entries[i]]); cum[i] = total - 1; }
    var picked = {}, out = [];
    for (var n = 0; n < count; n++) {
      var r = Math.floor(rand() * total);
      var lo = 0, hi = cum.length - 1, idx = cum.length;
      while (lo <= hi) { var mid = (lo + hi) >> 1; if (cum[mid] >= r) { idx = mid; hi = mid - 1; } else lo = mid + 1; }
      var key = entries[idx];
      if (!picked[key]) { picked[key] = true; out.push(key); }
    }
    return out;
  };
  Village.shareGossipFrom = function (dst, src, rand, count) {
    var keys = Village.pickGossips(src, rand, count);
    for (var i = 0; i < keys.length; i++) {
      var t = Village.GOSSIP[keys[i]];
      var v = src.gossip[keys[i]] - t.share;
      if (v >= 2) {
        if (!dst.gossip) dst.gossip = {};
        dst.gossip[keys[i]] = Math.max(dst.gossip[keys[i]] || 0, v);
      }
    }
  };
  Village.talkWithVillager = function (a, b, now, rand) {
    var inA = a.gossipStartTime !== undefined && now >= a.gossipStartTime && now < a.gossipStartTime + Village.TALK_WINDOW;
    var inB = b.gossipStartTime !== undefined && now >= b.gossipStartTime && now < b.gossipStartTime + Village.TALK_WINDOW;
    if (inA || inB) return false;
    Village.shareGossipFrom(a, b, rand, Village.TALK_SHARE_COUNT);
    a.gossipStartTime = now; b.gossipStartTime = now;
    Village.summonGolem(a, now, rand, Village.SUMMON_QUORUM);
    return true;
  };
  /** One villager-tick's worth of gossip decay — mirrors `Trade.tick`'s own call shape (D-484),
   *  called from the SAME `EL.tickMob` site. The conversation (and the golem summon it carries)
   *  is `GatherItemsVillagerTask`'s per-tick body, 07zv6_vbgather.js's `VBGather.tick`. */
  Village.tick = function (e) {
    if (!e || e.type !== 'villager') return;
    var now = (NS.Sky && typeof NS.Sky.dayTime === 'number') ? NS.Sky.dayTime : 0;
    Village.decayGossip(e, now);
    Village.senseIronGolem(e, now);
  };

  /** `GolemLastSeenSensor` (.decomp .../brain/sensor/GolemLastSeenSensor.java; SensorType
   *  `golem_detected` is in VillagerEntity.SENSORS): a `Sensor(200)` — first fire after
   *  `RANDOM.nextInt(200)` ticks, then every 200 (Sensor.tick) — whose `senseIronGolem` remembers
   *  GOLEM_DETECTED_RECENTLY for 600 ticks when the MOBS memory (NearestLivingEntitiesSensor:
   *  every living entity but self in the bounding box expanded by 16) holds an iron golem. Using
   *  the sensor's own fresh scan for MOBS, the same collapse 07zv3_vbpanic.js's own
   *  `nearbyLivingNow` makes. */
  Village.GOLEM_SENSE_INTERVAL = 200;   // GolemLastSeenSensor(): this(200)
  Village.senseIronGolem = function (e, now) {
    if (e.golemSenseCD === undefined) e.golemSenseCD = Math.floor(NS.EntityList.wr() * Village.GOLEM_SENSE_INTERVAL);
    if (--e.golemSenseCD > 0) return;
    e.golemSenseCD = Village.GOLEM_SENSE_INTERVAL;
    var list = NS.EntityList && NS.EntityList.list, r = Village.MOBS_RANGE;
    if (!list) return;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o === e || o.type !== 'iron_golem' || o.dead || o.removed) continue;
      if (Math.abs(o.x - e.x) > r || Math.abs(o.y - e.y) > r || Math.abs(o.z - e.z) > r) continue;
      e.golemDetectedUntil = now + Village.GOLEM_DETECTED_TICKS;   // rememberIronGolem
      return;
    }
  };

  Village.OWED = [
    // STRUCK loop/sleep-s104: hasRecentlySlept is wired (Village.hasRecentlySlept, above),
    // reading e.vbLastSlept off 07zv_villagerbrain.js's own VB.tick -- a villager that has
    // never slept in a claimed bed, or hasn't in >=24000 ticks, now correctly cannot summon a
    // golem. That file's own VB.OWED names the remaining gaps in the sleep AI itself.
    // STRUCK cloud owed-village-owed: the conversation is GatherItemsVillagerTask's own per-tick
    // body (VBGather.tick -> talkWithVillager -> summonGolem(...,5)); both polls deleted.
    // ZOMBIE_VILLAGER_CURED gossip is wired now -- loop/zvillager-s102 (QUEUE 0.2 G18 mobs):
    // Zv.finishConversion (07zr_zvillager.js) calls Village.startGossip(major_positive,20)/
    // (minor_positive,25) on the freshly-cured villager, the exact magnitudes this file's own
    // header above already jar-verified.
    // STRUCK cloud owed-village-owed: VILLAGER_KILLED reaches Village.deathObservers — the victim's
    // VISIBLE_MOBS cache (16-box, TARGET_PREDICATE distance + canSee), villagegolemcheck section 12.
    // struck loop/golempos: findGolemSpawnPos is getHighestOpenPositionOnOffset's own air-or-liquid
    // over a blocksLight material walk + IronGolemEntity.canSpawn's three-cell/entity test (golemposcheck).
    // STRUCK cloud owed-village-owed: GolemLastSeenSensor.senseIronGolem is Village.senseIronGolem
    // (200-tick sensor over the 16-block MOBS box, villagegolemcheck section 11).
  ];

  Village.init = function () {
    Village.ready = !!(NS.EntityList && NS.World);
    return Village;
  };

  // ── G18c-a: CHUNK-GENERATION INITIAL SPAWN — `SpawnHelper.populateEntities` (#164) ──────────
  // `NoiseChunkGenerator.populateEntities` (.decomp NoiseChunkGenerator.java:448-456): the biome at
  // the chunk's start column, a `ChunkRandom` re-seeded by `setPopulationSeed(worldSeed, startX,
  // startZ)` (ChunkRandom.java:42-49), then `SpawnHelper.populateEntities` (SpawnHelper.java:322-
  // 383) drawing passive packs from the biome's `creature` list while
  // `nextFloat() < creature_spawn_probability`. Everything drawn from that ChunkRandom is drawn in
  // the jar's order; `SpawnRestriction.canSpawn` gets `world.getRandom()` (a different source), so
  // per-type rules take `Spawn.randInt`, not the chunk random.
  // SCOPE: a type this engine cannot simulate (`EL.canSpawn`/`Spawn.canPlace` false) is treated as
  // a failed `canSpawn` attempt (its own jitter draws still happen), so packs of those types are
  // absent, not mis-placed. The biome is the column's (2D) biome, not the 3D one at y=topY-1.
  /** `ChunkRandom.setPopulationSeed`, returning the seeded `LegacyRandom`. */
  Spawn.populationRandom = function (worldSeed, startX, startZ) {
    var LR = NS.Noise.LegacyRandom;
    var r = new LR(BigInt.asIntN(64, BigInt(worldSeed)));
    var a = BigInt.asIntN(64, r.nextLong()) | 1n, b = BigInt.asIntN(64, r.nextLong()) | 1n;
    var sd = BigInt.asIntN(64, BigInt(startX) * a + BigInt(startZ) * b) ^ BigInt.asIntN(64, BigInt(worldSeed));
    return new LR(BigInt.asIntN(64, sd));
  };

  /** `Heightmap.Type.MOTION_BLOCKING(_NO_LEAVES)`'s `getTopY`: one above the highest matching block. */
  Spawn.motionBlockingTop = function (x, z, noLeaves) {
    var W = NS.World, S = NS.States, R = NS.Reg;
    for (var y = W.heightAt(x, z) + 1; y >= NS.CFG.WORLD_MIN_Y; y--) {
      var st = W.getBlock(x, y, z);
      if (st === 0) continue;
      if (!(S.solid[st] === 1 || S.waterIn[st] || S.block[st] === R.id.lava)) continue;
      if (noLeaves && /_leaves$/.test(R.names[S.block[st]])) continue;
      return y + 1;
    }
    return NS.CFG.WORLD_MIN_Y;
  };

  /** `SpawnHelper.getEntitySpawnPos` (no ceiling: overworld). */
  function entitySpawnPos(type, x, z) {
    var bare = NS.Entities.bare(type);
    var y = Spawn.motionBlockingTop(x, z, !(bare === 'ocelot' || bare === 'parrot'));
    if (Spawn.locationOf(bare) === 'on_ground') {
      var W = NS.World, S = NS.States, below = W.getBlock(x, y - 1, z);
      if (below !== 0 && !S.solid[below] && !S.waterIn[below]) return y - 1;
    }
    return y;
  }

  /** Populate one chunk. `r` (optional) is the ChunkRandom. Returns the spawned entities. */
  Spawn.populateChunk = function (cx, cz, r) {
    var W = NS.World, B = NS.Biomes, EL = NS.EntityList, out = [];
    var sx = cx << 4, sz = cz << 4;
    var bi = W.biomeAt(sx, sz);
    var list = B.spawners(bi) && B.spawners(bi).creature;
    if (!list || !list.length) return out;
    r = r || Spawn.populationRandom(W.seed64, sx, sz);
    var prob = Math.fround(B.creatureSpawnProbability(bi));
    var total = 0, i;
    for (i = 0; i < list.length; i++) total += list[i].weight;
    while (r.nextFloat() < prob) {
      if (total <= 0) continue;
      var idx = r.nextInt(total), en = list[list.length - 1];
      for (i = 0; i < list.length; i++) { idx -= list[i].weight; if (idx < 0) { en = list[i]; break; } }
      var type = NS.Entities.bare(en.type);
      var n = en.minCount + r.nextInt(1 + en.maxCount - en.minCount);
      var x = sx + r.nextInt(16), z = sz + r.nextInt(16), x0 = x, z0 = z, made = 0, packData = {};
      var supported = EL.canSpawn(type) && Spawn.canPlace(type);
      var dim = NS.Entities.dimensions(type), w = dim ? dim.width : 0.6;
      for (var k = 0; k < n; k++) {
        var done = false;
        for (var t = 0; !done && t < 4; t++) {
          var y = entitySpawnPos(type, x, z);
          if (supported && Spawn.locationOk(Spawn.locationOf(type), x, y, z) && (Spawn.locationOf(type) !== 'on_ground' || Spawn.floorAllows(type, x, y, z))) {
            var px = Math.min(Math.max(x, sx + w), sx + 16 - w), pz = Math.min(Math.max(z, sz + w), sz + 16 - w);
            if (Spawn.spaceEmptyAt(type, px, y, pz, true) && Spawn.RULES[type](Math.floor(px), y, Math.floor(pz), 'chunk_generation', Spawn.randInt)) {
              var yaw = r.nextFloat() * 360;
              var e = EL.spawn(type, px, y, pz, { spawnIdx: made, packData: packData });
              if (e) { e.yaw = yaw; out.push(e); made++; done = true; }
            }
          }
          x += r.nextInt(5) - r.nextInt(5);
          z += r.nextInt(5) - r.nextInt(5);
          while (x < sx || x >= sx + 16 || z < sz || z >= sz + 16) {
            x = x0 + r.nextInt(5) - r.nextInt(5);
            z = z0 + r.nextInt(5) - r.nextInt(5);
          }
        }
      }
    }
    return out;
  };

  /** The `World.installChunk` hook: a chunk is populated once per session, never on a resumed save. */
  Spawn.populated = new Set();
  Spawn.onChunkInstalled = function (cx, cz) {
    if (!Spawn.ready || Spawn.POPULATE === false) return;
    if (NS.Save && NS.Save.loaded && Spawn.legacySave) return;   // a pre-#5087 save has no set
    var key = cx + ',' + cz;
    if (Spawn.populated.has(key)) return;
    Spawn.populated.add(key);
    Spawn.populateChunk(cx, cz);
  };

  Spawn.legacySave = false;
  Spawn.populatedToJSON = function () { return Array.from(Spawn.populated); };
  Spawn.populatedFromJSON = function (a) {
    Spawn.legacySave = !Array.isArray(a);
    Spawn.populated = new Set(Array.isArray(a) ? a : []);
  };

  Spawn.init = function () {
    Spawn.populated = new Set();
    typeCategory = null;
    Spawn.ready = !!(NS.World && NS.EntityList && NS.Biomes && NS.Entities);
    return Spawn;
  };

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
