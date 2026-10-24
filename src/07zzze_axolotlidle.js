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
    var rand = ctx.random || function () { return Math.random(); };
    var Ax = NS.Axolotl, now = 0, nav = {}, ticked = false;
    var world = { get time() { return now; }, random: { nextInt: function (n) { return Math.floor(rand() * n); } } };
    var fuzz = function (h, v) {
      return { x: e.x + Math.floor(rand() * (2 * h + 1)) - h, y: e.y + Math.floor(rand() * (2 * v + 1)) - v,
               z: e.z + Math.floor(rand() * (2 * h + 1)) - h };
    };
    var wet = function (p) {
      var W = NS.World, S = NS.States, R = NS.Reg;
      return !!(W && S && R && S.block[W.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))] === R.id.water);
    };
    var view = Object.create(e);
    view.isInWaterOrBubble = function () { return !!e.inWater; };
    view.isOnGround = function () { return !!e.onGround; };
    view.fuzzyFind = fuzz; view.lookFind = fuzz;
    view.fluidEmptyAt = function (p) { return !wet(p); };
    view.lookTargetIsWater = wet;
    view.brain = AI.makeBrain({ nextFloat: rand });
    var br = view.brain;
    var wt = function () { var m = br.memories.get(B.WALK_TARGET); return m ? m.value : null; };
    var step = function () { now++; br.tick(world, view); };
    this.canUse = function () {
      if (e.playingDead) { if (wt()) br.forget(B.WALK_TARGET); return false; }
      step(); return !!wt();
    };
    this.canContinueToUse = function () {
      var t = wt();
      if (e.playingDead || !t) return false;
      var dx = t.pos.x - e.x, dy = t.pos.y - e.y, dz = t.pos.z - e.z;
      return dx * dx + dy * dy + dz * dz > Math.max(1, t.completionRange * t.completionRange);
    };
    this.start = function () { ticked = true; };
    this.stop = function () { br.forget(B.WALK_TARGET); };
    this.tick = function () {
      var t = wt();
      if (ticked) ticked = false; else step();
      t = wt();
      if (t && Ax && Ax.navStep) Ax.navStep(e, nav, t.pos.x, t.pos.y, t.pos.z, t.speed);
    };
  };
})(MCL);
