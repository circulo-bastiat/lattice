// 04z_struct_end_city.js — the End City's piece layout (#4560, part of #4552).
// Runs on: main thread AND workers. No DOM.
//
// PORTED LINE FOR LINE from .decomp/net/minecraft/structure/EndCityGenerator.java: the four Parts
// (BUILDING, SMALL_TOWER, BRIDGE_PIECE, FAT_TOWER), createPiece/createPart/addPieces, the chainLength
// intersection test. This is the LAYOUT only: each piece is `{name, ow, rot, x,y,z, bb, chain}` (template
// name under end_city/, ignore-air flag, rotation 0..3 = NONE/CW90/CW180/CCW90, template position, box).
// Blocks, and the structure_block metadata (Chest/Sentry/Elytra) the templates carry, are the writer's.
//
// `sizeOf(name) -> [sx,sy,sz]` is the template size (Templates, or a table in a check); the rng is any
// object with next(bits) / nextInt([bound]) (N.LegacyRandom).
(function (NS) {
  'use strict';

  var EC = NS.EndCity = {};

  // StructureTemplate.transformAround about a (0,0,0) pivot, no mirror: rot 1 = CW90 (x,z)->(-z,x), 3 = CCW90.
  function rotXZ(r, x, z) {
    switch (r & 3) { case 1: return [-z, x]; case 2: return [-x, -z]; case 3: return [z, -x]; default: return [x, z]; }
  }
  function intersects(a, b) {
    return a[3] >= b[0] && a[0] <= b[3] && a[5] >= b[2] && a[2] <= b[5] && a[4] >= b[1] && a[1] <= b[4];
  }

  /**
   * generate(rng, x, y, z, rot, sizeOf) -> piece list. (x,y,z) is EndCityFeature's start BlockPos.
   */
  EC.generate = function (rng, x, y, z, rot, sizeOf) {
    var shipGenerated = false;

    // SimpleStructurePiece: box = template box transformed by rot, then moved to pos.
    function make(name, px, py, pz, r, ow) {
      var s = sizeOf(name), c = rotXZ(r, s[0] - 1, s[2] - 1);
      var p = { name: name, ow: ow, rot: r & 3, x: px, y: py, z: pz, chain: 0, bb: null, sx: c[0], sz: c[1], sy: s[1] };
      bbOf(p);
      return p;
    }
    function bbOf(p) {
      p.bb = [Math.min(0, p.sx) + p.x, p.y, Math.min(0, p.sz) + p.z, Math.max(0, p.sx) + p.x, p.y + p.sy - 1, Math.max(0, p.sz) + p.z];
    }
    function createPiece(parent, off, name, r, ow) {
      var p = make(name, parent.x, parent.y, parent.z, r, ow);
      var o = rotXZ(parent.rot, off[0], off[2]);      // transformBox(parent data, off, new data, ORIGIN)
      p.x += o[0]; p.y += off[1]; p.z += o[1];
      bbOf(p);
      return p;
    }
    function add(list, p) { list.push(p); return p; }
    function rotate(a, b) { return (a + b) & 3; }

    var BUILDING = function (depth, parent, list, pos) {
      if (depth > 8) return false;
      var r = parent.rot, p = add(list, createPiece(parent, pos, 'base_floor', r, true)), k = rng.nextInt(3);
      if (k === 0) {
        add(list, createPiece(p, [-1, 4, -1], 'base_roof', r, true));
      } else if (k === 1) {
        p = add(list, createPiece(p, [-1, 0, -1], 'second_floor_2', r, false));
        p = add(list, createPiece(p, [-1, 8, -1], 'second_roof', r, false));
        createPart(SMALL_TOWER, depth + 1, p, null, list);
      } else {
        p = add(list, createPiece(p, [-1, 0, -1], 'second_floor_2', r, false));
        p = add(list, createPiece(p, [-1, 4, -1], 'third_floor_2', r, false));
        p = add(list, createPiece(p, [-1, 8, -1], 'third_roof', r, true));
        createPart(SMALL_TOWER, depth + 1, p, null, list);
      }
      return true;
    };
    var SMALL_ATT = [[0, [1, -1, 0]], [1, [6, -1, 1]], [3, [0, -1, 5]], [2, [5, -1, 6]]];
    var SMALL_TOWER = function (depth, parent, list) {
      var r = parent.rot;
      var p = add(list, createPiece(parent, [3 + rng.nextInt(2), -3, 3 + rng.nextInt(2)], 'tower_base', r, true));
      p = add(list, createPiece(p, [0, 7, 0], 'tower_piece', r, true));
      var q = rng.nextInt(3) === 0 ? p : null, n = 1 + rng.nextInt(3), i;
      for (i = 0; i < n; i++) {
        p = add(list, createPiece(p, [0, 4, 0], 'tower_piece', r, true));
        if (i < n - 1 && rng.next(1) !== 0) q = p;
      }
      if (q !== null) {
        for (i = 0; i < SMALL_ATT.length; i++) {
          if (rng.next(1) !== 0) {
            var b = add(list, createPiece(q, SMALL_ATT[i][1], 'bridge_end', rotate(r, SMALL_ATT[i][0]), true));
            createPart(BRIDGE_PIECE, depth + 1, b, null, list);
          }
        }
        add(list, createPiece(p, [-1, 4, -1], 'tower_top', r, true));
      } else {
        if (depth !== 7) return createPart(FAT_TOWER, depth + 1, p, null, list);
        add(list, createPiece(p, [-1, 4, -1], 'tower_top', r, true));
      }
      return true;
    };
    var BRIDGE_PIECE = function (depth, parent, list) {
      var r = parent.rot, n = rng.nextInt(4) + 1;
      var p = add(list, createPiece(parent, [0, 0, -4], 'bridge_piece', r, true));
      p.chain = -1;
      var dy = 0;
      for (var i = 0; i < n; i++) {
        if (rng.next(1) !== 0) {
          p = add(list, createPiece(p, [0, dy, -4], 'bridge_piece', r, true));
          dy = 0;
        } else {
          if (rng.next(1) !== 0) p = add(list, createPiece(p, [0, dy, -4], 'bridge_steep_stairs', r, true));
          else p = add(list, createPiece(p, [0, dy, -8], 'bridge_gentle_stairs', r, true));
          dy = 4;
        }
      }
      if (!shipGenerated && rng.nextInt(10 - depth) === 0) {
        add(list, createPiece(p, [-8 + rng.nextInt(8), dy, -70 + rng.nextInt(10)], 'ship', r, true));
        shipGenerated = true;
      } else if (!createPart(BUILDING, depth + 1, p, [-3, dy + 1, -11], list)) {
        return false;
      }
      p = add(list, createPiece(p, [4, dy, 0], 'bridge_end', rotate(r, 2), true));
      p.chain = -1;
      return true;
    };
    var FAT_ATT = [[0, [4, -1, 0]], [1, [12, -1, 4]], [3, [0, -1, 8]], [2, [8, -1, 12]]];
    var FAT_TOWER = function (depth, parent, list) {
      var r = parent.rot;
      var p = add(list, createPiece(parent, [-3, 4, -3], 'fat_tower_base', r, true));
      p = add(list, createPiece(p, [0, 4, 0], 'fat_tower_middle', r, true));
      for (var i = 0; i < 2 && rng.nextInt(3) !== 0; i++) {
        p = add(list, createPiece(p, [0, 8, 0], 'fat_tower_middle', r, true));
        for (var j = 0; j < FAT_ATT.length; j++) {
          if (rng.next(1) !== 0) {
            var b = add(list, createPiece(p, FAT_ATT[j][1], 'bridge_end', rotate(r, FAT_ATT[j][0]), true));
            createPart(BRIDGE_PIECE, depth + 1, b, null, list);
          }
        }
      }
      add(list, createPiece(p, [-2, 8, -2], 'fat_tower_top', r, true));
      return true;
    };

    function createPart(part, depth, parent, pos, list) {
      if (depth > 8) return false;
      var mine = [];
      if (!part(depth, parent, mine, pos)) return false;
      var clash = false, id = rng.nextInt(), i, j;
      for (i = 0; i < mine.length && !clash; i++) {
        mine[i].chain = id;
        for (j = 0; j < list.length; j++) {              // StructurePiece.firstIntersecting
          if (intersects(list[j].bb, mine[i].bb)) {
            if (list[j].chain !== parent.chain) clash = true;
            break;
          }
        }
      }
      if (clash) return false;
      for (i = 0; i < mine.length; i++) list.push(mine[i]);
      return true;
    }

    var out = [];
    var p = add(out, make('base_floor', x, y, z, rot, true));
    p = add(out, createPiece(p, [-1, 0, -1], 'second_floor_1', rot, false));
    p = add(out, createPiece(p, [-1, 4, -1], 'third_floor_1', rot, false));
    p = add(out, createPiece(p, [-1, 8, -1], 'third_roof', rot, true));
    createPart(SMALL_TOWER, 1, p, null, out);
    return out;
  };

  /**
   * Piece.handleMetadata (EndCityGenerator.java l.290-310) for one piece: its template's structure_block
   * markers -> side effects. 'Chest*' -> the chest BELOW the marker gets end_city_treasure; 'Sentry*' -> a
   * shulker at the marker +0.5; 'Elytra*' -> an item frame holding an elytra facing SOUTH turned by the piece
   * rotation. Each must lie inside `box` (the chunk-clipped writing box, or the piece's own bb). The marker
   * cell itself is never written (D-212). tpl = the Templates entry (sx,sy,sz,meta).
   */
  EC.metadata = function (p, tpl, box) {
    var out = [], b = box || p.bb, M = tpl.meta || [], FACE = ['south', 'west', 'north', 'east'];
    function inside(x, y, z) { return x >= b[0] && x <= b[3] && y >= b[1] && y <= b[4] && z >= b[2] && z <= b[5]; }
    for (var i = 0; i < M.length; i++) {
      var li = M[i].pos, d = M[i].data, sx = tpl.sx, sz = tpl.sz;
      var lx = li % sx, ly = (li / (sx * sz)) | 0, lz = ((li / sx) | 0) % sz;
      var r = rotXZ(p.rot, lx, lz), x = p.x + r[0], y = p.y + ly, z = p.z + r[1];
      if (d.indexOf('Chest') === 0) {
        if (inside(x, y - 1, z)) out.push({ kind: 'chest', x: x, y: y - 1, z: z, loot: 'end_city_treasure' });
      } else if (inside(x, y, z)) {
        if (d.indexOf('Sentry') === 0) out.push({ kind: 'shulker', x: x + 0.5, y: y, z: z + 0.5 });
        else if (d.indexOf('Elytra') === 0) out.push({ kind: 'item_frame', x: x, y: y, z: z, facing: FACE[p.rot & 3], item: 'elytra' });
      }
    }
    return out;
  };

  // ── the End's start height (#9448) ──────────────────────────────────────────────────────────
  // EndCityFeature.getGenerationHeight: the MIN of four getHeightInGround(WORLD_SURFACE_WG) samples
  // at the chunk's (7,7) and a corner offset +-5 chosen by the rotation of Random(x + z*10387313).
  // The End's terrain is `end/sloped_cheese` = EndIslands + base_3d_noise, slid by the End shape
  // config (sampling 2,1 -> 8x4 blocks cells; top slide -23.4375/64/-46, bottom -0.234375/7/1).
  // RULING (deviation #1, worldgen is the cheap part): base_3d_noise is dropped, so the surface is the
  // island function alone, trilinear over the same 8x4x8 cells as vanilla. Solid where density > 0.
  var fr = Math.fround;
  function clampedLerp(a, b, t) { return t < 0 ? a : t > 1 ? b : a + t * (b - a); }
  var endSeed = null, endSrc = null, endNoise = null, islandMemo = null;
  function islands(bx8, bz8) {                       // bx8, bz8: multiples of 8 (block coords)
    var k = bx8 + ',' + bz8, v = islandMemo.get(k);
    if (v === undefined) {
      v = (NS.BiomeDims.endNoiseAt(endNoise, Math.trunc(bx8 / 8), Math.trunc(bz8 / 8)) - 8) / 128;
      islandMemo.set(k, v);
    }
    return v;
  }
  EC.cornerDensity = function (bx8, yi, bz8) {
    var d = islands(bx8, bz8);
    d = clampedLerp(-23.4375, d, (32 - yi + 46) / 64);
    return clampedLerp(-0.234375, d, (yi - 1) / 7);
  };
  EC.density = function (x, y, z) {
    var x0 = Math.floor(x / 8) * 8, z0 = Math.floor(z / 8) * 8, yi = y >> 2;
    var fx = (x - x0) / 8, fz = (z - z0) / 8, fy = (y & 3) / 4;
    var c = EC.cornerDensity, lerp = function (t, a, b) { return a + t * (b - a); };
    var a0 = lerp(fy, c(x0, yi, z0), c(x0, yi + 1, z0)), a1 = lerp(fy, c(x0 + 8, yi, z0), c(x0 + 8, yi + 1, z0));
    var b0 = lerp(fy, c(x0, yi, z0 + 8), c(x0, yi + 1, z0 + 8)), b1 = lerp(fy, c(x0 + 8, yi, z0 + 8), c(x0 + 8, yi + 1, z0 + 8));
    return lerp(fz, lerp(fx, a0, a1), lerp(fx, b0, b1));
  };
  /** getHeightInGround at one block column: the first y above the topmost solid block, or 0. */
  EC.groundHeight = function (seed64, x, z) {
    if (endSeed !== seed64) {
      endSeed = seed64; islandMemo = new Map();
      endSrc = NS.BiomeDims.endSource(seed64); endNoise = endSrc.noise;
    }
    for (var y = 127; y >= 0; y--) if (EC.density(x, y, z) > 0) return y + 1;
    return 0;
  };
  /** EndCityFeature.getGenerationHeight(chunk). */
  EC.startHeight = function (seed64, cx, cz) {
    var rot = new NS.Noise.LegacyRandom(BigInt(cx + Math.imul(cz, 10387313) | 0)).nextInt(4);
    var dx = 5, dz = 5;
    if (rot === 1) dx = -5; else if (rot === 2) { dx = -5; dz = -5; } else if (rot === 3) dz = -5;
    var x = (cx << 4) + 7, z = (cz << 4) + 7, g = EC.groundHeight;
    return Math.min(Math.min(g(seed64, x, z), g(seed64, x, z + dz)), Math.min(g(seed64, x + dx, z), g(seed64, x + dx, z + dz)));
  };
  /** ST.endHeight(cx, cz): the start height, or -1 where the biome is not end_highlands/end_midlands. */
  function endHeight(cx, cz) {
    var seed64 = NS.Structures.G.seed64 !== undefined ? NS.Structures.G.seed64 : BigInt(NS.Structures.G.seed | 0);
    var h = EC.startHeight(seed64, cx, cz);
    if (h < 60) return -1;
    // has_structure/end_city; TheEndBiomeSource.getBiome takes QUART coordinates (it shifts >> 2 again)
    var b = endSrc.biomeAt(((cx << 4) + 8) >> 2, h, ((cz << 4) + 8) >> 2);
    return (b === 'end_highlands' || b === 'end_midlands') ? h : -1;
  }
  NS.Structures.endHeight = endHeight;

  /**
   * markers(piece) -> the world-space result of EndCityGenerator.Piece.handleMetadata for one template piece.
   * "Chest*": the chest is the block under the marker, loot chests/end_city_treasure. "Sentry*": a shulker at
   * (x+.5, y, z+.5). "Elytra*": an item frame holding an elytra, facing rotation.rotate(SOUTH).
   * The chunk-box contains() test is the writer's: every marker here is inside its own piece box.
   */
  var FRAME_FACING = ['south', 'west', 'north', 'east'];
  EC.markers = function (p) {
    var T = NS.Templates, e = T.get(p.tpl), out = [], ms = e.meta || [];
    for (var i = 0; i < ms.length; i++) {
      var q = ms[i].pos, lx = q % e.sx, lz = ((q / e.sx) | 0) % e.sz, ly = (q / (e.sx * e.sz)) | 0;
      var x = p.ox + NS.Jigsaw.rotX(e, p.rot, lx, lz), y = p.oy + ly, z = p.oz + NS.Jigsaw.rotZ(e, p.rot, lx, lz), d = ms[i].data;
      if (d.indexOf('Chest') === 0) out.push({ kind: 'chest', x: x, y: y - 1, z: z, loot: 'minecraft:chests/end_city_treasure' });
      else if (d.indexOf('Sentry') === 0) out.push({ kind: 'shulker', x: x + 0.5, y: y, z: z + 0.5 });
      else if (d.indexOf('Elytra') === 0) out.push({ kind: 'elytra_frame', x: x, y: y, z: z, facing: FRAME_FACING[p.rot & 3], item: 'minecraft:elytra' });
    }
    return out;
  };

  // ── the grammar: EndCityFeature.addPieces over the layout above (#9448) ─────────────────────
  EC.pieces = function (rng, x, y, z, rot) {
    var SU = NS.StructSurface, T = NS.Templates;
    var lay = EC.generate(rng, x, y, z, rot, function (name) {
      var e = T.get(T.index('end_city/' + name)), s = [0, 0, 0];
      NS.Jigsaw.rotSize(e, 0, s);
      return s;
    });
    var out = [];
    for (var i = 0; i < lay.length; i++) {
      var p = lay[i];
      var tp = SU.templatePiece('end_city/' + p.name, p.rot, p.bb[0], p.bb[1], p.bb[2], { writeAir: p.ow });
      tp.markers = EC.markers(tp);
      out.push(tp);
    }
    return out;
  };

  NS.Structures.register('endcity', function () {
    var T = NS.Templates, JG = NS.Jigsaw;
    if (!(JG && JG.ready) || !T || T.index('end_city/base_floor') < 0) return null;
    return {
      reach: 8, name: 'end_city',
      preProbeY: function (ccx, ccz) { return NS.Structures.endHeight ? NS.Structures.endHeight(ccx, ccz) : -1; },
      expand: function (start, r) {
        var h = NS.Structures.endHeight ? NS.Structures.endHeight(start.cx, start.cz) : -1;
        if (h < 60) return null;
        return EC.pieces(r, (start.cx << 4) + 8, h, (start.cz << 4) + 8, r.nextInt(4));
      },
      write: function (SB, cx, cz, p) {
        var n = NS.StructSurface.write(SB, cx, cz, p), G = NS.Gen, ms = p.markers;
        if (!ms || !G) return n;
        // handleMetadata, in the chunk that holds the marker: shulkers ride entityLog, chest loot rides chestLog
        for (var i = 0; i < ms.length; i++) {
          var m = ms[i];
          if ((Math.floor(m.x) >> 4) !== cx || (Math.floor(m.z) >> 4) !== cz) continue;
          if (m.kind === 'shulker' && G.entityLog) G.entityLog.push(['shulker', m.x, m.y, m.z, 0]);
          else if (m.kind === 'elytra_frame' && G.entityLog) G.entityLog.push(['item_frame', m.x, m.y, m.z, 0, { facing: FRAME_FACING.indexOf(m.facing), item: 'elytra' }]);
          else if (m.kind === 'chest' && G.chestLog) G.chestLog.push([m.x, m.y, m.z, m.loot]);
        }
        return n;
      }
    };
  });
})(MCL);
