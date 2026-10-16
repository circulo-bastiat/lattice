// 07zw_mobnbt.js — loop/nbtsave-s104. Closes Mnt.OWED's "entity NBT PERSISTENCE at all" entry
// (07r_mount.js's own header names it: e.hasChest/e.mountItems/e.saddled/e.tamed/e.variant, cat's
// e.catVariant, sheep's e.woolColor -- none of it round-tripped through 16b_save.js), Tu.OWED's
// "NBT persistence" (07zp_turtle.js), and part of Bee.OWED's hive-occupant fields (07zo_bee.js) —
// the per-BEE fields (hasNectar/hivePos/angerTime/...) round-trip here; the hive BLOCK ENTITY's
// own `bees` occupant list (07c_blockentity.js) round-trips separately, through THAT file's own
// `BE.serializeAll`/`restoreAll` (loop/besave-s105) — a block entity, not a mob, so it is not in
// `EL.list` for this file's walk to find, named in this file's own OWED below.
// Runs on: MAIN THREAD ONLY. No DOM. 16b_save.js's own S.save/S.load are the only callers.
//
// ⚠⚠ **ONE GENERIC MECHANISM, NOT FORTY BESPOKE FUNCTIONS.** Every species below is a plain
// LIST OF FIELD NAMES — the vanilla `writeCustomDataToNbt` tag this engine already tracks under
// a JS-cased name (`e.tamed`/Tameable's `Tame`, `e.catVariant`/CatEntity's `CatVariant`, etc,
// each field's OWN `.decomp` citation already sits next to its WRITER in the 07z*.js module that
// owns it — this table only says WHICH of a mob's fields are the persisted ones, it does not
// re-derive the numbers). `serializeAll`/`restoreAll` below are the one serializer for all of
// them. Reload goes back through `EL.spawn` (07i_entitylist.js) exactly like a fresh spawn, so
// every DERIVED field — dimensions, motion, the live `Ai` goal selector, attributes rolled by
// `Mount.rollAttributes` — is rebuilt by the SAME code a natural spawn uses, not hand-copied
// here. `EL.spawn`'s own generic opts-copy step (07i_entitylist.js, right before it calls
// `EL.DEFAULTS[name]`) reads `Mb.fieldsFor(name)` and copies any of those keys present in `opts`
// onto the fresh entity BEFORE that species' own default hook runs — the same "spawner-supplied
// data wins over a fresh roll" rule `opts.type`/`opts.variant`/`opts.mainGene` already use
// throughout `EL.DEFAULTS`, generalised to a table lookup instead of one bespoke `if` per field.
// Every DEFAULTS entry a persisted field touches was already guarded per-field or per-function
// (`e.tamed === undefined`, `e.rabbitType !== undefined return`, `Mnt.rollAttributes`'s own new
// `e.maxHealthAttr !== undefined` short-circuit, this pass) for exactly this "caller already
// supplied it" case — a reload is that case with a save file standing in for the caller, nothing
// new was invented to make this land.
//
// ⚠ A SAVE FROM BEFORE THIS UNIT HAS NO MOB RECORDS AT ALL (16b_save.js's `data.mobs` is simply
// absent) and loads exactly as before — no mobs, same as every session up to this one. A mob
// record for a species this build no longer recognises (`Entities.dimensions` returns null,
// `EL.spawn`'s own existing refusal) is skipped, not thrown — one bad or renamed type must not
// cost the rest of the world's mobs.
//
// ⚠ WHAT IS NOT HERE, NAMED RATHER THAN GUESSED (`MobNbt.OWED`):
//   * the live tick-alive counter `e.age` (item despawn/merge timer, D-276's own header) is
//     deliberately NOT `growAge` and is deliberately NOT persisted — a reloaded mob is zero
//     ticks old, same as vanilla's own `Entity.age` (never an NBT tag).
//   * `e.shooter` on a live arrow (07i_entitylist.js's own pre-existing note) — a live JS
//     reference cannot round-trip through JSON, unchanged and unwidened by this pass.
//   * hive OCCUPANCY — the `bees` array a `07c_blockentity.js` beehive block entity holds
//     (Bee.enterHive, 07zo_bee.js) is BLOCK entity state, not this file's per-MOB list, and a
//     bee mid-residence is simply not in `EL.list` for this file's walk to find — CLOSED
//     separately (loop/besave-s105): `07c_blockentity.js`'s own `BE.serializeAll`/`restoreAll`
//     now round-trips that array (plus `honeyLevel`) as part of 16b_save.js's block-entity
//     records, so a resident bee's occupant slot survives reload; only the LIVE bee it would
//     have become on release is what this file's own walk never touched anyway.
//   * villager TRADE OFFERS/USES/DEMAND *values* are listed as persistable fields (this engine's
//     `Trade.ensure`, 07p_trade.js, already reads `opts.tradeOffers`/`opts.tradeUses` back) but
//     `Trade.ensure`'s own re-check (`e.tradeProfession !== e.profession || !e.tradeOffers`)
//     means a record that DOES carry them round-trips correctly; nothing here rerolls them.
//   * GOSSIP entries' own individual timestamps decay against `NS.U.now()`, unaffected by a
//     save/load gap — read, not written, by this pass.

