// 07zk_undead.js -- loop/zombievariants-s100, QUEUE 0.2 G18c: HUSK, STRAY and DROWNED, whole.
// Runs on: MAIN THREAD ONLY. No DOM.
//
// .decomp/net/minecraft/entity/mob/HuskEntity.java (80 lines), StrayEntity.java (63),
// DrownedEntity.java (494) and ZombieEntity.java (577, read again this pass for its own
// tick()/inWaterTime/ticksUntilWaterConversion state machine) -- ALL FOUR read whole this
// session. Class hierarchy: HuskEntity/DrownedEntity extend ZombieEntity; StrayEntity extends
// AbstractSkeletonEntity. Every citation below names one of these four files unless another
// .decomp path is given explicitly.
//
// ⚠⚠ HUSK AND STRAY ARE NOT A FORK OF ZOMBIE/SKELETON'S OWN CODE -- THEY ARE THE SAME CODE.
// `HuskEntity`/`StrayEntity` declare no `initGoals()`/`initCustomGoals()`/`createArrow
// Projectile` override that changes the GOAL SET at all (stray's own `createArrowProjectile`
// only tips the arrow -- see below), so `Ai.ROSTER.husk = Ai.ROSTER.zombie` and
// `Ai.ROSTER.stray = Ai.ROSTER.skeleton` (07k_goals.js, right after the object literal) ARE
// `HuskEntity`/`StrayEntity`'s whole `initGoals()`, not an approximation of it. Their spawn
// RULES differ (both add a sky-visibility test zombie/skeleton's own base rule lacks,
// `Spawn.RULES.husk`/`Spawn.RULES.stray`, 07l_spawn.js) and their EQUIPMENT/DAYLIGHT/
// EYE-HEIGHT tables already differ per-type (`Eq.MOB_BASE_ARMOR`/`Eq.WEAPON_FOR`,
// 07y_equip.js; `Cb.BURNS_IN_DAYLIGHT`/`Cb.eyeHeightOf`, 14j_combat.js -- both ALREADY had
// husk/stray/drowned rows from D-511/D-517, this session only makes those rows reachable by
// making the three types spawnable at all).
//
// WHAT IS HERE, PER THE UNIT'S OWN SPEC --
//   1. `Undead.onHuskHit` -- `HuskEntity.tryAttack` (.decomp): an unarmed husk's landed melee
//      hit also applies Hunger to the target, for `140 * localDifficulty` ticks (§ HUSK).
//   2. `Undead.tickWaterConversion`/`convertInWater` -- `ZombieEntity.tick()`'s own
//      `inWaterTime`/`ticksUntilWaterConversion` state machine (.decomp, read whole this
//      pass, NOT re-derived): 600 ticks fully submerged starts a 300-tick countdown, at the
//      end of which `husk -> zombie` (`HuskEntity.convertInWater`) or `zombie -> drowned`
//      (`ZombieEntity.convertInWater`'s own base body) -- the SAME 600+300 shape for both,
//      not two different numbers (§ CONVERSION).
//   3. `Spawn.RULES.husk`/`.stray`/`.drowned` (07l_spawn.js) -- their own `canSpawn` statics,
//      not this file's (kept with the rest of `Spawn.RULES`, the existing convention).
//   4. `Cb.STRAY_ARROW_SLOWNESS_TICKS`/the `e.tip` payload (14j_combat.js) -- `StrayEntity.
//      createArrowProjectile`'s own Slowness(600) tip, not this file's (kept with the rest of
//      the arrow pipeline, the existing convention `Cb.mobShoot`/`Cb.tickArrow` already own).
//   5. `Eq.initDrowned` (07y_equip.js) -- the probabilistic trident/fishing_rod mainhand roll
//      plus the separate 3% offhand nautilus shell roll (kept with the rest of equipment).
//   6. `Cb.mobShootTrident`/`Cb.tickTrident` (14j_combat.js) -- the trident's own ranged
//      attack, `DrownedEntity.attack` transcribed (kept with the rest of the projectile
//      pipeline).
//   7. `Undead.canDrownedAttackTarget`/`filterDrownedTargets` -- `DrownedEntity.
//      canDrownedAttackTarget` (.decomp) verbatim: night, or the target is touching water
//      (§ TARGETING).
//   8. `Undead.GoToBeachGoal`/`SwimUpGoal`/`GoToWaterGoal` -- `LeaveWaterGoal`/
//      `TargetAboveWaterGoal`/`WanderAroundOnSurfaceGoal` (.decomp, all three read whole),
//      reproduced over this engine's OWN `Ai.findPath`/`Ai.stepToward` node substrate rather
//      than vanilla's `MoveToTargetPosGoal`/`NoPenaltyTargeting`/real `PathAwareEntity`
//      navigation objects, which do not exist here (§ WATER GOALS -- each one's own header
//      names exactly what does NOT carry over).
//
// NOT HERE (this unit's own OWED, `Undead.OWED` at the bottom) --
//   - the real per-chunk `LocalDifficulty.getLocalDifficulty()` (regional difficulty, time +
//     moon-phase weighted) `HuskEntity.tryAttack` actually multiplies Hunger's duration by --
//     this engine has no regional-difficulty model at all (07x_patrol.js's own header already
//     names this same gap for `PatrolEntity`'s own per-chunk member count), so
//     `Eq.clampedLocalDifficulty()` (the SAME 0/0.5/1.0/1.5 table equipment rolls already use)
//     stands in for it -- named, not claimed bytecode-exact.
//   - `DrownedEntity.DrownedMoveControl`'s own steering (a dedicated `MoveControl` subclass
//     that nudges `vy` toward a swimming target every tick) and `updateSwimming()`'s own
//     `waterNavigation`/`landNavigation` SWAP -- this engine's goals steer `e.vx/vy/vz`
//     directly through `Ai.stepToward`, the same substitution every other water-adjacent mob
//     in this codebase already makes (07zi_squid.js's/07zj_fish.js's own headers).
//   - `TridentEntity` is in `.decomp` (read for #2908); `TridentItem` use/channeling/loyalty are not modelled.
//   - a real whole-path raycast for the thrown trident (`Cb.tickTrident` is the exact same
//     per-tick-position test `Cb.tickArrow`'s own header already names as strictly weaker
//     than vanilla's own AABB sweep) and trident inaccuracy spread/loyalty/riptide enchants.
//   - zombie_villager has NO water-conversion row, correctly (#5140): `ZombieVillagerEntity.
//     canConvertInWater()` returns false (.decomp:168), so `ZombieEntity.tick` never counts its
//     submersion. `Undead.CONVERT_TARGET` names zombie/husk only because vanilla does.

