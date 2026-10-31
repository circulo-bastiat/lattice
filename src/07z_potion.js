// 07z_potion.js — QUEUE 0.2 raid loop: THE WITCH'S REAL POTION THROW. `Rd.OWED`'s own line
// named the gap precisely: "no thrown-potion entity/effect-on-hit substrate exists;
// Ai.ROSTER.witch reuses Ai.RangedBowAttackGoal ... as the nearest real goal". This file is
// that substrate — a real `potion` projectile (`EntityList.spawn('potion', ...)`), the splash
// (`PotionEntity.applySplashPotion`, `.decomp/net/minecraft/entity/projectile/thrown/
// PotionEntity.java`), and `WitchEntity`'s own potion CHOICE (both the thrown one,
// `WitchEntity.attack`, and the drunk one, `WitchEntity.tickMovement`'s own random rolls) —
// `.decomp/net/minecraft/entity/mob/WitchEntity.java`, read in full this pass.
//
// ⚠⚠ WHAT THIS FILE DOES NOT DO. The WATER SPLASH branch is modelled since D-648
// (`Po.applyWater`/`Po.extinguishAround`, axolotl hydration D-649). The LINGERING branch IS modelled now (loop/throwables-s116:
// `Po.applyLingeringPotion`/`Po.tickCloud` below, a real `area_effect_cloud` entity), reached
// only from the PLAYER's own throw (`07zzd_throw.js`) — the witch still never throws one
// (`Po.witchChoosePotion`'s own table has no lingering entry), so that half stays unreachable
// from the raid loop for a different reason than before. Same for
// `RaidGoal` itself (the witch's own TARGET SELECTOR that picks a hurt ally to walk to in the
// first place) — `Ai.ROSTER.witch`'s own header already names that as unwired; this file's
// `Po.witchChoosePotion` implements the CHOICE `WitchEntity.attack` makes once a raider IS the
// target, by whatever means (today: never, in practice, because no such target is ever set —
// named, not hidden).
//
// Runs on: MAIN THREAD ONLY. No DOM — same standing as `07q_effects.js`, which this file's
// splash reads (`NS.Effects.addStatusEffect`) but does not duplicate.

