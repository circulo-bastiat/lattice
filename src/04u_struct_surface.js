// 04u_struct_surface.js — S3: small surface buildings, and the BEARD (PLAN W16, D-188).
// Runs on: main thread AND workers. No DOM.
//
// PLAN W16: *"Single-piece structures: huts, towers, wells, ruined portals, igloos. One bounding
// box, one flatness test, one beard. **This is where terrain negotiation gets built and debugged
// — on something small enough that failures are cheap and obvious.**"*
//
// So this file is really two things: the negotiation machinery that W17 and W18 then reuse, and
// five small structures that exercise it.
//
// ── ⚠ THE BEARD, AND WHY MC-LITE NEEDS A DIFFERENT ONE FROM VANILLA'S ──────────────────────
//
// `STRUCTURES.md` names the three adaptation tools: **fit** (place at the sampled height, no
// terrain change), **beard** (synthesise support under the piece and shave a little above it,
// blended at the edges), **excavate** (carve into the hillside and wall it). W13 and W14 were
// fit-only. This is the beard.
//
// Vanilla's beard is a DENSITY-FUNCTION term: `minecraft:beardifier` adds density under a
// structure's bounding box so the terrain noise itself grows a plinth. PLAN §7 says in as many
// words not to steal it — *"Do not steal density-function-driven terrain negotiation: it assumes
// terrain MC-Lite does not have"* — and deviation #1 removed the density stack it lives in.
// What MC-Lite has instead is better for this: `Column.height(x, z)` is a PURE FUNCTION, so the
// beard can be computed per column, after the terrain, with no noise and no neighbours:
//
//     for every column within `margin` of the footprint
//         h      = Column.height(x, z)                       the natural ground
//         base   = floorY - 1, lerped toward h as the column leaves the box
//         FILL   from h+1 up to base                         the plinth
//         SHAVE  from base+1 to the box top, inside the box   the hillside that would bury it
//
// ⚠ Every term is a pure function of (x, z) and the piece, so the beard is byte-identical
// whichever chunk asks for it — which is the same invariant W13 imposed on starts, one level
// down. It is also why the blend is a lerp on the COLUMN and not a smoothing pass over written
// blocks: a smoothing pass reads its neighbours, and half of them are in another chunk.

