// 04j_features.js — the feature pipeline (PLAN W8). Runs on the main thread AND the workers.
//
// A "feature" in 1.18 is two pieces of data and no code of its own:
//
//   a CONFIGURED feature   what to build — an ore blob of size 9, a tree with this trunk and
//                          that foliage, a patch of these flowers. 184 of them.
//   a PLACED feature       where to try — a chain of PLACEMENT MODIFIERS that takes one
//                          position and returns zero or many. 220 of them, over 15 modifier
//                          types (14 in the overworld).
//
// A biome then lists placed features per DECORATION STEP, and the generator runs the steps in
// order. So almost all of W8 is a reader and an interpreter: the numbers are Mojang's, the code
// is the chain evaluator and one generator per feature type.
//
// ── ⚠ THE SAME INVARIANT AS THE CARVERS, AND THE SAME SHAPE OF ANSWER ────────────────────────
//
// A feature does not stay inside the chunk that places it — a tree at the chunk edge leans into
// its neighbour, an ore blob straddles the boundary — so "run this chunk's features" cannot be
// done chunk by chunk. This uses W7's shape and W8's own rule (D-136, and D-123 for the caching
// that makes W7's version of it affordable): to decorate chunk T, run the PLACEMENT of
// every chunk within range of T and keep the part that lands in T. Each source chunk's
// placements depend only on (seed, source chunk), so T's result depends only on (seed, T).
//
// ⚠ Placements are cached per source chunk; the GENERATOR is re-run per target, because what a
// feature writes depends on what is already there — an ore blob replaces stone and leaves a
// diamond alone — and "what is already there" is the target chunk's own business. So the source
// chunk decides WHERE and the target chunk decides WHETHER. That split is what lets a chunk be
// decorated without its neighbours' blocks ever being generated.
//
// ── ⚠ WHAT IS CHEAPENED, AND WHERE THE HEIGHTMAP COMES FROM ──────────────────────────────────
//
// Vanilla evaluates `heightmap` modifiers against the chunk's LIVE heightmaps, which change as
// each feature is placed: a flower placed after a tree sees the tree. MC-Lite evaluates them
// against `Column.height`, the pure function W3 built, plus the sea level — so every heightmap
// query is the terrain BEFORE any feature ran. It costs a little realism where two features in
// the same step interact, and it buys the whole architecture above: a source chunk's placements
// can be computed without generating that chunk's blocks at all (D-134).

