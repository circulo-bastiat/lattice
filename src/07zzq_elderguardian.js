// src/07zzq_elderguardian.js — #1009: ElderGuardianEntity.mobTick (.decomp, read whole): every 1200 ticks
// ((age + id) % 1200 == 0) every survival-like player (survival or adventure) within 50 blocks
// (squaredDistance < 2500) who lacks mining_fatigue amp >= 2 with duration >= 1200 gets the
// ELDER_GUARDIAN_EFFECT packet (apparition + sound; silent ? 0 : 1) and mining_fatigue amp 2 for 6000 ticks.
// The apparition is stored on the player as `elderGuardianFx` = {ticks, silent}; the HUD reads it.
// Runs on: MAIN THREAD ONLY.

(function (NS) {
  'use strict';

  var Eg = NS.ElderGuardian = {
    INTERVAL: 1200, RANGE_SQ: 2500, AMPLIFIER: 2, DURATION: 6000, MIN_DURATION: 1200, FX_TICKS: 60
  };

  Eg.players = function () {
    var EL = NS.EntityList;
    if (EL && EL.pushPlayer) { var q = EL.pushPlayer(); return q ? [q] : []; }
    return NS.Player && NS.Player.x !== undefined ? [NS.Player] : [];
  };

  Eg.mobTick = function (e) {
    if (!e || e.type !== 'elder_guardian' || e.removed || e.dead) return;
    var Ai = NS.Ai;   // #1010: if (!hasPositionTarget()) setPositionTarget(getBlockPos(), 16)
    if (Ai && Ai.hasPositionTarget && !Ai.hasPositionTarget(e)) Ai.setPositionTarget(e, e, 16);
    if (((e.age | 0) + (e.id | 0)) % Eg.INTERVAL !== 0) return;
    var ES = NS.Effects, list = Eg.players();
    if (!ES) return;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (!p || p.mode === 1 || p.mode === 3) continue;       // isSurvivalLike: survival/adventure only
      var dx = p.x - e.x, dy = p.y - e.y, dz = p.z - e.z;
      if (dx * dx + dy * dy + dz * dz >= Eg.RANGE_SQ) continue;
      var cur = ES.getStatusEffect(p, 'mining_fatigue');
      if (cur && cur.amplifier >= Eg.AMPLIFIER && cur.duration >= Eg.MIN_DURATION) continue;
      p.elderGuardianFx = { ticks: Eg.FX_TICKS, silent: !!e.silent };
      if (NS.Particle && NS.Particle.spawnElderGuardian) NS.Particle.spawnElderGuardian(p.x, p.y, p.z);   // #8078: ELDER_GUARDIAN particle at the player
      if (!e.silent && NS.Sound && NS.Sound.play) NS.Sound.play('entity.elder_guardian.curse', { x: p.x, y: p.y, z: p.z });
      ES.addStatusEffect(p, 'mining_fatigue', Eg.DURATION, Eg.AMPLIFIER, false, true, true, e);
    }
  };
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
