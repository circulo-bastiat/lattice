// 05_mesher.js — greedy mesher + vertex packing (docs/archive/ARCH.md §8, D-22..D-26, D-56, D-68, D-69).
// Runs on: main thread AND workers. No DOM.
//
// SHAPE OF THE ALGORITHM
//   1. unpack the 27-section MeshSnapshot into an 18^3 scratch volume (blocks + light).
//      A null neighbour becomes an OPAQUE sentinel, so the load frontier never grows a wall of
//      geometry facing the void (D-41).
//   2. for each of the 6 faces, for each of the 16 slices perpendicular to it, build a 16x16
//      mask of "face keys" and greedy-merge equal-key rectangles.
//      The key is (tile, 4x AO, skylight, blocklight, tint, animated) packed into 31 bits, so
//      "can these two faces merge?" is one integer compare (D-68).
//   3. cross-model blocks (grass tufts, flowers, torches) are emitted separately as two
//      double-sided diagonal quads. Their corners are integers, so they fit the vertex format
//      exactly (D-56).
//
// The output buffer format in §8 is FINAL and is consumed byte-for-byte by both backends.

(function (NS) {
  'use strict';

  var CFG = NS.CFG;

  var M = NS.Mesher = {};

  /**
   * Mesh detail options (docs/archive/ARCH.md 8.1). Set once per THREAD from the {t:'init'} message so the
   * main thread and every worker agree; changing them requires World.remeshAll(), which is exactly
   * what Settings.applyPreset does. `mesh()` reads M.OPT unless an explicit opts object is passed.
   *
   *   ao     bake per-vertex ambient occlusion (D-24). Off writes ao=3 everywhere, which also
   *          removes AO from the greedy merge key and therefore MERGES MORE — a cheap win twice.
   *   cross  emit cross-model plants (D-56). Off drops grass tufts and flowers entirely.
   *   fastLeaves  vanilla's fast-graphics leaves — see Blocks.setFastLeaves (D-93). This one
   *          mutates the shared block table rather than branching in the mesh loop.
   */
  M.OPT = { ao: true, cross: true, fastLeaves: false, realModels: true, smooth: true };
  M.setOptions = function (o) {
    if (!o) return M.OPT;
    if (o.ao !== undefined) M.OPT.ao = !!o.ao;
    if (o.smooth !== undefined) M.OPT.smooth = !!o.smooth;
    if (o.cross !== undefined) M.OPT.cross = !!o.cross;
    if (o.realModels !== undefined) M.OPT.realModels = !!o.realModels;
    if (o.fastLeaves !== undefined) {
      M.OPT.fastLeaves = !!o.fastLeaves;
      // This one is not a mesher flag at all — it edits the per-state tables both threads
      // share, so that the face-culling and layer decisions in the inner loop stay a plain
      // array read. See States.setFastLeaves for what it touches and why lighting is not in it.
      if (NS.States && NS.States.setFastLeaves) NS.States.setFastLeaves(M.OPT.fastLeaves);
    }
    return M.OPT;
  };

  // --- vertex packing (docs/archive/ARCH.md §8). Both backends decode these exact bits. -------------

  /**
   * data0: x:0-5 y:6-11 z:12-17 face:18-20 ao:21-22 sky:23-26 block:27-30 flag:31
   * All arguments are already clamped by the caller; this is inner-loop code.
   */
  M.packData0 = function (x, y, z, face, ao, sky, blk, flag) {
    return ((x & 63)) | ((y & 63) << 6) | ((z & 63) << 12) |
           ((face & 7) << 18) | ((ao & 3) << 21) |
           ((sky & 15) << 23) | ((blk & 15) << 27) | ((flag & 1) << 31);
  };

  /** data1: tile:0-11 uRep:12-19 vRep:20-27 corner:28-29 tint:30-31 */
  M.packData1 = function (tile, uRep, vRep, corner, tint) {
    return ((tile & 4095)) | ((uRep & 255) << 12) | ((vRep & 255) << 20) |
           ((corner & 3) << 28) | ((tint & 3) << 30);
  };

  /**
   * Classic 3-neighbour AO. side1/side2/corner are 1 when the neighbouring voxel is opaque.
   * Returns 0 (darkest) .. 3 (unoccluded). Baked into the vertex at mesh time (D-24).
   */
  M.aoValue = function (side1, side2, corner) {
    if (side1 && side2) return 0;
    return 3 - (side1 + side2 + corner);
  };

  /**
   * Corner offsets for a unit face, wound counter-clockwise seen from outside, with the corner
   * id that gives (u,v) = (0,0) top-left / (1,1) bottom-right (docs/archive/ARCH.md §8).
   * This is the SAME table as Gfx.faceCorners; Gfx owns the reference copy because it is the
   * renderer's contract, and the mesher carries its own because the mesher runs in a worker
   * where Gfx does not exist. tools/gencheck.mjs asserts the two are identical (D-69).
   */
  M.faceCorners = function (face, w, h) {
    switch (face) {
      case 0: return [[1,h,0,0],[1,h,w,1],[1,0,w,2],[1,0,0,3]];      // +X
      case 1: return [[0,h,w,0],[0,h,0,1],[0,0,0,2],[0,0,w,3]];      // -X
      case 2: return [[0,1,0,0],[0,1,h,3],[w,1,h,2],[w,1,0,1]];      // +Y
      case 3: return [[0,0,h,0],[0,0,0,3],[w,0,0,2],[w,0,h,1]];      // -Y
      case 4: return [[0,h,1,0],[0,0,1,3],[w,0,1,2],[w,h,1,1]];      // +Z
      default:return [[w,h,0,0],[w,0,0,3],[0,0,0,2],[0,h,0,1]];      // -Z
    }
  };

  // Corner TEMPLATES, derived once from faceCorners so there is still exactly one source of
  // truth for winding, but the mesh loop allocates nothing. Each face gets 16 bytes:
  // 4 vertices x [tx, ty, tz, cornerId], where a component type is 0 -> 0, 1 -> 1, 2 -> w, 3 -> h.
  var CORNER_TBL = null;
  function buildCornerTable() {
    CORNER_TBL = [];
    for (var f = 0; f < 6; f++) {
      var c = M.faceCorners(f, 2, 3);           // 2 and 3 are distinguishable from 0 and 1
      var t = new Int8Array(16);
      for (var v = 0; v < 4; v++) {
        for (var k = 0; k < 3; k++) {
          var val = c[v][k];
          t[v * 4 + k] = val === 0 ? 0 : (val === 1 ? 1 : (val === 2 ? 2 : 3));
        }
        t[v * 4 + 3] = c[v][3];
      }
      CORNER_TBL.push(t);
    }
    return CORNER_TBL;
  }
  M.cornerTable = function () { return CORNER_TBL || buildCornerTable(); };

  /**
   * Per-face axis roles, derived from faceCorners and asserted against it by gencheck.
   * [fixedAxis, aAxis, bAxis, dir]  — axes are 0=x 1=y 2=z; `a` carries uRep, `b` carries vRep.
   */
  var FACE_AXIS = [
    [0, 2, 1,  1],   // +X : fixed X at +1, u along +Z, v along -Y
    [0, 2, 1, -1],   // -X
    [1, 0, 2,  1],   // +Y : fixed Y at +1, u along +X, v along +Z
    [1, 0, 2, -1],   // -Y
    [2, 0, 1,  1],   // +Z : fixed Z at +1, u along +X, v along -Y
    [2, 0, 1, -1]    // -Z
  ];
  M.FACE_AXIS = FACE_AXIS;

  // --- neighbourhood access -------------------------------------------------

  /**
   * Scratch 18^3 volumes, allocated once per thread and reused (D-40). The worker unpacks the
   * MeshSnapshot's 27 packed sections into these; nothing else ever allocates in the mesh path.
   */
  M.scratchBlocks = null;   // Uint16Array(18*18*18)  — REGISTRY REAL STATE ids
  M.scratchLight  = null;   // Uint8Array(18*18*18)
  // The baked PART each cube cell draws, resolved once per voxel instead of once per face.
  // A state with several random alternatives (stone has four) picks by world position, so the
  // choice has to be made somewhere; making it here costs one hash per voxel instead of six.
  M.scratchPart   = null;   // Uint16Array(18*18*18)

  var PSX = 1, PSZ = 18, PSY = 324, PBASE = 324 + 18 + 1;   // pidx(1,1,1)
  var PSTRIDE = [PSX, PSY, PSZ];                            // by axis index 0=x 1=y 2=z

  M.ensureScratch = function () {
    if (!M.scratchBlocks) {
      M.scratchBlocks = new Uint16Array(18 * 18 * 18);
      M.scratchLight  = new Uint8Array(18 * 18 * 18);
      M.scratchPart   = new Uint16Array(18 * 18 * 18);
    }
  };

  /** Padded index: px,py,pz in 0..17 (1..16 is the section itself). */
  M.pidx = function (px, py, pz) { return (py * 18 + pz) * 18 + px; };

  // Per-bits decode tables for reading a packed section without going through Section.get
  // (that is a function call per voxel; this is the mesher's hottest loop).
  var SHIFT = [], IMASK = [], VMASK = [];
  (function () {
    var list = [1, 2, 4, 8, 16];
    for (var b = 0; b <= 16; b++) { SHIFT[b] = 0; IMASK[b] = 0; VMASK[b] = 0; }
    for (var k = 0; k < list.length; k++) {
      var b2 = list[k], per = 32 / b2;
      SHIFT[b2] = Math.log2(per) | 0;
      IMASK[b2] = per - 1;
      VMASK[b2] = b2 === 16 ? 0xFFFF : ((1 << b2) - 1);
    }
  })();

  M.hasModel = false;      // does the centre section hold any state that needs the model stream?
  M.lastVis = 0x7FFF;      // visibility mask of the section meshed most recently (ARCH 9.1)

  // mesher face -> the registry direction of THIS block's own quad facing that way, and back.
  // mesher: 0 +X 1 -X 2 +Y 3 -Y 4 +Z 5 -Z   ·   registry: 0 down 1 up 2 north 3 south 4 west 5 east
  var OWN_FACE = [5, 4, 1, 0, 3, 2];
  var MESH_OF_DIR = [3, 2, 5, 4, 1, 0];
  M.OWN_FACE = OWN_FACE;
  M.MESH_OF_DIR = MESH_OF_DIR;
  // padded-volume offset for each mesher face, so a neighbour is one add away
  var NOFF = null;

  // An opaque full cube used where a neighbour section has not been generated: every face that
  // looks at it culls, so the world does not grow a shell of faces at the edge of the loaded
  // area (D-41). Resolved once, after the registry is decoded.
  var SENTINEL = -1;
  M.sentinel = function () {
    if (SENTINEL < 0) SENTINEL = NS.States && NS.States.ready ? NS.States.stateOf('stone') : 1;
    return SENTINEL;
  };
  /** Drop everything cached from the registry. Workers call this after Reg.init. */
  M.resetRegistryCache = function () { SENTINEL = -1; };

  /**
   * unpack(snap) — expand MeshSnapshot.nb (27 Sections or nulls) into the scratch volumes.
   * A null slot is written as an opaque sentinel so we do not mesh against the void (D-41).
   *
   * Cost note: this touches 18^3 = 5832 cells, but 26 of the 27 slots only contribute a 1-voxel
   * shell, so the inner loops are short and the uniform fast path is a constant store.
   */
  M.unpack = function (snap, ox, oy, oz) {
    M.ensureScratch();
    var blocks = M.scratchBlocks, light = M.scratchLight, parts = M.scratchPart;
    var SR = NS.States, R = NS.Reg;
    var SENT = M.sentinel();
    var geom = SR.geom, multi = SR.multi, alt1 = SR.alt1, vis = SR.vis;
    ox = ox | 0; oy = oy | 0; oz = oz | 0;
    M.hasModel = false;

    for (var dy = -1; dy <= 1; dy++) {
      var py0 = dy < 0 ? 0 : (dy > 0 ? 17 : 1), py1 = dy === 0 ? 16 : py0;
      for (var dz = -1; dz <= 1; dz++) {
        var pz0 = dz < 0 ? 0 : (dz > 0 ? 17 : 1), pz1 = dz === 0 ? 16 : pz0;
        for (var dx = -1; dx <= 1; dx++) {
          var px0 = dx < 0 ? 0 : (dx > 0 ? 17 : 1), px1 = dx === 0 ? 16 : px0;
          var sec = snap.nb[(dy + 1) * 9 + (dz + 1) * 3 + (dx + 1)];
          var centre = (dx === 0 && dy === 0 && dz === 0);

          if (!sec) {
            for (var py = py0; py <= py1; py++) for (var pz = pz0; pz <= pz1; pz++) {
              var o = py * PSY + pz * PSZ;
              for (var px = px0; px <= px1; px++) { blocks[o + px] = SENT; light[o + px] = 0; }
            }
            continue;
          }

          var uni = sec.u >= 0, uid = sec.u;
          var lUni = sec.lu >= 0, lb = sec.lu;
          var pal = sec.p, d = sec.d, b = sec.b, l = sec.l;
          var sh = SHIFT[b], im = IMASK[b], vm = VMASK[b];

          for (py = py0; py <= py1; py++) {
            var sy = (py - 1 - dy * 16) & 15;
            for (pz = pz0; pz <= pz1; pz++) {
              var sz = (pz - 1 - dz * 16) & 15;
              var po = py * PSY + pz * PSZ;
              var so = (sy << 8) | (sz << 4);
              for (px = px0; px <= px1; px++) {
                var sx = (px - 1 - dx * 16) & 15;
                var si = so | sx;
                var id = uni ? uid : pal[(d[si >>> sh] >>> ((si & im) * b)) & vm];
                blocks[po + px] = id;
                light[po + px] = lUni ? lb : l[si];
                if (centre && id) {
                  var gm = geom[id];
                  if (gm === 2) M.hasModel = true;
                  else if (gm === 1) {
                    // ⚠ WORLD coordinates, not section-local. Vanilla hashes the world position
                    // to pick among a state's random variants, so hashing a local one would make
                    // the pattern restart at every section boundary — a visible 16-block grid
                    // across any large stone face.
                    parts[po + px] = multi[id]
                      ? R.partFor(vis[id], 0, ox + px - 1, oy + py - 1, oz + pz - 1)
                      : alt1[id];
                  }
                }
              }
            }
          }
        }
      }
    }
  };

  // --- section visibility mask (docs/archive/ARCH.md 9.1, D-85) ---------------------
  //
  // The Minecraft chunk-visibility graph, computed here because this is the one place that
  // already holds the section unpacked. Flood-fill the NON-OPAQUE cells of the centre 16^3;
  // every connected component records which of the six section faces it touches; every pair of
  // faces a single component touches becomes one bit of a 15-bit mask. `Gfx` then floods the
  // section grid outward from the camera and only visits a neighbour it can actually see
  // THROUGH — a section of solid stone connects nothing and stops the flood dead.
  //
  // Faces are ARCH 3 numbering. The 15 unordered pairs (a<b) are indexed by PAIRBIT[a*6+b].

  var PAIRBIT = new Int8Array(36);
  (function () {
    for (var i = 0; i < 36; i++) PAIRBIT[i] = -1;
    var n = 0;
    for (var a = 0; a < 6; a++) for (var b = a + 1; b < 6; b++) { PAIRBIT[a * 6 + b] = n; PAIRBIT[b * 6 + a] = n; n++; }
  })();
  M.PAIRBIT = PAIRBIT;
  M.VIS_ALL = 0x7FFF;            // all 15 pairs connected (an air section)

  /** Does mask connect face `from` to face `to`? Faces must differ. */
  M.visConnected = function (mask, from, to) {
    if (from === to) return true;
    var b = PAIRBIT[from * 6 + to];
    return b < 0 ? true : ((mask >>> b) & 1) !== 0;
  };

  var visSeen = new Uint8Array(4096);
  var visQueue = new Int32Array(4096);
  var visStamp = 0;

  /**
   * visibility() -> 15-bit mask, over M.scratchBlocks (so unpack() must have run).
   * Cost is one pass over 4096 cells plus a BFS bounded by the same 4096; a uniform section
   * (which is most of the world) short-circuits before either.
   */
  M.visibility = function (uniformId) {
    // D-440: the graph's own occlusion test (canOcclude && full-cube outline), not material
    // opacity — see SR.visOpaque's header in 02c_states.js. A cactus (or any inset model) no
    // longer blocks the flood the way a full block does.
    var opaque = NS.States.visOpaque;
    if (uniformId !== undefined && uniformId >= 0) return opaque[uniformId] ? 0 : M.VIS_ALL;

    var blocks = M.scratchBlocks;
    var seen = visSeen, q = visQueue;
    visStamp = (visStamp + 1) & 255;
    if (visStamp === 0) { seen.fill(0); visStamp = 1; }
    var stamp = visStamp;

    var mask = 0, li, po;
    for (var ly = 0; ly < 16; ly++) {
      var pyo = (ly + 1) * PSY;
      for (var lz = 0; lz < 16; lz++) {
        var pzo = pyo + (lz + 1) * PSZ;
        var lbase = (ly << 8) | (lz << 4);
        for (var lx = 0; lx < 16; lx++) {
          li = lbase | lx;
          if (seen[li] === stamp) continue;
          if (opaque[blocks[pzo + lx + 1]]) { seen[li] = stamp; continue; }

          // BFS one component, collecting the faces it touches
          var faces = 0, head = 0, tail = 0;
          q[tail++] = li; seen[li] = stamp;
          while (head < tail) {
            var c = q[head++];
            var cx = c & 15, cz = (c >> 4) & 15, cy = c >> 8;
            if (cx === 0)  faces |= 2;    // -X = face 1
            if (cx === 15) faces |= 1;    // +X = face 0
            if (cy === 0)  faces |= 8;    // -Y = face 3
            if (cy === 15) faces |= 4;    // +Y = face 2
            if (cz === 0)  faces |= 32;   // -Z = face 5
            if (cz === 15) faces |= 16;   // +Z = face 4
            po = (cy + 1) * PSY + (cz + 1) * PSZ + (cx + 1);
            if (cx > 0  && seen[c - 1] !== stamp   && !opaque[blocks[po - PSX]]) { seen[c - 1] = stamp; q[tail++] = c - 1; }
            if (cx < 15 && seen[c + 1] !== stamp   && !opaque[blocks[po + PSX]]) { seen[c + 1] = stamp; q[tail++] = c + 1; }
            if (cz > 0  && seen[c - 16] !== stamp  && !opaque[blocks[po - PSZ]]) { seen[c - 16] = stamp; q[tail++] = c - 16; }
            if (cz < 15 && seen[c + 16] !== stamp  && !opaque[blocks[po + PSZ]]) { seen[c + 16] = stamp; q[tail++] = c + 16; }
            if (cy > 0  && seen[c - 256] !== stamp && !opaque[blocks[po - PSY]]) { seen[c - 256] = stamp; q[tail++] = c - 256; }
            if (cy < 15 && seen[c + 256] !== stamp && !opaque[blocks[po + PSY]]) { seen[c + 256] = stamp; q[tail++] = c + 256; }
          }
          if (faces) {
            for (var a = 0; a < 6; a++) {
              if (!(faces & (1 << a))) continue;
              for (var b2 = a + 1; b2 < 6; b2++) {
                if (faces & (1 << b2)) mask |= 1 << PAIRBIT[a * 6 + b2];
              }
            }
          }
          if (mask === M.VIS_ALL) return mask;   // nothing left to learn
        }
      }
    }
    return mask;
  };

  // --- greedy scratch --------------------------------------------------------
  // The mask is rebuilt for each of the 96 slices (6 faces x 16). Two flat arrays, allocated
  // once: `mKey` is 0 for "no face here", otherwise the 31-bit merge key; `mLay` is the layer.
  var mKey = new Int32Array(256);
  var mLay = new Uint8Array(256);
  // D-415 — the four CORNER light bytes of each face, one per (ca, cb), packed
  // `c00 | c10<<8 | c01<<16 | c11<<24`. See `M.OPT.smooth`.
  var mLit = new Int32Array(256);

  // Per-layer vertex scratch. Grown on demand, never shrunk. Two uint32 per vertex, 4 vertices
  // per quad = 8 words per quad.
  var vbuf = [null, null, null];
  var vcap = [0, 0, 0];
  var vlen = [0, 0, 0];

  function ensureCap(layer, quadsNeeded) {
    var need = quadsNeeded * 8;
    if (vcap[layer] >= need) return true;
    var cap = vcap[layer] || 2048 * 8;
    while (cap < need) cap *= 2;
    var max = CFG.MAX_QUADS * 8;
    if (cap > max) cap = max;
    if (cap < need) return false;
    var nb = new Uint32Array(cap);
    if (vbuf[layer]) nb.set(vbuf[layer].subarray(0, vlen[layer]));
    vbuf[layer] = nb; vcap[layer] = cap;
    return true;
  }

  /**
   * One vertex's light: the mean of the cells touching it on the neighbour side (D-415).
   *
   *   ni            the cell the face looks INTO — always counted; it is by construction not
   *                 covering this face, so it is where the light for this face comes from
   *   da, db        the signed strides toward this corner along the face's two in-plane axes
   *   oa, ob, oc    the three occlusion flags `aoValue` was already handed for this corner
   *
   * A side is dropped when it is opaque, and the diagonal is dropped when it is opaque or when
   * BOTH sides are — the same "you cannot see round two solid blocks" rule the AO term encodes.
   * Returns a packed `sky<<4 | block` byte, the same shape `light[]` holds.
   */
  function cornerLight(light, opaque, blocks, ni, da, db, oa, ob, oc) {
    var l = light[ni], sky = l >> 4, blk = l & 15, n = 1, l2;
    if (!oa) { l2 = light[ni + da]; sky += l2 >> 4; blk += l2 & 15; n++; }
    if (!ob) { l2 = light[ni + db]; sky += l2 >> 4; blk += l2 & 15; n++; }
    if (!oc && !(oa && ob)) { l2 = light[ni + da + db]; sky += l2 >> 4; blk += l2 & 15; n++; }
    return (((sky / n) | 0) << 4) | ((blk / n) | 0);
  }

  var overflowWarned = false;

  // --- the mesher ----------------------------------------------------------

  /**
   * mesh(snap, opts) -> ArrayBuffer | null
   *
   * Output is the §8 buffer: 32-byte header then tightly packed quads, 4 vertices x 8 bytes.
   * Returns null when the section produces no geometry at all (very common: air and buried stone).
   */
  M.mesh = function (snap, opts, ox, oy, oz) {
    if (!CORNER_TBL) buildCornerTable();
    if (!NOFF) NOFF = [PSX, -PSX, PSY, -PSY, PSZ, -PSZ];
    var O = opts || M.OPT;
    var wantAO = O.ao !== false, wantCross = O.cross !== false;
    // ⚠⚠ **SMOOTH LIGHTING IS THE OTHER HALF OF THE OPTION, AND IT WAS NEVER BUILT (D-415).**
    // `Settings.smoothLighting` has been wired to `ao` alone since the menu existed, with a
    // comment saying "AO is the visible half of it". It is not: AO only darkens the CORNERS of
    // concave geometry, which in an open field is a handful of pixels around a tree trunk —
    // measured, 3.9% of the frame. What makes vanilla's Smooth Lighting unmistakable is the
    // LIGHT: each vertex takes the average of the four cells that touch it, so a torch in a
    // cave, a doorway, an overhang all get a gradient instead of a hard per-face step. Dan
    // toggled the option, correctly saw nothing, and said so.
    //
    // `smooth` defaults to whatever `ao` is, because they are one option in the menu and in
    // vanilla; a caller may still set them apart (the checks do).
    var wantSmooth = O.smooth === undefined ? wantAO : (O.smooth !== false);
    M.unpack(snap, ox, oy, oz);
    // The visibility mask is computed here, on the unpacked volume, and travels back to the main
    // thread in header word 7 (and in the mesh:done message, because a section with no geometry
    // still has to take part in the flood). ARCH 9.1 / D-85.
    var centre = snap.nb[13];
    M.lastVis = M.visibility(centre ? centre.u : -1);
    var SR = NS.States;
    var blocks = M.scratchBlocks, light = M.scratchLight, parts = M.scratchPart;
    var opaque = SR.opaque, layerOf = SR.layer;
    // The cull mask IS the table now — a 6-bit geometric mask per real state, ANDed with the
    // material's opacity at build time. The old `opaque[neighbour]` boolean was only ever right
    // while every block in the world was a full cube, which stopped being true this session.
    var culls = SR.cull;
    var selfCull = SR.selfCull, animOf = SR.anim, geom = SR.geom, waterIn = SR.waterIn;
    var partTiles = SR.partTiles, partTint = SR.partTint;
    var fCell = SR.fluidCell, fKind = SR.fluidKind;

    vlen[0] = vlen[1] = vlen[2] = 0;
    var quads = [0, 0, 0];
    var total = 0;
    var MAXQ = CFG.MAX_QUADS;

    for (var face = 0; face < 6; face++) {
      var ax = FACE_AXIS[face];
      var sF = PSTRIDE[ax[0]], sA = PSTRIDE[ax[1]], sB = PSTRIDE[ax[2]];
      var sN = ax[3] * sF;
      var tbl = CORNER_TBL[face];

      for (var k = 0; k < 16; k++) {
        var slice = PBASE + k * sF;
        var any = 0;

        // ---- build the mask ------------------------------------------------
        for (var b2 = 0; b2 < 16; b2++) {
          var rowBase = slice + b2 * sB;
          var mrow = b2 << 4;
          for (var a2 = 0; a2 < 16; a2++) {
            var pi = rowBase + a2 * sA;
            var id = blocks[pi];
            if (id === 0) { mKey[mrow + a2] = 0; continue; }
            // Only FULL CUBES take the greedy path. Everything else — 17,356 of the 20,344
            // real states — is a baked model and goes through the second pass below, where a
            // quad carries its own position instead of being merged with its neighbours.
            if (geom[id] !== 1) { mKey[mrow + a2] = 0; continue; }
            var ni = pi + sN;
            var nid = blocks[ni];
            // #1263 — a fluid cell with no fluid of its own kind above it has a sloped top and
            // per-corner heights: it is drawn by the fluid pass below, every face of it. One with
            // the same fluid above is a plain full cube, and a face against the same fluid is
            // vanilla's `isSameFluid` cull (lava too: its levels are different ids).
            if (fCell && fCell[id]) {
              if (fKind[blocks[pi + PSY]] !== fKind[id]) { mKey[mrow + a2] = 0; continue; }
              if (fKind[nid] === fKind[id]) { mKey[mrow + a2] = 0; continue; }
            }
            // Cull only if the NEIGHBOUR actually covers this face — SR.cull, the 6-bit
            // geometric mask ANDed with material opacity. `opaque[nid]` was the old test and
            // it is only right while every block in the world is a full cube.
            if ((culls[nid] >> face) & 1) { mKey[mrow + a2] = 0; continue; }
            if (nid === id && selfCull[id]) { mKey[mrow + a2] = 0; continue; }
            // ⚠ WATER AGAINST ANYTHING THAT ALSO HOLDS WATER (D-168). Vanilla asks a block for
            // its `getFluidState`, and for seagrass, kelp and a waterlogged stair that answer is
            // water — the plant and the water are in the SAME cell, so there is no surface
            // between them. `selfCull` only matches an identical id, so a seagrass sat in a
            // bubble of air on the sea floor and every underwater plant carved a hole in the
            // ocean. Dan recognised it: MineHTML had the same bug.
            if (waterIn[id] && waterIn[nid]) { mKey[mrow + a2] = 0; continue; }

            // AO: the 8 voxels around the neighbour cell, in the face's own plane. Eight loads
            // per face, so they are skipped entirely when the preset turns AO off.
            var oA = 0, oA2 = 0, oB = 0, oB2 = 0, c00 = 0, c10 = 0, c01 = 0, c11 = 0;
            if (wantAO) {
              oA = opaque[blocks[ni - sA]]; oA2 = opaque[blocks[ni + sA]];
              oB = opaque[blocks[ni - sB]]; oB2 = opaque[blocks[ni + sB]];
              c00 = opaque[blocks[ni - sA - sB]]; c10 = opaque[blocks[ni + sA - sB]];
              c01 = opaque[blocks[ni - sA + sB]]; c11 = opaque[blocks[ni + sA + sB]];
            }
            var ao0 = 3, ao1 = 3, ao2 = 3, ao3 = 3;
            if (wantAO) {
              ao0 = M.aoValue(oA,  oB,  c00);      // (ca,cb) = (0,0)
              ao1 = M.aoValue(oA2, oB,  c10);      // (1,0)
              ao2 = M.aoValue(oA,  oB2, c01);      // (0,1)
              ao3 = M.aoValue(oA2, oB2, c11);      // (1,1)
            }

            var lb = light[ni];
            // ⚠ **THE FOUR CORNER LIGHTS.** Each vertex takes the mean of the cells that touch
            // it ON THE NEIGHBOUR SIDE — the face's own cell plus the two sides and the corner
            // — skipping the ones an opaque block occludes, which is the same occlusion test
            // `aoValue` above already made from the same eight reads. Sky and block are averaged
            // SEPARATELY: they are two independent channels in the packed byte and in the
            // shader, and averaging the byte would bleed one into the other.
            //
            // ⚠ A DEVIATION, NAMED: vanilla's `AmbientOcclusionFace` blends the four brightnesses
            // with the same weights it uses for AO rather than taking a plain mean. The mean is
            // what every other voxel engine does, it is within a light level of vanilla's result
            // on every shape this game has, and it costs four adds instead of a weight table —
            // rendering is where MC-Lite is allowed to be cheap (CLAUDE.md's own table).
            var lit0 = lb, lit1 = lb, lit2c = lb, lit3 = lb;
            if (wantSmooth) {
              lit0 = cornerLight(light, opaque, blocks, ni, -sA, -sB, oA,  oB,  c00);
              lit1 = cornerLight(light, opaque, blocks, ni,  sA, -sB, oA2, oB,  c10);
              lit2c = cornerLight(light, opaque, blocks, ni, -sA,  sB, oA,  oB2, c01);
              lit3 = cornerLight(light, opaque, blocks, ni,  sA,  sB, oA2, oB2, c11);
            }
            mLit[mrow + a2] = (lit0 | (lit1 << 8) | (lit2c << 16) | (lit3 << 24)) | 0;
            // The tile and the tint come from the PART this voxel resolved to in unpack(), and
            // they are indexed in REGISTRY direction order, so the mesher face has to be
            // translated. Both ride in the merge key, which is what makes two adjacent stone
            // blocks that rolled different variants refuse to merge — exactly as they should.
            var pto = parts[pi] * 6 + OWN_FACE[face];
            var key = (partTiles[pto] & 4095) |
                      ((ao0 | (ao1 << 2) | (ao2 << 4) | (ao3 << 6)) << 12) |
                      ((lb & 0xF0) << 16) |          // sky  -> bits 20..23
                      ((lb & 0x0F) << 24) |          // block-> bits 24..27
                      ((partTint[pto] & 3) << 28) |
                      (animOf[id] << 30);
            mKey[mrow + a2] = key | 0;
            mLay[mrow + a2] = layerOf[id];
            any = 1;
          }
        }
        if (!any) continue;

        // ---- greedy merge ---------------------------------------------------
        for (b2 = 0; b2 < 16; b2++) {
          for (a2 = 0; a2 < 16;) {
            var mi = (b2 << 4) + a2;
            var key2 = mKey[mi];
            if (key2 === 0) { a2++; continue; }
            var lay = mLay[mi];
            // ⚠ D-415 — TWO CELLS MERGE ONLY IF THEIR FOUR CORNER LIGHTS AGREE AS WELL. A
            // merged rectangle carries ONE set of corner values; merging across a light gradient
            // would smear one cell's lighting over the whole run. Where the light is flat — an
            // open field under sky 15, the inside of a lit room — every cell's word is identical
            // and the merge is exactly as good as it was. It is the same trade AO already makes
            // by sitting in the merge key, and the reason turning the option OFF merges MORE.
            var lit2 = mLit[mi];

            var w = 1;
            while (a2 + w < 16 && mKey[mi + w] === key2 && mLay[mi + w] === lay &&
                   mLit[mi + w] === lit2) w++;

            var h = 1;
            outer:
            while (b2 + h < 16) {
              var rb = ((b2 + h) << 4) + a2;
              for (var q = 0; q < w; q++) {
                if (mKey[rb + q] !== key2 || mLay[rb + q] !== lay || mLit[rb + q] !== lit2) break outer;
              }
              h++;
            }

            for (var yy = 0; yy < h; yy++) {
              var cb = ((b2 + yy) << 4) + a2;
              for (q = 0; q < w; q++) mKey[cb + q] = 0;
            }

            if (total < MAXQ && ensureCap(lay, quads[lay] + 1)) {
              emitQuad(face, ax, k, a2, b2, w, h, key2, lay, tbl, lit2);
              quads[lay]++; total++;
            } else if (!overflowWarned) {
              overflowWarned = true;
              if (typeof console !== 'undefined' && console.warn) {
                console.warn('MC-Lite mesher: section exceeded MAX_QUADS, geometry clipped');
              }
            }
            a2 += w;
          }
        }
      }
    }

    // ---- the model stream: everything that is not a full cube ---------------
    //
    // Stairs, slabs, fences, walls, doors, plants, torches — 17,356 of the 20,344 real states.
    // Each one's geometry was rotated, uvlocked, cullface-resolved and tinted at BUILD time
    // (tools/bake-geometry.mjs), so all that happens here is a translate and a copy.
    //
    // ⚠ THE NEIGHBOUR CULL MASK IS COMPUTED HERE, and it is new this session. A baked quad
    // carries the direction whose neighbour is allowed to remove it — vanilla's `cullface`.
    // Before the swap this path only ever drew five plants and a torch, none of which have a
    // cullface at all, so nothing was ever culled and nobody noticed. With 900 blocks in the
    // world, a floor of slabs would draw its own hidden underside on every block: 16x16x2
    // invisible quads per section, in the pass that cannot early-Z them away. So each cell
    // gets a 6-bit mask of "which of my faces does a neighbour cover?", built from the same
    // `culls` table the greedy path uses, and both the counting pass and the emitting pass
    // take it — they MUST agree or the buffer is the wrong size.
    var mQuads = [0, 0, 0];
    var modelList = null;
    var wantModels = (O.realModels !== false) && NS.Reg && NS.Reg.ready;
    // ⚠ `cross` NO LONGER GATES THE WHOLE PASS (D-130). It drops DECOR — geometry that occludes
    // nothing and is opaque to nothing — one state at a time, inside the loop. Gating the pass
    // deleted every slab, stair, carpet, cactus and grass block from the world along with the
    // flowers, because all of them are model geometry now.
    var decorOf = SR.decor;

    if (M.hasModel && wantModels) {
      for (var py = 1; py <= 16; py++) {
        for (var pz = 1; pz <= 16; pz++) {
          var po = py * PSY + pz * PSZ;
          for (var px = 1; px <= 16; px++) {
            var pi2 = po + px;
            var cid = blocks[pi2];
            if (!cid || geom[cid] !== 2) continue;
            if (!wantCross && decorOf[cid]) continue;
            var lay2 = layerOf[cid];
            var vis2 = SR.vis[cid];

            var nb = 0;
            // ⚠ THE LIGHT OF EACH NEIGHBOUR, not just this cell's own (D-132). A model quad is
            // lit by the cell its face looks INTO, exactly as a greedy face is. Taking the
            // block's own light instead is invisible on a plant — a plant stands in air, and
            // air is where the light is — and turns every grass block in the world BLACK,
            // because the light inside an opaque block is zero. Packed into two words rather
            // than six array entries: this loop runs once per model block per chunk.
            var nl0 = light[pi2], nl1 = 0;
            for (var nf = 0; nf < 6; nf++) {
              var ni2 = pi2 + NOFF[nf];
              var nid2 = blocks[ni2];
              if (nf < 3) nl0 |= light[ni2] << ((nf + 1) << 3);
              else nl1 |= light[ni2] << ((nf - 3) << 3);
              if ((culls[nid2] >> nf) & 1) { nb |= 1 << nf; continue; }
              // vanilla's skipRendering: two panes of glass, two leaf blocks, two lava cells
              if (nid2 === cid && selfCull[cid]) nb |= 1 << nf;
            }

            var n = M.modelQuadCount(vis2, px - 1, py - 1, pz - 1, nb, ox, oy, oz);
            if (!n || mQuads[lay2] + n > MAXQ) continue;
            if (!modelList) modelList = [];
            modelList.push(px - 1, py - 1, pz - 1, vis2, nl0, lay2, n, nb, nl1, pi2);
            mQuads[lay2] += n;
          }
        }
      }
    }

    // ---- the fluid pass (#1263) -----------------------------------------------------------
    var fQuads = [0, 0, 0];
    if (fCell) {
      fcount[0] = fcount[1] = fcount[2] = 0;
      for (var fy = 1; fy <= 16; fy++) {
        for (var fz = 1; fz <= 16; fz++) {
          for (var fx = 1; fx <= 16; fx++) {
            var fpi = fy * PSY + fz * PSZ + fx;
            if (fCell[blocks[fpi]]) M.meshFluidCell(blocks, light, parts, fpi, fx - 1, fy - 1, fz - 1);
          }
        }
      }
      fQuads[0] = fcount[0]; fQuads[1] = fcount[1]; fQuads[2] = fcount[2];
      mQuads[0] += fQuads[0]; mQuads[1] += fQuads[1]; mQuads[2] += fQuads[2];
    }

    var mTotal = mQuads[0] + mQuads[1] + mQuads[2];
    if (total === 0 && mTotal === 0) return null;

    // ---- assemble the §8 buffer --------------------------------------------
    var buf = M.allocBuffer(quads[0], quads[1], quads[2], mQuads);
    var hdr = M.readHeader(buf);
    var out = new Uint32Array(buf);
    for (var L = 0; L < 3; L++) {
      if (!quads[L]) continue;
      out.set(vbuf[L].subarray(0, vlen[L]), hdr.off[L] >> 2);
    }

    // The model stream is written in layer order, so each layer's quads are contiguous and
    // the header's three offsets are all a draw call needs.
    if (mTotal) {
      var mOut = new Uint32Array(buf, hdr.modelOff[0], mTotal * 16);
      var cursor = [0, mQuads[0] * 16, (mQuads[0] + mQuads[1]) * 16];
      modelCtx.ao = wantAO; modelCtx.smooth = wantSmooth;
      for (var mi = 0; modelList && mi < modelList.length; mi += 10) {
        var lay3 = modelList[mi + 5];
        cursor[lay3] = M.emitModelBlock(mOut, cursor[lay3], modelList[mi + 3],
                                        modelList[mi], modelList[mi + 1], modelList[mi + 2],
                                        modelList[mi + 4], modelList[mi + 8], 3,
                                        modelList[mi + 7], ox, oy, oz, modelList[mi + 9]);
      }
      for (var fl = 0; fl < 3; fl++) {
        if (!fQuads[fl]) continue;
        mOut.set(fvbuf[fl].subarray(0, fQuads[fl] * 16), cursor[fl]);
        cursor[fl] += fQuads[fl] * 16;
      }
    }

    hdr = new Int32Array(buf, 0, 16);
    hdr[7] = M.lastVis;
    return buf;
  };

  // ── fluids (#1263) ─────────────────────────────────────────────────────────────────────────
  // `FluidRenderer.render`, ported: a fluid cell with no fluid of its own kind above it has a top
  // that follows its level — `getHeight()` is amount/9 (a source is 8/9, a falling column is
  // full) — with every corner height blended from the four cells that touch it, so a slope runs
  // across the cells instead of stepping. Quads go into the MODEL stream (1/256 block positions),
  // wound counter-clockwise from outside like the greedy stream, flagged animated (w3 bit 26).
  // Not ported: the flow-direction texture rotation of the top (vanilla's `getVelocity`).
  var fvbuf = [new Uint32Array(1024), new Uint32Array(1024), new Uint32Array(1024)];
  var fcount = [0, 0, 0];
  var fP = new Int32Array(12), fU = new Int32Array(8);

  function fluidQuad(L, face, tile, tint, sky, blk) {
    var n = fcount[L] * 16;
    if (n + 16 > fvbuf[L].length) { var g = new Uint32Array(fvbuf[L].length * 2); g.set(fvbuf[L]); fvbuf[L] = g; }
    var out = fvbuf[L];
    for (var c = 0; c < 4; c++) {
      M.packModelVertex(out, n + c * 4, fP[c * 3], fP[c * 3 + 1], fP[c * 3 + 2], tile,
                        fU[c * 2], fU[c * 2 + 1], face, 3, sky, blk, tint, 1, 0);
      out[n + c * 4 + 3] |= 1 << 26;
    }
    fcount[L]++;
  }

  /** FluidRenderer.method_40079: the height a neighbour cell contributes (-1 = solid, ignored). */
  function fluidCellHeight(blocks, idx, k, SR) {
    var st = blocks[idx];
    if (SR.fluidKind[st] === k) {
      return SR.fluidKind[blocks[idx + PSY]] === k ? 1 : Math.fround(SR.fluidAmt[st] / 9);
    }
    return SR.solid[st] ? -1 : 0;
  }
  function fluidAdd(acc, h) {
    if (h >= 0.8) { acc[0] += h * 10; acc[1] += 10; } else if (h >= 0) { acc[0] += h; acc[1]++; }
  }
  var fAcc = [0, 0];
  /** FluidRenderer.method_40077: one top corner's height from the cell, two edge cells and the diagonal. */
  M.fluidCorner = function (blocks, k, h, hA, hB, diag, SR) {
    if (hB >= 1 || hA >= 1) return 1;
    fAcc[0] = 0; fAcc[1] = 0;
    if (hA > 0 || hB > 0) {
      var d = fluidCellHeight(blocks, diag, k, SR);
      if (d >= 1) return 1;
      fluidAdd(fAcc, d);
    }
    fluidAdd(fAcc, h); fluidAdd(fAcc, hB); fluidAdd(fAcc, hA);
    return Math.fround(fAcc[0] / fAcc[1]);
  };

  /** Emit every visible face of the fluid cell at padded index `pi` (section-local x,y,z). */
  M.meshFluidCell = function (blocks, light, parts, pi, x, y, z) {
    var SR = NS.States, id = blocks[pi], k = SR.fluidKind[id], fKind = SR.fluidKind;
    if (fKind[blocks[pi + PSY]] === k) return;           // full cube: the greedy path draws it
    var culls = SR.cull, opaque = SR.opaque, L = SR.layer[id];
    var tile = SR.partTiles[parts[pi] * 6 + 2], flow = SR.partTiles[parts[pi] * 6], tint = SR.partTint[parts[pi] * 6 + 5] & 3;
    var lo = light[pi], la = light[pi + PSY];
    var sky = Math.max(lo >> 4, la >> 4), blk = Math.max(lo & 15, la & 15);
    var h = fluidCellHeight(blocks, pi, k, SR);
    var hN = fluidCellHeight(blocks, pi - PSZ, k, SR), hS = fluidCellHeight(blocks, pi + PSZ, k, SR);
    var hE = fluidCellHeight(blocks, pi + PSX, k, SR), hW = fluidCellHeight(blocks, pi - PSX, k, SR);
    var hNE = M.fluidCorner(blocks, k, h, hN, hE, pi - PSZ + PSX, SR);
    var hNW = M.fluidCorner(blocks, k, h, hN, hW, pi - PSZ - PSX, SR);
    var hSE = M.fluidCorner(blocks, k, h, hS, hE, pi + PSZ + PSX, SR);
    var hSW = M.fluidCorner(blocks, k, h, hS, hW, pi + PSZ - PSX, SR);
    var X = x * 256, Y = y * 256, Z = z * 256, q = 0;
    var yNE = Y + Math.round(hNE * 256), yNW = Y + Math.round(hNW * 256);
    var ySE = Y + Math.round(hSE * 256), ySW = Y + Math.round(hSW * 256);
    var above = blocks[pi + PSY];

    // top: always drawn while no same fluid sits above, unless a full-height cell is capped
    if (!(Math.min(hNE, hNW, hSE, hSW) >= 1 && ((culls[above] >> 2) & 1))) {
      fP[0] = X; fP[1] = yNW; fP[2] = Z;  fU[0] = 0;   fU[1] = 0;
      fP[3] = X; fP[4] = ySW; fP[5] = Z + 256; fU[2] = 0;   fU[3] = 256;
      fP[6] = X + 256; fP[7] = ySE; fP[8] = Z + 256; fU[4] = 256; fU[5] = 256;
      fP[9] = X + 256; fP[10] = yNE; fP[11] = Z; fU[6] = 256; fU[7] = 0;
      fluidQuad(L, 2, tile, tint, sky, blk);
      // the underside of the surface, seen from below — FluidState.method_15756
      var under = false;
      for (var dz = -1; dz <= 1 && !under; dz++) {
        for (var dx = -1; dx <= 1; dx++) {
          var ab = blocks[pi + PSY + dz * PSZ + dx * PSX];
          if (fKind[ab] !== k && !opaque[ab]) { under = true; break; }
        }
      }
      if (under) {
        fP[0] = X; fP[1] = yNW; fP[2] = Z;  fU[0] = 0;   fU[1] = 0;
        fP[3] = X + 256; fP[4] = yNE; fP[5] = Z; fU[2] = 256; fU[3] = 0;
        fP[6] = X + 256; fP[7] = ySE; fP[8] = Z + 256; fU[4] = 256; fU[5] = 256;
        fP[9] = X; fP[10] = ySW; fP[11] = Z + 256; fU[6] = 0; fU[7] = 256;
        fluidQuad(L, 2, tile, tint, sky, blk);
      }
    }

    // bottom: not against the same fluid, not capped by something that covers its top
    var bn = blocks[pi - PSY];
    if (fKind[bn] !== k && !((culls[bn] >> 3) & 1)) {
      var lb = light[pi - PSY];
      var bs = Math.max(lo >> 4, lb >> 4), bb = Math.max(lo & 15, lb & 15);
      fP[0] = X; fP[1] = Y; fP[2] = Z + 256;  fU[0] = 0;   fU[1] = 256;
      fP[3] = X; fP[4] = Y; fP[5] = Z; fU[2] = 0;   fU[3] = 0;
      fP[6] = X + 256; fP[7] = Y; fP[8] = Z; fU[4] = 256; fU[5] = 0;
      fP[9] = X + 256; fP[10] = Y; fP[11] = Z + 256; fU[6] = 256; fU[7] = 256;
      fluidQuad(L, 3, tile, tint, bs, bb);
    }

    // sides, in vanilla's order: north (-Z), south (+Z), west (-X), east (+X)
    for (var sd = 0; sd < 4; sd++) {
      var nIdx, face, ha, hb;
      if (sd === 0)      { nIdx = pi - PSZ; face = 5; ha = hNW; hb = hNE; }
      else if (sd === 1) { nIdx = pi + PSZ; face = 4; ha = hSE; hb = hSW; }
      else if (sd === 2) { nIdx = pi - PSX; face = 1; ha = hSW; hb = hNW; }
      else               { nIdx = pi + PSX; face = 0; ha = hNE; hb = hSE; }
      var nb = blocks[nIdx];
      if (fKind[nb] === k || ((culls[nb] >> face) & 1)) continue;
      var ya = Y + Math.round(ha * 256), yb = Y + Math.round(hb * 256);
      var va = Math.round((1 - ha) * 256), vb = Math.round((1 - hb) * 256);
      if (sd === 0)      { fP[0] = X;       fP[2] = Z;       fP[3] = X + 256; fP[5] = Z;       fP[6] = X + 256; fP[8] = Z;       fP[9] = X;       fP[11] = Z; }
      else if (sd === 1) { fP[0] = X + 256; fP[2] = Z + 256; fP[3] = X;       fP[5] = Z + 256; fP[6] = X;       fP[8] = Z + 256; fP[9] = X + 256; fP[11] = Z + 256; }
      else if (sd === 2) { fP[0] = X;       fP[2] = Z + 256; fP[3] = X;       fP[5] = Z;       fP[6] = X;       fP[8] = Z;       fP[9] = X;       fP[11] = Z + 256; }
      else               { fP[0] = X + 256; fP[2] = Z;       fP[3] = X + 256; fP[5] = Z + 256; fP[6] = X + 256; fP[8] = Z + 256; fP[9] = X + 256; fP[11] = Z; }
      fP[1] = ya; fP[4] = yb; fP[7] = Y; fP[10] = Y;
      fU[0] = 0; fU[1] = va; fU[2] = 256; fU[3] = vb; fU[4] = 256; fU[5] = 256; fU[6] = 0; fU[7] = 256;
      fluidQuad(L, face, flow, tint, sky, blk);
    }
  };

  // Reused scratch so emitQuad allocates nothing at all.
  var qc = new Int32Array(3);

  /** Write one greedy-merged quad into the layer scratch. */
  function emitQuad(face, ax, k, a0, b0, w, h, key, layer, tbl, lit) {
    var tile = key & 4095;
    var aoBits = (key >>> 12) & 255;
    var sky = (key >>> 20) & 15;
    var blk = (key >>> 24) & 15;
    var tint = (key >>> 28) & 3;
    var flag = (key >>> 30) & 1;

    // local block coords of the quad's minimum corner
    qc[0] = 0; qc[1] = 0; qc[2] = 0;
    qc[ax[0]] = k; qc[ax[1]] = a0; qc[ax[2]] = b0;
    var aAx = ax[1], bAx = ax[2];

    var buf = vbuf[layer], o = vlen[layer];
    for (var v = 0; v < 4; v++) {
      var t = v * 4;
      var tx = tbl[t], ty = tbl[t + 1], tz = tbl[t + 2];
      var dx = tx === 0 ? 0 : (tx === 1 ? 1 : (tx === 2 ? w : h));
      var dy = ty === 0 ? 0 : (ty === 1 ? 1 : (ty === 2 ? w : h));
      var dz = tz === 0 ? 0 : (tz === 1 ? 1 : (tz === 2 ? w : h));
      // Which of the four (ca,cb) corners is this? The a/b component is 0 at the min corner.
      var ca = tbl[t + aAx] !== 0 ? 1 : 0;
      var cb = tbl[t + bAx] !== 0 ? 1 : 0;
      var ao = (aoBits >>> ((cb << 2) | (ca << 1))) & 3;
      // D-415 — this corner's own light, in the same (ca, cb) order `aoBits` uses.
      var lc = (lit >>> (((cb << 1) | ca) << 3)) & 255;
      buf[o++] = M.packData0(qc[0] + dx, qc[1] + dy, qc[2] + dz, face, ao,
                             lc >>> 4, lc & 15, flag);
      buf[o++] = M.packData1(tile, w, h, tbl[t + 3], tint);
    }
    vlen[layer] = o;
  }


  // ── the legacy bridge is GONE (D-100, D-104) ─────────────────────────────────────────────
  // Until session 2 this file carried three things that only existed because the world stored
  // 49 hand-written ids while the registry held 900 blocks: `legacyVisual()` (id -> visual
  // state), `cullMask()` (a 49-entry mask rebuilt whenever fast leaves toggled), and
  // `emitCross()` (two diagonal quads standing in for a plant's real model).
  //
  // All three are deleted, not deprecated. The world stores registry real states now, so the
  // per-state tables in src/02c_states.js ARE the answer: `SR.cull` is the mask for all 20,344
  // states, built once at boot and never invalidated, and every plant draws the model vanilla
  // draws because there is no second path for it to fall down.
  //
  // What is worth keeping from that work is the reason the mask exists at all, so:
  //
  //   A face is culled only if the neighbour COVERS it geometrically AND is opaque BY
  //   MATERIAL. `opaque[neighbour]` alone is right only while every block is a full cube. A
  //   bottom slab hides the face below it and nothing else; a stair hides two of its six; an
  //   open trapdoor hides exactly the wall it is flush against. And glass is a full cube whose
  //   geometric mask is all six faces — culling against it would black out the inside of every
  //   glass house, which is what the material AND is for.
  //
  //   ⚠ A state with NO MODEL keeps the material's answer rather than "occludes nothing".
  //   `block/lava.json` is a model with a group and no elements, because vanilla draws fluids
  //   from a special path. Its derived mask is 0, and treating that as see-through makes every
  //   lava lake draw its own hidden interior. src/02c_states.js does this; statecheck proves it.
  //
  // Fast leaves (D-93) used to invalidate the mask, because it was derived from a mutable
  // `B.opaque`. It no longer can: `SR.cull` is derived from the registry, which does not
  // change, and leaves are handled by `selfCull` in the mesh loop instead.

  /**
   * Allocate the §8 buffer once quad counts are known. Kept here so the format has ONE owner.
   *
   * Layout, 16 header words then two streams:
   *   0  magic 'MSH2'
   *   1..3   cube quad counts, per layer (opaque, cutout, translucent)
   *   4..6   cube byte offsets, per layer
   *   7      visibility mask (ARCH §9.1 / D-85)
   *   8..10  MODEL quad counts, per layer
   *   11..13 MODEL byte offsets, per layer
   *   14     MODEL_QUAD_BYTES, written so a reader can refuse a buffer whose vertex layout
   *          it does not understand instead of drawing garbage
   *   15     #2627: MODEL quad count of the 4th (additive) bucket, byte offset derived
   *
   * The model stream is APPENDED after the cube stream, so a buffer with no model quads is
   * byte-for-byte what it was before the stream existed, minus the wider header.
   */
  M.allocBuffer = function (quadsOpaque, quadsCutout, quadsTranslucent, modelQuads) {
    var H = CFG.MESH_HEADER_BYTES, Q = CFG.QUAD_BYTES, MQ = CFG.MODEL_QUAD_BYTES;
    var m = modelQuads || [0, 0, 0];
    var m3 = m[3] | 0;
    var cubes = quadsOpaque + quadsCutout + quadsTranslucent;
    var models = m[0] + m[1] + m[2] + m3;
    if (cubes + models === 0) return null;
    var buf = new ArrayBuffer(H + cubes * Q + models * MQ);
    var h = new Int32Array(buf, 0, 16);
    h[0] = CFG.MESH_MAGIC;
    h[1] = quadsOpaque; h[2] = quadsCutout; h[3] = quadsTranslucent;
    h[4] = H;
    h[5] = H + quadsOpaque * Q;
    h[6] = H + (quadsOpaque + quadsCutout) * Q;
    h[7] = 0;
    var mBase = H + cubes * Q;
    h[8] = m[0]; h[9] = m[1]; h[10] = m[2];
    h[11] = mBase;
    h[12] = mBase + m[0] * MQ;
    h[13] = mBase + (m[0] + m[1]) * MQ;
    h[14] = MQ;
    h[15] = m3;
    return buf;
  };

  /** Read the §8 header. Used by both GPU backends and by the tests. */
  M.readHeader = function (buf) {
    var h = new Int32Array(buf, 0, 16);
    if (h[0] !== CFG.MESH_MAGIC) return null;
    // A buffer whose model vertices are a size this build does not know about is a buffer
    // from a different version of the mesher. Refuse it; do not draw it.
    if (h[14] && h[14] !== CFG.MODEL_QUAD_BYTES) return null;
    return {
      quads: [h[1], h[2], h[3]],
      off: [h[4], h[5], h[6]],
      vis: h[7],
      modelQuads: [h[8], h[9], h[10], h[15]],
      modelOff: [h[11], h[12], h[13], h[13] + h[10] * CFG.MODEL_QUAD_BYTES],
      modelQuadBytes: h[14]
    };
  };

  /**
   * packModelVertex(out, o, px, py, pz, tile, u, v, face, ao, sky, blk, tint, shade, flag,
   *                  er, eg, eb, ea)
   *
   * Positions and UVs are in SIXTEENTHS — of a block and of a texel respectively — which is
   * exactly the unit the baked geometry already uses (tools/pack-geometry.mjs), so nothing
   * is converted on the way in and nothing can be converted wrongly.
   *
   * ⚠ D-503's OWED, CLOSED: `er`/`eg`/`eb` are the per-entity RGB tint channel — three more
   * 3-bit fields (0..7, i.e. eighths) taken from w3's remaining spare bits (17-25, next to
   * D-234's `flag` bit at 16). It is a MULTIPLICATIVE tint, same convention as `flag`'s hurt
   * overlay, and its identity value is (7,7,7) = ×1.0 — every call site that does not pass
   * these three (every `emitModelBlock` call, and every existing `emitMobLayer`/`emitPart`
   * caller) gets that identity because they read back as `undefined`, so no existing vertex
   * changes colour. `vs_model` in 11_gfx_webgpu.js and 12_gfx_webgl2.js both read it — see
   * `Gfx.entityTintExpr` (10_gfx.js), the one shared expression both shaders emit, the same
   * pattern `faceShadeExpr`/`tintMapExpr` already use for a change to land in both languages
   * at once (D-52).
   *
   * #1849: `ea` is the per-vertex alpha / dissolve CUTOFF, 0..1, in w3's bits 27-31 (5 bits).
   * Vanilla's `entityAlpha` rule: a fragment is discarded where texel alpha < `ea`
   * (`Gfx.entityAlphaExpr`, read by both `vs_model`s). Undefined/0 = no discard.
   */
  M.packModelVertex = function (out, o, px, py, pz, tile, u, v, face, ao, sky, blk, tint, shade, flag,
                                 er, eg, eb, ea, ew) {
    var al = ea === undefined ? 0 : Math.max(0, Math.min(31, Math.round(ea * 31)));
    var tr = er === undefined ? 7 : (er & 7);
    var tg = eg === undefined ? 7 : (eg & 7);
    var tb = eb === undefined ? 7 : (eb & 7);
    out[o]     = (px & 0xFFFF) | ((py & 0xFFFF) << 16);
    out[o + 1] = (pz & 0xFFFF) | ((tile & 0x1FFF) << 16) | ((ew ? Math.min(7, Math.round(ew * 7)) : 0) << 29);   // #2679: tile 13 bits (mob tiles reach ~4650), bits 29-31 = white overlay weight /7 (vanilla 15ths, <=1/14 off)
    out[o + 1] >>>= 0;
    out[o + 2] = (u & 0xFFFF) | ((v & 0xFFFF) << 16);
    out[o + 3] = (face & 7) | ((ao & 3) << 3) | ((sky & 15) << 5) | ((blk & 15) << 9) |
                 ((tint & 3) << 13) | ((shade & 1) << 15) | ((flag & 1) << 16) |
                 (tr << 17) | (tg << 20) | (tb << 23) | (al << 27);
    out[o + 3] >>>= 0;
    return o + 4;
  };

  /**
   * How many model quads a visual state costs at a given position.
   *
   * It takes the position because a state's groups can offer random ALTERNATIVES and the
   * chosen one may have a different quad count — stone's four variants happen to match, a
   * multipart block's need not. Counting with a different position than emitting would
   * allocate the wrong buffer, so both go through Reg.partFor with the same coordinates.
   */
  M.modelQuadCount = function (visualState, x, y, z, nbMask, ox, oy, oz) {
    var R = NS.Reg;
    var n = 0, groups = R.groupCount(visualState);
    var wx = (ox | 0) + x, wy = (oy | 0) + y, wz = (oz | 0) + z;
    for (var g = 0; g < groups; g++) {
      var part = R.partFor(visualState, g, wx, wy, wz);
      var q0 = R.partOff[part], q1 = R.partOff[part + 1];
      if (!nbMask) { n += q1 - q0; continue; }
      for (var q = q0; q < q1; q++) {
        var cull = (R.qFlags[q] >>> 3) & 7;
        if (cull !== 7 && ((nbMask >> MESH_OF_DIR[cull]) & 1)) continue;
        n++;
      }
    }
    return n;
  };

  /**
   * emitModelBlock(out, o, visualState, x, y, z, sky, blk, ao) -> new offset
   *
   * Write one block's baked geometry into the model stream. `out` is a Uint32Array view of
   * the buffer; `o` is a WORD offset; x/y/z are block coordinates within the section.
   *
   * The geometry arrives already rotated, uvlocked, cullface-resolved and tinted from
   * tools/bake-geometry.mjs, so there is no per-face maths here at all — the whole loop is
   * a translate and a copy. That is the entire point of baking at build time: the thing
   * that runs 20,000 times a chunk should be doing the least possible work.
   *
   * ⚠ Positions are in 1/256 OF A BLOCK (CFG.MODEL_UNITS_PER_BLOCK). Minecraft's model
   * space is 16 units to a block and the baked data keeps 1/16 of one of those. A model
   * element legitimately reaches outside its own cell — measured -118..374 of these units,
   * a wall torch leaning out and a fence arm crossing the boundary — so the result is
   * signed and the format stores i16.
   */
  // ⚠ #4005 — the greedy path smooths light and AO per vertex; the model path (stairs, slabs, grass
  // blocks, every non-cube: 17,356 of the 20,344 states) used to write ONE light and ao 3 for the
  // whole quad, so Smooth Lighting only ever changed plain cubes. `pi` (the cell's padded index)
  // switches the per-vertex path on; `modelCtx` carries the option flags from mesh().
  var modelCtx = { ao: true, smooth: true };
  function vertexLight(pi, face, cd, bx, by, bz, px, py, pz, lt, out2) {
    var ax = face >> 1, U2 = CFG.MODEL_UNITS_PER_BLOCK;
    var blocks = M.scratchBlocks, light = M.scratchLight, opaque = NS.States.opaque;
    var base = cd !== 7 ? pi + NOFF[face] : pi;
    var a = ax === 0 ? 1 : 0, b = ax === 2 ? 1 : 2;           // the two in-plane axes (x,y,z = 0,1,2)
    var ta = (a === 0 ? px - bx : py - by), tb = (b === 1 ? py - by : pz - bz);
    var PS = [PSX, PSY, PSZ];
    var da = (ta * 2 > U2 ? 1 : -1) * PS[a], db = (tb * 2 > U2 ? 1 : -1) * PS[b];
    var oa = opaque[blocks[base + da]], ob = opaque[blocks[base + db]], oc = opaque[blocks[base + da + db]];
    out2[0] = modelCtx.ao ? M.aoValue(oa, ob, oc) : 3;
    out2[1] = modelCtx.smooth ? cornerLight(light, opaque, blocks, base, da, db, oa, ob, oc) : lt;
  }
  var vlOut = [3, 0];

  var MOFF = [0, 0, 0];
  var WIRE_TINT = null, wireBlock = -1, powerProp = -1;
  /** The [r,g,b] eighths for a redstone_wire state (RedstoneWireBlock.COLORS: r=.4+.6p (.3 at 0), g=.7p²-.5, b=.6p²-.7), else null. */
  M.wireTint = function (state) {
    var R = NS.Reg, S = NS.States;
    if (!WIRE_TINT) {
      wireBlock = R.id.redstone_wire; powerProp = R.PROP.power; WIRE_TINT = [];
      for (var p = 0; p < 16; p++) {
        var f = p / 15, c = [p > 0 ? 0.4 + 0.6 * f : 0.3, 0.7 * f * f - 0.5, 0.6 * f * f - 0.7];
        WIRE_TINT.push(c.map(function (v) { return Math.round(Math.max(0, Math.min(1, v)) * 7); }));
      }
    }
    if (!state || S.block[state] !== wireBlock) return null;
    return WIRE_TINT[+R.valueNames[S.propValue(state, powerProp)]];
  };

  M.emitModelBlock = function (out, o, visualState, x, y, z, lite0, lite1, ao, nbMask, ox, oy, oz, pi) {
    var R = NS.Reg;
    // ⚠ `lite0`/`lite1` are SEVEN packed light bytes, not one (D-132): this cell's own in the
    // low byte of lite0, then the six neighbours in mesher face order. A quad takes the light of
    // the cell its cullface looks into; a quad with no cullface — the two crossed planes of a
    // tuft of grass, a torch's flame — takes this cell's own, which is where it stands.
    var ownLight = lite0 & 255;
    var U = CFG.MODEL_UNITS_PER_BLOCK;
    var bx = x * U, by = y * U, bz = z * U;
    var groups = R.groupCount(visualState);
    var a = ao === undefined ? 3 : ao;
    var wx = (ox | 0) + x, wy = (oy | 0) + y, wz = (oz | 0) + z;
    // #4693: per-position model offset (bamboo, flowers, grass...), the SAME function the raycast and outline use.
    // Only when the caller knows the world position and the cell (`pi`); icons and tests pass neither.
    if (pi !== undefined && ox !== undefined && NS.States.modelOffset(M.scratchBlocks[pi], wx, wz, MOFF)) {
      bx += Math.round(MOFF[0] * U); by += Math.round(MOFF[1] * U); bz += Math.round(MOFF[2] * U);
    }
    // #4946: redstone wire's tintindex 0 is the POWER ramp (RedstoneWireBlock.COLORS), not the grass map.
    // It rides the multiplicative er/eg/eb channel (eighths, 3 bits each: the vertex has no wider spare field).
    var wireTint = pi !== undefined ? M.wireTint(M.scratchBlocks[pi]) : null;
    for (var g = 0; g < groups; g++) {
      var part = R.partFor(visualState, g, wx, wy, wz);
      var q0 = R.partOff[part], q1 = R.partOff[part + 1];
      for (var q = q0; q < q1; q++) {
        var f = R.qFlags[q];
        // ⚠ IDENTICAL to the test in modelQuadCount, and it has to stay identical: that
        // function sized the buffer this one is writing into.
        if (nbMask) {
          var cullDir = (f >>> 3) & 7;
          if (cullDir !== 7 && ((nbMask >> MESH_OF_DIR[cullDir]) & 1)) continue;
        }
        // ⚠⚠ **MESH_OF_DIR, NOT THE RAW `dir` — D-314.** The baked quad's `dir` is VANILLA's
        // `Direction` order (down, up, north, south, west, east); every consumer of a packed
        // vertex — `Gfx.SHADE.FACE`, `shadeExpr`, the icon rasteriser — indexes ARCH §3 order
        // (+X, -X, +Y, -Y, +Z, -Z). Packing the raw number put TWO CONVENTIONS IN ONE FIELD, and
        // the greedy path next door was already packing the other one. Every model block in the
        // world was therefore lit as if it were lying on its side: a grass block's TOP shaded
        // 0.6 (the value for a side wall) and its NORTH face shaded 1.0 (the value for the sky).
        // The map already existed and was already used for this quad's culling and its lighting,
        // three lines up — it was just never applied to the thing the shader colours by.
        var face = MESH_OF_DIR[f & 7];
        var tint = (f >>> 7) & 7;             // 0 = untinted, else index + 1
        var shade = (f >>> 6) & 1;
        var tile = R.qTile[q];
        var cd = (f >>> 3) & 7;
        var lt = ownLight;
        if (cd !== 7) {
          var mf = MESH_OF_DIR[cd];
          lt = mf < 3 ? ((lite0 >>> ((mf + 1) << 3)) & 255) : ((lite1 >>> ((mf - 3) << 3)) & 255);
        }
        var sky = lt >> 4, blk = lt & 15;
        var po = q * 12, uo = q * 8;
        // ⚠ THE CORNERS GO OUT IN REVERSE ORDER, and that is not a style choice (D-133).
        //
        // The index buffer is ONE shared linear ramp — quad i is (4i, 4i+1, 4i+2, 4i, 4i+2,
        // 4i+3) — and the pipeline culls back faces with `frontFace(CCW)`. The greedy stream's
        // corner table is wound to suit that. The baked model corners come out of Mojang's own
        // element JSON in Mojang's order, which is the other way round, so every single-sided
        // model face in the game was drawn INSIDE OUT and therefore invisible: grass block
        // tops, slabs, stairs, carpets, cactus. Plants survived only because a cross model is
        // two planes emitted twice, once each way, so one of the two always faced the camera —
        // which is exactly why the world looked like flowers standing on nothing.
        //
        // Reversing here rather than in the bakery keeps the asset a faithful copy of the JSON
        // and puts the winding convention in the one place that knows about the index ramp.
        // `emitcheck` now derives each emitted quad's normal from its own winding and asserts
        // it points the way the quad's face says it should.
        // Only a quad lying flat on one axis has an in-plane neighbourhood to smooth over.
        var fa = face >> 1, flat = pi !== undefined && (modelCtx.ao || modelCtx.smooth);
        if (flat) for (var c0 = 1; c0 < 4; c0++) if (R.qPos[po + c0 * 3 + fa] !== R.qPos[po + fa]) flat = false;
        for (var c = 3; c >= 0; c--) {
          var vx = bx + R.qPos[po + c * 3], vy = by + R.qPos[po + c * 3 + 1], vz = bz + R.qPos[po + c * 3 + 2];
          var va = a, vs = sky, vb = blk;
          if (flat) {
            vertexLight(pi, face, cd, bx, by, bz, vx, vy, vz, lt, vlOut);
            va = vlOut[0]; vs = vlOut[1] >> 4; vb = vlOut[1] & 15;
          }
          o = M.packModelVertex(out, o, vx, vy, vz,
            tile, R.qUv[uo + c * 2], R.qUv[uo + c * 2 + 1],
            face, va, vs, vb, wireTint ? 0 : tint > 3 ? 3 : tint, shade, 0,
            wireTint ? wireTint[0] : undefined, wireTint ? wireTint[1] : undefined, wireTint ? wireTint[2] : undefined);
        }
      }
    }
    return o;
  };

  /** The inverse, for the tests and the debug screen. Never called in the mesh path. */
  M.unpackModelVertex = function (w0, w1, w2, w3) {
    var s16 = function (v) { return (v & 0x8000) ? v - 0x10000 : v; };
    return {
      px: s16(w0 & 0xFFFF), py: s16((w0 >>> 16) & 0xFFFF),
      pz: s16(w1 & 0xFFFF), tile: (w1 >>> 16) & 0x1FFF, white: ((w1 >>> 29) & 7) / 7,
      u: s16(w2 & 0xFFFF), v: s16((w2 >>> 16) & 0xFFFF),
      face: w3 & 7, ao: (w3 >>> 3) & 3, sky: (w3 >>> 5) & 15, blk: (w3 >>> 9) & 15,
      tint: (w3 >>> 13) & 3, shade: (w3 >>> 15) & 1, flag: (w3 >>> 16) & 1,
      er: (w3 >>> 17) & 7, eg: (w3 >>> 20) & 7, eb: (w3 >>> 23) & 7, alpha: ((w3 >>> 27) & 31) / 31
    };
  };
})(MCL);
