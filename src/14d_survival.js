// 14d_survival.js — PLAN G5. Health, hunger, damage, death, respawn and experience.
//
// Main thread only. Like 14b_physics.js this takes an ENTITY and mutates it; it reads no input
// device and touches no DOM, so a whole simulated life can be run inside a check.
//
// ⚠ EVERY NUMBER IN THIS FILE CAME OUT OF THE 1.18.2 SERVER JAR (D-252), not out of the wiki and
// not out of PLAN. `FoodData.tick`, `FoodData.eat`, `Player.getXpNeededForNextLevel` and
// `CombatRules.getDamageAfterAbsorb` were disassembled through Mojang's official mappings on the
// machine that has Java, the same route D-229 and D-250 opened. Where a number could NOT be read
// that way it is marked `hand-sourced` in the comment beside it, and there are four of them.
//
// The order inside a tick matters and is vanilla's: exhaustion is spent first, then regeneration
// or starvation is considered, then the damage cooldown ages. A loop that heals before it spends
// exhaustion regenerates on food it has not got.

(function (NS) {
  'use strict';

  var Sv = NS.Survival = {
    // ── the constants, all from FoodData.tick / FoodData.eat unless marked ────────────────
    MAX_HEALTH: 20,          // Attributes.MAX_HEALTH default, read from the jar (D-250)
    MAX_FOOD: 20,
    START_SATURATION: 5,     // hand-sourced: FoodData's field initialiser
    EXHAUSTION_STEP: 4.0,    // spend 4 exhaustion to lose 1 saturation, then 1 food
    EXHAUSTION_CAP: 40.0,    // addExhaustion clamps here

    // ── breath (D-292), every number read out of the 1.18.2 bytecode ──────────────────────
    // ⚠ `Entity.getMaxAirSupply()` is a literal `sipush 300`; `LivingEntity.increaseAirSupply`
    // is `min(air + 4, max)`; `decreaseAirSupply` is `air - 1` once the Respiration branch is
    // out; and `LivingEntity.baseTick` hurts for `fconst_2` when the counter reaches −20, then
    // resets it to 0 — so the FIRST heart costs 320 ticks and every later one 20.
    // ⚠ THE PLAYER REFILLS AT 4 A TICK, NOT INSTANTLY. `AbstractFish.handleAirSupply` sets the
    // counter straight back to 300, and it is the first thing you find when you go looking for
    // drowning in the jar — it is the FISH's override, not the shared path. Reading it as the
    // player's would have refilled fifteen seconds of breath in a single tick.
    MAX_AIR: 300,
    AIR_REFILL: 4,
    DROWN_AT: -20,
    DROWN_DAMAGE: 2,
    FAST_REGEN_FOOD: 20,     // saturated healing needs a FULL bar
    FAST_REGEN_TICKS: 10,
    FAST_REGEN_MAX: 6.0,
    SLOW_REGEN_FOOD: 18,
    SLOW_REGEN_TICKS: 80,
    SLOW_REGEN_EXHAUST: 6.0,
    STARVE_TICKS: 80,
    INVULNERABLE_TICKS: 20,  // hand-sourced: LivingEntity.invulnerableTime, the classic 10 ticks
                             // of red flash is HALF this; the field is 20 and hurt() compares
                             // against invulnerableTime > 10 before allowing a stronger hit.
    INVULN_STRONGER_ABOVE: 10,  // LivingEntity.java:1059 `timeUntilRegen > 10.0F`: below it a full hit lands again

    // Exhaustion per action. ⚠ The two movement ones are read off
    // `Player.checkMovementStatistics`, which works in CENTIMETRES: it rounds distance*100 and
    // then spends `rate * cm * 0.01`, so the rate below is per BLOCK. The jump pair is
    // hand-sourced from `Player.jumpFromGround`'s override.
    EX_SPRINT: 0.1,          // per block sprinted
    EX_WALK: 0.01,           // per block walked or swum
    EX_JUMP: 0.05,           // hand-sourced
    EX_SPRINT_JUMP: 0.2,     // hand-sourced
    EX_MINE: 0.005,          // hand-sourced: Player.attack/destroyBlock
    EX_DAMAGE: 0.1,          // hand-sourced: LivingEntity.hurt

    // ── damage sources ───────────────────────────────────────────────────────────────────
    // `bypassArmor` is vanilla's `isBypassArmor`; `bypassInvuln` skips the hit cooldown, which is
    // what makes drowning and starving tick steadily instead of once every second.
    DAMAGE: {
      // loop s111 — re-read against .decomp DamageSource.java:17-39: GENERIC, FALL, IN_FIRE
      // are all `setBypassesArmor()` (armour never reduced fall damage in vanilla — only
      // Feather Falling/Protection do), and every `setBypassesArmor()` source also zeroes its
      // own exhaustion (:176-179) — `Sv.hurt` reads `bypassArmor` for both now.
      // `unblockable`/`fall`/`explosive`/`projectile` (+ `fire`) are the DamageSource flags
      // `Sv.protectionOf` reads (ProtectionEnchantment.getProtectionAmount, .decomp :32-46);
      // STARVE is the only `setUnblockable()` source (DamageSource.java:25).
      generic:  { bypassArmor: true,  bypassInvuln: false },
      fall:     { bypassArmor: true,  bypassInvuln: false, fall: true },
      stalagmite: { bypassArmor: true, bypassInvuln: false, fall: true },
      starve:   { bypassArmor: true,  bypassInvuln: false, unblockable: true },
      drown:    { bypassArmor: true,  bypassInvuln: false },
      inFire:   { bypassArmor: true,  bypassInvuln: false, fire: true },
      onFire:   { bypassArmor: true,  bypassInvuln: false, fire: true },
      lava:     { bypassArmor: false, bypassInvuln: false, fire: true },
      hotFloor: { bypassArmor: false, bypassInvuln: false, fire: true },   // DamageSource.HOT_FLOOR
      inWall:   { bypassArmor: true,  bypassInvuln: false },               // DamageSource.IN_WALL
      freeze:   { bypassArmor: true,  bypassInvuln: false },               // DamageSource.FREEZE
      cactus:   { bypassArmor: false, bypassInvuln: false },
      sweetBerryBush: { bypassArmor: false, bypassInvuln: false },   // DamageSource.SWEET_BERRY_BUSH
      outOfWorld: { bypassArmor: true, bypassInvuln: true, absolute: true },
      magic:    { bypassArmor: true,  bypassInvuln: false },
      // #1597 -- `DamageSource.thorns(attacker)`: setThorns().setUsesMagic() -- NO setBypassesArmor, armour applies.
      thorns:   { bypassArmor: false, bypassInvuln: false },
      wither:   { bypassArmor: true,  bypassInvuln: false },
      // `DamageSource.explosion(...)`: setScaledWithDifficulty().setExplosive() — armour applies.
      explosion: { bypassArmor: false, bypassInvuln: false, scaled: true, explosive: true },
      // `DamageSource.badRespawnPoint()` (BedBlock/RespawnAnchorBlock): setScaledWithDifficulty().setExplosive() -- same flags as explosion.
      badRespawnPoint: { bypassArmor: false, bypassInvuln: false, scaled: true, explosive: true },
      // D-394 — PLAN G18b's mob-strike row (`Cb.mobAttack`, called from `Ai.MeleeAttackGoal`):
      // `DamageSource.mobAttack` bypasses neither armor nor the invulnerability window, same as
      // `generic` — the lang key is what differs ("was slain by <mob>" vs "died").
      // loop s111 — `scaled`: `EntityDamageSource.isScaledWithDifficulty` is true when the
      // source is a non-player LivingEntity (a mob's own blow — EntityDamageSource.java:45-47),
      // and `DamageSource.explosion` sets it explicitly (DamageSource.java:111-112). A
      // projectile's source is the PROJECTILE, not a LivingEntity, so arrow/trident/spit are not.
      mob:      { bypassArmor: false, bypassInvuln: false, scaled: true },
      // #2544 -- `DamageSource.sting(bee)` is an EntityDamageSource like mob (scaled); only the lang key differs.
      sting:    { bypassArmor: false, bypassInvuln: false, scaled: true },
      // D-402 — PLAN G17c/16's own `RangedBowAttackGoal` row: `DamageSource.arrow` is the same
      // shape as `mob` (armor and the invulnerability window both apply) — only the lang key
      // ("shot by <mob>") differs, exactly as `mob`'s own comment above already states for its
      // own pair. `projectile: true` is the flag `Sv.protectionOf` below reads for
      // `projectile_protection` -- the one damage-source flag the PLAYER's own armour path
      // covers so far (playerarmorrefcheck fix, this unit). NOT the same object as the literal
      // `{ source: 'projectile' }` tag `Cb.hurt` (14j_combat.js) reads for a MOB target's own
      // shulker/enderman gates -- two unrelated flags that happen to share a name.
      arrow:    { bypassArmor: false, bypassInvuln: false, projectile: true },
      // #2557 -- `DamageSource.mobProjectile` (LlamaSpitEntity): ProjectileDamageSource("mob", spit, owner): lang key `death.attack.mob` naming the OWNER, setProjectile(); not scaled (the source is the spit, not a LivingEntity).
      mobProjectile: { bypassArmor: false, bypassInvuln: false, projectile: true, key: 'mob' },
      // #647 -- `DamageSource.fireball(fireball, owner)`: setProjectile() + setFire() -- armour and
      // the invulnerability window both apply, `projectile_protection` reads it, lang key
      // `death.attack.fireball` ("was fireballed by").
      fireball: { bypassArmor: false, bypassInvuln: false, projectile: true, scaled: true, fire: true },
      // #1756 -- `DamageSource.witherSkull(skull, owner)`: setProjectile() -- armour and the window
      // apply; lang key `death.attack.witherSkull` ("was shot by a skull from <owner>").
      witherSkull: { bypassArmor: false, bypassInvuln: false, projectile: true }
    },

    // ── experience ───────────────────────────────────────────────────────────────────────
    // `Player.getXpNeededForNextLevel`, exactly: >=30 -> 112 + (L-30)*9, >=15 -> 37 + (L-15)*5,
    // else 7 + L*2. PLAN writes the same three lines as 2L+7 / 5L-38 / 9L-158, which is the same
    // function; this is the form the game actually computes, so it is the form that is here.
    xpNeeded: function (level) {
      if (level >= 30) return 112 + (level - 30) * 9;
      if (level >= 15) return 37 + (level - 15) * 5;
      return 7 + level * 2;
    }
  };

  /** Give an entity the survival fields. Idempotent, so a respawn can reuse it. */
  Sv.init = function (e) {
    e.health = Sv.MAX_HEALTH;
    e.maxHealth = Sv.MAX_HEALTH;
    e.absorption = 0;
    e.food = Sv.MAX_FOOD;
    e.saturation = Sv.START_SATURATION;
    e.exhaustion = 0;
    e.foodTimer = 0;
    e.lastFood = Sv.MAX_FOOD;
    e.invulnerable = 0;
    e.lastHurt = 0;
    e.air = Sv.MAX_AIR;
    e.xpLevel = 0;
    e.xpProgress = 0;         // 0..1 through the current level
    e.xpTotal = 0;
    e.dead = false;
    e.deathTicks = 0;
    e.deathCause = null;
    e.damageTracker = null;
    e.armor = e.armor || 0;
    e.armorToughness = e.armorToughness || 0;
    e.naturalRegen = true;
    return e;
  };

  Sv.isHurt = function (e) { return e.health > 0 && e.health < (e.maxHealth || Sv.MAX_HEALTH); };

  /**
   * Recompute `armor`, `armorToughness` and `knockbackResistance` from what is WORN (D-291).
   *
   * ⚠ THIS IS THE FUNCTION THAT WAS MISSING FOR FOUR STAGES. `Sv.afterArmor` below is vanilla's
   * own `CombatRules.getDamageAfterAbsorb`, read out of the bytecode in G5; G8 gave the player
   * four armour slots; D-266 made shift-click put a helmet in the right one. Nobody ever wrote
   * the line that turns the one into the other, so `e.armor` was `0` at every call and the
   * formula was a no-op — and `15_hud.js` asked for `P.armour`, which is not a field, so the row
   * that would have shown the zero was never drawn either (D-290). Two independent silences over
   * the same missing number.
   *
   * ⚠ IT SUMS THE ARMOUR SLOTS ONLY. Vanilla reads `EquipmentSlot.Type.ARMOR` slots, not the
   * hand slots: a pickaxe held in the hand protects nothing, and neither does a chestplate in
   * the backpack. `Inventory.ARMOR_START..+4` is that band.
   */
  Sv.updateArmor = function (e, inv) {
    var Iv = NS.Inventory, IT = NS.Items;
    var armor = 0, toughness = 0, knockback = 0, resp = 0, aqua = false, depth = 0, frost = 0;
    var Cb = NS.Combat;
    if (Iv && IT && IT.ready && inv && inv.slots) {
      for (var i = 0; i < 4; i++) {
        var st = inv.slots[Iv.ARMOR_START + i];
        if (Iv.isEmpty(st)) continue;
        // `EnchantmentHelper.getEquipmentLevel` = the MAX over the slots the enchantment lists
        // (respiration/aqua_affinity/depth_strider: ALL_ARMOR; frost_walker: FEET only, i = 0).
        if (Cb && Cb.enchantLevel) {
          resp = Math.max(resp, Cb.enchantLevel(st, 'respiration'));
          if (Cb.enchantLevel(st, 'aqua_affinity') > 0) aqua = true;
          depth = Math.max(depth, Cb.enchantLevel(st, 'depth_strider'));
          if (i === 0) frost = Cb.enchantLevel(st, 'frost_walker');
        }
        armor += IT.defenseOf(st.i);
        toughness += IT.toughnessOf(st.i);
        // ⚠ knockback resistance ADDS across pieces in vanilla (it is an attribute modifier per
        // piece), which is why a full netherite set resists 0.4 and not 0.1.
        knockback += IT.knockbackOf(st.i);
      }
    }
    e.respiration = resp; e.aquaAffinity = aqua; e.depthStrider = depth; e.frostWalker = frost;
    e.armor = armor;
    e.armorToughness = toughness;
    e.knockbackResistance = Math.min(1, knockback);
    return armor;
  };

  Sv.addExhaustion = function (e, x) {
    if (e.dead || e.invulnerableGamemode) return;
    e.exhaustion = Math.min(e.exhaustion + x, Sv.EXHAUSTION_CAP);
  };

  Sv.heal = function (e, amount) {
    if (e.dead || amount <= 0) return;
    e.health = Math.min(e.health + amount, e.maxHealth || Sv.MAX_HEALTH);
  };

  /**
   * eat(e, nutrition, saturationModifier) — `FoodData.eat(int, float)`, exactly:
   *     food = min(nutrition + food, 20)
   *     saturation = min(saturation + nutrition * modifier * 2, food)
   * ⚠ the saturation ceiling is the FOOD LEVEL, not 20, which is why eating one bread on an empty
   * stomach gives you almost no saturation.
   */
  Sv.eat = function (e, nutrition, saturationModifier) {
    if (e.dead) return;
    e.food = Math.min(nutrition + e.food, Sv.MAX_FOOD);
    e.saturation = Math.min(e.saturation + nutrition * saturationModifier * 2, e.food);
  };

  Sv.canEat = function (e, alwaysEdible) { return alwaysEdible || e.food < Sv.MAX_FOOD; };

  /**
   * The armour formula, `CombatRules.getDamageAfterAbsorb`, read out of the bytecode:
   *     f  = 2 + toughness/4
   *     f1 = clamp(armor - damage/f, armor*0.2, 20)
   *     return damage * (1 - f1/25)
   * With no armour it returns the damage unchanged, which is the only case G5 can reach — armour
   * items arrive in G8 — but the formula is here rather than a `return damage` stub so that G8
   * inherits a tested one (D-139: a stage that replaces something must delete the something).
   */
  Sv.afterArmor = function (damage, armor, toughness) {
    if (!armor) return damage;
    var F = Math.fround;   // DamageUtil.getDamageLeft is float arithmetic: the last bit matters to the lockstep traces (#9216)
    var f = F(2 + F((toughness || 0) / 4));
    var f1 = Math.max(F(armor * 0.2), Math.min(F(armor - F(damage / f)), 20));
    return F(damage * F(1 - F(f1 / 25)));
  };

  /**
   * hurt(e, type, amount) — returns true if the hit landed.
   *
   * ⚠ THE COOLDOWN IS NOT "IGNORE EVERYTHING FOR 20 TICKS" (vanilla's `LivingEntity.hurt`): a
   * hit inside the window still lands if it is STRONGER than the one that opened it, and only
   * the difference is applied. Getting this wrong is how a clone ends up either invincible in a
   * fire or taking twenty ticks of cactus damage at once.
   */
  Sv.difficulty = function () { return (NS.Diff && NS.Diff.get) ? NS.Diff.get() : 'normal'; };
  Sv.scaleForDifficulty = function (a) {
    var d = Sv.difficulty();
    if (d === 'peaceful') return 0;
    if (d === 'easy') return Math.min(a / 2 + 1, a);
    if (d === 'hard') return a * 3 / 2;
    return a;
  };
  /** `GameRules.NATURAL_REGENERATION` (field_19395), live since loop s111; true by default. */
  Sv.naturalRegenRule = function () {
    var C = NS.Commands;
    return !(C && C.ruleGet && C.ruleGet('naturalRegeneration') === 'false');
  };

  /**
   * `EnchantmentHelper.getProtectionAmount(getArmorItems(), source)` for the player: per worn
   * piece, `ProtectionEnchantment.getProtectionAmount` (.decomp ProtectionEnchantment.java:32-46)
   * -- 0 for out-of-world; `protection` lvl for anything else; fire x2, feather_falling x3,
   * blast x2, projectile x2 only for their own source flag. An unblockable source skips it all.
   */
  Sv.protectionOf = function (e, src) {
    var Iv = NS.Inventory, Cb = NS.Combat, inv = e && e.inventory;
    if (!src || src.unblockable || src.absolute || !Iv || !Cb || !Cb.enchantLevel || !inv || !inv.slots) return 0;
    var t = 0;
    for (var i = 0; i < 4; i++) {
      var st = inv.slots[Iv.ARMOR_START + i];
      if (Iv.isEmpty(st)) continue;
      t += Cb.enchantLevel(st, 'protection');
      if (src.fire) t += 2 * Cb.enchantLevel(st, 'fire_protection');
      if (src.fall) t += 3 * Cb.enchantLevel(st, 'feather_falling');
      if (src.explosive) t += 2 * Cb.enchantLevel(st, 'blast_protection');
      if (src.projectile) t += 2 * Cb.enchantLevel(st, 'projectile_protection');
    }
    return t;
  };

  // Entity.getFreezingScale: ticksFrozen / ticksRequiredToFreeze (140), clamped 0..1. The counter is
  // `frozenTicks` (07i_entitylist.js); InGameHud draws powder_snow_outline.png at this alpha when > 0.
  Sv.freezeScale = function (e) {
    var f = (e && e.frozenTicks | 0) / 140;
    return f < 0 ? 0 : f > 1 ? 1 : f;
  };

  // ── Frost Walker (.decomp FrostWalkerEnchantment.freezeWater, called from
  // LivingEntity.applyMovementEffects with the block under the feet) ─────────────────────────
  // Water source cells within min(16, 2+lvl) of the walker, one layer below the feet, with air
  // above, become frosted_ice (age 0) with a first scheduled tick at nextInt(60,120); the age ladder and
  // melt are FrostedIceBlock's (Behave.frostedTick, #5721).
  Sv.freezeWater = function (e, world) {
    var St = NS.States, W = world || NS.World;
    if (!e.onGround || !St || !W || !W.getBlock || !W.setBlock) return 0;
    var lvl = e.frostWalker | 0;
    if (lvl <= 0) return 0;
    var water = St.stateOf('water'), ice = St.stateOf('frosted_ice');
    var rad = Math.min(16, 2 + lvl), n = 0;
    var bx = Math.floor(e.x), by = Math.floor(e.y - 0.5), bz = Math.floor(e.z);
    for (var dx = -rad; dx <= rad; dx++) for (var dz = -rad; dz <= rad; dz++) {
      var x = bx + dx, y = by, z = bz + dz;
      // BlockPos.isWithinDistance(pos, r): the CELL's corner-origin to the entity, squared.
      var ex = x - e.x, ey = y - e.y, ez = z - e.z;
      if (ex * ex + ey * ey + ez * ez >= rad * rad) continue;
      if (W.getBlock(x, y + 1, z) !== 0) continue;
      if (W.getBlock(x, y, z) !== water) continue;
      if (W.setBlock(x, y, z, ice)) {
        if (NS.Behave && NS.Behave.schedule) NS.Behave.schedule(x, y, z, 60 + Math.floor(Math.random() * 61));
        n++;
      }
    }
    return n;
  };
  Sv.frostTick = function () {};   // retired (#5721): scheduled ticks run in Behave.tick

  // #512 -- the four damage gamerules (`GameRules.FALL_DAMAGE` / `DROWNING_DAMAGE` / `FIRE_DAMAGE` /
  // `FREEZE_DAMAGE`), read where every source of that type funnels through. Unset = default true.
  var RULE_OF_SOURCE = { fall: 'fallDamage', stalagmite: 'fallDamage', drown: 'drowningDamage', inFire: 'fireDamage', onFire: 'fireDamage',
    lava: 'fireDamage', hotFloor: 'fireDamage', freeze: 'freezeDamage' };
  Sv.ruleOn = function (name) {
    var C = NS.Commands;
    return !(C && typeof C.ruleGet === 'function' && C.ruleGet(name) === 'false');
  };
  /** `LivingEntity.tryUseTotem`: skipped for OUT_OF_WORLD; MAIN_HAND then OFF_HAND, first totem is shrunk by 1
   *  (creative too), health 1, all effects cleared, Regeneration II 900t, Absorption II 100t, Fire Resistance 800t. */
  Sv.tryUseTotem = function (e, src) {
    if (!e || (src && (src.absolute || src.source === 'void' || src.source === 'outOfWorld'))) return false;
    var IT = NS.Items, Iv = NS.Inventory, id = IT ? IT.of('totem_of_undying') : -1;
    if (id < 0) return false;
    var hit = false;
    if (e.inventory && e.inventory.slots && Iv) {
      var slots = [e.inventory.selected, Iv.OFFHAND];
      for (var k = 0; k < 2 && !hit; k++) {
        var st = Iv.getItem(e.inventory, slots[k]);
        if (st && st.n > 0 && st.i === id) { st.n--; if (st.n <= 0) Iv.setItem(e.inventory, slots[k], Iv.EMPTY); hit = true; }
      }
    } else if (e.equip) {
      for (var j = 0; j < 2 && !hit; j++) {
        var q = e.equip[j];
        if (q && q.n > 0 && q.i === id) { q.n--; if (q.n <= 0) e.equip[j] = null; hit = true; }
      }
    }
    if (!hit) return false;
    e.health = 1;
    var F = NS.Effects;
    if (F) {
      F.clearStatusEffects(e);
      F.addStatusEffect(e, 'regeneration', 900, 1);
      F.addStatusEffect(e, 'absorption', 100, 1);
      F.addStatusEffect(e, 'fire_resistance', 800, 0);
    }
    if (NS.Adv && NS.Adv.trigger && (e === NS.Player || e.type === 'player'))
      NS.Adv.trigger(e, 'minecraft:used_totem', { player: e, item: { id: 'minecraft:totem_of_undying', count: 1 } });
    if (NS.Particle && NS.Particle.totemActivated) NS.Particle.totemActivated(e);
    return true;
  };
  Sv.hurt = function (e, type, amount, attacker) {
    if (e.dead || e.invulnerableGamemode) return false;
    if (e.shoulderLeft || e.shoulderRight) NS.Fly.dropShoulderEntities(e);   // PlayerEntity.damage
    if (RULE_OF_SOURCE[type] && !Sv.ruleOn(RULE_OF_SOURCE[type])) return false;
    var src = Sv.DAMAGE[type] || Sv.DAMAGE.generic;
    // loop s111 (Diff.OWED "damage scaling") — `PlayerEntity.damage` (.decomp :831-845), BEFORE
    // `LivingEntity.damage`'s invulnerability window: PEACEFUL 0, EASY min(a/2+1, a), HARD a*3/2,
    // NORMAL unchanged; a scaled-to-zero hit returns false outright.
    if (src.scaled) {
      amount = Sv.scaleForDifficulty(amount);
      if (amount === 0) return false;
    }
    // #296 — `LivingEntity.damage`'s own gate (.decomp :1032), after isDead and before the
    // invulnerability window: an `isFire()` source (in_fire/on_fire/lava) does nothing at all
    // to an entity with Fire Resistance — no health, no hit cooldown, no knockback.
    if (src.fire && NS.Effects && NS.Effects.hasStatusEffect(e, 'fire_resistance')) return false;
    // #862 -- LivingEntity.damage: a blocked hit is zeroed (durability, then takeShieldHit for a
    // melee attacker); the rest of the pipeline still runs with 0, as vanilla's does.
    var Us = NS.Use, amountBefore = amount, wasBlocked = false;
    if (amount > 0 && Us && Us.blockedByShield && Us.blockedByShield(e, src, attacker)) {
      wasBlocked = true;
      Us.shieldSound(e, 'item.shield.block', 1);
      Us.damageShield(e, amount);
      amount = 0;
      if (!src.projectile) Us.takeShieldHit(e, attacker);
    }
    var fresh = true, fullAmount = amount;
    if (!src.bypassInvuln && e.invulnerable > Sv.INVULN_STRONGER_ABOVE) {
      if (amount <= e.lastHurt) return false;
      fullAmount = amount;
      amount = amount - e.lastHurt;                 // only the excess lands
      fresh = false;
    }
    var dealt = src.absolute ? amount
              : (src.bypassArmor ? amount : Sv.afterArmor(amount, e.armor, e.armorToughness));
    // PlayerInventory.damageArmor: each worn piece takes max(1, floor(amount/4)) on the pre-armour amount.
    if (!src.bypassArmor && !src.absolute && amount > 0 && e.inventory && NS.Effects && NS.Effects.damageArmorPiece) {
      var wear = Math.max(1, Math.floor(amount / 4));
      for (var ai = 0; ai < 4; ai++) NS.Effects.damageArmorPiece(e.inventory, NS.Inventory.ARMOR_START + ai, wear);
    }
    // QUEUE 0.2 (07q_effects.js, not owned by this file — a single necessary line) —
    // `LivingEntity.applyEnchantmentsToDamage`'s Resistance branch runs AFTER armor and BEFORE
    // absorption, skipped only for `DamageSource.OUT_OF_WORLD` (`src.absolute` here — the void
    // damage type already bypasses this whole formula above, so nothing further to bypass).
    if (!src.absolute && NS.Effects && NS.Effects.applyResistance) dealt = Math.fround(NS.Effects.applyResistance(e, dealt));
    // QUEUE 0.2 (playerarmorrefcheck fix, this unit; meleerefcheck cloud referee-mob-melee) --
    // `LivingEntity.applyEnchantmentsToDamage`'s Protection-family reduction
    // (`DamageUtil.getInflictedDamage`, 07y_equip.js's own `Eq.protectionReduce`, already shared
    // with the mob path `Cb.hurt` runs, 14j_combat.js), same order as vanilla: after armour-absorb
    // and Resistance. The player's enchants were never read before -- Protection IV armour took
    // the same hit as bare diamond. `Sv.protectionOf` itself gates on `src.unblockable`/
    // `src.absolute`, so no separate `!src.absolute` check is needed here.
    var prot = Sv.protectionOf(e, src);
    if (prot > 0 && dealt > 0 && NS.Equip && NS.Equip.protectionReduce) dealt = NS.Equip.protectionReduce(dealt, prot);
    if (e.absorption > 0) {
      var absorbed = Math.min(e.absorption, dealt);
      e.absorption = Math.fround(e.absorption - absorbed);
      dealt = Math.fround(dealt - absorbed);
    }
    e.health = Math.fround(Math.max(0, e.health - dealt));
    if (!src.bypassInvuln) {
      if (fresh) e.invulnerable = Sv.INVULNERABLE_TICKS;   // LivingEntity.java:1059-1065: an excess hit leaves the timer alone
      e.lastHurt = fullAmount;
    }
    if (!src.bypassArmor && dealt > 0) Sv.addExhaustion(e, Sv.EX_DAMAGE);   // DamageSource.java:176-179; Player.actuallyHurt returns before it when absorption/armor/resistance left 0
    e.lastDamageType = type;
    if (NS.DamageTracker) NS.DamageTracker.onDamage(e, src.key || type, attacker && src.key && attacker.shooter || attacker, dealt, type === 'fall' ? (e.fallDistance || amount + 3) : 0);
    // LivingEntity.damage :1162 -- Criteria.ENTITY_HURT_PLAYER.trigger(player, source, amountBefore, taken, blocked)
    if (e === NS.Player && NS.Adv && NS.Adv.trigger) {
      var asub = attacker ? { type: 'minecraft:' + attacker.type, x: attacker.x, y: attacker.y, z: attacker.z } : null;
      NS.Adv.trigger(e, 'minecraft:entity_hurt_player', { dealt: amountBefore, taken: dealt, blocked: wasBlocked,
        source: { projectile: !!src.projectile, fire: !!src.fire, bypassesArmor: !!src.bypassArmor, outOfWorld: !!src.absolute,
          source: asub, attacker: asub },
        pctx: { origin: [e.x, e.y, e.z] } });
    }
    // s135 — `LivingEntity.damage`'s base knockback (0.4 away from the attacker, fresh hits only);
    // the player had none, so a zombie's blow never pushed you (Combat.baseKnockback, 14j_combat.js).
    if (fresh && attacker && attacker !== e && NS.Combat && NS.Combat.baseKnockback) NS.Combat.baseKnockback(e, attacker);
    if (e === NS.Player && NS.Sound) {   // PlayerEntity.getHurtSound / getDeathSound (:645-658)
      var hs = e.health <= 0 ? 'entity.player.death' : type === 'onFire' ? 'entity.player.hurt_on_fire'
        : type === 'drown' ? 'entity.player.hurt_drown' : type === 'sweetBerryBush' ? 'entity.player.hurt_sweet_berry_bush'
        : type === 'freeze' ? 'entity.player.hurt_freeze' : 'entity.player.hurt';
      NS.Sound.play(hs, { volume: 1, pitch: (Math.random() - Math.random()) * 0.2 + 1 });
    }
    if (e.health <= 0 && Sv.tryUseTotem(e, src)) return true;
    if (e.health <= 0) {
      // the attacker names the killer; Cb.mobAttack sets killedBy only after hurt() returns (#3881)
      var T = NS.Text;
      var owner = attacker && src.key && attacker.shooter || attacker;   // a projectile's death message names its owner
      if (!e.killedBy && owner && owner.type && T && T.plain) e.killedBy = T.entityDisplayName(owner);
      if (owner && owner.equip && NS.Items && T && T.heldItemName) e.killedByItem = T.heldItemName(owner.equip[NS.Items.MAINHAND]);   // ProjectileDamageSource uses the OWNER's hand
      Sv.die(e, src.key || type);
    }
    return true;
  };

  Sv.keepInventory = function () {
    var C = NS.Commands;
    if (C && typeof C.ruleGet === 'function') return C.ruleGet('keepInventory') === 'true';
    var r = NS.DATA && NS.DATA.gameRules && NS.DATA.gameRules.keepInventory;
    return !!r && r.d === 'true';
  };

  Sv.xpToDrop = function (e) {
    if (Sv.keepInventory() || e.mode === 3) return 0;   // 3 = spectator (14e_gamemode)
    return Math.min((e.xpLevel || 0) * 7, 100);
  };

  Sv.die = function (e, cause) {
    if (e.dead) return;
    if (NS.Stats && e === NS.Player) NS.Stats.onDeath();   // G26a
    if (e === NS.Player) e.timeSinceRest = 0;   // ServerPlayerEntity.onDeath: resetStat TIME_SINCE_DEATH + TIME_SINCE_REST
    e.dead = true;
    e.health = 0;
    e.deathTicks = 0;
    e.deathCause = cause || 'generic';
    // `PlayerEntity.getXpToDrop`: level*7 capped at 100, 0 under keepInventory or spectator;
    // `LivingEntity.dropXp` spawns the orbs (shouldAlwaysDropXp is true for a player).
    e.xpDropped = Sv.xpToDrop(e);
    if (e.xpDropped > 0 && NS.Xp && NS.Xp.spawn) NS.Xp.spawn(e.x, e.y, e.z, e.xpDropped);
    // ⚠ THE DEATH MESSAGE IS VANILLA'S STRING FOR THE SOURCE (D-282), not "You died" for
    // everything: falling says "hit the ground too hard", lava says "tried to swim in lava", and
    // the source ids here are named exactly as `death.attack.<id>` names them so the mapping is
    // the identity rather than a table that can drift. `textcheck` §6 asserts every source
    // resolves, reading THIS table rather than a copy of it.
    // ServerPlayerEntity.onDeath -> Criteria.ENTITY_KILLED_PLAYER.trigger(this, attacker, source)
    if (e === NS.Player && NS.Adv && NS.Adv.trigger && e.advancements) {
      var atk = e.deathAttacker || null;
      NS.Adv.trigger(e, 'minecraft:entity_killed_player', { player: e, entity: atk, damage: { source: e.deathCause, attacker: atk } });
    }
    var T = NS.Text;
    if (T && T.ready) {
      e.deathMessage = NS.DamageTracker && e.damageTracker && e.damageTracker.records.length ? NS.DamageTracker.message(e, e.deathCause) : T.deathMessage(e.name || 'Player', e.deathCause, e.killedBy || null, e.killedByItem || null);
      if (NS.Chat && Sv.ruleOn('showDeathMessages')) NS.Chat.add(e.deathMessage);
    }
  };

  /**
   * `ServerPlayerEntity.moveToSpawn`: a respawn without a bed lands on a random column of the
   * (2r+1)^2 square around the world spawn, r = max(0, `spawnRadius`) (default 10). r = 0 is the
   * spawn column itself. `rnd` is a 0..1 source (Math.random by default).
   */
  Sv.spawnScatter = function (cx, cz, rnd) {
    var C = NS.Commands, r = 10;
    if (C && typeof C.ruleGet === 'function') r = parseInt(C.ruleGet('spawnRadius'), 10);
    if (!(r > 0)) r = 0;
    var side = r * 2 + 1, i = Math.floor((rnd || Math.random)() * side * side);
    return { x: cx + (i % side) - r, z: cz + Math.floor(i / side) - r };
  };

  Sv.respawn = function (e) {
    var keepXp = Sv.keepInventory() ? { l: e.xpLevel, p: e.xpProgress, t: e.xpTotal } : null;   // vanilla: XP is lost unless keepInventory
    Sv.init(e);
    if (keepXp) { e.xpLevel = keepXp.l; e.xpProgress = keepXp.p; e.xpTotal = keepXp.t; }
    e.fallDistance = 0;
    e.pendingFallDamage = 0;
    return e;
  };

  /**
   * addXp(e, points) — the level and the bar, derived from an INTEGER total.
   *
   * ⚠ THE FIRST VERSION CARRIED THE BAR IN FLOATING POINT, THE WAY `giveExperiencePoints`
   * DOES, and adding 385 points one at a time landed on level 9 with a bar reading 0.99999998
   * instead of level 10. Vanilla gets away with it because it also keeps `totalExperience` and
   * because a player rarely gains 385 single points; a check that adds them one at a time does
   * not get away with it. The total is authoritative here and the display is derived from it,
   * which is exact by construction and agrees with the float form everywhere it matters.
   */
  Sv.addXp = function (e, points) {
    var before = e.xpLevel || 0;
    e.xpTotal = Math.max(0, (e.xpTotal || 0) + points);
    Sv.syncXp(e);
    // PlayerEntity.addExperience: each level crossed is one addExperienceLevels(1)
    for (var l = before + 1; l <= e.xpLevel; l++) Sv.levelUpSound(e, l, 1);
  };

  /**
   * `PlayerEntity.addExperienceLevels` sound half: a gain landing on a multiple of 5 plays
   * entity.player.levelup at (level > 30 ? 1 : level/30) * 0.75, at most once per 100 ticks of `age`.
   */
  Sv.levelUpSound = function (e, level, delta) {
    if (!(delta > 0) || level % 5 !== 0 || !((e.lastPlayedLevelUpSoundTime || 0) < (e.age || 0) - 100)) return false;
    var vol = (level > 30 ? 1 : level / 30) * 0.75;
    if (NS.Sound && NS.Sound.play) NS.Sound.play('entity.player.levelup', { x: e.x, y: e.y, z: e.z, source: 'player', volume: vol, pitch: 1 });
    e.lastPlayedLevelUpSoundTime = e.age || 0;
    return true;
  };

  /** `addExperienceLevels(n)`: the level moves by n, the bar stays, and a gain may sound. */
  Sv.addLevels = function (e, n) {
    var before = e.xpLevel || 0;
    Sv.setLevelKeepBar(e, before + n);
    Sv.levelUpSound(e, e.xpLevel, n);
  };

  /** Derive level and bar progress from the integer total. */
  Sv.syncXp = function (e) {
    var level = 0, left = e.xpTotal, need = Sv.xpNeeded(0), guard = 0;
    while (left >= need && guard++ < 100000) { left -= need; level++; need = Sv.xpNeeded(level); }
    e.xpLevel = level;
    e.xpProgress = need > 0 ? left / need : 0;
  };

  /**
   * setLevelKeepBar(e, level) — `addExperienceLevels`/`setExperienceLevel`: only the LEVEL changes and
   * `experienceProgress` stays; a level below zero clamps to 0 with the bar and total emptied.
   * xpTotal is re-derived (floored) to stay consistent with level + bar.
   */
  Sv.setLevelKeepBar = function (e, level) {
    if (level < 0) { e.xpLevel = 0; e.xpProgress = 0; e.xpTotal = 0; return; }
    e.xpLevel = level;
    e.xpTotal = Sv.totalXpFor(level) + Math.floor((e.xpProgress || 0) * Sv.xpNeeded(level));
  };

  /** The total points from level 0 to `level`, which is what a check can sum independently. */
  Sv.totalXpFor = function (level) {
    var t = 0;
    for (var i = 0; i < level; i++) t += Sv.xpNeeded(i);
    return t;
  };

  /**
   * tick(e) — one 20 Hz step of the survival loop. `FoodData.tick(Player)`, in order:
   *
   *   1. spend exhaustion: over 4.0, take 4.0 off and lose a point of saturation, or of FOOD if
   *      there is no saturation left;
   *   2. FAST regeneration — a full bar (20) with saturation left heals every 10 ticks, by
   *      min(saturation, 6)/6 hearts, and charges that back as exhaustion;
   *   3. otherwise SLOW regeneration — food 18 or more heals a whole point every 80 ticks and
   *      costs 6 exhaustion;
   *   4. otherwise starvation — food 0 hurts for 1 every 80 ticks;
   *   5. otherwise the timer resets, which is what stops a player hovering at 17 food from
   *      accumulating regeneration credit.
   */
  /**
   * Breath, and drowning (D-292). `LivingEntity.baseTick`'s water branch — Respiration and
   * water breathing / conduit power (#296) included; the bubble-column eye exemption is not.
   *
   * ⚠ IT IS DRIVEN BY `eyeInWater`, WHICH `14b_physics.js` HAS ALWAYS SET CORRECTLY. What never
   * existed was anything reading it into a counter: `15_hud.js` drew a bubble row from `P.air`,
   * a field no code anywhere assigned, guarded by `P.air !== undefined` — so the row has never
   * once been drawn and `Sv.DAMAGE.drown` sat defined and unreachable from G5 to here (D-290).
   *
   * ⚠ THE COUNTER IS ALLOWED TO GO NEGATIVE, and that is the whole shape of it. 300 down at one
   * a tick, then twenty more; the hit lands when it reaches exactly −20 and the counter resets
   * to 0. So the first heart costs 320 ticks (16 s) and every heart after it costs 20 (1 s).
   * Clamping at zero instead — the obvious thing to write — gives a heart every tick and kills
   * the player in a second.
   */
  Sv.tickAir = function (e) {
    if (e.eyeInWater && !e.eyeInBubble) {
      // baseTick: submerged with Water Breathing or an invulnerable gamemode leaves air UNCHANGED
      // (the refill is only the not-eyeInWater branch).
      if (e.invulnerableGamemode || (NS.Effects && NS.Effects.hasWaterBreathing(e))) return e.air;
      // `LivingEntity.getNextAirUnderwater`: Respiration r skips the decrement when
      // nextInt(r + 1) > 0 (.decomp LivingEntity.java:584-587).
      var r = e.respiration | 0;
      if (!(r > 0 && Math.floor(Math.random() * (r + 1)) > 0)) e.air -= 1;
      if (e.air <= Sv.DROWN_AT) {
        e.air = 0;
        Sv.hurt(e, 'drown', Sv.DROWN_DAMAGE);
      }
    } else if (e.air < Sv.MAX_AIR) {
      e.air = Math.min(e.air + Sv.AIR_REFILL, Sv.MAX_AIR);
    }
    return e.air;
  };

  // ServerPlayerEntity.onSlotUpdate -> Criteria.INVENTORY_CHANGED.trigger(player, inventory, stack): once per changed slot
  Sv.inventoryChanged = function (e) {
    var inv = e.inventory, A = NS.Adv;
    if (!inv || !inv.slots || !A || !A.trigger) return;
    var sig = inv.slots.map(function (s) { return s && s.n > 0 ? s.i + ':' + s.n + ':' + (s.d | 0) + ':' + (s.t === undefined ? '' : JSON.stringify(s.t)) : ''; });
    var old = e._invSig;
    e._invSig = sig;
    if (!old) return;
    for (var k = 0; k < sig.length; k++) {
      if (sig[k] !== old[k]) A.trigger(e, 'minecraft:inventory_changed', { slots: inv.slots, stack: inv.slots[k] });
    }
  };

  Sv.tick = function (e) {
    if (e.invulnerable > 0) e.invulnerable--;
    if (NS.Stats && e === NS.Player) NS.Stats.onTick(!!e.sneaking, !!e.dead, !!e.sleeping);   // G26a
    if (e.dead) {
      e.deathTicks++;
      // #512 -- `doImmediateRespawn`: no death screen, the player is respawned on the spot
      // (ServerPlayerEntity.onDeath -> `setImmediateRespawn`); Main's own respawn action does the move.
      var C = NS.Commands;
      if (e === NS.Player && C && C.ruleGet && C.ruleGet('doImmediateRespawn') === 'true' && NS.Main && NS.Main.action) NS.Main.action('respawn');
      return;
    }
    // QUEUE 0.2 (07q_effects.js, not owned by this file — a single necessary line) — the
    // player's own status effects count down and fire their periodic ticks (regeneration,
    // poison, wither) the same as a mob's do in `Cb.tickEntity`; nothing else in this engine
    // ticks the player's `e.effects` table.
    // ⚠ BREATH IS BEFORE THE GAMEMODE GATE'S `return`, because a creative player still has to
    // REFILL: swim down in survival, switch to creative, switch back, and a counter that was
    // never topped up would drown you on the first tick.
    // #296 — and BEFORE the effect tick: `LivingEntity.baseTick` runs the air branch first and
    // `tickStatusEffects()` last (.decomp :358 vs :434), so water breathing's final tick still holds.
    Sv.tickAir(e);
    if (NS.SoulSpeed) NS.SoulSpeed.tick(e);   // #5769
    if (e.advancements) Sv.inventoryChanged(e);
    if (NS.Effects && NS.Effects.tick) NS.Effects.tick(e);
    // ServerPlayerEntity.tick: Criteria.LEVITATION.trigger(this, levitationStartPos, age - levitationStartTick), every tick
    if (e.type === 'player' && e.levitationStartPos && NS.Adv && NS.Adv.trigger) {
      e.levitationTicks = (e.levitationTicks | 0) + 1;
      NS.Adv.trigger(e, 'minecraft:levitation', { player: e, start: e.levitationStartPos, ticks: e.levitationTicks });
    }
    // #4052 Entity.baseTick's fire half + block hazards + in-wall, for the player (the mob twin is EL.tickHazards/EL.suffocate)
    if (NS.EntityList && e.type === 'player') {
      if (NS.Combat && NS.Combat.wetExtinguish) NS.Combat.wetExtinguish(e);
      if (e.remainingFireTicks > 0) {
        if (e.remainingFireTicks % 20 === 0 && !e.inWater) Sv.hurt(e, 'onFire', 1);
        e.remainingFireTicks--;
      }
      e.isOnFire = e.remainingFireTicks > 0;
      NS.EntityList.tickHazards(e);
      NS.EntityList.suffocate(e);
      // G17 LivingEntity.baseTick: a player outside the border past the safe zone takes IN_WALL damage
      var B = NS.World && NS.World.border;
      if (B && !B.contains(e.x - 0.3, e.z - 0.3) || !B.contains(e.x + 0.3, e.z + 0.3)) {
        var bd = B.distanceInside(e.x, e.z) + B.safeZone;
        if (bd < 0 && B.damagePerBlock > 0) Sv.hurt(e, 'inWall', Math.max(1, Math.floor(-bd * B.damagePerBlock)));
      }
    }
    // creative and spectator are `invulnerableGamemode` (G6/D-253); the boolean they used
    // to be tested against no longer exists.
    if (e.invulnerableGamemode) { e.exhaustion = 0; return; }

    e.lastFood = e.food;

    // `HungerManager.update` (.decomp HungerManager.java:34-74), difficulty-aware since loop s111.
    var diff = Sv.difficulty();
    if (e.exhaustion > Sv.EXHAUSTION_STEP) {
      e.exhaustion -= Sv.EXHAUSTION_STEP;
      if (e.saturation > 0) e.saturation = Math.max(e.saturation - 1, 0);
      else if (diff !== 'peaceful') e.food = Math.max(e.food - 1, 0);   // :41 — PEACEFUL never loses food
    }

    var regen = e.naturalRegen !== false && Sv.naturalRegenRule();
    if (regen && e.saturation > 0 && Sv.isHurt(e) && e.food >= Sv.FAST_REGEN_FOOD) {
      e.foodTimer++;
      if (e.foodTimer >= Sv.FAST_REGEN_TICKS) {
        var heal = Math.min(e.saturation, Sv.FAST_REGEN_MAX);
        Sv.heal(e, heal / Sv.FAST_REGEN_MAX);
        Sv.addExhaustion(e, heal);
        e.foodTimer = 0;
      }
    } else if (regen && e.food >= Sv.SLOW_REGEN_FOOD && Sv.isHurt(e)) {
      e.foodTimer++;
      if (e.foodTimer >= Sv.SLOW_REGEN_TICKS) {
        Sv.heal(e, 1);
        Sv.addExhaustion(e, Sv.SLOW_REGEN_EXHAUST);
        e.foodTimer = 0;
      }
    } else if (e.food <= 0) {
      e.foodTimer++;
      if (e.foodTimer >= Sv.STARVE_TICKS) {
        // ⚠ the difficulty gate (HungerManager.java:65), wired to `NS.Diff` since loop s111:
        // hurt when health > 10, or on HARD (starvation can kill), or health > 1 on NORMAL.
        // EASY/PEACEFUL stop at five hearts.
        if (e.health > 10 || diff === 'hard' || (e.health > 1 && diff === 'normal')) Sv.hurt(e, 'starve', 1);
        e.foodTimer = 0;
      }
    } else {
      e.foodTimer = 0;
    }

    // `PlayerEntity.tickMovement`'s PEACEFUL branch (.decomp PlayerEntity.java:492-500): with
    // naturalRegeneration on, heal 1 every 20 ticks of age and refill 1 food every 10. `e.age`
    // is the player's own tick counter (Entity.age), kept here — nothing else read one before.
    e.age = (e.age || 0) + 1;
    if (diff === 'peaceful' && Sv.naturalRegenRule()) {
      if (e.health < (e.maxHealth || Sv.MAX_HEALTH) && e.age % 20 === 0) Sv.heal(e, 1);
      if (e.food < Sv.MAX_FOOD && e.age % 10 === 0) e.food = e.food + 1;
    }
  };

  /**
   * movement(e, dx, dy, dz, opts) — the exhaustion a tick of movement costs.
   * Vanilla measures in centimetres and spends `rate * cm * 0.01`, so this is per block.
   */
  Sv.movement = function (e, dist, opts) {
    if (!dist || e.dead) return;
    var o = opts || {};
    if (o.climbing) return;   // #4806: isClimbing branch of increaseTravelMotionStats charges no exhaustion
    // G26a: the travel stats are recorded by Player.tick (Stats.travel), which sees the classification inputs
    if (o.sprinting) Sv.addExhaustion(e, Sv.EX_SPRINT * dist);
    else if (o.swimming) Sv.addExhaustion(e, Sv.EX_WALK * dist);   // #497: plain walk and sneak cost 0 (PlayerEntity.increaseTravelMotionStats)
  };

  Sv.jumped = function (e, sprinting) {
    if (e.dead) return;
    if (NS.Stats && e === NS.Player) NS.Stats.onJump();   // G26a
    Sv.addExhaustion(e, sprinting ? Sv.EX_SPRINT_JUMP : Sv.EX_JUMP);
  };

  Sv.mined = function (e) { if (!e.dead) Sv.addExhaustion(e, Sv.EX_MINE); };

  // ── persistence (PLAN G14, D-288) ─────────────────────────────────────────────────────────
  //
  // ⚠ NONE OF THIS WAS SAVED UNTIL G14. `Player.toJSON` was written in session 2, before any of
  // these fields existed, and nothing added them when G5 did: you could take nine hearts of
  // damage, eat your way back to full saturation and earn thirty levels, close the tab, and
  // come back untouched at level zero. It is not a format problem — these are plain numbers —
  // it is the join between two stages with nothing asserting across it (D-276).
  //
  // ⚠ AND EVERY ONE IS CLAMPED ON THE WAY IN. A save is a file on the player's disk: it can be
  // truncated, hand-edited, or written by an older build with a different cap. `health: 1e9`
  // must not load as invulnerability and `food: NaN` must not poison every later comparison
  // (NaN fails every `<` and `>`, so a NaN food level neither starves nor regenerates — the
  // player just stops healing for ever, with nothing in the HUD to say why).
  //
  // ⚠ `air` WAS DELIBERATELY ABSENT FROM v4 AND IS HERE NOW (D-292). It was left out because
  // `15_hud.js` drew a bubble row from a field NOTHING IN THE ENGINE EVER SET, and a save field
  // for a value nothing produces always reads its default — worse than no field, because it
  // looks like the feature works. The note that stood here said "when drowning lands it adds
  // `air` here and to SURVIVAL_FIELDS, and savecheck will require it". Drowning landed; it does.
  // ⚠ Its clamp is `[-20, 300]`, not `[0, 300]`: the counter is NEGATIVE between the moment the
  // breath runs out and the moment the hit lands, and clamping it at zero on load would turn a
  // save taken mid-drown into one that drowns again immediately.

  /** The fields that cross a save, with their bounds. One list, so the two directions agree. */
  Sv.SURVIVAL_FIELDS = [
    ['health',      0, 20,   20],
    ['absorption',  0, 2048,  0],
    ['food',        0, 20,   20],
    ['saturation',  0, 20,    5],
    ['exhaustion',  0, 40,    0],
    ['foodTimer',   0, 80,    0],
    ['air',         -20, 300, 300], // D-292: the counter goes NEGATIVE by design, down to −20
    ['xpLevel',     0, 24791, 0],   // vanilla's own level cap before the XP bar overflows an int
    ['xpProgress',  0, 1,     0],
    ['xpTotal',     0, 2147483647, 0]
  ];

  Sv.toJSON = function (e) {
    if (!e) return null;
    var o = {}, F = Sv.SURVIVAL_FIELDS;
    for (var i = 0; i < F.length; i++) {
      var v = e[F[i][0]];
      if (typeof v === 'number' && isFinite(v)) o[F[i][0]] = v;
    }
    // G22b: `PlayerEntity.enchantmentTableSeed` (NBT `XpSeed`) — the table's offers are a function of it,
    // so without it a reload re-rolls every table the player has looked at.
    if (typeof e.enchantSeed === 'number' && isFinite(e.enchantSeed)) o.enchantSeed = e.enchantSeed | 0;
    return o;
  };

  /**
   * Read the survival state back, clamped. Returns true when it read something.
   * ⚠ A MISSING FIELD TAKES ITS DEFAULT, NOT THE VALUE ALREADY ON THE ENTITY. Loading a world
   * has to put the player in a known state; carrying over whatever the last world left behind
   * is how you respawn into a new world already starving.
   */
  Sv.fromJSON = function (e, o) {
    if (!e) return false;
    var F = Sv.SURVIVAL_FIELDS, read = !!(o && typeof o === 'object');
    for (var i = 0; i < F.length; i++) {
      var name = F[i][0], lo = F[i][1], hi = F[i][2], dflt = F[i][3];
      var v = read ? o[name] : undefined;
      if (typeof v !== 'number' || !isFinite(v)) v = dflt;
      e[name] = Math.min(hi, Math.max(lo, v));
    }
    // ⚠ NOT a clamped field: any int is a seed, and a missing one is a fresh `random.nextInt()` (a new
    // player's), never a shared default that would hand every new world the same first offers.
    var sd = read ? o.enchantSeed : undefined;
    e.enchantSeed = (typeof sd === 'number' && isFinite(sd)) ? sd | 0 : (Math.random() * 4294967296) | 0;
    // ⚠ derived, never stored: a saved `dead` flag would load you into the death screen with no
    // way out, and `lastFood` is only the HUD's flash comparison.
    e.dead = e.health <= 0;
    e.deathTicks = 0;
    e.killedByItem = null;
    e.deathCause = null;
    e.invulnerable = 0;
    e.lastFood = e.food;
    return read;
  };
})(MCL);
