// 07x_patrol.js — QUEUE 0.2 (raid loop remainder): `PatrolSpawner` (Yarn 1.18.2,
// net.minecraft.world.spawner.PatrolSpawner) — the natural, raid-INDEPENDENT roaming pillager
// patrols that carry the ominous banner in the first place. `07s_raid.js`'s own `Rd.OWED`
// names this exact gap ("patrol spawning — today Rd.onPatrolLeaderDeath exists but nothing in
// this engine ever spawns a patrol to trigger it"); this file closes it, and wires
// `PatrolEntity.PatrolGoal` (`.decomp/net/minecraft/entity/mob/PatrolEntity.java`, transcribed
// in full into `Ai.PatrolGoal`, 07k_goals.js's own raider-shared-goals block — the SAME goal
// class raiders themselves inherit through `Ai.addRaiderGoals`) onto every patrol member.
//
// Runs on: MAIN THREAD ONLY, the same shape `07s_raid.js` already uses — pure data/arithmetic,
// no DOM, so `patrolcheck.mjs` can drive it headless against a real World/EntityList.
//
// ⚠ WHAT THIS FILE SIMPLIFIES, NAMED RATHER THAN GUESSED (see `Ps.OWED` at the bottom):
// `isRegionLoaded`'s own 21×21-chunk check is approximated as `W.loadedAt` on the one spawn
// column (no chunk-ticket manager exists to ask further out); `Biome.Category.MUSHROOM`'s own
// spawn refusal (PatrolSpawner.java:57-59) is skipped outright — this engine's world generation
// has no `mushroom_fields` biome at all (checked: `19_data.gen.js` names no such biome), so the
// category this jar refuses can never occur here; `LocalDifficulty.getLocalDifficulty()`'s own
// per-chunk formula (member count, PatrolSpawner.java:61) has no substrate — this engine keeps
// no per-chunk difficulty model at all (`07v_spell.js`'s own header already names the same gap
// for `BlindTargetGoal`'s difficulty check) — so (since #5055) the count is ceil(Eq.localDifficulty)+1; and `SpawnHelper.isClearForSpawn`/
// `PatrolEntity.canSpawnIgnoreLightLevel`'s own per-block collision math is `Rd.canPlaceRaiderAt`
// — reused rather than duplicated, `07s_raid.js`'s own header already names that same gap for
// raid-spawned raiders.
(function (NS) {
  'use strict';
  // fallback stream when a caller passes no rng: the entity list's, else a fixed-seed JRandom (never Math.random, #6440)
  var fbR = null;
  function RNDFB() { var L = NS.EntityList; if (L && L.random) return L.random(); if (!fbR) fbR = NS.JRandom ? new NS.JRandom(0x6440) : { s: 0x6440, nextDouble: function () { this.s = (Math.imul(this.s, 1103515245) + 12345) >>> 0; return this.s / 4294967296; } }; return fbR.nextDouble(); }

  var Ps = NS.Patrol = { ready: false };

  // `PatrolSpawner.spawn` (PatrolSpawner.java:20-31): `this.cooldown = this.cooldown + 12000 +
  // rand.nextInt(1200)` — vanilla's own field starts at 0 (uninitialized int), so the FIRST
  // eligible tick of a fresh world rolls this countdown at once, same as here.
  Ps.SPAWN_COOLDOWN_MIN = 12000;
  Ps.SPAWN_COOLDOWN_SPAN = 1200;
  Ps.MIN_DIST = 24;    // (24 + rand.nextInt(24)) * (rand.nextBoolean() ? -1 : 1), each axis
  Ps.DIST_SPAN = 24;
  Ps.MIN_DAY = 5;       // world.getTimeOfDay() / 24000L < 5L -> refuse (PatrolSpawner.java:32)
  Ps.POI_RADIUS = 2;    // isNearOccupiedPointOfInterest(playerPos, 2), PatrolSpawner.java:44
  Ps.ODDS_DENOM = 5;    // rand.nextInt(5) != 0 -> refuse, a 1-in-5 roll per eligible tick
  // `LocalDifficulty.getLocalDifficulty()`'s own ceil()+1 formula, collapsed to this engine's
  // one GLOBAL difficulty (no per-chunk model — this file's own header). Named simplification,
  // not a jar constant: vanilla's real range is roughly 1-3 on peaceful/easy up through a wider
  // spread on hard as the world ages: `Ps.OWED` names it.
  // PatrolSpawner.java:60-66: (int)Math.ceil(world.getLocalDifficulty(pos).getLocalDifficulty()) + 1
  // at the spawn column; the regional value is Eq.localDifficulty (inhabited time, moon, difficulty).
  Ps.memberCount = function (NS2, x, z, difficulty) {
    if (difficulty === 'peaceful') return 0;
    var Eq = NS2.Equip;
    var ld = Eq && Eq.localDifficulty ? Eq.localDifficulty({ x: x, z: z, difficulty: difficulty }) : 0;
    return Math.ceil(ld) + 1;
  };

  Ps.state = { cooldown: 0 };

  Ps.init = function () {
    Ps.state.cooldown = 0;
    Ps.ready = true;
    return Ps;
  };

  /** `PatrolEntity.setRandomPatrolTarget` (PatrolEntity.java:130-133): a random point up to 500
   *  blocks off in X/Z, same Y — the far-off "somewhere to roam toward" a patrol leader is born
   *  with. Exported so `Ai.PatrolGoal`'s own re-target branch (07k_goals.js) can call the exact
   *  same formula once a leader arrives within 10 blocks of its current target. */
  Ps.setRandomPatrolTarget = function (mob, rand, atOrigin) {
    rand = rand || RNDFB;
    // `atOrigin`: PatrolSpawner.spawnPillager rolls the leader's target BEFORE setPosition, so the
    // entity is still at 0,0,0 and the target lands within +-500 of the world origin at y=0.
    var bx = atOrigin ? 0 : Math.floor(mob.x), by = atOrigin ? 0 : Math.floor(mob.y), bz = atOrigin ? 0 : Math.floor(mob.z);
    mob.patrolTarget = {
      x: bx - 500 + Math.floor(rand() * 1000),
      y: by,
      z: bz - 500 + Math.floor(rand() * 1000)
    };
    mob.patrolling = true;
  };

  /**
   * `PatrolSpawner.spawnPillager` (PatrolSpawner.java:84-104), minus the real
   * `SpawnHelper.isClearForSpawn`/`PatrolEntity.canSpawn` per-block collision math (this file's
   * own header — `Rd.canPlaceRaiderAt` stands in, the same substitute `07s_raid.js` already
   * uses for raid-spawned raiders). `isLeader` equips the ominous banner both as the `e.headItem`/
   * `e.ominousBanner` STATE flags (kept for `Ai.PickupBannerAsLeaderGoal`, 07k_goals.js) AND, QUEUE
   * 0.2's raid-loop remainder (this unit), as a REAL head-slot `ItemStack` (`Eq.getOminousBanner()`,
   * 07y_equip.js — closes `Rd.OWED`'s own "real mob equipment" line; G26 still owns rendering it)
   * and rolls a fresh random patrol target, same as `PatrolEntity.initialize`/`setRandomPatrolTarget`.
   */
  Ps.spawnPillager = function (NS2, x, y, z, isLeader, rand) {
    var W = NS2.World, EL = NS2.EntityList, Rd = NS2.Raid;
    if (!W || !EL || !EL.spawn || !Rd || !Rd.canPlaceRaiderAt) return null;
    if (!W.loadedAt || !W.loadedAt(x, z)) return null;
    // `PatrolEntity.canSpawn` (PatrolEntity.java:93-95): `getLightLevel(LightType.BLOCK, pos) >
    // 8` refuses. `LightType.BLOCK` is the raw block-emitted component only (no sky, no
    // darkness ramp) — `W.getLight`'s own low nibble, the same convention `Ai.
    // lightLevelDependentMagicValue`/`isDarkEnoughToSpawn` (07l_spawn.js) both already split it.
    var blk = W.getLight ? (W.getLight(x, y, z) & 15) : 0;
    if (blk > 8) return null;
    // #5561: SpawnHelper.canSpawn(ON_GROUND, pillager) = floor allowsSpawning + isClearForSpawn x2 + pillager-box isSpaceEmpty,
    // not Rd.canPlaceRaiderAt's ravager-box approximation. Light was refused above (PatrolEntity.canSpawn).
    var Sp = NS2.Spawn;
    if (Sp && Sp.canSpawnOnGround) {
      if (!Sp.canSpawnOnGround('pillager', x, y, z) || !Sp.clearForSpawn('pillager', x, y, z)) return null;
    } else if (!Rd.canPlaceRaiderAt(NS2, x, y, z)) return null;
    var mob = EL.spawn('pillager', x, y, z, { spawnReason: 'patrol' });   // D-671: PatrolEntity.initialize's own reason gate
    if (!mob) return null;
    mob.patrolling = true;
    if (isLeader) {
      mob.patrolLeader = true;
      mob.ominousBanner = true;
      mob.headItem = 'ominous_banner';   // legacy state flag `Ai.PickupBannerAsLeaderGoal` still
                                          // reads (07k_goals.js, not this unit's file) -- kept
                                          // alongside the real equip below, always in lockstep.
      // QUEUE 0.2 (raid loop remainder, this unit) -- `PatrolEntity.initialize`'s OWN equip half
      // (.decomp `PatrolEntity.java:84-85`): a REAL head-slot `ItemStack` now backs the state
      // flags above -- `Eq.getOminousBanner()` (07y_equip.js, `Raid.getOminousBanner()`
      // transcribed) at drop chance `Eq.OMINOUS_BANNER_DROP_CHANCE` (2.0F, forced-drop).
      if (NS2.Equip && NS2.Equip.ready) {
        NS2.Equip.setEquipped(mob, NS2.Items.HEAD, NS2.Equip.getOminousBanner());
        NS2.Equip.setDropChance(mob, NS2.Items.HEAD, NS2.Equip.OMINOUS_BANNER_DROP_CHANCE);
      }
      Ps.setRandomPatrolTarget(mob, rand, true);   // vanilla: before setPosition, so around 0,0,0
    }
    return mob;
  };

  /**
   * One tick of `PatrolSpawner.spawn` (PatrolSpawner.java:20-81) — the function `Main.worldTick`
   * calls. `NS2.Player` stands in for `world.getPlayers()` (this engine's one-player collapse,
   * the same standing `Rd.buildLiveCtx`'s own header already states for the raid loop).
   */
  Ps.tick = function (NS2) {
    if (!Ps.ready) return 0;
    // ServerChunkManager.tickChunks:380-383 — the custom spawners (PatrolSpawner among them) run
    // only under the SAME doMobSpawning flag as natural spawning ($$12); `Spawn.ready` is this
    // engine's doMobSpawning (D-397), so a check that holds it false gets no patrol either.
    if (NS2.Spawn && NS2.Spawn.ready === false) return 0;
    // PatrolSpawner.spawn: GameRules.DO_PATROL_SPAWNING gates before the timer, so the timer stops too.
    if (NS2.Commands && NS2.Commands.ruleGet && String(NS2.Commands.ruleGet('doPatrolSpawning')) === 'false') return 0;
    var W = NS2.World, Sky = NS2.Sky, player = NS2.Player;
    if (!W || !Sky || !player) return 0;
    Ps.state.cooldown--;
    if (Ps.state.cooldown > 0) return 0;
    Ps.state.cooldown = Ps.state.cooldown + Ps.SPAWN_COOLDOWN_MIN + Math.floor(RNDFB() * Ps.SPAWN_COOLDOWN_SPAN);
    var dayCount = Math.floor((Sky.dayTime || 0) / 24000);
    if (dayCount < Ps.MIN_DAY || !Sky.isDay()) return 0;
    if (Math.floor(RNDFB() * Ps.ODDS_DENOM) !== 0) return 0;
    RNDFB();   // players.get(rand.nextInt(playerCount)): one draw even for one player (bound 1 still advances the seed)
    if (player.isSpectator) return 0;
    var claimed = (NS2.Profession && NS2.Profession.ready) ? NS2.Profession.claimed : null;
    if (claimed && NS2.Raid && NS2.Raid.isNearOccupiedPOI &&
        NS2.Raid.isNearOccupiedPOI({ x: player.x, y: player.y, z: player.z }, claimed, Ps.POI_RADIUS)) return 0;
    var dx = (Ps.MIN_DIST + Math.floor(RNDFB() * Ps.DIST_SPAN)) * (RNDFB() < 0.5 ? -1 : 1);
    var dz = (Ps.MIN_DIST + Math.floor(RNDFB() * Ps.DIST_SPAN)) * (RNDFB() < 0.5 ? -1 : 1);
    var cx = Math.floor(player.x) + dx, cz = Math.floor(player.z) + dz;
    if (!W.loadedAt) return 0;
    for (let qx = (cx - 10) >> 4; qx <= (cx + 10) >> 4; qx++)
      for (let qz = (cz - 10) >> 4; qz <= (cz + 10) >> 4; qz++)
        if (!W.loadedAt(qx << 4, qz << 4)) return 0;
    var difficulty = (NS2.Diff && NS2.Diff.get) ? NS2.Diff.get() : 'normal';
    if (difficulty === 'peaceful') return 0;
    var count = Ps.memberCount(NS2, cx, cz, difficulty);
    if (!count) return 0;
    var placed = 0;
    for (var i = 0; i < count; i++) {
      var cy = W.heightAt ? W.heightAt(cx, cz) + 1 : player.y;
      var mob = Ps.spawnPillager(NS2, cx, cy, cz, i === 0, RNDFB);
      if (i === 0 && !mob) break;   // vanilla's own `break` when the LEADER fails, PatrolSpawner.java:67
      if (mob) placed++;
      cx += Math.floor(RNDFB() * 5) - Math.floor(RNDFB() * 5);
      cz += Math.floor(RNDFB() * 5) - Math.floor(RNDFB() * 5);
    }
    return placed;
  };

  Ps.OWED = [
    'Biome.Category.MUSHROOM\'s own spawn refusal — this engine\'s world generation has no ' +
      'mushroom_fields biome at all, so the category this jar refuses can never occur here; ' +
      'skipped rather than faked',
    'Ai.PatrolGoal\'s own simplifications (the perpendicular "circle toward the target" offset, ' +
      'the separate short-range wander() fallback) are named on Ai.OWED, in 07k_goals.js, next ' +
      'to the goal itself rather than duplicated here'
    // s98: includeFreeRaiders CLOSED -- a patrol member near a live raid is recruited (Rd.includeFreeRaiders).
  ];

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
