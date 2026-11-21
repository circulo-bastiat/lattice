// 04k_feat_trees.js — `minecraft:tree` (PLAN W8c). One generator, 27 configured trees.
//
// A tree in 1.18 is not a shape, it is four pluggable pieces that a shared driver
// (`TreeFeature`) bolts together:
//
//   trunk_placer    how tall, and where the wood goes. It returns FOLIAGE ATTACHMENTS —
//                   "hang a leaf cluster here" — which is how one trunk grows five canopies.
//   foliage_placer  the shape of one cluster around one attachment.
//   minimum_size    the radius the tree needs to be free of blocks at each height.
//   decorators      the afterthoughts: bee nests, vines, cocoa, the podzol under a mega spruce.
//
// Seven trunk placers, ten foliage placers, five decorators, and every one of them appears in
// the overworld's data, so every one of them is here. There is no partial credit: a type that
// is not implemented THROWS at compile time so `featcheck` names it, rather than compiling into
// a tree that places nothing (D-134's rule for the whole feature pipeline).
//
// ── ⚠ THE PURITY RULE, AND WHY IT DECIDES THE WHOLE DESIGN ───────────────────────────────────
//
// `run` is called once per TARGET chunk the tree can reach — up to nine times — with the SAME
// (x,y,z) and an rng seeded identically, and every call must produce the same tree. So the
// SHAPE may not depend on anything the target chunk knows. That splits every "is this block
// free?" question in vanilla into two kinds, and they are handled differently:
//
//   PER-CELL, read-then-write-the-SAME-cell. Safe, and used freely. `A.getBlock` returns -1
//   outside the target chunk, but `A.setBlock` at that same position is a no-op there anyway —
//   so "outside" and "free" lead to identical worlds. This is vanilla's `placeLogIfFree`, and
//   it is why a tree still refuses to overwrite the stone it grows beside.
//
//   GLOBAL, one read deciding many cells — "is there room for a 9-block trunk", "is the ground
//   dirt". NOT safe: the answer differs per target and the tree would appear in one chunk and
//   not its neighbour. These go through `A.heightmapY`, W3's pure `Column.height`, which every
//   target agrees on. A column is free at wy exactly when `wy >= heightmapY(OCEAN_FLOOR,wx,wz)`.
//
// ⚠ AND THE FILE ABOVE THIS ONE BROKE THAT RULE FOR EVERY TREE AT ONCE (D-213). This file obeyed
// it scrupulously and the trees were still sliced flat along the chunk grid, because the guard
// that decides whether a tree is built at all — the `block_predicate_filter` on every `*_checked`
// placed feature — sat in `04j`'s `runInline` and read the TARGET chunk at the trunk. Eight of the
// nine answered -1 and refused. D-213 restores this rule one level up: `Features.terrainAt` is
// `heightmapY`'s sibling — what block the pre-carver terrain puts at a position rather than how
// high it is — and the guard asks that instead of asking whichever chunk happens to be writing.
//
// ⚠ THE SAME RULE APPLIES TO THE RNG, and it is the subtler half. Any `nextInt` consumed only
// on one side of a world read desynchronises the stream for the rest of the tree — one chunk's
// half of the canopy ends up drawn from a different sequence than the other's, and the tree
// tears along the chunk boundary. So every random draw in this file is HOISTED above the world
// read that might skip it: state providers are sampled before the free test, cocoa's age is
// rolled before its air check. Grep this file for "hoisted" and you will find them all.
//
// ── ⚠ WHAT IS REPRODUCED IS THE SHAPE, NOT MOJANG'S CALL SEQUENCE ────────────────────────────
//
// Vanilla's exact random order is compiled Java and cannot be checked from here, so the target
// is the silhouette: a fancy oak winds and branches into separate leaf balls, a spruce is a
// stepped cone down to its ankles, a pine is a bare pole with a tuft, a dark oak is a 2x2 trunk
// under a flat 7x7 slab, a mega spruce wears a skirt of podzol. Where a formula below is a
// deliberate reading rather than a transcription it says so.

