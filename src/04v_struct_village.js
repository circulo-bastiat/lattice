// 04v_struct_village.js — S4: villages and the pillager outpost (PLAN W17, D-189).
// Runs on: main thread AND workers. No DOM.
//
// PLAN W17: *"Only now, and Dan was right that they are hard. Needs, in order: a
// flatness/suitability score per candidate centre sampled from the cheap column function across
// a radius, **rejecting terraced and steep ground outright**; jigsaw assembly from W15; paths
// that follow contours — which is `projection: terrain_matching`, data, already fetched;
// per-building beard blended into the landscape. Content is nearly free. The work is the
// negotiation."*
//
// That is the whole of this file, in that order, and every one of the four is somebody else's
// code by now: the suitability score is `StructSurface.survey` (W16), the assembly is
// `Jigsaw.assemble` (W15), `terrain_matching` is a flag the template writer already honours
// (W15), and the beard is `StructSurface.beardPiece` (W16). W17 is the stage where they meet.
//
// ── ⚠ THE ORDER OF THE PIECE LIST IS THE BEARD'S WHOLE CORRECTNESS ─────────────────────────
//
// Every rigid piece gets a plinth under it, and a plinth is written by filling terrain UP to the
// piece's floor. Written after the piece, it would fill the piece's own ground floor with dirt.
// So the list is [every beard, then every piece], and `Structures.writeUpTo` walks it in order —
// which also means a house's plinth may be overwritten by the NEXT house's plinth and then by
// both houses, which is what makes two buildings on a slope share one terrace instead of each
// standing on its own pillar.
//
// ── ⚠ WHAT A STREET DOES NOT GET, AND WHY ──────────────────────────────────────────────────
//
// The streets are `projection: terrain_matching` — vanilla's own answer to "paths that follow
// contours" and, per PLAN, data rather than code. A terrain-matching piece is written at
// `Column.height(x, z)` per COLUMN, so it drapes over the ground by construction and a beard
// under it would be a road on an embankment. Only rigid pieces are bearded.
//
// ⚠ THAT PARAGRAPH WAS FALSE FOR ONE SESSION AND IS TRUE AGAIN (D-216). Session 5 replaced the
// per-column drape with a rigid write at one Y, on the evidence that draping had dug holes under
// house floors; the holes were the STREET'S OWN AIR, written because `legacy_single_pool_element`
// was inverted in `04t_jigsaw.js`. With the air rule fixed the drape — which is what vanilla's
// `GravityProcessor` does and is a pure function of (x, z) — came back, and the sentence above
// describes the code again. What is still owed is the seam it leaves: a road draped onto
// `Column.height` crosses a terrace a neighbouring house's beard shaves AFTERWARDS, which
// `structaudit`'s `wrote-air-then-stood-on-it` register entry counts.

