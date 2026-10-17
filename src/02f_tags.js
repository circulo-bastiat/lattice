// 02f_tags.js — PLAN G1: vanilla's tag registry at runtime.
// Runs on: MAIN THREAD ONLY. No DOM.
//
// ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────────────────
// A tag is 1.18.2's word for a SET, and almost every rule the game has above the terrain is
// phrased as one: `mineable/pickaxe` decides what a pickaxe is fast on, `needs_iron_tool` what
// it may not harvest, `logs` what an axe is for AND what leaf decay searches for, `wooden_fences`
// what a fence connects to, `planks` what a crafting recipe will accept. PLAN G1's argument is
// that building the substrate ONCE stops G2, G3, G9 and G13 each inventing a private list, and
// a private list is what is wrong after a version bump with no test able to tell.
//
// `tools/pack-tags.mjs` reads all 218 registry tag files out of Dan's jar and FLATTENS them —
// `#minecraft:logs` is four tags deep in the source and is one array here — so nothing in this
// file walks a tag graph and no consumer ever sees a `#`.
//
// ⚠ MAIN THREAD ONLY, and that is a size decision. build.mjs inlines every SHARED module into
// the worker bundle as an escaped string, so a shared module is in the built file TWICE. No
// worker asks a tag question: worldgen names blocks directly, and mining, drops, crafting and
// block behaviour are all main-thread. `Reg.init` calls `Tags.init` behind an `if (NS.Tags)`
// exactly the way it calls `WG.init` (D-186's rule: one place both threads reach).
//
// ── WHAT IS **NOT** HERE ─────────────────────────────────────────────────────────────────
// The 42 `worldgen/biome` tags. W13 needed them before G1 existed and they ride `worldgen.bin`
// (D-183); they are reachable as `WG.biomeTag(name)`. `tagcheck` §1 asserts the two payloads
// account for all 270 tag files in the jar, so the split cannot lose one (D-200).
//
// ── THE MEMBERSHIP BITSET ────────────────────────────────────────────────────────────────
// The hot question is "is this block in that tag?", asked by the mining code every time the
// player's target or held item changes and by the neighbour-update code on every block change.
// A per-call array scan of `mineable/pickaxe` is 368 string compares. So `init` builds one
// bitset — 133 block tags x 900 blocks, 17 bytes a block, 15.3 KB — and the answer is a shift
// and an AND. Item tags get a lazily built name Set instead: there is no runtime item index to
// key a bitset by, and no item-tag question is on a hot path.
(function (NS) {
  'use strict';

  var T = NS.Tags = {};

  T.ready = false;
  T.version = '';
  T.decodeMs = 0;

  /** The five registries `pack-tags.mjs` writes, in pack order. */
  T.REGISTRIES = ['blocks', 'items', 'fluids', 'entity_types', 'game_events'];

  var reg = null;              // registry -> { tagName -> [member, ...] }
  var blockTagNames = null;    // the block tags, in pack order — the bitset's column order
  var blockTagIdx = null;      // name -> column
  var blockBits = null;        // Uint8Array(blockCount * stride)
  var stride = 0;
  var itemSets = null;         // tag name -> Object(name -> true), built on demand

  /**
   * `#minecraft:logs`, `minecraft:logs` and `logs` are the same question. The `#` is datapack
   * syntax for "this is a tag reference" and the namespace is always `minecraft` in a vanilla
   * build; both are stripped here so a caller can pass whatever the data file gave it.
   */
  function key(name) {
    var s = String(name);
    if (s.charCodeAt(0) === 35) s = s.slice(1);                 // '#'
    if (s.lastIndexOf('minecraft:', 0) === 0) s = s.slice(10);
    return s;
  }
  T.key = key;

  /** init(data) — `data.tags` is base64 of the deflated blob, `data.tagsBytes` its raw length. */
  T.init = function (data) {
    if (!data || !data.tags) { T.ready = false; return T; }
    var t0 = (NS.U && NS.U.now) ? NS.U.now() : Date.now();
    var b = NS.Z.unpack(data.tags, data.tagsBytes);
    var p = 0;
    function u8() { return b[p++]; }
    function u16() { var v = b[p] | (b[p + 1] << 8); p += 2; return v; }
    if (b[0] !== 77 || b[1] !== 67 || b[2] !== 76 || b[3] !== 71) throw new Error('tags.bin: bad magic');
    p = 4;
    var nStr = u16(), strings = new Array(nStr), i, j, k;
    for (i = 0; i < nStr; i++) {
      var len = u8(), s = '';
      for (j = 0; j < len; j++) s += String.fromCharCode(b[p + j]);
      p += len;
      strings[i] = s;
    }
    reg = Object.create(null);
    var nReg = u8(), total = 0;
    for (i = 0; i < nReg; i++) {
      var rname = strings[u16()], nTags = u16();
      var dst = Object.create(null), order = new Array(nTags);
      for (j = 0; j < nTags; j++) {
        var tname = strings[u16()], nMem = u16(), list = new Array(nMem);
        for (k = 0; k < nMem; k++) list[k] = strings[u16()];
        dst[tname] = list; order[j] = tname; total++;
      }
      reg[rname] = dst;
      if (rname === 'blocks') blockTagNames = order;
    }
    if (p !== b.length) throw new Error('tags.bin: ' + (b.length - p) + ' trailing bytes');

    T.tagCount = total;
    T.strings = nStr;
    itemSets = Object.create(null);
    buildBlockBits();
    T.version = (data.version || '');
    T.decodeMs = ((NS.U && NS.U.now) ? NS.U.now() : Date.now()) - t0;
    T.ready = true;
    return T;
  };

  /**
   * The bitset. Column j is `blockTagNames[j]`; row i is registry block index i. A member name
   * the block registry does not have is COUNTED, not dropped silently — `T.unresolved` is
   * asserted to be empty by tagcheck, because a tag quietly missing half its blocks is exactly
   * the failure this substrate exists to prevent.
   */
  function buildBlockBits() {
    var R = NS.Reg;
    var n = (R && R.ready) ? R.blockCount : 0;
    var nt = blockTagNames ? blockTagNames.length : 0;
    stride = (nt + 7) >> 3;
    blockTagIdx = Object.create(null);
    blockBits = new Uint8Array(n * stride);
    T.unresolved = [];
    T.blockTagCount = nt;
    T.blockBitsBytes = blockBits.length;
    if (!n || !nt) return;
    var src = reg.blocks;
    for (var j = 0; j < nt; j++) {
      var name = blockTagNames[j];
      blockTagIdx[name] = j;
      var list = src[name];
      for (var m = 0; m < list.length; m++) {
        var bi = R.id[list[m]];
        if (bi === undefined) { if (T.unresolved.length < 40) T.unresolved.push(name + '/' + list[m]); continue; }
        blockBits[bi * stride + (j >> 3)] |= 1 << (j & 7);
      }
    }
  }

  /** The tag names of one registry, or [] if there is no such registry. */
  T.names = function (registry) { return reg && reg[registry] ? Object.keys(reg[registry]).sort() : []; };

  /** The flattened member names of one tag, or undefined. Do not mutate the array. */
  T.members = function (registry, name) {
    if (!T.ready || !reg[registry]) return undefined;
    return reg[registry][key(name)];
  };

  /** Shorthands for the two registries anything above the terrain actually asks about. */
  T.blocks = function (name) { return T.members('blocks', name); };
  T.items = function (name) { return T.members('items', name); };

  /** The bitset column of a block tag, or -1. Hold this, not the name, in a loop. */
  T.blockTag = function (name) {
    if (!T.ready) return -1;
    var i = blockTagIdx[key(name)];
    return i === undefined ? -1 : i;
  };

  /** O(1): is registry block index `block` in the tag whose column is `col`? */
  T.blockInCol = function (col, block) {
    if (col < 0 || !blockBits) return false;
    return (blockBits[block * stride + (col >> 3)] >>> (col & 7) & 1) !== 0;
  };

  /** O(1) after one property lookup: is block `block` in tag `name`? */
  T.blockIn = function (name, block) { return T.blockInCol(T.blockTag(name), block); };

  /**
   * The same question asked of a REAL STATE, which is what the world actually stores. A tag is
   * a set of BLOCKS — vanilla's `state.is(tag)` delegates to the block — so this is one table
   * hop through `States.block` and never a per-state set (D-100's id space, 02c's header).
   */
  T.stateIn = function (name, state) {
    var S = NS.States;
    if (!S || !S.ready) return false;
    return T.blockInCol(T.blockTag(name), S.block[state]);
  };
  T.stateInCol = function (col, state) {
    var S = NS.States;
    if (!S || !S.ready) return false;
    return T.blockInCol(col, S.block[state]);
  };

  /** Is an ITEM in an item tag? By name, with the set built on first use. */
  T.itemIn = function (name, item) {
    if (!T.ready) return false;
    var k = key(name), set = itemSets[k];
    if (!set) {
      var list = reg.items[k];
      if (!list) return false;
      set = itemSets[k] = Object.create(null);
      for (var i = 0; i < list.length; i++) set[list[i]] = true;
    }
    return set[item] === true;
  };

  /** Every block index in a tag, as a Uint16Array. Built per call; not for hot loops. */
  T.blockIds = function (name) {
    var list = T.blocks(name);
    if (!list || !NS.Reg.ready) return new Uint16Array(0);
    var out = new Uint16Array(list.length), n = 0;
    for (var i = 0; i < list.length; i++) { var b = NS.Reg.id[list[i]]; if (b !== undefined) out[n++] = b; }
    return out.subarray(0, n);
  };
})(MCL);
