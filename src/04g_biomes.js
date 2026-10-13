// 04g_biomes.js — the 61 biomes, and what each one is. PLAN W5.
// Runs on: main thread AND workers. No DOM.
//
// W4 answers "which biome is at this point" with a number. This file is what that number
// MEANS: the colours, the weather, the temperature, the mobs that spawn, the carvers that cut
// through it and the eleven decoration steps that dress it. Everything here is Mojang's own
// data out of `worldgen/biome/*.json`, already in the runtime blob from W1 — so this module
// reads rather than duplicates, and the one thing it adds is the ARITHMETIC vanilla keeps in
// Java: the colormap lookups, the grass-colour modifiers and the height-adjusted temperature.
//
// ── 61 AND 50 ARE DIFFERENT NUMBERS ──────────────────────────────────────────────────────
// The registry has 61 biomes. W4's overworld climate table names 50 of them. The eleven it
// never names are the five Nether biomes, the five End biomes and `the_void` — they are
// reached through their own dimensions' biome sources, which this project does not have yet
// (G19). They are carried anyway, because dropping data at the registry level is how a stage
// three months from now discovers it has to re-do the fetch.
//
// ── WHAT IS PASSED THROUGH UNTOUCHED, AND WHY THAT IS THE POINT (D-119) ──────────────────
// `spawners`, `spawn_costs`, `carvers` and `features` are handed on exactly as they arrive.
// PLAN W5's acceptance says the spawner lists must "survive into the registry unmodified for
// G's use later", and the reason is CLAUDE.md's rule: which mobs spawn where is not worldgen,
// it is "everything else", and it gets absolute parity. A generator that paraphrased those
// lists into its own shape would be deciding a parity question in a build tool.
//
// ── THE COLOURS ──────────────────────────────────────────────────────────────────────────
// Four of the six are literal fields (`water_color`, `water_fog_color`, `fog_color`,
// `sky_color`). Grass and foliage are computed, and each has three layers:
//
//   1. an explicit `grass_color` / `foliage_color` override, if the biome has one. Measured:
//      three biomes override grass (`badlands`, `eroded_badlands`, `wooded_badlands`) and four
//      override foliage (those three plus `swamp`). Everything else goes through the ramp;
//   2. otherwise the colormap, indexed by the biome's own temperature and downfall — see
//      `tools/pack-colormaps.mjs` for the indexing and the four numbers that pin it down;
//   3. and then, for grass only, a `grass_color_modifier`: DARK_FOREST averages the colour
//      with a fixed brown, and SWAMP ignores the colour entirely and picks one of two greens
//      from a fixed-seed simplex noise — so a swamp is mottled, and it is mottled in the same
//      places in every world, because that noise is seeded from a constant rather than from
//      the world seed. That looks like a bug and is not one.
//
(function (NS) {
  'use strict';

  var B = NS.Biomes = {};

  B.ready = false;
  B.count = 0;
  B.names = null;           // registry ids, sorted — the index space of this module
  B.indexOf = null;         // name (with or without namespace) -> index

  // Vanilla's fixed colours. `FoliageColor.getEvergreenColor` and `getBirchColor` are per-BLOCK
  // overrides rather than per-biome: spruce and birch leaves are the same colour in a jungle as
  // in a tundra, which is why they are constants here and not a colormap lookup.
  B.FOLIAGE_EVERGREEN = 0x619961;
  B.FOLIAGE_BIRCH = 0x80a755;
  B.FOLIAGE_DEFAULT = 0x48b518;
  B.GRASS_DEFAULT = 0x91bd59;      // what a plains comes out as; the fallback if a map is absent
  B.LILY_PAD = 0x208030;
  B.MAGENTA = 0xff00ff;            // vanilla's -65281, returned for an out-of-range colormap index

  B.PRECIP_NONE = 0; B.PRECIP_RAIN = 1; B.PRECIP_SNOW = 2;

  // ── the colormaps ───────────────────────────────────────────────────────────────────────
  var SIZE = 256;
  var grassMap = null, foliageMap = null;

  /**
   * initColormaps(data) — `data.colormaps` is base64 of the deflated blob from
   * `tools/pack-colormaps.mjs`. Called from `Reg.init` alongside every other payload.
   */
  B.initColormaps = function (data) {
    if (!data || !data.colormaps) return B;
    var bytes = NS.Z.unpack(data.colormaps, data.colormapsBytes);
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (dv.getUint32(0, true) !== 0x4d43434d) throw new Error('colormaps.bin: bad magic');
    var format = dv.getUint16(4, true);
    if (format !== 1) throw new Error('colormaps.bin: format ' + format + ', expected 1');
    var size = dv.getUint16(6, true);
    var maps = dv.getUint32(8, true);
    if (size !== SIZE) throw new Error('colormaps.bin: ' + size + 'x' + size + ', expected ' + SIZE);
    if (maps !== 2) throw new Error('colormaps.bin: ' + maps + ' maps, expected grass and foliage');
    var plane = SIZE * SIZE * 3;
    if (12 + maps * plane !== bytes.length) {
      throw new Error('colormaps.bin: ' + (bytes.length - 12 - maps * plane) + ' bytes unaccounted for');
    }
    grassMap = bytes.subarray(12, 12 + plane);
    foliageMap = bytes.subarray(12 + plane, 12 + 2 * plane);
    return B;
  };

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

  /**
   * Mojang's `GrassColor.get` / `FoliageColor.get`, which are the same function over different
   * images. ⚠ `humidity *= temperature` happens BEFORE the two truncations, and both inputs are
   * clamped to 0..1 first — a desert's temperature of 2.0 must become 1.0 here or the index
   * runs off the image and everything hot comes out magenta.
   */
  function rampColor(map, temperature, downfall) {
    if (!map) return B.GRASS_DEFAULT;
    var t = clamp01(temperature);
    var h = clamp01(downfall) * t;
    var i = Math.trunc((1 - t) * 255);
    var j = Math.trunc((1 - h) * 255);
    var k = (j << 8) | i;
    if (k < 0 || k >= SIZE * SIZE) return B.MAGENTA;
    return (map[k * 3] << 16) | (map[k * 3 + 1] << 8) | map[k * 3 + 2];
  }
  B.rampColor = rampColor;
  /**
   * The raw colormap pixel at an image index. Not used by the game — the two consumers are
   * `biomecheck`, which walks the images to prove they are not blank, and the biome sheet,
   * which draws them. Exposed rather than duplicated so the sheet cannot draw a different
   * image from the one the ramp reads.
   */
  B.rampAt = function (which, i, j) {
    var map = which === 'foliage' ? foliageMap : grassMap;
    if (!map || i < 0 || i > 255 || j < 0 || j > 255) return B.MAGENTA;
    var k = (j << 8) | i;
    return (map[k * 3] << 16) | (map[k * 3 + 1] << 8) | map[k * 3 + 2];
  };
  B.grassRamp = function (t, d) { return rampColor(grassMap, t, d); };
  B.foliageRamp = function (t, d) { return rampColor(foliageMap, t, d); };

  // ── the fixed-seed noises ───────────────────────────────────────────────────────────────
  // Built lazily and once. All three are seeded from constants in Mojang's Java, not from the
  // world seed — see the note at the top about swamps being mottled the same way everywhere.
  var infoNoise = null, tempNoise = null, frozenNoise = null;
  function noises() {
    if (!infoNoise) {
      infoNoise = NS.Noise.biomeInfoNoise();
      tempNoise = NS.Noise.temperatureNoise();
      frozenNoise = NS.Noise.frozenTemperatureNoise();
    }
  }

  // ── the table ───────────────────────────────────────────────────────────────────────────
  // One flat record per biome, built once at init. Objects rather than typed arrays: nothing
  // here is in an inner loop — the mesher asks for a colour once per quad at most, and the
  // colours themselves are precomputed integers.
  var rec = null;

  var MOD_NONE = 0, MOD_DARK_FOREST = 1, MOD_SWAMP = 2;
  B.MOD_NONE = MOD_NONE; B.MOD_DARK_FOREST = MOD_DARK_FOREST; B.MOD_SWAMP = MOD_SWAMP;

  var PRECIP = { none: 0, rain: 1, snow: 2 };

  /**
   * init() — reads every `worldgen/biome` entry out of `NS.WG` and resolves it. Requires
   * `WG.init` to have run; the colormaps are optional here only so that a check can test the
   * non-colour half without them, and a missing map is reported rather than defaulted silently.
   */
  B.init = function () {
    if (!NS.WG || !NS.WG.ready) throw new Error('Biomes.init before WG.init');
    var t = (NS.U && NS.U.now) ? NS.U.now() : Date.now();
    // ⚠ NAMESPACED, always. `WG.names` returns bare registry ids (`plains`), but every other
    // place a biome is named — the climate table's 50 entries, the surface rules' `biome_is`
    // lists, the dimension file — writes `minecraft:plains`. Two spellings of one name is the
    // same class of bug as two index spaces, and it cost a debugging round here: a reachability
    // check comparing `Biomes.names` against the climate table's names matched nothing at all
    // and reported that the world contained no biomes.
    var raw = NS.WG.names('biome');
    var names = new Array(raw.length);
    for (var q = 0; q < raw.length; q++) names[q] = raw[q].indexOf(':') < 0 ? 'minecraft:' + raw[q] : raw[q];
    B.names = names;
    B.count = names.length;
    B.hasColormaps = !!(grassMap && foliageMap);
    var idx = Object.create(null);
    rec = new Array(names.length);
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      idx[name] = i;
      idx[name.replace('minecraft:', '')] = i;
      idx['minecraft:' + name.replace('minecraft:', '')] = i;
      var j = NS.WG.get('biome', name);
      if (!j) throw new Error('biome registry names ' + name + ' but has no entry for it');
      var e = j.effects || {};
      if (PRECIP[j.precipitation] === undefined) throw new Error(name + ': unknown precipitation ' + j.precipitation);
      var mod = MOD_NONE;
      if (e.grass_color_modifier === 'dark_forest') mod = MOD_DARK_FOREST;
      else if (e.grass_color_modifier === 'swamp') mod = MOD_SWAMP;
      else if (e.grass_color_modifier !== undefined && e.grass_color_modifier !== 'none') {
        throw new Error(name + ': unknown grass_color_modifier ' + e.grass_color_modifier);
      }
      var temperature = +j.temperature, downfall = +j.downfall;
      rec[i] = {
        name: name,
        index: i,
        category: j.category,
        precipitation: PRECIP[j.precipitation],
        temperature: temperature,
        downfall: downfall,
        // 'frozen' is the only modifier 1.18.2 has, on the two frozen oceans.
        frozenTemp: j.temperature_modifier === 'frozen',
        creatureSpawnProbability: j.creature_spawn_probability === undefined ? 0.1 : +j.creature_spawn_probability,
        skyColor: e.sky_color | 0,
        fogColor: e.fog_color | 0,
        waterColor: e.water_color | 0,
        waterFogColor: e.water_fog_color | 0,
        grassOverride: e.grass_color === undefined ? -1 : (e.grass_color | 0),
        foliageOverride: e.foliage_color === undefined ? -1 : (e.foliage_color | 0),
        grassModifier: mod,
        // resolved once — layers 1 and 2 of the three in the header. Layer 3 is positional and
        // lives in `grassColorAt`.
        grassBase: e.grass_color !== undefined ? (e.grass_color | 0) : rampColor(grassMap, temperature, downfall),
        foliage: e.foliage_color !== undefined ? (e.foliage_color | 0) : rampColor(foliageMap, temperature, downfall),
        // carried through untouched, for G and for W7/W8
        spawners: j.spawners || {},
        spawnCosts: j.spawn_costs || {},
        carvers: j.carvers || {},
        features: j.features || [],
        effects: e,
      };
      if (j.temperature_modifier !== undefined && j.temperature_modifier !== 'none' && j.temperature_modifier !== 'frozen') {
        throw new Error(name + ': unknown temperature_modifier ' + j.temperature_modifier);
      }
    }
    B.indexOf = idx;
    B.ready = true;
    B.initMs = ((NS.U && NS.U.now) ? NS.U.now() : Date.now()) - t;
    return B;
  };

  function at(i) {
    if (!B.ready) throw new Error('Biomes asked before init');
    var r = rec[i];
    if (!r) throw new Error('no biome with index ' + i);
    return r;
  }
  B.at = at;
  /** The whole record, for a caller that wants several fields. Do not mutate it. */
  B.get = function (nameOrIndex) {
    return at(typeof nameOrIndex === 'number' ? nameOrIndex : B.indexOf[nameOrIndex]);
  };
  B.index = function (name) {
    var i = B.indexOf[name];
    if (i === undefined) throw new Error('no such biome: ' + name);
    return i;
  };
  B.name = function (i) { return at(i).name; };

  // ── the colours ─────────────────────────────────────────────────────────────────────────
  B.skyColor = function (i) { return at(i).skyColor; };
  B.fogColor = function (i) { return at(i).fogColor; };
  B.waterColor = function (i) { return at(i).waterColor; };
  B.waterFogColor = function (i) { return at(i).waterFogColor; };
  B.foliageColor = function (i) { return at(i).foliage; };
  /** The grass colour BEFORE the positional modifier. Dark forest and swamp need `grassColorAt`. */
  B.grassBase = function (i) { return at(i).grassBase; };

  /**
   * grassColorAt(i, x, z) — Mojang's `Biome.getGrassColor`, modifier included.
   *
   * ⚠ DARK_FOREST is `((colour & 0xFEFEFE) + 0x28340A) >> 1`, and Java's precedence really does
   * add before it shifts. The mask clears the low bit of each channel so that the sum cannot
   * carry between channels — dropping it tints a dark forest slightly wrong in a way that is
   * invisible against grass and obvious against a screenshot.
   */
  B.grassColorAt = function (i, x, z) {
    var r = at(i);
    if (r.grassModifier === MOD_NONE) return r.grassBase;
    if (r.grassModifier === MOD_DARK_FOREST) return (((r.grassBase & 0xfefefe) + 0x28340a) >> 1) & 0xffffff;
    noises();
    // SWAMP ignores the biome's own colour entirely.
    return infoNoise.get(x * 0.0225, z * 0.0225, false) < -0.1 ? 0x4c763c : 0x6a7039;
  };

  // ── weather and temperature ─────────────────────────────────────────────────────────────
  B.precipitation = function (i) { return at(i).precipitation; };
  B.hasPrecipitation = function (i) { return at(i).precipitation !== 0; };
  B.baseTemperature = function (i) { return at(i).temperature; };
  B.downfall = function (i) { return at(i).downfall; };

  /**
   * temperatureAt(i, x, y, z) — Mojang's `Biome.getHeightAdjustedTemperature`.
   *
   * Two things happen here and both are easy to leave out:
   *   * the FROZEN modifier, which the two frozen oceans carry: where two fixed-seed noises
   *     agree the spot is cold, the temperature is forced to 0.2 whatever the biome says. That
   *     is what puts patches of ice in an otherwise open frozen ocean.
   *   * the height term, which only applies ABOVE y = 80 and is itself wobbled by a third
   *     fixed-seed noise, so the snow line on a mountain is ragged rather than a contour.
   */
  B.temperatureAt = function (i, x, y, z) {
    var r = at(i);
    var f = r.temperature;
    if (r.frozenTemp) {
      noises();
      var d = frozenNoise.get(x * 0.05, z * 0.05, false) * 7;
      var e = infoNoise.get(x * 0.2, z * 0.2, false);
      if (d + e < 0.3) {
        var g = infoNoise.get(x * 0.09, z * 0.09, false);
        if (g < 0.8) f = 0.2;
      }
    }
    if (y > 80) {
      noises();
      var w = tempNoise.get(x / 8, z / 8, false) * 8;
      return f - (w + y - 80) * 0.05 / 40;
    }
    return f;
  };

  /** Vanilla's `warmEnoughToRain`: below 0.15 it snows instead. */
  B.warmEnoughToRain = function (i, x, y, z) { return B.temperatureAt(i, x, y, z) >= 0.15; };
  /** Vanilla's `coldEnoughToSnow`. */
  B.coldEnoughToSnow = function (i, x, y, z) { return !B.warmEnoughToRain(i, x, y, z); };
  /** Would this biome place snow rather than rain at this point? Precipitation must be on. */
  B.snowsAt = function (i, x, y, z) {
    return at(i).precipitation !== 0 && B.coldEnoughToSnow(i, x, y, z);
  };

  // ── the pass-through lists ──────────────────────────────────────────────────────────────
  // Returned by reference, deliberately: these are Mojang's data and nothing in this project
  // should be editing them. G18 reads `spawners`, W7 reads `carvers`, W8 reads `features`.
  B.spawners = function (i) { return at(i).spawners; };
  B.creatureSpawnProbability = function (i) { return at(i).creatureSpawnProbability; };
  B.spawnCosts = function (i) { return at(i).spawnCosts; };
  B.carvers = function (i) { return at(i).carvers; };
  B.features = function (i) { return at(i).features; };
  /** The eleven decoration steps, in vanilla's order. `features[step]` is the list for a step. */
  B.STEPS = ['raw_generation', 'lakes', 'local_modifications', 'underground_structures',
             'surface_structures', 'strongholds', 'underground_ores', 'underground_decoration',
             'fluid_springs', 'vegetal_decoration', 'top_layer_modification'];

  /**
   * featureStep(i, step) — the placed features for one of the eleven steps.
   *
   * ⚠ D-120. `features` is NOT always eleven entries long. Mojang's generator truncates trailing empty
   * steps, so `end_barrens` has zero, `the_end` has five and the Nether biomes have ten while
   * every overworld biome has all eleven. Reading `features[step]` directly gives `undefined`
   * for a step past the end, and the fix is here rather than by padding the array — padding
   * would edit data PLAN W5 requires to survive unmodified.
   */
  var NO_FEATURES = [];
  B.featureStep = function (i, step) {
    if (step < 0 || step >= B.STEPS.length) throw new Error('no decoration step ' + step);
    var f = at(i).features;
    return step < f.length ? f[step] : NO_FEATURES;
  };

  /**
   * The colour a block's tint index asks for, given the biome it stands in. The three tint
   * channels the mesher already carries (1 grass, 2 foliage, 3 water) plus the per-block
   * overrides that are not biome-dependent at all.
   */
  B.tintColor = function (channel, i, x, z) {
    if (channel === 1) return B.grassColorAt(i, x, z);
    if (channel === 2) return at(i).foliage;
    if (channel === 3) return at(i).waterColor;
    return 0xffffff;
  };
})(MCL);
