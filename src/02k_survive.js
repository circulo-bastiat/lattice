// 02k_survive.js — vanilla's `canSurvive` rules, written ONCE against a LEVEL INTERFACE (#19, KW-25).
// Runs on: main thread AND workers. No DOM.
//
// ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────────────────
// There were two doors onto "may this block stand here": the live world (`World.canSurvive`, which
// asks the jar's 40 rules) and worldgen (`Features.supported`, which asked only the three
// material-derived support classes). D-418 measured the gap: 13,799 feature-placed blocks carry a
// jar rule and 12 stood where the live rule would break them on the first edit nearby.
//
// The rules are 440 lines of switch, so the fix is not to copy them into worldgen but to write them
// against a LEVEL and give each door its own. A level supplies:
//
//   L.getBlock(x,y,z)      real state; 0 where the cell is out of range (never -1)
//   L.loadedAt(x,z)        false = "no opinion about that column", and every rule then answers
//                          SUPPORTED — the one convention both doors already shared
//   L.tag(name, state)     1 / 0, or -1 when this level cannot answer a block-tag question
//   L.light(x,y,z)         raw brightness 0..15, or -1 when this level has no light
//   L.sky(x,y,z)           1 / 0, or -1 likewise
//   L.miss                 written by this module: set when a rule asked something that came back -1
//
// ⚠ AN UNANSWERABLE QUESTION MAKES THE WHOLE RULE "-1 = NO OPINION" (D-351), never "no". Worldgen
// runs in a worker with no tag registry and no light, so its level answers the pure questions
// (27 of the 40 rules need only getBlock/loadedAt) and returns -1 for tags and light; the caller
// then falls through to the support class it always had. That keeps the argument in build.mjs
// (no worker asks a tag question) true: this module asks, the level declines.
//
// Everything below the header moved here verbatim from 07_world.js; only `W.` became `L.`/`SV.`.

