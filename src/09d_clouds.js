// 09d_clouds.js — G17-CL1: the sky clouds (WorldRenderer.renderClouds, .decomp/net/minecraft/client/render/
// WorldRenderer.java:1960-2290). Runs on: MAIN THREAD ONLY.
// PARITY: the cell grid (textures/environment/clouds.png, 256x256, one bit per cell = alpha), the 12-block
// cell, the 0.03 blocks/tick drift, the height (DimensionEffects: 192.0 overworld, NaN nether/end - NOT 128),
// the 4-block slab, alpha 0.8, the face shades (top 1.0, sides 0.9/0.8, bottom 0.7) and ClientWorld.getCloudsColor.
// CHEAP: the picture is one VBO of the vanilla vertex loop, rebuilt only when vanilla rebuilds it, drawn by both
// backends with the same shader maths. NS.DATA.cloudBits = deflated 256*256/8 bytes (tools/extract-clouds.mjs).
(function (NS) {
  'use strict';
  var Cl = NS.Clouds = {
    SIZE: 256, CELL: 12, THICKNESS: 4, SPEED: 0.03, ALPHA: 0.8, HEIGHT_OVERWORLD: 192.0,
    EPS: 9.765625e-4, TEX_SCALE: 0.00390625, ALPHA_DISCARD: 0.1,
    VERTEX_FLOATS: 9,   // x y z u v r g b a
    drawnQuads: 0
  };
  var fr = Math.fround;

  var bits = null;
  Cl.setBits = function (b) { bits = b; };
  function loadBits() {
    if (bits) return bits;
    var d = NS.DATA;
    if (d && d.cloudBits && NS.Z) bits = NS.Z.unpack(d.cloudBits, d.cloudBitsBytes || 8192);
    return bits;
  }
  /** Is texel (x, z) a cloud? Wraps like the REPEAT sampler does. */
  Cl.cellAt = function (x, z) {
    var b = loadBits(); if (!b) return false;
    x = ((x % 256) + 256) % 256; z = ((z % 256) + 256) % 256;
    var i = z * 256 + x;
    return (b[i >> 3] >> (i & 7) & 1) === 1;
  };
  /** `DimensionEffects.getCloudsHeight()`; NaN = no clouds. */
  Cl.height = function (dimName) { return dimName === 'overworld' || dimName == null ? Cl.HEIGHT_OVERWORLD : NaN; };

  /** `ClientWorld.getCloudsColor(tickDelta)`, all float. skyAngle/rain/thunder are the lerped gradients. */
  Cl.color = function (skyAngle, rain, thunder) {
    var Sky = NS.Sky, cos = Sky && Sky.mthCos ? Sky.mthCos : Math.cos;
    var k = fr(fr(cos(fr(skyAngle * fr(Math.PI * 2))) * 2) + 0.5);
    k = k < 0 ? 0 : k > 1 ? 1 : k;
    var r = 1, g = 1, b = 1;
    if (rain > 0) {
      var l = fr(fr(fr(r * 0.3) + fr(g * 0.59) + fr(b * 0.11)) * 0.6), f = fr(1 - fr(rain * 0.95));
      r = fr(fr(r * f) + fr(l * fr(1 - f))); g = fr(fr(g * f) + fr(l * fr(1 - f))); b = fr(fr(b * f) + fr(l * fr(1 - f)));
    }
    r = fr(r * fr(fr(k * 0.9) + 0.1)); g = fr(g * fr(fr(k * 0.9) + 0.1)); b = fr(b * fr(fr(k * 0.85) + 0.15));
    if (thunder > 0) {
      var l2 = fr(fr(fr(r * 0.3) + fr(g * 0.59) + fr(b * 0.11)) * 0.2), f2 = fr(1 - fr(thunder * 0.95));
      r = fr(fr(r * f2) + fr(l2 * fr(1 - f2))); g = fr(fr(g * f2) + fr(l2 * fr(1 - f2))); b = fr(fr(b * f2) + fr(l2 * fr(1 - f2)));
    }
    return [r, g, b];
  };

  /** The per-frame placement (renderClouds lines 1970-1984): returns the integer cell the mesh depends on and the shift. */
  Cl.place = function (ticks, partial, camX, camY, camZ, height) {
    var drift = fr(fr(ticks + partial) * fr(0.03));
    var x = (camX + drift) / 12, y = fr(height) - fr(camY) + fr(0.33), z = camZ / 12 + fr(0.33);
    x -= Math.floor(x / 2048) * 2048; z -= Math.floor(z / 2048) * 2048;
    return {
      x: x, y: y, z: z,
      fx: fr(x - Math.floor(x)), fy: fr(fr(y / 4 - Math.floor(y / 4)) * 4), fz: fr(z - Math.floor(z)),
      bx: Math.floor(x), by: Math.floor(y / 4), bz: Math.floor(z)
    };
  };

  /** The vanilla vertex loop (renderClouds(BufferBuilder...)): flat float list, 4 verts per quad. */
  Cl.build = function (x, y, z, rgb, fancy) {
    var out = [], S = Cl.TEX_SCALE, E = Cl.EPS, A = Cl.ALPHA;
    var u0 = Math.floor(x) * S, v0 = Math.floor(z) * S;
    var r = rgb[0], g = rgb[1], b = rgb[2];
    var yy = Math.floor(y / 4) * 4;
    function q(c, n, pts) {   // pts: [px,py,pz,tu,tv] x4
      for (var i = 0; i < 4; i++) { var p = pts[i]; out.push(p[0], p[1], p[2], p[3] * S + u0, p[4] * S + v0, c[0], c[1], c[2], A); }
    }
    var top = [r, g, b], bot = [fr(r * 0.7), fr(g * 0.7), fr(b * 0.7)], sx = [fr(r * 0.9), fr(g * 0.9), fr(b * 0.9)], sz = [fr(r * 0.8), fr(g * 0.8), fr(b * 0.8)];
    if (!fancy) {
      for (var a = -32; a < 32; a += 32) for (var c = -32; c < 32; c += 32)
        q(top, 0, [[a, yy, c + 32, a, c + 32], [a + 32, yy, c + 32, a + 32, c + 32], [a + 32, yy, c, a + 32, c], [a, yy, c, a, c]]);
      return out;
    }
    for (var i = -3; i <= 4; i++) for (var j = -3; j <= 4; j++) {
      var X = i * 8, Z = j * 8, k;
      if (yy > -5) q(bot, 0, [[X, yy, Z + 8, X, Z + 8], [X + 8, yy, Z + 8, X + 8, Z + 8], [X + 8, yy, Z, X + 8, Z], [X, yy, Z, X, Z]]);
      if (yy <= 5) { var yt = yy + 4 - E;
        q(top, 0, [[X, yt, Z + 8, X, Z + 8], [X + 8, yt, Z + 8, X + 8, Z + 8], [X + 8, yt, Z, X + 8, Z], [X, yt, Z, X, Z]]); }
      if (i > -1) for (k = 0; k < 8; k++) q(sx, 0, [[X + k, yy, Z + 8, X + k + 0.5, Z + 8], [X + k, yy + 4, Z + 8, X + k + 0.5, Z + 8], [X + k, yy + 4, Z, X + k + 0.5, Z], [X + k, yy, Z, X + k + 0.5, Z]]);
      if (i <= 1) for (k = 0; k < 8; k++) { var xe = X + k + 1 - E;
        q(sx, 0, [[xe, yy, Z + 8, X + k + 0.5, Z + 8], [xe, yy + 4, Z + 8, X + k + 0.5, Z + 8], [xe, yy + 4, Z, X + k + 0.5, Z], [xe, yy, Z, X + k + 0.5, Z]]); }
      if (j > -1) for (k = 0; k < 8; k++) q(sz, 0, [[X, yy + 4, Z + k, X, Z + k + 0.5], [X + 8, yy + 4, Z + k, X + 8, Z + k + 0.5], [X + 8, yy, Z + k, X + 8, Z + k + 0.5], [X, yy, Z + k, X, Z + k + 0.5]]);
      if (j <= 1) for (k = 0; k < 8; k++) { var ze = Z + k + 1 - E;
        q(sz, 0, [[X, yy + 4, ze, X, Z + k + 0.5], [X + 8, yy + 4, ze, X + 8, Z + k + 0.5], [X + 8, yy, ze, X + 8, Z + k + 0.5], [X, yy, ze, X, Z + k + 0.5]]); }
    }
    return out;
  };

  // ── the live state: what renderClouds recomputes each frame, rebuilding the buffer only when vanilla does ──
  var cache = { key: '', verts: null, n: 0 };
  Cl.live = function (cam) {
    var Sky = NS.Sky, M = NS.Main, S = NS.Settings, D = NS.Dim;
    var wx = Sky && Sky.weather;
    if (!wx || !cam || !cam.viewProj) return null;
    var h = Cl.height(D && D.cur);
    if (h !== h) return null;
    var partial = M && M.partial ? M.partial() : 0, ticks = M ? M.ticks | 0 : 0;
    var rain = (wx.oRainLevel || 0) + ((wx.rainLevel || 0) - (wx.oRainLevel || 0)) * partial;
    var th = (wx.oThunderLevel || 0) + ((wx.thunderLevel || 0) - (wx.oThunderLevel || 0)) * partial;
    var ang = Sky.skyAngleF ? Sky.skyAngleF(Sky.dayTime) : 0;
    var rgb = Cl.color(ang, rain, th * rain);
    var p = Cl.place(ticks, partial, cam.x, cam.y, cam.z, h), fancy = Cl.mode() === 2;
    var last = cache.rgb, moved = !last || (last[0] - rgb[0]) * (last[0] - rgb[0]) + (last[1] - rgb[1]) * (last[1] - rgb[1]) + (last[2] - rgb[2]) * (last[2] - rgb[2]) > 2e-4;
    var key = p.bx + ',' + p.by + ',' + p.bz + ',' + fancy;
    if (key !== cache.key || moved) {
      cache.key = key; cache.rgb = rgb;
      cache.verts = new Float32Array(Cl.build(p.x, p.y, p.z, rgb, fancy)); cache.n = cache.verts.length / (4 * Cl.VERTEX_FLOATS);
    }
    return { p: p, fancy: fancy, verts: cache.verts, n: cache.n, key: cache.key };
  };
  Cl._resetForTest = function () { cache = { key: '', verts: null, n: 0 }; };

  function texRGBA() {
    var b = loadBits(); if (!b) return null;
    var px = new Uint8Array(256 * 256 * 4);
    for (var i = 0; i < 65536; i++) if (b[i >> 3] >> (i & 7) & 1) { px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = 255; px[i * 4 + 3] = 255; }
    return px;
  }
  var idxCache = null;
  function indices(n) {
    if (idxCache && idxCache.length >= n * 6) return idxCache;
    var idx = new Uint16Array(n * 6);
    for (var i = 0; i < n; i++) { var v = i * 4, o = i * 6; idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2; idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3; }
    return (idxCache = idx);
  }
  // the shared shader maths: model = scale(12,1,12) * translate(-fx, fy, -fz), camera-relative like 09c
  var VS_BODY = 'vec4(((aPos + uOff) * vec3(12.0, 1.0, 12.0)), 1.0)';
  var DISC = Cl.ALPHA_DISCARD.toFixed(3);

  // ── WebGL2 ──
  var gl2 = { prog: null };
  function glEnsure(gl) {
    if (gl2.prog) return true;
    var px = texRGBA(); if (!px) return false;
    try {
      var sh = function (t, s) { var o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error('Clouds shader: ' + gl.getShaderInfoLog(o)); return o; };
      var prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, ['#version 300 es', 'precision highp float;', 'in vec3 aPos;', 'in vec2 aUV;', 'in vec4 aCol;',
        'uniform mat4 uVP;', 'uniform vec3 uOff;', 'out vec2 vUV;', 'out vec4 vCol;',
        'void main() { vUV = aUV; vCol = aCol; gl_Position = uVP * ' + VS_BODY + '; }'].join('\n')));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, ['#version 300 es', 'precision highp float;', 'in vec2 vUV;', 'in vec4 vCol;', 'uniform sampler2D uTex;', 'out vec4 fragColor;',
        'void main() { vec4 c = texture(uTex, vUV) * vCol; if (c.a < ' + DISC + ') discard; fragColor = c; }'].join('\n')));
      gl.bindAttribLocation(prog, 0, 'aPos'); gl.bindAttribLocation(prog, 1, 'aUV'); gl.bindAttribLocation(prog, 2, 'aCol');
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('Clouds program: ' + gl.getProgramInfoLog(prog));
      gl2.uVP = gl.getUniformLocation(prog, 'uVP'); gl2.uOff = gl.getUniformLocation(prog, 'uOff'); gl2.uTex = gl.getUniformLocation(prog, 'uTex');
      gl2.vbuf = gl.createBuffer(); gl2.ibuf = gl.createBuffer(); gl2.key = null;
      gl2.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, gl2.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl2.prog = prog; return true;
    } catch (err) { Cl.glError = (err && err.message) || String(err); return false; }
  }
  Cl.renderGL2 = function (G, cam, L) {
    var gl = G.backend && G.backend.gl; if (!gl || !glEnsure(gl)) return;
    var hadBlend = gl.isEnabled(gl.BLEND), hadCull = gl.isEnabled(gl.CULL_FACE), hadMask = gl.getParameter(gl.DEPTH_WRITEMASK);
    gl.useProgram(gl2.prog);
    gl.uniformMatrix4fv(gl2.uVP, false, cam.viewProj); gl.uniform3f(gl2.uOff, -L.p.fx, L.p.fy, -L.p.fz); gl.uniform1i(gl2.uTex, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl2.vbuf);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl2.ibuf);
    if (gl2.key !== L.key + '|' + L.verts.length || gl2.verts !== L.verts) {
      gl.bufferData(gl.ARRAY_BUFFER, L.verts, gl.DYNAMIC_DRAW); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices(L.n), gl.DYNAMIC_DRAW);
      gl2.key = L.key + '|' + L.verts.length; gl2.verts = L.verts;
    }
    var st = Cl.VERTEX_FLOATS * 4;
    for (var k = 0; k < 3; k++) gl.enableVertexAttribArray(k);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, st, 0); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, st, 12); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, st, 20);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, gl2.tex);
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE); gl.depthMask(true);
    for (var pass = L.fancy ? 0 : 1; pass < 2; pass++) {   // vanilla: a depth-only pass first, so inner faces do not double-blend
      gl.colorMask(pass === 1, pass === 1, pass === 1, pass === 1);
      gl.drawElements(gl.TRIANGLES, L.n * 6, gl.UNSIGNED_SHORT, 0);
    }
    gl.colorMask(true, true, true, true);
    for (k = 0; k < 3; k++) gl.disableVertexAttribArray(k);
    gl.depthMask(hadMask); if (!hadBlend) gl.disable(gl.BLEND); if (hadCull) gl.enable(gl.CULL_FACE);
    Cl.drawnQuads = L.n;
  };

  // ── WebGPU ──
  var gpu = { device: null };
  function gpuEnsure(device, format) {
    if (gpu.device === device && gpu.pipe) return true;
    var px = texRGBA(); if (!px) return false;
    try {
      var code = ['struct U { vp : mat4x4<f32>, off : vec4<f32> };', '@group(0) @binding(0) var<uniform> u : U;',
        '@group(0) @binding(1) var uTex : texture_2d<f32>;', '@group(0) @binding(2) var uSamp : sampler;',
        'struct VOut { @builtin(position) pos : vec4<f32>, @location(0) uv : vec2<f32>, @location(1) col : vec4<f32> };',
        '@vertex fn vs_c(@location(0) p : vec3<f32>, @location(1) uv : vec2<f32>, @location(2) c : vec4<f32>) -> VOut {',
        '  var o : VOut; o.pos = u.vp * vec4<f32>((p + u.off.xyz) * vec3<f32>(12.0, 1.0, 12.0), 1.0); o.uv = uv; o.col = c; return o; }',
        '@fragment fn fs_c(v : VOut) -> @location(0) vec4<f32> {',
        '  let c = textureSample(uTex, uSamp, v.uv) * v.col; if (c.a < ' + DISC + ') { discard; } return c; }'].join('\n');
      var module = device.createShaderModule({ code: code });
      var bgl = device.createBindGroupLayout({ entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }] });
      var mk = function (mask) {
        return device.createRenderPipeline({
          layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
          vertex: { module: module, entryPoint: 'vs_c', buffers: [{ arrayStride: Cl.VERTEX_FLOATS * 4, attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x2' }, { shaderLocation: 2, offset: 20, format: 'float32x4' }] }] },
          fragment: { module: module, entryPoint: 'fs_c', targets: [{ format: format, writeMask: mask, blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } }] },
          primitive: { topology: 'triangle-list', cullMode: 'none' },
          depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' } });
      };
      gpu.pipe = mk(GPUColorWrite.ALL); gpu.pipeDepth = mk(0);
      gpu.ub = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      var t = device.createTexture({ size: [256, 256, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      device.queue.writeTexture({ texture: t }, px, { bytesPerRow: 1024, rowsPerImage: 256 }, [256, 256, 1]);
      var samp = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest', addressModeU: 'repeat', addressModeV: 'repeat' });
      gpu.bg = device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: gpu.ub } }, { binding: 1, resource: t.createView() }, { binding: 2, resource: samp }] });
      gpu.vb = null; gpu.ib = null; gpu.verts = null; gpu.device = device; return true;
    } catch (err) { Cl.gpuError = (err && err.message) || String(err); return false; }
  }
  Cl.renderGPU = function (G, cam, L) {
    var P = G.backend; if (!P || !P.device || !P.pass || P.lost || !gpuEnsure(P.device, P.format)) return;
    var d = P.device;
    if (gpu.verts !== L.verts) {
      gpu.verts = L.verts;
      var idx = indices(L.n);
      gpu.vb = d.createBuffer({ size: L.verts.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      d.queue.writeBuffer(gpu.vb, 0, L.verts.buffer, L.verts.byteOffset, L.verts.byteLength);
      var ib = Math.ceil(L.n * 12 / 4) * 4;
      gpu.ib = d.createBuffer({ size: ib, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
      d.queue.writeBuffer(gpu.ib, 0, idx.buffer, idx.byteOffset, ib);
    }
    var u = new Float32Array(20); u.set(cam.viewProj, 0); u[16] = -L.p.fx; u[17] = L.p.fy; u[18] = -L.p.fz;
    d.queue.writeBuffer(gpu.ub, 0, u.buffer, 0, 80);
    P.pass.setIndexBuffer(gpu.ib, 'uint16'); P.pass.setVertexBuffer(0, gpu.vb); P.pass.setBindGroup(0, gpu.bg);
    if (L.fancy) { P.pass.setPipeline(gpu.pipeDepth); P.pass.drawIndexed(L.n * 6); }
    P.pass.setPipeline(gpu.pipe); P.pass.drawIndexed(L.n * 6);
    Cl.drawnQuads = L.n;
  };

  /** `GameOptions.getCloudRenderMode()`: the chosen mode (0 Off, 1 Fast, 2 Fancy), forced Off under a render distance of 4. */
  Cl.mode = function () {
    var s = NS.Settings;
    if (s && s.renderDistance < 4) return 0;
    var m = s && s.cloudRenderMode != null ? s.cloudRenderMode | 0 : 2;
    return m < 0 || m > 2 ? 2 : m;
  };

  /** `10_gfx.js`'s one hook, before the weather pass (vanilla: renderClouds runs before renderWeather). */
  Cl.render = function (G, cam) {
    Cl.drawnQuads = 0;
    if (!G || Cl.mode() === 0 || !loadBits()) return;
    var L = Cl.live(cam); if (!L) return;
    if (G.name === 'webgpu') Cl.renderGPU(G, cam, L); else if (G.name === 'webgl2') Cl.renderGL2(G, cam, L);
  };
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
