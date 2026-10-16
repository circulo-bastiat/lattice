// 14j_combat.js — PLAN G17d: MELEE COMBAT (D-338).
// Runs on: MAIN THREAD ONLY. No DOM.
//
// ⚠⚠ **WHY THIS FILE EXISTS.** Dan, session 11: *"there is no combat and no mid air punching
// without looking at anything"*. The swing was D-334; this is the other half. Nothing in this
// engine could pick an entity, nothing could be hurt, nothing was knocked back, and no item had
// an attack damage — `Hand.attackSpeedTable` had been null since G10 (D-271, paid in D-335).
//
// ⚠ **AND IT IS A SUBSTRATE, NOT A FEATURE YOU CAN SEE YET — WHICH IS SAID HERE RATHER THAN
// DISCOVERED LATER.** Eight entity types can be simulated and three can be drawn, so the only
// things this can be pointed at today are a turtle, a dolphin and a guardian, none of which are
// rendered. **G18 — mobs, with models and behaviour — is what makes this visible**, and it is
// allocated in PLAN rather than half-built here. Dan's rule, session 11: *"do not half do a
// feature"*. Every number below is vanilla's and every one is asserted by `combatcheck`, so when
// G18 lands there is nothing to go back and get right.
//
// ⚠ WHAT IS HERE, AND WHAT IS NAMED AS OWED. `Cb.OWED` carries the parts that need systems this
// engine does not have — enchantments, potion effects, experience — and `combatcheck` holds it
// closed. A silent omission in a damage formula is a number that is quietly wrong for ever; a
// named one is a stage's worth of work somebody can pick up.
// ⚠ G18d (D-381) closed the MOB LOOT row: `Cb.dropLoot`, called once from `Cb.tickEntity` on the
// first tick of the death animation, runs `NS.Loot.entityDrops` and pops the result as real item
// entities — see `07e_loot.js`'s entity-table additions for the interpreter side.

