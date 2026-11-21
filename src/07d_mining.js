// 07d_mining.js — PLAN G3: how long a block takes to break, and whether it drops.
// Runs on: MAIN THREAD ONLY. No DOM.
//
// ── THE FORMULA, AND WHERE IT DIFFERS FROM PLAN's PARAPHRASE ─────────────────────────────
// Vanilla 1.18.2 is `Player.getDestroySpeed(BlockState)` followed by
// `BlockBehaviour.BlockStateBase.getDestroyProgress`:
//
//   speed  = the held item's getDestroySpeed for this block          (1.0 for a bare hand)
//   if (speed > 1)  speed += efficiency*efficiency + 1               ⚠ ADDED, and only then
//   if (haste)      speed *= 1 + 0.2*hasteLevel
//   if (fatigue)    speed *= [0.3, 0.09, 0.0027, 0.00081][level-1]   ⚠ NOT a power of 0.3
//   if (eyes in water && no aqua affinity) speed /= 5
//   if (!onGround)                        speed /= 5
//   progressPerTick = speed / hardness / (canHarvest ? 30 : 100)
//   ticks = ceil(1 / progressPerTick)                                (0 progress => never)
//
// ⚠ **PLAN §5's G3 BLOCK GETS THREE OF THOSE LINES WRONG, AND THIS FILE FOLLOWS VANILLA**
// (D-203). PLAN writes Efficiency as a MULTIPLIER `(level² + 1)`, Haste as `1.2^level` and
// Mining Fatigue as `0.3^min(level,4)`. Vanilla ADDS `level² + 1` and only when the base speed
// already exceeds 1 — so Efficiency V on a diamond pickaxe is 8 + 26 = 34, not 8 × 26 = 208, and
// Efficiency V on a pickaxe mining DIRT is 1, not 26. Haste is linear, and Fatigue's third step
// is 0.0027 rather than 0.027. CLAUDE.md's governing rule decides this: *"does real Minecraft do
// it? If yes, and it is not worldgen or rendering, do it exactly."* PLAN's block is a summary
// written from memory; the game is the specification.
//
// ── THE TWO PER-(ITEM, BLOCK) TABLES, AND WHY NEITHER IS GUESSED ─────────────────────────
// `tools/pack-mining.mjs`'s header has the argument in full (D-201). In short: `getDestroySpeed`
// and `isCorrectToolForDrops` are Java overrides, but minecraft-data has already evaluated both
// for every pair — `materials.json` is the speed table (16 classes x 31 items), `harvestTools`
// is the harvest answer including cobweb's swords-and-shears special case. Tier LEVEL integers
// from `Tiers.java` are neither ported nor needed: a level exists only to be compared with the
// `needs_*_tool` tags, and `harvestTools` IS that comparison's result.
//
// ── FLOAT32, DELIBERATELY ────────────────────────────────────────────────────────────────
// Vanilla does this arithmetic in `float`. PLAN's acceptance is *"break times asserted to the
// tick"*, and a double-precision chain rounds differently from a float one often enough to move
// a `ceil` by one — cobblestone with a wooden pickaxe is 1.15 ticks either way, but the ore
// tables are full of values that land on an integer. Every step below goes through
// `Math.fround`, which is what `float` arithmetic is.
(function (NS) {
  'use strict';

  var M = NS.Mining = {};
  var fr = Math.fround;

  M.ready = false;
  M.toolNames = null;        // tool item index -> name
  M.toolIdx = null;          // name -> tool item index
  M.materialNames = null;
  var speed = null;          // material index -> Float32Array(toolCount), 1.0 where absent
  var material = null;       // block index -> material index
  var harvest = null;        // block index * HB bytes, one bit per tool item
  var HB = 0;

  /**
   * Mining Fatigue, from `Player.getDestroySpeed`'s switch. Level here is 1-based (Fatigue I is
   * amplifier 0), and vanilla's `default:` arm covers every level above III — so Fatigue IV and
   * Fatigue MMXXII are the same 8.1E-4.
   */
  var FATIGUE = [0.3, 0.09, 0.0027, 0.00081];
  M.FATIGUE = FATIGUE;
  var F02 = Math.fround(0.2);

  /** init(data) — `data.mining` is base64 of the deflated blob, `data.miningBytes` its length. */
  M.init = function (data) {
    if (!data || !data.mining) { M.ready = false; return M; }
    var R = NS.Reg;
    if (!R || !R.ready) throw new Error('Mining.init before Reg.init');
    var b = NS.Z.unpack(data.mining, data.miningBytes);
    if (b[0] !== 77 || b[1] !== 67 || b[2] !== 76 || b[3] !== 77) throw new Error('mining.bin: bad magic');
    var p = 4, i, j;
    function u8() { return b[p++]; }
    function u16() { var v = b[p] | (b[p + 1] << 8); p += 2; return v; }
    function f32() { var v = new DataView(b.buffer, b.byteOffset + p, 4).getFloat32(0, true); p += 4; return v; }
    var nStr = u16(), strings = new Array(nStr);
    for (i = 0; i < nStr; i++) {
      var len = u8(), s = '';
      for (j = 0; j < len; j++) s += String.fromCharCode(b[p + j]);
      p += len; strings[i] = s;
    }
    var nTools = u8();
    M.toolNames = new Array(nTools);
    M.toolIdx = Object.create(null);
    for (i = 0; i < nTools; i++) { M.toolNames[i] = strings[u16()]; M.toolIdx[M.toolNames[i]] = i; }
    HB = (nTools + 7) >> 3;
    var nMat = u8();
    M.materialNames = new Array(nMat);
    speed = new Array(nMat);
    for (i = 0; i < nMat; i++) {
      M.materialNames[i] = strings[u16()];
      var row = new Float32Array(nTools);
      for (j = 0; j < nTools; j++) row[j] = 1;      // an item with no entry returns Item's 1.0
      var n = u8();
      for (j = 0; j < n; j++) { var t = u8(); row[t] = f32(); }
      speed[i] = row;
    }
    var nb = R.blockCount;
    // ⚠ THE FILL VALUE IS `default`, NOT ZERO. `materials.json`'s keys sort with `coweb` first,
    // and two blocks in the roster (`item_frame`, `glow_item_frame`) have no minecraft-data
    // entry at all — a zero-filled array would have made both of them cobweb, breakable in
    // 0.4 s with shears and requiring a tool. The default material is the one with no entries,
    // which is what `Item.getDestroySpeed` returns 1.0 for.
    var defMat = M.materialNames.indexOf('default');
    material = new Uint8Array(nb);
    if (defMat > 0) material.fill(defMat);
    harvest = new Uint8Array(nb * HB);
    var rows = u16();
    M.unknownBlocks = [];
    for (i = 0; i < rows; i++) {
      var name = strings[u16()], mi = u8();
      var bi = R.id[name];
      if (bi === undefined) {
        // ⚠ NOT SILENT. A block the packer knows and the registry does not means the two
        // sources have drifted, which is exactly what D-5's generated-registry rule exists to
        // catch; `minecheck` §1 asserts this list is empty.
        if (M.unknownBlocks.length < 40) M.unknownBlocks.push(name);
        p += HB; continue;
      }
      material[bi] = mi;
      for (j = 0; j < HB; j++) harvest[bi * HB + j] = b[p + j];
      p += HB;
    }
    if (p !== b.length) throw new Error('mining.bin: ' + (b.length - p) + ' trailing bytes');
    M.toolCount = nTools;
    M.materialCount = nMat;
    M.blockRows = rows;
    M.ready = true;
    return M;
  };

  /** The block's material class name — `mineable/pickaxe`, `coweb`, `default`. */
  M.materialOf = function (block) { return M.ready ? M.materialNames[material[block]] : 'default'; };

  /**
   * `Item.getDestroySpeed(stack, state)` — what the held item is worth against this block.
   * `item` is an item NAME or null/'' for a bare hand. Unknown items are 1.0, which is what
   * `Item`'s own base implementation returns.
   */
  M.itemSpeed = function (item, block) {
    if (!M.ready || !item) return 1;
    var t = M.toolIdx[item];
    if (t === undefined) return 1;
    return speed[material[block]][t];
  };

  /**
   * `Player.hasCorrectToolForDrops(state)` — false only when the block requires a correct tool
   * and the held item is not one of them. Every block that does NOT require a tool answers true
   * for a bare hand, which is what makes dirt drop and stone not.
   */
  M.canHarvest = function (block, item) {
    if (!M.ready) return true;
    if (!NS.Reg.needsTool(block)) return true;
    if (!item) return false;
    var t = M.toolIdx[item];
    if (t === undefined) return false;
    return (harvest[block * HB + (t >> 3)] >>> (t & 7) & 1) !== 0;
  };

  /**
   * `Player.getDestroySpeed(state)` in full. `ctx` is optional and every field defaults to the
   * unmodified case:
   *   item          held item name, '' or null for a bare hand
   *   efficiency    enchantment level (0 none)
   *   haste         effect level, 1-based (Haste I is 1)
   *   fatigue       effect level, 1-based
   *   inWater       the player's EYES are in water (vanilla's isEyeInFluid, not "wet")
   *   aquaAffinity  cancels the water penalty
   *   onGround      default TRUE — the penalty is for being airborne
   */
  M.playerSpeed = function (block, ctx) {
    var c = ctx || {};
    var f = fr(M.itemSpeed(c.item, block));
    if (f > 1 && c.efficiency > 0 && c.item) f = fr(f + fr(c.efficiency * c.efficiency + 1));
    if (c.haste > 0) f = fr(f * fr(1 + fr(c.haste * F02)));   // `1.0F + (float)(amp + 1) * 0.2F`, float all through
    if (c.fatigue > 0) f = fr(f * fr(FATIGUE[Math.min(c.fatigue, 4) - 1]));
    if (c.inWater && !c.aquaAffinity) f = fr(f / 5);
    if (c.onGround === false) f = fr(f / 5);
    return f;
  };

  /**
   * `getDestroyProgress` — the fraction of the block broken in ONE tick. 0 means never: an
   * unbreakable block (bedrock, hardness -1, stored here as Infinity by pack-runtime) and a
   * speed the modifiers have driven to zero both land here.
   */
  M.progress = function (state, ctx) {
    var S = NS.States, R = NS.Reg;
    if (!S || !S.ready) return 0;
    var block = S.block[state];
    var h = R.hard[block];
    if (!isFinite(h)) return 0;
    if (h === 0) return 1;                       // instant: vanilla divides, and 1/0 is +inf
    var c = ctx || {};
    var i = M.canHarvest(block, c.item) ? 30 : 100;
    return fr(fr(M.playerSpeed(block, c) / h) / i);
  };

  /**
   * Ticks to break, `Infinity` for never. Vanilla accumulates `progress` each tick and breaks
   * the block the moment the running total reaches 1.0, so this is a ceiling, and a block that
   * breaks in one tick is what the game calls an instant break.
   */
  /**
   * ⚠ `ceil(1/progress)` IS NOT ALWAYS THE WIKI'S NUMBER, AND THAT IS FLOAT32 (D-209). Vanilla
   * computes `progress` in `float`, and for cobblestone by hand that is 0.0049999998882 rather
   * than 0.005 — reciprocal 200.0000045, so the block breaks on tick 201 and the wiki's "10
   * seconds" is 10.05. Three blocks in the game round that way (cobblestone, obsidian and cobweb
   * broken bare-handed); everything else agrees with the rational answer exactly. Vanilla's own
   * client ACCUMULATES `progress` a tick at a time and its server multiplies by the elapsed
   * ticks, and all three forms agree to within this same one tick — so the closed form is used
   * here, because a break at 6.2 million ticks (obsidian, wrong tool, Mining Fatigue IV) must
   * not be a 6.2-million-iteration loop on the frame the player looks at it.
   */
  M.ticks = function (state, ctx) {
    var p = M.progress(state, ctx);
    if (!(p > 0)) return Infinity;
    if (p >= 1) return 1;
    return Math.ceil(1 / p);
  };

  /** Seconds at 20 ticks a second — what a player experiences and what PLAN's table quotes. */
  M.seconds = function (state, ctx) {
    var t = M.ticks(state, ctx);
    return isFinite(t) ? t / 20 : Infinity;
  };

  /** True when the block comes apart in the first tick — no crack animation, no progress bar. */
  M.instant = function (state, ctx) { return M.progress(state, ctx) >= 1; };
})(MCL);
