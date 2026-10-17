// 07zzd_throw.js — QUEUE 0.2 G18c "left: ender pearl" / Use.OWED's own "throwables (snowball,
// egg, ender pearl, splash potion) — G22/G23" line, struck below. THE PLAYER'S OWN RIGHT-CLICK
// THROW for the five items whose `Item.use()` spawns a live projectile rather than editing a
// block or opening a screen: `SnowballItem`/`EggItem`/`EnderPearlItem`/`SplashPotionItem`/
// `LingeringPotionItem` (`.decomp/net/minecraft/item/*.java`, all five read in full).
//
// ⚠⚠ WHAT IS REUSED, NOT DUPLICATED. The snowball's own in-flight consequence is
// `Combat.tickSnowball` (14j_combat.js, loop/snowgolem's own substrate — 3 damage to a blaze, 0
// but a knockback to anything else, discard on any hit); the splash/lingering potion's own
// `potion` entity, splash math and now the lingering AreaEffectCloud substrate are
// `NS.Potion`'s (07z_potion.js, loop/witchpotion-s95 plus loop/throwables-s116's own addition).
// This file is only: the ITEM-side `use()` (aim, spawn, cooldown, stack decrement) for all five,
// plus the two consequences neither existing substrate had a home for — the egg's chicken hatch
// and the ender pearl's owner teleport (`EggEntity`/`EnderPearlEntity.onCollision`, both
// `.decomp/net/minecraft/entity/projectile/thrown/*.java`, both read in full).
//
// Runs on: MAIN THREAD ONLY. No DOM, no GL — same standing as `14l_use.js`, which calls into
// this file's `Throw.use` as its own right-click fallback (see that file's `Use.rightClick`).
(function (NS) {
  'use strict';

  var Th = NS.Throw = { ready: true };   // self-contained, like NS.Potion — no init() needed

  /**
   * `SnowballItem.use`/`EggItem.use`/`EnderPearlItem.use` all spawn their entity off the SAME
   * `ThrownEntity(World, LivingEntity)` ctor (`.decomp` ThrownEntity.java:24-27, the one
   * `Cb.mobShootSnowball`'s own header already cites for the golem's own snowball) and the SAME
   * `setVelocity(user, pitch, yaw, 0.0F, 1.5F, 1.0F)` call; `ThrowablePotionItem.use` (the
   * common parent of Splash/LingeringPotionItem) spawns `potion` with `setVelocity(user, pitch,
   * yaw, -20.0F, 0.5F, 1.0F)` — a SHALLOWER-arc toss at a third the speed. Every entry in this
   * table is `{ entity, speed }`. ⚠⚠ struck s117: the `-20.0F` pitch-offset argument IS now
   * reconstructed, WITHOUT the missing `ProjectileEntity.setVelocity` class -- `pitchOffset`
   * below feeds `Th.use`'s own small trig substitute (not `P.lookVec()` for the vertical axis
   * alone): vanilla computes the Y component off `-sin((pitch_vanilla + pitchOffset) * deg2rad)`
   * while X/Z stay off `pitch_vanilla` alone (`ProjectileEntity.setVelocity`'s own formula,
   * SAME missing-class gap `Use.bowStart`'s own header still names for the bow's own X/Z/Y-
   * shared case, offset 0 there). `D-343`'s own engine convention (`14_player.js`:493,
   * "vanilla's pitch is positive DOWN", this engine's `P.pitch` positive UP) turns that into
   * `sin(P.pitch - pitchOffset_vanilla_rad)` — derivation in `Th.use` below, and the SAME
   * expression collapses to plain `sin(P.pitch)` (== `P.lookVec()`'s own `f[1]`,
   * `10_camera.js:80`) when `pitchOffset` is 0, so snowball/egg/ender_pearl are unchanged.
   *
   * `sound`/`category` are each item's own `World.playSound` call (.decomp, every file read in
   * full): `SoundCategory.field_15248` == PLAYERS (`player`, `.decomp/net/minecraft/entity/
   * player/PlayerEntity.java:427` — `getSoundCategory()` returns it for a player), `field_15254`
   * == NEUTRAL (`neutral`) — see `.decomp/net/minecraft/sound/SoundCategory` field order via
   * `names.tsv` (`ahl a..j` == MASTER..VOICE, matching `Sound.SOURCES`' own order). ⚠
   * `lingering_potion`'s own `entity.lingering_potion.throw` is a real jar event
   * (`.mcsnd/sounds.json`) but is NOT in `tools/pack-sounds.mjs`'s own `ENTITY_KEEP` regex (no
   * `lingering_potion` alternative there) — named here rather than silently extending the pack;
   * `Th.use` still calls it, and `Sound.missed` is what counts the silent miss.
   */
  Th.ITEMS = {
    snowball:          { entity: 'snowball',    speed: 1.5, pitchOffset: 0,
                          sound: 'entity.snowball.throw',         category: 'neutral' },
    egg:                { entity: 'egg',         speed: 1.5, pitchOffset: 0,
                          sound: 'entity.egg.throw',              category: 'player' },
    ender_pearl:        { entity: 'ender_pearl', speed: 1.5, pitchOffset: 0,
                          sound: 'entity.ender_pearl.throw',      category: 'neutral' },
    experience_bottle:  { entity: 'experience_bottle', speed: 0.7, pitchOffset: -20,
                          sound: 'entity.experience_bottle.throw', category: 'neutral' },
    splash_potion:      { entity: 'potion',      speed: 0.5, lingering: false, pitchOffset: -20,
                          sound: 'entity.splash_potion.throw',    category: 'player' },
    lingering_potion:   { entity: 'potion',      speed: 0.5, lingering: true,  pitchOffset: -20,
                          sound: 'entity.lingering_potion.throw', category: 'neutral' }
  };
  Th.DIVERGENCE = 1.0;             // every one of the five `1.0F` literals above, alike
  Th.THROW_VOLUME = 0.5;           // every one of the five `playSound(...)` calls' own `0.5F`
  // `0.4F / (random.nextFloat()*0.4F + 0.8F)` -- the SAME pitch formula on all five (.decomp,
  // every file's own `use()`), NOT `S.PITCH_JITTER`'s block-sound formula (`S.entitySound`'s
  // own header).
  Th.throwPitch = function (rnd) { return 0.4 / ((rnd ? rnd() : NS.wrand()) * 0.4 + 0.8); };

  // `EnderPearlItem.use`: `player.getItemCooldownManager().set(this, 20)` — the one item this
  // engine's right-click has ever needed a cooldown for, so it is one field rather than a
  // general-purpose `ItemCooldownManager` this engine otherwise has no caller for.
  Th.PEARL_COOLDOWN = 20;

  /**
   * The throw itself — `SnowballItem`/`EggItem`/`EnderPearlItem`/`ThrowablePotionItem.use`
   * (.decomp, all four read in full; `SplashPotionItem`/`LingeringPotionItem` each add only a
   * sound before delegating to their shared parent's `use`, not modelled here — see this file's
   * own header on sound). Called from `Use.rightClick`'s own plain-`Item.use()` fallback slot,
   * the SAME one `Use.bowStart`/`Use.pigBoostOnAStick` already occupy — tried only once nothing
   * targeted (block/entity/placement) already consumed the click.
   */
  Th.use = function (P, stack) {
    if (!Th.ready || !P || !stack) return false;
    var IT = NS.Items, Iv = NS.Inventory, EL = NS.EntityList, Cb = NS.Combat;
    if (!IT || !IT.ready || !Iv || !EL || !EL.ready || !Cb) return false;
    var name = IT.nameOf(stack.i | 0);
    var def = name ? Th.ITEMS[name] : null;
    if (!def) return false;                       // ActionResult.PASS — not one of the five
    if (name === 'ender_pearl' && (P.pearlCooldown | 0) > 0) return false;   // ItemCooldownManager
    if (!EL.canSpawn(def.entity)) return false;

    // ── `ProjectileEntity.setVelocity` reconstructed off `P.lookVec()`, the SAME formula
    // `Use.bowStart`'s own header already cites and names as a substitution (no `.decomp`
    // source for the real method exists in this worktree). ─────────────────────────────────
    var f = P.lookVec ? P.lookVec() : [0, 0, -1];
    var rnd = NS.wrand;
    var g = Cb.ARROW_GAUSS_SCALE * Th.DIVERGENCE, speed = def.speed;
    // struck s117: the potion's own `-20.0F` pitchOffset (`Th.ITEMS`'s own header has the
    // derivation) -- Y alone is rebuilt off `P.pitch` with the offset folded in; X/Z stay off
    // `f[0]`/`f[2]` (`P.lookVec()`'s own values), matching `ProjectileEntity.setVelocity`'s own
    // formula using plain `pitch` for X/Z and `pitch+pitchOffset` for Y alone. `pitchOffset`
    // is 0 for snowball/egg/ender_pearl, so `vyDir` there is exactly `sin(P.pitch)` == `f[1]`.
    var pitchOffsetRad = (def.pitchOffset || 0) * Math.PI / 180;
    var vyDir = (typeof P.pitch === 'number') ? Math.sin(P.pitch - pitchOffsetRad) : f[1];
    var vx = (f[0] + Cb.gauss(rnd) * g) * speed;
    var vy = (vyDir + Cb.gauss(rnd) * g) * speed;
    var vz = (f[2] + Cb.gauss(rnd) * g) * speed;
    // `ProjectileEntity.setVelocity`'s own tail: the thrower's OWN motion added on top, vertical
    // dropped while grounded — the identical line `Use.bowRelease` already applies for an arrow.
    vx += P.vx || 0; vy += (P.onGround ? 0 : (P.vy || 0)); vz += P.vz || 0;

    // `ThrownEntity(World, LivingEntity)` ctor: `setPos(x, getEyeY() - 0.1F, z)` — the same
    // `Cb.ARROW_SPAWN_BELOW_EYE` literal the bow's own spawn height already reuses.
    var ax = P.ex, ay = (P.ey + (P.eyeHeight || P.EYE || 1.62)) - Cb.ARROW_SPAWN_BELOW_EYE, az = P.ez;

    var opts = { vx: vx, vy: vy, vz: vz, shooter: P, item: stack.i | 0 };
    if (def.entity === 'potion') {
      var tag = Iv.tagOf ? Iv.tagOf(stack) : null;
      var tip = NS.Potion && NS.Potion.tipFromTag ? NS.Potion.tipFromTag(tag) : null;
      // `PotionUtil.getPotion(stack)` — a stack with no recognised `Potion` tag (a plain "Water
      // Bottle" splash) carries no potionId; `Po.applySplashPotion`/`Po.applyLingeringPotion`
      // both already no-op on that (07z_potion.js's own `Po.OWED`, the water-splash branch).
      opts.potionId = tip && tip.potionId ? tip.potionId : null;
      if (tip && tip.custom) opts.custom = tip.custom;
      opts.lingering = !!def.lingering;
    }
    var e = EL.spawn(def.entity, ax, ay, az, opts);
    if (!e) return false;

    // struck s117: `Th.OWED`'s own "this file plays none" line -- each item's own
    // `World.playSound(null, player.x/y/z, event, category, 0.5F, 0.4F/(rand*0.4F+0.8F))`
    // (.decomp, every one of the five `use()`s read in full; `Th.ITEMS`'s own header has the
    // event/category citations). `null` first arg means every nearby player hears it including
    // the thrower, so this engine's own listener IS the thrower (`P`, the SAME object
    // `14_player.js:883`'s own `NS.Sound.blockBreak(..., P)` already passes as listener).
    var S = NS.Sound;
    if (S && S.entitySound && def.sound) {
      S.entitySound(def.sound, P.x, P.y, P.z, Th.THROW_VOLUME, Th.throwPitch(rnd), def.category, P);
    }

    if (name === 'ender_pearl') P.pearlCooldown = Th.PEARL_COOLDOWN;
    // `ItemStack.decrement(1)`, skipped in creative — `Player.getAbilities().creativeMode`, the
    // SAME `P.instabuild` gate `Use.damage`/`Use.bowRelease` already use.
    if (!P.instabuild && Iv.shrink) {
      Iv.shrink(stack, 1);
      Iv.setItem(P.inventory, P.slot, stack);        // collapses to EMPTY at n<=0 (Inv.setItem)
      if (P.syncHotbar) P.syncHotbar();
    }
    return true;
  };

  /**
   * EnderEyeItem.use's world half (.decomp): locateStructure(STRONGHOLD, pos, 100, false); none -> PASS.
   * Spawns the eye at eye height (getBodyY(0.5)), initTargetPos, shrink unless creative.
   * (The block-hit deferral is the caller's: this runs in the plain-use fallback slot.)
   */
  Th.useEye = function (P, stack) {
    var IT = NS.Items, Iv = NS.Inventory, EL = NS.EntityList, ST = NS.Structures;
    if (!IT || !EL || !EL.ready || !ST || !stack || IT.nameOf(stack.i | 0) !== 'ender_eye') return false;
    var tgt = ST.locateStructure('eye_of_ender_located', Math.floor(P.x), Math.floor(P.z), 100);
    if (!tgt) return false;
    var e = EL.spawn('eye_of_ender', P.x, P.y + (P.eyeHeight || P.EYE || 1.62), P.z, { item: stack.i | 0 });
    if (!e) return false;
    Th.eyeInit(e, tgt.x, tgt.y, tgt.z);
    if (NS.Adv && P.advancements) {   // EnderEyeItem.use: Criteria.USED_ENDER_EYE.trigger(player, BlockPos of the stronghold)
      var bx = Math.floor(tgt.x), bz = Math.floor(tgt.z), ddx = P.x - bx, ddz = P.z - bz;
      NS.Adv.trigger(P, 'minecraft:used_ender_eye', { player: P, distSq: ddx * ddx + ddz * ddz });
    }
    if (!P.instabuild && Iv && Iv.shrink) {
      Iv.shrink(stack, 1);
      Iv.setItem(P.inventory, P.slot, stack);
      if (P.syncHotbar) P.syncHotbar();
    }
    return true;
  };

  /** EyeOfEnderEntity.initTargetPos. */
  Th.eyeInit = function (e, tx, ty, tz) {
    var dx = tx - e.x, dz = tz - e.z, d = Math.sqrt(dx * dx + dz * dz);
    if (d > 12.0) { e.tx = e.x + dx / d * 12.0; e.tz = e.z + dz / d * 12.0; e.ty = e.y + 8.0; }
    else { e.tx = tx; e.ty = ty; e.tz = tz; }
    e.lifespan = 0;
    e.dropsItem = Math.floor((NS.EntityList.random || NS.wrand)() * 5) > 0;
  };

  /** EyeOfEnderEntity.tick (server half): velocity lerps toward the target, 80 ticks, then drop (80%) or break (event 2003). */
  Th.tickEye = function (e) {
    if (!e || e.removed) return;
    // EyeOfEnderEntity field defaults (.decomp): targetX/Y/Z = 0, lifespan = 0, dropsItem = false until initTargetPos (a /summoned eye flies to the origin)
    if (e.tx === undefined) { e.tx = 0; e.ty = 0; e.tz = 0; e.lifespan = 0; e.dropsItem = false; }
    var EL = NS.EntityList, f = Math.fround;
    var nx = e.x + e.vx, ny = e.y + e.vy, nz = e.z + e.vz;
    var h = Math.sqrt(e.vx * e.vx + e.vz * e.vz);
    var ddx = e.tx - nx, ddz = e.tz - nz;
    var dist = f(Math.sqrt(ddx * ddx + ddz * ddz)), ang = f(Math.atan2(ddz, ddx));
    var sp = h + (dist - h) * 0.0025, vy = e.vy;
    if (dist < 1.0) { sp *= 0.8; vy *= 0.8; }
    var dir = e.y < e.ty ? 1 : -1;
    e.vx = Math.cos(ang) * sp; e.vz = Math.sin(ang) * sp; e.vy = vy + (dir - vy) * f(0.015);
    e.x = nx; e.y = ny; e.z = nz;
    if (++e.lifespan > 80) {
      e.removed = true;
      if (NS.Sound && NS.Sound.entitySound) NS.Sound.entitySound('entity.ender_eye.death', e.x, e.y, e.z, 1.0, 1.0, 'neutral');
      if (e.dropsItem) { if (EL.dropStack) EL.dropStack(e.x, e.y, e.z, e.item, 1); }
      else if (NS.Particle && NS.Particle.worldEvent) NS.Particle.worldEvent(2003, e.x, e.y, e.z);
    }
  };

  /**
   * `ExperienceBottleEntity.onCollision` (.decomp, read whole): on ANY collision, world event 2002
   * (splash, colour of the water potion) then `3 + nextInt(5) + nextInt(5)` XP as orbs at the
   * bottle's position, discard. Same hit test as `Th.tickEgg`.
   */
  Th.tickBottle = function (e) {
    if (!e || e.removed) return;
    var EL = NS.EntityList;
    if (!EL || !EL.list) return;
    var hit = false;
    for (var i = 0; i < EL.list.length; i++) {
      var t = EL.list[i];
      if (t === e || t.removed || t === e.shooter || t.maxHealth === undefined) continue;
      var tw = t.width !== undefined ? t.width : 0.6, th = t.height !== undefined ? t.height : 1.8;
      if (Math.abs(e.x - t.x) <= tw / 2 + 0.25 && Math.abs(e.z - t.z) <= tw / 2 + 0.25 &&
          e.y >= t.y - 0.25 && e.y <= t.y + th + 0.25) { hit = true; break; }
    }
    if (!hit && !e.onGround && !e.horizontalCollision && !e.verticalCollision) return;
    var rnd = (EL.random || NS.wrand);
    // syncWorldEvent(2002, getBlockPos(), PotionUtil.getColor(Potions.WATER)): the empty-effects colour, 3694022
    var bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z), Px = NS.Particle;
    Th.lastBottleEvent = { id: 2002, x: bx, y: by, z: bz, color: 3694022 };
    if (Px && Px.spawnPotionSplash) Px.spawnPotionSplash(bx, by, bz, 3694022, false);   // client particles: own rng, never the server roll
    var xp = 3 + Math.floor(rnd() * 5) + Math.floor(rnd() * 5);
    if (NS.Xp && NS.Xp.spawn) NS.Xp.spawn(e.x, e.y, e.z, xp, rnd);
    e.removed = true;
  };

  /** `EnderPearlItem.use`'s own 20-tick cooldown, ticked once a real 20 Hz tick (P.tick). */
  Th.tickCooldown = function (P) {
    if (P && P.pearlCooldown > 0) P.pearlCooldown--;
  };

  /**
   * `EggEntity.onCollision` (.decomp :53-72, read whole): on ANY collision (entity or ground,
   * the SAME `!hitEntity && !onGround` guard `Cb.tickSnowball`/`Po.tick` already use), 1-in-8
   * to hatch a chicken, and 1-in-32 OF THAT roll (so 1-in-256 overall) to hatch four instead of
   * one — `EggEntity`'s own nested `if (random.nextInt(32) == 0) count = 4`. Each chick is
   * `ChickenEntity.setBreedingAge(-24000)`, the same baby-start age `Breed.setBaby` already
   * names (07m_breed.js's own `C.babyStartAge`), spawned at the egg's own position/yaw with
   * pitch forced to 0 (`refreshPositionAndAngles(..., yaw, 0.0F)`). The zero-damage
   * `onEntityHit` (`damage(DamageSource.thrownProjectile(...), 0.0F)`) is the SAME
   * knockback-only, no-hurt consequence `Cb.hurtZero` already models for the snowball's own
   * non-blaze branch — reused rather than a second copy.
   */
  Th.tickEgg = function (e) {
    if (!e || e.removed) return;
    var EL = NS.EntityList, Cb = NS.Combat;
    if (!EL || !EL.list) return;
    var hitEntity = null;
    for (var i = 0; i < EL.list.length; i++) {
      var t = EL.list[i];
      if (t === e || t.removed || t === e.shooter || t.maxHealth === undefined) continue;
      var tw = t.width !== undefined ? t.width : 0.6, th = t.height !== undefined ? t.height : 1.8;
      if (Cb && Cb.thrownSweepHits ? Cb.thrownSweepHits(e, t, tw, th) : (Math.abs(e.x - t.x) <= tw / 2 + 0.25 && Math.abs(e.z - t.z) <= tw / 2 + 0.25 &&
          e.y >= t.y - 0.25 && e.y <= t.y + th + 0.25)) { hitEntity = t; break; }
    }
    if (!hitEntity && !e.onGround && !e.horizontalCollision && !e.verticalCollision) return;
    if (NS.GameEvent) NS.GameEvent.emit('projectile_land', e.x, e.y, e.z, e.shooter);
    if (!hitEntity && Cb && Cb.projectileTargetHit) Cb.projectileTargetHit(e, false);   // #5609
    if (hitEntity && Cb && Cb.hurtZero) Cb.hurtZero(hitEntity, e.shooter || e);
    var rnd = (EL.random || NS.wrand);
    // struck s117: `EggEntity.handleStatus(3)`'s own 8-particle burst -- fires on EVERY
    // collision (`onCollision`'s own `world.sendEntityStatus(this, (byte)3)` call sits AFTER
    // the hatch roll but is unconditional, .decomp :64-71), not gated on the hatch itself.
    // ⚠ A SEPARATE RANDOM SOURCE, ON PURPOSE: `handleStatus`'s own particle roll is
    // `this.random` on the CLIENT (`EggEntity.java:34-40`), a different `java.util.Random`
    // instance from the hatch roll's own SERVER `this.random` (`onCollision`, :58-63) -- two
    // real streams in the jar. Feeding it `rnd`/`EL.random` here would also silently break
    // `throwcheck.mjs` §5's own pinned `calls.shift()` sequence for the hatch roll (extra
    // draws ahead of the two it expects), which is the SAME reason to keep them apart.
    if (NS.Particle && NS.Particle.spawnEggBurst) NS.Particle.spawnEggBurst(e.x, e.y, e.z);
    if (Math.floor(rnd() * 8) === 0) {
      var count = (Math.floor(rnd() * 32) === 0) ? 4 : 1;
      for (var c = 0; c < count; c++) {
        if (!EL.canSpawn('chicken')) break;
        var chick = EL.spawn('chicken', e.x, e.y, e.z, {});
        if (chick) {
          chick.yaw = e.yaw || 0;
          if (NS.Breed && NS.Breed.setBaby) NS.Breed.setBaby(chick, true);
        }
      }
    }
    e.removed = true;
  };

  /**
   * `EnderPearlEntity.onCollision` (.decomp :43-80, read whole), the PLAYER-owner branch only
   * (`instanceof ServerPlayerEntity`) — the ONLY owner this engine's `EL.spawn`'s own `shooter`
   * field is ever a player rather than a mob (`Use.rightClick` is the one caller). Order is the
   * source's own: the 5% endermite roll (gated on `doMobSpawning`, `Commands.ruleGet`'s own
   * string-compare precedent — `07zk_undead.js`'s `Undead.trySpawnZombifiedPiglin`-adjacent
   * `doMobSpawning` gate), THEN the teleport (`requestTeleport` — a straight position write,
   * this engine's own `P.x/y/z` with `P.px/py/pz`/`P.ex/ey/ez` kept in lock-step so the very
   * next frame does not interpolate a half-teleport), THEN `onLanding()` (`P.fallDistance = 0`)
   * and the flat 5 fall damage (`Sv.hurt(P, 'fall', 5)` — the SAME `fall` damage row
   * `14d_survival.js`'s own table already carries, bypasses armor exactly as real fall damage
   * does). ⚠ END GATEWAYS ARE OUT OF SCOPE (named, not silently skipped): this engine has no
   * end-gateway block at all, so `EnderPearlEntity`'s own (unwritten, in 1.18.2) gateway
   * special-case simply never arises here.
   */
  Th.tickPearl = function (e) {
    if (!e || e.removed) return;
    var EL = NS.EntityList;
    if (!EL || !EL.list) return;
    var hitEntity = null;
    for (var i = 0; i < EL.list.length; i++) {
      var t = EL.list[i];
      if (t === e || t.removed || t === e.shooter || t.maxHealth === undefined) continue;
      var tw = t.width !== undefined ? t.width : 0.6, th = t.height !== undefined ? t.height : 1.8;
      if (Math.abs(e.x - t.x) <= tw / 2 + 0.25 && Math.abs(e.z - t.z) <= tw / 2 + 0.25 &&
          e.y >= t.y - 0.25 && e.y <= t.y + th + 0.25) { hitEntity = t; break; }
    }
    if (!hitEntity && !e.pearlHit) return;
    // struck s117: `EnderPearlEntity.onCollision`'s own 32-particle trail -- the source's OWN
    // `for` loop runs BEFORE the `!world.isClient` owner-teleport branch below and regardless
    // of owner type (.decomp :44-53), so it is unconditional here too. Own random source, same
    // client/server-stream reasoning as `Th.tickEgg`'s own particle call just above -- keeps
    // `throwcheck.mjs` §6's own pinned `EL.random`/endermite-roll sequence untouched.
    if (NS.Particle && NS.Particle.spawnPearlBurst) NS.Particle.spawnPearlBurst(e.x, e.y, e.z);
    var owner = e.shooter;
    if (owner === NS.Player) {
      var C = NS.Commands;
      var doMobSpawning = !(C && C.ruleGet && String(C.ruleGet('doMobSpawning')) === 'false');
      var rnd = (EL.random || NS.wrand);
      if (doMobSpawning && rnd() < 0.05 && EL.canSpawn('endermite')) {
        var mite = EL.spawn('endermite', owner.x, owner.y, owner.z, {});
        if (mite) mite.yaw = owner.yaw || 0;
      }
      owner.x = e.x; owner.y = e.y; owner.z = e.z;
      owner.px = owner.x; owner.py = owner.y; owner.pz = owner.z;
      owner.ex = owner.x; owner.ey = owner.y; owner.ez = owner.z;
      owner.fallDistance = 0;                              // Entity.onLanding()
      if (NS.Survival && NS.Survival.hurt) NS.Survival.hurt(owner, 'fall', 5);
    }
    e.removed = true;
  };

  // ── STRUCK: QUEUE 0.2 G18c "left: ender pearl" and Use.OWED's own throwables row (both
  // struck at their own list, 14l_use.js) — snowball/egg/ender_pearl/splash_potion/
  // lingering_potion all now throw, land, and (egg/pearl) resolve their own consequence.
  // struck s117 (all three): sound (`S.entitySound`, `Th.ITEMS`'s own event/category table),
  // the potion's own `-20.0F` pitch-offset arc (`Th.use`'s own `vyDir` derivation, `Th.ITEMS`'s
  // header), and the egg/pearl particle bursts (`Px.spawnEggBurst`/`Px.spawnPearlBurst`,
  // 07zx_particle.js, called from `Th.tickEgg`/`Th.tickPearl`). `Th.OWED` is now empty; kept
  // as an array (not deleted) the same way struck `*.OWED` lists elsewhere in this codebase
  // stay declared at `[]` rather than removed, so a later `grep -n "\.OWED"` sweep still finds
  // the symbol and its history in this file's own git log, not a silent disappearance.
  Th.OWED = [];

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
