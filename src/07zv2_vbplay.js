// 07zv2_vbplay.js — loop/vbplay + loop/vbplaywander: baby villager PLAY activity (VB.OWED's
// "createPlayTasks (a baby's own PLAY activity)" line, src/07zv_villagerbrain.js). Read in full
// this session:
//   Schedule.java:16-21 (Schedule.VILLAGER_BABY) -- PLAY (field_18885) fires 3000..6000 and
//   10000..12000, the OTHER baby-only window besides idle/rest. 07zv_villagerbrain.js's own
//   VB.SCHEDULE_BABY now carries those two windows as 'play', not folded into 'idle'.
//   VillagerTaskListProvider.createPlayTasks (.decomp, VillagerTaskListProvider.java:81-101,
//   read whole) -- priority-0 WanderAroundTask(80,120), createFreeFollowTask(), priority-5
//   PlayWithVillagerBabiesTask, AND its OWN priority-5 RandomTask (six weighted entries) are
//   ALL ported (loop/vbbreed, this session) -- `VB.PLAY_FALLBACK`/`VB.playFallbackTick`, below,
//   the same weighted-pick shape `VB.idleFallbackTick` (07zv_villagerbrain.js) already uses,
//   dispatching into `VB.IDLE_START`'s own JumpInBedTask/GoTowardsLookTarget/cat-interest
//   (`07zv4_vbidle.js`, which also builds createIdleTasks' identical sixth entry) plus
//   `VB.villagerInterestStart`/`VB.findWalkTargetStart` (07zv_villagerbrain.js's own exports).
//   PlayWithVillagerBabiesTask.java (.decomp, read in full) -- `method_19583` (shouldRun):
//   `$$0.getRandom().nextInt(10) == 0 && this.hasVisibleVillagerBabies($$1)`. `method_19584`
//   (run): a visible baby whose OWN interaction target is already this villager wins outright
//   (`findVisibleVillagerBaby`, mutual play); failing that, `getLeastPopularBabyInteraction
//   Target` -- among visible babies that already have SOME live interaction target, count how
//   many share each target (`getBabyInteractionTargetCounts`), keep only counts in
//   `0 < count <= MAX_BABY_INTERACTION_COUNT(5)`, and take the LEAST popular (lowest count,
//   ties keep the first target counted -- `Map` iteration order is not vanilla-reproducible, so
//   this engine breaks ties the same "first candidate wins" way every other simplification in
//   this brain does, e.g. `VB.fuzzyFind`); failing THAT, any visible baby at all (`getVisibleMob`,
//   `findAny` -- read here as the first one found, same convention). `setPlayTarget` remembers
//   INTERACTION_TARGET, an EntityLookTarget, and a `WalkTarget(EntityLookTarget(target,false),
//   WALK_SPEED=0.6F, completionRange=1)` -- vanilla's WalkTarget wraps a LIVE EntityLookTarget,
//   so the walk keeps re-reading the partner's CURRENT position every tick (a chase, not a walk
//   to a fixed point); this engine's own e.vbWalkTarget is a static snapshot, so `VB.tickPlay`
//   re-aims it at the partner's live position on a short cadence (`VB.PLAY_REAIM_INTERVAL`,
//   below -- not a vanilla field, this engine's own stand-in for "re-read every tick").
//   VillagerBabiesSensor.java (.decomp, read in full) -- VISIBLE_VILLAGER_BABIES is every OTHER
//   villager baby inside NearestLivingEntitiesSensor's own AABB expansion
//   (NearestLivingEntitiesSensor.java:17, `getBoundingBox().expand(16.0,16.0,16.0)`); read here
//   as a plain squared-distance <= 16, no line-of-sight model (the SAME simplification
//   villagerInterestStart already makes for its own FindEntityTask stand-in,
//   07zv_villagerbrain.js:1170-1183).
//   WanderAroundTask.java (.decomp, read in full) -- the (minRunTime,maxRunTime) constructor
//   args are `Task`'s own random run-time window (150..250 by default, used by the CORE
//   WanderAroundTask() every activity already ticks via VB.wanderTick); createPlayTasks' own
//   copy passes (80,120) instead. Both copies require the exact SAME memory set (WALK_TARGET
//   REGISTERED, PATH/CANT_REACH ABSENT), so in real vanilla the priority-0 play-only copy wins
//   that memory lock over the priority-1 CORE copy while PLAY is active -- this engine has one
//   shared `VB.wanderTick(e, now, minRun, maxRun)` walk-executor (07zv_villagerbrain.js) that
//   now takes that window as an argument; its own PLAY dispatch line passes
//   `VB.PLAY_WANDER_MIN/MAX` (below) instead of the CORE default while `e.vbActivity === 'play'`.
//   Note this task does not INVENT a wander destination -- in vanilla nothing in createPlayTasks
//   sets one either (RandomTask's own FindWalkTargetTask, which does, is the ported-elsewhere
//   OWED item above) -- so in practice this window only ever governs the SAME WALK_TARGET
//   PlayWithVillagerBabiesTask's own setPlayTarget wrote (the chase).
//   FollowMobTask.java + VillagerTaskListProvider.createFreeFollowTask (.decomp, both read in
//   full, lines 244-260) -- a look-only RandomTask, weight-drawn EVERY tick (no vanilla state
//   carried between draws, `CompositeTask.Order.field_18349`/shuffled + `RunMode.field_18855`/
//   run-one, same shape `VB.idleFallbackTick` already uses for its own two-entry draw): CAT(8),
//   VILLAGER(2), PLAYER(2), SpawnGroup.CREATURE(1), WATER_CREATURE(1), AXOLOTLS(1),
//   UNDERGROUND_WATER_CREATURE(1), WATER_AMBIENT(1), MONSTER(1), WaitTask(30,60)(2) -- weight 20
//   total. `shouldRun` finds the first VISIBLE_MOBS entry matching the predicate within 8 blocks
//   (`LivingTargetCache.findFirst`, not decompiled in `.decomp`'s own sensor set -- read here as
//   nearest-by-distance, this engine's own stand-in, same "no real sensor ordering" caveat
//   `isVisibleBaby`'s plain-distance read already carries); `run` just remembers LOOK_TARGET as
//   a live EntityLookTarget (no walking) -- this engine's own `e.vbLookTarget` (the SAME field
//   `07zv_villagerbrain.js:905` already writes for a one-shot look) is re-aimed at the winner's
//   live position every tick while it stays visible (`VB.tickFreeFollow`, below), matching
//   `VB.tickPlay`'s own live-chase convention but with no cadence needed (a look has no pathing
//   cost to throttle). `SpawnGroup` membership is read via this engine's own `NS.Spawn.categoryOf`
//   (07l_spawn.js), which already encodes vanilla's real per-mob SpawnGroup for every mob this
//   engine spawns.
//
// NOT PORTED here: `LivingTargetCache`'s own VISIBLE_MOBS ordering (not in `.decomp`'s sensor
// set, read here as nearest-by-distance, `createFreeFollowTask`'s own header above).
(function (NS) {
  'use strict';

  var VB = NS.VB || (NS.VB = { ready: false });

  // PlayWithVillagerBabiesTask.java's own constants (see header for line-by-line citations).
  VB.PLAY_WALK_SPEED = 0.6;         // WALK_SPEED == PLAYING_WALK_SPEED, both 0.6F
  VB.PLAY_COMPLETION_RANGE = 1;     // setPlayTarget's own WalkTarget(..., 1)
  VB.PLAY_MAX_INTERACTION = 5;      // MAX_BABY_INTERACTION_COUNT
  VB.PLAY_RUN_CHANCE = 10;          // shouldRun: `random.nextInt(10) == 0`
  // VillagerBabiesSensor's own feed range (NearestLivingEntitiesSensor.java:17), read as plain
  // distance -- see file header.
  VB.PLAY_SENSE_RANGE = 16;
  // Not a vanilla field -- this engine's own re-aim cadence for a chase whose target moves
  // every tick, standing in for vanilla's live EntityLookTarget re-read (file header).
  VB.PLAY_REAIM_INTERVAL = 10;
  // createPlayTasks' OWN WanderAroundTask(80,120) run-time window (file header).
  VB.PLAY_WANDER_MIN = 80;
  VB.PLAY_WANDER_MAX = 120;
  // createFreeFollowTask's own FollowMobTask(*, 8.0F) sense range (file header).
  VB.FREE_FOLLOW_RANGE = 8;

  function rnd() { return (VB.rand || Math.random)(); }
  function nextInt(n) { return Math.floor(rnd() * n); }

  function isVisibleBaby(e, o) {
    if (o === e || o.type !== 'villager' || o.dead || o.removed || !o.isBaby) return false;
    var dx = o.x - e.x, dy = o.y - e.y, dz = o.z - e.z;
    return (dx * dx + dy * dy + dz * dz) <= VB.PLAY_SENSE_RANGE * VB.PLAY_SENSE_RANGE;
  }

  /** VillagerBabiesSensor.getVisibleVillagerBabies, read as plain distance (file header). */
  function visibleBabies(e) {
    var list = NS.EntityList && NS.EntityList.list, out = [];
    if (!list) return out;
    for (var i = 0; i < list.length; i++) if (isVisibleBaby(e, list[i])) out.push(list[i]);
    return out;
  }

  /** `findVisibleVillagerBaby` — a visible baby whose OWN interaction target is `e`. */
  function findMutual(e, babies) {
    for (var i = 0; i < babies.length; i++) if (babies[i].vbPlayTarget === e) return babies[i];
    return null;
  }

  /** `getLeastPopularBabyInteractionTarget`/`getBabyInteractionTargetCounts` (file header, read
   *  in full) -- count how many visible babies share each LIVE interaction target, keep counts
   *  in `0 < count <= MAX_BABY_INTERACTION_COUNT`, return the least-popular one (ties keep the
   *  first target counted -- `Map` iteration order is not vanilla-reproducible; see header). */
  function findLeastPopular(e, babies) {
    var targets = [], counts = [];
    for (var i = 0; i < babies.length; i++) {
      var t = babies[i].vbPlayTarget;
      if (!t || t === e || t.dead || t.removed) continue;
      var idx = targets.indexOf(t);
      if (idx === -1) { targets.push(t); counts.push(1); } else counts[idx]++;
    }
    var best = -1;
    for (var j = 0; j < targets.length; j++) {
      if (counts[j] > 0 && counts[j] <= VB.PLAY_MAX_INTERACTION && (best === -1 || counts[j] < counts[best])) best = j;
    }
    return best === -1 ? null : targets[best];
  }

  /** `getVisibleMob` — `findAny` over the visible babies, read as "the first one" (file header,
   *  same "ties/no-order keep the first candidate" convention this whole brain uses). */
  function findAnyBaby(e, babies) {
    for (var i = 0; i < babies.length; i++) {
      var b = babies[i];
      if (b !== e && !b.dead && !b.removed) return b;
    }
    return null;
  }

  function beginPlay(e, target) {
    e.vbPlayTarget = target;
    e.vbPlayReaim = 0;             // force an immediate re-aim below
  }

  /** PlayWithVillagerBabiesTask.method_19583/method_19584 folded into one per-tick check — this
   *  engine has no separate shouldRun/run split (VB.tick calls every activity's own tick
   *  function once per villager per tick, 07zv_villagerbrain.js's own VB.tick). */
  VB.tickPlay = function (e, tnow) {
    if (e.vbPlayTarget && (e.vbPlayTarget.dead || e.vbPlayTarget.removed)) e.vbPlayTarget = null;

    if (!e.vbPlayTarget) {
      if (nextInt(VB.PLAY_RUN_CHANCE) !== 0) return;      // shouldRun's own nextInt(10)==0
      var babies = visibleBabies(e);
      if (!babies.length) return;                          // hasVisibleVillagerBabies false
      beginPlay(e, findMutual(e, babies) || findLeastPopular(e, babies) || findAnyBaby(e, babies));
      if (!e.vbPlayTarget) return;
    }

    // The chase: re-aim e.vbWalkTarget at the partner's LIVE position every
    // VB.PLAY_REAIM_INTERVAL ticks (file header explains why this engine needs a cadence a real
    // live-memory WalkTarget does not).
    if (tnow >= e.vbPlayReaim) {
      var t = e.vbPlayTarget;
      var dx = t.x - e.x, dy = t.y - e.y, dz = t.z - e.z;
      if (t.dead || t.removed || (dx * dx + dy * dy + dz * dz) > VB.PLAY_SENSE_RANGE * VB.PLAY_SENSE_RANGE) {
        e.vbPlayTarget = null;
        return;
      }
      e.vbWalkTarget = { x: Math.floor(t.x), y: Math.floor(t.y), z: Math.floor(t.z), range: VB.PLAY_COMPLETION_RANGE };
      e.vbPlayReaim = tnow + VB.PLAY_REAIM_INTERVAL;
    }
  };

  // ── createFreeFollowTask (file header) ──────────────────────────────────────────────────────
  // [predicate, weight] pairs, in the SAME order as VillagerTaskListProvider.java:244-260.
  // 'wait' matches nothing -- it is WaitTask(30,60), a weighted "look at nothing this tick" slot.
  VB.FREE_FOLLOW_CANDIDATES = [
    ['cat', 8], ['villager', 2], ['player', 2],
    ['creature', 1], ['water_creature', 1], ['axolotls', 1],
    ['underground_water_creature', 1], ['water_ambient', 1], ['monster', 1],
    ['wait', 2]
  ];

  function matchesCandidate(kind, o) {
    if (kind === 'cat') return o.type === 'cat';
    if (kind === 'villager') return o.type === 'villager';
    return NS.Spawn && NS.Spawn.categoryOf(o.type) === kind;
  }

  /** `LivingTargetCache.findFirst`'s own ordering is not in `.decomp`'s sensor set -- read here
   *  as nearest-by-distance (file header), the same caveat `isVisibleBaby`'s plain-distance
   *  read already carries. Returns the nearest entity of `kind` within VB.FREE_FOLLOW_RANGE. */
  function nearestOfKind(e, kind) {
    var list = NS.EntityList && NS.EntityList.list;
    var rangeSq = VB.FREE_FOLLOW_RANGE * VB.FREE_FOLLOW_RANGE;
    var best = null, bestDsq = Infinity;
    if (list) {
      for (var i = 0; i < list.length; i++) {
        var o = list[i];
        if (o === e || o.dead || o.removed || !matchesCandidate(kind, o)) continue;
        var dx = o.x - e.x, dy = o.y - e.y, dz = o.z - e.z, dsq = dx * dx + dy * dy + dz * dz;
        if (dsq <= rangeSq && dsq < bestDsq) { best = o; bestDsq = dsq; }
      }
    }
    if (kind === 'player' && NS.Player) {
      var p = NS.Player;
      var pdx = p.x - e.x, pdy = p.y - e.y, pdz = p.z - e.z, pdsq = pdx * pdx + pdy * pdy + pdz * pdz;
      if (pdsq <= rangeSq && pdsq < bestDsq) { best = p; bestDsq = pdsq; }
    }
    return best;
  }

  /** `createFreeFollowTask`'s own weighted `RandomTask` draw, redrawn fresh every tick (file
   *  header) -- the SAME Efraimidis-Spirakis weighted order `VB.idleFallbackTick`
   *  (07zv_villagerbrain.js) already uses for its own two-entry draw, generalized to N entries. */
  function weightedFollowOrder() {
    var order = VB.FREE_FOLLOW_CANDIDATES.map(function (r) { return { kind: r[0], key: -Math.pow(rnd(), 1 / r[1]) }; });
    order.sort(function (a, b) { return a.key - b.key; });
    return order;
  }

  /** `FollowMobTask.shouldRun` requires LOOK_TARGET absent to draw a NEW target; once one is
   *  picked it keeps tracking (a live EntityLookTarget) until it leaves range/dies, at which
   *  point a fresh draw can happen again -- this engine's own e.vbFollowTarget mirrors that
   *  (07zv_villagerbrain.js:905's own e.vbLookTarget field, re-aimed here every tick since a
   *  look, unlike a walk, has no path to re-plan). */
  VB.tickFreeFollow = function (e) {
    if (e.vbFollowTarget && (e.vbFollowTarget.dead || e.vbFollowTarget.removed)) e.vbFollowTarget = null;
    if (e.vbFollowTarget) {
      var dx = e.vbFollowTarget.x - e.x, dy = e.vbFollowTarget.y - e.y, dz = e.vbFollowTarget.z - e.z;
      if (dx * dx + dy * dy + dz * dz > VB.FREE_FOLLOW_RANGE * VB.FREE_FOLLOW_RANGE) e.vbFollowTarget = null;
    }
    if (!e.vbFollowTarget) {
      var order = weightedFollowOrder();
      for (var i = 0; i < order.length; i++) {
        if (order[i].kind === 'wait') break;   // WaitTask wins the draw: do nothing this tick
        var hit = nearestOfKind(e, order[i].kind);
        if (hit) { e.vbFollowTarget = hit; break; }
      }
      if (!e.vbFollowTarget) return;
    }
    var t = e.vbFollowTarget;
    e.vbLookTarget = { x: t.x, y: t.y, z: t.z };
  };

  // ── loop/vbbreed: createPlayTasks' OWN priority-5 RandomTask (VillagerTaskListProvider.java:
  //    87-97, read in full this session) -- SIX weighted entries, gated on VISIBLE_VILLAGER_
  //    BABIES present (`ImmutableMap.of(MemoryModuleType.field_19006, MemoryModuleState.
  //    field_18457)`, java:88), modeled below as `visibleBabies(e).length > 0` (this file's own
  //    sensor stand-in, above). ⚠⚠ NOT "breed-interest, trader-interest" (a guess this file's
  //    own header used to carry, before `createPlayTasks` was read in full this session):
  //    `EntityType.field_6077` is VILLAGER and `EntityType.field_16281` is CAT (EntityType.java:
  //    577,185) -- the FIRST entry is a second villager-interest FindEntityTask (no
  //    isReadyToBreed predicate, unlike createIdleTasks' own breed-interest copy), the SECOND
  //    is cat-interest, and `07zv4_vbidle.js`'s own `traderInterestStart` carried the exact
  //    same wrong guess for createIdleTasks' identical sixth entry (renamed/fixed there this
  //    same session). Weights straight off java:90-96: villager-interest 2, cat-interest 1,
  //    FindWalkTargetTask 1, GoTowardsLookTarget 1, JumpInBedTask 2, WaitTask(20,40) 2 -- note
  //    JumpInBedTask/WaitTask carry DIFFERENT weights AND WaitTask a different (min,max) window
  //    (20,40) than createIdleTasks' own copies (1/1, WaitTask(30,60), 07zv4_vbidle.js) -- two
  //    separate `Pair.of`/`new WaitTask(...)` calls in the jar, not one shared instance.
  VB.PLAY_FALLBACK = [
    ['villagerInterest', 2], ['catInterest', 1], ['findWalkTarget', 1],
    ['goTowardsLook', 1], ['jumpInBed', 2], ['wait', 2]
  ];
  VB.PLAY_WAIT_MIN_TICKS = 20;   // `new WaitTask(20, 40)` -- VillagerTaskListProvider.java:96
  VB.PLAY_WAIT_MAX_TICKS = 40;

  /** `WaitTask(20,40)`'s own start -- the SAME `e.vbIdleWait` state/consumer
   *  (`waitTick`/`VB.idleContinue`, 07zv4_vbidle.js) createIdleTasks' own `waitStart` already
   *  writes, just a different rolled window; both are legitimate independent producers of the
   *  one shared field (whichever RandomTask happens to pick "wait" that tick). */
  function playWaitStart(e) {
    if (e.vbIdleWait) return false;
    e.vbIdleWait = { ticksLeft: VB.PLAY_WAIT_MIN_TICKS + Math.floor(rnd() * (VB.PLAY_WAIT_MAX_TICKS + 1 - VB.PLAY_WAIT_MIN_TICKS)) };
    return true;
  }

  /** The weighted pick itself -- the SAME `-Math.pow(rnd(), 1/weight)`-sorted shuffle
   *  `VB.idleFallbackTick` (07zv_villagerbrain.js) already uses, reusing THAT file's/
   *  `07zv4_vbidle.js`'s own start functions directly through `VB.IDLE_START` (JumpInBedTask/
   *  GoTowardsLookTarget/cat-interest are the exact same `Task`s in both RandomTasks) and
   *  `VB.villagerInterestStart`/`VB.findWalkTargetStart` (07zv_villagerbrain.js's own exports).
   *  Called from `07zv_villagerbrain.js`'s own `VB.tick` while `activity === 'play'`, AFTER
   *  `VB.idleContinue` (the SAME JumpInBedTask/WaitTask multi-tick interceptor createIdleTasks'
   *  own dispatch already uses -- both RandomTasks share the one `e.vbBedJump`/`e.vbIdleWait`
   *  state, so a task started from EITHER list keeps running the SAME way). */
  VB.playFallbackTick = function (e) {
    if (!visibleBabies(e).length) return null;   // VISIBLE_VILLAGER_BABIES absent -- refuses
    var order = VB.PLAY_FALLBACK.map(function (r) { return { name: r[0], key: -Math.pow(rnd(), 1 / r[1]) }; });
    order.sort(function (a, b) { return a.key - b.key; });
    for (var i = 0; i < order.length; i++) {
      var name = order[i].name;
      if (name === 'villagerInterest' && VB.villagerInterestStart && VB.villagerInterestStart(e)) return name;
      if (name === 'catInterest' && VB.IDLE_START && VB.IDLE_START.catInterest && VB.IDLE_START.catInterest(e)) return name;
      if (name === 'findWalkTarget' && VB.findWalkTargetStart && VB.findWalkTargetStart(e)) return name;
      if (name === 'goTowardsLook' && VB.IDLE_START && VB.IDLE_START.goTowardsLook && VB.IDLE_START.goTowardsLook(e)) return name;
      if (name === 'jumpInBed' && VB.IDLE_START && VB.IDLE_START.jumpInBed && VB.IDLE_START.jumpInBed(e)) return name;
      if (name === 'wait' && playWaitStart(e)) return name;
    }
    return null;
  };

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
