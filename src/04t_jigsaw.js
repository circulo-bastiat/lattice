// 04t_jigsaw.js — the template writer and the jigsaw assembler (PLAN W15, D-187).
// Runs on: main thread AND workers. No DOM.
//
// PLAN W15 is one stage with six bullets, and this file is the last five of them — the first,
// `tools/nbt.mjs` plus the re-encoding, is a build stage (D-186):
//
//   * `structure_void` handled as "LEAVE WHAT IS THERE", never as air
//   * `legacy_single_pool_element` writes air, plain `single_pool_element` does not
//   * `palettes` (plural) chosen per placement, seeded from the piece position
//   * the processor types and predicate types
//   * the jigsaw matcher: for each connector, weighted-shuffle candidate elements, try each
//     rotation, match `name`/`target` pairs, respect `aligned` vs `rollable`, translate so the
//     mating connector sits in front, reject on bounding-box intersection, recurse to the depth
//     budget (`size`: villages 6, outposts 7), then fall back to the terminator pool
//   * unconnected jigsaws replaced by their `final_state`
//
// ── ⚠ THE TWO THAT LOOK LIKE DETAILS AND ARE NOT ───────────────────────────────────────────
//
// `structure_void` is the reason a village house does not come with a cube of air around it.
// Every template is a solid box of `size`, and the parts of that box which are not the building
// are `minecraft:structure_void` — a marker meaning *skip this cell entirely*. Treating it as
// air (which is what a naive palette walk does, since it is a block like any other) hollows out
// a 13x13x13 cube around every house and leaves the village standing in a grid of pits.
//
// `legacy_single_pool_element` vs `single_pool_element` differ in exactly one thing, and it is
// AIR. ⚠ **AND THIS FILE HAD IT THE WRONG WAY ROUND UNTIL D-216.** The LEGACY form is the one
// that does NOT write air — vanilla's `LegacySinglePoolElement.getSettings` pops
// `BlockIgnoreProcessor.STRUCTURE_BLOCK` and adds `STRUCTURE_AND_AIR`, so an air cell in a
// legacy template never reaches the world; the plain form keeps only the structure-block filter
// and writes its air. 601 of the 836 pool elements are legacy and 176 are plain, and every one
// of the plain ones is a BASTION piece — `single_pool_element` appears in 60 `template_pool`
// files and all 60 are under `bastion/` — so in an overworld generator this rule is entirely
// about villages and the pillager outpost.
//
// ⚠ THE PROOF IS THE REAL GAME, NOT A READING OF THE TWO NAMES (D-216, on D-199's referee).
// `village/snowy/streets/straight_02` is 16x2x16: layer 0 is 48 `dirt_path` and **208 AIR**,
// layer 1 is 253 AIR. In the golden 1.18.2 world at seed 1337 the snowy village at chunk
// (-503, 92) lays that road across a slope — 73 path cells stepping 93 -> 94 -> 95 with the
// ground — and the surface on both shoulders is intact `grass_block` AT THE SAME Y AS THE ROAD.
// If the legacy form wrote its air, every shoulder would sit one block lower than the road it
// flanks, everywhere, in every village in the game. It does not, anywhere. What the inverted
// rule cost MC-Lite is measured in D-216: a street tile wrote air over the surface block a
// house was standing on.
//
// ── ⚠ WHAT IS NOT VANILLA HERE, AND IT IS THE SAME DEVIATION AS D-141 AND D-185 ────────────
//
// Vanilla's `random_block_match` processor rule draws from a `Random` seeded per PIECE and
// consumes it in block order, so the twentieth cobblestone's mossiness depends on how many
// cobblestones came before it. A piece spans several chunks and `write` is entered once per
// target chunk, so a sequential draw answers differently in each pass and would moss half a wall.
// Every processor decision here is therefore a PURE HASH of the world position and the piece's
// own seed. The DISTRIBUTION is vanilla's — 20% of cobblestone becomes mossy where the rule says
// 0.2 — and the particular blocks are not.

