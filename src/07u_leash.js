// 07u_leash.js — QUEUE 0.2 (Tame.OWED "leashing"): the ROPE, drawn.
// Runs on: MAIN THREAD ONLY. No worker access — same standing as every other render module.
//
// ⚠⚠ D-508's OWED, PARTLY CLOSED (session 93) — THIS FILE USED TO ALSO DRAW THE KNOT, AS A
// HAND-ROLLED WIRE CUBE, AND NO LONGER DOES. The knot is a real boxed model with a real baked
// texture (`assets/mob-geometry.json`'s own `leash_knot` entry — `entity/lead_knot.png`'s six
// face crops, `tools/pack-mobtex.mjs`), and `07j_entityrender.js`'s `ER.leashKnotVisible` now
// feeds it into the SAME shared §8 mesh buffer every mob and block entity already draws
// through — real texture, real lighting, all three backends, for free, the same reasoning
// D-421 already gave for a chest. This file no longer touches that buffer — the original
// worry ("another worker is editing tonight") is what kept it separate at D-508, and the knot
// crossing over is what closes it, not a change of mind about the boundary. What is LEFT here
// is the ROPE — 24 dynamic sagging line segments per frame, which is not a boxed model and has
// no baked layer to join.
//
// ⚠⚠ WHY THE ROPE STAYS ITS OWN TINY SELF-CONTAINED PROGRAM, ONE PER BACKEND. It is added to
// the frame with exactly ONE call site (`G.render`, 10_gfx.js, right after the translucent
// pass, after the entity mesh — which now includes the knot — has already drawn). Everything
// else — the programs, the buffers, the geometry — lives here.
//
// ⚠ D-508's OWED, CLOSED (session 93): WEBGPU. `Ls.renderGPU` is the SAME line geometry
// (`Ls.buildVertices`) drawn through its own WGSL pipeline rather than `Ls.render`'s WebGL2
// program — two backends, one geometry function, the same split `10_gfx.js`'s own
// `entityTintExpr` doc argues for (a change lands once, in the shared JS, not twice in two
// shading languages) except here the SHADER itself is trivial enough that the two backends
// just each keep their own copy rather than share GLSL/WGSL source text the way the model
// shaders do — there is no maths in it worth deriving twice.
//
// ⚠ WHAT IS STILL SIMPLIFIED, NAMED HERE RATHER THAN LEFT FOR SOMEONE TO DISCOVER LATER:
//   * `MobEntityRenderer.renderLeash`'s own double-sided ribbon (two ordered triangle strips,
//     `RenderLayer.getLeash()`'s texture, and the block/sky LIGHTMAP blended per vertex) is
//     drawn here as a single-sided coloured LINE for each of the 24 vanilla segments instead —
//     the SEGMENT COUNT (24), the SAG MATH (`renderLeashPiece`'s own quadratic ease, transcribed
//     verbatim below) and the ALTERNATING light/dark banding (`i % 2 == 0 ? 0.7 : 1.0` times the
//     jar's own (0.5, 0.4, 0.3) brown) are exact; the flat, untextured, unlit line is the
//     simplification. `RenderLayer.getLeash()`'s own texture (a 1x1 lightmap strip, not a
//     pattern) means the real ribbon is FLAT-SHADED too — the colour is the whole
//     simplification, not a missing pattern. Named in `Tm.OWED`.
//
// ⚠ THE ANCHOR POINTS ARE ALSO SIMPLIFIED. `MobEntityRenderer.renderLeash`'s own anchor is
// `getLeashOffset()` (`Entity.java`: `(0, standingEyeHeight, width*0.4)`) ROTATED BY THE MOB'S
// OWN BODY YAW — this engine has no reliable per-mob body-yaw signal wired to the renderer yet
// (`e.yaw` is `07i_entitylist.js`'s own single fixed-0 stand-in, D-417's own header), so the
// rotation term is dropped and the rope simply starts at the mob's own centre height
// (`e.y + e.height * 0.5`) and ends at the holder's `LeashKnotEntity.getLeashPos` (`+0.2`) or an
// player anchor (`Ls.playerLeashPos`, `PlayerEntity.getLeashPos` transcribed; the player has no
// separate body yaw, so the look yaw stands in unless `P.bodyYaw` is set). Named in `Tm.OWED`.

