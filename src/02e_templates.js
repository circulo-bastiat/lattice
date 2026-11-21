// 02e_templates.js — the 866 vanilla structure templates at runtime. PLAN W15.
// Runs on: main thread AND workers. No DOM.
//
// ⚠ DATA ONLY, exactly as 02d_wgdata.js is data only. This decodes the blob
// `tools/pack-structures.mjs` writes and hands over a template's blocks; it does not know what a
// jigsaw is, does not rotate anything and does not place anything. W15's assembler
// (`04t_jigsaw.js`) is the code, hand-written against these numbers, for the reason 02d states:
// a generated evaluator would be a second implementation of Minecraft hidden inside a build
// tool and no test could read it.
//
// ── THE FORMAT, WHICH IS PLAN W15's SPECIFICATION AND NOT A CHOICE MADE HERE ────────────────
//
// PLAN W15: *"the 866 `.nbt` pieces re-encoded: one GLOBAL palette across all pieces, varint
// positions, RLE over sorted positions, DEFLATE, base64."*
//
//   "MLS1"                    magic
//   varint n, then n strings  (varint byte length + UTF-8) — block names, jigsaw names, ids
//   varint n, then n palette rows: varint blockNameStringIndex, varint LOCAL state index
//                             then n varints: the palette index of each entry rotated ONE
//                             clockwise quarter-turn (D-187 — the engine cannot compute this,
//                             see the note in tools/statelib.mjs)
//   varint n, then n block tags: varint nameStringIndex, varint memberCount, member indices
//                             (only the tags a `processor_list` names — one, `doors`, D-187)
//   varint n, then n templates:
//       varint idStringIndex, varint sizeX, sizeY, sizeZ
//       varint paletteCount, then per palette:
//           varint runCount, then per run: varint gap, varint length, varint paletteIndex
//       varint jigsawCount, then per jigsaw:
//           varint linearPos, name, target, pool, joint, finalStatePalette, front, top
//
// A position is `(y * sizeZ + z) * sizeX + x`, runs are sorted ascending by it, and `gap` is the
// distance from the END of the previous run — so a solid wall costs three bytes however long it
// is. 699,080 block entries become 188,744 runs, 139 KB deflated, 186 KB as base64 (D-186).
//
// ── ⚠ DECODING IS LAZY AND THAT IS THE COST DECISION ────────────────────────────────────────
//
// Expanding all 866 templates to (position, state) pairs is 699,080 entries and about 5.6 MB of
// typed array. A world never needs them all: a plains village pulls forty templates and a
// desert village pulls forty different ones. So the header — sizes, jigsaw graph, and where each
// template's run stream starts — is decoded eagerly (it is what the ASSEMBLER walks, and it is
// small), and the run streams themselves are expanded on first use and cached. `Templates.stats`
// reports how many have actually been expanded, and `structcheck` asserts a generated village
// expands a small fraction of them.

