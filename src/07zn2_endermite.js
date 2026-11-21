// src/07zn2_endermite.js — ENDERMITE (QUEUE 0.2 G18, session 115).
//
// `EndermiteEntity` (.decomp/net/minecraft/entity/mob/EndermiteEntity.java, 158 lines, read in
// full): extends HostileEntity; attributes 8 HP / 0.25 speed / 2 attack (:61-66, already in
// tools/golden/entity-attributes); ARTHROPOD group (:152-155, already in Cb's mob-type table);
// eye height 0.13 (:57-59); its goals (:43-52) live in Ai.ROSTER.endermite (07k_goals.js).
// What this module owns is the one piece of per-tick state the class adds:
//   `lifeTime` (NBT "Lifetime", :95-104) — `tickMovement()` (:124-146, the server half) counts it
//   up by one every tick UNLESS `isPersistent()`, and `discard()`s the mite at `>= 2400`
//   (`DESPAWN_TIME`, :31). A name-tagged (persistent) mite never ages out.
// And EndermanEntity's own targetSelector priority 3, `ActiveTargetGoal<EndermiteEntity>(this,
// true, false)` (EndermanEntity.java:101-104) — the "endermen hunt endermites" half that
// 07k_goals.js named OWED until an endermite existed.
(function (NS) {
  'use strict';
  var Em = NS.Endermite = NS.Endermite || {};

  Em.DESPAWN_TIME = 2400;   // EndermiteEntity.DESPAWN_TIME (.decomp:31)
  Em.EYE_HEIGHT = 0.13;     // getActiveEyeHeight (.decomp:57-59)

  Em.OWED = [];   // canSpawn's 5-block player gate is Spawn.RULES.endermite's (#3763)

  /** tickMovement's client half (.decomp:126-137): 2 portal particles/tick. Returns how many spawned. */
  Em.portalParticles = function (e) {
    var Px = NS.Particle;
    if (!Px || !Px.spawn) return 0;
    var w = e.width || 0.4, h = e.height || 0.3, n = 0, r = Math.random;
    for (var i = 0; i < 2; i++) {
      if (Px.spawn('portal', e.x + (r() * 2 - 1) * 0.5 * w, e.y + r() * h, e.z + (r() * 2 - 1) * 0.5 * w,
                   (r() - 0.5) * 2, -r(), (r() - 0.5) * 2)) n++;
    }
    return n;
  };

  /** EndermiteEntity.tickMovement's server half (.decomp:139-145). Returns true if discarded. */
  Em.tick = function (e) {
    if (!e || e.type !== 'endermite' || e.dead || e.removed) return false;
    Em.portalParticles(e);
    if (!e.persistent) e.lifeTime = (e.lifeTime | 0) + 1;
    if ((e.lifeTime | 0) >= Em.DESPAWN_TIME) {
      var EL = NS.EntityList;
      if (EL && EL.remove) EL.remove(e); else e.removed = true;
      return true;
    }
    return false;
  };

  /** EndermanEntity targetSelector 3: ActiveTargetGoal<EndermiteEntity>(this, true, false). */
  Em.endermitesNear = function (ctx) {
    var EL = NS.EntityList;
    return function () {
      var all = (EL && EL.all) ? EL.all() : [];
      return all.filter(function (m) { return m.type === 'endermite' && !m.dead && !m.removed; });
    };
  };

  Em.ready = true;
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
