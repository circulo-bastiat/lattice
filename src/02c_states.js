// 02c_states.js — the per-REAL-STATE property tables. The world's block id IS a real state.
// Runs on: main thread AND workers. No DOM.
//
// ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────────────────
// Until session 2 the world stored one of 49 hand-written legacy ids from `src/02_blocks.js`,
// and every hot loop in the engine indexed a parallel array by that id: `B.opaque[id]`,
// `B.tiles[id*6+face]`, `B.atten[id]`. The 1.18.2 roster — 900 blocks, 20,344 real states —
// was fully extracted, packed, decoded at boot and reachable from every worker, and still
// could not be placed, because nothing but those 49 ids could go into a section.
//
// The decision (Dan, session 2) was ONE ID SPACE (D-100): the legacy 49 are re-expressed as registry
// real states and the legacy id space is retired, rather than keeping both and converting
// between them. Two id spaces means a conversion function in nineteen places and a bug living
// in whichever one somebody forgot.
//
// So a cell holds a real state id, and the hot loops need the same O(1) parallel arrays they
// always had — just 20,344 entries long instead of 49. That is what this file builds. Every
// array here is derived from `NS.Reg` at boot; nothing is hand-written except the two tables
// the game's own data does not contain, and both are marked.
//
// Total cost: about 430 KB of typed arrays, built in a few milliseconds, once per thread.
//
// ── WHAT IS DERIVED, AND FROM WHAT ───────────────────────────────────────────────────────
//   block, name          Reg.realFirst          — which block a state belongs to
//   vis                  Reg.toVisual           — its visual state
//   opaque               Reg.flags              — opaque BY MATERIAL (glass is not)
//   cull                 Reg.occlusion          — the 6-bit geometric mask, ANDed with opaque
//   emit, atten          Reg.emit / Reg.filter
//   hard                 Reg.breakSeconds       — SECONDS to break bare-handed, not hardness (D-102)
//   solid                Reg.shapeOf            — has any collision box
//   geom, part, tiles    the baked geometry     — full cube fast path vs the model stream
//   layer                atlas alpha + a list   — the one thing vanilla keeps in Java
//   anim, selfCull       small explicit lists   — also Java-side
//
(function (NS) {
  'use strict';

  var SR = NS.States = {};

  SR.ready = false;
  SR.AIR = 0;          // guaranteed: tools/extract-blocks.mjs pins air to block 0 (D-103, regcheck)

  SR.GEOM_NONE  = 0;   // no quads at all — air, and 1,303 other states (fluids, barriers)
  SR.GEOM_CUBE  = 1;   // a full 16x16x16 cube: the greedy mesher's fast path
  SR.GEOM_MODEL = 2;   // anything else: the baked model stream

  // KW-48d: the 6-bit (down/up/north/south/west/east) set of faces a collision shape covers
  // COMPLETELY, by shape index, memoised — 4,105 shapes serve 20,344 states.
  var coverMemo = {};
  function shapeCover(sh) {
    var c = coverMemo[sh];
    if (c !== undefined) return c;
    var R = NS.Reg, a = R.shapeOff[sh], b = R.shapeOff[sh + 1], bx = R.shapeBox, d, i, x, y;
    c = 0;
    for (d = 0; d < 6; d++) {
      var ax = d < 2 ? 1 : d < 4 ? 2 : 0, plane = (d & 1) ? 1024 : 0;
      var u = (ax + 1) % 3, w = (ax + 2) % 3, cell = new Uint8Array(256), full = 1;
      for (i = a; i < b; i++) {
        var o = i * 6;
        if ((plane === 0 ? bx[o + ax] : bx[o + 3 + ax]) !== plane) continue;
        for (x = bx[o + u] >> 6; x < (bx[o + 3 + u] + 63) >> 6; x++)
          for (y = bx[o + w] >> 6; y < (bx[o + 3 + w] + 63) >> 6; y++) cell[x * 16 + y] = 1;
      }
      for (i = 0; i < 256; i++) if (!cell[i]) { full = 0; break; }
      if (full) c |= 1 << d;
    }
    return (coverMemo[sh] = c);
  }
  // ── mesher face order vs registry face order ───────────────────────────────────────────
  // mesher: 0 +X 1 -X 2 +Y 3 -Y 4 +Z 5 -Z    registry/model: 0 down 1 up 2 north 3 south 4 west 5 east
  // A block at +X presents its WEST face toward us, so the +X entry is `west`. Same table as
  // src/05_mesher.js's FACING_BIT, kept here because the mask is baked once instead of per read.
  var FACING_BIT = [4, 5, 0, 1, 2, 3];
  // and the other direction: mesher face -> the registry direction of the quad ON THIS BLOCK
  // that faces that way. +X is this block's own EAST face.
  var OWN_FACE = [5, 4, 1, 0, 3, 2];
  SR.FACING_BIT = FACING_BIT;
  SR.OWN_FACE = OWN_FACE;

  // ── the two tables vanilla keeps in Java ───────────────────────────────────────────────
  //
  // 1. TRANSLUCENT (D-105). `RenderType.translucent()` is assigned per block in Java and appears in no
  //    data file. Everything else can be derived from the texture's alpha (see the alpha-class
  //    note in tools/build-atlas.mjs); these are the blocks whose textures are fully opaque or
  //    binary but which vanilla still draws in the sorted pass. Wildcards are suffix matches.
  //    Getting this wrong is visible immediately — a translucent block in the opaque pass shows
  //    a hard edge, an opaque one in the sorted pass costs sorting for nothing.
  var TRANSLUCENT_EXACT = [
    'water', 'bubble_column', 'ice', 'frosted_ice', 'honey_block', 'slime_block',
    'tinted_glass', 'nether_portal', 'end_gateway', 'end_portal'
  ];
  var TRANSLUCENT_SUFFIX = ['_stained_glass', '_stained_glass_pane'];

  // 2. ANIMATED. Vanilla scrolls these from a strip texture. MC-Lite's shader takes a vertex
  //    flag bit (§8) rather than a texture animation, so it needs the list. Fluids only, which
  //    is also all the strip textures the atlas carries (D-51).
  var ANIMATED = ['water', 'lava'];

  // 4. WATER-FILLED (D-168). Vanilla's `getFluidState` returns water for these with no
  //    `waterlogged` property to derive it from: they ARE the water block as far as rendering is
  //    concerned. Anything with the property is handled generically below.
  var WATER_FILLED = ['water', 'seagrass', 'tall_seagrass', 'kelp', 'kelp_plant', 'bubble_column'];

  // 3. SELF-CULLING. Vanilla's `skipRendering` — do not emit a face between two blocks of the
  //    same kind. Glass, ice, the panes and the fluids. In vanilla this is an override on
  //    HalfTransparentBlock and IronBarsBlock; `LeavesBlock` does NOT override it.
  //
  //    ⚠ LEAVES ARE NOT IN THIS SET (D-178). They were, unconditionally, from session 2 until
  //    session 5, and that is vanilla's FAST-graphics behaviour applied while FANCY leaves —
  //    the default — was on. Measured cost: 65-67% of every leaf face in the world never
  //    emitted, in 100% of leafy sections; a 5x5x5 leaf blob emitted 150 faces where vanilla
  //    emits 750. Dan saw it as trees with half their leaves cut off, and he was looking
  //    straight through the canopy at the sky.
  //
  //    Fast leaves still culls, and does not need this list to: `setFastLeaves(true)` makes a
  //    leaf block OPAQUE with a full `SR.cull` mask, so the ordinary opaque-neighbour rule
  //    removes the same faces. That is also how vanilla does it — fast leaves are solid-render,
  //    not skip-rendering. D-93's win survives at the setting that asked for it.
  var SELFCULL_EXACT = ['water', 'lava', 'ice', 'frosted_ice', 'glass', 'tinted_glass', 'slime_block', 'honey_block'];   // + HalfTransparentBlock's slime/honey (#1160)
  var SELFCULL_SUFFIX = ['_stained_glass', '_glass_pane', '_stained_glass_pane'];

  function matches(name, exact, suffix) {
    for (var i = 0; i < exact.length; i++) if (name === exact[i]) return true;
    for (var j = 0; j < suffix.length; j++) {
      var s = suffix[j];
      if (name.length > s.length && name.lastIndexOf(s) === name.length - s.length) return true;
    }
    return false;
  }

  // ── geometry classification, per PART ──────────────────────────────────────────────────
  // A part is a full cube iff it has exactly six quads, one per direction, each of which is a
  // flat 0..16 x 0..16 face sitting exactly on its own plane with its cullface set to its own
  // direction. That is the shape the greedy mesher can merge: one tile per face, no overhang,
  // and a neighbour that occludes removes it.
  //
  // ⚠ Per PART, not per state, because a state can have several random alternatives (stone has
  // four: two textures times two rotations) and they are chosen by position. Classifying per
  // part keeps the alternatives working — the mesher resolves the part for the voxel and then
  // reads that part's six tiles.
  var PLANE_AXIS  = [1, 1, 2, 2, 0, 0];   // down up north south west east
  var PLANE_VALUE = [0, 16, 0, 16, 0, 16];
  var U = 16;                              // model units per block in the BAKED data / 16

  function classifyPart(R, part, tilesOut, tintOut, shadeOut) {
    var q0 = R.partOff[part], q1 = R.partOff[part + 1];
    if (q1 - q0 !== 6) return false;
    var seen = 0, k, q, tint = -1, shade = -1;
    for (q = q0; q < q1; q++) {
      var f = R.qFlags[q];
      var d = f & 7, cull = (f >>> 3) & 7;
      if (d > 5 || cull !== d) return false;             // no cullface, or it faces elsewhere
      if (seen & (1 << d)) return false;                 // two quads on one face
      seen |= 1 << d;
      var ax = PLANE_AXIS[d], plane = PLANE_VALUE[d] * (NS.CFG.MODEL_UNITS_PER_BLOCK / U);
      var o1 = ax === 0 ? 1 : 0, o2 = ax === 2 ? 1 : 2;
      var lo1 = 1e9, hi1 = -1e9, lo2 = 1e9, hi2 = -1e9;
      for (k = 0; k < 4; k++) {
        var po = q * 12 + k * 3;
        if (R.qPos[po + ax] !== plane) return false;     // not flat on its own plane
        var a = R.qPos[po + o1], b = R.qPos[po + o2];
        if (a < lo1) lo1 = a; if (a > hi1) hi1 = a;
        if (b < lo2) lo2 = b; if (b > hi2) hi2 = b;
      }
      var full = NS.CFG.MODEL_UNITS_PER_BLOCK;
      if (lo1 !== 0 || lo2 !== 0 || hi1 !== full || hi2 !== full) return false;
      var t = (f >>> 7) & 7, sh = (f >>> 6) & 1;
      if (tint < 0) { tint = t; shade = sh; } else if (t !== tint || sh !== shade) {
        // a cube whose faces disagree about tint (grass_block: green top, plain sides) is
        // still a cube — the tint is per FACE, so it is stored per face below.
      }
      tilesOut[d] = R.qTile[q];
    }
    tintOut[0] = tint < 0 ? 0 : tint;
    shadeOut[0] = shade < 0 ? 1 : shade;
    return seen === 0x3F;
  }

  /**
   * build(tileAlpha) — derive every table from NS.Reg. Idempotent; call again after a
   * resource pack changes the atlas. `tileAlpha` is one byte per atlas layer (0 opaque,
   * 1 cutout, 2 blend) from MCL.DATA; without it every block is treated as opaque, which is
   * what a build with no payload should do.
   */
  /**
   * @param extra  optional further per-block tables from the same join (D-348):
   *               `ground` — the mayPlaceOn rule id per block, the SECOND level of the survival
   *               rule, and `iceMat` — whether a block carries vanilla's `Material.ICE`.
   *               ⚠ AN OBJECT, NOT MORE POSITIONAL ARGUMENTS. This list has grown three times;
   *               a fifth and sixth positional parameter is a call site nobody can read and a
   *               new table can only be added at the end for ever.
   */
  SR.build = function (tileAlpha, supportRule, solidMaterial, extra) {
    var R = NS.Reg;
    if (!R || !R.ready) { SR.ready = false; return null; }
    var CFG = NS.CFG;
    var n = R.realCount, nb = R.blockCount, i, b, s, f;

    var block = SR.block = new Uint16Array(n);
    var vis = SR.vis = R.toVisual;                 // shared, not copied: same lifetime
    var geom = SR.geom = new Uint8Array(n);
    var alt1 = SR.alt1 = new Uint16Array(n);        // the part, when a state has exactly one
    var multi = SR.multi = new Uint8Array(n);       // 1 = resolve the part per position
    var opaque = SR.opaque = new Uint8Array(n);
    var cull = SR.cull = new Uint8Array(n);
    var faceCull = SR.faceCull = new Uint8Array(n); // which of OUR faces a neighbour may remove
    var layer = SR.layer = new Uint8Array(n);
    var atten = SR.atten = new Uint8Array(n);
    /**
     * ⚠ `lightSolid` is NOT `opaque` (D-156). `opaque` means "opaque BY MATERIAL", which is what
     * the mesher's face culling wants: a bottom slab's down face really does hide the top of the
     * block beneath it. Light asks a different question — vanilla's `getLightBlock`, which is
     * `isSolidRender ? 15 : (propagatesSkylightDown ? 0 : 1)` and is FALSE for anything whose
     * collision shape is not a full cube. The pc dataset ships that number as `filterLight`,
     * which is already loaded here as `atten`, so the light channel's "holds no light" test is
     * simply `atten === 15`. Deriving it from `opaque` instead made every slab, stair, wall,
     * fence, carpet, snow layer, farmland and dirt path in the game a full light blocker.
     */
    var lightSolid = SR.lightSolid = new Uint8Array(n);
    /**
     * ⚠ `waterIn` — this cell also contains WATER (D-168). Vanilla asks a block for its
     * `getFluidState`, and for seagrass, kelp and a waterlogged anything that answer is water:
     * the plant and the water occupy the same cell. MC-Lite stored only the plant, so the water
     * around it emitted faces INTO it and every underwater plant sat in a bubble of air —
     * "underwater plants carve out air holes", which Dan recognised as a bug MineHTML also had.
     * Filled below from the `waterlogged` property and a named list for the blocks that are
     * water-filled with no property to say so.
     */
    var waterIn = SR.waterIn = new Uint8Array(n);
    // ⚠ AIR IS THREE BLOCKS, NOT ONE (D-262), AND NOTHING READS THIS TABLE YET. Vanilla has
    // `air`, `cave_air` and `void_air`; they behave identically in every rule this engine has,
    // and vanilla's carvers write `cave_air` where MC-Lite writes plain air. The table exists so
    // that the ~25 places which still ask "is this air?" as `=== 0` have ONE answer to move to —
    // and until they do, flipping the carvers moves 6.5 ore and feature cells a chunk (D-256's
    // measurement) rather than relabelling anything. It is groundwork, deliberately unused, and
    // `statecheck` asserts it is right so the session that finishes the job inherits a fact.
    var isAir = SR.isAir = new Uint8Array(n);
    var emit = SR.emit = new Uint8Array(n);
    var solid = SR.solid = new Uint8Array(n);
    // D-263 — vanilla's `Material.isReplaceable()`, per real state, copied down from the block.
    // ⚠ NOT DERIVED FROM GEOMETRY. `14_player.js` used to compute this as "a model, with no
    // collision and no light", which is 139 blocks against vanilla's 28, so a placed block ate
    // fence gates, buttons, pressure plates, rails, levers, saplings, flowers, corals, cobweb,
    // sugar cane and every crop. The table is in the runtime blob, out of the jar's bytecode.
    var replaceable = SR.replaceable = new Uint8Array(n);
    var selfCull = SR.selfCull = new Uint8Array(n);
    // The support class per REAL state (D-140, D-158): 0 none · 1 floor · 2 ceiling · 3 any
    // face · 4 behind (the neighbour opposite `facing`).
    // Packed into the runtime blob's flag byte by tools/pack-runtime.mjs, out of the pc
    // dataset's `material`. `src/04j_features.js` is the one consumer today; block placement
    // (G2) is the second, and it wants the same table.
    var support = SR.support = new Uint8Array(n);
    // ⚠ D-346 — the per-STATE survival rule, expanded from the per-BLOCK table the jar's own
    // `canSurvive` overrides gave us. 0 means "keep the material-derived support class", which is
    // every block this engine has not implemented a rule for yet; `DATA.supportOwed` counts them.
    var srule = SR.rule = new Uint8Array(n);
    // ⚠ PER BLOCK, not per state: `Material` is a block-level property and 900 bytes beats
    // 20,344. Defaults to 1 so an older payload with no table behaves as it always did.
    SR.solidMat = new Uint8Array(R.blockCount);
    for (var mi = 0; mi < R.blockCount; mi++) {
      SR.solidMat[mi] = solidMaterial ? (solidMaterial[mi] ? 1 : 0) : 1;
    }
    // ⚠⚠ D-348 — THE SECOND LEVEL OF THE SURVIVAL RULE, PER BLOCK. Vanilla's biggest `canSurvive`
    // owner decides nothing: its body is "fetch the state below and ask `mayPlaceOn`", and
    // `mayPlaceOn` is overridden seventeen times beneath it. `rule` above says WHICH canSurvive a
    // block obeys; this says which GROUND test that rule ends in. 0 is "no ground rule", which is
    // every block whose survival does not ask the question at all.
    var xtra = extra || {};
    SR.ground = new Uint8Array(R.blockCount);
    // ⚠ `Material.ICE` — the lily pad floats on ice and on water, and on NOTHING else that looks
    // icy: packed ice and blue ice are `ICE_SOLID`, a different material.
    SR.iceMat = new Uint8Array(R.blockCount);
    // ⚠ D-350 — vanilla's `canOcclude`, and whether the block keeps vanilla's DEFAULT outline
    // shape (1 yes, 0 it overrides getShape, 255 its class is built by a helper and is unknown).
    // `SR.solidRender` is the one reader and the mushroom rule is its one caller.
    SR.canOcclude = new Uint8Array(R.blockCount);
    SR.outlineFull = new Uint8Array(R.blockCount);
    // ⚠ D-352 — vanilla's ignite odds per block. 0 is "fire does not spread from this", which is
    // 758 of the 898 blocks; the rest run from 5 to 60.
    SR.ignite = new Uint8Array(R.blockCount);
    // and the SECOND int of the same call: burn odds, `FireBlock.checkBurnOut`'s chance to consume.
    SR.burn = new Uint8Array(R.blockCount);
    for (var gi = 0; gi < R.blockCount; gi++) {
      SR.ground[gi] = xtra.ground ? (xtra.ground[gi] | 0) : 0;
      SR.iceMat[gi] = xtra.iceMat ? (xtra.iceMat[gi] ? 1 : 0) : 0;
      SR.canOcclude[gi] = xtra.occlude ? (xtra.occlude[gi] ? 1 : 0) : 1;
      SR.ignite[gi] = xtra.ignite ? (xtra.ignite[gi] | 0) : 0;
      SR.burn[gi] = xtra.burn ? (xtra.burn[gi] | 0) : 0;
      SR.outlineFull[gi] = xtra.outlineFull ? (xtra.outlineFull[gi] < 0 ? 255 : (xtra.outlineFull[gi] | 0)) : 255;
    }
    // ⚠ DECOR (D-130): model geometry that occludes NOTHING and is opaque to nothing — a grass
    // tuft, a flower, a torch, a vine. It is the only thing `Settings.crossModels = false` is
    // allowed to drop. See the note where it is filled, below.
    var decor = SR.decor = new Uint8Array(n);
    var anim = SR.anim = new Uint8Array(n);
    var hard = SR.hard = new Float32Array(n);

    // per-part tables: the cube fast path reads these, indexed by part, not by state
    //
    // ⚠ TWO SYNTHETIC PARTS ARE APPENDED past the registry's own, for water and lava (D-106). Vanilla
    // has no block MODEL for a fluid — `block/water.json` and `block/lava.json` carry a
    // particle texture and nothing else, because fluids are drawn by a dedicated renderer that
    // varies the surface height per corner. MC-Lite does not have that renderer yet, and the
    // 49-block table drew fluids as plain cubes, which is what makes a lake look like a lake.
    // So the two get a fabricated full-cube part each and take the greedy path like any other
    // cube. Nothing indexes these past SR's own arrays — the mesher only ever uses a part
    // number to read partTiles/partTint/partShade — so extending the range is safe.
    // The tile numbers come from B.T, whose layers 0..56 are pinned by the atlas builder and
    // are therefore the same integer on the main thread and in every worker (D-57).
    var FLUIDS = [
      // flow: the layer build-atlas packs right after the 57 legacy ones (#2002; fluidtilecheck pins it); vanilla
      // draws a fluid's four sides with the flowing sprite and its top/bottom with the still one
      { name: 'water', tile: 14, flow: 57, tint: 3 },   // B.T.WATER — tint 3 is the biome water colour
      { name: 'lava',  tile: 48, flow: 58, tint: 0 }    // B.T.LAVA
    ];
    var np = R.partCount + FLUIDS.length;
    var partCube = SR.partCube = new Uint8Array(np);
    var partTiles = SR.partTiles = new Uint16Array(np * 6);
    var partTint = SR.partTint = new Uint8Array(np * 6);
    var partShade = SR.partShade = new Uint8Array(np);
    var fluidPart = Object.create(null);
    for (var fi = 0; fi < FLUIDS.length; fi++) {
      var fp = R.partCount + fi;
      fluidPart[FLUIDS[fi].name] = fp;
      partCube[fp] = 1;
      partShade[fp] = 1;
      for (var ff = 0; ff < 6; ff++) {
        partTiles[fp * 6 + ff] = (ff === 2 || ff === 3) ? FLUIDS[fi].tile : FLUIDS[fi].flow;
        partTint[fp * 6 + ff] = FLUIDS[fi].tint;
      }
    }
    SR.partCount = np;
    SR.realPartCount = R.partCount;

    /**
     * ⚠ THE PART CANNOT TAKE THE GREEDY PATH EVEN THOUGH IT IS A CUBE (D-181).
     *
     * `classifyPart` above asks a question about SHAPE — six quads, one per face, flat, full,
     * self-culling — and glazed terracotta answers yes to all of it. What it does not ask, and
     * cannot cheaply ask, is whether the greedy path can reproduce the part's TEXTURE. It
     * cannot: the greedy vertex packs (tile, uRep, vRep, corner, tint) into 32 bits with nothing
     * spare, so the mesher regenerates canonical UVs from the corner index, and vanilla's
     * per-face `rotation` — 90/270/0/180 on the four sides of `template_glazed_terracotta`, and
     * the entire difference between the block's four facings — has nowhere to live (D-177).
     *
     * So the answer is BAKED, per part, by tools/bake-geometry.mjs at the one moment that knows
     * the rotation, and it arrives as R.partUvRot. The cost of reading it is one array lookup
     * per ALTERNATIVE per state, here, once, at startup — and none at all in the mesh loop,
     * which goes on reading the same `geom` byte it always read and now finds a 2 in it for
     * these 176 states. That is the whole reason the flag is precomputed rather than derived:
     * a UV classifier on the path every block in the world takes is not affordable on a 2200G.
     *
     * `partCube` itself is left alone. It is a statement about SHAPE and other code reads it as
     * one; this is a statement about what the renderer can express, and conflating the two would
     * make the classifier's own check untestable.
     */
    var partUvRot = SR.partUvRot = new Uint8Array(np);
    if (R.partUvRot) partUvRot.set(R.partUvRot.subarray(0, R.partCount));

    var tmpTiles = new Uint16Array(6), tmpTint = new Int32Array(1), tmpShade = new Int32Array(1);
    for (i = 0; i < R.partCount; i++) {
      if (!classifyPart(R, i, tmpTiles, tmpTint, tmpShade)) continue;
      partCube[i] = 1;
      partShade[i] = tmpShade[0];
      // re-walk for the per-face tint, which classifyPart deliberately does not collapse
      var q0 = R.partOff[i], q1 = R.partOff[i + 1];
      for (var q = q0; q < q1; q++) {
        var fl = R.qFlags[q], d = fl & 7;
        partTiles[i * 6 + d] = R.qTile[q];
        partTint[i * 6 + d] = (fl >>> 7) & 7;
      }
    }

    // ── per block, then per state ─────────────────────────────────────────────────────────
    var alphaOf = function (t) { return tileAlpha ? (tileAlpha[t] | 0) : 0; };

    for (b = 0; b < nb; b++) {
      var name = R.names[b];
      var bOpaque = R.transparent(b) ? 0 : 1;
      var bEmit = R.emit[b], bAtten = R.filter[b];
      var bReplaceable = R.replaceable(b) ? 1 : 0;   // D-263, per block: it is a MATERIAL property
      var bHard = R.breakSeconds(b);   // SECONDS, not raw hardness — see R.breakSeconds
      var bAnim = matches(name, ANIMATED, []) ? 1 : 0;
      var bSelf = matches(name, SELFCULL_EXACT, SELFCULL_SUFFIX) ? 1 : 0;
      var bSupport = R.support(b);
      var bRule = supportRule ? (supportRule[b] | 0) : 0;
      var bTrans = matches(name, TRANSLUCENT_EXACT, TRANSLUCENT_SUFFIX) ? 1 : 0;
      // ⚠ the blocks vanilla implements as water-filled with no property to say so (D-168).
      // A fourth named Java-side list, for the same reason as the other three: the data does not
      // carry `getFluidState`, and a wrong list should be visible.
      var bWaterBlock = matches(name, WATER_FILLED, []) ? 1 : 0;

      var s0 = R.realFirst[b], s1 = R.realFirst[b + 1];
      for (s = s0; s < s1; s++) {
        block[s] = b;
        opaque[s] = bOpaque;
        emit[s] = bEmit;
        atten[s] = bAtten;
        lightSolid[s] = bAtten >= 15 ? 1 : 0;
        waterIn[s] = bWaterBlock;
        hard[s] = bHard;
        anim[s] = bAnim;
        selfCull[s] = bSelf;
        support[s] = bSupport;
        srule[s] = bRule;

        var v = R.toVisual[s];

        // --- geometry class and the part, if there is exactly one ------------------------
        var groups = R.groupCount(v);
        var quads = 0, onlyPart = -1, isCube = 0, alts = 0;
        if (groups === 1) {
          var g0 = R.stGroupOff[v];
          var a0 = R.grpAltOff[g0], a1 = R.grpAltOff[g0 + 1];
          alts = a1 - a0;
          isCube = 1;
          for (var a = a0; a < a1; a++) {
            var pt = R.altPart[a];
            // D-181: a cube whose UVs the greedy stream cannot express is not a cube HERE.
            if (!partCube[pt] || partUvRot[pt]) { isCube = 0; }
            quads += R.partOff[pt + 1] - R.partOff[pt];
          }
          if (alts === 1) onlyPart = R.altPart[a0];
        } else {
          for (var g = 0; g < groups; g++) {
            var gg = R.stGroupOff[v] + g;
            for (var aa = R.grpAltOff[gg]; aa < R.grpAltOff[gg + 1]; aa++) {
              quads += R.partOff[R.altPart[aa] + 1] - R.partOff[R.altPart[aa]];
            }
          }
        }
        if (quads === 0) geom[s] = SR.GEOM_NONE;
        else if (isCube) geom[s] = SR.GEOM_CUBE;
        else geom[s] = SR.GEOM_MODEL;
        alt1[s] = onlyPart >= 0 ? onlyPart : 0;
        multi[s] = (geom[s] === SR.GEOM_CUBE && onlyPart < 0) ? 1 : 0;
        // the fluid override: no model, but it must still draw (see FLUIDS above)
        // ⚠ `quads` is deliberately left at 0. It is what the cull mask below keys off, and a
        // fluid's derived occlusion mask is empty precisely BECAUSE it has no model — "not
        // described by a model", not "see-through". Setting it here would turn the fallback
        // off and every lava lake would draw its own hidden interior again.
        if (fluidPart[name] !== undefined) {
          geom[s] = SR.GEOM_CUBE;
          alt1[s] = fluidPart[name];
          multi[s] = 0;
        }

        // --- the cull mask ---------------------------------------------------------------
        // Two conditions, and the second is why glass exists: a face is culled only if the
        // neighbour COVERS it geometrically AND is opaque by material. Glass is a full cube
        // whose geometric mask is all six faces, and culling against it would black out the
        // inside of every glass house.
        //
        // ⚠ A state with NO geometry keeps the material's answer rather than "occludes
        // nothing". `block/lava.json` is a model with no elements — vanilla draws fluids from
        // a special path — so its derived mask is 0, which is "not described by a model", not
        // "see-through". Without this every lava lake draws its own hidden interior. Found by
        // tools/cullcheck.mjs in session 1 and preserved here deliberately.
        var geoMask = (quads === 0) ? 0x3F : R.occlusion[v];
        var m = 0, mf = 0;
        if (bOpaque) {
          // ⚠ KW-48d (#1160). `R.occlusion` is derived from the MODEL's elements, and a model can
          // fill a face its block's shape does not: the cactus model has a full-size top and bottom
          // element around inset sides, a chest/head/wall model is bigger than its shape. Vanilla's
          // `shouldRenderFace` asks the neighbour's face SHAPE, so a face the shape does not cover
          // never culls anything. Powder snow's empty shape is the same rule. AND the two.
          var cover = shapeCover(R.shapeOf[s]);
          for (f = 0; f < 6; f++) {
            if (((geoMask >> FACING_BIT[f]) & 1) && ((cover >> FACING_BIT[f]) & 1)) m |= 1 << f;
          }
        }
        cull[s] = m;
        // ⚠ D-130. `decor` is what the "cross models" setting is permitted to remove, and it is
        // derived rather than named: a state is decor when it needs the MODEL stream, covers no
        // face of its own cell, and is not opaque by material. That is a flower, a tuft, a
        // torch, a vine — and it is NOT a slab, a stair, a carpet, a cactus or a grass block,
        // all of which are on the model stream too and all of which hold the world up.
        //
        // The setting used to gate the whole model pass. Session 2 made every block in the game
        // a real registry state, which put 4,573 OCCLUDING states on that stream — grass_block
        // among them, because its side overlay is a second element — and from then on the
        // Celeron preset deleted the ground and you could see through the world. Dan found it by
        // playing: "a lot of block faces arent loading are are invisible".
        decor[s] = (geom[s] === SR.GEOM_MODEL && m === 0 && !bOpaque) ? 1 : 0;
        // faceCull: which of THIS block's own faces a covering neighbour is allowed to remove.
        // For the model path a quad names its own cullface direction, so this is the geometric
        // mask in mesher face order with no material AND — the material test belongs to the
        // NEIGHBOUR, and that is `cull` above.
        for (f = 0; f < 6; f++) if ((geoMask >> OWN_FACE[f]) & 1) mf |= 1 << f;
        faceCull[s] = mf;

        // --- solid ------------------------------------------------------------------------
        var shp = R.shapeOf[s];
        solid[s] = (R.shapeOff[shp + 1] - R.shapeOff[shp]) > 0 ? 1 : 0;
        replaceable[s] = bReplaceable;

        // --- render layer -----------------------------------------------------------------
        // translucent by the Java list; otherwise the worst alpha class of any tile the state
        // actually draws; otherwise opaque.
        if (bTrans) layer[s] = CFG.LAYER_TRANSLUCENT;
        else {
          var worst = 0;
          if (geom[s] === SR.GEOM_CUBE && onlyPart >= 0) {
            for (f = 0; f < 6; f++) {
              var al = alphaOf(partTiles[onlyPart * 6 + f]);
              if (al > worst) worst = al;
            }
          } else if (quads) {
            for (var g2 = 0; g2 < groups; g2++) {
              var gg2 = R.stGroupOff[v] + g2;
              for (var a2 = R.grpAltOff[gg2]; a2 < R.grpAltOff[gg2 + 1]; a2++) {
                var p2 = R.altPart[a2];
                for (var q2 = R.partOff[p2]; q2 < R.partOff[p2 + 1]; q2++) {
                  var al2 = alphaOf(R.qTile[q2]);
                  if (al2 > worst) worst = al2;
                }
              }
            }
          }
          layer[s] = worst === 2 ? CFG.LAYER_TRANSLUCENT
                   : worst === 1 ? CFG.LAYER_CUTOUT : CFG.LAYER_OPAQUE;
        }
      }
    }

    // fill the air table by NAME, so a block added to the registry is picked up rather than
    // needing this list edited. State 0 is air by construction (D-103) and is included anyway.
    isAir[0] = 1;
    for (var ab = 0; ab < R.blockCount; ab++) {
      var an = R.names[ab];
      if (an !== 'air' && an !== 'cave_air' && an !== 'void_air') continue;
      for (var as = R.realFirst[ab]; as < R.realFirst[ab + 1]; as++) isAir[as] = 1;
    }
    SR.count = n;
    /**
     * ⚠ `opaqueBase` — THE OPACITY TABLE AS BUILT, WHICH NOTHING EVER MUTATES (D-197).
     *
     * `SR.opaque` is a RENDERING table and `setFastLeaves` writes to it: fast leaves make a
     * leaf block opaque so the mesher culls through it. The support predicates below used to
     * read `SR.opaque`, which made a GRAPHICS SETTING AN INPUT TO WORLDGEN — the same seed grew
     * 2,050 plants with fast leaves and 1,993 without, `poppy ON oak_leaves` among them. The
     * fix is not to remember to snapshot at the right moment; it is for the rule to read a
     * table the renderer cannot reach. 20 KB, copied once.
     */
    SR.opaqueBase = new Uint8Array(opaque);
    SR.leafStates = null;
    SR.fastLeaves = false;
    /**
     * ⚠ D-440 — THE SECTION-VISIBILITY FLOOD'S OPACITY TEST, SEPARATE FROM `SR.opaque`. Queue
     * row 0 item 4: a block under a cactus vanished at distance. `SR.opaque` is MATERIAL
     * opacity (does the texture read as solid) and is the right test for the mesher's per-FACE
     * cull, which ANDs it with the geometric `SR.cull` mask — a cactus's inset shape still
     * exposes its neighbour's face there. `M.visibility` in 05_mesher.js (the Minecraft
     * chunk-visibility graph, one flood per section) had no such geometric AND: it read
     * `SR.opaque` alone, so ANY opaque-MATERIAL block that is not a full cube — cactus first
     * found, but the same class covers every inset model (fences, walls, slabs, stairs, carpets,
     * flower pots, …) — blocked the flood exactly like a wall of stone, hiding whole sections
     * behind it once the frustum-vs-occlusion flood culled them. `SR.visOpaque` is vanilla's own
     * test for this graph: `solidRender` — `canOcclude() && the outline is a full cube` (D-350),
     * already built for the mushroom rule. Precomputed once per state so the flood stays a table
     * lookup; see `SR.solidRender` above for the definition it mirrors.
     */
    SR.visOpaque = new Uint8Array(n);
    for (var vo = 0; vo < n; vo++) SR.visOpaque[vo] = SR.solidRender(vo) ? 1 : 0;
    SR.ready = true;
    // ⚠ D-346 — the two blocks whose SUPPORT shape is not their collision shape, resolved once,
    // by name, here rather than looked up per query. `soul_sand` is the one that matters for
    // placement (it supports a full block's worth despite sinking you); snow's per-layer support
    // shape is handled by the snow rule itself, which reads its layer count directly.
    SR.soulSandBlock = R.index && R.index.soul_sand !== undefined ? R.index.soul_sand : -1;
    if (SR.soulSandBlock < 0) {
      for (var bi = 0; bi < R.blockCount; bi++) if (R.names[bi] === 'soul_sand') { SR.soulSandBlock = bi; break; }
    }
    SR.emissionFixed = fillEmission();            // per STATE, not per block (#356)
    SR.leavesBlocks = new Uint8Array(R.blockCount);   // LeavesBlock.getSidesShape is empty (#353)
    for (var lb = 0; lb < R.blockCount; lb++) if (/_leaves$/.test(R.names[lb])) SR.leavesBlocks[lb] = 1;
    SR.snowBlock = -1;
    for (var sb = 0; sb < R.blockCount; sb++) if (R.names[sb] === 'snow') { SR.snowBlock = sb; break; }
    // #2330: a snow layer below 8 is not a full cube (collision (layers-1)*2px), so as a FLOOR/CEILING it is not
    // "opaque" either; opaque itself stays 1 for the mesher (cullpairaudit covers the face rules).
    if (SR.snowBlock >= 0 && R.PROP.layers !== undefined)
      for (var ls = R.realFirst[SR.snowBlock]; ls < R.realFirst[SR.snowBlock + 1]; ls++)
        if (R.valueNames[SR.propValue(ls, R.PROP.layers)] !== '8') SR.opaqueBase[ls] = 0;
    SR.waterloggedStates = fillWaterlogged();     // needs SR.ready and the placement table (D-168)
    SR.fillFluids();                              // needs propValue (#1263)
    SR.fillLightOpacity(xtra.sided);              // needs SR.count and propValue (#357)
    SR.fillLuminance(xtra.luminance);             // per-STATE emission (#406)
    return SR;
  };

  // ── fast leaves (D-93) ──────────────────────────────────────────────────────────────────
  // Vanilla's "fast graphics" leaves, and one of the largest single wins available on a weak
  // machine. FANCY: leaves are cutout, self-culling, and every leaf on the outside of a tree
  // runs an alpha test the GPU cannot early-Z away — a forest is the worst frame in the game.
  // FAST: leaves become fully opaque and occlude, so the mesher culls every face between a leaf
  // and anything solid, a canopy collapses to its silhouette, and the cutout pass empties.
  //
  // Light attenuation is deliberately NOT touched, so a forest floor is lit the same either way
  // and the two modes cannot produce different lighting.
  //
  // ⚠ This mutates tables both threads share, so it must be called with the same argument on
  // the main thread and in every worker — Mesher.setOptions does that — and it invalidates
  // every mesh. Before session 2 the equivalent lived in src/02_blocks.js and edited a
  // 49-entry table; the mask the mesher culled with was derived from it and had to be
  // invalidated by hand, which is a bug gencheck found once already. Here the cull mask is
  // written directly, so there is nothing to invalidate.
  SR.fastLeaves = false;
  SR.leafStates = null;

  SR.setFastLeaves = function (on) {
    on = !!on;
    if (!SR.ready) return SR.fastLeaves;
    if (SR.leafStates === null) {
      var R = NS.Reg, list = [];
      for (var b = 0; b < R.blockCount; b++) {
        var n = R.names[b];
        if (n.length > 7 && n.lastIndexOf('_leaves') === n.length - 7) {
          for (var s = R.realFirst[b]; s < R.realFirst[b + 1]; s++) list.push(s);
        }
      }
      SR.leafStates = list;
      SR.leafCull = new Uint8Array(list.length);      // the geometric mask, kept for the ON case
      SR.leafLayer = new Uint8Array(list.length);     // and the fancy layer, kept for the OFF case
      for (var k = 0; k < list.length; k++) {
        SR.leafCull[k] = SR.faceCull[list[k]];
        SR.leafLayer[k] = SR.layer[list[k]];
      }
    }
    if (SR.fastLeaves === on) return on;
    SR.fastLeaves = on;
    for (var j = 0; j < SR.leafStates.length; j++) {
      var st = SR.leafStates[j];
      SR.opaque[st] = on ? 1 : 0;
      SR.layer[st] = on ? NS.CFG.LAYER_OPAQUE : SR.leafLayer[j];
      SR.cull[st] = on ? SR.leafCull[j] : 0;
      // D-178: never 1. Fast leaves culls through `SR.cull` above, exactly as vanilla's
      // solid-render path does; fancy leaves must emit the face between two leaf blocks.
      SR.selfCull[st] = 0;
    }
    return on;
  };

  /** name of the block a state belongs to. Debug and tests only — allocates a string. */
  SR.name = function (state) {
    var R = NS.Reg;
    return (SR.ready && R && R.ready) ? R.names[SR.block[state]] : '?';
  };

  /**
   * stateOf(blockName) -> the block's DEFAULT real state, or 0 (air) if it does not exist.
   * This is the bridge worldgen and the HUD use: they name blocks, the world stores states.
   * Not on any hot path — call it once at init and keep the number.
   */
  SR.stateOf = function (name) {
    var R = NS.Reg;
    if (!R || !R.ready) return 0;
    var b = R.id[name];
    // The registry is keyed without the namespace, but the worldgen data always carries one.
    // Accepting both here is one line and removes a whole class of "returned air" bug from
    // every caller that reads Mojang's files.
    if (b === undefined && name.lastIndexOf('minecraft:', 0) === 0) b = R.id[name.slice(10)];
    if (b === undefined) return 0;
    return R.realFirst[b] + R.defaultState[b];
  };

  /**
   * withProps(blockName, props) -> the real state with those property values, or the default.
   * Vanilla state ordering: properties in declaration order, the LAST one varying fastest,
   * and booleans enumerating as [true, false]. The registry does not carry property NAMES at
   * runtime (they are build-time only, and 900 blocks of them is 40 KB nobody needs), so this
   * takes a LOCAL STATE INDEX rather than a property map. Kept as the one place that knows
   * `real = realFirst[block] + local`, so the arithmetic is not spread around.
   */
  SR.withLocal = function (name, local) {
    var R = NS.Reg;
    if (!R || !R.ready) return 0;
    var b = R.id[name];
    if (b === undefined && name.lastIndexOf('minecraft:', 0) === 0) b = R.id[name.slice(10)];
    if (b === undefined) return 0;
    var lo = R.realFirst[b], hi = R.realFirst[b + 1];
    var s = lo + (local | 0);
    return (s >= lo && s < hi) ? s : lo + R.defaultState[b];
  };

  /**
   * The generic half of `waterIn` (D-168): every state whose `waterlogged` property is true.
   * Run after the placement table is decoded, because that is what knows where the property is.
   * Called from `SR.init` once the per-state loop has filled the named list's half.
   */
  function fillWaterlogged() {
    var R = NS.Reg;
    if (!R || !R.PROP || R.PROP.waterlogged === undefined) return 0;
    var pid = R.PROP.waterlogged, vTrue = R.PVAL['true'], n = 0;
    for (var st = 1; st < SR.count; st++) {
      if (SR.waterIn[st]) continue;
      if (SR.propValue(st, pid) === vTrue) { SR.waterIn[st] = 1; n++; }
    }
    return n;
  }
  SR.fillWaterlogged = fillWaterlogged;

  /**
   * #1263 — what the fluid renderer needs per state. `fluidKind` 1 water / 2 lava is vanilla's
   * `getFluidState().getFluid()` (the water block, plus everything `waterIn` says holds water);
   * `fluidAmt` is `FluidState.getAmount()` (`level` 0 = source 8, 1..7 flowing 8-level, 8..15
   * falling 8; every other water-holder is a still source, 8); `fluidCell` marks the two blocks the
   * mesher draws itself with per-corner heights (waterlogged blocks keep their model).
   */
  SR.fillFluids = function () {
    var R = NS.Reg, n = SR.count;
    var kind = SR.fluidKind = new Uint8Array(n), amt = SR.fluidAmt = new Uint8Array(n);
    var cell = SR.fluidCell = new Uint8Array(n);
    var lvl = R.PROP && R.PROP.level, wb = R.id.water, lb = R.id.lava;
    for (var st = 1; st < n; st++) {
      var b = SR.block[st];
      if (b === wb || b === lb) {
        var v = lvl === undefined ? -1 : SR.propValue(st, lvl), l = v < 0 ? 0 : +R.valueNames[v];
        kind[st] = b === wb ? 1 : 2; amt[st] = l >= 8 ? 8 : 8 - l; cell[st] = 1;
      } else if (SR.waterIn[st]) { kind[st] = 1; amt[st] = 8; }
    }
    return cell;
  };

  /**
   * Block-light emission is a per-STATE function in vanilla (Blocks.java luminance lambdas), but the
   * dataset carries one number per block: the default state's. This overwrites the states whose
   * emission depends on a property. Returns how many states it wrote.
   */
  var LIT_EMIT = { furnace: 13, smoker: 13, blast_furnace: 13, redstone_ore: 9, deepslate_redstone_ore: 9,
    redstone_torch: 7, redstone_wall_torch: 7, redstone_lamp: 15, campfire: 15, soul_campfire: 10 };
  function fillEmission() {
    var R = NS.Reg;
    if (!R || !R.PROP || !R.valueNames) return 0;
    var P = R.PROP, T = R.PVAL['true'], n = 0;
    function pv(st, name) {
      var id = P[name];
      if (id === undefined) return 0;
      var v = SR.propValue(st, id);
      return v < 0 ? 0 : v;
    }
    function pnum(st, name) { var v = pv(st, name); return +R.valueNames[v] || 0; }
    function pbool(st, name) { return P[name] !== undefined && SR.propValue(st, P[name]) === T; }
    for (var b = 0; b < R.blockCount; b++) {
      var nm = R.names[b], fn = null;
      if (LIT_EMIT[nm] !== undefined) { var lv = LIT_EMIT[nm]; fn = function (st) { return pbool(st, 'lit') ? lv : 0; }; }
      else if (nm === 'candle' || /_candle$/.test(nm)) fn = function (st) { return pbool(st, 'lit') ? 3 * pnum(st, 'candles') : 0; };
      else if (/_candle_cake$/.test(nm) || nm === 'candle_cake') fn = function (st) { return pbool(st, 'lit') ? 3 : 0; };
      else if (nm === 'sea_pickle') fn = function (st) { return pbool(st, 'waterlogged') ? 3 + 3 * pnum(st, 'pickles') : 0; };
      else if (nm === 'respawn_anchor') fn = function (st) { return Math.floor(pnum(st, 'charges') / 4 * 15); };
      else if (nm === 'light') fn = function (st) { return pnum(st, 'level'); };
      else if (nm === 'cave_vines' || nm === 'cave_vines_plant') fn = function (st) { return pbool(st, 'berries') ? 14 : 0; };
      else if (nm === 'glow_lichen') fn = function (st) {
        return (pbool(st, 'north') || pbool(st, 'east') || pbool(st, 'south') || pbool(st, 'west') || pbool(st, 'up') || pbool(st, 'down')) ? 7 : 0;
      };
      if (!fn) continue;
      for (var st = R.realFirst[b]; st < R.realFirst[b + 1]; st++) { SR.emit[st] = fn(st); n++; }
    }
    return n;
  }
  SR.fillEmission = fillEmission;
  /**
   * #357 — vanilla's light opacity is per STATE, and the face-shape rule needs a mask per state.
   * `atten` above is the block's DEFAULT-state value (the pc `filterLight`); this corrects the states
   * whose own opacity differs, from `AbstractBlock.getOpacity`: `isOpaqueFullCube ? 15 :
   * (isTranslucent ? 0 : 1)`, `Block.isTranslucent` = `!fullCube && fluid empty`.
   *   - slab type=double and snow layers=8 are full cubes: 15 (SlabBlock:45, SnowBlock.LAYERS_TO_SHAPE[8]).
   *   - a waterlogged state has a fluid, so it is never translucent: at least 1.
   *   - a block whose DEFAULT is waterlogged (sea_pickle, conduit) has its dry states at 0.
   * `SR.sideMask[state]` is `ChunkLightProvider.getStateForLighting`'s real shape: for a state that is
   * opaque AND hasSidedTransparency (`sided`, tools/golden/sided-light-1.18.2.tsv) the 6-bit mask of
   * faces its culling shape covers completely (Reg.occlusion), else 0 (= an empty shape). Only a
   * FULL face is counted; vanilla's union of two partial faces (two stairs' L-shaped sides) is not.
   */
  SR.fillLightOpacity = function (sided) {
    var R = NS.Reg, n = SR.count, st;
    SR.sideMask = new Uint8Array(n);
    if (!R || !R.PROP) return;
    var pWl = R.PROP.waterlogged, pType = R.PROP.type, pLay = R.PROP.layers, pExt = R.PROP.extended;
    var vTrue = R.PVAL['true'], vDouble = R.PVAL['double'];
    for (st = 1; st < n; st++) {
      var b = SR.block[st], name = R.names[b];
      if (pType !== undefined && vDouble !== undefined && SR.propValue(st, pType) === vDouble &&
          name.slice(-5) === '_slab') { SR.atten[st] = 15; SR.lightSolid[st] = 1; continue; }
      if (name === 'snow' && pLay !== undefined && R.valueNames[SR.propValue(st, pLay)] === '8') {
        SR.atten[st] = 15; SR.lightSolid[st] = 1; continue;
      }
      if (pWl !== undefined && SR.atten[st] < 15) {
        var wl = SR.propValue(st, pWl);
        if (wl === vTrue) { if (SR.atten[st] < 1) SR.atten[st] = 1; }
        else if (wl >= 0) {
          var def = R.realFirst[b] + R.defaultState[b];
          if (SR.propValue(def, pWl) === vTrue && SR.atten[st] === 1) SR.atten[st] = 0;
        }
      }
    }
    if (!sided) return;
    for (st = 1; st < n; st++) {
      var rule = sided[R.names[SR.block[st]]];
      if (!rule || SR.canOcclude[SR.block[st]] !== 1) continue;
      if (rule === 'extended') { if (pExt === undefined || SR.propValue(st, pExt) !== vTrue) continue; }
      else if (rule === 'notdouble') { if (pType !== undefined && SR.propValue(st, pType) === vDouble) continue; }
      SR.sideMask[st] = R.occlusion[R.toVisual[st]] & 63;
    }
  };

  /**
   * #406 — vanilla's `getLuminance` is per STATE (a `.luminance(lambda)` on the block settings); `emit` above is the
   * block's pc `emitLight` copied to every state. `lum` is tools/golden/luminance-1.18.2.tsv, block -> [rule, param]
   * (tools/extract-luminance.mjs, .decomp Blocks.java); every listed block's states are recomputed from their own
   * properties. Blocks not listed keep their (zero) block value. A missing table leaves the per-block values.
   */
  SR.fillLuminance = function (lum) {
    var R = NS.Reg, n = SR.count, st;
    if (!lum || !R || !R.PROP) return;
    var P = R.PROP, VN = R.valueNames;
    var pLit = P.lit, pCandles = P.candles, pLevel = P.level, pPick = P.pickles, pWl = P.waterlogged,
        pCh = P.charges, pBer = P.berries, dirs = [P.north, P.east, P.south, P.west, P.up, P.down];
    var vTrue = R.PVAL['true'];
    var num = function (state, pid) { return pid === undefined ? 0 : (+VN[SR.propValue(state, pid)] | 0); };
    var isTrue = function (state, pid) { return pid !== undefined && SR.propValue(state, pid) === vTrue; };
    var byBlock = new Array(R.blockCount);
    for (var b = 0; b < R.blockCount; b++) byBlock[b] = lum[R.names[b]] || null;
    for (st = 1; st < n; st++) {
      var r = byBlock[SR.block[st]];
      if (!r) continue;
      var rule = r[0], k = r[1] | 0, e = 0;
      switch (rule) {
        case 'const': e = k; break;
        case 'lit': e = isTrue(st, pLit) ? k : 0; break;
        case 'candles': e = isTrue(st, pLit) ? 3 * num(st, pCandles) : 0; break;
        case 'level': e = num(st, pLevel); break;
        case 'pickle': e = isTrue(st, pWl) ? 3 + 3 * num(st, pPick) : 0; break;
        case 'anchor': e = Math.floor(num(st, pCh) / 4 * k); break;
        case 'berries': e = isTrue(st, pBer) ? k : 0; break;
        case 'lichen':
          for (var d = 0; d < 6; d++) if (isTrue(st, dirs[d])) { e = k; break; }
          break;
      }
      SR.emit[st] = Math.min(15, e);
    }
  };

  /**
   * withProp(state, propId, valueId) -> the same block's state with that one property changed,
   * or `state` unchanged when the block has no such property or the property has no such value.
   *
   * This is the primitive placement is built on (D-157). A local state is a mixed-radix number
   * over the block's properties in declaration order, last varying fastest, so changing one
   * property is: read that digit out with the property's stride, and write the new one back.
   * Nothing else in the state moves — a stair keeps its `half` and its `waterlogged` when its
   * `facing` changes, which is what makes this composable.
   *
   * Returns `state` rather than throwing on a miss BY DESIGN: placement asks every block for
   * `facing` and most of them do not have one, so a miss is the common case, not an error.
   */
  SR.withProp = function (state, propId, valueId) {
    var R = NS.Reg;
    if (!R || !R.propFirst || state <= 0 || state >= SR.count) return state;
    var b = SR.block[state];
    var lo = R.realFirst[b], local = state - lo;
    for (var k = R.propFirst[b]; k < R.propFirst[b + 1]; k++) {
      if (R.propId[k] !== propId) continue;
      var stride = R.propStride[k], n = R.propValN[k], off = R.propValOff[k];
      for (var v = 0; v < n; v++) {
        if (R.propVals[off + v] !== valueId) continue;
        var cur = ((local / stride) | 0) % n;
        return lo + local + (v - cur) * stride;
      }
      return state;                                   // has the property, not that value
    }
    return state;
  };

  /**
   * canBeReplacedBy(state, held, face, hitY, replacingClicked) -> may a placement overwrite it?
   *
   * ⚠ D-263. Vanilla asks `BlockState.canBeReplaced(BlockPlaceContext)`, whose DEFAULT is
   * `Material.isReplaceable()` — `SR.replaceable` above, 28 blocks of 898, out of the jar's
   * bytecode. Seven block classes override it in Java, and every one of them is a STACKING rule:
   * a second snow layer, a second slab, a fourth sea pickle. Those are the reason the answer
   * cannot be a table lookup alone, and they are why placing a slab on a slab makes a double
   * slab in the real game instead of putting one above the other.
   *
   *   snow          layers < 8 and the same item in hand -> true (UP only when replacing the
   *                 clicked block); OTHERWISE only a SINGLE layer is replaceable. ⚠ this half is
   *                 a real over-replace in the old code: every one of snow's eight states was
   *                 overwritable, so a block placed against deep snow deleted all of it.
   *   slab          the same slab, not already double: UP onto a bottom slab, DOWN onto a top
   *                 slab, or a horizontal face on the half the click landed in.
   *   sea_pickle    the same item and fewer than 4 pickles.
   *   turtle_egg    the same item and fewer than 4 eggs.
   *   candle        the same item and fewer than 4 candles.
   *   scaffolding   the same item, always.
   *   vine /        MultifaceBlock: the same item REFUSES, so a second vine goes on the next
   *   glow_lichen   face instead of replacing the one you clicked. The only override that
   *                 makes a block LESS replaceable than its material.
   *
   * `face` is ARCH §3 numbering (2 = +Y = UP, 3 = -Y = DOWN); `hitY` is the hit point's world Y;
   * `replacingClicked` is vanilla's `replacingClickedOnBlock()` — true when the cell under
   * consideration IS the one the crosshair is on, false when it is the neighbour.
   * `held` is a real state, or 0 for an empty hand.
   */
  SR.canBeReplacedBy = function (state, held, face, hitY, replacingClicked) {
    if (state === 0) return true;                       // air, and the fast path
    if (state < 0 || state >= SR.count) return false;
    var R = NS.Reg;
    if (!R || !R.PROP) return SR.replaceable[state] === 1;
    var P = R.PROP, b = SR.block[state];
    var base = SR.replaceable[state] === 1;
    var same = held > 0 && SR.block[held] === b;
    var nm = R.names[b];
    var num = function (prop) {
      var v = SR.propValue(state, P[prop]);
      return v < 0 ? -1 : (+R.valueNames[v]);
    };

    if (nm === 'snow') {
      var layers = num('layers');
      if (same && layers < 8) return replacingClicked ? face === 2 : true;
      return layers === 1;
    }
    if (nm === 'scaffolding') return same;
    if (nm === 'sea_pickle') return (same && num('pickles') < 4) || base;
    if (nm === 'turtle_egg') return (same && num('eggs') < 4) || base;
    if (nm === 'candle' || (nm.length > 8 && nm.slice(-8) === '_candle')) {
      return (same && num('candles') < 4) || base;
    }
    if (nm === 'vine' || nm === 'glow_lichen') return same ? false : base;
    if (nm.length > 5 && nm.slice(-5) === '_slab') {
      if (!same) return false;
      var t = SR.propValue(state, P.type);
      var tn = t < 0 ? '' : R.valueNames[t];
      if (tn === 'double' || tn === '') return false;
      if (!replacingClicked) return true;
      var upper = (hitY - Math.floor(hitY)) > 0.5;
      var horizontal = (face !== 2 && face !== 3);
      if (tn === 'bottom') return face === 2 || (upper && horizontal);
      return face === 3 || (!upper && horizontal);
    }
    return base;
  };

  /** propValue(state, propId) -> the value id this state carries, or -1 if it has no such property. */
  SR.propValue = function (state, propId) {
    var R = NS.Reg;
    if (!R || !R.propFirst || state <= 0 || state >= SR.count) return -1;
    var b = SR.block[state], local = state - R.realFirst[b];
    for (var k = R.propFirst[b]; k < R.propFirst[b + 1]; k++) {
      if (R.propId[k] !== propId) continue;
      return R.propVals[R.propValOff[k] + (((local / R.propStride[k]) | 0) % R.propValN[k])];
    }
    return -1;
  };

  /**
   * The support PREDICATES, in one place (D-169).
   *
   * ⚠ There were three copies of these rules: `Features.supported` for worldgen,
   * `World.canSurvive` for edits, and a third inside `tools/floatcheck.mjs` that walked generated
   * chunks and applied its OWN version. D-164 had just finished proving what that costs —
   * `lightcheck` failed to catch D-156 because it tested a table and an adapter it had built
   * itself rather than the one the game calls — and floatcheck was the same shape: it kept the
   * pre-D-165 floor rule and would have passed a world full of plants growing out of tree
   * canopies. A rule with three implementations is a rule with three answers.
   *
   * These take the NEIGHBOUR'S STATE rather than coordinates, so they are pure and every caller
   * can use them whatever it is walking — a scratch buffer, the live world, or a generated column.
   */
  /**
   * ── THE PLACEMENT SETS (D-197) ────────────────────────────────────────────────────────
   *
   * ⚠ "OPAQUE" IS NOT A PLACEMENT RULE, IT IS A CLASS OF THEM, AND IT IS FAR TOO WIDE.
   * `floorOk` used to accept any opaque block under any floor-class block. Vanilla asks the
   * BLOCK: `BushBlock.mayPlaceOn` is `#minecraft:dirt` or farmland, `DeadBushBlock`'s is sand,
   * terracotta or dirt, `SugarCaneBlock`'s is sand or dirt. Measured in 81 chunks at seed 1337:
   * 891 grass on SAND, 216 on GRAVEL, 2 on stone, 21 tall_grass on sand, plus poppies,
   * dandelions and lilies of the valley on both. Vanilla generates none of them.
   *
   * The sets come from vanilla's own block tags, flattened by `tools/taglib.mjs` and shipped in
   * `worldgen.bin` (`tools/pack-worldgen.mjs`), because worldgen asks this question on the
   * WORKERS and `src/02f_tags.js` is main-thread only. Three tables, built here once:
   *
   *   placeRule[state]        the rule this block obeys, or 255 for "no set — opaque, as before"
   *   placeSet[rule][block]   1 if that block may be the floor.  Indexed by BLOCK, not state:
   *                           every state of grass_block is grass_block, and 900 bytes a rule
   *                           beats 20,344.
   *   placeAnyOpaque[rule]    mushrooms, whose vanilla rule is the tag OR any solid-render face
   *
   * ⚠ Blocks with NO set keep the opaque test exactly as it was: torches, signs, banners, coral
   * fans, the standing halves of D-167, the crops, the nether fungi, `moss_carpet`. Narrowing a
   * block whose rule this table does not state would delete it from the world, and that mistake
   * already has two decision numbers (D-152, D-178).
   */
  SR.placeRule = null;
  SR.placeSet = null;
  SR.placeAnyOpaque = null;
  SR.placeNames = null;

  /**
   * THE TAGS THE SURVIVAL RULES ASK, ANSWERED BY BLOCK (#19). `02f_tags.js` is main-only, so a chunk
   * worker cannot ask `Tags.stateIn('dirt', s)`; `worldgen.bin` carries the eleven tags
   * `NS.Survive`'s rules name (`tools/pack-worldgen.mjs` RULE_TAGS) and this indexes them by BLOCK.
   * -1 = "not one of the eleven", the same "cannot tell" the survival level already speaks.
   */
  SR.ruleTagSet = null;
  SR.inRuleTag = function (name, state) {
    var set = SR.ruleTagSet && SR.ruleTagSet[name];
    if (!set) return -1;
    return set[SR.block[state]];
  };
  function buildRuleTags() {
    var WG = NS.WG, R = NS.Reg, tags = Object.create(null), n = 0;
    var names = ['dirt', 'sand', 'terracotta', 'nylium', 'mushroom_grow_block', 'bamboo_plantable_on',
      'jungle_logs', 'soul_fire_base_blocks', 'big_dripleaf_placeable', 'small_dripleaf_placeable', 'fence_gates'];
    for (var i = 0; i < names.length; i++) {
      var mem = WG.ruleTag ? WG.ruleTag(names[i]) : undefined;
      if (!mem) continue;
      var set = new Uint8Array(R.blockCount);
      for (var m = 0; m < mem.length; m++) { var b = R.id[mem[m]]; if (b !== undefined) set[b] = 1; }
      tags[names[i]] = set; n++;
    }
    SR.ruleTagSet = n ? tags : null;
    return n;
  }

  SR.buildPlacement = function () {
    var WG = NS.WG, R = NS.Reg;
    if (!SR.ready || !R || !R.ready || !WG || !WG.ready) return 0;
    buildRuleTags();
    var names = WG.placementRules();
    if (!names.length) return 0;
    if (names.length > 254) return 0;                 // 255 is the "no set" sentinel
    var rule = new Uint8Array(SR.count);
    for (var i = 0; i < SR.count; i++) rule[i] = 255;
    var sets = new Array(names.length), anyOp = new Uint8Array(names.length), placed = 0;
    for (var r = 0; r < names.length; r++) {
      var mem = WG.placementFloors(names[r]) || [], set = new Uint8Array(R.blockCount);
      for (var m = 0; m < mem.length; m++) {
        var mb = R.id[mem[m]];
        if (mb !== undefined) set[mb] = 1;
      }
      sets[r] = set;
      anyOp[r] = WG.placementAnyOpaque(names[r]) ? 1 : 0;
      var users = WG.placementBlocks(names[r]) || [];
      for (var u = 0; u < users.length; u++) {
        var ub = R.id[users[u]];
        if (ub === undefined) continue;               // a block this build does not have
        for (var st = R.realFirst[ub]; st < R.realFirst[ub + 1]; st++) rule[st] = r;
        placed++;
      }
    }
    SR.placeNames = names;
    SR.placeSet = sets;
    SR.placeAnyOpaque = anyOp;
    SR.placeRule = rule;
    SR.placeBlocks = placed;
    return placed;
  };

  /** placementRule(state) -> the rule NAME this state obeys, or '' when it has no set. Tests. */
  SR.placementRule = function (state) {
    if (!SR.placeRule || state <= 0 || state >= SR.count) return '';
    var r = SR.placeRule[state];
    return r === 255 ? '' : SR.placeNames[r];
  };

  SR.floorOk = function (st, below) {
    if (below === 0) return false;
    // ⚠ the block's OWN rule first, when it has one (D-197)
    if (SR.placeRule !== null) {
      var r = SR.placeRule[st];
      if (r !== 255) {
        if (SR.placeSet[r][SR.block[below]] === 1) return true;
        if (SR.placeAnyOpaque[r] === 1 && SR.opaqueBase[below] === 1) return true;
        return SR.attachOk(st, below);
      }
    }
    // ⚠ `opaqueBase`, NOT `opaque`: `setFastLeaves` writes the second one, and a rendering
    // table must never be an input to worldgen (D-197).
    if (SR.opaqueBase[below] === 1) return true;
    // the two exceptions: a block standing on ITSELF where that is a real thing (D-165), and a
    // growing plant standing on the OTHER HALF of itself (D-233)
    return SR.attachOk(st, below);
  };
  SR.ceilingOk = function (st, above) {
    if (above === 0) return false;
    if (SR.opaqueBase[above] === 1) return true;
    // ⚠ THE SAME TAIL AS `floorOk`, and the reason a growing plant keeps its head (D-233)
    return SR.attachOk(st, above);
  };
  SR.anyFaceOk = function (b) { return b !== 0 && SR.solid[b] === 1; };

  /**
   * fullCollision(state) -> is this state's COLLISION shape one full 1x1x1 box? (D-332)
   *
   * ⚠ NOT `solid`, AND NOT `opaqueBase`. `solid` is "has any collision at all", which is true of
   * a fence post and a slab; `opaqueBase` is a RENDERING fact, which is false of glass. Vanilla's
   * `BlockState.isCollisionShapeFullBlock` is neither — a glass block is a full collision block
   * and a fence is not — and it is what `DoorBlock.getHinge` counts on either side of a door to
   * decide which way it swings. Read straight off the collision boxes, which are already here in
   * 1/1024 of a block, so nothing new is stored and nothing is approximated.
   */
  SR.fullCollision = function (state) {
    var R = NS.Reg;
    if (!R || !R.ready || state <= 0 || state >= SR.count) return false;
    var shp = R.shapeOf[state];
    var a = R.shapeOff[shp], b = R.shapeOff[shp + 1];
    if (b - a !== 1) return false;                   // no boxes, or more than one
    var o = a * 6, S = R.shapeBox;
    return S[o] === 0 && S[o + 1] === 0 && S[o + 2] === 0 &&
           S[o + 3] === 1024 && S[o + 4] === 1024 && S[o + 5] === 1024;
  };

  /**
   * faceCovers(state, dir, x0, y0, x1, y1) -> does this state's COLLISION shape, projected onto
   * face `dir`, cover the whole of the given rectangle?
   *
   * ⚠⚠ **THIS IS THE PRIMITIVE EVERY SUPPORT RULE IN VANILLA IS BUILT FROM, AND IT IS NOT ONE
   * RULE BUT THREE** (D-346). `Block.canSupportCenter` asks whether a small patch at the middle
   * of the face is covered; `isFaceSturdy(..., FULL)` asks whether the WHOLE face is;
   * `canSupportRigidBlock` asks a third question again. Writing "is it a full cube" in place of
   * any of them is the mistake that has to be avoided here: an upside-down slab supports a rail
   * and is not a full cube, and a fence supports a torch on top while covering only its middle.
   * So this file provides the GEOMETRY and the callers provide the rectangle — the rectangle
   * being a number the JAR owns, read by the referee, never typed here.
   *
   * ⚠ Coordinates are the collision boxes' own 1/1024 of a block, so nothing is rescaled and
   * nothing is approximated. `dir` is ARCH order: 0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z.
   *
   * ⚠ IT IS A UNION, NOT A SEARCH FOR ONE BOX THAT COVERS IT. A double slab, a snow layer at
   * eight, and every multipart block reach full coverage with several boxes and none of them
   * alone; asking "is there a box that covers the rect" answers no for a solid stack of them.
   * The union is done by coordinate compression — at most a few boxes per block, so the grid is
   * tiny — rather than by rasterising 1024x1024.
   */
  SR.faceCovers = function (state, dir, x0, y0, x1, y1) {
    var R = NS.Reg;
    if (!R || !R.ready || state <= 0 || state >= SR.count) return false;
    var shp = R.shapeOf[state];
    var a = R.shapeOff[shp], b = R.shapeOff[shp + 1];
    if (b === a) return false;                       // no collision at all
    var S = R.shapeBox;
    // the axis the face is on, and the two axes the face is drawn in
    var ax = dir >> 1;                               // 0 x, 1 y, 2 z
    var far = (dir & 1) === 0;                       // even dirs are the +ve side
    var u = ax === 0 ? 1 : 0, v = ax === 2 ? 1 : 2;  // (u, v) are the in-face axes
    var us = [], vs = [], i, o;
    var rects = [];
    for (i = a; i < b; i++) {
      o = i * 6;
      // only the boxes that actually REACH the face contribute to it
      var on = far ? S[o + 3 + ax] >= 1024 : S[o + ax] <= 0;
      if (!on) continue;
      var r = [S[o + u], S[o + v], S[o + 3 + u], S[o + 3 + v]];
      if (r[2] <= r[0] || r[3] <= r[1]) continue;
      rects.push(r);
      us.push(r[0], r[2]); vs.push(r[1], r[3]);
    }
    if (!rects.length) return false;
    us.push(x0, x1); vs.push(y0, y1);
    var uniq = function (arr) {
      arr.sort(function (p, q) { return p - q; });
      var out = [];
      for (var k = 0; k < arr.length; k++) if (!k || arr[k] !== arr[k - 1]) out.push(arr[k]);
      return out;
    };
    us = uniq(us); vs = uniq(vs);
    for (i = 0; i < us.length - 1; i++) {
      var cu0 = us[i], cu1 = us[i + 1];
      if (cu1 <= x0 || cu0 >= x1) continue;          // this column is outside the asked rect
      for (var j = 0; j < vs.length - 1; j++) {
        var cv0 = vs[j], cv1 = vs[j + 1];
        if (cv1 <= y0 || cv0 >= y1) continue;
        var covered = false;
        for (var k2 = 0; k2 < rects.length; k2++) {
          var q = rects[k2];
          if (q[0] <= cu0 && q[2] >= cu1 && q[1] <= cv0 && q[3] >= cv1) { covered = true; break; }
        }
        if (!covered) return false;
      }
    }
    return true;
  };

  /**
   * ── THE THREE SUPPORT TYPES (D-346) ───────────────────────────────────────────────────────
   *
   * ⚠⚠ **"IS IT SOLID" IS NOT ONE QUESTION.** Vanilla asks three, and which one a block asks
   * decides what you can build on what:
   *   FULL    the whole face is covered.                     A door needs this below it.
   *   CENTER  a 2x2-pixel patch at the middle of the face.   A torch or a lever needs this.
   *   RIGID   the outer two-pixel RIM of the face.           A rail or a repeater needs this.
   * A fence passes CENTER and fails FULL and RIGID, which is why a torch goes on a fence post and
   * a rail does not. Collapsing the three into "is it a full cube" breaks both directions at once.
   *
   * ⚠ THE NUMBERS COME OUT OF THE JAR. `tools/golden/cansurvive-1.18.2.tsv` carries CENTER's box
   * as 7,0,7..9,10,9 and RIGID's as a full block MINUS 2,0,2..14,16,14, read from the enum's own
   * three subclasses; `supportcheck` asserts these constants against that table so neither can
   * drift. In sixteenths x16 gives the 1/1024 units the collision boxes are already in.
   */
  SR.SUPPORT_FULL = 0;
  SR.SUPPORT_CENTER = 1;
  SR.SUPPORT_RIGID = 2;
  /** CENTER's patch, in 1/1024 of a block: x,z from 7/16 to 9/16. */
  SR.CENTER_RECT = [448, 448, 576, 576];
  /** RIGID's rim: everything outside x,z from 2/16 to 14/16. */
  SR.RIGID_INNER = [128, 128, 896, 896];

  /**
   * ⚠⚠ **AND THE SHAPE IT ASKS ABOUT IS NOT THE COLLISION SHAPE.** Vanilla has a separate
   * `getBlockSupportShape`, and exactly TWO blocks override it — the referee says so and it
   * overturned my own reading:
   *   soul_sand  returns a WHOLE BLOCK, though you sink into it. That is why redstone, rails and
   *              repeaters sit on soul sand: its collision box is 14/16 tall and its SUPPORT is
   *              a full cube. Using the collision shape here refuses all three, on a block
   *              players build on constantly.
   *   snow       returns the shape of the layer ABOVE its own, so a layer supports what stands
   *              on top of it rather than what would stand inside it.
   * Everything else uses its collision shape. Two names, from a table, rather than a guess about
   * which hollow blocks "feel" solid — cauldrons, composters and hoppers are NOT on this list,
   * and I had wrongly put them there before reading it.
   */
  /**
   * Does ANY collision box of `state` reach the face `dir` at all? (D-349)
   *
   * ⚠ THIS IS NOT `faceCovers` WITH A TINY RECTANGLE. Vanilla's sea pickle asks whether
   * `getCollisionShape().getFaceShape(UP)` is EMPTY — "is there anything there", not "is a
   * particular patch covered" — and a block with one box in a corner answers yes to the first
   * and no to the second.
   */
  SR.faceHasAny = function (state, dir) {
    var R = NS.Reg;
    if (!R || !R.ready || state <= 0 || state >= SR.count) return false;
    var shp = R.shapeOf[state], a = R.shapeOff[shp], b = R.shapeOff[shp + 1];
    if (b === a) return false;
    var S = R.shapeBox, ax = dir >> 1, far = (dir & 1) === 0, i, o;
    for (i = a; i < b; i++) {
      o = i * 6;
      if (far ? S[o + 3 + ax] >= 1024 : S[o + ax] <= 0) return true;
    }
    return false;
  };

  /**
   * `Block.isFaceFull(state.getShape(), dir)` — the WHOLE face covered, with NO support-shape
   * override (D-349).
   *
   * ⚠⚠ **THIS IS NOT `faceSturdy(state, dir, FULL)` AND THE DIFFERENCE IS SOUL SAND.** Vanilla's
   * vine and multiface rules read the block's own shape, not `getBlockSupportShape`, so the two
   * blocks that override the support shape answer these two questions DIFFERENTLY: soul sand
   * holds a rail on a face its collision box does not fill, and a vine does not hang on it.
   * Collapsing them would be a rule with two answers (D-314) wearing one name.
   */
  SR.faceFull = function (state, dir) {
    return SR.faceCovers(state, dir, 0, 0, 1024, 1024);
  };

  /**
   * Is this state's COLLISION shape exactly vanilla's `Shapes.block()` — one box, the whole cube?
   *
   * ⚠ ONE BOX, NOT "a union that adds up to one". Vanilla's own `isShapeFullBlock` compares
   * against the cached full-block shape, and every block whose shape IS the full cube in the jar
   * carries it as that one box. A union test would also accept a hollow shell of six thin slabs.
   */
  SR.fullCubeCollision = function (state) {
    var R = NS.Reg;
    if (!R || !R.ready || state <= 0 || state >= SR.count) return false;
    var shp = R.shapeOf[state], a = R.shapeOff[shp], b = R.shapeOff[shp + 1];
    if (b - a !== 1) return false;
    var S = R.shapeBox, o = a * 6;
    return S[o] === 0 && S[o + 1] === 0 && S[o + 2] === 0 &&
           S[o + 3] === 1024 && S[o + 4] === 1024 && S[o + 5] === 1024;
  };

  /**
   * Vanilla's `isSolidRender` — `canOcclude() && the OUTLINE shape is a full cube` (D-350).
   *
   * ⚠⚠ **THE OUTLINE, NOT THE COLLISION SHAPE, AND SOUL SAND IS WHY.** SoulSandBlock overrides
   * the collision shape — 14/16 tall, you sink into it — and leaves the outline alone, so
   * vanilla's outline is a whole cube and a mushroom grows on soul sand in the dark. This engine
   * ships COLLISION boxes, so the referee carries a per-block flag saying whether the block still
   * has vanilla's DEFAULT outline; when it does, the answer is yes without looking at a box.
   * ⚠ 255 means the referee could not name the block's class (built by a helper) and the
   * collision shape is used instead. `supportcheck` asserts that for every such block the two
   * answers agree, so the fallback is provably not deciding anything.
   */
  function R_snow8(state) { var R = NS.Reg; return R.valueNames[SR.propValue(state, R.PROP.layers)] === '8'; }
  SR.solidRender = function (state) {
    if (state <= 0) return false;
    var b = SR.block[state];
    if (SR.canOcclude[b] !== 1) return false;
    if (b === SR.snowBlock) return R_snow8(state);   // SnowBlock shape = layers*2px: only 8 is a whole cube
    if (SR.outlineFull[b] === 1) return true;
    if (SR.outlineFull[b] === 0) return SR.fullCubeCollision(state);
    return SR.fullCubeCollision(state);
  };

  SR.supportsWholeBlock = function (state) {
    var b = SR.block[state];
    return SR.soulSandBlock >= 0 && b === SR.soulSandBlock;
  };

  /**
   * faceSturdy(state, dir, type) -> can `state`'s face `dir` support the given kind of thing?
   * `dir` is ARCH order: 0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z.
   */
  SR.faceSturdy = function (state, dir, type) {
    if (state <= 0) return false;
    if (SR.supportsWholeBlock(state)) return true;      // soul sand: a full block, always
    var sb = SR.block[state];
    if (SR.leavesBlocks && SR.leavesBlocks[sb] === 1) return false;   // LeavesBlock: empty sides shape
    if (sb === SR.snowBlock) {
      // SnowBlock.getSidesShape = LAYERS_TO_SHAPE[layers] = the COLLISION shape of the next layer
      // (collision is [layers - 1]); layers 8 is a whole cube (#353).
      var R = NS.Reg, lp = R.PROP.layers, ly = SR.propValue(state, lp);
      if (ly < 0) return false;
      if (ly === R.PVAL['8']) return true;              // eight layers: a whole cube on every face
      for (var k = R.propFirst[sb]; k < R.propFirst[sb + 1]; k++) {
        if (R.propId[k] === lp) { state += R.propStride[k]; break; }   // values run 1..8: next layer
      }
    }
    if (type === SR.SUPPORT_CENTER) {
      var c = SR.CENTER_RECT;
      return SR.faceCovers(state, dir, c[0], c[1], c[2], c[3]);
    }
    if (type === SR.SUPPORT_RIGID) {
      // the RIM: four strips outside the inner box, all of which must be covered
      var q = SR.RIGID_INNER, W = 1024;
      return SR.faceCovers(state, dir, 0, 0, W, q[1]) &&
             SR.faceCovers(state, dir, 0, q[3], W, W) &&
             SR.faceCovers(state, dir, 0, q[1], q[0], q[3]) &&
             SR.faceCovers(state, dir, q[2], q[1], W, q[3]);
    }
    return SR.faceCovers(state, dir, 0, 0, 1024, 1024);
  };

  /**
   * stacksOnSelf(state) -> may this block stand on ANOTHER OF ITSELF? (D-165)
   *
   * ⚠ The floor support rule used to read "a solid block, OR any block that itself has a floor
   * rule", and the comment that justified it said the exception was there to keep the upper half
   * of a two-tall grass and the segments of a sugar cane. It is far too wide: it let a grass tuft
   * stand on a DIFFERENT plant, and a plant stand on a plant stand on a plant. Measured in 36
   * chunks: 7 plants standing on plants, `dead_bush on dead_bush` among them, which vanilla
   * never generates. Dan saw the towers from inside the game.
   *
   * The blocks that really do stack on themselves are two: a plant with an upper and a lower
   * HALF, which the placement table can be asked about directly, and the handful of segmented
   * plants vanilla implements one block at a time. The second group is a named list for the same
   * reason `02c`'s other two lists are named — the game's own data does not distinguish them,
   * and a wrong list should be a visible wrong list rather than a silent rule.
   */
  var STACKS = ['sugar_cane', 'cactus', 'bamboo', 'bamboo_sapling', 'kelp', 'kelp_plant',
                'twisting_vines', 'twisting_vines_plant', 'weeping_vines', 'weeping_vines_plant',
                'cave_vines', 'cave_vines_plant', 'big_dripleaf_stem', 'pitcher_crop'];
  /**
   * modelOffset(state, x, z, out) -> true when the block is drawn, selected and collided at a per-position
   * XZ(Y) offset, with the offset written to out[0..2] in blocks. ONE function for the mesher, the raycast,
   * the outline and the physics, so the stalk you see is the stalk you aim at (#4693).
   *
   * `AbstractBlock.AbstractBlockState.getModelOffset` + `MathHelper.hashCode(x, 0, z)`. Kinds, from the
   * `getOffsetType` overrides in .decomp: XZ = bamboo, bamboo_sapling, hanging_roots, the nether roots, nether_sprouts,
   * pointed_dripstone (max 0.125), every FlowerBlock and TallPlantBlock; XYZ = grass, fern, small_dripleaf (vertical x0.1).
   * Only bits 16..27 of the 64-bit hash are read, and those depend on the low 32 bits of its inputs, so int32 imul
   * is exact and no BigInt is needed.
   */
  var OFFSET_XZ = ['bamboo', 'bamboo_sapling', 'hanging_roots', 'crimson_roots', 'warped_roots', 'nether_sprouts',
    'pointed_dripstone', 'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip',
    'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'wither_rose', 'tall_grass',
    'large_fern', 'sunflower', 'lilac', 'rose_bush', 'peony'];
  var OFFSET_XYZ = ['grass', 'fern', 'small_dripleaf'];
  var offKind = null;
  var F02 = Math.fround(0.2), F01 = Math.fround(0.1);
  SR.modelOffset = function (state, x, z, out) {
    if (offKind === null) {
      var R = NS.Reg, k = new Uint8Array(R.names.length), i;
      for (i = 0; i < k.length; i++) k[i] = OFFSET_XYZ.indexOf(R.names[i]) >= 0 ? 2 : OFFSET_XZ.indexOf(R.names[i]) >= 0 ? 1 : 0;
      offKind = k;
    }
    var b = SR.block[state], kind = offKind[b];
    if (!kind) return false;
    var h = Math.imul(x, 3129871) ^ Math.imul(z, 116129781);
    var t = (Math.imul(Math.imul(h, h), 42317861) + Math.imul(h, 11)) | 0;
    var n = (t >>> 16) & 0xFFF;
    var m = NS.Reg.names[b] === 'pointed_dripstone' ? 0.125 : 0.25;
    var ox = (Math.fround((n & 15) / 15) - 0.5) * 0.5, oz = (Math.fround(((n >> 8) & 15) / 15) - 0.5) * 0.5;
    out[0] = ox < -m ? -m : ox > m ? m : ox;
    out[1] = kind === 2 ? (Math.fround(((n >> 4) & 15) / 15) - 1) * (NS.Reg.names[b] === 'small_dripleaf' ? F01 : F02) : 0;
    out[2] = oz < -m ? -m : oz > m ? m : oz;
    return true;
  };

  SR.stacksOnSelf = function (state) {
    var R = NS.Reg;
    if (!R || !R.ready || state <= 0 || state >= SR.count) return false;
    if (R.PROP && SR.propValue(state, R.PROP.half) >= 0) return true;   // a two-tall plant
    var n = R.names[SR.block[state]];
    for (var i = 0; i < STACKS.length; i++) if (n === STACKS[i]) return true;
    return false;
  };

  /**
   * ── A GROWING PLANT HANGS FROM ITS OWN BODY (D-233) ───────────────────────────────────
   *
   * ⚠ THE HEAD AND THE BODY OF A GROWING PLANT ARE DIFFERENT BLOCKS, and `stacksOnSelf` can only
   * ever answer "the same block". Vanilla's `GrowingPlantBlock.canSurvive` reads
   *
   *     canAttachTo(n) && (n.is(headBlock) || n.is(bodyBlock) || n.isFaceSturdy(growthDirection))
   *
   * so a `cave_vines` HEAD hangs quite happily under a `cave_vines_plant` BODY. Ours refused it,
   * and D-140's write-time test in `Features.supported` therefore threw every vine TIP away.
   * MEASURED against the golden 1.18.2 world at seed 1337 (D-227): vanilla has 4,286 vertical vine
   * runs and 4,285 of them END IN A HEAD. MC-Lite had 703 runs with 533 headless, and every run
   * that kept its head was exactly one block long — the case where the sampled body length is 0
   * and the head hangs straight off the ceiling, which is 17-21% of columns and matched the 24%
   * observed. `vanillacheck` §6 read `cave_vines` 0.38x while `cave_vines_plant` was 1.15x and
   * the COLUMN count was right: the bodies were all there and only the tips were missing.
   * `environment_scan` and `block_column`'s `prioritize_tip` were both checked and are innocent.
   *
   * ⚠ THE PAIRS ARE DERIVED, NOT TYPED. Vanilla names every `GrowingPlantBodyBlock` after its head
   * with a `_plant` suffix, so "X and X_plant, where both are blocks" gives exactly the four
   * families — cave vines, kelp, twisting vines, weeping vines — and a version bump moves them
   * without anybody editing a list. The same rule skips `chorus_plant` correctly: there is no
   * block called `chorus`, its head is `chorus_flower`, and its real rule is a CONNECTIVITY rule
   * (a horizontal neighbour will do) that a one-neighbour support class cannot state anyway.
   *
   * `big_dripleaf`/`big_dripleaf_stem` is the one pair no naming rule gives, so it is NAMED, for
   * the reason `STACKS` above and `pack-runtime`'s `CEILING_BLOCKS` are named: a wrong list should
   * be a visible wrong list rather than a silent rule. It is also DIRECTED, which is why this
   * table holds "what may I attach to" rather than a family id — `BigDripleafBlock.canSurvive`
   * accepts a STEM below the leaf, and `BigDripleafStemBlock.canSurvive` accepts only another stem
   * or `#big_dripleaf_placeable`, never the leaf. (Its second clause, that the block ABOVE a stem
   * be a stem or a leaf, is a rule a one-neighbour support class cannot state; it is not
   * implemented here, and the generator builds stems upward under a leaf so it never produces the
   * arrangement that clause would refuse.)
   */
  var GROWING_PAIRS = [['big_dripleaf', 'big_dripleaf_stem']];
  var attachTo = null;                 // block -> the ONE other block it may attach to, 0 for none
  function growingTable() {
    var R = NS.Reg;
    if (!R || !R.ready) return null;
    if (attachTo !== null && attachTo.length === R.blockCount) return attachTo;
    var t = new Uint16Array(R.blockCount), i, n, h;
    for (i = 1; i < R.blockCount; i++) {
      n = R.names[i];
      if (n.length <= 6 || n.slice(-6) !== '_plant') continue;
      h = R.id[n.slice(0, -6)];
      if (h === undefined) continue;   // `chorus_plant`: there is no block called `chorus`
      t[i] = h; t[h] = i;              // symmetric — vanilla's rule names the head AND the body
    }
    for (i = 0; i < GROWING_PAIRS.length; i++) {
      var hb = R.id[GROWING_PAIRS[i][0]], bb = R.id[GROWING_PAIRS[i][1]];
      if (hb === undefined || bb === undefined) continue;
      t[hb] = bb;                      // directed: the leaf takes a stem, the stem never a leaf
    }
    attachTo = t;
    return t;
  }

  /** attachPartner(state) -> the OTHER block this one may hang on, or ''. For the checks. */
  SR.attachPartner = function (state) {
    var R = NS.Reg, t = growingTable();
    if (t === null || state <= 0 || state >= SR.count) return '';
    var p = t[SR.block[state]];
    return p ? R.names[p] : '';
  };

  /**
   * attachOk(state, neighbour) -> may this block rest on that neighbour because of what the
   * neighbour IS, rather than because it is ground? Two cases and no more: the same block, where
   * that block really stacks (D-165), and the other half of its own growing plant (D-233).
   *
   * ⚠ THE TAIL OF BOTH `floorOk` AND `ceilingOk`, so the rule keeps ONE implementation (D-169)
   * and `Features.supported`, `World.canSurvive` and `floatcheck` all still get the same answer.
   */
  SR.attachOk = function (st, nb) {
    if (nb === 0) return false;
    var b = SR.block[st], nbb = SR.block[nb];
    if (nbb === b) return SR.stacksOnSelf(st);
    var t = growingTable();
    return t !== null && t[b] !== 0 && t[b] === nbb;
  };

  /**
   * wallVariant(state) -> the state of the block vanilla's item would place against a WALL, or 0.
   * One item, two blocks: `torch` and `wall_torch`, `oak_sign` and `oak_wall_sign` (D-157).
   */
  SR.wallVariant = function (state) {
    var R = NS.Reg;
    if (!R || !R.wallOf || state <= 0 || state >= SR.count) return 0;
    var w = R.wallOf[SR.block[state]];
    return w ? R.realFirst[w] + R.defaultState[w] : 0;
  };

  /**
   * iconTile(state) -> the atlas layer that best represents this block edge-on.
   *
   * The HUD's block icons and the break particles both want "what does this block look like",
   * and for a full cube that is its +X face. A model state has no such face, so it falls back
   * to the first quad of its first part, which for a stair or a slab is the same texture the
   * cube version uses. Not a hot path: the HUD bakes its icons once.
   */
  SR.iconTile = function (state) {
    var R = NS.Reg;
    if (!SR.ready || !R || !R.ready || state <= 0 || state >= SR.count) return 0;
    if (SR.geom[state] === SR.GEOM_CUBE) return SR.partTiles[SR.partAt(state, 0, 0, 0) * 6 + 2];
    var v = SR.vis[state];
    if (!R.groupCount(v)) return 0;
    var part = R.partFor(v, 0, 0, 0, 0);
    return R.partOff[part + 1] > R.partOff[part] ? R.qTile[R.partOff[part]] : 0;
  };

  /**
   * particleTile(state) -> the atlas layer of the state's model PARTICLE sprite, or -1 (D-659).
   * `BlockModels.getModelParticleSprite(state)` — the block model's own `#particle` texture,
   * resolved at build time (bake-geometry.mjs). NOT iconTile: grass_block's particle is dirt,
   * a chest's is oak planks, and neither is the block's +X face.
   */
  SR.particleTile = function (state) {
    var R = NS.Reg;
    if (!SR.ready || !R || !R.ready || !R.stParticle || state <= 0 || state >= SR.count) return -1;
    var t = R.stParticle[SR.vis[state]];
    return t === 0xFFFF ? -1 : t;
  };

  /** The tint index (0 = none) for a state's representative face — pairs with iconTile. */
  SR.iconTint = function (state) {
    var R = NS.Reg;
    if (!SR.ready || !R || !R.ready || state <= 0 || state >= SR.count) return 0;
    if (SR.geom[state] === SR.GEOM_CUBE) return SR.partTint[SR.partAt(state, 0, 0, 0) * 6 + 5];
    var v = SR.vis[state];
    if (!R.groupCount(v)) return 0;
    var part = R.partFor(v, 0, 0, 0, 0);
    return R.partOff[part + 1] > R.partOff[part] ? ((R.qFlags[R.partOff[part]] >>> 7) & 7) : 0;
  };

  /** The part to draw for this state at this position — one lookup when there is no choice. */
  SR.partAt = function (state, x, y, z) {
    return SR.multi[state] ? NS.Reg.partFor(SR.vis[state], 0, x, y, z) : SR.alt1[state];
  };
})(MCL);
