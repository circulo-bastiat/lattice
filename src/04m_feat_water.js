// 04m_feat_water.js — WATER AND WET GROUND (PLAN W8d). Eight feature types, all of them about
// the same question: where does the ground stop and the water start?
//
//   seagrass / kelp / sea_pickle    the sea floor's plants — one block, a stalk, a cluster
//   bamboo                          the one DRY member, here because it is the same shape of
//                                   generator as kelp: a column grown until something stops it
//   vegetation_patch                the lush-cave moss and clay floors, and their ceilings
//   waterlogged_vegetation_patch    the same, then flooded — the clay pool with the dripleaves
//   underwater_magma                magma in the floor of a drowned cave
//   spring_feature                  the one-block source that starts a waterfall
//
// ── ⚠ THE PURITY RULE, AND WHY IT COSTS A LITTLE REALISM ──────────────────────────────────────
//
// `run` is called ONCE PER TARGET CHUNK the placement can reach, with the same (x,y,z) and an
// identically seeded rng, and the union of what it writes is what the player sees. So the
// SEQUENCE OF RANDOM DRAWS MUST NOT DEPEND ON WHAT THE TARGET CHUNK CAN SEE. `A.getBlock`
// returns -1 outside the target, so a generator that branches its rng on a block read would
// draw a different stalk height in the chunk on the left than in the chunk on the right, and
// the two halves would not agree on the same tree.
//
// Vanilla is free to interleave draws and reads because it holds the whole region. MC-Lite is
// not, so every generator here DRAWS FIRST AND READS SECOND: a stalk's height, a patch's per
// column depth, a pickle's count are all sampled before any block is looked at, and the reads
// then only decide whether the already-decided shape gets written. Where vanilla would have
// skipped a draw (an edge column that failed its chance roll never sampled a depth), this draws
// it and throws it away. The shape is vanilla's; the exact sequence is not, and cannot be —
// vanilla's is compiled Java.
//
// The second half of the same rule: when a read a generator NEEDS lands outside the target
// chunk, the honest answer is "not mine to judge" — write nothing and let the target that owns
// that block decide. That is what `runInline`'s predicate stage already does, and it is why a
// spring one block outside the target is silently skipped rather than guessed at.
//
// ── ⚠ BLOCK STATES WITH PROPERTIES, WITHOUT A PROPERTY-NAME TABLE ─────────────────────────────
//
// Tall seagrass has an upper half, kelp has an age, a sea pickle has a count and bamboo has
// leaves — and `States.stateOf` only ever hands back a block's DEFAULT state, because the
// registry drops property NAMES at build time (02c: "900 blocks of them is 40 KB nobody
// needs"). What survives is `States.withLocal(name, i)`, the i-th state of a block in vanilla's
// own ordering: properties in declaration order, the LAST one varying fastest, booleans
// enumerating as [true, false]. That ordering is enough to address the six states this file
// actually needs, and `localState` below refuses to guess when the registry's state COUNT for a
// block is not the number that ordering predicts — it falls back to the default state, which is
// the right block with the wrong pose rather than a wrong block.
(function (NS) {
  'use strict';

  var F = NS.Features;

  // ── shared helpers ───────────────────────────────────────────────────────────────────────

  /**
   * The i-th state of a block, guarded by how many states that block is supposed to have.
   * ⚠ `expect` is the arithmetic's own sanity check: if a future registry build gives `bamboo`
   * anything other than 2*3*2 states, the local index below is meaningless and we say so by
   * placing the default rather than placing whatever happens to sit at that index.
   */
  function localState(name, idx, expect, what) {
    var R = NS.Reg, S = NS.States;
    var b = R.id[name];
    if (b === undefined) throw new Error(what + ': the registry has no block ' + name);
    var n = R.realFirst[b + 1] - R.realFirst[b];
    if (n !== expect) return S.stateOf(name);
    return S.withLocal(name, idx);
  }

  /** A "is this block one of these names" test, over every state of each named block. */
  function anyOf(names) {
    return F.compilePredicate({ predicate_type: 'matching_blocks', blocks: names });
  }

  function solidAt(st) { return st > 0 && NS.States.solid[st] === 1; }

  /**
   * The largest value an int provider can hand back. `reach` has to be a compile-time constant
   * and the compiled provider is an opaque function, so this reads the RAW config instead —
   * the same five provider shapes 04j knows how to compile.
   */
  function maxOf(v, dflt) {
    if (v === undefined || v === null) return dflt;
    if (typeof v === 'number') return v | 0;
    var t = String(v.type || '').replace('minecraft:', '');
    if (t === 'constant') return v.value | 0;
    if (t === 'uniform' || t === 'biased_to_bottom') return v.value.max_inclusive | 0;
    if (t === 'clamped') return v.value.max_inclusive | 0;
    if (t === 'weighted_list') {
      var m = 0;
      for (var i = 0; i < v.distribution.length; i++) m = Math.max(m, maxOf(v.distribution[i].data, dflt));
      return m;
    }
    return dflt;
  }

  // ── seagrass ─────────────────────────────────────────────────────────────────────────────
  //
  // Vanilla's `SeagrassFeature`: ONE attempt per call, at a bell-shaped offset of
  // `nextInt(8) - nextInt(8)` in x and z, dropped onto the ocean floor there. `probability` is
  // the chance of the two-block tall variant. The four configured features are the same code
  // with probability 0.3 (short), 0.4 (river), 0.6 (swamp) and 0.8 (deep) — the placed feature
  // repeats it 80 times with a `count`, which is where a warm ocean's carpet comes from.
  F.register('seagrass', function (cfg, name) {
    var A = F.api;
    var prob = cfg.probability === undefined ? 0 : +cfg.probability;
    var SHORT = A.stateOf('seagrass');
    var TALL_LOWER = localState('tall_seagrass', 1, 2, name);   // half=LOWER, vanilla's default
    var TALL_UPPER = localState('tall_seagrass', 0, 2, name);   // enum order is UPPER, LOWER
    var isWater = anyOf(['minecraft:water']);
    return {
      kind: 'seagrass', reach: 9,
      run: function (SB, cx, cz, x, y, z, r) {
        var dx = r.nextInt(8) - r.nextInt(8);
        var dz = r.nextInt(8) - r.nextInt(8);
        var tall = r.nextFloat() < prob;                       // ⚠ drawn before any read
        var wx = x + dx, wz = z + dz;
        var wy = A.heightmapY(1, wx, wz);                      // 1 = OCEAN_FLOOR, a pure function
        var at = A.getBlock(SB, cx, cz, wx, wy, wz);
        if (at < 0 || !isWater(at)) return 0;
        var below = A.getBlock(SB, cx, cz, wx, wy - 1, wz);
        if (below < 0 || !solidAt(below)) return 0;            // canSurvive: needs a sturdy floor
        if (!tall) return A.setBlock(SB, cx, cz, wx, wy, wz, SHORT);
        var above = A.getBlock(SB, cx, cz, wx, wy + 1, wz);
        // ⚠ the head may be in the chunk above; -1 there means "cannot tell", and vanilla would
        // have placed nothing rather than a headless lower half, so neither do we.
        if (above < 0 || !isWater(above)) return 0;
        return A.setBlock(SB, cx, cz, wx, wy, wz, TALL_LOWER)
             + A.setBlock(SB, cx, cz, wx, wy + 1, wz, TALL_UPPER);
      },
    };
  });

  // ── kelp ─────────────────────────────────────────────────────────────────────────────────
  //
  // `KelpFeature`: a stalk from the sea floor upward, 1..10 blocks of `kelp_plant` capped by one
  // `kelp` head. It stops one short of the surface because each step needs water at the position
  // AND water above it, which is what keeps kelp from breaking the waves.
  F.register('kelp', function (cfg, name) {
    var A = F.api;
    var PLANT = A.stateOf('kelp_plant');
    var isWater = anyOf(['minecraft:water']);
    // ⚠ the head's AGE (20..23 in vanilla) decides how much longer it may still grow in a live
    // world. Kelp has 26 states, one per age, and the local index IS the age.
    var HEADS = [localState('kelp', 20, 26, name), localState('kelp', 21, 26, name),
                 localState('kelp', 22, 26, name), localState('kelp', 23, 26, name)];
    return {
      kind: 'kelp', reach: 2,
      run: function (SB, cx, cz, x, y, z, r) {
        var height = 1 + r.nextInt(10);
        var head = HEADS[r.nextInt(4)];                        // ⚠ drawn before any read
        var wy = A.heightmapY(1, x, z);
        var below = A.getBlock(SB, cx, cz, x, wy - 1, z);
        if (below < 0 || !solidAt(below)) return 0;
        var n = 0;
        for (var j = 0; j <= height; j++) {
          var here = A.getBlock(SB, cx, cz, x, wy, z);
          var over = A.getBlock(SB, cx, cz, x, wy + 1, z);
          if (here < 0 || over < 0) return n;                  // ran out of this chunk
          if (isWater(here) && isWater(over)) {
            n += A.setBlock(SB, cx, cz, x, wy, z, j === height ? head : PLANT);
          } else {
            // hit the surface (or a ceiling) early: vanilla caps the stalk it already grew by
            // turning the last plant block into a head, so the stalk is never left topless.
            if (j > 0) n += A.setBlock(SB, cx, cz, x, wy - 1, z, head);
            return n;
          }
          wy++;
        }
        return n;
      },
    };
  });

  // ── sea pickle ───────────────────────────────────────────────────────────────────────────
  //
  // `SeaPickleFeature`: `count` attempts (20), each the same bell-shaped ±7 offset as seagrass,
  // each a cluster of 1..4 pickles on the floor. The placed feature is behind a 1-in-16 rarity
  // filter, so a warm ocean gets a scatter of clusters rather than a field.
  F.register('sea_pickle', function (cfg, name) {
    var A = F.api;
    var count = A.intProvider(cfg.count === undefined ? 20 : cfg.count, name + '.count');
    // sea_pickle is PICKLES(1..4) x WATERLOGGED(bool); the boolean varies fastest and enumerates
    // [true, false], so local = (pickles-1)*2 and the waterlogged half is the one we want.
    var PICKLES = [localState('sea_pickle', 0, 8, name), localState('sea_pickle', 2, 8, name),
                   localState('sea_pickle', 4, 8, name), localState('sea_pickle', 6, 8, name)];
    var isWater = anyOf(['minecraft:water']);
    return {
      kind: 'sea_pickle', reach: 9,
      run: function (SB, cx, cz, x, y, z, r) {
        var tries = count(r), n = 0;
        for (var i = 0; i < tries; i++) {
          var dx = r.nextInt(8) - r.nextInt(8);
          var dz = r.nextInt(8) - r.nextInt(8);
          var st = PICKLES[r.nextInt(4)];                      // ⚠ drawn before the reads
          var wx = x + dx, wz = z + dz;
          var wy = A.heightmapY(1, wx, wz);
          var at = A.getBlock(SB, cx, cz, wx, wy, wz);
          if (at < 0 || !isWater(at)) continue;
          var below = A.getBlock(SB, cx, cz, wx, wy - 1, wz);
          if (below < 0 || !solidAt(below)) continue;
          n += A.setBlock(SB, cx, cz, wx, wy, wz, st);
        }
        return n;
      },
    };
  });

  // ── bamboo ───────────────────────────────────────────────────────────────────────────────
  //
  // `BambooFeature`: a 5..16 stalk of leafless trunk, then the top four blocks re-stamped with
  // leaves — two LARGE at the tip, two SMALL below them. `probability` is the chance that the
  // stalk also stains a disc of ground around it to podzol, which is why a bamboo jungle's floor
  // goes dark in patches instead of uniformly.
  F.register('bamboo', function (cfg, name) {
    var A = F.api;
    var prob = cfg.probability === undefined ? 0 : +cfg.probability;
    // bamboo is AGE(0..1) x LEAVES(NONE,SMALL,LARGE) x STAGE(0..1), STAGE varying fastest:
    // local = age*6 + leaves*2 + stage. The feature builds from age=1.
    var TRUNK = localState('bamboo', 1 * 6 + 0 * 2 + 0, 12, name);
    var SMALL = localState('bamboo', 1 * 6 + 1 * 2 + 1, 12, name);
    var LARGE = localState('bamboo', 1 * 6 + 2 * 2 + 1, 12, name);
    var PODZOL = A.stateOf('podzol');
    var isDirt = anyOf(['minecraft:dirt', 'minecraft:grass_block', 'minecraft:podzol',
                        'minecraft:coarse_dirt', 'minecraft:mycelium', 'minecraft:rooted_dirt',
                        'minecraft:moss_block']);
    // vanilla's #bamboo_plantable_on, minus the blocks the registry does not carry
    var plantable = anyOf(['minecraft:dirt', 'minecraft:grass_block', 'minecraft:podzol',
                           'minecraft:coarse_dirt', 'minecraft:mycelium', 'minecraft:rooted_dirt',
                           'minecraft:moss_block', 'minecraft:sand', 'minecraft:red_sand',
                           'minecraft:gravel']);
    return {
      kind: 'bamboo', reach: 5,
      run: function (SB, cx, cz, x, y, z, r) {
        var height = r.nextInt(12) + 5;
        var podzol = r.nextFloat() < prob;
        var rad = r.nextInt(4) + 1;                            // ⚠ all three drawn up front
        var n = 0;
        var here = A.getBlock(SB, cx, cz, x, y, z);
        var under = A.getBlock(SB, cx, cz, x, y - 1, z);
        if (here < 0 || under < 0) return 0;
        if (here !== 0 || !plantable(under)) return 0;
        if (podzol) {
          for (var lx = -rad; lx <= rad; lx++) {
            for (var lz = -rad; lz <= rad; lz++) {
              if (lx * lx + lz * lz > rad * rad) continue;
              var gx = x + lx, gz = z + lz;
              var gy = A.heightmapY(0, gx, gz) - 1;            // 0 = WORLD_SURFACE
              var g = A.getBlock(SB, cx, cz, gx, gy, gz);
              if (g > 0 && isDirt(g)) n += A.setBlock(SB, cx, cz, gx, gy, gz, PODZOL);
            }
          }
        }
        var wy = y, grown = 0;
        for (var j = 0; j < height; j++) {
          if (A.getBlock(SB, cx, cz, x, wy, z) !== 0) break;
          n += A.setBlock(SB, cx, cz, x, wy, z, TRUNK);
          wy++; grown++;
        }
        // ⚠ `grown` is the stalk's height AS SEEN FROM THIS TARGET CHUNK; a stalk whose base is
        // in the neighbour reports 0 here and grows its own leaves over there. Only the target
        // holding the base is entitled to decide where the tip is, and it is the same target
        // that will write the tip, so the leaves land exactly once.
        if (grown >= 3) {
          n += A.setBlock(SB, cx, cz, x, wy - 1, z, LARGE);
          n += A.setBlock(SB, cx, cz, x, wy - 2, z, LARGE);
          if (grown >= 4) n += A.setBlock(SB, cx, cz, x, wy - 3, z, SMALL);
          if (grown >= 5) n += A.setBlock(SB, cx, cz, x, wy - 4, z, SMALL);
        }
        return n;
      },
    };
  });

  // ── vegetation patch, and its flooded twin ───────────────────────────────────────────────
  //
  // `VegetationPatchFeature` is the lush cave in one class. It walks a rounded rectangle of
  // columns, finds the floor (or the ceiling) under each one, lays `depth` blocks of
  // `ground_state` into it, and then grows `vegetation_feature` out of a `vegetation_chance`
  // fraction of them. `moss_patch` is a moss floor with azalea on it, `moss_patch_ceiling` is
  // the same upside down with cave vines hanging off it, and `clay_with_dripleaves` is a clay
  // floor. The waterlogged variant then turns every ground block that is NOT exposed on a side
  // into water, which is what hollows the clay slab into a pool.
  //
  // ⚠ `replaceable` is a TAG, and 04j's four hand-written tag sets do not include the two lush
  // ones. They are expanded here, in the file that needs them, rather than reached for across a
  // module boundary; PLAN G1's tag substrate is where they eventually belong.
  var MOSS_REPLACEABLE = ['minecraft:stone', 'minecraft:granite', 'minecraft:diorite',
    'minecraft:andesite', 'minecraft:tuff', 'minecraft:deepslate',
    'minecraft:cave_vines', 'minecraft:cave_vines_plant',
    'minecraft:dirt', 'minecraft:grass_block', 'minecraft:podzol', 'minecraft:coarse_dirt',
    'minecraft:mycelium', 'minecraft:rooted_dirt', 'minecraft:moss_block'];
  var LUSH_GROUND_REPLACEABLE = MOSS_REPLACEABLE.concat(
    ['minecraft:clay', 'minecraft:gravel', 'minecraft:sand']);

  function replaceableOf(tag, name) {
    if (typeof tag !== 'string') throw new Error(name + ': `replaceable` is not a tag name');
    if (tag === '#minecraft:moss_replaceable') return anyOf(MOSS_REPLACEABLE);
    if (tag === '#minecraft:lush_ground_replaceable') return anyOf(LUSH_GROUND_REPLACEABLE);
    if (tag.charAt(0) === '#') {
      throw new Error(name + ': block tag ' + tag + ' has no hand-written expansion (needs G1)');
    }
    return anyOf([tag]);
  }

  function vegetationPatch(flooded) {
    return function (cfg, name) {
      var A = F.api;
      if (cfg.surface !== 'floor' && cfg.surface !== 'ceiling') {
        throw new Error(name + ': unknown patch surface ' + cfg.surface);
      }
      var dirY = cfg.surface === 'floor' ? -1 : 1;             // the direction of the SEARCH
      var depth = A.intProvider(cfg.depth === undefined ? 1 : cfg.depth, name + '.depth');
      var xz = A.intProvider(cfg.xz_radius, name + '.xz_radius');
      var vertRange = cfg.vertical_range === undefined ? 1 : cfg.vertical_range | 0;
      var vegChance = +(cfg.vegetation_chance || 0);
      var edgeChance = +(cfg.extra_edge_column_chance || 0);
      var bottomChance = +(cfg.extra_bottom_block_chance || 0);
      var ground = A.stateProvider(cfg.ground_state, name + '.ground_state');
      var replaceable = replaceableOf(cfg.replaceable, name);
      var veg = null;
      if (cfg.vegetation_feature) {
        veg = A.inline(cfg.vegetation_feature, name);
        if (!veg) throw new Error(name + ': its vegetation feature is not implemented yet');
      }
      var WATER = A.stateOf('water');
      var maxR = maxOf(cfg.xz_radius, 7) + 1;
      var reach = maxR + 1 + (veg ? F.reachOf(veg.gen) : 0);

      return {
        kind: 'vegetation_patch', reach: reach,
        run: function (SB, cx, cz, x, y, z, r) {
          var rx = xz(r) + 1, rz = xz(r) + 1;
          var n = 0;
          // the ground blocks this call actually laid, and the vegetation the flooded variant
          // holds back until the pool exists
          var gxs = [], gys = [], gzs = [], vx = [], vy = [], vz = [], vs = [];
          for (var dx = -rx; dx <= rx; dx++) {
            var edgeX = (dx === -rx || dx === rx);
            for (var dz = -rz; dz <= rz; dz++) {
              var edgeZ = (dz === -rz || dz === rz);
              var corner = edgeX && edgeZ;
              var edgeOnly = (edgeX || edgeZ) && !corner;
              // ⚠ EVERY column draws its four randoms, in this order, whatever happens to it —
              // see the purity rule at the top. Vanilla skips the ones it does not need.
              var edgeRoll = r.nextFloat();
              var d = depth(r) + ((bottomChance > 0 && r.nextFloat() < bottomChance) ? 1 : 0);
              var vegRoll = r.nextFloat();
              var vegSeed = r.next();
              var gst = ground(r, x + dx, y, z + dz);
              if (corner) continue;
              if (edgeOnly && !(edgeChance !== 0 && edgeRoll <= edgeChance)) continue;

              var wx = x + dx, wz = z + dz, wy = y, b = 0, k;
              // walk in the search direction while the column is empty...
              for (k = 0; k < vertRange; k++) {
                b = A.getBlock(SB, cx, cz, wx, wy, wz);
                if (b < 0) break;
                if (b !== 0) break;
                wy += dirY;
              }
              if (b < 0) continue;                             // outside: not ours to judge
              // ...then back out of whatever solid it walked into
              for (k = 0; k < vertRange; k++) {
                b = A.getBlock(SB, cx, cz, wx, wy, wz);
                if (b < 0) break;
                if (b === 0) break;
                wy -= dirY;
              }
              if (b < 0) continue;
              if (A.getBlock(SB, cx, cz, wx, wy, wz) !== 0) continue;
              var gy = wy + dirY;
              var face = A.getBlock(SB, cx, cz, wx, gy, wz);
              if (face < 0 || !solidAt(face)) continue;        // needs a sturdy face to build on

              // lay `d` blocks of ground into the surface, stopping at the first block the
              // patch is not allowed to replace
              var laid = 0;
              for (var i = 0; i < d; i++) {
                var yy = gy + i * dirY;
                var cur = A.getBlock(SB, cx, cz, wx, yy, wz);
                if (cur < 0) break;
                if (cur !== gst) {
                  if (!replaceable(cur)) break;
                  n += A.setBlock(SB, cx, cz, wx, yy, wz, gst);
                }
                laid++;
              }
              if (!laid) continue;
              gxs.push(wx); gys.push(gy); gzs.push(wz);

              if (veg && vegChance > 0 && vegRoll < vegChance) {
                if (flooded) {
                  // ⚠ held back until after the flooding pass, so the plant is put into the
                  // pool rather than under it — vanilla's waterlogged subclass does the same.
                  vx.push(wx); vy.push(wy); vz.push(wz); vs.push(vegSeed);
                } else {
                  n += A.runInline(veg, SB, cx, cz, wx, wy, wz, A.rngAt(vegSeed, wx, wy, wz));
                }
              }
            }
          }

          if (!flooded) return n;

          // ⚠ THE POOL. A ground block with a non-sturdy neighbour to the side or below is the
          // rim of the slab and stays clay; everything fully enclosed becomes water. That is
          // what turns a flat clay disc into a bowl with a puddle in it.
          for (var g = 0; g < gxs.length; g++) {
            var px = gxs[g], py = gys[g], pz = gzs[g];
            var exposed = false, unknown = false;
            var nb = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]];
            for (var q = 0; q < 5; q++) {
              var s = A.getBlock(SB, cx, cz, px + nb[q][0], py + nb[q][1], pz + nb[q][2]);
              if (s < 0) { unknown = true; break; }
              if (!solidAt(s)) { exposed = true; break; }
            }
            if (unknown || exposed) continue;
            n += A.setBlock(SB, cx, cz, px, py, pz, WATER);
          }
          for (var v = 0; v < vx.length; v++) {
            n += A.runInline(veg, SB, cx, cz, vx[v], vy[v], vz[v],
                             A.rngAt(vs[v], vx[v], vy[v], vz[v]));
          }
          return n;
        },
      };
    };
  }
  F.register('vegetation_patch', vegetationPatch(false));
  F.register('waterlogged_vegetation_patch', vegetationPatch(true));

  // ── underwater magma ─────────────────────────────────────────────────────────────────────
  //
  // `UnderwaterMagmaFeature`. The placed feature drops the position BELOW the ocean floor, so
  // this only ever fires inside a drowned cave or an aquifer pocket: it looks down for the
  // bottom of the water column it is standing in, then sprinkles magma through a small box
  // around that floor, keeping only cells that are buried but touch water on a side.
  F.register('underwater_magma', function (cfg, name) {
    var A = F.api;
    var searchRange = cfg.floor_search_range === undefined ? 5 : cfg.floor_search_range | 0;
    var rad = cfg.placement_radius_around_floor === undefined ? 1 : cfg.placement_radius_around_floor | 0;
    var chance = cfg.placement_probability_per_valid_position === undefined
      ? 0 : +cfg.placement_probability_per_valid_position;
    var MAGMA = A.stateOf('magma_block');
    var isWater = anyOf(['minecraft:water']);
    function watery(SB, cx, cz, x, y, z) {
      var b = A.getBlock(SB, cx, cz, x, y, z);
      if (b < 0) return -1;                                    // unknown
      return (b === 0 || isWater(b)) ? 1 : 0;
    }
    return {
      kind: 'underwater_magma', reach: rad + searchRange + 1,
      run: function (SB, cx, cz, x, y, z, r) {
        // ⚠ the random filter is FIRST in vanilla's stream, so a float is drawn for every cell
        // of the box whether or not it turns out to be placeable — which happens to be exactly
        // the draw-first discipline this file needs anyway.
        var span = rad * 2 + 1, rolls = new Array(span * span * span), i = 0;
        for (i = 0; i < rolls.length; i++) rolls[i] = r.nextFloat();

        // the bottom of the water column we are standing in
        var here = A.getBlock(SB, cx, cz, x, y, z);
        if (here < 0 || !isWater(here)) return 0;
        var floorY = -2147483648;
        for (var d = 1; d <= searchRange; d++) {
          var b = A.getBlock(SB, cx, cz, x, y - d, z);
          if (b < 0) return 0;
          if (!isWater(b)) { floorY = y - d; break; }
        }
        if (floorY === -2147483648) return 0;

        var n = 0; i = 0;
        for (var dx = -rad; dx <= rad; dx++) {
          for (var dy = -rad; dy <= rad; dy++) {
            for (var dz = -rad; dz <= rad; dz++) {
              var roll = rolls[i++];
              if (roll >= chance) continue;
              var px = x + dx, py = floorY + dy, pz = z + dz;
              if (watery(SB, cx, cz, px, py, pz) !== 0) continue;        // must be buried
              if (watery(SB, cx, cz, px, py - 1, pz) !== 0) continue;    // on something buried
              var open = false;
              if (watery(SB, cx, cz, px + 1, py, pz) === 1) open = true;
              else if (watery(SB, cx, cz, px - 1, py, pz) === 1) open = true;
              else if (watery(SB, cx, cz, px, py, pz + 1) === 1) open = true;
              else if (watery(SB, cx, cz, px, py, pz - 1) === 1) open = true;
              if (!open) continue;                             // must face the water
              n += A.setBlock(SB, cx, cz, px, py, pz, MAGMA);
            }
          }
        }
        return n;
      },
    };
  });

  // ── spring ───────────────────────────────────────────────────────────────────────────────
  //
  // `SpringFeature`, and the whole feature is a five-way census. The position must have a valid
  // block above it (and, if `requires_block_below`, below it), must itself be air or valid, and
  // then of its four sides plus its floor EXACTLY `rock_count` must be valid blocks and EXACTLY
  // `hole_count` must be air. 4 and 1 is a source walled in on every side but one — which is why
  // a spring is always a waterfall out of a cave wall rather than a puddle in the open.
  //
  // ⚠ `state` in the data is a FLUID state (`{Name: water, Properties: {falling: true}}`), not a
  // block state; vanilla converts it with `createLegacyBlock`, and for the source fluid that is
  // simply the block's default. Reading it as a block state would look up a `falling` property
  // that `minecraft:water` the BLOCK does not have, so the name alone is what is used.
  F.register('spring_feature', function (cfg, name) {
    var A = F.api;
    var fluidName = cfg.state && cfg.state.Name;
    if (!fluidName) throw new Error(name + ': spring has no fluid state');
    var FLUID = A.stateOf(fluidName);
    if (!FLUID) throw new Error(name + ': unknown spring fluid ' + fluidName);
    var valid = anyOf(Array.isArray(cfg.valid_blocks) ? cfg.valid_blocks : [cfg.valid_blocks]);
    var rockCount = cfg.rock_count === undefined ? 4 : cfg.rock_count | 0;
    var holeCount = cfg.hole_count === undefined ? 1 : cfg.hole_count | 0;
    var needBelow = !!cfg.requires_block_below;
    return {
      kind: 'spring', reach: 2,
      run: function (SB, cx, cz, x, y, z, r) {
        // ⚠ SEVEN READS AND NO DRAWS. If any of them lands outside the target chunk the census
        // cannot be taken honestly, so nothing is written and the target that owns those blocks
        // takes it instead. A spring on the very edge of a chunk is therefore lost rather than
        // guessed — reach 2 keeps the loss to the outermost column.
        var above = A.getBlock(SB, cx, cz, x, y + 1, z);
        if (above < 0 || !valid(above)) return 0;
        var below = A.getBlock(SB, cx, cz, x, y - 1, z);
        if (below < 0) return 0;
        if (needBelow && !valid(below)) return 0;
        var here = A.getBlock(SB, cx, cz, x, y, z);
        if (here < 0) return 0;
        if (here !== 0 && !valid(here)) return 0;

        var sides = [A.getBlock(SB, cx, cz, x - 1, y, z), A.getBlock(SB, cx, cz, x + 1, y, z),
                     A.getBlock(SB, cx, cz, x, y, z - 1), A.getBlock(SB, cx, cz, x, y, z + 1),
                     below];
        var rock = 0, hole = 0;
        for (var i = 0; i < 5; i++) {
          var s = sides[i];
          if (s < 0) return 0;
          if (valid(s)) rock++;
          if (s === 0) hole++;
        }
        if (rock !== rockCount || hole !== holeCount) return 0;
        return A.setBlock(SB, cx, cz, x, y, z, FLUID);
      },
    };
  });

})(MCL);
