// NS.WorldState: net/minecraft/world ports (#11769), from .decomp. Cited: PersistentState PersistentStateManager IdCountsState
// ForcedChunkState ChunkUpdateState ChunkPosDistanceLevelPropagator SectionDistanceLevelPropagator SimulationDistanceLevelPropagator
// (over a port of chunk/light/LevelPropagator, their base) BlockStateRaycastContext MobSpawnerEntry StructurePresence Vibration
// timer/TimerCallback TimerCallbackSerializer FunctionTimerCallback FunctionTagTimerCallback dimension/YLevels.
// Chunk and section positions are BigInt longs. A PersistentStateManager stores .dat bytes (uncompressed NBT: gzip is not ported,
// as in 02n_nbt.js) in a {has,read,write} store instead of a File. A server for timer callbacks is {getFunction,getTag,execute}.
(function (NS) {
  'use strict';
  var W = NS.WorldState = {}, N = NS.Nbt;
  var M64 = (1n << 64n) - 1n;
  // ---- ChunkPos / ChunkSectionPos long packing
  var CP = W.ChunkPos = {
    toLong: function (x, z) { return (BigInt(x) & 0xFFFFFFFFn) | ((BigInt(z) & 0xFFFFFFFFn) << 32n); },
    x: function (l) { return Number(BigInt.asIntN(32, l)); }, z: function (l) { return Number(BigInt.asIntN(32, l >> 32n)); }
  };
  CP.MARKER = CP.toLong(1875066, 1875066);
  var SP = W.ChunkSectionPos = {
    asLong: function (x, y, z) { return ((BigInt(x) & 0x3FFFFFn) << 42n) | (BigInt(y) & 0xFFFFFn) | ((BigInt(z) & 0x3FFFFFn) << 20n); },
    unpackX: function (l) { return Number(BigInt.asIntN(22, l >> 42n)); },
    unpackY: function (l) { return Number(BigInt.asIntN(20, l)); },
    unpackZ: function (l) { return Number(BigInt.asIntN(22, l >> 20n)); }
  };
  SP.offset = function (l, dx, dy, dz) { return SP.asLong(SP.unpackX(l) + dx, SP.unpackY(l) + dy, SP.unpackZ(l) + dz); };
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // ---- LevelPropagator (abstract). Subclass supplies isMarker/recalculateLevel/propagateLevelFrom/getLevel/setLevel/getPropagatedLevel.
  function LevelPropagator(levelCount) {
    if (levelCount >= 254) throw new Error('Level count must be < 254.');
    this.levelCount = levelCount; this.pendingByLevel = []; this.pending = new Map(); this.minPendingLevel = levelCount; this.hasPending = false;
    for (var i = 0; i < levelCount; i++) this.pendingByLevel.push(new Set());
  }
  W.LevelPropagator = LevelPropagator;
  var LP = LevelPropagator.prototype;
  LP.pendingGet = function (id) { var v = this.pending.get(id); return v === undefined ? 255 : v; };
  LP.minLevel = function (a, b) { var r = a > b ? b : a; return r > this.levelCount - 1 ? this.levelCount - 1 : r; };
  LP.increaseMinPendingLevel = function (to) {
    var from = this.minPendingLevel; this.minPendingLevel = to;
    for (var i = from + 1; i < to; i++) if (this.pendingByLevel[i].size) { this.minPendingLevel = i; break; }
  };
  LP.removePendingUpdate = function (id) {
    var p = this.pendingGet(id);
    if (p !== 255) { this.removePending3(id, this.minLevel(this.getLevel(id), p), this.levelCount, true); this.hasPending = this.minPendingLevel < this.levelCount; }
  };
  LP.removePendingUpdateIf = function (pred) { var ks = []; this.pending.forEach(function (v, k) { if (pred(k)) ks.push(k); }); ks.forEach(this.removePendingUpdate, this); };
  LP.removePending3 = function (id, lvl, to, del) {
    if (del) this.pending.delete(id);
    this.pendingByLevel[lvl].delete(id);
    if (!this.pendingByLevel[lvl].size && this.minPendingLevel === lvl) this.increaseMinPendingLevel(to);
  };
  LP.addPendingUpdate = function (id, v, lvl) {
    this.pending.set(id, v); this.pendingByLevel[lvl].add(id);
    if (this.minPendingLevel > lvl) this.minPendingLevel = lvl;
  };
  LP.resetLevel = function (id) { this.updateLevel(id, id, this.levelCount - 1, false); };
  LP.updateLevel = function (src, id, lvl, decrease) {
    this.updateLevel6(src, id, lvl, this.getLevel(id), this.pendingGet(id), decrease);
    this.hasPending = this.minPendingLevel < this.levelCount;
  };
  LP.updateLevel6 = function (src, id, lvl, cur, pend, decrease) {
    if (this.isMarker(id)) return;
    var max = this.levelCount - 1; lvl = clamp(lvl, 0, max); cur = clamp(cur, 0, max);
    var fresh = false; if (pend === 255) { fresh = true; pend = cur; }
    var target = decrease ? Math.min(pend, lvl) : clamp(this.recalculateLevel(id, src, lvl), 0, max);
    var old = this.minLevel(cur, pend);
    if (cur !== target) {
      var nw = this.minLevel(cur, target);
      if (old !== nw && !fresh) this.removePending3(id, old, nw, false);
      this.addPendingUpdate(id, target, nw);
    } else if (!fresh) this.removePending3(id, old, this.levelCount, true);
  };
  LP.propagateLevel4 = function (src, id, lvl, decrease) {
    var pend = this.pendingGet(id), max = this.levelCount - 1, nl = clamp(this.getPropagatedLevel(src, id, lvl), 0, max);
    if (decrease) this.updateLevel6(src, id, nl, this.getLevel(id), pend, true);
    else {
      var base, fresh;
      if (pend === 255) { fresh = true; base = clamp(this.getLevel(id), 0, max); } else { base = pend; fresh = false; }
      if (nl === base) this.updateLevel6(src, id, max, fresh ? base : this.getLevel(id), pend, false);
    }
  };
  LP.hasPendingUpdates = function () { return this.hasPending; };
  LP.getPendingUpdateCount = function () { return this.pending.size; };
  LP.applyPendingUpdates = function (n) {
    if (this.minPendingLevel >= this.levelCount) return n;
    while (this.minPendingLevel < this.levelCount && n > 0) {
      n--;
      var set = this.pendingByLevel[this.minPendingLevel], id = set.values().next().value; set.delete(id);
      var cur = clamp(this.getLevel(id), 0, this.levelCount - 1);
      if (!set.size) this.increaseMinPendingLevel(this.levelCount);
      var p = this.pendingGet(id); this.pending.delete(id);
      if (p < cur) { this.setLevel(id, p); this.propagateLevel(id, p, true); }
      else if (p > cur) { this.addPendingUpdate(id, p, this.minLevel(this.levelCount - 1, p)); this.setLevel(id, this.levelCount - 1); this.propagateLevel(id, cur, false); }
    }
    this.hasPending = this.minPendingLevel < this.levelCount;
    return n;
  };
  function extend(Base, ctor) { ctor.prototype = Object.create(Base.prototype); ctor.prototype.constructor = ctor; return ctor; }

  // ---- ChunkPosDistanceLevelPropagator (3x3 neighbourhood)
  var CPD = W.ChunkPosDistanceLevelPropagator = extend(LevelPropagator, function (lc) { LevelPropagator.call(this, lc); });
  CPD.prototype.isMarker = function (l) { return l === CP.MARKER; };
  CPD.prototype.propagateLevel = function (l, lvl, dec) {
    var x = CP.x(l), z = CP.z(l);
    for (var dx = -1; dx <= 1; dx++) for (var dz = -1; dz <= 1; dz++) { var n = CP.toLong(x + dx, z + dz); if (n !== l) this.propagateLevel4(l, n, lvl, dec); }
  };
  CPD.prototype.recalculateLevel = function (id, excl, lvl) {
    var best = lvl, x = CP.x(id), z = CP.z(id);
    for (var dx = -1; dx <= 1; dx++) for (var dz = -1; dz <= 1; dz++) {
      var n = CP.toLong(x + dx, z + dz); if (n === id) n = CP.MARKER;
      if (n !== excl) { var v = this.getPropagatedLevel(n, id, this.getLevel(n)); if (best > v) best = v; if (best === 0) return best; }
    }
    return best;
  };
  CPD.prototype.getPropagatedLevel = function (from, to, lvl) { return from === CP.MARKER ? this.getInitialLevel(to) : lvl + 1; };
  CPD.prototype.updateChunkLevel = function (l, lvl, dec) { this.updateLevel(CP.MARKER, l, lvl, dec); };

  // ---- SectionDistanceLevelPropagator (3x3x3)
  var SDL = W.SectionDistanceLevelPropagator = extend(LevelPropagator, function (lc) { LevelPropagator.call(this, lc); });
  var SMARK = (1n << 63n) - 1n;
  SDL.prototype.isMarker = function (l) { return l === SMARK; };
  SDL.prototype.propagateLevel = function (l, lvl, dec) {
    for (var a = -1; a <= 1; a++) for (var b = -1; b <= 1; b++) for (var c = -1; c <= 1; c++) { var n = SP.offset(l, a, b, c); if (n !== l) this.propagateLevel4(l, n, lvl, dec); }
  };
  SDL.prototype.recalculateLevel = function (id, excl, lvl) {
    var best = lvl;
    for (var a = -1; a <= 1; a++) for (var b = -1; b <= 1; b++) for (var c = -1; c <= 1; c++) {
      var n = SP.offset(id, a, b, c); if (n === id) n = SMARK;
      if (n !== excl) { var v = this.getPropagatedLevel(n, id, this.getLevel(n)); if (best > v) best = v; if (best === 0) return best; }
    }
    return best;
  };
  SDL.prototype.getPropagatedLevel = function (from, to, lvl) { return from === SMARK ? this.getInitialLevel(to) : lvl + 1; };
  SDL.prototype.update = function (l, lvl, dec) { this.updateLevel(SMARK, l, lvl, dec); };

  // ---- SimulationDistanceLevelPropagator (tickets: {type, level, arg}, kept sorted by level)
  var SIM = W.SimulationDistanceLevelPropagator = extend(CPD, function () { CPD.call(this, 34); this.levels = new Map(); this.tickets = new Map(); });
  W.ChunkTicket = function (type, level, arg) { return { type: type, level: level, arg: arg }; };
  function tEq(a, b) { return a.type === b.type && a.level === b.level && a.arg === b.arg; }
  SIM.prototype.getTickets = function (l) { var t = this.tickets.get(l); if (!t) this.tickets.set(l, t = []); return t; };
  function topLevel(t) { return t.length ? t[0].level : 34; }
  SIM.prototype.add = function (l, tk) {
    var t = this.getTickets(l), old = topLevel(t);
    if (!t.some(function (x) { return tEq(x, tk); })) { t.push(tk); t.sort(function (a, b) { return a.level - b.level; }); }
    if (tk.level < old) this.updateChunkLevel(l, tk.level, true);
  };
  SIM.prototype.remove = function (l, tk) {
    var t = this.getTickets(l), i = t.findIndex(function (x) { return tEq(x, tk); }); if (i >= 0) t.splice(i, 1);
    if (!t.length) this.tickets.delete(l);
    this.updateChunkLevel(l, topLevel(t), false);
  };
  SIM.prototype.updatePlayerTickets = function (lvl) {
    var list = []; this.tickets.forEach(function (ts, k) { ts.forEach(function (x) { if (x.type === 'player') list.push([x, k]); }); });
    list.forEach(function (p) { this.remove(p[1], p[0]); this.add(p[1], W.ChunkTicket('player', lvl, p[1])); }, this);
  };
  SIM.prototype.getInitialLevel = function (l) { var t = this.tickets.get(l); return t && t.length ? t[0].level : 2147483647; };
  SIM.prototype.getLevel = function (l) { var v = this.levels.get(l); return v === undefined ? 33 : v; };
  SIM.prototype.setLevel = function (l, v) { if (v > 33) this.levels.delete(l); else this.levels.set(l, v); };
  SIM.prototype.updateLevels = function () { this.applyPendingUpdates(2147483647); };
  SIM.prototype.getTickingTicket = function (l) { var t = this.tickets.get(l); return t && t.length ? t[0].type + '/' + t[0].level : 'no_ticket'; };

  // ---- PersistentState family. A state is {writeNbt(c) -> c, dirty}.
  function PersistentState() { this.dirty = false; }
  W.PersistentState = PersistentState;
  PersistentState.prototype.markDirty = function () { this.setDirty(true); };
  PersistentState.prototype.setDirty = function (d) { this.dirty = d; };
  PersistentState.prototype.isDirty = function () { return this.dirty; };
  PersistentState.prototype.save = function (store, name) {
    if (!this.isDirty()) return;
    var root = N.compound(); N.put(root, 'data', this.writeNbt(N.compound())); N.put(root, 'DataVersion', N.int(2975));
    store.write(name, N.write(root)); this.setDirty(false);
  };
  function longSet(tag, key) { var s = new Set(); var t = tag.value.get(key); if (t) t.value.forEach(function (v) { s.add(BigInt.asIntN(64, v)); }); return s; }
  var IdCounts = W.IdCountsState = extend(PersistentState, function () { PersistentState.call(this); this.idCounts = new Map(); });
  IdCounts.IDCOUNTS_KEY = 'idcounts';
  IdCounts.fromNbt = function (c) { var s = new IdCounts(); c.value.forEach(function (v, k) { if (N.isNumber(v)) s.idCounts.set(k, N.intValue(v)); }); return s; };
  IdCounts.prototype.writeNbt = function (c) { this.idCounts.forEach(function (v, k) { N.put(c, k, N.int(v)); }); return c; };
  IdCounts.prototype.getNextMapId = function () { var v = (this.idCounts.has('map') ? this.idCounts.get('map') : -1) + 1; this.idCounts.set('map', v); this.markDirty(); return v; };
  var Forced = W.ForcedChunkState = extend(PersistentState, function (set) { PersistentState.call(this); this.chunks = set || new Set(); });
  Forced.CHUNKS_KEY = 'chunks';
  Forced.fromNbt = function (c) { return new Forced(longSet(c, 'Forced')); };
  Forced.prototype.writeNbt = function (c) { N.put(c, 'Forced', N.longArray(Array.from(this.chunks))); return c; };
  Forced.prototype.getChunks = function () { return this.chunks; };
  var CUS = W.ChunkUpdateState = extend(PersistentState, function (all, rem) { PersistentState.call(this); this.all = all || new Set(); this.remaining = rem || new Set(); });
  CUS.fromNbt = function (c) { return new CUS(longSet(c, 'All'), longSet(c, 'Remaining')); };
  CUS.prototype.writeNbt = function (c) { N.put(c, 'All', N.longArray(Array.from(this.all))); N.put(c, 'Remaining', N.longArray(Array.from(this.remaining))); return c; };
  CUS.prototype.add = function (l) { this.all.add(l); this.remaining.add(l); };
  CUS.prototype.contains = function (l) { return this.all.has(l); };
  CUS.prototype.isRemaining = function (l) { return this.remaining.has(l); };
  CUS.prototype.markResolved = function (l) { this.remaining.delete(l); };
  CUS.prototype.getAll = function () { return this.all; };

  // PersistentStateManager(store): store = {has(name), read(name) -> u8, write(name, u8)}; names are the file stems (".dat").
  var PSM = W.PersistentStateManager = function (store) { this.store = store; this.loaded = new Map(); };
  PSM.prototype.getOrCreate = function (fromNbt, create, name) {
    var s = this.get(fromNbt, name); if (s) return s;
    s = create(); this.set(name, s); return s;
  };
  PSM.prototype.get = function (fromNbt, name) {
    var s = this.loaded.get(name);
    if (s === undefined && !this.loaded.has(name)) { s = this.readFromFile(fromNbt, name); this.loaded.set(name, s); }
    return s || null;
  };
  PSM.prototype.readFromFile = function (fromNbt, name) {
    try { if (this.store.has(name)) return fromNbt(N.get(this.readNbt(name), 'data') || N.compound()); } catch (e) { /* logged in vanilla */ }
    return null;
  };
  PSM.prototype.set = function (name, s) { this.loaded.set(name, s); };
  PSM.prototype.readNbt = function (name) { return N.read(this.store.read(name)); };
  PSM.prototype.save = function () { var st = this.store; this.loaded.forEach(function (s, name) { if (s) s.save(st, name); }); };

  // ---- small value classes
  W.YLevels = { OVERWORLD_MIN_Y: -64, OVERWORLD_HEIGHT: 384, OVERWORLD_GENERATION_HEIGHT: 384, OVERWORLD_LOGICAL_HEIGHT: 384,
    NETHER_MIN_Y: 0, NETHER_HEIGHT: 256, NETHER_GENERATION_HEIGHT: 128, NETHER_LOGICAL_HEIGHT: 128,
    END_MIN_Y: 0, END_HEIGHT: 256, END_GENERATION_HEIGHT: 128, END_LOGICAL_HEIGHT: 256 };
  W.StructurePresence = { field_36239: 0, field_36240: 1, field_36241: 2 };   // unmapped constants in Yarn 1.18.2: kept by name and ordinal
  W.BlockStateRaycastContext = function (start, end, pred) { return { getStart: function () { return start; }, getEnd: function () { return end; }, getStatePredicate: function () { return pred; } }; };
  W.Vibration = function (origin, destination, arrivalInTicks) {
    return { getOrigin: function () { return origin; }, getDestination: function () { return destination; }, getArrivalInTicks: function () { return arrivalInTicks; } };
  };
  // MobSpawnerEntry: entity is an NbtCompound; custom rules {blockLightLimit:[min,max], skyLightLimit:[min,max]} or null.
  W.MobSpawnerEntry = function (entity, rules) {
    entity = entity || N.compound();
    var id = N.get(entity, 'id'), s = id ? String(id.value) : '', ok = /^([a-z0-9_.-]*:)?[a-z0-9_./-]+$/.test(s);
    if (!id) { s = ''; ok = false; }
    var full = ok ? (s.indexOf(':') < 0 ? 'minecraft:' + s : (s[0] === ':' ? 'minecraft' + s : s)) : 'minecraft:pig';
    if (!id && entity.value.size === 0) full = 'minecraft:pig';
    N.put(entity, 'id', N.string(full));
    return { entity: entity, customSpawnRules: rules || null, getNbt: function () { return entity; }, getCustomSpawnRules: function () { return rules || null; } };
  };
  W.MobSpawnerEntry.DEFAULT_ENTITY_ID = 'minecraft:pig';
  W.MobSpawnerEntry.validateRange = function (r) { return r[0] >= 0 && r[1] <= 15 && r[0] <= r[1]; };

  // ---- timer callbacks
  W.FunctionTimerCallback = function (name) { return { name: name, kind: 'function', call: function (server) { var f = server.getFunction(name); if (f) server.execute(f); } }; };
  W.FunctionTagTimerCallback = function (name) { return { name: name, kind: 'function_tag', call: function (server) { server.getTag(name).forEach(function (f) { server.execute(f); }); } }; };
  var TCS = W.TimerCallbackSerializer = function () { this.byType = new Map(); };
  TCS.prototype.registerSerializer = function (id, ctor) { this.byType.set(id, ctor); return this; };
  TCS.prototype.serialize = function (cb) {
    var c = N.compound(); N.put(c, 'Name', N.string(cb.name)); N.put(c, 'Type', N.string('minecraft:' + cb.kind)); return c;
  };
  TCS.prototype.deserialize = function (c) {
    var t = N.get(c, 'Type'), ctor = t && this.byType.get(String(t.value).replace(/^minecraft:/, ''));
    if (!ctor) return null;
    var n = N.get(c, 'Name'); return ctor(n ? String(n.value) : '');
  };
  TCS.INSTANCE = new TCS().registerSerializer('function', W.FunctionTimerCallback).registerSerializer('function_tag', W.FunctionTagTimerCallback);
})(MCL);
