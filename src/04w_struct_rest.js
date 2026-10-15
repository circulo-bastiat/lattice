// 04w_struct_rest.js — S5/S6: everything else the overworld has (PLAN W18, D-190).
// Runs on: main thread AND workers. No DOM.
//
// PLAN W18: *"Bastions, outposts, mansions, monuments, fortresses, end cities, shipwrecks,
// ocean ruins, nether fossils, buried treasure, ancient-city-style deep structures. Mixed data
// and code per §1.6's table. Placement from the 17 `structure_set` files — stolen wholesale."*
//
// ── ⚠ WHAT OF THAT LIST IS IN THIS BUILD AT ALL, COUNTED RATHER THAN IMPLIED ───────────────
//
// Seventeen structure sets; FOUR of them are not overworld and cannot generate here whatever
// this file does:
//
//   nether_complexes  bastion_remnant + fortress   the NETHER
//   nether_fossils    nether_fossil                the NETHER
//   end_cities        end_city                     the END
//
// PLAN's own W8 audit already ruled on these — *"Nether and End: 17 generator types, G19's
// dimensions, correctly out of scope"* — and D-2 fixed the version at 1.18.2, which has no
// ancient city (that is 1.19, and D-101 dropped its blocks for the same reason). So W18's
// overworld half is: **outposts (in 04v, they are jigsaw), mansions, monuments, shipwrecks,
// ocean ruins, buried treasure, and the stronghold**, and that is this file.
//
// ── ⚠ HOW MUCH OF EACH IS PORTED ───────────────────────────────────────────────────────────
//
//   shipwreck, ocean_ruin, woodland_mansion    NBT TEMPLATES (20, 48 and 73 of them) — placed
//                                              by W15's writer, so the CONTENT is vanilla's to
//                                              the block. The LAYOUT of a mansion is compiled
//                                              Java and is reimplemented; see its own note.
//   buried_treasure, ocean_monument, stronghold  no `.nbt` in the jar at all. Procedural Java,
//                                              reimplemented in the terms D-124 and D-185 use:
//                                              the silhouette and the materials are vanilla's,
//                                              the random SEQUENCE is not claimed.

