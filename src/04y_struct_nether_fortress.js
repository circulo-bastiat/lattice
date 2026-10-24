// 04y_struct_nether_fortress.js — the Nether fortress's piece layout (#1146, part of #1132).
// Runs on: main thread AND workers. No DOM.
//
// PORTED LINE FOR LINE from .decomp/net/minecraft/structure/NetherFortressGenerator.java (the piece
// tables, every `create` box, every `fillOpenings`, pickPiece/pieceGenerator, Start) and
// .decomp/net/minecraft/world/gen/feature/NetherFortressFeature.java (`addPieces`: the random-pop loop,
// then `shiftInto(48, 70)`). This module is the LAYOUT only — piece kinds, facings, chain depth and
// bounding boxes, with the draws in vanilla's order. The blocks each piece places (`generate`) are not
// here; #1132's spawn pool needs the boxes, and that is what this gives it.
//
// The rng is any object with nextInt(bound) (N.LegacyRandom is java.util.Random). `Fortress.generate`
// leaves the seeding to the caller, as `StructurePiecesGenerator.Context.random` does.
(function (NS) {
  'use strict';

  var F = NS.NetherFortress = {};

  // Direction.Type.HORIZONTAL order (NORTH, EAST, SOUTH, WEST); index = Direction.getHorizontal().
  var N = 0, E = 1, S = 2, W = 3;

  /** BlockBox.rotated (BlockBox.java:72-84) -> [minX,minY,minZ,maxX,maxY,maxZ]. */
  function rotated(x, y, z, ox, oy, oz, sx, sy, sz, d) {
    switch (d) {
      case N: return [x + ox, y + oy, z - sz + 1 + oz, x + sx - 1 + ox, y + sy - 1 + oy, z + oz];
      case W: return [x - sz + 1 + oz, y + oy, z + ox, x + oz, y + sy - 1 + oy, z + sx - 1 + ox];
      case E: return [x + oz, y + oy, z + ox, x + sz - 1 + oz, y + sy - 1 + oy, z + sx - 1 + ox];
      default: return [x + ox, y + oy, z + oz, x + sx - 1 + ox, y + sy - 1 + oy, z + sz - 1 + oz];   // SOUTH
    }
  }
  function intersects(a, b) {
    return a[3] >= b[0] && a[0] <= b[3] && a[5] >= b[2] && a[2] <= b[5] && a[4] >= b[1] && a[1] <= b[4];
  }

  // create(...) boxes: [offX, offY, offZ, sizeX, sizeY, sizeZ]. Kind names are the class names.
  var BOX = {
    Bridge: [-1, -3, 0, 5, 10, 19], BridgeCrossing: [-8, -3, 0, 19, 10, 19], BridgeEnd: [-1, -3, 0, 5, 10, 8],
    BridgePlatform: [-2, 0, 0, 7, 8, 9], BridgeSmallCrossing: [-2, 0, 0, 7, 9, 7], BridgeStairs: [-2, 0, 0, 7, 11, 7],
    CorridorBalcony: [-3, 0, 0, 9, 7, 9], CorridorCrossing: [-1, 0, 0, 5, 7, 5], CorridorExit: [-5, -3, 0, 13, 14, 13],
    CorridorLeftTurn: [-1, 0, 0, 5, 7, 5], CorridorNetherWartsRoom: [-5, -3, 0, 13, 14, 13],
    CorridorRightTurn: [-1, 0, 0, 5, 7, 5], CorridorStairs: [-1, -7, 0, 5, 14, 10], SmallCorridor: [-1, 0, 0, 5, 7, 5]
  };
  F.BOX = BOX;

  // ALL_BRIDGE_PIECES / ALL_CORRIDOR_PIECES: [kind, weight, limit, repeatable]
  var BRIDGE = [['Bridge', 30, 0, true], ['BridgeCrossing', 10, 4], ['BridgeSmallCrossing', 10, 4],
    ['BridgeStairs', 10, 3], ['BridgePlatform', 5, 2], ['CorridorExit', 5, 1]];
  var CORRIDOR = [['SmallCorridor', 25, 0, true], ['CorridorCrossing', 15, 5], ['CorridorRightTurn', 5, 10],
    ['CorridorLeftTurn', 5, 10], ['CorridorStairs', 10, 3, true], ['CorridorBalcony', 7, 2],
    ['CorridorNetherWartsRoom', 5, 2]];
  function fresh(t) { return t.map(function (p) { return { kind: p[0], weight: p[1], limit: p[2], repeatable: !!p[3], count: 0 }; }); }

  // fillOpenings per kind: [op, a, b, flag]; op f=forward n=NW s=SE. Balcony is special-cased.
  var OPEN = {
    Bridge: [['f', 1, 3, 0]], BridgeCrossing: [['f', 8, 3, 0], ['n', 3, 8, 0], ['s', 3, 8, 0]],
    BridgeSmallCrossing: [['f', 2, 0, 0], ['n', 0, 2, 0], ['s', 0, 2, 0]], BridgeStairs: [['s', 6, 2, 0]],
    CorridorCrossing: [['f', 1, 0, 1], ['n', 0, 1, 1], ['s', 0, 1, 1]], CorridorExit: [['f', 5, 3, 1]],
    CorridorLeftTurn: [['n', 0, 1, 1]], CorridorNetherWartsRoom: [['f', 5, 3, 1], ['f', 5, 11, 1]],
    CorridorRightTurn: [['s', 0, 1, 1]], CorridorStairs: [['f', 1, 0, 1]], SmallCorridor: [['f', 1, 0, 1]]
  };

  /**
   * NetherFortressFeature.addPieces. `rng` = the feature's random; (chunkX, chunkZ) the start chunk.
   * Returns { pieces: [{kind, dir, depth, bb}], bb } in vanilla's addPiece order, shifted by shiftInto(48, 70).
   */
  F.generate = function (rng, chunkX, chunkZ) {
    var all = [], open = [];
    var x = chunkX * 16 + 2, z = chunkZ * 16 + 2;            // ChunkPos.getOffsetX(2)/getOffsetZ(2)
    var dir = rng.nextInt(4);                                 // getRandomHorizontalDirection
    var start = { kind: 'Start', dir: dir, depth: 0, bb: [x, 64, z, x + 18, 73, z + 18] };   // createBox 19x10x19
    var bridge = fresh(BRIDGE), corr = fresh(CORRIDOR), last = null;
    all.push(start);

    function intersecting(bb) {
      for (var i = 0; i < all.length; i++) if (intersects(all[i].bb, bb)) return all[i];
      return null;
    }
    function tryCreate(kind, px, py, pz, d, depth) {
      var o = BOX[kind];
      var bb = rotated(px, py, pz, o[0], o[1], o[2], o[3], o[4], o[5], d);
      if (!(bb[1] > 10) || intersecting(bb)) return null;     // isInBounds + getIntersecting
      var p = { kind: kind, dir: d, depth: depth, bb: bb };
      if (kind === 'BridgeEnd') rng.nextInt();                 // BridgeEnd.seed = random.nextInt()
      else if (kind === 'CorridorLeftTurn' || kind === 'CorridorRightTurn') p.chest = rng.nextInt(3) === 0;
      return p;
    }
    function pick(list, px, py, pz, d, depth) {
      var total = 0, any = false, i;
      for (i = 0; i < list.length; i++) {
        if (list[i].limit > 0 && list[i].count < list[i].limit) any = true;
        total += list[i].weight * 2;                           // checkRemainingPieces adds the weight twice
      }
      if (!any) total = -1;
      var go = total > 0 && depth <= 30, tries = 0;
      while (tries < 5 && go) {
        tries++;
        var r = rng.nextInt(total);
        for (i = 0; i < list.length; i++) {
          var pd = list[i];
          r -= pd.weight;
          if (r < 0) {
            if (!(pd.limit === 0 || pd.count < pd.limit) || (pd === last && !pd.repeatable)) break;
            var p = tryCreate(pd.kind, px, py, pz, d, depth);
            if (p) {
              pd.count++; last = pd;
              if (!(pd.limit === 0 || pd.count < pd.limit)) list.splice(i, 1);
              return p;
            }
          }
        }
      }
      return tryCreate('BridgeEnd', px, py, pz, d, depth);
    }
    function gen(px, py, pz, d, depth, isCorr) {
      if (Math.abs(px - start.bb[0]) <= 112 && Math.abs(pz - start.bb[2]) <= 112) {
        var p = pick(isCorr ? corr : bridge, px, py, pz, d, depth + 1);
        if (p) { all.push(p); open.push(p); }
        return p;
      }
      return tryCreate('BridgeEnd', px, py, pz, d, depth);      // NOT added, as vanilla
    }
    function forward(p, a, b, c) {
      var bb = p.bb;
      switch (p.dir) {
        case N: return gen(bb[0] + a, bb[1] + b, bb[2] - 1, p.dir, p.depth, c);
        case S: return gen(bb[0] + a, bb[1] + b, bb[5] + 1, p.dir, p.depth, c);
        case W: return gen(bb[0] - 1, bb[1] + b, bb[2] + a, p.dir, p.depth, c);
        case E: return gen(bb[3] + 1, bb[1] + b, bb[2] + a, p.dir, p.depth, c);
      }
    }
    function nw(p, a, b, c) {
      var bb = p.bb;
      if (p.dir === N || p.dir === S) return gen(bb[0] - 1, bb[1] + a, bb[2] + b, W, p.depth, c);
      return gen(bb[0] + b, bb[1] + a, bb[2] - 1, N, p.depth, c);
    }
    function se(p, a, b, c) {
      var bb = p.bb;
      if (p.dir === N || p.dir === S) return gen(bb[3] + 1, bb[1] + a, bb[2] + b, E, p.depth, c);
      return gen(bb[0] + b, bb[1] + a, bb[5] + 1, S, p.depth, c);
    }
    function fillOpenings(p) {
      if (p.kind === 'CorridorBalcony') {
        var a = (p.dir === W || p.dir === N) ? 5 : 1;
        nw(p, 0, a, rng.nextInt(8) > 0); se(p, 0, a, rng.nextInt(8) > 0);
        return;
      }
      var ops = p.kind === 'Start' ? OPEN.BridgeCrossing : OPEN[p.kind];
      if (!ops) return;                                        // BridgeEnd, BridgePlatform: no openings
      for (var i = 0; i < ops.length; i++) {
        var o = ops[i], f = o[0] === 'f' ? forward : o[0] === 'n' ? nw : se;
        f(p, o[1], o[2], !!o[3]);
      }
    }

    fillOpenings(start);
    while (open.length) fillOpenings(open.splice(rng.nextInt(open.length), 1)[0]);

    // StructurePiecesCollector.shiftInto(random, 48, 70)
    var minY = 1e9, maxY = -1e9, i;
    for (i = 0; i < all.length; i++) { minY = Math.min(minY, all[i].bb[1]); maxY = Math.max(maxY, all[i].bb[4]); }
    var room = 70 - 48 + 1 - (maxY - minY + 1), ny = room > 1 ? 48 + rng.nextInt(room) : 48, dy = ny - minY;
    var bb = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9];
    for (i = 0; i < all.length; i++) {
      var b = all[i].bb; b[1] += dy; b[4] += dy;
      for (var k = 0; k < 3; k++) { bb[k] = Math.min(bb[k], b[k]); bb[k + 3] = Math.max(bb[k + 3], b[k + 3]); }
    }
    return { pieces: all, bb: bb };
  };

  // ── the blocks (#259): Piece.generate, ported per kind. Only the kinds in GEN are placed so far; the
  // rest write nothing (their layout, and so the spawn boxes, are unchanged). Local (a,b,c) -> world is
  // StructurePiece.applyX/Y/ZTransform for facing N/E/S/W.
  var GEN = {};
  F.GEN = GEN;
  var st = null;
  function states(A) {
    if (st && st.A === A) return st;
    var fence = A.stateOf('nether_brick_fence');
    var ns = A.withProp(fence, 'north', 'true'); ns = A.withProp(ns, 'south', 'true');
    st = { A: A, brick: A.stateOf('nether_bricks'), fenceNS: ns,
           fenceNSE: A.withProp(ns, 'east', 'true'), fenceNSW: A.withProp(ns, 'west', 'true'),
           replace: [0, A.stateOf('water'), A.stateOf('lava'), A.stateOf('fire'), A.stateOf('soul_fire')] };
    return st;
  }
  function canReplace(S, cur) {
    if (cur === 0) return true;
    var R = NS.Reg, b = NS.States.block[cur];
    return b === R.id.water || b === R.id.lava || b === R.id.fire || b === R.id.soul_fire;
  }
  function Ctx(SB, cx, cz, p, A) {
    this.SB = SB; this.cx = cx; this.cz = cz; this.p = p; this.A = A; this.S = states(A); this.n = 0;
  }
  Ctx.prototype.wx = function (a, c) {
    var p = this.p; return p.dir === W ? p.x1 - c : p.dir === E ? p.x0 + c : p.x0 + a;
  };
  Ctx.prototype.wz = function (a, c) {
    var p = this.p; return p.dir === N ? p.z1 - c : p.dir === S ? p.z0 + c : p.z0 + a;
  };
  Ctx.prototype.fill = function (a0, b0, c0, a1, b1, c1, state) {
    for (var b = b0; b <= b1; b++) for (var a = a0; a <= a1; a++) for (var c = c0; c <= c1; c++)
      this.n += this.A.set(this.SB, this.cx, this.cz, this.wx(a, c), this.p.y0 + b, this.wz(a, c), state);
  };
  // StructurePiece.fillDownwards: only inside the chunk box, while canReplace and above bottom+1
  Ctx.prototype.down = function (a, b, c, state) {
    var x = this.wx(a, c), z = this.wz(a, c), y = this.p.y0 + b, A = this.A;
    while (y > A.MINY + 1) {
      var cur = A.get(this.SB, this.cx, this.cz, x, y, z);
      if (cur < 0 || !canReplace(this.S, cur)) break;
      this.n += A.set(this.SB, this.cx, this.cz, x, y, z, state);
      y--;
    }
  };

  GEN.Bridge = function (g) {
    var B = g.S.brick, F1 = g.S.fenceNSE, F2 = g.S.fenceNSW, a, c;
    g.fill(0, 3, 0, 4, 4, 18, B); g.fill(1, 5, 0, 3, 7, 18, 0);
    g.fill(0, 5, 0, 0, 5, 18, B); g.fill(4, 5, 0, 4, 5, 18, B);
    g.fill(0, 2, 0, 4, 2, 5, B); g.fill(0, 2, 13, 4, 2, 18, B);
    g.fill(0, 0, 0, 4, 1, 3, B); g.fill(0, 0, 15, 4, 1, 18, B);
    for (a = 0; a <= 4; a++) for (c = 0; c <= 2; c++) { g.down(a, -1, c, B); g.down(a, -1, 18 - c, B); }
    g.fill(0, 1, 1, 0, 4, 1, F1); g.fill(0, 3, 4, 0, 4, 4, F1); g.fill(0, 3, 14, 0, 4, 14, F1); g.fill(0, 1, 17, 0, 4, 17, F1);
    g.fill(4, 1, 1, 4, 4, 1, F2); g.fill(4, 3, 4, 4, 4, 4, F2); g.fill(4, 3, 14, 4, 4, 14, F2); g.fill(4, 1, 17, 4, 4, 17, F2);
  };
  GEN.SmallCorridor = function (g) {
    var B = g.S.brick, Fn = g.S.fenceNS, a, c;
    g.fill(0, 0, 0, 4, 1, 4, B); g.fill(0, 2, 0, 4, 5, 4, 0);
    g.fill(0, 2, 0, 0, 5, 4, B); g.fill(4, 2, 0, 4, 5, 4, B);
    g.fill(0, 3, 1, 0, 4, 1, Fn); g.fill(0, 3, 3, 0, 4, 3, Fn);
    g.fill(4, 3, 1, 4, 4, 1, Fn); g.fill(4, 3, 3, 4, 4, 3, Fn);
    g.fill(0, 6, 0, 4, 6, 4, B);
    for (a = 0; a <= 4; a++) for (c = 0; c <= 4; c++) g.down(a, -1, c, B);
  };
  GEN.CorridorCrossing = function (g) {
    var B = g.S.brick, a, c;
    g.fill(0, 0, 0, 4, 1, 4, B); g.fill(0, 2, 0, 4, 5, 4, 0);
    g.fill(0, 2, 0, 0, 5, 0, B); g.fill(4, 2, 0, 4, 5, 0, B);
    g.fill(0, 2, 4, 0, 5, 4, B); g.fill(4, 2, 4, 4, 5, 4, B);
    g.fill(0, 6, 0, 4, 6, 4, B);
    for (a = 0; a <= 4; a++) for (c = 0; c <= 4; c++) g.down(a, -1, c, B);
  };

  /** Write one piece's part inside chunk (cx, cz) into the chunk block array SB; returns cells set. */
  F.writePiece = function (SB, cx, cz, piece) {
    var fn = GEN[piece.kind];
    if (!fn) return 0;
    var g = new Ctx(SB, cx, cz, piece, NS.Structures.api);
    fn(g);
    return g.n;
  };

  // ── the fortress maker (structure set nether_complexes, weight 2 of fortress + bastion_remnant) ──
  // Start chunk's random is `ChunkRandom.setCarverSeed(worldSeed, chunkX, chunkZ)`. The pieces are the
  // layout only (see header): `write` places nothing. `reach` 8 chunks: pieces stay within 112 blocks
  // of the start (the `depth` bound), plus the start chunk itself.
  function carverRandom(seed, cx, cz) {
    var r = new NS.Noise.LegacyRandom(seed), S = BigInt(seed);
    var a = r.nextLong(), b = r.nextLong();
    r.seed = ((BigInt.asIntN(64, BigInt(cx) * a) ^ BigInt.asIntN(64, BigInt(cz) * b) ^ S) ^ 0x5DEECE66Dn) & ((1n << 48n) - 1n);
    return r;
  }
  F.carverRandom = carverRandom;

  if (NS.Structures) NS.Structures.register('fortress', function () {
    return {
      reach: 8, name: 'fortress',
      expand: function (start) {
        var g = F.generate(carverRandom(NS.Structures.G.seed64, start.cx, start.cz), start.cx, start.cz);
        return g.pieces.map(function (p) {
          return { kind: p.kind, dir: p.dir, depth: p.depth,
                   x0: p.bb[0], y0: p.bb[1], z0: p.bb[2], x1: p.bb[3], y1: p.bb[4], z1: p.bb[5] };
        });
      },
      write: function (SB, cx, cz, piece) { return F.writePiece(SB, cx, cz, piece); }
    };
  });
})(MCL);
