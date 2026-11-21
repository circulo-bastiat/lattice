// 02t_tagclasses.js — net/minecraft/tag (#11760): TagKey, Tag(+Builder/entries), TagGroupLoader,
// TagPacketSerializer, BiomeTags, EntityTypeTags, GameEventTags. Runs on: MAIN THREAD ONLY.
// The flattened runtime store is 02f_tags.js; these are vanilla's classes over it. Tags.ofKey(TagKey) is the reach.
(function (NS) {
  'use strict';
  var TC = NS.TagClasses = {};

  // Identifier.toString: bare names are minecraft:
  function ident(s) { return s.indexOf(':') < 0 ? 'minecraft:' + s : s; }
  TC.ident = ident;

  // ── TagKey: interned (registry, id) pair ──
  var interned = Object.create(null);
  function TagKey(registry, id) { this.registry = registry; this.id = id; }
  TagKey.of = function (registry, id) {
    id = ident(id);
    var k = registry + '|' + id;
    return interned[k] || (interned[k] = new TagKey(registry, id));
  };
  TagKey.prototype.isOf = function (registry) { return this.registry === registry; };
  TagKey.prototype.tryCast = function (registry) { return this.isOf(registry) ? this : null; };
  TagKey.prototype.toString = function () { return 'TagKey[minecraft:' + this.registry + ' / ' + this.id + ']'; };
  TagKey.stringCodecEncode = function (k) { return '#' + k.id; };
  TagKey.stringCodecDecode = function (registry, s) {
    return s.charAt(0) === '#' ? TagKey.of(registry, s.slice(1)) : null;   // DataResult.error("Not a tag id")
  };
  TC.TagKey = TagKey;

  // ── Tag ──
  function Tag(values) { this.values = values.slice(); }
  Tag.empty = function () { return new Tag([]); };
  Tag.prototype.valuesList = function () { return this.values; };

  // Entries: resolve(tagGetter, valueGetter, add) -> bool (false = missing reference)
  function Entry(kind, id) { this.kind = kind; this.id = ident(id); }
  Entry.prototype.resolve = function (tg, vg, add) {
    switch (this.kind) {
      case 'object': { var v = vg(this.id); if (v == null) return false; add(v); return true; }
      case 'optional': { var o = vg(this.id); if (o != null) add(o); return true; }
      case 'tag': { var t = tg(this.id); if (!t) return false; t.values.forEach(add); return true; }
      default: { var ot = tg(this.id); if (ot) ot.values.forEach(add); return true; }   // optional tag
    }
  };
  Entry.prototype.isTag = function () { return this.kind === 'tag' || this.kind === 'optionaltag'; };
  Entry.prototype.forEachTagId = function (f) { if (this.kind === 'tag') f(this.id); };
  Entry.prototype.forEachGroupId = function (f) { if (this.kind === 'optionaltag') f(this.id); };
  Entry.prototype.toString = function () {
    return (this.isTag() ? '#' : '') + this.id + (this.kind === 'optional' || this.kind === 'optionaltag' ? '?' : '');
  };
  Entry.prototype.toJson = function () {
    var s = (this.isTag() ? '#' : '') + this.id;
    return (this.kind === 'optional' || this.kind === 'optionaltag') ? { id: s, required: false } : s;
  };

  function Builder() { this.entries = []; }
  Builder.create = function () { return new Builder(); };
  Builder.prototype.add = function (entry, source) { this.entries.push({ entry: entry, source: source }); return this; };
  Builder.prototype.addId = function (id, src) { return this.add(new Entry('object', id), src); };
  Builder.prototype.addOptional = function (id, src) { return this.add(new Entry('optional', id), src); };
  Builder.prototype.addTag = function (id, src) { return this.add(new Entry('tag', id), src); };
  Builder.prototype.addOptionalTag = function (id, src) { return this.add(new Entry('optionaltag', id), src); };
  // -> {left: [TrackedEntry...]} on missing references, else {right: Tag}
  Builder.prototype.build = function (tg, vg) {
    var out = [], missing = [];
    this.entries.forEach(function (te) { if (!te.entry.resolve(tg, vg, function (v) { if (out.indexOf(v) < 0) out.push(v); })) missing.push(te); });
    return missing.length ? { left: missing } : { right: new Tag(out) };
  };
  Builder.prototype.forEachTagId = function (f) { this.entries.forEach(function (te) { te.entry.forEachTagId(f); }); };
  Builder.prototype.forEachGroupId = function (f) { this.entries.forEach(function (te) { te.entry.forEachGroupId(f); }); };
  Builder.prototype.read = function (json, source) {
    if (!Array.isArray(json.values)) throw new Error('Missing values, expected to find a JsonArray');
    var list = json.values.map(function (e) {
      var id, req = true;
      if (e !== null && typeof e === 'object') { id = e.id; if (e.required === false) req = false; } else id = e;
      if (typeof id !== 'string') throw new Error('Expected id to be a string');
      var tag = id.charAt(0) === '#';
      if (tag) id = id.slice(1);
      return new Entry(tag ? (req ? 'tag' : 'optionaltag') : (req ? 'object' : 'optional'), id);
    });
    if (json.replace === true) this.entries.length = 0;
    var self = this;
    list.forEach(function (en) { self.entries.push({ entry: en, source: source }); });
    return this;
  };
  Builder.prototype.toJson = function () {
    var o = { values: this.entries.map(function (te) { return te.entry.toJson(); }) };
    return o;
  };
  Tag.Builder = Builder; Tag.Entry = Entry;
  TC.Tag = Tag;

  // ── TagGroupLoader ──  registryGetter: id -> value|null/undefined
  function TagGroupLoader(registryGetter, dataType) { this.registryGetter = registryGetter; this.dataType = dataType; }
  // files: [{id, packName, json}] (all packs, in order) -> Map<id, Builder>
  TagGroupLoader.prototype.loadTags = function (files) {
    var m = new Map();
    files.forEach(function (f) {
      var b = m.get(f.id); if (!b) { b = Builder.create(); m.set(f.id, b); }
      try { b.read(f.json, f.packName); } catch (e) { /* vanilla logs and continues */ }
    });
    return m;
  };
  TagGroupLoader.prototype.buildGroup = function (builders) {
    var self = this, result = new Map(), deps = new Map(), visited = new Set();
    function reaches(from, target) {   // method_32836: does `from` transitively depend on target?
      var d = deps.get(from); if (!d) return false;
      if (d.has(target)) return true;
      var hit = false; d.forEach(function (x) { if (!hit && reaches(x, target)) hit = true; });
      return hit;
    }
    function dep(a, b) { if (!reaches(b, a)) { if (!deps.has(a)) deps.set(a, new Set()); deps.get(a).add(b); } }
    builders.forEach(function (b, id) { b.forEachTagId(function (x) { dep(id, x); }); });
    builders.forEach(function (b, id) { b.forEachGroupId(function (x) { dep(id, x); }); });
    function visit(id) {
      if (visited.has(id)) return; visited.add(id);
      var d = deps.get(id); if (d) d.forEach(visit);
      var b = builders.get(id); if (!b) return;
      var r = b.build(function (x) { return result.get(x); }, function (x) { var v = self.registryGetter(x); return v == null ? null : v; });
      if (r.right) result.set(id, r.right);
    }
    builders.forEach(function (b, id) { visit(id); });
    return result;
  };
  TagGroupLoader.prototype.load = function (files) { return this.buildGroup(this.loadTags(files)); };
  TC.TagGroupLoader = TagGroupLoader;

  // ── TagPacketSerializer ── registry: {getRawId(v), getEntry(rawId), tags: Map<id, [values]>}
  function Serialized(contents) { this.contents = contents; }   // Map<id, int[]>
  Serialized.prototype.isEmpty = function () { return this.contents.size === 0; };
  function varint(a, v) { v >>>= 0; while (v & ~127) { a.push((v & 127) | 128); v >>>= 7; } a.push(v); }
  function str(a, s) { var u = unescape(encodeURIComponent(s)); varint(a, u.length); for (var i = 0; i < u.length; i++) a.push(u.charCodeAt(i)); }
  Serialized.prototype.writeBuf = function () {
    var a = []; varint(a, this.contents.size);
    this.contents.forEach(function (ids, id) { str(a, id); varint(a, ids.length); ids.forEach(function (n) { varint(a, n); }); });
    return a;
  };
  Serialized.fromBuf = function (bytes) {
    var p = 0;
    function vi() { var r = 0, s = 0, b; do { b = bytes[p++]; r |= (b & 127) << s; s += 7; } while (b & 128); return r >>> 0; }
    function rs() { var n = vi(), s = ''; for (var i = 0; i < n; i++) s += String.fromCharCode(bytes[p++]); return decodeURIComponent(escape(s)); }
    var m = new Map(), n = vi();
    for (var i = 0; i < n; i++) { var id = rs(), c = vi(), l = []; for (var j = 0; j < c; j++) l.push(vi()); m.set(id, l); }
    return new Serialized(m);
  };
  var TagPacketSerializer = { Serialized: Serialized };
  TagPacketSerializer.serializeTags = function (registry) {
    var m = new Map();
    registry.tags.forEach(function (values, id) { m.set(id, values.map(function (v) { return registry.getRawId(v); })); });
    return new Serialized(m);
  };
  TagPacketSerializer.loadTags = function (regKey, registry, ser, loader) {
    ser.contents.forEach(function (ids, id) {
      var vals = ids.map(function (n) { return registry.getEntry(n); }).filter(function (v) { return v != null; });
      loader(TagKey.of(regKey, id), vals);
    });
  };
  TC.TagPacketSerializer = TagPacketSerializer;

  // ── constant holders ──
  function holder(registry, names) { var o = {}; names.forEach(function (n) { o[n] = TagKey.of(registry, n); }); return o; }
  TC.BiomeTags = holder('worldgen/biome', ['is_deep_ocean', 'is_ocean', 'is_beach', 'is_river', 'is_mountain', 'is_badlands', 'is_hill', 'is_taiga', 'is_jungle', 'is_forest', 'is_nether',
    'has_structure/buried_treasure', 'has_structure/desert_pyramid', 'has_structure/igloo', 'has_structure/jungle_temple', 'has_structure/mineshaft', 'has_structure/mineshaft_mesa',
    'has_structure/ocean_monument', 'has_structure/ocean_ruin_cold', 'has_structure/ocean_ruin_warm', 'has_structure/pillager_outpost', 'has_structure/ruined_portal_desert',
    'has_structure/ruined_portal_jungle', 'has_structure/ruined_portal_ocean', 'has_structure/ruined_portal_swamp', 'has_structure/ruined_portal_mountain',
    'has_structure/ruined_portal_standard', 'has_structure/shipwreck_beached', 'has_structure/shipwreck', 'has_structure/swamp_hut', 'has_structure/village_desert',
    'has_structure/village_plains', 'has_structure/village_savanna', 'has_structure/village_snowy', 'has_structure/village_taiga', 'has_structure/woodland_mansion',
    'has_structure/stronghold', 'has_structure/nether_fortress', 'has_structure/nether_fossil', 'has_structure/bastion_remnant', 'has_structure/ruined_portal_nether',
    'has_structure/end_city']);
  TC.EntityTypeTags = holder('entity_type', ['skeletons', 'raiders', 'beehive_inhabitors', 'arrows', 'impact_projectiles', 'powder_snow_walkable_mobs',
    'axolotl_always_hostiles', 'axolotl_hunt_targets', 'freeze_immune_entity_types', 'freeze_hurts_extra_types']);
  TC.GameEventTags = holder('game_event', ['vibrations', 'ignore_vibrations_sneaking']);

  // ── reach: members of a TagKey out of the runtime stores ──
  if (NS.Tags) NS.Tags.ofKey = function (key) {
    var name = key.id.replace(/^minecraft:/, '');
    if (key.registry === 'worldgen/biome') return NS.WG && NS.WG.biomeTag ? NS.WG.biomeTag(name) : undefined;
    return NS.Tags.members(({ block: 'blocks', item: 'items', fluid: 'fluids', entity_type: 'entity_types', game_event: 'game_events' })[key.registry] || key.registry, name);
  };
})(MCL);
