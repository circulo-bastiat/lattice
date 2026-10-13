// 04p_feat_cold.js — the COLD and CAVE feature generators (PLAN W8d).
//
// Eleven of the 36 feature types, split across two climates that have nothing in common except
// the shape of the problem: icebergs, spikes, patches and the freeze pass on the surface;
// dripstone, lichen, vines and huge mushrooms underground and under the canopy.
//
// ── ⚠ THE RULE THAT DECIDES EVERY DESIGN CHOICE IN THIS FILE ─────────────────────────────────
//
// `run` is called ONCE PER TARGET CHUNK the feature can reach, with the SAME (x, y, z) and an
// identically seeded rng, and only the writes that land in that target survive. So the SHAPE a
// feature computes must be a pure function of its arguments, or the same iceberg comes out as
// two different icebergs in two neighbouring chunks and the seam is permanent.
//
// That splits every read in this file into two kinds, and getting the split wrong is the one
// bug worth being paranoid about:
//
//   * a read that decides WHAT THE FEATURE IS — where the cave ceiling is, whether this column
//     is deep enough for an iceberg, which faces a lichen has — must be PURE. It goes through
//     `Column.height` and `Caves.carve`, both of which are functions of (seed, position) and
//     answer the same in every target. `A.getBlock` is NOT allowed here: it returns -1 outside
//     the target chunk, so a decision made from it changes with the target.
//   * a read that decides WHETHER ONE CELL MAY BE OVERWRITTEN is the target chunk's own
//     business, exactly as the header of 04j describes, and `A.getBlock` is right for it. A -1
//     simply means "not mine", and `A.setBlock` would have clipped it anyway.
//
// ⚠ The same rule forbids letting a `getBlock` result change how much rng is consumed. Every
// loop below draws its randoms in a fixed order and then decides what to do with them; an early
// `break` on a block read would desynchronise the two targets' rng and tear the feature in half.
//
// ── ⚠ WHY `Caves.carve` AND NOT THE REAL BLOCKS ──────────────────────────────────────────────
//
// `Caves.carve` is the un-interpolated point query, and 04b warns that the chunk path (a 4-block
// lattice, interpolated) is the authority on what the world actually looks like. The two
// disagree near a cave wall. That is survivable HERE and nowhere else, because the per-cell
// write gate is the real blocks: where the oracle says "cave" and the world says "stone", the
// gate rejects the write and the feature is simply thinner. It never puts dripstone inside rock.
//
// ── WHAT IS APPROXIMATED, NAMED RATHER THAN HIDDEN ───────────────────────────────────────────
//
// Vanilla's generators are compiled Java and cannot be checked from here, so these reproduce the
// SHAPE — a tapering packed-ice spike, a hollow-ringed red mushroom cap, lichen coating a cave
// wall — and not the exact random sequence. Each generator's comment says where it diverges.
(function (NS) {
  'use strict';

  var F = NS.Features;
  var A = F.api;

  // ── block states ───────────────────────────────────────────────────────────────────────────
  //
  // ⚠ Resolved at COMPILE time (inside the makers), never at load time: `States` is not built
  // until `Reg.init` runs, which is long after this file is evaluated.
  var S = null;
  function states() {
    if (S) return S;
    S = {
      water: A.stateOf('water'),
      ice: A.stateOf('ice'),
      packedIce: A.stateOf('packed_ice'),
      blueIce: A.stateOf('blue_ice'),
      snowBlock: A.stateOf('snow_block'),
      snow1: NS.States.withLocal('snow', 0),          // snow[layers=1]
      dripstone: A.stateOf('dripstone_block'),
    };
    if (!S.packedIce || !S.snow1 || !S.dripstone) throw new Error('04p: the registry has no ice/snow/dripstone blocks');
    return S;
  }

  // ⚠ THE PROPERTY PROBLEM, AND THE ONE PLACE THIS FILE IS ALLOWED TO DO ARITHMETIC ON STATES.
  //
  // A vine with no face set renders as nothing, and a glow lichen with no face set is invisible
  // — for these two the properties ARE the feature, and "place the default state" would be the
  // silent hole the plan forbids. But the runtime registry deliberately does not carry property
  // NAMES (02c: 900 blocks of them is 40 KB nobody needs), and `WG.stateOf` only knows the
  // handful of `{Name, Properties}` nodes that literally appear in Mojang's worldgen JSON —
  // which for `vines` and `glow_lichen` is none, because their configs are `{}`.
  //
  // So the local index is computed here, from the ordering 02c and pack-worldgen both state:
  // properties in DECLARATION order with the LAST varying fastest, and a boolean enumerating as
  // [true, false] — true is 0, false is 1. The strides below are the declared orders:
  //     vine        east north south up west                 (32 states, default 31 = all false)
  //     glow_lichen down east north south up waterlogged west (128,      default 127 = all false)
  // Both defaults fall out of the arithmetic as all-ones, which is the cheap proof that the
  // strides are right, and `withLocal` clamps anything that is not.
  function vineState(up, north, east, south, west) {
    return NS.States.withLocal('vine',
      (east ? 0 : 16) + (north ? 0 : 8) + (south ? 0 : 4) + (up ? 0 : 2) + (west ? 0 : 1));
  }
  function lichenState(down, up, north, east, south, west) {
    return NS.States.withLocal('glow_lichen',
      (down ? 0 : 64) + (east ? 0 : 32) + (north ? 0 : 16) + (south ? 0 : 8) +
      (up ? 0 : 4) + /* waterlogged=false */ 2 + (west ? 0 : 1));
  }
  // pointed_dripstone: thickness [tip_merge tip frustum middle base], vertical_direction [up
  // down], waterlogged [true false]. Default 5 = tip/up/dry, which the arithmetic reproduces.
  var TIP = 1, FRUSTUM = 2, MIDDLE = 3, BASE = 4;
  function dripState(thickness, down) {
    return NS.States.withLocal('pointed_dripstone', thickness * 4 + (down ? 2 : 0) + 1);
  }

  // ── providers the shared API does not have ─────────────────────────────────────────────────
  //
  // `A.intProvider` covers the integer shapes. The dripstone configs are the only place in the
  // roster that use FLOAT providers, so their two forms live here rather than in 04j.
  function floatProvider(v, what) {
    if (typeof v === 'number') { var k = +v; return function () { return k; }; }
    if (!v || !v.type) throw new Error(what + ': missing float provider');
    var t = v.type.replace('minecraft:', '');
    if (t === 'constant') { var c = +v.value; return function () { return c; }; }
    if (t === 'uniform') {
      var lo = +v.value.min_inclusive, hi = +v.value.max_exclusive;
      return function (r) { return lo + r.nextFloat() * (hi - lo); };
    }
    if (t === 'clamped_normal') {
      // ⚠ the Rng has no gaussian, so this is the sum of three uniforms — variance 1/4, hence
      // the x2 — which is close enough for a value that only biases a wetness roll.
      var mean = +v.value.mean, dev = +v.value.deviation, mn = +v.value.min, mx = +v.value.max;
      return function (r) {
        var g = (r.nextFloat() + r.nextFloat() + r.nextFloat() - 1.5) * 2;
        var x = mean + dev * g;
        return x < mn ? mn : (x > mx ? mx : x);
      };
    }
    throw new Error(what + ': unsupported float provider ' + v.type);
  }

  /**
   * The exact state behind a `simple_state_provider`, PROPERTIES INCLUDED.
   *
   * `A.stateProvider` matches blocks by name and drops the properties (04j says so), which is
   * harmless for a flower and wrong for a mushroom cap, whose `down=false, up=true` is the
   * difference between a cap and a solid cube of cap texture. `WG.stateOf` resolves the exact
   * node when the build packed it — which it did, because these nodes are IN the feature config.
   */
  function exactState(v, what) {
    if (v && typeof v.type === 'string' && v.type.indexOf('simple_state_provider') >= 0 &&
        v.state && v.state.Properties && NS.WG) {
      var st = NS.WG.stateOf(v.state);
      if (st) return function () { return st; };
    }
    return A.stateProvider(v, what);
  }

  // ── the pure terrain oracle ────────────────────────────────────────────────────────────────
  //
  // "Is (x, y, z) open?" answered without touching a chunk: above the column's surface it is air
  // or water, below it, it is open exactly where a carver took it. See the header for why this
  // and not `A.getBlock`.
  //
  // ⚠ AND IT IS MEMOISED, because it is the only expensive thing in this file. `Column.height`
  // is a full climate evaluation — six noises — and a lichen asks about six neighbouring columns
  // for every cell it paints, times ~1300 lichen placements per target chunk. The same
  // direct-mapped table W8's `biomeAtMemo` used in 04j, and safe for the same reason: the height is a
  // function of (seed, x, z) alone, so a hit is always correct and only a 65536-block key alias
  // can miss, which no chunk's neighbourhood spans.
  var HC = 4096, hKey = new Int32Array(HC), hHas = new Uint8Array(HC), hVal = new Int32Array(HC);
  function heightAt(x, z) {
    var k = (((x * 0x9E3779B1) ^ (z * 0x85EBCA77)) >>> 20) & (HC - 1);
    var key = ((x & 0xFFFF) * 65536 + (z & 0xFFFF)) | 0;
    if (hHas[k] === 1 && hKey[k] === key) return hVal[k];
    var v = NS.Column.height(x, z);
    hKey[k] = key; hHas[k] = 1; hVal[k] = v;
    return v;
  }
  function openAt(x, y, z) {
    if (y > heightAt(x, z)) return 1;
    return (NS.Caves && NS.Caves.G) ? NS.Caves.carve(x, y, z) : 0;
  }
  function rockAt(x, y, z) {
    return (y <= heightAt(x, z) && !openAt(x, y, z)) ? 1 : 0;
  }
  /** Is this column inside the chunk being written? Only ever used to skip WORK, never rng. */
  function mine(cx, cz, x, z) { return (x >> 4) === cx && (z >> 4) === cz; }

  /**
   * The surface biome at QUART resolution, memoised — vanilla's own granularity for a biome
   * lookup, and the only resolution `freeze_top_layer` needs to decide whether a column is cold.
   *
   * ⚠ It does NOT reuse `Features.biomeAtMemo` — which no longer exists, deleted with the rest
   * of W8's surface-only biome lookup when the chunk grew a real biome volume (D-180). The
   * reason it did not is still worth writing down, because this table repeats its shape: that
   * memo's key was `(x & 0xFFFF) * 65536 + (z & 0xFFFF)`, which for a negative coordinate is a
   * number above 2^31 stored into an Int32Array — it came back wrapped negative and never
   * compared equal to the freshly computed key, so west or north of the origin the memo missed
   * every single time. 256 columns cost 6.5 ms through it and 0.5 ms through this one. The `|0`
   * below is the whole fix; the same wrap is applied to both sides of the comparison.
   */
  var BC = 1024, bKey = new Int32Array(BC), bHas = new Uint8Array(BC), bVal = new Int32Array(BC);
  function biomeQuartAt(x, z) {
    var qx = x >> 2, qz = z >> 2;
    var k = (((qx * 0x9E3779B1) ^ (qz * 0x85EBCA77)) >>> 20) & (BC - 1);
    var key = ((qx & 0xFFFF) * 65536 + (qz & 0xFFFF)) | 0;
    if (bHas[k] === 1 && bKey[k] === key) return bVal[k];
    var v = NS.Climate.surfaceBiomeAt(qx << 2, qz << 2);
    bKey[k] = key; bHas[k] = 1; bVal[k] = v;
    return v;
  }
  /** The first rock at or above y, within `range`, or -2147483648. Pure. */
  function ceilingFrom(x, y, z, range) {
    for (var i = 0; i <= range; i++) if (rockAt(x, y + i, z)) return y + i;
    return -2147483648;
  }
  /** The first rock at or below y, within `range`, or -2147483648. Pure. */
  function floorFrom(x, y, z, range) {
    for (var i = 0; i <= range; i++) if (rockAt(x, y - i, z)) return y - i;
    return -2147483648;
  }

  /** Cells a feature may grow into: air, or water where the feature is amphibious. */
  function fillable(st, wet) { return st === 0 || (wet && st === states().water); }

  // ── ICEBERG ────────────────────────────────────────────────────────────────────────────────
  //
  // Two configured features, `iceberg_packed` and `iceberg_blue`, differing only in the state.
  //
  // ⚠ The placement is `rarity_filter -> in_square -> biome` with NO heightmap, so the y it is
  // handed is 0. Vanilla's `IcebergFeature` ignores it too and works from the sea level, and so
  // does this. The berg is a stack of jittered ellipses tapering both ways from the waterline,
  // capped with snow — vanilla's is built from a signum noise field with random cutouts, which
  // gives a craggier silhouette than this does.
  F.register('iceberg', function (cfg, name) {
    var ice = exactState({ type: 'simple_state_provider', state: cfg.state }, name + '.state')();
    if (!ice) throw new Error(name + ': iceberg has no state');
    var SS = states();
    return {
      kind: 'iceberg', reach: 14,
      run: function (SB, cx, cz, x, y, z, r) {
        var sea = F.G.params.seaLevel;
        // pure gate: an iceberg belongs over open water, not on a beach
        if (NS.Column.height(x, z) > sea - 5) return 0;
        var rad = 4 + r.nextInt(9);                 // 4..12
        var up = 4 + r.nextInt(8);                  // 4..11 above the waterline
        var down = 3 + r.nextInt(6);                // 3..8 below it
        var lean = (r.nextFloat() - 0.5) * 0.6;     // the whole berg tips a little
        var n = 0;
        for (var dy = -down; dy <= up; dy++) {
          var t = dy >= 0 ? 1 - dy / (up + 1) : 1 - (-dy) / (down + 1.5);
          var rr = rad * t;
          if (rr < 0.7) continue;
          var ox = lean * dy, oz = -lean * dy;
          var top = (dy === up);
          for (var dx = -rad; dx <= rad; dx++) {
            for (var dz = -rad; dz <= rad; dz++) {
              var fx = dx - ox, fz = dz - oz;
              if (fx * fx + fz * fz > rr * rr) continue;
              var cur = A.getBlock(SB, cx, cz, x + dx, sea + dy, z + dz);
              if (cur !== 0 && cur !== SS.water) continue;
              n += A.setBlock(SB, cx, cz, x + dx, sea + dy, z + dz, top ? SS.snowBlock : ice);
            }
          }
        }
        return n;
      },
    };
  });

  // ── ICE SPIKE ──────────────────────────────────────────────────────────────────────────────
  //
  // Vanilla's `IceSpikeFeature`, which is what the ice spikes biome is named for: a tapering
  // packed-ice column of height 7..10 and radius 1..3, thinned by a 0.75 roll on its outermost
  // ring, plus a stub of column driven back down into the ground so the spike is rooted.
  //
  // ⚠ Vanilla first walks down to solid ground and refuses unless it lands on a snow block. That
  // read cannot be pure (it is a block read at a position that may be in another chunk), so the
  // ground comes from the heightmap instead — which is where the `heightmap: MOTION_BLOCKING`
  // modifier already put the y — and the snow-block test is dropped. It costs nothing in
  // practice: the only biome that lists this feature has a snow-block surface everywhere.
  F.register('ice_spike', function (cfg, name) {
    var SS = states();
    return {
      kind: 'ice_spike', reach: 5,
      run: function (SB, cx, cz, x, y, z, r) {
        var base = y - 1;                            // the top solid block under the placement
        var h = r.nextInt(4) + 7;
        var rad = ((h / 4) | 0) + r.nextInt(2);
        var lift = r.nextInt(4);
        // vanilla's rare floating spike, drawn here so the rng stays in step either way
        var high = (rad > 1 && r.nextInt(60) === 0) ? 10 + r.nextInt(30) : 0;
        base += lift + high;
        var n = 0;
        for (var k = 0; k < h; k++) {
          var f = (1 - k / h) * rad;
          var l = Math.ceil(f);
          for (var dx = -l; dx <= l; dx++) {
            var f1 = Math.abs(dx) - 0.25;
            for (var dz = -l; dz <= l; dz++) {
              var f2 = Math.abs(dz) - 0.25;
              var edge = (dx === -l || dx === l || dz === -l || dz === l);
              var keep = r.nextFloat() <= 0.75;      // drawn every cell: see the header
              if (dx === 0 && dz === 0) keep = true;
              else if (f1 * f1 + f2 * f2 > f * f) continue;
              else if (edge && !keep) continue;
              n += put(SB, cx, cz, x + dx, base + k, z + dz, SS);
              if (k !== 0 && l > 1) n += put(SB, cx, cz, x + dx, base - k, z + dz, SS);
            }
          }
        }
        // the root: up to five blocks of column driven down from each of the four inner corners
        var k1 = rad - 1 > 1 ? 1 : rad - 1;
        for (var ax = -k1; ax <= k1; ax++) {
          for (var az = -k1; az <= k1; az++) {
            var depth = (Math.abs(ax) === 1 && Math.abs(az) === 1) ? r.nextInt(5) : 5;
            for (var d = 1; d <= depth; d++) n += put(SB, cx, cz, x + ax, base - d, z + az, SS);
          }
        }
        return n;
      },
    };
    /** One spike cell: packed ice over anything soft, nothing over stone. */
    function put(SB, cx, cz, wx, wy, wz, SS) {
      var cur = A.getBlock(SB, cx, cz, wx, wy, wz);
      if (cur < 0) return 0;
      if (cur !== 0 && cur !== SS.snowBlock && cur !== SS.ice && cur !== SS.packedIce &&
          cur !== SS.water) return 0;
      return A.setBlock(SB, cx, cz, wx, wy, wz, SS.packedIce);
    }
  });

  // ── ICE PATCH ──────────────────────────────────────────────────────────────────────────────
  //
  // A disk in everything but name — `{state, radius, half_height, targets}` is the disk config —
  // and vanilla's `IcePatchFeature` is `DiskFeature` with a snow-block precondition. Same
  // treatment as the spike: the precondition is dropped, the shape is not.
  //
  // ⚠ The targets are STATES (`{Name, Properties}`), not predicates — `grass_block[snowy=false]`
  // — and are matched by block name, which is exactly what 04j's `disk` does with the same list.
  F.register('ice_patch', function (cfg, name) {
    var st = exactState({ type: 'simple_state_provider', state: cfg.state }, name + '.state')();
    if (!st) throw new Error(name + ': ice_patch has no state');
    var radius = A.intProvider(cfg.radius, name + '.radius');
    var half = cfg.half_height | 0;
    var names = (cfg.targets || []).map(function (t) { return (t.Name || t).replace('minecraft:', ''); });
    if (!names.length) throw new Error(name + ': ice_patch has no targets');
    var match = A.predicate({ predicate_type: 'matching_blocks', blocks: names });
    return {
      kind: 'ice_patch', reach: 10,
      run: function (SB, cx, cz, x, y, z, r) {
        var rad = radius(r), n = 0;
        var base = y - 1;
        for (var dx = -rad; dx <= rad; dx++) {
          for (var dz = -rad; dz <= rad; dz++) {
            if (dx * dx + dz * dz > rad * rad) continue;
            for (var dy = -half; dy <= half; dy++) {
              var cur = A.getBlock(SB, cx, cz, x + dx, base + dy, z + dz);
              if (cur <= 0 || !match(cur, x + dx, base + dy, z + dz)) continue;
              n += A.setBlock(SB, cx, cz, x + dx, base + dy, z + dz, st);
            }
          }
        }
        return n;
      },
    };
  });

  // ── BLUE ICE ───────────────────────────────────────────────────────────────────────────────
  //
  // Vanilla's `BlueIceFeature`: a scatter of blue ice under the waterline of a frozen ocean, 200
  // tries around one origin with a downward-biased y offset and a radius that shrinks with it.
  //
  // ⚠ Vanilla additionally requires a packed-ice neighbour before it starts, which is a block
  // read of a position that may not be in this target. Dropped; the sea-level gate is pure and
  // kept, and the `count: 0..19` placement already makes this rare.
  F.register('blue_ice', function (cfg, name) {
    var SS = states();
    return {
      kind: 'blue_ice', reach: 6,
      run: function (SB, cx, cz, x, y, z, r) {
        var sea = F.G.params.seaLevel;
        if (y > sea - 1) return 0;                   // pure: below the waterline only
        var n = 0;
        n += set(SB, cx, cz, x, y, z, SS);
        for (var i = 0; i < 200; i++) {
          var dy = r.nextInt(5) - r.nextInt(6);
          var k = 3 + (dy < 2 ? (dy / 2 | 0) : 0);
          var ax = k >= 1 ? r.nextInt(k) - r.nextInt(k) : 0;
          var az = k >= 1 ? r.nextInt(k) - r.nextInt(k) : 0;
          if (k < 1) continue;
          n += set(SB, cx, cz, x + ax, y + dy, z + az, SS);
        }
        return n;
      },
    };
    function set(SB, cx, cz, wx, wy, wz, SS) {
      var cur = A.getBlock(SB, cx, cz, wx, wy, wz);
      if (cur < 0) return 0;
      if (cur !== 0 && cur !== SS.water && cur !== SS.ice && cur !== SS.packedIce) return 0;
      return A.setBlock(SB, cx, cz, wx, wy, wz, SS.blueIce);
    }
  });

  // ── FREEZE TOP LAYER ───────────────────────────────────────────────────────────────────────
  //
  // ⚠ THE ODD ONE OUT, AND THE REASON IT IS WORTH CARE. Every other feature is a thing at a
  // position; this one is a PASS OVER THE WHOLE CHUNK. Its placement is a bare `biome` filter,
  // so it arrives exactly once per source chunk at that chunk's origin with y = 0, and it walks
  // all 256 columns: snow on cold ground, ice on cold water. It is what makes a snowy taiga
  // white and what freezes the surface of a lake in it.
  //
  // ⚠ Because it only ever writes inside its own 16x16, the first thing it does is check that
  // the target IS that chunk and return otherwise. That is a test on its arguments, not on the
  // blocks, so it stays pure — and it saves 255 wasted column walks per neighbour.
  //
  // ── WHAT VANILLA ACTUALLY DOES, READ OFF THE 1.18.2 JAR AND NOT OFF MEMORY (D-219) ─────────
  //
  // `SnowAndFreezeFeature.place` walks the chunk's 16x16, takes `getHeight(MOTION_BLOCKING, x, z)`
  // as `above`, sets `target = above - 1`, asks `getBiome(above)`, and then:
  //
  //     if (biome.shouldFreeze(level, target, false))  setBlock(target, ICE);
  //     if (biome.shouldSnow(level, above))            setBlock(above, SNOW);
  //
  // and `Biome.shouldFreeze(level, pos, mustBeAtEdge)` is:
  //
  //     if (warmEnoughToRain(pos)) return false;                      // temperature >= 0.15
  //     if (pos.y < minBuildHeight || pos.y >= maxBuildHeight) return false;
  //     if (level.getBrightness(BLOCK, pos) >= 10) return false;      // 0 everywhere at worldgen
  //     if (fluid != WATER || !(block instanceof LiquidBlock)) return false;
  //     if (!mustBeAtEdge) return true;
  //     return !(isWaterAt(west) && isWaterAt(east) && isWaterAt(north) && isWaterAt(south));
  //
  // ⚠ **THE FEATURE PASSES `mustBeAtEdge = false`** — verified as `iconst_0` at the call site in
  // the jar, not recalled. The four-neighbour test is the RANDOM-TICK path, the one that freezes a
  // pond inward from its rim over time; it is not this. That matters here more than anywhere,
  // because a neighbour test is one read deciding a cell in another chunk and D-213 and D-217 are
  // both this project paying for exactly that. **Do not add one.** Nothing in vanilla's worldgen
  // freeze looks sideways, so nothing in this one does either, and the golden-world referee says
  // the rule agrees per column on 97% of a real frozen ocean's water and ice.
  //
  // "Cold" is therefore `Biome.getHeightAdjustedTemperature` below 0.15 — vanilla's
  // `warmEnoughToRain` threshold, already spelled that way in 04g — evaluated at the TARGET
  // block, so the frozen-ocean noise patches and the ragged mountain snow line both come through.
  // ⚠ Those patches are only as good as `Biome.FROZEN_TEMPERATURE_NOISE`, and D-219 is the
  // session that found it built on the wrong octave list. See `03b_noise.js`.
  // ⚠ **THE TUFT BLOCKING THE SNOW IS CORRECT, AND THE ANSWER KEY IS WHY (D-245).** D-241 read
  // the 15-to-1 grass-tuft surplus in a snowy taiga as a bug in THIS function, on the argument
  // that `SnowAndFreezeFeature` takes the MOTION_BLOCKING position — which excludes a
  // collisionless plant — and writes snow INTO that cell, over the plant. It does not.
  // `Biome.shouldSnow` requires the block AT that position to be air (or snow) before it will
  // place a layer, so a tuft standing there stops the snow in vanilla exactly as it does here.
  // MEASURED rather than argued: censusing the topmost block of every column in 120 golden
  // 1.18.2 chunks that are >=90% a snowy biome gives snow 225.14, ice 25.09 and **grass 4.28 per
  // chunk** — a number that would be ZERO if vanilla overwrote the plant. The surplus is a COUNT
  // in the grass patch feature, not a rule here. **Do not add a "replace the plant" branch.**
  F.register('freeze_top_layer', function (cfg, name) {
    var SS = states();
    var B = NS.Biomes;
    return {
      kind: 'freeze_top_layer', reach: 16,
      run: function (SB, cx, cz, x, y, z) {
        if ((x >> 4) !== cx || (z >> 4) !== cz) return 0;
        var n = 0, sea = F.G.params.seaLevel;
        for (var dx = 0; dx < 16; dx++) {
          for (var dz = 0; dz < 16; dz++) {
            var wx = x + dx, wz = z + dz;
            // the topmost non-air block, found from the pure heightmap and then confirmed in the
            // chunk (the surface pass and the carvers can both have moved it a little)
            // ⚠ `heightAt` and `biomeQuartAt` and not `Column.height` and
            // `Climate.surfaceBiomeAt`: 256 columns x a full climate evaluation each is 10 ms of
            // the chunk's budget. Both memos answer the same numbers — the biome one at
            // vanilla's own quart resolution — for a sixteenth of the noise.
            var h = heightAt(wx, wz);
            var top = (h < sea ? sea : h) + 2;
            var st = -1, ty = 0;
            for (var s = 0; s < 10; s++) {
              var got = A.getBlock(SB, cx, cz, wx, top - s, wz);
              if (got > 0) { st = got; ty = top - s; break; }
            }
            if (st < 0) continue;
            var bi = biomeQuartAt(wx, wz);
            if (B.temperatureAt(bi, wx, ty, wz) >= 0.15) continue;
            if (st === SS.water) {
              n += A.setBlock(SB, cx, cz, wx, ty, wz, SS.ice);
            } else if (NS.States.solid[st] === 1 &&
                       A.getBlock(SB, cx, cz, wx, ty + 1, wz) === 0) {
              n += A.setBlock(SB, cx, cz, wx, ty + 1, wz, SS.snow1);
            }
          }
        }
        return n;
      },
    };
  });

  // ── DRIPSTONE CLUSTER ──────────────────────────────────────────────────────────────────────
  //
  // Vanilla's `DripstoneClusterFeature`: a patch of cave ceiling and floor within `radius` of
  // the origin grows stalactites and stalagmites, tallest in the middle, thinning towards the
  // edge, with a `dripstone_block` layer bedded into the rock behind each one so the spike does
  // not appear to hang off nothing.
  //
  // Every config field is used: `density` is the per-column roll, `height` and `height_deviation`
  // the length, `max_distance_from_center_affecting_height_bias` the taper, the two
  // `..._chance_of_dripstone_column...` fields the chance a column reaches all the way from
  // floor to ceiling, `max_stalagmite_stalactite_height_diff` how unequal a pair may be, and
  // `wetness` the chance of the pair at all.
  //
  // ⚠ The ceiling and floor come from the pure oracle, per column, so the cluster is the same
  // cluster in all nine targets. The write gate is the real blocks.
  F.register('dripstone_cluster', function (cfg, name) {
    var SS = states();
    var pHeight = A.intProvider(cfg.height, name + '.height');
    var pRadius = A.intProvider(cfg.radius, name + '.radius');
    var pLayer = A.intProvider(cfg.dripstone_block_layer_thickness, name + '.layer');
    var pDensity = floatProvider(cfg.density, name + '.density');
    var pWetness = floatProvider(cfg.wetness, name + '.wetness');
    var chanceEdge = +(cfg.chance_of_dripstone_column_at_max_distance_from_center || 0);
    var edgeSpan = Math.max(1, cfg.max_distance_from_edge_affecting_chance_of_dripstone_column | 0);
    var biasSpan = Math.max(1, cfg.max_distance_from_center_affecting_height_bias | 0);
    var maxDiff = cfg.max_stalagmite_stalactite_height_diff | 0;
    var dev = cfg.height_deviation | 0;
    var search = Math.max(1, cfg.floor_to_ceiling_search_range | 0);
    return {
      kind: 'dripstone_cluster', reach: 10,
      run: function (SB, cx, cz, x, y, z, r) {
        // ⚠ the cheap pure reject FIRST: two noise lookups throw away the ~90% of placements
        // that landed in solid rock, before any of the per-column work below.
        if (!openAt(x, y, z)) return 0;
        var height = pHeight(r), radius = pRadius(r);
        var density = pDensity(r), wetness = pWetness(r);
        var n = 0;
        for (var dx = -radius; dx <= radius; dx++) {
          for (var dz = -radius; dz <= radius; dz++) {
            var d2 = dx * dx + dz * dz;
            // ⚠ every roll below is drawn for every column in the square, in a fixed order,
            // whatever the circle test says — the rng must not depend on the geometry test.
            var roll = r.nextFloat(), colRoll = r.nextFloat(), wetRoll = r.nextFloat();
            var jitterUp = dev > 0 ? r.nextInt(dev * 2 + 1) - dev : 0;
            var jitterDn = dev > 0 ? r.nextInt(dev * 2 + 1) - dev : 0;
            var layer = pLayer(r);
            if (d2 > radius * radius) continue;
            var dist = Math.sqrt(d2);
            if (roll > density) continue;
            var wx = x + dx, wz = z + dz;
            // ⚠ AFTER every roll above, never before: a column outside the target writes
            // nothing, so its ceiling and floor need not be found. Skipping it earlier would
            // consume a different number of randoms in different targets and tear the cluster.
            if (!mine(cx, cz, wx, wz)) continue;
            var ceil = ceilingFrom(wx, y, wz, search);
            var flr = floorFrom(wx, y, wz, search);
            if (ceil === -2147483648 || flr === -2147483648 || ceil - flr < 2) continue;
            // tallest at the centre, `chanceEdge` at the rim; a full column when the roll wins
            var bias = 1 - Math.min(1, dist / biasSpan);
            var edge = Math.min(1, (radius - dist) / edgeSpan);
            var full = colRoll < chanceEdge + (1 - chanceEdge) * edge * bias;
            var gap = ceil - flr - 1;
            var hUp = Math.max(1, Math.min(gap, ((height * (0.35 + 0.65 * bias)) | 0) + jitterUp));
            var hDn = Math.max(0, Math.min(gap, ((height * (0.35 + 0.65 * bias)) | 0) + jitterDn));
            if (hDn > hUp + maxDiff) hDn = hUp + maxDiff;
            if (hUp > hDn + maxDiff && hDn > 0) hUp = hDn + maxDiff;
            if (wetRoll > wetness && !full) hDn = 0;
            if (full) { hUp = gap; hDn = 0; }
            n += bed(SB, cx, cz, wx, ceil, wz, 1, layer, SS);
            n += spike(SB, cx, cz, wx, ceil - 1, wz, -1, hUp, full, SS);
            if (hDn > 0) {
              n += bed(SB, cx, cz, wx, flr, wz, -1, layer, SS);
              n += spike(SB, cx, cz, wx, flr + 1, wz, 1, hDn, false, SS);
            }
          }
        }
        return n;
      },
    };
  });

  /** `thickness` blocks of dripstone_block bedded into the rock the spike hangs from. */
  function bed(SB, cx, cz, wx, wy, wz, dir, thickness, SS) {
    var n = 0;
    for (var i = 0; i < thickness; i++) {
      var cur = A.getBlock(SB, cx, cz, wx, wy + dir * i, wz);
      if (cur < 0) continue;
      if (cur === 0 || cur === SS.water) break;      // out of rock: stop bedding
      n += A.setBlock(SB, cx, cz, wx, wy + dir * i, wz, SS.dripstone);
    }
    return n;
  }

  /**
   * One pointed_dripstone spike of `len` blocks growing in `dir` (-1 hanging, +1 standing).
   * base -> middle -> frustum -> tip, which is the thickness ramp vanilla uses; a `merge` spike
   * that spans the whole gap ends in `tip_merge` instead.
   */
  function spike(SB, cx, cz, wx, wy, wz, dir, len, merge, SS) {
    var n = 0;
    for (var i = 0; i < len; i++) {
      var left = len - 1 - i;
      var th = left === 0 ? (merge ? 0 : TIP) : (left === 1 ? FRUSTUM : (i === 0 ? BASE : MIDDLE));
      var wyi = wy + dir * i;
      var cur = A.getBlock(SB, cx, cz, wx, wyi, wz);
      if (cur < 0) continue;                          // another target's cell, not a stop
      if (!fillable(cur, true)) break;
      n += A.setBlock(SB, cx, cz, wx, wyi, wz, dripState(th, dir < 0));
    }
    return n;
  }

  // ── LARGE DRIPSTONE ────────────────────────────────────────────────────────────────────────
  //
  // Vanilla's `LargeDripstoneFeature`: one fat cone of `dripstone_block` from the ceiling and
  // another from the floor of the same cave, radius clamped so a column can never be wider than
  // a third of the cave it is in, and — for a wide, blunt one — sheared sideways by `wind_speed`
  // so it leans.
  //
  // ⚠ `bluntness` here is an EXPONENT on the taper (higher = pointier) rather than vanilla's
  // exact profile function, which is compiled Java. The silhouette is the same family of shapes
  // and honours the two `min_..._for_wind` gates the config carries.
  F.register('large_dripstone', function (cfg, name) {
    var SS = states();
    var pRadius = A.intProvider(cfg.column_radius, name + '.radius');
    var pScale = floatProvider(cfg.height_scale, name + '.height_scale');
    var pStalactite = floatProvider(cfg.stalactite_bluntness, name + '.stalactite_bluntness');
    var pStalagmite = floatProvider(cfg.stalagmite_bluntness, name + '.stalagmite_bluntness');
    var pWind = floatProvider(cfg.wind_speed, name + '.wind_speed');
    var minRadWind = cfg.min_radius_for_wind | 0;
    var minBluntWind = +cfg.min_bluntness_for_wind;
    var ratio = +cfg.max_column_radius_to_cave_height_ratio;
    var search = Math.max(1, cfg.floor_to_ceiling_search_range | 0);
    return {
      kind: 'large_dripstone', reach: 14,
      run: function (SB, cx, cz, x, y, z, r) {
        if (!openAt(x, y, z)) return 0;
        var ceil = ceilingFrom(x, y, z, search);
        var flr = floorFrom(x, y, z, search);
        if (ceil === -2147483648 || flr === -2147483648) return 0;
        var cave = ceil - flr - 1;
        if (cave < 4) return 0;
        var radius = pRadius(r);
        var cap = Math.floor(cave * ratio);
        if (radius > cap) radius = cap;
        var scale = pScale(r);
        var bluntUp = pStalactite(r), bluntDn = pStalagmite(r);
        var wind = pWind(r);
        var ang = r.nextFloat() * Math.PI * 2;
        if (radius < 1) return 0;
        var windX = 0, windZ = 0;
        if (radius >= minRadWind && bluntUp >= minBluntWind) {
          windX = Math.cos(ang) * wind; windZ = Math.sin(ang) * wind;
        }
        var n = 0;
        n += cone(SB, cx, cz, x, ceil - 1, z, -1, radius, radius * scale, bluntUp, windX, windZ, cave, SS);
        n += cone(SB, cx, cz, x, flr + 1, z, 1, radius, radius * scale, bluntDn, 0, 0, cave, SS);
        return n;
      },
    };
  });

  /** One half of a large dripstone: a tapering stack of discs ending in a pointed tip. */
  function cone(SB, cx, cz, x, y0, z, dir, radius, height, blunt, windX, windZ, cave, SS) {
    var n = 0;
    var maxLen = Math.min(height, cave - 1) | 0;
    if (maxLen < 1) return 0;
    var exp = 1 / Math.max(0.15, blunt);
    for (var dx = -radius; dx <= radius; dx++) {
      for (var dz = -radius; dz <= radius; dz++) {
        var d = Math.sqrt(dx * dx + dz * dz);
        if (d > radius) continue;
        var t = 1 - d / (radius + 0.001);
        var len = Math.round(maxLen * Math.pow(t, exp));
        if (len < 1) continue;
        for (var i = 0; i < len; i++) {
          var wx = x + dx + Math.round(windX * i), wz = z + dz + Math.round(windZ * i);
          var wy = y0 + dir * i;
          var cur = A.getBlock(SB, cx, cz, wx, wy, wz);
          if (cur < 0) continue;
          if (!fillable(cur, true)) break;
          var last = (i === len - 1);
          n += A.setBlock(SB, cx, cz, wx, wy, wz, last ? dripState(TIP, dir < 0) : SS.dripstone);
        }
      }
    }
    return n;
  }

  // ── GLOW LICHEN ────────────────────────────────────────────────────────────────────────────
  //
  // Vanilla's `GlowLichenFeature` (a `MultifaceGrowthConfiguration`): the lichen is a FILM on
  // the faces of the rock around it, so what it places is one block whose `up/north/east/...`
  // properties say which faces are painted — see the note on `lichenState` for why those
  // properties have to be built by hand here.
  //
  // The config says ceiling and wall but never floor, and lists the rock it will sit on. That
  // list is stone and its cave-generation cousins, i.e. "a cave wall", so this uses the pure
  // oracle's notion of rock for the face test rather than eight block comparisons that could
  // not be pure anyway. `chance_of_spreading` then walks the film along the wall.
  F.register('glow_lichen', function (cfg, name) {
    if (!cfg.can_be_placed_on || !cfg.can_be_placed_on.length) {
      throw new Error(name + ': glow_lichen has no can_be_placed_on list');
    }
    var onFloor = !!cfg.can_place_on_floor, onCeiling = !!cfg.can_place_on_ceiling;
    var onWall = !!cfg.can_place_on_wall;
    var spread = +(cfg.chance_of_spreading || 0);
    if (!onFloor && !onCeiling && !onWall) throw new Error(name + ': glow_lichen may sit on nothing');
    var DIRS = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]];
    return {
      kind: 'glow_lichen', reach: 6,
      run: function (SB, cx, cz, x, y, z, r) {
        var n = 0, wx = x, wy = y, wz = z;
        for (var step = 0; step < 6; step++) {
          var pick = r.nextInt(6), go = r.nextFloat();
          n += paint(SB, cx, cz, wx, wy, wz);
          if (step > 0 && go > spread) break;
          var d = DIRS[pick];
          wx += d[0]; wy += d[1]; wz += d[2];
        }
        return n;
      },
    };
    /**
     * One lichen block, with a face set for every rock it touches.
     * ⚠ The `getBlock` test comes FIRST and is pure work-skipping: eight of the nine source
     * chunks are not this target, and answering -1 in one comparison saves six oracle queries.
     * It cannot change the shape because `paint` draws no randoms and returns only writes.
     */
    function paint(SB, cx, cz, wx, wy, wz) {
      if (A.getBlock(SB, cx, cz, wx, wy, wz) !== 0) return 0;
      if (!openAt(wx, wy, wz)) return 0;
      var up = onCeiling && rockAt(wx, wy + 1, wz) === 1;
      var down = onFloor && rockAt(wx, wy - 1, wz) === 1;
      var north = onWall && rockAt(wx, wy, wz - 1) === 1;
      var south = onWall && rockAt(wx, wy, wz + 1) === 1;
      var east = onWall && rockAt(wx + 1, wy, wz) === 1;
      var west = onWall && rockAt(wx - 1, wy, wz) === 1;
      if (!(up || down || north || south || east || west)) return 0;
      return A.setBlock(SB, cx, cz, wx, wy, wz, lichenState(down, up, north, east, south, west));
    }
  });

  // ── VINES ──────────────────────────────────────────────────────────────────────────────────
  //
  // Vanilla's `VinesFeature`: an empty position with a solid block on one horizontal side gets a
  // vine hung on that side. One block, one face — everything else about a vine is growth ticks,
  // which MC-Lite does not have. Placed 127 times per chunk in a jungle and 256 times per chunk
  // for the classic cave variant, which is why this stays as cheap as it looks.
  F.register('vines', function (cfg, name) {
    return {
      kind: 'vines', reach: 1,
      run: function (SB, cx, cz, x, y, z) {
        // the block test first, for the same reason the lichen does it: no randoms are drawn
        // here, so skipping the oracle when this is not our target changes nothing but the cost
        if (A.getBlock(SB, cx, cz, x, y, z) !== 0) return 0;
        if (!openAt(x, y, z)) return 0;
        var north = rockAt(x, y, z - 1) === 1, south = rockAt(x, y, z + 1) === 1;
        var east = rockAt(x + 1, y, z) === 1, west = rockAt(x - 1, y, z) === 1;
        if (!(north || south || east || west)) return 0;
        // vanilla takes the FIRST acceptable side rather than all of them
        if (north) { south = east = west = false; }
        else if (south) { east = west = false; }
        else if (east) { west = false; }
        return A.setBlock(SB, cx, cz, x, y, z, vineState(false, north, east, south, west));
      },
    };
  });

  // ── HUGE MUSHROOMS ─────────────────────────────────────────────────────────────────────────
  //
  // `HugeMushroomFeature`: a one-block stem of height 4..6 (doubled one time in twelve) with a
  // cap on top, and the two subclasses differ only in the cap.
  //
  //   brown   one flat plate of radius `foliage_radius` (3) with the four corners cut — the
  //           parasol.
  //   red     a hollow ring wall of radius 2 for the three layers below the top, then a 3x3 lid
  //           with its corners and its centre cut, so the stem comes through — the toadstool.
  //
  // ⚠ Vanilla rewrites the cap's face properties per cell so the cap is textured only on its
  // outside. This places the ONE state the config names (`down=false, up=true`, sides on), which
  // is right for the rim and slightly over-textured underneath. `exactState` is what makes even
  // that much possible — see its comment.
  //
  // ⚠ Vanilla's `isValidPosition` checks for dirt below and clear air above. Both are block
  // reads that would not be pure, and the `heightmap` modifier in the placement has already put
  // the origin on the surface, so the per-cell write gate is the only check kept.
  function mushroom(kindName, capOf) {
    return function (cfg, name) {
      var cap = exactState(cfg.cap_provider, name + '.cap');
      var stem = exactState(cfg.stem_provider, name + '.stem');
      var radius = cfg.foliage_radius === undefined ? 2 : cfg.foliage_radius | 0;
      if (radius < 1) throw new Error(name + ': foliage_radius ' + cfg.foliage_radius + ' is too small for a cap');
      return {
        kind: kindName, reach: radius + 2,
        run: function (SB, cx, cz, x, y, z, r) {
          var h = r.nextInt(3) + 4;
          if (r.nextInt(12) === 0) h *= 2;
          var n = capOf(SB, cx, cz, x, y, z, h, radius, cap, stem, r);
          for (var i = 0; i < h; i++) n += soft(SB, cx, cz, x, y + i, z, stem(r, x, y + i, z));
          return n;
        },
      };
    };
  }
  /** A mushroom cell: only into air or leaves-like nothing, never through rock. */
  function soft(SB, cx, cz, wx, wy, wz, st) {
    var cur = A.getBlock(SB, cx, cz, wx, wy, wz);
    if (cur !== 0) return 0;
    return A.setBlock(SB, cx, cz, wx, wy, wz, st);
  }

  F.register('huge_brown_mushroom', mushroom('huge_brown_mushroom',
    function (SB, cx, cz, x, y, z, h, R, cap, stem, r) {
      var n = 0, cy = y + h;
      for (var dx = -R; dx <= R; dx++) {
        for (var dz = -R; dz <= R; dz++) {
          var ex = (dx === -R || dx === R), ez = (dz === -R || dz === R);
          if (ex && ez) continue;                    // the four corners are cut
          n += soft(SB, cx, cz, x + dx, cy, z + dz, cap(r, x + dx, cy, z + dz));
        }
      }
      return n;
    }));

  F.register('huge_red_mushroom', mushroom('huge_red_mushroom',
    function (SB, cx, cz, x, y, z, h, R, cap, stem, r) {
      var n = 0, inner = R - 2;
      for (var j = h - 3; j <= h; j++) {
        var k = j < h ? R : R - 1;                   // the lid is one narrower than the wall
        for (var dx = -k; dx <= k; dx++) {
          for (var dz = -k; dz <= k; dz++) {
            var ex = (dx === -k || dx === k), ez = (dz === -k || dz === k);
            if (j < h && ex === ez) continue;        // below the lid, only the ring wall
            if (ex && ez) continue;                  // never the corners
            if (j >= h && (dx === -inner || dx === inner) && (dz === -inner || dz === inner)) {
              continue;                              // and the lid leaves room for the stem
            }
            var cy = y + j;
            n += soft(SB, cx, cz, x + dx, cy, z + dz, cap(r, x + dx, cy, z + dz));
          }
        }
      }
      return n;
    }));
})(MCL);
