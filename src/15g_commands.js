// 15g_commands.js — PLAN G12b: THE COMMANDS, on G12b's Brigadier.
//
// MAIN THREAD. `NS.Brig` is the parser; this file is the TREE and the Minecraft argument types.
//
// ⚠⚠ **THE ROSTER IS READ, NOT TYPED** (D-316). `tools/extract-commands.mjs` pulls all 74 of
// vanilla's commands out of the 1.18.2 bytecode with their OPERATOR LEVELS and their aliases —
// `/tp` redirects to `/teleport`, `/xp` to `/experience`, `/w` and `/tell` to `/msg` — so the
// list of what exists and who may run it is the game's, and `Commands.OWED` is the exact
// complement of what is implemented here. A typed roster would be a second list free to disagree
// with the first, which is the mistake D-313 caught three hours ago.
//
// ⚠⚠ **AND SO IS EVERY WORD THE PLAYER SEES.** `commands.gamemode.success.self`,
// `commands.give.success.single`, `commands.seed.success` are keys in the game's own
// `en_us.json`, which this game already ships whole. Nothing in this file is an English sentence
// somebody wrote; `commandcheck` scans the source and fails on quoted prose.
//
// ⚠ **PERMISSION LEVELS ARE ENFORCED, and they come out of the same table.** `/help` is level 0
// and `/gamemode` is level 2. In a single-player world the player is level 4, exactly as vanilla
// gives a single-player host — but the gate is real, `requires` is wired to it, and an
// unprivileged source cannot see a command it may not run in `/help` or in tab completion.