(function (NS) {
  'use strict';

  var Ls = NS.Leash = { ready: false };

  Ls.SEGMENTS = 24;   // `MobEntityRenderer.LEASH_PIECE_COUNT`
  // `renderLeashPiece`'s own literals: base colour (0.5, 0.4, 0.3), banded by 0.7/1.0.
  Ls.COLOR_BASE = [0.5, 0.4, 0.3];
  Ls.COLOR_DIM = 0.7;

  /** `renderLeashPiece`'s own sag law, one axis: t in [0,1]. Horizontal axes are linear; the
   *  vertical axis eases toward the far end from whichever side is "up" — read verbatim off
   *  the jar (`$$3 > 0 ? $$3*t*t : $$3 - $$3*(1-t)*(1-t)`), not a generic catenary formula. */
  Ls.sagY = function (dy, t) {
    return dy > 0 ? dy * t * t : dy - dy * (1 - t) * (1 - t);
  };

  /** The 25 points (`i <= 24`) of one rope from `(0,0,0)` to `(dx,dy,dz)`, in that local space. */
  Ls.ropePoints = function (dx, dy, dz) {
    var pts = new Array(Ls.SEGMENTS + 1);
    for (var i = 0; i <= Ls.SEGMENTS; i++) {
      var t = i / Ls.SEGMENTS;
      pts[i] = [dx * t, Ls.sagY(dy, t), dz * t];
    }
    return pts;
  };

  /** The knot's own `getLeashPos` (`LeashKnotEntity`: `pos + (0, 0.2, 0)`), or the simplified
   *  player anchor named in this file's own header. */
  /** `PlayerEntity.getLeashPos(pt)` (.decomp PlayerEntity.java:2021) on the lerped position
   *  (`Entity.getLerpedPos`). Engine yaw -> vanilla is +PI, engine pitch is up-positive (vanilla down). */
  Ls.playerLeashPos = function (P, pt) {
    var lerp = function (d, a, b) { return a + d * (b - a); };
    var px = P.px === undefined ? P.x : P.px, py = P.py === undefined ? P.y : P.py, pz = P.pz === undefined ? P.z : P.pz;
    var X = lerp(pt, px, P.x), Y = lerp(pt, py, P.y), Z = lerp(pt, pz, P.z);
    var yaw = P.yaw + Math.PI, pyaw = (P.pYaw === undefined ? P.yaw : P.pYaw) + Math.PI;
    var by = P.bodyYaw === undefined ? yaw : P.bodyYaw, pby = P.pBodyYaw === undefined ? pyaw : P.pBodyYaw;
    var pitch = -P.pitch, ppitch = -(P.pPitch === undefined ? P.pitch : P.pPitch);
    var f = Math.fround;
    // lerp(pt*0.5, getPitch(), prevPitch) exactly as written in the jar
    var a2 = f(f(pitch + f(pt * 0.5) * (ppitch - pitch)) * f(Math.PI / 180));
    var a3 = f(f(pby + pt * (by - pby)) * f(Math.PI / 180));
    var vx = 0.22 * (P.leftHanded ? 1 : -1);
    var rx = function (v, a) { var c = Math.cos(a), s = Math.sin(a); return [v[0], v[1] * c + v[2] * s, v[2] * c - v[1] * s]; };
    var ry = function (v, a) { var c = Math.cos(a), s = Math.sin(a); return [v[0] * c + v[2] * s, v[1], v[2] * c - v[0] * s]; };
    var rz = function (v, a) { var c = Math.cos(a), s = Math.sin(a); return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]]; };
    var o;
    if (P.fallFlying || P.riptideTicks > 0) {
      var cp = Math.cos(P.pitch), look = [Math.sin(P.yaw) * cp, Math.sin(P.pitch), -Math.cos(P.yaw) * cp];
      var v2 = (P.vx || 0) * (P.vx || 0) + (P.vz || 0) * (P.vz || 0), l2 = look[0] * look[0] + look[2] * look[2], roll = 0;
      if (v2 > 0 && l2 > 0) {
        var d = ((P.vx || 0) * look[0] + (P.vz || 0) * look[2]) / Math.sqrt(v2 * l2);
        var c = (P.vx || 0) * look[2] - (P.vz || 0) * look[0];
        roll = f(Math.sign(c) * Math.acos(d));
      }
      o = ry(rx(rz([vx, -0.11, 0.85], -roll), -a2), -a3);
    } else if (P.swimming) {
      o = ry(rx([vx, 0.2, -0.15], -a2), -a3);
    } else {
      o = ry([vx, (P.height || 1.8) - 1.0, P.crouching ? -0.2 : 0.07], -a3);
    }
    return [X + o[0], Y + o[1], Z + o[2]];
  };

  Ls.holderAnchor = function (holder) {
    if (!holder) return null;
    if (holder.kind === 'knot') {
      var k = holder.knot;
      if (!k || k.removed) return null;
      return [k.x, k.y + 0.2, k.z];
    }
    if (holder.kind === 'player') {
      var P = NS.Player;
      if (!P) return null;
      return Ls.playerLeashPos(P, P.alpha === undefined ? 1 : P.alpha);
    }
    // loop/wtrader-s103 -- a trader llama leashed to its own WanderingTraderEntity
    // (WanderingTraderManager.spawnLlama, .decomp), the same MobEntity.attachLeash the player
    // holder above stands in for, just with another live entity object on the other end
    // instead of the one player. `Ls.mobAnchor` is the SAME anchor point every leashed mob's
    // own body already uses when it is the ROPE'S OTHER END (below), reused here since a
    // wandering trader is exactly that kind of anchor too.
    if (holder.kind === 'entity') {
      var h = holder.entity;
      if (!h || h.removed) return null;
      return Ls.mobAnchor(h);
    }
    return null;
  };

  // y factor on standing eye height per vanilla getLeashOffset override (.decomp/entity/passive/*)
  var LEASH_Y = { wolf: 0.6, rabbit: 0.6, pig: 0.6, strider: 0.6, ocelot: 0.5, parrot: 0.5, bee: 0.5, fox: 0.55, snow_golem: 0.75, iron_golem: 0.875 };

  Ls.mobAnchor = function (e) {
    if (NS.Llama && (e.type === 'llama' || e.type === 'trader_llama')) return [e.x, e.y + NS.Llama.leashOffset(e).y, e.z];
    // Entity.getLeashOffset = (0, eye, width*0.4); overrides scale y (and bee/llama z). Rotated by body
    // yaw as MobEntityRenderer.renderLeash does: angle = yaw + PI/2, dx = cos*z, dz = sin*z.
    var yf = LEASH_Y[e.type], zf = e.type === 'bee' ? 0.2 : 0.4;
    var oz = Math.fround(e.width * zf), a = NS.Ai.bodyYawOf(e) + Math.PI + Math.PI / 2;   // engine yaw -> vanilla bodyYaw is +PI
    return [e.x + Math.cos(a) * oz, e.y + Math.fround(yf === undefined ? 1 : yf) * NS.Combat.eyeHeightOf(e), e.z + Math.sin(a) * oz];
  };

  // ── the WebGL2 program (lazy, built once) ──────────────────────────────────────────────────
  var prog = null, vao = null, vbuf = null, uViewProj = -1, aPos = -1, aColor = -1;
  var VS = 'attribute vec3 aPos; attribute vec3 aColor; uniform mat4 uViewProj; varying vec3 vColor;\n' +
           'void main() { vColor = aColor; gl_Position = uViewProj * vec4(aPos, 1.0); }';
  var FS = 'precision mediump float; varying vec3 vColor;\n' +
           'void main() { gl_FragColor = vec4(vColor, 1.0); }';

  function compile(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error('Leash shader: ' + log);
    }
    return sh;
  }

  function ensureProgram(gl) {
    if (prog) return true;
    try {
      var vs = compile(gl, gl.VERTEX_SHADER, VS);
      var fs = compile(gl, gl.FRAGMENT_SHADER, FS);
      var p = gl.createProgram();
      gl.attachShader(p, vs);
      gl.attachShader(p, fs);
      gl.bindAttribLocation(p, 0, 'aPos');
      gl.bindAttribLocation(p, 1, 'aColor');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Leash program: ' + gl.getProgramInfoLog(p));
      prog = p;
      uViewProj = gl.getUniformLocation(p, 'uViewProj');
      aPos = 0; aColor = 1;
      vbuf = gl.createBuffer();
      return true;
    } catch (err) {
      Ls.error = (err && err.message) || String(err);
      return false;
    }
  }

  /**
   * ONE frame's worth of rope line vertices: every leashed mob's rope, camera-relative.
   * `ex/ey/ez` is the camera eye — every position is emitted CAMERA-RELATIVE (D-179), the
   * same convention `fs.viewProj` already assumes for every other pass in this engine.
   *
   * D-508's OWED, CLOSED (session 93): the KNOT used to be built here too, as a wire cube; it
   * is now `ER.leashKnotVisible`'s own item in `07j_entityrender.js`'s shared mesh (see this
   * file's header) and this function draws rope segments only.
   */
  /** Lightmap brightness 0..1 at a world point: max of block and sky light (sky at full day). */
  Ls.lightFactor = function (W, x, y, z) {
    if (!W || !W.getLight) return 1;
    var L = W.getLight(Math.floor(x), Math.floor(y), Math.floor(z));
    var lv = Math.max(L & 15, L >> 4);
    return 0.05 + 0.95 * (lv / 15);
  };

  Ls.buildVertices = function (ex, ey, ez) {
    var Tm = NS.Tame, EL = NS.EntityList;
    var out = [];
    if (Tm && Tm.ready && EL && EL.ready) {
      var list = EL.list;
      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        if (e.removed || !e.leashHolder) continue;
        var a = Ls.mobAnchor(e);
        var h = Ls.holderAnchor(e.leashHolder);
        if (!h) continue;
        var dx = h[0] - a[0], dy = h[1] - a[1], dz = h[2] - a[2];
        var pts = Ls.ropePoints(dx, dy, dz);
        // MobEntityRenderer.renderLeash/renderLeashPiece: a triangle-strip ribbon, 0.025 half width,
        // perpendicular to the rope in XZ (p = dz*k, q = dx*k), light blended per vertex.
        var hl = Math.sqrt(dx * dx + dz * dz) || 1, k = 0.025 / hl, px = dz * k, pz = dx * k;
        var W = NS.World, lit = [];
        for (var j = 0; j <= Ls.SEGMENTS; j++) {
          var pj = pts[j];
          lit.push(Ls.lightFactor(W, a[0] + pj[0], a[1] + pj[1], a[2] + pj[2]));
        }
        for (var s = 0; s < Ls.SEGMENTS; s++) {
          var dim = (s % 2 === 0) ? Ls.COLOR_DIM : 1.0;
          var q = [];
          for (var m = 0; m < 2; m++) {
            var pt = pts[s + m], f = lit[s + m] * dim;
            var cx = a[0] + pt[0] - ex, cy = a[1] + pt[1] - ey, cz = a[2] + pt[2] - ez;
            var r = Ls.COLOR_BASE[0] * f, g = Ls.COLOR_BASE[1] * f, b = Ls.COLOR_BASE[2] * f;
            q.push([cx - px, cy + 0.025, cz + pz, r, g, b], [cx + px, cy, cz - pz, r, g, b]);
          }
          var tri = [0, 1, 2, 2, 1, 3];
          for (var t = 0; t < 6; t++) Array.prototype.push.apply(out, q[tri[t]]);
        }
      }
    }
    return out;
  };

  /**
   * The WebGL2 render call, invoked from `G.render` (10_gfx.js) right after the translucent
   * pass. `G`/`cam` are the SAME objects that call passes; `cam.viewProj` is eye-relative.
   */
  Ls.render = function (G, cam) {
    if (!G || !G.backend) return;
    if (G.name === 'webgpu') { Ls.renderGPU(G, cam); return; }
    if (G.name !== 'webgl2' || !G.backend.gl) return;
    var gl = G.backend.gl;
    if (!ensureProgram(gl)) return;
    var verts = Ls.buildVertices(cam.x, cam.y, cam.z);
    if (!verts.length) return;
    var arr = new Float32Array(verts);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbuf);
    gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(aPos);
    gl.enableVertexAttribArray(aColor);
    var stride = 6 * 4;
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, stride, 0);
    gl.vertexAttribPointer(aColor, 3, gl.FLOAT, false, stride, 3 * 4);
    gl.uniformMatrix4fv(uViewProj, false, cam.viewProj);
    var wasDepthMask = gl.getParameter(gl.DEPTH_WRITEMASK);
    gl.drawArrays(gl.TRIANGLES, 0, verts.length / 6);
    gl.disableVertexAttribArray(aPos);
    gl.disableVertexAttribArray(aColor);
    void wasDepthMask;
    Ls.ready = true;
  };

  // ── D-508's OWED, CLOSED (session 93): the WebGPU rope pass ────────────────────────────────
  //
  // The SAME geometry (`Ls.buildVertices`), the SAME per-vertex layout (position, colour), a
  // separate tiny WGSL pipeline because a WebGPU render pass needs its own pipeline object and
  // there is no maths here worth sharing as source text the way `10_gfx.js`'s
  // `entityTintExpr`/`faceShadeExpr` are — D-52's "two backends must agree" rule is about
  // shading MATHS, and a flat-coloured line has none to drift out of step.
  var WGSL = [
    'struct VP { viewProj : mat4x4<f32> };',
    '@group(0) @binding(0) var<uniform> uVP : VP;',
    'struct VOut { @builtin(position) pos : vec4<f32>, @location(0) color : vec3<f32> };',
    '@vertex',
    'fn vs_leash(@location(0) pos : vec3<f32>, @location(1) color : vec3<f32>) -> VOut {',
    '  var o : VOut;',
    '  o.pos = uVP.viewProj * vec4<f32>(pos, 1.0);',
    '  o.color = color;',
    '  return o;',
    '}',
    '@fragment',
    'fn fs_leash(@location(0) color : vec3<f32>) -> @location(0) vec4<f32> {',
    '  return vec4<f32>(color, 1.0);',
    '}'
  ].join('\n');

  // Built lazily against whichever `GPUDevice` this session's backend created — rebuilt if
  // that device ever changes (a context loss, `mobboxcheck`-style harness re-init).
  var gpu = { device: null, pipeline: null, bgl: null, bg: null, uniformBuf: null,
              vertBuf: null, vertCap: 0 };

  function ensureGpuPipeline(device, format) {
    if (gpu.pipeline && gpu.device === device) return true;
    try {
      var module = device.createShaderModule({ code: WGSL });
      var bgl = device.createBindGroupLayout({
        entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }]
      });
      var layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
      var pipeline = device.createRenderPipeline({
        layout: layout,
        vertex: {
          module: module, entryPoint: 'vs_leash',
          buffers: [{
            arrayStride: 24, stepMode: 'vertex',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x3' }
            ]
          }]
        },
        fragment: { module: module, entryPoint: 'fs_leash', targets: [{ format: format }] },
        primitive: { topology: 'triangle-list' },
        // ⚠ SAME depth format every other pipeline in 11_gfx_webgpu.js uses (`depth24plus`) —
        // this draws into the SAME pass and depth attachment as the world, so it must agree.
        depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' }
      });
      var uniformBuf = device.createBuffer({
        size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });
      var bg = device.createBindGroup({
        layout: bgl, entries: [{ binding: 0, resource: { buffer: uniformBuf } }]
      });
      gpu.device = device; gpu.pipeline = pipeline; gpu.bgl = bgl; gpu.bg = bg;
      gpu.uniformBuf = uniformBuf; gpu.vertBuf = null; gpu.vertCap = 0;
      return true;
    } catch (err) {
      Ls.gpuError = (err && err.message) || String(err);
      return false;
    }
  }

  /**
   * The WebGPU render call — same contract as `Ls.render`, dispatched from it when
   * `G.name === 'webgpu'`. `G.backend` is `NS.GfxGPU`; `G.backend.pass` is the SAME open render
   * pass `10_gfx.js`'s frame is already drawing the world into (this runs right after the
   * translucent pass and before `endFrame`, exactly where `Ls.render`'s own call site says).
   */
  Ls.renderGPU = function (G, cam) {
    var P = G.backend;
    if (!P || !P.device || !P.pass || P.lost) return;
    if (!ensureGpuPipeline(P.device, P.format)) return;
    var verts = Ls.buildVertices(cam.x, cam.y, cam.z);
    if (!verts.length) return;
    var arr = new Float32Array(verts);
    var bytes = arr.byteLength;
    if (!gpu.vertBuf || gpu.vertCap < bytes) {
      gpu.vertBuf = P.device.createBuffer({
        size: Math.max(bytes, 256), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
      });
      gpu.vertCap = Math.max(bytes, 256);
    }
    P.device.queue.writeBuffer(gpu.vertBuf, 0, arr.buffer, arr.byteOffset, bytes);
    P.device.queue.writeBuffer(gpu.uniformBuf, 0, cam.viewProj.buffer, cam.viewProj.byteOffset, 64);
    P.pass.setPipeline(gpu.pipeline);
    P.pass.setBindGroup(0, gpu.bg);
    P.pass.setVertexBuffer(0, gpu.vertBuf);
    P.pass.draw(verts.length / 6);
    Ls.ready = true;
  };

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
