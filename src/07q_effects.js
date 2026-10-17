// 07q_effects.js — QUEUE row 0.2: the STATUS-EFFECT STORE, and the combat residue that needs it.
// Runs on: MAIN THREAD ONLY. No DOM — a status effect is a plain object on the entity, so a
// whole tick of poison/wither/regeneration runs inside `combatcheck` without a browser.
//
// ⚠⚠ WHY THIS FILE EXISTS. `Cb.OWED` named two rows no system in this engine could pay: "the
// Blindness effect suppressing a critical hit" and "damage to the ATTACKER from thorns" — both
// need a living entity to be able to CARRY something (an effect, or an enchanted piece of armor
// worn well enough to answer a chance roll) that persists tick to tick. This is that something,
// built to the shape vanilla's own `StatusEffectInstance` (Yarn 1.18.2) is built to: an effect
// id, an amplifier, a duration that counts down, and the `ambient`/`showParticles` flags that
// only the (unbuilt) HUD and particle systems read — carried here anyway, because a store that
// silently drops fields it does not personally need is a store the raid loop (Bad Omen, G23)
// will have to widen instead of just USE.
//
// ⚠ WHAT IS WIRED, AND WHAT IS ONLY CARRIED. `ES.tick` runs all five periodic branches of
// `StatusEffect.applyUpdateEffect` (Yarn) — regeneration, poison, wither through the real
// damage path, and the player-only hunger/saturation pokes into 14d_survival.js's hunger
// model (loop s111). Every other
// registered effect (speed, jump boost, invisibility, …) sits in the store, round-trips through
// save/load, and does nothing — because nothing in this engine reads an attribute yet for a
// status effect to modify, and a modifier no attribute consumes is not "wired", it is a
// decoration pretending to be done.
//
// ⚠ THE UPGRADE RULE IS VANILLA'S, HIDDEN CHAIN AND ALL (#293, G23). `ES.upgrade` is
// `StatusEffectInstance.upgrade` line for line: a STRONGER-but-shorter effect pushes the current
// one down into a linked `hiddenEffect`, a WEAKER-but-longer one is parked there (or upgraded
// into the one already parked), and `ES.update` resumes the parked tail the tick the top one hits
// 0 — so a Strength II (0:22) potion over a Strength I (3:00) one does not erase the three
// minutes, it resumes the 2:38 left of them (the hidden instance counts down underneath,
// `updateDuration`). The LivingEntity half — addStatusEffect/setStatusEffect/removeStatusEffect/
// clearStatusEffects, tickStatusEffects' duration loop and the onStatusEffectApplied/Upgraded/
// Removed hooks — is below it, and the ActiveEffects list (`writeNbt`/`fromNbt` with
// `ShowIcon` and the recursive `HiddenEffect`) round-trips the player (14_player.js) and every
// saved mob (07zw_mobnbt.js). The hooks run `StatusEffect.onApplied`/`onRemoved`'s only two
// behaviours this engine has state for (absorption's hearts, health boost's clamp); the
// attribute-modifier half waits on an attribute container (above).

