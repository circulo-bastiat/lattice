// 15l_subtitles.js - #8340 SubtitlesHud: captions for played sounds (pure model; the HUD draws rows()).
(function (NS) {
  'use strict';
  var SH = NS.SubtitlesHud = { enabled: true, LIFE: 3000, FADE: 1000, RANGE: 16, ARROW: 0.1, entries: [] };

  /** Dot of the (unit) right vector of the look with the normalized offset to p. yaw in degrees, MC convention. */
  function side(l, p) {
    var dx = p.x - l.x, dy = p.y - l.y, dz = p.z - l.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d === 0) return 0;
    var yr = l.yaw * Math.PI / 180;
    // forward = (-sin yaw, cos yaw) on x,z ; right = forward x up = (-cos yaw, -sin yaw)
    return (dx * -Math.cos(yr) + dz * -Math.sin(yr)) / d;
  }
  function dist(l, p) { var dx = p.x - l.x, dy = p.y - l.y, dz = p.z - l.z; return Math.sqrt(dx * dx + dy * dy + dz * dz); }

  /** A sound played: ev is a sound-table event, pos {x,y,z}, now ms, listener {x,y,z,yaw}. */
  SH.onSoundPlayed = function (ev, pos, now, listener) {
    var key = NS.Sound && NS.Sound.subtitle ? NS.Sound.subtitle(ev) : null;
    return SH.add(key, pos, now, listener);
  };
  SH.add = function (key, pos, now, listener) {
    if (!SH.enabled || !key) return false;
    var es = SH.entries;
    for (var i = 0; i < es.length; i++) if (es[i].key === key) {
      var e = es[i];
      if (dist(listener, pos) <= dist(listener, e.pos) || now - e.time >= SH.LIFE) e.pos = pos;
      e.time = now; return true;
    }
    es.push({ key: key, pos: pos, time: now });
    return true;
  };
  /** Visible rows oldest-first (newest at the bottom): text key, arrow, alpha 0..1, colour channel 255->75. */
  SH.rows = function (now, listener) {
    var es = SH.entries, out = [];
    for (var i = es.length - 1; i >= 0; i--) if (es[i].time + SH.LIFE < now) es.splice(i, 1);
    for (var j = 0; j < es.length; j++) {
      var e = es[j], s = side(listener, e.pos), d = Math.min(1, dist(listener, e.pos) / SH.RANGE);
      out.push({ key: e.key, arrow: s > SH.ARROW ? '>' : s < -SH.ARROW ? '<' : '',
        alpha: Math.max(0, Math.min(1, (SH.LIFE - (now - e.time)) / SH.FADE)),
        color: Math.floor(255 + (75 - 255) * d) });
    }
    return out;
  };
})(MCL);
