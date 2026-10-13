// src/07zzr_guardian.js - #1011: GuardianEntity + ElderGuardianEntity AI. .decomp
// net/minecraft/entity/mob/GuardianEntity.java and ElderGuardianEntity.java, read whole:
//   * `Gd.FireBeamGoal`       - FireBeamGoal verbatim (beamTicks -10 -> beam target set at 0 -> damage at warmup)
//   * `Gd.moveControl` + `Gd.travelMob` - GuardianMoveControl + GuardianEntity.travel (swim sway, spikes retract)
//   * `Gd.targetGoal`         - ActiveTargetGoal(10, true, false, GuardianTargetPredicate)
//   * `Gd.tick`               - tickMovement's server half (air reset, out-of-water flop) + the client animation fields
//   * `Gd.onDamage`           - damage(): thorns 2.0 back at a living, non-magic, non-explosive attacker while spiked
// Runs on: MAIN THREAD ONLY. No DOM.
//
// NOT HERE (named, not guessed): the bubble particle's SPRITE (simulation only) and the beam RENDERER (nothing consumes beamProgress
// yet); ElderGuardianEntity.mobTick (Mining Fatigue III curse, position target); WanderAroundGoal.ignoreChanceOnce /
// setChance(400); the elder-guardian hurt/death/ambient sound
// choice (07zzp_mobvoice.js owns the voice).
(function (NS) {
  'use strict';

  var Gd = NS.Guardian = { ready: false };

  Gd.WARMUP_GUARDIAN = 80; Gd.WARMUP_ELDER = 60;
  Gd.BEAM_START_TICKS = -10;          // FireBeamGoal.start
  Gd.MIN_TARGET_DIST_SQ = 9.0;        // GuardianTargetPredicate / FireBeamGoal.shouldContinue
  Gd.THORNS_DAMAGE = 2.0;
  Gd.WANDER_CHANCE = 80; Gd.ELDER_WANDER_CHANCE = 400;   // GuardianEntity ctor 80; ElderGuardianEntity wanderGoal.setChance(400) (#1010)
  Gd.ELDER_RESTRICT = 16;                                // ElderGuardianEntity.mobTick setPositionTarget(blockPos, 16)
  Gd.MAX_AIR = 300;
  Gd.TYPES = { guardian: 1, elder_guardian: 1 };

  Gd.isGuardian = function (e) { return !!(e && Gd.TYPES[e.type]); };
  Gd.isElder = function (e) { return !!e && e.type === 'elder_guardian'; };
  Gd.getWarmupTime = function (e) { return Gd.isElder(e) ? Gd.WARMUP_ELDER : Gd.WARMUP_GUARDIAN; };
  function rnd() { return ((NS.EntityList && NS.EntityList.random) || Math.random)(); }

  // constructor field initialisers + initDataTracker defaults
  Gd.spawnInit = function (e) {
    e.experiencePoints = 10;
    e.spikesRetracted = false;       // SPIKES_RETRACTED
    e.beamTargetId = 0;              // BEAM_TARGET_ID (0 = none)
    e.beamTicks = 0;
    e.tailAngle = rnd(); e.prevTailAngle = e.tailAngle;
    e.spikesExtension = 0; e.prevSpikesExtension = 0; e.spikesExtensionRate = 0;
    e.flopping = false;
    if (Gd.isElder(e)) e.persistent = true;
  };
  Gd.areSpikesRetracted = function (e) { return !!e.spikesRetracted; };
  Gd.hasBeamTarget = function (e) { return (e.beamTargetId || 0) !== 0; };
  /** setBeamTarget(id): onTrackedDataSet resets beamTicks. */
  Gd.setBeamTarget = function (e, t) {
    var id = t ? (t.id || 1) : 0;
    if (id !== (e.beamTargetId || 0)) e.beamTicks = 0;   // onTrackedDataSet fires only when the id changes
    e.beamTargetId = id;
  };
  Gd.getBeamTarget = function (e) { return Gd.hasBeamTarget(e) ? (e.target || null) : null; };   // server side: getTarget()
  Gd.getBeamProgress = function (e, pt) { return ((e.beamTicks || 0) + (pt || 0)) / Gd.getWarmupTime(e); };
  Gd.getFlopSound = function (e) { return Gd.isElder(e) ? 'entity.elder_guardian.flop' : 'entity.guardian.flop'; };

  function dist2(a, b) { var x = a.x - b.x, y = a.y - b.y, z = a.z - b.z; return x * x + y * y + z * z; }

  // ── GuardianTargetPredicate: player | squid (incl. glow_squid) | axolotl, farther than 3 blocks ──────────────────
  Gd.targetPredicate = function (owner, t) {
    if (!t) return false;
    var ok = t === NS.Player || t.type === 'player' || t.type === 'squid' || t.type === 'glow_squid' || t.type === 'axolotl';
    return ok && dist2(t, owner) > Gd.MIN_TARGET_DIST_SQ;
  };
  Gd.candidates = function (e) {
    var out = [], L = (NS.EntityList && NS.EntityList.list) || [];
    if (NS.Player && Gd.targetPredicate(e, NS.Player)) out.push(NS.Player);
    for (var i = 0; i < L.length; i++) {
      var o = L[i];
      if (o !== e && !o.removed && !o.dead && Gd.targetPredicate(e, o)) out.push(o);
    }
    return out;
  };

  // ── FireBeamGoal ──────────────────────────────────────────────────────────────────────────────
  Gd.FireBeamGoal = function (e) {
    var beamTicks = 0, elder = Gd.isElder(e);
    this.beamTicks = function () { return beamTicks; };
    this.canUse = function () { return !!e.target && !e.target.dead && !e.target.removed; };
    this.canContinueToUse = function () {
      return this.canUse() && (elder || dist2(e, e.target) > Gd.MIN_TARGET_DIST_SQ);
    };
    function lookAtTarget() { var t = e.target; if (t && e.look) e.look.setLookAt(t.x, t.y + (t.eyeHeight || 0), t.z, 90 * Math.PI / 180, 90 * Math.PI / 180); }
    this.start = function () { beamTicks = Gd.BEAM_START_TICKS; lookAtTarget(); e.navigating = false; e.navNode = null; };
    this.stop = function () { Gd.setBeamTarget(e, null); e.target = null; if (e.guardianWander) e.guardianWander.ignoreChanceOnce(); };
    this.tick = function () {
      var t = e.target;
      if (!t) return;
      e.navigating = false; e.navNode = null;
      lookAtTarget();
      if (NS.Ai && NS.Ai.canSee && !NS.Ai.canSee(e, t)) { e.target = null; return; }
      beamTicks++;
      if (beamTicks === 0) {
        Gd.setBeamTarget(e, t);
        if (!e.silent && NS.Sound && NS.Sound.play) NS.Sound.play('entity.guardian.attack', { x: e.x, y: e.y, z: e.z, source: 'hostile' });   // status 21
      } else if (beamTicks >= Gd.getWarmupTime(e)) {
        var f = 1.0;
        if (NS.Diff && NS.Diff.isHard && NS.Diff.isHard()) f += 2.0;
        if (elder) f += 2.0;
        Gd.hurtMagic(t, f, e);
        // plain damage(DamageSource.mob(guardian), ATTACK_DAMAGE) -- NOT tryAttack: no Thorns/knockback/held-item side effects (#3831)
        var Cb = NS.Combat, at = NS.Entities && NS.Entities.attrsOf ? NS.Entities.attrsOf(e.type) : null, dmg = at ? at.dmg : 0;
        if (dmg > 0) {
          if (t === NS.Player) { if (NS.Survival && NS.Survival.hurt) NS.Survival.hurt(t, 'mob', dmg, e); }
          else if (Cb && Cb.hurt) Cb.hurt(t, dmg, undefined, false, { attacker: e });
        }
        e.target = null;
      }
    };
  };
  /** DamageSource.magic(guardian, guardian): bypasses armour, attacker = the guardian. */
  Gd.hurtMagic = function (t, amount, by, thorns) {
    var Sv = NS.Survival, Cb = NS.Combat, tag = thorns ? 'thorns' : 'magic';
    if (t === NS.Player) return !!(Sv && Sv.hurt && Sv.hurt(t, tag, amount, by));
    return !!(Cb && Cb.hurt && Cb.hurt(t, amount, undefined, false, { attacker: by, bypassArmor: !thorns, source: tag }));
  };

  // ── damage(): thorns while the spikes are out ─────────────────────────────────────────────────
  /** Call from Cb.hurt with the resolved attacker and source tag; returns true if thorns fired. */
  Gd.onDamage = function (e, attacker, src) {
    if (!Gd.isGuardian(e)) return false;
    if (e.guardianWander) e.guardianWander.ignoreChanceOnce();   // damage(): wanderGoal.ignoreChanceOnce() before super.damage
    if (!attacker || e.spikesRetracted) return false;
    var tag = src && src.source;
    if (tag === 'magic' || tag === 'thorns' || tag === 'indirect_magic' || tag === 'projectile' || tag === 'arrow' || tag === 'fireball' || tag === 'explosion' || (src && (src.explosive || src.projectile))) return false;
    Gd.hurtMagic(attacker, Gd.THORNS_DAMAGE, e, true);   // DamageSource.thorns: armour applies
    return true;
  };

  // ── GuardianMoveControl + GuardianEntity.travel ───────────────────────────────────────────────
  /** Runs after the goals: consumes e.navigating/e.navNode (Ai.stepToward) exactly like the dolphin. */
  Gd.moveControl = function (e) {
    var node = e.navNode, nav = !!e.navigating;
    e.navNode = null; e.navigating = false;
    e.zza = 0;                                          // travel() feeds no forward input; the control writes velocity itself
    if (nav && node) {
      var dx = node.x + 0.5 - e.x, dy = node.y - e.y, dz = node.z + 0.5 - e.z;
      var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len > 0) {
        var ny = dy / len;
        e.yaw = NS.Ai.rotlerp(e.yaw || 0, Math.atan2(dx, -dz), Math.PI / 2);   // wrapDegrees(.., 90)
        e.bodyYaw = e.yaw;
        if (e.look) {   // lookAt(lerp(0.125, look, pos + dir*2 | eye + dirY/len), 10, 40)
          var lw = e.look.wanted, ex = e.x + dx / len * 2, ey = e.y + (e.eyeHeight || 0) + ny, ez = e.z + dz / len * 2;
          if (!e.look.isLookingAtTarget() || !lw) lw = { x: e.x, y: e.y + (e.eyeHeight || 0), z: e.z };   // seed from the mob
          var D = Math.PI / 180;
          e.look.setLookAt(lw.x + (ex - lw.x) * 0.125, lw.y + (ey - lw.y) * 0.125, lw.z + (ez - lw.z) * 0.125, 10 * D, 40 * D);
        }
        var at = NS.Entities && NS.Entities.attrsOf ? NS.Entities.attrsOf(e.type) : null;
        var target = (e.guardianSpeedMod || 1.0) * ((at && at.speed) || (Gd.isElder(e) ? 0.3 : 0.5));
        var sp = (e.mobSpeed || 0) + (target - (e.mobSpeed || 0)) * 0.125;     // lerp(0.125, movementSpeed, speed*attr)
        e.mobSpeed = sp;
        var k = (e.age || 0) + (e.id || 0);
        var psi = (e.yaw || 0) + Math.PI;                                        // vanilla yaw for this engine's yaw
        var c = Math.cos(psi), s = Math.sin(psi);
        var a = Math.sin(k * 0.5) * 0.05, b = Math.sin(k * 0.75) * 0.05;
        e.vx = (e.vx || 0) + a * c;
        e.vy = (e.vy || 0) + b * (s + c) * 0.25 + sp * ny * 0.1;
        e.vz = (e.vz || 0) + a * s;
        e.spikesRetracted = true;
        return;
      }
    }
    e.mobSpeed = 0;
    e.spikesRetracted = false;
  };
  Gd.travelMob = function (e) {
    Gd.moveControl(e);
    var Ph = NS.Physics;
    if (e.inWater) {
      if (Ph && Ph.move) Ph.move(e, e.vx || 0, e.vy || 0, e.vz || 0);
      e.vx = (e.vx || 0) * 0.9; e.vy = (e.vy || 0) * 0.9; e.vz = (e.vz || 0) * 0.9;
      if (!e.spikesRetracted && !e.target) e.vy -= 0.005;
    } else if (Ph && Ph.travelMob) Ph.travelMob(e);
  };

  // ── tickMovement: air reset, out-of-water flop, and the animation fields ─────────────────────
  Gd.tick = function (e) {
    if (e.dead || e.removed) return;
    var wet = !!e.inWater;
    // client half (animation state) - the engine has no client/server split
    e.prevTailAngle = e.tailAngle;
    if (!wet) {
      e.spikesExtensionRate = 2.0;
      if ((e.vy || 0) > 0 && e.flopping && !e.silent && NS.Sound && NS.Sound.play) {
        NS.Sound.play(Gd.getFlopSound(e), { x: e.x, y: e.y, z: e.z, source: 'hostile' });
      }
      e.flopping = (e.vy || 0) < 0 && Gd.topSolidBelow(e);
    } else if (e.spikesRetracted) {
      e.spikesExtensionRate = e.spikesExtensionRate < 0.5 ? 4.0 : e.spikesExtensionRate + (0.5 - e.spikesExtensionRate) * 0.1;
    } else {
      e.spikesExtensionRate = e.spikesExtensionRate + (0.125 - e.spikesExtensionRate) * 0.2;
    }
    e.tailAngle += e.spikesExtensionRate;
    e.prevSpikesExtension = e.spikesExtension;
    if (!wet) e.spikesExtension = rnd();
    else if (e.spikesRetracted) e.spikesExtension += (0 - e.spikesExtension) * 0.25;
    else e.spikesExtension += (1 - e.spikesExtension) * 0.06;
    if (Gd.hasBeamTarget(e) && e.beamTicks < Gd.getWarmupTime(e)) e.beamTicks++;
    Gd.tickParticles(e, wet);
    // server half
    if (wet) e.air = Gd.MAX_AIR;
    else if (e.onGround) {
      e.vx = (e.vx || 0) + (rnd() * 2 - 1) * 0.4;
      e.vy = (e.vy || 0) + 0.5;
      e.vz = (e.vz || 0) + (rnd() * 2 - 1) * 0.4;
      e.yaw = rnd() * Math.PI * 2;
      e.onGround = false;
    }
    if (Gd.hasBeamTarget(e) && e.headYaw !== undefined) e.yaw = e.headYaw;
  };
  /** tickMovement's client particle halves: 2 bubbles trailing a spike-retracted swimmer, and the beam's bubble
   *  line (spacing 1.8 - progress + rand*(1.7 - progress)). Rotation vec includes pitch (e.xHeadRot, radians, down +). Returns the count emitted. */
  Gd.tickParticles = function (e, wet) {
    var Px = NS.Particle, r = rnd, n = 0;
    if (!Px || !Px.spawn) return 0;
    var w = e.width || 0, h = e.height || 0, yaw = e.yaw || 0;
    if (e.spikesRetracted && wet) {
      var pr = e.xHeadRot || 0, cp = Math.cos(pr);   // getRotationVec(0): (sin yaw cos p, -sin p, -cos yaw cos p)
      var lx = Math.sin(yaw) * cp, ly = -Math.sin(pr), lz = -Math.cos(yaw) * cp;
      for (var i = 0; i < 2; i++) {
        Px.spawn('bubble', e.x + w * (2 * r() - 1) * 0.5 - lx * 1.5, e.y + h * r() - ly * 1.5, e.z + w * (2 * r() - 1) * 0.5 - lz * 1.5, 0, 0, 0, r);
        n++;
      }
    }
    var t = Gd.getBeamTarget(e);
    if (t) {
      var prog = Gd.getBeamProgress(e, 0), ey = e.y + (e.eyeHeight !== undefined ? e.eyeHeight : h * 0.5);
      var dx = t.x - e.x, dy = (t.y + (t.height || 0) * 0.5) - ey, dz = t.z - e.z;
      var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > 0) {
        dx /= d; dy /= d; dz /= d;
        var k = r();
        while (k < d) {
          k += 1.8 - prog + r() * (1.7 - prog);
          Px.spawn('bubble', e.x + dx * k, ey + dy * k, e.z + dz * k, 0, 0, 0, r);
          n++;
        }
      }
    }
    return n;
  };
  /** world.isTopSolid(blockPos.down()) */
  Gd.topSolidBelow = function (e) {
    var W = NS.World, Ph = NS.Physics;
    if (!W || !W.getBlock || !Ph || !Ph.shapesForState) return !!e.onGround;
    var st = W.getBlock(Math.floor(e.x), Math.floor(e.y) - 1, Math.floor(e.z));
    return st !== 0 && !!(Ph.shapesForState(st) || []).length;
  };

  /** GuardianEntity.getPathfindingFavor: water cell 10 + getBrightness - 0.5, else PathAwareEntity's 0. */
  Gd.pathfindingFavor = function (x, y, z) {
    var S = NS.States, Ph = NS.Physics;
    if (!S.waterIn[Ph.blockAt(x, y, z)]) return 0;
    var f = ((NS.World && NS.World.rawBrightness) ? NS.World.rawBrightness(x, y, z) : 15) / 15;
    return 10 + f / (4 - 3 * f) - 0.5;
  };
  /** NoPenaltyTargeting.find(mob, h, v): 10 localFuzz candidates, SwimNavigation.isValidPosition (not an opaque full cube),
   *  hasPathfindingPenalty, best getPathfindingFavor (strict >), ofBottomCenter. */
  Gd.findWanderTarget = function (e, rand, h, v) {
    var Ai = NS.Ai, Ph = NS.Physics, best = null, bestScore = -Infinity;
    for (var t = 0; t < Ai.STROLL_TRIES; t++) {
      var x = Math.floor(e.x) + Math.floor(rand() * (2 * h + 1)) - h, y = Math.floor(e.y) + Math.floor(rand() * (2 * v + 1)) - v,
          z = Math.floor(e.z) + Math.floor(rand() * (2 * h + 1)) - h;
      if (y < NS.CFG.WORLD_MIN_Y || y > NS.CFG.WORLD_MAX_Y) continue;
      if (Ph.solidAt(x, y, z)) continue;
      if (Ai.pathPenalty(e, Ai.pathTypeAt(x, y, z)) !== 0) continue;
      var sc = Gd.pathfindingFavor(x, y, z);
      if (sc > bestScore) { bestScore = sc; best = { x: x + 0.5, y: y, z: z + 0.5 }; }
    }
    return best;
  };

  // ── the roster (GuardianEntity.initGoals) ─────────────────────────────────────────────────────
  Gd.buildGoals = function (e, ctx) { return Gd.roster(e, ctx); };
  Gd.roster = function (e, ctx) {
    var Ai = NS.Ai, gs = new Ai.GoalSelector();
    var players = ctx.players || function () { return NS.Player ? [NS.Player] : []; };
    var rand = ctx.random || rnd;
    gs.add(1, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, function () { return Gd.candidates(e); },
      { sight: true, mustSee: true, livingBox: true, reciprocalChance: 10, rand: rand }));
    gs.add(4, Ai.MOVE | Ai.LOOK, new Gd.FireBeamGoal(e));
    gs.add(5, Ai.MOVE | Ai.LOOK, new Ai.GoToWalkTargetGoal(e, 1.0, rand));
    e.guardianWander = new Ai.WanderAroundGoal(e, 1.0, rand, Gd.isElder(e) ? Gd.ELDER_WANDER_CHANCE : Gd.WANDER_CHANCE);
    e.guardianWander.setFinder(function () { return Gd.findWanderTarget(e, rand, 10, 7); });
    gs.add(7, Ai.MOVE | Ai.LOOK, e.guardianWander);
    gs.add(8, Ai.LOOK, new Ai.LookAtPlayerGoal(e, players, 8));
    gs.add(8, Ai.LOOK, Gd.lookAtGuardianGoal(e, ctx, rand));
    gs.add(9, Ai.MOVE | Ai.LOOK, new Ai.RandomLookAroundGoal(e, rand));
    return gs;
  };

  /** LookAtEntityGoal(GuardianEntity.class, 12, 0.01): canStart rolls `random.nextFloat() >= 0.01` first. */
  Gd.LOOK_RANGE = 12; Gd.LOOK_CHANCE = 0.01;
  Gd.lookAtGuardianGoal = function (e, ctx, rand) {
    var Ai = NS.Ai;
    var g = new Ai.LookAtPlayerGoal(e, function () {
      var out = [], all = ctx.entities ? ctx.entities() : ((NS.EntityList && NS.EntityList.list) || []);
      for (var i = 0; i < all.length; i++) {
        var o = all[i];
        if (o && o !== e && !o.dead && !o.removed && Gd.isGuardian(o)) out.push(o);
      }
      return out;
    }, Gd.LOOK_RANGE, rand, Gd.LOOK_CHANCE);   // the goal rolls the chance itself
    g.targetsNonPlayer = true;   // LookAtEntityGoal(GuardianEntity.class): goalrostercheck compares only the player look goal
    return g;
  };

  Gd.init = function () {
    var Ai = NS.Ai;
    if (Ai && Ai.ROSTER) { Ai.ROSTER.guardian = Gd.roster; Ai.ROSTER.elder_guardian = Gd.roster; }
    Gd.ready = true;
  };
  Gd.init();
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
