// 02r is net/minecraft/server/world (#11753): ChunkTicketType, ChunkTicket, ChunkTicketManager, ChunkHolder (level logic),
// ChunkTaskPrioritySystem, LevelPrioritizedQueue, PlayerChunkWatchingManager, EntityTrackingListener, ServerEntityManager
// and ServerLightingProvider, as synchronous single-thread ports (the CompletableFuture/executor plumbing collapses to
// direct calls; the ordering rules - level priority, ticket expiry, section tracking, light stage order - are kept).
// Main only. Main.worldTick calls ServerWorld.tick() (ticket age/purge); NS.ServerWorld.manager is the live ticket manager.
(function (NS) {
  'use strict';
  var SW = NS.ServerWorld = NS.ServerWorld || {};

  // ChunkStatus.DISTANCE_TO_STATUS has 13 entries (full, features, liquid_carvers, biomes, 8 x structure_starts)
  SW.MAX_LEVEL = 33 + 13;                    // ThreadedAnvilChunkStorage.MAX_LEVEL = 46
  SW.NEARBY_PLAYER_TICKET_LEVEL = 33 + 0 - 2; // ChunkTicketManager: 33 + distanceFromFull(full) - 2 = 31
  SW.STATUSES = ['empty', 'structure_starts', 'structure_references', 'biomes', 'noise', 'surface', 'carvers', 'liquid_carvers', 'features', 'light', 'spawn', 'heightmap', 'full'];
  SW.DISTANCE_TO_STATUS = ['full', 'features', 'liquid_carvers', 'biomes', 'structure_starts', 'structure_starts', 'structure_starts', 'structure_starts', 'structure_starts', 'structure_starts', 'structure_starts', 'structure_starts', null];

  SW.chunkKey = function (x, z) { return x + ',' + z; };
  function cmpNum(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

  // ChunkTicketType
  function ChunkTicketType(name, cmp, expiry) { this.name = name; this.cmp = cmp; this.expiryTicks = expiry | 0; }
  ChunkTicketType.prototype.toString = function () { return this.name; };
  ChunkTicketType.prototype.getArgumentComparator = function () { return this.cmp; };
  ChunkTicketType.prototype.getExpiryTicks = function () { return this.expiryTicks; };
  var byPos = function (a, b) { return cmpNum(a.x, b.x) || cmpNum(a.z, b.z); };
  var zero = function () { return 0; };
  SW.ChunkTicketType = ChunkTicketType;
  SW.ChunkTicketType.create = function (n, c, e) { return new ChunkTicketType(n, c, e || 0); };
  SW.TicketTypes = {
    START: SW.ChunkTicketType.create('start', zero), DRAGON: SW.ChunkTicketType.create('dragon', zero),
    PLAYER: SW.ChunkTicketType.create('player', byPos), FORCED: SW.ChunkTicketType.create('forced', byPos),
    LIGHT: SW.ChunkTicketType.create('light', byPos),
    PORTAL: SW.ChunkTicketType.create('portal', function (a, b) { return cmpNum(a.y, b.y) || cmpNum(a.x, b.x) || cmpNum(a.z, b.z); }, 300),
    POST_TELEPORT: SW.ChunkTicketType.create('post_teleport', cmpNum, 5),
    UNKNOWN: SW.ChunkTicketType.create('unknown', byPos, 1)
  };
  var typeSeq = 0; Object.keys(SW.TicketTypes).forEach(function (k) { SW.TicketTypes[k].seq = typeSeq++; });

  // ChunkTicket: ordered by level, then type, then argument
  function ChunkTicket(type, level, arg) { this.type = type; this.level = level; this.argument = arg; this.tickCreated = 0; }
  ChunkTicket.prototype.compareTo = function (o) {
    return cmpNum(this.level, o.level) || cmpNum(this.type.seq, o.type.seq) || this.type.getArgumentComparator()(this.argument, o.argument);
  };
  ChunkTicket.prototype.equals = function (o) { return this === o || (o && this.level === o.level && this.type === o.type && this.type.getArgumentComparator()(this.argument, o.argument) === 0); };
  ChunkTicket.prototype.toString = function () { return 'Ticket[' + this.type + ' ' + this.level + ' (' + JSON.stringify(this.argument) + ')] at ' + this.tickCreated; };
  ChunkTicket.prototype.getType = function () { return this.type; };
  ChunkTicket.prototype.getLevel = function () { return this.level; };
  ChunkTicket.prototype.setTickCreated = function (t) { this.tickCreated = t; };
  ChunkTicket.prototype.isExpired = function (age) { var e = this.type.getExpiryTicks(); return e !== 0 && age - this.tickCreated > e; };
  SW.ChunkTicket = ChunkTicket;

  // SortedArraySet: sorted, no duplicates (compareTo === 0 keeps the existing one)
  function SortedSet() { this.a = []; }
  SortedSet.prototype.add = function (t) {
    for (var i = 0; i < this.a.length; i++) { var c = t.compareTo(this.a[i]); if (c === 0) return false; if (c < 0) { this.a.splice(i, 0, t); return true; } }
    this.a.push(t); return true;
  };
  SortedSet.prototype.remove = function (t) { for (var i = 0; i < this.a.length; i++) if (this.a[i].compareTo(t) === 0) { this.a.splice(i, 1); return true; } return false; };
  SortedSet.prototype.first = function () { return this.a[0]; };
  SortedSet.prototype.isEmpty = function () { return this.a.length === 0; };
  SW.SortedTicketSet = SortedSet;

  // LevelPrioritizedQueue
  var LEVEL_COUNT = SW.MAX_LEVEL + 2;
  function LevelPrioritizedQueue(name, maxBlocking) {
    this.name = name; this.maxBlocking = maxBlocking; this.levels = []; this.first = LEVEL_COUNT; this.blocking = {}; this.nBlocking = 0;
    for (var i = 0; i < LEVEL_COUNT; i++) this.levels.push(new Map());
  }
  LevelPrioritizedQueue.LEVEL_COUNT = LEVEL_COUNT;
  LevelPrioritizedQueue.prototype.hasQueuedElement = function () { return this.first < LEVEL_COUNT; };
  LevelPrioritizedQueue.prototype._skip = function () { while (this.hasQueuedElement() && this.levels[this.first].size === 0) this.first++; };
  LevelPrioritizedQueue.prototype.updateLevel = function (from, pos, to) {
    if (from < LEVEL_COUNT) {
      var m = this.levels[from], l = m.get(pos); m.delete(pos);
      if (from === this.first) this._skip();
      if (l && l.length) { var t = this.levels[to]; if (!t.has(pos)) t.set(pos, []); t.get(pos).push.apply(t.get(pos), l); this.first = Math.min(this.first, to); }
    }
  };
  LevelPrioritizedQueue.prototype.add = function (elem, pos, level) { var m = this.levels[level]; if (!m.has(pos)) m.set(pos, []); m.get(pos).push(elem); this.first = Math.min(this.first, level); };
  LevelPrioritizedQueue.prototype.remove = function (pos, all) {
    for (var i = 0; i < this.levels.length; i++) {
      var m = this.levels[i], l = m.get(pos);
      if (l) { if (all) l.length = 0; else { for (var j = l.length - 1; j >= 0; j--) if (l[j] == null) l.splice(j, 1); } if (!l.length) m.delete(pos); }
    }
    this._skip();
    if (this.blocking[pos]) { delete this.blocking[pos]; this.nBlocking--; }
  };
  // poll -> null, or a list of {left:task} / {right:blockingAdder}; elements are task or null (null = a blocking marker)
  LevelPrioritizedQueue.prototype.poll = function () {
    if (this.nBlocking >= this.maxBlocking || !this.hasQueuedElement()) return null;
    var m = this.levels[this.first], pos = m.keys().next().value, l = m.get(pos); m.delete(pos);
    this._skip();
    var self = this;
    return l.map(function (e) { return e != null ? { left: e } : { right: function () { if (!self.blocking[pos]) { self.blocking[pos] = 1; self.nBlocking++; } } }; });
  };
  LevelPrioritizedQueue.prototype.getBlockingChunks = function () { return Object.keys(this.blocking); };
  LevelPrioritizedQueue.prototype.toString = function () { return this.name + ' ' + this.first + '...'; };
  SW.LevelPrioritizedQueue = LevelPrioritizedQueue;

  // ChunkTaskPrioritySystem: one queue per actor; tasks run in level order. send() queues, run() drains.
  function ChunkTaskPrioritySystem(actors, maxQueued) {
    this.queues = new Map(); this.maxQueued = maxQueued | 0;
    var self = this; actors.forEach(function (a) { self.queues.set(a, new LevelPrioritizedQueue(a.name || 'actor', maxQueued)); });
  }
  ChunkTaskPrioritySystem.createMessage = function (fn, pos, levelSupplier) { return { fn: fn, pos: pos, lastLevelUpdatedToProvider: levelSupplier }; };
  ChunkTaskPrioritySystem.createUnblockingMessage = function (cb, pos, removeTask) { return { callback: cb, pos: pos, removeTask: !!removeTask }; };
  ChunkTaskPrioritySystem.prototype.getQueue = function (a) { var q = this.queues.get(a); if (!q) throw new Error('No queue for: ' + a); return q; };
  ChunkTaskPrioritySystem.prototype.send = function (actor, task) { this.getQueue(actor).add(task.fn, task.pos, task.lastLevelUpdatedToProvider()); };
  ChunkTaskPrioritySystem.prototype.updateLevel = function (actor, pos, from, to) { this.getQueue(actor).updateLevel(from, pos, to); };
  ChunkTaskPrioritySystem.prototype.unblock = function (actor, msg) { var q = this.getQueue(actor); q.remove(msg.pos, msg.removeTask); msg.callback && msg.callback(); };
  ChunkTaskPrioritySystem.prototype.run = function (actor) {
    var q = this.getQueue(actor), n = 0, p;
    while ((p = q.poll())) p.forEach(function (e) { if (e.left) { e.left(); n++; } else e.right(); });
    return n;
  };
  SW.ChunkTaskPrioritySystem = ChunkTaskPrioritySystem;

  // ChunkHolder level logic
  SW.LevelType = ['INACCESSIBLE', 'BORDER', 'TICKING', 'ENTITY_TICKING'];
  SW.levelTypeIsAfter = function (a, b) { return SW.LevelType.indexOf(a) >= SW.LevelType.indexOf(b); };
  SW.getLevelType = function (level) { return SW.LevelType[Math.max(0, Math.min(SW.LevelType.length - 1, 33 - level + 1))]; };
  SW.getTargetStatusForLevel = function (level) { return level < 33 ? 'full' : SW.byDistanceFromFull(level - 33); };
  SW.byDistanceFromFull = function (d) { return d >= SW.DISTANCE_TO_STATUS.length ? 'empty' : d < 0 ? 'full' : (SW.DISTANCE_TO_STATUS[d] || 'empty'); };
  SW.statusIsAtLeast = function (a, b) { return SW.STATUSES.indexOf(a) >= SW.STATUSES.indexOf(b); };
  function ChunkHolder(x, z, level, listener) {
    this.x = x; this.z = z; this.accessible = false; this.listener = listener || null;
    this.lastTickLevel = this.level = this.completedLevel = SW.MAX_LEVEL + 1;
    this.pendingBlockUpdates = false; this.blockUpdates = {};
    this.setLevel(level);
  }
  ChunkHolder.prototype.getLevel = function () { return this.level; };
  ChunkHolder.prototype.getLevelType = function () { return SW.getLevelType(this.level); };
  ChunkHolder.prototype.setLevel = function (level) { this.level = level; };
  ChunkHolder.prototype.updateAccessibleStatus = function () { this.accessible = SW.levelTypeIsAfter(SW.getLevelType(this.level), 'BORDER'); };
  ChunkHolder.prototype.isAccessible = function () { return this.accessible; };
  ChunkHolder.prototype.markForBlockUpdate = function (section, packed) { this.pendingBlockUpdates = true; (this.blockUpdates[section] = this.blockUpdates[section] || {})[packed] = 1; };
  ChunkHolder.prototype.tick = function () {
    var was = this.lastTickLevel <= SW.MAX_LEVEL, now = this.level <= SW.MAX_LEVEL;
    var oldT = SW.getLevelType(this.lastTickLevel), newT = SW.getLevelType(this.level);
    this.updateAccessibleStatus();
    this.lastTickLevel = this.level;
    return { loaded: !was && now, unloaded: was && !now, from: oldT, to: newT };
  };
  SW.ChunkHolder = ChunkHolder;

  // ChunkTicketManager: tickets by position, the level of a position is its best ticket
  function ChunkTicketManager() { this.tickets = new Map(); this.age = 0; this.holders = new Map(); }
  ChunkTicketManager.prototype.getTicketSet = function (key) { var s = this.tickets.get(key); if (!s) { s = new SortedSet(); this.tickets.set(key, s); } return s; };
  ChunkTicketManager.getLevel = function (set) { return !set.isEmpty() ? set.first().getLevel() : SW.MAX_LEVEL + 1; };
  ChunkTicketManager.prototype.addTicket = function (key, ticket) {
    var set = this.getTicketSet(key), old = set.isEmpty() ? SW.MAX_LEVEL + 1 : set.first().getLevel();
    var had = set.a.some(function (t) { return t.compareTo(ticket) === 0; });
    if (!had) set.add(ticket); else { set.remove(ticket); set.add(ticket); }
    ticket.setTickCreated(this.age);
    this._update(key, old);
  };
  ChunkTicketManager.prototype.removeTicket = function (key, ticket) {
    var set = this.getTicketSet(key), old = ChunkTicketManager.getLevel(set);
    set.remove(ticket); if (set.isEmpty()) this.tickets.delete(key);
    this._update(key, old);
  };
  ChunkTicketManager.prototype._update = function (key, oldLevel) {
    var lvl = this.getLevelAt(key), h = this.holders.get(key);
    if (lvl <= SW.MAX_LEVEL && !h) { var p = key.split(','); h = new ChunkHolder(+p[0], +p[1], lvl); this.holders.set(key, h); }
    else if (h) { h.setLevel(lvl); if (lvl > SW.MAX_LEVEL) this.holders.delete(key); }
  };
  ChunkTicketManager.prototype.getLevelAt = function (key) { var s = this.tickets.get(key); return s ? ChunkTicketManager.getLevel(s) : SW.MAX_LEVEL + 1; };
  ChunkTicketManager.prototype.purge = function () {
    this.age++;
    var self = this, keys = Array.from(this.tickets.keys());
    keys.forEach(function (k) {
      var s = self.tickets.get(k), old = ChunkTicketManager.getLevel(s), gone = false;
      for (var i = s.a.length - 1; i >= 0; i--) if (s.a[i].isExpired(self.age)) { s.a.splice(i, 1); gone = true; }
      if (s.isEmpty()) self.tickets.delete(k);
      if (gone) self._update(k, old);
    });
  };
  SW.ChunkTicketManager = ChunkTicketManager;
  SW.manager = new ChunkTicketManager();
  SW.tick = function () { SW.manager.purge(); };

  // PlayerChunkWatchingManager: player -> watch-disabled flag
  function PlayerChunkWatchingManager() { this.watching = new Map(); }
  PlayerChunkWatchingManager.prototype.getPlayersWatchingChunk = function () { return Array.from(this.watching.keys()); };
  PlayerChunkWatchingManager.prototype.add = function (pos, p, disabled) { this.watching.set(p, !!disabled); };
  PlayerChunkWatchingManager.prototype.remove = function (pos, p) { this.watching.delete(p); };
  PlayerChunkWatchingManager.prototype.disableWatch = function (p) { if (this.watching.has(p)) this.watching.set(p, true); };
  PlayerChunkWatchingManager.prototype.enableWatch = function (p) { if (this.watching.has(p)) this.watching.set(p, false); };
  PlayerChunkWatchingManager.prototype.isWatchInactive = function (p) { return this.watching.has(p) ? this.watching.get(p) : true; };
  PlayerChunkWatchingManager.prototype.isWatchDisabled = function (p) { return this.watching.has(p) ? this.watching.get(p) : false; };
  PlayerChunkWatchingManager.prototype.movePlayer = function () {};
  SW.PlayerChunkWatchingManager = PlayerChunkWatchingManager;

  // EntityTrackingListener: { getPlayer(), sendPacket(p) } - required members
  SW.EntityTrackingListener = function (impl) {
    if (!impl || typeof impl.getPlayer !== 'function' || typeof impl.sendPacket !== 'function') throw new Error('EntityTrackingListener needs getPlayer and sendPacket');
    return impl;
  };

  // EntityTrackingStatus (world/entity): fromLevelType
  SW.trackingFromLevelType = function (t) { return SW.levelTypeIsAfter(t, 'ENTITY_TICKING') ? 'TICKING' : SW.levelTypeIsAfter(t, 'BORDER') ? 'TRACKED' : 'HIDDEN'; };
  var shouldTrack = function (s) { return s !== 'HIDDEN'; }, shouldTick = function (s) { return s === 'TICKING'; };

  // ServerEntityManager: entities live in sections; a section's tracking status decides tracking/ticking
  function ServerEntityManager(handler) {
    this.handler = handler || {}; this.uuids = new Set(); this.sections = new Map(); this.sectionStatus = new Map(); this.entries = new Map();
    this.tracked = new Set(); this.ticking = new Set();
  }
  ServerEntityManager.secKey = function (x, y, z) { return (x >> 4) + ',' + (y >> 4) + ',' + (z >> 4); };
  ServerEntityManager.getNeededLoadStatus = function (e, s) { return e.isPlayer ? 'TICKING' : s; };
  ServerEntityManager.prototype.statusOf = function (k) { return this.sectionStatus.get(k) || 'HIDDEN'; };
  ServerEntityManager.prototype.addEntity = function (e) {
    if (this.uuids.has(e.uuid)) return false;
    this.uuids.add(e.uuid);
    var k = ServerEntityManager.secKey(e.x, e.y, e.z);
    if (!this.sections.has(k)) this.sections.set(k, new Set());
    this.sections.get(k).add(e); this.entries.set(e, k);
    if (this.handler.create) this.handler.create(e);
    var st = ServerEntityManager.getNeededLoadStatus(e, this.statusOf(k));
    if (shouldTrack(st)) this._startTracking(e); if (shouldTick(st)) this._startTicking(e);
    return true;
  };
  ServerEntityManager.prototype._startTracking = function (e) { if (this.tracked.add(e) && this.handler.startTracking) this.handler.startTracking(e); };
  ServerEntityManager.prototype._stopTracking = function (e) { if (this.tracked.delete(e) && this.handler.stopTracking) this.handler.stopTracking(e); };
  ServerEntityManager.prototype._startTicking = function (e) { if (this.ticking.add(e) && this.handler.startTicking) this.handler.startTicking(e); };
  ServerEntityManager.prototype._stopTicking = function (e) { if (this.ticking.delete(e) && this.handler.stopTicking) this.handler.stopTicking(e); };
  ServerEntityManager.prototype._leave = function (k, e) { var s = this.sections.get(k); s.delete(e); if (!s.size) this.sections.delete(k); };
  ServerEntityManager.prototype._applyStatus = function (e, from, to) {
    var a = ServerEntityManager.getNeededLoadStatus(e, from), b = ServerEntityManager.getNeededLoadStatus(e, to);
    if (a === b) return;
    if (shouldTrack(a) && !shouldTrack(b)) this._stopTracking(e); else if (!shouldTrack(a) && shouldTrack(b)) this._startTracking(e);
    if (shouldTick(a) && !shouldTick(b)) this._stopTicking(e); else if (!shouldTick(a) && shouldTick(b)) this._startTicking(e);
  };
  ServerEntityManager.prototype.updateEntityPosition = function (e) {
    var old = this.entries.get(e), k = ServerEntityManager.secKey(e.x, e.y, e.z);
    if (k === old) return;
    this._leave(old, e);
    if (!this.sections.has(k)) this.sections.set(k, new Set());
    this.sections.get(k).add(e); this.entries.set(e, k);
    this._applyStatus(e, this.statusOf(old), this.statusOf(k));
  };
  ServerEntityManager.prototype.updateTrackingStatus = function (secKeyStr, status) {
    var from = this.statusOf(secKeyStr); this.sectionStatus.set(secKeyStr, status);
    var self = this; (this.sections.get(secKeyStr) || []).forEach(function (e) { self._applyStatus(e, from, status); });
  };
  ServerEntityManager.prototype.removeEntity = function (e, destroy) {
    var k = this.entries.get(e); if (k === undefined) return false;
    this._leave(k, e); this.entries.delete(e);
    var st = ServerEntityManager.getNeededLoadStatus(e, this.statusOf(k));
    if (shouldTick(st)) this._stopTicking(e); if (shouldTrack(st)) this._stopTracking(e);
    if (destroy && this.handler.destroy) this.handler.destroy(e);
    this.uuids.delete(e.uuid); return true;
  };
  SW.ServerEntityManager = ServerEntityManager;

  // ServerLightingProvider: tasks queue per stage; runTasks runs every PRE_UPDATE, the light update, then POST_UPDATE
  function ServerLightingProvider(doLightUpdates) { this.pending = []; this.taskBatchSize = 5; this.doLightUpdates = doLightUpdates || function () {}; this.ticking = false; this.log = []; }
  ServerLightingProvider.Stage = { PRE_UPDATE: 'PRE_UPDATE', POST_UPDATE: 'POST_UPDATE' };
  ServerLightingProvider.prototype.enqueue = function (stage, fn) { this.pending.push([stage, fn]); if (this.pending.length >= this.taskBatchSize) this.runTasks(); };
  ServerLightingProvider.prototype.setTaskBatchSize = function (n) { this.taskBatchSize = n; };
  ServerLightingProvider.prototype.runTasks = function () {
    var n = Math.min(this.pending.length, this.taskBatchSize), i, p = this.pending;
    for (i = 0; i < n; i++) if (p[i][0] === 'PRE_UPDATE') p[i][1]();
    this.doLightUpdates();
    for (i = 0; i < n; i++) if (p[i][0] === 'POST_UPDATE') p[i][1]();
    p.splice(0, n);
  };
  ServerLightingProvider.prototype.tick = function () { if (this.pending.length && !this.ticking) { this.ticking = true; this.runTasks(); this.ticking = false; } };
  SW.ServerLightingProvider = ServerLightingProvider;
})(MCL);