(function (NS) {
  // fallback stream when a caller passes no rng: the entity list's, else a fixed-seed JRandom (never Math.random, #6214)
  var fbR = null;
  function RNDFB() { var L = NS.EntityList; if (L && L.random) return L.random(); if (!fbR) fbR = NS.JRandom ? new NS.JRandom(0x6214) : { s: 0x6214, nextDouble: function () { this.s = (Math.imul(this.s, 1103515245) + 12345) >>> 0; return this.s / 4294967296; } }; return fbR.nextDouble(); }
  var Undead = NS.Undead = {};

  // ═══════════════════════════════ § HUSK — HUNGER ON HIT ═══════════════════════════════════

  /** `HuskEntity.tryAttack` (.decomp :57): `140 * (int)localDifficulty.getLocalDifficulty()` --
   *  the `(int)` cast truncates the DIFFICULTY, not the product (meleerefcheck, real server:
   *  normal 1.5 -> 140 ticks, not 210; easy 0.75 -> 0, hard 2.x -> 280). */
  Undead.HUSK_HUNGER_BASE_TICKS = 140;
  Undead.huskHungerDuration = function (husk) {
    var Eq = NS.Equip;
    var diff = (Eq && Eq.localDifficulty) ? Eq.localDifficulty(Eq.at ? Eq.at(husk) : undefined) : 1;   // getLocalDifficulty(this.getBlockPos()), the RAW value
    // ⚠ `140 * (int)$$2` (HuskEntity.java:57): the difficulty is TRUNCATED FIRST, so normal (~1.5) is 140 ticks,
    // hard (~2.25) 280 and easy (<1) ZERO -- not floor(140 * 1.5) = 210 (meleerefcheck husk, the real server).
    return Undead.HUSK_HUNGER_BASE_TICKS * Math.floor(diff);
  };
  /** Called from `Cb.mobAttack` (14j_combat.js) once a hit has actually landed --
   *  `HuskEntity.tryAttack`'s own `this.getMainHandStack().isEmpty()` gate. */
  Undead.onHuskHit = function (e, target) {
    if (!e || e.type !== 'husk' || !target) return;
    var Eq = NS.Equip, IT = NS.Items;
    if (Eq && Eq.ready && IT) {
      var main = Eq.getEquipped(e, IT.MAINHAND);
      if (main) return;
    }
    var dur = Undead.huskHungerDuration(e);
    // a 0-tick instance is added and dropped on the target's next effect tick without ever applying
    // (StatusEffectInstance.update: `duration > 0` gates both) -- nothing observable, so it is not stored
    if (dur > 0 && NS.Effects && NS.Effects.addStatusEffect) {
      NS.Effects.addStatusEffect(target, 'hunger', dur, 0, false, true);
    }
  };

  // ═══════════════════════════════ § HUSK SOUNDS (#859) ═══════════════════════════════════════
  // HuskEntity.getAmbientSound/getHurtSound/getDeathSound/getStepSound; hostile category.
  // MobEntity ambient roll, LivingEntity hurt/death (vol 1), pitch (r-r)*0.2 + (baby ? 1.5 : 1)
  // (LivingEntity.getSoundPitch), step vol 0.15 pitch 1 (ZombieEntity.playStepSound).
  // #4003/#4303: the zombie family's whole voice is silent until its type passes the Gate M audit (MobVoice.AUDITED).
  Undead.muted = function (e) { var MV = NS.MobVoice; return !!(e.silent || (MV && MV.GATED && !MV.AUDITED[e.type])); };
  Undead.HUSK_SOUNDS = { ambient: 'entity.husk.ambient', hurt: 'entity.husk.hurt', death: 'entity.husk.death', step: 'entity.husk.step' };
  Undead.playHuskSound = function (e, kind, rnd) {
    var S = NS.Sound, ev = Undead.HUSK_SOUNDS[kind];
    if (!e || e.type !== 'husk' || !ev || Undead.muted(e) || !S || !S.entitySound) return false;
    var r = rnd || RNDFB;
    var vol = 1, pitch = (r() - r()) * 0.2 + ((e.growAge | 0) < 0 ? 1.5 : 1);
    if (kind === 'step') { vol = 0.15; pitch = 1; }
    return S.entitySound(ev, e.x, e.y, e.z, vol, pitch, 'hostile', NS.Player);
  };
  /** MobEntity.baseTick: nextInt(1000) < ambientSoundChance++, then reset to -80. */
  Undead.tickHuskAmbient = function (e, rnd) {
    if (!e || e.type !== 'husk' || e.dead) return;
    var r = rnd || RNDFB;
    if (e.ambientChance === undefined) e.ambientChance = -80;
    if (Math.floor(r() * 1000) < e.ambientChance++) {
      e.ambientChance = -80;
      Undead.playHuskSound(e, 'ambient', r);
    }
  };
  // ═══════════════════════════════ § CONVERSION — ZOMBIE FAMILY <-> WATER ═══════════════════

  Undead.WATER_SUBMERGE_TICKS = 600;         // ZombieEntity.tick(): inWaterTime >= 600
  Undead.WATER_CONVERT_COUNTDOWN_TICKS = 300; // ...then setTicksUntilWaterConversion(300)
  /** husk -> zombie (`HuskEntity.convertInWater`), zombie -> drowned (`ZombieEntity.
   *  convertInWater`'s own base body) -- see this file's own header for why
   *  zombie_villager has no row: ZombieVillagerEntity.canConvertInWater() is false (#5140). */
  Undead.CONVERT_TARGET = { zombie: 'drowned', husk: 'zombie' };

  /** `Entity.updateSubmergedInWaterState` (.decomp 1077-1091): the fluid at BlockPos(x, eyeY - 1/9, z)
   *  is water AND blockY + fluidHeight > eyeY - 1/9. Waterlogged states and bubble columns hold
   *  water (`States.waterIn`); a flowing level has height (8-level)/9, a source or waterlogged cell
   *  8/9, and any cell with water above it is a full 1.0 (`FlowableFluid.getHeight(state, world, pos)`).
   *  `Cb.eyeHeightOf` has husk's/zombie's own 1.74/0.93 row. */
  Undead.isSubmergedInWater = function (e) {
    var W = NS.World, R = NS.Reg, S = NS.States, Cb = NS.Combat;
    if (!W || !R || !S || !Cb) return false;
    return Undead.submergedAt(e.x, e.y + Cb.eyeHeightOf(e), e.z, W.getBlock.bind(W));
  };

  /** The pure half, so the check can drive it with a table: `get(x,y,z)` returns a real state. */
  Undead.submergedAt = function (x, eyeY, z, get) {
    var R = NS.Reg, S = NS.States, Bh = NS.Behave;
    var sy = eyeY - Undead.SUBMERGE_EYE_OFFSET;
    var bx = Math.floor(x), by = Math.floor(sy), bz = Math.floor(z);
    var st = get(bx, by, bz);
    if (!(st > 0)) return false;
    var isW = S.block[st] === R.id.water;
    if (!isW && !S.waterIn[st]) return false;
    var above = get(bx, by + 1, bz);
    var wetAbove = above > 0 && (S.block[above] === R.id.water || S.waterIn[above] === 1);
    var h;
    if (wetAbove) h = 1;
    else if (isW) { var l = Bh.fluidLevel(st); h = (l >= 8 ? 8 : 8 - l) / 9; }
    else h = 8 / 9;
    return by + h > sy;
  };
  Undead.SUBMERGE_EYE_OFFSET = 0.1111111111111111;   // 1/9, Entity.updateSubmergedInWaterState

  /** One tick of the state machine, called from `EL.tickMob` for every zombie-family entity
   *  that has a `Undead.CONVERT_TARGET` row (07i_entitylist.js's own dispatch line). */
  Undead.tickWaterConversion = function (e) {
    if (!e || e.dead || e.removed) return;
    var target = Undead.CONVERT_TARGET[e.type];
    if (!target) return;
    if (e.aiDisabled || e.noAI) return;   // ZombieEntity.tick:201 gates the timer on !isAiDisabled
    if (e.convertCountdown !== undefined && e.convertCountdown !== null) {
      e.convertCountdown--;
      if (e.convertCountdown < 0) Undead.convertInWater(e, target);
      return;
    }
    // vanilla's submerged state is refreshed in baseTick (after tick()), so a fresh mob's first tick sees "not submerged"
    var first = !e.convWarm; e.convWarm = true;
    if (!first && Undead.isSubmergedInWater(e)) {
      e.waterConvertTime = (e.waterConvertTime || 0) + 1;
      if (e.waterConvertTime >= Undead.WATER_SUBMERGE_TICKS) {
        e.convertCountdown = Undead.WATER_CONVERT_COUNTDOWN_TICKS;
      }
    } else {
      e.waterConvertTime = -1;
    }
  };

  /** `ZombieEntity.convertInWater`/`HuskEntity.convertInWater` (.decomp): `this.convertTo
   *  (targetType)`. This engine has no generic in-place type-morph, so this spawns a fresh
   *  entity of `targetType` at the donor's own position/health and removes the donor -- see
   *  this file's own header (`Undead.OWED`) for what carries over approximately (equipment)
   *  and what does not carry over at all (age/NBT/enchantments on the new stack references). */
  Undead.convertInWater = function (e, targetType, strayEvent) {
    var EL = NS.EntityList;
    if (!EL || !EL.spawn) return null;
    var fresh = EL.spawn(targetType, e.x, e.y, e.z, { conversion: true });
    if (fresh) {
      if ((e.growAge | 0) < 0) fresh.growAge = e.growAge;   // D-672: convertTo's setBaby(this.isBaby())
      // MobEntity.convertTo: a FRESH entity (full health), then aiDisabled/customName/persistence/
      // invulnerable/canPickUpLoot/equipment (keepEquipment=true) and the vehicle carry over.
      if (e.customName !== undefined) { fresh.customName = e.customName; fresh.customNameVisible = e.customNameVisible; }
      if (e.persistent) fresh.persistent = true;
      if (e.aiDisabled) fresh.aiDisabled = true;
      if (e.noAI) fresh.noAI = true;
      if (e.invulnerable) fresh.invulnerable = true;
      if (e.canPickUpLoot) fresh.canPickUpLoot = true;
      // ZombieEntity.convertTo: setCanBreakDoors(shouldBreakDoors() && this.canBreakDoors())
      fresh.canBreakDoors = Undead.shouldBreakDoors(fresh.type) && !!e.canBreakDoors;
      var fgs = fresh.ai && fresh.ai.entries;
      if (fresh.canBreakDoors && fgs && NS.Ai && NS.Ai.BreakDoorGoal && !fgs.some(function (g) { return g.goal instanceof NS.Ai.BreakDoorGoal; }))
        fresh.ai.add(1, NS.Ai.MOVE, new NS.Ai.BreakDoorGoal(fresh, NS.EntityList.aiCtx(fresh)));
      // MobEntity.convertTo(keepEquipment): each EquipmentSlot stack is COPIED (not shared) with its drop chance.
      if (e.equip) {
        fresh.equip = [];
        for (var si = 0; si < e.equip.length; si++) {
          var est = e.equip[si];
          fresh.equip[si] = est ? Object.assign({}, est, est.t && typeof est.t === 'object' ? { t: JSON.parse(JSON.stringify(est.t)) } : null) : est;
        }
      }
      if (e.equipDropChance) fresh.equipDropChance = e.equipDropChance.slice();
      var veh = e.vehicle, Rd = NS.Raid;
      if (veh && Rd && Rd.startRiding) { Rd.stopRiding(e); Rd.startRiding(fresh, veh); }
      fresh.yaw = e.yaw;
    }
    // worldEvent 1040 (WorldRenderer.java:2863): entity.zombie.converted_to_drowned, 2.0, 1 +/- 0.2 (ZombieEntity);
    // HuskEntity.convertInWater fires 1041 (WorldRenderer.java:2866): entity.husk.converted_to_zombie, same vol/pitch
    var Snd = NS.Sound || NS.Snd;
    if (Snd && Snd.entitySound && !e.silent) Snd.entitySound(strayEvent ? 'entity.skeleton.converted_to_stray' : e.type === 'husk' ? 'entity.husk.converted_to_zombie' : 'entity.zombie.converted_to_drowned', e.x, e.y, e.z, 2, 1 + (RNDFB() - RNDFB()) * 0.2, 'hostile', NS.Player);
    e.removed = true;
    return fresh;
  };

  // ═══════════════════════════════ § SKELETON -> STRAY (powder snow) ════════════════════════

  Undead.POWDER_SNOW_TICKS = 140;            // SkeletonEntity.tick(): inPowderSnowTime >= 140
  Undead.STRAY_CONVERT_COUNTDOWN_TICKS = 300; // ...then setConversionTime(300)

  /** `Entity.inPowderSnow` (.decomp): any powder_snow cell intersecting the box (shrunk 1e-3, checkBlockCollision). */
  Undead.isInPowderSnow = function (e) {
    var W = NS.World, R = NS.Reg, S = NS.States;
    if (!W || !R || !S || R.id.powder_snow === undefined) return false;
    var hw = (e.width || 0.6) / 2 - 0.001, ht = (e.height || 1.8) - 0.001, id = R.id.powder_snow;
    for (var x = Math.floor(e.x - hw); x <= Math.floor(e.x + hw); x++)
      for (var y = Math.floor(e.y + 0.001); y <= Math.floor(e.y + ht); y++)
        for (var z = Math.floor(e.z - hw); z <= Math.floor(e.z + hw); z++) {
          var st = W.getBlock(x, y, z);
          if (st > 0 && S.block[st] === id) return true;
        }
    return false;
  };

  /** `SkeletonEntity.tick()` (.decomp :44-60) verbatim. `e.strayConversionTime` is vanilla's
   *  StrayConversionTime (-1 = not converting, written to NBT as such); `e.inPowderSnowTime` the timer. */
  Undead.tickStrayConversion = function (e) {
    if (!e || e.dead || e.removed || e.type !== 'skeleton') return;
    if (e.aiDisabled || e.noAI) return;
    if (e.strayConversionTime !== undefined && e.strayConversionTime !== null && e.strayConversionTime > -1) {
      e.strayConversionTime--;
      if (e.strayConversionTime < 0) Undead.convertToStray(e);
    } else if (Undead.isInPowderSnow(e)) {   // inPowderSnow is likewise refreshed in baseTick
      e.inPowderSnowTime = (e.inPowderSnowTime || 0) + 1;
      if (e.inPowderSnowTime >= Undead.POWDER_SNOW_TICKS) e.strayConversionTime = Undead.STRAY_CONVERT_COUNTDOWN_TICKS;
    } else {
      e.inPowderSnowTime = -1;
    }
  };

  /** `SkeletonEntity.isShaking()` = isConverting(). */
  Undead.isStrayConverting = function (e) {
    return !!e && e.type === 'skeleton' && e.strayConversionTime !== undefined && e.strayConversionTime !== null && e.strayConversionTime > -1;
  };

  /** `SkeletonEntity.convertToStray` (.decomp): convertTo(STRAY, true) + worldEvent 1048 unless silent. */
  Undead.convertToStray = function (e) {
    return Undead.convertInWater(e, 'stray', true);
  };

  // ═══════════════════════════════ § TARGETING — DROWNED ════════════════════════════════════

  /** `DrownedEntity.canDrownedAttackTarget` (.decomp) verbatim: `target != null && (!world.
   *  isDay() || target.isTouchingWater())`. */
  Undead.canDrownedAttackTarget = function (target) {
    if (!target) return false;
    var S = NS.Sky;
    var isDay = !!(S && S.isDay && S.isDay());
    return !isDay || !!target.inWater;
  };
  Undead.filterDrownedTargets = function (e, players) {
    var out = [];
    if (!players) return out;
    for (var i = 0; i < players.length; i++) {
      if (Undead.canDrownedAttackTarget(players[i])) out.push(players[i]);
    }
    return out;
  };

  // ═══════════════════════════════ § TRIDENT RANGED ATTACK ══════════════════════════════════

  Undead.TRIDENT_ATTACK_INTERVAL = 40;  // TridentAttackGoal(this,1.0,40,10.0F)
  Undead.TRIDENT_ATTACK_RADIUS = 10;   // TridentAttackGoal(this,1.0,40,10.0F)'s own literal

  // ═══════════════════════════════ § WATER GOALS ═════════════════════════════════════════════

  /**
   * "go-to-beach" -- `DrownedEntity.LeaveWaterGoal` (.decomp, read whole): at night, while
   * touching water and no more than 3 blocks under sea level, walk to the nearest dry land
   * within an 8-block search (vanilla's own `MoveToTargetPosGoal(this,speed,8,2)`).
   * `isTargetPos` is `Undead.isBeachTarget` (two air above a solid-top block), as vanilla.
   */
  /** `LeaveWaterGoal.isTargetPos`: two air cells above a block with a solid top surface
   *  (`hasSolidTopSurface` -> `NS.States.solid[st] === 1`, the full-cube sturdy-up-face test). */
  Undead.isBeachTarget = function (x, y, z) {
    var W = NS.World, St = NS.States;
    if (!W || !W.getBlock || !St) return false;
    return W.getBlock(x, y + 1, z) === 0 && W.getBlock(x, y + 2, z) === 0 && St.solid[W.getBlock(x, y, z)] === 1;
  };
  Undead.BEACH_RADIUS = 8; Undead.BEACH_VRANGE = 2;   // MoveToTargetPosGoal(this, speed, 8, 2)
  Undead.GoToBeachGoal = function (e, speed, rnd) {
    var Ai = NS.Ai;
    rnd = rnd || RNDFB;
    var path = null, idx = 1, R = Undead.BEACH_RADIUS, V = Undead.BEACH_VRANGE;
    var target = null, cooldown = 0, tryingTime = 0, safeWaiting = 0;
    function repath() {
      path = Ai.findPath(e.x, e.y, e.z, target[0] + 0.5, target[1] + 1, target[2] + 0.5, { maxDrop: 2, mob: e }); idx = 1;
    }
    // MoveToTargetPosGoal.findTargetPos: dy 0,1,-1,2,-2 (candidate y = dy-1), rings r<8, first hit wins
    function find() {
      var bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
      for (var dy = 0; dy <= V; dy = dy > 0 ? -dy : 1 - dy) {
        for (var r = 0; r < R; r++) {
          for (var dx = 0; dx <= r; dx = dx > 0 ? -dx : 1 - dx) {
            for (var dz = (dx < r && dx > -r) ? r : 0; dz <= r; dz = dz > 0 ? -dz : 1 - dz) {
              var tx = bx + dx, ty = by + dy - 1, tz = bz + dz;
              if (Undead.isBeachTarget(tx, ty, tz)) { target = [tx, ty, tz]; return true; }
            }
          }
        }
      }
      return false;
    }
    this.canUse = function () {
      var S = NS.Sky;
      var isDay = !!(S && S.isDay && S.isDay());
      if (isDay || !e.inWater) return false;
      var sea = (NS.Spawn && NS.Spawn.SEA_LEVEL) || 63;
      if (e.y < sea - 3) return false;
      if (cooldown > 0) { cooldown--; return false; }
      cooldown = 200 + Math.floor(rnd() * 200);   // getInterval = toGoalTicks(200 + nextInt(200))
      return find();
    };
    this.canContinueToUse = function () {
      return !!target && tryingTime >= -safeWaiting && tryingTime <= 1200 && Undead.isBeachTarget(target[0], target[1], target[2]);
    };
    this.start = function () {
      e.targetingUnderwater = false; tryingTime = 0;
      safeWaiting = Math.floor(rnd() * (Math.floor(rnd() * 1200) + 1200)) + 1200;
      repath();
    };
    this.stop = function () { path = null; target = null; };
    this.getTarget = function () { return target; };
    this.tick = function () {
      if (!target) return;
      var dx = target[0] + 0.5 - e.x, dy = target[1] + 1.5 - e.y, dz = target[2] + 0.5 - e.z;
      if (dx * dx + dy * dy + dz * dz >= 1) {
        tryingTime++;
        if (!path || idx >= path.length || tryingTime % 40 === 0) repath();
        if (path && idx < path.length) {
          Ai.stepToward(e, path[idx], speed);
          if (Ai.closeTo(e, path[idx])) idx++;
        }
      } else tryingTime--;
    };
  };

  /**
   * "swim-up" -- `DrownedEntity.TargetAboveWaterGoal` (.decomp, read whole): at night, while
   * touching water and more than 2 blocks below `minY` (sea level), drift upward.
   * #4073: `NoPenaltyTargeting.findTo` point, walked along `Ai.findSwimPath` (the SwimNavigation A*).
   */
  Undead.SWIM_UP_STEP = 0.04;
  Undead.SwimUpGoal = function (e, speed, rand) {
    var Ai = NS.Ai, r = rand || RNDFB;
    var foundTarget = false, path = null, idx = 1;
    var sea = function () { return (NS.Spawn && NS.Spawn.SEA_LEVEL) || 63; };
    this.canUse = function () {
      var S = NS.Sky;
      var isDay = !!(S && S.isDay && S.isDay());
      return !isDay && !!e.inWater && e.y < sea() - 2;
    };
    this.canContinueToUse = function () { return this.canUse() && !foundTarget; };
    this.start = function () { e.targetingUnderwater = true; foundTarget = false; path = null; };
    this.stop = function () { e.targetingUnderwater = false; path = null; };
    this.tick = function () {
      var minY = sea();
      if (e.y < minY - 1 && (!path || idx >= path.length)) {
        // NoPenaltyTargeting.findTo(4, 8, toward (x, seaLevel-1, z), PI/2), then startMovingTo over SwimNavigation (#4073)
        var best = Ai.findTowardPositionTarget(e, r, 4, 8, Math.PI / 2, { x: e.x, y: minY - 1, z: e.z });
        if (!best) { foundTarget = true; return; }
        path = Ai.findSwimPath(e.x, e.y, e.z, best.x, best.y, best.z, { partial: true });
        if (!path || path.length < 2) { foundTarget = true; return; }   // startMovingTo found no path
        for (var k = 1; k < path.length; k++) { path[k].x += 0.5; path[k].z += 0.5; }
        idx = 1;
      }
      if (path && idx < path.length) {
        Ai.stepToward(e, path[idx], speed);
        if (Ai.closeTo(e, path[idx])) idx++;
      }
      e.vy = (e.vy || 0) + 0.002;   // DrownedMoveControl: targetingUnderwater -> +0.002 y/tick
    };
  };

  /**
   * "go-to-water" -- `DrownedEntity.WanderAroundOnSurfaceGoal` (.decomp, read whole): during
   * the day, while NOT touching water, walk toward the nearest `minecraft:water` block found
   * in a 10-try random search (x/z offset -10..10, y offset -8..2 -- vanilla's own literal
   * `2 - nextInt(8)`).
   */
  Undead.GoToWaterGoal = function (e, speed, rand) {
    var Ai = NS.Ai;
    var r = rand || RNDFB;
    var path = null, idx = 1;
    /** ⚠ BUGFIX (D-712 undead deep-pass, live-tested): vanilla's `MoveToTargetPosGoal.
     *  canStart()` runs the search (`getWanderTarget()`) and only starts the goal when a
     *  target was actually found. The search used to run inside `start()` while `canUse()`
     *  unconditionally returned true for day+dry -- so on a tick where no water was found
     *  within the 10-try search, the `GoalSelector` still marked this goal "running" (it
     *  still claims `Ai.MOVE` every tick), permanently blocking the lower-priority
     *  `WaterAvoidingRandomStrollGoal` fallback and freezing the drowned in place. The search
     *  now runs inside `canUse()` itself so a failed search yields `canUse()===false` and the
     *  plain wander goal gets to run instead, matching vanilla's own fallback behavior. */
    this.canUse = function () {
      if (path) return false;
      var S = NS.Sky;
      var isDay = !!(S && S.isDay && S.isDay());
      if (!isDay || e.inWater) return false;
      var bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
      for (var t = 0; t < 10; t++) {
        var tx = bx + Math.floor(r() * 20) - 10;
        var ty = by + 2 - Math.floor(r() * 8);
        var tz = bz + Math.floor(r() * 20) - 10;
        if (Ai.pathTypeAt(tx, ty, tz) !== Ai.NodeType.WATER) continue;
        var p = Ai.findPath(e.x, e.y, e.z, tx + 0.5, ty, tz + 0.5, { maxDrop: 8, mob: e });
        if (p && p.length > 1) { path = p; idx = 1; return true; }
      }
      return false;
    };
    this.canContinueToUse = function () { return !!path && idx < path.length; };
    this.start = function () {};
    this.stop = function () { path = null; };
    this.tick = function () {
      if (!path || idx >= path.length) { this.stop(); return; }
      Ai.stepToward(e, path[idx], speed);
      if (Ai.closeTo(e, path[idx])) idx++;
    };
  };

  // ═══════════════════════════════ § JOCKEYS (loop/jockey) ══════════════════════════════════
  //
  // `ZombieEntity.initialize` (.decomp/net/minecraft/entity/mob/ZombieEntity.java:442-478) and
  // `SpiderEntity.initialize` (.decomp/net/minecraft/entity/mob/SpiderEntity.java:152-183),
  // both read whole this pass. Riding itself (position/vehicle/passenger) is `Rd.startRiding`/
  // `Rd.updatePassengerPosition` (07s_raid.js, D-538's own mob-on-mob ride, built for the
  // raid ravager-passenger rule) -- reused as-is here (rider/vehicle/passenger/`hasVehicle()`-
  // flag bookkeeping is identical for any pair), NOT its height-offset ARITHMETIC, which was
  // written for a raider on a ravager specifically (`Rd.RAIDER_HEIGHT_OFFSET`, `PatrolEntity.
  // getHeightOffset() == -0.45`) and is wrong for a baby zombie (`ZombieEntity.getHeightOffset()
  // .decomp:526-528` -- `isBaby() ? 0.0 : -0.45`, and a jockey rider is always a baby) or a
  // skeleton on a spider (`AbstractSkeletonEntity.getHeightOffset()` -> -0.6) riding a spider (`SpiderEntity.getMountedHeightOffset()
  // .decomp:66-68` -- `getHeight() * 0.5`, not the generic `Entity.java:1723`'s `height *
  // 0.75` `Rd.updatePassengerPosition` hard-codes for every non-ravager vehicle). `07s_raid.js`
  // is not this unit's own file, so this section keeps the fix local: `Undead.mountJockey`
  // calls `Rd.startRiding` for the bookkeeping, then immediately overwrites the position with
  // the PAIR-CORRECT formula below, rather than widening `Rd`'s own hard-coded one.

  /** `ZombieEntity.shouldBeBaby(Random)` (.decomp:493-495): `nextFloat() < 0.05`. */
  Undead.BABY_CHANCE = 0.05;
  Undead.rollBaby = function (rnd) { return (rnd || RNDFB)() < Undead.BABY_CHANCE; };

  /** Every `ZombieEntity` subtype this engine natural-spawns as a fresh placement (not a
   *  CONVERSION target -- `zombie_villager` is never placed this way, `Zv.
   *  maybeConvertNaturalSpawn` REPLACES an already-rolled zombie instead, and now carries its
   *  baby/jockey state across that swap rather than re-rolling, see that file). `husk`/
   *  `drowned` reach `ZombieEntity.initialize` unchanged (`HuskEntity`/`DrownedEntity` declare
   *  no `initialize` override that skips the `super.initialize(...)` call, both read whole
   *  this pass -- `DrownedEntity.initialize` only ADDS the trident-equip roll after it).
   *  `zombified_piglin` IS included (#3844): it does not override `initialize`, and natural
   *  nether packs exist (zpiglinspawncheck, #1295). */
  Undead.CHICKEN_JOCKEY_FAMILY = { zombie: 1, husk: 1, drowned: 1, zombified_piglin: 1 };

  /** `ZombieEntity.initialize` (.decomp:454,459): two INDEPENDENT `nextFloat() < 0.05` rolls,
   *  `if`/`else if` -- a hit on the FIRST roll with no free chicken nearby does NOT fall
   *  through to the second (spawn-fresh) roll; vanilla's own shape, not a simplification. */
  Undead.CHICKEN_JOCKEY_ROLL_CHANCE = 0.05;

  /** `Entity.updatePassengerPosition` (Entity.java:1709-1714) worked out for one PAIR at a
   *  time, matching this file's own header above -- `mountedHeightOffset`/`riderHeightOffset`
   *  are the two method overrides read out of `.decomp` for exactly the four pairs this unit
   *  wires (baby-zombie-family/chicken, skeleton/spider); anything else falls back to the
   *  generic `Entity.java` defaults (0.75 height factor, 0.0 rider offset). */
  Undead.mountedHeightOffset = function (vehicle) {
    if (!vehicle) return 0;
    if (vehicle.type === 'spider') return (vehicle.height || 0) * 0.5;   // SpiderEntity.java:66-68
    if (vehicle.type === 'chicken') return (vehicle.height || 0) * 0.5;  // ChickenEntity.updatePassengerPosition getBodyY(0.5)
    return (vehicle.height || 0) * 0.75;                                 // Entity.java:1723
  };
  Undead.riderHeightOffset = function (rider) {
    if (!rider) return 0;
    if (rider.type === 'zombified_piglin') {
      return (rider.growAge | 0) < 0 ? -0.05 : -0.45;               // ZombifiedPiglinEntity.getHeightOffset
    }
    if (Undead.CHICKEN_JOCKEY_FAMILY[rider.type] || rider.type === 'zombie_villager') {
      return (rider.growAge | 0) < 0 ? 0.0 : -0.45;                 // ZombieEntity.java:526-528
    }
    if (rider.type === 'skeleton' || rider.type === 'stray' || rider.type === 'wither_skeleton') {
      return -0.6;                                                   // AbstractSkeletonEntity.getHeightOffset()
    }
    return 0.0;                                                      // Entity.java:1719
  };
  /** `Rd.startRiding` for the shared vehicle/passenger/`riding` bookkeeping, then this pair's
   *  own correct `updatePassengerPosition` -- see this section's own header for why `Rd`'s
   *  hard-coded raider/ravager formula cannot be reused for the position half. */
  Undead.mountJockey = function (rider, vehicle) {
    var Rd = NS.Raid;
    if (!Rd || !Rd.startRiding || !rider || !vehicle) return false;
    Rd.startRiding(rider, vehicle);   // places the rider via Rd.updatePassengerPosition -> placePassenger
    return true;
  };
  /** Per-tick pair placement (Rd.updatePassengerPosition delegates here for every non-ravager
   *  vehicle). `ChickenEntity.updatePassengerPosition` (.decomp:168-178) adds the 0.1 offset
   *  along bodyYaw and copies bodyYaw to the rider; y is getBodyY(0.5) for the chicken. */
  Undead.SKELETONS = { skeleton: 1, stray: 1, wither_skeleton: 1 };
  Undead.placePassenger = function (vehicle, rider) {
    // engine yBodyRot is radians = vanilla bodyYaw + pi, so vanilla sin/cos are negated
    var by = vehicle.yBodyRot !== undefined ? vehicle.yBodyRot : vehicle.yaw || 0, r = by - Math.PI, chick = vehicle.type === 'chicken';
    rider.x = vehicle.x + (chick ? 0.1 * Math.sin(r) : 0);
    rider.z = vehicle.z - (chick ? 0.1 * Math.cos(r) : 0);
    rider.y = vehicle.y + Undead.mountedHeightOffset(vehicle) + Undead.riderHeightOffset(rider);
    if (chick || (Undead.SKELETONS[rider.type] && vehicle.yBodyRot !== undefined)) rider.yBodyRot = by;   // + AbstractSkeletonEntity.tickRiding: bodyYaw = PathAwareEntity vehicle's
  };

  /** `ZombieEntity.initialize` (.decomp:451-469), the WHOLE chicken-jockey branch: only for a
   *  baby (`$$6.baby`), only when `tryChickenJockey` (this engine's natural pack loop always
   *  passes it -- see 07l_spawn.js's own call site for the one case vanilla suppresses it,
   *  an explicit `EntityData` this engine's natural path never constructs). `ctx.findChicken`/
   *  `ctx.spawnChicken` are injected (this file has no world/entity-list query of its own --
   *  same shape `Zv.tickOne`'s injected `blockNameAt` already uses). Returns the mounted
   *  chicken, or null. */
  Undead.tryChickenJockey = function (e, rnd, ctx) {
    if (!e || (e.growAge | 0) >= 0 || !ctx) return null;   // must already be a baby (isBaby())
    var r = rnd || RNDFB;
    if (r() < Undead.CHICKEN_JOCKEY_ROLL_CHANCE) {
      var found = ctx.findChicken ? ctx.findChicken(e) : null;
      if (!found) return null;   // roll hit, no chicken nearby -> vanilla does NOT try again
      if (NS.Passive && NS.Passive.setChickenJockey) NS.Passive.setChickenJockey(found, true);
      Undead.mountJockey(e, found);
      return found;
    }
    if (r() < Undead.CHICKEN_JOCKEY_ROLL_CHANCE) {
      var fresh = ctx.spawnChicken ? ctx.spawnChicken(e) : null;
      if (!fresh) return null;
      if (NS.Passive && NS.Passive.setChickenJockey) NS.Passive.setChickenJockey(fresh, true);
      Undead.mountJockey(e, fresh);
      return fresh;
    }
    return null;
  };

  /** `SpiderEntity.initialize` (.decomp:154-159): `random.nextInt(100) == 0`, a fresh
   *  skeleton spawned in place then mounted ON the spider (the spider is the VEHICLE here,
   *  reverse of the chicken-jockey pair above). `ctx.spawnSkeleton` is injected. */
  Undead.SPIDER_JOCKEY_CHANCE = 0.01;
  Undead.trySpiderJockey = function (spider, rnd, ctx) {
    if (!spider || spider.type !== 'spider' || !ctx || !ctx.spawnSkeleton) return null;
    var r = rnd || RNDFB;
    if (r() >= Undead.SPIDER_JOCKEY_CHANCE) return null;
    var sk = ctx.spawnSkeleton(spider);
    if (!sk) return null;
    Undead.mountJockey(sk, spider);
    return sk;
  };

  /** `SpiderEntity.initialize` (.decomp:162-166) + `SpiderData.setEffect` (.decomp:208-221):
   *  HARD difficulty only, `nextFloat() < 0.1 * getClampedLocalDifficulty()` (`Eq.
   *  clampedLocalDifficulty()` stands in, this file's own established substitution -- see
   *  `Undead.huskHungerDuration` above), then `nextInt(5)` picked against this exact table
   *  (0-1 speed, 2 strength, 3 regeneration, 4 invisibility), applied PERMANENTLY
   *  (`Integer.MAX_VALUE` duration, no amplifier, not ambient, particles shown -- the
   *  `StatusEffectInstance` 2-arg ctor's own defaults). Independent of the jockey roll above
   *  (a spider can roll both, or either, or neither, off the SAME `initialize` call). */
  Undead.SPIDER_EFFECT_CHANCE = 0.1;
  Undead.SPIDER_EFFECT_TABLE = ['speed', 'speed', 'strength', 'regeneration', 'invisibility'];
  Undead.SPIDER_EFFECT_DURATION = 2147483647;   // Integer.MAX_VALUE, StatusEffectInstance ctor
  Undead.trySpiderEffect = function (spider, rnd, groupData) {
    if (!spider || spider.type !== 'spider') return null;
    // SpiderData is shared per spawn group: only the group's first spider rolls, all members get it.
    if (groupData && groupData.spiderInit) {
      if (groupData.spiderEffect) Undead.applySpiderEffect(spider, groupData.spiderEffect);
      return groupData.spiderEffect || null;
    }
    if (groupData) groupData.spiderInit = true;
    var Diff = NS.Difficulty || NS.Diff, Eq = NS.Equip;
    if (!Diff || !Diff.isHard || !Diff.isHard()) return null;
    var r = rnd || RNDFB;
    var diff = (Eq && Eq.clampedLocalDifficulty) ? Eq.clampedLocalDifficulty(Eq.at ? Eq.at(spider) : undefined) : 1;
    if (r() >= Undead.SPIDER_EFFECT_CHANCE * diff) return null;
    var idx = Math.floor(r() * 5);
    if (idx > 4) idx = 4;
    var effect = Undead.SPIDER_EFFECT_TABLE[idx];
    if (groupData) groupData.spiderEffect = effect;
    Undead.applySpiderEffect(spider, effect);
    return effect;
  };
  Undead.applySpiderEffect = function (spider, effect) {
    if (NS.Effects && NS.Effects.addStatusEffect) {
      NS.Effects.addStatusEffect(spider, effect, Undead.SPIDER_EFFECT_DURATION, 0, false, true);
    }
  };

  // ── Diff.OWED "zombie reinforcements" — CLOSED (s112, orchestrator). ZombieEntity.java (.decomp)
  // read whole: createZombieAttributes (:114-120, follow 35 / spawn_reinforcements registered at
  // its 0.0 default), initialize (:440-495, the door roll), applyAttributeModifiers (:497-520),
  // initAttributes (:522-524, base = nextDouble()*0.1; ZombifiedPiglinEntity.java:229 → 0.0) and
  // damage (:274-316, the reinforcement call). EntityAttributes.java:6-41: max_health clamp
  // [1,1024], follow_range [0,2048], knockback_resistance [0,1], zombie.spawn_reinforcements [0,1].
  Undead.ZOMBIE_FAMILY = { zombie: 1, husk: 1, drowned: 1, zombie_villager: 1, zombified_piglin: 1 };
  Undead.REINFORCE_CHARGE = -0.05;          // "Zombie reinforcement caller/callee charge", ADDITION
  Undead.REINFORCE_TRIES = 50;              // for ($$8 = 0; $$8 < 50; ...)
  Undead.REINFORCE_MIN = 7; Undead.REINFORCE_MAX = 40;   // MathHelper.nextInt(random, 7, 40)
  Undead.REINFORCE_PLAYER_CLEAR = 7.0;      // !world.isPlayerInRange(x, y, z, 7.0)
  var clamp01 = function (v) { return v < 0 ? 0 : (v > 1 ? 1 : v); };

  /** `shouldBreakDoors()` — true for every ZombieEntity but DrownedEntity (DrownedEntity.java:116). */
  Undead.shouldBreakDoors = function (type) { return type !== 'drowned'; };

  /** The live `zombie.spawn_reinforcements` value: base + ADDITION modifiers, clamped [0,1]. */
  Undead.spawnReinforcementsOf = function (e) {
    return clamp01((e.reinforceBase || 0) + (e.reinforceMods || 0));
  };

  /**
   * `ZombieEntity.initialize`'s door roll + `applyAttributeModifiers(clamped)` (.decomp:487-520),
   * for every zombie-family mob at spawn. `rnd` is nextFloat()/nextDouble()-shaped. `clamped` is
   * LocalDifficulty.getClampedLocalDifficulty() — vanilla's own value is in [0,1]; this engine has
   * no LocalDifficulty (Diff.OWED), so `Eq.clampedLocalDifficulty()` stands in, CLAMPED to [0,1]
   * here because the real getter can never exceed 1.
   */
  Undead.initZombieAttributes = function (e, rnd, clamped) {
    if (!e || !Undead.ZOMBIE_FAMILY[e.type] || e.reinforceBase !== undefined) return false;
    rnd = rnd || RNDFB;
    if (clamped === undefined) clamped = NS.Equip && NS.Equip.clampedLocalDifficulty ? NS.Equip.clampedLocalDifficulty(NS.Equip.at ? NS.Equip.at(e) : undefined) : 1;
    clamped = clamp01(clamped);
    var attrs = NS.Entities && NS.Entities.attrsOf ? NS.Entities.attrsOf(e.type) : null;
    // initialize:489 — setCanBreakDoors(shouldBreakDoors() && random.nextFloat() < clamped * 0.1F)
    e.canBreakDoors = Undead.shouldBreakDoors(e.type) && rnd() < clamped * 0.1;
    // initAttributes — base spawn_reinforcements
    e.reinforceBase = e.type === 'zombified_piglin' ? 0 : rnd() * 0.1;
    e.reinforceMods = 0;
    // "Random spawn bonus": knockback_resistance += nextDouble()*0.05 (ADDITION)
    e.knockbackResistance = clamp01((e.knockbackResistance || 0) + rnd() * 0.05);
    // "Random zombie-spawn bonus": nextDouble()*1.5*clamped, MULTIPLY_TOTAL on follow_range if > 1
    var fb = rnd() * 1.5 * clamped;
    var follow = attrs && attrs.follow ? attrs.follow : 35;
    e.followRange = fb > 1.0 ? Math.min(2048, follow * (1 + fb)) : follow;
    // "Leader zombie bonus": nextFloat() < clamped*0.05 → reinforcements +[0.5,0.75), max_health ×(1+[1,4))
    e.zombieLeader = false;
    if (rnd() < clamped * 0.05) {
      e.zombieLeader = true;
      e.reinforceMods += rnd() * 0.25 + 0.5;
      var hb = rnd() * 3.0 + 1.0;
      // MULTIPLY_TOTAL raises the MAX only; LivingEntity keeps its current health (vanilla quirk:
      // a leader spawns at 20/20..100 and does not regenerate to it).
      e.maxHealth = Math.min(1024, (e.maxHealth || (attrs ? attrs.hp : 20)) * (1 + hb));
      e.canBreakDoors = Undead.shouldBreakDoors(e.type);
    }
    // setCanBreakDoors(true) adds the goal to a selector built before the roll
    var gs = e.ai && e.ai.entries;
    if (e.canBreakDoors && gs && NS.Ai && NS.Ai.BreakDoorGoal && !gs.some(function (g) { return g.goal instanceof NS.Ai.BreakDoorGoal; }))
      e.ai.add(1, NS.Ai.MOVE, new NS.Ai.BreakDoorGoal(e, NS.EntityList.aiCtx(e)));
    return true;
  };

  /**
   * `ZombieEntity.damage` (.decomp:274-316) — the reinforcement call, run AFTER super.damage
   * succeeded. `attacker` is `DamageSource.getAttacker()` (may be null); the mob's own target wins
   * over it. ctx (tests) may inject: rnd (nextFloat/nextDouble), nextInt(lo,hi) inclusive,
   * isHard(), doMobSpawning(), players(), spawn(type,x,y,z) -> entity, canPlace(x,y,z),
   * clearAt(e,x,y,z). Returns the spawned zombie or null.
   */
  Undead.onZombieDamaged = function (e, attacker, ctx) {
    if (!e || !Undead.ZOMBIE_FAMILY[e.type] || e.removed) return null;
    ctx = ctx || {};
    var rnd = ctx.rnd || RNDFB;
    var nextInt = ctx.nextInt || function (lo, hi) { return lo + Math.floor(rnd() * (hi - lo + 1)); };
    var target = e.target && !e.target.dead && !e.target.removed ? e.target : null;
    if (!target && attacker && (attacker.maxHealth !== undefined || attacker === NS.Player)) target = attacker;
    if (!target) return null;
    var isHard = ctx.isHard || function () { return !!(NS.Diff && NS.Diff.isHard && NS.Diff.isHard()); };
    if (!isHard()) return null;
    if (!(rnd() < Undead.spawnReinforcementsOf(e))) return null;
    var doMobSpawning = ctx.doMobSpawning || function () {
      // GameRules.DO_MOB_SPAWNING, AND this engine's own spawner-held switch (Spawn.ready, D-397)
      var C = NS.Commands;
      if (C && C.ruleGet && String(C.ruleGet('doMobSpawning')) === 'false') return false;
      return !!(NS.Spawn && NS.Spawn.ready);
    };
    if (!doMobSpawning()) return null;
    var fx = Math.floor(e.x), fy = Math.floor(e.y), fz = Math.floor(e.z);
    var players = ctx.players || function () { return NS.Player ? [NS.Player] : []; };
    var canPlace = ctx.canPlace || function (x, y, z) {
      // SpawnHelper.canSpawn(ON_GROUND) + SpawnRestriction.canSpawn(ZOMBIE, REINFORCEMENT) —
      // Spawn.checkPlacement is exactly that pair (clearance first, then the per-type rule).
      return !!(NS.Spawn && NS.Spawn.checkPlacement && NS.Spawn.checkPlacement('zombie', x, y, z, 'reinforcement'));
    };
    var clearAt = ctx.clearAt || Undead.reinforcementClear;
    var spawn = ctx.spawn || function (type, x, y, z) {
      return NS.EntityList && NS.EntityList.spawn ? NS.EntityList.spawn(type, x, y, z) : null;
    };
    for (var t = 0; t < Undead.REINFORCE_TRIES; t++) {
      // nextInt(7,40) * nextInt(-1,1), per axis, in x, y, z order
      var x = fx + nextInt(Undead.REINFORCE_MIN, Undead.REINFORCE_MAX) * nextInt(-1, 1);
      var y = fy + nextInt(Undead.REINFORCE_MIN, Undead.REINFORCE_MAX) * nextInt(-1, 1);
      var z = fz + nextInt(Undead.REINFORCE_MIN, Undead.REINFORCE_MAX) * nextInt(-1, 1);
      if (!canPlace(x, y, z)) continue;
      var ps = players(), near = false;
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i]; if (!p) continue;
        var dx = p.x - x, dy = p.y - y, dz = p.z - z;
        if (dx * dx + dy * dy + dz * dz < Undead.REINFORCE_PLAYER_CLEAR * Undead.REINFORCE_PLAYER_CLEAR) { near = true; break; }
      }
      if (near || !clearAt(e, x, y, z)) continue;
      // setPosition((double)x, (double)y, (double)z) — the INTEGER corner, not the block centre.
      var z2 = spawn('zombie', x, y, z);
      if (!z2) return null;
      z2.target = target;
      // callee: initialize(..., REINFORCEMENT) rolls its own attributes, then the -0.05 charge
      if (z2.reinforceBase === undefined) Undead.initZombieAttributes(z2, rnd);
      z2.reinforceMods = (z2.reinforceMods || 0) + Undead.REINFORCE_CHARGE;
      e.reinforceMods = (e.reinforceMods || 0) + Undead.REINFORCE_CHARGE;
      return z2;
    }
    return null;
  };

  /** `doesNotIntersectEntities && isSpaceEmpty && !containsFluid` for a zombie box at the integer
   *  corner (x, y, z): setPosition(x, y, z) has no +0.5, so the box straddles the cells. */
  Undead.reinforcementClear = function (caller, x, y, z) {
    var Sp = NS.Spawn, W = NS.World;
    if (Sp && Sp.spaceEmptyAt && !Sp.spaceEmptyAt('zombie', x, y, z)) return false;
    if (W && NS.Reg && NS.States) {
      var d = NS.Entities && NS.Entities.dimensions ? NS.Entities.dimensions('zombie') : null;
      var fw = d ? d.width / 2 : 0.3, fh = d ? d.height : 1.95;
      for (var bx = Math.floor(x - fw); bx <= Math.floor(x + fw - 1e-7); bx++)
        for (var by = Math.floor(y); by <= Math.floor(y + fh - 1e-7); by++)
          for (var bz = Math.floor(z - fw); bz <= Math.floor(z + fw - 1e-7); bz++) {
            var fn = NS.Reg.names[NS.States.block[W.getBlock(bx, by, bz)]];
            if (fn === 'water' || fn === 'lava' || fn === 'bubble_column') return false;
          }
    }
    var dim = NS.Entities && NS.Entities.dimensions ? NS.Entities.dimensions('zombie') : { width: 0.6, height: 1.95 };
    var hw = dim.width / 2, L = NS.EntityList && NS.EntityList.list ? NS.EntityList.list : [];
    for (var i = 0; i < L.length; i++) {
      var o = L[i];
      if (!o || o.removed || o.dead || o.maxHealth === undefined) continue;   // blocksBuilding: living
      var ow = (o.width || 0) / 2;
      if (o.x - ow < x + hw && o.x + ow > x - hw && o.z - ow < z + hw && o.z + ow > z - hw &&
          o.y < y + dim.height && o.y + (o.height || 0) > y) return false;
    }
    return true;
  };

  /**
   * #994 -- `DrownedEntity.isTargetingUnderwater` / `updateSwimming` / `DrownedMoveControl.tick` /
   * `travel` (.decomp DrownedEntity.java, read whole). `e.swimming` is the navigation swap's flag
   * (SwimNavigation + setSwimming(true) vs MobNavigation); `e.leaningPitch` is LivingEntity's
   * 0..1 lerp (+-0.09 a tick) the renderer reads for the swim pose. `Ai.stepToward` already left
   * the node it steers at in `e.navNode` (`e.navigating`), which is `MoveControl.target*` here.
   * SwimNavigation: with an in-water target the node is `Ai.findSwimPath`'s (3D water A*, #4720);
   * otherwise the ground path's node.
   */
  Undead.isTargetingUnderwater = function (e) {
    if (e.targetingUnderwater) return true;
    var t = e.target;
    return !!(t && t.inWater);
  };
  Undead.tickSwim = function (e) {
    var under = !!e.inWater && Undead.isTargetingUnderwater(e);
    e.swimming = under;
    e.lastLeaningPitch = e.leaningPitch || 0;
    e.leaningPitch = under ? Math.min(1, e.lastLeaningPitch + 0.09) : Math.max(0, e.lastLeaningPitch - 0.09);
    var Ai = NS.Ai, n = e.navNode, nav = !!e.navigating;
    if (under) {
      var t = e.target;
      if ((t && t.y > e.y) || e.targetingUnderwater) e.vy = (e.vy || 0) + 0.002;
      var tg = e.target;   // SwimNavigation: 6-connected water A* toward the target (Ai.findSwimPath), re-planned every 10 ticks
      if (tg && tg.inWater && !tg.removed) {
        var sp0 = e.swimPath;
        if (!sp0 || (e.age | 0) >= sp0.t + 10 || sp0.i >= sp0.p.length) {
          var pp = Ai.findSwimPath(e.x, e.y, e.z, tg.x, tg.y, tg.z, { partial: true });
          sp0 = e.swimPath = { p: pp && pp.length > 1 ? pp : [], i: 1, t: e.age | 0 };
        }
        if (sp0.p.length > sp0.i) { n = sp0.p[sp0.i]; nav = true; sp0.i = Ai.advancePathNode(e, sp0.p, sp0.i); }
      } else e.swimPath = null;
      if (!n || !nav) { e.drSpeed = 0; e.mobSpeed = 0; e.zza = 0; return; }
      var dx = n.x + 0.5 - e.x, dy = n.y - e.y, dz = n.z + 0.5 - e.z;
      var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 1e-7) { e.drSpeed = 0; e.mobSpeed = 0; return; }
      dy /= len;
      e.yaw = Ai.rotlerp(e.yaw, Math.atan2(dx, -dz), Math.PI / 2);   // wrapDegrees(yaw, .., 90)
      e.yBodyRot = e.yaw;                                              // bodyYaw = yaw
      var want = Ai.movementSpeedOf(e);                                // speed 1.0 * MOVEMENT_SPEED
      var sp = Math.fround((e.drSpeed || 0) + 0.125 * (want - (e.drSpeed || 0)));
      e.drSpeed = sp; e.mobSpeed = sp;
      e.vx = (e.vx || 0) + sp * dx * 0.005; e.vy = (e.vy || 0) + sp * dy * 0.1; e.vz = (e.vz || 0) + sp * dz * 0.005;
      e.zza = 0;
    } else if (!e.onGround) e.vy = (e.vy || 0) - 0.008;   // the else branch of DrownedMoveControl.tick
  };
  /** `DrownedEntity.travel` underwater branch: updateVelocity(0.01, input 0), move, velocity * 0.9. */
  Undead.travelSwim = function (e) {
    var Ph = NS.Physics;
    e.vx = e.vx || 0; e.vy = e.vy || 0; e.vz = e.vz || 0;
    Ph.move(e, e.vx, e.vy, e.vz);
    e.vx *= 0.9; e.vy *= 0.9; e.vz *= 0.9;
    var h = Math.sqrt(e.vx * e.vx + e.vz * e.vz);
    e.swimPitch = h + Math.abs(e.vy) > 1e-6 ? -Math.atan2(e.vy, h) * 180 / Math.PI : (e.swimPitch || 0);   // toward velocity, vanilla degrees (up negative)
  };

  Undead.OWED = [
    'the IsChickenJockey/IsBaby/rider NBT round-trip -- this engine\'s save/load has no hook ' +
      'that reads or writes e.hasJockey or e.vehicle for ANY mob yet (raid passengers have the ' +
      'identical gap, Rd.OWED)',

    'the real per-chunk LocalDifficulty.getLocalDifficulty() (regional difficulty) -- ' +
      'Eq.clampedLocalDifficulty() stands in for HuskEntity.tryAttack\'s own multiplier',
    'TridentEntity.onEntityHit enchant bonus (EnchantmentHelper.getAttackDamage on the trident stack), channeling, ' +
      'loyalty/riptide -- Cb.TRIDENT_BASE_DAMAGE (8.0) and the swept-AABB hit (tridentsweepcheck) ARE verified ' +
      'against .decomp TridentEntity.java',
    'StrayEntity sounds and ' +
      'DestroyEggGoal (zombie.destroy_egg / turtle-egg step) -- zombie/husk/drowned/zombie_villager/' +
      'zombified_piglin ambient/hurt/death/step are Undead.SOUNDS (#666, #696)'
  ];

  // #666 -- ZombieEntity's own sounds (.decomp ZombieEntity.getAmbientSound/getHurtSound/getDeathSound/
  // playStepSound). Plain `zombie` only: husk/drowned/zombie_villager/zombified_piglin override them
  // with their own events (owed, below). Source 'hostile' (SoundCategory HOSTILE).
  // #696 -- the four overrides, each read from .decomp (HuskEntity / DrownedEntity / ZombieVillagerEntity /
  // ZombifiedPiglinEntity get*Sound). Drowned swaps to its *_water event while touching water; a zombified
  // piglin's ambient is `angry` while it has anger time (`e.angerTime > 0`).
  Undead.SOUNDS = {
    zombie: { ambient: 'entity.zombie.ambient', hurt: 'entity.zombie.hurt', death: 'entity.zombie.death', step: 'entity.zombie.step' },
    husk: { ambient: 'entity.husk.ambient', hurt: 'entity.husk.hurt', death: 'entity.husk.death', step: 'entity.husk.step' },
    zombie_villager: { ambient: 'entity.zombie_villager.ambient', hurt: 'entity.zombie_villager.hurt', death: 'entity.zombie_villager.death', step: 'entity.zombie_villager.step' },
    zombified_piglin: { ambient: 'entity.zombified_piglin.ambient', angry: 'entity.zombified_piglin.angry', hurt: 'entity.zombified_piglin.hurt', death: 'entity.zombified_piglin.death', step: 'entity.zombie.step' },
    drowned: { swim: 'entity.drowned.swim', shoot: 'entity.drowned.shoot', ambient: 'entity.drowned.ambient', hurt: 'entity.drowned.hurt', death: 'entity.drowned.death', step: 'entity.drowned.step',
      ambient_water: 'entity.drowned.ambient_water', hurt_water: 'entity.drowned.hurt_water', death_water: 'entity.drowned.death_water' },
    // #917 GiantEntity overrides no sounds: HostileEntity.getHurtSound/getDeathSound (:57-78).
    giant: { hurt: 'entity.hostile.hurt', death: 'entity.hostile.death' }
  };
  Undead.soundEvent = function (e, kind) {
    var t = Undead.SOUNDS[e.type];
    if (!t) return null;
    if (kind === 'ambient' && e.type === 'zombified_piglin' && (e.angerTime | 0) > 0) return t.angry;
    if (e.type === 'drowned' && e.inWater && t[kind + '_water']) return t[kind + '_water'];
    return t[kind] || null;
  };
  Undead.STEP_VOLUME = 0.15;
  Undead.MIN_AMBIENT_DELAY = 80;            // MobEntity.getMinAmbientSoundDelay
  /** LivingEntity.getSoundPitch: baby 1.5, adult 1.0, plus (r - r) * 0.2. */
  Undead.soundPitch = function (e, rnd) {
    rnd = rnd || RNDFB;
    return (rnd() - rnd()) * 0.2 + ((e.growAge | 0) < 0 ? 1.5 : 1.0);
  };
  /** Plays `kind` (ambient/hurt/death/step) for a zombie; returns the event name or null. */
  Undead.playSound = function (e, kind, rnd) {
    var ev = Undead.soundEvent(e, kind);
    if (!ev || Undead.muted(e)) return null;
    var S = NS.Sound;
    if (S && S.entitySound) {
      var step = kind === 'step';
      S.entitySound(ev, e.x, e.y, e.z, step ? Undead.STEP_VOLUME : 1, step ? 1 : Undead.soundPitch(e, rnd), 'hostile', NS.Player);
    }
    return ev;
  };
  /** #1220 ZombifiedPiglinEntity.setTarget (no target -> target: angrySoundDelay = betweenSeconds(0,1)) + tickAngrySound
   *  (mobTick, only while hasAngerTime) -> playAngrySound: angry event at volume*2, pitch*1.8. `e.target` is a plain field
   *  here, so the null->target edge is read from `e.angryPrevTarget`. */
  Undead.tickAngrySound = function (e, rnd) {
    var had = !!e.angryPrevTarget;
    e.angryPrevTarget = !!e.target;
    if (!had && e.target) e.angrySoundDelay = Math.floor(rnd() * 21);   // UniformIntProvider 0..20 ticks
    if ((e.angerTime | 0) > 0 && (e.angrySoundDelay | 0) > 0 && --e.angrySoundDelay === 0 && !Undead.muted(e)) {
      var S = NS.Sound;
      if (S && S.entitySound) S.entitySound(Undead.SOUNDS.zombified_piglin.angry, e.x, e.y, e.z, 2, Undead.soundPitch(e, rnd) * 1.8, 'hostile', NS.Player);
    }
  };
  /** MobEntity.baseTick's ambient roll plus Entity.move's step-distance counter; once per EL.tickMob. */
  Undead.tickSounds = function (e, rnd) {
    if (!Undead.SOUNDS[e.type] || e.dead) return;
    rnd = rnd || RNDFB;
    if (e.type === 'zombified_piglin') Undead.tickAngrySound(e, rnd);
    var chance = e.ambientSoundChance | 0;
    e.ambientSoundChance = chance + 1;
    if (Math.floor(rnd() * 1000) < chance) {
      e.ambientSoundChance = -Undead.MIN_AMBIENT_DELAY;
      Undead.playSound(e, 'ambient', rnd);
    }
    if (e.stepDist === undefined) { e.stepDist = 0; e.nextStepDist = 1; e.stepX = e.x; e.stepZ = e.z; }
    var dx = e.x - e.stepX, dz = e.z - e.stepZ;
    e.stepX = e.x; e.stepZ = e.z;
    e.stepDist += Math.sqrt(dx * dx + dz * dz) * 0.6;
    if (e.stepDist > e.nextStepDist && e.inWater && e.type === 'drowned') {
      // Entity.move: touching water -> playSwimSound(min(1, sqrt(vx^2*.2+vy^2+vz^2)*0.35)), pitch 1+(r-r)*0.4
      e.nextStepDist = Math.floor(e.stepDist) + 1;
      var sv = Math.min(1, Math.sqrt((e.vx || 0) * (e.vx || 0) * 0.2 + (e.vy || 0) * (e.vy || 0) + (e.vz || 0) * (e.vz || 0) * 0.2) * 0.35);
      if (NS.Sound && NS.Sound.entitySound && !Undead.muted(e)) NS.Sound.entitySound(Undead.SOUNDS.drowned.swim, e.x, e.y, e.z, sv, 1 + (rnd() - rnd()) * 0.4, 'hostile', NS.Player);
    } else if (e.stepDist > e.nextStepDist && e.onGround && !e.inWater) {
      e.nextStepDist = Math.floor(e.stepDist) + 1;
      Undead.playSound(e, 'step', rnd);
    }
  };

  // ── #879 DestroyEggGoal — `ZombieEntity.DestroyEggGoal extends StepAndDestroyBlockGoal extends
  // MoveToTargetPosGoal` (.decomp, all three read whole). Shared by zombie/husk/zombie_villager/drowned
  // (priority 4 in `ZombieEntity.initGoals`). Search order = `MoveToTargetPosGoal.findTargetPos` (range 24,
  // maxYDifference 3, first hit wins), target = turtle_egg with two air blocks above.
  // tickStepping: `entity.zombie.destroy_egg` 0.5, pitch 0.9+r*0.2, HOSTILE; onDestroyBlock:
  // `entity.turtle.egg_break` (the 1.18.2 name of field_14687) 0.7, same pitch, BLOCK.
  // OWED: the item-particle/block-break particle bursts (spawnParticles) are not spawned.
  Undead.EGG_RANGE = 24;
  Undead.EGG_MAX_Y_DIFF = 3;
  Undead.EGG_DESIRED_DISTANCE = 1.14;
  Undead.EGG_DESTROY_COUNTER = 60;
  Undead.EGG_STEP_VOLUME = 0.5;
  Undead.EGG_BREAK_VOLUME = 0.7;
  Undead.EGG_SOUND_STEP = 'entity.zombie.destroy_egg';
  Undead.EGG_SOUND_BREAK = 'entity.turtle.egg_break';
  function isEggAt(x, y, z) {
    var W = NS.World, S = NS.States, R = NS.Reg;
    if (!W || !S || !R || !R.id || R.id.turtle_egg === undefined) return false;
    var st = W.getBlock(x, y, z);
    return st !== 0 && S.block[st] === R.id.turtle_egg;
  }
  function isEggTarget(x, y, z) {
    var W = NS.World;
    return isEggAt(x, y, z) && W.getBlock(x, y + 1, z) === 0 && W.getBlock(x, y + 2, z) === 0;
  }
  Undead.DestroyEggGoal = function (e, ctx, speed, rnd) {
    this.__goalName = 'DestroyEggGoal';   // #6255: Ai.runningGoals' vanilla name
    ctx = ctx || {};
    rnd = rnd || RNDFB;
    var mobGriefing = ctx.mobGriefing || function () { return true; };
    var target = null, cooldown = 0, counter = 0, reached = false, path = null, idx = 1;
    var tryingTime = 0, safeWaiting = 0;
    function find() {
      var bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
      for (var dy = 0; dy <= Undead.EGG_MAX_Y_DIFF; dy = dy > 0 ? -dy : 1 - dy) {
        for (var r = 0; r < Undead.EGG_RANGE; r++) {
          for (var dx = 0; dx <= r; dx = dx > 0 ? -dx : 1 - dx) {
            for (var dz = (dx < r && dx > -r) ? r : 0; dz <= r; dz = dz > 0 ? -dz : 1 - dz) {
              var tx = bx + dx, ty = by + dy - 1, tz = bz + dz;
              if (isEggTarget(tx, ty, tz)) { target = { x: tx, y: ty, z: tz }; return true; }
            }
          }
        }
      }
      return false;
    }
    function tweak() {
      var bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
      var c = [[bx, by, bz], [bx, by - 1, bz], [bx - 1, by, bz], [bx + 1, by, bz], [bx, by, bz - 1], [bx, by, bz + 1], [bx, by - 2, bz]];
      for (var i = 0; i < c.length; i++) if (isEggAt(c[i][0], c[i][1], c[i][2])) return c[i];
      return null;
    }
    function pitch() { return 0.9 + rnd() * 0.2; }
    function sound(ev, vol, src, x, y, z) {
      var S = NS.Sound;
      if (S && S.entitySound) S.entitySound(ev, x + 0.5, y + 0.5, z + 0.5, vol, pitch(), src, NS.Player);
    }
    this.canUse = function () {
      if (!mobGriefing()) return false;
      if (cooldown > 0) { cooldown--; return false; }
      if ((target && isEggTarget(target.x, target.y, target.z)) || find()) { cooldown = 20; return true; }
      cooldown = 200 + Math.floor(rnd() * 200);
      return false;
    };
    this.canContinueToUse = function () {
      return !!target && tryingTime >= -safeWaiting && tryingTime <= 1200 && isEggTarget(target.x, target.y, target.z);
    };
    this.start = function () {
      reached = false; idx = 1; counter = 0; tryingTime = 0;
      safeWaiting = Math.floor(rnd() * (Math.floor(rnd() * 1200) + 1200)) + 1200;
      path = Ai_findPath(e, target.x + 0.5, target.y + 1, target.z + 0.5);
    };
    this.stop = function () { path = null; reached = false; e.fallDistance = 1; };
    this.tick = function () {
      if (!target) return;
      var cx = target.x + 0.5, cy = target.y + 1.5, cz = target.z + 0.5;
      var d = (cx - e.x) * (cx - e.x) + (cy - e.y) * (cy - e.y) + (cz - e.z) * (cz - e.z);
      if (d >= Undead.EGG_DESIRED_DISTANCE * Undead.EGG_DESIRED_DISTANCE) {
        reached = false; tryingTime++;
        if (!path || idx >= path.length || tryingTime % 40 === 0) { path = Ai_findPath(e, target.x + 0.5, target.y + 1, target.z + 0.5); idx = 1; }
        var Ai = NS.Ai;
        if (path && idx < path.length && Ai && Ai.stepToward) {
          Ai.stepToward(e, path[idx], 1.0);
          if (Ai.closeTo && Ai.closeTo(e, path[idx])) idx++;
        }
      } else { reached = true; tryingTime--; }
      var pos = tweak();
      if (!reached || !pos) return;
      if (counter > 0) e.vy = 0.3;
      if (counter % 2 === 0) {
        e.vy = -0.3;
        if (counter % 6 === 0) sound(Undead.EGG_SOUND_STEP, Undead.EGG_STEP_VOLUME, 'hostile', target.x, target.y, target.z);
      }
      if (counter > Undead.EGG_DESTROY_COUNTER) {
        NS.World.setBlock(pos[0], pos[1], pos[2], 0);
        if (NS.Save && NS.Save.record) NS.Save.record(pos[0], pos[1], pos[2], 0);
        sound(Undead.EGG_SOUND_BREAK, Undead.EGG_BREAK_VOLUME, 'block', pos[0], pos[1], pos[2]);
      }
      counter++;
    };
    this.hasReached = function () { return reached; };
  };
  function Ai_findPath(e, tx, ty, tz) {
    var Ai = NS.Ai;
    return (Ai && Ai.findPath) ? Ai.findPath(e.x, e.y, e.z, tx, ty, tz, { mob: e }) : null;
  }

  Undead.ready = true;
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
