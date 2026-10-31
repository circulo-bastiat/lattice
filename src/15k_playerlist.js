// 15k_playerlist.js — PlayerListHud (Tab list). Port of net.minecraft.client.gui.hud.PlayerListHud
// and the visibility rule in InGameHud.render: the list shows while the key is held, EXCEPT in
// singleplayer with <= 1 entry and no scoreboard list objective (vanilla 1.18.2 shows nothing then).
// The layout is pure (no canvas) so tools/playerlistcheck.mjs can pin the numbers.

(function (NS) {
  'use strict';

  var PL = NS.PlayerList = { key: 'Tab', header: null, footer: null, objective: null, extra: [], MAX_ROWS: 20, MAX_ENTRIES: 80 };

  /** ENTRY_ORDERING: non-spectators first, then team name, then profile name case-insensitively. */
  PL.compare = function (a, b) {
    var sa = a.mode === 'spectator', sb = b.mode === 'spectator';
    if (sa !== sb) return sa ? 1 : -1;
    var ta = a.team || '', tb = b.team || '';
    if (ta !== tb) return ta < tb ? -1 : 1;
    var na = a.name.toLowerCase(), nb = b.name.toLowerCase();
    return na < nb ? -1 : na > nb ? 1 : 0;
  };

  /** InGameHud: hidden unless held, and hidden in singleplayer with <= 1 player and no objective. */
  PL.visible = function (held, singleplayer, count, objective) {
    return !!held && !(singleplayer && count <= 1 && !objective);
  };

  /** Ping icon row (renderLatencyIcon): index into the icons.png strip at v = 176 + i*8. */
  PL.pingIcon = function (ms) {
    return ms < 0 ? 5 : ms < 150 ? 0 : ms < 300 ? 1 : ms < 600 ? 2 : ms < 1000 ? 3 : 4;
  };

  /**
   * render()'s arithmetic. nameW(entry) is the text width; screenW the scaled width.
   * objective: null | { hearts: bool, scoreW: number } (scoreW = widest " score").
   */
  PL.layout = function (entries, screenW, nameW, objective, heads) {
    var sorted = entries.slice().sort(PL.compare), maxName = 0, i;
    for (i = 0; i < sorted.length; i++) maxName = Math.max(maxName, nameW(sorted[i]));
    sorted = sorted.slice(0, PL.MAX_ENTRIES);
    var n = sorted.length, rows = n, cols = 1;
    while (rows > PL.MAX_ROWS) { cols++; rows = Math.floor((n + cols - 1) / cols); }
    var obj = objective ? (objective.hearts ? 90 : objective.scoreW) : 0;
    var colW = Math.floor(Math.min(cols * ((heads ? 9 : 0) + maxName + obj + 13), screenW - 50) / cols);
    var total = colW * cols + (cols - 1) * 5;
    var x0 = Math.floor(screenW / 2) - Math.floor(total / 2);
    var cells = [];
    for (i = 0; i < n; i++) {
      var c = Math.floor(i / rows), r = i % rows;
      cells.push({ e: sorted[i], x: x0 + c * colW + c * 5, y: 10 + r * 9 });
    }
    return { sorted: sorted, rows: rows, cols: cols, colW: colW, width: total, x0: x0, maxName: maxName, objW: obj, cells: cells };
  };

  /** The local player plus whatever remote entries a caller pushed into PL.extra. */
  PL.entries = function () {
    var out = [{ name: (NS.Save && NS.Save.playerName) || 'Player', mode: (NS.Gm && NS.Gm.name) || 'survival', team: '', ping: 0 }];
    return out.concat(PL.extra);
  };

  PL.draw = function (c, H) {
    var held = NS.Input && NS.Input.keys && NS.Input.keys[PL.key];
    var es = PL.entries();
    if (!PL.visible(held, true, es.length, PL.objective)) return;
    var g = NS.Gui, L = PL.layout(es, H.w, function (e) { return g.textWidth(e.name); }, PL.objective, true);
    c.font = '9px monospace'; c.textAlign = 'left'; c.textBaseline = 'top';
    c.fillStyle = 'rgba(0,0,0,0.5)';
    c.fillRect(L.x0 - 1, 9, L.width + 2, L.rows * 9 + 1);
    for (var i = 0; i < L.cells.length; i++) {
      var k = L.cells[i];
      c.fillStyle = 'rgba(255,255,255,0.22)'; c.fillRect(k.x, k.y, L.colW, 8);
      c.fillStyle = k.e.mode === 'spectator' ? 'rgba(255,255,255,0.6)' : '#fff';
      c.fillText(k.e.name, k.x + 9, k.y);
    }
  };
})(MCL);
