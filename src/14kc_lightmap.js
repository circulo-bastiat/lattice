// 14kc_lightmap.js — LightmapTextureManager.update: the 16x16 (sky x block) lightmap, gamma mix included.
(function (NS) {
  'use strict';
  var LM = NS.Lightmap = {};
  var fr = Math.fround;
  var lerp = function (t, a, b) { return fr(a + fr(t * fr(b - a))); };
  var ease = function (v) { var i = fr(1 - v); return fr(1 - fr(fr(fr(i * i) * i) * i)); };
  var cl = function (v) { return v < 0 ? 0 : (v > 1 ? 1 : v); };

  /** DimensionType.computeBrightnessByLightLevel(ambient) */
  LM.brightness = function (level, ambient) {
    var f = fr(level / 15), g = fr(f / fr(4 - fr(3 * f)));
    return lerp(ambient || 0, g, 1);
  };

  /**
   * o: { gamma 0..1, starBrightness, lightning, flicker, nightVision 0..1, skyDarkness, ambient, brighten (nether-like) }.
   * Returns Uint8Array(16*16*3), index (sky*16+block)*3 = r,g,b.
   */
  LM.compute = function (o) {
    var out = new Uint8Array(768), sb = fr(o.starBrightness || 0), nv = o.nightVision || 0, gm = o.gamma === undefined ? 0.5 : o.gamma;
    var sd = o.skyDarkness || 0;
    var s3 = o.lightning ? 1 : fr(fr(sb * 0.95) + 0.05);
    var t = [sb, sb, 1]; for (var q = 0; q < 3; q++) t[q] = lerp(0.35, t[q], 1);
    var fl = fr((o.flicker || 0) + 1.5);
    for (var s = 0; s < 16; s++) for (var b = 0; b < 16; b++) {
      var sk = fr(LM.brightness(s, o.ambient) * s3), bl = fr(LM.brightness(b, o.ambient) * fl);
      var y = fr(bl * fr(fr(fr(bl * 0.6) + 0.4) * 0.6 + 0.4)), z = fr(bl * fr(fr(fr(bl * bl) * 0.6) + 0.4));
      var c = [bl, y, z], k;
      if (o.brighten) { var tg = [0.99, 1.12, 1]; for (k = 0; k < 3; k++) c[k] = lerp(0.25, c[k], tg[k]); }
      else {
        for (k = 0; k < 3; k++) { c[k] = fr(c[k] + fr(t[k] * sk)); c[k] = lerp(0.04, c[k], 0.75); }
        if (sd > 0) { var m = [0.7, 0.6, 0.6]; for (k = 0; k < 3; k++) c[k] = lerp(sd, c[k], fr(c[k] * m[k])); }
      }
      for (k = 0; k < 3; k++) c[k] = cl(c[k]);
      if (nv > 0) {
        var mx = Math.max(c[0], c[1], c[2]);
        if (mx < 1) for (k = 0; k < 3; k++) c[k] = lerp(nv, c[k], fr(c[k] * fr(1 / mx)));
      }
      for (k = 0; k < 3; k++) { c[k] = lerp(gm, c[k], ease(c[k])); c[k] = lerp(0.04, c[k], 0.75); c[k] = cl(c[k]); out[(s * 16 + b) * 3 + k] = Math.trunc(fr(c[k] * 255)); }
    }
    return out;
  };

  /** options.gamma slider text: options.gamma.min / .max / percent between. */
  LM.label = function (g) { return 'Brightness: ' + (g === 0 ? 'Moody' : (g === 1 ? 'Bright' : Math.round(g * 100) + '%')); };
})(MCL);
