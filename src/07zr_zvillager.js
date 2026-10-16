// 07zr_zvillager.js — QUEUE 0.2 (G18 mobs). ZOMBIE VILLAGER + CONVERSION, both directions.
// Runs on: MAIN THREAD ONLY. No DOM.
//
// `.decomp/net/minecraft/entity/mob/ZombieVillagerEntity.java` (347 lines, read whole) and
// `.decomp/net/minecraft/entity/mob/ZombieEntity.java` (577 lines, read whole; only
// `onKilledOther`, lines 404-421, and `initEquipment`'s own field_30519 constant, line 76, are
// this unit's business — everything else in that file is 07zk_undead.js's).
//
// === DIRECTION 1 -- ZOMBIE KILLS VILLAGER (ZombieEntity.onKilledOther, .decomp:404-421) ===
// Gate: `world.getDifficulty()` must be NORMAL or HARD (`Difficulty.field_5802`/`field_5807`);
// on NORMAL (not HARD) a `random.nextBoolean()` (50%) skip still applies -- HARD always converts,
// EASY/PEACEFUL never do. On a hit: the villager is replaced by a `ZombieVillagerEntity` at the
// SAME position, carrying its `VillagerData` (type+profession+level), gossip, trade offers and
// xp -- `$$3.setVillagerData/setGossipData/setOfferData/setXp`, .decomp:411-418.
//
// === DIRECTION 2 -- THE CURE (ZombieVillagerEntity, whole) ===
// `interactMob` (.decomp:143-160): a golden apple (`Items.field_8463`) used on a zombie villager
// that currently HAS weakness (`StatusEffects.field_5911`) consumes the apple, removes weakness,
// applies STRENGTH (`StatusEffects.field_5910`, `.decomp:186`, duration == the timer, amplifier
// `Math.min(difficulty.getId()-1, 0)` which is never positive so this engine models it as always
// 0 -- .decomp:187) and starts a conversion timer `random.nextInt(2401)+3600` (3600..6000 ticks,
// .decomp:154). `tick()` (.decomp:131-140) subtracts `getConversionRate()` (.decomp:247-275: a
// flat 1, PLUS -- 1% of ticks -- a scan of the 8x8x8 box centred on the zombie villager (capped at
// 14 blocks counted) for `minecraft:iron_bars` or any bed block, each such block found rolling
// 30% to add +1) every tick until it reaches 0, then `finishConversion` (.decomp:207-245) turns
// it back into a `VillagerEntity` carrying the SAME VillagerData/gossip/offerData/xp forward,
// and grants the ZOMBIE_VILLAGER_CURED gossip 07l_spawn.js's own `Village.onHurt`/`onTrade`
// header already jar-verified and left OWED for this unit to wire: major_positive(20) +
// minor_positive(25) (07l_spawn.js:945-946).
//
// === NATURAL SPAWN ROLL === `ZombieEntity.field_30519` (0.05F, .decomp:76) is a real constant
// this decomp snapshot's own `ZombieEntity.java` never calls (no `NaturalSpawner`/`SpawnHelper`
// class exists under `.decomp/` to show the real call site) -- 5% of naturally spawned zombies
// being zombie villagers is documented vanilla behaviour, but the exact call site is unverified
// here (`Zv.OWED`). Wired at the closest fit this engine has: `Spawn.placePack`'s own natural
// pack-placement loop (07l_spawn.js), the same slot the `witch`/`canJoinRaid` natural-only line
// already occupies.
(function (NS) {
  'use strict';
  var Zv = NS.ZVillager = {};

  Zv.KILL_SKIP_ON_NORMAL = 0.5;      // onKilledOther's own random.nextBoolean(), .decomp:407-409
  Zv.CURE_TIMER_MIN = 3600;          // interactMob: random.nextInt(2401)+3600, .decomp:154
  Zv.CURE_TIMER_RANGE = 2401;
  Zv.RATE_ROLL_CHANCE = 0.01;        // getConversionRate: random.nextFloat() < 0.01F, .decomp:249
  Zv.RATE_SCAN_HALF = 4;             // the box: (x-4 .. x+4), each axis, .decomp:257-259
  Zv.RATE_SCAN_CAP = 14;             // field_30521, the loop's own `$$1 < 14` cutoff
  Zv.RATE_BLOCK_CHANCE = 0.3;        // getConversionRate: random.nextFloat() < 0.3F per block found
  Zv.STRENGTH_EFFECT = 'strength';   // StatusEffects.field_5910 (names.tsv axg)
  Zv.NAUSEA_EFFECT = 'nausea';       // StatusEffects.field_5916, given to the cured villager (.decomp:243)
  Zv.CURE_NAUSEA_TICKS = 200;
  Zv.WEAKNESS_EFFECT = 'weakness';   // StatusEffects.field_5911
  Zv.CURE_ITEM = 'golden_apple';     // Items.field_8463 (the PLAIN apple, not enchanted)
  Zv.CURE_GOSSIP_MAJOR = 20;         // 07l_spawn.js:945 ZOMBIE_VILLAGER_CURED -> major_positive(20)
  Zv.CURE_GOSSIP_MINOR = 25;         //                                        + minor_positive(25)

  /** `ZombieVillagerEntity(EntityType, World)` ctor (.decomp:68-73): rolls ONE random
   *  profession off the 15-entry registry (`Registry.VILLAGER_PROFESSION.getRandom`) and
   *  nothing else -- TYPE (biome) starts at `initDataTracker`'s own default ("plains",
   *  .decomp:80) and is then rolled by `initialize()` (.decomp:320-321: `VillagerType.forBiome(
   *  world.getBiome(pos))`) -- `Prof.typeAtBiome` (07o_profession.js), the same biome-reader
   *  shape `Rb.chooseTypeAt`/`Fx.typeAt` already use for rabbit/fox, fed this entity's OWN spawn
   *  position (a kill-conversion's zombie villager spawns at the dead villager's own (x,z), so
   *  this is the correct biome for that path too, not a second roll vanilla wouldn't make --
   *  vanilla's own `initialize()` runs unconditionally and a caller who wants the SOURCE
   *  villager's type instead passes `opts.villagerType`, below, which wins).
   *  `opts.profession`/`opts.villagerType` let a kill-conversion (Zv.convertVillagerToZombie)
   *  or a command/egg spawn FORCE the data instead of rolling it -- the same "opts wins over a
   *  fresh roll" shape `Mo.chooseBabyType`'s own caller and `axolotl`'s opts.variant` use. */
  Zv.spawnInit = function (e, opts) {
    if (!e || e.type !== 'zombie_villager') return;
    opts = opts || {};
    if (e.villagerType === undefined) {
      e.villagerType = (opts.villagerType !== undefined) ? opts.villagerType
        : (NS.Profession && NS.Profession.typeAtBiome) ? NS.Profession.typeAtBiome(e.x, e.z) : 'plains';
    }
    if (e.profession === undefined) {
      if (opts.profession !== undefined) {
        e.profession = opts.profession;
      } else if (NS.Profession && NS.Profession.ALL) {
        var all = NS.Profession.ALL;
        var rand = (NS.EntityList && NS.EntityList.random) || NS.fbRand;
        e.profession = all[Math.floor(rand() * all.length)];
      } else {
        e.profession = 'none';
      }
    }
    if (e.villagerLevel === undefined) e.villagerLevel = opts.villagerLevel || 1;
    if (e.tradeXp === undefined) e.tradeXp = opts.tradeXp || 0;
    if (opts.tradeOffers) { e.tradeOffers = opts.tradeOffers; e.tradeProfession = e.profession; }
    if (opts.tradeUses) e.tradeUses = opts.tradeUses;
    if (opts.gossip) e.gossip = opts.gossip;
    // loop/nbtsave-s104 -- `converting`/`conversionTimer`/`converterId` are ZombieVillagerEntity's
    // own live cure state (.decomp:143-160, the golden-apple timer) and belong on the SAME
    // "opts wins over a fresh default" list every other field in this function already uses --
    // a reload mid-cure should not silently un-cure the villager. `converterId` IS vanilla's ConversionPlayer (saved by 07zw_mobnbt); 
    // the player is re-resolved by uuid at finish (see finishConversion).
    if (e.converting === undefined) e.converting = opts.converting || false;
    if (e.conversionTimer === undefined) e.conversionTimer = opts.conversionTimer || 0;
    if (e.converterId === undefined) e.converterId = opts.converterId !== undefined ? opts.converterId : null;
  };

  /**
   * `ZombieEntity.onKilledOther` (.decomp:404-421) -- the gate ONLY, as a pure function so
   * `zombievillagercheck`-shaped tests can drive it directly: `difficulty` is one of `Diff.LEVELS`
   * (07l_spawn.js), `rand` a `()=>float in [0,1)` source. Returns true when the kill converts.
   * Both directions matter (rule 6) -- PEACEFUL/EASY are excluded by the SAME condition the
   * decomp reads -- `world.getDifficulty() == NORMAL || == HARD` is the WHOLE gate, not a
   * separate check this engine adds.
   */
  Zv.shouldConvertOnKill = function (difficulty, rand) {
    if (difficulty !== 'normal' && difficulty !== 'hard') return false;
    if (difficulty !== 'hard' && rand() < Zv.KILL_SKIP_ON_NORMAL) return false;
    return true;
  };

  /**
   * Builds the `EL.spawn('zombie_villager', ...)` opts a killed villager's data converts into --
   * `$$3.setVillagerData/setGossipData/setOfferData/setXp` (.decomp:411-418), transcribed as a
   * plain data copy since this engine's villager already carries every one of those fields as
   * plain properties (07o_profession.js/07p_trade.js/07l_spawn.js's own Village module).
   */
  /** `MobEntity.convertTo(type,false)`'s copy: rotation, custom name, persistence, AI-disabled and the baby flag. */
  function copyMobState(src, dst) {
    dst.yaw = src.yaw; dst.pitch = src.pitch;
    if (src.customName) { dst.customName = src.customName; dst.customNameVisible = src.customNameVisible; }
    if (src.persistent) dst.persistent = true;
    if (src.aiDisabled) dst.aiDisabled = true;
    if (src.invulnerable) dst.invulnerable = true;
    var veh = src.vehicle, Rd = NS.Raid;   // stopRiding + startRiding(vehicle, true)
    if (veh && Rd && Rd.startRiding) { Rd.stopRiding(src); Rd.startRiding(dst, veh); }
    if ((src.growAge | 0) < 0) {
      if (NS.Breed && NS.Breed.setBaby) NS.Breed.setBaby(dst, true); else dst.growAge = src.growAge;
    }
  }

  Zv.dataFromVillager = function (villager) {
    if (!villager) return null;
    return {
      profession: villager.profession || 'none',
      villagerType: villager.villagerType || 'plains',
      villagerLevel: villager.villagerLevel || 1,
      tradeXp: villager.tradeXp || 0,
      tradeOffers: villager.tradeOffers ? villager.tradeOffers.slice() : undefined,
      tradeUses: villager.tradeUses ? villager.tradeUses.slice() : undefined,
      gossip: villager.gossip ? Object.assign({}, villager.gossip) : undefined
    };
  };

  /**
   * The whole kill-conversion, run from a live combat kill (no caller exists today -- `Zv.OWED`,
   * mob-vs-mob combat is unbuilt, `14j_combat.js` sown `Cb.mobAttack` header: "ONLY NS.Player IS
   * ROSTERED AS A TARGET"). Spawns the zombie villager at the dead villager's position carrying
   * its data (.decomp:411-418), removes the villager, and returns the new entity (or null).
   */
  Zv.convertVillagerToZombie = function (villager, difficulty, rand, killer) {
    var EL = NS.EntityList;
    if (!EL || !EL.spawn || !villager) return null;
    if (!Zv.shouldConvertOnKill(difficulty, rand)) return null;
    var data = Zv.dataFromVillager(villager);
    var zv = EL.spawn('zombie_villager', villager.x, villager.y, villager.z, Object.assign({ conversion: true }, data));
    if (zv) {
      copyMobState(villager, zv); zv.health = zv.maxHealth;
      if (EL.remove) EL.remove(villager); else villager.removed = true;
      sfx('entity.zombie.infect', killer || villager, 2, jitter(), villager);   // syncWorldEvent 1026
    }
    return zv;
  };

  /** `interactMob`'s golden-apple branch (.decomp:143-160) -- WEAKNESS is required, both
   *  directions matter (rule 6): present -> consumes+starts curing, absent -> refuses (vanilla's
   *  own `ActionResult.CONSUME`, no apple lost). `hasWeakness`/`removeWeakness`/`addStrength` are
   *  injected so this stays a pure function the check can drive without `NS.Effects` wired up. */
  Zv.applyGoldenApple = function (e, curerUuid, rand, io) {
    if (!e || e.type !== 'zombie_villager') return false;   // no isConverting() guard in vanilla: a re-weakened converting one re-rolls
    io = io || {};
    if (!io.hasWeakness(e)) return false;
    var ticks = Zv.CURE_TIMER_MIN + Math.floor(rand() * Zv.CURE_TIMER_RANGE);
    e.converting = true;
    e.conversionTimer = ticks;
    e.converterId = curerUuid || null;
    if (io.removeWeakness) io.removeWeakness(e);
    if (io.addStrength) io.addStrength(e, ticks, 0);   // amplifier: Math.min(difficulty-1,0), never >0
    return true;
  };

  function sfx(name, e, vol, pitch, at) {   // vanilla gates each on this.isSilent(): the sounding entity's flag
    if (e.silent) return;
    if (at) e = at;
    if (NS.Sound && NS.Sound.play) NS.Sound.play(name, { x: e.x, y: e.y + ((e.growAge | 0) < 0 ? 0.93 : 1.74), z: e.z, source: 'hostile', volume: vol, pitch: pitch });
  }
  function jitter() { return (NS.fbRand() - NS.fbRand()) * 0.2 + 1; }

  /** The live caller (`Use.entityUse`): `interactMob`'s whole golden-apple branch (.decomp:143-160).
   *  Returns {consumed} (false = vanilla's CONSUME, no apple lost), or null for any other item; plays the status-16 `entity.zombie_villager.cure` sound (handleStatus). */
  var curers = Zv.curers = {};
  Zv.interact = function (P, e, itemName, rand) {
    if (!e || e.type !== 'zombie_villager' || itemName !== Zv.CURE_ITEM) return null;
    var ES = NS.Effects;
    var started = Zv.applyGoldenApple(e, P && P.uuid, rand || NS.fbRand, {
      hasWeakness: function (x) { return !!(ES && ES.hasStatusEffect(x, Zv.WEAKNESS_EFFECT)); },
      removeWeakness: function (x) { if (ES) ES.removeStatusEffect(x, Zv.WEAKNESS_EFFECT); },
      addStrength: function (x, t, a) { if (ES) ES.addStatusEffect(x, 'strength', t, a); }
    });
    if (!started) return { consumed: false };
    if (P && P.uuid) curers[P.uuid] = P;   // getPlayerByUuid stand-in for finishConversion's criterion
    sfx('entity.zombie_villager.cure', e, 1 + NS.fbRand(), NS.fbRand() * 0.7 + 0.3);
    return { consumed: true };
  };

  /** `getConversionRate` (.decomp:247-275), reproduced whole: base 1, and -- 1% of ticks -- a scan
   *  of the 8x8x8 box (capped at 14 blocks counted) for iron_bars/a bed, each hit rolling 30% to
   *  add one. `blockAt(dx,dy,dz)` returns a block NAME string (or falsy); `rand` is `()=>float`. */
  Zv.conversionRate = function (cx, cy, cz, rand, blockAt) {
    var rate = 1;
    if (rand() >= Zv.RATE_ROLL_CHANCE) return rate;
    var counted = 0;
    var half = Zv.RATE_SCAN_HALF;
    var bx = Math.trunc(cx), by = Math.trunc(cy), bz = Math.trunc(cz);   // (int) cast: toward zero, .decomp:257-259
    for (var dx = -half; dx < half && counted < Zv.RATE_SCAN_CAP; dx++) {
      for (var dy = -half; dy < half && counted < Zv.RATE_SCAN_CAP; dy++) {
        for (var dz = -half; dz < half && counted < Zv.RATE_SCAN_CAP; dz++) {
          var name = blockAt(bx + dx, by + dy, bz + dz);
          if (name === 'iron_bars' || isBed(name)) {
            if (rand() < Zv.RATE_BLOCK_CHANCE) rate++;
            counted++;
          }
        }
      }
    }
    return rate;
  };
  function isBed(name) { return !!name && name.length >= 3 && name.slice(-3) === 'bed'; }

  /** `tick()` (.decomp:131-140): every server tick a converting zombie villager subtracts
   *  `getConversionRate()` off its timer; at/under 0 it is done. Returns true exactly the tick
   *  curing completes (the caller, `Zv.tickOne`, is what actually swaps the entity). */
  Zv.tickConversion = function (e, rand, blockAt) {
    if (!e || !e.converting) return false;
    var rate = Zv.conversionRate(e.x, e.y, e.z, rand, blockAt);
    e.conversionTimer -= rate;
    return e.conversionTimer <= 0;
  };

  /** `finishConversion` (.decomp:207-245), the data half only (VillagerData/gossip/offerData/xp
   *  carried straight across, .decomp:227-233) -- equipment re-homing (.decomp:214-226) is
   *  `Zv.rehomeEquipment` (D-567), called from `Zv.finishConversion`. Returns the villager's spawn opts. */
  Zv.dataToVillager = function (zv) {
    return {
      profession: zv.profession || 'none',
      villagerType: zv.villagerType || 'plains',
      villagerLevel: zv.villagerLevel || 1,
      tradeXp: zv.tradeXp || 0,
      tradeOffers: zv.tradeOffers ? zv.tradeOffers.slice() : undefined,
      tradeUses: zv.tradeUses ? zv.tradeUses.slice() : undefined,
      gossip: zv.gossip ? Object.assign({}, zv.gossip) : undefined
    };
  };

  /** The whole finish-conversion swap: spawns the villager, carries the data across, grants the
   *  cure gossip (.decomp:236-240 -> the criterion; 07l_spawn.js:945-946's own jar-verified
   *  magnitudes, major_positive(20)+minor_positive(25), Village.onCured), removes the zombie
   *  villager, returns the new villager (or null). `Village` is read lazily (`NS.Village`) so
   *  this file's own load position (AFTER 07l_spawn.js in build.mjs) is not load-bearing. */
  /** D-567 -- `finishConversion`'s equipment loop (.decomp ZombieVillagerEntity.java:214-226), whole.
   *  Walks `EquipmentSlot.values()` in the jar's own order (mainhand, offhand, feet, legs, chest,
   *  head -- EquipmentSlot.java:4-9). A BINDING-CURSED stack is moved into the villager's own
   *  8-slot inventory (`MerchantEntity.inventory = new SimpleInventory(8)`, MerchantEntity.java:48)
   *  at `getEntitySlotId() + 300` -> MerchantEntity.getStackReference (:217-219) -> inventory index
   *  getEntitySlotId(), which is 0,1 for the hands and 0..3 for armour, so a later slot OVERWRITES
   *  an earlier one at the same index (head's curse lands on slot 3, a cursed boot and a cursed
   *  mainhand both on slot 0 -- boot wins): the jar's own quirk, kept. Every other stack DROPS only
   *  when its drop chance is > 1.0 (a picked-up/guaranteed item, 2.0F), and otherwise vanishes
   *  with the zombie. Returns {kept:[{slot,index}], dropped:[{slot,item,count}]}. */
  Zv.SLOT_ORDER = ['MAINHAND', 'OFFHAND', 'FEET', 'LEGS', 'CHEST', 'HEAD'];
  Zv.ENTITY_SLOT_ID = { MAINHAND: 0, OFFHAND: 1, FEET: 0, LEGS: 1, CHEST: 2, HEAD: 3 };
  Zv.VILLAGER_INV_SIZE = 8;
  Zv.rehomeEquipment = function (zv, v) {
    var out = { kept: [], dropped: [] };
    var Eq = NS.Equip, IT = NS.Items, Cb = NS.Combat, EL = NS.EntityList;
    if (!Eq || !IT || !zv || !zv.equip) return out;
    for (var i = 0; i < Zv.SLOT_ORDER.length; i++) {
      var name = Zv.SLOT_ORDER[i], slot = IT[name];
      var st = Eq.getEquipped(zv, slot);
      if (!st || !(st.n > 0 || st.n === undefined)) continue;
      var cursed = !!(Cb && Cb.enchantLevel && Cb.enchantLevel(st, 'binding_curse') > 0);
      if (cursed) {
        if (v) {
          if (!v.villagerInventory) { v.villagerInventory = []; for (var k = 0; k < Zv.VILLAGER_INV_SIZE; k++) v.villagerInventory.push(null); }
          v.villagerInventory[Zv.ENTITY_SLOT_ID[name]] = st;
          out.kept.push({ slot: name, index: Zv.ENTITY_SLOT_ID[name] });
        }
      } else if (Eq.dropChance(zv, slot) > 1.0) {
        var item = IT.nameOf ? IT.nameOf(st.i) : st.i;
        out.dropped.push({ slot: name, item: item, count: st.n || 1 });
        if (EL && EL.dropStack) EL.dropStack(zv.x, zv.y + (zv.height || 1.95) * 0.5, zv.z, st.i, st.n || 1);
      }
      Eq.setEquipped(zv, slot, null);
    }
    return out;
  };

  Zv.finishConversion = function (e) {
    var EL = NS.EntityList;
    if (!EL || !EL.spawn || !e || e.type !== 'zombie_villager') return null;
    var data = Zv.dataToVillager(e);
    var v = EL.spawn('villager', e.x, e.y, e.z, data);
    if (v) {
      // `EL.DEFAULTS.villager` (07i_entitylist.js) takes no opts of its own -- it only ever
      // defaults `e.profession` to 'none' -- so the copied data is applied here directly,
      // the same "opts wins, but only if the DEFAULTS handler reads it" caveat this file's own
      // Zv.spawnInit header names for zombie_villager's OWN opts (which Zv.spawnInit DOES read).
      v.profession = data.profession; v.villagerType = data.villagerType;
      v.villagerLevel = data.villagerLevel; v.tradeXp = data.tradeXp;
      if (data.tradeOffers) { v.tradeOffers = data.tradeOffers; v.tradeProfession = data.profession; }
      if (data.tradeUses) v.tradeUses = data.tradeUses;
      if (data.gossip) v.gossip = data.gossip;
      copyMobState(e, v); v.health = v.maxHealth;
      if (NS.Effects && NS.Effects.addStatusEffect) NS.Effects.addStatusEffect(v, Zv.NAUSEA_EFFECT, Zv.CURE_NAUSEA_TICKS, 0);   // .decomp:243
      Zv.rehomeEquipment(e, v);
      if (e.converterId && NS.Village && NS.Village.startGossip) {   // .decomp:236-240: only when the converter resolves
        NS.Village.startGossip(v, 'major_positive', Zv.CURE_GOSSIP_MAJOR);
        NS.Village.startGossip(v, 'minor_positive', Zv.CURE_GOSSIP_MINOR);
      }
      var conv = e.converterId && (curers[e.converterId] || (NS.Player && NS.Player.uuid === e.converterId ? NS.Player : null));   // curers is session-only; a reloaded cure resolves via the live player   // .decomp:239-242 CURED_ZOMBIE_VILLAGER.trigger(player, zombie, villager)
      if (conv && NS.Adv && NS.Adv.trigger) NS.Adv.trigger(conv, 'minecraft:cured_zombie_villager', { zombie: e, villager: v });
      if (EL.remove) EL.remove(e); else e.removed = true;
      sfx('entity.zombie_villager.converted', e, 2, jitter());   // syncWorldEvent 1027
    }
    return v;
  };

  /** The live per-tick caller `EL.tickMob` runs for every `zombie_villager` (07i_entitylist.js).
   *  Reads block state through `NS.Physics`/`NS.States`/`NS.Reg` the same way `07o_profession.js`'s
   *  own `blockNameAt` does (that helper is file-local there, so this is its own small copy). */
  Zv.tickOne = function (e) {
    if (!e || e.type !== 'zombie_villager' || !e.converting || e.dead) return;
    var rand = (NS.EntityList && NS.EntityList.random) || NS.fbRand;
    if (Zv.tickConversion(e, rand, blockNameAt)) Zv.finishConversion(e);
  };
  function blockNameAt(x, y, z) {
    if (!NS.Physics || !NS.States || !NS.Reg || !NS.Reg.names) return null;
    var state = NS.Physics.blockAt(x, y, z);
    var id = NS.States.block[state];
    return NS.Reg.names[id] || null;
  }

  Zv.OWED = [
    // struck loop/vtype-s105: per-biome VillagerType at spawn is wired -- Zv.spawnInit reads
    // Prof.typeAtBiome(e.x, e.z) (VillagerType.forBiome, .decomp:320-321) unless opts.villagerType
    // (a kill-conversion's SOURCE villager type) already forces it; EL.DEFAULTS.villager
    // (07i_entitylist.js) rolls the same way for a natural/egg villager. villagertypecheck.mjs.
    // struck D-567: equipment re-homing on cure -- Zv.rehomeEquipment (binding curse -> villager
    // inventory slot getEntitySlotId(), drop chance > 1.0 -> dropped, else gone), zvillagercheck §D-567.
    'the profession OVERLAY texture (robe/hat colour layer per profession) does not exist for ' +
      'ANY villager in this engine yet (Prof.OWED, 07o_profession.js) -- zombie_villager draws ' +
      'the single zombie_villager.png skin with no overlay, the identical gap'
  ];

  Zv.ready = true;
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
