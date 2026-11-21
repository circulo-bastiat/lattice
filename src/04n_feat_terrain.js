// 04n_feat_terrain.js — the TERRAIN feature generators (PLAN W8d).
//
// Eight of the roster's 36 types, and what they have in common is that none of them is a plant:
// they are the features that CUT INTO or PILE ONTO the terrain the noise made. A lake is a
// lens-shaped hollow filled with lava and sealed with stone; a geode is four nested shells with
// a crystal-lined cavity; a monster room is a hollow cobblestone box; a forest rock is three
// overlapping mossy blobs. W8b's vegetation could get away with writing one block at a time
// against `would_survive`. These write dozens to thousands, and every one of them has to survive
// the same invariant the rest of W8 lives under, restated here because it is the whole design:
//
// ── ⚠ RUN IS CALLED ONCE PER TARGET CHUNK, WITH THE SAME ARGUMENTS ───────────────────────────
//
// A lake is 16 blocks across, so it straddles up to four chunks. W8's answer (D-136) is that
// each of those four chunks runs the WHOLE lake and keeps its own quarter: `run` is entered four
// times with an identical (x, y, z) and an identically seeded `r`, and `api.setBlock` throws away
// everything outside the chunk being written. The four quarters only line up if `run` is a PURE
// FUNCTION of its arguments — the same lake, drawn four times, differing only in what is kept.
//
// That has one consequence that shapes every generator below, and it is worth stating plainly:
//
//   ⚠ A DRAW FROM `r` MAY NOT DEPEND ON A BLOCK READ, AND MAY NOT DEPEND ON THE TARGET CHUNK.
//
// `api.getBlock` returns -1 outside the chunk being written, so "is there stone here" has a
// different answer in each of the four passes. A sequential rng threaded through a loop that
// branches on that answer desynchronises immediately and the lake comes out with a seam down the
// chunk border. So the generators here obey a two-phase rule:
//
//   phase 1   draw from `r`, a FIXED number of times, before any block is read. The lake's eight
//             ellipsoids, the geode's distribution points, the room's two half-widths.
//   phase 2   walk the shape. Every further random decision — "is this floor block mossy",
//             "does this budding face sprout a cluster" — is a HASH OF THE WORLD POSITION and a
//             salt drawn in phase 1, never a draw from `r`. A hash is the same number in all four
//             passes by construction, and it is what lets phase 2 be clipped to the target chunk
//             instead of walked in full (which is what keeps the geode's 33³ box affordable).
//
// Vanilla uses a sequential rng in phase 2 and gets away with it because it writes into a live
// 3x3 of chunks it owns. MC-Lite cannot, and the hash is the price. It costs the exact vanilla
// random sequence, which is compiled Java and unverifiable from here anyway; it buys a lake that
// is the same lake from all four sides. That trade is D-123 applied one level down.
//
// ── ⚠ AND THE OTHER HALF: A BLOCK READ IS ALLOWED TO DECIDE *WHETHER*, NEVER *WHAT* ──────────
//
// The ore blob already established this. "Is this cell stone, so may I replace it" is the TARGET
// chunk's own business and each pass answers it for its own quarter — that is fine, and it is how
// the lake's barrier and the geode's buds work. What is not fine is letting that answer change
// the SHAPE, which is why every shape decision above is settled before a single read.
//
// The casualty is vanilla's abort tests. `LakeFeature` scans its whole 16x16x8 box and bails if
// the rim is open to air; `MonsterRoomFeature` refuses a box with fewer than one or more than
// five open sides; `GeodeFeature` bails on more than one invalid block at its distribution
// points. All three are a global yes/no computed from blocks a single target chunk cannot see —
// they would answer differently in each pass and tear the feature in half. They are dropped, and
// the placement chain (which does run per source chunk, on pure data) carries the filtering:
// `lake_lava_underground` already has an `environment_scan` and a depth threshold on it.
//
(function (NS) {
  'use strict';

  var F = NS.Features;
  if (!F) throw new Error('04n_feat_terrain: 04j_features must load first');

  // ── the position hash ──────────────────────────────────────────────────────────────────────
  //
  // ⚠ The workhorse of phase 2. `salt` is one draw from the placement's own rng, so two lakes
  // from different placements decide differently; (x, y, z) are WORLD coordinates, so the same
  // cell decides identically no matter which of the four target chunks is asking. Same finalizer
  // shape as `mix32` in the carvers — three multiply-xorshift rounds, 32-bit, no BigInt.
  function hash3(salt, x, y, z) {
    var a = (salt ^ Math.imul(x | 0, 0x9E3779B1)) | 0;
    a = (a ^ Math.imul(z | 0, 0x85EBCA77)) | 0;
    a = (a ^ Math.imul(y | 0, 0xC2B2AE3D)) | 0;
    a = Math.imul(a ^ (a >>> 15), 0x2545F491);
    a = Math.imul(a ^ (a >>> 13), 0x27D4EB2F);
    return (a ^ (a >>> 16)) >>> 0;
  }
  /** The same hash as a float in [0,1) — phase 2's stand-in for `random.nextFloat()`. */
  function hashF(salt, x, y, z) { return hash3(salt, x, y, z) * 2.3283064365386963e-10; }

  /** True when this state is something a feature is allowed to carve or overwrite. */
  function isSolid(st) { return st > 0 && NS.States.solid[st] === 1; }
  // D-415 — `Material.isLiquid()`, which `LakeFeature`'s own containment test asks of the shell
  // cells in the upper half. Water and lava are the only two in 1.18.2 (`07b_behaviour.js`'s own
  // note says the same), and a waterlogged block is not a liquid BLOCK: vanilla asks the block's
  // material, not its fluid state, in exactly this call.
  var liquidIds = null;
  function isLiquid(st) {
    if (!(st > 0)) return false;
    if (!liquidIds) {
      var R = NS.Reg;
      liquidIds = {};
      liquidIds[R.id.water] = 1; liquidIds[R.id.lava] = 1;
    }
    return liquidIds[NS.States.block[st]] === 1;
  }

  // D-418 — the two fluids by BLOCK, not by state: `water` has eight level states and a feature
  // asking "is this water" must say yes to all of them, the way `FluidState.is(FluidTags.WATER)`
  // does. `isLava` is the same question `placeDirtAndTree`'s own first clause asks.
  function isWaterBlock(st) { return st > 0 && NS.States.block[st] === NS.Reg.id.water; }
  function isLavaBlock(st) { return st > 0 && NS.States.block[st] === NS.Reg.id.lava; }

  /**
   * The block at a world position, from the chunk being written when it is in it and from the
   * PRE-FEATURE terrain when it is not (D-213). A feature precondition must reach the same
   * verdict in all nine target chunks, and `A.getBlock`'s -1 outside the chunk cannot do that.
   */
  function globalAt(A, SB, cx, cz, x, y, z) {
    var b = A.getBlock(SB, cx, cz, x, y, z);
    return b < 0 ? A.terrainAt(x, y, z) : b;
  }

  /**
   * A hand-written stand-in for a block tag the packed data references but W1 did not carry.
   * ⚠ Same shape of answer as 04j's own `TAGS` table and the same reason: the worldgen JSON
   * names tags, the tag files are not in the 37.8 KB blob, and a wrong tag is better caught here
   * by name than guessed at silently. Returns a `function(state) -> boolean`.
   */
  function nameSet(names) {
    var SR = NS.States, set = new Uint8Array(SR.count);
    for (var i = 0; i < names.length; i++) {
      var want = names[i], hit = 0;
      for (var s = 1; s < SR.count; s++) if (SR.name(s) === want) { set[s] = 1; hit++; }
      if (!hit) throw new Error('04n: the registry has no block named ' + want);
    }
    return function (st) { return st > 0 && set[st] === 1; };
  }

  // `#minecraft:features_cannot_replace` — the four the overworld can actually meet.
  var cannotReplace = null;
  function protectedBlock(st) {
    if (!cannotReplace) cannotReplace = nameSet(['bedrock', 'spawner', 'chest', 'trapped_chest']);
    return cannotReplace(st);
  }

  // ── LAKE ───────────────────────────────────────────────────────────────────────────────────
  //
  // Vanilla's `LakeFeature`, which is older than almost anything else in the roster and shows it.
  // Four to seven ellipsoids are unioned into a 16x16x8 boolean box; the bottom four layers of
  // the union become fluid, the top four become air (that is the lip you can walk into), and
  // every solid cell TOUCHING the union becomes the barrier block, so the lava cannot leak into
  // the cave it was carved next to. The result is a lens: wide, four deep, four of open air over.
  //
  // ⚠ Vanilla anchors the box at origin.below(4) and grows +16 in x and z, so the lake is a
  // quadrant away from its placement rather than around it. MC-Lite centres it — the same lens,
  // the same size, but a reach of 9 instead of 17, which halves the number of source chunks that
  // have to run it. The placement is `in_square` uniform over the chunk either way, so recentring
  // changes where lakes are by half a chunk and changes nothing about what they look like.
  F.register('lake', function (cfg, name) {
    var A = F.api;
    var fluidP = A.stateProvider(cfg.fluid, name + '.fluid');
    var barrierP = A.stateProvider(cfg.barrier, name + '.barrier');
    var IX = function (lx, lz, ly) { return ((lx << 4) | lz) * 8 + ly; };

    return {
      kind: 'lake', name: name, reach: 9,
      run: function (SB, cx, cz, x, y, z, r) {
        // ── phase 1: the shape, from `r`, before a single block is read ────────────────────
        var salt = r.next();
        // ⚠ ONE sample of each provider for the whole lake. Both are `simple_state_provider` in
        // the data, so this draws nothing; sampling per cell would consume `r` a variable number
        // of times if that ever changed, and 2048 cells is exactly where that would hurt.
        var fluid = fluidP(r, x, y, z), barrier = barrierP(r, x, y, z);
        var blob = new Uint8Array(2048);
        var n = r.nextInt(4) + 4, b, lx, ly, lz;
        for (b = 0; b < n; b++) {
          var sx = r.nextFloat() * 6 + 3, sy = r.nextFloat() * 4 + 2, sz = r.nextFloat() * 6 + 3;
          var ox = r.nextFloat() * (16 - sx - 2) + 1 + sx / 2;
          var oy = r.nextFloat() * (8 - sy - 4) + 2 + sy / 2;
          var oz = r.nextFloat() * (16 - sz - 2) + 1 + sz / 2;
          for (lx = 1; lx < 15; lx++) {
            var dx = (lx - ox) / (sx / 2), dxx = dx * dx;
            if (dxx >= 1) continue;
            for (lz = 1; lz < 15; lz++) {
              var dz = (lz - oz) / (sz / 2), dzz = dz * dz;
              if (dxx + dzz >= 1) continue;
              for (ly = 1; ly < 7; ly++) {
                var dy = (ly - oy) / (sy / 2);
                if (dxx + dy * dy + dzz < 1) blob[IX(lx, lz, ly)] = 1;
              }
            }
          }
        }

        // ── phase 1b: **THE CONTAINMENT TEST, WHICH WAS MISSING — D-415.** ────────────────
        //
        // Vanilla's `LakeFeature` walks the shell BEFORE it writes anything and RETURNS FALSE —
        // places no lake at all — if the shell is not sound:
        //
        //     if (k1 >= 4 && blockstate.getMaterial().isLiquid()) return false;
        //     if (k1 <  4 && !blockstate.getMaterial().isSolid()) return false;
        //
        // That test is the whole reason a vanilla lava lake has a stone wall on every side. The
        // barrier pass below only CONVERTS solid cells to the barrier block; where the shell cell
        // is already air — the lake was rolled against a cave, a ravine or another lake — there
        // is nothing to convert, and without this test the lake is dug anyway and the lava pours
        // straight out of the hole. Dan found exactly that: "some lava pools in worldgen aren't
        // contained, that is they lack a stone wall on one side".
        //
        // ⚠ AN UNREADABLE CELL DOES NOT ABORT. `A.getBlock` answers -1 outside the region this
        // source chunk may read, where vanilla reads the world freely. Aborting on -1 would throw
        // away every lake whose shell reaches past the readable box for reasons that have nothing
        // to do with the lake. The box is 16 wide and the feature's reach is 9, so -1 here is the
        // rare edge case, not the common one — and a lake that leaks through ONE unverifiable
        // cell is a far smaller wrong than no lakes at all.
        var bx = x - 8, by = y - 4, bz = z - 8, w = 0, i, cur;
        for (lx = 0; lx < 16; lx++) {
          for (lz = 0; lz < 16; lz++) {
            for (ly = 0; ly < 8; ly++) {
              i = IX(lx, lz, ly);
              if (blob[i]) continue;
              if (!((lx < 15 && blob[i + 128]) || (lx > 0 && blob[i - 128]) ||
                    (lz < 15 && blob[i + 8]) || (lz > 0 && blob[i - 8]) ||
                    (ly < 7 && blob[i + 1]) || (ly > 0 && blob[i - 1]))) continue;
              cur = A.getBlock(SB, cx, cz, bx + lx, by + ly, bz + lz);
              if (cur < 0) continue;                       // unreadable — see the note above
              if (ly >= 4) { if (isLiquid(cur)) return 0; }
              else if (!isSolid(cur)) return 0;
            }
          }
        }

        // ── phase 2: the walk. Centred on the placement, four fluid layers under four air. ──
        for (lx = 0; lx < 16; lx++) {
          for (lz = 0; lz < 16; lz++) {
            for (ly = 0; ly < 8; ly++) {
              if (!blob[IX(lx, lz, ly)]) continue;
              var wx = bx + lx, wy = by + ly, wz = bz + lz;
              if (ly < 4) {
                cur = A.getBlock(SB, cx, cz, wx, wy, wz);
                if (cur < 0 || protectedBlock(cur)) continue;
                w += A.setBlock(SB, cx, cz, wx, wy, wz, fluid);
              } else {
                // the open half: carve it, but only where there is something to carve
                cur = A.getBlock(SB, cx, cz, wx, wy, wz);
                if (cur > 0 && !protectedBlock(cur)) w += A.setBlock(SB, cx, cz, wx, wy, wz, 0);
              }
            }
          }
        }
        // the seal: every solid cell adjacent to the blob but not in it. ⚠ the 50% thinning of
        // the upper rim is vanilla's `random.nextInt(2)`, hashed here so all four passes agree.
        for (lx = 0; lx < 16; lx++) {
          for (lz = 0; lz < 16; lz++) {
            for (ly = 0; ly < 8; ly++) {
              i = IX(lx, lz, ly);
              if (blob[i]) continue;
              var adj = (lx < 15 && blob[i + 128]) || (lx > 0 && blob[i - 128]) ||
                        (lz < 15 && blob[i + 8]) || (lz > 0 && blob[i - 8]) ||
                        (ly < 7 && blob[i + 1]) || (ly > 0 && blob[i - 1]);
              if (!adj) continue;
              var sx2 = bx + lx, sy2 = by + ly, sz2 = bz + lz;
              if (ly >= 4 && (hash3(salt ^ 0x5EA1, sx2, sy2, sz2) & 1)) continue;
              cur = A.getBlock(SB, cx, cz, sx2, sy2, sz2);
              if (!isSolid(cur) || protectedBlock(cur)) continue;
              w += A.setBlock(SB, cx, cz, sx2, sy2, sz2, barrier);
            }
          }
        }
        return w;
      },
    };
  });

  // ── GEODE ──────────────────────────────────────────────────────────────────────────────────
  //
  // The one genuinely clever shape in the roster, and worth describing because the code below is
  // unreadable without it. Three or four DISTRIBUTION POINTS are scattered inside a small box.
  // Every cell in a 33³ box then scores itself as the sum of 1/sqrt(distance² + offset) to each
  // point — a metaball field, high near the points and falling off smoothly, so the union of
  // several points is one lumpy closed surface rather than several spheres. Four thresholds cut
  // that field into four nested shells, from the outside in:
  //
  //   d7 >= 1/sqrt(4.2+d0)   smooth basalt   the crust
  //   d7 >= 1/sqrt(3.2+d0)   calcite         the white middle layer
  //   d7 >= 1/sqrt(2.2+d0)   amethyst block  the lining — 8.3% of it BUDDING amethyst
  //   d7 >= 1/sqrt(1.7)      air             the cavity
  //
  // A second, sparser field of "crack points" cuts a hole through all four when it wins, which is
  // the fissure that lets you find a geode from a cave. Every budding block then sprouts buds and
  // clusters into the cavity on faces that came out air.
  //
  // ⚠ `noise_multiplier` 0.05 adds a small per-cell wobble to the field so the shells are not
  // perfectly smooth. Vanilla samples a NormalNoise seeded from the world seed; MC-Lite uses the
  // position hash for it, which is white rather than smooth and so roughens the surface by a cell
  // instead of undulating it. At 0.05 against thresholds around 0.5 it moves a boundary by at most
  // one block, and it costs a noise object per geode that would otherwise be built and thrown away.
  F.register('geode', function (cfg, name) {
    var A = F.api;
    var B = cfg.blocks;
    if (!B) throw new Error(name + ': geode has no `blocks`');
    var outerP = A.stateProvider(B.outer_layer_provider, name + '.outer');
    var middleP = A.stateProvider(B.middle_layer_provider, name + '.middle');
    var innerP = A.stateProvider(B.inner_layer_provider, name + '.inner');
    var altP = A.stateProvider(B.alternate_inner_layer_provider, name + '.alt_inner');
    var fillP = A.stateProvider(B.filling_provider, name + '.filling');
    // ⚠ the inner placements are BLOCK STATES with a `facing`, not a provider — a cluster on the
    // ceiling faces down. W8 has no "same block, this property" helper that is safe for every
    // block (04j says the same about `randomized_int_state_provider`), so every bud is placed in
    // its DEFAULT state and points up. It is the right block in the right cell with the wrong
    // rotation, which G17 fixes when states gain property setters.
    var buds = (B.inner_placements || []).map(function (s) {
      var st = A.stateOf(s.Name);
      if (!st) throw new Error(name + ': unknown inner placement ' + s.Name);
      return st;
    });
    var wallD = A.intProvider(cfg.outer_wall_distance, name + '.outer_wall_distance');
    var points = A.intProvider(cfg.distribution_points, name + '.distribution_points');
    var pointOff = A.intProvider(cfg.point_offset, name + '.point_offset');
    var L = cfg.layers || {};
    var lo = (cfg.min_gen_offset === undefined ? -16 : cfg.min_gen_offset) | 0;
    var hi = (cfg.max_gen_offset === undefined ? 16 : cfg.max_gen_offset) | 0;
    var noiseMul = +(cfg.noise_multiplier || 0);
    var altChance = +(cfg.use_alternate_layer0_chance || 0);
    var budChance = +(cfg.use_potential_placements_chance || 0);
    var C = cfg.crack || {};
    var crackChance = +(C.generate_crack_chance || 0);
    var crackSize = +(C.base_crack_size || 0);
    var crackOff = +(C.crack_point_offset || 0);
    // `outer_wall_distance` is a uniform 4..6 and vanilla divides by its MAX, which the compiled
    // provider does not expose — read it back off the config, which is where vanilla reads it too.
    var wallMax = (cfg.outer_wall_distance && cfg.outer_wall_distance.value &&
                   cfg.outer_wall_distance.value.max_inclusive) | 0;
    if (!wallMax) throw new Error(name + ': outer_wall_distance is not a uniform int provider');
    var DX = [1, -1, 0, 0, 0, 0], DY = [0, 0, 1, -1, 0, 0], DZ = [0, 0, 0, 0, 1, -1];

    return {
      kind: 'geode', name: name, reach: (hi > -lo ? hi : -lo) + 1,
      run: function (SB, cx, cz, x, y, z, r) {
        // ── phase 1 ────────────────────────────────────────────────────────────────────────
        var salt = r.next();
        var k = points(r), i, j;
        var d0 = k / wallMax;
        var t1 = 1 / Math.sqrt(L.filling);                 // cavity
        var t2 = 1 / Math.sqrt(L.inner_layer + d0);        // amethyst lining
        var t3 = 1 / Math.sqrt(L.middle_layer + d0);       // calcite
        var t4 = 1 / Math.sqrt(L.outer_layer + d0);        // smooth basalt crust
        var px = [], py = [], pz = [], po = [];
        for (i = 0; i < k; i++) {
          px.push(x + wallD(r)); py.push(y + wallD(r)); pz.push(z + wallD(r)); po.push(pointOff(r));
        }
        var cracked = r.nextFloat() < crackChance;
        var t5 = 1 / Math.sqrt(crackSize + r.nextFloat() / 2 + (k > 3 ? d0 : 0));
        // the crack: a short vertical line of points off one of the four sides, so the fissure
        // opens sideways rather than straight up through the roof.
        var qx = [], qy = [], qz = [];
        if (cracked) {
          var side = r.nextInt(4), s2 = k * 2 + 1;
          var ax = (side === 0 ? s2 : (side === 1 ? -s2 : 0));
          var az = (side === 2 ? s2 : (side === 3 ? -s2 : 0));
          for (i = 0; i < 3; i++) { qx.push(x + ax); qy.push(y + [7, 5, 1][i]); qz.push(z + az); }
        }
        var outer = outerP(r, x, y, z), middle = middleP(r, x, y, z);
        var inner = innerP(r, x, y, z), alt = altP(r, x, y, z), fill = fillP(r, x, y, z);

        // ── phase 2: the field, clipped to the target chunk (+1 for buds that reach into it) ─
        var ox0 = cx << 4, oz0 = cz << 4;
        var xa = x + lo, xb = x + hi, za = z + lo, zb = z + hi;
        if (xa < ox0 - 1) xa = ox0 - 1;
        if (xb > ox0 + 16) xb = ox0 + 16;
        if (za < oz0 - 1) za = oz0 - 1;
        if (zb > oz0 + 16) zb = oz0 + 16;
        var w = 0, wx, wy, wz, dx, dy, dz;
        for (wx = xa; wx <= xb; wx++) {
          for (wz = za; wz <= zb; wz++) {
            for (wy = y + lo; wy <= y + hi; wy++) {
              var nv = (hashF(salt ^ 0x9E01, wx, wy, wz) * 2 - 1) * noiseMul;
              var f = 0;
              for (i = 0; i < k; i++) {
                dx = wx - px[i]; dy = wy - py[i]; dz = wz - pz[i];
                f += 1 / Math.sqrt(dx * dx + dy * dy + dz * dz + po[i]) + nv;
              }
              if (f < t4) continue;                        // outside the crust entirely
              var cur = A.getBlock(SB, cx, cz, wx, wy, wz);
              if (cur < 0 || protectedBlock(cur)) continue;
              if (cracked) {
                var g = 0;
                for (j = 0; j < qx.length; j++) {
                  dx = wx - qx[j]; dy = wy - qy[j]; dz = wz - qz[j];
                  g += 1 / Math.sqrt(dx * dx + dy * dy + dz * dz + crackOff) + nv;
                }
                if (g >= t5 && f < t1) { w += A.setBlock(SB, cx, cz, wx, wy, wz, 0); continue; }
              }
              if (f >= t1) { w += A.setBlock(SB, cx, cz, wx, wy, wz, fill); continue; }
              if (f >= t2) {
                var budding = hashF(salt ^ 0xA71E, wx, wy, wz) < altChance;
                w += A.setBlock(SB, cx, cz, wx, wy, wz, budding ? alt : inner);
                // ⚠ buds grow off BUDDING amethyst only (`placements_require_layer0_alternate`),
                // into whichever of the six faces the cavity already opened. The face test is a
                // block read, so it decides WHETHER; the 35% roll and which bud is a hash, so it
                // decides WHAT and every pass agrees.
                if (budding && buds.length) {
                  for (i = 0; i < 6; i++) {
                    if (hashF(salt ^ (0x5B00 + i), wx, wy, wz) >= budChance) continue;
                    var nx = wx + DX[i], ny = wy + DY[i], nz = wz + DZ[i];
                    if (A.getBlock(SB, cx, cz, nx, ny, nz) !== 0) continue;
                    w += A.setBlock(SB, cx, cz, nx, ny, nz,
                                    buds[hash3(salt ^ 0x2F1B, nx, ny, nz) % buds.length]);
                  }
                }
                continue;
              }
              if (f >= t3) { w += A.setBlock(SB, cx, cz, wx, wy, wz, middle); continue; }
              w += A.setBlock(SB, cx, cz, wx, wy, wz, outer);
            }
          }
        }
        return w;
      },
    };
  });

  // ── FOSSIL ─────────────────────────────────────────────────────────────────────────────────
  //
  // ⚠ NOT IMPLEMENTABLE FROM THE DATA MC-LITE HAS, and this is the honest failure rather than a
  // shortcut. `fossil_coal` and `fossil_diamonds` do not describe a shape at all: they name eight
  // STRUCTURE TEMPLATES (`minecraft:fossil/spine_1`, `.../skull_3`, …) plus eight coal/diamond
  // overlays, and a fossil IS whichever of those .nbt files the roll picks. W1 packs eleven
  // worldgen registries — noise, biome, configured/placed feature, template_pool, processor_list
  // — and structure templates are in none of them, because they are NBT block arrays in the jar's
  // `data/minecraft/structures/`, not JSON. There is nothing here to read.
  //
  // The alternative would be to invent a bone shape and call it a fossil, which is exactly the
  // "silently place something else" this pipeline's `unsupported` table exists to prevent. So it
  // throws by name at COMPILE time: `fossil_lower` and `fossil_upper` are reported as unsupported
  // with this sentence, and G-whatever gives them a template reader or nothing at all.
  F.register('fossil', function (cfg, name) {
    var n = (cfg.fossil_structures || []).length;
    throw new Error(name + ': a fossil is ' + n + ' structure templates (' +
      (cfg.fossil_structures || ['?'])[0] + ' …), and MC-Lite packs no structure registry — ' +
      'W1 carries eleven JSON worldgen registries and templates are NBT block arrays in none of them');
  });

  // ── FOREST ROCK ────────────────────────────────────────────────────────────────────────────
  //
  // Vanilla's `BlockBlobFeature`: three overlapping ellipsoids of radius 0 or 1 on each axis,
  // each one drifting up to a block back and down from the last, all of mossy cobblestone. That
  // is the boulder in an old-growth spruce taiga. Tiny, but it is the only feature in the game
  // whose whole config is one block name.
  //
  // ⚠ Vanilla walks DOWN from the placement while the block below is air, to sit the boulder on
  // the ground. That walk is a block read and would answer differently in each target chunk, so
  // MC-Lite takes the ground from W3 instead: the placement's `heightmap` modifier already put
  // `y` one above the surface, so `y - 1` IS the top solid block, exactly, with no reads at all.
  F.register('forest_rock', function (cfg, name) {
    var A = F.api;
    var stateP = A.stateProvider(
      cfg.state && cfg.state.Name ? { type: 'minecraft:simple_state_provider', state: cfg.state }
                                  : cfg.state_provider, name + '.state');
    return {
      kind: 'forest_rock', name: name, reach: 4,
      run: function (SB, cx, cz, x, y, z, r) {
        var st = stateP(r, x, y, z);
        var bx = x, by = y - 1, bz = z, w = 0;
        for (var l = 0; l < 3; l++) {
          var ri = r.nextInt(2), rj = r.nextInt(2), rk = r.nextInt(2);
          var f = (ri + rj + rk) * 0.333 + 0.5, ff = f * f;
          for (var dx = -ri; dx <= ri; dx++) {
            for (var dy = -rj; dy <= rj; dy++) {
              for (var dz = -rk; dz <= rk; dz++) {
                if (dx * dx + dy * dy + dz * dz > ff) continue;
                var cur = A.getBlock(SB, cx, cz, bx + dx, by + dy, bz + dz);
                if (cur < 0 || protectedBlock(cur)) continue;
                w += A.setBlock(SB, cx, cz, bx + dx, by + dy, bz + dz, st);
              }
            }
          }
          bx += r.nextInt(2) - 1; by -= r.nextInt(2); bz += r.nextInt(2) - 1;
        }
        return w;
      },
    };
  });

  // ── DESERT WELL ────────────────────────────────────────────────────────────────────────────
  //
  // No config at all — the shape is hard-coded in `DesertWellFeature` and so it is here. A 5x5
  // sandstone slab two deep, a plus of water in the middle of it, a slab on each edge midpoint,
  // four corner pillars three high, and a 3x3 sandstone-and-slab roof. One in a thousand desert
  // chunks. It is the only feature in the overworld whose entire definition is `{}`.
  F.register('desert_well', function (cfg, name) {
    var A = F.api;
    var SANDSTONE = A.stateOf('sandstone'), SLAB = A.stateOf('sandstone_slab'), WATER = A.stateOf('water');
    if (!SANDSTONE || !SLAB || !WATER) throw new Error(name + ': the registry is missing sandstone, its slab, or water');
    return {
      kind: 'desert_well', name: name, reach: 3,
      run: function (SB, cx, cz, x, y, z) {
        // ⚠ the placement's `heightmap` put y one above the sand; the well's own origin is the
        // surface block itself, so the basin is flush with the dune rather than floating on it.
        var by = y - 1, w = 0, i, j;
        var put = function (dx, dy, dz, st) {
          var cur = A.getBlock(SB, cx, cz, x + dx, by + dy, z + dz);
          if (cur < 0 || protectedBlock(cur)) return;
          w += A.setBlock(SB, cx, cz, x + dx, by + dy, z + dz, st);
        };
        for (j = -1; j <= 0; j++) for (i = -2; i <= 2; i++) for (var k = -2; k <= 2; k++) put(i, j, k, SANDSTONE);
        put(0, 0, 0, WATER); put(1, 0, 0, WATER); put(-1, 0, 0, WATER);
        put(0, 0, 1, WATER); put(0, 0, -1, WATER);
        for (i = -2; i <= 2; i++) for (j = -2; j <= 2; j++)
          if (i === -2 || i === 2 || j === -2 || j === 2) put(i, 0, j, SANDSTONE);
        put(2, 0, 0, SLAB); put(-2, 0, 0, SLAB); put(0, 0, 2, SLAB); put(0, 0, -2, SLAB);
        for (i = -1; i <= 1; i++) for (j = -1; j <= 1; j++)
          put(i, 4, j, (i === 0 && j === 0) ? SANDSTONE : SLAB);
        for (i = 1; i <= 3; i++) {
          put(-1, i, -1, SANDSTONE); put(-1, i, 1, SANDSTONE);
          put(1, i, -1, SANDSTONE); put(1, i, 1, SANDSTONE);
        }
        return w;
      },
    };
  });

  // ── MONSTER ROOM ───────────────────────────────────────────────────────────────────────────
  //
  // Also configless. A hollow box, half-width 2 or 3 on each horizontal axis and four blocks of
  // interior tall, walled in cobblestone with a floor that is three-quarters MOSSY cobblestone —
  // the mossy fraction is the whole visual signature of a dungeon and it is one `nextInt(4)`.
  //
  // ⚠ WHAT IS MISSING, SAID PLAINLY: vanilla puts a mob spawner at the centre and up to two loot
  // chests against the walls, and BOTH are block entities — an NBT tag naming a mob, and a loot
  // table rolled on first open. This build has no block entities and no loot tables (PLAN G2/G17),
  // so the spawner is placed as a bare `spawner` BLOCK — the right block in the right cell, an
  // empty cage that will never spawn anything — and the chests are not placed at all, because a
  // `chest` block with no inventory behind it is a lie in a way an empty cage is not. The room,
  // its moss, and its silhouette are right; what lives in it is G17's.
  F.register('monster_room', function (cfg, name) {
    var A = F.api;
    var COBBLE = A.stateOf('cobblestone'), MOSSY = A.stateOf('mossy_cobblestone'), SPAWNER = A.stateOf('spawner');
    if (!COBBLE || !MOSSY) throw new Error(name + ': the registry is missing cobblestone or its mossy form');
    if (!SPAWNER) throw new Error(name + ': the registry has no spawner block');
    return {
      kind: 'monster_room', name: name, reach: 5,
      run: function (SB, cx, cz, x, y, z, r) {
        var salt = r.next();
        var hx = r.nextInt(2) + 2 + 1, hz = r.nextInt(2) + 2 + 1;   // wall offsets, 3 or 4
        // ⚠ D-141 — VANILLA ABORTS THE WHOLE ROOM, AND THE GATE MAY NOT READ BLOCKS.
        //
        // `MonsterRoomFeature` walks the whole footprint first: floor and ceiling solid
        // everywhere, and between one and five open cells around the walls — no opening at all
        // and the dungeon is a sealed box nobody will ever find, more than five and it is
        // hanging in a cave. Session 4 found this build had no gate at all: 158 of its spawners
        // stood in open air over 169 chunks, and it made 5.5 dungeons a chunk where vanilla
        // makes one every several chunks.
        //
        // The footprint spans up to four chunks and `run` is entered once per chunk (D-136), so
        // a gate that reads blocks answers differently in each pass and tears the room in half.
        // Every term below is therefore a PURE function of position — the same answer in all
        // four passes, by construction:
        //
        //   underground   `Column.height` (W3), the same call the placement chain uses (D-134)
        //   an opening    `Gen.isCave`, W7's cheese field, which is pure noise. It is not the
        //                 whole cave system — the worms and ravines are random walks and cannot
        //                 be asked pointwise — so this is vanilla's rule with a smaller mouth:
        //                 a room needs a cheese cave beside it, not any cave. Rooms that vanilla
        //                 would have opened onto a tunnel are lost, and that is the cheapening.
        // ⚠⚠ **THE OCEAN FLOOR, NOT THE WORLD SURFACE, AND AT THE CORNERS AS WELL AS THE
        // CENTRE — D-415, "random patches of air underwater".** `heightmapY(0, ...)` is
        // WORLD_SURFACE, which under an ocean is `seaLevel + 1` however shallow the seabed
        // actually is. A room dug into a seabed at y 58 under water to y 62 therefore read a
        // "top" of 64, passed this gate, and was then built by the loop below — whose wall pass
        // only converts cells that were ALREADY SOLID, so the water side of the room got no wall
        // at all and the interior carve left a five-by-four pocket of AIR with the sea sitting
        // directly on top of it. Dan found them from inside: "random patches of air underwater".
        //
        // Vanilla's own gate is `MonsterRoomFeature`'s first walk — `if (i1 == -1 && !solid)
        // return false; if (i1 == 4 && !solid) return false;` — the floor layer and the ceiling
        // layer must be solid over the WHOLE footprint, which is exactly what is missing. That
        // walk is block reads across up to four chunks, which D-141 says this gate may not do,
        // so it is expressed the way every other term here is: as `Column.height`, a pure
        // function of position (D-134), asked at the centre and at the four corners of the
        // footprint. OCEAN_FLOOR is the solid ground; a room must be under it everywhere, not
        // just under the water line, and not just at the one column it was rolled on.
        var CORNERS = [[0, 0], [-hx, -hz], [hx, -hz], [-hx, hz], [hx, hz]];
        for (var ci2 = 0; ci2 < CORNERS.length; ci2++) {
          if (A.heightmapY(1, x + CORNERS[ci2][0], z + CORNERS[ci2][1]) <= y + 5) return 0;
        }
        var opens = 0;
        for (var oi = 0; oi < 4; oi++) {
          var ox2 = oi === 0 ? -hx : (oi === 1 ? hx : 0);
          var oz2 = oi === 2 ? -hz : (oi === 3 ? hz : 0);
          if (NS.Gen.isCave(x + ox2, y, z + oz2) || NS.Gen.isCave(x + ox2, y + 1, z + oz2)) opens++;
        }
        if (opens < 1 || opens > 3) return 0;              // sealed, or hanging in the open
        var w = 0, dx, dy, dz;
        for (dx = -hx; dx <= hx; dx++) {
          for (dz = -hz; dz <= hz; dz++) {
            for (dy = -1; dy <= 3; dy++) {
              var wx = x + dx, wy = y + dy, wz = z + dz;
              var cur = A.getBlock(SB, cx, cz, wx, wy, wz);
              if (cur < 0 || protectedBlock(cur)) continue;
              var wall = (dx === -hx || dx === hx || dz === -hz || dz === hz || dy === -1);
              if (!wall) { if (cur > 0) w += A.setBlock(SB, cx, cz, wx, wy, wz, 0); continue; }
              // ⚠ a wall cell is only built where there was already something to build into —
              // vanilla's "don't hang the room in mid-air over a cave" rule, and the one place a
              // block read is allowed to decide, because it decides WHETHER and not WHAT.
              if (!isSolid(cur)) continue;
              var mossy = (dy === -1) && (hash3(salt ^ 0x30551, wx, wy, wz) % 4) !== 0;
              w += A.setBlock(SB, cx, cz, wx, wy, wz, mossy ? MOSSY : COBBLE);
            }
          }
        }
        // The cage itself is the one thing only ONE chunk can write — it is a single cell — so
        // it may read: no floor under it and no ceiling over the room, no spawner. That is the
        // remainder of vanilla's abort, applied where reading is safe.
        var fl = A.getBlock(SB, cx, cz, x, y - 1, z), rf = A.getBlock(SB, cx, cz, x, y + 4, z);
        if (isSolid(fl) && isSolid(rf) && A.getBlock(SB, cx, cz, x, y, z) >= 0) {
          w += A.setBlock(SB, cx, cz, x, y, z, SPAWNER);
          // loop/spawner-s114 -- `DungeonFeature.getMobSpawnerEntity` (.decomp:26-28,
          // 134-136): skeleton 1/4, zombie 2/4, spider 1/4 (`07zs_spawner.js`'s own
          // `Spawner.DUNGEON_ENTITIES`/`pickDungeonEntity`). No-ops (NS.Spawner absent)
          // in the real WORKER bundle -- 07zs_spawner.js's own header names the gap.
          // #167: in the worker bundle the pick is recorded in Gen.spawnerLog instead, and
          // rides gen:done -> World.installChunk -> Spawner.assign on the main thread.
          var DE = ['skeleton', 'zombie', 'zombie', 'spider'];
          var spawnerEntity = NS.Spawner ? NS.Spawner.pickDungeonEntity(function (b) { return r.nextInt(b); })
                                         : DE[r.nextInt(DE.length)];
          if (NS.Spawner && NS.Spawner.assign) NS.Spawner.assign(x, y, z, spawnerEntity);
          else if (NS.Gen && NS.Gen.spawnerLog) NS.Gen.spawnerLog.push([x, y, z, spawnerEntity]);
        }
        return w;
      },
    };
  });

  // ── ROOT SYSTEM ────────────────────────────────────────────────────────────────────────────
  //
  // The rooted azalea: a tree growing on the SURFACE whose roots reach down through the stone into
  // a lush cave, which is why the placement scans upward for a ceiling and then offsets back down.
  // Three parts — a column of rooted dirt from the cave roof up to the tree, hanging roots dangling
  // out of the underside of it, and the azalea tree itself at the top.
  //
  // ⚠ Vanilla finds the tree's y by walking UP to a hundred blocks testing each cell against
  // `allowed_tree_position`, which is block reads all the way and so is target-dependent. MC-Lite
  // takes the surface from W3's `Column.height` in one call — the same answer, before features,
  // per D-134 — and refuses the whole thing if the surface is further than `root_column_max_height`
  // above, which is the same bound vanilla's loop enforces.
  F.register('root_system', function (cfg, name) {
    var A = F.api;
    var tree = A.inline(cfg.feature, name);
    if (!tree) {
      throw new Error(name + ': its tree feature (' +
        ((cfg.feature && (cfg.feature.feature || cfg.feature.type)) || '?') +
        ') is not implemented yet — roots with no tree on them would be a hole full of dirt');
    }
    var rootP = A.stateProvider(cfg.root_state_provider, name + '.root');
    var hangP = A.stateProvider(cfg.hanging_root_state_provider, name + '.hanging_root');
    var rootRadius = cfg.root_radius | 0;
    var rootTries = cfg.root_placement_attempts | 0;
    var maxColumn = cfg.root_column_max_height | 0;
    var hangRadius = cfg.hanging_root_radius | 0;
    var hangTries = cfg.hanging_root_placement_attempts | 0;
    var hangSpan = cfg.hanging_roots_vertical_span | 0;
    // D-418 — `required_vertical_space_for_tree` / `allowed_vertical_water_for_tree`, both read
    // from the configured feature rather than assumed: they are 3 and 2 for the azalea and the
    // rule is written in terms of them, not of those two numbers.
    var vertSpace = cfg.required_vertical_space_for_tree === undefined
      ? 0 : (cfg.required_vertical_space_for_tree | 0);
    var vertWater = cfg.allowed_vertical_water_for_tree === undefined
      ? 0 : (cfg.allowed_vertical_water_for_tree | 0);
    // ⚠ `#minecraft:azalea_root_replaceable` is a tag W1 does not carry (see `nameSet`): the
    // stone and dirt families a root is allowed to bore through, hand-written and named here so a
    // wrong list is a visible wrong list rather than a silent one.
    var replaceable = nameSet(['stone', 'granite', 'diorite', 'andesite', 'tuff', 'deepslate',
                               'dirt', 'coarse_dirt', 'podzol', 'grass_block', 'mycelium',
                               'rooted_dirt', 'moss_block', 'gravel', 'clay', 'sand']);
    var treeReach = F.reachOf(tree.gen);
    return {
      kind: 'root_system', name: name,
      reach: Math.max(rootRadius, hangRadius, treeReach) + 1,
      run: function (SB, cx, cz, x, y, z, r) {
        var salt = r.next();
        var top = A.heightmapY(0, x, z);              // first free cell above the surface
        if (top - y > maxColumn || top <= y) return 0;
        // ⚠⚠ **THE TREE MUST HAVE SOMETHING TO STAND ON — D-418.** Dan reported azalea trees
        // growing on water. They were: over a pond in a badlands, `heightmapY` returns the cell
        // ABOVE the water, this feature planted the tree there, `isFree` then refused every log
        // (water is not free) and let every LEAF through, so what shipped was a canopy hanging
        // in the air with no trunk under it at all.
        //
        // ⚠ THE RULE IS `cyr`'s, READ OUT OF THE 1.18.2 BYTECODE THIS SESSION.
        // `RootSystemFeature.placeDirtAndTree` — `cyr.a(cbn,cqr,dat,Random,gj$a,gj)`, offsets
        // 53–88 — is, once the tree position is allowed:
        //     BlockPos below = mut.below();
        //     if (level.getFluidState(below).is(LAVA)
        //         || !level.getBlockState(below).getMaterial().isSolid()) return false;
        // and it is a **return false for the whole feature**, not a `continue` to the next
        // candidate height. `spaceForTree` (`cyr.a(cbn,dat,gj)`) then walks
        // `required_vertical_space_for_tree` cells up and tests each against
        // `isAllowedTreeSpace(state, i, allowed_vertical_water_for_tree)` — `cyr.a(cov,int,int)`:
        //     if (state.isAir()) return true;
        //     return i + 1 <= allowedVerticalWater && state.getFluidState().is(WATER);
        // so with the azalea's own 3 and 2, the first cell above the base may be water and the
        // two above it may not.
        //
        // ⚠ THE ORIGIN'S OWN `isAir` TEST (`cyr.a(cxi)`'s first four instructions) IS NOT PORTED,
        // and that is deliberate rather than missed: the origin is in a CAVE, and a cave is
        // carved by a 240-block random walk that no point query can answer (D-213). The
        // placement's own `environment_scan` with `allowed_search_condition: air` is what
        // guarantees it, one layer up, where the question can be asked purely.
        var below = globalAt(A, SB, cx, cz, x, top - 1, z);
        if (isLavaBlock(below) || !isSolid(below)) return 0;
        for (var si = 1; si <= vertSpace; si++) {
          var sst = globalAt(A, SB, cx, cz, x, top + si - 1, z);
          if (sst === 0) continue;                                  // air: always allowed
          if (!(si + 1 <= vertWater && isWaterBlock(sst))) return 0;
        }
        var w = 0, i, wx, wy, wz, cur;
        // the column: `root_placement_attempts` scattered cells per level, so it is a ragged
        // shaft rather than a drilled one. Hashed offsets, not `r`, so all passes drill alike.
        for (wy = y; wy < top; wy++) {
          for (i = 0; i < rootTries; i++) {
            var h = hash3(salt ^ (0x0B00 + i), x, wy, z);
            wx = x + (h % rootRadius) - ((h >>> 8) % rootRadius);
            wz = z + ((h >>> 16) % rootRadius) - ((h >>> 24) % rootRadius);
            cur = A.getBlock(SB, cx, cz, wx, wy, wz);
            if (cur < 0 || !replaceable(cur)) continue;
            w += A.setBlock(SB, cx, cz, wx, wy, wz, rootP(A.rngAt(salt, wx, wy, wz), wx, wy, wz));
          }
        }
        // the hanging roots, dangling out of the underside into the cave below the placement
        for (i = 0; i < hangTries; i++) {
          var h2 = hash3(salt ^ (0x4A00 + i), x, y, z);
          wx = x + (h2 % hangRadius) - ((h2 >>> 6) % hangRadius);
          wz = z + ((h2 >>> 12) % hangRadius) - ((h2 >>> 18) % hangRadius);
          wy = y - ((h2 >>> 24) % (hangSpan + 1));
          if (A.getBlock(SB, cx, cz, wx, wy, wz) !== 0) continue;
          if (!isSolid(A.getBlock(SB, cx, cz, wx, wy + 1, wz))) continue;
          w += A.setBlock(SB, cx, cz, wx, wy, wz, hangP(A.rngAt(salt, wx, wy, wz), wx, wy, wz));
        }
        return w + A.runInline(tree, SB, cx, cz, x, top, z, r);
      },
    };
  });

  // ── BLOCK PILE ─────────────────────────────────────────────────────────────────────────────
  //
  // A heap two blocks tall in a 5x5-to-7x7 footprint, thinning towards the edges: a cell is filled
  // when its squared radius falls under `nextFloat()*10 - nextFloat()*6`, which is a random
  // threshold per cell rather than a fixed disc, so the outline is ragged and different every
  // time. A 3.1% second chance scatters a few strays outside it. Hay bales, melons, pumpkins,
  // snow and ice all use it; only the state provider differs.
  //
  // ⚠ Both thresholds and the provider draw are hashed per cell, not drawn from `r`, so a pile on
  // a chunk border is the same pile from both sides. `A.rngAt(salt, x, y, z)` is the pipeline's
  // own pure position-seeded rng, which is what makes `pile_ice`'s 5:1 packed/blue split work per
  // block instead of per pile.
  F.register('block_pile', function (cfg, name) {
    var A = F.api;
    var stateP = A.stateProvider(cfg.state_provider, name + '.state_provider');
    return {
      kind: 'block_pile', name: name, reach: 4,
      run: function (SB, cx, cz, x, y, z, r) {
        var salt = r.next();
        var hx = 2 + r.nextInt(2), hz = 2 + r.nextInt(2), w = 0;
        for (var dx = -hx; dx <= hx; dx++) {
          for (var dz = -hz; dz <= hz; dz++) {
            var d = dx * dx + dz * dz;
            for (var dy = 0; dy <= 1; dy++) {
              var wx = x + dx, wy = y + dy, wz = z + dz;
              var thr = hashF(salt ^ 0x91FE, wx, wy, wz) * 10 - hashF(salt ^ 0x77A3, wx, wy, wz) * 6;
              if (d > thr && hashF(salt ^ 0x1C0F, wx, wy, wz) >= 0.031) continue;
              if (A.getBlock(SB, cx, cz, wx, wy, wz) !== 0) continue;
              if (!isSolid(A.getBlock(SB, cx, cz, wx, wy - 1, wz))) continue;
              w += A.setBlock(SB, cx, cz, wx, wy, wz, stateP(A.rngAt(salt, wx, wy, wz), wx, wy, wz));
            }
          }
        }
        return w;
      },
    };
  });

})(MCL);