(function (NS) {
  'use strict';

  var ES = NS.Effects = { ready: true };   // self-contained: no DATA table, no other module's init

  // ── THE REGISTRY — `StatusEffects.java` (Yarn 1.18.2), name -> raw id, registration order ──
  // (`byRawId`/`getRawId` round-trip an effect through NBT as a signed byte, "Id"). Every one of
  // vanilla's 32 is named here, even the 27 this file does not wire any behaviour for, so the
  // store never has to be widened just to hold a NAME — only ever to hold a BEHAVIOUR, which is
  // this header's own point.
  var IDS = ES.IDS = {
    speed: 1, slowness: 2, haste: 3, mining_fatigue: 4, strength: 5, instant_health: 6,
    instant_damage: 7, jump_boost: 8, nausea: 9, regeneration: 10, resistance: 11,
    fire_resistance: 12, water_breathing: 13, invisibility: 14, blindness: 15,
    night_vision: 16, hunger: 17, weakness: 18, poison: 19, wither: 20, health_boost: 21,
    absorption: 22, saturation: 23, glowing: 24, levitation: 25, luck: 26, unluck: 27,
    slow_falling: 28, conduit_power: 29, dolphins_grace: 30, bad_omen: 31,
    hero_of_the_village: 32
  };
  var NAMES = ES.NAMES = {};
  for (var nm in IDS) if (IDS.hasOwnProperty(nm)) NAMES[IDS[nm]] = nm;

  // ── THE INSTANCE — `StatusEffectInstance`'s own fields (`permanent` is set by nothing in 1.18.2
  // but beacons' client copy, so not carried). `showIcon` defaults to `showParticles`, the 5-arg
  // constructor's own `this($$0, $$1, $$2, $$3, $$4, $$4)`.
  ES.instance = function (effect, duration, amplifier, ambient, showParticles, showIcon, hiddenEffect) {
    var sp = showParticles === undefined ? true : !!showParticles;
    return {
      effect: effect,
      duration: duration | 0,
      amplifier: amplifier ? (amplifier | 0) : 0,
      ambient: !!ambient,
      showParticles: sp,
      showIcon: showIcon === undefined ? sp : !!showIcon,
      hiddenEffect: hiddenEffect || null
    };
  };

  /** `new StatusEffectInstance(other)` = `copyFrom`: every field EXCEPT the hidden chain. */
  ES.copyFrom = function (dst, src) {
    dst.duration = src.duration; dst.amplifier = src.amplifier; dst.ambient = src.ambient;
    dst.showParticles = src.showParticles; dst.showIcon = src.showIcon;
    return dst;
  };
  ES.copyInstance = function (src) {
    return ES.copyFrom({ effect: src.effect, hiddenEffect: null }, src);
  };

  /** `StatusEffectInstance.upgrade(other)` (.decomp StatusEffectInstance.java:65-106), exactly:
   *  returns true when THIS instance's visible state changed. */
  ES.upgrade = function (cur, next) {
    var changed = false;
    if (next.amplifier > cur.amplifier) {
      if (next.duration < cur.duration) {            // the weaker-but-longer one goes underneath
        var below = cur.hiddenEffect;
        cur.hiddenEffect = ES.copyInstance(cur);
        cur.hiddenEffect.hiddenEffect = below;
      }
      cur.amplifier = next.amplifier;
      cur.duration = next.duration;
      changed = true;
    } else if (next.duration > cur.duration) {
      if (next.amplifier === cur.amplifier) {
        cur.duration = next.duration;
        changed = true;
      } else if (cur.hiddenEffect == null) {
        cur.hiddenEffect = ES.copyInstance(next);
      } else {
        ES.upgrade(cur.hiddenEffect, next);
      }
    }
    if ((!next.ambient && cur.ambient) || changed) { cur.ambient = next.ambient; changed = true; }
    if (next.showParticles !== cur.showParticles) { cur.showParticles = next.showParticles; changed = true; }
    if (next.showIcon !== cur.showIcon) { cur.showIcon = next.showIcon; changed = true; }
    return changed;
  };

  /** `updateDuration`: the whole hidden chain counts down under the visible instance. */
  ES.updateDuration = function (inst) {
    if (inst.hiddenEffect) ES.updateDuration(inst.hiddenEffect);
    return --inst.duration;
  };

  /** `StatusEffectInstance.update(entity, onResume)` (:136-150): the periodic effect, the
   *  countdown, and the hidden tail's resume the tick the top instance reaches exactly 0. */
  ES.update = function (e, inst, onResume) {
    if (inst.duration > 0) {
      if (ES.dueThisTick(inst.effect, inst.duration, inst.amplifier)) ES.applyTickEffect(e, inst.effect, inst.amplifier);
      ES.updateDuration(inst);
      if (inst.duration === 0 && inst.hiddenEffect) {
        var h = inst.hiddenEffect;
        ES.copyFrom(inst, h);
        inst.hiddenEffect = h.hiddenEffect;
        if (onResume) onResume();
      }
    }
    return inst.duration > 0;
  };

  /** Give the entity its (empty) effect table. Idempotent, so a respawn can reuse it.
   *  Named `initEntity`, not `init` — this is per-ENTITY setup (`Sv.init`'s own shape), not a
   *  once-at-boot module init; `tickcheck`'s §3 checks every `X.init` for a boot-time caller,
   *  and this store needs none (every entry point below already creates `e.effects` lazily). */
  ES.initEntity = function (e) {
    if (!e.effects) e.effects = {};
    return e;
  };

  // ── THE LivingEntity BOOKKEEPING (.decomp LivingEntity.java:748-1003) ──────────────────────
  /** `StatusEffect.onApplied`/`onRemoved`, per type. The base class adds/removes attribute
   *  modifiers (no attribute container here — header); the two subclasses with their own state:
   *  AbsorptionStatusEffect (`setAbsorptionAmount(get ± 4*(amp+1))`, clamped at 0 by
   *  `setAbsorptionAmount` itself) and HealthBoostStatusEffect.onRemoved (health clamps to max). */
  ES.setAbsorption = function (e, v) { e.absorption = v < 0 ? 0 : v; };
  ES.TYPE_HOOKS = {
    absorption: {
      onApplied: function (e, amp) { ES.setAbsorption(e, (e.absorption || 0) + 4 * (amp + 1)); },
      onRemoved: function (e, amp) { ES.setAbsorption(e, (e.absorption || 0) - 4 * (amp + 1)); }
    },
    health_boost: {
      onRemoved: function (e) { if (e.health > e.maxHealth) e.health = e.maxHealth; }
    }
  };
  function typeHook(inst, which, e) {
    var h = ES.TYPE_HOOKS[inst.effect];
    if (h && h[which]) h[which](e, inst.amplifier);
  }
  /** `onStatusEffectApplied`: marks the swirl colour dirty and runs the type's `onApplied`. */
  // ServerPlayerEntity.onStatusEffect*: Criteria.EFFECTS_CHANGED.trigger(this, source) after the base hook.
  function fxTrigger(e, source) {
    if (e === NS.Player && NS.Adv && NS.Adv.trigger) NS.Adv.trigger(e, 'minecraft:effects_changed', { player: e, source: source || null });
  }
  ES.onStatusEffectApplied = function (e, inst, source) {
    e.effectsChanged = true;
    typeHook(inst, 'onApplied', e);
    // ServerPlayerEntity.onStatusEffectApplied: levitation records where and when it began
    if (inst.effect === 'levitation' && e.type === 'player') { e.levitationStartPos = [e.x, e.y, e.z]; e.levitationTicks = 0; }
    fxTrigger(e, source);
  };
  /** `onStatusEffectUpgraded(inst, reapply, source)`: `reapply` re-runs onRemoved then onApplied
   *  at the instance's NEW amplifier (so a Absorption I -> II upgrade nets +4, not +8). */
  ES.onStatusEffectUpgraded = function (e, inst, reapply, source) {
    e.effectsChanged = true;
    if (reapply) { typeHook(inst, 'onRemoved', e); typeHook(inst, 'onApplied', e); }
    fxTrigger(e, source);
  };
  ES.onStatusEffectRemoved = function (e, inst) {
    e.effectsChanged = true;
    typeHook(inst, 'onRemoved', e);
    if (inst.effect === 'levitation' && e.type === 'player') e.levitationStartPos = null;
    fxTrigger(e, null);
  };

  /** `LivingEntity.addStatusEffect(instance, source)`: absent -> put + onApplied; present ->
   *  `upgrade`, and onUpgraded(reapply) only when it reported a change. */
  ES.addInstance = function (e, inst, source) {
    if (!e || !IDS.hasOwnProperty(inst.effect)) return false;
    if (!ES.canHaveStatusEffect(e, inst.effect)) return false;
    if (!e.effects) e.effects = {};
    var cur = e.effects[inst.effect];
    if (!cur) { e.effects[inst.effect] = inst; ES.onStatusEffectApplied(e, inst, source); return true; }
    if (ES.upgrade(cur, inst)) { ES.onStatusEffectUpgraded(e, cur, true, source); return true; }
    return false;
  };
  ES.addStatusEffect = function (e, effect, duration, amplifier, ambient, showParticles, showIcon, source) {
    if (!IDS.hasOwnProperty(effect)) return false;
    return ES.addInstance(e, ES.instance(effect, duration, amplifier, ambient, showParticles, showIcon), source);
  };

  /** `setStatusEffect`: REPLACES outright (no upgrade), applied-or-upgraded by what it displaced. */
  ES.setStatusEffect = function (e, inst, source) {
    if (!e || !IDS.hasOwnProperty(inst.effect) || !ES.canHaveStatusEffect(e, inst.effect)) return;
    if (!e.effects) e.effects = {};
    var prev = e.effects[inst.effect];
    e.effects[inst.effect] = inst;
    if (!prev) ES.onStatusEffectApplied(e, inst, source);
    else ES.onStatusEffectUpgraded(e, inst, true, source);
  };

  /** `removeStatusEffectInternal`: the bare map removal, no hook — the instance or null. */
  ES.removeStatusEffectInternal = function (e, effect) {
    if (!e || !e.effects || !e.effects[effect]) return null;
    var inst = e.effects[effect];
    delete e.effects[effect];
    return inst;
  };
  /** `removeStatusEffect`: removal + onRemoved; true when there was one. */
  ES.removeStatusEffect = function (e, effect) {
    var inst = ES.removeStatusEffectInternal(e, effect);
    if (!inst) return false;
    ES.onStatusEffectRemoved(e, inst);
    return true;
  };
  /** `clearStatusEffects` (milk): onRemoved for every one, then empty; true when any existed. */
  ES.clearStatusEffects = function (e) {
    var any = false;
    if (!e || !e.effects) return false;
    for (var effect in e.effects) {
      if (!e.effects.hasOwnProperty(effect)) continue;
      var inst = e.effects[effect];
      ES.onStatusEffectRemoved(e, inst);
      delete e.effects[effect];
      any = true;
    }
    return any;
  };

  ES.hasStatusEffect = function (e, effect) {
    return !!(e && e.effects && e.effects[effect] && e.effects[effect].duration > 0);
  };

  ES.getStatusEffect = function (e, effect) {
    return (e && e.effects && e.effects[effect]) || null;
  };

  /** -1 when absent, matching every other "level off a stack" reader in this engine (14j_combat.js). */
  ES.amplifierOf = function (e, effect) {
    var inst = ES.getStatusEffect(e, effect);
    return inst ? inst.amplifier : -1;
  };

  // ── `StatusEffectUtil` (.decomp, read whole) — conduit power counts as BOTH haste and water
  // breathing, and the haste amplifier is the max of the two (0 when only one is present).
  // `hasStatusEffect` here is vanilla's own (`activeStatusEffects.containsKey`) — see above.
  ES.hasHaste = function (e) { return ES.hasStatusEffect(e, 'haste') || ES.hasStatusEffect(e, 'conduit_power'); };
  ES.getHasteAmplifier = function (e) {
    var a = ES.hasStatusEffect(e, 'haste') ? e.effects.haste.amplifier : 0;
    var b = ES.hasStatusEffect(e, 'conduit_power') ? e.effects.conduit_power.amplifier : 0;
    return Math.max(a, b);
  };
  ES.hasWaterBreathing = function (e) { return ES.hasStatusEffect(e, 'water_breathing') || ES.hasStatusEffect(e, 'conduit_power'); };

  // ── THE TICK — `StatusEffectInstance.update` + `StatusEffect.canApplyUpdateEffect` /
  // `applyUpdateEffect` (Yarn 1.18.2), for the three effects this engine can act on. ─────────
  /**
   * `StatusEffect.canApplyUpdateEffect(duration, amplifier)`: regeneration every `50 >> amp`
   * ticks, poison every `25 >> amp`, wither every `40 >> amp` — and ALWAYS once the shift
   * reaches 0 (amplifier high enough that the interval underflows to nothing). Bytecode-shaped,
   * not guessed: every other registered effect returns false here (StatusEffect.java's own
   * final `else`, except HUNGER — see `ES.dueThisTick`'s own first two lines).
   */
  ES.TICK_INTERVAL_BASE = { regeneration: 50, poison: 25, wither: 40 };
  ES.dueThisTick = function (effect, duration, amplifier) {
    // loop s111 -- the two branches past the shifts (.decomp StatusEffect.java:86-98 and
    // InstantStatusEffect.java:14-16): HUNGER's own `else` returns `this == HUNGER` (every
    // tick), and SATURATION is an `InstantStatusEffect`, whose override is `duration >= 1`.
    if (effect === 'hunger') return true;
    if (effect === 'saturation' || effect === 'instant_health' || effect === 'instant_damage') return duration >= 1;
    var base = ES.TICK_INTERVAL_BASE[effect];
    if (base === undefined) return false;
    var iv = base >> amplifier;
    return iv > 0 ? (duration % iv === 0) : true;
  };

  /**
   * `StatusEffect.applyUpdateEffect` (.decomp StatusEffect.java:42-66), the five periodic
   * branches. loop s111 closed both former `ES.OWED` rows:
   *  - poison is `damage(DamageSource.MAGIC, 1.0F)` behind a `getHealth() > 1.0F` guard, wither
   *    `damage(DamageSource.WITHER, 1.0F)` with none — BOTH through the real
   *    `LivingEntity.damage`, so the invulnerability window (`Cb.hurt`/`Sv.hurt`'s own
   *    docking) gates them exactly like a sword, and both sources are `setBypassesArmor()`
   *    (DamageSource.java:31-32), so worn armour does NOT reduce them. A mob routes through
   *    `Cb.hurt` with `{bypassArmor:true}`, the player through `Sv.hurt` ('magic'/'wither').
   *  - hunger: `PlayerEntity.addExhaustion(0.005F * (amplifier + 1))`, player only (:53-54).
   *  - saturation: `HungerManager.add(amplifier + 1, 1.0F)` (:55-58, HungerManager.java:22-25
   *    — the same formula `Sv.eat` already is), player only.
   * "Player" is read as "carries a HungerManager" (`typeof e.food === 'number'` — `Sv.init`
   * is the only thing that ever gives an entity a food level).
   */
  ES.isPlayerLike = function (e) { return typeof e.food === 'number'; };
  ES.applyTickEffect = function (e, effect, amplifier) {
    var Sv = NS.Survival, Cb = NS.Combat, player = ES.isPlayerLike(e);
    if (effect === 'regeneration') {
      if (e.health < e.maxHealth) e.health = Math.min(e.health + 1, e.maxHealth);
    } else if (effect === 'poison' || effect === 'wither') {
      if (effect === 'poison' && !(e.health > 1)) return;
      var srcKey = effect === 'poison' ? 'magic' : 'wither';
      var pdmg = 1;   // Cb.hurt applies the witch x0.15 to source:'magic'
      if (player && Sv && Sv.hurt) Sv.hurt(e, srcKey, 1);
      else if (Cb && Cb.hurt) Cb.hurt(e, pdmg, undefined, false, { bypassArmor: true, source: srcKey });
      else {   // headless harness with no combat module loaded: the bare arithmetic
        e.health -= 1;
        if (e.health <= 0) { e.health = 0; e.dead = true; }
      }
    } else if (effect === 'hunger') {
      if (player && Sv && Sv.addExhaustion) Sv.addExhaustion(e, 0.005 * (amplifier + 1));
    } else if (effect === 'saturation') {
      if (player && Sv && Sv.eat) Sv.eat(e, amplifier + 1, 1.0);
    } else if (effect === 'instant_health' || effect === 'instant_damage') {
      // StatusEffect.java:59-65 -- the tickable (addStatusEffect'd: tipped arrow, witch drink)
      // path of an instant effect, with the SAME undead reversal as applyInstantEffect below:
      // health on the living / harming on the undead heals `max(4 << amp, 0)`, the other two
      // cases deal `6 << amp` MAGIC.
      if (ES.healsOn(e, effect)) ES.heal(e, Math.max(4 << amplifier, 0));
      else ES.magicDamage(e, 6 << amplifier, null);
    }
  };

  // ── D-647: UNDEAD + IMMUNITIES (.decomp LivingEntity.java:941-965, StatusEffect.java:42-83,
  // SpiderEntity.java:132, WitherSkeletonEntity.java:113, WitherEntity.java:557) ──────────────
  /** `isUndead()` = `getGroup() == EntityGroup.UNDEAD`; the group table is `Cb.MOB_TYPE` (the
   *  extractor's own per-class `getGroup` override walk, 14j_combat.js). The player is never undead. */
  ES.isUndead = function (e) {
    var Cb = NS.Combat;
    return !!(e && e.type && Cb && Cb.MOB_TYPE && Cb.MOB_TYPE.undead.indexOf(e.type) >= 0);
  };
  /** `canHaveStatusEffect`: an UNDEAD entity refuses regeneration and poison; a spider (and so a
   *  cave spider, which extends it) refuses poison; a wither skeleton and the wither refuse wither. */
  ES.canHaveStatusEffect = function (e, effect) {
    if ((effect === 'regeneration' || effect === 'poison') && ES.isUndead(e)) return false;
    if (effect === 'poison' && (e.type === 'spider' || e.type === 'cave_spider')) return false;
    if (effect === 'wither' && (e.type === 'wither_skeleton' || e.type === 'wither')) return false;
    if (e && e.type === 'wither') return false; // WitherEntity.addStatusEffect returns false unconditionally
    return true;
  };
  /** The one test both instant paths share: does this effect HEAL this target? health heals
   *  the living, harming heals the undead; the other two cases damage. */
  ES.healsOn = function (e, effect) {
    return (effect === 'instant_health') !== ES.isUndead(e);
  };
  /** `LivingEntity.heal`: only a living (health > 0) entity heals, capped at max health. */
  ES.heal = function (e, amount) {
    if (!(e.health > 0)) return;
    e.health = Math.min(e.maxHealth, e.health + amount);
  };
  /** `damage(DamageSource.MAGIC / magic(source, attacker), amount)` -- a bypass-armour source,
   *  through the real damage path (invulnerability window included) exactly as poison is. */
  /** `WitchEntity.applyEnchantmentsToDamage`: her own attacker-hit is 0, any magic source x0.15. */
  ES.witchMagic = function (e, amount, attacker) {
    if (e.type !== 'witch') return amount;
    return attacker === e ? 0 : amount * 0.15;
  };
  ES.magicDamage = function (e, amount, attacker) {
    if (!(amount > 0)) return;
    var Sv = NS.Survival, Cb = NS.Combat;
    if (ES.isPlayerLike(e) && Sv && Sv.hurt) Sv.hurt(e, 'magic', amount);
    else if (Cb && Cb.hurt) Cb.hurt(e, amount, undefined, !!(attacker && attacker === NS.Player), { bypassArmor: true, source: 'magic', attacker: attacker || undefined });
    else { e.health -= amount; if (e.health <= 0) { e.health = 0; e.dead = true; } }
  };
  /**
   * `StatusEffect.applyInstantEffect(source, attacker, target, amplifier, proximity)`
   * (StatusEffect.java:68-83): the splash (proximity = 1 - dist/4, 1.0 on a direct hit) and
   * lingering-cloud (0.5) path. Heal amount `(int)(p * (4 << amp) + 0.5)`, damage
   * `(int)(p * (6 << amp) + 0.5)`, with the undead reversal; any NON-instant effect handed here
   * falls to `applyUpdateEffect` (the vanilla `else`).
   */
  ES.applyInstantEffect = function (e, effect, amplifier, proximity, attacker) {
    if (effect !== 'instant_health' && effect !== 'instant_damage') { ES.applyTickEffect(e, effect, amplifier); return; }
    if (ES.healsOn(e, effect)) ES.heal(e, Math.floor(proximity * (4 << amplifier) + 0.5));
    else ES.magicDamage(e, Math.floor(proximity * (6 << amplifier) + 0.5), attacker);
  };

  ES.OWED = [];

  /**
   * `LivingEntity.tickStatusEffects`' duration half (:748-765): every instance `update`s (its
   * hidden tail resuming fires onUpgraded(reapply)); one that ran out is removed with its
   * onRemoved hook; a live one crossing a multiple of 600 ticks re-marks the swirls dirty
   * (onUpgraded without reapply). `effectsChanged` is then cleared — the swirl/glowing refresh
   * it gates (`updatePotionVisibility`) is the particle/HUD side, not this store.
   */
  ES.tick = function (e) {
    if (!e || !e.effects) return;
    for (var effect in e.effects) {
      if (!e.effects.hasOwnProperty(effect)) continue;
      var inst = e.effects[effect];
      if (!ES.update(e, inst, resumeHook(e, inst))) {
        delete e.effects[effect];
        ES.onStatusEffectRemoved(e, inst);
      } else if (inst.duration % 600 === 0) {
        ES.onStatusEffectUpgraded(e, inst, false, null);
      }
    }
    if (e.effectsChanged) e.effectsChanged = false;
  };
  function resumeHook(e, inst) { return function () { ES.onStatusEffectUpgraded(e, inst, true, null); }; }

  // ── COMBAT RESIDUE: the two `Cb.OWED` rows this store closes ───────────────────────────────

  /** `Player.attack`'s crit condition: `!this.hasStatusEffect(StatusEffects.BLINDNESS)`. */
  ES.suppressesCrit = function (e) {
    return ES.hasStatusEffect(e, 'blindness');
  };

  /**
   * `DamageModifierStatusEffect.adjustModifierAmount`: strength is `+3.0 * (amplifier+1)`,
   * weakness `-4.0 * (amplifier+1)`, both ADDED to `generic.attack_damage`
   * (`EntityAttributes.field_23721`, a `ClampedEntityAttribute(2.0, 0.0, 2048.0)`) before
   * `Player.attack`'s own cooldown ramp multiplies it. This engine has no attribute container,
   * so `base` (the weapon's own attack damage) stands in for the attribute's base value and the
   * clamp is applied here, by hand, to the same [0, 2048] vanilla's attribute declares.
   */
  ES.STRENGTH_PER_LEVEL = 3.0;
  ES.WEAKNESS_PER_LEVEL = -4.0;
  ES.ATTACK_DAMAGE_MIN = 0.0;
  ES.ATTACK_DAMAGE_MAX = 2048.0;
  ES.attackDamageBonus = function (e, base) {
    var v = base;
    var str = ES.amplifierOf(e, 'strength');
    if (str >= 0) v += ES.STRENGTH_PER_LEVEL * (str + 1);
    var weak = ES.amplifierOf(e, 'weakness');
    if (weak >= 0) v += ES.WEAKNESS_PER_LEVEL * (weak + 1);
    if (v < ES.ATTACK_DAMAGE_MIN) v = ES.ATTACK_DAMAGE_MIN;
    if (v > ES.ATTACK_DAMAGE_MAX) v = ES.ATTACK_DAMAGE_MAX;
    return v;
  };

  /**
   * `LivingEntity.applyEnchantmentsToDamage`'s resistance branch: `pct = 25 - (amplifier+1)*5`
   * (20% per level, so amplifier 4 — Resistance V — zeroes any positive damage), applied to the
   * damage AFTER armor and BEFORE absorption, and skipped for `DamageSource.OUT_OF_WORLD`
   * (vanilla's own one named exception — the void ignores a potion the same way it ignores
   * armor). `bypass` lets a caller name that exception without this file knowing its damage-type
   * strings (`14d_survival.js`'s own `Sv.DAMAGE` table, which this file does not own).
   */
  ES.RESISTANCE_PCT_PER_LEVEL = 5;
  ES.RESISTANCE_PCT_BASE = 25;
  ES.applyResistance = function (e, damage, bypass) {
    if (bypass || !(damage > 0)) return damage;
    var amp = ES.amplifierOf(e, 'resistance');
    if (amp < 0) return damage;
    var pct = ES.RESISTANCE_PCT_BASE - (amp + 1) * ES.RESISTANCE_PCT_PER_LEVEL;
    var out = damage * pct / ES.RESISTANCE_PCT_BASE;
    return out > 0 ? out : 0;
  };

  // ── THORNS: the equipped-armor-item substrate `ThornsEnchantment.onUserDamaged` needs ──────
  // (`ThornsEnchantment` / `EnchantmentHelper.onUserDamaged`, Yarn 1.18.2). Reads the DEFENDER's
  // four armor slots the same way `14d_survival.js`'s own `Sv.updateArmor` already does
  // (`Inventory.ARMOR_START..+4`, D-461's own `Cb.enchantLevel` for the tag) — no new inventory
  // shape, just a new reader of the one that exists.
  /**
   * `ThornsEnchantment.shouldDamageAttacker(level, random)`: `level <= 0 ? false :
   * random.nextFloat() < 0.15 * level` — a flat 15% PER LEVEL, uncapped (level 3 is 45%, not
   * diminishing).
   */
  ES.THORNS_CHANCE_PER_LEVEL = 0.15;
  ES.thornsShouldTrigger = function (level, rng) {
    if (!(level > 0)) return false;
    var roll = rng ? rng() : Math.random();
    return roll < ES.THORNS_CHANCE_PER_LEVEL * level;
  };

  /** `ThornsEnchantment.getDamageAmount(level, random)`: `level > 10 ? level - 10 : 1 + rand(4)`. */
  ES.thornsDamageAmount = function (level, rng) {
    if (level > 10) return level - 10;
    var roll = rng ? rng() : Math.random();
    return 1 + Math.floor(roll * 4);
  };

  /** `ItemStack.damage(2, ...)`: the piece takes 2 durability and BREAKS (returns to empty) once
   *  its damage reaches the item's own max. `IT.durability` is 0/undefined for an unbreakable
   *  item (armor has none today — leather/iron/etc. all carry a real cap), matched here the same
   *  way `Inv.canStack`'s own read of that table already does (14f_inventory.js). */
  ES.THORNS_ARMOR_DAMAGE = 2;
  ES.damageArmorPiece = function (inv, slot, amt) {
    var IT = NS.Items, Iv = NS.Inventory;
    var st = inv && inv.slots && inv.slots[slot];
    if (!st || Iv.isEmpty(st)) return false;
    var max = IT && IT.durability ? IT.durability[st.i] : 0;
    if (!max) return true;                 // unbreakable: takes the "hit" but never breaks
    st.d = (st.d | 0) + (amt || ES.THORNS_ARMOR_DAMAGE);
    if (st.d >= max) inv.slots[slot] = Iv.EMPTY;
    return true;
  };

  /**
   * `EnchantmentHelper.onUserDamaged(defender, attacker)`, narrowed to Thorns and to a PLAYER
   * defender — the only side of combat with an inventory to read armor out of today (mob armor,
   * vanilla's `LivingEntity.getArmorItems()` on a zombie that picked one up, is unmodeled — the
   * `Ai.OWED` gap this file's own header points at). Called once per landed hit that actually
   * reduced the defender's health (vanilla: from `Entity.applyDamageEffects`, itself called only
   * when `LivingEntity.damage` returns true), never from inside `ES.applyResistance`/`Cb.hurt`
   * itself, same "hook, not embedded" shape `Cb.notifyHurt`'s own header already argues for.
   */
  ES.thornsOnUserDamaged = function (defender, attacker, rng) {
    var Iv = NS.Inventory;
    if (!defender || !defender.inventory || !Iv || !attacker) return false;
    var best = 0, bestSlot = -1;
    for (var i = 0; i < 4; i++) {
      var slot = Iv.ARMOR_START + i;
      var st = defender.inventory.slots && defender.inventory.slots[slot];
      if (!st || Iv.isEmpty(st)) continue;
      var lvl = NS.Combat && NS.Combat.enchantLevel ? NS.Combat.enchantLevel(st, 'thorns') : 0;
      // `EnchantmentHelper.chooseEquipmentWith`: ONE piece is picked (this engine's own RNG has
      // no seeded-per-item tiebreak yet), the LAST one found here, matching javap's own iteration
      // order for `getEquipmentLevel`'s max-search this engine already used at D-461.
      if (lvl > 0) { best = lvl; bestSlot = slot; }
    }
    if (bestSlot < 0) return false;
    if (!ES.thornsShouldTrigger(best, rng)) return false;
    var dmg = ES.thornsDamageAmount(best, rng);
    if (NS.Combat && NS.Combat.hurt) NS.Combat.hurt(attacker, dmg, undefined, false, { source: "thorns", attacker: defender });
    ES.damageArmorPiece(defender.inventory, bestSlot);
    return true;
  };

  // ── SAVE/LOAD — `StatusEffectInstance.writeNbt`/`fromNbt` (:207-258) and LivingEntity's
  // `ActiveEffects` list (:675-712). Amplifier is written as a signed BYTE (`(byte)amp`) and read
  // back clamped at 0, Id likewise a byte; ShowParticles defaults to true and ShowIcon to
  // ShowParticles when absent; the hidden chain nests as `HiddenEffect` (its own Id written, its
  // TYPE taken from the outer tag on read).
  var toByte = function (v) { return ((v | 0) << 24) >> 24; };
  ES.writeNbt = function (inst) {
    var t = { Id: toByte(IDS[inst.effect]) };
    t.Amplifier = toByte(inst.amplifier);
    t.Duration = inst.duration | 0;
    t.Ambient = !!inst.ambient;
    t.ShowParticles = !!inst.showParticles;
    t.ShowIcon = !!inst.showIcon;
    if (inst.hiddenEffect) t.HiddenEffect = ES.writeNbt(inst.hiddenEffect);
    return t;
  };
  var has = function (t, k) { return t[k] !== undefined && t[k] !== null; };
  function fromTypedNbt(effect, t) {
    var amp = toByte(t.Amplifier);
    var sp = has(t, 'ShowParticles') ? !!t.ShowParticles : true;
    var si = has(t, 'ShowIcon') ? !!t.ShowIcon : sp;
    var hidden = (t.HiddenEffect && typeof t.HiddenEffect === 'object') ? fromTypedNbt(effect, t.HiddenEffect) : null;
    return ES.instance(effect, t.Duration | 0, amp < 0 ? 0 : amp, !!t.Ambient, sp, si, hidden);
  }
  /** `fromNbt`: an unknown Id is null (dropped by the caller). */
  ES.fromNbt = function (t) {
    var effect = t ? NAMES[toByte(t.Id)] : undefined;
    return effect ? fromTypedNbt(effect, t) : null;
  };

  /** The `ActiveEffects` LIST: every active instance's own compound. */
  ES.save = function (e) {
    var out = [];
    if (!e || !e.effects) return out;
    for (var effect in e.effects) if (e.effects.hasOwnProperty(effect)) out.push(ES.writeNbt(e.effects[effect]));
    return out;
  };
  /** Read the list onto a freshly-loaded entity: straight into the map, NO onApplied (vanilla's
   *  read puts, the absorption it granted is its own saved `AbsorptionAmount`). */
  ES.load = function (e, list) {
    if (!e) return;
    e.effects = {};
    if (!list) return;
    for (var i = 0; i < list.length; i++) {
      var inst = ES.fromNbt(list[i]);
      if (inst) e.effects[inst.effect] = inst;
    }
  };
  /** `writeCustomDataToNbt`'s piece: `ActiveEffects` only when non-empty. */
  ES.writeActiveEffects = function (e, tag) {
    var l = ES.save(e);
    if (l.length) tag.ActiveEffects = l;
    return tag;
  };
  /** `readCustomDataFromNbt`'s piece: `contains("ActiveEffects", 9)` — a list or nothing. */
  ES.readActiveEffects = function (e, tag) {
    ES.load(e, tag && Array.isArray(tag.ActiveEffects) ? tag.ActiveEffects : null);
  };

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
