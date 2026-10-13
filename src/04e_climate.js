// 04e_climate.js — which biome is here. PLAN W4, the vanilla half.
// Runs on: main thread AND workers. No DOM.
//
// Two questions live in this file and they are not the same question:
//
//   1. What are the six CLIMATE NUMBERS at this point?  -> `Climate.targetInto`
//   2. Which biome do those six numbers select?         -> `Climate.biomeAt`
//
// Question 1 has two answers and that is the whole point of W4. The vanilla answer is six
// noise fields with no physical meaning — "temperature" is a Perlin stack, not a temperature.
// The other answer, in `04f_earth.js`, is an actual climate model: latitude, an ITCZ, lapse
// rate, rain shadow. The toggle picks between them and both are built, because a toggle whose
// off position was never built is a toggle that quietly has one setting.
//
// Question 2 has exactly one answer, and it is vanilla's, in both modes. That is deliberate:
// the biome LIST, and every biome's colours, features and mobs, are "everything else" under
// CLAUDE.md's rule and get absolute parity. What W4 is allowed to change is where on the map
// each one lands, which is question 1.
//
// ── THE TABLE ────────────────────────────────────────────────────────────────────────────
// `MultiNoiseBiomeSource.Preset.OVERWORLD`: 7,578 entries, each a box in 7-dimensional
// climate space tagged with a biome, and the answer is the box NEAREST the query — not the
// box containing it, because 33% of queries are inside no box at all and 0.5% are inside two.
// (Measured, on 30,000 random queries. That measurement is why the obvious optimisation — a
// precomputed grid of cells — was tried and thrown away: the boxes overlap, so cell-centre
// nearest disagreed with true nearest on 11.6% of 200,000 queries.)
//
// Where the table comes from, how it is quantised and why the R-tree over it is baked rather
// than built at boot: see the long header of `tools/pack-biomeparams.mjs`.
//
// ── THE ARITHMETIC IS INTEGER, ON PURPOSE ────────────────────────────────────────────────
// Vanilla quantises every climate value with `(long)(f * 10000)` and compares longs. Doing
// the same here is not pedantry: it makes the box test exact, it makes the answer identical
// on every machine regardless of floating-point rounding, and it makes the squared distance
// an integer that never loses a low bit. Distances reach ~3.4e9, which is past int32 — so the
// ACCUMULATOR is a double (exact for integers to 2^53) while every term in it is an integer.
//
(function (NS) {
  'use strict';

  var CL = NS.Climate = {};

  CL.ready = false;

  // The seven axes, in vanilla's `ParameterPoint.parameterSpace()` order. The R-tree was
  // built on this order; reading it in another order would search a different tree.
  CL.AXES = ['temperature', 'humidity', 'continentalness', 'erosion', 'depth', 'weirdness', 'offset'];
  var A = 7;

  /** Vanilla's `Climate.quantizeCoord`. Truncation toward zero, not rounding — Java's cast. */
  var Q = 10000;
  CL.QUANTUM = Q;
  CL.quantise = function (f) { return Math.trunc(f * Q); };

  // ── the two climate modes ───────────────────────────────────────────────────────────────
  // A world is created in one of them and keeps it forever: the mode is part of the world,
  // like the seed, because changing it would move every biome under a player's feet. `Gen`
  // reads it out of the world settings and calls `CL.setMode` once, before generating.
  CL.MODE_VANILLA = 0;
  CL.MODE_EARTH = 1;
  CL.MODE_NAMES = ['vanilla', 'earth'];
  CL.mode = CL.MODE_VANILLA;

  CL.setMode = function (m) {
    if (m !== CL.MODE_VANILLA && m !== CL.MODE_EARTH) throw new Error('unknown climate mode ' + m);
    if (m === CL.MODE_EARTH && !(NS.Earth && NS.Earth.ready)) throw new Error('climate mode earth asked for before Earth.init');
    CL.mode = m;
    return CL;
  };

  // ── the decoded table ───────────────────────────────────────────────────────────────────
  var par = null;      // Int16Array, entryCount * 14 — min,max per axis
  var bio = null;      // Uint16Array, entryCount — biome index
  var nsp = null;      // Int16Array, nodeCount * 14 — internal node bounding boxes
  var koff = null;     // Uint32Array, nodeCount + 1
  var kid = null;      // Int32Array — >= 0 an internal node, < 0 the entry ~n

  CL.entryCount = 0;
  CL.nodeCount = 0;
  CL.bound = false;
  // ⚠ TWO LISTS, ONE INDEX SPACE — and the distinction is the whole point of `bindBiomes`.
  //
  // `tableBiomeNames` is the 50 biomes this TABLE dispatches to, in the order the blob packs
  // them. `biomeNames` is the 61-biome REGISTRY, which is what `Biomes` indexes and therefore
  // what every consumer downstream indexes. They are not the same list and index 49 does not
  // mean the same thing in both.
  //
  // Before `bindBiomes` runs, `entryBiome` returns a table index and `biomeAt` refuses to
  // answer. After it, every entry has been rewritten to hold a REGISTRY index and there is one
  // index space in the project — which is D-100's rule applied to biomes: two id spaces means
  // a conversion function in nineteen places and a bug living in whichever one somebody forgot.
  //
  // This one cost an afternoon: the chunk generator read `Climate.biomeAt`'s answer as a
  // registry index and every chunk in the world came out as one biome, because table index 49
  // (`sunflower_plains` in the table's own order) is a different biome in the registry's.
  CL.tableBiomeNames = null;
  CL.biomeNames = null;      // the 61-biome registry, once bound
  CL.biomeIndexOf = null;    // name (with or without namespace) -> registry index

  /**
   * init(data) — `data.biomeParams` is base64 of the deflated blob, `data.biomeParamsBytes`
   * its inflated length. Called from `Reg.init`, so it happens once on the main thread and
   * once in every worker, from the same bytes.
   */
  CL.init = function (data) {
    if (!data || !data.biomeParams) { CL.ready = false; return CL; }
    var t = (NS.U && NS.U.now) ? NS.U.now() : Date.now();
    var bytes = NS.Z.unpack(data.biomeParams, data.biomeParamsBytes);
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    if (dv.getUint32(0, true) !== 0x5042434d) throw new Error('biome-params.bin: bad magic');
    var format = dv.getUint16(4, true);
    if (format !== 1) throw new Error('biome-params.bin: format ' + format + ', expected 1');
    var biomeCount = dv.getUint16(6, true);
    var n = dv.getUint32(8, true);
    var nameBytes = dv.getUint32(12, true);
    var nodeCount = dv.getUint32(16, true);
    var kidCount = dv.getUint32(20, true);

    var names = '', i;
    for (i = 0; i < nameBytes; i += 8192) {
      names += String.fromCharCode.apply(null, bytes.subarray(24 + i, 24 + Math.min(i + 8192, nameBytes)));
    }
    CL.tableBiomeNames = names.split('\n');
    if (CL.tableBiomeNames.length !== biomeCount) {
      throw new Error('biome-params.bin: ' + CL.tableBiomeNames.length + ' names, header says ' + biomeCount);
    }
    // until `bindBiomes` runs, the table's own names ARE the index space — and nothing but
    // `bindBiomes` and the checks may use it
    CL.biomeNames = CL.tableBiomeNames;
    CL.biomeIndexOf = Object.create(null);
    for (i = 0; i < CL.tableBiomeNames.length; i++) {
      CL.biomeIndexOf[CL.tableBiomeNames[i]] = i;
      CL.biomeIndexOf[CL.tableBiomeNames[i].replace('minecraft:', '')] = i;
    }
    CL.bound = false;

    // The offsets are recomputed here rather than read out of the header, so that a blob whose
    // section sizes disagree with its counts fails on the trailing-bytes check below instead
    // of silently reading one array's bytes as another's.
    var head = 24 + nameBytes;
    if (head & 1) head++;
    var base = bytes.byteOffset;
    var parOff = head;
    var nspOff = parOff + n * 14 * 2;
    var bioOff = nspOff + nodeCount * 14 * 2;
    var koffOff = bioOff + n * 2;
    if (koffOff & 3) koffOff += 4 - (koffOff & 3);
    var kidOff = koffOff + (nodeCount + 1) * 4;
    if (kidOff + kidCount * 4 !== bytes.length) {
      throw new Error('biome-params.bin: ' + (bytes.length - kidOff - kidCount * 4) + ' bytes unaccounted for');
    }

    par = new Int16Array(bytes.buffer, base + parOff, n * 14);
    nsp = new Int16Array(bytes.buffer, base + nspOff, nodeCount * 14);
    bio = new Uint16Array(bytes.buffer, base + bioOff, n);
    koff = new Uint32Array(bytes.buffer, base + koffOff, nodeCount + 1);
    kid = new Int32Array(bytes.buffer, base + kidOff, kidCount);

    CL.entryCount = n;
    CL.nodeCount = nodeCount;
    CL.ready = true;
    CL.decodeMs = ((NS.U && NS.U.now) ? NS.U.now() : Date.now()) - t;
    return CL;
  };

  /**
   * bindBiomes(B) — rewrite every entry's biome from the TABLE's index space into the
   * REGISTRY's, so that the whole project has one. Called from `Reg.init` immediately after
   * `Biomes.init`, and idempotent.
   */
  CL.bindBiomes = function (B) {
    if (!CL.ready) throw new Error('Climate.bindBiomes before Climate.init');
    if (!B || !B.ready) throw new Error('Climate.bindBiomes before Biomes.init');
    if (CL.bound) return CL;
    var map = new Uint16Array(CL.tableBiomeNames.length), i;
    for (i = 0; i < CL.tableBiomeNames.length; i++) {
      var r = B.indexOf[CL.tableBiomeNames[i]];
      if (r === undefined) throw new Error('the climate table names a biome the registry does not have: ' + CL.tableBiomeNames[i]);
      map[i] = r;
    }
    for (i = 0; i < CL.entryCount; i++) bio[i] = map[bio[i]];
    CL.biomeNames = B.names;
    CL.biomeIndexOf = B.indexOf;
    CL.tableToRegistry = map;
    CL.bound = true;
    return CL;
  };

  // ── THE SEARCH (D-113) ──────────────────────────────────────────────────────────────────
  //
  // Vanilla's `Climate.RTree.search`, branch-and-bound. `boxDist` is the squared distance from
  // the query to a box, which is zero inside it and a lower bound on the distance to anything
  // the box contains — that lower bound is what makes pruning correct rather than a heuristic.
  //
  // ⚠ NO `lastResult` SEED. Vanilla keeps the previous query's answer in a ThreadLocal and
  // starts from it. It changes nothing except which of two EXACTLY equidistant entries wins,
  // and that makes the answer depend on query order, which this project forbids. See the note
  // in tools/pack-biomeparams.mjs.

  function boxDist(arr, off, q) {
    var r = 0, a, d, lo, hi, p;
    for (a = 0; a < A; a++) {
      lo = arr[off + a * 2]; hi = arr[off + a * 2 + 1]; p = q[a];
      d = p - hi;
      if (d <= 0) { d = lo - p; if (d <= 0) continue; }
      r += d * d;
    }
    return r;
  }
  CL.boxDist = boxDist;

  // The stack is preallocated and reused: `searchEntry` is called ~1,500 times per chunk and
  // an allocation there is a garbage collection in the middle of world generation.
  var STACK_MAX = 64;
  var stNode = new Int32Array(STACK_MAX);
  var stKid = new Int32Array(STACK_MAX);
  var stBest = new Float64Array(STACK_MAX);
  var stLeaf = new Int32Array(STACK_MAX);

  /**
   * searchEntry(q) -> the index of the entry nearest the quantised 7-vector `q`.
   *
   * Iterative rather than recursive, and identical in result to the recursive form: at each
   * node it walks the children in order, descends into any child whose box is strictly closer
   * than the best leaf found so far, and keeps the closer of the two.
   */
  CL.searchEntry = function (q) {
    if (!CL.ready) throw new Error('Climate.searchEntry before init');
    var sp = 0;
    stNode[0] = 0; stKid[0] = koff[0]; stBest[0] = Infinity; stLeaf[0] = -1;
    for (;;) {
      var node = stNode[sp];
      var k = stKid[sp];
      if (k >= koff[node + 1]) {
        // this node is exhausted: fold its result into the parent
        var leaf = stLeaf[sp], best = stBest[sp];
        if (sp === 0) return leaf;
        sp--;
        if (leaf >= 0 && best < stBest[sp]) { stBest[sp] = best; stLeaf[sp] = leaf; }
        continue;
      }
      stKid[sp] = k + 1;
      var c = kid[k];
      if (c < 0) {
        var e = ~c;
        var d = boxDist(par, e * 14, q);
        if (d < stBest[sp]) { stBest[sp] = d; stLeaf[sp] = e; }
        continue;
      }
      if (boxDist(nsp, c * 14, q) >= stBest[sp]) continue;
      if (sp + 1 >= STACK_MAX) throw new Error('Climate R-tree deeper than ' + STACK_MAX);
      sp++;
      stNode[sp] = c; stKid[sp] = koff[c]; stBest[sp] = stBest[sp - 1]; stLeaf[sp] = -1;
    }
  };

  // ── THE COLUMN SWEEP, AND THE THREE INTERVALS (D-180) ───────────────────────────────────
  //
  // The biome VOLUME asks this table 80 questions down one quart column, and 79 of them differ
  // from the first in ONE number: `targetFromColumn` writes the same five axes every time and
  // only `depth` moves with y. Asking `searchEntry` 80 times pays for the other six axes 80
  // times over — 8.0 microseconds a call, 12 ms of R-tree for one chunk's 1,280 cells, which is
  // the arithmetic that made D-137's union fix cost 86 ms a chunk and got it rejected.
  //
  // ⚠ THE MEASUREMENT THAT COLLAPSES IT: the whole 7,578-entry table uses **three** distinct
  // intervals on the depth axis — [0, 0] on 3,788 entries, [1.0, 1.0] on 3,788, and [0.2, 0.9]
  // on the two cave biomes. Every other axis is fixed for the column. So the nearest entry at
  // ANY depth is one of three: the closest entry of each depth group on the other six axes.
  // One linear fold over the table (34 microseconds, and it is linear because the R-tree cannot
  // help when the query is a whole line rather than a point) gives those three, and each of the
  // 80 cells is then three adds and a compare.
  //
  // ⚠ THIS IS THE SAME ANSWER `searchEntry` GIVES, ties included, and neither half of that is
  // free. The distance is a sum of squares of integer differences, exactly representable in a
  // float64, so splitting it into "six axes" plus "the depth axis" changes no bit. The tie is
  // the harder half: `searchEntry` returns the FIRST entry in the tree's leaf order that
  // attains the minimum — a node is pruned only on `nodeDist >= best`, `best` never drops below
  // the minimum, and a node holding a minimal entry has `nodeDist <= ` it, so a prune that
  // hides one proves an equally close one was already found earlier in that order. `leafOrd`
  // is that order, recorded once, and the sweep breaks its own ties on it. `climcheck` §2b puts
  // 32,000 queries through both functions and requires every answer to be the same entry, and
  // `featcheck` §5b holds the volume built on it against `Climate.biomeAt` cell for cell —
  // neither of which is taking any of this on trust.

  var gCount = 0;                 // distinct depth intervals in the table
  var gLo = null, gHi = null;     // their bounds
  var gOf = null;                 // entry -> its depth group
  var gMin = null, gOrd = null, gEnt = null;   // per group, for the column last folded
  var leafOrd = null;             // entry -> its position in the tree's leaf order

  /** The tree's leaf order, which is the order `searchEntry` breaks ties in. Built once. */
  function buildLeafOrder() {
    var n = CL.entryCount, i;
    leafOrd = new Int32Array(n);
    for (i = 0; i < n; i++) leafOrd[i] = 0x7fffffff;
    var sn = new Int32Array(STACK_MAX), sk = new Int32Array(STACK_MAX);
    var sp = 0, ord = 0;
    sn[0] = 0; sk[0] = koff[0];
    for (;;) {
      var node = sn[sp], k = sk[sp];
      if (k >= koff[node + 1]) { if (sp === 0) break; sp--; continue; }
      sk[sp] = k + 1;
      var c = kid[k];
      if (c < 0) { var e = ~c; if (ord < leafOrd[e]) leafOrd[e] = ord; ord++; continue; }
      if (sp + 1 >= STACK_MAX) throw new Error('Climate R-tree deeper than ' + STACK_MAX);
      sp++; sn[sp] = c; sk[sp] = koff[c];
    }
    for (i = 0; i < n; i++) {
      if (leafOrd[i] === 0x7fffffff) throw new Error('biome-params.bin: entry ' + i + ' is in no leaf of the R-tree');
    }
  }

  /** The distinct depth intervals, and which one each entry belongs to. Built once. */
  function buildDepthGroups() {
    var n = CL.entryCount, i, g;
    gOf = new Int32Array(n);
    var lo = [], hi = [];
    for (i = 0; i < n; i++) {
      var l = par[i * 14 + 8], h = par[i * 14 + 9];
      for (g = 0; g < lo.length; g++) if (lo[g] === l && hi[g] === h) break;
      if (g === lo.length) { lo.push(l); hi.push(h); }
      gOf[i] = g;
    }
    gCount = lo.length;
    gLo = Int32Array.from(lo); gHi = Int32Array.from(hi);
    gMin = new Float64Array(gCount); gOrd = new Int32Array(gCount); gEnt = new Int32Array(gCount);
    CL.depthGroupCount = gCount;
  }

  /**
   * foldColumn(q) — the six y-independent axes of every entry, reduced to the nearest entry of
   * each depth group. `q[4]` is ignored; `sweepAt` supplies the depth.
   */
  function foldColumn(q) {
    if (leafOrd === null) { buildLeafOrder(); buildDepthGroups(); }
    var q0 = q[0], q1 = q[1], q2 = q[2], q3 = q[3], q5 = q[5], q6 = q[6];
    var n = CL.entryCount, i, g, o, r, d;
    for (g = 0; g < gCount; g++) { gMin[g] = Infinity; gOrd[g] = 0x7fffffff; gEnt[g] = -1; }
    for (i = 0; i < n; i++) {
      o = i * 14; r = 0;
      d = q0 - par[o + 1]; if (d > 0) r = d * d; else { d = par[o] - q0; if (d > 0) r = d * d; }
      d = q1 - par[o + 3]; if (d > 0) r += d * d; else { d = par[o + 2] - q1; if (d > 0) r += d * d; }
      d = q2 - par[o + 5]; if (d > 0) r += d * d; else { d = par[o + 4] - q2; if (d > 0) r += d * d; }
      d = q3 - par[o + 7]; if (d > 0) r += d * d; else { d = par[o + 6] - q3; if (d > 0) r += d * d; }
      d = q5 - par[o + 11]; if (d > 0) r += d * d; else { d = par[o + 10] - q5; if (d > 0) r += d * d; }
      d = q6 - par[o + 13]; if (d > 0) r += d * d; else { d = par[o + 12] - q6; if (d > 0) r += d * d; }
      g = gOf[i];
      if (r < gMin[g]) { gMin[g] = r; gOrd[g] = leafOrd[i]; gEnt[g] = i; }
      else if (r === gMin[g] && leafOrd[i] < gOrd[g]) { gOrd[g] = leafOrd[i]; gEnt[g] = i; }
    }
  }
  /** Exposed for `climcheck`, which folds a column and then compares the sweep to the tree. */
  CL.foldColumn = function (q) { foldColumn(q); return CL; };

  /** sweepAt(qd) -> the entry `searchEntry` would return for the folded column at depth `qd`. */
  CL.sweepAt = function (qd) {
    var best = Infinity, bo = 0x7fffffff, be = -1, g, r, d;
    for (g = 0; g < gCount; g++) {
      r = gMin[g];
      d = qd - gHi[g]; if (d > 0) r += d * d; else { d = gLo[g] - qd; if (d > 0) r += d * d; }
      if (r < best || (r === best && gOrd[g] < bo)) { best = r; bo = gOrd[g]; be = gEnt[g]; }
    }
    return be;
  };

  /** Brute force over all 7,578 entries. Not used by the game — `climcheck` compares to it. */
  CL.searchEntryLinear = function (q) {
    var best = Infinity, bi = -1, i;
    for (i = 0; i < CL.entryCount; i++) {
      var d = boxDist(par, i * 14, q);
      if (d < best) { best = d; bi = i; }
    }
    return bi;
  };

  /** The squared distance from a quantised query to entry `e`. For tests and for the debug HUD. */
  CL.entryDist = function (e, q) { return boxDist(par, e * 14, q); };
  /** The biome index an entry selects. */
  CL.entryBiome = function (e) { return bio[e]; };
  /** min/max of one axis of one entry, quantised. */
  CL.entryRange = function (e, a) { return [par[e * 14 + a * 2], par[e * 14 + a * 2 + 1]]; };

  // ── the climate target ──────────────────────────────────────────────────────────────────
  //
  // The six numbers, at BLOCK coordinates. Vanilla samples at quart resolution (one sample per
  // 4x4x4) and this does too — `biomeAt` snaps — but the function itself is defined at every
  // block so tests can walk a transect one block at a time.
  //
  // Five of the six come straight out of W3's column function, which already computes the
  // shift once and reuses it. Mojang's own 1.19 `noise_router` — fetched and read rather than
  // remembered — confirms those five are exactly W3's fields, and that temperature and
  // vegetation are sampled with `y_scale: 0`, i.e. they do NOT vary with height. That is worth
  // stating because it is surprising: in this game "temperature" is a property of the column,
  // and a mountain top is not colder than its foot. (In `04f_earth.js` it is. That is the
  // single biggest visible difference between the two modes.)
  //
  // ── THE SIXTH AXIS, AND THE ONE PLACE DEVIATION #1 REACHES INTO W4 (D-114) ──────────────
  // `density_function/overworld/depth.json`, with blending off, is
  //
  //     depth = y_clamped_gradient(-64..320 -> 1.5..-1.5)(y) + offset(x, z)
  //          =  1 - y/128 + offset(x, z)          for y inside the world
  //
  // and vanilla's surface is where that is zero, i.e. at `y = 128 * (1 + offset)`. So vanilla's
  // depth axis is, exactly and algebraically,
  //
  //     depth = (surfaceY - y) / 128
  //
  // — the distance below the surface, in units of 128 blocks. The two forms are identical in
  // vanilla; `climcheck` asserts that identity rather than leaving it as a claim.
  //
  // MC-Lite does not put its surface at `128 * (1 + offset)`. Deviation #1 dropped
  // `base_3d_noise`, which carries a large part of vanilla's vertical range, so W3 anchors the
  // surface on `HEIGHT_CURVE` instead — and under that curve `1 - y/128 + offset` is nowhere
  // near zero at the ground. Taking the literal formula gave a world whose surface columns
  // selected LUSH CAVES AND DRIPSTONE CAVES as their top two biomes: 642 of 2,000 sampled
  // columns, because a surface at y=64 with a curve-mapped offset lands squarely inside the
  // `[0.2, 0.9]` depth band the cave biomes own.
  //
  // So MC-Lite uses the second form. It is not an approximation of vanilla's axis, it is
  // vanilla's axis written in terms of the surface rather than in terms of an offset that no
  // longer predicts the surface — which is the only formulation that survives deviation #1.
  // Everything downstream (the cave biomes' depth bands, the `1` and `[0.2, 0.9]` ranges)
  // keeps its vanilla meaning: 0.2 is 25.6 blocks down, 0.9 is 115 blocks down.

  var DEPTH_SCALE = 128;
  var DEPTH_FROM_Y = -64, DEPTH_TO_Y = 320, DEPTH_FROM_V = 1.5, DEPTH_TO_V = -1.5;
  var DEPTH_SLOPE = (DEPTH_TO_V - DEPTH_FROM_V) / (DEPTH_TO_Y - DEPTH_FROM_Y);

  /**
   * Mojang's `y_clamped_gradient` for `overworld/depth` — the y half of vanilla's literal
   * form. The engine does not use it; `climcheck` uses it to prove the identity above.
   */
  CL.depthGradient = function (y) {
    if (y <= DEPTH_FROM_Y) return DEPTH_FROM_V;
    if (y >= DEPTH_TO_Y) return DEPTH_TO_V;
    return DEPTH_FROM_V + (y - DEPTH_FROM_Y) * DEPTH_SLOPE;
  };

  /** The depth axis: how far below this column's surface, in units of 128 blocks. */
  CL.depthAt = function (surfaceY, y) { return (surfaceY - y) / DEPTH_SCALE; };

  var colScratch = new Float64Array(6);

  /**
   * targetFromColumn(c, x, z, surfaceY, y, out) — the six climate values, given W3's six-value
   * column climate, the column's position and its surface height. `out` must hold 6, and takes
   * [temperature, humidity, continentalness, erosion, depth, weirdness] — the axis order,
   * minus `offset`.
   *
   * This is the form the chunk generator wants: the column climate and the surface height are
   * computed once per column and this is called once per quart-y, which is 96 times.
   *
   * ⚠ `x` and `z` are here for the EARTH mode, which needs them for latitude and for the rain
   * shadow. The vanilla mode ignores them, and must: every vanilla axis is already in `c`.
   */
  CL.targetFromColumn = function (c, x, z, surfaceY, y, out) {
    if (CL.mode === CL.MODE_EARTH) return NS.Earth.targetFromColumn(c, x, z, surfaceY, y, out);
    out[0] = c[4];                                   // temperature noise
    out[1] = c[5];                                   // vegetation noise -> humidity
    out[2] = c[0];                                   // continentalness
    out[3] = c[1];                                   // erosion
    out[4] = (surfaceY - y) / DEPTH_SCALE;
    out[5] = c[2];                                   // weirdness (the raw ridge noise)
    return out;
  };

  /**
   * targetInto(x, y, z, out) — the same, computing the column itself. Allocates nothing but
   * does the whole noise stack; not for an inner loop over y.
   */
  CL.targetInto = function (x, y, z, out) {
    NS.Column.climateInto(x, z, colScratch);
    return CL.targetFromColumn(colScratch, x, z, NS.Column.heightFromClimate(colScratch, x, z), y, out);
  };

  var qScratch = new Int32Array(7);
  var tScratch = new Float64Array(6);

  /** quantiseInto(t, q) — the six floats to the seven integers the search wants. */
  CL.quantiseInto = function (t, q) {
    q[0] = Math.trunc(t[0] * Q); q[1] = Math.trunc(t[1] * Q); q[2] = Math.trunc(t[2] * Q);
    q[3] = Math.trunc(t[3] * Q); q[4] = Math.trunc(t[4] * Q); q[5] = Math.trunc(t[5] * Q);
    q[6] = 0;                                        // offset: always zero on the query side
    return q;
  };

  /**
   * biomeOfTarget(t) -> REGISTRY biome index, for six already-computed climate floats.
   *
   * ⚠ Refuses to answer before `bindBiomes`, because the answer would be in the table's index
   * space and every caller reads it as the registry's. Returning a plausible wrong number is
   * exactly how the bug in the note at the top of this file survived.
   */
  CL.biomeOfTarget = function (t) {
    if (!CL.bound) throw new Error('Climate.biomeOfTarget before bindBiomes — the answer would be in the wrong index space');
    return bio[CL.searchEntry(CL.quantiseInto(t, qScratch))];
  };

  /**
   * columnBiomes(c, x, z, surfaceY, y0, count, out, off, stride) — ⚠ THE BIOME VOLUME'S ONE
   * ENTRY POINT (D-180). The biome at `count` successive QUART cells up one quart column,
   * starting at world y `y0` and stepping 4, written to `out[off]`, `out[off + stride]`, ...
   *
   * Answers exactly what `biomeAt(x, y, z)` answers for each of those cells, and costs about a
   * fortieth as much, because the six axes that do not move with y are folded once by
   * `prepColumn` instead of 96 times by `searchEntry`. `c` is W3's six-value column climate at
   * (x, z) and `surfaceY` that column's height — both of which the chunk generator already has
   * in hand when it calls this, which is the other half of why the volume is affordable.
   */
  CL.columnBiomes = function (c, x, z, surfaceY, y0, count, out, off, stride) {
    if (!CL.bound) throw new Error('Climate.columnBiomes before bindBiomes — the answer would be in the wrong index space');
    CL.targetFromColumn(c, x, z, surfaceY, y0, tScratch);
    CL.quantiseInto(tScratch, qScratch);
    foldColumn(qScratch);
    for (var j = 0; j < count; j++) {
      out[off + j * stride] = bio[CL.sweepAt(Math.trunc((surfaceY - (y0 + (j << 2))) / DEPTH_SCALE * Q))];
    }
    return out;
  };

  /**
   * biomeAt(x, y, z) -> biome index.
   *
   * ⚠ PURE, and quart-snapped exactly as vanilla is: the answer is constant inside each 4x4x4
   * cell, which is what makes a biome boundary a straight line on a 4-block grid rather than a
   * per-block fringe. Snapping is `>> 2 << 2` — arithmetic shift, so it floors for negative
   * coordinates too, which `Math.floor(x / 4) * 4` would also do but three times slower.
   */
  CL.biomeAt = function (x, y, z) {
    CL.targetInto((x >> 2) << 2, (y >> 2) << 2, (z >> 2) << 2, tScratch);
    return CL.biomeOfTarget(tScratch);
  };

  /** biomeNameAt(x, y, z) -> 'minecraft:plains'. For the debug screen and for tests. */
  CL.biomeNameAt = function (x, y, z) { return CL.biomeNames[CL.biomeAt(x, y, z)]; };

  /**
   * The surface biome of a column. Asked at the terrain height, where the depth axis is ~0 —
   * the quart snapping means "~0" rather than "0", which is vanilla's behaviour too.
   */
  CL.surfaceBiomeAt = function (x, z) { return CL.biomeAt(x, NS.Column.height(x, z), z); };
})(MCL);
