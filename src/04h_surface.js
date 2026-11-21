// 04h_surface.js — the surface rules. PLAN W6.
// Runs on: main thread AND workers. No DOM.
//
// W3 says how high the ground is. W4 and W5 say which biome it is. This says what it is MADE
// OF: grass on dirt, sand at a shoreline, gravel under a cold ocean, terracotta bands in a
// mesa, deepslate below y = 0, bedrock at the bottom.
//
// It is an interpreter over Mojang's `surface_rule` tree out of
// `noise_settings/overworld.json` — 4 rule types and 11 condition types, 10 KB of tree, 97
// `block` placements. Nothing here is invented: the tree is data and this file is the machine
// that runs it, which is the only shape under which the answer can be *checked* against the
// game rather than against somebody's memory of it.
//
// ── THE TREE IS COMPILED ONCE, NOT WALKED PER BLOCK ──────────────────────────────────────
// `Surface.init` turns the JSON into a tree of closures, exactly as Mojang's `RuleSource.apply`
// turns it into a tree of `SurfaceRule` objects. That resolves every block state, every biome
// name and every noise reference once instead of once per block — and a chunk asks this
// question about 12,000 times.
//
// ── HOW RIGHT THESE RULES ACTUALLY ARE, MEASURED (D-230) ─────────────────────────────────
// ⚠ BEFORE CHANGING ANYTHING HERE TO CHASE A `vanillacheck` §3 NUMBER, READ THIS. Every
// disagreement with the golden world was split on whether the two engines' GROUND — the topmost
// block that is neither air, vegetation, fluid nor the ice/snow cap — sits at the identical y.
// If it does, the two engines were asked the same question and answered differently, and THAT
// is a rule bug. If it does not, the sea filled the gap and a height residual is wearing a
// rule's clothes: `grass_block` becomes `water` while the top-block residual still reads zero.
// Over 61,440 golden columns at seed 1337: **361 columns (0.60%) disagree with the ground at
// the identical y, and 190 of those are an iceberg**, which is a feature. At seed 4242 it is
// 0.50%. Every biome D-225 moved is the other bucket — desert rule 0.16% / height 14.0%,
// jungle 0.75% / 16.7%, plains 0.55% / 9.1%, river 0.50% / 11.8%, forest 0.80% / 8.5%, and
// `old_growth_birch_forest`, the worst row in the ledger at 77.5%, is 0.20% / 26.9% at seed
// 1337 and 89.5% agreement at seed 4242, which is one inlet the sample drew and not a rule.
// The interpreter below is not where those points are. `04d_column.js`'s header says where.
//
// ── WHAT DEVIATION #1 CHANGES, AND IT IS ONE THING ───────────────────────────────────────
// Vanilla's terrain has overhangs, so a column can be stone, then air, then stone again, and
// the surface rules have to be told which "run" of stone they are inside: `stoneDepthAbove`
// counts down from the top of the current run and `stoneDepthBelow` counts up from its bottom.
// MC-Lite has no overhangs (PLAN W0's deviation #1 dropped the 3D density term), so every
// column is exactly one run — solid from the world floor to the surface — and the two depths
// are arithmetic rather than a scan:
//
//     stoneDepthAbove = surfaceY - y + 1        stoneDepthBelow = y - minY + 1
//
// The condition that has to be reconstructed rather than ported is `above_preliminary_surface`.
// Vanilla's is:
//
//     minSurfaceLevel = bilerp(preliminarySurfaceLevel at the four corners of the 16x16 cell)
//                     + surfaceDepth - 8
//
// where `preliminarySurfaceLevel` scans the COARSE cell grid downward — cells are 8 blocks tall
// — and returns the first y whose density is >= 0.390625, which is not the surface but a point
// comfortably INSIDE the terrain. MC-Lite has no density field to scan, so the scan is replaced
// by its answer: the highest multiple of 8 at or below `height - 8`. Everything else — the
// bilerp, the `+ surfaceDepth - 8`, the 16-block cell — is vanilla's, unchanged.
//
// ⚠ This condition is not cosmetic and it is not free to get wrong in either direction. It is
// what stops the surface rules running on every block of a 300-block column: below it the tree
// falls through in four comparisons instead of walking 130 nodes, which is the difference
// between 30 ms and 3 ms of surface rules per chunk. An earlier draft of this file made it
// simply `true` — on the argument that with no overhangs there is no underside to protect — and
// it was both slower and wrong, because it let the badlands band rule paint terracotta from a
// mesa's top all the way down to y = 63.
//
// ── ⚠ THE SAND IN THE PLAINS IS NOT THIS FILE'S (D-215) ──────────────────────────────────
// A 49-chunk all-`plains` sample was 58% sand on top and was reported as "a surface rule laying
// beach across an inland biome". It is not: the same box generated with `features:false` is
// 99.2% grass_block and 0.0% sand, and `surfcheck` §8 now audits 331,776 columns of 29 biomes
// against the blocks vanilla's own tree is allowed to place in each — `sand` is gated to six
// biomes here and reaches no other one. The sand is `disk_sand`, whose vanilla gate (the disk is
// anchored to water) lives in `04j_features.js`. Read D-215 before changing anything in here on
// the strength of a sandy plains.
//
(function (NS) {
  'use strict';

  var SF = NS.Surface = {};

  SF.ready = false;
  SF.seed = 0;

  var C = null;              // NS.Column, after init
  var noises = null;         // name -> NS.Noise.Normal, built on first use
  var noiseSeed = 0n;
  var factory = null;        // the positional random factory, forked from the world seed
  var gradFactories = null;  // vertical_gradient's named sub-factories
  var rule = null;           // the compiled tree
  var clayBands = null;      // 192 real states
  var minY = -64, worldTop = 256, seaLevel = 63;
  var DEFAULT_STATE = 0;     // stone: what the rules replace, and what they fall back to

  // ── the context ─────────────────────────────────────────────────────────────────────────
  // A singleton, updated in place. `apply` is called ~12,000 times per chunk and an object per
  // call would be a garbage collection in the middle of world generation.
  var cx = 0, cy = 0, cz = 0;
  var cBiome = 0, cSurfaceY = 0, cWaterY = 0;
  var cSurfaceDepth = 0, cSecondary = 0, cMinSurface = 0;
  var cStoneAbove = 0, cStoneBelow = 0;
  var NO_WATER = -2147483648;          // vanilla's Integer.MIN_VALUE sentinel
  SF.NO_WATER = NO_WATER;

  /**
   * init(seed) — build the noises, the random factories, the clay bands and the compiled rule.
   * Requires `WG.init`, `States.build` and `Column.init` to have run.
   */
  SF.init = function (seed) {
    if (!NS.WG || !NS.WG.ready) throw new Error('Surface.init before WG.init');
    if (!NS.States || !NS.States.ready) throw new Error('Surface.init before the registry decoded');
    var t = (NS.U && NS.U.now) ? NS.U.now() : Date.now();
    SF.seed = seed;
    C = NS.Column;
    minY = C && C.ready ? C.minY : -64;
    worldTop = C && C.ready ? C.worldTop : 256;
    seaLevel = C && C.ready ? C.seaLevel : 63;

    var big = typeof seed === 'bigint' ? seed : BigInt(seed >>> 0);
    factory = NS.Noise.Xoro.fromSeed(big).forkPositional();
    // ⚠ BUILT ON DEMAND, not `Noise.all`. The registry has sixty noise fields; the surface rules
    // name nine of them. `Noise.all` costs about 30 ms and a few megabytes per thread, on the
    // main thread and in every worker, to build fifty-one octave stacks nothing will ask for.
    noiseSeed = big;
    noises = Object.create(null);
    gradFactories = Object.create(null);

    DEFAULT_STATE = NS.States.stateOf('stone');
    if (!DEFAULT_STATE) throw new Error('Surface.init: the registry has no stone');

    clayBands = buildClayBands();

    var ns = NS.WG.get('noise_settings', 'overworld');
    if (!ns || !ns.surface_rule) throw new Error('Surface.init: noise_settings/overworld has no surface_rule');
    SF.stats = { rules: 0, conditions: 0, blocks: 0, unresolved: [] };
    rule = compileRule(ns.surface_rule);
    deepMax = analyseGuard(ns.surface_rule);
    analyseConstRun(ns.surface_rule);
    SF.stats.deepMax = deepMax;
    SF.stats.constRun = [runLo, runHi, runState];
    SF.ready = true;
    SF.initMs = ((NS.U && NS.U.now) ? NS.U.now() : Date.now()) - t;
    return SF;
  };

  // ── the clay bands ──────────────────────────────────────────────────────────────────────
  //
  // Mojang's `SurfaceSystem.generateBands`, from `randomFactory.fromHashOf("minecraft:clay_bands")`.
  // 192 states of terracotta with orange, yellow, brown, red and white-with-grey-edges bands cut
  // into it, and `getBand` indexes it by y plus a noise offset — which is what makes a mesa's
  // stripes wander instead of being flat.
  //
  // ⚠ The orange pass advances its index TWICE per iteration: once by the loop's own `i++` and
  // once by `i += nextInt(5) + 1`. Writing it as a single stride is the obvious simplification
  // and gives different bands.
  function buildClayBands() {
    var rnd = factory.fromHashOf('minecraft:clay_bands');
    var st = function (n) {
      var s = NS.States.stateOf(n);
      if (!s) throw new Error('the clay bands name a block the registry does not have: ' + n);
      return s;
    };
    var TERRACOTTA = st('terracotta');
    var bands = new Int32Array(192);
    var i;
    for (i = 0; i < 192; i++) bands[i] = TERRACOTTA;
    for (i = 0; i < 192; i++) {
      i += rnd.nextInt(5) + 1;
      if (i < 192) bands[i] = st('orange_terracotta');
    }
    makeBands(rnd, bands, 1, st('yellow_terracotta'));
    makeBands(rnd, bands, 2, st('brown_terracotta'));
    makeBands(rnd, bands, 1, st('red_terracotta'));
    var n = rnd.nextIntBetweenInclusive(9, 15);
    var k = 0;
    var white = st('white_terracotta'), grey = st('light_gray_terracotta');
    for (var l = 0; k < n && l < 192; l += rnd.nextInt(16) + 4) {
      bands[l] = white;
      if (l - 1 > 0 && rnd.nextInt(2) === 0) bands[l - 1] = grey;
      if (l + 1 < 192 && rnd.nextInt(2) === 0) bands[l + 1] = grey;
      k++;
    }
    return bands;
  }
  function makeBands(rnd, out, minSize, state) {
    var n = rnd.nextIntBetweenInclusive(6, 15);
    for (var j = 0; j < n; j++) {
      var k = minSize + rnd.nextInt(3);
      var l = rnd.nextInt(out.length);
      for (var m = 0; l + m < out.length && m < k; m++) out[l + m] = state;
    }
  }
  /** The band at a position. `y + offset` wrapped into 0..191 — a positive modulo, not Java's. */
  SF.band = function (x, y, z) {
    var off = Math.round(noiseNamed('clay_bands_offset').get(x, 0, z) * 4);
    var i = (y + off) % 192;
    return clayBands[i < 0 ? i + 192 : i];
  };
  SF.clayBands = function () { return clayBands; };

  // ── anchors ─────────────────────────────────────────────────────────────────────────────
  // `VerticalAnchor`: absolute, above_bottom, below_top. Resolved at compile time — none of
  // them depends on position.
  function anchorY(a) {
    if (a === null || a === undefined) throw new Error('surface rule: missing vertical anchor');
    if (a.absolute !== undefined) return a.absolute | 0;
    if (a.above_bottom !== undefined) return minY + (a.above_bottom | 0);
    if (a.below_top !== undefined) return worldTop - 1 - (a.below_top | 0);
    throw new Error('surface rule: unknown vertical anchor ' + JSON.stringify(a));
  }
  SF.anchorY = anchorY;

  function noiseNamed(id) {
    var name = String(id).replace('minecraft:', '');
    var n = noises[name];
    if (!n) {
      var p = NS.WG.get('noise', name);
      if (!p) throw new Error('surface rule names a noise the registry does not have: ' + id);
      n = noises[name] = NS.Noise.fromParameters(noiseSeed, name, p);
    }
    return n;
  }
  SF.noise = noiseNamed;

  /** Mojang's `Mth.map`. */
  function mapRange(v, a0, a1, b0, b1) { return b0 + (v - a0) * (b1 - b0) / (a1 - a0); }

  // ── conditions ──────────────────────────────────────────────────────────────────────────
  // Each compiles to a zero-argument predicate over the module's context variables.
  function compileCondition(c) {
    if (!c || typeof c.type !== 'string') throw new Error('surface rule: a condition with no type');
    SF.stats.conditions++;
    var t = c.type.replace('minecraft:', '');

    if (t === 'biome') {
      // A flag table over the 61 biomes rather than a name list: this is the condition the tree
      // asks 36 times and a string compare per block would dominate the whole stage.
      var flags = new Uint8Array(NS.Biomes.count);
      for (var i = 0; i < c.biome_is.length; i++) {
        var bi = NS.Biomes.indexOf[c.biome_is[i]];
        if (bi === undefined) throw new Error('surface rule names a biome the registry does not have: ' + c.biome_is[i]);
        flags[bi] = 1;
      }
      return function () { return flags[cBiome] === 1; };
    }

    if (t === 'noise_threshold') {
      var nz = noiseNamed(c.noise);
      var lo = +c.min_threshold, hi = +c.max_threshold;
      return function () { var v = nz.get(cx, 0, cz); return v >= lo && v <= hi; };
    }

    if (t === 'vertical_gradient') {
      // ⚠ Not a smooth blend: BELOW `true_at_and_below` it is always true, ABOVE
      // `false_at_and_above` always false, and BETWEEN them it is a coin flip per block whose
      // bias moves linearly. That is what makes the deepslate line a speckled band rather than
      // a flat cut, and it is why it needs a positional random rather than a noise.
      var name = String(c.random_name);
      if (!gradFactories[name]) gradFactories[name] = factory.fromHashOf(name).forkPositional();
      var gf = gradFactories[name];
      var yLo = anchorY(c.true_at_and_below), yHi = anchorY(c.false_at_and_above);
      return function () {
        if (cy <= yLo) return true;
        if (cy >= yHi) return false;
        var d = mapRange(cy, yLo, yHi, 1, 0);
        return gf.at(cx, cy, cz).nextFloat() < d;
      };
    }

    if (t === 'y_above') {
      var ay = anchorY(c.anchor);
      var ymul = +c.surface_depth_multiplier || 0;
      var yadd = !!c.add_stone_depth;
      return function () {
        return cy + (yadd ? cStoneAbove : 0) >= ay + cSurfaceDepth * ymul;
      };
    }

    if (t === 'water') {
      var woff = c.offset | 0;
      var wmul = +c.surface_depth_multiplier || 0;
      var wadd = !!c.add_stone_depth;
      return function () {
        if (cWaterY === NO_WATER) return true;
        return cy + (wadd ? cStoneAbove : 0) >= cWaterY + woff + cSurfaceDepth * wmul;
      };
    }

    if (t === 'stone_depth') {
      var soff = c.offset | 0;
      var sadd = !!c.add_surface_depth;
      var srange = c.secondary_depth_range | 0;
      var ceiling = c.surface_type === 'ceiling';
      return function () {
        var d = ceiling ? cStoneBelow : cStoneAbove;
        var extra = sadd ? cSurfaceDepth : 0;
        var sec = srange === 0 ? 0 : Math.trunc(mapRange(cSecondary, -1, 1, 0, srange));
        return d <= 1 + soff + extra + sec;
      };
    }

    if (t === 'not') { var inner = compileCondition(c.invert); return function () { return !inner(); }; }

    if (t === 'hole') return function () { return cSurfaceDepth <= 0; };

    if (t === 'above_preliminary_surface') return function () { return cy >= cMinSurface; };

    if (t === 'temperature') {
      return function () { return NS.Biomes.coldEnoughToSnow(cBiome, cx, cy, cz); };
    }

    if (t === 'steep') {
      // ⚠ Vanilla reads the chunk's heightmap and CLAMPS to the chunk edge, so a slope is not
      // steep if it only becomes steep in the next chunk — a chunk-boundary artefact this
      // project will not reproduce, because a world that depends on which chunk you are in is
      // exactly what PLAN W0's determinism rule forbids. `Column.height` has no edges.
      return function () {
        var h = C.height(cx, cz);
        if (C.height(cx, cz + 1) >= C.height(cx, cz - 1) + 4) return true;
        return C.height(cx - 1, cz) >= C.height(cx + 1, cz) + 4;
      };
    }

    throw new Error('surface rule: unknown condition type ' + c.type);
  }

  // ── rules ───────────────────────────────────────────────────────────────────────────────
  // Each compiles to a function returning a real state id, or 0 for "no opinion" — which is
  // what makes `sequence` work: the first rule with an opinion wins.
  function compileRule(r) {
    if (!r || typeof r.type !== 'string') throw new Error('surface rule: a rule with no type');
    SF.stats.rules++;
    var t = r.type.replace('minecraft:', '');

    if (t === 'sequence') {
      var list = r.sequence.map(compileRule);
      var n = list.length;
      return function () {
        for (var i = 0; i < n; i++) { var s = list[i](); if (s !== 0) return s; }
        return 0;
      };
    }

    if (t === 'condition') {
      var cond = compileCondition(r.if_true);
      var then = compileRule(r.then_run);
      return function () { return cond() ? then() : 0; };
    }

    if (t === 'block') {
      SF.stats.blocks++;
      var state = NS.WG.stateOf(r.result_state);
      if (!state && r.result_state.Name !== 'minecraft:air') {
        SF.stats.unresolved.push(JSON.stringify(r.result_state));
      }
      // ⚠ `minecraft:air` really is placed by one rule (a hole in a badlands wall), and air is
      // state 0 — the same number `sequence` reads as "no opinion". So air is returned as a
      // distinct sentinel and unwrapped in `apply`, or the rule after it would win.
      if (r.result_state.Name === 'minecraft:air') return function () { return AIR_SENTINEL; };
      return function () { return state; };
    }

    if (t === 'bandlands') return function () { return SF.band(cx, cy, cz); };

    throw new Error('surface rule: unknown rule type ' + r.type);
  }
  var AIR_SENTINEL = -1;
  SF.AIR_SENTINEL = AIR_SENTINEL;

  // ── the y guard, derived from the tree rather than assumed about it ──────────────────────
  //
  // A full column is 320 blocks and a chunk is 256 columns, so asking the tree about every one
  // of them is 82,000 evaluations — measured at 8 to 13 ms per chunk, which is most of a chunk's
  // whole budget for an answer that is "no opinion" almost everywhere.
  //
  // The saving is available without hard-coding anything about THIS tree, because the top-level
  // sequence's branches are each guarded by a condition whose y range is known at compile time:
  //
  //   * a branch guarded by `vertical_gradient` cannot fire at or above `false_at_and_above`;
  //   * a branch guarded by `above_preliminary_surface` cannot fire below `minSurfaceLevel`.
  //
  // So if EVERY top-level branch is one of those two, the whole rule is silent for
  // `deepMax < y < minSurfaceLevel` and the walk can skip that range. If any branch is neither,
  // `deepMax` becomes the top of the world and nothing is skipped — the analysis degrades to
  // "evaluate everything" rather than to a wrong answer. `surfcheck` compares the guarded walk
  // against the unguarded one over whole columns and requires them to be identical.
  var deepMax = 2147483647;

  function analyseGuard(tree) {
    if (!tree || tree.type !== 'minecraft:sequence') return 2147483647;
    var top = -2147483648, all = true;
    for (var i = 0; i < tree.sequence.length; i++) {
      var e = tree.sequence[i];
      if (!e || e.type !== 'minecraft:condition') { all = false; break; }
      var c = e.if_true, ct = c && String(c.type).replace('minecraft:', '');
      if (ct === 'vertical_gradient') {
        var yh = anchorY(c.false_at_and_above) - 1;
        if (yh > top) top = yh;
      } else if (ct === 'above_preliminary_surface') {
        continue;                       // bounded from below, by the column
      } else { all = false; break; }
    }
    return all ? top : 2147483647;
  }
  /** The highest y at which a branch that is NOT surface-gated can still have an opinion. */
  SF.deepMax = function () { return deepMax; };
  /** The lowest y at which the surface-gated branches can have one, for the current column. */
  SF.minSurface = function () { return cMinSurface; };
  /** Can the tree possibly say anything at this y in the current column? */
  SF.mayApply = function (y) { return y <= deepMax || y >= cMinSurface; };

  // ── the constant run ────────────────────────────────────────────────────────────────────
  //
  // The guard above still leaves the deep half of every column to be asked block by block, and
  // measured that is 18,432 evaluations and 4 ms per chunk for an answer that is "deepslate"
  // every single time. It is the same shape of saving and the same kind of derivation:
  //
  //   a top-level branch guarded by `vertical_gradient` is CONSTANTLY TRUE at or below its
  //   `true_at_and_below`, and if its body is a plain `block` rule then its answer there does
  //   not depend on y at all. If every EARLIER branch is constantly false over the same range —
  //   which for another `vertical_gradient` means being at or above its `false_at_and_above`,
  //   and for `above_preliminary_surface` means being below the column's minimum surface — then
  //   the whole rule is that one block over that whole range, and the generator can fill it.
  //
  // For the overworld tree that is `deepslate` over y = -59 .. 0, which is 60 of the 72 blocks
  // the guard could not remove. Anything the analysis does not recognise leaves the run empty
  // and the walk unchanged; `surfcheck` compares the filled column against a block-by-block
  // walk and requires them to be identical.
  var runLo = 1, runHi = 0, runState = 0;      // empty by default: lo > hi

  function analyseConstRun(tree) {
    runLo = 1; runHi = 0; runState = 0;
    if (!tree || tree.type !== 'minecraft:sequence') return;
    var offAbove = -2147483648, bestSpan = -1;
    for (var i = 0; i < tree.sequence.length; i++) {
      var e = tree.sequence[i];
      if (!e || e.type !== 'minecraft:condition') return;      // an unguarded branch: give up
      var c = e.if_true, ct = c && String(c.type).replace('minecraft:', '');
      if (ct === 'above_preliminary_surface') continue;        // off below the column's minimum
      if (ct !== 'vertical_gradient') return;                  // an unknown guard: give up
      var yLo = anchorY(c.true_at_and_below), yHi = anchorY(c.false_at_and_above);
      var body = e.then_run;
      // ⚠ Clamp the low end to the world floor before comparing spans. Without it the FIRST
      // branch always wins, because `offAbove` starts at negative infinity and every span is
      // infinite — which picked the bedrock branch (a run of exactly one block, at the world
      // floor) over the deepslate one (a run of sixty) and saved nothing.
      var lo = offAbove < minY ? minY : offAbove;
      if (body && body.type === 'minecraft:block' && yLo >= lo) {
        var span = yLo - lo;
        if (span > bestSpan) {
          bestSpan = span; runLo = lo; runHi = yLo;
          runState = NS.WG.stateOf(body.result_state);
        }
      }
      if (yHi > offAbove) offAbove = yHi;
    }
    if (runState === 0) { runLo = 1; runHi = 0; }
  }

  /**
   * constRun() -> [lo, hi, state]: over `lo <= y <= hi` — and below the column's minimum
   * surface level — the rule's answer is exactly `state`, with no evaluation needed. `hi < lo`
   * means the analysis found nothing and every block must be asked.
   */
  SF.constRun = function () { return [runLo, Math.min(runHi, cMinSurface - 1), runState]; };

  // ── the per-column terms ────────────────────────────────────────────────────────────────
  //
  // `surfaceDepth` is how thick the "surface" is here: about 3 blocks, wobbled by a noise and
  // jittered by a quarter of a block of positional randomness. It is what makes a beach three
  // to five sand deep instead of exactly four, and half the tree's conditions read it.

  /** Mojang's `SurfaceSystem.getSurfaceDepth`. */
  SF.surfaceDepthAt = function (x, z) {
    var d = noiseNamed('surface').get(x, 0, z);
    return Math.trunc(d * 2.75 + 3 + factory.at(x, 0, z).nextDouble() * 0.25);
  };
  /** Mojang's `getSurfaceSecondaryDepth`. Only `stone_depth` with a non-zero range reads it. */
  SF.secondaryDepthAt = function (x, z) { return noiseNamed('surface_secondary').get(x, 0, z); };

  // ── the preliminary surface ─────────────────────────────────────────────────────────────
  //
  // See the header. The four corners of the 16x16 cell are memoised because a chunk IS one
  // cell: without the memo this would cost four column evaluations per block instead of four
  // per chunk.
  var PRELIM_SLACK = 8;              // how far below the surface vanilla's density scan lands
  var CELL = 16, CELL_Y = 8;
  var memCellX = 0x7fffffff, memCellZ = 0x7fffffff;
  var mem00 = 0, mem10 = 0, mem01 = 0, mem11 = 0;

  /** The coarse "solidly inside the terrain" level at a cell corner, on the 8-block grid. */
  function prelimAt(X, Z) {
    return Math.floor((C.height(X, Z) - PRELIM_SLACK) / CELL_Y) * CELL_Y;
  }

  function minSurfaceAt(x, z, surfaceDepth) {
    var cxc = x >> 4, czc = z >> 4;
    if (cxc !== memCellX || czc !== memCellZ) {
      memCellX = cxc; memCellZ = czc;
      mem00 = prelimAt(cxc << 4, czc << 4);
      mem10 = prelimAt((cxc + 1) << 4, czc << 4);
      mem01 = prelimAt(cxc << 4, (czc + 1) << 4);
      mem11 = prelimAt((cxc + 1) << 4, (czc + 1) << 4);
    }
    var fx = (x & 15) / CELL, fz = (z & 15) / CELL;
    var a = mem00 + (mem10 - mem00) * fx;
    var b = mem01 + (mem11 - mem01) * fx;
    return Math.floor(a + (b - a) * fz) + surfaceDepth - 8;
  }
  SF.minSurfaceAt = minSurfaceAt;
  SF.PRELIM_SLACK = PRELIM_SLACK;

  /**
   * beginColumn(x, z, biome, surfaceY, waterY) — set everything that does not vary with y.
   * `waterY` is the y of the lowest water above this column, or `Surface.NO_WATER` for none.
   */
  SF.beginColumn = function (x, z, biome, surfaceY, waterY) {
    cx = x; cz = z; cBiome = biome; cSurfaceY = surfaceY; cWaterY = waterY;
    cSurfaceDepth = SF.surfaceDepthAt(x, z);
    cSecondary = SF.secondaryDepthAt(x, z);
    cMinSurface = minSurfaceAt(x, z, cSurfaceDepth);
    return SF;
  };

  /**
   * at(y) -> the real state for this y in the current column, or 0 to leave the default block.
   *
   * The two stone depths are arithmetic rather than a scan — see the header on why that is
   * exact here and would not be in vanilla.
   */
  SF.at = function (y) {
    cy = y;
    cStoneAbove = cSurfaceY - y + 1;
    cStoneBelow = y - minY + 1;
    var s = rule();
    return s === AIR_SENTINEL ? 0 : s;
  };

  /** Both at once, for a caller that has not called `beginColumn`. Not for an inner loop. */
  SF.stateAt = function (x, y, z, biome, surfaceY, waterY) {
    SF.beginColumn(x, z, biome, surfaceY, waterY === undefined ? NO_WATER : waterY);
    return SF.at(y);
  };

  /** The block the rules replace and fall back to. */
  SF.defaultState = function () { return DEFAULT_STATE; };
  /** The context, for the debug screen and for tests. Read-only. */
  SF.context = function () {
    return { x: cx, y: cy, z: cz, biome: cBiome, surfaceY: cSurfaceY, waterY: cWaterY,
             surfaceDepth: cSurfaceDepth, secondaryDepth: cSecondary, minSurface: cMinSurface,
             stoneDepthAbove: cStoneAbove, stoneDepthBelow: cStoneBelow };
  };
})(MCL);
