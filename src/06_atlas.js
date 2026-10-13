// 06_atlas.js — procedural texture atlas (D-14). Main thread only (uses canvas).
// No image files, no data: URIs: every texture is generated from seeded noise at boot and is
// byte-for-byte identical on every boot for a given seed.
//
// TWO THINGS THE REST OF THE RENDERER DEPENDS ON
//
// 1. The GPU consumes A.mips, NOT A.canvas. Tiles are uploaded as a 2D TEXTURE ARRAY, one tile
//    per layer, with a CPU-generated mip chain (D-50). That is what makes greedy uRep/vRep
//    repetition exact (wrap mode REPEAT per layer) and makes atlas bleed between neighbouring
//    tiles structurally impossible instead of merely unlikely. A.canvas is kept for the debug
//    overlay and because ARCH §9 hands it to Backend.init.
//
// 2. The ALPHA channel is overloaded, per layer (D-51):
//      opaque layer      alpha = TINT MASK   (0 = keep texel colour, 1 = multiply by block tint)
//      cutout layer      alpha = COVERAGE    (< 0.5 is discarded; visible texels are tinted)
//      translucent layer alpha = OPACITY     (tint is applied at full strength)
//    This is how grass_side gets a green top strip over untinted dirt without a second texture
//    or a per-face tint field.
//
// Tile row 0 is v = 0, and v = 0 is the TOP edge of a face (docs/archive/ARCH.md §8, corner table).

