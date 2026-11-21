// MC-Lite — #11244: CreditsScreen (1.18.2, .decomp net/minecraft/client/gui/screen/CreditsScreen.java), opened from the title screen's
// copyright line. texts/credits.json is shipped in the gui payload (Gui.credits). Pure layout (build()) so creditscheck can compare it with
// the jar's own JSON. baseSpeed 0.75 (0.5 for the End path); hold Space = x5 (+15 per held Ctrl); 12 px per line; text column 274 wide at
// width/2-137; closes when time > creditsHeight + 2*height + 24; Escape closes at once. The options-background tile is not in the gui
// payload, so the background is a flat colour at vanilla's fade brightness (ruling in docs/decisions/11244-credits.md).
(function (NS) {
  'use strict';
  var C = NS.Credits = {};
  C.WHITE = 0xFFFFFF; C.YELLOW = 0xFFFF55; C.GRAY = 0xAAAAAA;   // Formatting.WHITE / YELLOW / GRAY
  C.INDENT = '           ';
  C.MAX_WIDTH = 274;
  C.view = null;

  var tw = function (s) { return (NS.Gui && NS.Gui.textWidth) ? NS.Gui.textWidth(s) : s.length * 6; };
  /** TextRenderer.wrapLines for plain text: break at spaces so no line exceeds `max`. */
  C.wrap = function (str, max) {
    var out = [], words = str.split(' '), cur = '';
    for (var i = 0; i < words.length; i++) {
      var t = cur ? cur + ' ' + words[i] : words[i];
      if (cur && tw(t) > max) { out.push(cur); cur = words[i]; } else cur = t;
    }
    out.push(cur);
    return out;
  };

  /** init(): the line list [{t,color,center}] from credits.json (readCredits) and, for the End path, postcredits.txt (readPoem). */
  C.build = function (credits, endCredits, postcredits) {
    var L = [], empty = function () { L.push({ t: '', color: C.WHITE, center: false }); };
    for (var i = 0; i < credits.length; i++) {
      var sec = credits[i];
      L.push({ t: '============', color: C.WHITE, center: true });
      L.push({ t: sec.section, color: C.YELLOW, center: true });
      L.push({ t: '============', color: C.WHITE, center: true });
      empty(); empty();
      for (var j = 0; j < sec.titles.length; j++) {
        var ti = sec.titles[j];
        L.push({ t: ti.title, color: C.GRAY, center: false });
        for (var k = 0; k < ti.names.length; k++) L.push({ t: C.INDENT + ti.names[k], color: C.WHITE, center: false });
        empty(); empty();
      }
    }
    if (endCredits && postcredits) {
      for (var p = 0; p < postcredits.length; p++) {
        if (p === postcredits.length - 1 && postcredits[p] === '') break;   // readLine() yields no trailing empty line
        var w = C.wrap(postcredits[p], C.MAX_WIDTH);
        for (var q = 0; q < w.length; q++) L.push({ t: w[q], color: C.WHITE, center: false });
        empty();
      }
      for (var e = 0; e < 8; e++) empty();
    }
    return L;
  };

  C.open = function (endCredits, finish) {
    var G = NS.Gui;
    var lines = C.build((G && G.credits) || [], !!endCredits, G && G.postcredits);
    C.view = { end: !!endCredits, finish: finish || null, time: 0, lastMs: 0, lines: lines, height: lines.length * 12,
      base: endCredits ? 0.5 : 0.75, space: false, ctrl: 0 };
    NS.Hud.titleView = 'credits';
  };
  C.speed = function (v) { return v.space ? v.base * (5 + v.ctrl * 15) : v.base; };
  C.close = function () {
    var v = C.view; C.view = null;
    if (v && v.finish) v.finish();
    NS.Hud.titleView = 'main';
  };
  C.keyDown = function (key) {
    var v = C.view; if (!v) return;
    if (key === 'Control') v.ctrl = 1; else if (key === ' ') v.space = true;
    if (key === 'Escape') C.close();
  };
  C.keyUp = function (key) {
    var v = C.view; if (!v) return;
    if (key === ' ') v.space = false; else if (key === 'Control') v.ctrl = 0;
  };
  /** advance by `ticks` game ticks (render's partial-tick delta * speed); closes past the end like tick(). */
  C.advance = function (ticks, gh) {
    var v = C.view; if (!v) return;
    v.time += ticks * C.speed(v);
    if (v.time > v.height + gh + gh + 24) C.close();
  };

  C.draw = function (c, w, h, s) {
    var v = C.view, g = NS.Gui; if (!v) return;
    var now = Date.now(), gw = w / s, gh = h / s;
    if (v.lastMs) C.advance(Math.min(0.25, (now - v.lastMs) / 1000) * 20, gh);
    v.lastMs = now;
    if (!C.view) return;
    // renderBackground brightness
    var t4 = v.time / v.base, f = t4 * 0.02, f7 = (((v.height + gh + gh + 24) / v.base) - 20 - t4) * 0.005;
    if (f7 < f) f = f7; if (f > 1) f = 1;
    f = f * f * 96 / 255;
    var b = Math.round(f * 255 * 0.45);
    c.fillStyle = 'rgb(' + b + ',' + b + ',' + b + ')'; c.fillRect(0, 0, w, h);
    var x0 = Math.floor(gw / 2) - 137, y0 = Math.floor(gh) + 50, off = -v.time;
    g.blit(c, 'title_logo', [0, 0, 155, 44], x0 * s, (y0 + off) * s, s);
    g.blit(c, 'title_logo', [0, 45, 155, 44], (x0 + 155) * s, (y0 + off) * s, s);
    g.blit(c, 'title_edition', [0, 0, 98, 14], (x0 + 88) * s, (y0 + 37 + off) * s, s);
    var y = y0 + 100, n = v.lines.length;
    for (var i = 0; i < n; i++) {
      var tr = 0;
      if (i === n - 1) { var d = y + off - (Math.floor(gh / 2) - 6); if (d < 0) tr = -d; }
      var L = v.lines[i];
      if (L.t && y + off + tr + 20 > 0 && y + off + tr < gh) {
        var x = L.center ? x0 + (C.MAX_WIDTH - tw(L.t)) / 2 : x0;
        g.text(c, L.t, x * s, (y + off + tr) * s, s, L.color, true);
      }
      y += 12;
    }
  };
})(MCL);
