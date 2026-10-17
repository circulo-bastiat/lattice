// 04x_struct_stronghold.js — the stronghold's room grammar (PLAN W18, D-191).
// Runs on: main thread AND workers. No DOM.
//
// PLAN §7 names this one twice: W14 flags *"mineshafts, `monster_room` dungeons and STRONGHOLDS
// are procedural Java with no data file to port … the stronghold's ~14-piece room grammar are
// all code. Schedule it as such."*, and W18 owns its placement — `concentric_rings`, the one
// placement type in the 17 `structure_set` files that is not a grid.
//
// ── ⚠ WHAT IS PORTED AND WHAT IS NOT, SAID FIRST, AS D-124 AND D-185 SAY IT ────────────────
//
//   PORTED, and checkable against a file:
//     `structure_set/strongholds.json`      distance 32, spread 3, count 128
//     the ring layout arithmetic            128 positions, growing rings around the origin
//                                           (`Structures.ringPositions`, D-184; `structcheck`
//                                           holds it against the file and asserts the rings grow)
//
//   REIMPLEMENTED, from the documented shape of `StrongholdPieces`:
//     the FOURTEEN piece kinds — a spiral staircase start, straight corridors, left and right
//     turns, a room crossing, a five-way crossing, straight stairs down, a stairs-down shaft, a
//     prison hall, a chest corridor, a library, a portal room, a filler corridor and the
//     dead-end plug — the depth budget, the piece-count budget, and the stone-brick palette
//     with its cracked and mossy fractions
//
//   NOT CLAIMED, for D-124's reason: the random SEQUENCE, and the exact interior of each room.
//   Nothing in the jar states either. What a player meets — brick corridors at cave depth,
//   iron-barred cells, a two-storey library, and one room with an end portal frame in it — is
//   the silhouette this builds, and `structcheck` asserts that every stronghold has exactly one
//   portal room and that no corridor is left hanging in open air.
//
// ── ⚠ AND ONE THING IT DOES NOT DO, BECAUSE IT CANNOT ──────────────────────────────────────
//
// Vanilla's library has bookshelves, chests and a chandelier; its portal room has a silverfish
// spawner and twelve end portal frames of which a random few carry an eye of ender. The frames
// and the bookshelves are BLOCKS and are here. The spawner is placed as a bare `spawner` block
// (D-141's rule) and the chests are bare `chest` blocks with nothing in them, because this build
// has no block entities or loot tables (PLAN G2/G17).

