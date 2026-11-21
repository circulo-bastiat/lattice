// 04b_caves.js — the NOISE caves: cheese and worms (docs/archive/ARCH.md §6b, D-32, D-64..D-67).
// Runs on: main thread AND workers. No DOM.
//
// WHY THIS IS A SEPARATE FILE
// Cave carving is the only part of generation that is genuinely 3D, so it is the only part with
// a per-VOXEL cost. Keeping it here means the expensive thing is in one file that can be tuned,
// budgeted and switched off (params.caves) without touching terrain shaping.
//
// HOW IT STAYS CHEAP (D-64)
// The three noise fields are evaluated on a 4x4x4 LATTICE and trilinearly interpolated, exactly
// as vanilla interpolates its density function. That is 64x fewer noise3 calls for a result that
// is visually identical — smooth cave walls are what you want anyway. A 16x16x~150 carve region
// costs ~1200 lattice samples instead of ~77000 point samples.
//
// THE THREE SYSTEMS (D-32)
//   cheese     one low-frequency field, carved where |n| < threshold -> big open rooms
//   worms      TWO fields, carved where n1^2 + n2^2 < r^2 -> the intersection of two surfaces is
//              a LINE, so this produces long connected winding tubes, not blobs. This is what
//              makes the cave network walkable and connected instead of a field of bubbles.
//
// ⚠ RAVINES USED TO BE HERE and are not any more (PLAN W7, D-126). Session 1 cut them as a 2D
// corridor along the zero-contour of a slow noise — a decent fake, and completely superseded by
// `04i_carvers.js`'s CANYON carver, which is vanilla's own ravine driven by vanilla's own
// configured-carver JSON. Two systems making ravines would have made twice as many.