(function (NS) {
  'use strict';

  var ST = NS.Structures, JG = NS.Jigsaw, SU = NS.StructSurface;
  var CFG = NS.CFG, MINY = CFG.WORLD_MIN_Y, H = CFG.CHUNK_H;

  /**
   * The shared driver for every jigsaw structure that stands on the surface.
   * `village_*` and `pillager_outpost` differ in three numbers and one pool name.
   */
  function jigsawSurface(cfg, o) {
    if (!(JG && JG.ready)) return null;               // no template blob, no pieces (D-188)
    var startPool = String(cfg.start_pool || '').replace('minecraft:', '');
    var size = cfg.size === undefined ? 6 : (cfg.size | 0);
    if (!startPool) throw new Error(o.name + ': no start_pool in the configured structure');
    return {
      reach: o.reach,
      name: o.name,
      // ⚠ NO `preProbeY` (D-257). D-192 put one here so an ocean candidate never assembled a
      // village it was about to throw away — but it asks at the CHUNK MIDDLE, and vanilla's
      // `JigsawPlacement` asks at the START PIECE's own box centre, which is a different quart
      // cell at a biome border and is the whole of D-244's refused outpost. The early-out is
      // gone rather than kept-and-wrong: a jigsaw candidate is one chunk in every 32x32, so the
      // assembly it now pays for costs about 0.006 ms a chunk averaged over the world, and
      // `gencheck` is the check that would see it if that estimate is wrong.
      sampleY: function (start) { return start.__surfaceY === undefined ? start.y0 : start.__surfaceY; },
      expand: function (start, r) {
        var mx = (start.cx << 4) + 8, mz = (start.cz << 4) + 8;
        // 1. THE SUITABILITY SCORE, over the radius the structure actually covers
        var s = SU.survey(mx - o.radius, mz - o.radius, mx + o.radius, mz + o.radius, 4);
        ST.surveyed[o.name] = (ST.surveyed[o.name] || 0) + 1;
        start.__surfaceY = s.y;
        // ⚠⚠ THESE TWO VETOES ARE A NAMED DEVIATION, NOT A PORT (D-243), AND THEY ARE THE
        // LARGEST SINGLE CAUSE OF THE STRUCTURE-COUNT SHORTFALL LEFT. No 1.18.2 `checkLocation`
        // tests a site for flatness or for dry land — `VillageFeature`'s is `checkForBiomeOnTop`
        // and nothing else — and against the real game these two refused 2 of vanilla's own 4
        // villages and 1 of its 2 pillager outposts in the two golden worlds. Globally they cost
        // 54% and 65% of the villages and 50% and 53% of the outposts MC-Lite would otherwise
        // place, at seeds 1337 and 4242 over 6,400 regions each.
        // ⚠ WHAT BLOCKS THEIR REMOVAL IS NOT THE COUNT, IT IS `structcheck` §9's HARD ZERO
        // (D-216), and the veto had been hiding the reason by CHOOSING THE SAMPLE — §9 examines
        // the first village the region scan finds, and removing the veto moves that village.
        // The one it moves to is a desert village whose site spread is SEVEN, so not a rough
        // site at all, and it leaves three floor cells over air: two under `desert_library_1`
        // where another house's SHAVE ran over the plinth this house was standing on (every
        // fill runs, then every shave, so a neighbour can eat a plinth), and one under
        // `desert_small_house_4` whose floor in that column is a block above the piece's box
        // underside, which is the only level the beard knows. `docs/archive/STRUCTURES.md` carries the
        // coordinates. Fix the beard, then delete these two lines and take vanilla's answer.
        if (SU.tooLow(o.name, NS.Column.height(mx, mz), true)) return null;
        if (SU.tooRough(o.name, s.spread, o.maxSpread, true)) return null;

        // 2. THE ASSEMBLY, from W15
        var pieces = JG.assemble({ pool: startPool, x: mx, y: s.y + 1, z: mz, depth: size, rng: r });
        if (!pieces || !pieces.length) return null;

        // 3. THE BEARD, one per rigid piece, all of them first in the list
        var out = [], shaves = [];
        var i, p;
        for (i = 0; i < pieces.length; i++) {
          p = pieces[i];
          if (p.proj === JG.PROJ_TERRAIN) continue;        // a street drapes; it needs no plinth
          var b = JG.pieceBox(p);
          // ⚠ ONLY THE PIECES THAT TOUCH THE GROUND GET ONE. A jigsaw structure stacks: a
          // pillager outpost's watchtower sits on its base plate twenty blocks up, and a beard
          // under THAT fills a twenty-block dirt pillar from the ground to a floor that already
          // has a floor under it. Measured before this rule: **27% of the outpost's floor
          // columns had solid ground under them** and the rest were standing on their own
          // plinth's air. A piece whose floor is more than three blocks above the natural ground
          // at its centre is standing on another piece, and the piece under it is what gets the
          // plinth.
          // ⚠ THE TEST IS "IS ANOTHER PIECE UNDER IT", NOT "IS IT HIGH UP". A height threshold
          // was the first attempt and it threw away the plinth of every desert house whose
          // centre column happened to sit in a dune hollow — 81% of that village's floors were
          // over air. What decides is whether the block under this piece's floor is inside
          // another piece of the same structure; if it is, that piece is the support.
          var mxp = (b.x0 + b.x1) >> 1, mzp = (b.z0 + b.z1) >> 1, uy = b.y0 - 1;
          var stacked = false;
          for (var k = 0; k < pieces.length && !stacked; k++) {
            if (k === i) continue;
            // ⚠ ONLY A RIGID PIECE IS SUPPORT. A street tile is `terrain_matching` — it drapes
            // over the ground and its rigid box is a fiction — and a house may legitimately sit
            // inside that box (that is the whole `insideCurrentPiece` rule W15 needed, D-189).
            // Counting a street as the thing holding a house up took plains villages from 463
            // supported floor columns out of 463 to 429.
            if (pieces[k].proj === JG.PROJ_TERRAIN) continue;
            var ob = JG.pieceBox(pieces[k]);
            if (mxp >= ob.x0 && mxp <= ob.x1 && uy >= ob.y0 && uy <= ob.y1 && mzp >= ob.z0 && mzp <= ob.z1) stacked = true;
          }
          // ⚠ the plinth reaches to the piece's FLOOR, and a piece's floor is the bottom of its
          // own box — not the surveyed ground, which is where the START stands and not where
          // this house ended up after six levels of jigsaw. A stacked piece is SHAVED and not
          // FILLED: it needs the hillside cleared out of it and it does not need a pillar.
          // ⚠ THE PLINTH REACHES THE PIECE'S UNDERSIDE, NOT ITS BOX FLOOR (D-216). A template
          // whose bottom layer is `structure_void` — `desert_farm_2` is 67 void cells and three
          // sandstone in layer 0 — stands one block above `b.y0`, and a plinth built to
          // `b.y0 - 1` left it over air in 100 of one desert village's 1,009 floor cells.
          // `JG.groundLy` is where the piece's underside actually is.
          var gly = JG.groundLy(p.tpl);
          var bd = SU.beardPiece(b.x0, b.z0, b.x1, b.z1, b.y0 + gly, b.y1, o.beardMargin, !stacked);
          out.push(bd);
          shaves.push(SU.shavePiece(bd));
        }
        // ⚠ every fill, then every shave, then the buildings — see the note on `shavePiece`
        for (i = 0; i < shaves.length; i++) out.push(shaves[i]);
        for (i = 0; i < pieces.length; i++) {
          p = pieces[i];
          var bb = JG.pieceBox(p);
          p.x0 = bb.x0; p.y0 = bb.y0; p.z0 = bb.z0;
          p.x1 = bb.x1; p.y1 = bb.y1; p.z1 = bb.z1;
          p.kind = 'template';
          out.push(p);
        }
        return out;
      },
      write: SU.write
    };
  }
  NS.StructVillage = { jigsawSurface: jigsawSurface };

  // ── THE FIVE VILLAGES ─────────────────────────────────────────────────────────────────────
  //
  // One `minecraft:village` type, five configured structures, and the only thing that differs
  // between them is `start_pool`: `village/plains/town_centers`, `village/desert/town_centers`
  // and so on. 482 of the 866 templates in the jar are village pieces, which is what PLAN means
  // by *"content is nearly free"*.
  ST.register('village', function (cfg) {
    return jigsawSurface(cfg, {
      name: 'village',
      // ⚠ eight chunks, derived: `Jigsaw.MAX_DIST` bounds a piece's ORIGIN to 80 blocks from the
      // start and the largest village piece is 24 across, so nothing reaches past 104 blocks —
      // seven chunks — and eight is the margin. `structcheck` asserts no piece needs more.
      reach: 8, radius: 24, maxSpread: 20, beardMargin: 3
    });
  });

  // ── THE PILLAGER OUTPOST ──────────────────────────────────────────────────────────────────
  //
  // PLAN puts outposts in W18, and they are here because they are the same code: a jigsaw
  // structure with a start pool (`pillager_outpost/base_plates`) and a depth budget of 7. The
  // watchtower is 15x21x15 and the base plate is 16x30x16, so the tolerance is tighter than a
  // village's — an outpost is one tall building and cannot spread its weight over a slope.
  ST.register('pillager_outpost', function (cfg) {
    return jigsawSurface(cfg, {
      name: 'pillager_outpost', reach: 6, radius: 12, maxSpread: 12, beardMargin: 4
    });
  });
})(MCL);