(function (NS) {
  'use strict';

  var T = NS.Templates = { ready: false, count: 0, decodeMs: 0, bytes: 0 };

  var buf = null;                 // the inflated blob
  var strings = null;             // string table
  var palBlock = null;            // palette index -> block name string index
  var palLocal = null;            // palette index -> local state index
  var palReal = null;             // palette index -> REAL state (resolved once, at init)
  var palRot = null;              // palette index -> the same state, one quarter-turn clockwise
  var palFlag = null;             // 1 = structure_void, 2 = jigsaw, 4 = air
  var list = null;                // the decoded headers
  var byId = null;                // id string -> index
  var tags = null;                // block tag name -> array of block names

  var FLAG_VOID = 1, FLAG_JIGSAW = 2, FLAG_AIR = 4;
  T.FLAG_VOID = FLAG_VOID; T.FLAG_JIGSAW = FLAG_JIGSAW; T.FLAG_AIR = FLAG_AIR;

  function unzz(n) { return (n & 1) ? -((n + 1) / 2) : n / 2; }

  // ── varint reading ────────────────────────────────────────────────────────────────────────
  var p = 0;
  function v() {
    var n = 0, sh = 0, b;
    do { b = buf[p++]; n |= (b & 0x7f) << sh; sh += 7; } while (b & 0x80);
    return n >>> 0;
  }

  /**
   * init(data) — `data.templates` is base64 of the deflated blob, `data.templatesBytes` its
   * inflated length. Called from `WG.init`, which is the one place both the main thread and
   * every worker reach with the same payload.
   */
  T.init = function (data) {
    if (!data || !data.templates) { T.ready = false; return T; }
    var t0 = (NS.U && NS.U.now) ? NS.U.now() : Date.now();
    buf = NS.Z.unpack(data.templates, data.templatesBytes);
    T.bytes = buf.length;
    p = 0;
    if (buf[0] !== 0x4d || buf[1] !== 0x4c || buf[2] !== 0x53 || buf[3] !== 0x31) {
      throw new Error('Templates: bad magic — this is not an MLS1 blob');
    }
    p = 4;

    var n = v(), i;
    strings = new Array(n);
    for (i = 0; i < n; i++) {
      var len = v(), s = '';
      // ASCII by construction — every string is a Minecraft id or a property key — so a byte
      // walk is correct and much faster than TextDecoder here. `structcheck` asserts it.
      for (var k = 0; k < len; k++) s += String.fromCharCode(buf[p + k]);
      p += len;
      strings[i] = s;
    }

    n = v();
    palBlock = new Int32Array(n); palLocal = new Int32Array(n);
    palReal = new Int32Array(n); palFlag = new Uint8Array(n); palRot = new Int32Array(n);
    for (i = 0; i < n; i++) {
      palBlock[i] = v(); palLocal[i] = v();
      var nm = strings[palBlock[i]];
      // ⚠ RESOLVED ONCE, HERE. `States.withLocal` is a registry lookup and a bounds test; doing
      // it per placed block would put it inside the write loop of every village in the world.
      palReal[i] = NS.States ? NS.States.withLocal(nm, palLocal[i]) : 0;
      // ⚠ `structure_block` IS IGNORED TOO, AND IT IS THE SAME RULE (D-212). Vanilla places every
      // one of these templates through `BlockIgnoreProcessor.STRUCTURE_BLOCK`, which drops
      // `minecraft:structure_block` from the palette so nothing is written at that cell — the
      // same "leave what is there" that `structure_void` means. Without it the data markers
      // Mojang left in the NBT are written into the world as real, visible structure blocks:
      // `structaudit` §3 measured **196 of them across 97 of the 866 packed templates**
      // (underwater_ruin 98, shipwreck 44, woodland_mansion 34, end_city 19, igloo 1).
      palFlag[i] = ((nm === 'structure_void' || nm === 'structure_block') ? FLAG_VOID : 0) |
                   (nm === 'jigsaw' ? FLAG_JIGSAW : 0) |
                   (nm === 'air' || nm === 'cave_air' ? FLAG_AIR : 0);
    }
    for (i = 0; i < n; i++) palRot[i] = v();

    n = v();
    tags = Object.create(null);
    for (i = 0; i < n; i++) {
      var tn = strings[v()], tc = v(), tl = new Array(tc);
      for (var tq = 0; tq < tc; tq++) tl[tq] = strings[v()];
      tags[tn] = tl;
    }

    n = v();
    list = new Array(n);
    byId = Object.create(null);
    for (i = 0; i < n; i++) {
      var e = { id: strings[v()], sx: v(), sy: v(), sz: v(), pal: null, jig: null, ents: null, meta: null, cache: null };
      var np = v();
      e.pal = new Array(np);
      for (var q = 0; q < np; q++) {
        var runs = v();
        // ⚠ the stream is SKIPPED, not read: [offset, runCount] is all the header keeps, and
        // `blocksOf` walks the bytes when something actually asks for this template.
        e.pal[q] = [p, runs];
        for (var r = 0; r < runs; r++) { v(); v(); v(); }
      }
      var nj = v();
      e.jig = new Array(nj);
      for (var j = 0; j < nj; j++) {
        e.jig[j] = { pos: v(), name: strings[v()], target: strings[v()], pool: strings[v()],
                     joint: v(), finalPal: v(), front: v(), top: v() };
      }
      // entities: name, position x16, yaw (all zigzag) — StructureTemplate.placeEntities' input
      var ne = v();
      e.ents = new Array(ne);
      for (var en = 0; en < ne; en++) {
        var eid = strings[v()];
        var ex = v(), ey = v(), ez = v(), eyaw = v();
        e.ents[en] = { id: eid, x: unzz(ex) / 16, y: unzz(ey) / 16, z: unzz(ez) / 16, yaw: unzz(eyaw) };
      }
      // structure_block DATA markers (pos = linear index, data = the metadata string), #4560
      var nm2 = v();
      e.meta = new Array(nm2);
      for (var mi = 0; mi < nm2; mi++) e.meta[mi] = { pos: v(), data: strings[v()] };
      list[i] = e;
      byId[e.id] = i;
    }
    T.count = list.length;
    T.ready = true;
    T.decodeMs = ((NS.U && NS.U.now) ? NS.U.now() : Date.now()) - t0;
    return T;
  };

  /**
   * blockTag(name) -> the block NAMES in a vanilla block tag, or undefined.
   * ⚠ Only the tags a `processor_list` names are here — `minecraft:doors`, which the five zombie
   * village processors turn into air. PLAN G1 owns the general block-tag substrate; this is the
   * narrow slice W15 could not be correct without (D-187).
   */
  T.blockTag = function (name) {
    if (!tags) return undefined;
    var k = String(name);
    if (k.charCodeAt(0) === 35) k = k.slice(1);
    if (k.indexOf('minecraft:') === 0) k = k.slice(10);
    return tags[k];
  };
  T.blockTagNames = function () { return tags ? Object.keys(tags).sort() : []; };

  /** index(id) -> the template's index, or -1. Ids may carry the namespace. */
  T.index = function (id) {
    if (!T.ready) return -1;
    var k = String(id);
    if (k.indexOf('minecraft:') === 0) k = k.slice(10);
    var i = byId[k];
    return i === undefined ? -1 : i;
  };

  /** get(i) -> the header: id, sx, sy, sz, jig (the connector list), pal (per-palette streams). */
  T.get = function (i) { return (T.ready && i >= 0 && i < list.length) ? list[i] : null; };
  T.names = function () { return Object.keys(byId).sort(); };

  /**
   * rotPal(pi, r) -> the palette index of that state after r clockwise quarter-turns.
   * ⚠ Four turns is the identity, for all 1,363 entries, and `pack-structures.mjs` refuses to
   * write a blob where that is not true (D-187). The runtime is one array read per turn.
   */
  T.rotPal = function (pi, r) {
    r &= 3;
    while (r--) pi = palRot[pi];
    return pi;
  };
  /** The whole one-turn table, for a caller that wants to fold it once. */
  T.rotTable = function () { return palRot; };

  /** The REAL state and the flags for a global palette index. */
  T.realOf = function (pi) { return palReal[pi]; };
  T.flagOf = function (pi) { return palFlag[pi]; };
  T.blockNameOf = function (pi) { return strings[palBlock[pi]]; };
  T.paletteCount = function () { return palReal ? palReal.length : 0; };

  var expanded = 0;

  /**
   * blocksOf(i, palIdx) -> { pos: Int32Array, pal: Int32Array } — every block of one template
   * under one of its palettes, sorted by linear position. Expanded on first use and kept.
   */
  T.blocksOf = function (i, palIdx) {
    var e = list[i];
    if (!e.cache) e.cache = new Array(e.pal.length);
    var got = e.cache[palIdx];
    if (got) return got;
    var at = e.pal[palIdx][0], runs = e.pal[palIdx][1];
    // one pass to count, one to fill: a run's length is not known until it is read, and growing
    // an array of 15,000 entries a push at a time is what makes a decode show up on a profile.
    var save = p;
    p = at;
    var total = 0, r;
    for (r = 0; r < runs; r++) { v(); total += v(); v(); }
    var pos = new Int32Array(total), pal = new Int32Array(total);
    p = at;
    var w = 0, end = 0;
    for (r = 0; r < runs; r++) {
      var gap = v(), len = v(), st = v();
      var s = end + gap;
      for (var q = 0; q < len; q++) { pos[w] = s + q; pal[w] = st; w++; }
      end = s + len;
    }
    p = save;
    got = { pos: pos, pal: pal };
    e.cache[palIdx] = got;
    expanded++;
    return got;
  };

  /** Throw away every expanded stream. For the checks, and for a memory ceiling later. */
  T.dropCache = function () {
    if (!list) return T;
    for (var i = 0; i < list.length; i++) list[i].cache = null;
    expanded = 0;
    return T;
  };

  T.stats = function () {
    var blocks = 0, jig = 0;
    if (list) for (var i = 0; i < list.length; i++) jig += list[i].jig.length;
    if (list) for (i = 0; i < list.length; i++) if (list[i].cache) {
      for (var q = 0; q < list[i].cache.length; q++) if (list[i].cache[q]) blocks += list[i].cache[q].pos.length;
    }
    return { templates: T.count, palette: T.paletteCount(), jigsaws: jig,
             bytes: T.bytes, expanded: expanded, expandedBlocks: blocks, decodeMs: T.decodeMs };
  };
})(MCL);