(function (NS) {
  'use strict';

  var CFG = NS.CFG;
  var MINY = CFG.WORLD_MIN_Y, H = CFG.CHUNK_H;

  var ST = NS.Structures, JG = NS.Jigsaw;
  if (!ST) throw new Error('04u_struct_surface.js loaded before 04r_structures.js');

  var A = ST.api;
  var SU = NS.StructSurface = {};

  // ── the flatness / suitability test ───────────────────────────────────────────────────────
  //
  // ⚠ PLAN §9's risk 5 is this test: *"Terraced terrain rejects too many village sites —
  // deviation #1 makes harder edges than vanilla."* So it returns the numbers rather than a
  // verdict, and each structure chooses its own tolerance; `structcheck` reports the rejection
  // rate per structure so the tuning is measured rather than guessed.
  var _s = { y: 0, lo: 0, hi: 0, spread: 0, water: 0, n: 0 };
  SU.survey = function (x0, z0, x1, z1, step) {
    var CO = NS.Column, sea = ST.G.params.seaLevel | 0;
    var lo = 2147483647, hi = -2147483648, sum = 0, n = 0, water = 0;
    // ⚠ THE SAMPLE COUNT IS CAPPED, NOT THE SPACING. `Column.height` is the whole spline stack,
    // and a village's 49-block window at a fixed step of 4 is 169 of them for one candidate
    // site — most of which are rejected. Capping the grid at 9x9 keeps the spread estimate
    // (which is a max-minus-min over a window, not a fine measurement) and cuts the cost by more
    // than half. The tolerances in this file were re-measured against the capped survey.
    step = Math.max(step || 4, Math.ceil((x1 - x0) / 8));
    for (var z = z0; z <= z1; z += step) {
      for (var x = x0; x <= x1; x += step) {
        var h = CO.height(x, z);
        if (h < lo) lo = h;
        if (h > hi) hi = h;
        sum += h; n++;
        if (h < sea) water++;
      }
    }
    _s.lo = lo; _s.hi = hi; _s.spread = hi - lo; _s.n = n; _s.water = water;
    // ⚠ THE MEAN, NOT THE MAXIMUM. Taking the highest column floats the building over the low
    // side; taking the lowest buries it. The mean puts the beard's work on both sides, which is
    // what makes the plinth small enough to blend.
    _s.y = Math.round(sum / n);
    return _s;
  };

  // ── the beard ─────────────────────────────────────────────────────────────────────────────
  var DIRT = 0, STONE = 0, GRASS = 0, resolved = false;
  function resolve() {
    if (resolved) return;
    DIRT = A.stateOf('dirt'); STONE = A.stateOf('stone'); GRASS = A.stateOf('grass_block');
    if (!DIRT || !STONE) throw new Error('beard: the registry is missing dirt or stone');
    resolved = true;
  }

  /**
   * beardPiece(box, floorY, margin) — a synthetic piece the write pass runs BEFORE the real
   * ones, so the structure overwrites its own plinth where the two meet.
   */
  //
  // ⚠ ITS BOX IS THE STRUCTURE'S, NOT THE WORLD'S. The first version gave the beard `y0 = MINY`
  // on the grounds that the plinth reaches down to whatever the ground happens to be — and since
  // a start's bounding box is the union of its pieces', every surface structure in the world
  // then claimed a box from bedrock to its roof. Nothing placed wrongly, because the write pass
  // clips on x and z; what broke was the BIOME PROBE, which asks the biome at the box's own y
  // (D-184) and was therefore asking at y = -64 for a building standing on grass.
  //
  // ⚠ FILL AND SHAVE ARE SEPARABLE, and W17 needs them separated. A piece that stands on ANOTHER
  // PIECE — a watchtower on its base plate, a mansion's second floor — must not be given a
  // plinth, or the beard builds a twenty-block dirt pillar up to a floor that already has one.
  // It must still be SHAVED, or the hillside it was built into grows through its interior:
  // measured at **8.4% of the outpost's interior cells solid** before the two were split.
  //
  // ⚠ AND FILL AND SHAVE ARE SEPARATE PIECES, IN THAT ORDER, ACROSS THE WHOLE STRUCTURE. Two
  // neighbouring houses' skirts overlap, so a village that ran [fill A, shave A, fill B, shave B]
  // had house B's shave cut away house A's plinth wherever the two met: **62 of a desert
  // village's 467 floor columns were over air** and every one of them was on that seam. Every
  // fill in the structure runs before every shave, which is why `phase` exists.
  SU.beardPiece = function (x0, z0, x1, z1, floorY, topY, margin, fill) {
    return { kind: 'beard', phase: 0, x0: x0 - margin, y0: floorY - 1, z0: z0 - margin,
             x1: x1 + margin, y1: topY, z1: z1 + margin, fill: fill !== false,
             bx0: x0, bz0: z0, bx1: x1, bz1: z1, floorY: floorY, topY: topY, margin: margin };
  };
  /** The same box, shave phase only. Pushed after every fill in the structure. */
  SU.shavePiece = function (b) {
    var p = {};
    for (var k in b) p[k] = b[k];
    p.phase = 1;
    return p;
  };
  SU.writeBeard = function (SB, cx, cz, p) {
    resolve();
    var CO = NS.Column;
    var ox = cx << 4, oz = cz << 4;
    var xlo = Math.max(p.x0, ox), xhi = Math.min(p.x1, ox + 15);
    var zlo = Math.max(p.z0, oz), zhi = Math.min(p.z1, oz + 15);
    var n = 0;
    for (var z = zlo; z <= zhi; z++) {
      for (var x = xlo; x <= xhi; x++) {
        // Chebyshev distance outside the footprint: 0 inside, 1..margin in the blend skirt
        var dx = x < p.bx0 ? p.bx0 - x : (x > p.bx1 ? x - p.bx1 : 0);
        var dz = z < p.bz0 ? p.bz0 - z : (z > p.bz1 ? z - p.bz1 : 0);
        var d = dx > dz ? dx : dz;
        if (d > p.margin) continue;
        var h = CO.height(x, z);
        var base = p.floorY - 1;
        if (d > 0) {
          var t = d / (p.margin + 1);
          base = Math.round(base + (h - base) * t);
        }
        // the top block of the natural column, so the plinth's skin matches the ground it grew
        // out of rather than being a disc of dirt in a desert
        var skin = A.get(SB, cx, cz, x, h, z);
        if (skin <= 0) skin = GRASS || DIRT;
        var y;
        // FILL — the plinth
        if (p.fill && p.phase === 0) for (y = h + 1; y <= base; y++) {
          if (y < MINY || y >= MINY + H) continue;
          n += A.set(SB, cx, cz, x, y, z, (base - y) < 1 ? skin : ((base - y) < 4 ? DIRT : STONE));
        }
        // ⚠ and where the plinth had to be built, the column's own former top becomes the INSIDE
        // of the plinth rather than a grass layer buried three blocks down.
        if (p.fill && p.phase === 0 && base > h && h >= MINY && skin === GRASS && GRASS) n += A.set(SB, cx, cz, x, h, z, DIRT);
        // ⚠ AND THEN DOWNWARD, UNTIL IT HITS SOMETHING, WHICH `Column.height` CANNOT TELL IT.
        // The plinth above fills up to the pure column height — and the world under that height
        // is not solid: the carvers and the noise caves cut through it, and a cave that opens
        // three blocks under a village house leaves the house's floor over a hole. Measured on
        // one desert village: **62 of 467 floor columns had air directly beneath them**, every
        // one of them over a cave the column function does not know about. So the fill walks
        // down from the floor while the cell is air, up to twelve blocks, which is the one place
        // the beard is allowed to READ — and it is legal for D-185's reason: (x, y, z) and
        // (x, y-1, z) are the same column, so they are in the same chunk whenever either is.
        if (p.fill && p.phase === 0 && d === 0) {
          var down = base < h ? base : h;
          for (var k2 = 0; k2 < 12; k2++, down--) {
            if (down < MINY + 1) break;
            var cur = A.get(SB, cx, cz, x, down, z);
            if (cur < 0) break;
            if (cur !== 0 && NS.States.opaque[cur] === 1) break;
            if (cur !== 0 && NS.States.waterIn[cur]) break;      // never drain an ocean
            n += A.set(SB, cx, cz, x, down, z, k2 < 3 ? DIRT : STONE);
          }
        }
        // SHAVE — only inside the footprint, or the skirt becomes a trench
        if (d === 0 && p.phase === 1) {
          var from = base + 1;
          if (from <= h) {
            // ⚠ AND IT RUNS DOWNWARD AND STOPS AT THE WATERLINE (D-221). D-212 stopped the shave
            // REMOVING the water; it went on removing the ROCK THE WATER WAS STANDING ON, four
            // lines below, because the loop ran upward and treated a water cell as something to
            // skip past rather than something to stop at. A submerged piece's box is then dug out
            // of the sea floor and the sea is left sitting on the hole: 167 of the 279 cells
            // `structaudit` §6 still charged to the structure pass were exactly that — control
            // world SOLID, written world AIR, natural sea water directly above or beside, at
            // ruined_portal_ocean 83, ruined_portal_mountain 63 and village_plains 21.
            // ⚠ THE READ IS THE SAME COLUMN, WHICH IS WHY IT IS LEGAL (D-185). (x, y, z) and
            // (x, y-1, z) are in the target chunk together, so the answer is the same in all nine
            // — the identical argument `04s`'s plank floor and the FILL branch above both make.
            // Going down instead of up is what makes one read enough: the first liquid the scan
            // meets is the bottom of the water column, and everything under it is holding it up.
            for (y = p.topY; y >= from; y--) {
              if (y >= MINY + H) continue;
              if (y < MINY) break;
              var sh = A.get(SB, cx, cz, x, y, z);
              if (sh < 0) break;
              if (sh !== 0 && NS.States.waterIn[sh]) break;   // the sea stands on what is below
              // ⚠ AND THE SAME RULE IN ITS PURE FORM, BECAUSE THE BLOCK READ CAN BE LIED TO
              // (D-226). The read above sees the world as it is NOW, and every FILL in the
              // structure has already run (that is what `phase` is for): a plinth that reclaimed
              // a shoreline replaced the sea with dirt, and the shave then walked straight down
              // through the waterline finding no water to stop at. `structaudit` §6c caught the
              // result — a 2-cell DRY POCKET at -1576,56..57,-452 under five blocks of standing
              // sea, in the one plains village of the sample that meets a beach.
              // `Column.height(x, z) < y <= seaLevel` is D-221's own test for "this cell holds
              // sea water", it is a pure function of (x, z), and it says where the sea WAS
              // whatever has since been written over it.
              if (y > h && y <= (ST.G.params.seaLevel | 0)) break;
              // ⚠ NEVER DRAIN AN OCEAN — the same rule the FILL branch thirty lines above already
              // states, and the shave did not have it at all (D-212). Clearing water here carves
              // an air bubble round a submerged structure whose every wall is air against water,
              // and leaves the sea above it hanging on nothing. `structaudit` §6 measured
              // structure-written air against water at 1.62% against a natural baseline of 0.02%
              // in the same windows — 80x — worst at ruined_portal_ocean (46.8% of its own air
              // cells) and ocean_ruin_cold (28.9%). Vanilla places these with `keepLiquids`, so
              // an underwater ruin is FULL of water and that is what it is supposed to look like.
              // The rule is now the `break` above rather than a skip, which is the stronger form:
              // it does not drain the sea AND it does not undermine it.
              if (sh > 0) n += A.set(SB, cx, cz, x, y, z, 0);
            }
          }
        }
      }
    }
    return n;
  };

  // ── a template piece, placed on the surface ───────────────────────────────────────────────
  SU.templatePiece = function (tplId, rot, ox, oy, oz, opts) {
    var T = NS.Templates;
    var ti = T.index(tplId);
    if (ti < 0) throw new Error('surface: no template ' + tplId);
    var e = T.get(ti), s = [0, 0, 0];
    JG.rotSize(e, rot, s);
    var o = opts || {};
    // ⚠ AIR IS WRITTEN HERE BY DEFAULT, AND THAT IS NOT THE JIGSAW RULE D-216 INVERTED. These
    // are the hand-placed templates — igloo, ocean ruin, shipwreck, ruined portal — which
    // vanilla places through `TemplateStructurePiece` with `BlockIgnoreProcessor.STRUCTURE_BLOCK`
    // alone, so their air IS written. Only a pool element carries the legacy/plain distinction,
    // and only `JG.compileElement` decides it. Do not "fix" this line to match that one.
    return { kind: 'template', tpl: ti, palIdx: 0, rot: rot & 3, ox: ox, oy: oy, oz: oz,
             writeAir: o.writeAir !== false, procs: o.procs || null, proj: JG.PROJ_RIGID,
             seed: JG.hash4(0x7E11, ox, oy, oz), finalOf: o.finalOf || null,
             x0: ox, y0: oy, z0: oz, x1: ox + s[0] - 1, y1: oy + s[1] - 1, z1: oz + s[2] - 1 };
  };

  /** The one write entry every surface grammar shares. */
  SU.write = function (SB, cx, cz, p) {
    if (p.kind === 'beard') return SU.writeBeard(SB, cx, cz, p);
    if (p.kind === 'template') return JG.writePiece(SB, cx, cz, p);
    if (p.kind === 'blocks') return SU.writeBlocks(SB, cx, cz, p);
    throw new Error('surface: unknown piece kind ' + p.kind);
  };

  /**
   * A hand-built piece: a flat list of [dx, dy, dz, state] in the piece's own frame, rotated
   * with the piece. The procedural structures — the huts and the two temples — are built into
   * one of these at EXPAND time, so the write pass is the same loop for every kind and the
   * randomness is spent once, in the piece pass, where it is a pure function of the start.
   */
  SU.blocksPiece = function (ox, oy, oz, rot, cells, w, h2, d) {
    var s = (rot & 1) ? [d, h2, w] : [w, h2, d];
    return { kind: 'blocks', ox: ox, oy: oy, oz: oz, rot: rot & 3, cells: cells, w: w, d: d,
             x0: ox, y0: oy, z0: oz, x1: ox + s[0] - 1, y1: oy + s[1] - 1, z1: oz + s[2] - 1 };
  };

  SU.writeBlocks = function (SB, cx, cz, p) {
    var n = 0, ox = cx << 4, oz = cz << 4;
    var c = p.cells;
    for (var i = 0; i < c.length; i += 4) {
      var lx = c[i], ly = c[i + 1], lz = c[i + 2], st = c[i + 3];
      var wx, wz;
      switch (p.rot) {
        case 0: wx = p.ox + lx; wz = p.oz + lz; break;
        case 1: wx = p.ox + (p.d - 1 - lz); wz = p.oz + lx; break;
        case 2: wx = p.ox + (p.w - 1 - lx); wz = p.oz + (p.d - 1 - lz); break;
        default: wx = p.ox + lz; wz = p.oz + (p.w - 1 - lx); break;
      }
      if (wx < ox || wx > ox + 15 || wz < oz || wz > oz + 15) continue;
      var wy = p.oy + ly;
      if (wy < MINY || wy >= MINY + H) continue;
      var out;
      if (st === -1) out = 0;                                  // CLEAR: this cell becomes air
      else if (st === SU.SEA) out = wy <= (ST.G.params.seaLevel | 0) ? waterState() : 0;
      else out = p.rot ? JG.rotateStateReal(st, p.rot) : st;
      n += A.set(SB, cx, cz, wx, wy, wz, out);
      // a piece that names a spawner mob (`p.mob`) gets it on its spawner cell, same channel the
      // mineshaft's cave_spider cage uses (NS.Spawner in-context, else Gen.spawnerLog for the worker)
      if (p.mob && st === p.mobState) {
        if (NS.Spawner && NS.Spawner.assign) NS.Spawner.assign(wx, wy, wz, p.mob);
        else if (NS.Gen && NS.Gen.spawnerLog) NS.Gen.spawnerLog.push([wx, wy, wz, p.mob]);
      }
    }
    if (p.ents && NS.Gen && NS.Gen.entityLog) SU.writeBlockEnts(cx, cz, p);
    return n;
  };

  /** `p.ents` = [[id, lx, ly, lz]...] in the piece frame (cell centres); each is logged by the one chunk holding it. */
  SU.writeBlockEnts = function (cx, cz, p) {
    for (var i = 0; i < p.ents.length; i++) {
      var en = p.ents[i], lx = en[1], lz = en[3], wx, wz;
      switch (p.rot) {
        case 0: wx = p.ox + lx; wz = p.oz + lz; break;
        case 1: wx = p.ox + (p.d - lz); wz = p.oz + lx; break;
        case 2: wx = p.ox + (p.w - lx); wz = p.oz + (p.d - lz); break;
        default: wx = p.ox + lz; wz = p.oz + (p.w - lx); break;
      }
      if ((Math.floor(wx) >> 4) === cx && (Math.floor(wz) >> 4) === cz) NS.Gen.entityLog.push([en[0], wx, p.oy + en[2], wz, 0]);
    }
  };

  /**
   * ⚠ THE SECOND CLEAR MARKER, AND D-226 IS WHY IT HAD TO EXIST — D-212's FOURTH WRITER.
   *
   * `-1` means "this cell becomes AIR", and for a building on land that is what a hollow is.
   * A building under the SEA is a different thing: vanilla's `OceanMonumentPiece` never writes
   * air at all — every empty cell of a monument goes through `generateWaterBox`, so the finished
   * building is FULL of water and a player swims through it. MC-Lite hollowed the monument with
   * `-1` and turned **41,362 cells of ocean into air per monument** — 78.6% of every natural
   * water cell in its window, measured over two monuments on two seeds. That is the defect D-212
   * named for the shave and for the template writer, in the one writer neither of them reached.
   *
   * `SU.SEA` is the hollow that does not drain: water at or below the sea level, air above it.
   * The clamp is vanilla's own — `OceanMonumentBuilding.postProcess` floods its box up to
   * `max(getSeaLevel(), 64)` and no further — and it is what stops a turret that pokes out of the
   * water from carrying a column of sea inside its roof.
   *
   * ⚠ IT IS A PURE FUNCTION OF `wy`, so it obeys D-185: all nine chunks that write this piece
   * decide the same thing about the same cell, and there is no seam. It reads no block, so it
   * costs nothing over `-1`.
   */
  SU.SEA = -2;
  var _water = -1;
  function waterState() {
    if (_water < 0) _water = A.stateOf('water') || 0;
    return _water;
  }

  // A cell list builder, so the procedural shapes below read as shapes.
  function Cells() { this.a = []; }
  Cells.prototype.set = function (x, y, z, st) { this.a.push(x, y, z, st); return this; };
  Cells.prototype.box = function (x0, y0, z0, x1, y1, z1, st) {
    for (var y = y0; y <= y1; y++) for (var z = z0; z <= z1; z++) for (var x = x0; x <= x1; x++) this.a.push(x, y, z, st);
    return this;
  };
  Cells.prototype.shell = function (x0, y0, z0, x1, y1, z1, st) {
    for (var y = y0; y <= y1; y++) for (var z = z0; z <= z1; z++) for (var x = x0; x <= x1; x++) {
      if (x === x0 || x === x1 || y === y0 || y === y1 || z === z0 || z === z1) this.a.push(x, y, z, st);
    }
    return this;
  };
  SU.Cells = Cells;
})(MCL);