(function (NS) {
  'use strict';

  var ST = NS.Structures, JG = NS.Jigsaw, SU = NS.StructSurface;
  var A = ST.api;
  var CFG = NS.CFG, MINY = CFG.WORLD_MIN_Y, H = CFG.CHUNK_H;

  // ── SHIPWRECK ─────────────────────────────────────────────────────────────────────────────
  //
  // `ShipwreckPieces`: one of twenty templates — three attitudes (rightsideup, sideways,
  // upsidedown) x three extents (full, fronthalf, backhalf) x degraded or not, plus two more —
  // dropped on the ocean floor, or beached above the waterline when `is_beached` is set.
  ST.register('shipwreck', function (cfg) {
    if (!(JG && JG.ready)) return null;
    var beached = cfg.is_beached === true;
    var T = NS.Templates;
    var ids = [];
    var all = T.names();
    for (var i = 0; i < all.length; i++) if (all[i].indexOf('shipwreck/') === 0) ids.push(all[i]);
    if (!ids.length) return null;
    ids.sort();
    return {
      reach: 3, name: 'shipwreck',
      preProbeY: function (ccx, ccz) { return NS.Column.height((ccx << 4) + 8, (ccz << 4) + 8); },
      sampleY: function (start) { return start.__surfaceY === undefined ? start.y0 : start.__surfaceY; },
      expand: function (start, r) {
        var mx = (start.cx << 4) + 8, mz = (start.cz << 4) + 8;
        var sea = ST.G.params.seaLevel | 0;
        var s = SU.survey(mx - 14, mz - 14, mx + 14, mz + 14, 4);
        ST.surveyed.shipwreck = (ST.surveyed.shipwreck || 0) + 1;
        start.__surfaceY = s.y;
        // ⚠ `is_beached` is the whole difference between the two configured structures: one wants
        // the ocean floor, the other the shore. Both are DATA, not a decision made here.
        var floor = NS.Column.height(mx, mz);
        if (beached ? (floor < sea - 2 || floor > sea + 4) : (floor > sea - 6)) {
          ST.rejected.shipwreck = (ST.rejected.shipwreck || 0) + 1; return null;
        }
        // ⚠ counted, not vetoed (D-243): `ShipwreckFeature.checkLocation` is a biome test and
        // nothing else, and this veto refused 2 of the 18 shipwrecks the real game placed in the
        // two golden worlds. A wreck lies on whatever the sea floor is.
        SU.tooRough('shipwreck', s.spread, 10, false);
        var id = ids[r.nextInt(ids.length)];
        var rot = r.nextInt(4), e = T.get(T.index(id)), sz = [0, 0, 0];
        JG.rotSize(e, rot, sz);
        var ox = mx - (sz[0] >> 1), oz = mz - (sz[2] >> 1);
        var oy = floor - 1;
        return [SU.templatePiece(id, rot, ox, oy, oz, { writeAir: false })];
      },
      write: SU.write
    };
  });

  // ── OCEAN RUIN ────────────────────────────────────────────────────────────────────────────
  //
  // `OceanRuinPieces`: one BIG ruin plus a scatter of small ones, from the 48 `underwater_ruin`
  // templates — `warm_*` or `brick_*` by `biome_temp`, `large_probability` deciding whether the
  // centre is a big one, `cluster_probability` how many neighbours it gets. All three numbers
  // are in the configured structure and all three are used here.
  ST.register('ocean_ruin', function (cfg) {
    if (!(JG && JG.ready)) return null;
    var warm = String(cfg.biome_temp || 'cold') === 'warm';
    var largeP = cfg.large_probability === undefined ? 0.3 : +cfg.large_probability;
    var clusterP = cfg.cluster_probability === undefined ? 0.9 : +cfg.cluster_probability;
    var T = NS.Templates;
    var big = [], small = [];
    var all = T.names();
    for (var i = 0; i < all.length; i++) {
      var n = all[i];
      if (n.indexOf('underwater_ruin/') !== 0) continue;
      var leaf = n.slice(16);
      var mine = warm ? (leaf.indexOf('warm_') === 0) : (leaf.indexOf('brick_') === 0 || leaf.indexOf('cracked_') === 0 || leaf.indexOf('mossy_') === 0);
      if (!mine) continue;
      (leaf.indexOf('big_') >= 0 ? big : small).push(n);
    }
    if (!small.length) return null;
    big.sort(); small.sort();
    return {
      reach: 3, name: 'ocean_ruin',
      preProbeY: function (ccx, ccz) { return NS.Column.height((ccx << 4) + 8, (ccz << 4) + 8); },
      sampleY: function (start) { return start.__surfaceY === undefined ? start.y0 : start.__surfaceY; },
      expand: function (start, r) {
        var mx = (start.cx << 4) + 8, mz = (start.cz << 4) + 8;
        var sea = ST.G.params.seaLevel | 0;
        ST.surveyed.ocean_ruin = (ST.surveyed.ocean_ruin || 0) + 1;
        start.__surfaceY = NS.Column.height(mx, mz);
        if (start.__surfaceY > sea - 4) { ST.rejected.ocean_ruin = (ST.rejected.ocean_ruin || 0) + 1; return null; }
        var pieces = [];
        var pool = (big.length && r.nextFloat() < largeP) ? big : small;
        pieces.push(one(pool[r.nextInt(pool.length)], mx, mz, r));
        // the cluster: up to three more small ones scattered around it
        for (var k = 0; k < 3; k++) {
          if (r.nextFloat() >= clusterP) break;
          var dx = r.nextInt(33) - 16, dz = r.nextInt(33) - 16;
          var h = NS.Column.height(mx + dx, mz + dz);
          if (h > sea - 4) continue;
          pieces.push(one(small[r.nextInt(small.length)], mx + dx, mz + dz, r));
        }
        return pieces;
        function one(id, x, z, rr) {
          var rot = rr.nextInt(4), e = T.get(T.index(id)), sz = [0, 0, 0];
          JG.rotSize(e, rot, sz);
          var floor = NS.Column.height(x, z);
          return SU.templatePiece(id, rot, x - (sz[0] >> 1), floor - 1, z - (sz[2] >> 1), {
            writeAir: false,
            // ⚠ vanilla's ruins are RUINS: `block_rot` at 0.7 is what stops them being tidy
            // brick boxes on the sea floor.
            procs: [{ kind: 'rot', integrity: 0.7 }]
          });
        }
      },
      write: SU.write
    };
  });

  // ── BURIED TREASURE ───────────────────────────────────────────────────────────────────────
  //
  // `BuriedTreasurePiece`, and it is the smallest structure in the game: ONE chest, under the
  // beach, at the middle of a chunk chosen by a grid of spacing 1 with `probability 0.01`.
  // ⚠ Without block entities the chest has nothing in it (PLAN G2/G17, D-141) — so what this
  // places is a chest block under the sand, which is the right block in the right cell and an
  // empty box. Said rather than implied.
  ST.register('buried_treasure', function (cfg) {
    var prob = cfg.probability === undefined ? 0.01 : +cfg.probability;
    return {
      reach: 1, name: 'buried_treasure',
      gate: function (r) { return r.nextFloat() < prob; },
      sampleY: function (start) { return start.y0; },
      expand: function (start, r) {
        var mx = (start.cx << 4) + 9, mz = (start.cz << 4) + 9;
        var h = NS.Column.height(mx, mz);
        // ⚠ THE DEPTH WINDOW IS GONE, AND THE ANSWER KEY IS WHY (D-243). It read "vanilla
        // buries it on a BEACH: at or just under the waterline", which is what the BIOME TAG
        // already says — `has_structure/buried_treasure` is `beach` and `snowy_beach` and
        // nothing else — and `BuriedTreasureFeature.checkLocation` is that tag plus the 0.01
        // probability and no third test. Measured: the window refused 2 of the 5 buried
        // treasures the real game placed in the two golden worlds, both on beach columns whose
        // ground stands at y=50 and y=51 against a sea level of 63. A beach that low is still a
        // beach, and vanilla buries a chest under it.
        if (h <= MINY + 1) return null;
        var CHEST = A.stateOf('chest');
        if (!CHEST) return null;
        var c = new SU.Cells();
        c.set(0, 0, 0, CHEST);
        return [SU.blocksPiece(mx, h - 1, mz, 0, c.a, 1, 1, 1)];
      },
      write: SU.write
    };
  });

  // ── OCEAN MONUMENT ────────────────────────────────────────────────────────────────────────
  //
  // `OceanMonumentPieces`: 58x23x58 of prismarine on the sea floor, a lantern-lit core, wings,
  // and the elder guardians' room. It has no NBT at all — the whole thing is `MonumentBuilding`
  // plus twelve room classes in Java — so this is a reimplementation, and it says which half.
  // ⚠ PORTED: the footprint (58x58), the height (23), the three prismarine materials and the
  // sea-lantern lighting, the raised central block, the corner turrets and the entrance arches.
  // NOT PORTED: the twelve interior room classes and their random tiling, because they are
  // twelve Java classes with no data behind them and nothing here could check a port of them.
  // The shell, the core and the lighting are what a player sees from outside and from the door.
  ST.register('monument', function (cfg) {
    return {
      reach: 4, name: 'monument',
      preProbeY: function (ccx, ccz) { return NS.Column.height((ccx << 4) + 8, (ccz << 4) + 8); },
      sampleY: function (start) { return start.__surfaceY === undefined ? start.y0 : start.__surfaceY; },
      expand: function (start, r) {
        var mx = (start.cx << 4) + 8, mz = (start.cz << 4) + 8;
        var sea = ST.G.params.seaLevel | 0;
        var s = SU.survey(mx - 29, mz - 29, mx + 29, mz + 29, 8);
        ST.surveyed.monument = (ST.surveyed.monument || 0) + 1;
        start.__surfaceY = s.y;
        // deep water, and a floor flat enough that the monument is not half in a trench
        if (s.hi > sea - 12 || s.spread > 12) { ST.rejected.monument = (ST.rejected.monument || 0) + 1; return null; }
        var P = A.stateOf('prismarine'), PB = A.stateOf('prismarine_bricks'), DP = A.stateOf('dark_prismarine');
        var LAN = A.stateOf('sea_lantern');
        if (!P || !PB || !DP) return null;
        var N = 58, HT = 23, SEA = SU.SEA;
        var c = new SU.Cells();
        var seed = JG.hash4(0x0CEA7, mx, s.y, mz);
        var x, y, z;
        // the shell: prismarine outside, bricks on the corners, dark prismarine banding
        for (y = 0; y < HT; y++) {
          for (z = 0; z < N; z++) {
            for (x = 0; x < N; x++) {
              var edge = (x < 2 || x >= N - 2 || z < 2 || z >= N - 2 || y === 0 || y === HT - 1);
              if (!edge) continue;
              // ⚠ the mix is a POSITION HASH, not a draw (D-185's rule): the monument spans
              // sixteen chunks and `write` is entered once per chunk.
              var hsh = JG.hash4(seed, x, y, z) % 10;
              c.set(x, y, z, hsh < 1 ? DP : (hsh < 3 ? PB : P));
            }
          }
        }
        // ⚠ EVERY HOLLOW OF THIS BUILDING IS `SU.SEA` AND NOT `-1` (D-226). The comment on the
        // next line said "out to water" and the code wrote AIR, and that one character was
        // 41,362 cells of drained ocean per monument. Vanilla's monument has no air in it at
        // all: `OceanMonumentPiece` empties every cell with `generateWaterBox`.
        // hollow the interior out to water, so it is a building and not a block
        c.box(2, 1, 2, N - 3, HT - 2, N - 3, SEA);
        // the core: a raised dark-prismarine dais with a lantern on it
        c.box(24, 1, 24, 33, 8, 33, PB);
        c.box(25, 2, 25, 32, 7, 32, SEA);
        // ⚠ THE DAIS REACHES THE CORE WALL (D-226). It was 27..30 inside a hollow of 25..32, so
        // it touched nothing: an 18-cell island of dark prismarine and two sea lanterns hanging
        // in the middle of the chamber, and `structaudit` §1 counted all 18 every time it
        // sampled a monument. 25..32 is the same slab resting on the core wall it belongs to.
        c.box(25, 3, 25, 32, 3, 32, DP);
        if (LAN) { c.set(28, 4, 28, LAN); c.set(29, 4, 29, LAN); }
        // four corner turrets
        for (var tx = 0; tx < 2; tx++) for (var tz = 0; tz < 2; tz++) {
          var bx = tx ? N - 9 : 1, bz = tz ? N - 9 : 1;
          c.shell(bx, HT - 1, bz, bx + 7, HT + 5, bz + 7, PB);
          c.box(bx + 1, HT, bz + 1, bx + 6, HT + 5, bz + 6, SEA);
        }
        // the three entrance arches on each face
        for (var e2 = 0; e2 < 3; e2++) {
          var o = 12 + e2 * 17;
          c.box(o, 1, 0, o + 3, 4, 1, SEA);
          c.box(o, 1, N - 2, o + 3, 4, N - 1, SEA);
          c.box(0, 1, o, 1, 4, o + 3, SEA);
          c.box(N - 2, 1, o, N - 1, 4, o + 3, SEA);
        }
        var floorY = s.lo - 1;
        var mp = SU.blocksPiece(mx - 29, floorY, mz - 29, r.nextInt(4), c.a, N, HT + 6, N);
        // D-#4494: 3 persistent elder guardians (core room + two wing rooms; vanilla spawnElder).
        // ponytail: room centres are approximate, the twelve room classes are not ported.
        mp.ents = [['elder_guardian', 29, 4, 29], ['elder_guardian', 11, 4, 29], ['elder_guardian', 47, 4, 29]];
        return [mp];
      },
      write: SU.write
    };
  });

  // ── WOODLAND MANSION ──────────────────────────────────────────────────────────────────────
  //
  // 73 NBT templates on a grid of 7x8x7 room cells: `1x1_*` and `1x2_*` and `2x2_*` rooms,
  // `wall_flat` / `wall_window` / `wall_corner` outside them, `roof` / `roof_corner` on top,
  // `carpet_*` and `corridor_floor` between, and one `entrance`.
  //
  // ⚠ THE LAYOUT IS A REIMPLEMENTATION AND THE ROOMS ARE NOT. `WoodlandMansionPieces` grows an
  // irregular outline with a `SimpleGrid` and then walks it three times, once per floor, with a
  // room-placement pass that has no data behind it — so what is here is a RECTANGULAR mansion of
  // the same cell size, the same three floors, the same walls and the same roof, built out of
  // Mojang's own room templates. A player sees vanilla's rooms in a simpler footprint. Saying
  // "mansion" without saying that would be the kind of claim §24 is about.
  ST.register('mansion', function (cfg) {
    if (!(JG && JG.ready)) return null;
    var T = NS.Templates;
    var rooms1 = [], rooms2 = [];
    var all = T.names();
    for (var i = 0; i < all.length; i++) {
      var n = all[i];
      if (n.indexOf('woodland_mansion/1x1_') === 0 && n.indexOf('_as') < 0) rooms1.push(n);
      if (n.indexOf('woodland_mansion/1x2_') === 0 && n.indexOf('stairs') < 0 && n.indexOf('_se') < 0) rooms2.push(n);
    }
    if (!rooms1.length) return null;
    rooms1.sort(); rooms2.sort();
    var CELL = 7, FLOOR = 8;
    return {
      reach: 5, name: 'mansion',
      preProbeY: function (ccx, ccz) { return NS.Column.height((ccx << 4) + 8, (ccz << 4) + 8); },
      sampleY: function (start) { return start.__surfaceY === undefined ? start.y0 : start.__surfaceY; },
      expand: function (start, r) {
        var mx = (start.cx << 4) + 8, mz = (start.cz << 4) + 8;
        var GX = 7, GZ = 7;                                  // cells; 49x49 blocks of building
        var half = (GX * CELL) >> 1;
        var s = SU.survey(mx - half, mz - half, mx + half, mz + half, 4);
        ST.surveyed.mansion = (ST.surveyed.mansion || 0) + 1;
        start.__surfaceY = s.y;
        if (NS.Column.height(mx, mz) < (ST.G.params.seaLevel | 0) || s.spread > 14) {
          ST.rejected.mansion = (ST.rejected.mansion || 0) + 1; return null;
        }
        var ox = mx - half, oz = mz - half, oy = s.y + 1;
        var out = [];
        var bd = SU.beardPiece(ox, oz, ox + GX * CELL - 1, oz + GZ * CELL - 1, oy, oy + 3 * FLOOR + CELL, 5);
        out.push(bd, SU.shavePiece(bd));
        var gx, gz, f;
        for (f = 0; f < 3; f++) {
          var fy = oy + f * FLOOR;
          for (gz = 0; gz < GZ; gz++) {
            for (gx = 0; gx < GX; gx++) {
              var px = ox + gx * CELL, pz = oz + gz * CELL;
              var border = (gx === 0 || gz === 0 || gx === GX - 1 || gz === GZ - 1);
              var id;
              if (border) {
                var corner = (gx === 0 || gx === GX - 1) && (gz === 0 || gz === GZ - 1);
                id = 'woodland_mansion/' + (corner ? 'wall_corner' : ((gx + gz + f) % 3 === 0 ? 'wall_window' : 'wall_flat'));
              } else {
                id = rooms1[JG.hash4(0x3A115 + f, gx, gz, 0) % rooms1.length];
              }
              // ⚠ the wall pieces are 7x8x7 and face outward, so their rotation is the side of
              // the grid they are on, not a random draw: a window looking into the ballroom is
              // what a rotation drawn from the rng gets you.
              var rot = gz === 0 ? 0 : (gx === GX - 1 ? 1 : (gz === GZ - 1 ? 2 : 3));
              out.push(SU.templatePiece(id, border ? rot : (JG.hash4(0x5A11, gx, gz, f) & 3), px, fy, pz, { writeAir: true }));
            }
          }
        }
        // the entrance, on the south face, and the roof over everything
        var ey = oy;
        out.push(SU.templatePiece('woodland_mansion/entrance', 0, ox + ((GX * CELL - 21) >> 1), ey, oz + GZ * CELL - 16, { writeAir: true }));
        var ry = oy + 3 * FLOOR;
        for (gz = 0; gz < GZ; gz++) {
          for (gx = 0; gx < GX; gx++) {
            var rid = 'woodland_mansion/roof';
            var rr = 0;
            if ((gx === 0 || gx === GX - 1) && (gz === 0 || gz === GZ - 1)) { rid = 'woodland_mansion/roof_corner'; rr = (gx === 0 ? (gz === 0 ? 0 : 3) : (gz === 0 ? 1 : 2)); }
            else if (gx === 0 || gx === GX - 1 || gz === 0 || gz === GZ - 1) { rid = 'woodland_mansion/roof_front'; rr = gz === 0 ? 0 : (gx === GX - 1 ? 1 : (gz === GZ - 1 ? 2 : 3)); }
            out.push(SU.templatePiece(rid, rr, ox + gx * CELL, ry, oz + gz * CELL, { writeAir: false }));
          }
        }
        return out;
      },
      write: SU.write
    };
  });
})(MCL);
