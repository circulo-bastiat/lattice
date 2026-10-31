// src/07zzze_axolotlidle.js — G18a-AX2 (#9268): AxolotlBrain.addIdleActivities priority 4 (.decomp AxolotlBrain.java
// lines 117-131) on the Brain substrate: CompositeTask(WALK_TARGET absent, no forgets, ORDERED, RUN_ALL) of
// AquaticStrollTask(0.5) w2, StrollTask(0.15, false) w2, GoTowardsLookTarget(canGoToLookTarget, temptedSpeed, 3) w3,
// ConditionalTask(isInsideWaterOrBubbleColumn, WaitTask(30,60)) w5, ConditionalTask(isOnGround, WaitTask(200,400)) w5.
// Each stopped child gets tryStarting in list order (one world.random.nextInt each, even min==max). Entity hooks as in
// StrollTask: e.isInWaterOrBubble(), e.isOnGround(), e.lookTargetIsWater(). Priorities 0-3 stay with their own ports.
(function (NS) {
  'use strict';
  var B = NS.Brain, Task = B.Task;
  B.LOOK_TARGET = 'look_target';

  function GoTowardsLookTarget(pred, speedFn, completionRange) {
    var r = {}; r[B.WALK_TARGET] = B.VALUE_ABSENT; r[B.LOOK_TARGET] = B.VALUE_PRESENT;
    Task.call(this, r);
    this.predicate = pred || function () { return true; }; this.speed = speedFn; this.completionRange = completionRange;
  }
  GoTowardsLookTarget.prototype = Object.create(Task.prototype);
  GoTowardsLookTarget.prototype.shouldRun = function (w, e) { return !!this.predicate(e); };
  GoTowardsLookTarget.prototype.run = function (w, e) {
    var lt = e.brain.memories.get(B.LOOK_TARGET).value;
    e.brain.remember(B.WALK_TARGET, { pos: lt, speed: this.speed(e), completionRange: this.completionRange });
  };
  B.GoTowardsLookTarget = GoTowardsLookTarget;

  var AI = NS.AxolotlIdle = {};
  AI.PRE_DRAWS = 11;
  AI.temptedSpeed = function (e) { return e.isInWaterOrBubble() ? 0.5 : 0.15; };
  /** canGoToLookTarget: a LOOK_TARGET exists and its block's water-ness equals the axolotl's; else false. */
  AI.canGoToLookTarget = function (e) {
    var m = e.brain.memories.get(B.LOOK_TARGET);
    return !!m && e.lookTargetIsWater(m.value) === e.isInWaterOrBubble();
  };
  AI.makeWanderTask = function (rng) {
    var req = {}; req[B.WALK_TARGET] = B.VALUE_ABSENT;
    return new B.CompositeTask(req, [], B.ORDER_ORDERED, B.RUN_ALL, [
      [new B.AquaticStrollTask(0.5), 2],
      [new B.StrollTask(0.15, 10, 7, false), 2],
      [new B.GoTowardsLookTarget(AI.canGoToLookTarget, AI.temptedSpeed, 3), 3],
      [new B.ConditionalTask({}, function (e) { return e.isInWaterOrBubble(); }, new B.WaitTask(30, 60)), 5],
      [new B.ConditionalTask({}, function (e) { return e.isOnGround(); }, new B.WaitTask(200, 400)), 5]
    ], rng);
  };
  /** A Brain holding only the IDLE priority-4 wander composite (priorities 0-3 are other ports). */
  AI.makeBrain = function (rng) {
    var br = new B.Brain();
    br.registerMemory(B.WALK_TARGET); br.registerMemory(B.LOOK_TARGET);
    br.setTaskList(B.IDLE, 4, [AI.makeWanderTask(rng)], []);
    br.setCoreActivities([]); br.resetPossibleActivities(B.IDLE);
    return br;
  };

  /** Engine goal (replaces Ax.WanderGoal): ticks the IDLE wander Brain once per game tick and walks to its WALK_TARGET
   *  (MoveToTargetTask stand-in: Ax.navStep, done within completionRange or ~1 block). Entity hooks live on a view of e. */
  AI.BrainWanderGoal = function (e, ctx) {
    ctx = ctx || {};
    var jr = e.random && e.random.nextInt ? e.random : null;   // Mob.getRandom() / world.random: the entity's pinned JRandom (lockstep)
    var rand = ctx.random || function () { return Math.random(); };
    // Calibrated, not derived (#7335): the real server's mob random has consumed 11 draws (per-tick Mob.baseTick / initialize / spawn) before the first
    // FuzzyPositions sample; skipping 11 reproduces the server's salt-0 target ((12,1,1)) and its trajectory to tick 12 (the source of the 11 is OWED).
    if (jr) for (var q0 = 0; q0 < AI.PRE_DRAWS; q0++) jr.nextInt(3);
    var ni = function (n) { return jr ? jr.nextInt(n) : Math.floor(rand() * n); };
    var Ax = NS.Axolotl, now = 0, nav = {}, ticked = false, pathed = false;
    var wr = jr ? new NS.JRandom(1) : null;   // ServerWorld.getRandom() (task run times) is a different stream from Mob.getRandom() (targeting)
    var world = { get time() { return now; }, random: { nextInt: wr ? function (n) { return wr.nextInt(n); } : ni } };
    var blk = function (x, y, z) { var W = NS.World, S = NS.States; return S.block[W.getBlock(x, y, z)]; };
    var wet = function (p) {
      var W = NS.World, S = NS.States, R = NS.Reg;
      return !!(W && S && R && S.block[W.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))] === R.id.water);
    };
    var airAt = function (x, y, z) { var S = NS.States; return !!(S.isAir && S.isAir[NS.World.getBlock(x, y, z)]); };
    var solidAt = function (x, y, z) { var S = NS.States; return !!(S.solid ? S.solid[NS.World.getBlock(x, y, z)] : false); };
    var penaltyFree = function (x, y, z) {   // hasPathfindingPenalty: LandPathNodeMaker.getLandNodeType, which has no WATER_BORDER (that is the amphibious maker's neighbour scan)
      var t = Ax.nodeType(x, y, z);
      return Ax.NODE_PENALTY[t === 'WATER_BORDER' ? 'WATER' : t] === 0;
    };
    // FuzzyPositions.guessBest (10 draws, favor 0 so the first non-null sample wins) over localFuzz(h, v) + towardTarget
    var guess = function (h, v, validate) {
      var bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z), got = null;
      for (var i = 0; i < 10; i++) {
        var dx = ni(2 * h + 1) - h, dy = ni(2 * v + 1) - v, dz = ni(2 * h + 1) - h;
        var x = bx + dx, y = by + dy, z = bz + dz;
        if (y < NS.CFG.WORLD_MIN_Y || y > 256 || airAt(x, y - 1, z)) continue;   // isHeightInvalid / AxolotlSwimNavigation.isValidPosition
        var q = validate(x, y, z);
        if (q && !got) got = q;
      }
      return got ? { x: got.x + 0.5, y: got.y, z: got.z + 0.5 } : null;
    };
    var fuzz = function (h, v) {   // FuzzyTargeting.find: upWhile(solid), then not water, no pathfinding penalty
      return guess(h, v, function (x, y, z) {
        while (y < 256 && solidAt(x, y, z)) y++;
        return !wet({ x: x, y: y, z: z }) && penaltyFree(x, y, z) ? { x: x, y: y, z: z } : null;
      });
    };
    var look = function (h, v) {   // LookTargetUtil.find: NoPenaltyTargeting.find, re-rolled up to 10 times while the block cannot be pathed through for NavigationType.WATER (field_48: fluid is water)
      var q = function () { return guess(h, v, function (x, y, z) { return penaltyFree(x, y, z) ? { x: x, y: y, z: z } : null; }); };
      var r = q(), n = 0;
      while (r && !wet(r) && n++ < 10) r = q();
      return r;
    };
    var view = Object.create(e);
    view.isInWaterOrBubble = function () { return !!e.inWater; };
    view.isOnGround = function () { return !!e.onGround; };
    view.fuzzyFind = fuzz; view.lookFind = look;
    view.fluidEmptyAt = function (p) { return !wet(p); };
    view.lookTargetIsWater = wet;
    view.brain = AI.makeBrain({ nextFloat: function () { return jr ? jr.nextFloat() : rand(); } });
    var br = view.brain;
    var wt = function () { var m = br.memories.get(B.WALK_TARGET); return m ? m.value : null; };
    var step = function () { now++; br.tick(world, view); };
    this.canUse = function () {
      if (e.playingDead) { if (wt()) br.forget(B.WALK_TARGET); return false; }
      step(); return !!wt();
    };
    this.canContinueToUse = function () {
      var t = wt();
      if (e.playingDead || !t || nav.done) return false;   // nav.done: the path is finished = EntityNavigation.isIdle
      var m = Math.abs(Math.floor(t.pos.x) - Math.floor(e.x)) + Math.abs(Math.floor(t.pos.y) - Math.floor(e.y)) + Math.abs(Math.floor(t.pos.z) - Math.floor(e.z));
      return m > t.completionRange;   // WanderAroundTask.hasReached: manhattan block distance <= completionRange
    };
    this.start = function () { ticked = true; pathed = false; nav = { stopAtEnd: true }; };
    this.stop = function () { br.forget(B.WALK_TARGET); };
    this.tick = function () {
      var t = wt();
      if (ticked) { ticked = false; return; }   // WALK_TARGET set this tick: the core WanderAroundTask (already tried this tick) starts next tick
      step();
      if (!pathed) { pathed = true; return; }   // the core WanderAroundTask only starts the path then; EntityNavigation.tick (MoveControl.moveTo) sees it the tick after
      t = wt();
      if (t && Ax && Ax.navStep) Ax.navStep(e, nav, t.pos.x, t.pos.y, t.pos.z, t.speed);
    };
  };
})(MCL);
