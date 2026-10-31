// 09c_weather.js — PLAN G20 (D-655): the RAIN and SNOW you can see. `09b_sky.js` already runs the
// weather machine (rain/thunder timers, the 0..1 ramps, the sky/fog/light darkening); nothing drew
// the falling streaks. This is `WorldRenderer.renderWeather` (.decomp/net/minecraft/client/render/
// WorldRenderer.java:247-397) and its offset table (:223-239), read in full.
// Runs on: MAIN THREAD ONLY. No DOM.
//
// THE RULE, as vanilla has it (every number below is that file's):
//   * nothing at all while the rain gradient (lerp(oRainLevel, rainLevel, partial)) is <= 0;
//   * a square of columns, radius 5, or 10 when graphics is Fancy or better (here: the Graphics
//     option, `Settings.fancyLeaves`, the one Fast/Fancy switch this engine has);
//   * a column is skipped in a biome with no precipitation, and when the camera's +-radius band
//     lies wholly under the MOTION_BLOCKING top (both ends clamp up to it and meet);
//   * each column is ONE quad, crossed to the camera: its half-width offset is the (x,z) unit
//     vector rotated 90 degrees, times 0.5 (`field_20794/20795`); the camera's own column has a
//     0/0 = NaN offset in vanilla and so draws nothing — reproduced, not "fixed";
//   * rain vs snow by `Biome.doesNotSnow` at the band's LOWER end (temperature >= 0.15:
//     `Biomes.warmEnoughToRain`, the one copy of that rule, 04g_biomes.js);
//   * rain: v scrolls by -((ticks + hash) & 31 + partial)/32 * (3 + rand.nextFloat()); alpha
//     ((1 - d^2) * 0.5 + 0.5) * gradient, d = horizontal distance / radius;
//   * snow: v scrolls by -((ticks & 511) + partial)/512, plus a per-column drift in u and v off
//     nextDouble/nextGaussian; alpha ((1 - d^2) * 0.3 + 0.5) * gradient; its light is lifted
//     toward full, (3*l + 15)/4 in levels (the (c*3 + 240)/4 of lightmap coords);
//   * the per-column Random is `new Random(x*x*3121 + x*45238971 ^ z*z*418711 + z*13761)` in
//     Java INT arithmetic (the sum overflows and wraps before the long widening).
//   * drawn blended (SRC_ALPHA, ONE_MINUS_SRC_ALPHA), cull OFF, depth tested, depth WRITE off
//     (vanilla writes depth only under Fabulous), after the translucent pass; the particle shader
//     discards alpha < 0.1.
//
// ⚠ NAMED RATHER THAN GUESSED (`Wx.OWED`), each a real piece of vanilla still missing.
(function (NS) {
  'use strict';
  var Wx = NS.Weather = { ready: true };

  Wx.RADIUS_FAST = 5;          // WorldRenderer.java:260 `int $$12 = 5;`
  Wx.RADIUS_FANCY = 10;        // :261-263, isFancyGraphicsOrBetter
  Wx.ALPHA_DISCARD = 0.1;      // particle.fsh: `if (color.a < 0.1) discard;`
  Wx.VERTEX_FLOATS = 7;        // x,y,z (camera-relative), u,v, brightness, alpha

  // ── the 32x32 offset table, built exactly as the constructor does (:232-239) ──────────────
  var OX = new Float32Array(1024), OZ = new Float32Array(1024);
  (function () {
    for (var zi = 0; zi < 32; zi++) for (var xi = 0; xi < 32; xi++) {
      var fx = xi - 16, fz = zi - 16;
      var len = Math.fround(Math.sqrt(fx * fx + fz * fz));
      OX[zi << 5 | xi] = -fz / len;      // (0,0) -> -0/0 = NaN, as in vanilla
      OZ[zi << 5 | xi] = fx / len;
    }
  })();
  Wx.offsetAt = function (dx, dz) { var i = (dz + 16) * 32 + dx + 16; return [OX[i] * 0.5, OZ[i] * 0.5]; };

  // ── java.util.Random, just the four draws renderWeather makes, cached per column ──────────
  /** The column seed, in Java int arithmetic: `x*x*3121 + x*45238971 ^ z*z*418711 + z*13761`. */
  Wx.columnSeed = function (x, z) {
    var a = (Math.imul(Math.imul(x, x), 3121) + Math.imul(x, 45238971)) | 0;
    var b = (Math.imul(Math.imul(z, z), 418711) + Math.imul(z, 13761)) | 0;
    return a ^ b;
  };
  /** `ticks + x*x*3121 + x*45238971 + z*z*418711 + z*13761 & 31` — all int, then masked. */
  Wx.rainPhase = function (ticks, x, z) {
    var s = (ticks | 0);
    s = (s + Math.imul(Math.imul(x, x), 3121)) | 0;
    s = (s + Math.imul(x, 45238971)) | 0;
    s = (s + Math.imul(Math.imul(z, z), 418711)) | 0;
    s = (s + Math.imul(z, 13761)) | 0;
    return s & 31;
  };
  function gaussianPair(r) {        // java.util.Random.nextGaussian, both halves of the polar draw
    var v1, v2, s;
    do { v1 = 2 * r.nextDouble() - 1; v2 = 2 * r.nextDouble() - 1; s = v1 * v1 + v2 * v2; } while (s >= 1 || s === 0);
    var m = Math.sqrt(-2 * Math.log(s) / s);
    return [v1 * m, v2 * m];
  }
  /**
   * The draws one column's fresh Random makes, in vanilla's order. Rain: ONE nextFloat. Snow:
   * nextDouble, nextGaussian, nextDouble, nextGaussian — and the second gaussian is the CACHED
   * other half of the first polar draw (java.util.Random's haveNextNextGaussian), so the snow
   * path consumes: double, (double, double)*k, double. Both lists are computed from their own
   * fresh Random (vanilla makes one per column per frame and uses it for ONE branch).
   */
  var drawCache = new Map();
  Wx.columnDraws = function (x, z) {
    var key = x + ',' + z, d = drawCache.get(key);
    if (d) return d;
    var LR = NS.Noise && NS.Noise.LegacyRandom;
    if (!LR) return null;
    var seed = Wx.columnSeed(x, z);
    var r1 = new LR(seed);
    var rainF = r1.nextFloat();
    var r2 = new LR(seed);
    var d1 = r2.nextDouble();
    var g = gaussianPair(r2);
    var d2 = r2.nextDouble();
    d = { rainF: rainF, snowD1: d1, snowG1: g[0], snowD2: d2, snowG2: g[1] };
    if (drawCache.size > 8192) drawCache.clear();
    drawCache.set(key, d);
    return d;
  };

  /** The engine's own light curve (12_gfx_webgl2.js's world shader, one copy of AMBIENT). */
  Wx.brightness = function (sky, blk, skyScale) {
    var S = NS.Gfx && NS.Gfx.SHADE, amb = S ? S.AMBIENT : 0.06;
    var lv = Math.max(sky * (skyScale == null ? 1 : skyScale), blk) / 15;
    if (lv > 1) lv = 1; else if (lv < 0) lv = 0;
    return amb + (1 - amb) * (lv / (4 - 3 * lv));
  };

  /**
   * THE GEOMETRY — a pure function of `ctx`, so weathercheck can drive it with no GPU:
   *   ctx = { x, y, z (camera), ticks, partial, gradient, fancy,
   *           biomeAt(x,z,camY), precipitation(biome) (0 = none), warm(biome,x,y,z),
   *           topY(x,z) (MOTION_BLOCKING getTopY: highest block + 1),
   *           light(x,y,z) -> [sky, blk], skyScale }
   * Returns { rain: number[], snow: number[], columns } in Wx.VERTEX_FLOATS-float vertices,
   * four per quad, in vanilla's vertex order.
   */
  Wx.buildQuads = function (ctx) {
    var out = { rain: [], snow: [], columns: 0 };
    var grad = ctx.gradient;
    if (!(grad > 0)) return out;
    var R = ctx.fancy ? Wx.RADIUS_FANCY : Wx.RADIUS_FAST;
    var cx = Math.floor(ctx.x), cy = Math.floor(ctx.y), cz = Math.floor(ctx.z);
    var partial = ctx.partial || 0, ticks = ctx.ticks | 0;
    var t14 = Math.fround(Math.fround(ticks) + Math.fround(partial));   // `(float)this.ticks + $$1`
    for (var z = cz - R; z <= cz + R; z++) {
      for (var x = cx - R; x <= cx + R; x++) {
        var ti = (z - cz + 16) * 32 + x - cx + 16;
        var ox = OX[ti] * 0.5, oz = OZ[ti] * 0.5;
        var biome = ctx.biomeAt(x, z, cy);   // vanilla: world.getBiome(set(x, cameraY, z))
        if (ctx.precipitation(biome) === 0) continue;
        var top = ctx.topY(x, z);
        var y0 = cy - R, y1 = cy + R;
        if (y0 < top) y0 = top;
        if (y1 < top) y1 = top;
        var ly = top < cy ? cy : top;
        if (y0 === y1) continue;
        if (ox !== ox || oz !== oz) continue;          // the camera's own column: NaN in vanilla, nothing drawn
        var dr = Wx.columnDraws(x, z);
        if (!dr) continue;
        var dxc = x + 0.5 - ctx.x, dzc = z + 0.5 - ctx.z;
        var dist = Math.fround(Math.sqrt(dxc * dxc + dzc * dzc)) / R;
        var L = ctx.light(x, ly, z), sky = L[0], blk = L[1];
        var list, u0, u1, vTop, vBot, a, br;
        if (ctx.warm(biome, x, y0, z)) {
          var ph = Wx.rainPhase(ticks, x, z);
          var scroll = -(ph + partial) / 32 * (3 + dr.rainF);
          u0 = 0; u1 = 1; vTop = y0 * 0.25 + scroll; vBot = y1 * 0.25 + scroll;
          a = ((1 - dist * dist) * 0.5 + 0.5) * grad;
          br = Wx.brightness(sky, blk, ctx.skyScale);
          list = out.rain;
        } else {
          var s34 = -((ticks & 511) + partial) / 512;
          var s35 = Math.fround(dr.snowD1 + t14 * 0.01 * Math.fround(dr.snowG1));
          var s36 = Math.fround(dr.snowD2 + Math.fround(t14 * Math.fround(dr.snowG2)) * 0.001);
          u0 = s35; u1 = 1 + s35; vTop = y0 * 0.25 + s34 + s36; vBot = y1 * 0.25 + s34 + s36;
          a = ((1 - dist * dist) * 0.3 + 0.5) * grad;
          br = Wx.brightness((sky * 3 + 15) / 4, (blk * 3 + 15) / 4, ctx.skyScale);
          list = out.snow;
        }
        var rx = x - ctx.x + 0.5, rz = z - ctx.z + 0.5;
        var yT = y1 - ctx.y, yB = y0 - ctx.y;
        list.push(rx - ox, yT, rz - oz, u0, vTop, br, a,
                  rx + ox, yT, rz + oz, u1, vTop, br, a,
                  rx + ox, yB, rz + oz, u1, vBot, br, a,
                  rx - ox, yB, rz - oz, u0, vBot, br, a);
        out.columns++;
      }
    }
    return out;
  };

  /** The live context: the world, the sky's weather, the player's camera. */
  Wx.liveCtx = function (cam) {
    var Sky = NS.Sky, W = NS.World, B = NS.Biomes, S = NS.Settings, M = NS.Main, Gx = NS.Gfx;
    var wx = Sky && Sky.weather;
    if (!wx || !W || !W.heightAt || !B || !B.ready) return null;
    var partial = M && M.partial ? M.partial() : 0;
    var grad = (wx.oRainLevel || 0) + ((wx.rainLevel || 0) - (wx.oRainLevel || 0)) * partial;
    return {
      x: cam.x, y: cam.y, z: cam.z, ticks: M ? M.ticks | 0 : 0, partial: partial, gradient: grad,
      fancy: !!(S && S.fancyLeaves), particles: S ? S.particles | 0 : 0,
      biomeAt: function (x, z, y) { return W.biomeAt3(x, y, z); }, precipitation: B.precipitation,
      warm: B.warmEnoughToRain,
      // D-656: the real MOTION_BLOCKING top (water, leaves, glass stop the rain), not the engine's
      // highest-OPAQUE hmap the D-655 draw first read — rain fell through the sea to its floor
      topY: Wx.motionTop,
      light: function (x, y, z) { var l = W.getLight(x, y, z) | 0; return [l >> 4, l & 15]; },
      skyScale: Gx && typeof Gx.skyDarken === 'number' ? Gx.skyDarken : 1
    };
  };

  // ── the sheets: NS.DATA.weatherTiles, rain then snow, 64x256 RGBA each ──────────────────
  var sheets = null, sheetsTried = false;
  function weatherSheets() {
    if (sheets || sheetsTried) return sheets;
    sheetsTried = true;
    var data = NS.DATA;
    if (!data || !data.weatherTiles || !NS.Z) return null;
    try {
      var rgba = NS.Z.unpack(data.weatherTiles, data.weatherTilesBytes);
      var w = data.weatherW || 64, h = data.weatherH || 256, n = w * h * 4;
      if (rgba.length < 2 * n) return null;
      sheets = { w: w, h: h, rain: rgba.subarray(0, n), snow: rgba.subarray(n, 2 * n) };
    } catch (err) { sheets = null; }
    return sheets;
  }
  Wx.sheets = weatherSheets;
  Wx._resetForTest = function () { sheets = null; sheetsTried = false; drawCache.clear(); };

  var idxCache = null, idxCap = 0;
  function quadIndices(n) {
    if (idxCache && idxCap >= n) return idxCache;
    var cap = Math.max(n, 441);
    var idx = new Uint16Array(cap * 6);
    for (var i = 0; i < cap; i++) {
      var v = i * 4, o = i * 6;
      idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2; idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3;
    }
    idxCache = idx; idxCap = cap;
    return idx;
  }

  // ── WebGL2 ───────────────────────────────────────────────────────────────────────────────
  var gl2 = { prog: null, vbuf: null, ibuf: null, texRain: null, texSnow: null, uViewProj: null, uTex: null };
  function glCompile(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { var log = gl.getShaderInfoLog(sh); gl.deleteShader(sh); throw new Error('Weather shader: ' + log); }
    return sh;
  }
  function glEnsure(gl) {
    if (gl2.prog) return true;
    var sh = weatherSheets();
    if (!sh) return false;
    try {
      var VS = ['#version 300 es', 'precision highp float;',
        'in vec3 aPos;', 'in vec2 aUV;', 'in float aBright;', 'in float aAlpha;',
        'uniform mat4 uViewProj;', 'out vec2 vUV;', 'out float vBright;', 'out float vAlpha;',
        'void main() { vUV = aUV; vBright = aBright; vAlpha = aAlpha; gl_Position = uViewProj * vec4(aPos, 1.0); }'].join('\n');
      var FS = ['#version 300 es', 'precision highp float;',
        'in vec2 vUV;', 'in float vBright;', 'in float vAlpha;', 'uniform sampler2D uTex;', 'out vec4 fragColor;',
        'void main() { vec4 t = texture(uTex, vUV); float a = t.a * vAlpha;',
        '  if (a < ' + Wx.ALPHA_DISCARD.toFixed(3) + ') discard;',
        '  fragColor = vec4(t.rgb * vBright, a); }'].join('\n');
      var prog = gl.createProgram();
      gl.attachShader(prog, glCompile(gl, gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, glCompile(gl, gl.FRAGMENT_SHADER, FS));
      gl.bindAttribLocation(prog, 0, 'aPos'); gl.bindAttribLocation(prog, 1, 'aUV');
      gl.bindAttribLocation(prog, 2, 'aBright'); gl.bindAttribLocation(prog, 3, 'aAlpha');
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('Weather program: ' + gl.getProgramInfoLog(prog));
      gl2.uViewProj = gl.getUniformLocation(prog, 'uViewProj');
      gl2.uTex = gl.getUniformLocation(prog, 'uTex');
      gl2.vbuf = gl.createBuffer(); gl2.ibuf = gl.createBuffer();
      var mk = function (px) {
        var t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, sh.w, sh.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        return t;
      };
      gl2.texRain = mk(sh.rain); gl2.texSnow = mk(sh.snow);
      gl2.prog = prog;
      return true;
    } catch (err) { Wx.glError = (err && err.message) || String(err); return false; }
  }
  function glDrawList(gl, cam, list, tex) {
    if (!list.length) return 0;
    var n = list.length / (4 * Wx.VERTEX_FLOATS);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl2.vbuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(list), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl2.ibuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, quadIndices(n), gl.DYNAMIC_DRAW);
    var st = Wx.VERTEX_FLOATS * 4;
    for (var k = 0; k < 4; k++) gl.enableVertexAttribArray(k);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, st, 0);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, st, 12);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, st, 20);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, st, 24);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.drawElements(gl.TRIANGLES, n * 6, gl.UNSIGNED_SHORT, 0);
    for (k = 0; k < 4; k++) gl.disableVertexAttribArray(k);
    return n;
  }
  Wx.renderGL2 = function (G, cam, q) {
    if (!G.backend || !G.backend.gl) return;
    var gl = G.backend.gl;
    if (!glEnsure(gl)) return;
    var hadBlend = gl.isEnabled(gl.BLEND), hadCull = gl.isEnabled(gl.CULL_FACE);
    var hadMask = gl.getParameter(gl.DEPTH_WRITEMASK);
    gl.useProgram(gl2.prog);
    gl.uniformMatrix4fv(gl2.uViewProj, false, cam.viewProj);
    gl.uniform1i(gl2.uTex, 0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE); gl.depthMask(false);
    Wx.drawnQuads = glDrawList(gl, cam, q.rain, gl2.texRain) + glDrawList(gl, cam, q.snow, gl2.texSnow);
    gl.depthMask(hadMask);
    if (!hadBlend) gl.disable(gl.BLEND);
    if (hadCull) gl.enable(gl.CULL_FACE);
  };

  // ── WebGPU ───────────────────────────────────────────────────────────────────────────────
  var gpu = { device: null, pipeline: null, bgl: null, ub: null, bgRain: null, bgSnow: null,
              vb: [null, null], vcap: [0, 0], ib: null, icap: 0 };
  function gpuEnsure(device, format) {
    if (gpu.pipeline && gpu.device === device) return true;
    var sh = weatherSheets();
    if (!sh) return false;
    try {
      var code = [
        'struct VP { viewProj : mat4x4<f32> };',
        '@group(0) @binding(0) var<uniform> uVP : VP;',
        '@group(0) @binding(1) var uTex : texture_2d<f32>;',
        '@group(0) @binding(2) var uSamp : sampler;',
        'struct VOut { @builtin(position) pos : vec4<f32>, @location(0) uv : vec2<f32>, @location(1) br : f32, @location(2) al : f32 };',
        '@vertex fn vs_w(@location(0) p : vec3<f32>, @location(1) uv : vec2<f32>, @location(2) br : f32, @location(3) al : f32) -> VOut {',
        '  var o : VOut; o.pos = uVP.viewProj * vec4<f32>(p, 1.0); o.uv = uv; o.br = br; o.al = al; return o; }',
        '@fragment fn fs_w(v : VOut) -> @location(0) vec4<f32> {',
        '  let t = textureSample(uTex, uSamp, v.uv); let a = t.a * v.al;',
        '  if (a < ' + Wx.ALPHA_DISCARD.toFixed(3) + ') { discard; }',
        '  return vec4<f32>(t.rgb * v.br, a); }'].join('\n');
      var module = device.createShaderModule({ code: code });
      var bgl = device.createBindGroupLayout({ entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }] });
      var pipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
        vertex: { module: module, entryPoint: 'vs_w', buffers: [{ arrayStride: Wx.VERTEX_FLOATS * 4, attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x2' },
          { shaderLocation: 2, offset: 20, format: 'float32' }, { shaderLocation: 3, offset: 24, format: 'float32' }] }] },
        fragment: { module: module, entryPoint: 'fs_w', targets: [{ format: format, blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' }
      });
      var ub = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      var samp = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest', addressModeU: 'repeat', addressModeV: 'repeat' });
      var mk = function (px) {
        var t = device.createTexture({ size: [sh.w, sh.h, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
        device.queue.writeTexture({ texture: t }, px, { bytesPerRow: sh.w * 4, rowsPerImage: sh.h }, [sh.w, sh.h, 1]);
        return device.createBindGroup({ layout: bgl, entries: [
          { binding: 0, resource: { buffer: ub } }, { binding: 1, resource: t.createView() }, { binding: 2, resource: samp }] });
      };
      gpu.bgRain = mk(sh.rain); gpu.bgSnow = mk(sh.snow);
      gpu.device = device; gpu.pipeline = pipeline; gpu.bgl = bgl; gpu.ub = ub;
      gpu.vb = [null, null]; gpu.vcap = [0, 0]; gpu.ib = null; gpu.icap = 0;
      return true;
    } catch (err) { Wx.gpuError = (err && err.message) || String(err); return false; }
  }
  Wx.renderGPU = function (G, cam, q) {
    var P = G.backend;
    if (!P || !P.device || !P.pass || P.lost) return;
    if (!gpuEnsure(P.device, P.format)) return;
    var lists = [q.rain, q.snow], bgs = [gpu.bgRain, gpu.bgSnow], maxN = 0, k;
    for (k = 0; k < 2; k++) maxN = Math.max(maxN, lists[k].length / (4 * Wx.VERTEX_FLOATS));
    var idx = quadIndices(maxN), ib = maxN * 12;
    if (!gpu.ib || gpu.icap < ib) { gpu.ib = P.device.createBuffer({ size: Math.max(ib, 256), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST }); gpu.icap = Math.max(ib, 256); }
    P.device.queue.writeBuffer(gpu.ib, 0, idx.buffer, idx.byteOffset, Math.ceil(ib / 4) * 4);
    P.device.queue.writeBuffer(gpu.ub, 0, cam.viewProj.buffer, cam.viewProj.byteOffset, 64);
    P.pass.setPipeline(gpu.pipeline);
    P.pass.setIndexBuffer(gpu.ib, 'uint16');
    var drawn = 0;
    for (k = 0; k < 2; k++) {
      if (!lists[k].length) continue;
      var arr = new Float32Array(lists[k]), n = lists[k].length / (4 * Wx.VERTEX_FLOATS);
      if (!gpu.vb[k] || gpu.vcap[k] < arr.byteLength) { gpu.vb[k] = P.device.createBuffer({ size: Math.max(arr.byteLength, 256), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }); gpu.vcap[k] = Math.max(arr.byteLength, 256); }
      P.device.queue.writeBuffer(gpu.vb[k], 0, arr.buffer, arr.byteOffset, arr.byteLength);
      P.pass.setBindGroup(0, bgs[k]);
      P.pass.setVertexBuffer(0, gpu.vb[k]);
      P.pass.drawIndexed(n * 6);
      drawn += n;
    }
    Wx.drawnQuads = drawn;
  };

  /** `10_gfx.js`'s one hook, right after the particle pass (vanilla: after particles). */
  Wx.drawnQuads = 0;
  Wx.render = function (G, cam) {
    Wx.drawnQuads = 0;
    if (!G || !cam || !cam.viewProj) return;
    // D-656: the camera the NEXT tick's splashes centre on — vanilla's tick reads the Camera the
    // last frame positioned (GameRenderer.tick -> tickRainSplashing(this.camera)).
    Wx.lastCam = { x: cam.x, y: cam.y, z: cam.z };
    var ctx = Wx.liveCtx(cam);
    if (!ctx || !(ctx.gradient > 0)) return;
    var q = Wx.buildQuads(ctx);
    Wx.lastColumns = q.columns;
    if (!q.columns) return;
    if (G.name === 'webgpu') Wx.renderGPU(G, cam, q);
    else if (G.name === 'webgl2') Wx.renderGL2(G, cam, q);
  };

  // ══ G20 (D-656): `WorldRenderer.tickRainSplashing` (.decomp/net/minecraft/client/render/
  // WorldRenderer.java:399-446, read whole) — the splashes on the ground. Once per client tick
  // (GameRenderer.java:678), around the camera of the last frame:
  //   * f = rainGradient / (Fancy ? 1 : 2); nothing when f <= 0;
  //   * a FRESH java.util.Random seeded (long)ticks * 312987231L — the same ticks, the same drops;
  //   * n = (int)(100 * f * f) tries (halved on Decreased particles; Minimal breaks at the first
  //     accepted try, before any nextDouble, spawning nothing — Settings.particles, #284);
  //   * each try: column (nextInt(21)-10, nextInt(21)-10) off the camera block; its MOTION_BLOCKING
  //     top; refused unless above the world bottom, within +-10 of the camera's y, the biome's
  //     precipitation is RAIN and it does not snow there; then nextDouble u, nextDouble v, and a
  //     particle on the block UNDER the top at (u, top-of-shape-or-fluid, v): SMOKE when that block
  //     holds lava, is magma or a lit campfire, else RAIN (RainSplashParticle, 07zx_particle.js);
  //   * after the tries, the sound counter (`field_20793`): `nextInt(3) < counter++` plays
  //     weather.rain.above (0.1, 0.5) when the last hit is more than a block above the camera AND the
  //     camera is under a roof, else weather.rain (0.2, 1.0). Kept, computed, and returned — the
  //     sound itself waits on D-12 (S.OWED_SOURCES.weather).
  Wx.SPLASH_SEED_MUL = 312987231n;       // WorldRenderer.java:402
  Wx.SPLASH_RADIUS = 10;                 // nextInt(21) - 10
  Wx.SPLASH_BAND = 10;                   // top within +-10 of the camera block
  Wx.splashSoundCounter = 0;             // `field_20793`
  /** (int)(100 * f * f), f = gradient / (fancy ? 1 : 2), in float, as the jar has it. */
  Wx.splashTries = function (gradient, fancy, mode) {
    var f = Math.fround(Math.fround(gradient) / (fancy ? 1 : 2));
    if (!(f > 0)) return 0;
    return Math.trunc(Math.fround(Math.fround(100 * f) * f) / (mode === 1 ? 2 : 1));
  };
  /** `VoxelShape.getEndingCoord(Y, a, b)`: the Y axis cycles `a` onto Z and `b` onto X
   *  (AxisCycleDirection field_10963 = ordinal+1, field_10965 = ordinal-1), so the column read is
   *  (x = b, z = a) — vanilla passes (u, v) with u the X offset, so it reads the shape transposed.
   *  Only an asymmetric shape (stairs, a slab-less corner) can tell. -Infinity when empty. */
  Wx.shapeTop = function (boxes, a, b) {
    var top = -Infinity;
    if (!boxes) return top;
    for (var i = 0; i < boxes.length; i++) {
      var q = boxes[i];   // [x0, y0, z0, x1, y1, z1], cell-local
      if (a >= q[2] && a < q[5] && b >= q[0] && b < q[3] && q[4] > top) top = q[4];
    }
    return top;
  };
  var FLUID_WATER = 1, FLUID_LAVA = 2, kinds = null;
  function blockKinds() {
    if (kinds) return kinds;
    var R = NS.Reg, id = R && R.id;
    if (!id) return null;
    kinds = { water: id.water, lava: id.lava, magma: id.magma_block, campfire: id.campfire,
              soul_campfire: id.soul_campfire, cobweb: id.cobweb, bamboo_sapling: id.bamboo_sapling,
              // blocks whose getFluidState is `Fluids.WATER.getStill(false)` unconditionally:
              // KelpBlock.java:62, KelpPlantBlock, SeagrassBlock, TallSeagrassBlock, BubbleColumnBlock.java:80
              alwaysWater: [id.kelp, id.kelp_plant, id.seagrass, id.tall_seagrass, id.bubble_column] };
    return kinds;
  }
  /** The fluid a state holds: 0 none, 1 water, 2 lava; and its level-amount (8 = full). */
  Wx.fluidOf = function (st) {
    var K = blockKinds(), S = NS.States, Bh = NS.Behave;
    if (!st || !K) return [0, 0];
    var b = S.block[st];
    if (b === K.water || b === K.lava) {
      return [b === K.water ? FLUID_WATER : FLUID_LAVA, Bh && Bh.fluidAmount ? Bh.fluidAmount(st) : 8];
    }
    if (K.alwaysWater.indexOf(b) >= 0) return [FLUID_WATER, 8];
    if (Bh && Bh.propName && Bh.propName(st, 'waterlogged') === 'true') return [FLUID_WATER, 8];
    return [0, 0];
  };
  /** `FluidState.getHeight(world, pos)`: 1.0 when the same fluid sits above, else amount / 9. */
  Wx.fluidHeight = function (x, y, z) {
    var W = NS.World;
    if (!W || !W.getBlock) return 0;
    var f = Wx.fluidOf(W.getBlock(x, y, z));
    if (!f[0]) return 0;
    if (Wx.fluidOf(W.getBlock(x, y + 1, z))[0] === f[0]) return 1;
    return Math.fround(f[1] / 9);
  };
  /** max(collision top at (a,b), fluid height) — the height both tickRainSplashing and
   *  RainSplashParticle.tick ask of one cell. */
  Wx.cellTopAt = function (x, y, z, a, b) {
    var Ph = NS.Physics;
    var shp = Ph && Ph.shapeAt ? Ph.shapeAt(x, y, z) : null;
    return Math.max(Wx.shapeTop(shp, a, b), Wx.fluidHeight(x, y, z));
  };
  if (NS.Particle) NS.Particle.cellTopAt = Wx.cellTopAt;
  /** Heightmap.Type.MOTION_BLOCKING: `material.blocksMovement() || !fluidState.isEmpty()`.
   *  blocksMovement is Material.solid except COBWEB and BAMBOO_SAPLING (Material.java:78,90, the
   *  two materials that set allowsMovement without notSolid). */
  Wx.motionBlocking = function (st) {
    if (!st) return false;
    var S = NS.States, K = blockKinds(), b = S.block[st];
    if (Wx.fluidOf(st)[0]) return true;
    if (K && (b === K.cobweb || b === K.bamboo_sapling)) return false;
    return !!(S.solidMat && S.solidMat[b] === 1);
  };
  /** `getTopPosition(MOTION_BLOCKING, x, z).getY()`: the highest motion-blocking cell + 1, or the
   *  world bottom when the column has none / is not loaded. The engine's own `hmap` is the highest
   *  OPAQUE cell (D-193) — a different question (water, leaves and glass are not opaque) — so the
   *  column is walked, uniform-air sections skipped whole. */
  Wx.motionTop = function (x, z) {
    var W = NS.World, CFG = NS.CFG, Sec = NS.Section, CH = NS.CH;
    var c = W.get(x >> 4, z >> 4);
    if (!c || c.state < CH.GENERATED) return CFG.WORLD_MIN_Y;
    var i = ((z & 15) << 4) | (x & 15);
    for (var s = c.sec.length - 1; s >= 0; s--) {
      var sec = c.sec[s];
      if (!sec || sec.u === 0) continue;
      for (var ly = 15; ly >= 0; ly--) {
        if (Wx.motionBlocking(Sec.get(sec, (ly << 8) | i))) return CFG.WORLD_MIN_Y + (s << 4) + ly + 1;
      }
    }
    return CFG.WORLD_MIN_Y;
  };
  /** The hot-block test for the SMOKE branch: lava fluid, magma_block, or a LIT campfire
   *  (`CampfireBlock.isLitCampfire`: in #campfires and lit=true). */
  Wx.hotSurface = function (st) {
    var K = blockKinds(), S = NS.States, Bh = NS.Behave;
    if (!st || !K) return false;
    if (Wx.fluidOf(st)[0] === FLUID_LAVA) return true;
    var b = S.block[st];
    if (b === K.magma) return true;
    if (b === K.campfire || b === K.soul_campfire) return !!(Bh && Bh.propName && Bh.propName(st, 'lit') === 'true');
    return false;
  };
  /**
   * The pure tick: ctx = { x,y,z (camera), ticks, gradient, fancy, bottomY, topY(x,z), biomeAt(x,z),
   * precipitation(b), warm(b,x,y,z), cellTop(x,y,z,a,b), hot(x,y,z) }. Returns the particles to spawn,
   * in order, and the sound the counter asks for (or null). Advances `Wx.splashSoundCounter`
   * exactly as vanilla advances field_20793.
   */
  Wx.tickRainSplashing = function (ctx) {
    var out = { tries: 0, spawns: [], sound: null };
    var tries = Wx.splashTries(ctx.gradient, ctx.fancy, ctx.particles | 0);
    if (!tries) return out;
    var LR = NS.Noise && NS.Noise.LegacyRandom;
    if (!LR) return out;
    out.tries = tries;
    var rnd = new LR(BigInt.asIntN(64, BigInt(ctx.ticks | 0) * Wx.SPLASH_SEED_MUL));
    var cx = Math.floor(ctx.x), cy = Math.floor(ctx.y), cz = Math.floor(ctx.z);
    var hit = null;
    for (var k = 0; k < tries; k++) {
      var dx = rnd.nextInt(21) - 10, dz = rnd.nextInt(21) - 10;
      var x = cx + dx, z = cz + dz, top = ctx.topY(x, z);
      if (!(top > ctx.bottomY && top <= cy + 10 && top >= cy - 10)) continue;
      var bio = ctx.biomeAt(x, z, cy);
      if (ctx.precipitation(bio) !== 1 || !ctx.warm(bio, x, top, z)) continue;
      hit = [x, top - 1, z];
      if (ctx.particles === 2) break;      // Minimal: `break` after `$$5 = pos.down()`
      var u = rnd.nextDouble(), v = rnd.nextDouble();
      var h = ctx.cellTop(x, top - 1, z, u, v);
      out.spawns.push({ type: ctx.hot(x, top - 1, z) ? 'smoke' : 'rain', x: x + u, y: top - 1 + h, z: z + v });
    }
    if (hit && rnd.nextInt(3) < Wx.splashSoundCounter++) {
      Wx.splashSoundCounter = 0;
      var above = hit[1] > cy + 1 && ctx.topY(cx, cz) > Math.floor(ctx.y);
      out.sound = above ? { id: 'weather.rain.above', volume: 0.1, pitch: 0.5, x: hit[0], y: hit[1], z: hit[2] }
                        : { id: 'weather.rain', volume: 0.2, pitch: 1.0, x: hit[0], y: hit[1], z: hit[2] };
    }
    return out;
  };
  /** The live wiring: called once per world tick (Main.worldTick), after the particle tick, the
   *  way a spawn queued in GameRenderer.tick is first ticked on the NEXT particleManager.tick. */
  Wx.tickSplashLive = function () {
    var Sky = NS.Sky, W = NS.World, B = NS.Biomes, S = NS.Settings, M = NS.Main, Px = NS.Particle;
    var wx = Sky && Sky.weather, cam = Wx.lastCam;
    if (!wx || !cam || !W || !W.get || !B || !B.ready || !Px) return null;
    var res = Wx.tickRainSplashing({
      x: cam.x, y: cam.y, z: cam.z, ticks: M ? M.ticks | 0 : 0, gradient: wx.rainLevel || 0,
      fancy: !!(S && S.fancyLeaves), bottomY: NS.CFG.WORLD_MIN_Y,
      topY: Wx.motionTop, biomeAt: function (x, z, y) { return W.biomeAt3(x, y, z); }, precipitation: B.precipitation, warm: B.warmEnoughToRain,
      cellTop: Wx.cellTopAt, hot: function (x, y, z) { return Wx.hotSurface(W.getBlock(x, y, z)); }
    });
    for (var i = 0; i < res.spawns.length; i++) {
      var sp = res.spawns[i];
      // ParticleTypes.SMOKE with (0,0,0) velocity; RAIN -> RainSplashParticle (07zx_particle.js)
      Px.spawn(sp.type, sp.x, sp.y, sp.z, 0, 0, 0);
    }
    Wx.lastSplash = res;
    Wx.playSplashSound(res);
    return res;
  };
  /** Plays the weather.rain / weather.rain.above sound tickRainSplashing asked for (source 'weather'). */
  Wx.playSplashSound = function (res) {
    var sn = res && res.sound, Sd = NS.Sound;
    if (!sn || !Sd || !Sd.play) return false;
    return Sd.play(sn.id, { volume: sn.volume, pitch: sn.pitch, x: sn.x + 0.5, y: sn.y + 0.5, z: sn.z + 0.5, source: 'weather' });
  };

  Wx.OWED = [
        'fog on the streaks (the particle shader applies the fog; within 10 blocks it is a few percent at most) and ' +
      'Fabulous depth writes (no Fabulous tier in this engine)'
  ];
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