(function (NS) {
  'use strict';

  var F = NS.Features, A = F.api, SR = NS.States;

  var HM_FLOOR = 1;                                  // A.heightmapY kind: OCEAN_FLOOR, = terrain + 1

  // north, south, west, east — Direction.Plane.HORIZONTAL, in the order a tree's rng picks.
  var DX = [0, 0, -1, 1], DZ = [-1, 1, 0, 0], OPP = [1, 0, 3, 2];

  // ── ⚠ THE HAND-WRITTEN LOCAL STATE INDICES, and they are the only guesswork in this file ────
  //
  // Vines, cocoa and a bee nest are the three blocks a tree places that MUST carry properties —
  // a vine with no face is an invisible block, which is worse than no vine at all. `States` can
  // only address a state by its LOCAL INDEX (`withLocal`, D-103: the property NAMES are
  // build-time only), so the indices are computed here from vanilla's two ordering rules:
  // properties in declaration order with the LAST varying fastest, and booleans enumerating
  // [true, false]. Each is asserted against the block's real state count at compile time and
  // falls back to the default state if the count disagrees, so a registry change degrades to a
  // plain vine rather than to a wrong block.
  //
  //   vine       UP,NORTH,EAST,SOUTH,WEST — 32 states, all-false = 31 (which the registry's own
  //              default index confirms). One face true subtracts that face's weight.
  //   cocoa      FACING,AGE — 12 states, local = face*3 + age.
  //   bee_nest   HONEY_LEVEL,FACING — 24 states, local = honey*4 + face.
  //
  // ⚠ FACING enumerates N,E,S,W (Direction.Plane.HORIZONTAL's own array), not the N,S,W,E of
  // the Direction enum, so `FACE` maps this file's direction index onto it. If that is backwards
  // the nest faces the wrong way and nothing else changes — it is cosmetic, and it is the one
  // thing here that a running client would settle in a second.
  var FACE = [0, 2, 3, 1];                           // north, south, west, east -> N,E,S,W index
  var VINE_LOCAL = [23, 29, 30, 27];                 // vine with its north/south/west/east face true
  var tables = null;
  function tableFor(block, count, local, dflt) {
    var R = NS.Reg, b = R.id[block];
    if (b === undefined) return 0;
    if (R.realFirst[b + 1] - R.realFirst[b] !== count) return SR.stateOf(block);
    return SR.withLocal(block, local);
  }
  // ⚠⚠ THE LOCAL INDICES ABOVE ARE WRONG, AND THIS IS WHERE THEY STOPPED BEING USED (#19, KW-25).
  // Vanilla's `StateDefinition` SORTS a block's properties by NAME, it does not keep declaration
  // order: a vine is east,north,south,up,west, so `south` is 27, `up` is 29 and `east` is 15. The
  // table above said south=29 and east=27 — i.e. every south-facing vine was drawn attached to the
  // TOP and every east-facing one to the SOUTH. Nothing failed while the write gate asked only
  // "is any face solid"; the jar's own vine rule (every attached face is tested) found 61 of them
  // in five chunks at seed 4242. The states are now BUILT FROM PROPERTIES, which is the one thing
  // that cannot get the ordering wrong; the locals stay only as the fallback for a registry that
  // carries no property table.
  var DIRN = ['north', 'south', 'west', 'east'];
  function withProps(block, sets, dflt) {
    var R = NS.Reg, st = SR.stateOf(block);
    if (!st || !R.PROP || !R.PVAL) return dflt;
    for (var i = 0; i < sets.length; i++) {
      var pid = R.PROP[sets[i][0]], vid = R.PVAL[sets[i][1]];
      if (pid === undefined || vid === undefined) return dflt;
      var nx = SR.withProp(st, pid, vid);
      if (nx === st && SR.propValue(st, pid) !== vid) return dflt;
      st = nx;
    }
    return st;
  }
  function buildTables() {
    if (tables) return tables;
    var vine = [], cocoa = [], hive = [], d, a;
    for (d = 0; d < 4; d++) {
      vine.push(withProps('vine', [[DIRN[d], 'true']], tableFor('vine', 32, VINE_LOCAL[d])));
      hive.push(withProps('bee_nest', [['facing', DIRN[d]]], tableFor('bee_nest', 24, FACE[d])));
      cocoa.push([]);
      for (a = 0; a < 3; a++) {
        cocoa[d].push(withProps('cocoa', [['facing', DIRN[d]], ['age', String(a)]],
                                tableFor('cocoa', 12, FACE[d] * 3 + a)));
      }
    }
    tables = { vine: vine, cocoa: cocoa, hive: hive };
    return tables;
  }

  // Every `*_leaves` state, so the space test can be vanilla's "air or leaves" rather than
  // "air": trees grow into each other's canopies, which is what makes a forest a forest.
  var LEAF = null;
  function leafSet() {
    if (LEAF) return LEAF;
    LEAF = new Uint8Array(SR.count);
    for (var s = 1; s < SR.count; s++) {
      var n = SR.name(s);
      if (n && n.length > 7 && n.slice(n.length - 7) === '_leaves') LEAF[s] = 1;
    }
    return LEAF;
  }

  /** Vanilla's `TreeFeature.validTreePos`. ⚠ -1 (outside the chunk) counts as free: see above. */
  function isFree(T, x, y, z) {
    var s = A.getBlock(T.SB, T.cx, T.cz, x, y, z);
    if (s < 0 || s === 0) return true;
    if (SR.solid[s] !== 1) return true;              // water, grass, flowers, snow
    return leafSet()[s] === 1;
  }

  // ── the three writers every placer goes through ────────────────────────────────────────────
  //
  // ⚠ The position is recorded in `T.logs` / `T.leaves` UNCONDITIONALLY, and only the write is
  // clipped. The decorators walk those lists and draw from the same rng, so the lists have to
  // be the tree's geometry, not the subset that happened to land in this target chunk.

  // ⚠ D-222 — `COLLECT` IS THE FOOTPRINT TAP, and it is null in every generated world. 04j has
  // to know how many COLUMNS a tree's canopy covers, because that is what vanilla's live
  // OCEAN_FLOOR heightmap turns into a rejection for the next attempt in the same column. Nothing
  // in the config states it — the row radii come out of each placer's own formula and half of them
  // depend on a random draw — so it is MEASURED, once per configured tree, by running that tree's
  // own geometry into nothing. `measureCanopy` below is the only thing that ever switches it on.
  // `COLLECT` takes every column the tree covers; `COLLECT_LOG` takes the WOOD alone, because
  // vanilla's free-height test treats leaves as free and logs as not, so the two footprints do
  // different jobs in 04j.
  var COLLECT = null, COLLECT_LOG = null;

  /** How many distinct (x,z) columns are in a flat [x,z,x,z,...] list. */
  function distinct(a) {
    var seen = Object.create(null), n = 0;
    for (var i = 0; i < a.length; i += 2) {
      var key = a[i] + ',' + a[i + 1];
      if (seen[key] !== 1) { seen[key] = 1; n++; }
    }
    return n;
  }

  function logAt(T, x, y, z) {
    if (T.lists) T.logs.push(x, y, z);
    if (COLLECT) { COLLECT.push(x, z); COLLECT_LOG.push(x, z); }
    var st = T.trunk(T.r, x, y, z);                  // hoisted: a provider may consume rng
    if (isFree(T, x, y, z)) T.n += A.setBlock(T.SB, T.cx, T.cz, x, y, z, st);
  }

  function leafAt(T, x, y, z) {
    if (T.lists) T.leaves.push(x, y, z);
    if (COLLECT) COLLECT.push(x, z);
    var st = T.foliage(T.r, x, y, z);                // hoisted (azalea's is a weighted provider)
    if (isFree(T, x, y, z)) T.n += A.setBlock(T.SB, T.cx, T.cz, x, y, z, st);
  }

  /**
   * D-488 — vanilla's `TreeFeature.placeLogsAndLeaves` (Yarn; runs after the decorators): every
   * leaf touching one of THIS tree's logs gets distance=1, then five breadth-first rings give
   * distance 2..6 wherever that lowers the stored value; anything unreached keeps the default 7.
   * Without it every generated leaf carried distance=7/persistent=false and the first random tick
   * decayed it (LeavesBlock.randomTick) — whole forests dissolving into items and remeshes, which
   * is what kept palettecheck/lumacheck/soakcheck's worlds from ever settling.
   * ⚠ PURE per tree: the rings walk this tree's own leaf list (the same in every target chunk), and
   * only the write is clipped. The one world read is a log's direct neighbour inside this chunk,
   * which vanilla also sets to 1 when it is some OTHER tree's leaf.
   */
  var DIST = null;
  F.LEAF_DISTANCES = true;                           // featcheck's anti-vacuity turns it off
  function leafDistances(T) {
    if (!F.LEAF_DISTANCES || !T.leaves.length || !T.logs.length) return;
    var R = NS.Reg;
    if (!DIST) {
      DIST = { p: R.PROP.distance, v: [] };
      for (var q = 0; q <= 7; q++) DIST.v[q] = R.PVAL[String(q)];
    }
    var key = function (x, y, z) { return x + ',' + y + ',' + z; };
    var logs = Object.create(null), leaf = Object.create(null), dist = Object.create(null), i, d;
    for (i = 0; i < T.logs.length; i += 3) logs[key(T.logs[i], T.logs[i + 1], T.logs[i + 2])] = 1;
    for (i = 0; i < T.leaves.length; i += 3) leaf[key(T.leaves[i], T.leaves[i + 1], T.leaves[i + 2])] = 1;
    var X6 = [0, 0, 0, 0, -1, 1], Y6 = [-1, 1, 0, 0, 0, 0], Z6 = [0, 0, -1, 1, 0, 0];
    var ring = [];
    for (i = 0; i < T.logs.length; i += 3) {
      for (d = 0; d < 6; d++) {
        var nx = T.logs[i] + X6[d], ny = T.logs[i + 1] + Y6[d], nz = T.logs[i + 2] + Z6[d], k = key(nx, ny, nz);
        if (logs[k] === 1) continue;
        if (leaf[k] === 1) { if (dist[k] !== 1) { dist[k] = 1; ring.push(nx, ny, nz); } }
        else setDistance(T, nx, ny, nz, 1);           // another tree's leaf beside this log
      }
    }
    for (var lv = 1; lv < 6; lv++) {
      var next = [];
      for (i = 0; i < ring.length; i += 3) {
        for (d = 0; d < 6; d++) {
          var mx = ring[i] + X6[d], my = ring[i + 1] + Y6[d], mz = ring[i + 2] + Z6[d], m = key(mx, my, mz);
          if (leaf[m] !== 1) continue;
          if (dist[m] === undefined || dist[m] > lv + 1) { dist[m] = lv + 1; next.push(mx, my, mz); }
        }
      }
      ring = next;
    }
    for (i = 0; i < T.leaves.length; i += 3) {
      var dk = dist[key(T.leaves[i], T.leaves[i + 1], T.leaves[i + 2])];
      if (dk !== undefined) setDistance(T, T.leaves[i], T.leaves[i + 1], T.leaves[i + 2], dk);
    }
  }
  /** Lower the distance of a leaf block at (x,y,z) in this target chunk to `v`, never raise it. */
  function setDistance(T, x, y, z, v) {
    var s = A.getBlock(T.SB, T.cx, T.cz, x, y, z);
    if (s <= 0) return;                              // air, or not this chunk's block
    var cur = SR.propValue(s, DIST.p);
    if (cur < 0) return;                             // not a leaf
    if (+NS.Reg.valueNames[cur] <= v) return;
    var ns = SR.withProp(s, DIST.p, DIST.v[v]);
    if (ns !== s) A.setBlock(T.SB, T.cx, T.cz, x, y, z, ns);
  }

  /** Vanilla's `setDirtAt`: with `force_dirt` false it leaves ground that is already dirt-ish. */
  function dirtAt(T, x, y, z) {
    var st = T.dirt(T.r, x, y, z);                   // hoisted
    var cur = A.getBlock(T.SB, T.cx, T.cz, x, y, z);
    if (cur < 0) return;                             // not this chunk's block to judge
    if (!T.forceDirt && T.isDirt(cur, x, y, z)) return;
    T.n += A.setBlock(T.SB, T.cx, T.cz, x, y, z, st);
  }

  // ── the free-height test (vanilla's `getMaxFreeTreeHeight`), made pure ─────────────────────
  //
  // Walk up from the base, and at each height check the square of columns `minimum_size` asks
  // for. A column is free above the terrain it is standing on, and `A.heightmapY` is the
  // terrain BEFORE any feature ran — the same answer in every target chunk, which is the whole
  // point. Returns the number of free layers; the caller compares it to the height it wanted.
  //
  // ⚠ D-222 — AND IT USED TO RETURN ONE TOO MANY. Vanilla's `getMaxFreeTreeHeight` returns
  // `i - 1` when layer `i` is blocked, and its caller accepts `i >= trunkHeight`. This returned
  // `dy` and accepted `free >= h - 1`, which is TWO layers more permissive in a row — enough to
  // stand a `mega_jungle_tree`, whose trunk is 10 to 31 blocks, on ground vanilla refuses. It
  // showed up as jungle_log running heavy against the trunk COUNT: 11.1 logs a trunk where the
  // 1.18.2 server puts 6.7.
  var CR = 3;                                        // the widest `size_at_height` in the data is 2
  var CW = CR * 2 + 1;
  var COLS = new Int32Array(CW * CW);                // scratch; one chunk is decorated at a time
  function maxFreeHeight(x, y, z, height, sizeAt) {
    // ⚠ underground (a `rooted_azalea_tree` in a lush cave) the surface heightmap says nothing
    // useful about the ceiling, so it is not consulted at all — the per-cell tests still stop
    // the trunk from eating the rock.
    if (y < A.heightmapY(HM_FLOOR, x, z) - 1) return height;
    var dx, dz;
    for (dz = -CR; dz <= CR; dz++) {
      for (dx = -CR; dx <= CR; dx++) COLS[(dz + CR) * CW + (dx + CR)] = A.heightmapY(HM_FLOOR, x + dx, z + dz);
    }
    for (var dy = 0; dy <= height + 1; dy++) {
      var rad = sizeAt(height, dy);
      if (rad > CR) rad = CR;
      for (dz = -rad; dz <= rad; dz++) {
        for (dx = -rad; dx <= rad; dx++) if (COLS[(dz + CR) * CW + (dx + CR)] > y + dy) return dy - 1;
      }
    }
    return height;
  }

  // ── minimum_size ───────────────────────────────────────────────────────────────────────────

  function compileSize(j, name) {
    if (!j || !j.type) throw new Error(name + ': the tree has no minimum_size');
    var t = String(j.type).replace('minecraft:', '');
    var lim = j.limit | 0, lo = j.lower_size | 0, up = j.upper_size | 0;
    var clip = j.min_clipped_height === undefined ? -1 : j.min_clipped_height | 0;
    if (t === 'two_layers_feature_size') {
      return { clip: clip, max: Math.max(lo, up), at: function (h, y) { return y < lim ? lo : up; } };
    }
    if (t === 'three_layers_feature_size') {
      var mid = j.middle_size | 0, ulim = j.upper_limit | 0;
      return { clip: clip, max: Math.max(lo, Math.max(mid, up)),
               at: function (h, y) { return y < lim ? lo : (h - ulim <= y ? up : mid); } };
    }
    throw new Error(name + ': minimum_size ' + j.type + ' is not implemented');
  }

  /** The largest value an IntProvider can return, for `reach`. Compile time only. */
  function maxOf(v, dflt) {
    if (v === undefined || v === null) return dflt;
    if (typeof v === 'number') return v | 0;
    var t = String(v.type).replace('minecraft:', '');
    if (t === 'constant') return v.value | 0;
    if (t === 'uniform' || t === 'biased_to_bottom' || t === 'clamped') {
      var o = v.value || v;
      return o.max_inclusive === undefined ? dflt : o.max_inclusive | 0;
    }
    if (t === 'weighted_list') {
      var m = 0;
      for (var i = 0; i < v.distribution.length; i++) m = Math.max(m, maxOf(v.distribution[i].data, dflt));
      return m;
    }
    return dflt;
  }

  // ── trunk placers ──────────────────────────────────────────────────────────────────────────
  //
  // Each returns { height(r), spread, place(T,x,y,z,h) -> [attachment] }, where an attachment is
  // { x, y, z, ro, dbl }: `ro` is vanilla's radiusOffset (a mega jungle's side branches carry -2,
  // so their tufts are smaller than the crown) and `dbl` its doubleTrunk flag, which widens a
  // 2x2 tree's canopy by one on the +x/+z side so it is centred on four logs rather than one.

  function drawLimb(T, fx, fy, fz, tx, ty, tz) {
    var dx = tx - fx, dy = ty - fy, dz = tz - fz;
    var steps = Math.max(Math.abs(dx), Math.max(Math.abs(dy), Math.abs(dz)));
    if (steps === 0) { logAt(T, fx, fy, fz); return; }
    var sx = dx / steps, sy = dy / steps, sz = dz / steps;
    for (var i = 0; i <= steps; i++) {
      logAt(T, fx + Math.floor(0.5 + i * sx), fy + Math.floor(0.5 + i * sy), fz + Math.floor(0.5 + i * sz));
    }
  }

  /** The same walk without writing: is the whole path clear of terrain? Pure (heightmap only). */
  function probeLimb(fx, fy, fz, tx, ty, tz) {
    var dx = tx - fx, dy = ty - fy, dz = tz - fz;
    var steps = Math.max(Math.abs(dx), Math.max(Math.abs(dy), Math.abs(dz)));
    if (steps === 0) return -1;
    var sx = dx / steps, sy = dy / steps, sz = dz / steps;
    for (var i = 0; i <= steps; i++) {
      var px = fx + Math.floor(0.5 + i * sx), py = fy + Math.floor(0.5 + i * sy), pz = fz + Math.floor(0.5 + i * sz);
      if (py < A.heightmapY(HM_FLOOR, px, pz)) return i;
    }
    return -1;
  }

  /** FancyTrunkPlacer's silhouette: -1 below 30% of the height, then a half-ellipse. */
  function treeShape(h, y) {
    if (y < h * 0.3) return -1;
    var f = h / 2, f1 = f - y;
    if (f1 === 0) return f * 0.5;
    if (Math.abs(f1) >= f) return 0;
    return Math.sqrt(f * f - f1 * f1) * 0.5;
  }

  function giantLogs(T, x, y, z, h) {
    dirtAt(T, x, y - 1, z); dirtAt(T, x + 1, y - 1, z);
    dirtAt(T, x, y - 1, z + 1); dirtAt(T, x + 1, y - 1, z + 1);
    for (var i = 0; i < h; i++) {
      var wy = y + i;
      logAt(T, x, wy, z); logAt(T, x + 1, wy, z); logAt(T, x, wy, z + 1); logAt(T, x + 1, wy, z + 1);
    }
  }

  function compileTrunk(j, name) {
    if (!j || !j.type) throw new Error(name + ': the tree has no trunk_placer');
    var t = String(j.type).replace('minecraft:', '');
    var base = j.base_height | 0, ra = j.height_rand_a | 0, rb = j.height_rand_b | 0;
    var height = function (r) { return base + r.nextInt(ra + 1) + r.nextInt(rb + 1); };
    var hMax = base + ra + rb;

    if (t === 'straight_trunk_placer') {
      return { height: height, spread: 0, place: function (T, x, y, z, h) {
        dirtAt(T, x, y - 1, z);
        for (var i = 0; i < h; i++) logAt(T, x, y + i, z);
        return [{ x: x, y: y + h, z: z, ro: 0, dbl: false }];
      } };
    }

    if (t === 'forking_trunk_placer') {
      // Acacia. One trunk that leans, then a second stub off it in another direction — which is
      // what gives an acacia its two separate flat canopies.
      return { height: height, spread: 4, place: function (T, x, y, z, h) {
        dirtAt(T, x, y - 1, z);
        var r = T.r, out = [], i;
        var d = r.nextInt(4), start = h - r.nextInt(4) - 1, steps = 3 - r.nextInt(3);
        var px = x, pz = z, top = y;
        for (i = 0; i < h; i++) {
          if (i >= start && steps > 0) { px += DX[d]; pz += DZ[d]; steps--; }
          top = y + i;
          logAt(T, px, top, pz);
        }
        out.push({ x: px, y: top + 1, z: pz, ro: 1, dbl: false });
        var d2 = r.nextInt(4), s2 = start - r.nextInt(2) - 1, n2 = 1 + r.nextInt(3);
        if (d2 !== d) {
          var qx = x, qz = z, top2 = 0, any = false;
          for (i = s2; i < h && n2 > 0; i++, n2--) {
            if (i < 1) continue;
            qx += DX[d2]; qz += DZ[d2]; top2 = y + i; any = true;
            logAt(T, qx, top2, qz);
          }
          if (any) out.push({ x: qx, y: top2 + 1, z: qz, ro: 0, dbl: false });
        }
        return out;
      } };
    }

    if (t === 'bending_trunk_placer') {
      // The azalea tree. A straight stem that bends over for its last few blocks, with a
      // foliage attachment at every log above `min_height_for_leaves` — the scatter placer then
      // fills the whole bend with leaves, which is why an azalea looks like a shrub on a stick.
      var bend = A.intProvider(j.bend_length, name + '.bend_length');
      var minLeaves = j.min_height_for_leaves === undefined ? 1 : j.min_height_for_leaves | 0;
      return { height: height, spread: maxOf(j.bend_length, 2) + 1, place: function (T, x, y, z, h) {
        dirtAt(T, x, y - 1, z);
        var r = T.r, out = [];
        var len = bend(r), d = r.nextInt(4);
        var straight = h - len;
        if (straight < 1) straight = 1;
        var px = x, pz = z;
        for (var i = 0; i < h; i++) {
          if (i >= straight) { px += DX[d]; pz += DZ[d]; }
          logAt(T, px, y + i, pz);
          if (i >= minLeaves) out.push({ x: px, y: y + i, z: pz, ro: 0, dbl: false });
        }
        return out;
      } };
    }

    if (t === 'giant_trunk_placer') {
      return { height: height, spread: 1, place: function (T, x, y, z, h) {
        giantLogs(T, x, y, z, h);
        return [{ x: x, y: y + h, z: z, ro: 0, dbl: true }];
      } };
    }

    if (t === 'mega_jungle_trunk_placer') {
      // A giant trunk plus arms that spiral out of it every few blocks above the halfway mark.
      return { height: height, spread: 6, place: function (T, x, y, z, h) {
        giantLogs(T, x, y, z, h);
        var r = T.r, out = [{ x: x, y: y + h, z: z, ro: 0, dbl: true }];
        for (var i = h - 2 - r.nextInt(4); i > h / 2; i -= 2 + r.nextInt(4)) {
          var f = r.nextFloat() * Math.PI * 2, bx = 0, bz = 0;
          for (var l = 0; l < 5; l++) {
            bx = Math.floor(1.5 + Math.cos(f) * l);
            bz = Math.floor(1.5 + Math.sin(f) * l);
            logAt(T, x + bx, y + i - 3 + (l >> 1), z + bz);
          }
          out.push({ x: x + bx, y: y + i, z: z + bz, ro: -2, dbl: false });
        }
        return out;
      } };
    }

    if (t === 'dark_oak_trunk_placer') {
      // 2x2, leaning near the top, with up to twelve short stubs poking out of the crown. Each
      // stub gets its own attachment, which is what makes a dark oak's canopy ragged.
      return { height: height, spread: 4, place: function (T, x, y, z, h) {
        var r = T.r, out = [], a, b, k;
        dirtAt(T, x, y - 1, z); dirtAt(T, x + 1, y - 1, z);
        dirtAt(T, x, y - 1, z + 1); dirtAt(T, x + 1, y - 1, z + 1);
        var d = r.nextInt(4), start = h - r.nextInt(4), steps = 2 - r.nextInt(3);
        var px = x, pz = z;
        for (var i = 0; i < h; i++) {
          if (i >= start && steps > 0) { px += DX[d]; pz += DZ[d]; steps--; }
          var wy = y + i;
          logAt(T, px, wy, pz); logAt(T, px + 1, wy, pz);
          logAt(T, px, wy, pz + 1); logAt(T, px + 1, wy, pz + 1);
        }
        out.push({ x: px, y: y + h, z: pz, ro: 0, dbl: true });
        for (a = -1; a <= 2; a++) {
          for (b = -1; b <= 2; b++) {
            var inside = a >= 0 && a <= 1 && b >= 0 && b <= 1;
            var take = r.nextInt(3) <= 0;              // hoisted: drawn for every slot
            if (inside || !take) continue;
            var len = r.nextInt(3) + 2;
            for (k = 0; k < len; k++) logAt(T, x + a, y + h - k - 1, z + b);
            out.push({ x: px + a, y: y + h, z: pz + b, ro: 0, dbl: false });
          }
        }
        return out;
      } };
    }

    if (t === 'fancy_trunk_placer') {
      // ── the big oak, and the only placer here that is a solid of revolution ────────────────
      //
      // Scatter candidate branch tips inside a half-ellipse of revolution (`treeShape`), keep
      // the ones with room above them and a clear run back to the trunk, then draw a limb from
      // the trunk out to each. `0.618` is the golden ratio and `0.381` its complement: they set
      // how high the trunk runs before the crown and how steeply a limb rises.
      return { height: height, spread: Math.ceil((hMax + 2) / 4 * 1.4) + 2, place: function (T, x, y, z, h) {
        var r = T.r, i;
        dirtAt(T, x, y - 1, z);
        var j = h + 2;
        var k = Math.floor(j * 0.618);
        var top = y + k;
        var coords = [{ x: x, y: y + (j - 5), z: z, base: top }];
        // ⚠ ONE candidate per layer. Vanilla's slot count is `Math.min(1, floor(1.382 + (j/13)^2))`
        // — a `min` where a reader expects a `max`, so it is always 1. Reproduced, because a
        // second slot per layer doubles a fancy oak's branches and it stops looking like one.
        for (var j1 = j - 5; j1 >= 0; j1--) {
          var f = treeShape(j, j1);
          if (f < 0) continue;
          var d1 = f * (r.nextFloat() + 0.328);
          var d2 = r.nextFloat() * 2 * Math.PI;
          var bx = x + Math.floor(d1 * Math.sin(d2) + 0.5);
          var bz = z + Math.floor(d1 * Math.cos(d2) + 0.5);
          var by = y + j1 - 1;
          if (probeLimb(bx, by, bz, bx, by + 5, bz) !== -1) continue;
          var ex = x - bx, ez = z - bz;
          var d5 = by - Math.sqrt(ex * ex + ez * ez) * 0.381;
          var jb = d5 > top ? top : Math.floor(d5);
          if (probeLimb(x, jb, z, bx, by, bz) !== -1) continue;
          coords.push({ x: bx, y: by, z: bz, base: jb });
        }
        drawLimb(T, x, y, z, x, top, z);               // the trunk itself
        var out = [];
        for (i = 0; i < coords.length; i++) {
          var c = coords[i];
          if (c.base - y < j * 0.2) continue;          // `trimBranches`: nothing below 20%
          if (!(c.x === x && c.z === z && c.y === c.base)) drawLimb(T, x, c.base, z, c.x, c.y, c.z);
          out.push({ x: c.x, y: c.y, z: c.z, ro: 0, dbl: false });
        }
        return out;
      } };
    }

    throw new Error(name + ': trunk_placer ' + j.type + ' is not implemented');
  }

  // ── foliage placers ────────────────────────────────────────────────────────────────────────
  //
  // Each returns { height(r,h), radius(r,trunkH), offset(r), spread, create(T,att,fh,frad,off) }.
  // `placeLeavesRow` is the shared primitive: one horizontal square of leaves, minus whatever
  // the placer's `shouldSkip` rule carves off the corners — which is the difference between a
  // cube of leaves and a canopy.

  function cornerSkip(r, ax, y, az, range) { return ax === range && az === range && range > 0; }
  function blobSkip(r, ax, y, az, range) {
    return ax === range && az === range && range > 0 && r.nextInt(2) === 0;
  }
  function roundSkip(r, ax, y, az, range) { return ax + az >= 7 || ax * ax + az * az > range * range; }
  function acaciaSkip(r, ax, y, az, range) {
    if (y === 0) return (ax > 1 || az > 1) && ax !== 0 && az !== 0;
    return cornerSkip(r, ax, y, az, range);
  }

  function leavesRow(T, px, py, pz, range, yOff, dbl, skip) {
    var e = dbl ? 1 : 0;                             // a 2x2 trunk's canopy runs one further +x/+z
    for (var j = -range; j <= range + e; j++) {
      for (var k = -range; k <= range + e; k++) {
        var ax, az;
        if (dbl) { ax = Math.min(Math.abs(j), Math.abs(j - 1)); az = Math.min(Math.abs(k), Math.abs(k - 1)); }
        else { ax = j < 0 ? -j : j; az = k < 0 ? -k : k; }
        if (skip(T.r, ax, yOff, az, range, dbl)) continue;
        leafAt(T, px + j, py + yOff, pz + k);
      }
    }
  }

  function compileFoliage(j, name) {
    if (!j || !j.type) throw new Error(name + ': the tree has no foliage_placer');
    var t = String(j.type).replace('minecraft:', '');
    var radius = A.intProvider(j.radius === undefined ? 0 : j.radius, name + '.radius');
    var offset = A.intProvider(j.offset === undefined ? 0 : j.offset, name + '.offset');
    var rMax = maxOf(j.radius, 0);
    var mk = function (heightFn, spread, create) {
      return { height: heightFn, radius: function (r) { return radius(r); }, offset: offset,
               spread: spread, create: create };
    };

    if (t === 'blob_foliage_placer' || t === 'bush_foliage_placer') {
      // A blob is widest at its BOTTOM two rows (`- i/2`, truncating toward zero as Java does);
      // a bush is the same code with the radius growing straight downward instead.
      var bh = j.height | 0;
      var bush = t === 'bush_foliage_placer';
      return mk(function () { return bh; }, rMax + 2, function (T, att, fh, frad, off) {
        for (var i = off; i >= off - fh; i--) {
          var rad = bush ? (frad + att.ro - 1 - i) : Math.max(frad + att.ro - 1 - ((i / 2) | 0), 0);
          leavesRow(T, att.x, att.y, att.z, rad, i, att.dbl, bush ? cornerSkip : blobSkip);
        }
      });
    }

    if (t === 'fancy_foliage_placer') {
      // A ball capping each branch tip: rows from the attachment upward, shrinking as they go,
      // rounded off by `x^2 + z^2 > r^2`. Five of these hanging off a fancy trunk is a fancy oak.
      var fh0 = j.height | 0;
      return mk(function () { return fh0; }, rMax + 2, function (T, att, fh, frad, off) {
        for (var i = off; i >= off - fh; i--) {
          leavesRow(T, att.x, att.y, att.z, frad + att.ro + 1 - i, i, att.dbl, roundSkip);
        }
      });
    }

    if (t === 'spruce_foliage_placer') {
      // ⚠ `trunk_height` is how much of the trunk is left BARE; the canopy is everything above
      // it, at least four rows. The radius walks 0,1,2,0,1,2,3... which is the stepped cone that
      // makes a spruce read as a spruce rather than as a tall oak.
      var th = A.intProvider(j.trunk_height, name + '.trunk_height');
      return mk(function (r, h) { return Math.max(4, h - th(r)); }, rMax + 2,
        function (T, att, fh, frad, off) {
          var r = T.r, i = r.nextInt(2), j2 = 1, k = 0;
          for (var l = off; l >= -fh; l--) {
            leavesRow(T, att.x, att.y, att.z, i, l, att.dbl, cornerSkip);
            if (i >= j2) { i = k; k = 1; j2 = Math.min(j2 + 1, frad + att.ro); }
            else i++;
          }
        });
    }

    if (t === 'pine_foliage_placer') {
      // A tuft, and nothing else: the radius swells to `frad` and comes straight back to a point.
      var ph = A.intProvider(j.height, name + '.height');
      return mk(function (r) { return ph(r); }, rMax + 2, function (T, att, fh, frad, off) {
        var i = 0;
        for (var k = off; k >= off - fh; k--) {
          leavesRow(T, att.x, att.y, att.z, i, k, att.dbl, cornerSkip);
          if (i >= 1 && k === off - fh + 1) i--;
          else if (i < frad + att.ro) i++;
        }
      });
    }

    if (t === 'acacia_foliage_placer') {
      // Three rows and no more — the flat parasol. The middle row's skip rule keeps only the
      // arms of a cross, which is what gives an acacia its thin plate rather than a slab.
      return mk(function () { return 0; }, rMax + 2, function (T, att, fh, frad, off) {
        var py = att.y + off;
        leavesRow(T, att.x, py, att.z, frad + att.ro, -1 - fh, att.dbl, acaciaSkip);
        leavesRow(T, att.x, py, att.z, frad - 1, -fh, att.dbl, acaciaSkip);
        leavesRow(T, att.x, py, att.z, frad + att.ro - 1, 0, att.dbl, acaciaSkip);
      });
    }

    if (t === 'dark_oak_foliage_placer') {
      return mk(function () { return 4; }, rMax + 4, function (T, att, fh, frad, off) {
        var py = att.y + off;
        if (att.dbl) {
          leavesRow(T, att.x, py, att.z, frad + 2, -1, true, cornerSkip);
          leavesRow(T, att.x, py, att.z, frad + 3, 0, true, cornerSkip);
          leavesRow(T, att.x, py, att.z, frad + 2, 1, true, cornerSkip);
          var wide = T.r.nextInt(2) === 1;             // hoisted: always drawn
          if (wide) leavesRow(T, att.x, py, att.z, frad, 2, true, cornerSkip);
        } else {
          leavesRow(T, att.x, py, att.z, frad + 2, -1, false, cornerSkip);
          leavesRow(T, att.x, py, att.z, frad + 1, 0, false, cornerSkip);
        }
      });
    }

    if (t === 'jungle_foliage_placer') {
      // ⚠ A READING, not a transcription. The rows narrow going DOWN from the attachment, which
      // puts a jungle tree's mass at the top of its very long trunk where the game shows it.
      var jh = j.height | 0;
      return mk(function () { return jh; }, rMax + 3, function (T, att, fh, frad, off) {
        var n = att.dbl ? fh : 1 + T.r.nextInt(2);
        for (var i = off; i >= off - n; i--) {
          var rad = frad + att.ro + 1 + i;
          if (rad < 0) rad = 0;
          leavesRow(T, att.x, att.y, att.z, rad, i, att.dbl, cornerSkip);
        }
      });
    }

    if (t === 'mega_pine_foliage_placer') {
      // The skirt. The radius grows linearly with the distance below the crown top, up to 3.5,
      // and a row that would repeat the one under it gets one extra block on alternate levels —
      // that jitter is what stops a mega spruce from looking like a stack of squares.
      var crown = A.intProvider(j.crown_height, name + '.crown_height');
      return mk(function (r) { return crown(r); }, rMax + 6, function (T, att, fh, frad, off) {
        var span = fh < 1 ? 1 : fh, prev = -1;
        for (var k = span; k >= 0; k--) {
          var rad = frad + att.ro + Math.floor(k / span * 3.5);
          var wobble = (k > 0 && rad === prev && (((att.y + off - k) & 1) === 0)) ? 1 : 0;
          leavesRow(T, att.x, att.y, att.z, rad + wobble, off - k, att.dbl, cornerSkip);
          prev = rad;
        }
      });
    }

    if (t === 'random_spread_foliage_placer') {
      // The azalea's shrub: no shape at all, just N darts thrown into a box. `nextInt(r) -
      // nextInt(r)` is vanilla's cheap triangular distribution, dense in the middle.
      var fhP = A.intProvider(j.foliage_height, name + '.foliage_height');
      var tries = j.leaf_placement_attempts === undefined ? 20 : j.leaf_placement_attempts | 0;
      return mk(function (r) { return fhP(r); }, rMax + 2, function (T, att, fh, frad, off) {
        var r = T.r;
        for (var i = 0; i < tries; i++) {
          var px = att.x + r.nextInt(frad) - r.nextInt(frad);
          var py = att.y + off + r.nextInt(fh) - r.nextInt(fh);
          var pz = att.z + r.nextInt(frad) - r.nextInt(frad);
          leafAt(T, px, py, pz);
        }
      });
    }

    throw new Error(name + ': foliage_placer ' + j.type + ' is not implemented');
  }

  // ── decorators ─────────────────────────────────────────────────────────────────────────────
  //
  // These run last, over the log and leaf lists the placers recorded. Each returns
  // { reach, run(T) }. ⚠ Every one of them rolls its dice BEFORE it looks at the world.

  function compileDecorator(j, name) {
    var t = String(j.type).replace('minecraft:', '');
    var prob = j.probability === undefined ? 1 : +j.probability;

    if (t === 'beehive') {
      // One nest, on the side of the lowest log that has leaves beside it. The block the nest
      // faces must be open, and THAT test is a heightmap test, not a block read: it decides a
      // write at a different position, so a block read there would differ between targets.
      return { reach: 2, run: function (T) {
        var r = T.r, i;
        if (r.nextFloat() >= prob) return;
        if (!T.logs.length || !T.leaves.length) return;
        var minLeaf = T.leaves[1];
        for (i = 4; i < T.leaves.length; i += 3) if (T.leaves[i] < minLeaf) minLeaf = T.leaves[i];
        var hy = minLeaf + 1, cand = [];
        for (i = 0; i < T.logs.length; i += 3) if (T.logs[i + 1] === hy) cand.push(i);
        if (!cand.length) return;
        var at = cand[r.nextInt(cand.length)], d = r.nextInt(4);
        // ⚠ HOISTED, same rule as every other draw in this file (D-… header, "grep this file
        // for hoisted"): `BeehiveTreeDecorator.generate`'s own occupant fill (.decomp lines
        // 61-68) — `2 + nextInt(2)` bees, each `nextInt(599)` — is rolled here, unconditionally,
        // BEFORE the heightmap/`isFree` gates below decide whether the nest is placed at all, so
        // every one of the up-to-nine target-chunk calls consumes the identical amount of `r`
        // regardless of which one actually owns the write (`Bee.stockNest`'s own header has the
        // vanilla-line citations for what these numbers mean).
        var beeCount = 2 + r.nextInt(2), beeTicks = [];
        for (i = 0; i < beeCount; i++) beeTicks.push(r.nextInt(599));
        var nx = T.logs[at] + DX[d], nz = T.logs[at + 2] + DZ[d];
        if (hy < A.heightmapY(HM_FLOOR, nx + DX[d], nz + DZ[d])) return;   // its face is buried
        if (!isFree(T, nx, hy, nz)) return;
        var placed = A.setBlock(T.SB, T.cx, T.cz, nx, hy, nz, buildTables().hive[d]);
        T.n += placed;
        if (placed) {
          // worker bundle has no NS.Bee: log [x,y,z,ticks] for World.installChunk (res.nests)
          if (NS.Bee && NS.Bee.stockNest) NS.Bee.stockNest(nx, hy, nz, beeTicks);
          else if (NS.Gen && NS.Gen.nestLog) NS.Gen.nestLog.push([nx, hy, nz, beeTicks]);
        }
      } };
    }

    if (t === 'cocoa') {
      // On the bottom three log levels of a jungle tree, on any face, a quarter of the time.
      return { reach: 2, run: function (T) {
        var r = T.r;
        if (r.nextFloat() >= prob) return;
        if (!T.logs.length) return;
        var C = buildTables().cocoa, y0 = T.logs[1];
        for (var i = 0; i < T.logs.length; i += 3) {
          if (T.logs[i + 1] - y0 > 2) continue;
          for (var d = 0; d < 4; d++) {
            var take = r.nextFloat() <= 0.25, age = r.nextInt(3);   // both hoisted
            if (!take) continue;
            var px = T.logs[i] - DX[d], pz = T.logs[i + 2] - DZ[d];
            var py = T.logs[i + 1];
            if (A.getBlock(T.SB, T.cx, T.cz, px, py, pz) !== 0) continue;
            T.n += A.setBlock(T.SB, T.cx, T.cz, px, py, pz, C[d][age]);
          }
        }
      } };
    }

    if (t === 'trunk_vine' || t === 'leave_vine') {
      var onLeaves = t === 'leave_vine';
      return { reach: onLeaves ? 2 : 1, run: function (T) {
        var r = T.r, src = onLeaves ? T.leaves : T.logs;
        var V = buildTables().vine;
        for (var i = 0; i < src.length; i += 3) {
          for (var d = 0; d < 4; d++) {
            var take = onLeaves ? (r.nextInt(4) === 0) : (r.nextInt(3) > 0);   // hoisted
            if (!take) continue;
            var px = src[i] + DX[d], py = src[i + 1], pz = src[i + 2] + DZ[d];
            // the vine hangs on the face pointing back at the block it grew from
            var st = V[OPP[d]];
            if (A.getBlock(T.SB, T.cx, T.cz, px, py, pz) !== 0) continue;
            // ⚠ A VINE HANGS ON A BLOCK THAT IS THERE (#19). The lists hold the tree's GEOMETRY, whole
            // (see `logAt`), and a cell of it that was not free never got written; vanilla's
            // decorators walk only what was placed. The draws above are already made, so skipping
            // here changes no rng state; a source outside this target chunk reads -1 and is trusted.
            var srcNow = A.getBlock(T.SB, T.cx, T.cz, src[i], src[i + 1], src[i + 2]);
            if (srcNow === 0) continue;
            T.n += A.setBlock(T.SB, T.cx, T.cz, px, py, pz, st);
            if (!onLeaves) continue;
            for (var k = 1; k <= 4; k++) {              // a leaf vine trails down up to four
              if (A.getBlock(T.SB, T.cx, T.cz, px, py - k, pz) !== 0) break;
              T.n += A.setBlock(T.SB, T.cx, T.cz, px, py - k, pz, st);
            }
          }
        }
      } };
    }

    if (t === 'alter_ground') {
      // The podzol ring under a mega spruce: four overlapping discs at the trunk's corners plus
      // five more scattered around the ring of an 8x8 box. ⚠ The ground's y comes from the
      // heightmap, not from a search — pure, and the same in every target chunk.
      var prov = A.stateProvider(j.provider, name + '.alter_ground');
      return { reach: 6, run: function (T) {
        if (!T.logs.length) return;
        var r = T.r, y0 = T.logs[1];
        var one = function (wx, wz) {
          var gy = A.heightmapY(HM_FLOOR, wx, wz) - 1;
          var st = prov(T.r, wx, gy, wz);               // hoisted
          var cur = A.getBlock(T.SB, T.cx, T.cz, wx, gy, wz);
          if (cur < 0 || !T.isDirt(cur, wx, gy, wz)) return;
          T.n += A.setBlock(T.SB, T.cx, T.cz, wx, gy, wz, st);
        };
        var disc = function (wx, wz) {
          for (var dx = -2; dx <= 2; dx++) {
            for (var dz = -2; dz <= 2; dz++) if (dx * dx + dz * dz <= 6) one(wx + dx, wz + dz);
          }
        };
        for (var i = 0; i < T.logs.length; i += 3) {
          if (T.logs[i + 1] !== y0) continue;
          var px = T.logs[i], pz = T.logs[i + 2];
          disc(px - 1, pz - 1); disc(px + 2, pz - 1); disc(px - 1, pz + 2); disc(px + 2, pz + 2);
          for (var k = 0; k < 5; k++) {
            var q = r.nextInt(64), a = q % 8, b = (q / 8) | 0;
            if (a === 0 || a === 7 || b === 0 || b === 7) disc(px - 3 + a, pz - 3 + b);
          }
        }
      } };
    }

    throw new Error(name + ': tree decorator ' + j.type + ' is not implemented');
  }

  // ── the generator ──────────────────────────────────────────────────────────────────────────

  F.register('tree', function (cfg, name) {
    var trunkProv = A.stateProvider(cfg.trunk_provider, name + '.trunk');
    var foliProv = A.stateProvider(cfg.foliage_provider, name + '.foliage');
    var dirtProv = A.stateProvider(cfg.dirt_provider, name + '.dirt');
    var forceDirt = !!cfg.force_dirt;
    var size = compileSize(cfg.minimum_size, name);
    var trunk = compileTrunk(cfg.trunk_placer, name);
    var foliage = compileFoliage(cfg.foliage_placer, name);
    var decs = [], decReach = 0, i;
    for (i = 0; i < (cfg.decorators || []).length; i++) {
      var d = compileDecorator(cfg.decorators[i], name);
      decs.push(d.run);
      if (d.reach > decReach) decReach = d.reach;
    }
    var lists = decs.length > 0;
    // ⚠ `ignore_vines` is read and deliberately unused: it lets a tree grow THROUGH vines when
    // testing for space, and MC-Lite's space test already treats every non-solid block as free,
    // so it is already true for both settings. Named here so it is not mistaken for an oversight.
    var ignoreVines = !!cfg.ignore_vines;

    // How far this tree can write from its base. The 3x3 makes anything past 16 meaningless.
    var reach = trunk.spread + foliage.spread + 2;
    if (decReach + trunk.spread + 2 > reach) reach = decReach + trunk.spread + 2;
    if (reach < 6) reach = 6;
    if (reach > 16) reach = 16;

    var isDirt = A.predicate({ predicate_type: 'tag_match', tag: 'minecraft:dirt' });

    return { kind: 'tree', name: name, reach: reach, ignoreVines: ignoreVines,
      /**
       * ⚠ D-222 — measureCanopy(): HOW MANY COLUMNS DOES THIS TREE COVER?
       *
       * Vanilla's tree placements are self-limiting and nothing in the JSON says so. The
       * `heightmap OCEAN_FLOOR` modifier reads the LIVE chunk, so once a tree stands there the
       * next attempt in one of its columns is lifted to the top of its leaves and the
       * `would_survive` filter on every `*_checked` tree then fails, because a sapling does not
       * grow on a leaf. 04j reproduces that verdict from a per-source-chunk canopy stamp, and the
       * one number it needs is the AREA this tree's leaves and logs cover in plan.
       *
       * It is measured rather than declared, because no declaration would be honest: a blob's
       * widest row is `frad + ro - 1 - (i/2)`, a fancy oak's canopy is five balls hung off a
       * winding trunk, and a mega spruce's skirt grows with `k/span * 3.5`. Eight shapes are
       * built with `SB` null and the chunk 16 million blocks away, so `A.getBlock` answers -1 and
       * `A.setBlock` writes nothing: what is left is the geometry, which is what `T.logs` and
       * `T.leaves` already promise is independent of the target chunk. The eight are averaged
       * because the trunk height is a random draw and one sample is one tree, not the species.
       */
      measureCanopy: function () {
        var total = 0, totalLog = 0, s, k;
        for (s = 0; s < 8; s++) {
          var r = new NS.Carvers.Rng(0x5eed + s * 7919, 0x1337, s * 977 + 13);
          var T = { SB: null, cx: 1 << 20, cz: 1 << 20, r: r, n: 0, lists: true, logs: [], leaves: [],
                    trunk: trunkProv, foliage: foliProv, dirt: dirtProv,
                    forceDirt: forceDirt, isDirt: isDirt };
          // the same draw order as `run`, minus the free test, which needs a world
          var h = trunk.height(r);
          var fh = foliage.height(r, h);
          var frad = foliage.radius(r, h - fh);
          COLLECT = []; COLLECT_LOG = [];
          var atts = trunk.place(T, 0, 0, 0, h);
          for (k = 0; k < atts.length; k++) foliage.create(T, atts[k], fh, frad, foliage.offset(r));
          for (k = 0; k < decs.length; k++) decs[k](T);
          total += distinct(COLLECT);
          totalLog += distinct(COLLECT_LOG);
          COLLECT = null; COLLECT_LOG = null;
        }
        return { area: total / 8, logArea: totalLog / 8, sizeR: size.max };
      },
      run: function (SB, cx, cz, x, y, z, r) {
        var T = { SB: SB, cx: cx, cz: cz, r: r, n: 0, lists: true, logs: [], leaves: [],   // D-488: leafDistances needs both
                  trunk: trunkProv, foliage: foliProv, dirt: dirtProv,
                  forceDirt: forceDirt, isDirt: isDirt };
        // ⚠ THE RNG ORDER IS FIXED HERE and nothing below the free test may reorder it: height,
        // foliage height, foliage radius, then the placers. The free test itself draws nothing.
        var h = trunk.height(r);
        var fh = foliage.height(r, h);
        var frad = foliage.radius(r, h - fh);
        var free = maxFreeHeight(x, y, z, h, size.at);
        if (free < h && !(size.clip >= 0 && free >= size.clip)) return 0;      // D-222: vanilla's own test
        if (free < h) h = free;
        if (h < 1) return 0;
        var atts = trunk.place(T, x, y, z, h);
        for (var k = 0; k < atts.length; k++) foliage.create(T, atts[k], fh, frad, foliage.offset(r));
        for (k = 0; k < decs.length; k++) decs[k](T);
        leafDistances(T);
        return T.n;
      } };
  });

  // ── SaplingGenerator (#7736) ──────────────────────────────────────────────────────────────
  // `.decomp` block/sapling/*SaplingGenerator + LargeTreeSaplingGenerator. The tree features write into a
  // 16x16 chunk scratch buffer, so the live world around the sapling is copied into one with the sapling at
  // local (8,8), the tree run on it, and every changed cell written back. Reach past 8 cells is clipped.
  var SAP = { oak: 'o', spruce: 's', birch: 'b', jungle: 'j', acacia: 'a', dark_oak: 'd' };
  var SAP_WIN = 52;
  function flowersNear(W, x, y, z) {
    if (!NS.Tags || !NS.Tags.ready) return false;
    var col = NS.Tags.blockTag('small_flowers'), c = NS.Tags.blockTag('flowers');
    var dx, dy, dz, st;
    for (dy = -1; dy <= 1; dy++) for (dz = -2; dz <= 2; dz++) for (dx = -2; dx <= 2; dx++) {
      st = W.getBlock(x + dx, y + dy, z + dz);
      if (st > 0 && (NS.Tags.stateInCol(c, st) || NS.Tags.stateInCol(col, st))) return true;
    }
    return false;
  }
  /** Vanilla's tree features by sapling kind: [name, bees name] or null. rng draws in the generator's order. */
  function pickTree(kind, r, bees, large) {
    if (large) {
      if (kind === 's') return [r.nextInt(2) === 1 ? 'mega_spruce' : 'mega_pine'];
      if (kind === 'j') return ['mega_jungle_tree'];
      return ['dark_oak'];
    }
    if (kind === 'o') return r.nextInt(10) === 0 ? ['fancy_oak', 'fancy_oak_bees_005'] : ['oak', 'oak_bees_005'];
    if (kind === 'b') return ['birch', 'birch_bees_005'];
    if (kind === 's') return ['spruce'];
    if (kind === 'j') return ['jungle_tree_no_vine'];
    if (kind === 'a') return ['acacia'];
    return null;                                   // dark oak never grows alone
  }
  /**
   * `SaplingGenerator.generate`. `W` = {getBlock,setBlock}; `r` is a Carvers.Rng. Returns true when a tree stood.
   * `treeName` (check hook) receives the chosen feature's name.
   */
  F.growSapling = function (W, x, y, z, st, r, treeName) {
    if (!F.ready || !F.configured) return false;
    var blk = SR.block[st], nm = NS.Reg.names[blk] || '', kind = SAP[nm.replace('_sapling', '')];
    if (!kind) return false;
    var ox = x, oz = z, large = false, dx, dz, ex, ez;
    if (kind === 's' || kind === 'j' || kind === 'd') {
      for (dx = 0; dx >= -1 && !large; dx--) for (dz = 0; dz >= -1 && !large; dz--) {
        if (SR.block[W.getBlock(x + dx, y, z + dz)] === blk && SR.block[W.getBlock(x + dx + 1, y, z + dz)] === blk &&
            SR.block[W.getBlock(x + dx, y, z + dz + 1)] === blk && SR.block[W.getBlock(x + dx + 1, y, z + dz + 1)] === blk) {
          large = true; ox = x + dx; oz = z + dz;
        }
      }
    }
    var bees = !large && flowersNear(W, x, y, z);
    var pick = pickTree(kind, r, bees, large);
    if (!pick) return false;
    var name = bees && pick[1] && F.compile(pick[1]) ? pick[1] : pick[0];
    var gen = F.compile(name);
    if (treeName) treeName(name);
    if (!gen || gen.kind !== 'tree') return false;
    var MINY = NS.CFG.WORLD_MIN_Y, HH = NS.CFG.CHUNK_H, y0 = Math.max(MINY + 1, y - 3), y1 = Math.min(MINY + HH - 1, y0 + SAP_WIN);
    var SB = new Uint16Array(256 * HH), cx0 = ox - 8, cz0 = oz - 8, lx, lz, yy;
    for (yy = y0; yy <= y1; yy++) for (lz = 0; lz < 16; lz++) for (lx = 0; lx < 16; lx++)
      SB[((yy - MINY) << 8) | (lz << 4) | lx] = W.getBlock(cx0 + lx, yy, cz0 + lz) | 0;
    var cells = large ? [[0, 0], [1, 0], [0, 1], [1, 1]] : [[0, 0]];
    for (var i = 0; i < cells.length; i++) SB[((y - MINY) << 8) | ((8 + cells[i][1]) << 4) | (8 + cells[i][0])] = 0;
    var before = SB.slice();
    if (gen.run(SB, 0, 0, 8, y, 8, r) <= 0) return false;
    for (yy = y0; yy <= y1; yy++) for (lz = 0; lz < 16; lz++) for (lx = 0; lx < 16; lx++) {
      var k = ((yy - MINY) << 8) | (lz << 4) | lx;
      if (SB[k] !== before[k] || (yy === y && SB[k] === 0 && lx - 8 >= 0 && lx - 8 <= 1 && lz - 8 >= 0 && lz - 8 <= 1))
        W.setBlock(cx0 + lx, yy, cz0 + lz, SB[k]);
    }
    return true;
  };

  // A configured feature run on a live world through a 16x16 scratch window around (x, z) (bone meal on azalea:
  // azalea_tree; on moss_block: moss_patch_bonemeal, run at the block above). `clear` air-fills the origin first (the
  // sapling cell) and the window is written back only when the feature placed something.
  F.growFeature = function (W, name, x, y, z, r, clear) {
    if (!F.ready || !F.configured) return false;
    var gen = F.compile(name);
    if (!gen) return false;
    var MINY = NS.CFG.WORLD_MIN_Y, HH = NS.CFG.CHUNK_H, y0 = Math.max(MINY + 1, y - 8), y1 = Math.min(MINY + HH - 1, y0 + SAP_WIN);
    var SB = new Uint16Array(256 * HH), cx0 = x - 8, cz0 = z - 8, lx, lz, yy;
    for (yy = y0; yy <= y1; yy++) for (lz = 0; lz < 16; lz++) for (lx = 0; lx < 16; lx++)
      SB[((yy - MINY) << 8) | (lz << 4) | lx] = W.getBlock(cx0 + lx, yy, cz0 + lz) | 0;
    if (clear) SB[((y - MINY) << 8) | (8 << 4) | 8] = 0;
    var before = SB.slice();
    if (gen.run(SB, 0, 0, 8, y, 8, r) <= 0) return false;
    for (yy = y0; yy <= y1; yy++) for (lz = 0; lz < 16; lz++) for (lx = 0; lx < 16; lx++) {
      var k = ((yy - MINY) << 8) | (lz << 4) | lx;
      if (SB[k] !== before[k] || (clear && yy === y && lx === 8 && lz === 8)) W.setBlock(cx0 + lx, yy, cz0 + lz, SB[k]);
    }
    return true;
  };

})(MCL);
