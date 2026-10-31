// 07zzu_hitbox.js -- #7886 (G17-H1): F3+B entity hitboxes. Pure line-list builder, no DOM.
// Port of EntityRenderDispatcher.renderHitbox + WorldRenderer.drawBox(MatrixStack, VertexConsumer, ...): each box is 24 line
// vertices (12 edges), vertex order transcribed from the jar; the colour of every vertex of one box is its (r,g,b,a).
(function (NS) {
  'use strict';

  var Hb = NS.Hitbox = { ready: true, on: false };
  var F = Math.fround;

  // drawBox vertex order as indices [x, y, z] into (min, max): x 0|3, y 1|4, z 2|5 of [minX,minY,minZ,maxX,maxY,maxZ]
  Hb.BOX_ORDER = [[0,1,2],[3,1,2],[0,1,2],[0,4,2],[0,1,2],[0,1,5],[3,1,2],[3,4,2],[3,4,2],[0,4,2],[0,4,2],[0,4,5],
                  [0,4,5],[0,1,5],[0,1,5],[3,1,5],[3,1,5],[3,1,2],[0,4,5],[3,4,5],[3,1,5],[3,4,5],[3,4,2],[3,4,5]];

  Hb.drawBox = function (out, b, r, g, bl, a, ox, oy, oz) {
    ox = ox || 0; oy = oy || 0; oz = oz || 0;
    for (var i = 0; i < 24; i++) {
      var o = Hb.BOX_ORDER[i];
      out.push({ p: [F(b[o[0]] + ox), F(b[o[1]] + oy), F(b[o[2]] + oz)], c: [r, g, bl, a] });
    }
  };

  /**
   * e: { x, y, z, box:[minX..maxZ] (world), eye (standing eye height), living, look:[x,y,z] (unit rotation vec),
   *      parts?:[{ x, y, z, box }] (ender dragon body parts, world coords; lerp already applied) }
   * Returns vertices relative to the entity's feet (the matrix stack of renderHitbox).
   */
  Hb.lines = function (e) {
    var out = [], b = [e.box[0] - e.x, e.box[1] - e.y, e.box[2] - e.z, e.box[3] - e.x, e.box[4] - e.y, e.box[5] - e.z];
    Hb.drawBox(out, b, 1, 1, 1, 1);
    if (e.parts) for (var i = 0; i < e.parts.length; i++) {
      var p = e.parts[i], pb = p.box;
      Hb.drawBox(out, [pb[0] - p.x, pb[1] - p.y, pb[2] - p.z, pb[3] - p.x, pb[4] - p.y, pb[5] - p.z], 0.25, 1, 0, 1,
                 p.x - e.x, p.y - e.y, p.z - e.z);
    }
    if (e.living) {
      Hb.drawBox(out, [b[0], F(e.eye - F(0.01)), b[2], b[3], F(e.eye + F(0.01)), b[5]], 1, 0, 0, 1);
    }
    var L = e.look;
    out.push({ p: [0, F(e.eye), 0], c: [0, 0, 255, 255] });
    out.push({ p: [F(L[0] * 2), F(e.eye + L[1] * 2), F(L[2] * 2)], c: [0, 0, 255, 255] });
    return out;
  };

  /** F3+B: toggles and returns the chat text (DebugHud: debug.show_hitboxes.on / .off). */
  Hb.toggle = function () {
    Hb.on = !Hb.on;
    var s = Hb.on ? 'Hitboxes: shown' : 'Hitboxes: hidden';
    if (NS.Chat && NS.Chat.say) NS.Chat.say(s);
    return s;
  };
})(typeof MCL !== 'undefined' ? MCL : globalThis);
