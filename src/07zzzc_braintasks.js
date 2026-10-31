// src/07zzzc_braintasks.js — G18a-AX1b (#9436): port of task.CompositeTask, task.RandomTask, task.ConditionalTask
// (+ the WeightedList.shuffle they use). RandomTask = CompositeTask(order SHUFFLE, runMode RUN_ONE). Starting a
// CompositeTask draws, in order: Task.tryStarting's nextInt on world.random, then run() shuffles (one nextFloat per entry
// on the WeightedList's OWN Random - vanilla `new Random()`, unseeded; here `rng` is injectable), then the first child
// whose tryStarting succeeds ends the pass (findFirst short-circuits; each child start draws its own nextInt).
(function (NS) {
  'use strict';
  var B = NS.Brain, Task = B.Task;
  B.ORDER_ORDERED = 0; B.ORDER_SHUFFLED = 1; B.RUN_ONE = 0; B.RUN_ALL = 1;

  /** WeightedList of [task, weight]; shuffle sorts ascending by -pow(float r, float(1/weight)), stable. */
  function WeightedList(rng) { this.entries = []; this.rng = rng || new NS.JRandom(); }
  WeightedList.prototype.add = function (el, w) { this.entries.push({ data: el, weight: w, order: 0 }); return this; };
  WeightedList.prototype.shuffle = function () {
    var r = this.rng;
    this.entries.forEach(function (en) { en.order = -Math.pow(Math.fround(r.nextFloat()), Math.fround(1 / en.weight)); });
    this.entries.sort(function (a, b) { return a.order < b.order ? -1 : a.order > b.order ? 1 : 0; });
    return this;
  };
  WeightedList.prototype.stream = function () { return this.entries.map(function (en) { return en.data; }); };
  B.WeightedList = WeightedList;

  function merge(a, b) { var o = {}, k; for (k in a) o[k] = a[k]; for (k in b) o[k] = b[k]; return o; }

  /** CompositeTask(req, forgetWhenStopped [memory], order, runMode, [[task, weight]], rng?) */
  function CompositeTask(req, forget, order, runMode, pairs, rng) {
    Task.call(this, req);
    this.forgetWhenStopped = forget || []; this.order = order; this.runMode = runMode;
    this.tasks = new WeightedList(rng);
    for (var i = 0; i < pairs.length; i++) this.tasks.add(pairs[i][0], pairs[i][1]);
  }
  CompositeTask.prototype = Object.create(Task.prototype);
  function running(c) { return c.tasks.stream().filter(function (t) { return t.status === B.RUNNING; }); }
  CompositeTask.prototype.shouldKeepRunning = function (w, e, t) { return running(this).some(function (k) { return k.shouldKeepRunning(w, e, t); }); };
  CompositeTask.prototype.isTimeLimitExceeded = function () { return false; };
  CompositeTask.prototype.run = function (w, e, t) {
    if (this.order === B.ORDER_SHUFFLED) this.tasks.shuffle();
    var s = this.tasks.stream().filter(function (k) { return k.status === B.STOPPED; });
    for (var i = 0; i < s.length; i++) { var ok = s[i].tryStarting(w, e, t); if (ok && this.runMode === B.RUN_ONE) break; }
  };
  CompositeTask.prototype.keepRunning = function (w, e, t) { running(this).forEach(function (k) { k.tick(w, e, t); }); };
  CompositeTask.prototype.finishRunning = function (w, e, t) {
    running(this).forEach(function (k) { k.stop(w, e, t); });
    for (var i = 0; i < this.forgetWhenStopped.length; i++) e.brain.forget(this.forgetWhenStopped[i]);
  };
  B.CompositeTask = CompositeTask;

  /** RandomTask([[task, weight]]) or RandomTask(req, [[task, weight]]); optional trailing rng for the shuffle. */
  function RandomTask(a, b, rng) {
    var req = Array.isArray(a) ? {} : a, pairs = Array.isArray(a) ? a : b;
    CompositeTask.call(this, req, [], B.ORDER_SHUFFLED, B.RUN_ONE, pairs, Array.isArray(a) ? b : rng);
  }
  RandomTask.prototype = Object.create(CompositeTask.prototype);
  B.RandomTask = RandomTask;

  /** ConditionalTask(req, predicate, delegate, allowsContinuation); requirements = req merged with delegate's. */
  function ConditionalTask(req, cond, delegate, allowsContinuation) {
    Task.call(this, merge(req, delegate.required));
    this.condition = cond || function () { return true; }; this.delegate = delegate; this.allowsContinuation = !!allowsContinuation;
  }
  ConditionalTask.prototype = Object.create(Task.prototype);
  ConditionalTask.prototype.shouldRun = function (w, e) { return !!this.condition(e) && this.delegate.shouldRun(w, e); };
  ConditionalTask.prototype.shouldKeepRunning = function (w, e, t) { return this.allowsContinuation && !!this.condition(e) && this.delegate.shouldKeepRunning(w, e, t); };
  ConditionalTask.prototype.isTimeLimitExceeded = function () { return false; };
  ConditionalTask.prototype.run = function (w, e, t) { this.delegate.run(w, e, t); };
  ConditionalTask.prototype.keepRunning = function (w, e, t) { this.delegate.keepRunning(w, e, t); };
  ConditionalTask.prototype.finishRunning = function (w, e, t) { this.delegate.finishRunning(w, e, t); };
  B.ConditionalTask = ConditionalTask;

  // G18a-AX1c (#9437): port of task.StrollTask and task.AquaticStrollTask (.decomp). The world-dependent finders are
  // entity hooks (the entity layer owns them): e.fuzzyFind(h, v) = FuzzyTargeting.find, e.lookFind(h, v) =
  // LookTargetUtil.find (each returns {x,y,z} or null), e.fluidEmptyAt(vec) = world.getFluidState(BlockPos(vec)).isEmpty(),
  // e.isInWaterOrBubble(). WALK_TARGET is B.WALK_TARGET; remember(Optional.empty) == forget.
  B.WALK_TARGET = 'walk_target';
  function StrollTask(speed, h, v, inWater) {
    Task.call(this, (function (r) { r[B.WALK_TARGET] = B.VALUE_ABSENT; return r; })({}));
    this.speed = speed; this.horizontalRadius = h === undefined ? 10 : h; this.verticalRadius = v === undefined ? 7 : v;
    this.strollInsideWater = inWater === undefined ? true : !!inWater;
  }
  StrollTask.prototype = Object.create(Task.prototype);
  StrollTask.prototype.shouldRun = function (w, e) { return this.strollInsideWater || !e.isInWaterOrBubble(); };
  StrollTask.prototype.run = function (w, e) {
    var p = this.findWalkTarget(e);
    if (p) e.brain.remember(B.WALK_TARGET, { pos: p, speed: this.speed, completionRange: 0 });
    else e.brain.forget(B.WALK_TARGET);
  };
  StrollTask.prototype.findWalkTarget = function (e) { return e.fuzzyFind(this.horizontalRadius, this.verticalRadius); };
  B.StrollTask = StrollTask;

  var MULT = [[1, 1], [3, 3], [5, 5], [6, 5], [7, 7], [10, 7]];
  function AquaticStrollTask(speed) { StrollTask.call(this, speed); }
  AquaticStrollTask.prototype = Object.create(StrollTask.prototype);
  AquaticStrollTask.NORMALIZED_POS_MULTIPLIERS = MULT;
  AquaticStrollTask.prototype.shouldRun = function (w, e) { return !!e.isInWaterOrBubble(); };
  AquaticStrollTask.prototype.findWalkTarget = function (e) {
    var prev = null, cur = null;
    for (var i = 0; i < MULT.length; i++) {
      var m = MULT[i];
      if (prev === null) cur = e.lookFind(m[0], m[1]);
      else {
        var dx = prev.x - e.x, dy = prev.y - e.y, dz = prev.z - e.z, len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (len < 1.0E-5) { dx = dy = dz = 0; } else { dx /= len; dy /= len; dz /= len; }
        cur = { x: e.x + dx * m[0], y: e.y + dy * m[1], z: e.z + dz * m[0] };
      }
      if (cur === null || e.fluidEmptyAt(cur)) return prev;
      prev = cur;
    }
    return cur;
  };
  B.AquaticStrollTask = AquaticStrollTask;
})(MCL);
