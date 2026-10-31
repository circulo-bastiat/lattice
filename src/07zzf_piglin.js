// src/07zzf_piglin.js — s133 (KW-32, QUEUE 0.2 G18): piglin + piglin_brute EXIST in this engine.
//
// Off .decomp, read whole: net/minecraft/entity/mob/AbstractPiglinEntity.java (the overworld
// ZOMBIFICATION clock: mobTick counts `timeInOverworld` while `shouldZombify()`, and at > 300
// converts to zombified_piglin with keepEquipment=true plus Nausea 200 — this engine has no piglin-
// safe dimension, so every piglin here is on that clock), PiglinEntity.java (createPiglinAttributes,
// initialize: 20% baby unless STRUCTURE spawn, else an adult gets makeInitialWeapon — 50% crossbow /
// golden sword — then initEquipment's 10% per golden armour piece for an adult, updateEnchantments;
// baby = BABY_SPEED_BOOST 0.2 MULTIPLY_BASE; experiencePoints 5 with NO equipment bonus
// (getXpToDrop returns the field); IsBaby/CannotHunt/TimeInOverworld/IsImmuneToZombification NBT),
// PiglinBruteEntity.java (golden axe always, NO updateEnchantments; xp 20), PiglinBrain.java and
// PiglinBruteBrain.java (the target rules below).
//
// ── THE BRAIN, AS GOALS (this engine's own idiom for a brain mob, see 07zv_villagerbrain.js) ──
//   piglin: `getPreferredTarget` — none while a zombified piglin is within 6 (nearest visible);
//     else ANGRY_AT (600 ticks, `becomeAngryWith`), else the nearest visible NEMESIS (wither
//     skeleton / wither), else the nearest visible player NOT wearing a golden armour piece
//     (`wearsGoldArmor`). Only an ADULT picks a target (UpdateAttackTargetTask(isAdult, …)).
//     Fight: a crossbow holder runs the crossbow attack, anyone else MeleeAttackTask(20).
//   piglin_brute: `getTarget` — ANGRY_AT, else the nearest visible player within 12 (gold or
//     not), else the nemesis. Melee only.
//   onAttacked (both): `tryRevenge` — angry at the attacker (unless the attacker is a piglin for
//     a piglin / any AbstractPiglin for a brute; a new target more than 4 blocks further than the
//     current one is refused, isNewTargetTooFar), then `angerAtCloserTargets`: every nearby
//     adult piglin (16) becomes angry at it unless already angry at something closer. A BABY
//     attacked does not fight: it remembers AVOID (100 ticks) — its flee is Pg.OWED.
(function (NS) {
  // fallback stream when a caller passes no rng: the entity list's, else a fixed-seed JRandom (never Math.random, #6439)
  var fbR = null;
  function RNDFB() { var L = NS.EntityList; if (L && L.random) return L.random(); if (!fbR) fbR = NS.JRandom ? new NS.JRandom(0x6439) : { s: 0x6439, nextDouble: function () { this.s = (Math.imul(this.s, 1103515245) + 12345) >>> 0; return this.s / 4294967296; } }; return fbR.nextDouble(); }
  'use strict';
  var Pg = NS.Piglin = { ready: false };

  Pg.TYPES = { piglin: 1, piglin_brute: 1 };
  Pg.ZOMBIFY_AFTER = 300;          // AbstractPiglinEntity.mobTick: `timeInOverworld > 300`
  Pg.ZOMBIFY_NAUSEA = 200;         // zombify(): StatusEffectInstance(NAUSEA, 200, 0)
  Pg.BABY_CHANCE = 0.2;            // PiglinEntity.initialize: nextFloat() < 0.2F
  Pg.CROSSBOW_CHANCE = 0.5;        // makeInitialWeapon: nextFloat() < 0.5 -> crossbow
  Pg.ARMOR_CHANCE = 0.1;           // equipAtChance: nextFloat() < 0.1F, each of the four pieces
  Pg.BABY_SPEED_MULT = 0.2;        // BABY_SPEED_BOOST, MULTIPLY_BASE
  Pg.ANGER_TICKS = 600;            // becomeAngryWith: remember(ANGRY_AT, uuid, 600L)
  Pg.AVOID_TICKS = 100;            // onAttacked, baby: remember(AVOID_TARGET, attacker, 100L)
  Pg.ZOMBIFIED_NEAR = 6;           // getNearestZombifiedPiglin: isInRange(…, 6.0)
  Pg.SENSE_RANGE = 16;             // NearestLivingEntitiesSensor / PiglinSpecificSensor box
  Pg.BRUTE_PLAYER_RANGE = 12;      // PiglinBruteBrain.method_30249: isInRange(…, 12.0)
  Pg.TOO_FAR = 4;                  // tryRevenge: isNewTargetTooFar(…, 4.0)
  Pg.MELEE_COOLDOWN = 20;          // MeleeAttackTask(20)
  Pg.CROSSBOW_RANGE = 8;           // CrossbowAttackTask shares the pillager's 8-block window
  Pg.ARMOR = ['golden_boots', 'golden_leggings', 'golden_chestplate', 'golden_helmet'];   // FEET..HEAD
  Pg.GOLD_ARMOR = { golden_helmet: 1, golden_chestplate: 1, golden_leggings: 1, golden_boots: 1 };
  Pg.NEMESIS = { wither_skeleton: 1, wither: 1 };
  Pg.SOUND_ZOMBIFY = { piglin: 'entity.piglin.converted_to_zombified',
                       piglin_brute: 'entity.piglin_brute.converted_to_zombified' };

  // ── ADMIRE/BARTER numbers (PiglinBrain.java, AdmireItemTask/AdmireItemTimeLimitTask/
  // RemoveOffHandItemTask/FollowMobTask, all .decomp'd whole this session) ──────────────────
  Pg.ADMIRE_TICKS = 120;          // AdmireItemTask(120) / setAdmiringItem: remember(ADMIRING_ITEM, 120L)
  Pg.ADMIRE_TIMEOUT = 200;        // AdmireItemTimeLimitTask(200, 200): ticks admiring with an EMPTY
                                   // offhand (the item removed some OTHER way) before it is force-stopped —
                                   // this engine's own cycle always empties the offhand at the SAME tick
                                   // the memory would expire, so nothing ever reaches this counter; named
                                   // for the number, not wired to a path.
  Pg.ADMIRE_COOLDOWN = 200;       // the same task's forced-stop ADMIRE_ITEM_COOLDOWN — same note as above
  Pg.HIT_BY_PLAYER_TICKS = 400;   // onAttacked: remember(HIT_BY_PLAYER, 400L) — isWillingToTrade's gate
  Pg.FOLLOW_GOLD_RANGE = 14;      // addIdleActivities: FollowMobTask(isGoldHoldingPlayer, 14.0F)
  Pg.FOLLOW_GOLD_STOP = 2;        // this engine's own arrival radius — FollowMobTask only ever sets a
                                   // walk/look target, vanilla's real walking is a separate always-on task
                                   // this engine has none of, so `Pg.GoldFollowGoal` both aims AND walks
                                   // and needs SOME stopping distance; not a cited vanilla constant.
  Pg.BARTER_ITEM = 'gold_ingot';  // PiglinBrain.BARTERING_ITEM (Items.field_8695)
  Pg.GUARDED_RANGE = 16;          // onGuardedBlockInteracted: getNonSpectatingEntities(..., expand(16.0))

  Pg.OWED = [
    'JUKEBOX DANCE: none in 1.18.2 (DANCING is only DefeatTargetTask\'s 300-tick memory, set with CELEBRATE_LOCATION), so nothing is owed; the DefeatTargetTask predicate is isHuntingTarget (hoglin) only',
    'CROSSBOW: AttackTask(5, 0.75) back-off + RangedApproachTask are the pillager\'s CrossbowAttackGoal stand-in',
    'SOUNDS: the zombification sound names are played but mob sounds wait on D-12/D-645'
  ];

  var IT = function () { return NS.Items; };
  function rnd() { var EL = NS.EntityList; return (EL && EL.random) || RNDFB; }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
  function alive(o) { return !!o && !o.removed && !o.dead && !(o.health !== undefined && o.health <= 0); }

  Pg.isBaby = function (e) { return !!(e && e.isBaby); };
  Pg.isAdult = function (e) { return !Pg.isBaby(e); };

  /** `PiglinBrain.wearsGoldArmor`: any of the four armour slots holds a GOLD-material armour item. */
  Pg.wearsGoldArmor = function (o) {
    var I = IT(), Eq = NS.Equip;
    if (!o || !I || !I.ready) return false;
    var names = [];
    if (o.inventory && o.inventory.slots && NS.Inventory) {
      for (var i = 0; i < 4; i++) { var s = o.inventory.slots[NS.Inventory.ARMOR_START + i]; if (s) names.push(I.nameOf(s.i)); }
    } else if (Eq && o.equip) {
      var sl = [I.FEET, I.LEGS, I.CHEST, I.HEAD];
      for (var j = 0; j < 4; j++) { var t = Eq.getEquipped(o, sl[j]); if (t) names.push(I.nameOf(t.i)); }
    }
    for (var k = 0; k < names.length; k++) if (Pg.GOLD_ARMOR[names[k]]) return true;
    return false;
  };

  // ── ADMIRE/BARTER (PiglinBrain: loot/playerInteract/consumeOffHandItem/onGuardedBlockInteracted,
  // scoped to the ONE item the OWED bullet named -- a gold INGOT handed or picked up; a handed
  // golden sword/armour/block is a real vanilla admire too but stays unbuilt, same as the general
  // food/equip/barter dispatch `canGather`/`loot` run for every OTHER item a piglin can gather) ──

  /** `PiglinBrain.isGoldenItem`: `ItemTags.PIGLIN_LOVED` -- every golden tool/armour/ingot/block. */
  Pg.isGoldenItem = function (name) {
    var T = NS.Tags;
    return !!(name && T && T.ready && T.itemIn('piglin_loved', name));
  };
  /** `PiglinBrain.acceptsForBarter`: the gold INGOT exactly, not the wider `piglin_loved` tag --
   *  a handed golden sword is admired in vanilla too but never bartered away. */
  Pg.acceptsForBarter = function (name) { return name === Pg.BARTER_ITEM; };

  /** `PiglinBrain.isGoldHoldingPlayer`: `isHolding(isGoldenItem)` -- either hand. */
  Pg.isGoldHoldingPlayer = function (player) {
    var Iv = NS.Inventory, I = IT();
    if (!player || !Iv || !I || !I.ready || !player.inventory) return false;
    var main = Iv.getItem(player.inventory, player.slot | 0);
    var off = Iv.getItem(player.inventory, Iv.OFFHAND);
    function golden(st) { return !!(st && st.n > 0 && Pg.isGoldenItem(I.nameOf(st.i))); }
    return golden(main) || golden(off);
  };

  // ── admiring (PiglinBrain.setAdmiringItem/isAdmiringItem -- the ADMIRING_ITEM memory) ──────
  Pg.isAdmiring = function (e) { return e.pgAdmireUntil !== undefined && (e.pgClock | 0) < e.pgAdmireUntil; };
  Pg.setAdmiring = function (e) { e.pgAdmireUntil = (e.pgClock | 0) + Pg.ADMIRE_TICKS; };
  Pg.forgetAdmiring = function (e) { delete e.pgAdmireUntil; };

  Pg.offhand = function (e) { var Eq = NS.Equip, I = IT(); return (Eq && I) ? Eq.getEquipped(e, I.OFFHAND) : null; };
  Pg.offhandClear = function (e) { var Eq = NS.Equip, I = IT(); if (Eq && I) Eq.setEquipped(e, I.OFFHAND, null); };
  /** `PiglinBrain.swapItemWithOffHand`: a piglin only ever admires ONE item at a time -- a
   *  second one bumps whatever it already held to the floor rather than replacing it silently. */
  Pg.swapOffhand = function (e, stack) {
    var Eq = NS.Equip, I = IT(), EL = NS.EntityList;
    if (!Eq || !I) return;
    var cur = Eq.getEquipped(e, I.OFFHAND);
    if (cur && EL && EL.dropStack) EL.dropStack(e.x, e.y + (e.height || 1.95) * 0.5, e.z, cur.i, cur.n);
    Eq.setEquipped(e, I.OFFHAND, stack || null);
  };

  Pg.EAT_TICKS = 200;             // setEatenRecently: remember(ATE_RECENTLY, true, 200L)
  Pg.INV_SLOTS = 8;               // PiglinEntity.inventory = SimpleInventory(8)
  Pg.hasAteRecently = function (e) { return e.pgAteUntil !== undefined && (e.pgClock | 0) < e.pgAteUntil; };
  Pg.setEatenRecently = function (e) { e.pgAteUntil = (e.pgClock | 0) + Pg.EAT_TICKS; };
  Pg.tagged = function (tag, name) { var T = NS.Tags; return !!(name && T && T.ready && T.itemIn(tag, name)); };

  /** `PiglinBrain.doesNotHaveGoldInOffHand`: empty OR not piglin_loved. */
  Pg.noGoldInOffhand = function (e) {
    var o = Pg.offhand(e), I = IT();
    return !o || !Pg.isGoldenItem(I.nameOf(o.i));
  };
  /** `SimpleInventory.addItem`/`canInsert` on `e.pgInv` ([{name, n}]); returns the count that did NOT fit. */
  Pg.invAdd = function (e, name, n, dry) {
    var inv = e.pgInv || (e.pgInv = []), i;
    for (i = 0; i < inv.length && n > 0; i++) {
      if (inv[i].name !== name || inv[i].n >= 64) continue;
      var m = Math.min(n, 64 - inv[i].n); if (!dry) inv[i].n += m; n -= m;
    }
    var free = Pg.INV_SLOTS - inv.length;
    while (n > 0 && free > 0) { var k = Math.min(n, 64); if (!dry) inv.push({ name: name, n: k }); n -= k; free--; }
    return n;
  };
  /** `PiglinEntity.prefersNewEquipment`: golden/crossbow beat anything else, an adult keeps its crossbow
   *  over a non-crossbow; otherwise `MobEntity.prefersNewEquipment` (`Eq.prefersNewEquipment`). */
  Pg.prefersNew = function (e, n, o) {
    var I = IT(), Cb = NS.Combat;
    if (o && Cb && Cb.enchantLevel && Cb.enchantLevel(o, 'binding_curse') > 0) return false;
    var nn = I.nameOf(n.i), on = o ? I.nameOf(o.i) : '';
    var a = Pg.isGoldenItem(nn) || nn === 'crossbow', b = !!o && (Pg.isGoldenItem(on) || on === 'crossbow');
    if (a && !b) return true;
    if (!a && b) return false;
    if (Pg.isAdult(e) && nn !== 'crossbow' && on === 'crossbow') return false;
    return NS.Equip.prefersNewEquipment(n, o);
  };
  /** `MobEntity.getPreferredEquipmentSlot`: anything that is not armour/offhand goes to the MAIN hand. */
  Pg.slotOf = function (st) { var sl = NS.Equip.preferredSlot(st); return sl < 0 ? IT().MAINHAND : sl; };
  /** `PiglinEntity.canEquipStack`. */
  Pg.canEquipStack = function (e, st) {
    var Eq = NS.Equip, slot = Pg.slotOf(st);
    return Pg.prefersNew(e, st, Eq.getEquipped(e, slot));
  };
  /** `PiglinBrain.canGather` for ONE item of `name` (`count` is the whole ground stack, for the nugget). */
  Pg.canGatherItem = function (e, name, count) {
    var I = IT(), Eq = NS.Equip;
    if (Pg.isBaby(e) && Pg.tagged('ignored_by_piglin_babies', name)) return false;
    if (Pg.tagged('piglin_repellents', name)) return false;
    if (e.target && e.pgHitByPlayerUntil !== undefined && (e.pgClock | 0) <= e.pgHitByPlayerUntil) return false;
    if (name === Pg.BARTER_ITEM) return Pg.noGoldInOffhand(e);
    var fits = Pg.invAdd(e, name, name === 'gold_nugget' ? count : 1, true) === 0;
    if (name === 'gold_nugget') return fits;
    if (Pg.tagged('piglin_food', name)) return !Pg.hasAteRecently(e) && fits;
    if (!Pg.isGoldenItem(name)) return Pg.canEquipStack(e, Eq.stackOf(name));
    return Pg.noGoldInOffhand(e) && fits;
  };
  /** The nearest item entity the piglin can gather within `range` (WalkToNearestVisibleWantedItemTask). */
  Pg.nearestWantedItem = function (e, range) {
    var EL = NS.EntityList, I = IT();
    if (!EL || !EL.list || !I || !I.ready) return null;
    var best = null, bd = range * range;
    for (var i = 0; i < EL.list.length; i++) {
      var o = EL.list[i];
      if (!o || o.removed || o.dead || o.type !== 'item' || (o.count | 0) <= 0) continue;
      var dx = o.x - e.x, dy = o.y - e.y, dz = o.z - e.z, d = dx * dx + dy * dy + dz * dz;
      if (d <= bd && Pg.canGatherItem(e, I.nameOf(o.item), o.count | 0)) { bd = d; best = o; }
    }
    return best;
  };

  /** `WalkToNearestVisibleWantedItemTask(doesNotHaveGoldInOffHand, 1.0F, true, 9)`. */
  Pg.WalkToItemGoal = function (e) {
    var target = null, path = null, idx = 1, Ai = NS.Ai;
    this.canUse = function () { if (!Pg.noGoldInOffhand(e)) return false; target = Pg.nearestWantedItem(e, 9); return !!target; };
    this.canContinueToUse = function () { return !!target && !target.removed && !target.dead && Pg.noGoldInOffhand(e) && Pg.canGatherItem(e, IT().nameOf(target.item), target.count | 0); };
    this.start = function () { path = Ai.findPath(e.x, e.y, e.z, target.x, target.y, target.z, { mob: e }); idx = 1; };
    this.stop = function () { target = null; path = null; };
    this.tick = function () {
      if (!target) return;
      if (!path || idx >= path.length) { this.start(); if (!path || path.length < 2) { Ai.stepToward(e, { x: target.x, y: target.y, z: target.z }, 1.0); return; } }
      Ai.stepToward(e, path[idx], 1.0);
      if (Ai.closeTo(e, path[idx])) idx++;
    };
  };

  /** `PiglinBrain.barterItem`: into the inventory; what does not fit is tossed (`dropBarteredItem`). */
  Pg.barterItem = function (e, name, n) {
    var left = Pg.invAdd(e, name, n);
    if (left > 0) Pg.dropToward(e, name, left, null);
  };
  /** The shared tail of `loot`/`consumeOffHandItem`: `tryEquip`, else `barterItem`. */
  Pg.equipOrStash = function (e, name) {
    var Eq = NS.Equip, st = Eq.stackOf(name);
    if (!st) return;
    var slot = Pg.slotOf(st);
    if (Eq.preferredSlot(st) >= 0) { if (!Eq.tryEquip(e, st, rnd())) Pg.barterItem(e, name, 1); return; }
    if (!Pg.prefersNew(e, st, Eq.getEquipped(e, slot))) { Pg.barterItem(e, name, 1); return; }
    var old = Eq.getEquipped(e, slot);   // MobEntity.tryEquip for a slot-less item: old drops, new takes the hand
    if (old) NS.EntityList.dropStack(e.x, e.y + (e.height || 1) * 0.5, e.z, old.i, old.n || 1);
    Eq.setEquipped(e, slot, st); Eq.setDropChance(e, slot, Eq.OMINOUS_BANNER_DROP_CHANCE); e.persistent = true;
  };

  /** `PiglinBrain.loot` + `MobEntity.tickMovement`'s pickup scan, any item `canGather` allows: a gold nugget
   *  takes the WHOLE stack into the inventory, anything else ONE item -- admired if piglin_loved (offhand
   *  swap), eaten-recently if piglin_food, else equipped if preferred, else stashed. */
  Pg.lootTick = function (e) {
    var EL = NS.EntityList, I = IT();
    if (e.type !== 'piglin' || !EL || !EL.ready || !EL.list || !I || !I.ready) return;
    var hw = (e.width || 0.6) * 0.5, h = e.height || 1.95;
    var x0 = e.x - hw - 1.0, x1 = e.x + hw + 1.0, y0 = e.y - 0.5, y1 = e.y + h + 0.5, z0 = e.z - hw - 1.0, z1 = e.z + hw + 1.0;
    for (var i = 0; i < EL.list.length; i++) {
      var o = EL.list[i];
      if (!o || o.removed || o.dead || o.type !== 'item' || (o.pickupDelay | 0) > 0) continue;
      var ehw = (o.width || 0.25) * 0.5, eh = o.height || 0.25;
      if (o.x + ehw < x0 || o.x - ehw > x1) continue;
      if (o.y + eh < y0 || o.y > y1) continue;
      if (o.z + ehw < z0 || o.z - ehw > z1) continue;
      var count = o.count | 0, name = I.nameOf(o.item); if (count <= 0 || !name) continue;
      if (!Pg.canGatherItem(e, name, count)) continue;
      NS.Equip.triggerPickedUp(e, o);   // PiglinEntity.loot: triggerItemPickedUpByEntityCriteria, then PiglinBrain.loot
      if (name === 'gold_nugget') { Pg.invAdd(e, name, count); EL.remove(o); return; }
      if (count > 1) o.count = count - 1; else EL.remove(o);
      if (Pg.isGoldenItem(name)) {
        Pg.swapOffhand(e, NS.Inventory ? NS.Inventory.stack(name, 1, 0, null) : { i: o.item, n: 1, d: 0 });
        Pg.setAdmiring(e);
      } else if (Pg.tagged('piglin_food', name) && !Pg.hasAteRecently(e)) Pg.setEatenRecently(e);
      else Pg.equipOrStash(e, name);
      return;
    }
  };

  /** `PiglinBrain.playerInteract`/`isWillingToTrade` -- a gold ingot handed directly. Returns
   *  true if consumed; the caller (`Use.entityUse`) shrinks the player's stack by 1 itself, the
   *  same way every other item-consuming branch there already does. */
  Pg.playerInteract = function (e, itemName) {
    if (e.type !== 'piglin' || !Pg.isAdult(e)) return false;
    if (Pg.isAdmiring(e)) return false;
    if (e.pgHitByPlayerUntil !== undefined && (e.pgClock | 0) <= e.pgHitByPlayerUntil) return false;
    if (!Pg.acceptsForBarter(itemName)) return false;
    var one = NS.Inventory ? NS.Inventory.stack(Pg.BARTER_ITEM, 1, 0, null) : null;
    if (!one) return false;
    Pg.swapOffhand(e, one);
    Pg.setAdmiring(e);
    e.pgBarterPlayer = NS.Player;
    return true;
  };

  // ── barter (`loot_tables/gameplay/piglin_bartering.json`, read whole out of the real jar --
  // a `minecraft:barter` table, which draws ONE weighted item from the pool, not vanilla's usual
  // per-pool roll count) ─────────────────────────────────────────────────────────────────────
  Pg.BARTER_TABLE = [
    { item: 'enchanted_book', weight: 5, enchant: 'soul_speed' },
    { item: 'iron_boots', weight: 8, enchant: 'soul_speed' },
    { item: 'potion', weight: 8, potion: 'fire_resistance' },
    { item: 'splash_potion', weight: 8, potion: 'fire_resistance' },
    { item: 'potion', weight: 10, potion: 'water' },
    { item: 'iron_nugget', weight: 10, min: 10, max: 36 },
    { item: 'ender_pearl', weight: 10, min: 2, max: 4 },
    { item: 'string', weight: 20, min: 3, max: 9 },
    { item: 'quartz', weight: 20, min: 5, max: 12 },
    { item: 'obsidian', weight: 40 },
    { item: 'crying_obsidian', weight: 40, min: 1, max: 3 },
    { item: 'fire_charge', weight: 40 },
    { item: 'leather', weight: 40, min: 2, max: 4 },
    { item: 'soul_sand', weight: 40, min: 2, max: 8 },
    { item: 'nether_brick', weight: 40, min: 2, max: 8 },
    { item: 'spectral_arrow', weight: 40, min: 6, max: 12 },
    { item: 'gravel', weight: 40, min: 8, max: 16 },
    { item: 'blackstone', weight: 40, min: 8, max: 16 }
  ];
  Pg.BARTER_WEIGHT = 0;
  (function () { for (var i = 0; i < Pg.BARTER_TABLE.length; i++) Pg.BARTER_WEIGHT += Pg.BARTER_TABLE[i].weight; })();
  /** The barter table's ONE weighted draw. Every item/weight/count range above is the jar's own
   *  file; the `enchant_randomly` (soul_speed) and `set_potion` (fire_resistance/water) FUNCTIONS
   *  are not applied to the dropped stack -- this engine's `item` entity carries no NBT tag yet
   *  (07i_entitylist.js's own spawn only takes `opts.item`/`opts.count`, never a tag), so a
   *  bartered book or iron boots drops plain and a bartered potion drops nameless. Named here,
   *  not hidden -- and every item identity, weight and count range is still the real table. */
  Pg.rollBarter = function (r) {
    var roll = r() * Pg.BARTER_WEIGHT, t = Pg.BARTER_TABLE, i;
    for (i = 0; i < t.length; i++) {
      roll -= t[i].weight;
      if (roll < 0) break;
    }
    var pick = t[i] || t[t.length - 1];
    var count = pick.min !== undefined ? (pick.min + Math.floor(r() * (pick.max - pick.min + 1))) : 1;
    var tag = null;
    if (pick.enchant) {                      // enchant_randomly{enchantments:[soul_speed]}: level uniform 1..max
      var lvl = 1 + Math.floor(r() * 3), ent = [{ id: 'minecraft:' + pick.enchant, lvl: lvl }];
      tag = pick.item === 'enchanted_book' ? { StoredEnchantments: ent } : { Enchantments: ent };
    } else if (pick.potion) tag = { Potion: 'minecraft:' + pick.potion };   // set_potion
    return { name: pick.item, count: count, tag: tag };
  };

  Pg.BARTER_TOSS_SPEED = 0.3;   // LookTargetUtil.give's own fixed toss speed
  /** `LookTargetUtil.give`: dropped at the piglin, tossed toward `target` (the player who handed
   *  the gold, when remembered) at a fixed low speed; with no remembered player toward
   *  `findGround`'s `FuzzyTargeting.find(4, 2)` spot (Ai.fuzzyTarget), else the piglin's own feet. */
  Pg.dropToward = function (e, name, count, target, tag) {
    var EL = NS.EntityList, I = IT();
    if (!EL || !EL.dropStack || !I || !I.ready) return null;
    var idx = I.of(name); if (idx < 0) return null;
    var it = EL.dropStack(e.x, e.y + (e.isBaby ? 0.93 : 1.74) - 0.3, e.z, idx, count, { pickupDelay: 10, tag: tag });
    if (it && !alive(target) && NS.Ai && NS.Ai.fuzzyTarget) {   // findGround: FuzzyTargeting.find(piglin, 4, 2) or its own pos, +1 y
      var g = NS.Ai.fuzzyTarget(e, 4, 2, Pg.groundRand || NS.Ai.rndOf(e)) || { x: e.x, y: e.y, z: e.z };
      var gx = g.x - e.x, gy = g.y + 1 - e.y, gz = g.z - e.z, gl = Math.hypot(gx, gy, gz) || 1;
      it.vx = gx / gl * Pg.BARTER_TOSS_SPEED; it.vy = gy / gl * Pg.BARTER_TOSS_SPEED; it.vz = gz / gl * Pg.BARTER_TOSS_SPEED;
    } else if (it && alive(target)) {
      var dx = target.x - e.x, dy = target.y - e.y, dz = target.z - e.z;   // LookTargetUtil.give: player getPos() - piglin getPos(), feet to feet
      var len = Math.hypot(dx, dy, dz) || 1, sp = Pg.BARTER_TOSS_SPEED;
      it.vx = dx / len * sp; it.vy = dy / len * sp; it.vz = dz / len * sp;
    }
    return it;
  };

  /** `PiglinBrain.consumeOffHandItem`, narrowed the same way `Pg.lootTick` is: the offhand only
   *  ever holds a gold ingot here, so the adult `acceptsForBarter` branch is the only reachable
   *  one -- `doBarter` true (normal admire expiry, `RemoveOffHandItemTask`) rolls the barter
   *  table, false (the item was interrupted -- an attack, see `Pg.onAttacked`) just drops the
   *  ingot back. A baby never reaches this: `isWillingToTrade`/`lootTick` both require an adult. */
  Pg.consumeOffHand = function (e, doBarter) {
    var stack = Pg.offhand(e);
    Pg.offhandClear(e);
    Pg.forgetAdmiring(e);
    var target = e.pgBarterPlayer; e.pgBarterPlayer = null;
    if (!stack) return;
    var sname = IT().nameOf(stack.i);
    if (sname !== Pg.BARTER_ITEM) { Pg.equipOrStash(e, sname); return; }   // !acceptsForBarter: tryEquip, else barterItem
    if (doBarter) {
      var drop = Pg.rollBarter(rnd());
      Pg.dropToward(e, drop.name, drop.count, target, drop.tag);
    }   // !doBarter with an acceptsForBarter stack: neither branch runs in vanilla, the ingot is destroyed
  };

  /** `RemoveOffHandItemTask`: once the ADMIRING_ITEM memory has expired -- which in this engine
   *  is the ONLY way an offhand item ever gets here, so this fires exactly once per admire, at
   *  the tick the `ADMIRE_TICKS` window closes -- consume the item (barter). */
  Pg.tickAdmire = function (e) {
    if (e.type !== 'piglin') return;      // RemoveOffHandItemTask/AdmireItemTask: PiglinEntity only
    if (Pg.offhand(e) && !Pg.isAdmiring(e)) Pg.consumeOffHand(e, true);
  };

  /** `PiglinBrain.hasIdleActivity`: no fight/avoid/admire/celebrate activity running -- the
   *  closest read of that this engine's simpler state has: not angry, not admiring, not a baby
   *  (a baby never becomes angry from this at all, `onGuardedBlockInteracted`'s own stream only
   *  even LOOKS at `PiglinEntity`, and every one of them is adult-gated the same way the target
   *  goal already is). */
  /** Vanilla `hasActivity(IDLE)`, what `AbstractPiglinEntity.playAmbientSound` gates on: none of FIGHT/ADMIRE_ITEM/RETREAT/CELEBRATE/RIDE. */
  Pg.inIdleActivity = function (e) { return !(e.target || Pg.angryAt(e) || Pg.isAdmiring(e) || Pg.avoidTarget(e) || Pg.isCelebrating(e) || e.vehicle); };
  Pg.hasIdleActivity = function (e) { return e.type === 'piglin' && !Pg.isBaby(e) && !Pg.angryAt(e) && !Pg.isAdmiring(e); };
  /** `PiglinBrain.onGuardedBlockInteracted`: every piglin within 16 of `player` that is idle
   *  becomes angry, with a line-of-sight requirement only when `requiresLineOfSight` (a mined
   *  block does not need one, an opened chest/barrel/ender chest/shulker box does -- `Block.
   *  onBreak` vs `ChestBlock`/`BarrelBlock`/`EnderChestBlock`/`ShulkerBoxBlock.onUse`, all four
   *  .decomp'd and cited at their own call sites in src/14_player.js and src/15_hud.js). */
  Pg.onGuardedBlockInteracted = function (player, requiresLineOfSight) {
    var EL = NS.EntityList;
    if (!alive(player) || !EL || !EL.list) return;
    for (var i = 0; i < EL.list.length; i++) {
      var o = EL.list[i];
      if (!Pg.hasIdleActivity(o)) continue;
      if (dist(o, player) > Pg.GUARDED_RANGE) continue;
      if (requiresLineOfSight && !visible(o, player)) continue;
      Pg.becomeAngryWith(o, player);
    }
  };

  /** `FollowMobTask(isGoldHoldingPlayer, 14.0F)`: an idle piglin walks toward a nearby player
   *  holding a golden item. Vanilla's task only SETS a walk/look target; the walk itself is a
   *  separate always-on task this engine has no equivalent of, so this goal both aims and moves
   *  and needs a stopping distance vanilla's own version never states (`Pg.FOLLOW_GOLD_STOP`). */
  Pg.GoldFollowGoal = function (e) {
    var target = null, path = null, idx = 1, Ai = NS.Ai;
    function inRange(t) { var d = dist(e, t); return d > Pg.FOLLOW_GOLD_STOP && d <= Pg.FOLLOW_GOLD_RANGE; }
    this.canUse = function () {
      if (e.type !== 'piglin' || Pg.isBaby(e) || Pg.angryAt(e) || Pg.isAdmiring(e)) return false;
      var P = NS.Player;
      if (!P || !alive(P) || !inRange(P) || !visible(e, P) || !Pg.isGoldHoldingPlayer(P)) return false;
      target = P; return true;
    };
    this.canContinueToUse = function () {
      return !!target && alive(target) && !Pg.angryAt(e) && inRange(target) && Pg.isGoldHoldingPlayer(target);
    };
    this.start = function () { path = Ai.findPath(e.x, e.y, e.z, target.x, target.y, target.z, { mob: e }); idx = 1; };
    this.stop = function () { target = null; path = null; };
    this.tick = function () {
      if (!target) return;
      if (!path || idx >= path.length) { this.start(); return; }
      Ai.stepToward(e, path[idx], 1.0);
      if (Ai.closeTo(e, path[idx])) idx++;
    };
  };


  /** Walk-to-a-block goal: `LookTargetUtil.walkTowards(mob, pos, speed, completionRange)`. */
  function WalkTo(e, want, speed, range) {
    var path = null, idx = 1, Ai = NS.Ai, tgt = null;
    this.canUse = function () { tgt = want(); return !!tgt && Math.hypot(tgt.x + 0.5 - e.x, tgt.z + 0.5 - e.z) > range; };
    this.canContinueToUse = this.canUse;
    this.start = function () { path = Ai.findPath(e.x, e.y, e.z, tgt.x, tgt.y, tgt.z, { mob: e }); idx = 1; };
    this.stop = function () { path = null; };
    this.tick = function () {
      if (!path || idx >= path.length) { this.start(); return; }
      Ai.stepToward(e, path[idx], speed);
      if (Ai.closeTo(e, path[idx])) idx++;
    };
  }
  /** `GoToCelebrateTask(4, 0.6F)` (the dancing branch; the `(2, 1.0F)` branch needs !isDancing, which never
   *  holds while CELEBRATE_LOCATION is set here). ponytail: no per-run +-1 fuzz on the spot (range 4 swamps it). */
  Pg.CELEBRATE_RANGE = 4; Pg.CELEBRATE_SPEED = 0.6;
  Pg.CelebrateGoal = function (e) {
    return new WalkTo(e, function () { return Pg.isCelebrating(e) && !Pg.angryAt(e) ? e.pgCelebrateAt : null; }, Pg.CELEBRATE_SPEED, Pg.CELEBRATE_RANGE);
  };

  // ── RIDE (PiglinBrain.makeRememberRideableHoglinTask/addRideActivities/canRide/canRideHoglin,
  // StartRidingTask(0.8), RidingTask(8, canRide)) ──────────────────────────────────────────────────
  Pg.RIDE_MIN = 200; Pg.RIDE_MAX = 600;   // RIDE_TARGET_MEMORY_DURATION: betweenSeconds(10, 30)
  Pg.rideTarget = function (e) {
    var t = e.pgRideTarget;
    if (t && (e.pgClock | 0) > e.pgRideUntil) t = e.pgRideTarget = null;
    return t || null;
  };
  /** `PiglinBrain.hasBeenHurt`: the HURT_BY memory; here "has a live attacker recorded". */
  function hurt(o) { return !!o.lastHurtByEntity; }
  /** `PiglinBrain.canRide`: true means the ride is OVER (RidingTask.shouldRun's alternative condition). */
  Pg.canRideEnds = function (e, o) {
    return !o.isBaby || !alive(o) || hurt(e) || hurt(o) || (o.type === 'piglin' && !o.vehicle);
  };
  Pg.tickRide = function (e) {
    var Rd = NS.Raid, t = Pg.rideTarget(e);
    if (e.type !== 'piglin' || !Rd) return;
    if (Pg.isBaby(e) && !t && !e.vehicle) {   // MemoryTransferTask(isBaby, NEAREST_VISIBLE_BABY_HOGLIN -> RIDE_TARGET)
      var h = nearest(e, function (o) { return o.type === 'hoglin' && o.isBaby; }, Pg.SENSE_RANGE);
      if (h) { e.pgRideTarget = t = h; e.pgRideUntil = (e.pgClock | 0) + Pg.RIDE_MIN + Math.floor(rnd()() * (Pg.RIDE_MAX - Pg.RIDE_MIN + 1)); }
    }
    var v = e.vehicle, o = v || t;
    if (o && t && (!(alive(o) && dist(e, o) <= 8) || Pg.canRideEnds(e, o))) {   // RidingTask
      if (v) Rd.stopRiding(e);
      e.pgRideTarget = null; return;
    }
    if (!t && v && Pg.isBaby(e) && v.isBaby && (v.type === 'hoglin' || v.type === 'piglin')) Rd.stopRiding(e);   // canRideHoglin
    else if (t && !v && dist(e, t) <= 1.0 && !Pg.angryAt(e)) {   // StartRidingTask -> PiglinEntity.startRiding: baby onto a hoglin = getTopMostPassenger(target, 3)
      var top = t;
      if (Pg.isBaby(e) && t.type === 'hoglin') for (var d = 0; d < 2 && top.passenger; d++) top = top.passenger;
      Rd.startRiding(e, top);
    }
  };
  Pg.RideGoal = function (e) {
    return new WalkTo(e, function () { var t = Pg.rideTarget(e); return t && !e.vehicle && !Pg.angryAt(e) ? { x: Math.floor(t.x), y: Math.floor(t.y), z: Math.floor(t.z) } : null; }, 0.8, 1);
  };

  // ── AVOID (PiglinBrain: addAvoidActivities/onAttacked's baby branch/makeGoToZombifiedPiglinTask/
  // goToNemesisTask/makeGoToSoulFireTask, `PiglinSpecificSensor.findPiglinRepellent`, all .decomp'd
  // whole this session; piglin_brute has NO avoid activity at all -- PiglinBruteBrain.java, read
  // whole, never touches AVOID_TARGET/NEAREST_REPELLENT/a zombified piglin) ─────────────────────────────────────
  Pg.AVOID_FLEE_SPEED = 1.0; Pg.AVOID_FLEE_RANGE = 12;   // GoToRememberedPositionTask.toEntity(AVOID_TARGET, 1.0F, 12, true)
  Pg.REPEL_FLEE_SPEED = 1.0; Pg.REPEL_FLEE_RANGE = 8;    // makeGoToSoulFireTask: toBlock(NEAREST_REPELLENT, 1.0F, 8, false)
  Pg.REPEL_H = 8; Pg.REPEL_V = 4;                        // findPiglinRepellent: BlockPos.findClosest(pos, 8, 4, ...)
  Pg.GO_TO_ZOMBIFIED_MIN = 100; Pg.GO_TO_ZOMBIFIED_MAX = 140;   // GO_TO_ZOMBIFIED_MEMORY_DURATION: betweenSeconds(5, 7)
  Pg.GO_TO_NEMESIS_MIN = 100; Pg.GO_TO_NEMESIS_MAX = 140;       // GO_TO_NEMESIS_MEMORY_DURATION: betweenSeconds(5, 7)

  /** `PiglinBrain.getAvoiding`/the AVOID_TARGET memory's own expiry read -- the SAME shape
   *  `Pg.angryAt` already uses for ANGRY_AT, `Hg.avoidTarget`'s own header cites the identical
   *  pattern on the hoglin side. Set directly by `Pg.onAttacked`'s baby branch (100 ticks) and by
   *  `Pg.tickAvoid` below (a nearby zombified piglin, or a baby's nemesis). */
  Pg.avoidTarget = function (e) {
    if (!e.avoidEnt) return null;
    if (!alive(e.avoidEnt) || (e.avoidUntil !== undefined && (e.pgClock | 0) > e.avoidUntil)) { e.avoidEnt = null; return null; }
    return e.avoidEnt;
  };
  Pg.setAvoidTarget = function (e, target, minT, maxT) {
    if (!alive(target)) return;
    var r = rnd();
    e.avoidEnt = target;
    e.avoidUntil = (e.pgClock | 0) + minT + Math.floor(r() * (maxT - minT + 1));
  };
  /** `getNearestZombifiedPiglin`: the nearest visible zombified piglin, AND within 6 -- the SAME
   *  test `Pg.preferredTarget` already runs to clear the fight target; `makeGoToZombifiedPiglinTask`
   *  is this exact predicate feeding AVOID_TARGET for 5-7 seconds once it is true. */
  Pg.nearestZombifiedNear = function (e) {
    var zp = nearest(e, function (o) { return o.type === 'zombified_piglin' || o.type === 'zoglin'; }, Pg.SENSE_RANGE);
    return (zp && dist(e, zp) <= Pg.ZOMBIFIED_NEAR) ? zp : null;
  };
  /** `findPiglinRepellent`/`PiglinSpecificSensor`: the nearest `piglin_repellents` block (soul
   *  fire, a lit soul campfire, a soul lantern/torch) within 8 across, 4 up/down -- the exact
   *  shape `Hg.nearestRepellent`'s own header already used for the hoglin's `hoglin_repellents`
   *  tag, a DIFFERENT tag with the same search box by coincidence, not shared code. */
  Pg.nearestRepellent = function (e) {
    var W = NS.World, T = NS.Tags;
    if (!W || !W.getBlock || !T || !T.stateIn) return null;
    var bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z), best = null, bd = Infinity;
    for (var dy = -Pg.REPEL_V; dy <= Pg.REPEL_V; dy++)
      for (var dx = -Pg.REPEL_H; dx <= Pg.REPEL_H; dx++)
        for (var dz = -Pg.REPEL_H; dz <= Pg.REPEL_H; dz++) {
          var st = W.getBlock(bx + dx, by + dy, bz + dz);
          if (!st || !T.stateIn('piglin_repellents', st)) continue;
          var d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < bd) { bd = d2; best = { x: bx + dx + 0.5, y: by + dy, z: bz + dz + 0.5 }; }
        }
    return best;
  };
  /** Every tick: a nearby zombified piglin (within 6) or, for a baby, a nearby nemesis
   *  (wither/wither skeleton) becomes a fresh AVOID_TARGET for 5-7 seconds -- `goToNemesisTask`/
   *  `makeGoToZombifiedPiglinTask`, both `MemoryTransferTask`s in vanilla's own core activity
   *  list, run every tick regardless of activity, same as this. */
  Pg.tickAvoid = function (e) {
    if (e.type !== 'piglin') return;
    var zp = Pg.nearestZombifiedNear(e);
    if (zp) Pg.setAvoidTarget(e, zp, Pg.GO_TO_ZOMBIFIED_MIN, Pg.GO_TO_ZOMBIFIED_MAX);
    if (Pg.isBaby(e)) {
      var nem = Pg.nemesis(e);
      if (nem) Pg.setAvoidTarget(e, nem, Pg.GO_TO_NEMESIS_MIN, Pg.GO_TO_NEMESIS_MAX);
    }
  };
  /** `GoToRememberedPositionTask`: walk AWAY from a remembered position/entity within `range` --
   *  the SAME class (and the SAME shape) `Hg.FleeGoal`'s own header already read it as; a plain
   *  `{x,y,z}` block spot (`Pg.nearestRepellent`'s own return) and a live entity both work as
   *  `threat` unchanged, since only `.x`/`.z` are ever read off it here. */
  Pg.FleeGoal = function (e, speed, range, getThreat) {
    var path = null, idx = 1, from = null, Ai = NS.Ai;
    this.canUse = function () {
      var t = getThreat();
      if (!t || Math.hypot(t.x - e.x, t.z - e.z) >= range) return false;
      from = t; return true;
    };
    this.canContinueToUse = function () {
      var t = getThreat();
      return !!t && Math.hypot(t.x - e.x, t.z - e.z) < range && !!path && idx < path.length;
    };
    this.start = function () {
      var dx = e.x - from.x, dz = e.z - from.z, len = Math.hypot(dx, dz) || 1;
      path = Ai.findPath(e.x, e.y, e.z, e.x + dx / len * range, e.y, e.z + dz / len * range, { mob: e });
      idx = 1;
    };
    this.stop = function () { path = null; from = null; };
    this.tick = function () {
      if (!path || idx >= path.length) return;
      Ai.stepToward(e, path[idx], speed);
      if (Ai.closeTo(e, path[idx])) idx++;
    };
  };

  // ── spawn (EL.DEFAULTS.piglin / piglin_brute call these) ──────────────────────────────────
  Pg.initPiglin = function (e, opts) {
    var Eq = NS.Equip, I = IT(), r = rnd();
    opts = opts || {};
    e.timeInOverworld = e.timeInOverworld | 0;
    if (opts.conversion) return;
    var structure = opts.spawnReason === 'structure';
    if (!structure && !e.isBaby) {
      if (r() < Pg.BABY_CHANCE) Pg.setBaby(e, true);
      else if (Eq && Eq.ready && I && I.ready) {
        var w = r() < Pg.CROSSBOW_CHANCE ? 'crossbow' : 'golden_sword';
        var st = Eq.stackOf(w); if (st) Eq.setEquipped(e, I.MAINHAND, st);
      }
    } else if (e.isBaby) Pg.setBaby(e, true);
    Pg.rememberHunting(e);   // PiglinEntity.initialize -> PiglinBrain.setHuntedRecently
    if (Eq && Eq.ready && I && I.ready && Pg.isAdult(e)) {
      var slots = [I.HEAD, I.CHEST, I.LEGS, I.FEET], names = ['golden_helmet', 'golden_chestplate', 'golden_leggings', 'golden_boots'];
      // initEquipment's own order: HEAD, CHEST, LEGS, FEET — one roll each
      for (var i = 0; i < 4; i++) if (r() < Pg.ARMOR_CHANCE) { var a = Eq.stackOf(names[i]); if (a) Eq.setEquipped(e, slots[i], a); }
    }
    if (Eq && Eq.ready && Eq.updateEnchantments) Eq.updateEnchantments(e, r);
  };
  Pg.initBrute = function (e, opts) {
    var Eq = NS.Equip, I = IT();
    e.timeInOverworld = e.timeInOverworld | 0;
    if (opts && opts.conversion) return;
    e.homeX = e.x; e.homeY = e.y; e.homeZ = e.z;   // PiglinBruteBrain.setCurrentPosAsHome
    if (Eq && Eq.ready && I && I.ready) { var st = Eq.stackOf('golden_axe'); if (st) Eq.setEquipped(e, I.MAINHAND, st); }
  };
  /** `PiglinEntity.setBaby`: the BABY flag + the 0.2 MULTIPLY_BASE speed modifier. A piglin is not a
   *  PassiveEntity — it never grows up (EL.PERMANENT_BABY). */
  Pg.setBaby = function (e, baby) {
    var Br = NS.Breed;
    if (Br && Br.setAge) Br.setAge(e, baby ? -24000 : 0); else { e.growAge = baby ? -24000 : 0; e.isBaby = !!baby; }
    var at = NS.Entities && NS.Entities.attrsOf ? NS.Entities.attrsOf(e.type) : null;
    if (baby && at && at.speed) e.speedAttr = at.speed * (1 + Pg.BABY_SPEED_MULT);
    else delete e.speedAttr;
  };

  // ── zombification ─────────────────────────────────────────────────────────────────────────
  /** `shouldZombify`: `!isPiglinSafe() && !immune && !isAiDisabled()`. */
  Pg.shouldZombify = function (e) {
    var W = NS.World, dt = W && W.dimType ? W.dimType() : null;
    return !(dt && dt.piglinSafe) && !e.immuneToZombification && !e.aiDisabled;
  };
  /** `PiglinEntity.inventory` (SimpleInventory(8)) `.clearToList()`: every non-empty stack as {item,count}, slots emptied. */
  Pg.dropInventory = function (e) {
    var out = [], I = IT();
    if (e.type !== 'piglin' || !e.inventory || !I || !I.ready) return out;
    for (var k = 0; k < e.inventory.length; k++) {
      var s = e.inventory[k];
      if (s && s.n > 0) out.push({ item: I.nameOf(s.i), count: s.n });
    }
    e.inventory = null;
    return out;
  };
  Pg.zombify = function (e) {
    var EL = NS.EntityList;
    var inv = Pg.dropInventory(e);   // PiglinEntity.zombify: inventory.clearToList().forEach(dropStack)
    for (var q = 0; q < inv.length; q++) { var qi = IT().of(inv[q].item); if (qi >= 0 && EL && EL.dropStack) EL.dropStack(e.x, e.y, e.z, qi, inv[q].count); }
    // PiglinEntity.zombify: pickupItemWithOffHand -- an admired offhand item is dropped, not converted.
    if (e.type === 'piglin' && Pg.isAdmiring(e) && Pg.offhand(e)) Pg.swapOffhand(e, null);
    if (NS.Sound && NS.Sound.mobSound) NS.Sound.mobSound(e, Pg.SOUND_ZOMBIFY[e.type]);
    if (!EL || !EL.spawn || !EL.canSpawn('zombified_piglin')) { e.removed = true; return null; }
    // MobEntity.convertTo(type, keepEquipment=true): position/yaw, baby, name, persistence, AI flag,
    // every equipment slot and its drop chance. No initialize runs on the new mob.
    var z = EL.spawn('zombified_piglin', e.x, e.y, e.z, { conversion: true });
    if (z) {
      z.yaw = e.yaw;
      if (NS.Breed && NS.Breed.setAge) NS.Breed.setAge(z, e.isBaby ? -24000 : 0); else { z.growAge = e.growAge; z.isBaby = e.isBaby; }
      if (e.customName !== undefined) z.customName = e.customName;
      if (e.persistent) z.persistent = true;
      if (e.aiDisabled) z.aiDisabled = true;
      z.equip = e.equip ? e.equip.slice() : z.equip;
      if (e.equipDropChance) z.equipDropChance = e.equipDropChance.slice();
      if (NS.Effects && NS.Effects.addStatusEffect) NS.Effects.addStatusEffect(z, 'nausea', Pg.ZOMBIFY_NAUSEA, 0);
    }
    e.removed = true;
    return z;
  };

  // ── anger (PiglinBrain.onAttacked / tryRevenge / angerAtCloserTargets / becomeAngryWith) ──
  /** `Sensor.testAttackableTargetPredicateIgnoreVisibility`: false for creative/spectator/invulnerable players. */
  Pg.attackableIgnoreVis = function (t) { var Ai = NS.Ai; return !(Ai && Ai.canTargetLiving) || Ai.canTargetLiving(t); };
  Pg.angryAt = function (e) {
    if (!e.angryAtEnt) return null;
    // getTarget re-tests the ANGRY_AT entity with testAttackableTargetPredicateIgnoreVisibility
    if (e.angryAtUntil !== undefined && e.pgClock > e.angryAtUntil) { e.angryAtEnt = null; return null; }
    if (!alive(e.angryAtEnt)) {
      // ForgetAngryAtTargetTask: a dead PLAYER is only forgotten under universalAnger; otherwise the
      // memory (a UUID in vanilla) outlives the death and re-aims at the respawned player
      if (e.angryAtEnt === NS.Player && !Pg.universalAnger()) return null;
      e.angryAtEnt = null; return null;
    }
    if (!Pg.attackableIgnoreVis(e.angryAtEnt)) { e.angryAtEnt = null; return null; }
    return e.angryAtEnt;
  };
  /** `becomeAngryWith` also feeds `PiglinBrain.rememberHunting`'s trigger for a REAL hunt (as
   *  opposed to ordinary revenge): a hoglin target is remembered as `pgHuntTarget` so
   *  `Pg.tickHunt` can tell "the thing I was hunting just died" from "the thing I was angry at
   *  for some other reason is gone", and start CELEBRATE only for the former. */
  Pg.becomeAngryWith = function (e, t) {
    if (!alive(t)) return;
    e.angryAtEnt = t; e.angryAtUntil = (e.pgClock | 0) + Pg.ANGER_TICKS;
    e.pgHuntTarget = (t.type === 'hoglin') ? t : null;
  };
  Pg.nearbyAdultPiglins = function (e) {
    var EL = NS.EntityList, out = [];
    if (!EL || !EL.list) return out;
    for (var i = 0; i < EL.list.length; i++) {
      var o = EL.list[i];
      if (o === e || !Pg.TYPES[o.type] || !alive(o) || Pg.isBaby(o)) continue;
      if (dist(o, e) <= Pg.SENSE_RANGE) out.push(o);   // sensor reads the unfiltered MOBS memory (no line of sight)
    }
    return out;
  };

  // ── HUNT (`HuntHoglinTask`, `PiglinBrain.angerAtCloserTargets`/`rememberGroupHunting`/
  // `rememberHunting`/`haveHuntedHoglinsRecently`, all .decomp'd whole this session) + the
  // CELEBRATE that follows a kill ─────────────────────────────────────────────────────────
  Pg.HUNT_MEMORY_MIN = 600; Pg.HUNT_MEMORY_MAX = 2400;   // HUNT_MEMORY_DURATION: betweenSeconds(30, 120)
  /** `PiglinEntity.canHunt`/`PiglinBruteEntity.canHunt`: a brute is hardcoded `false`; a piglin
   *  is `!cannotHunt`, an NBT-only field (`readCustomDataFromNbt`'s own `CannotHunt`, no in-game
   *  setter) this engine never sets -- same gap as `Hg`'s own `cannotBeHunted`, named not hidden. */
  Pg.canHunt = function (e) { return e.type === 'piglin' && !e.pgCannotHunt; };
  /** `PiglinBrain.rememberHunting`: `remember(HUNTED_RECENTLY, true, HUNT_MEMORY_DURATION.get())`. */
  Pg.rememberHunting = function (e) {
    var r = rnd();
    e.pgHuntedUntil = (e.pgClock | 0) + Pg.HUNT_MEMORY_MIN + Math.floor(r() * (Pg.HUNT_MEMORY_MAX - Pg.HUNT_MEMORY_MIN + 1));
  };
  /** `PiglinBrain.haveHuntedHoglinsRecently`: this piglin OR any nearby visible (adult) piglin
   *  has the memory. */
  Pg.huntedRecently = function (e) {
    if (e.pgHuntedUntil !== undefined && (e.pgClock | 0) <= e.pgHuntedUntil) return true;
    var mates = Pg.nearbyAdultPiglins(e);
    for (var i = 0; i < mates.length; i++) {
      var m = mates[i];
      if (m.pgHuntedUntil !== undefined && (m.pgClock | 0) <= m.pgHuntedUntil) return true;
    }
    return false;
  };
  /** The sensor's own `NEAREST_VISIBLE_HUNTABLE_HOGLIN`: nearest visible ADULT hoglin
   *  (`HoglinEntity.canBeHunted` is `isAdult() && !cannotBeHunted` -- `cannotBeHunted` is the
   *  same kind of NBT-only field as `pgCannotHunt` above, `Hg`'s own header already names it
   *  unmodelled, so this reduces to `Hg.isAdult`). `Pg.nearest`'s own visibility/range read off
   *  `Pg.SENSE_RANGE`, the SAME 16 blocks the rest of this file's sensing already uses. */
  Pg.nearestHuntableHoglin = function (e) {
    var Hg = NS.Hoglin;
    if (!Hg) return null;
    return nearest(e, function (o) { return o.type === 'hoglin' && Hg.isAdult(o); }, Pg.SENSE_RANGE);
  };
  /** `PiglinBrain.angerAtCloserTargets`: every nearby adult piglin becomes angry at `target`
   *  UNLESS it is already angry at something closer -- with the hoglin-hunt-specific gate
   *  (`$$1x.canHunt() && ((HoglinEntity)$$1).canBeHunted()`) folded in for a hoglin target, so
   *  `Pg.onAttacked`'s own revenge call below and `Pg.tryHunt`'s hunt call share ONE function,
   *  same as vanilla. */
  Pg.angerAtCloserTargets = function (e, target) {
    var mates = Pg.nearbyAdultPiglins(e);
    for (var i = 0; i < mates.length; i++) {
      var m = mates[i];
      if (target.type === 'hoglin' && !Pg.canHunt(m)) continue;
      var cur = Pg.angryAt(m);
      if (!cur || dist(m, target) < dist(m, cur)) Pg.becomeAngryWith(m, target);
    }
  };
  /** `PiglinBrain.rememberGroupHunting`: every nearby visible piglin remembers HUNTED_RECENTLY
   *  too, whether or not it personally got angry (`angerAtCloserTargets` skips a `!canHunt()`
   *  mate; this does not -- the two decomp calls are siblings in `HuntHoglinTask.run`, not one
   *  calling the other). */
  Pg.rememberGroupHunting = function (e) {
    var mates = Pg.nearbyAdultPiglins(e);
    for (var i = 0; i < mates.length; i++) Pg.rememberHunting(mates[i]);
  };
  /** `HuntHoglinTask`: an idle, non-baby, not-recently-hunting, `canHunt` piglin that sees a
   *  huntable hoglin goes angry at it and starts a group hunt. Returns whether a hunt started,
   *  for tests -- `Pg.tickHunt` is the only real caller. */
  Pg.tryHunt = function (e) {
    if (!Pg.canHunt(e) || Pg.isBaby(e) || Pg.huntedRecently(e)) return false;
    var target = Pg.nearestHuntableHoglin(e);
    if (!target) return false;
    Pg.becomeAngryWith(e, target);
    Pg.rememberHunting(e);
    Pg.angerAtCloserTargets(e, target);
    Pg.rememberGroupHunting(e);
    return true;
  };

  // CELEBRATE_TICKS: DefeatTargetTask.java (.decomp) remembers CELEBRATE_LOCATION for 300 ticks for a hunting-target kill.
  Pg.CELEBRATE_TICKS = 300;
  Pg.SOUND_CELEBRATE = 'entity.piglin.celebrate';   // SoundEvents.java:790, field_22266, read whole
  Pg.isCelebrating = function (e) { return e.pgCelebrateUntil !== undefined && (e.pgClock | 0) < e.pgCelebrateUntil; };
  /** DANCING and CELEBRATE_LOCATION are both set by DefeatTargetTask for the same 300 ticks, so one flag. */
  Pg.isDancing = function (e) { return Pg.isCelebrating(e); };
  Pg.startCelebrating = function (e, at) {
    e.pgCelebrateAt = at ? { x: Math.floor(at.x), y: Math.floor(at.y), z: Math.floor(at.z) } : null;
    e.pgCelebrateUntil = (e.pgClock | 0) + Pg.CELEBRATE_TICKS;
    if (NS.Sound && NS.Sound.mobSound) NS.Sound.mobSound(e, Pg.SOUND_CELEBRATE);
  };
  /** Every tick: notice a hunted hoglin's death and celebrate it (the `HuntFinishTask`-shaped
   *  half named above); otherwise, once idle (not fighting/admiring/already celebrating), try to
   *  start a new hunt. GoToCelebrateTask's own walk-to-a-spot-and-hop MOVEMENT is not built --
   *  celebrating here suppresses re-targeting and plays the sound for `CELEBRATE_TICKS`, nothing
   *  more; named on `Pg.OWED`, not silently dropped. */
  Pg.tickHunt = function (e) {
    if (e.type !== 'piglin') return;
    if (e.pgHuntTarget && !alive(e.pgHuntTarget)) {
      var dead = e.pgHuntTarget;
      e.pgHuntTarget = null;
      if (e.angryAtEnt && !alive(e.angryAtEnt)) e.angryAtEnt = null;
      Pg.startCelebrating(e, dead);
      return;
    }
    if (Pg.isCelebrating(e) || Pg.angryAt(e) || Pg.isAdmiring(e)) return;
    Pg.tryHunt(e);
  };

  /** `hasOutnumberedHoglins`: visible adult hoglins > visible adult piglins (nearby, excl. self) + 1. */
  Pg.hasOutnumberedHoglins = function (e) {
    var EL = NS.EntityList, Hg = NS.Hoglin, n = 0;
    for (var i = 0; EL && EL.list && Hg && i < EL.list.length; i++) {
      var o = EL.list[i];
      if (o.type === 'hoglin' && alive(o) && Hg.isAdult(o) && dist(e, o) <= Pg.SENSE_RANGE && visible(e, o)) n++;
    }
    return n > Pg.nearbyAdultPiglins(e).length + 1;
  };
  /** `runAwayFrom`: forget anger/attack target, remember AVOID_TARGET 5-20 s, then rememberHunting. */
  Pg.runAwayFrom = function (e, t) {
    e.angryAtEnt = null; e.pgHuntTarget = null; e.target = null;
    Pg.setAvoidTarget(e, t, 100, 400);
    Pg.rememberHunting(e);
  };
  /** `PiglinBrain.getSound` (PiglinBrain.java:590): the activity -> SoundEvent map behind `PiglinEntity.getAmbientSound`.
   *  Activity order is tickActivities' list: ADMIRE_ITEM, FIGHT, AVOID, CELEBRATE, RIDE, IDLE.
   *  jealous = the NEAREST_PLAYERS_HOLDING_WANTED_ITEM memory (PiglinSpecificSensor: isGoldHoldingPlayer, sensor box);
   *  last branch hasSoulFireNearby = NEAREST_REPELLENT present. */
  Pg.activitySound = function (e) {
    var act = Pg.isAdmiring(e) ? 'admire' : Pg.angryAt(e) ? 'fight' : Pg.avoidTarget(e) ? 'retreat' : Pg.isCelebrating(e) ? 'celebrate' : 'idle';
    if (act === 'fight') return 'entity.piglin.angry';
    if (Pg.shouldZombify(e)) return 'entity.piglin.retreat';
    if (act === 'retreat') { var av = Pg.avoidTarget(e); if (dist(e, av) < 12) return 'entity.piglin.retreat'; }   // hasTargetToAvoid: within 12
    if (act === 'admire') return 'entity.piglin.admiring_item';
    if (act === 'celebrate') return 'entity.piglin.celebrate';
    if (nearestPlayer(e, Pg.SENSE_RANGE, Pg.isGoldHoldingPlayer)) return 'entity.piglin.jealous';
    return Pg.nearestRepellent(e) ? 'entity.piglin.retreat' : 'entity.piglin.ambient';
  };

  Pg.onAttacked = function (e, attacker) {
    if (!alive(attacker) || attacker === e) return;
    if (e.type === 'piglin') {
      if (attacker.type === 'piglin') return;
      // PiglinBrain.onAttacked: unconditional before the baby/adult split -- an interrupted
      // admire loses the item (consumeOffHandItem(false): the ingot is destroyed, no barter roll) and a
      // player hit is remembered 400 ticks (isWillingToTrade's own hasBeenHitByPlayer gate).
      if (Pg.offhand(e)) Pg.consumeOffHand(e, false);
      delete e.pgCelebrateUntil;   // forget(CELEBRATE_LOCATION/DANCING/ADMIRING_DISABLED); DANCING == CELEBRATE here
      if (attacker === NS.Player) e.pgHitByPlayerUntil = (e.pgClock | 0) + Pg.HIT_BY_PLAYER_TICKS;
      if (Pg.isBaby(e)) {
        // getAvoiding.forget only when the avoided type differs, then remember (overwrite) either way;
        // a testable attacker makes nearby adults angry on the baby's behalf (angerAtCloserTargets)
        e.avoidEnt = attacker; e.avoidUntil = (e.pgClock | 0) + Pg.AVOID_TICKS;
        if (Pg.attackableIgnoreVis(attacker)) Pg.angerAtCloserTargets(e, attacker);
        return;
      }
      if (attacker.type === 'hoglin' && Pg.hasOutnumberedHoglins(e)) {
        Pg.runAwayFrom(e, attacker);
        var gm = Pg.nearbyAdultPiglins(e);   // groupRunAwayFrom: every nearby visible PiglinEntity (not a brute)
        for (var gi = 0; gi < gm.length; gi++) if (gm[gi].type === 'piglin' && visible(e, gm[gi])) {
          var m = gm[gi], c = attacker;   // runAwayFromClosestTarget: closer of AVOID_TARGET / ATTACK_TARGET / attacker
          var av = Pg.avoidTarget(m); if (av && dist(m, av) < dist(m, c)) c = av;
          if (m.target && alive(m.target) && dist(m, m.target) < dist(m, c)) c = m.target;
          Pg.runAwayFrom(m, c);
        }
        return;
      }
    } else if (Pg.TYPES[attacker.type]) return;   // PiglinBruteBrain.tryRevenge: never an AbstractPiglin
    if (Pg.avoidTarget(e)) return;   // tryRevenge: !hasActivity(AVOID) wraps the whole revenge
    if (!Pg.attackableIgnoreVis(attacker)) return;   // tryRevenge's testAttackableTargetPredicateIgnoreVisibility
    // tryRevenge: refuse a new target > 4 blocks further than the current attack target
    if (e.target && alive(e.target)) {
      var dc = dist(e, e.target), dn = dist(e, attacker);
      if (dn * dn > dc * dc + Pg.TOO_FAR * Pg.TOO_FAR) return;
    }
    if (attacker === NS.Player && Pg.universalAnger()) {
      // tryRevenge: becomeAngryWithPlayer (nearest DETECTED player, else the attacker) + angerNearbyPiglins
      Pg.becomeAngryWith(e, nearestPlayer(e, Pg.SENSE_RANGE) || attacker);
      var mates = Pg.nearbyAdultPiglins(e);
      for (var i = 0; i < mates.length; i++) { var np = nearestPlayer(mates[i], Pg.SENSE_RANGE); if (np) Pg.becomeAngryWith(mates[i], np); }
      return;
    }
    Pg.becomeAngryWith(e, attacker);
    Pg.angerAtCloserTargets(e, attacker);   // shared with Pg.tryHunt's own hunt call
  };
  /** GameRules.universalAnger, with the same lazy-command-tree guard as `Br.mobLoot`. */
  Pg.universalAnger = function () {
    var C = NS.Commands;
    if (C && typeof C.ruleGet === 'function') return C.ruleGet('universalAnger') === 'true';
    var r = NS.DATA && NS.DATA.gameRules && NS.DATA.gameRules.universalAnger;
    return !!r && r.d === 'true';
  };

  // ── target choice ─────────────────────────────────────────────────────────────────────────
  function visible(e, o) { var Ai = NS.Ai; return !(Ai && Ai.canSee) || Ai.canSee(e, o); }
  function nearest(e, pred, range) {
    var EL = NS.EntityList, best = null, bd = Infinity;
    if (!EL || !EL.list) return null;
    for (var i = 0; i < EL.list.length; i++) {
      var o = EL.list[i];
      if (o === e || !alive(o) || !pred(o)) continue;
      var d = dist(e, o);
      if (d <= range && d < bd && visible(e, o)) { best = o; bd = d; }
    }
    return best;
  }
  function players() { return NS.Player && alive(NS.Player) && NS.Ai.canTargetLiving(NS.Player) ? [NS.Player] : []; }
  function nearestPlayer(e, range, pred) {
    var ps = players(), best = null, bd = Infinity;
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i], d = dist(e, p);
      if (d <= range && d < bd && (!pred || pred(p)) && visible(e, p)) { best = p; bd = d; }
    }
    return best;
  }
  Pg.nemesis = function (e) { return nearest(e, function (o) { return !!Pg.NEMESIS[o.type]; }, Pg.SENSE_RANGE); };
  Pg.preferredTarget = function (e) {
    if (e.type === 'piglin_brute') {
      var a0 = Pg.angryAt(e); if (a0) return a0;
      return nearestPlayer(e, Pg.BRUTE_PLAYER_RANGE) || Pg.nemesis(e);
    }
    var zp = nearest(e, function (o) { return o.type === 'zombified_piglin' || o.type === 'zoglin'; }, Pg.SENSE_RANGE);
    if (zp && dist(e, zp) <= Pg.ZOMBIFIED_NEAR) return null;
    var a = Pg.angryAt(e); if (a) return a;
    return Pg.nemesis(e) || nearestPlayer(e, Pg.SENSE_RANGE, function (p) { return !Pg.wearsGoldArmor(p); });
  };

  /** UpdateAttackTargetTask + ForgetAttackTargetTask as one TARGET goal. */
  Pg.TargetGoal = function (e) {
    this.canUse = function () {
      if (e.type === 'piglin' && !Pg.isAdult(e)) return false;   // UpdateAttackTargetTask(isAdult, …)
      if (e.type === 'piglin_brute' && (e.pgClock | 0) < 10) return false;   // brain sensors' first scan (server: first step on tick 11)
      var t = Pg.preferredTarget(e);
      if (t) { e.target = t; return true; }
      return false;
    };
    this.canContinueToUse = function () { return !!e.target && alive(e.target) && Pg.preferredTarget(e) === e.target; };
    this.start = function () {};
    this.stop = function () { e.target = null; };
    this.tick = function () {};
  };

  Pg.holdsCrossbow = function (e) {
    var I = IT(), Eq = NS.Equip, s = (I && Eq) ? Eq.getEquipped(e, I.MAINHAND) : null;
    return !!(s && I.nameOf(s.i) === 'crossbow');
  };

  /** PiglinBruteBrain.method_30254's idle RandomTask, weights StrollTask 2, FindEntityTask(piglin,8) 2,
   *  FindEntityTask(piglin_brute,8) 2, GoToNearbyPositionTask(HOME,0.6,2,100) 2, GoToIfNearbyTask(HOME,0.6,5) 2,
   *  WaitTask 1. Each pick is one walk (0.6) or a wait; the plain stroll is Ai.WaterAvoidingRandomStrollGoal's. */
  Pg.BRUTE_HOME_RANGE = 100; Pg.BRUTE_HOME_NEAR = 5; Pg.BRUTE_FIND_RANGE = 8;
  Pg.BRUTE_IDLE_TASKS = [['stroll', 2], ['piglin', 2], ['piglin_brute', 2], ['home', 2], ['near', 2], ['wait', 1]];
  Pg.bruteIdlePick = function (rand, avail) {
    var keys = Pg.BRUTE_IDLE_TASKS.map(function (o) { return [o[0], -Math.pow(rand(), 1 / o[1])]; });
    keys.sort(function (a, b) { return a[1] - b[1]; });
    for (var i = 0; i < keys.length; i++) if (avail[keys[i][0]]) return keys[i][0];
    return null;
  };
  Pg.BruteIdleGoal = function (e, rand) {
    var Ai = NS.Ai, stroll = new Ai.WaterAvoidingRandomStrollGoal(e, 0.6, rand), mode = null, path = null, idx = 1, wait = 0, tgt = null, clock = 0, nextNear = 0, nearPt = null;
    rand = rand || RNDFB;
    function homeDist() { return Math.hypot(e.x - e.homeX, e.y - e.homeY, e.z - e.homeZ); }
    function walkTo(x, y, z) {
      var p = Ai.findPath(e.x, e.y, e.z, Math.floor(x), Math.floor(y), Math.floor(z), { mob: e });
      if (p && p.length > 1) { path = p; idx = 1; return true; }
      return false;
    }
    function nearest(type) {
      var L = NS.EntityList && NS.EntityList.list, best = null, bd = Pg.BRUTE_FIND_RANGE * Pg.BRUTE_FIND_RANGE;
      for (var i = 0; L && i < L.length; i++) {
        var o = L[i]; if (o === e || o.type !== type || o.removed || o.dead) continue;
        var d = (o.x - e.x) * (o.x - e.x) + (o.y - e.y) * (o.y - e.y) + (o.z - e.z) * (o.z - e.z);
        if (d < bd) { bd = d; best = o; }
      }
      return best;
    }
    function finish() { mode = null; path = null; wait = 0; tgt = null; nearPt = null; }
    this.canUse = function () {
      clock++;
      if (mode) return false;
      if ((e.pgClock | 0) < 10) return false;   // the whole brain idles until its first sensor scan (server: first step on tick 11)
      // CompositeTask.run: WeightedList.shuffle (key -r^(1/weight), ascending), first child whose tryStarting passes
      var hasHome = e.homeX !== undefined;
      var avail = {
        stroll: true, wait: true,
        home: hasHome && homeDist() <= Pg.BRUTE_HOME_RANGE,
        near: hasHome && homeDist() <= Pg.BRUTE_HOME_NEAR,
        piglin: !!nearest('piglin'), piglin_brute: !!nearest('piglin_brute')
      };
      var pick = Pg.bruteIdlePick(rand, avail);
      if (!pick) return false;
      mode = pick;
      return true;
    };
    this.canContinueToUse = function () { return !!mode; };
    this.start = function () {
      if (mode === 'stroll') { stroll.start(); if (!stroll.canContinueToUse()) finish(); }
      else if (mode === 'wait') wait = 30 + Math.floor(rand() * 31);
      else if (mode === 'home') { if (!walkTo(e.homeX, e.homeY, e.homeZ)) finish(); }
      else if (mode === 'near') {
        // GoToIfNearbyTask.run: FuzzyTargeting.find(8, 6), at most once per 180 ticks (nextUpdateTime), completionRange 1
        var v = (clock > nextNear && NS.VB && NS.VB.fuzzyFind) ? NS.VB.fuzzyFind(e, 8, 6, null) : null;
        if (clock > nextNear) nextNear = clock + 180;
        if (!v || !walkTo(v.x, v.y, v.z)) finish(); else nearPt = v;
      } else { var o = nearest(mode); if (!o || !walkTo(o.x, o.y, o.z)) finish(); else tgt = o; }
    };
    this.stop = function () { stroll.stop(); finish(); };
    this.tick = function () {
      clock++;
      if (mode === 'wait') { if (--wait <= 0) finish(); return; }
      if (mode === 'stroll') { stroll.tick(); if (!stroll.canContinueToUse()) finish(); return; }
      if (!path || idx >= path.length) { finish(); return; }
      if (mode === 'home' && homeDist() <= 2) { finish(); return; }   // completionRange 2
      if (nearPt && Math.hypot(e.x - nearPt.x - 0.5, e.y - nearPt.y, e.z - nearPt.z - 0.5) <= 1) { finish(); return; }
      if (tgt && Math.hypot(e.x - tgt.x, e.y - tgt.y, e.z - tgt.z) <= 2) { finish(); return; }   // FindEntityTask completionRange 2
      Ai.stepToward(e, path[idx], 0.6);
      if (Ai.closeTo(e, path[idx])) idx++;
    };
  };

  /** FIGHT activity melee: RangedApproachTask(1.0) + MeleeAttackTask(20) (.decomp MeleeAttackTask.java). No start throttle, no
   *  path needed to start; swings the tick the target is visible AND in reach; the 20-tick ATTACK_COOLING_DOWN is a brain
   *  memory, so it outlives start/stop. Reach is Ai.attackReachSqr (squaredAttackRange stand-in). */
  Pg.MeleeTaskGoal = function (e, speed) {
    var Ai = NS.Ai, st = { cd: 0, tx: 0, ty: 0, tz: 0, path: null, idx: 1 }, cool = 0;
    function live() { var t = e.target; return !!t && !t.dead && !t.removed; }
    this.canUse = live;
    this.canContinueToUse = function () { return live() && !e.target.invulnerableGamemode; };
    this.start = function () { st.path = null; st.idx = 1; st.cd = 0; e.aggressive = true; };
    this.stop = function () { st.path = null; e.aggressive = false; };
    this.tick = function () {
      var t = e.target; if (!t) return;
      if (cool > 0) cool--;
      var dx = t.x - e.x, dy = (t.y === undefined ? e.y : t.y) - e.y, dz = t.z - e.z, d2 = dx * dx + dy * dy + dz * dz;
      if (cool <= 0 && d2 <= Ai.attackReachSqr(e, t) && Ai.canSee(e, t)) {
        cool = Pg.MELEE_COOLDOWN;
        if (NS.EntityRender && NS.EntityRender.swingHand) NS.EntityRender.swingHand(e);
        if (NS.Combat && NS.Combat.mobAttack) NS.Combat.mobAttack(e, t);
      }
      // RangedApproachTask: visible and within melee range -> forget the WalkTarget (stand still and strike)
      if (d2 <= Ai.attackReachSqr(e, t) && Ai.canSee(e, t)) { st.path = null; return; }
      Ai.meleeNavTick(e, t, st, d2, false, RNDFB);
      if (st.path && st.idx < st.path.length) {
        Ai.stepToward(e, st.path[st.idx], speed);
        if (Ai.closeTo(e, st.path[st.idx])) st.idx++;
      }
    };
  };

  /** FIGHT activity, crossbow holder: AttackTask(5, 0.75) back-off + RangedApproachTask(1.0) + CrossbowAttackTask
   *  (.decomp PiglinBrain.addFightActivities, AttackTask/RangedApproachTask/CrossbowAttackTask.java). Back-off strafes at -0.75
   *  while the target is visible within 5; approach walks to the target unless it is visible within getRange-1 (7); the
   *  charge machine runs whenever visible within 8 (it does NOT wait for the walk, unlike the pillager's goal). */
  Pg.CROSSBOW_BACKOFF_RANGE = 5; Pg.CROSSBOW_BACKOFF_SPEED = 0.75;
  Pg.CrossbowTaskGoal = function (e, ctx) {
    var Ai = NS.Ai, rand = ctx.random || RNDFB, state = 0, cd = 0, charge = 0, st = { cd: 0, path: null, idx: 1 };
    function live() { var t = e.target; return !!t && !t.dead && !t.removed; }
    function d2of(t) { var dx = t.x - e.x, dy = (t.y === undefined ? e.y : t.y) - e.y, dz = t.z - e.z; return dx * dx + dy * dy + dz * dz; }
    this.canUse = function () { return live() && Pg.holdsCrossbow(e); };
    this.canContinueToUse = function () { return this.canUse() && !e.target.invulnerableGamemode; };
    this.start = function () { st.path = null; st.idx = 1; st.cd = 0; state = 0; e.aggressive = true; };
    this.stop = function () {
      st.path = null; e.aggressive = false; e.crossbowCharging = false; e.crossbowCharge = 0; state = 0;
    };
    this.tick = function () {
      var t = e.target; if (!t) return;
      var d2 = d2of(t), see = !!Ai.canSee(e, t);
      if (e.look) e.look.setLookAt(t.x, (t.y === undefined ? e.y : t.y) + Ai.eyeOf(t), t.z, 30 * Math.PI / 180, 30 * Math.PI / 180);
      var back = see && d2 <= Pg.CROSSBOW_BACKOFF_RANGE * Pg.CROSSBOW_BACKOFF_RANGE;
      if (back) {
        st.path = null;
        Ai.strafeTo(e, -Pg.CROSSBOW_BACKOFF_SPEED, 0);
      } else if (!(see && d2 <= (Pg.CROSSBOW_RANGE - 1) * (Pg.CROSSBOW_RANGE - 1))) {
        Ai.meleeNavTick(e, t, st, d2, false, RNDFB);
        if (st.path && st.idx < st.path.length) {
          Ai.stepToward(e, st.path[st.idx], 1.0);
          if (Ai.closeTo(e, st.path[st.idx])) st.idx++;
        }
      } else st.path = null;
      // CrossbowAttackTask.shouldRun: visible and within getRange (8); leaving it stops the task (stop() resets)
      if (!see || d2 > Pg.CROSSBOW_RANGE * Pg.CROSSBOW_RANGE) {
        if (state) { state = 0; e.crossbowCharging = false; e.crossbowCharge = 0; }
        return;
      }
      if (state === 0) { state = 1; charge = 0; e.crossbowCharging = true; e.crossbowSndStart = e.crossbowSndMid = false; }
      else if (state === 1) {
        charge++;
        var pull = Ai.crossbowPullTicks(e);
        e.crossbowCharge = Math.min(1, charge / pull);
        if (charge >= pull) { state = 2; e.crossbowCharging = false; cd = 20 + Math.floor(rand() * 20); }
      } else if (state === 2) { if (--cd === 0) state = 3; }
      else {
        var cst = Ai.crossbowStack(e), Cb = NS.Combat;
        if (cst && Cb && Cb.mobShootCrossbow) Cb.mobShootCrossbow(e, t, cst, ctx.random);
        else if (ctx.onShoot) ctx.onShoot(e, t);
        e.crossbowCharge = 0; state = 0;
      }
    };
  };

  Pg.roster = function (e, ctx) {
    var Ai = NS.Ai, gs = new Ai.GoalSelector();
    // AbstractPiglinEntity.setCanPathThroughDoors + OpenDoorsTask (core activity): open a wooden door, close it after.
    // Reuses the vindicator's LongDoorInteractGoal (4-neighbour door scan, not OpenDoorsTask's path scan; Ai.OWED).
    e.canOpenDoors = true;
    gs.add(0, 0, new Ai.LongDoorInteractGoal(e, ctx));
    if (e.type === 'piglin') {
      var cb = new Pg.CrossbowTaskGoal(e, ctx), melee = new Pg.MeleeTaskGoal(e, 1.0);
      // ConditionalTask(isHoldingCrossbow, …) vs MeleeAttackTask — mutually exclusive on the hand
      gs.add(2, Ai.MOVE | Ai.LOOK, cb);
      gs.add(2, Ai.MOVE | Ai.LOOK, { canUse: function () { return !Pg.holdsCrossbow(e) && melee.canUse(); },
        canContinueToUse: function () { return !Pg.holdsCrossbow(e) && melee.canContinueToUse(); },
        start: function () { melee.start(); }, stop: function () { melee.stop(); }, tick: function () { melee.tick(); } });
    } else {
      gs.add(2, Ai.MOVE | Ai.LOOK, new Pg.MeleeTaskGoal(e, 1.0));
    }
    gs.add(1, Ai.TARGET, new Pg.TargetGoal(e));
    if (e.type === 'piglin') {
      // AVOID: registered first among priority-1 MOVE goals, so it wins the tie over the
      // repellent flee below when both apply (GoalSelector.tick's own registration-order rule).
      gs.add(1, Ai.MOVE, new Pg.FleeGoal(e, Pg.AVOID_FLEE_SPEED, Pg.AVOID_FLEE_RANGE, function () { return Pg.avoidTarget(e); }));
      gs.add(1, Ai.MOVE, new Pg.FleeGoal(e, Pg.REPEL_FLEE_SPEED, Pg.REPEL_FLEE_RANGE, function () { return Pg.nearestRepellent(e); }));
      gs.add(3, Ai.MOVE, new Pg.CelebrateGoal(e));
      gs.add(3, Ai.MOVE | Ai.LOOK, new Pg.GoldFollowGoal(e));
      gs.add(5, Ai.MOVE, new Pg.RideGoal(e));
      gs.add(4, Ai.MOVE, new Pg.WalkToItemGoal(e));
    }
    // idle: StrollTask(0.6) / LookAroundTask — WanderAroundTask's own speed read off the stroll
    if (e.type === 'piglin_brute') gs.add(7, Ai.MOVE, new Pg.BruteIdleGoal(e, ctx.random));
    else gs.add(7, Ai.MOVE, new Ai.WaterAvoidingRandomStrollGoal(e, 0.6, ctx.random));
    gs.add(8, Ai.LOOK, new Ai.LookAtPlayerGoal(e, ctx.players));
    // PiglinBruteBrain idle RandomTask: FollowMobTask(PIGLIN/PIGLIN_BRUTE/any mob, 8) after the player
    if (e.type === 'piglin_brute' && Ai.LookAtMobGoal) gs.add(8, Ai.LOOK, new Ai.LookAtMobGoal(e, ctx, 8));
    return gs;
  };

  /** One tick, from EL's mob dispatch: the zombification clock, then a new landed hit's revenge. */
  Pg.tickEntity = function (e) {
    if (!e || !Pg.TYPES[e.type] || e.removed || e.dead) return;
    e.pgClock = (e.pgClock | 0) + 1;
    // RemoveOffHandItemTask/AdmireItemTask/loot -- core activities, every tick, any activity.
    Pg.lootTick(e);
    Pg.tickAdmire(e);
    Pg.tickAvoid(e);
    Pg.tickHunt(e);
    Pg.tickRide(e);
    if ((e.hurtSeq | 0) > (e.pgHurtSeen | 0)) {
      e.pgHurtSeen = e.hurtSeq | 0;
      if (e.lastHurtByEntity) Pg.onAttacked(e, e.lastHurtByEntity);
    }
    if (e.type === 'piglin_brute') Pg.bruteAngrySound(e);
    if (Pg.shouldZombify(e)) e.timeInOverworld = (e.timeInOverworld | 0) + 1;
    else e.timeInOverworld = 0;
    if (e.timeInOverworld > Pg.ZOMBIFY_AFTER) Pg.zombify(e);
  };

  /** `PiglinBruteBrain.tick` (playSoundIfAngry when the first non-core activity changes) + `playSoundRandomly`
   *  (`PiglinBruteEntity.mobTick`, nextFloat() < 0.0125): `playAngrySound` only while in FIGHT (= has a target). */
  Pg.bruteAngrySound = function (e) {
    var fight = !!e.target;
    var changed = fight !== !!e.pgBruteFight;
    e.pgBruteFight = fight;
    var rand = rnd();
    if (changed || rand() < 0.0125) {
      if (fight && NS.MobVoice) NS.MobVoice.playAngry(e);
    }
  };

  Pg.init = function () {
    var Ai = NS.Ai;
    if (Ai && Ai.ROSTER) { Ai.ROSTER.piglin = Pg.roster; Ai.ROSTER.piglin_brute = Pg.roster; }
    Pg.ready = true;
  };
  Pg.init();
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
