// 07zv_villagerbrain.js — loop/sleep-s104: villager SLEEP + MEETING-POINT behaviour, closing
// Poi.OWED's "HOME/MEETING tickets are never RESERVED" (07zu_poi.js) and Village.OWED's
// hasRecentlySlept gap (07l_spawn.js). Read this session from `.decomp` in full:
//
//   Schedule.java (VILLAGER_DEFAULT) — a villager's activity by time of day is a STEP function,
//   not a smooth ramp: `ScheduleRule.getPriority` walks its sorted (startTime,priority) entries
//   and returns the LAST one whose startTime <= the query time, wrapping to the schedule's own
//   final entry when the query time is before the first (the `$$3 ? ... : ...` branch,
//   ScheduleRule.java). `VILLAGER_DEFAULT` itself (Schedule.java):
//     10 -> idle, 2000 -> work, 9000 -> meet, 11000 -> idle, 12000 -> rest   (Activity.java names
//     each `register(...)` call resolves to: field_18595=idle, field_18596=work,
//     field_18598=meet, field_18597=rest)
//   and `Brain.refreshActivities` (Brain.java:284) feeds it `(int)(timeOfDay % 24000L)` —
//   `ScheduleActivityTask` (a task in EVERY activity's own list, priority 99) is what calls it
//   once a tick, off `ServerWorld.getTimeOfDay()`, itself `+1` every world tick (ServerWorld.java
//   :365) — this engine's own always-increasing `Sky.dayTime` is the same counter.
//
//   VillagerTaskListProvider.createRestTasks/createMeetTasks — the walk-then-act tasks for each
//   activity, all built with the SAME 0.5F speed modifier every activity list is constructed
//   with (`VillagerEntity.java:113`, `field_30603 = 0.5F`):
//     createRestTasks: `FindPointOfInterestTask(HOME, MemoryModuleType.HOME, false,
//       Optional.of((byte)14))` (VillagerTaskListProvider.createCoreTasks, priority 10) claims a
//       ticket on a real HOME POI within `FindPointOfInterestTask.POI_SORTING_RADIUS = 48` blocks
//       (FindPointOfInterestTask.java) once found; `VillagerWalkTowardsTask(HOME, 0.5, 1, 150,
//       1200)` walks toward it (completionRange=1, maxRange=150, maxRunTime=1200); `SleepTask`
//       (below) does the actual sleeping once arrived.
//     createMeetTasks: `FindPointOfInterestTask(MEETING, MemoryModuleType.MEETING_POINT, true,
//       Optional.of((byte)14))`, same 48-block sort radius; `VillagerWalkTowardsTask(
//       MEETING_POINT, 0.5, 6, 100, 200)` (completionRange=6, maxRange=100, maxRunTime=200).
//
//   SleepTask (SleepTask.java) — `shouldRun`: not mounted, same dimension as the HOME memory,
//   at least 100 ticks since this brain's own LAST_WOKEN memory (`$$5 > 0L && $$5 < 100L` ->
//   refuse), the HOME position's block `isIn(#beds)` and NOT already `BedBlock.OCCUPIED`, and
//   `$$3.getPos().isWithinDistance($$1.getPos(), 2.0)`. `run`: calls `LivingEntity.sleep(pos)`
//   once arrived, which (LivingEntity.java:3125-3136) sets the bed's OCCUPIED state true, the
//   SLEEPING pose, and the entity's position to `pos + (0.5, 0.6875, 0.5)`. `finishRunning`:
//   `wakeUp()` if still sleeping (LivingEntity.java:3150 — clears OCCUPIED, restores the
//   STANDING pose). `VillagerEntity.sleep`/`wakeUp` (VillagerEntity.java:983-996) additionally
//   remember `MemoryModuleType.field_19385` (LAST_SLEPT) on sleep and `field_20616` (LAST_WOKEN)
//   on wake — `VillagerEntity.hasRecentlySlept` (VillagerEntity.java:996-999) is
//   `now - LAST_SLEPT < 24000L`, which `canSummonGolem` (VillagerEntity.java:894) gates on
//   (`07l_spawn.js`'s `Village.canSummonGolem` now reads the same flag this file sets,
//   `e.vbLastSlept`, — see that file's own Village section for the wiring).
//
// ── WHAT THIS ENGINE CANNOT DO, EVEN READ CORRECTLY (`VB.OWED`, bottom) ─────────────────────
// This engine's villager has no Brain and no per-activity Task list (`Ai.ROSTER.villager`,
// 07k_goals.js, is a fixed 4-goal GoalSelector — FloatGoal/WaterAvoidingRandomStrollGoal/
// LookAtPlayerGoal/RandomLookAroundGoal, none of them schedule-aware). Rather than add a new
// Goal to that shared roster (07k_goals.js is owned by other workers this pass, and threading a
// schedule through the GoalSelector priority system is a bigger unit than this one), `VB.tick`
// steers the villager DIRECTLY with the same public, goal-agnostic primitives a goal would use
// (`Ai.findPath`/`Ai.stepToward`/`Ai.closeTo`, 07k_goals.js's own MOVE-CONTROL section) — the
// same "outside the goal system, same tick slot as Trade.tick/Village.tick" shape this file's
// own `Village.tick` line already uses for gossip/golem-summon. `VB.OWED` names every place this
// is a simplification of the real Task-list machinery rather than a silent substitution.
(function (NS) {
  'use strict';

  var VB = NS.VB = { ready: false };
  /** Fertilizable crop growth shared by BoneMealTask and the player's bone meal (CropBlock.applyGrowth:
   *  `age + randomInt(2,5)` capped at maxAge; BeetrootsBlock: that / 3). `rnd` is a [0,1) source. */
  NS.Fertilizable = {
    cropGrowAge: function (age, maxAge, rnd) {
      var g = 2 + Math.floor(rnd() * 4);
      if (maxAge === 3) g = Math.floor(g / 3);
      return Math.min(maxAge, age + g);
    }
  };

  // ── Schedule.VILLAGER_DEFAULT (.decomp Schedule.java) — a step function, see header. ───────
  VB.SCHEDULE = [
    [10, 'idle'],
    [2000, 'work'],
    [9000, 'meet'],
    [11000, 'idle'],
    [12000, 'rest']
  ];
  // Schedule.VILLAGER_BABY (.decomp Schedule.java:16-22): idle/PLAY/idle/PLAY/rest -- a baby
  // never reaches 'work' or 'meet' at all (no such row exists). Real vanilla runs `createPlayTasks`
  // during PLAY (chasing other villager babies, JumpInBedTask) -- loop/vbplay (src/07zv2_
  // vbplay.js) ports PlayWithVillagerBabiesTask itself onto a real 'play' activity below;
  // `VB.OWED` (bottom) still names what that unit leaves unported.
  VB.SCHEDULE_BABY = [
    [10, 'idle'],
    [3000, 'play'],
    [6000, 'idle'],
    [10000, 'play'],
    [12000, 'rest']
  ];
  VB.DAY_LENGTH = 24000;   // Sky.TICKS_PER_DAY / Brain.refreshActivities' own `% 24000L`

  /** `Schedule.getActivityForTime`/`ScheduleRule.getPriority` (.decomp): the entry with the
   *  greatest startTime <= `t mod 24000`, wrapping to the SCHEDULE'S OWN LAST entry when `t` is
   *  before the first (ScheduleRule.java's own `$$3` branch — not "idle", the actual last row,
   *  which for VILLAGER_DEFAULT happens to equal `rest` anyway since 12000 > every wrap case
   *  this schedule's own first entry, 10, can produce). */
  VB.activityForTime = function (t, schedule) {
    var day = ((t % VB.DAY_LENGTH) + VB.DAY_LENGTH) % VB.DAY_LENGTH;
    var sched = schedule || VB.SCHEDULE;
    if (day < sched[0][0]) return sched[sched.length - 1][1];
    var act = sched[0][1];
    for (var i = 0; i < sched.length; i++) {
      if (sched[i][0] > day) break;
      act = sched[i][1];
    }
    return act;
  };

  // ── walk-toward-a-POI numbers (VillagerTaskListProvider.java, see header) ──────────────────
  VB.WALK_SPEED = 0.5;              // field_30603 — every activity task list's own speedModifier
  VB.HOME_COMPLETION_RANGE = 1;     // createRestTasks' VillagerWalkTowardsTask(HOME,...) arg 3
  VB.MEETING_COMPLETION_RANGE = 6;  // createMeetTasks' VillagerWalkTowardsTask(MEETING,...) arg3
  // FindPointOfInterestTask.POI_SORTING_RADIUS (.decomp) — both HOME and MEETING claims sort
  // candidates within this many blocks before picking one; `Ai.AttackHomeGoal` (07k_goals.js,
  // loop/raidpoi-s103) already reuses the same 48 for the raider's own HOME search.
  VB.CLAIM_RADIUS = 48;

  // ── sleep numbers (SleepTask.java / LivingEntity.java / VillagerEntity.java, see header) ───
  VB.SLEEP_DISTANCE = 2.0;          // SleepTask.shouldRun: `isWithinDistance($$1.getPos(), 2.0)`
  VB.WAKE_COOLDOWN = 100;           // SleepTask.shouldRun: refuse while `0 < now-LAST_WOKEN < 100`
  VB.BED_OFFSET = { x: 0.5, y: 0.6875, z: 0.5 };   // LivingEntity.setPositionInBed
  VB.RECENTLY_SLEPT_WINDOW = 24000; // VillagerEntity.hasRecentlySlept's own literal

  function poiReady() { return NS.Poi && NS.Poi.ready; }
  function aiReady() { return NS.Ai && NS.Ai.findPath && NS.Ai.stepToward; }

  function sameKey(a, b) { return !!a && !!b && a.x === b.x && a.y === b.y && a.z === b.z; }

  // ════ loop/vbtasks-s106 — the villager's real walk/claim Task machinery (VB.OWED lines 1-3) ════
  // Read from `.decomp` this session, whole files: VillagerWalkTowardsTask.java, WanderAroundTask
  // .java, FindPointOfInterestTask.java (+ its RetryMarker), ForgetCompletedPointOfInterestTask
  // .java, WalkHomeTask.java, WanderIndoorsTask.java, GoToPointOfInterestTask.java, WaitTask.java,
  // RandomTask.java/CompositeTask.java, WeightedList.java, NoPenaltyTargeting.java, FuzzyTargeting
  // .java, FuzzyPositions.java, NavigationConditions.java, PointOfInterestStorage.java (the
  // OccupationStatus enum and its section-distance tracker), PointOfInterestType.java (search
  // distances), VillagerTaskListProvider.createRestTasks/createMeetTasks.
  //
  // THE SHAPE, as vanilla has it: ONE shared WALK_TARGET memory (`e.vbWalkTarget`) and ONE shared
  // CANT_REACH_WALK_TARGET_SINCE memory (`e.vbCantReachSince`, MemoryModuleType.field_19293).
  // Tasks that want the villager somewhere only WRITE a walk target (VillagerWalkTowardsTask,
  // WalkHomeTask, WanderIndoorsTask, GoToPointOfInterestTask); the one CORE task
  // WanderAroundTask (`wanderTick`, below) is what paths and walks to it, and it is also the only
  // writer of CANT_REACH (set the first time a path does not reach, cleared once one does or the
  // target is reached). VillagerWalkTowardsTask reads CANT_REACH back and `giveUp`s — releases
  // the ticket, forgets the POI memory — once it is older than its own maxRunTime.

  // VillagerTaskListProvider: createRestTasks' `VillagerWalkTowardsTask(HOME, speed, 1, 150, 1200)`,
  // createMeetTasks' `VillagerWalkTowardsTask(MEETING_POINT, speed, 6, 100, 200)` — args 4 and 5.
  VB.HOME_MAX_RANGE = 150;
  VB.HOME_MAX_RUN_TIME = 1200;
  VB.MEETING_MAX_RANGE = 100;
  VB.MEETING_MAX_RUN_TIME = 200;
  // createWorkTasks' `VillagerWalkTowardsTask(JOB_SITE, speed, 9, 100, 1200)` (.decomp
  // VillagerTaskListProvider.java:74) -- see `tickWork`, below.
  VB.WORK_COMPLETION_RANGE = 9;
  VB.WORK_MAX_RANGE = 100;
  VB.WORK_MAX_RUN_TIME = 1200;
  // VillagerWalkTowardsTask.run's exceedsMaxRange branch: `$$6 < 1000` tries of
  // `NoPenaltyTargeting.findTo($$1, 15, 7, ofBottomCenter(dest), (float)(Math.PI / 2))`.
  VB.WAYPOINT_TRIES = 1000;
  VB.WAYPOINT_H = 15;
  VB.WAYPOINT_V = 7;
  // WanderAroundTask: `this(150, 250)` run-time window, MAX_UPDATE_COUNTDOWN = 40, and
  // hasFinishedPath's own fallback `NoPenaltyTargeting.findTo(e, 10, 7, target, PI/2)`.
  VB.WANDER_MIN_RUN = 150;
  VB.WANDER_MAX_RUN = 250;
  VB.WANDER_UPDATE_COUNTDOWN = 40;
  VB.WANDER_FALLBACK_H = 10;
  VB.WANDER_FALLBACK_V = 7;
  // FindPointOfInterestTask: MAX_POSITIONS_PER_RUN 5, POSITION_EXPIRE_INTERVAL 20 (+nextInt(20)),
  // the first-run `nextInt(20)` delay; RetryMarker MIN_DELAY 40 (+nextInt(40)), cap 400,
  // ATTEMPT_DURATION 400.
  VB.FIND_MAX_POSITIONS = 5;
  VB.FIND_EXPIRE_INTERVAL = 20;
  VB.RETRY_MIN_DELAY = 40;
  VB.RETRY_MAX_DELAY = 400;
  VB.RETRY_ATTEMPT_DURATION = 400;
  // ForgetCompletedPointOfInterestTask.MAX_RANGE.
  VB.FORGET_RANGE = 16;
  // WalkHomeTask: POI_EXPIRY 40, MAX_TRIES 5, RUN_TIME 20, MAX_DISTANCE 4 (squared, `<= 4.0`).
  VB.WALKHOME_POI_EXPIRY = 40;
  VB.WALKHOME_MAX_TRIES = 5;
  VB.WALKHOME_RUN_TIME = 20;
  VB.WALKHOME_MAX_DISTANCE_SQ = 4;
  // createRestTasks' RandomTask (priority 5, requires HOME ABSENT): WalkHomeTask 1,
  // WanderIndoorsTask 4, GoToPointOfInterestTask(speed, 4) 2, WaitTask(20, 40) 2.
  VB.REST_FALLBACK = [['walkHome', 1], ['wanderIndoors', 4], ['goToPoi', 2], ['wait', 2]];
  VB.GOTO_POI_COMPLETION = 4;
  VB.GOTO_POI_TRIES = 5;
  VB.GOTO_POI_H = 15;
  VB.GOTO_POI_V = 7;
  VB.WAIT_MIN = 20;
  VB.WAIT_MAX = 40;
  // PointOfInterestStorage.PointOfInterestDistanceTracker: `super(7, 16, 256)`, default level 7 —
  // the section distance saturates at 7. ServerWorld.isNearOccupiedPointOfInterest(pos) = `<= 1`.
  VB.SECTION_DIST_MAX = 7;
  // PointOfInterestType: `register("home", BED_STATES, 1, 1)`, `register("meeting", bell, 32, 6)`
  // — the last arg is the searchDistance FindPointOfInterestTask's own path uses.
  VB.POI_SEARCH_DISTANCE = { home: 1, meeting: 6 };

  VB.rand = NS.fbRand;            // overridable by a check for a deterministic roll
  function rnd() { return VB.rand(); }
  function nextInt(n) { return Math.floor(rnd() * n); }

  function blockPosOf(e) { return { x: Math.floor(e.x), y: Math.floor(e.y), z: Math.floor(e.z) }; }
  function manhattan(e, p) {
    return Math.abs(Math.floor(e.x) - p.x) + Math.abs(Math.floor(e.y) - p.y) + Math.abs(Math.floor(e.z) - p.z);
  }
  function posKey(p) { return p.x + ',' + p.y + ',' + p.z; }

  function release(e, posField) {
    if (e[posField] && poiReady()) NS.Poi.releaseTicket(e[posField]);
    e[posField] = null;
  }

  // ── world predicates the targeting helpers need ────────────────────────────────────────────
  function solidAt(x, y, z) { return !!(NS.Physics && NS.Physics.solidAt && NS.Physics.solidAt(x, y, z)); }
  function stateAt(x, y, z) { return NS.Physics && NS.Physics.blockAt ? NS.Physics.blockAt(x, y, z) : 0; }
  /** `EntityNavigation.isValidPosition` (EntityNavigation.java:337-340; MobNavigation does not
   *  override it): the block BELOW is `isOpaqueFullCube`. ⚠ Read through `SR.fullCubeCollision`
   *  (02c_states.js), a full-cube COLLISION shape — `SR.opaque` is a rendering table fast-leaves
   *  writes to (that file's own D-440 warning), so it is not an AI input; opacity is the light
   *  attenuation 15 (as the goat's own isValidPosition reads it), so glass/ice floors are refused. */
  function validFloorUnder(p) {
    var SR = NS.States;
    var st = stateAt(p.x, p.y - 1, p.z);
    return !!(SR && SR.fullCubeCollision && SR.fullCubeCollision(st) && SR.atten[st] >= 15);   // isOpaqueFullCube = full collision AND opaque (glass/ice are not)
  }
  VB.validFloorUnder = function (p) { return validFloorUnder(p); };
  function heightInvalid(p) {
    var C = NS.CFG || { WORLD_MIN_Y: -64, WORLD_MAX_Y: 256 };
    return p.y < C.WORLD_MIN_Y || p.y > C.WORLD_MAX_Y;
  }
  /** `NavigationConditions.hasPathfindingPenalty`: the cell's land node type has a non-zero
   *  penalty for this mob. A villager keeps MobEntity's defaults, under which WALKABLE and OPEN
   *  are the 0.0 rows; every other node type `Ai.pathTypeAt` (07k_goals.js) classifies —
   *  BLOCKED/LAVA (-1), WATER (8), DAMAGE_FIRE/DAMAGE_OTHER — is non-zero. */
  var VILLAGER_MOB = { type: 'villager' };
  function hasPenalty(p) {
    var Ai = NS.Ai;
    if (!Ai || !Ai.pathTypeAt || !Ai.NodeType) return solidAt(p.x, p.y, p.z);
    var t = Ai.pathTypeAt(p.x, p.y, p.z);
    // s117: `mob.getPathfindingPenalty(getLandNodeType(pos)) != 0` read literally, now that the
    // full node-type table exists (07k_goals.js `Ai.pathPenalty`, MerchantEntity's own rows).
    if (Ai.pathPenalty) return Ai.pathPenalty(VILLAGER_MOB, t) !== 0;
    return !(t === Ai.NodeType.WALKABLE || t === Ai.NodeType.OPEN);
  }
  function waterAt(p) {
    var R = NS.Reg, SR = NS.States;
    return !!(R && SR && R.id && SR.block[stateAt(p.x, p.y, p.z)] === R.id.water);
  }

  /** `FuzzyPositions.localFuzz(random, h, v, 0, dx, dz, angle)` — a cone of half-angle `angle`
   *  around the (dx, dz) heading, radius `sqrt(u)*sqrt(2)*h`, refused when either offset leaves
   *  the h-square; y uniform in [-v, v]. `new BlockPos(double...)` floors. */
  VB.localFuzzToward = function (h, v, dx, dz, angle) {
    var yaw = Math.atan2(dz, dx) - Math.PI / 2;
    var a = yaw + (2 * rnd() - 1) * angle;
    var r = Math.sqrt(rnd()) * Math.SQRT2 * h;
    var ox = -r * Math.sin(a), oz = r * Math.cos(a);
    if (Math.abs(ox) > h || Math.abs(oz) > h) return null;
    var oy = nextInt(2 * v + 1) - v;
    return { x: Math.floor(ox), y: oy, z: Math.floor(oz) };
  };
  /** `FuzzyPositions.localFuzz(random, h, v)` — the uniform box. */
  VB.localFuzzBox = function (h, v) {
    var x = nextInt(2 * h + 1) - h, y = nextInt(2 * v + 1) - v, z = nextInt(2 * h + 1) - h;
    return { x: x, y: y, z: z };
  };
  /** `FuzzyPositions.towardTarget` for a mob with NO position target (a villager never gets one:
   *  `hasPositionTarget()` is false, so the home-ward nudge never applies) — the offset added to
   *  the mob's own position, floored. */
  function offsetFrom(e, o) {
    return { x: Math.floor(o.x + e.x), y: Math.floor(o.y + e.y), z: Math.floor(o.z + e.z) };
  }

  /** `NoPenaltyTargeting.findTo(e, h, v, target, angle)`. `guessBestPathTarget` scores each of 10
   *  candidates by `getPathfindingFavor`, which a villager never overrides (PathAwareEntity's own
   *  0.0F — MerchantEntity/PassiveEntity add none) — every candidate ties at 0, so the FIRST
   *  non-null of the 10 wins; stopping there is the same pick. Returns a block position or null. */
  VB.noPenaltyFindTo = function (e, h, v, target, angle) {
    var dx = target.x - e.x, dz = target.z - e.z;
    for (var i = 0; i < 10; i++) {
      var o = VB.localFuzzToward(h, v, dx, dz, angle);
      if (!o) continue;
      var p = offsetFrom(e, o);
      if (heightInvalid(p) || !validFloorUnder(p) || hasPenalty(p)) continue;   // tryMake
      return p;
    }
    return null;
  };

  /** `FuzzyTargeting.find(e, h, v, scorer)` — uniform box, `towardTarget`, then `validate`:
   *  `upWhile(pos, topY, isSolidAt)` climbs out of solid ground, then refuse water or a penalty
   *  cell. `guessBest` keeps the HIGHEST score over 10 tries (strictly greater replaces). */
  VB.fuzzyFind = function (e, h, v, scorer) {
    var C = NS.CFG || { WORLD_MAX_Y: 256 };
    var best = null, bestScore = -Infinity;
    for (var i = 0; i < 10; i++) {
      var p = offsetFrom(e, VB.localFuzzBox(h, v));
      if (heightInvalid(p) || !validFloorUnder(p)) continue;
      while (p.y < C.WORLD_MAX_Y && solidAt(p.x, p.y, p.z)) p = { x: p.x, y: p.y + 1, z: p.z };
      if (waterAt(p) || hasPenalty(p)) continue;
      var s = scorer ? scorer(p) : 0;
      if (s > bestScore) { bestScore = s; best = p; }
    }
    return best;
  };

  /** `PointOfInterestStorage.getDistanceFromNearestOccupied(section)`: the tracker is a hop flood
   *  over 26-connected chunk sections from every section holding an OCCUPIED poi (any type — its
   *  `isOccupied` uses `PointOfInterestType.ALWAYS_TRUE`), saturating at 7; on an unbounded
   *  26-connected grid the hop count IS the Chebyshev distance, so this is exact, not a stand-in.
   *  Occupied = `Poi.occupiedPositions()` (HOME/MEETING tickets) plus claimed workstations
   *  (`Profession.claimed`, 07o_profession.js) — the same union `Rd.isNearOccupiedPOI` reads. */
  VB.occupiedSectionDistance = function (pos) {
    var sx = pos.x >> 4, sy = pos.y >> 4, sz = pos.z >> 4, best = VB.SECTION_DIST_MAX;
    function fold(p) {
      var d = Math.max(Math.abs((p.x >> 4) - sx), Math.abs((p.y >> 4) - sy), Math.abs((p.z >> 4) - sz));
      if (d < best) best = d;
    }
    if (poiReady() && NS.Poi.occupiedPositions) NS.Poi.occupiedPositions().forEach(fold);
    var cl = NS.Profession && NS.Profession.claimed;
    if (cl) for (var k in cl) {
      if (!Object.prototype.hasOwnProperty.call(cl, k)) continue;
      var q = k.split(',');
      fold({ x: +q[0] | 0, y: +q[1] | 0, z: +q[2] | 0 });
    }
    return best;
  };

  /** `EntityNavigation.findPathToAny(targets, searchDistance)` — vanilla runs ONE multi-target A*
   *  that finishes on the cheapest reachable target. `Ai.findPath` (07k_goals.js) is single-target,
   *  so `Ai.findPath` takes `opts.goals` (target set + per-target reach = the POI type's searchDistance). */
  function pathToAny(e, targets) {
    var goals = [];
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i], ty = NS.Poi.getType(t);
      goals.push({ x: t.x, y: t.y, z: t.z, reach: (NS.Poi.SEARCH_DISTANCE && NS.Poi.SEARCH_DISTANCE[ty]) || 1 });
    }
    var p = NS.Ai.findPath(e.x, e.y, e.z, goals[0].x + 0.5, goals[0].y, goals[0].z + 0.5, { mob: e, goals: goals });
    if (!p || !p.length) return null;
    var end = p[p.length - 1], bestT = null, bd = Infinity;
    for (var j = 0; j < goals.length; j++) {
      var g = goals[j], d = Math.abs(end.x - g.x) + Math.abs(end.y - g.y) + Math.abs(end.z - g.z);
      if (d <= g.reach && d < bd) { bd = d; bestT = targets[j]; }
    }
    return bestT;
  }
  VB.pathToAny = pathToAny;   // loop/vbbreed -- VillagerBreedTask.getReachableHome's own
                               // "nearest reachable POI within 48 blocks" search (.decomp
                               // VillagerBreedTask.java:89-97) is the SAME multi-candidate
                               // shape VB.findPoiTick already uses this for, one-off rather
                               // than a per-tick claim.

  // ── FindPointOfInterestTask (HOME: core list, every activity; MEETING: meet list, onlyRunIfChild
  //    — the flag name is vanilla's own inverted spelling: `onlyRunIfChild && isBaby()` REFUSES) ──
  function retryMarker(now) { var m = { prev: 0, next: 0, delay: 0 }; setAttempt(m, now); return m; }
  function setAttempt(m, now) {
    m.prev = now;
    m.delay = Math.min(m.delay + nextInt(VB.RETRY_MIN_DELAY) + VB.RETRY_MIN_DELAY, VB.RETRY_MAX_DELAY);
    m.next = now + m.delay;
  }
  VB.findPoiTick = function (e, type, posField, refuseBaby, now) {
    if (e[posField] || !poiReady() || !aiReady()) return;          // memory must be ABSENT
    if (refuseBaby && e.isBaby) return;
    var all = e.vbFind || (e.vbFind = {});
    var s = all[type] || (all[type] = { expire: 0, markers: {} });
    if (s.expire === 0) { s.expire = now + nextInt(VB.FIND_EXPIRE_INTERVAL); return; }
    if (now < s.expire) return;
    s.expire = now + VB.FIND_EXPIRE_INTERVAL + nextInt(VB.FIND_EXPIRE_INTERVAL);
    for (var k in s.markers) if (!(now - s.markers[k].prev < VB.RETRY_ATTEMPT_DURATION)) delete s.markers[k];
    var bp = blockPosOf(e);
    var list = NS.Poi.getInCircle(function (t) { return t === type; }, bp, VB.CLAIM_RADIUS, NS.Poi.STATUS.HAS_SPACE)
      .filter(function (p) {
        var m = s.markers[posKey(p)];
        if (!m) return true;
        if (now < m.next) return false;
        setAttempt(m, now);
        return true;
      });
    list.sort(function (a, b) {
      var da = (a.x - bp.x) * (a.x - bp.x) + (a.y - bp.y) * (a.y - bp.y) + (a.z - bp.z) * (a.z - bp.z);
      var db = (b.x - bp.x) * (b.x - bp.x) + (b.y - bp.y) * (b.y - bp.y) + (b.z - bp.z) * (b.z - bp.z);
      return da - db;
    });
    list = list.slice(0, VB.FIND_MAX_POSITIONS);
    var hit = list.length ? pathToAny(e, list) : null;
    if (hit) {
      if (NS.Poi.reserveTicket(hit)) {
        e[posField] = { x: hit.x, y: hit.y, z: hit.z };
        s.markers = {};
      }
    } else {
      for (var i = 0; i < list.length; i++) {
        var kk = posKey(list[i]);
        if (!s.markers[kk]) s.markers[kk] = retryMarker(now);
      }
    }
  };

  // ── G18f-J1: job-site acquisition (VillagerTaskListProvider.createCoreTasks:36-45) ──────────
  // FindPointOfInterestTask(workstation, JOB_SITE, POTENTIAL_JOB_SITE, true) at priority 6;
  // WalkTowardJobSiteTask (RUN_TIME 1200; idle/work/meet only; on stop releases the ticket and
  // forgets POTENTIAL_JOB_SITE); GoToWorkTask (within 2.0 of it -> JOB_SITE, profession of the
  // POI's workstation block). A profession-less villager matches every workstation (UNEMPLOYED).
  VB.JOB_WALK_RUN_TIME = 1200;
  VB.JOB_GOTO_DISTANCE = 2.0;
  VB.jobAcquireTick = function (e, activity, now) {
    if (e.isBaby || !poiReady()) return;
    if (e.profession && e.profession !== 'none') return;
    var P = NS.Poi, PF = NS.Profession;
    if (!PF || !PF.ready) return;
    VB.findPoiTick(e, P.JOB_SITE, 'vbPotentialJob', true, now);
    var pj = e.vbPotentialJob;
    if (!pj) return;
    if (P.getType(pj) !== P.JOB_SITE) { e.vbPotentialJob = null; return; }
    var dx = pj.x + 0.5 - e.x, dy = pj.y + 0.5 - e.y, dz = pj.z + 0.5 - e.z;
    if (dx * dx + dy * dy + dz * dz < VB.JOB_GOTO_DISTANCE * VB.JOB_GOTO_DISTANCE) {
      var prof = PF.professionForBlockName(blockNameOf(pj));
      var key = pj.x + ',' + pj.y + ',' + pj.z;
      if (prof && (PF.claimed[key] === undefined || PF.claimed[key] === e.id)) {
        PF.claimed[key] = e.id;
        e.profession = prof;
        e.workstation = { x: pj.x, y: pj.y, z: pj.z };
        e.vbPotentialJob = null;        // the ticket now belongs to JOB_SITE
        e.vbWalkTarget = null;
        return;
      }
      release(e, 'vbPotentialJob');
      return;
    }
    if (activity !== 'idle' && activity !== 'work' && activity !== 'meet') return;
    var before = e.vbPotentialJob;
    VB.walkTowardsTick(e, 'vbPotentialJob', 1, 48, VB.JOB_WALK_RUN_TIME, now);
  };
  function blockNameOf(p) {
    var st = stateAt(p.x, p.y, p.z);
    return NS.States && NS.Reg && NS.Reg.names ? NS.Reg.names[NS.States.block[st]] : null;
  }

  // ── WALK_TARGET + WanderAroundTask (the core walker) ────────────────────────────────────────
  // `t.speedMul` (optional, defaults to 1): a per-walk speed multiplier on top of VB.WALK_SPEED,
  // read by both `NS.Ai.stepToward` call sites below -- loop/vbpanic's own createPanicTasks
  // speed*1.5 boost (src/07zv3_vbpanic.js's own VBP.PANIC_SPEED_MUL) is the one caller today.
  function setWalkTarget(e, p, range) { e.vbWalkTarget = { x: p.x, y: p.y, z: p.z, range: range }; }
  function hasReached(e, t) { return manhattan(e, t) <= t.range; }

  /** `WanderAroundTask.hasFinishedPath` — path to the target; bookkeep CANT_REACH; on no path at
   *  all, one `NoPenaltyTargeting.findTo(e, 10, 7, target)` detour. Returns the path or null. */
  function planPath(e, t, now) {
    var Ai = NS.Ai;
    var path = Ai.findPath(e.x, e.y, e.z, t.x + 0.5, t.y, t.z + 0.5, { mob: e });
    if (hasReached(e, t)) { e.vbCantReachSince = undefined; return null; }
    // `Ai.findPath` only ever returns a COMPLETE path, so "non-null" is `reachesTarget()`.
    if (path) { e.vbCantReachSince = undefined; return path.length > 1 ? path : null; }
    if (e.vbCantReachSince === undefined) e.vbCantReachSince = now;
    var v = VB.noPenaltyFindTo(e, VB.WANDER_FALLBACK_H, VB.WANDER_FALLBACK_V,
      { x: t.x + 0.5, y: t.y, z: t.z + 0.5 }, Math.PI / 2);
    if (!v) return null;
    var p2 = Ai.findPath(e.x, e.y, e.z, v.x + 0.5, v.y, v.z + 0.5, { mob: e });
    return p2 && p2.length > 1 ? p2 : null;
  }

  VB.wanderTick = function (e, now, minRun, maxRun) {
    var w = e.vbWander || (e.vbWander = { countdown: 0, running: false, path: null, idx: 1, until: 0, look: null });
    var t = e.vbWalkTarget;
    if (w.running) {
      // shouldKeepRunning: a path, navigation not idle, the target still there and unreached;
      // plus Task.tick's own run-time limit (150..250 ticks).
      if (!t || hasReached(e, t) || !w.path || w.idx >= w.path.length || now >= w.until) {
        // finishRunning: an unreached target whose walk never left its first node waits
        // nextInt(40) before re-planning (`isNearPathStartPos`, set by checkTimeouts below).
        if (t && !hasReached(e, t) && w.near) w.countdown = nextInt(VB.WANDER_UPDATE_COUNTDOWN);
        e.vbWalkTarget = null;
        w.running = false; w.path = null; w.look = null;
        return;
      }
      // EntityNavigation.checkTimeouts: every 100 ticks of a path, within 1.5 of where the window
      // began = nearPathStartPos (and the navigation stops); the window restarts either way.
      if (now - w.psT > 100) {
        var sx = e.x - w.psPos.x, sy = e.y - w.psPos.y, sz = e.z - w.psPos.z;
        if (sx * sx + sy * sy + sz * sz < 2.25) { w.near = true; w.until = now; } else w.near = false;
        w.psT = now; w.psPos = { x: e.x, y: e.y, z: e.z };
      }
      // keepRunning: the target moved more than 2 blocks (squared > 4) → re-plan.
      var lx = t.x - w.look.x, ly = t.y - w.look.y, lz = t.z - w.look.z;
      if (lx * lx + ly * ly + lz * lz > 4) {
        var np = planPath(e, t, now);
        if (np) { w.path = np; w.idx = 1; w.look = { x: t.x, y: t.y, z: t.z }; w.near = false; w.psT = now; w.psPos = { x: e.x, y: e.y, z: e.z }; }
      }
      NS.Ai.stepToward(e, w.path[w.idx], VB.WALK_SPEED * (t.speedMul || 1));
      if (NS.Ai.closeTo(e, w.path[w.idx])) w.idx++;
      return;
    }
    if (!t) return;
    if (w.countdown > 0) { w.countdown--; return; }
    var reached = hasReached(e, t);
    var path = reached ? null : planPath(e, t, now);
    if (!reached && path) {
      w.running = true; w.near = false; w.psT = now; w.psPos = { x: e.x, y: e.y, z: e.z }; w.path = path; w.idx = 1; w.look = { x: t.x, y: t.y, z: t.z };
      var lo = minRun == null ? VB.WANDER_MIN_RUN : minRun, hi = maxRun == null ? VB.WANDER_MAX_RUN : maxRun;
      w.until = now + lo + nextInt(hi + 1 - lo);
      NS.Ai.stepToward(e, w.path[w.idx], VB.WALK_SPEED * (t.speedMul || 1));
      if (NS.Ai.closeTo(e, w.path[w.idx])) w.idx++;
    } else {
      e.vbWalkTarget = null;
      if (reached) e.vbCantReachSince = undefined;
    }
  };

  // ── VillagerWalkTowardsTask ─────────────────────────────────────────────────────────────────
  function giveUp(e, posField, now) {
    release(e, posField);                 // releaseTicketFor + brain.forget(destination)
    e.vbCantReachSince = now;             // `$$2.remember(CANT_REACH_WALK_TARGET_SINCE, time)`
    VB.gaveUp = (VB.gaveUp || 0) + 1;     // a counter for the check, not a behaviour
  }
  VB.walkTowardsTick = function (e, posField, completionRange, maxRange, maxRunTime, now) {
    var dest = e[posField];
    if (!dest || e.vbWalkTarget) return;  // requires WALK_TARGET ABSENT, destination PRESENT
    if (e.vbCantReachSince !== undefined && now - e.vbCantReachSince > maxRunTime) { giveUp(e, posField, now); return; }
    if (manhattan(e, dest) > maxRange) {
      var v = null, n = 0;
      var aim = { x: dest.x + 0.5, y: dest.y, z: dest.z + 0.5 };
      for (; n < VB.WAYPOINT_TRIES && (v === null || manhattan(e, v) > maxRange); n++) {
        v = VB.noPenaltyFindTo(e, VB.WAYPOINT_H, VB.WAYPOINT_V, aim, Math.PI / 2);
      }
      if (n === VB.WAYPOINT_TRIES) { giveUp(e, posField, now); return; }
      setWalkTarget(e, v, completionRange);
    } else if (manhattan(e, dest) > completionRange) {
      setWalkTarget(e, dest, completionRange);
    }
  };

  // ── ForgetCompletedPointOfInterestTask(HOME) ────────────────────────────────────────────────
  function bedOccupiedAt(p) {
    var W = NS.World, R = NS.Reg, SR = NS.States;
    if (!W || !R || !SR || !R.PROP || R.PROP.occupied === undefined) return false;
    return SR.propValue(W.getBlock(p.x, p.y, p.z), R.PROP.occupied) === R.PVAL['true'];
  }
  VB.forgetCompletedHomeTick = function (e) {
    var h = e.vbHome;
    if (!h) return;
    var dx = h.x + 0.5 - e.x, dy = h.y + 0.5 - e.y, dz = h.z + 0.5 - e.z;   // BlockPos.isWithinDistance
    if (!(dx * dx + dy * dy + dz * dz < VB.FORGET_RANGE * VB.FORGET_RANGE)) return;
    if (!poiReady()) return;
    if (NS.Poi.getType(h) !== NS.Poi.HOME) { e.vbHome = null; return; }       // forget only: the POI is gone
    if (bedOccupiedAt(h) && !e.vbSleeping) release(e, 'vbHome');               // forget + releaseTicket
  };

  // ── createRestTasks' RandomTask — the HOME-absent fallback ──────────────────────────────────
  function walkHomeStart(e, c, now) {
    var wh = c.walkHome;
    if (e.vbWalkTarget || e.vbHome) return false;                          // both ABSENT
    if (now - wh.expiryLimit < VB.WALKHOME_RUN_TIME) return false;
    var bp = blockPosOf(e);
    var any = NS.Poi.getInCircle(function (t) { return t === NS.Poi.HOME; }, bp, VB.CLAIM_RADIUS, NS.Poi.STATUS.ANY);
    if (!any.length) return false;
    var best = Infinity;
    for (var i = 0; i < any.length; i++) {
      var p = any[i], d = (p.x - bp.x) * (p.x - bp.x) + (p.y - bp.y) * (p.y - bp.y) + (p.z - bp.z) * (p.z - bp.z);
      if (d < best) best = d;
    }
    if (best <= VB.WALKHOME_MAX_DISTANCE_SQ) return false;
    // run
    wh.tries = 0;
    wh.expiryLimit = now + nextInt(20);
    var picked = [];
    for (var j = 0; j < any.length; j++) {
      var k = posKey(any[j]);
      if (Object.prototype.hasOwnProperty.call(wh.toExpiry, k)) continue;
      if (++wh.tries >= VB.WALKHOME_MAX_TRIES) continue;
      wh.toExpiry[k] = wh.expiryLimit + VB.WALKHOME_POI_EXPIRY;
      picked.push(any[j]);
    }
    var hit = picked.length ? pathToAny(e, picked) : null;
    if (hit && NS.Poi.getType(hit)) setWalkTarget(e, hit, 1);
    else if (!hit && wh.tries < VB.WALKHOME_MAX_TRIES) {
      for (var kk in wh.toExpiry) if (wh.toExpiry[kk] < wh.expiryLimit) delete wh.toExpiry[kk];
    }
    return true;
  }
  function wanderIndoorsStart(e) {
    var W = NS.World, SR = NS.States;
    if (e.vbWalkTarget || !W || !W.canSeeSky) return false;
    var bp = blockPosOf(e);
    if (W.canSeeSky(bp.x, bp.y, bp.z)) return false;
    var cells = [];
    for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) for (var dz = -1; dz <= 1; dz++) cells.push({ x: bp.x + dx, y: bp.y + dy, z: bp.z + dz });
    for (var i = cells.length - 1; i > 0; i--) { var j = nextInt(i + 1), tmp = cells[i]; cells[i] = cells[j]; cells[j] = tmp; }
    // `isSpaceEmpty($$1)` tests the ENTITY's own box, not the candidate (vanilla's own quirk) —
    // the real box via Spawn.spaceEmptyAt (block collision shapes over the villager's own box).
    var Sp = NS.Spawn;
    var roomy = Sp && Sp.spaceEmptyAt ? Sp.spaceEmptyAt('villager', e.x, e.y, e.z, true) : !solidAt(bp.x, bp.y, bp.z) && !solidAt(bp.x, bp.y + 1, bp.z);
    for (var c = 0; c < cells.length; c++) {
      var p = cells[c];
      if (W.canSeeSky(p.x, p.y, p.z)) continue;
      if (!(SR && SR.faceSturdy && SR.faceSturdy(stateAt(p.x, p.y, p.z), 2, SR.SUPPORT_FULL))) continue;   // isTopSolid
      if (!roomy) continue;
      setWalkTarget(e, p, 0);
      break;
    }
    return true;
  }
  VB.wanderIndoorsStart = function (e) { return wanderIndoorsStart(e); };
  function goToPoiStart(e) {
    if (e.vbWalkTarget) return false;
    var bp = blockPosOf(e);
    var cur = VB.occupiedSectionDistance(bp);
    if (cur <= 1) return false;                         // !isNearOccupiedPointOfInterest(pos) (radius 1)
    var pick = null;
    for (var i = 0; i < VB.GOTO_POI_TRIES; i++) {
      var v = VB.fuzzyFind(e, VB.GOTO_POI_H, VB.GOTO_POI_V, function (p) { return -VB.occupiedSectionDistance(p); });
      if (!v) continue;
      var d = VB.occupiedSectionDistance(v);
      if (d < cur) { pick = v; break; }
      if (d === cur) pick = v;
    }
    if (pick) setWalkTarget(e, pick, VB.GOTO_POI_COMPLETION);
    return true;
  }
  /** `CompositeTask(Order.SHUFFLED, RunMode.RUN_ONE)`: `WeightedList.shuffle` gives each entry
   *  `-pow(nextFloat, 1/weight)` and sorts ascending (heavier entries tend first); the FIRST task
   *  whose `tryStarting` succeeds runs. Only WaitTask keeps running past its first tick (the other
   *  three have Task's default `shouldKeepRunning` = false), so the composite re-rolls every tick
   *  except while a 20..40-tick wait holds it. Returns the name of the task that started. */
  VB.restFallbackTick = function (e, now) {
    if (e.vbHome) return null;                          // RandomTask's own `HOME: VALUE_ABSENT`
    var c = e.vbRestRandom || (e.vbRestRandom = { waitUntil: -1, walkHome: { expiryLimit: 0, tries: 0, toExpiry: {} } });
    if (c.waitUntil > now) return 'wait(running)';
    var order = VB.REST_FALLBACK.map(function (r) { return { name: r[0], key: -Math.pow(rnd(), 1 / r[1]) }; });
    order.sort(function (a, b) { return a.key - b.key; });
    for (var i = 0; i < order.length; i++) {
      var n = order[i].name, started = false;
      if (n === 'walkHome') started = poiReady() && aiReady() && walkHomeStart(e, c, now);
      else if (n === 'wanderIndoors') started = wanderIndoorsStart(e);
      else if (n === 'goToPoi') started = goToPoiStart(e);
      else { started = true; c.waitUntil = now + VB.WAIT_MIN + nextInt(VB.WAIT_MAX + 1 - VB.WAIT_MIN); }
      if (started) return n;
    }
    return null;
  };

  /** `LivingEntity.sleep`'s own `BedBlock.OCCUPIED` write (.decomp/net/minecraft/entity/
   *  LivingEntity.java:3125-3131 sets it true; :3150-3154's `wakeUp` sets it false) — through
   *  this engine's own real block-state primitives (`R.PROP`/`SR.withProp`), the SAME ones
   *  `07zu_poi.js`'s own header already reads real bed states with, not a second ad-hoc bed
   *  model, and through `NS.World.setBlock` -- the world's own normal setter, the one choke
   *  point `07_world.js`'s own header already keeps every other unit's block writes going
   *  through. Silent no-op if the cell is no longer a real bed (broken since claim) or this
   *  engine's registry data is not hot yet -- never a write to a state that turns out not to
   *  have the property this asked for (`SR.withProp` itself already refuses that; this only
   *  adds the "don't even read a null block" guard around it). */
  function setBedOccupied(pos, occupied) {
    var W = NS.World, R = NS.Reg, SR = NS.States;
    if (!pos || !W || !R || !SR || !R.PROP || R.PROP.occupied === undefined || !R.PVAL) return;
    var st = W.getBlock(pos.x, pos.y, pos.z);
    if (!st) return;
    var val = occupied ? R.PVAL['true'] : R.PVAL['false'];
    if (val === undefined) return;
    var next = SR.withProp(st, R.PROP.occupied, val);
    if (next !== st) W.setBlock(pos.x, pos.y, pos.z, next);
  }

  /** `LivingEntity.getSleepingDirection`/`BedBlock.getDirection` (.decomp/net/minecraft/
   *  entity/LivingEntity.java:3173-3176, net/minecraft/block/BedBlock.java:66-69): the HOME
   *  cell's own `facing` property value id, read once here and handed to
   *  `07j_entityrender.js`'s own sleeping pose as `e.vbSleepFacing` -- that file already owns
   *  `R.PVAL`'s north/south/west/east mapping (`ER.sleepDirData`), so this crosses the file
   *  boundary as the raw registry id rather than a second, guessed copy of the same mapping. */
  function bedFacingOf(pos) {
    var W = NS.World, R = NS.Reg, SR = NS.States;
    if (!pos || !W || !R || !SR || !R.PROP || R.PROP.facing === undefined) return undefined;
    var st = W.getBlock(pos.x, pos.y, pos.z);
    var f = SR.propValue(st, R.PROP.facing);
    return f >= 0 ? f : undefined;
  }

  /** `LivingEntity.wakeUp` (.decomp/net/minecraft/entity/LivingEntity.java:3150-3169) —
   *  restores normal standing, remembers LAST_WOKEN, and (loop/vsleep, CLOSING one of
   *  `VB.OWED`'s own former entries) clears the bed's own `BedBlock.OCCUPIED` at the position
   *  sleep began at (`e.vbSleepHomePos`, not the live `e.vbHome` — a villager could in
   *  principle be re-homed while it slept; the bed that was actually toggled on is the one
   *  that must be toggled back off). */
  function wakeUp(e, now) {
    if (!e.vbSleeping) return;
    setBedOccupied(e.vbSleepHomePos, false);
    e.vbSleeping = false;
    e.vbSleepPos = null;
    e.vbSleepHomePos = null;
    e.vbSleepFacing = undefined;
    e.vbLastWoken = now;
  }

  /** `LivingEntity.sleep`/`VillagerEntity.sleep` (.decomp, see header): pose + position onto the
   *  bed's own HEAD cell (`Poi.HOME`'s own header already rules HOME sits at the HEAD, not
   *  guesses it) plus the LAST_SLEPT memory `Village.hasRecentlySlept` (07l_spawn.js) reads.
   *  loop/vsleep — also the bed's own `BedBlock.OCCUPIED` (`setBedOccupied`, above) and the
   *  bed's own `facing` (`bedFacingOf`, above, -> `e.vbSleepFacing`, `07j_entityrender.js`'s
   *  own sleeping pose), CLOSING two of `VB.OWED`'s own former entries. */
  function sleepIn(e, home, now) {
    e.vbSleeping = true;
    e.vbSleepPos = {
      x: home.x + VB.BED_OFFSET.x,
      y: home.y + VB.BED_OFFSET.y,
      z: home.z + VB.BED_OFFSET.z
    };
    e.x = e.vbSleepPos.x; e.y = e.vbSleepPos.y; e.z = e.vbSleepPos.z;
    e.vx = 0; e.vy = 0; e.vz = 0;
    if (NS.Ai && NS.Ai.setMobSpeed) NS.Ai.setMobSpeed(e, 0); else e.zza = 0;
    e.vbLastSlept = now;
    e.vbSleepHomePos = { x: home.x, y: home.y, z: home.z };
    e.vbSleepFacing = bedFacingOf(home);
    setBedOccupied(home, true);
  }

  /** `BedBlock.wakeVillager` (.decomp/net/minecraft/block/BedBlock.java:112-119, loop/beds
   *  s116): the player's own bed-click, right-clicking an OCCUPIED bed -- wakes the villager
   *  actually sleeping in THIS bed's head cell if one is found there (matched on
   *  `e.vbSleepHomePos`, the bed `sleepIn` above actually toggled, not the live `e.vbHome` --
   *  same reasoning as `wakeUp`'s own header, just above), `false` if none was (a stale
   *  OCCUPIED flag). 14l_use.js's own `Sleep.use` (src/14m_sleep.js) is the only caller.
   */
  VB.wakeVillagerAt = function (headPos) {
    var EL = NS.EntityList;
    if (!EL || !EL.list) return false;
    for (var i = 0; i < EL.list.length; i++) {
      var e = EL.list[i];
      if (e.type === 'villager' && e.vbSleeping && e.vbSleepHomePos &&
          e.vbSleepHomePos.x === headPos.x && e.vbSleepHomePos.y === headPos.y &&
          e.vbSleepHomePos.z === headPos.z) {
        wakeUp(e, (NS.Sky && NS.Sky.dayTime) || 0);
        return true;
      }
    }
    return false;
  };

  /** `FoxEntity.tickSleeping`'s own "sleeping freezes input" re-clamp (07zj_fox.js's own
   *  `Fx.tickSleeping`, read as this pass's own precedent for the same shape: a later goal, or
   *  the physics step, can set `e.zza`/`e.jumping` again after sleep begins, so this re-zeroes
   *  them EVERY tick a villager is asleep, not just once at `sleepIn` — the goal selector's own
   *  WaterAvoidingRandomStrollGoal (07k_goals.js's own `villager` roster) is no longer even
   *  ADDED to a villager's own selector once `NS.VB` is present (loop/vb-activity) -- this
   *  cancel stays as a second guard for a build where VB never initialised (that roster falls
   *  back to the old placement-tier stroll goal in that case, `07k_goals.js`'s own comment). */
  function freezeSleeping(e) {
    e.zza = 0;
    e.jumping = false;
    if (NS.Ai && NS.Ai.setMobSpeed) NS.Ai.setMobSpeed(e, 0);
    // vanilla's own LivingEntity.sleep bypasses collision/gravity entirely (a direct
    // setPosition, never touched by Ph.travelMob again until wakeUp) -- this engine's physics
    // step is a SHARED file (14b_physics.js) this unit does not touch, so a sleeping villager
    // is re-pinned to its own sleep position and zero velocity every tick instead, undoing
    // whatever gravity/collision did to it this tick (`VB.OWED` names the simplification: a
    // sleeping villager still runs a full physics step and this just erases the result, rather
    // than skipping the step the way vanilla's own `isSleeping()` early-outs do).
    if (e.vbSleepPos) {
      e.x = e.vbSleepPos.x; e.y = e.vbSleepPos.y; e.z = e.vbSleepPos.z;
      e.vx = 0; e.vy = 0; e.vz = 0;
    }
    // loop/vsleep, CLOSING one of `VB.OWED`'s own former entries — the SAME re-clamp-every-
    // tick shape as the movement/position freeze just above, aimed at the goal selector's own
    // HEAD output instead: `07i_entitylist.js`'s own `EL.tickMob` runs `e.ai.tick()` (the
    // GoalSelector, LookAtPlayerGoal/RandomLookAroundGoal included, 07k_goals.js's own
    // `villager` roster) BEFORE `NS.VB.tick` -- so whatever `e.yHeadRot`/`e.xHeadRot` a look
    // goal wrote THIS tick is still sitting there right now, and resetting it here undoes it
    // before `ER.animOf` (07j_entityrender.js) ever reads it, the same "never stop the
    // selector, cancel its OUTPUT" contract this function already keeps for movement.
    // Real vanilla has no separate "stop it" step to reproduce: `VillagerTaskListProvider.
    // createRestTasks` (.decomp/net/minecraft/entity/ai/brain/task/
    // VillagerTaskListProvider.java:104-122, read in full) sets no LOOK_TARGET memory at all
    // during REST (only `createIdleTasks`/`createWorkTasks`/`createMeetTasks` do), so the
    // Brain's own always-on `LookAroundTask` (a CORE task, same file :21-45) has nothing to
    // turn toward and the head simply stays put -- zeroing the offset here is that same
    // "no look target this activity" fact, reproduced through this engine's own Goal-based
    // stand-in rather than its Brain/Activity one.
    e.yHeadRot = e.yaw || 0;
    e.xHeadRot = 0;
  }

  /** `SleepTask.shouldRun` (see header) — a claimed HOME, the 100-tick post-wake cooldown, the
   *  bed not already `OCCUPIED`, within 2.0 of it. Its own Task, not gated on the walk having
   *  "arrived" (loop/vbtasks-s106: the walk is WanderAroundTask's business now). */
  function trySleep(e, now) {
    if (!e.vbHome) return;
    if (e.vbLastWoken !== undefined && now - e.vbLastWoken >= 0 && now - e.vbLastWoken < VB.WAKE_COOLDOWN) return;
    if (bedOccupiedAt(e.vbHome)) return;
    var cx = home_center(e.vbHome);
    var dist = Math.sqrt((e.x - cx.x) * (e.x - cx.x) + (e.y - cx.y) * (e.y - cx.y) + (e.z - cx.z) * (e.z - cx.z));
    if (dist > VB.SLEEP_DISTANCE) return;
    sleepIn(e, e.vbHome, now);
    e.vbWalkTarget = null;
    if (e.vbWander) { e.vbWander.running = false; e.vbWander.path = null; }
  }

  /** createRestTasks, in its own priority order: VillagerWalkTowardsTask(HOME) 2,
   *  ForgetCompletedPointOfInterestTask(HOME) 3, SleepTask 3, the HOME-absent RandomTask 5. */
  function tickRest(e, now, tnow) {
    if (e.vbSleeping) { freezeSleeping(e); return; }
    VB.walkTowardsTick(e, 'vbHome', VB.HOME_COMPLETION_RANGE, VB.HOME_MAX_RANGE, VB.HOME_MAX_RUN_TIME, tnow);
    VB.forgetCompletedHomeTick(e);
    trySleep(e, now);
    if (!e.vbSleeping) e.vbRestPick = VB.restFallbackTick(e, tnow);
  }

  function home_center(home) {
    return { x: home.x + 0.5, y: home.y + VB.BED_OFFSET.y, z: home.z + 0.5 };
  }

  /** createMeetTasks: FindPointOfInterestTask(MEETING, …, onlyRunIfChild=true) — babies refuse —
   *  then VillagerWalkTowardsTask(MEETING_POINT, speed, 6, 100, 200). */
  function tickMeet(e, tnow) {
    if (!poiReady()) return;
    VB.findPoiTick(e, NS.Poi.MEETING, 'vbMeeting', true, tnow);
    VB.walkTowardsTick(e, 'vbMeeting', VB.MEETING_COMPLETION_RANGE, VB.MEETING_MAX_RANGE, VB.MEETING_MAX_RUN_TIME, tnow);
    VB.meetRandomTick(e, tnow);
  }

  // createMeetTasks priority 2: RandomTask[GoToIfNearbyTask(MEETING_POINT, 0.4F, 40) w2, MeetVillagerTask w2]
  // (VillagerTaskListProvider.java:126-132); the first of the weighted order whose shouldRun passes runs.
  VB.MEET_BELL_DISTANCE = 4.0;       // MeetVillagerTask.shouldRun: MEETING_POINT.isWithinDistance(pos, 4.0)
  VB.MEET_TARGET_SQ = 32;            // run: first visible villager with squaredDistance <= 32
  VB.MEET_GO_IF_NEARBY = 40;         // GoToIfNearbyTask(MEETING_POINT, 0.4F, 40)
  function meetPoint(e) { var m = e.vbMeeting; return m ? { x: m.x + 0.5, y: m.y + 0.5, z: m.z + 0.5 } : null; }
  function meetVillagerTarget(e) {
    var EL = NS.EntityList;
    if (!EL || !EL.list) return null;
    for (var i = 0; i < EL.list.length; i++) {
      var o = EL.list[i];
      if (o === e || o.type !== 'villager' || o.dead) continue;
      var dx = o.x - e.x, dy = o.y - e.y, dz = o.z - e.z;
      if (dx * dx + dy * dy + dz * dz <= VB.MEET_TARGET_SQ) return o;
    }
    return null;
  }
  function meetVillagerShouldRun(e) {
    if (nextInt(100) !== 0) return false;
    var p = meetPoint(e);
    if (!p || dist3(e, p) > VB.MEET_BELL_DISTANCE) return false;
    return !!meetVillagerTarget(e);
  }
  function meetVillagerRun(e) {
    var o = meetVillagerTarget(e);
    if (!o) return;
    e.vbInteractionTarget = o;
    e.vbLookTarget = { x: o.x, y: o.y + (o.eyeHeight || 1.62), z: o.z, entity: o };
    setWalkTarget(e, o, 1);
    e.vbWalkTarget.speed = 0.3;
  }
  VB.meetRandomTick = function (e, tnow) {
    var order = [['goToIfNearby', 2], ['meetVillager', 2]].map(function (r) { return { name: r[0], key: -Math.pow(rnd(), 1 / r[1]) }; })
      .sort(function (a, b) { return a.key - b.key; });
    var p = meetPoint(e);
    for (var i = 0; i < order.length; i++) {
      if (order[i].name === 'goToIfNearby') {
        if (p && dist3(e, p) <= VB.MEET_GO_IF_NEARBY) { goToIfNearbyRun(e, tnow); return 'goToIfNearby'; }
      } else if (meetVillagerShouldRun(e)) { meetVillagerRun(e); return 'meetVillager'; }
    }
    return null;
  };

  // ── WorkStationCompetitionTask (core priority 2; .decomp WorkStationCompetitionTask.java) ────
  // `e.workstation` stands in for JOB_SITE. reduce(e, seen villagers with the SAME JOB_SITE and a
  // matching profession): the greater getExperience (`tradeXp`) keeps it, ties keep the SECOND
  // (`>` is strict); the loser forgets JOB_SITE (claim freed only if the loser held it).
  function sameSite(a, b) { return !!a && !!b && a.x === b.x && a.y === b.y && a.z === b.z; }
  function forgetJobSite(v) {
    var w = v.workstation, P = NS.Profession;
    if (w && P && P.claimed) {
      var k = w.x + ',' + w.y + ',' + w.z;
      if (P.claimed[k] === v.id) delete P.claimed[k];
    }
    v.workstation = null;
  }
  VB.keepJobSiteForMoreExperienced = function (a, b) {
    var win, lose;
    if ((a.tradeXp | 0) > (b.tradeXp | 0)) { win = a; lose = b; } else { win = b; lose = a; }
    forgetJobSite(lose);
    return win;
  };
  VB.workStationCompetition = function (e, seen) {
    if (!e.workstation) return;
    if (!seen) {
      seen = [];
      var all = NS.EntityList && NS.EntityList.all ? NS.EntityList.all() : [];
      for (var i = 0; i < all.length; i++) {
        var o = all[i];
        if (o !== e && o.type === 'villager' && !o.dead && dist3(e, o) <= 16) seen.push(o);
      }
    }
    var acc = e;
    for (var j = 0; j < seen.length; j++) {
      var v = seen[j];
      if (v === e || !sameSite(v.workstation, e.workstation) || !v.profession || v.profession === 'none' ||
          v.profession !== e.profession) continue;
      acc = VB.keepJobSiteForMoreExperienced(acc, v);
    }
  };

  // ── createWorkTasks: VillagerWalkTowardsTask(JOB_SITE, speed, 9, 100, 1200) ─────────────────
  // (.decomp VillagerTaskListProvider.java:74). `e.workstation` (07o_profession.js's own
  // `Prof.claimed`) stands in for the JOB_SITE memory ticket -- giving up here calls
  // `NS.Profession.release(e)` (that file's own claim-release, not `Poi.releaseTicket`: a
  // workstation slot is never a `Poi` ticket in this engine). GoToNearbyPositionTask/
  // GoToSecondaryPositionTask/VillagerWorkTask/FarmerVillagerTask/BoneMealTask (the priority-5
  // RandomTask that runs once the walk arrives) and createBusyFollowTask stay `VB.OWED` below --
  // they need job-block-specific behaviour (till/plant/breed/smelt) this file does not model.
  function tickWork(e, tnow) {
    var dest = e.workstation;
    if (!dest || e.vbWalkTarget) return;
    if (e.vbCantReachSince !== undefined && tnow - e.vbCantReachSince > VB.WORK_MAX_RUN_TIME) {
      if (NS.Profession && NS.Profession.release) NS.Profession.release(e);
      e.vbCantReachSince = tnow;
      VB.gaveUp = (VB.gaveUp || 0) + 1;
      return;
    }
    if (manhattan(e, dest) > VB.WORK_MAX_RANGE) {
      var v = null, n = 0;
      var aim = { x: dest.x + 0.5, y: dest.y, z: dest.z + 0.5 };
      for (; n < VB.WAYPOINT_TRIES && (v === null || manhattan(e, v) > VB.WORK_MAX_RANGE); n++) {
        v = VB.noPenaltyFindTo(e, VB.WAYPOINT_H, VB.WAYPOINT_V, aim, Math.PI / 2);
      }
      if (n === VB.WAYPOINT_TRIES) {
        if (NS.Profession && NS.Profession.release) NS.Profession.release(e);
        e.vbCantReachSince = tnow;
        VB.gaveUp = (VB.gaveUp || 0) + 1;
        return;
      }
      setWalkTarget(e, v, VB.WORK_COMPLETION_RANGE);
    } else if (manhattan(e, dest) > VB.WORK_COMPLETION_RANGE) {
      setWalkTarget(e, dest, VB.WORK_COMPLETION_RANGE);
    }
  }


  // ════ loop/vbwork — createWorkTasks' priority-5 RandomTask (VB.OWED line 1, first clause) ════
  // .decomp/net/minecraft/entity/ai/brain/task/{VillagerWorkTask,FarmerWorkTask,
  // FarmerVillagerTask,BoneMealTask,GoToNearbyPositionTask,GoToIfNearbyTask}.java, read whole
  // this session. `VillagerTaskListProvider.createWorkTasks` (.decomp:52-79) wires ONE
  // `RandomTask` at priority 5, six weighted candidates (`Pair.of(task, weight)`):
  //   VillagerWorkTask/FarmerWorkTask 7, GoToIfNearbyTask(JOB_SITE,0.4,4) 2,
  //   GoToNearbyPositionTask(JOB_SITE,0.4,1,10) 5, GoToSecondaryPositionTask(...) 5,
  //   FarmerVillagerTask (farmer 2 / else 5), BoneMealTask (farmer 4 / else 7).
  // `GoToSecondaryPositionTask` reads `MemoryModuleType.SECONDARY_JOB_SITE` (field_18873, a
  // List<GlobalPos> only `SecondaryPointsOfInterestSensor` ever populates -- composters spotted
  // near a farmer) -- that sensor is its own POI-scan substrate this pass does not build, so the
  // weighted pick below has FIVE candidates, not six (`VB.OWED`, bottom, names it precisely
  // rather than faking an always-empty sixth). `FarmerWorkTask.performAdditionalWork` (composting
  // seeds into a composter + baking/dropping bread) is ALSO not ported -- composters have no
  // LEVEL-manipulation API anywhere in this engine yet (grepped, none) -- so a farmer here gets
  // the SAME base `VillagerWorkTask` behaviour every other profession does (`VB.OWED`, bottom).
  //
  // Vanilla runs the RandomTask's chosen Task until ITS OWN `shouldKeepRunning` (or run-time cap)
  // ends it, i.e. one candidate holds this priority tier at a time; this engine mirrors that only
  // for the two candidates that are themselves multi-tick (`farmerVillagerTask`/`boneMeal`,
  // tracked in `e.vbFarmerTask`/`e.vbBoneMeal`) -- the other three fire-and-forget on the tick
  // they win (a walk-target write or a memory stamp), which is observably the same outcome since
  // nothing else in this engine's own priority-5 slot competes for the ticks in between.

  VB.WORK_TASK_INTERVAL = 300;        // VillagerWorkTask: `getTime()-lastCheckedTime < 300`
  VB.WORK_TASK_MAX_DISTANCE = 1.73;   // VillagerWorkTask.MAX_DISTANCE
  VB.GO_IF_NEARBY_MAX_DISTANCE = 4;   // createWorkTasks' `GoToIfNearbyTask(JOB_SITE, 0.4F, 4)`
  VB.GO_IF_NEARBY_INTERVAL = 180;     // GoToIfNearbyTask.UPDATE_INTERVAL
  VB.GO_IF_NEARBY_H = 8;              // GoToIfNearbyTask.run: `FuzzyTargeting.find(e, 8, 6)`
  VB.GO_IF_NEARBY_V = 6;
  VB.GO_NEARBY_MAX_DISTANCE = 10;     // createWorkTasks' `GoToNearbyPositionTask(JOB_SITE,0.4F,1,10)`
  VB.GO_NEARBY_INTERVAL = 80;         // GoToNearbyPositionTask's own `nextRunTime = now + 80`
  VB.FARMER_TASK_MAX_RUN = 200;       // FarmerVillagerTask.MAX_RUN_TIME (its own `ticksRan < 200`)
  VB.BONEMEAL_MAX_DURATION = 80;      // BoneMealTask.MAX_DURATION
  VB.BONEMEAL_REARM = 160;            // BoneMealTask: `lastEndEntityAge + 160 <= age`
  VB.BONEMEAL_RETRY_DELAY = 40;       // BoneMealTask.run: `startTime = now + 40` after each use

  VB.INV_SIZE = 8;   // `MerchantEntity.inventory = new SimpleInventory(8)` -- the SAME 8-slot
                      // array `Zv.rehomeEquipment` (07zr_zvillager.js) already writes into as
                      // `e.villagerInventory`; this is that same substrate, now also read/
                      // written by a LIVE villager's own farming/bonemeal behaviour.
  function ensureInv(e) {
    if (!e.villagerInventory) {
      e.villagerInventory = [];
      for (var i = 0; i < VB.INV_SIZE; i++) e.villagerInventory.push(null);
    }
    return e.villagerInventory;
  }
  function invNameAt(inv, i) {
    var st = inv[i], IT = NS.Items;
    return (st && st.n > 0 && IT && IT.nameOf) ? IT.nameOf(st.i) : null;
  }
  /** `VillagerEntity.method_18011().count(item)` -- total across the whole 8-slot inventory. */
  function invCount(e, name) {
    var inv = e.villagerInventory, IT = NS.Items;
    if (!inv || !IT) return 0;
    var idx = IT.of(name), n = 0;
    if (idx < 0) return 0;
    for (var i = 0; i < inv.length; i++) { var st = inv[i]; if (st && st.i === idx) n += st.n || 0; }
    return n;
  }
  /** Decrement ONE of `name` out of the first slot that holds it; clears an emptied slot. */
  function invTakeOne(e, name) {
    var inv = e.villagerInventory, IT = NS.Items;
    if (!inv || !IT) return false;
    var idx = IT.of(name);
    if (idx < 0) return false;
    for (var i = 0; i < inv.length; i++) {
      var st = inv[i];
      if (st && st.i === idx && st.n > 0) {
        st.n--;
        if (st.n <= 0) inv[i] = null;
        return true;
      }
    }
    return false;
  }

  // `FarmerVillagerTask`/`BoneMealTask` both key off `instanceof CropBlock` (.decomp) --
  // WheatBlock/CarrotsBlock/PotatoesBlock/BeetrootsBlock, its four subclasses.
  VB.CROP_BLOCKS = ['wheat', 'carrots', 'potatoes', 'beetroots'];
  // `FarmerVillagerTask.method_19565`'s own per-slot item->crop table (.decomp, transcribed in
  // ITS OWN iteration order: wheat_seeds, potato, carrot, beetroot_seeds).
  VB.SEED_TO_CROP = { wheat_seeds: 'wheat', potato: 'potatoes', carrot: 'carrots', beetroot_seeds: 'beetroots' };

  function cropBlockAt(x, y, z) {
    var W = NS.World, R = NS.Reg, SR = NS.States;
    if (!W || !R || !SR) return null;
    var st = W.getBlock(x, y, z);
    if (st === 0) return { st: 0, block: -1, name: null };
    var block = SR.block[st];
    for (var i = 0; i < VB.CROP_BLOCKS.length; i++) {
      if (R.id[VB.CROP_BLOCKS[i]] === block) return { st: st, block: block, name: VB.CROP_BLOCKS[i] };
    }
    return { st: st, block: block, name: null };
  }
  function ageOf(st) {
    var R = NS.Reg, SR = NS.States;
    if (!R || !R.PROP || R.PROP.age === undefined) return 0;
    var v = SR.propValue(st, R.PROP.age);
    return v < 0 ? 0 : +R.valueNames[v];
  }
  /** `CropBlock.isMature`: `state.get(AGE) == getMaxAge()`. */
  function isMatureCrop(info) {
    var Bh = NS.Behave;
    if (!info || !info.name || !Bh || !Bh.maxAge) return false;
    return ageOf(info.st) >= Bh.maxAge(info.block);
  }
  /** `Block.popResource` for a broken crop -- `Loot.breakDrops` already reads the crop's OWN
   *  `age=<max>` loot table entry (07e_loot.js header: "wheat reads age=7 off the block
   *  state"), the exact table `World.breakBlock(pos, true, entity)` rolls in vanilla. No tool
   *  context (a villager harvests bare-handed; crops have no tool requirement to gate on). */
  function dropCropLoot(x, y, z, st) {
    var L = NS.Loot, EL = NS.EntityList, IT = NS.Items;
    if (!L || !L.ready || !EL || !IT) return;
    var drops = L.breakDrops(st, {});
    for (var i = 0; i < drops.length; i++) {
      var idx = IT.of(drops[i].item);
      if (idx >= 0) EL.popResource(x, y, z, idx, drops[i].count || 1);
    }
  }
  function setBlockRecorded(x, y, z, st) {
    NS.World.setBlock(x, y, z, st);
    if (NS.Save && NS.Save.record) NS.Save.record(x, y, z, st);
  }
  function dist3(e, p) {
    var dx = e.x - p.x, dy = e.y - p.y, dz = e.z - p.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /** `VillagerWorkTask`/`FarmerWorkTask` (.decomp): every profession's generic priority-5
   *  "at the job site" tick -- `method_21641`'s own gate, in this EXACT order: a 300-tick
   *  cooldown; THEN a 50% coin flip (`lastCheckedTime` is stamped only past THIS point, so a
   *  failed flip does not buy another 300-tick wait -- it re-rolls every tick once the window is
   *  open, until one succeeds); THEN the 1.73-block distance test. `run` stamps
   *  LAST_WORKED_AT_POI (`e.vbLastWorkedAt`) and the LOOK_TARGET memory (`e.vbLookTarget`, not
   *  read by any renderer in this engine -- kept as plain state for a future one and for this
   *  unit's own check); `playWorkSound` is VB.playWorkSound; `shouldRestock`+`restock` ARE run here now (s113, Trade.tickRestock). `FarmerWorkTask.performAdditionalWork` (composting/bread)
   *  runs for farmers at a composter job site -- VB.farmerAdditionalWork, below (D-591). */
  function villagerWorkShouldRun(e, tnow, dest) {
    if (!dest) return false;
    if (tnow - (e.vbLastWorkCheck || 0) < VB.WORK_TASK_INTERVAL) return false;
    if (nextInt(2) !== 0) return false;          // `random.nextInt(2) != 0` -> refuse (50%)
    e.vbLastWorkCheck = tnow;                    // ONLY stamped once the coin flip also passes
    return dist3(e, dest) <= VB.WORK_TASK_MAX_DISTANCE;
  }
  /** VillagerEntity.playWorkSound (:560-565): VillagerProfession.getWorkSound() -- every
   *  profession but none/nitwit registers entity.villager.work_<name> (VillagerProfession.java:16-36)
   *  -- at getSoundVolume 1 / getSoundPitch (baby 1.5 + (r-r)*0.2). */
  VB.playWorkSound = function (e) {
    var p = e.profession;
    if (!p || p === 'none' || p === 'nitwit' || !NS.Sound || !NS.Sound.play) return;
    NS.Sound.play('entity.villager.work_' + p, { x: e.x, y: e.y, z: e.z, source: 'neutral', volume: 1,
      pitch: (NS.fbRand() - NS.fbRand()) * 0.2 + (e.isBaby || e.baby ? 1.5 : 1) });
  };
  /** CelebrateRaidWinTask (.decomp CelebrateRaidWinTask.java:26-60), RAID_WIN activity: while the raid at the
   *  villager's block has WON (Raid.hasWon() == VICTORY) and the sky is visible, 1/100 per tick
   *  playCelebrateSound (MerchantEntity.java:156, entity.villager.celebrate) and 1/200 a random-dye firework
   *  rocket (Flight 0-2, one small-ball star). FireworkRocketEntity is live since #5081 (07zzy_firework.js);
   *  the rocket is spawned through EL.spawn and always counted in VB.fireworks. */
  VB.celebrateRaidWin = function (e) {
    var RM = NS.RaidManager, Rd = NS.Raid;
    if (!RM || !RM.world || !Rd || !NS.World || !NS.World.canSeeSky) return false;
    var bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
    var r = RM.getRaidAt(RM.world, { x: bx, y: by, z: bz });
    if (!r || r.status !== Rd.Status.VICTORY || !NS.World.canSeeSky(bx, by, bz)) return false;
    if (Math.floor(VB.rand() * 100) === 0 && NS.Sound && NS.Sound.play)
      NS.Sound.play('entity.villager.celebrate', { x: e.x, y: e.y, z: e.z, source: 'neutral', volume: 1,
        pitch: (VB.rand() - VB.rand()) * 0.2 + (e.isBaby || e.baby ? 1.5 : 1) });
    if (Math.floor(VB.rand() * 200) === 0) {
      var fw = { color: Math.floor(VB.rand() * 16), flight: Math.floor(VB.rand() * 3) };   // DyeColor.values() pick, nextInt(3)
      VB.fireworks = (VB.fireworks || 0) + 1; VB.lastFirework = fw;
      var EL = NS.EntityList;
      if (EL && EL.spawn) EL.spawn('firework_rocket', e.x, e.y + (e.eyeHeight || 1.62), e.z, fw);
    }
    return true;
  };
  /** SeekSkyAfterRaidWinTask / SeekSkyTask / RunAroundAfterRaidTask (.decomp, same-named files) and createRaidTasks'
   *  priority-0 RandomTask (VillagerTaskListProvider.java:229): SHUFFLED weights 5 / 2, first whose shouldRun passes
   *  runs. Both shouldRuns need a raid at the block with hasWon(); seek-sky also needs no sky at the block, then
   *  tries 10 cells (+-10, +-3, +-10) for sky-visible with getTopY <= entity y -> WALK_TARGET (speed 1, range 0);
   *  run-around is FindWalkTargetTask at speed*1.1 (walk target absent). Returns the name started, or null. */
  VB.raidWonAt = function (e) {
    var RM = NS.RaidManager, Rd = NS.Raid;
    if (!RM || !RM.world || !Rd) return false;
    var r = RM.getRaidAt(RM.world, blockPosOf(e));
    return !!r && r.status === Rd.Status.VICTORY;
  };
  VB.seekSkyStart = function (e) {
    var W = NS.World, bp = blockPosOf(e);
    if (!W || !W.canSeeSky || W.canSeeSky(bp.x, bp.y, bp.z)) return false;
    for (var i = 0; i < 10; i++) {
      var p = { x: bp.x + nextInt(20) - 10, y: bp.y + nextInt(6) - 3, z: bp.z + nextInt(20) - 10 };
      var top = W.heightAt ? W.heightAt(p.x, p.z) + 1 : p.y;
      if (W.canSeeSky(p.x, p.y, p.z) && top <= e.y) {
        setWalkTarget(e, { x: p.x + 0.5, y: p.y, z: p.z + 0.5 }, 0);
        e.vbWalkTarget.speedMul = 1;
        return true;
      }
    }
    return true;   // run() executed (shouldRun passed) even when no cell was found
  };
  VB.raidWonRandomTick = function (e) {
    if (!VB.raidWonAt(e)) return null;
    var order = [['seekSky', 5], ['runAround', 2]].map(function (r) { return { name: r[0], key: -Math.pow(rnd(), 1 / r[1]) }; });
    order.sort(function (a, b) { return a.key - b.key; });
    for (var i = 0; i < order.length; i++) {
      if (order[i].name === 'seekSky') { if (VB.seekSkyStart(e)) return 'seekSky'; }
      else if (!e.vbWalkTarget) {
        findWalkTargetStart(e);
        if (e.vbWalkTarget) e.vbWalkTarget.speedMul = 1.1;
        return 'runAround';
      }
    }
    return null;
  };
  /** StartRaidTask (.decomp StartRaidTask.java): shouldRun nextInt(20)==0; run: getRaidAt(blockPos) -> a raid that
   *  hasSpawned (wavesSpawned > 0) and is not isPreRaid (preRaidTicks > 0) sets default+exclusive RAID, else
   *  PRE_RAID. Sticky in e.vbRaidActivity (the default activity); clearing is EndRaidTask's job (VB.endRaidTask). Returns the sticky activity or null. */
  VB.startRaidTask = function (e) {
    var RM = NS.RaidManager;
    if (Math.floor(VB.rand() * 20) === 0 && RM && RM.world) {
      var r = RM.getRaidAt(RM.world, { x: Math.floor(e.x), y: Math.floor(e.y), z: Math.floor(e.z) });
      if (r) e.vbRaidActivity = (r.wavesSpawned > 0 && !(r.preRaidTicks > 0)) ? 'raid' : 'pre_raid';
    }
    return e.vbRaidActivity || null;
  };
  /** EndRaidTask (.decomp EndRaidTask.java, priority 99 of createPreRaidTasks/createRaidTasks): runs only while the
   *  villager is in pre_raid/raid; shouldRun nextInt(20)==0; run: no raid at the block, or it hasStopped / hasLost,
   *  resets the default activity (e.vbRaidActivity -> null, the schedule is back in charge). Returns true if reset. */
  VB.endRaidTask = function (e) {
    if (e.vbRaidActivity !== 'pre_raid' && e.vbRaidActivity !== 'raid') return false;
    if (Math.floor(VB.rand() * 20) !== 0) return false;
    var RM = NS.RaidManager, r = null;
    if (RM && RM.world) r = RM.getRaidAt(RM.world, { x: Math.floor(e.x), y: Math.floor(e.y), z: Math.floor(e.z) });
    var St = NS.Raid && NS.Raid.Status;
    if (!r || (St && (r.status === St.STOPPED || r.status === St.LOSS))) { e.vbRaidActivity = null; return true; }
    return false;
  };
  /** RingBellTask (.decomp RingBellTask.java, createPreRaidTasks priority 0): shouldRun nextFloat() > 0.95F; run:
   *  MEETING_POINT (e.vbMeeting) within 3.0 of the villager's block (Vec3i.isWithinDistance, squared < 9) and that
   *  block a bell -> BellBlock.ring (VBBell.ring notifies villagers). Returns true if it rang.
   *  OWED: the RandomTask walk-to-bell/FindWalkTarget fallback and the busy-follow of the same priority list. */
  VB.RING_BELL_DISTANCE = 3.0;
  VB.ringBellTask = function (e) {
    var m = e.vbMeeting, W = NS.World, R = NS.Reg;
    if (!m || !W || !R || !(VB.rand() > 0.95)) return false;
    var dx = m.x - Math.floor(e.x), dy = m.y - Math.floor(e.y), dz = m.z - Math.floor(e.z);
    if (dx * dx + dy * dy + dz * dz >= VB.RING_BELL_DISTANCE * VB.RING_BELL_DISTANCE) return false;
    var id = R.id['bell'], st = W.getBlock(m.x, m.y, m.z);
    if (id === undefined || st < R.realFirst[id] || st >= R.realFirst[id + 1]) return false;
    VB.bellRings = (VB.bellRings || 0) + 1;
    if (NS.VBBell) NS.VBBell.ring(m.x, m.y, m.z);
    return true;
  };
  function villagerWorkRun(e, tnow, dest) {
    e.vbLastWorkedAt = tnow;
    e.vbLookTarget = { x: dest.x, y: dest.y, z: dest.z };
    VB.workRuns = (VB.workRuns || 0) + 1;        // a counter for the check, not a behaviour
    VB.playWorkSound(e);                         // VillagerWorkTask.java:40 villager.playWorkSound()
    if (e.profession === 'farmer') VB.farmerAdditionalWork(e, dest);   // D-591
    // s113: VillagerWorkTask.java:41-43 -- `if (shouldRestock()) restock();`, AFTER
    // performAdditionalWork. The only restock caller in 1.18.2 (was every mob tick, D-484).
    if (NS.Trade && NS.Trade.tickRestock && e.tradeOffers) NS.Trade.tickRestock(e);
  }

  // ── D-591: FarmerWorkTask.performAdditionalWork (.decomp FarmerWorkTask.java:23-93) ────────
  // Only when the JOB_SITE block really is a composter (`isOf(Blocks.COMPOSTER)`, :28): bake
  // bread first (:77-92), then compost seeds (:35-71). COMPOSTABLES (:20) = Items.field_8317/
  // field_8309 = wheat_seeds/beetroot_seeds (names.tsv buy.nh/buy.so, beside nh/ni/nj =
  // wheat_seeds/wheat/bread in Items' own declaration order).
  VB.FARMER_COMPOSTABLES = ['wheat_seeds', 'beetroot_seeds'];
  VB.FARMER_COMPOST_BUDGET = 20;       // :41 `int $$5 = 20`
  VB.FARMER_SEED_KEEP = 10;            // :55 `$$15 - 10` -- keeps ten of each seed
  VB.FARMER_BREAD_CAP = 36;            // :79 `count(BREAD) <= 36`
  function invAddStack(e, name, count) {
    // SimpleInventory.addStack: top up matching stacks, then the first empty slot; returns the
    // remainder that did not fit.
    var inv = ensureInv(e), IT = NS.Items;
    var idx = IT ? IT.of(name) : -1;
    if (idx < 0) return 0;
    var max = IT.maxStack ? IT.maxStack(idx) : 64;
    for (var i = 0; i < inv.length && count > 0; i++) {
      var st = inv[i];
      if (st && st.i === idx && st.n < max) { var k = Math.min(max - st.n, count); st.n += k; count -= k; }
    }
    for (var j = 0; j < inv.length && count > 0; j++) {
      if (!inv[j]) { var m = Math.min(max, count); inv[j] = { i: idx, n: m }; count -= m; }
    }
    return count;
  }
  // loop/vbgather (src/07zv6_vbgather.js) -- the SAME 8-slot `e.villagerInventory` substrate
  // this file already built for farming/bonemeal (VB.ensureVillagerInventory, above), now also
  // read/written by GatherItemsVillagerTask (item pickup, food/gatherable-item sharing between
  // two nearby villagers). Exposed rather than duplicated, same "one source of truth" the
  // file's own header note above already asks for.
  VB.invCount = invCount;
  VB.invTakeOne = invTakeOne;
  VB.invAddStack = invAddStack;
  VB.farmerAdditionalWork = function (e, dest) {
    var W = NS.World, SR = NS.States, Cm = NS.Composter, IT = NS.Items;
    if (!W || !SR || !Cm || !Cm.ready || !IT || !dest) return false;
    var st = W.getBlock(dest.x, dest.y, dest.z);
    if (!st || SR.name(st) !== 'composter') return false;
    // craftAndDropBread (:77-92)
    if (invCount(e, 'bread') <= VB.FARMER_BREAD_CAP) {
      var loaves = Math.min(3, Math.floor(invCount(e, 'wheat') / 3));
      if (loaves !== 0) {
        for (var w = 0; w < loaves * 3; w++) invTakeOne(e, 'wheat');
        var left = invAddStack(e, 'bread', loaves);
        if (left > 0 && NS.EntityList && NS.EntityList.dropStack) {
          NS.EntityList.dropStack(e.x, e.y + 0.5, e.z, 'bread', left);   // dropStack(stack, 0.5F)
        }
      }
    }
    // compostSeeds (:35-71)
    var x = dest.x, y = dest.y, z = dest.z;
    if (Cm.level(x, y, z) === Cm.LEVEL_MAX) Cm.extract(x, y, z);
    var budget = VB.FARMER_COMPOST_BUDGET, seen = [0, 0];
    var inv = ensureInv(e);
    for (var i = inv.length - 1; i >= 0 && budget > 0; i--) {
      var name = invNameAt(inv, i);
      var ci = name ? VB.FARMER_COMPOSTABLES.indexOf(name) : -1;
      if (ci < 0) continue;
      var stack = inv[i], have = stack.n;
      seen[ci] += have;
      var n = Math.min(Math.min(seen[ci] - VB.FARMER_SEED_KEEP, budget), have);
      if (n <= 0) continue;
      budget -= n;
      for (var k = 0; k < n; k++) {
        // ComposterBlock.compost: level < 7 -> addToComposter + stack.decrement(1)
        if (Cm.addItem(x, y, z, name, NS.fbRand)) {
          stack.n--;
          if (stack.n <= 0) inv[i] = null;
        }
        if (Cm.level(x, y, z) === Cm.LEVEL_READY) return true;
      }
    }
    return true;
  };

  /** `GoToIfNearbyTask(JOB_SITE, 0.4F, 4)` (.decomp): while within 4 blocks of the job site,
   *  every 180 ticks re-aim WALK_TARGET at a `FuzzyTargeting.find` point near the villager
   *  itself (NOT at the job site -- vanilla's own loiter-nearby shape; `VB.fuzzyFind` with no
   *  scorer is the same "ties keep the first candidate" search `tickIdle`'s `findWalkTargetStart`
   *  already uses). */
  function goToIfNearbyShouldRun(e, tnow, dest) {
    return !!dest && dist3(e, dest) <= VB.GO_IF_NEARBY_MAX_DISTANCE;
  }
  function goToIfNearbyRun(e, tnow) {
    if (tnow < (e.vbGoIfNearbyNext || 0)) return;
    e.vbGoIfNearbyNext = tnow + VB.GO_IF_NEARBY_INTERVAL;
    var v = VB.fuzzyFind(e, VB.GO_IF_NEARBY_H, VB.GO_IF_NEARBY_V, null);
    if (v) setWalkTarget(e, v, 1);
  }

  /** `GoToNearbyPositionTask(JOB_SITE, 0.4F, 1, 10)` (.decomp): while within 10 blocks of the
   *  job site, every 80 ticks re-aim WALK_TARGET straight at it (completion range 1). */
  function goToNearbyShouldRun(e, tnow, dest) {
    return !!dest && dist3(e, dest) <= VB.GO_NEARBY_MAX_DISTANCE;
  }
  function goToNearbyRun(e, tnow, dest) {
    if (tnow < (e.vbGoNearbyNext || 0)) return;
    e.vbGoNearbyNext = tnow + VB.GO_NEARBY_INTERVAL;
    setWalkTarget(e, dest, 1);
  }

  /** `FarmerVillagerTask` (.decomp) whole -- farmer only (`method_19564`'s own profession
   *  check), independent of the job site: a 3x3x3 scan CENTRED ON THE VILLAGER for a mature crop
   *  cell or an air cell directly over farmland, one random target from that set, walked to (raw
   *  BlockPos distance <= 1.0 -- no `+0.5` centring, transcribed as the jar has it), then
   *  harvested (break + `Loot.breakDrops`) or planted (first inventory slot holding a seed item,
   *  `VB.SEED_TO_CROP`) once arrived. `DO_MOB_GRIEFING` is `EL.aiCtx(e).mobGriefing()` -- the
   *  same door `Rb.EatCarrotCropGoal` (07zh_rabbit.js) already uses for the identical gate.
   *  `nextResponseTime` persists on `e.vbFarmerTask` across activations (finishRunning: +40). */
  function isSuitableFarmerTarget(x, y, z) {
    var info = cropBlockAt(x, y, z);
    if (!info) return false;
    if (info.name && isMatureCrop(info)) return true;
    if (info.st === 0) {
      var R = NS.Reg, SR = NS.States, W = NS.World;
      if (!R || !SR || !W) return false;
      var bst = W.getBlock(x, y - 1, z);
      return bst !== 0 && SR.block[bst] === R.id.farmland;
    }
    return false;
  }
  function farmerVillagerTaskShouldRun(e) {
    if (e.profession !== 'farmer') return false;
    var EL = NS.EntityList;
    var ctx = EL && EL.aiCtx ? EL.aiCtx(e) : null;
    if (!ctx || !ctx.mobGriefing()) return false;
    var bp = blockPosOf(e), targets = [];
    for (var dx = -1; dx <= 1; dx++) {
      for (var dy = -1; dy <= 1; dy++) {
        for (var dz = -1; dz <= 1; dz++) {
          if (isSuitableFarmerTarget(bp.x + dx, bp.y + dy, bp.z + dz)) {
            targets.push({ x: bp.x + dx, y: bp.y + dy, z: bp.z + dz });
          }
        }
      }
    }
    if (!targets.length) return false;
    var ft = e.vbFarmerTask || (e.vbFarmerTask = { nextResponse: 0 });
    ft.active = true;
    ft.targets = targets;
    ft.target = targets[nextInt(targets.length)];
    ft.ticksRan = 0;
    return true;
  }
  VB.farmerFinish = function (e, tnow) { if (e.vbFarmerTask) farmerFinish(e.vbFarmerTask, e, tnow); };
  function pickNewFarmerTarget(ft) {
    if (!ft.targets.length) { ft.target = null; return; }
    ft.target = ft.targets[nextInt(ft.targets.length)];
  }
  function farmerVillagerTaskTick(e, tnow) {
    var ft = e.vbFarmerTask;
    var t = ft.target;
    if (!t || dist3(e, t) <= 1.0) {
      if (t && tnow > ft.nextResponse) {
        var info = cropBlockAt(t.x, t.y, t.z);
        var wasMature = !!(info.name && isMatureCrop(info));
        if (wasMature) { dropCropLoot(t.x, t.y, t.z, info.st); setBlockRecorded(t.x, t.y, t.z, 0); }
        if (info.st === 0) {
          var R = NS.Reg, SR = NS.States, W = NS.World;
          var belowSt = W.getBlock(t.x, t.y - 1, t.z);
          var isFarmland = belowSt !== 0 && SR.block[belowSt] === R.id.farmland;
          if (isFarmland) {
            var inv = ensureInv(e);
            for (var i = 0; i < inv.length; i++) {
              var name = invNameAt(inv, i);
              var crop = name && VB.SEED_TO_CROP[name];
              if (crop && R.id[crop] !== undefined) {
                setBlockRecorded(t.x, t.y, t.z, NS.States.stateOf(crop));
                invTakeOne(e, name);
                break;
              }
            }
          }
        }
        if (info.name && !wasMature) {
          var idx = ft.targets.indexOf(t);
          if (idx >= 0) ft.targets.splice(idx, 1);
          pickNewFarmerTarget(ft);
          if (ft.target) {
            ft.nextResponse = tnow + 20;
            setWalkTarget(e, ft.target, 1);
          }
        }
      }
      ft.ticksRan++;
    } else if (tnow > ft.nextResponse) {
      setWalkTarget(e, t, 1);
    }
    if (ft.ticksRan >= VB.FARMER_TASK_MAX_RUN || !ft.target) {
      farmerFinish(ft, e, tnow);
    }
  }
  /** FarmerVillagerTask.finishRunning: forget the walk target, nextResponseTime = time + 40.
   *  The field lives on the long-lived task (`ft`), so it survives into the next activation. */
  function farmerFinish(ft, e, tnow) {
    ft.active = false;
    ft.ticksRan = 0;
    ft.nextResponse = tnow + 40;
    e.vbWalkTarget = null;
  }

  /** `BoneMealTask` (.decomp) whole -- ANY profession (the class itself has no profession check;
   *  only the RandomTask's own weight differs, farmer 4 vs else 7). Fires at most once per 10
   *  ticks of `e.vbAge` (standing in for `entity.age`, the villager's own real-tick-alive counter
   *  -- this engine's `vbAge` is the closest analogue this file's own Task-clock header already
   *  names), needs >=1 `bone_meal` in the 8-slot inventory, and a reservoir-sampled immature-crop
   *  cell in the 3x3x3 box around it (`findBoneMealPos`, transcribed with the SAME
   *  `random.nextInt(++count)==0` running pick vanilla uses, not a naive "first hit"). `grow`
   *  (`CropBlock.applyGrowth`, .decomp) is `age += randomInt(2,5) clamped to maxAge` -- the exact
   *  jar formula, ported directly since it needs no shared `Fertilizable` substrate to be correct
   *  (`VB.OWED`, bottom, names that interface itself as unbuilt for anything else that might want
   *  it). `equipStack(MAINHAND, bone_meal)` while running is not modelled -- no held-item render
   *  hook reads a villager's hand in this engine. */
  function findBoneMealPos(e) {
    var bp = blockPosOf(e), best = null, n = 0;
    for (var dx = -1; dx <= 1; dx++) {
      for (var dy = -1; dy <= 1; dy++) {
        for (var dz = -1; dz <= 1; dz++) {
          var x = bp.x + dx, y = bp.y + dy, z = bp.z + dz;
          var info = cropBlockAt(x, y, z);
          if (info.name && !isMatureCrop(info)) {
            n++;
            if (nextInt(n) === 0) best = { x: x, y: y, z: z };
          }
        }
      }
    }
    return best;
  }
  function boneMealShouldRun(e) {
    if ((e.vbAge || 0) % 10 !== 0) return false;
    var lastEnd = e.vbBoneMealLastEnd || 0;
    if (!(lastEnd === 0 || lastEnd + VB.BONEMEAL_REARM <= (e.vbAge || 0))) return false;
    if (invCount(e, 'bone_meal') <= 0) return false;
    var pos = findBoneMealPos(e);
    if (!pos) return false;
    var bm = e.vbBoneMeal || (e.vbBoneMeal = {});
    bm.active = true; bm.pos = pos; bm.startTime = 0; bm.duration = 0;
    return true;
  }
  function boneMealStart(e, tnow) {
    var bm = e.vbBoneMeal;
    setWalkTarget(e, bm.pos, 1);
    bm.startTime = tnow;
    bm.duration = 0;
  }
  function boneMealTick(e, tnow) {
    var bm = e.vbBoneMeal;
    if (bm.pos && tnow >= bm.startTime && dist3(e, bm.pos) <= 1.0) {
      if (invCount(e, 'bone_meal') > 0) {
        var info = cropBlockAt(bm.pos.x, bm.pos.y, bm.pos.z);
        if (info.name && !isMatureCrop(info)) {
          var Bh = NS.Behave;
          var mx = Bh.maxAge(info.block);
          var newAge = NS.Fertilizable.cropGrowAge(ageOf(info.st), mx, rnd);
          setBlockRecorded(bm.pos.x, bm.pos.y, bm.pos.z, Bh.setProp(info.st, 'age', newAge));
          invTakeOne(e, 'bone_meal');
        }
        bm.pos = findBoneMealPos(e);
        if (bm.pos) { setWalkTarget(e, bm.pos, 1); bm.startTime = tnow + VB.BONEMEAL_RETRY_DELAY; }
      }
      bm.duration++;
    }
    if (!bm.pos || bm.duration >= VB.BONEMEAL_MAX_DURATION) {
      bm.active = false; e.vbBoneMealLastEnd = e.vbAge || 0; e.vbWalkTarget = null;
    }
  }

  /** The weighted pick itself -- the SAME `-Math.pow(rnd(), 1/weight)`-sorted shuffle
   *  `VB.idleFallbackTick` already uses (`RandomTask`'s own `WeightedList`, which draws in
   *  weighted-random ORDER and runs the FIRST candidate whose `shouldRun` passes -- not one
   *  weighted coin flip). Five entries, not six -- `GoToSecondaryPositionTask` is `VB.OWED`
   *  (header, above). */
  VB.workOrder = function (profession) {
    var farmer = profession === 'farmer';
    var rows = [
      ['villagerWork', 7],
      ['goToIfNearby', 2],
      ['goToNearby', 5],
      ['goToSecondary', 5],
      ['farmerVillagerTask', farmer ? 2 : 5],
      ['boneMeal', farmer ? 4 : 7]
    ];
    return rows.map(function (r) { return { name: r[0], key: -Math.pow(rnd(), 1 / r[1]) }; })
      .sort(function (a, b) { return a.key - b.key; });
  };

  /** `createWorkTasks`' own priority-5 `RandomTask`, run once per 'work' tick alongside
   *  `tickWork`'s own priority-2 `VillagerWalkTowardsTask` (both run every tick in real vanilla
   *  Brain scheduling too -- different priority tiers, not mutually exclusive). A multi-tick
   *  winner (`farmerVillagerTask`/`boneMeal`) keeps this tier until its own `shouldKeepRunning`
   *  says otherwise, matching vanilla's one-task-per-tier-at-a-time rule; the other three are
   *  instantaneous (this section's own header explains why that is observably equivalent here). */
  /** `SecondaryPointsOfInterestSensor` (every 40 ticks): blocks within 4 horizontally / 2
   *  vertically of the villager that are the profession's `getSecondaryJobSites()` (farmer:
   *  composter only) -> `e.vbSecondaryJobSite` (SECONDARY_JOB_SITE), else forgotten. */
  VB.SECONDARY_SITES = { farmer: ['composter'] };
  VB.senseSecondary = function (e, tnow) {
    if (tnow < (e.vbSecondarySenseNext || 0)) return;
    e.vbSecondarySenseNext = tnow + 40;
    var names = VB.SECONDARY_SITES[e.profession], W = NS.World, SR = NS.States, bp = blockPosOf(e), out = [];
    if (names && W && SR) {
      for (var dx = -4; dx <= 4; dx++) for (var dy = -2; dy <= 2; dy++) for (var dz = -4; dz <= 4; dz++) {
        var st = W.getBlock(bp.x + dx, bp.y + dy, bp.z + dz);
        if (st && names.indexOf(SR.name(st)) >= 0) out.push({ x: bp.x + dx, y: bp.y + dy, z: bp.z + dz });
      }
    }
    e.vbSecondaryJobSite = out.length ? out : null;
  };
  /** `GoToSecondaryPositionTask(SECONDARY_JOB_SITE, 0.5, 1, 6, JOB_SITE)`: needs both memories;
   *  one random site; JOB_SITE within 6 of the villager; walk target re-written at most every 100. */
  function goToSecondaryShouldRun(e, dest) {
    var l = e.vbSecondaryJobSite;
    if (!l || !l.length || !dest) return false;
    e.vbSecondaryChosen = l[Math.floor(rnd() * l.length)];
    return dist3(e, { x: dest.x + 0.5, y: dest.y + 0.5, z: dest.z + 0.5 }) <= 6;
  }
  function goToSecondaryRun(e, tnow) {
    if (tnow > (e.vbSecondaryNext || 0) && e.vbSecondaryChosen) {
      setWalkTarget(e, e.vbSecondaryChosen, 1);
      e.vbSecondaryNext = tnow + 100;
    }
  }
  function tickWorkRandom(e, tnow) {
    VB.senseSecondary(e, tnow);
    if (e.vbFarmerTask && e.vbFarmerTask.active) { farmerVillagerTaskTick(e, tnow); return; }
    if (e.vbBoneMeal && e.vbBoneMeal.active) { boneMealTick(e, tnow); return; }
    var dest = e.workstation;
    var order = VB.workOrder(e.profession);
    for (var i = 0; i < order.length; i++) {
      switch (order[i].name) {
        case 'villagerWork':
          if (villagerWorkShouldRun(e, tnow, dest)) { villagerWorkRun(e, tnow, dest); return; }
          break;
        case 'goToIfNearby':
          if (goToIfNearbyShouldRun(e, tnow, dest)) { goToIfNearbyRun(e, tnow); return; }
          break;
        case 'goToNearby':
          if (goToNearbyShouldRun(e, tnow, dest)) { goToNearbyRun(e, tnow, dest); return; }
          break;
        case 'goToSecondary':
          if (goToSecondaryShouldRun(e, dest)) { goToSecondaryRun(e, tnow); return; }
          break;
        case 'farmerVillagerTask':
          if (farmerVillagerTaskShouldRun(e)) { farmerVillagerTaskTick(e, tnow); return; }
          break;
        case 'boneMeal':
          if (boneMealShouldRun(e)) { boneMealStart(e, tnow); boneMealTick(e, tnow); return; }
          break;
      }
    }
  }
  VB.tickWorkRandom = tickWorkRandom;   // exposed for the check
  VB.ensureVillagerInventory = ensureInv;   // exposed for the check (test fixtures load stacks)
  VB.goToIfNearbyRun = goToIfNearbyRun;   // exposed for the check -- direct, so a check can
  VB.goToNearbyRun = goToNearbyRun;       // exercise one candidate's own effect without also
                                          // depending on VB.rand for the weighted pick order
                                          // (VB.fuzzyFind, inside goToIfNearbyRun, ALSO reads
                                          // VB.rand -- pinning it for the picker starves the
                                          // fuzzy search of real variety and can legitimately
                                          // return null every try).

  // ── createIdleTasks' priority-2 RandomTask (.decomp VillagerTaskListProvider.java:141-160) ──
  // Seven weighted entries for real: villager-interest FindEntityTask(2), ready-to-breed
  // FindEntityTask(1), wandering-trader FindEntityTask(1), FindWalkTargetTask(1),
  // GoTowardsLookTarget(1), JumpInBedTask(1), WaitTask(1). villager-interest and FindWalkTarget
  // are ported right here; the other five (breeding interest, trader interest, look-then-walk,
  // bed-jump, plain wait) are ported in `src/07zv4_vbidle.js` (loop/vbidle), which overwrites
  // `VB.IDLE_FALLBACK` below with the REAL 2:1:1:1:1:1:1 weighting once it loads (this file's
  // own two-entry array below is just this file's OWN two ports; 07zv4_vbidle.js's own header
  // has the full table).
  VB.IDLE_FALLBACK = [['villagerInterest', 2], ['findWalkTarget', 1]];
  VB.IDLE_INTEREST_RANGE = 8;         // FindEntityTask.create(VILLAGER, 8, ..., completion 2)
  VB.IDLE_INTEREST_COMPLETION = 2;
  VB.IDLE_FIND_H = 10;                // FindWalkTargetTask(speed)'s own default ctor: (speed,10,7)
  VB.IDLE_FIND_V = 7;
  function villagerInterestStart(e) {
    if (e.vbWalkTarget) return false;
    var list = NS.EntityList && NS.EntityList.list;
    if (!list) return false;
    var maxSq = VB.IDLE_INTEREST_RANGE * VB.IDLE_INTEREST_RANGE, best = null, bestD = maxSq;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o === e || o.type !== 'villager' || o.dead || o.removed) continue;
      var dx = o.x - e.x, dy = o.y - e.y, dz = o.z - e.z, d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) { bestD = d; best = o; }
    }
    if (!best) return false;
    setWalkTarget(e, { x: Math.floor(best.x), y: Math.floor(best.y), z: Math.floor(best.z) }, VB.IDLE_INTEREST_COMPLETION);
    return true;
  }
  // loop/vbbreed -- exposed so createPlayTasks' OWN priority-5 RandomTask (src/07zv2_vbplay.js,
  // VillagerTaskListProvider.java:87-97) can reuse this SAME FindEntityTask(VILLAGER,...) port
  // rather than re-scanning; that RandomTask's own first entry is villager-interest too
  // (EntityType.field_6077 -- EntityType.java:577 -- not a second breed-interest copy).
  VB.villagerInterestStart = villagerInterestStart;
  /** `FindWalkTargetTask.method_18996` (.decomp, see header): near an occupied POI section
   *  (radius 1, `VB.occupiedSectionDistance`), a plain `FuzzyTargeting.find` (ties keep the
   *  FIRST candidate, `VB.fuzzyFind`'s own header); otherwise biased toward the nearest occupied
   *  section (`LookTargetUtil.getPosClosestToOccupiedPointOfInterest`, approximated the SAME way
   *  `goToPoiStart`, above, already stands in for that exact POI-adjacency search). */
  function findWalkTargetStart(e) {
    if (e.vbWalkTarget) return false;
    var bp = blockPosOf(e);
    var near = VB.occupiedSectionDistance(bp) <= 1;
    var v = near
      ? VB.fuzzyFind(e, VB.IDLE_FIND_H, VB.IDLE_FIND_V, null)
      : VB.fuzzyFind(e, VB.IDLE_FIND_H, VB.IDLE_FIND_V, function (p) { return -VB.occupiedSectionDistance(p); });
    if (v) setWalkTarget(e, v, 0);
    return true;   // FindWalkTargetTask's own run() always executes once shouldRun passes
  }
  VB.findWalkTargetStart = findWalkTargetStart;   // loop/vbbreed -- createPlayTasks' own third
                                                   // entry (VillagerTaskListProvider.java:90) is
                                                   // the SAME FindWalkTargetTask, reused as-is.
  VB.idleFallbackTick = function (e) {
    var order = VB.IDLE_FALLBACK.map(function (r) { return { name: r[0], key: -Math.pow(rnd(), 1 / r[1]) }; });
    order.sort(function (a, b) { return a.key - b.key; });
    for (var i = 0; i < order.length; i++) {
      var name = order[i].name;
      if (name === 'villagerInterest' && villagerInterestStart(e)) return name;
      if (name === 'findWalkTarget' && findWalkTargetStart(e)) return name;
      // the other five entries (breed-interest, trader-interest, GoTowardsLookTarget,
      // JumpInBedTask, WaitTask) are `src/07zv4_vbidle.js`'s own `VB.IDLE_START` registry --
      // this file never names them directly (loop/vbidle owns those files, this file just
      // dispatches into them the same way it already dispatches into its own two).
      if (VB.IDLE_START && VB.IDLE_START[name] && VB.IDLE_START[name](e)) return name;
    }
    return null;
  };
  function tickIdle(e, tnow) {
    if (VB.idleContinue && VB.idleContinue(e, tnow)) return;   // loop/vbidle's own multi-tick
                                                                 // JumpInBedTask/WaitTask state
    e.vbIdlePick = VB.idleFallbackTick(e);
  }

  function leaveMeet(e) {
    if (e.vbMeeting) release(e, 'vbMeeting');
  }

  /** `VillagerEntity.releaseAllTickets` (.decomp/net/minecraft/entity/passive/
   *  VillagerEntity.java:630-635), called from `onDeath` (:625-628, read whole) — releases the
   *  HOME/JOB_SITE/MEETING/POTENTIAL_JOB_SITE memory tickets. This engine's `VB` only ever
   *  holds the two of those it itself models (`vbHome`/`vbMeeting`; job-site tickets are
   *  `07o_profession.js`'s own `Profession.claimed`, outside this file), so this is that same
   *  subset. `07i_entitylist.js`'s own `EL.remove` calls this once, on a DEAD villager only
   *  (never on a live despawn) — the exact "at the moment of death" hook `onDeath` is, the
   *  same choke-point argument every other death/removal case in that file's own `EL.remove`
   *  already makes. Loop/vsleep, CLOSING one of `VB.OWED`'s own former entries — real vanilla
   *  does NOT also clear the bed's `BedBlock.OCCUPIED` here (`onDeath` never calls `wakeUp`),
   *  so this does not either; a bed a villager died in stays occupied until something else
   *  changes its state, exactly as it would in the real game. */
  VB.releaseAllTickets = function (e) {
    release(e, 'vbHome');
    release(e, 'vbMeeting');
    e.vbWalkTarget = null;
  };

  VB.init = function () {
    VB.ready = !!(NS.EntityList && NS.World);
    return VB;
  };

  /** Called once per villager per tick (07i_entitylist.js's own `EL.tickMob`, the SAME slot
   *  `Trade.tick`/`Village.tick` already occupy — see this file's own header). Self-inits like
   *  `Poi.tick` does; `Poi`/`Ai` themselves may still be cold on an early call (both are
   *  READ, never required at load order), in which case this tick is a cheap no-op. */
  VB.tick = function (e) {
    if (!VB.ready) VB.init();
    if (!VB.ready) return;
    if (!e || e.type !== 'villager' || e.dead || e.removed) return;
    if (e.headRollingTimeLeft > 0) e.headRollingTimeLeft--;
    var now = (NS.Sky && typeof NS.Sky.dayTime === 'number') ? NS.Sky.dayTime : 0;
    // Schedule.VILLAGER_BABY vs VILLAGER_DEFAULT (.decomp VillagerEntity.java:220-225,
    // `initBrain`'s own `isBaby()` branch) -- see VB.SCHEDULE_BABY's own header, above.
    var activity = VB.activityForTime(now, e.isBaby ? VB.SCHEDULE_BABY : VB.SCHEDULE);
    // The Task clock. Vanilla's tasks time themselves off `world.getTime()` (always +1 a tick,
    // never set back); `Sky.dayTime` above is the schedule's clock and can jump. Every Task
    // timer here (find cadence, RetryMarkers, CANT_REACH, WanderAround run time, WaitTask) is
    // only ever compared against the SAME villager's own earlier readings, so a per-villager
    // counter bumped once per VB.tick (once per villager per tick) is that clock exactly.
    var tnow = e.vbAge = (e.vbAge || 0) + 1;
    // PanicTask is a CORE task (createCoreTasks, priority 0) that runs every tick, in every
    // activity, and can force-override the schedule via `Brain.doExclusively` -- hooked here,
    // before the schedule dispatch below, so it pre-empts whatever the clock says (loop/
    // vbpanic, src/07zv3_vbpanic.js's own header).
    if (NS.VBPanic && NS.VBPanic.tick(e, now, tnow)) activity = 'panic';
    if (NS.VBBell && NS.VBBell.tick(e, tnow)) activity = 'hide';
    if (NS.VBDoors) NS.VBDoors.tick(e, tnow);   // OpenDoorsTask, core priority 0
    VB.endRaidTask(e);
    var raidAct = VB.startRaidTask(e);
    if (raidAct && activity !== 'panic') activity = raidAct;
    if (NS.VBHideHome && activity === 'raid') NS.VBHideHome.raidTick(e);
    else if (NS.VBHideHome && activity === 'hide') NS.VBHideHome.hideTick(e);
    VB.celebrateRaidWin(e);
    if (raidAct === 'raid' && activity === 'raid') VB.raidWonRandomTick(e);
    if (activity === 'pre_raid') VB.ringBellTask(e);
    if (e.workstation) VB.workStationCompetition(e);
    e.vbActivity = activity;
    // `VillagerEntity.loot`/`canGather` (loop/vbgather, src/07zv6_vbgather.js's own header) --
    // reached from `MobEntity.tickMovement`'s own dispatcher in vanilla, NOT a Brain task, so
    // it runs every tick in every activity (babies included) rather than only while 'idle'.
    if (NS.VBGather && NS.VBGather.lootTick) NS.VBGather.lootTick(e);
    // FindPointOfInterestTask(HOME) is a CORE task (VillagerTaskListProvider.createCoreTasks,
    // priority 10) — it runs in every activity, not only REST (loop/vbtasks-s106).
    if (poiReady()) VB.findPoiTick(e, NS.Poi.HOME, 'vbHome', false, tnow);
    VB.jobAcquireTick(e, activity, tnow);
    if (poiReady() && (!e.profession || e.profession === 'none') && !e.workstation) VB.takeJobSiteTick(e);
    if (VB.nearestBedSensorTick) VB.nearestBedSensorTick(e, tnow);
    // These two are independent, not an if/else on `activity`: VILLAGER_DEFAULT's own
    // schedule never jumps meet -> rest directly (it always passes through idle, 11000 ->
    // 12000), but nothing guarantees this engine's own dayTime advances one activity at a
    // time (a save load, a debug jump, a future sped-up clock) — an if/else here would leave
    // e.vbMeeting permanently reserved the one time meet is skipped over entirely.
    if (activity === 'rest') tickRest(e, now, tnow); else wakeUp(e, now);
    if (activity === 'meet') tickMeet(e, tnow); else leaveMeet(e);
    // createWorkTasks/createIdleTasks (.decomp VillagerTaskListProvider.java:52-79/141-175) --
    // babies never reach 'work' (VILLAGER_BABY has no work row) so `e.workstation` stays unset
    // for them and tickWork is a no-op; 'idle' runs for both adults and babies. 'play' is
    // baby-only (VB.SCHEDULE has no play row) -- createPlayTasks, loop/vbplay
    // (src/07zv2_vbplay.js's own VB.tickPlay).
    if (activity === 'work') { tickWork(e, tnow); VB.tickWorkRandom(e, tnow); }
    else if (e.vbFarmerTask && e.vbFarmerTask.active) farmerFinish(e.vbFarmerTask, e, tnow);
    // createIdleTasks' priority-3 CompositeTask(VillagerBreedTask) (VillagerTaskListProvider
    // .java:174-186) is a SEPARATE priority group from the priority-2 RandomTask tickIdle
    // dispatches -- both run the SAME tick whenever BREED_TARGET is present, independent of
    // whichever fallback entry tickIdle's own reroll happened to pick (loop/vbbreed,
    // src/07zv5_vbbreed.js's own NS.VBBreed.tick).
    if (activity === 'idle') {
      tickIdle(e, tnow);
      if (NS.VBBreed) NS.VBBreed.tick(e, now, tnow);
      // createIdleTasks' priority-3 CompositeTask(GatherItemsVillagerTask) -- the SAME
      // separate-priority-tier shape as VBBreed.tick just above (loop/vbgather,
      // src/07zv6_vbgather.js's own header).
      if (NS.VBGather && NS.VBGather.tick) NS.VBGather.tick(e, now, tnow);
      // createIdleTasks' priority-3 CompositeTask(GiveGiftsToHeroTask) -- the SAME
      // separate-priority-tier shape again (loop/gifts, src/07zv7_vbgifts.js's own header).
      // `NS.Player` is this engine's one singleplayer character (that file's own signature
      // takes it as a parameter so a check can pass a stub instead).
      if (NS.VBGifts && NS.VBGifts.tick) NS.VBGifts.tick(e, now, tnow, NS.Player);
      // createIdleTasks' priority-3 FindInteractionTargetTask + HoldTradeOffersTask (G18f-N2,
      // src/07zv8_vbhold.js).
      if (NS.VBHold && NS.VBHold.tick) NS.VBHold.tick(e, now, tnow, NS.Player);
    }
    // loop/vbplaywander (src/07zv2_vbplay.js) -- createFreeFollowTask's weighted look-only
    // RandomTask (VillagerTaskListProvider.java:244-260) runs alongside PlayWithVillagerBabiesTask,
    // not instead of it (different required memories -- LOOK_TARGET vs WALK_TARGET/INTERACTION_TARGET).
    // loop/vbbreed -- createPlayTasks' OWN priority-5 RandomTask (VillagerTaskListProvider.java:
    // 87-97) is wired the same way tickIdle's own VB.idleContinue/VB.playFallbackTick pair
    // dispatches (src/07zv2_vbplay.js's own header).
    if (activity === 'play') {
      VB.tickPlay(e, tnow); VB.tickFreeFollow(e, tnow);
      if (!(VB.idleContinue && VB.idleContinue(e, tnow))) VB.playFallbackTick(e);
    }
    // WanderAroundTask — a CORE task: walks whatever WALK_TARGET the tasks above left.
    // createPlayTasks' OWN priority-0 WanderAroundTask(80,120) (.decomp
    // VillagerTaskListProvider.java:83, read this session) replaces the CORE
    // WanderAroundTask()'s 150..250 run-time window with a shorter 80..120 one while
    // 'play' is active -- both copies require the SAME memory (WALK_TARGET), so in real
    // vanilla the priority-0 copy wins that memory lock over the priority-1 CORE one during
    // play; here that is just a different (minRun,maxRun) passed into the SAME shared
    // VB.wanderTick (loop/vbplaywander, src/07zv2_vbplay.js's own VB.PLAY_WANDER_MIN/MAX).
    // FollowCustomerTask (VillagerTaskListProvider.createCoreTasks priority 3, .decomp
    // FollowCustomerTask): while a player trades, WALK_TARGET = customer (speed, closeEnough 2) and
    // LOOK_TARGET = customer every tick; forgotten once it stops running (dist^2>16 etc).
    // Runs after the schedule tasks so it wins the shared memories. No velocityModified flag here.
    var cu = e.customer;
    if (cu && !(e.health <= 0) && !e.inWater && !e.vbSleeping &&
        (cu.x - e.x) * (cu.x - e.x) + (cu.y - e.y) * (cu.y - e.y) + (cu.z - e.z) * (cu.z - e.z) <= 16) {
      e.vbWalkTarget = { x: Math.floor(cu.x), y: Math.floor(cu.y), z: Math.floor(cu.z), range: 2 };
      e.vbLookTarget = { x: cu.x, y: cu.y, z: cu.z };
      e.vbFollowingCustomer = true;
    } else if (e.vbFollowingCustomer) {
      e.vbFollowingCustomer = false; e.vbWalkTarget = null; e.vbLookTarget = null;
    }
    if (!e.vbSleeping && aiReady()) {
      if (activity === 'play') VB.wanderTick(e, tnow, VB.PLAY_WANDER_MIN, VB.PLAY_WANDER_MAX);
      else VB.wanderTick(e, tnow);
    }
  };

  // loop/vsleep, CLOSED (session 105) — the sleeping render pose + head freeze, bed OCCUPIED,
  // ticket release on death. loop/vbtasks-s106, CLOSED — the former three entries: (1) the real
  // walk machinery (shared WALK_TARGET + CANT_REACH memories, WanderAroundTask, VillagerWalk
  // TowardsTask's giveUp past maxRunTime, FindPointOfInterestTask's sorted-5 + path + RetryMarker
  // backoff, ForgetCompletedPointOfInterestTask); (2) the HOME-absent RandomTask (WalkHomeTask /
  // WanderIndoorsTask / GoToPointOfInterestTask / WaitTask, shuffled by weight); (3) the
  // exceedsMaxRange NoPenaltyTargeting.findTo waypoint. What remains is named below.
  // TakeJobSiteTask (.decomp .../task/TakeJobSiteTask.java; createWorkTasks priority 8): a jobless
  // adult holding POTENTIAL_JOB_SITE hands it to the first SEEN villager that has no
  // POTENTIAL_JOB_SITE, a profession (not none) whose workstation accepts the site's POI type, and
  // (with no JOB_SITE yet) a path that reachesTarget -- `Ai.findPath` only returns complete paths.
  // The profession's workstation set is non-empty exactly for the ones that accept JOB_SITE.
  VB.TAKE_SITE_RANGE = 16;
  VB.takeJobSiteTick = function (e) {
    var site = e.vbPotentialJob, EL = NS.EntityList;
    if (!site || e.isBaby || !EL || !EL.list || !NS.Poi.getType(site)) return false;
    var skip = VB.skipTakeReach;
    for (var i = 0; i < EL.list.length; i++) {
      var o = EL.list[i];
      if (o === e || o.type !== 'villager' || o.dead || o.removed || o.isBaby) continue;
      var dx = o.x - e.x, dy = o.y - e.y, dz = o.z - e.z;
      if (dx * dx + dy * dy + dz * dz > VB.TAKE_SITE_RANGE * VB.TAKE_SITE_RANGE) continue;
      if (NS.VBPanic && NS.VBPanic.canSee && !NS.VBPanic.canSee(e, o)) continue;
      if (o.vbPotentialJob) continue;
      var ws = NS.Profession && NS.Profession.WORKSTATIONS[o.profession];
      if (!o.profession || o.profession === 'none' || !ws) continue;
      if (o.workstation) { if (o.workstation.x !== site.x || o.workstation.y !== site.y || o.workstation.z !== site.z) continue; }
      else if (!skip && !NS.Ai.findPath(o.x, o.y, o.z, site.x + 0.5, site.y, site.z + 0.5, { mob: o })) continue;
      // claimSite: forgetJobSiteAndWalkTarget(e), then hand over unless o already holds JOB_SITE
      e.vbWalkTarget = null; e.vbLookTarget = null;
      NS.Poi.releaseTicket(site); e.vbPotentialJob = null;
      if (!o.workstation) {
        o.vbWalkTarget = { x: site.x, y: site.y, z: site.z, range: 1, speed: 0.5 };
        o.vbPotentialJob = { x: site.x, y: site.y, z: site.z };
      }
      return true;
    }
    return false;
  };

  VB.OWED = [
    'loop/vbwork, PARTIALLY CLOSING createWorkTasks\' priority-5 RandomTask: ' +
      'VillagerWorkTask/FarmerVillagerTask/BoneMealTask/GoToNearbyPositionTask/GoToIfNearbyTask ' +
      'are now ported (VB.workOrder/tickWorkRandom) and the weighted pick has all six candidates; ' +
      'GoToSecondaryPositionTask is ported too (SECONDARY_JOB_SITE via VB.senseSecondary); ' +
      'FarmerWorkTask.performAdditionalWork is ported (D-591, ' +
      'VB.farmerAdditionalWork -- bread + seed composting through 07zy_composter.js; its ' +
      'levelEvent 1500 composter particles/sound are emitted too); CropBlock.applyGrowth\'s growth-bump ' +
      'formula is ported only inline inside BoneMealTask\'s own call site, not as a shared ' +
      '`Fertilizable` interface anything else (a player\'s own bone meal use, say) could reuse; ' +
      'createPlayTasks (a baby\'s own PLAY activity) is now FULLY CLOSED (loop/vbplay + ' +
      'loop/vbplaywander + loop/vbbreed, src/07zv2_vbplay.js) -- PlayWithVillagerBabiesTask ' +
      '(with the real getLeastPopularBabyInteractionTarget popularity sort), ' +
      'WanderAroundTask(80,120), createFreeFollowTask, AND its own priority-5 RandomTask (six ' +
      'weighted entries: villager-interest, cat-interest, FindWalkTargetTask, ' +
      'GoTowardsLookTarget, JumpInBedTask, WaitTask(20,40), gated on VISIBLE_VILLAGER_BABIES ' +
      'present) are all ported -- VB.PLAY_FALLBACK/VB.playFallbackTick, dispatched from VB.tick ' +
      'the same way tickIdle dispatches VB.IDLE_FALLBACK' +
      // STRUCK loop/vbpanic: createPanicTasks/the PANIC activity IS wired now -- the
      // danger-memory substrate (NEAREST_HOSTILE/HURT_BY/HURT_BY_ENTITY stand-ins) and the
      // PanicTask/StopPanickingTask/createPanicTasks task-list stand-ins live in the NEW
      // src/07zv3_vbpanic.js (NS.VBPanic), hooked in VB.tick; that file's own VBP.OWED names
      // what remains within panic (visibility, sensor caching, the speed*1.5 boost,
      // createBusyFollowTask).
      ''
    // STRUCK #5881: pathToAny IS one multi-target A* (Ai.findPath opts.goals, tools/pathanycheck.mjs).
  ];

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
