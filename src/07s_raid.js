// 07s_raid.js — QUEUE 0.2 (raid loop): `Raid` and `RaidManager` (Yarn 1.18.2,
// net.minecraft.village.raid.{Raid,RaidManager}) and the Bad-Omen exchange
// `RaiderEntity.onDeath` makes with a patrol's banner-wearing leader
// (net.minecraft.entity.raid.RaiderEntity#onDeath). Status effects themselves are
// `07q_effects.js` (D-497); this file is the state machine that reads and writes them.
//
// Runs on: MAIN THREAD ONLY. Pure data + arithmetic, no DOM — same shape `07q_effects.js`
// already uses, so the whole wave/bad-omen/victory machine runs inside `raidcheck` without a
// browser, a spawned mob, or a village.
//
// ⚠⚠ MOB EXISTENCE (loop/illagers-s92, QUEUE 0.2 raid loop, next step) — CLOSED for
// vindicator/pillager/witch/ravager/evoker/illusioner. `extract-entity-motion.mjs` now walks
// the class hierarchy (`GENERIC_CANDIDATES`, `reachesLivingEntityUnintercepted`) the way it
// already did for cow/zombie/villager/iron_golem, and all six raiders (each one read in full
// from `.decomp`: none overrides `travel()`, and the one `tick()` override on the chain —
// `SpellcastingIllagerEntity`'s — calls `super.tick()` first) resolve LivingEntity's own
// generic gravity/drag (0.08/0.98) exactly as those four did. `EL.spawn` therefore accepts all
// six (`07i_entitylist.js`'s closed-set rule reads the row, not a hand-kept list), each carries
// a real `Ai.ROSTER` entry (`07k_goals.js`, transcribed from each mob's own `initGoals()`) —
// including pillager's real `Ai.CrossbowAttackGoal`, the actual charge/hold/fire state machine
// (`CrossbowAttackGoal.java`, transcribed whole, not approximated with the skeleton's
// continuous-draw bow goal) — and `tools/raidmobcheck.mjs` proves all of this against an
// ACTUALLY SPAWNED mob driven through the live `EL.tick()` loop, the same standard
// `aicheck.mjs` already holds itself to.
//
// `vex` is the ONE deliberate exception, and it is a finding, not a gap: `VexEntity.tick()`
// (`bmr.k()`, read in full) calls `setNoGravity(true)` UNCONDITIONALLY every tick — vanilla
// vexes fly and have no gravity to resolve at all. `GENERIC_CANDIDATES` does not include it,
// `tools/golden/entity-motion-1.18.2.tsv` carries no row for it, and `EL.spawn('vex')` still
// refuses — `raidmobcheck.mjs` asserts all three, in both directions.
//
// STILL OWED, PRECISELY (see `Rd.OWED` at the bottom for the raid-mechanics half). (Pillager and
// ravager ARE textured since D-527 — their sheets come from the 1.18.2 jar via D-458's fallback,
// paths read off PillagerEntityRenderer/RavagerEntityRenderer's own TEXTURE constants.) Every raider's `RaiderEntity`/
// `PatrolEntity`-inherited goals (`PickupBannerAsLeaderGoal`, `MoveToRaidCenterGoal`,
// `AttackHomeGoal`, `CelebrateGoal`, `PatrolGoal`) are unwired — they need a live `Raid`/patrol
// object and a home/village position no spawned mob in this engine carries yet, the same gap
// `Rd.OWED`'s "patrol spawning"/"moveRaidCenter" lines already named. Witch's real potion throw
// (`ProjectileAttackGoal`) and evoker's/illusioner's spells (fangs, summon vex, wololo,
// blindness, invisibility) have no substrate — `Ai.OWED` names each. `RM.spawnWave`/
// `Rd.spawnNextWave` were ALREADY built to call a caller-supplied `spawnFn` rather than record
// members only, so nothing there needed to change for these six mobs to exist — but no live
// caller anywhere in `src/` wires a real `spawnFn` (`NS.EntityList.spawn`) into `Rd.tick` yet;
// this whole module is still reachable only from checks, never from the live game loop. That
// wiring is a separate unit, named here rather than silently assumed done.
(function (NS) {
  'use strict';

  var Rd = NS.Raid = { ready: true };

  // ── STATUS — `Raid.Status` (Raid.java:811-816, enum order ONGOING/VICTORY/LOSS/STOPPED). ──
  Rd.Status = { ONGOING: 'ongoing', VICTORY: 'victory', LOSS: 'loss', STOPPED: 'stopped' };

  // ── THE FIVE RAIDERS — `Raid.Member` (Raid.java:795-799). Declaration order matters: it is
  // the order `spawnNextWave` walks when handing the ominous banner to the first `canLead()`
  // raider it spawns (Raid.java:490-499), so a vindicator/evoker/pillager tie always goes to
  // whichever of them is declared first, never to whichever spawns fastest. Index 0 of each
  // array is unused (there is no wave 0); index = wave number, 1..7.
  Rd.MEMBER_ORDER = ['vindicator', 'evoker', 'pillager', 'witch', 'ravager'];
  Rd.MEMBERS = {
    vindicator: [0, 0, 2, 0, 1, 4, 2, 5],
    evoker:     [0, 0, 0, 0, 0, 1, 1, 2],
    pillager:   [0, 4, 3, 3, 4, 4, 4, 2],
    witch:      [0, 0, 0, 0, 3, 0, 0, 1],
    ravager:    [0, 0, 0, 1, 0, 1, 0, 2]
  };

  // `RaiderEntity.canLead()` — the base method (RaiderEntity.java) defaults true, and
  // `WitchEntity.canLead()` (WitchEntity.java:277-279) and `RavagerEntity.canLead()`
  // (RavagerEntity.java:337-339) are the only two overrides, both to false. Vindicator,
  // evoker and pillager never override it and so keep the base `true`.
  Rd.CAN_LEAD = { vindicator: true, evoker: true, pillager: true, witch: false, ravager: false };

  // `RaiderEntity.getCelebratingSound()` -- one sound event per raider type; `Ai.CelebrateGoal` reads this table.
  Rd.CELEBRATE_SOUND = { pillager: 'entity.pillager.celebrate', vindicator: 'entity.vindicator.celebrate', witch: 'entity.witch.celebrate', evoker: 'entity.evoker.celebrate', illusioner: 'entity.illusioner.ambient', ravager: 'entity.ravager.celebrate' };   // EvokerEntity.getCelebratingSound (all six raiders; illusioner's is its ambient event, IllusionerEntity.java:140)

  // ── DIFFICULTY-KEYED CONSTANTS ──────────────────────────────────────────────────────────
  // `Raid.getMaxWaves` (Raid.java:759-772). Peaceful never reaches this — `RaidManager.tick`
  // invalidates any raid the instant `world.getDifficulty()` reads PEACEFUL (Raid.java:246-249).
  Rd.MAX_WAVES = { peaceful: 0, easy: 3, normal: 5, hard: 7 };

  Rd.MAX_BAD_OMEN_LEVEL = 5;          // Raid.getMaxAcceptableBadOmenLevel (Raid.java:217-219)
  Rd.PATROL_BAD_OMEN_CLAMP = 4;       // RaiderEntity.onDeath's own clamp(0,4) (line ~149)
  Rd.PATROL_BAD_OMEN_DURATION = 120000; // RaiderEntity.onDeath's own literal (line ~156)
  Rd.HERO_DURATION = 48000;           // Raid.tick's StatusEffectInstance(HERO_OF_THE_VILLAGE,...) (line ~364)
  Rd.RAID_TIMEOUT_TICKS = 48000;      // Raid.tick: ticksActive >= 48000L -> invalidate (line ~274)
  Rd.PRE_WAVE_HORN_TICKS = 300;       // Raid.tick's own preRaidTicks = 300 (line ~285)
  Rd.POST_RAID_WIN_DELAY = 40;        // Raid.tick's own postRaidTicks < 40 gate (line ~354)
  Rd.SPAWN_RING_RADIUS = 32;          // Raid.getRavagerSpawnLocation's own 32.0F (line ~626)
  Rd.SPAWN_JITTER = 5;                // ...and its own random.nextInt(5) (lines 626-627)
  Rd.RAID_REUSE_DIST_SQ = 9216;       // ServerWorld.getRaidAt(pos) -> RaidManager.getRaidAt(pos, 9216) — 96-block radius reuse

  /** `Raid.Member.getCount`-equivalent (Raid.java:697-699): the base count for this wave, or
   *  (on the bad-omen bonus wave) the FINAL wave's own count reused. */
  Rd.getCount = function (memberArr, waveIdx, waveCount, isExtraWave) {
    return isExtraWave ? (memberArr[waveCount] || 0) : (memberArr[waveIdx] || 0);
  };

  /**
   * `Raid.getBonusCount` (Raid.java:700-726), ported branch-for-branch including the ONE
   * quirk worth naming: on EASY, the pillager/vindicator branch calls `random.nextInt(2)` to
   * pick `n`, and then — regardless of which branch set `n` — the shared tail below still
   * calls `random.nextInt(n + 1)` a SECOND time. That is what the jar does; a version that
   * "simplified" it to one random call would no longer draw from the jar's own distribution.
   * `randInt(bound)` must return an integer in `[0, bound)` (the `Random.nextInt` contract).
   */
  Rd.getBonusCount = function (type, randInt, waveIdx, difficulty, isExtraWave) {
    var n;
    switch (type) {
      case 'witch':
        if (difficulty === 'easy' || waveIdx <= 2 || waveIdx === 4) return 0;
        n = 1;
        break;
      case 'pillager':
      case 'vindicator':
        if (difficulty === 'easy') n = randInt(2);
        else if (difficulty === 'normal') n = 1;
        else n = 2;
        break;
      case 'ravager':
        n = (difficulty !== 'easy' && isExtraWave) ? 1 : 0;
        break;
      default:
        return 0;
    }
    return n > 0 ? randInt(n + 1) : 0;
  };

  Rd.hasStarted = function (raid) { return raid.wavesSpawned > 0; };           // Raid.hasSpawned
  Rd.hasExtraWave = function (raid) { return raid.badOmenLevel > 1; };         // Raid.hasExtraWave
  Rd.hasSpawnedFinalWave = function (raid) { return raid.wavesSpawned === raid.waveCount; };
  Rd.hasSpawnedExtraWave = function (raid) { return raid.wavesSpawned > raid.waveCount; };
  Rd.shouldSpawnMoreGroups = function (raid) {
    return Rd.hasExtraWave(raid) ? !Rd.hasSpawnedExtraWave(raid) : !Rd.hasSpawnedFinalWave(raid);
  };
  Rd.isSpawningExtraWave = function (raid) {
    return Rd.hasSpawnedFinalWave(raid) && raid.raiders.length === 0 && Rd.hasExtraWave(raid);
  };
  Rd.canSpawnRaiders = function (raid) {
    return raid.preRaidTicks === 0 && (raid.wavesSpawned < raid.waveCount || Rd.isSpawningExtraWave(raid))
      && raid.raiders.length === 0;
  };

  /** A fresh `Raid` — the fields `writeNbt`/`tick` actually touch (Raid.java's constructor,
   *  lines ~110-118), minus the bossbar OBJECT: `raid.bar` below is DATA (name/percent/visible),
   *  not a UI widget — "the raid bossbar state as data", per this unit's brief. */
  Rd.create = function (id, center, difficulty) {
    return {
      id: id,
      center: { x: center.x, y: center.y, z: center.z },
      difficulty: difficulty,
      status: Rd.Status.ONGOING,
      badOmenLevel: 0,
      waveCount: Rd.MAX_WAVES[difficulty] || 0,
      wavesSpawned: 0,
      ticksActive: 0,
      preRaidTicks: 0,
      preCalculatedSpawn: null,   // Raid.preCalculatedRavagerSpawnLocation
      postRaidTicks: 0,
      finishCooldown: 0,
      started: false,
      // `Raid.tick`'s own outer retry index ($$6, Raid.java:341-343): grows by one every time
      // `getRavagerSpawnLocation` fails every attempt this tier, resets to 0 the tick a wave
      // actually spawns. `Rd.findRaiderSpawnPos` reads it; `Rd.tick` writes it.
      spawnTier: 0,
      raiders: [],          // live raider refs currently in the raid, any wave
      waveCaptain: {},       // waveNum -> raider ref (the one carrying the banner)
      heroes: {},            // hero-of-the-village candidates, keyed by whatever id the caller uses
      bar: { name: 'raid', percent: 0, visible: false, raidersRemaining: 0 }
    };
  };

  /**
   * `Raid.start` (Raid.java:229-235): a player's Bad Omen amplifier feeds the raid's OWN
   * `badOmenLevel` (amplifier + 1, clamped to `[0, MAX_BAD_OMEN_LEVEL]`), and the effect is
   * always consumed off the player — win, lose, or capped.
   */
  Rd.start = function (raid, player, ES) {
    var inst = ES.getStatusEffect(player, 'bad_omen');
    if (inst) {
      raid.badOmenLevel = raid.badOmenLevel + inst.amplifier + 1;
      if (raid.badOmenLevel < 0) raid.badOmenLevel = 0;
      if (raid.badOmenLevel > Rd.MAX_BAD_OMEN_LEVEL) raid.badOmenLevel = Rd.MAX_BAD_OMEN_LEVEL;
    }
    ES.removeStatusEffect(player, 'bad_omen');
    return raid;
  };

  /**
   * `StatusEffects.field_16595`'s (bad_omen) own `applyUpdateEffect`
   * (StatusEffects.java:95-107): every tick a player carries Bad Omen, on any difficulty but
   * Peaceful, while standing near an occupied village, the raid manager is asked to start a
   * raid. `isNearVillage` stands in for `ServerWorld.isNearOccupiedPointOfInterest` — this
   * engine has no POI-storage manager yet (`07l_spawn.js`'s own `Village` module tracks
   * villagers, not claimed job/bed sites), so the caller decides what "near a village" means;
   * named here rather than silently assumed.
   */
  Rd.shouldTriggerRaid = function (player, ES, difficulty, isNearVillage) {
    if (!player || difficulty === 'peaceful') return false;
    if (player.isSpectator) return false;
    if (!ES.hasStatusEffect(player, 'bad_omen')) return false;
    return !!isNearVillage;
  };

  // ── "NEAR A VILLAGE", RULED (QUEUE 0.2, the live caller) ──────────────────────────────────
  // `ServerWorld.isNearOccupiedPointOfInterest(pos)` -> `isNearOccupiedPointOfInterest(pos, 1)`
  // (ServerWorld.java:1204-1205) -> `getOccupiedPointOfInterestDistance` ->
  // `PointOfInterestStorage.getDistanceFromNearestOccupied` (PointOfInterestStorage.java:
  // 153-155), a section-distance FLOOD FILL over every POI the world has ever indexed (beds,
  // bells, every profession's workstation, ...) capped at radius 1. `Profession.claimed`
  // (07o_profession.js, one entry per villager's claimed workstation block) is joined below
  // (loop/raidpoi-s103) by `NS.Poi.occupiedPositions()` (07zu_poi.js) — the bed/HOME and
  // bell/MEETING POI kinds `Rd.OWED` used to name as entirely missing. RULING, STILL NAMED NOT
  // SILENTLY CLOSED: a claimed workstation OR a ticket-occupied HOME/MEETING POI both stand in
  // for "an occupied point of interest"; nothing in this engine yet RESERVES a HOME/MEETING
  // ticket (no villager sleep AI, no meeting-rally AI — `Poi.OWED`), so in live play today the
  // union is still driven only by `Profession.claimed`, same as before this pass, but the
  // substrate for the other two kinds is now real rather than absent.
  Rd.POI_RADIUS_SECTIONS = 1;   // ServerWorld.isNearOccupiedPointOfInterest(pos) -> (pos, 1)

  function sectionOf(v) { return Math.floor(v / 16); }

  /** Every `Profession.claimed` key ('x,y,z') as a `{x,y,z}`, PLUS every occupied `NS.Poi`
   *  position (`Poi.occupiedPositions`, 07zu_poi.js) — the real union this file's own "NEAR A
   *  VILLAGE" header above describes. `claimed` may be null (a caller with no `Profession`);
   *  `NS.Poi` may not exist at all (a check that did not load 07zu_poi.js) — both are optional,
   *  neither being present just means an empty list from that half. */
  function claimedPositions(claimed) {
    var out = [];
    if (claimed) {
      for (var key in claimed) {
        if (!claimed.hasOwnProperty(key)) continue;
        var p = key.split(',');
        out.push({ x: +p[0], y: +p[1], z: +p[2] });
      }
    }
    if (NS.Poi && NS.Poi.ready && NS.Poi.occupiedPositions) {
      var extra = NS.Poi.occupiedPositions();
      for (var i = 0; i < extra.length; i++) out.push(extra[i]);
    }
    return out;
  }

  /**
   * `isNearOccupiedPointOfInterest(pos, 1)`'s own test, ported onto `Profession.claimed`. The
   * real check is a hop-distance flood fill over 26-connected chunk sections (the same
   * connectivity vanilla's other chunk-distance graphs, e.g. the ticket manager, already use)
   * capped at 1 hop; a hop-distance-<=1 flood fill and a section-Chebyshev-distance-<=1 test
   * agree EXACTLY at radius 1 (every section one hop away in a 26-connected graph is also
   * Chebyshev-adjacent, and vice versa) — this is exact for this one radius, not an
   * approximation that happens to work here.
   */
  Rd.isNearOccupiedPOI = function (pos, claimed) {
    var sx = sectionOf(pos.x), sy = sectionOf(pos.y), sz = sectionOf(pos.z);
    var pois = claimedPositions(claimed);
    for (var i = 0; i < pois.length; i++) {
      var p = pois[i];
      var d = Math.max(Math.abs(sectionOf(p.x) - sx), Math.abs(sectionOf(p.y) - sy), Math.abs(sectionOf(p.z) - sz));
      if (d <= Rd.POI_RADIUS_SECTIONS) return true;
    }
    return false;
  };

  /**
   * `RaidManager.startRaid`'s own POI-centroid average (the "mean position of every POI in a
   * 64-block circle") — `claimedPositions` (above) now unions claimed workstations with every
   * occupied `NS.Poi` HOME/MEETING position (loop/raidpoi-s103), so this averages over every POI
   * kind this engine can currently prove is occupied, not just workstations; see that function's
   * own doc for what "occupied" still cannot include yet. Every position within
   * `Rd.isNearOccupiedPOI` distance of `pos` is averaged into a candidate village center. Returns
   * null when none are near, which the caller reads as "no village here" (vanilla's own
   * `getNearestVillage` finding nothing).
   */
  Rd.villageCenterNear = function (pos, claimed) {
    var sx = sectionOf(pos.x), sy = sectionOf(pos.y), sz = sectionOf(pos.z);
    var pois = claimedPositions(claimed);
    var sum = { x: 0, y: 0, z: 0 }, n = 0;
    for (var i = 0; i < pois.length; i++) {
      var p = pois[i];
      var d = Math.max(Math.abs(sectionOf(p.x) - sx), Math.abs(sectionOf(p.y) - sy), Math.abs(sectionOf(p.z) - sz));
      if (d > Rd.POI_RADIUS_SECTIONS) continue;
      sum.x += p.x; sum.y += p.y; sum.z += p.z; n++;
    }
    return n ? { x: sum.x / n, y: sum.y / n, z: sum.z / n } : null;
  };

  /**
   * `Raid.moveRaidCenter` (Raid.java:396-401), closed this pass (loop/raidpoi-s103): every chunk
   * SECTION within Chebyshev distance 2 of the raid's current center (vanilla's own
   * `ChunkSectionPos.stream(ChunkSectionPos.from(center), 2)`, a 5x5x5 cube of sections),
   * filtered to those whose own CENTER position is itself near an occupied POI
   * (`Rd.isNearOccupiedPOI`, the same section-Chebyshev-distance-1 substitute this file's own
   * header already proves exact at that radius), picks the section center CLOSEST to the old
   * center and recenters the raid there. `claimed` is `Profession.claimed` (or null); the
   * occupied-POI union itself (workstations + `NS.Poi`) happens inside `Rd.isNearOccupiedPOI`.
   */
  Rd.moveRaidCenter = function (raid, claimed) {
    if (!raid || !raid.center) return;
    var c = raid.center;
    var csx = sectionOf(c.x), csy = sectionOf(c.y), csz = sectionOf(c.z);
    var best = null, bestD = Infinity;
    for (var dx = -2; dx <= 2; dx++) {
      for (var dy = -2; dy <= 2; dy++) {
        for (var dz = -2; dz <= 2; dz++) {
          var cand = { x: (csx + dx) * 16 + 8, y: (csy + dy) * 16 + 8, z: (csz + dz) * 16 + 8 };
          if (!Rd.isNearOccupiedPOI(cand, claimed)) continue;
          var ddx = cand.x - c.x, ddy = cand.y - c.y, ddz = cand.z - c.z;
          var d = ddx * ddx + ddy * ddy + ddz * ddz;
          if (d < bestD) { bestD = d; best = cand; }
        }
      }
    }
    if (best) raid.center = best;
  };

  // ── RAID MANAGER — one world's raid table, `RaidManager` (RaidManager.java). ──────────────
  var RM = NS.RaidManager = { ready: true };

  RM.create = function () { return { raids: {}, nextId: 1 }; };

  /** raids.dat (RaidManager.writeNbt / Raid.writeNbt): every field but the live raider refs, which are
   *  re-found by id (`RM.relink`) once the mobs are back. */
  RM.toJSON = function (rm) {
    if (!rm) return undefined;
    var raids = [];
    for (var id in rm.raids) {
      if (!rm.raids.hasOwnProperty(id)) continue;
      var r = rm.raids[id], o = {};
      for (var k in r) { if (r.hasOwnProperty(k) && k !== 'raiders' && k !== 'waveCaptain' && k !== 'bar') o[k] = r[k]; }
      raids.push(JSON.parse(JSON.stringify(o)));
    }
    return { nextId: rm.nextId, raids: raids };
  };
  RM.fromJSON = function (rm, o) {
    rm.raids = {}; rm.nextId = 1;
    if (!o || !o.raids) return rm;
    rm.nextId = o.nextId | 0 || 1;
    for (var i = 0; i < o.raids.length; i++) {
      var d = o.raids[i];
      if (!d || d.id === undefined) continue;
      var r = Rd.create(d.id, d.center, d.difficulty);
      for (var k in d) { if (d.hasOwnProperty(k)) r[k] = d[k]; }
      rm.raids[r.id] = r;
    }
    return rm;
  };
  /** After the mobs are restored: every mob carrying a `raidId` rejoins that raid at its own wave. */
  RM.relink = function (rm, list) {
    if (!rm || !list) return 0;
    var n = 0;
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (!m || m.removed || m.dead || m.raidId === undefined || m.raidId === null) continue;
      var r = rm.raids[m.raidId];
      if (!r) { m.raidId = undefined; continue; }
      Rd.addRaider(r, m.wave | 0, m);
      if (m.patrolLeader && m.ominousBanner) r.waveCaptain[m.wave | 0] = m;
      n++;
    }
    return n;
  };

  /** `ServerWorld.getRaidAt` -> `RaidManager.getRaidAt(pos, 9216)`: the nearest ACTIVE raid
   *  within a 96-block radius of `pos`, or null. */
  RM.getRaidAt = function (rm, pos) {
    var best = null, bestD = Rd.RAID_REUSE_DIST_SQ;
    for (var id in rm.raids) {
      if (!rm.raids.hasOwnProperty(id)) continue;
      var r = rm.raids[id];
      if (r.status === Rd.Status.STOPPED) continue;
      var dx = r.center.x - pos.x, dy = r.center.y - pos.y, dz = r.center.z - pos.z;
      var d = dx * dx + dy * dy + dz * dz;
      if (d <= bestD) { best = r; bestD = d; }
    }
    return best;
  };

  /**
   * `RaidManager.startRaid` (RaidManager.java:69-133), minus the spectator/dimension/
   * DISABLE_RAIDS gates (this engine has one dimension and no `/gamerule` wiring for
   * `disableRaids` yet — named on `Rd.OWED`) and minus the POI-centroid averaging (the caller
   * supplies `pos` as the raid's center directly, same simplification `shouldTriggerRaid`
   * above already makes). Reuses an existing raid within 96 blocks; otherwise starts one.
   */
  /** s98 -- the `disableRaids` gamerule, live (`Commands.RULES_LIVE.disableRaids`). Read off
   *  `Commands.ruleGet` exactly as `Cr.explode` reads mobGriefing; no Commands = default false. */
  RM.raidsDisabled = function () {
    var C = NS.Commands;
    return !!(C && C.ruleGet) && String(C.ruleGet('disableRaids')) === 'true';
  };
  RM.startRaid = function (rm, player, pos, difficulty, ES) {
    if (difficulty === 'peaceful') return null;
    // RaidManager.java:81-82 -- the gamerule refuses BEFORE the Bad Omen is consumed.
    if (RM.raidsDisabled()) return null;
    var raid = RM.getRaidAt(rm, pos);
    var shouldStart = false;
    if (!raid) {
      raid = Rd.create(rm.nextId++, pos, difficulty);
      rm.raids[raid.id] = raid;
      shouldStart = true;
    } else if (!Rd.hasStarted(raid)) {
      shouldStart = true;
    } else if (raid.badOmenLevel < Rd.MAX_BAD_OMEN_LEVEL) {
      shouldStart = true;
    } else {
      ES.removeStatusEffect(player, 'bad_omen');
    }
    if (shouldStart) {
      Rd.start(raid, player, ES);
      if (!Rd.hasStarted(raid)) {   // RaidManager.java:122-125: `!raid.hasSpawned()` -> RAID_TRIGGER stat + VOLUNTARY_EXILE
        if (NS.Stats && NS.Stats.inc) NS.Stats.inc('raid_trigger');
        if (NS.Adv && NS.Adv.trigger) NS.Adv.trigger(player, 'minecraft:voluntary_exile', { player: player });
      }
    }
    return raid;
  };

  /** `Raid.getRavagerSpawnLocation`'s own ring math (Raid.java:619-635): a random angle, a
   *  32-block-per-tier ring around the raid center, plus a 5-block jitter on each axis. `tier`
   *  is the OUTER retry index (0..3) `Raid.tick`'s `while (canSpawnRaiders())` loop passes;
   *  the height/POI/spawn-rule search this method ALSO does (its inner `for` loop, the
   *  `world.getTopY`/`isNearOccupiedPointOfInterest`/`SpawnHelper.canSpawn` checks) is named
   *  on `Rd.OWED` rather than ported — this engine has no world reference to ask, so `y`
   *  and any de-duplication against the village itself are the caller's `heightAt`. */
  Rd.ringSpawnPos = function (center, tier, rand) {
    var scale = tier === 0 ? 2 : 2 - tier;
    var angle = rand.nextFloat() * Math.PI * 2;
    var x = center.x + Math.floor(Math.cos(angle) * Rd.SPAWN_RING_RADIUS * scale) + rand.nextInt(Rd.SPAWN_JITTER);
    var z = center.z + Math.floor(Math.sin(angle) * Rd.SPAWN_RING_RADIUS * scale) + rand.nextInt(Rd.SPAWN_JITTER);
    return { x: x, z: z };
  };

  /**
   * `SpawnHelper.canSpawn(Location.ON_GROUND, world, pos, type)`'s own ground+clearance half
   * (SpawnHelper.java:297-317, the `field_6317`/default branch): solid ground below, and both
   * `pos` and `pos.up()` clear. Approximated the same way `checkMobSpawnRules`/
   * `Village.findGolemSpawnPos` already do elsewhere in this engine (07l_spawn.js's own file
   * header item 3) — a single solid top face below, plain air at the two cells above it — NOT
   * the real per-block `allowsSpawning`/`isClearForSpawn` collision-box math, nor any raider
   * type's own `canSpawn` override (unverified this pass, `Rd.OWED`). `NS2.World` missing
   * (a headless check, no world at all) is read as "cannot refuse" rather than "always refuse",
   * so a caller with no world substrate still gets ring math to assert against.
   */
  Rd.canPlaceRaiderAt = function (NS2, x, y, z) {
    var W = NS2 && NS2.World, B = NS2 && NS2.Behave;
    if (!W || !W.getBlock) return true;
    if (W.loadedAt && !W.loadedAt(x, z)) return false;
    if (W.tickingAt && !W.tickingAt(x, z)) return false;
    if (x < -29999984 || x >= 29999984 || z < -29999984 || z >= 29999984) return false;   // getWorldBorder().contains(pos)
    var Sp = NS2.Spawn;
    if (Sp && Sp.canSpawnOnGround) return Sp.canSpawnOnGround('ravager', x, y, z);   // #5141: the shared substrate
    var below = W.getBlock(x, y - 1, z);
    if (below === 0 || !(B && B.faceSturdy && B.faceSturdy(below, 1))) return false;
    return W.getBlock(x, y, z) === 0 && W.getBlock(x, y + 1, z) === 0;
  };

  /**
   * `Raid.getRavagerSpawnLocation(tier, attempts)` (Raid.java:619-639): up to `attempts` ring
   * candidates (`Rd.ringSpawnPos`'s own math is that inner loop body, already ported); a
   * candidate is accepted once it is either not near an occupied POI OR `tier >= 2` (the jar's
   * own `$$0 >= 2` bypass — by the third/fourth tier the search stops avoiding villages, on the
   * theory that a raid already IN one does not need to dodge it) AND the ground/clearance test
   * passes. Returns null when every candidate this tier failed, same as the jar's own null —
   * its caller (`Rd.findRaiderSpawnPos`'s own caller, `Rd.tick`) reads that as "try again next
   * tick, one tier wider", never as an error.
   */
  Rd.findRaiderSpawnPos = function (raid, tier, attempts, ctx) {
    for (var i = 0; i < attempts; i++) {
      var xz = Rd.ringSpawnPos(raid.center, tier, ctx.rand);
      var y = ctx.heightAt(xz.x, xz.z);
      var pos = { x: xz.x, y: y, z: xz.z };
      var near = ctx.claimed ? Rd.isNearOccupiedPOI(pos, ctx.claimed) : false;
      if ((!near || tier >= 2) && ctx.isSpawnable(pos.x, pos.y, pos.z)) return pos;
    }
    return null;
  };

  /** `Raid.updateBar` (Raid.java:544-551) plus the raiders-remaining name switch out of
   *  `Raid.tick` (lines ~309-318) — as DATA (name/percent/visible), never a rendered widget. */
  Rd.updateBar = function (raid) {
    var n = raid.raiders.length;
    raid.bar.raidersRemaining = n;
    // Raid.updateBar: percent = clamp(currentRaiderHealth / totalHealth); totalHealth only grows within a wave
    // (addToWave adds, a kill does not subtract) and restarts at 0 for the next one (spawnNextWave).
    var cur = 0;
    for (var i = 0; i < n; i++) { var h = raid.raiders[i].health; cur += (typeof h === 'number') ? h : 1; }
    if (n === 0) raid.totalHealth = 0;
    else if (cur > (raid.totalHealth || 0)) raid.totalHealth = cur;
    raid.bar.percent = raid.totalHealth > 0 ? Math.max(0, Math.min(1, cur / raid.totalHealth)) : 0;
    raid.bar.visible = raid.status === Rd.Status.ONGOING && Rd.hasStarted(raid);
    raid.bar.name = (n > 0 && n <= 2) ? 'raiders_remaining' : 'raid';
  };

  /**
   * `Raid.spawnNextWave` (Raid.java:484-521), minus the ravager-mounts-an-evoker/vindicator
   * "hard wave" passenger rule (lines 501-514 — a Raid.OWED item below) and minus the real
   * `world.spawnEntityAndPassengers` (the caller's `spawnFn(type, pos)` stands in for it, and
   * returns null for any type `EL.spawn` still refuses — this file's own header). The first
   * spawned raider whose type `Rd.CAN_LEAD` allows becomes the wave's patrol leader, flagged
   * `ominousBanner`/`headItem` (state, kept for `07k_goals.js`'s own `PickupBannerAsLeaderGoal`)
   * AND, QUEUE 0.2's raid-loop remainder (this unit), equipped with the REAL `ItemStack`
   * `Raid.setWaveCaptain` hands a captain (.decomp `Raid.java:674-678`) via `Eq.getOminousBanner`.
   */
  /** `Raid.spawnNextWave`'s passenger pick (.decomp `Raid.java:500-509`): `n` = how many ravagers
   *  this Member already handled this wave (`$$7`). Returns null for "no rider". */
  Rd.ravagerPassengerType = function (waveIdx, n) {
    if (waveIdx === Rd.MAX_WAVES.normal) return 'pillager';
    if (waveIdx >= Rd.MAX_WAVES.hard) return n === 0 ? 'evoker' : 'vindicator';
    return null;
  };
  // `RavagerEntity.getMountedHeightOffset()` = 2.1 (RavagerEntity.java:132);
  // `PatrolEntity.getHeightOffset()` = -0.45 (PatrolEntity.java:64, every raider rider).
  Rd.RAVAGER_MOUNTED_HEIGHT = 2.1;
  Rd.RAIDER_HEIGHT_OFFSET = -0.45;
  /** `Entity.startRiding` for a mob-on-mob pair (the player's own ride is `P.vehicle`, 14_player.js). */
  Rd.startRiding = function (rider, vehicle) {
    if (rider && rider.type === 'wither') return false;   // WitherEntity.canStartRiding() = false
    rider.vehicle = vehicle;
    rider.riding = true;   // the engine's existing `hasVehicle()` flag (07k_goals.js/07zd_slime.js read it)
    vehicle.passenger = rider;
    Rd.updatePassengerPosition(vehicle, rider);
    return true;
  };
  Rd.stopRiding = function (rider) {
    var v = rider.vehicle;
    if (v && v.passenger === rider) v.passenger = null;
    rider.vehicle = null;
    rider.riding = false;
  };
  /** `Entity.updatePassengerPosition` (Entity.java:1709-1714): x/z = vehicle's, y = vehicle.y +
   *  vehicle.getMountedHeightOffset() + passenger.getHeightOffset(). */
  Rd.updatePassengerPosition = function (vehicle, rider) {
    if (vehicle.type !== 'ravager' && NS.Undead && NS.Undead.placePassenger) return NS.Undead.placePassenger(vehicle, rider);
    var mh = vehicle.type === 'ravager' ? Rd.RAVAGER_MOUNTED_HEIGHT : (vehicle.height || 0) * 0.75;
    rider.x = vehicle.x; rider.z = vehicle.z;
    rider.y = vehicle.y + mh + Rd.RAIDER_HEIGHT_OFFSET;
  };
  /** `Entity.tickRiding` (Entity.java:1697-1703), the half after `tick()`: velocity zeroed, the
   *  rider's own goals already ran this tick (a pillager still aims and shoots from the saddle),
   *  then the vehicle places it. A dead/removed vehicle drops it (`Entity.removeAllPassengers`
   *  on removal); `LivingEntity.baseTick`'s "submerged + vehicle.shouldDismountUnderwater()"
   *  rule dismounts an eye-in-water rider (ravager keeps Entity's default true). Returns true
   *  if the rider is still riding (the caller then skips its own travel). */
  Rd.tickPassenger = function (rider) {
    var v = rider.vehicle;
    if (!v) return false;
    if (v.dead || v.removed || rider.eyeInWater) { Rd.stopRiding(rider); return false; }
    rider.vx = 0; rider.vy = 0; rider.vz = 0;
    Rd.updatePassengerPosition(v, rider);
    return true;
  };

  /** Every `RaiderEntity` subclass in 1.18.2 (the `raiders` entity tag). */
  Rd.RAIDER_TYPES = { pillager: 1, vindicator: 1, evoker: 1, illusioner: 1, ravager: 1, witch: 1 };
  /** `RaidManager.isValidRaiderFor` (RaidManager.java:71-75): alive, `canJoinRaid()` (false only
   *  for a NATURALLY spawned witch -- `RaiderEntity.initialize`, set in 07l_spawn.js), same
   *  dimension (one dimension here). `getDespawnCounter() <= 2400` reads `mob.despawnCounter` (07l_spawn.js). */
  Rd.isValidRaiderFor = function (mob, raid) {
    return !!mob && !!raid && !!Rd.RAIDER_TYPES[mob.type] && !mob.dead && !mob.removed &&
      mob.canJoinRaid !== false &&
      (mob.despawnCounter | 0) <= 2400;   // getDespawnCounter() <= 2400 (RaidManager.java:73)
  };
  /** `Raid.addRaider(wave, raider, null, true)` for an EXISTING raider (Raid.java:532-538 +
   *  `addToWave` 649-674): joins the wave (deduplicated), `setAbleToJoinRaid(true)`. */
  Rd.addRaider = function (raid, wave, mob) {
    if (raid.raiders.indexOf(mob) < 0) raid.raiders.push(mob);
    mob.raidId = raid.id;
    mob.wave = wave;
    mob.canJoinRaid = true;
    Rd.updateBar(raid);
    return true;
  };
  /** `MoveToRaidCenterGoal.includeFreeRaiders` (.decomp lines 60-73): every raider with no
   *  active raid inside the actor's box grown by 16 that `isValidRaiderFor` this raid is
   *  recruited into wave `getGroupsSpawned()` (= wavesSpawned). Returns how many joined. */
  Rd.includeFreeRaiders = function (actor, raid, list, raidOfFn) {
    if (!raid || raid.status !== Rd.Status.ONGOING) return 0;   // `raid.isActive()`
    var hw = (actor.w || 0.6) / 2 + 16, n = 0;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o === actor) continue;
      if (Math.abs(o.x - actor.x) > hw + (o.w || 0.6) / 2 || Math.abs(o.z - actor.z) > hw + (o.w || 0.6) / 2) continue;
      if (o.y + (o.h || 1.9) < actor.y - 16 || o.y > actor.y + (actor.h || 1.9) + 16) continue;
      var their = raidOfFn(o);
      if (their && their.status === Rd.Status.ONGOING) continue;   // `!hasActiveRaid()`
      if (!Rd.isValidRaiderFor(o, raid)) continue;
      Rd.addRaider(raid, raid.wavesSpawned, o);
      n++;
    }
    return n;
  };

  /** `Raid.getEnchantmentChance` (Raid.java:777-788), keyed on the bad-omen level. */
  Rd.getEnchantmentChance = function (raid) {
    var l = raid.badOmenLevel;
    return l === 2 ? 0.1 : l === 3 ? 0.25 : l === 4 ? 0.5 : l === 5 ? 0.75 : 0;
  };

  /** `PillagerEntity.addBonusForWave` (PillagerEntity.java:260-276), called from
   *  `Raid.addRaider` (Raid.java:542) on a freshly spawned raider: one `nextFloat() <=
   *  getEnchantmentChance()` roll, then a new crossbow in the main hand with quick_charge 2
   *  (wave > getMaxWaves(HARD)) or 1 (wave > getMaxWaves(NORMAL)) plus multishot 1. */
  Rd.addBonusForWave = function (raid, mob, wave, rand) {
    if (!mob || (mob.type !== 'pillager' && mob.type !== 'vindicator')) return;
    var hit = rand.nextFloat() <= Rd.getEnchantmentChance(raid);
    var Eq = NS.Equip, Inv = NS.Inventory;
    if (!Eq || !Eq.ready || !Inv || !Inv.stack || !NS.Items) return;
    if (mob.type === 'vindicator') {   // VindicatorEntity.addBonusForWave:170 -- axe always, sharpness on the roll
      var ax = Inv.stack('iron_axe', 1, 0, null);
      if (hit) Eq.applyEnchants(ax, [{ id: 'sharpness', lvl: wave > Rd.MAX_WAVES.normal ? 2 : 1 }]);
      Eq.setEquipped(mob, NS.Items.MAINHAND, ax);
      return;
    }
    if (!hit) return;
    var st = Inv.stack('crossbow', 1, 0, null);
    var list = [];
    if (wave > Rd.MAX_WAVES.hard) list.push({ id: 'quick_charge', lvl: 2 });
    else if (wave > Rd.MAX_WAVES.normal) list.push({ id: 'quick_charge', lvl: 1 });
    list.push({ id: 'multishot', lvl: 1 });
    Eq.applyEnchants(st, list);
    Eq.setEquipped(mob, NS.Items.MAINHAND, st);
  };

  Rd.spawnNextWave = function (raid, pos, rand, spawnFn) {
    var waveIdx = raid.wavesSpawned + 1;
    var isExtra = Rd.isSpawningExtraWave(raid);
    var captainAssigned = false;
    var spawned = [], missed = 0;
    for (var m = 0; m < Rd.MEMBER_ORDER.length; m++) {
      var type = Rd.MEMBER_ORDER[m];
      var arr = Rd.MEMBERS[type];
      var count = Rd.getCount(arr, waveIdx, raid.waveCount, isExtra)
        + Rd.getBonusCount(type, rand.nextInt, waveIdx, raid.difficulty, isExtra);
      var ridersPlaced = 0;   // `$$7` in Raid.spawnNextWave -- counted per Member, every ravager
      for (var i = 0; i < count; i++) {
        var mob = spawnFn(type, pos);
        if (!mob) { missed++; if (type === 'ravager') ridersPlaced++; continue; }
        mob.raidId = raid.id;
        mob.wave = waveIdx;
        if (!captainAssigned && Rd.CAN_LEAD[type]) {
          mob.patrolLeader = true;
          mob.ominousBanner = true;
          // `07k_goals.js`'s own `Ai.PickupBannerAsLeaderGoal` reads/sets the SAME field for a
          // later leader — kept as state alongside the real equip below, always in lockstep.
          mob.headItem = 'ominous_banner';
          // QUEUE 0.2 (raid loop remainder, this unit) — `Raid.setWaveCaptain`'s own equip half
          // (.decomp `Raid.java:676-678`): a REAL head-slot `ItemStack` (`Eq.getOminousBanner()`,
          // 07y_equip.js — `Raid.getOminousBanner()` transcribed) at drop chance
          // `Eq.OMINOUS_BANNER_DROP_CHANCE` (2.0F) — closes `Rd.OWED`'s own "real mob equipment"
          // line; `mob.headItem`/`mob.ominousBanner` above are the pre-existing state tags, unchanged.
          if (NS.Equip && NS.Equip.ready) {
            NS.Equip.setEquipped(mob, NS.Items.HEAD, NS.Equip.getOminousBanner());
            NS.Equip.setDropChance(mob, NS.Items.HEAD, NS.Equip.OMINOUS_BANNER_DROP_CHANCE);
          }
          raid.waveCaptain[waveIdx] = mob;
          captainAssigned = true;
        }
        raid.raiders.push(mob);
        spawned.push(mob);
        Rd.addBonusForWave(raid, mob, waveIdx, rand);
        // s98 (QUEUE 0.2 raid loop) -- the ravager PASSENGER rule, .decomp `Raid.java:500-514`:
        // on wave `getMaxWaves(NORMAL)` (5) a ravager carries a pillager; on any wave >=
        // `getMaxWaves(HARD)` (7) the Member's FIRST ravager carries an evoker, every later one a
        // vindicator. Keyed on the WAVE NUMBER, not the raid's difficulty (a normal raid's wave 5
        // gets its pillager too). The rider is `addRaider`'d into the same wave (it counts toward
        // wave-clear) and is never the captain (the captain test only sees the loop's own mob).
        if (type === 'ravager') {
          var rType = Rd.ravagerPassengerType(waveIdx, ridersPlaced);
          ridersPlaced++;
          if (rType) {
            var rider = spawnFn(rType, pos);
            if (rider) {
              rider.raidId = raid.id;
              rider.wave = waveIdx;
              Rd.startRiding(rider, mob);
              raid.raiders.push(rider);
              spawned.push(rider);
              Rd.addBonusForWave(raid, rider, waveIdx, rand);
            } else missed++;
          }
        }
      }
    }
    raid.preCalculatedSpawn = null;   // Raid.java:526
    raid.wavesSpawned++;
    raid.started = true;
    raid.preRaidTicks = 0;
    Rd.updateBar(raid);
    return { spawned: spawned, missed: missed, waveIdx: waveIdx };
  };

  /** `Raid.removeFromWave` + the `addHero` half of `RaiderEntity.onDeath` (Raid.java:572-585,
   *  RaiderEntity.java:125-128): a raider that dies leaves the raid, and if a PLAYER killed it,
   *  that player becomes eligible for the victory's Hero of the Village effect. `killerId` is
   *  null/omitted for any non-player kill (another mob, the world, etc). */
  Rd.removeFromWave = function (raid, mob, killerId) {
    var idx = raid.raiders.indexOf(mob);
    if (idx < 0) return false;
    raid.raiders.splice(idx, 1);
    if (mob.patrolLeader && raid.waveCaptain[mob.wave] === mob) delete raid.waveCaptain[mob.wave];
    if (killerId !== undefined && killerId !== null) raid.heroes[killerId] = true;
    Rd.updateBar(raid);
    return true;
  };

  /**
   * The live join `Rd.removeFromWave` was missing (this file's own header): given the raid
   * TABLE and a mob that just died, finds the raid `mob.raidId` names and removes it from that
   * wave. `killerId` is `Rd.removeFromWave`'s own credit id — undefined for anything this
   * engine cannot yet attribute a kill to. A mob with no `raidId`, or whose `raidId` no longer
   * has a live raid (the raid already finished/stopped and was dropped by `RM.tick`), is a
   * silent no-op — a raider outliving its own raid table entry is not this function's bug to
   * report.
   */
  Rd.handleRaiderDeath = function (rm, mob, killerId) {
    if (!rm || !mob || mob.raidId === undefined || mob.raidId === null) return false;
    var raid = rm.raids[mob.raidId];
    if (!raid) return false;
    return Rd.removeFromWave(raid, mob, killerId);
  };

  /**
   * The victory half of `Raid.tick` (Raid.java:358-373): every hero-of-the-village candidate
   * gets `StatusEffects.field_18980` (hero_of_the_village) for `HERO_DURATION` ticks at
   * amplifier `badOmenLevel - 1`. `heroEntities` is the caller's own {id -> living entity} map
   * for whatever ids `Rd.removeFromWave` was given (players also get the advancement trigger and the raid_win stat).
   */
  Rd.grantHeroes = function (raid, heroEntities, ES) {
    var granted = [];
    for (var id in raid.heroes) {
      if (!raid.heroes.hasOwnProperty(id)) continue;
      var e = heroEntities && heroEntities[id];
      if (!e) continue;
      ES.addStatusEffect(e, 'hero_of_the_village', Rd.HERO_DURATION, Math.max(raid.badOmenLevel - 1, 0), false, true);
      granted.push(id);
      // ServerPlayerEntity only: Criteria.HERO_OF_THE_VILLAGE.trigger + Stats.RAID_WIN
      if (e.isPlayer || e.type === 'player' || e.advancements) {
        if (NS.Adv && NS.Adv.trigger) NS.Adv.trigger(e, 'minecraft:hero_of_the_village', {});
        if (NS.Stats && NS.Stats.inc) NS.Stats.inc('raid_win');
      }
    }
    return granted;
  };

  /**
   * One tick of `Raid.tick` (Raid.java:244-393) — the horn-sound half is still OWED (no sound
   * dispatch hook wired to this file yet); `moveRaidCenter` is CLOSED this pass (loop/raidpoi-
   * s103, `ctx.moveRaidCenter`, below) and everything that decides ONGOING -> LOSS/VICTORY/
   * STOPPED and drives the wave clock is real. `ctx`:
   *   isNearVillage(center) -> bool   stands in for `world.isNearOccupiedPointOfInterest`
   *   moveRaidCenter(raid)  -> void, optional; `Rd.moveRaidCenter`'s own live wiring
   *                            (`Rd.buildLiveCtx`) — a ctx with none just skips straight to the
   *                            second `isNearVillage` test below, same as before this pass
   *   spawnFn(type, pos)    -> entity|null, per `Rd.spawnNextWave`'s own doc
   *   rand                  { nextFloat(), nextInt(n) }
   *   heroEntities          {id -> entity}, for `Rd.grantHeroes` on victory
   *   ES                    NS.Effects
   */
  /** `Raid.playRaidHorn` (Raid.java:467-481): every player within 64 blocks (or on the raid bar) hears
   *  event.raid.horn, NEUTRAL, volume 64, pitch 1, at 13 blocks from them toward the block centre. */
  Rd.playRaidHorn = function (pos, ctx) {
    if (!ctx.playSound || !ctx.players) return;
    var cx = Math.floor(pos.x) + 0.5, cz = Math.floor(pos.z) + 0.5;
    for (var i = 0; i < ctx.players.length; i++) {
      var p = ctx.players[i];
      var d = Math.sqrt((cx - p.x) * (cx - p.x) + (cz - p.z) * (cz - p.z));
      if (d <= 64 || (ctx.barPlayers && ctx.barPlayers.indexOf(p) >= 0))
        ctx.playSound('event.raid.horn', { x: p.x + 13 / d * (cx - p.x), y: p.y, z: p.z + 13 / d * (cz - p.z), source: 'neutral', volume: 64, pitch: 1 });
    }
  };

  Rd.tick = function (raid, ctx) {
    if (raid.status === Rd.Status.STOPPED) return raid;
    if (raid.status !== Rd.Status.ONGOING) {
      // `Raid.tick`'s `isFinished()` branch (lines 375-392): a 600-tick cooldown before the
      // raid finally stops existing, so a victory/loss bar has time to be seen.
      raid.finishCooldown++;
      if (raid.finishCooldown >= 600) raid.status = Rd.Status.STOPPED;
      return raid;
    }
    if (raid.difficulty === 'peaceful') { raid.status = Rd.Status.STOPPED; return raid; }
    if (!ctx.isNearVillage(raid.center)) {
      // Raid.java:262-270, verbatim order: try `moveRaidCenter` FIRST, and only fall to LOSS/
      // STOPPED if the SECOND `isNearOccupiedPointOfInterest` test (against the possibly-moved
      // center) still fails. A raid that had already started is a LOSS (the village is gone);
      // one that never spawned a wave simply never happened.
      if (ctx.moveRaidCenter) ctx.moveRaidCenter(raid);
      if (!ctx.isNearVillage(raid.center)) {
        raid.status = raid.wavesSpawned > 0 ? Rd.Status.LOSS : Rd.Status.STOPPED;
        return raid;
      }
    }
    raid.ticksActive++;
    if (raid.ticksActive >= Rd.RAID_TIMEOUT_TICKS) { raid.status = Rd.Status.STOPPED; return raid; }

    if (raid.raiders.length === 0 && Rd.shouldSpawnMoreGroups(raid)) {
      if (raid.preRaidTicks === 0 && raid.wavesSpawned > 0) {
        raid.preRaidTicks = Rd.PRE_WAVE_HORN_TICKS;   // the horn/warning delay before wave 2+
        Rd.updateBar(raid);
        return raid;
      }
      if (raid.preRaidTicks > 0) {
        // Raid.java:289-304: fill the cache every 5th tick while empty (or when the cached spot
        // no longer ticks); tier is 1 below 100 ticks (the jar's `< 40 -> 2` arm is unreachable).
        var have = !!raid.preCalculatedSpawn;
        var redo = !have && raid.preRaidTicks % 5 === 0;
        if (have && ctx.shouldTickPos && !ctx.shouldTickPos(raid.preCalculatedSpawn)) redo = true;
        if (redo) {
          var ptier = raid.preRaidTicks < 100 ? 1 : 0;
          raid.preCalculatedSpawn = null;
          for (var pi = 0; pi < 3 && !raid.preCalculatedSpawn; pi++) {
            var pp = ctx.spawnPos ? ctx.spawnPos(raid, ptier, ctx.rand) : Rd.ringSpawnPos(raid.center, ptier, ctx.rand);
            if (pp) {
              if (pp.y === undefined) pp.y = ctx.heightAt ? ctx.heightAt(pp.x, pp.z) : raid.center.y;
              raid.preCalculatedSpawn = pp;
            }
          }
        }
        raid.preRaidTicks--;
      }
    }

    // Raid.java:332-352: `while (canSpawnRaiders())` retries getRavagerSpawnLocation($$6, 20)
    // INSIDE this tick, $$6++ per total failure, invalidate() (STOPPED) once $$6 > 3.
    var tier = 0, horned = false;
    while (Rd.canSpawnRaiders(raid)) {
      var pos3 = raid.preCalculatedSpawn ? raid.preCalculatedSpawn
        : ctx.spawnPos ? ctx.spawnPos(raid, tier, ctx.rand)
        : Rd.ringSpawnPos(raid.center, 0, ctx.rand);
      if (pos3) {
        if (pos3.y === undefined) pos3.y = ctx.heightAt ? ctx.heightAt(pos3.x, pos3.z) : raid.center.y;
        Rd.spawnNextWave(raid, pos3, ctx.rand, ctx.spawnFn);
        if (!horned) { Rd.playRaidHorn(pos3, ctx); horned = true; }   // Raid.java:339-342, once per tick
      } else {
        tier++;
      }
      if (tier > 3) { raid.status = Rd.Status.STOPPED; break; }
    }
    raid.spawnTier = 0;

    if (Rd.hasStarted(raid) && !Rd.shouldSpawnMoreGroups(raid) && raid.raiders.length === 0) {
      raid.postRaidTicks++;
      if (raid.postRaidTicks > Rd.POST_RAID_WIN_DELAY) {
        raid.status = Rd.Status.VICTORY;
        Rd.grantHeroes(raid, ctx.heroEntities || {}, ctx.ES);
      }
    }
    Rd.updateBar(raid);
    return raid;
  };

  /** One tick of `RaidManager.tick` (RaidManager.java:44-63): tick every non-stopped raid,
   *  drop the ones that just stopped. `disableRaids` stands in for the `disableRaids` gamerule
   *  (not wired to `Commands.RULES_LIVE` yet — `Rd.OWED`), same injected-boolean shape
   *  `EL.aiCtx.mobGriefing`/`isHard` already use for the gamerules that ARE wired (D-399/400). */
  RM.tick = function (rm, ctxFor, disableRaids) {
    for (var id in rm.raids) {
      if (!rm.raids.hasOwnProperty(id)) continue;
      var r = rm.raids[id];
      if (disableRaids) r.status = Rd.Status.STOPPED;
      if (r.status === Rd.Status.STOPPED) { delete rm.raids[id]; continue; }
      Rd.tick(r, ctxFor(r));
    }
  };

  /**
   * The banner-kill half of `RaiderEntity.onDeath` (RaiderEntity.java:131-160): a patrol's
   * (NOT an active raid's — vanilla's own gate is "this raider has no `Raid` AND no raid
   * already exists at its position") banner-wearing leader, killed by a player (or that
   * player's tamed wolf — the caller resolves that substitution and passes the CREDITED
   * player, same as `Rd.grantHeroes`'s injected map), grants that player a fresh Bad Omen:
   * amplifier `1 + currentAmplifier` if they already carry one (which is then removed and
   * replaced, not stacked), else `0`; clamped to `[0, PATROL_BAD_OMEN_CLAMP]`; duration
   * `PATROL_BAD_OMEN_DURATION`. Returns false (grants nothing) for a leader with no banner,
   * or any kill this file was not told credits a player.
   */
  Rd.onPatrolLeaderDeath = function (victim, creditedPlayer, ES) {
    if (!victim || !victim.patrolLeader || !victim.ominousBanner || !creditedPlayer) return false;
    var cur = ES.getStatusEffect(creditedPlayer, 'bad_omen');
    var level = 1;
    if (cur) { level += cur.amplifier; ES.removeStatusEffect(creditedPlayer, 'bad_omen'); }
    else { level -= 1; }
    if (level < 0) level = 0;
    if (level > Rd.PATROL_BAD_OMEN_CLAMP) level = Rd.PATROL_BAD_OMEN_CLAMP;
    ES.addStatusEffect(creditedPlayer, 'bad_omen', Rd.PATROL_BAD_OMEN_DURATION, level, false, false);
    return true;
  };

  // ── THE LIVE CALLER (QUEUE 0.2, this unit) ──────────────────────────────────────────────
  // Everything above is generic and already took an injected `ctx`; the two things only THIS
  // engine can answer — "what counts as near a village" and "where can a raider actually
  // stand" — are `Rd.isNearOccupiedPOI`/`Rd.villageCenterNear` and `Rd.findRaiderSpawnPos`,
  // both above. `Rd.buildLiveCtx` wires those, plus the real `NS.EntityList.spawn`, into the
  // `ctx` shape `Rd.tick` already expected; `Rd.tickLive` is the one function
  // `Main.worldTick`'s raid line calls, once a tick, closing this file's own header gap.
  //
  // `NS2.Player`'s own Bad Omen is read here rather than consumed the instant it is seen —
  // `RM.startRaid`/`Rd.start` (above) are what actually remove it, same as vanilla's own
  // `applyUpdateEffect` -> `startRaid` chain. `RM.world` is the one raid TABLE this engine
  // ever has; `Rd.init` creates it once, at boot, the same moment every other QUEUE 0.2 module
  // becomes `.ready`.
  RM.world = null;

  /**
   * Assembles a real `Rd.tick` `ctx` for one raid, against this engine's actual
   * `World`/`EntityList`/`Profession`/`Effects` — everything `Rd.tick`'s own ctx doc (above
   * `Rd.tick`) says a caller must supply. `NS2` is the engine namespace (`MCL`/`globalThis`),
   * threaded through rather than closed over, so a check can hand this a fake one.
   */
  Rd.buildLiveCtx = function (NS2, raid) {
    var claimed = (NS2.Profession && NS2.Profession.ready) ? NS2.Profession.claimed : null;
    var W = NS2.World;
    // `world.getTopY(Heightmap.Type, x, z)` returns the first Y ABOVE the recorded surface;
    // `W.heightAt` (07_world.js) returns the surface block ITSELF (07l_spawn.js's own natural
    // spawner already reads it the same way: `y = W.heightAt(x, z) + 1`) — so `+1` here is
    // that same convention, not a guess.
    var heightAt = function (x, z) {
      if (!W || !W.heightAt) return raid.center.y;
      var top = W.heightAt(x, z);
      if (NS2.CFG && top < NS2.CFG.WORLD_MIN_Y) return raid.center.y;   // ungenerated column
      return top + 1;
    };
    return {
      isNearVillage: function (pos) { return Rd.isNearOccupiedPOI(pos, claimed); },
      // loop/raidpoi-s103: `Rd.moveRaidCenter`'s own live wiring — `Rd.tick`'s "not near a
      // village" branch (above) calls this before giving up.
      moveRaidCenter: function (raid2) { Rd.moveRaidCenter(raid2, claimed); },
      rand: { nextFloat: Math.random, nextInt: function (n) { return Math.floor(Math.random() * n); } },
      heightAt: heightAt,
      spawnPos: function (raid2, tier, rand) {
        return Rd.findRaiderSpawnPos(raid2, tier, 20, {   // 20 == Raid.tick's own attempts arg
          rand: rand,
          heightAt: heightAt,
          isSpawnable: function (x, y, z) { return Rd.canPlaceRaiderAt(NS2, x, y, z); },
          claimed: claimed
        });
      },
      // the real `world.spawnEntityAndPassengers` stand-in, closing this file's own header gap:
      // "no live caller anywhere in src/ passes a real spawnFn (NS.EntityList.spawn)".
      spawnFn: function (type, pos) {
        return (NS2.EntityList && NS2.EntityList.spawn) ? NS2.EntityList.spawn(type, pos.x, pos.y, pos.z, { spawnReason: 'event' }) : null;   // D-671: SpawnReason.EVENT
      },
      // the "one-player collapse" (07l_spawn.js's `Village` module header names the same
      // pattern): this engine has exactly one possible Hero of the Village, so one fixed key.
      heroEntities: { player: NS2.Player },
      players: [NS2.Player], barPlayers: [NS2.Player],
      playSound: function (ev, o) { return NS2.Sound && NS2.Sound.play ? NS2.Sound.play(ev, o) : null; },
      ES: NS2.Effects
    };
  };

  /**
   * One tick of the LIVE raid loop — the function `Main.worldTick`'s raid line calls. (a) a
   * player carrying Bad Omen standing near this engine's one POI substrate (a claimed
   * workstation) starts or feeds a raid, consuming the effect exactly as `Rd.start` always
   * did; (b) every raid in `RM.world` is ticked for real, through `Rd.buildLiveCtx`'s real
   * search and real `EntityList.spawn`. `disableRaids` is the live gamerule (s98, `RM.raidsDisabled`).
   */
  Rd.tickLive = function (NS2) {
    // loop/raidpoi-s103: the POI substrate's own reconcile (07zu_poi.js) — no separate
    // registration line anywhere else calls this (`Poi.tick`'s own doc explains why), so this
    // one line is its only live caller, same as this function is `Rd`'s.
    if (NS2 && NS2.Poi && NS2.Poi.tick) NS2.Poi.tick();
    if (!RM.ready || !RM.world || !NS2 || !NS2.Player) return;
    var ES = NS2.Effects;
    if (!ES || !ES.ready) return;
    var player = NS2.Player;
    var difficulty = (NS2.Diff && NS2.Diff.get) ? NS2.Diff.get() : 'normal';
    var claimed = (NS2.Profession && NS2.Profession.ready) ? NS2.Profession.claimed : null;
    var center = Rd.villageCenterNear(player, claimed);
    if (Rd.shouldTriggerRaid(player, ES, difficulty, !!center)) {
      RM.startRaid(RM.world, player, center, difficulty, ES);
    }
    // RaidManager.java:52-54 -- `disableRaids` invalidates every live raid each tick (s98, live).
    RM.tick(RM.world, function (raid) { return Rd.buildLiveCtx(NS2, raid); }, RM.raidsDisabled());
  };

  Rd.OWED = [
    // ── MOB EXISTENCE — CLOSED THIS PASS (loop/illagers-s92), see this file's own header for
    // the citations: vindicator/pillager/witch/ravager/evoker/illusioner motion + Ai.ROSTER +
    // (pillager) Ai.CrossbowAttackGoal all resolved and proven by tools/raidmobcheck.mjs. ──
    // STRUCK s114 (stale): the raider/patrol shared goals are real — Ai.PickupBannerAsLeaderGoal,
    // Ai.MoveToRaidCenterGoal, Ai.AttackHomeGoal, Ai.CelebrateGoal, Ai.PatrolGoal (07k_goals.js,
    // raider-shared-goals block, D-602/D-610), rostered for all six raiders.
    // ── CLOSED THIS PASS (loop/witchpotion-s95) -- witch's real potion throw. A live
    // `potion` projectile (gravity 0.05, ProjectileEntity.setVelocity's own jitter), splash
    // (PotionEntity.applySplashPotion, distance-scaled duration) and potion CHOICE (thrown +
    // self-drunk) now exist (src/07z_potion.js) and Ai.ROSTER.witch fires through a real
    // Ai.ProjectileAttackGoal, not Ai.RangedBowAttackGoal. What remains is named on Ai.OWED and
    // Po.OWED, not folded into a silent "done": the witch's own RaidGoal target selector (a
    // hurt raider ally to walk to and heal) is still unwired, and the water-splash/lingering-
    // potion collision branches are unreachable from live play so unmodelled. ──
    // ── STALE BY loop/spells-s93/loop/raidvex-s96 — five of the six spells this line used to
    // list whole are closed (07v_spell.js's own header); the sixth, `WololoGoal`, closed s98. ──
    // ── "no live caller" — CLOSED THIS PASS (this unit): `Rd.tickLive` (above), wired into
    // `Main.worldTick`, is the real spawnFn/village-trigger/RM.tick caller this file's own
    // header used to say did not exist anywhere in src/. What that closure still simplifies is
    // named below, not folded silently into "closed". ──
    // ── CLOSED THIS PASS (loop/raidvex-s96) -- `vex` motion/flight/goals (`Fl.VexMoveControl`,
    // `Ai.ROSTER.vex`, `SP.SummonVexGoal`) — a real, moving, targeting vex now exists and an
    // evoker really summons three. What remains: ──
    // ── CLOSED THIS PASS (QUEUE 0.2, this unit) -- vex `noClip` (`Fl.travelMob`, 07t_fly.js,
    // now wraps its `Ph.move` call in `e.noclip` for a vex, restored after, same as `VexEntity.
    // tick()`'s own `this.noClip = true`/`false` around `super.tick()`) and the ominous banner
    // as a REAL head-slot `ItemStack` (`Eq.getOminousBanner`, 07y_equip.js) on every raid/patrol
    // captain. What remains: ──
    // ── RULED s98: "vex has no wave slot" is VANILLA, not a gap -- `VexEntity extends
    // HostileEntity` (.decomp VexEntity.java:39), not RaiderEntity, and `Raid.addRaider` takes a
    // RaiderEntity only; a summoned vex never counts toward wave-clear in 1.18.2 either. ──
    // ── RAID MECHANICS THIS FILE SIMPLIFIES ─────────────────────────────────────────────
    // ── CLOSED THIS PASS (loop/raidpoi-s103) -- `Raid.moveRaidCenter`: `Rd.moveRaidCenter` now
    // does the real 5x5x5-chunk-section search and `Rd.tick`'s "not near a village" branch tries
    // it before giving up, exactly Raid.java:262-270's own order. ──
    // ── PARTIALLY CLOSED THIS PASS (loop/raidpoi-s103) -- the real village-center POI-averaging
    // RaidManager.startRaid does now sees HOME (bed)/MEETING (bell) POIs too, not just claimed
    // workstations (`NS.Poi`, 07zu_poi.js, folded into `claimedPositions`/`Rd.villageCenterNear`
    // above) -- but nothing RESERVES a HOME/MEETING ticket yet (no sleep/meeting-rally AI), so
    // the average is still driven only by `Profession.claimed` in live play; `Poi.OWED` names
    // this precisely rather than letting the new module's existence read as full closure. ──
    '`isNearOccupiedPointOfInterest`\'s own real distance metric is a section-hop flood fill ' +
      '(`PointOfInterestStorage.getDistanceFromNearestOccupied`); `Rd.isNearOccupiedPOI` proves ' +
      'a section-Chebyshev-distance test is EXACTLY equivalent to it at radius 1 (the only ' +
      'radius this file ever calls it with) — this is not an approximation, but it would stop ' +
      'being an exact substitute the day some other radius is needed',
    // ── CLOSED s98 -- MoveToRaidCenterGoal.includeFreeRaiders (Rd.includeFreeRaiders). Residue: ──
    // ── CLOSED s98 -- DISABLE_RAIDS is live (RM.raidsDisabled, Commands.RULES_LIVE.disableRaids). ──
    // ── CLOSED s98 -- the ravager passenger rule (Rd.ravagerPassengerType/Rd.tickPassenger).
    // riding POSE also closed s98 (anim.riding = e.riding; seated leg yaw/roll, 07j_entityrender.js). ──
    // ── "Rd.ringSpawnPos is the ring math only" — CLOSED THIS PASS: `Rd.findRaiderSpawnPos` now
    // does the height lookup (`World.heightAt`) and the POI-avoidance/validity retry search for
    // real (used by `Rd.buildLiveCtx`'s own `spawnPos`). Still simplified, named here: ──
    // ── CLOSED #5141 -- Rd.canPlaceRaiderAt is Spawn.canSpawnOnGround('ravager') + world border (Raid.java:634 passes
    // ON_GROUND and EntityType.RAVAGER only; no raider canSpawn override is consulted there). ──
    // ── CLOSED #5139 -- preCalculateRavagerSpawnLocation cache (Raid.java:289-304,334,526). ──
    // ── CLOSED #5754 -- startRaid's raid_trigger stat + VOLUNTARY_EXILE trigger. ──
    // ── CLOSED #5755 -- grantHeroes: HERO_OF_THE_VILLAGE trigger + raid_win stat (players only). ──
    'nothing further on the advancement/stat hooks'
    // ── STALE NOTE STRUCK (QUEUE 0.2, this unit): a line here used to say "RaiderEntity.onDeath's
    // banner-kill half has no live caller ... patrol spawning means no such roaming leader ever
    // exists to kill" — both halves are wrong today. `07x_patrol.js`'s `PatrolSpawner` (closed a
    // prior pass) really spawns a roaming banner-carrying leader, and `14j_combat.js`'s own
    // `NS.Raid.onPatrolLeaderDeath` branch is its live banner-kill caller (`raidcheck.mjs`'s own
    // §14 proves both, end to end). Nothing left to name here.
  ];

  Rd.init = function () { Rd.ready = true; RM.ready = true; RM.world = RM.world || RM.create(); return Rd; };

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));

