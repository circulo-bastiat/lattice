// 04s_struct_mineshaft.js — the mineshaft piece grammar (PLAN W14, S2, D-185).
// Runs on: main thread AND workers. No DOM.
//
// PLAN §7's W14 is flagged ⚠ *"reimplementation, not a port"*, and this is the file that flag is
// about: *"mineshafts, `monster_room` dungeons and strongholds are procedural Java with no data
// file to port. Corridors, crossings, rooms, rails, cobwebs, chests and the stronghold's
// ~14-piece room grammar are all code."*
//
// So what IS ported here, and what is not, has to be said before the code rather than after it.
//
//   PORTED, from the data, checkable against a file:
//     `configured_structure_feature/mineshaft.json`      probability 0.004, type "normal"
//     `configured_structure_feature/mineshaft_mesa.json` probability 0.004, type "mesa"
//     `structure_set/mineshafts.json`                    spacing 1, separation 0, salt 0
//     the two biome tags those name (D-183)              47 biomes and 3 badlands
//     `structcheck` §1 and §2 hold all of it against the source files, field by field.
//
//   REIMPLEMENTED, from the documented SHAPE of `MineShaftPieces`:
//     the four piece kinds — room, corridor, crossing, stairs
//     the piece choice: `nextInt(100)`, >= 80 crossing, >= 70 stairs, otherwise corridor
//     the two caps that terminate it: generation depth 8, and 80 blocks from the start
//     a corridor is 3x3 and a whole number of 5-block sections, 2 to 4 of them
//     rails in one corridor in three; a cave-spider corridor in one of the rest in 23
//     the wooden support arch — two fence posts and a plank lintel — and its cobwebs
//     `moveBelowSeaLevel(seaLevel, minY, random, 10)`, which is what puts a mineshaft at a
//     believable depth rather than at the surface
//
//   ⚠ NOT CLAIMED, for D-124's reason and in D-124's words: the random SEQUENCE. Nothing in the
//   jar states the order `MineShaftPieces` draws its numbers in, so a port claiming sequence
//   parity would be a claim no test in this project could check. The CONSTANTS above are
//   vanilla's, the SHAPE is vanilla's, the sequence is MC-Lite's own PRNG seeded per start.
//
// ── ⚠ THE ONE RULE THAT DECIDES EVERY LINE OF THE WRITE PASS ────────────────────────────────
//
// A mineshaft spans up to eleven chunks across, and `write` is entered ONCE PER TARGET CHUNK for
// every piece that touches it — the same shape D-141 had to learn the hard way for the dungeon.
// So a decision that is made with a SEQUENTIAL rng inside `write` answers differently in each
// chunk and tears the structure along the chunk border: half a support arch, a rail that stops
// at x=15. Every per-block decision below is therefore a PURE HASH OF THE WORLD POSITION and the
// piece's own seed — the same answer in all four passes, by construction. The only thing `write`
// is allowed to READ is the cell it is about to write and the cell directly under it, both of
// which are inside the target chunk whenever the write is.
//
// ── ⚠ WHAT IS MISSING, SAID PLAINLY, THE SAME WAY D-141 SAID IT ─────────────────────────────
//
// Vanilla puts a cave-spider SPAWNER in a spider corridor and MINECART CHESTS along the rails.
// The spawner is a block entity with an NBT tag naming a mob; the minecart chest is an ENTITY
// with a loot table. This build has neither (PLAN G2/G17). So the spawner is placed as a bare
// `spawner` BLOCK — the right block in the right cell, an empty cage — exactly as D-141 placed
// the dungeon's, and the minecart chests are not placed at all, because an entity this build
// cannot spawn is not a block it can substitute. The tunnels, their timbers, their cobwebs and
// their rails are right; what rides on them is G17's.

