// 02b_registry.js — the generated block registry, decoded from the packed build output.
// Runs on: main thread AND workers. No DOM (D-17).
//
// This replaces the hand-written 49-block table in 02_blocks.js with the real 1.18.2 roster:
// 900 blocks, 8,933 visual states, 20,344 real states, 4,105 collision shapes, 4,027 baked
// geometry parts. Nothing here is typed by hand — it is decoded from `assets/*.bin`, which
// are generated from Dan's own jars, because a generated registry cannot quietly disagree
// with the real game the way a typed one will (D-5).
//
// TWO INDEXINGS, and the whole file depends on keeping them apart:
//
//   VISUAL state — what a block LOOKS like. 8,933 of them. The mesher and the occlusion
//                  mask use this. It comes from the blockstates files.
//   REAL state   — what a block IS. 20,344 of them. Placement, collision, saving and
//                  block behaviour use this. It comes from blocks.json, because blockstates
//                  JSON does not carry `waterlogged` on a slab or `powered` on a door —
//                  neither changes the model, so neither appears (D-29).
//
// Every real state maps to exactly one visual state. NEVER the reverse: asking "what real
// state is this visual state" has no answer, and code that wants one has confused the two.
//
// Everything is a parallel typed array. The mesher reads this in its inner loop, and an
// object graph there is the difference between a chunk in 4 ms and a chunk in 40
// (docs/archive/ARCH.md §3).

