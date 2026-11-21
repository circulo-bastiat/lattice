// src/07zzg_hoglin.js — s134 (KW-32, QUEUE 0.2 G18): hoglin + zoglin EXIST in this engine.
//
// Off .decomp, read whole: net/minecraft/entity/mob/Hoglin.java (the shared tryAttack/knockback),
// HoglinEntity.java (AnimalEntity + Monster: createHoglinAttributes, initialize's 20% baby, onGrowUp
// — baby attack 0.5 / xp 3, adult 6 / 5 —, the overworld ZOMBIFICATION clock (> 300 -> zoglin,
// convertTo(keepEquipment=true) + Nausea 200), TimeInOverworld/IsImmuneToZombification/CannotBeHunted
// NBT, crimson fungus breeding, movementCooldownTicks = 10 on a strike), HoglinBrain.java (the brain,
// below), sensor/HoglinSpecificSensor.java (the repellent search 8/4, adult piglin/hoglin counts),
// ZoglinEntity.java (HostileEntity, UNDEAD group, attacks the first visible living thing that is not a
// zoglin or a creeper, IsBaby NBT, setBaby -> attack 0.5), ai/brain/task/ForgetAttackTargetTask.java,
// ai/brain/sensor/Sensor.java (ATTACKABLE_TARGET_PREDICATE: 16 blocks, visible),
// client/render/entity/model/HoglinEntityModel.java + HoglinEntityRenderer (07j_entityrender.js).
//
// ── THE BRAIN, AS GOALS (this engine's idiom for a brain mob, cf. 07zzf_piglin.js) ──────────
//   memories: ATTACK_TARGET (`e.hgTarget`, expiring at `e.hgTargetUntil` when set by a hit: 200),
//     AVOID_TARGET (`e.hgAvoid`, 100..400 ticks: TimeHelper.betweenSeconds(5, 20)), PACIFIED
//     (`e.hgPacifiedUntil`, PacifyTask(NEAREST_REPELLENT, 200)).
//   activities, in refreshActivities' order: FIGHT (has ATTACK_TARGET), AVOID (has AVOID_TARGET),
//     IDLE. `e.aggressive` = setAttacking(has ATTACK_TARGET).
//   IDLE: pacified by a repellent (hoglin_repellents tag, within 8 across / 4 up-down) and flees it
//     at 1.0 (GoToRememberedPositionTask.toBlock(…, 1.0, 8)); targets the nearest visible targetable
//     player unless pacified or breeding; an ADULT backs off the nearest visible adult piglin at 0.4
//     within 8; a baby walks to the closest adult at 0.6; breeds at 0.6; strolls at 0.4.
//   FIGHT: RangedApproachTask(1.0) + MeleeAttackTask(40) adult / (15) baby.
//   AVOID: flee the avoid target at 1.3 within 15; forgotten once a lone adult (no more piglins
//     than hoglins + 1 around).
//   onAttacked: forget PACIFIED + breed target; baby -> avoidEnemy; adult -> targetEnemy (not a
//     piglin while avoiding, never a hoglin, not a new target > 4 blocks further, attackable) and
//     askAdultsForHelp. onAttacking (its own strike): an adult hitting a piglin with MORE piglins
//     than hoglins+1 around flees and makes every adult hoglin flee; else askAdultsForHelp.
(function (NS) {
  'use strict';
  var Hg = NS.Hoglin = { ready: false };

  Hg.TYPES = { hoglin: 1, zoglin: 1 };
  Hg.ZOMBIFY_AFTER = 300;            // HoglinEntity.mobTick: `timeInOverworld > 300`
  Hg.ZOMBIFY_NAUSEA = 200;           // zombify(): StatusEffectInstance(NAUSEA, 200, 0)
  Hg.BABY_CHANCE = 0.2;              // initialize: nextFloat() < 0.2F
  Hg.ATTACK_ADULT = 6;               // createHoglinAttributes / onGrowUp adult
  Hg.ATTACK_BABY = 0.5;              // onGrowUp baby / ZoglinEntity.setBaby(true)
  Hg.XP_ADULT = 5; Hg.XP_BABY = 3;   // constructor 5; onGrowUp baby 3
  Hg.MOVEMENT_COOLDOWN = 10;         // tryAttack / handleStatus(4): movementCooldownTicks = 10
  Hg.MELEE_ADULT = 40; Hg.MELEE_BABY = 15;   // MeleeAttackTask(40) / (15)
  Hg.TARGET_MEMORY = 200;            // setAttackTarget: remember(ATTACK_TARGET, t, 200L)
  Hg.AVOID_MIN = 100; Hg.AVOID_MAX = 400;    // AVOID_MEMORY_DURATION = betweenSeconds(5, 20)
  Hg.PACIFY_TICKS = 200;             // PacifyTask(NEAREST_REPELLENT, 200)
  Hg.REPEL_H = 8; Hg.REPEL_V = 4;    // BlockPos.findClosest(pos, 8, 4, …)
  Hg.REPEL_FLEE_SPEED = 1.0; Hg.REPEL_FLEE_RANGE = 8;
  Hg.PIGLIN_BACKOFF_SPEED = 0.4; Hg.PIGLIN_BACKOFF_RANGE = 8;
  Hg.AVOID_SPEED = 1.3; Hg.AVOID_RANGE = 15;
  Hg.SENSE_RANGE = 16;               // NearestLivingEntitiesSensor + ATTACKABLE_TARGET_PREDICATE
  Hg.TOO_FAR = 4;                    // LookTargetUtil.isNewTargetTooFar(…, 4.0)
  Hg.STROLL_SPEED = 0.4; Hg.BREED_SPEED = 0.6; Hg.ADULT_WALK_SPEED = 0.6;
  Hg.ZOGLIN_IGNORES = { zoglin: 1, creeper: 1 };   // ZoglinEntity.shouldAttack
  Hg.SOUND_ZOMBIFY = 'entity.hoglin.converted_to_zombified';
  Hg.SOUND_ATTACK = 'entity.hoglin.attack';
  Hg.SOUND_ANGRY = 'entity.hoglin.angry';
  Hg.SOUND_AMBIENT = 'entity.hoglin.ambient';
  Hg.SOUND_RETREAT = 'entity.hoglin.retreat';
  Hg.SOUND_ZOGLIN_ATTACK = 'entity.zoglin.attack';

  Hg.OWED = [
    'HUNTED: piglins hunt adult hoglins (HuntHoglinTask, CannotBeHunted) and baby piglins ride baby hoglins — Piglin.OWED',
    'LOOK: LookAroundTask(45, 90) / FollowMobTask(8) timing are the generic look goals',
    'SOUNDS: hurt/death/step come from NS.MobVoice; ambient/angry/retreat/attack/activity-change are Hg.soundEvent/Hg.playSound'
  ];

  function rnd() { var EL = NS.EntityList; return (EL && EL.random) || Math.random; }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
  function alive(o) { return !!o && !o.removed && !o.dead && !(o.health !== undefined && o.health <= 0); }
  function visible(e, o) { var Ai = NS.Ai; return !(Ai && Ai.canSee) || Ai.canSee(e, o); }
  function isBaby(e) { return !!(e && e.isBaby); }
  Hg.isBaby = isBaby;
  Hg.isAdult = function (e) { return !isBaby(e); };
  function clock(e) { return e.hgClock | 0; }

  // ── spawn / age ─────────────────────────────────────────────────────────────────────────
  Hg.initHoglin = function (e, opts) {
    e.timeInOverworld = e.timeInOverworld | 0;
    if (opts && opts.conversion) return;
    if (!e.isBaby && rnd()() < Hg.BABY_CHANCE) Hg.setBaby(e, true);
    Hg.syncAge(e);
  };
  Hg.initZoglin = function (e) { Hg.syncAge(e); };
  /** hoglin: PassiveEntity.setBaby (breeding age -24000, it GROWS UP); zoglin: the BABY flag. */
  Hg.setBaby = function (e, baby) {
    var Br = NS.Breed;
    if (Br && Br.setAge) Br.setAge(e, baby ? -24000 : 0); else { e.growAge = baby ? -24000 : 0; e.isBaby = !!baby; }
    Hg.syncAge(e);
  };
  /** HoglinEntity.onGrowUp / ZoglinEntity.setBaby: the attack damage base and (hoglin) xp field. */
  Hg.syncAge = function (e) {
    e.attackDamage = isBaby(e) ? Hg.ATTACK_BABY : Hg.ATTACK_ADULT;
    if (e.type === 'hoglin') e.experiencePoints = isBaby(e) ? Hg.XP_BABY : Hg.XP_ADULT;
  };

  // ── the strike (Hoglin.tryAttack / Hoglin.knockback), called from Cb.mobAttack ─────────────
  /** Before the damage: movementCooldownTicks = 10, HoglinBrain.onAttacking; the amount rolled. */
  Hg.attackAmount = function (e, target) {
    e.movementCooldown = Hg.MOVEMENT_COOLDOWN;
    // tryAttack: playSound(attack, 1.0, getSoundPitch) -- Hoglin and Zoglin alike
    if (NS.MobVoice) NS.MobVoice.emit(e, e.type === 'zoglin' ? Hg.SOUND_ZOGLIN_ATTACK : Hg.SOUND_ATTACK, 1.0);
    if (e.type === 'hoglin') Hg.onAttacking(e, target);
    var a = e.attackDamage !== undefined ? e.attackDamage : (isBaby(e) ? Hg.ATTACK_BABY : Hg.ATTACK_ADULT);
    var n = a | 0;
    // `!isBaby() && (int)a > 0 ? a / 2 + nextInt((int)a) : a`
    return (!isBaby(e) && n > 0) ? a / 2 + Math.floor(rnd()() * n) : a;
  };
  /** After a landed hit: Hoglin.knockback, adults only. ATTACK_KNOCKBACK 1.0 minus the target's
   *  knockback resistance; horizontal = normalize(dx, 0, dz) * d * (nextFloat*0.5 + 0.2), turned by
   *  rotateY(nextInt(21) - 10) — RADIANS (Vec3d.rotateY takes radians; the int is passed as is);
   *  vertical = d * nextFloat * 0.5; ADDED to the target's motion (addVelocity). */
  Hg.knockback = function (e, t) {
    if (isBaby(e)) return false;
    var at = NS.Entities && NS.Entities.attrsOf ? NS.Entities.attrsOf(e.type) : null;
    var d = (at && at.atkKb !== undefined ? at.atkKb : 1) - (t.knockbackResistance || 0);
    if (!(d > 0)) return false;
    var r = rnd();
    var dx = t.x - e.x, dz = t.z - e.z, len = Math.sqrt(dx * dx + dz * dz);
    var ang = Math.floor(r() * 21) - 10;
    var h = d * (r() * 0.5 + 0.2);
    var nx = len > 1e-4 ? dx / len * h : 0, nz = len > 1e-4 ? dz / len * h : 0;
    var c = Math.cos(ang), s = Math.sin(ang);
    var rx = nx * c + nz * s, rz = nz * c - nx * s;          // Vec3d.rotateY
    var vy = d * r() * 0.5;
    t.vx = (t.vx || 0) + rx; t.vy = (t.vy || 0) + vy; t.vz = (t.vz || 0) + rz;
    t.velocityModified = true;
    return true;
  };

  // ── sensing (HoglinSpecificSensor + NearestLivingEntitiesSensor, asked on demand) ──────────
  /** max(16 * target.getAttackDistanceScalingFactor(mob), 2) (TargetPredicate.test). */
  Hg.senseRange = function (t) {
    var sc = t === NS.Player ? NS.Bat.attackScale(t) : NS.Village.attackDistanceScale(t);
    return Math.max(Hg.SENSE_RANGE * sc, 2);
  };
  Hg.visibleMobs = function (e) {
    var EL = NS.EntityList, E = NS.Entities, out = [];
    if (EL && EL.list) {
      for (var i = 0; i < EL.list.length; i++) {
        var o = EL.list[i];
        if (o === e || !alive(o) || !(E && E.isLiving && E.isLiving(o.type))) continue;
        var dd = dist(e, o);
        if (dd <= Hg.senseRange(o) && visible(e, o)) out.push({ o: o, d: dd });
      }
    }
    var P = NS.Player;
    if (P && alive(P) && NS.Ai.canTargetLiving(P)) { var dp = dist(e, P); if (dp <= Hg.senseRange(P) && visible(e, P)) out.push({ o: P, d: dp }); }
    out.sort(function (a, b) { return a.d - b.d; });
    return out.map(function (x) { return x.o; });
  };
  Hg.adultHoglinsAround = function (e) {
    return Hg.visibleMobs(e).filter(function (o) { return o.type === 'hoglin' && !isBaby(o); });
  };
  Hg.adultPiglinsAround = function (e) {
    return Hg.visibleMobs(e).filter(function (o) { return o.type === 'piglin' && !isBaby(o); });
  };
  /** HoglinBrain.hasMoreHoglinsAround — named for the hoglins, it asks whether the adult PIGLINS
   *  outnumber the adult hoglins + 1 (a baby never does). */
  Hg.piglinsOutnumber = function (e) {
    if (isBaby(e)) return false;
    return Hg.adultPiglinsAround(e).length > Hg.adultHoglinsAround(e).length + 1;
  };
  Hg.isLoneAdult = function (e) { return Hg.isAdult(e) && !Hg.piglinsOutnumber(e); };
  /** The nearest `hoglin_repellents` block within 8 across and 4 up/down (BlockPos.findClosest). */
  Hg.nearestRepellent = function (e) {
    var W = NS.World, T = NS.Tags;
    if (!W || !W.getBlock || !T || !T.stateIn) return null;
    var bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z), best = null, bd = Infinity;
    for (var dy = -Hg.REPEL_V; dy <= Hg.REPEL_V; dy++)
      for (var dx = -Hg.REPEL_H; dx <= Hg.REPEL_H; dx++)
        for (var dz = -Hg.REPEL_H; dz <= Hg.REPEL_H; dz++) {
          var st = W.getBlock(bx + dx, by + dy, bz + dz);
          if (!st || !T.stateIn('hoglin_repellents', st)) continue;
          var d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < bd) { bd = d2; best = { x: bx + dx + 0.5, y: by + dy, z: bz + dz + 0.5 }; }
        }
    return best;
  };

  // ── memories ────────────────────────────────────────────────────────────────────────────
  Hg.attackTarget = function (e) {
    var t = e.hgTarget;
    if (!t) return null;
    // ForgetAttackTargetTask: dead / untargetable; plus a hit-set memory's own 200-tick expiry
    if (!alive(t) || !NS.Ai.canTargetLiving(t, e) || (e.hgTargetUntil !== undefined && clock(e) > e.hgTargetUntil)) { Hg.forgetTarget(e); return null; }
    return t;
  };
  Hg.forgetTarget = function (e) { e.hgTarget = null; e.hgTargetUntil = undefined; if (e.target && Hg.TYPES[e.type]) e.target = null; };
  Hg.setAttackTarget = function (e, t, expiring) {
    e.hgTarget = t; e.hgTargetUntil = expiring ? clock(e) + Hg.TARGET_MEMORY : undefined;
  };
  // CANT_REACH_WALK_TARGET_SINCE + ForgetAttackTargetTask.cannotReachTarget: no path to the target for
  // > 200 ticks forgets it. Path probed every 20 ticks (the melee goal's own cadence); a new target resets it.
  Hg.CANT_REACH_TICKS = 200;
  Hg.cantReachTick = function (e) {
    var t = e.hgTarget;
    if (!t) { e.hgCantReachSince = undefined; return; }
    if (e.hgCantReachTarget !== t) { e.hgCantReachTarget = t; e.hgCantReachSince = undefined; }
    var now = clock(e);
    if (now % 20 === 0) {
      var dx = t.x - e.x, dy = t.y - e.y, dz = t.z - e.z;
      if (dx * dx + dy * dy + dz * dz <= NS.Ai.attackReachSqr(e, t) || NS.Ai.findPath(e.x, e.y, e.z, t.x, t.y, t.z, { mob: e })) e.hgCantReachSince = undefined;
      else if (e.hgCantReachSince === undefined) e.hgCantReachSince = now;
    }
    if (e.hgCantReachSince !== undefined && now - e.hgCantReachSince > Hg.CANT_REACH_TICKS) { Hg.forgetTarget(e); e.hgCantReachSince = undefined; }
  };
  Hg.avoidTarget = function (e) {
    if (!e.hgAvoid) return null;
    if (!alive(e.hgAvoid) || clock(e) > e.hgAvoidUntil) { e.hgAvoid = null; return null; }
    return e.hgAvoid;
  };
  Hg.pacified = function (e) { return e.hgPacifiedUntil !== undefined && clock(e) <= e.hgPacifiedUntil; };
  function closer(e, a, b) { if (!a) return b; if (!b) return a; return dist(e, a) <= dist(e, b) ? a : b; }
  /** Sensor.testAttackableTargetPredicate: alive, within 16, visible (the player too). */
  Hg.attackable = function (e, t) { return alive(t) && NS.Ai.canTargetLiving(t) && dist(e, t) <= Hg.senseRange(t) && visible(e, t); };
  Hg.newTargetTooFar = function (e, t) {
    var cur = Hg.attackTarget(e);
    if (!cur) return false;
    var dc = dist(e, cur), dn = dist(e, t);
    return dn * dn > dc * dc + Hg.TOO_FAR * Hg.TOO_FAR;
  };

  Hg.avoid = function (e, t) {
    Hg.forgetTarget(e);
    var r = rnd();
    e.hgAvoid = t; e.hgAvoidUntil = clock(e) + Hg.AVOID_MIN + Math.floor(r() * (Hg.AVOID_MAX - Hg.AVOID_MIN + 1));
  };
  Hg.avoidEnemy = function (e, t) {
    var a = closer(e, Hg.avoidTarget(e), t);
    a = closer(e, Hg.attackTarget(e), a);
    Hg.avoid(e, a);
  };
  Hg.setAttackTargetIfCloser = function (e, t) {
    if (Hg.pacified(e)) return;
    Hg.setAttackTarget(e, closer(e, Hg.attackTarget(e), t), true);
  };
  Hg.askAdultsForHelp = function (e, t) {
    var ms = Hg.adultHoglinsAround(e);
    for (var i = 0; i < ms.length; i++) Hg.setAttackTargetIfCloser(ms[i], t);
  };
  Hg.onAttacking = function (e, t) {
    if (isBaby(e)) return;
    if (t && t.type === 'piglin' && Hg.piglinsOutnumber(e)) {
      Hg.avoid(e, t);
      var ms = Hg.adultHoglinsAround(e);
      for (var i = 0; i < ms.length; i++) Hg.avoidEnemy(ms[i], t);
    } else Hg.askAdultsForHelp(e, t);
  };
  /** BREED_TARGET memory: the partner this hoglin is breeding with (BreedTask); null once it is gone,
   *  no longer in love, or forgotten. hasBreedTarget = a live partner is remembered. */
  Hg.breedTarget = function (e) {
    var p = e.hgBreedPartner;
    if (p && (!alive(p) || !(e.inLove > 0) || !(p.inLove > 0))) p = e.hgBreedPartner = null;
    return p || null;
  };
  Hg.setBreedTarget = function (e, p) { e.hgBreedPartner = p || null; };
  Hg.hasBreedTarget = function (e) { return !!Hg.breedTarget(e); };
  Hg.onAttacked = function (e, attacker) {
    if (e.type === 'hoglin') e.hgBreedPartner = null;
    if (!alive(attacker) || attacker === e) return;
    if (e.type === 'zoglin') {
      // ZoglinEntity.damage: canTarget && !isNewTargetTooFar(4) -> setAttackTarget (200)
      if (NS.Ai.canTargetLiving(attacker, e) && !Hg.newTargetTooFar(e, attacker)) Hg.setAttackTarget(e, attacker, true);
      return;
    }
    e.hgPacifiedUntil = undefined;
    if (isBaby(e)) { Hg.avoidEnemy(e, attacker); return; }
    // targetEnemy
    if (Hg.activity(e) === 'avoid' && attacker.type === 'piglin') return;
    if (attacker.type === 'hoglin') return;
    if (Hg.newTargetTooFar(e, attacker)) return;
    if (!Hg.attackable(e, attacker)) return;
    Hg.setAttackTarget(e, attacker, true);
    Hg.askAdultsForHelp(e, attacker);
  };

  /** The IDLE UpdateAttackTargetTask. hoglin: nearest visible targetable PLAYER unless pacified or
   *  breeding; zoglin: the first (nearest) visible living thing that is not a zoglin or a creeper. */
  Hg.findTarget = function (e) {
    if (e.type === 'zoglin') {
      if (!e.hgSensed) return null;   // Sensor.tick: NEAREST_VISIBLE_LIVING_ENTITIES refreshes only every 20 ticks
      var ms = Hg.visibleMobs(e);
      for (var i = 0; i < ms.length; i++) if (!Hg.ZOGLIN_IGNORES[ms[i].type]) return ms[i];
      return null;
    }
    if (Hg.pacified(e) || Hg.hasBreedTarget(e)) return null;
    var P = NS.Player;
    return (P && Hg.attackable(e, P)) ? P : null;
  };
  Hg.activity = function (e) {
    if (Hg.attackTarget(e)) return 'fight';
    if (e.type === 'hoglin' && Hg.avoidTarget(e)) return 'avoid';
    return 'idle';
  };

  /** HoglinBrain.getSoundEvent(entity, activity): AVOID or canConvert -> retreat, FIGHT -> angry, else
   *  retreat near a repellent, else ambient. (Zoglin: angry with an attack target, else ambient.) */
  Hg.soundEvent = function (e) {
    if (e.type === 'zoglin') return Hg.attackTarget(e) ? 'entity.zoglin.angry' : 'entity.zoglin.ambient';
    var a = Hg.activity(e);
    if (a === 'avoid' || Hg.canConvert(e)) return Hg.SOUND_RETREAT;
    if (a === 'fight') return Hg.SOUND_ANGRY;
    return Hg.nearestRepellent(e) ? Hg.SOUND_RETREAT : Hg.SOUND_AMBIENT;
  };
  /** MobEntity.baseTick's ambient roll for a hoglin (its table row has no fixed ambient event). */
  Hg.tickAmbient = function (e) {
    var MV = NS.MobVoice;
    if (!MV || e.dead || !(e.health > 0)) return false;
    if (e.ambientSoundChance === undefined) e.ambientSoundChance = 0;
    if (Math.floor(rnd()() * 1000) < e.ambientSoundChance++) {
      e.ambientSoundChance = -MV.delay(e);
      return MV.emit(e, Hg.soundEvent(e));
    }
    return false;
  };

  // ── goals ───────────────────────────────────────────────────────────────────────────────
  Hg.TargetGoal = function (e) {
    this.canUse = function () {
      var t = Hg.attackTarget(e);
      if (!t && Hg.activity(e) === 'idle') { t = Hg.findTarget(e); if (t) Hg.setAttackTarget(e, t, false); }
      if (t) { e.target = t; return true; }
      return false;
    };
    this.canContinueToUse = function () { var t = Hg.attackTarget(e); if (t) e.target = t; return !!t; };
    this.start = function () {};
    this.stop = function () { e.target = null; };
    this.tick = function () {};
  };
  // ── FuzzyTargeting.findFrom(e, 16, 7, pos) (.decomp ai/FuzzyTargeting.java:32-66 + FuzzyPositions.java) ──
  Hg.FLEE_FIND_H = 16; Hg.FLEE_FIND_V = 7;   // GoToRememberedPositionTask.setWalkTarget: findFrom($$0, 16, 7, $$1)
  Hg.FLEE_FIND_TRIES = 10;                  // setWalkTarget's own `for ($$3 = 0; $$3 < 10; …)`
  Hg.FAVOR_REPELLENT = -1.0;                // HoglinEntity.getPathfindingFavor: isWarpedFungusAround -> -1.0F
  Hg.FAVOR_NYLIUM = 10.0;                   // … crimson_nylium underfoot -> 10.0F, else 0.0F
  Hg.FAVOR_REPELLENT_DIST = 8;              // HoglinBrain.isWarpedFungusAround: isWithinDistance(pos, 8.0)
  /** HoglinEntity.getPathfindingFavor(pos): -1 within 8 of the REMEMBERED repellent, 10 on crimson nylium. */
  Hg.pathfindingFavor = function (e, p) {
    var r = e.hgRepellent;
    if (r) {
      var dx = Math.floor(r.x) - p.x, dy = Math.floor(r.y) - p.y, dz = Math.floor(r.z) - p.z;
      if (dx * dx + dy * dy + dz * dz < Hg.FAVOR_REPELLENT_DIST * Hg.FAVOR_REPELLENT_DIST) return Hg.FAVOR_REPELLENT;
    }
    var W = NS.World, S = NS.States, R = NS.Reg;
    if (W && W.getBlock && S && S.block && R && R.id && R.id.crimson_nylium !== undefined &&
        S.block[W.getBlock(p.x, p.y - 1, p.z)] === R.id.crimson_nylium) return Hg.FAVOR_NYLIUM;
    return 0;
  };
  function solidMaterialAt(x, y, z) { var Ph = NS.Physics; return !!(Ph && Ph.solidAt && Ph.solidAt(x, y, z)); }
  function blockAt(x, y, z) { var W = NS.World; return W && W.getBlock ? W.getBlock(x, y, z) : 0; }
  /** One `findValid` supplier call: localFuzz (PI/2 cone away), towardTarget (no position target), the
   *  height + EntityNavigation.isValidPosition (opaque full cube below) gates, then `validate`: upWhile
   *  solid, refuse water and a non-zero path penalty. */
  function fuzzCandidate(e, h, v, dx, dz) {
    var r = rnd(), Ai = NS.Ai, S = NS.States, R = NS.Reg, C = NS.CFG || { WORLD_MIN_Y: -64, WORLD_MAX_Y: 256 };
    var yaw = Math.atan2(dz, dx) - Math.PI / 2;
    var a = yaw + (2 * r() - 1) * (Math.PI / 2);
    var rad = Math.sqrt(r()) * Math.SQRT2 * h;
    var ox = -rad * Math.sin(a), oz = rad * Math.cos(a);
    if (Math.abs(ox) > h || Math.abs(oz) > h) return null;
    var oy = Math.floor(r() * (2 * v + 1)) - v;
    var p = { x: Math.floor(Math.floor(ox) + e.x), y: Math.floor(oy + e.y), z: Math.floor(Math.floor(oz) + e.z) };
    if (p.y < C.WORLD_MIN_Y || p.y > C.WORLD_MAX_Y) return null;
    if (!(S && S.fullCubeCollision && S.fullCubeCollision(blockAt(p.x, p.y - 1, p.z)))) return null;
    while (p.y < C.WORLD_MAX_Y && solidMaterialAt(p.x, p.y, p.z)) p.y++;
    if (R && R.id && S.block[blockAt(p.x, p.y, p.z)] === R.id.water) return null;
    if (Ai && Ai.pathTypeAt && Ai.pathPenalty && Ai.pathPenalty(e, Ai.pathTypeAt(p.x, p.y, p.z)) !== 0) return null;
    return p;
  }
  /** FuzzyTargeting.findFrom -> FuzzyPositions.guessBestPathTarget: the best-favoured of 10 candidates
   *  (strict `>`, so ties keep the first), or null. */
  Hg.fuzzyFindFrom = function (e, h, v, from) {
    var dx = e.x - from.x, dz = e.z - from.z, best = null, bs = -Infinity;
    for (var i = 0; i < 10; i++) {
      var p = fuzzCandidate(e, h, v, dx, dz);
      if (!p) continue;
      var f = Hg.pathfindingFavor(e, p);
      if (f > bs) { bs = f; best = p; }
    }
    return best;
  };
  /** GoToRememberedPositionTask (.decomp ai/brain/task/GoToRememberedPositionTask.java): while the
   *  remembered position is within `range` (3D, `Vec3d.isInRange`, strict) and there is no walk target
   *  of this speed already heading away from it, remember a WALK_TARGET from FuzzyTargeting.findFrom(16,
   *  7) (up to 10 tries). The walk target OUTLIVES the range test — the hoglin keeps walking to it (up to
   *  16 blocks off) after it has left the 8-block range (WanderAroundTask follows WALK_TARGET to the end). */
  Hg.FleeGoal = function (e, speed, range, getThreat) {
    var path = null, idx = 1, from = null, Ai = NS.Ai;
    this.canUse = function () {
      var t = getThreat();
      if (!t || Math.hypot(t.x - e.x, t.y - e.y, t.z - e.z) >= range) return false;
      from = { x: t.x, y: t.y, z: t.z }; return true;
    };
    this.canContinueToUse = function () { return !!path && idx < path.length; };
    this.start = function () {
      path = null; idx = 1;
      for (var i = 0; i < Hg.FLEE_FIND_TRIES && !path; i++) {
        var p = Hg.fuzzyFindFrom(e, Hg.FLEE_FIND_H, Hg.FLEE_FIND_V, from);
        if (!p) continue;
        var cp = Ai.findPath(e.x, e.y, e.z, p.x + 0.5, p.y, p.z + 0.5, { mob: e });
        path = cp && cp.length >= 2 ? cp : null;
        break;   // setWalkTarget remembers the first non-null findFrom; an unreachable one is simply not walked
      }
    };
    this.stop = function () { path = null; from = null; };
    this.tick = function () {
      if (!path || idx >= path.length) return;
      Ai.stepToward(e, path[idx], speed);
      if (Ai.closeTo(e, path[idx])) idx++;
    };
  };

  Hg.roster = function (e, ctx) {
    var Ai = NS.Ai, gs = new Ai.GoalSelector();
    var melee = new Ai.MeleeAttackGoal(e, 1.0, undefined, undefined,
      function () { return isBaby(e) ? Hg.MELEE_BABY : Hg.MELEE_ADULT; });
    gs.add(1, Ai.TARGET, new Hg.TargetGoal(e));
    gs.add(2, Ai.MOVE | Ai.LOOK, melee);
    if (e.type === 'hoglin') {
      // AVOID activity, and the IDLE repellent/piglin flights
      gs.add(1, Ai.MOVE, new Hg.FleeGoal(e, Hg.AVOID_SPEED, Hg.AVOID_RANGE, function () { return Hg.avoidTarget(e); }));
      gs.add(3, Ai.MOVE, new Hg.FleeGoal(e, Hg.REPEL_FLEE_SPEED, Hg.REPEL_FLEE_RANGE, function () {
        return Hg.activity(e) === 'idle' ? e.hgRepellent : null; }));
      gs.add(4, Ai.MOVE, new Hg.FleeGoal(e, Hg.PIGLIN_BACKOFF_SPEED, Hg.PIGLIN_BACKOFF_RANGE, function () {
        if (!Hg.isAdult(e) || Hg.activity(e) !== 'idle') return null;
        var ps = Hg.adultPiglinsAround(e); return ps.length ? ps[0] : null; }));
      var animals = ctx.animals || function () { return []; };
      gs.add(5, Ai.MOVE, new Ai.BreedGoal(e, Hg.BREED_SPEED, animals, ctx.onBreed));
      gs.add(6, Ai.MOVE, new Ai.FollowParentGoal(e, Hg.ADULT_WALK_SPEED, animals));
    }
    if (e.type !== 'zoglin') gs.add(7, Ai.MOVE, new Ai.WaterAvoidingRandomStrollGoal(e, Hg.STROLL_SPEED, ctx.random, Ai.hoglinPathfindingFavor(e)));
    if (e.type === 'zoglin') {
      // ZoglinEntity.addIdleTasks RandomTask(StrollTask(0.4F) w2, GoTowardsLookTarget(0.4F, 3) w2, WaitTask(30,60) w1)
      // (.decomp RandomTask/CompositeTask, read whole): every tick the composite is stopped it draws a weighted order and
      // starts the first child whose memories allow (stroll/look need NO walk target; look also needs a look target).
      // Stroll/look end after one tick but leave the walk target, so the very next draw can only start the WaitTask,
      // which holds the composite 30-60 ticks; when it ends with the walk target gone the next draw is fresh.
      var Lk = function () {
        var best = null, bd = 64, all = (ctx.players ? ctx.players().slice() : []);
        var ents = ctx.entities ? ctx.entities() : [];
        for (var j = 0; j < ents.length; j++) if (ents[j] && Ai.ROSTER[ents[j].type]) all.push(ents[j]);
        for (var i = 0; i < all.length; i++) { var o = all[i];
          if (o === e || o.dead || o.removed) continue;
          var d = (o.x - e.x) * (o.x - e.x) + (o.y - e.y) * (o.y - e.y) + (o.z - e.z) * (o.z - e.z);
          if (d < bd) { bd = d; best = o; } }
        return best; };
      var rnd = ctx.random || Math.random, stroll = new Ai.WaterAvoidingRandomStrollGoal(e, Hg.STROLL_SPEED, rnd, Ai.hoglinPathfindingFavor(e));
      stroll.forceChance = true;
      var lt = null, strolling = false, wait = 0;
      var farLook = function () { return !!lt && !lt.dead && !lt.removed && Math.hypot(lt.x - e.x, lt.z - e.z) > 3; };
      gs.add(7, Ai.MOVE, { zoglinIdle: true, waiting: function () { return wait > 0; }, canUse: function () { return true; }, canContinueToUse: function () { return true; },
        start: function () {},
        stop: function () { if (strolling) stroll.stop(); strolling = false; lt = null; wait = 0; },
        tick: function () {
          if (strolling) { if (stroll.canContinueToUse()) stroll.tick(); else { stroll.stop(); strolling = false; } }
          if (lt) { if (farLook()) Ai.stepToward(e, { x: lt.x, y: lt.y, z: lt.z }, Hg.STROLL_SPEED); else lt = null; }
          if (wait > 0) { wait--; return; }
          if (strolling || lt) { wait = 30 + Math.floor(rnd() * 31); return; }   // walk target present: only WaitTask can start
          var l = Lk(), r = rnd() * (l ? 5 : 3);
          if (r < 2) { stroll.start(); strolling = true; }
          else if (l && r < 4) { lt = l; if (!farLook()) { lt = null; wait = 30 + Math.floor(rnd() * 31); } }
          else wait = 30 + Math.floor(rnd() * 31);
        } });
      // ZoglinEntity.addIdleTasks: FollowMobTask(8.0F), predicate x->true = ANY living entity, players included
      gs.add(8, Ai.LOOK, new Ai.LookAtPlayerGoal(e, function () {
        var out = ctx.players ? ctx.players().slice() : [], all = ctx.entities ? ctx.entities() : [];
        for (var i = 0; i < all.length; i++) { var o = all[i]; if (o && o !== e && !o.dead && !o.removed && Ai.ROSTER[o.type]) out.push(o); }
        return out;
      }, 8.0));
    } else gs.add(8, Ai.LOOK, new Ai.LookAtPlayerGoal(e, ctx.players));
    return gs;
  };

  // ── zombification ─────────────────────────────────────────────────────────────────────
  /** HoglinEntity.canConvert: `!isPiglinSafe() && !immune && !isAiDisabled()` */
  Hg.canConvert = function (e) {
    var W = NS.World, dt = W && W.dimType ? W.dimType() : null;
    return e.type === 'hoglin' && !(dt && dt.piglinSafe) && !e.immuneToZombification && !e.aiDisabled;
  };
  Hg.zombify = function (e) {
    var EL = NS.EntityList;
    if (NS.Sound && NS.Sound.mobSound) NS.Sound.mobSound(e, Hg.SOUND_ZOMBIFY);
    if (!EL || !EL.spawn || !EL.canSpawn('zoglin')) { e.removed = true; return null; }
    var z = EL.spawn('zoglin', e.x, e.y, e.z, { conversion: true });
    if (z) {
      z.yaw = e.yaw;
      // MobEntity.convertTo: baby flag, name, persistence, AI flag, every equipment slot
      Hg.setBaby(z, isBaby(e));
      if (e.customName !== undefined) z.customName = e.customName;
      if (e.persistent) z.persistent = true;
      if (e.aiDisabled) z.aiDisabled = true;
      if (e.equip) z.equip = e.equip.slice();
      if (e.equipDropChance) z.equipDropChance = e.equipDropChance.slice();
      if (NS.Effects && NS.Effects.addStatusEffect) NS.Effects.addStatusEffect(z, 'nausea', Hg.ZOMBIFY_NAUSEA, 0);
    }
    e.removed = true;
    return z;
  };

  /** One tick from EL's mob dispatch: the clock, a new landed hit's reaction, the movement
   *  cooldown (tickMovement), the repellent + PacifyTask, setAttacking, the zombification clock. */
  Hg.tickEntity = function (e) {
    if (!e || !Hg.TYPES[e.type] || e.removed || e.dead) return;
    e.hgClock = clock(e) + 1;
    if (e.movementCooldown > 0) e.movementCooldown--;
    if ((e.hurtSeq | 0) > (e.hgHurtSeen | 0)) {
      e.hgHurtSeen = e.hurtSeq | 0;
      if (e.lastHurtByEntity) Hg.onAttacked(e, e.lastHurtByEntity);
    }
    Hg.syncAge(e);
    if (e.type === 'zoglin') {
      // Sensor: lastSenseTime = static unseeded Random.nextInt(20) at construction; `--t <= 0` senses and resets to 20
      if (e.hgSenseT === undefined) e.hgSenseT = Math.floor(rnd()() * 20);
      e.hgSensed = --e.hgSenseT <= 0;
      if (e.hgSensed) e.hgSenseT = 20;
    }
    if (e.type === 'hoglin' && e.inLove > 0 && !Hg.breedTarget(e)) {
      var ms = Hg.visibleMobs(e);
      for (var bi = 0; bi < ms.length; bi++) if (ms[bi] !== e && ms[bi].type === 'hoglin' && ms[bi].inLove > 0) { Hg.setBreedTarget(e, ms[bi]); break; }
    }
    if (e.type === 'hoglin') {
      // refreshActivities: the ambient-style sound once on every activity change
      var act = Hg.activity(e);
      if (e.hgActivity !== undefined && e.hgActivity !== act && NS.MobVoice) NS.MobVoice.emit(e, Hg.soundEvent(e));
      e.hgActivity = act;
      Hg.tickAmbient(e);
    } else if (e.type === 'zoglin') {
      // ZoglinEntity.tickBrain: a change to FIGHT plays playAngrySound() once
      var zact = Hg.activity(e);
      if (e.hgActivity !== undefined && e.hgActivity !== zact && zact === 'fight' && NS.MobVoice) NS.MobVoice.emit(e, 'entity.zoglin.angry');
      e.hgActivity = zact;
    }
    if (e.type === 'hoglin') {
      if ((e.hgClock % 20) === 1 || e.hgRepellent === undefined) e.hgRepellent = Hg.nearestRepellent(e);
      if (e.hgRepellent && Hg.attackTarget(e) && !Hg.pacified(e)) { e.hgPacifiedUntil = e.hgClock + Hg.PACIFY_TICKS; Hg.forgetTarget(e); }   // PacifyTask: only with ATTACK_TARGET and no PACIFIED; run forgets ATTACK_TARGET
      var av = Hg.avoidTarget(e);
      if (av && Hg.isLoneAdult(e)) e.hgAvoid = null;   // ForgetTask(isLoneAdult, AVOID_TARGET)
    }
    Hg.cantReachTick(e);
    e.aggressive = !!Hg.attackTarget(e);
    if (Hg.canConvert(e)) e.timeInOverworld = (e.timeInOverworld | 0) + 1;
    else if (e.type === 'hoglin') e.timeInOverworld = 0;
    if (e.type === 'hoglin' && e.timeInOverworld > Hg.ZOMBIFY_AFTER) Hg.zombify(e);
  };

  Hg.init = function () {
    var Ai = NS.Ai;
    if (Ai && Ai.ROSTER) { Ai.ROSTER.hoglin = Hg.roster; Ai.ROSTER.zoglin = Hg.roster; }
    Hg.ready = true;
  };
  Hg.init();
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
