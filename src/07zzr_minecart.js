// 07zzr_minecart.js -- #1564 (G25): MINECART ENTITIES, the movement / logic half. AbstractMinecartEntity +
// MinecartEntity / StorageMinecartEntity / ChestMinecartEntity / FurnaceMinecartEntity / HopperMinecartEntity /
// TntMinecartEntity / SpawnerMinecartEntity / CommandBlockMinecartEntity (.decomp/net/minecraft/entity/vehicle/),
// each read whole. Runs on: MAIN THREAD ONLY. No DOM.
//
// Hooks (minimal lines in 07i_entitylist.js): `EL.motionFor` answers [0, 1] for the seven types (the cart does
// its own gravity), `EL.DEFAULTS.<type>` calls `Mc.init`, and `EL.tickOne` dispatches `Mc.tick(e)` INSTEAD of the
// generic gravity/move/damp path (AbstractMinecartEntity.tick() never calls Entity.tick/baseTick).
//
// What is ported, and the Java it comes from:
//   * tick(): wobble countdown, void discard, gravity -0.04 (-0.005 in water), the `rails`-tag "rail one block
//     down" lookup, moveOnRail / moveOffRail, yaw from the position delta with the 170-degree yawFlipped rule,
//     cart-vs-cart pushAwayFrom, lava fall-distance halving.
//   * moveOnRail(): snapPositionToRail, the ascending-rail pull (0.0078125, x0.2 in water), the shape's
//     direction table (ADJACENT_RAIL_POSITIONS_BY_SHAPE), velocity re-aimed along the rail and clamped to 2.0, the
//     player-in-cart nudge, an unpowered powered_rail braking (<0.03 stops, else x0.5), the along-rail position
//     solve, move() capped at getMaxSpeed (x0.75 with a passenger), the +/-1 height step at slope ends,
//     applySlowdown, the slope energy exchange (dy*0.05), the hand-off velocity on crossing into the next cell,
//     powered_rail boost (+0.06 along the heading; from rest it pushes off a wall by 0.02).
//   * moveOffRail(): clamp to getMaxSpeed, x0.5 on the ground / x0.95 airborne.
//   * getMaxSpeed 8/20 (4/20 in water); furnace 4/20 (3/20 in water). applySlowdown 0.96 (0.997 with a passenger),
//     x0.95 in water; the furnace's push vector (x0.8 + push, x0.98 without fuel), its 3600-tick coal/charcoal
//     fuel and lit flag.
//   * damage()/animateDamage(): wobble side/ticks/strength (+= dmg*10), break at strength > 40 or on a creative
//     hit; dropItems: the minecart item (custom name carried), the variant's block (furnace/chest/hopper/tnt
//     minecart drop their block; the storage ones also scatter their inventory), all gated on doEntityDrops.
//   * Activator rail: MinecartEntity ejects passengers and wobbles (strength 50); Hopper toggles `enabled`;
//     Tnt primes (fuse 80); CommandBlock is rate-limited to every 4 ticks (the execute itself is OWED).
//   * TntMinecartEntity: fuse countdown, explode(velocity^2) = 4 + rand*1.5*min(5, |v|) BREAK-type explosion on
//     a >= 0.01 horizontal wall hit / fuse end / flaming arrow / fall >= 3; dropItems primes instead when fast.
//
// Fields a renderer reads: e.cartYaw / e.cartYawO (degrees, = e.yaw / the tick-start yaw), e.cartPitch (always
// 0 after tick()), e.cartWobbleTicks / e.cartWobbleSide / e.cartWobbleStrength (and e.cartDamageWobble = the
// ticks), e.displayBlockState / e.displayOffset (getContainedBlock / getBlockOffset, 16ths of a block; set at
// init and kept live for a lit furnace), e.cartLit (furnace), e.cartFuse (tnt, -1 = unprimed), e.cartType (the
// Type enum name), e.cartOnRail (last tick found a rail).
//
// Test seams: `Mc.world` (default NS.World; anything with getBlock) and `Mc.mover(e,dx,dy,dz)` (default
// NS.Physics.move) let minecartcheck run without chunk storage.
(function (NS) {
  'use strict';
  var Mc = NS.Minecart = { ready: false, world: null, mover: null };

  var TYPES = Mc.TYPES = {
    minecart: 'RIDEABLE', chest_minecart: 'CHEST', furnace_minecart: 'FURNACE', tnt_minecart: 'TNT',
    spawner_minecart: 'SPAWNER', hopper_minecart: 'HOPPER', command_block_minecart: 'COMMAND_BLOCK'
  };
  Mc.isCart = function (t) { return Object.prototype.hasOwnProperty.call(TYPES, t); };
  /** AbstractMinecartEntity.getPickBlockStack's switch. */
  Mc.PICK = { furnace_minecart: 'furnace_minecart', chest_minecart: 'chest_minecart', tnt_minecart: 'tnt_minecart',
    hopper_minecart: 'hopper_minecart', command_block_minecart: 'command_block_minecart' };
  Mc.pickItem = function (t) { return Mc.PICK[t] || 'minecart'; };
  /** getDefaultContainedBlock: block name (+ props) per type; getDefaultBlockOffset: 6, chest 8, hopper 1. */
  Mc.DISPLAY = {
    minecart: null, chest_minecart: 'chest', furnace_minecart: 'furnace', tnt_minecart: 'tnt',
    spawner_minecart: 'spawner', hopper_minecart: 'hopper', command_block_minecart: 'command_block'
  };
  Mc.OFFSET = { chest_minecart: 8, hopper_minecart: 1 };
  Mc.INVENTORY = { chest_minecart: 27, hopper_minecart: 5 };   // size(); the backing list is 36 either way

  // ADJACENT_RAIL_POSITIONS_BY_SHAPE, in RailShape order (Rail.SHAPES): [first, second] as [dx, dy, dz].
  var ADJ = [
    [[0, 0, -1], [0, 0, 1]],     // north_south
    [[-1, 0, 0], [1, 0, 0]],     // east_west
    [[-1, -1, 0], [1, 0, 0]],    // ascending_east
    [[-1, 0, 0], [1, -1, 0]],    // ascending_west
    [[0, 0, -1], [0, -1, 1]],    // ascending_north
    [[0, -1, -1], [0, 0, 1]],    // ascending_south
    [[0, 0, 1], [1, 0, 0]],      // south_east
    [[0, 0, 1], [-1, 0, 0]],     // south_west
    [[0, 0, -1], [-1, 0, 0]],    // north_west
    [[0, 0, -1], [1, 0, 0]]      // north_east
  ];
  Mc.ADJ = ADJ;
  var NS_ = 0, EW = 1, AE = 2, AW = 3, AN = 4, AS = 5;

  function wrapDegrees(d) { d = d % 360; if (d >= 180) d -= 360; if (d < -180) d += 360; return d; }
  function W() { return Mc.world || NS.World; }
  function blockAt(x, y, z) { return W().getBlock(x, y, z); }
  function rnd() { return (NS.EntityList && NS.EntityList.random) || NS.wrand; }
  function ruleDrops() {
    var C = NS.Commands;
    return !(C && typeof C.ruleGet === 'function' && C.ruleGet('doEntityDrops') === 'false');
  }
  function blockName(st) { return NS.Reg.names[NS.States.block[st]]; }
  function isRailState(st) { return st !== 0 && !!NS.Rail && NS.Rail.isRail(st); }
  function shapeOf(st) { return NS.Rail.shapeOf(st); }
  function isSolidBlock(st) { return st !== 0 && NS.States.solid[st] === 1; }

  function touchingWater(e) {
    // Entity.isTouchingWater, approximated by the water cell at the box's middle (a 0.98 x 0.7 box).
    var R = NS.Reg;
    var st = blockAt(Math.floor(e.x), Math.floor(e.y + (e.height || 0.7) * 0.5), Math.floor(e.z));
    return st !== 0 && NS.States.block[st] === R.id.water;
  }
  function inLava(e) {
    var st = blockAt(Math.floor(e.x), Math.floor(e.y + 0.4), Math.floor(e.z));
    return st !== 0 && NS.States.block[st] === NS.Reg.id.lava;
  }
  /** `Entity.removeAllPassengers`: also dismounts the live player (P.vehicle) riding it. */
  function removeAllPassengers(e) {
    if (e.cartPassengers) e.cartPassengers.length = 0;
    var P = NS.Player;
    if (P && P.vehicle === e && P.dismountVehicle) P.dismountVehicle();
    e.rider = null;
  }
  Mc.removeAllPassengers = removeAllPassengers;
  /** `MinecartEntity.interact`: not sneaking + no passengers -> the player starts riding (plain 'minecart' only). */
  Mc.interact = function (e, p) {
    if (e.type !== 'minecart' || p.crouching || hasPassengers(e) || e.rider) return false;
    e.cartPassengers = [p]; e.rider = p;
    p.mountVehicle(e);
    return true;
  };
  function hasPassengers(e) {
    if (e.cartPassengers) e.cartPassengers = e.cartPassengers.filter(function (p) { return p.vehicle === e || p.isPlayer || p.type === 'player'; });   // a mob that dismounted/died is gone
    return !!(e.cartPassengers && e.cartPassengers.length);
  }
  function move(e, dx, dy, dz) {
    var mv = Mc.mover || (NS.Physics && NS.Physics.move);
    if (mv) mv(e, dx, dy, dz);
    else { e.x += dx; e.y += dy; e.z += dz; }
    // Entity.move tail: vx,vz *= getVelocityMultiplier() (AbstractMinecartEntity: 1.0 on any rail; else block here, else block below)
    var R = NS.Reg, sf = R && R.speedFactor;
    if (sf) {
      var cx = Math.floor(e.x), cz = Math.floor(e.z), here = blockAt(cx, Math.floor(e.y), cz), hb = NS.States.block[here], m = 1;
      if (!isRailState(here)) {
        m = sf[hb] === undefined ? 1 : sf[hb];
        if (m === 1 && hb !== R.id.water && hb !== R.id.bubble_column) {
          var b = sf[NS.States.block[blockAt(cx, Math.floor(e.y - 0.5000001), cz)]]; m = b === undefined ? 1 : b;
        }
      }
      if (m !== 1) { e.vx *= m; e.vz *= m; }
    }
  }
  function hlen(e) { return Math.sqrt(e.vx * e.vx + e.vz * e.vz); }
  /** StorageMinecartEntity.remove(KILLED/DISCARDED): ItemScatterer.spawn, NOT gated on doEntityDrops. Returns 'itemxN' names. */
  function scatter(e) {
    if (NS.Hud && NS.Hud.cartGone) NS.Hud.cartGone(e);   // flush + close the open screen first
    var out = [], inv = e.inventory, EL = NS.EntityList;
    if (!inv) return out;
    Mc.generateLoot(e, null);
    for (var i = 0; i < inv.length; i++) {
      var s = inv[i];
      if (s && s.count > 0) {
        if (EL && EL.dropStack) {      // ItemScatterer.spawn(stack): one point per slot, then 10..30-item chunks
          var rnd = EL.random || NS.wrand, left = s.count;
          var px = Math.floor(e.x) + rnd() * 0.75 + 0.125, py = Math.floor(e.y) + rnd() * 0.75, pz = Math.floor(e.z) + rnd() * 0.75 + 0.125;
          while (left > 0) {
            var n = Math.min(left, Math.floor(rnd() * 21) + 10);
            left -= n;
            var g = function () { return NS.U.polarGaussian(rnd) * 0.05; };   // nextGaussian * 0.05
            EL.dropStack(px, py, pz, s.item, n, { tag: s.tag, vx: g(), vy: g() + 0.2, vz: g() });
          }
        }
        out.push(s.item + 'x' + s.count);
      }
      inv[i] = null;
    }
    return out;
  }
  function discard(e) {
    var out = scatter(e);
    if (NS.EntityList && NS.EntityList.remove && NS.EntityList.list && NS.EntityList.list.indexOf(e) >= 0) NS.EntityList.remove(e);
    else e.removed = true;
    return out;
  }

  // ── construction ─────────────────────────────────────────────────────────────────────────
  /** StorageMinecartEntity.generateLoot: the first inventory access rolls LootTable (seed LootTableSeed, 0 = random) into the slots, once. */
  Mc.generateLoot = function (e, player) {
    var Lt = NS.Loot, name = e.lootTable;
    if (!name || !e.inventory) return;
    if (player && NS.Adv && NS.Adv.trigger) NS.Adv.trigger(player, 'minecraft:player_generates_container_loot', { player: player, table: name });
    e.lootTable = null;
    var seed = e.lootTableSeed | 0, rng = Lt && Lt.rng ? Lt.rng(seed || ((NS.wrand() * 4294967296) | 0)) : null, items = [];
    if (Lt && Lt.rollTable) items = Lt.rollTable(String(name).replace(/^minecraft:/, ''), { rng: rng || undefined, luck: player && NS.Effects ? NS.Effects.luckOf(player) : 0, entity: e, x: e.x, y: e.y, z: e.z }) || [];
    var size = Mc.INVENTORY[e.type], free = [], i;
    for (i = 0; i < size; i++) if (!e.inventory[i] || !(e.inventory[i].count > 0)) free.push(i);
    for (i = 0; i < items.length && free.length; i++) {     // LootTable.supplyInventory: shuffled free slots
      var j = rng ? rng.nextInt(free.length) : 0, it = items[i];
      e.inventory[free.splice(j, 1)[0]] = { item: it.item, count: it.count, tag: it.tag };
    }
    e.lootTableSeed = 0;
  };
  /** The constructor + initDataTracker defaults. `opts` may carry `state`/`offset` (CustomDisplayTile), `name`. */
  Mc.init = function (e, opts) {
    opts = opts || {};
    e.cartType = TYPES[e.type];
    e.cartWobbleTicks = 0; e.cartWobbleSide = 1; e.cartWobbleStrength = 0; e.cartDamageWobble = 0;
    e.cartYaw = e.yaw || 0; e.cartYawO = e.cartYaw; e.cartPitch = 0;
    e.yawFlipped = false;
    e.stepHeight = 0;                // Entity.stepHeight default; Physics.move would otherwise step 0.6
    e.cartFall = 0;
    e.cartOnRail = false;
    e.cartPassengers = [];
    e.customDisplay = false;
    if (opts.state !== undefined) { e.customState = opts.state | 0; e.customDisplay = true; }
    if (opts.displayOffset !== undefined) { e.customOffset = opts.displayOffset | 0; e.customDisplay = true; }
    if (opts.name !== undefined) e.cartName = opts.name;
    if (Mc.INVENTORY[e.type]) e.inventory = [];       // StorageMinecart: stacks {item, count, tag}
    if (e.type === 'furnace_minecart') { e.fuel = opts.fuel | 0; e.pushX = opts.pushX || 0; e.pushZ = opts.pushZ || 0; e.cartLit = e.fuel > 0; }
    if (e.type === 'tnt_minecart') { e.cartFuse = opts.fuse !== undefined ? opts.fuse | 0 : -1; }
    if (e.type === 'hopper_minecart') { e.hopperEnabled = true; e.transferCooldown = -1; }
    if (e.type === 'spawner_minecart') {
      e.spawnerLogic = { type: 'mob_spawner', entity: opts.entity || 'pig', delay: 20, minDelay: 200, maxDelay: 800, count: 4, spawnRange: 4, maxNearbyEntities: 6, requiredPlayerRange: 16, potentials: [], x: 0, y: 0, z: 0 };
      Mc.readSpawnerNbt(e, opts);
    }
    if (e.type === 'command_block_minecart') { e.lastExecuted = 0; e.command = ''; e.successCount = 0; e.trackOutput = true; e.lastOutput = null; e.updateLastExecution = true; e.lastExecution = -1; }
    Mc.readNbt(e, opts);
    Mc.refreshDisplay(e);
    Mc.ready = !!(NS.Reg && NS.Reg.ready && NS.Rail);
    return e;
  };
  // MobSpawnerLogic.readNbt/writeNbt (.decomp/net/minecraft/world/MobSpawnerLogic.java:183-245) onto e.spawnerLogic; shorts wrap.
  var sh = function (v) { return (v << 16) >> 16; };
  var entId = function (d) { return d && d.entity && d.entity.id !== undefined ? String(d.entity.id).replace(/^minecraft:/, '') : null; };
  // read/writeCustomDataToNbt of the TNT / furnace / hopper carts: TNTFuse (int, -1 unprimed), Fuel (short) + PushX/PushZ (double),
  // TransferCooldown (int) + Enabled (bool); CustomDisplayTile/DisplayState/DisplayOffset on every cart.
  // NbtHelper.toBlockState / fromBlockState over the registry's property tables (all properties written when the block has any).
  Mc.stateFromNbt = function (n) {
    var R = NS.Reg, S = NS.States;
    if (!n || typeof n.Name !== 'string' || !R || !R.ready) return 0;
    var st = S.stateOf(n.Name), b = S.block[st], P = n.Properties;
    if (!st || !P) return st;
    for (var k = R.propFirst[b]; k < R.propFirst[b + 1]; k++) {
      var v = P[R.propNames[R.propId[k]]];
      if (v === undefined) continue;
      for (var j = 0; j < R.propValN[k]; j++) {
        if (R.valueNames[R.propVals[R.propValOff[k] + j]] !== String(v)) continue;
        var cur = (((st - R.realFirst[b]) / R.propStride[k]) | 0) % R.propValN[k];
        st += (j - cur) * R.propStride[k];
        break;
      }
    }
    return st;
  };
  Mc.stateToNbt = function (st) {
    var R = NS.Reg, S = NS.States, b = S.block[st], o = { Name: 'minecraft:' + R.names[b] }, local = st - R.realFirst[b];
    for (var k = R.propFirst[b]; k < R.propFirst[b + 1]; k++) {
      o.Properties = o.Properties || {};
      o.Properties[R.propNames[R.propId[k]]] = R.valueNames[R.propVals[R.propValOff[k] + (((local / R.propStride[k]) | 0) % R.propValN[k])]];
    }
    return o;
  };
  Mc.readNbt = function (e, n) {
    if (!n) return;
    if (n.CustomDisplayTile) {                           // AbstractMinecartEntity.readCustomDataFromNbt
      e.customState = Mc.stateFromNbt(n.DisplayState); e.customOffset = n.DisplayOffset | 0; e.customDisplay = true;
      Mc.refreshDisplay(e);
    }
    if (Mc.INVENTORY[e.type]) {                          // StorageMinecartEntity.readCustomDataFromNbt
      if (typeof n.LootTable === 'string') { e.lootTable = n.LootTable; e.lootTableSeed = Number(n.LootTableSeed) || 0; }
      else if (Array.isArray(n.Items)) {
        e.lootTable = null; e.inventory = [];
        for (var i = 0; i < n.Items.length; i++) {
          var it = n.Items[i], sl = it && it.Slot & 255;
          if (it && typeof it.id === 'string' && sl < Mc.INVENTORY[e.type] && (it.Count | 0) > 0) e.inventory[sl] = { item: it.id.replace(/^minecraft:/, ''), count: it.Count | 0, tag: it.tag || undefined };
        }
      }
    }
    if (e.type === 'tnt_minecart' && typeof n.TNTFuse === 'number') e.cartFuse = n.TNTFuse | 0;
    if (e.type === 'furnace_minecart') {
      if (n.Fuel !== undefined) { e.fuel = sh(n.Fuel); e.cartLit = e.fuel > 0; }
      if (n.PushX !== undefined) e.pushX = +n.PushX;
      if (n.PushZ !== undefined) e.pushZ = +n.PushZ;
    }
    if (e.type === 'hopper_minecart') {
      if (n.TransferCooldown !== undefined) e.transferCooldown = n.TransferCooldown | 0;
      if (n.Enabled !== undefined) e.hopperEnabled = !!n.Enabled;
    }
    if (e.type === 'command_block_minecart') {          // CommandBlockExecutor.readNbt (LastOutput kept as its JSON text)
      e.command = typeof n.Command === 'string' ? n.Command : '';
      e.successCount = n.SuccessCount | 0;
      if (typeof n.TrackOutput === 'number' || typeof n.TrackOutput === 'boolean') e.trackOutput = !!n.TrackOutput;
      e.lastOutput = typeof n.LastOutput === 'string' && e.trackOutput ? n.LastOutput : null;
      if (n.UpdateLastExecution !== undefined) e.updateLastExecution = !!n.UpdateLastExecution;
      e.lastExecution = e.updateLastExecution && n.LastExecution !== undefined ? +n.LastExecution : -1;
      e.cmdName = '@';                                   // executor CustomName (JSON text); source name = its string
      if (typeof n.CustomName === 'string') { try { var cn = JSON.parse(n.CustomName); e.cmdName = typeof cn === 'string' ? cn : (cn && cn.text) || '@'; } catch (x) { e.cmdName = n.CustomName; } }
    }
  };
  Mc.writeNbt = function (e) {
    var o = {};
    if (e.customDisplay && e.customState !== undefined && NS.Reg && NS.Reg.ready) {   // hasCustomBlock
      o.CustomDisplayTile = true; o.DisplayState = Mc.stateToNbt(e.customState); o.DisplayOffset = e.customOffset | 0;
    }
    if (Mc.INVENTORY[e.type]) {                          // loot table instead of Items while unrolled (StorageMinecartEntity.writeCustomDataToNbt)
      if (e.lootTable) { o.LootTable = e.lootTable; if (e.lootTableSeed) o.LootTableSeed = e.lootTableSeed; }
      else {
        o.Items = [];
        for (var i = 0; i < Mc.INVENTORY[e.type]; i++) { var s = e.inventory && e.inventory[i]; if (s && s.count > 0) o.Items.push({ Slot: i, id: 'minecraft:' + s.item, Count: s.count, tag: s.tag }); }
      }
    }
    if (e.type === 'tnt_minecart') o.TNTFuse = e.cartFuse;
    if (e.type === 'furnace_minecart') { o.Fuel = e.fuel; o.PushX = e.pushX; o.PushZ = e.pushZ; }
    if (e.type === 'hopper_minecart') { o.TransferCooldown = e.transferCooldown; o.Enabled = e.hopperEnabled; }
    if (e.spawnerLogic) { var w = Mc.writeSpawnerNbt(e); for (var wk in w) o[wk] = w[wk]; }   // MobSpawnerLogic.writeNbt
    if (e.type === 'command_block_minecart') {
      o.Command = e.command; o.SuccessCount = e.successCount | 0; o.TrackOutput = !!e.trackOutput;
      o.CustomName = JSON.stringify({ text: e.cmdName || '@' });
      if (e.lastOutput != null && e.trackOutput) o.LastOutput = e.lastOutput;
      o.UpdateLastExecution = e.updateLastExecution !== false;
      if (o.UpdateLastExecution && e.lastExecution > 0) o.LastExecution = e.lastExecution;
    }
    return o;
  };
  Mc.entityDataRequiresOperator = function (type) { return type === 'spawner_minecart' || type === 'command_block_minecart'; };   // Spawner+CommandBlockMinecartEntity.entityDataRequiresOperator
  Mc.readSpawnerNbt = function (e, n) {
    var L = e.spawnerLogic;
    if (!L || !n) return;
    L.delay = sh(n.Delay);   // MobSpawnerLogic.readNbt getShort("Delay"): absent reads 0
    var pot = Array.isArray(n.SpawnPotentials) ? n.SpawnPotentials : null, id;
    if (pot) {
      L.potentials = [];
      for (var i = 0; i < pot.length; i++) { id = entId(pot[i] && pot[i].data); if (id) L.potentials.push({ id: id, weight: pot[i].weight === undefined ? 1 : pot[i].weight | 0, data: pot[i].data }); }
    }
    if (n.SpawnData && (id = entId(n.SpawnData))) { L.entity = id; L.spawnData = n.SpawnData; }
    else if (L.potentials.length && n.SpawnData === undefined) L.entity = Mc.pickPotential(L);   // no SpawnData: first roll of the pool
    if (n.MinSpawnDelay !== undefined) { L.minDelay = sh(n.MinSpawnDelay); L.maxDelay = sh(n.MaxSpawnDelay); L.count = sh(n.SpawnCount); }
    if (n.MaxNearbyEntities !== undefined) { L.maxNearbyEntities = sh(n.MaxNearbyEntities); L.requiredPlayerRange = sh(n.RequiredPlayerRange); }
    if (n.SpawnRange !== undefined) L.spawnRange = sh(n.SpawnRange);
  };
  Mc.writeSpawnerNbt = function (e) {
    var L = e.spawnerLogic, o = { Delay: L.delay, MinSpawnDelay: L.minDelay, MaxSpawnDelay: L.maxDelay, SpawnCount: L.count,
      MaxNearbyEntities: L.maxNearbyEntities, RequiredPlayerRange: L.requiredPlayerRange, SpawnRange: L.spawnRange,
      SpawnData: L.spawnData || { entity: { id: 'minecraft:' + L.entity } }, SpawnPotentials: [] };
    for (var i = 0; i < L.potentials.length; i++) o.SpawnPotentials.push({ data: L.potentials[i].data, weight: L.potentials[i].weight });
    return o;
  };
  /** DataPool.getOrEmpty: weighted choice (updateSpawns' SpawnPotentials roll). */
  Mc.pickPotential = function (L) {
    var tot = 0, i;
    for (i = 0; i < L.potentials.length; i++) tot += Math.max(0, L.potentials[i].weight);
    if (tot <= 0) return L.entity;
    var r = NS.wrand() * tot;
    for (i = 0; i < L.potentials.length; i++) { r -= Math.max(0, L.potentials[i].weight); if (r < 0) return L.potentials[i].id; }
    return L.entity;
  };
  /** getContainedBlock / getBlockOffset -> e.displayBlockState / e.displayOffset (0 = air = nothing drawn). */
  Mc.refreshDisplay = function (e) {
    var S = NS.States, st = 0;
    if (e.customDisplay && e.customState !== undefined) st = e.customState;
    else if (Mc.DISPLAY[e.type] && NS.Reg && NS.Reg.ready) {
      st = S.stateOf(Mc.DISPLAY[e.type]);
      var B = NS.Behave;
      if (B && B.setProp) {
        if (e.type === 'chest_minecart' || e.type === 'furnace_minecart') st = B.setProp(st, 'facing', 'north');
        if (e.type === 'furnace_minecart') st = B.setProp(st, 'lit', e.cartLit ? 'true' : 'false');
      }
    }
    e.displayBlockState = st;
    e.displayOffset = (e.customDisplay && e.customOffset !== undefined) ? e.customOffset : (Mc.OFFSET[e.type] !== undefined ? Mc.OFFSET[e.type] : 6);
    return st;
  };

  // ── rail geometry ────────────────────────────────────────────────────────────────────────
  /** The rail cell a cart at (x,y,z) uses: the cell, or the one below it when that holds a rail. */
  function railCell(x, y, z) {
    var bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    if (isRailState(blockAt(bx, by - 1, bz))) by--;
    return [bx, by, bz];
  }
  /** snapPositionToRail: {x, y, z} or null. */
  Mc.snapPositionToRail = function (x, y, z) {
    var c = railCell(x, y, z), bx = c[0], by = c[1], bz = c[2];
    var st = blockAt(bx, by, bz);
    if (!isRailState(st)) return null;
    var pr = ADJ[shapeOf(st)], a = pr[0], b = pr[1];
    var x1 = bx + 0.5 + a[0] * 0.5, y1 = by + 0.0625 + a[1] * 0.5, z1 = bz + 0.5 + a[2] * 0.5;
    var x2 = bx + 0.5 + b[0] * 0.5, y2 = by + 0.0625 + b[1] * 0.5, z2 = bz + 0.5 + b[2] * 0.5;
    var dx = x2 - x1, dy = (y2 - y1) * 2.0, dz = z2 - z1, t;
    if (dx === 0) t = z - bz;
    else if (dz === 0) t = x - bx;
    else t = ((x - x1) * dx + (z - z1) * dz) * 2.0;
    x = x1 + dx * t; y = y1 + dy * t; z = z1 + dz * t;
    if (dy < 0) y += 1; else if (dy > 0) y += 0.5;
    return { x: x, y: y, z: z };
  };
  /** snapPositionToRailWithOffset (used by the hopper/detector/other callers; ported for completeness). */
  Mc.snapPositionToRailWithOffset = function (x, y, z, off) {
    var c = railCell(x, y, z), bx = c[0], by = c[1], bz = c[2];
    var st = blockAt(bx, by, bz);
    if (!isRailState(st)) return null;
    var sh = shapeOf(st);
    y = by;
    if (sh >= AE && sh <= AS) y = by + 1;
    var pr = ADJ[sh], a = pr[0], b = pr[1];
    var dx = b[0] - a[0], dz = b[2] - a[2], d = Math.sqrt(dx * dx + dz * dz);
    dx /= d; dz /= d;
    x += dx * off; z += dz * off;
    if (a[1] !== 0 && Math.floor(x) - bx === a[0] && Math.floor(z) - bz === a[2]) y += a[1];
    else if (b[1] !== 0 && Math.floor(x) - bx === b[0] && Math.floor(z) - bz === b[2]) y += b[1];
    return Mc.snapPositionToRail(x, y, z);
  };

  // ── per-type overridables ────────────────────────────────────────────────────────────────
  Mc.SLOWDOWN = 0.96; Mc.SLOPE_PULL = 0.0078125;   // AbstractMinecartEntity.applySlowdown / moveOnRail (tunable for the lockstep check's break injection)
  Mc.maxSpeed = function (e) {
    var w = touchingWater(e);
    return e.type === 'furnace_minecart' ? (w ? 3.0 : 4.0) / 20.0 : (w ? 4.0 : 8.0) / 20.0;
  };
  function applySlowdown(e) {
    if (e.type === 'furnace_minecart') {
      var p = e.pushX * e.pushX + e.pushZ * e.pushZ;
      if (p > 1.0E-7) {
        p = Math.sqrt(p); e.pushX /= p; e.pushZ /= p;
        var nx = e.vx * 0.8 + e.pushX, nz = e.vz * 0.8 + e.pushZ;
        if (touchingWater(e)) { nx *= 0.1; nz *= 0.1; }
        e.vx = nx; e.vz = nz; e.vy = 0;
      } else { e.vx *= 0.98; e.vz *= 0.98; e.vy = 0; }
    }
    var f = hasPassengers(e) ? 0.997 : Mc.SLOWDOWN;
    if (e.type === 'chest_minecart' || e.type === 'hopper_minecart') {
      // StorageMinecartEntity.applySlowdown: lootTableId != null -> 0.98 flat, else 0.98 + (15 - comparator output) * 0.001, no passenger branch
      f = e.lootTable ? Math.fround(0.98) : Math.fround(0.98 + (15 - cartComparator(e)) * Math.fround(0.001));
    }
    e.vx *= f; e.vy = 0; e.vz *= f;
    if (touchingWater(e)) { var w = Math.fround(0.95); e.vx *= w; e.vy *= w; e.vz *= w; }
  }
  /** ScreenHandler.calculateComparatorOutput(inventory): floor(sum(count/min(64,max)) / size * 14) + (any ? 1 : 0). */
  function cartComparator(e) {
    var Iv = NS.Inventory, inv = e.inventory || [], size = Mc.INVENTORY[e.type], n = 0, f = 0;
    for (var i = 0; i < size; i++) {
      var s = inv[i];
      if (!s || !(s.count > 0)) continue;
      var cap = Iv && Iv.maxStackSize ? Iv.maxStackSize(Iv.stack(s.item, 1)) : 64;
      f += s.count / Math.min(64, cap); n++;
    }
    return Math.floor(f / size * 14) + (n > 0 ? 1 : 0);
  }
  Mc.onActivatorRail = function (e, powered) {
    var t = e.type;
    if (t === 'minecart') {
      if (powered) {
        if (hasPassengers(e)) removeAllPassengers(e);
        if (e.cartWobbleTicks === 0) {
          e.cartWobbleSide = -e.cartWobbleSide; e.cartWobbleTicks = 10; e.cartWobbleStrength = 50.0;
          e.cartDamageWobble = 10;
        }
      }
    } else if (t === 'hopper_minecart') {
      var en = !powered;
      if (en !== e.hopperEnabled) e.hopperEnabled = en;
    } else if (t === 'tnt_minecart') {
      if (powered && e.cartFuse < 0) Mc.prime(e);
    } else if (t === 'command_block_minecart') {
      if (powered && e.age - e.lastExecuted >= 4) {
        Mc.commandRuns = (Mc.commandRuns | 0) + 1;
        e.commandRuns = (e.commandRuns | 0) + 1;
        e.lastExecuted = e.age;
        Mc.commandExecute(e);
      }
    }
  };

  /** CommandBlockExecutor.execute for the cart: source = permission level 2 at the cart's position/rotation; successCount
   *  counts successful commands (this engine runs one per line), LastOutput = the feedback when TrackOutput. */
  Mc.commandExecute = function (e) {
    var C = NS.Commands, now = (NS.Main && NS.Main.ticks) | 0;
    if (now === e.lastExecution) return false;          // same world tick: already ran
    if (typeof e.command === 'string' && e.command.toLowerCase() === 'searge') {
      e.lastOutput = JSON.stringify({ text: '#itzlipofutzli' }); e.successCount = 1; return true;
    }
    e.successCount = 0;
    if (!e.command || !C) { e.lastExecution = e.updateLastExecution !== false ? now : -1; return true; }
    e.lastOutput = null;
    var r = C.run(e.command, null, { level: 2, name: e.cmdName || '@', displayName: e.customName || (NS.Text ? NS.Text.translate('entity.minecraft.command_block_minecart') : '@'), x: e.x, y: e.y, z: e.z, yaw: e.yaw || 0, pitch: 0, entity: e });
    if (r.ok && (r.result === undefined || r.result > 0)) e.successCount = 1;
    if (e.trackOutput && C.ruleGet('sendCommandFeedback') !== 'false' && r.lines.length) e.lastOutput = JSON.stringify({ text: '[' + new Date().toTimeString().slice(0, 8) + '] ' + r.lines[r.lines.length - 1] });
    e.lastExecution = e.updateLastExecution !== false ? now : -1;
    return true;
  };

  // ── moveOffRail / moveOnRail ─────────────────────────────────────────────────────────────
  function moveOffRail(e) {
    var m = Mc.maxSpeed(e);
    e.vx = Math.max(-m, Math.min(m, e.vx));
    e.vz = Math.max(-m, Math.min(m, e.vz));
    if (e.onGround) { e.vx *= 0.5; e.vy *= 0.5; e.vz *= 0.5; }
    var y0 = e.y;
    move(e, e.vx, e.vy, e.vz);
    trackFall(e, y0);
    if (!e.onGround) { e.vx *= 0.95; e.vy *= 0.95; e.vz *= 0.95; }
  }

  function willHitBlockAt(x, y, z) { return isSolidBlock(blockAt(x, y, z)); }

  function moveOnRail(e, bx, by, bz, st) {
    e.cartFall = 0; e.fallDistance = 0;                          // onLanding()
    var X = e.x, Y = e.y, Z = e.z;
    var snap0 = Mc.snapPositionToRail(X, Y, Z);
    Y = by;
    var powerBoost = false, brake = false;
    if (blockName(st) === 'powered_rail') {
      powerBoost = NS.Behave.propName(st, 'powered') === 'true';
      brake = !powerBoost;
    }
    var d = Mc.SLOPE_PULL;
    if (touchingWater(e)) d *= 0.2;
    var sh = shapeOf(st);
    switch (sh) {
      case AE: e.vx += -d; Y++; break;
      case AW: e.vx += d; Y++; break;
      case AN: e.vz += d; Y++; break;
      case AS: e.vz += -d; Y++; break;
    }
    var pr = ADJ[sh], a = pr[0], b = pr[1];
    var dx = b[0] - a[0], dz = b[2] - a[2];
    var len = Math.sqrt(dx * dx + dz * dz);
    if (e.vx * dx + e.vz * dz < 0) { dx = -dx; dz = -dz; }
    var sp = Math.min(2.0, hlen(e));
    e.vx = sp * dx / len; e.vz = sp * dz / len;
    var pax = e.cartPassengers && e.cartPassengers[0];
    if (pax && (pax.type === 'player' || pax.isPlayer)) {   // `instanceof PlayerEntity`
      // P.vx is 0 while mounted (P.tickMounted), so the velocity is rebuilt from the rider's input:
      // Entity.movementInputToVelocity at the player's 0.1 ground speed (forward = (sin yaw, -cos yaw)).
      var ri = e.riderInput, pvx = pax.vx || 0, pvz = pax.vz || 0;
      if (ri && !pvx && !pvz) {
        var il = ri.forwardSpeed * ri.forwardSpeed + ri.sidewaysSpeed * ri.sidewaysSpeed;
        if (il >= 1.0E-7) {
          var ik = 0.1 / Math.max(Math.sqrt(il), 1), sy = Math.sin(ri.yaw), cy = Math.cos(ri.yaw);
          pvx = (ri.sidewaysSpeed * cy + ri.forwardSpeed * sy) * ik;
          pvz = (ri.sidewaysSpeed * sy - ri.forwardSpeed * cy) * ik;
        }
      }
      var pv2 = pvx * pvx + pvz * pvz;
      var cv2 = e.vx * e.vx + e.vz * e.vz;
      if (pv2 > 1.0E-4 && cv2 < 0.01) { e.vx += pvx * 0.1; e.vz += pvz * 0.1; brake = false; }
    }
    if (brake) {
      if (hlen(e) < 0.03) { e.vx = 0; e.vy = 0; e.vz = 0; }
      else { e.vx *= 0.5; e.vy *= 0.0; e.vz *= 0.5; }
    }
    var ax = bx + 0.5 + a[0] * 0.5, az = bz + 0.5 + a[2] * 0.5;
    var cx = bx + 0.5 + b[0] * 0.5, cz = bz + 0.5 + b[2] * 0.5;
    dx = cx - ax; dz = cz - az;
    var t;
    if (dx === 0) t = Z - bz;
    else if (dz === 0) t = X - bx;
    else t = ((X - ax) * dx + (Z - az) * dz) * 2.0;
    X = ax + dx * t; Z = az + dz * t;
    e.x = X; e.y = Y; e.z = Z;
    var f = hasPassengers(e) ? 0.75 : 1.0;
    var ms = Mc.maxSpeed(e);
    var y0 = e.y;
    move(e, Math.max(-ms, Math.min(ms, f * e.vx)), 0.0, Math.max(-ms, Math.min(ms, f * e.vz)));
    if (a[1] !== 0 && Math.floor(e.x) - bx === a[0] && Math.floor(e.z) - bz === a[2]) e.y += a[1];
    else if (b[1] !== 0 && Math.floor(e.x) - bx === b[0] && Math.floor(e.z) - bz === b[2]) e.y += b[1];
    applySlowdown(e);
    var snap1 = Mc.snapPositionToRail(e.x, e.y, e.z);
    if (snap1 && snap0) {
      var dy = (snap0.y - snap1.y) * 0.05;
      var hl = hlen(e);
      if (hl > 0) { var k = (hl + dy) / hl; e.vx *= k; e.vz *= k; }
      e.y = snap1.y;
    }
    var nx = Math.floor(e.x), nz = Math.floor(e.z);
    if (nx !== bx || nz !== bz) {
      var h2 = hlen(e);
      e.vx = h2 * (nx - bx); e.vz = h2 * (nz - bz);
    }
    if (powerBoost) {
      var h3 = hlen(e);
      if (h3 > 0.01) {
        e.vx += e.vx / h3 * 0.06; e.vz += e.vz / h3 * 0.06;
      } else {
        var vx = e.vx, vz = e.vz;
        if (sh === EW) {
          if (willHitBlockAt(bx - 1, by, bz)) vx = 0.02;
          else if (willHitBlockAt(bx + 1, by, bz)) vx = -0.02;
        } else {
          if (sh !== NS_) { furnacePost(e); return; }
          if (willHitBlockAt(bx, by, bz - 1)) vz = 0.02;
          else if (willHitBlockAt(bx, by, bz + 1)) vz = -0.02;
        }
        e.vx = vx; e.vz = vz;
      }
    }
    furnacePost(e);
  }
  /** FurnaceMinecartEntity.moveOnRail's tail (it runs after super.moveOnRail, including its early `return`). */
  function furnacePost(e) {
    if (e.type !== 'furnace_minecart') return;
    var h2 = e.vx * e.vx + e.vz * e.vz;
    var p2 = e.pushX * e.pushX + e.pushZ * e.pushZ;
    if (p2 > 1.0E-4 && h2 > 0.001) {
      var s = Math.sqrt(h2), p = Math.sqrt(p2);
      e.pushX = e.vx / s * p; e.pushZ = e.vz / s * p;
    }
  }

  // ── fall bookkeeping (Entity.fall -> TntMinecartEntity.handleFallDamage) ──────────────────
  function trackFall(e, y0) {
    var dy = e.y - y0;
    if (e.onGround) {
      var fd = e.cartFall; e.cartFall = 0;
      if (fd >= 3.0 && e.type === 'tnt_minecart') { var r = fd / 10.0; Mc.explode(e, r * r); }
    } else if (dy < 0) e.cartFall += -dy;
  }

  // ── tick ─────────────────────────────────────────────────────────────────────────────────
  /** MovingMinecartSoundInstance.tick: a looping entity.minecart.riding, volume lerp(clamp(speed,0,.5),0,.7) once speed >= .01. */
  /** MinecartInsideSoundInstance x2 (ClientPlayerEntity): entity.minecart.inside / .underwater while the player rides; only the variant matching isSubmergedInWater is audible, volume lerp(clamp(speed,0,1),0,.75) from speed >= .01. */
  Mc.insideSound = function (e) {
    var S = NS.Sound, P = NS.Player, vs = e.insideVoices;
    if (!S || !S.loopVoice) return;
    if (e.removed || !P || P.vehicle !== e) { if (vs) { vs[0].stop(); vs[1].stop(); e.insideVoices = null; } return; }
    if (e.silent) { if (vs) { vs[0].set(0); vs[1].set(0); } return; }
    if (!vs) vs = e.insideVoices = [S.loopVoice('entity.minecart.inside', 'neutral'), S.loopVoice('entity.minecart.inside.underwater', 'neutral')];
    var h = Math.fround(Math.sqrt(e.vx * e.vx + e.vz * e.vz)), v = h >= 0.01 ? Math.min(h, 1) * 0.75 : 0, sub = !!P.eyeInWater;
    vs[0].set(sub ? 0 : v, 1, P.x, P.y, P.z); vs[1].set(sub ? v : 0, 1, P.x, P.y, P.z);
  };
  Mc.rollSound = function (e) {
    var S = NS.Sound, vc = e.cartVoice;
    Mc.insideSound(e);
    if (e.removed) { if (vc) { vc.stop(); e.cartVoice = null; } return; }
    if (!S || !S.loopVoice || e.silent) { if (vc) vc.set(0, 1, e.x, e.y, e.z); return; }
    if (!vc) vc = e.cartVoice = S.loopVoice('entity.minecart.riding', 'neutral');
    var h = Math.fround(Math.sqrt(e.vx * e.vx + e.vz * e.vz));
    if (h >= 0.01) { e.cartDist = Math.min(1, (e.cartDist || 0) + 0.0025); vc.set(Math.min(h, 0.5) * 0.7, 1, e.x, e.y, e.z); }
    else { e.cartDist = 0; vc.set(0, 1, e.x, e.y, e.z); }
  };
  /**
   * The integrated client's copy of a cart (AbstractMinecartEntity.updateTrackedPositionAndAngles + the client branch of tick):
   * the tracker sends x/y/z/yaw/pitch every 3 ticks (interval), the client lerps over interval + 2 = 5 steps.
   * c = { x,y,z,yaw,pitch (+ the O previous-tick values), tx,ty,tz,tyaw,tpitch, steps }.
   */
  var CL = Mc.Client = { EXTRA: 2, INTERVAL: 3 };
  CL.wrap = function (d) { var f = d % 360; if (f >= 180) f -= 360; if (f < -180) f += 360; return f; };
  CL.make = function (e) {
    var yaw = e.cartYaw || 0;
    return { x: e.x, y: e.y, z: e.z, yaw: yaw, pitch: 0, xO: e.x, yO: e.y, zO: e.z, yawO: yaw, pitchO: 0,
      tx: e.x, ty: e.y, tz: e.z, tyaw: yaw, tpitch: 0, steps: 0 };
  };
  CL.track = function (c, x, y, z, yaw, pitch) {
    c.tx = x; c.ty = y; c.tz = z; c.tyaw = yaw; c.tpitch = pitch; c.steps = CL.INTERVAL + CL.EXTRA;
  };
  CL.tick = function (c) {
    c.xO = c.x; c.yO = c.y; c.zO = c.z; c.yawO = c.yaw; c.pitchO = c.pitch;
    if (c.steps > 0) {
      var n = c.steps;
      c.x += (c.tx - c.x) / n; c.y += (c.ty - c.y) / n; c.z += (c.tz - c.z) / n;
      c.yaw = Math.fround(c.yaw + Math.fround(CL.wrap(c.tyaw - c.yaw)) / n);
      c.pitch = Math.fround(c.pitch + Math.fround(c.tpitch - c.pitch) / n);
      c.steps--;
    }
  };
  /** per server tick: a tracker packet every INTERVAL ticks, then the client tick */
  Mc.clientStep = function (e) {
    var c = e.cartClient || (e.cartClient = CL.make(e));
    if ((e.age | 0) % CL.INTERVAL === 0) CL.track(c, e.x, e.y, e.z, e.cartYaw || 0, e.cartPitch || 0);
    CL.tick(c);
  };
  Mc.tick = function (e) {
    Mc.rollSound(e);
    if (e.removed) return;
    if (e.cartType === undefined) Mc.init(e);
    var yaw0 = (e.yaw === undefined) ? 0 : e.yaw;
    e.cartYawO = yaw0;
    e.age++;
    if (e.cartWobbleTicks > 0) e.cartWobbleTicks--;
    if (e.cartWobbleStrength > 0) e.cartWobbleStrength -= 1.0;
    e.cartDamageWobble = e.cartWobbleTicks;
    // attemptTickInVoid: below the world bottom - 64
    var minY = (NS.CFG && NS.CFG.WORLD_MIN_Y !== undefined) ? NS.CFG.WORLD_MIN_Y : -64;
    if (e.y < minY - 64) { discard(e); return; }
    if (!e.noGravity) e.vy += touchingWater(e) ? -0.005 : -0.04;
    var c = railCell(e.x, e.y, e.z), bx = c[0], by = c[1], bz = c[2];
    var st = blockAt(bx, by, bz);
    if (isRailState(st)) {
      e.cartOnRail = true;
      moveOnRail(e, bx, by, bz, st);
      if (NS.GameEvent && (Math.abs(e.vx) + Math.abs(e.vz)) > 0.01) NS.GameEvent.emit('minecart_moving', e.x, e.y, e.z, e);   // AbstractMinecartEntity.moveOnRail
      if (blockName(st) === 'activator_rail') Mc.onActivatorRail(e, NS.Behave.propName(st, 'powered') === 'true');
    } else { e.cartOnRail = false; moveOffRail(e); }
    Mc.detectorCollide(e);                                          // DetectorRailBlock.onEntityCollision
    if (NS.Use && NS.Use.entityCollide) NS.Use.entityCollide(e);   // checkBlockCollision (cobweb, berry bush, plates, ...)
    e.cartPitch = 0; e.pitch = 0;
    var dx = e.px - e.x, dz = e.pz - e.z;
    if (e.px === undefined) { dx = 0; dz = 0; }
    var yaw = yaw0;
    if (dx * dx + dz * dz > 0.001) {
      yaw = Math.fround(Math.atan2(dz, dx) * 180.0 / Math.PI);
      if (e.yawFlipped) yaw += 180.0;
    }
    var dd = wrapDegrees(yaw - yaw0);
    if (dd < -170.0 || dd >= 170.0) { yaw += 180.0; e.yawFlipped = !e.yawFlipped; }
    e.yaw = yaw; e.cartYaw = yaw;
    Mc.clientStep(e);
    // AbstractMinecartEntity.tick: a RIDEABLE cart at horizontalLengthSquared > 0.01 picks up (startRiding) the first pushable
    // non-player/golem/cart mob while empty, else pushAwayFrom; any other cart does the cart-vs-cart pushAwayFrom (o.pushAwayFrom(e)).
    var EL = NS.EntityList;
    if (EL && EL.list) {
      var hw = (e.width || 0.98) * 0.5 + 0.2, hh = e.height || 0.7;
      var pick = e.cartType === 'RIDEABLE' && e.vx * e.vx + e.vz * e.vz > 0.01;
      for (var i = 0; i < EL.list.length; i++) {
        var o = EL.list[i];
        if (o === e || o.removed) continue;
        var isC = Mc.isCart(o.type);
        if (!pick && !isC) continue;
        var shove = pick && !isC && (o.type === 'iron_golem' || o.type === 'player' || hasPassengers(e) || o.vehicle);
        if (pick && !isC && !shove && (o.maxHealth === undefined || o.dead || o.spectator || o.type === 'bat')) continue;
        if (shove && (o.dead || o.spectator)) continue;
        var ow = (o.width || (isC ? 0.98 : 0.6)) * 0.5;
        if (!(Math.abs(o.x - e.x) < hw + ow && Math.abs(o.z - e.z) < hw + ow && o.y < e.y + hh && o.y + (o.height || 0.7) > e.y)) continue;
        if (isC) Mc.pushAwayFrom(o, e);
        else if (shove) { if (NS.Ai && NS.Ai.pushAwayFrom) NS.Ai.pushAwayFrom(o, e); }   // $$15.pushAwayFrom(this)
        else if (!hasPassengers(e) && !o.vehicle && NS.Raid && NS.Raid.startRiding && NS.Raid.startRiding(o, e)) e.cartPassengers = [o];
      }
    }
    if (NS.Physics && NS.Physics.fluidPush) NS.Physics.fluidPush(e);   // updateWaterState -> updateMovementInFluid
    if (inLava(e)) {
      if (NS.EntityList && NS.EntityList.lavaBurnSound) NS.EntityList.lavaBurnSound(e);
      if (NS.Combat && NS.Combat.igniteForSeconds) NS.Combat.igniteForSeconds(e, 15);   // setOnFireFromLava (15 s + LAVA 4)
      Mc.damage(e, 4, { fire: true });
      e.cartFall *= 0.5;
    }
    if (e.spawnerLogic) {            // SpawnerMinecartEntity.tick = super.tick() THEN logic.serverTick/clientTick(getBlockPos()); the logic is block-entity shaped
      var L = e.spawnerLogic;
      L.x = Math.floor(e.x); L.y = Math.floor(e.y); L.z = Math.floor(e.z);
      var d0 = L.delay;
      if (NS.Spawn && NS.Spawn.tickSpawner) NS.Spawn.tickSpawner(L);
      if (L.delay > d0 && L.potentials.length) L.entity = Mc.pickPotential(L);   // updateSpawns re-rolled the delay -> new SpawnPotentials entry
      if (NS.Spawner && NS.Spawner.clientTick) NS.Spawner.clientTick(L);
    }
    // per-type tails (each subclass's tick() after super.tick())
    if (e.type === 'furnace_minecart') {
      if (e.fuel > 0) e.fuel--;
      if (e.fuel <= 0) { e.pushX = 0; e.pushZ = 0; }
      var lit = e.fuel > 0;
      if (lit !== e.cartLit) { e.cartLit = lit; Mc.refreshDisplay(e); }
      if (lit && (rnd()() * 4 | 0) === 0 && NS.Particle && NS.Particle.spawn) NS.Particle.spawn('large_smoke', e.x, e.y + 0.8, e.z, 0, 0, 0);   // isLit() && nextInt(4) == 0
    } else if (e.type === 'tnt_minecart') {
      if (e.cartFuse > 0) {
        e.cartFuse--;
        if (NS.Particle && NS.Particle.spawn) NS.Particle.spawn('smoke', e.x, e.y + 0.5, e.z, 0, 0, 0);   // tick(): while fuse > 0
      } else if (e.cartFuse === 0) Mc.explode(e, e.vx * e.vx + e.vz * e.vz);
      if (e.horizontalCollision) {                     // no removed check: vanilla explodes again after the fuse blast
        var h2 = e.vx * e.vx + e.vz * e.vz;
        if (h2 >= Math.fround(0.01)) Mc.explode(e, h2);
      }
    } else if (e.type === 'hopper_minecart') {
      if (e.hopperEnabled) {
        // `currentBlockPos` is the constant BlockPos.ORIGIN: off (0,0,0) the cooldown is reset to 0 every tick.
        if (Math.floor(e.x) === 0 && Math.floor(e.y) === 0 && Math.floor(e.z) === 0) e.transferCooldown--;
        else e.transferCooldown = 0;
        if (!(e.transferCooldown > 0)) {
          e.transferCooldown = 0;
          if (Mc.canOperate(e)) e.transferCooldown = 4;
        }
      }
    }
  };
  /**
   * HopperMinecartEntity.canOperate = `HopperBlockEntity.extract(world, this)`: one item out of the container above
   * (its DOWN face), else the item entities in the input box (INSIDE 2..14 x 11..16 + ABOVE 16..32, from the cart's
   * hopper position y + 0.5) is pushed into the cart's 5 slots; true once one is fully absorbed.
   */
  function cartPut(e, name, n, tag) {
    var Iv = NS.Inventory, inv = e.inventory;
    for (var i = 0; i < 5 && n > 0; i++) {
      var s = inv[i];
      var cap = Iv && Iv.maxStackSize ? Iv.maxStackSize(Iv.stack(name, 1)) : 64;
      if (!s || !(s.count > 0)) { var m = Math.min(n, cap); inv[i] = { item: name, count: m, tag: tag || undefined }; n -= m; }
      else if (s.item === name && JSON.stringify(s.tag || null) === JSON.stringify(tag || null) && s.count < cap) { var m2 = Math.min(n, cap - s.count); s.count += m2; n -= m2; }
    }
    return n;
  }
  Mc.canOperate = function (e) {
    var BE = NS.BlockEntities, EL = NS.EntityList, Items = NS.Items;
    if (!e.inventory) e.inventory = [];
    var src = BE && BE.get ? BE.get(Math.floor(e.x), Math.floor(e.y + 1.5), Math.floor(e.z)) : null;
    if (src && BE.isHopperTarget(src.type) && src.items) {
      var slots = BE.hopperSlotsFor(src.type, 1), Iv = NS.Inventory;       // leaving through the source's bottom
      for (var k = 0; k < slots.length; k++) {
        var st = src.items[slots[k]];
        if (Iv.isEmpty(st) || !BE.hopperMayTake(src, slots[k], st)) continue;
        if (cartPut(e, Items.nameOf(st.i), 1, st.tag) > 0) continue;
        st.n--;
        if (st.n <= 0) {
          if (NS.Menu && NS.Menu.furnaceSetItem && /furnace|smoker/.test(src.type)) NS.Menu.furnaceSetItem(src, slots[k], null);
          else src.items[slots[k]] = null;
        }
        return true;
      }
      return false;
    }
    // getInventoryAt's entity branch: a chest/hopper cart in the +-0.5 box round (x, y+1.5, z); an inventory there ends extract (no item scan)
    var cy = e.y + 1.5, ES = EL && EL.list;
    for (var q = 0; ES && q < ES.length; q++) {
      var o = ES[q];
      if (o === e || o.removed || !Mc.INVENTORY[o.type] || !o.inventory) continue;
      Mc.generateLoot(o, null);
      if (o.x + 0.49 < e.x - 0.5 || o.x - 0.49 > e.x + 0.5 || o.z + 0.49 < e.z - 0.5 || o.z - 0.49 > e.z + 0.5 || o.y + 0.7 < cy - 0.5 || o.y > cy + 0.5) continue;
      for (var k2 = 0; k2 < Mc.INVENTORY[o.type]; k2++) {
        var os = o.inventory[k2];
        if (!os || !(os.count > 0) || cartPut(e, os.item, 1, os.tag) > 0) continue;
        if (--os.count <= 0) o.inventory[k2] = null;
        return true;
      }
      return false;
    }
    if (!EL || !EL.list) return false;
    var hy = e.y + 0.5;
    for (var j = 0; j < EL.list.length; j++) {
      var it = EL.list[j];
      if (it.removed || it.type !== 'item') continue;
      var hw = (it.width || 0.25) * 0.5;
      var ih = it.height || 0.25, lo = hy - 0.5;
      // INSIDE_SHAPE (x/z 2..14, y 11/16..1) or ABOVE_SHAPE (full column, y 1..2): the item's AABB must meet one of them
      var hit = false;
      for (var bx = 0; bx < 2 && !hit; bx++) {
        var r = bx ? 0.5 : 0.375, y0 = lo + (bx ? 1 : 11 / 16), y1 = lo + (bx ? 2 : 1);
        hit = !(it.x + hw < e.x - r || it.x - hw > e.x + r || it.z + hw < e.z - r || it.z - hw > e.z + r || it.y + ih < y0 || it.y > y1);
      }
      if (!hit) continue;
      var name = typeof it.item === 'string' ? it.item : (Items && Items.names ? Items.names[it.item] : null);
      if (!name) continue;
      it.count = cartPut(e, name, it.count | 0, it.tag);
      if (it.count <= 0) { EL.remove(it); return true; }     // extract(Hopper, ItemEntity): true once fully absorbed
    }
    // fallback: first item in the cart's own box grown 0.25 in x/z; absorbed, but canOperate stays false (no cooldown)
    for (var j2 = 0; j2 < EL.list.length; j2++) {
      var it2 = EL.list[j2];
      if (it2.removed || it2.type !== 'item') continue;
      var w2 = (it2.width || 0.25) * 0.5;
      if (it2.x + w2 < e.x - 0.74 || it2.x - w2 > e.x + 0.74 || it2.z + w2 < e.z - 0.74 || it2.z - w2 > e.z + 0.74) continue;
      if (it2.y + (it2.height || 0.25) < e.y || it2.y > e.y + 0.7) continue;
      var n2 = typeof it2.item === 'string' ? it2.item : (Items && Items.names ? Items.names[it2.item] : null);
      if (!n2) continue;
      it2.count = cartPut(e, n2, it2.count | 0, it2.tag);
      if (it2.count <= 0) EL.remove(it2);
      break;
    }
    return false;
  };

  /** Insert up to n of `name` into a VALID_INVENTORIES cart's slots; returns the count left over. */
  Mc.insertInto = function (cart, name, n, tag) {
    if (!cart.inventory) cart.inventory = [];
    return cartPut(cart, name, n, tag);
  };
  /**
   * HopperBlockEntity.getInventoryAt(world, x, y, z): the block entity of the cell if it is a hopper target, else the
   * first chest/hopper cart in the +-0.5 box round the cell centre; { be } | { cart } | null.
   */
  Mc.getInventoryAt = function (x, y, z) {
    var BE = NS.BlockEntities, EL = NS.EntityList;
    var be = BE && BE.get ? BE.get(x, y, z) : null;
    if (be && BE.isHopperTarget(be.type) && be.items) return { be: be };
    var ES = EL && EL.list, cx = x + 0.5, cy = y + 0.5, cz = z + 0.5;
    for (var q = 0; ES && q < ES.length; q++) {
      var o = ES[q];
      if (o.removed || !Mc.INVENTORY[o.type] || !o.inventory) continue;
      if (o.x + 0.49 < cx - 0.5 || o.x - 0.49 > cx + 0.5 || o.z + 0.49 < cz - 0.5 || o.z - 0.49 > cz + 0.5 || o.y + 0.7 < cy - 0.5 || o.y > cy + 0.5) continue;
      Mc.generateLoot(o, null);
      return { cart: o };
    }
    return null;
  };

  /** AbstractMinecartEntity.pushAwayFrom(this = e, other = o). */
  Mc.pushAwayFrom = function (e, o) {
    var dx = o.x - e.x, dz = o.z - e.z;
    var d2 = dx * dx + dz * dz;
    if (d2 < Math.fround(1.0E-4)) return;
    var d = Math.sqrt(d2);
    dx /= d; dz /= d;
    var k = 1.0 / d; if (k > 1.0) k = 1.0;
    dx *= k; dz *= k;
    dx *= Math.fround(0.1); dz *= Math.fround(0.1);
    dx *= 0.5; dz *= 0.5;
    if (Mc.isCart(o.type)) {
      var ox = o.x - e.x, oz = o.z - e.z, ol = Math.sqrt(ox * ox + oz * oz);
      ox = ol ? ox / ol : 0; oz = ol ? oz / ol : 0;
      var yr = (e.yaw || 0) * Math.PI / 180.0;
      var hx = Math.cos(yr), hz = Math.sin(yr), hl = Math.sqrt(hx * hx + hz * hz);
      hx /= hl; hz /= hl;
      if (Math.abs(ox * hx + oz * hz) < Math.fround(0.8)) return;
      var evx = e.vx, evz = e.vz, ovx = o.vx, ovz = o.vz;
      var ef = e.type === 'furnace_minecart', of = o.type === 'furnace_minecart';
      if (of && !ef) {
        e.vx = evx * 0.2; e.vz = evz * 0.2;
        e.vx += ovx - dx; e.vz += ovz - dz;
        o.vx = ovx * 0.95; o.vz = ovz * 0.95;
      } else if (!of && ef) {
        o.vx = ovx * 0.2; o.vz = ovz * 0.2;
        o.vx += evx + dx; o.vz += evz + dz;
        e.vx = evx * 0.95; e.vz = evz * 0.95;
      } else {
        var mx = (ovx + evx) / 2.0, mz = (ovz + evz) / 2.0;
        e.vx = evx * 0.2; e.vz = evz * 0.2;
        e.vx += mx - dx; e.vz += mz - dz;
        o.vx = ovx * 0.2; o.vz = ovz * 0.2;
        o.vx += mx + dx; o.vz += mz + dz;
      }
    } else {
      e.vx += -dx; e.vz += -dz;
      o.vx = (o.vx || 0) + dx / 4.0; o.vz = (o.vz || 0) + dz / 4.0;
    }
  };

  // ── damage / drops ───────────────────────────────────────────────────────────────────────
  /**
   * AbstractMinecartEntity.damage(source, amount) (+ TntMinecartEntity's flaming-arrow prime).
   * `src` = { instabuild: attacker has the instabuild ability, explosive, fire, flamingArrowSpeed2 (an on-fire
   * arrow's velocity^2), invulnerable }. Returns true when the hit counted.
   */
  Mc.damage = function (e, amount, src) {
    src = src || {};
    // vanilla TntMinecartEntity.damage explodes on a flaming arrow BEFORE super.damage's removed/invulnerable early-outs (#4934)
    if (e.type === 'tnt_minecart' && src.flamingArrowSpeed2 !== undefined) Mc.explode(e, src.flamingArrowSpeed2);
    if (e.removed) return true;
    if (src.invulnerable) return false;
    if (e.removed) return true;
    e.cartWobbleSide = -e.cartWobbleSide;
    e.cartWobbleTicks = 10; e.cartDamageWobble = 10;
    e.cartWobbleStrength += amount * 10.0;
    if (NS.GameEvents && NS.GameEvents.emit) NS.GameEvents.emit('entity_damaged', e.x, e.y, e.z, src.attacker || e);   // emitGameEvent(ENTITY_DAMAGE, attacker)
    var insta = !!src.instabuild;
    if (insta || e.cartWobbleStrength > 40.0) {
      removeAllPassengers(e);
      if (insta && !e.cartName) discard(e);
      else Mc.dropItems(e, src);
    }
    return true;
  };
  /** animateDamage() (the client's hurt-animation packet): wobble only. */
  Mc.animateDamage = function (e) {
    e.cartWobbleSide = -e.cartWobbleSide; e.cartWobbleTicks = 10; e.cartDamageWobble = 10;
    e.cartWobbleStrength += e.cartWobbleStrength * 10.0;
  };
  function dropStack(e, item, tag) {
    var EL = NS.EntityList;
    if (!EL || !EL.dropStack) return null;
    return EL.dropStack(e.x, e.y, e.z, item, 1, tag ? { tag: tag } : undefined);
  }
  /** dropItems(source): the type's override chain. Returns the item names dropped (for the check). */
  Mc.dropItems = function (e, src) {
    src = src || {};
    var out = [];
    var t = e.type;
    if (t === 'tnt_minecart') {
      var h2 = e.vx * e.vx + e.vz * e.vz;
      if (!(src.fire || src.explosive || h2 >= Math.fround(0.01))) {
        out = baseDrop(e, src);
        if (!src.explosive && ruleDrops()) { dropStack(e, 'tnt'); out.push('tnt'); }
      } else if (e.cartFuse < 0) {
        Mc.prime(e);
        e.cartFuse = Math.floor(rnd()() * 20) + Math.floor(rnd()() * 20);
      }
      return out;
    }
    out = baseDrop(e, src);
    if (t === 'furnace_minecart') {
      if (!src.explosive && ruleDrops()) { dropStack(e, 'furnace'); out.push('furnace'); }
    } else if (t === 'chest_minecart' || t === 'hopper_minecart') {
      if (ruleDrops()) {
        var blk = t === 'chest_minecart' ? 'chest' : 'hopper';
        dropStack(e, blk); out.push(blk);
        // StorageMinecartEntity.dropItems: a player source angers guarding piglins (no line of sight needed)
        if (src.player && NS.Piglin && NS.Piglin.ready) NS.Piglin.onGuardedBlockInteracted(src.player, true);
      }
    }
    return out;
  };
  /** AbstractMinecartEntity.dropItems: remove(KILLED); the minecart item (custom name carried) if doEntityDrops. */
  function baseDrop(e, src) {
    var out = discard(e);
    if (ruleDrops()) {
      var tag = e.cartName ? { display: { Name: JSON.stringify({ text: e.cartName }) } } : null;
      dropStack(e, 'minecart', tag); out.push('minecart');
    }
    return out;
  }

  // ── TNT ──────────────────────────────────────────────────────────────────────────────────
  Mc.prime = function (e) {
    e.cartFuse = 80;
    (e.statusQueue || (e.statusQueue = [])).push(10);      // sendEntityStatus(this, 10) (net half is the tracker's)
    var Snd = NS.Sound;                                    // SoundEvents.field_15079 = entity.tnt.primed, NEUTRAL, 1, 1
    if (Snd && Snd.entitySound && !e.silent) Snd.entitySound('entity.tnt.primed', e.x, e.y, e.z, 1, 1, 'neutral', NS.Player);
  };
  Mc.SPEED_CAP = 5.0;   // TntMinecartEntity.explode: Math.min(5.0, sqrt(speed2)) (tunable for the lockstep check's break injection)
  Mc.explode = function (e, speed2) {
    var s = Math.sqrt(speed2);
    if (s > Mc.SPEED_CAP) s = Mc.SPEED_CAP;
    var power = Math.fround(4.0 + rnd()() * 1.5 * s);
    var primed = e.cartFuse > -1;                              // isPrimed(), read before the discard
    discard(e);
    var Ex = NS.Explosion;
    e.explodedPower = power;
    // TntMinecartEntity.getEffectiveExplosionResistance / canExplosionDestroyBlock: a primed cart spares rails
    // and the block under a rail (resistance 0, never destroyed)
    var T = NS.Tags;
    function nearRail(st, x, y, z) { return T.stateIn('rails', st) || T.stateIn('rails', W().getBlock(x, y + 1, z)); }
    var resist = primed ? function (st, r, x, y, z) { return nearRail(st, x, y, z) ? 0 : r; } : undefined;
    var keep = primed ? function (st, x, y, z) { return !nearRail(st, x, y, z); } : undefined;
    if (Ex && Ex.ready) Ex.explode(e, e.x, e.y, e.z, power, true, undefined, false, resist, false, keep);   // DestructionType.BREAK
  };

  // ── furnace fuel ─────────────────────────────────────────────────────────────────────────
  /** FurnaceMinecartEntity.interact: coal/charcoal adds 3600 ticks (cap 32000); a pusher sets the push vector.
   *  Returns true when the held stack was consumed (the caller decrements it unless creative). */
  Mc.furnaceInteract = function (e, px, pz, heldItem) {
    var used = false;
    if ((heldItem === 'coal' || heldItem === 'charcoal') && e.fuel + 3600 <= 32000) { e.fuel += 3600; used = true; }
    if (e.fuel > 0) { e.pushX = e.x - px; e.pushZ = e.z - pz; }
    return used;
  };
  /** getMovementDirection (for dismounting): 'north'|'east'|'south'|'west'. */
  Mc.movementDirection = function (e) {
    var faces = ['south', 'west', 'north', 'east'];            // Direction.fromRotation order
    var i = Math.floor((e.yaw || 0) / 90.0 + 0.5) & 3;
    if (e.yawFlipped) i = (i + 2) & 3;
    return faces[(i + 1) & 3];                                 // rotateYClockwise
  };

  /** `AbstractMinecartEntity.updatePassengerForDismount`: Dismounting.getDismountOffsets(dir) scan (side, side, back+side x2,
   *  front+side x2, back, front) at dy 0,+1,-1 for a standing rider; first cell with floor below and 2 free blocks wins.
   *  Fallback is Entity's: above the cart (x, maxY, z). Standing pose only (no crouch/swim box in this engine). */
  var DIRV = { south: [0, 1], west: [-1, 0], north: [0, -1], east: [1, 0] }, CW = { south: 'west', west: 'north', north: 'east', east: 'south' };
  Mc.findDismountPos = function (e, Physics) {
    var d = Mc.movementDirection(e), f = DIRV[d], s = DIRV[CW[d]];
    var offs = [[s[0], s[1]], [-s[0], -s[1]], [-f[0] + s[0], -f[1] + s[1]], [-f[0] - s[0], -f[1] - s[1]],
      [f[0] + s[0], f[1] + s[1]], [f[0] - s[0], f[1] - s[1]], [-f[0], -f[1]], [f[0], f[1]]];
    var bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z), ys = [0, 1, -1];
    for (var i = 0; i < ys.length; i++) for (var j = 0; j < offs.length; j++) {
      var x = bx + offs[j][0], y = by + ys[i], z = bz + offs[j][1];
      if (!Physics.solidAt(x, y, z) && Physics.solidAt(x, y - 1, z) && !Physics.solidAt(x, y + 1, z)) return { x: x + 0.5, y: y, z: z + 0.5 };
    }
    return { x: e.x, y: e.y + 0.7, z: e.z };   // Entity.updatePassengerForDismount: bounding box maxY (cart height 0.7)
  };

  /** StorageMinecartEntity.canPlayerUse (via Entity.canPlayerUse): not removed and within 8 blocks (dist^2 <= 64). */
  Mc.canPlayerUse = function (e, p) {
    var dx = e.x - p.x, dy = e.y - p.y, dz = e.z - p.z;
    return !e.removed && dx * dx + dy * dy + dz * dz <= 64;
  };
  /** Entity.getDisplayName for the cart screens: the custom name, else the type name ('Minecart with Chest'). */
  Mc.cartTitle = function (e) {
    if (e.cartName) return String(e.cartName);
    var Tx = NS.Text, k = 'entity.minecraft.' + e.type;
    if (Tx && Tx.ready && Tx.has && Tx.has(k)) return Tx.translate(k, []);
    return e.type === 'hopper_minecart' ? 'Minecart with Hopper' : 'Minecart with Chest';
  };
  /** StorageMinecartEntity.interact (chest cart: GenericContainerScreenHandler 9x3): opens the screen, emits
   *  container_open and PiglinBrain.onGuardedBlockInteracted(player, true). Hopper cart: HopperScreenHandler (5 slots). */
  Mc.storageInteract = function (e, p) {
    var hop = e.type === 'hopper_minecart', open = NS.Hud && (hop ? NS.Hud.openCartHopper : NS.Hud.openCartChest);
    if ((e.type !== 'chest_minecart' && !hop) || e.removed || !open) return false;
    if (e.lootTable) {      // createMenu: a spectator gets no screen on a loot cart; otherwise roll it for this player first
      if (NS.Gamemode && NS.Gamemode.isSpectator && NS.Gamemode.isSpectator(p)) return false;
      Mc.generateLoot(e, p);
    }
    if (!open.call(NS.Hud, e)) return false;
    e.lastGameEvent = 'container_open';
    if (NS.GameEvents && NS.GameEvents.emit) NS.GameEvents.emit('container_open', e.x, e.y, e.z, p);
    if (NS.Piglin && NS.Piglin.ready) NS.Piglin.onGuardedBlockInteracted(p, true);
    return true;
  };

  // ── DetectorRailBlock (G17-M1) ─────────────────────────────────────────────────────────────
  Mc.DETECTOR_PERIOD = 20;                                       // SCHEDULED_TICK_DELAY
  function isDetector(st) { return st > 0 && blockName(st) === 'detector_rail'; }
  /** getCarts(AbstractMinecartEntity): the live entity list inside getCartDetectionBox (inset 0.2 on x/z, top at y+1-0.2). */
  Mc.cartsIn = function (x, y, z) {
    var EL = NS.EntityList, out = [];
    if (!EL || !EL.list) return out;
    for (var i = 0; i < EL.list.length; i++) {
      var o = EL.list[i];
      if (!o || o.removed || !Mc.isCart(o.type)) continue;
      var hw = (o.width || 0.98) * 0.5, h = o.height || 0.7;
      if (o.x - hw < x + 1 - 0.2 && o.x + hw > x + 0.2 && o.y < y + 1 - 0.2 && o.y + h > y &&
          o.z - hw < z + 1 - 0.2 && o.z + hw > z + 0.2) out.push(o);
    }
    return out;
  };
  /** neighbour updates of the cell (setBlock flag 3 + updateNeighborsAlways) */
  function detectorNotify(x, y, z) {
    if (NS.Behave && NS.Behave.changed) NS.Behave.changed(x, y, z);
    var Rs = NS.Redstone;
    if (Rs && Rs.ready && Rs.update) { Rs.update(x, y, z); Rs.update(x, y - 1, z); }
  }
  /** updatePoweredStatus */
  Mc.detectorUpdate = function (x, y, z) {
    var st = blockAt(x, y, z);
    if (!isDetector(st)) return;
    var B = NS.Behave, was = B.propName(st, 'powered') === 'true';
    var now = Mc.cartsIn(x, y, z).length > 0;
    if (now !== was) {
      W().setBlock(x, y, z, B.setProp(st, 'powered', now));
      detectorNotify(x, y, z);
    }
    if (now) B.schedule(x, y, z, Mc.DETECTOR_PERIOD, 0);
  };
  /** scheduledTick: only while powered */
  Mc.detectorTick = function (x, y, z) {
    var st = blockAt(x, y, z);
    if (!isDetector(st)) return false;
    if (NS.Behave.propName(st, 'powered') === 'true') Mc.detectorUpdate(x, y, z);
    return true;
  };
  /** DetectorRailBlock.getComparatorOutput: a command-block cart's success count, else the first inventory cart's fill level. */
  Mc.detectorComparator = function (x, y, z) {
    var cs = Mc.cartsIn(x, y, z), i;
    for (i = 0; i < cs.length; i++) if (cs[i].type === 'command_block_minecart') return cs[i].successCount | 0;
    for (i = 0; i < cs.length; i++) if (Mc.INVENTORY[cs[i].type] && cs[i].inventory) return cartComparator(cs[i]);
    return 0;
  };
  /** onEntityCollision for a cart: its cell, unpowered rail only */
  Mc.detectorCollide = function (e) {
    var bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
    var st = blockAt(bx, by, bz);
    if (isDetector(st) && NS.Behave.propName(st, 'powered') !== 'true') Mc.detectorUpdate(bx, by, bz);
  };

  Mc.OWED = [
    'riding: the player rides (Mc.interact), a fast rideable cart picks up a mob, the rider-input nudge is built',
    'container GUIs: (chest/hopper minecart screens are built), ' +
      'generateLoot(player) with luck from the GUI open (chest cart interact is built: Mc.storageInteract; Mc.generateLoot exists); e.inventory is a plain list a GUI can adopt',
    'NBT: cart NBT reaches disk through ' +
      'MobNbt (record.cartNbt); TNTFuse/Fuel/Push/TransferCooldown/Enabled go through Mc.readNbt/writeNbt (/summon, /data)',
    'Detector rails reading a cart on them (DetectorRailBlock) and the minecart item placing the entity on a rail ' +
      '(MinecartItem) are separate stages'
  ];
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
