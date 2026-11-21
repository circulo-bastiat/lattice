// 07zv3_vbpanic.js — loop/vbpanic: villager Activity.PANIC (.decomp/net/minecraft/entity/ai/
// brain/task/PanicTask.java, StopPanickingTask.java, VillagerHostilesSensor.java,
// VillagerTaskListProvider.java:201-208/createPanicTasks, VillagerEntity.java:241, Activity.java
// field_18599). Strikes 07zv_villagerbrain.js's own `VB.OWED[0]`'s trailing clause:
// "createPanicTasks/the PANIC activity is not wired (no danger-memory substrate exists yet to
// trigger it)". NEW file (not folded into 07zv_villagerbrain.js) so this unit's own edits there
// stay to the hook lines VB.tick needs — see this file's own header note at the call site.
//
// THE SHAPE, as vanilla has it:
//   - VillagerHostilesSensor writes MemoryModuleType.NEAREST_HOSTILE (field_18453): the nearest
//     visible entity from a fixed table of hostile EntityTypes, each with its OWN "close enough
//     to be dangerous" distance. HurtBySensor writes HURT_BY (field_18451, `DamageSource`,
//     40-tick decay off LivingEntity.getRecentDamageSource) and HURT_BY_ENTITY (field_18452, the
//     attacker, never expires on its own).
//   - PanicTask is a CORE task (createCoreTasks, priority 0 — runs every tick, in every
//     activity): while (wasHurt || isHostileNearby), it force-activates Activity.PANIC
//     (`Brain.doExclusively`), clearing PATH/WALK_TARGET/LOOK_TARGET/BREED_TARGET/
//     INTERACTION_TARGET on the tick it FIRST does so, and — every 100 ticks while it keeps
//     doing so — calls `VillagerEntity.summonGolem(world, time, 3)`.
//   - createPanicTasks' own list runs WHILE Activity.PANIC is the active one: StopPanickingTask
//     (priority 0) ends panic once wasHurt/isHostileNearby/wasHurtByNearbyEntity(<=6 blocks of
//     HURT_BY_ENTITY) are ALL false, forgetting HURT_BY + HURT_BY_ENTITY; two priority-1
//     GoToRememberedPositionTasks flee AWAY from NEAREST_HOSTILE then (if that didn't set a walk
//     target) away from HURT_BY_ENTITY; a priority-3 FindWalkTargetTask(speed,2,2) is the
//     fallback once neither flee target could be found; a priority-5 createBusyFollowTask
//     (FollowMobTask(cat)/FollowMobTask(wolf)/WaitTask, weighted 2/2/8) sets a LOOK_TARGET at a
//     nearby cat/wolf — wired below (`tickBusyFollow`) for PANIC's OWN entry only; every OTHER
//     activity's own createBusyFollowTask/createFreeFollowTask call
//     (07zv_villagerbrain.js:725's own comment) stays that file's cross-cutting OWED, unrelated
//     to this one.
//
// THIS ENGINE has no per-tick Sensor scheduler and no separate PATH/LOOK_TARGET/BREED_TARGET/
// INTERACTION_TARGET memories — `e.vbWalkTarget` is the one shared WALK_TARGET stand-in
// 07zv_villagerbrain.js's own header already establishes, and `e.lastHurtByEntity`/`e.hurtSeq`
// (14j_combat.js's own `Cb.notifyHurt`, the ONE real hit-landing choke point every attack path in
// this engine already funnels through) are the existing generic "who hit me" bookkeeping every
// other hostile-reacting mob in this engine already reads (07zj_polarbear.js, 07zi_squid.js,
// 07zl_panda.js, ...). `e.vbHurtTick` (stamped by that SAME hook, villager-only) is the new
// HURT_BY stand-in this unit adds — see the hook lines in 14j_combat.js's own `Cb.notifyHurt`.
(function (NS) {
  'use strict';
  var VBP = NS.VBPanic = { ready: false };

  // ── VillagerHostilesSensor (.decomp .../sensor/VillagerHostilesSensor.java:9-21) ───────────
  // ⚠ The jar's own field is misleadingly named `SQUARED_DISTANCES_FOR_DANGER` — every value in
  // it is a PLAIN distance; `isCloseEnoughForDanger` squares it AGAIN at the comparison site
  // (`squaredDistanceTo <= dist * dist`). Named here as plain distances on purpose, so this file
  // never carries that footgun forward. All eleven EntityTypes in the jar's own table exist as
  // spawnable types in this engine (assets/entities.json's own `attrs`/`types` tables list every
  // one of them, including illusioner/zoglin/husk — nothing here is narrowed for a missing mob).
  VBP.HOSTILE_DANGER_DIST = {
    drowned: 8, evoker: 12, husk: 8, illusioner: 12, pillager: 15, ravager: 12,
    vex: 8, vindicator: 10, zoglin: 10, zombie: 8, zombie_villager: 8
  };

  // HURT_BY's own 40-tick decay (.decomp/net/minecraft/entity/LivingEntity.java:1218-1223,
  // `getRecentDamageSource`: `world.getTime() - lastDamageTime > 40L` clears it).
  VBP.HURT_DECAY_TICKS = 40;
  // StopPanickingTask.MAX_DISTANCE (.decomp .../task/StopPanickingTask.java:9) — named 36 in the
  // jar but read directly against `squaredDistanceTo` (StopPanickingTask.java:23), i.e. it is
  // ALREADY the squared form of a plain 6-block distance; stored here as the plain distance.
  VBP.STOP_MAX_DIST = 6;
  // GoToRememberedPositionTask.setWalkTarget's own hardcoded FuzzyTargeting.findFrom(e,16,7,pos)
  // radius (.decomp .../task/GoToRememberedPositionTask.java:67) — NOT createPanicTasks' own
  // `range=6` ctor arg (VillagerTaskListProvider.java:215-216), which is the "close enough, stop
  // re-planning" test (`isWalkTargetPresentAndFar`/`method_19002`) this engine's shared
  // `e.vbWalkTarget.range`/`hasReached` field already stands in for everywhere else in
  // 07zv_villagerbrain.js (VB.walkTowardsTick's own `completionRange` is the same collapse).
  VBP.FLEE_FIND_H = 16;
  VBP.FLEE_FIND_V = 7;
  VBP.FLEE_ANGLE = Math.PI / 2;      // FuzzyTargeting.findValid's own hardcoded angle
  VBP.FLEE_RANGE = 6;                // createPanicTasks' own GoToRememberedPositionTask range arg
  // FindWalkTargetTask($$2, 2, 2) inside createPanicTasks (VillagerTaskListProvider.java:217) —
  // a much tighter box than the idle FindWalkTargetTask's own (10,7) (07zv_villagerbrain.js's
  // own VB.IDLE_FIND_H/V).
  VBP.FIND_WALK_H = 2;
  VBP.FIND_WALK_V = 2;
  // PanicTask.method_20648's own `time % 100L == 0L` gate (.decomp PanicTask.java:34-38) and its
  // `summonGolem(world, time, 3)` call — a LOWER quorum than talkWithVillager's own summonGolem
  // (...,5) (.decomp/net/minecraft/entity/passive/VillagerEntity.java:865 vs PanicTask.java:36).
  VBP.GOLEM_INTERVAL = 100;
  VBP.GOLEM_QUORUM = 3;
  // createPanicTasks' own `$$2 = $$1 * 1.5F` (.decomp VillagerTaskListProvider.java:202) — the
  // SAME boosted speed is handed to BOTH GoToRememberedPositionTasks (:205-206) AND
  // FindWalkTargetTask (:207); tagged onto `e.vbWalkTarget.speedMul` below and read back by
  // VB.wanderTick's own two `NS.Ai.stepToward` call sites (07zv_villagerbrain.js), the ONE hunk
  // this unit touches in that file (VB.WALK_SPEED itself stays the single engine-wide constant
  // that file's own header already documents — this is a per-walk multiplier on top of it, not
  // a second copy of it).
  VBP.PANIC_SPEED_MUL = 1.5;
  // Sensor's own tick cadence (.decomp .../sensor/Sensor.java:12,29-34,41-46):
  // DEFAULT_RUN_TIME=20, decremented once per real tick, `sense()` re-run only once it hits
  // zero (then reset to the interval) — NOT every tick, the gap this file's own OWED named.
  // VillagerHostilesSensor extends NearestVisibleLivingEntitySensor extends Sensor with the
  // default (no-arg) ctor, so it runs on this SAME 20-tick cadence; so does
  // NearestLivingEntitiesSensor (used below for createBusyFollowTask's own FollowMobTask
  // candidates). ⚠ The jar also staggers every Sensor instance's FIRST run with
  // `RANDOM.nextInt(senseInterval)` (Sensor.java:34) so many villagers don't all resense on the
  // same frame — NOT modeled: `e.vbHostileSenseCD`/`e.vbNearbySenseCD` start at 0 (this file's
  // own "first touch senses immediately" collapse, matching every OTHER once-only setup read in
  // this engine, e.g. `wasHurt`'s own `undefined` != a real stamp), so only the RECURRING
  // 20-tick cadence after that first sense is the part actually modeled.
  VBP.SENSE_INTERVAL = 20;
  // createBusyFollowTask (.decomp VillagerTaskListProvider.java:264-275): priority-5 RandomTask
  // over FollowMobTask(CAT,8.0F) weight 2, FollowMobTask(WOLF-as-field_6097,8.0F) weight 2,
  // WaitTask(30,60) weight 8 (total 12). RandomTask draws exactly ONE weighted entry per tick
  // and only that draw's own shouldRun gets a try; WaitTask's own run has no observable effect
  // in this engine (no wait-timer/animation state exists for it) so it collapses to "no draw" —
  // the SAME "no-op branch of a modeled random draw is just skipped" idiom
  // `villagerWorkShouldRun`'s own 50% coin flip already uses (07zv_villagerbrain.js).
  VBP.BUSY_FOLLOW_CAT_WEIGHT = 2;
  VBP.BUSY_FOLLOW_WOLF_WEIGHT = 2;
  VBP.BUSY_FOLLOW_TOTAL_WEIGHT = 12;
  VBP.BUSY_FOLLOW_DIST = 8;   // FollowMobTask's own ctor arg, both entries (:269-270)

  function nextInt(n) { return Math.floor((NS.VB ? NS.VB.rand() : Math.random()) * n); }

  // ── world predicates FuzzyTargeting's own `validate`/`towardTarget` need ────────────────────
  // Small local copies of 07zv_villagerbrain.js's own private `heightInvalid`/`validFloorUnder`/
  // `hasPenalty` (that file's own lines ~215-231) — those three are NOT exported off `VB`, and
  // re-deriving them off the SAME NS-level reads (NS.Physics/NS.States/NS.Ai) they use keeps this
  // unit's edit to 07zv_villagerbrain.js itself down to its one activity-dispatch hook line.
  function stateAt(x, y, z) { return NS.Physics && NS.Physics.blockAt ? NS.Physics.blockAt(x, y, z) : 0; }
  function solidAt(x, y, z) { return !!(NS.Physics && NS.Physics.solidAt && NS.Physics.solidAt(x, y, z)); }
  function heightInvalid(p) {
    var C = NS.CFG || { WORLD_MIN_Y: -64, WORLD_MAX_Y: 256 };
    return p.y < C.WORLD_MIN_Y || p.y > C.WORLD_MAX_Y;
  }
  function validFloorUnder(p) {
    var SR = NS.States;
    return !!(SR && SR.fullCubeCollision && SR.fullCubeCollision(stateAt(p.x, p.y - 1, p.z)));
  }
  var VILLAGER_MOB = { type: 'villager' };
  function hasPenalty(p) {
    var Ai = NS.Ai;
    if (!Ai || !Ai.pathTypeAt || !Ai.NodeType) return !!(NS.Physics && NS.Physics.solidAt && NS.Physics.solidAt(p.x, p.y, p.z));
    var t = Ai.pathTypeAt(p.x, p.y, p.z);
    // s117: `mob.getPathfindingPenalty(getLandNodeType(pos)) != 0` read literally, now that the
    // full node-type table exists (07k_goals.js `Ai.pathPenalty`, MerchantEntity's own rows).
    if (Ai.pathPenalty) return Ai.pathPenalty(VILLAGER_MOB, t) !== 0;
    return !(t === Ai.NodeType.WALKABLE || t === Ai.NodeType.OPEN);
  }

  /** `FuzzyTargeting.findFrom(e, 16, 7, targetPos)` (.decomp .../ai/FuzzyTargeting.java:32-49):
   *  fuzz a point in the (h,v) box biased AWAY from `target` (direction = self - target, the
   *  mirror of `VB.noPenaltyFindTo`'s own toward-target direction), then `validate` (.decomp
   *  FuzzyTargeting.java:51-54): climb out of solid ground (`FuzzyPositions.upWhile`, the SAME
   *  climb `VB.fuzzyFind`'s own header already implements) before the water/penalty refusal.
   *  Keeps the first of 10 whose height/floor/penalty all pass — the SAME "ties keep the first
   *  candidate" simplification
   *  `VB.noPenaltyFindTo`'s own header already documents for `guessBestPathTarget`'s real
   *  path-cost scoring (a villager's `getPathfindingFavor` never overrides the 0.0F default, so
   *  every real candidate ties there too). */
  function fleeAwayFrom(e, target) {
    if (!NS.VB || !NS.VB.localFuzzToward) return null;
    var C = NS.CFG || { WORLD_MAX_Y: 256 };
    var dx = e.x - target.x, dz = e.z - target.z;
    for (var i = 0; i < 10; i++) {
      var o = NS.VB.localFuzzToward(VBP.FLEE_FIND_H, VBP.FLEE_FIND_V, dx, dz, VBP.FLEE_ANGLE);
      if (!o) continue;
      var p = { x: Math.floor(o.x + e.x), y: Math.floor(o.y + e.y), z: Math.floor(o.z + e.z) };
      if (heightInvalid(p)) continue;
      while (p.y < C.WORLD_MAX_Y && solidAt(p.x, p.y, p.z)) p = { x: p.x, y: p.y + 1, z: p.z };
      if (!validFloorUnder(p) || hasPenalty(p)) continue;
      return p;
    }
    return null;
  }

  /** `LivingEntity.canSee` (.decomp .../LivingEntity.java:2732-2743), the ray
   *  `MobVisibilityCache.canSee` (.decomp .../mob/MobVisibilityCache.java:21-39, cached per
   *  (owner,target) pair there — NOT re-modeled here, see VBP.OWED history above the
   *  cadence-cache functions below) actually casts, and `TargetPredicate.test`'s own
   *  `respectsVisibility` branch (.decomp .../ai/TargetPredicate.java:86-88, `MobEntity`
   *  branch) calls into. Eye-to-eye (`getEyeY`), `RaycastContext.ShapeType.COLLIDER` (physical
   *  collision shape, not the visual outline) + `FluidHandling.NONE` (fluids never occlude),
   *  bailing false past 128 blocks; a MISS means visible. This engine's OWN block-targeting
   *  raycast, `NS.Ray.cast` (14c_raycast.js), is COLLIDER-shaped by construction (every real
   *  block here is a full cube, per that file's own header) and its default predicate,
   *  `NS.Ray.targetable`, is already "solid, not a fluid" — the EXACT COLLIDER+NONE occlusion
   *  test canSee needs — so this reuses it rather than re-deriving a second copy. */
  function canSeeEntity(a, b) {
    if (!NS.Ray || !NS.Ray.cast) return true;   // helper missing — fail open (the OLD assumed-true behaviour)
    var Cb = NS.Combat;
    var aey = a.y + (Cb && Cb.eyeHeightOf ? Cb.eyeHeightOf(a) : (a.eyeHeight || (a.height || 1.8) * 0.85));
    var bey = b.y + (Cb && Cb.eyeHeightOf ? Cb.eyeHeightOf(b) : (b.eyeHeight || (b.height || 1.8) * 0.85));
    var dx = b.x - a.x, dy = bey - aey, dz = b.z - a.z;
    var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > 128) return false;               // LivingEntity.canSee's own 128-block bail (:2738)
    if (dist < 1e-6) return true;
    var hit = NS.Ray.cast(a.x, aey, a.z, dx / dist, dy / dist, dz / dist, dist, NS.Ray.targetable);
    return !hit;                                 // HitResult.Type.MISS (field_1333) == visible
  }

  /** HURT_BY (.decomp .../MemoryModuleType.java:50, field_18451): true for `HURT_DECAY_TICKS`
   *  after the villager's own last landed hit (`e.vbHurtTick`, stamped by 14j_combat.js's
   *  `Cb.notifyHurt` off the SAME per-villager `e.vbAge` clock `VB.tick` hands this file as
   *  `tnow` — the identical clock every other timer in 07zv_villagerbrain.js already compares
   *  against). `undefined` (never hurt) is deliberately distinct from a real stamp at tick 0. */
  function wasHurt(e, tnow) {
    return e.vbHurtTick !== undefined && (tnow - e.vbHurtTick) <= VBP.HURT_DECAY_TICKS;
  }

  /** `VillagerHostilesSensor.matches`/`isCloseEnoughForDanger` (see header) plus
   *  `NearestVisibleLivingEntitySensor`'s own `LivingTargetCache.findFirst`, which layers
   *  `Sensor.testTargetPredicate` (`TargetPredicate.createNonAttackable()`, `respectsVisibility`
   *  left at its default `true`) on top — nearest matching entity that the villager can ALSO
   *  see, or null. The uncached, "resense right now" scan; `hostileSenseTick` below wraps it in
   *  the real Sensor cadence. */
  function findNearestHostileNow(e) {
    var list = NS.EntityList && NS.EntityList.list;
    if (!list) return null;
    var best = null, bestD = Infinity;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o === e || o.dead || o.removed) continue;
      var dist = VBP.HOSTILE_DANGER_DIST[o.type];
      if (dist === undefined) continue;
      var dx = o.x - e.x, dy = o.y - e.y, dz = o.z - e.z, d = dx * dx + dy * dy + dz * dz;
      if (d <= dist * dist && d < bestD && canSeeEntity(e, o)) { bestD = d; best = o; }
    }
    return best;
  }

  /** VillagerHostilesSensor's own 20-tick cadence (Sensor.tick, see VBP.SENSE_INTERVAL's own
   *  header) — `e.vbHostileCache` is NEAREST_HOSTILE, only ever refreshed on the gate. */
  function hostileSenseTick(e) {
    if (e.vbHostileSenseCD === undefined) e.vbHostileSenseCD = 0;
    if (--e.vbHostileSenseCD <= 0) {
      e.vbHostileSenseCD = VBP.SENSE_INTERVAL;
      e.vbHostileCache = findNearestHostileNow(e);
    }
    return e.vbHostileCache || null;
  }

  /** `NearestLivingEntitiesSensor.sense` (.decomp .../sensor/NearestLivingEntitiesSensor.java:
   *  16-23): every OTHER living entity in `getBoundingBox().expand(16,16,16)` — a box; collapsed
   *  here to the inscribed-sphere radius 16 plain-distance test, the SAME box→sphere collapse
   *  `HOSTILE_DANGER_DIST`'s own per-type distances already make (that table's own values are
   *  plain radii too, not box half-extents). The sort by distance (:19) is not reproduced — this
   *  file only ever needs "nearest of a given type", scanned directly by `nearestOfType` below,
   *  the same "min-scan with the predicate folded in" as `findNearestHostileNow`. */
  function nearbyLivingNow(e) {
    var list = NS.EntityList && NS.EntityList.list;
    var out = [];
    if (!list) return out;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o === e || o.dead || o.removed) continue;
      var dx = o.x - e.x, dy = o.y - e.y, dz = o.z - e.z;
      if (dx * dx + dy * dy + dz * dz <= 256) out.push(o);   // 16*16
    }
    return out;
  }

  /** NearestLivingEntitiesSensor's own 20-tick cadence — `e.vbNearbyCache` stands in for its
   *  two output memories (field_18441/field_18442) folded into one plain list here (this file
   *  only ever reads it for FollowMobTask candidates, never for anything sorted-by-priority). */
  function nearbyLivingSenseTick(e) {
    if (e.vbNearbySenseCD === undefined) e.vbNearbySenseCD = 0;
    if (--e.vbNearbySenseCD <= 0) {
      e.vbNearbySenseCD = VBP.SENSE_INTERVAL;
      e.vbNearbyCache = nearbyLivingNow(e);
    }
    return e.vbNearbyCache || [];
  }

  /** `StopPanickingTask.wasHurtByNearbyEntity` (.decomp .../StopPanickingTask.java:23-25):
   *  HURT_BY_ENTITY present AND within `STOP_MAX_DIST` blocks — the ONE thing that can keep
   *  panic running even once `wasHurt`/`isHostileNearby` both go false. */
  function wasHurtByNearbyEntity(e) {
    var a = e.lastHurtByEntity;
    if (!a || a.dead || a.removed) return false;
    var dx = a.x - e.x, dy = a.y - e.y, dz = a.z - e.z;
    return (dx * dx + dy * dy + dz * dz) <= VBP.STOP_MAX_DIST * VBP.STOP_MAX_DIST;
  }

  /** Plain "within `range` blocks" test, the SAME shape as `wasHurtByNearbyEntity` above —
   *  used by the GoToRememberedPositionTask `shouldRun` collapse below. */
  function withinRange(e, target, range) {
    var dx = target.x - e.x, dy = target.y - e.y, dz = target.z - e.z;
    return (dx * dx + dy * dy + dz * dz) <= range * range;
  }

  /** `GoToRememberedPositionTask.method_19002` (.decomp .../GoToRememberedPositionTask.java:
   *  41-43) — the class's real `shouldRun`, keyed on this base class's own `(ServerWorld, E)`
   *  signature (Task.java's own `shouldRun` — the ONLY method on that base class with this exact
   *  shape, which is how a decompiled, un-renamed `method_19002` is identified as it here):
   *  `isWalkTargetPresentAndFar(e) ? false : isInRange(getPos(e), range)`.
   *  ⚠ `isWalkTargetPresentAndFar` (:49-62) opens with `if (!brain.hasMemoryModule(WALK_TARGET))
   *  return false;` — and BOTH of createPanicTasks' own GoToRememberedPositionTask calls pass
   *  `false` for `requireWalkTargetPresent` (VillagerTaskListProvider.java:205-206), which wires
   *  WALK_TARGET's OWN start-condition to `field_18457` (VALUE_ABSENT — the SAME state
   *  `FindWalkTargetTask.java:29` requires for the identical memory, confirming which constant
   *  it is). A Task's `shouldRun` is only ever consulted by the brain while its own declared
   *  memory *start* conditions already hold, so at the one call site this file has,
   *  WALK_TARGET is ALREADY guaranteed absent whenever `shouldRun` runs — `hasMemoryModule`
   *  is therefore always false there, `isWalkTargetPresentAndFar` never reaches its dot-product
   *  branch, and `shouldRun` collapses to its own plain remainder: `isInRange(range)`, i.e. "am
   *  I within FLEE_RANGE (6) of the thing I'm about to flee". THIS (not a present/far split) is
   *  the real gap the old code had: it planned a flee walk unconditionally, at any detection
   *  distance (up to a hostile's own 8-15-block HOSTILE_DANGER_DIST), instead of only once
   *  already within 6 — farther than that, only FindWalkTargetTask's small wander (below) runs,
   *  same as real vanilla. */
  function fleeShouldRun(e, source) {
    return withinRange(e, source, VBP.FLEE_RANGE);
  }

  /** `FollowMobTask.shouldRun`/`run` (.decomp .../task/FollowMobTask.java:44-54): nearest
   *  matching, VISIBLE (LivingTargetCache's own lazy `canSee`, the same test `findNearestHostileNow`
   *  already applies) entity of `type` within `maxDistSq`; `run` remembers it as LOOK_TARGET —
   *  this engine's own `e.vbLookTarget` stand-in (07zv_villagerbrain.js:905's own precedent). */
  function nearestOfType(list, e, type, maxDistSq) {
    var best = null, bestD = Infinity;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o === e || o.type !== type || o.dead || o.removed) continue;
      var dx = o.x - e.x, dy = o.y - e.y, dz = o.z - e.z, d = dx * dx + dy * dy + dz * dz;
      if (d <= maxDistSq && d < bestD && canSeeEntity(e, o)) { bestD = d; best = o; }
    }
    return best;
  }

  /** `createBusyFollowTask` (see VBP.BUSY_FOLLOW_* header) — panic's OWN priority-5 entry
   *  (VillagerTaskListProvider.java:208). Runs every panic tick regardless of what the
   *  WALK_TARGET tasks above did (LOOK_TARGET is a different memory, no conflict). */
  function tickBusyFollow(e) {
    var roll = nextInt(VBP.BUSY_FOLLOW_TOTAL_WEIGHT);
    var maxDSq = VBP.BUSY_FOLLOW_DIST * VBP.BUSY_FOLLOW_DIST;
    var nearby, target;
    if (roll < VBP.BUSY_FOLLOW_CAT_WEIGHT) {
      nearby = nearbyLivingSenseTick(e);
      target = nearestOfType(nearby, e, 'cat', maxDSq);
    } else if (roll < VBP.BUSY_FOLLOW_CAT_WEIGHT + VBP.BUSY_FOLLOW_WOLF_WEIGHT) {
      nearby = nearbyLivingSenseTick(e);
      target = nearestOfType(nearby, e, 'wolf', maxDSq);
    } else {
      return;   // WaitTask drawn — no observable effect (see header)
    }
    if (target) e.vbLookTarget = { x: target.x, y: target.y, z: target.z };
  }

  /** PanicTask.method_20648 (.decomp .../task/PanicTask.java:34-38): every `GOLEM_INTERVAL`
   *  ticks of real (world) time while panicking, `VillagerEntity.summonGolem(world, time,
   *  GOLEM_QUORUM)`. Reuses 07l_spawn.js's own `Village.canSummonGolem`/`nearbyVillagers`/
   *  `findGolemSpawnPos` (the SAME `hasRecentlySlept` + `GOLEM_DETECTED_RECENTLY` gates
   *  `Village.summonGolem` applies for talkWithVillager's quorum 5) rather than
   *  editing 07l_spawn.js for a second, lower-quorum caller — `Village.summonGolem`'s talk quorum
   *  (5) is a different vanilla call site (`talkWithVillager`) and must stay 5 for ITS OWN
   *  trigger, so this is a small, cited near-duplicate of its body, not a shared refactor. */
  function tickGolemSummon(e, now) {
    var Vg = NS.Village;
    if (!Vg || !Vg.canSummonGolem || !Vg.findGolemSpawnPos || !Vg.nearbyVillagers) return;
    if (Math.floor(now) % VBP.GOLEM_INTERVAL !== 0) return;
    if (!Vg.canSummonGolem(e, now)) return;
    var near = Vg.nearbyVillagers(e, 10, 10, 10).filter(function (v) { return Vg.canSummonGolem(v, now); });
    if (near.length < VBP.GOLEM_QUORUM) return;
    if (!NS.EntityList || !NS.EntityList.ready || !NS.EntityList.spawn) return;
    var pos = Vg.findGolemSpawnPos(e, Math.random);
    if (!pos) return;
    var g = NS.EntityList.spawn('iron_golem', pos.x, pos.y, pos.z);
    if (g) for (var i = 0; i < near.length; i++) near[i].golemDetectedUntil = now + (Vg.GOLEM_DETECTED_TICKS || 600);
  }

  /** One VB.tick's worth of PanicTask + (while active) createPanicTasks' own list, folded into
   *  one call — `07zv_villagerbrain.js`'s own hook passes `now` (Sky.dayTime, the world clock
   *  PanicTask's own 100-tick golem gate reads) and `tnow` (`e.vbAge`, the per-villager clock
   *  everything else in this file already uses for HURT_BY's own decay). Returns true iff
   *  Activity.PANIC is the one active this tick — the hook uses that to both label
   *  `e.vbActivity` and skip the rest/meet/work/idle dispatch below it (`doExclusively`'s own
   *  effect: no OTHER schedule activity ticks while panic pre-empts it). */
  VBP.tick = function (e, now, tnow) {
    if (!e || e.type !== 'villager' || e.dead || e.removed) return false;
    var hurt = wasHurt(e, tnow);
    var hostile = hostileSenseTick(e);
    var wasPanic = e.vbActivity === 'panic';
    // PanicTask.method_20646/47 (start/keep running): wasHurt || isHostileNearby.
    // StopPanickingTask.method_20645 (stop): NOT(wasHurt || isHostileNearby ||
    // wasHurtByNearbyEntity) — the third clause ONLY ever matters while already panicking, so
    // entering and staying panicked use different (jar-accurate) conditions.
    var keepGoing = wasPanic ? (hurt || !!hostile || wasHurtByNearbyEntity(e)) : (hurt || !!hostile);
    if (!keepGoing) {
      if (wasPanic) {
        // StopPanickingTask's own forget (.decomp StopPanickingTask.java:17-19).
        e.vbHurtTick = undefined;
        e.lastHurtByEntity = null;
      }
      return false;
    }
    if (!wasPanic) {
      // PanicTask.run's own forget-on-fresh-entry (.decomp PanicTask.java:21-27): PATH/
      // WALK_TARGET/LOOK_TARGET collapse to this engine's one `e.vbWalkTarget`; BREED_TARGET/
      // INTERACTION_TARGET have no field anywhere in this engine (07m_breed.js/07k_goals.js do
      // not model either memory) so there is nothing further to clear for them.
      e.vbWalkTarget = null;
    }
    // createPanicTasks' own priority order (VillagerTaskListProvider.java:201-208): flee the
    // hostile first, then (only if that failed to place a target) flee the attacker, then (only
    // if BOTH failed) FindWalkTargetTask's own small-radius wander — each of the first two ALSO
    // gated on `fleeShouldRun` (see that function's own header for why this collapses to a
    // plain 6-block range test, not a present/far split).
    if (!e.vbWalkTarget && hostile && fleeShouldRun(e, hostile)) {
      var p1 = fleeAwayFrom(e, hostile);
      if (p1) e.vbWalkTarget = { x: p1.x, y: p1.y, z: p1.z, range: VBP.FLEE_RANGE, speedMul: VBP.PANIC_SPEED_MUL };
    }
    if (!e.vbWalkTarget && e.lastHurtByEntity && !e.lastHurtByEntity.dead && !e.lastHurtByEntity.removed
        && fleeShouldRun(e, e.lastHurtByEntity)) {
      var p2 = fleeAwayFrom(e, e.lastHurtByEntity);
      if (p2) e.vbWalkTarget = { x: p2.x, y: p2.y, z: p2.z, range: VBP.FLEE_RANGE, speedMul: VBP.PANIC_SPEED_MUL };
    }
    if (!e.vbWalkTarget && NS.VB && NS.VB.fuzzyFind) {
      var w = NS.VB.fuzzyFind(e, VBP.FIND_WALK_H, VBP.FIND_WALK_V, null);
      if (w) e.vbWalkTarget = { x: w.x, y: w.y, z: w.z, range: 0, speedMul: VBP.PANIC_SPEED_MUL };
    }
    tickBusyFollow(e);
    tickGolemSummon(e, now);
    return true;
  };

  VBP.canSee = canSeeEntity;
  VBP.ready = true;

  VBP.OWED = [];

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
