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
})(MCL);