(function (NS) {
  'use strict';

  var CFG = NS.CFG;
  var MINY = CFG.WORLD_MIN_Y;
  var MAXY = CFG.WORLD_MAX_Y;
  var H = CFG.CHUNK_H;

  var F = NS.Features = { ready: false, G: null, steps: 11 };

  // One chunk each way. Vanilla's own rule is that a feature may not write outside the 3x3 of
  // its origin chunk, which is why `in_square` offsets are bounded and why the game logs a
  // warning when a feature breaks it.
  var RANGE = 1;
  F.RANGE = RANGE;

  // ── the PRNG (D-124, the same family as the carvers) ────────────────────────────────────────
  var Rng = null;
  function rngFor(seed, cx, cz, salt) {
    if (!Rng) Rng = NS.Carvers.Rng;
    var mix = NS.Carvers.rngFor;
    return mix(seed ^ (salt * 0x45D9F3B), cx, cz, salt);
  }
  F.rngFor = rngFor;

  // ── vertical anchors and providers ─────────────────────────────────────────────────────────
  //
  // ⚠ `below_top` resolves against THIS WORLD'S top, not vanilla's. Vanilla's noise settings
  // declare -64..320 and MC-Lite's world is -64..256 (D-19), so an ore that runs "from y=136 to
  // the top of the world" runs to 255 here rather than 319. Resolving it against vanilla's 320
  // and then discarding everything above 255 would keep the SHAPE of the distribution and throw
  // away a third of the ore; resolving it against our own top keeps the DENSITY, which is what
  // a player notices. `above_bottom` and `absolute` need no such choice — both worlds have the
  // same floor (D-135).
  function anchor(a) {
    if (a === undefined || a === null) throw new Error('feature: missing vertical anchor');
    if (a.absolute !== undefined) return a.absolute | 0;
    if (a.above_bottom !== undefined) return MINY + (a.above_bottom | 0);
    if (a.below_top !== undefined) return MAXY - 1 - (a.below_top | 0);
    throw new Error('feature: unknown vertical anchor ' + JSON.stringify(a));
  }

  /** An `IntProvider`: a bare number, uniform, clamped, weighted_list, or biased_to_bottom. */
  function intProvider(v, what) {
    if (typeof v === 'number') { var k = v | 0; return function () { return k; }; }
    if (!v || !v.type) throw new Error('feature: bad int provider for ' + what);
    var t = v.type.replace('minecraft:', '');
    if (t === 'constant') { var c = v.value | 0; return function () { return c; }; }
    if (t === 'uniform') {
      var lo = v.value.min_inclusive | 0, hi = v.value.max_inclusive | 0;
      return function (r) { return lo + r.nextInt(hi - lo + 1); };
    }
    if (t === 'clamped') {
      var inner = intProvider(v.value.source, what), cl = v.value.min_inclusive | 0, ch = v.value.max_inclusive | 0;
      return function (r) { var x = inner(r); return x < cl ? cl : (x > ch ? ch : x); };
    }
    if (t === 'clamped_normal') {
      // ⚠ a NORMAL distribution, not a range: {mean, deviation} sampled, rounded, then clamped
      // to [min_inclusive, max_inclusive]. `Rng` has no nextGaussian, so this is Box-Muller over
      // a fixed pair of nextFloat draws — same count every call, which is what `run`'s purity
      // rule needs.
      var nm = +v.value.mean, nd = +v.value.deviation;
      var nl = v.value.min_inclusive | 0, nh = v.value.max_inclusive | 0;
      return function (r) {
        var u = r.nextFloat(); if (u < 1e-9) u = 1e-9;
        var g = Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307179586 * r.nextFloat());
        var x = Math.round(nm + g * nd);
        return x < nl ? nl : (x > nh ? nh : x);
      };
    }
    if (t === 'biased_to_bottom') {
      var bl = v.value.min_inclusive | 0, bh = v.value.max_inclusive | 0;
      return function (r) { var x = bl + r.nextInt(bh - bl + 1); return bl + r.nextInt(x - bl + 1); };
    }
    if (t === 'weighted_list') {
      // ⚠ the entries' `data` are themselves providers or bare numbers, and the weights are
      // integers. `trees_plains` is 19:0 and 1:1 — nineteen chunks in twenty get no tree at all.
      var list = v.distribution.map(function (e) {
        return { w: e.weight | 0, f: intProvider(e.data, what) };
      });
      var total = 0;
      for (var i = 0; i < list.length; i++) total += list[i].w;
      return function (r) {
        var x = r.nextInt(total);
        for (var j = 0; j < list.length; j++) { x -= list[j].w; if (x < 0) return list[j].f(r); }
        return list[list.length - 1].f(r);
      };
    }
    throw new Error('feature: unsupported int provider ' + v.type + ' for ' + what);
  }

  /** A `HeightProvider`: uniform, trapezoid, or very_biased_to_bottom over two anchors. */
  function heightProvider(v, what) {
    if (!v || !v.type) throw new Error('feature: bad height provider for ' + what);
    var t = v.type.replace('minecraft:', '');
    var lo = anchor(v.min_inclusive), hi = anchor(v.max_inclusive);
    if (t === 'uniform') {
      return function (r) { return hi <= lo ? lo : lo + r.nextInt(hi - lo + 1); };
    }
    if (t === 'trapezoid') {
      // ⚠ vanilla's TrapezoidHeight: a plateau of `plateau` blocks with linear ramps either
      // side. With no plateau it is a triangle, which is what puts the diamond peak at y=-59.
      var plateau = (v.plateau === undefined ? 0 : v.plateau) | 0;
      return function (r) {
        if (hi <= lo) return lo;
        var span = hi - lo;
        if (plateau >= span) return lo + r.nextInt(span + 1);
        var edge = (span - plateau) / 2 | 0;
        var total = span - edge + 1;
        return lo + r.nextInt(total) + r.nextInt(edge + 1);
      };
    }
    if (t === 'very_biased_to_bottom') {
      var inner = (v.inner === undefined ? 1 : v.inner) | 0;
      return function (r) {
        if (hi <= lo + inner) return lo;
        var a = lo + inner + r.nextInt(hi - lo - inner + 1);
        var b = lo + inner + r.nextInt(a - lo + 1);
        return lo + r.nextInt(b - lo + 1);
      };
    }
    throw new Error('feature: unsupported height provider ' + v.type + ' for ' + what);
  }

  // ── block predicates ───────────────────────────────────────────────────────────────────────
  //
  // ⚠ THE TAGS ARE HAND-WRITTEN, and that is temporary. PLAN G1 builds the tag substrate; until
  // it exists these four sets are typed out from `data/minecraft/tags/blocks/` and asserted by
  // `featcheck`. They are small, they are stable, and a wrong one shows up immediately as an ore
  // that will not place — which is exactly what the histogram check measures.
  var TAGS = {
    'minecraft:base_stone_overworld': ['stone', 'granite', 'diorite', 'andesite', 'tuff', 'deepslate'],
    'minecraft:stone_ore_replaceables': ['stone', 'granite', 'diorite', 'andesite', 'tuff'],
    'minecraft:deepslate_ore_replaceables': ['deepslate', 'tuff'],
    'minecraft:dirt': ['dirt', 'grass_block', 'podzol', 'coarse_dirt', 'mycelium', 'rooted_dirt', 'moss_block'],
    // the Nether's, so a nether ore feature COMPILES rather than being reported as missing —
    // nothing in the overworld runs it, and G19 is where it becomes reachable.
    'minecraft:base_stone_nether': ['netherrack', 'basalt', 'blackstone'],
  };
  var tagSets = null;      // name -> Uint8Array indexed by real state

  function buildTags() {
    var SR = NS.States;
    tagSets = {};
    for (var t in TAGS) {
      var set = new Uint8Array(SR.count), n = 0;
      for (var i = 0; i < TAGS[t].length; i++) {
        var st = SR.stateOf(TAGS[t][i]);
        if (st === 0) throw new Error('tag ' + t + ' names a block the registry does not have: ' + TAGS[t][i]);
        // every STATE of that block, not just its default — deepslate has an axis
        for (var s = 0; s < SR.count; s++) if (SR.name(s) === TAGS[t][i]) { set[s] = 1; n++; }
      }
      set[0] = 0;                                   // air is in no tag
      tagSets[t] = set;
      tagSets[t].size = n;
    }
    return tagSets;
  }
  F.tagSets = function () { return tagSets; };

  // ⚠ THE APPLY-TIME CONTEXT. A block predicate like `would_survive` is a question about the
  // WORLD, not about one state — "could a sugar cane stand here" needs the block below. The
  // placement chain that runs at source time has no world to ask; the one that runs inside a
  // generator does, because it is looking at the target chunk. So predicates read this, and it
  // is null everywhere except inside `applyChunk`. Single-threaded by construction: a worker
  // decorates one chunk at a time.
  var ctx = null;

  // ⚠ AND WHICH WORLD IT READS IS NOT ALWAYS THE TARGET CHUNK'S (D-213). `pureGuard` is set by
  // `guardOk` while it judges a build that reaches past the cell it is asking about; see the
  // header there. A live read that falls OUTSIDE the target chunk also falls through to the pure
  // terrain rather than returning -1, because -1 is not an answer — it is "ask somebody else",
  // and every one of the nine targets would ask a different somebody.
  var pureGuard = false;
  function ctxBlock(x, y, z) {
    if (pureGuard) return terrainAt(x, y, z);
    if (!ctx) return -1;
    var s = getBlock(ctx.SB, ctx.cx, ctx.cz, x, y, z);
    return s < 0 ? terrainAt(x, y, z) : s;
  }

  /**
   * D-441 — the same read as `ctxBlock`, except a cell outside the target chunk (or outside
   * `pureGuard`'s reach) answers "unknown" (-1) instead of falling back to `terrainAt`. See
   * `compilePredicate`'s D-441 note: used ONLY for a fluid predicate's offset, where the pure
   * pre-feature guess is wrong exactly where it matters (a shallow coastal cell a neighbour's own
   * beach feature may since have dried out). Every other predicate keeps `ctxBlock`'s guess.
   */
  function ctxBlockInChunkOnly(x, y, z) {
    if (pureGuard || !ctx) return -1;
    return getBlock(ctx.SB, ctx.cx, ctx.cz, x, y, z);
  }

  /**
   * compilePredicate(json) -> function(state, x, y, z) -> boolean
   * Only the types the overworld's placed features actually use.
   *
   * ⚠ `offset` IS PART OF THE PREDICATE AND WAS BEING DROPPED (D-213). Vanilla's `BlockPredicate`
   * carries a relative offset — "is there grass_block one BELOW me", "is there water one to the
   * east" — and eight of the overworld's predicates use it. Reading them at the origin instead
   * turned `all_of[air here, grass_block below]` into "air and grass_block in the same cell",
   * which is false for every cell in every world: sweet berry bushes, pumpkins, melons, jungle
   * grass, sugar cane and both of the grove's trees have never once generated. The offset is a
   * read of a DIFFERENT cell, so it goes through `ctxBlock` like every other world read here.
   *
   * ⚠⚠ D-441 — QUEUE ROW 0 ITEM 3: SUGAR CANE GENERATED ON DRY LAND, AUDITED TO GROUND TRUTH.
   * `node tools/_cane-guard.mjs` (CANE_TRACE=1) caught it live: at seed 1337, chunk (-20,13), the
   * `matching_fluids:water` offset for a cane at (-309,64,208) reads its -Z neighbour at
   * (-309,63,207) — chunk (-20,12), ONE CHUNK OVER. `ctxBlock` correctly detects the read is
   * outside the target chunk and falls back to `terrainAt` (D-213's rule for every OTHER
   * predicate: a pure function of position every target chunk agrees on) — and `terrainAt` says
   * water, because its rule for a cell above the pre-feature terrain is simply "at or under sea
   * level -> water", with no look at what the neighbour's OWN decoration will actually leave
   * there. The neighbour, once generated in full (`_cane-diag.mjs`'s ground truth), is air: a
   * shallow one-block puddle right at the coast, exactly the shape a `disk_sand`/`disk_gravel` in
   * THAT chunk (D-217's comment above `placeDisk` — anchored on precisely this "at or under sea
   * level" cell, radius up to several blocks) is built to pave into a dry beach. D-213's fallback
   * is right for a tree, where the answer is a guess about GROUND SHAPE that is usually stable
   * across a beach edge; a FLUID check right at the shoreline is the one question D-213's own
   * approximation is worst at, because "shallow, at sea level" is precisely the band a
   * neighbouring beach feature is likeliest to have already dried out.
   *
   * ⚠ THE RULING (pending a `vanillacheck` sweep — this is the provisional call, not a threshold
   * moved to fit one seed, STATE §1): a fluid predicate's offset, when it crosses OUT of the
   * target chunk, answers "not this fluid" rather than guessing from pre-feature terrain. This
   * is D-213's own philosophy — "−1 is ask somebody else, not an answer" — held to for fluids
   * specifically, where the pure guess is demonstrably wrong at exactly the cells this predicate
   * exists to gate. It trades a FALSE NEGATIVE at some chunk borders (a legitimate beach cane
   * that a neighbour's water would have justified, refused because this chunk cannot see it) for
   * removing the FALSE POSITIVE Dan reported (cane standing over open sand with nothing wet
   * anywhere near it) — the visible, reported failure. Every OTHER predicate's offset (would_survive,
   * tag_match, matching_blocks) is UNCHANGED: this ruling is scoped to fluids, per queue item 3.
   */
  function compilePredicate(p) {
    var bare = compileBarePredicate(p);
    var off = p && p.offset;
    if (!off) return bare;
    var dx = off[0] | 0, dy = off[1] | 0, dz = off[2] | 0;
    if (!dx && !dy && !dz) return bare;
    var t = (p.predicate_type || p.type || '').replace('minecraft:', '');
    if (t === 'matching_fluids') {
      return function (st, x, y, z) {
        var ax = x + dx, ay = y + dy, az = z + dz;
        var s = ctxBlockInChunkOnly(ax, ay, az);
        return s >= 0 ? bare(s, ax, ay, az) : false;
      };
    }
    return function (st, x, y, z) {
      var ax = x + dx, ay = y + dy, az = z + dz;
      return bare(ctxBlock(ax, ay, az), ax, ay, az);
    };
  }

  function compileBarePredicate(p) {
    if (!p) return function () { return true; };
    var t = (p.predicate_type || p.type || '').replace('minecraft:', '');
    var SR = NS.States;
    if (t === 'true') return function () { return true; };
    if (t === 'tag_match') {
      var set = tagSets[p.tag];
      if (!set) throw new Error('feature: no hand-written tag set for ' + p.tag);
      return function (st) { return set[st] === 1; };
    }
    if (t === 'block_match') {
      var want = SR.stateOf(p.block.replace('minecraft:', ''));
      return function (st) { return st === want; };
    }
    if (t === 'matching_blocks') {
      var blocks = Array.isArray(p.blocks) ? p.blocks : [p.blocks];
      var set2 = new Uint8Array(SR.count);
      for (var i = 0; i < blocks.length; i++) {
        var nm = blocks[i].replace('minecraft:', '');
        for (var s = 0; s < SR.count; s++) if (SR.name(s) === nm) set2[s] = 1;
      }
      return function (st) { return set2[st] === 1; };
    }
    if (t === 'solid') return function (st) { return NS.States.solid[st] === 1; };
    if (t === 'matching_fluids') {
      // the only two fluids in the game, and `patch_sugar_cane` asks about water beside it
      var fl = new Uint8Array(SR.count);
      var want = Array.isArray(p.fluids) ? p.fluids : [p.fluids];
      for (var fi = 0; fi < want.length; fi++) {
        var fn = String(want[fi]).replace('minecraft:', '');
        for (var fs = 0; fs < SR.count; fs++) if (SR.name(fs) === fn) fl[fs] = 1;
      }
      return function (st) { return fl[st] === 1; };
    }
    // ⚠ `replaceable` is vanilla's "a feature may grow through this": air, water, lava, and the
    // plants. Until G2 gives blocks their material flags, MC-Lite reads the two it has — a
    // block is replaceable when it is air or when it is not solid.
    if (t === 'replaceable') return function (st) { return st === 0 || NS.States.solid[st] !== 1; };
    if (t === 'has_sturdy_face') return function (st) { return NS.States.solid[st] === 1; };
    if (t === 'inside_world_bounds') return function (st, x, y, z) { return y > MINY && y < MAXY; };
    if (t === 'not') { var inner = compilePredicate(p.predicate); return function (st, x, y, z) { return !inner(st, x, y, z); }; }
    if (t === 'all_of') {
      var parts = (p.predicates || []).map(compilePredicate);
      return function (st, x, y, z) {
        for (var k = 0; k < parts.length; k++) if (!parts[k](st, x, y, z)) return false;
        return true;
      };
    }
    if (t === 'any_of') {
      var parts2 = (p.predicates || []).map(compilePredicate);
      return function (st, x, y, z) {
        for (var k = 0; k < parts2.length; k++) if (parts2[k](st, x, y, z)) return true;
        return false;
      };
    }
    // ⚠ `would_survive` asks whether a block could STAND at a position, which in vanilla is
    // each block's own rule. Until G2 gives blocks behaviour, MC-Lite answers the parts it can
    // answer honestly and says so: the space must be free and the block under it must hold the
    // plant up.
    //
    // ⚠ D-441's NOTE: this general reading (used for both `cactus` and `sugar_cane`, next
    // paragraph explains why) does NOT carry sugar_cane's water rule, and does not need to —
    // `patch_sugar_cane`'s own data already states it explicitly as a THIRD sibling in the same
    // `all_of` this predicate sits inside (`any_of` over four `matching_fluids:water` offsets,
    // one per cardinal side). That sibling was the actual site of queue item 3's bug: fixed at
    // its root in `compilePredicate`'s D-441 note above, not here. Cactus's own extra rule (no
    // solid block on any of its four sides) is a real, separate, still-open gap in this same
    // "general reading" — named so nobody mistakes this comment for having closed it.
    // ⚠ D-222 — AND "SOLID" WAS NOT THE RULE FOR THE ONE BLOCK THIS PREDICATE IS MOSTLY ABOUT.
    // Thirty of the thirty-two `would_survive` predicates in the overworld's data name a SAPLING,
    // and vanilla's `SaplingBlock.mayPlaceOn` is `state.is(BlockTags.DIRT) || FARMLAND` — not
    // "solid". Reading it as "solid" let a tree stand on terracotta, red sand, stone and gravel,
    // and MEASURED against the 1.18.2 server at seed 1337 that is most of what a wooded badlands
    // is made of: 4.77 trunks a chunk against the real game's 0.77. This is the sapling's own
    // rule, off the same `minecraft:dirt` tag the rest of this file already carries.
    //
    // The other two uses — `cactus` and `sugar_cane`, one each — stay on the general reading:
    // both are placed through `block_column`, whose `allowed_placement` predicate does the real
    // work, and both of vanilla's rules need a SIDEWAYS read (sand-or-cactus below and no solid
    // neighbour; water within one block) that G2 is the place for.
    //
    // ⚠⚠ D-241 — AND THE SAPLING BRANCH ASKED FOR ONE THING VANILLA DOES NOT ASK FOR: that the
    // CELL ITSELF BE AIR. `BlockPredicate.wouldSurvive` is `state.canSurvive(level, pos)` and
    // nothing else, and `SaplingBlock` inherits `BushBlock.canSurvive`, which reads the block
    // BELOW and never looks at the cell it is standing in. The extra clause is invisible in
    // every biome whose trees come off a MOTION_BLOCKING heightmap — that y is above the water,
    // so the block below is water and the dirt test refuses the column anyway — and it deletes
    // A SWAMP. `trees_swamp` is `heightmap OCEAN_FLOOR`, which is the ground plus one, and in a
    // swamp that cell is under a block or two of water: MEASURED at seed 1337 over the 81 golden
    // chunks of one swamp, 78.5% of columns stand at or below sea level, and 66% of every
    // trees_swamp placement that reached this predicate died here. The real game stands its
    // swamp oaks IN the water — `TreeFeature.validTreePos` counts water as free, and so does
    // 04k's `isFree` — so the whole deficit was this line. Vanilla's answer, verbatim: the
    // block below is `#minecraft:dirt`.
    if (t === 'would_survive') {
      var nm = (p.state && p.state.Name ? String(p.state.Name) : '').replace('minecraft:', '');
      if (nm.length > 8 && nm.slice(nm.length - 8) === '_sapling') {
        return function (st, x, y, z) {
          var below = ctxBlock(x, y - 1, z);
          return below > 0 && tagSets['minecraft:dirt'][below] === 1;
        };
      }
      return function (st, x, y, z) {
        if (st !== 0) return false;
        var below = ctxBlock(x, y - 1, z);
        return below > 0 && NS.States.solid[below] === 1;
      };
    }
    throw new Error('feature: unsupported block predicate ' + (p.predicate_type || p.type));
  }
  F.compilePredicate = compilePredicate;

  // ⚠ THE BIOME MEMO IS GONE, AND SO IS THE BUG IT WAS PART OF (D-180).
  //
  // W8 asked `Climate.surfaceBiomeAt` once per placement, found it cost 38 microseconds, and
  // wrapped it in a direct-mapped quart-resolution memo — correct, and eleven milliseconds a
  // chunk cheaper. What the memo could not fix is that the question was the wrong one: the
  // biome at a position is a 3D question, the surface answer is what stopped `lush_caves` and
  // `dripstone_caves` ever decorating (D-137), and a memo over a wrong answer is a fast wrong
  // answer. `Gen.biomeVolume` now computes the chunk's whole 4x80x4 biome volume once, so both
  // the memo and its two 4,096-slot tables are deleted rather than left beside it: the volume
  // IS the memo, at vanilla's own granularity, for every y rather than one.
  //
  // ⚠ `F.biomeAt3` stays as the name the checks know, forwarding to `Gen.biomeAt3`, which is
  // an array read out of that volume. `featcheck` §1 still holds it against `Climate.biomeAt`.
  function biomeAt3(x, y, z) { return F.G.biomeAt3(x, y, z); }
  F.biomeAt3 = biomeAt3;

  // ⚠ vanilla's `Biome.BIOME_INFO_NOISE` at x/200, z/200 — the SAME fixed-seed noise W5 ported
  // for the swamp's grass colour (D-118). Two placement modifiers count from it, which is why a
  // plains has patches of dense flowers and patches of none.
  var infoNoise = null;
  function biomeInfoNoiseValue(x, z) {
    if (!infoNoise) infoNoise = NS.Noise.biomeInfoNoise();
    return infoNoise.get(x / 200, z / 200, false);
  }
  F.biomeInfoNoiseValue = biomeInfoNoiseValue;

  // ── the heightmaps (D-134) ─────────────────────────────────────────────────────────────────
  //
  // The first free y above the terrain, by heightmap type, from `Column.height` and the sea.
  var HM_OCEAN_FLOOR = 1;
  function heightmapY(kind, x, z) {
    var C = NS.Column;
    var h = C.height(x, z);
    if (kind === HM_OCEAN_FLOOR) return h + 1;
    var sea = F.G.params.seaLevel;
    return (h < sea ? sea : h) + 1;
  }
  F.heightmapY = heightmapY;

  // ⚠ D-443/D-446 NEXT (b) — A BOUNDED CARVE-AWARE HEIGHTMAP LOOKUP, SCOPED NARROWLY.
  //
  // `heightmapY` above is `Column.height` — pure, carver-UNAWARE (D-134/D-443): a cave or ravine
  // can hollow the exact cell it names as "ground" into air, and a feature anchored there wastes
  // its whole placement (D-443, reproduced live at seed 1337: `patch_sugar_cane_desert` anchored
  // on `Column.height`'s guess at (-310,64,-198), the real generated block one below is AIR).
  // D-446 measured the cost of NOT fixing this: ~3.16% of real `patch_sugar_cane`/
  // `patch_sugar_cane_desert` anchors land on carved-away ground (91x91 sweep, seed 1337).
  //
  // THIS IS NOT A REPLACEMENT FOR `heightmapY`. Ninety placed features in the overworld carry a
  // `heightmap` placement modifier (grep `.mcdata/.../placed_feature/*.json` for
  // `"minecraft:heightmap"`) and most of them have no reason to care whether the surface is
  // carved — a flower patch or a grass tuft that lands in a sinkhole is not a bug the way a
  // wasted sugar-cane/cactus/tree attempt is. `tools/_hmy-carveaware-bench.mjs` measured this
  // scan's real cost against real anchors: ~793 microseconds added per call on average (D-223's
  // own `Caves.carve` is "the point query 04b reserves for tools", a 240-block-random-walk-class
  // cost, NOT a cheap read) — multiplying that across every heightmap-placed feature in the game
  // would be the wrong fix `heightmapY`'s own D-443 comment already warned against. So this is a
  // SEPARATE function, called only from the `heightmap` placement-chain step, and only for the
  // placed features `requiresSolidGround` (below) marks at compile time: sugar cane (all biome
  // variants), cactus, and the five `trees_*` placed features that carry a placement-level
  // `would_survive` filter directly. Measured added cost for exactly this scope, over the SAME
  // 91x91-chunk sweep D-441/D-443/D-446 used: ~586 microseconds per chunk on average, against a
  // measured ~27.2 ms/chunk full generation cost (`node tools/gencheck.mjs`) — about 2.1%.
  //
  // Bounded to `CARVE_SCAN_BOUND` blocks (matching real cave/ravine reach near the surface, per
  // D-443's own NEXT note) rather than scanning to bedrock: a false negative past the bound falls
  // back to the OLD pure guess unchanged, which is no worse than today, never worse than today's
  // one-off cost `carvedAt`'s own header already accepts for `environment_scan`.
  var CARVE_SCAN_BOUND = 32;
  function carveAwareHeightmapY(kind, x, z) {
    var C = NS.Column;
    var h = C.height(x, z) | 0;
    if (kind !== HM_OCEAN_FLOOR) {
      var sea = F.G.params.seaLevel;
      if (h < sea) return sea;   // D-455: water tops at sea-1 (D-236 waterline), so MOTION_BLOCKING/WORLD_SURFACE over water/waterline is sea, not sea+1 -- the +1 pinned every sugar-cane try one block above the beach (item 3)
    }
    var y = h;
    for (var steps = 0; steps <= CARVE_SCAN_BOUND; steps++) {
      var b = carvedAt(x, y, z);
      if (b > 0 && NS.States.solid[b] === 1) return y + 1;
      y--;
    }
    return h + 1;   // bound exhausted: fall back to the pure guess, same as before this fix
  }
  F.carveAwareHeightmapY = carveAwareHeightmapY;

  /**
   * D-443/D-446 NEXT (b) — does this placed feature's chain (or its inline sub-feature) already
   * carry a `block_predicate_filter` step (`compileModifier`'s `'predicate'` kind)? That is
   * vanilla's own `would_survive`/`matching_blocks` solid-ground requirement — every one of the
   * game's `random_patch`-based features and every `random_selector` sapling tree carries it, and
   * it is what makes the anchor's own y matter enough to be worth the carve-aware scan above. Two
   * shapes carry it: a top-level `predicate` step in the placed feature's OWN chain (the five
   * `trees_*` that filter directly on `heightmap`), or a `predicate` step inside a `patch`
   * generator's inline sub-feature chain (`patch_sugar_cane`/`patch_cactus`'s own
   * `block_predicate_filter`, found in `worldgen/configured_feature/patch_sugar_cane.json` and
   * `patch_cactus.json` — the only two configured features in the 1.18.2 data with `would_survive`
   * inline at all). Anything else with a `heightmap` step (grass, flowers, disks, kelp, mushrooms,
   * …) is untouched and keeps the cheap pure read.
   */
  function requiresSolidGround(chain, gen) {
    var i;
    for (i = 0; i < chain.length; i++) if (chain[i].kind === 'predicate') return true;
    if (gen && gen.kind === 'patch' && gen.inl && gen.inl.chain) {
      for (i = 0; i < gen.inl.chain.length; i++) if (gen.inl.chain[i].kind === 'predicate') return true;
    }
    return false;
  }

  // ── ⚠ D-213 — `terrainAt`: THE WORLD A PLACEMENT IS ENTITLED TO ASK ABOUT ─────────────────
  //
  // D-134 settled what world a PLACEMENT sees when it asks how HIGH the ground is: `Column.height`,
  // the terrain before any feature ran, because a source chunk computes its placements without
  // generating a single block. This is the same world one question further on — not how high the
  // ground is but WHAT BLOCK IS THERE: the terrain fill and Mojang's surface rules, before the
  // carvers and before every feature.
  //
  // It is what 04k's header calls the answer to a GLOBAL read: a pure function of position, so
  // nine target chunks judging the same tree reach the same verdict. It is deliberately NOT the
  // carved world. `Caves.carve` is a point query 04b's own header says the chunk path is not
  // obliged to agree with, and a carver is a 240-block random walk that no point query can answer
  // at all — which is exactly the approximation `04k`'s `maxFreeHeight` already makes, for this
  // same question, three files down. One approximation, named twice, rather than two.
  //
  // Memoised by column: the nine targets of one placement ask about the same column nine times.
  var TMB = 12, TMN = 1 << TMB, TMM = TMN - 1;
  var tmX = null, tmZ = null, tmSet = null, tmH = null, tmB = null, tmS0 = null, tmS1 = null;

  function dropTerrainMemo() { tmSet = null; }
  F.dropTerrainMemo = dropTerrainMemo;

  function terrainColumn(x, z) {
    if (!tmSet) {
      tmX = new Int32Array(TMN); tmZ = new Int32Array(TMN); tmSet = new Uint8Array(TMN);
      tmH = new Int32Array(TMN); tmB = new Uint8Array(TMN);
      tmS0 = new Uint16Array(TMN); tmS1 = new Uint16Array(TMN);
    }
    var i = (((x * 374761393) ^ (z * 668265263)) >>> 0) & TMM;
    if (tmSet[i] === 1 && tmX[i] === x && tmZ[i] === z) return i;
    var C = NS.Column, G = F.G, SFC = NS.Surface;
    var h = C.height(x, z) | 0;
    var sea = G.params.seaLevel;
    // ⚠ the biome the SURFACE RULES were run with, which is the quart cell's, anchored on the
    // quart corner's own height — `genColumn` step 1b. Asking `biomeAt3` at this column's height
    // instead would be a second definition of "the biome here", which is D-180's mistake.
    var bi = G.biomeAt3(x, C.height(x & ~3, z & ~3) | 0, z);
    SFC.beginColumn(x, z, bi, h, h < sea ? sea : SFC.NO_WATER);
    tmX[i] = x; tmZ[i] = z; tmSet[i] = 1; tmH[i] = h; tmB[i] = bi;
    tmS0[i] = SFC.at(h) || G.ids.stone;
    tmS1[i] = SFC.at(h - 1) || G.ids.stone;
    return i;
  }

  /**
   * ⚠ D-223 — `carvedAt`: `terrainAt` WITH THE CAVES IN IT, and the one question it can answer.
   *
   * `terrainAt` is deliberately pre-carver (see above), which is right for a tree: a tree stands
   * on the surface and the carvers are not what decides whether it may. It is USELESS for the
   * `environment_scan` modifier, whose whole job is "walk down through cave air until you hit a
   * floor" — asked of an uncarved world, every position underground is already solid and the
   * scan is meaningless. So this is the same pure column read with `Caves.carve` laid over it.
   *
   * ⚠ AND `Caves.carve` IS THE POINT QUERY 04b RESERVES FOR TOOLS, which the chunk path is not
   * obliged to agree with — the chunk path interpolates a lattice. That disagreement is a placement
   * decision, not a written block: it is IDENTICAL in all nine target chunks (so no seam of the
   * D-213 kind), a false positive is caught by the patch generator's own live floor search a
   * moment later, and a false negative costs one attempt out of the hundred-odd a chunk makes.
   * It is the same approximation `04k`'s `maxFreeHeight` already makes for the same reason, named
   * a second time rather than made twice. The AQUIFER is not modelled here at all — a flooded
   * cave reads as air — because D-67 already says MC-Lite's aquifer is a fake.
   */
  function carvedAt(x, y, z) {
    var s = terrainAt(x, y, z);
    if (s > 0 && NS.States.solid[s] === 1 && NS.Caves && NS.Caves.carve(x, y, z) !== 0) return 0;
    return s;
  }
  F.carvedAt = carvedAt;

  /** The block the terrain and surface passes would put at (x,y,z). Pure. */
  function terrainAt(x, y, z) {
    if (!F.G || !NS.Surface) return -1;
    if (y >= MAXY) return 0;
    var i = terrainColumn(x, z), h = tmH[i];
    if (y > h) return y <= F.G.params.seaLevel ? F.G.ids.water : 0;
    if (y === h) return tmS0[i];
    if (y === h - 1) return tmS1[i];
    if (y < MINY) return F.G.ids.stone;
    var sea = F.G.params.seaLevel;
    return NS.Surface.stateAt(x, y, z, tmB[i], h, h < sea ? sea : NS.Surface.NO_WATER) || F.G.ids.stone;
  }
  F.terrainAt = terrainAt;

  function heightmapKind(name) {
    if (name === 'OCEAN_FLOOR' || name === 'OCEAN_FLOOR_WG') return HM_OCEAN_FLOOR;
    return 0;    // WORLD_SURFACE_WG, MOTION_BLOCKING, MOTION_BLOCKING_NO_LEAVES
  }

  // ── the placement chain ────────────────────────────────────────────────────────────────────
  //
  // Vanilla's `PlacementModifier` is a stream transform: it takes one position and returns zero
  // or more. The chain is applied in order, each stage over every position the previous one
  // produced. `count` multiplies, `in_square` and `heightmap` move, the filters remove.
  function compileModifier(m, name) {
    var t = m.type.replace('minecraft:', '');
    if (t === 'count') {
      var n = intProvider(m.count, name + '.count');
      return { kind: 'count', n: n };
    }
    if (t === 'in_square') return { kind: 'in_square' };
    if (t === 'heightmap') return { kind: 'heightmap', hm: heightmapKind(m.heightmap) };
    if (t === 'height_range') return { kind: 'height', h: heightProvider(m.height, name + '.height') };
    if (t === 'rarity_filter') return { kind: 'rarity', chance: m.chance | 0 };
    if (t === 'biome') return { kind: 'biome' };
    if (t === 'random_offset') {
      return { kind: 'offset', xz: intProvider(m.xz_spread, name + '.xz'), y: intProvider(m.y_spread, name + '.y') };
    }
    if (t === 'surface_water_depth_filter') return { kind: 'waterDepth', max: m.max_water_depth | 0 };
    if (t === 'surface_relative_threshold_filter') {
      return { kind: 'relThreshold', hm: heightmapKind(m.heightmap),
               min: m.min_inclusive === undefined ? -2147483648 : m.min_inclusive | 0,
               max: m.max_inclusive === undefined ? 2147483647 : m.max_inclusive | 0 };
    }
    if (t === 'block_predicate_filter') return { kind: 'predicate', p: compilePredicate(m.predicate) };
    if (t === 'noise_threshold_count') {
      return { kind: 'noiseThreshold', level: +m.noise_level, below: m.below_noise | 0, above: m.above_noise | 0 };
    }
    if (t === 'noise_based_count') {
      // ⚠ D-217 — THREE FIELDS, THREE JOBS, AND THIS HAD CONFLATED TWO OF THEM. In vanilla's
      // `NoiseBasedCountPlacement.count`: `noise_factor` DIVIDES THE COORDINATES (it is a
      // wavelength), `noise_to_count_ratio` MULTIPLIES the result (it is the count scale), and
      // there is NO ceiling. This read the noise at the wrong wavelength, multiplied by the
      // wavelength instead of the ratio, and then clamped to the ratio — so `bamboo`, whose
      // chain is the only overworld user of this modifier, generated at **0.13x** the real
      // game's density.
      return { kind: 'noiseCount', factor: m.noise_factor === undefined ? 1 : +m.noise_factor,
               offset: m.noise_offset === undefined ? 0 : +m.noise_offset,
               ratio: m.noise_to_count_ratio | 0 };
    }
    if (t === 'environment_scan') {
      return { kind: 'scan', dir: m.direction_of_search === 'up' ? 1 : -1, steps: m.max_steps | 0,
               target: compilePredicate(m.target_condition), allowed: compilePredicate(m.allowed_search_condition) };
    }
    if (t === 'count_on_every_layer') return { kind: 'everyLayer', n: intProvider(m.count, name + '.count') };
    if (t === 'carving_mask') return { kind: 'carvingMask' };
    throw new Error('feature: unsupported placement modifier ' + m.type + ' in ' + name);
  }

  // ── the registries, compiled once ──────────────────────────────────────────────────────────

  F.placed = null;          // name -> {feature, chain[]}
  F.configured = null;      // name -> compiled generator
  F.byBiome = null;         // registry biome index -> array of arrays (per step) of placed ids
  F.placedIds = null;       // placed name -> integer id, so a placement is numbers

  F.init = function (G) {
    if (!NS.WG || !NS.WG.ready) throw new Error('Features.init before the worldgen data decoded');
    if (!NS.States || !NS.States.ready) throw new Error('Features.init before the registry decoded');
    if (!NS.Carvers || !NS.Carvers.Rng) throw new Error('Features.init before Carvers.init');
    F.G = G;
    buildTags();
    buildSurvival();

    // Which placed features the overworld can reach, and in which step. The biome registry is
    // W5's, so the index space here is the registry's (D-100 applied to biomes).
    var B = NS.Biomes, WG = NS.WG;
    F.placed = Object.create(null);
    F.configured = Object.create(null);
    F.placedIds = Object.create(null);
    F.placedList = [];
    F.byBiome = new Array(B.count);
    F.unsupported = Object.create(null);

    for (var bi = 0; bi < B.count; bi++) {
      var lists = B.at(bi).features || [];
      var perStep = [];
      for (var st = 0; st < lists.length; st++) {
        var ids = [];
        for (var k = 0; k < lists[st].length; k++) {
          var id = compilePlaced(lists[st][k]);
          if (id >= 0) ids.push(id);
        }
        perStep.push(ids);
      }
      F.byBiome[bi] = perStep;
    }
    F.cache = new Map();
    dropTerrainMemo();                              // D-213: a new seed is a new terrain
    F.ready = true;
    return F;
  };

  /**
   * Compile one placed feature and return its integer id, or -1 if this build cannot run it
   * yet. ⚠ An unsupported feature is COUNTED AND NAMED, never silently dropped: `featcheck`
   * asserts the list, so "W8 does not do lakes yet" is a number in a report rather than a
   * missing thing nobody noticed.
   */
  function compilePlaced(name) {
    var short = name.replace('minecraft:', '');
    if (F.placedIds[short] !== undefined) return F.placedIds[short];
    var j = NS.WG.get('placed_feature', short);
    if (!j) { F.unsupported[short] = 'no such placed feature'; F.placedIds[short] = -1; return -1; }
    var chain = [];
    try {
      for (var i = 0; i < (j.placement || []).length; i++) chain.push(compileModifier(j.placement[i], short));
    } catch (e) { F.unsupported[short] = e.message; F.placedIds[short] = -1; return -1; }
    var gen = compileFeature(j.feature);
    if (!gen) {
      // ⚠ keep a generator's OWN error if it had one: "disk has no state" says where to look,
      // "not implemented yet" does not.
      var why = F.unsupported[String(j.feature).replace('minecraft:', '')];
      F.unsupported[short] = why || ('feature ' + j.feature + ' is not implemented yet');
      F.placedIds[short] = -1;
      return -1;
    }
    // D-443/D-446 NEXT (b): mark this placed feature's OWN `heightmap` chain steps carve-aware
    // when its config already requires solid ground (sugar cane, cactus, the five direct-predicate
    // trees_*) — see `requiresSolidGround`'s own header for exactly which two shapes count.
    if (requiresSolidGround(chain, gen)) {
      for (var hi = 0; hi < chain.length; hi++) if (chain[hi].kind === 'heightmap') chain[hi].carveAware = true;
    }
    var id = F.placedList.length;
    F.placedList.push({ name: short, chain: chain, gen: gen });
    F.placedIds[short] = id;
    return id;
  }

  // ── the feature generators ─────────────────────────────────────────────────────────────────
  //
  // This file implements the eight the pipeline can express directly — `ore` and `scattered_ore`
  // (which the acceptance test is about), `disk`, `simple_block`, `patch`, `column` and the three
  // selectors. The other 32 register themselves from the five family files, `04k` through `04q`
  // (D-138). Anything not here makes its placed feature "unsupported", which is a number and a
  // NAME in `featcheck`'s section 5 rather than a silent hole: 145 of 184 configured features and
  // 160 of 220 placed features compile.
  var GENERATORS = {};

  function compileFeature(name) {
    var short = String(name).replace('minecraft:', '');
    if (F.configured[short] !== undefined) return F.configured[short];
    var j = NS.WG.get('configured_feature', short);
    if (!j) { F.configured[short] = null; return null; }
    var t = j.type.replace('minecraft:', '');
    var maker = GENERATORS[t];
    if (!maker) { F.configured[short] = null; return null; }
    var g;
    try { g = maker(j.config, short); } catch (e) { F.unsupported[short] = e.message; g = null; }
    F.configured[short] = g;
    return g;
  }

  /**
   * ORE. Vanilla's `OreFeature`: an ellipsoid swept between two random endpoints a `size`-long
   * segment apart, and every cell inside it whose block matches one of the targets becomes that
   * target's state.
   *
   * ⚠ `discard_chance_on_air_exposure` is what makes buried diamond buried: a cell with air on
   * any side is dropped with that probability, so an exposed vein is thinner than a hidden one.
   */
  GENERATORS.ore = function (cfg, name) {
    var SR = NS.States;
    var targets = cfg.targets.map(function (t) {
      var st = SR.stateOf(t.state.Name.replace('minecraft:', ''));
      if (st === 0) throw new Error(name + ': unknown ore state ' + t.state.Name);
      return { match: compilePredicate(t.target), state: st };
    });
    var size = cfg.size | 0;
    var discard = +(cfg.discard_chance_on_air_exposure || 0);
    return { kind: 'ore', size: size, discard: discard, targets: targets, scattered: false, name: name };
  };
  GENERATORS.scattered_ore = function (cfg, name) {
    var g = GENERATORS.ore(cfg, name);
    g.scattered = true;
    return g;
  };

  /**
   * DISK. A flat lens of one block, radius `radius`, `half_height` thick, replacing the listed
   * targets. Sand and clay under water are disks.
   */
  GENERATORS.disk = function (cfg, name) {
    var SR = NS.States;
    var stateName = (cfg.state && cfg.state.Name) || (cfg.state_provider && cfg.state_provider.state && cfg.state_provider.state.Name);
    if (!stateName) throw new Error(name + ': disk has no state');
    var st = SR.stateOf(stateName.replace('minecraft:', ''));
    var radius = intProvider(cfg.radius, name + '.radius');
    var half = cfg.half_height | 0;
    // ⚠ a disk's `targets` are BLOCK STATES (`{Name, Properties}`), not block predicates — the
    // only place in the feature data where the two shapes collide. Match by block NAME, which
    // is what `matching_blocks` does with the same list.
    var names = (cfg.targets || []).map(function (t) { return (t.Name || t).replace('minecraft:', ''); });
    var targets = names.length
      ? [compilePredicate({ predicate_type: 'matching_blocks', blocks: names })] : [];
    return { kind: 'disk', state: st, radius: radius, half: half, targets: targets, name: name };
  };

  // ── state providers ────────────────────────────────────────────────────────────────────────
  //
  // "which block does this feature actually place" — six shapes across the whole roster, and
  // `simple_state_provider` is 136 of the 158 uses. The interesting one is
  // `noise_threshold_provider`, which is why a plains has PATCHES of tulips and patches of
  // poppies rather than a uniform sprinkle of both.
  function stateProvider(v, what) {
    var SR = NS.States;
    var st = function (o) {
      var n = (o && o.Name ? o.Name : o);
      if (typeof n !== 'string') throw new Error('feature: bad state in ' + what);
      var s = SR.stateOf(n.replace('minecraft:', ''));
      if (s === 0 && n.indexOf('air') < 0) throw new Error(what + ': unknown block ' + n);
      return s;
    };
    if (!v || !v.type) throw new Error('feature: missing state provider for ' + what);
    var t = v.type.replace('minecraft:', '');
    if (t === 'simple_state_provider') { var one = st(v.state); return function () { return one; }; }
    if (t === 'weighted_state_provider') {
      var list = v.entries.map(function (e) { return { w: e.weight | 0, s: st(e.data) }; });
      var total = 0;
      for (var i = 0; i < list.length; i++) total += list[i].w;
      return function (r) {
        var x = r.nextInt(total);
        for (var j = 0; j < list.length; j++) { x -= list[j].w; if (x < 0) return list[j].s; }
        return list[list.length - 1].s;
      };
    }
    if (t === 'randomized_int_state_provider') {
      // ⚠ vanilla randomises one integer PROPERTY of the source state (a sea pickle's count).
      // MC-Lite has the property tables but not yet a "state with this property set to n"
      // helper that is safe for every block, so it places the source state. ⚠ W8 CLOSED WITHOUT
      // doing this: every sea pickle placed by a `randomized_int_state_provider` has the source
      // state's count rather than one to four. It is small and visible, which is the right shape
      // for a first item in a later pass; it is in the gap table in docs/archive/NEXT.md.
      var src = stateProvider(v.source, what);
      return function (r, x, y, z) { return src(r, x, y, z); };
    }
    if (t === 'noise_threshold_provider' || t === 'noise_provider' || t === 'dual_noise_provider') {
      var def = t === 'noise_threshold_provider' ? st(v.default_state) : 0;
      var lows = (v.low_states || []).map(st);
      var highs = (v.high_states || []).map(st);
      var states = (v.states || []).map(st);
      var scale = +(v.scale || 0.005), thr = +(v.threshold === undefined ? 0 : v.threshold);
      var hiChance = +(v.high_chance === undefined ? 0 : v.high_chance);
      return function (r, x, y, z) {
        var n = biomeInfoNoiseValue(x * scale * 200, z * scale * 200);
        if (states.length) return states[Math.min(states.length - 1, Math.max(0,
          Math.floor((n + 1) / 2 * states.length)))];
        if (n < thr) return lows.length ? lows[r.nextInt(lows.length)] : def;
        return (highs.length && r.nextFloat() < hiChance) ? highs[r.nextInt(highs.length)] : def;
      };
    }
    if (t === 'rotated_block_provider') { var b = stateProvider(v.state ? { type: 'minecraft:simple_state_provider', state: v.state } : v.source, what); return b; }
    throw new Error('feature: unsupported state provider ' + v.type + ' for ' + what);
  }

  // ── an INLINE placed feature ───────────────────────────────────────────────────────────────
  //
  // `random_patch` and the selectors carry a whole placed feature inside their config: a
  // feature plus its own short chain, usually one `block_predicate_filter`. That chain runs at
  // APPLY time, against the target chunk's blocks, which is the whole reason `ctx` exists.
  function compileInline(j, what) {
    if (!j) return null;
    if (typeof j === 'string') {
      var gen0 = compileFeature(j);
      if (gen0) return { gen: gen0, chain: [], local: columnLocal(gen0) };
      // ⚠ A NAME CAN BE A PLACED FEATURE, NOT A CONFIGURED ONE. `trees_taiga`'s selector names
      // `minecraft:spruce_checked` — which is a PLACED feature, a spruce plus the one filter
      // that asks whether a sapling could survive there. Resolving names against the configured
      // registry alone left ten tree types (taiga, savanna, grove, the windswept and old-growth
      // sets) reporting "its default feature is not implemented yet" while the trees themselves
      // compiled perfectly. Found by the sub-agent that wrote the tree generators.
      var pj = NS.WG.get('placed_feature', String(j).replace('minecraft:', ''));
      if (pj) return compileInline(pj, what);
      return null;
    }
    var gen = typeof j.feature === 'string' ? compileFeature(j.feature) : compileInlineFeature(j.feature, what);
    if (!gen) return null;
    var chain = [];
    for (var i = 0; i < (j.placement || []).length; i++) {
      var m = j.placement[i];
      if (m.type === 'minecraft:block_predicate_filter') chain.push({ kind: 'predicate', p: compilePredicate(m.predicate) });
      else if (m.type === 'minecraft:random_offset') {
        chain.push({ kind: 'offset', xz: intProvider(m.xz_spread, what), y: intProvider(m.y_spread, what) });
      }
      // every other modifier inside an inline feature is a no-op at apply time
    }
    return { gen: gen, chain: chain, local: columnLocal(gen) };
  }

  /**
   * ⚠ D-213 — columnLocal(gen): does everything this generator can write lie in the ORIGIN'S
   * OWN COLUMN? It is the line 04k's header draws between a PER-CELL read and a GLOBAL one,
   * moved up to the file that decides which world a guard reads.
   *
   * A `simple_block` writes one cell and a `block_column` writes upward from it, so a target
   * chunk that does not contain the origin's column receives nothing from either — the target's
   * own blocks are then both the right thing to ask and the faithful thing to ask, because the
   * read and the write are the same cell. Everything else builds outward, so one read at the
   * origin decides cells in chunks that read differently, and the answer must be pure.
   *
   * The default is FALSE, including for every generator a W8c/W8d module registers: guessing
   * "local" wrong reintroduces the seam, guessing "global" wrong costs a memoised column.
   */
  function columnLocal(gen) {
    if (!gen) return false;
    var i;
    switch (gen.kind) {
      case 'simple_block': return true;
      case 'column': return true;
      case 'select':
        if (!gen.def || !columnLocal(gen.def.gen)) return false;
        for (i = 0; i < gen.opts.length; i++) if (gen.opts[i].inl && !columnLocal(gen.opts[i].inl.gen)) return false;
        return true;
      case 'selectUniform':
        for (i = 0; i < gen.opts.length; i++) if (!columnLocal(gen.opts[i].gen)) return false;
        return true;
      case 'selectBool': return columnLocal(gen.a.gen) && columnLocal(gen.b.gen);
      default: return false;
    }
  }
  F.columnLocal = columnLocal;

  /** A configured feature written out in place rather than named. */
  function compileInlineFeature(j, what) {
    if (!j || !j.type) return null;
    var t = j.type.replace('minecraft:', '');
    var maker = GENERATORS[t];
    if (!maker) { F.unsupported[what + ' (inline ' + t + ')'] = 'inline feature ' + j.type + ' is not implemented yet'; return null; }
    try { return maker(j.config, what + ':' + t); } catch (e) { F.unsupported[what] = e.message; return null; }
  }

  // ── ⚠ D-213 — THE GUARD ON AN INLINE PLACED FEATURE, AND WHOSE WORLD IT JUDGES ────────────
  //
  // `random_patch` and the three selectors carry a whole placed feature inside their config, and
  // almost every one of them carries one `block_predicate_filter` with it. Every vanilla tree
  // reached through a `random_selector` — `trees_plains`, `trees_savanna`, `trees_birch`, the
  // grove's two — is such a feature, and the filter is the sapling's own "would it survive here".
  //
  // ⚠ THIS USED TO READ THE TARGET CHUNK AND CANCEL ON -1, AND THAT SLICED EVERY TREE FLAT along
  // the chunk grid. The 3x3 correctly re-runs a source chunk's placements for all nine targets
  // and keeps the part that lands in each; a guard read at the tree's ORIGIN answers -1 in eight
  // of them, and `return 0` is not "defer to the owner", it is "do not build". So a tree was
  // built only by the chunk its trunk stood in and its canopy stopped dead at the boundary —
  // 8,117 leaves where the same world unclipped has 8,900, and 34 leaves in chunk (-3,2) at seed
  // 777777 where there are 94. Dan, twice: "some trees have half their leaves cut off." D-178 was
  // the mesher half of that sentence and was real; this is the worldgen half.
  //
  // ⚠ AND THE ONE-LINE REPAIR IS WRONG. Treating -1 as "pass" lets a neighbour build a tree the
  // owning chunk refused (seed 4242's orphaned leaves go 0.03% -> 1.41%), because the two are
  // then answering different questions. The rule 04k's header states and this file was breaking
  // is that a read deciding MANY cells must be a pure function of position that every target
  // agrees on. So:
  //
  //   the build is column-local   the target chunk's own blocks, exactly as before. Read and
  //                               write are the same cell, and a target that does not hold the
  //                               cell receives nothing from this build in any case.
  //   the build reaches outward   `terrainAt` — the pre-carver, pre-feature terrain, which is
  //                               the same world in all nine targets. The source chunk decides
  //                               WHERE, the target decides WHETHER, and a verdict that decides
  //                               a whole tree belongs to neither: it belongs to the position.
  //
  // `guardOk` is the guard on its own, with `runInline` the guard plus the build, because "all
  // nine targets reach the same verdict" is the invariant this restores and `parcheck` §7 has to
  // be able to ask it from outside.
  var GPOS = [0, 0, 0];
  // ⚠ A LIVE GUARD READS THE CHUNK IT WAS HANDED, not whichever one `applyChunk` last set. The
  // two are the same block array inside the pipeline; they are not when a check drives one
  // generator on its own, and a predicate whose inner reads went somewhere else would make such
  // a check test nothing. Scratch, not an allocation: the pipeline decorates one chunk at a time.
  var guardCtx = { SB: null, cx: 0, cz: 0 };

  function guardOk(inl, SB, cx, cz, x, y, z, r) {
    var chain = inl.chain, cur, okp, saved;
    for (var i = 0; i < chain.length; i++) {
      var m = chain[i];
      if (m.kind === 'offset') { x += m.xz(r); y += m.y(r); z += m.xz(r); continue; }
      if (m.kind === 'predicate') {
        saved = ctx;
        if (inl.local) {
          cur = getBlock(SB, cx, cz, x, y, z);
          if (cur < 0) { GPOS[0] = x; GPOS[1] = y; GPOS[2] = z; return false; }
          if (!ctx || ctx.SB !== SB) { guardCtx.SB = SB; guardCtx.cx = cx; guardCtx.cz = cz; ctx = guardCtx; }
        } else {
          cur = terrainAt(x, y, z);
        }
        pureGuard = !inl.local;
        okp = m.p(cur, x, y, z);
        pureGuard = false;
        ctx = saved;
        if (!okp) { GPOS[0] = x; GPOS[1] = y; GPOS[2] = z; return false; }
      }
    }
    GPOS[0] = x; GPOS[1] = y; GPOS[2] = z;
    return true;
  }
  F.inlineGuard = guardOk;
  F.inlineGuardPos = GPOS;

  /** Run an inline placed feature at one position. Returns blocks written. */
  function runInline(inl, SB, cx, cz, x, y, z, r) {
    if (!guardOk(inl, SB, cx, cz, x, y, z, r)) return 0;
    return place(inl.gen, SB, cx, cz, GPOS[0], GPOS[1], GPOS[2], r.next());
  }

  // ── the vegetation generators (W8b) ────────────────────────────────────────────────────────

  /** One block, from a state provider. The leaf of almost every plant feature. */
  GENERATORS.simple_block = function (cfg, name) {
    return { kind: 'simple_block', to: stateProvider(cfg.to_place, name), name: name };
  };

  /**
   * RANDOM PATCH. `tries` attempts, each at a random offset inside a box of
   * (2*xz_spread+1) x (2*y_spread+1) x (2*xz_spread+1), running the inline feature.
   * `flower` is the same thing with different defaults, which is why vanilla shares the class.
   */
  function randomPatch(cfg, name) {
    var inl = compileInline(cfg.feature, name);
    if (!inl) throw new Error(name + ': its inner feature is not implemented yet');
    return { kind: 'patch', inl: inl, tries: cfg.tries === undefined ? 128 : cfg.tries | 0,
             xz: cfg.xz_spread === undefined ? 7 : cfg.xz_spread | 0,
             ys: cfg.y_spread === undefined ? 3 : cfg.y_spread | 0, name: name };
  }
  GENERATORS.random_patch = randomPatch;
  GENERATORS.flower = randomPatch;

  /** A column of layers grown in one direction — sugar cane, cactus, a cave vine. */
  GENERATORS.block_column = function (cfg, name) {
    var layers = cfg.layers.map(function (l) {
      return { h: intProvider(l.height, name + '.height'), p: stateProvider(l.provider, name) };
    });
    var dir = cfg.direction === 'down' ? -1 : 1;
    var allowed = compilePredicate(cfg.allowed_placement);
    // ⚠ D-222 — `prioritize_tip` WAS READ BY NOBODY, and `cave_vine` is the only user in the
    // overworld. Vanilla samples every layer's height FIRST, walks the column to see how many
    // cells fit, and then TRUNCATES: from the far end normally, and from the START when
    // `prioritize_tip` is set, so a vine that runs out of room loses body and keeps its glowing
    // berry tip. This grew the layers in order and stopped at the first blocked cell, so the tip
    // was placed only when the whole body happened to fit — and the body is `uniform 0..19` two
    // times in fifteen. MEASURED: 0.57 tips a chunk against the real game's 2.27, with the same
    // number of vine columns. The `cave_vines`/`cave_vines_plant` pair is the visible half of it.
    return { kind: 'column', layers: layers, dir: dir, allowed: allowed,
             tip: !!cfg.prioritize_tip, name: name };
  };

  /** The three selectors: pick one inline feature and run it. */
  GENERATORS.random_selector = function (cfg, name) {
    var opts = cfg.features.map(function (e) { return { chance: +e.chance, inl: compileInline(e.feature, name) }; });
    var def = compileInline(cfg.default, name);
    if (!def) throw new Error(name + ': its default feature is not implemented yet');
    return { kind: 'select', opts: opts, def: def, name: name };
  };
  GENERATORS.simple_random_selector = function (cfg, name) {
    var opts = (cfg.features || []).map(function (e) { return compileInline(e, name); }).filter(Boolean);
    if (!opts.length) throw new Error(name + ': none of its features is implemented yet');
    return { kind: 'selectUniform', opts: opts, name: name };
  };
  GENERATORS.random_boolean_selector = function (cfg, name) {
    var a = compileInline(cfg.feature_true, name), b = compileInline(cfg.feature_false, name);
    if (!a || !b) throw new Error(name + ': one of its two features is not implemented yet');
    return { kind: 'selectBool', a: a, b: b, name: name };
  };

  /**
   * reachOf(gen) — how far, in blocks, this generator can write from its placement position.
   *
   * ⚠ THIS IS WHAT MAKES THE 3x3 AFFORDABLE. Every target chunk runs the generators of its nine
   * source chunks, and without a bound each one runs in full: a `random_patch` with 32 tries
   * costs 288 attempts per chunk instead of 32, and chunk generation went from 7.5 ms to 27.8.
   * A placement whose reach cannot touch the target is skipped before its generator is entered
   * at all, which is the same trick the carvers use on their ellipsoids and costs four
   * comparisons.
   */
  function reachOf(gen) {
    if (!gen) return 0;
    if (gen.reach !== undefined) return gen.reach;
    var r = 1;
    switch (gen.kind) {
      case 'ore': r = Math.ceil(gen.size / 8) + Math.ceil(gen.size / 16) + 3; break;
      case 'disk': r = 8; break;                       // the widest disk in the data has radius 6
      case 'patch': r = gen.xz + 1 + reachOf(gen.inl.gen); break;
      case 'column': r = 1; break;
      case 'simple_block': r = 1; break;
      case 'select': {
        r = reachOf(gen.def.gen);
        for (var i = 0; i < gen.opts.length; i++) if (gen.opts[i].inl) r = Math.max(r, reachOf(gen.opts[i].inl.gen));
        break;
      }
      case 'selectUniform': {
        r = 1;
        for (var j = 0; j < gen.opts.length; j++) r = Math.max(r, reachOf(gen.opts[j].gen));
        break;
      }
      case 'selectBool': r = Math.max(reachOf(gen.a.gen), reachOf(gen.b.gen)); break;
      default: r = 16; break;                          // unknown: assume it can cross a chunk
    }
    gen.reach = r;
    return r;
  }
  F.reachOf = reachOf;

  // ── the generator API (W8c/W8d) ────────────────────────────────────────────────────────────
  //
  // Everything a feature generator needs, published so that the rest of the 36 types can live in
  // their own files instead of all of them in this one. A module registers itself:
  //
  //     MCL.Features.register('lake', function (cfg, name) {
  //       var A = MCL.Features.api;
  //       var fluid = A.stateProvider(cfg.fluid, name);
  //       return { kind: 'lake', fluid: fluid, reach: 9,
  //                run: function (SB, cx, cz, x, y, z, r) { ...return blocks written... } };
  //     });
  //
  // ⚠ A registered generator returns an object with `run` and `reach`. `run` is called once per
  // TARGET chunk that its placement can touch, so it must write through `api.setBlock` (which
  // clips to that chunk) and read through `api.getBlock` (which returns -1 outside it) — never
  // assume the position it was handed is inside the chunk it is writing to. `reach` is how far
  // in blocks it can write from that position, and it is what keeps the 3x3 affordable.
  F.register = function (type, maker) {
    if (GENERATORS[type]) throw new Error('feature generator ' + type + ' is already registered');
    GENERATORS[type] = maker;
    return F;
  };

  F.api = {
    stateProvider: function (v, what) { return stateProvider(v, what); },
    intProvider: function (v, what) { return intProvider(v, what); },
    heightProvider: function (v, what) { return heightProvider(v, what); },
    predicate: function (p) { return compilePredicate(p); },
    inline: function (j, what) { return compileInline(j, what); },
    runInline: function (inl, SB, cx, cz, x, y, z, r) { return runInline(inl, SB, cx, cz, x, y, z, r); },
    setBlock: function (SB, cx, cz, x, y, z, st) { return setBlock(SB, cx, cz, x, y, z, st); },
    getBlock: function (SB, cx, cz, x, y, z) { return getBlock(SB, cx, cz, x, y, z); },
    rngAt: function (seed, x, y, z) { return new NS.Carvers.Rng(seed | 0, (seed / 65536) | 0, x * 31 + z * 17 + y); },
    heightmapY: function (kind, x, z) { return heightmapY(kind, x, z); },
    // D-418 — the pre-feature world one question past `heightmapY`: WHAT block is there. Already
    // the world every placement guard reads (D-213); exposed so a FEATURE's own precondition can
    // read the same one, which is what makes its verdict the same in all nine target chunks.
    terrainAt: function (x, y, z) { return terrainAt(x, y, z); },
    noise: function (x, z) { return biomeInfoNoiseValue(x, z); },
    stateOf: function (n) { return NS.States.stateOf(String(n).replace('minecraft:', '')); },
    MINY: MINY, MAXY: MAXY, H: H,
  };

  // ── ⚠ D-222 — FEATURES SEE FEATURES: THE CANOPY STAMP ────────────────────────────────────
  //
  // MEASURED, against the 1.18.2 server at seed 1337 over the same chunks: MC-Lite put 55.6 tree
  // trunks in a jungle chunk where the real game puts 11.15, and 4.77 in a wooded badlands
  // against 0.77 — 3.62x over the whole sample. `vanillacheck` §6 saw it as jungle_log 10.10x
  // and oak_leaves 2.09x. The cause is ONE thing and it is not the tree code:
  //
  //   `trees_jungle` is `count 50, in_square, surface_water_depth_filter, heightmap OCEAN_FLOOR,
  //   biome`, and every one of those fifty attempts ends in a `would_survive` filter on a
  //   sapling. In VANILLA the heightmap is the LIVE chunk's, so the moment a tree stands in a
  //   column the next attempt there is lifted to the top of its leaves and the sapling filter
  //   fails — a sapling does not grow on a leaf. Fifty attempts become about eight trees.
  //   In MC-Lite the heightmap is `Column.height`, the terrain BEFORE any feature ran (D-134),
  //   and the guard reads `terrainAt`, the same pre-feature world (D-213). The placement modifier
  //   therefore puts every attempt on bare ground and the guard is asked a question it cannot
  //   answer no to: MEASURED, 573 of 573 attempts passed — 100.0%.
  //
  // So the deficit is not in the selector (its option roll measured 10.3/42.1/16.4/31.2% against
  // vanilla's 10/45/15/30 — exact), not in the tree's free-height test, and not in `terrainAt`.
  // It is that D-134 removed vanilla's feedback loop and nothing replaced it.
  //
  // ⚠ WHAT REPLACES IT, AND WHY IT IS STILL PURE. A live heightmap cannot come back: a source
  // chunk computes its placements without generating one block, which is the whole architecture.
  // What CAN come back is the one consequence the trees care about — "is this column already
  // under a canopy" — because vanilla's own answer is decided entirely INSIDE one chunk:
  // `in_square` scatters all fifty attempts across the source chunk's own 16x16, and they are
  // run in a fixed order. So the stamp lives in `placementsOf`, is a pure function of
  // (seed, source chunk) exactly as the placement list already is, is cached with it, and every
  // one of the nine target chunks reads the identical answer. No seam of the D-213 kind exists
  // because no target ever computes it.
  //
  // ⚠ THE TWO APPROXIMATIONS, NAMED. (a) A tree does not block an attempt in the NEIGHBOURING
  // source chunk, because that chunk's list is computed on its own; vanilla's canopies do reach
  // across, over a rim about 2 blocks of 16. (b) The stamp is a square of the tree's MEASURED
  // plan area (04k's `measureCanopy`) centred on the trunk, not the canopy's true outline —
  // area is what decides how fast a chunk fills up, and the outline is not knowable without
  // building the tree. Neither is a tuned number: (a) is a boundary, (b) is a measurement.
  //
  // ⚠ AND IT MOVES NOTHING ELSE. The seed of a placement is drawn before this test, so a chunk's
  // rng stream is bit-identical to what it was; the only difference in the world is that the
  // attempts vanilla would have refused are now refused here too.
  // ⚠ TWO STAMPS, BECAUSE VANILLA REJECTS A TREE FOR TWO DIFFERENT REASONS AND THE SECOND ONE
  // IS WHAT KEEPS MEGA JUNGLE TREES RARE. `occCan` is the canopy: the column the attempt stands
  // in, which the live heightmap lifts and `would_survive` then refuses. `occLog` is the WOOD,
  // and it is `getMaxFreeTreeHeight` — vanilla walks the `minimum_size` square at every layer of
  // the trunk and any block that is not air-or-leaves ends the tree, so an earlier tree's TRUNK
  // inside that square is a rejection while its leaves are not. MEASURED at seed 1337 over 23
  // jungle-family chunks: the 1.18.2 server puts 0.26 mega jungle trees in a chunk. A mega
  // jungle's square is 5x5 and twenty blocks tall, a plain jungle tree's is 3x3 and eight, so
  // the wood test bites the mega five times as hard — which is the whole of the difference
  // between 15% of the selector's rolls and 4.7% of the trees that end up standing.
  var occCan = new Uint8Array(256), occLog = new Uint8Array(256);
  var occOx = 0, occOz = 0, occOn = false;

  /** The option a `random_selector` rolls. Vanilla's `RandomSelectorFeature`: the FIRST option
   *  whose `nextFloat() < chance`, else the default (-1). Shared with `resolveGen` below so the
   *  roll cannot drift from the one that actually runs. */
  function selectIndex(gen, r) {
    for (var i = 0; i < gen.opts.length; i++) if (r.nextFloat() < gen.opts[i].chance) return i;
    return -1;
  }

  /** Does anything reachable from this generator build a canopy? Compile-time, memoised. */
  function anyCanopy(gen) {
    if (!gen) return false;
    if (gen.anyCan !== undefined) return gen.anyCan;
    gen.anyCan = false;                              // stop a cycle dead rather than recursing
    var v = gen.kind === 'tree', i;
    if (gen.kind === 'select') {
      v = anyCanopy(gen.def && gen.def.gen);
      for (i = 0; i < gen.opts.length; i++) if (gen.opts[i].inl && anyCanopy(gen.opts[i].inl.gen)) v = true;
    } else if (gen.kind === 'selectUniform') {
      for (i = 0; i < gen.opts.length; i++) if (anyCanopy(gen.opts[i].gen)) v = true;
    } else if (gen.kind === 'selectBool') {
      v = anyCanopy(gen.a && gen.a.gen) || anyCanopy(gen.b && gen.b.gen);
    }
    gen.anyCan = v;
    return v;
  }

  /**
   * The plan areas of one tree, in columns, each turned into the half-width of an equal-area
   * square: `canopyR` for everything it covers, `trunkR` for the wood alone. `sizeR` is not
   * measured at all — it is the tree's own `minimum_size`, straight out of Mojang's config.
   */
  var sqR = function (a) { return a > 1 ? Math.round((Math.sqrt(a) - 1) / 2) : 0; };
  function canopyRadius(gen) {
    if (gen.canopyR === undefined) {
      var m = null;
      try { m = typeof gen.measureCanopy === 'function' ? gen.measureCanopy() : null; } catch (e) { m = null; }
      gen.canopyArea = m ? m.area : 0;
      gen.canopyR = m ? sqR(m.area) : 0;
      gen.trunkR = m ? sqR(m.logArea) : 0;
      gen.sizeR = m ? (m.sizeR | 0) : 0;
    }
    return gen.canopyR;
  }
  F.canopyRadius = canopyRadius;
  F.anyCanopy = anyCanopy;

  /**
   * The generator a chain of selectors would ACTUALLY run at this position — `place`'s own roll,
   * mirrored. It draws from its own `Rng`, seeded exactly as `place` seeds it, so it consumes
   * nothing from the placement's stream.
   *
   * ⚠ IT DECLINES RATHER THAN GUESSES. A selector whose inline chain carries a `random_offset`
   * consumes rng inside `guardOk`, which this does not run, so the nested seed would be wrong
   * from that point on: such a generator returns null and is simply not stamped. `featcheck`
   * asserts that no overworld selector reaching a tree has one.
   */
  function resolveGen(gen, x, y, z, seed) {
    for (var depth = 0; gen && depth < 8; depth++) {
      var r, k, inl;
      if (gen.kind === 'select') {
        r = new NS.Carvers.Rng(seed | 0, (seed / 65536) | 0, x * 11 + z * 23 + y);
        k = selectIndex(gen, r);
        inl = k < 0 ? gen.def : gen.opts[k].inl;
      } else if (gen.kind === 'selectUniform') {
        r = new NS.Carvers.Rng(seed | 0, (seed / 65536) | 0, x * 19 + z * 29 + y);
        inl = gen.opts[r.nextInt(gen.opts.length)];
      } else if (gen.kind === 'selectBool') {
        r = new NS.Carvers.Rng(seed | 0, (seed / 65536) | 0, x * 37 + z * 41 + y);
        inl = r.nextInt(2) ? gen.a : gen.b;
      } else {
        return gen;
      }
      if (!inl || !inl.gen) return null;
      for (var i = 0; i < inl.chain.length; i++) if (inl.chain[i].kind === 'offset') return null;
      seed = r.next();
      gen = inl.gen;
    }
    return null;
  }
  F.resolveGen = resolveGen;

  /** Is any column within `rad` of (x,z) stamped in this map? */
  function occHit(map, rad, x, z) {
    var lx = x - occOx, lz = z - occOz;
    for (var dz = -rad; dz <= rad; dz++) {
      var pz = lz + dz;
      if (pz < 0 || pz > 15) continue;
      for (var dx = -rad; dx <= rad; dx++) {
        var px = lx + dx;
        if (px >= 0 && px <= 15 && map[(pz << 4) | px] === 1) return true;
      }
    }
    return false;
  }

  function occStamp(map, rad, x, z) {
    var lx = x - occOx, lz = z - occOz;
    for (var dz = -rad; dz <= rad; dz++) {
      var pz = lz + dz;
      if (pz < 0 || pz > 15) continue;
      for (var dx = -rad; dx <= rad; dx++) {
        var px = lx + dx;
        if (px >= 0 && px <= 15) map[(pz << 4) | px] = 1;
      }
    }
  }

  // ── the placement pass ─────────────────────────────────────────────────────────────────────

  // Scratch for the per-chunk biome set and the per-chunk "already run" set. Stamped rather
  // than cleared: `placementsOf` is called nine times per generated chunk.
  var bSeen = null, bList = new Int32Array(64), bStamp = 0;
  var ranSeen = null, ranStamp = 0, ordOfStep = new Int32Array(16);

  /** Everything one source chunk places: [step, order, placedId, x, y, z, seed] x N. */
  function placementsOf(scx, scz) {
    var k = NS.Carvers.keyOf(scx, scz);
    var got = F.cache.get(k);
    if (got) return got;
    var out = [];
    var B = NS.Biomes, G = F.G;
    var ox = scx << 4, oz = scz << 4;
    var step, i, pid, pf, r;

    // ── EVERY BIOME IN THE CHUNK DECORATES, NOT JUST THE ONE AT THE SURFACE (D-180) ────────
    //
    // This used to read the biome at the chunk origin's surface and hand that one biome's
    // eleven step lists to the whole chunk, which is why `dripstone_caves` and `lush_caves` —
    // real biomes with real feature lists, and never anybody's surface — compiled, ran when a
    // check drove them directly, and never once appeared in a generated world (D-137).
    //
    // Vanilla's `applyBiomeDecoration` takes the set of biomes present in the chunk's biome
    // VOLUME and offers each step every feature any of them lists, once, with the `biome`
    // placement modifier rejecting the positions whose own biome does not list it. That is what
    // this does now, over `Gen.biomeVolume` — 1,280 quart cells, computed once and cached, and
    // an array read per question instead of the 38-microsecond climate evaluation that made
    // D-137 measure the union fix at 86 ms a chunk and reject it.
    //
    // ⚠ TWO DELIBERATE ORDERING RULES, because vanilla's own answer here is not portable.
    // Vanilla iterates a GLOBAL per-step feature list and salts each feature's rng with its
    // index in THAT list — a list this project does not build, and adopting it would reseed
    // every feature in the world. So: the origin biome's lists run FIRST and in their existing
    // order, which leaves every surface feature seeded exactly as it was; the remaining biomes
    // follow in the order the volume's scan finds them, contributing only what has not already
    // run this step. `order` is a running counter per step, so it is 0..n-1 for the origin
    // biome exactly as before and unique for everything appended after it.
    // D-222: the canopy stamp belongs to THIS source chunk and to nothing else
    occCan.fill(0); occLog.fill(0); occOx = ox; occOz = oz; occOn = true;
    var vol = G.biomeVolume(scx, scz);
    if (!bSeen || bSeen.length !== B.count) bSeen = new Int32Array(B.count);
    if (!ranSeen || ranSeen.length !== F.steps * F.placedList.length) {
      ranSeen = new Int32Array(F.steps * F.placedList.length);
    }
    bStamp++; ranStamp++;
    var nb = 0;
    var originBiome = G.biomeAt3(ox, NS.Column.height(ox, oz), oz);
    bSeen[originBiome] = bStamp; bList[nb++] = originBiome;
    for (i = 0; i < vol.length; i++) {
      var bv = vol[i];
      if (bSeen[bv] !== bStamp) { bSeen[bv] = bStamp; if (nb < bList.length) bList[nb++] = bv; }
    }
    for (step = 0; step < ordOfStep.length; step++) ordOfStep[step] = 0;

    for (var bn = 0; bn < nb; bn++) {
      var bi = bList[bn];
      var lists = F.byBiome[bi];
      if (!lists) continue;
      for (step = 0; step < lists.length; step++) {
        for (i = 0; i < lists[step].length; i++) {
          pid = lists[step][i];
          var slot = step * F.placedList.length + pid;
          if (ranSeen[slot] === ranStamp) continue;      // another biome already ran it
          ranSeen[slot] = ranStamp;
          pf = F.placedList[pid];
          var order = ordOfStep[step]++;
          r = rngFor(G.seed | 0, scx, scz, step * 977 + order * 31 + 7);
          runChain(pf.chain, 0, ox, 0, oz, r, out, step, order, pid, bi);
        }
      }
    }
    occOn = false;
    var arr = Float64Array.from(out);
    F.cache.set(k, arr);
    if (F.cache.size > 400) {
      var it = F.cache.keys();
      for (var n = F.cache.size - 400; n > 0; n--) F.cache.delete(it.next().value);
    }
    return arr;
  }
  F.placementsOf = placementsOf;

  var PLACEMENT = 7;
  F.PLACEMENT = PLACEMENT;

  // ⚠ `candidates()` LIVED HERE AND IS GONE (D-137, closed by D-180). It returned every biome
  // in a chunk — the surface at two corners plus the 3D biome at four depths down the middle,
  // deduped — so that a cave biome's features could be offered at all. It worked, and it cost
  // 86 ms a chunk against 15, because the 3D lookups it fed are 38 microseconds each. The
  // answer was not to sample less; it was to stop sampling per question at all. What replaced
  // it is `Gen.biomeVolume`, one cached 4x80x4 array a chunk, and the loop above reads the
  // whole biome set out of it for the price of a scan over 1,280 bytes.

  /** Apply the chain from stage `si` to one position, appending finished placements to `out`. */
  function runChain(chain, si, x, y, z, r, out, step, order, pid, biome) {
    if (si >= chain.length) {
      // ⚠ THE SEED IS DRAWN FIRST, whatever the verdict, so a rejected attempt costs the stream
      // exactly what an accepted one costs and every OTHER feature in the chunk is untouched.
      var sd = r.next();
      var g0 = F.placedList[pid].gen;                 // D-222, and the header above it
      if (occOn && g0 && anyCanopy(g0)) {
        if (occHit(occCan, 0, x, z)) return;          // under a canopy: the sapling check fails
        var gt = resolveGen(g0, x, y, z, sd);
        if (gt && gt.kind === 'tree') {
          var rad = canopyRadius(gt);
          if (occHit(occLog, gt.sizeR, x, z)) return; // wood in the minimum_size square
          if (rad > 0) occStamp(occCan, rad, x, z);
          occStamp(occLog, gt.trunkR, x, z);
        }
      }
      out.push(step, order, pid, x, y, z, sd);
      return;
    }
    var m = chain[si], i;
    switch (m.kind) {
      case 'count': {
        var n = m.n(r);
        for (i = 0; i < n; i++) runChain(chain, si + 1, x, y, z, r, out, step, order, pid, biome);
        return;
      }
      case 'in_square':
        return runChain(chain, si + 1, x + r.nextInt(16), y, z + r.nextInt(16), r, out, step, order, pid, biome);
      case 'heightmap':
        // D-443/D-446 NEXT (b): `m.carveAware` (compilePlaced's `requiresSolidGround` marker)
        // routes sugar cane / cactus / the 5 direct-predicate trees_* through the bounded
        // carve-aware scan; every other heightmap-placed feature keeps the cheap pure read.
        return runChain(chain, si + 1, x, (m.carveAware ? carveAwareHeightmapY(m.hm, x, z) : heightmapY(m.hm, x, z)), z, r, out, step, order, pid, biome);
      case 'height':
        return runChain(chain, si + 1, x, m.h(r), z, r, out, step, order, pid, biome);
      case 'rarity':
        if (r.nextFloat() >= 1 / m.chance) return;
        return runChain(chain, si + 1, x, y, z, r, out, step, order, pid, biome);
      case 'biome': {
        // ⚠ the position's OWN biome must still list this feature, or a forest's trees would
        // walk into the desert whenever a source chunk straddled the border — and it is the
        // biome at the position's OWN Y (D-180), which is what confines a dripstone cluster to
        // the cave it belongs to while the plains overhead keeps its grass.
        var b = biomeAt3(x, y, z);
        var lists = F.byBiome[b];
        if (!lists || !lists[step] || lists[step].indexOf(pid) < 0) return;
        return runChain(chain, si + 1, x, y, z, r, out, step, order, pid, biome);
      }
      case 'offset':
        return runChain(chain, si + 1, x + m.xz(r), y + m.y(r), z + m.xz(r), r, out, step, order, pid, biome);
      case 'waterDepth': {
        var sea = F.G.params.seaLevel;
        var floor = NS.Column.height(x, z);
        var depth = floor < sea ? sea - floor : 0;
        if (depth > m.max) return;
        return runChain(chain, si + 1, x, y, z, r, out, step, order, pid, biome);
      }
      case 'relThreshold': {
        var d = y - heightmapY(m.hm, x, z);
        if (d < m.min || d > m.max) return;
        return runChain(chain, si + 1, x, y, z, r, out, step, order, pid, biome);
      }
      case 'noiseThreshold': {
        // vanilla samples Biome.BIOME_INFO_NOISE at x/200, z/200
        var nv = biomeInfoNoiseValue(x, z);
        var cnt = nv < m.level ? m.below : m.above;
        for (i = 0; i < cnt; i++) runChain(chain, si + 1, x, y, z, r, out, step, order, pid, biome);
        return;
      }
      case 'noiseCount': {
        // vanilla: `ceil((BIOME_INFO_NOISE.getValue(x / factor, z / factor, false) + offset) * ratio)`.
        // `biomeInfoNoiseValue` divides by 200 for the threshold provider's fixed scale, so the
        // argument is pre-multiplied to land on `x / factor`. See D-216.
        var nv2 = biomeInfoNoiseValue(x * 200 / m.factor, z * 200 / m.factor);
        var c2 = Math.ceil((nv2 + m.offset) * m.ratio);
        if (c2 < 0) c2 = 0;
        for (i = 0; i < c2; i++) runChain(chain, si + 1, x, y, z, r, out, step, order, pid, biome);
        return;
      }
      // ⚠ D-222 — THE TOP-LEVEL `block_predicate_filter`, AND IT IS NO LONGER PASSED THROUGH.
      //
      // The comment this replaces said turning it on was "a separate change with its own
      // feature-count movement to measure". It has been measured. Thirty-five placed features
      // carry one at the TOP of their chain rather than inside a selector, and thirty-two of them
      // are a sapling's `would_survive`: `trees_badlands`, `trees_plains`, `trees_birch`,
      // `trees_swamp`, `trees_snowy` and every bare `*_checked` a biome lists directly. Dropping
      // it is what let 4.23 oaks a chunk stand on a WOODED BADLANDS plateau where the real 1.18.2
      // server puts 0.77, and it is the other half of D-222's tree deficit: the biome filter says
      // the tree may be attempted here, and only this predicate says the ground will hold it.
      //
      // It is answered against `Features.terrainAt` — the same pre-carver, pre-feature world
      // D-213 gave the inline guards, for the same reason: a source chunk has no blocks, and a
      // verdict that decides a whole tree must be a pure function of position so all nine target
      // chunks reach it. `pureGuard` is what routes the predicate's own offset reads there.
      case 'predicate': {
        var savedPG = pureGuard;
        pureGuard = true;
        var okp = m.p(terrainAt(x, y, z), x, y, z);
        pureGuard = savedPG;
        if (!okp) return;
        return runChain(chain, si + 1, x, y, z, r, out, step, order, pid, biome);
      }
      // ⚠ D-223 — `environment_scan`, AND IT WAS THE OTHER HALF OF §6's LEDGER.
      //
      // `lush_caves_vegetation` is `count 125` and `cave_vines` is `count 188` — a hundred and
      // three hundred attempts a chunk, thrown at a uniform y over the whole world height. In
      // vanilla the scan is the entire filter: the attempt must START in air and find a floor
      // (or a ceiling) within twelve steps, so all but the few that land in a cave die there.
      // Passed through, every one of them ran, and the patch generator's own five-step floor
      // search then found the nearest rock face and moss-carpeted it. MEASURED against the
      // 1.18.2 server that was moss_carpet 4.68x and cave_vines_plant 4.24x, and — because
      // `moss_vegetation` is mostly grass — half of grass 2.05x as well.
      //
      // It is answered against `carvedAt`, whose header states what that costs.
      case 'scan': {
        var sPG = pureGuard;
        pureGuard = true;
        // ⚠ THE ORDER IS MOVE, THEN TARGET, THEN ALLOWED, and it is the only order that works:
        // the scan starts in air and the thing it is looking for is the FLOOR, which is not air.
        // Testing `allowed` before `target` on the moved position rejects the floor as "not air"
        // one step before noticing it is the floor, and every scan in the world then fails — the
        // first draft of this did exactly that and took moss_carpet from 4.68x to 0.00x.
        var sy = y, cur = carvedAt(x, sy, z), found = false, steps = 0;
        if (m.allowed(cur, x, sy, z)) {
          for (;;) {
            if (steps >= m.steps) break;
            sy += m.dir;
            if (sy <= MINY || sy >= MAXY) break;
            cur = carvedAt(x, sy, z);
            if (m.target(cur, x, sy, z)) { found = true; break; }
            if (!m.allowed(cur, x, sy, z)) break;
            steps++;
          }
        }
        pureGuard = sPG;
        if (!found) return;
        return runChain(chain, si + 1, x, sy, z, r, out, step, order, pid, biome);
      }
      // ⚠ THE TWO THAT ARE STILL PASSED THROUGH, AND WHAT THAT COSTS. Both ask about blocks the
      // source chunk does not have: `carving_mask` wants the carvers' own per-chunk bitmask (W7
      // does not keep one) and `count_on_every_layer` wants the solid/air layering of the whole
      // column. The chain lets the placement past and the modifier is not applied, identically in
      // every target, which is lax rather than incoherent. Neither appears in §6's ledger.
      case 'carvingMask': case 'everyLayer':
        return runChain(chain, si + 1, x, y, z, r, out, step, order, pid, biome);
      default:
        throw new Error('feature: unhandled modifier ' + m.kind);
    }
  }

  // ── applying the placements to one chunk ───────────────────────────────────────────────────

  /**
   * applyChunk(SB, cx, cz, cH, sea) — run every placement from the 3x3 that can reach this
   * chunk, in a fixed order, writing only inside it.
   *
   * ⚠ THE ORDER IS DEFINED HERE AND IT MATTERS. Two features can write the same cell, so the
   * result depends on which goes last. Vanilla's order is "this chunk's steps, in order" and
   * says nothing about a neighbour's spill; MC-Lite sorts by (step, source chunk in a fixed
   * spiral, index within the step), which is deterministic, order-independent and stated.
   */
  F.applyChunk = function (SB, cx, cz, cH, sea) {
    if (!F.ready) return 0;
    var all = [];
    for (var dz = -RANGE; dz <= RANGE; dz++) {
      for (var dx = -RANGE; dx <= RANGE; dx++) {
        var src = placementsOf(cx + dx, cz + dz);
        var srcOrder = (dz + RANGE) * 3 + (dx + RANGE);
        // ⚠ [step, sourceOrder, orderInStep, placedId, x, y, z, seed]. The source layout is
        // [step, order, pid, x, y, z, seed]; `sourceOrder` is inserted as the second key so the
        // sort below reads (step, source chunk, index within the step) straight off the front.
        for (var i = 0; i < src.length; i += PLACEMENT) {
          all.push([src[i], srcOrder, src[i + 1], src[i + 2], src[i + 3], src[i + 4], src[i + 5], src[i + 6]]);
        }
      }
    }
    all.sort(function (a, b) { return (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]); });
    ctx = { SB: SB, cx: cx, cz: cz };
    var ox0 = cx << 4, oz0 = cz << 4;
    // ⚠ AND THE VERTICAL REJECT, which is the one that pays. `ore_iron_upper` is NINETY
    // placements per chunk spread over y 80..384, and in flat terrain every one of them is in
    // open air — but a blob still walked its whole ellipsoid stack to discover that. One
    // comparison against the chunk's own highest column skips them before they start.
    var maxH = MINY;
    for (var ci = 0; ci < 256; ci++) if (cH[ci] > maxH) maxH = cH[ci];
    var n = 0;
    // ⚠ THE STRUCTURE BRACKET (PLAN W13, D-184). Vanilla's `applyBiomeDecoration` runs, for each
    // decoration step, the STRUCTURES of that step and then the biome FEATURES of that step. The
    // sorted list below is already in step order, so crossing a step boundary is where a
    // structure's pieces go in — before this step's features and after the last step's. It is a
    // no-op when `Structures` is not ready or the world has them switched off, and `genColumn`
    // flushes whatever is left afterwards.
    var STc = NS.Structures, doStruct = !!(STc && STc.ready && F.G.params.structures);
    var stepSeen = -1, structBlocks = 0;
    for (var j = 0; j < all.length; j++) {
      var p = all[j];
      // ⚠ counted apart from `n`: `n` is FEATURE placements and `F.lastPlaced` reports it to
      // three checks. Folding blocks written by a mineshaft into it would make every one of
      // those numbers quietly wrong.
      if (doStruct && p[0] !== stepSeen) { stepSeen = p[0]; structBlocks += STc.writeUpTo(SB, cx, cz, stepSeen, cH, sea); }
      var pf = F.placedList[p[3]];
      var reach = reachOf(pf.gen);
      // the cheap reject, before the generator is entered at all
      if (p[4] + reach < ox0 || p[4] - reach > ox0 + 15) continue;
      if (p[6] + reach < oz0 || p[6] - reach > oz0 + 15) continue;
      if (p[5] - reach > maxH + 2) continue;         // entirely above this chunk's terrain
      n += place(pf.gen, SB, cx, cz, p[4], p[5], p[6], p[7]);
    }
    ctx = null;
    F.lastPlaced = n;
    F.lastStructureBlocks = structBlocks;
    return n;
  };

  /** For tests: run one generator directly, without the placement chain. */
  F.placeForTest = function (gen, SB, cx, cz, x, y, z, seed) { return place(gen, SB, cx, cz, x, y, z, seed); };

  var COLH = new Int32Array(8);        // scratch for `block_column`; the widest config has two


  /**
   * tallUpper(state) — the UPPER half of a two-block plant, or 0 if this state is not one.
   *
   * ⚠ KEYED ON THE DATA, NOT ON A LIST OF NAMES. A state carrying `half=lower` and no `hinge` is
   * one of 1.18.2's eight `DoublePlantBlock`s — large_fern, lilac, peony, rose_bush,
   * small_dripleaf, sunflower, tall_grass, tall_seagrass — and never a door, which is the only
   * other block in the game with a `half` property. The partner is found by matching EVERY other
   * property rather than by taking the block's first upper state: `small_dripleaf` also carries
   * `facing` and `waterlogged`, and the first-upper shortcut would plant its head facing north.
   */
  var UPPER_OF = null;
  function tallUpper(state) {
    var SRs = NS.States, R = NS.Reg;
    if (!SRs || !R || !R.PROP || R.PROP.half === undefined) return 0;
    if (UPPER_OF === null) {
      UPPER_OF = new Int32Array(SRs.count);
      var props = [], k;
      for (k in R.PROP) if (k !== 'half') props.push(R.PROP[k]);
      var lowerV = R.PVAL.lower, upperV = R.PVAL.upper;
      for (var st = 1; st < SRs.count; st++) {
        if (SRs.propValue(st, R.PROP.half) !== lowerV) continue;
        if (R.PROP.hinge !== undefined && SRs.propValue(st, R.PROP.hinge) >= 0) continue;  // a door
        var b = SRs.block[st], first = R.realFirst[b], last = R.realFirst[b + 1];
        for (var t = first; t < last; t++) {
          if (SRs.propValue(t, R.PROP.half) !== upperV) continue;
          var same = true;
          for (var i = 0; i < props.length; i++) {
            if (SRs.propValue(t, props[i]) !== SRs.propValue(st, props[i])) { same = false; break; }
          }
          if (same) { UPPER_OF[st] = t; break; }
        }
      }
    }
    return UPPER_OF[state] | 0;
  }
  NS.Features.tallUpper = tallUpper;

  function place(gen, SB, cx, cz, x, y, z, seed) {
    switch (gen.kind) {
      case 'ore': return placeOre(gen, SB, cx, cz, x, y, z, seed);
      case 'disk': return placeDisk(gen, SB, cx, cz, x, y, z, seed);
      case 'simple_block': {
        var r0 = new NS.Carvers.Rng(seed | 0, (seed / 65536) | 0, x * 7 + z * 13 + y);
        var cur = getBlock(SB, cx, cz, x, y, z);
        if (cur !== 0) return 0;
        var st0 = gen.to(r0, x, y, z);
        // ⚠ VANILLA'S `SimpleBlockFeature.place` DOES NOT WRITE ONE CELL FOR EVERY STATE (D-254).
        // It branches on `DoublePlantBlock`: it refuses unless the cell above is empty, and then
        // `DoublePlantBlock.placeAt` writes BOTH halves. MC-Lite wrote only the lower one, so
        // every two-block plant in the world was a HEADLESS STUB at exactly half vanilla's block
        // count — measured at 2.075 tall_grass a chunk in plains and 0.025 peony a chunk in
        // forest, with ZERO upper halves in 480 chunks. "peony never generates" was that plus a
        // sampling artefact: it is a forest flower at 0.025 a chunk and a 240-chunk world average
        // expects well under one, the same shape as the blue_orchid "never" already corrected.
        var up0 = tallUpper(st0);
        if (up0 > 0) {
          if (getBlock(SB, cx, cz, x, y + 1, z) !== 0) return 0;
          return setBlock(SB, cx, cz, x, y, z, st0) + setBlock(SB, cx, cz, x, y + 1, z, up0);
        }
        return setBlock(SB, cx, cz, x, y, z, st0);
      }
      case 'patch': {
        var r1 = new NS.Carvers.Rng(seed | 0, (seed / 65536) | 0, x * 31 + z * 17 + y);
        var n = 0;
        for (var i = 0; i < gen.tries; i++) {
          var px = x + r1.nextInt(gen.xz * 2 + 1) - gen.xz;
          var pz = z + r1.nextInt(gen.xz * 2 + 1) - gen.xz;
          var py = y + r1.nextInt(gen.ys * 2 + 1) - gen.ys;
          n += runInline(gen.inl, SB, cx, cz, px, py, pz, r1);
        }
        return n;
      }
      case 'column': {
        var r2 = new NS.Carvers.Rng(seed | 0, (seed / 65536) | 0, x * 3 + z * 5 + y);
        var L, k, wy, m = 0;
        // ⚠ EVERY LAYER'S HEIGHT IS DRAWN FIRST, whatever fits — vanilla's own order, and the
        // one the purity rule needs: the draws may not depend on a block read (D-136).
        var hs = COLH, tot = 0;
        for (L = 0; L < gen.layers.length; L++) { hs[L] = gen.layers[L].h(r2); tot += hs[L]; }
        if (tot <= 0) return 0;
        // how many cells the column actually has room for
        var fitted = 0;
        wy = y;
        for (k = 0; k < tot; k++) {
          var at = getBlock(SB, cx, cz, x, wy, z);
          if (at < 0 || !gen.allowed(at, x, wy, z)) break;
          fitted++; wy += gen.dir;
        }
        if (fitted < tot) {
          // vanilla's `BlockColumnFeature.truncate`: shave the overhang off the far end, or off
          // the START when the tip is the layer that matters
          var over = tot - fitted;
          var from = gen.tip ? 0 : gen.layers.length - 1, stepL = gen.tip ? 1 : -1;
          for (L = from; over > 0 && L >= 0 && L < gen.layers.length; L += stepL) {
            var cut = hs[L] < over ? hs[L] : over;
            hs[L] -= cut; over -= cut;
          }
        }
        wy = y;
        for (L = 0; L < gen.layers.length; L++) {
          for (k = 0; k < hs[L]; k++) {
            m += setBlock(SB, cx, cz, x, wy, z, gen.layers[L].p(r2, x, wy, z));
            wy += gen.dir;
          }
        }
        return m;
      }
      case 'select': {
        var r3 = new NS.Carvers.Rng(seed | 0, (seed / 65536) | 0, x * 11 + z * 23 + y);
        var o = selectIndex(gen, r3);
        if (o >= 0) return gen.opts[o].inl ? runInline(gen.opts[o].inl, SB, cx, cz, x, y, z, r3) : 0;
        return runInline(gen.def, SB, cx, cz, x, y, z, r3);
      }
      case 'selectUniform': {
        var r4 = new NS.Carvers.Rng(seed | 0, (seed / 65536) | 0, x * 19 + z * 29 + y);
        return runInline(gen.opts[r4.nextInt(gen.opts.length)], SB, cx, cz, x, y, z, r4);
      }
      case 'selectBool': {
        var r5 = new NS.Carvers.Rng(seed | 0, (seed / 65536) | 0, x * 37 + z * 41 + y);
        return runInline(r5.nextInt(2) ? gen.a : gen.b, SB, cx, cz, x, y, z, r5);
      }
      default:
        // a generator registered by one of the W8c/W8d modules
        if (typeof gen.run === 'function') {
          return gen.run(SB, cx, cz, x, y, z, new NS.Carvers.Rng(seed | 0, (seed / 65536) | 0, x * 31 + z * 17 + y));
        }
        return 0;
    }
  }

  /**
   * ⚠ D-140 — CAN THIS BLOCK STAND HERE? The one write-time rule in the whole pipeline.
   *
   * Session 4 measured 5,684 blocks standing on nothing in 169 chunks — 2,864 dead bushes,
   * 1,934 grass, 427 glow lichen, 47 mushrooms — and the cause is structural, not a typo:
   * a placement's y comes from `Column.height`, the terrain BEFORE the carvers (D-134), so
   * wherever W7 opened a cave to daylight (D-127) the ground under a plant is gone by the time
   * the plant is written. Vanilla never has the problem because `SimpleBlockFeature.place`
   * calls `state.canSurvive`. This is that call, for the three rules a support class can state:
   * a floor under it, a ceiling over it, or one solid face anywhere (vine and glow lichen).
   *
   * A plant counts as support for a plant, which is what keeps the upper half of a two-tall
   * grass and the segments of a sugar cane. A neighbour OUTSIDE this target chunk reads as -1
   * and is treated as SUPPORT: the alternative is a rule whose answer depends on which chunk is
   * being filled, and that is a seam. It costs nothing in practice — the floor and ceiling
   * cases are in the block's own column and so are never outside it.
   */
  /**
   * ⚠⚠ THE JAR'S OWN RULE FIRST, AS `World.canSurvive` DOES (#19, KW-25). The two doors used to ask
   * different questions: live edits asked the 40 `canSurvive` rules and worldgen asked only the three
   * support classes, so a vine, a glow lichen or an amethyst bud could be WRITTEN by a feature and
   * broken by the first block update beside it. `NS.Survive` (02k) is the one implementation; this
   * is its worldgen LEVEL — the scratch buffer of the chunk being filled.
   *
   * A cell outside the target chunk is "not loaded", which every rule answers SUPPORTED (the seam
   * convention this function's header already states). A worker has no tag registry and no light,
   * so those questions come back -1 and the whole rule answers "no opinion": the class below then
   * decides, exactly as before. What changes is the rules that need only blocks.
   */
  var WL = {
    miss: false, SB: null, cx: 0, cz: 0,
    getBlock: function (x, y, z) { var b = getBlock(WL.SB, WL.cx, WL.cz, x, y, z); return b < 0 ? 0 : b; },
    loadedAt: function (x, z) { var lx = x - (WL.cx << 4), lz = z - (WL.cz << 4); return lx >= 0 && lx < 16 && lz >= 0 && lz < 16; },
    tag: function (name, state) { return NS.States.inRuleTag(name, state); },
    light: function () { return -1; },
    sky: function () { return -1; }
  };
  // ⚠ RULE 29 (BIG DRIPLEAF STEM) IS NOT ASKED AT WRITE TIME, and the reason is vanilla's, not ours.
  // It needs a stem or a head ABOVE, and `block_column` writes upward from the bottom with
  // `setBlock` — it never calls `canSurvive` — so the cell above is air when the stem goes in and
  // asking would delete every dripleaf in the world (floatcheck's "a big_dripleaf stands on its
  // stem" went to zero). A column truncated below its head stays headless in vanilla too, and the
  // first update beside it pops it; the live door does that, the write door must not pre-empt it.
  var RULE_UNASKED = 29;
  function hasRule(st) { var r = NS.States.rule; return !!(r && r[st] && r[st] !== RULE_UNASKED); }
  function supported(SB, cx, cz, x, y, z, st) {
    var SRs = NS.States, cls = SRs.support[st];
    var rule = SRs.rule ? SRs.rule[st] : 0;
    if (rule && rule !== RULE_UNASKED) {
      WL.SB = SB; WL.cx = cx; WL.cz = cz;
      var rr = NS.Survive.eval(WL, x, y, z, st, rule);
      WL.SB = null;
      if (rr !== -1) return rr === 1;
    }
    if (!cls) return true;
    var b;
    if (cls === 1) {                                   // floor
      b = getBlock(SB, cx, cz, x, y - 1, z);
      // ⚠ ONE implementation of the rule, in States, called from here, from `World.canSurvive`
      // and from `floatcheck` (D-169). Three copies is three answers.
      return b < 0 || SRs.floorOk(st, b);
    }
    if (cls === 2) {                                   // ceiling
      b = getBlock(SB, cx, cz, x, y + 1, z);
      return b < 0 || SRs.ceilingOk(st, b);
    }
    var dx = [0, 0, 0, 0, -1, 1], dy = [-1, 1, 0, 0, 0, 0], dz = [0, 0, -1, 1, 0, 0];
    if (cls === 4) {                                   // behind: the wall it hangs on (D-158)
      // The live twin is `World.canSurvive`; both must answer the same, or a block worldgen
      // placed would be broken by the first edit near it. Same value-id mapping, same order.
      var fv = SRs.propValue(st, NS.Reg.PROP.facing), fi = FACING_TO_FACE[fv];
      if (fi === undefined) return true;
      b = getBlock(SB, cx, cz, x - dx[fi], y - dy[fi], z - dz[fi]);
      return b < 0 || SRs.anyFaceOk(b);
    }
    for (var d = 0; d < 6; d++) {
      b = getBlock(SB, cx, cz, x + dx[d], y + dy[d], z + dz[d]);
      if (b < 0) return true;
      if (SRs.anyFaceOk(b)) return true;
    }
    return false;
  }
  var FACING_TO_FACE = { 0: 2, 1: 3, 2: 4, 3: 5, 4: 1, 5: 0 };
  F.supported = supported;

  /**
   * ⚠⚠ D-241 — THE PART OF `state.canSurvive` THAT NO BLOCK TAG CAN STATE, AND THE 142x IT HID.
   *
   * `SimpleBlockFeature.place` writes nothing unless `state.canSurvive(level, pos)`, and D-140
   * ported that call as `supported` above: a floor, a ceiling, or a face, answered out of
   * `States`' placement sets, which are vanilla's own block tags flattened by `taglib`. That is
   * the right shape for thirty-odd families and it is STRUCTURALLY unable to state two of them,
   * because their rule is not a question about a tag at all:
   *
   *   MUSHROOM   `MushroomBlock.canSurvive` is "the block below is #mushroom_grow_block (mycelium
   *              or podzol), OR the raw brightness here is under 13 AND the block below renders
   *              solid". MC-Lite carried the second half's TAG and dropped its LIGHT, so a
   *              mushroom stood on any lit grass block in the game. `brown_mushroom_swamp` is
   *              `count 2` over a `random_patch` of 96 tries — 192 attempts a chunk, every one of
   *              them on the surface — and MEASURED over the 81 golden chunks of one swamp at
   *              seed 1337 the 1.18.2 server places 0.06 brown mushrooms a chunk there and
   *              MC-Lite placed 8.79. A hundred and forty-two times. It is a pink carpet from
   *              inside the game, and §6's world average moved by nothing at all because a swamp
   *              is under 1% of the pregen.
   *   LILY PAD   `WaterlilyBlock.mayPlaceOn` is "the fluid BELOW is water (or the block below is
   *              ice) and the fluid HERE is empty". `lily_pad`'s support class is 0 — no rule at
   *              all — so it was placed wherever a cell was free, which on `patch_waterlily`'s
   *              `WORLD_SURFACE_WG` origin with `y_spread 3` is four of the seven y it tries.
   *              MEASURED in the same swamp: vanilla 4.26 a chunk, MC-Lite 26.47.
   *
   * ⚠ WHY THE LIGHT RULE IS ANSWERED AS "IS THE SKY BLOCKED" AND WHY THAT IS NOT A CHEAPENING.
   * MC-Lite has no light at worldgen time and vanilla's own answer here is a skylight read. But
   * the placement is always ON THE SURFACE, where the only two ways vanilla gets under 13 are a
   * roof of terrain and a roof of leaves — and both are readable. The scratch buffer already
   * holds this chunk's trees, because a biome lists `trees_swamp` before `brown_mushroom_swamp`
   * in the same decoration step and `applyChunk` writes placements in that order, so a straight
   * scan up the mushroom's own column sees the canopy that shades it. The scan is inside the
   * target chunk by construction (`setBlock` has already refused every x/z outside it), so it
   * reads no neighbour and opens no seam: the source chunk still decides WHERE and the target
   * chunk decides WHETHER, exactly as this file's header requires.
   *
   * ⚠ AND IT LIVES HERE RATHER THAN IN `States.floorOk` ON PURPOSE. D-169 says a support rule
   * gets ONE implementation, shared by worldgen, `World.canSurvive` and `floatcheck` — and these
   * two are not support rules. Neither can be stated as "which block may be underneath": one is
   * a question about LIGHT and one is a question about a FLUID, and `floatcheck` walking a
   * generated world must go on saying a lily pad on water is standing on something. What this
   * adds is the FEATURE-time half of `canSurvive`, at the one call site vanilla makes it from,
   * and it can only ever REFUSE a placement — so no rule anywhere else changes its answer.
   */
  var FSV_MUSHROOM = 1, FSV_LILY = 2;
  var fsv = null;             // real state -> 0 none, 1 mushroom, 2 lily pad
  var fsvGrow = null;         // #mushroom_grow_block: the mushroom's tag exemption from the light
  var fsvWater = null;        // the lily pad's floor: water, and the ices vanilla counts as ice
  // 32 blocks is the whole of the answer: a shading roof that is further above than the tallest
  // tree in the game is terrain, and terrain above the placement is caught by the height test
  // one line earlier for the price of nothing.
  var SKY_SCAN = 32;

  function buildSurvival() {
    var SR = NS.States, n = SR.count, i;
    fsv = new Uint8Array(n); fsvGrow = new Uint8Array(n); fsvWater = new Uint8Array(n);
    var MUSH = { brown_mushroom: 1, red_mushroom: 1 };
    var GROW = { mycelium: 1, podzol: 1 };
    var WET = { water: 1, ice: 1, packed_ice: 1, blue_ice: 1, frosted_ice: 1 };
    var seen = 0;
    for (i = 1; i < n; i++) {
      var nm = SR.name(i);
      if (MUSH[nm] === 1) { fsv[i] = FSV_MUSHROOM; seen++; }
      else if (nm === 'lily_pad') { fsv[i] = FSV_LILY; seen++; }
      if (GROW[nm] === 1) fsvGrow[i] = 1;
      if (WET[nm] === 1) fsvWater[i] = 1;
    }
    // ⚠ A TABLE THAT MATCHED NOTHING WOULD BE A RULE THAT REFUSED NOTHING, and it would look
    // exactly like a rule that was obeyed. The registry has all three families or this throws.
    if (!seen) throw new Error('features: neither mushroom nor lily_pad is in the registry');
    return seen;
  }
  F.buildSurvival = buildSurvival;

  /** Is this cell open to the sky — the half of `MushroomBlock.canSurvive` that is about light? */
  function skyBlocked(SB, cx, cz, x, y, z) {
    // below the pre-feature terrain surface is a cave or an overhang, and neither sees daylight
    if (y <= NS.Column.height(x, z)) return true;
    var top = y + SKY_SCAN;
    if (top >= MAXY) top = MAXY - 1;
    for (var wy = y + 1; wy <= top; wy++) if (getBlock(SB, cx, cz, x, wy, z) > 0) return true;
    return false;
  }

  /** The feature-time half of `canSurvive`, for the two families a placement set cannot state. */
  function featureSurvives(SB, cx, cz, x, y, z, kind) {
    var b = getBlock(SB, cx, cz, x, y - 1, z);
    if (b < 0) b = terrainAt(x, y - 1, z);
    if (kind === FSV_LILY) return b > 0 && fsvWater[b] === 1;
    if (b > 0 && fsvGrow[b] === 1) return true;         // mycelium or podzol: lit or not
    return skyBlocked(SB, cx, cz, x, y, z);
  }
  F.featureSurvives = function (SB, cx, cz, x, y, z, st) {
    return fsv === null || fsv[st] === 0 || featureSurvives(SB, cx, cz, x, y, z, fsv[st]);
  };

  function setBlock(SB, cx, cz, x, y, z, st) {
    var lx = x - (cx << 4), lz = z - (cz << 4);
    if (lx < 0 || lx > 15 || lz < 0 || lz > 15) return 0;
    var ly = y - MINY;
    if (ly < 1 || ly >= H) return 0;
    if (st !== 0 && (NS.States.support[st] || hasRule(st)) && !supported(SB, cx, cz, x, y, z, st)) return 0;
    if (st !== 0 && fsv !== null && fsv[st] !== 0 && !featureSurvives(SB, cx, cz, x, y, z, fsv[st])) return 0;
    SB[(ly << 8) | (lz << 4) | lx] = st;
    return 1;
  }
  function getBlock(SB, cx, cz, x, y, z) {
    var lx = x - (cx << 4), lz = z - (cz << 4);
    if (lx < 0 || lx > 15 || lz < 0 || lz > 15) return -1;
    var ly = y - MINY;
    if (ly < 0 || ly >= H) return -1;
    return SB[(ly << 8) | (lz << 4) | lx];
  }

  /**
   * Vanilla's `OreFeature.place`: a segment of length `size/8` at a random angle through the
   * origin, then for each of `size` steps an ellipsoid whose radius follows a sine, and every
   * cell inside any of them is tested against the targets.
   */
  function placeOre(g, SB, cx, cz, x, y, z, seed) {
    var r = new NS.Carvers.Rng(seed | 0, (seed / 65536) | 0, x * 31 + z * 17 + y);
    var size = g.size;
    var f = r.nextFloat() * Math.PI;
    var d = size / 8;
    var i = Math.ceil((size / 16 + 1) / 2);
    var x0 = x + Math.sin(f) * d, x1 = x - Math.sin(f) * d;
    var z0 = z + Math.cos(f) * d, z1 = z - Math.cos(f) * d;
    var y0 = y + r.nextInt(3) - 2, y1 = y + r.nextInt(3) - 2;
    var written = 0;
    var minX = Math.floor(Math.min(x0, x1)) - i - 1, maxX = Math.ceil(Math.max(x0, x1)) + i + 1;
    // early-out: the whole blob's bounding box against this chunk
    if (maxX < (cx << 4) || minX > (cx << 4) + 15) return 0;
    var minZ = Math.floor(Math.min(z0, z1)) - i - 1, maxZ = Math.ceil(Math.max(z0, z1)) + i + 1;
    if (maxZ < (cz << 4) || minZ > (cz << 4) + 15) return 0;

    for (var k = 0; k < size; k++) {
      var t = k / size;
      var cxk = x0 + (x1 - x0) * t, cyk = y0 + (y1 - y0) * t, czk = z0 + (z1 - z0) * t;
      // ⚠ VANILLA'S RADIUS, and getting it wrong is not subtle: `((sin(pi*f) + 1) * d3 + 1) / 2`
      // where `d3` is `random.nextDouble() * size / 16`. A first draft added the two terms
      // instead of blending them, which for a size-64 diorite blob gave a radius of 6.5 instead
      // of 4.5 — and 4,032 blocks of diorite per chunk instead of about 128.
      var d3 = r.nextFloat() * size / 16;
      var rad = ((Math.sin(Math.PI * t) + 1) * d3 + 1) / 2;
      if (rad <= 0) continue;
      var r2 = rad * rad;
      var xa = Math.floor(cxk - rad), xb = Math.floor(cxk + rad);
      var ya = Math.floor(cyk - rad), yb = Math.floor(cyk + rad);
      var za = Math.floor(czk - rad), zb = Math.floor(czk + rad);
      for (var wx = xa; wx <= xb; wx++) {
        var ddx = (wx + 0.5 - cxk) / rad;
        if (ddx * ddx >= 1) continue;
        for (var wy = ya; wy <= yb; wy++) {
          var ddy = (wy + 0.5 - cyk) / rad;
          if (ddx * ddx + ddy * ddy >= 1) continue;
          for (var wz = za; wz <= zb; wz++) {
            var ddz = (wz + 0.5 - czk) / rad;
            if (ddx * ddx + ddy * ddy + ddz * ddz >= 1) continue;
            var cur = getBlock(SB, cx, cz, wx, wy, wz);
            if (cur < 0) continue;
            if (cur === 0) continue;                     // air is not replaceable by anything
            // ⚠ scattered ore drops most cells: it is what makes a "small" copper vein a
            // scatter of single blocks rather than a blob.
            if (g.scattered && r.nextFloat() > 0.5) continue;
            if (g.discard > 0 && r.nextFloat() < g.discard && airAdjacent(SB, cx, cz, wx, wy, wz)) continue;
            for (var ti = 0; ti < g.targets.length; ti++) {
              if (g.targets[ti].match(cur, wx, wy, wz)) {
                // count CHANGES, not writes: the spheres overlap heavily and vanilla dedupes
                // with a bit set. A cell written twice is one block of ore, not two.
                if (cur !== g.targets[ti].state) written += setBlock(SB, cx, cz, wx, wy, wz, g.targets[ti].state);
                else setBlock(SB, cx, cz, wx, wy, wz, g.targets[ti].state);
                break;
              }
            }
          }
        }
      }
    }
    return written;
  }

  function airAdjacent(SB, cx, cz, x, y, z) {
    return getBlock(SB, cx, cz, x + 1, y, z) === 0 || getBlock(SB, cx, cz, x - 1, y, z) === 0 ||
           getBlock(SB, cx, cz, x, y + 1, z) === 0 || getBlock(SB, cx, cz, x, y - 1, z) === 0 ||
           getBlock(SB, cx, cz, x, y, z + 1) === 0 || getBlock(SB, cx, cz, x, y, z - 1) === 0;
  }

  /**
   * ⚠ D-217 — A DISK IS ANCHORED TO WATER, AND MISSING THAT GATE REPAINTED 60% OF EVERY LAND
   * BIOME. `disk_sand`, `disk_gravel` and `disk_clay` sit in the UNDERGROUND_ORES step of nearly
   * every overworld biome with the chain `count 3 -> in_square -> heightmap OCEAN_FLOOR_WG ->
   * biome` and NO fluid predicate in the JSON — because in 1.18.2 the restriction is inside
   * `DiskFeature.place`, which returns immediately unless the origin cell holds water. (1.19
   * moved it into the data as `block_predicate_filter { matching_fluids: water }`, which is why
   * reading 1.18.2's placed-feature JSON makes it look unconditional.) Without the gate, three
   * disks a chunk at a mean radius of 4 turned plains into **51.7% sand**; the same box with
   * features off is **0.0% sand and 99.2% grass_block**, so the surface rules were never at
   * fault (D-215 has the whole diagnosis). The real game agrees: over 556,086 land columns of
   * the golden 1.18.2 pregen, **77.1% of sand-topped columns are within 6 blocks of water** —
   * 6 being `disk_sand`'s maximum radius — against 17.5% for grass_block.
   *
   * ⚠ THE GATE IS A PURE FUNCTION OF POSITION, NOT A BLOCK READ, and that is not a shortcut —
   * it is D-213's rule, learned four hours earlier in this same file. A `getBlock` at the origin
   * is ONE READ DECIDING MANY CELLS: it returns −1 in the eight neighbouring targets, so the
   * disk would be written by the chunk holding its origin and thrown away by the others, exactly
   * as every tree in the world was. The origin's y came from OCEAN_FLOOR_WG, which is
   * `Column.height + 1`, and that cell holds water precisely when it is at or below the sea —
   * so `y <= seaLevel` IS the water test, and every target chunk computes the same answer.
   */
  function placeDisk(g, SB, cx, cz, x, y, z, seed) {
    if (y > F.G.params.seaLevel) return 0;
    var r = new NS.Carvers.Rng(seed | 0, (seed / 65536) | 0, x * 13 + z * 7);
    var rad = g.radius(r);
    var written = 0;
    for (var wx = x - rad; wx <= x + rad; wx++) {
      for (var wz = z - rad; wz <= z + rad; wz++) {
        var dx = wx - x, dz = wz - z;
        if (dx * dx + dz * dz > rad * rad) continue;
        for (var wy = y - g.half; wy <= y + g.half; wy++) {
          var cur = getBlock(SB, cx, cz, wx, wy, wz);
          if (cur <= 0) continue;
          var ok = g.targets.length === 0;
          for (var ti = 0; ti < g.targets.length && !ok; ti++) if (g.targets[ti](cur, wx, wy, wz)) ok = true;
          if (!ok) continue;
          written += setBlock(SB, cx, cz, wx, wy, wz, g.state);
        }
      }
    }
    return written;
  }
})(MCL);
