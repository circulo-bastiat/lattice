// 07y_equip.js — QUEUE 0.2 (G18 mobs remainder, D-517): MOB EQUIPMENT SLOTS.
// Runs on: MAIN THREAD ONLY. No DOM.
//
// Closes the gap `07s_raid.js`'s own `Rd.OWED` and `14j_combat.js`'s own daylight-burn header
// both name: "no mob in this engine has an equipment slot yet" — `MobEntity`'s own six
// `EquipmentSlot`s (`.decomp/.../MobEntity.java`, `getEquippedStack`/`equipStack`), the
// difficulty-scaled ARMOUR ROLL its own `initEquipment(LocalDifficulty)` runs (.decomp lines
// 871-906, `getEquipmentForSlot`), and the fixed WEAPON each of `AbstractSkeletonEntity`
// (bow), `VindicatorEntity` (iron_axe) and `PillagerEntity` (crossbow)'s own `initEquipment`
// override hands it — transcribed off `.decomp`, not approximated. `zombie` gets the base armour
// roll AND its own 1%/5% iron sword/shovel roll (`ZombieEntity.initEquipment`, s130 —
// `Eq.rollZombieWeapon`); types whose override skips `super` get no armour (`Eq.NO_BASE_ARMOR`).
//
// A stack here is the SAME shape `14f_inventory.js`'s own `Inv.stack` builds ({i,n,d,t}) — this
// file reuses `NS.Items.equipSlot`/`NS.Items.MAINHAND..HEAD` (D-266, already read out of the
// jar's own item-class bytecode) as the slot numbering rather than inventing a second one.
//
// ⚠ NEEDS `NS.Items` (02g_items.js) and, for a stack, `NS.Inventory` (14f_inventory.js) — both
// read lazily inside a function body (ARCH's no-cross-module-work-at-definition-time rule), the
// same way `Ai.pathTypeAt` reads `Ph`.

