// 07zb_creeper.js — loop/creeper-s95, QUEUE 0.2 G18c: `CreeperEntity.tick()`'s OWN remainder —
// the fuse counter, the swell and the `explode()` trigger — everything `Ai.CreeperIgniteGoal`
// (07k_goals.js, the goal-selector half) does not own. Runs on: MAIN THREAD ONLY. No DOM.
//
// .decomp/net/minecraft/entity/mob/CreeperEntity.java, `tick()`/`explode()`, read whole:
//   tick():
//     lastFuseTime = currentFuseTime;
//     if (isIgnited()) setFuseSpeed(1);                        // flint-and-steel LATCHES the fuse
//     fuseSpeed = getFuseSpeed();
//     if (fuseSpeed > 0 && currentFuseTime == 0) { play the hiss; }   // sound — UI, `Cr.OWED`
//     currentFuseTime += fuseSpeed; clamp to >= 0;
//     if (currentFuseTime >= fuseTime) { currentFuseTime = fuseTime; explode(); }
//   explode():
//     destructionType = getGameRules().getBoolean(DO_MOB_GRIEFING) ? DESTROY : NONE;
//     power = (float) explosionRadius * (shouldRenderOverlay() /* charged */ ? 2.0F : 1.0F);
//     world.createExplosion(this, x, y, z, power, destructionType);
//     this.dead = true; this.discard();
//     spawnEffectsCloud();   // an AreaEffectCloudEntity, only when the creeper HAD potion
//                            // effects on it — no potion-effect substrate exists on a MOB in
//                            // this engine at all (Ai.OWED's own standing gap), so this branch
//                            // is always empty and is not wired — `Cr.OWED`.
//
// ⚠ `fuseTime` (30) and `explosionRadius` (3) are `CreeperEntity`'s own FIELD INITIALIZERS —
// not overridden anywhere in 1.18.2 (no "small creeper"/config option in this version) — set
// once at spawn (`EL.DEFAULTS.creeper`, 07i_entitylist.js) and read here unchanged; a save/load
// round trip owes NBT's own `Fuse`/`ExplosionRadius` override the jar allows for (`Cr.OWED`).
//
// ⚠ `powered` (the CHARGED flag, a lightning strike, `CreeperEntity.onStruckByLightning`) is
// carried as `e.charged` and DOUBLES the power here exactly as `explode()` does — nothing in
// this engine strikes a mob with lightning yet (no lightning-on-mob hook at all, only the sky's
// own weather-strike-on-terrain path), so `e.charged` never becomes true today; the flag and
// the doubling are real and tested (`creepercheck.mjs`), only the TRIGGER is owed (`Cr.OWED`).
// This is the "OWED, named CHARGED" (may be called a name like OWED elsewhere) the unit's own
// task named.