// ═══════════════════════════════════════════════════════════════════════════════════════════
// THE FIVE STRUCTURES (PLAN W16)
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠ TWO OF THEM ARE DATA AND THREE ARE CODE, and the split is Mojang's, not a choice made here.
// `igloo` and `ruined_portal` are NBT templates (3 and 13 of them), so they are placed by W15's
// writer. `swamp_hut`, `desert_pyramid` and `jungle_pyramid` have no `.nbt` in the jar at all —
// they are `SwamplandHutPiece`, `DesertPyramidPiece` and `JunglePyramidPiece`, compiled Java —
// so they are built here, in the same terms D-124 and D-185 use: the SILHOUETTE and the
// materials are vanilla's and checkable against a screenshot; the interiors are simplified where
// what they contain is a loot chest or a trapped-TNT redstone circuit this build has no block
// entities for (PLAN G2/G17), and that is said here rather than implied.

(function (NS) {
  'use strict';

  var ST = NS.Structures, JG = NS.Jigsaw, SU = NS.StructSurface;
  var A = ST.api;
  var CFG = NS.CFG, MINY = CFG.WORLD_MIN_Y, H = CFG.CHUNK_H;

  /** The shared shape of a surface structure: survey, reject, beard, place. */
  function surfaceGrammar(cfg, o) {
    // a template-driven structure with no template blob has nothing to place; say so rather
    // than reading a null header three calls deep (D-188)
    if (o.needsTemplates && !(NS.Jigsaw && NS.Jigsaw.ready)) return null;
    return {
      reach: o.reach,
      name: o.name,
      /** The biome probe, before anything is built — see the note in `buildStart` (D-192). */
      preProbeY: function (ccx, ccz) { return NS.Column.height((ccx << 4) + 8, (ccz << 4) + 8); },
      /**
       * The biome probe is the SURFACE, which is where these stand — the survey's own mean
       * ground level, recorded by `expand` rather than re-derived, so the probe and the
       * placement cannot disagree.
       */
      sampleY: function (start) { return start.__surfaceY === undefined ? start.y0 : start.__surfaceY; },
      gate: o.gate || null,
      expand: function (start, r) {
        var ccx = start.cx, ccz = start.cz;
        var mid = { x: (ccx << 4) + 8, z: (ccz << 4) + 8 };
        var rot = r.nextInt(4);
        var half = o.half;
        var s = SU.survey(mid.x - half, mid.z - half, mid.x + half, mid.z + half, 4);
        // ⚠ "ON LAND" IS A TEST ON THE CENTRE, NOT ON EVERY COLUMN. The first version rejected a
        // site if ANY column in the window was below sea level, which on a coastline threw away
        // every site within eleven blocks of water and cut igloos to a seventh of vanilla's
        // density. A structure stands where its middle stands; the beard deals with the edges.
        if (o.needsWater && s.water < s.n) return null;
        // ⚠ PLAN §9 risk 5: MC-Lite's terracing makes harder edges than vanilla, so a flatness
        // test tuned for vanilla rejects too much. The tolerance is per structure and the
        // rejection rate is REPORTED by `structcheck` rather than assumed acceptable.
        ST.surveyed[o.name] = (ST.surveyed[o.name] || 0) + 1;
        start.__surfaceY = s.y;
        // ⚠ AND VANILLA HAS NEITHER TEST AT ALL — see `SU.tooRough` and `SU.tooLow` (D-243).
        if (SU.tooLow(o.name, o.needsLand ? NS.Column.height(mid.x, mid.z) : 1e9, o.landVeto)) return null;
        if (SU.tooRough(o.name, s.spread, o.maxSpread, o.spreadVeto)) return null;
        return o.build(start, r, rot, mid.x, s.y, mid.z, s);
      },
      write: SU.write
    };
  }
  SU.surfaceGrammar = surfaceGrammar;
  // ⚠ MEASURED, NOT ASSUMED — PLAN §9's risk 5 in one pair of counters. *"Terraced terrain
  // rejects too many village sites; W17's suitability score is tunable. **Measure the rejection
  // rate before tuning.**"* These are that measurement, and `structcheck` §6 prints and bounds
  // them. The tolerances below were then set FROM the measured spread distribution (D-188):
  // over 600 sample sites the ground spread across a 22-block window is 3 at the median and 16
  // at the ninth decile, so a tolerance of 4 — which is what the first draft used — rejects the
  // majority of ordinary desert.
  ST.rejected = ST.rejected || Object.create(null);
  ST.surveyed = ST.surveyed || Object.create(null);
  // ⚠ WHAT WOULD HAVE BEEN REJECTED, kept apart from what WAS — see the two helpers below.
  ST.overSpread = ST.overSpread || Object.create(null);
  ST.overWater = ST.overWater || Object.create(null);

  // ── ⚠⚠ THE SITE VETOES ARE NOT VANILLA'S, AND THE REAL GAME IS WHAT SAID SO (D-243) ────────
  //
  // Not one 1.18.2 overworld structure tests its site for flatness or for dry land. Every
  // `checkLocation` in the jar is a probability gate and a biome test and nothing else, and the
  // answer key proves it from the other side: over the 184 starts the real game placed in the
  // two golden worlds, MC-Lite's own placement machinery REFUSED 13 of vanilla's own chunks —
  // 10 on flatness (ruined_portal 5, shipwreck 2, village 2, pillager_outpost 1) and 1 on dry
  // land (a desert_pyramid whose middle column stands at y=62 against a sea level of 63). A
  // veto that throws away sites the real game builds on is not a cheapness deviation; it is a
  // count deviation, and the count is licensed by nothing.
  //
  // ⚠ SO WHY IS THE VETO STILL HERE AT ALL? Because for three families it is load-bearing, and
  // `structcheck` §9 is the evidence rather than an opinion: with every veto removed, §9's
  // "every placed floor is supported" fails on `jungle_pyramid` with 10 floor cells over air.
  // The compiled-Java pieces — `desert_pyramid`, `jungle_pyramid`, `swamp_hut` — are the three
  // structures this build writes without a beard under them, so they are the three that keep
  // the veto, and D-243 names that as the deviation with its measured size. Everything else
  // takes vanilla's answer and lets the beard do the work.
  //
  // The measurement does NOT go away with the veto: both helpers count the site whether or not
  // they reject it, so `structcheck` §9 still prints the spread distribution PLAN §9's risk 5
  // asked for, and can still see a family whose sites are all rough.

  /** Record a site rougher than this family's tolerance; reject it only where `veto` is set. */
  SU.tooRough = function (name, spread, max, veto) {
    if (!(spread > max)) return false;
    ST.overSpread[name] = (ST.overSpread[name] || 0) + 1;
    if (!veto) return false;
    ST.rejected[name] = (ST.rejected[name] || 0) + 1;
    return true;
  };
  /** The same, for a site whose middle column stands below sea level. */
  SU.tooLow = function (name, groundY, veto) {
    if (groundY >= (ST.G.params.seaLevel | 0)) return false;
    ST.overWater[name] = (ST.overWater[name] || 0) + 1;
    if (!veto) return false;
    ST.rejected[name] = (ST.rejected[name] || 0) + 1;
    return true;
  };

  // ── IGLOO ─────────────────────────────────────────────────────────────────────────────────
  //
  // `IglooPieces`: the dome (`igloo/top`, 7x5x8) always; then one time in two a LADDER SHAFT of
  // `igloo/middle` (3x3x3, four to seven of them) down to `igloo/bottom` (7x6x9), the basement
  // with the two villagers in it. The shaft's horizontal offset inside the dome is vanilla's
  // fixed (3, ?, 5) trapdoor position.
  ST.register('igloo', function (cfg) {
    return surfaceGrammar(cfg, {
      name: 'igloo', needsTemplates: true, reach: 2, half: 5, maxSpread: 8, needsLand: true,
      // no veto: the igloo is a template with a beard under it, and D-243's answer key says
      // vanilla tests neither the flatness nor the waterline.
      spreadVeto: false, landVeto: false,
      build: function (start, r, rot, mx, my, mz, s) {
        var T = NS.Templates;
        var top = T.get(T.index('igloo/top'));
        var sz = [0, 0, 0]; JG.rotSize(top, rot, sz);
        var ox = mx - (sz[0] >> 1), oz = mz - (sz[2] >> 1);
        var pieces = [];
        var basement = r.nextInt(2) === 0;
        var depth = basement ? (4 + r.nextInt(4)) : 0;
        var floorY = my + 1;
        var bd = SU.beardPiece(ox, oz, ox + sz[0] - 1, oz + sz[2] - 1, floorY, floorY + top.sy, 3);
        pieces.push(bd, SU.shavePiece(bd));
        pieces.push(SU.templatePiece('igloo/top', rot, ox, floorY - 1, oz, {}));
        if (basement) {
          // the shaft, straight down from the trapdoor, then the basement under it
          var shaftX = ox + (rot & 1 ? 5 : 3), shaftZ = oz + (rot & 1 ? 3 : 5);
          var y = floorY - 4;
          for (var i = 0; i < depth; i++, y -= 3) pieces.push(SU.templatePiece('igloo/middle', rot, shaftX, y, shaftZ, {}));
          var bot = T.get(T.index('igloo/bottom'));
          var bsz = [0, 0, 0]; JG.rotSize(bot, rot, bsz);
          pieces.push(SU.templatePiece('igloo/bottom', rot, shaftX - (bsz[0] >> 1), y - bot.sy + 2, shaftZ - (bsz[2] >> 1), {}));
        }
        return pieces;
      }
    });
  });

  // ── RUINED PORTAL ─────────────────────────────────────────────────────────────────────────
  //
  // `RuinedPortalPiece`. Thirteen templates — ten `portal_N` and three `giant_portal_N` — and
  // the `portal_type` in the config picks which BIOME variant of the structure set placed it,
  // not which template. Vanilla then chooses a vertical placement (on the surface, partly
  // buried, on the ocean floor, in a mountain, underground) and applies a `block_rot` integrity
  // so the frame is broken rather than whole, plus a blob of netherrack under it.
  //
  // ⚠ The lava, the chest and the netherrack blob: the blob is here, the LAVA is here, and the
  // chest is a bare `chest` block with nothing in it — D-141's rule, for D-141's reason.
  ST.register('ruined_portal', function (cfg) {
    var giant = String(cfg.portal_type || 'standard') === 'mountain';
    return surfaceGrammar(cfg, {
      name: 'ruined_portal', needsTemplates: true, reach: 3, half: 8, maxSpread: 14,
      build: function (start, r, rot, mx, my, mz, s) {
        var T = NS.Templates;
        var n = giant ? (1 + r.nextInt(3)) : (1 + r.nextInt(10));
        var id = giant ? ('ruined_portal/giant_portal_' + n) : ('ruined_portal/portal_' + n);
        var e = T.get(T.index(id));
        var sz = [0, 0, 0]; JG.rotSize(e, rot, sz);
        var ox = mx - (sz[0] >> 1), oz = mz - (sz[2] >> 1);
        // vanilla buries a ruined portal by a random amount rather than standing it on the grass
        var bury = r.nextInt(4);
        var floorY = my + 1 - bury;
        var pieces = [];
        var bd2 = SU.beardPiece(ox, oz, ox + sz[0] - 1, oz + sz[2] - 1, floorY, floorY + e.sy, 3);
        pieces.push(bd2, SU.shavePiece(bd2));
        pieces.push(SU.templatePiece(id, rot, ox, floorY, oz, {
          writeAir: false,
          // ⚠ vanilla's own decay, out of the data: `block_rot` with a survival fraction. 0.9
          // for a standard portal, 0.5 for a giant one, which is what makes the giants ruins.
          procs: [{ kind: 'rot', integrity: giant ? 0.5 : 0.9 }]
        }));
        return pieces;
      }
    });
  });

  // ── SWAMP HUT ─────────────────────────────────────────────────────────────────────────────
  //
  // `SwamplandHutPiece`, and it has no NBT: a 7x7 spruce-plank hut on four stilts, with a
  // cauldron, a crafting table and a flower pot inside, and a witch. Seven by five by nine,
  // built here, block for block, because there is nothing to port.
  ST.register('swamp_hut', function (cfg) {
    return surfaceGrammar(cfg, {
      name: 'swamp_hut', reach: 2, half: 5, maxSpread: 8,
      // ⚠ a compiled-Java piece with no beard: D-243's three, and structcheck §9 is why.
      // ⚠ NO `needsLand` — a swamp hut stands ON stilts IN the water, and it never had one.
      spreadVeto: true,
      build: function (start, r, rot, mx, my, mz, s) {
        var PL = A.stateOf('spruce_planks'), LOG = A.stateOf('spruce_log');
        var FE = A.stateOf('spruce_fence'), CAULD = A.stateOf('cauldron'), CT = A.stateOf('crafting_table');
        var ST_ = A.stateOf('spruce_stairs'), POT = A.stateOf('flower_pot');
        var c = new SU.Cells();
        // the platform, one block above the water, on four stilts
        var lift = 3;
        for (var sx2 = 1; sx2 <= 5; sx2 += 4) for (var sz2 = 1; sz2 <= 5; sz2 += 4) {
          for (var k = 0; k < lift; k++) c.set(sx2, k, sz2, LOG);
        }
        c.box(1, lift, 1, 5, lift, 7, PL);                            // the floor
        c.shell(1, lift + 1, 1, 5, lift + 4, 7, PL);                  // the walls and the roof
        c.box(2, lift + 1, 2, 4, lift + 3, 6, -1);                    // hollow it
        c.set(3, lift + 1, 1, -1); c.set(3, lift + 2, 1, -1);         // the door
        c.set(1, lift + 2, 4, -1); c.set(5, lift + 2, 4, -1);         // two windows
        for (var x = 0; x <= 6; x++) { c.set(x, lift + 5, 0, PL); c.set(x, lift + 5, 8, PL); }
        c.set(2, lift + 1, 6, CAULD); c.set(4, lift + 1, 6, CT); c.set(2, lift + 1, 2, POT);
        c.set(1, lift + 1, 3, FE); c.set(5, lift + 1, 3, FE);
        if (ST_) { c.set(3, lift, 0, ST_); }
        var pieces = [];
        var floorY = my + 1;
        var bd3 = SU.beardPiece(mx - 3, mz - 4, mx + 3, mz + 4, floorY, floorY + 9, 2);
        pieces.push(bd3, SU.shavePiece(bd3));
        pieces.push(SU.blocksPiece(mx - 3, floorY - lift, mz - 4, rot, c.a, 7, 10, 9));
        return pieces;
      }
    });
  });

  // ── DESERT PYRAMID ────────────────────────────────────────────────────────────────────────
  //
  // `DesertPyramidPiece`: 21x21 at the base, a stepped sandstone pyramid with two towers, an
  // orange-terracotta cross on each face, and a hidden chamber under the middle.
  // ⚠ WHAT IS SIMPLIFIED, SAID PLAINLY: vanilla's chamber holds four loot chests over a
  // pressure-plate-and-TNT trap. This build has no block entities and no loot tables (PLAN
  // G2/G17), so the chamber, its blue-terracotta floor pattern and the TNT are here and the
  // chests are bare `chest` blocks — D-141's rule again.
  ST.register('desert_pyramid', function (cfg) {
    return surfaceGrammar(cfg, {
      name: 'desert_pyramid', reach: 3, half: 11, maxSpread: 12, needsLand: true,
      spreadVeto: true, landVeto: true,   // D-243's three

      build: function (start, r, rot, mx, my, mz, s) {
        var SS = A.stateOf('sandstone'), CUT = A.stateOf('cut_sandstone'), CH = A.stateOf('chiseled_sandstone');
        var OR = A.stateOf('orange_terracotta'), BL = A.stateOf('blue_terracotta');
        var TNT = A.stateOf('tnt'), CHEST = A.stateOf('chest'), PLATE = A.stateOf('stone_pressure_plate');
        var c = new SU.Cells();
        var N = 21, mid = 10;
        // the stepped body: each layer one ring smaller
        for (var y = 0; y < 10; y++) {
          var lo = y, hi = N - 1 - y;
          if (lo > hi) break;
          c.box(lo, y + 5, lo, hi, y + 5, hi, SS);
        }
        c.box(0, 0, 0, N - 1, 4, N - 1, SS);                    // the plinth, into the dune
        // the two towers
        for (var t = 0; t < 2; t++) {
          var tx = t ? N - 5 : 1;
          c.box(tx, 5, 1, tx + 3, 14, 4, SS);
          c.box(tx + 1, 6, 2, tx + 2, 13, 3, -1);
          c.box(tx, 15, 1, tx + 3, 15, 4, CUT);
        }
        // the orange cross on each of the four faces, which is the pyramid's signature
        for (var i = -1; i <= 1; i++) {
          c.set(mid + i, 8, 0, OR); c.set(mid, 8 + i, 0, OR);
          c.set(mid + i, 8, N - 1, OR); c.set(mid, 8 + i, N - 1, OR);
          c.set(0, 8, mid + i, OR); c.set(0, 8 + i, mid, OR);
          c.set(N - 1, 8, mid + i, OR); c.set(N - 1, 8 + i, mid, OR);
        }
        // the hidden chamber, under the middle
        c.box(mid - 3, -6, mid - 3, mid + 3, -1, mid + 3, SS);
        c.box(mid - 2, -5, mid - 2, mid + 2, -2, mid + 2, -1);
        c.box(mid - 2, -6, mid - 2, mid + 2, -6, mid + 2, CH);
        c.set(mid, -6, mid, BL);
        if (TNT) c.set(mid, -7, mid, TNT);
        if (PLATE) c.set(mid, -5, mid, PLATE);
        if (CHEST) { c.set(mid - 2, -5, mid, CHEST); c.set(mid + 2, -5, mid, CHEST);
                     c.set(mid, -5, mid - 2, CHEST); c.set(mid, -5, mid + 2, CHEST); }
        var pieces = [];
        var floorY = my - 4;
        var bd4 = SU.beardPiece(mx - mid, mz - mid, mx - mid + N - 1, mz - mid + N - 1, floorY + 5, floorY + 20, 4);
        pieces.push(bd4, SU.shavePiece(bd4));
        pieces.push(SU.blocksPiece(mx - mid, floorY, mz - mid, rot, c.a, N, 22, N));
        return pieces;
      }
    });
  });

  // ── JUNGLE TEMPLE ─────────────────────────────────────────────────────────────────────────
  //
  // `JunglePyramidPiece`: 12x15 of mossy and plain cobblestone, three storeys, a staircase down
  // the front and a lower chamber.
  // ⚠ Vanilla's two chests sit behind a redstone puzzle (levers and pistons) and a tripwire
  // corridor. The masonry, the staircase and the chambers are here; the puzzle is not, because a
  // dispenser, a tripwire hook and a piston are block entities and redstone this build does not
  // simulate (PLAN G2/G17). Said rather than implied.
  ST.register('jungle_pyramid', function (cfg) {
    return surfaceGrammar(cfg, {
      name: 'jungle_pyramid', reach: 3, half: 8, maxSpread: 12, needsLand: true,
      spreadVeto: true, landVeto: true,   // D-243's three

      build: function (start, r, rot, mx, my, mz, s) {
        var CB = A.stateOf('cobblestone'), MO = A.stateOf('mossy_cobblestone');
        var CS = A.stateOf('cobblestone_stairs'), VIN = A.stateOf('vine'), CHEST = A.stateOf('chest');
        var W = 12, D = 15;
        var c = new SU.Cells();
        // ⚠ mossy or plain per cell, from a POSITION HASH and not a draw: the piece is written
        // once per target chunk and a sequential rng would moss half a wall (D-185's rule).
        var seed = JG.hash4(0x1E3B, mx, my, mz);
        function stone(x, y, z) { return (JG.hash4(seed, x, y, z) % 3) === 0 ? MO : CB; }
        var x, y, z;
        for (y = 0; y <= 9; y++) for (z = 0; z < D; z++) for (x = 0; x < W; x++) {
          var edge = (x === 0 || x === W - 1 || z === 0 || z === D - 1 || y === 0 || y === 9);
          if (edge) c.set(x, y, z, stone(x, y, z));
        }
        c.box(1, 1, 1, W - 2, 8, D - 2, -1);                         // hollow
        c.box(1, 4, 1, W - 2, 4, D - 2, CB);                         // the middle floor
        c.box(4, 4, 4, 7, 4, 7, -1);                                 // the stairwell
        c.set(5, 0, 0, -1); c.set(6, 0, 0, -1);                      // the doorway
        c.set(5, 1, 0, -1); c.set(6, 1, 0, -1);
        c.set(5, 2, 0, -1); c.set(6, 2, 0, -1);
        for (y = 1; y <= 3; y++) c.set(5, y, 1 + y, CS);              // the stair down
        c.box(3, -4, 3, 8, -1, 10, CB);                              // the lower chamber
        c.box(4, -3, 4, 7, -2, 9, -1);
        if (CHEST) { c.set(4, -3, 4, CHEST); c.set(7, -3, 9, CHEST); }
        if (VIN) for (z = 1; z < D - 1; z += 3) { c.set(0, 6, z, VIN); c.set(W - 1, 6, z, VIN); }
        var pieces = [];
        var floorY = my - 1;
        var bd5 = SU.beardPiece(mx - 6, mz - 7, mx - 6 + W - 1, mz - 7 + D - 1, floorY, floorY + 10, 3);
        pieces.push(bd5, SU.shavePiece(bd5));
        pieces.push(SU.blocksPiece(mx - 6, floorY, mz - 7, rot, c.a, W, 14, D));
        return pieces;
      }
    });
  });
})(MCL);
