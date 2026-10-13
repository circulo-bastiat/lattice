// 07zz2_dolphin.js — #718: DolphinEntity's air/moistness/dry-out half (.decomp
// passive/DolphinEntity.java:83-148,192-198,240-262). Main thread only. No DOM.
//   * getMaxAir 4800, getNextAirOnLand = max, initialize sets air = max, canBreatheInWater false
//     (so LivingEntity.baseTick drowns it like a player, on the 4800 scale), tickWaterBreathingAir no-op.
//   * tick: wet -> moistness 2400; else -1, <= 0 -> DRYOUT 1.0, and on the ground a random hop.
//   * NBT: Moistness, GotFish, TreasurePosX/Y/Z (07zw_mobnbt.js row).
(function (NS) {
  'use strict';
  var Dol = NS.Dolphin = NS.Dolphin || {};
  Dol.MAX_AIR = 4800;
  Dol.MAX_MOISTNESS = 2400;
  Dol.DRYOUT_DAMAGE = 1.0;
  Dol.DROWN_AT = -20;
  Dol.DROWN_DAMAGE = 2.0;

  Dol.spawnInit = function (e) {
    if (e.air === undefined) e.air = Dol.MAX_AIR;
    if (e.moistness === undefined) e.moistness = Dol.MAX_MOISTNESS;
    e.pitch = 0;
  };

  function isWet(e) {
    if (NS.SnowGolem && NS.SnowGolem.isWet) return NS.SnowGolem.isWet(e);   // Entity.isWet incl. bubble column
    return !!e.inWater || !!(NS.Sky && NS.Sky.isEntityRainedOn && NS.Sky.isEntityRainedOn(e));
  }

  /** LivingEntity.baseTick's breath step with canBreatheInWater() == false. */
  Dol.tickAir = function (e) {
    if (e.air === undefined) e.air = Dol.MAX_AIR;
    if (e.eyeInWater && !e.eyeInBubble && !(NS.Effects && NS.Effects.hasWaterBreathing(e))) {
      e.air -= 1;
      if (e.air <= Dol.DROWN_AT) {
        e.air = 0;
        if (NS.Combat && NS.Combat.hurt) NS.Combat.hurt(e, Dol.DROWN_DAMAGE, undefined, false, { source: 'drown' });
      }
    } else {
      e.air = Dol.MAX_AIR;
    }
  };

  /** DolphinEntity.tick's wet/dry branch. `rnd` is an optional [0,1) source (tests). */
  Dol.tickMoist = function (e, rnd) {
    rnd = rnd || NS.fbRand;
    if (e.moistness === undefined) e.moistness = Dol.MAX_MOISTNESS;
    if (isWet(e)) { e.moistness = Dol.MAX_MOISTNESS; return; }
    e.moistness -= 1;
    if (e.moistness <= 0 && NS.Combat && NS.Combat.hurt) {
      NS.Combat.hurt(e, Dol.DRYOUT_DAMAGE, undefined, false, { source: 'dryout' });
    }
    if (e.onGround) {
      e.vx = (e.vx || 0) + (rnd() * 2 - 1) * 0.2;
      e.vy = (e.vy || 0) + 0.5;
      e.vz = (e.vz || 0) + (rnd() * 2 - 1) * 0.2;
      e.yaw = rnd() * Math.PI * 2;
      e.onGround = false;
    }
  };

  Dol.tick = function (e) {
    if (!e || e.removed || e.dead) return;
    if (e.aiDisabled || e.noAI) { e.air = Dol.MAX_AIR; return; }   // DolphinEntity.tick: isAiDisabled -> setAir(getMaxAir())
    Dol.tickAir(e);
    Dol.tickMoist(e);
    Dol.tickTrail(e);
  };

  /** `DolphinEntity.tick` client branch: touching water and v^2 > 0.03 -> 4 `dolphin` particles behind it.
   *  Engine yaw: forward = (sin y, -cos y), so the jar's cos/sin(yaw) pair is (-cos y, sin y). Returns the count. */
  Dol.tickTrail = function (e) {
    var Px = NS.Particle, vx = e.vx || 0, vy = e.vy || 0, vz = e.vz || 0;
    if (!Px || !e.inWater || vx * vx + vy * vy + vz * vz <= 0.03) return 0;
    var r = (NS.EntityList && NS.EntityList.random) || NS.fbRand, y = e.yaw || 0, p = e.pitch || 0;
    var rx = Math.sin(y) * Math.cos(p), ry = -Math.sin(p), rz = -Math.cos(y) * Math.cos(p);
    var a = -Math.cos(y) * 0.3, b = Math.sin(y) * 0.3, f = Math.fround(1.2 - r() * 0.7), n = 0;
    for (var i = 0; i < 2; i++) {
      if (Px.spawn('dolphin', e.x - rx * f + a, e.y - ry, e.z - rz * f + b, 0, 0, 0, r)) n++;
      if (Px.spawn('dolphin', e.x - rx * f - a, e.y - ry, e.z - rz * f - b, 0, 0, 0, r)) n++;
    }
    return n;
  };

  /** `ItemTags.FISHES` (jar data/minecraft/tags/items/fishes.json). */
  Dol.FISHES = { cod: 1, cooked_cod: 1, salmon: 1, cooked_salmon: 1, pufferfish: 1, tropical_fish: 1 };

  /** `DolphinEntity.interactMob`: a fish in hand sets GotFish + `entity.dolphin.eat` and shrinks the stack
   *  (not in creative). Returns true when it consumed the use; the caller shrinks the stack (Use.entityUse). */
  Dol.interact = function (e, itemName, creative) {
    if (!e || e.type !== 'dolphin' || e.dead || !Dol.FISHES[itemName]) return false;
    if (NS.Sound && NS.Sound.play) NS.Sound.play('entity.dolphin.eat', { x: e.x, y: e.y, z: e.z, source: 'neutral', volume: 1, pitch: 1 });
    e.hasFish = true;
    return true;
  };

  /** `LeadToNearbyTreasureGoal.start`'s `locateStructure(dolphin_located, pos, 50, false)`; sends status 38 on a hit. */
  Dol.locateTreasure = function (e) {
    var St = NS.Structures;
    var r = St && St.locateStructure ? St.locateStructure('dolphin_located', Math.floor(e.x), Math.floor(e.z), 50) : null;
    if (!r) return null;
    Dol.handleStatus(e, 38);
    return { x: r.x, y: r.y | 0, z: r.z };
  };

  /** `DolphinEntity.handleStatus(38)` -> spawnParticlesAround(happy_villager): seven of them. */
  Dol.handleStatus = function (e, st) {
    if (st !== 38) return 0;
    var Px = NS.Particle; if (!Px) return 0;
    var r = (NS.EntityList && NS.EntityList.random) || NS.fbRand, n = 0;
    for (var i = 0; i < 7; i++) {
      var g = Px._gauss;
      var vx = g(r) * 0.01, vy = g(r) * 0.01, vz = g(r) * 0.01;
      var w = e.width || 0.9, h = e.height || 0.6;
      if (Px.spawn('happy_villager', e.x + w * (2 * r() - 1), e.y + h * r() + 0.2, e.z + w * (2 * r() - 1), vx, vy, vz, r)) n++;
    }
    e.treasureHearts = (e.treasureHearts | 0) + 7;
    return n;
  };
  Dol.ready = true;
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