// G25-bell-resonate -- BellBlockEntity.tick / activate / applyGlowToRaiders (.decomp BellBlockEntity.java).
(function (NS) {
  'use strict';
  var Bell = NS.Bell = { ready: true };
  function near(e, x, y, z, d) {
    var dx = e.x - (x + 0.5), dy = e.y - (y + 0.5), dz = e.z - (z + 0.5);
    return dx * dx + dy * dy + dz * dz < d * d;
  }
  function raiders(be, d) {
    var out = [], L = NS.EntityList && NS.EntityList.list || [];
    for (var i = 0; i < L.length; i++) {
      var m = L[i];
      if (m && !m.dead && !m.removed && NS.Raid && NS.Raid.RAIDER_TYPES[m.type] && near(m, be.x, be.y, be.z, d)) out.push(m);
    }
    return out;
  }
  Bell.isRaiderWithinRange = function (be, m) {
    return !!m && !m.dead && !m.removed && !!NS.Raid.RAIDER_TYPES[m.type] && near(m, be.x, be.y, be.z, 48);
  };
  Bell.activate = function (x, y, z, dir) {
    var BE = NS.BlockEntities, be = BE.get(x, y, z) || BE.create(x, y, z, 'bell');
    if (dir) be.lastSideHit = dir;   // BellBlockEntity.activate: lastSideHit = the face struck
    be.resonateTime = 0; be.ticks = 0; be.ringing = true; be.resonating = false;
  };
  Bell.tick = function (be) {
    if (be.ringing) be.ticks++;
    if (be.ticks >= 50) { be.ringing = false; be.ticks = 0; }
    if (be.ticks >= 5 && !be.resonateTime && !be.resonating) {
      var h = raiders(be, 32);
      if (h.length) be.resonating = true;
    }
    if (be.resonating) {
      if (be.resonateTime < 40) be.resonateTime++;
      else {
        var g = raiders(be, 48);
        for (var i = 0; i < g.length; i++) NS.Effects.addStatusEffect(g[i], 'glowing', 60, 0);
        be.resonating = false;
      }
    }
  };
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