(function (NS) {
  'use strict';

  var Cb = NS.Combat = { ready: false };

  /**
   * ⚠ THE PARTS OF `Player.attack` (AND, AS OF D-394, `Cb.mobAttack`) THAT NEED A SYSTEM THIS
   * ENGINE HAS NOT BUILT. Held closed by `combatcheck`: an entry may only leave this list when
   * the thing it names is implemented.
   */
  Cb.OWED = [
    // D-461 closed three rows here: the Sharpness/Smite/Bane damage bonus, the Sweeping Edge
    // ratio and the Knockback enchantment — all read off the held stack's own NBT, below.
    // (Nothing in survival PUTS an enchantment on a stack yet — no enchanting table, no anvil,
    // G22 — so today they are reached through a stack's tag, e.g. `/give`'s NBT.)
    // G17d-a closed 'the attack sounds': `Cb.attackSound`, the six `entity.player.attack.*` events.
    // D-658 closed 'the crit/sweep particles': `Cb.attackParticles` below — the sweep, the CRIT
    // and ENCHANTED_HIT emitters and the DAMAGE_INDICATOR hearts, in `Player.attack`'s own order.
    // D-462 closed 'ATTACK_KNOCKBACK on a mob's own strike': `Cb.mobAttack` reads it off
    // entity-attributes-1.18.2.tsv (hoglin/zoglin 1, ravager 1.5, every other mob 0).
    // D-470 closed 'Fire Aspect, and setting the target alight': the pre-ignite poke and the
    // level*4 duration, both read off `Player.attack`'s own bytecode, plus the fire-tick damage
    // itself (`Entity.baseTick`'s fire half — this engine's first burning entity of any kind).
    // QUEUE 0.2 closed 'the Blindness effect suppressing a critical hit' and 'damage to the
    // ATTACKER from thorns': `07q_effects.js`'s `ES.suppressesCrit`/`ES.thornsOnUserDamaged`,
    // wired below in `Cb.attack`/`Cb.mobAttack`/`Cb.hurt`.
    // G22 (#200): no enchant row remains. `enchweapons` holds the weapon side end to end through
    // the real kill join — Sharpness I-V on every sword tier, Fire Aspect's cooked drops, Looting.
  ];

  // ── vanilla's constants, each from the method it lives in ────────────────────────────────
  /** `LivingEntity.hurt`: 20 ticks of grace, and 10 of red flash. */
  Cb.INVULNERABLE_TICKS = 20;
  Cb.HURT_DURATION = 10;
  /** `Player.attack`: the cooldown ramp `0.2 + h*h*0.8`, and the threshold a "full" hit needs. */
  Cb.RAMP_BASE = 0.2;
  Cb.RAMP_SCALE = 0.8;
  Cb.FULL_STRENGTH = 0.9;
  /** A critical hit is one and a half times. */
  Cb.CRIT_MULTIPLIER = 1.5;
  /** The base sweep, before the Sweeping Edge enchantment: `1.0F + ratio * f`, ratio 0. */
  Cb.SWEEP_BASE_DAMAGE = 1.0;
  /** `Player.attack`'s sweep box: the target's box inflated by 1, 0.25, 1. */
  Cb.SWEEP_INFLATE = [1.0, 0.25, 1.0];
  /** ...and the sweep only reaches targets with `distanceToSqr < 9.0` — THREE blocks, feet to
   *  feet. ⚠ Until D-461 this was compared as 9*9, i.e. nine blocks: a sweep reached 3x too far. */
  Cb.SWEEP_RANGE_SQ = 9.0;
  /** `Mob.doHurtTarget`: a mob that knocks its target back keeps 0.6 of its own horizontal
   *  motion (`multiply(0.6D, 1.0D, 0.6D)`) — D-462. */
  Cb.MOB_STRIKE_SLOW = 0.6;
  /** Knockback: `i * 0.5` per level, and the attacker is slowed to 0.6 horizontally. */
  Cb.KNOCKBACK_PER_LEVEL = 0.5;
  Cb.ATTACKER_SLOWDOWN = 0.6;
  /** `LivingEntity.knockback`'s upward clamp when the target is on the ground. */
  Cb.KNOCKBACK_UP_CLAMP = 0.4;
  /** `Player.attack` ends with `causeFoodExhaustion(0.1F)`. */
  Cb.ATTACK_EXHAUSTION = 0.1;
  /** `GameRenderer.pick`: the entity search box is the reach ray inflated by one block. */
  Cb.PICK_INFLATE = 1.0;
  /** `Entity.getTargetingMargin`: 0 by default, 1.0 for `ExplosiveProjectileEntity` and `ShulkerBulletEntity` (fireball, shulker_bullet, small_fireball, wither_skull, dragon_fireball). */
  Cb.targetingMargin = function (e) {
    var t = e.type;
    return (t === 'fireball' || t === 'small_fireball' || t === 'wither_skull' || t === 'dragon_fireball' || t === 'shulker_bullet') ? 1.0 : 0;
  };

  // ── D-461: WEAPON ENCHANTMENTS ON A MELEE BLOW, transcribed from the 1.18.2 bytecode ──────
  // Every number here is asserted against `tools/golden/combat-enchant-1.18.2.tsv`, which
  // `tools/extract-combat-enchant.mjs` reads out of the jar — the check does not own them.
  /** `Player.attack`'s sweep: each swept mob is knocked back by 0.4F — NOT the main blow's 0.5
   *  per level (the engine used 0.5 here until D-461) — and only within `distanceToSqr < 9`,
   *  measured FEET TO FEET (`Entity.distanceToSqr(Entity)` is position to position). */
  Cb.SWEEP_KNOCKBACK = Math.fround(0.4);
  /** `DamageEnchantment.getDamageBonus(level, mobType)`: type 0 (sharpness) is
   *  `1 + max(0, level - 1) * 0.5` against ANYTHING — including level 0, which is still +1;
   *  smite and bane are `level * 2.5` against UNDEAD / ARTHROPOD only. */
  Cb.SHARPNESS_BASE = 1.0;
  Cb.SHARPNESS_PER_LEVEL = 0.5;
  Cb.SMITE_PER_LEVEL = 2.5;
  Cb.BANE_PER_LEVEL = 2.5;
  Cb.IMPALING_PER_LEVEL = 2.5;   // ImpalingEnchantment.getAttackDamage: level * 2.5F vs AQUATIC
  /** `EnchantmentHelper.getEnchantmentLevel(CompoundTag)`: `Mth.clamp(tag.getInt("lvl"), 0, 255)`. */
  Cb.ENCHANT_LEVEL_MAX = 255;

  // ── D-470: FIRE ASPECT AND THE FIRE TICK ITSELF, transcribed from the 1.18.2 bytecode ─────
  // `Player.attack` calls `EnchantmentHelper`'s one-line Fire Aspect getter TWICE: once for an
  // immediate 1-second poke before the hit even resolves — gated only on the target existing and
  // not being fire-immune, so it fires even when the hit is then blocked by invulnerability
  // frames (vanilla's own quirk, kept as found rather than "fixed") — and again, only once the
  // hit truly lands, for the real `level * 4` seconds. Both calls land on `Entity.f(int)`, i.e.
  // `setSecondsOnFire`, which is `seconds * 20` ticks and only ever RAISES the counter.
  Cb.FIRE_ASPECT_PRE_IGNITE_SECONDS = 1;
  Cb.FIRE_ASPECT_SECONDS_PER_LEVEL = 4;
  /** `Entity.baseTick`'s fire half: fire-immune decays the counter 4 ticks a tick with no
   *  damage; otherwise one point of `DamageSource.onFire` every 20 ticks, then the counter
   *  falls by 1 — this engine had no fire-tick damage of any kind before this. */
  Cb.FIRE_TICKS_PER_SECOND = 20;
  Cb.FIRE_IMMUNE_DECAY_PER_TICK = 4;
  Cb.FIRE_DAMAGE_INTERVAL_TICKS = 20;
  Cb.FIRE_DAMAGE_PER_TICK = 1.0;
  /** `Entity.fireImmune()`, off the same golden roster `entity-types-1.18.2.tsv` already carries
   *  (column 4 — blaze/ghast/magma_cube/strider/wither/zoglin/etc.), not a second guess at it. */
  Cb.fireImmuneOf = function (e) {
    var Ent = NS.Entities;
    return !!(Ent && Ent.fireImmune && e && Ent.fireImmune(e.type));
  };
  /** `Entity.setSecondsOnFire(seconds)`: ticks only ever go UP from this call, never down. */
  /** Every `ZombieEntity` subclass that keeps its tryAttack (Husk/Drowned/ZombieVillager/ZombifiedPiglin call super). */
  Cb.ZOMBIE_FIRE_TYPES = { zombie: 1, husk: 1, drowned: 1, zombie_villager: 1, zombified_piglin: 1 };
  Cb.igniteForSeconds = function (e, seconds) {
    if (!e || !(seconds > 0)) return;
    var ticks = seconds * Cb.FIRE_TICKS_PER_SECOND;
    if (e.type === 'player' && e.inventory && NS.Inventory) {   // ProtectionEnchantment.transformFireDuration (player armour)
      var lv = 0;
      for (var i = 0; i < 4; i++) lv += Cb.enchantLevel(e.inventory.slots[NS.Inventory.ARMOR_START + i], 'fire_protection');
      if (lv > 0) ticks = Math.max(0, ticks - Math.floor(Math.fround(ticks * lv * 0.15)));
    }
    if (!(e.remainingFireTicks > ticks)) e.remainingFireTicks = ticks;
    e.isOnFire = e.remainingFireTicks > 0 && !Cb.fireImmuneOf(e);   // Entity.isOnFire(): !fireImmune() && ...
  };
  // ── D-511: UNDEAD BURN IN DAYLIGHT (.decomp) ───────────────────────────────────────────────
  // ZombieEntity.tickMovement:223 (`burnsInDaylight() && isAffectedByDaylight()` → setOnFireFor(8);
  // HuskEntity.burnsInDaylight → false), AbstractSkeletonEntity.tickMovement:99 (no burns gate),
  // PhantomEntity.tickMovement:146. Drowned/zombie_villager inherit Zombie's; zombified_piglin
  // and wither_skeleton do too but are fire-immune, so the fire only decays (Cb.tickEntity).
  // D-517 -- THE HELMET BRANCH (ZombieEntity.tickMovement:227-241, .decomp): a damageable
  // head item takes the sun instead of the mob catching fire -- `random.nextInt(2)` extra
  // damage, and once it reaches max durability the piece breaks (removed) rather than the
  // mob burning that tick either way. See `Cb.tickDaylightBurn` below.
  Cb.DAYLIGHT_BURN_SECONDS = 8;
  Cb.BURNS_IN_DAYLIGHT = { zombie: 1, drowned: 1, zombie_villager: 1, zombified_piglin: 1,
                           skeleton: 1, stray: 1, wither_skeleton: 1, phantom: 1 };   // husk: false
  /** getActiveEyeHeight overrides: Zombie 1.74 (baby 0.93), AbstractSkeleton 1.74,
   *  WitherSkeleton 2.1, Phantom height*0.35; else Entity's default height*0.85. */
  function eyeTab(v, names) { var o = {}; names.split(' ').forEach(function (n) { o[n] = v; }); return o; }
  // #1973 .decomp getActiveEyeHeight overrides: fixed value / height factor / [adult, baby] fixed / [adult, baby] height factor
  Cb.EYE_FIXED = { cave_spider: 0.45, spider: 0.65, enderman: 2.55, ghast: 2.6, shulker: 0.5, witch: 1.62, silverfish: 0.13, endermite: 0.13 };
  Cb.EYE_FACTOR = Object.assign({ phantom: 0.35, slime: 0.625, magma_cube: 0.625, sheep: 0.95, axolotl: 0.655, bat: 0.5, parrot: 0.6, wolf: 0.8, armor_stand: 0.9 },
    eyeTab(0.65, 'cod salmon pufferfish tropical_fish'), eyeTab(0.5, 'squid glow_squid guardian elder_guardian bee'),
    eyeTab(0.95, 'horse donkey mule llama trader_llama skeleton_horse zombie_horse'));
  Cb.EYE_BABY_FIXED = { piglin: [1.74, 0.93], piglin_brute: [1.74, 0.93], villager: [1.62, 0.81], wandering_trader: [1.62, 0.81] };
  Cb.EYE_BABY_FACTOR = { chicken: [0.92, 0.85], cow: [1.3, 0.95], mooshroom: [1.3, 0.95], fox: [0.4, 0.85] };   // adult cow/fox are fixed heights, not factors
  Cb.eyeHeightOf = function (e) {
    var t = e.type, baby = NS.Breed && NS.Breed.isBaby ? NS.Breed.isBaby(e) : false;
    if (t === 'zombie' || t === 'drowned' || t === 'zombie_villager' || t === 'zombified_piglin' || t === 'husk')
      return baby ? 0.93 : 1.74;
    if (t === 'player') return Math.fround(e.eyeHeight || 1.62);   // #4465 PlayerEntity getEyeHeight(pose): 1.62 standing, 1.27 sneaking
    if (t === 'skeleton' || t === 'stray') return 1.74;
    if (t === 'wither_skeleton') return 2.1;
    // loop/snowgolem -- `SnowGolemEntity.getActiveEyeHeight` (.decomp:130-133) is a FIXED
    // override, `1.7F`, not the generic `height*0.85` formula below (1.9*0.85 = 1.615).
    if (t === 'snow_golem') return 1.7;
    if (t === 'giant') return Math.fround(10.440001);   // #912 GiantEntity.getActiveEyeHeight (not 12*0.85)
    if (t === 'dolphin') return 0.3;   // #717 DolphinEntity.getActiveEyeHeight
    if (t === 'cat') return Math.fround((e.height || 0.7) * 0.5);   // #1319 CatEntity.getActiveEyeHeight = height*0.5 (baby's scaled height too)
    var h = e.height || 1.8;   // EL.spawn sets e.height off the entity's own EntityDimensions
    // #1973 the remaining .decomp getActiveEyeHeight overrides: fixed value, or [adult factor, baby factor] x height
    var F = Cb.EYE_FIXED[t], B = Cb.EYE_BABY_FIXED[t];
    if (F !== undefined) return Math.fround(F);
    if (B) return Math.fround(B[baby ? 1 : 0]);
    B = Cb.EYE_BABY_FACTOR[t];
    if (B) return Math.fround(baby || t === 'chicken' ? h * B[baby ? 1 : 0] : B[0]);
    F = Cb.EYE_FACTOR[t];
    return Math.fround(h * (F !== undefined ? F : 0.85));
  };
  /** #1319 #1616 `CatEntity`/`OcelotEntity.bypassesSteppingEffects`: crouch pose -> no step sound / vibration (felinePose sets e.crouching). */
  Cb.bypassesSteppingEffects = function (e) { return !!(e && (e.type === 'cat' || e.type === 'ocelot') && e.crouching); };
  /** DimensionType.computeBrightnessByLightLevel, overworld ambientLight 0: f/(4-3f). */
  Cb.brightnessOf = function (level) { var f = Math.fround(level / 15); return Math.fround(f / (4 - 3 * f)); };
  /** Entity.inPowderSnow / wasInPowderSnow: any powder_snow cell in the box (shrunk 1e-3, as checkBlockCollision), remembered one tick. */
  Cb.tickPowderSnow = function (e) {
    var W = NS.World, R = NS.Reg, St = NS.States;
    e.wasInPowderSnow = !!e.inPowderSnow;
    e.inPowderSnow = false;
    if (!W || !W.getBlock || !R || !St || R.id.powder_snow === undefined) return;
    var hw = (e.width || 0.6) / 2 - 0.001, ht = (e.height || 1.8) - 0.001, id = R.id.powder_snow;
    for (var x = Math.floor(e.x - hw); x <= Math.floor(e.x + hw); x++)
      for (var y = Math.floor(e.y + 0.001); y <= Math.floor(e.y + ht); y++)
        for (var z = Math.floor(e.z - hw); z <= Math.floor(e.z + hw); z++) {
          var st = W.getBlock(x, y, z);
          if (st > 0 && St.block[st] === id) { e.inPowderSnow = true; return; }
        }
  };
  /**
   * MobEntity.isAffectedByDaylight (.decomp MobEntity.java:1361): `world.isDay()`, brightness at
   * the eyes (getLightLevel(pos) = max(block, sky - ambientDarkness)) > 0.5, a
   * `nextFloat()*30 < (b-0.4)*2` roll, not wet (water or rain on it), and the eye block sees the
   * sky. `rnd` is nextFloat() (0..1).
   */
  Cb.isAffectedByDaylight = function (e, rnd) {
    var S = NS.Sky, W = NS.World;
    Cb.tickPowderSnow(e);   // Entity.baseTick: wasInPowderSnow = inPowderSnow, then block collision re-sets inPowderSnow
    if (!S || !S.isDay || !S.isDay() || !W || !W.getLight) return false;
    var x = Math.floor(e.x), y = Math.floor(e.y + Cb.eyeHeightOf(e)), z = Math.floor(e.z);
    var L = W.getLight(x, y, z), sky = (L >> 4) & 15, blk = L & 15;
    var b = Cb.brightnessOf(Math.max(blk, sky - S.darknessNow()));
    if (!(b > 0.5)) return false;
    if (!(Math.fround((rnd ? rnd() : NS.EntityList.wr()) * 30) < Math.fround((b - 0.4) * 2))) return false;
    if (e.inWater || e.inPowderSnow || e.wasInPowderSnow) return false;   // MobEntity.java:1365
    var seesSky = W.canSeeSky ? W.canSeeSky(x, y, z) : sky >= 15;
    if (!seesSky) return false;
    // isTouchingWaterOrRain's rain half: Level.isRainingAt at the feet or the box top
    if (S.weather && S.isRainingAt && W.biomeAt) {
      var bio = W.biomeAt(x, z), top = S.roofTop ? S.roofTop(x, z) : undefined;
      var fy = Math.floor(e.y), ty = Math.floor(e.y + (e.height || 1.8));
      if (S.isRainingAt(S.weather, bio, x, fy, z, true, top) || S.isRainingAt(S.weather, bio, x, ty, z, true, top)) return false;
    }
    return true;
  };
  /** The tickMovement half: set the mob alight for 8 s when the sun gets it -- unless a
   *  head-slot item (D-517, 07y_equip.js) takes the hit instead. */
  Cb.tickDaylightBurn = function (e, rnd) {
    if (!e || e.dead || !Cb.BURNS_IN_DAYLIGHT[e.type]) return false;
    if (!Cb.isAffectedByDaylight(e, rnd)) return false;
    var Eq = NS.Equip, IT = NS.Items;
    var helmet = (e.type !== 'phantom' && Eq && Eq.ready && IT) ? Eq.getEquipped(e, IT.HEAD) : null;
    if (helmet) {
      var amount = Math.floor((rnd ? rnd() : NS.EntityList.wr()) * 2);   // random.nextInt(2)
      Eq.damageEquipped(e, IT.HEAD, amount, rnd);
      return true;
    }
    Cb.igniteForSeconds(e, Cb.DAYLIGHT_BURN_SECONDS);
    return true;
  };
  /** `Mob.getMobType()` overrides, down each class's superclass chain (the extractor's §5). */
  Cb.MOB_TYPE = {
    undead: ['drowned', 'husk', 'phantom', 'skeleton', 'skeleton_horse', 'stray', 'wither',
             'wither_skeleton', 'zoglin', 'zombie', 'zombie_horse', 'zombie_villager', 'zombified_piglin'],
    arthropod: ['bee', 'cave_spider', 'endermite', 'silverfish', 'spider'],
    // `getGroup()` == EntityGroup.AQUATIC: WaterCreatureEntity (squid, glow squid, dolphin, fish), Guardian, Axolotl, Turtle
    aquatic: ['axolotl', 'cod', 'dolphin', 'elder_guardian', 'glow_squid', 'guardian', 'pufferfish', 'salmon',
              'squid', 'tropical_fish', 'turtle']
  };
  Cb.mobTypeOf = function (e) {
    var t = e && e.type;
    if (Cb.MOB_TYPE.undead.indexOf(t) >= 0) return 'undead';
    if (Cb.MOB_TYPE.arthropod.indexOf(t) >= 0) return 'arthropod';
    if (Cb.MOB_TYPE.aquatic.indexOf(t) >= 0) return 'aquatic';
    return 'undefined';   // MobType.UNDEFINED (illager/water change no melee number)
  };
  /** `ResourceLocation.tryParse` on an enchantment id: no namespace means `minecraft:`. */
  Cb.enchantId = function (id) {
    if (typeof id !== 'string' || !id) return null;
    return id.indexOf(':') < 0 ? 'minecraft:' + id : id;
  };
  /** The stack's `Enchantments` list as [{id, lvl}] (lvl already clamped), or []. */
  Cb.enchantList = function (stack) {
    var t = stack && stack.t;
    var L = t && t.Enchantments;
    if (!L || !L.length) return [];
    var out = [];
    for (var i = 0; i < L.length; i++) {
      var id = Cb.enchantId(L[i] && L[i].id);
      if (!id) continue;
      var lv = (L[i].lvl | 0);
      out.push({ id: id, lvl: lv < 0 ? 0 : (lv > Cb.ENCHANT_LEVEL_MAX ? Cb.ENCHANT_LEVEL_MAX : lv) });
    }
    return out;
  };
  /** `EnchantmentHelper.getItemEnchantmentLevel`: the FIRST matching entry's level, else 0. */
  Cb.enchantLevel = function (stack, id) {
    var want = Cb.enchantId(id), L = Cb.enchantList(stack);
    for (var i = 0; i < L.length; i++) if (L[i].id === want) return L[i].lvl;
    return 0;
  };
  /** `EnchantmentHelper.getLooting(entity)`: Looting's slot is MAINHAND only, so the held stack's level. */
  Cb.lootingOf = function (ent) {
    if (!ent) return 0;
    var st = null, Iv = NS.Inventory;
    if (ent === NS.Player || ent.type === 'player') st = (Iv && ent.inventory) ? Iv.getItem(ent.inventory, ent.slot) : null;
    else if (NS.Equip && NS.Items) st = NS.Equip.getEquipped(ent, NS.Items.MAINHAND);
    return st ? Cb.enchantLevel(st, 'looting') : 0;
  };
  /** `getLootTableId()`: an unsheared sheep rolls its colour's table (SheepEntity:147-185), whose wool entry nests `entities/sheep`. */
  Cb.lootTableId = function (e) {
    if (e.type === 'sheep' && !e.sheared) return 'entities/sheep/' + (e.woolColor || 'white');
    return 'entities/' + e.type;
  };
  /** `EnchantmentHelper.getDamageBonus(stack, mobType)`: summed over EVERY entry. */
  Cb.damageBonus = function (stack, mobType) {
    var L = Cb.enchantList(stack), f = 0;
    for (var i = 0; i < L.length; i++) {
      var l = L[i].lvl;
      if (L[i].id === 'minecraft:sharpness') f += Cb.SHARPNESS_BASE + Math.max(0, l - 1) * Cb.SHARPNESS_PER_LEVEL;
      else if (L[i].id === 'minecraft:smite' && mobType === 'undead') f += l * Cb.SMITE_PER_LEVEL;
      else if (L[i].id === 'minecraft:bane_of_arthropods' && mobType === 'arthropod') f += l * Cb.BANE_PER_LEVEL;
      else if (L[i].id === 'minecraft:impaling' && mobType === 'aquatic') f += l * Cb.IMPALING_PER_LEVEL;
    }
    return f;
  };
  /** `EnchantmentHelper.getSweepingDamageRatio`: `1 - 1/(level+1)` when the level is above 0. */
  Cb.sweepRatio = function (stack) {
    var l = Cb.enchantLevel(stack, 'sweeping');
    return l > 0 ? 1 - 1 / (l + 1) : 0;
  };

  Cb.init = function () {
    Cb.ready = !!(NS.EntityList && NS.Entities);
    return Cb;
  };

  /** Can this entity be attacked at all? Vanilla's answer is "is it a LivingEntity" (D-336). */
  /** #4241 -- a minecart is a plain Entity (no maxHealth) but AbstractMinecartEntity.damage takes every hit; NS.Minecart.damage owns it. */
  Cb.isCart = function (e) { return !!(e && NS.Minecart && NS.Minecart.isCart(e.type)); };
  Cb.canAttack = function (e) {
    // D-835 -- `end_crystal` is a plain `Entity` (D-336, no health/maxHealth field at all) but
    // IS a valid melee/pick/sweep target: `EndCrystalEntity.collides()` (.decomp) returns
    // `true`, the SAME predicate `Cb.arrowStrikeEntity`'s own projectile-target gather already
    // keys off (07zzn_endcrystal.js's own header). Without this, `Cb.pick` (the crosshair
    // raycast) and `Cb.attack`'s own top-of-function gate would both refuse a live crystal
    // before a swing ever reaches `Cb.hurt`'s end_crystal dispatch above.
    if (e && (e.type === 'end_crystal' || Cb.isCart(e) || e.type === 'fireball' || e.type === 'small_fireball' || e.type === 'shulker_bullet')) return !e.removed;   // #3035 bullet: collides()=true; fireballs: ExplosiveProjectileEntity is hittable (Gh.deflect)
    return !!(e && !e.removed && e.maxHealth > 0 && e.health > 0);
  };

  /**
   * `LivingEntity.knockback(strength, dx, dz)`.
   *
   * ⚠⚠ **IT HALVES THE EXISTING MOTION AND SUBTRACTS THE IMPULSE; IT DOES NOT ADD TO IT.** The
   * line is `setDeltaMovement(vx/2 - kx, onGround ? min(0.4, vy/2 + strength) : vy, vz/2 - kz)`.
   * Adding instead would make a mob hit twice in quick succession fly twice as far, and the
   * halving is what stops a knockback chain from launching anything out of the world.
   * ⚠ AND THE UPWARD PART ONLY APPLIES ON THE GROUND. A mob hit in mid-air keeps its fall.
   */
  Cb.knockback = function (e, strength, dx, dz) {
    if (!e) return false;
    if (e.type === 'shulker') return false;   // ShulkerEntity.setVelocity is a no-op (getVelocity is ZERO)
    var s = strength * (1 - (e.knockbackResistance || 0));
    if (!(s > 0)) return false;
    var len = Math.sqrt(dx * dx + dz * dz);
    if (!(len > 0)) return false;
    var kx = (dx / len) * s, kz = (dz / len) * s;
    e.vx = e.vx / 2 - kx;
    e.vz = e.vz / 2 - kz;
    if (e.onGround) {
      var up = e.vy / 2 + s;
      e.vy = up < Cb.KNOCKBACK_UP_CLAMP ? up : Cb.KNOCKBACK_UP_CLAMP;
    }
    return true;
  };

  /**
   * loop/snowgolem -- `LivingEntity.damage()` (.decomp/net/minecraft/entity/LivingEntity.java:
   * 1097-1136, read in full) runs its knockback + hurt-flash bookkeeping UNCONDITIONALLY
   * whenever there is a live attacker, EVEN WHEN the post-shield damage amount is `0.0F` --
   * `SnowballEntity.onEntityHit` (.decomp) calls `damage(DamageSource.thrownProjectile(...), 0)`
   * on any non-blaze target, and real vanilla still flashes it red and knocks it back. `Cb.hurt`
   * above hard-gates on `amount > 0` (its own header: every OTHER caller in this engine is a
   * melee/projectile blow that always deals something), so this is the one, narrow, zero-
   * damage replica of just those two lines: the SAME `e.invulnerableTime`/`e.hurtTime` grace
   * `Cb.hurt` sets (decomp's own `timeUntilRegen`/`hurtTime`, :1067-1072), and the SAME `0.4F`
   * knockback strength every `damage()` call applies toward the attacker (:1134-1136), through
   * the existing `Cb.knockback`. Returns true iff it actually fired (respects the SAME grace
   * gate real `damage()` does -- a hit still inside the window does nothing, :1061-1063, since
   * a docked amount of `0 - lastHurt` is never positive).
   */
  /** s135: who `DamageSource.getAttacker()` names — `src.attacker` (a projectile's shooter), else the
   *  player for a `byPlayer` blow; never the victim itself. */
  Cb.attackerOf = function (e, byPlayer, src) {
    var a = (src && src.attacker) || (byPlayer ? NS.Player : null);
    return a && a !== e ? a : null;
  };
  /** s135: `LivingEntity.damage`'s own knockback (:1126-1136), the jitter loop included. */
  Cb.baseKnockback = function (e, attacker) {
    if (!e || !attacker) return false;
    var dx = attacker.x - e.x, dz = attacker.z - e.z;
    while (dx * dx + dz * dz < 1e-4) { dx = (NS.EntityList.wr() - NS.EntityList.wr()) * 0.01; dz = (NS.EntityList.wr() - NS.EntityList.wr()) * 0.01; }
    return Cb.knockback(e, Cb.KNOCKBACK_BASE, dx, dz);
  };
  Cb.KNOCKBACK_BASE = 0.4;    // LivingEntity.java:1136 -- `this.takeKnockback(0.4F, dx, dz)`
  Cb.hurtZero = function (e, attacker) {
    if (!e || !Cb.canAttack(e)) return false;
    // EndermanEntity.damage's ProjectileDamageSource branch (thrown snowball/egg): teleport, no super.damage.
    if (e.type === 'enderman') return Cb.hurt(e, 1, undefined, false, { source: 'projectile', attacker: attacker || null });
    if (e.invulnerableTime > Cb.HURT_DURATION) return false;
    e.invulnerableTime = Cb.INVULNERABLE_TICKS;
    e.hurtTime = Cb.HURT_DURATION;
    e.lastHurt = 0;
    if (e.type === 'snow_golem' && NS.SnowGolem && NS.SnowGolem.playSound) NS.SnowGolem.playSound(e, NS.SnowGolem.SOUND.hurt);
    if (e.type === 'panda' && NS.Panda && NS.Panda.playSound) NS.Panda.playSound(e, NS.Panda.SOUND.hurt);
    if (attacker) {
      var dx = attacker.x - e.x, dz = attacker.z - e.z;
      if (!(dx * dx + dz * dz > 1e-4)) { dx = (NS.EntityList.wr() - NS.EntityList.wr()) * 0.01; dz = (NS.EntityList.wr() - NS.EntityList.wr()) * 0.01; }
      Cb.knockback(e, Cb.KNOCKBACK_BASE, dx, dz);
    }
    return true;
  };

  /**
   * `LivingEntity.hurt(source, amount)` — the invulnerability gate, which is the whole subtlety.
   *
   * ⚠⚠ **A SECOND HIT INSIDE THE GRACE PERIOD IS NOT IGNORED — IT IS DOCKED.** Vanilla's rule is
   * that while `invulnerableTime > 10` a new hit does nothing UNLESS it is bigger than the one
   * that bought the grace, in which case only the DIFFERENCE lands. That is why hitting a mob
   * with a stone sword and then immediately with a diamond one does more than the stone alone,
   * and why spamming the same weapon does not. Treating the grace as a plain "ignore" is the
   * obvious reading and it makes every weapon in the game feel the same.
   */
  /** `LivingEntity.PLAYER_HIT_TICKS` -- the literal 100 at .decomp LivingEntity.java:1088/1091. */
  Cb.PLAYER_HIT_TICKS = 100;
  /** The attacker half of `LivingEntity.damage` (:1082-1098). `src.attacker` is the entity
   *  `DamageSource.getAttacker()` names (for a projectile, its shooter). */
  Cb.notePlayerHit = function (e, byPlayer, src) {
    var atk = src && src.attacker;
    // LivingEntity.setAttacker/lastAttackedTime: only a real attacker arms them (fall/fire do not);
    // lastAttackedTime bumps per hit so DefendTraderGoal can edge-trigger.
    var who = Cb.attackerOf(e, byPlayer, src);
    if (who) { e.lastAttacker = who; e.lastAttackedTime = (e.lastAttackedTime || 0) + 1; e.lastAttackedAge = e.age | 0; }
    if (byPlayer || (atk && atk === NS.Player)) {
      e.playerHitTimer = Cb.PLAYER_HIT_TICKS; e.attackingPlayer = true;
    } else if (atk && atk.type === 'wolf' && atk.tamed) {
      e.playerHitTimer = Cb.PLAYER_HIT_TICKS;
      e.attackingPlayer = atk.owner === 'player';   // getOwner() is a PlayerEntity (one player, 07n_tame.js)
    }
  };
  /** `LivingEntity.baseTick`'s decay (:416-420) -- counts down, and forgets the player at 0. */
  Cb.tickPlayerHit = function (e) {
    if (e.playerHitTimer > 0) e.playerHitTimer--;
    else e.attackingPlayer = false;
  };
  /** `playerHitTimer > 0` -- the flag `drop()` hands dropLoot/dropEquipment and dropXp. */
  Cb.recentlyHitByPlayer = function (e) { return !!e && (e.playerHitTimer | 0) > 0; };
  /** killed_by_player: LAST_DAMAGE_PLAYER is set only when that flag holds AND attackingPlayer != null (:1379). */
  Cb.killedByPlayer = function (e) { return Cb.recentlyHitByPlayer(e) && !!e.attackingPlayer; };

  /**
   * #4392 -- ArmorStandEntity.damage (.decomp ArmorStandEntity.java:397-446) + onBreak/updateHealth/breakAndDropItem.
   * First player punch / any arrow-less hit: sets hitTime + ARMOR_STAND_HIT; a 2nd punch within 5 ticks breaks it.
   */
  function standSound(e, ev, vol) {
    if (NS.Sound && NS.Sound.play) NS.Sound.play(ev, { x: e.x, y: e.y, z: e.z, volume: vol, pitch: 1, source: 'neutral' });
  }
  function standBreakSound(e) { standSound(e, 'entity.armor_stand.break', 1); }
  /** ArmorStandEntity.spawnBreakParticles (:473-486): 10 oak_planks block particles at getBodyY(2/3), spread w/4,h/4,w/4, speed 0.05 (gaussian, as the count>0 particle packet). */
  function standBreakParticles(e) {
    var Px = NS.Particle, St = NS.States;
    if (!Px || !Px.spawnBlockDust || !St || !St.stateOf) return;
    var st = St.stateOf('oak_planks'), w = (e.width || 0.5) / 4, h = (e.height || 1.975) / 4, y = e.y + (e.height || 1.975) * (2 / 3);
    var rnd = (NS.EntityList && NS.EntityList.random) || NS.EntityList.wr;
    var g = function () { return NS.U.polarGaussian(rnd); };
    for (var i = 0; i < 10; i++)
      Px.spawnBlockDust(e.x + g() * w, y + g() * h, e.z + g() * w, g() * 0.05, g() * 0.05, g() * 0.05, st, Math.floor(e.x), Math.floor(e.y), Math.floor(e.z));
  }
  Cb.standBreakParticles = standBreakParticles;
  function standKill(e) { e.health = 0; if (NS.EntityList && NS.EntityList.list && NS.EntityList.list.indexOf(e) >= 0) NS.EntityList.remove(e); else e.removed = true; }
  function standOnBreak(e) {
    standBreakSound(e);
    var EL = NS.EntityList;
    var drop = function (st) {
      if (!st || !(st.n > 0) || !EL || !EL.popResource) return;
      // Block.dropStack(world, getBlockPos().up(), stack): jittered block-centre drop, gated on doTileDrops
      if (NS.Commands && NS.Commands.ruleGet && NS.Commands.ruleGet('doTileDrops') === 'false') return;
      EL.popResource(Math.floor(e.x), Math.floor(e.y) + 1, Math.floor(e.z), st.i, st.n, { tag: st.t, d: st.d });
    };
    // heldItems (mainhand, offhand) then armorItems (feet, legs, chest, head) -- the equip[] slots 0..5
    for (var s = 0; s < 6; s++) { if (e.equip) { drop(e.equip[s]); e.equip[s] = null; } }
  }
  function standUpdateHealth(e, d) {
    var h = e.health - d;
    if (h <= 0.5) { standOnBreak(e); standBreakParticles(e); standKill(e); } else e.health = h;
  }
  Cb.armorStandDamage = function (e, amount, byPlayer, src) {
    if (e.removed) return false;
    var s = src && src.source, atk = Cb.attackerOf(e, byPlayer, src);
    if (s === 'outOfWorld') { standKill(e); return false; }
    if (e.invulnerable || e.invisible || e.marker) return false;
    if (src && src.explosive) { standOnBreak(e); standKill(e); return false; }
    if (s === 'inFire') {
      if (e.isOnFire) standUpdateHealth(e, 0.15); else Cb.igniteForSeconds(e, 5);
      return false;
    }
    if (s === 'onFire' && e.health > 0.5) { standUpdateHealth(e, 4.0); return false; }
    var proj = s === 'projectile' && !!src.persistent, isPlayer = !!byPlayer || atk === NS.Player;
    if (!isPlayer && !proj) return false;
    var G = NS.Gamemode;
    if (atk === NS.Player && G && G.blockPlacingRestricted(atk.mode)) return false;   // !allowModifyWorld (adventure/spectator)
    if (atk === NS.Player && G && G.isCreative(atk)) { standBreakSound(e); standBreakParticles(e); standKill(e); return false; }
    var t = NS.Behave ? NS.Behave.gameTime : 0;
    if (t - (e.lastHitTime || 0) > 5 && !proj) {
      standSound(e, 'entity.armor_stand.hit', 0.3);
      e.lastHitTime = t;
    } else {
      var EL = NS.EntityList, ai = NS.Items && NS.Items.of ? NS.Items.of('armor_stand') : -1;
      var tileDrops = !(NS.Commands && NS.Commands.ruleGet && NS.Commands.ruleGet('doTileDrops') === 'false');
      if (tileDrops && EL && EL.popResource && ai >= 0) EL.popResource(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z), ai, 1);
      standOnBreak(e);
      standBreakParticles(e);
      standKill(e);
    }
    return true;
  };

  Cb.hurt = function (e, amount, now, byPlayer, src) {
    // #1750 -- `EndermanEntity.damage`'s else-branch (.decomp EndermanEntity.java:370-376): after
    // super.damage (whatever it returned), a hit whose getAttacker() is not a LivingEntity
    // (fire, fall, drown, magic, owner-less...) teleports away 9 times in 10. Projectile hits take
    // the 64-attempt branch further down instead.
    if (e && e.type === 'enderman' && !e.__emHurt && !(src && src.source === 'projectile')) {
      e.__emHurt = true;
      var emr;
      try { emr = Cb.hurt(e, amount, now, byPlayer, src); } finally { e.__emHurt = false; }
      if (!Cb.attackerOf(e, byPlayer, src) && NS.Enderman && NS.Enderman.ready && !e.dead &&
          NS.Enderman.rint(10) !== 0) NS.Enderman.teleportRandomly(e);
      return emr;
    }
    // D-835 — `end_crystal` is a plain `Entity` (.decomp EndCrystalEntity extends Entity
    // directly, no health/maxHealth field at all, D-336) so `Cb.canAttack`'s own `e.maxHealth >
    // 0` gate a few lines down would silently swallow EVERY hit against one — a melee blow
    // (`Cb.attack` below) or an arrow (`Cb.arrowStrikeEntity`) both funnel here. Route straight
    // to `EC.damage`'s own one-hit remove-and-explode override (EndCrystalEntity.java
    // `damage(DamageSource, float)`, read verbatim, .decomp) instead of ever reaching the
    // LivingEntity pipeline below. `Cb.attackerOf` (above) is the SAME `src.attacker` (a
    // projectile's shooter) / `byPlayer` (a melee blow) resolution every other caller of this
    // function already gets; `source`/`explosive` are threaded through unchanged so a future
    // caller that sets `src.explosive` (none does today — explosions call `EC.damage`
    // directly, 07za_explosion.js) is still honoured rather than silently dropped.
    // #643 -- `ExplosiveProjectileEntity.damage()`: any attacker's hit (fist, sword, arrow) re-owns
    // the fireball and points it along the attacker's look vector (`Gh.deflect`); no health involved.
    if (e && (e.type === 'fireball' || e.type === 'small_fireball')) {
      var fa = Cb.attackerOf(e, byPlayer, src);
      return !!(fa && NS.Ghast && NS.Ghast.deflect(e, fa));
    }
    if (Cb.isCart(e) && NS.Minecart.damage) {   // #4241 AbstractMinecartEntity.damage (+ TntMinecart flaming-arrow prime)
      var ca = Cb.attackerOf(e, byPlayer, src);
      return !!NS.Minecart.damage(e, amount, {
        attacker: ca, instabuild: !!(ca && NS.Gamemode && NS.Gamemode.isCreative(ca)), explosive: !!(src && src.explosive),
        fire: !!(src && (src.source === 'onFire' || src.source === 'inFire' || src.source === 'lava' || src.source === 'hotFloor')), flamingArrowSpeed2: src && src.flamingArrowSpeed2 });
    }
    if (e && e.type === 'boat' && NS.Boat && NS.Boat.damage) {   // #5229 BoatEntity.damage
      var ba = Cb.attackerOf(e, byPlayer, src);
      return !!NS.Boat.damage(e, amount, { attacker: ba, instabuild: !!(ba && NS.Gamemode && NS.Gamemode.isCreative(ba)) });
    }
    if (e && e.type === 'armor_stand') return Cb.armorStandDamage(e, amount, byPlayer, src);   // #4392 ArmorStandEntity.damage
    if (e && e.type === 'shulker_bullet') return !!(NS.Shulker && NS.Shulker.damageBullet(e));   // #3035 ShulkerBulletEntity.damage
    if (e && e.type === 'end_crystal') {
      var EC = NS.EndCrystal;
      return EC && EC.ready ? EC.damage(e, {
        attacker: Cb.attackerOf(e, byPlayer, src),
        source: src && src.source,
        explosive: !!(src && src.explosive)
      }) : false;
    }
    // loop s111 — `src` (optional): `{bypassArmor:true}` for the `setBypassesArmor()` sources
    // (.decomp DamageSource.java:17-39 — onFire, magic, wither, …), which skip the armour
    // absorb below but NOT Resistance/Protection (`applyEnchantmentsToDamage` only skips
    // `isUnblockable()` sources). Omitted = a melee/projectile blow, armour applies.
    if (!Cb.canAttack(e)) return false;
    // #4148 -- SilverfishEntity.damage (.decomp:98-109) arms BEFORE super.damage: any entity-attributed or MAGIC
    // source arms the 20-tick call even when the hit is swallowed (zero amount, invulnerability window).
    if (e.type === 'silverfish' && e.silverfishCallForHelp && (Cb.attackerOf(e, byPlayer, src) || (src && src.source === 'magic'))) e.silverfishCallForHelp.onHurt();
    if (!(amount > 0)) return false;
    // #3521 -- AnimalEntity.damage (.decomp AnimalEntity.java:75-82): a hit on a non-invulnerable animal ends love mode.
    if (e.inLove > 0 && !e.invulnerable) e.inLove = 0;
    // #2708 -- `EnderDragonPart.damage -> EnderDragonEntity.damagePart`: an attacker's hit on a dragon part
    // takes the per-part split (head full, others amount/4+min(amount,1)) + the sitting-damage -> Takeoff
    // rule. `parentDamage` re-enters here with `e.inPart` set for the real health subtraction.
    if (e.type === 'ender_dragon' && e.dragon && e.hitPart && !e.inPart && (Cb.attackerOf(e, byPlayer, src) || (src && src.explosive))) {
      var part = e.hitPart, atk = Cb.attackerOf(e, byPlayer, src);
      e.hitPart = null; e.inPart = true;
      try {
        e.dragon.health = e.health;
        return part.damage({ byPlayer: atk === NS.Player, explosive: !!(src && src.explosive), attacker: atk,
                             source: src && src.source, sourceEntity: src && src.sourceEntity, hurtArgs: [amount, now, byPlayer, src] }, amount);
      } finally { e.inPart = false; }
    }
    // #3823 -- EnderDragonEntity.damage returns false ALWAYS (.decomp EnderDragonEntity.java:522); only a part hit
    // (re-entering with `inPart`) reaches health. `/kill` rides outOfWorld here (vanilla has a separate kill()).
    if (e.type === 'ender_dragon' && e.dragon && !e.inPart && !(src && src.source === 'outOfWorld')) {
      e.hitPart = null;
      if (src && src.source === 'thorns' && src.attacker) {   // isThorns -> damagePart(body, ...)
        e.inPart = true;
        try {
          e.dragon.health = e.health;
          e.dragon.damagePart(e.dragon.body, { byPlayer: src.attacker === NS.Player, attacker: src.attacker, source: 'thorns',
                                               hurtArgs: [amount, now, byPlayer, src] }, amount);
        } finally { e.inPart = false; }
      }
      return false;
    }
    // #908 -- WolfEntity.damage (.decomp WolfEntity.java:296-310): any non-invulnerable hit stands the
    // wolf up, and a non-null attacker that is not a player halves the blow as (d+1)/2. (The
    // PersistentProjectileEntity exclusion tests getAttacker() -- the shooter -- so it never fires.)
    if (e.type === 'bee' && e.pollinateGoal) e.pollinateGoal.cancel();   // #2107 -- BeeEntity.damage: pollinateGoal.cancel()
    if (e.type === 'parrot') e.sitting = false;   // #1228 -- ParrotEntity.damage: setSitting(false) before super.damage
    if (e.type === 'wolf') {
      e.sitting = false;
      var wa = Cb.attackerOf(e, byPlayer, src);
      if (wa && wa !== NS.Player) amount = (amount + 1) / 2;
    }
    // #854 -- `SilverfishEntity.damage`: `source instanceof EntityDamageSource || source == MAGIC`
    // arms callForHelpGoal.onHurt(). The entity-dealt half is `Cb.notifyHurt`; attacker-less MAGIC
    // (poison, instant damage, potion clouds) never reaches that hook, so it arms here.
    // #1011 -- GuardianEntity.damage: spikes out -> thorns 2.0 back at a living, non-magic, non-explosive attacker.
    if (NS.Guardian && NS.Guardian.TYPES[e.type]) NS.Guardian.onDamage(e, Cb.attackerOf(e, byPlayer, src), src);
    // #643 -- GhastEntity.damage: a FireballEntity from a PlayerEntity is `super.damage(source, 1000)`.
    if (e.type === 'ghast' && NS.Ghast && NS.Ghast.damageMultiplier) {
      amount *= NS.Ghast.damageMultiplier(e, { source: src && src.source, byPlayer: Cb.attackerOf(e, byPlayer, src) === NS.Player });
    }
    // D-803 -- `WitherEntity.damage()`'s own invulnerability gate (.decomp
    // net/minecraft/entity/boss/WitherEntity.java:447-449, read whole): while the DataTracker
    // `INVUL_TIMER` field is > 0 (`getInvulnerableTimer() > 0`), the wither takes NO damage at
    // all from ANY source except `DamageSource.OUT_OF_WORLD` -- not reduced, not queued, the
    // call returns `false` before `super.damage()` (armour, invulnerability-window bookkeeping,
    // knockback, everything below) ever runs. `src.source === 'outOfWorld'` is the SAME tag
    // `15g_commands.js`'s own `/kill`-equivalent void-damage call already uses for that one
    // real source (`DamageSource.OUT_OF_WORLD` has no attacker and always bypasses everything
    // else too, hence no separate marker needed here).
    if (e.type === 'wither' && (e.invulTimer | 0) > 0 && !(src && src.source === 'outOfWorld')) {
      return false;
    }
    // #942 -- the rest of `WitherEntity.damage()`'s gates (.decomp WitherEntity.java, after the
    // invul-timer one): DROWN, a WitherEntity attacker, a PersistentProjectileEntity (arrow/trident)
    // once `shouldRenderOverlay()` (health <= max/2), and a non-player LivingEntity attacker of the
    // wither's own group (UNDEAD) all return false. `handleFallDamage()` is false too (no fall damage).
    if (e.type === 'wither') {
      var wsrc = src && src.source;
      if (wsrc === 'drown' || wsrc === 'fall') return false;
      if (wsrc === 'projectile' && src.persistent && e.health <= (e.maxHealth || 300) / 2) return false;
      var wa = Cb.attackerOf(e, byPlayer, src);
      if (wa && wa !== NS.Player && (wa.type === 'wither' || (NS.Effects && NS.Effects.isUndead(wa)))) return false;
    }
    // damage() (.decomp lines 460-463, read whole): every hit that gets THIS far (past the
    // invuln-timer gate above) unconditionally arms the block-breaking cooldown at the real 20
    // -- BEFORE `super.damage()` even judges the hit-cooldown window, so a wither that is hit
    // again during its own hurt-invulnerability window still re-arms it. `Wi.BLOCK_BREAK_
    // COOLDOWN`/`Wi.tickBlockBreaking` (07zzm_wither.js) are the real timer + trigger this
    // primes.
    if (e.type === 'wither' && (e.blockBreakingCooldown | 0) <= 0) {
      e.blockBreakingCooldown = (NS.Wither && NS.Wither.BLOCK_BREAK_COOLDOWN) || 20;
    }
    // ...and `chargedSkullCooldowns[i] += 3` for both side heads (.decomp lines 466-468), same point.
    if (e.type === 'wither' && e.chargedSkullCooldowns) {
      for (var wci = 0; wci < e.chargedSkullCooldowns.length; wci++) e.chargedSkullCooldowns[wci] += 3;
    }
    // D-773 shulker teleport-on-hurt (mob-shulker cloud unit) -- `ShulkerEntity.damage()`
    // (.decomp:412-434, read whole): a CLOSED shulker (`isClosed()`, `getPeekAmount()==0`)
    // facing a `PersistentProjectileEntity` (arrow/spectral-arrow/trident) never even reaches
    // `super.damage()` -- the hit is swallowed outright, no health loss, no invulnerability-
    // window docking, nothing. Gated on `src.source === 'projectile'` the SAME way the
    // enderman carve-out just above reads it (`Cb.tickArrow`'s own entity-hit branch is the
    // only call site that ever sets it) -- melee/explosion/fire/fall damage to a shulker is
    // completely unaffected, and so is every other mob's projectile damage, which never sets
    // `e.type === 'shulker'` in the first place.
    if (e.type === 'shulker' && src && src.source === 'projectile' && src.persistent &&
        (e.shulkerPeek === undefined || e.shulkerPeek === 0)) {
      return false;
    }
    // KW-42 -- `EndermanEntity.damage`'s ProjectileDamageSource override (.decomp
    // EndermanEntity.java:351-364, read whole): a projectile hit NEVER reaches `super.damage()`
    // at all (unless the projectile is a `PotionEntity`, `damageFromPotion` -- a separate,
    // not-yet-modelled gap) -- so NONE of `super.damage()`'s own effects run either: no
    // despawnCounter reset, no invulnerability-window judging, no health loss. Instead up to 64
    // `teleportRandomly()` attempts run; the FIRST one that lands makes this a "hit" (`true`,
    // matching the jar's own return) with health completely unchanged. All 64 failing falls
    // through to the jar's own `$$3` (`false`, the non-potion case) -- an enderman with nowhere
    // to teleport is simply untouched, same as the real jar. Gated on `src.source === 'projectile'`
    // (set only by `Cb.tickArrow`'s own entity-hit branch below) so melee/explosion/fire/etc.
    // damage to an enderman is completely unaffected -- and so is every other mob's projectile
    // damage, which never sets `e.type === 'enderman'` in the first place.
    if (e.type === 'enderman' && src && src.source === 'projectile') {
      var EM = NS.Enderman;
      if (EM && EM.ready) {
        for (var __endTp = 0; __endTp < 64; __endTp++) { if (EM.teleportRandomly(e)) return true; }
      }
      return false;
    }
    // D-533 (G18c) -- `BatEntity.damage` wakes a roosting bat BEFORE `super.damage` judges
    // the hit, so even a blow the invulnerability window swallows still wakes it.
    if (e.type === 'bat' && NS.Bat) NS.Bat.onDamage(e);
    // #296 -- `LivingEntity.damage`'s Fire Resistance gate (.decomp :1032): an `isFire()`
    // source (this path's only one is the burn tick, `source: 'onFire'`; `src.fire` for any
    // later caller) is swallowed whole, before despawnCounter and the invulnerability window.
    if (src && (src.fire || src.source === 'onFire' || src.source === 'fireball') && NS.Effects && NS.Effects.hasStatusEffect(e, 'fire_resistance')) return false;
    // loop/despawn-s105 -- `LivingEntity.damage` zeroes `despawnCounter` (LivingEntity.java:1039)
    // after the dead/fire-immune gates and BEFORE the invulnerability window judges the hit.
    e.despawnCounter = 0;
    // `AxolotlEntity.damage()` rolls play-dead on the RAW incoming amount, before super.damage
    // (so also when the invulnerability window swallows the hit); health is still pre-damage.
    if (e.type === 'axolotl' && NS.Axolotl) (Cb.attackerOf(e, byPlayer, src) || (src && src.entity)) && NS.Axolotl.onDamaged(e, amount);   // getAttacker()!=null || getSource()!=null
    // `PandaEntity.damage()` (.decomp:534-540): setSitting(false) on EVERY hit, before super.damage.
    if (e.type === 'panda') e.sitting = false;
    var dealt, fresh = false;
    if (e.invulnerableTime > Cb.HURT_DURATION) {
      if (amount <= e.lastHurt) return false;
      dealt = amount - e.lastHurt;
      e.lastHurt = amount;
    } else {
      fresh = true;
      dealt = amount;
      e.lastHurt = amount;
      e.invulnerableTime = Cb.INVULNERABLE_TICKS;
      e.hurtTime = Cb.HURT_DURATION;
    }
    // QUEUE 0.2 (G18e remainder) — `HorseEntity.setArmorTypeFromStack` (.decomp, javap'd)
    // adds `HorseArmorItem.getBonus()` as a GENERIC_ARMOR attribute modifier (field_23724,
    // Operation.ADDITION) on top of the horse's own base armor attribute, which nothing in
    // this engine ever sets above 0 — so the bonus IS the whole armor value read here.
    // `Mount.equipArmor` (07r_mount.js) already stores it as `e.armorBonus`; this was the
    // "stored but not read by Combat's damage path" gap named on `Mount.OWED`. The formula is
    // the SAME `CombatRules.getDamageAfterAbsorb` the player's own armour already runs
    // (`Survival.afterArmor`, 14d_survival.js) — a horse has no toughness attribute, so 0.
    // QUEUE 0.2 raid loop (this unit) — a MOB's OWN worn armour (Eq.armorOf, 07y_equip.js):
    // `MobEntity`'s six equipment slots carry a real armour roll (D-517) but `Cb.hurt` never
    // read them — `Eq.OWED` named this gap explicitly ("a zombie wearing rolled iron armour
    // here takes full damage"). `Eq.armorOf` sums the mob's OWN `generic.armor` base attribute
    // (`ZombieEntity.createZombieAttributes`, .decomp:114-120 — 2.0 for zombie, 0 for every
    // other equipment-bearing mob here, `EntityAttributes.field_23724`'s own registered default)
    // with the defense/toughness of whatever is actually equipped (`LivingEntity.
    // updateEquipmentAttributeModifiers`, the same per-piece `defenseOf`/`toughnessOf` D-291
    // already reads for the PLAYER in `Sv.updateArmor`), and folds in the horse's own
    // `armorBonus` (G18e remainder, above) since the two are mutually exclusive entity kinds
    // and `Sv.afterArmor`/`DamageUtil.getDamageLeft` (14d_survival.js) is the SAME formula
    // either way.
    var mobArmor = NS.Equip && NS.Equip.armorOf ? NS.Equip.armorOf(e, src && src.source) : null;
    // QUEUE 0.2 (this unit) -- vanilla's `LivingEntity.getAttributeValue(GENERIC_ARMOR)` is the
    // mob's OWN base `generic.armor` attribute PLUS whatever `AttributeModifier`s equipment adds
    // -- summed, never either-or (D-336's table had no armor column at all until this unit;
    // `Ent.attrsOf`'s new `armor` field, 07h_entities.js, is that base attribute, confirmed
    // per-type against `.decomp`, 0 for every type not confirmed). `Eq.armorOf` already covers
    // the WORN half (plus its own small `MOB_BASE_ARMOR` overlay for zombie/husk/drowned, a
    // narrower table that predates this one and does not overlap it -- `Ent.ARMOR` names only
    // types `Eq.MOB_BASE_ARMOR` does not); this adds the general base-attribute half on top, so a
    // mob with NO equipment at all (a wither has no equip slots) still gets its own innate armor.
    var baseAttrArmor = (NS.Entities && NS.Entities.attrsOf) ? (NS.Entities.attrsOf(e.type) || {}).armor || 0 : 0;
    var armorTotal = (e.armorBonus > 0 ? e.armorBonus : 0) + (mobArmor ? mobArmor.armor : 0) + baseAttrArmor +
      (e.type === 'shulker' && NS.Shulker && NS.Shulker.armorOf ? NS.Shulker.armorOf(e) : 0);
    var toughnessTotal = mobArmor ? mobArmor.toughness : 0;
    if (armorTotal > 0 && !(src && src.bypassArmor) && NS.Survival && NS.Survival.afterArmor) {
      dealt = NS.Survival.afterArmor(dealt, armorTotal, toughnessTotal);
    }
    // #3549/#4214 WitchEntity.applyEnchantmentsToDamage: magic x0.15 (0 from herself) -- applied to the
    // dealt amount only, AFTER the hurt/i-frame bookkeeping above ran on the unscaled amount.
    if (e.type === 'witch' && src && src.source === 'magic' && NS.Effects) {
      dealt = NS.Effects.witchMagic(e, dealt, src.attacker || (byPlayer ? NS.Player : null));
    }
    // QUEUE 0.2 — `LivingEntity.applyEnchantmentsToDamage`'s Resistance branch (20%/level,
    // after the invulnerability docking above and before health is actually spent).
    if (NS.Effects && NS.Effects.applyResistance && !(src && src.unblockable)) dealt = NS.Effects.applyResistance(e, dealt);   // STARVE (setUnblockable) skips it
    // QUEUE 0.2 raid loop (this unit) — the Protection-family enchant reduction
    // (`EnchantmentHelper.getProtectionAmount` + `DamageUtil.getInflictedDamage`, .decomp
    // LivingEntity.java:1545-1560), applied AFTER armour-absorb and Resistance, same order as
    // vanilla's own `applyArmorToDamage` -> `applyEnchantmentsToDamage`. GENERIC `protection`
    // and (armorrefcheck fix, this unit) `projectile_protection` on an arrow hit (`src.source
    // === 'projectile'`, passed into `Eq.armorOf` above) both contribute; `Eq.armorOf`'s own
    // comment names which three still cannot (no matching damage-source flag reaches here yet).
    if (mobArmor && mobArmor.protection > 0 && NS.Equip && NS.Equip.protectionReduce && !(src && src.unblockable)) {
      dealt = NS.Equip.protectionReduce(dealt, mobArmor.protection);
    }
    // loop/panda-axolotl-s101 (QUEUE 0.2 G18c) -- `AxolotlEntity.damage()`'s own play-dead
    // trigger (.decomp lines 335-347, `Ax.onDamaged`'s own header, 07zm_axolotl.js): reads
    // `e.health` (still the PRE-damage value here, matching the jar's own read order) and
    // `dealt`, so this must run BEFORE the subtraction two lines down.
    var crackBefore = e.type === 'iron_golem' ? Cb.golemCrack(e) : 0;
    e.health = Math.min(e.health - dealt, e.maxHealth || e.health - dealt);
    e.lastDamage = dealt;
    // `getRecentDamageSource().isFire()` (WitchEntity.tickMovement): remember the age of the last fire hit.
    if (src && (src.fire || src.source === 'inFire' || src.source === 'onFire' || src.source === 'lava' || src.source === 'fireball')) e.lastFireHurtAge = e.age | 0;
    // cloud unit referee-looting: `getLootContextBuilder`'s KILLER_ENTITY is the attacker of the
    // source that dealt the LAST landed hit (LivingEntity.java, `source.getAttacker()`) -- read by
    // `Cb.dropLoot` for the killer's Looting level.
    e.lastHitAttacker = Cb.attackerOf(e, byPlayer, src);
    // loop/squid-s98 (QUEUE 0.2 G18c) -- `GlowSquidEntity.damage()`'s own UNCONDITIONAL half:
    // ANY successful hit (attacker or not, fire included) sets `darkTicksRemaining` to 100.
    // `Sq.onAttacked` (the squirt, attacker-gated) is separate, called from `Cb.notifyHurt`
    // below, never from here.
    if ((e.type === 'squid' || e.type === 'glow_squid') && NS.Squid) {
      NS.Squid.onDamaged(e);
      // #3480 -- `SquidEntity.damage`: squirt on ANY successful damage while the REMEMBERED attacker
      // lives. An entity-dealt hit squirts from `Cb.notifyHurt` (attacker recorded there), so only
      // the attacker-less hit squirts here (no double).
      if (!Cb.attackerOf(e, byPlayer, src) && NS.Fly.attackerOf(e)) NS.Squid.squirt(e);
    }
    // G18d: WHO landed the hit that (maybe) kills this entity, for `killed_by_player` and the
    // creeper's `entity_properties{entity:"killer"}` check. Only a player can deal damage in
    // this engine today (mob-vs-mob combat is G18b's, unbuilt), so this is simple; the field is
    // shaped so a future attacker type just overwrites it the same way.
    // G21 (Xp.OWED closed) -- `LivingEntity.damage`'s playerHitTimer/attackingPlayer pair
    // (.decomp LivingEntity.java:1087-1098): the source's ATTACKER (a player's arrow, trident
    // or sweep counts -- `getAttacker()` is the shooter) arms a 100-tick window; a TAMED wolf's
    // bite arms it too, crediting its owner. `Cb.tickEntity` decays it (:416-420); loot, the
    // equipment drop and xp all read `playerHitTimer > 0` at death (:1337, :1352).
    Cb.notePlayerHit(e, byPlayer, src);
    // s135 (Dan: "i dont think anything takes knockback") — `LivingEntity.damage` (.decomp
    // :1100-1136): on a FRESH hit (`$$6`, not the docked bigger-than-last-hit case) with an
    // attacker, `takeKnockback(0.4F, attacker.x - x, attacker.z - z)` — every blow, before any
    // enchant/strength knockback the caller adds. It was only ever in `Cb.hurtZero`.
    if (fresh) Cb.baseKnockback(e, Cb.attackerOf(e, byPlayer, src));
    // LivingEntity.damage emits ENTITY_DAMAGED (8); LivingEntity.onDeath emits ENTITY_KILLED (13) instead on the killing blow
    if (NS.GameEvent) NS.GameEvent.emit(e.health <= 0 ? 'entity_killed' : 'entity_damaged', e.x, e.y, e.z, Cb.attackerOf(e, byPlayer, src) || e);
    // s112 — ZombieEntity.damage's reinforcement call, after super.damage succeeded (07zk_undead.js).
    // (vanilla runs it on the killing blow too — super.damage returned true.)
    if (NS.Undead && NS.Undead.ZOMBIE_FAMILY && NS.Undead.ZOMBIE_FAMILY[e.type]) {
      NS.Undead.onZombieDamaged(e, (src && src.attacker) || (byPlayer ? NS.Player : null));
    }
    if (fresh && NS.Llama && NS.Llama.onDamaged) NS.Llama.onDamaged(e);   // LlamaEntity get{Hurt,Death}Sound (#680)
    // #666 -- LivingEntity.damage: death sound on a fresh killing blow, hurt sound on a fresh survivable one.
    if (fresh && NS.Undead && NS.Undead.playSound) NS.Undead.playSound(e, e.health <= 0 ? 'death' : 'hurt');
    if (fresh && e.type === 'wolf' && NS.Tame && NS.Tame.wolfSound) NS.Tame.wolfSound(e, e.health <= 0 ? 'death' : 'hurt');   // #915
    // EvokerEntity.getHurtSound/getDeathSound: LivingEntity.damage plays hurt on a surviving hit, death on the kill.
    if (e.type === 'evoker' && NS.Spell && NS.Spell.evokerSound && (fresh || e.health <= 0)) {   // hurt only on the fresh branch
      if (e.health > 0) e.ambientSoundChance = -80;
      NS.Spell.evokerSound(e, e.health > 0 ? NS.Spell.EVOKER_SOUND.hurt : NS.Spell.EVOKER_SOUND.death);
    }
    // LivingEntity.damage: getDeathSound on the killing blow, else getHurtSound (ghast: 07zzi_ghast.js)
    if (e.type === 'snow_golem' && (fresh || e.health <= 0) && NS.SnowGolem && NS.SnowGolem.playSound) {
      NS.SnowGolem.playSound(e, e.health <= 0 ? NS.SnowGolem.SOUND.death : NS.SnowGolem.SOUND.hurt);
    }
    if (e.type === 'strider' && fresh && NS.Strider && NS.Strider.onDamaged) NS.Strider.onDamaged(e);   // #935
    if (e.type === 'panda' && fresh && NS.Panda && NS.Panda.playSound) NS.Panda.playSound(e, e.health <= 0 ? NS.Panda.SOUND.death : NS.Panda.SOUND.hurt);
    if (e.type === 'ghast' && fresh && NS.Ghast && NS.Ghast.playDamageSound) NS.Ghast.playDamageSound(e, e.health <= 0);
    if (e.type === 'iron_golem') {
      if (fresh) Cb.golemSound(e, e.health > 0 ? Cb.IRON_GOLEM_SOUND.hurt : Cb.IRON_GOLEM_SOUND.death);
      if (Cb.golemCrack(e) !== crackBefore) Cb.golemSound(e, Cb.IRON_GOLEM_SOUND.damage);   // IronGolemEntity.damage
    }
    // phantom hurt/death: MobVoice.onDamage (once, getSoundPitch)
    // #742 -- every other mob's own hurt/death voice (evoker/ghast/shulker above/below keep theirs)
    if (fresh && NS.MobVoice) NS.MobVoice.onDamage(e, e.health <= 0);   // vanilla: hurt/death sound only on a fresh hit
    if (e.health <= 0 && e.type !== 'evoker' && NS.Survival && NS.Survival.tryUseTotem && NS.Survival.tryUseTotem(e, src)) { /* saved */ }
    if (e.health <= 0) {
      e.health = 0; e.dead = true;
      e.deathSource = src;
      e.deathAttacker = Cb.attackerOf(e, byPlayer, src);   // the killing DamageSource's attacker (Cb.dropLoot)
      // LivingEntity.onDeath -> ServerPlayerEntity.updateKilledAdvancementCriterion -> Criteria.PLAYER_KILLED_ENTITY
      if (NS.Adv && NS.Adv.trigger && NS.Player && e !== NS.Player && (e.deathAttacker === NS.Player || Cb.killedByPlayer(e))) {
        NS.Adv.trigger(NS.Player, 'minecraft:player_killed_entity', { player: NS.Player, entity: e, damage: Object.assign({}, src, { attacker: e.deathAttacker }) });
      }
      // #3501 TameableEntity.onDeath (.decomp:190): a tamed pet's death goes to its owner's chat (showDeathMessages)
      if (e.owner === 'player' && NS.Chat && NS.Survival && NS.Survival.ruleOn('showDeathMessages') && NS.Text) {
        var dk = e.deathAttacker;
        NS.Chat.add(NS.Text.deathMessage(e.name || e.type, dk ? (dk === NS.Player ? 'player' : 'mob') : ((src && src.source) || 'generic'), dk ? (dk.name || dk.type) : null));
      }
      // #2466 ZombieEntity.onKilledOther (.decomp:405-421): a villager a zombie-family mob kills
      // becomes a zombie villager (NORMAL 50% / HARD always); Zv.convertVillagerToZombie gates it.
      if (e.type === 'villager' && e.deathAttacker && NS.Undead && NS.Undead.ZOMBIE_FAMILY[e.deathAttacker.type] &&
          NS.ZVillager && NS.ZVillager.convertVillagerToZombie) {
        NS.ZVillager.convertVillagerToZombie(e, NS.Diff && NS.Diff.value, (NS.EntityList && NS.EntityList.random) || NS.EntityList.wr, e.deathAttacker);
      }
      // QUEUE 0.2 raid loop (loop/raidlive-s93) — the live half of `RaiderEntity.onDeath`
      // (Raid.removeFromWave, wave-cleared/victory/loss's own trigger): a raider `EntityList.
      // spawn`-ed through a live raid carries `e.raidId` (07s_raid.js's `Rd.spawnNextWave`);
      // this is the one place in the engine that entity actually dies. `byPlayer` is Cb.hurt's
      // own arg — the only attacker type this engine's combat can produce (this function's own
      // header, two comments up).
      if (e.raidId !== undefined && NS.RaidManager && NS.RaidManager.world && NS.Raid && NS.Raid.handleRaiderDeath) {
        NS.Raid.handleRaiderDeath(NS.RaidManager.world, e, byPlayer ? 'player' : undefined);
      } else if (e.patrolLeader && e.ominousBanner && NS.Raid && NS.Raid.onPatrolLeaderDeath &&
          NS.Effects && NS.Effects.ready) {
        // QUEUE 0.2 (raid loop remainder, this unit) -- RaiderEntity.onDeath's OWN banner-kill
        // half (`Rd.onPatrolLeaderDeath`, 07s_raid.js): a ROAMING patrol's leader (no `e.raidId`
        // -- the branch above already claims every in-raid death) killed by the player grants a
        // fresh Bad Omen. `07x_patrol.js`'s own PatrolSpawner is the first live thing that ever
        // spawns such a leader -- `Rd.OWED`'s own line named this exact "no live caller" gap.
        NS.Raid.onPatrolLeaderDeath(e, byPlayer ? NS.Player : null, NS.Effects);
      }
    }
    // D-773 shulker teleport-on-hurt (mob-shulker cloud unit) -- `ShulkerEntity.damage()`
    // (.decomp:420-433) the OTHER half of the closed-shulker gate above: once `super.damage()`
    // (this function, above) has actually landed, a shulker under half its OWN max health with
    // a 1-in-4 roll (`random.nextInt(4)==0`) tries a real `Sh.tryTeleport` -- read `e.health`
    // and `e.maxHealth` AFTER the subtraction above (`e.health -= dealt`), the same post-damage
    // value the jar's own `getHealth()` reads at that call site. `spawnNewShulker()`'s own
    // duplication half (:425-427) is the `else if` of that same roll, triggered by a SHULKER
    // BULLET hit (`src.sourceEntity.type === 'shulker_bullet'`, #850), not by evoker fangs.
    if (e.type === 'vex' && NS.Ai && NS.Ai.vexSound) { NS.Ai.vexSound(e, e.dead ? 'death' : 'hurt'); if (!e.dead) e.ambientChance = -80; }   // vex voice is MV.OWN (#4798): hit resets the goal's own ambient counter
    if (e.type === 'shulker' && NS.Shulker && NS.Shulker.playSound) NS.Shulker.playSound(e, e.dead ? 'death' : 'hurt');
    if (e.type === 'shulker' && !e.dead && NS.Shulker && NS.Shulker.ready && NS.Shulker.tryTeleport) {
      var rnd4 = (NS.EntityList && NS.EntityList.random) || NS.EntityList.wr;
      if (e.health < e.maxHealth * 0.5 && Math.floor(rnd4() * 4) === 0) {
        NS.Shulker.tryTeleport(e, rnd4);
      } else if (src && src.projectile && src.sourceEntity && src.sourceEntity.type === 'shulker_bullet' &&
                 NS.Shulker.spawnNewShulker) {
        NS.Shulker.spawnNewShulker(e, rnd4);
      }
    }
    return true;
  };

  /**
   * D-391 — G18b's live wiring. `Cb.hurt` above is the damage MATH and deliberately knows
   * nothing about AI; this is the separate hook that lets a mob's goals react to being hit,
   * called once by every path in this file that lands a real hit (the main swing and each
   * swept target), never from inside `Cb.hurt` itself so a future non-AI caller of `hurt`
   * (a cactus, fall damage) does not have to carry a `byEntity` it does not have.
   *
   * ⚠ WITHOUT THIS, `Ai.PanicGoal` and `Ai.HurtByTargetGoal` were dead code with a live caller:
   * `07k_goals.js` reads exactly these three fields and nothing in the engine ever wrote them —
   * `goalcheck.mjs` only proved the goals correct against a harness that sets the fields BY
   * HAND. That gap is the kind D-276 calls "the bugs live in the JOINS between stages": both
   * sides were right and tested, and the seam between them was simply empty.
   */
  Cb.notifyHurt = function (e, byEntity) {
    if (!e || !byEntity) return;
    // loop/squid-s98 (QUEUE 0.2 G18c) -- `SquidEntity.damage()`'s own `getAttacker() != null`
    // half (the ink squirt): this call site is the engine's one guaranteed-real `byEntity`.
    if (e.type === 'squid' || e.type === 'glow_squid') { if (NS.Squid) NS.Squid.onAttacked(e); }
    // loop/silverfish -- `SilverfishEntity.damage()` (.decomp:98-109): every hit that reaches this
    // call site is an entity-dealt hit (the EntityDamageSource half of that method's gate);
    // attacker-less DamageSource.MAGIC arms it from `Cb.hurt` itself (#854).
    e.justHurt = true;
    e.hurtFromX = byEntity.x;
    e.hurtFromZ = byEntity.z;
    e.lastHurtByEntity = byEntity;
    // ROW 0.2 REMAINDER — `e.hurtSeq`: a plain "this is a NEW landed hit" counter, the
    // closest live analogue this engine has to vanilla's per-tick `getLastAttackedTime()`
    // (07k_goals.js's own `Ai.UniversalAngerGoal`, the only reader). `Village.onHurt` is the
    // villager-hurt/villager-killed gossip trigger (`VillagerEntity.setAttacker`/`notifyDeath`,
    // javap'd — 07l_spawn.js's own `Village` module).
    e.hurtSeq = (e.hurtSeq || 0) + 1;
    e.hurtAge = e.age || 0;   // getLastAttackedTime analogue (RevengeGoal's 100-tick window)
    if (e.type === 'panda') e.sitting = false;   // PandaEntity.damage: setSitting(false)
    // loop/vbpanic -- HurtBySensor's own HURT_BY memory output (.decomp MemoryModuleType
    // .java:50 field_18451, HurtBySensor.java): a villager remembers "I was just hurt" for
    // 40 ticks off `LivingEntity.getRecentDamageSource`'s own decay window
    // (.decomp/net/minecraft/entity/LivingEntity.java:1218-1223), read every VB.tick by
    // src/07zv3_vbpanic.js's PanicTask stand-in. `e.lastHurtByEntity`, set above, already IS
    // the (never-expiring, StopPanickingTask-forgotten) HURT_BY_ENTITY half.
    if (e.type === 'villager') e.vbHurtTick = e.vbAge || 0;
    if (NS.Village && NS.Village.onHurt) NS.Village.onHurt(e, byEntity);
  };

  /** LivingEntity.handleFallDamage: spent in the tick of the landing (Entity.move -> checkFallDamage), and again here for any left over. */
  Cb.spendFall = function (e) {
    if (e.pendingFallDamage) {
      if (NS.MobVoice && NS.MobVoice.onFall) NS.MobVoice.onFall(e, e.pendingFallDamage);   // #960 before the hurt sound, as handleFallDamage
      Cb.hurt(e, e.pendingFallDamage, undefined, false, { bypassArmor: true, source: 'fall' });
      // #1351 -- `HorseBaseEntity.handleFallDamage` hurts every passenger by the same amount.
      if (e.rider && NS.Physics && NS.Physics.HORSE_BASE[e.type] === 1 && NS.Player && NS.Survival && NS.Survival.hurt)
        NS.Survival.hurt(NS.Player, 'fall', e.pendingFallDamage);
      e.pendingFallDamage = 0;
    }
  };

  /**
   * One tick of a living entity's damage bookkeeping — `LivingEntity.baseTick`'s share of it.
   * ⚠ THE DEATH ANIMATION IS TWENTY TICKS and the entity is only removed at its end, which is why
   * a mob you kill falls over rather than vanishing. Nothing draws it yet; the timer is real so
   * that G18 has nothing to add here.
   */
  Cb.DEATH_TICKS = 20;
  // LivingEntity.tickStuckObjects: each counter drops by 1 every 20*(30-count) ticks (timer re-armed when <=0).
  Cb.tickStuckObjects = function (e) {
    var k = ['stuckArrows', 'stingerCount'], t = ['stuckArrowTimer', 'stuckStingerTimer'];
    for (var i = 0; i < 2; i++) {
      var n = e[k[i]] || 0;
      if (n > 0) {
        if (!(e[t[i]] > 0)) e[t[i]] = 20 * (30 - n);
        if (--e[t[i]] <= 0) e[k[i]] = n - 1;
      }
    }
  };

  Cb.tickEntity = function (e) {
    if (!e || e.maxHealth === undefined) return;
    if (e.invulnerableTime > 0) e.invulnerableTime--;
    if (e.hurtTime > 0) e.hurtTime--;
    if (e.attackTicksLeft > 0) e.attackTicksLeft--;   // #730 IronGolemEntity.tickMovement
    Cb.tickStuckObjects(e);
    // QUEUE 0.2 — every status effect this mob carries counts down and, for regeneration/
    // poison/wither, fires on its own vanilla-shaped interval (`07q_effects.js`'s `ES.tick`).
    if (NS.Effects && NS.Effects.tick) NS.Effects.tick(e);
    // D-475 — `ayf.a(ServerLevel,boolean)` (`updatePersistentAnger`, javap'd): the branch that
    // skips the decrement fires when the current target is a PLAYER and the caller's flag is
    // true — the only attacker type `Cb.hurt` can produce today (its own header), so "has a
    // live target" and "that skip branch applies" are the same condition here. Anger only
    // counts down once the target is gone, and simply stops at zero (`ayf.I_`/`Tm.isAngry`
    // read `> 0`, so there is nothing else to clear).
    // #4569 — Angerable.tickAngerLogic(world,true): a NEW non-player target rolls 20-39 s; the timer
    // runs while the target is null OR not a player, and at 0 stopAnger() clears the target.
    var angT = e.target, angMob = e.type === 'polar_bear' || e.type === 'enderman' || e.type === 'wolf' || e.type === 'iron_golem' || e.type === 'bee';
    if (angMob && angT && angT !== NS.Player && angT !== e.angerTargetRef && NS.Ai && NS.Ai.rollAngerTime) {
      e.angerTargetRef = angT; e.angerTime = NS.Ai.rollAngerTime();
    }
    if (e.angerTime > 0 && (!angT || (angMob && angT !== NS.Player))) {
      if (--e.angerTime === 0 && angT) { e.target = null; e.angerTargetRef = null; }
    }
    // PLAN G18f unit 2 (D-479) -- an unemployed villager checks its 8 horizontal
    // neighbours for a workstation every tick (07o_profession.js's own header on why
    // this is adjacency, not vanilla's real POI-search radius).
    // G18f-J1: acquisition is now the Brain's (VB.jobAcquireTick); Prof.tryClaim stays for checks.
    // D-470 — `Entity.baseTick`'s fire half. Fire-immune mobs just decay the counter; everyone
    // else takes `FIRE_DAMAGE_PER_TICK` once every `FIRE_DAMAGE_INTERVAL_TICKS` (skipped while
    // standing in water, vanilla's own `bc()` guard) and counts down by 1 either way.
    // Entity.baseTick: touching water extinguishes (checkWaterState); LivingEntity.baseTick: a fire-immune one is extinguished outright.
    if (e.remainingFireTicks > 0 && NS.Physics && NS.Physics.updateFluids && NS.World && e.type !== 'player') NS.Physics.updateFluids(e);   // baseTick's water check sees THIS tick's fluids
    if (e.remainingFireTicks > 0 && (e.inWater || Cb.fireImmuneOf(e))) e.remainingFireTicks = 0;
    Cb.tickDaylightBurn(e);   // D-511 — Zombie/AbstractSkeleton/Phantom.tickMovement's sun check
    if (e.remainingFireTicks > 0) {
      if (Cb.fireImmuneOf(e)) {
        e.remainingFireTicks -= Cb.FIRE_IMMUNE_DECAY_PER_TICK;
        if (e.remainingFireTicks < 0) e.remainingFireTicks = 0;
      } else {
        if (e.remainingFireTicks % Cb.FIRE_DAMAGE_INTERVAL_TICKS === 0 && !e.inWater) {
          Cb.hurt(e, Cb.FIRE_DAMAGE_PER_TICK, undefined, false, { bypassArmor: true, source: 'onFire' });
        }
        e.remainingFireTicks--;
      }
    }
    e.isOnFire = e.remainingFireTicks > 0 && !Cb.fireImmuneOf(e);
    // KW-34 (s136, referee reds) -- `LivingEntity.checkFallDamage`'s landing already stored the
    // amount in `e.pendingFallDamage` (`Ph.landed`, 14b_physics.js) the SAME WAY it does for the
    // player (`P.pendingFallDamage`, 14_player.js:525), but nothing ever spent it for a mob --
    // `Cb.tickEntity` runs every tick for every entity with a `maxHealth` (the same living-set
    // gate this function is already called under), so this is the mob-side twin of that player
    // line. `bypassArmor:true` matches `Sv.DAMAGE.fall` (14d_survival.js) -- fall damage is not
    // reduced by armour points, only by feather falling/the block's own landing multiplier,
    // both already folded into `Ph.fallDamage` before this ever runs.
    Cb.spendFall(e);
    // G21 -- after the fire half (Entity.baseTick runs first), as in LivingEntity.baseTick.
    // A corpse's drop already happened at death, so the value it reads is the death-time one.
    if (!e.dead) Cb.tickPlayerHit(e);
    // #1294 ZombifiedPiglinEntity.mobTick: hasAngerTime() => playerHitTimer = age (loot/xp count as player-kill while angry).
    if (!e.dead && e.type === 'zombified_piglin' && e.angerTime > 0) e.playerHitTimer = Math.max(1, e.age | 0);
    // D-550 -- `HorseBaseEntity.tick`'s angryTicks countdown (07r_mount.js), every mountable.
    if (NS.Mount && NS.Mount.ready && NS.Mount.isMountable(e)) {
      NS.Mount.tickAnger(e);
      if (!e.dead) {
        NS.Mount.tick(e);
        NS.Mount.tickMovement(e, null, function () { var W = NS.World, R = NS.Reg, S = NS.States; return !!(W && W.getBlock && R && R.id && S && S.block && S.block[W.getBlock(Math.floor(e.x), Math.floor(e.y) - 1, Math.floor(e.z))] === R.id.grass_block); });
      }
    }
    if (e.dead) {
      if (!e.lootDropped) { Cb.dropLoot(e); Cb.dropCarried(e); e.lootDropped = true; }
      e.deathTime++;
      if (e.deathTime >= Cb.DEATH_TICKS && NS.EntityList) NS.EntityList.remove(e);
    }
  };

  /**
   * G18d — `LivingEntity.dropFromLootTable`, the moment a mob actually gives up its items. Runs
   * once, on the FIRST tick of the death animation (`e.lootDropped` guards it, not the removal
   * at the end of `Cb.DEATH_TICKS`) — vanilla drops on death, not on despawn twenty ticks later,
   * and a check watching for the item entity to exist would see nothing for most of a second if
   * this waited. Experience is G21's `Xp.dropMobXp` (07zz_xporb.js), called at this same tick,
   * below — `Cb.OWED`'s own "experience on death" line is struck for it.
   */
  /** `EnchantmentHelper.getLooting(entity)` = `getEquipmentLevel(LOOTING, entity)`: Looting's own
   *  slot list is MAINHAND only, so it is the killer's mainhand stack's level (player: the selected
   *  hotbar slot; mob: `e.equip[MAINHAND]`). 0 for no killer / a non-living one. */
  Cb.lootingOf = function (a) {
    if (!a) return 0;
    var Iv = NS.Inventory, Eq = NS.Equip, IT = NS.Items, st = null;
    if (a.inventory && Iv && Iv.getItem) st = Iv.getItem(a.inventory, a.slot | 0);
    else if (Eq && Eq.getEquipped && IT) st = Eq.getEquipped(a, IT.MAINHAND);
    return st ? Cb.enchantLevel(st, 'looting') : 0;
  };
  /** `getLootTableId()` below `entities/`: the type's own table, except SheepEntity.java:147-185 --
   *  an UNSHEARED sheep rolls `sheep/<its colour>` (the wool pool plus a `loot_table` entry back
   *  to `entities/sheep`); a sheared one the plain type table. */
  Cb.lootTableIdOf = function (e) {
    if (e && e.type === 'sheep' && !e.sheared) return 'sheep/' + (e.woolColor || 'white');
    return e ? e.type : undefined;
  };
  /** `EndermanEntity.dropEquipment`: the carried block drops at the moment of death, gated on doMobLoot. */
  Cb.dropCarried = function (e) {
    var c = e.carriedBlock;
    e.carriedBlock = null;
    if (e.type !== 'enderman' || c == null || !NS.States || !NS.Reg || !NS.EntityList) return;
    if (NS.Breed && NS.Breed.mobLoot && !NS.Breed.mobLoot()) return;
    var name = NS.Reg.names && NS.Reg.names[NS.States.block[c]];
    if (name) NS.EntityList.dropStack(e.x, e.y, e.z, name, 1);
  };
  Cb.dropLoot = function (e) {
    var L = NS.Loot, EL = NS.EntityList, Items = NS.Items;
    if (!L || !L.ready || !EL || !EL.ready || !e || !e.type) return;
    // loop/slime-s97 -- `SlimeEntity.getLootTableId()` (.decomp): `LootTables.EMPTY` for every
    // size but 1 -- a size>1 slime SPLITS instead of dropping (`EL.remove`'s own `Sl.split`
    // hook, 07i_entitylist.js); only the size-1 "small" slime the split bottoms out at ever
    // reaches the real `entities/slime` table (`tools/pack-loot.mjs`'s own D-381 packing).
    // ⚠ KW-34 (s136, referee reds, .infra finding 4): this used to `return` HERE, which also
    // skipped `dropEquipment`/`dropInventory`/`Xp.dropMobXp` below for every size>1 slime and
    // magma_cube -- but `LivingEntity.drop` (.decomp:1328-1345) runs `dropXp` UNCONDITIONALLY,
    // regardless of whether the loot table itself was empty (`Sl.setSize`, 07zd_slime.js, already
    // sets `e.experiencePoints = size` for exactly this reason -- it just never got read). Only
    // the LOOT TABLE half is skipped now; equipment/inventory/xp all still run past this point.
    // MagmaCubeEntity.getLootTableId is the INVERSE: EMPTY when isSmall() (size<=1), its table otherwise.
    var slimeNoLoot = e.type === 'slime' ? (e.size || 1) > 1 : e.type === 'magma_cube' && (e.size || 1) <= 1;
    // referee-looting (lootingrefcheck): the loot context's LOOTING comes off KILLER_ENTITY
    // (`source.getAttacker()`, any living attacker: RandomChanceWithLootingLootCondition /
    // LootingEnchantLootFunction both call `EnchantmentHelper.getLooting(killer)`), while
    // `drop()`'s own level for dropEquipment is a PLAYER attacker's only (.decomp LivingEntity:1329-1335).
    var atk = e.deathAttacker || null;
    var killerLooting = atk ? Cb.lootingOf(atk) : 0;
    var drops = slimeNoLoot ? [] : L.entityDrops({
      type: e.type,
      table: Cb.lootTableId(e),
      killedByPlayer: Cb.killedByPlayer(e),
      killer: (atk && atk !== NS.Player && atk.type) ? { type: atk.type } : Cb.killedByPlayer(e) ? { type: 'player' } : undefined,
      isOnFire: !!e.isOnFire,
      damageSource: { is_lightning: !!(e.deathSource && e.deathSource.source === 'lightningBolt') },   // #3606
      looting: killerLooting    });
    for (var i = 0; i < drops.length; i++) {
      var idx = Items && Items.of ? Items.of(drops[i].item) : -1;
      if (!(idx >= 0) || !(drops[i].count > 0)) continue;
      EL.dropStack(e.x, e.y, e.z, idx, drops[i].count);
    }
    // #749 -- `ZombieEntity/SkeletonEntity/WitherSkeletonEntity/CreeperEntity.dropEquipment`: a CHARGED
    // creeper attacker that has not yet dropped a head (`shouldDropHead`: charged && headsDropped < 1)
    // makes the victim drop its head and marks the creeper (`onHeadDropped`). 1.18.2 has no piglin head.
    // Drowned/Husk/ZombieVillager/ZombifiedPiglin getSkull() are ItemStack.EMPTY: no head, no quota use.
    if (atk && atk.type === 'creeper' && atk.charged && !(atk.headsDropped >= 1) && atk !== e) {
      var HEAD = { zombie: 'zombie_head', skeleton: 'skeleton_skull',
        wither_skeleton: 'wither_skeleton_skull', creeper: 'creeper_head' }[e.type];
      var hidx = HEAD && Items && Items.of ? Items.of(HEAD) : -1;
      if (hidx >= 0) {
        atk.headsDropped = (atk.headsDropped || 0) + 1;
        EL.dropStack(e.x, e.y, e.z, hidx, 1);
      }
    }
    // D-517 -- `MobEntity.dropEquipment`: the mainhand/offhand/armour a mob was actually
    // WEARING (07y_equip.js), a separate roll from the loot table drops just above.
    if (NS.Equip && NS.Equip.ready) {
      var eqDrops = NS.Equip.dropEquipment(e, undefined, Cb.recentlyHitByPlayer(e), atk && atk === NS.Player ? killerLooting : 0);
      for (var j = 0; j < eqDrops.length; j++) {
        var eidx = Items && Items.of ? Items.of(eqDrops[j].item) : -1;
        if (!(eidx >= 0) || !(eqDrops[j].count > 0)) continue;
        EL.dropStack(e.x, e.y, e.z, eidx, eqDrops[j].count, { tag: eqDrops[j].tag, d: eqDrops[j].d });
      }
    }
    // D-550 -- `LivingEntity.drop`'s `dropInventory()` (.decomp 1343), called OUTSIDE the
    // loot gate: a mount's saddle/armour/carpet/chest contents + chest (Mount.dropInventory,
    // 07r) and a pig's saddle (Passive.dropInventory, 07w).
    var inv = [];
    if (NS.Mount && NS.Mount.ready && NS.Mount.isMountable(e)) inv = inv.concat(NS.Mount.dropInventory(e));
    if (NS.Passive && NS.Passive.dropInventory) inv = inv.concat(NS.Passive.dropInventory(e));
    if (NS.Piglin && NS.Piglin.dropInventory) inv = inv.concat(NS.Piglin.dropInventory(e));   // #3905
    if (NS.Strider && NS.Strider.dropInventory) inv = inv.concat(NS.Strider.dropInventory(e));   // s135 (KW-33)
    for (var k = 0; k < inv.length; k++) {
      var iidx = Items && Items.of ? Items.of(inv[k].item) : -1;
      if (!(iidx >= 0) || !(inv[k].count > 0)) continue;
      EL.dropStack(e.x, e.y, e.z, iidx, inv[k].count);
    }
    // #940 -- `WitherEntity.dropEquipment` (.decomp:476-481): one nether star, then
    // `ItemEntity.setCovetedItem()` (`itemAge = -6000`, i.e. twice the normal lifetime).
    if (e.type === 'wither' && Items && Items.of) {
      var nsIdx = Items.of('nether_star');
      if (nsIdx >= 0) {
        var star = EL.dropStack(e.x, e.y, e.z, nsIdx, 1);
        if (star) star.age = -6000;
      }
    }
    // G21 -- `LivingEntity.dropXp` (.decomp:1350-1355), the SAME first-tick-of-death slot
    // (`Mob.onDeath` calls `dropLoot`/`dropInventory`/`dropXp` back to back) this function
    // already closes the first two of. `Xp.dropMobXp` (07zz_xporb.js) owns the amount and the
    // gates (playerHitTimer/shouldDropXp/doMobLoot); this is only the dispatch.
    if (NS.Xp && NS.Xp.ready) NS.Xp.dropMobXp(e);
  };

  /**
   * The entity a ray hits first, or null — `ProjectileUtil.getEntityHitResult`.
   *
   * ⚠ EACH CANDIDATE'S BOX IS EXPANDED BY `Cb.targetingMargin` (0 for ordinary entities, 1.0 for
   * the ExplosiveProjectileEntity family -- what makes deflecting a ghast fireball feasible).
   * ⚠ IT RETURNS THE NEAREST, not the first found: the list is in spawn order and a mob behind
   * another would otherwise win whenever it happened to be earlier.
   */
  /** #2708 -- a live ender_dragon is hit-tested part by part (`EnderDragonPart` boxes, 8 of them), never as
   * one 16x8 box. Returns the nearest part's entry t (null = miss) and leaves that part on `e.hitPart`
   * for `Cb.hurt` to route through `EnderDragonEntity.damagePart`. */
  Cb.dragonPartT = function (e, ox, oy, oz, dx, dy, dz, IN) {
    var best = null, bestT = Infinity, ps = e.dragon.parts;
    for (var i = 0; i < ps.length; i++) {
      var b = ps[i].getBox(IN);
      var t = Cb.rayBox(ox, oy, oz, dx, dy, dz, b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ);
      if (t !== null && t < bestT) { bestT = t; best = ps[i]; }
    }
    e.hitPart = best;
    return best ? bestT : null;
  };

  Cb.pick = function (ox, oy, oz, dx, dy, dz, reach) {
    var EL = NS.EntityList;
    if (!EL || !EL.ready || !EL.list) return null;
    var best = null, bestT = reach;
    for (var i = 0; i < EL.list.length; i++) {
      var e = EL.list[i];
      if (e.removed || !Cb.canAttack(e)) continue;
      var IN = Cb.targetingMargin(e);
      var hw = e.width * 0.5 + IN;
      var t = (e.type === 'ender_dragon' && e.dragon) ? Cb.dragonPartT(e, ox, oy, oz, dx, dy, dz, IN) :
              Cb.rayBox(ox, oy, oz, dx, dy, dz,
                        e.x - hw, e.y - IN, e.z - hw,
                        e.x + hw, e.y + e.height + IN, e.z + hw);
      if (t === null || t > bestT) continue;
      bestT = t; best = e;
    }
    return best ? { entity: best, t: bestT } : null;
  };

  /**
   * Slab method: the ray's entry distance into an axis-aligned box, or null.
   * ⚠ A RAY THAT STARTS INSIDE THE BOX HITS AT ZERO, which is what lets a mob standing on the
   * player be attacked. Returning null there would make point-blank swings miss.
   */
  Cb.rayBox = function (ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
    var tmin = 0, tmax = Infinity;
    var o = [ox, oy, oz], d = [dx, dy, dz], lo = [x0, y0, z0], hi = [x1, y1, z1];
    for (var a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-12) {
        if (o[a] < lo[a] || o[a] > hi[a]) return null;
        continue;
      }
      var inv = 1 / d[a];
      var t1 = (lo[a] - o[a]) * inv, t2 = (hi[a] - o[a]) * inv;
      if (t1 > t2) { var s = t1; t1 = t2; t2 = s; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
    return tmin;
  };

  /**
   * D-658 — the particles of a LANDED `Player.attack` (PlayerEntity.java:1163-1239, in its own
   * order): the sweep (`spawnSweepAttackParticles`), a CRIT emitter on the target
   * (`addCritParticles` -> `particleManager.addEmitter(target, CRIT)`), an ENCHANTED_HIT emitter
   * when the enchantment bonus (already *h) is above 0, then — when the target lost more than 2
   * health — `(int)(lost*0.5)` DAMAGE_INDICATORs. Returns what it asked for, for the checks.
   */
  Cb.attackParticles = function (P, e, sweep, crit, f1, lost, rand) {
    var Px = NS.Particle, out = { sweep: 0, crit: 0, enchanted: 0, indicators: 0 };
    if (!Px || !Px.spawn) return out;
    if (sweep && Px.spawnSweep(P, rand)) out.sweep = 1;
    if (crit && Px.addEmitter(e, 'crit', undefined, rand)) out.crit = 1;
    if (f1 > 0 && Px.addEmitter(e, 'enchanted_hit', undefined, rand)) out.enchanted = 1;
    out.indicators = Px.spawnDamageIndicators(e, lost, rand);
    return out;
  };

  /** `Player.attack`'s six `world.playSound(null, x, y, z, ATTACK_*, getSoundCategory(), 1, 1)`
   *  calls (PLAYERS source, volume and pitch 1). `name` is the suffix after `entity.player.attack.`. */
  Cb.attackSound = function (P, name) {
    var ev = 'entity.player.attack.' + name;
    if (NS.Sound && NS.Sound.play) NS.Sound.play(ev, { x: P.x, y: P.y, z: P.z, volume: 1, pitch: 1, source: 'player' });
    return ev;
  };

  /**
   * `Player.attack(entity)`, transcribed.
   *
   * The order matters and is vanilla's: scale the damage by the cooldown ramp FIRST, then decide
   * whether this was a full-strength hit, then the crit, then the sweep. Doing the ramp last
   * would make a crit on a half-charged swing worth more than a full one.
   *
   * ⚠ A CRIT AND A SPRINT-KNOCKBACK ARE MUTUALLY EXCLUSIVE, which is the rule everybody who has
   * played knows as "stop sprinting to crit" without knowing it is one boolean.
   */
  Cb.attack = function (P, e, opts) {
    if (!P || !Cb.canAttack(e)) return null;
    var H = NS.Hand, Iv = NS.Inventory;
    var held = (Iv && P.inventory) ? Iv.getItem(P.inventory, P.slot) : null;
    // attack_damage / attack_speed come from the attribute map, which lags a same-tick hotbar switch (pcoolrefcheck switch_same_tick)
    var attrHeld = P.attrStack !== undefined ? P.attrStack : held;
    var base = H ? H.attackDamageFor(attrHeld) : 1.0;
    // QUEUE 0.2 — Strength/Weakness (`DamageModifierStatusEffect.adjustModifierAmount`) sit on
    // `generic.attack_damage` itself in vanilla, so they must be folded into `base` BEFORE the
    // cooldown ramp below multiplies it — not added afterward like the enchantment bonus `f1`.
    if (NS.Effects && NS.Effects.attackDamageBonus) base = NS.Effects.attackDamageBonus(P, base);
    var h = H ? H.attackStrengthScale(attrHeld, 0.5) : 1.0;
    // D-461: the enchantment bonus `f1` is scaled by h (NOT h*h) and added AFTER the crit.
    var f1 = Cb.damageBonus(held, Cb.mobTypeOf(e));
    var f = base * (Cb.RAMP_BASE + h * h * Cb.RAMP_SCALE);
    f1 *= h;
    if (H && H.resetAttackStrength) H.resetAttackStrength();
    if (!(f > 0 || f1 > 0)) return null;

    var full = h > Cb.FULL_STRENGTH;
    var sprinting = !!P.sprinting;
    var kb = Cb.enchantLevel(held, 'knockback');   // `getKnockbackBonus`, mainhand
    var sprintKnock = false;
    var sounds = [];
    if (sprinting && full) { kb++; sprintKnock = true; sounds.push(Cb.attackSound(P, 'knockback')); }

    // ⚠ A CRIT NEEDS EVERY ONE OF THESE, and `!sprinting` is the one people find surprising.
    // QUEUE 0.2 — `!this.hasStatusEffect(StatusEffects.BLINDNESS)` is the sixth, `Player.attack`'s
    // own condition (`ES.suppressesCrit`, 07q_effects.js).
    var crit = full && P.fallDistance > 0 && !P.onGround && !P.onClimbable &&
               !P.inWater && !sprinting && !(NS.Effects && NS.Effects.suppressesCrit(P));
    if (crit) f *= Cb.CRIT_MULTIPLIER;
    f += f1;

    // ⚠ THE SWEEP IS A STANDING, FULL-STRENGTH, NON-CRIT SWORD BLOW AND NOTHING ELSE.
    var sword = !!(H && H.isSword && H.isSword(held));
    var moved = (P.walkDist || 0) - (P.walkDistO || 0);
    var sweep = full && !crit && !sprintKnock && P.onGround && sword &&
                moved < (P.speed === undefined ? 0.1 : P.speed);

    var yaw = P.yaw || 0;
    // ⚠ THE ENGINE'S YAW IS 0 AT NORTH AND VANILLA'S AT SOUTH (D-327), so the knockback direction
    // is `(sin yaw, -cos yaw)` here where vanilla writes `(sin yaw, -cos yaw)` in its own frame.
    var kdx = Math.sin(yaw), kdz = -Math.cos(yaw);

    // D-470: the pre-ignite poke happens BEFORE we even know if the hit lands, and does not
    // wait on `Cb.hurt` — a target that merely gets swung at, hit or not, still gets 1 second of
    // fire from a Fire Aspect weapon, as long as it is not fire-immune (vanilla's own bytecode).
    var fireLvl = Cb.enchantLevel(held, 'fire_aspect');
    if (fireLvl > 0 && !Cb.fireImmuneOf(e)) Cb.igniteForSeconds(e, Cb.FIRE_ASPECT_PRE_IGNITE_SECONDS);

    var hp0 = e.health;                  // `$$12 = target.getHealth()`, read before the blow
    var hit = Cb.hurt(e, f, undefined, true);
    if (hit) Cb.notifyHurt(e, P);
    // QUEUE 0.2 — `EnchantmentHelper.onUserDamaged`/`ThornsEnchantment`: the DEFENDER's own
    // armor answers back at the attacker. `e` (the mob just hit) has no inventory in this
    // engine (no mob-armor model — `ES.thornsOnUserDamaged`'s own header), so this is live only
    // the day a defender with one calls `Cb.attack`'s twin, `Cb.mobAttack`, below.
    if (hit && NS.Effects && NS.Effects.thornsOnUserDamaged) NS.Effects.thornsOnUserDamaged(e, P);
    // D-477 — the OWNER half of `Ai.OwnerHurtTargetGoal` (`bfq`, javap'd): the player's own
    // `getLastHurtMob()`, same idiom.
    if (hit) P.lastHurtMob = e;
    var result = { damage: f, crit: crit, sweep: false, full: full, knockback: kb, hit: hit,
                   swept: [], killed: !!e.dead };
    result.sounds = sounds;
    if (!hit) { sounds.push(Cb.attackSound(P, 'nodamage')); return result; }
    // D-470: the real duration only lands once the hit actually connects.
    if (fireLvl > 0) Cb.igniteForSeconds(e, fireLvl * Cb.FIRE_ASPECT_SECONDS_PER_LEVEL);

    if (kb > 0) {
      Cb.knockback(e, kb * Cb.KNOCKBACK_PER_LEVEL, kdx, kdz);
      P.vx *= Cb.ATTACKER_SLOWDOWN; P.vz *= Cb.ATTACKER_SLOWDOWN;
      P.sprinting = false;
    }
    if (sweep) {
      result.sweep = true;
      var f3 = Cb.SWEEP_BASE_DAMAGE + Cb.sweepRatio(held) * f;
      result.sweepDamage = f3;
      var EL = NS.EntityList;
      var IN = Cb.SWEEP_INFLATE;
      var hw = e.width * 0.5;
      var x0 = e.x - hw - IN[0], x1 = e.x + hw + IN[0];
      var y0 = e.y - IN[1], y1 = e.y + e.height + IN[1];
      var z0 = e.z - hw - IN[2], z1 = e.z + hw + IN[2];
      for (var i = 0; EL && EL.list && i < EL.list.length; i++) {
        var o = EL.list[i];
        if (o === e || !Cb.canAttack(o)) continue;
        var ohw = o.width * 0.5;
        if (o.x + ohw < x0 || o.x - ohw > x1) continue;
        if (o.y + o.height < y0 || o.y > y1) continue;
        if (o.z + ohw < z0 || o.z - ohw > z1) continue;
        // feet to feet, strictly below 9 — `distanceToSqr(Entity) < 9.0` (D-461)
        var ddx = o.x - P.x, ddy = o.y - P.y, ddz = o.z - P.z;
        if (!(ddx * ddx + ddy * ddy + ddz * ddz < Cb.SWEEP_RANGE_SQ)) continue;
        Cb.knockback(o, Cb.SWEEP_KNOCKBACK, kdx, kdz);
        // #670: the swinger is the attacker, so a swept zombie rolls reinforcements too.
        if (Cb.hurt(o, f3, undefined, true, { attacker: P })) { Cb.notifyHurt(o, P); result.swept.push(o); P.lastHurtMob = o; }
      }
    }
    if (sweep) sounds.push(Cb.attackSound(P, 'sweep'));
    if (crit) sounds.push(Cb.attackSound(P, 'crit'));
    if (!crit && !sweep) sounds.push(Cb.attackSound(P, full ? 'strong' : 'weak'));
    result.killed = !!e.dead;
    result.particles = Cb.attackParticles(P, e, sweep, crit, f1, hp0 - Math.max(0, e.health || 0),
                                          opts && opts.rand);
    // ⚠ `Survival.addExhaustion` TAKES THE ENTITY, because the survival model is written against
    // one rather than against a global player — the same shape that made D-308 findable.
    if (NS.Survival && NS.Survival.addExhaustion) NS.Survival.addExhaustion(P, Cb.ATTACK_EXHAUSTION);
    return result;
  };

  /**
   * `Mob.doHurtTarget(target)`, transcribed (D-394, PLAN G18b's remaining `Ai.OWED` row). The
   * OTHER direction of combat: a mob's own goal-driven strike, called from
   * `Ai.MeleeAttackGoal.tick()` once a target is inside `Ai.attackReachSqr` and its per-goal
   * cooldown has elapsed — never from inside `Cb.hurt`, same reasoning as `Cb.notifyHurt`'s own
   * header: a future non-goal caller (a cactus hurting a mob) must not inherit a swing.
   *
   * ⚠ ONLY `NS.Player` IS ROSTERED AS A TARGET TODAY (`EL.aiCtx.players` returns `[NS.Player]`
   * and only `zombie` carries `NearestAttackableTargetGoal`/`HurtByTargetGoal`) — mob-vs-mob
   * combat is unbuilt, so the player branch below is exercised and the `Cb.hurt` branch is
   * dead code kept for the day a hostile can target another entity, matching this file's own
   * `EL`-guard idiom elsewhere rather than deleting a branch that would otherwise be silently
   * wrong the day it starts running.
   * ⚠ ATTACK KNOCKBACK is vanilla's own `ATTACK_KNOCKBACK` attribute, which neither `cow` nor
   * `zombie` declares (D-336's golden table has no such column for either) — 0 here is that
   * mob's own row, not a guess, and is named on `Ai.OWED` for the day a rostered mob needs it.
   */
  // IronGolemEntity SoundEvents (.decomp IronGolemEntity.java): attack (tryAttack + status 4), hurt/death
  // (getHurtSound/getDeathSound), damage (Crack level changed in damage()). Entity default category: neutral.
  Cb.IRON_GOLEM_SOUND = { attack: 'entity.iron_golem.attack', hurt: 'entity.iron_golem.hurt',
    death: 'entity.iron_golem.death', damage: 'entity.iron_golem.damage' };
  Cb.golemSound = function (e, ev) {
    var MV = NS.MobVoice;
    if (!NS.Sound || !NS.Sound.play || e.silent || (MV && MV.GATED && !MV.AUDITED[e.type])) return false;   // #4003: silent until audited
    return NS.Sound.play(ev, { x: e.x, y: e.y, z: e.z, volume: 1, pitch: ev === Cb.IRON_GOLEM_SOUND.attack || ev === Cb.IRON_GOLEM_SOUND.damage ? 1 : (NS.EntityList.wr() - NS.EntityList.wr()) * 0.2 + 1, source: 'neutral' });
  };
  /** `IronGolemEntity.Crack.from(health / maxHealth)`: index of the first fraction (0.25/0.5/0.75/1) the ratio is under. */
  Cb.golemCrack = function (e) {
    var r = e.health / e.maxHealth;
    return r < 0.25 ? 0 : r < 0.5 ? 1 : r < 0.75 ? 2 : 3;
  };
  Cb.IRON_GOLEM_THROW_VY = Math.fround(0.4);   // IronGolemEntity.tryAttack: getVelocity().add(0, 0.4F, 0)
  Cb.WITHER_SKELETON_HIT_TICKS = 200;   // WitherSkeletonEntity.tryAttack: new StatusEffectInstance(WITHER, 200)
  Cb.mobAttack = function (e, target) {
    if (!e || !target) return null;
    if (e.type === 'creeper') return null;   // CreeperEntity.tryAttack() { return true; }: the swing never damages or knocks back
    var Ent = NS.Entities;
    var at = Ent && Ent.attrsOf ? Ent.attrsOf(e.type) : null;
    // loop/mobdefaults (referee finding a) — `e.attackDamage` is a PER-INSTANCE override (today
    // only `wolf`, 07i_entitylist.js's `EL.DEFAULTS.wolf`: `WolfEntity`'s own constructor
    // overwrites `createWolfAttributes`' 2.0 base to 4.0 via `setTamed(false)`, .decomp
    // WolfEntity.java:90,330-331) — it wins over the generic per-type table the same way a
    // mount's own `e.maxHealthAttr` already wins over `Entities.attrsOf(...).hp` (07i_entitylist
    // .js, Mnt.rollAttributes' own header) — the table is each type's CONSTRUCTOR-BUILDER base,
    // not necessarily what the constructor leaves it at.
    var dmg = e.attackDamage !== undefined ? e.attackDamage : (at ? at.dmg : 0);
    if (!(dmg > 0)) return null;         // no ATTACK_DAMAGE attribute -> vanilla never lands one
    // D-462: `Mob.doHurtTarget`'s `f1 = getAttributeValue(ATTACK_KNOCKBACK)` — jar-extracted
    // (entity-attributes-1.18.2.tsv): 0 for nearly every mob, 1 hoglin/zoglin, 1.5 ravager.
    // (`+ EnchantmentHelper.getKnockback(this)`: the held-item block below.)
    var kb = at && at.atkKb > 0 ? at.atkKb : 0;
    // s134 -- `HoglinEntity/ZoglinEntity.tryAttack` REPLACE Mob.tryAttack with `Hoglin.tryAttack`
    // (.decomp Hoglin.java): amount = adult ? a/2 + nextInt((int)a) : a, and the push is
    // `Hoglin.knockback` (07zzg_hoglin.js), not the ATTACK_KNOCKBACK strike below.
    var Hgl = NS.Hoglin, hog = !!(Hgl && Hgl.TYPES && Hgl.TYPES[e.type]);
    if (hog) { dmg = Hgl.attackAmount(e, target); kb = 0; }
    // kbrefcheck (cloud, referee-mob-melee) -- `IronGolemEntity.tryAttack` REPLACES Mob.tryAttack
    // too (.decomp IronGolemEntity.java:205-218): amount = (int)a > 0 ? a/2 + nextInt((int)a) : a,
    // no ATTACK_KNOCKBACK strike, and a landed hit ADDS 0.4F to the target's vy (below).
    var golem = e.type === 'iron_golem';
    if (golem) {
      e.attackTicksLeft = 10;   // #730: IronGolemEntity.tryAttack (status 4) -- the renderer's arm-raise timer
      var gn = dmg | 0, grnd = (NS.EntityList && NS.EntityList.random) || NS.EntityList.wr;
      if (gn > 0) dmg = dmg / 2 + Math.floor(grnd() * gn);
      kb = 0;
    }
    // #4541: `PolarBearEntity.tryAttack` REPLACES it too: damage = (float)(int)ATTACK_DAMAGE, no hand, no knockback.
    var polar = e.type === 'polar_bear';
    if (polar) { dmg = dmg | 0; kb = 0; }
    // `MobEntity.tryAttack` (.decomp MobEntity.java:1315-1326, which hoglin/zoglin/iron_golem
    // REPLACE rather than extend -- kbrefcheck/meleerefcheck cloud referee-mob-melee, this unit's
    // own `!hog && !golem` guard below): ATTACK_DAMAGE is the attribute WITH the held item's
    // mainhand modifier (a zombie with an iron sword hits 3 + 5 = 8 -- meleerefcheck
    // zombie_sword), plus the weapon's `getAttackDamage(stack, target group)` (sharpness/smite/
    // bane) and `getKnockback`; a Fire Aspect weapon sets the target alight for level*4 s BEFORE
    // the damage call.
    var held = NS.Equip && NS.Equip.getEquipped && NS.Items ? NS.Equip.getEquipped(e, NS.Items.MAINHAND) : null;
    var Hd = NS.Hand, fireLvl = 0;
    if (held && !hog && !golem && !polar && NS.Inventory && !NS.Inventory.isEmpty(held)) {   // hoglin/golem tryAttack never read the hand
      var ha = Hd && Hd.attrsFor ? Hd.attrsFor(held) : null;
      if (ha) dmg += ha[0] - Hd.BASE_ATTACK_DAMAGE;       // DATA.itemAttrs holds the final value: 1 + modifier
      dmg += Cb.damageBonus(held, target === NS.Player ? 'undefined' : Cb.mobTypeOf(target));
      kb += Cb.enchantLevel(held, 'knockback');
      fireLvl = Cb.enchantLevel(held, 'fire_aspect');
    }
    if (fireLvl > 0 && Cb.igniteForSeconds) Cb.igniteForSeconds(target, fireLvl * Cb.FIRE_ASPECT_SECONDS_PER_LEVEL);
    var hit;
    if (golem) Cb.golemSound(e, Cb.IRON_GOLEM_SOUND.attack);   // tryAttack plays it hit or miss
    if (target === NS.Player) {
      var Sv = NS.Survival;
      if (!Sv || !Sv.hurt) return null;
      hit = Sv.hurt(target, 'mob', dmg, e);
      if (hit) {
        var T = NS.Text;
        target.killedBy = T && T.plain ? T.plain(T.translatable('entity.minecraft.' + e.type, [])) : e.type;
        // D-477 — the OWNER half of `Ai.OwnerHurtByTargetGoal` (`bfp`, javap'd): the player's
        // own `getLastHurtByMob()`, the same "set on the event" idiom `Cb.notifyHurt` already
        // writes for a mob (this file's header: one attacker type per hit, today).
        target.lastHurtByEntity = e;
        // QUEUE 0.2 — the PLAYER is this engine's only defender with armor to read Thorns off
        // (`ES.thornsOnUserDamaged`'s own header); a mob's own strike is the live path for it.
        if (NS.Effects && NS.Effects.thornsOnUserDamaged) NS.Effects.thornsOnUserDamaged(target, e);
      }
    } else {
      hit = Cb.hurt(target, dmg, undefined, false, { attacker: e });
      if (hit) Cb.notifyHurt(target, e);
    }
    if (hit && kb > 0) {
      // ⚠ `e.yaw` IS THIS ENGINE'S YAW IN RADIANS (D-415) — no degree conversion. Vanilla's
      // `knockback(0.5, sin(yRot deg), -cos(yRot deg))` passes the NEGATED heading, because
      // `knockback` subtracts it; this engine's forward is `(sin y, -cos y)`, so the negated
      // heading here is `(-sin y, cos y)`. Written as MC degrees it pushed the target along an
      // angle 180-out-of-phase with the attacker's own facing, scaled by 57.
      var yaw = e.yaw || 0;
      Cb.knockback(target, kb * 0.5, -Math.sin(yaw), Math.cos(yaw));
      // ...and the ATTACKER is slowed: `setDeltaMovement(getDeltaMovement().multiply(0.6, 1, 0.6))`
      // — inside the same `f1 > 0` branch, so a zero-knockback mob keeps its speed (D-462).
      e.vx = (e.vx || 0) * Cb.MOB_STRIKE_SLOW;
      e.vz = (e.vz || 0) * Cb.MOB_STRIKE_SLOW;
    }
    if (hit && hog) Hgl.knockback(e, target);
    if (hit && golem) target.vy = (target.vy || 0) + Cb.IRON_GOLEM_THROW_VY;
    // loop/zombievariants-s100 (QUEUE 0.2 G18c) -- `HuskEntity.tryAttack` (.decomp, read
    // whole): an unarmed husk that lands a hit also applies Hunger to the target -- named,
    // real consequence, 07zk_undead.js's own `Undead.onHuskHit`.
    if (hit && NS.Undead && NS.Undead.onHuskHit) NS.Undead.onHuskHit(e, target);
    // loop/spawner-s114 (G18c) -- `CaveSpiderEntity.tryAttack` (.decomp): the SAME
    // landed-hit slot as husk's own Hunger hook above, this one applying Poison
    // (07zs_spawner.js's own `CaveSpider.onHit`).
    if (hit && NS.CaveSpider && NS.CaveSpider.onHit) NS.CaveSpider.onHit(e, target);
    // D-673 -- `WitherSkeletonEntity.tryAttack` (.decomp:82-91): a landed hit on a LivingEntity
    // adds Wither (`StatusEffects.field_5920`) for 200 ticks, amplifier 0, source = the skeleton.
    if (hit && e.type === 'wither_skeleton' && NS.Effects && NS.Effects.addStatusEffect) {
      NS.Effects.addStatusEffect(target, 'wither', Cb.WITHER_SKELETON_HIT_TICKS, 0, false, true);
    }
    // #667 -- `ZombieEntity.tryAttack` (.decomp:330-340): after a landed hit, an empty-handed BURNING
    // zombie-family mob sets the target alight for 2*(int)localDifficulty seconds, at chance localDifficulty*0.3.
    if (hit && Cb.ZOMBIE_FIRE_TYPES[e.type] && e.isOnFire && NS.Equip && NS.Equip.localDifficulty) {
      var Eqz = NS.Equip, ITz = NS.Items;
      var ldz = Math.fround(Eqz.localDifficulty(Eqz.at ? Eqz.at(e) : undefined));
      var zr = (NS.EntityList && NS.EntityList.random) || NS.EntityList.wr;
      if (!(Eqz.getEquipped(e, ITz.MAINHAND)) && Math.fround(zr()) < Math.fround(ldz * Math.fround(0.3))) {
        Cb.igniteForSeconds(target, 2 * Math.floor(ldz));
      }
    }
    return hit;
  };

  /**
   * D-402 (session 40, PASS 16 JOB 1's own last item): `RangedBowAttackGoal.onShoot`'s real
   * consequence — spawn an actual `arrow` entity (D-402's extractor gave it a real, bytecode-
   * measured gravity/drag, `07i_entitylist.js`'s `EL.spawn` refused it before this session) and
   * aim it at the target, the same "the caller supplies the jar-specific consequence" shape
   * `Ai.OWED` already names for `onBreed` (D-383) and that `Cb.mobAttack` (D-394) already filled
   * for the melee half of this same pair.
   *
   * ⚠ THE VELOCITY/ARC ARE TRANSCRIBED, NOT BYTECODE-VERIFIED THIS SESSION — same discipline,
   * and the same caveat, D-396 already put on `RangedBowAttackGoal`'s own radius/interval/speed:
   * `Mob.performRangedAttack`'s public MCP/Yarn-mapped shape is `shoot(dx, dy + dist*0.2, dz,
   * power, inaccuracy)`, normalized then scaled by `power` (1.6 for a bow-armed mob at normal
   * difficulty). `Ai.OWED` names this row. What this file does NOT model, also named there: the
   * per-difficulty inaccuracy spread (a Gaussian jitter on the aim), arrow pickup, and a
   * critical hit's extra damage/particles — this is the algorithm's SHAPE, not its every digit.
   */
  // D-597: AbstractSkeletonEntity.attack (.decomp AbstractSkeletonEntity.java:179-189, read whole) —
  //   arrow = ProjectileUtil.createArrowProjectile(this, arrowStack, pullProgress)   (spawned at the
  //           shooter's getEyeY() - 0.1F, PersistentProjectileEntity.java:77; damage rolled by
  //           applyEnchantmentEffects, :577-593)
  //   dx = target.x - this.x; dy = target.getBodyY(1/3) - arrow.y; dz = target.z - this.z
  //   arrow.setVelocity(dx, dy + sqrt(dx²+dz²) * 0.2F, dz, 1.6F, 14 - difficulty.getId() * 4)
  // setVelocity (ProjectileEntity.java:114-123): normalize, + nextGaussian()*0.0075F*divergence
  // per axis, * speed. The pull is BowItem.getPullProgress(useTicks) — the engine's
  // RangedBowAttackGoal fires at its own 20-tick draw, where getPullProgress is exactly 1.
  Cb.ARROW_SPREAD_BASE = 14;                     // `14 - difficulty.getId() * 4`
  Cb.ARROW_SHOOT_SPEED = Math.fround(1.6);                    // setVelocity's own `1.6F`
  Cb.ARROW_ARC = Math.fround(0.2);               // `$$7 * 0.2F`
  Cb.ARROW_GAUSS_SCALE = Math.fround(0.0075);    // ProjectileEntity.setVelocity's `0.0075F`
  Cb.ARROW_SPAWN_BELOW_EYE = Math.fround(0.1);   // `getEyeY() - 0.1F`
  Cb.ARROW_DIFF_DAMAGE = Math.fround(0.11);      // applyEnchantmentEffects' `getId() * 0.11F`
  Cb.diffId = function () {
    var D = NS.Diff, v = D && D.get ? D.get() : 'normal';
    var i = D && D.LEVELS ? D.LEVELS.indexOf(v) : 2;
    return i < 0 ? 2 : i;                        // Difficulty.getId(): peaceful 0 .. hard 3
  };
  /** java.util.Random.nextGaussian: Marsaglia polar with the spare cached on the source (#6139), via NS.U.polarGaussian. */
  Cb.gauss = function (rnd) {
    return NS.U.polarGaussian(rnd, rnd.nextDouble);
  };
  /** PersistentProjectileEntity.applyEnchantmentEffects (.decomp :577-593): the arrow's own
   *  `damage` field — pull*2 + gaussian*0.25 + difficulty*0.11F, then POWER (+0.5*lvl+0.5),
   *  PUNCH (the arrow's punch) and FLAME (arrow on fire 100 s) off the shooter's mainhand bow. */
  Cb.arrowEnchantEffects = function (e, pull, rnd) {
    var dmg = Math.fround(pull * 2) + Cb.gauss(rnd) * 0.25 + Math.fround(Cb.diffId() * Cb.ARROW_DIFF_DAMAGE);
    var Eq = NS.Equip, IT = NS.Items, bow = (Eq && Eq.getEquipped && IT) ? Eq.getEquipped(e, IT.MAINHAND) : null;
    var power = bow ? Cb.enchantLevel(bow, 'power') : 0;
    var punch = bow ? Cb.enchantLevel(bow, 'punch') : 0;
    var flame = bow ? Cb.enchantLevel(bow, 'flame') : 0;
    if (power > 0) dmg += power * 0.5 + 0.5;
    return { damage: dmg, punch: punch, flame: flame > 0 };
  };
  /** Vec3f.rotate(Quaternion) as vanilla does it: q * (v,0) * conj(q), NOT renormalised (the axis is used as given). */
  Cb.quatRotate = function (v, axis, deg) {
    var h = deg * Math.PI / 360, sn = Math.sin(h), x = axis[0] * sn, y = axis[1] * sn, z = axis[2] * sn, w = Math.cos(h);
    // t = q * (v,0)
    var tw = -x * v[0] - y * v[1] - z * v[2], tx = w * v[0] + y * v[2] - z * v[1],
        ty = w * v[1] + z * v[0] - x * v[2], tz = w * v[2] + x * v[1] - y * v[0];
    // t * conj(q) -> vector part
    return [-tw * x + tx * w - ty * z + tz * y, -tw * y + ty * w - tz * x + tx * z, -tw * z + tz * w - tx * y + ty * x];
  };
  /** CrossbowUser.getProjectileLaunchVelocity: the aim vector rotated by `deg` (0/-10/+10) before setVelocity's divergence. */
  Cb.crossbowLaunchVec = function (e, dx, dy, dz, deg) {
    var l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1, n = [dx / l, dy / l, dz / l];
    var ax = [n[1] * 0 - n[2] * 1, n[2] * 0 - n[0] * 0, n[0] * 1 - n[1] * 0];   // n x (0,1,0)
    if (ax[0] * ax[0] + ax[1] * ax[1] + ax[2] * ax[2] <= 1e-7) {
      var pr = ((e.pitch || 0) - 90) * Math.PI / 180, yw = -(e.yaw || 0) * Math.PI / 180;   // getOppositeRotationVector = getRotationVector(pitch - 90, yaw)
      var o = [Math.sin(yw) * Math.cos(pr), -Math.sin(pr), Math.cos(yw) * Math.cos(pr)];
      ax = [n[1] * o[2] - n[2] * o[1], n[2] * o[0] - n[0] * o[2], n[0] * o[1] - n[1] * o[0]];
    }
    var v6 = Cb.quatRotate(n, ax, 90);
    return Cb.quatRotate(n, v6, deg);
  };
  Cb.mobShoot = function (e, target, pull, rnd, xbowPitch, deg) {
    if (!e || !target || !NS.EntityList) return null;
    // AbstractSkeletonEntity.attack draws from the shooter's own Entity.random (#6294); an explicit rnd (crossbow volley, checks) wins
    var own = !rnd && e.random && e.random.nextDouble ? e.random : null;
    rnd = rnd || (own ? function () { return own.nextDouble(); } : NS.EntityList.wr);
    var gsrc = own || rnd;
    if (pull === undefined) pull = 1;
    var th = target.height || 1.8;
    var ax = e.x, ay = e.y + Cb.eyeHeightOf(e) - Cb.ARROW_SPAWN_BELOW_EYE, az = e.z;
    // CrossbowItem.createArrow never calls applyEnchantmentEffects: flat default damage 2.0
    var ench = xbowPitch !== undefined ? { damage: 2, punch: 0, flame: false } : Cb.arrowEnchantEffects(e, pull, gsrc);
    var dx = target.x - e.x, dz = target.z - e.z;
    var dy = (target.y === undefined ? e.y : target.y) + th / 3 - ay;   // getBodyY(0.3333333333333333)
    var dist = Math.sqrt(dx * dx + dz * dz);
    dy += dist * Cb.ARROW_ARC;
    var len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    var nx = dx / len, ny = dy / len, nz = dz / len;
    if (deg) {   // multishot extras: aim vector rotated BEFORE the gaussian divergence
      var lv = Cb.crossbowLaunchVec(e, dx, dy, dz, deg), ll = Math.sqrt(lv[0] * lv[0] + lv[1] * lv[1] + lv[2] * lv[2]) || 1;
      nx = lv[0] / ll; ny = lv[1] / ll; nz = lv[2] / ll;
    }
    var div = Cb.ARROW_SPREAD_BASE - Cb.diffId() * 4;
    var g = Cb.ARROW_GAUSS_SCALE * div;
    var speed = Cb.ARROW_SHOOT_SPEED;
    var vx = (nx + Cb.gauss(gsrc) * g) * speed;
    var vy = (ny + Cb.gauss(gsrc) * g) * speed;
    var vz = (nz + Cb.gauss(gsrc) * g) * speed;
    // loop/zombievariants-s100 (QUEUE 0.2 G18c) -- `StrayEntity.createArrowProjectile`
    // (.decomp, read whole): EVERY arrow a stray fires carries `StatusEffects.field_5909`
    // (SLOWNESS) for 600 ticks, `addEffect`-ed onto the `ArrowEntity` itself (not the shooter),
    // undivided (`ArrowEntity.addEffect` -> the CUSTOM-effects loop of `onHit`, not the
    // `this.potion.getEffects()` loop -- see `Cb.ARROW_TIP` and `Cb.applyArrowTip` below for
    // why those two loops divide duration differently). loop/tipped -- `opts.tip` is now the
    // general `{ potionId, custom }` shape `Cb.applyArrowTip` reads back on a landed hit.
    var tip = (e.type === 'stray')
      ? { custom: [{ effect: 'slowness', duration: Cb.STRAY_ARROW_SLOWNESS_TICKS, amplifier: 0 }] }
      : undefined;
    // AbstractSkeletonEntity.attack / IllusionerEntity.attack: playSound(ENTITY_SKELETON_SHOOT, 1.0F, 1.0F / (rand.nextFloat() * 0.4F + 0.8F)) BEFORE the spawn.
    // CrossbowItem.shoot (:199-226): item.crossbow.shoot (field_15187) at the getSoundPitches pitch, PLAYERS category.
    if (xbowPitch !== undefined) {
      // CrossbowUser.shoot(target,stack,proj,angle) :36-44 plays it FIRST (hostile, one nextFloat after the gaussians), then CrossbowItem.shoot's PLAYERS one
      if (NS.Sound && NS.Sound.play) {
        NS.Sound.play('item.crossbow.shoot', { x: e.x, y: e.y, z: e.z, volume: 1, pitch: Math.fround(1 / (rnd() * 0.4 + 0.8)), source: 'hostile' });
        NS.Sound.play('item.crossbow.shoot', { x: e.x, y: e.y, z: e.z, volume: 1, pitch: xbowPitch, source: 'player' });
      }
    }
    else {   // the pitch roll is drawn whether or not a sound system is listening (the stream must advance)
      var shootPitch = Math.fround(1 / ((own ? own.nextFloat() : rnd()) * 0.4 + 0.8));
      if (NS.Sound && NS.Sound.play) NS.Sound.play('entity.skeleton.shoot', { x: e.x, y: e.y, z: e.z, volume: 1, pitch: shootPitch, source: 'hostile' });
    }
    var a = NS.EntityList.spawn('arrow', ax, ay, az, { vx: vx, vy: vy, vz: vz, shooter: e, tip: tip });
    if (a) {
      a.arrowDamage = ench.damage; a.punch = ench.punch;
      if (deg) a.pickupType = Cb.PICKUP_CREATIVE_ONLY;   // CrossbowItem.shoot: `$$9 != 0` -> CREATIVE_ONLY
      if (xbowPitch !== undefined) { a.hitSound = 'item.crossbow.hit'; a.shotFromCrossbow = true; }   // createArrow :229-243
      if (ench.flame) Cb.igniteForSeconds(a, 100);   // FLAME: setOnFireFor(100)
      // D-673 -- `WitherSkeletonEntity.createArrowProjectile` (.decomp:95-99): EVERY arrow it
      // fires is `setOnFireFor(100)`, bow enchantments or not (the same call FLAME makes).
      else if (e.type === 'wither_skeleton') Cb.igniteForSeconds(a, Cb.WITHER_SKELETON_ARROW_FIRE);
    }
    return a;
  };
  /** CrossbowItem.shootAll (#1201): one arrow, or with MULTISHOT three at 0/-10/+10 degrees of
   *  yaw about the centre shot; PIERCING stamps its level on each arrow. */
  Cb.mobShootCrossbow = function (e, target, stack, rnd) {
    var multi = Cb.enchantLevel(stack, 'multishot') > 0, pierce = Cb.enchantLevel(stack, 'piercing');
    // CrossbowItem.getSoundPitches: {1.0, getSoundPitch(flag), getSoundPitch(!flag)}, always rolled (nextBoolean, 2 nextFloat)
    var flag = rnd() < 0.5;
    var sp = function (f) { return Math.fround((f ? 0.63 : 0.43) + 1 / (rnd() * 0.5 + 1.8)); };
    var pitches = [1, sp(flag), sp(!flag)];
    var out = [Cb.mobShoot(e, target, 1, rnd, pitches[0], 0)];
    if (multi) out.push(Cb.mobShoot(e, target, 1, rnd, pitches[1], -10), Cb.mobShoot(e, target, 1, rnd, pitches[2], 10));   // shootAll order 0/-10/+10
    out = out.filter(Boolean);
    out.forEach(function (a) { a.pierceLevel = pierce; });
    // CrossbowItem.shoot :223 -> ItemStack.damage(multishot ? 3 : 1, shooter) (:278-296): each point rolls
    // Unbreaking (nextInt(level+1) > 0 spares it); the stack breaks at max damage (only creative PLAYERS are exempt).
    var Eq = NS.Equip, IT = NS.Items, ub = Cb.enchantLevel(stack, 'unbreaking'), n = 0;
    for (var k = multi ? 3 : 1; k > 0; k--) if (!(ub > 0 && Math.floor(rnd() * (ub + 1)) > 0)) n++;
    if (n && Eq && Eq.damageEquipped) {
      var slot = Eq.getEquipped(e, IT.MAINHAND) === stack ? IT.MAINHAND : IT.OFFHAND;
      Eq.damageEquipped(e, slot, n, rnd);
    }
    return out;
  };
  Cb.STRAY_ARROW_SLOWNESS_TICKS = 600;   // StrayEntity.createArrowProjectile's own literal
  Cb.WITHER_SKELETON_ARROW_FIRE = 100;   // WitherSkeletonEntity.createArrowProjectile: setOnFireFor(100)

  /**
   * D-402: the live arrow's own per-tick consequence, called from `EntityList.tickOne` for
   * every `arrow`/`spectral_arrow` in the list, AFTER `Physics.move` has already run this
   * tick's collision sweep (so `e.onGround` is fresh).
   *
   * ⚠ WHAT THIS IS NOT — named rather than silently assumed equal to vanilla, `Ai.OWED`'s own
   * row: `AbstractArrow.tick()` raycasts the WHOLE path an arrow travelled that tick against
   * every hitbox and every block face, so a fast arrow cannot tunnel through a thin target in
   * one step; this checks only the CURRENT position each tick, a strictly weaker test. Pickup,
   * looting, and knockback-from-bow-charge are also not modelled. loop/bow -- the critical
   * hit's bonus damage IS now modelled (`Cb.arrowCritBonus` below), since a fully-drawn
   * PLAYER shot (`Use.bowRelease`, 14l_use.js) is the one real source of `e.critical`; the
   * bonus PARTICLES are `Cb.tickArrow`'s 4-point CRIT trail.
   */
  Cb.ARROW_BASE_DAMAGE = 2;   // PersistentProjectileEntity's own field default (`damage = 2.0`, :59)
  /** onEntityHit (.decomp :299-302): ceil(clamp(|velocity| * damage, 0, 2147483647)). A mob's
   *  arrow is never critical (only a fully drawn PLAYER shot sets it, `e.critical`, loop/bow). */
  Cb.arrowHitDamage = function (e) {
    var d = e.arrowDamage !== undefined ? e.arrowDamage : Cb.ARROW_BASE_DAMAGE;
    var v = Math.fround(Math.sqrt(e.vx * e.vx + e.vy * e.vy + e.vz * e.vz));
    return Math.ceil(Math.max(0, Math.min(2147483647, v * d)));
  };
  /**
   * loop/bow -- `PersistentProjectileEntity.onEntityHit` (.decomp :318-321): a critical arrow
   * adds `random.nextInt(damage/2 + 2)` on top of the base integer damage, capped at
   * `Integer.MAX_VALUE`. `rnd` is optional (`NS.EntityList.wr` default), the same "caller may inject
   * a seeded source" shape `Cb.gauss`/`Cb.igniteForSeconds`'s own `random.nextInt(2)` sibling
   * (this file's line ~187) already uses -- `Math.floor(rnd() * n)` for `nextInt(n)`.
   */
  Cb.arrowCritBonus = function (dmg, rnd) {
    rnd = rnd || NS.EntityList.wr;
    var bonus = Math.floor(rnd() * (Math.floor(dmg / 2) + 2));
    return Math.min(bonus + dmg, 2147483647);
  };
  /**
   * loop/tipped -- `ArrowEntity.onHit` (.decomp ArrowEntity.java:175-193, read whole) applies
   * TWO separate loops when an arrow lands, with DIFFERENT duration handling each:
   *   1. `this.potion.getEffects()` -- the base `Potions.java` registration's own effect list
   *      (set by `initFromStack`'s `PotionUtil.getPotion(stack)`, the tipped-arrow item's
   *      `Potion` tag) -- each re-wrapped `max(getDuration() / 8, 1)`, amplifier/ambient/
   *      particles copied as-is. `Cb.ARROW_TIP_DIVISOR` is that literal `8`.
   *   2. `this.effects` -- CUSTOM `StatusEffectInstance`s (a brewed-in `CustomPotionEffects`
   *      tag, OR `addEffect` called directly -- the stray's own slowness, StrayEntity.java:58)
   *      -- applied FULL duration, undivided; this is the loop the stray's arrow uses.
   * `e.tip` is `{ potionId, custom }`, either half optional: `potionId` a key into
   * `NS.Potion.POTIONS` (divided, loop 1), `custom` an array of `{effect,duration,amplifier}`
   * (undivided, loop 2) -- `NS.Potion.tipFromTag` (07z_potion.js) builds this shape off a real
   * tipped-arrow item's tag; `Cb.mobShoot`'s stray branch above builds it by hand.
   */
  Cb.ARROW_TIP_DIVISOR = 8;   // ArrowEntity.onHit's own `getDuration() / 8`
  Cb.applyArrowTip = function (tip, t) {
    if (!tip || !t || !NS.Effects || !NS.Effects.addStatusEffect) return;
    if (tip.potionId && NS.Potion && NS.Potion.POTIONS) {
      var base = NS.Potion.POTIONS[tip.potionId];
      if (base) for (var bi = 0; bi < base.effects.length; bi++) {   // every potion effect (D-648)
        var be = base.effects[bi];
        var dur = Math.max(Math.floor(be.duration / Cb.ARROW_TIP_DIVISOR), 1);
        NS.Effects.addStatusEffect(t, be.effect, dur, be.amplifier || 0, false, true);
      }
    }
    if (tip.custom) {
      for (var i = 0; i < tip.custom.length; i++) {
        var c = tip.custom[i];
        if (!c || !c.effect) continue;
        NS.Effects.addStatusEffect(t, c.effect, c.duration, c.amplifier || 0, false, true);
      }
    }
  };
  /**
   * relaxed-curie hand-off item 1 (buttonrefcheck `oak_plate_arrow`) -- AN ARROW FLIES AS A POINT.
   * `PersistentProjectileEntity.tick()` (.decomp:123-252, read whole) never runs its box through
   * `Entity.move`: it raycasts the point's own segment `[pos, pos + velocity]` against block
   * COLLIDER shapes (`RaycastContext.ShapeType.COLLIDER`, `FluidHandling.NONE`), and on a hit
   * (`onBlockHit`, :402-417) sets `velocity = hitPos - pos`, backs the point off
   * `0.05 * normalize(velocity)`, then `setPosition(pos + velocity)` -- so it rests 0.05 short of the
   * hit point, `inGround`. Its 0.5-wide BOX is still what `checkBlockCollision` (:251) touches
   * plates/buttons with. The engine used to route the arrow through the generic per-axis box clip
   * (`Ph.move`), so an arrow falling down a block corner stopped on the neighbour's top instead of
   * sliding past it onto the plate.
   */
  /** The top-of-tick containment test (:137-150): the block at `getBlockPos()` whose collision
   *  shape CONTAINS the point (`Box.contains`: min inclusive, max exclusive) -- or null. */
  Cb.arrowPointGround = function (e) {
    var Ph = NS.Physics;
    if (!Ph || !NS.World) return null;   // no world loaded (a combat-only check): no blocks
    var cx = Math.floor(e.x), cy = Math.floor(e.y), cz = Math.floor(e.z);
    var st = Ph.blockAt(cx, cy, cz);
    if (!st) return null;
    var shape = Ph.shapeOf(st);
    if (!shape) return null;
    var lx = e.x - cx, ly = e.y - cy, lz = e.z - cz;
    for (var i = 0; i < shape.length; i++) {
      var b = shape[i];
      if (lx >= b[0] && lx < b[3] && ly >= b[1] && ly < b[4] && lz >= b[2] && lz < b[5]) {
        return { state: st, cx: cx, cy: cy, cz: cz };
      }
    }
    return null;
  };
  /** A block with a non-empty collision shape -- the COLLIDER raycast's predicate. Fluids have
   *  none, which is `FluidHandling.NONE`. */
  Cb.arrowCollides = function (id) {
    if (!(id > 0) || !NS.Physics) return false;
    var s = NS.Physics.shapeOf(id);
    return !!(s && s.length);
  };
  /** `world.raycast(pos -> pos + v, COLLIDER, NONE)`: `{ f, state, cx, cy, cz }` (`f` the fraction
   *  of `v` travelled, 0..1) or null for a MISS. `NS.Ray.cast` with `shapeStart`, so the start
   *  cell's real shape is tested too (vanilla's raycast visits it first). */
  Cb.arrowRaycast = function (ox, oy, oz, vx, vy, vz) {
    var len = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (!(len > 0) || !NS.Ray || !NS.World) return null;
    var h = NS.Ray.cast(ox, oy, oz, vx / len, vy / len, vz / len, len, Cb.arrowCollides, true);
    if (!h) return null;
    return { f: h.dist / len, state: h.id, cx: h.x, cy: h.y, cz: h.z, face: h.face, hx: h.hx, hy: h.hy, hz: h.hz };
  };
  /** `shouldFall()` (:255-257): `world.isSpaceEmpty(new Box(pos, pos).expand(0.06))` -- true when
   *  no collision box of any block touches the point's 0.06 neighbourhood. */
  Cb.ARROW_FALL_EXPAND = 0.06;
  Cb.arrowSpaceEmpty = function (e) {
    var Ph = NS.Physics;
    if (!Ph || !NS.World) return true;
    var d = Cb.ARROW_FALL_EXPAND;
    var x0 = e.x - d, y0 = e.y - d, z0 = e.z - d, x1 = e.x + d, y1 = e.y + d, z1 = e.z + d;
    for (var bx = Math.floor(x0); bx <= Math.floor(x1); bx++)
      for (var by = Math.floor(y0); by <= Math.floor(y1); by++)
        for (var bz = Math.floor(z0); bz <= Math.floor(z1); bz++) {
          var st = Ph.blockAt(bx, by, bz);
          if (!st) continue;
          var shape = Ph.shapeOf(st);
          if (!shape) continue;
          for (var i = 0; i < shape.length; i++) {
            var b = shape[i];
            if (x1 > bx + b[0] && x0 < bx + b[3] && y1 > by + b[1] && y0 < by + b[4] &&
                z1 > bz + b[2] && z0 < bz + b[5]) return false;
          }
        }
    return true;
  };
  Cb.ARROW_STUCK_TICKS = 1200;    // PersistentProjectileEntity.age() (.decomp:250-255): `life >= 1200` -> discard()
  Cb.ARROW_SHAKE_TICKS = 7;       // PersistentProjectileEntity.onBlockHit (.decomp): `this.shake = 7`
  Cb.PICKUP_ALLOWED = 'allowed';           // PickupPermission.field_7593
  Cb.PICKUP_CREATIVE_ONLY = 'creative_only'; // PickupPermission.field_7594
  Cb.PICKUP_DISALLOWED = 'disallowed';       // PickupPermission.field_7592 (the default -- mob-fired)

  /**
   * The instant an arrow's point lands inside a block's real shape — `Ai.OWED`'s "a stuck arrow
   * ... is never drawn" line: it always WAS drawn once alive (D-449, `ER.visible`'s own
   * `e.type === 'arrow'`/`spectral_arrow` branch draws every live arrow regardless of `e.stuck`),
   * but `ER.arrowYaw`/`ER.arrowPitch` (07j_entityrender.js) read the CURRENT velocity, which this
   * zeroes below — so a stuck arrow used to flatten to yaw 0 / pitch 0 the instant it landed.
   * Freezing the heading here, off THIS tick's velocity before it is cleared, is the one
   * line 07j needs (`e.stuckYaw`/`e.stuckPitch`, read back by that file's own two functions).
   */
  Cb.embedArrow = function (e, ground) {
    if (NS.GameEvent) NS.GameEvent.emit('projectile_land', e.x, e.y, e.z, e.shooter);   // PROJECTILE_LAND at the hit
    var vx = e.vx, vy = e.vy, vz = e.vz;
    e.stuckYaw = (vx || vz) ? Math.atan2(vx, -vz) : (e.yaw || 0);
    var h = Math.hypot(vx, vz);
    e.stuckPitch = (h || vy) ? Math.atan2(vy, h) : 0;
    e.stuck = true;
    e.vx = e.vy = e.vz = 0;
    e.groundState = ground.state;   // PersistentProjectileEntity's own `inBlockState` (D-402)
    e.groundCX = ground.cx; e.groundCY = ground.cy; e.groundCZ = ground.cz;   // the ONE cell
    e.groundTicks = 0;              // `life` -- the 1200-tick despawn clock, only while embedded
    e.shake = Cb.ARROW_SHAKE_TICKS;
    Cb.arrowHitSound(e);   // onBlockHit: playSound(getSound(), 1.0F, 1.2F/(rand*0.2F+0.9F))
  };
  Cb.arrowPlayerHit = function (e, t) {
    var sh = e.shooter;
    if (sh && t !== sh && t.type === 'player' && sh.type === 'player' && NS.Sound && NS.Sound.play) NS.Sound.play('entity.arrow.hit_player', { volume: 0.18, pitch: 0.45, source: 'player' });
  };
  Cb.arrowHitSound = function (e) {
    if (e.type === 'trident') {   // TridentEntity.getHitSound (field_15104): item.trident.hit_ground, same pitch formula
      if (NS.Sound && NS.Sound.entitySound) NS.Sound.entitySound('item.trident.hit_ground', e.x, e.y, e.z, 1, Math.fround(1.2 / (NS.EntityList.wr() * 0.2 + 0.9)), 'neutral', NS.Player);
      return;
    }
    if (NS.Sound && NS.Sound.play) NS.Sound.play('entity.arrow.hit', { x: e.x, y: e.y, z: e.z, volume: 1, pitch: Math.fround(1.2 / (NS.EntityList.wr() * 0.2 + 0.9)), source: 'neutral' });
  };

  /**
   * `PersistentProjectileEntity.onPlayerCollision` + `tryPickup` (.decomp:520-537), transcribed:
   * ALLOWED inserts a real item stack and only discards the arrow if the whole stack actually
   * fit (`Inventory.insertStack`'s own all-or-nothing return, `Inv.add`'s leftover here);
   * CREATIVE_ONLY discards on touch with NO inventory change at all if the player IS creative
   * (a creative player's arrows are free, nothing to add back); DISALLOWED (the default --
   * every mob-fired arrow, `Cb.mobShoot` never sets `e.pickupType`) never picks up. `e.shake`
   * gates it exactly as vanilla's own `shake <= 0` does — the few ticks right after landing.
   */
  Cb.tryArrowPickup = function (e) {
    var P = NS.Player, Iv = NS.Inventory;
    if (!P || !P.inventory || !Iv || e.shake > 0) return false;
    var phw = (P.width || 0.6) * 0.5, ph = P.height || 1.8;
    var ahw = (e.width !== undefined ? e.width : 0.5) * 0.5, ah = e.height !== undefined ? e.height : 0.5;
    var overlap = Math.abs(e.x - P.x) < phw + ahw &&
                  Math.abs(e.z - P.z) < phw + ahw &&
                  e.y < P.y + ph && e.y + ah > P.y;
    if (!overlap) return false;
    var pk = e.pickupType || Cb.PICKUP_DISALLOWED;
    var picked = false;
    if (pk === Cb.PICKUP_ALLOWED) {
      var name = e.pickupItem || e.type;
      var st = Iv.stack(name, 1, e.pickupDamage | 0, e.pickupTag || null);
      if (!Iv.isEmpty(st)) {
        var before = st.n;
        Iv.add(P.inventory, st);
        picked = (st.n | 0) < before;
        if (picked && P.syncHotbar) P.syncHotbar();
      }
    } else if (pk === Cb.PICKUP_CREATIVE_ONLY) {
      picked = !!P.instabuild;
    }
    if (picked) e.removed = true;
    return picked;
  };

  /**
   * The already-embedded arrow's own per-tick consequence — `PersistentProjectileEntity.tick()`'s
   * `if (this.inGround ...)` branch (.decomp:161-168) plus `onPlayerCollision`, which vanilla
   * dispatches from the world's own per-tick entity-touch scan rather than from the arrow's own
   * tick; folded in here at the same cadence (once a tick, per stuck arrow) since this engine
   * has no separate touch dispatcher to hang it from.
   */
  Cb.tickStuckArrow = function (e) {
    if (e.shake > 0) e.shake--;
    Cb.tryArrowPickup(e);
    if (e.removed) return;   // picked up this tick -- nothing left to age or fall

    // `if (this.inBlockState != <state at getBlockPos()> && this.shouldFall())` (.decomp:161-162):
    // the point rests 0.05 short of the block it hit, usually in the cell BEFORE it, so the state
    // test mostly passes and `shouldFall` -- is any collision box within 0.06 of the point -- decides.
    var Ph = NS.Physics;
    var here = Ph ? Ph.blockAt(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z)) : e.groundState;
    var stillEmbedded = here === e.groundState || !Cb.arrowSpaceEmpty(e);
    if (!stillEmbedded) {
      // shouldFall/fall (.decomp:162-176): the block the arrow was embedded in no longer
      // leaves anything within 0.06 of its point (broken, or replaced by a thinner shape) --
      // resume falling. `fall()`'s own `velocity.multiply(random.nextFloat()*0.2F, ...)` is a
      // no-op on an already-zeroed velocity (`Cb.embedArrow` zeroed it on landing, above); the
      // very next flying tick's own gravity (`Cb.tickArrow`, `e.vy -= e.gravity`) is what
      // actually resumes the drop, one tick later than vanilla's tiny residual multiply would.
      e.stuck = false;
      e.groundTicks = 0;
      e.vx *= NS.EntityList.wr() * 0.2; e.vy *= NS.EntityList.wr() * 0.2; e.vz *= NS.EntityList.wr() * 0.2;   // fall()
      return;
    }
    e.groundTicks = (e.groundTicks || 0) + 1;
    if (e.groundTicks >= Cb.ARROW_STUCK_TICKS) e.removed = true;   // age(): life >= 1200 -> discard()
  };

  Cb.tickArrow = function (e) {
    if (e.removed) return;
    if (e.stuck) { Cb.tickStuckArrow(e); return; }
    // `EL.tickOne` hands a flying arrow straight here: no generic gravity, no box clip, no damp.
    // Order is the jar's (.decomp:137-252): containment, raycast, entity segment, collision,
    // then `pos + v`, THEN `v *= 0.99`, THEN `v.y -= 0.05` -- drag/gravity reach NEXT tick's move
    // (KW-34's point, now exact from tick 1: no generic `vy -= gravity` runs first any more).
    var g0 = Cb.arrowPointGround(e);
    if (g0) { Cb.embedArrow(e, g0); return; }
    var ox = e.x, oy = e.y, oz = e.z;
    // `isTouchingWater()` is baseTick's flag -- the box where the arrow STARTS this tick.
    var wet = Cb.arrowTouchingWater(e);
    var vx = e.vx, vy = e.vy, vz = e.vz;
    var bh = Cb.arrowRaycast(ox, oy, oz, vx, vy, vz);
    var f = bh ? bh.f : 1;
    // an entity on `[pos, blockHit or pos+v]` replaces the block hit (`$$10 = $$11`)
    var struck = Cb.arrowStrikeEntity(e, ox, oy, oz, vx * f, vy * f, vz * f);
    if (e.removed) return;
    // tick():209-220 client half: 4 CRIT particles along the velocity, before the move
    if (e.critical && NS.Particle && NS.Particle.spawn) {
      for (var ci = 0; ci < 4; ci++) {
        NS.Particle.spawn('crit', ox + vx * ci / 4, oy + vy * ci / 4, oz + vz * ci / 4, -vx, -vy + 0.2, -vz);
      }
    }
    if (!struck && bh) {
      // onBlockHit: velocity = hitPos - pos; pos -= normalize(velocity) * 0.05; then the tick's
      // own setPosition(pos + velocity) lands the point 0.05 short of the hit.
      var hx = vx * f, hy = vy * f, hz = vz * f;
      var hl = Math.sqrt(hx * hx + hy * hy + hz * hz);
      var back = hl > 0 ? Cb.ARROW_HIT_BACKOFF / hl : 0;
      e.x = ox + hx - hx * back; e.y = oy + hy - hy * back; e.z = oz + hz - hz * back;
      e.vx = vx; e.vy = vy; e.vz = vz;   // heading for `Cb.embedArrow`'s frozen yaw/pitch
      Cb.embedArrow(e, { state: bh.state, cx: bh.cx, cy: bh.cy, cz: bh.cz });
      if (NS.Redstone && NS.Redstone.targetHit) NS.Redstone.targetHit(bh.cx, bh.cy, bh.cz, bh.face, bh.hx, bh.hy, bh.hz, true);   // #5609 TargetBlock.onProjectileHit
      // onBlockHit: setVelocity(hitPos - pos), kept while embedded -- and the tick runs on into its own `*= drag`, `vy -= g`
      var d0 = wet ? Cb.ARROW_WATER_DRAG : Math.fround(e.drag);
      e.vx = hx * d0; e.vy = hy * d0; e.vz = hz * d0;
      if (!e.noGravity) e.vy -= Math.fround(e.gravity);
      if (NS.Use && NS.Use.entityCollide) NS.Use.entityCollide(e);   // checkBlockCollision (:251)
      return;
    }
    e.x = ox + e.vx; e.y = oy + e.vy; e.z = oz + e.vz;
    if (wet) Cb.projectileBubbles(e, e.x, e.y, e.z, e.vx, e.vy, e.vz);
    // tick():244-248 -- `$$22 = 0.99F`, or `getDragInWater()` (0.6F) while touching water.
    var drag = wet && e.type !== 'trident' ? Cb.ARROW_WATER_DRAG : Math.fround(e.drag);   // TridentEntity.getDragInWater = 0.99F
    e.vx *= drag; e.vy *= drag; e.vz *= drag;
    if (!e.noGravity) e.vy -= Math.fround(e.gravity);
    if (NS.Use && NS.Use.entityCollide) NS.Use.entityCollide(e);   // checkBlockCollision (:251)
  };
  /**
   * #5609 `Block.onProjectileHit` for the generic-physics projectiles (trident landing, snowball,
   * egg): their move has already run, so the hit is re-found by casting from the last known
   * point (or 1 block back along the velocity, else straight down) into the cell it stopped in.
   * `persistent` is `instanceof PersistentProjectileEntity` (arrow, trident -> 20 ticks; else 8).
   */
  Cb.projectileTargetHit = function (e, persistent) {
    var Rs = NS.Redstone;
    if (!Rs || !Rs.targetHit || !NS.Ray || !NS.World) return -1;
    var sx = e.x - e.vx, sy = e.y - e.vy, sz = e.z - e.vz;
    if (e.tpx !== undefined) { sx = e.tpx; sy = e.tpy; sz = e.tpz; }
    var dx = e.x - sx, dy = e.y - sy, dz = e.z - sz;
    var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(len > 1e-6)) { sx = e.x; sy = e.y + 0.5; sz = e.z; dx = 0; dy = -1; dz = 0; len = 1; }
    var h = NS.Ray.cast(sx, sy, sz, dx / len, dy / len, dz / len, len + 0.5, Cb.arrowCollides, true);
    if (!h) return -1;
    return Rs.targetHit(h.x, h.y, h.z, h.face, h.hx, h.hy, h.hz, persistent);
  };
  /** PersistentProjectileEntity.tick:239-243 -- touching water: 4 BUBBLEs at (pos - v*0.25) with velocity v (client side). */
  Cb.projectileBubbles = function (e, x, y, z, vx, vy, vz) {
    var Px = NS.Particle;
    if (!Px || !Px.spawn) return 0;
    for (var j = 0; j < 4; j++) Px.spawn('bubble', x - vx * 0.25, y - vy * 0.25, z - vz * 0.25, vx, vy, vz);
    return 4;
  };
  Cb.ARROW_WATER_DRAG = Math.fround(0.6);   // PersistentProjectileEntity.getDragInWater (0.6F; only Trident overrides)
  /**
   * `Entity.isTouchingWater()` for an arrow -- `updateMovementInFluid(WATER, 0.014)`'s own test
   * (.decomp Entity.java): the box deflated by 0.001, every cell it spans, touching when
   * `cellY + FluidState.getHeight` reaches the box bottom. Fluid heights are `Wx.fluidHeight`'s.
   */
  Cb.arrowTouchingWater = function (e) {
    var Wx = NS.Weather;
    if (!Wx || !Wx.fluidOf || !NS.World || !NS.World.getBlock) return false;
    var hw = (e.width !== undefined ? e.width : 0.5) / 2 - 0.001, h = e.height !== undefined ? e.height : 0.5;
    var x0 = e.x - hw, x1 = e.x + hw, y0 = e.y + 0.001, y1 = e.y + h - 0.001, z0 = e.z - hw, z1 = e.z + hw;
    for (var x = Math.floor(x0); x < Math.ceil(x1); x++)
      for (var y = Math.floor(y0); y < Math.ceil(y1); y++)
        for (var z = Math.floor(z0); z < Math.ceil(z1); z++) {
          if (Wx.fluidOf(NS.World.getBlock(x, y, z))[0] !== 1) continue;   // FLUID_WATER
          if (y + Wx.fluidHeight(x, y, z) >= y0) return true;
        }
    return false;
  };
  Cb.ARROW_HIT_BACKOFF = 0.05;   // PersistentProjectileEntity.onBlockHit: normalize().multiply(0.05F)

  /**
   * `getEntityCollision(pos, end)` + `onEntityHit` -- `ProjectileUtil.getEntityCollision`
   * (.decomp, read whole): a box test along the segment with each candidate's box inflated by
   * 0.3 (`Cb.ARROW_ENTITY_INFLATE`), `Cb.rayBox`'s slab method, so a fast arrow cannot tunnel
   * through a thin target. Returns true when a target was found (hit or not).
   */
  Cb.arrowStrikeEntity = function (e, ox, oy, oz, dx, dy, dz) {
    var targets = [];
    if (e.type === 'trident' && e.dealtDamage) return false;   // TridentEntity.getEntityCollision
    if (NS.Player && e.shooter !== NS.Player) targets.push(NS.Player);
    var list = NS.EntityList && NS.EntityList.list;
    if (list) {
      for (var i = 0; i < list.length; i++) {
        var o = list[i];
        if (o === e || o.removed || o === e.shooter) continue;
        // D-835 — `end_crystal` has no `maxHealth` (D-336, plain `Entity`) but IS a valid
        // projectile target: `EndCrystalEntity.collides()` (.decomp) returns `true`, the same
        // predicate `ProjectileUtil.getEntityCollision` reads for every other struck entity.
        if (o.maxHealth === undefined && o.type !== 'end_crystal' && !Cb.isCart(o) && o.type !== 'fireball' && o.type !== 'small_fireball') continue;   // else only a LivingEntity can be struck (D-336)
        if (o.type === 'arrow' || o.type === 'spectral_arrow' || (e.type === 'trident' && o.type === 'trident')) continue;
        if (e.piercedEntities && e.piercedEntities.indexOf(o) >= 0) continue;   // canHit(): already-pierced ids
        targets.push(o);
      }
    }
    var IN = Cb.ARROW_ENTITY_INFLATE;
    var bestT = 1, t = null;    // t in [0,1] along the segment -- 1 is the far end, never hit
    for (var j = 0; j < targets.length; j++) {
      var cand = targets[j];
      var tw = cand.width !== undefined ? cand.width : 0.6;
      var th = cand.height !== undefined ? cand.height : 1.8;
      var ct = (cand.type === 'ender_dragon' && cand.dragon) ? Cb.dragonPartT(cand, ox, oy, oz, dx, dy, dz, IN) :
                Cb.rayBox(ox, oy, oz, dx, dy, dz,
                          cand.x - tw / 2 - IN, cand.y - IN, cand.z - tw / 2 - IN,
                          cand.x + tw / 2 + IN, cand.y + th + IN, cand.z + tw / 2 + IN);
      if (ct === null || ct > bestT) continue;
      // ⚠ AN EXACT TIE KEEPS THE EARLIER-FOUND CANDIDATE (`NS.Player` is always pushed first,
      // above) rather than the later one in list order — without this a second entity sharing
      // the exact same box as `NS.Player` would silently steal the hit on `ct === bestT`,
      // since neither `>` alone nor a plain reassignment tells "tied" from "closer" apart.
      if (t !== null && ct === bestT) continue;
      bestT = ct; t = cand;
    }
    if (!t) return false;

    if (e.type === 'trident') return Cb.tridentHit(e, t);
    var dmg = Cb.arrowHitDamage(e);
    // loop/bow -- `isCritical()` (:320-322 above `onEntityHit`'s own damage-int line):
    // only a fully-drawn PLAYER shot ever sets `e.critical` (`Use.bowRelease`, 14l_use.js).
    if (e.critical) dmg = Cb.arrowCritBonus(dmg, e.rnd);
    var hit;
    var fireBefore = t.remainingFireTicks | 0;   // `$$9 = getFireTicks()`, restored on a bounce
    // onEntityHit: a burning arrow sets its target alight for 5 s before the damage (not an enderman).
    if (e.isOnFire && t.type !== 'enderman') Cb.igniteForSeconds(t, 5);
    if (t === NS.Player) {
      hit = NS.Survival && NS.Survival.hurt ? NS.Survival.hurt(t, 'arrow', dmg, e.shooter || null) : false;
    } else {
      hit = Cb.hurt(t, dmg, undefined, false, { attacker: e.shooter || null, source: 'projectile', sourceEntity: e, persistent: true,
        flamingArrowSpeed2: e.isOnFire ? e.vx * e.vx + e.vy * e.vy + e.vz * e.vz : undefined });
      if (t.type === 'fireball' || t.type === 'small_fireball') { if (hit) e.removed = true; return hit; }
      // KW-42 -- a "hit" enderman here just teleported and took no damage at all (Cb.hurt's own
      // ProjectileDamageSource gate above): `Cb.notifyHurt` (hurt sound/red-flash/`onAttacked`
      // hooks) is real damage feedback the jar's own `onEntityHit` never fires for that case --
      // it returns before any of that when the struck entity is an enderman (.decomp
      // PersistentProjectileEntity.java: `if ($$8) { return; }` right after `$$1.damage(...)`
      // succeeds, `$$8` being the enderman-type check) -- so skip it, and skip the punch/tip/
      // glow effects below the same way, for enderman only.
      // D-835 -- a destroyed end_crystal is not a LivingEntity either: `onEntityHit`'s own
      // punch/onHit(spectral glow)/enchant-hook block (.decomp :347-377) is gated on
      // `$$1 instanceof LivingEntity`, which a crystal never is, so it gets none of that --
      // only the outer `playSound` + `discard()` two lines down, same as every other hit.
      if (hit && t.type !== 'enderman' && t.type !== 'end_crystal') Cb.notifyHurt(t, e.shooter || e);
    }
    // KW-42 -- PersistentProjectileEntity.onEntityHit (.decomp:342-345): `if ($$8) { return; }`
    // fires the INSTANT `$$1.damage(...)` returns for a struck enderman, before punch, tipped/
    // glow effects, the hit sound, or `discard()` -- so a teleport-dodged (or dodge-attempted
    // but grounded, `hit === false`) enderman leaves the arrow completely unconsumed, still
    // flying, exactly as if this tick's hit test had found nothing at all.
    if (t.type === 'enderman') return true;
    // D-835 -- see the D-835 note above `Cb.notifyHurt`'s own call: punch/tip/spectral-glow are
    // all `instanceof LivingEntity`-gated in the jar (.decomp), so a struck crystal (already
    // removed by `EC.damage`, above) skips straight to the shared `e.removed = true` discard.
    if (hit && e.punch > 0 && t.type !== 'end_crystal') {
      // onEntityHit's PUNCH: velocity * (1,0,1), normalized, * punch * 0.6, + 0.1 up.
      var hl = Math.sqrt(e.vx * e.vx + e.vz * e.vz);
      if (hl > 0) { t.vx = (t.vx || 0) + e.vx / hl * e.punch * 0.6; t.vy = (t.vy || 0) + 0.1; t.vz = (t.vz || 0) + e.vz / hl * e.punch * 0.6; }
    }
    if (hit) {
      // onEntityHit tail: playSound(sound, 1, 1.2/(rand*0.2+0.9)); a player shooter hitting ANOTHER player hears hit_player (0.18, 0.45)
      Cb.arrowHitSound(e);
      Cb.arrowPlayerHit(e, t);
      if (t.type !== 'end_crystal') {
        // loop/tipped -- `e.tip` (the stray's own slowness, `Cb.mobShoot` above, or a real
        // tipped-arrow's payload, `Cb.applyArrowTip` below), applied the instant a hit lands.
        if (e.tip) Cb.applyArrowTip(e.tip, t);
        // onEntityHit: a non-piercing arrow that damaged a LivingEntity sticks in it (StuckArrowCount+1).
        if (!(e.pierceLevel > 0)) t.stuckArrows = (t.stuckArrows || 0) + 1;
        // loop/bow -- `SpectralArrowEntity.onHit` (.decomp, read whole): unconditional, off no
        // tag at all -- every landed hit gets Glowing(`Cb.SPECTRAL_GLOW_TICKS`, amplifier 0).
        // The outline RENDER that effect drives is still not built (named on `bowcheck.mjs`'s
        // own header, `ER.OWED`'s struck line points here) -- the STATUS EFFECT is real.
        if (e.type === 'spectral_arrow' && NS.Effects && NS.Effects.addStatusEffect) {
          NS.Effects.addStatusEffect(t, 'glowing', Cb.SPECTRAL_GLOW_TICKS, 0, false, true);
        }
      }
      // onEntityHit: pierceLevel>0 keeps piercedEntities; size >= level+1 discards, else fly on
      if (e.pierceLevel > 0) {
        var pe = e.piercedEntities || (e.piercedEntities = []);
        if (pe.length >= e.pierceLevel + 1) e.removed = true;
        else { pe.push(t); if (pe.length >= e.pierceLevel + 1) e.removed = true; }
      } else e.removed = true;
      return true;
    }
    // onEntityHit's else (.decomp PersistentProjectileEntity.java:385-398): the damage was refused
    // (i-frames, creative, an immune target). The target's fire is put back, the arrow turns
    // round at a tenth of its speed (this tick's move then uses THAT velocity), and one that is
    // left all but still (|v|^2 < 1e-7) drops its item when pickup is ALLOWED and is discarded.
    t.remainingFireTicks = fireBefore;
    t.isOnFire = fireBefore > 0;
    e.vx *= Cb.ARROW_BOUNCE; e.vy *= Cb.ARROW_BOUNCE; e.vz *= Cb.ARROW_BOUNCE;
    if (e.vx * e.vx + e.vy * e.vy + e.vz * e.vz < Cb.ARROW_BOUNCE_STILL) {
      if (e.pickupType === Cb.PICKUP_ALLOWED && NS.EntityList && NS.EntityList.dropStack) {
        NS.EntityList.dropStack(e.x, e.y + Cb.ARROW_BOUNCE_DROP_Y, e.z, e.pickupItem || e.type, 1);
      }
      e.removed = true;
    }
    return true;
  };
  Cb.ARROW_BOUNCE = -0.1;            // getVelocity().multiply(-0.1)
  Cb.ARROW_BOUNCE_STILL = 1.0E-7;    // getVelocity().lengthSquared() < 1.0E-7
  Cb.ARROW_BOUNCE_DROP_Y = Math.fround(0.1);   // dropStack(asItemStack(), 0.1F)
  Cb.ARROW_ENTITY_INFLATE = 0.3;   // ProjectileUtil.getEntityCollision's own default overload (0.3F)
  Cb.SPECTRAL_GLOW_TICKS = 200;   // SpectralArrowEntity's own field default (`duration = 200`)

  /**
   * loop/zombievariants-s100 (QUEUE 0.2 G18c) -- `DrownedEntity.attack(LivingEntity, float)`
   * (.decomp, read whole): a REAL `TridentEntity`, velocity `(dx, dy + dist*0.2F, dz)`
   * normalized then scaled by power 1.6F -- the SAME shape `Cb.mobShoot`'s own header already
   * cites for `Mob.performRangedAttack`'s bow half (this IS that same formula, transcribed a
   * second time off DrownedEntity's own override rather than assumed identical). Inaccuracy
   * (`14 - difficulty.getId() * 4`) IS modelled (the gaussian spread below). `Cb.TRIDENT_BASE_DAMAGE` is TridentEntity.onEntityHit's 8.0F
   * (.decomp TridentEntity.java:110; the stale "not in .decomp" caveat was wrong, #2908).
   */
  Cb.TRIDENT_BASE_DAMAGE = 8;
  Cb.TRIDENT_VOID_Y = -64;   // Entity.attemptTickInVoid: y < minY - 64 (#5615 noClip)
  // D-597: DrownedEntity.attack (.decomp DrownedEntity.java:241-250) is the SAME aim as the
  // skeleton's (spawn at getEyeY()-0.1F, getBodyY(1/3), +dist*0.2F, 1.6F, 14-difficulty*4 spread).
  Cb.mobShootTrident = function (e, target, rnd) {
    if (!e || !target || !NS.EntityList) return null;
    rnd = rnd || NS.EntityList.wr;
    var th = target.height || 1.8;
    var ax = e.x, ay = e.y + Cb.eyeHeightOf(e) - Cb.ARROW_SPAWN_BELOW_EYE, az = e.z;
    var dx = target.x - e.x, dz = target.z - e.z;
    var dy = (target.y === undefined ? e.y : target.y) + th / 3 - ay;
    var dist = Math.sqrt(dx * dx + dz * dz);
    dy += dist * Cb.ARROW_ARC;
    var len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    var g = Cb.ARROW_GAUSS_SCALE * (14 - Cb.diffId() * 4), speed = Cb.ARROW_SHOOT_SPEED;
    var vx = (dx / len + Cb.gauss(rnd) * g) * speed;
    var vy = (dy / len + Cb.gauss(rnd) * g) * speed;
    var vz = (dz / len + Cb.gauss(rnd) * g) * speed;
    // DrownedEntity.attack: entity.drowned.shoot 1.0, pitch 1/(r*0.4+0.8)
    if (NS.Sound && NS.Sound.entitySound) NS.Sound.entitySound('entity.drowned.shoot', e.x, e.y, e.z, 1, 1 / (rnd() * 0.4 + 0.8), 'hostile', NS.Player);
    return NS.EntityList.spawn('trident', ax, ay, az, { vx: vx, vy: vy, vz: vz, shooter: e });
  };
  /** Same per-tick shape as `Cb.tickArrow`, its own `ARROW_BASE_DAMAGE` swapped for
   *  `Cb.TRIDENT_BASE_DAMAGE` -- see that function's own header for what neither models. */
  /** BlockState.onProjectileHit dispatch (ProjectileEntity block-hit). PointedDripstoneBlock (.decomp):
   *  only a ThrownTrident faster than 0.6 destroys the tip (level.destroyBlock(pos, true)). */
  Cb.TRIDENT_DRIPSTONE_SPEED = 0.6;
  Cb.onProjectileHit = function (e, x, y, z, speed) {
    var W = NS.World, st = W && W.getBlock(x, y, z);
    if (!st || NS.Reg.names[NS.States.block[st]] !== 'pointed_dripstone') return false;
    if (e.type !== 'trident' || !(speed > Cb.TRIDENT_DRIPSTONE_SPEED)) return false;
    NS.Use.breakForFluid(x, y, z, st);
    return true;
  };
  Cb.tridentBlockHit = function (e) {
    if (e.tvx === undefined) return;
    var bh = Cb.arrowRaycast(e.tpx, e.tpy, e.tpz, e.tvx, e.tvy, e.tvz);
    if (bh) Cb.onProjectileHit(e, bh.cx, bh.cy, bh.cz, Math.sqrt(e.tvx * e.tvx + e.tvy * e.tvy + e.tvz * e.tvz));
    e.tvx = undefined;
  };
  /** TridentEntity.tick (.decomp) over PersistentProjectileEntity.tick: the loyalty return runs first, then
   *  either the noClip move (pos + v, drag, no gravity) or the arrow's own raycast flight (`Cb.tickArrow`,
   *  whose `arrowStrikeEntity` hands a struck target to `Cb.tridentHit`). */
  Cb.tickTrident = function (e) {
    if (e.removed) return;
    if ((e.inGroundTime | 0) > 4) e.dealtDamage = true;   // TridentEntity.tick: inGroundTime > 4 (read BEFORE this tick's ++)
    e.inGroundTime = e.stuck ? (e.inGroundTime | 0) + 1 : 0;   // super.tick's inGround branch
    // #5615 TridentEntity.tick loyalty: dealtDamage or noClip (void) with loyalty > 0 flies home
    var owner = e.shooter, loy = e.loyalty | 0;
    if (!e.noClip && loy > 0 && e.y < Cb.TRIDENT_VOID_Y) e.noClip = true;
    if (loy > 0 && (e.dealtDamage || e.noClip) && owner) {
      var alive = owner === NS.Player ? !(owner.dead || owner.health <= 0 || owner.spectator) : !(owner.removed || owner.dead || owner.health <= 0);
      if (!alive) {
        if (e.pickupType === Cb.PICKUP_ALLOWED && NS.EntityList && NS.EntityList.dropStack) {
          NS.EntityList.dropStack(e.x, e.y + Cb.ARROW_BOUNCE_DROP_Y, e.z, e.pickupItem || 'trident', 1);
        }
        e.removed = true; return;
      }
      e.noClip = true; e.stuck = false; e.onGround = false;
      var dx = owner.x - e.x, dy = owner.y + Cb.eyeHeightOf(owner) - e.y, dz = owner.z - e.z;   // eye - pos, taken BEFORE the setPos
      e.y += dy * 0.015 * loy;
      var len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1, k = 0.05 * loy;
      e.vx = e.vx * 0.95 + dx / len * k; e.vy = e.vy * 0.95 + dy / len * k; e.vz = e.vz * 0.95 + dz / len * k;
      if ((e.returnTimer | 0) === 0 && NS.Sound && NS.Sound.entitySound) NS.Sound.entitySound('item.trident.return', e.x, e.y, e.z, 10, 1, 'neutral', NS.Player);
      e.returnTimer = (e.returnTimer | 0) + 1;
    }
    if (e.noClip) {
      // PersistentProjectileEntity.tick noClip: setPosition(pos + v), v *= drag (0.99, water too), no gravity
      var wetN = Cb.arrowTouchingWater(e);
      e.x += e.vx; e.y += e.vy; e.z += e.vz;
      if (wetN) Cb.projectileBubbles(e, e.x, e.y, e.z, e.vx, e.vy, e.vz);
      var dN = Math.fround(e.drag || 0.99);   // float 0.99F, and TridentEntity.getDragInWater is 0.99F too
      e.vx *= dN; e.vy *= dN; e.vz *= dN;
      Cb.tryArrowPickup(e);   // TridentEntity.onPlayerCollision -> tryPickup (#5614)
      return;
    }
    var wasStuck = !!e.stuck, px = e.x, py = e.y, pz = e.z, pvx = e.vx, pvy = e.vy, pvz = e.vz;
    Cb.tickArrow(e);
    if (!wasStuck && e.stuck && !e.removed) {   // BlockState.onProjectileHit (pointed dripstone) off the flight's own hit
      var bh = Cb.arrowRaycast(px, py, pz, pvx, pvy, pvz);
      if (bh) Cb.onProjectileHit(e, bh.cx, bh.cy, bh.cz, Math.sqrt(pvx * pvx + pvy * pvy + pvz * pvz));
    }
  };
  /** TridentEntity.onEntityHit (.decomp l.108-150): 8.0 damage, dealtDamage = true, velocity * (-0.01,-0.1,-0.01),
   *  item.trident.hit vol 1 -- the trident stays as an entity (no discard). Channeling: see below. */
  Cb.tridentHit = function (e, t) {
    var dmg = Cb.TRIDENT_BASE_DAMAGE, hit;
    if (t === NS.Player) {
      hit = NS.Survival && NS.Survival.hurt ? NS.Survival.hurt(t, 'trident', dmg, e.shooter || null) : false;
    } else {
      hit = Cb.hurt(t, dmg, undefined, false, { attacker: e.shooter || null, projectile: true });
      if (hit) Cb.notifyHurt(t, e.shooter || e);
    }
    e.dealtDamage = true;
    e.vx *= -0.01; e.vy *= -0.1; e.vz *= -0.01;
    var snd = 'item.trident.hit', vol = 1;
    if (NS.Sky && NS.Sky.isThundering && NS.Sky.isThundering() && Cb.enchantLevel({ t: e.pickupTag || null }, 'channeling') > 0) {
      var bx = Math.floor(t.x), by = Math.floor(t.y), bz = Math.floor(t.z);
      if (NS.World && NS.World.canSeeSky && NS.World.canSeeSky(bx, by, bz) && NS.EntityList &&
          NS.EntityList.spawn('lightning_bolt', bx + 0.5, by, bz + 0.5, { channeler: e.shooter || null })) {
        snd = 'item.trident.thunder'; vol = 5;
      }
    }
    if (NS.Sound && NS.Sound.entitySound) NS.Sound.entitySound(snd, e.x, e.y, e.z, vol, 1, 'neutral', NS.Player);
    return true;
  };

  /**
   * loop/snowgolem -- `SnowGolemEntity.attack(LivingEntity, float)` (.decomp, read whole): a
   * real `SnowballEntity` spawned at `(this.getX(), this.getEyeY()-0.1F, this.getZ())`
   * (`ThrownEntity`'s own 3-arg ctor off a `LivingEntity`, .decomp ThrownEntity.java:24-27 --
   * the SAME `getEyeY()-0.1F` spawn height `Cb.ARROW_SPAWN_BELOW_EYE` already names for the
   * bow), aimed at `target.getEyeY() - 1.1F` with the SAME `dist*0.2F` arc `Cb.ARROW_ARC`
   * already names (SnowGolemEntity.java:120-127), then `ProjectileEntity.setVelocity(dx, dy,
   * dz, 1.6F, 12.0F)` -- normalize, add `nextGaussian()*0.0075F*uncertainty` per axis, scale by
   * power. `Cb.ARROW_SHOOT_SPEED`/`Cb.ARROW_GAUSS_SCALE` are the SAME real literals off that
   * SAME `ProjectileEntity.setVelocity` `Cb.mobShootTrident`'s own header already cites;
   * `Cb.SNOWBALL_UNCERTAINTY` (12, not the arrow's difficulty-scaled `14-diff*4`) is the one
   * new literal, transcribed off SnowGolemEntity.java:127 rather than reused from a different
   * mob's own row.
   */
  Cb.SNOWBALL_UNCERTAINTY = 12;   // SnowGolemEntity.attack (.decomp:127): setVelocity(...,1.6F,12.0F)
  Cb.mobShootSnowball = function (e, target, rnd) {
    if (!e || !target || !NS.EntityList) return null;
    rnd = rnd || NS.EntityList.wr;
    var ax = e.x, ay = e.y + Cb.eyeHeightOf(e) - Cb.ARROW_SPAWN_BELOW_EYE, az = e.z;
    var dx = target.x - e.x, dz = target.z - e.z;
    var dy = ((target.y === undefined ? e.y : target.y) + Cb.eyeHeightOf(target) - 1.1) - ay;
    var dist = Math.sqrt(dx * dx + dz * dz);
    dy += dist * Cb.ARROW_ARC;
    var len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    var g = Cb.ARROW_GAUSS_SCALE * Cb.SNOWBALL_UNCERTAINTY, speed = Cb.ARROW_SHOOT_SPEED;
    var vx = (dx / len + Cb.gauss(rnd) * g) * speed;
    var vy = (dy / len + Cb.gauss(rnd) * g) * speed;
    var vz = (dz / len + Cb.gauss(rnd) * g) * speed;
    if (NS.SnowGolem && NS.SnowGolem.playSound) NS.SnowGolem.playSound(e, NS.SnowGolem.SOUND.shoot, NS.SnowGolem.shootPitch(rnd));
    return NS.EntityList.spawn('snowball', ax, ay, az, { vx: vx, vy: vy, vz: vz, shooter: e });
  };

  /**
   * loop/snowgolem -- `SnowballEntity` (.decomp, read whole): `onEntityHit` (:52-57) calls
   * `damage()` UNCONDITIONALLY -- `3.0F` when the struck entity is a blaze, `0.0F` for
   * anything else -- and `onCollision` (:60-66) discards the snowball on ANY hit, block or
   * entity, with no "stuck" state (unlike `PersistentProjectileEntity`'s arrow/trident,
   * embedded by `Cb.tickArrow`/`Cb.tickTrident` above). Those two already stand in
   * `e.onGround` for "hit something solid" with no per-tick block-RAYCAST substrate for a
   * SIDE-wall hit either (their own headers); reused here for the identical reason, named
   * again on `SnowGolem.OWED` rather than silently inherited. The 0-damage branch's
   * knockback/hurt-flash is `Cb.hurtZero`, not `Cb.hurt` (see that function's own header for
   * why `Cb.hurt` cannot take amount 0). The PLAYER is scanned too (#1190), but
   * `PlayerEntity.damage` returns false for a 0 amount (:845), so a hit only discards the
   * snowball -- no flash, no knockback (unlike every other non-blaze target).
   */
  /**
   * `ProjectileUtil.getEntityCollision` for a thrown snowball/egg: the move segment (last tick's position
   * -> this tick's) against the target's box grown by 0.3, slab test. A snowball flies ~1.3 blocks a tick,
   * so the old "end point within 0.25" test let it tunnel through a cow whose box the segment crossed.
   */
  Cb.thrownSweepHits = function (e, t, tw, th) {
    var o = [e.px === undefined ? e.x : e.px, e.py === undefined ? e.y : e.py, e.pz === undefined ? e.z : e.pz];
    var d = [e.x - o[0], e.y - o[1], e.z - o[2]];
    var lo = [t.x - tw / 2 - 0.3, t.y - 0.3, t.z - tw / 2 - 0.3], hi = [t.x + tw / 2 + 0.3, t.y + th + 0.3, t.z + tw / 2 + 0.3];
    var t0 = 0, t1 = 1;
    for (var i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-12) { if (o[i] < lo[i] || o[i] > hi[i]) return false; continue; }
      var a = (lo[i] - o[i]) / d[i], b = (hi[i] - o[i]) / d[i];
      if (a > b) { var c = a; a = b; b = c; }
      if (a > t0) t0 = a; if (b < t1) t1 = b;
      if (t0 > t1) return false;
    }
    return true;
  };
  Cb.tickSnowball = function (e) {
    if (e.removed) return;
    // s119: `SnowballEntity.onCollision` -> `sendEntityStatus(this, 3)` -> `handleStatus(3)`'s
    // 8 snowball crumbs, on EVERY collision (block or entity), before `discard()`.
    if (e.onGround || e.horizontalCollision || e.verticalCollision) { if (NS.GameEvent) NS.GameEvent.emit('projectile_land', e.x, e.y, e.z, e.shooter); Cb.projectileTargetHit(e, false); Cb.snowballCrumbs(e); e.removed = true; return; }
    var list = NS.EntityList && NS.EntityList.list;
    if (!list) return;
    var P = NS.Player;
    for (var i = -1; i < list.length; i++) {
      var t = i < 0 ? P : list[i];
      if (!t || t === e || t.removed || t === e.shooter) continue;
      // ProjectileEntity.canHit: boats and minecarts collide() too (item frames/paintings are not entities here)
      if (t !== P && t.type === 'snowball') continue;
      if (t !== P && t.maxHealth === undefined && t.type !== 'boat' && !Cb.isCart(t)) continue;
      var tw = t.width !== undefined ? t.width : 0.6;
      var th = t.height !== undefined ? t.height : 1.8;
      if (!Cb.thrownSweepHits(e, t, tw, th)) continue;
      // PlayerEntity.damage (:845) `return $$1 == 0.0F ? false : super.damage(...)` -- a 0-damage
      // snowball does NOT hurt-flash or knock back a PLAYER; it is only discarded (onCollision).
      if (t === P) { Cb.snowballCrumbs(e); e.removed = true; return; }
      if (t.type === 'blaze') {
        var hit = Cb.hurt(t, 3, undefined, false, { attacker: e.shooter || null });
        if (hit) Cb.notifyHurt(t, e.shooter || e);
      } else if (t.maxHealth !== undefined) {
        Cb.hurtZero(t, e.shooter || e);
      }   // boat/cart: damage(0) is a no-op beyond the discard
      Cb.snowballCrumbs(e);
      e.removed = true;
      return;
    }
  };
  /** s119: the particle half of `SnowballEntity.onCollision` (client stream, its own random). */
  Cb.snowballCrumbs = function (e) {
    var Px = NS.Particle;
    return (Px && Px.spawnSnowballBurst) ? Px.spawnSnowballBurst(e.x, e.y, e.z) : 0;
  };

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
