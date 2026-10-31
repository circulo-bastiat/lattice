// 02d_wgdata.js — the vanilla worldgen registries at runtime. PLAN W1.
// Runs on: main thread AND workers. No DOM.
//
// ⚠ DATA ONLY, and that is the whole design. This file decodes eleven registries of Mojang's
// own worldgen JSON — 766 files, 37.8 KB deflated — and hands them over unevaluated. It does
// not know what a density function is. W2 ports the noise, W3 the column function, W5 the
// biomes, W7 the carvers and W8 the features, each hand-written against the numbers this
// module carries, because a generated evaluator would be a second implementation of Minecraft
// hidden inside a build tool and no test could read it.
//
// ── THE FORMAT ───────────────────────────────────────────────────────────────────────────
// `tools/pack-worldgen.mjs` interns every distinct string in the corpus — values AND object
// keys — into one table, and replaces each with its index. So the packed form of
//
//     { "type": "minecraft:noise", "firstOctave": -10 }
//
// is `{ "12": {"s": 34}, "13": -10 }`, where 12 is the index of "type", 34 of
// "minecraft:noise" and 13 of "firstOctave". A string VALUE is wrapped as `{s: index}` so the
// decoder can tell it from a number without a schema.
//
// Decoding rebuilds real objects with real keys, because every consumer downstream wants to
// read `settings.noise.min_y` rather than `settings[12][7]`. That costs about 4 MB of heap and
// 40 ms once per thread, which is the right trade against making five hand-written evaluators
// each carry a string table.
//
// ── WHAT IS IN IT ────────────────────────────────────────────────────────────────────────
//   noise (60)                    firstOctave + amplitudes, for W2's octave stack
//   noise_settings (7)            sea level, height, slides, sampling, the TERRAIN SHAPER
//                                 splines and the noise router — W3's entire input
//   density_function (23)         the named functions the router refers to
//   biome (61)                    temperature, downfall, effects, spawners, feature lists — W5
//   configured_carver (4)         W7
//   configured_feature (184)      W8
//   placed_feature (220)          W8's placement modifiers
//   structure_set (17)            W13's spread and spacing
//   + 42 BIOME TAGS               not a registry — `data/minecraft/tags/worldgen/biome/`, read
//                                 out of the jar and flattened, because a structure's `biomes`
//                                 field is a tag reference and nothing else (W13, D-183)
//   + 11 PLACEMENT SETS           also not a registry — the per-block `canSurvive` floors, out
//                                 of the BLOCK tags. They ride here and not in `tags.bin`
//                                 because worldgen asks the question on the WORKERS and
//                                 `src/02f_tags.js` is main-thread only (D-197)
//   configured_structure_feature (31)
//   template_pool (126)           W15's jigsaw pools; `element.location` names an NBT file
//   processor_list (33)
//
(function (NS) {
  'use strict';

  var WG = NS.WG = {};

  WG.ready = false;
  WG.version = '';
  WG.decodeMs = 0;
  var bsLocal = null;            // canonical "name|k=v,..." -> local real state index
  var biomeTags = null;          // "has_structure/mineshaft" -> ['badlands', ...] (W13)
  var placeMembers = null;       // "bush" -> ['coarse_dirt', 'dirt', ...]  the floors it accepts
  var placeUsers = null;         // "bush" -> ['grass', 'poppy', ...]       the blocks that obey it
  var ruleTags = null;           // "dirt" -> ['coarse_dirt', 'dirt', ...]        the tags Survive's rules ask (#19)
  var placeOpaque = null;        // "mushroom" -> 1                         also accepts any opaque

  /** The eleven registry names, in pack order. */
  WG.REGISTRIES = ['noise', 'noise_settings', 'density_function', 'biome',
    'configured_carver', 'configured_feature', 'placed_feature',
    'structure_set', 'configured_structure_feature', 'template_pool', 'processor_list'];

  var strings = null;
  var reg = null;          // registry -> { name -> value }

  function unpack(node) {
    if (node === null || typeof node !== 'object') return node;
    if (Array.isArray(node)) {
      var arr = new Array(node.length);
      for (var i = 0; i < node.length; i++) arr[i] = unpack(node[i]);
      return arr;
    }
    // a string value is the one-key object {s: index}; every other object is a real object
    // whose keys are string indices. `s` can never collide with an index because an index is
    // written as a decimal number.
    if (node.s !== undefined && Object.keys(node).length === 1) return strings[node.s];
    var out = {};
    for (var k in node) out[strings[k | 0]] = unpack(node[k]);
    return out;
  }

  /**
   * init(data) — `data.worldgen` is base64 of the deflated blob, `data.worldgenBytes` its
   * inflated length. Same shape as the block registry's payload and posted the same way.
   */
  WG.init = function (data) {
    if (!data || !data.worldgen) { WG.ready = false; return WG; }
    var t = (NS.U && NS.U.now) ? NS.U.now() : Date.now();
    var bytes = NS.Z.unpack(data.worldgen, data.worldgenBytes);
    var text = '';
    // The blob is UTF-8 JSON. Every string in it is an ASCII Minecraft id or key, so a plain
    // byte-to-char walk is correct AND much faster than TextDecoder here; the assertion that
    // it really is ASCII lives in tools/wgcheck.mjs rather than in a runtime branch.
    var CH = 8192, parts = [];
    for (var i = 0; i < bytes.length; i += CH) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CH, bytes.length))));
    }
    text = parts.join('');
    var blob = JSON.parse(text);
    strings = blob.s;
    WG.version = blob.v;
    reg = {};
    for (var r = 0; r < WG.REGISTRIES.length; r++) {
      var name = WG.REGISTRIES[r], src = blob.r[name] || {};
      var dst = Object.create(null);
      for (var key in src) dst[strings[key | 0]] = unpack(src[key]);
      reg[name] = dst;
    }
    // ── the block-state table (PLAN W6) ─────────────────────────────────────────────────
    // The worldgen data names block STATES: a surface rule places `minecraft:deepslate` with
    // `axis: y`, a feature places an oak log on its side. Resolving a property MAP to a state
    // needs the property names and their declared order, which the runtime registry
    // deliberately does not carry — so `pack-worldgen.mjs` resolved all 184 of them at build
    // time and this is the lookup. See that file for the ordering rule and its proof.
    bsLocal = Object.create(null);
    if (blob.bs) {
      for (var q = 0; q < blob.bs.k.length; q++) bsLocal[strings[blob.bs.k[q] | 0]] = blob.bs.l[q] | 0;
    }
    WG.blockStateCount = blob.bs ? blob.bs.k.length : 0;

    // ── the biome tags (PLAN W13, D-183) ────────────────────────────────────────────────
    // `tg` is tag name -> the biome names it resolves to, flattened at build time: a nested
    // `#minecraft:is_forest` was expanded by `pack-worldgen.mjs`, so nothing here walks a tag
    // graph and no runtime code ever sees a `#`. This is the other half of a structure's
    // definition — `configured_structure_feature/mineshaft.json`'s `biomes` field is a tag
    // reference and nothing else — and without it W13 knows every structure's spacing and no
    // structure's biomes.
    biomeTags = Object.create(null);
    if (blob.tg) {
      for (var tk in blob.tg) {
        var tl = blob.tg[tk], tn = new Array(tl.length);
        for (var tq = 0; tq < tl.length; tq++) tn[tq] = strings[tl[tq] | 0];
        biomeTags[strings[tk | 0]] = tn;
      }
    }
    WG.biomeTagCount = Object.keys(biomeTags).length;

    // ── the placement sets (PLAN G2, D-197) ─────────────────────────────────────────────
    // `pm` is rule -> the block names it accepts under a plant, `pu` rule -> the blocks that
    // obey it, `po` the rules that additionally accept any opaque block. Flattened at build
    // time out of vanilla's own BLOCK tags, exactly as the biome tags above are, so nothing
    // here walks a tag graph. `States.buildPlacement` turns these names into the per-state and
    // per-block tables `States.floorOk` indexes; this module stays data-only.
    placeMembers = Object.create(null);
    placeUsers = Object.create(null);
    placeOpaque = Object.create(null);
    if (blob.pm) {
      for (var pk in blob.pm) {
        var pl = blob.pm[pk], pn = new Array(pl.length);
        for (var pq = 0; pq < pl.length; pq++) pn[pq] = strings[pl[pq] | 0];
        placeMembers[strings[pk | 0]] = pn;
      }
    }
    if (blob.pu) {
      for (var uk in blob.pu) {
        var ul = blob.pu[uk], un = new Array(ul.length);
        for (var uq = 0; uq < ul.length; uq++) un[uq] = strings[ul[uq] | 0];
        placeUsers[strings[uk | 0]] = un;
      }
    }
    ruleTags = Object.create(null);
    if (blob.rt) {
      for (var rk in blob.rt) {
        var rl = blob.rt[rk], rn = new Array(rl.length);
        for (var rq = 0; rq < rl.length; rq++) rn[rq] = strings[rl[rq] | 0];
        ruleTags[strings[rk | 0]] = rn;
      }
    }
    if (blob.po) for (var oq = 0; oq < blob.po.length; oq++) placeOpaque[strings[blob.po[oq] | 0]] = 1;
    WG.placementCount = Object.keys(placeMembers).length;

    WG.strings = strings;
    WG.ready = true;
    // ⚠ W15's structure templates ride the same payload and are decoded HERE, from `data`,
    // because `Reg.init` is the one place both the main thread and every worker reach with the
    // same object and this module is already the one it hands it to. A separate entry point
    // would be a second place to forget (D-186).
    if (NS.Templates && data.templates) NS.Templates.init(data);
    WG.decodeMs = ((NS.U && NS.U.now) ? NS.U.now() : Date.now()) - t;
    return WG;
  };

  /**
   * stateOf(node) -> the REAL STATE id for a `{Name, Properties}` node out of the worldgen data.
   *
   * Two lookups joined: this module knows the LOCAL index for the name-plus-properties, and
   * `States.withLocal` knows how to turn a block name and a local index into a real state. A
   * node whose block the registry does not have resolves to air, and the caller is expected to
   * notice — `surfcheck` asserts that no rule in the tree does.
   */
  WG.stateOf = function (node) {
    if (!node || typeof node.Name !== 'string') return 0;
    var key = node.Name;
    if (node.Properties) {
      var ks = Object.keys(node.Properties).sort(), parts = [];
      for (var i = 0; i < ks.length; i++) parts.push(ks[i] + '=' + node.Properties[ks[i]]);
      key += '|' + parts.join(',');
    }
    var local = bsLocal ? bsLocal[key] : undefined;
    if (local === undefined) return 0;
    return NS.States ? NS.States.withLocal(node.Name, local) : 0;
  };

  /** The local index the build resolved for a canonical key, or undefined. For tests. */
  WG.stateLocal = function (key) { return bsLocal ? bsLocal[key] : undefined; };

  /** get('noise', 'temperature') -> the parsed entry, or undefined. Ids may carry the namespace. */
  WG.get = function (registry, id) {
    if (!WG.ready) return undefined;
    var r = reg[registry];
    if (!r) return undefined;
    return r[id.indexOf('minecraft:') === 0 ? id.slice(10) : id];
  };

  /**
   * biomeTag(name) -> the biome NAMES a `worldgen/biome` tag resolves to, or undefined.
   *
   * The name may carry the namespace and the leading `#` a data file writes it with, so
   * `WG.biomeTag('#minecraft:has_structure/mineshaft')` and `WG.biomeTag('has_structure/
   * mineshaft')` are the same question. Nested tags were flattened at build time (D-183).
   */
  WG.biomeTag = function (name) {
    if (!WG.ready || !biomeTags) return undefined;
    var k = String(name);
    if (k.charCodeAt(0) === 35) k = k.slice(1);                 // '#'
    if (k.indexOf('minecraft:') === 0) k = k.slice(10);
    return biomeTags[k];
  };

  /**
   * The placement sets (D-197). `placementRules()` names them; `placementFloors(rule)` is the
   * block NAMES that rule accepts as a floor; `placementBlocks(rule)` the blocks that obey it;
   * `placementAnyOpaque(rule)` is true for `mushroom`, whose vanilla rule is the tag OR any
   * solid-render face — the light half of that disjunction cannot be asked at write time and is
   * documented in `tools/pack-worldgen.mjs` rather than applied.
   *
   * Names, not ids, because this module is registry-blind by design; `States.buildPlacement`
   * is the one place that joins them to block indices.
   */
  WG.placementRules = function () { return placeMembers ? Object.keys(placeMembers).sort() : []; };
  WG.placementFloors = function (rule) { return placeMembers ? placeMembers[rule] : undefined; };
  WG.placementBlocks = function (rule) { return placeUsers ? placeUsers[rule] : undefined; };
  /** ruleTag(name) -> the block NAMES of a tag the survival rules ask, or undefined (#19). */
  WG.ruleTag = function (name) { return ruleTags ? ruleTags[name] : undefined; };
  WG.placementAnyOpaque = function (rule) { return !!(placeOpaque && placeOpaque[rule]); };

  /** Every biome-tag name, sorted. For tests. */
  WG.biomeTagNames = function () { return biomeTags ? Object.keys(biomeTags).sort() : []; };

  /** Every id in a registry, sorted. Not a hot path — it allocates. */
  WG.names = function (registry) {
    if (!WG.ready || !reg[registry]) return [];
    return Object.keys(reg[registry]).sort();
  };

  WG.count = function (registry) {
    return (WG.ready && reg[registry]) ? Object.keys(reg[registry]).length : 0;
  };

  /**
   * The overworld's noise settings — the single entry W3 leans on hardest, so it is named
   * rather than looked up by string in five places.
   */
  WG.overworld = function () { return WG.get('noise_settings', 'overworld'); };
})(MCL);
