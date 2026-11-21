// 07zq2_wolfshake.js — #909: WolfEntity's wet-fur shake (WolfEntity.tick / tickMovement / handleStatus 8,56 /
// getShakeAnimationProgress / getFurWetBrightnessMultiplier, .decomp/net/minecraft/entity/passive/WolfEntity.java:183-275,400).
// Runs on: MAIN THREAD ONLY. No DOM.
// #955: drawn by 07j_entityrender.js (ER.wolfAnim rolls on real_head/upper_body/body/real_tail, ER.wolfWetTint darkening).
(function (NS) {
  'use strict';
  var WS = NS.WolfShake = {};

  WS.SPEED = 0.05;        // shakeProgress += 0.05F
  WS.END = 2.0;           // ends once lastShakeProgress >= 2.0F

  function isWet(e) {
    var S = NS.Sky;
    return !!e.inWater || !!(S && S.isEntityRainedOn && S.isEntityRainedOn(e));
  }
  function reset(e) { e.canShakeWaterOff = false; e.shakeProgress = 0; e.lastShakeProgress = 0; }
  WS.reset = reset;

  /** Once per tick per living wolf: tickMovement's start-shake half, then tick()'s wet/shake half. */
  WS.tick = function (e, rand) {
    if (!e || e.removed) return;
    if (e.dead) { if (e.furWet || e.canShakeWaterOff) WS.onDeath(e); return; }
    var r = rand || Math.random;
    if (e.furWet === undefined) { e.furWet = false; reset(e); }
    // tickMovement: dry-land wolf with wet fur, not pathing, on the ground starts a shake (status 8)
    if (e.furWet && !e.canShakeWaterOff && !e.navigating && e.onGround) {
      e.canShakeWaterOff = true; e.shakeProgress = 0; e.lastShakeProgress = 0;
      if (NS.GameEvent) NS.GameEvent.emit('wolf_shaking', e.x, e.y, e.z, e);   // WolfEntity.tick shake start
    }
    if (isWet(e)) {
      e.furWet = true;
      if (e.canShakeWaterOff) reset(e);                     // status 56
    } else if (e.canShakeWaterOff) {
      if (e.shakeProgress === 0 && NS.Sound && NS.Sound.play && !e.silent) {
        NS.Sound.play('entity.wolf.shake', { x: e.x, y: e.y, z: e.z, volume: 0.4, pitch: (r() - r()) * 0.2 + 1, source: 'neutral' });
      }
      e.lastShakeProgress = e.shakeProgress;
      e.shakeProgress = Math.fround(e.shakeProgress + WS.SPEED);
      if (e.lastShakeProgress >= WS.END) { e.furWet = false; reset(e); }
      if (e.shakeProgress > 0.4) {
        var n = Math.trunc(Math.sin((e.shakeProgress - 0.4) * Math.PI) * 7), w = e.width || 0.6, Px = NS.Particles || NS.Particle;
        var vx = e.vx || 0, vy = e.vy || 0, vz = e.vz || 0;
        for (var i = 0; Px && Px.spawn && i < n; i++) {
          Px.spawn('splash', e.x + (r() * 2 - 1) * w * 0.5, e.y + 0.8, e.z + (r() * 2 - 1) * w * 0.5, vx, vy, vz, r);
        }
      }
    }
  };
  /** onDeath */
  WS.onDeath = function (e) { e.furWet = false; reset(e); };

  function lerp(t, a, b) { return a + t * (b - a); }
  WS.wetBrightness = function (e, pt) {
    return Math.min(0.5 + lerp(pt, e.lastShakeProgress || 0, e.shakeProgress || 0) / 2 * 0.5, 1);
  };
  WS.shakeAnimation = function (e, pt, off) {
    var t = (lerp(pt, e.lastShakeProgress || 0, e.shakeProgress || 0) + off) / 1.8;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.sin(t * Math.PI) * Math.sin(t * Math.PI * 11) * 0.15 * Math.PI;
  };
  WS.ready = true;
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