(function (NS) {
  'use strict';

  var Eq = NS.Equip = { ready: false };

  Eq.OWED = [
    'Eq.armorOf/Eq.protectionReduce see GENERIC `protection` and (armorrefcheck fix) ' +
      '`projectile_protection` (`src.source === \'projectile\'`, the one flag `Cb.hurt` carries) ' +
      '— `fire_protection`/`blast_protection`/`feather_falling` still contribute 0 always: ' +
      'nothing that calls `Cb.hurt` for fire or explosion damage passes a matching `source` flag ' +
      '(07za_explosion.js\'s own `Cb.hurt` call carries none at all), so a rolled piece can carry ' +
      'one of those three (Eq.rollEnchants does not know they will be inert) but it correctly ' +
      'reduces nothing until each damage path grows its own DamageSource-shaped flag',
    'Eq.rollEnchants only covers the enchantments reachable through THIS engine\'s four ' +
      'equipment-bearing mobs\' own gear (armour\'s protection family/thorns/respiration/' +
      'aqua_affinity/depth_strider/feather_falling/unbreaking, the iron_axe\'s efficiency/' +
      'fortune/silk_touch/unbreaking/sharpness/smite/bane_of_arthropods, and the bow/' +
      'crossbow\'s power/punch/flame/infinity/quick_charge/multishot/piercing/unbreaking — ' +
      'bow and crossbow enchantability is 0 in vanilla itself, `Item.getEnchantability`\'s own ' +
      'default with no override in `BowItem`/`CrossbowItem`, so those two roll nothing) — ' +
      'not the full ~35-enchantment registry `EnchantmentHelper.getPossibleEntries` walks; a ' +
      'future mob type wielding a sword/trident/fishing_rod/shears would need its own target ' +
      'added to `Eq.CANDIDATES`',
    // loop/mobpickup (this unit) — the generic pickup loop (`Eq.tickPickup`/`Eq.loot`/
    // `Eq.tryEquip`/`Eq.prefersNewEquipment`/`Eq.canPickupItem`/`Eq.canGather`) is real now for
    // every ZOMBIE_FAMILY member, skeleton/stray/wither_skeleton, and pillager's own
    // banner-only `loot()`. Three species this same pass's own `Eq.PICKUP_SKIP` deliberately
    // leaves UNDRIVEN, rather than forced through the generic path wrong:
    'PiglinBrain.canGather/.loot (piglin/piglin_brute bartering pickup, .decomp `entity/mob/' +
      'PiglinEntity.java`) is not implemented — no `PiglinBrain`/barter-goal substrate exists ' +
      'anywhere in this engine (`Eq.PICKUP_SKIP` leaves both species\' `canPickUpLoot=true` ' +
      'flag unused rather than run them through the generic ZombieEntity-shaped `Eq.loot`, ' +
      'which would be a wrong, invented behaviour, not a collapse)',
    'PandaEntity.loot (.decomp `entity/passive/PandaEntity.java:522-528`) — a panda\'s own ' +
      'mainhand-only, food-only pickup (no drop-old-item roll, no `prefersNewEquipment`) is ' +
      'not wired; its `canPickUpLoot=true` flag (`EL.PICKUP_LOOT_ALWAYS`, 07i_entitylist.js) ' +
      'sits unused (`Eq.PICKUP_SKIP`) until `07zl_panda.js` (not this unit\'s file) grows a ' +
      'call site for it',
    'RaiderEntity.loot\'s own ominous-banner captain-PROMOTION half (`.decomp raid/' +
      'RaiderEntity.java:230-248` — `Raid.setWaveCaptain`/`setPatrolLeader` on a picked-up ' +
      'banner) is not implemented; `Eq.loot`\'s own pillager branch equips the banner (HEAD ' +
      'slot, generic `tryEquip`) but never promotes the picker to captain — that state lives ' +
      'in `07s_raid.js`\'s own raid/captain bookkeeping, outside this unit\'s owned files'
  ];

  Eq.init = function () {
    Eq.ready = !!(NS.Items && NS.Items.ready);
    return Eq;
  };

  // ── storage: e.equip[slot] is a stack ({i,n,d,t}) or null/undefined ─────────────────────
  Eq.getEquipped = function (e, slot) {
    return (e && e.equip) ? (e.equip[slot] || null) : null;
  };
  Eq.setEquipped = function (e, slot, stack) {
    if (!e) return;
    if (!e.equip) e.equip = [];
    e.equip[slot] = stack || null;
    if (stack && NS.GameEvent && !e.silent) NS.GameEvent.emit('equip', e.x, e.y, e.z, e);   // LivingEntity.onEquipStack
  };

  // `MobEntity`'s own `DEFAULT_DROP_CHANCE = 0.085F`, filled into both arrays at construction.
  Eq.DEFAULT_DROP_CHANCE = 0.085;
  Eq.dropChance = function (e, slot) {
    if (e && e.equipDropChance && e.equipDropChance[slot] !== undefined) return e.equipDropChance[slot];
    return Eq.DEFAULT_DROP_CHANCE;
  };
  Eq.setDropChance = function (e, slot, chance) {
    if (!e) return;
    if (!e.equipDropChance) e.equipDropChance = [];
    e.equipDropChance[slot] = chance;
  };

  Eq.stackOf = function (name) {
    var IT = NS.Items, Inv = NS.Inventory;
    if (!IT || !IT.ready) return null;
    if (Inv && Inv.stack) return Inv.stack(name, 1, 0, null);
    var i = IT.of(name);
    return i >= 0 ? { i: i, n: 1, d: 0 } : null;
  };

  /**
   * `Raid.getOminousBanner()` (.decomp `village/raid/Raid.java:593-609`), transcribed field for
   * field: a `white_banner` (`Items.field_8539`, .decomp `item/Items.java:1356`) carrying eight
   * `BannerPattern.Patterns` entries (pattern id + `DyeColor`, both read off `BannerPattern.java`/
   * `DyeColor.java` — rhombus/cyan, stripe_bottom/light_gray, stripe_center/gray, border/
   * light_gray, stripe_middle/black, half_horizontal/light_gray, circle/light_gray, border/
   * black), `ItemStack.TooltipSection.field_25773` (HIDE_ADDITIONAL, `addHideFlag`) and the
   * translatable custom name `block.minecraft.ominous_banner` in `Formatting.field_1065` (GOLD).
   * QUEUE 0.2 (raid loop remainder, this unit) — closes `Rd.OWED`'s own "real mob equipment"
   * line: a raid/patrol captain's banner is a REAL head-slot `ItemStack` now, not the `e.
   * ominousBanner`/`e.headItem` STATE tags alone (those stay, for `07k_goals.js`'s own
   * `PickupBannerAsLeaderGoal` and the live-loop checks that already read them).
   */
  Eq.OMINOUS_BANNER_PATTERNS = [
    { pattern: 'rhombus',         color: 9 },    // cyan        (DyeColor.field_7955)
    { pattern: 'stripe_bottom',   color: 8 },    // light_gray  (DyeColor.field_7967)
    { pattern: 'stripe_center',   color: 7 },    // gray        (DyeColor.field_7944)
    { pattern: 'border',          color: 8 },    // light_gray
    { pattern: 'stripe_middle',   color: 15 },   // black       (DyeColor.field_7963)
    { pattern: 'half_horizontal', color: 8 },    // light_gray
    { pattern: 'circle',          color: 8 },    // light_gray
    { pattern: 'border',          color: 15 }    // black
  ];
  // `PatrolEntity.initialize`/`Raid.setWaveCaptain` (.decomp `PatrolEntity.java:85`, `Raid.
  // java:677`) — the SAME 2.0F literal both spawn paths hand a captain's HEAD slot.
  Eq.OMINOUS_BANNER_DROP_CHANCE = 2.0;

  /** A fresh ominous-banner `ItemStack` — vanilla builds a new one per call too (`getOminousBanner`
   *  has no cached instance), so this does the same rather than sharing one mutable object. */
  Eq.getOminousBanner = function () {
    var Inv = NS.Inventory;
    var patterns = [];
    for (var i = 0; i < Eq.OMINOUS_BANNER_PATTERNS.length; i++) {
      patterns.push({ Pattern: Eq.OMINOUS_BANNER_PATTERNS[i].pattern, Color: Eq.OMINOUS_BANNER_PATTERNS[i].color });
    }
    var tag = {
      BlockEntityTag: { Patterns: patterns },
      HideFlags: 32,   // 1 << TooltipSection.field_25773's own ordinal (5) — `addHideFlag`
      display: { Name: '{"translate":"block.minecraft.ominous_banner","color":"gold"}' }
    };
    if (Inv && Inv.stack) return Inv.stack('white_banner', 1, 0, tag);
    var i2 = NS.Items ? NS.Items.of('white_banner') : -1;
    return i2 >= 0 ? { i: i2, n: 1, d: 0, t: tag } : null;
  };

  /** `ItemStack.areEqual` (item + NBT, count NOT compared) against `Eq.getOminousBanner()` —
   *  `RaiderEntity.onDeath`'s own banner-kill check (RaiderEntity.java:141). */
  Eq.isOminousBanner = function (stack) {
    if (!stack || !NS.Items || !NS.Items.ready) return false;
    if (NS.Items.nameOf(stack.i) !== 'white_banner') return false;
    if (!stack.t) return false;
    var canon = Eq.getOminousBanner();
    return JSON.stringify(stack.t) === JSON.stringify(canon.t);
  };

  // ── `MobEntity.getEquipmentForSlot` (.decomp:908-956): TIER 0..4 -> leather/golden/chainmail/
  // iron/diamond, per armour slot — the ORDER is out of the jar (D-266 confirms golden sits
  // between leather and chainmail, not after iron, the common wrong guess). ─────────────────
  Eq.ARMOR_FOR = {};   // filled by Eq.init below, keyed by NS.Items.FEET/LEGS/CHEST/HEAD
  Eq.ARMOR_TABLE = {
    // slot key -> [tier0, tier1, tier2, tier3, tier4]
    HEAD: ['leather_helmet', 'golden_helmet', 'chainmail_helmet', 'iron_helmet', 'diamond_helmet'],
    CHEST: ['leather_chestplate', 'golden_chestplate', 'chainmail_chestplate', 'iron_chestplate', 'diamond_chestplate'],
    LEGS: ['leather_leggings', 'golden_leggings', 'chainmail_leggings', 'iron_leggings', 'diamond_leggings'],
    FEET: ['leather_boots', 'golden_boots', 'chainmail_boots', 'iron_boots', 'diamond_boots']
  };

  /**
   * `LocalDifficulty` (.decomp net/minecraft/world/LocalDifficulty.java, read whole), built the way
   * `ServerWorld.getLocalDifficulty` builds it: the global difficulty, `getTimeOfDay()` (the day
   * clock `/time set` moves -- `Sky.dayTime`), the chunk's inhabited time, and `getMoonSize()`
   * (`DimensionType.MOON_SIZES[moonPhase]`). Referee finding 8 (infra I6): the old 0.5/1.0/1.5
   * table was out of vanilla's range -- a fresh world at time 0 is 0 clamped on easy/normal.
   * `opts` (tests): {time, inhabited, difficulty}; a caller passes `Eq.at(entity)` ({x, z}) and
   * the chunk's own inhabited time (Eq.inhabited, below) is read at that position.
   */
  Eq.MOON_SIZES = [1.0, 0.75, 0.5, 0.25, 0.0, 0.25, 0.5, 0.75];
  Eq.DIFFICULTY_ID = { peaceful: 0, easy: 1, normal: 2, hard: 3 };
  Eq.localDifficulty = function (opts) {
    var d = opts && opts.difficulty ? opts.difficulty : (NS.Diff && NS.Diff.get ? NS.Diff.get() : 'normal');
    if (d === 'peaceful') return 0;
    var Sky = NS.Sky;
    var t = opts && opts.time !== undefined ? opts.time
      : (Sky && typeof Sky.dayTime === 'number' ? Sky.dayTime : 0);
    var inhabited = opts && opts.inhabited !== undefined ? opts.inhabited : 0;
    var phase = ((Math.floor(t / 24000) % 8) + 8) % 8;         // DimensionType.getMoonPhase
    var moon = Eq.MOON_SIZES[phase];
    // `World.getLocalDifficulty(pos)` (.decomp World.java:832-840): a position whose chunk is
    // loaded reads that chunk's inhabited time and the moon; an unloaded one reads 0 and 0.
    if (opts && opts.inhabited === undefined && typeof opts.x === 'number' && typeof opts.z === 'number') {
      var W = NS.World, bx = Math.floor(opts.x), bz = Math.floor(opts.z);
      if (W && W.loadedAt && W.loadedAt(bx, bz)) inhabited = Eq.inhabitedAt(bx, bz);
      else { inhabited = 0; moon = 0; }
    }
    var hard = d === 'hard';
    var cl = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };
    var f = 0.75;
    var g = Math.fround(cl(Math.fround((t - 72000) / 1440000), 0, 1) * 0.25);
    f += g;
    var h = 0;
    h += cl(inhabited / 3600000, 0, 1) * (hard ? 1.0 : 0.75);
    h += cl(moon * 0.25, 0, g);
    if (d === 'easy') h *= 0.5;
    f += h;
    return Math.fround((Eq.DIFFICULTY_ID[d] || 0) * f);
  };
  // ── Chunk.inhabitedTime (.decomp Chunk.java:310-320, ServerChunkManager.java:367-369) ──────
  // Every server tick, each chunk that `ServerWorld.shouldTick` AND `ThreadedAnvilChunkStorage.
  // shouldTick` pass gains `world.getTime() - lastMobSpawningTime` (1 per tick in play). The
  // second gate is `canTickChunk` (.decomp :950-956): a non-spectator player whose x/z is within
  // 128 blocks (squared 16384) of the chunk's centre (`getOffsetPos(c, 8)`). Keyed by `W.key`
  // and kept OUTSIDE the chunk objects because this engine regenerates a chunk on reload — the
  // map is the chunk NBT's own `InhabitedTime` long (ChunkSerializer.java:133/275), saved in the
  // world file (16b_save.js). Doubles hold a tick count exactly far past any real play time.
  Eq.inhabited = new Map();
  Eq.inhabitedAt = function (x, z) {
    var W = NS.World;
    if (!W || !W.key) return 0;
    return Eq.inhabited.get(W.key(Math.floor(x) >> 4, Math.floor(z) >> 4)) || 0;
  };
  Eq.tickInhabited = function (delta) {
    var W = NS.World, P = NS.Player;
    if (!W || !W.chunks || !P) return 0;
    var Gm = NS.Gamemode;
    if (P.isSpectator || (Gm && Gm.isSpectator && Gm.isSpectator(P))) return 0;
    var dt = delta === undefined ? 1 : delta, n = 0;
    W.chunks.forEach(function (c) {
      var bx = c.cx << 4, bz = c.cz << 4;
      if (!W.loadedAt(bx, bz) || !W.tickingAt(bx, bz)) return;
      var dx = (bx + 8) - P.x, dz = (bz + 8) - P.z;
      if (!(dx * dx + dz * dz < 16384)) return;
      var k = W.key(c.cx, c.cz);
      Eq.inhabited.set(k, (Eq.inhabited.get(k) || 0) + dt);
      n++;
    });
    return n;
  };
  /** `getLocalDifficulty(this.getBlockPos())` — the opts a caller passes for an entity/position
   *  (x/z only: an entity's own fields are never read as test overrides). */
  Eq.at = function (e) {
    return (e && typeof e.x === 'number' && typeof e.z === 'number') ? { x: e.x, z: e.z } : undefined;
  };
  /** Save form: [cx, cz, ticks] triples, nonzero only. */
  Eq.inhabitedToJSON = function () {
    var out = [];
    Eq.inhabited.forEach(function (v, k) {
      if (v > 0) out.push([Math.floor(k / 4194304) << 10 >> 10, (k % 4194304) << 10 >> 10, v]);
    });
    return out;
  };
  Eq.inhabitedFromJSON = function (a) {
    Eq.inhabited = new Map();
    var W = NS.World;
    if (!Array.isArray(a) || !W || !W.key) return;
    for (var i = 0; i < a.length; i++) {
      var r = a[i];
      if (!Array.isArray(r) || typeof r[2] !== 'number' || !(r[2] > 0)) continue;
      Eq.inhabited.set(W.key(r[0] | 0, r[1] | 0), r[2]);
    }
  };

  /** `LocalDifficulty.getClampedLocalDifficulty`: < 2 -> 0, > 4 -> 1, else (raw - 2) / 2. */
  Eq.clampedLocalDifficulty = function (opts) {
    var raw = Eq.localDifficulty(opts);
    if (raw < 2.0) return 0;
    return raw > 4.0 ? 1.0 : (raw - 2.0) / 2.0;
  };

  /**
   * `MobEntity.initEquipment` (.decomp:871-906) — the base armour roll every `MobEntity`
   * inherits. `rnd` is a `nextFloat()`-shaped source (0..1); `zombie`/`skeleton`/`vindicator`/
   * `pillager` all reach this (their own overrides only ADD a weapon or call `super` outright).
   */
  Eq.rollArmor = function (e, rnd) {
    var r = rnd || NS.fbRand;
    var IT = NS.Items;
    if (!IT || !IT.ready || !e) return;
    if (!(r() < 0.15 * Eq.clampedLocalDifficulty(Eq.at(e)))) return;
    var tier = Math.floor(r() * 2);           // random.nextInt(2): 0 or 1
    if (r() < 0.095) tier++;
    if (r() < 0.095) tier++;
    if (r() < 0.095) tier++;
    if (tier > 4) tier = 4;
    var worldDiff = NS.Diff && NS.Diff.get ? NS.Diff.get() : 'normal';
    var breakChance = worldDiff === 'hard' ? 0.1 : 0.25;
    // vanilla's own `EquipmentSlot.values()` order for the ARMOR type: FEET, LEGS, CHEST, HEAD —
    // the same order `14f_inventory.js`'s own `ARMOR_START` comment (36..39) already names.
    var order = [IT.FEET, IT.LEGS, IT.CHEST, IT.HEAD];
    var names = [Eq.ARMOR_TABLE.FEET, Eq.ARMOR_TABLE.LEGS, Eq.ARMOR_TABLE.CHEST, Eq.ARMOR_TABLE.HEAD];
    var first = true;
    for (var i = 0; i < order.length; i++) {
      if (!first && r() < breakChance) break;
      first = false;
      var slot = order[i];
      if (Eq.getEquipped(e, slot)) continue;
      var item = names[i][tier];
      var st = item ? Eq.stackOf(item) : null;
      if (st) Eq.setEquipped(e, slot, st);
    }
  };

  // ── the fixed weapon each spawn-time override hands its own type (.decomp, cited above) ──
  // s130 (referee finding 11, .decomp read): wither_skeleton is a STONE SWORD
  // (WitherSkeletonEntity.initEquipment, Items.field_8528), not a bow; vex an iron sword
  // (VexEntity:205-207, drop chance 0); illusioner a bow (IllusionerEntity.initialize:86);
  // zombified_piglin a golden sword (ZombifiedPiglinEntity:219-221).
  Eq.WEAPON_FOR = { skeleton: 'bow', stray: 'bow', wither_skeleton: 'stone_sword',
                     vindicator: 'iron_axe', pillager: 'crossbow', vex: 'iron_sword',
                     illusioner: 'bow', zombified_piglin: 'golden_sword' };
  /** Types whose `initEquipment` override does NOT call `super` -- no base armour roll
   *  (referee finding 9: drowned/pillager/vindicator measured 0/600 armoured). */
  Eq.NO_BASE_ARMOR = { pillager: true, vindicator: true, vex: true, wither_skeleton: true,
                       zombified_piglin: true, illusioner: true, drowned: true };
  /** Types whose weapon comes from `initialize` itself with no `updateEnchantments` call. */
  // D-673: WitherSkeletonEntity overrides updateEnchantments with an EMPTY body (.decomp:66-68) --
  // its stone sword is never enchanted, whatever the local difficulty.
  Eq.NO_ENCHANT = { illusioner: true, wither_skeleton: true };
  /** `ZombieEntity.initEquipment` (.decomp:372-382): after super's armour, `nextFloat() <
   *  (HARD ? 0.05 : 0.01)`, then `nextInt(3) == 0` iron_sword else iron_shovel. Husk and
   *  zombie_villager inherit it; drowned and zombified_piglin override it. */
  Eq.ZOMBIE_WEAPON = { zombie: true, husk: true, zombie_villager: true };
  Eq.rollZombieWeapon = function (e, rnd) {
    var IT = NS.Items;
    if (!IT || !IT.ready || !e) return;
    var r = rnd || NS.fbRand;
    var hard = NS.Diff && NS.Diff.get && NS.Diff.get() === 'hard';
    if (!(r() < (hard ? 0.05 : 0.01))) return;
    var w = Math.floor(r() * 3) === 0 ? 'iron_sword' : 'iron_shovel';
    var st = Eq.stackOf(w);
    if (st) Eq.setEquipped(e, IT.MAINHAND, st);
  };
  Eq.initWeapon = function (e) {
    var IT = NS.Items;
    if (!IT || !IT.ready || !e) return;
    var w = Eq.WEAPON_FOR[e.type];
    if (!w || Eq.getEquipped(e, IT.MAINHAND)) return;
    var st = Eq.stackOf(w);
    if (st) Eq.setEquipped(e, IT.MAINHAND, st);
  };


  /**
   * `LivingEntity.createLivingAttributes`'s GENERIC_ARMOR base (`EntityAttributes.java:30-31`,
   * `field_23724`, default 0.0) — every one of this engine's four equipment-bearing mobs
   * (`07i_entitylist.js`'s own `EL.DEFAULTS` wiring: zombie/skeleton/vindicator/pillager)
   * inherits it untouched EXCEPT `ZombieEntity.createZombieAttributes` (.decomp:114-120), which
   * `.add(EntityAttributes.field_23724, 2.0)`s it. skeleton (`AbstractSkeletonEntity.
   * createAbstractSkeletonAttributes`), vindicator (`VindicatorEntity.
   * createVindicatorAttributes`) and pillager (`PillagerEntity.createPillagerAttributes`) never
   * add `field_23724`, so they stay at the 0 base.
   */
  // loop/zombievariants-s100 (QUEUE 0.2 G18c) -- husk/drowned both extend ZombieEntity and
  // neither overrides createZombieAttributes (.decomp, both read whole), so both inherit the
  // SAME field_23724=2.0 add zombie's own row already carries; stray extends
  // AbstractSkeletonEntity (createAbstractSkeletonAttributes never adds it either, same as
  // skeleton), so stray stays off this table entirely, exactly like skeleton.
  Eq.MOB_BASE_ARMOR = { zombie: 2, husk: 2, drowned: 2 };

  /**
   * `LivingEntity.getArmor()` + `.updateEquipmentAttributeModifiers` collapsed to a single read,
   * the SAME shape `Sv.updateArmor` (14d_survival.js, D-291) already builds for the player: the
   * mob's own `MOB_BASE_ARMOR` attribute plus the defense/toughness of whatever the four armour
   * slots actually hold, summed with `IT.defenseOf`/`IT.toughnessOf` — the exact functions the
   * player path reads. `protection` sums `ProtectionEnchantment.getProtectionAmount(lvl, source)`
   * per worn piece (.decomp `ProtectionEnchantment.java:32-46`, `EnchantmentHelper.
   * getProtectionAmount`, `.java:135-148`, called once per item and summed): the GENERIC
   * `protection` enchant contributes `lvl` unconditionally; `projectile_protection` contributes
   * `lvl*2` only when `srcType === 'projectile'` — the one damage-source flag `Cb.hurt` actually
   * carries today (`src.source === 'projectile'`, set for every arrow hit, 14j_combat.js:1406).
   * `fire_protection`/`blast_protection`/`feather_falling` stay at 0 unconditionally — see
   * `Eq.OWED` for why (no fire/explosive/falling damage-source flag reaches here yet, so a
   * rolled piece carrying one of those three is correctly inert, same as vanilla is for the
   * WRONG damage type).
   */
  Eq.armorOf = function (e, srcType) {
    var IT = NS.Items, Cb = NS.Combat;
    var out = { armor: (e && e.armorBase !== undefined) ? e.armorBase : (Eq.MOB_BASE_ARMOR[e && e.type] || 0), toughness: 0, protection: 0 };
    if (!IT || !IT.ready || !e || !e.equip) return out;
    var slots = [IT.FEET, IT.LEGS, IT.CHEST, IT.HEAD];
    for (var i = 0; i < slots.length; i++) {
      var st = Eq.getEquipped(e, slots[i]);
      if (!st) continue;
      out.armor += IT.defenseOf(st.i);
      out.toughness += IT.toughnessOf(st.i);
      if (!Cb || !Cb.enchantLevel) continue;
      out.protection += Cb.enchantLevel(st, 'protection');
      // srcType is a string tag or a DamageSource-style flag set ({fire,fall,explosive,projectile}),
      // ProtectionEnchantment.getProtectionAmount:32-46 factors 2/3/2/2.
      var f = (srcType && typeof srcType === 'object') ? srcType : {};
      if (srcType === 'projectile' || f.projectile) out.protection += 2 * Cb.enchantLevel(st, 'projectile_protection');
      if (srcType === 'fire' || f.fire) out.protection += 2 * Cb.enchantLevel(st, 'fire_protection');
      if (srcType === 'fall' || f.fall) out.protection += 3 * Cb.enchantLevel(st, 'feather_falling');
      if (srcType === 'explosion' || f.explosive) out.protection += 2 * Cb.enchantLevel(st, 'blast_protection');
    }
    return out;
  };

  /**
   * `DamageUtil.getInflictedDamage` (.decomp `entity/DamageUtil.java:18-21`) — the second,
   * SEPARATE reduction `LivingEntity.applyEnchantmentsToDamage` runs after armour-absorb and
   * Resistance (`Cb.hurt`'s own call order, 14j_combat.js): `damage * (1 - clamp(amount,0,20)/25)`.
   */
  Eq.protectionReduce = function (damage, amount) {
    var a = amount < 0 ? 0 : (amount > 20 ? 20 : amount);
    return damage * (1 - a / 25);
  };

  // ── QUEUE 0.2 raid loop (this unit): MobEntity.enchantMainHandItem/enchantEquipment ────────
  // (.decomp MobEntity.java:958-990) — the difficulty-scaled random enchant roll. Every
  // min/max-POWER window and rarity weight below is read off the actual `.decomp` subclass
  // (cited per entry), cross-checked against `07p_trade.js`'s own jar-verified `ENCH` table
  // (same weight/maxLevel/treasure numbers for every enchantment this table repeats — that
  // file's own comment names porting the min/max-power windows as ITS `Trade.OWED`; this is
  // that missing half, built once, here).

  function nextInt(r, n) { return n > 0 ? Math.floor(r() * n) : 0; }

  /** `ArmorMaterials`/`ToolMaterials` `enchantability` (.decomp `item/ArmorMaterials.java:11-17`,
   *  `item/ToolMaterials.java:9-14`, field_8923=IRON=14) — `Item.getEnchantability()` defaults
   *  to 0 (`item/Item.java:313`) and `BowItem`/`CrossbowItem` never override it, so a mob's bow
   *  or crossbow can never roll an enchantment through this path (matches vanilla exactly). */
  Eq.ITEM_ENCHANTABILITY = {
    leather_helmet: 15, leather_chestplate: 15, leather_leggings: 15, leather_boots: 15,
    golden_helmet: 25, golden_chestplate: 25, golden_leggings: 25, golden_boots: 25,
    chainmail_helmet: 12, chainmail_chestplate: 12, chainmail_leggings: 12, chainmail_boots: 12,
    iron_helmet: 9, iron_chestplate: 9, iron_leggings: 9, iron_boots: 9,
    diamond_helmet: 10, diamond_chestplate: 10, diamond_leggings: 10, diamond_boots: 10,
    iron_axe: 14, bow: 1, crossbow: 1, trident: 1,
    // ToolMaterials.java:9-14 (WOOD 15, STONE 5, IRON 14, DIAMOND 10, GOLD 22, NETHERITE 15)
    wooden_sword: 15, stone_sword: 5, iron_sword: 14, diamond_sword: 10, golden_sword: 22, netherite_sword: 15,
    golden_axe: 22, iron_shovel: 14, stone_axe: 5
  };
  // D-670: one enchantability table — EnchHelper.generateEnchantments reads ITS map; the mob items
  // join it on first use (not at load: module order must not decide whether armour can enchant).
  function joinEnchantability(EH) {
    if (EH._eqJoined) return;
    for (var k in Eq.ITEM_ENCHANTABILITY) if (!(k in EH.ENCHANTABILITY)) EH.ENCHANTABILITY[k] = Eq.ITEM_ENCHANTABILITY[k];
    EH._eqJoined = true;
  }

  // Protection family (`ProtectionEnchantment`, .decomp:11-24, `Type` enum base/perLevel at
  // line 75-79): protection(1,11) fire_protection(10,8) blast_protection(5,8)
  // projectile_protection(3,6), all mutually exclusive (`canAccept`, .decomp:49-56) — group
  // 'prot'. feather_falling(5,6) is its OWN group: vanilla special-cases it to combine with any
  // of the other four (same `canAccept`) but never with itself.
  function protDef(id, weight, base, perLevel, group) {
    return {
      id: id, weight: weight, maxLevel: 4,
      minPower: function (l) { return base + (l - 1) * perLevel; },
      maxPower: function (l) { return base + (l - 1) * perLevel + perLevel; },
      group: group
    };
  }
  var PROTECTION_DEFS = [
    protDef('protection', 10, 1, 11, 'prot'),
    protDef('fire_protection', 5, 10, 8, 'prot'),
    protDef('blast_protection', 2, 5, 8, 'prot'),
    protDef('projectile_protection', 5, 3, 6, 'prot')
  ];
  var FEATHER_FALLING = protDef('feather_falling', 5, 5, 6, 'feather');

  // `DamageEnchantment` (.decomp:12-38): sharpness/smite/bane_of_arthropods, mutually exclusive
  // (`canAccept`, .decomp:53-56, "!(other instanceof DamageEnchantment)") — group 'damage'. Its
  // own `isAcceptableItem` override (.decomp:58-60) explicitly also accepts `AxeItem` — the
  // reason a vindicator's iron_axe (unlike a plain WEAPON-target sword-only enchant) can still
  // roll these despite `EnchantmentTarget.WEAPON` (field_9074) itself being sword-only.
  var SHARPNESS = { id: 'sharpness', weight: 10, maxLevel: 5,
    minPower: function (l) { return 1 + (l - 1) * 11; }, maxPower: function (l) { return 1 + (l - 1) * 11 + 20; }, group: 'damage' };
  var SMITE = { id: 'smite', weight: 5, maxLevel: 5,
    minPower: function (l) { return 5 + (l - 1) * 8; }, maxPower: function (l) { return 5 + (l - 1) * 8 + 20; }, group: 'damage' };
  var BANE = { id: 'bane_of_arthropods', weight: 5, maxLevel: 5,
    minPower: function (l) { return 5 + (l - 1) * 8; }, maxPower: function (l) { return 5 + (l - 1) * 8 + 20; }, group: 'damage' };

  // `UnbreakingEnchantment` (.decomp:9-20): BREAKABLE target (any damageable item) — applies to
  // armour, the axe and the bow/crossbow alike, no conflicts in this engine's candidate pools.
  var UNBREAKING = { id: 'unbreaking', weight: 5, maxLevel: 3,
    minPower: function (l) { return 5 + (l - 1) * 8; }, maxPower: function (l) { return 5 + (l - 1) * 8 + 50; }, group: null };
  // `EfficiencyEnchantment`/`LuckEnchantment`(fortune)/`SilkTouchEnchantment` (.decomp, DIGGER
  // target — the axe is a `MiningToolItem`). fortune/silk_touch conflict (`canAccept`, both
  // files) — group 'digger'.
  var EFFICIENCY = { id: 'efficiency', weight: 10, maxLevel: 5,
    minPower: function (l) { return 1 + (l - 1) * 10; }, maxPower: function (l) { return 1 + (l - 1) * 10 + 50; }, group: null };
  var FORTUNE = { id: 'fortune', weight: 2, maxLevel: 3,
    minPower: function (l) { return 15 + (l - 1) * 9; }, maxPower: function (l) { return 15 + (l - 1) * 9 + 50; }, group: 'digger' };
  var SILK_TOUCH = { id: 'silk_touch', weight: 1, maxLevel: 1,
    minPower: function () { return 15; }, maxPower: function () { return 65; }, group: 'digger' };
  // `PowerEnchantment`/`PunchEnchantment`/`FlameEnchantment`/`InfinityEnchantment` (.decomp, BOW
  // target). No conflicts among these four.
  var POWER = { id: 'power', weight: 10, maxLevel: 5,
    minPower: function (l) { return 1 + (l - 1) * 10; }, maxPower: function (l) { return 1 + (l - 1) * 10 + 15; }, group: null };
  var PUNCH = { id: 'punch', weight: 2, maxLevel: 2,
    minPower: function (l) { return 12 + (l - 1) * 20; }, maxPower: function (l) { return 12 + (l - 1) * 20 + 25; }, group: null };
  var FLAME = { id: 'flame', weight: 2, maxLevel: 1, minPower: function () { return 20; }, maxPower: function () { return 50; }, group: null };
  var INFINITY_E = { id: 'infinity', weight: 1, maxLevel: 1, minPower: function () { return 20; }, maxPower: function () { return 50; }, group: null };
  // `QuickChargeEnchantment`/`MultishotEnchantment`/`PiercingEnchantment` (.decomp, CROSSBOW
  // target). multishot/piercing conflict (`canAccept`, both files) — group 'shot'.
  var QUICK_CHARGE = { id: 'quick_charge', weight: 5, maxLevel: 3,
    minPower: function (l) { return 12 + (l - 1) * 20; }, maxPower: function () { return 50; }, group: null };
  var MULTISHOT = { id: 'multishot', weight: 2, maxLevel: 1, minPower: function () { return 20; }, maxPower: function () { return 50; }, group: 'shot' };
  var PIERCING = { id: 'piercing', weight: 10, maxLevel: 4,
    minPower: function (l) { return 1 + (l - 1) * 10; }, maxPower: function () { return 50; }, group: 'shot' };
  // `RespirationEnchantment`/`AquaAffinityEnchantment` (.decomp, ARMOR_HEAD target) and
  // `ThornsEnchantment` (.decomp, ARMOR_CHEST target) and `DepthStriderEnchantment` (.decomp,
  // ARMOR_FEET target). None conflict with anything in this engine's candidate pools.
  var RESPIRATION = { id: 'respiration', weight: 2, maxLevel: 3,
    minPower: function (l) { return 10 * l; }, maxPower: function (l) { return 10 * l + 30; }, group: null };
  var AQUA_AFFINITY = { id: 'aqua_affinity', weight: 2, maxLevel: 1, minPower: function () { return 1; }, maxPower: function () { return 41; }, group: null };
  var THORNS = { id: 'thorns', weight: 1, maxLevel: 3,
    minPower: function (l) { return 10 + (l - 1) * 20; }, maxPower: function (l) { return 10 + (l - 1) * 20 + 50; }, group: null };
  var DEPTH_STRIDER = { id: 'depth_strider', weight: 2, maxLevel: 3,
    minPower: function (l) { return 10 * l; }, maxPower: function (l) { return 10 * l + 15; }, group: null };

  /** Which candidate pool each slot draws from — this engine's four equipment-bearing mobs'
   *  own gear only (see `Eq.OWED`). */
  Eq.CANDIDATES = {
    FEET: PROTECTION_DEFS.concat([FEATHER_FALLING, DEPTH_STRIDER, UNBREAKING]),
    LEGS: PROTECTION_DEFS.concat([UNBREAKING]),
    CHEST: PROTECTION_DEFS.concat([THORNS, UNBREAKING]),
    HEAD: PROTECTION_DEFS.concat([RESPIRATION, AQUA_AFFINITY, UNBREAKING]),
    AXE: [EFFICIENCY, FORTUNE, SILK_TOUCH, UNBREAKING, SHARPNESS, SMITE, BANE],
    BOW: [POWER, PUNCH, FLAME, INFINITY_E, UNBREAKING],
    CROSSBOW: [QUICK_CHARGE, MULTISHOT, PIERCING, UNBREAKING]
  };
  Eq.MAINHAND_SLOTKIND = { bow: 'BOW', iron_axe: 'AXE', crossbow: 'CROSSBOW' };

  function possibleEntries(pow, slotKind) {
    var pool = Eq.CANDIDATES[slotKind] || [];
    var out = [];
    for (var i = 0; i < pool.length; i++) {
      var def = pool[i];
      for (var l = def.maxLevel; l >= 1; l--) {
        if (pow >= def.minPower(l) && pow <= def.maxPower(l)) {
          out.push({ id: def.id, lvl: l, weight: def.weight, group: def.group });
          break;
        }
      }
    }
    return out;
  }
  /** `EnchantmentHelper.removeConflicts` (.decomp:349-357) — strip every candidate sharing the
   *  just-picked entry's conflict group (empty/null group = conflicts with nothing). */
  function removeConflicts(list, picked) {
    // `Enchantment.canAccept` (.decomp:78-80) defaults to `this != $$0` — an enchantment always
    // conflicts with ANOTHER copy of itself, group or no group (`canCombine` is symmetric AND);
    // `EnchantmentHelper.removeConflicts` (.decomp:349-357) strips every entry `!canCombine`
    // with the just-picked one, which is both the id match below AND the shared-group members.
    var out = [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === picked.id) continue;
      if (picked.group && list[i].group === picked.group) continue;
      out.push(list[i]);
    }
    return out;
  }
  /** `Weighting.getRandom`/`getAt` (.decomp `util/collection/Weighting.java:26-42`). */
  function weightedPick(r, list) {
    var sum = 0, i;
    for (i = 0; i < list.length; i++) sum += list[i].weight;
    if (sum <= 0) return null;
    var roll = nextInt(r, sum);
    for (i = 0; i < list.length; i++) {
      roll -= list[i].weight;
      if (roll < 0) return list[i];
    }
    return list[list.length - 1];
  }

  /** `EnchantmentHelper.generateEnchantments` (.decomp:317-341). `itemName` selects
   *  enchantability (`Eq.ITEM_ENCHANTABILITY`); returns `[]` at once when it is <= 0 (bow/
   *  crossbow, always). `slotKind` picks the candidate pool. `level` is the caller's own
   *  `(int)(5 + difficulty * nextInt(18))` (`Eq.enchantMainHandItem`/`Eq.enchantEquipment`,
   *  below) — vanilla's `allowTreasure` argument is always `false` here (a spawned mob never
   *  gets treasure enchants) and every entry in `Eq.CANDIDATES` is already non-treasure, so
   *  there is nothing left to filter on that account. */
  Eq.rollEnchants = function (itemName, slotKind, level, rnd) {
    // D-670: the SAME `EnchantmentHelper.generateEnchantments` the trade tools use (07ox_enchhelper.js,
    // the whole non-treasure registry filtered by `EnchantmentTarget`) — this file's own short
    // candidate lists had bows/crossbows at enchantability 0 (RangedWeaponItem.java:31 returns 1),
    // no sword pool at all, and let an AXE draw sharpness/smite/bane (their target is WEAPON, which
    // only SwordItem satisfies — getPossibleEntries asks the target, not the anvil's isAcceptableItem).
    // `slotKind` is kept for callers and ignored: the item decides its targets.
    var EH = NS.EnchHelper, r = rnd || NS.fbRand;
    if (!EH) return [];
    joinEnchantability(EH);
    var picks = EH.generateEnchantments(r, itemName, Eq.targetsOf(itemName), level, false);
    return picks.map(function (p) { return { id: p.id, lvl: p.level }; });
  };

  /** `EnchantmentTarget.isAcceptableItem` per item this engine's mobs can hold or wear. */
  Eq.targetsOf = function (name) {
    var t = null;
    if (/_helmet$/.test(name)) t = ['armor', 'armor_head'];
    else if (/_chestplate$/.test(name)) t = ['armor', 'armor_chest'];
    else if (/_leggings$/.test(name)) t = ['armor', 'armor_legs'];
    else if (/_boots$/.test(name)) t = ['armor', 'armor_feet'];
    else if (/_sword$/.test(name)) t = ['weapon'];
    else if (/_(axe|pickaxe|shovel|hoe)$/.test(name)) t = ['digger'];
    else if (name === 'bow' || name === 'crossbow' || name === 'trident' || name === 'fishing_rod') t = [name];
    return t ? t.concat(['breakable']) : [];
  };

  /** Writes a rolled `[{id,lvl}]` list onto a stack's NBT the SAME shape `07p_trade.js`'s own
   *  enchanted-book/tool rolls already use (`id: 'minecraft:'+id`) and `Cb.enchantList`
   *  (14j_combat.js) already reads. */
  Eq.applyEnchants = function (stack, list) {
    if (!stack || !list || !list.length) return;
    if (!stack.t) stack.t = {};
    var out = (stack.t.Enchantments || []).slice();
    for (var i = 0; i < list.length; i++) out.push({ id: 'minecraft:' + list[i].id, lvl: list[i].lvl });
    stack.t.Enchantments = out;
  };

  /** `MobEntity.enchantMainHandItem` (.decomp:975-982): chance `0.25*difficulty`. */
  Eq.enchantMainHandItem = function (e, difficulty, rnd) {
    var IT = NS.Items;
    if (!IT || !IT.ready || !e) return;
    var st = Eq.getEquipped(e, IT.MAINHAND);
    if (!st) return;
    var r = rnd || NS.fbRand;
    if (r() < 0.25 * difficulty) {
      // D-670: no item gate in vanilla — EnchantmentHelper.enchant on an unenchantable item just
      // returns it bare (enchantability 0), after the same nextInt(18) draw.
      var level = 5 + Math.floor(difficulty * nextInt(r, 18));
      Eq.applyEnchants(st, Eq.rollEnchants(IT.nameOf(st.i), null, level, r));
    }
    // `PillagerEntity.enchantMainHandItem` (.decomp PillagerEntity.java:179-190): after super, a
    // `nextInt(300) == 0` Piercing I on the crossbow if it has none (putIfAbsent).
    if (e.type === 'pillager' && nextInt(r, 300) === 0 && IT.nameOf(st.i) === 'crossbow') {
      var cur = (st.t && st.t.Enchantments) || [];
      if (!cur.some(function (x) { return x.id === 'minecraft:piercing'; })) Eq.applyEnchants(st, [{ id: 'piercing', lvl: 1 }]);
    }
  };
  /** `MobEntity.enchantEquipment` (.decomp:984-990): chance `0.5*difficulty`, per armour slot. */
  Eq.enchantEquipment = function (e, slotConst, slotKind, difficulty, rnd) {
    var IT = NS.Items;
    var st = Eq.getEquipped(e, slotConst);
    if (!st) return;
    var r = rnd || NS.fbRand;
    if (!(r() < 0.5 * difficulty)) return;
    var level = 5 + Math.floor(difficulty * nextInt(r, 18));
    Eq.applyEnchants(st, Eq.rollEnchants(IT.nameOf(st.i), slotKind, level, r));
  };
  /** `MobEntity.updateEnchantments` (.decomp:958-966): one shared `clampedLocalDifficulty()`
   *  read, the weapon roll, then each of the four armour slots. */
  Eq.updateEnchantments = function (e, rnd) {
    var IT = NS.Items;
    if (!IT || !IT.ready || !e) return;
    var d = Eq.clampedLocalDifficulty(Eq.at(e));
    var r = rnd || NS.fbRand;
    Eq.enchantMainHandItem(e, d, r);
    Eq.enchantEquipment(e, IT.FEET, 'FEET', d, r);
    Eq.enchantEquipment(e, IT.LEGS, 'LEGS', d, r);
    Eq.enchantEquipment(e, IT.CHEST, 'CHEST', d, r);
    Eq.enchantEquipment(e, IT.HEAD, 'HEAD', d, r);
  };

  /** The one call site a spawn hooks: weapon first (a type-specific override runs before its
   *  own `super.initEquipment` reads/writes armour in vanilla — order does not matter here
   *  since the two never touch the same slot), then the base armour roll. */
  Eq.initMob = function (e, rnd) {
    if (!Eq.ready || !e) return;
    Eq.initWeapon(e);
    if (!Eq.NO_BASE_ARMOR[e.type]) Eq.rollArmor(e, rnd);
    if (Eq.ZOMBIE_WEAPON[e.type]) Eq.rollZombieWeapon(e, rnd);
    if (e.type === 'vex' && NS.Items) Eq.setDropChance(e, NS.Items.MAINHAND, 0);   // VexEntity:207
    if (!Eq.NO_ENCHANT[e.type]) Eq.updateEnchantments(e, rnd);
    Eq.halloweenHead(e, rnd);
  };

  /** #669: the tail of `ZombieEntity.initialize` (.decomp ~475-486) and `AbstractSkeletonEntity.initialize`
   *  (~146-154): empty helmet slot on 31 Oct, `nextFloat() < 0.25` -> carved_pumpkin, or jack_o_lantern
   *  when a second `nextFloat() < 0.1`, head drop chance 0. `Eq.today` (returns a Date) is the test seam. */
  Eq.HALLOWEEN_TYPES = { zombie: 1, husk: 1, drowned: 1, zombie_villager: 1, zombified_piglin: 1,
                         skeleton: 1, stray: 1, wither_skeleton: 1 };
  Eq.today = function () { return new Date(); };
  Eq.halloweenHead = function (e, rnd) {
    var IT = NS.Items;
    if (!Eq.HALLOWEEN_TYPES[e.type] || !IT || !IT.ready || Eq.getEquipped(e, IT.HEAD)) return;
    var d = Eq.today(), r = rnd || NS.fbRand;
    if (d.getMonth() !== 9 || d.getDate() !== 31 || !(r() < 0.25)) return;
    var st = Eq.stackOf(r() < 0.1 ? 'jack_o_lantern' : 'carved_pumpkin');
    if (!st) return;
    Eq.setEquipped(e, IT.HEAD, st);
    Eq.setDropChance(e, IT.HEAD, 0);
  };

  /**
   * loop/zombievariants-s100 (QUEUE 0.2 G18c) -- `DrownedEntity.initEquipment`
   * + `DrownedEntity.initialize` (.decomp, both read whole), TWO SEPARATE rolls, not
   * `Eq.initMob`'s fixed-weapon shape:
   *   1. `initEquipment`: `nextFloat() > 0.9` (10% chance) a mainhand weapon at all --
   *      `nextInt(16) < 10` trident (Items.field_8547), else fishing_rod (Items.field_8378).
   *      Then the SAME base armour roll every MobEntity inherits (`Eq.rollArmor`, unchanged).
   *   2. `initialize` (AFTER `super.initialize()`, i.e. AFTER #1): if the offhand is still
   *      empty, a SEPARATE `nextFloat() < 0.03F` (3%) roll for a nautilus shell
   *      (Items.field_8864) — `field_30460` is that literal, named in DrownedEntity's own
   *      source. This is not a "weapon", so it is not routed through `Eq.WEAPON_FOR`/
   *      `Eq.initWeapon` at all.
   */
  Eq.DROWNED_WEAPON_CHANCE = 0.9;     // random.nextFloat() > 0.9
  Eq.DROWNED_TRIDENT_ROLL = 10;       // nextInt(16) < 10 -> trident, else fishing_rod
  Eq.DROWNED_OFFHAND_SHELL_CHANCE = 0.03;   // field_30460
  Eq.initDrowned = function (e, rnd) {
    if (!Eq.ready || !e) return;
    var IT = NS.Items;
    var r = rnd || NS.fbRand;
    if (IT && IT.ready && !Eq.getEquipped(e, IT.MAINHAND) && r() > Eq.DROWNED_WEAPON_CHANCE) {
      var roll = Math.floor(r() * 16);
      var w = roll < Eq.DROWNED_TRIDENT_ROLL ? 'trident' : 'fishing_rod';
      var wst = Eq.stackOf(w);
      if (wst) Eq.setEquipped(e, IT.MAINHAND, wst);
    }
    // s130 (referee finding 9): DrownedEntity.initEquipment never calls super -- NO armour roll.
    if (IT && IT.ready && !Eq.getEquipped(e, IT.OFFHAND) && r() < Eq.DROWNED_OFFHAND_SHELL_CHANCE) {
      var sst = Eq.stackOf('nautilus_shell');
      if (sst) { Eq.setEquipped(e, IT.OFFHAND, sst); Eq.setDropChance(e, IT.OFFHAND, 2.0); }   // DrownedEntity.initialize: guaranteed drop
    }
    Eq.updateEnchantments(e, rnd);
    Eq.halloweenHead(e, rnd);
  };

  /**
   * `MobEntity.dropEquipment` (.decomp:842-860), collapsed to this engine's own "only a player
   * deals damage" state (Eq.OWED) — fires once, from `Cb.dropLoot` (14j_combat.js), on the SAME
   * first death tick the loot table drops already use. Returns the [{slot, item, count}] it
   * cleared, for the caller to spawn as real item entities the way `Cb.dropLoot` already does.
   */
  Eq.dropEquipment = function (e, rnd, killedByPlayer, looting) {
    var IT = NS.Items;
    if (!Eq.ready || !e || !e.equip) return [];
    // G21 -- `($$2 || $$6)` (.decomp MobEntity.java:846-850): a piece whose drop chance is over
    // 1.0 (a captain's banner, a picked-up item) drops on ANY death; the rest need the
    // playerHitTimer flag `drop()` passes as $$2. Mobs now die to fire, golems and tamed wolves
    // too, so the second half of the OR is live.
    var r = rnd || NS.fbRand;
    var out = [];
    var slots = [IT.MAINHAND, IT.OFFHAND, IT.FEET, IT.LEGS, IT.CHEST, IT.HEAD];
    for (var i = 0; i < slots.length; i++) {
      var slot = slots[i];
      var st = Eq.getEquipped(e, slot);
      if (!st) continue;
      if (NS.Combat && NS.Combat.enchantLevel && NS.Combat.enchantLevel(st, 'vanishing_curse') > 0) continue;   // !hasVanishingCurse (.decomp:848)
      var chance = Eq.dropChance(e, slot);
      if (!(killedByPlayer || chance > 1.0)) continue;
      // `Math.max(nextFloat() - looting * 0.01F, 0) < chance` (.decomp MobEntity.java:852).
      if (Math.max(r() - (looting | 0) * 0.01, 0) < chance) {
        var dmg = st.d | 0, max = IT.durability ? IT.durability[st.i] : 0;
        // `!$$6 && isDamageable` -> setDamage(max - nextInt(1 + nextInt(max(max-3,1)))) (.decomp:853-855)
        if (!(chance > 1.0) && max) { var n1 = Math.floor(r() * Math.max(max - 3, 1)); dmg = max - Math.floor(r() * (1 + n1)); }
        out.push({ slot: slot, item: IT.nameOf(st.i), count: st.n || 1, tag: st.t, d: dmg });
        Eq.setEquipped(e, slot, null);
      }
    }
    return out;
  };

  /**
   * `sendEquipmentBreakStatus` + `equipStack(slot, EMPTY)` collapsed to state only (no particle/
   * sound — another worker's render file, same refusal `SP.OWED` already makes for the fang's
   * own animation). `amount` is vanilla's own `random.nextInt(2)` (0 or 1) at each daylight-burn
   * tick (`ZombieEntity.tickMovement`, 14j_combat.js's own `Cb.tickDaylightBurn`). Returns true
   * when the piece broke (and was removed) this call.
   */
  Eq.damageEquipped = function (e, slot, amount, rnd) {
    var IT = NS.Items;
    var st = Eq.getEquipped(e, slot);
    if (!st || !IT || !IT.ready) return false;
    var max = IT.durability ? IT.durability[st.i] : 0;
    if (!max) return false;    // not damageable — nothing to spend, nothing breaks
    st.d = (st.d | 0) + (amount | 0);
    if (st.d >= max) {
      Eq.setEquipped(e, slot, null);
      return true;
    }
    return false;
  };


  // ── D-6xx (loop/mobpickup) — MOBENTITY ITEM PICKUP ────────────────────────────────────────
  // `MobEntity.tickMovement` (.decomp/net/minecraft/entity/mob/MobEntity.java:519-540): every
  // tick, off the goal selector, a `canPickUpLoot()` mob that is alive, not `dead`, gated on
  // `GameRules.DO_MOB_GRIEFING` (yes — a SKELETON picking up a dropped bow needs mobGriefing
  // ON too, not just a zombie griefing a block; read the gate whole, it is not species-scoped),
  // scans every live `ItemEntity` in `getBoundingBox().expand(1.0, 0.0, 1.0)` (NOT the 0.5
  // vertical inflate `Gt.PICKUP_INFLATE`, 07zv6_vbgather.js, uses for its own OWN villager
  // scan — that is villager's own number, not this one's) and calls `loot()` on the first one
  // that is not removed, not empty, not `cannotPickup()` (`pickupDelay>0`, same field
  // `EL.dropStack`/`Player.dropHeld` already write) and passes `canGather()`.
  Eq.PICKUP_BOX_INFLATE = 1.0;
  // `loot()`/`canPickupItem()`/`canGather()` overrides this unit actually WIRES: the whole
  // ZOMBIE_FAMILY (`Undead.ZOMBIE_FAMILY`, 07zk_undead.js) shares `ZombieEntity`'s pair,
  // `zombified_piglin` swapping ONE of the two back off (below); skeleton/stray/
  // wither_skeleton and vindicator/pillager have no `canPickupItem`/`canGather` override of
  // their own in `.decomp` (`AbstractSkeletonEntity`/`VindicatorEntity`, both read whole) so
  // they fall straight through to `MobEntity`'s own always-true pair — pillager's own `loot()`
  // OVERRIDE (below, in `Eq.loot`) is the one real species difference for it.
  // Mobs `EL.PICKUP_LOOT_ALWAYS`/`_ROLL` (07i_entitylist.js) can still roll `canPickUpLoot`
  // true for that this unit does NOT wire a real `loot()` for — villager/fox already have
  // their OWN complete pickup elsewhere (`07zv6_vbgather.js` D-609, `07zj_fox.js`) and must
  // not be double-driven from here; piglin/piglin_brute's own `PiglinBrain.canGather`/`.loot`
  // (bartering) and panda's own bespoke mainhand-food `loot()` override have no AI substrate
  // in this engine to hang them off yet (`Eq.OWED` names both) — driving them through the
  // GENERIC `Eq.tryEquip` below instead of skipping them would be a wrong, invented behaviour
  // (a panda vacuuming up a sword like a zombie), strictly worse than the flag sitting unused,
  // so `Eq.tickPickup` skips every one of these five species outright rather than guess.
  Eq.PICKUP_SKIP = { villager: 1, fox: 1, piglin: 1, panda: 1 };   // piglin_brute: generic loot, Eq.canGather = golden axe only

  /** `LivingEntity.getPreferredEquipmentSlot` (.decomp/net/minecraft/entity/LivingEntity.java
   *  :3268-3279) IS `IT.equipSlot` (D-266) — that table was already read straight out of the
   *  SAME bytecode (`Mob.getEquipmentSlotForItem`'s own ArmorItem/elytra/shield/pumpkin+skull
   *  branches), so this is a rename for call-site clarity, not a second implementation. */
  Eq.preferredSlot = function (stack) {
    var IT = NS.Items;
    return (IT && IT.ready && stack) ? IT.equipSlot(stack.i) : -1;
  };

  /** `LivingEntity.prefersNewDamageableItem` (.decomp:622-630). ⚠ COLLAPSED, not guessed: the
   *  jar's own ternary is `hasNbt(a) && hasNbt(b) ? (a's keys include one != "Damage") &&
   *  !(b's keys include one != "Damage") : false` — and in THIS engine's stack shape (D-267,
   *  14f_inventory.js) durability lives in `.d`, never inside `.t`, so "a key other than
   *  Damage" is simply "`.t` is non-empty" for both sides; substituting that in, the middle
   *  branch's own `&& !hasNbt(b)` directly contradicts the `hasNbt(a) && hasNbt(b)` it is
   *  gated on, so it is ALWAYS false when reached — algebra, not approximation. */
  Eq.prefersNewDamageableItem = function (a, b) {
    var aTag = !!(a && a.t && Object.keys(a.t).length);
    var bTag = !!(b && b.t && Object.keys(b.t).length);
    var aDmg = (a && a.d) | 0, bDmg = (b && b.d) | 0;
    if (aDmg >= bDmg && (!aTag || bTag)) return false;
    return true;
  };

  /** Is `stack`'s item one of the thirty `H.attrs`-table tools that is NOT a sword — i.e. a
   *  `MiningToolItem` (axe/pickaxe/shovel/hoe all extend it, `.decomp` read whole: axe/hoe/
   *  pickaxe/shovel each read `class ... extends MiningToolItem`). `H.attrs`'s own thirty
   *  entries (14i_hand.js header) ARE exactly sword+axe+hoe+pickaxe+shovel across six tiers —
   *  bow/crossbow carry no ATTACK_DAMAGE attribute in vanilla either, so they are correctly
   *  absent from it and correctly absent from this test. */
  Eq.isMiningTool = function (stack) {
    var H = NS.Hand;
    if (!H || !H.attrsFor || !stack) return false;
    return !!H.attrsFor(stack) && !H.isSword(stack);
  };

  /**
   * `MobEntity.prefersNewEquipment` (.decomp:572-620), transcribed branch for branch: empty
   * slot → true; sword-vs-sword → `AttackDamageAttribute` compare then `prefersNewDamageable`;
   * bow-vs-bow / crossbow-vs-crossbow → straight to `prefersNewDamageable`; armour → binding
   * curse on the OLD piece refuses the swap outright, else defense then toughness then
   * `prefersNewDamageable`; a `MiningToolItem` replacing a `BlockItem` is always preferred,
   * replacing another `MiningToolItem` compares attack damage then `prefersNewDamageable`;
   * everything else is refused. `oldStack` null/falsy IS `ItemStack.EMPTY` here (`Eq.
   * getEquipped` already returns null for an empty slot, D-comment above it).
   */
  Eq.prefersNewEquipment = function (newStack, oldStack, e) {
    var IT = NS.Items, H = NS.Hand, Cb = NS.Combat;
    if (!IT || !IT.ready || !newStack) return false;
    if (!oldStack) return true;
    var newName = IT.nameOf(newStack.i), oldName = IT.nameOf(oldStack.i);
    if (e && e.type === 'drowned') {   // DrownedEntity.prefersNewEquipment (.decomp:163-171)
      if (oldName === 'nautilus_shell') return false;
      if (oldName === 'trident') return newName === 'trident' && ((newStack.d | 0) < (oldStack.d | 0));
      if (newName === 'trident') return true;
    }
    if (H && H.isSword && H.isSword(newStack)) {
      if (!H.isSword(oldStack)) return true;
      var nd = H.attackDamageFor(newStack), od = H.attackDamageFor(oldStack);
      if (nd !== od) return nd > od;
      return Eq.prefersNewDamageableItem(newStack, oldStack);
    }
    if (newName === 'bow' && oldName === 'bow') return Eq.prefersNewDamageableItem(newStack, oldStack);
    if (newName === 'crossbow' && oldName === 'crossbow') return Eq.prefersNewDamageableItem(newStack, oldStack);
    if (IT.isArmor(newStack.i)) {
      if (Cb && Cb.enchantLevel && Cb.enchantLevel(oldStack, 'binding_curse') > 0) return false;
      if (!IT.isArmor(oldStack.i)) return true;
      var np = IT.defenseOf(newStack.i), op = IT.defenseOf(oldStack.i);
      if (np !== op) return np > op;
      var nt = IT.toughnessOf(newStack.i), ot = IT.toughnessOf(oldStack.i);
      if (nt !== ot) return nt > ot;
      return Eq.prefersNewDamageableItem(newStack, oldStack);
    }
    if (Eq.isMiningTool(newStack)) {
      if (IT.isBlock(oldStack.i)) return true;
      if (Eq.isMiningTool(oldStack)) {
        var na = H.attackDamageFor(newStack), oa = H.attackDamageFor(oldStack);
        if (na !== oa) return na > oa;
        return Eq.prefersNewDamageableItem(newStack, oldStack);
      }
    }
    return false;
  };

  /**
   * `ZombieEntity.canPickupItem`/`.canGather` (.decomp:431-438) — the egg refusal is
   * `canPickupItem` (so it also gates `tryEquip`'s own second call, matching the jar's own
   * double check), the glow_ink_sac refusal is `canGather` ONLY (so `tryEquip` alone,
   * called directly, never sees it — nothing in this engine calls `tryEquip` outside
   * `Eq.loot`, so that distinction is honoured by THIS split rather than collapsed).
   * `ZombifiedPiglinEntity.canGather` (.decomp:244-246) replaces the glow_ink_sac refusal
   * with a bare `return this.canPickupItem($$0)`, i.e. it does NOT inherit it — the ONE
   * family member this drops the refusal for.
   */
  Eq.canPickupItem = function (e, stack) {
    var IT = NS.Items, fam = NS.Undead && NS.Undead.ZOMBIE_FAMILY;
    if (!e || !stack || !IT || !IT.ready) return true;
    if (fam && fam[e.type] && IT.nameOf(stack.i) === 'egg' && e.isBaby && e.vehicle) return false;
    return true;
  };
  Eq.canGather = function (e, stack) {
    var IT = NS.Items, fam = NS.Undead && NS.Undead.ZOMBIE_FAMILY;
    if (!e || !stack || !IT || !IT.ready) return true;
    if (fam && fam[e.type] && e.type !== 'zombified_piglin' && IT.nameOf(stack.i) === 'glow_ink_sac') return false;
    if (e.type === 'piglin_brute' && IT.nameOf(stack.i) !== 'golden_axe') return false;   // PiglinBruteEntity.canGather
    return Eq.canPickupItem(e, stack);
  };

  /**
   * `MobEntity.tryEquip` (.decomp:539-554). Returns whether the swap happened; on a swap the
   * OLD occupant (if any) drops at the mob's own feet the SAME `Math.max(nextFloat()-0.1,0) <
   * dropChance` roll `Eq.dropEquipment` already uses for a death drop (`.decomp:851`, same
   * literal `0.1F`/`0.0F`), the new stack is written in (`equipLootStack`), and
   * `updateDropChances` sets THAT slot's own drop chance to the `2.0` "always drops, guaranteed"
   * sentinel (.decomp:562-568) — `Eq.dropChance`/`setDropChance` already unify the hand/armour
   * arrays vanilla keeps split, so one call covers both.
   */
  Eq.tryEquip = function (e, stack, rnd) {
    var IT = NS.Items, EL = NS.EntityList;
    if (!Eq.ready || !e || !stack || !IT || !IT.ready) return false;
    var slot = Eq.preferredSlot(stack);
    if (slot < 0) return false;
    var old = Eq.getEquipped(e, slot);
    if (!Eq.prefersNewEquipment(stack, old, e) || !Eq.canPickupItem(e, stack)) return false;
    var r = rnd || NS.fbRand;
    if (old && Math.max(r() - 0.1, 0) < Eq.dropChance(e, slot)) {
      if (EL && EL.dropStack) EL.dropStack(e.x, e.y + (e.height || 1) * 0.5, e.z, old.i, old.n || 1);
    }
    Eq.setEquipped(e, slot, stack);
    Eq.setDropChance(e, slot, Eq.OMINOUS_BANNER_DROP_CHANCE);   // 2.0 — same guaranteed-drop sentinel
    e.persistent = true;
    return true;
  };

  /**
   * `MobEntity.loot` (.decomp:528-534), fed by `tickMovement`'s own scan — the item entity's
   * ground stack (`Eq.stackOf`, always full-durability/no-tag: this engine's `ItemEntity`
   * carries no damage/nbt at all, the SAME substrate `P.pickupItems`/`Gt.lootTick` already
   * accept, D-333). `PillagerEntity.loot` (.decomp:234-246) is the one species override this
   * unit actually wires: a non-banner item is silently ignored (the jar's own `isRaidCaptain`
   * branch is DEAD CODE — it re-tests the identical `BannerItem` predicate the branch above it
   * already caught, so nothing but a banner is ever reachable there either way); a banner
   * takes the generic path below. `RaiderEntity.loot`'s own ominous-banner captain-PROMOTION
   * half (`setWaveCaptain`/`setPatrolLeader`) is `Eq.OWED` — it needs `07s_raid.js`'s own
   * captain state, outside this unit's files.
   */
  /** `RaiderEntity.loot` (RaiderEntity.java:231-251): an active raid whose wave has no living
   *  captain + the ominous banner stack -> wear it, discard the item, setWaveCaptain/setPatrolLeader. */
  Eq.tryPromoteCaptain = function (e, it) {
    var Rd = NS.Raid, EL = NS.EntityList;
    if (!Rd || !Rd.CAN_LEAD || !Rd.CAN_LEAD[e.type] || e.raidId === undefined || e.raidId === null) return false;
    var rm = NS.RaidManager, raid = rm && rm.world ? rm.world.raids[e.raidId] : null;
    if (!raid || !raid.waveCaptain || raid.status !== Rd.Status.ONGOING) return false;
    var cur = raid.waveCaptain[e.wave];
    if (cur && !cur.dead && !cur.removed) return false;
    if (!Eq.isOminousBanner({ i: it.item, t: it.tag })) return false;
    Eq.setEquipped(e, NS.Items.HEAD, Eq.getOminousBanner());
    Eq.setDropChance(e, NS.Items.HEAD, Eq.OMINOUS_BANNER_DROP_CHANCE);
    e.headItem = 'ominous_banner'; e.ominousBanner = true; e.patrolLeader = true;
    raid.waveCaptain[e.wave] = e;
    if (EL && EL.remove) EL.remove(it);
    return true;
  };

  /** `LivingEntity.triggerItemPickedUpByEntityCriteria`: the thrower (ItemEntity.thrower uuid) is a player. */
  Eq.triggerPickedUp = function (e, itemEntity) {
    var EL = NS.EntityList, IT = NS.Items, T = NS.Tags;
    var pl = itemEntity && itemEntity.thrower && EL && EL.byUuid ? EL.byUuid(itemEntity.thrower) : null;
    if (!pl || !pl.advancements || !NS.Adv || !NS.Adv.trigger) return;
    var name = IT.nameOf(itemEntity.item);
    if (!name) return;
    var stack = { id: 'minecraft:' + name, count: itemEntity.count || 1, nbt: itemEntity.tag || null };
    var self = { type: 'minecraft:' + e.type, x: e.x, y: e.y, z: e.z, baby: !!(e.baby || e.isBaby) };
    NS.Adv.trigger(pl, 'minecraft:thrown_item_picked_up_by_entity', {
      player: pl, stack: stack, entity: self,
      inTag: function (kind, tag, id) { return kind === 'item' && !!T && T.ready && T.itemIn(tag.replace(/^minecraft:/, ''), id.replace(/^minecraft:/, '')); }
    });
  };
  Eq.loot = function (e, itemEntity, rnd) {
    var IT = NS.Items, EL = NS.EntityList;
    if (!Eq.ready || !e || !itemEntity || !IT || !IT.ready) return false;
    var name = IT.nameOf(itemEntity.item);
    if (!name) return false;
    if (e.type === 'pillager' && !/_banner$/.test(name)) return false;
    if (e.type === 'panda') return !!(NS.Panda && NS.Panda.loot(e, itemEntity));
    if (e.type === 'dolphin') return !!(NS.Dolphin && NS.Dolphin.loot(e, itemEntity));
    var stack = Eq.stackOf(name);
    if (!stack) return false;
    stack.n = itemEntity.count || 1;
    if (itemEntity.tag) stack.t = itemEntity.tag;
    if (Eq.tryPromoteCaptain(e, itemEntity)) return true;
    if (!Eq.canGather(e, stack)) return false;
    var ok = Eq.tryEquip(e, stack, rnd);
    if (ok) Eq.triggerPickedUp(e, itemEntity);
    if (ok && NS.Particle && NS.Particle.spawnPickup) NS.Particle.spawnPickup(itemEntity, e);
    if (ok && EL && EL.remove) EL.remove(itemEntity);
    return ok;
  };

  /** The ONE hook call site (07i_entitylist.js's own `EL.tickMob`, mobTick slot) — see the
   *  header just above `Eq.PICKUP_BOX_INFLATE` for the gate/roster this collapses. */
  Eq.tickPickup = function (e, rnd) {
    var EL = NS.EntityList;
    if (!Eq.ready || !EL || !EL.ready || !EL.list || !e) return;
    if (!e.canPickUpLoot || e.dead || e.removed) return;
    if (Eq.PICKUP_SKIP[e.type] && e.type !== 'panda') return;   // panda: Pd.loot (07zl_panda.js)
    var ctx = EL.aiCtx ? EL.aiCtx(e) : null;
    if (ctx && ctx.mobGriefing && !ctx.mobGriefing()) return;
    var IN = Eq.PICKUP_BOX_INFLATE;
    var hw = (e.width || 0.6) * 0.5, h = e.height || 1.95;
    var x0 = e.x - hw - IN, x1 = e.x + hw + IN;
    var y0 = e.y, y1 = e.y + h;
    var z0 = e.z - hw - IN, z1 = e.z + hw + IN;
    var list = EL.list;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (!o || o.removed || o.type !== 'item' || (o.pickupDelay | 0) > 0 || !(o.count > 0) || (o.itemOwner && o.itemOwner !== e.uuid)) continue;
      var ehw = (o.width || 0.25) * 0.5, eh = o.height || 0.25;
      if (o.x + ehw < x0 || o.x - ehw > x1) continue;
      if (o.y + eh < y0 || o.y > y1) continue;
      if (o.z + ehw < z0 || o.z - ehw > z1) continue;
      Eq.loot(e, o, rnd);
    }
  };


})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
