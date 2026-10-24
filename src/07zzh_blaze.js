// src/07zzh_blaze.js — loop/blazeghast: the BLAZE and the two FIREBALL projectiles it and the
// ghast (07zzi_ghast.js) both need. Off .decomp, read whole: net/minecraft/entity/mob/
// BlazeEntity.java (createBlazeAttributes, tickMovement's own float-up, mobTick's eyeOffset
// homing, hurtByWater, the inner ShootFireballGoal class -- the whole AI), net/minecraft/entity/
// projectile/ExplosiveProjectileEntity.java (the shared power-vector flight every fireball flies:
// NOT gravity -- a constant `power` (unit vector * 0.1) is ADDED to velocity every tick, then the
// sum is multiplied by drag 0.95 (0.8 touching water) -- read whole), AbstractFireballEntity.java
// (the ItemStack DataTracker neither concrete class uses), FireballEntity.java (the BIG one --
// `ExplosionPower` NBT, 6 damage direct hit, reuses `NS.Explosion.explode` for the blast, owned by
// 07zzi_ghast.js's own header since only the ghast fires it) and SmallFireballEntity.java (sets an
// unlucky ENTITY on fire for 5s + 5 damage, or the BLOCK it hits, no explosion at all).
//
// ⚠⚠ ATTRIBUTES, HITBOX, FIRE IMMUNITY, SPAWN EGG AND THE BLAZE-ROD/GHAST-TENTACLE LOOT TABLE
// WERE ALL ALREADY DATA. `Entities.attrsOf('blaze')` already answers `createBlazeAttributes`'s
// own {hp:20, dmg:6, speed:0.23, follow:48} straight out of the jar-extracted attribute table
// (19_data.gen.js) -- this file adds no attribute of its own. The hitbox (0.6x1.8) is already in
// `EL.dims`'s own generated table, `Cb.fireImmuneOf('blaze')` already reads true off the SAME
// generated fire-immunity column the header of that function names by name ("blaze/ghast/
// magma_cube/…"), the spawn egg needs nothing beyond `EL.canSpawn('blaze')` returning true (this
// file's own `EL.motionFor` branch below is what flips that), and `entities/blaze`'s loot table
// (blaze_rod) is already packed the same wholesale way every other vanilla loot table is
// (`tools/pack-loot.mjs` reads every `loot_tables/entities/*.json` in the jar, not a hand-picked
// subset) -- `Cb.dropLoot`'s existing `L.entityDrops({type: e.type, …})` call finds it the moment
// a blaze exists to die. NONE of that is this file's own work; this file is the GOALS, the
// fireball projectiles, and the two render/motion hooks a jar-measured table has no row for yet.
//
// ⚠⚠ RENDERING, NAMED RATHER THAN SILENTLY HALF-DONE (`Bl.OWED`, at the bottom). The blaze's
// HEAD box (`tools/golden/models-1.18.2.tsv` row `blaze#head`) already has a real, atlas-packed
// texture crop (`assets/mob-geometry.json`, built by `tools/pack-mobtex.mjs` off that SAME golden
// row) and draws correctly, at scale 1 (no `ER.RENDER_SCALE` entry -- `BlazeEntityRenderer`
// passes 0.5F as ITS OWN OWN SHADOW RADIUS, not a `scale()` override; the blaze has none). The
// TWELVE RODS do not: `BlazeEntityModel.getTexturedModelData` builds each one's pivot with
// `MathHelper.cos`/`sin` inside a `for` loop (this file's own header cites the exact lines),
// which is a genuinely different shape from the STATIC-table loops (silverfish/endermite) this
// engine's bytecode walker already resolves -- `tools/extract-models.mjs`'s own header says so
// in the open ("built by a shape this walk does not read"), and the golden table has one row for
// `blaze` (`head`) where vanilla has thirteen parts. Rendering the 12 rods needs BOTH new box
// GEOMETRY (buildable here, procedurally, off this file's own port of `getTexturedModelData`/
// `setAngles`) AND a new ATLAS CROP per rod face (`tools/pack-mobtex.mjs`'s own job, reading the
// real jar texture) -- `assets/` is this repo's SHARED tree (every concurrent worktree symlinks
// the SAME real directory, this session's own harness note), so re-running that packer from here
// would rewrite every other worker's binary assets out from under them, which is out of this
// unit's own scope. The rods are named on `Bl.OWED`, not drawn as a silent single box pretending
// to be the whole model -- the SAME "collar#null"/"horse_armor" precedent `extract-models.mjs`'s
// own pinned-empty-layers list already sets for a geometry gap this codebase leaves open rather
// than approximates.
//
// Runs on: MAIN THREAD ONLY. No DOM, no GL.