(function (NS) {
  'use strict';

  var Cr = NS.Creeper = { ready: false };

  Cr.init = function () {
    Cr.ready = !!(NS.EntityList && NS.Explosion && NS.Explosion.ready);
    return Cr;
  };

  Cr.IGNITE_SPEED = 1;     // CreeperEntity.tick(): setFuseSpeed(1) once isIgnited()

  /** `CreeperEntity.interactMob`'s own flint-and-steel half. `14l_use.js`'s own
   *  `Use.entityUse` (loop/tnt-s96) is the live caller now — sets the SAME latch `tick()`
   *  below reads, so an ignite this tick or last tick both take. */
  Cr.ignite = function (e) { if (e && e.type === 'creeper' && !e.dead) e.ignited = true; };

  /** `CreeperEntity.handleFallDamage`: currentFuseTime += (int)(fallDistance * 1.5F), clamped to fuseTime - 5. */
  Cr.onFall = function (e, fallDistance) {
    var ft = e.fuseTime || 30;
    e.currentFuseTime = (e.currentFuseTime || 0) + Math.trunc(fallDistance * 1.5);
    if (e.currentFuseTime > ft - 5) e.currentFuseTime = ft - 5;
  };

  /** One tick of a live creeper's own fuse — called from `EL.tickMob` (07i_entitylist.js),
   *  after the goal selector and `Ai.tickHead`, same slot every other per-mob live hook
   *  (`Trade.tick`, `Village.tick`) already occupies. */
  Cr.tick = function (e) {
    if (!Cr.ready || !e || e.type !== 'creeper' || e.dead) return;
    e.lastFuseTime = e.currentFuseTime || 0;
    if (e.ignited) e.fuseSpeed = Cr.IGNITE_SPEED;
    var speed = e.fuseSpeed || 0;
    if (speed > 0 && !(e.currentFuseTime > 0) && !e.silent && NS.Sound && NS.Sound.play)
      NS.Sound.play('entity.creeper.primed', { x: e.x, y: e.y, z: e.z, volume: 1.0, pitch: 0.5, source: 'hostile' });
    e.currentFuseTime = (e.currentFuseTime || 0) + speed;
    if (e.currentFuseTime < 0) e.currentFuseTime = 0;
    if (e.currentFuseTime >= e.fuseTime) {
      e.currentFuseTime = e.fuseTime;
      Cr.explode(e);
    }
  };

  /** `getClientFuseTime` — the 0..1 swell fraction `lerp(partial, last, current) /
   *  (fuseTime - 2)`, exposed for a future render hook (`Cr.OWED` — no visual scale wired). */
  Cr.swellFraction = function (e, partial) {
    if (!e || e.type !== 'creeper') return 0;
    var last = e.lastFuseTime || 0, cur = e.currentFuseTime || 0;
    var f = last + (cur - last) * (partial === undefined ? 1 : partial);
    var denom = (e.fuseTime || 30) - 2;
    return denom > 0 ? f / denom : 0;
  };

  /** `explode()` — `world.createExplosion`, then removal. `NS.Commands.ruleGet('mobGriefing')`
   *  is read directly rather than through `Commands.RULES_LIVE` (that table is documentation,
   *  not a gate; `15g_commands.js` is not one of this unit's own files, D-399's own
   *  `Ai.BreakDoorGoal` entry is the only existing row and this does not touch it). */
  Cr.explode = function (e) {
    var C = NS.Commands;
    var griefing = C && C.ruleGet ? C.ruleGet('mobGriefing') !== 'false' : true;
    var power = (e.explosionRadius || 3) * (e.charged ? 2 : 1);
    e.dead = true;
    if (NS.Explosion && NS.Explosion.ready) {
      NS.Explosion.explode(e, e.x, e.y, e.z, power, griefing);
    }
    Cr.spawnEffectsCloud(e);
    e.removed = true;
  };

  /** `spawnEffectsCloud()` — an `area_effect_cloud` carrying a copy of every active effect, only
   *  when the creeper has any: radius 2.5, radiusOnUse -0.5, waitTime 10, duration = default/2,
   *  radiusGrowth = -radius / duration (the setters' own order). */
  Cr.spawnEffectsCloud = function (e) {
    var EL = NS.EntityList;
    if (!e.effects || !EL || !EL.canSpawn('area_effect_cloud')) return null;
    var custom = [];
    for (var k in e.effects) {
      if (!e.effects.hasOwnProperty(k)) continue;
      var inst = e.effects[k];
      custom.push({ effect: inst.effect, duration: inst.duration, amplifier: inst.amplifier });
    }
    if (!custom.length) return null;
    var radius = 2.5, duration = 300;   // AreaEffectCloudEntity's default duration 600 / 2
    return EL.spawn('area_effect_cloud', e.x, e.y, e.z, {
      radius: radius, radiusOnUse: -0.5, waitTime: 10, duration: duration,
      radiusGrowth: -radius / duration, custom: custom
    });
  };

  Cr.OWED = [
    // struck s113: the swell scale IS drawn (D-531, 07j_entityrender.js reads Cr.swellFraction).
    'the fuse-start hiss (SoundEvents.ENTITY_CREEPER_PRIMED) — no creeper sounds are packed',
    // struck: 07zzc_lightning.js now charges creepers (e.charged).
    // loop/tnt-s96 -- STRUCK: flint-and-steel ignition now has a live caller
    // (14l_use.js's own Use.entityUse, the creeper-only branch that reuses Cr.ignite).
    // struck s113: powered/Fuse/ExplosionRadius/ignited round-trip through the save
    // (07zw_mobnbt.js SPECIES.creeper, mobnbtcheck).
  ];
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
