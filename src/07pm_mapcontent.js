// 07pm_mapcontent.js — PLAN G18f-b (#229): the rendered terrain pixels of a cartographer's
// exploration map. Ports `MapColor` (the 62-colour table + 4 brightnesses,
// .decomp/net/minecraft/block/MapColor.java), `MapState.of`'s centre snap (MapState.java:64) and
// `FilledMapItem.fillExplorationMap` (FilledMapItem.java:216) -- the treasure-map "sketch": a 128x128
// grid of biome categories, ocean/river/swamp cells painted ORANGE with the edge hatching, land
// touching them BROWN, everything else left CLEAR (0). Cheap: 16 384 biome reads, done lazily
// (`MapContent.colorsFor(tag)`), never at offer-roll time.
//
// Not ported: `updateColors` (the live per-tick terrain scan a HELD map does) -- a different system.

(function (NS) {
  'use strict';

  var MC = NS.MapContent = {};

  // MapColor.java:7-68 -- id -> 0xRRGGBB (CLEAR = id 0, colour 0)
  MC.COLORS = [0, 8368696, 16247203, 13092807, 16711680, 10526975, 10987431, 31744, 16777215, 10791096,
    9923917, 7368816, 4210943, 9402184, 16776437, 14188339, 11685080, 6724056, 15066419, 8375321,
    15892389, 5000268, 10066329, 5013401, 8339378, 3361970, 6704179, 6717235, 10040115, 1644825,
    16445005, 6085589, 4882687, 55610, 8476209, 7340544, 13742497, 10441252, 9787244, 7367818,
    12223780, 6780213, 10505550, 3746083, 8874850, 5725276, 8014168, 4996700, 4993571, 5001770,
    9321518, 2430480, 12398641, 9715553, 6035741, 1474182, 3837580, 5647422, 1356933, 6579300,
    14200723, 8365974];
  MC.CLEAR = 0; MC.BROWN = 26; MC.ORANGE = 15;
  // MapColor.Brightness: id -> brightness (LOW 0/180, NORMAL 1/220, HIGH 2/255, LOWEST 3/135)
  MC.BRIGHTNESS = [180, 220, 255, 135];

  /** MapColor.getRenderColorByte */
  MC.colorByte = function (id, brightnessId) { return ((id << 2) | (brightnessId & 3)) & 0xFF; };

  /** MapColor.getRenderColor(byte) -> 0xAABBGGRR (vanilla's ABGR order), 0 for CLEAR. */
  MC.renderColor = function (b) {
    b &= 0xFF;
    var id = b >> 2;
    if (id === 0 || id >= MC.COLORS.length) return 0;
    var c = MC.COLORS[id], k = MC.BRIGHTNESS[b & 3];
    var r = Math.floor((c >> 16 & 255) * k / 255), g = Math.floor((c >> 8 & 255) * k / 255),
        bl = Math.floor((c & 255) * k / 255);
    return (0xFF000000 | bl << 16 | g << 8 | r) >>> 0;
  };

  /** MapState.of's centre snap (MapState.java:64-71). */
  MC.center = function (x, z, scale) {
    var s = 128 * (1 << scale);
    return { x: Math.floor((x + 64) / s) * s + s / 2 - 64, z: Math.floor((z + 64) / s) * s + s / 2 - 64 };
  };

  // MathHelper.sin (float, table lookup) -- only ever fed integer-valued floats here
  var SINE = null;
  function sin(x) {
    if (!SINE) {
      SINE = new Float32Array(65536);
      for (var i = 0; i < 65536; i++) SINE[i] = Math.sin(i * Math.PI * 2 / 65536);
    }
    return SINE[Math.trunc(Math.fround(x * 10430.378)) & 65535];
  }

  /** category name at world (x, z), biome sampled at y=0 like `getBiome(mutable.set(x, 0, z))`. */
  MC.categoryAt = function (x, z) {
    var b = NS.Biomes.at(NS.Climate.biomeAt(x, 0, z));
    return b.category;
  };

  /**
   * fillExplorationMap (FilledMapItem.java:216-289): -> Uint8Array(16384) of map colour bytes.
   * `catAt(x, z)` overrides the biome source (the check drives it with a synthetic world).
   */
  MC.fillExploration = function (scale, centerX, centerZ, catAt) {
    catAt = catAt || MC.categoryAt;
    var sc = 1 << scale, colors = new Uint8Array(16384), aq = new Uint8Array(16384);
    var x0 = Math.trunc(centerX / sc) - 64, z0 = Math.trunc(centerZ / sc) - 64, i, j;
    for (i = 0; i < 128; i++) {
      for (j = 0; j < 128; j++) {
        var c = catAt((x0 + j) * sc, (z0 + i) * sc);
        aq[i * 128 + j] = (c === 'ocean' || c === 'river' || c === 'swamp') ? 1 : 0;
      }
    }
    for (var px = 1; px < 127; px++) {
      for (var py = 1; py < 127; py++) {
        var n = 0, dx, dy;
        for (dx = -1; dx < 2; dx++) for (dy = -1; dy < 2; dy++) {
          if ((dx !== 0 || dy !== 0) && aq[(py + dy) * 128 + px + dx]) n++;
        }
        var br = 3, col = MC.CLEAR;
        if (aq[py * 128 + px]) {
          col = MC.ORANGE;
          if (n > 7 && py % 2 === 0) {
            switch (Math.trunc((px + Math.trunc(sin(py + 0) * 7)) / 8) % 5) {
              case 0: case 4: br = 0; break;
              case 1: case 3: br = 1; break;
              case 2: br = 2; break;
            }
          } else if (n > 7) col = MC.CLEAR;
          else if (n > 5) br = 1;
          else if (n > 3) br = 0;
          else if (n > 1) br = 0;
        } else if (n > 0) {
          col = MC.BROWN;
          br = n > 3 ? 1 : 3;
        }
        if (col !== MC.CLEAR) colors[py * 128 + px] = MC.colorByte(col, br);
      }
    }
    return colors;
  };

  var cache = {};
  /** The map's pixels for a `Trade.rollMap` tag (`{scale, target}`), memoised per (scale, centre). */
  MC.colorsFor = function (tag) {
    if (!tag || !tag.target) return null;
    var sc = tag.scale | 0, c = MC.center(tag.target.x, tag.target.z, sc);
    var k = sc + ':' + c.x + ':' + c.z;
    return cache[k] || (cache[k] = MC.fillExploration(sc, c.x, c.z));
  };
})(MCL);