(function (NS) {
  'use strict';

  var ST = NS.Structures;
  if (!ST) throw new Error('04s_struct_mineshaft.js loaded before 04r_structures.js');

  var A = ST.api;

  // ── the caps and constants, all of them vanilla's ─────────────────────────────────────────
  var MAX_DEPTH = 8;          // MineShaftPieces.generateAndAddPiece
  var MAX_SPAN = 80;          // blocks from the start, on each horizontal axis
  var SECTION = 5;            // a corridor is a whole number of 5-block sections
  var MAX_PIECES = 384;       // ⚠ NOT vanilla's — see the note at `expand`
  ST.MINESHAFT_MAX_PIECES = MAX_PIECES;

  // directions: 0 = north (-z), 1 = east (+x), 2 = south (+z), 3 = west (-x)
  var DX = [0, 1, 0, -1], DZ = [-1, 0, 1, 0];

  /**
   * A 32-bit avalanche of (salt, x, y, z). The per-block decisions call this instead of drawing
   * from an rng, because a draw has an ORDER and an order is what a per-chunk write pass cannot
   * agree on. Same family as `mix32` in 04i_carvers.js, folded over four inputs.
   */
  function hash4(s, x, y, z) {
    var a = (s ^ (x * 0x9E3779B1) ^ (y * 0x85EBCA77) ^ (z * 0xC2B2AE3D)) | 0;
    a = (a ^ (a >>> 16)) | 0; a = Math.imul(a, 0x7FEB352D) | 0;
    a = (a ^ (a >>> 15)) | 0; a = Math.imul(a, 0x846CA68B) | 0;
    return (a ^ (a >>> 16)) >>> 0;
  }

  function boxesIntersect(a, b) {
    return a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0 && a.z0 <= b.z1 && a.z1 >= b.z0;
  }

  // ── ⚠ THE INTERSECTION TEST IS BUCKETED, AND THAT WAS 2.3 ms A MINESHAFT ───────────────────
  //
  // `createPiece` is called for every job the walk pulls off the queue and the piece is thrown
  // away if it overlaps anything already placed — which is how a mineshaft stops folding back
  // through itself. The obvious version tests the candidate against every placed piece, and with
  // a couple of hundred pieces and rather more rejected jobs that is a few hundred thousand box
  // comparisons per structure: **2.3 ms to expand one mineshaft**, all of it inside the one
  // budget PLAN §7 puts a rule on.
  //
  // A mineshaft sprawls over 180 blocks and every piece of it is at most 20 long, so almost
  // every one of those comparisons is between two pieces a hundred blocks apart. Bucketing the
  // placed pieces by 16-block cell turns the test into "the pieces in the two or three cells this
  // candidate touches". Same answer, and the whole point of the test — that it is EXACT — is
  // untouched: a piece is in every cell its box spans, so a real overlap can never be missed.
  function gridAdd(grid, p, idx) {
    for (var gz = p.z0 >> 4; gz <= (p.z1 >> 4); gz++) {
      for (var gx = p.x0 >> 4; gx <= (p.x1 >> 4); gx++) {
        var k = gx * 100003 + gz;
        var b = grid.get(k);
        if (b === undefined) { b = []; grid.set(k, b); }
        b.push(idx);
      }
    }
  }
  function hits(grid, list, box) {
    for (var gz = box.z0 >> 4; gz <= (box.z1 >> 4); gz++) {
      for (var gx = box.x0 >> 4; gx <= (box.x1 >> 4); gx++) {
        var b = grid.get(gx * 100003 + gz);
        if (b === undefined) continue;
        for (var i = 0; i < b.length; i++) if (boxesIntersect(list[b[i]], box)) return true;
      }
    }
    return false;
  }

  ST.register('mineshaft', function (cfg) {
    // ── the ported half ──────────────────────────────────────────────────────────────────────
    var probability = cfg.probability === undefined ? 0.004 : +cfg.probability;
    var mesa = String(cfg.type || 'normal') === 'mesa';
    if (!(probability > 0 && probability <= 1)) throw new Error('mineshaft: bad probability ' + cfg.probability);

    // Blocks are resolved once, here, not per write. `dark_oak` for the mesa variant is the one
    // thing `type` changes about the structure other than which biomes it is allowed in.
    var PLANK = 0, FENCE = 0, RAIL_X = 0, RAIL_Z = 0, WEB = 0, SPAWNER = 0;
    var resolved = false;
    function resolve() {
      if (resolved) return;
      PLANK = A.stateOf(mesa ? 'dark_oak_planks' : 'oak_planks');
      FENCE = A.stateOf(mesa ? 'dark_oak_fence' : 'oak_fence');
      WEB = A.stateOf('cobweb');
      SPAWNER = A.stateOf('spawner');
      var rail = A.stateOf('rail');
      RAIL_X = A.withProp(rail, 'shape', 'east_west');
      RAIL_Z = A.withProp(rail, 'shape', 'north_south');
      if (!PLANK || !FENCE || !WEB || !rail) {
        throw new Error('mineshaft: the registry is missing planks, fence, cobweb or rail');
      }
      resolved = true;
    }

    // ── the piece constructors ───────────────────────────────────────────────────────────────

    function makeRoom(r, x, y, z) {
      return { kind: 'room', dir: 0, seed: r.next(),
               x0: x, y0: y, z0: z,
               x1: x + 7 + r.nextInt(6), y1: y + 4 + r.nextInt(6), z1: z + 7 + r.nextInt(6) };
    }

    /** A corridor runs from (x, y, z) in `dir`, 3 wide and 3 tall, a whole number of sections. */
    function makeCorridor(r, x, y, z, dir) {
      var sections = 2 + r.nextInt(3);                     // 2..4  ->  10, 15 or 20 blocks
      var len = sections * SECTION;
      var hasRails = r.nextInt(3) === 0;
      var spider = !hasRails && r.nextInt(23) === 0;
      var p = { kind: 'corridor', dir: dir, len: len, sections: sections,
                hasRails: hasRails, spider: spider, seed: r.next(),
                ax: x, ay: y, az: z };
      span3(p, x, y, z, dir, len);
      return p;
    }

    /**
     * The bounding box of a 3-wide, 3-tall run from (x,y,z) `len` blocks along `dir`.
     * ⚠ Written out rather than `Math.min.apply(null, [..])` over two four-element arrays, which
     * is what the first draft did: two array literals and two `apply` calls per piece, on a
     * function that runs a couple of hundred times per mineshaft.
     */
    function span3(p, x, y, z, dir, len) {
      var dx = DX[dir], dz = DZ[dir];
      var ex = x + dx * (len - 1), ez = z + dz * (len - 1);
      var px = dz < 0 ? -dz : dz, pz = dx < 0 ? -dx : dx;   // the perpendicular half-width
      p.x0 = (x < ex ? x : ex) - px; p.x1 = (x > ex ? x : ex) + px;
      p.z0 = (z < ez ? z : ez) - pz; p.z1 = (z > ez ? z : ez) + pz;
      p.y0 = y; p.y1 = y + 2;
      return p;
    }

    /**
     * A junction: a 5x5 footprint, one storey or two.
     *
     * ⚠ ITS CENTRE IS TWO BLOCKS FORWARD OF THE JOINT, not on it. The first version centred the
     * box on the incoming job position, which is one block past the end of the parent corridor —
     * so the 5x5 box always swallowed the last two blocks of its own parent, `hits()` always
     * rejected it, and **not one crossing appeared in 4,096 chunks** while the piece chooser
     * dutifully drew `>= 80` a fifth of the time. The near face has to sit AT the joint.
     */
    function makeCrossing(r, x, y, z, dir) {
      var twoFloored = r.nextInt(4) === 0;
      var cx = x + DX[dir] * 2, cz = z + DZ[dir] * 2;
      return { kind: 'crossing', dir: dir, twoFloored: twoFloored, seed: r.next(),
               cx: cx, cy: y, cz: cz,
               x0: cx - 2, x1: cx + 2, z0: cz - 2, z1: cz + 2,
               y0: y, y1: y + (twoFloored ? 6 : 2) };
    }

    /** Eight blocks along, five blocks down. The one piece that changes the y of its children. */
    function makeStairs(r, x, y, z, dir) {
      var p = { kind: 'stairs', dir: dir, seed: r.next(), ax: x, ay: y, az: z, len: 8, drop: 5 };
      span3(p, x, y, z, dir, 8);
      p.y0 = y - 5; p.y1 = y + 2;
      return p;
    }

    // ── 2. THE PIECE PASS ────────────────────────────────────────────────────────────────────
    //
    // Breadth-first out of the start room, which is what makes the shape a mineshaft rather than
    // one long tunnel: a queue spreads outward evenly, a stack would dig one branch to the depth
    // cap before touching the second.
    //
    // ⚠ `MAX_PIECES` IS NOT VANILLA'S, IT IS INSURANCE, AND IT IS SET FROM A MEASUREMENT RATHER
    // THAN CHOSEN (D-174's rule). Vanilla is bounded only by the depth cap and the 80-block span;
    // over **102,400 chunks at seed 1337 those two alone gave 384 mineshafts of 216 pieces at the
    // median, 332 at the 99th percentile and 344 at the largest**, so the ceiling is 384 and in
    // that whole sample it never once bound. It exists so that a seed in the tail cannot make an
    // unbounded one, not to reshape the ordinary case — the first draft set it at 64 and it bound
    // on every single start, which is a different structure wearing vanilla's name.
    // `structcheck` §5 reports the distribution and asserts the cap is still above it.
    function expand(start, r) {
      resolve();
      var pieces = [];
      var grid = new Map();
      var sx = 0, sz = 0;                                   // the start, in the LOCAL frame
      var room = makeRoom(r, sx, 0, sz);
      gridAdd(grid, room, pieces.length); pieces.push(room);

      // the room's own exits: one to three corridors out of each wall
      var queue = [];
      for (var d = 0; d < 4; d++) {
        var n = 1 + r.nextInt(3);
        for (var i = 0; i < n; i++) {
          var ex, ez;
          if (d === 0) { ex = room.x0 + 1 + r.nextInt(room.x1 - room.x0 - 1); ez = room.z0 - 1; }
          else if (d === 2) { ex = room.x0 + 1 + r.nextInt(room.x1 - room.x0 - 1); ez = room.z1 + 1; }
          else if (d === 1) { ex = room.x1 + 1; ez = room.z0 + 1 + r.nextInt(room.z1 - room.z0 - 1); }
          else { ex = room.x0 - 1; ez = room.z0 + 1 + r.nextInt(room.z1 - room.z0 - 1); }
          queue.push({ x: ex, y: room.y0 + 1, z: ez, dir: d, depth: 1 });
        }
      }

      var qi = 0;
      while (qi < queue.length && pieces.length < (ST.MINESHAFT_MAX_PIECES | 0)) {
        var job = queue[qi++];
        if (job.depth > MAX_DEPTH) continue;
        if (Math.abs(job.x - sx) > MAX_SPAN || Math.abs(job.z - sz) > MAX_SPAN) continue;
        var p = createPiece(r, job);
        if (!p) continue;
        if (hits(grid, pieces, p)) continue;
        gridAdd(grid, p, pieces.length); pieces.push(p);
        addChildren(r, p, job, queue);
      }
      layout(start, pieces, r);
      // ⚠ AFTER the layout, because the gate is about world y and `moveBelowSeaLevel` is what
      // decides it, and after the whole walk, because that is where vanilla's `postProcess` sits
      // (D-221). The list comes back the same length with the wet pieces flagged.
      return gateLiquid(pieces);
    }

    function createPiece(r, job) {
      var n = r.nextInt(100);
      if (n >= 80) return makeCrossing(r, job.x, job.y, job.z, job.dir);
      if (n >= 70) return makeStairs(r, job.x, job.y, job.z, job.dir);
      return makeCorridor(r, job.x, job.y, job.z, job.dir);
    }

    function addChildren(r, p, job, queue) {
      var d = job.depth + 1;
      var dir = job.dir, dx = DX[dir], dz = DZ[dir];
      if (p.kind === 'corridor') {
        // straight on, off the far end
        queue.push({ x: p.ax + dx * p.len, y: p.ay, z: p.az + dz * p.len, dir: dir, depth: d });
        // and a side branch at each section joint, one in four
        for (var s = 1; s < p.sections; s++) {
          if (r.nextInt(4) !== 0) continue;
          var side = (dir + (r.nextInt(2) ? 1 : 3)) & 3;
          var bx = p.ax + dx * (s * SECTION) + DX[side] * 2;
          var bz = p.az + dz * (s * SECTION) + DZ[side] * 2;
          queue.push({ x: bx, y: p.ay, z: bz, dir: side, depth: d });
        }
      } else if (p.kind === 'crossing') {
        // straight on and out of both sides — that is what makes it a crossing
        queue.push({ x: p.cx + dx * 3, y: p.cy, z: p.cz + dz * 3, dir: dir, depth: d });
        var l = (dir + 3) & 3, rr = (dir + 1) & 3;
        queue.push({ x: p.cx + DX[l] * 3, y: p.cy, z: p.cz + DZ[l] * 3, dir: l, depth: d });
        queue.push({ x: p.cx + DX[rr] * 3, y: p.cy, z: p.cz + DZ[rr] * 3, dir: rr, depth: d });
        if (p.twoFloored) queue.push({ x: p.cx + dx * 3, y: p.cy + 4, z: p.cz + dz * 3, dir: dir, depth: d });
      } else if (p.kind === 'stairs') {
        queue.push({ x: p.ax + dx * p.len, y: p.ay - p.drop, z: p.az + dz * p.len, dir: dir, depth: d });
      }
    }

    /**
     * `moveBelowSeaLevel(seaLevel, minY, random, 10)`, and then the shift into world x/z.
     *
     * The whole structure is built around a local origin at y = 0; this drops it so that its TOP
     * lands at a random y between "just clear of the world floor" and `seaLevel - 10`. It is the
     * one piece of vanilla's placement that is pure arithmetic, so it is ported exactly.
     */
    function layout(start, pieces, r) {
      var minY = A.MINY, sea = ST.G.params.seaLevel | 0;
      var lo = 2147483647, hi = -2147483648, i;
      for (i = 0; i < pieces.length; i++) { if (pieces[i].y0 < lo) lo = pieces[i].y0; if (pieces[i].y1 > hi) hi = pieces[i].y1; }
      var span = hi - lo;
      var ceiling = sea - 10;
      var j = span + minY + 1;
      if (j < ceiling) j += r.nextInt(ceiling - j);
      var dy = j - hi;
      // never through the bedrock floor: the world's bottom four layers are not negotiable
      if (lo + dy < minY + 5) dy = minY + 5 - lo;
      var ox = start.cx << 4, oz = start.cz << 4;
      for (i = 0; i < pieces.length; i++) {
        var p = pieces[i];
        p.x0 += ox; p.x1 += ox; p.z0 += oz; p.z1 += oz;
        p.y0 += dy; p.y1 += dy;
        if (p.ax !== undefined) { p.ax += ox; p.az += oz; p.ay += dy; }
        if (p.cx !== undefined) { p.cx += ox; p.cz += oz; p.cy += dy; }
      }
    }

    // ── 2b. THE LIQUID GATE — VANILLA'S `edgesLiquid`, AS A PURE FUNCTION OF POSITION (D-221) ─
    //
    // Every one of `MineShaftPieces`' four `postProcess` bodies opens with
    // `if (this.edgesLiquid(level, box)) return;` and `StructurePiece.edgesLiquid` walks the SIX
    // FACES of the piece's box grown by one, returning true the moment it finds a liquid. A piece
    // that fails it is not flooded and not shrunk — it is NEVER BUILT, which is why a vanilla
    // mineshaft under an ocean is a set of stumps with holes where its corridors would have been.
    //
    // ⚠ THE DIRECT PORT IS FORBIDDEN AND THAT IS THE WHOLE DIFFICULTY. `edgesLiquid` READS BLOCKS,
    // over a box that spans up to eleven chunks. A read outside the target chunk returns -1 here,
    // so a ported test would answer differently in each of the nine chunks that write the piece and
    // the mineshaft would TEAR at the seam — D-185's invariant, and the exact mistake D-213 (every
    // tree in the world built by one chunk and thrown away by the other eight) and D-217 (a disk
    // that would have been sliced the same way) have already paid for once each.
    //
    // So the test is rebuilt out of the two things that ARE pure: `Column.height(x, z)`, the
    // natural ground, and `seaLevel`. In this world a cell (x, y, z) holds sea water exactly when
    // `Column.height(x, z) < y <= seaLevel`, so for a box the whole shell collapses to ONE SCALAR
    // COMPARISON: the shell reaches y = y1 + 1 at the top and y = y0 - 1 at the bottom, and it
    // meets water iff `y0 - 1 <= seaLevel` and the LOWEST ground under the grown footprint is
    // below `min(seaLevel, y1 + 1)`. Every column of the six faces is covered by that one min,
    // because water touching a side face at some y < y1 + 1 needs ground lower still. Same answer
    // from all nine targets, by construction, at any time, in any order.
    //
    // ⚠ WHAT THE APPROXIMATION IS, SAID PLAINLY. `Column.height` is the terrain BEFORE the
    // carvers, the aquifer and the features, so this gate sees THE SEA and nothing else. The
    // aquifer (D-67) is a fake — one 2D noise decides whether a region has a water table and where
    // it sits — and its water only exists in cells a CARVER hollowed, which is a 3D question no
    // pure column function answers. Gating on `Caves.aquiferLevel` alone would abandon every deep
    // corridor in an aquifer region whether or not a cave ever flooded it; that is a much bigger
    // deviation than the one it fixes, so it is NOT done, and the residue it leaves is whatever
    // `structaudit` §6 still charges to the mineshaft. Measured at the time of writing: the sea
    // term alone takes mineshaft + mineshaft_mesa from 105 air-against-water cells to 0 in the
    // default sample, so the aquifer term has nothing left to remove there.
    //
    // ⚠ AND THE GATE RUNS AFTER `layout`, NOT DURING `expand`, WHICH IS ALSO VANILLA'S ORDER.
    // `postProcess` is called on a piece list that has already been generated in full, so a
    // corridor that is dropped has ALREADY spawned its children — and those children live or die
    // on their own boxes. That is why a vanilla mineshaft near water comes out in disconnected
    // pieces, and this one does too. Gating during the walk would prune the subtree instead, which
    // is a different structure wearing vanilla's name (D-174's rule).
    var GATE_SCREEN_CAP = 24;    // stage 1 looks at no more than 24x24 columns of the WHOLE start
    var GATE_SCREEN_DROP = 8;    // and only believes "dry" when the ground it saw is this far clear

    /**
     * The lowest `Column.height` over a rectangle, sampled every `step` and ALWAYS including the
     * far edges whatever the step divides into. Returns as soon as the running minimum is at or
     * below `stop`, because every caller is asking whether the minimum crosses a line and not
     * what it is.
     */
    function minGround(x0, z0, x1, z1, step, stop) {
      var CO = NS.Column, lo = 2147483647, x, z, h;
      for (z = z0; ; z += step) {
        if (z > z1) z = z1;
        for (x = x0; ; x += step) {
          if (x > x1) x = x1;
          h = CO.height(x, z);
          if (h < lo) { lo = h; if (lo <= stop) return lo; }
          if (x === x1) break;
        }
        if (z === z1) break;
      }
      return lo;
    }

    /** `edgesLiquid(box)` for the sea, exactly, from position alone. */
    function boxEdgesLiquid(p, sea) {
      if (p.y0 - 1 > sea) return false;                     // the whole shell is above the water
      var top = Math.min(sea, p.y1 + 1);                    // highest shell cell that could be wet
      return minGround(p.x0 - 1, p.z0 - 1, p.x1 + 1, p.z1 + 1, 1, top - 1) < top;
    }

    /**
     * Mark every piece whose shell meets the sea, so the write pass builds nothing for it.
     *
     * ⚠ MARKED, NOT REMOVED, AND THAT IS VANILLA'S OWN MODEL RATHER THAN A CONCESSION. A piece
     * that fails `edgesLiquid` is still in the `StructureStart`'s piece list — vanilla's
     * `postProcess` simply returns before it writes anything — so its box still counts toward the
     * start's bounding box and the grammar's shape is untouched. Filtering the list instead is
     * what a first draft did, and it is observably wrong in this codebase: `structcheck` §5 holds
     * "every mineshaft has exactly one room", the ROOM is a piece like any other, and three of 178
     * mineshafts at seed 1337 have a room whose shell meets the sea. Removing the piece deletes a
     * room the grammar did generate; skipping the WRITE is what vanilla does.
     *
     * ⚠ TWO STAGES, AND THE FIRST ONE EXISTS BECAUSE THE SECOND COSTS 120 ms. `Column.height` is
     * the whole spline stack at about 10 us a column here, and the union of one mineshaft's grown
     * piece footprints is ~12,000 columns — measured, at seed 1337, over twelve starts: 8.6k to
     * 15.2k columns and 98 to 183 ms each. Paying that on every mineshaft in the world to catch
     * the one in twelve that is near water would have put roughly 10 ms a chunk on `gencheck`'s
     * cold window, against a whole-chunk budget of 16.9 ms.
     *
     * So stage 1 asks the cheap question over the WHOLE start at a capped lattice — the same
     * "cap the sample COUNT, not the spacing" `SU.survey` uses and for the same reason — and only
     * concludes "dry" when the lowest ground it saw is `GATE_SCREEN_DROP` clear of the highest
     * cell any shell could reach. Stage 2, the exact per-piece test at one-block resolution, then
     * runs on the starts that survive the screen, which is the handful near a coast.
     *
     * ⚠ THE SCREEN IS AN APPROXIMATION AND IT IS FENCED RATHER THAN TRUSTED: `structaudit` §6b
     * re-derives `edgesLiquid` in the tool, at one-block resolution, over every piece that
     * SHIPPED, and fails if any of them has sea water on its shell. A screen that ever let a wet
     * piece through is a failing check, not a silent deviation.
     */
    function gateLiquid(pieces) {
      if (!pieces.length) return pieces;
      var sea = ST.G.params.seaLevel | 0;
      var x0 = 2147483647, z0 = 2147483647, x1 = -2147483648, z1 = -2147483648;
      var loY = 2147483647, hiY = -2147483648, i, p;
      for (i = 0; i < pieces.length; i++) {
        p = pieces[i];
        if (p.x0 < x0) x0 = p.x0;
        if (p.x1 > x1) x1 = p.x1;
        if (p.z0 < z0) z0 = p.z0;
        if (p.z1 > z1) z1 = p.z1;
        if (p.y0 < loY) loY = p.y0;
        if (p.y1 > hiY) hiY = p.y1;
      }
      if (loY - 1 > sea) return pieces;                     // wholly above the sea: nothing to mark
      var top = Math.min(sea, hiY + 1);
      var span = Math.max(x1 - x0, z1 - z0) + 2;
      var step = Math.ceil(span / GATE_SCREEN_CAP);
      if (step < 1) step = 1;
      if (minGround(x0 - 1, z0 - 1, x1 + 1, z1 + 1, step, top + GATE_SCREEN_DROP - 1)
          >= top + GATE_SCREEN_DROP) return pieces;
      for (i = 0; i < pieces.length; i++) {
        if (boxEdgesLiquid(pieces[i], sea)) pieces[i].edgesLiquid = true;
      }
      return pieces;
    }

    // ── 3. THE WRITE PASS ────────────────────────────────────────────────────────────────────

    /** Hollow a box out, and bridge its floor where it hangs over a cave. */
    function carve(SB, cx, cz, x0, y0, z0, x1, y1, z1, floorY) {
      var n = 0, x, y, z;
      for (y = y0; y <= y1; y++) {
        for (z = z0; z <= z1; z++) {
          for (x = x0; x <= x1; x++) {
            var cur = A.get(SB, cx, cz, x, y, z);
            if (cur < 0) continue;
            // ⚠ NEVER DRAIN AN OCEAN (D-212), the third copy of the rule the beard's fill branch
            // states. Hollowing water out leaves a corridor of air whose every wall is air against
            // sea; `structaudit` §6 charged 125 such cells to the mineshaft.
            // ⚠ AND IT IS THE SECOND LINE OF DEFENCE, NOT THE RULE. Vanilla's rule is
            // `if (this.edgesLiquid(box)) return;` — the whole corridor is ABANDONED, not flooded
            // — and `gateLiquid` above is now the pure-position form of it (D-221), so a piece
            // whose shell meets the sea never reaches this loop at all. What is left here catches
            // the water this gate cannot see from a column function: the aquifer's (D-67), which
            // only exists in cells a carver hollowed. Hollowing that out would leave a corridor of
            // air whose every wall is air against water; `structaudit` §6 charged 125 such cells
            // to the mineshaft before D-212 put this line in.
            if (cur !== 0 && NS.States.waterIn[cur]) continue;
            n += A.set(SB, cx, cz, x, y, z, 0);
          }
        }
      }
      if (floorY !== undefined) {
        for (z = z0; z <= z1; z++) {
          for (x = x0; x <= x1; x++) {
            var below = A.get(SB, cx, cz, x, floorY - 1, z);
            // ⚠ the ONLY read that decides anything, and it is legal because (x, floorY-1, z) is
            // in the target chunk whenever (x, floorY, z) is — same column. A plank floor over a
            // hole is vanilla's, and it is also what keeps `floatcheck` honest: a rail with
            // nothing under it is exactly the thing that check exists to find.
            if (below === 0) n += A.set(SB, cx, cz, x, floorY - 1, z, PLANK);
          }
        }
      }
      return n;
    }

    function writeCorridor(SB, cx, cz, p) {
      var n = carve(SB, cx, cz, p.x0, p.y0, p.z0, p.x1, p.y1, p.z1, p.y0);
      var dir = p.dir, dx = DX[dir], dz = DZ[dir];
      var px = Math.abs(dz), pz = Math.abs(dx);              // the perpendicular unit
      var railState = dx !== 0 ? RAIL_X : RAIL_Z;
      var i, s;
      for (i = 0; i < p.len; i++) {
        var mx = p.ax + dx * i, mz = p.az + dz * i;
        // the support arch, every fifth block, three in four of them
        if (i % SECTION === 2 && (hash4(p.seed ^ 0x41C6, mx, p.y0, mz) & 3) !== 0) {
          for (var k = 0; k <= 1; k++) {
            n += A.set(SB, cx, cz, mx - px, p.y0 + k, mz - pz, FENCE);
            n += A.set(SB, cx, cz, mx + px, p.y0 + k, mz + pz, FENCE);
          }
          for (var q = -1; q <= 1; q++) {
            n += A.set(SB, cx, cz, mx + px * q, p.y0 + 2, mz + pz * q, PLANK);
          }
          // cobwebs in the corners of the arch, one in eight
          for (s = -1; s <= 1; s += 2) {
            if ((hash4(p.seed ^ 0x7B15, mx + px * s, p.y0 + 1, mz + pz * s) & 7) === 0) {
              n += A.set(SB, cx, cz, mx + px * s, p.y0 + 1, mz + pz * s, WEB);
            }
          }
        }
        // the rails, down the middle
        // #1911: `!isAir() && isOpaqueFullCube` — water/slabs/glass under a rail is NOT support, and the rail
        // would pop into an item the first time a fluid tick touched it.
        if (p.hasRails && NS.States.opaque[A.get(SB, cx, cz, mx, p.y0 - 1, mz)]) {
          n += A.set(SB, cx, cz, mx, p.y0, mz, railState);
        }
        // a cave-spider corridor is webbed along its whole length
        if (p.spider && (hash4(p.seed ^ 0x2E9D, mx, p.y0 + 1, mz) % 5) === 0) {
          n += A.set(SB, cx, cz, mx, p.y0 + 1, mz, WEB);
        }
      }
      // and its cage, once, in the middle — a bare `spawner` block, per D-141
      if (p.spider && SPAWNER) {
        var hx = p.ax + dx * ((p.len / 2) | 0), hz = p.az + dz * ((p.len / 2) | 0);
        if (A.get(SB, cx, cz, hx, p.y0, hz) >= 0) {
          n += A.set(SB, cx, cz, hx, p.y0, hz, SPAWNER);
          // loop/spawner-s114 -- the corridor's own cage gets the mob its webbing and
          // name already promise: `cave_spider` (`MineshaftGenerator`'s own spider-
          // corridor spawner, vanilla; `07zs_spawner.js`'s own `Spawner.assign`).
          // No-ops (NS.Spawner absent) in the real WORKER bundle -- same named gap.
          if (NS.Spawner && NS.Spawner.assign) NS.Spawner.assign(hx, p.y0, hz, 'cave_spider');
          else if (NS.Gen && NS.Gen.spawnerLog) NS.Gen.spawnerLog.push([hx, p.y0, hz, 'cave_spider']);
        }
      }
      return n;
    }

    function writeStairs(SB, cx, cz, p) {
      var dir = p.dir, dx = DX[dir], dz = DZ[dir];
      var px = Math.abs(dz), pz = Math.abs(dx);
      var n = 0;
      for (var i = 0; i < p.len; i++) {
        var fy = p.ay - Math.ceil(i * p.drop / (p.len - 1));
        var mx = p.ax + dx * i, mz = p.az + dz * i;
        for (var q = -1; q <= 1; q++) {
          var wx = mx + px * q, wz = mz + pz * q;
          for (var y = fy; y <= fy + 2; y++) {
            if (A.get(SB, cx, cz, wx, y, wz) < 0) continue;
            var cw = A.get(SB, cx, cz, wx, y, wz);
            if (cw !== 0 && cw > 0 && NS.States.waterIn[cw]) continue;   // D-212, as above
            n += A.set(SB, cx, cz, wx, y, wz, 0);
          }
          if (A.get(SB, cx, cz, wx, fy - 1, wz) === 0) n += A.set(SB, cx, cz, wx, fy - 1, wz, PLANK);
        }
      }
      return n;
    }

    function writeRoom(SB, cx, cz, p) {
      // the floor stays where the terrain put it; the room is the hollow above it, carved to the
      // full width of the box so that the corridors leaving its walls actually open into it
      return carve(SB, cx, cz, p.x0, p.y0 + 1, p.z0, p.x1, p.y1, p.z1, p.y0 + 1);
    }

    function writeCrossing(SB, cx, cz, p) {
      var n = carve(SB, cx, cz, p.x0, p.y0, p.z0, p.x1, p.y1, p.z1, p.y0);
      // the two-floored junction gets its plank ceiling back between the storeys, so it reads as
      // two rooms with a hole rather than as one seven-block shaft
      if (p.twoFloored) {
        for (var z = p.z0; z <= p.z1; z++) {
          for (var x = p.x0; x <= p.x1; x++) {
            if (x === p.cx && z === p.cz) continue;          // the hole between them
            n += A.set(SB, cx, cz, x, p.y0 + 3, z, PLANK);
          }
        }
      }
      return n;
    }

    return {
      // ⚠ REACH IS DERIVED FROM THE CAPS, NOT GUESSED, and an under-estimate is the one bug in
      // this file that would break PLAN §7's invariant rather than merely look wrong: a piece
      // outside `reach` is written by the chunks that scan far enough and not by the ones that
      // do not, so the mineshaft would change depending on which way the player walked in.
      // A job is refused past MAX_SPAN (80) from the start, the longest piece a surviving job
      // can make is a 4-section corridor (20) and the widest is a crossing (2 either side), so
      // the furthest block is 80 + 20 + 2 = 102 from the start — seven chunks. Eight is the
      // margin, and `structcheck` §5 asserts no piece in 100,000 chunks ever needs more.
      reach: 8,
      name: mesa ? 'mineshaft_mesa' : 'mineshaft',
      probability: probability,
      mesa: mesa,
      /** The structure's own gate: `probability` out of `configured_structure_feature`. */
      gate: function (r) { return r.nextFloat() < probability; },
      // ⚠ THE BIOME IS ASKED AT y=50, AND THE ANSWER KEY IS WHAT SAYS SO (D-242).
      //
      // 04r's `buildStart` asks the biome at the structure's OWN y when a grammar declares no
      // probe, and for a mineshaft that y is the middle of a shaft `moveBelowSeaLevel` has
      // already dropped — around y=0 to 30, which in 1.18 is exactly where the CAVE biomes
      // live. A mineshaft under a badlands then asks a `lush_caves` cell whether
      // `mineshaft_mesa` may start there, and the answer is no. MEASURED against the real game:
      // MC-Lite refused 3 of the 106 mineshaft starts vanilla actually placed in the two golden
      // worlds, 2 of the 11 `mineshaft_mesa` among them.
      //
      // ⚠ THE PROBE Y WAS NOT GUESSED AND NOT READ OFF MC-LITE (D-152/D-178/D-194/D-215). It was
      // determined FROM THE ANSWER KEY: for each of vanilla's own 106 mineshaft starts, ask
      // VANILLA'S OWN saved biome array which candidate y accepts the member vanilla chose.
      // Every y from -40 to 70, the sea floor and the world surface each reject at least one;
      // the quart cell holding y=48..51 accepts all 106. That cell is `QuartPos.fromBlock(50)`,
      // which is what `MineshaftFeature.checkLocation` asks for. `structcheck` §12 re-derives it
      // from the same answer key, so this constant cannot drift into a number nobody can check.
      preProbeY: function () { return 50; },
      expand: expand,
      write: function (SB, cx, cz, p) {
        // ⚠ `edgesLiquid` (D-221): the piece exists, and vanilla's `postProcess` would have
        // returned here without writing a block. Same answer in all nine target chunks, because
        // the flag was decided once, from position alone, at layout time.
        if (p.edgesLiquid) return 0;
        switch (p.kind) {
          case 'room': return writeRoom(SB, cx, cz, p);
          case 'corridor': return writeCorridor(SB, cx, cz, p);
          case 'crossing': return writeCrossing(SB, cx, cz, p);
          case 'stairs': return writeStairs(SB, cx, cz, p);
          default: throw new Error('mineshaft: unknown piece ' + p.kind);
        }
      }
    };
  });
})(MCL);