(function (NS) {
  'use strict';

  var CFG = NS.CFG;
  var MINY = CFG.WORLD_MIN_Y;
  var H = CFG.CHUNK_H;

  var JG = NS.Jigsaw = { ready: false, G: null, pools: null, procs: null, stats0: null };

  var T = null, WG = null, ST = null;

  // ── directions ────────────────────────────────────────────────────────────────────────────
  // 0 north(-z) 1 east(+x) 2 south(+z) 3 west(-x) 4 up 5 down. The first four rotate; the last
  // two do not, which is the whole of "rotation is around Y".
  var DIR = { north: 0, east: 1, south: 2, west: 3, up: 4, down: 5 };
  var DIRNAME = ['north', 'east', 'south', 'west', 'up', 'down'];
  var DX = [0, 1, 0, -1, 0, 0], DY = [0, 0, 0, 0, 1, -1], DZ = [-1, 0, 1, 0, 0, 0];
  var OPPOSITE = [2, 3, 0, 1, 5, 4];
  JG.DIR = DIR; JG.DX = DX; JG.DY = DY; JG.DZ = DZ; JG.OPPOSITE = OPPOSITE;
  /** Rotate a direction r quarter-turns clockwise about Y. Up and down are fixed points. */
  function rotDir(d, r) { return d >= 4 ? d : ((d + r) & 3); }
  JG.rotDir = rotDir;

  // ── ROTATING A BLOCK STATE ────────────────────────────────────────────────────────────────
  //
  // ⚠ IT IS A TABLE, AND IT HAD TO BE, AND THE REASON IS WORTH THE PARAGRAPH (D-187). The first
  // version rotated states here, at runtime, by editing properties through `States.withProp`.
  // It measured as working — four turns returned the original state for all 1,075 entries — and
  // it was rotating almost nothing, because the packed placement table carries SIX property
  // names (`facing`, `axis`, `half`, `type`, `face`, `waterlogged`; D-157 put them there for the
  // block-placement path) and a template rotates by six DIFFERENT ones. `rotation` on a sign,
  // `orientation` on a jigsaw block, a rail's `shape` and the four side flags of every fence,
  // wall and pane are not in the engine at all, so `withProp` returned the state unchanged and
  // the four-turn test passed on a function that was a no-op for them. A test that cannot see
  // the difference between "rotated correctly" and "not rotated" is exactly the shape §24 warns
  // about.
  //
  // So the rotation is computed in `tools/pack-structures.mjs`, where `block-constants.json`
  // knows every property of every block, and shipped as one palette-index-to-palette-index
  // table. `pack-structures` refuses to write a blob unless four turns is the identity for every
  // entry, and `jigsawcheck` §2 re-derives the rotated STATE from the source NBT and compares.
  var ROT_FACE = null;                 // [4][paletteIndex] -> REAL state
  var ROT_PAL = null;                  // [4][paletteIndex] -> palette index

  // ── the hash every per-block decision uses (D-185's rule, one level up) ────────────────────
  function hash4(s, x, y, z) {
    var a = (s ^ (x * 0x9E3779B1) ^ (y * 0x85EBCA77) ^ (z * 0xC2B2AE3D)) | 0;
    a = (a ^ (a >>> 16)) | 0; a = Math.imul(a, 0x7FEB352D) | 0;
    a = (a ^ (a >>> 15)) | 0; a = Math.imul(a, 0x846CA68B) | 0;
    return (a ^ (a >>> 16)) >>> 0;
  }
  JG.hash4 = hash4;
  var HASH1 = 2.3283064365386963e-10;                     // 1 / 2^32

  // ── PROCESSORS ────────────────────────────────────────────────────────────────────────────
  //
  // ⚠ THREE PROCESSOR TYPES AND SIX PREDICATE TYPES, NOT PLAN's "10 AND 8". PLAN W15 counts
  // vanilla's whole registry; the 33 `processor_list` files the overworld can reach use
  // `rule` (29), `block_rot` (4) and `protected_blocks` (3), over `always_true` (132),
  // `random_block_match` (104), `block_match` (33), `blockstate_match` (8), `tag_match` (5) and
  // `axis_aligned_linear_pos` (1). The counts are asserted in `jigsawcheck` §3 against the files
  // themselves, and an unknown type THROWS rather than being skipped: a processor that silently
  // does nothing is a village that quietly loses its cobwebs.
  function compilePredicate(p, what) {
    if (!p) return function () { return true; };
    var t = String(p.predicate_type || '').replace('minecraft:', '');
    if (t === 'always_true') return function () { return true; };
    if (t === 'block_match') {
      var want = String(p.block).replace('minecraft:', '');
      return function (ctx) { return ctx.name === want; };
    }
    if (t === 'blockstate_match') {
      var st = WG.stateOf(p.block_state);
      return function (ctx) { return ctx.state === st; };
    }
    if (t === 'random_block_match') {
      var wantB = String(p.block).replace('minecraft:', ''), pr = +p.probability;
      return function (ctx) { return ctx.name === wantB && (hash4(ctx.seed ^ 0x5CA1AB1E, ctx.x, ctx.y, ctx.z) * HASH1) < pr; };
    }
    if (t === 'random_blockstate_match') {
      var wantS = WG.stateOf(p.block_state), pr2 = +p.probability;
      return function (ctx) { return ctx.state === wantS && (hash4(ctx.seed ^ 0x5CA1AB1E, ctx.x, ctx.y, ctx.z) * HASH1) < pr2; };
    }
    if (t === 'tag_match') {
      // ⚠ ONE TAG, `minecraft:doors`, AND IT IS WHAT MAKES A ZOMBIE VILLAGE A RUIN. Five of the
      // 33 processor lists carry the single rule "anything in `doors` becomes air". The tag's
      // members are packed into the structure blob (D-187) — narrow on purpose; PLAN G1 owns the
      // general substrate — and are folded here into a flag per BLOCK index, so the test in the
      // write loop is one array read.
      var members = T.blockTag(p.tag);
      if (!members) throw new Error('jigsaw: no block tag ' + p.tag + ' in the blob, for ' + what);
      var R = NS.Reg;
      var flag = new Uint8Array(R.blockCount);
      for (var m = 0; m < members.length; m++) {
        var bi = R.id[members[m]];
        if (bi !== undefined) flag[bi] = 1;
      }
      return function (ctx) { return flag[NS.States.block[ctx.state]] === 1; };
    }
    if (t === 'axis_aligned_linear_pos') {
      var axis = String(p.axis), minC = +p.min_chance, maxC = +p.max_chance;
      var minD = +p.min_dist, maxD = +p.max_dist;
      return function (ctx) {
        var v = axis === 'x' ? ctx.x : (axis === 'y' ? ctx.y : ctx.z);
        var d = Math.abs(v);
        var f = maxD === minD ? 0 : (d - minD) / (maxD - minD);
        if (f < 0) f = 0; else if (f > 1) f = 1;
        var chance = minC + (maxC - minC) * f;
        return (hash4(ctx.seed ^ 0x11AC7, ctx.x, ctx.y, ctx.z) * HASH1) < chance;
      };
    }
    throw new Error('jigsaw: unknown predicate type ' + t + ' in ' + what);
  }

  function compileProcessor(p, what) {
    var t = String(p.processor_type || '').replace('minecraft:', '');
    if (t === 'rule') {
      var rules = [];
      for (var i = 0; i < p.rules.length; i++) {
        var r = p.rules[i];
        // ⚠ A RULE HAS THREE PREDICATE SLOTS, NOT TWO. `input_predicate` tests the block the
        // template holds and `location_predicate` the block already in the world; the third,
        // `position_predicate`, tests the POSITION and appears exactly once in the 33 lists —
        // `high_rampart`, where it thins a bastion's wall with height. Missing it does not throw,
        // it makes that rule fire unconditionally, which is why it is named here rather than
        // handled by a default.
        rules.push({
          input: compilePredicate(r.input_predicate, what + '.input'),
          loc: compilePredicate(r.location_predicate, what + '.location'),
          pos: r.position_predicate ? compilePredicate(r.position_predicate, what + '.position') : null,
          out: WG.stateOf(r.output_state)
        });
      }
      return { kind: 'rule', rules: rules };
    }
    if (t === 'block_rot') {
      // ⚠ `integrity` is a SURVIVAL fraction, not a decay fraction: 0.9 keeps nine blocks in ten.
      var integrity = p.integrity === undefined ? 1 : +p.integrity;
      return { kind: 'rot', integrity: integrity };
    }
    if (t === 'protected_blocks') {
      // "do not overwrite a block matching this tag". With no tag substrate the one thing it
      // ever names is `minecraft:features_cannot_replace`; the honest reading with the tables
      // this build has is "do not overwrite anything that is not air", which is what it means
      // for a ruined portal landing on a village.
      return { kind: 'protect' };
    }
    throw new Error('jigsaw: unknown processor type ' + t + ' in ' + what);
  }

  /** processorsOf(id) -> the compiled list for a `processor_list` id. Cached. */
  function processorsOf(id) {
    if (!id) return null;
    var key = String(id).replace('minecraft:', '');
    var got = JG.procs[key];
    if (got !== undefined) return got;
    var src = WG.get('processor_list', key);
    if (!src) throw new Error('jigsaw: no processor_list ' + key);
    var out = [];
    for (var i = 0; i < (src.processors || []).length; i++) out.push(compileProcessor(src.processors[i], key + '[' + i + ']'));
    JG.procs[key] = out.length ? out : null;
    return JG.procs[key];
  }
  JG.processorsOf = processorsOf;

  // ── TEMPLATE POOLS ────────────────────────────────────────────────────────────────────────
  var PROJ_RIGID = 0, PROJ_TERRAIN = 1;
  JG.PROJ_RIGID = PROJ_RIGID; JG.PROJ_TERRAIN = PROJ_TERRAIN;

  function compileElement(e, what) {
    var t = String(e.element_type || '').replace('minecraft:', '');
    var proj = e.projection === 'terrain_matching' ? PROJ_TERRAIN : PROJ_RIGID;
    if (t === 'empty_pool_element') return { kind: 'empty' };
    if (t === 'single_pool_element' || t === 'legacy_single_pool_element') {
      var loc = String(e.location).replace('minecraft:', '');
      var ti = T.index(loc);
      if (ti < 0) throw new Error('jigsaw: ' + what + ' names template ' + loc + ', which is not in the blob');
      return {
        kind: 'single', tpl: ti, proj: proj,
        // ⚠ THE ONE-WORD DIFFERENCE, AND IT IS THE OTHER WAY ROUND FROM WHAT PLAN W15 SAYS:
        // the PLAIN form writes air, the LEGACY form drops it. See the header, and D-216 for
        // the golden-world measurement that settles it.
        writeAir: t === 'single_pool_element',
        procs: processorsOf(e.processors)
      };
    }
    if (t === 'feature_pool_element') {
      // a single configured feature standing in for a piece — village decoration, mostly
      return { kind: 'feature', feature: String(e.feature).replace('minecraft:', ''), proj: proj };
    }
    if (t === 'list_pool_element') {
      var subs = [];
      for (var i = 0; i < e.elements.length; i++) subs.push(compileElement(e.elements[i], what + '[' + i + ']'));
      return { kind: 'list', subs: subs, proj: proj };
    }
    throw new Error('jigsaw: unknown element type ' + t + ' in ' + what);
  }

  /** poolOf(id) -> { name, fallback, elements:[{el, weight}], total }. Cached. */
  function poolOf(id) {
    var key = String(id).replace('minecraft:', '');
    var got = JG.pools[key];
    if (got !== undefined) return got;
    var src = WG.get('template_pool', key);
    if (!src) throw new Error('jigsaw: no template_pool ' + key);
    var out = { name: key, fallback: src.fallback ? String(src.fallback).replace('minecraft:', '') : null,
                elements: [], total: 0 };
    for (var i = 0; i < (src.elements || []).length; i++) {
      var w = src.elements[i].weight === undefined ? 1 : (src.elements[i].weight | 0);
      out.elements.push({ el: compileElement(src.elements[i].element, key + '[' + i + ']'), weight: w });
      out.total += w;
    }
    JG.pools[key] = out;
    return out;
  }
  JG.poolOf = poolOf;

  JG.init = function (G) {
    JG.G = G;
    T = NS.Templates; WG = NS.WG; ST = NS.Structures;
    JG.ready = false;
    if (!T || !T.ready) return JG;               // no template blob: W15 is simply not there
    JG.pools = Object.create(null);
    JG.procs = Object.create(null);
    // the four turns, folded once out of the blob's one-turn table
    var n = T.paletteCount(), one = T.rotTable();
    ROT_PAL = [new Int32Array(n), new Int32Array(n), new Int32Array(n), new Int32Array(n)];
    ROT_FACE = [new Int32Array(n), new Int32Array(n), new Int32Array(n), new Int32Array(n)];
    for (var i = 0; i < n; i++) ROT_PAL[0][i] = i;
    for (var r = 1; r < 4; r++) for (i = 0; i < n; i++) ROT_PAL[r][i] = one[ROT_PAL[r - 1][i]];
    for (r = 0; r < 4; r++) for (i = 0; i < n; i++) ROT_FACE[r][i] = T.realOf(ROT_PAL[r][i]);
    VOID_STATE = NS.States.stateOf('structure_void');
    JG.ready = true;
    return JG;
  };

  /**
   * rotateStateReal(st, r) — rotate a REAL state that did NOT come from the template palette.
   *
   * ⚠ IT CAN ONLY TURN `facing` AND `axis`, AND THAT IS A PROPERTY OF THE RUNTIME REGISTRY, NOT
   * A SHORTCUT (D-188). The packed placement table carries six property names and those are the
   * only two of them that rotate; `rotation`, `orientation`, rail `shape` and the four side
   * flags are not reachable from the engine at all, which is exactly why the TEMPLATE path uses
   * a build-time table instead (D-187). So this is for the hand-built pieces only — the two
   * temples, the hut, the stronghold's rooms — and `structcheck` §7 asserts that every state
   * those pieces place is either rotation-invariant or carries `facing`/`axis`, so the
   * limitation is a checked precondition rather than a silent wrong answer.
   */
  var HFACE = null;
  JG.rotateStateReal = function (st, r) {
    r &= 3;
    if (!st || !r) return st;
    var S = NS.States, R = NS.Reg;
    if (HFACE === null) {
      HFACE = {};
      for (var d = 0; d < 4; d++) HFACE[R.PVAL[DIRNAME[d]]] = R.PVAL[DIRNAME[(d + 1) & 3]];
    }
    while (r--) {
      var pv = S.propValue(st, R.PROP.facing);
      if (pv >= 0 && HFACE[pv] !== undefined) st = S.withProp(st, R.PROP.facing, HFACE[pv]);
      var av = S.propValue(st, R.PROP.axis);
      if (av >= 0) {
        if (av === R.PVAL.x) st = S.withProp(st, R.PROP.axis, R.PVAL.z);
        else if (av === R.PVAL.z) st = S.withProp(st, R.PROP.axis, R.PVAL.x);
      }
    }
    return st;
  };

  /** The REAL state for a global palette index under r quarter-turns. */
  JG.rotated = function (pi, r) { return ROT_FACE[r & 3][pi]; };
  /** And the palette index, which is what a check compares against the source NBT. */
  JG.rotatedPal = function (pi, r) { return ROT_PAL[r & 3][pi]; };

  // ── PLACING ONE TEMPLATE ──────────────────────────────────────────────────────────────────
  //
  // A PIECE is `{tpl, palIdx, rot, ox, oy, oz, writeAir, procs, proj, seed}` in WORLD blocks:
  // `ox/oy/oz` is where the rotated template's minimum corner goes. The rotated size is the
  // template's own with x and z swapped on an odd quarter-turn, which is the only thing rotation
  // does to a bounding box.

  function rotSize(e, rot, out) {
    if (rot & 1) { out[0] = e.sz; out[1] = e.sy; out[2] = e.sx; }
    else { out[0] = e.sx; out[1] = e.sy; out[2] = e.sz; }
    return out;
  }
  JG.rotSize = rotSize;

  /** Local (x,z) of a template, rotated r quarter-turns inside its own rotated footprint. */
  function rotX(e, rot, x, z) {
    switch (rot & 3) {
      case 0: return x;
      case 1: return e.sz - 1 - z;
      case 2: return e.sx - 1 - x;
      default: return z;
    }
  }
  function rotZ(e, rot, x, z) {
    switch (rot & 3) {
      case 0: return z;
      case 1: return x;
      case 2: return e.sz - 1 - z;
      default: return e.sx - 1 - x;
    }
  }
  JG.rotX = rotX; JG.rotZ = rotZ;

  /** The world box a piece occupies. */
  JG.pieceBox = function (p) {
    var e = T.get(p.tpl), s = [0, 0, 0];
    rotSize(e, p.rot, s);
    return { x0: p.ox, y0: p.oy, z0: p.oz, x1: p.ox + s[0] - 1, y1: p.oy + s[1] - 1, z1: p.oz + s[2] - 1 };
  };

  /**
   * groundLy(tpl) -> how far above the template's own bottom the piece's UNDERSIDE is (D-216).
   *
   * ⚠ A TEMPLATE'S BOX FLOOR IS NOT ITS UNDERSIDE, and the beard has been filling to the box
   * floor. `village/desert/houses/desert_farm_2` is 7x7x10 whose layer 0 holds THREE
   * smooth_sandstone cells and 67 `structure_void`; the farm itself — 24 farmland, 29
   * sandstone stairs — is layer 1. A plinth built to `box.y0 - 1` therefore stops two blocks
   * under the farm and the whole plot stands over air: 54 of one instance's 56 base cells and
   * 46 of another's, which is the same "building over a one-block void" D-216 is about, wearing
   * a different template. Vanilla has the number already — `ground_level_delta`, which its own
   * saved village pieces carry (0, 1 and -1 all appear in the golden 1.18.2 world's
   * `Children`) — and it is not in the packed blob, so it is derived here.
   *
   * ⚠ A QUARTER OF THE COLUMNS, because the two cheap answers are both wrong. "The lowest layer
   * with anything solid in it" is layer 0 for the farm above (three cells of one corner post)
   * and for every building that sinks a foundation pillar; "every column's own lowest solid
   * cell" makes a roof eave over a doorway into a floor. What is wanted is which LAYER is the
   * underside, and a layer that fills a quarter of the footprint is one. It is a definition of
   * a shape, not a threshold on a measurement.
   */
  JG.groundLy = function (tpl) {
    var e = T.get(tpl);
    if (e.__gly !== undefined) return e.__gly;
    var b = T.blocksOf(tpl, 0);
    var per = new Int32Array(e.sy), seen = new Uint8Array(e.sx * e.sz), cols = 0;
    for (var i = 0; i < b.pos.length; i++) {
      var fl = T.flagOf(b.pal[i]);
      if (fl & (T.FLAG_VOID | T.FLAG_AIR | T.FLAG_JIGSAW)) continue;
      var st = ROT_FACE[0][b.pal[i]];
      if (st <= 0 || NS.States.opaque[st] !== 1) continue;
      var li = b.pos[i];
      var ly = (li / (e.sx * e.sz)) | 0, k = li % (e.sx * e.sz);
      per[ly]++;
      if (!seen[k]) { seen[k] = 1; cols++; }
    }
    var need = Math.max(1, Math.ceil(cols / 4)), g = 0;
    for (var y = 0; y < e.sy; y++) if (per[y] >= need) { g = y; break; }
    e.__gly = g;
    return g;
  };

  var VOID_STATE = -1;

  /**
   * writePiece(SB, cx, cz, p) — write the part of one template piece that lands in chunk (cx,cz).
   *
   * ⚠ CLIPPED, NEVER BOUNDED. `ST.api.set` drops a write outside the target chunk, so this walks
   * the whole template every time and keeps what lands. That is what makes "run every piece that
   * can reach me and keep the part that lands here" correct rather than lucky — and the walk is
   * over the RUN-DECODED arrays, which are already sorted, so the cost is one pass and no search.
   */
  // ── ⚠ THE PER-COLUMN DRAPE, WHICH IS VANILLA'S `GravityProcessor` (D-216) ─────────────────
  //
  // `Projection.TERRAIN_MATCHING` carries exactly one processor in vanilla:
  // `new GravityProcessor(Heightmap.Types.WORLD_SURFACE_WG, -1)`, and all it does is move each
  // block to `getHeight(WORLD_SURFACE_WG, x, z) - 1 + localY`. `getHeight` is the first FREE
  // cell, so that is `Column.height(x, z) + localY` here, one column at a time. It is a PURE
  // FUNCTION OF (x, z) — the same answer from any chunk, on any thread, in any order (D-185) —
  // which is the whole reason it is safe to do at write time when `edgesLiquid` was not.
  //
  // MC-Lite tried this once before and it dug a hole under 62 of a desert village's 467 house
  // floor columns, which is why `tryAttach` below says it does the vertical fit at ASSEMBLY
  // time instead. That diagnosis was wrong by one line: the holes were the STREET'S OWN AIR,
  // written because `legacy_single_pool_element` was inverted (see the header). With the air
  // rule fixed a draped street writes nothing but its 48 path cells, and each of them lands on
  // the ground it is draped onto. The assembly-time fit STAYS — vanilla does that too, it is
  // what decides which piece attaches where — and this is what happens when the piece is
  // finally written.
  //
  // ONE `Column.height` PER COLUMN PER CHUNK, memoised: `writePiece` is entered once per piece
  // per target chunk and several street tiles reach the same chunk, so the cache is keyed by
  // (seed, cx, cz) and holds the 256 columns of the chunk being filled. The seed is in the key
  // because a check that generates chunk (0, 0) under four seeds in one process would otherwise
  // read the first seed's ground for the other three.
  //
  // ⚠ AND IT READS NOTHING. A walk down the written column — land on whatever is solid now,
  // the way vanilla's `WORLD_SURFACE_WG` already contains the Beardifier's terrace — was tried
  // and is NOT here, for two reasons worth the paragraph. It made the answer depend on how much
  // of the structure had been written when this piece's turn came, which is a different kind of
  // purity from D-185's and a worse one to give up; and it made things WORSE where it mattered,
  // because a road that drops onto the shaved terrace stops being the thing holding up the
  // house floor above it — 903 supported rigid floor columns in a desert village became 901.
  // What it would have fixed is a road hanging over a terrace another piece's beard shaved out
  // from under it, which is the residual `structcheck` §9 prints and does not hide: 1,026 of
  // 1,041 draped road cells rest on ground, and the fifteen are all on one beard's skirt.
  var _dSeed = -1, _dCx = 0x7fffffff, _dCz = 0x7fffffff;
  var _dCol = new Int32Array(256);
  var DRAPE_NONE = -0x40000000;
  function drapeAt(cx, cz, x, z) {
    var seed = (NS.Gen && NS.Gen.seed) | 0;
    if (seed !== _dSeed || cx !== _dCx || cz !== _dCz) {
      _dSeed = seed; _dCx = cx; _dCz = cz; _dCol.fill(DRAPE_NONE);
    }
    var i = ((z & 15) << 4) | (x & 15);
    var v = _dCol[i];
    if (v === DRAPE_NONE) { v = NS.Column.height(x, z); _dCol[i] = v; }
    return v;
  }
  JG.drapeAt = drapeAt;

  /**
   * StructureTemplate.placeEntities: each template entity is rotated with the piece (the same
   * quarter-turn as the blocks, on the continuous coordinate) and belongs to the ONE chunk that
   * holds its block position, so a piece crossing chunks never spawns it twice. The list rides
   * gen:done like the spawner log; the main thread makes the mobs (World.installChunk).
   */
  function writeEntities(cx, cz, p, e, drape) {
    var list = NS.Gen.entityLog, rot = p.rot & 3;
    for (var i = 0; i < e.ents.length; i++) {
      var en = e.ents[i], x = en.x, z = en.z, rx, rz;
      switch (rot) {
        case 0: rx = x; rz = z; break;
        case 1: rx = e.sz - z; rz = x; break;
        case 2: rx = e.sx - x; rz = e.sz - z; break;
        default: rx = z; rz = e.sx - x;
      }
      var wx = p.ox + rx, wz = p.oz + rz;
      if ((Math.floor(wx) >> 4) !== cx || (Math.floor(wz) >> 4) !== cz) continue;
      var wy = drape ? drapeAt(cx, cz, Math.floor(wx), Math.floor(wz)) + en.y : p.oy + en.y;
      list.push([en.id, wx, wy, wz, en.yaw + 90 * rot]);
    }
  }

  JG.writePiece = function (SB, cx, cz, p) {
    var e = T.get(p.tpl);
    var b = T.blocksOf(p.tpl, p.palIdx);
    var pos = b.pos, pal = b.pal;
    var sx = e.sx, sz = e.sz;
    var n = 0, ox = p.ox, oy = p.oy, oz = p.oz;
    var drape = (p.proj === PROJ_TERRAIN);
    var A = ST.api;
    var minX = cx << 4, minZ = cz << 4;
    if (e.ents && e.ents.length && NS.Gen && NS.Gen.entityLog) writeEntities(cx, cz, p, e, drape);
    for (var i = 0; i < pos.length; i++) {
      var li = pos[i];
      var lx = li % sx, ly = (li / (sx * sz)) | 0, lz = ((li / sx) | 0) % sz;
      var wx = ox + rotX(e, p.rot, lx, lz);
      var wz = oz + rotZ(e, p.rot, lx, lz);
      // the cheap reject FIRST: nine tenths of a village piece is in somebody else's chunk
      if (wx < minX || wx > minX + 15 || wz < minZ || wz > minZ + 15) continue;
      var pi = pal[i];
      var fl = T.flagOf(pi);
      // ⚠ structure_void: LEAVE WHAT IS THERE. Not air, not stone — untouched.
      if (fl & T.FLAG_VOID) continue;
      if ((fl & T.FLAG_AIR) && !p.writeAir) continue;
      var wy = drape ? (drapeAt(cx, cz, wx, wz) + ly) : (oy + ly);
      if (wy < MINY || wy >= MINY + H) continue;
      var st = ROT_FACE[p.rot & 3][pi];
      // ── ⚠ EVERY JIGSAW BLOCK BECOMES ITS `final_state`, AND MOST OF THOSE ARE VOID ────────
      //
      // PLAN W15's last bullet says *"unconnected jigsaws replaced by their `final_state`"*, and
      // the connected ones need the same treatment for the same reason: a jigsaw block never
      // survives into a finished world — it is a generation-time marker, and leaving one behind
      // puts a debug block in the wall of a village house.
      //
      // ⚠ AND `final_state` OBEYS THE VOID RULE. **1,124 of the 2,605 jigsaw blocks in the jar
      // name `minecraft:structure_void`** — it is by a distance the commonest value — so a
      // writer that treats `final_state` as "a block to place" scatters structure_void through
      // every village it builds. It did: 72 of them in one desert village, which is how this
      // was found. Void means LEAVE WHAT IS THERE here exactly as it does in the palette.
      if (fl & T.FLAG_JIGSAW) {
        var fin = e.finalAt || (e.finalAt = buildFinalMap(e));
        var f = fin[li];
        if (f === undefined) { st = 0; }
        else {
          var ff = T.flagOf(f);
          if (ff & T.FLAG_VOID) continue;
          if ((ff & T.FLAG_AIR) && !p.writeAir) continue;
          st = ROT_FACE[p.rot & 3][f];
        }
      }
      if (p.procs) {
        st = applyProcessors(p, st, wx, wy, wz, SB, cx, cz);
        if (st < 0) continue;
      }
      // no rule in the 33 overworld processor lists outputs `structure_void`, and if one ever
      // does it means the same thing it means everywhere else
      if (st === VOID_STATE) continue;
      if (st === 0 && !p.writeAir) continue;
      // ⚠ `keepLiquids` — AIR NEVER REPLACES WATER (D-212). Vanilla places every structure
      // template with `StructurePlaceSettings.keepLiquids` true, which is why an ocean ruin, a
      // shipwreck and a monument are FULL of water rather than sitting in a bubble. MC-Lite wrote
      // the template's air straight over the sea: `structaudit` §6 measured structure-written air
      // against water at 80x the natural baseline, and the wall of that bubble is what a glitched
      // underwater structure looks like from inside the game. A solid block still replaces water,
      // exactly as vanilla's does.
      if (st === 0 && NS.States.waterIn[A.get(SB, cx, cz, wx, wy, wz) | 0]) continue;
      n += A.set(SB, cx, cz, wx, wy, wz, st);
    }
    return n;
  };

  /** pos -> final_state palette index, for one template. Built once, kept on the header. */
  function buildFinalMap(e) {
    var m = Object.create(null);
    for (var i = 0; i < e.jig.length; i++) m[e.jig[i].pos] = e.jig[i].finalPal;
    return m;
  }

  var _ctx = { name: '', state: 0, x: 0, y: 0, z: 0, seed: 0 };
  function applyProcessors(p, st, x, y, z, SB, cx, cz) {
    var S = NS.States;
    for (var i = 0; i < p.procs.length; i++) {
      var pr = p.procs[i];
      if (pr.kind === 'rot') {
        if ((hash4(p.seed ^ 0x120F7, x, y, z) * HASH1) >= pr.integrity) return -1;
      } else if (pr.kind === 'protect') {
        var cur = NS.Structures.api.get(SB, cx, cz, x, y, z);
        if (cur > 0) return -1;
      } else {
        _ctx.state = st; _ctx.x = x; _ctx.y = y; _ctx.z = z; _ctx.seed = p.seed;
        _ctx.name = S.name(st);
        for (var r = 0; r < pr.rules.length; r++) {
          var rule = pr.rules[r];
          if (!rule.input(_ctx)) continue;
          if (!rule.loc(_ctx)) continue;
          if (rule.pos && !rule.pos(_ctx)) continue;
          st = rule.out;
          break;
        }
      }
    }
    return st;
  }

  // ── THE JIGSAW MATCHER ────────────────────────────────────────────────────────────────────
  //
  // Breadth-first out of the start element, exactly as `JigsawPlacement.addPieces` is: a stack
  // would finish one street to the depth budget before starting the second, and a village made
  // of one street is what that bug looks like.

  // ⚠ counted, because "the village has no houses" is a thing a piece COUNT cannot tell you and
  // a rejection histogram can. `jigsawcheck` §4 asserts the shape of these numbers.
  JG.reject = { tried: 0, bound: 0, world: 0, overlap: 0, nomatch: 0 };
  JG.resetReject = function () { JG.reject = { tried: 0, bound: 0, world: 0, overlap: 0, nomatch: 0 }; return JG; };

  var MAX_DIST = 80;                   // vanilla's own placement bound, in blocks from the start
  JG.MAX_DIST = MAX_DIST;

  /**
   * The front and top directions of a jigsaw connector, after r quarter-turns.
   * ⚠ `front` and `top` come out of the BLOB, resolved from the jigsaw block state's
   * `orientation` at pack time (D-187) — `orientation` is not one of the six properties the
   * runtime registry carries, so the engine could not read it back if it wanted to.
   */
  function connectorDirs(j, rot, out) {
    out[0] = rotDir(j.front, rot);
    out[1] = rotDir(j.top, rot);
    return out;
  }
  JG.connectorDirs = connectorDirs;

  function boxesHit(a, b) {
    return a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0 && a.z0 <= b.z1 && a.z1 >= b.z0;
  }

  /** A weighted draw that removes what it drew, so n members cost at most n draws. */
  function drawOrder(pool, r) {
    var idx = [], w = [], total = 0, i;
    for (i = 0; i < pool.elements.length; i++) { idx.push(i); w.push(pool.elements[i].weight); total += pool.elements[i].weight; }
    var out = [];
    while (idx.length) {
      var pick = r.nextInt(total > 0 ? total : 1), at = 0, k = 0;
      for (i = 0; i < idx.length; i++) { at += w[i]; if (pick < at) { k = i; break; } k = i; }
      out.push(idx[k]); total -= w[k];
      idx.splice(k, 1); w.splice(k, 1);
    }
    return out;
  }

  /**
   * assemble(opts) -> the piece list, or null.
   *   opts: { pool, x, y, z, depth, rng, proj, groundY }
   *
   * `x, y, z` is where the start element's own bounding box is centred horizontally and where
   * its floor sits vertically. Every later piece is placed relative to it.
   */
  JG.assemble = function (opts) {
    var rng = opts.rng;
    var startPool = poolOf(opts.pool);
    if (!startPool.elements.length) return null;

    var pieces = [];
    var boxes = [];
    var order = drawOrder(startPool, rng);
    var startEl = null, startRot = rng.nextInt(4);
    for (var oi = 0; oi < order.length; oi++) {
      var cand = startPool.elements[order[oi]].el;
      if (cand.kind === 'single') { startEl = cand; break; }
    }
    if (!startEl) return null;

    var sz3 = [0, 0, 0];
    var se = T.get(startEl.tpl);
    rotSize(se, startRot, sz3);
    var p0 = mkPiece(startEl, startRot,
                     opts.x - (sz3[0] >> 1), opts.y, opts.z - (sz3[2] >> 1), rng);
    p0.__box = JG.pieceBox(p0);
    pieces.push(p0); boxes.push(p0.__box);

    var bound = { x0: opts.x - MAX_DIST, x1: opts.x + MAX_DIST,
                  z0: opts.z - MAX_DIST, z1: opts.z + MAX_DIST };

    // BFS over pieces; `depth` is vanilla's `size`
    var head = 0;
    var depthOf = [0];
    var dirs = [0, 0];
    while (head < pieces.length) {
      var cur = pieces[head], d = depthOf[head];
      head++;
      if (d >= opts.depth) continue;
      var ce = T.get(cur.tpl);
      for (var ji = 0; ji < ce.jig.length; ji++) {
        var j = ce.jig[ji];
        // the connector's world position and facing, after this piece's rotation
        var jx = j.pos % ce.sx, jy = (j.pos / (ce.sx * ce.sz)) | 0, jz = ((j.pos / ce.sx) | 0) % ce.sz;
        var wx = cur.ox + rotX(ce, cur.rot, jx, jz);
        var wz = cur.oz + rotZ(ce, cur.rot, jx, jz);
        var wy = cur.oy + jy;
        connectorDirs(j, cur.rot, dirs);
        var front = dirs[0];
        var fx = wx + DX[front], fy = wy + DY[front], fz = wz + DZ[front];
        // ⚠ A CONNECTOR MAY POINT INTO ITS OWN PIECE, AND THAT IS THE WHOLE OF WHY A VILLAGE HAS
        // HOUSES. A plains street tile is 16x2x16 and its `building_entrance` jigsaw sits at
        // local (8,1,6) — the MIDDLE of the tile, not its edge — so the block in front of it is
        // still inside the street's own bounding box, and a house attached there necessarily
        // overlaps the street. Tested against every placed box including the parent's, the
        // rejection rate was **4,347 of 4,398 candidates** and three seeds in a row produced a
        // village of fifty street tiles and not one building.
        //
        // Vanilla has a branch for exactly this (`JigsawPlacement.Placer.tryPlacingChildren`
        // takes the free space from the piece itself when `pieceBox.isInside(frontPos)`), and
        // this is that branch: when the front position is inside the parent, the parent's own box
        // is excluded from the overlap test and every other placed box still applies. A house may
        // therefore sit on the street tile that spawned it and may not sit on its neighbour.
        var selfMounted = cur.__box && fx >= cur.__box.x0 && fx <= cur.__box.x1 &&
                          fy >= cur.__box.y0 && fy <= cur.__box.y1 &&
                          fz >= cur.__box.z0 && fz <= cur.__box.z1;
        var attached = tryAttach(j, front, dirs[1], fx, fy, fz, pieces, boxes, depthOf, d, bound, rng, cur,
                                 selfMounted ? head - 1 : -1);
        if (!attached) JG.reject.nomatch++;
      }
    }
    return pieces;

    function mkPiece(el, rot, ox, oy, oz, r) {
      var e = T.get(el.tpl);
      // ⚠ `palettes` (plural) chosen PER PLACEMENT and seeded from the piece POSITION, which is
      // PLAN W15's own wording. Seeding from the rng instead would make the same house in the
      // same place take a different palette depending on how many pieces were placed before it.
      var pi = e.pal.length > 1 ? (hash4(0x9A1E7, ox, oy, oz) % e.pal.length) : 0;
      return { tpl: el.tpl, palIdx: pi, rot: rot & 3, ox: ox, oy: oy, oz: oz,
               writeAir: el.writeAir, procs: el.procs, proj: el.proj,
               seed: hash4(0x50EED, ox, oy, oz), finalOf: null };
    }

    function tryAttach(j, front, top, fx, fy, fz, pieces, boxes, depthOf, d, bound, r, parent, skipBox) {
      // ⚠ ONE HEIGHTMAP LOOKUP PER CONNECTOR, NOT PER CANDIDATE. `Column.height` is the whole
      // spline stack and this loop runs over every element of the pool, every jigsaw in it and
      // every rotation — a few thousand times per village. Calling it inside made gencheck's
      // window jump from 14.96 ms a chunk to 16.6; hoisted, it is one call. `fx`/`fz` cannot
      // change inside the loop, so the two are the same answer.
      var groundY = -2147483648;
      var pools = [j.pool];
      var tp = poolOf(j.pool);
      if (tp.fallback) pools.push(tp.fallback);
      for (var pi = 0; pi < pools.length; pi++) {
        var pool = poolOf(pools[pi]);
        var ord = drawOrder(pool, r);
        for (var oi2 = 0; oi2 < ord.length; oi2++) {
          var el = pool.elements[ord[oi2]].el;
          if (el.kind === 'list') el = el.subs[0];
          if (el.kind !== 'single') continue;
          var e2 = T.get(el.tpl);
          for (var jj = 0; jj < e2.jig.length; jj++) {
            var j2 = e2.jig[jj];
            // ⚠ the pair must match BOTH WAYS: their name is our target and their target is our
            // name. Matching one way lets a street connect to a roof.
            if (j2.name !== j.target || j2.target !== j.name) continue;
            // ⚠ ONE DRAW, THEN A CYCLE — not a fresh draw per attempt. The first version drew
            // `r.nextInt(4)` INSIDE the loop, so the four tries were four independent samples
            // rather than a permutation: the one rotation that fits was missed about a third of
            // the time, and a street's house connector is exactly the case where only one
            // rotation fits.
            var rbase = r.nextInt(4);
            for (var rr = 0; rr < 4; rr++) {
              var rot2 = (rbase + rr) & 3;
              connectorDirs(j2, rot2, dirs2);
              if (dirs2[0] !== OPPOSITE[front]) continue;
              // `aligned` also pins the roll about the connector axis; `rollable` does not
              if (j.joint === 1 && dirs2[1] !== top) continue;
              var jx2 = j2.pos % e2.sx, jy2 = (j2.pos / (e2.sx * e2.sz)) | 0, jz2 = ((j2.pos / e2.sx) | 0) % e2.sz;
              var ox2 = fx - rotX(e2, rot2, jx2, jz2);
              var oz2 = fz - rotZ(e2, rot2, jx2, jz2);
              // ── ⚠ `terrain_matching` IS BOTH: A VERTICAL FIT HERE **AND** A PER-COLUMN DRAPE
              // WHEN THE PIECE IS WRITTEN (D-216). PLAN W17 asks for *"paths that follow
              // contours — which is `projection: terrain_matching`, data, already fetched"*, and
              // vanilla answers it in two places, not one. `JigsawPlacement` is the first: a
              // terrain-matching child takes its Y from the heightmap AT ITS CONNECTOR instead
              // of inheriting its parent's, which is what makes a village street STEP down a
              // hill one tile at a time, and that is this line. `Projection.TERRAIN_MATCHING`'s
              // own `GravityProcessor` is the second, and it lives in `writePiece` — see the
              // note there.
              //
              // ⚠ THIS FILE USED TO CLAIM THE DRAPE WAS A MISTAKE, on the evidence that draping
              // once put air cells inside the ground — *"62 of one desert village's 467 house
              // floor columns ended up over a hole a street tile had just dug under them"*. The
              // hole was real; the diagnosis was one line off. A street tile is
              // `legacy_single_pool_element`, which in vanilla is the form that does NOT write
              // air, and this file had that rule inverted. Making the piece rigid did not stop
              // it writing air, it only stopped the air landing in the same place every time —
              // which is why the same 62-column failure was still there, wearing a different
              // shape, three sessions later (D-216).
              if (el.proj === PROJ_TERRAIN && groundY === -2147483648) groundY = NS.Column.height(fx, fz) + 1;
              var oy2 = (el.proj === PROJ_TERRAIN) ? (groundY - jy2) : (fy - jy2);
              var cand = mkPiece(el, rot2, ox2, oy2, oz2, r);
              var bx = JG.pieceBox(cand);
              JG.reject.tried++;
              if (bx.x0 < bound.x0 || bx.x1 > bound.x1 || bx.z0 < bound.z0 || bx.z1 > bound.z1) { JG.reject.bound++; continue; }
              if (bx.y0 < MINY + 1 || bx.y1 >= MINY + H) { JG.reject.world++; continue; }
              var hit = false;
              for (var b = 0; b < boxes.length; b++) if (b !== skipBox && boxesHit(boxes[b], bx)) { hit = true; break; }
              if (hit) { JG.reject.overlap++; continue; }
              cand.__box = bx;
              pieces.push(cand); boxes.push(bx); depthOf.push(d + 1);
              return true;
            }
          }
        }
      }
      return false;
    }
  };
  var dirs2 = [0, 0];

  JG.stats = function () {
    return { ready: JG.ready, pools: JG.pools ? Object.keys(JG.pools).length : 0,
             processors: JG.procs ? Object.keys(JG.procs).length : 0 };
  };
})(MCL);
