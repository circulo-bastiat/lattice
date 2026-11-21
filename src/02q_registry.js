// NS.UtilRegistry: net/minecraft/util/registry ports (#11766), from .decomp. RegistryKey RegistryEntry(Direct/Reference)
//  RegistryEntryList(Direct/Named) Registry(base) MutableRegistry SimpleRegistry DefaultedRegistry BuiltinRegistries
//  DynamicRegistryManager(Immutable/Mutable impls) RegistryFixedCodec RegistryEntryListCodec RegistryCodecs(entryList/createRegistryCodec).
// Duck types: Identifier = "ns:path" string; Optional = value|null; Lifecycle = 'stable'|'experimental'|'deprecated' (add = worst);
//  TagKey = object with .id (identity-keyed); DataResult = {value}|{error}; Codec = {encode(v,ops,prefix), decode(ops,input)->DataResult({first,second})};
//  ops = {getRegistry(key)->Registry|null, createString(s), getString(t)->DataResult, createList/getList}. Not ported: DFU Dynamic/Lifecycle
//  classes, the RegistryLoader/EntryLoader JSON path (needs the datapack codecs), Logger output, Spliterator/Stream (arrays instead).
(function (NS) {
  'use strict';
  var R = NS.UtilRegistry = {};
  var ok = function (v) { return { value: v }; }, err = function (m) { return { error: m }; };
  R.errors = [];
  R.DataResult = { success: ok, error: err };
  // Lifecycle.add: stable < experimental < deprecated(worst wins).
  var LC = { stable: 0, experimental: 1, deprecated: 2 };
  R.Lifecycle = { add: function (a, b) { return LC[a] >= LC[b] ? a : b; } };

  // ---- RegistryKey: interned by "registry:value"; identity comparison is valid.
  var INST = new Map();
  function keyOf(reg, val) {
    var s = reg + ':' + val, k = INST.get(s);
    if (!k) { k = { registry: reg, value: val }; k.getValue = function () { return val; }; k.getRegistry = function () { return reg; };
      k.toString = function () { return 'ResourceKey[' + reg + ' / ' + val + ']'; };
      k.isOf = function (o) { return reg === o.value; };
      k.tryCast = function (o) { return k.isOf(o) ? k : null; };
      INST.set(s, k); }
    return k;
  }
  var ROOT_ID = 'minecraft:root';
  R.RegistryKey = { of: function (regKey, id) { return keyOf(regKey.value, id); }, ofRegistry: function (id) { return keyOf(ROOT_ID, id); },
    createKeyFactory: function (regKey) { return function (id) { return keyOf(regKey.value, id); }; },
    createCodec: function (regKey) { return { encode: function (k, ops) { return ok(ops.createString(k.value)); },
      decode: function (ops, t) { var r = ops.getString(t); return r.error ? r : ok({ first: keyOf(regKey.value, r.value), second: t }); } }; } };

  // ---- RegistryEntry
  var TYPE = { REFERENCE: 'REFERENCE', DIRECT: 'DIRECT' };
  R.RegistryEntryType = TYPE;
  function direct(v) {
    return { value: v, hasKeyAndValue: function () { return true; }, matchesId: function () { return false; }, matchesKey: function () { return false; },
      isIn: function () { return false; }, matches: function () { return false; }, getKeyOrValue: function () { return { right: v }; },
      getKey: function () { return null; }, getType: function () { return TYPE.DIRECT; }, matchesRegistry: function () { return true; },
      streamTags: function () { return []; }, isDirect: true, toString: function () { return 'Direct{' + v + '}'; } };
  }
  function reference(refType, registry, key, value) {
    var e = { isReference: true, tags: new Set() };
    e.registryKey = function () { if (key == null) throw new Error("Trying to access unbound value '" + value + "' from registry " + registry); return key; };
    e.getValue = function () { if (value == null) throw new Error("Trying to access unbound value '" + key + "' from registry " + registry); return value; };
    Object.defineProperty(e, 'value', { get: function () { return e.getValue(); } });
    e.matchesId = function (id) { return e.registryKey().value === id; };
    e.matchesKey = function (k) { return e.registryKey() === k; };
    e.isIn = function (t) { return e.tags.has(t); };
    e.matches = function (p) { return p(e.registryKey()); };
    e.matchesRegistry = function (r) { return registry === r; };
    e.getKeyOrValue = function () { return { left: e.registryKey() }; };
    e.getKey = function () { return e.registryKey(); };
    e.getType = function () { return TYPE.REFERENCE; };
    e.hasKeyAndValue = function () { return key != null && value != null; };
    e.setKeyAndValue = function (k, v) {
      if (key != null && k !== key) throw new Error("Can't change holder key: existing=" + key + ', new=' + k);
      if (refType === 'INTRUSIVE' && value !== v) throw new Error("Can't change holder " + k + ' value: existing=' + value + ', new=' + v);
      key = k; value = v;
    };
    e.setTags = function (c) { e.tags = new Set(c); };
    e.streamTags = function () { return Array.from(e.tags); };
    e.toString = function () { return 'Reference{' + key + '=' + value + '}'; };
    return e;
  }
  R.RegistryEntry = { of: direct, upcast: function (e) { return e; }, Direct: direct,
    Reference: { standAlone: function (r, k) { return reference('STAND_ALONE', r, k, null); }, intrusive: function (r, v) { return reference('INTRUSIVE', r, null, v); } } };

  // ---- RegistryEntryList
  function shuffleRandom(list, rnd) { return list.length ? list[Math.floor(rnd() * list.length)] : null; }
  function listBacked(getEntries) {
    return { size: function () { return getEntries().length; }, stream: function () { return getEntries().slice(); },
      iterator: function () { return getEntries()[Symbol.iterator](); }, get: function (i) { var l = getEntries(); if (i < 0 || i >= l.length) throw new RangeError('Index ' + i); return l[i]; },
      getRandom: function (rnd) { return shuffleRandom(getEntries(), rnd); }, getEntries: getEntries };
  }
  function directList(entries) {
    var set = null, l = listBacked(function () { return entries; });
    l.getStorage = function () { return { right: entries }; };
    l.contains = function (e) { if (!set) set = new Set(entries); return set.has(e); };
    l.isOf = function () { return true; };
    l.toString = function () { return 'DirectSet[' + entries.join(', ') + ']'; };
    return l;
  }
  function namedList(registry, tag) {
    var entries = [], l = listBacked(function () { return entries; });
    l.copyOf = function (a) { entries = a.slice(); };
    l.getTag = function () { return tag; };
    l.getStorage = function () { return { left: tag }; };
    l.contains = function (e) { return e.isIn(tag); };
    l.isOf = function (r) { return registry === r; };
    l.toString = function () { return 'NamedSet(' + tag.id + ')[' + entries.join(', ') + ']'; };
    return l;
  }
  R.RegistryEntryList = { Direct: directList, Named: namedList,
    of: function (a) { return directList(Array.isArray(a) ? a.slice() : Array.prototype.slice.call(arguments)); },
    ofMapped: function (fn, a) { return directList(a.map(fn)); } };

  // ---- Registry (base) + MutableRegistry + SimpleRegistry + DefaultedRegistry
  function simpleRegistry(registryKey, lifecycle, valueToEntryFn) {
    var rawIdToEntry = [], entryToRawId = new Map(), idToEntry = new Map(), keyToEntry = new Map(), valueToEntry = new Map(), entryToLifecycle = new Map();
    var tagToEntryList = new Map(), frozen = false, unfrozen = valueToEntryFn ? new Map() : null, cached = null, nextId = 0, self = {};
    self.registryKey = registryKey; self.isSimple = true;
    function getEntries() { if (!cached) cached = rawIdToEntry.filter(function (e) { return e != null; }); return cached; }
    function assertNotFrozen(k) { if (frozen) throw new Error('Registry is already frozen (trying to add key ' + k + ')'); }
    function val(e) { return e != null ? e.getValue() : null; }
    function set5(id, key, value, lc, checkDupKey) {
      assertNotFrozen(key);
      if (key == null) throw new Error('The validated object is null'); if (value == null) throw new Error('The validated object is null');
      while (rawIdToEntry.length < id + 1) rawIdToEntry.push(undefined);
      entryToRawId.set(value, id); cached = null;
      // Util.error: logs only (throws just under SharedConstants.isDevelopment), so the add proceeds; R.errors records it.
      if (checkDupKey && keyToEntry.has(key)) R.errors.push("Adding duplicate key '" + key + "' to registry");
      if (valueToEntry.has(value)) R.errors.push("Adding duplicate value '" + value + "' to registry");
      entryToLifecycle.set(value, lc); lifecycle = R.Lifecycle.add(lifecycle, lc);
      if (nextId <= id) nextId = id + 1;
      var h;
      if (valueToEntryFn) { h = valueToEntryFn(value); var o = keyToEntry.get(key); keyToEntry.set(key, h); if (o != null && o !== h) throw new Error('Invalid holder present for key ' + key); }
      else { h = keyToEntry.get(key); if (!h) { h = reference('STAND_ALONE', self, key, null); keyToEntry.set(key, h); } }
      idToEntry.set(key.value, h); valueToEntry.set(value, h); h.setKeyAndValue(key, value); rawIdToEntry[id] = h;
      return h;
    }
    self.set = function (id, key, v, lc) { return set5(id, key, v, lc, true); };
    self.add = function (key, v, lc) { return self.set(nextId, key, v, lc); };
    self.replace = function (optId, key, v, lc) {
      assertNotFrozen(key);
      var old = keyToEntry.get(key), ov = old != null && old.hasKeyAndValue() ? old.getValue() : null, id;
      if (ov == null) id = optId != null ? optId : nextId;
      else { id = entryToRawId.get(ov); if (optId != null && optId !== id) throw new Error('ID mismatch'); entryToLifecycle.delete(ov); entryToRawId.delete(ov); valueToEntry.delete(ov); }
      return set5(id, key, v, lc, false);
    };
    self.getKey = function (v) { if (arguments.length === 0) return registryKey; var e = valueToEntry.get(v); return e ? e.registryKey() : null; };
    self.getId = function (v) { var e = valueToEntry.get(v); return e ? e.registryKey().value : null; };
    self.getRawId = function (v) { return v == null || !entryToRawId.has(v) ? -1 : entryToRawId.get(v); };
    self.get = function (x) {
      if (typeof x === 'number') return x >= 0 && x < rawIdToEntry.length ? val(rawIdToEntry[x]) : null;
      if (typeof x === 'string') return val(idToEntry.get(x));
      return val(keyToEntry.get(x));
    };
    self.getEntry = function (x) { if (typeof x === 'number') return x >= 0 && x < rawIdToEntry.length ? rawIdToEntry[x] || null : null; return keyToEntry.get(x) || null; };
    self.getOrCreateEntry = function (k) {
      var e = keyToEntry.get(k); if (e) return e;
      if (valueToEntryFn) throw new Error("This registry can't create new holders without value");
      assertNotFrozen(k); e = reference('STAND_ALONE', self, k, null); keyToEntry.set(k, e); return e;
    };
    self.size = function () { return keyToEntry.size; };
    self.isEmpty = function () { return keyToEntry.size === 0; };
    self.getEntryLifecycle = function (v) { return entryToLifecycle.get(v); };
    self.getLifecycle = function () { return lifecycle; };
    self.iterator = function () { return getEntries().map(function (e) { return e.getValue(); })[Symbol.iterator](); };
    self[Symbol.iterator] = self.iterator;
    self.stream = function () { return getEntries().map(function (e) { return e.getValue(); }); };
    self.getOrEmpty = function (x) { return self.get(x); };
    self.getOrThrow = function (k) { var v = self.get(k); if (v == null) throw new Error('Missing key in ' + registryKey + ': ' + k); return v; };
    self.getIds = function () { return new Set(idToEntry.keys()); };
    self.getEntrySet = function () { var o = []; keyToEntry.forEach(function (e, k) { o.push([k, e.getValue()]); }); return o; };
    self.streamEntries = function () { return getEntries().slice(); };
    self.entryOf = function (k) { var e = keyToEntry.get(k); if (!e) throw new Error('Missing key in ' + registryKey + ': ' + k); return e; };
    self.containsTag = function (t) { return tagToEntryList.has(t); };
    self.streamTagsAndEntries = function () { return Array.from(tagToEntryList.entries()); };
    self.streamTags = function () { return Array.from(tagToEntryList.keys()); };
    self.getOrCreateEntryList = function (t) { var l = tagToEntryList.get(t); if (!l) { l = namedList(self, t); tagToEntryList = new Map(tagToEntryList); tagToEntryList.set(t, l); } return l; };
    self.getEntryList = function (t) { return tagToEntryList.get(t) || null; };
    self.iterateEntries = function (t) { var l = tagToEntryList.get(t); return l ? l.getEntries() : []; };
    self.getRandom = function (rnd) { return shuffleRandom(getEntries(), rnd); };
    self.containsId = function (id) { return idToEntry.has(id); };
    self.contains = function (k) { return keyToEntry.has(k); };
    self.freeze = function () {
      frozen = true;
      var unbound = []; keyToEntry.forEach(function (e, k) { if (!e.hasKeyAndValue()) unbound.push(k.value); }); unbound.sort();
      if (unbound.length) throw new Error('Unbound values in registry ' + registryKey + ': [' + unbound.join(', ') + ']');
      if (unfrozen) { var bad = Array.from(unfrozen.values()).filter(function (e) { return !e.hasKeyAndValue(); });
        if (bad.length) throw new Error('Some intrusive holders were not added to registry: [' + bad.join(', ') + ']'); unfrozen = null; }
      return self;
    };
    self.createEntry = function (v) {
      if (!valueToEntryFn) throw new Error("This registry can't create intrusive holders");
      if (frozen || !unfrozen) throw new Error('Registry is already frozen');
      var e = unfrozen.get(v); if (!e) { e = reference('INTRUSIVE', self, null, v); unfrozen.set(v, e); } return e;
    };
    self.populateTags = function (map) {
      var back = new Map(); keyToEntry.forEach(function (e) { back.set(e, []); });
      map.forEach(function (list, tag) { list.forEach(function (e) {
        if (!e.matchesRegistry(self)) throw new Error("Can't create named set " + tag.id + ' containing value ' + e + ' from outside registry ' + self);
        if (!e.isReference) throw new Error('Found direct holder ' + e + ' value in tag ' + tag.id);
        back.get(e).push(tag); }); });
      var next = new Map(tagToEntryList);
      map.forEach(function (list, tag) { var n = next.get(tag); if (!n) { n = namedList(self, tag); next.set(tag, n); } n.copyOf(list); });
      back.forEach(function (tags, e) { e.setTags(tags); });
      tagToEntryList = next;
    };
    self.clearTags = function () { tagToEntryList.forEach(function (l) { l.copyOf([]); }); keyToEntry.forEach(function (e) { e.setTags([]); }); };
    self.getIndexedEntries = function () { return { getRawId: function (e) { return self.getRawId(e.getValue()); }, get: function (i) { return self.getEntry(i); }, size: self.size }; };
    self.toString = function () { return 'Registry[' + registryKey + ' (' + lifecycle + ')]'; };
    return self;
  }
  R.SimpleRegistry = simpleRegistry;
  R.MutableRegistry = { isMutable: function (r) { return !!(r && r.set && r.add && r.replace && r.isEmpty); } };

  // DefaultedRegistry: unknown id/value/rawId fall back to the default entry (set when its id is registered).
  R.DefaultedRegistry = function (defaultId, registryKey, lifecycle, fn) {
    var s = simpleRegistry(registryKey, lifecycle, fn), defaultEntry = null;
    var set = s.set, getRawId = s.getRawId, getId = s.getId, get = s.get, getRandom = s.getRandom;
    s.set = function (id, key, v, lc) { var e = set(id, key, v, lc); if (defaultId === key.value) defaultEntry = e; return e; };
    s.getRawId = function (v) { var i = getRawId(v); return i === -1 ? getRawId(defaultEntry.getValue()) : i; };
    s.getId = function (v) { var i = getId(v); return i == null ? defaultId : i; };
    s.get = function (x) { var v = get(x); return v == null ? defaultEntry.getValue() : v; };
    s.getOrEmpty = function (x) { return get(x); };
    s.getRandom = function (rnd) { return getRandom(rnd) || defaultEntry; };
    s.getDefaultId = function () { return defaultId; };
    return s;
  };

  // ---- Codecs
  R.RegistryFixedCodec = { of: function (regKey) {
    return {
      toString: function () { return 'RegistryFixedCodec[' + regKey + ']'; },
      encode: function (entry, ops) {
        var reg = ops.getRegistry && ops.getRegistry(regKey);
        if (reg) {
          if (!entry.matchesRegistry(reg)) return err('Element ' + entry + ' is not valid in current registry set');
          var kv = entry.getKeyOrValue();
          return kv.left ? ok(ops.createString(kv.left.value)) : err('Elements from registry ' + regKey + " can't be serialized to a value");
        }
        return err("Can't access registry " + regKey);
      },
      decode: function (ops, t) {
        var reg = ops.getRegistry && ops.getRegistry(regKey);
        if (reg) { var s = ops.getString(t); if (s.error) return s; return ok({ first: reg.getOrCreateEntry(keyOf(regKey.value, s.value)), second: t }); }
        return err("Can't access registry " + regKey);
      } }; } };
  function listOf(c) {
    return { encode: function (l, ops) { var out = []; for (var i = 0; i < l.length; i++) { var r = c.encode(l[i], ops); if (r.error) return r; out.push(r.value); } return ok(ops.createList(out)); },
      decode: function (ops, t) { var lr = ops.getList(t); if (lr.error) return lr; var out = []; for (var i = 0; i < lr.value.length; i++) { var r = c.decode(ops, lr.value[i]); if (r.error) return r; out.push(r.value.first); } return ok({ first: out, second: t }); } };
  }
  function sameType(l) { for (var i = 1; i < l.length; i++) if (l[i].getType() !== l[0].getType()) return err('Mixed type list: element ' + l[i] + ' had type ' + l[i].getType() + ', but list is of type ' + l[0].getType()); return ok(l); }
  // RegistryEntryListCodec: a list of entries, or "#tag" string, or a lone entry (when !alwaysList).
  R.RegistryEntryListCodec = { create: function (regKey, entryCodec, alwaysList) {
    var lc = listOf(entryCodec);
    var dl = { encode: function (l, ops) { var c = sameType(l); if (c.error) return c; if (!alwaysList && l.length === 1) return entryCodec.encode(l[0], ops); return lc.encode(l, ops); },
      decode: function (ops, t) { var r = lc.decode(ops, t); if (r.error && !alwaysList) { var one = entryCodec.decode(ops, t); if (one.error) return r; return ok({ first: [one.value.first], second: t }); } if (r.error) return r; var c = sameType(r.value.first); return c.error ? c : r; } };
    function isTag(ops, t) { var s = ops.getString(t); return !s.error && s.value.charAt(0) === '#'; }
    return {
      decode: function (ops, t) {
        var reg = ops.getRegistry && ops.getRegistry(regKey);
        if (reg) {
          if (isTag(ops, t)) { var s = ops.getString(t); return ok({ first: reg.getOrCreateEntryList({ id: s.value.substring(1), registry: regKey }), second: t }); }
          var r = dl.decode(ops, t); return r.error ? r : ok({ first: directList(r.value.first), second: t });
        }
        var d = lc.decode(ops, t); if (d.error) return d;
        for (var i = 0; i < d.value.first.length; i++) if (!d.value.first[i].isDirect) return err("Can't decode element " + d.value.first[i] + ' without registry');
        return ok({ first: directList(d.value.first), second: t });
      },
      encode: function (list, ops) {
        var reg = ops.getRegistry && ops.getRegistry(regKey);
        if (reg) {
          if (!list.isOf(reg)) return err('HolderSet ' + list + ' is not valid in current registry set');
          var st = list.getStorage(); return st.left ? ok(ops.createString('#' + st.left.id)) : dl.encode(st.right.slice(), ops);
        }
        return lc.encode(list.stream(), ops);
      } };
  } };
  R.RegistryCodecs = { entryList: function (regKey, elementCodec, alwaysList) {
    return R.RegistryEntryListCodec.create(regKey, elementCodec ? elementCodec : R.RegistryFixedCodec.of(regKey), !!alwaysList); },
    // createRegistryCodec: a list of {name,id,element}; element codec is {encode(v,ops), decode(ops,t)}; ops.createMap/getMap for the entry object.
    createRegistryCodec: function (regKey, lifecycle, elemCodec) {
      return {
        encode: function (reg, ops) { var out = []; for (var it = reg.iterator(), n = it.next(); !n.done; n = it.next()) { var v = n.value, er = elemCodec.encode(v, ops);
          if (er.error) return er; out.push(ops.createMap({ name: ops.createString(reg.getKey(v).value), id: reg.getRawId(v), element: er.value })); } return ok(ops.createList(out)); },
        decode: function (ops, t) { var lr = ops.getList(t); if (lr.error) return lr; var reg = simpleRegistry(regKey, lifecycle, null);
          for (var i = 0; i < lr.value.length; i++) { var m = ops.getMap(lr.value[i]), nm = ops.getString(m.name); if (nm.error) return nm; var el = elemCodec.decode(ops, m.element); if (el.error) return el;
            reg.set(m.id, keyOf(regKey.value, nm.value), el.value.first, lifecycle); } return ok({ first: reg, second: t }); } };
    } };

  // ---- BuiltinRegistries: root registry of registries. addRegistry adds the sub-registry to ROOT.
  var ROOT = simpleRegistry(keyOf(ROOT_ID, ROOT_ID), 'experimental', null), DEFAULT = new Map();
  R.BuiltinRegistries = { ROOT: ROOT, REGISTRIES: ROOT, DEFAULT_VALUE_SUPPLIERS: DEFAULT,
    addRegistry: function (key, lifecycle, supplier, reg) { lifecycle = lifecycle || 'stable'; reg = reg || simpleRegistry(key, lifecycle, null);
      DEFAULT.set(key.value, supplier || null); ROOT.add(key, reg, lifecycle); return reg; },
    add: function (reg, key, v) { if (typeof key === 'string') key = keyOf(reg.registryKey.value, key.indexOf(':') < 0 ? 'minecraft:' + key : key); return reg.add(key, v, 'stable'); },
    init: function () {},
    // Registry.validate: every registry in the root must be non-empty and have its default if defaulted.
    validate: function (root) { var bad = []; root.stream().forEach(function (r) { if (r.isEmpty()) bad.push(r.registryKey.value); if (r.getDefaultId && r.get(r.getDefaultId()) == null) bad.push(r.registryKey.value); }); if (bad.length) throw new Error('Registry validation failed: ' + bad.join(', ')); } };

  // ---- DynamicRegistryManager: Entry/ImmutableImpl/MutableImpl over a Map<registryKey, Registry>.
  function entryOf(k, r) { return { key: k, registry: r, freeze: function () { return entryOf(k, r.freeze()); } }; }
  function mgr(map, mutable) {
    var m = { getOptionalManaged: function (k) { return map.get(k) || null; },
      getManaged: function (k) { var r = map.get(k); if (!r) throw new Error('Missing registry: ' + k); return r; },
      getOptional: function (k) { return map.get(k) || ROOT.getOrEmpty(k.value) || null; },
      get: function (k) { var r = m.getOptional(k); if (!r) throw new Error('Missing registry: ' + k); return r; },
      streamManagedRegistries: function () { return Array.from(map.entries()).map(function (e) { return entryOf(e[0], e[1]); }); },
      streamAllRegistries: function () { return m.streamManagedRegistries().concat(ROOT.streamEntries().map(function (e) { return entryOf(e.registryKey(), e.getValue()); })); },
      getRegistryLifecycle: function () { return m.streamManagedRegistries().reduce(function (a, e) { return R.Lifecycle.add(a, e.registry.getLifecycle()); }, 'stable'); },
      toImmutable: function () { return mutable ? mgr(new Map(m.streamManagedRegistries().map(function (e) { return [e.key, e.registry.freeze()]; })), false) : m; } };
    if (mutable) { m.getOptionalMutable = function (k) { return map.get(k) || null; };
      m.getMutable = function (k) { var r = map.get(k); if (!r) throw new Error('Missing registry: ' + k); return r; }; }
    return m;
  }
  R.DynamicRegistryManager = { Entry: entryOf,
    ImmutableImpl: function (map) { return mgr(new Map(map), false); },
    MutableImpl: function (map) { return mgr(map, true); },
    // of(root): a manager whose managed registries are the entries of the given registry-of-registries.
    of: function (root) { var m = mgr(new Map(), false);   // live view of root, like the decomp's anonymous Immutable (it looks the key up in root each call)
      m.getOptionalManaged = function (k) { return root.get(k) || null; };
      m.streamManagedRegistries = function () { return root.getEntrySet().map(function (e) { return entryOf(e[0], e[1]); }); };
      m.getOptional = function (k) { return m.getOptionalManaged(k) || ROOT.getOrEmpty(k.value) || null; };
      return m; },
    createSimpleRegistry: function (key) { return simpleRegistry(key, 'stable', null); },
    createMutableRegistryManager: function (keys) { var map = new Map(); keys.forEach(function (k) { map.set(k, simpleRegistry(k, 'stable', null)); }); return mgr(map, true); } };
  R.BuiltinRegistries.DYNAMIC_REGISTRY_MANAGER = R.DynamicRegistryManager.of(ROOT);
})(MCL);
