// 11_gfx_webgpu.js — WebGPU backend (primary). Main thread only.
// Implements the Backend interface in docs/archive/ARCH.md §9. The vertex layout is §8 and is shared
// byte-for-byte with the WebGL2 backend (D-23); every shading constant comes from MCL.Gfx.SHADE
// (D-52) so the WGSL below and the GLSL in 12_gfx_webgl2.js cannot drift apart by hand.
//
// Failure policy: this file NEVER throws at the caller. Any problem — no navigator.gpu, no
// adapter, device lost during init, shader compilation error, pipeline validation error —
// resolves false with a human-readable P.failReason, and MCL.Gfx falls back to WebGL2 (D-3).

(function (NS) {
  'use strict';

  var P = NS.GfxGPU = {
    name: 'webgpu',
    canvas: null,
    device: null, ctx: null, format: null, adapterInfo: null,
    failReason: '',
    lost: false,
    losses: 0, restores: 0,   // D-194 — a permanent flag no check can see is not a diagnosis
    atlasCanvas: null,        // kept so a re-acquired device can be rebuilt from the same atlas
    restoring: false,

    pipelines: null,
    frameBuf: null, frameData: null,
    dynBuf: null, dynData: null, dynSlots: 0, dynUsed: 0, dynOverflow: 0,
    bg0: null, bg1: null,
    atlasTex: null, sampler: null,
    // set true the instant this canvas has handed out a 'webgpu' context — after which it can
    // never hand out a 'webgl2' one, whatever happens next (D-310)
    contextTaken: false,
    idxBuf: null, triIndexCount: 0,

    depthTex: null, vw: 1, vh: 1,
    encoder: null, pass: null, passName: '', layerMode: 0, wire: false,
    colorTex: null, pending: null, captureBuf: null,
    meshCount: 0, drawCount: 0
  };

  var DYN_STRIDE = 256;       // minUniformBufferOffsetAlignment is never worse than this
  var FRAME_BYTES = 144;      // mat4 + 4 x vec4, padded (the fourth is W6's tint map)

  // PLAN G16b / KW-24 — the sky pass. Its own tiny dynamic-offset ring, the same shape as
  // `DYN_STRIDE` above but sized for `SkyUniform` (viewProj + model + color + mode + fogCol =
  // 176 bytes) rather than the world's per-section origin.
  var SKY_DYN_STRIDE = 256;
  var SKY_UNIFORM_BYTES = 176;

  // ---------------------------------------------------------------------------
  // WGSL, generated from MCL.Gfx.SHADE
  // ---------------------------------------------------------------------------

  var sel  = function (c, a, b) { return 'select(' + b + ', ' + a + ', ' + c + ')'; };
  var vec3 = function (a, b, c) { return 'vec3<f32>(' + a + ', ' + b + ', ' + c + ')'; };

  P.buildWGSL = function () {
    var Gx = NS.Gfx, S = Gx.SHADE, f = Gx.f;

    // The WGSL half of the tint-map read. GLSL spells this `textureLod(t, vec3(uv, layer), 0)`;
    // the maths around it is shared, in `Gfx.tintMapExpr`, so the two cannot drift.
    var tintSample = function (uv, layer) {
      return 'textureSampleLevel(uTintMap, uTintSamp, ' + uv + ', i32(' + layer + '), 0.0).rgb';
    };

    var src = [
      'struct Frame {',
      '  viewProj : mat4x4<f32>,',
      '  camTime  : vec4<f32>,',   // xyz camera position, w time in seconds
      '  fogCol   : vec4<f32>,',   // rgb fog colour, w fog near distance
      '  params   : vec4<f32>,',   // x fog far, y sky light scale, zw reserved
      '  tint     : vec4<f32>,',   // xy tint-map origin, camera-relative; z 1/texels, w live flag
      '};',
      'struct Draw {',
      // ⚠ CAMERA-RELATIVE, exactly as in the WebGL2 backend (D-179): Gfx.drawList subtracts the
      // eye in doubles before this is filled in, camTime.xyz is (0,0,0), and the WGSL below is
      // byte-for-byte the shader it was before the change. The two backends must stay symmetric
      // here — this one cannot be run on the machine the fix was written on.
      '  origin : vec4<f32>,',     // xyz section origin relative to the camera, w layer mode 0/1/2
      '};',
      '@group(0) @binding(0) var<uniform> uFrame : Frame;',
      '@group(0) @binding(1) var uAtlas : texture_2d_array<f32>;',
      '@group(0) @binding(2) var uSamp : sampler;',
      '@group(0) @binding(3) var uTintMap : texture_2d_array<f32>;',
      '@group(0) @binding(4) var uTintSamp : sampler;',
      '@group(1) @binding(0) var<uniform> uDraw : Draw;',
      '',
      'struct VSOut {',
      '  @builtin(position) pos : vec4<f32>,',
      '  @location(0) uv : vec2<f32>,',
      '  @location(1) @interpolate(flat) layer : i32,',
      '  @location(2) tint : vec3<f32>,',
      '  @location(3) shade : f32,',
      '  @location(4) fog : f32,',
      '  @location(5) cut : f32,',
      '  @location(6) white : f32,',
      '};',
      '',
      '// data.x: x:0-5 y:6-11 z:12-17 face:18-20 ao:21-22 sky:23-26 blk:27-30 flag:31',
      '// data.y: tile:0-11 uRep:12-19 vRep:20-27 corner:28-29 tint:30-31',
      '@vertex',
      'fn vs_main(@location(0) data : vec2<u32>) -> VSOut {',
      '  var o : VSOut;',
      '  let d0 = data.x;',
      '  let d1 = data.y;',
      '  let lp = vec3<f32>(f32(d0 & 63u), f32((d0 >> 6u) & 63u), f32((d0 >> 12u) & 63u));',
      '  let face = (d0 >> 18u) & 7u;',
      '  let ao = f32((d0 >> 21u) & 3u);',
      '  let sky = f32((d0 >> 23u) & 15u);',
      '  let blk = f32((d0 >> 27u) & 15u);',
      '  let anim = f32((d0 >> 31u) & 1u);',
      '  let tile = d1 & 4095u;',
      '  let rep = vec2<f32>(f32((d1 >> 12u) & 255u), f32((d1 >> 20u) & 255u));',
      '  let corner = (d1 >> 28u) & 3u;',
      '  let tint = (d1 >> 30u) & 3u;',
      '  let cuv = vec2<f32>(f32(corner == 1u || corner == 2u), f32(corner >= 2u));',
      '  o.uv = cuv * rep + vec2<f32>(0.0, anim * uFrame.camTime.w * ' + f(S.SCROLL) + ');',
      '  o.layer = i32(tile);',
      '  let wp = uDraw.origin.xyz + lp;',
      '  let lv = max(sky * uFrame.params.y, blk) * (1.0 / 15.0);',
      '  let lightv = ' + f(S.AMBIENT) + ' + ' + f(1 - S.AMBIENT) + ' * (lv / (4.0 - 3.0 * lv));',
      '  let fsh = ' + Gx.faceShadeExpr('face', sel, true) + ';',
      '  let aosh = ' + f(S.AO_BASE) + ' + ao * ' + f(S.AO_STEP) + ';',
      '  o.shade = fsh * aosh * lightv;',
      '  o.cut = 0.0;',
      '  o.white = 0.0;',
      '  o.tint = ' + Gx.tintMapExpr('tint', 'wp', tintSample, sel, true, vec3, 'uFrame.tint', 'f32') + ' * mix(vec3<f32>(1.0), vec3<f32>(0.7, 0.6, 0.6), uFrame.params.z);',  // LightmapTextureManager: lerp(light, light*(0.7,0.6,0.6), GameRenderer.getSkyDarkness) while a darkenSky boss bar is up
      '  let dist = length(wp - uFrame.camTime.xyz);',
      '  o.fog = clamp((dist - uFrame.fogCol.w) / max(1.0, uFrame.params.x - uFrame.fogCol.w), 0.0, 1.0);',
      '  o.pos = uFrame.viewProj * vec4<f32>(wp, 1.0);',
      '  return o;',
      '}',
      '',
      '@fragment',
      'fn fs_main(i : VSOut) -> @location(0) vec4<f32> {',
      '  let t = textureSample(uAtlas, uSamp, i.uv, i.layer);',
      '  let mode = i32(uDraw.origin.w);',
      '  if (mode != 2 && t.a < i.cut) {',   // #7065: translucent pass = vertex alpha is an opacity
      '    discard;',
      '  }',
      '  if (mode == 1 && t.a < ' + f(S.CUTOUT) + ') {',
      '    discard;',
      '  }',
      // ⚠ THE TINT IS NOT WEIGHTED BY ALPHA IN THE OPAQUE PASS (D-159). Weighting it made sense
      // while only genuinely opaque blocks reached mode 0 — a=1 everywhere, so the weight did
      // nothing. `fastLeaves` breaks that: it moves a CUTOUT texture into the opaque pass, where
      // nothing discards, and the leaf texture's holes carry a=0 — so `mix(white, tint, 0)` left
      // every hole UNTINTED and the leaves rendered grey instead of green on every preset below
      // medium. Vanilla's fast leaves are a solid green block, not a grey one.
      '  let mask = ' + sel('mode == 1', 't.a', '1.0') + ';',
      // #2679: OverlayTexture white row -- mix toward white BEFORE the light, like vanilla's overlay
      '  var rgb = mix(t.rgb, ' + vec3('1.0', '1.0', '1.0') + ', i.white) * mix(' + vec3('1.0', '1.0', '1.0') + ', i.tint, mask) * i.shade;',
      '  let fg = pow(i.fog, ' + f(S.FOG_CURVE) + ');',
      '  rgb = mix(rgb, uFrame.fogCol.rgb, fg);',
      // #2627: mode 3 (energy swirl) is blended ONE,ONE at colour 0.5 -- fog fades it to black (agrees with the GL fragment shader, D-52)
      '  if (mode == 3) {',
      '    return vec4<f32>(t.rgb * i.tint * i.shade * 0.5 * (1.0 - fg), 1.0);',
      '  }',
      '  return vec4<f32>(rgb, ' + sel('mode == 2', sel('i.cut > 0.0', 't.a * i.cut', 't.a'), '1.0') + ');',
      '}',
      '',
      '// Position-only stage: the depth prepass (no fragment stage at all) and the debug',
      '// wireframe, which pairs it with fs_flat and a line-list topology.',
      '',
      '// ── the MODEL vertex stream (CFG.MODEL_QUAD_BYTES) ──────────────────────────',
      '// The cube stream packs a vertex into 2 u32 with no bits to spare, so sub-block',
      '// geometry gets its own layout: 4 u32, positions in 1/256 of a block.',
      '//   w0: px:i16 py:i16   w1: pz:i16 tile:u16   w2: u:i16 v:i16',
      '//   w3: face:0-2 ao:3-4 sky:5-8 blk:9-12 tint:13-14 shade:15 flag:16 etint:17-25 anim:26 alpha:27-31',
      '// It shares VSOut and fs_main with the cube path on purpose: a fence and the stone',
      '// beside it must be lit by identical maths or the seam between them is visible, and',
      '// D-52 requires this backend and the GL one to produce the same pixels.',
      'fn s16(v : u32) -> i32 {',
      '  let i = i32(v & 0xFFFFu);',
      '  return select(i, i - 65536, i > 32767);',
      '}',
      '@vertex',
      'fn vs_model(@location(0) m : vec4<u32>) -> VSOut {',
      '  var o : VSOut;',
      '  let lp = vec3<f32>(f32(s16(m.x)), f32(s16(m.x >> 16u)), f32(s16(m.y))) * ' + f(1 / 256) + ';',
      // #2679: w1 bits 28-31 = the white overlay weight in 15ths (CreeperEntityRenderer.method_23154); tile is 12 bits like the cube stream
      '  let tile = (m.y >> 16u) & 0x1FFFu;',
      '  o.white = f32((m.y >> 29u) & 7u) * ' + f(1 / 7) + ';',
      '  let d3 = m.w;',
      // #1263: w3 bit 26 = the fluid scroll, the same one the cube stream's `anim` flag drives
      '  o.uv = vec2<f32>(f32(s16(m.z)), f32(s16(m.z >> 16u))) * ' + f(1 / 256) + ' + vec2<f32>(0.0, f32((d3 >> 26u) & 1u) * uFrame.camTime.w * ' + f(S.SCROLL) + ');',
      // #2627: mode 3 = the energy swirl (NS.CFG.swirlOffset), same maths as the GL vs_model
      '  if (i32(uDraw.origin.w) == 3) {',
      '    let sf = uFrame.camTime.w * 20.0;',
      '    let cr = f32((d3 >> 26u) & 1u);',
      '    o.uv = o.uv + vec2<f32>(select(cos(sf * 0.02) * 3.0, sf * 0.01, cr > 0.5), sf * 0.01 - cr * uFrame.camTime.w * ' + f(S.SCROLL) + ');',
      '  }',
      '  let face = d3 & 7u;',
      '  let ao = f32((d3 >> 3u) & 3u);',
      '  let sky = f32((d3 >> 5u) & 15u);',
      '  let blk = f32((d3 >> 9u) & 15u);',
      '  let tint = (d3 >> 13u) & 3u;',
      '  let shaded = f32((d3 >> 15u) & 1u);',
      // ⚠ D-234's spare bit, finally read: `flag` (w3 bit 16) is the living-entity hurt/death
      // overlay (.decomp `LivingEntityRenderer.getOverlay`+`OverlayTexture`'s ctor, see
      // 07j_entityrender.js's `emitMobLayer` for the exact colour/weight derivation: translucent
      // red at alpha 178/255). Applied as a MULTIPLICATIVE tint (mix toward red) because that is
      // the one blending mode this mesher's `o.tint` already feeds `fs_main`, not a second
      // blend stage -- 0xB20000FF at ~0.7 alpha over a lit texture reads, to within rounding,
      // the same as darkening green/blue by ~0.7 while holding red, which is what this does.
      '  let flag = f32((d3 >> 16u) & 1u);',
      // D-503's OWED, CLOSED: the per-entity RGB tint channel (10_gfx.js's `entityTintExpr`,
      // shared with 12_gfx_webgl2.js's `vs_model` -- D-52). Multiplicative, identity (1,1,1).
      '  let etint = ' + Gx.entityTintExpr('d3', true, vec3, 'f32') + ';',
      '  o.layer = i32(tile);',
      // #1849: entityAlpha dissolve cutoff (10_gfx.js's `entityAlphaExpr`), read by fs_main
      '  o.cut = ' + Gx.entityAlphaExpr('d3', true, 'f32') + ';',
      '  let wp = uDraw.origin.xyz + lp;',
      '  let lv = max(sky * uFrame.params.y, blk) * (1.0 / 15.0);',
      '  let lightv = ' + f(S.AMBIENT) + ' + ' + f(1 - S.AMBIENT) + ' * (lv / (4.0 - 3.0 * lv));',
      '  let fsh = mix(1.0, ' + Gx.faceShadeExpr('face', sel, true) + ', shaded);',
      '  let aosh = ' + f(S.AO_BASE) + ' + ao * ' + f(S.AO_STEP) + ';',
      '  o.shade = fsh * aosh * lightv;',
      '  var mtint = ' + Gx.tintMapExpr('tint', 'wp', tintSample, sel, true, vec3, 'uFrame.tint', 'f32') + ';',
      '  o.tint = mix(mtint, mtint * vec3<f32>(1.0, 0.3, 0.3), flag * ' + f(0.7) + ') * etint * mix(vec3<f32>(1.0), vec3<f32>(0.7, 0.6, 0.6), uFrame.params.z);',
      '  let dist = length(wp - uFrame.camTime.xyz);',
      '  o.fog = clamp((dist - uFrame.fogCol.w) / max(1.0, uFrame.params.x - uFrame.fogCol.w), 0.0, 1.0);',
      '  o.pos = uFrame.viewProj * vec4<f32>(wp, 1.0);',
      '  return o;',
      '}',
      '',
      '@vertex',
      'fn vs_pos(@location(0) data : vec2<u32>) -> @builtin(position) vec4<f32> {',
      '  let d0 = data.x;',
      '  let lp = vec3<f32>(f32(d0 & 63u), f32((d0 >> 6u) & 63u), f32((d0 >> 12u) & 63u));',
      '  return uFrame.viewProj * vec4<f32>(uDraw.origin.xyz + lp, 1.0);',
      '}',
      '',
      '@fragment',
      'fn fs_flat() -> @location(0) vec4<f32> {',
      '  return vec4<f32>(0.15, 1.0, 0.45, 1.0);',
      '}',
      '',
      // ── PLAN G10d: the first-person hand (D-359) ────────────────────────────────────────
      // ⚠ THE WGSL AND THE GLSL ARE ONE SET OF MATHS IN TWO LANGUAGES, and `shadercheck` holds
      // them against each other (D-3, D-52). Vertices arrive already in VIEW space — the pose is
      // applied on the CPU over a few hundred vertices — so the only uniform is the projection,
      // and `layer < 0` means "sample the player skin instead of the block atlas".
      'struct HandOut {',
      '  @builtin(position) pos : vec4<f32>,',
      '  @location(0) uv : vec2<f32>,',
      '  @location(1) @interpolate(flat) layer : f32,',
      '  @location(2) shade : f32,',
      '  @location(3) tint : vec3<f32>,',
      '};',
      'struct HandUniform { proj : mat4x4<f32>, };',
      '@group(2) @binding(0) var<uniform> uHand : HandUniform;',
      '@group(2) @binding(1) var skinTex : texture_2d<f32>;',
      '@group(2) @binding(2) var skinSamp : sampler;',
      '',
      '@vertex',
      'fn vs_hand(@location(0) p : vec3<f32>, @location(1) uv : vec2<f32>,',
      '           @location(2) info : vec2<f32>, @location(3) tint : vec3<f32>) -> HandOut {',
      '  var o : HandOut;',
      '  o.uv = uv;',
      '  o.layer = info.x;',
      '  o.shade = info.y;',
      '  o.tint = tint;',
      '  o.pos = uHand.proj * vec4<f32>(p, 1.0);',
      '  return o;',
      '}',
      '',
      '@fragment',
      'fn fs_hand(i : HandOut) -> @location(0) vec4<f32> {',
      '  var c : vec4<f32>;',
      '  if (i.layer < 0.0) {',
      '    c = textureSample(skinTex, skinSamp, i.uv);',
      '  } else {',
      '    c = textureSample(uAtlas, uSamp, i.uv, i32(i.layer));',
      '  }',
      // ⚠ the same cutout threshold the world uses — a held torch is mostly transparent margin
      '  if (c.a < ' + f(S.CUTOUT) + ') { discard; }',
      '  return vec4<f32>(c.rgb * i.tint * i.shade, 1.0);',
      '}'
    ].join('\n');


  // ---------------------------------------------------------------------------
  // PLAN G16b / KW-24 — the sky pass (D-415's horizon fade), ported from the WebGL2 backend's
  // own VS_SKY/FS_SKY (12_gfx_webgl2.js). Its OWN shader module, the same reason the GL backend
  // gives the sky its own program: everything else this backend draws already carries the
  // world's Frame/Draw uniforms (D-179), and the sky needs a different view-projection (D-304,
  // `state.skyViewProj`) and a rotating model matrix nothing else here uses. Group 0 is entirely
  // the sky's own — it does not touch `uFrame`/`uAtlas` above, so nothing here can collide with
  // the world's bind group 0 (`P.bg0`), which `beginFrame` restores right after the sky returns.
  // ---------------------------------------------------------------------------
  P.buildSkyWGSL = function () {
    return [
      'struct SkyUniform {',
      '  viewProj : mat4x4<f32>,',
      '  model    : mat4x4<f32>,',
      '  color    : vec4<f32>,',
      // x: 0 plain, 1 textured (sun/moon), 2 the sunrise fan (D-657, alpha weighted by uv.x);
      // y: fog this draw (1 = the two discs, 0 = everything else); z fog end; w spare
      '  mode     : vec4<f32>,',
      '  fogCol   : vec4<f32>,',
      '};',
      '@group(0) @binding(0) var<uniform> uSky : SkyUniform;',
      '@group(0) @binding(1) var skyTex : texture_2d<f32>;',
      '@group(0) @binding(2) var skySamp : sampler;',
      '',
      'struct SkyOut {',
      '  @builtin(position) pos : vec4<f32>,',
      '  @location(0) uv : vec2<f32>,',
      '  @location(1) skyPos : vec3<f32>,',
      '};',
      '',
      '@vertex',
      'fn vs_sky(@location(0) pos : vec3<f32>, @location(1) uv : vec2<f32>) -> SkyOut {',
      '  var o : SkyOut;',
      '  let wp = (uSky.model * vec4<f32>(pos, 1.0)).xyz;',
      '  o.uv = uv;',
      '  o.skyPos = wp;',
      '  o.pos = uSky.viewProj * vec4<f32>(wp, 1.0);',
      '  return o;',
      '}',
      '',
      // ⚠ THE SAME FRAGMENT LOGIC AS FS_SKY, GLSL FOR WGSL, LINE FOR LINE (D-52, D-415): the
      // fan's alpha is weighted by uv.x, a textured draw samples `skyTex`, and the horizon fade
      // is `length(skyPos)` against `mode.z` (the sky's own far plane, D-304) mixed toward the
      // fog colour — computed PER FRAGMENT, not per vertex, for the reason 12_gfx_webgl2.js's
      // own header gives: the disc's rim is the one vertex whose interpolation cannot be trusted.
      '@fragment',
      'fn fs_sky(i : SkyOut) -> @location(0) vec4<f32> {',
      '  var c = uSky.color;',
      '  if (uSky.mode.x > 1.5) {',
      '    c.a = c.a * i.uv.x;',
      '  } else if (uSky.mode.x > 0.5) {',
      '    c = c * textureSample(skyTex, skySamp, i.uv);',
      '  }',
      '  if (uSky.mode.y > 0.5) {',
      '    let fg = clamp(length(i.skyPos) / max(1.0, uSky.mode.z), 0.0, 1.0);',
      '    c = vec4<f32>(mix(c.rgb, uSky.fogCol.rgb, fg), c.a);',
      '  }',
      '  return c;',
      '}'
    ].join('\n');
  };

    P.WGSL = src;
    return src;
  };

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  /**
   * How many layers the block atlas will need, read from the atlas itself rather than guessed.
   *
   * ⚠ THE ATLAS IS BUILT BEFORE `Gfx.init` (see `buildResources`, which throws if it is not), so
   * this number is available at the moment the device is requested — which is the only moment a
   * limit can be asked for. Returns 0 when the atlas is not there, and the caller then asks for
   * nothing rather than inventing a figure.
   */
  P.atlasLayersNeeded = function () {
    var A = NS.Atlas;
    return (A && A.tiles) ? (A.tiles | 0) : 0;
  };

  P.init = function (canvas, atlasCanvas) {
    P.failReason = '';
    P.lost = false;
    if (typeof navigator === 'undefined' || !navigator.gpu) {
      P.failReason = 'navigator.gpu is not present';
      return Promise.resolve(false);
    }
    P.canvas = canvas;
    P.atlasCanvas = atlasCanvas || P.atlasCanvas;

    // low-power first: on a laptop with two GPUs we want the one that is already awake, and on
    // the 2200G there is only one anyway. Fall back to the default adapter if that returns null.
    return navigator.gpu.requestAdapter({ powerPreference: 'low-power' }).then(function (a) {
      return a || navigator.gpu.requestAdapter();
    }).then(function (adapter) {
      if (!adapter) { P.failReason = 'no WebGPU adapter (no compatible device, or blocklisted driver)'; return false; }
      P.adapterInfo = adapter.info || null;

      // ⚠⚠ THE DEFAULT `maxTextureArrayLayers` IS **256** AND THE BLOCK ATLAS HAS 778 (D-310).
      // A device requested with no `requiredLimits` gets the SPEC DEFAULTS, not the adapter's
      // capabilities — so `createTexture` for the atlas failed validation on every real GPU this
      // project has ever run on, and the world drew nothing. That is the whole of the
      // "WebGPU is black on real hardware" constraint the CHARTER has carried since 6 Sept.
      // ⚠ IT IS ASKED FOR AGAINST THE ADAPTER'S OWN NUMBER, and refused in words if the adapter
      // genuinely cannot do it — a validation error inside `createTexture` is a stack trace, and
      // "this GPU allows 256 layers and the atlas needs 778" is a sentence.
      var need = P.atlasLayersNeeded();
      var have = (adapter.limits && adapter.limits.maxTextureArrayLayers) || 0;
      P.limitsWanted = { need: need, have: have };
      if (need > 0 && have > 0 && need > have) {
        P.failReason = 'this adapter allows ' + have + ' texture array layers and the block atlas '
                     + 'needs ' + need + ' — WebGPU cannot run here';
        return false;
      }
      var required = {};
      if (need > 0 && have > 0) required.maxTextureArrayLayers = Math.min(have, Math.max(need, 256));
      return adapter.requestDevice({ requiredLimits: required }).then(function (device) {
        if (!device) { P.failReason = 'requestDevice returned nothing'; return false; }
        return setup(device, canvas, atlasCanvas);
      }, function (e) {
        P.failReason = 'requestDevice failed: ' + (e && e.message);
        return false;
      });
    }, function (e) {
      P.failReason = 'requestAdapter failed: ' + (e && e.message);
      return false;
    }).catch(function (e) {
      P.failReason = 'WebGPU init threw: ' + (e && e.message);
      return false;
    });
  };

  function setup(device, canvas, atlasCanvas) {
    P.device = device;
    // ⚠ A LOST DEVICE USED TO BE THE END OF THE SESSION, IN SILENCE (D-194). This resolved, set
    // a private flag, and every entry point below returned early for ever after: the game drew
    // its clear colour and nothing — no counter, no message, and nothing a check could read.
    // A device lost with reason 'destroyed' was asked to go (a backend swap, a page teardown)
    // and must NOT be re-acquired; anything else is the driver, and is worth one attempt.
    device.lost.then(function (info) {
      P.lost = true;
      P.losses++;
      P.failReason = 'device lost: ' + ((info && info.message) || 'unknown');
      if (NS.Gfx) NS.Gfx.contextLosses++;
      if (NS.Hud && NS.Hud.say) NS.Hud.say('GPU device lost — trying to re-acquire');
      if (info && info.reason === 'destroyed') return;
      if (P.restoring) return;
      P.restoring = true;
      Promise.resolve(P.init(P.canvas, P.atlasCanvas)).then(function (ok) {
        P.restoring = false;
        if (!ok) { P.lost = true; return; }
        P.restores++;
        if (NS.Gfx) NS.Gfx.onBackendRestored();
      }, function () { P.restoring = false; P.lost = true; });
    });

    var ctx = null;
    // ⚠ THE MOMENT THE CANVAS IS SPENT (D-310). Asking a canvas for a 'webgpu' context makes it
    // permanently unable to give a 'webgl2' one — even when the request FAILS later, and even on
    // a machine with no WebGPU adapter at all, because `getContext` succeeds regardless. So the
    // fact is published the instant it becomes true, and `Gfx.init`'s fallback reads it to decide
    // whether it needs a replacement element. A flag set earlier (before `requestAdapter`) would
    // be safe but wrong: on the headless box WebGPU bails at "no adapter" without ever touching
    // the canvas, and swapping it there would churn the DOM on every boot for nothing.
    P.contextTaken = false;
    try { ctx = canvas.getContext('webgpu'); P.contextTaken = !!ctx; } catch (e) { ctx = null; }
    if (!ctx) { P.failReason = 'canvas.getContext("webgpu") returned null'; return false; }
    P.ctx = ctx;
    P.format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({
      device: device,
      format: P.format,
      alphaMode: 'opaque',
      // COPY_SRC so Gfx.selfTest can read the frame back and compare it with WebGL2 (D-3).
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
    });

    var code = P.buildWGSL();
    var module;
    device.pushErrorScope('validation');
    try {
      module = device.createShaderModule({ code: code, label: 'mclite-chunk' });
    } catch (e) {
      device.popErrorScope();
      P.failReason = 'createShaderModule threw: ' + (e && e.message);
      return false;
    }

    var infoP = (module.getCompilationInfo)
      ? module.getCompilationInfo()
      : Promise.resolve({ messages: [] });

    return infoP.then(function (info) {
      var errs = [];
      var msgs = (info && info.messages) || [];
      for (var i = 0; i < msgs.length; i++) {
        if (msgs[i].type === 'error') {
          errs.push('line ' + msgs[i].lineNum + ':' + msgs[i].linePos + ' ' + msgs[i].message);
        }
      }
      if (errs.length) {
        device.popErrorScope();
        P.failReason = 'WGSL compile error:\n  ' + errs.join('\n  ');
        return false;
      }
      try {
        buildResources(device, module, atlasCanvas);
      } catch (e) {
        device.popErrorScope();
        P.failReason = 'WebGPU resource setup failed: ' + (e && e.message);
        return false;
      }
      return device.popErrorScope().then(function (err) {
        if (err) { P.failReason = 'WebGPU validation error: ' + err.message; return false; }
        P.vw = Math.max(1, canvas.width | 0);
        P.vh = Math.max(1, canvas.height | 0);
        P.resize(P.vw, P.vh);
        return true;
      });
    });
  }

  function buildResources(device, module, atlasCanvas) {
    // --- uniforms -----------------------------------------------------------
    P.frameData = new Float32Array(FRAME_BYTES / 4);
    P.frameBuf = device.createBuffer({
      size: FRAME_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label: 'frame'
    });
    allocDyn(device, 1024);

    // --- atlas: 2D texture array, one tile per layer, CPU mip chain (D-50) ---
    var A = NS.Atlas;
    if (!A || !A.mips) throw new Error('atlas not built before Gfx.init');
    P.atlasTex = device.createTexture({
      size: [A.TILE, A.TILE, A.tiles],
      mipLevelCount: A.mips.length,
      format: 'rgba8unorm',
      dimension: '2d',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      label: 'atlas'
    });
    for (var l = 0; l < A.mips.length; l++) {
      var m = A.mips[l];
      // queue.writeTexture has no 256-byte bytesPerRow rule (that is copyBufferToTexture), so a
      // 16px tile uploads as 64 bytes per row with no padding gymnastics.
      device.queue.writeTexture(
        { texture: P.atlasTex, mipLevel: l },
        m.data,
        { offset: 0, bytesPerRow: m.size * 4, rowsPerImage: m.size },
        [m.size, m.size, A.tiles]
      );
    }
    P.samplerMip = device.createSampler({
      magFilter: 'nearest',
      minFilter: 'nearest',
      mipmapFilter: 'linear',       // == WebGL2's NEAREST_MIPMAP_LINEAR
      addressModeU: 'repeat',
      addressModeV: 'repeat'
    });
    P.samplerFlat = device.createSampler({
      magFilter: 'nearest',
      minFilter: 'nearest',
      mipmapFilter: 'nearest',      // == WebGL2's plain NEAREST (mip level 0 only, see setQuality)
      addressModeU: 'repeat',
      addressModeV: 'repeat',
      lodMaxClamp: 0
    });
    P.mipmaps = true;
    P.sampler = P.samplerMip;
    void atlasCanvas;

    // --- shared index buffer (D-25): triangles then wireframe lines ---------
    var MQ = NS.CFG.MAX_QUADS;
    var tri = MQ * 6, lin = MQ * 8;
    var idx = new Uint16Array(tri + lin);
    var i, b, o;
    for (i = 0, o = 0; i < MQ; i++) {
      b = i * 4;
      idx[o++] = b; idx[o++] = b + 1; idx[o++] = b + 2;
      idx[o++] = b; idx[o++] = b + 2; idx[o++] = b + 3;
    }
    for (i = 0, o = tri; i < MQ; i++) {
      b = i * 4;
      idx[o++] = b;     idx[o++] = b + 1;
      idx[o++] = b + 1; idx[o++] = b + 2;
      idx[o++] = b + 2; idx[o++] = b + 3;
      idx[o++] = b + 3; idx[o++] = b;
    }
    P.triIndexCount = tri;
    P.idxBuf = device.createBuffer({
      size: idx.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST, label: 'index'
    });
    device.queue.writeBuffer(P.idxBuf, 0, idx.buffer, 0, idx.byteLength);

    // --- bind groups --------------------------------------------------------
    var bgl0 = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        // ⚠ VERTEX visibility, not fragment: the tint is resolved per vertex in both backends
        { binding: 3, visibility: GPUShaderStage.VERTEX, texture: { sampleType: 'float', viewDimension: '2d-array' } },
        { binding: 4, visibility: GPUShaderStage.VERTEX, sampler: { type: 'filtering' } }
      ]
    });
    var bgl1 = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 16 } }
      ]
    });
    P.bgl0 = bgl0; P.bgl1 = bgl1;
    createTintTexture(device);
    P.bg0 = device.createBindGroup({
      layout: bgl0,
      entries: [
        { binding: 0, resource: { buffer: P.frameBuf } },
        { binding: 1, resource: P.atlasTex.createView({ dimension: '2d-array' }) },
        { binding: 2, resource: P.sampler },
        { binding: 3, resource: P.tintTex.createView({ dimension: '2d-array' }) },
        { binding: 4, resource: P.tintSampler }
      ]
    });
    rebuildDynBindGroup(device);
    initArenas();

    // --- pipelines ----------------------------------------------------------
    var layout = device.createPipelineLayout({ bindGroupLayouts: [bgl0, bgl1] });
    var vertex = {
      module: module, entryPoint: 'vs_main',
      buffers: [{
        arrayStride: NS.CFG.VERTEX_BYTES,
        stepMode: 'vertex',
        attributes: [{ shaderLocation: 0, offset: 0, format: 'uint32x2' }]
      }]
    };
    var vertexPos = {
      module: module, entryPoint: 'vs_pos',
      buffers: vertex.buffers
    };
    var depth = function (write, compare) {
      return { format: 'depth24plus', depthWriteEnabled: write, depthCompare: compare };
    };
    var target = function (blend) {
      return blend
        ? { format: P.format, blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } }
        : { format: P.format };
    };

    var vertexModel = {
      module: module, entryPoint: 'vs_model',
      buffers: [{
        arrayStride: NS.CFG.MODEL_VERTEX_BYTES,
        stepMode: 'vertex',
        attributes: [{ shaderLocation: 0, offset: 0, format: 'uint32x4' }]
      }]
    };

    P.pipelines = {
      // depthCompare 'less-equal' on the shaded passes so the same pipeline is correct with and
      // without the depth prepass in front of it (D-53).
      opaque: device.createRenderPipeline({
        layout: layout, vertex: vertex,
        fragment: { module: module, entryPoint: 'fs_main', targets: [target(false)] },
        primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
        depthStencil: depth(true, 'less-equal'), label: 'opaque'
      }),
      cutout: device.createRenderPipeline({
        layout: layout, vertex: vertex,
        fragment: { module: module, entryPoint: 'fs_main', targets: [target(false)] },
        primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
        depthStencil: depth(true, 'less-equal'), label: 'cutout'
      }),
      translucent: device.createRenderPipeline({
        layout: layout, vertex: vertex,
        fragment: { module: module, entryPoint: 'fs_main', targets: [target(true)] },
        primitive: { topology: 'triangle-list', cullMode: 'none', frontFace: 'ccw' },
        depthStencil: depth(false, 'less-equal'), label: 'translucent'
      }),
      // No fragment stage at all: this is the cheapest possible depth prepass.
      depth: device.createRenderPipeline({
        layout: layout, vertex: vertexPos,
        primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
        depthStencil: depth(true, 'less'), label: 'depth-prepass'
      }),
      wire: device.createRenderPipeline({
        layout: layout, vertex: vertexPos,
        fragment: { module: module, entryPoint: 'fs_flat', targets: [target(false)] },
        primitive: { topology: 'line-list', cullMode: 'none' },
        depthStencil: depth(false, 'less-equal'), label: 'wireframe'
      }),
      // The model stream. Same fragment stage, same depth and blend state as the cube
      // pipelines it sits beside — only the vertex layout differs, which is the whole
      // reason it needed its own pipeline at all.
      modelOpaque: device.createRenderPipeline({
        layout: layout, vertex: vertexModel,
        fragment: { module: module, entryPoint: 'fs_main', targets: [target(false)] },
        primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
        depthStencil: depth(true, 'less-equal'), label: 'model-opaque'
      }),
      modelCutout: device.createRenderPipeline({
        layout: layout, vertex: vertexModel,
        fragment: { module: module, entryPoint: 'fs_main', targets: [target(false)] },
        primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
        depthStencil: depth(true, 'less-equal'), label: 'model-cutout'
      }),
      modelTranslucent: device.createRenderPipeline({
        layout: layout, vertex: vertexModel,
        fragment: { module: module, entryPoint: 'fs_main', targets: [target(true)] },
        primitive: { topology: 'triangle-list', cullMode: 'none', frontFace: 'ccw' },
        depthStencil: depth(false, 'less-equal'), label: 'model-translucent'
      }),
      // #2627: vanilla's getEnergySwirl -- ONE,ONE, no depth write, no cull, fragment mode 3
      modelAdditive: device.createRenderPipeline({
        layout: layout, vertex: vertexModel,
        fragment: { module: module, entryPoint: 'fs_main', targets: [{ format: P.format, blend: {
          color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } } }] },
        primitive: { topology: 'triangle-list', cullMode: 'none', frontFace: 'ccw' },
        depthStencil: depth(false, 'less-equal'), label: 'model-additive'
      }),
      // #5723: vanilla getWaterMask -- depth write, colour write mask 0
      modelWaterMask: device.createRenderPipeline({
        layout: layout, vertex: vertexModel,
        fragment: { module: module, entryPoint: 'fs_main', targets: [{ format: P.format, writeMask: 0 }] },
        primitive: { topology: 'triangle-list', cullMode: 'none', frontFace: 'ccw' },
        depthStencil: depth(true, 'less-equal'), label: 'model-watermask'
      }),
      // #1850: vanilla's DRAGON_DECAL -- the SAME entity geometry drawn again with depth EQUAL and
      // no depth write, so it only lands on pixels the first draw wrote. Cutout fragment mode.
      modelDecal: device.createRenderPipeline({
        layout: layout, vertex: vertexModel,
        fragment: { module: module, entryPoint: 'fs_main', targets: [target(false)] },
        primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
        depthStencil: depth(false, 'equal'), label: 'model-decal'
      })
    };

    // ── PLAN G10d: the first-person hand (D-359) ────────────────────────────────────────────
    // ⚠⚠ **THIS PATH CANNOT BE RUN ON THE MACHINE IT WAS WRITTEN ON.** Headless Chromium here
    // has `navigator.gpu` and NO ADAPTER (D-310's own finding), so every line below is asserted
    // structurally — `shadercheck` holds `vs_hand`/`fs_hand` against the GLSL pair the WebGL2
    // backend ships — and nothing here has executed. It is therefore built inside its own
    // try/catch and every use is guarded: **a hand that fails to draw must not take the world
    // down with it**, which is exactly the failure D-310 described from the other direction.
    // The named gap is in `docs/archive/NEXT.md`; it is not a silence.
    try {
      var handBgl = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform', minBindingSize: 64 } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }
        ]
      });
      P.handBgl = handBgl;
      var handLayout = device.createPipelineLayout({ bindGroupLayouts: [bgl0, bgl1, handBgl] });
      // ⚠ THE SAME 40-BYTE VERTEX THE GL BACKEND USES: pos(3) uv(2) info(2) tint(3), all f32.
      var vertexHand = {
        module: module, entryPoint: 'vs_hand',
        buffers: [{
          arrayStride: 40, stepMode: 'vertex',
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x2' },
            { shaderLocation: 2, offset: 20, format: 'float32x2' },
            { shaderLocation: 3, offset: 28, format: 'float32x3' }
          ]
        }]
      };
      P.pipelines.hand = device.createRenderPipeline({
        layout: handLayout, vertex: vertexHand,
        fragment: { module: module, entryPoint: 'fs_hand', targets: [target(false)] },
        // ⚠ CULLING OFF, for the same reason the GL backend turns it off: a sprite item is a
        // one-pixel extrusion and a mirrored pose is entirely backfaces.
        primitive: { topology: 'triangle-list', cullMode: 'none', frontFace: 'ccw' },
        depthStencil: depth(true, 'less-equal'), label: 'hand'
      });
      P.handUniform = device.createBuffer({
        size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label: 'hand-proj'
      });
      P.handSkin = skinTexture(device);
      P.handSampler = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });
      if (P.handSkin) {
        P.handBg = device.createBindGroup({
          layout: handBgl,
          entries: [
            { binding: 0, resource: { buffer: P.handUniform } },
            { binding: 1, resource: P.handSkin.createView() },
            { binding: 2, resource: P.handSampler }
          ]
        });
      }
    } catch (e) {
      P.handFailReason = (e && e.message) || String(e);
      P.pipelines.hand = null;
    }

    // ── PLAN G16b / KW-24: the sky pass ───────────────────────────────────────────────────
    // Guarded the same way the hand is, just above: a problem building the sky must not take
    // the rest of the backend down with it (D-310). Unlike the hand, `NS.Sky` genuinely is
    // absent in some harnesses (tools/shadercheck.mjs's smoke test loads no sky module at
    // all) — `initSkyGPU` already treats that as "nothing to draw", not a failure.
    try {
      buildSkyPipeline(device);
      initSkyGPU(device);
    } catch (e) {
      P.skyFailReason = (e && e.message) || String(e);
      P.sky = null;
    }

    // #1851 — the colour-ray layer, guarded like the sky: a failure here loses the rays only.
    try { buildRayPipeline(device); }
    catch (e) { P.rayFailReason = (e && e.message) || String(e); P.pipelines.ray = null; }
  }

  /**
   * PLAN G16b / KW-24 — the sky's own pipelines. Two variants of the same shader (D-303's
   * "no depth writes, runs first"): `skyAlpha` for the two discs and the sunrise fan (blended
   * the way the WebGL2 backend's `gl.blendFunc(SRC_ALPHA, ONE_MINUS_SRC_ALPHA)` is), `skyAdd`
   * for the stars, sun and moon (its `SRC_ALPHA, ONE`) — WebGPU bakes blend mode into the
   * pipeline, where GL just calls `blendFunc` again between draws on one program.
   *
   * ⚠ DEPTH: WRITES OFF, COMPARE ALWAYS. The sky is the very first thing drawn each frame
   * (D-303) onto a depth buffer just cleared to 1.0, so there is nothing yet for it to lose a
   * depth test against; `always` says that plainly instead of leaning on a comparison that
   * would only ever have one possible outcome here.
   */
  function buildSkyPipeline(device) {
    var code = P.buildSkyWGSL();
    var module = device.createShaderModule({ code: code, label: 'mclite-sky' });
    P.skyModule = module;

    var skyBgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: SKY_UNIFORM_BYTES } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }
      ]
    });
    P.skyBgl = skyBgl;
    var layout = device.createPipelineLayout({ bindGroupLayouts: [skyBgl] });

    // one buffer, pos(3) then uv(2) — the disc, the dark disc and the stars carry zero uv,
    // exactly like the GL backend's `skyAttribs` disabling `aUV` and leaving it at (0, 0)
    var vertex = {
      module: module, entryPoint: 'vs_sky',
      buffers: [{
        arrayStride: 20, stepMode: 'vertex',
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },
          { shaderLocation: 1, offset: 12, format: 'float32x2' }
        ]
      }]
    };
    var depthAlways = { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' };
    var alphaTarget = { format: P.format, blend: {
      color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' } } };
    var addTarget = { format: P.format, blend: {
      color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
      alpha: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' } } };

    P.pipelines.skyAlpha = device.createRenderPipeline({
      layout: layout, vertex: vertex,
      fragment: { module: module, entryPoint: 'fs_sky', targets: [alphaTarget] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: depthAlways, label: 'sky-alpha'
    });
    P.pipelines.skyAdd = device.createRenderPipeline({
      layout: layout, vertex: vertex,
      fragment: { module: module, entryPoint: 'fs_sky', targets: [addTarget] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: depthAlways, label: 'sky-additive'
    });

    // a tiny dynamic-offset ring of its own (D-86's pattern, sized for six draws a frame: the
    // disc, the sunrise fan, the stars, the sun, the moon, the dark disc)
    P.skyDynSlots = 8;
    P.skyDynData = new Float32Array(P.skyDynSlots * SKY_DYN_STRIDE / 4);
    P.skyDynBuf = device.createBuffer({
      size: P.skyDynSlots * SKY_DYN_STRIDE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label: 'sky-dyn'
    });
    P.skySampler = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });
  }

  /**
   * #1851 — the colour-ray layer (vanilla RenderLayer.getLightning), the same maths as
   * 12_gfx_webgl2.js's VS_RAY/FS_RAY: untextured, vertex colour straight through. Reads the
   * world's `viewProj` from the front of `P.frameBuf`.
   */
  P.buildRayWGSL = function () {
    return [
      'struct RayFrame { viewProj : mat4x4<f32> };',
      '@group(0) @binding(0) var<uniform> uRay : RayFrame;',
      'struct RayOut {',
      '  @builtin(position) pos : vec4<f32>,',
      '  @location(0) color : vec4<f32>,',
      '};',
      '@vertex',
      'fn vs_ray(@location(0) pos : vec3<f32>, @location(1) color : vec4<f32>) -> RayOut {',
      '  var o : RayOut;',
      '  o.color = color;',
      '  o.pos = uRay.viewProj * vec4<f32>(pos, 1.0);',
      '  return o;',
      '}',
      '@fragment',
      'fn fs_ray(i : RayOut) -> @location(0) vec4<f32> {',
      '  return i.color;',
      '}'
    ].join('\n');
  };

  /** LIGHTNING_TRANSPARENCY: SRC_ALPHA, ONE — named so tools/raylayercheck.mjs can read it. */
  P.RAY_BLEND = {
    color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
    alpha: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' }
  };

  function buildRayPipeline(device) {
    var module = device.createShaderModule({ code: P.buildRayWGSL(), label: 'mclite-ray' });
    P.rayBgl = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform', minBindingSize: 64 } }]
    });
    P.rayBg = device.createBindGroup({
      layout: P.rayBgl, entries: [{ binding: 0, resource: { buffer: P.frameBuf, offset: 0, size: 64 } }]
    });
    P.pipelines.ray = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [P.rayBgl] }),
      vertex: { module: module, entryPoint: 'vs_ray', buffers: [{
        arrayStride: 28, stepMode: 'vertex',
        attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' },
                     { shaderLocation: 1, offset: 12, format: 'float32x4' }] }] },
      fragment: { module: module, entryPoint: 'fs_ray', targets: [{ format: P.format, blend: P.RAY_BLEND }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
      label: 'colour-ray'
    });
  }

  /** Same contract as `GfxGL.drawColourRays`: `count` triangles, G.RAY_FLOATS floats per vertex. */
  P.drawColourRays = function (verts, count) {
    if (!P.pass || P.lost || !P.pipelines.ray || !count) return 0;
    var bytes = count * 3 * 28;
    if (!P.rayVB || P.rayVB.size < bytes) {
      if (P.rayVB) P.rayVB.destroy();
      P.rayVB = P.device.createBuffer({ size: Math.max(bytes, 4096),
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, label: 'colour-ray-vb' });
    }
    P.device.queue.writeBuffer(P.rayVB, 0, verts.buffer, verts.byteOffset, bytes);
    P.pass.setPipeline(P.pipelines.ray);
    P.pass.setBindGroup(0, P.rayBg);
    P.pass.setVertexBuffer(0, P.rayVB);
    P.pass.draw(count * 3);
    // put the world's state back, as drawSky's caller does
    P.pass.setBindGroup(0, P.bg0);
    P.passName = ''; P.curBuf = null;
    return count;
  };

  /** `Gui.sheets[name]`, as a plain 2D texture — the sun and the moon, same shape as `skinTexture`. */
  function skySheetTexture(device, name) {
    var G = NS.Gui;
    var sh = G && G.sheets && G.sheets[name];
    if (!sh || !sh.canvas || typeof sh.w !== 'number' || typeof sh.h !== 'number') return null;
    var tex = device.createTexture({
      size: [sh.w, sh.h, 1], format: 'rgba8unorm', label: 'sky-' + name,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
    });
    try {
      device.queue.copyExternalImageToTexture({ source: sh.canvas }, { texture: tex }, [sh.w, sh.h, 1]);
    } catch (e) { /* the sky draws untextured rather than not at all, same reasoning as skinTexture */ }
    return tex;
  }

  /** `pos` (3 floats/vertex) and an optional `uv` (2 floats/vertex, zero-filled when absent). */
  function skyInterleave(pos, uv) {
    var n = pos.length / 3;
    var out = new Float32Array(n * 5);
    for (var i = 0; i < n; i++) {
      out[i * 5] = pos[i * 3]; out[i * 5 + 1] = pos[i * 3 + 1]; out[i * 5 + 2] = pos[i * 3 + 2];
      if (uv) { out[i * 5 + 3] = uv[i * 2]; out[i * 5 + 4] = uv[i * 2 + 1]; }
    }
    return out;
  }

  function skyBufferGPU(device, data, label) {
    var buf = device.createBuffer({
      size: Math.max(20, data.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, label: label
    });
    device.queue.writeBuffer(buf, 0, data.buffer, data.byteOffset, data.byteLength);
    return buf;
  }

  /**
   * The sky's geometry (12_gfx_webgl2.js's `initSky`, one for one): the disc and dark-disc RING
   * meshes (D-415 — `Sky.buildSkyDiscMesh`'s own header explains why not the nine-vertex fan),
   * the star field, the sun and moon quads, and a small dynamic buffer for the sunrise fan
   * (D-657), which changes every frame it is visible.
   */
  function initSkyGPU(device) {
    var Sky = NS.Sky;
    if (!Sky || !Sky.buildSkyDisc) { P.sky = null; return; }
    var stars = Sky.buildStars();
    if (!stars) { P.sky = null; return; }

    var discMesh = Sky.buildSkyDiscMesh(Sky.SKY_DISC_Y);
    var darkMesh = Sky.buildSkyDiscMesh(Sky.DARK_DISC_Y);
    var UV = [0, 0, 1, 0, 1, 1, 0, 1];
    var sunPos = Sky.celestialQuad(Sky.SUN_SIZE, Sky.CELESTIAL_DIST);
    var moonPos = Sky.celestialQuad(Sky.MOON_SIZE, -Sky.CELESTIAL_DIST);

    var S = P.sky = {
      disc: skyBufferGPU(device, skyInterleave(discMesh, null), 'sky-disc'),
      discVerts: discMesh.length / 3,
      dark: skyBufferGPU(device, skyInterleave(darkMesh, null), 'sky-dark'),
      darkVerts: darkMesh.length / 3,
      stars: skyBufferGPU(device, skyInterleave(stars, null), 'sky-stars'),
      starQuads: stars.length / 12,
      sun: skyBufferGPU(device, skyInterleave(sunPos, UV), 'sky-sun'),
      moon: skyBufferGPU(device, skyInterleave(moonPos, UV), 'sky-moon'),
      moonPosRaw: moonPos,
      lastPhase: -1,
      // 48 verts (16 triangles) x 20 bytes — `Sky.sunriseFan`'s own fixed size (D-657)
      fanBuf: device.createBuffer({
        size: 48 * 20, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, label: 'sky-fan'
      }),
      sunTex: skySheetTexture(device, 'sun'),
      moonTex: skySheetTexture(device, 'moon_phases'),
      model: new Float32Array(16),
      identity: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
    };

    // one bind group per texture the sky ever samples; everything untextured (the discs, the
    // fan, the stars) is drawn through whichever of the two happens to exist — `uSky.mode.x`
    // is what decides whether the fragment shader ever reads `skyTex` at all.
    if (S.sunTex) {
      S.sunBg = device.createBindGroup({
        layout: P.skyBgl,
        entries: [
          { binding: 0, resource: { buffer: P.skyDynBuf, offset: 0, size: SKY_UNIFORM_BYTES } },
          { binding: 1, resource: S.sunTex.createView() },
          { binding: 2, resource: P.skySampler }
        ]
      });
    }
    if (S.moonTex) {
      S.moonBg = device.createBindGroup({
        layout: P.skyBgl,
        entries: [
          { binding: 0, resource: { buffer: P.skyDynBuf, offset: 0, size: SKY_UNIFORM_BYTES } },
          { binding: 1, resource: S.moonTex.createView() },
          { binding: 2, resource: P.skySampler }
        ]
      });
    }
    if (!S.sunBg && !S.moonBg) { P.sky = null; }
  }

  /**
   * The player skin, as a 2D texture, for the empty hand's arm.
   * ⚠ IT IS THE SAME SHEET THE GL BACKEND UPLOADS (`Gui.sheets.steve`) — two backends drawing
   * the arm from two different images is the D-314 shape waiting to happen.
   */
  function skinTexture(device) {
    var G = NS.Gui;
    var sh = G && G.sheets && G.sheets.steve;
    if (!sh || !sh.canvas || typeof createImageBitmap === 'undefined') return null;
    var tex = device.createTexture({
      size: [sh.w, sh.h, 1], format: 'rgba8unorm', label: 'skin',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
    });
    try {
      device.queue.copyExternalImageToTexture({ source: sh.canvas }, { texture: tex }, [sh.w, sh.h, 1]);
    } catch (e) { /* a canvas the device will not take: the arm draws untextured rather than not at all */ }
    return tex;
  }

  function allocDyn(device, slots) {
    if (P.dynBuf) P.dynBuf.destroy();
    P.dynSlots = slots;
    P.dynData = new Float32Array(slots * DYN_STRIDE / 4);
    P.dynBuf = device.createBuffer({
      size: slots * DYN_STRIDE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'draw-uniforms'
    });
  }

  function rebuildDynBindGroup(device) {
    P.bg1 = device.createBindGroup({
      layout: P.bgl1,
      entries: [{ binding: 0, resource: { buffer: P.dynBuf, offset: 0, size: 16 } }]
    });
  }

  // ---------------------------------------------------------------------------
  // Meshes
  // ---------------------------------------------------------------------------

  /**
   * Vertex arenas (ARCH 9.2, D-86). Identical placement to the WebGL2 backend because both use
   * MCL.Gfx.Arenas — a section lands at the same quad offset in both, which is what keeps D-3's
   * "render identically" true for a change this deep in the buffer layout.
   */
  function initArenas() {
    P.arenas = new NS.Gfx.Arenas(function (quadCap) {
      if (!P.device || P.lost) return null;
      return {
        buf: P.device.createBuffer({
          size: quadCap * NS.CFG.QUAD_BYTES,
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
          label: 'arena'
        }),
        quadCap: quadCap
      };
    }, function (a) {
      if (a.buf) { a.buf.destroy(); a.buf = null; }
    });
  }

  /** The model stream's own arena pool: stride 64 a quad instead of 32. */
  function initModelArenas() {
    P.modelArenas = new NS.Gfx.Arenas(function (quadCap) {
      if (!P.device || P.lost) return null;
      return {
        buf: P.device.createBuffer({
          size: quadCap * NS.CFG.MODEL_QUAD_BYTES,
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
          label: 'model-arena'
        }),
        quadCap: quadCap
      };
    }, function (a) {
      if (a.buf) { a.buf.destroy(); a.buf = null; }
    });
  }

  P.createSectionMesh = function (buf) {
    if (!P.device || P.lost) return null;
    var hdr = NS.Mesher.readHeader(buf);
    if (!hdr) return null;
    var q = hdr.quads;
    var total = q[0] + q[1] + q[2];
    // ⚠ model-only sections are real; see the note in 12_gfx_webgl2.js (D-130).
    var mqTotal = hdr.modelQuads ? (hdr.modelQuads[0] + hdr.modelQuads[1] + hdr.modelQuads[2] + hdr.modelQuads[3]) : 0;
    if (total <= 0 && mqTotal <= 0) return null;
    if (total > NS.CFG.MAX_QUADS) {
      if (typeof console !== 'undefined') console.warn('MC-Lite: section mesh has ' + total +
        ' quads, over MAX_QUADS; the tail is dropped. The mesher should have split it.');
      var room = NS.CFG.MAX_QUADS;
      q = [Math.min(q[0], room), 0, 0];
      room -= q[0];
      q[1] = Math.min(hdr.quads[1], room); room -= q[1];
      q[2] = Math.min(hdr.quads[2], room);
      total = q[0] + q[1] + q[2];
    }

    var rec = total > 0 ? P.arenas.alloc(total) : null;
    if (total > 0 && !rec) return null;
    var H = NS.CFG.MESH_HEADER_BYTES;
    var bytes = total * NS.CFG.QUAD_BYTES;
    var base = rec ? rec.quadOfs : 0;
    if (rec) P.device.queue.writeBuffer(rec.arena.buf, base * NS.CFG.QUAD_BYTES, buf, H, bytes);
    // ---- the model stream ------------------------------------------------------------
    var mq = hdr.modelQuads || [0, 0, 0, 0];
    var mTotal = mq[0] + mq[1] + mq[2] + mq[3];
    var mRec = null, mFirst = null;
    if (mTotal > 0) {
      if (!P.modelArenas) initModelArenas();
      if (mTotal > NS.CFG.MAX_QUADS) {
        if (typeof console !== 'undefined') console.warn('MC-Lite: section has ' + mTotal +
          ' model quads, over MAX_QUADS; the tail is dropped.');
        mq = [Math.min(mq[0], NS.CFG.MAX_QUADS), 0, 0, 0];
        mTotal = mq[0];
      }
      mRec = P.modelArenas.alloc(mTotal);
      if (mRec) {
        P.device.queue.writeBuffer(mRec.arena.buf, mRec.quadOfs * NS.CFG.MODEL_QUAD_BYTES,
                                   buf, hdr.modelOff[0], mTotal * NS.CFG.MODEL_QUAD_BYTES);
        mFirst = [mRec.quadOfs, mRec.quadOfs + mq[0], mRec.quadOfs + mq[0] + mq[1], mRec.quadOfs + mq[0] + mq[1] + mq[2]];
      } else { mq = [0, 0, 0, 0]; mTotal = 0; }
    }

    P.meshCount++;
    return {
      rec: rec, buf: rec ? rec.arena.buf : null, bytes: bytes + mTotal * NS.CFG.MODEL_QUAD_BYTES,
      batch: rec ? rec.id : -1,          // ARCH §9: the frontend groups draws by this
      quads: q,
      firstQuad: [base, base + q[0], base + q[0] + q[1]],
      modelRec: mRec,
      modelBuf: mRec ? mRec.arena.buf : null,
      modelQuads: mq,
      modelFirst: mFirst
    };
  };

  P.destroySectionMesh = function (h) {
    if (!h) return;
    if (h.modelRec) { P.modelArenas.release(h.modelRec); h.modelRec = null; h.modelBuf = null; }
    if (h.rec) { P.arenas.release(h.rec); h.rec = null; h.buf = null; }
    P.meshCount--;
  };

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  P.resize = function (w, h) {
    w = Math.max(1, w | 0); h = Math.max(1, h | 0);
    P.vw = w; P.vh = h;
    if (!P.device) return;
    if (P.canvas && (P.canvas.width !== w || P.canvas.height !== h)) {
      P.canvas.width = w; P.canvas.height = h;
    }
    if (P.depthTex) P.depthTex.destroy();
    P.depthTex = P.device.createTexture({
      size: [w, h, 1],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
      label: 'depth'
    });
  };

  /**
   * setQuality({mipmaps}) — see the WebGL2 twin. Both samplers are built up front and this
   * swaps between them by rebuilding bind group 0, which is one object and no re-upload.
   */
  P.setQuality = function (q) {
    if (!P.device || P.lost || !q) return;
    var want = q.mipmaps !== false;
    if (want === P.mipmaps) return;
    P.mipmaps = want;
    P.sampler = want ? P.samplerMip : P.samplerFlat;
    P.bg0 = P.device.createBindGroup({
      layout: P.bgl0,
      entries: [
        { binding: 0, resource: { buffer: P.frameBuf } },
        { binding: 1, resource: P.atlasTex.createView({ dimension: '2d-array' }) },
        { binding: 2, resource: P.sampler },
        { binding: 3, resource: P.tintTex.createView({ dimension: '2d-array' }) },
        { binding: 4, resource: P.tintSampler }
      ]
    });
  };

  // ── the biome tint map (PLAN W6) ────────────────────────────────────────────────────────
  // The same 256x256x3 RGBA8 map the WebGL2 backend uses, from the same `NS.Tint` bytes. The
  // sampler is LINEAR in both, because the filtering IS the biome-border blend.
  function createTintTexture(device) {
    var N = NS.Gfx.TINT_TEXELS, LY = NS.Gfx.TINT_LAYERS;
    if (NS.Tint) NS.Tint.init();
    P.tintTex = device.createTexture({
      size: [N, N, LY], format: 'rgba8unorm', label: 'tint',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    P.tintSampler = device.createSampler({
      magFilter: 'linear', minFilter: 'linear',
      addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', label: 'tint'
    });
    P.tintVersion = -1;
    // D-214: the map's writes drive the upload; register as its sink and take the whole map as
    // dirty. Whichever backend created its texture last owns the sink, which is what F9 needs.
    if (NS.Tint && NS.Tint.ready) { NS.Tint.sink = P.syncTint; NS.Tint.markDirty(0, 0, NS.Tint.SIZE - 1, NS.Tint.SIZE - 1); }
  }

  /**
   * D-214, and it must stay byte-for-byte the same upload the WebGL2 path makes: the map's
   * dirty rectangle across all three layers, addressed by an OFFSET into the plane-major bytes
   * rather than by copying a rectangle out of them. `rowsPerImage` is the full width, so the
   * layer stride stays one whole plane however narrow the rectangle is.
   */
  P.syncTint = function () {
    var Tm = NS.Tint;
    if (!P.device || P.lost || !Tm || !Tm.ready || !P.tintTex) return;
    if (P.tintVersion === Tm.version) return;
    var N = NS.Gfx.TINT_TEXELS;
    var x0 = Tm.dirtyX0, z0 = Tm.dirtyZ0;
    var w = Tm.dirtyX1 - x0 + 1, h = Tm.dirtyZ1 - z0 + 1;
    if (w > 0 && h > 0) {
      P.device.queue.writeTexture(
        { texture: P.tintTex, origin: { x: x0, y: z0, z: 0 } },
        Tm.data,
        { offset: (z0 * N + x0) * 4, bytesPerRow: N * 4, rowsPerImage: N },
        [w, h, NS.Gfx.TINT_LAYERS]);
    }
    P.tintVersion = Tm.version;
    Tm.uploaded = Tm.version;
    Tm.clearDirty();
  };

  // #1329: queue.writeTexture each dirty dynamic-pool layer, every mip level.
  P.syncAtlasDyn = function () {
    var A = NS.Atlas;
    if (!A || !A.dynDrain || !P.atlasTex) return;
    A.dynDrain(function (tile) {
      for (var l = 0; l < A.mips.length; l++) {
        var m = A.mips[l], stride = m.size * m.size * 4;
        P.device.queue.writeTexture(
          { texture: P.atlasTex, mipLevel: l, origin: [0, 0, tile] },
          m.data.subarray(tile * stride, (tile + 1) * stride),
          { offset: 0, bytesPerRow: m.size * 4, rowsPerImage: m.size },
          [m.size, m.size, 1]);
      }
    });
  };

  P.beginFrame = function (state) {
    if (!P.device || P.lost) return;
    P.syncAtlasDyn();

    // Grow the per-draw uniform ring before the pass opens: bind groups recorded into a pass
    // must keep pointing at a live buffer until submit.
    if (P.dynOverflow) {
      allocDyn(P.device, Math.min(65536, P.dynSlots * 2));
      rebuildDynBindGroup(P.device);
      P.dynOverflow = 0;
    }
    P.dynUsed = 0;
    P.drawCount = 0;
    P.curBuf = null;
    P.binds = 0;

    var f = P.frameData;
    f.set(state.viewProj, 0);
    // camera-relative: the shader's camera is the origin of the space the geometry is in (D-179)
    f[16] = state.camX; f[17] = state.camY; f[18] = state.camZ; f[19] = state.time;
    f[20] = state.fogR; f[21] = state.fogG; f[22] = state.fogB; f[23] = state.fogNear;
    f[24] = state.fogFar; f[25] = state.skyScale; f[26] = state.skyDarkness || 0; f[27] = 0;
    var Tm = NS.Tint;
    var live = (Tm && Tm.ready && P.tintTex) ? 1 : 0;
    // the tint map's origin, moved into the eye-relative space the vertices are in (D-179)
    f[28] = live ? Tm.originX - state.eyeX : 0; f[29] = live ? Tm.originZ - state.eyeZ : 0;
    f[30] = live ? 1 / NS.Gfx.TINT_TEXELS : 0; f[31] = live;
    P.syncTint();
    P.device.queue.writeBuffer(P.frameBuf, 0, f.buffer, 0, FRAME_BYTES);

    var tex;
    try { tex = P.ctx.getCurrentTexture(); }
    catch (e) { P.failReason = 'getCurrentTexture failed: ' + (e && e.message); return; }
    P.colorTex = tex;

    P.encoder = P.device.createCommandEncoder();
    P.pass = P.encoder.beginRenderPass({
      colorAttachments: [{
        view: tex.createView(),
        clearValue: { r: state.fogR, g: state.fogG, b: state.fogB, a: 1 },
        loadOp: 'clear', storeOp: 'store'
      }],
      depthStencilAttachment: {
        view: P.depthTex.createView(),
        depthClearValue: 1.0, depthLoadOp: 'clear', depthStoreOp: 'store'
      }
    });
    P.pass.setIndexBuffer(P.idxBuf, 'uint16');
    // PLAN G16b / KW-24 — the sky goes down first, with depth writes off (D-303), exactly
    // where the WebGL2 backend puts it. It runs on its own pipelines and its own group 0
    // (`P.skyBgl`), so the world's group 0 (`P.bg0`) is (re)bound right after it returns.
    P.drawSky(state);
    P.pass.setBindGroup(0, P.bg0);
    P.passName = '';
  };

  /**
   * PLAN G10d — the first-person hand (D-359). Same contract as `GfxGL.drawHand`.
   *
   * ⚠⚠ **THE DEPTH BUFFER IS CLEARED FIRST, AND ON WEBGPU THAT MEANS A SECOND RENDER PASS.**
   * There is no mid-pass `clear` in WebGPU: the world's pass is ended and a new one begun with
   * `loadOp: 'load'` on the colour attachment and `depthLoadOp: 'clear'` on the depth one. That
   * is the same picture vanilla's `RenderSystem.clear(256)` produces before `renderItemInHand`,
   * and it is why the hand is never clipped by the wall you are standing against.
   * ⚠ UNVERIFIED ON HARDWARE — see the note beside the pipeline. Every step is guarded.
   */
  P.drawHand = function (frame) {
    if (!P.device || P.lost || !frame || !P.pipelines || !P.pipelines.hand || !P.handBg) return;
    var total = (frame.floats || 0) + (frame.arm ? frame.arm.floats : 0);
    if (!total || !P.encoder) return;
    try {
      var data = P.handScratch;
      if (!data || data.length < total) data = P.handScratch = new Float32Array(Math.max(4096, total * 2));
      var n = 0;
      if (frame.floats) { data.set(frame.verts.subarray(0, frame.floats), 0); n = frame.floats; }
      if (frame.arm && frame.arm.floats) { data.set(frame.arm.verts.subarray(0, frame.arm.floats), n); n += frame.arm.floats; }

      var bytes = n * 4;
      if (!P.handBuf || P.handBufBytes < bytes) {
        if (P.handBuf) P.handBuf.destroy();
        P.handBufBytes = Math.max(16384, bytes * 2);
        P.handBuf = P.device.createBuffer({
          size: P.handBufBytes, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, label: 'hand-vb'
        });
      }
      P.device.queue.writeBuffer(P.handBuf, 0, data.buffer, data.byteOffset, bytes);
      P.device.queue.writeBuffer(P.handUniform, 0, frame.proj.buffer, frame.proj.byteOffset, 64);

      // end the world's pass, and open one that keeps the colour and clears the depth
      if (P.pass) { P.pass.end(); P.pass = null; }
      var hp = P.encoder.beginRenderPass({
        colorAttachments: [{ view: P.colorTex.createView(), loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: {
          view: P.depthTex.createView(),
          depthClearValue: 1.0, depthLoadOp: 'clear', depthStoreOp: 'store'
        }
      });
      hp.setPipeline(P.pipelines.hand);
      hp.setBindGroup(0, P.bg0);
      hp.setBindGroup(1, P.bg1, [0]);
      hp.setBindGroup(2, P.handBg);
      hp.setVertexBuffer(0, P.handBuf);
      hp.draw(n / 10, 1, 0, 0);
      hp.end();
      P.handVerts = n / 10;
      // ⚠ `P.pass` STAYS NULL: `endFrame` must not call `end()` twice on a finished pass, and
      // the frontend draws the hand LAST, so there is nothing after this to record.
    } catch (e) {
      P.handFailReason = (e && e.message) || String(e);
      P.pipelines.hand = null;             // one failure, not one per frame
    }
  };

  /**
   * PLAN G16b / KW-24 — the sky pass, ported from `GfxGL.drawSky` (12_gfx_webgl2.js): same
   * six draws in the same order, same D-415 horizon fade, same `state.skyFrame` /
   * `state.skyViewProj` the frontend already computes identically for both backends
   * (09b_sky.js) — only the pipeline underneath is new.
   *
   * ⚠⚠ ALL SIX DRAWS' UNIFORMS ARE WRITTEN BEFORE ANY OF THEM IS RECORDED (D-86's pattern).
   * `queue.writeBuffer` takes effect in call order, not in "whenever this draw executes" order
   * — the whole per-draw uniform ring exists because a bind group recorded into a pass must
   * keep pointing at a live buffer, and if this wrote one draw's data, drew, then overwrote the
   * SAME bytes for the next draw, every draw the GPU actually executes at `submit()` would read
   * back whatever was written LAST. Six slots at six different offsets, one dynamic offset per
   * draw, is what keeps them apart.
   *
   * Returns the number of draws issued, the same contract `drawSection` and the GL backend's
   * `drawSky` both use (D-194 — the frontend counts submitted triangles, not a draw list).
   */
  P.drawSky = function (state) {
    // ⚠ RESET FIRST (D-194's own rule applied here): a guard below can bail before a single
    // draw is recorded, and P.skyDraws must say so — a stale count from the last frame that DID
    // draw is a debug stat lying about a frame that drew nothing at all.
    P.skyDraws = 0;
    if (!P.device || P.lost || !P.pass || !P.sky || !NS.Sky || !NS.Sky.ready || !state.skyFrame) return 0;
    var Sky = NS.Sky, S = P.sky, f = state.skyFrame;
    var anyBg = S.sunBg || S.moonBg;
    if (!anyBg) return 0;

    // ⚠ `state.skyViewProj`, NOT `state.viewProj` (D-304) — see 12_gfx_webgl2.js's own note:
    // the world's far plane is the fog wall, and the sun and moon sit at 100 blocks out.
    var viewProj = state.skyViewProj || state.viewProj;
    var skyFogOn = (NS.Settings && NS.Settings.horizonFade === false) ? 0 : 1;
    var skyFogEnd = state.fogFar || 128;
    var fogCol = [state.fogR, state.fogG, state.fogB, 1];

    var data = P.skyDynData, stride4 = SKY_DYN_STRIDE / 4;
    var write = function (slot, model, color, mode) {
      var o = slot * stride4;
      data.set(viewProj, o);
      data.set(model, o + 16);
      data[o + 32] = color[0]; data[o + 33] = color[1]; data[o + 34] = color[2]; data[o + 35] = color[3];
      data[o + 36] = mode[0];  data[o + 37] = mode[1];  data[o + 38] = mode[2];  data[o + 39] = mode[3];
      data[o + 40] = fogCol[0]; data[o + 41] = fogCol[1]; data[o + 42] = fogCol[2]; data[o + 43] = fogCol[3];
    };

    var slot = 0;
    // 1. the sky disc, in the biome's sky colour
    var discSlot = slot++;
    write(discSlot, S.identity, [f.sky[0], f.sky[1], f.sky[2], 1], [0, skyFogOn, skyFogEnd, 0]);

    // D-657: the sunrise/sunset fan — same (unrotated) space as the disc, no fog, alpha
    // weighted per vertex by uv.x (mode 2)
    var fan = f.sunrise, fanSlot = -1;
    if (fan) { fanSlot = slot++; write(fanSlot, S.identity, fan.color, [2, 0, 0, 0]); }

    // 2. the celestial bodies, in the frame that turns once a day
    Sky.celestialMatrix(S.model, Sky.dayTime);
    var star = f.starBrightness, starSlot = -1;
    if (star > 0 && S.starQuads > 0) {
      starSlot = slot++;
      write(starSlot, S.model, [star, star, star, star], [0, 0, 0, 0]);
    }
    // ⚠ THE SUN AND MOON FADE WITH RAIN, NOT WITH THE TIME OF DAY (same note as the GL backend).
    var a = 1 - f.rain, sunSlot = -1, moonSlot = -1;
    if (a > 0.01 && S.sunBg) { sunSlot = slot++; write(sunSlot, S.model, [1, 1, 1, a], [1, 0, 0, 0]); }
    if (a > 0.01 && S.moonBg) { moonSlot = slot++; write(moonSlot, S.model, [1, 1, 1, a], [1, 0, 0, 0]); }

    // 3. the dark disc below, so there is no hole under the world
    var darkSlot = slot++;
    write(darkSlot, S.identity, [f.fog[0], f.fog[1], f.fog[2], 1], [0, skyFogOn, skyFogEnd, 0]);

    if (slot > P.skyDynSlots) return 0;   // the geometry never grows; this would be a real bug
    P.device.queue.writeBuffer(P.skyDynBuf, 0, data.buffer, data.byteOffset, slot * SKY_DYN_STRIDE);

    if (fanSlot >= 0) {
      var fanData = skyInterleave(fan.pos, fan.weight);
      P.device.queue.writeBuffer(S.fanBuf, 0, fanData.buffer, fanData.byteOffset, fanData.byteLength);
    }
    // the phase picks one cell of the 4x2 grid, and the uv only changes when it does (same as GL)
    if (S.moonBg && S.lastPhase !== f.moonPhase) {
      var uv = Sky.moonUV(f.moonPhase);
      var moonData = skyInterleave(S.moonPosRaw, [uv[0], uv[1], uv[2], uv[1], uv[2], uv[3], uv[0], uv[3]]);
      P.device.queue.writeBuffer(S.moon, 0, moonData.buffer, moonData.byteOffset, moonData.byteLength);
      S.lastPhase = f.moonPhase;
    }

    var pass = P.pass, draws = 0;

    pass.setPipeline(P.pipelines.skyAlpha);
    pass.setBindGroup(0, anyBg, [discSlot * SKY_DYN_STRIDE]);
    pass.setVertexBuffer(0, S.disc);
    pass.draw(S.discVerts, 1, 0, 0);
    draws++;

    if (fanSlot >= 0) {
      pass.setBindGroup(0, anyBg, [fanSlot * SKY_DYN_STRIDE]);
      pass.setVertexBuffer(0, S.fanBuf);
      pass.draw(fan.verts, 1, 0, 0);
      draws++;
    }

    // ⚠ ADDITIVE, LIKE VANILLA — the stars and the sun ADD light to the sky rather than
    // covering it (same note as the GL backend's own FS_SKY comment).
    pass.setPipeline(P.pipelines.skyAdd);
    if (starSlot >= 0) {
      pass.setBindGroup(0, anyBg, [starSlot * SKY_DYN_STRIDE]);
      pass.setVertexBuffer(0, S.stars);
      pass.drawIndexed(S.starQuads * 6, 1, 0, 0, 0);
      draws++;
    }
    if (sunSlot >= 0) {
      pass.setBindGroup(0, S.sunBg, [sunSlot * SKY_DYN_STRIDE]);
      pass.setVertexBuffer(0, S.sun);
      pass.drawIndexed(6, 1, 0, 0, 0);
      draws++;
    }
    if (moonSlot >= 0) {
      pass.setBindGroup(0, S.moonBg, [moonSlot * SKY_DYN_STRIDE]);
      pass.setVertexBuffer(0, S.moon);
      pass.drawIndexed(6, 1, 0, 0, 0);
      draws++;
    }

    pass.setPipeline(P.pipelines.skyAlpha);
    pass.setBindGroup(0, anyBg, [darkSlot * SKY_DYN_STRIDE]);
    pass.setVertexBuffer(0, S.dark);
    pass.draw(S.darkVerts, 1, 0, 0);
    draws++;

    P.skyDraws = draws;
    return draws;
  };

  P.setPass = function (pass) {
    if (!P.pass) return;
    // #1850: 'decal' has no cube pipeline, only the model one (drawSectionModels picks it).
    P.waterMask = (pass === 'watermask');
    if (P.waterMask) { P.decal = false; P.additive = false; P.wire = false; P.layerMode = 0; P.passName = ''; return; }
    P.decal = (pass === 'decal');
    if (P.decal) { P.wire = false; P.layerMode = 1; P.passName = ''; return; }
    // #2627: likewise 'additive' -- model pipeline only (drawSectionModels picks modelAdditive for layer 3)
    P.additive = (pass === 'additive');
    if (P.additive) { P.wire = false; P.layerMode = 3; P.passName = ''; return; }
    var p = P.pipelines[pass];
    if (!p) return;
    P.pass.setPipeline(p);
    P.passName = pass;
    P.wire = (pass === 'wire');
    P.layerMode = (pass === 'cutout') ? 1 : ((pass === 'translucent') ? 2 : 0);
  };

  /** Returns the TRIANGLES actually submitted, 0 if nothing was (D-194 — the frontend counts this). */
  P.drawSection = function (h, ox, oy, oz, layer) {
    if (!P.pass || P.lost || !h || !h.buf) return 0;
    var n = h.quads[layer];
    if (!n) return 0;
    // ⚠ AND THIS IS WHY THE COUNTER HAD TO MOVE (D-194): a full dynamic-offset ring drops the
    // section on the floor. The old `tris` never noticed, because it counted the draw LIST.
    if (P.dynUsed >= P.dynSlots) { P.dynOverflow++; return 0; }

    var slot = P.dynUsed++;
    var o = slot * (DYN_STRIDE / 4);
    P.dynData[o] = ox; P.dynData[o + 1] = oy; P.dynData[o + 2] = oz; P.dynData[o + 3] = P.layerMode;

    P.pass.setBindGroup(1, P.bg1, [slot * DYN_STRIDE]);
    // One setVertexBuffer per ARENA, not per section (D-86).
    if (P.curBuf !== h.buf) { P.pass.setVertexBuffer(0, h.buf); P.curBuf = h.buf; P.binds++; }
    if (P.wire) P.pass.drawIndexed(n * 8, 1, P.triIndexCount + h.firstQuad[layer] * 8, 0, 0);
    else        P.pass.drawIndexed(n * 6, 1, h.firstQuad[layer] * 6, 0, 0);
    P.drawCount++;
    return n * 2;
  };

  /**
   * Draw a section's MODEL quads for one layer. It swaps the pipeline, so the frontend
   * batches all the model draws of a layer together and calls endModelPass() afterwards to
   * put the cube pipeline back — the same contract as the GL backend (D-52).
   */
  /** Returns the TRIANGLES actually submitted, 0 if nothing was (D-194). */
  P.drawSectionModels = function (h, ox, oy, oz, layer) {
    if (!P.pass || P.lost || !h || !h.modelBuf || !h.modelFirst) return 0;
    if (P.wire) return 0;                     // the wireframe pass has no model variant
    var n = h.modelQuads[layer];
    if (!n) return 0;
    if (P.dynUsed >= P.dynSlots) { P.dynOverflow++; return 0; }

    var want = P.waterMask ? 'modelWaterMask' : P.decal ? 'modelDecal' : layer === 3 ? 'modelAdditive' : layer === 1 ? 'modelCutout' : layer === 2 ? 'modelTranslucent' : 'modelOpaque';
    if (P.passName !== want) {
      var pl = P.pipelines[want];
      if (!pl) return 0;
      P.pass.setPipeline(pl);
      P.passName = want;
      P.curBuf = null;                        // a pipeline change invalidates nothing, but
                                              // the vertex layout did change, so re-bind
    }

    var slot = P.dynUsed++;
    var o = slot * (DYN_STRIDE / 4);
    P.dynData[o] = ox; P.dynData[o + 1] = oy; P.dynData[o + 2] = oz; P.dynData[o + 3] = P.layerMode;

    P.pass.setBindGroup(1, P.bg1, [slot * DYN_STRIDE]);
    if (P.curBuf !== h.modelBuf) { P.pass.setVertexBuffer(0, h.modelBuf); P.curBuf = h.modelBuf; P.binds++; }
    P.pass.drawIndexed(n * 6, 1, h.modelFirst[layer] * 6, 0, 0);
    P.drawCount++;
    return n * 2;
  };

  /** Put the cube pipeline back after a run of model draws. */
  P.endModelPass = function () {
    if (!P.pass || P.decal || P.additive) return;
    var back = P.layerMode === 1 ? 'cutout' : P.layerMode === 2 ? 'translucent' : 'opaque';
    if (P.passName !== back && P.pipelines[back]) {
      P.pass.setPipeline(P.pipelines[back]);
      P.passName = back;
      P.curBuf = null;
    }
  };

  P.endFrame = function () {
    if (!P.device || !P.encoder) return;
    // ⚠ THE PASS MAY ALREADY BE CLOSED. `drawHand` ends the world's pass to clear the depth
    // buffer for its own (D-359); calling `end()` twice is a validation error that would take
    // the whole frame down.
    if (P.pass) P.pass.end();
    P.pass = null;
    P.curBuf = null;

    // One write for every per-draw uniform in the frame. Queue writes are ordered before the
    // submit below, so the values are in place by the time the pass executes.
    if (P.dynUsed) {
      P.device.queue.writeBuffer(P.dynBuf, 0, P.dynData.buffer, 0, P.dynUsed * DYN_STRIDE);
    }

    var pend = P.pending;
    if (pend) {
      P.pending = null;
      var bpr = Math.ceil(pend.w * 4 / 256) * 256;
      var size = bpr * pend.h;
      if (!P.captureBuf || P.captureBuf.size < size) {
        if (P.captureBuf) P.captureBuf.destroy();
        P.captureBuf = P.device.createBuffer({
          size: size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ, label: 'capture'
        });
      }
      P.encoder.copyTextureToBuffer(
        { texture: P.colorTex, origin: { x: pend.x, y: pend.y, z: 0 } },
        { buffer: P.captureBuf, offset: 0, bytesPerRow: bpr, rowsPerImage: pend.h },
        [pend.w, pend.h, 1]
      );
      P.device.queue.submit([P.encoder.finish()]);
      P.encoder = null;
      var cb = P.captureBuf, bgra = P.format.indexOf('bgra') === 0;
      cb.mapAsync(GPUMapMode.READ, 0, size).then(function () {
        var src = new Uint8Array(cb.getMappedRange(0, size));
        var out = new Uint8Array(pend.w * pend.h * 4);
        for (var y = 0; y < pend.h; y++) {
          for (var x = 0; x < pend.w; x++) {
            var s = y * bpr + x * 4, d = (y * pend.w + x) * 4;
            if (bgra) { out[d] = src[s + 2]; out[d + 1] = src[s + 1]; out[d + 2] = src[s]; }
            else      { out[d] = src[s];     out[d + 1] = src[s + 1]; out[d + 2] = src[s + 2]; }
            out[d + 3] = src[s + 3];
          }
        }
        cb.unmap();
        pend.resolve(out);
      }, pend.reject);
      return;
    }

    P.device.queue.submit([P.encoder.finish()]);
    P.encoder = null;
  };

  /**
   * capture(x,y,w,h) -> Promise<Uint8Array>  (RGBA, rows top-down, viewport-relative)
   * Fulfilled after the NEXT endFrame. Used by Gfx.selfTest (D-3).
   */
  P.capture = function (x, y, w, h) {
    return new Promise(function (resolve, reject) {
      P.pending = { x: x | 0, y: y | 0, w: w | 0, h: h | 0, resolve: resolve, reject: reject };
    });
  };

  P.info = function () {
    var a = P.adapterInfo || {};
    return {
      backend: 'webgpu',
      ok: !!P.device && !P.lost,
      vendor: a.vendor || 'unknown',
      renderer: (a.architecture || '') + (a.device ? ' ' + a.device : '') || 'unknown',
      description: a.description || '',
      format: P.format,
      meshes: P.meshCount,
      draws: P.drawCount,
      arenas: P.arenas ? P.arenas.count : 0,
      arenaMB: P.arenas ? +(P.arenas.bytes / 1048576).toFixed(1) : 0,
      binds: P.binds | 0,
      mipmaps: P.mipmaps !== false,
      reason: P.failReason
    };
  };

  P.destroy = function () {
    if (P.arenas) { P.arenas.destroyAll(); P.arenas = null; }
    if (P.atlasTex) P.atlasTex.destroy();
    if (P.depthTex) P.depthTex.destroy();
    if (P.idxBuf) P.idxBuf.destroy();
    if (P.frameBuf) P.frameBuf.destroy();
    if (P.dynBuf) P.dynBuf.destroy();
    if (P.skyDynBuf) P.skyDynBuf.destroy();
    if (P.sky) {
      var S = P.sky;
      [S.disc, S.dark, S.stars, S.sun, S.moon, S.fanBuf].forEach(function (b) { if (b) b.destroy(); });
      if (S.sunTex) S.sunTex.destroy();
      if (S.moonTex) S.moonTex.destroy();
    }
    P.atlasTex = P.depthTex = P.idxBuf = P.frameBuf = P.dynBuf = P.skyDynBuf = null;
    P.sky = null;
    P.pipelines = null;
  };
})(MCL);
