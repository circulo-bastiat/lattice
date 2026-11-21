// src/07zzw_gameevent.js — G17 (#5612): GameEvent emission. NS.GameEvent.emit(type, x, y, z, source) is
// World.emitGameEvent: it reaches the sculk sensor listeners (07zzu_sculk.js). Quiet sources emit nothing for
// STEP/HIT_GROUND-class movement (Entity.isSteppingCarefully / sneaking), and a block tagged
// OCCLUDES_VIBRATION_SIGNALS (wool) on the line between event and sensor stops the vibration
// (SculkSensorListener.isOccluded).
(function (NS) {
  'use strict';
  var G = NS.GameEvent = NS.GameEvents = {};
  G.QUIET_WHEN_SNEAKING = { step: 1, hit_ground: 1, swim: 1, flap: 1 };
  G.OCCLUDER_TAG = 'occludes_vibration_signals';

  /** true when an occluding block lies in a cell the segment passes through (sampled every 1/8 block). */
  G.occluded = function (x0, y0, z0, x1, y1, z1) {
    var W = NS.World, T = NS.Tags;
    if (!W || !T) return false;
    var dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, n = Math.ceil(Math.sqrt(dx * dx + dy * dy + dz * dz) * 8);
    for (var i = 1; i < n; i++) {
      var f = i / n, bx = Math.floor(x0 + 0.5 + dx * f), by = Math.floor(y0 + 0.5 + dy * f), bz = Math.floor(z0 + 0.5 + dz * f);
      if ((bx === x1 && by === y1 && bz === z1) || (bx === x0 && by === y0 && bz === z0)) continue;
      var st = W.getBlock(bx, by, bz);
      if (st && T.stateIn(G.OCCLUDER_TAG, st)) return true;
    }
    return false;
  };

  G.emit = function (type, x, y, z, source) {
    if (source && source.sneaking && G.QUIET_WHEN_SNEAKING[type]) return 0;
    return NS.Sculk ? NS.Sculk.emit(type, Math.floor(x), Math.floor(y), Math.floor(z), source) : 0;
  };
})(MCL);
