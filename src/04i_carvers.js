// 04i_carvers.js — the configured carvers (PLAN W7). Runs on the main thread AND the workers.
//
// 1.18 makes caves out of two unrelated systems, and MC-Lite has both:
//
//   * NOISE caves — the cheese and spaghetti fields that live inside vanilla's density stack.
//     Deviation #1 replaced that stack, so MC-Lite grows them itself in `04b_caves.js`: a pure
//     function of position, evaluated on a 4x4x4 lattice.
//   * CARVERS — `minecraft:cave`, `minecraft:cave_extra_underground` and `minecraft:canyon`,
//     which are DATA (`worldgen/configured_carver/*.json`, all three carried by all 50 overworld
//     biomes) driving a random walk of ellipsoids. That is this file.
//
// The two do different jobs and a world with only one of them is visibly wrong. The noise fields
// give the big rooms and the endless branching tangle; the carvers give the long deliberate
// tunnels you can follow, the wide junction rooms, and the ravines. Vanilla has both for exactly
// this reason.
//
// ── ⚠ THE INVARIANT THIS FILE EXISTS TO PROTECT ─────────────────────────────────────────────
//
// PLAN W7: *"a cave that a structure will later occupy must be carved identically whether it is
// reached from the north or the south."* A carver does not stay inside the chunk that starts it
// — a tunnel is up to 240 blocks long — so "generate this chunk's carvers" is not a thing that
// can be done chunk by chunk. Vanilla's answer, and MC-Lite's:
//
//     to carve chunk T, run the carvers of every chunk within RANGE of T and keep the part that
//     lands in T.
//
// Each SOURCE chunk's carvers depend only on (seed, source chunk), so T's result depends only on
// (seed, T) — no matter which chunk was generated first, on which thread, in which session. The
// determinism is a property of the seeding, not of the order, and `cavecheck` proves it by
// generating the same chunks in three different orders and comparing bytes.
//
// ── HOW IT IS CHEAPENED (D-123), AND WHAT THE CHEAPENING IS NOT ────────────────────────────
//
// Vanilla regenerates a source chunk's entire random walk once per TARGET chunk: with a range of
// 8, every chunk's carvers are generated 289 times, and 288 of those are thrown away. MC-Lite
// generates each source chunk's walk ONCE, buckets its ellipsoids by the target chunk they
// touch, and caches that. The cache is keyed by the source chunk and holds nothing but numbers,
// so a cache miss and a cache hit produce the same world.
//
// ⚠ That is the whole of the cheapening, and it changes nothing about the result. It is not a
// smaller range, not fewer tunnels and not a coarser lattice — deviation #3 licenses those, and
// none of them is needed once the 288 wasted generations are gone.
//
// ── ⚠ WHAT IS NOT VANILLA HERE: THE RANDOM SEQUENCE ────────────────────────────────────────
//
// Every other ported stage in track W is checkable against a file: the noise stack against
// published JDK outputs, the biome table against `dimension/overworld.json`, the surface rules
// against the rule tree itself. The carver ALGORITHM is none of those — it is compiled Java, and
// nothing in the jar states the order in which it draws its random numbers. A port claiming
// sequence parity would be a claim no test in this project could check.
//
// So MC-Lite does not claim it. The CONFIGURATION is vanilla's, read out of the four JSON files
// and honoured field by field (probability, the y distribution and both of its anchor forms, the
// radius multipliers, the floor level, the lava level, the canyon's trapezoid thickness and its
// width smoothness). The SHAPE is vanilla's: rooms, tunnels that branch once at a random step,
// pitch that decays and wanders, a canyon whose width comes from a 1,024-entry factor table. The
// SEQUENCE is MC-Lite's own PRNG, seeded per source chunk (D-124). What the invariant above
// needs is that the sequence be a deterministic function of the source chunk, and it is.