(function (NS) {
  'use strict';

  var ST = NS.Structures, JG = NS.Jigsaw, SU = NS.StructSurface;
  var A = ST.api;
  var CFG = NS.CFG, MINY = CFG.WORLD_MIN_Y, H = CFG.CHUNK_H;

  var DX = [0, 1, 0, -1], DZ = [-1, 0, 1, 0];

  ST.register('stronghold', function (cfg) {
    var MAX_DEPTH = 50;                    // vanilla's `StrongholdPieces` piece budget
    var MAX_SPAN = 112;                    // blocks from the start, on each horizontal axis

    var B = {};
    var resolved = false;
    function resolve() {
      if (resolved) return;
      B.brick = A.stateOf('stone_bricks');
      B.mossy = A.stateOf('mossy_stone_bricks');
      B.crack = A.stateOf('cracked_stone_bricks');
      B.chis = A.stateOf('chiseled_stone_bricks');
      B.infest = A.stateOf('infested_stone_bricks');   // s115, StoneBrickRandomizer's 5%
      B.slab = A.stateOf('stone_brick_slab');
      B.stair = A.stateOf('stone_brick_stairs');
      B.bars = A.stateOf('iron_bars');
      B.shelf = A.stateOf('bookshelf');
      B.chest = A.stateOf('chest');
      B.spawner = A.stateOf('spawner');
      B.frame = A.stateOf('end_portal_frame');
      B.lava = A.stateOf('lava');
      B.torch = A.stateOf('torch');
      B.cobble = A.stateOf('cobblestone');
      if (!B.brick || !B.mossy || !B.crack) throw new Error('stronghold: the registry is missing the stone-brick family');
      resolved = true;
    }

    /**
     * ⚠ THE MIX IS A POSITION HASH, NOT A DRAW. A stronghold spans a dozen chunks and every
     * piece is written once per target chunk, so a sequential rng would give the same wall two
     * different mossy patterns depending on which chunk asked (D-141, D-185, D-190 — the same
     * rule, the fourth time).
     */
    // s115 — `StrongholdGenerator$StoneBrickRandomizer.setBlock` (.decomp/net/minecraft/
    // structure/StrongholdGenerator.java, the static inner class, read whole): for a wall cell
    // `f = nextFloat()`; f < 0.2 CRACKED_STONE_BRICKS (Blocks.field_10416 = dE), < 0.5
    // MOSSY_STONE_BRICKS (field_10065 = dD), < 0.55 INFESTED_STONE_BRICKS (field_10387 = dI),
    // else STONE_BRICKS (field_10056 = dC). The draw stays a position hash (above), bucketed
    // per-cent — the jar's thresholds are whole per-cents, so the fractions are exact. (This
    // corrects the older 20/30 guess: mossy is 30% of walls in vanilla, not 10%.)
    ST.WALL_MIX = [[20, 'cracked_stone_bricks'], [50, 'mossy_stone_bricks'],
      [55, 'infested_stone_bricks'], [100, 'stone_bricks']];
    ST.wallName = function (h) {
      for (var i = 0; i < ST.WALL_MIX.length; i++) if (h < ST.WALL_MIX[i][0]) return ST.WALL_MIX[i][1];
      return 'stone_bricks';
    };
    function wall(seed, x, y, z) {
      var n = ST.wallName(JG.hash4(seed, x, y, z) % 100);
      return n === 'cracked_stone_bricks' ? B.crack : n === 'mossy_stone_bricks' ? B.mossy :
        n === 'infested_stone_bricks' ? (B.infest || B.brick) : B.brick;
    }

    // ── the fourteen pieces ────────────────────────────────────────────────────────────────
    //
    // Each is `{w, h, d, build(c, seed), exits}` in its own frame, entered at (w>>1, 1, 0) and
    // facing +z. `exits` lists where a child may leave: [dx, dy, dz, turn].
    var KINDS = [
      { name: 'straight',        w: 5, h: 5, d: 7,  weight: 22 },
      { name: 'corridor',        w: 5, h: 5, d: 7,  weight: 10 },
      { name: 'left_turn',       w: 5, h: 5, d: 5,  weight: 10 },
      { name: 'right_turn',      w: 5, h: 5, d: 5,  weight: 10 },
      { name: 'room_crossing',   w: 11, h: 7, d: 11, weight: 10 },
      { name: 'five_crossing',   w: 10, h: 9, d: 11, weight: 5 },
      { name: 'straight_stairs', w: 5, h: 11, d: 8, weight: 8 },
      { name: 'stairs_down',     w: 5, h: 11, d: 5, weight: 8 },
      { name: 'prison_hall',     w: 9, h: 5, d: 11, weight: 5 },
      { name: 'chest_corridor',  w: 5, h: 5, d: 7,  weight: 5 },
      { name: 'library',         w: 14, h: 11, d: 15, weight: 4 },
      { name: 'portal_room',     w: 11, h: 8, d: 16, weight: 0 },   // exactly one, placed by hand
      { name: 'filler',          w: 5, h: 5, d: 4,  weight: 0 },
      { name: 'plug',            w: 5, h: 5, d: 1,  weight: 0 }
    ];
    var KIND = {};
    for (var ki = 0; ki < KINDS.length; ki++) KIND[KINDS[ki].name] = KINDS[ki];
    var WEIGHTED = [];
    for (ki = 0; ki < KINDS.length; ki++) for (var q = 0; q < KINDS[ki].weight; q++) WEIGHTED.push(KINDS[ki].name);

    /** A hollow brick room with a doorway in the entry wall. */
    function shellRoom(c, k, seed, ox, oy, oz) {
      var x, y, z;
      for (y = 0; y < k.h; y++) for (z = 0; z < k.d; z++) for (x = 0; x < k.w; x++) {
        var edge = (x === 0 || x === k.w - 1 || y === 0 || y === k.h - 1 || z === 0 || z === k.d - 1);
        if (edge) c.set(x, y, z, wall(seed, ox + x, oy + y, oz + z));
      }
      // the two doorways, entry and far wall, three high in the middle
      var mid = k.w >> 1;
      for (y = 1; y <= 3; y++) { c.set(mid, y, 0, -1); c.set(mid, y, k.d - 1, -1); }
      return c;
    }

    function build(kindName, seed, ox, oy, oz) {
      resolve();
      var k = KIND[kindName];
      var c = new SU.Cells();
      var mid = k.w >> 1, x, y, z;
      shellRoom(c, k, seed, ox, oy, oz);
      c.box(1, 1, 1, k.w - 2, k.h - 2, k.d - 2, -1);          // hollow
      switch (kindName) {
        case 'left_turn':
          for (y = 1; y <= 3; y++) c.set(0, y, k.d >> 1, -1);   // a doorway in the west wall
          break;
        case 'right_turn':
          for (y = 1; y <= 3; y++) c.set(k.w - 1, y, k.d >> 1, -1);
          break;
        case 'five_crossing':
          for (y = 1; y <= 3; y++) { c.set(0, y, 3, -1); c.set(k.w - 1, y, 3, -1); c.set(0, y, k.d - 4, -1); c.set(k.w - 1, y, k.d - 4, -1); }
          c.box(1, 4, 1, k.w - 2, 4, k.d - 2, B.brick);         // the upper storey's floor
          c.box(mid - 1, 4, mid - 1, mid + 1, 4, mid + 1, -1);  // and its hole
          break;
        case 'room_crossing':
          for (y = 1; y <= 3; y++) { c.set(0, y, k.d >> 1, -1); c.set(k.w - 1, y, k.d >> 1, -1); }
          if (B.torch) { c.set(2, 3, 2, B.torch); c.set(k.w - 3, 3, k.d - 3, B.torch); }
          break;
        case 'prison_hall':
          // a corridor of barred cells down the middle, which is the piece's whole signature
          for (z = 2; z < k.d - 2; z++) for (y = 1; y <= 3; y++) {
            if (B.bars) { c.set(2, y, z, (z % 3 === 0) ? -1 : B.bars); c.set(k.w - 3, y, z, (z % 3 === 0) ? -1 : B.bars); }
          }
          c.box(1, 1, 1, 1, 3, k.d - 2, -1);
          c.box(k.w - 2, 1, 1, k.w - 2, 3, k.d - 2, -1);
          break;
        case 'chest_corridor':
          if (B.chest) c.set(mid, 1, k.d - 2, B.chest);
          break;
        case 'straight_stairs':
          for (z = 1; z < k.d - 1; z++) {
            var sy = k.h - 3 - z;
            if (sy < 1) sy = 1;
            for (x = 1; x < k.w - 1; x++) c.set(x, sy, z, B.brick);
            for (x = 1; x < k.w - 1; x++) for (y = sy + 1; y <= sy + 3 && y < k.h - 1; y++) c.set(x, y, z, -1);
          }
          break;
        case 'stairs_down':
          // the spiral: four quarter-landings down the shaft
          for (y = 1; y < k.h - 1; y++) {
            var qz = (y & 1) ? 1 : k.d - 2, qx = (y & 2) ? 1 : k.w - 2;
            c.set(qx, y, qz, B.brick);
          }
          for (y = 1; y <= 3; y++) c.set(mid, y, k.d - 1, -1);
          break;
        case 'library':
          // two storeys of bookshelves round the wall, and a hole between them
          c.box(1, 5, 1, k.w - 2, 5, k.d - 2, B.brick);
          c.box(mid - 1, 5, mid - 1, mid + 1, 5, mid + 1, -1);
          if (B.shelf) {
            for (z = 2; z < k.d - 2; z++) {
              for (y = 1; y <= 4; y++) { c.set(1, y, z, B.shelf); c.set(k.w - 2, y, z, B.shelf); }
              for (y = 6; y <= 9 && y < k.h - 1; y++) { c.set(1, y, z, B.shelf); c.set(k.w - 2, y, z, B.shelf); }
            }
          }
          if (B.chest) { c.set(3, 1, 3, B.chest); c.set(k.w - 4, 6, k.d - 4, B.chest); }
          break;
        case 'portal_room':
          // ⚠ the room every stronghold has exactly one of. A lava moat, a raised dais, and
          // twelve end portal frames around a 3x3 hole.
          c.box(1, 1, 1, k.w - 2, 1, k.d - 2, B.brick);
          if (B.lava) c.box(1, 1, 1, k.w - 2, 1, 3, B.lava);
          var px = mid, pz = k.d - 6;
          c.box(px - 2, 2, pz - 2, px + 2, 2, pz + 2, B.chis);
          if (B.frame) {
            for (var i = -1; i <= 1; i++) {
              // each frame faces the hole (the facing the completed-frame pattern demands)
              c.set(px + i, 3, pz - 2, A.withProp(B.frame, 'facing', 'south')); c.set(px + i, 3, pz + 2, A.withProp(B.frame, 'facing', 'north'));
              c.set(px - 2, 3, pz + i, A.withProp(B.frame, 'facing', 'east')); c.set(px + 2, 3, pz + i, A.withProp(B.frame, 'facing', 'west'));
            }
          }
          c.box(px - 1, 3, pz - 1, px + 1, 3, pz + 1, -1);
          if (B.spawner) c.set(px, 4, 2, B.spawner);
          break;
        case 'plug':
          c.box(0, 0, 0, k.w - 1, k.h - 1, 0, B.brick);
          break;
      }
      return c;
    }

    // ── the walk ───────────────────────────────────────────────────────────────────────────
    function boxesHit(a, b) {
      return a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0 && a.z0 <= b.z1 && a.z1 >= b.z0;
    }

    return {
      reach: 8, name: 'stronghold',
      sampleY: function (start) { return (start.y0 + start.y1) >> 1; },
      expand: function (start, r) {
        resolve();
        var ox = (start.cx << 4) + 4, oz = (start.cz << 4) + 4;
        // ⚠ vanilla puts a stronghold between y 10 and 30-ish, under the surface and above the
        // deepslate. Drawn from the rng, so it is a pure function of (seed, chunk).
        var baseY = 12 + r.nextInt(20);
        var pieces = [], boxes = [];
        var queue = [{ x: ox, y: baseY, z: oz, dir: 0, depth: 0 }];
        var seed = JG.hash4(0x57A0, ox, baseY, oz);
        var portalPlaced = false;
        var qi = 0;
        while (qi < queue.length && pieces.length < MAX_DEPTH) {
          var job = queue[qi++];
          if (Math.abs(job.x - ox) > MAX_SPAN || Math.abs(job.z - oz) > MAX_SPAN) continue;
          // the portal room goes in at a fixed depth, once, and then the walk stops branching
          var name;
          if (!portalPlaced && job.depth >= 4) { name = 'portal_room'; portalPlaced = true; }
          else if (job.depth === 0) name = 'stairs_down';
          else name = WEIGHTED[r.nextInt(WEIGHTED.length)];
          var k = KIND[name];
          var d = job.dir, w = (d & 1) ? k.d : k.w, dd = (d & 1) ? k.w : k.d;
          var px = job.x - (w >> 1), pz = job.z;
          if (d === 0) pz = job.z - dd + 1;
          if (d === 3) px = job.x - dd + 1;
          if (d === 1) px = job.x;
          if (d === 2) pz = job.z;
          if (d === 1 || d === 3) { px = job.x - ((d === 3) ? dd - 1 : 0); pz = job.z - (w >> 1); }
          var box = { x0: px, y0: job.y, z0: pz, x1: px + w - 1, y1: job.y + k.h - 1, z1: pz + dd - 1 };
          if (box.y0 < MINY + 5 || box.y1 >= 60) continue;
          var hit = false;
          for (var b = 0; b < boxes.length; b++) if (boxesHit(boxes[b], box)) { hit = true; break; }
          if (hit) continue;
          var cells = build(name, seed, px, job.y, pz);
          var bp = SU.blocksPiece(px, job.y, pz, d, cells.a, k.w, k.h, k.d);
          if (name === 'portal_room' && B.spawner) { bp.mob = 'silverfish'; bp.mobState = B.spawner; }
          pieces.push(bp);
          boxes.push(box);
          if (name === 'portal_room') continue;                 // the portal room is a dead end
          // the children: straight on, and a turn either side for the pieces that have one
          var nd = d;
          if (name === 'left_turn') nd = (d + 3) & 3;
          else if (name === 'right_turn') nd = (d + 1) & 3;
          var ny = job.y;
          if (name === 'stairs_down' || name === 'straight_stairs') ny = job.y - (k.h - 5);
          if (ny < MINY + 5) ny = MINY + 5;
          queue.push({ x: job.x + DX[nd] * (dd + 1), y: ny, z: job.z + DZ[nd] * (dd + 1), dir: nd, depth: job.depth + 1 });
          if (name === 'room_crossing' || name === 'five_crossing') {
            queue.push({ x: job.x + DX[(d + 1) & 3] * (w + 1), y: job.y, z: job.z + DZ[(d + 1) & 3] * (w + 1), dir: (d + 1) & 3, depth: job.depth + 1 });
            queue.push({ x: job.x + DX[(d + 3) & 3] * (w + 1), y: job.y, z: job.z + DZ[(d + 3) & 3] * (w + 1), dir: (d + 3) & 3, depth: job.depth + 1 });
          }
        }
        // ⚠ a stronghold with no portal room is not a stronghold. If the walk never got deep
        // enough, the last piece becomes one rather than the structure shipping without it.
        if (!portalPlaced && pieces.length) {
          var last = pieces[pieces.length - 1];
          var kk = KIND.portal_room;
          var fp = pieces[pieces.length - 1] = SU.blocksPiece(last.ox, last.oy, last.oz, last.rot,
            build('portal_room', seed, last.ox, last.oy, last.oz).a, kk.w, kk.h, kk.d);
          if (B.spawner) { fp.mob = 'silverfish'; fp.mobState = B.spawner; }
        }
        return pieces.length ? pieces : null;
      },
      write: SU.write
    };
  });
})(MCL);