(function (NS) {
  'use strict';

  var SV = NS.Survive = {};
  /** Called after every id resolution, so a level can mirror `BID` and the legacy `B_*` names. */
  SV.onResolve = null;

  /** Ask a tag question, recording on the level that it could not be answered. */
  function tagQ(L, tag, state) {
    var r = L.tag(tag, state);
    if (r < 0) { L.miss = true; return 0; }
    return r;
  }
  function lightQ(L, x, y, z) {
    var r = L.light(x, y, z);
    if (r < 0) { L.miss = true; return 0; }
    return r;
  }
  function skyQ(L, x, y, z) {
    var r = L.sky(x, y, z);
    if (r < 0) { L.miss = true; return 0; }
    return r;
  }

  /**
   * One rule, one level: 1 survives, 0 does not, -1 "not mine" — a block with no rule, an id table
   * not yet resolved, or a question this level cannot answer.
   * ⚠ ONE DOOR, ONE GUARD (D-351): every tag/light question goes through the helpers above, so
   * asking whether any went unanswered needs no list of "the rules that use tags".
   */
  SV.eval = function (L, x, y, z, st, rule) {
    L.miss = false;
    var r = inner(L, x, y, z, st, rule);
    return L.miss ? -1 : r;
  };
  SV.groundOk = function (L, g, x, y, z, below) { return groundOk(L, g, x, y, z, below); };

  function inner(L, x, y, z, st, rule) {
    var SR = NS.States, R = NS.Reg;
    if (!idsReady && !SV.resolveIds()) return -1;
    var FULL = SR.SUPPORT_FULL, CENTER = SR.SUPPORT_CENTER, RIGID = SR.SUPPORT_RIGID;
    var UP = 2, DOWN = 3;
    if (!L.loadedAt(x, z)) return 1;
    var below = L.getBlock(x, y - 1, z);

    switch (rule) {
      // ── 1 RAIL: canSupportRigidBlock(level, pos.below()) ─────────────────────────────────
      // ⚠ RIGID, not FULL: the rim of the face, so a HOPPER takes a rail (its top is a rim with
      // a hole in it) and a FENCE does not (it is a post in the middle). Neither is a special
      // case here — the geometry gives both answers.
      case 1:
        return SR.faceSturdy(below, UP, RIGID) ? 1 : 0;

      // ── 2 PRESSURE PLATE: rigid below, OR a supported centre ──────────────────────────────
      case 2:
        return (SR.faceSturdy(below, UP, RIGID) || SR.faceSturdy(below, UP, CENTER)) ? 1 : 0;

      // ── 3 SNOW LAYER ─────────────────────────────────────────────────────────────────────
      // ice, packed_ice and barrier never; honey_block and soul_sand always; otherwise a FULL
      // face below, or eight layers of snow under it.
      case 3: {
        var bb = SR.block[below];
        if (bb === SV.B_ICE || bb === SV.B_PACKED_ICE || bb === SV.B_BARRIER) return 0;
        if (bb === SV.B_HONEY || bb === SV.B_SOUL_SAND) return 1;
        if (SR.faceSturdy(below, UP, FULL)) return 1;
        if (bb === SR.block[st] && SR.propValue(below, R.PROP.layers) === SV.V_LAYERS_8) return 1;
        return 0;
      }

      // ── 4 CACTUS ─────────────────────────────────────────────────────────────────────────
      // no SOLID horizontal neighbour, no lava beside it, cactus or sand below, no liquid above.
      case 4: {
        for (var d = 0; d < 4; d++) {
          var hx = x + HORIZ_DX[d], hz = z + HORIZ_DZ[d];
          if (!L.loadedAt(hx, hz)) continue;
          var nb = L.getBlock(hx, y, hz);
          // ⚠⚠ **`solidMat`, INDEXED BY BLOCK — NOT `solid`, INDEXED BY STATE** (D-349). This line
          // read `SR.solid[SR.block[nb]]`: `SR.solid` is per REAL STATE and `SR.block[nb]` is a
          // BLOCK index, so for three sessions the cactus rule asked whether *state* number 372
          // has a collision box in order to decide something about *block* number 372. Vanilla
          // asks `getMaterial().isSolid()`, which is this table, and the two are not the same
          // question even when the index is right: a COBWEB is a solid material with no collider.
          if (nb !== 0 && SR.solidMat[SR.block[nb]] === 1) return 0;
          if (SR.block[nb] === SV.B_LAVA) return 0;
        }
        var cb = SR.block[below];
        if (cb !== SR.block[st] && cb !== SV.B_SAND && cb !== SV.B_RED_SAND) return 0;
        var above = L.getBlock(x, y + 1, z);
        return SR.waterIn[above] || SR.block[above] === SV.B_WATER || SR.block[above] === SV.B_LAVA ? 0 : 1;
      }

      // ── 5 BUTTON AND LEVER: canAttach, which asks for a FULL face ─────────────────────────
      // ⚠ FULL, not CENTER — this is why a button will not go on a fence although a torch will.
      // The direction is the OPPOSITE of the one the widget connects along: floor -> the block
      // below, ceiling -> the block above, wall -> the block behind its facing.
      case 5: {
        var face = SR.propValue(st, R.PROP.face);
        var dx = 0, dy = 0, dz = 0, need = 0;
        if (face === R.PVAL.floor) { dy = -1; need = UP; }
        else if (face === R.PVAL.ceiling) { dy = 1; need = DOWN; }
        else {
          var f = SR.propValue(st, R.PROP.facing);
          var d4 = FACING_TO_FACE[f];
          if (d4 === undefined) return 1;
          dx = -SUP_DX[d4]; dy = -SUP_DY[d4]; dz = -SUP_DZ[d4];
          need = FACE_OF_SUP[d4];
        }
        if (!L.loadedAt(x + dx, z + dz)) return 1;
        return SR.faceSturdy(L.getBlock(x + dx, y + dy, z + dz), need, FULL) ? 1 : 0;
      }

      // ── 6 DOOR: the lower half needs a FULL face; the upper half needs its own lower half ──
      case 6: {
        if (SR.propValue(st, R.PROP.half) === R.PVAL.upper) {
          return SR.block[below] === SR.block[st] ? 1 : 0;
        }
        return SR.faceSturdy(below, UP, FULL) ? 1 : 0;
      }

      // ── 7 CARPET: anything that is not air ───────────────────────────────────────────────
      case 7:
        return SR.isAir[below] === 0 ? 1 : 0;

      // ── 8 CANDLE: a supported CENTRE below ───────────────────────────────────────────────
      // the same question a torch asks, so a candle stands on a fence post and not on a slab.
      case 8:
        return SR.faceSturdy(below, UP, CENTER) ? 1 : 0;

      // ── 9 CORAL: a FULL face below ───────────────────────────────────────────────────────
      case 9:
        return SR.faceSturdy(below, UP, FULL) ? 1 : 0;

      // ── 10 CORAL WALL FAN: a FULL face on the block BEHIND it ────────────────────────────
      case 10: {
        var cf = SR.propValue(st, R.PROP.facing);
        var cd = FACING_TO_FACE[cf];
        if (cd === undefined) return 1;
        var wx = x - SUP_DX[cd], wy = y - SUP_DY[cd], wz = z - SUP_DZ[cd];
        if (!L.loadedAt(wx, wz)) return 1;
        return SR.faceSturdy(L.getBlock(wx, wy, wz), FACE_OF_SUP[cd], FULL) ? 1 : 0;
      }

      // ── 11 STANDING BANNER / SIGN / CANDLE CAKE: a SOLID MATERIAL below ──────────────────
      // ⚠ THE MATERIAL, NOT THE SHAPE. Vanilla reads `Material.isSolid()` here, which is not
      // "has a collision box": a COBWEB is solid and has no collider, a LADDER has one and is
      // not solid. Substituting a shape test gets both of those backwards.
      case 11:
        return below !== 0 && SR.solidMat[SR.block[below]] === 1 ? 1 : 0;

      // ── 13 BUSH: the block's own GROUND rule, asked of the cell below (D-348) ────────────
      // ⚠⚠ **THIS RULE DECIDES NOTHING BY ITSELF, AND THAT IS THE POINT.** Vanilla's biggest
      // `canSurvive` owner is exactly this: fetch the state below, hand it to `mayPlaceOn`. The
      // seventeen answers live in `W.groundOk`, chosen per block by `SR.ground`. Flattening them
      // into one rule would plant NETHER WART ON GRASS and float a LILY PAD ON STONE.
      case 13:
        // ⚠ THE SMALL DRIPLEAF IS A TWO-HIGH PLANT WITH THIS RULE, AND ITS UPPER HALF ASKS SOMETHING
        // ELSE (#19). `SmallDripleafBlock.canSurvive` sends the upper half to `DoublePlantBlock`'s
        // question — the same block below, in its lower half — and only the lower half asks the
        // ground. Asking the ground of the upper half read the LOWER HALF as "the floor" and
        // refused it, so no dripleaf could be placed with its head (3 headless in 100 chunks).
        if (SR.propValue(st, R.PROP.half) === R.PVAL.upper) {
          return (SR.block[below] === SR.block[st] &&
                  SR.propValue(below, R.PROP.half) === R.PVAL.lower) ? 1 : 0;
        }
        return groundOk(L, SR.ground[SR.block[st]], x, y, z, below);

      // ── 14 MUSHROOM: a grow block below, or DARKNESS and a floor that renders solid ──────
      // ⚠ TWO INDEPENDENT ROUTES, and the second is why mushrooms vanish when you light a cave.
      // ⚠ `isSolidRender`, NOT a sturdy face: it is `canOcclude && the OUTLINE is a full cube`,
      // which is a different question from every other rule in this file (D-350).
      case 14: {
        if (tagQ(L, 'mushroom_grow_block', below)) return 1;
        if (lightQ(L, x, y, z) >= 13) return 0;
        return groundOk(L, SR.ground[SR.block[st]], x, y, z, below);
      }

      // ── 15 CROP: light enough OR open sky, AND the ground rule ───────────────────────────
      // ⚠ THE LIGHT IS READ ON THE CROP'S OWN CELL, not on the farmland under it, and `canSeeSky`
      // is an OR, not an AND: a crop planted at dusk under open sky survives the night.
      case 15: {
        if (lightQ(L, x, y, z) < 8 && !skyQ(L, x, y, z)) return 0;
        return groundOk(L, SR.ground[SR.block[st]], x, y, z, below);
      }

      // ── 16 DOUBLE PLANT: the upper half needs its own lower half ─────────────────────────
      // ⚠ NOT "the same block below": the same block below IN ITS LOWER HALF. Two stacked lower
      // halves is a build vanilla refuses, and the half property is what says so.
      case 16: {
        if (SR.propValue(st, R.PROP.half) === R.PVAL.upper) {
          return (SR.block[below] === SR.block[st] &&
                  SR.propValue(below, R.PROP.half) === R.PVAL.lower) ? 1 : 0;
        }
        return groundOk(L, SR.ground[SR.block[st]], x, y, z, below);
      }

      // ── 17 GRINDSTONE: always ────────────────────────────────────────────────────────────
      // ⚠ A RULE, NOT AN ABSENCE. The grindstone is a wall-mounted block that OVERRIDES the
      // button-and-lever rule with an unconditional `return true`, so a grindstone never pops
      // off the wall it was on. Leaving it at rule 0 would give the same answer today and would
      // be a silence: `supportOwed` would count it, and the day rule 0 changes it would move.
      case 17:
        return 1;

      // ── 18 SOUL FIRE: a tagged block below, and nothing else ─────────────────────────────
      case 18:
        return tagQ(L, 'soul_fire_base_blocks', below);

      // ── 19 REDSTONE WIRE: a FULL face below, or a hopper ─────────────────────────────────
      // ⚠ THE HOPPER IS NAMED, not derived. Its top is a rim with a hole in it, so it fails FULL
      // and passes RIGID; vanilla exempts it here by identity rather than by geometry, and a
      // geometric "close enough" would also admit every other rim-shaped block.
      case 19:
        return (SR.faceSturdy(below, UP, FULL) || SR.block[below] === SV.BID.hopper) ? 1 : 0;

      // ── 20 FARMLAND: it is the cell ABOVE that kills it ──────────────────────────────────
      // ⚠⚠ **THIS RULE LOOKS UP, NOT DOWN**, which is why farmland turns back into dirt when you
      // put a block on it. A fence gate and a moving piston are exempt.
      case 20: {
        var fa = L.getBlock(x, y + 1, z);
        if (fa === 0 || SR.solidMat[SR.block[fa]] !== 1) return 1;
        if (L.tag('fence_gates', fa) === 1) return 1;
        return SR.block[fa] === SV.BID.moving_piston ? 1 : 0;
      }

      // ── 21 DIRT PATH: the same rule without the moving piston ────────────────────────────
      case 21: {
        var pa = L.getBlock(x, y + 1, z);
        if (pa === 0 || SR.solidMat[SR.block[pa]] !== 1) return 1;
        return L.tag('fence_gates', pa) === 1 ? 1 : 0;
      }

      // ── 22 SUGAR CANE: itself below, or sand or dirt WITH WATER BESIDE THE CELL BELOW ────
      // ⚠⚠ **THE WATER IS BESIDE THE GROUND, NOT BESIDE THE CANE.** Vanilla walks the four
      // horizontals of `pos.below()`, so a cane on a one-block sand pillar in the middle of a
      // lake survives and a cane standing in the water beside dry sand does not. Checking the
      // cane's own neighbours gets the common case right and the interesting case wrong.
      case 22: {
        if (SR.block[below] === SR.block[st]) return 1;
        if (!(tagQ(L, 'dirt', below) || SR.block[below] === SV.BID.sand ||
              SR.block[below] === SV.BID.red_sand)) return 0;
        for (var sc = 0; sc < 4; sc++) {
          var sx = x + HORIZ_DX[sc], sz = z + HORIZ_DZ[sc];
          if (!L.loadedAt(sx, sz)) continue;
          var sb = L.getBlock(sx, y - 1, sz);
          if (SR.waterIn[sb] || SR.block[sb] === SV.BID.water ||
              SR.block[sb] === SV.BID.frosted_ice) return 1;
        }
        return 0;
      }

      // ── 23 COCOA: the block it FACES is a jungle log ─────────────────────────────────────
      // ⚠ THE FACING IS NOT NEGATED HERE. Every other wall-mounted rule looks at
      // `relative(facing.opposite())`; cocoa looks along its facing, and the referee says so.
      case 23: {
        var co = FACING_TO_FACE[SR.propValue(st, R.PROP.facing)];
        if (co === undefined) return 1;
        var cx = x + SUP_DX[co], cy2 = y + SUP_DY[co], cz2 = z + SUP_DZ[co];
        if (!L.loadedAt(cx, cz2)) return 1;
        return tagQ(L, 'jungle_logs', L.getBlock(cx, cy2, cz2));
      }

      // ── 24 BAMBOO: a tagged block below ──────────────────────────────────────────────────
      case 24:
        return tagQ(L, 'bamboo_plantable_on', below);

      // ── 25 BUBBLE COLUMN: itself, magma or soul sand below ───────────────────────────────
      case 25: {
        var bcb = SR.block[below];
        return (bcb === SV.BID.bubble_column || bcb === SV.BID.magma_block ||
                bcb === SV.BID.soul_sand) ? 1 : 0;
      }

      // ── 26 HANGING ROOTS: a FULL face on the UNDERSIDE of the block above ────────────────
      case 26: {
        var hr = L.getBlock(x, y + 1, z);
        return SR.faceSturdy(hr, DOWN, FULL) ? 1 : 0;
      }

      // ── 27 SPORE BLOSSOM: a supported CENTRE above, and its own cell is not water ────────
      case 27: {
        var sp = L.getBlock(x, y + 1, z);
        if (!SR.faceSturdy(sp, DOWN, CENTER)) return 0;
        // `WorldView.isWater(pos)` reads the WORLD cell, not the candidate state (#348).
        var sh = L.getBlock(x, y, z);
        return (SR.waterIn[sh] || SR.block[sh] === SV.BID.water) ? 0 : 1;
      }

      // ── 28 BIG DRIPLEAF: itself, its own stem, or a tagged block below ───────────────────
      case 28: {
        var dl = SR.block[below];
        if (dl === SR.block[st] || dl === SV.BID.big_dripleaf_stem) return 1;
        return tagQ(L, 'big_dripleaf_placeable', below);
      }

      // ── 29 BIG DRIPLEAF STEM: a stem or tagged block below AND a stem or head above ──────
      // ⚠ TWO CELLS, BOTH REQUIRED. A stem with nothing on top is not a build vanilla keeps.
      case 29: {
        var stb = SR.block[below];
        if (!(stb === SR.block[st] || tagQ(L, 'big_dripleaf_placeable', below))) return 0;
        var sta = L.getBlock(x, y + 1, z);
        var stt = SR.block[sta];
        return (stt === SR.block[st] || stt === SV.BID.big_dripleaf) ? 1 : 0;
      }

      // ── 30 POINTED DRIPSTONE: the cell it grows FROM, or another segment pointing the same
      //      way ─────────────────────────────────────────────────────────────────────────────
      case 30: {
        var vd = SR.propValue(st, R.PROP.vertical_direction);
        var vs = (vd === R.PVAL.up) ? 1 : (vd === R.PVAL.down ? 0 : -1);
        if (vs < 0) return 1;
        var ax = x - SUP_DX[vs], ay = y - SUP_DY[vs], az = z - SUP_DZ[vs];
        if (!L.loadedAt(ax, az)) return 1;
        var an = L.getBlock(ax, ay, az);
        if (SR.faceSturdy(an, FACE_OF_SUP[vs], FULL)) return 1;
        return (SR.block[an] === SR.block[st] &&
                SR.propValue(an, R.PROP.vertical_direction) === vd) ? 1 : 0;
      }

      // ── 31 BELL: the cell its ATTACHMENT names ───────────────────────────────────────────
      // ⚠ A CEILING BELL ASKS FOR A SUPPORTED CENTRE ABOVE; a floor bell asks the same of the
      // cell below; a wall bell asks the block it FACES for a full face back. Three cells, one
      // property, and the referee is what says which is which.
      case 31: {
        var at = SR.propValue(st, R.PROP.attachment);
        if (at === R.PVAL.ceiling) return SR.faceSturdy(L.getBlock(x, y + 1, z), DOWN, CENTER) ? 1 : 0;
        if (at === R.PVAL.floor) return SR.faceSturdy(below, UP, FULL) ? 1 : 0;
        var bf = FACING_TO_FACE[SR.propValue(st, R.PROP.facing)];
        if (bf === undefined) return 1;
        var bx2 = x + SUP_DX[bf], by2 = y + SUP_DY[bf], bz2 = z + SUP_DZ[bf];
        if (!L.loadedAt(bx2, bz2)) return 1;
        return SR.faceSturdy(L.getBlock(bx2, by2, bz2), FACE_OF_SUP[bf ^ 1], FULL) ? 1 : 0;
      }

      // ── 32 PISTON HEAD: its own piston base, extended, facing the same way ───────────────
      case 32: {
        var pf = FACING_TO_FACE[SR.propValue(st, R.PROP.facing)];
        if (pf === undefined) return 1;
        var px = x - SUP_DX[pf], py2 = y - SUP_DY[pf], pz2 = z - SUP_DZ[pf];
        if (!L.loadedAt(px, pz2)) return 1;
        var pn = L.getBlock(px, py2, pz2), pb = SR.block[pn];
        if (SR.propValue(pn, R.PROP.facing) !== SR.propValue(st, R.PROP.facing)) return 0;
        if (pb === SV.BID.moving_piston) return 1;
        var want = (SR.propValue(st, R.PROP.type) === R.PVAL.sticky) ? SV.BID.sticky_piston : SV.BID.piston;
        return (pb === want && SR.propValue(pn, R.PROP.extended) === R.PVAL.true) ? 1 : 0;
      }

      // ── 33 LANTERN: a supported CENTRE, above it or below it ────────────────────────────
      // ⚠ THE SAME QUESTION A TORCH ASKS, POINTED THE OTHER WAY when it hangs — which is why a
      // lantern hangs from a fence and a chain but a button will not go on either.
      case 33: {
        if (SR.propValue(st, R.PROP.hanging) === R.PVAL.true) {
          return SR.faceSturdy(L.getBlock(x, y + 1, z), DOWN, CENTER) ? 1 : 0;
        }
        return SR.faceSturdy(below, UP, CENTER) ? 1 : 0;
      }

      // ── 40 FIRE: a FULL face below, OR anything beside it that catches ──────────────────
      // ⚠⚠ **"FLAMMABLE" IS NOT A MATERIAL, A TAG OR A SHAPE — IT IS AN INTEGER** (D-352), set by
      // 140 `setFlammable(block, igniteOdds, burnOdds)` calls in the fire block's own bootstrap.
      // Fire beside a wool wall stays lit with nothing under it at all; fire on a stone floor
      // with nothing beside it needs that floor.
      // ⚠ ALL SIX NEIGHBOURS, including the one below and the one above — vanilla walks
      // `Direction.values()`, not the four horizontals.
      // ⚠ AND A WATERLOGGED STATE NEVER CATCHES, whatever its block's odds say.
      case 40: {
        if (SR.faceSturdy(below, UP, FULL)) return 1;
        for (var fd = 0; fd < 6; fd++) {
          var nx2 = x + SUP_DX[fd], ny2 = y + SUP_DY[fd], nz2 = z + SUP_DZ[fd];
          if (!L.loadedAt(nx2, nz2)) continue;
          var fn = L.getBlock(nx2, ny2, nz2);
          if (fn === 0) continue;
          if (SR.waterIn[fn]) continue;
          if (SR.ignite[SR.block[fn]] > 0) return 1;
        }
        return 0;
      }

      // ── 34 GROWING PLANT: kelp, cave vines, twisting and weeping vines ───────────────────
      // ⚠⚠ **ONE RULE WITH A DIRECTION, NOT FOUR RULES.** Vanilla's base class carries a growth
      // direction and a head/body pair; the plant looks at the single cell BEHIND it — above for
      // a down-grower, below for an up-grower — and accepts its own head, its own body, or a
      // sturdy face. Kelp alone adds a filter: not on magma.
      case 34: {
        var gb = SR.block[st];
        var gd = SV.growUp(gb);                       // 1 grows up, 0 grows down
        var gx = x - SUP_DX[gd], gy = y - SUP_DY[gd], gz = z - SUP_DZ[gd];
        if (!L.loadedAt(gx, gz)) return 1;
        var gn = L.getBlock(gx, gy, gz), gnb = SR.block[gn];
        if (SV.growMagmaShy(gb) && gnb === SV.BID.magma_block) return 0;
        if (gnb === SV.growHead(gb) || gnb === SV.growBody(gb)) return 1;
        return SR.faceSturdy(gn, FACE_OF_SUP[gd], FULL) ? 1 : 0;
      }

      // ── 35 VINE and 36 GLOW LICHEN: a lichen needs EVERY attached face to still be there, a vine
      //      needs ANY one (below); both need at least one ────────────────────────────────────
      // ⚠ `isFaceFull` OF THE NEIGHBOUR'S SHAPE, NOT `isFaceSturdy`. The two differ on exactly
      // the blocks that override the support shape — soul sand supports a rail on a face its
      // collision box does not fill, and a vine does NOT hang on that.
      case 35:
      case 36: {
        var any = 0;
        for (var vf = 0; vf < 6; vf++) {
          var prop = SUP_TO_PROP[vf];
          if (prop === undefined) continue;
          var pi = R.PROP[prop];
          if (pi === undefined) continue;
          if (SR.propValue(st, pi) !== R.PVAL.true) continue;
          var vx = x + SUP_DX[vf], vy = y + SUP_DY[vf], vz = z + SUP_DZ[vf];
          if (!L.loadedAt(vx, vz)) { any = 1; continue; }
          if (SR.faceFull(L.getBlock(vx, vy, vz), FACE_OF_SUP[(rule === 35 && vf === 1) ? vf : vf ^ 1])) { any = 1; continue; }
          // ⚠ THE VINE-UNDER-VINE FALLBACK IS RULE 35 ONLY, and only for a horizontal face:
          // a vine keeps a side attachment when the vine above it has the same side.
          if (rule === 35 && vf >= 2) {
            var va = L.getBlock(x, y + 1, z);
            if (SR.block[va] === SR.block[st] && SR.propValue(va, pi) === R.PVAL.true) { any = 1; continue; }
          }
          // ⚠ A VINE DROPS A DEAD FACE AND KEEPS THE REST (#19). `VineBlock.canPlaceAt` is
          // `hasAdjacentBlocks(getPlacementShape(...))`: every attached side is re-tested, an
          // unsupported one is switched OFF, and the vine survives if ANY face is left. Lichen
          // (`MultifaceGrowthBlock.canPlaceAt`) returns false on the first dead face, which is
          // why the two share this loop and not this line. Written here as "not counted", so a
          // vine hanging under leaves by one good face is not judged by the face it lost.
          if (rule === 35) continue;
          return 0;
        }
        return any;
      }

      // ── 37 CHORUS PLANT ─────────────────────────────────────────────────────────────────
      case 37: {
        var cAbove = L.getBlock(x, y + 1, z);
        var flag = (SR.isAir[cAbove] === 0 && SR.isAir[below] === 0);
        for (var ci = 0; ci < 4; ci++) {
          var qx = x + HORIZ_DX[ci], qz = z + HORIZ_DZ[ci];
          if (!L.loadedAt(qx, qz)) continue;
          if (SR.block[L.getBlock(qx, y, qz)] !== SR.block[st]) continue;
          if (flag) return 0;
          var ub = SR.block[L.getBlock(qx, y - 1, qz)];
          if (ub === SR.block[st] || ub === SV.BID.end_stone) return 1;
        }
        var cb2 = SR.block[below];
        return (cb2 === SR.block[st] || cb2 === SV.BID.end_stone) ? 1 : 0;
      }

      // ── 38 CHORUS FLOWER ────────────────────────────────────────────────────────────────
      case 38: {
        var fb = SR.block[below];
        if (fb === SV.BID.chorus_plant || fb === SV.BID.end_stone) return 1;
        if (SR.isAir[below] === 0) return 0;
        var found = 0;
        for (var fi = 0; fi < 4; fi++) {
          var rx = x + HORIZ_DX[fi], rz = z + HORIZ_DZ[fi];
          if (!L.loadedAt(rx, rz)) continue;
          var rn = L.getBlock(rx, y, rz);
          if (SR.block[rn] === SV.BID.chorus_plant) { if (found) return 0; found = 1; }
          else if (SR.isAir[rn] === 0) return 0;
        }
        return found;
      }

      // ── 39 SCAFFOLDING: a support distance under seven ──────────────────────────────────
      // ⚠ THE HORIZONTAL SCAN IS AROUND THE BLOCK ITSELF, NOT AROUND THE CELL BELOW. Vanilla
      // re-points its mutable cursor at `pos + dir`, and reading it as `below + dir` builds a
      // scaffolding that hangs one block further than the real game allows.
      case 39: {
        var sBelow = below, d0 = 7;
        if (SR.block[sBelow] === SR.block[st]) d0 = SV.distOf(sBelow);
        else if (SR.faceSturdy(sBelow, UP, FULL)) return 1;
        for (var si = 0; si < 4; si++) {
          var tx = x + HORIZ_DX[si], tz = z + HORIZ_DZ[si];
          if (!L.loadedAt(tx, tz)) continue;
          var tn = L.getBlock(tx, y, tz);
          if (SR.block[tn] !== SR.block[st]) continue;
          var td = SV.distOf(tn) + 1;
          if (td < d0) d0 = td;
          if (d0 === 1) break;
        }
        return d0 < 7 ? 1 : 0;
      }

      // ── 12 WALL BANNER / WALL SIGN: a SOLID MATERIAL on the block behind ─────────────────
      case 12: {
        var bf = SR.propValue(st, R.PROP.facing);
        var bd = FACING_TO_FACE[bf];
        if (bd === undefined) return 1;
        var bx = x - SUP_DX[bd], by = y - SUP_DY[bd], bz = z - SUP_DZ[bd];
        if (!L.loadedAt(bx, bz)) return 1;
        var bl = L.getBlock(bx, by, bz);
        return bl !== 0 && SR.solidMat[SR.block[bl]] === 1 ? 1 : 0;
      }
    }
    return -1;
  }
  var HORIZ_DX = [0, 0, -1, 1], HORIZ_DZ = [-1, 1, 0, 0];
  /** SUP direction -> the boolean property a vine or a multiface block uses for that side. */
  var SUP_TO_PROP = ['down', 'up', 'north', 'south', 'west', 'east'];

  /**
   * ── THE GROUND RULES: vanilla's seventeen `mayPlaceOn` bodies (D-348) ─────────────────────
   *
   * ⚠⚠ **THIS IS WHERE "THE BUSH FAMILY" STOPS BEING ONE RULE.** `canSurvive` for all of these
   * is the same three lines — fetch the state below, ask `mayPlaceOn` — and the answer differs
   * per block. Every name below appears in that block's own class in the jar, and
   * `supportcheck` asserts so against the referee's `refblocks` and `reftags` rows: a wrong name
   * here resolves to -1 and matches nothing, which is a rule that never fires and looks exactly
   * like no bug at all.
   *
   * @returns 1 allowed · 0 refused
   */
  function groundOk(L, g, x, y, z, below) {
    var SR = NS.States;
    var bb = SR.block[below];
    switch (g) {
      case 0: return 1;                      // no ground rule: nothing to refuse
      // 1 BUSH — saplings, flowers, grass, ferns, the lot
      case 1: return (tagQ(L, 'dirt', below) || bb === SV.BID.farmland) ? 1 : 0;
      // 2 AZALEA — and clay, which is why it grows over a lush cave
      case 2: return (bb === SV.BID.clay) ? 1 : groundOk(L, 1, x, y, z, below);
      // 3 FUNGUS — nylium, mycelium, soul soil, or the bush rule
      case 3:
        if (tagQ(L, 'nylium', below) || bb === SV.BID.mycelium || bb === SV.BID.soul_soil) return 1;
        return groundOk(L, 1, x, y, z, below);
      // 4 ROOTS AND NETHER SPROUTS — the same without mycelium
      case 4:
        if (tagQ(L, 'nylium', below) || bb === SV.BID.soul_soil) return 1;
        return groundOk(L, 1, x, y, z, below);
      // 5 NETHER WART — soul sand, and nothing else at all
      case 5: return bb === SV.BID.soul_sand ? 1 : 0;
      // 6 CROPS AND STEMS — farmland only. ⚠ NOT the dirt tag: a wheat seed on grass is refused.
      case 6: return bb === SV.BID.farmland ? 1 : 0;
      // 7 DEAD BUSH — sand, the terracottas, or dirt.
      // ⚠ THE JAR NAMES NINETEEN BLOCKS ONE BY ONE and this asks two tags instead, because the
      // two tags' membership is EXACTLY those nineteen — `supportcheck` asserts that against the
      // referee's own list rather than trusting the coincidence.
      case 7:
        return (tagQ(L, 'sand', below) || tagQ(L, 'terracotta', below) ||
                tagQ(L, 'dirt', below)) ? 1 : 0;
      // 8 SEAGRASS — a full face up, and not magma
      case 8:
        if (bb === SV.BID.magma_block) return 0;
        return SR.faceSturdy(below, 2, SR.SUPPORT_FULL) ? 1 : 0;
      // 9 LILY PAD — water or the ICE material below, and no fluid in its own cell.
      // ⚠ `Material.ICE` IS NOT "anything icy": packed ice and blue ice are ICE_SOLID, and a
      // lily pad does not float on them.
      case 9: {
        var here = L.getBlock(x, y, z);
        if (SR.waterIn[here] || SR.block[here] === SV.BID.water) return 0;
        // ⚠ `Fluids.WATER` is the STILL fluid: water[level=1..15] is FLOWING_WATER and refuses (#349).
        if (bb === SV.BID.water) return below === NS.Reg.realFirst[bb] ? 1 : SR.iceMat[bb] === 1 ? 1 : 0;
        if (SR.waterIn[below]) return 1;
        return SR.iceMat[bb] === 1 ? 1 : 0;
      }
      // 10 WITHER ROSE — the bush rule, plus the three nether floors
      case 10:
        if (bb === SV.BID.netherrack || bb === SV.BID.soul_sand || bb === SV.BID.soul_soil) return 1;
        return groundOk(L, 1, x, y, z, below);
      // 11 MUSHROOM — a floor that RENDERS SOLID (D-350). Not a sturdy face, not a collision
      // box: `canOcclude` and a full-cube OUTLINE, which is why a mushroom grows on soul sand
      // (whose outline is a whole cube) and not on a slab (whose outline is a half one).
      case 11: return SR.solidRender(below) ? 1 : 0;
      // 12 SEA PICKLE — any collision at the top of the block below, or a sturdy one
      case 12:
        return (SR.faceHasAny(below, 2) || SR.faceSturdy(below, 2, SR.SUPPORT_FULL)) ? 1 : 0;
      // 13 SMALL DRIPLEAF — its tag, or water in its own cell and the bush rule
      case 13: {
        if (tagQ(L, 'small_dripleaf_placeable', below)) return 1;
        var hc = L.getBlock(x, y, z);
        if (!SR.waterIn[hc]) return 0;
        // isEqualAndStill(WATER): a water BLOCK must be the source (level 0); a waterlogged block is still
        if (SR.block[hc] === SV.BID.water && SR.propValue(hc, NS.Reg.PROP.level) !== NS.Reg.PVAL['0']) return 0;
        return groundOk(L, 1, x, y, z, below);
      }
    }
    return -1;
  }

  /**
   * ⚠ THE FOUR GROWING PLANTS, AND WHICH WAY EACH GROWS. Vanilla holds this as a field on the
   * base class set by each subclass's constructor; the referee read the four constructors.
   * ⚠ NAMED IN ONE PLACE so the rule above carries no block names of its own.
   */
  var GROW = null;
  function growTable() {
    if (GROW) return GROW;
    GROW = {};
    var fams = [
      ['kelp', 'kelp_plant', 1, 1],                          // up, and shy of magma
      ['twisting_vines', 'twisting_vines_plant', 1, 0],      // up
      ['cave_vines', 'cave_vines_plant', 0, 0],              // down
      ['weeping_vines', 'weeping_vines_plant', 0, 0]         // down
    ];
    for (var i = 0; i < fams.length; i++) {
      var head = SV.BID[fams[i][0]], body = SV.BID[fams[i][1]];
      var rec = { up: fams[i][2], magmaShy: fams[i][3], head: head, body: body };
      if (head >= 0) GROW[head] = rec;
      if (body >= 0) GROW[body] = rec;
    }
    return GROW;
  }
  SV.growUp = function (b) { var r = growTable()[b]; return r ? r.up : 1; };
  SV.growHead = function (b) { var r = growTable()[b]; return r ? r.head : -1; };
  SV.growBody = function (b) { var r = growTable()[b]; return r ? r.body : -1; };
  SV.growMagmaShy = function (b) { var r = growTable()[b]; return !!(r && r.magmaShy); };

  /** A scaffolding state's `distance` property as a NUMBER, via the registry's value names. */
  SV.distOf = function (state) {
    var R = NS.Reg, v = NS.States.propValue(state, R.PROP.distance);
    for (var d = 0; d <= 7; d++) if (R.PVAL[String(d)] === v) return d;
    return 7;
  };

  /**
   * ⚠ NAMED AND OPEN, NOT SILENT (the habit D-346 set). Two of vanilla's rules need a table this
   * engine does not have yet, and they are LISTED here rather than approximated:
   *   mushroom  `isSolidRender` = `canOcclude && a full-cube occlusion shape`. `transparent` in
   *             the third-party dataset is NOT `canOcclude`, and substituting it would be a
   *             proxy one inference away from the thing that matters.
   *   fire      the ignite-odds map, which decides whether a neighbour is flammable.
   * `supportcheck` asserts this list is exactly as long as the set of ground rules returning -1
   * plus the canSurvive owners left unimplemented, so it cannot rot.
   */
  // ⚠ EMPTY, AND THAT IS AN ASSERTION, NOT A DELETION. `supportcheck` requires this list to be
  // exactly as long as the set of blocks with a vanilla override this engine does not implement,
  // so it cannot quietly become a place where things are forgotten.
  SV.OWED_GROUND = [];


  /**
   * ⚠ THE BLOCKS THE RULES NAME, RESOLVED ONCE AND BY NAME. The jar's rules reference specific
   * blocks — ice, packed ice, barrier, honey, soul sand, sand, red sand, water, lava — and a
   * lookup per neighbour per placement is a string compare in a hot path. They are resolved on
   * first use rather than at load, because `07_world.js` is parsed before the registry exists.
   * ⚠ A MISSING NAME RESOLVES TO -1 AND MATCHES NOTHING, which makes a typo a rule that never
   * fires rather than a rule that fires on block 0 — i.e. on AIR, which is everywhere.
   */
  /**
   * ⚠ EVERY NAME THE RULES USE, IN ONE LIST. Twenty-seven rules name blocks, and a name typed in
   * the middle of a switch is a name nobody can audit. `supportcheck` asserts that every entry
   * here resolves to a real block AND that every name the rules reach for is one the referee saw
   * in that rule's own class (`refblocks` / `reftags`).
   */
  var NAMED_BLOCKS = [
    'ice', 'packed_ice', 'barrier', 'honey_block', 'soul_sand',
    'sand', 'red_sand', 'water', 'lava',
    // D-349's twenty-five new rules
    'farmland', 'clay', 'mycelium', 'soul_soil', 'netherrack', 'magma_block', 'frosted_ice',
    'hopper', 'sugar_cane', 'bubble_column', 'big_dripleaf', 'big_dripleaf_stem',
    'pointed_dripstone', 'scaffolding', 'chorus_plant', 'end_stone',
    'piston', 'sticky_piston', 'moving_piston',
    'kelp', 'kelp_plant', 'cave_vines', 'cave_vines_plant',
    'twisting_vines', 'twisting_vines_plant', 'weeping_vines', 'weeping_vines_plant'
  ];
  var idsReady = false;
  function resolveIds() {
    var R = NS.Reg, i;
    // ⚠ A MISSING NAME RESOLVES TO -1 AND MATCHES NOTHING — a rule that never fires rather than
    // one that fires on block 0, which is AIR and is everywhere.
    SV.BID = {};
    for (i = 0; i < NAMED_BLOCKS.length; i++) SV.BID[NAMED_BLOCKS[i]] = -1;
    if (!R || !R.ready) return false;
    for (var b = 0; b < R.blockCount; b++) {
      if (SV.BID[R.names[b]] !== undefined) SV.BID[R.names[b]] = b;
    }
    // ⚠ THE LEGACY NAMES STAY, pointing at the same table rather than at a second copy of it.
    SV.B_ICE = SV.BID.ice; SV.B_PACKED_ICE = SV.BID.packed_ice; SV.B_BARRIER = SV.BID.barrier;
    SV.B_HONEY = SV.BID.honey_block; SV.B_SOUL_SAND = SV.BID.soul_sand;
    SV.B_SAND = SV.BID.sand; SV.B_RED_SAND = SV.BID.red_sand;
    SV.B_WATER = SV.BID.water; SV.B_LAVA = SV.BID.lava;
    // the snow rule's "eight layers" value, by name for the same reason
    SV.V_LAYERS_8 = (R.PVAL && R.PVAL['8'] !== undefined) ? R.PVAL['8'] : -1;
    idsReady = true;
    return true;
  }
  /** Re-resolve on demand: a check that swaps the registry under the engine needs this. */
  SV.resolveIds = function () { idsReady = false; var ok = resolveIds(); if (SV.onResolve) SV.onResolve(SV); return ok; };
  /**
   * The ARCH face a support neighbour must present, per `SUP_D*` direction.
   *
   * ⚠⚠ **THIS WAS INVERTED IN ITS FIRST DRAFT AND NOTHING CAUGHT IT**, because the check asserted
   * that a lever HAS a rule and never placed one on a wall. The support sits at
   * `pos - SUP_D[d]`, so the face of it that touches us points ALONG `SUP_D[d]`: a block hanging
   * from below (`d` = down) is held by the block ABOVE, and what it needs is that block's
   * BOTTOM face. SUP order is down, up, north, south, west, east; ARCH order is +X -X +Y -Y +Z -Z.
   *   down  (0,-1,0) -> -Y -> 3     up    (0,1,0) -> +Y -> 2
   *   north (0,0,-1) -> -Z -> 5     south (0,0,1) -> +Z -> 4
   *   west  (-1,0,0) -> -X -> 1     east  (1,0,0) -> +X -> 0
   * ⚠ The two orders are six directions that disagree, which is exactly the mix-up the comment
   * on `SUP_D*` below warns about — and I made it anyway, one function later.
   */
  var FACE_OF_SUP = [3, 2, 5, 4, 1, 0];

  // ⚠ SUP_D* is `Features.supported`'s order — down, up, north, south, west, east — and NOT
  // CFG's face order. Both are six directions and they disagree, which is exactly the sort of
  // mix-up that reads as "the rule is inverted" rather than "the table is the wrong one", so the
  // mapping from the placement table's value ids (north south west east up down) is written out.
  var SUP_DX = [0, 0, 0, 0, -1, 1], SUP_DY = [-1, 1, 0, 0, 0, 0], SUP_DZ = [0, 0, -1, 1, 0, 0];
  var FACING_TO_FACE = { 0: 2, 1: 3, 2: 4, 3: 5, 4: 1, 5: 0 };

  SV.SUP_DX = SUP_DX; SV.SUP_DY = SUP_DY; SV.SUP_DZ = SUP_DZ;
  SV.FACE_OF_SUP = FACE_OF_SUP; SV.FACING_TO_FACE = FACING_TO_FACE;
  SV.HORIZ_DX = HORIZ_DX; SV.HORIZ_DZ = HORIZ_DZ;
})(MCL);
