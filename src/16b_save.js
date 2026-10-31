// 16b_save.js — persistence. Main thread only.
//
// STORAGE: localStorage, and only localStorage (D-74).
//
// Both were measured from a real file:// document on Chromium 148, driven over CDP on a real
// clock (a --virtual-time-budget run lies about IndexedDB: its backend thread is not on the
// virtual clock, so open() appears to hang):
//     localStorage   setItem/getItem work, survive a browser restart, ~5.0 MB quota
//     IndexedDB      open + readwrite transaction also work
//
// localStorage wins anyway, on three grounds:
//   1. It is SYNCHRONOUS, so `beforeunload` can actually flush. A double-clicked game is closed
//      by closing the window; an IndexedDB transaction started there is not guaranteed to
//      commit, and losing the last minute of building is the one failure that matters.
//   2. 5 MB holds ~750 000 edited blocks in this file's format. The only thing IndexedDB buys
//      is a bigger quota, and the quota is not the constraint.
//   3. It is the store most likely to exist. Firefox and Safari have both, at different times,
//      refused IndexedDB to opaque file:// origins; localStorage has been the more reliable of
//      the two for longer.
// The probe below still runs so the F3 line reports what this particular browser actually does.
//
// EVERY file:// PAGE SHARES ONE ORIGIN, so every key here is namespaced `mclite.`.
//
// WHAT IS SAVED: the seed, the world settings, the PLAYER — position, gamemode, all 41 inventory
// slots and the survival state — the block EDITS — every LIVING mob (07zw_mobnbt.js) — and, as
// of loop/besave-s105, every BLOCK ENTITY's own contents (07c_blockentity.js's `BE.serializeAll`/
// `BE.restoreAll`): a chest's 27 slots, a furnace's 3 plus its burn/cook counters, a hopper's 5
// plus its cooldown, a beehive's occupant list and honey level, a sign's lines and a banner's
// patterns. Nothing else. Everything the generator can reproduce from the seed is reproduced
// from the seed, which is why a heavily explored world costs a few kilobytes instead of a few
// hundred megabytes.
//
// ⚠ loop/besave-s105 CLOSES the "STILL NOT SAVED" gap this header used to name here (the QUEUE's
// G18e remainder "hive/block-entity contents"): a block entity's item slots hold `Inv.stack`'s
// `{i, n, d, t}` shape, the SAME shape the player's 41 slots already round-trip through
// `Inventory.stackToJSON`/`stackFromJSON` (14f_inventory.js) — there was never a second stack
// shape to reconcile, that concern predates G8 wiring every item array to `Inv.stack`.

