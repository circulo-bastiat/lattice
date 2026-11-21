// 12_gfx_webgl2.js — WebGL2 backend (fallback). Main thread only.
// Implements the Backend interface in docs/archive/ARCH.md §9. Consumes the SAME 8-byte vertices as
// the WebGPU backend via vertexAttribIPointer (D-23) — that is what makes "renders identically"
// a testable claim rather than a hope. Every shading constant comes from MCL.Gfx.SHADE (D-52),
// so this file contains no magic numbers that 11_gfx_webgpu.js could disagree with.

(function (NS) {
  'use strict';

  var L = NS.GfxGL = {
    name: 'webgl2',
    gl: null,
    canvas: null,
    failReason: '',
    lost: false,
    losses: 0, restores: 0,   // D-194 — a permanent flag no check can see is not a diagnosis
    atlasCanvas: null,        // kept so a restored context can be rebuilt from the same atlas

    progMain: null, progFlat: null, progSky: null,
    sky: null,
    locMain: null, locFlat: null, cur: null, curProg: null,

    atlasTex: null,
    atlasTex2: null,   // D-380
    atlasTex3: null, atlasTex4: null,   // D-589
    atlasSplit: 0,
    idxBuf: null,
    triIndexBytes: 0,

    vw: 1, vh: 1,
    pass: '', layerMode: 0, wire: false,
    state: null,
    frameUploaded: null,
    pending: null,
    meshCount: 0
  };

  // ---------------------------------------------------------------------------
  // Shaders. Built at init() from MCL.Gfx.SHADE so the numbers live in exactly one place.
  // ---------------------------------------------------------------------------

  var sel  = function (c, a, b) { return '((' + c + ') ? ' + a + ' : ' + b + ')'; };
  var vec3 = function (a, b, c) { return 'vec3(' + a + ', ' + b + ', ' + c + ')'; };

  /**
   * Uniforms shared by both programs:
   *   uViewProj  mat4
   *   uOrigin    vec4  xyz = section origin RELATIVE TO THE CAMERA, w = layer mode (0/1/2)
   *   uCamTime   vec4  xyz = camera position, w = time in seconds
   *
   * ⚠ CAMERA-RELATIVE (D-179). Everything spatial in this block arrives with the eye already
   * subtracted, in doubles, by Gfx.drawList — so `uOrigin.xyz` is a few hundred at most however
   * far from spawn the player is, `uCamTime.xyz` is (0,0,0) and the fog term degenerates to
   * length(wp), and `uTint.xy` is the tint map's origin moved into the same space. Not one line
   * of shader source changed to get this: `wp = uOrigin.xyz + lp` simply means something else.
   *   uFogCol    vec4  rgb = fog colour, w = fog near distance
   *   uParams    vec4  x = fog far, y = sky light scale, zw reserved
   */
  L.buildShaders = function () {
    var Gx = NS.Gfx, S = Gx.SHADE, f = Gx.f;

    // ⚠ `textureLod`, not `texture`. A vertex shader has no derivatives, so an implicit-LOD
    // fetch there is undefined in GLSL ES 3.00 — some drivers give level 0, some give garbage,
    // and the ones that give garbage give it silently.
    var tintSample = function (uv, layer) {
      return 'textureLod(uTintMap, vec3(' + uv + ', ' + layer + '), 0.0).rgb';
    };
    // the two lines every tinted vertex shader needs, kept in one place so the cube and model
    // programs cannot drift apart
    // ⚠ `precision highp sampler2DArray` is not optional in a VERTEX shader. The fragment
    // shader declares it; the vertex shaders never had a sampler before, and without the line
    // the compile fails with "No precision specified" and the whole backend refuses to start.
    var TINT_UNIFORMS = ['precision highp sampler2DArray;',
                         'uniform vec4 uTint;', 'uniform sampler2DArray uTintMap;'];

    var VS = [
      '#version 300 es',
      'precision highp float;',
      'precision highp int;',
      'in uint aData0;',
      'in uint aData1;',
      'uniform mat4 uViewProj;',
      'uniform vec4 uOrigin;',
      'uniform vec4 uCamTime;',
      'uniform vec4 uFogCol;',
      'uniform vec4 uParams;',
      'uniform float uAmb;',
      TINT_UNIFORMS[0], TINT_UNIFORMS[1], TINT_UNIFORMS[2],
      'out vec2 vUV;',
      'flat out float vLayer;',
      'out vec3 vTint;',
      'out float vShade;',
      'out float vFog;',
      'out float vCut;',
      'out float vWhite;',
      '// data0: x:0-5 y:6-11 z:12-17 face:18-20 ao:21-22 sky:23-26 blk:27-30 flag:31',
      '// data1: tile:0-11 uRep:12-19 vRep:20-27 corner:28-29 tint:30-31',
      'void main() {',
      '  uint d0 = aData0;',
      '  uint d1 = aData1;',
      '  vec3 lp = vec3(float(d0 & 63u), float((d0 >> 6u) & 63u), float((d0 >> 12u) & 63u));',
      '  uint face = (d0 >> 18u) & 7u;',
      '  float ao = float((d0 >> 21u) & 3u);',
      '  float sky = float((d0 >> 23u) & 15u);',
      '  float blk = float((d0 >> 27u) & 15u);',
      '  float anim = float((d0 >> 31u) & 1u);',
      '  uint tile = d1 & 4095u;',
      '  vec2 rep = vec2(float((d1 >> 12u) & 255u), float((d1 >> 20u) & 255u));',
      '  uint corner = (d1 >> 28u) & 3u;',
      '  uint tint = (d1 >> 30u) & 3u;',
      '  vec2 cuv = vec2(float(corner == 1u || corner == 2u), float(corner >= 2u));',
      '  vUV = cuv * rep + vec2(0.0, anim * uCamTime.w * ' + f(S.SCROLL) + ');',
      '  vLayer = float(tile);',
      '  vec3 wp = uOrigin.xyz + lp;',
      '  float lv = max(sky * uParams.y, blk) * (1.0 / 15.0);',
      '  float lightv = uAmb + (1.0 - uAmb) * (lv / (4.0 - 3.0 * lv));',
      '  float fsh = ' + Gx.faceShadeExpr('face', sel, true) + ';',
      '  float aosh = ' + f(S.AO_BASE) + ' + ao * ' + f(S.AO_STEP) + ';',
      '  lightv = ' + Gx.gammaLightExpr('mix(lightv, 1.0, floor(uParams.z) / 255.0)', 'uParams.w', 'pow', 'mix') + ';',
      '  vShade = fsh * aosh * lightv;',
      '  vCut = 0.0;',
      '  vWhite = 0.0;',
      '  vTint = ' + Gx.tintMapExpr('tint', 'wp', tintSample, sel, true, vec3) + ' * mix(vec3(1.0), vec3(0.7, 0.6, 0.6), fract(uParams.z));',  // LightmapTextureManager: lerp(light, light*(0.7,0.6,0.6), GameRenderer.getSkyDarkness) while a darkenSky boss bar is up
      '  float dist = length(wp - uCamTime.xyz);',
      '  vFog = clamp((dist - uFogCol.w) / max(1.0, uParams.x - uFogCol.w), 0.0, 1.0);',
      '  gl_Position = uViewProj * vec4(wp, 1.0);',
      '}'
    ].join('\n');

    var FS = [
      '#version 300 es',
      'precision highp float;',
      'precision highp int;',
      'precision highp sampler2DArray;',
      'in vec2 vUV;',
      'flat in float vLayer;',
      'in vec3 vTint;',
      'in float vShade;',
      'in float vFog;',
      'in float vCut;',
      'in float vWhite;',
      'uniform sampler2DArray uAtlas;',
      'uniform sampler2DArray uAtlas2;',
      'uniform sampler2DArray uAtlas3;',   // D-589: shards 3 and 4
      'uniform sampler2DArray uAtlas4;',
      'uniform float uAtlasSplit;',
      'uniform vec4 uOrigin;',
      'uniform vec4 uFogCol;',
      'out vec4 fragColor;',
      'void main() {',
      // D-380: the atlas is sharded across two TEXTURE_2D_ARRAYs when it outgrows a single
      // array's driver ceiling (D-379) -- `uAtlasSplit` is the boundary uploadAtlas() actually
      // used, not a guess, so this branch can never disagree with what is really on the GPU.
      '  vec4 t = (vLayer < uAtlasSplit) ? texture(uAtlas, vec3(vUV, vLayer)) : ((vLayer < (uAtlasSplit + uAtlasSplit)) ? texture(uAtlas2, vec3(vUV, vLayer - uAtlasSplit)) : ((vLayer < (uAtlasSplit + uAtlasSplit + uAtlasSplit)) ? texture(uAtlas3, vec3(vUV, vLayer - (uAtlasSplit + uAtlasSplit))) : texture(uAtlas4, vec3(vUV, vLayer - (uAtlasSplit + uAtlasSplit + uAtlasSplit)))));',
      '  int mode = int(uOrigin.w);',
      '  if (mode != 2 && t.a < vCut) discard;',   // #7065: in the translucent pass the vertex alpha is an OPACITY (misc/shadow), not a cutoff
      '  if (mode == 1 && t.a < ' + f(S.CUTOUT) + ') discard;',
      // ⚠ THE TINT IS NOT WEIGHTED BY ALPHA IN THE OPAQUE PASS (D-159). Weighting it made sense
      // while only genuinely opaque blocks reached mode 0 — a=1 everywhere, so the weight did
      // nothing. `fastLeaves` breaks that: it moves a CUTOUT texture into the opaque pass, where
      // nothing discards, and the leaf texture's holes carry a=0 — so `mix(white, tint, 0)` left
      // every hole UNTINTED and the leaves rendered grey instead of green on every preset below
      // medium. Vanilla's fast leaves are a solid green block, not a grey one.
      '  float mask = (mode == 1) ? t.a : 1.0;',
      '  vec3 rgb = mix(t.rgb, vec3(1.0, 1.0, 1.0), vWhite) * mix(vec3(1.0, 1.0, 1.0), vTint, mask) * vShade;',
      '  float fg = pow(vFog, ' + f(S.FOG_CURVE) + ');',
      '  rgb = mix(rgb, uFogCol.rgb, fg);',
      // #2627: mode 3 (energy swirl) is blended ONE,ONE at colour 0.5 -- fog fades it to black, not to the fog colour
      '  if (mode == 3 && abs(vCut - ' + f(30 / 31) + ') < 0.01) { fragColor = vec4(t.rgb * t.rgb * (1.0 - fg), 1.0); return; }',   // #9239: glint = GLINT_TRANSPARENCY (SRC_COLOR, ONE) as ONE,ONE of src*src
      '  if (mode == 3) { fragColor = vec4(t.rgb * vTint * vShade * mix(0.5, 1.0, vCut) * (1.0 - fg), 1.0); return; }',
      '  fragColor = vec4(rgb, (mode == 2) ? ((vCut > 0.0) ? t.a * vCut : t.a) : 1.0);',
      '}'
    ].join('\n');

    /**
     * MODEL vertex shader — the sub-block geometry stream (CFG.MODEL_QUAD_BYTES).
     *
     * The cube stream packs a vertex into 2 uint32 with no bits to spare, so anything that
     * is not a full-cube face gets this instead: 4 uint32, real positions in 1/256 of a
     * block, and its own UVs rather than a repeat count.
     *
     * Everything downstream is deliberately IDENTICAL to the cube program — the same
     * fragment shader, the same light curve, the same face shade table, the same fog. A
     * fence and the stone next to it must be lit by the same maths or the seam between them
     * is visible, and "two shaders that are supposed to agree" is exactly the kind of thing
     * that quietly stops agreeing.
     */
    var VS_MODEL = [
      '#version 300 es',
      'precision highp float;',
      'precision highp int;',
      'in uvec4 aModel;',
      'uniform mat4 uViewProj;',
      'uniform vec4 uOrigin;',
      'uniform vec4 uCamTime;',
      'uniform vec4 uFogCol;',
      'uniform vec4 uParams;',
      'uniform float uAmb;',
      TINT_UNIFORMS[0], TINT_UNIFORMS[1], TINT_UNIFORMS[2],
      'out vec2 vUV;',
      'flat out float vLayer;',
      'out vec3 vTint;',
      'out float vShade;',
      'out float vFog;',
      'out float vCut;',
      'out float vWhite;',
      '// w0: px:i16 py:i16   w1: pz:i16 tile:u16   w2: u:i16 v:i16',
      '// w3: face:0-2 ao:3-4 sky:5-8 blk:9-12 tint:13-14 shade:15 flag:16 etint:17-25 anim:26 alpha:27-31',
      'int s16(uint v) { int i = int(v & 0xFFFFu); return (i > 32767) ? i - 65536 : i; }',
      'void main() {',
      '  vec3 lp = vec3(float(s16(aModel.x)), float(s16(aModel.x >> 16u)), float(s16(aModel.y)))',
      '            * ' + f(1 / 256) + ';',
      '  uint tile = (aModel.y >> 16u) & 0x1FFFu;',
      '  vWhite = float((aModel.y >> 29u) & 7u) * ' + f(1 / 7) + ';',
      '  uint d3 = aModel.w;',
      // #1263: w3 bit 26 = the fluid scroll, the same one the cube stream's `anim` flag drives
      '  vUV = vec2(float(s16(aModel.z)), float(s16(aModel.z >> 16u))) * ' + f(1 / 256) + ' + vec2(0.0, float((d3 >> 26u) & 1u) * uCamTime.w * ' + f(S.SCROLL) + ');',
      // #2627: mode 3 = the energy swirl (NS.CFG.swirlOffset): x = cos(f*0.02)*3, y = f*0.01, f = ticks (REPEAT wraps the % 1)
      // #9239: alpha field 30 in the additive bucket = the enchantment glint (RenderPhase.setupGlintTexturing: translate(-(t%110000)/110000, (t%30000)/30000), t = ms*8; the rotate+scale are baked into the UVs)
      '  if (int(uOrigin.w) == 3 && ((d3 >> 27u) & 31u) == 30u) { float gt = uCamTime.w * 8000.0; vUV += vec2(-fract(gt / 110000.0), fract(gt / 30000.0)); }',
      '  if (int(uOrigin.w) == 3 && ((d3 >> 27u) & 31u) != 31u && ((d3 >> 27u) & 31u) != 30u) { float sf = uCamTime.w * 20.0; float cr = float((d3 >> 26u) & 1u); vUV += vec2(cr > 0.5 ? sf * 0.01 : cos(sf * 0.02) * 3.0, sf * 0.01 - cr * uCamTime.w * ' + f(S.SCROLL) + '); }',
      '  uint face = d3 & 7u;',
      '  float ao = float((d3 >> 3u) & 3u);',
      '  float sky = float((d3 >> 5u) & 15u);',
      '  float blk = float((d3 >> 9u) & 15u);',
      '  uint tint = (d3 >> 13u) & 3u;',
      '  float shaded = float((d3 >> 15u) & 1u);',
      // ⚠ D-234's spare bit, finally read -- same derivation as 11_gfx_webgpu.js's `vs_model`,
      // which this shader must agree with pixel-for-pixel (D-52/shadercheck): the living-entity
      // hurt/death overlay (.decomp `LivingEntityRenderer.getOverlay` + `OverlayTexture`'s ctor),
      // applied as a multiplicative red tint since that is the one blend mode `vTint` already
      // feeds the fragment shader.
      '  float flag = float((d3 >> 16u) & 1u);',
      // D-503's OWED, CLOSED: the per-entity RGB tint channel (10_gfx.js's `entityTintExpr`,
      // shared with 11_gfx_webgpu.js's `vs_model` -- D-52). Multiplicative, identity (1,1,1).
      '  vec3 etint = ' + Gx.entityTintExpr('d3', true, vec3, 'float') + ';',
      '  vLayer = float(tile);',
      '  vec3 wp = uOrigin.xyz + lp;',
      '  float lv = max(sky * uParams.y, blk) * (1.0 / 15.0);',
      '  float lightv = uAmb + (1.0 - uAmb) * (lv / (4.0 - 3.0 * lv));',
      // shade:false in the model (crosses, plants) means "no directional shading at all",
      // which is vanilla's rule and the reason grass tufts do not have a dark side
      '  float fsh = mix(1.0, ' + Gx.faceShadeExpr('face', sel, true) + ', shaded);',
      '  float aosh = ' + f(S.AO_BASE) + ' + ao * ' + f(S.AO_STEP) + ';',
      '  lightv = ' + Gx.gammaLightExpr('mix(lightv, 1.0, floor(uParams.z) / 255.0)', 'uParams.w', 'pow', 'mix') + ';',
      '  vShade = fsh * aosh * lightv;',
      '  vCut = ' + Gx.entityAlphaExpr('d3', true, 'float') + ';',
      '  vec3 mtint = ' + Gx.tintMapExpr('tint', 'wp', tintSample, sel, true, vec3) + ';',
      '  vTint = mix(mtint, mtint * vec3(1.0, 0.3, 0.3), flag * ' + f(0.7) + ') * etint * mix(vec3(1.0), vec3(0.7, 0.6, 0.6), fract(uParams.z));',
      '  float dist = length(wp - uCamTime.xyz);',
      '  vFog = clamp((dist - uFogCol.w) / max(1.0, uParams.x - uFogCol.w), 0.0, 1.0);',
      '  gl_Position = uViewProj * vec4(wp, 1.0);',
      '}'
    ].join('\n');

    // Position-only program: depth prepass and the debug wireframe. Decodes nothing but xyz.
    var VS_POS = [
      '#version 300 es',
      'precision highp float;',
      'precision highp int;',
      'in uint aData0;',
      'in uint aData1;',
      'uniform mat4 uViewProj;',
      'uniform vec4 uOrigin;',
      'void main() {',
      '  uint d0 = aData0;',
      '  vec3 lp = vec3(float(d0 & 63u), float((d0 >> 6u) & 63u), float((d0 >> 12u) & 63u));',
      '  gl_Position = uViewProj * vec4(uOrigin.xyz + lp, 1.0);',
      '}'
    ].join('\n');

    var FS_FLAT = [
      '#version 300 es',
      'precision highp float;',
      'uniform vec4 uFlat;',
      'out vec4 fragColor;',
      'void main() {',
      '  fragColor = uFlat;',
      '}'
    ].join('\n');

    // ── PLAN G16b: the sky pass ────────────────────────────────────────────────────────────
    // ⚠ ITS OWN PROGRAM, AND THE REASON IS `uModel`. Everything else this backend draws is
    // already in eye-relative world space (D-179) and needs no model matrix at all; the sky's
    // sun, moon and stars are one rigid body that rotates once a day, so they get a matrix and
    // nothing else has to carry one. Positions are plain floats — ten vertices for a disc and
    // four for a quad do not need the packed format the world's millions of vertices do.
    // ⚠⚠ **AND THE SKY DISC IS FOGGED — D-415, "that white line in the sky".** Vanilla runs
    // `FogRenderer.setupFog(camera, FogMode.FOG_SKY, viewDistance, …)` BEFORE `renderSky`, which
    // is `start = 0, end = the render distance in blocks`, and the sky disc is drawn through it.
    // The disc sits 16 blocks above the eye and runs out to a radius of 512, so its far rim is
    // hundreds of blocks away and arrives at the horizon as PURE FOG COLOUR, while the part
    // overhead is barely fogged at all. That gradient IS Minecraft's horizon.
    //
    // Without it — which is how this shipped — the disc is a flat slab of biome sky colour that
    // simply STOPS at pitch 0, where the clear colour (the fog) takes over: a hard, dead-level
    // line straight across the screen, pale against blue by day and pale against black at night,
    // sitting a little above the terrain wherever the terrain is lower than the eye. It is the
    // first thing you see looking at the horizon and there was no way to miss it once looked for.
    //
    // ⚠ PER FRAGMENT, NOT PER VERTEX. The disc is a nine-vertex fan whose rim vertices are ALL
    // at 512 blocks: per-vertex fog would be 0 at the one centre vertex and 1 at every rim one,
    // and interpolating that across triangles a thousand blocks wide would smear the horizon's
    // 7-degree band over the whole sky. The eye-relative position is interpolated instead and
    // the distance taken in the fragment, the same way the world's own fog already works.
    //
    // ⚠ THE CELESTIAL BODIES ARE NOT FOGGED, AND THAT IS A DEVIATION WITH A REASON. Vanilla fogs
    // them too, and at this engine's render distances (76.8 blocks at the Celeron preset, and
    // the sun is at 100) that would erase the sun and moon from the sky completely. Rendering is
    // where MC-Lite is allowed to be cheap rather than faithful; a missing sun is not a trade
    // anyone would take. `uSkyMode.y` is the per-draw switch: 1 for the two discs, 0 for the
    // stars, the sun and the moon.
    var VS_SKY = [
      '#version 300 es',
      'precision highp float;',
      'in vec3 aPos;',
      'in vec2 aUV;',
      'uniform mat4 uViewProj;',
      'uniform mat4 uModel;',
      'out vec2 vUV;',
      'out vec3 vSkyPos;',
      'void main() {',
      '  vUV = aUV;',
      '  vec4 wp = uModel * vec4(aPos, 1.0);',
      '  vSkyPos = wp.xyz;',
      '  gl_Position = uViewProj * wp;',
      '}'
    ].join('\n');

    var FS_SKY = [
      '#version 300 es',
      'precision highp float;',
      'in vec2 vUV;',
      'in vec3 vSkyPos;',
      'uniform sampler2D uSkyTex;',
      // x = textured, y = fog this draw (1 = the discs, 0 = sun/moon/stars), z = fog end, w spare
      'uniform vec4 uSkyMode;',
      'uniform vec4 uSkyColor;',
      'uniform vec4 uFogCol;',
      'out vec4 fragColor;',
      'void main() {',
      '  vec4 c = uSkyColor;',
      // x = 2: the sunrise fan (D-657) — untextured, alpha weighted per vertex by aUV.x (1 at the
      // centre, 0 on the rim), the interpolation vanilla's position_color draw gives its vertex alphas
      '  if (uSkyMode.x > 1.5) c.a *= vUV.x;',
      '  else if (uSkyMode.x > 0.5) c *= texture(uSkyTex, vUV);',
      '  if (uSkyMode.y > 0.5) {',
      '    float fg = clamp(length(vSkyPos) / max(1.0, uSkyMode.z), 0.0, 1.0);',
      '    c.rgb = mix(c.rgb, uFogCol.rgb, fg);',
      '  }',
      '  fragColor = c;',
      '}'
    ].join('\n');

    // ── PLAN G10d: the first-person hand (D-359) ───────────────────────────────────────────
    // ⚠ ITS OWN PROGRAM, AND THE REASON IS THE SPACE. Every other vertex this backend draws is
    // in eye-relative WORLD space and packed into integers a 256th of a block wide. The hand is
    // 0.7 blocks from the eye and fills a quarter of the screen, where a 256th of a block is
    // about eight pixels — so the packed format would make the swing visibly stair-step. These
    // vertices are plain floats, already in VIEW space (the pose is applied on the CPU, once per
    // frame, over a few hundred vertices), and the only uniform is the projection.
    //
    // ⚠ AND IT SAMPLES TWO TEXTURES, because an empty hand is the player's SKIN and a held item
    // is the block atlas. `aInfo.x < 0` is the signal; a second draw call with a second uniform
    // would be a second program to keep in step for no gain.
    var VS_HAND = [
      '#version 300 es',
      'precision highp float;',
      'in vec3 aPos;',
      'in vec2 aUV;',
      'in vec2 aInfo;',            // x layer (-1 = skin) · y shade
      'in vec3 aTint;',
      'uniform mat4 uProj;',
      'out vec2 vUV;',
      'flat out float vLayer;',
      'out float vShade;',
      'out vec3 vTint;',
      'void main() {',
      '  vUV = aUV;',
      '  vLayer = aInfo.x;',
      '  vShade = aInfo.y;',
      '  vTint = aTint;',
      '  gl_Position = uProj * vec4(aPos, 1.0);',
      '}'
    ].join('\n');

    var FS_HAND = [
      '#version 300 es',
      'precision highp float;',
      'precision highp sampler2DArray;',
      'in vec2 vUV;',
      'flat in float vLayer;',
      'in float vShade;',
      'in vec3 vTint;',
      'uniform sampler2DArray uAtlas;',
      'uniform sampler2DArray uAtlas2;',
      'uniform sampler2DArray uAtlas3;',   // D-589: shards 3 and 4
      'uniform sampler2DArray uAtlas4;',
      'uniform float uAtlasSplit;',
      'uniform sampler2D uSkin;',
      'out vec4 fragColor;',
      'void main() {',
      // D-380, same split the world shader uses (uploadAtlas() sets both from one number).
      '  vec4 c = (vLayer < 0.0) ? texture(uSkin, vUV) : ((vLayer < uAtlasSplit) ? texture(uAtlas, vec3(vUV, vLayer)) : ((vLayer < (uAtlasSplit + uAtlasSplit)) ? texture(uAtlas2, vec3(vUV, vLayer - uAtlasSplit)) : ((vLayer < (uAtlasSplit + uAtlasSplit + uAtlasSplit)) ? texture(uAtlas3, vec3(vUV, vLayer - (uAtlasSplit + uAtlasSplit))) : texture(uAtlas4, vec3(vUV, vLayer - (uAtlasSplit + uAtlasSplit + uAtlasSplit))))));',
      // ⚠ THE SAME CUTOUT THRESHOLD THE WORLD USES. A held torch, a sapling and every sprite
      // item have transparent margins; without the discard the hand is a rectangle of black.
      '  if (c.a < ' + f(S.CUTOUT) + ') discard;',
      '  fragColor = vec4(c.rgb * vTint * vShade, 1.0);',
      '}'
    ].join('\n');

    // #1851 — the colour-ray layer: untextured, vertex-coloured, additive (RenderLayer.getLightning)
    var VS_RAY = [
      '#version 300 es',
      'precision highp float;',
      'in vec3 aPos;',
      'in vec4 aColor;',
      'uniform mat4 uViewProj;',
      'out vec4 vColor;',
      'void main() {',
      '  vColor = aColor;',
      '  gl_Position = uViewProj * vec4(aPos, 1.0);',
      '}'
    ].join('\n');
    var FS_RAY = [
      '#version 300 es',
      'precision highp float;',
      'in vec4 vColor;',
      'out vec4 fragColor;',
      'void main() {',
      '  fragColor = vColor;',
      '}'
    ].join('\n');
    L.VS_RAY = VS_RAY; L.FS_RAY = FS_RAY;

    L.VS_HAND = VS_HAND; L.FS_HAND = FS_HAND;
    L.VS_SKY = VS_SKY; L.FS_SKY = FS_SKY;
    L.VS = VS; L.FS = FS; L.VS_POS = VS_POS; L.FS_FLAT = FS_FLAT; L.VS_MODEL = VS_MODEL;
    // VS_MODEL is returned so tools/shadercheck.mjs can hold it against the WGSL vs_model:
    // two languages, one set of maths (D-3, D-52).
    return { VS: VS, FS: FS, VS_POS: VS_POS, FS_FLAT: FS_FLAT, VS_MODEL: VS_MODEL,
             VS_SKY: VS_SKY, FS_SKY: FS_SKY, VS_HAND: VS_HAND, FS_HAND: FS_HAND,
             VS_RAY: VS_RAY, FS_RAY: FS_RAY };
  };

  // ---------------------------------------------------------------------------
  // Compilation with real error reporting: a silent shader failure here is a black screen
  // with no explanation, which is the worst possible outcome for a double-clicked file.
  // ---------------------------------------------------------------------------

  function numberSource(src) {
    var lines = src.split('\n'), out = [];
    for (var i = 0; i < lines.length; i++) {
      var n = String(i + 1);
      while (n.length < 4) n = ' ' + n;
      out.push(n + ' | ' + lines[i]);
    }
    return out.join('\n');
  }

  function compile(gl, type, src, label) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(sh) || '(no log)';
      gl.deleteShader(sh);
      throw new Error(label + ' failed to compile:\n' + log + '\n\n' + numberSource(src));
    }
    return sh;
  }

  function link(gl, vsSrc, fsSrc, label) {
    var vs = compile(gl, gl.VERTEX_SHADER, vsSrc, label + ' vertex shader');
    var fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc, label + ' fragment shader');
    var p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    // Fixed attribute locations, so ONE vao works with every program (D-25's sibling problem).
    gl.bindAttribLocation(p, 0, 'aData0');
    gl.bindAttribLocation(p, 1, 'aData1');
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      var log = gl.getProgramInfoLog(p) || '(no log)';
      gl.deleteProgram(p);
      throw new Error(label + ' failed to link:\n' + log);
    }
    return p;
  }

  function locsOf(gl, p) {
    return {
      prog: p,
      uViewProj: gl.getUniformLocation(p, 'uViewProj'),
      uOrigin:   gl.getUniformLocation(p, 'uOrigin'),
      uCamTime:  gl.getUniformLocation(p, 'uCamTime'),
      uFogCol:   gl.getUniformLocation(p, 'uFogCol'),
      uParams:   gl.getUniformLocation(p, 'uParams'),
      uAmb:      gl.getUniformLocation(p, 'uAmb'),
      uAtlas:    gl.getUniformLocation(p, 'uAtlas'),
      uAtlas2:   gl.getUniformLocation(p, 'uAtlas2'),   // D-380
      uAtlas3:   gl.getUniformLocation(p, 'uAtlas3'),   // D-589
      uAtlas4:   gl.getUniformLocation(p, 'uAtlas4'),
      uAtlasSplit: gl.getUniformLocation(p, 'uAtlasSplit'),
      uTint:     gl.getUniformLocation(p, 'uTint'),
      uTintMap:  gl.getUniformLocation(p, 'uTintMap'),
      uFlat:     gl.getUniformLocation(p, 'uFlat'),
      // PLAN G16b — the sky pass's three (D-303)
      uModel:    gl.getUniformLocation(p, 'uModel'),
      uSkyTex:   gl.getUniformLocation(p, 'uSkyTex'),
      uSkyMode:  gl.getUniformLocation(p, 'uSkyMode'),
      uSkyColor: gl.getUniformLocation(p, 'uSkyColor'),
      // PLAN G10d — the hand pass's own two (D-359)
      uProj:     gl.getUniformLocation(p, 'uProj'),
      uSkin:     gl.getUniformLocation(p, 'uSkin')
    };
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  L.init = function (canvas, atlasCanvas) {
    var gl = null;
    L.failReason = '';
    try {
      gl = canvas.getContext('webgl2', {
        alpha: false, depth: true, stencil: false,
        antialias: false,               // MSAA is not affordable on a 2200G iGPU
        powerPreference: 'low-power',
        preserveDrawingBuffer: false,
        // ⚠ NOT `desynchronized: true` — D-247. That flag puts the canvas on a low-latency swap
        // chain that bypasses the compositor, and what it can do on real hardware is present a
        // frame the game never drew. NOTHING INSIDE THE PAGE CAN SEE THAT: every counter, every
        // readPixels and every screenshot reads the buffer the engine wrote, which is correct,
        // while the screen shows something else. It is the only mechanism left that fits a report
        // of a one-frame flash that four engine fixes and 1.17 M assertions never touched, and it
        // buys nothing this game needs — a voxel game is not a stylus app. `shadercheck` §11
        // asserts these attributes so it cannot come back by accident.
        desynchronized: false,
        failIfMajorPerformanceCaveat: false
      });
    } catch (e) {
      L.failReason = 'getContext threw: ' + (e && e.message);
      return false;
    }
    if (!gl) { L.failReason = 'no webgl2 context (driver, blocklist or software rendering disabled)'; return false; }

    L.gl = gl;
    L.canvas = canvas;
    L.lost = false;
    L.atlasCanvas = atlasCanvas || L.atlasCanvas;

    // ⚠ LOSING THE CONTEXT USED TO BE PERMANENT, AND SILENT (D-194). `lost` was set once, every
    // entry point returned early, and the game drew the clear colour for the rest of the session
    // with no counter and no message — the exact blank screen this file's checks exist to catch.
    // `preventDefault` is what makes the browser promise a 'webglcontextrestored' event at all;
    // taking it and then ignoring the restore was the worst of both.
    if (!L.lossHandlerAttached) {
      L.lossHandlerAttached = true;
      canvas.addEventListener('webglcontextlost', function (e) {
        e.preventDefault();
        L.lost = true;
        L.losses++;
        // D-434: every GL object dies with the context, and so does what `getParameter` said
        // about it. A cached vendor/renderer string from a dead context is a lie about the new
        // one, and it is exactly the kind of lie a debug overlay must never tell.
        L.staticInfo = null;
        L.failReason = 'context lost';
        if (NS.Gfx) NS.Gfx.contextLosses++;
        if (NS.Hud && NS.Hud.say) NS.Hud.say('graphics context lost — waiting for the driver');
      }, false);
      canvas.addEventListener('webglcontextrestored', function () {
        // Every GL object died with the old context, so this is a full re-init and then a
        // rebuild of the world's meshes — nothing survives that could be reused.
        var ok = false;
        try { ok = L.init(L.canvas, L.atlasCanvas); } catch (err) { ok = false; L.failReason = 'restore threw: ' + (err && err.message); }
        if (!ok) { L.lost = true; return; }
        L.restores++;
        if (NS.Gfx) NS.Gfx.onBackendRestored();
      }, false);
    }

    try {
      var src = L.buildShaders();
      L.progMain = link(gl, src.VS, src.FS, 'chunk');
      // shares the fragment shader with the cube program, on purpose — see VS_MODEL
      L.progModel = link(gl, src.VS_MODEL, src.FS, 'model');
      L.progFlat = link(gl, src.VS_POS, src.FS_FLAT, 'flat');
      L.progSky = link(gl, src.VS_SKY, src.FS_SKY, 'sky');
      L.progHand = link(gl, src.VS_HAND, src.FS_HAND, 'hand');
      L.progRay = link(gl, src.VS_RAY, src.FS_RAY, 'ray');
      L.locRay = { uViewProj: gl.getUniformLocation(L.progRay, 'uViewProj') };
      L.locMain = locsOf(gl, L.progMain);
      L.locModel = locsOf(gl, L.progModel);
      L.locFlat = locsOf(gl, L.progFlat);
      L.locSky = locsOf(gl, L.progSky);
      L.locHand = locsOf(gl, L.progHand);

      buildIndexBuffer(gl);
      initArenas();
      uploadAtlas(gl, atlasCanvas);
      createTintTexture(gl);
      initSky(gl);
      initHand(gl);
    } catch (e) {
      L.failReason = (e && e.message) || String(e);
      L.destroy();
      return false;
    }

    gl.useProgram(L.progMain);
    gl.uniform1i(L.locMain.uAtlas, 0);
    gl.uniform1i(L.locMain.uAtlas2, 3);           // D-380
    gl.uniform1i(L.locMain.uAtlas3, 4);           // D-589
    gl.uniform1i(L.locMain.uAtlas4, 5);
    gl.uniform1f(L.locMain.uAtlasSplit, L.atlasSplit);
    gl.uniform1i(L.locMain.uTintMap, 1);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, L.tintTex);
    // unit 3 is bound once, here, and never touched again — same pattern as unit 0 below.
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, L.atlasTex2);
    gl.activeTexture(gl.TEXTURE4);                 // D-589: units 4/5, also bound once
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, L.atlasTex3);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, L.atlasTex4);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, L.atlasTex);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    L.vw = canvas.width; L.vh = canvas.height;
    gl.viewport(0, 0, L.vw, L.vh);
    L.frameUploaded = { main: false, model: false, flat: false };
    return true;
  };

  /**
   * ONE index buffer for the whole application (D-25), holding two patterns back to back:
   *   [0 .. MAX_QUADS*6)                triangles, 0,1,2, 0,2,3 per quad
   *   [MAX_QUADS*6 .. +MAX_QUADS*8)     lines,     0,1, 1,2, 2,3, 3,0 per quad (wireframe)
   * MAX_QUADS*4-1 = 65535, so Uint16 indices are exactly enough and never one short.
   */
  function buildIndexBuffer(gl) {
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
    L.triIndexBytes = tri * 2;
    L.idxBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, L.idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
  }

  /**
   * The atlas is a 2D TEXTURE ARRAY, one tile per layer, with the CPU-built mip chain from
   * 06_atlas.js (D-50). Layers cannot bleed into each other, so REPEAT wrapping makes the
   * mesher's uRep/vRep tile counts exact with no UV inset and no textureGrad tricks.
   */
  /**
   * One TEXTURE_2D_ARRAY, levels x A.TILE x A.TILE x layerCount, from A.mips[*].data's
   * [layerStart, layerStart+layerCount) slice — or, when layerStart is past the real data
   * (the harmless stand-in second array a non-sharded atlas still gets, see uploadAtlas), a
   * single dummy layer so `uAtlas2` is always a COMPLETE texture and the shader branch that
   * would sample it is simply never taken.
   */
  function makeAtlasArray(gl, A, levels, layerStart, layerCount) {
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    var real = layerStart < A.tiles;
    var count = real ? Math.min(layerCount, A.tiles - layerStart) : 1;
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, gl.RGBA8, A.TILE, A.TILE, layerCount);
    for (var l = 0; l < levels; l++) {
      var m = A.mips[l];
      var stride = m.size * m.size * 4;
      var data = real ? m.data.subarray(layerStart * stride, (layerStart + count) * stride)
                       : new Uint8Array(stride);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, l, 0, 0, 0, m.size, m.size, count,
                       gl.RGBA, gl.UNSIGNED_BYTE, data);
    }
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_BASE_LEVEL, 0);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAX_LEVEL, levels - 1);
    return tex;
  }

  function uploadAtlas(gl, atlasCanvas) {
    var A = NS.Atlas;
    if (!A || !A.mips) throw new Error('atlas not built before Gfx.init');
    var levels = A.mips.length, layers = A.tiles;

    // ⚠⚠ D-380: ASK THE DRIVER WHETHER IT HAS THE LAYERS, IN WORDS (D-310's other half,
    // D-341) — AND WHEN IT DOES NOT, SHARD RATHER THAN REFUSE. Every measured Windows/ANGLE
    // path (this host headless, this host with SwiftShader flags dropped, the VM's software
    // guest, and that same VM's Windows guest with a real AMD iGPU partition, checked through
    // the desktop session) reported exactly 2048 — D3D11's own `Texture2DArray` ceiling
    // (D-379), not a driver quirk this project can flag its way past. The atlas needing more
    // layers than one array can hold is not a "cannot run here": it is a second
    // TEXTURE_2D_ARRAY, addressed by `vLayer < uAtlasSplit` in the fragment shader (FS/FS_HAND).
    // Two arrays cover up to 2x the driver's real limit; past that this throws by name instead
    // of silently truncating the atlas — a third shard is a real decision, not a bigger number
    // quietly typed in here.
    // D-589: FOUR shards now, not two. The mob textures live in this atlas (mob-tex.bin, D-378)
    // and session 107's villager clothing took it to 4158 layers — past two 2048-layer arrays —
    // and the game refused to start on every WebGL2 machine. Shards are equal-sized [k*split,
    // (k+1)*split); the shader picks by `vLayer < k*uAtlasSplit`. Past 4x the cap it still
    // throws by name rather than truncating.
    var SHARDS = 4;
    var maxLayers = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) | 0;
    var cap = (maxLayers > 0) ? maxLayers : layers;
    var split = Math.min(layers, cap);
    if (layers > split * SHARDS) {
      throw new Error('atlas needs ' + layers + ' layers; ' + SHARDS + ' ' + cap + '-layer TEXTURE_2D_ARRAYs ('
                    + (cap * SHARDS) + ' max) is not enough for this driver (D-379, D-589) — a fifth shard '
                    + 'is owed, not a threshold move');
    }
    L.atlasSplit = split;

    L.atlasTex = makeAtlasArray(gl, A, levels, 0, split);
    // Every further array always exists — real remainder when the atlas needed it, a harmless
    // 1-layer stand-in when it did not — so no sampler is ever an incomplete texture.
    L.atlasTex2 = makeAtlasArray(gl, A, levels, split, Math.max(1, Math.min(split, layers - split)));
    L.atlasTex3 = makeAtlasArray(gl, A, levels, 2 * split, Math.max(1, Math.min(split, layers - 2 * split)));
    L.atlasTex4 = makeAtlasArray(gl, A, levels, 3 * split, Math.max(1, Math.min(split, layers - 3 * split)));

    // Deliberately no anisotropic filtering: WebGPU has no portable equivalent, and D-3
    // requires the two backends to produce the same pixels.
    var err = gl.getError();
    if (err !== gl.NO_ERROR) throw new Error('atlas upload failed, gl error 0x' + err.toString(16));
    void atlasCanvas;   // the canvas form is debug-only; the GPU path uses A.mips
  }

  // ---------------------------------------------------------------------------
  // Meshes
  // ---------------------------------------------------------------------------

  /**
   * Vertex arenas (ARCH 9.2, D-86). One GL buffer + one VAO per arena; a section is a slot
   * inside it. Creating a mesh is bufferSubData into a buffer that already exists, and
   * destroying one is a free-list push — no glDeleteBuffer, no glDeleteVertexArray, which is
   * what removes the streaming hitch on an iGPU driver.
   */
  function initArenas() {
    L.arenas = new NS.Gfx.Arenas(function (quadCap) {
      var gl = L.gl;
      if (!gl || L.lost) return null;
      var vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, quadCap * NS.CFG.QUAD_BYTES, gl.DYNAMIC_DRAW);
      var vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.enableVertexAttribArray(0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribIPointer(0, 1, gl.UNSIGNED_INT, 8, 0);
      gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_INT, 8, 4);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, L.idxBuf);   // captured by the VAO
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      return { vbo: vbo, vao: vao, quadCap: quadCap };
    }, function (a) {
      var gl = L.gl;
      if (!gl) return;
      gl.deleteVertexArray(a.vao);
      gl.deleteBuffer(a.vbo);
      a.vao = null; a.vbo = null;
    });
  }

  /**
   * A SECOND arena pool, stride 16 instead of 8, for the model stream. It reuses the same
   * index buffer — a quad is four vertices either way — and the same generic Arenas
   * allocator, so the only thing that differs is the byte size and the attribute layout.
   */
  function initModelArenas() {
    L.modelArenas = new NS.Gfx.Arenas(function (quadCap) {
      var gl = L.gl;
      if (!gl || L.lost) return null;
      var vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, quadCap * NS.CFG.MODEL_QUAD_BYTES, gl.DYNAMIC_DRAW);
      var vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribIPointer(0, 4, gl.UNSIGNED_INT, NS.CFG.MODEL_VERTEX_BYTES, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, L.idxBuf);
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      return { vbo: vbo, vao: vao, quadCap: quadCap };
    }, function (a) {
      var gl = L.gl;
      if (!gl) return;
      gl.deleteVertexArray(a.vao);
      gl.deleteBuffer(a.vbo);
      a.vao = null; a.vbo = null;
    });
  }

  L.createSectionMesh = function (buf) {
    var gl = L.gl;
    if (!gl || L.lost) return null;
    var hdr = NS.Mesher.readHeader(buf);
    if (!hdr) return null;
    var q = hdr.quads;
    var total = q[0] + q[1] + q[2];
    // ⚠ A section with NO greedy quads can still have model geometry — a field of flowers over
    // a section that is otherwise all air, or a plains surface once grass_block moved onto the
    // model stream. Returning null here dropped it (D-130).
    var mqTotal = hdr.modelQuads ? (hdr.modelQuads[0] + hdr.modelQuads[1] + hdr.modelQuads[2] + hdr.modelQuads[3]) : 0;
    if (total <= 0 && mqTotal <= 0) return null;
    if (total > NS.CFG.MAX_QUADS) {
      // The mesher is supposed to split a section before this happens (ARCH §8). Clamp rather
      // than index past the shared index buffer, and say so.
      if (typeof console !== 'undefined') console.warn('MC-Lite: section mesh has ' + total +
        ' quads, over MAX_QUADS; the tail is dropped. The mesher should have split it.');
      var room = NS.CFG.MAX_QUADS;
      q = [Math.min(q[0], room), 0, 0];
      room -= q[0];
      q[1] = Math.min(hdr.quads[1], room); room -= q[1];
      q[2] = Math.min(hdr.quads[2], room);
      total = q[0] + q[1] + q[2];
    }

    var rec = total > 0 ? L.arenas.alloc(total) : null;
    if (total > 0 && !rec) return null;
    var base = rec ? rec.quadOfs : 0;
    if (rec) {
      gl.bindBuffer(gl.ARRAY_BUFFER, rec.arena.vbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, base * NS.CFG.QUAD_BYTES,
                       new Uint8Array(buf, NS.CFG.MESH_HEADER_BYTES, total * NS.CFG.QUAD_BYTES));
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }

    // ---- the model stream, if this section has any -----------------------------------
    // Allocated from its own pool and uploaded separately. A section with no model geometry
    // costs nothing here, which is why this stream could be added without touching a single
    // byte of what a stone chunk produces.
    var mq = hdr.modelQuads || [0, 0, 0, 0];
    var mTotal = mq[0] + mq[1] + mq[2] + mq[3];
    var mRec = null, mFirst = null;
    if (mTotal > 0) {
      if (!L.modelArenas) initModelArenas();
      if (mTotal > NS.CFG.MAX_QUADS) {
        if (typeof console !== 'undefined') console.warn('MC-Lite: section has ' + mTotal +
          ' model quads, over MAX_QUADS; the tail is dropped.');
        mq = [Math.min(mq[0], NS.CFG.MAX_QUADS), 0, 0, 0];
        mTotal = mq[0];
      }
      mRec = L.modelArenas.alloc(mTotal);
      if (mRec) {
        gl.bindBuffer(gl.ARRAY_BUFFER, mRec.arena.vbo);
        gl.bufferSubData(gl.ARRAY_BUFFER, mRec.quadOfs * NS.CFG.MODEL_QUAD_BYTES,
                         new Uint8Array(buf, hdr.modelOff[0], mTotal * NS.CFG.MODEL_QUAD_BYTES));
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        mFirst = [mRec.quadOfs, mRec.quadOfs + mq[0], mRec.quadOfs + mq[0] + mq[1], mRec.quadOfs + mq[0] + mq[1] + mq[2]];
      } else { mq = [0, 0, 0, 0]; mTotal = 0; }
    }

    L.meshCount++;
    return {
      rec: rec, vao: rec ? rec.arena.vao : null, vbo: rec ? rec.arena.vbo : null,
      batch: rec ? rec.id : -1,          // ARCH §9: the frontend groups draws by this
      quads: q,
      firstQuad: [base, base + q[0], base + q[0] + q[1]],
      modelRec: mRec,
      modelVao: mRec ? mRec.arena.vao : null,
      modelQuads: mq,
      modelFirst: mFirst,
      bytes: total * NS.CFG.QUAD_BYTES + mTotal * NS.CFG.MODEL_QUAD_BYTES
    };
  };

  L.destroySectionMesh = function (h) {
    if (!h || !L.gl) return;
    if (h.modelRec) { L.modelArenas.release(h.modelRec); h.modelRec = null; h.modelVao = null; }
    if (h.rec) { L.arenas.release(h.rec); h.rec = null; h.vao = null; h.vbo = null; }
    L.meshCount--;
  };

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  L.resize = function (w, h) {
    L.vw = Math.max(1, w | 0); L.vh = Math.max(1, h | 0);
    if (L.gl) L.gl.viewport(0, 0, L.vw, L.vh);
  };

  /**
   * setQuality({mipmaps}) — the only runtime-tunable renderer state (ARCH §9). Mip mapping is a
   * texture-cache win at distance and a small cost per fetch; on the very weakest tier the atlas
   * is small enough that turning it off is measurably cheaper, so the preset owns the choice.
   * The mip chain stays uploaded either way — this is a sampler state change, not a re-upload.
   */
  L.setQuality = function (q) {
    var gl = L.gl;
    if (!gl || L.lost || !L.atlasTex || !q) return;
    L.mipmaps = q.mipmaps !== false;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, L.atlasTex);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER,
                     L.mipmaps ? gl.NEAREST_MIPMAP_LINEAR : gl.NEAREST);
    [L.atlasTex2, L.atlasTex3, L.atlasTex4].forEach(function (t) {   // D-380/D-589 -- every shard's sampler tracks the first's
      if (!t) return;
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER,
                       L.mipmaps ? gl.NEAREST_MIPMAP_LINEAR : gl.NEAREST);
    });
  };

  // ── the biome tint map (PLAN W6) ────────────────────────────────────────────────────────
  //
  // A 256x256x3 RGBA8 array texture covering 1,024 blocks of world, filled by `NS.Tint` from
  // the biome array of each loaded chunk. LINEAR filtering is the whole point: it is what turns
  // a 4-block grid of biome colours into the soft border vanilla gets by averaging on the CPU.
  // CLAMP_TO_EDGE so that the moment before a re-anchor completes, the edge reads as its
  // neighbour rather than wrapping to the far side of the world.
  function createTintTexture(gl) {
    var N = NS.Gfx.TINT_TEXELS, LY = NS.Gfx.TINT_LAYERS;
    if (NS.Tint) NS.Tint.init();
    var tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, N, N, LY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    L.tintTex = tex;
    L.tintVersion = -1;
    // D-214: the map's writes drive the upload. Register as its sink and take the whole map as
    // dirty — this texture holds nothing yet. No flush here: the first beginFrame does it, and
    // uploading inside init would put a texSubImage3D between the atlas mips and their count.
    if (NS.Tint && NS.Tint.ready) { NS.Tint.sink = L.syncTint; NS.Tint.markDirty(0, 0, NS.Tint.SIZE - 1, NS.Tint.SIZE - 1); }
    gl.activeTexture(gl.TEXTURE0);
  }

  /**
   * Push the CPU copy to the GPU. Called by `NS.Tint.flush` the moment the bytes change
   * (D-214) and again from beginFrame as a safety net, so it must be cheap when there is
   * nothing to do and must upload only the map's dirty rectangle when there is.
   *
   * ⚠ The sub-box is fed by UNPACK_SKIP_PIXELS/SKIP_ROWS over the FULL array, not by slicing:
   * the three layers are plane-major and a rectangle out of them is not contiguous. All four
   * unpack parameters are put back afterwards — the atlas mips share this context.
   */
  L.syncTint = function () {
    var gl = L.gl, Tm = NS.Tint;
    if (!gl || L.lost || !Tm || !Tm.ready || !L.tintTex) return;
    if (L.tintVersion === Tm.version) return;
    var x0 = Tm.dirtyX0, z0 = Tm.dirtyZ0;
    var w = Tm.dirtyX1 - x0 + 1, h = Tm.dirtyZ1 - z0 + 1;
    if (w > 0 && h > 0) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, L.tintTex);
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, Tm.SIZE);
      gl.pixelStorei(gl.UNPACK_IMAGE_HEIGHT, Tm.SIZE);
      gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, x0);
      gl.pixelStorei(gl.UNPACK_SKIP_ROWS, z0);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, x0, z0, 0, w, h, Tm.LAYERS,
                       gl.RGBA, gl.UNSIGNED_BYTE, Tm.data);
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
      gl.pixelStorei(gl.UNPACK_IMAGE_HEIGHT, 0);
      gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
      gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
      gl.activeTexture(gl.TEXTURE0);
    }
    L.tintVersion = Tm.version;
    Tm.uploaded = Tm.version;
    Tm.clearDirty();
  };

  // ── PLAN G16b: the sky ────────────────────────────────────────────────────────────────────
  //
  // ⚠ WHAT IS DRAWN, IN VANILLA'S ORDER: the sky DISC above (the biome sky colour), the stars,
  // the sun, the moon, and the dark disc below. The clear colour is the FOG and the disc is the
  // SKY — two different colours, which is the whole reason `Gfx.updateSky` computes both.
  //
  // ⚠ DEPTH WRITES ARE OFF AND THE PASS RUNS FIRST. The sky is infinitely far away; writing it
  // into the depth buffer would let it occlude the world, and drawing it last would need a depth
  // test it cannot pass. Vanilla does the same thing for the same reason.
  //
  // ⚠ THE VIEW MATRIX IS ALREADY TRANSLATION-FREE (D-179) — `Cam.update` builds it at the origin
  // and the geometry arrives eye-relative — so the sky needs no special camera. That is a happy
  // accident of an unrelated decision, and it is written down so the next person does not "fix"
  // it by adding one.
  function skyBuffer(gl, data) {
    var b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return b;
  }

  function texFromSheet(gl, name) {
    var G = NS.Gui;
    var sh = G && G.sheets && G.sheets[name];
    if (!sh || !sh.canvas) return null;
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sh.canvas);
    // ⚠ NEAREST, like every other texture in this project: the sun is 32x32 and the moon's
    // phase cells are 32x32, and linear filtering would bleed one phase into the next.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  // ── PLAN G10d: the first-person hand (D-359) ──────────────────────────────────────────────
  /**
   * One dynamic vertex buffer and one VAO. The hand is a few hundred vertices rebuilt on the
   * CPU every frame — the pose changes every frame while you move, so a cached buffer would be
   * re-uploaded every frame anyway and would cost an extra copy for nothing.
   *
   * ⚠ THE SKIN TEXTURE IS UPLOADED ONCE AND IS NOT THE ATLAS. An empty hand is the player's arm
   * out of `Gui.sheets.steve`; a held item is the block atlas array. Both are bound for the whole
   * pass and the vertex decides which, so a swing with a block in hand and a swing with an empty
   * hand are the same two draw calls with the same state.
   */
  function initHand(gl) {
    // ⚠⚠ **THE HAND MUST NOT BE ABLE TO TAKE THE WORLD DOWN WITH IT.** `L.init` wraps its whole
    // body in one try/catch that calls `destroy()` and returns false, so an exception raised here
    // would leave the backend with no arenas and the game with no picture at all — which is
    // exactly the class D-310 described from the other side, where one failed texture killed the
    // boot. The hand is a decoration on a working renderer; it fails alone, loudly, in
    // `L.handFailReason`, and `shadercheck`'s recording stub found this within a minute.
    try { initHandInner(gl); }
    catch (e) { L.hand = null; L.handFailReason = (e && e.message) || String(e); }
  }

  function initHandInner(gl) {
    L.hand = {
      buf: gl.createBuffer(),
      vao: gl.createVertexArray(),
      cap: 0,
      skin: texFromSheet(gl, 'steve'),
      proj: new Float32Array(16)
    };
    // ⚠ THE LOCATIONS ARE ASKED FOR, NOT ASSUMED. `link` binds only `aData0` and `aData1` by
    // hand, so every other attribute in this backend gets whatever the driver assigns — and a
    // hard-coded 0..3 here works on one driver and silently draws nothing on the next.
    var STRIDE = 10 * 4;
    var loc = function (n) { return gl.getAttribLocation(L.progHand, n); };
    var A = { pos: loc('aPos'), uv: loc('aUV'), info: loc('aInfo'), tint: loc('aTint') };
    L.hand.attribs = A;
    gl.bindVertexArray(L.hand.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, L.hand.buf);
    var bind = function (l, size, off) {
      if (l < 0) return;
      gl.enableVertexAttribArray(l);
      gl.vertexAttribPointer(l, size, gl.FLOAT, false, STRIDE, off);
    };
    bind(A.pos, 3, 0);        // x y z
    bind(A.uv, 2, 12);        // u v
    bind(A.info, 2, 20);      // layer, shade
    bind(A.tint, 3, 28);      // r g b
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  /**
   * Draw the hand. `frame` is `{ verts, floats, quads, arm }` from `NS.Hand3D.build`, plus the
   * projection the caller built.
   *
   * ⚠⚠ **THE DEPTH BUFFER IS CLEARED FIRST, AND THAT IS VANILLA'S OWN CALL** — `RenderSystem
   * .clear(256)` immediately before `renderItemInHand`, read out of `GameRenderer.renderLevel`
   * (class `eql`). Without it the hand is clipped by whatever you are standing against, so
   * walking up to a wall eats your arm. With it the hand is always in front and nothing else in
   * the frame is disturbed, because the colour buffer is untouched.
   */
  L.drawHand = function (frame) {
    var gl = L.gl;
    if (!gl || L.lost || !frame || !L.hand || !L.hand.vao || !L.progHand) return;
    var total = (frame.floats || 0) + (frame.arm ? frame.arm.floats : 0);
    if (!total) return;
    var data = L.handScratch;
    if (!data || data.length < total) { data = L.handScratch = new Float32Array(Math.max(4096, total * 2)); }
    var n = 0;
    if (frame.floats) { data.set(frame.verts.subarray(0, frame.floats), 0); n = frame.floats; }
    if (frame.arm && frame.arm.floats) { data.set(frame.arm.verts.subarray(0, frame.arm.floats), n); n += frame.arm.floats; }

    gl.bindVertexArray(L.hand.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, L.hand.buf);
    if (L.hand.cap < n) {
      L.hand.cap = Math.max(4096, n * 2);
      gl.bufferData(gl.ARRAY_BUFFER, L.hand.cap * 4, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, n));

    gl.useProgram(L.progHand);
    L.curProg = L.progHand;
    gl.uniformMatrix4fv(L.locHand.uProj, false, frame.proj);
    gl.uniform1i(L.locHand.uAtlas, 0);
    gl.uniform1i(L.locHand.uAtlas2, 3);            // D-380
    gl.uniform1i(L.locHand.uAtlas3, 4);            // D-589
    gl.uniform1i(L.locHand.uAtlas4, 5);
    gl.uniform1f(L.locHand.uAtlasSplit, L.atlasSplit);
    gl.uniform1i(L.locHand.uSkin, 2);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, L.hand.skin);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, L.atlasTex);

    // ⚠ depthMask(true) MUST precede the clear: gl.clear honours the depth write mask, and the
    // translucent passes before us leave it false - then the clear is a silent no-op and the
    // world's depth clips the hand (#4694). Scissor would also limit the clear.
    gl.depthMask(true);
    gl.disable(gl.SCISSOR_TEST);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);
    // ⚠ CULLING OFF. A held sprite item is a ONE-PIXEL-DEEP extrusion and vanilla draws it from
    // both sides; more to the point, the pose can mirror the model (a left-hand transform) and a
    // mirrored model is entirely backfaces. Culling here is how a hand becomes invisible at
    // certain swing angles only, which is the worst kind of bug to reproduce.
    gl.disable(gl.CULL_FACE);
    gl.drawArrays(gl.TRIANGLES, 0, n / 10);
    gl.enable(gl.CULL_FACE);
    gl.bindVertexArray(null);
    L.handVerts = n / 10;
  };

  function initSky(gl) {
    var Sky = NS.Sky;
    if (!Sky || !Sky.buildSkyDisc) { L.sky = null; return; }
    var stars = Sky.buildStars();
    if (!stars) { L.sky = null; return; }
    // ⚠ THE STARS ARE QUADS AND WEBGL2 HAS NO QUAD PRIMITIVE, so they need an index buffer:
    // 0,1,2, 0,2,3 per star. The backend already builds one for the world's quads, but that one
    // is sized for the mesh arenas — this is its own, and it is built once.
    var quads = stars.length / 12;
    var idx = new Uint32Array(quads * 6);
    for (var q = 0; q < quads; q++) {
      var v = q * 4, o = q * 6;
      idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2;
      idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3;
    }
    var starIdx = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, starIdx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

    var UV = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
    // D-415 — the RING mesh, not the nine-vertex fan. `Sky.buildSkyDiscMesh`'s header says why:
    // the fan's centre vertex projects with w = 0 at a level camera, so nothing can be
    // interpolated across its triangles, and the horizon fade is exactly such an interpolation.
    var discMesh = Sky.buildSkyDiscMesh(Sky.SKY_DISC_Y);
    var darkMesh = Sky.buildSkyDiscMesh(Sky.DARK_DISC_Y);
    L.sky = {
      disc: skyBuffer(gl, discMesh),
      dark: skyBuffer(gl, darkMesh),
      discVerts: discMesh.length / 3,
      darkVerts: darkMesh.length / 3,
      stars: skyBuffer(gl, stars),
      starIdx: starIdx,
      starQuads: quads,
      sun: skyBuffer(gl, Sky.celestialQuad(Sky.SUN_SIZE, Sky.CELESTIAL_DIST)),
      moon: skyBuffer(gl, Sky.celestialQuad(Sky.MOON_SIZE, -Sky.CELESTIAL_DIST)),
      uv: skyBuffer(gl, UV),
      moonUV: gl.createBuffer(),
      sunTex: texFromSheet(gl, 'sun'),
      moonTex: texFromSheet(gl, 'moon_phases'),
      model: new Float32Array(16),
      identity: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
      lastPhase: -1
    };
    if (Sky.endSkyTriangles) {
      var eb = Sky.endSkyTriangles(), et = Sky.endSkyTexture();
      L.sky.endPos = skyBuffer(gl, eb.pos);
      L.sky.endUV = skyBuffer(gl, eb.uv);
      L.sky.endVerts = eb.verts;
      L.sky.endTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, L.sky.endTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, et.w, et.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, et.data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  /** bind aPos (and optionally aUV) for the sky program */
  function skyAttribs(gl, pos, uv) {
    var p = gl.getAttribLocation(L.progSky, 'aPos');
    var u = gl.getAttribLocation(L.progSky, 'aUV');
    gl.bindBuffer(gl.ARRAY_BUFFER, pos);
    gl.enableVertexAttribArray(p);
    gl.vertexAttribPointer(p, 3, gl.FLOAT, false, 0, 0);
    if (uv) {
      gl.bindBuffer(gl.ARRAY_BUFFER, uv);
      gl.enableVertexAttribArray(u);
      gl.vertexAttribPointer(u, 2, gl.FLOAT, false, 0, 0);
    } else {
      gl.disableVertexAttribArray(u);
      gl.vertexAttrib2f(u, 0, 0);
    }
  }

  L.drawSky = function (state) {
    var gl = L.gl, S = L.sky, Sky = NS.Sky;
    if (!gl || L.lost || !S || !Sky || !Sky.ready || !state.skyFrame) return 0;
    var f = state.skyFrame;
    var draws = 0;

    gl.useProgram(L.progSky);
    L.curProg = L.progSky;
    L.curVao = null;
    gl.bindVertexArray(null);
    var loc = L.locSky;
    // ⚠ `state.skyViewProj`, NOT `state.viewProj` (D-304). The world's far plane is the fog
    // wall — 76.8 blocks at the Celeron preset — and the sun and moon sit at 100, so with the
    // world matrix they were clipped away entirely on the bottom rung of the hardware ladder.
    gl.uniformMatrix4fv(loc.uViewProj, false, state.skyViewProj || state.viewProj);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(loc.uSkyTex, 0);
    // D-415 — the horizon fade needs the same fog colour the world pass uses, and vanilla's
    // FOG_SKY end (start 0, end = the render-distance wall). `Settings.horizonFade` off passes
    // an end of 0, which the shader's `max(1.0, …)` turns into "fog everywhere"… so the SWITCH
    // is `uSkyMode.y`, not the distance: off means no fog term at all and the old hard seam.
    var skyFogOn = (NS.Settings && NS.Settings.horizonFade === false) ? 0 : 1;
    var skyFogEnd = state.fogFar || 128;
    if (loc.uFogCol) gl.uniform4f(loc.uFogCol, state.fogR, state.fogG, state.fogB, 1);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // The End: WorldRenderer.renderEndSky - the textured box (colour 40/255 grey), no disc/sun/moon/stars.
    if (f.skyType === 'end' && S.endTex) {
      gl.disable(gl.BLEND);
      gl.bindTexture(gl.TEXTURE_2D, S.endTex);
      gl.uniformMatrix4fv(loc.uModel, false, S.identity);
      gl.uniform4f(loc.uSkyMode, 1, 0, 0, 0);
      var g = NS.Sky.END_SKY_GREY / 255;
      gl.uniform4f(loc.uSkyColor, g, g, g, 1);
      skyAttribs(gl, S.endPos, S.endUV);
      gl.drawArrays(gl.TRIANGLES, 0, S.endVerts);
      gl.depthMask(true);
      gl.enable(gl.CULL_FACE);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, null);
      L.curProg = null;
      L.skyDraws = 1;
      return 1;
    }

    // 1. the sky disc, in the BIOME's sky colour
    gl.uniformMatrix4fv(loc.uModel, false, S.identity);
    gl.uniform4f(loc.uSkyMode, 0, skyFogOn, skyFogEnd, 0);
    gl.uniform4f(loc.uSkyColor, f.sky[0], f.sky[1], f.sky[2], 1);
    skyAttribs(gl, S.disc, null);
    gl.drawArrays(gl.TRIANGLES, 0, S.discVerts);
    draws++;

    // D-657: the sunrise/sunset fan (Sky.sunriseFan, WorldRenderer.java:1859-1887) — after the sky
    // disc, before the sun/moon/stars, default blend, no fog, in the disc's own (unrotated) space.
    L.sunriseDrawn = 0;
    var fan = f.sunrise;
    if (fan) {
      if (!S.fanPos) { S.fanPos = gl.createBuffer(); S.fanW = gl.createBuffer(); }
      gl.bindBuffer(gl.ARRAY_BUFFER, S.fanPos);
      gl.bufferData(gl.ARRAY_BUFFER, fan.pos, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, S.fanW);
      gl.bufferData(gl.ARRAY_BUFFER, fan.weight, gl.DYNAMIC_DRAW);
      gl.uniform4f(loc.uSkyMode, 2, 0, 0, 0);
      gl.uniform4f(loc.uSkyColor, fan.color[0], fan.color[1], fan.color[2], fan.color[3]);
      skyAttribs(gl, S.fanPos, S.fanW);
      gl.drawArrays(gl.TRIANGLES, 0, fan.verts);
      draws++;
      L.sunriseDrawn = fan.verts / 3;
    }

    // 2. the celestial bodies, in the frame that turns once a day
    Sky.celestialMatrix(S.model, Sky.dayTime);
    gl.uniformMatrix4fv(loc.uModel, false, S.model);

    // ⚠ ADDITIVE, LIKE VANILLA (`SRC_ALPHA, ONE`). The stars and the sun ADD light to the sky
    // rather than covering it, which is why a star over a bright horizon disappears instead of
    // punching a hole in it.
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    var star = f.starBrightness;
    if (star > 0 && S.starQuads > 0) {
      gl.uniform4f(loc.uSkyMode, 0, 0, 0, 0);
      gl.uniform4f(loc.uSkyColor, star, star, star, star);
      skyAttribs(gl, S.stars, null);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, S.starIdx);
      gl.drawElements(gl.TRIANGLES, S.starQuads * 6, gl.UNSIGNED_INT, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
      draws++;
    }

    // ⚠ THE SUN AND MOON FADE WITH RAIN, NOT WITH THE TIME OF DAY. Vanilla's alpha here is
    // `1 - rainLevel`: they are always up there, and a storm is what hides them.
    var a = f.celestial === false ? 0 : 1 - f.rain;
    if (a > 0.01) {
      if (S.sunTex) {
        gl.bindTexture(gl.TEXTURE_2D, S.sunTex);
        gl.uniform4f(loc.uSkyMode, 1, 0, 0, 0);
        gl.uniform4f(loc.uSkyColor, 1, 1, 1, a);
        skyAttribs(gl, S.sun, S.uv);
        gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
        draws++;
      }
      if (S.moonTex) {
        // the phase picks one cell of the 4x2 grid, and the UVs only change when it does
        if (S.lastPhase !== f.moonPhase) {
          var uv = Sky.moonUV(f.moonPhase);
          gl.bindBuffer(gl.ARRAY_BUFFER, S.moonUV);
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            uv[0], uv[1], uv[2], uv[1], uv[2], uv[3], uv[0], uv[3]
          ]), gl.DYNAMIC_DRAW);
          S.lastPhase = f.moonPhase;
        }
        gl.bindTexture(gl.TEXTURE_2D, S.moonTex);
        gl.uniform4f(loc.uSkyMode, 1, 0, 0, 0);
        gl.uniform4f(loc.uSkyColor, 1, 1, 1, a);
        skyAttribs(gl, S.moon, S.moonUV);
        gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
        draws++;
      }
    }

    // 3. the dark disc below, so there is no hole under the world
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniformMatrix4fv(loc.uModel, false, S.identity);
    gl.uniform4f(loc.uSkyMode, 0, skyFogOn, skyFogEnd, 0);
    gl.uniform4f(loc.uSkyColor, f.fog[0], f.fog[1], f.fog[2], 1);
    skyAttribs(gl, S.dark, null);
    gl.drawArrays(gl.TRIANGLES, 0, S.darkVerts);
    draws++;

    // hand the pipeline back exactly as it was found. ⓘ The block atlas is a TEXTURE_2D_ARRAY
    // and the sun is a TEXTURE_2D, so they are different binding points on the same unit and
    // the world's texture was never in danger — but leaving a stale 2D binding on unit 0 is a
    // trap for the next pass that adds a 2D sampler, so it goes back to null.
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);
    L.curProg = null;
    L.skyDraws = draws;
    return draws;
  };

  // #1329: re-upload the dynamic-pool layers Atlas.dynWrite marked dirty, every mip level, into
  // whichever shard holds the layer.
  function syncAtlasDyn(gl) {
    var A = NS.Atlas;
    if (!A || !A.dynDrain || !L.atlasSplit) return;
    var shards = [L.atlasTex, L.atlasTex2, L.atlasTex3, L.atlasTex4];
    A.dynDrain(function (tile) {
      var k = (tile / L.atlasSplit) | 0, local = tile - k * L.atlasSplit;
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, shards[k]);
      for (var l = 0; l < A.mips.length; l++) {
        var m = A.mips[l], stride = m.size * m.size * 4;
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, l, 0, 0, local, m.size, m.size, 1,
                         gl.RGBA, gl.UNSIGNED_BYTE, m.data.subarray(tile * stride, (tile + 1) * stride));
      }
    });
  }
  L.syncAtlasDyn = syncAtlasDyn;

  L.beginFrame = function (state) {
    var gl = L.gl;
    if (!gl || L.lost) return;
    gl.activeTexture(gl.TEXTURE0);
    syncAtlasDyn(gl);
    // #2571: syncAtlasDyn, setQuality and the particle pass bind 2D_ARRAYs on the active unit (0);
    // drawHand put the atlas back only when a hand was drawn. Re-establish every atlas unit here.
    [L.atlasTex2, L.atlasTex3, L.atlasTex4, L.atlasTex].forEach(function (t, i) {
      gl.activeTexture(i === 3 ? gl.TEXTURE0 : gl.TEXTURE3 + i);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
    });
    L.state = state;
    L.frameUploaded.main = false;
    L.frameUploaded.model = false;
    L.frameUploaded.flat = false;
    L.syncTint();
    L.pass = '';
    L.curProg = null;

    L.curVao = null;
    L.binds = 0;
    gl.viewport(0, 0, L.vw, L.vh);
    gl.colorMask(true, true, true, true);
    gl.depthMask(true);
    gl.clearColor(state.fogR, state.fogG, state.fogB, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // PLAN G16b — the sky goes down first, with depth writes off (D-303).
    L.drawSky(state);
  };

  function useProgram(which) {
    var gl = L.gl;
    var locs = which === 'flat' ? L.locFlat : which === 'model' ? L.locModel : L.locMain;
    if (L.curProg !== locs.prog) {
      gl.useProgram(locs.prog);
      L.curProg = locs.prog;
    }
    L.cur = locs;
    if (!L.frameUploaded[which]) {
      var s = L.state;
      gl.uniformMatrix4fv(locs.uViewProj, false, s.viewProj);
      if (locs.uCamTime) gl.uniform4f(locs.uCamTime, s.camX, s.camY, s.camZ, s.time);
      if (locs.uFogCol)  gl.uniform4f(locs.uFogCol, s.fogR, s.fogG, s.fogB, s.fogNear);
      if (locs.uParams)  gl.uniform4f(locs.uParams, s.fogFar, s.skyScale, Math.min(s.skyDarkness || 0, 0.999) + Math.round(255 * (s.nightVision || 0)), s.gamma === undefined ? 0.5 : s.gamma);
      if (locs.uAmb)     gl.uniform1f(locs.uAmb, s.ambient === undefined ? 0.06 : s.ambient);
      if (locs.uAtlas)   gl.uniform1i(locs.uAtlas, 0);
      if (locs.uAtlas2)  gl.uniform1i(locs.uAtlas2, 3);          // D-380
      if (locs.uAtlas3)  gl.uniform1i(locs.uAtlas3, 4);          // D-589
      if (locs.uAtlas4)  gl.uniform1i(locs.uAtlas4, 5);
      if (locs.uAtlasSplit) gl.uniform1f(locs.uAtlasSplit, L.atlasSplit);
      if (locs.uTintMap) gl.uniform1i(locs.uTintMap, 1);
      if (locs.uTint) {
        var Tm = NS.Tint;
        var live = (Tm && Tm.ready && L.tintTex) ? 1 : 0;
        // ⚠ the shader reads `(wp.xz - uTint.xy)`, and wp is eye-relative since D-179, so the
        // map's world origin has to move into that space too or the tint slides off the world.
        // The subtraction is a double here and a small float in the uniform.
            gl.uniform4f(locs.uTint, live ? Tm.originX - s.eyeX : 0, live ? Tm.originZ - s.eyeZ : 0,
                     live ? 1 / NS.Gfx.TINT_TEXELS : 0, live);
      }
      if (locs.uFlat)    gl.uniform4f(locs.uFlat, 0.15, 1.0, 0.45, 1.0);
      L.frameUploaded[which] = true;
    }
  }

  /**
   * Pass state. depthFunc is LEQUAL for the shaded passes so the SAME pipeline state works with
   * and without the depth prepass — no second program variant, no toggling bugs (D-53).
   */
  L.setPass = function (pass) {
    var gl = L.gl;
    if (!gl || L.lost) return;
    L.pass = pass;
    L.wire = (pass === 'wire');
    switch (pass) {
      case 'depth':
        useProgram('flat');
        gl.colorMask(false, false, false, false);
        gl.depthMask(true);
        gl.depthFunc(gl.LESS);
        gl.disable(gl.BLEND);
        gl.enable(gl.CULL_FACE);
        L.layerMode = 0;
        break;
      case 'opaque':
        useProgram('main');
        gl.colorMask(true, true, true, true);
        gl.depthMask(true);
        gl.depthFunc(gl.LEQUAL);
        gl.disable(gl.BLEND);
        gl.enable(gl.CULL_FACE);
        L.layerMode = 0;
        break;
      case 'cutout':
        useProgram('main');
        gl.colorMask(true, true, true, true);
        gl.depthMask(true);
        gl.depthFunc(gl.LEQUAL);
        gl.disable(gl.BLEND);
        gl.enable(gl.CULL_FACE);
        L.layerMode = 1;
        break;
      case 'translucent':
        useProgram('main');
        gl.colorMask(true, true, true, true);
        gl.depthMask(false);
        gl.depthFunc(gl.LEQUAL);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.disable(gl.CULL_FACE);      // water is visible from underneath
        L.layerMode = 2;
        break;
      case 'additive':    // #2627: vanilla getEnergySwirl -- ONE,ONE, no depth write, no cull, scrolling UV (mode 3)
        useProgram('main');
        gl.colorMask(true, true, true, true);
        gl.depthMask(false);
        gl.depthFunc(gl.LEQUAL);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.disable(gl.CULL_FACE);
        L.layerMode = 3;
        break;
      case 'watermask':   // #5723: vanilla getWaterMask -- depth write, no colour (BoatEntityRenderer water_patch)
        useProgram('main');
        gl.colorMask(false, false, false, false);
        gl.depthMask(true);
        gl.depthFunc(gl.LEQUAL);
        gl.disable(gl.BLEND);
        gl.disable(gl.CULL_FACE);
        L.layerMode = 0;
        break;
      case 'decal':       // #1850: vanilla DRAGON_DECAL -- same geometry, depth EQUAL, no depth write
        useProgram('main');
        gl.colorMask(true, true, true, true);
        gl.depthMask(false);
        gl.depthFunc(gl.EQUAL);
        gl.disable(gl.BLEND);
        gl.enable(gl.CULL_FACE);
        L.layerMode = 1;
        break;
      case 'wire':
        useProgram('flat');
        gl.colorMask(true, true, true, true);
        gl.depthMask(false);
        gl.depthFunc(gl.LEQUAL);
        gl.disable(gl.BLEND);
        gl.disable(gl.CULL_FACE);
        L.layerMode = 0;
        break;
    }
  };

  /** Returns the TRIANGLES actually submitted, 0 if nothing was (D-194 — the frontend counts this). */
  L.drawSection = function (h, ox, oy, oz, layer) {
    var gl = L.gl;
    if (!gl || L.lost || !h) return 0;
    var n = h.quads[layer];
    if (!n) return 0;
    // One bind per ARENA, not per section (D-86). The frontend groups the draw list by
    // h.batch inside each distance band, so this is a cache hit for most of the frame.
    if (L.curVao !== h.vao) { gl.bindVertexArray(h.vao); L.curVao = h.vao; L.binds++; }
    gl.uniform4f(L.cur.uOrigin, ox, oy, oz, L.layerMode);
    if (L.wire) {
      gl.drawElements(gl.LINES, n * 8, gl.UNSIGNED_SHORT, L.triIndexBytes + h.firstQuad[layer] * 16);
    } else {
      gl.drawElements(gl.TRIANGLES, n * 6, gl.UNSIGNED_SHORT, h.firstQuad[layer] * 12);
    }
    return n * 2;
  };

  /**
   * Draw a section's MODEL quads for one layer. Separate from drawSection because it needs
   * a different program and a different VAO, and because the frontend can then skip it
   * entirely for a world that has none — which is every world until the mesher starts
   * emitting them.
   *
   * ⚠ It swaps the program, so the caller must put the pass state back before drawing more
   * cube geometry. L.setPass(L.pass) does that, and endModelPass() is the shorthand.
   */
  /** Returns the TRIANGLES actually submitted, 0 if nothing was (D-194). */
  L.drawSectionModels = function (h, ox, oy, oz, layer) {
    var gl = L.gl;
    if (!gl || L.lost || !h || !h.modelFirst) return 0;
    var n = h.modelQuads[layer];
    if (!n) return 0;
    if (L.curProg !== (L.locModel && L.locModel.prog)) useProgram('model');
    if (L.curVao !== h.modelVao) { gl.bindVertexArray(h.modelVao); L.curVao = h.modelVao; L.binds++; }
    gl.uniform4f(L.cur.uOrigin, ox, oy, oz, L.layerMode);
    gl.drawElements(gl.TRIANGLES, n * 6, gl.UNSIGNED_SHORT, h.modelFirst[layer] * 12);
    return n * 2;
  };

  /**
   * #2571: unbind the section VAO before the self-contained passes in G.render's hook slot (leash,
   * particles, weather, orbs, crystal beams). They own no VAO and call bindBuffer(ELEMENT_ARRAY_BUFFER)
   * and vertexAttribPointer on whatever is bound -- which was the last arena drawn, so its uint
   * attributes became float pointers into a particle buffer and every section in that arena (up to
   * 48) failed to draw until a remesh moved it: Dan's random black / invisible regions.
   */
  L.releaseVao = function () {
    if (L.gl && !L.lost) L.gl.bindVertexArray(null);
    L.curVao = null;
  };

  /** Put the cube program back after a run of model draws. */
  /** #1851 — blend factors of the colour-ray layer (vanilla LIGHTNING_TRANSPARENCY), named so tools/raylayercheck.mjs can read them. */
  L.RAY_BLEND = { src: 'SRC_ALPHA', dst: 'ONE' };

  /**
   * Draw `count` triangles of the colour-ray layer (`verts`: Float32Array, G.RAY_FLOATS per vertex,
   * eye-relative). Additive, untextured, depth tested but not written; leaves the state the
   * entity pass expects. Returns the triangles drawn.
   */
  L.drawColourRays = function (verts, count) {
    var gl = L.gl;
    if (!gl || L.lost || !L.progRay || !count || !L.state) return 0;
    var loc = L.locRay;
    if (loc.aPos === undefined) { loc.aPos = gl.getAttribLocation(L.progRay, 'aPos'); loc.aColor = gl.getAttribLocation(L.progRay, 'aColor'); }
    if (!L.rayBuf) L.rayBuf = gl.createBuffer();
    gl.useProgram(L.progRay);
    L.curProg = null;
    gl.bindVertexArray(null);
    L.curVao = null;
    gl.uniformMatrix4fv(loc.uViewProj, false, L.state.viewProj);
    gl.bindBuffer(gl.ARRAY_BUFFER, L.rayBuf);
    gl.bufferData(gl.ARRAY_BUFFER, verts.subarray(0, count * 3 * 7), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(loc.aPos);
    gl.vertexAttribPointer(loc.aPos, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(loc.aColor);
    gl.vertexAttribPointer(loc.aColor, 4, gl.FLOAT, false, 28, 12);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl[L.RAY_BLEND.src], gl[L.RAY_BLEND.dst]);
    gl.drawArrays(gl.TRIANGLES, 0, count * 3);
    gl.disableVertexAttribArray(loc.aPos);
    gl.disableVertexAttribArray(loc.aColor);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    return count;
  };

  L.endModelPass = function () {
    if (L.pass && L.pass !== 'wire' && L.pass !== 'depth') useProgram('main');
  };

  L.endFrame = function () {
    var gl = L.gl;
    if (!gl || L.lost) return;
    gl.bindVertexArray(null);
    L.curVao = null;
    if (L.pending) {
      var p = L.pending;
      L.pending = null;
      try {
        var px = new Uint8Array(p.w * p.h * 4);
        // GL's read origin is bottom-left of the drawing buffer; the requested rect is
        // top-left of the VIEWPORT, which is what the WebGPU backend also returns.
        gl.readPixels(p.x, L.vh - (p.y + p.h), p.w, p.h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        p.resolve(flipRows(px, p.w, p.h));
      } catch (e) { p.reject(e); }
    }
  };

  function flipRows(px, w, h) {
    var out = new Uint8Array(px.length), row = w * 4;
    for (var y = 0; y < h; y++) out.set(px.subarray((h - 1 - y) * row, (h - y) * row), y * row);
    return out;
  }

  /**
   * capture(x,y,w,h) -> Promise<Uint8Array>  (RGBA, rows top-down, viewport-relative)
   * Fulfilled after the NEXT endFrame. Used by Gfx.selfTest (D-3).
   */
  L.capture = function (x, y, w, h) {
    return new Promise(function (resolve, reject) {
      L.pending = { x: x | 0, y: y | 0, w: w | 0, h: h | 0, resolve: resolve, reject: reject };
    });
  };

  /**
   * ⚠⚠ **`getParameter` IS A PIPELINE STALL, AND THE F3 OVERLAY WAS CALLING SIX OF THEM EVERY
   * FRAME — D-434.** `gl.getParameter` is a synchronous query: the driver must finish what it
   * has queued before it can answer. `Hud.drawDebug` calls `info()` once a frame whenever F3 is
   * open, and the F4 diagnostics panel (D-431) inherited the same call.
   * ▶ **MEASURED, on the headless box at render distance 12: `info()` 119.5 ms.** For comparison,
   * in the same probe `World.stats()` — which walks every section of every resident chunk — was
   * 0.3 ms, `World.biomeAt` 0 ms, `Jobs.stats()` 0 ms. One line was 99% of the cost of drawing
   * the debug overlay, and pressing F3 has been stalling the pipeline every frame since it was
   * written. Nothing measured it, because nothing was measuring the overlay.
   * ▶ **THE F4 PANEL IS WHAT FOUND IT**, on its first real run, through its own §6: *"what does
   * this panel cost the frame it is measuring"*. That is the whole argument for building it.
   *
   * ▶ THE FIX IS THE SPLIT THE DATA ALREADY HAS. `vendor`, `renderer`, `glsl`, `maxTexSize` and
   * `maxLayers` are properties of a CONTEXT and cannot change while it lives, so they are read
   * ONCE and kept; a context loss drops the cache (`L.lost` → `L.staticInfo = null` in the
   * restore path). Everything else on this object is a counter this module already holds in a
   * field and costs nothing.
   */
  L.info = function () {
    var gl = L.gl;
    if (!gl) return { backend: 'webgl2', ok: false, reason: L.failReason };
    if (!L.staticInfo) {
      var dbg = gl.getExtension('WEBGL_debug_renderer_info');
      L.staticInfo = {
        vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        glsl: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
        maxTexSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
        maxLayers: gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS)
      };
    }
    var st = L.staticInfo;
    return {
      backend: 'webgl2',
      ok: !L.lost,
      vendor: st.vendor,
      renderer: st.renderer,
      glsl: st.glsl,
      maxTexSize: st.maxTexSize,
      maxLayers: st.maxLayers,
      atlasSplit: L.atlasSplit | 0,             // D-380
      atlasShards: (L.atlasTex && L.atlasSplit > 0) ? Math.ceil((NS.Atlas ? NS.Atlas.tiles : 0) / L.atlasSplit) || 1 : 1,
      meshes: L.meshCount,
      arenas: L.arenas ? L.arenas.count : 0,
      arenaMB: L.arenas ? +(L.arenas.bytes / 1048576).toFixed(1) : 0,
      binds: L.binds | 0,
      mipmaps: L.mipmaps !== false
    };
  };

  L.destroy = function () {
    var gl = L.gl;
    if (!gl) return;
    if (L.arenas) { L.arenas.destroyAll(); L.arenas = null; }
    if (L.progModel) gl.deleteProgram(L.progModel);
    if (L.progMain) gl.deleteProgram(L.progMain);
    if (L.progFlat) gl.deleteProgram(L.progFlat);
    if (L.progSky) gl.deleteProgram(L.progSky);
    if (L.idxBuf) gl.deleteBuffer(L.idxBuf);
    if (L.atlasTex) gl.deleteTexture(L.atlasTex);
    if (L.atlasTex2) gl.deleteTexture(L.atlasTex2);   // D-380
    if (L.atlasTex3) gl.deleteTexture(L.atlasTex3);   // D-589
    if (L.atlasTex4) gl.deleteTexture(L.atlasTex4);
    L.progMain = L.progFlat = L.progModel = L.progSky = L.idxBuf = L.atlasTex = L.atlasTex2 = L.atlasTex3 = L.atlasTex4 = null;
    L.atlasSplit = 0;
    L.sky = null;
    L.modelArenas = null;
  };
})(MCL);