(function (NS) {
  'use strict';

  var Mb = NS.MobNbt = { ready: false };

  // LivingEntity's own Health, AgeableMob's Age ("growAge" here — 07m_breed.js's own header:
  // NOT the tick-alive `e.age`) and InLove. Present on every persisted mob for which they apply;
  // absent otherwise, same "only write what exists" rule 16b_save.js's block-edit encoding uses.
  // loop/mobdefaults (referee finding b) — `MobEntity.writeCustomDataToNbt`/
  // `readCustomDataFromNbt` (.decomp MobEntity.java:354-355,431) put `CanPickUpLoot` and
  // `PersistenceRequired` on every mob's NBT, the same two tags every other COMMON field
  // here already round-trips generically -- `e.canPickUpLoot`/`e.persistent`
  // (07i_entitylist.js's `EL.mobStateDefaults`) are the same shape as `health`/`maxHealth`
  // just above: real state, not species-specific, so COMMON (not a per-species SPECIES row)
  // is where they belong.
  // loop/nametag: `Entity.customName`/`CustomName` (.decomp Entity.java's own writeNbt --
  // every entity, not just a mob, but `Mb.serializeAll`'s walk only ever sees mobs) round-
  // trips the same generic way `persistent` (loop/mobdefaults, just above) already does --
  // a plain string or absent, never re-derived here.
  var COMMON = ['yaw', 'health', 'maxHealth', 'growAge', 'inLove', 'canPickUpLoot', 'persistent', 'leftHanded',
    'customName', 'followBonus', 'aiDisabled', 'customNameVisible', 'silent', 'noGravity', 'invulnerable', 'glowing', 'tags',
    // #5680: Entity.saveWithoutId Fire/Air/FallDistance/Motion/OnGround
    'remainingFireTicks', 'air', 'fallDistance', 'vx', 'vy', 'vz', 'onGround',
    // #5782: MobEntity ArmorItems/HandItems + Armor/HandDropChances (07y_equip.js e.equip / e.equipDropChance)
    'equip', 'equipDropChance'];

  var ZOMBIE_ATTRS = ['reinforceBase', 'reinforceMods', 'followRange', 'knockbackResistance',
    'zombieLeader', 'canBreakDoors', 'waterConvertTime', 'convertCountdown'];

  // PatrolEntity (PatrolTarget/PatrolLeader/Patrolling) + RaiderEntity (Wave/CanJoinRaid). RaidId is
  // carried as raidId (#5783): the raid table is saved too (RM.toJSON), and RM.relink rejoins by id.
  var RAIDER = ['patrolTarget', 'patrolLeader', 'patrolling', 'wave', 'canJoinRaid', 'raidId'];

  var PROJ = ['powerX', 'powerY', 'powerZ', 'vx', 'vy', 'vz', 'age', 'leftOwner'];
  var PROJECTILES = { fireball: 1, small_fireball: 1, dragon_fireball: 1, wither_skull: 1 };

  // #5704: AbstractDecorationEntity TileX/Y/Z (attachmentPos) + Facing, PaintingEntity Motive, ItemFrameEntity
  // Item/ItemRotation/ItemDropChance/Fixed (+ Invisible). restoreAll rebuilds the box via Hanging.setFacing.
  var DECOR = ['facing', 'attachmentPos', 'widthPixels', 'heightPixels', 'obstructionCheckCounter', 'invisible'];
  var FRAME = DECOR.concat(['item', 'rotation', 'itemDropChance', 'fixed']);
  var HANGING = { painting: 1, item_frame: 1, glow_item_frame: 1 };
  var ARROW = ['vx', 'vy', 'vz', 'stuck', 'groundState', 'groundCX', 'groundCY', 'groundCZ', 'groundTicks', 'shake', 'critical',
               'pickupType', 'pickupItem', 'pickupTag', 'stuckYaw', 'stuckPitch', 'isOnFire', 'age'];

  var THROWN = ['item', 'vx', 'vy', 'vz'];
  var THROWN_TYPES = { snowball: 1, egg: 1, ender_pearl: 1, experience_bottle: 1, potion: 1 };

  var SPECIES = {
    painting: DECOR.concat(['motive']),
    item_frame: FRAME,
    glow_item_frame: FRAME,
    item: ['item', 'count', 'tag', 'age', 'pickupDelay', 'health', 'itemOwner', 'thrower'],   // ItemEntity Item/Age/PickupDelay (#5478); Health/Owner/Thrower are UUIDs (#5777)

    wolf: ['tamed', 'owner', 'sitting', 'collarColor', 'angerTime'],
    cat: ['tamed', 'owner', 'sitting', 'collarColor', 'catVariant'],
    ocelot: ['trusting'],   // OcelotEntity Trusting
    // D-567 (orchestrator, at merge): a villager keeps the SAME trade/level/gossip state a zombie
    // villager already carried, plus LAST_SLEPT (07zv) and the 8-slot inventory the cure fills (07zr).
    villager: ['profession', 'villagerType', 'villagerLevel', 'tradeXp', 'tradeOffers', 'tradeUses',
      'tradeProfession', 'gossip', 'vbLastSlept', 'villagerInventory',
      // #5784 Brain memories HOME / POTENTIAL_JOB_SITE / MEETING_POINT / JOB_SITE (GlobalPos); restoreAll re-reserves the Poi tickets
      'vbHome', 'vbPotentialJob', 'vbMeeting', 'workstation',
      'tradeRestocksToday', 'tradeLastRestock', 'vbFoodLevel', 'gossipLastDecay'],
    zombie_villager: ['villagerType', 'profession', 'villagerLevel', 'tradeXp', 'tradeOffers',
      'tradeUses', 'gossip', 'converting', 'conversionTimer', 'converterId'].concat(ZOMBIE_ATTRS),
    // s112 (zombie reinforcements): ZombieEntity's persisted Attributes (spawn_reinforcements base +
    // modifiers, follow_range, knockback_resistance) and CanBreakDoors — every zombie-family type.
    zombie: ZOMBIE_ATTRS, husk: ZOMBIE_ATTRS, drowned: ZOMBIE_ATTRS, zombified_piglin: ZOMBIE_ATTRS.concat(['angerTime', 'angryAt']),
    skeleton: ['strayConversionTime', 'inPowderSnowTime'],
    sheep: ['woolColor', 'sheared'],
    // loop/snowgolem -- SnowGolemEntity.writeCustomDataToNbt/readCustomDataFromNbt
    // (.decomp): the one "Pumpkin" boolean tag (SG.canShear/SG.shear's own field, 07zq_snowgolem.js).
    snow_golem: ['hasPumpkin'],
    iron_golem: ['playerCreated', 'angerTime', 'angryAt'],   // IronGolemEntity "PlayerCreated" (#734)
    chicken: ['eggLayTime', 'hasJockey'],
    // s113: CreeperEntity.writeCustomDataToNbt/readCustomDataFromNbt (.decomp CreeperEntity.java) --
    // powered (CHARGED), Fuse (fuseTime), ExplosionRadius, ignited (read back through ignite()).
    creeper: ['charged', 'fuseTime', 'explosionRadius', 'ignited'],
    // s113 NBT sweep (each row = that class's own writeCustomDataToNbt, .decomp; a save/load probe
    // showed every one of these fields reset on reload before this):
    pig: ['saddled'],                                     // SaddledComponent "Saddle"
    strider: ['saddled'],                                 // s135: the SAME SaddledComponent "Saddle" tag
    slime: ['size', 'onGroundLastTick'],                                      // SlimeEntity "Size"
    magma_cube: ['size', 'onGroundLastTick'],             // #4466: MagmaCubeEntity extends SlimeEntity, inherits Size/wasOnGround
    glow_squid: ['darkTicksRemaining'],                   // GlowSquidEntity "DarkTicksRemaining"
    wandering_trader: ['despawnDelay', 'wanderTarget', 'tradeOffers', 'tradeUses', 'tradeDemand', 'tradeSpecial'],   // + MerchantEntity Offers   // WanderingTraderEntity DespawnDelay/WanderTarget
    pillager: RAIDER.concat(['inventory']),   // PillagerEntity "Inventory" (5 slots, #3656)
    vindicator: RAIDER.concat(['johnny']),   // VindicatorEntity "Johnny"
    witch: RAIDER, evoker: RAIDER.concat(['spellTicks']), illusioner: RAIDER.concat(['spellTicks']),
    ravager: RAIDER.concat(['ravagerAttackTick', 'ravagerStunTick', 'ravagerRoarTick']),   // D-590: IsChickenJockey (ChickenEntity.writeCustomDataToNbt)
    // #1251: VexEntity.writeCustomDataToNbt -- BoundX/Y/Z (e.bounds {x,y,z}) and LifeTicks (vexAlive/vexLifeTicks;
    // readCustomDataFromNbt's setLifeTicks makes it alive again).
    vex: ['bounds', 'vexAlive', 'vexLifeTicks'],
    // #1880: EvokerFangsEntity "Warmup" (+ "Owner", carried as ownerIdx below; ticksLeft is not an NBT tag in vanilla).
    evoker_fangs: ['warmup'],
    // #5485: PersistentProjectileEntity inGround/inBlockState/shake/life/crit/pickup (+ the shooter as ownerIdx below).
    arrow: ARROW, spectral_arrow: ARROW,
    // #5775: TridentEntity Trident (pickupItem/pickupTag/pickupDamage = the stack + Enchantments), DealtDamage, loyalty, noClip return state.
    trident: ARROW.concat(['pickupDamage', 'loyalty', 'dealtDamage', 'noClip', 'inGroundTime', 'returnTimer']),
    // #3033: ShulkerBulletEntity Dir/Steps/TXD/TYD/TZD (+ Target/Owner as bulletTargetIdx/shooterIdx below).
    shulker_bullet: ['bulletDir', 'bulletSteps', 'bulletStepX', 'bulletStepY', 'bulletStepZ'],
    // #4393: ArmorStandEntity ArmorItems/HandItems (equip), Invisible, Small, ShowArms, DisabledSlots, NoBasePlate, Marker, Pose.
    armor_stand: ['invisible', 'small', 'showArms', 'disabledSlots', 'noBasePlate', 'marker', 'asPose'],
    // #5490: ThrownItemEntity "Item" (e.item) + Entity Motion (vx/vy/vz); Owner is shooterIdx below (-1 = the player).
    // eye_of_ender is NOT here: its Item is all vanilla saves, and tx/ty/tz/lifespan are not NBT (EyeOfEnderEntity.java:165-176).
    snowball: THROWN, egg: THROWN, ender_pearl: THROWN, experience_bottle: THROWN,
    potion: THROWN.concat(['potionId', 'lingering', 'custom']),
    // #5479: TntEntity "Fuse" short (+ the igniter, carried as igniterIdx below; -1 = the player).
    tnt: ['fuse'],
    // #5683: ProjectileEntity LeftOwner (+ Owner as shooterIdx below); the flight vector rides along as vx/vy/vz.
    llama_spit: ['leftOwner', 'vx', 'vy', 'vz'],
    // #5482: ExperienceOrbEntity Value / Age (orbAge; unlike the mob tick `age`, an orb's Age IS persisted) / Count.
    experience_orb: ['value', 'orbAge', 'pickingCount'],
    // #5481: FallingBlockEntity.writeCustomDataToNbt BlockState/Time/DropItem/HurtEntities/FallHurtAmount/FallHurtMax/TileEntityData.
    falling_block: ['state', 'timeFalling', 'dropItem', 'hurtEntities', 'fallHurtAmount', 'fallDamageMax', 'tileEntityData'],
    bat: ['roosting', 'hangingPos'],
    endermite: ['lifeTime'],                              // s115: EndermiteEntity "Lifetime" (.decomp:95-104)
    // EnderDragonEntity "DragonPhase" (phase type id) / "DragonDeathTime" (ticksSinceDeath); the rig is
    // synced onto e.dragonPhase/e.dragonDeathTime in serializeAll and read back in ED.initEntity.
    ender_dragon: ['dragonPhase', 'dragonDeathTime'],
    // #5491: EndCrystalEntity.writeCustomDataToNbt -- BeamTarget (block pos, when set) and ShowBottom.
    end_crystal: ['beamTarget', 'showBottom'],
    enderman: ['carriedBlock', 'angerTime', 'angryAt', 'ageWhenTargetSet', 'provoked'],
    rabbit: ['rabbitType', 'moreCarrotTicks'],
    parrot: ['parrotVariant', 'tamed', 'owner', 'sitting'],   // #1224 + TameableEntity Owner/Sitting (#3052): ParrotEntity "Variant"
    fox: ['foxType', 'sleeping', 'sitting', 'crouching', 'foxOwner', 'foxTrusted'],   // FoxEntity Trusted/Sleeping/Sitting/Crouching
    goat: ['screaming'],
    shulker: ['shulkerColor', 'shulkerFace', 'shulkerPeek', 'shulkerArmorMod'],                           // #657: ShulkerEntity "Color" (Sh.getColor/setColor)
    // s133: AbstractPiglinEntity TimeInOverworld/IsImmuneToZombification + PiglinEntity CannotHunt
    piglin: ['timeInOverworld', 'immuneToZombification', 'cannotHunt', 'inventory'],
    piglin_brute: ['timeInOverworld', 'immuneToZombification', 'homeX', 'homeY', 'homeZ'],
    // s134: HoglinEntity TimeInOverworld/IsImmuneToZombification/CannotBeHunted (ZoglinEntity IsBaby = the age)
    hoglin: ['timeInOverworld', 'immuneToZombification', 'cannotBeHunted'],
    // loop/blazeghast: GhastEntity.writeCustomDataToNbt/readCustomDataFromNbt -- ExplosionPower (the ONLY custom field either mob has; BlazeEntity's BLAZE_FLAGS is a DataTracker byte, never NBT).
    ghast: ['fireballStrength'],
    // #5487: ExplosiveProjectileEntity power (acceleration), FireballEntity ExplosionPower, motion, life; the owner rides as shooterIdx.
    // WitherSkullEntity `dangerous` is a DataTracker flag in vanilla (synced, not NBT) - `charged` here is the same bit, kept so a reload is lossless.
    fireball: PROJ.concat(['explosionPower']), small_fireball: PROJ, dragon_fireball: PROJ, wither_skull: PROJ.concat(['charged']),
    // #5776: EyeOfEnderEntity Item + the flight state (target, lifespan, dropsItem) and motion.
    eye_of_ender: ['item', 'tx', 'ty', 'tz', 'lifespan', 'dropsItem', 'vx', 'vy', 'vz'],
    wither: ['invulTimer'],   // #3648: WitherEntity "Invul" (getInvulnerableTimer/setInvulTimer)
    panda: ['mainGene', 'hiddenGene'],
    axolotl: ['axolotlVariant', 'air', 'fromBucket'],   // Entity's own Air (D-649); AxolotlEntity "FromBucket" (PlayingDead is a DataTracker flag, never NBT)
    // #1277: FishEntity "FromBucket"; PufferfishEntity "PuffState"; TropicalFishEntity "Variant" (e.fishVariant).
    cod: ['fromBucket'], salmon: ['fromBucket'],
    pufferfish: ['fromBucket', 'puffState'], tropical_fish: ['fromBucket', 'fishVariant'],
    dolphin: ['air', 'moistness', 'gotFish', 'treasureX', 'treasureY', 'treasureZ'],   // #718: Moistness/GotFish/TreasurePosX/Y/Z
    turtle: ['homeX', 'homeY', 'homeZ', 'hasEgg', 'travelPos'],
    // MooshroomEntity.writeCustomDataToNbt: Type + EffectId/EffectDuration (stewEffect = {id, ticks}).
    mooshroom: ['mooshroomType', 'stewEffect'],
    bee: ['hasNectar', 'hasStung', 'angerTime', 'angryAt', 'ticksSinceSting',
      'ticksSincePollination', 'cannotEnterHiveTicks', 'cropsGrownSincePollination',
      'ticksUntilCanPollinate', 'flowerPos', 'hivePos', 'stingerCount'],
    horse: ['variant', 'saddled', 'maxHealthAttr', 'movementSpeedAttr', 'jumpStrengthAttr',
      'tamed', 'owner', 'mountItems', 'temper', 'bred', 'eatingGrass', 'armorItem', 'armorBonus'],
    donkey: ['saddled', 'hasChest', 'maxHealthAttr', 'movementSpeedAttr', 'jumpStrengthAttr',
      'tamed', 'owner', 'mountItems', 'temper', 'bred', 'eatingGrass'],
    mule: ['saddled', 'hasChest', 'maxHealthAttr', 'movementSpeedAttr', 'jumpStrengthAttr',
      'tamed', 'owner', 'mountItems', 'temper', 'bred', 'eatingGrass'],
    llama: ['saddled', 'hasChest', 'maxHealthAttr', 'movementSpeedAttr', 'jumpStrengthAttr',
      'tamed', 'owner', 'mountItems', 'temper', 'bred', 'eatingGrass', 'strength', 'variant', 'carpetColor'],
    trader_llama: ['saddled', 'hasChest', 'maxHealthAttr', 'movementSpeedAttr', 'jumpStrengthAttr',
      'tamed', 'owner', 'mountItems', 'temper', 'bred', 'eatingGrass', 'strength', 'variant', 'carpetColor', 'despawnDelay'],
    // loop/phantom -- PhantomEntity.writeCustomDataToNbt/readCustomDataFromNbt (.decomp
    // lines 168-181): AX/AY/AZ (circlingCenter) and Size (phantomSize) -- setPhantomSize's
    // own [0,64] clamp already lives in NS.Phantom.setSize (07zz1_phantom.js), read back on
    // reload through the SAME generic opts-copy EL.spawn already gives every other field here.
    phantom: ['phantomSize', 'circlingX', 'circlingY', 'circlingZ'],
    // loop/nametag: VindicatorEntity "Johnny" (.decomp VindicatorEntity.java:93-113) rides on the
    // vindicator row above (RAIDER + 'johnny'); e.johnny latches from 14l_use.js's name-tag branch.
    // s116 (MOB-RIDES-MOB, QUEUE 0.2 G18c "left: mob-rides-mob") -- `SkeletonHorseEntity.
    // writeCustomDataToNbt`/`readCustomDataFromNbt` (.decomp:122-133): `SkeletonTrap`/
    // `SkeletonTrapTime` -- closes 07zzc_lightning.js's own `Lgt.OWED` line (the lightning
    // bolt's own ambientTick/remainingActions/cosmetic/seed half of that same bullet is still
    // open, named there, not here). `e.trapped`/`e.trapTime` are the JS-cased fields
    // `Lgt.tickTrap` already reads/writes (07zzc_lightning.js).
    // #5488: FireworkRocketEntity Life/LifeTime/FireworksItem (e.tag.Fireworks)/ShotAtAngle; the shooter link is shooterIdx.
    // #5682: AreaEffectCloudEntity Age/Duration/WaitTime/Radius/RadiusOnUse/RadiusPerTick/ReapplicationDelay/Potion/Effects (the names Potion.tickCloud reads)
    area_effect_cloud: ['age', 'radius', 'waitTime', 'duration', 'reapplicationDelay', 'radiusOnUse', 'radiusGrowth', 'potionId', 'custom'],
    firework_rocket: ['life', 'lifeTime', 'tag', 'shotAtAngle', 'flight', 'color'],
    skeleton_horse: ['trapped', 'trapTime', 'saddled', 'maxHealthAttr', 'movementSpeedAttr',
      'jumpStrengthAttr', 'tamed', 'owner', 'mountItems', 'temper', 'bred', 'eatingGrass'],
    // #714: ZombieHorseEntity is a plain HorseBaseEntity (Tame/Owner/SaddleItem/Temper/Bred/... --
    // same base fields the donkey row carries, no chest, no variant, no armour slot).
    zombie_horse: ['saddled', 'maxHealthAttr', 'movementSpeedAttr', 'jumpStrengthAttr',
      'tamed', 'owner', 'mountItems', 'temper', 'bred', 'eatingGrass']
  };

  /** Every field name `type` is allowed to carry through a save, COMMON plus that species' own
   *  row (an unrecognised/generic type gets COMMON only — a cow or a zombie has nothing beyond
   *  health/age/love, which is already everything vanilla tracks for either). */
  Mb.fieldsFor = function (type) { return COMMON.concat(SPECIES[type] || []); };

  /** Walk the live world and pick out every LIVING mob (`e.maxHealth !== undefined` — the same
   *  test `Entities.isLiving`/`EL.spawn`'s own `at` block already use to decide who gets health
   *  at all) as a plain JSON-safe record. `e.removed` mobs (dead this tick, not yet swept) are
   *  skipped — same rule a fresh save of block edits already applies to nothing-there cells. */
  Mb.serializeAll = function () {
    var EL = NS.EntityList;
    if (!EL || !EL.list) return [];
    var out = [];
    for (var i = 0; i < EL.list.length; i++) {
      var e = EL.list[i];
      var cart = e && NS.Minecart && NS.Minecart.isCart(e.type);
      if (!e || e.removed || (e.maxHealth === undefined && !cart && e.type !== 'evoker_fangs' && e.type !== 'shulker_bullet' && e.type !== 'boat' && e.type !== 'arrow' && e.type !== 'spectral_arrow' && e.type !== 'trident' && e.type !== 'item' && e.type !== 'experience_orb' && !HANGING[e.type] && e.type !== 'falling_block' && e.type !== 'tnt' && e.type !== 'llama_spit' && e.type !== 'eye_of_ender' && e.type !== 'firework_rocket' && e.type !== 'end_crystal' && e.type !== 'area_effect_cloud' && !PROJECTILES[e.type] && !THROWN_TYPES[e.type])) continue;
      var rec = { type: e.type, x: e.x, y: e.y, z: e.z, dimension: e.dimension || 'overworld', UUID: e.uuid };
      if (e.type === 'ender_dragon' && e.dragon) {
        e.dragonPhase = e.dragon.getPhaseManager().getCurrent().type.id;
        e.dragonDeathTime = e.dragon.ticksSinceDeath | 0;
      }
      var fields = Mb.fieldsFor(e.type);
      for (var j = 0; j < fields.length; j++) {
        var f = fields[j];
        if (e[f] !== undefined) rec[f] = e[f];
      }
      // BoatEntity.writeCustomDataToNbt: only Type; location/velocity/fall state are NOT saved.
      if (e.type === 'boat') rec.boatType = e.boatType;
      if (cart) { rec.cartNbt = NS.Minecart.writeNbt(e); if (e.cartName !== undefined) rec.cartName = e.cartName; }
      // #293 -- LivingEntity's own `ActiveEffects` list (07q_effects.js's writeNbt, hidden chain nested).
      if (NS.Effects && NS.Effects.writeActiveEffects) NS.Effects.writeActiveEffects(e, rec);
      rec._i = out.length;
      e._nbtIdx = rec._i;
      out.push(rec);
    }
    // D-590: vanilla nests a vehicle's riders in its own "Passengers" list (Entity.writeNbt) and
    // re-mounts them on load (EntityType.loadEntityWithPassengers -> startRiding(vehicle, true)).
    // A flat record list carries the same fact as the rider's index of its vehicle.
    for (var k = 0; k < out.length; k++) {
      var ent = null;
      for (var q = 0; q < EL.list.length; q++) if (EL.list[q] && EL.list[q]._nbtIdx === k) { ent = EL.list[q]; break; }
      var v = ent && ent.vehicle;
      if (v && !v.removed && v._nbtIdx !== undefined && out[v._nbtIdx] && out[v._nbtIdx] !== out[k]) out[k].vehicleIdx = v._nbtIdx;
    }
    for (var f = 0; f < out.length; f++) {
      if (out[f].type !== 'evoker_fangs' && out[f].type !== 'arrow' && out[f].type !== 'spectral_arrow' && out[f].type !== 'trident') continue;
      if (out[f].type === 'trident' && EL.list.some(function (q) { return q && q._nbtIdx === f && q.shooter === NS.Player; })) out[f].shooterPlayer = true;   // #5775
      for (var g = 0; g < EL.list.length; g++) if (EL.list[g] && EL.list[g]._nbtIdx === f) {
        var ow = EL.list[g].owner || EL.list[g].shooter;
        if (ow && !ow.removed && ow._nbtIdx !== undefined) out[f].ownerIdx = ow._nbtIdx;
        break;
      }
    }
    for (var b = 0; b < out.length; b++) {
      if (out[b].type !== 'shulker_bullet' && !PROJECTILES[out[b].type] && !THROWN_TYPES[out[b].type]) continue;
      for (var c = 0; c < EL.list.length; c++) if (EL.list[c] && EL.list[c]._nbtIdx === b) {
        var bt = PROJECTILES[out[b].type] ? null : EL.list[c].bulletTarget, sh = EL.list[c].shooter;
        if (bt === NS.Player) out[b].bulletTargetIdx = -1;   // the player is not in EL.list
        else if (bt && !bt.removed && bt._nbtIdx !== undefined) out[b].bulletTargetIdx = bt._nbtIdx;
        if (sh === NS.Player && THROWN_TYPES[out[b].type]) out[b].shooterIdx = -1;
        else if (sh && !sh.removed && sh._nbtIdx !== undefined) out[b].shooterIdx = sh._nbtIdx;
        break;
      }
    }
    for (var rk = 0; rk < out.length; rk++) {
      if (out[rk].type !== 'firework_rocket') continue;
      for (var rq = 0; rq < EL.list.length; rq++) if (EL.list[rq] && EL.list[rq]._nbtIdx === rk) {
        var rs = EL.list[rq].shooter;
        if (rs === NS.Player) out[rk].shooterIdx = -1;   // the attached gliding player
        else if (rs && !rs.removed && rs._nbtIdx !== undefined) out[rk].shooterIdx = rs._nbtIdx;
        break;
      }
    }
    for (var ls = 0; ls < out.length; ls++) {
      if (out[ls].type !== 'llama_spit') continue;
      for (var lq = 0; lq < EL.list.length; lq++) if (EL.list[lq] && EL.list[lq]._nbtIdx === ls) {
        var lo = EL.list[lq].shooter;
        if (lo && !lo.removed && lo._nbtIdx !== undefined) out[ls].shooterIdx = lo._nbtIdx;
        break;
      }
    }
    for (var t = 0; t < out.length; t++) {
      if (out[t].type !== 'tnt') continue;
      for (var u = 0; u < EL.list.length; u++) if (EL.list[u] && EL.list[u]._nbtIdx === t) {
        var ig = EL.list[u].igniter;
        if (ig === NS.Player) out[t].igniterUuid = NS.Player.uuid || 'player';
        else if (ig && !ig.removed && ig.uuid) out[t].igniterUuid = ig.uuid;
        break;
      }
    }
    // #5795: MobEntity.writeLeashNbt -- Leash = holder (entity index / knot X,Y,Z / the player); a dead holder is kept as leashLost
    // so the load drops the lead the way deserializeLeashNbt does for a holder that did not come back.
    for (var lk = 0; lk < out.length; lk++) {
      for (var lm = 0; lm < EL.list.length; lm++) if (EL.list[lm] && EL.list[lm]._nbtIdx === lk) {
        var lh = EL.list[lm].leashHolder;
        if (lh) {
          if (lh.kind === 'player') out[lk].leashPlayer = true;
          else if (lh.kind === 'knot' && lh.knot && !lh.knot.removed) out[lk].leashKnot = { X: lh.knot.bx, Y: lh.knot.by, Z: lh.knot.bz };
          else if (lh.kind === 'entity' && lh.entity && !lh.entity.removed && !lh.entity.dead && lh.entity._nbtIdx !== undefined) out[lk].leashIdx = lh.entity._nbtIdx;
          else out[lk].leashLost = true;
        }
        break;
      }
    }
    for (var z = 0; z < EL.list.length; z++) if (EL.list[z]) delete EL.list[z]._nbtIdx;
    for (var w = 0; w < out.length; w++) delete out[w]._i;
    return out;
  };

  /**
   * Reload every record through the REAL spawn path (`EL.spawn`, 07i_entitylist.js) — dimensions,
   * motion, attributes, the live `Ai` goal selector are all rebuilt exactly as a natural spawn
   * builds them; only the fields this file lists are threaded through as `opts`, the same
   * "spawner-supplied opts win" mechanism `opts.type`/`opts.variant`/`opts.mainGene` already use.
   * A record whose `type` no longer resolves (`EL.spawn` itself returns null — a renamed/removed
   * block in a future build) is skipped, not thrown. Returns the count actually restored.
   */
  Mb.restoreAll = function (records) {
    var EL = NS.EntityList;
    if (!EL || !EL.spawn || !records || !records.length) return 0;
    var n = 0;
    var made = [];
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (!r || !r.type) continue;
      // s135 -- an explicit restore marker (opts.mobNbtRestore), not inferred from a field's
      // presence: `opts.growAge !== undefined` (EL.ZOMBIE_BABY_ROLL's own guard, 07i_entity
      // list.js) works for the zombie family (growAge is always a real number on one of
      // those), but an AnimalEntity-style adult (strider, pig, ...) genuinely never sets
      // `e.growAge` at all unless it is a baby -- serializeAll then omits it from the record
      // (the `e[f] !== undefined` guard, above) and a restored ADULT's own opts would carry
      // no growAge key either, indistinguishable from a fresh spawn. A type whose own
      // natural-spawn init rolls something random and MUST NOT re-roll on load (a rostered
      // rider, e.g. Strider.initStrider, 07zzj_strider.js) reads this flag instead.
      var opts = { mobNbtRestore: true, dimension: NS.Dim ? NS.Dim.norm(r.dimension) : 'overworld' };
      if (r.UUID) opts.uuid = r.UUID;
      var fields = Mb.fieldsFor(r.type);
      for (var j = 0; j < fields.length; j++) {
        var f = fields[j];
        if (r[f] !== undefined) opts[f] = r[f];
      }
      if (r.type === 'boat' && r.boatType !== undefined) opts.boatType = r.boatType;
      if (r.cartNbt) { for (var ck in r.cartNbt) opts[ck] = r.cartNbt[ck]; if (r.cartName !== undefined) opts.name = r.cartName; }
      var e = EL.spawn(r.type, r.x, r.y, r.z, opts);
      if (!e) continue;
      if (r.yaw !== undefined) e.yaw = r.yaw;
      // #5782: the spawn-time equipment roll must not survive a load; saved gear (or none) wins
      e.equip = r.equip ? JSON.parse(JSON.stringify(r.equip)) : undefined;
      e.equipDropChance = r.equipDropChance ? r.equipDropChance.slice() : undefined;
      if (PROJECTILES[r.type]) for (var pi = 0; pi < PROJ.length; pi++) if (r[PROJ[pi]] !== undefined) e[PROJ[pi]] = r[PROJ[pi]];   // the init zeroes power
      if (e.type === 'end_crystal') {   // #5491: the type init resets both; re-apply the saved values
        if (r.beamTarget) e.beamTarget = { x: r.beamTarget.x | 0, y: r.beamTarget.y | 0, z: r.beamTarget.z | 0 };
        if (r.showBottom !== undefined) e.showBottom = !!r.showBottom;
      }
      if (HANGING[e.type] && NS.Hanging && e.facing !== undefined && e.attachmentPos && e.facing >= 0 && e.facing < 4) {
        if (r.item !== undefined) e.item = r.item ? JSON.parse(JSON.stringify(r.item)) : null;
        NS.Hanging.setFacing(e, e.facing);   // hbox/x/y/z are derived, not saved
      }
      if (e.type === 'boat' && r.yaw !== undefined) e.yawDeg = r.yaw * 180 / Math.PI - 180;
      if (r.type === 'arrow' || r.type === 'spectral_arrow' || r.type === 'trident') for (var af = 0, AR = SPECIES[r.type] || ARROW; af < AR.length; af++) if (r[AR[af]] !== undefined) e[AR[af]] = r[AR[af]];   // #5485/#5775
      if (r.type === 'trident' && r.shooterPlayer) e.shooter = NS.Player;
      if (e.type === 'armor_stand' && NS.ArmorStand) NS.ArmorStand.refresh(e);
      if (NS.Effects && NS.Effects.readActiveEffects && r.ActiveEffects) NS.Effects.readActiveEffects(e, r);   // #293
      if (r.type === 'villager') {   // #5784: memories back on the entity, tickets / claim re-reserved
        var mp = ['vbHome', 'vbPotentialJob', 'vbMeeting', 'workstation'];
        for (var mi = 0; mi < mp.length; mi++) if (r[mp[mi]]) e[mp[mi]] = { x: r[mp[mi]].x, y: r[mp[mi]].y, z: r[mp[mi]].z };
        var P = NS.Poi;
        if (P && P.reserveTicket) {
          var tk = ['vbHome', 'vbPotentialJob', 'vbMeeting'];
          for (var ti = 0; ti < tk.length; ti++) if (e[tk[ti]] && !P.reserveTicket(e[tk[ti]])) e[tk[ti]] = null;
        }
        if (e.workstation && NS.Profession && NS.Profession.claimed) {
          var w = e.workstation, wk = w.x + ',' + w.y + ',' + w.z;
          if (NS.Profession.claimed[wk] === undefined) NS.Profession.claimed[wk] = e.id; else e.workstation = null;
        }
      }
      made[i] = e;
      n++;
    }
    // D-590: re-mount riders (see serializeAll). A jockey pair (chicken/spider vehicle) takes
    // Undead.mountJockey's own seat height; s116 -- a skeleton_horse vehicle (the lightning
    // trap) takes Lgt.mountTrapRider's own seat height, same reason; every other mob-on-mob
    // pair Raid.startRiding's.
    for (var o = 0; o < records.length; o++)
      if (records[o] && made[o] && records[o].ownerIdx !== undefined && made[records[o].ownerIdx]) {
        made[o].owner = made[records[o].ownerIdx];
        if (records[o].type === 'arrow' || records[o].type === 'spectral_arrow' || records[o].type === 'trident') made[o].shooter = made[o].owner;
      }
    for (var bi = 0; bi < records.length; bi++) {
      var br = records[bi], be = made[bi];
      if (!br || !be) continue;
      if (THROWN_TYPES[br.type] && br.shooterIdx === -1) { be.shooter = NS.Player; continue; }
      if (PROJECTILES[br.type]) { if (br.shooterIdx !== undefined && made[br.shooterIdx]) be.shooter = made[br.shooterIdx]; continue; }
      if (br.type !== 'shulker_bullet') continue;
      if (br.bulletTargetIdx === -1) be.bulletTarget = NS.Player;
      else if (br.bulletTargetIdx !== undefined && made[br.bulletTargetIdx]) be.bulletTarget = made[br.bulletTargetIdx];
      if (br.shooterIdx !== undefined && made[br.shooterIdx]) be.shooter = made[br.shooterIdx];
    }
    for (var fi = 0; fi < records.length; fi++) {
      var fr = records[fi], fe = made[fi];
      if (!fr || !fe || fr.type !== 'firework_rocket' || fr.shooterIdx === undefined) continue;
      if (fr.shooterIdx === -1) fe.shooter = NS.Player;
      else if (made[fr.shooterIdx]) fe.shooter = made[fr.shooterIdx];
    }
    for (var li = 0; li < records.length; li++) {
      if (records[li] && made[li] && records[li].type === 'llama_spit' && records[li].shooterIdx !== undefined && made[records[li].shooterIdx]) made[li].shooter = made[records[li].shooterIdx];
    }
    for (var ti = 0; ti < records.length; ti++) {
      if (!records[ti] || !made[ti] || records[ti].type !== 'tnt') continue;
      var igu = records[ti].igniterUuid;
      if (igu === undefined) continue;
      if (NS.Player && (igu === 'player' || NS.Player.uuid === igu)) made[ti].igniter = NS.Player;
      else { for (var mi = 0; mi < made.length; mi++) if (made[mi] && made[mi].uuid === igu) { made[ti].igniter = made[mi]; break; } }
    }
    for (var m = 0; m < records.length; m++) {
      var rr = records[m], rider = made[m];
      if (!rr || !rider || rr.vehicleIdx === undefined) continue;
      var veh = made[rr.vehicleIdx];
      if (!veh || veh === rider) continue;
      if (veh.type === 'boat') {
        if (NS.Raid && NS.Raid.startRiding) NS.Raid.startRiding(rider, veh);
        if (veh.passengers && veh.passengers.indexOf(rider) < 0) veh.passengers.push(rider);
      } else if ((veh.type === 'chicken' || veh.type === 'spider' || veh.type === 'cave_spider') &&
          NS.Undead && NS.Undead.mountJockey) NS.Undead.mountJockey(rider, veh);
      else if (veh.type === 'skeleton_horse' && NS.Lightning && NS.Lightning.mountTrapRider)
        NS.Lightning.mountTrapRider(rider, veh);
      else if (NS.Raid && NS.Raid.startRiding) NS.Raid.startRiding(rider, veh);
    }
    // #5795: MobEntity.readLeashNbt / deserializeLeashNbt, once every mob is back.
    for (var lr = 0; lr < records.length; lr++) {
      var lrec = records[lr], lme = made[lr];
      if (!lrec || !lme) continue;
      var Tm = NS.Tame, holder = null;
      if (lrec.leashPlayer) holder = { kind: 'player' };
      else if (lrec.leashKnot && Tm && Tm.getOrCreateKnot) holder = { kind: 'knot', knot: Tm.getOrCreateKnot(lrec.leashKnot.X | 0, lrec.leashKnot.Y | 0, lrec.leashKnot.Z | 0) };
      else if (lrec.leashIdx !== undefined && made[lrec.leashIdx]) holder = { kind: 'entity', entity: made[lrec.leashIdx] };
      if (holder) lme.leashHolder = holder;
      else if ((lrec.leashLost || lrec.leashIdx !== undefined || lrec.leashKnot) && Tm) {
        lme.leashHolder = { kind: 'player' };   // unresolved: drop the lead at the mob
        Tm.unleash(lme, true);
      }
    }
    return n;
  };

  Mb.ready = true;
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