(function (NS) {
  'use strict';

  var TILE = 16, COLS = 16;

  var A = NS.Atlas = {
    TILE: TILE,
    COLS: COLS,
    canvas: null,
    tiles: 0,            // layers actually used
    mips: null,          // [{size, data:Uint8Array(layers*size*size*4)}], level 0 first
    levels: 0,
    seed: 0,
    names: Object.create(null)   // tileName -> layer index
  };

  A.size = function () { return TILE * COLS; };

  // ---------------------------------------------------------------------------
  // Tile index table. The vertex format carries 12 bits of tile index, but a 2D texture
  // array is only guaranteed 256 layers, so the atlas stays at 16x16 tiles = 256 layers.
  // Index 0 is the magenta "missing texture" so a mistake is loud, not invisible.
  // ---------------------------------------------------------------------------
  var T = A.T = {
    MISSING: 0,
    STONE: 1, DIRT: 2, GRASS_TOP: 3, GRASS_SIDE: 4, SAND: 5, GRAVEL: 6,
    COBBLESTONE: 7, BEDROCK: 8, DEEPSLATE: 9,
    OAK_LOG_SIDE: 10, OAK_LOG_TOP: 11, OAK_PLANKS: 12, OAK_LEAVES: 13,
    WATER: 14, SNOW: 15, SCULK: 16, GLOWSTONE: 17, SHORT_GRASS: 18,
    COAL_ORE: 19, IRON_ORE: 20, COPPER_ORE: 21, GOLD_ORE: 22,
    REDSTONE_ORE: 23, LAPIS_ORE: 24, DIAMOND_ORE: 25, EMERALD_ORE: 26,
    DEEPSLATE_COAL_ORE: 27, DEEPSLATE_IRON_ORE: 28, DEEPSLATE_GOLD_ORE: 29,
    DEEPSLATE_DIAMOND_ORE: 30, DEEPSLATE_REDSTONE_ORE: 31,
    DEEPSLATE_COPPER_ORE: 32, DEEPSLATE_LAPIS_ORE: 33, DEEPSLATE_EMERALD_ORE: 34,
    PODZOL_TOP: 35, PODZOL_SIDE: 36,
    SANDSTONE_TOP: 37, SANDSTONE_SIDE: 38, SANDSTONE_BOTTOM: 39,
    BIRCH_LOG_SIDE: 40, BIRCH_LOG_TOP: 41, BIRCH_PLANKS: 42, BIRCH_LEAVES: 43,
    SPRUCE_LOG_SIDE: 44, SPRUCE_LOG_TOP: 45, SPRUCE_PLANKS: 46, SPRUCE_LEAVES: 47,
    LAVA: 48, ICE: 49, CACTUS_TOP: 50, CACTUS_SIDE: 51, GLASS: 52, TORCH: 53,
    POPPY: 54, DANDELION: 55, DEAD_BUSH: 56
  };
  // The 57 tiles the LEGACY block table names. It is no longer the size of the atlas — see
  // A.build — but it is still the size of the table A.assertTileTable checks, and those 57
  // are the FIRST 57 layers of the real atlas by construction (tools/build-atlas.mjs
  // reserves them), which is what lets the legacy path keep its numbers unchanged.
  var LEGACY_COUNT = 57;
  var TILE_COUNT = LEGACY_COUNT;
  A.tiles = TILE_COUNT;   // overwritten by build() once the real layer count is known

  // ---------------------------------------------------------------------------
  // Tiny deterministic noise helpers. Everything is wrap-around so a tile repeats
  // seamlessly across a greedy-merged quad.
  // ---------------------------------------------------------------------------

  /** Value noise on a cells x cells lattice, smoothstep-interpolated, wrapping. -> Float32Array(256) */
  function vnoise(rnd, cells) {
    var g = new Float32Array(cells * cells), i;
    for (i = 0; i < g.length; i++) g[i] = rnd();
    var out = new Float32Array(TILE * TILE);
    var s = cells / TILE;
    for (var y = 0; y < TILE; y++) {
      var fy = y * s, y0 = fy | 0, ty = fy - y0, y1 = (y0 + 1) % cells;
      var sy = ty * ty * (3 - 2 * ty);
      for (var x = 0; x < TILE; x++) {
        var fx = x * s, x0 = fx | 0, tx = fx - x0, x1 = (x0 + 1) % cells;
        var sx = tx * tx * (3 - 2 * tx);
        var a = g[y0 * cells + x0], b = g[y0 * cells + x1];
        var c = g[y1 * cells + x0], d = g[y1 * cells + x1];
        out[y * TILE + x] = (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
      }
    }
    return out;
  }

  /** White noise, one value per texel, wrapping trivially. */
  function wnoise(rnd) {
    var o = new Float32Array(TILE * TILE);
    for (var i = 0; i < o.length; i++) o[i] = rnd();
    return o;
  }

  /** Per-tile RGBA scratch with a couple of drawing helpers. */
  function Tex() { this.d = new Uint8Array(TILE * TILE * 4); }
  Tex.prototype.set = function (x, y, r, g, b, a) {
    var i = (((y % TILE + TILE) % TILE) * TILE + ((x % TILE + TILE) % TILE)) * 4;
    var d = this.d;
    d[i] = r < 0 ? 0 : (r > 255 ? 255 : r | 0);
    d[i + 1] = g < 0 ? 0 : (g > 255 ? 255 : g | 0);
    d[i + 2] = b < 0 ? 0 : (b > 255 ? 255 : b | 0);
    d[i + 3] = a < 0 ? 0 : (a > 255 ? 255 : a | 0);
  };
  Tex.prototype.get = function (x, y) {
    var i = (((y % TILE + TILE) % TILE) * TILE + ((x % TILE + TILE) % TILE)) * 4;
    return this.d.subarray(i, i + 4);
  };

  /** Flat colour + multi-octave grain. `tintMask` becomes the alpha channel (see header). */
  function grain(tex, rnd, r, g, b, amp, cells, tintMask) {
    var n1 = vnoise(rnd, cells), n2 = wnoise(rnd);
    for (var y = 0; y < TILE; y++) {
      for (var x = 0; x < TILE; x++) {
        var i = y * TILE + x;
        var v = (n1[i] - 0.5) * 2 * amp + (n2[i] - 0.5) * 2 * amp * 0.45;
        tex.set(x, y, r + r * v, g + g * v, b + b * v, tintMask);
      }
    }
  }

  /** Scatter darker/lighter speckles. Deterministic count and positions. */
  function speckle(tex, rnd, count, dr, dg, db, size) {
    for (var k = 0; k < count; k++) {
      var x = (rnd() * TILE) | 0, y = (rnd() * TILE) | 0;
      for (var oy = 0; oy < size; oy++) {
        for (var ox = 0; ox < size; ox++) {
          var p = tex.get(x + ox, y + oy);
          tex.set(x + ox, y + oy, p[0] + dr, p[1] + dg, p[2] + db, p[3]);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Tile generators. Each is (tex, rnd) -> void and must be a pure function of rnd.
  // ---------------------------------------------------------------------------
  var GEN = {};

  GEN[T.MISSING] = function (tex) {
    for (var y = 0; y < TILE; y++) for (var x = 0; x < TILE; x++) {
      var on = ((x >> 3) ^ (y >> 3)) & 1;
      tex.set(x, y, on ? 0 : 255, 0, on ? 0 : 255, 0);
    }
  };

  GEN[T.STONE] = function (tex, rnd) {
    grain(tex, rnd, 126, 126, 126, 0.10, 4, 0);
    speckle(tex, rnd, 10, -16, -16, -16, 1);
    speckle(tex, rnd, 6, 14, 14, 14, 1);
  };

  GEN[T.DEEPSLATE] = function (tex, rnd) {
    // Vertical streaks: two-octave noise stretched on Y reads as the real block's banding.
    var n = vnoise(rnd, 8), m = vnoise(rnd, 2), w = wnoise(rnd);
    for (var y = 0; y < TILE; y++) for (var x = 0; x < TILE; x++) {
      var i = y * TILE + x;
      var v = (n[((y >> 2) * TILE + x) & 255] - 0.5) * 0.30 + (m[i] - 0.5) * 0.22 + (w[i] - 0.5) * 0.10;
      tex.set(x, y, 78 + 78 * v, 78 + 78 * v, 84 + 84 * v, 0);
    }
  };

  GEN[T.DIRT] = function (tex, rnd) {
    grain(tex, rnd, 134, 96, 67, 0.14, 4, 0);
    speckle(tex, rnd, 12, -22, -18, -14, 1);
    speckle(tex, rnd, 5, 16, 12, 8, 1);
  };

  // Grass is drawn in GREY and tinted by the shader (Blocks.tint = 1). alpha 255 = fully tinted.
  GEN[T.GRASS_TOP] = function (tex, rnd) {
    grain(tex, rnd, 188, 188, 188, 0.13, 5, 255);
    speckle(tex, rnd, 14, -26, -26, -26, 1);
    speckle(tex, rnd, 8, 20, 20, 20, 1);
  };

  GEN[T.GRASS_SIDE] = function (tex, rnd) {
    GEN[T.DIRT](tex, rnd);                     // dirt body, alpha 0 -> untinted
    var top = vnoise(rnd, 8);
    var g = vnoise(rnd, 5), w = wnoise(rnd);
    for (var x = 0; x < TILE; x++) {
      var h = 3 + ((top[x] * 3) | 0);          // ragged overlay depth, 3..5 texels
      for (var y = 0; y < h; y++) {
        var i = y * TILE + x;
        var v = (g[i] - 0.5) * 0.26 + (w[i] - 0.5) * 0.12;
        var c = 186 + 186 * v;
        tex.set(x, y, c, c, c, 255);           // alpha 255 -> grass tint applies here only
      }
    }
  };

  GEN[T.SAND] = function (tex, rnd) {
    grain(tex, rnd, 219, 207, 160, 0.07, 6, 0);
    speckle(tex, rnd, 9, -18, -16, -12, 1);
  };

  GEN[T.GRAVEL] = function (tex, rnd) {
    grain(tex, rnd, 132, 127, 125, 0.16, 3, 0);
    // pebbles: small rounded blobs with a dark rim
    for (var k = 0; k < 9; k++) {
      var cx = rnd() * TILE, cy = rnd() * TILE, r = 1.3 + rnd() * 1.4;
      var sh = (rnd() * 44 - 22) | 0;
      for (var y = -3; y <= 3; y++) for (var x = -3; x <= 3; x++) {
        var d = Math.sqrt(x * x + y * y);
        if (d > r) continue;
        var px = (cx + x) | 0, py = (cy + y) | 0;
        var p = tex.get(px, py);
        var edge = d > r - 0.9 ? -24 : 0;
        tex.set(px, py, p[0] + sh + edge, p[1] + sh + edge, p[2] + sh + edge, 0);
      }
    }
  };

  GEN[T.COBBLESTONE] = function (tex, rnd) {
    grain(tex, rnd, 70, 70, 70, 0.10, 4, 0);   // dark mortar background
    // Voronoi-ish cobbles: nearest of N seeds, per-cell shade, darkened cell boundaries.
    var N = 7, sx = new Float32Array(N), sy = new Float32Array(N), sv = new Float32Array(N);
    for (var k = 0; k < N; k++) { sx[k] = rnd() * TILE; sy[k] = rnd() * TILE; sv[k] = 108 + rnd() * 44; }
    var n = vnoise(rnd, 6);
    for (var y = 0; y < TILE; y++) for (var x = 0; x < TILE; x++) {
      var best = 1e9, second = 1e9, bi = 0;
      for (k = 0; k < N; k++) {
        var dx = x + 0.5 - sx[k]; if (dx > TILE / 2) dx -= TILE; if (dx < -TILE / 2) dx += TILE;
        var dy = y + 0.5 - sy[k]; if (dy > TILE / 2) dy -= TILE; if (dy < -TILE / 2) dy += TILE;
        var d = dx * dx + dy * dy;
        if (d < best) { second = best; best = d; bi = k; } else if (d < second) second = d;
      }
      var rim = (Math.sqrt(second) - Math.sqrt(best)) < 0.85;
      if (rim) continue;                        // leave the mortar background showing
      var c = sv[bi] + (n[y * TILE + x] - 0.5) * 26;
      tex.set(x, y, c, c, c, 0);
    }
  };

  GEN[T.BEDROCK] = function (tex, rnd) {
    // Chunky 2x2 blocks of random grey — the real block's defining feature.
    for (var y = 0; y < TILE; y += 2) for (var x = 0; x < TILE; x += 2) {
      var c = 46 + rnd() * 74;
      for (var oy = 0; oy < 2; oy++) for (var ox = 0; ox < 2; ox++) {
        var j = c + (rnd() * 16 - 8);
        tex.set(x + ox, y + oy, j, j, j, 0);
      }
    }
    speckle(tex, rnd, 10, -30, -30, -30, 1);
  };

  /** Vertical bark grain plus N dark grooves. Stretched hard on Y so it tiles up a trunk. */
  function logSide(r, g, b, grooves, gr, gg, gb) {
    return function (tex, rnd) {
      var n = vnoise(rnd, 8), w = wnoise(rnd);
      for (var y = 0; y < TILE; y++) for (var x = 0; x < TILE; x++) {
        var v = (n[((y >> 3) * TILE + x) & 255] - 0.5) * 0.34 + (w[y * TILE + x] - 0.5) * 0.14;
        tex.set(x, y, r + r * v, g + g * v, b + b * v, 0);
      }
      for (var k = 0; k < grooves; k++) {
        var cx = 3 + k * 8;
        for (y = 0; y < TILE; y++) {
          var p = tex.get(cx, y);
          tex.set(cx, y, p[0] + gr, p[1] + gg, p[2] + gb, 0);
        }
      }
    };
  }

  /** Concentric growth rings with a darker bark rim. */
  function logTop(r, g, b) {
    return function (tex, rnd) {
      var n = vnoise(rnd, 4);
      for (var y = 0; y < TILE; y++) for (var x = 0; x < TILE; x++) {
        var dx = x - 7.5, dy = y - 7.5;
        var rr = Math.sqrt(dx * dx + dy * dy);
        var ring = Math.sin(rr * 2.1) * 0.5 + 0.5;
        var v = ring * 0.20 + (n[y * TILE + x] - 0.5) * 0.14;
        var bark = rr > 6.6 ? -0.22 : 0;
        tex.set(x, y, r * (0.86 + v + bark), g * (0.86 + v + bark), b * (0.86 + v + bark), 0);
      }
    };
  }

  /** Four horizontal boards with a dark seam and one nail notch each. */
  function planks(r, g, b) {
    return function (tex, rnd) {
      var n = vnoise(rnd, 8), w = wnoise(rnd);
      for (var y = 0; y < TILE; y++) {
        var boundary = (y & 3) === 0;
        for (var x = 0; x < TILE; x++) {
          var i = y * TILE + x;
          var v = (n[i] - 0.5) * 0.16 + (w[i] - 0.5) * 0.08;
          var sh = boundary ? -0.26 : 0;
          tex.set(x, y, r * (1 + v + sh), g * (1 + v + sh), b * (1 + v + sh), 0);
        }
      }
      for (var row = 0; row < 4; row++) {
        var px = (rnd() * TILE) | 0, py = row * 4 + 2;
        var p = tex.get(px, py);
        tex.set(px, py, p[0] - 34, p[1] - 28, p[2] - 18, 0);
      }
    };
  }

  /**
   * Leaves: CUTOUT. alpha 0 punches a hole; visible texels are fully foliage-tinted.
   * RGB is written everywhere (including holes) so mip box-filtering never pulls in black.
   * `base` is a GREY level — the species difference survives the foliage tint as brightness.
   */
  function leaves(base, holeCut) {
    return function (tex, rnd) {
      var n = vnoise(rnd, 5), w = wnoise(rnd);
      for (var y = 0; y < TILE; y++) for (var x = 0; x < TILE; x++) {
        var i = y * TILE + x;
        var v = (n[i] - 0.5) * 0.42 + (w[i] - 0.5) * 0.26;
        var c = base * (1 + v);
        var hole = (n[i] * 0.65 + w[i] * 0.35) < holeCut;
        tex.set(x, y, c, c * 1.02, c * 0.92, hole ? 0 : 255);
      }
    };
  }

  GEN[T.OAK_LOG_SIDE] = logSide(150, 117,  70, 2, -26, -22, -14);
  GEN[T.OAK_LOG_TOP]  = logTop(176, 142,  88);
  GEN[T.OAK_PLANKS]   = planks(162, 130,  78);
  GEN[T.OAK_LEAVES]   = leaves(172, 0.24);

  GEN[T.SPRUCE_LOG_SIDE] = logSide(104,  80,  48, 3, -22, -18, -12);
  GEN[T.SPRUCE_LOG_TOP]  = logTop(150, 116,  70);
  GEN[T.SPRUCE_PLANKS]   = planks(116,  86,  52);
  GEN[T.SPRUCE_LEAVES]   = leaves(126, 0.20);   // darker: spruce reads almost black-green

  // Birch bark is white with short black dashes, not grooves — it is the one log you can
  // identify from 30 blocks away, so it gets its own generator.
  GEN[T.BIRCH_LOG_SIDE] = function (tex, rnd) {
    var n = vnoise(rnd, 6), w = wnoise(rnd);
    for (var y = 0; y < TILE; y++) for (var x = 0; x < TILE; x++) {
      var i = y * TILE + x;
      var v = (n[i] - 0.5) * 0.10 + (w[i] - 0.5) * 0.07;
      tex.set(x, y, 216 * (1 + v), 213 * (1 + v), 199 * (1 + v), 0);
    }
    for (var k = 0; k < 6; k++) {
      var x0 = (rnd() * TILE) | 0, y0 = (rnd() * TILE) | 0, len = 2 + ((rnd() * 3) | 0);
      for (var s = 0; s < len; s++) {
        for (var t = 0; t < 2; t++) tex.set(x0 + s, y0 + t, 66 + rnd() * 24, 62 + rnd() * 22, 56, 0);
      }
    }
  };
  GEN[T.BIRCH_LOG_TOP] = logTop(210, 190, 140);
  GEN[T.BIRCH_PLANKS]  = planks(206, 190, 148);
  GEN[T.BIRCH_LEAVES]  = leaves(196, 0.26);     // lighter, airier canopy

  // Water: TRANSLUCENT. Drawn pale so the water tint (a blue) produces the final colour.
  GEN[T.WATER] = function (tex, rnd) {
    var n = vnoise(rnd, 4), m = vnoise(rnd, 8);
    for (var y = 0; y < TILE; y++) for (var x = 0; x < TILE; x++) {
      var i = y * TILE + x;
      var v = (n[i] - 0.5) * 0.10 + (m[i] - 0.5) * 0.06;
      tex.set(x, y, 208 * (1 + v), 220 * (1 + v), 250 * (1 + v), 200);
    }
  };

  GEN[T.SNOW] = function (tex, rnd) {
    grain(tex, rnd, 246, 246, 252, 0.035, 6, 0);
    speckle(tex, rnd, 6, -8, -8, -4, 1);
  };

  GEN[T.SCULK] = function (tex, rnd) {
    grain(tex, rnd, 20, 26, 32, 0.30, 4, 0);
    // cyan veins
    for (var k = 0; k < 7; k++) {
      var x = (rnd() * TILE) | 0, y = (rnd() * TILE) | 0, len = 2 + ((rnd() * 3) | 0);
      var dx = rnd() < 0.5 ? 1 : 0, dy = dx ? 0 : 1;
      for (var s = 0; s < len; s++) tex.set(x + dx * s, y + dy * s, 14, 104 + rnd() * 40, 112 + rnd() * 40, 0);
    }
    speckle(tex, rnd, 5, 8, 26, 28, 1);
  };

  GEN[T.GLOWSTONE] = function (tex, rnd) {
    grain(tex, rnd, 138, 108, 58, 0.16, 4, 0);
    for (var k = 0; k < 11; k++) {
      var cx = (rnd() * TILE) | 0, cy = (rnd() * TILE) | 0, r = rnd() < 0.4 ? 2 : 1;
      for (var y = -r; y <= r; y++) for (var x = -r; x <= r; x++) {
        if (x * x + y * y > r * r + 0.2) continue;
        tex.set(cx + x, cy + y, 250, 226 - rnd() * 20, 142 - rnd() * 30, 0);
      }
    }
  };

  // Short grass: CUTOUT, mostly empty, grey blades tinted green by the shader.
  GEN[T.SHORT_GRASS] = function (tex, rnd) {
    for (var y = 0; y < TILE; y++) for (var x = 0; x < TILE; x++) tex.set(x, y, 150, 158, 140, 0);
    for (var b = 0; b < 9; b++) {
      var x0 = (rnd() * TILE) | 0;
      var h = 5 + ((rnd() * 8) | 0);
      var lean = rnd() < 0.5 ? -1 : 1;
      for (var i = 0; i < h; i++) {
        var y0 = TILE - 1 - i;
        var xx = x0 + ((i * lean / 4) | 0);
        var c = 150 + i * 6;
        tex.set(xx, y0, c, c + 8, c - 12, 255);
      }
    }
  };

  /** Stone/deepslate ore: base rock plus deterministic mineral blobs. */
  function ore(baseGen, r, g, b, blobs) {
    return function (tex, rnd) {
      baseGen(tex, rnd);
      for (var k = 0; k < blobs; k++) {
        var cx = (rnd() * TILE) | 0, cy = (rnd() * TILE) | 0;
        var w = 2 + ((rnd() * 2) | 0), h = 2 + ((rnd() * 2) | 0);
        for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
          // rounded corners: skip the diagonal extremes of the blob
          if ((x === 0 || x === w - 1) && (y === 0 || y === h - 1) && (w > 2 && h > 2)) continue;
          var sh = 0.82 + rnd() * 0.30;
          tex.set(cx + x, cy + y, r * sh, g * sh, b * sh, 0);
        }
      }
    };
  }

  GEN[T.COAL_ORE]     = ore(GEN[T.STONE],  38,  38,  40, 3);
  GEN[T.IRON_ORE]     = ore(GEN[T.STONE], 200, 160, 126, 3);
  GEN[T.COPPER_ORE]   = ore(GEN[T.STONE], 198, 118,  72, 3);
  GEN[T.GOLD_ORE]     = ore(GEN[T.STONE], 248, 214,  88, 3);
  GEN[T.REDSTONE_ORE] = ore(GEN[T.STONE], 204,  44,  44, 4);
  GEN[T.LAPIS_ORE]    = ore(GEN[T.STONE],  44,  84, 190, 4);
  GEN[T.DIAMOND_ORE]  = ore(GEN[T.STONE],  98, 226, 224, 3);
  GEN[T.EMERALD_ORE]  = ore(GEN[T.STONE],  62, 202,  94, 3);

  GEN[T.DEEPSLATE_COAL_ORE]     = ore(GEN[T.DEEPSLATE],  30,  30,  32, 3);
  GEN[T.DEEPSLATE_IRON_ORE]     = ore(GEN[T.DEEPSLATE], 196, 156, 122, 3);
  GEN[T.DEEPSLATE_GOLD_ORE]     = ore(GEN[T.DEEPSLATE], 244, 210,  84, 3);
  GEN[T.DEEPSLATE_DIAMOND_ORE]  = ore(GEN[T.DEEPSLATE],  94, 222, 220, 3);
  GEN[T.DEEPSLATE_REDSTONE_ORE] = ore(GEN[T.DEEPSLATE], 200,  40,  40, 4);
  GEN[T.DEEPSLATE_COPPER_ORE]   = ore(GEN[T.DEEPSLATE], 190, 112,  70, 3);
  GEN[T.DEEPSLATE_LAPIS_ORE]    = ore(GEN[T.DEEPSLATE],  50,  90, 194, 4);
  GEN[T.DEEPSLATE_EMERALD_ORE]  = ore(GEN[T.DEEPSLATE],  58, 196,  92, 3);

  // ---------------------------------------------------------------------------
  // Soils, stone products and the small stuff
  // ---------------------------------------------------------------------------

  GEN[T.PODZOL_TOP] = function (tex, rnd) {
    grain(tex, rnd, 106, 74, 36, 0.20, 5, 0);
    speckle(tex, rnd, 16, -24, -18, -10, 1);
    speckle(tex, rnd, 7, 26, 20, 8, 1);
  };

  GEN[T.PODZOL_SIDE] = function (tex, rnd) {
    GEN[T.DIRT](tex, rnd);
    var top = vnoise(rnd, 8), g = vnoise(rnd, 5);
    for (var x = 0; x < TILE; x++) {
      var h = 3 + ((top[x] * 3) | 0);
      for (var y = 0; y < h; y++) {
        var v = (g[y * TILE + x] - 0.5) * 0.30;
        tex.set(x, y, 108 * (1 + v), 76 * (1 + v), 38 * (1 + v), 0);
      }
    }
  };

  GEN[T.SANDSTONE_TOP] = function (tex, rnd) {
    grain(tex, rnd, 224, 212, 165, 0.05, 8, 0);
    speckle(tex, rnd, 6, -14, -12, -9, 1);
  };

  // Horizontal sedimentary banding — the whole point of the block.
  GEN[T.SANDSTONE_SIDE] = function (tex, rnd) {
    var n = vnoise(rnd, 6), w = wnoise(rnd);
    for (var y = 0; y < TILE; y++) {
      var band = (y < 3) ? 0.06 : ((y === 3 || y === 11) ? -0.10 : 0);
      for (var x = 0; x < TILE; x++) {
        var i = y * TILE + x;
        var v = (n[(((y >> 2) << 2) * TILE + x) & 255] - 0.5) * 0.09 + (w[i] - 0.5) * 0.05 + band;
        tex.set(x, y, 218 * (1 + v), 206 * (1 + v), 158 * (1 + v), 0);
      }
    }
  };

  GEN[T.SANDSTONE_BOTTOM] = function (tex, rnd) {
    grain(tex, rnd, 200, 188, 143, 0.07, 5, 0);
    speckle(tex, rnd, 8, -18, -16, -12, 1);
  };

  // Lava is on the OPAQUE layer (Blocks: opaque, emit 15), so alpha is a tint mask and stays 0.
  GEN[T.LAVA] = function (tex, rnd) {
    var n = vnoise(rnd, 4), m = vnoise(rnd, 8);
    for (var y = 0; y < TILE; y++) for (var x = 0; x < TILE; x++) {
      var i = y * TILE + x;
      var v = n[i] * 0.7 + m[i] * 0.3;
      // dark crust between bright molten cells
      var c = v * v;
      tex.set(x, y, 150 + 110 * c, 42 + 150 * c * c, 12 + 40 * c * c * c, 0);
    }
    for (var k = 0; k < 6; k++) {
      var cx = (rnd() * TILE) | 0, cy = (rnd() * TILE) | 0;
      for (var oy = 0; oy < 2; oy++) for (var ox = 0; ox < 2; ox++) {
        tex.set(cx + ox, cy + oy, 252, 214 - rnd() * 40, 96, 0);
      }
    }
  };

  // Ice is TRANSLUCENT: alpha is opacity.
  GEN[T.ICE] = function (tex, rnd) {
    var n = vnoise(rnd, 5), w = wnoise(rnd);
    for (var y = 0; y < TILE; y++) for (var x = 0; x < TILE; x++) {
      var i = y * TILE + x;
      var v = (n[i] - 0.5) * 0.10 + (w[i] - 0.5) * 0.04;
      tex.set(x, y, 168 * (1 + v), 200 * (1 + v), 246 * (1 + v), 190);
    }
    for (var k = 0; k < 5; k++) {                  // cracks
      var x0 = (rnd() * TILE) | 0, y0 = (rnd() * TILE) | 0;
      var dx = rnd() < 0.5 ? 1 : 0, dy = dx ? 0 : 1, len = 3 + ((rnd() * 5) | 0);
      for (var s = 0; s < len; s++) tex.set(x0 + dx * s, y0 + dy * s, 208, 230, 255, 210);
    }
  };

  GEN[T.CACTUS_TOP] = function (tex, rnd) {
    grain(tex, rnd, 78, 130, 56, 0.12, 5, 0);
    for (var k = 0; k < 8; k++) {
      var x = (rnd() * TILE) | 0, y = (rnd() * TILE) | 0;
      tex.set(x, y, 216, 226, 190, 0);
    }
  };

  // Vertical ribs plus a darker frame: cactus is inset in vanilla and the frame fakes that.
  GEN[T.CACTUS_SIDE] = function (tex, rnd) {
    var n = vnoise(rnd, 6);
    for (var y = 0; y < TILE; y++) for (var x = 0; x < TILE; x++) {
      var rib = Math.sin((x + 0.5) * Math.PI / 4) * 0.10;
      var v = rib + (n[y * TILE + x] - 0.5) * 0.14;
      var edge = (x === 0 || x === TILE - 1) ? -0.30 : 0;
      tex.set(x, y, 62 * (1 + v + edge), 118 * (1 + v + edge), 48 * (1 + v + edge), 0);
    }
    for (var k = 0; k < 5; k++) {
      var px = 2 + ((rnd() * 12) | 0), py = (rnd() * TILE) | 0;
      tex.set(px, py, 226, 232, 200, 0);
      tex.set(px, py + 1, 200, 208, 176, 0);
    }
  };

  // Glass: CUTOUT. Alpha 0 everywhere but the frame and a couple of highlight streaks.
  GEN[T.GLASS] = function (tex, rnd) {
    var n = vnoise(rnd, 4);
    for (var y = 0; y < TILE; y++) for (var x = 0; x < TILE; x++) {
      var frame = (x === 0 || y === 0 || x === TILE - 1 || y === TILE - 1);
      var v = 1 + (n[y * TILE + x] - 0.5) * 0.10;
      tex.set(x, y, 214 * v, 232 * v, 240 * v, frame ? 255 : 0);
    }
    for (var k = 0; k < 3; k++) {                  // diagonal highlight
      var x0 = 3 + ((rnd() * 8) | 0), y0 = 3 + ((rnd() * 6) | 0), len = 3 + ((rnd() * 4) | 0);
      for (var s = 0; s < len; s++) tex.set(x0 + s, y0 + s, 244, 250, 255, 255);
    }
  };

  // Torch: CUTOUT cross model. A stick with a flame head, centred so the two crossed quads
  // read as one torch rather than two planks.
  GEN[T.TORCH] = function (tex, rnd) {
    for (var y = 0; y < TILE; y++) for (var x = 0; x < TILE; x++) tex.set(x, y, 120, 88, 48, 0);
    for (y = 8; y < TILE; y++) {
      for (var x2 = 7; x2 <= 8; x2++) {
        var v = 1 + (rnd() - 0.5) * 0.18;
        tex.set(x2, y, 126 * v, 94 * v, 52 * v, 255);
      }
    }
    for (y = 5; y < 8; y++) for (x = 6; x <= 9; x++) {
      var inner = (x >= 7 && x <= 8 && y >= 6);
      tex.set(x, y, inner ? 255 : 244, inner ? 244 : 186, inner ? 170 : 70, 255);
    }
  };

  /** Small cutout plant: green stem, coloured head. Used for both flowers. */
  function flower(hr, hg, hb, headRows) {
    return function (tex, rnd) {
      for (var y = 0; y < TILE; y++) for (var x = 0; x < TILE; x++) tex.set(x, y, 92, 132, 62, 0);
      for (y = 8; y < TILE - 1; y++) {
        var v = 1 + (rnd() - 0.5) * 0.24;
        tex.set(7, y, 78 * v, 128 * v, 54 * v, 255);
        if ((y & 1) === 0) tex.set(6 + ((y >> 1) & 1) * 3, y, 88, 142, 60, 255);
      }
      for (var k = 0; k < headRows.length; k++) {
        var row = headRows[k];
        for (var i = 0; i < row.length; i++) {
          if (row[i] === 1) {
            var w = 0.85 + rnd() * 0.3;
            tex.set(5 + i, 3 + k, hr * w, hg * w, hb * w, 255);
          }
        }
      }
    };
  }

  GEN[T.POPPY] = flower(212, 48, 48, [
    [0, 1, 1, 1, 0],
    [1, 1, 0, 1, 1],
    [1, 1, 1, 1, 1],
    [0, 1, 1, 1, 0],
    [0, 0, 1, 0, 0]
  ]);

  GEN[T.DANDELION] = flower(238, 214, 66, [
    [0, 0, 1, 0, 0],
    [0, 1, 1, 1, 0],
    [1, 1, 1, 1, 1],
    [0, 1, 1, 1, 0],
    [0, 0, 1, 0, 0]
  ]);

  GEN[T.DEAD_BUSH] = function (tex, rnd) {
    for (var y = 0; y < TILE; y++) for (var x = 0; x < TILE; x++) tex.set(x, y, 122, 96, 52, 0);
    for (var b = 0; b < 6; b++) {
      var x0 = 3 + ((rnd() * 10) | 0), y0 = TILE - 1;
      var lean = rnd() < 0.5 ? -1 : 1, h = 6 + ((rnd() * 6) | 0);
      for (var i = 0; i < h; i++) {
        var xx = x0 + ((i * lean / 3) | 0);
        var c = 108 + i * 5;
        tex.set(xx, y0 - i, c, c * 0.78, c * 0.44, 255);
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------

  /**
   * build(seed) -> canvas
   * Generates every tile, packs them into the layer array + mip chain, paints the debug
   * canvas, and hands the name->tile mapping to Blocks.bindAtlas.
   */
  A.build = function (seed) {
    A.seed = (seed >>> 0) || 1;
    A.assertTileTable();

    // --- level 0: one contiguous RGBA block per layer (the layout texSubImage3D and
    //     queue.writeTexture both want) ---
    // ── the atlas layers ────────────────────────────────────────────────────────────
    // Dan: "that screenshot is rough on block textures, next step is getting real mc
    // texutres. preferably the old ones."
    //
    // The payload is the WHOLE roster's atlas — 768 layers, 64% of them from his own
    // 1.13.2 jar — not a separate 57-tile image. tools/build-atlas.mjs reserves layers
    // 0..56 for exactly the tiles B.T names, in B.T's order, so the legacy mesher's
    // numbers are still correct and the model stream's baked numbers index the same
    // texture. One atlas, two vertex formats, no runtime remapping anywhere.
    //
    // ⚠ The greyscale textures stay greyscale. grass_block_top, the leaves and short grass
    // are tinted by the SHADER through the per-block `tint` field, and baking a colour in
    // as well tinted them twice — which the first version of this did, invisibly, because
    // the smoke test spawns in a snow biome.
    var lvl0, layers;
    if (NS.DATA && NS.DATA.blockTiles && NS.Z) {
      lvl0 = NS.Z.unpack(NS.DATA.blockTiles, NS.DATA.blockTilesBytes);
      layers = NS.DATA.blockTilesCount;
      if (lvl0.length !== layers * TILE * TILE * 4) {
        throw new Error('atlas payload is ' + lvl0.length + ' bytes for ' + layers +
                        ' layers; expected ' + (layers * TILE * TILE * 4));
      }
      if (layers < LEGACY_COUNT) {
        throw new Error('atlas has ' + layers + ' layers, fewer than the ' + LEGACY_COUNT +
                        ' the legacy block table names');
      }
      A.source = 'jar';
    } else {
      // No payload: fall back to the procedural generators. They are kept, not deleted —
      // they are what made the engine testable before there were any textures at all, and
      // they are still the only path a stripped build has.
      layers = LEGACY_COUNT;
      lvl0 = new Uint8Array(layers * TILE * TILE * 4);
      var tex = new Tex();
      for (var t = 0; t < layers; t++) {
        // Per-tile RNG: adding the tile index to the seed means editing one generator can
        // never change another tile's pixels.
        var rnd = NS.U.rng((A.seed + Math.imul(t + 1, 0x9E3779B1)) >>> 0);
        tex.d.fill(0);
        (GEN[t] || GEN[T.MISSING])(tex, rnd);
        lvl0.set(tex.d, t * TILE * TILE * 4);
      }
      A.source = 'procedural';
    }
    // ── THE ITEM SPRITES, APPENDED AS LAYERS (D-341) ────────────────────────────────
    // ⚠⚠ **A DROPPED ITEM IS DRAWN IN THE WORLD, AND THE WORLD SAMPLES THIS ARRAY.** The model
    // stream's `tile` field is an array LAYER index, so an item sprite living in its own 2D sheet
    // cannot be sampled by that shader at all — which is exactly why a dropped stick was invisible
    // while a dropped cobblestone was not. Item sprites are 16x16, which IS this array's layer
    // size, so they append with no resampling, no padding and no seams.
    // ⚠ THEY GO AFTER THE BLOCK TILES AND NOTHING ELSE MOVES. Every baked block tile index, every
    // greedy tile number and every saved world stays exactly what it was; `A.itemTile0` is the
    // offset, and a wrong offset is a WRONG PICTURE rather than a crash, so it is asserted.
    // ⚠ A MOB TEXTURE CANNOT COME THIS WAY. A zombie sheet is 64x64 and a texture array's layers
    // are all one size; that is G18's problem and it is a different one.
    A.itemTile0 = 0;
    A.itemTiles = 0;
    if (NS.DATA && NS.DATA.itemTiles && NS.Z) {
      var iRaw = NS.Z.unpack(NS.DATA.itemTiles, NS.DATA.itemTilesBytes);
      var iCount = NS.DATA.itemTilesCount | 0;
      if (iRaw.length !== iCount * TILE * TILE * 4) {
        throw new Error('item tile payload is ' + iRaw.length + ' bytes for ' + iCount +
                        ' layers; expected ' + (iCount * TILE * TILE * 4));
      }
      var merged = new Uint8Array((layers + iCount) * TILE * TILE * 4);
      merged.set(lvl0, 0);
      merged.set(iRaw, layers * TILE * TILE * 4);
      A.itemTile0 = layers;
      A.itemTiles = iCount;
      lvl0 = merged;
      layers += iCount;
    }

    // ── PASS 15 JOB 3 (G17e): THE BLOCK-ENTITY ITEM TEXTURES, APPENDED AFTER THE ITEM TILES ────
    // ⚠ D-341's trick a third time: a chest/bed/banner/etc. is drawn from `bePart0 + beNames[name]`
    // in the SAME geometry parts array, and that part's baked `tile` numbers already assume this
    // exact offset — `pack-blockentity.mjs` computed `tileBase = blockLayers + itemLayers` itself,
    // so nothing here remaps a number the pipeline already owns (D-305).
    A.beTile0 = 0;
    A.beTiles = 0;
    if (NS.DATA && NS.DATA.beTiles && NS.Z && NS.DATA.beTilesCount) {
      var beRaw = NS.Z.unpack(NS.DATA.beTiles, NS.DATA.beTilesBytes);
      var beCount = NS.DATA.beTilesCount | 0;
      if (beRaw.length !== beCount * TILE * TILE * 4) {
        throw new Error('be-item tile payload is ' + beRaw.length + ' bytes for ' + beCount +
                        ' layers; expected ' + (beCount * TILE * TILE * 4));
      }
      var beMerged = new Uint8Array((layers + beCount) * TILE * TILE * 4);
      beMerged.set(lvl0, 0);
      beMerged.set(beRaw, layers * TILE * TILE * 4);
      A.beTile0 = layers;
      A.beTiles = beCount;
      lvl0 = beMerged;
      layers += beCount;
    }

    // -- PASS 16 JOB 4.2's GPU wiring, data half: MOB BOX FACE CROPS, appended after the
    // be-item tiles (D-317/D-341/D-376's pattern a fourth time). tools/pack-mobtex.mjs baked
    // this layer set; NS.DATA.mobGeometry (deflated, in 19_data.gen.js) is the per-(layer,
    // part, face) slice -> tile+offset lookup a live mob renderer would read to pick a real
    // tile+uv instead of the caller-supplied placeholder ER.emitMobLayer still takes -- NO
    // caller does that yet (see git 2a8efe1:docs/passes/PASS-16-HISTORY.md), so appending these layers
    // here changes nothing about what the game draws today: it only makes A.mobTile0/A.mobTiles
    // real numbers a future session can build against, exactly as A.beTile0 once was before
    // JOB 3 wired a caller to it.
    A.mobTile0 = 0;
    A.mobTiles = 0;
    if (NS.DATA && NS.DATA.mobTiles && NS.Z && NS.DATA.mobTilesCount) {
      var mobRaw = NS.Z.unpack(NS.DATA.mobTiles, NS.DATA.mobTilesBytes);
      var mobCount = NS.DATA.mobTilesCount | 0;
      if (mobRaw.length !== mobCount * TILE * TILE * 4) {
        throw new Error('mob tile payload is ' + mobRaw.length + ' bytes for ' + mobCount +
                        ' layers; expected ' + (mobCount * TILE * TILE * 4));
      }
      var mobMerged = new Uint8Array((layers + mobCount) * TILE * TILE * 4);
      mobMerged.set(lvl0, 0);
      mobMerged.set(mobRaw, layers * TILE * TILE * 4);
      A.mobTile0 = layers;
      A.mobTiles = mobCount;
      lvl0 = mobMerged;
      layers += mobCount;
    }

    // -- #5707: THE PAINTING TILES, after the mob tiles (tools/pack-painting.mjs): layer 0 is
    // back.png, then each motive's 16x16 squares row-major. ER.paintingQuads indexes into them.
    A.paintTile0 = 0;
    A.paintTiles = 0;
    if (NS.DATA && NS.DATA.paintTiles && NS.Z && NS.DATA.paintTilesCount) {
      var paintRaw = NS.Z.unpack(NS.DATA.paintTiles, NS.DATA.paintTilesBytes);
      var paintCount = NS.DATA.paintTilesCount | 0;
      if (paintRaw.length !== paintCount * TILE * TILE * 4) {
        throw new Error('painting tile payload is ' + paintRaw.length + ' bytes for ' + paintCount +
                        ' layers; expected ' + (paintCount * TILE * TILE * 4));
      }
      var paintMerged = new Uint8Array((layers + paintCount) * TILE * TILE * 4);
      paintMerged.set(lvl0, 0);
      paintMerged.set(paintRaw, layers * TILE * TILE * 4);
      A.paintTile0 = layers;
      A.paintTiles = paintCount;
      lvl0 = paintMerged;
      layers += paintCount;
    }

    // -- #1329: THE DYNAMIC TILE POOL, after the mob tiles. Spare 16x16 layers (zeroed here) that a
    // runtime texture - the in-world banner (#1172) - borrows with dynTake and fills with dynWrite.
    // Both GPU backends re-upload only the layers dynWrite marked dirty (syncAtlasDyn).
    A.dynTile0 = layers;
    A.dynTiles = A.DYN_POOL;
    A.dynUsed = [];
    A.dynDirty = [];
    var dynMerged = new Uint8Array((layers + A.DYN_POOL) * TILE * TILE * 4);
    dynMerged.set(lvl0, 0);
    lvl0 = dynMerged;
    layers += A.DYN_POOL;

    TILE_COUNT = layers;
    A.tiles = layers;

    A.mips = [{ size: TILE, data: lvl0 }];
    var s = TILE, prev = lvl0;
    while (s > 1) {
      var ns = s >> 1;
      var next = new Uint8Array(TILE_COUNT * ns * ns * 4);
      for (var L = 0; L < TILE_COUNT; L++) {
        var sOff = L * s * s * 4, dOff = L * ns * ns * 4;
        for (var y = 0; y < ns; y++) for (var x = 0; x < ns; x++) {
          var i00 = sOff + ((y * 2) * s + x * 2) * 4;
          var i10 = i00 + 4;
          var i01 = sOff + ((y * 2 + 1) * s + x * 2) * 4;
          var i11 = i01 + 4;
          var o = dOff + (y * ns + x) * 4;
          // Unweighted RGB average: alpha is a tint mask on opaque tiles, so weighting RGB by
          // it would darken grass_side's dirt. Cutout tiles write RGB in their holes for
          // exactly this reason (see GEN[T.OAK_LEAVES]).
          for (var c = 0; c < 4; c++) {
            next[o + c] = (prev[i00 + c] + prev[i10 + c] + prev[i01 + c] + prev[i11 + c] + 2) >> 2;
          }
        }
      }
      A.mips.push({ size: ns, data: next });
      prev = next; s = ns;
    }
    A.levels = A.mips.length;
    A.animInit();

    // --- debug canvas: the same texels, laid out COLS-wide ---
    var px = A.size();
    var c2 = (typeof OffscreenCanvas !== 'undefined')
      ? new OffscreenCanvas(px, px)
      : document.createElement('canvas');
    c2.width = px; c2.height = px;
    var ctx = c2.getContext('2d', { alpha: true, willReadFrequently: false });
    ctx.imageSmoothingEnabled = false;
    var img = ctx.createImageData(px, px);
    for (t = 0; t < TILE_COUNT; t++) {
      var tx = (t % COLS) * TILE, ty = ((t / COLS) | 0) * TILE;
      for (y = 0; y < TILE; y++) for (x = 0; x < TILE; x++) {
        var si = (t * TILE * TILE + y * TILE + x) * 4;
        var di = ((ty + y) * px + (tx + x)) * 4;
        img.data[di] = lvl0[si]; img.data[di+1] = lvl0[si+1];
        img.data[di+2] = lvl0[si+2]; img.data[di+3] = 255;   // opaque preview
      }
    }
    ctx.putImageData(img, 0, 0);
    A.canvas = c2;

    for (var name in T) A.names[name] = T[name];
    NS.Blocks.bindAtlas(A.map());
    return c2;
  };

  A.DYN_POOL = 64;

  /** Borrow a spare layer from the dynamic pool; -1 when it is exhausted. */
  A.dynTake = function () {
    for (var i = 0; i < A.dynTiles; i++) {
      if (!A.dynUsed[i]) { A.dynUsed[i] = true; return A.dynTile0 + i; }
    }
    return -1;
  };

  /** Hand a layer back (its texels are left as they are; the next dynWrite overwrites them). */
  A.dynFree = function (tile) {
    var i = tile - A.dynTile0;
    if (i >= 0 && i < A.dynTiles) A.dynUsed[i] = false;
  };

  /**
   * Write a 16x16 RGBA tile into a taken layer, rebuild that layer's whole mip chain (same
   * unweighted 2x2 average as build) and mark it dirty for syncAtlasDyn.
   */
  A.dynWrite = function (tile, rgba) {
    var i = tile - A.dynTile0;
    if (i < 0 || i >= A.dynTiles || !A.dynUsed[i]) throw new Error('Atlas.dynWrite: tile ' + tile + ' is not a taken dynamic tile');
    A.writeTile(tile, rgba);
  };

  /** Any layer: write 16x16 RGBA, rebuild its mip chain, mark dirty (the backends re-upload that one layer). */
  A.writeTile = function (tile, rgba) {
    if (!rgba || rgba.length !== TILE * TILE * 4) throw new Error('Atlas.writeTile: expected ' + (TILE * TILE * 4) + ' bytes');
    A.mips[0].data.set(rgba, tile * TILE * TILE * 4);
    for (var l = 1; l < A.mips.length; l++) {
      var s = A.mips[l - 1].size, ns = s >> 1, prev = A.mips[l - 1].data, next = A.mips[l].data;
      var sOff = tile * s * s * 4, dOff = tile * ns * ns * 4;
      for (var y = 0; y < ns; y++) for (var x = 0; x < ns; x++) {
        var i00 = sOff + ((y * 2) * s + x * 2) * 4, i01 = sOff + ((y * 2 + 1) * s + x * 2) * 4;
        var o = dOff + (y * ns + x) * 4;
        for (var c = 0; c < 4; c++) {
          next[o + c] = (prev[i00 + c] + prev[i00 + 4 + c] + prev[i01 + c] + prev[i01 + 4 + c] + 2) >> 2;
        }
      }
    }
    if (A.dynDirty.indexOf(tile) < 0) A.dynDirty.push(tile);
  };

  // ---------------------------------------------------------------------------
  // ANIM-1 (#1891): animated tiles. Vanilla Sprite.Animation (decomp Sprite.java:280-343), one tick
  // per 20 Hz client tick: frameTicks++; at frameTicks >= frames[frameIndex].time step to the next
  // frame and upload it; otherwise, if `interpolate`, blend the current and next frame
  // (Sprite.Interpolation.apply, Sprite.java:396-420). Only the tile's own layer is re-uploaded
  // (writeTile -> dynDrain), never the atlas. Mips are our 2x2 average of the blended level 0, not
  // vanilla's blend of its mips - rendering, not parity.
  // ---------------------------------------------------------------------------
  A.anims = [];
  A.animInit = function () {
    A.anims = [];
    var D = NS.DATA;
    if (!D || !D.blockAnim || !D.blockAnimMeta || !NS.Z) return;
    var strips = NS.Z.unpack(D.blockAnim, D.blockAnimBytes), FB = TILE * TILE * 4, off = 0;
    for (var k = 0; k < D.blockAnimMeta.length; k++) {
      var m = D.blockAnimMeta[k];
      A.anims.push({ id: m.id, layer: m.layer, frames: m.frames, interpolate: m.interpolate,
                     pix: strips.subarray(off, off + m.n * FB), frameIndex: 0, frameTicks: 0 });
      off += m.n * FB;
      if (m.frames[0][0] !== 0) A.writeTile(m.layer, A.animPix(A.anims[k], m.frames[0][0]));   // Animation.upload(): frames[0].index
    }
  };
  A.animPix = function (an, idx) { return an.pix.subarray(idx * TILE * TILE * 4, (idx + 1) * TILE * TILE * 4); };
  /** The 16x16 RGBA an animation shows right now (the frame, or the Interpolation.apply blend). */
  A.animCurrent = function (an) {
    var f = an.frames[an.frameIndex], a = A.animPix(an, f[0]);
    var nx = an.frames[(an.frameIndex + 1) % an.frames.length][0];
    if (!an.interpolate || an.frameTicks === 0 || f[0] === nx) return a;
    var b = A.animPix(an, nx), d = 1 - an.frameTicks / f[1], out = new Uint8Array(TILE * TILE * 4);
    for (var i = 0; i < out.length; i += 4) {
      out[i] = d * a[i] + (1 - d) * b[i];            // Uint8Array store truncates = Java (int) cast
      out[i + 1] = d * a[i + 1] + (1 - d) * b[i + 1];
      out[i + 2] = d * a[i + 2] + (1 - d) * b[i + 2];
      out[i + 3] = a[i + 3];                          // `& 0xFF000000` keeps the current frame's alpha
    }
    return out;
  };
  /** One client tick for every animated tile. */
  A.animTick = function () {
    for (var k = 0; k < A.anims.length; k++) {
      var an = A.anims[k], f = an.frames[an.frameIndex];
      an.frameTicks++;
      if (an.frameTicks >= f[1]) {
        an.frameIndex = (an.frameIndex + 1) % an.frames.length;
        an.frameTicks = 0;
        if (f[0] !== an.frames[an.frameIndex][0]) A.writeTile(an.layer, A.animCurrent(an));
      } else if (an.interpolate && f[0] !== an.frames[(an.frameIndex + 1) % an.frames.length][0]) {
        A.writeTile(an.layer, A.animCurrent(an));
      }
    }
  };

  /** Drain the dirty list: calls fn(tile) for each layer written since the last drain. */
  A.dynDrain = function (fn) {
    var d = A.dynDirty;
    if (!d || !d.length) return;
    A.dynDirty = [];
    for (var k = 0; k < d.length; k++) fn(d[k]);
  };

  /**
   * The canonical tile index table lives in 02_blocks.js (Blocks.T) because the mesher runs in
   * the worker bundle, where this file does not exist (D-57). This one is a private copy that
   * the generator table needs at definition time; the two must never drift, and this is where
   * that is enforced — loudly, at boot, not silently three textures later.
   */
  A.assertTileTable = function () {
    var canon = NS.Blocks.T, k;
    if (!canon) throw new Error('Atlas.build: Blocks.init() must run first');
    for (k in T) if (canon[k] !== T[k]) {
      throw new Error('atlas/blocks tile table drift: ' + k + ' is ' + T[k] + ' here, ' +
                      canon[k] + ' in Blocks.T');
    }
    for (k in canon) if (T[k] === undefined) throw new Error('atlas is missing tile ' + k);
    // LEGACY_COUNT, not TILE_COUNT: build() grows TILE_COUNT to the whole layer count, so a second build() compared 4744 with 57
    if (NS.Blocks.TILE_COUNT !== LEGACY_COUNT) {
      throw new Error('atlas/blocks TILE_COUNT drift: ' + LEGACY_COUNT + ' vs ' + NS.Blocks.TILE_COUNT);
    }
  };

  /** name -> tile index / {top,bottom,side}. Consumed by Blocks.bindAtlas. */
  A.map = function () {
    return {
      stone:       T.STONE,
      deepslate:   T.DEEPSLATE,
      dirt:        T.DIRT,
      grass_block: { top: T.GRASS_TOP, bottom: T.DIRT, side: T.GRASS_SIDE },
      sand:        T.SAND,
      gravel:      T.GRAVEL,
      water:       T.WATER,
      bedrock:     T.BEDROCK,
      oak_log:     { top: T.OAK_LOG_TOP, bottom: T.OAK_LOG_TOP, side: T.OAK_LOG_SIDE },
      oak_leaves:  T.OAK_LEAVES,
      snow_block:  T.SNOW,
      sculk:       T.SCULK,
      glowstone:   T.GLOWSTONE,
      short_grass: T.SHORT_GRASS,

      cobblestone:   T.COBBLESTONE,
      podzol:        { top: T.PODZOL_TOP, bottom: T.DIRT, side: T.PODZOL_SIDE },
      sandstone:     { top: T.SANDSTONE_TOP, bottom: T.SANDSTONE_BOTTOM, side: T.SANDSTONE_SIDE },
      oak_planks:    T.OAK_PLANKS,
      birch_log:     { top: T.BIRCH_LOG_TOP, bottom: T.BIRCH_LOG_TOP, side: T.BIRCH_LOG_SIDE },
      birch_planks:  T.BIRCH_PLANKS,
      birch_leaves:  T.BIRCH_LEAVES,
      spruce_log:    { top: T.SPRUCE_LOG_TOP, bottom: T.SPRUCE_LOG_TOP, side: T.SPRUCE_LOG_SIDE },
      spruce_planks: T.SPRUCE_PLANKS,
      spruce_leaves: T.SPRUCE_LEAVES,
      lava:          T.LAVA,
      ice:           T.ICE,
      cactus:        { top: T.CACTUS_TOP, bottom: T.CACTUS_TOP, side: T.CACTUS_SIDE },
      glass:         T.GLASS,
      torch:         T.TORCH,
      poppy:         T.POPPY,
      dandelion:     T.DANDELION,
      dead_bush:     T.DEAD_BUSH,

      coal_ore:      T.COAL_ORE,
      iron_ore:      T.IRON_ORE,
      copper_ore:    T.COPPER_ORE,
      gold_ore:      T.GOLD_ORE,
      redstone_ore:  T.REDSTONE_ORE,
      lapis_ore:     T.LAPIS_ORE,
      diamond_ore:   T.DIAMOND_ORE,
      emerald_ore:   T.EMERALD_ORE,
      deepslate_coal_ore:     T.DEEPSLATE_COAL_ORE,
      deepslate_iron_ore:     T.DEEPSLATE_IRON_ORE,
      deepslate_copper_ore:   T.DEEPSLATE_COPPER_ORE,
      deepslate_gold_ore:     T.DEEPSLATE_GOLD_ORE,
      deepslate_redstone_ore: T.DEEPSLATE_REDSTONE_ORE,
      deepslate_lapis_ore:    T.DEEPSLATE_LAPIS_ORE,
      deepslate_diamond_ore:  T.DEEPSLATE_DIAMOND_ORE,
      deepslate_emerald_ore:  T.DEEPSLATE_EMERALD_ORE
    };
  };

  /** Tile origin in normalised atlas UV. Debug/HUD only — the GPU path uses array layers. */
  A.tileUV = function (index) {
    var s = 1 / COLS;
    return { u: (index % COLS) * s, v: ((index / COLS) | 0) * s, s: s };
  };

  /**
   * One texel of a tile, as a packed 0xRRGGBB. Break particles pick a random texel from the
   * broken block's tile so the dust is the colour of the thing you broke, at the cost of one
   * array read — no extra texture, no extra upload (D-76).
   */
  A.tileTexel = function (tile, x, y) {
    if (!A.mips) return 0xB0B0B0;
    var d = A.mips[0].data;
    var i = ((tile | 0) * TILE * TILE + (y & 15) * TILE + (x & 15)) * 4;
    if (i < 0 || i + 2 >= d.length) return 0xB0B0B0;
    return (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
  };

  /** Mean colour of a tile, 0xRRGGBB. Used for the hotbar/inventory fallback swatch. */
  A.tileAvg = function (tile) {
    if (!A.mips) return 0xB0B0B0;
    var top = A.mips[A.mips.length - 1];          // the 1x1 mip IS the average
    var i = (tile | 0) * top.size * top.size * 4;
    var d = top.data;
    if (i < 0 || i + 2 >= d.length) return 0xB0B0B0;
    return (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
  };

  /** Cheap checksum of level 0, so "deterministic" is verifiable rather than asserted. */
  A.checksum = function () {
    if (!A.mips) return 0;
    var d = A.mips[0].data, h = 2166136261;
    for (var i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619); }
    return h >>> 0;
  };
})(MCL);