(function (NS) {
  'use strict';

  var S = NS.Save = {
    KEY: 'mclite.world',
    // ⚠ VERSION 2 added a NAME PALETTE. Version 1 stored raw numeric block ids, which is
    // only safe while the id table never changes — and the whole point of the generated
    // 1.18.2 registry is that it replaces that table. A v1 save loaded against a different
    // roster silently reinterprets every block: your cobblestone house becomes whatever now
    // holds id 2. v2 writes the NAMES and resolves them on load, so a save survives the
    // registry being regenerated, reordered or grown. tools/savecheck.mjs asserts exactly
    // that by shuffling the id table between save and load.
    // ⚠ VERSION 3 (session 2, D-107) adds the STATE INDEX beside the name. A cell no longer holds a
    // block id, it holds a registry REAL STATE — `oak_stairs` facing east, half bottom, not
    // waterlogged — and a name on its own cannot say which. So each palette entry is now a
    // name plus the block's LOCAL state index, and load resolves `realFirst[block] + local`.
    // The local index is the right thing to persist rather than the global one: the global id
    // moves the moment any earlier block in the registry gains a property, the local one only
    // moves if THAT block's own state space changes.
    // A v2 save cannot be read: its numbers were legacy ids from a table that no longer
    // exists, and guessing would silently rebuild somebody's house out of the wrong blocks.
    // ⚠ VERSION 4 (session 9, D-288) adds THE INVENTORY AND THE SURVIVAL STATE. v3's player was
    // a position and nine BLOCK STATES, which is what the hotbar was in session 2. G8 then gave
    // the player 41 slots of item stacks with counts, damage and NBT, and G5 gave them health,
    // food, saturation, exhaustion and experience — and none of it was ever written. Measured,
    // not assumed: a diamond pickaxe with 137 damage saved as state 0, which is air.
    // ⚠ A v3 SAVE IS MIGRATED, NOT REFUSED, and the distinction is not sentiment. v2 stored
    // numbers into a vanished table, so reading one meant GUESSING what each block had been.
    // v3 stores NAMES; a name still means what it meant. So each of the nine entries becomes one
    // of that block's item, a block with no item becomes an empty slot, and the survival state
    // takes its defaults — every one of those is a fact the old save actually implies rather
    // than a value invented to fill a field. The next write is v4; there is no v3 writer left
    // (D-139: the replaced thing is deleted, not kept beside the replacement).
    // v5 adds the SKY: the day time and the weather machine (D-300). ⚠ It is an envelope bump
    // and not a silent extra field, because a v4 save has no time at all and the right default
    // is not "0" — a world that loads at tick 0 opens at dusk. `fromJSON` puts a v4 world at
    // `Sky.NEW_WORLD_TIME`, which is a fact the old save implies rather than a value invented.
    VERSION: 5,
    /** Envelope versions this build can READ. The newest is what it WRITES. */
    READABLE: [3, 4, 5],

    // ⚠⚠ TWO VERSION NUMBERS, BECAUSE THERE ARE TWO FORMATS — and conflating them is a bug that
    // DELETES WORLDS. `VERSION` above is the JSON ENVELOPE: seed, settings, player. `DATA_VERSION`
    // here is the binary BLOCK-EDIT BLOB, whose header `encode` writes and `decode` requires to
    // match exactly. Until session 9 both were the same constant, so bumping the envelope to add
    // an inventory field would have made `decode` reject every existing v3 blob — every block
    // the player had ever placed, gone, to record something that has nothing to do with blocks.
    // The blob format has not changed since session 2 and its number has not moved.
    // ⚠ The rule: bump `DATA_VERSION` only when the BYTES change; bump `VERSION` when the
    // envelope gains, loses or reinterprets a field. `savecheck` asserts both, separately.
    DATA_VERSION: 3,
    // #2092: the TERRAIN generator's version. Saves keep mob x/y/z but not terrain, so a mob saved on land an
    // older generator made would come back over what is now ocean. Bump when worldgen output changes;
    // load() drops the saved mobs when the save's `gen` differs (absent = an older build = differs).
    GEN_VERSION: 1,
    MAGIC: 0x4D434C53,          // 'MCLS'

    loadedVersion: 0,           // the version the last load() READ, which may be older than VERSION
    backend: 'none',            // 'localStorage' | 'none'
    lsError: '',
    idbStatus: 'not probed',

    seed: 0,
    seed64: 0n,   // the exact long; `seed` is its low 32 bits (#546)
    // ── the world-creation settings (PLAN W4, D-111; default flipped by D-182) ──────────
    // These sit beside the seed because they are the same KIND of thing: read once when the
    // world is made, never changeable afterwards, and required to reproduce the world from
    // nothing. They are OPTIONAL in the envelope and default here rather than forcing a
    // VERSION bump — the block-edit encoding did not change, and bumping it would throw away
    // every existing save's buildings to record one new field.
    // ⚠ TWO DIFFERENT DEFAULTS, do not conflate them:
    //   - this field ('earth')    the mode a BRAND-NEW world starts with, i.e. what the title
    //                             screen's Climate buttons show pre-selected when there is no
    //                             save to read yet (D-182 made Earth mode the default).
    //   - `load()`'s fallback ('vanilla')  what an EXISTING save with no `climate` field gets,
    //                             because it was written before the toggle existed. That save
    //                             was generated in the six-noise-field engine and must keep
    //                             loading that way forever, so `load()` below hard-codes
    //                             'vanilla' for absence — it does NOT read this field. Changing
    //                             this field can never silently reshape an old save.
    climate: 'earth',
    worldScale: 12000,
    // #329: vanilla's World Type. Absent in an envelope = 'default', the only type that existed before.
    worldType: 'default',
    edits: new Map(),           // World.key(cx,cz) -> {cx, cz, m: Map(idx -> blockId)} — the OVERWORLD's
    // #254 (#254): the other dimensions' edits, same shape. Written to the envelope's optional `dims` field
    // (absent = none), so no VERSION bump: an old save simply has an empty Nether and End.
    dimEdits: { the_nether: new Map(), the_end: new Map() },
    count: 0,                   // total edited voxels
    bytes: 0,                   // size of the last write

    dirty: false,
    replaying: false,
    loaded: false,
    playerState: null,
    worldSpawn: null,   // #6791: {x,y,z} the level spawn (level.dat SpawnX/Y/Z), recorded at world creation
    lastSave: 0,
    autosaveOff: false,         // /save-off sets it, /save-on clears it
    autosaveSkipped: 0,         // autosave ticks that were due and skipped while off
    AUTOSAVE_S: 30
  };

  var CFG;

  /** Voxel index inside a 16x320x16 column: ly*256 + lz*16 + lx, 0 .. 81919. */
  function idxOf(x, y, z) { return ((y - CFG.WORLD_MIN_Y) << 8) | ((z & 15) << 4) | (x & 15); }

  // ---------------------------------------------------------------------------
  // Availability
  // ---------------------------------------------------------------------------

  S.init = function () {
    CFG = NS.CFG;
    try {
      localStorage.setItem('mclite.probe', '1');
      localStorage.removeItem('mclite.probe');
      S.backend = 'localStorage';
    } catch (e) {
      S.backend = 'none';
      S.lsError = (e && e.name) || String(e);
    }
    return S;
  };

  /**
   * Asynchronous, purely informational: it decides nothing, it only fills in the F3 line. The
   * timeout is a real outcome, not a bug — some browsers neither resolve nor reject open() on an
   * opaque origin, and "open() never called back" is the honest thing to print in that case.
   */
  S.probeIDB = function () {
    if (typeof indexedDB === 'undefined' || !indexedDB) { S.idbStatus = 'absent'; return; }
    S.idbStatus = 'probing';
    var timer = setTimeout(function () {
      if (S.idbStatus === 'probing') S.idbStatus = 'open() never called back';
    }, 1500);
    try {
      var rq = indexedDB.open('mclite.probe', 1);
      rq.onsuccess = function () {
        clearTimeout(timer); S.idbStatus = 'available';
        try { rq.result.close(); } catch (e2) {}
      };
      rq.onerror = function () {
        clearTimeout(timer); S.idbStatus = 'error ' + ((rq.error && rq.error.name) || '?');
      };
      rq.onblocked = function () { clearTimeout(timer); S.idbStatus = 'blocked'; };
    } catch (e) {
      clearTimeout(timer);
      S.idbStatus = 'threw ' + ((e && e.name) || String(e));
    }
  };

  S.describe = function () {
    if (S.backend === 'none') return 'unavailable (' + (S.lsError || 'no localStorage') + ')';
    return 'localStorage ' + (S.bytes / 1024).toFixed(1) + ' KB, ' + S.count + ' edits' +
           (S.dirty ? ' *' : '') + '   idb: ' + S.idbStatus;
  };

  // ---------------------------------------------------------------------------
  // Recording edits
  // ---------------------------------------------------------------------------

  /** Called by World.setBlock for every edit. Cheap: two map lookups and a set. */
  /** The edit map of one dimension (#254). */
  S.editsFor = function (dim) {
    return (!dim || dim === 'overworld') ? S.edits : (S.dimEdits[dim] || (S.dimEdits[dim] = new Map()));
  };

  S.record = function (x, y, z, id) {
    if (S.replaying || S.backend === 'none') return;
    if (!CFG) CFG = NS.CFG;
    var key = NS.World.key(x >> 4, z >> 4);
    var edits = S.editsFor(NS.World.dimension);
    var e = edits.get(key);
    if (!e) { e = { cx: x >> 4, cz: z >> 4, m: new Map() }; edits.set(key, e); }
    var i = idxOf(x, y, z);
    if (!e.m.has(i)) S.count++;
    e.m.set(i, id | 0);
    S.dirty = true;
  };

  /**
   * Replay this column's edits into a freshly generated chunk. Called by World.installChunk
   * BEFORE it computes the mesh-dirty mask, so an edited section is meshed on its first pass and
   * the player never sees the un-edited version of their own building.
   */
  S.applyTo = function (chunk) {
    var e = S.editsFor(NS.World.dimension).get(NS.World.key(chunk.cx, chunk.cz));
    if (!e) return 0;
    if (!CFG) CFG = NS.CFG;
    var Sec = NS.Section, W = NS.World, n = 0;
    S.replaying = true;
    e.m.forEach(function (id, i) {
      var ly = i >> 8, lz = (i >> 4) & 15, lx = i & 15;
      if (ly < 0 || ly >= CFG.CHUNK_H) return;
      Sec.set(chunk.sec[ly >> 4], ((ly & 15) << 8) | (lz << 4) | lx, id);
      n++;
      // An edit on a column face changes a face and an AO corner in the NEIGHBOURING column,
      // which may already be meshed. Same rule as World.setBlock (ARCH §5).
      if (lx === 0 || lx === 15 || lz === 0 || lz === 15) {
        // vertical neighbours too: an edit on a y-face of the section is read by the section
        // above/below in the neighbouring column (#587)
        var sy = ly >> 4, y0 = (ly & 15) === 0 ? sy - 1 : sy, y1 = (ly & 15) === 15 ? sy + 1 : sy;
        for (var ny = y0; ny <= y1; ny++) {
          if (ny < 0 || ny >= CFG.SECTIONS_Y) continue;
          for (var dz = -1; dz <= 1; dz++) {
            for (var dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dz === 0) continue;
              W.markDirty(chunk.cx + dx, chunk.cz + dz, ny);
            }
          }
        }
      }
    });
    S.replaying = false;
    return n;
  };

  // ---------------------------------------------------------------------------
  // Encoding
  //
  // One flat buffer, base64'd into one localStorage key. Per chunk: cx, cz, count, then six
  // bytes per edit (u32 index + u16 block id). No JSON per voxel — 750 000 edits still fit in
  // the 5 MB quota, which is more blocks than anyone is going to place by hand.
  // ---------------------------------------------------------------------------

  S.encode = function (edits) {
    var own = !edits || edits === S.edits;
    edits = edits || S.edits;
    var chunks = 0, records = 0;
    edits.forEach(function (e) { if (e.m.size) { chunks++; records += e.m.size; } });

    // ── the name palette ────────────────────────────────────────────────────────────
    // Only the ids this save actually uses, so a world of stone and dirt carries two names
    // rather than nine hundred. The per-edit field stays 16 bits and becomes an index into
    // this list instead of a block id.
    var R = NS.Reg, SR = NS.States;
    var names = [], locals = [], indexOf = Object.create(null), nameBytes = 0;
    edits.forEach(function (e) {
      e.m.forEach(function (state) {
        if (indexOf[state] !== undefined) return;
        var nm = '', local = 0;
        if (R && R.ready && state > 0 && state < R.realCount) {
          var b = SR.block[state];
          nm = R.names[b];
          local = state - R.realFirst[b];
        }
        indexOf[state] = names.length;
        names.push(nm);
        locals.push(local);
        nameBytes += 1 + nm.length + 2;                // name, then the u16 local state index
      });
    });

    var buf = new ArrayBuffer(14 + nameBytes + chunks * 12 + records * 6);
    var dv = new DataView(buf);
    dv.setUint32(0, S.MAGIC, true);
    dv.setUint32(4, S.DATA_VERSION, true);
    dv.setUint32(8, chunks, true);
    dv.setUint16(12, names.length, true);
    var o = 14;
    for (var ni = 0; ni < names.length; ni++) {
      var nm2 = names[ni];
      dv.setUint8(o, nm2.length); o += 1;
      for (var ci = 0; ci < nm2.length; ci++) { dv.setUint8(o, nm2.charCodeAt(ci) & 0xff); o += 1; }
      dv.setUint16(o, locals[ni], true); o += 2;
    }
    edits.forEach(function (e) {
      if (!e.m.size) return;
      dv.setInt32(o, e.cx, true); dv.setInt32(o + 4, e.cz, true);
      dv.setUint32(o + 8, e.m.size, true);
      o += 12;
      e.m.forEach(function (id, i) {
        dv.setUint32(o, i, true);
        dv.setUint16(o + 4, indexOf[id], true);        // a palette index, not a block id
        o += 6;
      });
    });
    if (own) S.count = records;
    return toBase64(new Uint8Array(buf));
  };

  S.decode = function (b64, edits) {
    var own = !edits || edits === S.edits;
    edits = edits || S.edits;
    var bytes = fromBase64(b64);
    if (!bytes || bytes.length < 12) return false;
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (dv.getUint32(0, true) !== S.MAGIC) return false;
    if (dv.getUint32(4, true) !== S.DATA_VERSION) return false;
    var chunks = dv.getUint32(8, true), total = 0;

    // Resolve the palette against the CURRENT block table. A name this build no longer has
    // becomes air and is counted rather than silently mapped onto whatever now holds that
    // number — losing a block is recoverable, and a house made of the wrong block is not.
    var nNames = dv.getUint16(12, true), o = 14;
    var palette = new Uint16Array(nNames);
    S.unknownNames = [];
    for (var pi = 0; pi < nNames; pi++) {
      if (o + 1 > bytes.length) return false;
      var len = dv.getUint8(o); o += 1;
      if (o + len > bytes.length) return false;
      var nm = '';
      for (var ci = 0; ci < len; ci++) { nm += String.fromCharCode(dv.getUint8(o)); o += 1; }
      if (o + 2 > bytes.length) return false;
      var local = dv.getUint16(o, true); o += 2;
      // `withLocal` owns the `realFirst[block] + local` arithmetic and clamps a local index
      // that has fallen outside its block (which happens when a block LOSES states between
      // versions) to that block's default rather than letting it walk into the next block.
      var st = (NS.States && NS.States.ready) ? NS.States.withLocal(nm, local) : 0;
      if (st === 0 && nm !== 'air') { palette[pi] = 0; if (nm) S.unknownNames.push(nm); }
      else palette[pi] = st;
    }
    edits.clear();
    for (var k = 0; k < chunks; k++) {
      if (o + 12 > bytes.length) return false;
      var cx = dv.getInt32(o, true), cz = dv.getInt32(o + 4, true), n = dv.getUint32(o + 8, true);
      o += 12;
      if (o + n * 6 > bytes.length) return false;
      var m = new Map();
      for (var j = 0; j < n; j++) {
        var slot = dv.getUint16(o + 4, true);
        m.set(dv.getUint32(o, true), slot < nNames ? palette[slot] : 0);
        o += 6;
      }
      edits.set(NS.World.key(cx, cz), { cx: cx, cz: cz, m: m });
      total += n;
    }
    if (own) S.count = total;
    return true;
  };

  /** btoa needs a binary string; build it in slices so a big save does not blow the arg limit. */
  function toBase64(u8) {
    var s = '', CH = 0x8000;
    for (var i = 0; i < u8.length; i += CH) {
      s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + CH, u8.length)));
    }
    return btoa(s);
  }

  function fromBase64(b64) {
    try {
      var s = atob(b64), u8 = new Uint8Array(s.length);
      for (var i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
      return u8;
    } catch (e) { return null; }
  }

  // ---------------------------------------------------------------------------
  // Save / load
  // ---------------------------------------------------------------------------

  /** #254: the non-overworld edit stores, one base64 blob each, omitted when empty. */
  S.dimsToJSON = function () {
    var out;
    Object.keys(S.dimEdits).forEach(function (d) {
      var n = 0; S.dimEdits[d].forEach(function (e) { n += e.m.size; });
      if (n) { out = out || {}; out[d] = S.encode(S.dimEdits[d]); }
    });
    return out;
  };
  S.dimsFromJSON = function (g) {
    Object.keys(S.dimEdits).forEach(function (d) { S.dimEdits[d].clear(); });
    if (!g || typeof g !== 'object') return;
    Object.keys(g).forEach(function (d) {
      if (!NS.Dim || !NS.Dim.has(d) || d === 'overworld') return;
      if (typeof g[d] !== 'string' || !S.decode(g[d], S.editsFor(d))) S.editsFor(d).clear();
    });
  };

  S.save = function (announce) {
    if (S.backend === 'none') { if (announce) NS.Hud.say('No storage available — changes are not saved'); return false; }
    var payload;
    try {
      payload = JSON.stringify({
        v: S.VERSION,
        seed: S.seed | 0,
        seed64: String(BigInt.asIntN(64, S.seed64 === undefined ? BigInt(S.seed | 0) : S.seed64)),
        gen: S.GEN_VERSION,
        climate: S.climate,
        worldScale: S.worldScale,
        worldType: S.worldType,
        t: Date.now(),
        // #293 -- the player record carries LivingEntity's `ActiveEffects` (P.toJSON, 07q_effects.js).
        spawn: S.worldSpawn || undefined,
        forced: (NS.World && NS.World.forced && NS.World.forced.size) ? Array.from(NS.World.forced) : undefined,
        player: NS.Player.toJSON(),
        advancements: (NS.Player.advancements && NS.Player.advancements.toJson) ? NS.Player.advancements.toJson() : undefined,   // G17-ADV1
        hotbars: (NS.Creative && NS.Creative.hotbarsToJSON) ? NS.Creative.hotbarsToJSON() : undefined,   // #8145 HotbarStorage
        sky: (NS.Sky && NS.Sky.toJSON) ? NS.Sky.toJSON() : undefined,
        // loop s111 (Diff.OWED "not persisted") — `LevelProperties`' own `Difficulty` byte.
        difficulty: (NS.Diff && NS.Diff.get) ? NS.Diff.get() : undefined,
        hardcore: (NS.Diff && NS.Diff.hardcore) ? true : undefined,   // #8317 LevelProperties.isHardcore
        // s112 (Diff.OWED "gamerule values are not saved") — `LevelProperties`' own GameRules
        // compound: only the rules /gamerule has changed (a default is read off the roster).
        gameRules: (NS.Commands && NS.Commands.ruleValues) ? S.rulesToJSON() : undefined,
        border: S.borderToJSON(),   // #8307 WorldBorder.Properties
        scheduledEvents: (NS.Commands && NS.Commands.timerToJSON) ? NS.Commands.timerToJSON() : undefined,   // #8232 level Timer
        // Diff.OWED (LocalDifficulty regional) — every chunk's `InhabitedTime` long
        // (ChunkSerializer.java:275), kept by 07y_equip.js because chunks regenerate on reload.
        inhabited: (NS.Equip && NS.Equip.inhabitedToJSON) ? NS.Equip.inhabitedToJSON() : undefined,
        // #1307 -- WanderingTraderManager's spawn timer/delay/chance (ServerWorldProperties).
        // #5087 -- Spawn.populated: chunks already given their initial mobs (vanilla: once, ever).
        populated: (NS.Spawn && NS.Spawn.populatedToJSON) ? NS.Spawn.populatedToJSON() : undefined,
        raids: (NS.RaidManager && NS.RaidManager.world) ? NS.RaidManager.toJSON(NS.RaidManager.world) : undefined,   // #5783 raids.dat
        wtm: (NS.WT && NS.WT.managerToJSON) ? NS.WT.managerToJSON() : undefined,
        data: S.encode(),
        dims: S.dimsToJSON(),
        // loop/nbtsave-s104 (Mnt.OWED's entity-NBT-persistence entry) — every LIVING mob in
        // `EL.list`, plain JSON records (07zw_mobnbt.js's own header explains the mechanism).
        // Absent on a save from before this unit, which `S.load` below treats as "no mobs".
        scoreboard: NS.Scoreboard ? NS.Scoreboard.toJSON() : undefined,   // G17-SB1
        mobs: (NS.MobNbt && NS.MobNbt.serializeAll) ? NS.MobNbt.serializeAll() : [],
        // loop/besave-s105 (QUEUE G18e remainder "hive/block-entity contents") — every block
        // entity's own contents, plain JSON records keyed by position (07c_blockentity.js's own
        // header explains the mechanism, the same generic field-table shape as `mobs` above).
        // Absent on a save from before this unit, which `S.load` below treats as "no BE state".
        be: (NS.BlockEntities && NS.BlockEntities.serializeAll) ? NS.BlockEntities.serializeAll() : []
      });
      localStorage.setItem(S.KEY, payload);
    } catch (e) {
      var quota = e && (e.name === 'QuotaExceededError' || e.code === 22);
      NS.Hud.say(quota ? 'Save failed: 5 MB localStorage quota is full'
                       : 'Save failed: ' + ((e && e.name) || e));
      return false;
    }
    S.bytes = payload.length;
    S.dirty = false;
    S.lastSave = NS.U.now();
    if (announce) NS.Hud.say('Saved — ' + S.count + ' block changes, ' + (S.bytes / 1024).toFixed(1) + ' KB');
    return true;
  };

  /**
   * load() -> true when a world was restored. Must run BEFORE World.init/Gen.init, because the
   * seed in the save file is the seed the rest of the boot has to use.
   */
  S.load = function () {
    S.loaded = false;
    if (S.backend === 'none') return false;
    var raw;
    try { raw = localStorage.getItem(S.KEY); } catch (e) { return false; }
    if (!raw) return false;
    var o;
    try { o = JSON.parse(raw); } catch (e) { return false; }
    if (!o || S.READABLE.indexOf(o.v) < 0) return false;
    S.loadedVersion = o.v | 0;
    S.seed = o.seed | 0;
    S.seed64 = BigInt(S.seed);
    if (typeof o.seed64 === 'string' && /^-?\d+$/.test(o.seed64)) {
      var s64 = BigInt.asIntN(64, BigInt(o.seed64));
      if (Number(BigInt.asIntN(32, s64)) === S.seed) S.seed64 = s64;
    }
    // Absent means 'made before the toggle existed', which means vanilla — see the note above.
    S.climate = (o.climate === 'earth') ? 'earth' : 'vanilla';
    S.worldScale = (typeof o.worldScale === 'number' && o.worldScale >= 1000 && o.worldScale <= 2000000)
      ? o.worldScale : 12000;
    S.worldType = (o.worldType === 'large_biomes' || o.worldType === 'amplified') ? o.worldType : 'default';
    S.playerState = o.player || null;
    S.advRecords = (o.advancements && typeof o.advancements === 'object') ? o.advancements : null;   // G17-ADV1, restored in Main.finishBoot
    if (NS.Creative && NS.Creative.hotbarsFromJSON) NS.Creative.hotbarsFromJSON(o.hotbars);
    if (NS.World && NS.World.forced) {
      NS.World.forced.clear();
      if (Array.isArray(o.forced)) o.forced.forEach(function (k) { if (/^-?\d+,-?\d+$/.test(k)) NS.World.forced.add(k); });
    }
    S.worldSpawn = (o.spawn && isFinite(o.spawn.x) && isFinite(o.spawn.y) && isFinite(o.spawn.z))
      ? { x: o.spawn.x | 0, y: o.spawn.y | 0, z: o.spawn.z | 0 } : null;
    // ⚠ `fromJSON` HANDLES THE ABSENT CASE ITSELF rather than being guarded here, so a v3 or v4
    // world gets `NEW_WORLD_TIME` and a fresh weather machine by the same code path a corrupt
    // field does — one place that decides what "no sky in this save" means.
    if (NS.Scoreboard) NS.Scoreboard.fromJSON(o.scoreboard);   // G17-SB1
    if (NS.Commands && NS.Commands.timerFromJSON) NS.Commands.timerFromJSON(o.scheduledEvents);   // #8232
    S.borderFromJSON(o.border);   // #8307
    S.rulesFromJSON(o.gameRules);   // before the sky: its own saved dc/wc flags have the last word
    if (NS.Sky && NS.Sky.fromJSON) NS.Sky.fromJSON(o.sky);
    // loop s111 — absent (any save before this) or unknown = 'normal', vanilla's own default.
    if (NS.Diff && NS.Diff.set) { NS.Diff.value = 'normal'; NS.Diff.hardcore = false; if (typeof o.difficulty === 'string') NS.Diff.set(o.difficulty); if (o.hardcore === true) NS.Diff.setHardcore(true); }
    if (NS.Equip && NS.Equip.inhabitedFromJSON) NS.Equip.inhabitedFromJSON(o.inhabited);   // absent = every chunk 0
    if (o.data && !S.decode(o.data)) { S.edits.clear(); S.count = 0; }
    S.dimsFromJSON(o.dims);
    if (NS.Spawn && NS.Spawn.populatedFromJSON) NS.Spawn.populatedFromJSON(o.populated);   // #5087; absent = pre-#5087 save
    if (NS.RaidManager && NS.RaidManager.fromJSON) { NS.RaidManager.world = NS.RaidManager.world || NS.RaidManager.create(); NS.RaidManager.fromJSON(NS.RaidManager.world, o.raids); }   // #5783; absent = no raids
    if (NS.WT && NS.WT.managerFromJSON) NS.WT.managerFromJSON(o.wtm);   // #1307; absent = fresh counters
    // loop/nbtsave-s104 — stashed, not restored HERE: `S.load` runs before `EL.init` (this
    // file's own header on why — the SEED has to be known first), so a mob cannot be spawned
    // yet. `Main.finishBoot` (17_main.js) is the actual restore point, once every system a
    // mob's own spawn hook reads (Ai/Mount/Bee/Profession/...) is up; it reads this field and
    // clears it. Missing/non-array `o.mobs` (any save before this unit) means zero mobs, the
    // same as an empty world always had.
    S.mobRecords = (Array.isArray(o.mobs) && o.gen === S.GEN_VERSION) ? o.mobs : [];
    // loop/besave-s105 — stashed, not restored HERE, for the same reason `mobRecords` is: `S.load`
    // runs before `World`/`BlockEntities.init` (the SEED has to be known first), so there is no
    // store yet to create entries in. `Main.finishBoot` (17_main.js) is the actual restore point,
    // right beside the mob-record restore it already does, once `BlockEntities.init()` has run.
    // Missing/non-array `o.be` (any save before this unit) means zero block-entity records, the
    // same "no mobs" rule `S.mobRecords` above already applies.
    S.beRecords = Array.isArray(o.be) ? o.be : [];
    S.bytes = raw.length;
    // ⚠ A MIGRATED SAVE IS DIRTY THE MOMENT IT IS READ. The in-memory world is now richer than
    // the file it came from, and leaving `dirty` false means the upgrade is thrown away silently
    // if the player quits without changing a block.
    S.dirty = (S.loadedVersion !== S.VERSION);
    S.loaded = true;
    return true;
  };

  /**
   * FORGET THE SAVED WORLD ENTIRELY — the storage, the edits, the PLAYER and the SKY (D-415).
   *
   * ⚠⚠ **`S.erase` BELOW IS NOT THIS, AND USING IT FOR "new world" IS THE BUG DAN REPORTED.**
   * `erase` throws away the block EDITS of the world you are standing in and leaves you standing
   * in it — same seed, same player, same time of day — which is right for what it is for. The
   * title screen's "New world" button did the same three lines by hand and then re-entered
   * `boot()`, and `boot()`'s second pass calls `Save.load()` again, which returns false at the
   * FIRST line (there is no saved string any more) and therefore never touches `S.playerState`.
   * So the old player state — position, inventory, health — was still sitting in this module
   * from the first pass, `Main.finishBoot` restored it, and `Main.warmup` even generated the old
   * spawn area to put it back in. The seed was the old one too, because the title screen's seed
   * box is pre-filled from the world that was loaded. Three different ways of landing you back
   * in the world you just asked to be rid of.
   *
   * ⚠ IT DOES NOT TOUCH THE WORLD IN MEMORY, because the one caller is the TITLE SCREEN, where
   * no world has been built yet: `Gfx.dropAll()` and `World.chunks` would be reaching for things
   * that do not exist. That asymmetry is the reason these are two functions and not one.
   */
  S.reset = function () {
    try { localStorage.removeItem(S.KEY); } catch (e) {}
    S.edits.clear(); S.dimEdits.the_nether.clear(); S.dimEdits.the_end.clear();
    S.count = 0; S.bytes = 0; S.dirty = false;
    S.loaded = false; S.loadedVersion = 0;
    S.playerState = null;
    S.worldSpawn = null;
    // #2092: everything load() stashed for finishBoot, and the world-creation choices, go too —
    // otherwise the old mobs/block entities were restored into the NEW world.
    S.mobRecords = null; S.beRecords = null;
    S.climate = 'earth'; S.worldScale = 12000; S.worldType = 'default';
    if (NS.WT && NS.WT.managerFromJSON) NS.WT.managerFromJSON(null);
    // the sky is part of the save (`toJSON`/`fromJSON`), so a new world gets a new morning —
    // `fromJSON(null)` is the same door a world with no sky field in it comes through.
    if (NS.Scoreboard) NS.Scoreboard.reset();
    S.rulesFromJSON(null);          // s112: a new world starts with every gamerule at its default
    if (NS.Sky && NS.Sky.fromJSON) NS.Sky.fromJSON(null);
    if (NS.Diff) NS.Diff.value = 'normal';   // loop s111: a new world starts at vanilla's default
    if (NS.Equip && NS.Equip.inhabitedFromJSON) NS.Equip.inhabitedFromJSON(null);   // and no chunk inhabited
  };

  /** s112 — the changed gamerules as a plain {name: value} copy. */
  /** WorldBorder.Properties.writeNbt: BorderSize is the size NOW, a lerp in progress is BorderSizeLerpTarget + the REMAINING BorderSizeLerpTime. */
  S.borderToJSON = function () {
    var B = NS.World && NS.World.border;
    if (!B) return undefined;
    var left = B.stage() === 'stationary' ? 0 : Math.max(0, B.dur - (B.now() - B.t0));
    return { BorderCenterX: B.centerX, BorderCenterZ: B.centerZ, BorderSize: B.size(),
      BorderSizeLerpTarget: left > 0 ? B.newSize : B.size(), BorderSizeLerpTime: left,
      BorderSafeZone: B.safeZone, BorderDamagePerBlock: B.damagePerBlock,
      BorderWarningBlocks: B.warningBlocks, BorderWarningTime: B.warningTime };
  };
  /** WorldBorder.Properties.readNbt / from: absent keys take vanilla's defaults (the DEFAULT properties). */
  S.borderFromJSON = function (g) {
    var B = NS.World && NS.World.border;
    if (!B) return;
    function n(k, d) { return g && typeof g[k] === 'number' && isFinite(g[k]) ? g[k] : d; }
    B.centerX = n('BorderCenterX', 0); B.centerZ = n('BorderCenterZ', 0);
    B.safeZone = n('BorderSafeZone', 5.0); B.damagePerBlock = n('BorderDamagePerBlock', 0.2);
    B.warningBlocks = n('BorderWarningBlocks', 5); B.warningTime = n('BorderWarningTime', 15);
    var size = n('BorderSize', 59999968), to = n('BorderSizeLerpTarget', size), t = n('BorderSizeLerpTime', 0);
    B.setSize(size);
    if (t > 0 && to !== size) B.lerpSize(to, t);
  };
  S.rulesToJSON = function () {
    var C = NS.Commands, out = {};
    if (!C || !C.ruleValues) return out;
    for (var k in C.ruleValues) if (Object.prototype.hasOwnProperty.call(C.ruleValues, k)) out[k] = C.ruleValues[k];
    return out;
  };
  /** s112 — replace the live gamerule values with a saved set (absent/garbage = all defaults),
   *  through `Commands.ruleSet` when it exists so each rule's live side effect runs too. */
  S.rulesFromJSON = function (g) {
    var C = NS.Commands;
    if (!C) return;
    C.ruleValues = Object.create(null);
    if (!g || typeof g !== 'object') return;
    for (var k in g) {
      if (!Object.prototype.hasOwnProperty.call(g, k)) continue;
      var v = g[k];
      if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') continue;
      if (C.ruleSet) C.ruleSet(k, v); else C.ruleValues[k] = v;
    }
  };

  /** Throw the edits away and put the world back to what the seed alone generates. */
  S.erase = function () {
    try { localStorage.removeItem(S.KEY); } catch (e) {}
    S.edits.clear(); S.dimEdits.the_nether.clear(); S.dimEdits.the_end.clear();
    S.count = 0; S.bytes = 0; S.dirty = false;
    NS.Gfx.dropAll();
    NS.World.chunks.clear();
    if (NS.Equip && NS.Equip.inhabitedFromJSON) NS.Equip.inhabitedFromJSON(null);
    NS.Hud.say('Saved changes erased — world reset to seed ' + S.seed64);
  };

  /** Called once per frame by Main. Writes at most once every AUTOSAVE_S, and only if dirty. */
  S.tick = function () {
    if (!S.dirty || S.backend === 'none') return;
    if (NS.U.now() - S.lastSave < S.AUTOSAVE_S * 1000) return;
    if (S.autosaveOff) { S.autosaveSkipped++; return; }   // /save-off (SaveOffCommand)
    S.save(false);
  };

  /** Last chance: the tab is going away. Synchronous by necessity, which localStorage is. */
  S.attachUnload = function () {
    if (!NS.ENV.hasWindow) return;
    window.addEventListener('beforeunload', function () { if (S.dirty) S.save(false); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden' && S.dirty) S.save(false);
    });
  };
})(MCL);
