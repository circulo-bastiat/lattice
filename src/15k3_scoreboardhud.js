// 15k3_scoreboardhud.js -- G26f: the scoreboard display slots in the HUD. Port of InGameHud.renderScoreboardSidebar
// (layout is pure so tools/scoreboardcheck.mjs can pin it) plus the slot choice in InGameHud.render: the viewer's
// team colour picks slot 3+colourIndex, falling back to slot 1 (sidebar). The list slot feeds PlayerList.objective;
// belowName is exposed as belowNameText for the nametag renderer.
(function (NS) {
  'use strict';

  var SH = NS.ScoreboardHud = { };

  /** The objective the sidebar shows for a viewer holder (name), as InGameHud.render picks it. */
  SH.sidebarObjective = function (viewer) {
    var SB = NS.Scoreboard, t = viewer && SB.teamOf(viewer), o = null;
    if (t) { var i = SB.colorNames().indexOf(t.color); if (i >= 0 && i < 16) o = SB.objectiveForSlot(3 + i); }
    return o || SB.objectiveForSlot(1);
  };

  /** renderScoreboardSidebar geometry: rows (top to bottom drawn order of the Java loop), title, box. */
  SH.layout = function (obj, sw, sh, textW) {
    var SB = NS.Scoreboard, all = SB.allScores(obj).filter(function (e) { return e.name.charAt(0) !== '#'; });
    if (all.length > 15) all = all.slice(all.length - 15);
    var colonW = textW(': '), titleW = textW(obj.displayName), maxW = titleW;
    var rows = all.map(function (e) {
      var t = SB.teamOf(e.name), label = t ? t.prefix + e.name + t.suffix : e.name;
      maxW = Math.max(maxW, textW(label) + colonW + textW(String(e.score)));
      return { name: e.name, label: label, color: t && t.color !== 'reset' ? t.color : null, score: String(e.score) };
    });
    var n = rows.length, base = (sh >> 1) + Math.trunc(n * 9 / 3), left = sw - maxW - 3, right = sw - 3 + 2;
    rows.forEach(function (r, k) {
      r.y = base - (k + 1) * 9; r.x = left; r.scoreX = right - textW(r.score);
    });
    var top = n ? rows[n - 1].y : base;
    return { rows: rows, left: left, right: right, boxLeft: left - 2, titleX: left + (maxW >> 1) - (titleW >> 1), titleY: top - 9,
             titleBg: [left - 2, top - 9 - 1, right, top - 1], gap: [left - 2, top - 1, right, top] };
  };

  /** Scoreboard below-name text for an entity holder: "<score> <objective display name>" or null. */
  SH.belowNameText = function (holder) {
    var SB = NS.Scoreboard, o = SB.objectiveForSlot(2); if (!o) return null;
    var v = SB.getScore(holder, o); return v === null ? null : v + ' ' + o.displayName;
  };

  SH.draw = function (c, H) {
    var SB = NS.Scoreboard; if (!SB) return;
    var lo = SB.objectiveForSlot(0);
    if (NS.PlayerList) NS.PlayerList.objective = lo ? { hearts: lo.renderType === 'hearts', scoreW: 0 } : null;
    var viewer = (NS.Save && NS.Save.playerName) || 'Player', o = SH.sidebarObjective(viewer); if (!o) return;
    var g = NS.Gui, L = SH.layout(o, H.w, H.h, function (s) { return g.textWidth(s); });
    c.font = '9px monospace'; c.textAlign = 'left'; c.textBaseline = 'top';
    L.rows.forEach(function (r) {
      c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(L.boxLeft, r.y, L.right - L.boxLeft, 9);
      c.fillStyle = '#fff'; c.fillText(r.label, r.x, r.y);
      c.fillStyle = '#ff5555'; c.fillText(r.score, r.scoreX, r.y);
    });
    c.fillStyle = 'rgba(0,0,0,0.4)'; c.fillRect(L.titleBg[0], L.titleBg[1], L.titleBg[2] - L.titleBg[0], 9);
    c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(L.gap[0], L.gap[1], L.gap[2] - L.gap[0], 1);
    c.fillStyle = '#fff'; c.fillText(o.displayName, L.titleX, L.titleY);
  };
})(MCL);
