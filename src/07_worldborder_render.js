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
  // textures/misc/forcefield.png (16x16, read off the 1.18.2 jar): 5 distinct texels -> palette + one index per texel.
  var FF_PAL = [[201,201,201,171],[174,174,174,156],[179,179,179,126],[153,153,153,60],[0,0,0,0]];
  var FF_IDX = '0123444401234444123444401234444023444401234444013444401234444012444401234444012344401234444012344401234444012344401234444012344401234444012344441234444012344440234444012344440134444012344440124444012344440123444012344440123444012344440123444012344440123444';
  function forcefieldTexels() {
    var o = new Uint8Array(1024);
    for (var i = 0; i < 256; i++) { var c = FF_PAL[FF_IDX.charCodeAt(i) - 48]; o[i * 4] = c[0]; o[i * 4 + 1] = c[1]; o[i * 4 + 2] = c[2]; o[i * 4 + 3] = c[3]; }
    return o;
  }
  // WebGL2 textured wall program: vertex = pos3 uv2 rgba4; fragment = texture * tint (position_tex shader, ColorModulator).
  var gl2 = { prog: null, tex: null, vbuf: null, ibuf: null, gl: null };
  function ensureGL2(gl) {
    if (gl2.prog && gl2.gl === gl) return true;
    try {
      function sh(t, src) { var o = gl.createShader(t); gl.shaderSource(o, src); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; }
      var vs = sh(gl.VERTEX_SHADER, '#version 300 es\nprecision highp float;\nin vec3 aPos;in vec2 aUv;in vec4 aColor;uniform mat4 uViewProj;out vec2 vUv;out vec4 vColor;\nvoid main(){vUv=aUv;vColor=aColor;gl_Position=uViewProj*vec4(aPos,1.0);}');
      var fs = sh(gl.FRAGMENT_SHADER, '#version 300 es\nprecision highp float;\nin vec2 vUv;in vec4 vColor;uniform sampler2D uTex;out vec4 fragColor;\nvoid main(){fragColor=texture(uTex,vUv)*vColor;}');
      var pr = gl.createProgram(); gl.attachShader(pr, vs); gl.attachShader(pr, fs);
      gl.bindAttribLocation(pr, 0, 'aPos'); gl.bindAttribLocation(pr, 1, 'aUv'); gl.bindAttribLocation(pr, 2, 'aColor');
      gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
      var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 16, 16, 0, gl.RGBA, gl.UNSIGNED_BYTE, forcefieldTexels());
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl2.prog = pr; gl2.tex = t; gl2.gl = gl; gl2.vbuf = gl.createBuffer(); gl2.ibuf = gl.createBuffer();
      gl2.uVP = gl.getUniformLocation(pr, 'uViewProj'); gl2.uTex = gl.getUniformLocation(pr, 'uTex');
      return true;
    } catch (e) { WorldBorderRender.glError = String(e && e.message || e); gl2.prog = null; return false; }
  }
  function drawTexturedGL2(G, cam, verts) {   // verts: x,y,z,u,v,r,g,b,a per vertex, 4 per quad
    var gl = G.backend.gl, n = verts.length / 36;
    if (!ensureGL2(gl)) return false;
    var idx = new Uint16Array(n * 6);
    for (var i = 0; i < n; i++) { var o = i * 4; idx.set([o, o + 1, o + 2, o, o + 2, o + 3], i * 6); }
    gl.useProgram(gl2.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl2.vbuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl2.ibuf); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.enableVertexAttribArray(1); gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 36, 0); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 36, 12); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 36, 20);
    gl.uniformMatrix4fv(gl2.uVP, false, cam.viewProj);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, gl2.tex); gl.uniform1i(gl2.uTex, 0);
    gl.disable(gl.CULL_FACE); gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.drawElements(gl.TRIANGLES, n * 6, gl.UNSIGNED_SHORT, 0);
    gl.depthMask(true); gl.disable(gl.BLEND); gl.enable(gl.CULL_FACE);
    gl.disableVertexAttribArray(0); gl.disableVertexAttribArray(1); gl.disableVertexAttribArray(2);
    return true;
  }
  /** The draw: flat-tinted translucent walls through the end-crystal beam pass (depth-tested, no cull, alpha blend); WebGL2 + WebGPU. */
  function render(G, cam) {
    var WB = NS.World && NS.World.border, ER = NS.EntityRender;
    if (!WB || !ER || !ER.renderCrystalBeamsGL2 || !cam || !cam.viewProj || WorldBorderRender.off) return;
    var b = { west: WB.west(), east: WB.east(), north: WB.north(), south: WB.south(), stage: WB.stage(), distanceInside: WB.distanceInside };
    var r = worldBorderQuads(b, cam, (NS.Settings && NS.Settings.renderDistance) || 8, Date.now(), 256);
    if (!r || !r.quads.length || !(r.rgba[3] > 0)) return;
    var v = [], c = r.rgba;
    if (G.name === 'webgl2' && G.backend && G.backend.gl) {
      var tv = [];
      for (var j = 0; j < r.quads.length; j++) for (var m = 0; m < 4; m++) { var q = r.quads[j][m]; tv.push(q[0] + cam.x, q[1] + cam.y, q[2] + cam.z, q[3], q[4], c[0], c[1], c[2], c[3]); }
      if (drawTexturedGL2(G, cam, tv)) return;
    }
    for (var i = 0; i < r.quads.length; i++) for (var k = 0; k < 4; k++) { var p = r.quads[i][k]; v.push(p[0] + cam.x, p[1] + cam.y, p[2] + cam.z, c[0], c[1], c[2], c[3]); }
    if (G.name === 'webgpu') ER.renderCrystalBeamsGPU(G, cam, 1, v);
    else if (G.name === 'webgl2') ER.renderCrystalBeamsGL2(G, cam, 1, v);
  }
  var WorldBorderRender;
  NS.WorldBorderRender = WorldBorderRender = { render: render, forcefieldTexels: forcefieldTexels, FF_PAL: FF_PAL, FF_IDX: FF_IDX, STAGE_COLOR: STAGE_COLOR, quads: worldBorderQuads };
  if (typeof module !== 'undefined') module.exports = NS.WorldBorderRender;
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
