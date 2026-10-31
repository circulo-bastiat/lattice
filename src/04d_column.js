// 04d_column.js — the column function. PLAN W3.
// Runs on: main thread AND workers. No DOM.
//
// `height(x, z)` and `climate(x, z)` — the two pure functions every later worldgen stage leans
// on. Surface rules (W6) ask for the height, biomes (W5) ask for the climate, features (W8) ask
// for both, and structures (W13+) ask for the height at four corners before they place anything.
//
// ── WHAT IS PORTED, AND WHAT IS CALIBRATED ───────────────────────────────────────────────
// PLAN W0's deviation #1 licenses replacing vanilla's 3D density stack with 2D fields through
// splines. This file takes that licence in exactly one place and ports everything else.
//
// PORTED, out of Mojang's own files, exactly:
//   * the five 2D climate fields and the `shift` that displaces their sample positions
//     (`density_function/overworld/{continents,erosion,ridges}.json`, `shift_x`, `shift_z`)
//   * `peaksAndValleys`, the derived `ridges` coordinate
//   * the cubic spline evaluator and all three spline trees, with their clamps
//     (`noise_settings/overworld.noise.terrain_shaper`)
//   * the jaggedness term: `jaggednessSpline * half_negative(jagged.get(x*1500, 0, z*1500))`,
//     coupling 1.0 — straight out of `sloped_cheese.json`, not a chosen number — with the noise
//     read only at 4-block cell corners and lerped, as vanilla's `interpolated` does (#328)
//
// ⚠ BEFORE YOU TOUCH `HEIGHT_CURVE`, READ D-172. The calibration below is doing TWO jobs and
// only one of them is deliberate. Vanilla's `TerrainShaper.offset` is `spline(p) - 0.50375`, and
// that subtraction lives in JAVA, not in the JSON — so this port, which reads the spline tree
// out of the data and stops, does not have it. That is a TRUE OMISSION, not part of deviation
// #1: with the constant restored, vanilla's own arithmetic from `density_function/overworld/
// depth.json` (`y = -64 + 384(1.5 + offset)/3`) lands on the real game's heights at every
// landform. The STRETCH is the deliberate half — it stands in for the vertical variance that
// dropping `base_3d_noise` removes — so adopting vanilla's map alone would put the means right
// and leave the world flatter than vanilla. How much stretch to keep is Dan's call and has a
// free parameter. `colcheck` §3c derives vanilla's map from the shipped file and PINS today's
// disagreement (≈37 blocks at the peaks, ≤3 at sea level) so it cannot drift unnoticed.
//
// CALIBRATED, and marked where it happens: the map from the offset spline's output to a block
// height. See the long note above `HEIGHT_CURVE`. The short version is that vanilla's realised
// surface depends on `base_3d_noise` — the expensive term deviation #1 exists to drop — and
// that term carries a large part of the vertical range rather than merely roughening the
// surface. Dropping it and keeping vanilla's arithmetic gives a world whose oceans sit at
// y≈100. So the shape comes entirely from vanilla's splines and the vertical scale is anchored
// on the heights the real game puts things at.
//
// The second thing that is MC-Lite's own is the terracing (D-59), and it is marked too.
//
// What deviation #1 costs, visibly: there are no overhangs and no floating islands, because
// those are what the 3D term makes. Caves come back separately in W7, where they are cheaper
// to make than to carve out of a 3D field anyway.
//
(function (NS) {
  'use strict';

  var C = NS.Column = {};

  C.ready = false;
  C.seed = 0;

  // ── the five 2D fields, and the shift that samples them ────────────────────────────────
  // Every one of `continents`, `erosion`, `ridges`, `temperature` and `vegetation` is the same
  // shape in `density_function/`: a `shifted_noise` at `xz_scale: 0.25` whose sample position
  // is displaced by a pair of `shift` functions built from the `offset` noise.
  //
  //     shiftX(x, z) = offset.get(x/4, 0, z/4) * 4
  //     shiftZ(x, z) = offset.get(z/4, x/4, 0) * 4        <- note the ARGUMENT ORDER
  //     field(x, z)  = noise.get(x/4 + shiftX, 0, z/4 + shiftZ)
  //
  // ⚠ `shift_b`'s arguments are (z, x, 0), not (x, z, 0). It is the same noise sampled along a
  // different slice, which is what makes the two displacements independent. Using (x, z, 0) for
  // both gives a world whose continents are all stretched along one diagonal.
  var XZ_SCALE = 0.25;
  var SHIFT_SCALE = 4;

  var noises = null;      // name -> NS.Noise.Normal
  var splines = null;     // {offset, factor, jaggedness} — the parsed spline trees
  var jaggedNoise = null;

  // ── #329: the world type (vanilla `GeneratorType`) ────────────────────────────────────
  // The create-world screen's World Type button offers DEFAULT, LARGE_BIOMES and AMPLIFIED
  // (superflat, single biome and debug are other generators, not other settings). They differ
  // only in which data this file reads:
  //   * AMPLIFIED     `noise_settings/amplified`. Its `terrain_shaper` is
  //                   `VanillaTerrainParameters.createSurfaceParameters(true)`: every constant
  //                   spline value already went through the builder's amplifier (offset
  //                   `v < 0 ? v : 2v`, factor `1.25 - 6.25/(v+5)`, jaggedness `2v`), so the
  //                   datapack JSON IS the amplified spline and nothing is recomputed here.
  //   * LARGE_BIOMES  `noise_settings/large_biomes` (same shaper as overworld) and
  //                   `DensityFunctions.method_41209(shape, true)`'s four swapped noises:
  //                   continents/erosion/temperature/vegetation read their `_large` twins.
  //                   Each is seeded by ITS OWN id (`minecraft:continentalness_large`), which
  //                   `fromParameters` does because the key passed is the real noise name.
  // ⚠ The world is still clamped to MC-Lite's top (D-19), so an amplified peak above y=255 is cut.
  C.WORLD_TYPES = ['default', 'large_biomes', 'amplified'];
  var SETTINGS = { 'default': 'overworld', large_biomes: 'large_biomes', amplified: 'amplified' };
  var LARGE = { continentalness: 'continentalness_large', erosion: 'erosion_large',
                temperature: 'temperature_large', vegetation: 'vegetation_large' };
  C.worldType = 'default';

  /**
   * init(seed, worldType) — build every noise this file needs and read the three splines out of
   * the world type's `noise_settings` (`overworld` unless told otherwise). Idempotent per
   * (seed, worldType).
   */
  C.init = function (seed, worldType) {
    var N = NS.Noise, WG = NS.WG;
    if (!N || !WG || !WG.ready) throw new Error('Column.init before the worldgen data decoded');
    worldType = worldType || 'default';
    if (!SETTINGS[worldType]) throw new Error('Column.init: unknown world type "' + worldType + '"');
    if (C.ready && C.seed === seed && C.worldType === worldType) return C;
    C.seed = seed;
    C.worldType = worldType;
    C.settingsName = SETTINGS[worldType];

    var need = ['offset', 'continentalness', 'erosion', 'ridge', 'temperature', 'vegetation', 'jagged'];
    C.noiseIds = Object.create(null);
    noises = Object.create(null);
    for (var i = 0; i < need.length; i++) {
      var id = (worldType === 'large_biomes' && LARGE[need[i]]) || need[i];
      var p = WG.get('noise', id);
      if (!p) throw new Error('worldgen/noise/' + id + ' is missing');
      noises[need[i]] = N.fromParameters(seed, id, p);
      C.noiseIds[need[i]] = id;
    }
    jaggedNoise = noises.jagged;
    jcOk.fill(0);

    var ow = WG.get('noise_settings', C.settingsName);
    if (!ow || !ow.noise || !ow.noise.terrain_shaper) throw new Error('noise_settings/' + C.settingsName + ' has no terrain_shaper');
    splines = {
      offset: ow.noise.terrain_shaper.offset,
      factor: ow.noise.terrain_shaper.factor,
      jaggedness: ow.noise.terrain_shaper.jaggedness,
    };
    C.seaLevel = ow.sea_level;
    C.minY = ow.noise.min_y;
    C.maxY = ow.noise.min_y + ow.noise.height;
    // ⚠ D-117. `minY`/`maxY` are what VANILLA'S NOISE SETTINGS declare: -64..320, 384 blocks. MC-Lite's
    // world is 20 sections, -64..255 (D-19), and those are not the same number. `height` must
    // clamp to the world that EXISTS, not to the one the data file describes — measured, on
    // 160,801 columns of seed 1337: two of them come out at y=256, one block above a world that
    // cannot hold them. Two in 160,000 is exactly the rate at which a bug reaches a player as
    // "one mountain had its top sliced off" and never reaches a test.
    C.worldTop = (NS.CFG && NS.CFG.CHUNK_H) ? (NS.CFG.WORLD_MIN_Y + NS.CFG.CHUNK_H) : C.maxY;
    C.ready = true;
    return C;
  };

  // ── the shift, and the five fields ─────────────────────────────────────────────────────
  function shiftX(x, z) { return noises.offset.get(x * XZ_SCALE, 0, z * XZ_SCALE) * SHIFT_SCALE; }
  function shiftZ(x, z) { return noises.offset.get(z * XZ_SCALE, x * XZ_SCALE, 0) * SHIFT_SCALE; }

  // ⚠ The shift is computed ONCE per column and reused for all five fields — `climateInto`
  // below does that. A `field(noise, x, z)` helper that recomputed it per field would sample the
  // offset noise ten times instead of two for the same answer, which on a 16x16 column is
  // 2,560 wasted noise evaluations a chunk.

  /**
   * peaksAndValleys(weirdness) — Mojang's `NoiseRouterData.peaksAndValleys`, the derived
   * coordinate the splines call `ridges`. It folds weirdness into a shape that peaks at the
   * extremes and at zero, which is what puts a river in the middle of a continent.
   */
  C.peaksAndValleys = function (w) {
    return -(Math.abs(Math.abs(w) - 0.6666667) - 0.33333334) * 3.0;
  };

  /**
   * climate(x, z) -> the six numbers every downstream stage asks for.
   *
   * ⚠ Allocates. Not for an inner loop — `Gen` samples it once per column and keeps the
   * result. `climateInto` writes into a caller's array for the paths that care.
   */
  var CLIM = ['continents', 'erosion', 'weirdness', 'ridges', 'temperature', 'humidity'];
  C.CLIMATE_KEYS = CLIM;

  C.climateInto = function (x, z, out) {
    var sx = shiftX(x, z), sz = shiftZ(x, z);
    var px = x * XZ_SCALE + sx, pz = z * XZ_SCALE + sz;
    var w = noises.ridge.get(px, 0, pz);
    out[0] = noises.continentalness.get(px, 0, pz);
    out[1] = noises.erosion.get(px, 0, pz);
    out[2] = w;
    out[3] = C.peaksAndValleys(w);
    out[4] = noises.temperature.get(px, 0, pz);
    out[5] = noises.vegetation.get(px, 0, pz);
    return out;
  };

  C.climate = function (x, z) {
    var a = C.climateInto(x, z, new Float64Array(6));
    return { continents: a[0], erosion: a[1], weirdness: a[2], ridges: a[3],
             temperature: a[4], humidity: a[5] };
  };

  // ── the spline evaluator ───────────────────────────────────────────────────────────────
  //
  // Mojang's `CubicSpline.Multipoint`. Each node has a `coordinate` naming which of the four
  // inputs it interpolates on, and a list of `points`, each with a `location`, a `value` (a
  // number OR a nested spline) and a `derivative`.
  //
  // Between two points it is a Hermite blend of the two values with the two derivatives;
  // OUTSIDE the ends it extrapolates linearly along the end derivative rather than clamping,
  // which matters because continentalness legitimately reaches past the last spline point in
  // deep ocean.
  //
  // ⚠ A nested spline is evaluated at the FULL coordinate set, not at the parent's coordinate.
  // That is why `apply` takes the whole vector: an `erosion` spline nested inside a
  // `continents` spline is asked about erosion, and its own children about ridges.
  var COORD = { continents: 0, erosion: 1, weirdness: 2, ridges: 3 };

  function splineAt(node, c) {
    if (typeof node === 'number') return node;
    var idx = COORD[node.coordinate];
    if (idx === undefined) throw new Error('unknown spline coordinate ' + node.coordinate);
    var v = c[idx];
    var pts = node.points, n = pts.length;
    if (n === 0) return 0;

    // find the last point whose location is <= v
    var i = -1, lo = 0, hi = n;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (pts[mid].location <= v) { i = mid; lo = mid + 1; } else hi = mid; }

    if (i < 0) {
      // before the first point: extrapolate along its derivative
      return splineAt(pts[0].value, c) + pts[0].derivative * (v - pts[0].location);
    }
    if (i === n - 1) {
      return splineAt(pts[n - 1].value, c) + pts[n - 1].derivative * (v - pts[n - 1].location);
    }
    var p0 = pts[i], p1 = pts[i + 1];
    var span = p1.location - p0.location;
    var f = (v - p0.location) / span;
    var v0 = splineAt(p0.value, c), v1 = splineAt(p1.value, c);
    var g = p0.derivative * span - (v1 - v0);
    var h = -p1.derivative * span + (v1 - v0);
    return v0 + f * (v1 - v0) + f * (1 - f) * (g + f * (h - g));
  }
  C.splineAt = splineAt;

  // The clamps come from the `terrain_shaper_spline` nodes in `density_function/overworld/`:
  // offset is min_value -0.81 / max_value 2.5, factor 0 / 8, jaggedness 0 / 1.28.
  var OFFSET_MIN = -0.81, OFFSET_MAX = 2.5;
  var FACTOR_MIN = 0, FACTOR_MAX = 8;
  var JAG_MIN = 0, JAG_MAX = 1.28;
  var clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };

  C.offsetAt = function (c) { return clamp(splineAt(splines.offset, c), OFFSET_MIN, OFFSET_MAX); };
  C.factorAt = function (c) { return clamp(splineAt(splines.factor, c), FACTOR_MIN, FACTOR_MAX); };
  C.jaggednessAt = function (c) { return clamp(splineAt(splines.jaggedness, c), JAG_MIN, JAG_MAX); };

  // ── height ─────────────────────────────────────────────────────────────────────────────
  //
  // ⚠ READ THIS BEFORE CHANGING THE NUMBERS. It is the one place in Track W where MC-Lite
  // calibrates rather than ports, and the reason is worth stating exactly.
  //
  // WHAT IS PORTED. `density_function/overworld/sloped_cheese.json` is, with the two old-world
  // blending terms removed (identity in a fresh world):
  //
  //     slopedCheese = 4 * quarter_negative((depth + jaggedness * halfNegative(jaggedNoise))
  //                                          * factor)
  //                    + base_3d_noise
  //     depth        = y_clamped_gradient(-64 -> 1.5, 320 -> -1.5) + offsetSpline
  //
  // The splines, their clamps, the jaggedness coupling (1.0, in depth units), the
  // `half_negative` on the jagged noise and its 1500x sample scale are all read out of those
  // files and are exact. So is `peaksAndValleys`.
  //
  // WHAT IS NOT. The surface is where `slopedCheese` crosses zero, and that depends on
  // `base_3d_noise` — the expensive 3D term PLAN W0's deviation #1 exists to drop. Without it
  // the crossing is exactly where `depth` crosses zero, which solves in closed form to
  // `y = 128 + 128 * offset`; the algebra is right and the result is a world whose oceans sit
  // at y≈100. That is not a bug in the algebra, it is what removing the 3D term does: in
  // vanilla the term does not merely roughen the surface, it carries a large part of the
  // vertical range, scaled per-column by `factor` (high factor holds plains flat, low factor
  // lets mountains swing tens of blocks).
  //
  // Reproducing that would mean reinstating the 3D field, which is the whole cost deviation #1
  // was granted to avoid. So the offset-to-height mapping below is **MC-Lite's own**, anchored
  // on the heights the real game actually puts things at, with vanilla's splines supplying the
  // entire SHAPE — where the oceans are, where the coasts are, which continents are mountainous
  // and which are flat, where the rivers cut.
  //
  // The anchors, and where each comes from:
  //
  //   offset -0.222  ->  y  40   the offset spline's own deep-ocean plateau; vanilla's deep
  //                              ocean floor sits around y 40
  //   offset -0.120  ->  y  50   its shallow-ocean plateau; vanilla's ocean shelf
  //   offset  0.000  ->  y  63.52  sea level, and it is ARITHMETIC, not a fit (D-225):
  //                              vanilla's `depth` crosses zero at y = 128 + 128 * offset and
  //                              its `TerrainShaper.offset` subtracts 0.50375 in Java, so
  //                              128 + 128 * (0 - 0.50375) = 63.52. This anchor used to read
  //                              66 — "three blocks above sea level" — and those three blocks
  //                              were the whole of the swamp bug.
  //   offset  0.200  ->  y  96   hills
  //   offset  0.500  ->  y 160   mountains
  //   offset  1.000  ->  y 230   high peaks
  //   offset  2.500  ->  y 310   the spline's own clamp, just under the world top
  //
  // ⚠ IF A FUTURE SESSION RECOVERS VANILLA'S REAL MAPPING — by measuring surface heights in
  // the game against sampled climate values — this table is the ONE function to replace, and
  // nothing else in this file changes.
  // ⚠ THE SEA-LEVEL ANCHOR IS VANILLA'S OWN ARITHMETIC AND THE REST IS THE STRETCH (D-225).
  // D-172 named the missing `- 0.50375` a TRUE OMISSION rather than part of deviation #1, and
  // at offset 0 that omission was worth +2.5 blocks: MC-Lite put sea-level land at y 66 where
  // the real game puts it at 63.52. Nothing notices a plain three blocks too high — but the
  // swamp does, because vanilla's ONLY swamp surface clause fires at exactly y == 62 and needs
  // the terrain top to BE that block. Against the 13,307-chunk golden world the swamp went
  // from 73.3% surface agreement to 95.3% and the median height residual from +1 to 0.
  // The anchors above 0.2 are the deliberate STRETCH and are untouched; `colcheck` §3c still
  // pins the peaks at ~37 blocks taller than vanilla's arithmetic, which is Dan's call to make.
  //
  // ⚠⚠ DO NOT MOVE THE SEA-LEVEL ANCHOR AGAIN TO CHASE THE COASTLINE (D-230). D-225 cost five
  // shoreline biomes a few points each — desert 97.1 -> 94.4, jungle 95.2 -> 91.2, plains
  // 93.9 -> 90.5, river 90.2 -> 88.4, forest 95.2 -> 94.7 — and the obvious next move is to
  // split the difference until they come back. It was measured against BOTH golden worlds and
  // it is wrong. Conditioning on the offset spline value — the INPUT the two engines share —
  // rather than on either engine's height:
  //
  //     seed 1337   vanilla mean 65.56 sd 4.62      MC-Lite mean 64.16 sd 2.22
  //     seed 4242   vanilla mean 65.19 sd 4.68      MC-Lite mean 63.98 sd 2.65
  //
  // MC-Lite's sea-level surface is not DISPLACED from vanilla's, it is UNDER-DISPERSED: it
  // carries 48% and 57% of vanilla's vertical spread, the two distributions' p05 and p25 agree,
  // and what is missing is the upper half. The mean gap of -1.2 to -1.4 blocks IS that missing
  // half, not an offset, so a constant that removes it lifts the low end that is already right:
  // +1 block puts the golden world's own swamp at 36.7% water where the real game is 62% and
  // drops `surfcheck` §3b(e)'s at-or-below-sea fraction from 86.9% to 68.2%, under its floor of
  // 70. The cause is deviation #1 — `base_3d_noise` is the term that carries the variance —
  // and D-172's stretch restores it above offset 0.2 where there are anchors to stretch
  // between. `vanillacheck` §2b pins both halves; §8 names the deviation.
  var HEIGHT_CURVE = [
    [-0.81, 30], [-0.222, 40], [-0.12, 50], [0.0, 63.52],
    [0.2, 96], [0.5, 160], [1.0, 230], [2.5, 310],
  ];

  function offsetToY(o) {
    var c = HEIGHT_CURVE, n = c.length;
    if (o <= c[0][0]) return c[0][1];
    if (o >= c[n - 1][0]) return c[n - 1][1];
    for (var i = 1; i < n; i++) {
      if (o <= c[i][0]) {
        var t = (o - c[i - 1][0]) / (c[i][0] - c[i - 1][0]);
        return c[i - 1][1] + t * (c[i][1] - c[i - 1][1]);
      }
    }
    return c[n - 1][1];
  }
  C.offsetToY = offsetToY;
  C.HEIGHT_CURVE = HEIGHT_CURVE;

  // The jagged noise's sample scale and the half-negative fold, both straight out of
  // `sloped_cheese.json`. The 1500x is far past the noise's own highest frequency, so
  // neighbouring CELL CORNERS are effectively uncorrelated and jagged peaks read as broken rock.
  //
  // ⚠ CORNERS, NOT BLOCKS (#328). Vanilla wraps the whole of `sloped_cheese` in `interpolated`
  // (DensityFunctions.method_41207), and `ChunkNoiseSampler` evaluates an interpolated function
  // only at the corners of a `horizontalBlockSize()` = 4-block cell and lerps every block inside
  // it. So `jagged` is only ever read at x, z that are multiples of 4, and the octaves finer than
  // the cell are aliased away. Sampling at every block kept them: jagged peaks came out ~30%
  // rougher than vanilla's (mean |Δh| 1.07 vs 0.81 between neighbours). `jaggedTerm` samples
  // `halfNegative(jagged)` at the four enclosing corners and lerps bilinearly; the jaggedness
  // spline stays per block (it comes from the climate, which this file samples per block).
  var JAGGED_SAMPLE = 1500;
  var JAGGED_CELL = 4;
  function halfNegative(v) { return v > 0 ? v : v * 0.5; }
  C.halfNegative = halfNegative;
  C.JAGGED_CELL = JAGGED_CELL;

  // `halfNegative(jagged)` at a cell corner, by CELL index. A direct-mapped cache in front of the
  // noise: a 4x4 cell asks for the same four corners sixteen times, so this is what makes the
  // corner scheme 16x fewer noise evaluations rather than 4x more. The cache only ever holds the
  // value the noise would give, so `height` stays pure; `init` empties it (a new seed).
  var JC_SIZE = 4096, JC_MASK = JC_SIZE - 1;
  var jcX = new Int32Array(JC_SIZE), jcZ = new Int32Array(JC_SIZE);
  var jcV = new Float64Array(JC_SIZE), jcOk = new Uint8Array(JC_SIZE);
  function jaggedCorner(cx, cz) {
    var k = (Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663)) & JC_MASK;
    if (jcOk[k] && jcX[k] === cx && jcZ[k] === cz) return jcV[k];
    var v = halfNegative(jaggedNoise.get(cx * JAGGED_CELL * JAGGED_SAMPLE, 0, cz * JAGGED_CELL * JAGGED_SAMPLE));
    jcX[k] = cx; jcZ[k] = cz; jcV[k] = v; jcOk[k] = 1;
    return v;
  }
  C.jaggedCorner = jaggedCorner;

  /** jaggedTerm(x, z) -> `halfNegative(jagged)` as vanilla's cell interpolation sees it at (x, z). */
  function jaggedTerm(x, z) {
    var cx = Math.floor(x / JAGGED_CELL), cz = Math.floor(z / JAGGED_CELL);
    var tx = (x - cx * JAGGED_CELL) / JAGGED_CELL, tz = (z - cz * JAGGED_CELL) / JAGGED_CELL;
    var v00 = jaggedCorner(cx, cz);
    if (tx === 0 && tz === 0) return v00;
    var v10 = jaggedCorner(cx + 1, cz), v01 = jaggedCorner(cx, cz + 1), v11 = jaggedCorner(cx + 1, cz + 1);
    var a = v00 + tx * (v10 - v00), b = v01 + tx * (v11 - v01);
    return a + tz * (b - a);
  }
  C.jaggedTerm = jaggedTerm;

  // TERRACING (D-59) — "what produces plateaus and hard cliff faces without a density stack",
  // and the second thing in this file that is MC-Lite's rather than Mojang's. Heights are
  // pulled toward multiples of a step by an amount that rises as EROSION falls: heavily eroded
  // land stays smooth, uneroded land goes blocky. The blend is a smoothstep, so a terrace edge
  // is a cliff and not a staircase of single blocks.
  var TERRACE_STEP = 8;
  var TERRACE_MAX = 0.75;          // strongest pull, at erosion = -1

  // ⚠ THE CURVE STARTS BELOW ZERO, AND THAT IS THE WHOLE POINT (D-161). It used to be
  // `t = (1 - erosion) / 2`, which is 0.5 at erosion 0 — and erosion is a Gaussian centred on
  // zero, so HALF THE WORLD got strength 0.375 and a terrace jump of exactly `8 * 0.375 = 3`.
  // Measured: **95% of columns had a jump of 3**, so every terrace boundary in the world was the
  // same 3-block ledge at the same 8-block spacing — a corduroy landscape, which is what Dan
  // reported as "3 block walls that don't look vanilla". The step histogram showed it as a spike
  // that broke an otherwise monotone decay: 0.64% of column pairs step 2, then 1.61% step 3.
  // The plan asked for blocky UNERODED land and smooth eroded land; ordinary land is neither, so
  // it now gets no terracing at all and the pull ramps in below erosion -0.25.
  var TERRACE_ONSET = -0.25;       // no terracing at all at or above this erosion
  var TERRACE_FULL = -0.80;        // full strength at or below it

  C.terraceStrength = function (erosion) {
    // erosion runs about -1 (mountainous, uneroded) to +1 (flat, heavily eroded)
    var t = (TERRACE_ONSET - erosion) / (TERRACE_ONSET - TERRACE_FULL);
    if (t < 0) t = 0; else if (t > 1) t = 1;
    return TERRACE_MAX * t * t * (3 - 2 * t);
  };

  function terrace(y, erosion) {
    var s = C.terraceStrength(erosion);
    if (s <= 0) return y;
    var q = Math.round(y / TERRACE_STEP) * TERRACE_STEP;
    return y + (q - y) * s;
  }
  C.terrace = terrace;

  /**
   * heightFromClimate(c, x, z) -> the surface height as a REAL number, before rounding.
   * Split out from `height` so tests can ask about it without going through the noise.
   */
  C.heightFromClimate = function (c, x, z) {
    var offset = C.offsetAt(c);
    var jag = C.jaggednessAt(c);
    if (jag > 0) {
      offset += jag * jaggedTerm(x, z);
    }
    return terrace(offsetToY(offset), c[1]);
  };

  var scratch = new Float64Array(6);

  /**
   * height(x, z) -> integer surface height, clamped into the world.
   *
   * ⚠ PURE. The same (x, z) gives the same answer in any order, on any thread, forever — which
   * is the invariant PLAN W0 says survives deviation #1 and gets STRONGER, and the one §7's
   * structure placement is going to lean on hard. `colcheck` samples in three different orders
   * and requires bit-identical results.
   */
  C.height = function (x, z) {
    C.climateInto(x, z, scratch);
    var y = Math.floor(C.heightFromClimate(scratch, x, z));
    return y < C.minY ? C.minY : (y >= C.worldTop ? C.worldTop - 1 : y);
  };

  /** Both at once, for callers that want the climate anyway. `out` takes the six climate values. */
  C.heightAndClimate = function (x, z, out) {
    C.climateInto(x, z, out);
    var y = Math.floor(C.heightFromClimate(out, x, z));
    return y < C.minY ? C.minY : (y >= C.worldTop ? C.worldTop - 1 : y);
  };
})(MCL);
