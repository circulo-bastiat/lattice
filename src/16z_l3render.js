// 16z_l3render.js — the GPU half of GATE M's L3 pixel audit (#1529): ONE mob layer, isolated, fullbright, unfogged,
// drawn through the ACTIVE backend's own model-cutout program/pipeline from an orthographic camera, and read back.
// Main thread only. It is a DEBUG path: nothing in the game calls it, only tools/texaudit-page.mjs (headless
// Chromium, a background job). tools/mobl3check.mjs rasterises the same quads in node; this is what the GPU
// makes of them.
//
//   NS.L3Render.ready()    backend up, the atlas (incl. the mob tiles) uploaded, EntityRender ready
//   NS.L3Render.backend()  'webgl2' | 'webgpu' | null — the ACTIVE one (the page has one at a time)
//   NS.L3Render.render({ layer, texKey, view: { n, R, Up, r0, u1, W, H }, res })
//                          -> Promise<{ ok, backend, W, H, rgba (base64, W*H*4, row 0 = TOP), cullMode, error }>
//
// ⚠ WHAT IS THE GAME'S AND WHAT IS NOT. The quads are written by ER.emitMobLayer exactly as the live loop writes them
// (layer index CFG.LAYER_CUTOUT, shade 0, ao 3, sky 15, no hurt, no entity tint) and drawn by the SAME program/pipeline
// and pass state as a live mob: WebGL2 `setPass('cutout')` + `drawSectionModels` (program `progModel`, mode 1, CULL_FACE
// on, BACK), WebGPU `pipelines.modelCutout` (cullMode 'back', less-equal, no blend). Only the camera/light/fog differ:
// the view-projection is orthographic (pixel x = (dot(p,R) - r0)*res, y = (u1 - dot(p,Up))*res, nearer = larger
// dot(p,n)), the sky scale is 1 with sky light 15 (so lightv = 1), and the fog window is at 1e9 (so the fog term is 0).
// The target is an offscreen RGBA8 / depth24 pair cleared to (0,0,0,0): the game's canvas and frame are never touched.
// A model mob with ER.NO_CULL is emitted double-sided by emitMobLayer itself; nothing here turns culling off, so the
// cull state reported is what a live mob gets — vanilla's getEntityCutoutNoCull is matched by those back quads, not by
// a pipeline that does not cull.
// ⚠ WebGL2 shares the game's context, so every piece of state this touches is put back (L.state, the per-frame upload
// flags, the bound program and VAO, the framebuffer, the viewport); the game's next beginFrame re-establishes the rest.
// Every failure resolves {ok:false, error}; nothing throws into the page.
(function (NS) {
  'use strict';

  var Z = NS.L3Render = {};
  var BIG = 1e9;                       // fog near; far is 2 * BIG, so vFog = 0 for any distance a mob has
  var DEPTH_SPAN = 16;                 // blocks of depth the orthographic z maps onto [0,1]

  Z.backend = function () {
    var G = NS.Gfx;
    if (!G || !G.backend) return null;
    return G.name === 'webgl2' || G.name === 'webgpu' ? G.name : null;
  };

  Z.ready = function () {
    var G = NS.Gfx, A = NS.Atlas, ER = NS.EntityRender, B = Z.backend();
    if (!B || !A || !(A.mobTiles > 0) || !ER || !ER.ready || !NS.Mesher || !NS.BEModel || !NS.BEModel.ready) return false;
    if (B === 'webgl2') {
      var L = NS.GfxGL;
      return !!(L.gl && !L.lost && L.progModel && L.locModel && L.atlasTex && L.idxBuf);
    }
    var P = NS.GfxGPU;
    return !!(P.device && !P.lost && P.pipelines && P.pipelines.modelCutout && P.atlasTex && P.idxBuf && P.bgl0 && P.bgl1
              && P.tintTex && P.sampler && P.tintSampler && G.backend === P);
  };

  /** mobl3check's entOf: the entity a model layer belongs to, for ER.basePoseFor */
  function entOf(layer) {
    return layer.split('#')[0].replace(/^(pufferfish|tropical_fish)_(small|medium|big|large)$/, '$1');
  }

  /** The mob layer's quads as a §8 buffer with every quad in the CUTOUT model layer, like ER.build's mobs. Throws. */
  function emit(layer, texKey) {
    var ER = NS.EntityRender, M = NS.Mesher;
    var n = ER.mobQuadCount(layer, texKey);
    if (!n) throw new Error('the engine emits no quads for ' + layer + (texKey ? ' / ' + texKey : ''));
    var buf = M.allocBuffer(0, 0, 0, [0, n, 0]);
    var hdr = M.readHeader(buf);
    var w = new Uint32Array(buf, hdr.modelOff[1], n * 16);
    ER.emitMobLayer(w, 0, layer, 0, 0, 0, Math.cos(Math.PI), Math.sin(Math.PI), 15, 0, 3, undefined,
                    ER.basePoseFor(entOf(layer)), texKey, 0, null, null);
    return { buf: buf, n: n, hdr: hdr };
  }

  /** column-major view-projection for the orthographic camera; zScale/zBias map depth onto GL's [-1,1] or WebGPU's [0,1] */
  function orthoMatrix(v, res, zBias) {
    var sx = 2 * res / v.W, sy = 2 * res / v.H, m = new Float32Array(16);
    m[0] = v.R[0] * sx;  m[4] = v.R[1] * sx;  m[8]  = v.R[2] * sx;  m[12] = -2 * v.r0 * res / v.W - 1;
    m[1] = v.Up[0] * sy; m[5] = v.Up[1] * sy; m[9]  = v.Up[2] * sy; m[13] = 1 - 2 * res * v.u1 / v.H;
    m[2] = -v.n[0] / DEPTH_SPAN; m[6] = -v.n[1] / DEPTH_SPAN; m[10] = -v.n[2] / DEPTH_SPAN; m[14] = zBias;
    m[15] = 1;
    return m;
  }

  function b64(u8) {
    var s = '', i, CH = 0x8000;
    for (i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return btoa(s);
  }

  /** the frame state both backends' uniform upload reads: fullbright, no fog, camera at the origin */
  function frameState(viewProj) {
    return { viewProj: viewProj, camX: 0, camY: 0, camZ: 0, eyeX: 0, eyeY: 0, eyeZ: 0, time: 0,
             fogR: 0, fogG: 0, fogB: 0, fogNear: BIG, fogFar: 2 * BIG, skyScale: 1.0, skyFrame: null,
             wireframe: false };
  }

  // ── WebGL2: the game's own L.setPass('cutout') + L.drawSectionModels, into an FBO ────────────────────────────────
  function renderGL(spec, q) {
    var L = NS.GfxGL, gl = L.gl, v = spec.view, W = v.W | 0, H = v.H | 0;
    var saved = { state: L.state, pass: L.pass, layerMode: L.layerMode, wire: L.wire,
                  fbo: gl.getParameter(gl.FRAMEBUFFER_BINDING), vp: gl.getParameter(gl.VIEWPORT) };
    var fbo = gl.createFramebuffer(), rbC = gl.createRenderbuffer(), rbD = gl.createRenderbuffer(), h = null;
    try {
      gl.bindRenderbuffer(gl.RENDERBUFFER, rbC); gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, W, H);
      gl.bindRenderbuffer(gl.RENDERBUFFER, rbD); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, W, H);
      gl.bindRenderbuffer(gl.RENDERBUFFER, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rbC);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rbD);
      var st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error('offscreen framebuffer incomplete (0x' + st.toString(16) + ')');
      h = L.createSectionMesh(q.buf);
      if (!h) throw new Error('the backend refused the mesh');
      L.state = frameState(orthoMatrix(v, spec.res, 0));
      L.frameUploaded = { main: false, model: false, flat: false };   // useProgram re-uploads from L.state
      L.curProg = null; L.curVao = null;
      gl.viewport(0, 0, W, H);
      gl.disable(gl.SCISSOR_TEST); gl.disable(gl.DITHER);
      gl.colorMask(true, true, true, true); gl.depthMask(true);
      gl.clearColor(0, 0, 0, 0); gl.clearDepth(1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      L.setPass('cutout');
      // the cull state the game's mob draw runs under, read back from GL rather than assumed
      var cull = gl.isEnabled(gl.CULL_FACE) ? (gl.getParameter(gl.CULL_FACE_MODE) === gl.BACK ? 'back'
                  : gl.getParameter(gl.CULL_FACE_MODE) === gl.FRONT ? 'front' : 'front_and_back') : 'none';
      var tris = L.drawSectionModels(h, 0, 0, 0, NS.CFG.LAYER_CUTOUT);
      L.endModelPass();
      if (!tris) throw new Error('the backend drew nothing');
      var px = new Uint8Array(W * H * 4), out = new Uint8Array(W * H * 4), y;
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
      for (y = 0; y < H; y++) out.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
      return { ok: true, backend: 'webgl2', W: W, H: H, rgba: b64(out), cullMode: cull, error: '' };
    } finally {
      try { if (h) L.destroySectionMesh(h); } catch (e) { /* the arena is the game's; a failed release is not this call's result */ }
      gl.enable(gl.DITHER);
      gl.bindFramebuffer(gl.FRAMEBUFFER, saved.fbo);
      gl.deleteFramebuffer(fbo); gl.deleteRenderbuffer(rbC); gl.deleteRenderbuffer(rbD);
      gl.viewport(saved.vp[0], saved.vp[1], saved.vp[2], saved.vp[3]);
      gl.bindVertexArray(null);
      L.state = saved.state; L.pass = saved.pass; L.layerMode = saved.layerMode; L.wire = saved.wire;
      L.frameUploaded = { main: false, model: false, flat: false };
      L.curProg = null; L.curVao = null;
    }
  }

  // ── WebGPU: P.pipelines.modelCutout with its own frame/draw uniforms and bind groups, into an offscreen texture ──────
  function renderGPU(spec, q) {
    var P = NS.GfxGPU, dev = P.device, v = spec.view, W = v.W | 0, H = v.H | 0;
    var own = [];
    var mk = function (o) { own.push(o); return o; };
    var done = function () { own.forEach(function (o) { try { o.destroy(); } catch (e) { /* gone with the device */ } }); };
    var fail = function (e) { done(); throw e; };
    dev.pushErrorScope('validation');
    try {
      var bpr = Math.ceil(W * 4 / 256) * 256;
      var color = mk(dev.createTexture({ size: [W, H, 1], format: P.format, label: 'l3-color',
                                         usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC }));
      var depth = mk(dev.createTexture({ size: [W, H, 1], format: 'depth24plus', label: 'l3-depth',
                                         usage: GPUTextureUsage.RENDER_ATTACHMENT }));
      var vb = mk(dev.createBuffer({ size: q.n * NS.CFG.MODEL_QUAD_BYTES, label: 'l3-verts',
                                     usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }));
      var fb = mk(dev.createBuffer({ size: 144, label: 'l3-frame', usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
      var db = mk(dev.createBuffer({ size: 256, label: 'l3-draw', usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
      var rb = mk(dev.createBuffer({ size: bpr * H, label: 'l3-read', usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }));
      dev.queue.writeBuffer(vb, 0, q.buf, q.hdr.modelOff[1], q.n * NS.CFG.MODEL_QUAD_BYTES);
      // Frame { viewProj, camTime, fogCol, params, tint } — the fields 11_gfx_webgpu.js beginFrame fills, with our values
      var f = new Float32Array(36);
      f.set(orthoMatrix(v, spec.res, 0.5), 0);
      f[23] = BIG; f[24] = 2 * BIG; f[25] = 1.0;                 // fog near / far, sky scale
      dev.queue.writeBuffer(fb, 0, f.buffer, 0, 144);
      // Draw { origin.xyz = 0, w = layer mode 1 (cutout) }
      dev.queue.writeBuffer(db, 0, new Float32Array([0, 0, 0, 1]));
      var bg0 = dev.createBindGroup({ layout: P.bgl0, entries: [
        { binding: 0, resource: { buffer: fb } },
        { binding: 1, resource: P.atlasTex.createView({ dimension: '2d-array' }) },
        { binding: 2, resource: P.sampler },
        { binding: 3, resource: P.tintTex.createView({ dimension: '2d-array' }) },
        { binding: 4, resource: P.tintSampler }] });
      var bg1 = dev.createBindGroup({ layout: P.bgl1, entries: [{ binding: 0, resource: { buffer: db, offset: 0, size: 16 } }] });
      var enc = dev.createCommandEncoder();
      var pass = enc.beginRenderPass({
        colorAttachments: [{ view: color.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }],
        depthStencilAttachment: { view: depth.createView(), depthClearValue: 1.0, depthLoadOp: 'clear', depthStoreOp: 'store' }
      });
      pass.setPipeline(P.pipelines.modelCutout);
      pass.setBindGroup(0, bg0);
      pass.setBindGroup(1, bg1, [0]);
      pass.setVertexBuffer(0, vb);
      pass.setIndexBuffer(P.idxBuf, 'uint16');
      pass.drawIndexed(q.n * 6, 1, 0, 0, 0);
      pass.end();
      enc.copyTextureToBuffer({ texture: color }, { buffer: rb, offset: 0, bytesPerRow: bpr, rowsPerImage: H }, [W, H, 1]);
      dev.queue.submit([enc.finish()]);
    } catch (e) {
      dev.popErrorScope().catch(function () {});
      fail(e);
    }
    return dev.popErrorScope().then(function (err) {
      if (err) throw new Error('WebGPU validation error: ' + err.message);
      return rb.mapAsync(GPUMapMode.READ);
    }).then(function () {
      var src = new Uint8Array(rb.getMappedRange()), out = new Uint8Array(W * H * 4), bgra = P.format.indexOf('bgra') === 0;
      for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
        var s = y * bpr + x * 4, d = (y * W + x) * 4;
        out[d] = src[bgra ? s + 2 : s]; out[d + 1] = src[s + 1]; out[d + 2] = src[bgra ? s : s + 2]; out[d + 3] = src[s + 3];
      }
      rb.unmap(); done();
      // 11_gfx_webgpu.js: modelCutout = primitive { cullMode: 'back', frontFace: 'ccw' } (not introspectable from a pipeline)
      return { ok: true, backend: 'webgpu', W: W, H: H, rgba: b64(out), cullMode: 'back', error: '' };
    }, function (e) { done(); throw e; });
  }

  var chain = Promise.resolve();       // one render at a time: the GL path is synchronous, the GPU path is not

  Z.render = function (spec) {
    var run = function () {
      var backend = Z.backend();
      try {
        if (!spec || !spec.view || !spec.layer) throw new Error('render needs { layer, view, res }');
        if (!Z.ready()) throw new Error('not ready (backend ' + backend + ')');
        var v = spec.view;
        if (!(v.W > 0 && v.H > 0 && v.W <= 4096 && v.H <= 4096 && spec.res > 0)) throw new Error('bad view size / res');
        var q = emit(spec.layer, spec.texKey);
        return Promise.resolve(backend === 'webgl2' ? renderGL(spec, q) : renderGPU(spec, q)).catch(function (e) {
          return { ok: false, backend: backend, W: v.W, H: v.H, rgba: '', cullMode: '', error: String((e && e.message) || e) };
        });
      } catch (e) {
        return Promise.resolve({ ok: false, backend: backend, W: 0, H: 0, rgba: '', cullMode: '', error: String((e && e.message) || e) });
      }
    };
    var p = chain.then(run, run);
    chain = p.then(function () {}, function () {});
    return p;
  };
})(MCL);
