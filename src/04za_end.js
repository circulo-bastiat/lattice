// 04za_end.js — the End's terrain and features. PLAN G27e (#258).
// Runs on: main thread AND workers. No DOM.
//
// A port of 1.18.2's `ChunkGeneratorSettings.createEndSettings()` through the noise chunk generator:
//
//   shape     GenerationShapeConfig.field_37139: min_y 0, height 128, size_horizontal 2 (8-wide cells), size_vertical 1
//             (4-tall cells), sampling 2/1/80/160, top slide (-23.4375, 64, -46), bottom slide (-0.234375, 7, 1).
//   density   final_density = squeeze(0.64 * interpolated(slide(end_islands + base_3d_noise)));
//             end_islands(x, z) = (TheEndBiomeSource.getNoiseAt(simplex, x/8, z/8) - 8) / 128, Java int division.
//   fill      solid -> end_stone, else air. Sea level 0, no aquifers, no ore veins, surface rule = end stone.
//
// RULING (#258): `base_3d_noise` is dropped, exactly as the overworld column drops it (04d_column.js, PLAN W0 deviation #1,
// "cheap worldgen"). It is the small +-0.1 ripple on the island surfaces; the island silhouette is the exact term.
//
// Features (all verbatim from .decomp): EndSpikeFeature (10 pillars, cage, crystal spec), EndPortalFeature (the podium),
// EndGatewayFeature, ChorusPlantFeature + ChorusFlowerBlock.generate. They write through a tiny world handle
// `{ get(x,y,z) -> state, set(x,y,z,state) }` so a chunk buffer, the live world and a check all drive the same code.
(function (NS) {
  'use strict';

  var E = NS.EndTerrain = {};
  var N = NS.Noise;

  E.MIN_Y = 0; E.HEIGHT = 128; E.SEA = 0;
  var CW = 8, CH = 4, NCX = 2, NCY = 32;           // cell width/height in blocks, cells per chunk side / per column
  function lerp(t, a, b) { return a + t * (b - a); }
  function clampedLerp(a, b, t) { return t < 0 ? a : t > 1 ? b : lerp(t, a, b); }

  var S = null;
  E.init = function (seed) {
    if (!N || !NS.States || !NS.States.ready) throw new Error('EndTerrain.init before the registry decoded');
    seed = BigInt.asIntN(64, BigInt(seed));
    if (S && S.seed === seed) return E;
    var st = function (n) { var s = NS.States.stateOf(n); if (!s) throw new Error('EndTerrain: no block ' + n); return s; };
    // EndIslands(0L): the island noise is seeded with 0, NOT the world seed (DensityFunctionTypes.endIslands(0L)).
    S = {
      seed: seed, src: NS.BiomeDims.endSource(0n),
      B: { air: 0, end_stone: st('end_stone'), obsidian: st('obsidian'), bedrock: st('bedrock'), iron_bars: st('iron_bars'),
           fire: st('fire'), wall_torch: st('wall_torch'), end_gateway: st('end_gateway'), chorus_plant: st('chorus_plant'),
           chorus_flower: st('chorus_flower'), end_portal: st('end_portal') },
    };
    return E;
  };
  E.state = function () { return S; };

  /** DensityFunctionTypes.EndIslands.sample at block (x, z); Java `/ 8` truncates toward zero. */
  E.islands = function (x, z) {
    return (NS.BiomeDims.endNoiseAt(S.src.noise, Math.trunc(x / 8), Math.trunc(z / 8)) - 8.0) / 128.0;
  };

  function slideOne(target, size, offset, v, d) {
    if (size <= 0) return v;
    return clampedLerp(target, v, (d - offset) / size);
  }
  /** the post-slide density at cell corner (cellY in 0..NCY) given the raw value `v` */
  E.slide = function (v, cellY) {
    v = slideOne(-23.4375, 64, -46, v, NCY - cellY);   // top slide (size/offset are in blocks, vanilla's Slide uses cells here)
    return slideOne(-0.234375, 7, 1, v, cellY);
  };

  /** the density grid for a chunk: Float64Array[3*3*33], index ((i*3)+k)*33 + j for cell x i, z k, y j. */
  E.corners = function (chunkX, chunkZ) {
    var g = new Float64Array(3 * 3 * (NCY + 1)), i, k, j;
    for (i = 0; i <= NCX; i++) for (k = 0; k <= NCX; k++) {
      var isl = E.islands((chunkX * NCX + i) * CW, (chunkZ * NCX + k) * CW);
      for (j = 0; j <= NCY; j++) g[(i * 3 + k) * (NCY + 1) + j] = E.slide(isl, j);
    }
    return g;
  };

  E.densityAt = function (g, x, y, z) {
    var i = x >> 3, k = z >> 3, j = y >> 2, fy = (y & 3) / 4, fx = (x & 7) / 8, fz = (z & 7) / 8, W = NCY + 1;
    var c = function (a, b, e) { return g[((i + a) * 3 + (k + b)) * W + j + e]; };
    var x0z0 = lerp(fy, c(0, 0, 0), c(0, 0, 1)), x1z0 = lerp(fy, c(1, 0, 0), c(1, 0, 1));
    var x0z1 = lerp(fy, c(0, 1, 0), c(0, 1, 1)), x1z1 = lerp(fy, c(1, 1, 0), c(1, 1, 1));
    return lerp(fz, lerp(fx, x0z0, x1z0), lerp(fx, x0z1, x1z1));
  };

  var IDX = function (x, y, z) { return (y << 8) | (z << 4) | x; };
  E.IDX = IDX;

  /** Uint16Array(16*128*16) indexed (y<<8)|(z<<4)|x for world y 0..127: end stone where density*0.64 > 0, else air. */
  E.fillTerrain = function (chunkX, chunkZ) {
    var B = S.B, out = new Uint16Array(16 * 128 * 16), g = E.corners(chunkX, chunkZ), x, y, z;
    for (y = 0; y < 128; y++) for (z = 0; z < 16; z++) for (x = 0; x < 16; x++)
      if (E.densityAt(g, x, y, z) * 0.64 > 0) out[IDX(x, y, z)] = B.end_stone;
    return out;
  };

  /** the End biome at block (x, z) (TheEndBiomeSource) */
  E.biomeAt = function (x, z) { return S.src.biomeAt(x, 0, z); };

  E.generate = function (chunkX, chunkZ) {
    var blocks = E.fillTerrain(chunkX, chunkZ), biomes = new Array(256);
    for (var z = 0; z < 16; z++) for (var x = 0; x < 16; x++) biomes[z * 16 + x] = E.biomeAt(chunkX * 16 + x, chunkZ * 16 + z);
    return { blocks: blocks, biomes: biomes };
  };

  // ── block-state helpers ───────────────────────────────────────────────────────────────────────
  function prop(state, name, value) {
    var R = NS.Reg;
    return NS.States.withProp(state, R.PROP[name], R.PVAL[String(value)]);
  }

  // ── EndSpikeFeature ───────────────────────────────────────────────────────────────────────────
  /** EndSpikeFeature.getSpikes: new Random(seed).nextLong() & 65535 keys SpikeCache (Collections.shuffle of 0..9). */
  E.spikes = function (seed) {
    var r = new N.LegacyRandom(BigInt.asIntN(64, BigInt(seed)));
    r.next(32);                                       // nextLong()'s high word never reaches the low 16 bits
    var sr = new N.LegacyRandom(r.next(32) & 0xFFFF), ids = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], out = [], i;
    for (i = ids.length; i > 1; i--) { var j = sr.nextInt(i), t = ids[i - 1]; ids[i - 1] = ids[j]; ids[j] = t; }
    for (i = 0; i < 10; i++) {
      var idx = ids[i];
      out.push({
        centerX: Math.floor(42.0 * Math.cos(2.0 * (-Math.PI + (Math.PI / 10) * i))),
        centerZ: Math.floor(42.0 * Math.sin(2.0 * (-Math.PI + (Math.PI / 10) * i))),
        radius: 2 + Math.floor(idx / 3), height: 76 + idx * 3, guarded: idx === 1 || idx === 2,
      });
    }
    return out;
  };

  /**
   * EndSpikeFeature.generateSpike. `w` = { get, set, bottomY? }; `box` (optional) = {x0,x1,z0,z1} clips the write to a chunk.
   * Returns the crystal spec the caller spawns: { x, y, z, invulnerable:false, beamTarget } (vanilla's end_spike configured
   * feature leaves beamTarget empty, crystalInvulnerable false; the dragon fight's own call passes both).
   */
  E.generateSpike = function (w, spike, box, cfg) {
    var B = S.B, r = spike.radius, bottom = w.bottomY != null ? w.bottomY : -64, x, y, z;
    var set = function (X, Y, Z, s) { if (!box || (X >= box.x0 && X <= box.x1 && Z >= box.z0 && Z <= box.z1)) w.set(X, Y, Z, s); };
    for (x = spike.centerX - r; x <= spike.centerX + r; x++)
      for (y = bottom; y <= spike.height + 10; y++)
        for (z = spike.centerZ - r; z <= spike.centerZ + r; z++) {
          var d2 = (x - spike.centerX) * (x - spike.centerX) + (z - spike.centerZ) * (z - spike.centerZ);
          if (d2 <= r * r + 1 && y < spike.height) set(x, y, z, B.obsidian);
          else if (y > 65) set(x, y, z, 0);
        }
    if (spike.guarded) {
      for (var dx = -2; dx <= 2; dx++) for (var dz = -2; dz <= 2; dz++) for (var dy = 0; dy <= 3; dy++) {
        var ax = Math.abs(dx) === 2, az = Math.abs(dz) === 2, top = dy === 3;
        if (!(ax || az || top)) continue;
        var ew = dx === -2 || dx === 2 || top, ns = dz === -2 || dz === 2 || top;
        var s = B.iron_bars;
        s = prop(s, 'north', ew && dz !== -2); s = prop(s, 'south', ew && dz !== 2);
        s = prop(s, 'west', ns && dx !== -2); s = prop(s, 'east', ns && dx !== 2);
        set(spike.centerX + dx, spike.height + dy, spike.centerZ + dz, s);
      }
    }
    set(spike.centerX, spike.height, spike.centerZ, B.bedrock);
    return { x: spike.centerX + 0.5, y: spike.height + 1, z: spike.centerZ + 0.5,
             invulnerable: !!(cfg && cfg.crystalInvulnerable), beamTarget: (cfg && cfg.beamTarget) || null };
  };

  /** EndSpikeFeature.generate for the chunk containing `origin` (a spike whose centre chunk it is). */
  E.generateSpikesInChunk = function (w, worldSeed, chunkX, chunkZ, cfg) {
    var out = [], sp = E.spikes(worldSeed);
    for (var i = 0; i < sp.length; i++)
      if ((sp[i].centerX >> 4) === chunkX && (sp[i].centerZ >> 4) === chunkZ)
        out.push(E.generateSpike(w, sp[i], null, cfg));
    return out;
  };

  // ── EndPortalFeature (the podium / exit portal) ───────────────────────────────────────────────
  var HDIR = [['north', 0, -1], ['east', 1, 0], ['south', 0, 1], ['west', -1, 0]];
  /** EndPortalFeature.generate at origin (ox,oy,oz); `open` is the portal-filled variant (the dragon's exit portal). */
  E.generatePortal = function (w, ox, oy, oz, open) {
    var B = S.B, x, y, z;
    for (x = ox - 4; x <= ox + 4; x++) for (y = oy - 1; y <= oy + 32; y++) for (z = oz - 4; z <= oz + 4; z++) {
      var d2 = (x - ox) * (x - ox) + (y - oy) * (y - oy) + (z - oz) * (z - oz);
      var near = d2 <= 2.5 * 2.5, far = d2 <= 3.5 * 3.5;   // isWithinDistance(origin, 2.5 / 3.5)
      if (!(near || far)) continue;
      if (y < oy) w.set(x, y, z, near ? B.bedrock : B.end_stone);
      else if (y > oy) w.set(x, y, z, 0);
      else if (!near) w.set(x, y, z, B.bedrock);
      else w.set(x, y, z, open ? B.end_portal : 0);
    }
    for (var i = 0; i < 4; i++) w.set(ox, oy + i, oz, B.bedrock);
    for (var d = 0; d < 4; d++)
      w.set(ox + HDIR[d][1], oy + 2, oz + HDIR[d][2], prop(B.wall_torch, 'facing', HDIR[d][0]));
  };

  // ── EndGatewayFeature ─────────────────────────────────────────────────────────────────────────
  /** the 3x5x3 gateway; returns the centre position (the block entity's exit data is the caller's) */
  E.generateGateway = function (w, ox, oy, oz) {
    var B = S.B;
    for (var x = ox - 1; x <= ox + 1; x++) for (var y = oy - 2; y <= oy + 2; y++) for (var z = oz - 1; z <= oz + 1; z++) {
      var cx = x === ox, cy = y === oy, cz = z === oz, e2 = Math.abs(y - oy) === 2;
      if (cx && cy && cz) w.set(x, y, z, B.end_gateway);
      else if (cy) w.set(x, y, z, 0);
      else if (e2 && cx && cz) w.set(x, y, z, B.bedrock);
      else if ((cx || cz) && !e2) w.set(x, y, z, B.bedrock);
      else w.set(x, y, z, 0);
    }
    return { x: ox, y: oy, z: oz };
  };

  // ── ChorusPlantFeature / ChorusFlowerBlock.generate ───────────────────────────────────────────
  function chorusState(w, x, y, z) {                 // ChorusPlantBlock.withConnectionProperties
    var B = S.B, s = B.chorus_plant, is = function (b, plant, flower, stone) {
      return (plant && b === B.chorus_plant) || (flower && b === B.chorus_flower) || (stone && b === B.end_stone);
    };
    s = prop(s, 'down', is(w.get(x, y - 1, z), 1, 1, 1));
    s = prop(s, 'up', is(w.get(x, y + 1, z), 1, 1, 0));
    s = prop(s, 'north', is(w.get(x, y, z - 1), 1, 1, 0));
    s = prop(s, 'east', is(w.get(x + 1, y, z), 1, 1, 0));
    s = prop(s, 'south', is(w.get(x, y, z + 1), 1, 1, 0));
    return prop(s, 'west', is(w.get(x - 1, y, z), 1, 1, 0));
  }
  function surroundedByAir(w, x, y, z, ex) {         // ex = excluded horizontal index or -1
    for (var d = 0; d < 4; d++) if (d !== ex && w.get(x + HDIR[d][1], y, z + HDIR[d][2]) !== 0) return false;
    return true;
  }
  function chorusGen(w, rnd, x, y, z, ox, oz, maxR, depth) {
    var B = S.B, h = rnd.nextInt(4) + 1, i;
    if (depth === 0) h++;
    for (i = 0; i < h; i++) {
      if (!surroundedByAir(w, x, y + i + 1, z, -1)) return;
    }
    for (i = 0; i < h; i++) {
      w.set(x, y + i + 1, z, chorusState(w, x, y + i + 1, z));
      w.set(x, y + i, z, chorusState(w, x, y + i, z));
    }
    var branched = false;
    if (depth < 4) {
      var n = rnd.nextInt(4);
      if (depth === 0) n++;
      for (var k = 0; k < n; k++) {
        var d = rnd.nextInt(4), bx = x + HDIR[d][1], by = y + h, bz = z + HDIR[d][2], opp = (d + 2) & 3;
        if (Math.abs(bx - ox) < maxR && Math.abs(bz - oz) < maxR && w.get(bx, by, bz) === 0 && w.get(bx, by - 1, bz) === 0 &&
            surroundedByAir(w, bx, by, bz, opp)) {
          branched = true;
          w.set(bx, by, bz, chorusState(w, bx, by, bz));
          var ax = bx + HDIR[opp][1], az = bz + HDIR[opp][2];
          w.set(ax, by, az, chorusState(w, ax, by, az));
          chorusGen(w, rnd, bx, by, bz, ox, oz, maxR, depth + 1);
        }
      }
    }
    if (!branched) w.set(x, y + h, z, prop(B.chorus_flower, 'age', 5));
  }
  /** ChorusPlantFeature.generate at (x,y,z): needs air there and end stone below; r=8. Returns whether it grew. */
  E.generateChorus = function (w, rnd, x, y, z) {
    if (w.get(x, y, z) !== 0 || w.get(x, y - 1, z) !== S.B.end_stone) return false;
    w.set(x, y, z, chorusState(w, x, y, z));
    chorusGen(w, rnd, x, y, z, x, z, 8, 0);
    return true;
  };
})(typeof MCL !== 'undefined' ? MCL : this.MCL);
