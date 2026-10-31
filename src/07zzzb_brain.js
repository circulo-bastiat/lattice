// src/07zzzb_brain.js — G18a-AX1 (#9267): the Brain/Task substrate, a pure port of net.minecraft.entity.ai.brain.Brain
// + task.Task + task.WaitTask. Nothing uses it yet. Task.tryStarting draws ONE world.random.nextInt(max+1-min) per start
// (even when min==max), in Brain.startTasks order: priority ascending (TreeMap), then activity in setTaskList order,
// then task in insertion order (LinkedHashSet). `world` = { time, random: { nextInt(bound) } }.
(function (NS) {
  'use strict';
  var B = NS.Brain = {};
  B.ACTIVITY_REFRESH_COOLDOWN = 20;
  B.DEFAULT_RUN_TIME = 60;
  B.IDLE = 'idle';
  B.STOPPED = 0; B.RUNNING = 1;
  B.VALUE_PRESENT = 'value_present'; B.VALUE_ABSENT = 'value_absent'; B.REGISTERED = 'registered';

  /** Task(requiredMemoryStates {memory: state}, minRun, maxRun); override shouldRun/run/shouldKeepRunning/keepRunning/finishRunning. */
  function Task(req, minRun, maxRun) {
    if (minRun === undefined) minRun = B.DEFAULT_RUN_TIME;
    if (maxRun === undefined) maxRun = minRun;
    this.required = req || {}; this.minRunTime = minRun; this.maxRunTime = maxRun;
    this.status = B.STOPPED; this.endTime = 0;
  }
  Task.prototype.shouldRun = function () { return true; };
  Task.prototype.run = function () {};
  Task.prototype.keepRunning = function () {};
  Task.prototype.finishRunning = function () {};
  Task.prototype.shouldKeepRunning = function () { return false; };
  Task.prototype.isTimeLimitExceeded = function (t) { return t > this.endTime; };
  Task.prototype.tryStarting = function (world, e, t) {
    var br = e.brain;
    for (var k in this.required) if (!br.isMemoryInState(k, this.required[k])) return false;
    if (!this.shouldRun(world, e)) return false;
    this.status = B.RUNNING;
    this.endTime = t + this.minRunTime + world.random.nextInt(this.maxRunTime + 1 - this.minRunTime);
    this.run(world, e, t);
    return true;
  };
  Task.prototype.tick = function (world, e, t) {
    if (!this.isTimeLimitExceeded(t) && this.shouldKeepRunning(world, e, t)) this.keepRunning(world, e, t);
    else this.stop(world, e, t);
  };
  Task.prototype.stop = function (world, e, t) { this.status = B.STOPPED; this.finishRunning(world, e, t); };
  B.Task = Task;

  /** WaitTask: runs a random min..max ticks doing nothing. */
  function WaitTask(min, max) { Task.call(this, {}, min, max); }
  WaitTask.prototype = Object.create(Task.prototype);
  WaitTask.prototype.shouldKeepRunning = function () { return true; };
  B.WaitTask = WaitTask;

  function Brain(sensors) {
    this.memories = new Map();        // type -> { value, ttl } (ttl Infinity = not expiring)
    this.sensors = sensors || [];
    this.tasks = new Map();           // priority -> Map(activity -> task[])
    this.requiredActivityMemories = new Map();
    this.forgettingActivityMemories = new Map();
    this.coreActivities = [];
    this.possibleActivities = [];
    this.defaultActivity = B.IDLE;
    this.activityStartTime = -9999;
    this.schedule = null;             // { getActivityForTime(t) }
  }
  var P = Brain.prototype;
  P.remember = function (type, value, ttl) { this.memories.set(type, { value: value, ttl: ttl === undefined ? Infinity : ttl }); };
  P.forget = function (type) { this.memories.set(type, null); };
  P.hasMemory = function (type) { var m = this.memories.get(type); return !!m; };
  P.isMemoryInState = function (type, state) {
    if (!this.memories.has(type)) return false;
    var present = !!this.memories.get(type);
    return state === B.REGISTERED || (state === B.VALUE_PRESENT && present) || (state === B.VALUE_ABSENT && !present);
  };
  P.registerMemory = function (type) { if (!this.memories.has(type)) this.memories.set(type, null); };
  P.setSchedule = function (s) { this.schedule = s; };
  P.setCoreActivities = function (a) { this.coreActivities = a.slice(); };
  P.setDefaultActivity = function (a) { this.defaultActivity = a; };
  P.hasActivity = function (a) { return this.possibleActivities.indexOf(a) >= 0; };
  P.getPossibleActivities = function () { return this.possibleActivities; };
  P.getFirstPossibleNonCoreActivity = function () {
    for (var i = 0; i < this.possibleActivities.length; i++) if (this.coreActivities.indexOf(this.possibleActivities[i]) < 0) return this.possibleActivities[i];
    return null;
  };

  /** setTaskList(activity, startPriority, tasks, requiredMemories [[type,state]], forgetMemories [type]) — indexTaskList numbers from startPriority. */
  P.setTaskList = function (activity, priority, tasks, required, forgetting) {
    this.requiredActivityMemories.set(activity, required || []);
    if (forgetting && forgetting.length) this.forgettingActivityMemories.set(activity, forgetting);
    for (var i = 0; i < tasks.length; i++) {
      var p = priority + i, byAct = this.tasks.get(p);
      if (!byAct) this.tasks.set(p, byAct = new Map());
      var list = byAct.get(activity);
      if (!list) byAct.set(activity, list = []);
      if (list.indexOf(tasks[i]) < 0) list.push(tasks[i]);
    }
  };
  P.canDoActivity = function (a) {
    var req = this.requiredActivityMemories.get(a);
    if (!req) return false;
    for (var i = 0; i < req.length; i++) if (!this.isMemoryInState(req[i][0], req[i][1])) return false;
    return true;
  };
  P.resetPossibleActivities = function (a) {
    if (Array.isArray(a)) {
      for (var i = 0; i < a.length; i++) if (this.canDoActivity(a[i])) { this.resetPossibleActivities(a[i]); break; }
      return;
    }
    if (a === undefined) a = this.defaultActivity;
    if (this.hasActivity(a)) return;
    for (var j = 0; j < this.possibleActivities.length; j++) {
      var old = this.possibleActivities[j];
      if (old === a) continue;
      var f = this.forgettingActivityMemories.get(old);
      if (f) for (var k = 0; k < f.length; k++) this.forget(f[k]);
    }
    this.possibleActivities = this.coreActivities.slice();
    this.possibleActivities.push(a);
  };
  P.doExclusively = function (a) { if (this.canDoActivity(a)) this.resetPossibleActivities(a); else this.resetPossibleActivities(); };
  P.refreshActivities = function (timeOfDay, time) {
    if (time - this.activityStartTime > B.ACTIVITY_REFRESH_COOLDOWN) {
      this.activityStartTime = time;
      var a = this.schedule ? this.schedule.getActivityForTime(timeOfDay % 24000) : B.IDLE;
      if (!this.hasActivity(a)) this.doExclusively(a);
    }
  };
  P.getRunningTasks = function () {
    var out = [], pr = Array.from(this.tasks.keys()).sort(function (a, b) { return a - b; });
    for (var i = 0; i < pr.length; i++) this.tasks.get(pr[i]).forEach(function (list) {
      for (var j = 0; j < list.length; j++) if (list[j].status === B.RUNNING) out.push(list[j]);
    });
    return out;
  };
  P.tickMemories = function () {
    var self = this;
    this.memories.forEach(function (m, type) {
      if (!m) return;
      if (m.ttl !== Infinity) { m.ttl--; if (m.ttl <= 0) self.forget(type); }
    });
  };
  P.startTasks = function (world, e) {
    var t = world.time, pr = Array.from(this.tasks.keys()).sort(function (a, b) { return a - b; });
    for (var i = 0; i < pr.length; i++) {
      var self = this;
      this.tasks.get(pr[i]).forEach(function (list, act) {
        if (self.possibleActivities.indexOf(act) < 0) return;
        for (var j = 0; j < list.length; j++) if (list[j].status === B.STOPPED) list[j].tryStarting(world, e, t);
      });
    }
  };
  P.updateTasks = function (world, e) {
    var t = world.time, run = this.getRunningTasks();
    for (var i = 0; i < run.length; i++) run[i].tick(world, e, t);
  };
  P.stopAllTasks = function (world, e) {
    var run = this.getRunningTasks();
    for (var i = 0; i < run.length; i++) run[i].stop(world, e, world.time);
  };
  P.tick = function (world, e) {
    this.tickMemories();
    for (var i = 0; i < this.sensors.length; i++) this.sensors[i].tick(world, e);
    this.startTasks(world, e);
    this.updateTasks(world, e);
  };
  B.Brain = Brain;
})(MCL);
