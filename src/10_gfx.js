// 10_gfx.js — backend-agnostic renderer frontend (docs/archive/ARCH.md §9). Main thread only.
// Owns the camera, frustum culling, the draw list and GPU buffer bookkeeping. Owns no API call:
// every GL/GPU entry point lives in 11_gfx_webgpu.js or 12_gfx_webgl2.js behind ONE interface,
// so no other module in the project ever branches on which backend is running.

(function (NS) {
  'use strict';

  var G = NS.Gfx = {
    backend: null,
    name: 'none',
    fallbackReason: '',
    failReason: '',
    // null | 'webgpu' | 'webgl2'. null and 'webgl2' both mean WebGL2 — see G.init's note on
    // why WebGPU is opt-in (D-15, blocker B1). Set by the title menu, Settings and F9.
    force: null,
    canvas: null,
    width: 1, height: 1,

    cam: null,
    // ⚠ THE DEFAULTS ARE THE TITLE SCREEN'S, not the game's. `updateSky` overwrites all three
    // every frame from `NS.Sky`; these are what the first frame draws with before a world
    // exists, and what a build with the sky module stripped would fall back to.
    sky: [0.62, 0.76, 0.98],
    fog: [0.62, 0.76, 0.98],
    skyDarken: 1,
    /** the last frame's sky state, so the HUD and the checks can read it */
    skyFrame: null,

    meshes: new Map(),     // sectionKey -> {handle, quads:[3], cx, cz, sy, li}
    meshList: [],          // the same entries as a flat array: the cull loop runs over THIS,
                           // because Map.forEach with a closure over a few thousand entries is
                           // measurable per frame on a 2200G and a plain for-loop is not.
    uploadQueue: [],
    uploadsPerFrame: 4,
    uploadBytesPerFrame: 262144,   // a second, harder cap: four 500 KB sections is a visible hitch
    // ⚠ REMOVALS ARE NOT UPLOADS AND MUST NOT SHARE THE UPLOAD BUDGET (D-194). A null-buf job
    // is a `deleteBuffer`: no bytes cross the bus and there is nothing to hitch on. Charging it
    // an upload slot is what turned an eviction burst into a blank screen — see flushUploads.
    removalsPerFrame: 512,

    wireframe: false,      // debug: draw the section geometry as lines (both backends)
    depthPrepass: false,   // opt-in; see D-53 — it is a loss on the 2200G and a win on the 6800XT
    frozenFrustum: false,  // debug: stop updating the cull frustum so you can fly around it
    occlusion: true,       // the section visibility graph (F8 toggles it) — ARCH 9.1, D-85
    showOcclusion: false,

    fogStart: 0.55,        // fog begins at this fraction of the fog far distance
    fogEnd: 1.0,           // fog far = fogEnd * renderDistance * 16

    // ⚠ `drawn`, `tris` and `modelTris` COUNT WHAT THE BACKEND CONFIRMED IT DREW (D-194), not
    // how long the draw list was. `drawnListed` is the old number — what the cull loop ASKED
    // for — kept beside it precisely so the two can disagree: they differ by exactly the work a
    // lost context, a dropped handle or a full WebGPU dynamic-offset ring silently swallowed.
    drawn: 0, drawnListed: 0, culled: 0, tris: 0, draws: 0, binds: 0,
    removed: 0,                   // section handles freed this frame (see removalsPerFrame)
    contextLosses: 0, contextRestores: 0,
    visited: 0, occluded: 0,      // visibility-flood counters, for F3 and the benchmark
    frameState: null
  };

  // ---------------------------------------------------------------------------
  // Shared shading constants (D-52).
  //
  // BOTH shaders are generated from this table. That is deliberate: "the GLSL and the WGSL must
  // agree" is not something to enforce by reading two files side by side, it is something to
  // enforce by there being only one copy of every number.
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // #1851 — the colour-ray layer (vanilla RenderLayer.getLightning: POSITION_COLOR triangles,
  // untextured, LIGHTNING_TRANSPARENCY = SRC_ALPHA, ONE, no depth write... ALL_MASK in vanilla,
  // but additive light never needs to occlude, so depth is tested and not written).
  // Vertex = x y z (eye-relative, like every other vertex here) r g b a, seven floats.
  // `G.pushRayTri` writes the dragon-death-ray triangle: WHITE centre with alpha `a`, then two
  // MAGENTA (255, 0, 255) rim vertices with alpha 0 (EnderDragonEntityRenderer).
  // ---------------------------------------------------------------------------
  G.RAY_FLOATS = 7;
  G.pushRayTri = function (out, o, c, p1, p2, a) {
    var v = [c, p1, p2], col = [[1, 1, 1, a], [1, 0, 1, 0], [1, 0, 1, 0]];
    for (var i = 0; i < 3; i++) {
      out[o++] = v[i][0]; out[o++] = v[i][1]; out[o++] = v[i][2];
      out[o++] = col[i][0]; out[o++] = col[i][1]; out[o++] = col[i][2]; out[o++] = col[i][3];
    }
    return o;
  };

  G.SHADE = {
    // face brightness, indexed by ARCH §3 face numbering: +X -X +Y -Y +Z -Z
    FACE: [0.60, 0.60, 1.00, 0.50, 0.80, 0.80],
    AO_BASE: 0.45,          // ao 0 (darkest)
    AO_STEP: 0.18333334,    // ao 3 -> 0.45 + 3*0.18333334 = 1.0
    AMBIENT: 0.06,          // light floor, so caves are dark but not black
    // ⚠ THE FALLBACK tint palette, not the live one. Indexed by the vertex's 2-bit tint field
    // (0 none, 1 grass, 2 foliage, 3 water), these are the PLAINS colours, and they are what a
    // vertex gets when the biome tint map is not up — during the first frames of a world, or in
    // a backend that has not bound the texture. The live colours come from `NS.Tint`, a map of
    // the loaded area sampled by world position; see `tintExpr` and 06b_tintmap.js.
    TINT: [
      [1.000, 1.000, 1.000],
      [0.569, 0.741, 0.349],
      [0.467, 0.671, 0.184],
      [0.247, 0.463, 0.894]
    ],
    CUTOUT: 0.5,            // alpha test threshold for the cutout layer
    SCROLL: 0.08,           // tiles/second for vertices with the animated flag set
    FOG_CURVE: 2.0          // fog factor is raised to this power
  };

  /** Format a number as a GLSL/WGSL float literal. One formatter for both languages. */
  G.f = function (x) {
    var s = (Math.round(x * 1e6) / 1e6).toString();
    if (s.indexOf('.') < 0 && s.indexOf('e') < 0) s += '.0';
    return s;
  };

  /**
   * The shading maths, emitted as source text. Both backends call these so a change lands in
   * both languages at once; the only per-language difference is the ternary syntax, which is
   * why `sel` is passed in.
   *
   * sel(cond, a, b) -> source for "cond ? a : b"
   */
  /** Brightness slider (#9237): the lightmap's gamma stage as a scalar. g = 0.5 is the identity (the old look), above it
   *  mixes toward LightmapTextureManager's ease 1-(1-x)^4, below it darkens (Moody). Same text in GLSL and WGSL. */
  G.gammaLightExpr = function (l, g, pow, mix) {
    return mix + '(' + pow + '(' + l + ', 1.0 + max(0.0, 1.0 - 2.0 * ' + g + ')), 1.0 - ' + pow + '(1.0 - ' + l + ', 4.0), max(0.0, 2.0 * ' + g + ' - 1.0))';
  };
  G.faceShadeExpr = function (faceExpr, sel, u) {
    var S = G.SHADE, f = G.f;
    var e2 = faceExpr + '==' + (u ? '2u' : '2'), e3 = faceExpr + '==' + (u ? '3u' : '3');
    var e45 = faceExpr + '>=' + (u ? '4u' : '4');
    return sel(e2, f(S.FACE[2]), sel(e3, f(S.FACE[3]), sel(e45, f(S.FACE[4]), f(S.FACE[0]))));
  };

  /**
   * The FALLBACK tint expression: the three constants above, chosen by the 2-bit field. Both
   * backends still emit it, because it is what a vertex gets before the tint map exists.
   */
  G.tintExpr = function (tintExpr, sel, u, vec3) {
    var S = G.SHADE, f = G.f;
    var v = function (c) { return vec3(f(c[0]), f(c[1]), f(c[2])); };
    return sel(tintExpr + '==' + (u ? '1u' : '1'), v(S.TINT[1]),
           sel(tintExpr + '==' + (u ? '2u' : '2'), v(S.TINT[2]),
           sel(tintExpr + '==' + (u ? '3u' : '3'), v(S.TINT[3]), v(S.TINT[0]))));
  };

  /**
   * The LIVE tint expression (PLAN W6). Emitted by both backends so a change lands in both
   * languages at once, exactly as `faceShadeExpr` is.
   *
   *   tintExpr  the 2-bit channel: 0 none, 1 grass, 2 foliage, 3 water
   *   wpExpr    the vertex's world position (a vec3)
   *   uTint     a vec4 uniform: xy = the map's world origin, z = 1/(texels), w = 1 when live
   *   sampleFn  a builder the backend supplies: `sampleFn(uvExpr, layerExpr)` -> its own
   *             source for reading an RGB from the tint texture. GLSL and WGSL do not spell
   *             a texture read the same way, and this is the only part of the expression that
   *             differs between them.
   *
   * ⚠ THERE IS NO HALF-TEXEL OFFSET HERE (D-122), and its absence is a derivation rather than
   * an oversight. An earlier draft of this function carried a `+ 0.5` and a confident note
   * explaining why it was needed; `tintcheck` §7 did the arithmetic and it was wrong.
   *
   * `wpExpr` is a VERTEX position, so it is a block CORNER — the continuous world coordinate
   * where the block lattice has its integers. Quart cell k therefore spans the continuous
   * range [origin + 4k, origin + 4k + 4) and has its centre at origin + 4k + 2, and that cell
   * is the one whose biome filled texel k. A texel's centre in texture space is at
   * (k + 0.5) / N, so the one requirement is
   *
   *     uv(origin + 4k + 2) = (k + 0.5) / N   =>   uv(p) = (p - origin) * 0.25 / N
   *
   * which is the expression below, offset and all. Two consequences fall out of it, and
   * `tintcheck` asserts both:
   *
   *   * a vertex at a quart-cell boundary (p = origin + 4k) lands exactly halfway between
   *     texels k-1 and k, so the crossfade between two biomes is centred on the border rather
   *     than sitting to one side of it;
   *   * adding 0.5 would put texel k's centre at the cell's WEST EDGE instead and shift every
   *     colour in the world two blocks north-west — precisely the failure the old note argued
   *     the `+ 0.5` was there to prevent.
   */
  // The tint map's dimensions live HERE rather than in 06b_tintmap.js, because both backends
  // have to create the texture whether or not the map module is present — a backend that sized
  // its texture from `NS.Tint` fell over in the shader harness, which loads the renderer without
  // the world. `Tint.init` asserts it agrees with these.
  G.TINT_TEXELS = 256;
  G.TINT_LAYERS = 3;              // 1 grass, 2 foliage, 3 water — the mesher's tint field
  G.TINT_BLOCKS = G.TINT_TEXELS * 4;
  G.tintMapExpr = function (tintExpr, wpExpr, sampleFn, sel, u, vec3, tintUni, fcast) {
    var f = G.f;
    var U = tintUni || 'uTint';
    var cast = fcast || 'float';
    var uv = '(' + wpExpr + '.xz - ' + U + '.xy) * 0.25 * ' + U + '.z';
    var lay = cast + '(' + tintExpr + ') - 1.0';
    var lookup = sampleFn(uv, lay);
    // channel 0 is "no tint at all" and must stay pure white; uTint.w is 0 until the map is up
    return sel(tintExpr + '==' + (u ? '0u' : '0'), vec3(f(1), f(1), f(1)),
           'mix(' + G.tintExpr(tintExpr, sel, u, vec3) + ', ' + lookup + ', ' + U + '.w)');
  };

  /**
   * D-503's OWED, CLOSED: the per-entity RGB tint channel. `packModelVertex`'s w3 bits 17-25
   * (three 3-bit fields, next to D-234's `flag` bit at 16) hold a MULTIPLICATIVE (r,g,b) in
   * eighths -- (7,7,7) is the identity, ~1.0 each, the value every non-tinted vertex reads
   * back as. This is the channel D-503 named \"needs an RGB channel in 3 backends\" for --
   * MineHTML's F4 diagnostics overlay (D-431's OWED) hangs its own per-entity colour on this,
   * but the channel itself is backend plumbing: anything that calls `emitMobLayer`/`emitPart`
   * with an `er/eg/eb` triple gets it drawn, F4 or not.
   *
   * Emitted by both backends so a change lands in both languages at once -- the same reason
   * `faceShadeExpr`/`tintMapExpr` are shared source text rather than duplicated GLSL/WGSL.
   *
   *   d3Expr  the packed word (`d3`/`m.w` in both `vs_model`s, already the right type)
   *   u       true for WGSL's `17u`/`7u` bit-op suffixes, false/undefined for GLSL's bare ints
   *   vec3    the backend's own `vec3(a,b,c)` source builder
   *   fcast   the backend's float-cast function name ('float' GLSL, 'f32' WGSL)
   */
  G.entityTintExpr = function (d3Expr, u, vec3, fcast) {
    var f = G.f;
    var cast = fcast || 'float';
    var suf = u ? 'u' : '';
    var chan = function (shift) {
      return cast + '((' + d3Expr + ' >> ' + shift + suf + ') & 7' + suf + ') * ' + f(1 / 7);
    };
    return vec3(chan(17), chan(20), chan(23));
  };

  /**
   * #1849: the per-vertex alpha / dissolve CUTOFF, `packModelVertex`'s w3 bits 27-31 (5 bits,
   * 0..31 over 31). Vanilla's `entityAlpha` rule (the ender dragon's death dissolve,
   * `EnderDragonRenderer` + the `entity_alpha` render type): a fragment is discarded where the
   * TEXEL alpha < this vertex alpha. 0 is the identity -- nothing is ever below 0 -- so every
   * vertex that does not pass one (the cube stream, every existing model caller) draws as before.
   * Shared source text, like `entityTintExpr`, so both `vs_model`s read it identically (D-52).
   */
  G.entityAlphaExpr = function (d3Expr, u, fcast) {
    var suf = u ? 'u' : '';
    return (fcast || 'float') + '((' + d3Expr + ' >> 27' + suf + ') & 31' + suf + ') * ' + G.f(1 / 31);
  };

  // ---------------------------------------------------------------------------
  // 9.2 Vertex arenas (D-86)
  //
  // Before: every section owned a GPU buffer. Streaming at render distance 12 creates and
  // destroys a few hundred of them a second, and driver-side buffer churn is one of the two
  // things that make an iGPU hitch (the other is uploading too many bytes at once, which
  // flushUploads caps separately).
  //
  // Now: section vertex data is sub-allocated into shared ARENA buffers, one per size class,
  // and freeing a section returns a slot to a free list instead of destroying anything. The
  // GPU-side allocation count drops from "one per section" to "about a dozen for the whole
  // world", uploads become writes into a buffer that already exists, and consecutive draws out
  // of the same arena need no rebind at all.
  //
  // This works only because of D-25: the ONE global index buffer is a linear ramp
  // (quad i uses vertices 4i..4i+3), so a section sitting at quad offset Q inside an arena is
  // drawn simply by starting 6Q indices in. No base-vertex support needed — WebGL2 has none.
  // An arena is capped at MAX_QUADS quads precisely so the largest index stays under 65536.
  //
  // Size classes trade a little memory for zero fragmentation: a section rounds up to the next
  // class and gets a fixed slot, so alloc and free are both O(1) and no slot ever splits. The
  // steps are ~1.5x, so the average waste is about 20%.
  // ---------------------------------------------------------------------------

  G.QUAD_CLASSES = [32, 64, 96, 128, 192, 256, 384, 512, 768, 1024, 1536, 2048, 3072, 4096, 6144, 8192, 16383];
  G.ARENA_MAX_SLOTS = 48;

  G.classFor = function (quads) {
    var C = G.QUAD_CLASSES;
    for (var i = 0; i < C.length; i++) if (quads <= C[i]) return i;
    return -1;
  };

  /**
   * Arenas(newFn, freeFn) — the allocator itself. Backend-agnostic on purpose: GfxGL and GfxGPU
   * hand it two callbacks and get identical placement, so a bug here cannot make the two
   * backends disagree about where a section's vertices live (D-3).
   *
   *   newFn(quadCapacity) -> arena object (whatever the backend wants), or null
   *   freeFn(arena)       -> release it
   *
   * alloc(quads) -> {arena, id, cls, slot, quadOfs} | null
   */
  G.Arenas = function (newFn, freeFn) {
    this.newFn = newFn; this.freeFn = freeFn;
    this.byClass = [];          // class index -> [arena, ...]
    this.nextId = 1;
    this.count = 0;             // live arenas
    this.bytes = 0;             // GPU bytes held by arenas
    this.used = 0;              // slots in use
  };

  G.Arenas.prototype.alloc = function (quads) {
    var cls = G.classFor(quads);
    if (cls < 0) return null;
    var cq = G.QUAD_CLASSES[cls];
    var pool = this.byClass[cls] || (this.byClass[cls] = []);
    var i, a;
    for (i = 0; i < pool.length; i++) {
      a = pool[i];
      if (a.free.length) {
        var slot = a.free.pop();
        this.used++;
        return { arena: a, id: a.id, cls: cls, slot: slot, quadOfs: slot * cq };
      }
    }
    var slots = Math.floor(NS.CFG.MAX_QUADS / cq);
    if (slots > G.ARENA_MAX_SLOTS) slots = G.ARENA_MAX_SLOTS;
    if (slots < 1) slots = 1;
    a = this.newFn(slots * cq);
    if (!a) return null;
    a.id = this.nextId++;
    a.cls = cls;
    a.slots = slots;
    a.free = [];
    for (i = slots - 1; i >= 1; i--) a.free.push(i);
    pool.push(a);
    this.count++;
    this.bytes += slots * cq * NS.CFG.QUAD_BYTES;
    this.used++;
    return { arena: a, id: a.id, cls: cls, slot: 0, quadOfs: 0 };
  };

  G.Arenas.prototype.release = function (rec) {
    if (!rec || !rec.arena) return;
    var a = rec.arena, pool = this.byClass[rec.cls];
    a.free.push(rec.slot);
    this.used--;
    rec.arena = null;
    if (!pool || a.free.length !== a.slots) return;
    // The arena is completely empty. Keep one spare per class so a player walking back and forth
    // across a class boundary does not thrash the driver; destroy any beyond that.
    var empties = 0;
    for (var i = 0; i < pool.length; i++) if (pool[i].free.length === pool[i].slots) empties++;
    if (empties <= 1) return;
    var k = pool.indexOf(a);
    if (k >= 0) pool.splice(k, 1);
    this.count--;
    this.bytes -= a.slots * G.QUAD_CLASSES[a.cls] * NS.CFG.QUAD_BYTES;
    this.freeFn(a);
  };

  G.Arenas.prototype.destroyAll = function () {
    for (var c = 0; c < this.byClass.length; c++) {
      var pool = this.byClass[c];
      if (!pool) continue;
      for (var i = 0; i < pool.length; i++) this.freeFn(pool[i]);
      pool.length = 0;
    }
    this.count = 0; this.bytes = 0; this.used = 0;
  };

  // ---------------------------------------------------------------------------
  // Section keys and mesh bookkeeping
  // ---------------------------------------------------------------------------

  G.sectionKey = function (cx, cz, sy) {
    return (cx & 0x3FFFFF) * 83886080 + (cz & 0x3FFFFF) * 20 + sy;
  };

  /**
   * init(canvas, atlasCanvas) -> Promise<bool>
   *
   * ⚠ WEBGL2 IS THE DEFAULT (D-15, PLAN blocker B1). Changed 6 Sept 2026.
   *
   * This used to try WebGPU first and fall back on failure. The problem is that WebGPU here
   * does not FAIL — it initialises, reports success, and then renders a black world with a
   * perfectly working GUI on Dan's RX 6800XT. Measured 6 Sept 2026; F9 swaps to WebGL2 at
   * runtime and the world appears immediately. A fallback path cannot rescue a backend that
   * lies about working, so the default must not be the broken one.
   *
   * WebGPU is not abandoned: `Settings.backend = 'webgpu'`, the title menu's backend picker
   * and the F9 key all still reach it, and it stays a stated goal. It is opt-in until it is
   * proven on hardware rather than opt-out after it fails.
   */
  /**
   * Hook: swap the drawing canvas for a fresh element and return it, or null if the host cannot.
   *
   * ⚠ IT IS A HOOK BECAUSE THE ELEMENT IS NOT THIS MODULE'S. `Main` owns `Main.glCanvas` and
   * `Input.el` points at it; a canvas replaced behind their backs leaves the input layer
   * listening to a node that is no longer in the document, which is a worse bug than the one
   * being fixed. `17_main.js` installs it (D-310).
   */
  G.replaceCanvas = null;

  G.init = function (canvas, atlasCanvas) {
    G.canvas = canvas;
    G.backend = null;
    G.name = 'none';
    G.fallbackReason = '';
    G.meshes.clear();
    G.meshList.length = 0;
    G.uploadQueue.length = 0;
    G.cam = NS.Cam.create();
    G.cam.fov = (NS.Settings && NS.Settings.fov) || 70;
    G.uploadsPerFrame = (NS.Settings && NS.Settings.uploadsPerFrame) || NS.CFG.UPLOADS_PER_FRAME;
    G.frameState = {
      viewProj: null,
      // ⚠ CAMERA-RELATIVE (D-179). `viewProj` has the eye at the origin and every section
      // origin handed to a backend is `world − eye`, so the camera position the SHADER sees
      // is (0, 0, 0) and its fog term is just length(wp). camX/camY/camZ stay in the struct
      // and stay uploaded — they are the shader's camera, and it is now the origin.
      camX: 0, camY: 0, camZ: 0,
      // The camera's TRUE world position, in doubles, for the handful of things that still
      // need it: the tint map's origin is a world coordinate and has to be moved into the same
      // eye-relative space before it reaches a float32 uniform (D-179).
      eyeX: 0, eyeY: 0, eyeZ: 0,
      fogR: G.sky[0], fogG: G.sky[1], fogB: G.sky[2],
      fogNear: 64, fogFar: 128,
      skyScale: 1.0, skyFrame: null,
      // PLAN G16b — the sky pass's own matrix, with its own far plane (D-304). Allocated once
      // and rewritten in place every frame, like every other matrix in this struct.
      skyViewProj: new Float32Array(16),
      time: 0,
      wireframe: false
    };
    G.attachDebugKeys();

    // ⚠⚠ WEBGPU POISONS THE CANVAS, AND THE BOOT FALLBACK USED THE SAME ONE (D-310). A canvas
    // that has handed out a 'webgpu' context can NEVER hand out a 'webgl2' one — `Main.applyBackend`
    // has known that since F9 existed and replaces the element for the manual swap. The BOOT path
    // did not. So on a machine where WebGPU fails for any reason at all, WebGL2 was then asked of
    // a canvas that could not answer, reported "no webgl2 context (driver, blocklist or software
    // rendering disabled)" on a perfectly good GPU, and the game died on the fatal screen with a
    // message blaming the driver. **The fallback that exists to rescue the boot could not run.**
    var tryGL = function (why) {
      if (why) G.fallbackReason = why;
      if (!NS.GfxGL) return false;
      if (NS.GfxGPU && NS.GfxGPU.contextTaken) {
        var fresh = G.replaceCanvas ? G.replaceCanvas() : null;
        if (fresh) canvas = fresh;
        else G.fallbackReason += ' | ⚠ the canvas already holds a webgpu context and no replacement'
                               + ' was available, so webgl2 cannot be created on it';
      }
      return Promise.resolve(NS.GfxGL.init(canvas, atlasCanvas)).then(function (ok) {
        if (ok) { G.backend = NS.GfxGL; G.name = 'webgl2'; G.resize(G.width, G.height); G.applyQuality(); return true; }
        return G.fail();
      }, function (e) {
        G.fallbackReason += ' | webgl2 threw: ' + (e && e.message);
        return G.fail();
      });
    };

    // G.force (set by the F9 swap key, the title menu and Settings.backend) pins one backend.
    // 'webgl2' takes the WebGL2 path directly; 'webgpu' opts INTO WebGPU and still falls back
    // rather than showing nothing. Anything else - including 'auto' and unset - is WebGL2.
    if (G.force === 'webgl2') return Promise.resolve(tryGL('forced to webgl2'));
    if (!NS.ENV.hasWebGPU) return Promise.resolve(tryGL('navigator.gpu not present'));
    if (G.force !== 'webgpu') {
      return Promise.resolve(tryGL('webgl2 is the default backend (D-15); choose WebGPU in the menu or press F9'));
    }

    return Promise.resolve(NS.GfxGPU.init(canvas, atlasCanvas)).then(function (ok) {
      if (ok) { G.backend = NS.GfxGPU; G.name = 'webgpu'; G.resize(G.width, G.height); G.applyQuality(); return true; }
      return tryGL('WebGPU unavailable: ' + (NS.GfxGPU.failReason || 'init returned false'));
    }, function (e) {
      return tryGL('WebGPU init threw: ' + (e && e.message));
    });
  };

  /** Both backends are out. Say exactly what is missing rather than showing a black rectangle. */
  G.fail = function () {
    G.backend = null;
    G.name = 'none';
    G.failReason = G.diagnostics();
    if (NS.Hud && NS.Hud.fatal) NS.Hud.fatal(G.failReason);
    return false;
  };

  G.diagnostics = function () {
    var lines = [];
    lines.push('No usable GPU backend.');
    lines.push('');
    lines.push('MC-Lite needs WebGPU or WebGL2. This browser reported:');
    lines.push('  navigator.gpu        ' + (NS.ENV.hasWebGPU ? 'present' : 'MISSING'));
    lines.push('  WebGL2 context       ' + (NS.probeWebGL2() ? 'present' : 'MISSING'));
    lines.push('  origin               ' + (typeof location !== 'undefined' ? location.protocol : '?'));
    lines.push('  hardwareConcurrency  ' + (NS.ENV.cores || 'unknown'));
    lines.push('');
    if (NS.GfxGPU && NS.GfxGPU.failReason) lines.push('  webgpu: ' + NS.GfxGPU.failReason);
    if (NS.GfxGL && NS.GfxGL.failReason)   lines.push('  webgl2: ' + NS.GfxGL.failReason);
    if (G.fallbackReason) lines.push('  chain : ' + G.fallbackReason);
    lines.push('');
    lines.push('Most likely fixes:');
    lines.push('  * update the browser (WebGL2 has shipped since 2017)');
    lines.push('  * enable hardware acceleration in the browser settings');
    lines.push('  * update or reinstall the graphics driver');
    lines.push('  * if this is a remote desktop or a VM, try a local session');
    return lines.join('\n');
  };

  /**
   * Debug keys, attached by init() so 13_input.js does not have to know the renderer exists.
   * F-keys only, because 13_input.js deliberately does not preventDefault on those.
   *   F6  depth prepass   F7  wireframe   F8  occlusion on/off   F10  freeze the cull frustum
   *
   * ⚠ D-431 — **F4 IS NO LONGER THE WIREFRAME.** Dan, session 55: *"move what is currently
   * linked to f4 to f7, and add in f4 what we have in f4 in claudeisthegoat."* F4 is the
   * diagnostics overlay now (`15i_diag.js`), which is where it is in MineHTML, so the two
   * projects' debug keys mean the same thing. The wireframe moved to F7 and the frozen cull
   * frustum, which WAS F7, moved to F10 — nothing was dropped to make room.
   */
  G.attachDebugKeys = function () {
    if (!NS.ENV.hasWindow || G._keysAttached) return;
    G._keysAttached = true;
    window.addEventListener('keydown', function (e) {
      if (e.code === 'F7') G.wireframe = !G.wireframe;
      else if (e.code === 'F6') G.depthPrepass = !G.depthPrepass;
      else if (e.code === 'F10') G.frozenFrustum = !G.frozenFrustum;
      else if (e.code === 'F8') {
        G.occlusion = !G.occlusion;
        if (NS.Hud && NS.Hud.say) NS.Hud.say('occlusion culling ' + (G.occlusion ? 'on' : 'off'));
      }
      else return;
      e.preventDefault();
    }, { passive: false });
  };

  /**
   * applyQuality() — pull every renderer-side number out of MCL.Settings. Called at init, and
   * again by Settings.applyPreset() whenever the quality preset changes, so there is exactly one
   * direction of dependency: Settings decides, Gfx obeys, and no other module reads either.
   */
  G.applyQuality = function () {
    var S = NS.Settings;
    if (!S) return;
    G.uploadsPerFrame     = S.uploadsPerFrame     || NS.CFG.UPLOADS_PER_FRAME;
    G.uploadBytesPerFrame = S.uploadBytesPerFrame || 262144;
    G.occlusion           = S.occlusion !== false;
    G.depthPrepass        = !!S.depthPrepass;
    G.fogStart            = S.fogStart || 0.55;
    G.fogEnd              = S.fogEnd   || 1.0;
    if (G.cam) G.cam.fov = S.fov;
    if (G.backend && G.backend.setQuality) G.backend.setQuality({ mipmaps: S.mipmaps !== false });
  };

  G.resize = function (w, h) {
    G.width = Math.max(1, w | 0); G.height = Math.max(1, h | 0);
    if (G.cam) G.cam.aspect = G.width / G.height;
    if (G.backend) G.backend.resize(G.width, G.height);
  };

  /** Hand a §8 mesh buffer in; it is uploaded within the next few frames, not immediately (D-43). */
  G.setSectionMesh = function (cx, cz, sy, buf) {
    G.uploadQueue.push({ key: G.sectionKey(cx, cz, sy), cx: cx, cz: cz, sy: sy, buf: buf });
  };

  /** Remove one section's mesh from both the map and the flat list (swap-pop, O(1)). */
  function dropMesh(key) {
    var m = G.meshes.get(key);
    if (!m) return;
    G.backend.destroySectionMesh(m.handle);
    G.meshes.delete(key);
    var list = G.meshList, last = list.pop();
    if (last !== m) { list[m.li] = last; last.li = m.li; }
  }

  /**
   * Uploads are budgeted twice: by COUNT, because each one is a driver round trip, and by
   * BYTES, because four 500 KB sections in one frame is a visible hitch on an iGPU even though
   * it is only four calls (D-43, D-86). Whichever limit is reached first ends the frame's
   * uploads; the queue drains on the next one.
   */
  /**
   * PLAN G16 — the sky, the fog and the sky-light scale for this frame.
   *
   * ⚠ THE BIOME IS SAMPLED THROUGH VANILLA'S OWN CUBIC BLUR, not read at the camera cell. A
   * point sample snaps the whole sky the instant you cross a biome border; `CubicSampler`'s
   * 6x6x6 kernel spans twenty-four blocks, so the swamp's green arrives over a walk rather than
   * in a step. The blur is the expensive part (216 taps), so it runs at QUART resolution the way
   * vanilla does and the taps are a chunk-column lookup, not a worldgen call.
   *
   * ⚠ AND IT DEGRADES RATHER THAN THROWS. Before a world exists — the title screen — there is
   * no biome to sample, so the defaults above stand.
   */
  G.updateSky = function (rd) {
    // GameRenderer.tick: skyDarkness += 0.05 per tick (cap 1) while BossBarHud.shouldDarkenSky(), else -= 0.0125.
    // Stepped by wall-clock (20 ticks/s); a darkenSky bar = a live wither within the 64-block tracking range.
    var nowS = Date.now() / 1000, dtS = G._sdT ? Math.min(0.25, nowS - G._sdT) : 0;
    G._sdT = nowS;
    var darken = false, EL = NS.EntityList, cam0 = G.cam;
    if (EL && EL.list && cam0) {
      for (var ei = 0; ei < EL.list.length && !darken; ei++) {
        var eo = EL.list[ei];
        if (eo && eo.bossBar && eo.bossBar.darkenSky && !eo.removed && !eo.dead &&
            Math.abs(eo.x - cam0.x) < 64 && Math.abs(eo.z - cam0.z) < 64) darken = true;
      }
    }
    var sd = G.skyDarkness || 0;
    if (darken) sd = Math.min(1, sd + 1.0 * dtS);
    else if (sd > 0) sd = Math.max(0, sd - 0.25 * dtS);
    G.skyDarkness = sd;
    var Sky = NS.Sky, W = NS.World, B = NS.Biomes;
    if (!Sky || !Sky.ready || !W || !B || !B.ready) return;
    var cam = G.cam;
    var cx = Math.floor(cam.x), cy = Math.floor(cam.y), cz = Math.floor(cam.z);
    var skyOf = function (qx, qy, qz) {
      var b = W.biomeAt(qx * 4, qz * 4);
      return Sky.rgb24(B.skyColor(b));
    };
    var fogOf = function (qx, qy, qz) {
      var b = W.biomeAt(qx * 4, qz * 4);
      return Sky.rgb24(B.fogColor(b));
    };
    var biomeSky = Sky.blendedColor(cx, cy, cz, skyOf);
    var biomeFog = Sky.blendedColor(cx, cy, cz, fogOf);
    // D-657: the camera's forward x (vanilla's Camera.horizontalPlane.x) for the sunrise fog blend
    var lookX = Math.sin(cam.yaw) * Math.cos(cam.pitch);
    var f = Sky.frame(biomeSky, biomeFog, rd, lookX);
    G.sky = f.sky; G.fog = f.fog; G.skyDarken = f.skyDarken; G.skyFrame = f;
    // loop/lightning -- a cheap whole-sky brightness flash while a live, non-cosmetic bolt is
    // in its flash window (Lgt.flashLevel, 07zzc_lightning.js) -- not vanilla's real per-bolt
    // screen geometry (Lgt.OWED), just a lerp toward white on the two colours this frame
    // already computed.
    // #1892 -- BackgroundRenderer.render water branch: under water the clear colour is the biome's
    // water_fog_color (eased over 5 s), rescaled by the underwater visibility; applyFog's range is G.waterFog.
    var P = NS.Player, wet = !!(P && P.eyeInWater && !P.eyeInLava);
    G._uwTicksT = (G._uwTicksT || 0) + dtS * 20;
    for (; G._uwTicksT >= 1; G._uwTicksT--)
      G.uwTicks = Sky.underwaterTicks(G.uwTicks | 0, wet, !!(NS.Gamemode && P && P.mode === NS.Gamemode.SPECTATOR));
    G.waterFog = null;
    if (!G._wfSt) G._wfSt = Sky.newWaterFog();
    if (wet) {
      var wb = W.biomeAt(cx, cz);
      var vis = Sky.underwaterVisibility(G.uwTicks | 0, true);
      G.fog = Sky.waterFogFinish(Sky.waterFogColor(G._wfSt, B.waterFogColor(wb), Date.now()), G.skyDarkness || 0, vis);
      G.waterFog = Sky.waterFogRange(vis, B.category ? B.category(wb) === 'swamp' : false, rd * 16);
    } else Sky.waterFogLeave(G._wfSt);
    // #303 BackgroundRenderer.applyFog: blindness replaces the water fog range; the ending 20 ticks darken the colour
    G.blindFog = null;
    var evf = NS.EffectView && P ? NS.EffectView.frameFor(P, rd * 16 * G.fogEnd, NS.Main && NS.Main.partial ? NS.Main.partial() : 1) : null;
    G.nightVision = evf ? evf.nightVision : 0;
    if (evf && evf.blind && !(P.mode === (NS.Gamemode && NS.Gamemode.SPECTATOR))) {
      G.blindFog = evf.blind.fog;
      var bc = evf.blind.color; G.fog = [G.fog[0] * bc, G.fog[1] * bc, G.fog[2] * bc];
    }
    var flash = (NS.Lightning && NS.Lightning.flashLevel) ? NS.Lightning.flashLevel() : 0;
    if (flash > 0) {
      G.sky = NS.Sky.lerpToWhite(G.sky, flash);
      G.fog = NS.Sky.lerpToWhite(G.fog, flash);
    }
  };

  // ⚠ NEAR-DISC UPLOAD PRIORITY (D-711/D-198 follow-up). `uploadQueue` is FIFO in COMPLETION
  // order, which tracks wherever the camera WAS when each job was issued, not where it is now.
  // Rapid multi-chunk movement (fast creative fly/teleporting, `tools/chunkstreamholepeek.mjs`)
  // queues hundreds of far-away uploads across several old camera positions before the section
  // under the player's NEW position has even been requested; W.stream's own near-disc guarantee
  // (D-198: nothing left unmeshed within four chunks of the player) only covers the job being
  // ISSUED to a worker; it says nothing about the result's place in this FIFO once the worker
  // replies. Measured: 695 queued uploads, the player's own standing section at position 685,
  // draining at 2-4 a frame — the ground under the player renders as fog for seconds while
  // uploads from a chunk the camera left ten frames ago go first. Fix: a bounded scan (first
  // `NEAR_SCAN` entries only, so the cost never grows with backlog size — flat, unlike the
  // budget it must not touch) promotes near-disc UPLOADS to the front, capped at
  // `uploadsPerFrame` promotions so this can never itself add work beyond what the frame's
  // existing budget already allowed — it reorders inside `uploadsPerFrame`/`uploadBytesPerFrame`,
  // it does not add to them. D-194's invariant — a removal must never be outrun by a re-upload of
  // the SAME key — is kept: a removal is never promoted (only `job.buf` truthy entries are
  // candidates) and a key already seen earlier in the scanned prefix (removal OR upload) is
  // skipped, so nothing jumps ahead of an earlier entry for its own section.
  var NEAR_SCAN = 2048;
  // ⚠ Deliberately narrower than D-198's four-chunk near-disc floor (that radius covers ~49
  // columns, and every column's several dirty sections compete for the same handful of
  // `uploadsPerFrame` promotion slots — wide enough to dilute the promotion back to a FIFO-ish
  // wait). This radius is the immediate 3x3 around the player, the same footprint
  // `neighbourhoodReady` already uses — the column a player looking straight down is actually
  // looking at, so its handful of sections win the promotion slots outright instead of
  // sharing them with the whole near-disc.
  G.NEAR_UPLOAD_R2 = 2;

  function promoteNearUploads(q, camCx, camCz) {
    var lim = Math.min(q.length, NEAR_SCAN);
    if (lim < 2) return;
    var seen = Object.create(null);
    var near = [], rest = [];
    var cap = G.uploadsPerFrame > 0 ? G.uploadsPerFrame : 1;
    for (var i = 0; i < lim; i++) {
      var cand = q[i];
      if (!seen[cand.key] && cand.buf && near.length < cap) {
        var ddx = cand.cx - camCx, ddz = cand.cz - camCz;
        if (ddx * ddx + ddz * ddz <= G.NEAR_UPLOAD_R2) {
          near.push(cand); seen[cand.key] = true; continue;
        }
      }
      seen[cand.key] = true;
      rest.push(cand);
    }
    if (!near.length) return;
    var tail = q.slice(lim);
    q.length = 0;
    for (i = 0; i < near.length; i++) q.push(near[i]);
    for (i = 0; i < rest.length; i++) q.push(rest[i]);
    for (i = 0; i < tail.length; i++) q.push(tail[i]);
  }

  G.flushUploads = function () {
    if (!G.backend) return;
    var q = G.uploadQueue;
    var n = 0, drops = 0, bytes = 0, budget = G.uploadBytesPerFrame;
    // ⚠ THE THIRD WHITE FLASH, AND IT IS A QUEUE, NOT A CULL (D-194). `setSectionMesh(..., null)`
    // — an eviction — rides the SAME fifo as a real upload, and the old loop charged it one of
    // the two or four upload slots a frame. A teleport, a preset change or the adaptive render
    // distance pulling in (D-46) evicts a whole ring at once: measured at 386 removals queued in
    // one frame, ahead of 336 real uploads. At `uploadsPerFrame = 2` that is 193 frames — six
    // seconds — in which the only thing the GPU is told to do is free memory, while the sections
    // the player is standing in wait their turn behind it. The screen holds the clear colour, and
    // the clear colour is the sky. D-162 and D-171/D-175 each removed a way to lose the picture;
    // this one is why it still went missing "when new chunks and stuff are loading".
    // Removals get their own budget and are drained IN ORDER — the queue stays fifo, so a drop
    // and a re-upload of the same section can never swap places.
    if (NS.World) promoteNearUploads(q, NS.World.camCx, NS.World.camCz);
    while (q.length) {
      var job = q[0];
      if (job.buf) {
        if (n >= G.uploadsPerFrame) break;
        if (n > 0 && bytes + job.buf.byteLength > budget) break;
      } else if (drops >= G.removalsPerFrame) break;
      q.shift();
      dropMesh(job.key);
      if (!job.buf) { drops++; continue; }
      n++;
      var hdr = NS.Mesher.readHeader(job.buf);
      if (!hdr) continue;
      var handle = G.backend.createSectionMesh(job.buf);
      if (!handle) continue;
      bytes += job.buf.byteLength;
      var m = {
        handle: handle, quads: hdr.quads,
        cx: job.cx, cz: job.cz, sy: job.sy,
        d: 0, li: G.meshList.length
      };
      G.meshes.set(job.key, m);
      G.meshList.push(m);
    }
    G.uploadedBytes = bytes;
    G.removed = drops;
  };

  /**
   * Drop every mesh WITHOUT telling the backend to free it (D-194). After a context or device
   * loss every handle is already dead; calling destroySectionMesh on one is at best a no-op and
   * at worst a console full of warnings about objects from another context.
   */
  G.forgetAllMeshes = function () {
    G.meshes.clear();
    G.meshList.length = 0;
    G.uploadQueue.length = 0;
  };

  /**
   * The backend got its context back. Every buffer it owned died with the old one, so the only
   * honest recovery is to forget them all and ask the world to mesh itself again (D-194).
   */
  G.onBackendRestored = function () {
    G.contextRestores++;
    G.forgetAllMeshes();
    if (G.backend && G.backend.name === G.name) G.resize(G.width, G.height);
    G.applyQuality();
    if (NS.World && NS.World.remeshAll) NS.World.remeshAll();
    if (NS.Hud && NS.Hud.say) NS.Hud.say('graphics context restored — rebuilding the world');
  };

  G.dropAll = function () {
    if (G.backend) G.meshes.forEach(function (m) { G.backend.destroySectionMesh(m.handle); });
    G.meshes.clear();
    G.meshList.length = 0;
    G.uploadQueue.length = 0;
  };

  /** 6-plane frustum test against a section AABB (D-45). */
  G.sectionVisible = function (cx, cz, sy) {
    var ox = cx * 16, oz = cz * 16, oy = NS.CFG.WORLD_MIN_Y + sy * 16;
    return NS.Cam.aabbVisible(G.cam, ox, oy, oz, ox + 16, oy + 16, oz + 16);
  };

  // ---------------------------------------------------------------------------
  // 9.1 The section visibility graph (D-85)
  //
  // Frustum culling answers "is this section in front of me". It does not answer "can I see it
  // from here", and underground — where a 2200G is at its worst, because every one of those
  // sections is dense geometry — that second question removes far more work than the first.
  //
  // The mesher hands every section a 15-bit mask saying which pairs of its six faces are joined
  // by a connected run of non-opaque blocks (05_mesher.js, M.visibility). This does a breadth-
  // first flood over the SECTION GRID from the one the camera is in, and only steps into a
  // neighbour it could actually see through:
  //
  //   * never reverse a direction already taken (the dirMask rule),
  //   * never step back toward the camera along the axis being stepped,
  //   * the section must connect the face we entered by to the face we are leaving by,
  //   * the neighbour must be inside the render distance — and NOT inside the frustum, which
  //     is a draw-time question and was moved there in session 4 (D-145).
  //
  // Everything the flood does not reach is not drawn, and everything it reaches is then frustum-
  // tested by `buildLists`. The 3x3x3 around the camera is seeded unconditionally, because near
  // the frustum apex a section can be on screen without any of its neighbours being.
  // ---------------------------------------------------------------------------

  var OPP = new Int8Array([1, 0, 3, 2, 5, 4]);

  // The mesher owns the canonical face-pair bit table; carry a local copy so this file does not
  // depend on load order (ARCH 1, rule 2 — the reference lives in 05_mesher.js).
  var PAIRBIT = new Int8Array(36);
  (function () {
    for (var i = 0; i < 36; i++) PAIRBIT[i] = -1;
    var n = 0;
    for (var a = 0; a < 6; a++) for (var b = a + 1; b < 6; b++) { PAIRBIT[a * 6 + b] = n; PAIRBIT[b * 6 + a] = n; n++; }
  })();
  G.PAIRBIT = PAIRBIT;


  var fl = {
    r: -1, d: 0, cap: 0, qcap: 0,
    stamp: 0,
    // mark[gi] packs (frameStamp << 6) | the set of faces we have already ENTERED this section
    // by. Storing the face set — rather than a plain visited flag — is what lets a section be
    // re-explored when a second path reaches it from a different side, which is worth about
    // four percent of the picture deep underground and costs about a third more flood steps.
    mark: null,
    qi: null,       // Int32Array(qcap)  queued grid index
    qm: null,       // Int32Array(qcap)  entry face (0-5, or 7 for "seed") | dirMask << 3
    col: null,      // Array(d*d)        chunk refs, filled lazily
    colStamp: null, // Int32Array(d*d)
    visited: 0,
    // ⚠ THE FLOOD IS ALLOWED TO RUN OUT OF QUEUE, AND IT MAY NOT LIE ABOUT IT (D-198). See
    // `floodVisible`'s tail check and `floodHas`'s first line.
    overflow: false,
    overflows: 0
  };
  G._flood = fl;

  /**
   * Size the flood's scratch for radius r. The buffers only ever GROW — the adaptive render
   * distance (D-46) moves r by one every couple of seconds and reallocating three quarters of a
   * megabyte each time it does would be its own performance problem. The stamps are cleared
   * whenever the grid WIDTH changes, because a grid index means a different section afterwards.
   */
  function floodResize(r) {
    if (fl.r === r) return;
    var d = r * 2 + 1, cap = d * d * NS.CFG.SECTIONS_Y;
    // Up to six entry faces per section, but the realistic ceiling is well under two.
    // ⚠ 3x WAS NOT A CEILING, IT WAS A CLIFF THREE PER CENT AWAY (D-198). Measured at the HIGH
    // preset (r = 16, cap 21,780, so the old qcap was 65,340) flying a million blocks out and
    // looking out from a mountain top: 63,227 flood steps — 97% of the queue. At medium
    // (qcap 37,500) the worst frame took 34,156, which is 91%. Both presets were one open
    // horizon away from overflowing, and an overflow is SILENT: the tail check below drops the
    // step, every section behind it is never reached, and `floodHas` used to report each of
    // those as definitely occluded. 4x buys 40% headroom over the worst frame ever measured
    // here, and the overflow flag below is what makes being wrong about that survivable.
    var qcap = cap * 4;
    fl.r = r; fl.d = d; fl.cap = cap; fl.qcap = qcap;
    if (!fl.mark || fl.mark.length < cap) fl.mark = new Int32Array(cap);
    if (!fl.qi || fl.qi.length < qcap) { fl.qi = new Int32Array(qcap); fl.qm = new Int32Array(qcap); }
    if (!fl.col || fl.col.length < d * d) { fl.col = new Array(d * d); fl.colStamp = new Int32Array(d * d); }
    fl.mark.fill(0);
    fl.colStamp.fill(0);
    fl.stamp = 0;
  }

  /**
   * floodVisible(camCx, camCz, camSy, r) — stamp every section the camera can see.
   * Returns the number of flood steps taken. Allocates nothing.
   */
  G.floodVisible = function (camCx, camCz, camSy, r) {
    floodResize(r);
    var cam = G.cam, C = NS.Cam, W = NS.World, SY = NS.CFG.SECTIONS_Y, MINY = NS.CFG.WORLD_MIN_Y;
    var d = fl.d, mark = fl.mark, qi = fl.qi, qm = fl.qm, col = fl.col, colStamp = fl.colStamp;
    var qcap = fl.qcap;
    var stamp = ++fl.stamp;
    fl.overflow = false;
    // mark packs the stamp into the high 25 bits, so the wrap is at 33 million frames rather
    // than 2 billion. Still six days at 60 fps, and the reset is one fill.
    if (stamp >= 0x1FFFFFF) { mark.fill(0); colStamp.fill(0); stamp = fl.stamp = 1; }
    var SBASE = stamp * 64;

    if (camSy < 0) camSy = 0; else if (camSy >= SY) camSy = SY - 1;
    var head = 0, tail = 0, r2 = r * r;

    // Seed the 3x3x3 around the camera unconditionally: near the frustum apex a section can be
    // on screen without any of its neighbours being, and a hole in the world one metre from your
    // face is the one place this algorithm's approximation would be obvious.
    for (var sdy = -1; sdy <= 1; sdy++) {
      var ssy = camSy + sdy;
      if (ssy < 0 || ssy >= SY) continue;
      for (var sdz = -1; sdz <= 1; sdz++) {
        for (var sdx = -1; sdx <= 1; sdx++) {
          var sgx = r + sdx, sgz = r + sdz;
          if (sgx < 0 || sgx >= d || sgz < 0 || sgz >= d) continue;
          var sgi = (sgz * d + sgx) * SY + ssy;
          if (mark[sgi] >= SBASE) continue;
          mark[sgi] = SBASE + 63;            // seeded: never revisit, every exit already allowed
          qi[tail] = sgi; qm[tail] = 7;      // entry 7 = "seed"
          tail++;
        }
      }
    }

    var visited = 0;
    while (head < tail) {
      var gi = qi[head], meta = qm[head];
      head++; visited++;
      var sy = gi % SY, g = (gi - sy) / SY;
      var gx = g % d, gz = (g - gx) / d;
      var cx = camCx + gx - r, cz = camCz + gz - r;

      var entry = meta & 7, dirMask = meta >>> 3;

      // vis mask for this section, via a per-column chunk cache (a Map.get per section would
      // dominate the whole flood)
      var ci = gz * d + gx, ch;
      if (colStamp[ci] !== stamp) {
        colStamp[ci] = stamp;
        ch = col[ci] = W.chunks.get(W.key(cx, cz)) || null;
      } else ch = col[ci];
      var vis = ch ? ch.vis[sy] : 0x7FFF;

      for (var e = 0; e < 6; e++) {
        // Never double back HORIZONTALLY. The vertical axis is deliberately exempt: the world is
        // 20 sections tall and 2r+1 wide, so almost every interesting sight line goes up over a
        // ridge and back down, and banning that reversal is what makes a section-granular
        // visibility graph delete a hillside you can plainly see. Letting the flood move freely
        // in Y costs a bounded amount of extra work (there are only 20 layers) and removes most
        // of the artifact (D-85).
        if ((e < 2 || e > 3) && (dirMask & (1 << OPP[e]))) continue;

        var ngx = gx, ngz = gz, nsy = sy, ncx = cx, ncz = cz;
        switch (e) {
          case 0: ngx++; ncx++; break;
          case 1: ngx--; ncx--; break;
          case 2: nsy++;        break;
          case 3: nsy--;        break;
          case 4: ngz++; ncz++; break;
          default: ngz--; ncz--; break;
        }
        if (ngx < 0 || ngx >= d || ngz < 0 || ngz >= d || nsy < 0 || nsy >= SY) continue;
        var ddx = ngx - r, ddz = ngz - r;
        if (ddx * ddx + ddz * ddz > r2) continue;

        // can we see from the face we came in by, out through this one?
        if (entry !== 7 && entry !== e) {
          var pb = PAIRBIT[entry * 6 + e];
          if (pb >= 0 && !((vis >>> pb) & 1)) continue;
        }

        var ngi = (ngz * d + ngx) * SY + nsy;
        var nentry = OPP[e], nbit = 1 << nentry;
        var code = mark[ngi], bits = 0;
        if (code >= SBASE) {
          bits = code & 63;
          if (bits & nbit) continue;         // already explored from this side
        }
        // ⚠ D-145 — AND NO FRUSTUM TEST HERE. Until session 4 the flood refused to ENTER a
        // section that was off screen, and that is what produced the artifact this file used to
        // describe as a trade: a section reachable only through off-screen sections is dropped,
        // which underground is a hole in a wall you can see through. `cullcheck` measured it at
        // 3,160 wrong pixels of a 435,000-pixel frame, every one of them BRIGHTER with culling
        // on. The frustum is a property of the ENDPOINT, not of the sight line, so it belongs at
        // draw time — which is where vanilla and Sodium put it, and where `buildLists` now puts
        // it. Measured after the move: pixel-identical to the frustum-only picture both on the
        // surface and underground, **18 sections drawn where the frustum alone drew 22**, and
        // about 1,100 more flood steps to find that out. Fewer draws, fewer triangles, no hole.
        mark[ngi] = SBASE + (bits | nbit);
        // ⚠ AND SAY SO (D-198). Dropping the step is the only thing this loop can do with a full
        // queue, but the sections BEHIND the dropped one are then never visited, and "not
        // visited" is what `floodHas` reads as "occluded". One frame of a full queue therefore
        // deletes an arbitrary wedge of the world — the same failure D-171 fixed at the grid's
        // edge, arriving instead through the middle. A culling test may only ever say NO when it
        // is certain, so the frame that overflowed says nothing at all.
        if (tail >= qcap) { if (!fl.overflow) { fl.overflow = true; fl.overflows++; } continue; }
        qi[tail] = ngi; qm[tail] = nentry | ((dirMask | (1 << e)) << 3);
        tail++;
      }
    }
    fl.visited = visited;
    return visited;
  };

  /** Is this section stamped visible by the last flood? Used by the draw loop and by F3. */
  G.floodHas = function (camCx, camCz, cx, cz, sy) {
    var d = fl.d, r = fl.r;
    if (r < 0) return true;
    // ⚠ AN INCOMPLETE FLOOD IS NOT A NEGATIVE ANSWER (D-198). `floodVisible` ran out of queue on
    // this frame, so the sections it did not reach are UNKNOWN rather than hidden and the whole
    // frame falls back to the frustum alone — a few hundred more draws for one frame against an
    // arbitrary wedge of the world going missing. Same rule as the two lines below it.
    if (fl.overflow) return true;
    var gx = cx - camCx + r, gz = cz - camCz + r;
    // ⚠ OUTSIDE THE GRID IS "UNKNOWN", NOT "HIDDEN" (D-171). This returned FALSE, so any section
    // the flood's scratch does not cover was reported as definitely occluded and never drawn.
    // Meshes outlive the render distance: a column is evicted at `rd + evictMargin` and the
    // adaptive system (D-46) pulls `rd` in while the meshes built at the old distance are still
    // resident — so on any frame there are sections past `r` holding real geometry. They were
    // culled as "occluded" while the frustum alone would have drawn them, which is a hole in the
    // world at the horizon: `cullcheck` measured up to 2,975 pixels of distant tree canopy
    // appearing and disappearing with the flood. The same rule `World.visOf` already states for
    // an unloaded column — assume visible, let the frustum decide — and for the same reason: a
    // culling test may only ever say NO when it is certain.
    if (gx < 0 || gx >= d || gz < 0 || gz >= d) return true;
    // ⚠ AND THE CORNERS OF THE SQUARE, for exactly the same reason. `floodVisible` walks a
    // CIRCLE — it refuses any step with `ddx*ddx + ddz*ddz > r*r` — while this grid is the
    // SQUARE that circle is inscribed in, so the four corner wedges are never visited and were
    // therefore reported occluded. That is a quarter of the grid's area, and at the horizon it
    // is exactly where a diagonal sight line lands: `cullcheck` measured it as 2,975 pixels of
    // distant tree canopy in thin bands, appearing and disappearing with the flood. Not visited
    // is UNKNOWN, and the honest answer to unknown is yes — the frustum decides (D-171).
    var ddx = gx - r, ddz = gz - r;
    if (ddx * ddx + ddz * ddz > r * r) return true;
    return fl.mark[(gz * d + gx) * NS.CFG.SECTIONS_Y + sy] >= fl.stamp * 64;
  };

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  var listOpaque = [], listCutout = [], listTrans = [];
  // ⚠ A SECTION IS IN A LAYER'S LIST IF EITHER STREAM HAS GEOMETRY IN IT (D-131). It used to be
  // the greedy count alone, and for a world made of session 1's 49 block ids that was the same
  // thing — nothing was on the model stream but torches. It stopped being the same thing the
  // moment the world held real registry states: a plains surface section carries five greedy
  // quads in the OPAQUE layer and two hundred and fifty-six model quads in the CUTOUT layer,
  // because `grass_block` has a second element for its side overlay and is therefore model
  // geometry. `quads[1]` is zero, the section never entered the cutout list, and every grass
  // block in the game was invisible — you looked through the ground at the sky.
  var mq = null;

  /**
   * Opaque and cutout are sorted front-to-back for early-Z, but in coarse 24-block BANDS, and
   * within a band by the arena the mesh lives in (D-86). Early-Z only needs "roughly nearest
   * first" — the depth buffer does not care about the order of two sections 3 metres apart —
   * whereas the driver cares a great deal about how many times a frame rebinds a vertex buffer.
   * Grouping inside a band buys back most of the bind savings the distance sort would have cost.
   *
   * Translucent is sorted strictly back-to-front: it does not write depth, so its order IS the
   * result (D-26).
   */
  var BAND = 1 / 24;
  var byNear = function (a, b) { return (a.band - b.band) || (a.batch - b.batch) || (a.d - b.d); };
  var byFar  = function (a, b) { return b.d - a.d; };

  /**
   * #394: vanilla's `renderWorld` runs `bobViewWhenHurt` then (if the option is on) `bobView` on the
   * WORLD projection, not just the hand. Null when the player is absent or spectating-free of both.
   */
  var bobM = new Float32Array(16);
  G.viewBobMatrix = function () {
    var P = NS.Player, H3 = NS.Hand3D;
    if (!P || !H3 || !H3.bobHurt) return null;
    var partial = NS.Main && NS.Main.partial ? NS.Main.partial() : 1;
    var m = H3._m.ident(bobM);
    H3.bobHurt(m, P, partial);
    if (!NS.Settings || NS.Settings.viewBobbing !== false) H3.bobView(m, P, partial);
    G.applyNausea(m, P, partial);
    return m;
  };

  // #303 GameRenderer.renderNausea: rotate about (0,1,1), squash X by 1/g, rotate back. The strength is
  // ticked at 20 Hz off the wall clock (ClientPlayerEntity.updateNausea).
  var nauseaSt = { next: 0, last: 0 }, nauseaT = 0, nauseaTicks = 0, nauseaAxis = new Float32Array(16);
  function axisRot(out, deg) {
    var r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r), t = 1 - c, h = Math.SQRT1_2;
    var y = h, z = h;   // normalised (0,1,1)
    out.fill(0); out[15] = 1;
    out[0] = c; out[1] = z * s; out[2] = -y * s;
    out[4] = -z * s; out[5] = t * y * y + c; out[6] = t * y * z;
    out[8] = y * s; out[9] = t * y * z; out[10] = t * z * z + c;
    return out;
  }
  G.applyNausea = function (m, P, partial) {
    var EV = NS.EffectView, H3 = NS.Hand3D;
    if (!EV || !EV.nauseaWobble) return m;
    var now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (!nauseaT) nauseaT = now;
    var n = Math.min(5, Math.floor((now - nauseaT) / 50));
    nauseaT += n * 50;
    var fx = P.effects && P.effects.nausea, dur = fx && fx.duration > 0 ? fx.duration : 0;
    for (var i = 0; i < n; i++) { EV.tickNausea(nauseaSt, !!P.inPortal, dur); nauseaTicks++; }
    if (!(nauseaSt.next > 0)) return m;
    var sc = NS.Settings && NS.Settings.distortionEffectScale != null ? NS.Settings.distortionEffectScale : 1;
    var w = EV.nauseaWobble(nauseaSt, partial, nauseaTicks, sc, dur > 0);
    if (!w) return m;
    H3._m.mul(m, axisRot(nauseaAxis, w.degrees));
    H3._m.scale(m, w.scaleX, 1, 1);
    H3._m.mul(m, axisRot(nauseaAxis, -w.degrees));
    return m;
  };

  /** Pull the camera from the player, if there is one. Soft dependency, inside a function body. */
  G.syncCamera = function () {
    var P = NS.Player;
    if (!P) return;
    var c = G.cam;
    // ex/ey/ez, not x/y/z: the tick is 20 Hz and the screen is not. Player.interpolate() has
    // already blended the last two ticks for this frame (D-79).
    // the eye height moves with the pose (D-251): 1.62 standing, 1.27 crouching
    c.x = P.ex; c.y = P.ey + (P.cameraEyeY ? P.cameraEyeY(P.alpha === undefined ? 1 : P.alpha) : (P.eyeHeight || P.EYE)); c.z = P.ez;
    var ce = P.cameraEntity;
    if (ce) {
      // Minecraft.setCameraEntity: the view is the followed entity's eye, yaw and pitch
      c.x = ce.x; c.y = ce.y + P.cameraEyeHeight(ce); c.z = ce.z;
      NS.Cam.setLook(c, ce.yaw || 0, ce.pitch || 0);
    } else if (P.sleeping) {
      // struck s117: `Camera.update`'s own sleeping branch (.decomp Camera.java:54-58) --
      // yaw locked to the OPPOSITE of the bed's own FACING (`P.sleepYaw`, set once in
      // `Sleep.doSleep`, 14m_sleep.js), pitch locked to 0, and the camera nudged up 0.3 —
      // vanilla's own `moveBy(0.0, 0.3, 0.0)` on top of the already-sleeping eye height
      // (`P.eyeHeight` is 0.2 while `P.sleeping`, same file). The player ENTITY's own `P.yaw`/
      // `P.pitch` are left alone, same as vanilla only overriding the CAMERA's copy.
      c.y += 0.3;
      NS.Cam.setLook(c, P.sleepYaw !== undefined ? P.sleepYaw : P.yaw, 0);
    } else {
      NS.Cam.setLook(c, P.yaw, P.pitch);
    }
    // #2724 -- third person: back off along the look ray, stopping short of any solid block (vanilla
    // Camera.clipToSpace: 4 blocks, eight corner probes; ponytail: one centre probe, 0.1 steps).
    var tp = P.thirdPerson | 0;
    if (tp && !P.sleeping) {
      var yw = c.yaw, pt = c.pitch;
      if (tp === 2) { yw += Math.PI; pt = -pt; }
      NS.Cam.setLook(c, yw, pt);
      // back direction = opposite of the look vector (yaw 0 looks -Z, +yaw turns right, +pitch up)
      var cp = Math.cos(pt), dx = -Math.sin(yw) * cp, dy = -Math.sin(pt), dz = Math.cos(yw) * cp;
      var d = 0, Ph = NS.Physics;
      while (d < 4 && !(Ph && Ph.solidAt(Math.floor(c.x + dx * (d + 0.1)), Math.floor(c.y + dy * (d + 0.1)), Math.floor(c.z + dz * (d + 0.1))))) d += 0.1;
      c.x += dx * d; c.y += dy * d; c.z += dz * d;
    }
    if (NS.Settings) c.fov = NS.Settings.fov;
  };

  /**
   * Build and draw the first-person hand.
   *
   * ⚠ **IT HAS ITS OWN PROJECTION AND A NEAR PLANE OF ITS OWN.** Vanilla resets the projection
   * to `getProjectionMatrix(getFov(camera, partial, false))` before the hand — the same field of
   * view WITHOUT the speed-effect scale AND WITHOUT the FOV option (a fixed 70, `Hand3D.handFov`) — and the view matrix to IDENTITY, because the hand is
   * built in camera space. The far plane here is 16 blocks rather than the world's: the hand is
   * 0.7 blocks away and a far plane at the fog wall throws away most of the depth precision for
   * geometry that is all within a block of the eye.
   */
  G.HAND_FAR = 16;
  var handProj = new Float32Array(16);
  function drawHandPass(cam) {
    var H3 = NS.Hand3D, P = NS.Player, U = NS.U;
    if (!H3 || !P || !G.backend.drawHand) return;
    if (G.hideHand) return;
    // ⚠ vanilla's own three exclusions: spectator, the GUI hidden, and a third-person camera.
    if (NS.Gamemode && P.mode === NS.Gamemode.SPECTATOR) return;
    if (NS.Settings && NS.Settings.hideGui) return;
    var partial = NS.Main && NS.Main.partial ? NS.Main.partial() : 1;
    var frame = null;
    try { frame = H3.build(P, partial); } catch (e) { G.handError = (e && e.message) || String(e); return; }
    var fire = H3.fireOverlay(P);
    if (!frame && !fire) return;
    var hfov = H3.handFov(P, partial, NS.Settings && NS.Settings.fovEffectScale,
                          !!(P.eyeInWater || P.eyeInLava));
    U.mat4.perspective(handProj, hfov * Math.PI / 180, cam.aspect || 1,
                       cam.near, G.HAND_FAR, !!cam.zeroToOne);
    G.handQuads = 0;
    if (frame) {
      frame.proj = handProj;
      G.backend.drawHand(frame);
      G.handQuads = (frame.quads || 0) + (frame.arm ? frame.arm.quads : 0);
    }
    if (fire) { fire.proj = handProj; G.backend.drawHand(fire); G.handQuads += fire.quads; }   // #7952
  }

  G.render = function (timeSec) {
    if (!G.backend) return;
    G.flushUploads();
    G.syncCamera();

    var cam = G.cam;
    cam.aspect = G.width / G.height;
    cam.zeroToOne = (G.name === 'webgpu');
    var rd = (NS.Settings && NS.Settings.renderDistance) || 8;
    // The far plane sits just past the fog wall, not 64 blocks past it: everything between the
    // two is solid fog colour, so drawing it costs fill rate to produce the clear colour (D-90).
    var fogFar = rd * 16 * G.fogEnd;
    cam.far = Math.max(64, fogFar + 16);
    // ⚠ The frozen-frustum branch (F7) rebuilds viewProj so the picture keeps following the
    // camera while the PLANES stay where they were — that is the point of the debug key. It
    // must build it the same eye-relative way Cam.update does (D-179), with (0,0,0) and not
    // (cam.x, cam.y, cam.z), or the one frame-matrix that skips Cam.update goes back to
    // carrying a 3e7 translation. It deliberately does NOT touch cam.px/py/pz: those hold the
    // eye the frozen planes were extracted at, which is what keeps the frozen frustum frozen.
    cam.bobM = G.viewBobMatrix();
    cam.fovMult = NS.FovMult ? NS.FovMult.lerped(NS.Main && NS.Main.partial ? NS.Main.partial() : 1) : 1;   // getFov(..., true)
    if (!G.frozenFrustum) NS.Cam.update(cam);
    else { NS.U.mat4.perspective(cam.proj, cam.fov * Math.PI / 180, cam.aspect, cam.near, cam.far, !!cam.zeroToOne);
           NS.U.mat4.fpsView(cam.view, 0, 0, 0, cam.yaw, cam.pitch);
           NS.U.mat4.multiply(cam.viewProj, cam.proj, cam.view); }

    listOpaque.length = 0; listCutout.length = 0; listTrans.length = 0;
    G.culled = 0; G.occluded = 0; G.visited = 0;

    var C = NS.Cam, list = G.meshList, i, m, ox, oy, oz;
    var MINY = NS.CFG.WORLD_MIN_Y;

    if (G.occlusion && NS.World && NS.World.chunks) {
      // Flood first, then walk the meshes and keep the ones the flood reached. Walking the
      // meshes (a few hundred to a few thousand) rather than the flood's sections (most of which
      // are air and own no geometry) is what makes this cheaper than the frustum test it replaces.
      var camCx = Math.floor(cam.x) >> 4, camCz = Math.floor(cam.z) >> 4;
      var camSy = (Math.floor(cam.y) - MINY) >> 4;
      G.visited = G.floodVisible(camCx, camCz, camSy, Math.max(1, rd));
      for (i = 0; i < list.length; i++) {
        m = list[i];
        if (!G.floodHas(camCx, camCz, m.cx, m.cz, m.sy)) { G.culled++; G.occluded++; continue; }
        ox = m.cx * 16; oz = m.cz * 16; oy = MINY + m.sy * 16;
        // and THEN the frustum (D-145). The two answer different questions — the flood asks
        // whether anything is in the way, the frustum asks whether it is on screen — and the
        // drawn set is the intersection, so it is never larger than either alone.
        if (!C.aabbVisible(cam, ox, oy, oz, ox + 16, oy + 16, oz + 16)) { G.culled++; continue; }
        m.d = C.distSq(cam, ox + 8, oy + 8, oz + 8);
        m.band = (Math.sqrt(m.d) * BAND) | 0;
        m.batch = m.handle.batch || 0;
        mq = m.handle.modelQuads;
        if (m.quads[0] || (mq && mq[0])) listOpaque.push(m);
        if (m.quads[1] || (mq && mq[1])) listCutout.push(m);
        if (m.quads[2] || (mq && mq[2])) listTrans.push(m);
      }
    } else {
      for (i = 0; i < list.length; i++) {
        m = list[i];
        ox = m.cx * 16; oz = m.cz * 16; oy = MINY + m.sy * 16;
        if (!C.aabbVisible(cam, ox, oy, oz, ox + 16, oy + 16, oz + 16)) { G.culled++; continue; }
        m.d = C.distSq(cam, ox + 8, oy + 8, oz + 8);
        m.band = (Math.sqrt(m.d) * BAND) | 0;
        m.batch = m.handle.batch || 0;
        mq = m.handle.modelQuads;
        if (m.quads[0] || (mq && mq[0])) listOpaque.push(m);
        if (m.quads[1] || (mq && mq[1])) listCutout.push(m);
        if (m.quads[2] || (mq && mq[2])) listTrans.push(m);
      }
    }

    listOpaque.sort(byNear);
    listCutout.sort(byNear);
    listTrans.sort(byFar);

    // ── PLAN G16: the sky's colour, this frame ────────────────────────────────────────────
    // ⚠ THE SKY WAS A HARD-CODED `[0.62, 0.76, 0.98]` UNTIL SESSION 9 (D-300) — one blue, at
    // every hour, in every biome, and it was the clear colour AND the fog colour. So the world
    // never got dark, the fog never took a biome's tint, and neither the time of day nor the
    // weather could be seen at all. The numbers come from `09b_sky.js`, which reads them out of
    // the 1.18.2 bytecode; this only asks for them and hands them to the backend.
    G.updateSky(rd);
    var fs = G.frameState;
    fs.viewProj = cam.viewProj;
    // the shader's camera is the origin of the space the geometry arrives in (D-179)
    fs.camX = 0; fs.camY = 0; fs.camZ = 0;
    fs.eyeX = cam.x; fs.eyeY = cam.y; fs.eyeZ = cam.z;
    fs.fogR = G.fog[0]; fs.fogG = G.fog[1]; fs.fogB = G.fog[2];
    // ⚠ THE CLEAR COLOUR IS THE **FOG**, NOT THE SKY. They are two different colours in vanilla
    // — the fog is the biome's `fog_color` on its own brightness ramp, blended toward the sky by
    // the render distance — and using one for both is why a clone's horizon never looks right.
    fs.skyScale = G.skyDarken;
    fs.ambient = NS.Sky && NS.Sky.ambientFor ? NS.Sky.ambientFor(NS.Sky.effectsNow(), G.SHADE.AMBIENT) : G.SHADE.AMBIENT;   // Nether 0.1
    fs.nightVision = G.nightVision || 0;   // #303: packed into params.z's integer part (floor/255), skyDarkness is the fraction
    fs.skyDarkness = G.skyDarkness || 0;   // GameRenderer.getSkyDarkness (boss bar darkenSky), lightmap tint
    fs.gamma = NS.Settings && NS.Settings.gamma !== undefined ? NS.Settings.gamma : 0.5;   // Brightness slider (#9237); 0.5 = the old look
    // PLAN G16b — the backend's sky pass reads this whole object (D-303).
    fs.skyFrame = G.skyFrame;
    // ...and it projects with THIS, not with fs.viewProj (D-304). The world's far plane is the
    // fog wall and the sun is further away than that at the two lowest presets.
    NS.Cam.skyViewProj(cam, fs.skyViewProj, NS.Sky ? NS.Sky.SKY_NEAR : 0.05,
                       NS.Sky ? NS.Sky.SKY_FAR : 1024);
    // Fog reaches full strength exactly at the render-distance edge, so the frontier is a haze
    // rather than a cliff, and it moves with the preset instead of being a fixed number (D-90).
    fs.fogFar = fogFar;
    fs.fogNear = fogFar * G.fogStart;
    if (G.waterFog) { fs.fogNear = Math.max(0, G.waterFog.start); fs.fogFar = G.waterFog.end; }   // #1892
    if (G.blindFog) { fs.fogNear = G.blindFog.start; fs.fogFar = G.blindFog.end; }               // #303 blindness
    // Wrap the clock so the animated-vertex scroll never loses float precision after an hour.
    // 1000 s x SCROLL (0.08 tiles/s) is exactly 80 tiles, so the wrap is invisible.
    fs.time = (timeSec || 0) % 1000;
    fs.wireframe = G.wireframe;

    G.drawn = 0; G.tris = 0; G.modelTris = 0; G.draws = 0; G.entityTris = 0;
    G.backend.beginFrame(fs);
    buildEntityMesh(cam);

    // ⚠ THE THIRD ARGUMENT IS "COUNT THIS PASS TOWARDS THE PICTURE" (D-194). The depth prepass
    // and the wireframe overlay redraw geometry that is already counted; tallying them made
    // `tris` twice the truth whenever D-53's prepass was on.
    if (G.depthPrepass && listOpaque.length) {
      G.backend.setPass('depth');
      drawList(listOpaque, 0, false);
    }
    G.backend.setPass('opaque');      drawList(listOpaque, 0, true);
    G.backend.setPass('cutout');      drawList(listCutout, 1, true);
    // #1589: DRAGON_DECAL -- the dragon's own skin where the dissolve pass left depth, depth EQUAL
    if (G.entityDecal && G.backend.drawSectionModels) {
      var ed = G.entityDecal;
      G.backend.setPass('decal');
      G.backend.drawSectionModels(ed.handle, ed.ox - cam.x, ed.oy - cam.y, ed.oz - cam.z, 3);
      if (G.backend.endModelPass) G.backend.endModelPass();
      G.backend.setPass('cutout');
    }
    // #5723: BoatEntityRenderer's water_patch (RenderLayer.getWaterMask) -- depth only, before the water is drawn
    if (G.entityMask && G.backend.drawSectionModels) {
      var em = G.entityMask;
      G.backend.setPass('watermask');
      G.backend.drawSectionModels(em.handle, em.ox - cam.x, em.oy - cam.y, em.oz - cam.z, 3);
      if (G.backend.endModelPass) G.backend.endModelPass();
    }
    G.backend.setPass('translucent'); drawList(listTrans, 2, true);
    // #2627: the energy-swirl bucket (entity model stream only), after the translucent pass; no sections, hence the empty list
    if (G.entity && G.entity.handle && G.entity.handle.modelQuads && G.entity.handle.modelQuads[3]) {
      G.backend.setPass('additive'); drawList([], 3, true);
      G.backend.setPass('translucent');   // restore the state the passes below were written against
    }

    // QUEUE 0.2 (Tame.OWED "leashing") -- the rope/knot pass, 07u_leash.js's own self-
    // contained draw call (its own program, its own buffer). ONE call site, right after the
    // translucent pass and before wireframe/hand, the same slot a rope drawn in front of
    // opaque geometry but behind the hand belongs in.
    if (G.backend.releaseVao) G.backend.releaseVao();   // #2571: the passes below set buffers on the bound VAO
    if (NS.Leash && NS.Leash.render) NS.Leash.render(G, cam);
    // loop/particledraw -- 07zx_particle.js's own self-contained draw call, same shape
    // and same call slot as the leash rope just above (its own programs/pipelines, its own
    // buffers; this is the ONE hook line 07zx_particle.js needed outside its own file).
    if (NS.Particle && NS.Particle.render) NS.Particle.render(G, cam);
    // D-655 (G20) -- the falling rain/snow, 09c_weather.js's own draw (WorldRenderer.renderWeather
    // runs after the particles), blended, depth-tested, no depth write.
    if (NS.Clouds && NS.Clouds.render) NS.Clouds.render(G, cam);   // G17-CL1: renderClouds runs before renderWeather
    if (NS.Weather && NS.Weather.render) NS.Weather.render(G, cam);
    // loop/xporbsprite (G21) -- ER.renderOrbs' own self-contained draw call, same shape
// and same call slot as the leash/particle passes just above (its own program/pipeline,
// its own buffers; this is the ONE hook line 07j_entityrender.js needed outside its own
// file for this pass).
    if (NS.EntityRender && NS.EntityRender.renderOrbs) NS.EntityRender.renderOrbs(G, cam);
    if (NS.WorldBorderRender && NS.WorldBorderRender.render) NS.WorldBorderRender.render(G, cam);   // #9238
    if (NS.ChunkBorder && NS.ChunkBorder.on) NS.ChunkBorder.render(G, cam);

    if (G.wireframe) {
      G.backend.setPass('wire');
      drawList(listOpaque, 0, false);
      drawList(listCutout, 1, false);
    }

    // ── PLAN G10d: the first-person hand, drawn LAST and after a depth clear (D-359) ───────
    // ⚠ THE ORDER IS VANILLA'S. `GameRenderer.renderLevel` finishes the world, clears the depth
    // buffer and then calls `renderItemInHand` — so the hand is in front of everything, is not
    // fogged, and is not clipped by the wall you are standing against. Drawing it inside the
    // world passes instead is how a clone ends up with an arm that disappears into a doorway.
    drawHandPass(cam);

    G.backend.endFrame();
    dropEntityMesh();
    // ⚠ WHAT THE CULL LOOP ASKED FOR, NOT WHAT WAS DRAWN — and it is no longer `drawn` (D-194).
    G.drawnListed = listOpaque.length + listCutout.length + listTrans.length;
    if (G.backend.lost) { G.drawn = 0; G.tris = 0; G.modelTris = 0; }
    // Vertex-buffer binds this frame. With the arenas (D-86) this is well under the draw count;
    // it is the number the benchmark watches to know the batching is still working.
    G.binds = G.backend.binds | 0;
  };

  /**
   * PLAN G17c — the entities, as one §8 mesh with no greedy quads in it.
   *
   * ⚠⚠ **IT IS BUILT AND THROWN AWAY EVERY FRAME AND THAT IS DELIBERATE.** Entities move every
   * frame, so a kept mesh would be re-uploaded every frame anyway; the choice is only whether
   * the transform runs on the CPU or as a per-entity uniform. A uniform means one draw call per
   * entity and a second geometry path in BOTH backends. One buffer means one draw call for all
   * of them and not a line of backend code. `createSectionMesh` takes a slot out of the arena
   * that already exists — there is no buffer or VAO created here — so the per-frame cost is one
   * `bufferSubData` of a few kilobytes.
   *
   * ⚠ THE ORIGIN IS THE CAMERA'S BLOCK, NOT THE WORLD'S. Model positions are i16 in 1/256 of a
   * block, which reaches 128 blocks; anchoring at the origin of the world would wrap every
   * entity past that. Anchoring at the camera also means the float `uOrigin` carries the
   * sub-block part exactly, the same argument as D-179 one level down.
   */
  function buildEntityMesh(cam) {
    if (G.entityMask && G.backend && G.backend.destroySectionMesh) G.backend.destroySectionMesh(G.entityMask.handle);
    G.entityMask = null;
    if (G.entityDecal && G.backend && G.backend.destroySectionMesh) G.backend.destroySectionMesh(G.entityDecal.handle);
    G.entityDecal = null;
    G.entity = null;
    // ⚠ D-407: reset the counters on EVERY frame. They used to be written only when ER.build
    // returned a mesh, so a world that went from eleven mobs to none kept reporting eleven drawn
    // and g17cbcheck's "wait until one entity is drawn" passed on the stale value.
    G.entitiesDrawn = 0; G.entitiesClipped = 0;
    var ER = NS.EntityRender, B = G.backend;
    if (!ER || !ER.ready || !B || !B.createSectionMesh || !B.drawSectionModels) return;
    var ox = Math.floor(cam.x), oy = Math.floor(cam.y), oz = Math.floor(cam.z);
    var partial = NS.Main && NS.Main.partial ? NS.Main.partial() : 1;
    var built = ER.build(ox, oy, oz, cam.x, cam.y, cam.z, partial);
    if (!built) return;
    var handle = B.createSectionMesh(built.buf);
    if (!handle) return;
    G.entity = { handle: handle, ox: ox, oy: oy, oz: oz,
                 drawn: built.drawn, clipped: built.clipped, quads: built.quads };
    G.entitiesDrawn = built.drawn;
    G.entitiesClipped = built.clipped;
    if (built.maskBuf) {
      var mh = B.createSectionMesh(built.maskBuf);
      if (mh) G.entityMask = { handle: mh, ox: ox, oy: oy, oz: oz };
    }
    if (built.decalBuf) {
      var dh = B.createSectionMesh(built.decalBuf);
      if (dh) G.entityDecal = { handle: dh, ox: ox, oy: oy, oz: oz };
    }
  }

  function dropEntityMesh() {
    if (G.entityDecal && G.backend && G.backend.destroySectionMesh) G.backend.destroySectionMesh(G.entityDecal.handle);
    G.entityDecal = null;
    if (G.entityMask && G.backend && G.backend.destroySectionMesh) G.backend.destroySectionMesh(G.entityMask.handle);
    G.entityMask = null;
    if (!G.entity || !G.backend || !G.backend.destroySectionMesh) { G.entity = null; return; }
    G.backend.destroySectionMesh(G.entity.handle);
    G.entity = null;
  }

  function drawList(list, layer, tally) {
    var B = G.backend;
    var i, m, t;
    // ⚠ THE ONE SUBTRACTION (D-179). A backend's section origin is `world − eye`, and it is
    // computed HERE, in doubles, because the moment it reaches drawSection it is on its way
    // into a float32 uniform. A section at x = 29,000,000 becomes a number under 200; a float32
    // holds that to a thousandth of a block, and the shader's `uOrigin + lp` is exact again.
    // The backends themselves know nothing about it: they upload the vec4 they are handed.
    var cam = G.cam, eX = cam.x, eY = cam.y, eZ = cam.z;
    var MINY = NS.CFG.WORLD_MIN_Y;
    for (i = 0; i < list.length; i++) {
      m = list[i];
      // ⚠ THE RETURN VALUE IS THE POINT (D-194). A backend returns the triangles it ACTUALLY
      // submitted — 0 for a lost context, a dead handle, an empty layer or a full WebGPU
      // dynamic-offset ring. Counting `m.quads[layer] * 2` instead described the draw list,
      // which is a number that stays healthy through a blank screen: the same shape of mistake
      // as D-170, where the suite read its own screenshots wrong for a whole session.
      t = B.drawSection(m.handle, m.cx * 16 - eX, MINY + m.sy * 16 - eY, m.cz * 16 - eZ, layer) | 0;
      m.drewThisPass = t > 0;
      if (t > 0) { G.draws++; if (tally) { G.tris += t; G.drawn++; } }
    }
    // The MODEL stream, second, in its own pass. Two loops rather than one interleaved loop
    // because the two streams need different programs and different VAOs, and alternating
    // between them per section would swap the pipeline hundreds of times a frame. Sections
    // with no model geometry — which is every one of them in a world of stone — cost a
    // null check and nothing else.
    if (!B.drawSectionModels) return;
    var any = false;
    for (i = 0; i < list.length; i++) {
      m = list[i];
      var h = m.handle;
      if (!h || !h.modelQuads || !h.modelQuads[layer]) continue;
      t = B.drawSectionModels(h, m.cx * 16 - eX, MINY + m.sy * 16 - eY, m.cz * 16 - eZ, layer) | 0;
      if (t > 0) {
        G.draws++;
        // a list entry counts ONCE towards `drawn`, whichever of its two streams reached the GPU
        if (tally) { G.modelTris += t; if (!m.drewThisPass) G.drawn++; }
        any = true;
      }
    }
    // ⚠ THE ENTITIES RIDE THE SAME PROGRAM AND THE SAME PASS as the section model stream, which
    // is the whole reason a falling sand block is lit, fogged and tinted identically to the sand
    // it fell out of. Drawing them in a pass of their own is how the seam appears.
    var ent = G.entity;
    if (ent && ent.handle && ent.handle.modelQuads && ent.handle.modelQuads[layer]) {
      t = B.drawSectionModels(ent.handle, ent.ox - eX, ent.oy - eY, ent.oz - eZ, layer) | 0;
      if (t > 0) { G.draws++; if (tally) { G.modelTris += t; G.entityTris += t; } any = true; }
    }
    if (any && B.endModelPass) B.endModelPass();
  }

  G.stats = function () {
    return {
      backend: G.name, sections: G.meshes.size, pending: G.uploadQueue.length,
      draws: G.draws, tris: G.tris, modelTris: G.modelTris, binds: G.binds,
      entityTris: G.entityTris | 0, entitiesDrawn: G.entitiesDrawn | 0,
      entitiesClipped: G.entitiesClipped | 0,
      drawnListed: G.drawnListed, drawn: G.drawn, removed: G.removed,
      queued: G.uploadQueue.length,
      // ⚠ A CHECK CANNOT SEE A FLAG IT IS NEVER SHOWN (D-194). Both backends used to set a
      // private, permanent `lost` and stop drawing in silence.
      contextLost: !!(G.backend && G.backend.lost),
      contextLosses: G.contextLosses, contextRestores: G.contextRestores,
      culled: G.culled, occluded: G.occluded,
      visited: G.visited, occlusion: G.occlusion,
      // ⚠ SAME RULE, THE FLOOD'S VERSION (D-198). `floodQueue` is how close the last frame came
      // to the queue cap and `floodOverflows` is how many frames went over it and fell back to
      // the frustum. Neither number can be inferred from `visited` alone, and a check that
      // cannot see them cannot fence the cliff at 97% that the high preset was sitting on.
      floodQueue: fl.qcap, floodOverflows: fl.overflows,
      wire: G.wireframe, prepass: G.depthPrepass
    };
  };

  // ---------------------------------------------------------------------------
  // Self test (docs/archive/ARCH.md §8/§9, D-3)
  // ---------------------------------------------------------------------------

  /**
   * A deterministic §8 mesh buffer exercising every field of the vertex format: all six faces,
   * every AO level, several light levels, all three layers, tint and the animated flag.
   * Used by selfTest() and by tools/shadercheck.mjs's headless sanity pass.
   */
  G.testMesh = function () {
    var Mh = NS.Mesher, CFG = NS.CFG, A = NS.Atlas;
    var quads = [[], [], []];

    // opaque: one quad per face, walking AO and light
    for (var face = 0; face < 6; face++) {
      quads[0].push({ face: face, x: face * 2, y: 4, z: 4, tile: A.T.STONE,
                      tint: 0, ao: [face & 3, (face + 1) & 3, (face + 2) & 3, 3],
                      sky: 15 - face, blk: face * 2, uRep: 1, vRep: 1, flag: 0 });
    }
    // opaque, tinted + greedy-merged: a 4x3 grass top
    quads[0].push({ face: 2, x: 0, y: 8, z: 0, tile: A.T.GRASS_TOP, tint: 1,
                    ao: [3, 3, 3, 3], sky: 15, blk: 0, uRep: 4, vRep: 3, flag: 0 });
    // cutout: foliage
    quads[1].push({ face: 4, x: 2, y: 2, z: 9, tile: A.T.OAK_LEAVES, tint: 2,
                    ao: [3, 2, 1, 0], sky: 12, blk: 0, uRep: 2, vRep: 2, flag: 0 });
    // translucent + animated: water
    quads[2].push({ face: 2, x: 6, y: 6, z: 6, tile: A.T.WATER, tint: 3,
                    ao: [3, 3, 3, 3], sky: 15, blk: 0, uRep: 2, vRep: 2, flag: 1 });

    var buf = Mh.allocBuffer(quads[0].length, quads[1].length, quads[2].length);
    if (!buf) return null;
    var hdr = Mh.readHeader(buf);
    var dv = new Uint32Array(buf);

    for (var L = 0; L < 3; L++) {
      var o = hdr.off[L] >> 2;
      for (var q = 0; q < quads[L].length; q++) {
        var Q = quads[L][q];
        var corners = faceCorners(Q.face, Q.uRep, Q.vRep);
        for (var v = 0; v < 4; v++) {
          var c = corners[v];
          dv[o++] = Mh.packData0(Q.x + c[0], Q.y + c[1], Q.z + c[2], Q.face, Q.ao[v], Q.sky, Q.blk, Q.flag);
          dv[o++] = Mh.packData1(Q.tile, Q.uRep, Q.vRep, c[3], Q.tint);
        }
      }
    }
    return buf;
  };

  /**
   * Corner offsets for a unit face, wound counter-clockwise seen from outside, with the
   * corner id that gives (u,v) = (0,0) top-left / (1,1) bottom-right (docs/archive/ARCH.md §8).
   * Returns [[dx,dy,dz,cornerId] x 4].
   */
  function faceCorners(face, w, h) {
    switch (face) {
      case 0: return [[1,h,0,0],[1,h,w,1],[1,0,w,2],[1,0,0,3]];      // +X
      case 1: return [[0,h,w,0],[0,h,0,1],[0,0,0,2],[0,0,w,3]];      // -X
      case 2: return [[0,1,0,0],[0,1,h,3],[w,1,h,2],[w,1,0,1]];      // +Y
      case 3: return [[0,0,h,0],[0,0,0,3],[w,0,0,2],[w,0,h,1]];      // -Y
      case 4: return [[0,h,1,0],[0,0,1,3],[w,0,1,2],[w,h,1,1]];      // +Z
      default:return [[w,h,0,0],[w,0,0,3],[0,0,0,2],[0,h,0,1]];      // -Z
    }
  }
  G.faceCorners = faceCorners;

  /** Camera used by the self test. Fixed, so the comparison is reproducible. */
  G.testCameraState = function (viewProj, zeroToOne) {
    var cam = NS.Cam.create();
    cam.x = 8; cam.y = 14; cam.z = -14;
    cam.yaw = 0.35; cam.pitch = -0.35;
    cam.aspect = 1; cam.fov = 70; cam.near = 0.1; cam.far = 256;
    cam.zeroToOne = !!zeroToOne;
    NS.Cam.update(cam);
    return {
      viewProj: cam.viewProj, skyViewProj: new Float32Array(16),
      // camera-relative, exactly like a real frame (D-179): the shader's camera is the origin,
      // and eye* carries the true world position for the tint origin.
      camX: 0, camY: 0, camZ: 0,
      eyeX: cam.x, eyeY: cam.y, eyeZ: cam.z,
      fogR: 0.62, fogG: 0.76, fogB: 0.98,
      fogNear: 200, fogFar: 256,
      skyScale: 1.0, skyFrame: null, time: 0, wireframe: false
    };
  };

  /**
   * selfTest() -> Promise<{a, b, match, maxDiff, reason}>
   *
   * Renders one known section through the ACTIVE backend, then — if the other backend can also
   * be created — through that one on a scratch canvas, and compares the two 64x64 captures.
   * Small per-channel differences are expected (different rasterisers, different mip selection);
   * anything above TOL means the two shaders have genuinely diverged.
   */
  G.SELF_TEST_SIZE = 64;
  G.SELF_TEST_TOL = 6;

  G.selfTest = function () {
    if (!G.backend) return Promise.resolve({ match: null, reason: 'no backend' });
    var buf = G.testMesh();
    if (!buf) return Promise.resolve({ match: null, reason: 'test mesh empty' });
    var N = G.SELF_TEST_SIZE;

    var runOn = function (backend, canvas, own) {
      var start = own
        ? Promise.resolve(backend.init(canvas, NS.Atlas.canvas))
        : Promise.resolve(true);
      return start.then(function (ok) {
        if (!ok) return null;
        backend.resize(N, N);
        var h = backend.createSectionMesh(buf.slice(0));
        if (!h) return null;
        var state = G.testCameraState(null, backend.name === 'webgpu');
        var cap = backend.capture(0, 0, N, N);
        // The test section sits at world (0, 0, 0), so eye-relative it sits at −eye (D-179).
        var sx = -state.eyeX, sy = -state.eyeY, sz = -state.eyeZ;
        backend.beginFrame(state);
        backend.setPass('opaque');      backend.drawSection(h, sx, sy, sz, 0);
        backend.setPass('cutout');      backend.drawSection(h, sx, sy, sz, 1);
        backend.setPass('translucent'); backend.drawSection(h, sx, sy, sz, 2);
        backend.endFrame();
        return cap.then(function (px) {
          backend.destroySectionMesh(h);
          return { name: backend.name, px: px, hash: hashPixels(px) };
        });
      }, function (e) { return { name: backend.name, error: String(e && e.message || e) }; });
    };

    var other = (G.backend === NS.GfxGPU) ? NS.GfxGL : NS.GfxGPU;
    var scratch = document.createElement('canvas');
    scratch.width = N; scratch.height = N;

    return runOn(G.backend, G.canvas, false).then(function (a) {
      // Restore the live backend's real drawing-buffer size; the test shrank it.
      G.backend.resize(G.width, G.height);
      if (!a || !a.px) return { a: a, match: null, reason: 'active backend capture failed' };
      if (!other) return { a: a, match: null, reason: 'only one backend compiled in' };
      return runOn(other, scratch, true).then(function (b) {
        if (!b || !b.px) return { a: a, b: b, match: null, reason: 'second backend unavailable' };
        var max = 0, diffPx = 0;
        for (var i = 0; i < a.px.length; i += 4) {
          var d = 0;
          for (var c = 0; c < 3; c++) {
            var e = Math.abs(a.px[i + c] - b.px[i + c]);
            if (e > d) d = e;
          }
          if (d > max) max = d;
          if (d > G.SELF_TEST_TOL) diffPx++;
        }
        return {
          a: { name: a.name, hash: a.hash }, b: { name: b.name, hash: b.hash },
          match: diffPx === 0, maxDiff: max, diffPixels: diffPx,
          reason: diffPx === 0 ? 'identical within tolerance'
                               : diffPx + ' of ' + (a.px.length / 4) + ' pixels differ by more than ' + G.SELF_TEST_TOL
        };
      });
    });
  };

  function hashPixels(px) {
    var h = 2166136261;
    for (var i = 0; i < px.length; i++) { h ^= px[i]; h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16);
  }
})(MCL);