(function (NS) {
  'use strict';

  var C = NS.Commands = { ready: false, dispatcher: null };
  var B = null;

  var T = function (key, args) {
    var Tx = NS.Text;
    if (Tx && Tx.has && Tx.has(key)) return Tx.translate(key, args || []);
    return key;
  };

  /**
   * ⚠ OWED, NAMED AND COUNTED. Vanilla has 74 commands; this implements the nine Dan asked for
   * first. The rest are listed BY NAME with the stage each waits on, generated against the golden
   * table by `commandcheck`, so "the rest are coming" is a list rather than a feeling.
   */
  C.IMPLEMENTED = ['gamemode', 'give', 'time', 'weather', 'teleport', 'kill', 'seed', 'help',
                   'summon', 'setblock', 'fill', 'clear', 'experience', 'defaultgamemode',
                   'clone', 'locatebiome', 'locate', 'list', 'tellraw', 'title', 'execute',
                   'say', 'me', 'msg', 'playsound', 'stopsound', 'spawnpoint', 'setworldspawn',
                   'gamerule', 'data', 'item', 'difficulty', 'worldborder'];
  // ⚠ THIS NOTE IS DEVELOPER-FACING AND NEVER REACHES A PLAYER, which is why `commandcheck`'s
  // no-English scan skips the line that defines it. Every string that DOES reach a player in this
  // file is a translation key.
  C.OWED_NOTE = 'the other 41 of vanilla\'s 74 commands; `commandcheck` names them against '   // OWED
              + 'tools/golden/commands-1.18.2.tsv, and they arrive with the systems they drive'; // OWED

  // ── the source ────────────────────────────────────────────────────────────────────────────
  /**
   * A `CommandSourceStack`. ⚠ IT CARRIES A PERMISSION LEVEL EVEN THOUGH THERE IS ONE PLAYER,
   * because the level is what `requires` gates on and what decides which commands `/help` and
   * tab completion list. Vanilla gives a single-player host level 4 — this does the same, and
   * the plumbing is real rather than a constant `true`.
   */
  C.source = function (player, opts) {
    var o = opts || {};
    return {
      player: player,
      level: o.level === undefined ? 4 : o.level,
      name: o.name || 'Player',
      displayName: o.displayName || o.name || 'Player',   // ServerCommandSource.getDisplayName(): /say /me /msg
      x: o.x !== undefined ? o.x : player ? player.x : 0, y: o.y !== undefined ? o.y : player ? player.y : 0, z: o.z !== undefined ? o.z : player ? player.z : 0,
      yaw: o.yaw !== undefined ? o.yaw : player ? (player.yaw || 0) : 0, pitch: o.pitch !== undefined ? o.pitch : player ? (player.pitch || 0) : 0,
      // ⚠ THE SOURCE HAS AN ENTITY AND AN ANCHOR because `/execute` moves both; without
      // `/execute` they are the player and its feet, which is what every other command assumes.
      entity: o.entity || player || null,
      anchor: 'feet',
      feedback: [],
      failure: null,
      hasPermission: function (n) { return this.level >= n; },
      send: function (msg) { this.feedback.push(msg); },
      fail: function (msg) { this.failure = msg; }
    };
  };
  var perm = function (n) { return function (s) { return !!s && s.hasPermission(n); }; };

  // ── Minecraft's argument types ────────────────────────────────────────────────────────────
  var M = C.arg = {};

  /** `minecraft:game_mode`. The four names are `GameType`'s own, via G6. */
  M.gameMode = function () {
    var names = function () {
      var G = NS.Gamemode;
      return (G && G.NAMES) ? G.NAMES.slice() : ['survival', 'creative', 'adventure', 'spectator'];
    };
    return { name: 'minecraft:game_mode',
      parse: function (r) {
        var start = r.cursor;
        var s = r.readUnquoted();
        var list = names();
        var i = list.indexOf(s);
        if (i < 0) { r.cursor = start; throw B.err('argument.entity.options.mode.invalid', [s], r); }
        return i;
      },
      suggest: function () { return names(); } };
  };

  /**
   * `minecraft:entity` — a SELECTOR, not a name.
   *
   * ⚠ ALL FIVE OF VANILLA'S ARE HERE AND THEY ARE NOT ALL THE SAME. `@s` is the source, `@p` the
   * nearest player, `@r` a random one, `@a` every player, `@e` every ENTITY including the
   * player-less ones. In a one-player world the first four coincide; they are still four
   * different rules, and `/kill @e` must not kill the player while `/kill @a` must.
   *
   * ⚠ `single` AND `playersOnly` ARE VANILLA'S OWN TWO FLAGS, and they produce the two distinct
   * errors the lang file has keys for: `argument.entity.toomany` and `argument.player.entities`.
   */
  M.entity = function (single, playersOnly) {
    return { name: playersOnly ? 'minecraft:game_profile' : 'minecraft:entity',
      single: !!single, playersOnly: !!playersOnly,
      parse: function (r, source) {
        var start = r.cursor;
        if (r.canRead() && r.peek() === '@') {
          r.skip();
          if (!r.canRead()) throw B.err('argument.entity.selector.missing', [], r);
          var kind = r.read();
          if (['p', 'a', 'r', 's', 'e'].indexOf(kind) < 0) {
            r.cursor = start;
            throw B.err('argument.entity.selector.unknown', ['@' + kind], r);
          }
          var opts = M.selectorOptions(r);
          return { kind: kind, opts: opts, single: !!single, playersOnly: !!playersOnly, raw: '@' + kind };
        }
        var nm = r.readUnquoted();
        if (!nm.length) { r.cursor = start; throw B.err('argument.entity.invalid', [], r); }
        return { kind: 'name', name: nm, single: true, playersOnly: !!playersOnly, raw: nm };
      },
      suggest: function () { return ['@p', '@a', '@r', '@s', '@e']; } };
  };

  /**
   * `[key=value,...]` after a selector. ⚠ THE BRACKET IS OPTIONAL AND THE CLOSE IS NOT: an
   * unterminated option list is `argument.entity.options.unterminated`, which is a real vanilla
   * message and not a silent truncation.
   */
  M.selectorOptions = function (r) {
    var out = {};
    if (!r.canRead() || r.peek() !== '[') return out;
    r.skip();
    r.skipWhitespace();
    while (r.canRead() && r.peek() !== ']') {
      r.skipWhitespace();
      var key = r.readUnquoted();
      r.skipWhitespace();
      if (!r.canRead() || r.peek() !== '=') throw B.err('argument.entity.options.valueless', [key], r);
      r.skip();
      r.skipWhitespace();
      var neg = false;
      if (r.canRead() && r.peek() === '!') { neg = true; r.skip(); }
      var val = r.readString();
      out[key] = { value: val, negated: neg };
      r.skipWhitespace();
      if (r.canRead() && r.peek() === ',') { r.skip(); continue; }
      break;
    }
    if (!r.canRead() || r.peek() !== ']') throw B.err('argument.entity.options.unterminated', [], r);
    r.skip();
    return out;
  };

  /** Resolve a parsed selector to a list of targets. A target is `{ kind, e }`. */
  /** The `@s` target for a source: its own entity, which is the player unless `/execute as`. */
  C.selfTarget = function (source) {
    var P = NS.Player;
    var e = (source && source.entity) ? source.entity : P;
    if (!e) return null;
    if (e === P) return { kind: 'player', e: P, name: source ? source.name : 'Player' };
    // ⚠ `e.type` IS ALREADY THE BARE NAME STRING (`EL.spawn`'s own `type: name`, `name =
    // E.bare(type)`) -- `Ent.names` (07h_entities.js) is the SORTED-NAMES ARRAY used to turn a
    // numeric id into a name elsewhere (`M.entityType().suggest`, below); indexing it BY that
    // string (`ET.names[e.type]`) always misses and silently returns `undefined`. Found and
    // fixed independently by both worker 1 (mobcmdkillcheck) and worker 2 (mobcmdexeccheck) in
    // the same parallel-night wave -- same root cause, same fix.
    return { kind: 'entity', e: e, name: (e.type !== undefined) ? e.type : 'entity' };
  };

  /**
   * A source with some of its fields replaced — `/execute`'s whole mechanism.
   *
   * ⚠ **`feedback` IS SHARED, NOT COPIED.** Everything an inner command says has to reach the
   * player who typed the line; a derived source with its own array swallows every message from
   * inside an `/execute` and the command looks like it did nothing.
   */
  C.derive = function (src, patch) {
    var o = {
      player: src.player, level: src.level, name: src.name,
      x: src.x, y: src.y, z: src.z,
      yaw: src.yaw, pitch: src.pitch,
      entity: src.entity, anchor: src.anchor,
      feedback: src.feedback,
      hasPermission: src.hasPermission, send: src.send, fail: src.fail
    };
    for (var k in patch) o[k] = patch[k];
    return o;
  };

  C.resolve = function (sel, source) {
    var P = NS.Player, out = [];
    var self = P ? { kind: 'player', e: P, name: source ? source.name : 'Player' } : null;
    if (sel.kind === 'name') {
      // one player, and its name must match — vanilla's `argument.player.unknown`
      if (self && sel.name === (source ? source.name : 'Player')) out.push(self);
      return out;
    }
    // ⚠⚠ `@s` IS THE SOURCE'S ENTITY, NOT THE PLAYER. Before `/execute as` existed the two were
    // always the same and this read `NS.Player` directly; the moment a command can run "as" a
    // falling block, `@s` meaning "the player" makes every `execute as ... run ... @s` a no-op
    // that looks like it worked (D-327).
    if (sel.kind === 's') { var me = C.selfTarget(source); if (me) out.push(me); }
    else if (sel.kind === 'p' || sel.kind === 'a' || sel.kind === 'r') { if (self) out.push(self); }
    else if (sel.kind === 'e') {
      if (self) out.push(self);
      var EL = NS.EntityList;
      if (EL && EL.all) {
        var all = EL.all();
        // ⚠ `name` HAS TO BE SET HERE TOO, not just on `@s` (`C.selfTarget`, above) —
        // `/teleport @e[type=cow] ...`'s success line reads `targets[0].name`, and a target with
        // no name at all falls through to `|| ctx.source.name`, so the feedback claimed to have
        // teleported "Player" while the entity that actually moved was the cow.
        for (var i = 0; i < all.length; i++) {
          out.push({ kind: 'entity', e: all[i], name: all[i].type !== undefined ? all[i].type : 'entity' });
        }
      }
    }
    // the option filters vanilla applies in the same order: type, then distance, then limit
    var ET = NS.Entities;
    if (sel.opts && sel.opts.type) {
      var want = String(sel.opts.type.value).replace(/^minecraft:/, '');
      var neg = sel.opts.type.negated;
      // ⚠⚠ THE BUG THIS SECTION EXISTS TO CATCH (mobcmdkillcheck.mjs, parallel night worker 1).
      // `t.e.type` IS ALREADY THE BARE NAME STRING (`EL.spawn`'s own `type: name`, matching the
      // convention `mobpackcheck.mjs`/every other live-entity check already reads it with --
      // `o.type === "zombie"`, not an id). `ET.names` (07h_entities.js) is a SORTED-NAMES ARRAY,
      // meant to be indexed by a NUMERIC id (`M.entityType().suggest` below does exactly that);
      // indexing it by the bare STRING (`ET.names[t.e.type]`) always misses and returns
      // `undefined`, so `n === want` was NEVER true and `@e[type=<anything>]` matched ZERO live
      // entities -- every command built on this selector (`/kill @e[type=...]` chief among them,
      // this file's own comment at the top names it as a real, tested rule) silently filtered
      // its whole target list to nothing. `neg` (the `!=` form) had the opposite failure: EVERY
      // entity matched, since `n !== want` was always true for `n === undefined`.
      out = out.filter(function (t) {
        var n = t.kind === 'player' ? 'player' : (t.e && t.e.type !== undefined ? t.e.type : '');
        return neg ? (n !== want) : (n === want);
      });
    }
    if (sel.opts && sel.opts.distance && source) {
      var lim = parseFloat(sel.opts.distance.value);
      if (!isNaN(lim)) {
        out = out.filter(function (t) {
          var dx = t.e.x - source.x, dy = t.e.y - source.y, dz = t.e.z - source.z;
          return Math.sqrt(dx * dx + dy * dy + dz * dz) <= lim;
        });
      }
    }
    if (sel.opts && sel.opts.limit) {
      var n = parseInt(sel.opts.limit.value, 10);
      if (n > 0) out = out.slice(0, n);
    }
    if (sel.playersOnly) out = out.filter(function (t) { return t.kind === 'player'; });
    return out;
  };

  /** ⚠ The two errors a `single` or `playersOnly` selector can produce, with vanilla's keys. */
  C.one = function (sel, source, reader) {
    var list = C.resolve(sel, source);
    if (sel.single && list.length > 1) {
      throw new B.Err(sel.playersOnly ? 'argument.player.toomany' : 'argument.entity.toomany', [], -1, null);
    }
    if (!list.length) {
      throw new B.Err(sel.playersOnly ? 'argument.entity.notfound.player' : 'argument.entity.notfound.entity',
                      [], -1, null);
    }
    return list[0];
  };

  /** `minecraft:item_stack` — an item id, with the `minecraft:` namespace optional. */
  M.item = function () {
    return { name: 'minecraft:item_stack',
      parse: function (r) {
        var start = r.cursor;
        var s = r.readId().replace(/^minecraft:/, '');
        var IT = NS.Items;
        var i = IT ? IT.of(s) : -1;
        if (i < 0) { r.cursor = start; throw B.err('argument.item.id.invalid', [s], r); }
        return i;
      },
      suggest: function (source, prefix) {
        var IT = NS.Items, out = [];
        if (!IT || !IT.names) return out;
        for (var i = 0; i < IT.count && out.length < 64; i++) {
          if (IT.names[i] && IT.names[i].indexOf(prefix) === 0) out.push(IT.names[i]);
        }
        return out;
      } };
  };

  /** `minecraft:entity_summon` — an entity type id, out of G17a's table. */
  M.entityType = function () {
    return { name: 'minecraft:entity_summon',
      parse: function (r) {
        var start = r.cursor;
        var s = r.readId().replace(/^minecraft:/, '');
        var ET = NS.Entities;
        var i = (ET && ET.types) ? ET.types[s] : undefined;
        // D-mobpack -- `i` is the entity's [width,height,...] ROW (an existence check only,
        // .decomp EntityArgumentType's own EntitySummonArgumentType resolves to the TYPE, not a
        // row) -- `EL.spawn`/`Ent.bare` both require the STRING name (`Ent.bare` returns '' for
        // anything that is not a string, so EL.spawn('' ...) silently fails EL.spawn's own
        // `!dim || !mot` gate). Every `/summon <type>` failed with "Unable to summon entity" for
        // every entity in the game until this line returned the string instead of the row.
        if (i === undefined) { r.cursor = start; throw B.err('argument.entity.options.type.invalid', [s], r); }
        return s;
      },
      suggest: function (source, prefix) {
        var ET = NS.Entities, out = [];
        if (!ET || !ET.names) return out;
        for (var i = 0; i < ET.names.length && out.length < 64; i++) {
          if (ET.names[i] && ET.names[i].indexOf(prefix) === 0) out.push(ET.names[i]);
        }
        return out;
      } };
  };

  /**
   * `minecraft:nbt_compound_tag` — SNBT `{key:value,...}` into a plain JS object.
   * ponytail: number suffixes (b/s/l/f/d) are parsed and DROPPED (no typed tags), typed arrays
   * `[B;..]` read as plain lists; add tag types when a command needs to distinguish them.
   */
  var snbtValue = function (r) {
    r.skipWhitespace();
    var c = r.peek();
    if (c === '{') return snbtCompound(r);
    if (c === '[') {
      r.skip(); r.skipWhitespace();
      if (/[BILbil]/.test(r.peek()) && r.peek(1) === ';') { r.skip(); r.skip(); }
      var a = [];
      r.skipWhitespace();
      while (r.canRead() && r.peek() !== ']') {
        a.push(snbtValue(r)); r.skipWhitespace();
        if (r.peek() === ',') { r.skip(); r.skipWhitespace(); } else break;
      }
      r.expect(']');
      return a;
    }
    if (c === '"' || c === "'") return r.readQuoted();
    var w = r.readUnquoted();
    if (!w.length) throw B.err('argument.nbt.expected.value', [], r);   // vanilla: "Expected value"
    if (w === 'true') return 1;
    if (w === 'false') return 0;
    if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?[bBsSlLfFdD]?$/.test(w)) return parseFloat(w);
    return w;
  };
  var snbtCompound = function (r) {
    r.expect('{'); r.skipWhitespace();
    var o = {};
    while (r.canRead() && r.peek() !== '}') {
      var k = r.readString();
      if (!k.length) throw B.err('argument.nbt.expected.key', [], r);
      r.skipWhitespace(); r.expect(':');
      o[k] = snbtValue(r); r.skipWhitespace();
      if (r.peek() === ',') { r.skip(); r.skipWhitespace(); } else break;
    }
    r.expect('}');
    return o;
  };
  M.nbtCompound = function () {
    return { name: 'minecraft:nbt_compound_tag',
      parse: function (r) { return snbtCompound(r); },
      suggest: function () { return ['{']; } };
  };
  /** SNBT text of a plain value (what `/data get` prints). */
  var snbtStr = function (v) {
    if (Array.isArray(v)) return '[' + v.map(snbtStr).join(', ') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).map(function (k) { return k + ': ' + snbtStr(v[k]); }).join(', ') + '}';
    return typeof v === 'string' ? '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"' : String(v);
  };

  /** `minecraft:item_slot` — name -> slot number, ItemSlotArgumentType's own table. */
  var SLOTS = (function () {
    var s = {}, i;
    for (i = 0; i < 54; i++) s['container.' + i] = i;
    for (i = 0; i < 9; i++) s['hotbar.' + i] = i;
    for (i = 0; i < 27; i++) { s['inventory.' + i] = 9 + i; s['enderchest.' + i] = 200 + i; }
    for (i = 0; i < 8; i++) s['villager.' + i] = 300 + i;
    for (i = 0; i < 15; i++) s['horse.' + i] = 500 + i;
    s.weapon = s['weapon.mainhand'] = 98; s['weapon.offhand'] = 99;
    s['armor.feet'] = 100; s['armor.legs'] = 101; s['armor.chest'] = 102; s['armor.head'] = 103;
    s['horse.saddle'] = 400; s['horse.armor'] = 401; s['horse.chest'] = 499;
    return s;
  })();
  M.slot = function () {
    return { name: 'minecraft:item_slot',
      parse: function (r) {
        var start = r.cursor, s = r.readUnquoted();
        if (SLOTS[s] === undefined) { r.cursor = start; throw B.err('slot.unknown', [s], r); }
        return SLOTS[s];
      },
      suggest: function () { return Object.keys(SLOTS); } };
  };

  /**
   * `Entity.getStackReference(slot)` as {get,set}, or null when the entity has no such slot.
   * Pillager overrides it for 300+i into its 5-slot `inventory`; MobEntity's 98..103 are the
   * equipment slots (offset by EquipmentSlot); the player's 0..35 are its main inventory.
   */
  C.stackRef = function (t, slot) {
    var Inv = NS.Inventory, e = t.e, Eq = NS.Equip, IT = NS.Items;
    var wrap = function (arr, i) {
      return { get: function () { return arr[i] || Inv.EMPTY; },
               set: function (s) { arr[i] = Inv.isEmpty(s) ? null : s; } };
    };
    if (t.kind === 'player') {
      if (slot >= 0 && slot < 36) return { get: function () { return Inv.getItem(e.inventory, slot); }, set: function (s) { Inv.setItem(e.inventory, slot, s); } };
      return null;
    }
    if (e.inventory && slot >= 300 && slot - 300 < e.inventory.length) return wrap(e.inventory, slot - 300);
    var eq = slot === 98 ? IT.MAINHAND : slot === 99 ? IT.OFFHAND : (slot >= 100 && slot <= 103) ? IT.FEET + slot - 100 : -1;
    if (eq >= 0 && Eq && e.maxHealth > 0) return { get: function () { return Eq.getEquipped(e, eq) || Inv.EMPTY; }, set: function (s) { Eq.setEquipped(e, eq, Inv.isEmpty(s) ? null : s); } };
    return null;
  };
  /** An item-stack NBT compound ({id,Count,tag}) -> Inventory stack, or EMPTY. */
  var stackFromNbt = function (n) {
    return NS.Inventory.stack(String(n.id || '').replace(/^minecraft:/, ''), n.Count === undefined ? 1 : n.Count, 0, n.tag);
  };
  var stackToNbt = function (s) {
    var o = { id: 'minecraft:' + NS.Items.nameOf(s.i), Count: s.n };
    if (s.t) o.tag = s.t;
    return o;
  };
  /** The slice of an entity's NBT this engine keeps (`/data get entity`). */
  C.entityNbt = function (t) {
    var e = t.e, Inv = NS.Inventory, o = { id: 'minecraft:' + (t.kind === 'player' ? 'player' : e.type) };
    o.Pos = [e.x, e.y, e.z];
    if (e.health !== undefined) o.Health = e.health;
    if (e.inventory) {
      o.Inventory = [];
      for (var i = 0; i < e.inventory.length; i++) if (e.inventory[i] && !Inv.isEmpty(e.inventory[i])) o.Inventory.push(stackToNbt(e.inventory[i]));
    }
    if (e.spawnerLogic && NS.Minecart) { var w = NS.Minecart.writeSpawnerNbt(e); for (var k in w) o[k] = w[k]; }
    if (NS.Minecart && NS.Minecart.isCart(e.type)) { var cw = NS.Minecart.writeNbt(e); for (var ck in cw) o[ck] = cw[ck]; }
    if (e.type === 'armor_stand' && NS.ArmorStand) { var asn = NS.ArmorStand.writeNbt(e); for (var ak in asn) o[ak] = asn[ak]; }
    if (e.type === 'ghast' && e.fireballStrength !== undefined) o.ExplosionPower = e.fireballStrength;   // GhastEntity.writeCustomDataToNbt (byte)
    if (NS.Mount && NS.Mount.isMountable(e)) horseWrite(e, o);
    return o;
  };
  /** HorseBaseEntity/AbstractDonkeyEntity.writeCustomDataToNbt (Owner is a UUID there; this engine's owner is 'player', so it is not written). */
  var horseWrite = function (e, o) {
    var Mnt = NS.Mount, bank = e.mountItems || [];
    o.Tame = !!e.tamed; o.Temper = Mnt.getTemper(e); o.Bred = !!e.bred;
    if (e.saddled) o.SaddleItem = { id: 'minecraft:saddle', Count: 1 };
    if (e.armorItem) o.ArmorItem = { id: 'minecraft:' + e.armorItem, Count: 1 };
    if (Mnt.isChestable(e)) {
      o.ChestedHorse = !!e.hasChest;
      if (e.hasChest) {
        o.Items = [];
        for (var i = 2; i < bank.length; i++) if (bank[i] && !NS.Inventory.isEmpty(bank[i])) { var n = stackToNbt(bank[i]); n.Slot = i; o.Items.push(n); }
      }
    }
  };
  var horseRead = function (e, nbt) {
    var Mnt = NS.Mount;
    if (nbt.Tame !== undefined) e.tamed = !!nbt.Tame;
    if (nbt.Owner !== undefined && e.tamed) e.owner = 'player';
    if (typeof nbt.Temper === 'number') e.temper = nbt.Temper | 0;
    if (nbt.Bred !== undefined) e.bred = !!nbt.Bred;
    if (nbt.SaddleItem) e.saddled = String(nbt.SaddleItem.id).replace(/^minecraft:/, '') === 'saddle';
    if (nbt.ArmorItem && Mnt.ARMOR_BONUS[String(nbt.ArmorItem.id).replace(/^minecraft:/, '')] !== undefined) Mnt.equipArmor(e, String(nbt.ArmorItem.id).replace(/^minecraft:/, ''));
    if (Mnt.isChestable(e) && nbt.ChestedHorse !== undefined) {
      e.hasChest = !!nbt.ChestedHorse;
      var bank = e.mountItems = new Array(e.hasChest ? 2 + 3 * Mnt.inventoryColumns(e) : 2).fill(null);
      if (e.hasChest && Array.isArray(nbt.Items)) {
        for (var i = 0; i < nbt.Items.length; i++) {
          var sl = nbt.Items[i].Slot & 255, st = stackFromNbt(nbt.Items[i]);
          if (sl >= 2 && sl < bank.length && !NS.Inventory.isEmpty(st)) bank[sl] = st;
        }
      }
    }
  };
  /** Mob-side `readCustomDataFromNbt` for /summon's tag: Inventory (readNbtList = addStack each). */
  C.applyNbt = function (e, nbt) {
    if (e.spawnerLogic && NS.Minecart) NS.Minecart.readSpawnerNbt(e, nbt);
    if (NS.Minecart && NS.Minecart.isCart(e.type)) NS.Minecart.readNbt(e, nbt);
    if (e.type === 'armor_stand' && NS.ArmorStand) NS.ArmorStand.readNbt(e, nbt);
    if (NS.Mount && NS.Mount.isMountable(e)) horseRead(e, nbt);
    if (e.type === 'shulker' && NS.Shulker) NS.Shulker.readNbt(e, nbt);
    if (e.type === 'mooshroom') {   // MooshroomEntity.readCustomDataFromNbt: Type.fromName (unknown -> red), EffectId byte + EffectDuration int
      if (typeof nbt.Type === 'string') e.mooshroomType = nbt.Type === 'brown' ? 'brown' : 'red';
      if (typeof nbt.EffectId === 'number') e.stewEffect = { id: nbt.EffectId << 24 >> 24, ticks: e.stewEffect ? e.stewEffect.ticks : 0 };
      if (typeof nbt.EffectDuration === 'number' && e.stewEffect) e.stewEffect.ticks = nbt.EffectDuration | 0;
    }
    if (e.type === 'ghast' && typeof nbt.ExplosionPower === 'number') e.fireballStrength = nbt.ExplosionPower << 24 >> 24;   // getByte
    if ((e.type === 'slime' || e.type === 'magma_cube') && NS.Slime) {   // SlimeEntity.readCustomDataFromNbt: stored Size is size-1
      if (typeof nbt.Size === 'number') NS.Slime.setSize(e, nbt.Size + 1, false);
      if (typeof nbt.wasOnGround === 'number') e.onGroundLastTick = !!nbt.wasOnGround;
    }
    if (Array.isArray(nbt.Inventory) && e.inventory) {
      for (var i = 0; i < nbt.Inventory.length; i++) {
        var s = stackFromNbt(nbt.Inventory[i]);
        if (NS.Inventory.isEmpty(s)) continue;
        // ponytail: first empty slot, no merge into a partial stack (SimpleInventory.addStack merges)
        for (var k = 0; k < e.inventory.length; k++) if (!e.inventory[k]) { e.inventory[k] = s; break; }
      }
    }
  };

  /**
   * `minecraft:time` — an int with an optional unit suffix.
   * ⚠ THE UNITS ARE VANILLA'S AND THEY ARE NOT ALL INTEGERS OF EACH OTHER: `d` is 24000 ticks,
   * `s` is 20, `t` is 1, and a bare number is ticks. `/time add 1d` is a day, not one tick.
   */
  M.UNITS = { d: 24000, s: 20, t: 1 };
  M.time = function (min) {
    return { name: 'minecraft:time',
      parse: function (r) {
        var start = r.cursor;
        // TimeArgumentType.parse: a FLOAT, then a whole unquoted-string unit, then Math.round(float) - an int that saturates
        var v = Math.fround(r.readFloat());
        var us = r.readUnquoted();
        var unit = us === '' ? 1 : M.UNITS[us];
        if (unit === undefined) { r.cursor = start; throw B.err('argument.time.invalid_unit', [], r); }
        var ticks = Math.floor(Math.fround(v * unit) + 0.5);
        ticks = ticks > 2147483647 ? 2147483647 : ticks < -2147483648 ? -2147483648 : ticks;
        if (min !== undefined && ticks < min) { r.cursor = start; throw B.err('argument.time.invalid_tick_count', [], r); }
        return ticks;
      },
      suggest: function () { return []; } };
  };

  /**
   * `minecraft:vec3` — three coordinates, each absolute or `~`-relative.
   * ⚠ `~` WITH NO NUMBER MEANS "UNCHANGED", not zero, which is why `/tp ~ ~10 ~` is the one
   * everybody types. And mixing `^` local coordinates with `~` world ones is an error with its
   * own vanilla key, `argument.pos.mixed`, rather than something quietly averaged.
   */
  M.coord = function (r, whole) {
    if (!r.canRead()) throw B.err(whole ? 'argument.pos.missing.int' : 'argument.pos.missing.double', [], r);
    var ch = r.peek();
    if (ch === '^') { r.skip(); var lv = (r.canRead() && /[-0-9.]/.test(r.peek())) ? r.readDouble() : 0;
                      return { local: true, rel: false, v: lv }; }
    if (ch === '~') {
      r.skip();
      if (!r.canRead() || r.peek() === ' ') return { local: false, rel: true, v: 0 };
      return { local: false, rel: true, v: r.readDouble() };
    }
    var v = whole ? r.readInt() : r.readDouble();
    return { local: false, rel: false, v: v };
  };
  M.vec3 = function (whole) {
    return { name: whole ? 'minecraft:block_pos' : 'minecraft:vec3',
      parse: function (r) {
        var x = M.coord(r, whole);
        r.expect(' ');
        var y = M.coord(r, whole);
        r.expect(' ');
        var z = M.coord(r, whole);
        var locals = (x.local ? 1 : 0) + (y.local ? 1 : 0) + (z.local ? 1 : 0);
        if (locals !== 0 && locals !== 3) throw B.err('argument.pos.mixed', [], r);
        return { x: x, y: y, z: z, whole: !!whole };
      },
      suggest: function () { return ['~', '~ ~ ~']; } };
  };
  /** Resolve a parsed position against a source. Local (`^`) coordinates use the source's look. */
  C.pos = function (p, source) {
    var ox = source.x, oy = source.y, oz = source.z;
    if (p.x.local) {
      // ⚠⚠ **THE ROTATION IS THE SOURCE'S, NOT THE PLAYER'S.** This read `source.player.yaw`
      // directly, which was the same thing until `/execute rotated` existed and is a silent
      // no-op afterwards: `execute rotated 90 0 run tp ^ ^ ^1` would have moved you the way you
      // were already facing and looked like the clause was ignored (D-327).
      var P = source.player || {};
      var yaw = source.yaw !== undefined ? source.yaw : (P.yaw || 0);
      var pitch = source.pitch !== undefined ? source.pitch : (P.pitch || 0);
      // ⚠ AND `^` MEASURES FROM THE ANCHOR. `execute anchored eyes` puts the origin at eye
      // height, which is the whole reason the clause exists — vanilla aims from the eyes.
      if (source.anchor === 'eyes') {
        var Ph = NS.Physics;
        oy += (source.entity && source.entity.eyeHeight !== undefined)
              ? source.entity.eyeHeight : (Ph ? Ph.EYE : 1.62);
      }
      var cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
      var fx = -sy * cp, fy = -sp, fz = cy * cp;
      var rx = cy, ry = 0, rz = sy;
      var ux = fy * rz - fz * ry, uy = fz * rx - fx * rz, uz = fx * ry - fy * rx;
      return { x: ox + rx * p.x.v + ux * p.y.v + fx * p.z.v,
               y: oy + ry * p.x.v + uy * p.y.v + fy * p.z.v,
               z: oz + rz * p.x.v + uz * p.y.v + fz * p.z.v };
    }
    var f = function (c, base) { return c.rel ? base + c.v : c.v; };
    var out = { x: f(p.x, ox), y: f(p.y, oy), z: f(p.z, oz) };
    if (p.whole) { out.x = Math.floor(out.x); out.y = Math.floor(out.y); out.z = Math.floor(out.z); }
    return out;
  };

  /**
   * Resolve a parsed `minecraft:rotation` (a yaw/pitch pair, `M.rotation`, below) against a
   * source. `~` means relative to the SOURCE'S OWN facing -- the same "relative to the command
   * source, not whatever entity ends up acted on" rule `C.pos`'s local `^` coordinates follow
   * above, and the same convention `/execute rotated <yaw> <pitch>` already implements further
   * down in this file. ⚠ DEGREES IN, RADIANS STORED, same as that clause -- vanilla's rotation
   * argument is degrees and this engine's `yaw`/`pitch` fields are radians throughout.
   */
  C.rot = function (rp, source) {
    var DEG = Math.PI / 180;
    var y = rp.yaw, p2 = rp.pitch;
    return {
      yaw: y.rel ? (source.yaw || 0) + y.v * DEG : y.v * DEG,
      pitch: p2.rel ? (source.pitch || 0) + p2.v * DEG : p2.v * DEG
    };
  };

  /**
   * Resolve a parsed `minecraft:angle` (`M.angle`, above) against a source, in DEGREES --
   * `/spawnpoint`/`/setworldspawn`'s feedback string prints this straight, unlike `C.rot`'s
   * radians. `~` is relative to the source's own current yaw (engine radians -> degrees),
   * matching `AngleArgumentType.Angle.getAngle` (.decomp). Wrapped into (-180, 180] with the
   * same fold `MathHelper.wrapDegrees` uses.
   */
  C.angle = function (a, source) {
    var deg = a.rel ? a.v + (source.yaw || 0) * 180 / Math.PI : a.v;
    deg = deg % 360;
    if (deg >= 180) deg -= 360;
    if (deg < -180) deg += 360;
    return deg;
  };

  // Java's `Float.toString` always keeps a decimal point (`45.0`, not `45`) -- the feedback
  // string's `%s` slot for the angle prints exactly that, so a bare-integer JS `String()`
  // would read wrong next to vanilla's own screenshots. Module-scope (not `build()`-local, unlike
  // `fmtPos`): `C.setSpawn`/`C.setWorldSpawn` are declared outside that closure.
  var fmtAngle = function (d) { var s2 = String(d); return s2.indexOf('.') === -1 ? s2 + '.0' : s2; };

  /**
   * `minecraft:block_state` — a block id with optional `[property=value,...]`.
   *
   * ⚠ THE PROPERTIES ARE THE REGISTRY'S OWN NAMES, not a table here. `Reg.PROP` and `Reg.PVAL`
   * ship with the block runtime, and `States.withProp` is the same call the placement rules use —
   * so `/setblock ~ ~ ~ oak_stairs[facing=east,half=top]` reaches exactly the state a placed
   * stair would. A parser that accepted the id and dropped the brackets would silently place the
   * DEFAULT state and look almost right.
   */
  M.blockState = function () {
    return { name: 'minecraft:block_state',
      parse: function (r) {
        var start = r.cursor;
        var nm = r.readId().replace(/^minecraft:/, '');
        var SR = NS.States, R = NS.Reg;
        var st = SR ? SR.stateOf(nm) : 0;
        if (!st && nm !== 'air') { r.cursor = start; throw B.err('argument.block.id.invalid', [nm], r); }
        if (!r.canRead() || r.peek() !== '[') return st;
        r.skip();
        var seen = Object.create(null);
        while (r.canRead() && r.peek() !== ']') {
          r.skipWhitespace();
          var ps = r.cursor;
          var key = r.readUnquoted();
          var pid = R.PROP ? R.PROP[key] : undefined;
          // ⚠⚠ TWO DIFFERENT VANILLA ERRORS, AND THE FIRST DRAFT COLLAPSED THEM.
          // `argument.block.property.unknown` is "this BLOCK does not have that property";
          // `.invalid` is "that property does not take that value". `facing` is a real property
          // name in the registry — dozens of blocks have it — so checking only `Reg.PROP` said
          // `stone[facing=east]` had a bad VALUE, when the truth is that stone has no facing at
          // all. The block's own property slots are `Reg.propFirst[b]..propFirst[b+1]`.
          var block = NS.States.block ? NS.States.block[st] : -1;
          var hasProp = false;
          if (pid !== undefined && block >= 0 && R.propFirst) {
            for (var sl = R.propFirst[block]; sl < R.propFirst[block + 1]; sl++) {
              if (R.propId[sl] === pid) { hasProp = true; break; }
            }
          }
          if (pid === undefined || !hasProp) {
            r.cursor = ps;
            throw B.err('argument.block.property.unknown', [nm, key], r);
          }
          if (seen[key]) { r.cursor = ps; throw B.err('argument.block.property.duplicate', [key, nm], r); }
          seen[key] = 1;
          r.skipWhitespace();
          if (!r.canRead() || r.peek() !== '=') throw B.err('argument.block.property.novalue', [key, nm], r);
          r.skip();
          r.skipWhitespace();
          var vs = r.cursor;
          var val = r.readUnquoted();
          var vid = R.PVAL ? R.PVAL[val] : undefined;
          if (vid === undefined) { r.cursor = vs; throw B.err('argument.block.property.invalid', [nm, val, key], r); }
          var next = SR.withProp(st, pid, vid);
          // ⚠ `withProp` RETURNS THE SAME STATE when the block does not have that property or
          // does not accept that value. Without this the command would take
          // `stone[facing=east]` and place plain stone, reporting success.
          if (next === st && !(R.PROP && SR.propValue(st, pid) === vid)) {
            r.cursor = vs;
            throw B.err('argument.block.property.invalid', [nm, val, key], r);
          }
          st = next;
          r.skipWhitespace();
          if (r.canRead() && r.peek() === ',') { r.skip(); continue; }
          break;
        }
        if (!r.canRead() || r.peek() !== ']') throw B.err('argument.block.property.unclosed', [], r);
        r.skip();
        return st;
      },
      suggest: function (source, prefix) {
        var R = NS.Reg, out = [];
        if (!R || !R.names) return out;
        for (var i = 1; i < R.names.length && out.length < 64; i++) {
          if (R.names[i] && R.names[i].indexOf(prefix) === 0) out.push(R.names[i]);
        }
        return out;
      } };
  };

  /**
   * `minecraft:block_predicate` -- `<block>[props]` or `#<tag>[props]` (vanilla BlockPredicateArgumentType).
   * Parses to a test(state) function: the block (or tag) must match AND every listed property must
   * equal the state's own value. Properties are only validated as names/values that exist.
   */
  M.blockPredicate = function () {
    return { name: 'minecraft:block_predicate',
      parse: function (r) {
        var start = r.cursor, R = NS.Reg, SR = NS.States;
        var isTag = r.canRead() && r.peek() === '#';
        if (isTag) r.skip();
        var nm = r.readId().replace(/^minecraft:/, '');
        var col = -1, blk = -1;
        if (isTag) {
          col = NS.Tags ? NS.Tags.blockTag(nm) : -1;
          if (col < 0) { r.cursor = start; throw B.err('arguments.block.tag.unknown', [nm], r); }
        } else {
          var st0 = SR ? SR.stateOf(nm) : 0;
          if (!st0 && nm !== 'air') { r.cursor = start; throw B.err('argument.block.id.invalid', [nm], r); }
          blk = SR.block[st0];
        }
        var props = [];
        if (r.canRead() && r.peek() === '[') {
          r.skip();
          while (r.canRead() && r.peek() !== ']') {
            r.skipWhitespace();
            var ps = r.cursor, key = r.readUnquoted();
            var pid = R.PROP ? R.PROP[key] : undefined;
            if (pid === undefined) { r.cursor = ps; throw B.err('argument.block.property.unknown', [nm, key], r); }
            r.skipWhitespace();
            if (!r.canRead() || r.peek() !== '=') throw B.err('argument.block.property.novalue', [key, nm], r);
            r.skip(); r.skipWhitespace();
            var vs = r.cursor, val = r.readUnquoted();
            var vid = R.PVAL ? R.PVAL[val] : undefined;
            if (vid === undefined) { r.cursor = vs; throw B.err('argument.block.property.invalid', [nm, val, key], r); }
            props.push([pid, vid]);
            r.skipWhitespace();
            if (r.canRead() && r.peek() === ',') { r.skip(); continue; }
            break;
          }
          if (!r.canRead() || r.peek() !== ']') throw B.err('argument.block.property.unclosed', [], r);
          r.skip();
        }
        return function (state) {
          if (isTag ? !NS.Tags.blockInCol(col, SR.block[state]) : SR.block[state] !== blk) return false;
          for (var i = 0; i < props.length; i++) if (SR.propValue(state, props[i][0]) !== props[i][1]) return false;
          return true;
        };
      },
      suggest: function () { return []; } };
  };

  /** `minecraft:resource_location` for a sound event, out of G13's own table. */
  M.sound = function () {
    return { name: 'minecraft:resource_location',
      parse: function (r) {
        var start = r.cursor;
        var nm = r.readId().replace(/^minecraft:/, '');
        var Sn = NS.Sound;
        if (!Sn || !Sn.events || !Sn.events[nm]) { r.cursor = start; throw B.err('argument.id.unknown', [nm], r); }
        return nm;
      },
      suggest: function (source, prefix) {
        var Sn = NS.Sound, out = [];
        if (!Sn || !Sn.events) return out;
        for (var k in Sn.events) { if (k.indexOf(prefix) === 0 && out.length < 64) out.push(k); }
        return out;
      } };
  };

  /**
   * `minecraft:component` — a JSON chat component.
   *
   * ⚠ IT TAKES THE REST OF THE LINE. Vanilla reads exactly one JSON value out of the reader and
   * leaves the cursor after it; this reads greedily, which is identical for every command that
   * has a component LAST — and in 1.18.2 every one of them does. A component in the middle of an
   * argument list would need the streaming reader, and the day one exists this comment is the
   * place that says so.
   */
  M.component = function () {
    return { name: 'minecraft:component',
      parse: function (r) {
        var start = r.cursor;
        var raw = r.remaining();
        r.cursor = r.string.length;
        var val;
        try { val = JSON.parse(raw); } catch (e) {
          r.cursor = start;
          throw B.err('argument.component.invalid', [String(e.message || e)], r);
        }
        try { return NS.Text.fromJson(val); } catch (e2) {
          r.cursor = start;
          throw B.err('argument.component.invalid', [String(e2.why || e2.message || e2)], r);
        }
      },
      suggest: function () { return ['{"text":"', '["', '{"translate":"']; } };
  };

  /**
   * One half of `minecraft:rotation` — a yaw or a pitch, with `~` meaning "relative to mine".
   * ⚠ IT IS NOT `minecraft:coordinate`: a rotation has no `^`, because a local rotation is a
   * rotation relative to a rotation, which vanilla does not define.
   */
  M.coordValue = function () {
    return { name: 'minecraft:rotation',
      parse: function (r) {
        if (!r.canRead()) throw B.err('argument.rotation.incomplete', [], r);
        if (r.peek() === '~') {
          r.skip();
          if (!r.canRead() || r.peek() === ' ') return { rel: true, v: 0 };
          return { rel: true, v: r.readDouble() };
        }
        return { rel: false, v: r.readDouble() };
      },
      suggest: function () { return ['~']; } };
  };

  /**
   * `minecraft:rotation` — a yaw and a pitch, each `M.coordValue`'s own `~`-relative half.
   * ⚠ ONE ARGUMENT, TWO NUMBERS -- `RotationArgumentType.rotation()` (.decomp, referenced from
   * `TeleportCommand.register`) is a single dispatcher node, which is why `/help teleport` shows
   * `<rotation>` and not two separate `<yaw> <pitch>` placeholders.
   */
  M.rotation = function () {
    return { name: 'minecraft:rotation',
      parse: function (r) {
        var yaw = M.coordValue().parse(r);
        r.expect(' ');
        var pitch = M.coordValue().parse(r);
        return { yaw: yaw, pitch: pitch };
      },
      suggest: function () { return ['~ ~']; } };
  };

  /**
   * `minecraft:angle` — ONE yaw value in degrees, `~` meaning "relative to my own facing"
   * (`AngleArgumentType`, .decomp: `SpawnPointCommand`/`SetWorldSpawnCommand` both take this,
   * not `minecraft:rotation` -- there is no pitch half here). Wrapped into (-180, 180] with
   * vanilla's own `MathHelper.wrapDegrees`, same as the relative-angle resolution below.
   */
  M.angle = function () {
    return { name: 'minecraft:angle',
      parse: function (r) {
        if (!r.canRead()) throw B.err('argument.angle.incomplete', [], r);
        if (r.peek() === '~') {
          r.skip();
          if (!r.canRead() || r.peek() === ' ') return { rel: true, v: 0 };
          return { rel: true, v: r.readDouble() };
        }
        return { rel: false, v: r.readDouble() };
      },
      suggest: function () { return ['~']; } };
  };

  /**
   * `minecraft:swizzle` — some combination of x, y and z, each at most once.
   * ⚠ THE DUPLICATE CHECK IS VANILLA'S: `xx` is refused, not quietly read as `x`.
   */
  M.axes = function () {
    return { name: 'minecraft:swizzle',
      parse: function (r) {
        var start = r.cursor;
        var got = r.readUnquoted(), seen = {};
        if (!got) { r.cursor = start; throw B.err('arguments.swizzle.invalid', [], r); }
        for (var i = 0; i < got.length; i++) {
          var ch = got.charAt(i);
          if ('xyz'.indexOf(ch) < 0 || seen[ch]) { r.cursor = start; throw B.err('arguments.swizzle.invalid', [], r); }
          seen[ch] = 1;
        }
        return got;
      },
      suggest: function () { return ['x', 'y', 'z', 'xy', 'xz', 'yz', 'xyz']; } };
  };

  /** One of a fixed set of words — vanilla's `StringRepresentable` arguments, as one type. */
  M.oneOf = function (values, errKey, asId) {
    // ⚠ THE SET MAY BE A FUNCTION, because some of these sets do not exist when the dispatcher is
    // built. `/gamemode`'s four words are a literal list; `/locatebiome`'s are every biome the
    // WORLD has, which `Climate.init` fills in. Freezing a snapshot at build time gave a command
    // that rejected every biome in a world built after it.
    var set = function () { return typeof values === 'function' ? (values() || []) : values; };
    // ⚠ `minecraft:x` AND `x` ARE THE SAME ID (14h_brigadier.js:99's own rule, R.readId's
    // comment) — EVERYWHERE an id is expected, not just where the SET happens to already be
    // namespaced. Live-tested (parallel night, session 146, worker 4): the pre-fix version
    // matched the raw typed text against the raw set entries with no normalisation, so
    // `/locatebiome plains` failed (the set is namespaced, `Climate.biomeNames` — every entry is
    // `minecraft:<name>`) while `/locate minecraft:village` ALSO failed (the set is bare,
    // `Structures`' own member types) — the SAME bug hitting both commands from opposite sides,
    // because each one's set happens to use a different convention and neither direction was
    // ever normalised. A biome or structure typed the "wrong" way for its own command's set
    // read as "no such biome"/"no such structure" instead of resolving.
    var norm = function (s) { return String(s).replace(/^minecraft:/, ''); };
    return { name: 'minecraft:enum',
      parse: function (r) {
        var start = r.cursor;
        // ⚠ AN ID IS NOT A WORD (D-316). `readUnquoted` stops at `:`, so `minecraft:plains`
        // came back as `minecraft` and every namespaced value was rejected — the same trap that
        // broke `/setblock minecraft:stone` when the parser was written.
        var s2 = asId ? r.readId() : r.readUnquoted();
        var list = set();
        var idx = list.indexOf(s2);
        if (idx < 0 && asId) {
          var want = norm(s2);
          for (var i = 0; i < list.length; i++) { if (norm(list[i]) === want) { idx = i; break; } }
        }
        if (idx < 0) { r.cursor = start; throw B.err(errKey || 'argument.id.invalid', [s2], r); }
        return list[idx];
      },
      suggest: function () { return set().slice(); } };
  };

  /**
   * `BiomeSource.findBiomeHorizontal`, transcribed — the search `/locatebiome` runs.
   *
   * ⚠⚠ **IT IS IN QUART COORDINATES AND IT WALKS RINGS, NOT A FILLED SQUARE.** Biomes are
   * constant inside each 4x4x4 cell, so vanilla searches the quart grid; and with `findClosest`
   * it only samples the BOUNDARY of each ring, because everything inside it was covered by a
   * smaller one. A filled-square search of the same radius asks 200 times as many questions for
   * the same answer, and `Climate.biomeAt` is not a cheap question.
   *
   * ⚠ AND IT TAKES THE FIRST MATCH ON A RING, NOT THE NEAREST POINT ON IT — so the reported
   * distance is "close", not minimal. That is vanilla's behaviour and the reason its own message
   * says "the nearest %s" while sometimes naming a slightly further one.
   */
  C.findBiome = function (name, x, y, z) {
    var CL = NS.Climate;
    if (!CL || !CL.biomeNameAt) return null;
    var i = x >> 2, j = z >> 2;
    var k = C.LOCATE_RADIUS >> 2, step = C.LOCATE_STEP;
    var budget = C.LOCATE_MS, t0 = budget > 0 ? Date.now() : 0, seen = 0;
    C.locateSamples = 0;
    for (var i1 = 0; i1 <= k; i1 += step) {
      for (var j1 = -i1; j1 <= i1; j1 += step) {
        var onJ = Math.abs(j1) === i1;
        for (var k1 = -i1; k1 <= i1; k1 += step) {
          if (!onJ && Math.abs(k1) !== i1) continue;
          // ⚠ THE CLOCK IS READ ONCE EVERY 256 SAMPLES, not every one: `Date.now()` costs more
          // than a fifth of what a biome lookup does, and a budget that spends a quarter of
          // itself on measuring is not a budget.
          if (budget > 0 && (++seen & 255) === 0 && Date.now() - t0 > budget) {
            C.locateSamples = seen;
            return null;
          }
          var bx = (i + k1) << 2, bz = (j + j1) << 2;
          if (CL.biomeNameAt(bx, y, bz) === name) { C.locateSamples = seen; return { x: bx, y: y, z: bz }; }
        }
      }
    }
    C.locateSamples = seen;
    return null;
  };

  /**
   * ── `/locate`: the nearest start of a structure TYPE (D-355) ──────────────────────────────
   *
   * ⚠⚠ **THIS IS NOT `findBiome` WITH A DIFFERENT PREDICATE, AND WALKING BLOCKS WOULD BE THE
   * WRONG SEARCH ENTIRELY.** A structure is not somewhere in the world to be sampled for: its
   * placement is a GRID, one candidate chunk per `spacing x spacing` region, and vanilla's
   * `ChunkGenerator.findNearestMapFeature` walks rings of REGIONS outward, asks each region for
   * its one candidate chunk, and tests only that chunk. Sampling the world instead would be
   * thousands of times the work for a worse answer.
   *
   * ⚠ **IT RETURNS ON THE FIRST HIT OF A RING, NOT THE NEAREST ON IT** — vanilla's loop returns
   * inside the scan, so a structure on the far side of the same ring can win over a nearer one
   * on the same ring. That is a quirk and it is reproduced rather than improved: a `/locate` that
   * answered "nearer" would disagree with the real game on a seed a player could compare.
   *
   * ⚠ **THE STRONGHOLD IS A DIFFERENT PLACEMENT AND A DIFFERENT SEARCH.** `concentric_rings` has
   * no spacing grid at all; its positions are known outright, so the nearest is taken directly.
   * Folding it into the ring walk would look tidier and answer wrongly.
   *
   * @returns {{x:number,y:number,z:number}|null}
   */
  C.LOCATE_REGIONS = 100;          // vanilla's own search radius, in REGIONS
  C.LOCATE_STRUCT_MS = 3000;       // see the note in `findStructure` — NOT `LOCATE_MS`
  C.findStructure = function (want, sx, sz) {
    var ST = NS.Structures;
    if (!ST || !ST.ready) return null;
    var cx0 = sx >> 4, cz0 = sz >> 4;
    var best = null, bestD = Infinity;
    C.locateSamples = 0;
    // ⚠⚠ **THE SAME BUDGET `findBiome` HAS, FOR THE SAME REASON** (D-325). Vanilla pays this cost
    // on a server thread; this game pays it on the one that DRAWS. A full hundred-ring walk is
    // forty thousand regions, and a region that has to build a start costs a third of a
    // millisecond — thirteen seconds of frozen tab for a structure that happens to be far away.
    // ⚠⚠ **AND IT IS A DIFFERENT NUMBER FROM THE BIOME ONE, WITH A MEASUREMENT UNDER IT.** At
    // `LOCATE_MS` (500 ms) the nearest MANSION to the origin on seed 1337 is refused — it is 28 km
    // out and costs 712 ms over 2,143 regions — and **refusing a legal query is worse than the
    // pause** (D-346's rule, in a fourth place). A region that builds a start costs a third of a
    // millisecond because the biome test cannot run until the pieces are laid out (D-184), which
    // is vanilla's own coupling and why `/locate` takes seconds on a real server too. So the
    // structure budget is six times the biome one: four mansions' worth of headroom, and the
    // pathological case capped at three seconds instead of thirteen.
    var budget = C.LOCATE_STRUCT_MS, t0 = budget > 0 ? Date.now() : 0;
    var take = function (cx, cz, y) {
      var bx = (cx << 4) + 8, bz = (cz << 4) + 8;
      var dx = bx - sx, dz = bz - sz;
      var d2 = dx * dx + dz * dz;
      if (d2 < bestD) { bestD = d2; best = { x: bx, y: y === undefined ? 64 : y, z: bz }; }
    };

    for (var si = 0; si < ST.sets.length; si++) {
      var set = ST.sets[si];
      if (!set.live) continue;
      var has = false;
      for (var mi = 0; mi < set.members.length; mi++) {
        if (set.members[mi].def.type === want) { has = true; break; }
      }
      if (!has) continue;
      var pl = set.placement;

      // ⚠⚠ **THE STRONGHOLD IS NOT A GRID AND IS NOT SEARCHED FOR.** `concentric_rings` places
      // its members on rings computed outright from the world seed, and vanilla's own
      // `findNearestMapFeature` branches to `strongholdPositions` for exactly this. Walking
      // regions to find one would be a search for something whose coordinates are already known
      // — slower, and wrong at the edges where no region contains one.
      if (pl.kind === 'concentric_rings') {
        var pos = ST.ringPositions(pl) || [];
        for (var pi = 0; pi + 1 < pos.length; pi += 2) { C.locateSamples++; take(pos[pi], pos[pi + 1]); }
        continue;
      }

      var sp = pl.spacing | 0;
      if (!(sp > 0)) continue;
      var r0x = Math.floor(cx0 / sp), r0z = Math.floor(cz0 / sp);
      // ⚠ RING BY RING, PERIMETER ONLY, AND `startsOfRegion` IS THE PRIMITIVE.
      // ⚠⚠ **NOT `startsNear`, WHICH IS A DIFFERENT QUESTION AND A HUNDRED TIMES THE WORK.**
      // The first draft asked "what starts touch this chunk", which scans all seventeen sets and
      // builds a 16x16-region BLOCK of the cache per call — and since consecutive candidates on
      // a ring land in different blocks, every call was a cache miss that generated 256 regions.
      // Seven `/locate` calls did not finish in two minutes. `startsOfRegion` is the one region
      // of the one set the search is actually about.
      var found = null;
      for (var ring = 0; ring <= C.LOCATE_REGIONS && !found; ring++) {
        for (var dz2 = -ring; dz2 <= ring && !found; dz2++) {
          var edgeZ = (dz2 === -ring || dz2 === ring);
          for (var dx2 = -ring; dx2 <= ring; dx2++) {
            if (!edgeZ && dx2 !== -ring && dx2 !== ring) continue;
            // ⚠ THE CLOCK IS READ ONCE EVERY 64 REGIONS, not every one — `findBiome`'s note,
            // one power of two lower because a region costs more than a biome lookup does.
            if (budget > 0 && (C.locateSamples & 63) === 0 && Date.now() - t0 > budget) {
              found = null; ring = C.LOCATE_REGIONS + 1; break;
            }
            C.locateSamples++;
            var list = ST.startsOfRegion(si, r0x + dx2, r0z + dz2);
            for (var li = 0; li < list.length; li++) {
              if (list[li].def && list[li].def.type === want) { found = list[li]; break; }
            }
            // ⚠ AND IT RETURNS ON THE FIRST HIT OF A RING, NOT THE NEAREST ON IT: vanilla's loop
            // returns from inside the scan, so a structure on the far side of the same ring can
            // win over a nearer one. A `/locate` that answered "nearer" would disagree with the
            // real game on a seed a player could compare.
            if (found) break;
          }
        }
      }
      if (found) take(found.cx, found.cz, found.y);
    }
    return best;
  };

  // ── the commands ──────────────────────────────────────────────────────────────────────────
  var G = B; // placeholder so the linter sees the name; rebound in build()

  C.build = function () {
    B = NS.Brig;
    if (!B) { C.ready = false; return C; }
    var d = new B.Dispatcher();
    var lit = B.literal, arg = B.arg, get = B.get;

    // ── /gamemode <mode> [targets] ─────────────────────────────────────────────────────────
    var setMode = function (ctx, targets) {
      var mode = get(ctx, 'mode');
      var Gm = NS.Gamemode;
      var label = T('gameMode.' + (Gm.NAMES ? Gm.NAMES[mode] : mode));
      var list = targets || [{ kind: 'player', e: NS.Player, name: ctx.source.name }];
      var changed = 0;
      // ServerPlayerInteractionManager.changeGameMode: false when the mode is already current, and
      // GameModeCommand.execute gives feedback / counts only the players that really changed.
      for (var i = 0; i < list.length; i++) {
        if (list[i].kind !== 'player' || list[i].e.mode === mode) continue;
        Gm.set(list[i].e, mode);
        changed++;
        if (list[i].e === (ctx.source.entity || NS.Player) && (list.length === 1 || !ctx.source.entity)) {
          ctx.source.send(T('commands.gamemode.success.self', [label]));
        } else {
          if (C.ruleGet('sendCommandFeedback') !== 'false') ctx.source.send(T('gameMode.changed', [label]));
          ctx.source.send(T('commands.gamemode.success.other', [list[i].name || ctx.source.name, label]));
        }
      }
      return changed;
    };
    d.register(lit('gamemode').requires(perm(2))
      .then(arg('mode', M.gameMode()).executes(function (c) { return setMode(c, null); })
        .then(arg('targets', M.entity(false, true)).executes(function (c) {
          return setMode(c, C.resolve(get(c, 'targets'), c.source));
        }))));

    // ── /give <targets> <item> [count] ─────────────────────────────────────────────────────
    var give = function (ctx, count) {
      var IT = NS.Items, Iv = NS.Inventory;
      var item = get(ctx, 'item');
      var targets = C.resolve(get(ctx, 'targets'), ctx.source);
      if (!targets.length) throw new B.Err('argument.entity.notfound.player', [], -1, null);
      var name = T('item.minecraft.' + IT.names[item]);
      if (name === 'item.minecraft.' + IT.names[item]) name = T('block.minecraft.' + IT.names[item]);
      // ⚠ VANILLA'S OWN CAP IS PER-ITEM, NOT A FLAT NUMBER (`GiveCommand.MAX_STACKS` = 100 ×
      // the item's own max stack size — 6400 for a diamond, 100 for a diamond sword). The
      // grammar's `count` bound (1–6400) is only an outer sanity limit; a maxStack=1 item asked
      // for 200 must fail here with `commands.give.failed.toomanyitems`, not silently distribute
      // however many stacks happen to fit before the inventory (or the loop guard) runs out.
      var giveCap = IT.maxStack(item) * 100;
      if (count > giveCap) {
        throw new B.Err('commands.give.failed.toomanyitems', [String(giveCap), name], -1, null);
      }
      for (var i = 0; i < targets.length; i++) {
        if (targets[i].kind !== 'player') continue;
        var left = count;
        // ⚠ ONE STACK AT A TIME, capped at the item's OWN max — `/give @s diamond_sword 5` gives
        // five swords in five slots, not one slot claiming five.
        var guard = 0;
        while (left > 0 && guard++ < 512) {
          var n = Math.min(left, IT.maxStack(item));
          Iv.add(targets[i].e.inventory, Iv.stack(item, n));
          left -= n;
        }
      }
      if (targets.length === 1) ctx.source.send(T('commands.give.success.single', [count + '', name, targets[0].name || ctx.source.name]));
      else ctx.source.send(T('commands.give.success.multiple', [count + '', name, targets.length + '']));
      if (NS.Player && NS.Player.syncHotbar) NS.Player.syncHotbar();
      return targets.length;
    };
    d.register(lit('give').requires(perm(2))
      .then(arg('targets', M.entity(false, true))
        .then(arg('item', M.item()).executes(function (c) { return give(c, 1); })
          .then(arg('count', B.integer(1, 6400)).executes(function (c) { return give(c, get(c, 'count')); })))));

    // ── /time ──────────────────────────────────────────────────────────────────────────────
    // ⚠ THE FOUR PRESETS ARE VANILLA'S OWN TICK VALUES and they are not evenly spaced: day is
    // 1000 (not 0), noon 6000, night 13000, midnight 18000. `day` meaning 0 is the single most
    // common way a clone's `/time set day` comes out looking like dawn.
    var PRESET = { day: 1000, noon: 6000, night: 13000, midnight: 18000 };
    // ⚠ `TimeCommand.executeSet`/`executeAdd` (.decomp TimeCommand.java:66-83) do NOT agree with
    // each other on what they report: `executeSet` sends the FEEDBACK with the raw tick count
    // just set (`sendFeedback(..., $$1)`, unwrapped -- `/time set 30000` really does say
    // "Set the time to 30000") but RETURNS the wrapped day-time (`getDayTime`, mod 24000) as the
    // command's own result. `executeAdd` wraps BOTH: its feedback and its return are the same
    // `getDayTime()` call. A version that reports/returns the raw accumulator for both matches
    // neither and drifts the moment `dayTime` crosses 24000 (any world that has run a real day).
    var wrapDay = function (t) { return ((t % 24000) + 24000) % 24000; };
    var setTime = function (ctx, ticks) {
      NS.Sky.dayTime = ticks;
      ctx.source.send(T('commands.time.set', [String(ticks)]));
      return wrapDay(ticks);
    };
    var addTime = function (ctx, ticks) {
      NS.Sky.dayTime += ticks;
      var v = wrapDay(NS.Sky.dayTime);
      ctx.source.send(T('commands.time.set', [String(v)]));
      return v;
    };
    var timeSet = lit('set');
    for (var pk in PRESET) {
      timeSet.then((function (k, v) {
        return lit(k).executes(function (c) { return setTime(c, v); });
      })(pk, PRESET[pk]));
    }
    timeSet.then(arg('time', M.time(0)).executes(function (c) { return setTime(c, get(c, 'time')); }));
    d.register(lit('time').requires(perm(2))
      .then(timeSet)
      .then(lit('add').then(arg('time', M.time(0)).executes(function (c) { return addTime(c, get(c, 'time')); })))
      .then(lit('query')
        .then(lit('daytime').executes(function (c) {
          var v = ((NS.Sky.dayTime % 24000) + 24000) % 24000;
          c.source.send(T('commands.time.query', [String(v)])); return v;
        }))
        .then(lit('gametime').executes(function (c) {
          // ⚠⚠ `gametime` IS `World.getTime()`, NOT `getTimeOfDay()` (.decomp World.java:707-712;
          // ServerWorld.java:361-370 increments `properties.time` EVERY tick unconditionally,
          // while `properties.timeOfDay` only advances under the `doDaylightCycle` gate a few
          // lines later). `NS.Sky.dayTime` is `timeOfDay` -- the SAME variable `/time set`/`add`
          // mutate and `doDaylightCycle=false` freezes. Reading it here made `gametime` jump
          // whenever `/time set` ran and stop whenever the daylight cycle was off, neither of
          // which vanilla does: `Main.ticks` (17_main.js) is this engine's unconditional
          // once-per-sim-tick counter and is the actual analogue of `World.getTime()`.
          var v = (NS.Main && NS.Main.ticks | 0) % 2147483647;
          c.source.send(T('commands.time.query', [String(v)])); return v;
        }))
        .then(lit('day').executes(function (c) {
          var v = Math.floor(NS.Sky.dayTime / 24000) % 2147483647;
          c.source.send(T('commands.time.query', [String(v)])); return v;
        }))));

    // ── /weather (clear|rain|thunder) [duration] ───────────────────────────────────────────
    // ⚠⚠ THE DEFAULT DURATION IS A FLAT, ROUND `6000` TICKS (.decomp WeatherCommand.java:9,15,
    // 24,32 -- `DEFAULT_DURATION = 6000`, passed straight to each `executeX`). There is no random
    // draw from `Sky.CLEAR_RANGE`/`RAIN_RANGE` anywhere in `WeatherCommand`; that range only
    // feeds the WEATHER CYCLE's own natural roll (`Sky.tickWeather`'s `between()`, once the
    // command's fixed timer runs out), a fact this file's own prior version of this comment got
    // backwards and then implemented backwards to match.
    // ⚠⚠ `<duration>` IS SECONDS, A PLAIN BOUNDED INTEGER (`IntegerArgumentType.integer(0,
    // 1000000)`), NOT A `minecraft:time` ARGUMENT — vanilla multiplies it by 20 itself
    // (`...*20` at every one of the three call sites) and accepts no `d`/`s`/`t` suffix at all.
    // `/weather rain 5` is 5 SECONDS (100 ticks); parsed as a bare `minecraft:time` value it was
    // silently 5 TICKS instead, and any duration over 1000000 seconds that vanilla refuses went
    // through unbounded.
    // ⚠ `setWeather(clearTime, $$1, raining, thundering)` (.decomp ServerWorld.java:250-254)
    // REUSES THE SAME `$$1` FOR BOTH `rainTime` AND `thunderTime`, on `/weather rain` as much as
    // `/weather thunder` — and `/weather clear` zeroes both, not just the flags. A version that
    // only ever touched the timer matching the flag it was setting left the other one stale.
    var weather = function (ctx, kind, ticks) {
      var Sk = NS.Sky;
      if (!Sk.weather) Sk.weather = Sk.newWeather();
      var wx = Sk.weather;
      if (kind === 'clear') {
        wx.clearTime = ticks; wx.rainTime = 0; wx.thunderTime = 0;
        wx.raining = false; wx.thundering = false;
        ctx.source.send(T('commands.weather.set.clear'));
      } else if (kind === 'rain') {
        wx.clearTime = 0; wx.rainTime = ticks; wx.thunderTime = ticks;
        wx.raining = true; wx.thundering = false;
        ctx.source.send(T('commands.weather.set.rain'));
      } else {
        wx.clearTime = 0; wx.rainTime = ticks; wx.thunderTime = ticks;
        wx.raining = true; wx.thundering = true;
        ctx.source.send(T('commands.weather.set.thunder'));
      }
      return ticks;
    };
    var wcmd = lit('weather').requires(perm(2));
    ['clear', 'rain', 'thunder'].forEach(function (k) {
      wcmd.then(lit(k).executes(function (c) { return weather(c, k, 6000); })
        .then(arg('duration', B.integer(0, 1000000)).executes(function (c) {
          return weather(c, k, get(c, 'duration') * 20);
        })));
    });
    d.register(wcmd);

    // ── /teleport, with /tp as a REDIRECT (which is what vanilla does) ─────────────────────
    // ⚠ TeleportCommand.teleport (.decomp TeleportCommand.java ~line 253) only clears the
    // VERTICAL component of velocity -- `setVelocity(getVelocity().multiply(1.0, 0.0, 1.0))`,
    // x and z multipliers are 1.0 -- and sets `onGround = true`; it does NOT zero horizontal
    // velocity, and it skips even the vertical clear when the entity `isFallFlying()` (elytra
    // gliding, which this project has not implemented, so that branch is always taken here). A
    // version that zeroed vx/vy/vz unconditionally stopped a projectile or a thrown/falling
    // entity dead in its horizontal track on every teleport, which vanilla never does.
    // ⚠ `rot`, WHEN GIVEN, IS THE ONLY THING THAT CHANGES THE TARGET'S FACING HERE. Vanilla's own
    // location-form `execute` (.decomp TeleportCommand.java ~189-229) reuses the TARGET's own
    // `getYaw()`/`getPitch()` when no `<rotation>` was typed -- i.e. leaves rotation alone -- and
    // only the caller that actually parsed a `<rotation>` argument supplies a real one.
    var tpTo = function (ctx, targets, p, rot) {
      var to = C.pos(p, ctx.source);
      for (var i = 0; i < targets.length; i++) {
        var e = targets[i].e;
        e.x = to.x; e.y = to.y; e.z = to.z;
        if (e.vy !== undefined) { e.vy = 0; }
        if (e.onGround !== undefined) e.onGround = true;
        if (rot) { e.yaw = rot.yaw; e.pitch = rot.pitch; }
      }
      var fmt = function (v) { return (Math.round(v * 100) / 100).toFixed(2); };
      if (targets.length === 1) {
        ctx.source.send(T('commands.teleport.success.location.single',
          [targets[0].name || ctx.source.name, fmt(to.x), fmt(to.y), fmt(to.z)]));
      } else {
        ctx.source.send(T('commands.teleport.success.location.multiple',
          [targets.length + '', fmt(to.x), fmt(to.y), fmt(to.z)]));
      }
      return targets.length;
    };
    // ⚠⚠ THE ENTITY-DESTINATION FORM MOVES *AND* TURNS THE TARGET. TeleportCommand's own
    // entity-destination `execute` (.decomp TeleportCommand.java ~162-186) reads the
    // DESTINATION's `getYaw()`/`getPitch()` and feeds them into the same `teleport()` the
    // location form uses -- landing on another entity copies its facing too, not just its
    // position, unlike the `<location>` form above. `commands.teleport.success.entity.single` /
    // `.multiple` are vanilla's own strings ("Teleported %s to %s" / "Teleported %s entities to
    // %s") -- confirmed already present in the packed `en_us.json` (`assets/lang.bin` ships the
    // WHOLE file, per tools/pack-lang.mjs; checked directly by inflating it, not assumed), so no
    // `assets/lang-overrides.json` entry was needed after all.
    var tpToEntity = function (ctx, targets, dest) {
      var de = dest.e;
      for (var i = 0; i < targets.length; i++) {
        var e = targets[i].e;
        e.x = de.x; e.y = de.y; e.z = de.z;
        if (de.yaw !== undefined) e.yaw = de.yaw;
        if (de.pitch !== undefined) e.pitch = de.pitch;
        if (e.vy !== undefined) { e.vy = 0; }
        if (e.onGround !== undefined) e.onGround = true;
      }
      if (targets.length === 1) {
        ctx.source.send(T('commands.teleport.success.entity.single',
          [targets[0].name || ctx.source.name, dest.name || 'entity']));
      } else {
        ctx.source.send(T('commands.teleport.success.entity.multiple',
          [targets.length + '', dest.name || 'entity']));
      }
      return targets.length;
    };
    var teleport = d.register(lit('teleport').requires(perm(2))
      .then(arg('location', M.vec3(false)).executes(function (c) {
        // ⚠⚠ `/teleport <location>`, WITH NO `<targets>`, TARGETS THE SOURCE'S OWN
        // ENTITY — vanilla's `TeleportCommand.register` passes
        // `getSource().getEntityOrThrow()`, not a hardcoded player. Without `C.selfTarget` here,
        // `/execute as <mob> run tp ~ ~10 ~` silently moved the PLAYER instead of the mob `as`
        // just rebound to, because this branch never looked at `c.source.entity` at all.
        var self = C.selfTarget(c.source);
        return tpTo(c, self ? [self] : [], get(c, 'location'));
      }))
      .then(arg('destination', M.entity(true, false)).executes(function (c) {
        // ⚠ `/teleport <destination>` SELF-TARGETS THE SAME WAY THE LITERAL-LOCATION BRANCH
        // ABOVE DOES — `C.selfTarget`, not a hardcoded player, so `/execute as <mob> run tp
        // <entity>` moves the mob `as` rebound to (.decomp TeleportCommand.java `register()`,
        // the two-argument "tp <destination>" node is built the exact same way as "tp
        // <location>").
        var self = C.selfTarget(c.source);
        return tpToEntity(c, self ? [self] : [], C.one(get(c, 'destination'), c.source));
      }))
      .then(arg('targets', M.entity(false, false))
        .then(arg('location', M.vec3(false))
          .executes(function (c) {
            return tpTo(c, C.resolve(get(c, 'targets'), c.source), get(c, 'location'));
          })
          .then(arg('rotation', M.rotation()).executes(function (c) {
            // ⚠ ROTATION `~` IS RELATIVE TO THE COMMAND SOURCE, NOT THE TARGET BEING
            // TELEPORTED -- `C.rot`, the same convention `/execute rotated <yaw> <pitch>`
            // already implements further down in this file, both built on `M.coordValue`
            // (vanilla's own `minecraft:rotation` half) rather than a second relative-number
            // parser.
            var rot = C.rot(get(c, 'rotation'), c.source);
            return tpTo(c, C.resolve(get(c, 'targets'), c.source), get(c, 'location'), rot);
          })))
        .then(arg('destination', M.entity(true, false)).executes(function (c) {
          return tpToEntity(c, C.resolve(get(c, 'targets'), c.source), C.one(get(c, 'destination'), c.source));
        }))));
    d.register(lit('tp').requires(perm(2)).redirect(teleport));
    // ── /kill [targets] ────────────────────────────────────────────────────────────────────
    // ⚠⚠ `/kill` IS A DAMAGE-KILL, NOT A SILENT REMOVE (for anything LIVING). `Entity.kill()`
    // (.decomp Entity.java:316) is a bare `this.remove(RemovalReason.KILLED)` -- but
    // `LivingEntity` OVERRIDES it (.decomp LivingEntity.java:265): `this.damage(DamageSource.
    // OUT_OF_WORLD, Float.MAX_VALUE)`, the REAL damage pipeline. `OUT_OF_WORLD` bypasses armour
    // (.decomp DamageSource.java:29) but is still an ordinary lethal hit once it lands: the mob
    // goes through `Cb.tickEntity`'s own `e.dead` branch same as any other kill -- loot table
    // drops, `Xp.dropMobXp`, the death animation/sound all fire, `EL.remove` only runs
    // `Cb.DEATH_TICKS` (20) ticks later. Every mob here has `e.maxHealth > 0` (`Cb.canAttack`'s
    // own D-336 gate, the SAME "is it a LivingEntity" test); a non-living entity (no
    // `maxHealth`, e.g. anything `Ai.ROSTER`/`Ent.attrsOf` has no row for) has no `LivingEntity.
    // kill()` override and correctly falls through to the bare `EL.remove` below, unchanged.
    // No attacker means `Cb.killedByPlayer` reads false (it gates on the recent-player-hit
    // window, not this call's own `byPlayer` flag) -- exactly OUT_OF_WORLD having no attacker.
    var kill = function (ctx, targets) {
      var Sv = NS.Survival, EL = NS.EntityList, Cb = NS.Combat;
      for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        if (t.kind === 'player') { if (Sv) Sv.hurt(t.e, 'outOfWorld', 1e9); }
        else if (t.e && t.e.maxHealth > 0 && Cb && Cb.hurt) {
          Cb.hurt(t.e, 1e9, undefined, false, { bypassArmor: true, source: 'outOfWorld' });
          if (!t.e.dead && EL) EL.remove(t.e);   // Cb.canAttack already refused (e.g. mid death-animation) — finish the removal directly
        }
        else if (EL) EL.remove(t.e);
      }
      if (targets.length === 1) ctx.source.send(T('commands.kill.success.single', [targets[0].name || 'entity']));
      else ctx.source.send(T('commands.kill.success.multiple', [targets.length + '']));
      return targets.length;
    };
    d.register(lit('kill').requires(perm(2))
      // ⚠ THE SAME BUG, THE SAME FIX: `/kill` with no `<targets>` kills the SOURCE's own
      // entity, not literally `NS.Player` — `execute as <mob> run kill` must kill the mob.
      .executes(function (c) { var self = C.selfTarget(c.source); return kill(c, self ? [self] : []); })
      .then(arg('targets', M.entity(false, false)).executes(function (c) {
        return kill(c, C.resolve(get(c, 'targets'), c.source));
      })));

    // ── /seed ──────────────────────────────────────────────────────────────────────────────
    d.register(lit('seed').requires(perm(2)).executes(function (c) {
      var seed = (NS.Main && NS.Main.seed64 !== undefined) ? NS.Main.seed64 : 0;
      c.source.send(T('commands.seed.success', [String(seed)]));
      return 1;
    }));

    // ── /summon <entity> [pos] ─────────────────────────────────────────────────────────────
    var summon = function (ctx, at, nbt) {
      var EL = NS.EntityList;
      var type = get(ctx, 'entity');
      if (!EL || !EL.spawn) throw new B.Err('commands.summon.failed', [], -1, null);
      var e = EL.spawn(type, at.x, at.y, at.z);
      if (!e) throw new B.Err('commands.summon.failed', [], -1, null);
      if (nbt) C.applyNbt(e, nbt);
      ctx.source.send(T('commands.summon.success', [T('entity.minecraft.' + type)]));
      return 1;
    };
    d.register(lit('summon').requires(perm(2))
      .then(arg('entity', M.entityType()).executes(function (c) {
        return summon(c, { x: c.source.x, y: c.source.y, z: c.source.z });
      })
        .then(arg('pos', M.vec3(false)).executes(function (c) {
          return summon(c, C.pos(get(c, 'pos'), c.source));
        })
          .then(arg('nbt', M.nbtCompound()).executes(function (c) {
            return summon(c, C.pos(get(c, 'pos'), c.source), get(c, 'nbt'));
          })))));

    // ── /data get entity <target> [<path>] ─────────────────────────────────────────────────
    // ponytail: path = dotted keys and [n] indexes only (no filters `{k:v}`), get only (no merge/modify/remove).
    var dataGet = function (ctx) {
      var t = C.one(get(ctx, 'target'), ctx.source);
      var v = C.entityNbt(t), path = '';
      try { path = get(ctx, 'path'); } catch (x) { path = ''; }
      if (path) {
        var parts = path.match(/[^.\[\]]+|\[\d+\]/g) || [];
        for (var i = 0; i < parts.length && v !== undefined && v !== null; i++) {
          v = /^\[/.test(parts[i]) ? (Array.isArray(v) ? v[parseInt(parts[i].slice(1), 10)] : undefined) : v[parts[i]];
        }
        if (v === undefined) throw new B.Err('arguments.nbtpath.nothing_found', [path], -1, null);
      }
      ctx.source.send(T('commands.data.entity.query', [t.name || 'entity', snbtStr(v)]));
      return 1;
    };
    d.register(lit('data').requires(perm(2))
      .then(lit('get').then(lit('entity').then(arg('target', M.entity(true, false)).executes(dataGet)
        .then(arg('path', B.greedy ? B.greedy() : B.string()).executes(dataGet))))));

    // ── /item replace entity <targets> <slot> with <item> [<count>] ────────────────────────
    var itemReplace = function (ctx, count) {
      var targets = C.resolve(get(ctx, 'targets'), ctx.source), slot = get(ctx, 'slot'), done = [];
      var st = NS.Inventory.stack(get(ctx, 'item'), count, 0, null);
      for (var i = 0; i < targets.length; i++) {
        var ref = C.stackRef(targets[i], slot);
        if (ref) { ref.set(NS.Inventory.copy(st)); done.push(targets[i]); }
      }
      if (!done.length) throw new B.Err('commands.item.target.no_such_slot', [String(slot)], -1, null);
      if (done[0].kind === 'player' && NS.Player && NS.Player.syncHotbar) NS.Player.syncHotbar();
      var nm = T('item.minecraft.' + NS.Items.nameOf(st.i));
      ctx.source.send(done.length === 1 ? T('commands.item.entity.set.success.single', [done[0].name || 'entity', nm])
                                        : T('commands.item.entity.set.success.multiple', [String(done.length), nm]));
      return done.length;
    };
    d.register(lit('item').requires(perm(2))
      .then(lit('replace').then(lit('entity').then(arg('targets', M.entity(false, false))
        .then(arg('slot', M.slot()).then(lit('with').then(arg('item', M.item())
          .executes(function (c) { return itemReplace(c, 1); })
          .then(arg('count', B.integer(1, 64)).executes(function (c) { return itemReplace(c, get(c, 'count')); })))))))));

    // ── /setblock <pos> <block> [replace|destroy|keep] ─────────────────────────────────────
    // ⚠ THE THREE MODES ARE DIFFERENT AND THE DEFAULT IS `replace`. `keep` refuses to touch a
    // non-air block and `destroy` drops the old one; a version with only `replace` looks right
    // until somebody builds with `keep`.
    var setblock = function (ctx, mode) {
      var W = NS.World;
      var p = C.pos(get(ctx, 'pos'), ctx.source);
      var x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
      var st = get(ctx, 'block');
      var old = W.getBlock(x, y, z);
      if (mode === 'keep' && old !== 0) throw new B.Err('commands.setblock.failed', [], -1, null);
      if (mode === 'destroy' && old !== 0 && NS.Loot && NS.Loot.ready && NS.Player) {
        // `world.breakBlock(pos, true)` (.decomp SetBlockCommand:92): no entity, no tool, no harvest
        // gate — so `Loot.drops`, not the player's `breakDrops`; `noEntity` makes snow drop nothing.
        var drops = NS.Loot.drops({ state: old, noEntity: true });
        // ⚠ AT THE BLOCK, NOT AT THE PLAYER (D-333). Drops are item ENTITIES now, so where they
        // are born matters: `/setblock ~ ~ ~50 air destroy` must leave them fifty blocks up.
        if (drops && drops.length && NS.Player.collectDrops) NS.Player.collectDrops(drops, x, y, z);
      }
      // ⚠ `Clearable.clear(blockEntity)` RUNS BEFORE THE NEW STATE GOES IN, for every mode but
      // `destroy` (.decomp `SetBlockCommand.execute`) -- vanilla discards a chest's contents
      // even when the replacement block is the SAME container type, because a `BlockEntity`
      // whose type doesn't change is otherwise left attached with its old inventory. `BE.onChanged`
      // (07c_blockentity.js) only recreates the entity when the TYPE differs, so without this a
      // same-type `/setblock ... replace` would silently keep the old contents.
      if (mode !== 'destroy' && NS.BlockEntities && NS.BlockEntities.ready && NS.BlockEntities.get(x, y, z)) {
        NS.BlockEntities.remove(x, y, z);
      }
      // ⚠ THE RETURN VALUE MATTERS (.decomp: a failed `setBlockState` throws `FAILED_EXCEPTION`
      // instead of reporting success). `W.setBlock` already returns `false` for exactly the cases
      // vanilla fails this command on -- an unloaded/ungenerated chunk, or a state that cannot
      // survive at that position -- so ignoring it was a silent "success" on a no-op placement.
      // ⚠ AN UNCHANGED STATE IS A FAILURE TOO: `ServerWorld.setBlockState` returns false when the new
      // state equals the old one. `destroy` breaks the old block first (so it is air by then), and
      // when both are air it skips the write yet still reports success (SetBlockCommand $6).
      // `destroy`'s `breakBlock` already turned the old block into air (SetBlockCommand:92-100: the
      // write is skipped when both the new state and the broken-out world block are air).
      var was = (mode === 'destroy') ? 0 : old;
      if (mode === 'destroy' && old !== 0) { W.setBlock(x, y, z, 0); }
      if (mode === 'destroy' && st === 0) { /* skipped write, still success */ }
      else if (was === st || !W.setBlock(x, y, z, st)) throw new B.Err('commands.setblock.failed', [], -1, null);
      ctx.source.send(T('commands.setblock.success', [String(x), String(y), String(z)]));
      return 1;
    };
    var sbModes = ['replace', 'destroy', 'keep'];
    var sbNode = arg('block', M.blockState()).executes(function (c) { return setblock(c, 'replace'); });
    sbModes.forEach(function (mo) {
      sbNode.then(lit(mo).executes(function (c) { return setblock(c, mo); }));
    });
    d.register(lit('setblock').requires(perm(2)).then(arg('pos', M.vec3(true)).then(sbNode)));

    // ── /fill <from> <to> <block> [replace|destroy|keep|hollow|outline] ────────────────────
    // ⚠ VANILLA CAPS A FILL AT 32,768 BLOCKS and says so with its own message. Without the cap a
    // mistyped coordinate locks the tab for a minute and looks like a crash.
    C.FILL_LIMIT = 32768;
    // ⚠ FillCommand.execute: `Clearable.clear(world.getBlockEntity(pos))` BEFORE every write, all modes (#511);
    // BE.onChanged only recreates on a TYPE change, so a same-type fill would keep the old inventory.
    var fillClear = function (x, y, z) {
      if (NS.BlockEntities && NS.BlockEntities.ready && NS.BlockEntities.get(x, y, z)) NS.BlockEntities.remove(x, y, z);
    };
    var fill = function (ctx, mode, filter) {
      var W = NS.World;
      var a = C.pos(get(ctx, 'from'), ctx.source), b2 = C.pos(get(ctx, 'to'), ctx.source);
      var x0 = Math.min(Math.floor(a.x), Math.floor(b2.x)), x1 = Math.max(Math.floor(a.x), Math.floor(b2.x));
      var y0 = Math.min(Math.floor(a.y), Math.floor(b2.y)), y1 = Math.max(Math.floor(a.y), Math.floor(b2.y));
      var z0 = Math.min(Math.floor(a.z), Math.floor(b2.z)), z1 = Math.max(Math.floor(a.z), Math.floor(b2.z));
      var n = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1);
      if (n > C.FILL_LIMIT) {
        throw new B.Err('commands.fill.toobig', [String(C.FILL_LIMIT), String(n)], -1, null);
      }
      var st = get(ctx, 'block'), done = 0;
      for (var x = x0; x <= x1; x++) for (var y = y0; y <= y1; y++) for (var z = z0; z <= z1; z++) {
        var edge = (x === x0 || x === x1 || y === y0 || y === y1 || z === z0 || z === z1);
        if ((mode === 'hollow' || mode === 'outline') && !edge) {
          if (mode === 'hollow' && W.getBlock(x, y, z) !== 0) { fillClear(x, y, z); if (W.setBlock(x, y, z, 0)) done++; }
          continue;
        }
        if (mode === 'keep' && W.getBlock(x, y, z) !== 0) continue;
        if (filter && !filter(W.getBlock(x, y, z))) continue;   // `replace <filter>`
        // ⚠ D-XXX: `destroy` ACTUALLY BREAKS EACH BLOCK IT REPLACES (`.decomp` FillCommand.Mode
        // field_13651 calls `world.breakBlock(pos, true)` per cell -- the SAME drop path
        // `/setblock ... destroy` already uses above). A version that treated `destroy` as a
        // second name for `replace` silently ate every block's drops over the whole volume.
        var fOld = W.getBlock(x, y, z);
        if (mode === 'destroy') {
          if (fOld !== 0 && NS.Loot && NS.Loot.ready && NS.Player) {
            var fDrops = NS.Loot.drops({ state: fOld, noEntity: true });   // FillCommand:217, as /setblock above
            if (fDrops && fDrops.length && NS.Player.collectDrops) NS.Player.collectDrops(fDrops, x, y, z);
          }
        }
        // ⚠ ONLY A POSITION THAT CHANGED COUNTS (FillCommand.execute: `setBlockState` false -> not added)
        fillClear(x, y, z);
        if ((mode === 'destroy' ? 0 : fOld) === st) continue;
        if (W.setBlock(x, y, z, st)) done++;
      }
      if (!done) throw new B.Err('commands.fill.failed', [], -1, null);
      ctx.source.send(T('commands.fill.success', [String(done)]));
      return done;
    };
    var fillModes = ['replace', 'destroy', 'keep', 'hollow', 'outline'];
    var fillNode = arg('block', M.blockState()).executes(function (c) { return fill(c, 'replace'); });
    fillModes.forEach(function (mo) {
      var mn = lit(mo).executes(function (c) { return fill(c, mo); });
      if (mo === 'replace') mn.then(arg('filter', M.blockPredicate()).executes(function (c) { return fill(c, 'replace', get(c, 'filter')); }));
      fillNode.then(mn);
    });
    d.register(lit('fill').requires(perm(2))
      .then(arg('from', M.vec3(true)).then(arg('to', M.vec3(true)).then(fillNode))));

    // ── /clear [targets] [item] [maxCount] ─────────────────────────────────────────────────
    var clear = function (ctx, item, max) {
      var Iv = NS.Inventory, IT = NS.Items;
      var sel = get(ctx, 'targets');
      var targets = sel ? C.resolve(sel, ctx.source)
                        : [{ kind: 'player', e: NS.Player, name: ctx.source.name }];
      // ⚠ `max === 0` IS VANILLA'S DRY RUN (`PlayerInventory.remove`'s own
      // `removeAll = (count == 0)`, `Inventories.remove`) — every matching stack is COUNTED,
      // never decremented, and reported through `commands.clear.test.*`, not `.success.*`.
      var testMode = (max === 0);
      var removed = 0;
      for (var t = 0; t < targets.length; t++) {
        if (targets[t].kind !== 'player') continue;
        var inv = targets[t].e.inventory;
        for (var i = 0; i < Iv.SIZE; i++) {
          var st = Iv.getItem(inv, i);
          if (Iv.isEmpty(st)) continue;
          if (item >= 0 && st.i !== item) continue;
          if (testMode) { removed += st.n; continue; }
          var take = (max < 0) ? st.n : Math.min(st.n, max - removed);
          if (take <= 0) continue;
          Iv.removeItem(inv, i, take);
          removed += take;
          if (max >= 0 && removed >= max) break;
        }
      }
      // ⚠ ZERO MATCHED IS A FAILURE, not a quiet "Removed 0 items" success — vanilla's
      // `ClearCommand.execute` throws `clear.failed.single`/`.multiple` whenever nothing
      // matched, in EITHER mode (dry run included).
      if (removed === 0) {
        if (targets.length === 1) throw new B.Err('clear.failed.single', [targets[0].name || ctx.source.name], -1, null);
        throw new B.Err('clear.failed.multiple', [String(targets.length)], -1, null);
      }
      if (testMode) {
        if (targets.length === 1) ctx.source.send(T('commands.clear.test.single', [String(removed), targets[0].name || ctx.source.name]));
        else ctx.source.send(T('commands.clear.test.multiple', [String(removed), String(targets.length)]));
      } else if (targets.length === 1) {
        ctx.source.send(T('commands.clear.success.single', [String(removed), targets[0].name || ctx.source.name]));
      } else {
        ctx.source.send(T('commands.clear.success.multiple', [String(removed), String(targets.length)]));
      }
      if (NS.Player && NS.Player.syncHotbar) NS.Player.syncHotbar();
      return removed;
    };
    d.register(lit('clear').requires(perm(2))
      .executes(function (c) { return clear(c, -1, -1); })
      .then(arg('targets', M.entity(false, true)).executes(function (c) { return clear(c, -1, -1); })
        .then(arg('item', M.item()).executes(function (c) { return clear(c, get(c, 'item'), -1); })
          .then(arg('maxCount', B.integer(0)).executes(function (c) {
            return clear(c, get(c, 'item'), get(c, 'maxCount'));
          })))));

    // ── /experience (add|set|query) <targets> [amount] [points|levels], alias /xp ───────────
    // ⚠ POINTS AND LEVELS ARE NOT THE SAME NUMBER and the default is POINTS. `Survival.xpNeeded`
    // is not linear — level 16 costs 42 points and level 31 costs 112 — so "set 30 levels" and
    // "set 30 points" differ by more than a factor of a hundred.
    var xpOf = function (t) { return t.e.xpTotal || 0; };
    var xpReport = function (ctx, targets, verb, unit, amount) {
      var one = targets.length === 1;
      var key = 'commands.experience.' + verb + '.' + unit + '.success.' + (one ? 'single' : 'multiple');
      ctx.source.send(T(key, [String(amount), one ? (targets[0].name || ctx.source.name) : String(targets.length)]));
    };
    var xpApply = function (ctx, verb, unit) {
      var Sv = NS.Survival;
      var targets = C.resolve(get(ctx, 'targets'), ctx.source)
        .filter(function (t) { return t.kind === 'player'; });
      if (!targets.length) throw new B.Err('argument.entity.notfound.player', [], -1, null);
      var amount = get(ctx, 'amount');
      var done = 0;
      for (var i = 0; i < targets.length; i++) {
        var e = targets[i].e;
        if (verb === 'set' && unit === 'points' && amount >= Sv.xpNeeded(e.xpLevel || 0)) continue;
        if (unit === 'levels') {
          Sv.setLevelKeepBar(e, (verb === 'add' ? (e.xpLevel || 0) : 0) + amount);
        } else if (verb === 'add') {
          Sv.addXp(e, amount);
        } else {
          // ServerPlayerEntity.setExperiencePoints: only the bar moves, clamped to (need-1)/need
          var need = Sv.xpNeeded(e.xpLevel || 0);
          e.xpProgress = Math.max(0, Math.min(amount / need, (need - 1) / need));
          e.xpTotal = Sv.totalXpFor(e.xpLevel || 0) + Math.floor(e.xpProgress * need);
          done++;
        }
      }
      if (verb === 'set' && unit === 'points' && !done) throw new B.Err('commands.experience.set.points.invalid', [], -1, null);
      xpReport(ctx, targets, verb, unit, amount);
      return targets.length;
    };
    var xpQuery = function (ctx, unit) {
      var targets = C.resolve(get(ctx, 'targets'), ctx.source)
        .filter(function (t) { return t.kind === 'player'; });
      if (!targets.length) throw new B.Err('argument.entity.notfound.player', [], -1, null);
      var Sv = NS.Survival, e = targets[0].e;
      var v = unit === 'levels' ? (e.xpLevel || 0) : Math.floor((e.xpProgress || 0) * Sv.xpNeeded(e.xpLevel || 0));
      ctx.source.send(T('commands.experience.query.' + unit,
        [targets[0].name || ctx.source.name, String(v)]));
      return v;
    };
    var xpVerb = function (verb) {
      var node = arg('targets', M.entity(false, true))
        .then(arg('amount', B.integer(verb === 'set' ? 0 : undefined)).executes(function (c) { return xpApply(c, verb, 'points'); })
          .then(lit('points').executes(function (c) { return xpApply(c, verb, 'points'); }))
          .then(lit('levels').executes(function (c) { return xpApply(c, verb, 'levels'); })));
      return lit(verb).then(node);
    };
    var experience = d.register(lit('experience').requires(perm(2))
      .then(xpVerb('add'))
      .then(xpVerb('set'))
      .then(lit('query').then(arg('targets', M.entity(true, true))
        .then(lit('points').executes(function (c) { return xpQuery(c, 'points'); }))
        .then(lit('levels').executes(function (c) { return xpQuery(c, 'levels'); })))));
    d.register(lit('xp').requires(perm(2)).redirect(experience));

    // ── /defaultgamemode <mode> ────────────────────────────────────────────────────────────
    C.defaultGameMode = 0;
    C.forcedGameMode = null;   // server.properties force-gamemode (off by default)
    d.register(lit('defaultgamemode').requires(perm(2))
      .then(arg('mode', M.gameMode()).executes(function (c) {
        C.defaultGameMode = get(c, 'mode');
        var Gm = NS.Gamemode;
        // getForcedGameMode is null unless force-gamemode is set; then every online player is changed
        var changed = 0;
        if (C.forcedGameMode != null && NS.Player && NS.Player.mode !== C.defaultGameMode) {
          Gm.set(NS.Player, C.defaultGameMode); changed++;
        }
        c.source.send(T('commands.defaultgamemode.success',
          [T('gameMode.' + (Gm.NAMES ? Gm.NAMES[C.defaultGameMode] : C.defaultGameMode))]));
        return changed;
      })));

    // ── /difficulty [peaceful|easy|normal|hard] (DifficultyCommand, level 2) ───────────────
    var diffName = function (l) { return T('options.difficulty.' + l); };
    var dcmd = lit('difficulty').requires(perm(2)).executes(function (c) {
      var cur = NS.Diff.get();
      c.source.send(T('commands.difficulty.query', [diffName(cur)]));
      return NS.Diff.LEVELS.indexOf(cur);
    });
    ['peaceful', 'easy', 'normal', 'hard'].forEach(function (l) {
      dcmd.then(lit(l).executes(function (c) {
        if (NS.Diff.get() === l) throw B.err('commands.difficulty.failure', [diffName(l)]);
        NS.Diff.set(l);
        c.source.send(T('commands.difficulty.success', [diffName(l)]));
        return 0;
      }));
    });
    d.register(dcmd);

    // ── /say, /me, /msg (+ /tell, /w) ──────────────────────────────────────────────────────
    // ⚠ THREE DIFFERENT FORMATS AND ALL THREE ARE LANG KEYS: `chat.type.announcement` is
    // `[%s] %s`, `chat.type.emote` is `* %s %s`, and a whisper has one wording for the sender and
    // another for the receiver. Building any of them with string concatenation is the thing the
    // translatable form exists to prevent.
    var toChat = function (component) {
      if (NS.Chat && NS.Chat.add) NS.Chat.add(component);
    };
    d.register(lit('say').requires(perm(2))
      .then(arg('message', B.greedy()).executes(function (c) {
        toChat(NS.Text.translatable('chat.type.announcement', [c.source.displayName, get(c, 'message')]));
        return 1;
      })));
    d.register(lit('me')
      .then(arg('action', B.greedy()).executes(function (c) {
        toChat(NS.Text.translatable('chat.type.emote', [c.source.displayName, get(c, 'action')]));
        return 1;
      })));
    // ⚠ WHISPERS ARE GRAY+ITALIC IN VANILLA (`.decomp` MessageCommand.execute: both the
    // outgoing and incoming `TranslatableText` are `.formatted(Formatting.GRAY, Formatting.ITALIC)`)
    // -- a whisper that reads identically to ordinary chat is a real, visible parity miss, not a
    // cosmetic nit: it is the one thing that tells a player "this was private." The INCOMING side
    // goes through `toChat`, a real component tree `drawRuns` colours and (once italic shear
    // lands) slants, so the style belongs there; `c.source.send` carries only flat strings
    // project-wide (every command's feedback line does, not just this one) so the OUTGOING side
    // cannot carry style without rebuilding that whole pipe -- out of this unit's scope, named so
    // it is not mistaken for "fixed."
    var WHISPER_STYLE = { color: 'gray', italic: true };
    var msg = d.register(lit('msg')
      .then(arg('targets', M.entity(false, true))
        .then(arg('message', B.greedy()).executes(function (c) {
          var targets = C.resolve(get(c, 'targets'), c.source);
          if (!targets.length) throw new B.Err('argument.entity.notfound.player', [], -1, null);
          var text = get(c, 'message');
          for (var i = 0; i < targets.length; i++) {
            toChat(NS.Text.translatable('commands.message.display.incoming', [c.source.displayName, text], WHISPER_STYLE));
          }
          c.source.send(T('commands.message.display.outgoing',
            [targets[0].name || 'Player', text]));
          return targets.length;
        }))));
    d.register(lit('tell').redirect(msg));
    d.register(lit('w').redirect(msg));

    // ── /playsound <sound> <source> [targets] [pos] [volume] [pitch] ───────────────────────
    var playsound = function (ctx, vol, pitch) {
      var Sn = NS.Sound;
      var ev = get(ctx, 'sound'), src = get(ctx, 'source');
      var sel = get(ctx, 'targets');
      var targets = sel ? C.resolve(sel, ctx.source)
                        : [{ kind: 'player', e: NS.Player, name: ctx.source.name }];
      if (!targets.length) throw new B.Err('argument.entity.notfound.player', [], -1, null);
      var at = get(ctx, 'pos');
      var p = at ? C.pos(at, ctx.source) : { x: ctx.source.x, y: ctx.source.y, z: ctx.source.z };
      var played = Sn.play(ev, { volume: vol, pitch: pitch, source: src,
        x: p.x, y: p.y, z: p.z, listener: { x: ctx.source.x, y: ctx.source.y, z: ctx.source.z } });
      if (!played) throw new B.Err('commands.playsound.failed', [], -1, null);
      if (targets.length === 1) {
        ctx.source.send(T('commands.playsound.success.single', [ev, targets[0].name || ctx.source.name]));
      } else {
        ctx.source.send(T('commands.playsound.success.multiple', [ev, String(targets.length)]));
      }
      return targets.length;
    };
    var SOURCES = (NS.Sound && NS.Sound.SOURCES) ? NS.Sound.SOURCES.slice() : ['master'];
    d.register(lit('playsound').requires(perm(2))
      .then(arg('sound', M.sound())
        .then(arg('source', M.oneOf(SOURCES))
          // ⚠ VANILLA'S `PlaySoundCommand.makeArgumentsForCategory` (.decomp) HANGS NO
          // `.executes()` OFF THE CATEGORY NODE ITSELF -- `targets` is not optional. The
          // pre-fix grammar here attached an extra default-to-self execute right after
          // `source`, so `/playsound <sound> <source>` with NO targets at all silently
          // succeeded (defaulting to self) instead of failing as an incomplete command,
          // the way vanilla's own grammar requires. Live-tested (session 150 worker 2).
          .then(arg('targets', M.entity(false, true))
            .executes(function (c) { return playsound(c, 1, 1); })
            .then(arg('pos', M.vec3(false))
              .executes(function (c) { return playsound(c, 1, 1); })
              .then(arg('volume', B.double(0))
                .executes(function (c) { return playsound(c, get(c, 'volume'), 1); })
                .then(arg('pitch', B.double(0, 2)).executes(function (c) {
                  return playsound(c, get(c, 'volume'), get(c, 'pitch'));
                }))))))));

    // ── /stopsound <targets> [source] [sound] ──────────────────────────────────────────────
    // ⚠ FOUR MESSAGES, ONE PER COMBINATION of "a source was named" and "a sound was named",
    // which is why the lang file has four keys for one command.
    d.register(lit('stopsound').requires(perm(2))
      .then(arg('targets', M.entity(false, true))
        .executes(function (c) {
          if (NS.Sound && NS.Sound.stopAll) NS.Sound.stopAll();
          c.source.send(T('commands.stopsound.success.sourceless.any'));
          return 1;
        })
        // ⚠ THE `*` LITERAL IS VANILLA'S OWN GRAMMAR (`StopSoundCommand.register`, `.decomp`),
        // not this engine's invention: "stop this one sound, on ANY source" has no source name
        // to hang the sub-argument off, so vanilla spells "no source" as a literal wildcard
        // rather than making the sound argument itself optional. Live-tested (session 146
        // worker 4): this whole branch, and the fourth lang key it drives
        // (`commands.stopsound.success.sourceless.sound`), did not exist at all before this —
        // `/stopsound @s * <sound>` was a hard parse failure, `argument.id.invalid`, even though
        // the comment two lines above already claimed "FOUR MESSAGES".
        .then(lit('*').then(arg('sound', M.sound()).executes(function (c) {
          if (NS.Sound && NS.Sound.stopAll) NS.Sound.stopAll(null, get(c, 'sound'));
          c.source.send(T('commands.stopsound.success.sourceless.sound', [get(c, 'sound')]));
          return 1;
        })))
        .then(arg('source', M.oneOf(SOURCES))
          .executes(function (c) {
            if (NS.Sound && NS.Sound.stopAll) NS.Sound.stopAll(get(c, 'source'));
            c.source.send(T('commands.stopsound.success.source.any', [get(c, 'source')]));
            return 1;
          })
          .then(arg('sound', M.sound()).executes(function (c) {
            // ⚠ THE SOUND ARGUMENT HAS TO REACH `stopAll`, NOT JUST THE MESSAGE. Live-tested,
            // session 146 worker 4: the pre-fix call was `stopAll(get(c, 'source'))` with the
            // sound name used only in the feedback text — naming a specific sound stopped
            // every sound on that source, silently broader than what the command just said it did.
            if (NS.Sound && NS.Sound.stopAll) NS.Sound.stopAll(get(c, 'source'), get(c, 'sound'));
            c.source.send(T('commands.stopsound.success.source.sound',
              [get(c, 'sound'), get(c, 'source')]));
            return 1;
          })))));

    // ── /spawnpoint and /setworldspawn ─────────────────────────────────────────────────────
    C.worldSpawn = null;
    var fmtPos = function (p) { return [String(Math.floor(p.x)), String(Math.floor(p.y)), String(Math.floor(p.z))]; };
    d.register(lit('spawnpoint').requires(perm(2))
      .executes(function (c) { return C.setSpawn(c, null, null, null); })
      .then(arg('targets', M.entity(false, true))
        .executes(function (c) { return C.setSpawn(c, get(c, 'targets'), null, null); })
        .then(arg('pos', M.vec3(true))
          .executes(function (c) {
            return C.setSpawn(c, get(c, 'targets'), get(c, 'pos'), null);
          })
          // ⚠ THE TRAILING `<angle>` (.decomp `SpawnPointCommand.register`): a fourth dispatcher
          // node past `<pos>`, absolute or `~`-relative to the SOURCE's own yaw. Without it
          // `/spawnpoint @s ~ ~ ~ 90` was a hard parse failure instead of setting a facing.
          .then(arg('angle', M.angle()).executes(function (c) {
            return C.setSpawn(c, get(c, 'targets'), get(c, 'pos'), get(c, 'angle'));
          })))));
    d.register(lit('setworldspawn').requires(perm(2))
      .executes(function (c) { return C.setWorldSpawn(c, null, null); })
      .then(arg('pos', M.vec3(true))
        .executes(function (c) { return C.setWorldSpawn(c, get(c, 'pos'), null); })
        .then(arg('angle', M.angle()).executes(function (c) {
          return C.setWorldSpawn(c, get(c, 'pos'), get(c, 'angle'));
        }))));

    // ── /gamerule [rule] [value] ───────────────────────────────────────────────────────────
    // ⚠ THE ROSTER IS THE BYTECODE'S (D-319): 35 rules with their types and defaults, out of
    // `GameRules.<clinit>`. Three of them do something here — the day/night and weather clocks,
    // and (D-399, session 37) mobGriefing — and `Commands.RULES_LIVE` names exactly which, so a
    // rule that is stored and ignored says so instead of looking like it worked.
    C.ruleValues = C.ruleValues || Object.create(null);
    var ruleTable = (NS.DATA && NS.DATA.gameRules) || {};
    C.RULES_LIVE = {
      doDaylightCycle: 'Sky.daylightCycle', doWeatherCycle: 'Sky.weatherCycle',
      mobGriefing: 'Ai.BreakDoorGoal', disableRaids: 'RaidManager.startRaid/tick',
      naturalRegeneration: 'Survival.tick',
      doTileDrops: 'Silverfish.onBreak',   // loop/silverfish -- InfestedBlock.onStacksDropped's own gate
      fallDamage: 'Survival.hurt', drowningDamage: 'Survival.hurt', fireDamage: 'Survival.hurt',
      freezeDamage: 'Survival.hurt', randomTickSpeed: 'Behave.randomTickSection',
      showDeathMessages: 'Survival.die', spawnRadius: 'Survival.spawnScatter', doImmediateRespawn: 'Survival.tick',
      doInsomnia: 'Phantom.tickSpawner'   // loop/phantom -- PhantomSpawner.spawn's own gate
    };
    C.ruleGet = function (name) {
      if (C.ruleValues[name] !== undefined) return C.ruleValues[name];
      var r = ruleTable[name];
      return r ? r.d : null;
    };
    C.ruleSet = function (name, value) {
      C.ruleValues[name] = value;
      if (name === 'doDaylightCycle' && NS.Sky) NS.Sky.daylightCycle = (value === 'true');
      if (name === 'doWeatherCycle' && NS.Sky) NS.Sky.weatherCycle = (value === 'true');
      return value;
    };
    var grNode = lit('gamerule').requires(perm(2));
    Object.keys(ruleTable).forEach(function (rule) {
      var spec = ruleTable[rule];
      var valArg = spec.t === 'i' ? arg('value', B.integer()) : arg('value', B.bool());
      grNode.then(lit(rule)
        .executes(function (c) {
          c.source.send(T('commands.gamerule.query', [rule, String(C.ruleGet(rule))]));
          return 1;
        })
        .then(valArg.executes(function (c) {
          C.ruleSet(rule, String(get(c, 'value')));
          c.source.send(T('commands.gamerule.set', [rule, String(C.ruleGet(rule))]));
          return 1;
        })));
    });
    d.register(grNode);

    // ── /worldborder (G17, #5625) — WorldBorderCommand.java; the store is World.border (07_world.js) ──
    var wbOut = function (c, key, args, v) { c.source.send(T(key, args)); return v === undefined ? 1 : v; };
    var f1 = function (v) { return String(Math.round(v * 100) / 100); };
    var wbSet = function (c, dist, secs) {
      var WB = NS.World.border, cur = WB.size();
      if (cur === dist) { c.source.send(T('commands.worldborder.set.failed.nochange')); return 0; }
      if (dist < 1) { c.source.send(T('commands.worldborder.set.failed.small')); return 0; }
      if (dist > 59999968) { c.source.send(T('commands.worldborder.set.failed.big')); return 0; }
      if (secs > 0) {
        WB.lerpSize(dist, secs * 1000);
        c.source.send(T(dist > cur ? 'commands.worldborder.set.grow' : 'commands.worldborder.set.shrink', [f1(dist), String(secs)]));
      } else { WB.setSize(dist); c.source.send(T('commands.worldborder.set.immediate', [f1(dist)])); }
      return 1;
    };
    d.register(lit('worldborder').requires(perm(2))
      .then(lit('get').executes(function (c) {
        var sz = NS.World.border.size();
        return wbOut(c, 'commands.worldborder.get', [f1(sz)], Math.floor(sz + 0.5));
      }))
      .then(lit('set').then(arg('distance', B.double(-5.9999968E7, 5.9999968E7))
        .executes(function (c) { return wbSet(c, get(c, 'distance'), 0); })
        .then(arg('time', B.integer(0)).executes(function (c) { return wbSet(c, get(c, 'distance'), get(c, 'time')); }))))
      .then(lit('add').then(arg('distance', B.double(-5.9999968E7, 5.9999968E7))
        .executes(function (c) { return wbSet(c, NS.World.border.newSize + get(c, 'distance'), 0); })
        .then(arg('time', B.integer(0)).executes(function (c) { return wbSet(c, NS.World.border.newSize + get(c, 'distance'), get(c, 'time')); }))))
      .then(lit('center').then(arg('x', B.double(-3.0E7, 3.0E7)).then(arg('z', B.double(-3.0E7, 3.0E7)).executes(function (c) {
        var WB = NS.World.border; WB.centerX = get(c, 'x'); WB.centerZ = get(c, 'z');
        return wbOut(c, 'commands.worldborder.center.success', [f1(WB.centerX), f1(WB.centerZ)]);
      }))))
      .then(lit('damage')
        .then(lit('amount').then(arg('damagePerBlock', B.double(0)).executes(function (c) {
          NS.World.border.damagePerBlock = get(c, 'damagePerBlock');
          return wbOut(c, 'commands.worldborder.damage.amount.success', [f1(get(c, 'damagePerBlock'))]);
        })))
        .then(lit('buffer').then(arg('distance', B.double(0)).executes(function (c) {
          NS.World.border.safeZone = get(c, 'distance');
          return wbOut(c, 'commands.worldborder.damage.buffer.success', [f1(get(c, 'distance'))]);
        }))))
      .then(lit('warning')
        .then(lit('distance').then(arg('distance', B.integer(0)).executes(function (c) {
          NS.World.border.warningBlocks = get(c, 'distance');
          return wbOut(c, 'commands.worldborder.warning.distance.success', [String(get(c, 'distance'))]);
        })))
        .then(lit('time').then(arg('time', B.integer(0)).executes(function (c) {
          NS.World.border.warningTime = get(c, 'time');
          return wbOut(c, 'commands.worldborder.warning.time.success', [String(get(c, 'time'))]);
        })))));

    // ── /clone <begin> <end> <destination> [replace|masked|filtered] [normal|force|move] ───
    //
    // ⚠⚠ **THE BLOCKS ARE READ BEFORE ANY IS WRITTEN, AND THAT IS NOT AN OPTIMISATION.** With
    // `force` the source and destination are allowed to OVERLAP, and a loop that writes as it
    // reads copies its own output: clone a column one block up and you get the bottom block
    // smeared the whole way. Vanilla collects the whole source first for exactly this reason.
    //
    // ⚠ AND `move` CLEARS THE SOURCE **AFTER** THE COPY, not during — otherwise an overlapping
    // move erases what it has not read yet.
    C.CLONE_LIMIT = 32768;
    var clone = function (ctx, mask, mode) {
      var W = NS.World, SR = NS.States;
      var a = C.pos(get(ctx, 'begin'), ctx.source), b2 = C.pos(get(ctx, 'end'), ctx.source);
      var dst = C.pos(get(ctx, 'destination'), ctx.source);
      var x0 = Math.min(Math.floor(a.x), Math.floor(b2.x)), x1 = Math.max(Math.floor(a.x), Math.floor(b2.x));
      var y0 = Math.min(Math.floor(a.y), Math.floor(b2.y)), y1 = Math.max(Math.floor(a.y), Math.floor(b2.y));
      var z0 = Math.min(Math.floor(a.z), Math.floor(b2.z)), z1 = Math.max(Math.floor(a.z), Math.floor(b2.z));
      var w = x1 - x0 + 1, h = y1 - y0 + 1, dp = z1 - z0 + 1;
      var n = w * h * dp;
      var dx = Math.floor(dst.x), dy = Math.floor(dst.y), dz = Math.floor(dst.z);
      var ox = dx - x0, oy = dy - y0, oz = dz - z0;
      var overlaps = !(ox >= w || ox <= -w || oy >= h || oy <= -h || oz >= dp || oz <= -dp);
      // ⚠ D-XXX: `force` AND `move` BOTH ALLOW OVERLAP (vanilla `CloneCommand.Mode` only
      // `NORMAL`/`replace-without-a-mode-literal` disallows it -- `.decomp`
      // CloneCommand.Mode.field_13497 (force) and field_13500 (move) are both
      // `allowsOverlap=true`). Only `normal` refuses. A version that excluded just `force`
      // rejected every overlapping `/clone ... move` with `commands.clone.overlap`, even
      // though the whole point of the read-before-write buffer above and the "clear only what
      // the copy did not just write into" pass below is to make an overlapping move safe.
      if (overlaps && mode === 'normal') {
        throw new B.Err('commands.clone.overlap', [], -1, null);
      }
      // ⚠ VANILLA CHECKS OVERLAP *BEFORE* THE SIZE CAP (`.decomp` CloneCommand.execute: the
      // overlap `if` is the outer one, the `MAX_BLOCKS` check is nested inside its `else`) --
      // reversed here so a region that is both overlapping AND oversized reports
      // `commands.clone.overlap`, matching vanilla's own error priority, not `commands.clone.toobig`.
      if (n > C.CLONE_LIMIT) {
        throw new B.Err('commands.clone.toobig', [String(C.CLONE_LIMIT), String(n)], -1, null);
      }
      var filter = mask === 'filtered' ? (get(ctx, 'filter') | 0) : -1;
      var buf = [], x, y, z;
      for (x = x0; x <= x1; x++) for (y = y0; y <= y1; y++) for (z = z0; z <= z1; z++) {
        var st = W.getBlock(x, y, z) | 0;
        if (mask === 'masked' && st === 0) continue;
        if (mask === 'filtered' && st !== filter) continue;
        buf.push(x, y, z, st);
      }
      var done = 0;
      for (var i = 0; i < buf.length; i += 4) {
        W.setBlock(buf[i] + ox, buf[i + 1] + oy, buf[i + 2] + oz, buf[i + 3]);
        done++;
      }
      if (mode === 'move') {
        // ⚠ ONLY THE CELLS THAT WERE COPIED, and only where the destination did not land on
        // them: clearing a cell the copy just wrote into is how an overlapping move eats itself.
        for (i = 0; i < buf.length; i += 4) {
          var sx = buf[i], sy = buf[i + 1], sz = buf[i + 2];
          var hit = false;
          for (var j = 0; j < buf.length; j += 4) {
            if (buf[j] + ox === sx && buf[j + 1] + oy === sy && buf[j + 2] + oz === sz) { hit = true; break; }
          }
          if (!hit) W.setBlock(sx, sy, sz, 0);
        }
      }
      if (!done) throw new B.Err('commands.clone.failed', [], -1, null);
      ctx.source.send(T('commands.clone.success', [String(done)]));
      return done;
    };
    {
      var cloneModes = ['replace', 'masked', 'filtered'];
      var cloneHow = ['normal', 'force', 'move'];
      var cloneTail = function (mask) {
        var node = null;
        var mk = function (base) {
          cloneHow.forEach(function (how) {
            base.then(lit(how).executes(function (c) { return clone(c, mask, how); }));
          });
          return base.executes(function (c) { return clone(c, mask, 'normal'); });
        };
        if (mask === 'filtered') node = mk(arg('filter', M.blockState()));
        else node = mk(lit(mask));
        return node;
      };
      var dstNode = arg('destination', M.vec3(true))
        .executes(function (c) { return clone(c, 'replace', 'normal'); });
      cloneModes.forEach(function (mk) {
        dstNode.then(mk === 'filtered' ? lit('filtered').then(cloneTail('filtered')) : cloneTail(mk));
      });
      d.register(lit('clone').requires(perm(2))
        .then(arg('begin', M.vec3(true)).then(arg('end', M.vec3(true)).then(dstNode))));
    }

    // ── /locatebiome <biome> ───────────────────────────────────────────────────────────────
    //
    // ⚠ VANILLA'S OWN SEARCH, NOT A SPIRAL OF MY OWN. `BiomeSource.findBiomeHorizontal` walks a
    // square ring pattern out to **6,400 blocks in steps of 8**, at the source's own y, and takes
    // the first match — not the nearest. The distance it REPORTS is horizontal only and floored,
    // which is why a biome directly below you can read as "0 blocks away".
    C.LOCATE_RADIUS = 6400;
    C.LOCATE_STEP = 8;
    /**
     * ⚠⚠ **A RULING, WITH THE MEASUREMENT THAT CHOSE IT (D-325).** Vanilla's radius and step are
     * kept exactly; what is NOT kept is running them to exhaustion. `Climate.biomeAt` costs
     * **58 microseconds** on the box this was measured on — six noise samples and an R-tree
     * query — and a miss walks all **160,801** cells of the ring pattern, so asking for a biome
     * that is not nearby would lock the tab for **nine and a third seconds**. Vanilla pays the
     * same cost on a server thread; this game would pay it on the one that draws the frame.
     *
     * So the search gives up after half a second and reports `commands.locatebiome.notFound` —
     * whose own wording, *"within reasonable distance"*, is already the honest answer. Set it to
     * 0 for no budget at all; `commandcheck` does exactly that to test the search itself, and
     * separately sets it tiny to prove the budget bites.
     *
     * ⚠ THIS IS A DEVIATION AND IT IS NOT A SILENT ONE: it can turn a findable biome into "not
     * found" when the machine is slow, which is the honest shape of the trade. The alternative —
     * a smaller radius — fails the same way and lies about why.
     */
    C.LOCATE_MS = 500;
    d.register(lit('locatebiome').requires(perm(2))
      .then(arg('biome', M.oneOf(function () {
        var CL = NS.Climate;
        return (CL && CL.biomeNames) ? CL.biomeNames.slice() : [];
      }, 'commands.locatebiome.invalid', true)).executes(function (c) {
        var CL = NS.Climate;
        var want = String(get(c, 'biome'));
        if (!CL || !CL.biomeNameAt) throw new B.Err('commands.locatebiome.notFound', [want], -1, null);
        var sx = Math.floor(c.source.x), sy = Math.floor(c.source.y), sz = Math.floor(c.source.z);
        var found = C.findBiome(want, sx, sy, sz);
        if (!found) throw new B.Err('commands.locatebiome.notFound', [want], -1, null);
        var dd = Math.floor(Math.sqrt((found.x - sx) * (found.x - sx) + (found.z - sz) * (found.z - sz)));
        c.source.send(T('commands.locatebiome.success',
          [want, found.x + ', ' + found.y + ', ' + found.z, String(dd)]));
        return dd;
      })));

    // ── /locate <structure> ────────────────────────────────────────────────────────────────
    // ⚠ THE ARGUMENT SET IS THE REGISTRY'S, NOT A LIST TYPED HERE. Vanilla's argument is a
    // `StructureFeature` registry key, and this engine's configured structures each carry their
    // type — so the completions are the DISTINCT LIVE TYPES, derived. A typed roster would be a
    // second list free to disagree with the one the generator actually uses (the same argument
    // `C.IMPLEMENTED` makes about the command list itself).
    d.register(lit('locate').requires(perm(2))
      .then(arg('structure', M.oneOf(function () {
        var ST = NS.Structures, seen = Object.create(null), out = [];
        if (!ST || !ST.ready) return out;
        for (var i = 0; i < ST.sets.length; i++) {
          if (!ST.sets[i].live) continue;
          var mem = ST.sets[i].members;
          for (var j = 0; j < mem.length; j++) {
            var t = mem[j].def.type;
            if (t && !seen[t]) { seen[t] = 1; out.push(t); }
          }
        }
        out.sort();
        return out;
      }, 'commands.locate.failed', true)).executes(function (c) {
        var want = String(get(c, 'structure'));
        var sx = Math.floor(c.source.x), sz = Math.floor(c.source.z);
        var found = C.findStructure(want, sx, sz);
        if (!found) throw new B.Err('commands.locate.failed', [want], -1, null);
        var dd = Math.floor(Math.sqrt((found.x - sx) * (found.x - sx) + (found.z - sz) * (found.z - sz)));
        c.source.send(T('commands.locate.success',
          [want, found.x + ', ' + found.y + ', ' + found.z, String(dd)]));
        return dd;
      })));

    // ── /list [uuids] ──────────────────────────────────────────────────────────────────────
    // ⚠ LEVEL 0, AND ITS ABSENCE IS LOUDER THAN ITS PRESENCE. One player, one slot; the `uuids`
    // form exists in vanilla and prints `name (uuid)`, and this game has no uuids, so it prints
    // the name in both — a deviation worth one line rather than a missing sub-command.
    var listPlayers = function (ctx) {
      var name = ctx.source.name || 'Player';
      ctx.source.send(T('commands.list.players', ['1', '1', name]));
      return 1;
    };
    d.register(lit('list')
      .executes(listPlayers)
      .then(lit('uuids').executes(listPlayers)));

    // ── /tellraw <targets> <component> ─────────────────────────────────────────────────────
    // ⚠ IT DOES NOT GO THROUGH `T.format`. A `/tellraw` component is already a tree; running it
    // through the translate path would re-interpret a literal `%s` in somebody's text as a
    // format specifier, which is how a chat line eats the word after it.
    d.register(lit('tellraw').requires(perm(2))
      .then(arg('targets', M.entity(false, true))
        .then(arg('message', M.component()).executes(function (c) {
          var targets = C.resolve(get(c, 'targets'), c.source);
          if (!targets.length) throw new B.Err('argument.entity.notfound.player', [], -1, null);
          var comp = get(c, 'message'), sent = 0;
          for (var i = 0; i < targets.length; i++) {
            if (targets[i].kind !== 'player') continue;
            if (NS.Chat && NS.Chat.add) NS.Chat.add(comp);
            sent++;
          }
          return sent;
        }))));

    // ── /title <targets> <clear|reset|title|subtitle|actionbar|times> ──────────────────────
    //
    // ⚠ THE SUB-LITERALS AND THEIR ORDER ARE THE GOLDEN TABLE'S: clear, reset, subtitle,
    // actionbar, times — plus `title` itself, which vanilla lists first in code and the extractor
    // reads out of the sub-literal set.
    var titleTargets = function (ctx) {
      var targets = C.resolve(get(ctx, 'targets'), ctx.source);
      if (!targets.length) throw new B.Err('argument.entity.notfound.player', [], -1, null);
      var n = 0;
      for (var i = 0; i < targets.length; i++) if (targets[i].kind === 'player') n++;
      if (!n) throw new B.Err('argument.entity.notfound.player', [], -1, null);
      return { n: n, one: targets[0].name || ctx.source.name };
    };
    // ⚠ THE TWO KEYS ARE PASSED WHOLE, NOT BUILT BY CONCATENATION. `commandcheck` §6 scans these
    // files for the translation keys they use and asserts every one is in the shipped lang table;
    // a key assembled at runtime is invisible to that scan, and `commands.title.times` — the base
    // it would have seen — is not a real key at all. A string the check cannot see is a string
    // nobody will notice is missing until it renders as its own key on screen.
    var titleSay = function (ctx, one, many, t) {
      ctx.source.send(t.n === 1 ? T(one, [t.one]) : T(many, [String(t.n)]));
      return t.n;
    };
    {
      var H = function () { return NS.Hud; };
      var show = function (kind, key) {   // key: [single, multiple]
        return lit(kind).then(arg('title', M.component()).executes(function (c) {
          var t = titleTargets(c), comp = get(c, 'title');
          var h = H();
          if (h) {
            if (kind === 'title') h.setTitle(comp);
            else if (kind === 'subtitle') h.setSubtitle(comp);
            else h.setActionBar(comp);
          }
          return titleSay(c, key[0], key[1], t);
        }));
      };
      var timesArg = arg('fadeIn', B.integer(0))
        .then(arg('stay', B.integer(0))
          .then(arg('fadeOut', B.integer(0)).executes(function (c) {
            var t = titleTargets(c);
            if (H()) H().setTitleTimes(get(c, 'fadeIn') | 0, get(c, 'stay') | 0, get(c, 'fadeOut') | 0);
            return titleSay(c, 'commands.title.times.single', 'commands.title.times.multiple', t);
          })));
      d.register(lit('title').requires(perm(2))
        .then(arg('targets', M.entity(false, true))
          .then(lit('clear').executes(function (c) {
            var t = titleTargets(c);
            if (H()) H().clearTitles();
            return titleSay(c, 'commands.title.cleared.single', 'commands.title.cleared.multiple', t);
          }))
          .then(lit('reset').executes(function (c) {
            var t = titleTargets(c);
            // ⚠ `reset` IS `clear` PLUS THE TIMES. Vanilla sends one packet with a flag; a
            // `/title reset` that left a custom fade in place would be a `clear` with a different
            // message, which is exactly the kind of near-miss nobody reports.
            if (H()) { H().clearTitles(); H().resetTitleTimes(); }
            return titleSay(c, 'commands.title.reset.single', 'commands.title.reset.multiple', t);
          }))
          .then(show('title', ['commands.title.show.title.single', 'commands.title.show.title.multiple']))
          .then(show('subtitle', ['commands.title.show.subtitle.single', 'commands.title.show.subtitle.multiple']))
          .then(show('actionbar', ['commands.title.show.actionbar.single', 'commands.title.show.actionbar.multiple']))
          .then(lit('times').then(timesArg))));
    }

    // ── /execute <clause>... run <command> ─────────────────────────────────────────────────
    //
    // ⚠⚠ **THIS IS THE COMMAND EVERY OTHER COMMAND IS WORTH MORE BECAUSE OF**, and it is almost
    // entirely the parser's work: each clause is a node that REDIRECTS back to `execute` and
    // carries a modifier saying what source the rest of the line runs against. The chain is
    // walked at EXECUTE time (D-327), which is the only way `as @e` can mean "once per entity"
    // rather than "the first one".
    //
    // ⚠ **OWED, NAMED:** `store`, `facing`, `in` and the `if score|predicate|data` forms. `store`
    // needs a scoreboard or an NBT store, `in` needs a second dimension, and the three `if`
    // forms need the systems they name. They are listed in `C.EXECUTE_OWED` and the golden
    // sub-literal set is what says how many there are.
    C.EXECUTE_OWED = ['store', 'facing', 'in',                        // OWED
                      'score', 'predicate', 'data'];                  // OWED — the `if` forms
    {
      var ex = lit('execute').requires(perm(2));
      var targetsOf = function (ctx, key) {
        return C.resolve(get(ctx, key), ctx.source);
      };
      // ⚠ A FORKING MODIFIER IS MARKED AS ONE so `runChain` knows a count is the answer.
      var forking = function (fn) { fn.forks = true; return fn; };

      // as — the same place, a different `@s`
      ex.then(lit('as').then(arg('targets', M.entity(false, false))
        .redirect(ex, forking(function (ctx) {
          var ts = targetsOf(ctx, 'targets'), out = [];
          for (var i = 0; i < ts.length; i++) {
            out.push(C.derive(ctx.source, { entity: ts[i].e,
              name: ts[i].kind === 'player' ? ctx.source.name : ts[i].name }));
          }
          return out;
        }))));

      // at — the same `@s`, a different place AND rotation
      ex.then(lit('at').then(arg('targets', M.entity(false, false))
        .redirect(ex, forking(function (ctx) {
          var ts = targetsOf(ctx, 'targets'), out = [];
          for (var i = 0; i < ts.length; i++) {
            var e = ts[i].e;
            out.push(C.derive(ctx.source, { x: e.x, y: e.y, z: e.z,
              yaw: e.yaw || 0, pitch: e.pitch || 0 }));
          }
          return out;
        }))));

      // positioned <pos> | positioned as <targets>
      var posClause = lit('positioned');
      posClause.then(arg('pos', M.vec3(false)).redirect(ex, function (ctx) {
        var p = C.pos(get(ctx, 'pos'), ctx.source);
        return C.derive(ctx.source, { x: p.x, y: p.y, z: p.z });
      }));
      posClause.then(lit('as').then(arg('targets', M.entity(false, false))
        .redirect(ex, forking(function (ctx) {
          var ts = targetsOf(ctx, 'targets'), out = [];
          // ⚠ POSITION ONLY. `positioned as` does NOT take the rotation and `at` does; two
          // clauses that differ by one field are exactly the pair to get wrong.
          for (var i = 0; i < ts.length; i++) {
            out.push(C.derive(ctx.source, { x: ts[i].e.x, y: ts[i].e.y, z: ts[i].e.z }));
          }
          return out;
        }))));
      ex.then(posClause);

      // rotated <yaw> <pitch> | rotated as <targets>
      var rotClause = lit('rotated');
      rotClause.then(arg('yaw', M.coordValue()).then(arg('pitch', M.coordValue())
        .redirect(ex, function (ctx) {
          // ⚠⚠ **VANILLA'S ROTATION ARGUMENT IS IN DEGREES AND THIS ENGINE STORES RADIANS.**
          // `Player.yaw` goes straight into `Math.cos`, and the local-coordinate maths in
          // `C.pos` is vanilla's formula with the conversion already done. So `rotated 90 0`
          // must be a quarter turn, not ninety radians — which is fourteen and a bit turns and
          // lands the block somewhere that looks random. The two conventions AGREE otherwise:
          // yaw 0 is +Z, and pitch -90 is up, in both.
          var DEG = Math.PI / 180;
          var y = get(ctx, 'yaw'), p = get(ctx, 'pitch');
          return C.derive(ctx.source, {
            yaw: y.rel ? (ctx.source.yaw || 0) + y.v * DEG : y.v * DEG,
            pitch: p.rel ? (ctx.source.pitch || 0) + p.v * DEG : p.v * DEG
          });
        })));
      rotClause.then(lit('as').then(arg('targets', M.entity(false, false))
        .redirect(ex, forking(function (ctx) {
          var ts = targetsOf(ctx, 'targets'), out = [];
          for (var i = 0; i < ts.length; i++) {
            out.push(C.derive(ctx.source, { yaw: ts[i].e.yaw || 0, pitch: ts[i].e.pitch || 0 }));
          }
          return out;
        }))));
      ex.then(rotClause);

      // align <axes> — floor the position on the named axes
      ex.then(lit('align').then(arg('axes', M.axes())
        .redirect(ex, function (ctx) {
          var ax = String(get(ctx, 'axes')), s2 = ctx.source;
          return C.derive(s2, {
            x: ax.indexOf('x') >= 0 ? Math.floor(s2.x) : s2.x,
            y: ax.indexOf('y') >= 0 ? Math.floor(s2.y) : s2.y,
            z: ax.indexOf('z') >= 0 ? Math.floor(s2.z) : s2.z
          });
        })));

      // anchored eyes|feet — where `^` and `facing` measure from
      ex.then(lit('anchored').then(arg('anchor', M.oneOf(['eyes', 'feet'], 'argument.anchor.invalid'))
        .redirect(ex, function (ctx) {
          return C.derive(ctx.source, { anchor: String(get(ctx, 'anchor')) });
        })));

      // ── if / unless ─────────────────────────────────────────────────────────────────────
      // ⚠⚠ A TEST IS A MODIFIER THAT RETURNS THE SOURCE OR NOTHING, which is what makes
      // `execute if ... if ... run ...` chain without any special handling — and what makes
      // `/execute if block ~ ~ ~ stone` legal on its own, returning 1 or failing.
      var mkTest = function (want, build) {
        var node = lit(want ? 'if' : 'unless');
        build(node, function (test) {
          return function (ctx) { return (!!test(ctx) === want) ? ctx.source : null; };
        }, function (test) {
          return function (ctx) {
            if (!!test(ctx) !== want) throw new B.Err('commands.execute.conditional.fail', [], -1, null);
            ctx.source.send(T('commands.execute.conditional.pass', []));
            return 1;
          };
        });
        return node;
      };
      var blockTest = function (ctx) {
        var p = C.pos(get(ctx, 'pos'), ctx.source);
        return (NS.World.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) | 0)
               === (get(ctx, 'block') | 0);
      };
      var entityTest = function (ctx) { return targetsOf(ctx, 'targets').length > 0; };
      var blocksTest = function (ctx, masked) {
        var W = NS.World;
        var a = C.pos(get(ctx, 'start'), ctx.source), b2 = C.pos(get(ctx, 'end'), ctx.source);
        var dst = C.pos(get(ctx, 'destination'), ctx.source);
        var x0 = Math.min(Math.floor(a.x), Math.floor(b2.x)), x1 = Math.max(Math.floor(a.x), Math.floor(b2.x));
        var y0 = Math.min(Math.floor(a.y), Math.floor(b2.y)), y1 = Math.max(Math.floor(a.y), Math.floor(b2.y));
        var z0 = Math.min(Math.floor(a.z), Math.floor(b2.z)), z1 = Math.max(Math.floor(a.z), Math.floor(b2.z));
        var ox = Math.floor(dst.x) - x0, oy = Math.floor(dst.y) - y0, oz = Math.floor(dst.z) - z0;
        for (var x = x0; x <= x1; x++) for (var y = y0; y <= y1; y++) for (var z = z0; z <= z1; z++) {
          var st = W.getBlock(x, y, z) | 0;
          if (masked && st === 0) continue;
          if (st !== (W.getBlock(x + ox, y + oy, z + oz) | 0)) return false;
        }
        return true;
      };
      [true, false].forEach(function (want) {
        ex.then(mkTest(want, function (node, asMod, asRun) {
          node.then(lit('block').then(arg('pos', M.vec3(true)).then(arg('block', M.blockState())
            .redirect(ex, asMod(blockTest)).executes(asRun(blockTest)))));
          node.then(lit('entity').then(arg('targets', M.entity(false, false))
            .redirect(ex, asMod(entityTest)).executes(asRun(entityTest))));
          var blocksNode = lit('blocks').then(arg('start', M.vec3(true))
            .then(arg('end', M.vec3(true)).then(arg('destination', M.vec3(true))
              .then(lit('all').redirect(ex, asMod(function (c) { return blocksTest(c, false); }))
                .executes(asRun(function (c) { return blocksTest(c, false); })))
              .then(lit('masked').redirect(ex, asMod(function (c) { return blocksTest(c, true); }))
                .executes(asRun(function (c) { return blocksTest(c, true); }))))));
          node.then(blocksNode);
        }));
      });

      // run — the tail is a whole command, parsed by the dispatcher's own root
      ex.then(lit('run').redirect(d.root, null));
      d.register(ex);
    }

    // ── /help [command] ────────────────────────────────────────────────────────────────────
    // ⚠ LEVEL 0: everyone may run it, and it lists only what the SOURCE may run — which is the
    // one place the permission plumbing is visible without another player to test it with.
    // ⚠ KW-47: vanilla's `HelpCommand.register` (.decomp) never enumerates every runnable path —
    // it calls Brigadier's `getSmartUsage`, ONE compact line per branch, `[...]`/`(a|b)` folding
    // alternatives/optionals into that one string. No-arg `/help` smart-usages the ROOT, one line
    // per top-level command WITH its argument shape already on it (not `D.names()`'s bare word).
    // `/help <command>` re-parses the WHOLE typed string through the dispatcher, same as vanilla
    // (`$$0.parse(...)`) -- so `/help gamemode survival` narrows into the `survival` sub-path
    // instead of repeating `/help gamemode` -- and smart-usages the DEEPEST node that parse
    // reached, not `C.usage()`'s every-runnable-path enumeration.
    d.register(lit('help')
      .executes(function (c) {
        var entries = d.getSmartUsage(d.root, c.source);
        for (var i = 0; i < entries.length; i++) c.source.send('/' + entries[i].text);
        return entries.length;
      })
      .then(arg('command', B.greedy()).executes(function (c) {
        var want = String(get(c, 'command'));
        var res = d.parse(want, c.source);
        if (!res.context.nodes.length) throw new B.Err('commands.help.failed', [], -1, null);
        var last = res.context.nodes[res.context.nodes.length - 1];
        var entries = d.getSmartUsage(last, c.source);
        for (var i = 0; i < entries.length; i++) c.source.send('/' + want + ' ' + entries[i].text);
        return entries.length;
      })));

    C.dispatcher = d;
    C.ready = true;
    return C;
  };

  /**
   * `/spawnpoint` — where a player respawns. ⚠ IT IS PER PLAYER and `/setworldspawn` is not:
   * vanilla keeps one world spawn and a personal one per player, and a command that wrote the
   * same field for both would make `/spawnpoint` move everybody.
   */
  C.setSpawn = function (ctx, sel, at, ang) {
    var targets = sel ? C.resolve(sel, ctx.source)
                      : [{ kind: 'player', e: NS.Player, name: ctx.source.name }];
    if (!targets.length) throw new NS.Brig.Err('argument.entity.notfound.player', [], -1, null);
    var p = at ? C.pos(at, ctx.source) : { x: ctx.source.x, y: ctx.source.y, z: ctx.source.z };
    // ⚠ THE ANGLE DEFAULTS TO A LITERAL 0.0, NOT THE PLAYER'S CURRENT FACING (.decomp
    // `SpawnPointCommand.register`: every `.executes` that does not parse an explicit
    // `<angle>` passes the literal `0.0F` straight through, even the ones that DO parse a
    // `<pos>`) -- only the branch that actually read `<angle>` off the command line uses it.
    var deg = ang ? C.angle(ang, ctx.source) : 0;
    for (var i = 0; i < targets.length; i++) {
      targets[i].e.spawnPoint = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z), yaw: deg };
    }
    var one = targets.length === 1;
    ctx.source.send(T('commands.spawnpoint.success.' + (one ? 'single' : 'multiple'),
      [String(Math.floor(p.x)), String(Math.floor(p.y)), String(Math.floor(p.z)), fmtAngle(deg),
       'minecraft:overworld', one ? (targets[0].name || ctx.source.name) : String(targets.length)]));
    return targets.length;
  };
  C.setWorldSpawn = function (ctx, at, ang) {
    var p = at ? C.pos(at, ctx.source) : { x: ctx.source.x, y: ctx.source.y, z: ctx.source.z };
    var deg = ang ? C.angle(ang, ctx.source) : 0;
    C.worldSpawn = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z), angle: deg };
    ctx.source.send(T('commands.setworldspawn.success',
      [String(C.worldSpawn.x), String(C.worldSpawn.y), String(C.worldSpawn.z), fmtAngle(deg)]));
    return 1;
  };


  /**
   * Run one chat line that begins with `/`. Returns `{ ok, lines, error }` — `lines` is the
   * feedback the command produced and `error` carries vanilla's two-line failure.
   */
  C.run = function (line, player, opts) {
    if (!C.ready) C.build();
    if (!C.ready) return { ok: false, lines: [], error: null };
    var src = C.source(player, opts);
    var text = line.charAt(0) === '/' ? line.substring(1) : line;
    var res = C.dispatcher.execute(text, src);
    if (res.ok) return { ok: true, lines: src.feedback, result: res.result };
    var e = res.error;
    var lines = src.feedback.slice();
    lines.push(e.message);
    var ctxLine = e.context ? e.context() : '';
    if (ctxLine) lines.push(ctxLine);
    return { ok: false, lines: lines, error: e };
  };

  /** Tab completion for a chat line. */
  C.suggest = function (line, player, opts) {
    if (!C.ready) C.build();
    if (!C.ready) return { start: 0, matches: [] };
    var text = line.charAt(0) === '/' ? line.substring(1) : line;
    var off = line.charAt(0) === '/' ? 1 : 0;
    var s = C.dispatcher.suggest(text, C.source(player, opts));
    return { start: s.start + off, matches: s.matches };
  };

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
