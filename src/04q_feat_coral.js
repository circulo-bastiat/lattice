// 04q_feat_coral.js — CORAL, AND THE FLOWER THAT IS NOT A FLOWER (PLAN W8d). Four feature types
// that close the last of the overworld's configured features:
//
//   coral_tree / coral_claw / coral_mushroom   the three shapes a warm ocean's reef is built of
//   no_bonemeal_flower                         `random_patch` under a fourth type name
//
// ── ⚠ WHAT THE CONFIGS ACTUALLY SAY ──────────────────────────────────────────────────────────
//
// The three coral configs are EMPTY — `{}`, no fields at all. Everything is in the Java: the
// feature picks ONE coral family at random out of the five (tube, brain, bubble, fire, horn) and
// builds its whole shape out of that family's coral block, then decorates the result with coral
// PLANTS and WALL FANS drawn independently from the tags, so a tube-coral tree wears brain-coral
// fans. `no_bonemeal_flower`'s config is a `random_patch` config down to the field names —
// `feature`, `tries`, `xz_spread`, `y_spread` — because in vanilla it IS the same class; the
// separate type name only tells the bone-meal code not to grow more of it.
//
// ── ⚠ THE PURITY RULE, AND THE ONE PLACE IT COSTS SHAPE ──────────────────────────────────────
//
// `run` is called once per TARGET chunk the placement can reach, with the same (x,y,z) and an
// identically seeded rng, so the SEQUENCE OF DRAWS MUST NOT DEPEND ON WHAT THE TARGET CAN SEE.
// Vanilla's coral features cannot be transcribed literally: `placeCoralBlock` draws its
// decoration rolls ONLY when the cell turned out to be placeable, and every branch loop BREAKS
// the moment a cell fails — so in vanilla the number of draws is a function of the blocks, which
// is exactly what is not allowed here.
//
// So this file splits each feature in two. Phase one draws the ENTIRE shape and every decoration
// roll for every cell of it, reading nothing. Phase two walks that finished shape and lets the
// blocks decide which cells actually get written. The cost is that a branch which vanilla would
// have cut short at the first obstacle here keeps going past it — a reef grows a little more
// freely around a rock than Mojang's would. The shape is vanilla's; the truncation is not.
//
// ── ⚠ LIVE CORAL, DEAD CORAL, AND "NOT MINE TO JUDGE" ────────────────────────────────────────
//
// Coral only lives submerged. A cell holding WATER gets the live block; a cell holding AIR — the
// tip of a reef that broke the surface — gets that family's DEAD block, which is what a live
// world would decay it to anyway. A cell holding anything else is solid ground and is skipped.
// A cell OUTSIDE the target chunk reads back -1, which is not "air": it is "cannot tell", and
// the honest answer is to write nothing and let the target that owns that block decide, exactly
// as `runInline`'s predicate stage does.
(function (NS) {
  'use strict';

  var F = NS.Features;

  var FAMS = ['tube', 'brain', 'bubble', 'fire', 'horn'];

  // ── directions ───────────────────────────────────────────────────────────────────────────
  //
  // ⚠ 0..3 are the four horizontals IN VANILLA'S OWN PROPERTY ORDER — `Direction.values()`
  // filtered to the horizontal plane is NORTH, SOUTH, WEST, EAST — because that index is also
  // the `facing` index of a coral wall fan's block state. 4 and 5 are UP and DOWN, which have no
  // fan and are only ever used to move.
  var DX = [0, 0, -1, 1, 0, 0];
  var DY = [0, 0, 0, 0, 1, -1];
  var DZ = [-1, 1, 0, 0, 0, 0];
  var OPP = [1, 0, 3, 2, 5, 4];
  var CW = [3, 2, 0, 1];              // N->E, S->W, W->N, E->S
  var CCW = [2, 3, 1, 0];             // N->W, S->E, W->S, E->N
  var UP = 4;

  /**
   * The i-th state of a block, guarded by how many states that block is supposed to have — the
   * same guard 04m uses. ⚠ `expect` is the arithmetic's sanity check: if a future registry build
   * gives a wall fan anything but 4x2 states the index below is meaningless, and we say so by
   * placing the default (right block, wrong pose) rather than whatever sits at that index.
   */
  function localState(name, idx, expect) {
    var R = NS.Reg, S = NS.States;
    var b = R.id[name];
    if (b === undefined) throw new Error('coral: the registry has no block ' + name);
    if (R.realFirst[b + 1] - R.realFirst[b] !== expect) return S.stateOf(name);
    return S.withLocal(name, idx);
  }

  /**
   * The five families, resolved once at registration.
   *
   * ⚠ The state indices lean on one rule and one measurement. The rule is 04m's: properties in
   * order, the LAST varying fastest, booleans as [true, false] — so a coral fan's two states are
   * waterlogged-true then waterlogged-false, and a wall fan's eight are facing x waterlogged,
   * `facing * 2 + (waterlogged ? 0 : 1)`. The measurement is that every one of these blocks
   * reports its DEFAULT at local index 0, which is vanilla's waterlogged-true, north-facing
   * default — so the rule and the registry agree on the one state we can check.
   */
  function palette() {
    var S = NS.States, out = [];
    for (var i = 0; i < FAMS.length; i++) {
      var f = FAMS[i];
      var wet = [], dry = [];
      for (var d = 0; d < 4; d++) {
        wet.push(localState(f + '_coral_wall_fan', d * 2, 8));
        dry.push(localState('dead_' + f + '_coral_wall_fan', d * 2 + 1, 8));
      }
      out.push({
        block: S.stateOf(f + '_coral_block'),
        deadBlock: S.stateOf('dead_' + f + '_coral_block'),
        plant: localState(f + '_coral', 0, 2),                   // waterlogged
        deadPlant: localState('dead_' + f + '_coral', 1, 2),     // not waterlogged
        wall: wet, deadWall: dry,
      });
    }
    return out;
  }

  /** A sea pickle of n (1..4), waterlogged — `pickles` then `waterlogged`, the latter fastest. */
  function pickle(n) { return localState('sea_pickle', ((n - 1) * 2) | 0, 8); }

  // ── phase one: the shape ─────────────────────────────────────────────────────────────────
  //
  // A CELL is one coral block of the shape plus every decoration roll vanilla would have drawn
  // for it. All of it is drawn here, before a single block is read.
  function cell(cs, x, y, z, r) {
    var c = { x: x, y: y, z: z, plant: -1, pick: 0, fan: [-1, -1, -1, -1] };
    // the top: 25% a coral plant of any family, else 5% a sea pickle of 1..4
    if (r.nextFloat() < 0.25) c.plant = r.nextInt(5);
    else if (r.nextFloat() < 0.05) c.pick = r.nextInt(4) + 1;
    for (var d = 0; d < 4; d++) if (r.nextFloat() < 0.2) c.fan[d] = r.nextInt(5);
    cs.push(c);
    return c;
  }

  /** Fisher-Yates over a small array of direction indices, with our own rng. */
  function shuffle(a, r) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = r.nextInt(i + 1), t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /** `CoralTreeFeature`: a 1..3 trunk, then 2..4 branches that climb away from its top. */
  function shapeTree(r, x, y, z) {
    var cs = [], i;
    var h = r.nextInt(3) + 1;
    for (i = 0; i < h; i++) cell(cs, x, y + i, z, r);
    var bx = x, by = y + h, bz = z;
    var n = r.nextInt(3) + 2;
    var dirs = shuffle([0, 1, 2, 3], r);
    for (var b = 0; b < n; b++) {
      var d = dirs[b];
      var cx = bx + DX[d], cy = by, cz = bz + DZ[d];
      var len = r.nextInt(5) + 2, run = 0;
      for (i = 0; i < len; i++) {
        cell(cs, cx, cy, cz, r);
        run++; cy++;
        // ⚠ vanilla's `n == 0 || m >= 2 && nextFloat() < 0.25`: the branch always steps outward
        // once, then only after two blocks of climb, which is what gives it the elbow.
        if (i === 0 || (run >= 2 && r.nextFloat() < 0.25)) { cx += DX[d]; cz += DZ[d]; run = 0; }
      }
    }
    return cs;
  }

  /** `CoralClawFeature`: one root, then 2..3 arms that reach out and hook upward. */
  function shapeClaw(r, x, y, z) {
    var cs = [], i;
    cell(cs, x, y, z, r);
    var d0 = r.nextInt(4);
    var arms = r.nextInt(2) + 2;
    var list = shuffle([d0, CW[d0], CCW[d0]], r);
    for (var a = 0; a < arms; a++) {
      var d = list[a];
      var cx = x, cy = y, cz = z;
      var j = r.nextInt(2) + 1, step, k;
      cx += DX[d]; cy += DY[d]; cz += DZ[d];
      if (d === d0) { step = d0; k = r.nextInt(3) + 2; }
      else { cy += 1; step = r.nextInt(2) ? UP : d; k = r.nextInt(3) + 3; }
      for (i = 0; i < j; i++) {
        cell(cs, cx, cy, cz, r);
        cx += DX[step]; cy += DY[step]; cz += DZ[step];
      }
      var o = OPP[step];
      cx += DX[o]; cy += DY[o] + 1; cz += DZ[o];
      for (i = 0; i < k; i++) {
        cx += DX[d0]; cz += DZ[d0];
        cell(cs, cx, cy, cz, r);
        if (r.nextFloat() < 0.25) cy++;
      }
    }
    return cs;
  }

  /** `CoralMushroomFeature`: the hollow SHELL of a 4..6 cube, one face in ten left open. */
  function shapeMushroom(r, x, y, z) {
    var cs = [];
    var ei = r.nextInt(3) + 3, ej = r.nextInt(3) + 3, ek = r.nextInt(3) + 3;
    var down = r.nextInt(3) + 1;
    for (var m = 0; m <= ej; m++) {
      for (var n = 0; n <= ei; n++) {
        for (var o = 0; o <= ek; o++) {
          var edgeM = (m === 0 || m === ej), edgeN = (n === 0 || n === ei), edgeO = (o === 0 || o === ek);
          // ⚠ vanilla's four-clause filter: keep the SHELL but drop the twelve edges of the cube,
          // which is what rounds the box into a cap.
          if ((!edgeM || !edgeN) && (!edgeO || !edgeN) && (!edgeM || !edgeO) &&
              (edgeM || edgeN || edgeO) && !(r.nextFloat() < 0.1)) {
            cell(cs, x + m, y + n - down, z + o, r);
          }
        }
      }
    }
    return cs;
  }

  // ── phase two: the blocks ────────────────────────────────────────────────────────────────

  function makeCoral(shape, kind, reach) {
    return function (cfg, name) {
      var A = F.api;
      var P = palette();
      var isWater = F.compilePredicate({ predicate_type: 'matching_blocks', blocks: ['minecraft:water'] });
      var PICKLE = [0, pickle(1), pickle(2), pickle(3), pickle(4)];
      return {
        kind: kind, reach: reach, name: name,
        run: function (SB, cx, cz, x, y, z, r) {
          var fam = r.nextInt(FAMS.length);         // ⚠ the family, before anything else
          var cs = shape(r, x, y, z);               // ⚠ the whole shape, still reading nothing
          var pal = P[fam], wrote = 0;
          for (var i = 0; i < cs.length; i++) {
            var c = cs[i];
            var at = A.getBlock(SB, cx, cz, c.x, c.y, c.z);
            if (at < 0) continue;                   // not mine to judge
            var wet = isWater(at, c.x, c.y, c.z);
            if (!wet && at !== 0) continue;         // solid ground: vanilla would have failed here
            wrote += A.setBlock(SB, cx, cz, c.x, c.y, c.z, wet ? pal.block : pal.deadBlock);
            var up = A.getBlock(SB, cx, cz, c.x, c.y + 1, c.z);
            if (up === 0 || (up > 0 && isWater(up, c.x, c.y + 1, c.z))) {
              var upWet = up !== 0;
              if (c.plant >= 0) {
                wrote += A.setBlock(SB, cx, cz, c.x, c.y + 1, c.z,
                                    upWet ? P[c.plant].plant : P[c.plant].deadPlant);
              } else if (c.pick && upWet) {
                wrote += A.setBlock(SB, cx, cz, c.x, c.y + 1, c.z, PICKLE[c.pick]);
              }
            }
            for (var d = 0; d < 4; d++) {
              if (c.fan[d] < 0) continue;
              var fx = c.x + DX[d], fy = c.y, fz = c.z + DZ[d];
              var side = A.getBlock(SB, cx, cz, fx, fy, fz);
              if (side < 0) continue;
              // ⚠ the fan HANGS OFF this block, so its `facing` is the direction it points AWAY
              // from the coral — vanilla's `pos.relative(dir)` with FACING = dir.
              if (side > 0 && isWater(side, fx, fy, fz)) {
                wrote += A.setBlock(SB, cx, cz, fx, fy, fz, P[c.fan[d]].wall[d]);
              } else if (side === 0 && !wet) {
                wrote += A.setBlock(SB, cx, cz, fx, fy, fz, P[c.fan[d]].deadWall[d]);
              }
            }
          }
          return wrote;
        },
      };
    };
  }

  F.register('coral_tree', makeCoral(shapeTree, 'coral_tree', 9));
  F.register('coral_claw', makeCoral(shapeClaw, 'coral_claw', 10));
  F.register('coral_mushroom', makeCoral(shapeMushroom, 'coral_mushroom', 8));

  // ── no_bonemeal_flower ───────────────────────────────────────────────────────────────────
  //
  // ⚠ The SAME config and the same behaviour as `random_patch`; the type name only exists so
  // that bone meal on the ground below a lily of the valley does not spawn more of them. Return
  // 04j's own `patch` shape rather than a `run`, so `place` and `reachOf` handle it as what it
  // is instead of as a stranger with an unknown reach.
  F.register('no_bonemeal_flower', function (cfg, name) {
    var A = F.api;
    var inl = A.inline(cfg.feature, name);
    if (!inl) throw new Error(name + ': its inner feature is not implemented yet');
    return { kind: 'patch', inl: inl, name: name,
             tries: cfg.tries === undefined ? 128 : cfg.tries | 0,
             xz: cfg.xz_spread === undefined ? 7 : cfg.xz_spread | 0,
             ys: cfg.y_spread === undefined ? 3 : cfg.y_spread | 0 };
  });

})(MCL);
