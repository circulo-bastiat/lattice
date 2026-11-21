// 04y_biome_dims.js — the Nether's and The End's biome sources. PLAN G27b.
// Runs on: main thread AND workers. No DOM.
//
// Two ports, both from .decomp/net/minecraft/world/biome/source/:
//
//   MultiNoiseBiomeSource.Preset.NETHER   five climate points; the biome is the point NEAREST
//                                         the query (first wins on a tie), by the same integer
//                                         squared distance the overworld table uses.
//   TheEndBiomeSource                     the_end inside the central island, otherwise the
//                                         island noise `getNoiseAt` picks one of four biomes.
//
// The Nether's SIX INPUTS are not computed here: 1.18.2's Nether noise router is the shared one
// (`DensityFunctions.method_41211`), i.e. the same temperature/vegetation/continentalness/
// erosion/weirdness fields as the overworld, so whoever samples them hands `netherBiome` the
// six floats. Vanilla quantises with `(long)(f * 10000)` (truncation), as Climate.quantise does.
(function (NS) {
  'use strict';

  var D = NS.BiomeDims = {};
  var fr = Math.fround;

  // ── Nether ──────────────────────────────────────────────────────────────────────────────
  // [temperature, humidity, continentalness, erosion, depth, weirdness, offset] per biome, in
  // the order the Preset lists them (order matters: ties go to the earlier entry).
  D.NETHER = [
    ['nether_wastes',     0.0,  0.0, 0, 0, 0, 0, 0.0],
    ['soul_sand_valley',  0.0, -0.5, 0, 0, 0, 0, 0.0],
    ['crimson_forest',    0.4,  0.0, 0, 0, 0, 0, 0.0],
    ['warped_forest',     0.0,  0.5, 0, 0, 0, 0, 0.375],
    ['basalt_deltas',    -0.5,  0.0, 0, 0, 0, 0, 0.175],
  ];
  var NQ = D.NETHER.map(function (r) {
    return r.slice(1).map(function (f) { return Math.trunc(fr(f) * 10000); });
  });

  /** netherBiome(t, h, c, e, d, w) -> registry name. Inputs are the six raw floats. */
  D.netherBiome = function (t, h, c, e, d, w) {
    var q = [t, h, c, e, d, w].map(function (f) { return Math.trunc(fr(f) * 10000); });
    var best = Infinity, name = null;
    for (var i = 0; i < NQ.length; i++) {
      var s = 0, p = NQ[i];
      for (var a = 0; a < 6; a++) { var df = q[a] - p[a]; s += df * df; }
      s += p[6] * p[6];
      if (s < best) { best = s; name = D.NETHER[i][0]; }
    }
    return name;
  };

  // ── The End ─────────────────────────────────────────────────────────────────────────────
  var ISLAND_RADIUS2 = 4096;
  var NEG09 = fr(-0.9);

  /** Java's `(float)` of an int/long, and MathHelper.sqrt(float). */
  function fsqrt(v) { return fr(Math.sqrt(v)); }
  function clampF(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /**
   * TheEndBiomeSource.getNoiseAt(noise, x, z). Java int `/` and `%` truncate toward zero, which
   * for the negative quart coordinates here is NOT floor/mod — `%` can be -1.
   */
  D.endNoiseAt = function (noise, x, z) {
    var cx = Math.trunc(x / 2), cz = Math.trunc(z / 2);
    var rx = x % 2, rz = z % 2;
    var v = fr(100 - fr(fsqrt(fr(x * x + z * z)) * 8));
    v = clampF(v, -100, 80);
    for (var dx = -12; dx <= 12; dx++) {
      for (var dz = -12; dz <= 12; dz++) {
        var ix = cx + dx, iz = cz + dz;
        if (ix * ix + iz * iz > ISLAND_RADIUS2 && noise.get(ix, iz) < NEG09) {
          var m = fr(fr(fr(Math.abs(ix) * 3439) + fr(Math.abs(iz) * 147)) % 13);
          var size = fr(m + 9);
          var fx = rx - dx * 2, fz = rz - dz * 2;
          var val = fr(100 - fr(fsqrt(fr(fr(fx * fx) + fr(fz * fz))) * size));
          val = clampF(val, -100, 80);
          if (val > v) v = val;
        }
      }
    }
    return v;
  };

  /**
   * End biome source for a world seed. `ChunkRandom(AtomicSimpleRandom(seed)).skip(17292)`
   * then a SimplexNoise: AtomicSimpleRandom is java.util.Random's LCG, skip is 17292 `nextInt()`.
   */
  D.endSource = function (seed) {
    var rnd = new NS.Noise.LegacyRandom(seed);
    rnd.consume(17292);
    var noise = new NS.Noise.Simplex(rnd);
    return {
      noise: noise,
      /** biome at BLOCK coordinates x, z (y is unused, as in vanilla). */
      biomeAt: function (x, y, z) {
        var qx = x >> 2, qz = z >> 2;
        if (qx * qx + qz * qz <= ISLAND_RADIUS2) return 'the_end';
        var n = D.endNoiseAt(noise, qx * 2 + 1, qz * 2 + 1);
        if (n > 40) return 'end_highlands';
        if (n >= 0) return 'end_midlands';
        return n < -20 ? 'small_end_islands' : 'end_barrens';
      },
    };
  };
})(MCL);