(function (NS) {
  'use strict';

  var CFG = NS.CFG;
  var MINY = CFG.WORLD_MIN_Y;
  var MAXY = CFG.WORLD_MAX_Y;
  var H = CFG.CHUNK_H;

  var CV = NS.Carvers = { ready: false, G: null, list: [], range: 8 };

  // ⚠ TWO different eights, and conflating them doubles every tunnel in the world.
  //
  //   RANGE      the CHUNK LOOP. `ChunkGenerator.applyCarvers` iterates -8..+8 chunks around the
  //              one being carved, hard-coded. That is how far a source chunk may reach.
  //   WALK_RANGE `WorldCarver.getRange()`, which is FOUR, and is the number the carver's own
  //              step count is derived from: `(getRange() * 2 - 1) * 16` = 112 blocks, not 240.
  //
  // The first draft used 8 for both. Every tunnel came out 240 steps instead of 112, cave volume
  // roughly doubled, and — because a tunnel's pitch decays toward level and it therefore holds
  // its height for its whole length — a tunnel that clipped a flat desert stripped a 200-block
  // open trench through it instead of leaving an entrance. Dan found it by playing: "their are
  // wrid walls in the deserts". The walls were the sides of the trench. (D-129)
  var RANGE = 8;
  var WALK_RANGE = 4;
  CV.RANGE = RANGE;
  CV.WALK_RANGE = WALK_RANGE;

  // ── the PRNG (D-124) ───────────────────────────────────────────────────────────────────────
  // sfc32, seeded from a 32-bit avalanche of (seed, chunk x, chunk z, carver index). Chosen for
  // three properties and nothing else: it is a pure function of its seed, it is fast enough that
  // a chunk's whole walk costs microseconds, and it needs no BigInt — this runs thousands of
  // times per chunk, where `Xoro` is a few hundred nanoseconds a draw.
  function mix32(a) {
    a |= 0; a = (a + 0x7ed55d16 + (a << 12)) | 0; a = (a ^ 0xc761c23c ^ (a >>> 19)) | 0;
    a = (a + 0x165667b1 + (a << 5)) | 0;  a = ((a + 0xd3a2646c) ^ (a << 9)) | 0;
    a = (a + 0xfd7046c5 + (a << 3)) | 0;  a = (a ^ 0xb55a4f09 ^ (a >>> 16)) | 0;
    return a;
  }
  function Rng(s0, s1, s2) {
    this.a = s0 | 0; this.b = s1 | 0; this.c = s2 | 0; this.d = 1;
    for (var i = 0; i < 12; i++) this.next();          // discard the seeding transient
  }
  Rng.prototype.next = function () {
    var a = this.a, b = this.b, c = this.c, d = this.d;
    var t = (a + b | 0) + d | 0;
    d = d + 1 | 0;
    this.a = b ^ (b >>> 9);
    this.b = c + (c << 3) | 0;
    this.c = (c << 21) | (c >>> 11);
    this.c = this.c + t | 0;
    this.d = d;
    return t >>> 0;
  };
  /** [0,1), 32 bits. Named for the Java call it stands in for. */
  Rng.prototype.nextFloat = function () { return this.next() * 2.3283064365386963e-10; };
  /** [0,bound), never negative, never `bound`. */
  Rng.prototype.nextInt = function (bound) {
    if (bound <= 1) return 0;
    return (this.next() % bound) | 0;
  };
  CV.Rng = Rng;

  /** The source of randomness for one carver in one source chunk. Pure in its four arguments. */
  function rngFor(seed, cx, cz, ci) {
    var s = seed | 0;
    return new Rng(mix32(s ^ (cx * 0x9E3779B1)), mix32((s >>> 3) ^ (cz * 0x85EBCA77)),
                   mix32((cx * 374761393) ^ (cz * 668265263) ^ (ci * 0x27D4EB2F) ^ s));
  }
  CV.rngFor = rngFor;

  // ── the configuration, out of the four JSON files ──────────────────────────────────────────

  /**
   * ⚠ `VerticalAnchor` has three forms and they are not interchangeable. `absolute` is a world y;
   * `above_bottom` counts up from the bottom of the WORLD; `below_top` counts down from the top.
   * MC-Lite's world is −64..256 (D-19) while vanilla's noise settings declare −64..320, so
   * `above_bottom` agrees with vanilla and `below_top` does not — and `below_top` appears only in
   * `nether_cave`, which the overworld never runs.
   */
  function anchor(a) {
    if (a === undefined || a === null) throw new Error('carver: missing vertical anchor');
    if (a.absolute !== undefined) return a.absolute | 0;
    if (a.above_bottom !== undefined) return MINY + (a.above_bottom | 0);
    if (a.below_top !== undefined) return MAXY - 1 - (a.below_top | 0);
    throw new Error('carver: unknown vertical anchor ' + JSON.stringify(a));
  }

  /**
   * A `FloatProvider` or a bare number, as a function of the rng. Three forms appear in the four
   * carvers: a constant, `uniform` (half-open: `min_inclusive` .. `max_exclusive`), and
   * `trapezoid`, which is the sum of two uniforms and is why a canyon is usually thin and
   * occasionally very wide.
   */
  function floatProvider(v, what) {
    if (typeof v === 'number') return function () { return v; };
    if (v && v.type === 'minecraft:uniform') {
      var lo = +v.value.min_inclusive, hi = +v.value.max_exclusive;
      return function (r) { return lo + r.nextFloat() * (hi - lo); };
    }
    if (v && v.type === 'minecraft:trapezoid') {
      var min = +v.value.min, max = +v.value.max, plateau = +v.value.plateau;
      var span = max - min, half = (span - plateau) / 2, mid = span - half;
      return function (r) { return min + r.nextFloat() * mid + r.nextFloat() * half; };
    }
    throw new Error('carver: unsupported float provider for ' + what + ': ' + JSON.stringify(v));
  }

  /** The `y` height provider: `uniform` over two vertical anchors, inclusive at both ends. */
  function heightProvider(v) {
    if (v && v.type === 'minecraft:uniform') {
      var lo = anchor(v.min_inclusive), hi = anchor(v.max_inclusive);
      if (hi < lo) throw new Error('carver: y range is empty (' + lo + '..' + hi + ')');
      return function (r) { return lo + r.nextInt(hi - lo + 1); };
    }
    throw new Error('carver: unsupported height provider ' + JSON.stringify(v));
  }

  /**
   * The blocks a carver may remove. Vanilla's `WorldCarver.CARVABLE_BLOCKS`, by name, resolved
   * to real states here (D-127). ⚠ It is much wider than "stone and deepslate": a carver cuts
   * through dirt, grass, sand and terracotta too, and that is what a cave ENTRANCE is. Session
   * 1's noise caves removed stone only, so no cave in MC-Lite had ever reached daylight — and
   * pointedly NOT ores, so a tunnel through a vein leaves the vein hanging in the air.
   */
  var CARVABLE_NAMES = [
    'stone', 'granite', 'diorite', 'andesite', 'tuff', 'calcite', 'deepslate', 'dripstone_block',
    'dirt', 'coarse_dirt', 'rooted_dirt', 'podzol', 'grass_block', 'mycelium',
    'sand', 'red_sand', 'gravel', 'sandstone', 'red_sandstone',
    'snow_block', 'packed_ice', 'terracotta',
    'white_terracotta', 'orange_terracotta', 'magenta_terracotta', 'light_blue_terracotta',
    'yellow_terracotta', 'lime_terracotta', 'pink_terracotta', 'gray_terracotta',
    'light_gray_terracotta', 'cyan_terracotta', 'purple_terracotta', 'blue_terracotta',
    'brown_terracotta', 'green_terracotta', 'red_terracotta', 'black_terracotta',
  ];

  var carvable = null;          // Uint8Array indexed by real state
  CV.carvableCount = 0;

  /**
   * init(G) — read the configured carvers out of the worldgen blob and resolve them once.
   * Throws rather than defaulting: a carver list that silently came up empty would look exactly
   * like a world with no caves, which is a thing a person might believe.
   */
  CV.init = function (G) {
    if (!NS.WG || !NS.WG.ready) throw new Error('Carvers.init before the worldgen data decoded');
    if (!NS.States || !NS.States.ready) throw new Error('Carvers.init before the registry decoded');
    CV.G = G;

    // The three the overworld runs, in the order every overworld biome lists them. They are all
    // in the `air` carving step; the `liquid` step is empty in 1.18.2.
    var want = ['cave', 'cave_extra_underground', 'canyon'];
    CV.list = [];
    for (var i = 0; i < want.length; i++) {
      var j = NS.WG.get('configured_carver', want[i]);
      if (!j) throw new Error('the worldgen blob has no configured_carver ' + want[i]);
      CV.list.push(compile(want[i], j));
    }

    carvable = new Uint8Array(NS.States.count);
    CV.carvableCount = 0;
    for (var k = 0; k < CARVABLE_NAMES.length; k++) {
      var st = NS.States.stateOf(CARVABLE_NAMES[k]);
      if (st === 0) throw new Error('carvable block missing from the registry: ' + CARVABLE_NAMES[k]);
      if (!carvable[st]) { carvable[st] = 1; CV.carvableCount++; }
    }
    // ⚠ A carver removes the DEFAULT state of each of these. That is enough because the world it
    // carves has only default states in it — the surface rules and the terrain fill place
    // nothing else — and it is deliberate: if a later stage puts a non-default state
    // underground, a carver should leave it alone rather than delete it silently.

    // Every overworld carver declares the same `lava_level`, so it is one number rather than a
    // field on every node. Assert that rather than assume it: a future data change that gave one
    // carver its own lava level would otherwise be silently applied to all three.
    carverLavaLevel = CV.list[0].lavaLevel;
    for (var m = 1; m < CV.list.length; m++) {
      if (CV.list[m].lavaLevel !== carverLavaLevel) {
        throw new Error('the overworld carvers disagree about lava_level: ' +
                        CV.list[0].name + ' says ' + carverLavaLevel + ', ' +
                        CV.list[m].name + ' says ' + CV.list[m].lavaLevel);
      }
    }

    CV.cache = new Map();
    CV.cacheHits = 0; CV.cacheMisses = 0; CV.nodesBuilt = 0;
    CV.ready = true;
    return CV;
  };

  function compile(name, j) {
    var c = j.config || {};
    var kind = (j.type || '').replace('minecraft:', '');
    if (kind !== 'cave' && kind !== 'canyon' && kind !== 'nether_cave') {
      throw new Error('carver ' + name + ': unknown type ' + j.type);
    }
    var out = {
      name: name,
      kind: kind === 'nether_cave' ? 'cave' : kind,
      probability: +c.probability,
      y: heightProvider(c.y),
      lavaLevel: anchor(c.lava_level),
      yScale: floatProvider(c.yScale, name + '.yScale'),
    };
    if (out.kind === 'cave') {
      out.hMult = floatProvider(c.horizontal_radius_multiplier, name + '.horizontal_radius_multiplier');
      out.vMult = floatProvider(c.vertical_radius_multiplier, name + '.vertical_radius_multiplier');
      out.floorLevel = floatProvider(c.floor_level, name + '.floor_level');
    } else {
      var s = c.shape || {};
      out.vRot = floatProvider(c.vertical_rotation, name + '.vertical_rotation');
      out.hFactor = floatProvider(s.horizontal_radius_factor, name + '.horizontal_radius_factor');
      out.vDefault = +s.vertical_radius_default_factor;
      out.vCenter = +s.vertical_radius_center_factor;
      out.distFactor = floatProvider(s.distance_factor, name + '.distance_factor');
      out.thickness = floatProvider(s.thickness, name + '.thickness');
      out.smoothness = s.width_smoothness | 0;
    }
    if (!(out.probability > 0 && out.probability <= 1)) {
      throw new Error('carver ' + name + ': probability ' + c.probability);
    }
    return out;
  }

  // ── the walk ───────────────────────────────────────────────────────────────────────────────
  //
  // A path is a list of ELLIPSOIDS: centre (x, y, z), horizontal radius, vertical radius, and
  // the floor level that cuts the bottom off. They are emitted into per-target-chunk buckets as
  // they are produced, so nothing but the buckets is ever kept.

  var NODE = 6;                 // x, y, z, hr, vr, floor

  function Bucketer(scx, scz) {
    this.scx = scx; this.scz = scz;
    this.map = new Map();       // targetKey -> array of numbers
    this.count = 0;
  }
  Bucketer.prototype.add = function (x, y, z, hr, vr, floor) {
    if (y - vr > MAXY || y + vr < MINY) return;
    // every chunk the ellipsoid's bounding box touches, clipped to the carver's own range —
    // beyond that the target chunk would not have asked this source for anything anyway
    var cx0 = Math.floor((x - hr) / 16), cx1 = Math.floor((x + hr) / 16);
    var cz0 = Math.floor((z - hr) / 16), cz1 = Math.floor((z + hr) / 16);
    if (cx0 < this.scx - RANGE) cx0 = this.scx - RANGE;
    if (cx1 > this.scx + RANGE) cx1 = this.scx + RANGE;
    if (cz0 < this.scz - RANGE) cz0 = this.scz - RANGE;
    if (cz1 > this.scz + RANGE) cz1 = this.scz + RANGE;
    for (var cz = cz0; cz <= cz1; cz++) {
      for (var cx = cx0; cx <= cx1; cx++) {
        var key = sourceKey(cx, cz);
        var a = this.map.get(key);
        if (!a) { a = []; this.map.set(key, a); }
        a.push(x, y, z, hr, vr, floor);
        this.count++;
      }
    }
  };
  Bucketer.prototype.freeze = function () {
    var out = new Map();
    this.map.forEach(function (a, k) { out.set(k, Float32Array.from(a)); });
    return out;
  };

  /**
   * The cave carver. Vanilla's shape: a small number of ORIGINS in the source chunk, each with a
   * one-in-four chance of a ROOM and then one to four TUNNELS out of it.
   *
   * ⚠ `nextInt(nextInt(nextInt(15) + 1) + 1)` is not a typo and not equivalent to `nextInt(15)`.
   * The triple nesting is what makes most chunks produce nothing and a rare one produce a knot
   * of a dozen tunnels, which is the difference between "caves everywhere" and "cave systems".
   */
  function caveWalk(cfg, r, scx, scz, out) {
    var steps = (WALK_RANGE * 2 - 1) * 16;            // 112: the longest a tunnel may be
    var origins = r.nextInt(r.nextInt(r.nextInt(15) + 1) + 1);
    for (var k = 0; k < origins; k++) {
      var x = (scx << 4) + r.nextInt(16);
      var y = cfg.y(r);
      var z = (scz << 4) + r.nextInt(16);
      var hMult = cfg.hMult(r), vMult = cfg.vMult(r), floor = cfg.floorLevel(r);
      var branches = 1;
      if (r.nextInt(4) === 0) {
        var yScale = cfg.yScale(r);
        var thick = 1 + r.nextFloat() * 6;
        // the ROOM: one fat ellipsoid where several tunnels meet
        out.add(x, y, z, 1.5 + thick, (1.5 + thick) * yScale, floor);
        branches += r.nextInt(4);
      }
      for (var b = 0; b < branches; b++) {
        var yaw = r.nextFloat() * Math.PI * 2;
        var pitch = (r.nextFloat() - 0.5) / 4;
        var thickness = tunnelThickness(r);
        var len = steps - r.nextInt(steps / 4 | 0);
        tunnel(r, out, x, y, z, hMult, vMult, floor, thickness, yaw, pitch, 0, len, 1.0, 0);
      }
    }
  }

  /** Vanilla's `getThickness`: usually 0–3, with a one-in-ten chance of something much fatter. */
  function tunnelThickness(r) {
    var f = r.nextFloat() * 2 + r.nextFloat();
    if (r.nextInt(10) === 0) f *= r.nextFloat() * r.nextFloat() * 3 + 1;
    return f;
  }

  /**
   * One tunnel: a walk that turns slowly, bobs slowly, and splits once into two right-angled
   * children. `depth` bounds the recursion — vanilla's own split is unconditional at one level
   * because each child returns immediately after spawning, and this keeps that true.
   */
  function tunnel(r, out, x, y, z, hMult, vMult, floor, thickness, yaw, pitch, step, steps, yScale, depth) {
    var branchAt = r.nextInt(steps / 2 | 0) + (steps / 4 | 0);
    var steepen = r.nextInt(6) === 0;
    var yawD = 0, pitchD = 0;
    for (; step < steps; step++) {
      // ⚠ the radius is a SINE over the tunnel's length, so a tunnel is thin at both ends and
      // widest in the middle. A constant radius reads as a pipe; this reads as a cave.
      var hr = 1.5 + Math.sin(Math.PI * step / steps) * thickness;
      var vr = hr * yScale;
      hr *= hMult; vr *= vMult;
      var cosP = Math.cos(pitch), sinP = Math.sin(pitch);
      x += Math.cos(yaw) * cosP;
      y += sinP;
      z += Math.sin(yaw) * cosP;
      pitch *= steepen ? 0.92 : 0.7;
      pitch += pitchD * 0.1;
      yaw += yawD * 0.1;
      pitchD *= 0.9;
      yawD *= 0.75;
      pitchD += (r.nextFloat() - r.nextFloat()) * r.nextFloat() * 2;
      yawD += (r.nextFloat() - r.nextFloat()) * r.nextFloat() * 4;
      if (y < MINY + 2 || y > MAXY - 2) return;
      if (step === branchAt && thickness > 1 && steps > 0 && depth < 1) {
        tunnel(r, out, x, y, z, hMult, vMult, floor, r.nextFloat() * 0.5 + 0.5,
               yaw - Math.PI / 2, pitch / 3, step, steps, 1.0, depth + 1);
        tunnel(r, out, x, y, z, hMult, vMult, floor, r.nextFloat() * 0.5 + 0.5,
               yaw + Math.PI / 2, pitch / 3, step, steps, 1.0, depth + 1);
        return;
      }
      // three steps in four. The gaps are what stop a tunnel from being a smooth extrusion.
      if (r.nextInt(4) !== 0) out.add(x, y, z, hr, vr, floor);
    }
  }

  /**
   * The canyon carver — a ravine. Same walk, but the horizontal radius is multiplied by a
   * 1,024-entry table of random factors smoothed over `width_smoothness` neighbours, which is
   * what gives a ravine its scalloped walls, and `yScale` 3 makes it a slot rather than a tube.
   */
  function canyonWalk(cfg, r, scx, scz, out) {
    var x = (scx << 4) + r.nextInt(16);
    var y = cfg.y(r);
    var z = (scz << 4) + r.nextInt(16);
    var yaw = r.nextFloat() * Math.PI * 2;
    var pitch = cfg.vRot(r);
    var thickness = cfg.thickness(r);
    var yScale = cfg.yScale(r);            // 3 for the overworld canyon
    var hFactor = cfg.hFactor(r);
    var distFactor = cfg.distFactor(r);
    var steps = (WALK_RANGE * 2 - 1) * 16;
    var len = steps - r.nextInt(steps / 4 | 0);
    len = (len * distFactor) | 0;

    // the width table, and then the smoothing pass over it
    var w = new Float32Array(1024);
    var f = 1;
    for (var i = 0; i < 1024; i++) {
      if (i === 0 || r.nextInt(3) === 0) f = 1 + r.nextFloat() * r.nextFloat();
      w[i] = f * f;
    }
    var sm = cfg.smoothness;
    if (sm > 0) {
      var w2 = new Float32Array(1024);
      for (i = 0; i < 1024; i++) {
        var s = 0, n = 0;
        for (var d = -sm; d <= sm; d++) {
          var j = i + d;
          if (j < 0 || j >= 1024) continue;
          s += w[j]; n++;
        }
        w2[i] = s / n;
      }
      w = w2;
    }

    var yawD = 0, pitchD = 0;
    for (var step = 0; step < len; step++) {
      var hr = 1.5 + Math.sin(Math.PI * step / len) * thickness;
      var vr = hr * yScale;
      hr *= hFactor;
      var cosP = Math.cos(pitch), sinP = Math.sin(pitch);
      x += Math.cos(yaw) * cosP;
      y += sinP;
      z += Math.sin(yaw) * cosP;
      pitch *= 0.7;
      pitch += pitchD * 0.05;
      yaw += yawD * 0.05;
      pitchD *= 0.8;
      yawD *= 0.5;
      pitchD += (r.nextFloat() - r.nextFloat()) * r.nextFloat() * 2;
      yawD += (r.nextFloat() - r.nextFloat()) * r.nextFloat() * 4;
      if (y < MINY + 2 || y > MAXY - 2) return;
      if (r.nextInt(4) === 0) continue;
      // ⚠ A ravine is written out as a STACK OF DISCS, one per block of height, rather than as
      // one ellipsoid — because the width table is indexed by y, and a single node has one
      // horizontal radius for its whole height. Each disc's radius is the ellipsoid's own
      // profile at that height TIMES the table's factor, so the shape is still the ellipsoid
      // vanilla carves and the table only scallops its walls.
      //
      // ⚠ The `sqrt(1 - ry²)` is the load-bearing part and the first draft did not have it: a
      // stack of full-width discs is a CYLINDER, and with `yScale` 3 that turned a 20-block
      // ravine into a 45-block-tall, 50-block-wide cathedral with a flat roof. It was obvious
      // in a cross-section and invisible in every number the check was measuring at the time.
      var yTop = Math.floor(y + vr), yBot = Math.ceil(y - vr);
      if (yTop > MAXY - 2) yTop = MAXY - 2;
      if (yBot < MINY + 2) yBot = MINY + 2;
      for (var wy = yBot; wy <= yTop; wy++) {
        var ry = (wy + 0.5 - y) / vr;
        var prof = 1 - ry * ry;
        if (prof <= 0) continue;
        var rr = hr * w[(wy - MINY) & 1023] * Math.sqrt(prof);
        if (rr < 0.8) continue;
        out.add(x, wy + 0.5, z, rr, 0.5, -1);
      }
    }
  }

  // ── the cache ──────────────────────────────────────────────────────────────────────────────
  //
  // Source chunk -> Map(target chunk -> Float32Array of nodes). Insertion-ordered, evicted from
  // the front once it is too large: a source that is evicted and later regenerated produces
  // exactly the same numbers, so eviction can never change the world — only the time it takes.

  var CACHE_MAX = 1400;         // ~5 target chunks' worth of neighbourhood, in practice
  CV.cache = new Map();
  CV.cacheHits = 0; CV.cacheMisses = 0; CV.nodesBuilt = 0;

  // ⚠ 22 bits each, packed into one double. It is exact to +/-2,097,152 chunks — 33 million
  // blocks, a hundred times the world MC-Lite will ever have — and a Map keyed by a number
  // rather than by a string is what keeps the 289 lookups per chunk off the profile.
  function sourceKey(cx, cz) { return (cx & 0x3FFFFF) * 4194304 + (cz & 0x3FFFFF); }
  function unkey(key) {
    var cx = Math.floor(key / 4194304), cz = key - cx * 4194304;
    return [cx >= 0x200000 ? cx - 0x400000 : cx, cz >= 0x200000 ? cz - 0x400000 : cz];
  }
  CV.keyOf = sourceKey;
  CV.unkey = unkey;

  function pathsOf(scx, scz) {
    var key = sourceKey(scx, scz);
    var got = CV.cache.get(key);
    if (got) { CV.cacheHits++; return got; }
    CV.cacheMisses++;
    var out = new Bucketer(scx, scz);
    var seed = CV.G ? (CV.G.seed | 0) : 0;
    for (var i = 0; i < CV.list.length; i++) {
      var cfg = CV.list[i];
      var r = rngFor(seed, scx, scz, i);
      // ⚠ the probability roll happens FIRST and unconditionally, so it consumes the same draw
      // whether or not the carver runs. A roll made after some other branch would make the walk
      // depend on the branch, and then two chunks with the same seed could disagree.
      if (r.nextFloat() > cfg.probability) continue;
      if (cfg.kind === 'cave') caveWalk(cfg, r, scx, scz, out);
      else canyonWalk(cfg, r, scx, scz, out);
    }
    var frozen = out.freeze();
    CV.nodesBuilt += out.count;
    CV.cache.set(key, frozen);
    if (CV.cache.size > CACHE_MAX) {
      var it = CV.cache.keys();
      for (var n = CV.cache.size - CACHE_MAX; n > 0; n--) CV.cache.delete(it.next().value);
    }
    return frozen;
  }
  CV.pathsOf = pathsOf;

  /** Every node any source within range contributes to this chunk. For tests and for tools. */
  CV.nodesFor = function (cx, cz) {
    var key = sourceKey(cx, cz), out = [];
    for (var dz = -RANGE; dz <= RANGE; dz++) {
      for (var dx = -RANGE; dx <= RANGE; dx++) {
        var a = pathsOf(cx + dx, cz + dz).get(key);
        if (a) for (var i = 0; i < a.length; i++) out.push(a[i]);
      }
    }
    return out;
  };

  // ── the carve ──────────────────────────────────────────────────────────────────────────────

  /**
   * carveChunk(SB, cx, cz, cH, sea) — apply every carver that reaches this chunk, in place.
   *
   * ⚠ Two protections, and both are load-bearing:
   *   * only `CARVABLE_BLOCKS` are removed, so a carver passing through an ore body or a
   *     structure leaves it standing, exactly as vanilla's does;
   *   * nothing is carved within six blocks of the surface of an UNDERWATER column (D-66).
   *     Vanilla stops the same hole with aquifers, which MC-Lite fakes rather than simulates;
   *     without this rule a tunnel that clips an ocean floor drains the ocean into the cave
   *     system, and the player finds a sea with a hole in it.
   */
  CV.carveChunk = function (SB, cx, cz, cH, sea) {
    if (!CV.ready) return 0;
    var ID = CV.G.ids, LAVA = ID.lava, WATER = ID.water, CAVE_AIR = ID.cave_air;
    var key = sourceKey(cx, cz);
    var ox = cx << 4, oz = cz << 4;
    var carved = 0;

    // the per-column ceiling, computed once: above this the column is either open air or too
    // close to an ocean floor to touch
    var ceil = CV.scratchCeil || (CV.scratchCeil = new Int32Array(256));
    var aq = CV.scratchAq || (CV.scratchAq = new Float32Array(256));
    for (var i = 0; i < 256; i++) {
      var h = cH[i];
      ceil[i] = h < sea ? Math.min(h - 6, sea - 6) : h;
      aq[i] = (NS.Caves && NS.Caves.aquiferLevel) ? NS.Caves.aquiferLevel(ox + (i & 15), oz + (i >> 4)) : -1000;
    }

    for (var dz = -RANGE; dz <= RANGE; dz++) {
      for (var dx = -RANGE; dx <= RANGE; dx++) {
        var nodes = pathsOf(cx + dx, cz + dz).get(key);
        if (!nodes) continue;
        for (var n = 0; n < nodes.length; n += NODE) {
          carved += ellipsoid(SB, ox, oz, ceil, aq, LAVA, WATER, CAVE_AIR,
                              nodes[n], nodes[n + 1], nodes[n + 2], nodes[n + 3], nodes[n + 4], nodes[n + 5]);
        }
      }
    }
    CV.lastCarved = carved;
    return carved;
  };

  // Resolved at init from the configured carvers, which must all agree. See `Carvers.init`.
  var carverLavaLevel = -56;
  CV.lavaLevel = function () { return carverLavaLevel; };

  function ellipsoid(SB, ox, oz, ceil, aq, LAVA, WATER, CAVE_AIR, x, y, z, hr, vr, floor) {
    var x0 = Math.floor(x - hr) - ox, x1 = Math.floor(x + hr) - ox;
    var z0 = Math.floor(z - hr) - oz, z1 = Math.floor(z + hr) - oz;
    if (x1 < 0 || x0 > 15 || z1 < 0 || z0 > 15) return 0;
    if (x0 < 0) x0 = 0; if (x1 > 15) x1 = 15;
    if (z0 < 0) z0 = 0; if (z1 > 15) z1 = 15;
    var y0 = Math.floor(y - vr), y1 = Math.floor(y + vr);
    if (y0 < MINY + 1) y0 = MINY + 1;
    if (y1 > MAXY - 1) y1 = MAXY - 1;
    if (y1 < y0) return 0;
    var n = 0;
    for (var lz = z0; lz <= z1; lz++) {
      var rz = (oz + lz + 0.5 - z) / hr;
      var rz2 = rz * rz;
      if (rz2 >= 1) continue;
      for (var lx = x0; lx <= x1; lx++) {
        var rx = (ox + lx + 0.5 - x) / hr;
        var rx2 = rx * rx;
        if (rx2 + rz2 >= 1) continue;
        var ci = (lz << 4) | lx;
        var top = ceil[ci];
        var water = aq[ci];
        var col = ci;
        for (var wy = y0; wy <= y1; wy++) {
          if (wy > top) break;
          var ry = (wy + 0.5 - y) / vr;
          // ⚠ vanilla's `shouldSkip`: the floor level cuts the BOTTOM off the ellipsoid, which
          // is what gives a cave a floor to walk on instead of a round bottom to slide down.
          if (ry <= floor) continue;
          if (rx2 + ry * ry + rz2 >= 1) continue;
          var ly = wy - MINY;
          if (ly < 1 || ly >= H) continue;
          var si = (ly << 8) | col;
          var st = SB[si];
          if (!carvable[st]) continue;
          // ⚠ THIS IS WHERE `cave_air` GOES, AND IT IS NOT HERE YET (D-256, D-262). Vanilla's
          // carvers write `cave_air`; MC-Lite writes plain air, and the ONE line above is the
          // whole of the difference — but flipping it alone moves 6.5 ore and feature cells a
          // chunk, because about twenty-five places in the feature and surface code still ask
          // "is this air?" as `=== 0`. `States.isAir` exists for them (D-262) and they have not
          // been converted, so the line stays as it was until they are. `CAVE_AIR` is resolved
          // and threaded through to here so that the change is one line when the tests are ready.
          SB[si] = wy <= carverLavaLevel ? LAVA : (water > -900 && wy <= water ? WATER : 0);
          n++;
        }
      }
    }
    return n;
  }
  CV.ellipsoidCount = ellipsoid;
})(MCL);