(function (NS) {
  'use strict';

  var CFG = NS.CFG;
  var MINY = CFG.WORLD_MIN_Y;
  var H = CFG.CHUNK_H;

  var C = NS.Caves = { G: null, inited: false };

  // Frequencies (blocks) and lattice offsets. Y is deliberately compressed on the worm fields:
  // squashing Y makes tunnels run more horizontally, which is the difference between a cave you
  // can walk through and a cave you fall down.
  var F_CHEESE_XZ = 1 / 110, F_CHEESE_Y = 1 / 60;
  var F_WORM_XZ   = 1 / 56,  F_WORM_Y   = 1 / 34;
  var O_CHEESE = 900.5, O_W1 = -6100.5, O_W2 = 24500.5;

  var F_AQ = 1 / 520, O_AQ = 12345.5;

  // 4x4x4 lattice over a 16x16 chunk footprint: 5 x 5 in XZ, (NY+1) in Y.
  var LX = 5, LZ = 5, CELL = 4;
  var MAXLY = 96;                                  // covers 4*95 = 380 blocks of Y, more than H
  var f0 = null, f1 = null, f2 = null;             // cheese, worm A, worm B
  var cellFlag = null;                             // per 4x4x4 cell: 1 = cheese possible, 2 = worm
  var lyCount = 0, lyBase = 0;

  C.init = function (G) {
    C.G = G;
    if (!f0) {
      var n = LX * LZ * MAXLY;
      f0 = new Float32Array(n); f1 = new Float32Array(n); f2 = new Float32Array(n);
      cellFlag = new Uint8Array(4 * 4 * MAXLY);
    }
    C.inited = true;
    return C;
  };

  function LI(ix, iy, iz) { return (iy * LZ + iz) * LX + ix; }

  // ── ⚠ THE FLOOR TAPER IS VANILLA'S `bottom_slide`, NOT A HAND-PICKED FADE (D-231) ─────────
  //
  // `noise_settings/overworld.json` says, in `noise`:
  //
  //     "min_y": -64, "height": 384, "size_vertical": 2,
  //     "bottom_slide": { "target": 0.1171875, "size": 3, "offset": 0 }
  //
  // A slide `size` is counted in NOISE CELLS, and a cell is `size_vertical * 4` = 8 blocks tall.
  // So vanilla lerps its density toward SOLID over the lowest THREE cells — twenty-four blocks,
  // y = -64 up to y = -40 — and a cave is progressively less able to exist the closer it gets to
  // the floor. Session 1 wrote that taper by eye instead: the cheese field ran at full strength
  // down to y=-50 and then died over twelve blocks, the worms down to y=-52 and then ten. Both
  // windows are ENTIRELY BELOW vanilla's, so MC-Lite carved at full strength through exactly the
  // depth vanilla was already shutting down.
  //
  // ⚠ MEASURED, against 480 chunks of each golden world (`vanillacheck` §5's per-y table): void
  // per chunk per layer, MC-Lite over vanilla, at seed 1337 / seed 4242 —
  //
  //     y -59..-56   1.88x / 3.60x        y -47..-44   1.38x / 1.87x
  //     y -55..-52   1.73x / 3.02x        y -43..-40   1.04x / 1.26x
  //     y -51..-48   1.54x / 2.02x        y -39..-36   1.09x / 1.28x
  //
  // — the excess grows the deeper it goes and disappears at the top of vanilla's slide window,
  // which is the signature of a missing slide and not of a field that is too strong everywhere.
  //
  // ⚠ IT SCALES THE CARVED FRACTION, NOT THE RADIUS. Vanilla's slide is a linear lerp of the
  // DENSITY, so the fraction of cells it hollows falls off roughly linearly with it. The cheese
  // threshold is a band around zero and its volume is linear in the threshold, so the factor goes
  // straight on `t`; a worm's cross-section is a disc and its volume is linear in r SQUARED, so
  // the factor goes on `r2` and not on `r` — putting it on the radius would taper the worms
  // quadratically and empty the last twenty blocks of the world.
  var SLIDE_SIZE = 24;                             // 3 cells x size_vertical 2 x 4 blocks
  function bottomSlide(wy) {
    if (wy >= MINY + SLIDE_SIZE) return 1;
    var t = (wy - MINY) / SLIDE_SIZE;
    return t > 0 ? t : 0;
  }
  C.bottomSlide = bottomSlide;

  /**
   * Cave density threshold by depth. Caves thin out toward the surface (so hillsides are not
   * swiss cheese) and toward bedrock (so the deep dark is a floor, not a void).
   */
  function cheeseThr(wy) {
    if (wy > 100) return 0;
    var t = 0.021;
    if (wy > 40) t *= (100 - wy) / 60;             // fade out above y=40
    if (wy < MINY + SLIDE_SIZE) t *= bottomSlide(wy);
    return t < 0 ? 0 : t;
  }

  function wormR2(wy) {
    if (wy > 120) return 0;
    var r = 0.056;
    if (wy > 60) r *= (120 - wy) / 60;
    if (r < 0) r = 0;
    var r2 = r * r;
    if (wy < MINY + SLIDE_SIZE) r2 *= bottomSlide(wy);
    return r2;
  }

  /**
   * carveChunk(SB, cx, cz, cH, sea) — carve the scratch column in place.
   * Only stone/deepslate are removed: this runs before the surface pass, so anything else in
   * the column is water, and draining the ocean through a cave roof is the classic bug (D-66).
   */
  C.carveChunk = function (SB, cx, cz, cH, sea) {
    var G = C.G, U = NS.U, p = G.perm, ID = G.ids, P = G.params;
    var ox = cx << 4, oz = cz << 4;
    var STONE = ID.stone, DEEP = ID.deepslate, LAVA = ID.lava, WATER = ID.water;
    var lavaL = P.lavaLevel;
    var x, z, y, i;

    // --- carve region in local Y -------------------------------------------
    var maxH = MINY;
    for (i = 0; i < 256; i++) if (cH[i] > maxH) maxH = cH[i];
    var yTopW = maxH + 2; if (yTopW > 160) yTopW = 160;
    var yBotW = MINY + 4;
    if (yTopW <= yBotW) return;

    lyBase = yBotW;
    lyCount = Math.ceil((yTopW - yBotW) / CELL) + 1;
    if (lyCount > MAXLY) lyCount = MAXLY;

    // --- 1. sample the three fields on the lattice --------------------------
    for (var iy = 0; iy < lyCount; iy++) {
      var wy = lyBase + iy * CELL;
      for (var iz = 0; iz < LZ; iz++) {
        var wz = oz + iz * CELL;
        for (var ix = 0; ix < LX; ix++) {
          var wx = ox + ix * CELL;
          var k = LI(ix, iy, iz);
          f0[k] = U.noise3(p, wx * F_CHEESE_XZ + O_CHEESE, wy * F_CHEESE_Y + O_CHEESE, wz * F_CHEESE_XZ + O_CHEESE);
          f1[k] = U.noise3(p, wx * F_WORM_XZ + O_W1, wy * F_WORM_Y + O_W1, wz * F_WORM_XZ + O_W1);
          f2[k] = U.noise3(p, wx * F_WORM_XZ + O_W2, wy * F_WORM_Y + O_W2, wz * F_WORM_XZ + O_W2);
        }
      }
    }

    // --- 1b. per-cell early-out (D-65) ---------------------------------------
    // Inside one 4x4x4 cell the trilinear value is bounded by its eight corners. If all eight
    // corners of a field share a sign, the interpolated |value| never drops below the smallest
    // |corner|, so a cell whose corners are all far from the threshold cannot contain a cave.
    // That skips ~90% of the volume before a single interpolation is done.
    for (iy = 0; iy < lyCount - 1; iy++) {
      var yA = lyBase + iy * CELL, yB = yA + CELL;
      var thrMax = Math.max(cheeseThr(yA), cheeseThr(yB));
      var r2Max = Math.max(wormR2(yA), wormR2(yB));
      for (iz = 0; iz < 4; iz++) {
        for (ix = 0; ix < 4; ix++) {
          var flags = 0;
          if (thrMax > 0 && !cellFarFrom(f0, ix, iy, iz, thrMax)) flags |= 1;
          if (r2Max > 0) {
            var rr = Math.sqrt(r2Max);
            if (!cellFarFrom(f1, ix, iy, iz, rr) && !cellFarFrom(f2, ix, iy, iz, rr)) flags |= 2;
          }
          cellFlag[(iy * 4 + iz) * 4 + ix] = flags;
        }
      }
    }

    // --- 2. trilinear sweep --------------------------------------------------
    for (z = 0; z < 16; z++) {
      var iz0 = z >> 2, tz = (z & 3) * 0.25;
      for (x = 0; x < 16; x++) {
        var ix0 = x >> 2, tx = (x & 3) * 0.25;
        i = (z << 4) | x;
        var colH = cH[i];
        var underwater = colH < sea;
        // Never carve within a few blocks of the surface of an underwater column, or the
        // ocean pours into the cave system (D-66).
        var yCeil = underwater ? Math.min(colH - 6, sea - 6) : colH - 1;
        var aq = aquiferLevel(ox + x, oz + z);

        var yTopLocalW = Math.min(yTopW, yCeil);
        for (var wy2 = yBotW; wy2 <= yTopLocalW; wy2++) {
          y = wy2 - MINY;
          if (y < 1 || y >= H) continue;
          var si = (y << 8) | (z << 4) | x;
          var id = SB[si];
          if (id !== STONE && id !== DEEP) continue;

          var fy = (wy2 - lyBase) / CELL;
          var iy0 = fy | 0;
          if (iy0 >= lyCount - 1) iy0 = lyCount - 2;
          var flg = cellFlag[(iy0 * 4 + iz0) * 4 + ix0];
          if (!flg) continue;
          var ty = fy - iy0;

          var carve = false;
          if (flg & 1) {
            var thr = cheeseThr(wy2);
            if (thr > 0) {
              var c = tri(f0, ix0, iy0, iz0, tx, ty, tz);
              if (c > -thr && c < thr) carve = true;
            }
          }
          if (!carve && (flg & 2)) {
            var r2 = wormR2(wy2);
            if (r2 > 0) {
              var a = tri(f1, ix0, iy0, iz0, tx, ty, tz);
              var b = tri(f2, ix0, iy0, iz0, tx, ty, tz);
              if (a * a + b * b < r2) carve = true;
            }
          }
          if (!carve) continue;

          if (wy2 <= lavaL) SB[si] = LAVA;
          else if (aq > -900 && wy2 <= aq) SB[si] = WATER;
          else SB[si] = 0;
        }
      }
    }

  };

  /**
   * True when every corner of this cell has the same sign AND is further than `t` from zero —
   * in which case the interpolated field cannot reach the +/-t band anywhere inside the cell.
   */
  function cellFarFrom(f, ix, iy, iz, t) {
    var i000 = LI(ix, iy, iz), i010 = LI(ix, iy + 1, iz);
    var i001 = LI(ix, iy, iz + 1), i011 = LI(ix, iy + 1, iz + 1);
    var mn = 1e9, pos = 0, neg = 0, v;
    v = f[i000];     if (v > 0) pos = 1; else neg = 1; if (v < 0) v = -v; if (v < mn) mn = v;
    v = f[i000 + 1]; if (v > 0) pos = 1; else neg = 1; if (v < 0) v = -v; if (v < mn) mn = v;
    v = f[i010];     if (v > 0) pos = 1; else neg = 1; if (v < 0) v = -v; if (v < mn) mn = v;
    v = f[i010 + 1]; if (v > 0) pos = 1; else neg = 1; if (v < 0) v = -v; if (v < mn) mn = v;
    v = f[i001];     if (v > 0) pos = 1; else neg = 1; if (v < 0) v = -v; if (v < mn) mn = v;
    v = f[i001 + 1]; if (v > 0) pos = 1; else neg = 1; if (v < 0) v = -v; if (v < mn) mn = v;
    v = f[i011];     if (v > 0) pos = 1; else neg = 1; if (v < 0) v = -v; if (v < mn) mn = v;
    v = f[i011 + 1]; if (v > 0) pos = 1; else neg = 1; if (v < 0) v = -v; if (v < mn) mn = v;
    return (pos ^ neg) === 1 && mn > t;
  }

  /** Trilinear interpolation of one lattice field. */
  function tri(f, ix, iy, iz, tx, ty, tz) {
    var i000 = LI(ix, iy, iz), i100 = i000 + 1;
    var i010 = LI(ix, iy + 1, iz), i110 = i010 + 1;
    var i001 = LI(ix, iy, iz + 1), i101 = i001 + 1;
    var i011 = LI(ix, iy + 1, iz + 1), i111 = i011 + 1;
    var a = f[i000] + (f[i100] - f[i000]) * tx;
    var b = f[i001] + (f[i101] - f[i001]) * tx;
    var c = f[i010] + (f[i110] - f[i010]) * tx;
    var d = f[i011] + (f[i111] - f[i011]) * tx;
    var e = a + (b - a) * tz;
    var g = c + (d - c) * tz;
    return e + (g - e) * ty;
  }

  /**
   * Fake aquifer (D-67). One 2D noise decides whether this region has a water table and where
   * it sits; carved cells below it are filled with still water instead of air. No flow, no
   * simulation, no extra 3D field — the cost is a single noise2 per column, which is why this
   * shipped instead of staying deferred.
   * Returns the world Y of the water table, or -1000 for "no aquifer here".
   */
  function aquiferLevel(wx, wz) {
    var G = C.G;
    if (!G.params.aquifers) return -1000;
    var n = NS.U.noise2(G.perm, wx * F_AQ + O_AQ, wz * F_AQ + O_AQ);
    if (n < 0.12) return -1000;
    // level between about y = -12 and y = -46, deeper where the noise is stronger
    return -12 - ((n - 0.12) * 1.6) * 34;
  }
  C.aquiferLevel = aquiferLevel;

  /**
   * Point query, un-interpolated. Only for tools and debug overlays — the chunk path uses the
   * lattice above and must stay the authority on what the world actually looks like.
   */
  C.carve = function (wx, wy, wz) {
    var G = C.G, U = NS.U, p = G.perm;
    var thr = cheeseThr(wy);
    if (thr > 0) {
      var c = U.noise3(p, wx * F_CHEESE_XZ + O_CHEESE, wy * F_CHEESE_Y + O_CHEESE, wz * F_CHEESE_XZ + O_CHEESE);
      if (c > -thr && c < thr) return 1;
    }
    var r2 = wormR2(wy);
    if (r2 > 0) {
      var a = U.noise3(p, wx * F_WORM_XZ + O_W1, wy * F_WORM_Y + O_W1, wz * F_WORM_XZ + O_W1);
      var b = U.noise3(p, wx * F_WORM_XZ + O_W2, wy * F_WORM_Y + O_W2, wz * F_WORM_XZ + O_W2);
      if (a * a + b * b < r2) return 1;
    }
    return 0;
  };
})(MCL);
