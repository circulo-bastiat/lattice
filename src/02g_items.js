// 02g_items.js — PLAN G7/G8. The item table, decoded.
//
// MAIN THREAD ONLY. A worker generates and meshes the world; it never holds an item stack, and
// `NS.DATA` does not travel to one. If that ever changes, this decodes from the same blob shape
// the registry does and can ride the `reg` message the way `tileAlpha` does.
//
// ⚠ ITEMS ARE NOT BLOCKS AND THE TABLE IS KEYED DIFFERENTLY. The block registry is indexed by
// REAL STATE — 20,344 of them — because every hot loop asks about a cell. There are 1,100 items
// and nothing asks about one at 60 Hz; what asks is a slot, a click and a save. So this is a
// small, name-keyed table with vanilla's own item id kept beside it, and the one number it
// precomputes is the block item's DEFAULT REAL STATE, because a hotbar slot, a save and a
// placement all need the state a click produces.

(function (NS) {
  'use strict';

  var IT = NS.Items = {
    ready: false,
    count: 0,
    names: [],              // index -> name
    index: Object.create(null),   // name -> index
    byId: Object.create(null),    // vanilla item id -> index
    id: null,               // Uint16Array — vanilla's own item id
    stackSize: null,        // Uint8Array
    durability: null,       // Uint16Array — 0 means it does not break
    flags: null,            // Uint8Array — 1 handheld · 2 block · 4 edible · 8 fast · 16 tinted
    nutrition: null,        // Uint8Array
    saturation: null,       // Float32Array
    tint0: null, tint1: null,     // Int32Array — -1 is vanilla's "no tint"
    tab: null,              // Uint8Array — the creative tab COLUMN, 255 for "in no tab" (G11b)
    tabs: null,             // the 12-entry tab strip: { col, lang, icon, item }
    state: null,            // Uint16Array — the block item's default REAL state, 0xFFFF if none
    layerOff: null,         // Uint32Array(count + 1) into layerTile
    layerTile: null,        // Uint16Array — the item atlas tile of each sprite layer, in order

    F_HANDHELD: 1, F_BLOCK: 2, F_EDIBLE: 4, F_FAST: 8, F_TINTED: 16,
    // D-266 — bits 32|64|128 are the EQUIPMENT SLOT, out of the jar's bytecode.
    EQUIP_SHIFT: 5,
    MAINHAND: 0, OFFHAND: 1, FEET: 2, LEGS: 3, CHEST: 4, HEAD: 5
  };

  /** init(data) — decode `items.bin` out of the same base64 the rest of NS.DATA travels in. */
  IT.init = function (data) {
    if (!data || !data.items) return false;
    var b = NS.Z.unpack(data.items, data.itemsBytes);
    var dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    var p = 0;
    var magic = String.fromCharCode(b[0], b[1], b[2], b[3]);
    if (magic !== 'MCLI') throw new Error('items.bin: bad magic ' + magic);
    p = 4;
    var n = dv.getUint16(p, true); p += 2;
    IT.count = n;
    // ⚠⚠ **THE HAND TRANSFORM TABLE, AND IT IS A TABLE BECAUSE THERE ARE NINETEEN OF THEM**
    // (D-359). `firstperson_righthand` out of each item model, deduped by the packer: 1,226
    // items, nineteen distinct transforms. Until tonight this engine had ONE — `block/block`'s
    // — hard-coded in the icon rasteriser and applied to every item in the game, which is most
    // of what Dan meant by *"items in your hand are still not even close to vanilla"*.
    var nHand = b[p]; p += 1;
    IT.handCount = nHand;
    IT.handTable = new Float32Array(nHand * 9);
    for (var hi = 0; hi < nHand * 9; hi++) { IT.handTable[hi] = dv.getFloat32(p, true); p += 4; }
    IT.handIdx = new Uint8Array(n);
    // ⚠ PLAN G11b — THE CREATIVE TAB STRIP, and it travels HERE rather than beside the item table
    // because a column number in a row means nothing without the strip that says what column 6
    // is. `col` is vanilla's own cell in the 6-wide, 2-deep strip (NOT a declaration index — see
    // `tools/extract-creative.mjs`), `lang` is the key the shipped language file answers, and
    // `icon` is the item vanilla draws on the tab, read out of the tab's own bytecode.
    var nTabs = b[p]; p += 1;
    IT.tabs = new Array(nTabs);
    for (var t = 0; t < nTabs; t++) {
      var col = b[p]; p += 1;
      var ll = b[p]; p += 1;
      var lang = '';
      for (var lq = 0; lq < ll; lq++) lang += String.fromCharCode(b[p + lq]);
      p += ll;
      var il = b[p]; p += 1;
      var icon = '';
      for (var iq = 0; iq < il; iq++) icon += String.fromCharCode(b[p + iq]);
      p += il;
      IT.tabs[t] = { col: col, lang: lang, icon: icon, item: -1 };
    }
    IT.names = new Array(n);
    IT.index = Object.create(null);
    IT.byId = Object.create(null);
    IT.id = new Uint16Array(n);
    IT.stackSize = new Uint8Array(n);
    IT.durability = new Uint16Array(n);
    IT.flags = new Uint8Array(n);
    IT.nutrition = new Uint8Array(n);
    // ⚠ D-291 — armour, out of the jar's bytecode. `defense` is the points this piece is worth
    // IN ITS OWN SLOT; `toughness` and `knockback` are the material's, repeated on every piece
    // of it, because that is how vanilla asks for them (per worn stack, not per material).
    IT.defense = new Uint8Array(n);
    IT.toughness = new Uint8Array(n);
    IT.knockback100 = new Uint8Array(n);
    // G11b — the creative tab COLUMN, or 255 for the eighteen items in no tab at all.
    IT.tab = new Uint8Array(n);
    IT.saturation = new Float32Array(n);
    IT.tint0 = new Int32Array(n);
    IT.tint1 = new Int32Array(n);
    IT.state = new Uint16Array(n);
    IT.layerOff = new Uint32Array(n + 1);
    var tiles = [];
    for (var i = 0; i < n; i++) {
      IT.id[i] = dv.getUint16(p, true); p += 2;
      var nl = b[p]; p += 1;
      var name = '';
      for (var k = 0; k < nl; k++) name += String.fromCharCode(b[p + k]);
      p += nl;
      IT.names[i] = name;
      IT.index[name] = i;
      IT.byId[IT.id[i]] = i;
      IT.stackSize[i] = b[p]; p += 1;
      IT.durability[i] = dv.getUint16(p, true); p += 2;
      IT.flags[i] = b[p]; p += 1;
      IT.nutrition[i] = b[p]; p += 1;
      IT.defense[i] = b[p]; p += 1;
      IT.toughness[i] = b[p]; p += 1;
      IT.knockback100[i] = b[p]; p += 1;
      IT.tab[i] = b[p]; p += 1;
      IT.saturation[i] = dv.getFloat32(p, true); p += 4;
      IT.tint0[i] = dv.getInt32(p, true); p += 4;
      IT.tint1[i] = dv.getInt32(p, true); p += 4;
      IT.state[i] = dv.getUint16(p, true); p += 2;
      IT.layerOff[i] = tiles.length;
      var nlay = b[p]; p += 1;
      for (var j = 0; j < nlay; j++) { tiles.push(dv.getUint16(p, true)); p += 2; }
      IT.handIdx[i] = b[p]; p += 1;
    }
    IT.layerOff[n] = tiles.length;
    IT.layerTile = Uint16Array.from(tiles);
    // s134 -- the THIRD-PERSON hand table (`thirdperson_righthand`, a mob's held item), trailing
    // the rows (tools/pack-items.mjs). Absent in an older items.bin: every lookup answers null.
    IT.h3Count = 0; IT.h3Table = new Float32Array(0); IT.h3Idx = new Uint8Array(n).fill(255);
    if (p < b.length) {
      var n3 = b[p]; p += 1;
      IT.h3Count = n3; IT.h3Table = new Float32Array(n3 * 9);
      for (var h3 = 0; h3 < n3 * 9; h3++) { IT.h3Table[h3] = dv.getFloat32(p, true); p += 4; }
      for (var i3 = 0; i3 < n; i3++) { IT.h3Idx[i3] = b[p]; p += 1; }
    }
    // #4982 -- the ITEM MODEL section (tools/pack-items.mjs): the quads of each block item's own
    // model and its `gui` display transform, so a slot draws what vanilla draws and not the placed
    // block's default state. Absent in an older items.bin: every item answers "no model".
    IT.mPartOff = new Uint32Array(1); IT.mFlags = new Uint16Array(0); IT.mTile = new Uint16Array(0);
    IT.mPos = new Int16Array(0); IT.mUv = new Int16Array(0);
    IT.mPart = new Uint16Array(n).fill(0xFFFF); IT.mGuiIdx = new Uint8Array(n).fill(255);
    IT.mGuiTable = new Float32Array(0);
    if (p < b.length) {
      var nmp = dv.getUint16(p, true); p += 2;
      var q0 = p, nq = 0, pi, qi;
      for (pi = 0; pi < nmp; pi++) { var cnt = dv.getUint16(p, true); nq += cnt; p += 2 + cnt * 44; }
      IT.mPartOff = new Uint32Array(nmp + 1); IT.mFlags = new Uint16Array(nq); IT.mTile = new Uint16Array(nq);
      IT.mPos = new Int16Array(nq * 12); IT.mUv = new Int16Array(nq * 8);
      p = q0; var qn = 0;
      for (pi = 0; pi < nmp; pi++) {
        IT.mPartOff[pi] = qn;
        var cn = dv.getUint16(p, true); p += 2;
        for (qi = 0; qi < cn; qi++) {
          IT.mFlags[qn] = dv.getUint16(p, true); IT.mTile[qn] = dv.getUint16(p + 2, true); p += 4;
          for (var kq = 0; kq < 12; kq++) { IT.mPos[qn * 12 + kq] = dv.getInt16(p, true); p += 2; }
          for (kq = 0; kq < 8; kq++) { IT.mUv[qn * 8 + kq] = dv.getInt16(p, true); p += 2; }
          qn++;
        }
      }
      IT.mPartOff[nmp] = qn;
      var ngui = b[p]; p += 1;
      IT.mGuiTable = new Float32Array(ngui * 9);
      for (var gq = 0; gq < ngui * 9; gq++) { IT.mGuiTable[gq] = dv.getFloat32(p, true); p += 4; }
      for (var im = 0; im < n; im++) { IT.mPart[im] = dv.getUint16(p, true); IT.mGuiIdx[im] = b[p + 2]; p += 3; }
    }
    // #10807 -- per-stack colour layers: item -> [layer index, UNTINTED atlas tile] (tools/pack-items.mjs)
    IT.stackTint = {};
    if (p < b.length) {
      var nsb = b[p]; p += 1;
      for (var sb = 0; sb < nsb; sb++) { IT.stackTint[dv.getUint16(p, true)] = [b[p + 2], dv.getUint16(p + 3, true)]; p += 5; }
    }
    // the tab icons, resolved once the name index exists
    for (var ti = 0; ti < IT.tabs.length; ti++) {
      var ix = IT.index[IT.tabs[ti].icon];
      IT.tabs[ti].item = ix === undefined ? -1 : ix;
    }
    IT.ready = true;
    return true;
  };

  // ── the questions a slot, a click and a save actually ask ─────────────────────────────────
  IT.of = function (name) { var i = IT.index[name]; return i === undefined ? -1 : i; };
  IT.nameOf = function (i) { return IT.names[i]; };
  IT.maxStack = function (i) { return IT.stackSize[i] || 64; };
  IT.isBlock = function (i) { return (IT.flags[i] & IT.F_BLOCK) !== 0; };
  IT.isEdible = function (i) { return (IT.flags[i] & IT.F_EDIBLE) !== 0; };
  IT.isTinted = function (i) { return (IT.flags[i] & IT.F_TINTED) !== 0; };
  IT.isHandheld = function (i) { return (IT.flags[i] & IT.F_HANDHELD) !== 0; };
  /** G11b — the creative tab column of item `i`, or -1 when it is in no tab. */
  IT.tabOf = function (i) { var c = IT.tab[i]; return c === 255 ? -1 : c; };
  IT.NO_TAB = 255;
  /**
   * `Mob.getEquipmentSlotForItem` (D-266) — 0 mainhand · 1 offhand · 2 feet · 3 legs ·
   * 4 chest · 5 head. ⚠ NOT a name suffix: `turtle_helmet`, `elytra`, `carved_pumpkin` and
   * the six skulls are all worn and none of them ends in the word a suffix rule would want.
   */
  IT.equipSlot = function (i) { return (IT.flags[i] >> IT.EQUIP_SHIFT) & 7; };
  IT.isWearable = function (i) { return IT.equipSlot(i) >= IT.FEET; };
  /** The REAL block state this item places, or -1 if it places nothing. */
  IT.stateOf = function (i) { var s = IT.state[i]; return s === 0xFFFF ? -1 : s; };

  /** Armour points this piece is worth in its own slot, 0 for anything that is not armour. */
  IT.defenseOf = function (i) { return IT.defense[i] || 0; };
  IT.toughnessOf = function (i) { return IT.toughness[i] || 0; };
  /** Knockback resistance, as the 0..1 fraction vanilla uses. Only netherite is non-zero. */
  IT.knockbackOf = function (i) { return (IT.knockback100[i] || 0) / 100; };
  IT.isArmor = function (i) { return IT.defense[i] > 0; };
  /** The item that a block state belongs to, by name — the reverse a broken block needs. */
  IT.forBlockName = function (name) { return IT.of(name); };
  /** The atlas tiles of one item's sprite layers, in draw order. */
  IT.layersOf = function (i) {
    var a = [], s = IT.layerOff[i], e = IT.layerOff[i + 1];
    for (var k = s; k < e; k++) a.push(IT.layerTile[k]);
    return a;
  };
  /** #10807: [layer, untinted tile] when this item's colour is per STACK (potions, tipped arrow), else null. */
  IT.stackTintOf = function (i) { return (IT.stackTint && IT.stackTint[i]) || null; };
  /**
   * #10807: `ItemColors` -> `PotionUtil.getColor(stack)` (.decomp potion/PotionUtil.java:75-81) for the
   * tinted layer of potion / splash / lingering / tipped_arrow. -1 for any other item.
   */
  IT.stackColor = function (stack) {
    if (!stack || !IT.stackTintOf(stack.i) || !NS.Potion) return -1;
    return NS.Potion.colorOfStack(stack);
  };
  /** The tint for one layer, or -1. Vanilla's own sentinel, kept rather than translated. */
  IT.tintOf = function (i, layer) { return layer === 0 ? IT.tint0[i] : (layer === 1 ? IT.tint1[i] : -1); };

  /**
   * The item's `firstperson_righthand` display transform as
   * `[rotX, rotY, rotZ, trX, trY, trZ, scX, scY, scZ]`, or null when the model declares none.
   * ⚠ THE TRANSLATION IS IN SIXTEENTHS OF A BLOCK, as it is in the model file; the caller
   * divides. Keeping the file's own units here means a number in this table can be compared to
   * the jar's JSON without a conversion in between, which is what `handposecheck` does.
   */
  /** s134 -- the item's `thirdperson_righthand` transform, same layout as `handTransform`, or null. */
  IT.thirdPersonTransform = function (i) {
    if (!IT.h3Idx || !(i >= 0) || i >= IT.count) return null;
    var k = IT.h3Idx[i];
    if (k === 255 || !(k < IT.h3Count)) return null;
    var o = k * 9, T = IT.h3Table;
    return [T[o], T[o + 1], T[o + 2], T[o + 3], T[o + 4], T[o + 5], T[o + 6], T[o + 7], T[o + 8]];
  };
  /** #4982 -- the item model part of block item `i` (an index into `IT.mPartOff`), or -1. */
  IT.modelPartOf = function (i) { var m = IT.mPart && IT.mPart[i]; return m === undefined || m === 0xFFFF ? -1 : m; };
  /**
   * The item's own `gui` display transform as `[rotX, rotY, rotZ, trX, trY, trZ, scX, scY, scZ]`.
   * Null when the model chain declares none (the caller uses `block/block`'s default).
   */
  IT.guiTransform = function (i) {
    var k = IT.mGuiIdx ? IT.mGuiIdx[i] : 255;
    if (k === 255 || !(k * 9 < IT.mGuiTable.length)) return null;
    var T = IT.mGuiTable, o = k * 9;
    return [T[o], T[o + 1], T[o + 2], T[o + 3], T[o + 4], T[o + 5], T[o + 6], T[o + 7], T[o + 8]];
  };
  IT.handTransform = function (i) {
    if (!IT.handIdx || !(i >= 0) || i >= IT.count) return null;
    var k = IT.handIdx[i];
    if (k === 255 || !(k < IT.handCount)) return null;
    var o = k * 9, T = IT.handTable;
    return [T[o], T[o + 1], T[o + 2], T[o + 3], T[o + 4], T[o + 5], T[o + 6], T[o + 7], T[o + 8]];
  };
})(MCL);