(function (NS) {
  'use strict';

  var Po = NS.Potion = { ready: true };   // self-contained, like NS.Effects — no init() needed

  // ── THE PROJECTILE'S OWN MOTION — `ThrownEntity.tick()`/`PotionEntity.getGravity()` ───────
  // (`.decomp/.../thrown/ThrownEntity.java`: `setVelocity(vel.multiply(0.99F or 0.8F if
  // touching water))` then, unless `hasNoGravity()`, `vel.y -= getGravity()`; the base
  // `ThrownEntity.getGravity()` is 0.03F, but `PotionEntity` OVERRIDES it to 0.05F — the
  // number this unit's own task line names). `EL.motionFor`'s 07i_entitylist.js hunk hardcodes
  // this pair the same way D-402 hardcoded `evoker_fangs`'s [0,1]: no bytecode extractor for
  // `potion` has run this session (named on `Po.OWED`), but the decompile source is read in
  // full and cited, the same standing D-307's own header requires for a number this store owns.
  // WorldRenderer.processWorldEvent 2002/2007: pitch = random.nextFloat() * 0.1 + 0.9
  Po.breakPitch = function (rnd) { return rnd() * 0.1 + 0.9; };
  Po.GRAVITY = 0.05;         // PotionEntity.getGravity() override
  Po.DRAG_AIR = 0.99;        // ThrownEntity.tick()'s own non-water branch — the only one this
                              // engine's air path reads; water drag 0.8 + bubbles live in `EL.dampThrown` (#1622) (no water-drag substrate for a
                              // thrown entity exists yet, named on `Po.OWED`)

  // ── THE THROW — `WitchEntity.attack(target, pullProgress)` (WitchEntity.java:238-266) and
  // `ProjectileEntity.setVelocity(x, y, z, power, uncertainty)` (Yarn 1.18.2, javap-unavailable
  // in this sandbox — public MCP/Yarn decompile, same discipline D-396/D-402 already used for
  // RangedBowAttackGoal/Combat.mobShoot's own transcribed constants). ────────────────────────
  Po.THROW_POWER = 0.75;        // WitchEntity.attack(): this.setVelocity(dx, dy, dz, 0.75F, 8.0F)
  Po.THROW_INACCURACY = 8.0;
  Po.WITCH_EYE_HEIGHT = 1.62;   // WitchEntity.getActiveEyeHeight; PotionEntity(world, owner) spawns at owner.getEyeY() - 0.1
  Po.THROW_ARC = 0.2;           // attack()'s own `dy = eyeY - 1.1 - witchY + dist * 0.2`
  Po.THROW_EYE_DROP = 1.1;      // the same line's own `- 1.1F`

  /**
   * `ProjectileEntity.setVelocity(x, y, z, power, uncertainty)`: normalize the aim vector, add
   * a per-axis Gaussian jitter scaled `0.0075 * uncertainty`, then scale by `power`. The jitter is
   * java.util.Random.nextGaussian (NS.U.polarGaussian: polar method, spare cached on `rand`).
   */
  function gauss(rand) {
    return NS.U.polarGaussian(rand);
  }
  Po.throwVelocity = function (dx, dy, dz, power, uncertainty, rand) {
    var r = rand || NS.wrand;
    var len = Math.hypot(dx, dy, dz) || 1;
    var nx = dx / len + gauss(r) * 0.0075 * uncertainty;
    var ny = dy / len + gauss(r) * 0.0075 * uncertainty;
    var nz = dz / len + gauss(r) * 0.0075 * uncertainty;
    return { vx: nx * power, vy: ny * power, vz: nz * power };
  };

  // ── THE POTION TABLE — `Potions.java` (Yarn 1.18.2), the nine registrations this witch's own
  // two rolls (thrown + drunk) ever reach. Every `{effect, duration, amplifier}` triple is the
  // literal `new StatusEffectInstance(...)` argument the registration passes, read from the
  // decompile in full this pass, not remembered from an older session. ──────────────────────
  // D-648: the WHOLE `Potions.java` registry (all 43 registrations, read in full; the check
  // `witchpotioncheck` §11 re-derives this table from .decomp every run, so a typo here is red).
  // Each row is `[effect, duration, amplifier]` per `new StatusEffectInstance(...)` argument;
  // empty/water/mundane/thick/awkward carry NO effects. `def.effect/duration/amplifier` mirror
  // the first row for the witch's own single-effect readers.
  Po.POTION_TABLE = {
    empty: [], water: [], mundane: [], thick: [], awkward: [],
    night_vision: [['night_vision', 3600, 0]], long_night_vision: [['night_vision', 9600, 0]],
    invisibility: [['invisibility', 3600, 0]], long_invisibility: [['invisibility', 9600, 0]],
    leaping: [['jump_boost', 3600, 0]], long_leaping: [['jump_boost', 9600, 0]], strong_leaping: [['jump_boost', 1800, 1]],
    fire_resistance: [['fire_resistance', 3600, 0]], long_fire_resistance: [['fire_resistance', 9600, 0]],
    swiftness: [['speed', 3600, 0]], long_swiftness: [['speed', 9600, 0]], strong_swiftness: [['speed', 1800, 1]],
    slowness: [['slowness', 1800, 0]], long_slowness: [['slowness', 4800, 0]], strong_slowness: [['slowness', 400, 3]],
    turtle_master: [['slowness', 400, 3], ['resistance', 400, 2]],
    long_turtle_master: [['slowness', 800, 3], ['resistance', 800, 2]],
    strong_turtle_master: [['slowness', 400, 5], ['resistance', 400, 3]],
    water_breathing: [['water_breathing', 3600, 0]], long_water_breathing: [['water_breathing', 9600, 0]],
    healing: [['instant_health', 1, 0]], strong_healing: [['instant_health', 1, 1]],
    harming: [['instant_damage', 1, 0]], strong_harming: [['instant_damage', 1, 1]],
    poison: [['poison', 900, 0]], long_poison: [['poison', 1800, 0]], strong_poison: [['poison', 432, 1]],
    regeneration: [['regeneration', 900, 0]], long_regeneration: [['regeneration', 1800, 0]], strong_regeneration: [['regeneration', 450, 1]],
    strength: [['strength', 3600, 0]], long_strength: [['strength', 9600, 0]], strong_strength: [['strength', 1800, 1]],
    weakness: [['weakness', 1800, 0]], long_weakness: [['weakness', 4800, 0]],
    luck: [['luck', 6000, 0]],
    slow_falling: [['slow_falling', 1800, 0]], long_slow_falling: [['slow_falling', 4800, 0]]
  };
  Po.POTIONS = {};
  (function () {
    for (var id in Po.POTION_TABLE) {
      var rows = Po.POTION_TABLE[id], effects = [];
      for (var k = 0; k < rows.length; k++) effects.push({ effect: rows[k][0], duration: rows[k][1], amplifier: rows[k][2] });
      var def = { effects: effects };
      if (effects.length) { def.effect = effects[0].effect; def.duration = effects[0].duration; def.amplifier = effects[0].amplifier; }
      Po.POTIONS[id] = def;
    }
  })();
  /** `PotionUtil.getPotionEffects(stack)`: the potion's own effects, then the custom ones. */
  Po.effectsOf = function (potionId, custom) {
    var def = potionId ? Po.POTIONS[potionId] : null, out = [];
    if (def) for (var i = 0; i < def.effects.length; i++) out.push(def.effects[i]);
    if (custom) for (var j = 0; j < custom.length; j++) if (custom[j] && custom[j].effect) out.push(custom[j]);
    return out;
  };

  // ── loop/potion-splash-impact -- `StatusEffects.java`'s OWN full registry (Yarn 1.18.2, read
  // in full this pass, all 32 registrations), the per-effect `getColor()` `PotionUtil.getColor
  // (Collection<StatusEffectInstance>)` averages (.decomp potion/PotionUtil.java:88-110, read
  // whole). Every value below is the literal SECOND constructor argument of `new StatusEffect
  // (category, COLOR)`/`new InstantStatusEffect(category, COLOR)`/etc in `StatusEffects.java`
  // -- none of this engine's own `Po.POTION_TABLE` invents an effect name this table lacks. ──
  Po.EFFECT_COLOR = {
    speed: 8171462, slowness: 5926017, haste: 14270531, mining_fatigue: 4866583,
    strength: 9643043, instant_health: 16262179, instant_damage: 4393481, jump_boost: 2293580,
    nausea: 5578058, regeneration: 13458603, resistance: 10044730, fire_resistance: 14981690,
    water_breathing: 3035801, invisibility: 8356754, blindness: 2039587, night_vision: 2039713,
    hunger: 5797459, weakness: 4738376, poison: 5149489, wither: 3484199, health_boost: 16284963,
    absorption: 2445989, saturation: 16262179, glowing: 9740385, levitation: 13565951,
    luck: 3381504, unluck: 12624973, slow_falling: 16773073, conduit_power: 1950417,
    dolphins_grace: 8954814, bad_omen: 745784, hero_of_the_village: 4521796
  };
  Po.DEFAULT_POTION_COLOR = 16253176;   // PotionUtil.DEFAULT_COLOR -- Potions.WATER's own colour
  Po.EMPTY_EFFECTS_COLOR = 3694022;     // PotionUtil.getColor(Collection)'s own "isEmpty" return
  /**
   * `PotionUtil.getColor(ItemStack)` (.decomp potion/PotionUtil.java:75-81, read whole): a
   * water bottle (potionId `'water'`, no custom-colour NBT this engine tracks) is ALWAYS
   * `Po.DEFAULT_POTION_COLOR` regardless of any custom effect riding along on it -- the
   * source's own ternary tests the BASE potion type, not whether the effects list is empty --
   * every other id (including mundane/thick/awkward, which carry no base effects of their own)
   * falls through to `getColor(Collection)`'s own amplifier-weighted RGB average, or its own
   * `3694022` "isEmpty" literal when `Po.effectsOf` returns nothing at all.
   */
  Po.colorOf = function (potionId, custom) {
    if (potionId === 'water') return Po.DEFAULT_POTION_COLOR;
    var effects = Po.effectsOf(potionId, custom);
    if (!effects.length) return Po.EMPTY_EFFECTS_COLOR;
    var r = 0, g = 0, b = 0, w = 0;
    for (var i = 0; i < effects.length; i++) {
      var c = Po.EFFECT_COLOR[effects[i].effect];
      if (c === undefined) continue;   // an effect this table has no entry for contributes nothing, same as a StatusEffect that never shows particles
      var amp = (effects[i].amplifier || 0) + 1;
      r += amp * (c >> 16 & 0xFF) / 255; g += amp * (c >> 8 & 0xFF) / 255; b += amp * (c & 0xFF) / 255;
      w += amp;
    }
    if (!w) return 0;
    r = Math.floor(r / w * 255); g = Math.floor(g / w * 255); b = Math.floor(b / w * 255);
    return (r << 16) | (g << 8) | b;
  };
  /**
   * `Potion.hasInstantEffect()` (.decomp potion/Potion.java:37-43): the BASE potion's own
   * effects only -- unlike `Po.colorOf`, custom NBT effects riding along do NOT flip this
   * (`PotionEntity.onCollision`'s own `$2 = PotionUtil.getPotion($1)`, the plain `Potion`,
   * not `getPotionEffects`'s custom-inclusive list). Only `instant_health`/`instant_damage`
   * are `InstantStatusEffect` in this table's own base-potion rows (`saturation` is also
   * instant in vanilla but no potion in `Po.POTION_TABLE` ever carries it).
   */
  Po.hasInstantEffect = function (potionId) {
    var def = potionId ? Po.POTIONS[potionId] : null;
    if (!def) return false;
    for (var i = 0; i < def.effects.length; i++) {
      var e = def.effects[i].effect;
      if (e === 'instant_health' || e === 'instant_damage') return true;
    }
    return false;
  };

  // `RaiderEntity`'s own known subclasses this engine spawns (`raidmobcheck.mjs`'s own
  // `RAID_MOBS` list, `Rd.MEMBER_ORDER` plus illusioner) — `WitchEntity.attack`'s
  // `target instanceof RaiderEntity` test, transcribed as a type-name set because this engine
  // has no class hierarchy to `instanceof` against.
  Po.RAIDER_TYPES = { vindicator: 1, pillager: 1, witch: 1, ravager: 1, evoker: 1, illusioner: 1 };
  Po.isRaider = function (t) { return !!(t && t.type && Po.RAIDER_TYPES[t.type]); };

  /**
   * `WitchEntity.attack(LivingEntity target, float pullProgress)` (WitchEntity.java:238-266),
   * the CHOICE half only — the throw itself is `Po.witchThrow`, below. Mirrors the source's own
   * if/else-if chain exactly, in the same order, defaulting to `harming` (Potions.field_9004,
   * the local variable's own initial value) when nothing more specific matches.
   */
  Po.witchChoosePotion = function (witch, target, rand) {
    var r = rand || NS.wrand;
    var ES = NS.Effects;
    if (Po.isRaider(target)) {
      return (target.health !== undefined && target.health <= 4) ? 'healing' : 'regeneration';
    }
    // WitchEntity.attack: the >=8 / <=3 distance INCLUDES the target's velocity (same dx/dz as the aim)
    var dx = (target.x + (target.vx || 0)) - witch.x, dz = (target.z + (target.vz || 0)) - witch.z;
    var horiz = Math.hypot(dx, dz);
    if (horiz >= 8 && !(ES && ES.hasStatusEffect(target, 'slowness'))) return 'slowness';
    if ((target.health === undefined || target.health >= 8) && !(ES && ES.hasStatusEffect(target, 'poison'))) return 'poison';
    if (horiz <= 3 && !(ES && ES.hasStatusEffect(target, 'weakness')) && r() < 0.25) return 'weakness';
    return 'harming';
  };

  /**
   * The live consequence of `Ai.ProjectileAttackGoal`'s `onShoot` — `WitchEntity.attack`'s own
   * velocity math (`WitchEntity.java:240-260`) plus `Po.witchChoosePotion`, spawning a real
   * `potion` entity through `EL.spawn`. Refuses while drinking (`attack()`'s own
   * `if (!this.isDrinking())` guard, WitchEntity.java:239) — the SAME `e.witchDrinking` flag
   * `Po.tickWitchDrink` (below) sets, so a witch mid-drink never throws.
   *
   * ⚠ `target.getVelocity()` (the target's OWN velocity, added to its position before aiming —
   * WitchEntity.java:241-243) reads `t.vx`/`t.vz` here, the same fields `EL.tickOne` already
   * writes every tick for a living target; a target this engine never gives velocity to (no
   * `vx`) aims at its bare position, same as vanilla aiming at a stationary one.
   */
  // WitchEntity.tickMovement/attack: playSound(entity.witch.drink|throw, 1.0, 0.8 + rand*0.4), unless silent.
  Po.witchSound = function (e, id, rand) {
    if (e.silent || !NS.Sound || !NS.Sound.play) return;
    NS.Sound.play(id, { x: e.x, y: e.y, z: e.z, volume: 1, pitch: 0.8 + (rand || NS.wrand)() * 0.4, source: 'hostile' });
  };

  Po.witchThrow = function (witch, target, spawnFn, rand) {
    if (!witch || !target || witch.witchDrinking) return null;
    var r = rand || NS.wrand;
    var eh = witch.height || 1.8, th = target.height || 1.8;
    var tvx = target.vx || 0, tvz = target.vz || 0;
    var dx = (target.x + tvx) - witch.x;
    var dz = (target.z + tvz) - witch.z;
    var Cb = NS.Combat;
    var teye = Cb && Cb.eyeHeightOf ? Cb.eyeHeightOf(target) : (target.eyeHeight || th * 0.85); // real getEyeY
    var eyeY = (target.y === undefined ? witch.y : target.y) + teye;
    var dy = eyeY - Po.THROW_EYE_DROP - witch.y;
    var horiz = Math.hypot(dx, dz);
    dy += horiz * Po.THROW_ARC;
    var potionId = Po.witchChoosePotion(witch, target, r);
    var vel = Po.throwVelocity(dx, dy, dz, Po.THROW_POWER, Po.THROW_INACCURACY, r);
    var spawn = spawnFn || (NS.EntityList && NS.EntityList.spawn);
    if (!spawn) return null;
    Po.witchSound(witch, 'entity.witch.throw', r);
    var e = spawn('potion', witch.x, witch.y + Po.WITCH_EYE_HEIGHT - 0.1, witch.z, { vx: vel.vx, vy: vel.vy, vz: vel.vz, shooter: witch, potionId: potionId });
    // WitchEntity.attack(): `if (target instanceof RaiderEntity) this.setTarget(null)` — the
    // heal-an-ally throw always ends the witch's own current target, same line.
    if (Po.isRaider(target)) witch.target = null;
    return e;
  };

  // ── THE SPLASH — `PotionEntity.applySplashPotion(List<StatusEffectInstance>, Entity direct)`
  // (`.decomp/.../PotionEntity.java:129-153`). The candidate box is `getBoundingBox().
  // expand(4.0, 2.0, 4.0)` (the task's own "4-block box"); the DISTANCE FALLOFF that actually
  // gates and scales every effect is the method's own `squaredDistanceTo < 16.0` (a 4-block
  // radius) — this file gates on that squared-distance test alone (it is a strict SUBSET of the
  // expand(4,2,4) box's corners, so nothing the box would include and the sphere would not
  // ever mattered to begin with) rather than implementing both a box AND a sphere test that
  // agree everywhere they overlap, named as the one simplification here.
  // ────────────────────────────────────────────────────────────────────────────────────────
  Po.SPLASH_RADIUS_SQ = 16;              // PotionEntity.java's own literal, applySplashPotion
  /** `getBoundingBox().expand(4,2,4)` of the 0.25 bottle at (px,py,pz) intersects the target's box. */
  Po.inSplashBox = function (t, px, py, pz) {
    var hw = (t.width || 0.6) / 2;
    return Math.abs(t.x - px) < 4.125 + hw && Math.abs(t.z - pz) < 4.125 + hw &&
      t.y < py + 2.25 && t.y + (t.height || 1.8) > py - 2;
  };
  /** `isAffectedBySplashPotions()`: LivingEntity true, ArmorStandEntity false. */
  Po.isAffectedBySplash = function (t) { return t.type !== 'armor_stand'; };
  /** `world.getNonSpectatingEntities` / `ProjectileEntity.canHit`: spectators are never splashed or hit. */
  Po.isSpectating = function (t) {
    var Gm = NS.Gamemode;
    return !!(t.spectator || (Gm && Gm.isSpectator && Gm.isSpectator(t)));
  };
  Po.SPLASH_MIN_DURATION = 20;           // "if (j > 20)" — a scaled-down tail is dropped outright
  /**
   * Applies `potionId`'s effects to every living entity in `targets` within the splash radius
   * of (px,py,pz), scaling non-instant durations by `1 - sqrt(distSq)/4` (1.0 for `directHit`
   * itself, same as the source's own `if (entity == direct) factor = 1.0F`). Returns the list
   * of entities actually affected (source: `entity.isAffectedBySplashPotions()` gate — this
   * engine has no per-species override table, so every LivingEntity (`maxHealth !== undefined`)
   * qualifies, named on `Po.OWED`).
   */
  Po.applySplashPotion = function (potionId, px, py, pz, targets, directHit, cause, custom) {
    var effects = Po.effectsOf(potionId, custom);
    var ES = NS.Effects;
    var hit = [];
    if (!effects.length || !targets) return hit;
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      // KW-38: the player carries no `maxHealth` field (14_player.js's own
      // construction never assigns one) even though `Po.tick`/`Po.tickCloud` above
      // already force the player into `targets` regardless -- so this filter, which is
      // everywhere else's "is this a LivingEntity" test (07k_goals.js:1872 names the
      // same convention), must carry the same explicit player exemption or the splash
      // silently drops the one entity the caller already guaranteed was in the list.
      if (!t || t.removed || t.dead || (t.maxHealth === undefined && t !== NS.Player)) continue;
      if (!Po.isAffectedBySplash(t) || Po.isSpectating(t) || !Po.inSplashBox(t, px, py, pz)) continue;
      var dx = t.x - px, dy = t.y - py, dz = t.z - pz;
      var distSq = dx * dx + dy * dy + dz * dz;
      if (!(distSq < Po.SPLASH_RADIUS_SQ)) continue;
      var factor = (t === directHit) ? 1.0 : (1.0 - Math.sqrt(distSq) / 4.0);
      var touched = false;
      for (var k = 0; k < effects.length; k++) {
        var one = effects[k];
        if (one.effect === 'instant_health' || one.effect === 'instant_damage') {
          // `StatusEffect.applyInstantEffect` (07q_effects.js, undead reversal included, D-647).
          if (ES) ES.applyInstantEffect(t, one.effect, one.amplifier, factor, cause);
          touched = true;
        } else {
          var dur = Math.floor(factor * one.duration + 0.5);
          if (dur > Po.SPLASH_MIN_DURATION) {
            if (ES) ES.addStatusEffect(t, one.effect, dur, one.amplifier, one.ambient, one.showParticles, undefined, cause);   // PotionEntity:~143 new StatusEffectInstance(type,dur,amp,isAmbient,shouldShowParticles), getEffectCause()
            touched = true;
          }
        }
      }
      if (touched) hit.push(t);
    }
    return hit;
  };

  // ── D-648: THE WATER SPLASH -- `PotionEntity.onCollision`'s `potion == WATER && effects
  // empty` branch (`damageEntitiesHurtByWater`, .decomp thrown/PotionEntity.java:100-116) and
  // `onBlockHit`'s `extinguishFire` ring (:62-79, :186-197). ─────────────────────────────────
  /** `LivingEntity.hurtByWater()` overrides: Blaze, Enderman, SnowGolem, Strider return true. */
  Po.HURT_BY_WATER = { blaze: true, enderman: true, snow_golem: true, strider: true };
  Po.isWaterSplash = function (potionId, custom) {
    return potionId === 'water' && !(custom && custom.length);
  };
  /** Every living target within distSq < 16 that is hurt by water takes 1.0 MAGIC damage. The
   *  axolotl `hydrateFromPotion` half has no air timer to add to (Po.OWED). */
  Po.applyWater = function (px, py, pz, targets, cause) {
    var ES = NS.Effects, hit = [];
    for (var i = 0; i < (targets || []).length; i++) {
      var t = targets[i];
      if (!t || t.removed || t.dead || !Po.HURT_BY_WATER[t.type] || Po.isSpectating(t)) continue;
      if (!Po.inSplashBox(t, px, py, pz)) continue;
      var dx = t.x - px, dy = t.y - py, dz = t.z - pz;
      if (!(dx * dx + dy * dy + dz * dz < Po.SPLASH_RADIUS_SQ)) continue;
      if (ES) ES.magicDamage(t, 1, cause);
      // EndermanEntity.damage (:351-364): the water bottle is a ProjectileDamageSource -> damageFromPotion
      // (super.damage, done above) AND then up to 64 teleportRandomly() tries.
      if (t.type === 'enderman' && NS.Enderman && NS.Enderman.ready) for (var k = 0; k < 64 && !NS.Enderman.teleportRandomly(t); k++);
      hit.push(t);
    }
    // `getNonSpectatingEntities(AxolotlEntity.class, box)`: the bottle's 0.25 box expanded
    // (4, 2, 4), box INTERSECTION (not the 16-distSq test) -- then hydrateFromPotion (D-649).
    var Ax = NS.Axolotl;
    for (var a = 0; Ax && a < (targets || []).length; a++) {
      var o = targets[a];
      if (!o || o.removed || o.type !== 'axolotl' || Po.isSpectating(o)) continue;
      var hw = (o.width || 0.75) / 2;
      if (Math.abs(o.x - px) < 4.125 + hw && Math.abs(o.z - pz) < 4.125 + hw &&
          o.y < py + 2.25 && o.y + (o.height || 0.42) > py - 2) Ax.hydrateFromPotion(o);
    }
    return hit;
  };
  /** `extinguishFire(pos)`: a fire-tag block is removed; a lit candle or lit campfire goes out. */
  Po.extinguishFire = function (x, y, z) {
    var W = NS.World, B = NS.Behave, Snd = NS.Sound;
    if (!W || !W.getBlock || !B) return false;
    var st = W.getBlock(x, y, z) | 0;
    if (!st) return false;
    if (B.inTag('fire', st)) { W.setBlock(x, y, z, 0); return true; }
    var lit = B.propName(st, 'lit') === 'true';
    if (lit && B.inTag('candles', st)) {
      W.setBlock(x, y, z, B.setProp(st, 'lit', false));
      if (Snd && Snd.entitySound) Snd.entitySound('block.candle.extinguish', x + 0.5, y + 0.5, z + 0.5, 1, 1, 'block', NS.Player);
      return true;
    }
    if (lit && B.inTag('campfires', st)) {
      // worldEvent 1009 data 0 (WorldRenderer.java:2769): block.fire.extinguish, 0.5, 2.6 +/- 0.8
      if (Snd && Snd.entitySound) Snd.entitySound('block.fire.extinguish', x + 0.5, y + 0.5, z + 0.5, 0.5, 2.6 + (NS.wrand() - NS.wrand()) * 0.8, 'block', NS.Player);
      W.setBlock(x, y, z, B.setProp(st, 'lit', false));
      return true;
    }
    return false;
  };
  /** `PotionEntity.onBlockHit`: pos = hitBlock.offset(face); extinguish pos, pos.offset(opposite) (the
   *  struck block), and pos's four horizontal neighbours. Faces in ARCH §3 order (0 +X,1 -X,2 +Y,3 -Y,4 +Z,5 -Z). */
  Po.FACE_D = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  Po.extinguishFace = function (bx, by, bz, face) {
    var d = Po.FACE_D[face], n = 0;
    var px = bx + d[0], py = by + d[1], pz = bz + d[2];
    if (Po.extinguishFire(px, py, pz)) n++;
    if (Po.extinguishFire(bx, by, bz)) n++;
    var H = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var i = 0; i < 4; i++) if (Po.extinguishFire(px + H[i][0], py, pz + H[i][1])) n++;
    return n;
  };
  /** `onBlockHit` for a TOP-face hit (the only block collision `Po.tick` sees: `e.onGround`):
   *  the cell the bottle sits in (pos.offset(UP)), the block it hit, and the cell's four
   *  horizontal neighbours. */
  Po.extinguishAround = function (cx, cy, cz, ceiling) {
    var n = 0;
    if (Po.extinguishFire(cx, cy, cz)) n++;
    if (Po.extinguishFire(cx, ceiling ? cy + 1 : cy - 1, cz)) n++;   // the hit block: above for a ceiling hit
    var H = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var i = 0; i < 4; i++) if (Po.extinguishFire(cx + H[i][0], cy, cz + H[i][1])) n++;
    return n;
  };

  // ── THE LINGERING CLOUD -- `PotionEntity.applyLingeringPotion`/`AreaEffectCloudEntity`
  // (.decomp/net/minecraft/entity/projectile/thrown/PotionEntity.java:159-172 and
  // .decomp/net/minecraft/entity/AreaEffectCloudEntity.java, both read in full). Closes this
  // file's own standing `Po.OWED` line (struck below) -- QUEUE 0.2 G18c / Use.OWED's
  // "throwables" row named it as the one substrate a lingering potion needed and this engine
  // had none of.
  // ────────────────────────────────────────────────────────────────────────────────────────
  Po.LINGERING_RADIUS = 3.0;          // applyLingeringPotion's own `setRadius(3.0F)`
  Po.LINGERING_RADIUS_ON_USE = -0.5;  // `setRadiusOnUse(-0.5F)`
  Po.LINGERING_WAIT = 10;             // `setWaitTime(10)`
  Po.LINGERING_DURATION = 600;        // AreaEffectCloudEntity's own field initializer, unchanged
                                       // by applyLingeringPotion (it only touches radius/wait)
  Po.LINGERING_REAPPLY = 20;          // AreaEffectCloudEntity's own field initializer

  /**
   * Spawns the real `area_effect_cloud` entity a lingering potion becomes on impact --
   * `EL.spawn('area_effect_cloud', ...)`, the SAME closed-set path every other live entity in
   * this engine goes through (D-298's own rule); `EL.DEFAULTS.area_effect_cloud`
   * (07i_entitylist.js) is what actually reads `radius`/`waitTime`/... off `opts` onto `e`.
   */
  Po.applyLingeringPotion = function (e) {
    var EL = NS.EntityList;
    if (!EL || !EL.canSpawn('area_effect_cloud')) return null;
    var radius = Po.LINGERING_RADIUS;
    var duration = Po.LINGERING_DURATION;
    return EL.spawn('area_effect_cloud', e.x, e.y, e.z, {
      shooter: e.shooter,
      radius: radius,
      radiusOnUse: Po.LINGERING_RADIUS_ON_USE,
      waitTime: Po.LINGERING_WAIT,
      duration: duration,
      reapplicationDelay: Po.LINGERING_REAPPLY,
      // `setRadiusGrowth(-this.getRadius() / (float)this.getDuration())` -- read AFTER radius
      // and duration are both already assigned, exactly the source's own order.
      radiusGrowth: -radius / duration,
      potionId: e.potionId || null,
      custom: e.custom || null
    });
  };

  /**
   * The live `area_effect_cloud`'s own per-tick consequence -- `AreaEffectCloudEntity.tick()`'s
   * server half; the client particle half is `Po.cloudParticles` above. `e.age` is the SAME generic per-tick counter
   * `EL.tickOne` already increments for every entity (D-298's own field, reused rather than a
   * second timer) -- it IS vanilla's own `Entity.age`, which `AreaEffectCloudEntity.tick()`
   * reads directly.
   *
   * ⚠ THE INSTANT-EFFECT FACTOR IS A FLAT 0.5, NOT DISTANCE-SCALED (`applyInstantEffect(...,
   * 0.5)`, source's own literal) -- `Po.applySplashPotion`'s own distance falloff does NOT
   * apply here, a real difference between the two potion paths rather than a copy-paste guess.
   */
  /**
   * AreaEffectCloudEntity.tick() world.isClient branch (.decomp :153-195). `rand` is the shared
   * java.util.Random-order source (nextBoolean as r()<0.5); returns the spawned [type,x,y,z,vx,vy,vz]
   * list. Counts: waiting 2 at radius 0.2, active ceil(PI*r*r) at radius r.
   */
  Po.cloudParticles = function (e, rand) {
    var r = rand || NS.wrand, Px = NS.Particles, out = [];
    var waiting = e.age < e.waitTime, rad = Math.fround(e.radius);
    if (waiting && r() < 0.5) return out;
    var type = e.particle || 'entity_effect';
    var n, spread;
    if (waiting) { n = 2; spread = Math.fround(0.2); } else { n = Math.ceil(Math.fround(Math.fround(Math.PI) * rad * rad)); spread = rad; }
    for (var i = 0; i < n; i++) {
      var ang = Math.fround(Math.fround(r()) * Math.fround(Math.PI * 2));
      var d = Math.fround(Math.fround(Math.sqrt(Math.fround(r()))) * spread);
      var x = e.x + Math.fround(Math.cos(ang) * d), z = e.z + Math.fround(Math.sin(ang) * d);
      var vx, vy, vz;
      if (type === 'entity_effect' || type === 'ambient_entity_effect') {
        var c = (waiting && r() < 0.5) ? 16777215 : (e.color !== undefined ? e.color : Po.colorOf(e.potionId, e.custom));
        vx = Math.fround((c >> 16 & 0xFF) / 255); vy = Math.fround((c >> 8 & 0xFF) / 255); vz = Math.fround((c & 0xFF) / 255);
      } else if (waiting) { vx = 0; vy = 0; vz = 0; }
      else { vx = (0.5 - r()) * 0.15; vy = Math.fround(0.01); vz = (0.5 - r()) * 0.15; }
      out.push([type, x, e.y, z, vx, vy, vz]);
      if (Px && Px.spawn && !Po.cloudDry) {
        var sp = Px.spawn(type === 'entity_effect' || type === 'ambient_entity_effect' ? 'effect' : type, x, e.y, z, vx, vy, vz, r);
        if (sp && (type === 'entity_effect' || type === 'ambient_entity_effect')) { sp.red = vx; sp.green = vy; sp.blue = vz; }
      }
    }
    return out;
  };

  Po.tickCloud = function (e) {
    if (!e || e.removed) return;
    if (Po.cloudClient !== false) Po.cloudParticles(e);
    if (e.age >= e.waitTime + e.duration) { e.removed = true; return; }
    if (e.age < e.waitTime) return;                    // still WAITING -- no radius decay, no hits
    if (e.radiusGrowth) {
      e.radius = Math.fround(e.radius + e.radiusGrowth);   // vanilla radius is a float
      if (e.radius < 0.5) { e.removed = true; return; }
    }
    if (e.age % 5 !== 0) return;
    if (!e.affected) e.affected = {};
    for (var k in e.affected) { if (e.age >= e.affected[k]) delete e.affected[k]; }
    var def = Po.POTIONS[e.potionId];
    var defs = [];
    // AreaEffectCloudEntity.java:224-229 -- every potion effect at `getDuration() / 4` (int division, D-648)
    if (def) for (var pi = 0; pi < def.effects.length; pi++) {
      var pe = def.effects[pi];
      defs.push({ effect: pe.effect, duration: Math.floor(pe.duration / 4), amplifier: pe.amplifier });
    }
    if (e.custom) for (var ci = 0; ci < e.custom.length; ci++) defs.push(e.custom[ci]);
    if (!defs.length) { e.affected = {}; return; }
    var ES = NS.Effects;
    var list = NS.EntityList && NS.EntityList.list;
    var targets = [];
    if (list) { for (var i = 0; i < list.length; i++) { var p = list[i]; if (!p.removed && p.maxHealth !== undefined) targets.push(p); } }
    if (NS.Player && targets.indexOf(NS.Player) < 0) targets.push(NS.Player);
    for (var j = 0; j < targets.length; j++) {
      var t = targets[j];
      if (t.removed || t.dead || !Po.isAffectedBySplash(t) || Po.isSpectating(t)) continue;
      var tid = (t === NS.Player) ? 'player' : t.id;
      if (e.affected[tid] !== undefined) continue;
      // the cloud's own box (2r wide, 0.5 tall) must intersect the target's
      var thw = (t.width || 0.6) / 2;
      if (Math.abs(t.x - e.x) >= e.radius + thw || Math.abs(t.z - e.z) >= e.radius + thw ||
          t.y >= e.y + 0.5 || t.y + (t.height || 1.8) <= e.y) continue;
      var dx = t.x - e.x, dz = t.z - e.z;
      if ((dx * dx + dz * dz) > e.radius * e.radius) continue;
      e.affected[tid] = e.age + e.reapplicationDelay;
      for (var d = 0; d < defs.length; d++) {
        var one = defs[d];
        if (one.effect === 'instant_health' || one.effect === 'instant_damage') {
          if (ES) ES.applyInstantEffect(t, one.effect, one.amplifier, 0.5, e.owner || e.shooter);   // AreaEffectCloudEntity.java:249
        } else if (ES) {
          ES.addStatusEffect(t, one.effect, one.duration, one.amplifier);
        }
      }
      if (e.radiusOnUse) {
        e.radius = Math.fround(e.radius + e.radiusOnUse);
        if (e.radius < 0.5) { e.removed = true; return; }
      }
      if (e.durationOnUse) {                                // AreaEffectCloudEntity.java: duration += durationOnUse; <= 0 discards
        e.duration = (e.duration + e.durationOnUse) | 0;
        if (e.duration <= 0) { e.removed = true; return; }
      }
    }
  };

  /**
   * The live `potion` entity's own per-tick consequence — `ThrownEntity.tick()`'s collision
   * check plus `PotionEntity.onCollision` (splash-and-discard), called from `EL.tickOne` for
   * every `potion` in the list, same dispatch shape D-402 already uses for `arrow`
   * (`Combat.tickArrow`). Checks the CURRENT position each tick, same simplification
   * `Combat.tickArrow`'s own header already names for arrows — not a whole-path raycast.
   */
  Po.tick = function (e) {
    if (!e || e.removed) return;
    var hitEntity = null;
    var list = NS.EntityList && NS.EntityList.list;
    // `ProjectileEntity.shouldLeaveOwner`/`canHit`: the owner is hittable once the bottle has left its box
    // (simplified to the current position, like the rest of this scan).
    var sh = e.shooter;
    if (sh && !e.leftOwner) {
      var sw = (sh.width !== undefined ? sh.width : 0.6) / 2 + 0.25, shh = sh.height !== undefined ? sh.height : 1.8;
      if (!(Math.abs(e.x - sh.x) <= sw && Math.abs(e.z - sh.z) <= sw && e.y >= sh.y - 0.25 && e.y <= sh.y + shh + 0.25)) e.leftOwner = true;
    }
    // ProjectileUtil.getCollision: the segment pos -> pos+velocity this tick (`EL.tickOne` stores it;
    // a bare call sweeps a zero-length segment = the point test), entities inflated 0.3, nearest wins.
    var Cb = NS.Combat;
    var sw0 = e.sx !== undefined;
    var ox = sw0 ? e.sx : e.x, oy = sw0 ? e.sy : e.y, oz = sw0 ? e.sz : e.z;
    var mx = sw0 ? e.svx : 0, my = sw0 ? e.svy : 0, mz = sw0 ? e.svz : 0;
    var bestT = 2, IN = 0.3, hitT = -1;
    var cand = [];
    if (list) {
      for (var i = 0; i < list.length; i++) {
        var o = list[i];
        if (o === e || o.removed || (o === e.shooter && !e.leftOwner) || o.maxHealth === undefined || Po.isSpectating(o)) continue;
        cand.push(o);
      }
    }
    // KW-38: `EL.list` never holds the player (14_player.js keeps it in its own `NS.Player`
    // singleton) -- `ProjectileUtil.getEntityCollision` does not carve the player out, so it is not carved out here.
    if (NS.Player && (NS.Player !== e.shooter || e.leftOwner) && !NS.Player.removed && !NS.Player.dead && !Po.isSpectating(NS.Player) && cand.indexOf(NS.Player) < 0) cand.push(NS.Player);
    for (var ci = 0; ci < cand.length; ci++) {
      var o2 = cand[ci];
      var tw = o2.width !== undefined ? o2.width : 0.6;
      var th = o2.height !== undefined ? o2.height : 1.8;
      var ct = Cb && Cb.rayBox ? Cb.rayBox(ox, oy, oz, mx, my, mz, o2.x - tw / 2 - IN, o2.y - IN, o2.z - tw / 2 - IN,
                                           o2.x + tw / 2 + IN, o2.y + th + IN, o2.z + tw / 2 + IN) : null;
      if (ct === null && Math.abs(e.x - o2.x) <= tw / 2 + 0.25 && Math.abs(e.z - o2.z) <= tw / 2 + 0.25 &&
          e.y >= o2.y - 0.25 && e.y <= o2.y + th + 0.25) ct = 0;
      if (ct !== null && ct <= 1 && ct < bestT) { bestT = ct; hitEntity = o2; hitT = ct; }
    }
    // block half: world.raycast(pos -> pos+v, COLLIDER, NONE); the nearer of block/entity wins
    var hitFace = -1, hitBx = 0, hitBy = 0, hitBz = 0;
    var len = Math.sqrt(mx * mx + my * my + mz * mz);
    if (len > 0 && NS.Ray && NS.World && Cb && Cb.arrowCollides) {
      var bh = NS.Ray.cast(ox, oy, oz, mx / len, my / len, mz / len, len, Cb.arrowCollides, true);
      if (bh && bh.dist / len < bestT) {
        hitEntity = null; hitT = bh.dist / len; hitFace = bh.face; hitBx = bh.x; hitBy = bh.y; hitBz = bh.z;
      }
    }
    if (hitT >= 0 && sw0) { e.x = ox + mx * hitT; e.y = oy + my * hitT; e.z = oz + mz * hitT; }   // it breaks where it struck
    if (!hitEntity && hitFace < 0 && !e.onGround && !e.horizontalCollision && !e.verticalCollision) return;   // still in flight, no collision this tick
    // loop/throwables-s116 -- `PotionEntity.onCollision`'s own `isLingering()` branch
    // (.decomp :85-96): a lingering potion spawns the AreaEffectCloudEntity and skips the
    // flat splash entirely, closing the gap this file's own `Po.OWED` used to name (struck
    // below). `e.potionId` is null for a plain water splash (no effect rows at all --
    // `Po.applyLingeringPotion`/`Po.applySplashPotion` both no-op on a null id, same as the
    // water-splash branch this file still does not model, named on `Po.OWED`).
    // struck s117: `07zzd_throw.js`'s own `Th.OWED` line -- `PotionEntity.onCollision`'s own
    // break sound, `entity.splash_potion.break` (`.mcsnd/sounds.json`; the SAME single event
    // for both branches -- there is no `entity.lingering_potion.break` in the jar's own
    // registry), fired via `world.syncWorldEvent(2007|2002, pos, color)` regardless of
    // lingering/splash (.decomp thrown/PotionEntity.java:88-91, read whole). Volume/pitch are
    // NOT reconstructed here either -- that pitch/volume ((getVolume()+1)/2, getPitch()*0.8)
    // belongs to a DIFFERENT world event (2001, the BLOCK-BREAK case just above 2002 in
    // WorldRenderer.processWorldEvent) and is not this one's own; `S.play`'s own defaults
    // (1, 1) stand in, same category as the splash/lingering THROW itself (`neutral` --
    // `Th.ITEMS.splash_potion.category`, this event has no player-only distinction in the
    // source).
    var Snd = NS.Sound;
    if (Snd && Snd.entitySound) Snd.entitySound('entity.splash_potion.break', e.x, e.y, e.z, 1, Po.breakPitch(NS.wrand), 'neutral', NS.Player);
    // loop/potion-splash-impact -- CLOSED: the SAME `syncWorldEvent(2002|2007, blockPos,
    // color)` above is also `WorldRenderer.processWorldEvent`'s own case 2002/2007
    // (.decomp client/render/WorldRenderer.java:2964-2999, read whole, IS present in this
    // worktree's `.decomp` checkout) -- the glass-bottle crack burst plus the tinted
    // effect/instant_effect splash, `Px.spawnPotionSplash` (07zx_particle.js). `color`/
    // `instant` are `Po.colorOf`/`Po.hasInstantEffect` (above), reusing this SAME
    // `e.potionId`/`e.custom` pair rather than re-deriving either from scratch. The block
    // position is `e.getBlockPos()`'s own floor of the CURRENT collision position, the SAME
    // floor `Po.extinguishAround`'s own call site below already takes.
    var Px = NS.Particle;
    if (Px && Px.spawnPotionSplash) {
      Px.spawnPotionSplash(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z),
        Po.colorOf(e.potionId, e.custom), Po.hasInstantEffect(e.potionId));
    }
    if (e.lingering) {
      Po.applyLingeringPotion(e);
      e.removed = true;
      return;
    }
    var targets = [];
    if (list) {
      for (var j = 0; j < list.length; j++) {
        var p = list[j];
        if (!p.removed && p.maxHealth !== undefined) targets.push(p);
      }
    }
    if (NS.Player && targets.indexOf(NS.Player) < 0) targets.push(NS.Player);
    if (Po.isWaterSplash(e.potionId, e.custom)) {
      Po.applyWater(e.x, e.y, e.z, targets, e.shooter);
      if (!hitEntity) {
        if (hitFace >= 0) Po.extinguishFace(hitBx, hitBy, hitBz, hitFace);
        else Po.extinguishAround(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z), !e.onGround && e.verticalCollision);
      }
    } else {
      Po.applySplashPotion(e.potionId, e.x, e.y, e.z, targets, hitEntity, e.shooter, e.custom);
    }
    e.removed = true;
  };

  // ── THE WITCH'S OWN DRINK — `WitchEntity.tickMovement()` (WitchEntity.java:105-165), the
  // FOUR self-buff rolls plus the drinking timer/speed penalty. Called once a tick for a live
  // `witch` (07i_entitylist.js's `EL.tickMob` hunk), same "every tick regardless of goals"
  // standing the source's own `tickMovement` override has (it runs OUTSIDE the goal selector).
  // ────────────────────────────────────────────────────────────────────────────────────────
  Po.DRINK_SPEED_PENALTY = -0.25;   // WitchEntity.DRINKING_SPEED_PENALTY_MODIFIER, ADDITION
  Po.DRINK_SWIM_CHANCE = 0.15;
  Po.DRINK_FIRE_CHANCE = 0.15;
  Po.DRINK_HEAL_CHANCE = 0.05;
  Po.DRINK_SWIFT_CHANCE = 0.5;
  Po.DRINK_TARGET_DIST_SQ = 121;    // 11 blocks — tickMovement's own `> 121.0`
  Po.DRINK_TIME = 32;               // ItemStack(potion).getMaxUseTime() — vanilla's own
                                     // UseAction.DRINK constant, every potion item alike

  /**
   * One tick of `WitchEntity.tickMovement()`'s own drink state machine. `ctx.random` is a
   * zero-arg `[0,1)` source, called in the SAME order the source rolls it (submerged/fire/heal/
   * swift), so a fixed sequence in `witchpotioncheck.mjs` drives a specific, named branch.
   */
  Po.tickWitchDrink = function (e, ctx) {
    if (!e || e.type !== 'witch' || e.dead) return;
    // loop/raidvex-s96 -- `WitchEntity.tickMovement()`'s own FIRST line, unconditional every
    // real tick regardless of goal state: `this.raidGoal.decreaseCooldown()`. Read by
    // `Ai.RaidGoal`/`Ai.DisableableFollowTargetGoal` (07k_goals.js) off `e.witchRaidCooldown`
    // directly rather than a private goal-closure field, the same `e.*`-lives-the-state shape
    // `e.witchDrinking` two lines down already uses.
    e.witchRaidCooldown = (e.witchRaidCooldown || 0) - 1;
    // #1000 -- `WitchEntity.tickMovement` (after the drinking/else block: runs while drinking too, #1283): `random.nextFloat() < 7.5E-4F`
    // -> `world.sendEntityStatus(this, 15)` -> `handleStatus(15)`'s magic particles.
    // (own Math.random, not ctx.random: the drink rolls below are a scripted sequence in witchpotioncheck)
    if (NS.wrand() < 7.5E-4 && NS.Particle && NS.Particle.spawnWitchMagic)
      NS.Particle.spawnWitchMagic(e);
    var ES = NS.Effects;
    var r = (ctx && ctx.random) || NS.wrand;
    if (e.witchDrinking) {
      // `if (this.drinkTimeLeft-- <= 0)`: compares the OLD value, then decrements (#997)
      var drinkLeft = e.witchDrinkTimeLeft || 0;
      e.witchDrinkTimeLeft = drinkLeft - 1;
      if (drinkLeft <= 0) {
        e.witchDrinking = false;
        var def = Po.POTIONS[e.witchDrinkPotion];
        if (def) {
          // WitchEntity.java:122-125 -- every effect of the drunk potion goes through
          // `addStatusEffect`, instant ones included; `ES.tick` applies an instant effect on its
          // next tick (InstantStatusEffect.canApplyUpdateEffect = duration >= 1, D-647).
          if (ES) for (var de = 0; de < def.effects.length; de++) ES.addStatusEffect(e, def.effects[de].effect, def.effects[de].duration, def.effects[de].amplifier);
        }
        e.witchDrinkPotion = null;
        // WitchEntity.java:120 -- `equipStack(MAINHAND, ItemStack.EMPTY)`
        if (NS.Equip && NS.Items && NS.Items.ready) NS.Equip.setEquipped(e, NS.Items.MAINHAND, null);
      }
      return;
    }
    var pick = null;
    // `isSubmergedIn(FluidTags.WATER)` ~ this engine's own eye-level fluid probe
    // (`Ph.updateFluids`'s `e.eyeInWater`, run for every mob in `EL.tickMob` before the goals).
    var submerged = !!e.eyeInWater;
    var onFire = !!e.isOnFire;
    // getRecentDamageSource() is non-null only within 40 ticks of the hit (LivingEntity.java).
    var recentFire = e.lastFireHurtAge !== undefined && ((e.age | 0) - e.lastFireHurtAge) <= 40;
    if (r() < Po.DRINK_SWIM_CHANCE && submerged && !(ES && ES.hasStatusEffect(e, 'water_breathing'))) {
      pick = 'water_breathing';
    } else if (r() < Po.DRINK_FIRE_CHANCE && (onFire || recentFire) && !(ES && ES.hasStatusEffect(e, 'fire_resistance'))) {
      pick = 'fire_resistance';
    } else if (r() < Po.DRINK_HEAL_CHANCE && e.health < e.maxHealth) {
      pick = 'healing';
    } else if (r() < Po.DRINK_SWIFT_CHANCE && e.target &&
               !(ES && ES.hasStatusEffect(e, 'speed'))) {
      var dx = e.target.x - e.x, dy = e.target.y - e.y, dz = e.target.z - e.z;
      if ((dx * dx + dy * dy + dz * dz) > Po.DRINK_TARGET_DIST_SQ) pick = 'swiftness';
    }
    if (pick) {
      e.witchDrinking = true;
      e.witchDrinkPotion = pick;
      e.witchDrinkTimeLeft = Po.DRINK_TIME;
      // WitchEntity.java:150 -- `equipStack(MAINHAND, PotionUtil.setPotion(new ItemStack(POTION), potion))`
      if (NS.Equip && NS.Items && NS.Items.ready && NS.Items.index.potion !== undefined)
        NS.Equip.setEquipped(e, NS.Items.MAINHAND, { i: NS.Items.index.potion, n: 1, potion: pick });
      Po.witchSound(e, 'entity.witch.drink');
    }
  };

  /**
   * loop/tipped -- `ArrowEntity.initFromStack` (.decomp ArrowEntity.java:45-61, read whole),
   * the tipped-arrow ITEM's own tag read into the `{ potionId, custom }` shape
   * `Cb.applyArrowTip` (14j_combat.js) reads back at hit time: `PotionUtil.getPotion(stack)`
   * -> the tag's `Potion` string (namespaced, `07zt_wtrader.js`'s own `'minecraft:invisibility'`
   * precedent) keyed into `Po.POTIONS` after stripping the `minecraft:` prefix; a `long_`/
   * `strong_` tier prefix is NOT stripped (`Po.OWED` below names why: this table holds only the
   * nine base ids a witch ever rolls, not vanilla's full tiered `Potions.java` registry) so a
   * tiered id simply misses the table, same as an unknown id. `PotionUtil.getCustomPotionEffects
   * (stack)` -> the tag's own `CustomPotionEffects` list, copied through as-is (already the
   * `{effect,duration,amplifier}` shape `ES.instance` uses everywhere else in this engine).
   */
  Po.tipFromTag = function (tag) {
    if (!tag) return null;
    var out = {};
    if (tag.Potion) {
      var id = String(tag.Potion).replace(/^minecraft:/, '');
      if (Po.POTIONS[id]) out.potionId = id;
    }
    if (tag.CustomPotionEffects && tag.CustomPotionEffects.length) {
      out.custom = [];
      for (var i = 0; i < tag.CustomPotionEffects.length; i++) {
        var c = tag.CustomPotionEffects[i];
        if (!c) continue;
        var effect = c.effect || c.Effect || c.id;
        if (!effect) continue;
        out.custom.push({ effect: effect, duration: (c.duration || c.Duration || 0) | 0, amplifier: (c.amplifier || c.Amplifier || 0) | 0 });
      }
    }
    return (out.potionId || (out.custom && out.custom.length)) ? out : null;
  };

  /**
   * `PotionUtil.getColor(ItemStack)` (.decomp potion/PotionUtil.java:75-81): `CustomPotionColor` wins; a stack
   * whose Potion is EMPTY (no tag, or an unknown id) is DEFAULT_COLOR; otherwise `Po.colorOf`.
   */
  Po.colorOfStack = function (stack) {
    var t = stack && stack.t;
    if (t && typeof t.CustomPotionColor === 'number') return t.CustomPotionColor | 0;
    var tip = Po.tipFromTag(t || null);
    if (!tip || !tip.potionId || tip.potionId === 'empty') {
      if (tip && tip.custom) return Po.colorOf(tip.potionId, tip.custom);
      return Po.DEFAULT_POTION_COLOR;
    }
    return Po.colorOf(tip.potionId, tip.custom);
  };

  Po.OWED = [
    // struck s116: the AreaEffectCloudEntity substrate is built (Po.applyLingeringPotion/
    // Po.tickCloud above, EL.DEFAULTS.area_effect_cloud, 07i_entitylist.js) and the player's
    // own lingering potion throw (07zzd_throw.js) reaches it live; the witch still never
    // throws a lingering potion (Po.witchChoosePotion's own table has no lingering entry), so
    // that half of the ORIGINAL line stays true and is re-stated below rather than erased.
    // struck D-648/D-649: the water splash (hurtByWater 1.0 MAGIC, extinguishFire ring, axolotl
    // hydrateFromPotion) is real. Residue:
    // struck #5068: Po.tick sweeps pos->pos+velocity (blocks + 0.3-inflated entities) and uses the real hit face (Po.extinguishFace).
    // struck #1621: isAffectedBySplashPotions (armor_stand false) + the expand(4,2,4) box filter are real.
    // struck D-647: undead reversal + canHaveStatusEffect immunities (07q_effects.js ES.applyInstantEffect).
    // struck #1282: the drunk potion is now a real mainhand ItemStack (set on drink, cleared on drink-end; ER.witchHeldItems draws it)
    // ── CLOSED THIS PASS (loop/raidvex-s96) -- `Ai.RaidGoal`/`Ai.DisableableFollowTargetGoal`
    // (07k_goals.js's own witch roster entry) now really hand the witch a nearby raider ally
    // to walk to and heal/buff, on the SAME 50%-roll/200-tick-cooldown shape
    // `RaidGoal.canStart`/`WitchEntity.tickMovement` use — `Po.witchChoosePotion`'s own
    // raider-ally branch is reachable from live play for the first time. ──
    'submerged/on-fire detection (`Po.tickWitchDrink`\'s `e.eyeInWater`/`e.isOnFire`) reads ' +
      'whatever flag this engine\'s fluid/fire tick already sets on the entity rather than a ' +
      'bytecode-verified `isSubmergedIn(FluidTags.WATER)`/`isOnFire()` pair walked fresh this pass',
    // loop/tipped -- CLOSED the effect-APPLICATION half: `Cb.applyArrowTip`/`Po.tipFromTag`
    // now replay `ArrowEntity.onHit`'s real two-loop shape exactly (dur/8 for the base potion,
    // undivided for custom effects) -- `tippedcheck.mjs` drives both loops directly.
    // loop/bow -- CLOSED the other half this row named: `Use.bowRelease` (14l_use.js) is a
    // real `BowItem.onStoppedUsing`, and a crafted/traded `tipped_arrow` the PLAYER fires now
    // reaches `Cb.applyArrowTip` on a real, in-flight arrow (`bowcheck.mjs`). What remains,
    // named rather than silently unreachable: no MOB AI selects ammo by item -- a
    // skeleton-family mob still always fires a bare, untagged arrow (`Cb.mobShoot`'s own `tip`
    // is hand-set per-species, not read off held ammo) -- so a tipped arrow left in a
    // skeleton's own equipment slot still never reaches `Cb.applyArrowTip` through THAT path.
    // (struck D-648: `Po.POTIONS` is the whole Potions.java registry, long_/strong_ tiers included.)
    'a tipped-arrow ITEM in a skeleton-family mob\'s own equipment is never fired as such: ' +
      'no mob AI selects ammo by item, so `Cb.mobShoot` always hands it the hand-set stray ' +
      'slowness tip or nothing, never a real `Cb.applyArrowTip` payload read off held ammo'
  ];

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
