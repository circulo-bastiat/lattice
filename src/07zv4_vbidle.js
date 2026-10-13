// 07zv4_vbidle.js — loop/vbidle: the createIdleTasks priority-2 RandomTask's own five
// remaining entries (.decomp VillagerTaskListProvider.java:141-172, all read in full this
// session, plus FindEntityTask.java, GoTowardsLookTarget.java, JumpInBedTask.java, WaitTask.java,
// VillagerBreedTask.java, NearestBedSensor.java, VillagerEntity.java:98-108/667-706). Strikes
// 07zv_villagerbrain.js's own `VB.OWED[0]`'s clause: "createIdleTasks' own breed-interest/
// trader-interest/GoTowardsLookTarget/JumpInBedTask/WaitTask entries are not ported
// (idleFallbackTick only covers villagerInterest + findWalkTarget)". NEW file (not folded into
// 07zv_villagerbrain.js), the SAME split 07zv2_vbplay.js/07zv3_vbpanic.js already use for their
// own units — reuses the shared `NS.VB` namespace directly (07zv2_vbplay.js's own pattern, not
// 07zv3_vbpanic.js's separate `NS.VBPanic`), because every function here plugs straight into
// `VB.IDLE_FALLBACK`'s existing weighted-pick machinery and needs `VB.rand`/`VB.fuzzyFind`/
// `VB.occupiedSectionDistance`/`VB.IDLE_INTEREST_RANGE` unchanged. No `.init` is exposed (same
// as 07zv3_vbpanic.js's own `VBP.ready = true` at load, not a lazy `.init`), so tickcheck's own
// "every module's init is called or named" scan (only modules that DEFINE `.init`) never sees
// this file at all — it has none to miss.
//
// THE REAL SEVEN, one more time (VillagerTaskListProvider.java:152-172, all `Pair.of(weight,
// task)` inside ONE priority-2 `RandomTask`): FindEntityTask(VILLAGER,8,INTERACTION_TARGET,2)
// weight 2 (villager-interest, ALREADY ported, `villagerInterestStart`,
// 07zv_villagerbrain.js:1237); FindEntityTask(VILLAGER,8,isReadyToBreed,isReadyToBreed,
// BREED_TARGET,2) weight 1 (breed-interest, THIS file's `breedInterestStart`); FindEntityTask
// (CAT,8,INTERACTION_TARGET,2) weight 1 (cat-interest, THIS file's `catInterestStart` --
// ⚠⚠ loop/vbbreed, this session's own fix: `EntityType.field_16281` is CAT (`EntityType.java:
// 185`, "cat", CatEntity), NOT `WANDERING_TRADER` (`field_17713`, EntityType.java:583) -- this
// file used to scan for `type === 'wandering_trader'` under the name `traderInterestStart`,
// a guess made before `VillagerTaskListProvider.createPlayTasks` (.decomp) was read in full
// this session and turned out to share this EXACT SAME sixth entry, at which point the actual
// `EntityType` constant got checked rather than re-guessed); FindWalkTargetTask weight 1
// (ALREADY ported, `findWalkTargetStart`, 07zv_villagerbrain.js:1252); GoTowardsLookTarget
// (speed,2) weight 1 (THIS file's `goTowardsLookStart`); JumpInBedTask(speed) weight 1 (THIS
// file's `jumpInBedStart`); WaitTask(30,60) weight 1 (THIS file's `waitStart`). All seven are
// now wired into `VB.IDLE_FALLBACK` below with their REAL relative weight (2:1:1:1:1:1:1,
// matching the jar exactly — the former 2:1 narrowing this file's header used to note is gone).
//
// loop/vbbreed (this session) -- `catInterestStart`/`goTowardsLookStart`/`jumpInBedStart`/
// `waitStart` are now ALSO reused verbatim by `src/07zv2_vbplay.js`'s own createPlayTasks
// priority-5 RandomTask (its sixth entry is the SAME CAT FindEntityTask, at a different
// weight -- that file's own header has the citation), through the shared `VB.IDLE_START`
// registry below. `breedInterestStart`'s own BREED_TARGET pick now feeds a REAL consumer --
// `src/07zv5_vbbreed.js`'s own `NS.VBBreed.tick` (VillagerBreedTask itself, createIdleTasks'
// priority-3 CompositeTask) -- so `readyToBreed`, below, now also enforces the post-breed
// cooldown that VBBreed's own `Br.setAge(e, Br.C.breedCooldownAge)` sets.
//
// SUBSTRATES THIS ENGINE ALREADY HAS, reused rather than re-invented:
//   - `e.vbWalkTarget` is the one shared WALK_TARGET stand-in (07zv_villagerbrain.js's own
//     header) -- every entry here that WRITES a walk target guards on it being absent first,
//     the SAME `if (e.vbWalkTarget) return false;` `villagerInterestStart` already uses.
//   - `e.vbLookTarget` already exists (07zv_villagerbrain.js:905, `villagerWorkRun`'s own
//     LOOK_TARGET stand-in, "kept as plain state for a future one" -- THIS is that future one)
//     -- `goTowardsLookStart` is the first thing that ever READS it.
//   - `e.vbHome` is this villager's own claimed HOME poi (a bed's HEAD cell,
//     07zv_villagerbrain.js's own `VB.findPoiTick`, run for EVERY activity including idle,
//     07zv_villagerbrain.js:1334) -- reused below as `jumpInBedStart`'s own NEAREST_BED stand-in
//     (see that function's own header for the narrowing this makes).
//   - `e.jumping = true` is the existing JumpControl.setActive() stand-in `Ph.travelMob`
//     consumes every tick (07k_goals.js:871, 07zd_slime.js:163, 07zh_rabbit.js:141 all already
//     use it the same way) -- `jumpInBedStart`'s own per-tick jump uses the SAME flag.
//   - `e.villagerInventory` (`VB.ensureVillagerInventory`) is the 8-slot substrate
//     `invCount`/`invTakeOne` (07zv_villagerbrain.js, private to that file) already read for
//     farming/bonemeal -- `foodValue`, below, is a second, SEPARATE reader of the exact same
//     array (not exported from that file, so re-implemented here against the same `st.i`/`st.n`
//     slot shape those two functions already establish).
//
(function (NS) {
  'use strict';

  var VB = NS.VB || (NS.VB = { ready: false });

  // ── createIdleTasks' priority-2 RandomTask, REAL weights (.decomp, see file header) ────────
  VB.IDLE_FALLBACK = [
    ['villagerInterest', 2], ['breedInterest', 1], ['catInterest', 1], ['findWalkTarget', 1],
    ['goTowardsLook', 1], ['jumpInBed', 1], ['wait', 1]
  ];

  // `FindEntityTask.create(WANDERING_TRADER, 8, INTERACTION_TARGET, speed, 2)` -- the SAME
  // range/completion `villagerInterestStart` already uses for its own FindEntityTask stand-in
  // (VB.IDLE_INTEREST_RANGE/VB.IDLE_INTEREST_COMPLETION, 07zv_villagerbrain.js:1235-1236);
  // breed-interest and trader-interest are the OTHER two `FindEntityTask.create(...,8,...,2)`
  // calls in the SAME RandomTask (VillagerTaskListProvider.java:158/165), so they reuse those
  // exact two constants rather than re-declaring the same 8/2 pair under a new name.

  // `VillagerEntity.ITEM_FOOD_VALUES` (.decomp VillagerEntity.java:98-100): bread=4,
  // carrot=1, potato=1, beetroot=1 (Items.java:854/1295-1300/1411, cross-checked against
  // 07zv_villagerbrain.js's own header note "nh/ni/nj = wheat_seeds/wheat/bread"). Wheat itself
  // and wheat_seeds are NOT food-value items in this table (only the four names below are).
  VB.BREED_FOOD_VALUES = { bread: 4, carrot: 1, potato: 1, beetroot: 1 };
  // `VillagerEntity.isReadyToBreed`: `foodLevel + getAvailableFood() >= 12`
  // (.decomp VillagerEntity.java:667-669). This engine has no persistent `foodLevel` field (no
  // FarmerVillagerTask-style periodic eat/deplete loop feeds one) and no `eatForBreeding`
  // consumption -- `foodValue` below stands in for the WHOLE `foodLevel + getAvailableFood()`
  // sum as a single live read of current inventory, never depleted (named on `VB.OWED`, below).
  function foodValue(e) {
    var inv = e.villagerInventory, IT = NS.Items, total = 0;
    if (!inv || !IT || !IT.nameOf) return 0;
    for (var i = 0; i < inv.length; i++) {
      var st = inv[i];
      if (!st || !(st.n > 0)) continue;
      var name = IT.nameOf(st.i);
      var v = VB.BREED_FOOD_VALUES[name];
      if (v) total += v * st.n;
    }
    return total;
  }
  VB.villagerFoodValue = foodValue;   // loop/vbbreed -- src/07zv5_vbbreed.js's own
                                       // `eatForBreeding` (VillagerEntity.java:676-692) reads
                                       // the SAME live-inventory sum this file already rolled.
  VB.BREED_FOOD_MIN = 12;   // VillagerEntity.isReadyToBreed's own `>= 12`
  /** `VillagerEntity.isReadyToBreed`: `foodLevel + getAvailableFood() >= 12 &&
   *  getBreedingAge() == 0` (VillagerEntity.java:667-669). `e.vbFoodLevel` (loop/vbbreed) is
   *  this engine's own persistent `foodLevel` stand-in, defaulting to 0 (`|0` on an untouched
   *  villager) exactly like a freshly spawned real one -- `src/07zv5_vbbreed.js`'s own
   *  `eatForBreeding` is the only writer. The `getBreedingAge() == 0` half is `NS.Breed`'s own
   *  `growAge` (07m_breed.js): a villager that has never bred has `growAge === undefined`,
   *  read as `0` the same way `Breed.getAge` already does, and `VillagerBreedTask`'s own
   *  successful `createChild` sets it to `Breed.C.breedCooldownAge` (6000) on both parents
   *  (src/07zv5_vbbreed.js) -- this closes the narrowing this comment used to note ("no
   *  post-breed cooldown -- nothing ever depletes it"). `!e.isBaby` (`Br`'s own flag, single
   *  source of truth -- 07m_breed.js's own `Br.setAge` re-syncs it off `growAge` every tick,
   *  loop/vbgather closed the second `.baby` flag this file used to keep separately) still
   *  stands in for the negative-breedingAge half a baby's own `isBaby()` covers (a baby
   *  villager never reaches this check with `growAge >= 0` in the first place once
   *  loop/vbbreed's own child-spawn sets it, so the two conditions do not fight). */
  function notInBreedCooldown(e) {
    var Br = NS.Breed;
    return !(Br && Br.ready && typeof Br.getAge === 'function') || Br.getAge(e) === 0;
  }
  function readyToBreed(e) {
    return !e.isBaby && notInBreedCooldown(e) && ((e.vbFoodLevel | 0) + foodValue(e)) >= VB.BREED_FOOD_MIN;
  }
  VB.villagerReadyToBreed = readyToBreed;   // exposed for the check

  /** `FindEntityTask<VillagerEntity,VillagerEntity>` with `shouldRunPredicate = predicate =
   *  PassiveEntity::isReadyToBreed` (VillagerTaskListProvider.java:159-164) -- BOTH the acting
   *  villager and the candidate must pass `isReadyToBreed`. Same nearest-in-range scan shape as
   *  `villagerInterestStart` (07zv_villagerbrain.js:1237-1250), filtered to ready-to-breed
   *  villagers only, and remembering `e.vbBreedTarget` (this file's own BREED_TARGET stand-in,
   *  now consumed every idle tick by `src/07zv5_vbbreed.js`'s own `NS.VBBreed.tick`, loop/
   *  vbbreed) alongside the shared walk target. */
  function breedInterestStart(e) {
    if (e.vbWalkTarget) return false;
    if (!readyToBreed(e)) return false;
    var list = NS.EntityList && NS.EntityList.list;
    if (!list) return false;
    var maxSq = VB.IDLE_INTEREST_RANGE * VB.IDLE_INTEREST_RANGE, best = null, bestD = maxSq;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o === e || o.type !== 'villager' || o.dead || o.removed) continue;
      if (!readyToBreed(o)) continue;
      var dx = o.x - e.x, dy = o.y - e.y, dz = o.z - e.z, d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) { bestD = d; best = o; }
    }
    if (!best) return false;
    e.vbBreedTarget = best;
    e.vbWalkTarget = { x: Math.floor(best.x), y: Math.floor(best.y), z: Math.floor(best.z), range: VB.IDLE_INTEREST_COMPLETION };
    return true;
  }

  /** `FindEntityTask.create(CAT, 8, INTERACTION_TARGET, speed, 2)` (VillagerTaskListProvider
   *  .java:165 for createIdleTasks; the SAME call, different weight, at .java:90 for
   *  createPlayTasks -- src/07zv2_vbplay.js's own header) -- the SAME nearest-in-range scan
   *  again, this time against `type === 'cat'`, no readiness predicate (FindEntityTask.create's
   *  own always-true shouldRun/predicate overload). ⚠⚠ `EntityType.field_16281` IS CAT
   *  (EntityType.java:185), NOT `WANDERING_TRADER` (`field_17713`, EntityType.java:583) -- see
   *  this file's own header for the correction this session made. */
  function catInterestStart(e) {
    if (e.vbWalkTarget) return false;
    var list = NS.EntityList && NS.EntityList.list;
    if (!list) return false;
    var maxSq = VB.IDLE_INTEREST_RANGE * VB.IDLE_INTEREST_RANGE, best = null, bestD = maxSq;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o === e || o.type !== 'cat' || o.dead || o.removed) continue;
      var dx = o.x - e.x, dy = o.y - e.y, dz = o.z - e.z, d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) { bestD = d; best = o; }
    }
    if (!best) return false;
    e.vbWalkTarget = { x: Math.floor(best.x), y: Math.floor(best.y), z: Math.floor(best.z), range: VB.IDLE_INTEREST_COMPLETION };
    return true;
  }

  /** `GoTowardsLookTarget(speed, 2)` (VillagerTaskListProvider.java:167, GoTowardsLookTarget
   *  .java:18-20/32-38) -- requires WALK_TARGET absent AND LOOK_TARGET present, then just walks
   *  toward whatever the LOOK_TARGET already is, completionRange 2. `e.vbLookTarget` is the
   *  ONLY thing in this engine that ever writes a LOOK_TARGET-shaped value
   *  (07zv_villagerbrain.js's own `villagerWorkRun`, job-site look) -- nothing decays it, so a
   *  villager that worked once keeps a stale look target forever, exactly as vanilla's own
   *  LOOK_TARGET memory would if nothing else ever overwrote it either (no expiry timer exists
   *  for LOOK_TARGET in vanilla's own Brain either -- it is set-and-forget until replaced). */
  function goTowardsLookStart(e) {
    if (e.vbWalkTarget) return false;
    if (!e.vbLookTarget) return false;
    e.vbWalkTarget = { x: e.vbLookTarget.x, y: e.vbLookTarget.y, z: e.vbLookTarget.z, range: 2 };
    return true;
  }

  // `JumpInBedTask` own constants (.decomp JumpInBedTask.java:15-18).
  VB.BEDJUMP_MAX_OUT_OF_BED = 100;
  VB.BEDJUMP_MIN_JUMPS = 3;
  VB.BEDJUMP_JUMP_VARIANCE = 4;   // `3 + random.nextInt(4)` == 3..6
  VB.BEDJUMP_TICKS_BETWEEN = 5;

  function blockNameAt(x, y, z) {
    var W = NS.World, SR = NS.States, R = NS.Reg;
    if (!W || !SR || !R || !R.names) return null;
    var st = W.getBlock(x, y, z);
    if (st === 0) return null;
    return R.names[SR.block[st]] || null;
  }
  /** `BlockTags.BEDS` membership test, read the SAME way `07zr_zvillager.js`'s own private
   *  `isBed` does (that file's own line 193: `name.slice(-3) === 'bed'`) -- every coloured bed's
   *  block name ends in `_bed`. */
  function isBedNameAt(x, y, z) {
    var n = blockNameAt(x, y, z);
    return !!n && n.length >= 3 && n.slice(-3) === 'bed';
  }
  /** `NearestBedSensor` (.decomp, read in full): every 20 ticks a baby scans the POI storage
   *  for HOME (bed) POIs within 48 blocks (`Poi.getInCircle`, HAS_SPACE), keeps the ones that
   *  pass the sensor's own predicate (a position already in `positionToExpiryTime` is skipped,
   *  at most 5 new ones per scan, each backed off 40 ticks), pathfinds to them (`VB.pathToAny`)
   *  and remembers the reached one as NEAREST_BED (`e.vbNearestBed`). Per-villager state, the
   *  Brain's own: `e.vbNBCd` (cadence), `e.vbNBExpiry` (position -> expiry), `e.vbNBTries`.
   *  Clock is the per-villager Task clock `tnow`. Narrowing: the sensor's randomised 0-19 tick
   *  expiry offset is kept, but candidates are taken nearest-first (like `getReachableHome`). */
  function nearestBedSensorTick(e, tnow) {
    if (!e.isBaby) return;
    if ((e.vbNBCd = (e.vbNBCd || 0) - 1) > 0) return;     // Sensor.tick: --timeToTick <= 0
    e.vbNBCd = 20;
    var Poi = NS.Poi;
    if (!Poi || !Poi.ready || !Poi.getInCircle || !VB.pathToAny || !NS.Ai || !NS.Ai.findPath) return;
    var expiry = e.vbNBExpiry || (e.vbNBExpiry = {});
    var tries = 0, expiryTime = tnow + Math.floor(rnd() * 20);
    var bp = blockPosOf2(e);
    var list = Poi.getInCircle(function (t) { return t === Poi.HOME; }, bp, 48, Poi.STATUS.HAS_SPACE);
    function d2(p) { return (p.x - bp.x) * (p.x - bp.x) + (p.y - bp.y) * (p.y - bp.y) + (p.z - bp.z) * (p.z - bp.z); }
    list.sort(function (a, b) { return d2(a) - d2(b); });
    var cand = [];
    for (var i = 0; i < list.length; i++) {
      var k = list[i].x + ',' + list[i].y + ',' + list[i].z;
      if (expiry[k] !== undefined) continue;
      if (++tries >= 5) break;
      expiry[k] = expiryTime + 40;
      cand.push(list[i]);
    }
    var hit = cand.length ? VB.pathToAny(e, cand) : null;
    if (hit) e.vbNearestBed = { x: hit.x, y: hit.y, z: hit.z };
    else if (tries < 5) {
      for (var key in expiry) if (expiry[key] < expiryTime) delete expiry[key];
    }
  }
  VB.nearestBedSensorTick = nearestBedSensorTick;
  /** `brain.getOptionalMemory(NEAREST_BED)` -- written by `nearestBedSensorTick`, which
   *  `VB.tick` runs every tick (the sensor gates itself to its 20-tick cadence). */
  function getNearestBed(e) { return e.vbNearestBed || null; }

  /** `JumpInBedTask` (.decomp, read in full) -- baby-only. `shouldStartJumping`: already above a
   *  bed, or a nearest bed exists at all. `run`: snapshot `bedPos`, reset the three counters,
   *  walk to it at completionRange 0 (must reach the exact bed cell, not just nearby).
   *  State lives in `e.vbBedJump` (this file's own bookkeeping object -- not a vanilla field,
   *  the SAME per-villager plain-state pattern `e.vbSleepHomePos` etc. already use elsewhere in
   *  this file family). Ticking itself (the jump-while-on-the-bed loop) is `bedJumpTick`, below,
   *  called from `VB.idleContinue` BEFORE the weighted reroll -- see that function's own header
   *  for why a multi-tick task needs to bypass the reroll entirely once started. */
  function jumpInBedStart(e) {
    if (!e.isBaby) return false;
    if (e.vbBedJump) return false;          // already running -- idleContinue owns it now
    var above = isAboveBed(e);
    var bed = above ? currentBedPos(e) : getNearestBed(e);
    if (!above && !bed) return false;
    if (!bed) return false;
    e.vbBedJump = {
      bedPos: { x: bed.x, y: bed.y, z: bed.z },
      ticksOutOfBed: VB.BEDJUMP_MAX_OUT_OF_BED,
      jumpsRemaining: VB.BEDJUMP_MIN_JUMPS + Math.floor(rnd() * VB.BEDJUMP_JUMP_VARIANCE),
      ticksToNextJump: 0
    };
    e.vbWalkTarget = { x: bed.x, y: bed.y, z: bed.z, range: 0 };
    return true;
  }
  /** `isAboveBed`: the villager's own feet cell, OR the cell directly below it, is a bed. */
  function isAboveBed(e) {
    var bp = blockPosOf2(e);
    return isBedNameAt(bp.x, bp.y, bp.z) || isBedNameAt(bp.x, bp.y - 1, bp.z);
  }
  function currentBedPos(e) {
    var bp = blockPosOf2(e);
    if (isBedNameAt(bp.x, bp.y, bp.z)) return bp;
    if (isBedNameAt(bp.x, bp.y - 1, bp.z)) return { x: bp.x, y: bp.y - 1, z: bp.z };
    return null;
  }
  function blockPosOf2(e) { return { x: Math.floor(e.x), y: Math.floor(e.y), z: Math.floor(e.z) }; }
  function isOnBed(e, pos) {
    var bp = blockPosOf2(e);
    return bp.x === pos.x && bp.y === pos.y && bp.z === pos.z;
  }
  /** `JumpInBedTask.tick`/`shouldKeepRunning` folded into one per-tick step (.decomp
   *  method_19978/method_19980): counts down `ticksOutOfBed` while not above the bed (task ends
   *  once that hits 0 while still off the bed, `isBedGoneTooLong`); once above it, jumps
   *  (`e.jumping = true`, the SAME flag `Ph.travelMob` already consumes) on a 5-tick cadence
   *  until `jumpsRemaining` hits 0 (`isDoneJumping`) or the bed itself is gone
   *  (`isBedAt(bedPos)` fails). Returns false once the task is over (state cleared). */
  function bedJumpTick(e) {
    var bj = e.vbBedJump;
    if (!e.isBaby || !bj || !isBedNameAt(bj.bedPos.x, bj.bedPos.y, bj.bedPos.z)) { e.vbBedJump = null; return false; }
    var above = isAboveBed(e);
    if (!above) {
      bj.ticksOutOfBed--;
      if (bj.ticksOutOfBed <= 0) { e.vbBedJump = null; return false; }
    } else if (bj.ticksToNextJump > 0) {
      bj.ticksToNextJump--;
    } else if (isOnBed(e, bj.bedPos)) {
      e.jumping = true;
      bj.jumpsRemaining--;
      bj.ticksToNextJump = VB.BEDJUMP_TICKS_BETWEEN;
      if (bj.jumpsRemaining <= 0) { e.vbBedJump = null; return false; }
    }
    return true;
  }

  // `WaitTask(30, 60)` (VillagerTaskListProvider.java:169) -- `Task`'s own base-class random
  // duration (.decomp Task.java:39): `minRunTime + random.nextInt(maxRunTime + 1 - minRunTime)`.
  VB.WAIT_MIN_TICKS = 30;
  VB.WAIT_MAX_TICKS = 60;
  /** `WaitTask` has NO memory requirements at all (`ImmutableMap.of()`) so, unlike every other
   *  entry here, it never guards on `e.vbWalkTarget` -- it can be picked (and does nothing but
   *  occupy the RandomTask slot for its own random duration) even while a walk target is
   *  already set from an earlier tick. State lives in `e.vbIdleWait` (this file's own
   *  bookkeeping, ticked by `VB.idleContinue` the same way `bedJumpTick` is). */
  function waitStart(e) {
    if (e.vbIdleWait) return false;
    e.vbIdleWait = { ticksLeft: VB.WAIT_MIN_TICKS + Math.floor(rnd() * (VB.WAIT_MAX_TICKS + 1 - VB.WAIT_MIN_TICKS)) };
    return true;
  }
  function waitTick(e) {
    var w = e.vbIdleWait;
    if (!w) return false;
    w.ticksLeft--;
    if (w.ticksLeft <= 0) { e.vbIdleWait = null; return false; }
    return true;
  }

  function rnd() { return VB.rand(); }

  VB.IDLE_START = {
    breedInterest: breedInterestStart,
    catInterest: catInterestStart,
    goTowardsLook: goTowardsLookStart,
    jumpInBed: jumpInBedStart,
    wait: waitStart
  };

  /** Called from `07zv_villagerbrain.js`'s own `tickIdle`, BEFORE the weighted reroll
   *  (`VB.idleFallbackTick`) -- `JumpInBedTask`/`WaitTask` are real multi-tick `Task`s that, in
   *  vanilla, keep running once `RandomTask` starts them (it does not re-pick every tick); this
   *  engine's own `idleFallbackTick` DOES reroll every idle tick (07zv_villagerbrain.js's own
   *  header), so a task that must OUTLIVE a single tick (unlike `villagerInterestStart`'s
   *  siblings, which finish instantly and rely on `e.vbWalkTarget` merely BLOCKING a re-pick)
   *  has to intercept the tick before the reroll runs at all. Returns true while one of these
   *  two is still in progress (the reroll below is skipped entirely that tick), false once
   *  neither is running (the normal weighted pick proceeds). */
  VB.idleContinue = function (e) {
    if (e.vbBedJump) return bedJumpTick(e);
    if (e.vbIdleWait) return waitTick(e);
    return false;
  };

  VB.OWED = (VB.OWED || []).concat([
    'loop/vbbreed (this session) CLOSED `VillagerBreedTask` itself -- src/07zv5_vbbreed.js\'s '
      + 'own `NS.VBBreed.tick`: `eatForBreeding` (real inventory consumption into a persistent '
      + '`e.vbFoodLevel`, this file\'s own `readyToBreed` above), the courting/approach/angry-'
      + 'heart cadence, `getReachableHome`\'s own 48-block reachable-POI scan (`VB.pathToAny`, '
      + 'the SAME top-5-candidates simplification `VB.findPoiTick` already makes, named on '
      + '07zv_villagerbrain.js\'s own `VB.OWED`), `createChild`, and the child\'s own HOME '
      + 'memory (remembered directly, matching `setChildHome` -- NOT a POI ticket claim, since '
      + 'vanilla\'s own `getReachableHome` never reserves one either). Still not ported: '
      + 'loop/vbgather (this session) CLOSED the `e.baby`/`e.isBaby` two-flag drift this '
      + 'paragraph used to name here -- every `e.baby` read in this file family (this file, '
      + '07zv_villagerbrain.js, 07zv2_vbplay.js) now reads `NS.Breed`\'s own `e.isBaby` '
      + 'directly (ONE source of truth, re-synced off `growAge` every tick by `Breed.tickAge`, '
      + '07m_breed.js), and `07zv5_vbbreed.js`\'s own `createChild` no longer sets a second '
      + '`.baby` flag that could drift from it. loop/vbgather ALSO closed the priority-3 '
      + '`GatherItemsVillagerTask` `CompositeTask` entry itself (VillagerTaskListProvider.java'
      + ':173-183) -- src/07zv6_vbgather.js\'s own `NS.VBGather`: the villager item-pickup half '
      + '(`canGather`/`GATHERABLE_ITEMS`/the per-profession gatherable-items table, VillagerEntity'
      + '.java:802-827, called from `VB.tick` every tick in every activity, matching vanilla\'s '
      + '`MobEntity.tickMovement` dispatcher rather than the Brain schedule), and the task\'s own '
      + 'food-sharing/wheat-surplus/profession-gatherable-items giving logic (`giveHalfOfStack`\'s '
      + 'exact halve-or-24 arithmetic, GatherItemsVillagerTask.java, reusing `VB.villagerFoodValue`'
      + '/`VB.BREED_FOOD_MIN` for the ONE food-value source of truth `readyToBreed` above already '
      + 'established) -- see 07zv6_vbgather.js\'s own header for the ONE simplification this '
      + 'makes (a fresh nearest-villager scan every \'idle\' tick standing in for the real '
      + '`FindInteractionTargetTask`/INTERACTION_TARGET memory acquisition step, which nothing '
      + 'else in this engine reads or sets either). '
      + 'G18f-N2 CLOSED `FindInteractionTargetTask`/`HoldTradeOffersTask` (src/07zv8_vbhold.js, NS.VBHold). '
      + 'loop/gifts '
      + '(this session) CLOSED `GiveGiftsToHeroTask` itself, previously named here as '
      + '\'COULD be ported\' but blocked on a `.decomp` that carried only its NAME MAPPING and '
      + 'an `.mcdata` with none of its 13 gift loot tables -- both are now available (a '
      + 'decompiled `GiveGiftsToHeroTask.java` and the real jar\'s own 13 '
      + '`gameplay/hero_of_the_village/<profession>_gift` tables, packed by `tools/pack-loot.mjs`, '
      + 'D-609-adjacent) -- src/07zv7_vbgifts.js\'s own `NS.VBGifts.tick`, wired into this SAME '
      + 'priority-3 CompositeTask tier as `NS.VBBreed.tick`/`NS.VBGather.tick` just above.'
  ]);

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