(function (NS) {
  'use strict';

  var R = NS.Reg = {
    ready: false,

    blockCount: 0,
    visualCount: 0,          // total VISUAL states across all blocks
    realCount: 0,            // total REAL states across all blocks

    names: [],               // block index -> name
    id: Object.create(null), // name -> block index

    // per block
    visFirst: null,          // Uint32Array(blockCount + 1) — first global visual state
    realFirst: null,         // Uint32Array(blockCount + 1) — first global real state
    hard: null, resist: null,
    emit: null, filter: null, flags: null, stack: null, tools: null,
    // G4 (D-250) — vanilla's own three movement fields, per BLOCK. Defaults 0.6 / 1 / 1; seven
    // blocks differ, and all three come from Mojang's bytecode, not from this project's memory.
    friction: null,          // Float32Array — BlockBehaviour.friction    (ice 0.98, slime 0.8)
    speedFactor: null,       // Float32Array — BlockBehaviour.speedFactor (soul sand / honey 0.4)
    jumpFactor: null,        // Float32Array — BlockBehaviour.jumpFactor  (honey 0.5)
    defaultState: null,      // LOCAL real state index, not global

    // per visual state
    occlusion: null,         // Uint8Array — 6 bits, down/up/north/south/west/east

    // per real state
    toVisual: null,          // Uint32Array — global real state -> global visual state
    shapeOf: null,           // Uint16Array — global real state -> collision shape index

    // collision shapes, shared across every block
    shapeOff: null,          // Uint32Array(shapeCount + 1) — into shapeBox
    shapeBox: null,          // Int16Array — 6 per box, in 1/1024 of a block

    // geometry: quads, flat
    partOff: null,           // Uint32Array(partCount + 1) — into the quad arrays
    qFlags: null,            // Uint16Array — dir(3) | cull(3, 7=none) | shade(1) | tint(3, 0=none)
    qTile: null,             // Uint16Array — atlas tile
    qPos: null,              // Int16Array — 12 per quad, 1/16 of a model unit
    qUv: null,               // Int16Array — 8 per quad, 1/16 of a texel
    partUvRot: null,         // Uint8Array(partCount) — 1 = a face of this part was baked with a
                             // non-zero UV rotation, so the greedy cube path cannot draw it
                             // (D-181). Baked by tools/bake-geometry.mjs; read once, by
                             // States.build, never in the mesh loop.

    // geometry: which parts a visual state draws
    stGroupOff: null,        // Uint32Array(visualCount + 1) — into the group arrays
    grpAltOff: null,         // Uint32Array(groupCount + 1) — into the alternative arrays
    altPart: null,           // Uint16Array — part index
    altWeight: null,         // Uint8Array

    FLAG_TRANSPARENT: 1, FLAG_DIGGABLE: 2, FLAG_LOOT: 4,
    // vanilla's requiresCorrectToolForDrops — the difference between a 30-tick and a
    // 100-tick bare-handed break, which is the difference between 2.25 s and 7.5 s on stone
    FLAG_NEEDS_TOOL: 8,
    // D-263: vanilla's Material.isReplaceable(). Bits 16|32|64 are the support class.
    FLAG_REPLACEABLE: 128,
    // bits 16|32 are the SUPPORT CLASS (D-140), packed by tools/pack-runtime.mjs out of the pc
    // dataset's `material`: 0 none · 1 floor · 2 ceiling · 3 any face. It is what stops the
    // feature pipeline hanging a dead bush in mid-air over a carved cave.
    SUP_NONE: 0, SUP_FLOOR: 1, SUP_CEILING: 2, SUP_ANY: 3, SUP_BEHIND: 4,
    DIRS: ['down', 'up', 'north', 'south', 'west', 'east']
  };

  // ---------------------------------------------------------------- little-endian reader
  function Cursor(bytes) { this.b = bytes; this.p = 0; this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
  Cursor.prototype.u8 = function () { return this.b[this.p++]; };
  Cursor.prototype.u16 = function () { var v = this.dv.getUint16(this.p, true); this.p += 2; return v; };
  Cursor.prototype.i16 = function () { var v = this.dv.getInt16(this.p, true); this.p += 2; return v; };
  Cursor.prototype.u32 = function () { var v = this.dv.getUint32(this.p, true); this.p += 4; return v; };
  Cursor.prototype.f32 = function () { var v = this.dv.getFloat32(this.p, true); this.p += 4; return v; };
  Cursor.prototype.str = function (n) {
    var s = '';
    for (var i = 0; i < n; i++) s += String.fromCharCode(this.b[this.p++]);
    return s;
  };

  // ---------------------------------------------------------------- constants
  /**
   * Decode `block-runtime.bin`. Two passes over the same bytes: the first only counts, so
   * every typed array is allocated exactly once at its exact size. Growing arrays in the
   * second pass would work and would also mean three reallocations of a 20,000-entry array
   * during boot, on the machine least able to afford it (D-20).
   */
  R.decodeConstants = function (bytes) {
    var c = new Cursor(bytes);
    if (c.str(4) !== 'MCLR') throw new Error('block-runtime.bin: bad magic');
    var nBlocks = c.u16(), nShapes = c.u16();

    // shapes first — they are a flat prefix and their size is not knowable without reading
    var shapeStart = c.p;
    var totalBoxes = 0, i, j;
    for (i = 0; i < nShapes; i++) { var nb = c.u8(); totalBoxes += nb; c.p += nb * 12; }
    R.shapeOff = new Uint32Array(nShapes + 1);
    R.shapeBox = new Int16Array(totalBoxes * 6);
    var after = c.p;
    c.p = shapeStart;
    var box = 0;
    for (i = 0; i < nShapes; i++) {
      R.shapeOff[i] = box;
      var n = c.u8();
      for (j = 0; j < n * 6; j++) R.shapeBox[box * 6 + j] = c.i16();
      box += n;
    }
    R.shapeOff[nShapes] = box;
    c.p = after;

    // count the states before allocating
    var blockStart = c.p;
    var totalVis = 0, totalReal = 0;
    for (i = 0; i < nBlocks; i++) {
      var ln = c.u8(); c.p += ln;
      var vis = c.u16(), real = c.u16();
      totalVis += vis; totalReal += real;
      // ⚠ THIS SKIP AND THE READ BELOW ARE THE SAME RECORD, COUNTED TWICE. Adding the
      // PushReaction byte to one and not the other made the pre-pass walk off into the payload
      // and report fifteen MILLION real states for a registry of twenty thousand (D-298).
      // 4 hardness · 4 resistance · 6 (emit, filter, flags, stack, tools, push) · 2 default
      c.p += 4 + 4 + 6 + 2 + vis + real * 4;
    }

    R.blockCount = nBlocks;
    R.visualCount = totalVis;
    R.realCount = totalReal;
    R.names = new Array(nBlocks);
    R.id = Object.create(null);
    R.visFirst = new Uint32Array(nBlocks + 1);
    R.realFirst = new Uint32Array(nBlocks + 1);
    R.hard = new Float32Array(nBlocks);
    R.resist = new Float32Array(nBlocks);
    R.emit = new Uint8Array(nBlocks);
    R.filter = new Uint8Array(nBlocks);
    R.flags = new Uint8Array(nBlocks);
    R.stack = new Uint8Array(nBlocks);
    R.tools = new Uint8Array(nBlocks);
    // PLAN G15c — `PushReaction`, one byte per block (D-298). 0 NORMAL 1 DESTROY 2 BLOCK
    // 3 IGNORE 4 PUSH_ONLY, in the enum's own order.
    R.push = new Uint8Array(nBlocks);
    R.defaultState = new Uint16Array(nBlocks);
    R.occlusion = new Uint8Array(totalVis);
    R.toVisual = new Uint32Array(totalReal);
    R.shapeOf = new Uint16Array(totalReal);

    c.p = blockStart;
    var vOff = 0, rOff = 0;
    for (i = 0; i < nBlocks; i++) {
      var nameLen = c.u8();
      var name = c.str(nameLen);
      R.names[i] = name;
      R.id[name] = i;
      var nv = c.u16(), nr = c.u16();
      R.visFirst[i] = vOff;
      R.realFirst[i] = rOff;
      R.hard[i] = c.f32();
      R.resist[i] = c.f32();
      R.emit[i] = c.u8();
      R.filter[i] = c.u8();
      R.flags[i] = c.u8();
      R.stack[i] = c.u8();
      R.tools[i] = c.u8();
      R.push[i] = c.u8();
      R.defaultState[i] = c.u16();
      for (j = 0; j < nv; j++) R.occlusion[vOff + j] = c.u8();
      for (j = 0; j < nr; j++) {
        // toVisual is stored per block, LOCAL. Store it global, so the mesher never has to
        // find the block first — that lookup in an inner loop is what this indexing avoids.
        R.toVisual[rOff + j] = vOff + c.u16();
        R.shapeOf[rOff + j] = c.u16();
      }
      vOff += nv; rOff += nr;
    }
    R.visFirst[nBlocks] = vOff;
    R.realFirst[nBlocks] = rOff;
    R.decodePlacement(c, bytes);
    if (c.p !== bytes.length) throw new Error('block-runtime.bin: ' + (bytes.length - c.p) + ' trailing bytes');
  };

  /**
   * The placement table (D-157) — the trailing `MCLP` section of `block-runtime.bin`.
   *
   * Placement is the one thing that has to CHOOSE a real state rather than be handed one, and
   * the choice is per property: which way a stair faces, which half of the block a slab fills,
   * which axis a log lies on, which wall a torch is on. Vanilla's local-state numbering is
   * positional — properties in declaration order, the last varying fastest — so a local state is
   * a mixed-radix number and one digit can be rewritten in place. This table is the radix: per
   * (block, property), the digit's `stride` and which of the shared value ids it offers.
   *
   * Stored as a flat run per block (`propFirst[b] .. propFirst[b+1]`) rather than a map, because
   * `States.withProp` runs on the placement path and an object lookup there is a lookup per
   * click. `wallOf[b]` is vanilla's `StandingAndWallBlockItem`: the block to use instead when
   * the player clicked a side rather than a floor or a ceiling.
   */
  R.decodePlacement = function (c, bytes) {
    var i, j, nb = R.blockCount;
    R.propFirst = new Uint32Array(nb + 1);
    R.propId = new Uint8Array(0);
    R.propStride = new Uint16Array(0);
    R.propVals = null;
    R.wallOf = new Uint16Array(nb);
    R.PROP = Object.create(null);
    R.PVAL = Object.create(null);
    if (c.p + 4 > bytes.length) return;                 // an older blob: no table, no placement
    if (c.str(4) !== 'MCLP') throw new Error('block-runtime.bin: expected the MCLP placement table');
    var nProps = c.u8(), nValues = c.u8();
    R.propNames = new Array(nProps);
    R.valueNames = new Array(nValues);
    for (i = 0; i < nProps; i++) { var pl = c.u8(); R.propNames[i] = c.str(pl); R.PROP[R.propNames[i]] = i; }
    for (i = 0; i < nValues; i++) { var vl = c.u8(); R.valueNames[i] = c.str(vl); R.PVAL[R.valueNames[i]] = i; }

    var nEntries = c.u16();
    var start = c.p, counts = new Uint32Array(nb), total = 0;
    for (i = 0; i < nEntries; i++) {
      var b = c.u16(); c.p += 3; var nvv = c.u8(); c.p += nvv;
      counts[b]++; total += nvv;
    }
    var off = 0;
    for (i = 0; i < nb; i++) { R.propFirst[i] = off; off += counts[i]; }
    R.propFirst[nb] = off;
    R.propId = new Uint8Array(nEntries);
    R.propStride = new Uint16Array(nEntries);
    R.propValOff = new Uint32Array(nEntries);
    R.propValN = new Uint8Array(nEntries);
    R.propVals = new Uint8Array(total);
    // ⚠ SLOT order is block order, but the entries arrive in FILE order, so a slot's values do
    // not start where the previous slot's ended. Each slot therefore carries its own offset and
    // length; do not "optimise" this into a single offset array with implied ends.
    var fill = new Uint32Array(nb), vo = 0;
    c.p = start;
    for (i = 0; i < nEntries; i++) {
      var bb = c.u16(), pid = c.u8(), stride = c.u16(), n = c.u8();
      var slot = R.propFirst[bb] + fill[bb]++;
      R.propId[slot] = pid;
      R.propStride[slot] = stride;
      R.propValOff[slot] = vo;
      R.propValN[slot] = n;
      for (j = 0; j < n; j++) R.propVals[vo++] = c.u8();
    }

    var nPairs = c.u16();
    for (i = 0; i < nPairs; i++) { var a = c.u16(), w = c.u16(); R.wallOf[a] = w; }
  };

  // ---------------------------------------------------------------- geometry
  /** Decode `block-geometry.bin`. Same two-pass discipline, same reason. */
  R.decodeGeometry = function (bytes) {
    var c = new Cursor(bytes), i, j, k;
    var nParts = c.u32();

    var partStart = c.p, totalQuads = 0;
    for (i = 0; i < nParts; i++) { var nq = c.u16(); totalQuads += nq; c.p += nq * 44; }
    var afterParts = c.p;

    R.partOff = new Uint32Array(nParts + 1);
    R.qFlags = new Uint16Array(totalQuads);
    R.qTile = new Uint16Array(totalQuads);
    R.qPos = new Int16Array(totalQuads * 12);
    R.qUv = new Int16Array(totalQuads * 8);

    c.p = partStart;
    var q = 0;
    for (i = 0; i < nParts; i++) {
      R.partOff[i] = q;
      var n = c.u16();
      for (j = 0; j < n; j++) {
        R.qFlags[q] = c.u16();
        R.qTile[q] = c.u16();
        for (k = 0; k < 12; k++) R.qPos[q * 12 + k] = c.i16();
        for (k = 0; k < 8; k++) R.qUv[q * 8 + k] = c.i16();
        q++;
      }
    }
    R.partOff[nParts] = q;
    R.partCount = nParts;
    R.quadCount = q;
    c.p = afterParts;

    // the state -> group -> alternative tables
    var nBlocks = c.u32();
    var stateStart = c.p;
    var nStates = 0, nGroups = 0, nAlts = 0;
    for (i = 0; i < nBlocks; i++) {
      var ln = c.u8(); c.p += ln;
      var ns = c.u16();
      nStates += ns;
      for (j = 0; j < ns; j++) {
        var ng = c.u8();
        nGroups += ng;
        for (k = 0; k < ng; k++) { var na = c.u8(); nAlts += na; c.p += na * 3; }
      }
    }
    R.stGroupOff = new Uint32Array(nStates + 1);
    R.grpAltOff = new Uint32Array(nGroups + 1);
    R.altPart = new Uint16Array(nAlts);
    R.altWeight = new Uint8Array(nAlts);

    c.p = stateStart;
    var si = 0, gi = 0, ai = 0;
    for (i = 0; i < nBlocks; i++) {
      var nameLen = c.u8();
      var name = c.str(nameLen);
      // The geometry file and the constants file MUST agree on block order — the mesher
      // indexes both by the same number. A mismatch here is a build that produced two
      // registries from two different runs, and it must stop the boot rather than draw
      // one block's geometry with another block's constants.
      if (R.names.length && R.names[i] !== name) {
        throw new Error('geometry/constants block order disagree at ' + i + ': ' + R.names[i] + ' vs ' + name);
      }
      var ns2 = c.u16();
      for (j = 0; j < ns2; j++) {
        R.stGroupOff[si] = gi;
        var ng2 = c.u8();
        for (k = 0; k < ng2; k++) {
          R.grpAltOff[gi] = ai;
          var na2 = c.u8();
          for (var a = 0; a < na2; a++) { R.altPart[ai] = c.u16(); R.altWeight[ai] = c.u8(); ai++; }
          gi++;
        }
        si++;
      }
    }
    R.stGroupOff[nStates] = gi;
    R.grpAltOff[nGroups] = ai;
    if (si !== nStates) throw new Error('geometry: counted ' + nStates + ' states, wrote ' + si);

    // ── the per-part UV-rotation flags (D-181) ────────────────────────────────────────────
    // Vanilla's block model format puts a `rotation` on a FACE — `template_glazed_terracotta`
    // carries 90/270/0/180 on its four sides, and that rotation is the entire difference
    // between the four facings of a glazed terracotta. Vanilla's own bakery folds it into the
    // baked vertex UVs, which is a freedom MC-Lite's greedy vertex format gave up: `data1` packs
    // (tile, uRep, vRep, corner, tint) into 32 bits with nothing spare, so the mesher
    // regenerates canonical UVs from the corner index and a rotation cannot be expressed
    // (D-177). So the BUILD decides, per part, whether the cube fast path is allowed to stand
    // in for it, and the answer arrives here as one byte per part.
    //
    // Tolerated as absent, and then it is all zeros: a block-geometry.bin packed before D-181
    // decodes to exactly the behaviour it had, rather than to a throw.
    R.partUvRot = new Uint8Array(nParts);
    if (bytes.length - c.p >= 4) {
      var magic = c.str(4);
      if (magic !== 'UVRT') throw new Error('block-geometry.bin: expected UVRT, found ' + magic);
      for (i = 0; i < nParts; i++) R.partUvRot[i] = c.u8();
    }
    // ── the per-visual-state PARTICLE sprite (D-659) ─────────────────────────────────────
    // `BlockModels.getModelParticleSprite(state)` — the atlas layer `BlockDustParticle`
    // samples its 4x4 window from (07zx_particle.js). 0xFFFF = no particle sprite. Absent from
    // an older pack: every state reads as none, and a block breaks with no dust.
    R.stParticle = new Uint16Array(nStates).fill(0xFFFF);
    if (bytes.length - c.p >= 4) {
      var pmagic = c.str(4);
      if (pmagic !== 'PTCL') throw new Error('block-geometry.bin: expected PTCL, found ' + pmagic);
      for (i = 0; i < nStates; i++) R.stParticle[i] = c.u16();
    }
    if (c.p !== bytes.length) throw new Error('block-geometry.bin: ' + (bytes.length - c.p) + ' trailing bytes');
  };

  // ---------------------------------------------------------------- boot
  /**
   * init(data) — decode both blobs. `data` is MCL.DATA from 19_data.gen.js on the main
   * thread, or the same object rebuilt from a postMessage in a worker. Constants FIRST:
   * the geometry decoder cross-checks block order against the names it produces, and that
   * check is worth more than the twenty lines it costs.
   */
  /**
   * #4944 — vanilla's OUTLINE (getShape), INTERACTION (getInteractionShape) and VISUAL (getVisualShape) shapes.
   * The registry blob carries COLLISION only, and the outline used to be read from it: a snow layer (no collision at
   * 1 layer) outlined as a full cube, a fence as 1.5 tall, a torch as a cube. Vanilla's default for all three IS the
   * collision shape, so only the overrides are stored (tools/shapetable.mjs, from the bytecode via extract-shapes).
   * `R.outlineShape(state)` etc. -> an array of [x0,y0,z0,x1,y1,z1] boxes in blocks (possibly EMPTY: vanilla's `empty`),
   * or null = "same as the collision shape". Workers are not sent the table and always get null.
   */
  R.decodeShapes = function (t) {
    var total = R.realCount;
    R.shapeSets = null;
    R.outlineOf = R.interactionOf = R.visualOf = null;
    if (!t) return;
    R.shapeSets = t.dict.map(function (flat) {
      var o = [];
      for (var i = 0; i < flat.length; i += 6)
        o.push([flat[i] / 1024, flat[i + 1] / 1024, flat[i + 2] / 1024, flat[i + 3] / 1024, flat[i + 4] / 1024, flat[i + 5] / 1024]);
      return o;
    });
    function expand(rle) {
      var a = new Int16Array(total), p = 0;
      for (var i = 0; i < rle.length; i += 2) for (var n = rle[i + 1]; n > 0; n--) a[p++] = rle[i];
      return a;
    }
    R.outlineOf = expand(t.outline); R.interactionOf = expand(t.interaction); R.visualOf = expand(t.visual);
  };
  R.outlineShape = function (s) { return R.outlineOf && R.outlineOf[s] >= 0 ? R.shapeSets[R.outlineOf[s]] : null; };
  R.interactionShape = function (s) { return R.interactionOf && R.interactionOf[s] >= 0 ? R.shapeSets[R.interactionOf[s]] : null; };
  R.visualShape = function (s) { return R.visualOf && R.visualOf[s] >= 0 ? R.shapeSets[R.visualOf[s]] : null; };

  /**
   * buildPhysics(p) — fill `friction`, `speedFactor` and `jumpFactor` for every block.
   *
   * ⚠ THE DEFAULTS ARE NOT A GUESS AND THE EXCEPTIONS ARE NOT A LIST SOMEBODY TYPED (D-250).
   * Both come from `tools/golden/physics-1.18.2.tsv`, reflected out of the verified 1.18.2
   * server jar through Mojang's official mappings, and `merge-constants.mjs` refuses to build if
   * the golden file has drifted from the roster. Shipping the seven exceptions rather than three
   * arrays of 898 floats costs 200 bytes instead of 10 KB and cannot disagree with the source.
   *
   * ⚠ A MISSING `p` FILLS THE DEFAULTS AND SAYS SO. A worker that never received the table would
   * otherwise run a world where ice is not slippery, and nothing in the mesher or the streamer
   * would notice — the same silence D-186 charges for the structure templates.
   */
  R.buildPhysics = function (p) {
    var n = R.blockCount, i;
    var df = (p && p.defaults && p.defaults.friction) || 0.6;
    var ds = (p && p.defaults && p.defaults.speedFactor) || 1;
    var dj = (p && p.defaults && p.defaults.jumpFactor) || 1;
    R.friction = new Float32Array(n);
    R.speedFactor = new Float32Array(n);
    R.jumpFactor = new Float32Array(n);
    for (i = 0; i < n; i++) { R.friction[i] = df; R.speedFactor[i] = ds; R.jumpFactor[i] = dj; }
    R.physicsExceptions = 0;
    if (!p || !p.exceptions) { R.physicsSource = 'defaults only — no table was delivered'; return; }
    for (var name in p.exceptions) {
      var id = R.id[name];
      if (id === undefined) continue;
      var e = p.exceptions[name];
      if (e.friction !== undefined) R.friction[id] = e.friction;
      if (e.speedFactor !== undefined) R.speedFactor[id] = e.speedFactor;
      if (e.jumpFactor !== undefined) R.jumpFactor[id] = e.jumpFactor;
      R.physicsExceptions++;
    }
    R.physicsSource = 'golden 1.18.2 bytecode';
  };

  R.init = function (data) {
    var t = (NS.U && NS.U.now) ? NS.U.now() : Date.now();
    R.decodeConstants(NS.Z.unpack(data.runtime, data.runtimeBytes));
    R.decodeGeometry(NS.Z.unpack(data.geometry, data.geometryBytes));
    R.ready = true;
    // The per-real-state tables are derived here rather than by each caller, because there are
    // two callers — the main thread and every worker — and a thread that forgot would index a
    // null array in the mesher's inner loop. `data.tileAlpha` rides along in both paths
    // (MCL.DATA on the main thread, the `reg` message in a worker).
    // G4's three per-block movement fields (D-250). Built here for the same reason as the
    // tables below it: two threads reach this function and only one of them has NS.DATA.
    R.buildPhysics(data && data.physics);
    R.decodeShapes(data && data.shapes);
    // ⚠ D-346's survival-rule table rides the same way `tileAlpha` does: it is per BLOCK and
    // derived from the jar, not from anything in the geometry payload, so it arrives beside it
    // rather than inside the packed record — which keeps a checked binary format untouched.
    if (NS.States) {
      NS.States.build(data.tileAlpha, data.supportRule, data.solidMaterial,
                      { ground: data.groundRule, iceMat: data.iceMaterial,
                        occlude: data.canOcclude, outlineFull: data.outlineFull,
                        ignite: data.igniteOdds, burn: data.burnOdds,
                        sided: data.sidedLight, luminance: data.luminance });
    }
    // and the worldgen registries, for the same reason: two threads, one place that remembers.
    if (NS.WG && data.worldgen) NS.WG.init(data);
    // and D-197's placement sets, which are the join of the two above: `worldgen.bin` carries
    // the per-block floor sets as NAMES and `States` turns them into the tables `floorOk`
    // indexes. It is here rather than inside `States.build` because that runs BEFORE the
    // worldgen blob is decoded, and here rather than in `WG.init` because this is the one place
    // both the main thread and every worker reach (D-186).
    if (NS.States && NS.WG && NS.WG.ready) NS.States.buildPlacement();
    // and W4's climate parameter table, which is a third blob riding the same two paths.
    if (NS.Climate && data.biomeParams) NS.Climate.init(data);
    // and W5's two colour ramps, which `Biomes.init` needs before it can resolve a biome's
    // grass and foliage. `Biomes.init` itself waits for `WG.init` above and runs after it.
    if (NS.Biomes && data.colormaps) NS.Biomes.initColormaps(data);
    if (NS.Biomes && NS.WG && NS.WG.ready) NS.Biomes.init();
    // and PLAN G1's tag substrate, which is MAIN-THREAD ONLY (see src/02f_tags.js's header) and
    // therefore guarded by `NS.Tags` rather than by the payload alone — a worker has the bytes
    // in its `reg` message and no module to give them to. It runs AFTER the roster is decoded
    // because its membership bitset is indexed by registry block index (D-200).
    if (NS.Tags && data.tags) NS.Tags.init(data);
    // and PLAN G3's two: the tool tables (which index by registry block index, so after the
    // roster) and the loot tables (which only need the string blob). Same main-thread guard.
    if (NS.Mining && data.mining) NS.Mining.init(data);
    if (NS.Loot && data.loot) NS.Loot.init(data);
    // and then the two are joined into ONE index space — see the long note in 04e_climate.js
    if (NS.Climate && NS.Climate.ready && NS.Biomes && NS.Biomes.ready) NS.Climate.bindBiomes(NS.Biomes);
    R.decodeMs = ((NS.U && NS.U.now) ? NS.U.now() : Date.now()) - t;
    return R;
  };

  // ---------------------------------------------------------------- lookups
  /** Global visual state id for a block index and a local visual state. */
  R.visual = function (block, local) { return R.visFirst[block] + local; };
  /** Global real state id for a block index and a local real state. */
  R.real = function (block, local) { return R.realFirst[block] + local; };
  /** The block a global visual state belongs to. Binary search; not for inner loops. */
  R.blockOfVisual = function (v) {
    var lo = 0, hi = R.blockCount - 1;
    while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (R.visFirst[mid] <= v) lo = mid; else hi = mid - 1; }
    return lo;
  };
  /** Does this visual state present a full face on `dir` (0..5)? The mesher's cull test. */
  R.occludes = function (visualState, dir) { return (R.occlusion[visualState] >> dir) & 1; };
  /** Is this block see-through? Glass is a full cube and must NOT cull its neighbour. */
  R.transparent = function (block) { return (R.flags[block] & R.FLAG_TRANSPARENT) !== 0; };
  /**
   * D-263 — vanilla's `Material.isReplaceable()`, per BLOCK, out of the jar's bytecode via
   * `tools/extract-materials.mjs`. 28 of 898 blocks. Everything else refuses to be overwritten
   * and a placed block goes on the clicked face instead. ⚠ Do not re-derive this from geometry:
   * that is the bug this replaced, and it made 139 blocks overwritable.
   */
  R.replaceable = function (block) { return (R.flags[block] & R.FLAG_REPLACEABLE) !== 0; };
  R.needsTool = function (block) { return (R.flags[block] & R.FLAG_NEEDS_TOOL) !== 0; };
  /**
   * The support class of a block: 0 none · 1 floor · 2 ceiling · 3 any face (D-140) ·
   * 4 behind, the neighbour opposite its `facing` — the wall a wall torch hangs on (D-158).
   * ⚠ THREE bits, not two. It outgrew two the moment class 4 existed, and a stale `& 3` here
   * reads a wall-mounted block as class 0 — no rule at all — which is silent.
   */
  R.support = function (block) { return (R.flags[block] >> 4) & 7; };
  /** Seconds to break bare-handed. Infinity for unbreakable. The one true break-time formula. */
  R.breakSeconds = function (block) {
    var h = R.hard[block];
    if (!isFinite(h)) return Infinity;
    return h * (R.needsTool(block) ? 100 : 30) / 20;
  };

  /**
   * Which part a visual state draws for group `g`, choosing among alternatives by position.
   * The choice must be a pure function of (x, y, z) so the same block looks the same
   * whichever direction the player walks in — the same invariant the worldgen lives by.
   */
  R.partFor = function (visualState, g, x, y, z) {
    var a0 = R.grpAltOff[R.stGroupOff[visualState] + g];
    var a1 = R.grpAltOff[R.stGroupOff[visualState] + g + 1];
    var n = a1 - a0;
    if (n === 1) return R.altPart[a0];
    var total = 0, i;
    for (i = a0; i < a1; i++) total += R.altWeight[i];
    // a cheap, well-mixed integer hash of the position — the same one the scatter features
    // use, so two systems asking "which variant here" never disagree
    var h = (x * 3129871) ^ (z * 116129781) ^ (y * 3266489917);
    h = (h ^ (h >>> 15)) * 2246822519;
    h = (h ^ (h >>> 13)) * 3266489917;
    h = (h ^ (h >>> 16)) >>> 0;
    var pick = h % total;
    for (i = a0; i < a1; i++) { pick -= R.altWeight[i]; if (pick < 0) return R.altPart[i]; }
    return R.altPart[a0];
  };
  /** How many groups a visual state draws. Every group is drawn; one alternative per group. */
  R.groupCount = function (visualState) { return R.stGroupOff[visualState + 1] - R.stGroupOff[visualState]; };
})(MCL);
