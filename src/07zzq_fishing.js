// 07zzq_fishing.js — G17-F1: `FishingRodItem.use` (.decomp FishingRodItem.java) and the
// `FishingBobberEntity(PlayerEntity, World, luck, lure)` constructor (FishingBobberEntity.java:75-100).
// Cast: throw sound, spawn one `fishing_bobber` at 0.6 x look vector, `player.fishHook` set.
// Second use with a hook out: the retrieve sound and the bobber removed. The reel-in
// (catch, damage, hooked entity) is F4 and not here.
// Runs on: MAIN THREAD ONLY. Reads EL/Combat/Sound live via NS.*, like 07zzd_throw.js.
(function (NS) {
  'use strict';

  var Fi = NS.Fishing = { ready: true };

  Fi.SPEED = 0.6;            // FishingBobberEntity ctor: 0.6 / length
  Fi.GAUSS = 0.0045;         // ... + 0.5 + nextGaussian() * 0.0045
  Fi.CAST_SOUND = 'entity.fishing_bobber.throw';       // SoundEvents.field_14596
  Fi.RETRIEVE_SOUND = 'entity.fishing_bobber.retrieve';   // SoundEvents.field_15093
  Fi.CAST_VOLUME = 0.5;
  Fi.RETRIEVE_VOLUME = 1.0;

  /** Velocity of a fresh bobber for vanilla yaw/pitch in degrees (pitch positive DOWN). */
  Fi.velocity = function (yawDeg, pitchDeg, gauss) {
    var D = Math.PI / 180;
    var f6 = Math.cos(-yawDeg * D - Math.PI), f7 = Math.sin(-yawDeg * D - Math.PI);
    var f8 = -Math.cos(-pitchDeg * D), f9 = Math.sin(-pitchDeg * D);
    var vx = -f7, vy = Math.max(-5, Math.min(5, -(f9 / f8))), vz = -f6;
    var len = Math.sqrt(vx * vx + vy * vy + vz * vz);
    var g = gauss || function () { return 0; };
    return [vx * (Fi.SPEED / len + 0.5 + g() * Fi.GAUSS),
            vy * (Fi.SPEED / len + 0.5 + g() * Fi.GAUSS),
            vz * (Fi.SPEED / len + 0.5 + g() * Fi.GAUSS)];
  };

  function sound(P, ev, vol, rnd) {
    var S = NS.Sound;
    if (S && S.entitySound) S.entitySound(ev, P.x, P.y, P.z, vol, 0.4 / ((rnd ? rnd() : Math.random()) * 0.4 + 0.8), 'neutral', P);
  }

  /** `FishingRodItem.use`: true when it acted (the caller swings the hand). */
  Fi.use = function (P, stack) {
    var IT = NS.Items, EL = NS.EntityList, Cb = NS.Combat;
    if (!P || !stack || !IT || !IT.ready || !EL || !EL.ready || IT.nameOf(stack.i | 0) !== 'fishing_rod') return false;
    var hook = P.fishHook;
    if (hook && hook.removed) hook = P.fishHook = null;
    if (hook) {
      var dmg = Fi.reel(hook, P, stack);
      if (hook.removed === undefined || !hook.removed) EL.remove(hook);
      P.fishHook = null;
      if (dmg > 0 && NS.Use && NS.Use.damage) NS.Use.damage(P, stack, dmg);
      sound(P, Fi.RETRIEVE_SOUND, Fi.RETRIEVE_VOLUME);
      return true;
    }
    if (!EL.canSpawn('fishing_bobber')) return false;
    sound(P, Fi.CAST_SOUND, Fi.CAST_VOLUME);
    var lure = Cb && Cb.enchantLevel ? Cb.enchantLevel(stack, 'lure') : 0;
    var luck = Cb && Cb.enchantLevel ? Cb.enchantLevel(stack, 'luck_of_the_sea') : 0;
    // engine yaw/pitch -> vanilla: forward = (sin y, sin p, -cos y) vs (-sin yv, -sin pv, cos yv).
    var yv = ((P.yaw || 0) - Math.PI) * 180 / Math.PI, pv = -(P.pitch || 0) * 180 / Math.PI;
    var D = Math.PI / 180;
    var f6 = Math.cos(-yv * D - Math.PI), f7 = Math.sin(-yv * D - Math.PI);
    var v = Fi.velocity(yv, pv, Cb && Cb.gauss ? function () { return Cb.gauss(Math.random); } : null);
    var e = EL.spawn('fishing_bobber', P.ex - f7 * 0.3, P.ey + (P.eyeHeight || P.EYE || 1.62), P.ez - f6 * 0.3,
      { vx: v[0], vy: v[1], vz: v[2], shooter: P });
    if (!e) return false;
    e.vx = v[0]; e.vy = v[1]; e.vz = v[2];
    e.owner = P; e.lureLevel = Math.max(0, lure); e.luckOfTheSeaLevel = Math.max(0, luck);
    P.fishHook = e;
    return true;
  };

  // ---- G17-F4: FishingBobberEntity.use (FishingBobberEntity.java:438-486). Returns the rod damage:
  // 5 hooked entity (3 if it is an item), 1 a catch, 2 bobber on the ground, else 0. The caller damages and discards.
  // env.biome / env.openWater / env.rng are optional (rng defaults to the bobber's JRandom).
  // Criteria.FISHING_ROD_HOOKED.trigger(player, rod, bobber, caught) -- subject is the hooked entity, else the bobber
  function fire(P, stack, e, hooked, caught) {
    if (!NS.Adv || !NS.Adv.trigger || !P || !P.advancements) return;
    var IT = NS.Items, rod = stack && IT ? { id: IT.nameOf(stack.i | 0), count: stack.n || stack.count || 1 } : null;
    NS.Adv.trigger(P, 'minecraft:fishing_rod_hooked', { player: P, rod: rod, entity: hooked || e, caught: caught });
  }
  Fi.reel = function (e, P, stack, env) {
    env = env || {};
    var EL = NS.EntityList, IT = NS.Items, Lt = NS.Loot, dmg = 0;
    var r = e.random || { nextInt: function (n) { return Math.floor(Math.random() * n); }, nextFloat: Math.random };
    if (e.hookedEntity) {
      var h = e.hookedEntity;      // pullHookedEntity: velocity += (owner - entity) * 0.1
      h.vx = (h.vx || 0) + (P.x - e.x) * 0.1; h.vy = (h.vy || 0) + (P.y - e.y) * 0.1; h.vz = (h.vz || 0) + (P.z - e.z) * 0.1;
      dmg = h.type === 'item' ? 3 : 5;
      fire(P, stack, e, h, []);
      if (NS.EntityList && NS.EntityList.status) NS.EntityList.status(e, 31);   // sendEntityStatus(this, 31)
    } else if (e.hookCountdown > 0) {
      var luck = (e.luckOfTheSeaLevel | 0) + (P.luck || 0);
      var ctx = { rng: r, luck: luck, item: stack && IT ? IT.nameOf(stack.i | 0) : '', x: e.x, y: e.y, z: e.z,
        openWater: env.openWater !== undefined ? env.openWater : !!e.openWater, biome: env.biome || e.biome || '' };
      var loot = Lt && Lt.rollTable ? Lt.rollTable('gameplay/fishing', ctx) : [];
      fire(P, stack, e, null, loot.map(function (l) { return { id: String(l.item).replace(/^minecraft:/, ''), count: l.count, nbt: l.nbt }; }));
      for (var i = 0; i < loot.length; i++) {
        var st = loot[i];
        var dx = P.x - e.x, dy = P.y - e.y, dz = P.z - e.z;
        var id = IT && IT.of ? IT.of(st.item) : st.item;
        EL.dropStack(e.x, e.y, e.z, id, st.count, { vx: dx * 0.1, vy: dy * 0.1 + Math.sqrt(Math.sqrt(dx * dx + dy * dy + dz * dz)) * 0.08, vz: dz * 0.1, pickupDelay: 10, d: st.d, tag: st.nbt || undefined });
        var orb = EL.spawn('experience_orb', P.x, P.y + 0.5, P.z + 0.5);
        if (orb) orb.value = r.nextInt(6) + 1;
        if (NS.Tags && NS.Tags.itemIn && NS.Tags.itemIn('fishes', st.item) && NS.Stats && NS.Stats.inc) NS.Stats.inc('fish_caught');
      }
      dmg = 1;
    }
    if (e.onGround) dmg = 2;
    return dmg;
  };

  // ---- G17-F2: FishingBobberEntity.tick (FishingBobberEntity.java:139-250) ----
  // Not F3 (tickFishingLogic) nor F4 (use/reel-in). Not yet called from EL.tick: wiring waits for F3 so the
  // bobber is not moved twice. `env` = { fluidHeight(bx,by,bz) -> 0..1 water height or 0, move(e,dx,dy,dz)
  // -> sets e.x/y/z, e.onGround, e.horizontalCollision, time, rnd() }; defaults read NS.World.
  Fi.FLYING = 0; Fi.HOOKED_IN_ENTITY = 1; Fi.BOBBING = 2;   // State.field_7180/7178/7179 (declaration order FLYING, HOOKED, BOBBING)
  Fi.DRAG = 0.92; Fi.GRAVITY = 0.03; Fi.MAX_DIST_SQ = 1024.0; Fi.REMOVAL_TICKS = 1200;

  /** removeIfInvalid: true (and the bobber discarded) when owner gone/dead, rod in neither hand, or > 32 blocks. */
  Fi.removeIfInvalid = function (e, P) {
    var IT = NS.Items;
    var isRod = function (st) { return !!(st && IT && IT.nameOf(st.i | 0) === 'fishing_rod'); };
    var main = P && P.inventory && NS.Inventory ? NS.Inventory.getItem(P.inventory, P.slot | 0) : null;
    var off = P && P.offhand !== undefined ? P.offhand : null;
    var dx = e.x - P.x, dy = e.y - P.y, dz = e.z - P.z;
    if (!P.removed && !P.dead && (isRod(main) || isRod(off)) && !(dx * dx + dy * dy + dz * dz > Fi.MAX_DIST_SQ)) return false;
    e.removed = true;
    return true;
  };

  /** onBlockHit: velocity = normalize(v) * squaredDistance(hit position, bobber). */
  Fi.onBlockHit = function (e, hx, hy, hz) {
    var d = (hx - e.x) * (hx - e.x) + (hy - e.y) * (hy - e.y) + (hz - e.z) * (hz - e.z);
    var l = Math.sqrt(e.vx * e.vx + e.vy * e.vy + e.vz * e.vz);
    if (l < 1e-5) { e.vx = e.vy = e.vz = 0; } else { e.vx = e.vx / l * d; e.vy = e.vy / l * d; e.vz = e.vz / l * d; }
  };
  /** onEntityHit (server side): hook the entity. */
  Fi.onEntityHit = function (e, other) { Fi.setHooked(e, other); };
  Fi.setHooked = function (e, other) { e.hookedEntity = other || null; e.hookedId = other ? other.id + 1 : 0; };
  /** checkForCollision: env.collision(e) -> {block:[x,y,z]} | {entity} | null. */
  Fi.checkForCollision = function (e, env) {
    var h = env.collision ? env.collision(e) : null;
    if (!h) return;
    if (h.entity) Fi.onEntityHit(e, h.entity);
    else if (h.block) Fi.onBlockHit(e, h.block[0], h.block[1], h.block[2]);
  };

  // ---- G17-F3: tickFishingLogic (FishingBobberEntity.java:281-380). Draws only from e.random (JRandom), vanilla order.
  // env.hasRain(x,y,z), env.skyVisible(x,y,z), env.isWater(x,y,z), env.particle(name,x,y,z,count,dx,dy,dz,speed),
  // env.sound(ev,vol,pitch) are optional.
  var F = Math.fround, D2R = F(Math.PI / 180);
  var mfNext = function (r, a, b) { return a >= b ? a : F(F(r.nextFloat() * F(b - a)) + a); };
  var miNext = function (r, a, b) { return a >= b ? a : r.nextInt(b - a + 1) + a; };
  Fi.tickFishingLogic = function (e, env, bx, by, bz) {
    var r = e.random, n = 1;
    var particle = env.particle || function () {}, isWater = env.isWater || function () { return true; };
    if (r.nextFloat() < 0.25 && env.hasRain && env.hasRain(bx, by + 1, bz)) n++;
    if (r.nextFloat() < 0.5 && !(env.skyVisible && env.skyVisible(bx, by + 1, bz))) n--;
    if (e.hookCountdown > 0) {
      if (--e.hookCountdown <= 0) { e.waitCountdown = 0; e.fishTravelCountdown = 0; e.caughtFish = false; }
    } else if (e.fishTravelCountdown > 0) {
      e.fishTravelCountdown -= n;
      if (e.fishTravelCountdown > 0) {
        e.fishAngle = F(e.fishAngle + F(r.nextGaussian() * 4.0));
        var a = F(e.fishAngle * D2R), sn = F(Math.sin(a)), cs = F(Math.cos(a));
        var x = e.x + F(F(sn * F(e.fishTravelCountdown)) * F(0.1)), y = F(Math.floor(e.y) + 1);
        var z = e.z + F(F(cs * F(e.fishTravelCountdown)) * F(0.1));
        if (isWater(Math.floor(x), Math.floor(y - 1), Math.floor(z))) {
          if (r.nextFloat() < 0.15) particle('bubble', x, y - F(0.1), z, 1, sn, 0.1, cs, 0);
          var s4 = F(sn * F(0.04)), c4 = F(cs * F(0.04));
          particle('fishing', x, y, z, 0, c4, 0.01, -s4, 1);
          particle('fishing', x, y, z, 0, -c4, 0.01, s4, 1);
        }
      } else {
        var pitch = F(1 + F((r.nextFloat() - r.nextFloat()) * 0.4));
        if (env.sound) env.sound('entity.fishing_bobber.splash', 0.25, pitch);
        var w = e.width || 0.25, cnt = Math.floor(F(1 + F(w * 20)));
        particle('bubble', e.x, e.y + 0.5, e.z, cnt, w, 0, w, 0.2);
        particle('fishing', e.x, e.y + 0.5, e.z, cnt, w, 0, w, 0.2);
        e.hookCountdown = miNext(r, 20, 40); e.caughtFish = true;
      }
    } else if (e.waitCountdown > 0) {
      e.waitCountdown -= n;
      var p = F(0.15);
      if (e.waitCountdown < 20) p = F(p + F(F(20 - e.waitCountdown) * F(0.05)));
      else if (e.waitCountdown < 40) p = F(p + F(F(40 - e.waitCountdown) * F(0.02)));
      else if (e.waitCountdown < 60) p = F(p + F(F(60 - e.waitCountdown) * F(0.01)));
      if (r.nextFloat() < p) {
        var ang = F(mfNext(r, 0, 360) * D2R), len = mfNext(r, 25, 60);
        var px = e.x + F(F(Math.sin(ang)) * len) * 0.1, py = F(Math.floor(e.y) + 1), pz = e.z + F(F(Math.cos(ang)) * len) * 0.1;
        if (isWater(Math.floor(px), Math.floor(py - 1), Math.floor(pz))) particle('splash', px, py, pz, 2 + r.nextInt(2), F(0.1), 0, F(0.1), 0);
      }
      if (e.waitCountdown <= 0) { e.fishAngle = mfNext(r, 0, 360); e.fishTravelCountdown = miNext(r, 20, 80); }
    } else {
      e.waitCountdown = miNext(r, 100, 600) - (e.lureLevel | 0) * 20 * 5;
    }
  };

  Fi.tick = function (e, env) {
    var P = e.owner;
    if (e.state === undefined) { e.state = Fi.FLYING; e.removalTimer = 0; }
    if (!P) { e.removed = true; return; }
    if (Fi.removeIfInvalid(e, P)) return;
    if (e.onGround) { if (++e.removalTimer >= Fi.REMOVAL_TICKS) { e.removed = true; return; } } else e.removalTimer = 0;
    var bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
    var h = env.fluidHeight(bx, by, bz), water = h > 0;
    if (e.state === Fi.FLYING) {
      if (e.hookedEntity) { e.vx = e.vy = e.vz = 0; e.state = Fi.HOOKED_IN_ENTITY; return; }
      if (water) { e.vx *= 0.3; e.vy *= 0.2; e.vz *= 0.3; e.state = Fi.BOBBING; return; }
      Fi.checkForCollision(e, env);
    } else {
      if (e.state === Fi.HOOKED_IN_ENTITY) {
        var H = e.hookedEntity;
        if (H) {
          if (!H.removed && !H.dead && !(H.health <= 0)) { e.x = H.x; e.y = H.y + (H.height || 0) * 0.8; e.z = H.z; }
          else { Fi.setHooked(e, null); e.state = Fi.FLYING; }
        }
        return;
      }
      if (e.state === Fi.BOBBING) {
        var d = e.y + e.vy - by - h;
        if (Math.abs(d) < 0.01) d += (d > 0 ? 1 : d < 0 ? -1 : 0) * 0.1;
        e.vx *= 0.9; e.vz *= 0.9; e.vy -= d * env.rnd() * 0.2;
        if (e.random && h > 0) {
          if (e.caughtFish && e.velocityRandom) e.vy += -0.1 * e.velocityRandom.nextFloat() * e.velocityRandom.nextFloat();
          Fi.tickFishingLogic(e, env, bx, by, bz);
        }
      }
    }
    if (!water) e.vy -= Fi.GRAVITY;
    env.move(e, e.vx, e.vy, e.vz);
    if (e.state === Fi.FLYING && (e.onGround || e.horizontalCollision)) e.vx = e.vy = e.vz = 0;
    e.vx *= Fi.DRAG; e.vy *= Fi.DRAG; e.vz *= Fi.DRAG;
  };
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
