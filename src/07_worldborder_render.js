// 07_worldborder_render.js — G17-WB6 (#8314): WorldRenderer.renderWorldBorder as a PURE function (Yarn 1.18.2).
// Returns the forcefield quads, the uv scroll and the RGBA; WebGL2 and WebGPU both just upload the result.
(function (NS) {
  'use strict';
  // WorldBorderStage.getColor: GROWING 4259712 (0x40FF80), SHRINKING 16724016 (0xFF3030), STATIONARY 2138367 (0x20A0FF)
  var STAGE_COLOR = { growing: 0x40FF80, shrinking: 0xFF3030, stationary: 0x20A0FF };
  /**
   * b = {west,east,north,south,stage,distanceInside(x,z)}; cam = {x,y,z}; viewDist in chunks; far = gameRenderer far plane.
   * Returns null beyond render distance of every edge, else {quads:[[x,y,z,u,v]x4...], scroll, rgba:[r,g,b,a]}.
   */
  function worldBorderQuads(b, cam, viewDist, timeMs, far, colors) {
    var d = viewDist * 16, x = cam.x, z = cam.z;
    if (x < b.east - d && x > b.west + d && z < b.south - d && z > b.north + d) return null;
    var a = Math.pow(1 - b.distanceInside(x, z) / d, 4); a = a < 0 ? 0 : a > 1 ? 1 : a;
    var col = (colors || STAGE_COLOR)[b.stage];
    var t = (timeMs % 3000) / 3000, fy = cam.y - Math.floor(cam.y), v1 = far - fy, q = [];
    function wall(fixed, alongX, lo, hi, sign, dirOff) {
      var off = 0;
      for (var p = lo; p < hi; p++, off += 0.5) {
        var s = Math.min(1, hi - p), w = s * 0.5, u0 = t + sign * off, u1 = t + sign * (w + off), A = alongX ? p - x : p - z, B = alongX ? p + s - x : p + s - z;
        var F = fixed - (alongX ? z : x);
        if (alongX) q.push([[A, -far, F, u0, t + v1], [B, -far, F, u1, t + v1], [B, far, F, u1, t], [A, far, F, u0, t]]);
        else q.push([[F, -far, A, u0, t + v1], [F, -far, B, u1, t + v1], [F, far, B, u1, t], [F, far, A, u0, t]]);
      }
    }
    var lo = Math.max(Math.floor(z - d), b.north), hi = Math.min(Math.ceil(z + d), b.south);
    if (x > b.east - d) wall(b.east, false, lo, hi, -1);
    if (x < b.west + d) wall(b.west, false, lo, hi, 1);
    lo = Math.max(Math.floor(x - d), b.west); hi = Math.min(Math.ceil(x + d), b.east);
    if (z > b.south - d) wall(b.south, true, lo, hi, 1);
    if (z < b.north + d) wall(b.north, true, lo, hi, -1);
    return { quads: q, scroll: t, rgba: [(col >> 16 & 255) / 255, (col >> 8 & 255) / 255, (col & 255) / 255, a] };
  }
  /** The draw: flat-tinted translucent walls through the end-crystal beam pass (depth-tested, no cull, alpha blend); WebGL2 + WebGPU. */
  function render(G, cam) {
    var WB = NS.World && NS.World.border, ER = NS.EntityRender;
    if (!WB || !ER || !ER.renderCrystalBeamsGL2 || !cam || !cam.viewProj || WorldBorderRender.off) return;
    var b = { west: WB.west(), east: WB.east(), north: WB.north(), south: WB.south(), stage: WB.stage(), distanceInside: WB.distanceInside };
    var r = worldBorderQuads(b, cam, (NS.Settings && NS.Settings.renderDistance) || 8, Date.now(), 256);
    if (!r || !r.quads.length || !(r.rgba[3] > 0)) return;
    var v = [], c = r.rgba;
    for (var i = 0; i < r.quads.length; i++) for (var k = 0; k < 4; k++) { var p = r.quads[i][k]; v.push(p[0] + cam.x, p[1] + cam.y, p[2] + cam.z, c[0], c[1], c[2], c[3]); }
    if (G.name === 'webgpu') ER.renderCrystalBeamsGPU(G, cam, 1, v);
    else if (G.name === 'webgl2') ER.renderCrystalBeamsGL2(G, cam, 1, v);
  }
  var WorldBorderRender;
  NS.WorldBorderRender = WorldBorderRender = { render: render, STAGE_COLOR: STAGE_COLOR, quads: worldBorderQuads };
  if (typeof module !== 'undefined') module.exports = NS.WorldBorderRender;
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
