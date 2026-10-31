// 04yn_nether_terrain.js — the Nether's terrain, bedrock and surface. PLAN G27c (#256).
// Runs on: main thread AND workers. No DOM.
//
// A port of 1.18.2's `ChunkGeneratorSettings.createNetherSettings()` through the noise chunk generator:
//
//   shape      GenerationShapeConfig.field_37138: min_y 0, height 128, size_horizontal 1 (4-wide cells),
//              size_vertical 2 (8-tall cells), sampling 1/3/80/60, top slide (0.9375, 3, 0),
//              bottom slide (2.5, 4, -1), terrain shaper all-zero.
//   density    DensityFunctions.method_41211: final_density = squeeze(0.64 * interpolated(slide(
//              overworld/sloped_cheese))). With the Nether's all-zero terrain shaper the factor is 0, so
//              sloped_cheese is exactly `old_blended_noise` (InterpolatedNoiseSampler) — the pre-1.18 3D noise,
//              on a LEGACY java.util.Random seeded with the world seed (legacy_random_source: true).
//              `squeeze` and `* 0.64` keep the sign, and a block is solid iff the density is > 0.
//   fill       solid -> netherrack; else y < sea level 32 -> lava (AquiferSampler.seaLevel); else air.
//              No aquifers, no ore veins, no noodle caves (the router zeroes them).
//   surface    VanillaSurfaceRules.createNetherSurfaceRule, ported by hand (it is 40 lines, and the overworld's
//              interpreter assumes a single run of stone per column, which the Nether does not have).
//   biomes     MultiNoiseBiomeSource.Preset.NETHER (04y_biome_dims.js) fed by the legacy temperature/humidity
//              noises (DoublePerlinNoiseSampler.createLegacy, firstOctave -7, [1,1], seeded seed and seed+1).
//
// RULING (#256): the biome under a surface rule is read from the 4x4 quart cell of the block, not through
// BiomeAccess's SHA-256 voronoi zoom — the cell edges can differ from the real game by up to two blocks
// (worldgen is the "cheap" half of the charter).
//
// NOT here (own issues): the Nether carver, features, structures, and the dispatch from `WG.generate` on
// `Dim.current()`. This module hands back the block column array and the biome grid.
(function (NS) {
  'use strict';

  var T = NS.NetherTerrain = {};
  var N = NS.Noise;

  T.MIN_Y = 0; T.HEIGHT = 128; T.SEA = 32;
  var CW = 4, CH = 8;                       // cell width / height in blocks
  var NCX = 4, NCY = 16;                    // cells per chunk side / per column
  var fr = Math.fround;

  function javaHash(s) {                    // String.hashCode
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
    return h;
  }
  function lerp(t, a, b) { return a + t * (b - a); }
  function clampedLerp(a, b, t) { return t < 0 ? a : t > 1 ? b : lerp(t, a, b); }
  function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function maintain(v) { return v - Math.floor(v / 3.3554432E7 + 0.5) * 3.3554432E7; }
  T.javaHash = javaHash;

  // ── Improved noise with Mojang's y-smear (PerlinNoiseSampler.sample(x,y,z,yScale,yMax)) ───────
  function smear(imp, x, y, z, yScale, yMax) {
    var d = x + imp.xo, e = y + imp.yo, f = z + imp.zo;
    var i = Math.floor(d), j = Math.floor(e), k = Math.floor(f);
    var gx = d - i, gy = e - j, gz = f - k, gy0 = gy;
    if (yScale !== 0) {
      var m = (yMax >= 0 && yMax < gy) ? yMax : gy;
      gy = gy - Math.floor(m / yScale + fr(1.0E-7)) * yScale;
    } else gy = gy - 0;
    var p = imp.perm.bind(imp), G = N.gradDot;
    var a0 = p(i), a1 = p(i + 1);
    var b00 = p(a0 + j), b01 = p(a0 + j + 1), b10 = p(a1 + j), b11 = p(a1 + j + 1);
    var d000 = G(p(b00 + k), gx, gy, gz), d100 = G(p(b10 + k), gx - 1, gy, gz);
    var d010 = G(p(b01 + k), gx, gy - 1, gz), d110 = G(p(b11 + k), gx - 1, gy - 1, gz);
    var d001 = G(p(b00 + k + 1), gx, gy, gz - 1), d101 = G(p(b10 + k + 1), gx - 1, gy, gz - 1);
    var d011 = G(p(b01 + k + 1), gx, gy - 1, gz - 1), d111 = G(p(b11 + k + 1), gx - 1, gy - 1, gz - 1);
    var u = fade(gx), v = fade(gy0), w = fade(gz);
    var l0 = lerp(v, lerp(u, d000, d100), lerp(u, d010, d110));
    var l1 = lerp(v, lerp(u, d001, d101), lerp(u, d011, d111));
    return lerp(w, l0, l1);
  }
  T._smear = smear;

  // ── the legacy octave stack: OctavePerlinNoiseSampler.createLegacy(random, rangeClosed(-n+1, 0)) ─
  // Octave 0 (the highest frequency) is created first, then -1, -2 ...; getOctave(i) is the i-th created.
  function legacyOctaves(rnd, n) {
    var o = [];
    for (var i = 0; i < n; i++) o.push(new N.Improved(rnd));
    return o;
  }

  function Blended(rnd) {
    this.lower = legacyOctaves(rnd, 16);
    this.upper = legacyOctaves(rnd, 16);
    this.main = legacyOctaves(rnd, 8);
    this.xz = 684.412 * 1.0;                 // xz_scale 1.0
    this.y = 684.412 * 3.0;                  // y_scale 3.0
    this.xzMain = this.xz / 80.0;            // xz_factor
    this.yMain = this.y / 60.0;              // y_factor
  }
  T.Blended = Blended;

  /** InterpolatedNoiseSampler.sample at a CELL corner (cx, cy, cz are cell indices, floorDiv'd already). */
  Blended.prototype.sample = function (cx, cy, cz) {
    var main = 0, f = 1, i;
    for (i = 0; i < 8; i++) {
      var o = this.main[i];
      main += smear(o, maintain(cx * this.xzMain * f), maintain(cy * this.yMain * f), maintain(cz * this.xzMain * f),
        this.yMain * f, cy * this.yMain * f) / f;
      f /= 2;
    }
    var t = (main / 10.0 + 1.0) / 2.0, noLow = t >= 1.0, noUp = t <= 0.0, lo = 0, up = 0;
    f = 1;
    for (i = 0; i < 16; i++) {
      var x = maintain(cx * this.xz * f), y = maintain(cy * this.y * f), z = maintain(cz * this.xz * f), ys = this.y * f;
      if (!noLow) lo += smear(this.lower[i], x, y, z, ys, cy * ys) / f;
      if (!noUp) up += smear(this.upper[i], x, y, z, ys, cy * ys) / f;
      f /= 2;
    }
    return clampedLerp(lo / 512.0, up / 512.0, t) / 128.0;
  };

  // ── DensityFunctionTypes.Slide with the Nether's two SlideConfigs ───────────────────────────
  function slideOne(target, size, offset, v, d) {
    if (size <= 0) return v;
    return clampedLerp(target, v, (d - offset) / size);
  }
  /** the density at cell corner (cellY in 0..16) given the raw noise value `v` */
  T.slide = function (v, cellY) {
    v = slideOne(0.9375, 3, 0, v, NCY - cellY);       // top slide: verticalBlockCount - cellY
    return slideOne(2.5, 4, -1, v, cellY);             // bottom slide
  };

  // ── DoublePerlinNoiseSampler.createLegacy / create, over a java.util.Random ───────────────────
  function legacyRnd(seed) {
    var r = new N.LegacyRandom(seed);
    r.forkPositional = function () {                  // AtomicSimpleRandom.createRandomDeriver
      var s = r.nextLong();
      return { fromHashOf: function (name) { return new N.LegacyRandom(BigInt(javaHash(name)) ^ s); } };
    };
    r.skip = function (n) { for (var i = 0; i < n; i++) r.next(32); };
    return r;
  }
  /** OctavePerlinNoiseSampler(random, firstOctave -7, [1,1], legacy): octave 0 of the 8 is made and thrown away. */
  function legacyBiomeNoise(seed) {
    var make = function (rnd) {
      var amps = [1, 1], first = -7, P = Object.create(N.Perlin.prototype);
      P.levels = [null, null];
      new N.Improved(rnd);                              // $$8: constructed first, never stored (index 7 >= 2)
      for (var i = -first - 1; i >= 0; i--) {
        if (i < amps.length) P.levels[i] = new N.Improved(rnd);
        else rnd.skip(262);
      }
      P.amps = amps; P.inputFactor = Math.pow(2, first);
      P.valueFactor = Math.pow(2, amps.length - 1) / (Math.pow(2, amps.length) - 1);
      return P;
    };
    var rnd = legacyRnd(seed), nz = Object.create(N.Normal.prototype);
    nz.first = make(rnd); nz.second = make(rnd);
    nz.valueFactor = (1 / 6) / N.expectedDeviation(1);
    return nz;
  }
  T._legacyBiomeNoise = legacyBiomeNoise;

  function surfaceNoise(dseed, id, params) {            // NoiseParametersKeys.createNoiseSampler with the legacy deriver
    var r = new N.LegacyRandom(BigInt(javaHash('minecraft:' + id)) ^ dseed);
    r.forkPositional = function () {
      var s = r.nextLong();
      return { fromHashOf: function (name) { return new N.LegacyRandom(BigInt(javaHash(name)) ^ s); } };
    };
    return new N.Normal(r, params.firstOctave, params.amplitudes);
  }

  // ── init ─────────────────────────────────────────────────────────────────────────────────────
  var S = null;
  T.init = function (seed) {
    if (!N || !NS.States || !NS.States.ready) throw new Error('NetherTerrain.init before the registry decoded');
    seed = BigInt.asIntN(64, BigInt(seed));
    if (S && S.seed === seed) return T;
    var st = function (n) { var s = NS.States.stateOf(n); if (!s) throw new Error('NetherTerrain: no block ' + n); return s; };
    var root = legacyRnd(seed);
    var dseed = root.nextLong();                          // SurfaceBuilder's RandomDeriver(LegacyRandom(seed).nextLong())
    var names = ['surface', 'soul_sand_layer', 'gravel_layer', 'patch', 'netherrack', 'nether_wart', 'nether_state_selector'];
    var ns = {};
    names.forEach(function (n) {
      var p = NS.WG.get('noise', n);
      if (!p) throw new Error('worldgen/noise/' + n + ' is missing');
      ns[n] = surfaceNoise(dseed, n, p);
    });
    var gr = function (id) {                              // getRandomDeriver(id): derive from createRandom(id)
      var r = new N.LegacyRandom(BigInt(javaHash('minecraft:' + id)) ^ dseed);
      return r.nextLong();
    };
    S = {
      seed: seed, dseed: dseed, blended: new Blended(legacyRnd(seed)), noise: ns,
      temp: legacyBiomeNoise(seed), humid: legacyBiomeNoise(seed + 1n),
      floorSeed: gr('bedrock_floor'), roofSeed: gr('bedrock_roof'),
      B: {
        air: 0, netherrack: st('netherrack'), lava: st('lava'), bedrock: st('bedrock'), basalt: st('basalt'),
        blackstone: st('blackstone'), gravel: st('gravel'), soul_sand: st('soul_sand'), soul_soil: st('soul_soil'),
        warped_nylium: st('warped_nylium'), warped_wart: st('warped_wart_block'),
        crimson_nylium: st('crimson_nylium'), nether_wart: st('nether_wart_block'),
      },
      cache: Object.create(null),
    };
    return T;
  };
  T.state = function () { return S; };

  // ── biomes ────────────────────────────────────────────────────────────────────────────────────
  /** biome name at quart cell (qx, qz): temperature/humidity from the legacy noises at (qx, 0, qz). */
  T.biomeQuart = function (qx, qz) {
    return NS.BiomeDims.netherBiome(S.temp.get(qx, 0, qz), S.humid.get(qx, 0, qz), 0, 0, 0, 0);
  };
  T.biomeAt = function (x, z) { return T.biomeQuart(x >> 2, z >> 2); };

  // ── terrain ───────────────────────────────────────────────────────────────────────────────────
  /** corner density (post-slide) at cell indices; cells are cached per chunk call */
  function corner(cx, cy, cz) {
    return T.slide(S.blended.sample(cx, cy, cz), cy);
  }

  /**
   * density grid for the chunk: Float64Array[(NCX+1)*(NCX+1)*(NCY+1)], index ((i*5)+k)*17 + j for cell x i, z k, y j.
   */
  T.corners = function (chunkX, chunkZ) {
    var g = new Float64Array(5 * 5 * 17), i, k, j;
    for (i = 0; i <= NCX; i++) for (k = 0; k <= NCX; k++) for (j = 0; j <= NCY; j++)
      g[(i * 5 + k) * 17 + j] = corner(chunkX * NCX + i, j, chunkZ * NCX + k);
    return g;
  };

  /** the interpolated density at block (x,y,z) of the chunk, vanilla's order: Y, then X, then Z (ChunkNoiseSampler) */
  T.densityAt = function (g, x, y, z) {
    var i = x >> 2, k = z >> 2, j = y >> 3, fy = (y & 7) / 8, fx = (x & 3) / 4, fz = (z & 3) / 4;
    var c = function (a, b, e) { return g[((i + a) * 5 + (k + b)) * 17 + j + e]; };
    var x0z0 = lerp(fy, c(0, 0, 0), c(0, 0, 1)), x1z0 = lerp(fy, c(1, 0, 0), c(1, 0, 1));
    var x0z1 = lerp(fy, c(0, 1, 0), c(0, 1, 1)), x1z1 = lerp(fy, c(1, 1, 0), c(1, 1, 1));
    return lerp(fz, lerp(fx, x0z0, x1z0), lerp(fx, x0z1, x1z1));
  };

  var IDX = function (x, y, z) { return (y << 8) | (z << 4) | x; };
  T.IDX = IDX;

  /**
   * fillChunk(cx, cz) -> { blocks: Uint16Array(16*128*16) indexed (y<<8)|(z<<4)|x for world y 0..127,
   *                        biomes: string[16*16] per column (z*16+x) }
   * Terrain + sea only; run `surface` next.
   */
  T.fillTerrain = function (chunkX, chunkZ) {
    var B = S.B, out = new Uint16Array(16 * 128 * 16), g = T.corners(chunkX, chunkZ), x, y, z;
    for (y = 0; y < 128; y++) for (z = 0; z < 16; z++) for (x = 0; x < 16; x++)
      out[IDX(x, y, z)] = T.densityAt(g, x, y, z) * 0.64 > 0 ? B.netherrack : (y < T.SEA ? B.lava : B.air);
    return out;
  };

  // ── surface rules (createNetherSurfaceRule) ───────────────────────────────────────────────────
  function gradientBelow(seed, x, y, z, trueAt, falseAt) {   // VerticalGradientMaterialCondition
    if (y <= trueAt) return true;
    if (y >= falseAt) return false;
    var p = 1 + (y - trueAt) * (0 - 1) / (falseAt - trueAt);
    var r = new N.LegacyRandom(BigInt.asIntN(64, N.positionSeed(x, y, z)) ^ seed);
    return r.nextFloat() < p;
  }

  /** the surface rule for one solid default block; ctx is a plain object, returns a state or 0 for "no rule" */
  T.surfaceRule = function (c) {
    var B = S.B, y = c.y;
    var aboveY = function (a, withDepth) { return y + (withDepth ? c.above : 0) >= a; };
    var hole = c.run <= 0, y30 = aboveY(30, true), n35 = !aboveY(35, true);
    var nz = c.noise;
    if (gradientBelow(S.floorSeed, c.x, y, c.z, 0, 5)) return B.bedrock;
    if (!gradientBelow(S.roofSeed, c.x, y, c.z, 122, 127)) return B.bedrock;
    if (y >= 122) return B.netherrack;
    var gravel12 = (nz('patch') >= -0.012 && y30 && n35) ? B.gravel : 0;
    var floorD = c.above <= 1 + c.run, ceilD = c.below <= 1 + c.run;
    switch (c.biome) {
      case 'basalt_deltas':
        if (ceilD) return B.basalt;
        if (floorD) return gravel12 || (nz('nether_state_selector') >= 0 ? B.basalt : B.blackstone);
        break;
      case 'soul_sand_valley':
        if (ceilD) return nz('nether_state_selector') >= 0 ? B.soul_sand : B.soul_soil;
        if (floorD) return gravel12 || (nz('nether_state_selector') >= 0 ? B.soul_sand : B.soul_soil);
        break;
    }
    if (c.above <= 1) {                                     // STONE_DEPTH_FLOOR
      if (y < 32 && hole) return B.lava;
      if (c.biome === 'warped_forest' && !(nz('netherrack') >= 0.54) && y >= 31)
        return nz('nether_wart') >= 1.17 ? B.warped_wart : B.warped_nylium;
      if (c.biome === 'crimson_forest' && !(nz('netherrack') >= 0.54) && y >= 31)
        return nz('nether_wart') >= 1.17 ? B.nether_wart : B.crimson_nylium;
    }
    if (c.biome === 'nether_wastes') {
      if (floorD && nz('soul_sand_layer') >= -0.012)
        return (!hole && y30 && n35) ? B.soul_sand : B.netherrack;
      if (c.above <= 1 && y >= 31 && n35 && nz('gravel_layer') >= -0.012) {
        if (y >= 32) return B.gravel;
        if (!hole) return B.gravel;
      }
    }
    return B.netherrack;
  };

  /** SurfaceBuilder.buildSurface over a filled chunk, in place. `biomes` (optional) receives the column biome names. */
  T.buildSurface = function (blocks, chunkX, chunkZ, biomes) {
    var B = S.B, x, z, y;
    for (z = 0; z < 16; z++) for (x = 0; x < 16; x++) {
      var wx = chunkX * 16 + x, wz = chunkZ * 16 + z;
      var run = Math.trunc(S.noise.surface.get(wx, 0, wz) * 2.75 + 3.0 +
        new N.LegacyRandom(BigInt.asIntN(64, N.positionSeed(wx, 0, wz)) ^ S.dseed).nextDouble() * 0.25);
      var biome = T.biomeAt(wx, wz), memo = Object.create(null);
      if (biomes) biomes[z * 16 + x] = biome;
      var nz = function (n) { var v = memo[n]; return v === undefined ? (memo[n] = S.noise[n].get(wx, 0, wz)) : v; };
      var above = 0, fluidTop = -1e9, floorY = 1e9;   // $$24 starts at Integer.MAX_VALUE
      for (y = 127; y >= 0; y--) {
        var s = blocks[IDX(x, y, z)];
        if (s === 0) { above = 0; fluidTop = -1e9; continue; }
        if (s === B.lava) { if (fluidTop === -1e9) fluidTop = y + 1; continue; }
        if (floorY >= y) {
          floorY = 0;
          for (var j = y - 1; j >= 0; j--) if (blocks[IDX(x, j, z)] !== B.netherrack) { floorY = j + 1; break; }
        }
        above++;
        if (s === B.netherrack) {
          var r = T.surfaceRule({ x: wx, y: y, z: wz, run: run, above: above, below: y - floorY + 1, fluid: fluidTop, biome: biome, noise: nz });
          if (r) blocks[IDX(x, y, z)] = r;
        }
      }
    }
    return blocks;
  };

  /** the whole column set for a chunk: terrain, sea, bedrock, surface. */
  T.generate = function (chunkX, chunkZ) {
    var blocks = T.fillTerrain(chunkX, chunkZ), biomes = new Array(256);
    T.buildSurface(blocks, chunkX, chunkZ, biomes);
    return { blocks: blocks, biomes: biomes };
  };
})(typeof MCL !== 'undefined' ? MCL : this.MCL);