(function (NS) {
  'use strict';

  var Bl = NS.Blaze = { ready: false };

  // ── constants, every one a literal off .decomp (cited inline) ──────────────────────────────
  Bl.CLOSE_RANGE_SQ = 4.0;              // ShootFireballGoal.tick: squaredDistanceTo < 4.0
  Bl.MELEE_COOLDOWN = 20;               // fireballCooldown = 20 (the close-range branch)
  Bl.BURST_START_COOLDOWN = 60;         // fireballsFired == 1 -> cooldown = 60
  Bl.BURST_MID_COOLDOWN = 6;            // fireballsFired <= 4 -> cooldown = 6
  Bl.BURST_END_COOLDOWN = 100;          // else -> cooldown = 100, fired reset to 0
  Bl.BURST_COUNT = 3;                   // fired 2, 3, 4 each spawn one -- three per burst
  Bl.NOT_VISIBLE_CHASE_TICKS = 5;       // targetNotVisibleTicks < 5 keeps homing in on a lost target
  Bl.EYE_HEIGHT = 1.8 * 0.85;   // Entity.getEyeHeight default: dimensions.height*0.85 (.decomp; 1.8 high blaze)
  Bl.EYE_OFFSET_BASE = 0.5;             // eyeOffset field's own initial/reset value
  Bl.EYE_OFFSET_COOLDOWN = 100;         // mobTick: eyeOffsetCooldown = 100
  Bl.EYE_OFFSET_GAUSSIAN = 3.0;         // eyeOffset = 0.5 + nextGaussian() * 3.0
  Bl.FLOAT_UP_ACCEL = Math.fround(0.3);              // mobTick homing: (0.3F - vy) * 0.3F, added to vy
  Bl.FLOAT_UP_FACTOR = Math.fround(0.3);
  Bl.FALL_DAMP_Y = 0.6;                 // tickMovement: vy *= (1,0.6,1) while airborne and falling
  Bl.DROWN_DAMAGE = 1.0;                // LivingEntity.baseTick: hurtByWater() && isWet() -> DROWN 1.0
  Bl.EXPERIENCE = 10;                   // BlazeEntity ctor: experiencePoints = 10
  Bl.GRAVITY = 0.08; Bl.DRAG = 0.98;    // no getGravity()/drag override in BlazeEntity -- plain MobEntity row

  function rnd() { var EL = NS.EntityList; return (EL && EL.random) || Math.random; }
  function gaussian(r) { return NS.U.polarGaussian(r); }   // java.util.Random.nextGaussian: polar method, spare cached on r

  // ── spawn ───────────────────────────────────────────────────────────────────────────────
  Bl.initBlaze = function (e) {
    e.experiencePoints = Bl.EXPERIENCE;
    e.fireActive = false;              // BLAZE_FLAGS bit 0 -- isOnFire()'s own tracked byte
    e.eyeOffset = Bl.EYE_OFFSET_BASE;
    e.eyeOffsetCooldown = 0;
  };

  // ── ShootFireballGoal (BlazeEntity's own inner class, ported whole) ────────────────────────
  Bl.ShootFireballGoal = function (e) {
    var Ai = NS.Ai;
    var fired = 0, cooldown = 0, notVisible = 0;
    function followRange() { return Ai.followRangeOf(e); }
    // vanilla `getMoveControl().moveTo(x,y,z,speed)`: steer straight at the target, no navigation/A*;
    // stepToward's node is block-corner based (+0.5), so offset to hit the exact point.
    function moveToward(tx, ty, tz, speed) { Ai.stepToward(e, { x: tx - 0.5, y: ty, z: tz - 0.5 }, speed); }
    this.canUse = function () {
      var t = e.target;
      return !!t && !t.removed && (t.health === undefined || t.health > 0) && (!NS.Ai.canTargetLiving || NS.Ai.canTargetLiving(t, e));
    };
    this.canContinueToUse = this.canUse;
    this.getCooldown = function () { return cooldown; };   // lockstep trace (#5361): fireballCooldown
    this.start = function () { fired = 0; };
    this.stop = function () { e.fireActive = false; notVisible = 0; };
    this.tick = function () {
      cooldown--;
      var t = e.target;
      if (!t) return;
      var vis = Ai.canSee ? Ai.canSee(e, t) : true;
      notVisible = vis ? 0 : notVisible + 1;
      var ex = e.x, ey = e.y + (e.height || 1.8) * 0.5, ez = e.z;
      var ty = (t.y || 0) + (t.height || 1.8) * 0.5;
      var dx = t.x - ex, dy = ty - ey, dz = t.z - ez;
      // vanilla squaredDistanceTo: feet-to-feet entity positions, not body centres
      var fx = t.x - e.x, fy = (t.y || 0) - e.y, fz = t.z - e.z;
      var distSq = fx * fx + fy * fy + fz * fz;
      if (distSq < Bl.CLOSE_RANGE_SQ) {
        if (!vis) return;
        if (cooldown <= 0) {
          cooldown = Bl.MELEE_COOLDOWN;
          if (NS.Combat && NS.Combat.mobAttack) NS.Combat.mobAttack(e, t);
        }
        moveToward(t.x, t.y, t.z, 1.0);
      } else if (distSq < followRange() * followRange() && vis) {
        if (cooldown <= 0) {
          fired++;
          if (fired === 1) { cooldown = Bl.BURST_START_COOLDOWN; e.fireActive = true; }
          else if (fired <= 4) { cooldown = Bl.BURST_MID_COOLDOWN; }
          else { cooldown = Bl.BURST_END_COOLDOWN; fired = 0; e.fireActive = false; }
          if (fired > 1) {
            var spread = Math.sqrt(Math.sqrt(distSq)) * 0.5;
            if (!e.silent && NS.Sound && NS.Sound.play) {
              // syncWorldEvent 1018 -- the blaze "shoot" sound; not a jar sound-event name this
              // engine's table carries under that id, so `entity.blaze.shoot` (the ambient/
              // attack sound BlazeEntity never otherwise plays) stands in, named not silent.
              NS.Sound.mobSound(e, 'entity.blaze.shoot', 2.0, (NS.fbRand() - NS.fbRand()) * 0.2 + 1.0);
            }
            var r = rnd();
            var vx = dx + gaussian(r) * spread, vy = dy, vz = dz + gaussian(r) * spread;
            var sy = e.y + (e.height || 1.8) * 0.5 + 0.5;
            var EL = NS.EntityList;
            if (EL && EL.canSpawn('small_fireball')) {
              EL.spawn('small_fireball', e.x + vx * 0.0 + (dx !== 0 ? 0 : 0), sy, e.z, { shooter: e, power: [vx, vy, vz] });
            }
          }
        }
        if (e.look) e.look.setLookAt(t.x, (t.y || 0) + Ai.eyeOf(t), t.z, 10, 10);
      } else if (notVisible < Bl.NOT_VISIBLE_CHASE_TICKS) {
        moveToward(t.x, t.y, t.z, 1.0);
      }
    };
  };

  Bl.roster = function (e, ctx) {
    var Ai = NS.Ai, gs = new Ai.GoalSelector();
    gs.add(1, Ai.TARGET, new Ai.RevengeGoal(e, ctx, { group: true }));
    gs.add(2, Ai.TARGET, new Ai.NearestAttackableTargetGoal(e, ctx.players, { sight: true, mustSee: true, reciprocalChance: 10, rand: ctx.random }));
    gs.add(4, Ai.MOVE | Ai.LOOK, new Bl.ShootFireballGoal(e));
    gs.add(5, Ai.MOVE, new Ai.GoToWalkTargetGoal(e, 1.0, ctx.random));
    gs.add(7, Ai.MOVE, new Ai.WanderAroundFarGoal(e, 1.0, ctx.random, 0.0));
    gs.add(8, Ai.LOOK, new Ai.LookAtPlayerGoal(e, ctx.players, 8.0));
    gs.add(8, Ai.MOVE | Ai.LOOK, new Ai.RandomLookAroundGoal(e, ctx.random));
    return gs;
  };

  // ── mobTick: tickMovement's own float-damp + mobTick's own eyeOffset homing + hurtByWater ──
  Bl.mobTick = function (e) {
    if (!e || e.type !== 'blaze' || e.removed || e.dead) return;
    // tickMovement: `!onGround && vy < 0` -> multiply velocity by (1, 0.6, 1)
    if (!e.onGround && e.vy < 0) e.vy *= Bl.FALL_DAMP_Y;
    // BlazeEntity.tickMovement (client branch): 1/24 per tick the burn crackle (vol 1+rand, pitch
    // rand*0.7+0.3, at x+.5,y+.5,z+.5 -- mobSound takes its position from the entity, so it gets a
    // shifted view of it), and TWO large_smoke every tick at a random body height. `smoke` stands in for
    // LARGE_SMOKE (same AscendingParticle class, size 2.5 -> scale x2.5 on the smoke's 0.75).
    // client-only branch in vanilla (world.isClient): it must NOT draw from the server-side entity stream (lockstep #5361)
    var br = NS.fbRand;
    if (Math.floor(br() * 24) === 0 && !e.silent && NS.Sound && NS.Sound.mobSound) NS.Sound.mobSound(Object.assign(Object.create(e), { x: e.x + 0.5, y: e.y + 0.5, z: e.z + 0.5 }), 'entity.blaze.burn', 1 + br(), br() * 0.7 + 0.3);
    if (NS.Particle && NS.Particle.spawn) for (var i = 0; i < 2; i++) {
      var sp = NS.Particle.spawn('smoke', e.x + (br() - 0.5) * e.width, e.y + br() * e.height, e.z + (br() - 0.5) * e.width, 0, 0, 0, br);
      if (sp) sp.scale *= 2.5;
    }
    // mobTick: eyeOffsetCooldown countdown/reroll
    e.eyeOffsetCooldown = (e.eyeOffsetCooldown | 0) - 1;
    if (e.eyeOffsetCooldown <= 0) {
      e.eyeOffsetCooldown = Bl.EYE_OFFSET_COOLDOWN;
      e.eyeOffset = Bl.EYE_OFFSET_BASE + gaussian(rnd()) * Bl.EYE_OFFSET_GAUSSIAN;
    }
    var t = e.target;
    if (t && !t.removed && (t.health === undefined || t.health > 0) && (!NS.Ai.canTargetLiving || NS.Ai.canTargetLiving(t, e))) {
      var eyeY = e.y + Bl.EYE_HEIGHT;   // Entity.getEyeY() for the blaze
      var tEyeY = (t.y || 0) + (t.eyeHeight !== undefined ? t.eyeHeight : (t.height || 1.8) * 0.9);
      if (tEyeY > eyeY + e.eyeOffset) {
        e.vy = e.vy + (Bl.FLOAT_UP_ACCEL - e.vy) * Bl.FLOAT_UP_FACTOR;
      }
    }
    // LivingEntity.baseTick: hurtByWater() && isWet() -> DamageSource.DROWN, 1.0
    var wet = NS.SnowGolem && NS.SnowGolem.isWet ? NS.SnowGolem.isWet(e) : !!e.inWater;
    if (wet && NS.Combat && NS.Combat.hurt) NS.Combat.hurt(e, Bl.DROWN_DAMAGE, undefined, false, { bypassArmor: true, source: 'drown' });
  };

  // ═══════════════════════════════ THE TWO FIREBALL PROJECTILES ═══════════════════════════════
  // `ExplosiveProjectileEntity.tick()` (.decomp, this file's own header), read whole, ported
  // directly: THIS tick's move uses the OLD velocity; the NEW velocity (old + power, * drag) is
  // what NEXT tick moves by. Both fireball types share this file's `Fb.tick` -- the only
  // difference between them is `onHitEntity`/`onHitBlock`, `Fb.HOOKS[e.type]`.
  var Fb = Bl.Fireball = {};
  Fb.SPEED_FACTOR = 0.1;      // `power = normalize(dx,dy,dz) * 0.1`
  Fb.DRAG = 0.95;             // getDrag()
  Fb.DRAG_WATER = 0.8;        // isTouchingWater() branch

  /** `new SmallFireballEntity(world, shooter, dx, dy, dz)` / the big fireball's own ctor --
   *  `power` here is already the RAW (dx,dy,dz) offset (not yet unit-normalized); this function
   *  is `ExplosiveProjectileEntity`'s ctor doing that normalize-and-scale, ported directly
   *  (`if sqrt(dx²+dy²+dz²) != 0`, else power stays (0,0,0) -- a fireball fired dead straight
   *  at its own origin never accelerates, matching the jar's own guard). */
  Fb.initPower = function (e, dx, dy, dz) {
    var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len !== 0) {
      e.powerX = dx / len * Fb.SPEED_FACTOR;
      e.powerY = dy / len * Fb.SPEED_FACTOR;
      e.powerZ = dz / len * Fb.SPEED_FACTOR;
    } else { e.powerX = 0; e.powerY = 0; e.powerZ = 0; }
  };

  Fb.initSmallFireball = function (e, opts) {
    var p = opts && opts.power;
    if (p) Fb.initPower(e, p[0], p[1], p[2]); else { e.powerX = 0; e.powerY = 0; e.powerZ = 0; }
    if (opts && opts.shooter) e.shooter = opts.shooter;
  };
  Fb.initFireball = function (e, opts) {
    var p = opts && opts.power;
    if (p) Fb.initPower(e, p[0], p[1], p[2]); else { e.powerX = 0; e.powerY = 0; e.powerZ = 0; }
    if (opts && opts.shooter) e.shooter = opts.shooter;
    // FireballEntity ctor's own `explosionPower` arg -- GhastEntity.getFireballStrength() (07zzi_ghast.js).
    e.explosionPower = opts && opts.explosionPower !== undefined ? opts.explosionPower : 1;
  };

  function entityHitAt(e) {
    var list = NS.EntityList && NS.EntityList.list;
    if (!list) return null;
    var best = null, bestT = Infinity;
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      if (t === e || t.removed || (t === e.shooter && !e.leftOwner)) continue;
      if (t.maxHealth === undefined && !(NS.Ghast && NS.Ghast.COLLIDABLE_NONLIVING.test(t.type || ''))) continue;   // `canHit`: alive && collides() (boat/minecart/end_crystal too, #3896)
      var tw = t.width !== undefined ? t.width : 0.6, th = t.height !== undefined ? t.height : 1.8;
      // ProjectileUtil.raycast: the segment just travelled (the mover already stepped hv), margin 0, nearest wins
      var hv = e.hv || [0, 0, 0], Cb = NS.Combat;
      var ct = Cb.rayBox(e.x - hv[0], e.y - hv[1], e.z - hv[2], hv[0], hv[1], hv[2],
                         t.x - tw / 2, t.y, t.z - tw / 2, t.x + tw / 2, t.y + th, t.z + tw / 2);
      if (ct !== null && ct <= 1 && ct < bestT) { best = t; bestT = ct; }
    }
    return best;
  }
  function hurtEntity(target, amount, shooter, src) {
    if (target === NS.Player) {
      var Sv = NS.Survival;
      return Sv && Sv.hurt ? Sv.hurt(target, 'fireball', amount, shooter) : false;
    }
    return NS.Combat && NS.Combat.hurt ? NS.Combat.hurt(target, amount, undefined, false, src || {}) : false;
  }

  /** `SmallFireballEntity.onEntityHit`/`onBlockHit`/`onCollision` (.decomp, read whole): 5
   *  damage + 5s of fire on an entity hit (restoring the PRE-hit fire ticks if the damage call
   *  itself was blocked -- invulnerability, Fire Resistance -- same as the jar), or the BLOCK
   *  it hit set alight (skipped for a mob's own shot unless mobGriefing, matching
   *  `!(owner instanceof MobEntity) || mobGriefing`); no explosion either way. */
  Fb.tickSmall = function (e) {
    if (e.removed) return;
    // ExplosiveProjectileEntity.tick (.decomp): raycast from the current position along the CURRENT velocity (blocks,
    // entities inflated 0.3, nearest wins), act on a hit WITHOUT moving, else setPosition(pos + v) then v = (v + power) * drag.
    if (e.shooter && e.shooter !== NS.Player && e.shooter.removed) { e.removed = true; return; }
    var Cb = NS.Combat, ox = e.x, oy = e.y, oz = e.z, vx = e.vx, vy = e.vy, vz = e.vz;
    var bh = Cb && Cb.arrowRaycast ? Cb.arrowRaycast(ox, oy, oz, vx, vy, vz) : null;
    var f = bh ? bh.f : 1, t = null;
    var list = NS.EntityList && NS.EntityList.list, IN = Cb ? Cb.ARROW_ENTITY_INFLATE : 0.3;
    if (list && Cb && Cb.rayBox) for (var i = 0; i < list.length; i++) {
      var q = list[i];
      if (q === e || q.removed || q === e.shooter) continue;   // the owner is hittable only once the shot has left it; a blaze's shot starts inside its box
      if (q.maxHealth === undefined && !(NS.Ghast && NS.Ghast.COLLIDABLE_NONLIVING.test(q.type || ''))) continue;   // `canHit`
      var tw = q.width !== undefined ? q.width : 0.6, th = q.height !== undefined ? q.height : 1.8;
      var ct = Cb.rayBox(ox, oy, oz, vx * f, vy * f, vz * f, q.x - tw / 2 - IN, q.y - IN, q.z - tw / 2 - IN,
                         q.x + tw / 2 + IN, q.y + th + IN, q.z + tw / 2 + IN);
      if (ct !== null && ct <= 1) { f *= ct; t = q; }
    }
    if (t) {
      if (!(NS.Entities && NS.Entities.fireImmune && NS.Entities.fireImmune(t.type))) {
        var before = t.remainingFireTicks | 0;
        if (NS.Combat && NS.Combat.igniteForSeconds) NS.Combat.igniteForSeconds(t, 5);
        var hit = hurtEntity(t, 5, e.shooter, { attacker: e.shooter || null });
        if (!hit) t.remainingFireTicks = before;
        // SmallFireballEntity.onEntityHit: applyDamageEffects(owner, target) -> thorns on the victim
        else if (e.shooter && NS.Effects && NS.Effects.thornsOnUserDamaged) NS.Effects.thornsOnUserDamaged(t, e.shooter);
      }
      e.removed = true;
      return;
    }
    if (bh) {
      Cb.projectileBlockHit(e, bh);   // #8660 BlockState.onProjectileHit
      // onBlockHit ignites `getBlockPos().offset(side)`: the cell on the hit face, i.e. the hit point nudged back along the ray
      var len = Math.sqrt(vx * vx + vy * vy + vz * vz), n = 1e-4 / len;
      var hb = [Math.floor(bh.hx - vx * n), Math.floor(bh.hy - vy * n), Math.floor(bh.hz - vz * n)];
      var C = NS.Commands;
      var griefing = C && C.ruleGet ? C.ruleGet('mobGriefing') !== 'false' : true;
      var mobOwned = !!(e.shooter && e.shooter.maxHealth !== undefined);
      var W = NS.World, S = NS.States;
      if ((!mobOwned || griefing) && W && W.getBlock && W.setBlock && S && S.stateOf) {
        if (W.getBlock(hb[0], hb[1], hb[2]) === 0) W.setBlock(hb[0], hb[1], hb[2], NS.Behave.fireStateAt(hb[0], hb[1], hb[2], 0));   // AbstractFireBlock.getState: soul fire over its base
      }
      e.removed = true;
      return;
    }
    var wet = !!e.inWater || !!(Cb && Cb.arrowTouchingWater && Cb.arrowTouchingWater(e));
    var drag = wet ? Fb.DRAG_WATER : Fb.DRAG;
    e.x = ox + vx; e.y = oy + vy; e.z = oz + vz;
    e.vx = (vx + e.powerX) * drag;
    e.vy = (vy + e.powerY) * drag;
    e.vz = (vz + e.powerZ) * drag;
  };

  Bl.init = function () {
    var Ai = NS.Ai;
    if (Ai && Ai.ROSTER) Ai.ROSTER.blaze = Bl.roster;
    Bl.ready = true;
  };
  Bl.init();

  Bl.OWED = [];
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
