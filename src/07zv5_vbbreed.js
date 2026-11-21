// 07zv5_vbbreed.js — loop/vbbreed: `VillagerBreedTask` itself (.decomp/net/minecraft/entity/
// ai/brain/task/VillagerBreedTask.java, read in full this session), the actual child-spawn
// `createIdleTasks' priority-3 CompositeTask(VillagerBreedTask)` wraps (VillagerTaskListProvider
// .java:174-186). `src/07zv4_vbidle.js`'s own `breedInterestStart` (createIdleTasks' priority-2
// FindEntityTask, weight 1) already picks a ready-to-breed partner and remembers it as
// `e.vbBreedTarget` (this engine's own BREED_TARGET stand-in) -- THIS file is the SEPARATE,
// independent task that BREED_TARGET now drives, exactly the way vanilla runs both priority
// groups the same tick (VillagerTaskListProvider.createIdleTasks wraps VillagerBreedTask in its
// own `CompositeTask(ImmutableSet.of(MemoryModuleType.field_18448), ...)`, requiring only
// BREED_TARGET present -- a SEPARATE priority tier from the RandomTask that sets it, not a
// continuation of the same weighted pick). `NS.VBBreed.tick`, below, is that task's own
// `shouldRun`/`run`/`tick`/`finish` folded into one per-villager-per-tick call, the SAME
// convention `07zv3_vbpanic.js`'s own `NS.VBPanic.tick` already uses for its own separate
// priority tier.
//
// EACH VILLAGER RUNS ITS OWN INSTANCE, exactly as vanilla does (a `Task` lives on a `Brain`,
// one per entity) -- `NS.VBBreed.tick(e, ...)` is called for EVERY villager during 'idle'
// (07zv_villagerbrain.js's own `VB.tick`), and does nothing unless THAT villager's own
// `e.vbBreedTarget` is set. When two villagers pick each other, BOTH run their own courting
// timer (independently rolled, `VBB.COURT_MIN_TICKS + nextInt(VBB.COURT_VAR_TICKS)` each) --
// whichever reaches its own end first calls `eatForBreeding` on BOTH itself and its partner
// (VillagerBreedTask.java:51-52: `$$1.eatForBreeding(); $$3.eatForBreeding();`), which is what
// self-limits a single courting encounter to ONE child in the common case: by the time the
// SECOND villager's own instance reaches ITS end, its own food has usually already been spent
// by the first instance's own call, so its own `isReadyToBreed` check (below) fails and it
// simply stops. This is the real vanilla mechanism, not a simplification invented for this
// engine.
//
// READ IN FULL THIS SESSION, besides VillagerBreedTask.java: VillagerEntity.java:98-108
// (ITEM_FOOD_VALUES)/660-706 (isReadyToBreed/consumeAvailableFood/eatForBreeding/canBreed/
// getAvailableFood)/729-741 (handleStatus 12/13/14/42)/764-777 (method_7225, createChild's own
// child-type roll); LookTargetUtil.java:36-77 (lookAtAndWalkTowardsEachOther/walkTowards);
// MerchantEntity.java:198-204 (produceParticles, the actual 5-particle status-12/13 emitter --
// `Px.spawnMerchantParticles`, src/07zx_particle.js); EmotionParticle.java (HeartFactory vs
// AngryVillagerFactory, the y+0.5 difference, src/07zx_particle.js's own header now cites it);
// LivingEntity.java:1649-1745 (handleStatus's own big switch: byte 18, the courting-start
// signal `run()` sends to both villagers, falls into the `default: super.handleStatus($$0)`
// case at EVERY level of VillagerEntity's own hierarchy -- MerchantEntity/PassiveEntity/
// PathAwareEntity never override it, unlike `AnimalEntity.java:242-251`'s real 7-heart burst,
// a DIFFERENT class villagers do not extend -- so status 18 is a genuine no-op for a villager in
// vanilla too; this file sends nothing for it, on purpose, rather than silently matching
// `Br.emitBreedHearts`'s animal-only 7-burst).
//
// SUBSTRATES REUSED, not re-invented:
//   - `VB.villagerReadyToBreed`/`VB.villagerFoodValue`/`VB.BREED_FOOD_VALUES`/`VB.BREED_FOOD_MIN`
//     (07zv4_vbidle.js) -- `readyToBreed` there now also gates on `Breed.getAge(e) === 0`
//     (the post-breed cooldown THIS file's own `createChild` sets).
//   - `VB.pathToAny` (07zv_villagerbrain.js) -- `getReachableHome`'s own top-5-nearest-candidate
//     reachability search, the SAME simplification `VB.findPoiTick` already makes for HOME/
//     MEETING claims (named on that file's own `VB.OWED`), reused here for a ONE-OFF query
//     rather than a per-tick ticket claim (`getReachableHome` never reserves one in vanilla
//     either -- `goHome`'s own `releaseTicket` call on the no-child branch is defensive against
//     a reservation that plain `getPosition` never made, so it is not reproduced here).
//   - `NS.Breed.setAge`/`NS.Breed.setBaby`/`NS.Breed.C` (07m_breed.js) -- the SAME growAge/
//     isBaby/dimensions machinery every bred animal already uses; `Breed.tickAge` (already
//     called for EVERY entity, 07i_entitylist.js) ages both the child's -24000 and the parents'
//     6000 back toward 0 with no extra wiring needed here.
//   - `NS.Px.spawnMerchantParticles`/`Px.spawn('angry_villager', ...)` (07zx_particle.js).
//   - `NS.EntityList.spawn('villager', ...)` (07i_entitylist.js) -- a fresh villager already
//     defaults `e.profession = 'none'` (`EL.DEFAULTS.villager`), matching `VillagerEntity
//     .initialize`'s own `SpawnReason.BREEDING` branch (`withProfession(NONE)`,
//     VillagerEntity.java:748-750) for free.
(function (NS) {
  'use strict';

  var VB = NS.VB || (NS.VB = { ready: false });
  var VBB = NS.VBBreed || (NS.VBBreed = {});

  // VillagerBreedTask's own constants (.decomp, see file header for line citations).
  VBB.COURT_MIN_TICKS = 275;        // `275 + this.random.nextInt(50)` -- java:42
  VBB.COURT_VAR_TICKS = 50;
  // ⚠⚠ `MAX_DISTANCE = 5` (java:19) IS DEAD CODE -- `method_18975`'s own keepRunning-adjacent
  // distance gate compares `squaredDistanceTo(partner) > 5.0` (java:48), a LITERAL, never the
  // `MAX_DISTANCE` field. Ported as the literal, matching the bytecode that actually runs, not
  // the unused constant beside it.
  VBB.KEEP_RUNNING_DIST_SQ = 5.0;
  VBB.ANGRY_HEART_CHANCE = 35;      // `this.random.nextInt(35) == 0` -- java:54
  VBB.WALK_COMPLETION_RANGE = 2;    // `LookTargetUtil.walkTowards(..., 2)` -- LookTargetUtil.java:65
  VBB.HOME_SEARCH_RADIUS = 48;      // `getReachableHome`'s own radius -- java:91

  function rnd() { return (VB.rand || Math.random)(); }
  function nextInt(n) { return Math.floor(rnd() * n); }
  function distSq(a, b) { var dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z; return dx * dx + dy * dy + dz * dz; }

  // ── particles (status 12 HEART / status 13 ANGRY_VILLAGER, MerchantEntity.produceParticles) ─
  function emitHeart(e) {
    if (NS.Particle && NS.Particle.spawnMerchantParticles) NS.Particle.spawnMerchantParticles('heart', e.x, e.y, e.z, VB.rand || Math.random);
  }
  function emitAngry(e) {
    if (NS.Particle && NS.Particle.spawnMerchantParticles) NS.Particle.spawnMerchantParticles('angry_villager', e.x, e.y, e.z, VB.rand || Math.random);
  }

  /** `LookTargetUtil.lookAtAndWalkTowardsEachOther` (java:36-38) -- `lookAtEachOther` (both
   *  directions) then `walkTowardsEachOther` (both directions, completionRange 2 each,
   *  java:63-67). Vanilla's own `WalkTarget` wraps a LIVE `EntityLookTarget` (re-read every
   *  tick); this engine's `e.vbWalkTarget` is a static snapshot, so this is called fresh every
   *  tick the courting task runs close enough to matter (below), the same live-chase convention
   *  `07zv2_vbplay.js`'s own `VB.tickPlay` header already explains -- unconditional overwrite,
   *  no `e.vbWalkTarget`-absent guard, matching `Brain.remember`'s own unconditional semantics
   *  (unlike the priority-2 FindEntityTask entries, which DO guard on absence). */
  function lookWalkTowardsEachOther(a, b) {
    a.vbLookTarget = { x: b.x, y: b.y, z: b.z };
    b.vbLookTarget = { x: a.x, y: a.y, z: a.z };
    a.vbWalkTarget = { x: Math.floor(b.x), y: Math.floor(b.y), z: Math.floor(b.z), range: VBB.WALK_COMPLETION_RANGE };
    b.vbWalkTarget = { x: Math.floor(a.x), y: Math.floor(a.y), z: Math.floor(a.z), range: VBB.WALK_COMPLETION_RANGE };
  }

  /** `VillagerEntity.eatForBreeding` = `consumeAvailableFood` + `depleteFood(12)`
   *  (java:676-692/705-708). `consumeAvailableFood` only runs while `lacksFood()`
   *  (`foodLevel < 12`) AND `getAvailableFood() != 0`, walking inventory slots IN ORDER and
   *  removing ONE item at a time (not a whole stack at once) until `foodLevel >= 12` or the
   *  slot empties, THEN the next slot -- ported verbatim below against `e.villagerInventory`. */
  function eatForBreeding(e) {
    var inv = NS.VB.ensureVillagerInventory ? NS.VB.ensureVillagerInventory(e) : e.villagerInventory;
    var IT = NS.Items;
    var lacksFood = (e.vbFoodLevel | 0) < VB.BREED_FOOD_MIN;
    if (inv && IT && IT.nameOf && lacksFood && VB.villagerFoodValue(e) !== 0) {
      for (var i = 0; i < inv.length && (e.vbFoodLevel | 0) < VB.BREED_FOOD_MIN; i++) {
        var st = inv[i];
        if (!st || !(st.n > 0)) continue;
        var name = IT.nameOf(st.i);
        var v = VB.BREED_FOOD_VALUES[name];
        if (!v) continue;
        while (st.n > 0 && (e.vbFoodLevel | 0) < VB.BREED_FOOD_MIN) {
          e.vbFoodLevel = (e.vbFoodLevel | 0) + v;
          st.n--;
        }
        if (st.n <= 0) inv[i] = null;
      }
    }
    e.vbFoodLevel = (e.vbFoodLevel | 0) - VB.BREED_FOOD_MIN;   // depleteFood(12) -- java:707
  }

  /** `getReachableHome`/`canReachHome` (java:89-97) -- every "home" POI within 48 blocks of
   *  `e`, nearest-first, capped to `VB.FIND_MAX_POSITIONS` candidates and multi-path-searched
   *  by `VB.pathToAny` -- the SAME shape `VB.findPoiTick` already uses for a per-tick claim,
   *  here a one-off query that reserves nothing (see file header). */
  function getReachableHome(e) {
    var Poi = NS.Poi;
    if (!Poi || !Poi.ready || !Poi.getInCircle || !Poi.HOME || !NS.Ai || !NS.Ai.findPath || !VB.pathToAny) return null;
    var bp = { x: Math.floor(e.x), y: Math.floor(e.y), z: Math.floor(e.z) };
    var list = Poi.getInCircle(function (t) { return t === Poi.HOME; }, bp, VBB.HOME_SEARCH_RADIUS, Poi.STATUS.HAS_SPACE);
    list.sort(function (a, b) {
      var da = (a.x - bp.x) * (a.x - bp.x) + (a.y - bp.y) * (a.y - bp.y) + (a.z - bp.z) * (a.z - bp.z);
      var db = (b.x - bp.x) * (b.x - bp.x) + (b.y - bp.y) * (b.y - bp.y) + (b.z - bp.z) * (b.z - bp.z);
      return da - db;
    });
    list = list.slice(0, VB.FIND_MAX_POSITIONS || 5);
    return list.length ? VB.pathToAny(e, list) : null;
  }

  /** `VillagerEntity.method_7225` (createChild, java:764-777) -- 50% biome roll, 25% self
   *  type, 25% partner type, called ON `e` (self), passing `partner` as the argument (so
   *  "self" and "the OTHER" resolve exactly as java:768-773 do). */
  function pickChildVillagerType(e, partner, r) {
    var roll = r();
    var Prof = NS.Profession;
    if (roll < 0.5) return (Prof && Prof.typeAtBiome) ? Prof.typeAtBiome(e.x, e.z) : (e.villagerType || 'plains');
    if (roll < 0.75) return e.villagerType || 'plains';
    return partner.villagerType || 'plains';
  }

  /** `createChild` (java:99-112) -- spawns at `e`'s (self's) own position, a fresh baby via
   *  `Breed.setBaby` (growAge/isBaby/dimensions, java:104-106's own -24000). This file family
   *  reads `e.isBaby` directly (single source of truth, `07m_breed.js`'s own `Br.tickAge` re-
   *  syncs it off `growAge` every tick as the sign crosses zero -- no second `.baby` flag to
   *  drift out of step). Status 12 (HEART) fires on the CHILD only (java:109), a single
   *  5-particle merchant burst, same as the courting hearts. Returns the child, or null if
   *  `EntityList.spawn` itself refused (vanilla's own `$$3 == null` branch is dead code in
   *  this engine too -- `method_7225` always succeeds when it runs at all -- kept as a real
   *  guard rather than assumed away). */
  function createChild(e, partner) {
    var EL = NS.EntityList;
    if (!EL || !EL.ready || !EL.spawn) return null;
    var r = VB.rand || Math.random;
    var vtype = pickChildVillagerType(e, partner, r);
    var child = EL.spawn('villager', e.x, e.y, e.z, { villagerType: vtype });
    if (!child) return null;
    var Br = NS.Breed;
    if (Br && Br.ready && Br.setBaby) Br.setBaby(child, true);
    emitHeart(child);
    return child;
  }

  /** `goHome` (java:61-75): no reachable home -> ANGRY (status 13) to BOTH, no child. A home
   *  -> `createChild`; on success, `setChildHome` (java:114-117, `remember` only -- NOT a POI
   *  ticket claim, file header) plus BOTH parents' own `setBreedingAge(6000)` (java:104-105,
   *  ONLY reached on this success path, unlike `eatForBreeding`'s own food cost which is paid
   *  regardless of whether a home was found). */
  function goHome(e, partner) {
    var home = getReachableHome(e);
    if (!home) { emitAngry(e); emitAngry(partner); return; }
    var child = createChild(e, partner);
    if (!child) return;
    child.vbHome = { x: home.x, y: home.y, z: home.z };
    var Br = NS.Breed;
    if (Br && Br.ready && Br.setAge && Br.C) {
      Br.setAge(e, Br.C.breedCooldownAge);
      Br.setAge(partner, Br.C.breedCooldownAge);
    }
  }

  /**
   * `VillagerBreedTask`'s own `shouldRun`/`run`/`tick`/`finish` (java:29-79), folded into one
   * per-villager-per-tick call the way every other separate priority tier in this brain already
   * is (`NS.VBPanic.tick`, `VB.findPoiTick`) — called from `07zv_villagerbrain.js`'s own
   * `VB.tick` while `activity === 'idle'`, for EVERY villager, independent of whichever
   * priority-2 RandomTask entry `tickIdle` picked this same tick (file header).
   */
  VBB.tick = function (e, now, tnow) {
    var partner = e.vbBreedTarget;
    if (!partner) { if (e.vbBreed) e.vbBreed = null; return; }
    if (partner.dead || partner.removed || partner.type !== 'villager') {
      e.vbBreedTarget = null; e.vbBreed = null; return;
    }
    // `isReadyToBreed` (java:81-87), re-checked every tick (`method_18973`'s own `keepRunning`,
    // java:33-35) -- LookTargetUtil.canSee's own visibility half is not modeled here, the same
    // no-line-of-sight simplification `breedInterestStart`'s own header already makes.
    if (!VB.villagerReadyToBreed(e) || !VB.villagerReadyToBreed(partner)) {
      e.vbBreedTarget = null; e.vbBreed = null; return;
    }
    if (!e.vbBreed) {
      // `run` (method_18974, java:37-44) -- look+walk once, roll the courting window. Status
      // 18 to both is sent in vanilla too (java:40-41) but is a genuine no-op for a villager
      // (file header) -- nothing emitted here, on purpose.
      lookWalkTowardsEachOther(e, partner);
      e.vbBreed = { end: tnow + VBB.COURT_MIN_TICKS + nextInt(VBB.COURT_VAR_TICKS) };
      return;
    }
    // `tick` (method_18975, java:46-59) -- everything below is gated on the pair still being
    // within `KEEP_RUNNING_DIST_SQ`; too far apart and NOTHING happens this tick (not even a
    // re-aim), matching java:48's own `if (!(squaredDistanceTo(partner) > 5.0))` wrapping the
    // task's entire per-tick body.
    if (distSq(e, partner) > VBB.KEEP_RUNNING_DIST_SQ) return;
    lookWalkTowardsEachOther(e, partner);
    if (tnow >= e.vbBreed.end) {
      eatForBreeding(e); eatForBreeding(partner);
      goHome(e, partner);
      // `finish` (method_18976, java:77-79) forgets BREED_TARGET -- vanilla reaches this one
      // tick later, once `keepRunning`'s own `now <= breedEndTime` finally reads false; clearing
      // it here immediately is the same outcome one tick sooner, not an extra courting round.
      e.vbBreedTarget = null; e.vbBreed = null;
    } else if (nextInt(VBB.ANGRY_HEART_CHANCE) === 0) {
      emitHeart(e); emitHeart(partner);
    }
  };

  VBB.ready = true;

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
