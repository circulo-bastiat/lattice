#!/usr/bin/env node
// skygpucheck.mjs — KW-24: the WebGPU backend's sky pass.
//
//   node tools/skygpucheck.mjs [--verbose]
//
// ⚠ KW-1 MEANS THIS CANNOT BE A BROWSER CHECK LIKE `skyviewcheck.mjs`. WebGPU renders a black
// world on real hardware today (KW-1), and even where it doesn't, headless Chromium here has
// `navigator.gpu` and NO REAL ADAPTER (backendcheck.mjs's own finding) — `requestAdapter()`
// resolves null. `shadercheck.mjs` solved the same problem for the rest of the WebGPU backend by
// running the real source against a MOCK `GPUDevice`, close enough to the spec that every method
// this backend calls exists and every call is recorded; this file does the same for the one
// thing shadercheck's own mock never had a reason to exercise — a backend that loads `09b_sky.js`
// and actually has a `P.sky` to draw.
//
// ⚠⚠ THIS FILE EXISTS BECAUSE A CHECK THAT CANNOT FAIL DOES NOT COUNT. It would be easy to assert
// only "P.pipelines.skyAlpha exists" — true the moment the pipeline is CREATED, whether or not it
// is ever drawn with the right data. Every assertion below instead pins a REAL wrote-to-the-GPU
// fact: which pipeline drew which slot, in what order, and what `writeBuffer` actually put in the
// dynamic-offset ring for that slot — and several of them are `okAv`: the DATA is broken on
// purpose (full rain, no light, a decoy view matrix, `Sky.ready = false`) and the assertion is
// that the draw list visibly changes, which a `drawSky` that ignored its input could not do.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERBOSE = process.argv.includes('--verbose');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m, detail) => {
  if (c) { pass++; if (VERBOSE) console.log('ok    ' + m); }
  else { fails.push(m + (detail !== undefined ? ' -- ' + detail : '')); console.log('FAIL  ' + m + (detail !== undefined ? '\n      ' + detail : '')); }
  return c;
};
const okAv = (c, m, detail) => {
  breaks++;
  if (c) { pass++; console.log('   ✓ ' + m); }
  else { fails.push('anti-vacuity: ' + m + (detail !== undefined ? ' -- ' + detail : '')); console.log('FAIL  anti-vacuity: ' + m + (detail !== undefined ? '\n      ' + detail : '')); }
  return c;
};

console.log('skygpucheck — KW-24, the WebGPU sky pass (real pipelines, real data, a mock device)');

// ---------------------------------------------------------------------------
// A mock GPUDevice, sized for exactly what 11_gfx_webgpu.js's sky pass calls. Unlike
// shadercheck.mjs's own mock (which never issues a non-indexed `draw`, because nothing it tests
// needed one before KW-24), this records BOTH `draw` and `drawIndexed`, and folds each one's
// pipeline label and dynamic offset into a single ordered `calls` list — what a real driver's
// command buffer would replay, in the order this backend recorded it.
// ---------------------------------------------------------------------------
function mockWebGPU() {
  const rec = { pipelines: [], calls: [], writeBuffer: [], writeTexture: [], submits: 0, passes: 0 };
  let curPipeline = null;
  const buf = (d) => ({ size: d.size, usage: d.usage, label: d.label, destroy() {} });
  const tex = (d) => ({ label: d.label, size: d.size, createView: () => ({}), destroy() {} });
  const pass = {
    setPipeline: (p) => { curPipeline = p.label; },
    setBindGroup: (i, g, off) => { pass._lastOff = off ? off[0] : 0; },
    setVertexBuffer(i, b) { pass._vb = b && b.label; },
    setIndexBuffer() {},
    draw: (vc, inst, first) => rec.calls.push({ kind: 'draw', pipeline: curPipeline, dynOffset: pass._lastOff, vb: pass._vb, vc }),
    drawIndexed: (ic, inst, first) => rec.calls.push({ kind: 'drawIndexed', pipeline: curPipeline, dynOffset: pass._lastOff, vb: pass._vb, ic }),
    end() {}
  };
  const device = {
    lost: new Promise(() => {}),
    pushErrorScope() {}, popErrorScope: () => Promise.resolve(null),
    createShaderModule: (d) => ({ code: d.code, getCompilationInfo: () => Promise.resolve({ messages: [] }) }),
    createBuffer: buf, createTexture: tex, createSampler: () => ({}),
    createBindGroupLayout: (d) => d, createBindGroup: (d) => d, createPipelineLayout: (d) => d,
    createRenderPipeline: (d) => { rec.pipelines.push(d.label); return { label: d.label, desc: d }; },
    createCommandEncoder: () => ({
      beginRenderPass: () => { rec.passes++; return pass; },
      copyTextureToBuffer() {}, finish: () => ({})
    }),
    queue: {
      writeBuffer: (b, o, src, so, sz) => rec.writeBuffer.push([b.label, o, sz]),
      writeTexture: (dst, data, layout, size) => rec.writeTexture.push([dst.mipLevel, size.slice()]),
      submit: () => { rec.submits++; }
    }
  };
  const gpu = {
    requestAdapter: () => Promise.resolve({ info: { vendor: 'mock', device: 'mock-gpu' }, requestDevice: () => Promise.resolve(device) }),
    getPreferredCanvasFormat: () => 'bgra8unorm'
  };
  const ctx = { configure: () => {}, getCurrentTexture: () => ({ createView: () => ({}) }) };
  return { rec, gpu, ctx, device };
}
const GPU_GLOBALS = {
  GPUTextureUsage: { RENDER_ATTACHMENT: 1, COPY_SRC: 2, TEXTURE_BINDING: 4, COPY_DST: 8 },
  GPUBufferUsage: { UNIFORM: 1, COPY_DST: 2, VERTEX: 4, INDEX: 8, MAP_READ: 16 },
  GPUShaderStage: { VERTEX: 1, FRAGMENT: 2 },
  GPUMapMode: { READ: 1 }
};

// a 2D canvas good enough for 06_atlas.js and for the sun/moon sheets, same shape shadercheck uses
function fake2DCanvas() {
  const c = { width: 0, height: 0, addEventListener() {} };
  c.getContext = (kind) => (kind !== '2d' ? null : {
    imageSmoothingEnabled: true,
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData() {}, clearRect() {}, fillRect() {}, set fillStyle(v) {}
  });
  return c;
}

function fakeDocument(canvasFactory) {
  return { createElement: (t) => (t === 'canvas' ? canvasFactory() : {}), addEventListener() {} };
}
const fakeWindow = { addEventListener() {} };

// loadEngine's own `dom: true` stub hands every `document.createElement('canvas')` a context-less
// canvas (fine for checks that never touch a GPU or a 2D context) — 06_atlas.js and the sky's own
// sun/moon textures both need a REAL 2D context, and 11_gfx_webgpu.js needs `navigator.gpu`, so
// this loads with `dom: false` (no globals bound at all) and patches `document`/`window`/
// `navigator`/the GPU_* constants onto the real Node globals before anything that reads them
// runs — free variables inside a `new Function(...)`-built module resolve at CALL time, against
// whatever the global object holds then, not at load time, so the order here is what matters.
global.document = fakeDocument(fake2DCanvas);
global.window = fakeWindow;

const M = loadEngine({
  extra: ['06_atlas.js', '09b_sky.js', '10_camera.js', '10_gfx.js', '11_gfx_webgpu.js'],
  dom: false, initReg: false
});
// the mock GPU device is wired in the same way — see the comment just above.
const { rec, gpu, ctx } = mockWebGPU();
const P = M.GfxGPU;
// these three are ordinary globals the real 11_gfx_webgpu.js expects a browser to provide;
// loadEngine ran the source already, so they are patched onto the already-built namespace's
// closure the only way left available — the module-level `navigator`/`GPU*` the file's own
// `buildResources`/`init` read are captured at CALL time, not at load time, so setting them as
// real globals here reaches the same code shadercheck.mjs reaches by passing them as `Function`
// parameters instead.
// Node 21+ ships its own read-only-by-default global `navigator` (for fetch); a plain assignment
// silently no-ops against its accessor, so the property is redefined outright instead.
Object.defineProperty(global, 'navigator', { value: { gpu, hardwareConcurrency: 8 }, writable: true, configurable: true });
Object.assign(global, GPU_GLOBALS);

M.Blocks.init();
M.Atlas.build(1);
M.Sky.init();
// 15b_gui.js is not loaded (it drags in Hud/Chat/Sound) — the sky only ever reads
// `Gui.sheets[name].{w,h,canvas}`, so that shape is supplied directly.
M.Gui = { sheets: {
  sun: { w: 16, h: 16, canvas: fake2DCanvas() },
  moon_phases: { w: 64, h: 32, canvas: fake2DCanvas() }
} };

const canvas = { width: 320, height: 200, addEventListener() {}, getContext: (t) => (t === 'webgpu' ? ctx : null) };

const okInit = await P.init(canvas, M.Atlas.canvas);
ok(okInit === true, 'KW-24: GfxGPU.init() succeeds against the mock device', P.failReason);

console.log('\n1. the sky has real geometry and its own two pipelines');
ok(!!P.sky, 'P.sky was built (NS.Sky + Gui.sheets were both present)', P.skyFailReason);
ok(P.sky && P.sky.discVerts > 0 && P.sky.darkVerts > 0,
   'the disc and dark-disc RING meshes have vertices', P.sky && (P.sky.discVerts + ',' + P.sky.darkVerts));
ok(P.sky && P.sky.starQuads > 500, 'the star field built over 500 quads', P.sky && P.sky.starQuads);
ok(!!(P.pipelines && P.pipelines.skyAlpha && P.pipelines.skyAdd), 'both sky pipelines exist');
ok(!!(P.sky && (P.sky.sunBg || P.sky.moonBg)), 'at least one of the sun/moon bind groups exists');

// A frame, built the same way 10_gfx.js's own testCameraState + drawSky wiring builds one —
// see that function's own header for why viewProj and skyViewProj are DIFFERENT matrices here
// (D-304): a sky pass that used `state.viewProj` by mistake would still pass every OTHER
// assertion in this file, so §5 below asserts the distinction directly.
function frame(dayTime, rainLevel) {
  const st = M.Gfx.testCameraState(null, true);
  // the same camera testCameraState itself just built, recreated here only so skyViewProj has
  // one to project through (testCameraState does not fill skyViewProj — the frontend does, at
  // render time, and that is the one line this helper stands in for).
  const cam = M.Cam.create();
  cam.x = 8; cam.y = 14; cam.z = -14;
  cam.yaw = 0.35; cam.pitch = -0.35;
  cam.aspect = 1; cam.fov = 70; cam.near = 0.1; cam.far = 256; cam.zeroToOne = true;
  M.Cam.update(cam);
  M.Cam.skyViewProj(cam, st.skyViewProj, M.Sky.SKY_NEAR, M.Sky.SKY_FAR);
  M.Sky.dayTime = dayTime;
  M.Sky.weather = M.Sky.newWeather();
  M.Sky.weather.raining = rainLevel > 0; M.Sky.weather.rainLevel = rainLevel;
  M.Sky.weather.thundering = false; M.Sky.weather.thunderLevel = 0;
  const skyRgb = [0.5, 0.7, 1.0], fogRgb = [0.6, 0.75, 0.95];
  st.skyFrame = M.Sky.frame(skyRgb, fogRgb, 8, 0);
  return st;
}
const stride4 = 64; // SKY_DYN_STRIDE / 4, mirrored from 11_gfx_webgpu.js
const slotWord = (o, i) => P.skyDynData[o * stride4 + i];

// `P.drawSky` asserts `!P.pass` and bails (it is only ever called from inside `beginFrame`'s own
// open render pass) — so every scenario below drives it the same way the real frontend does,
// through `beginFrame`, and reads the draw count back off `P.skyDraws`.
function drawSky(st) {
  P.beginFrame(st);
  return P.skyDraws;
}

console.log('\n2. a clear midnight: disc, stars, sun, moon, dark disc — five draws, no sunrise fan');
{
  rec.calls.length = 0;
  const st = frame(18000, 0);
  ok(!st.skyFrame.sunrise, 'setup: no sunrise fan at midnight (test picked a bad hour otherwise)');
  const n = drawSky(st);
  ok(n === 5, 'exactly five draws (disc, stars, sun, moon, dark) with no rain and no fan', n);
  ok(rec.calls.length === 5, 'and the mock device recorded exactly five GPU draw calls', rec.calls.length);
  const kinds = rec.calls.map((c) => c.pipeline + ':' + c.kind);
  ok(kinds[0] === 'sky-alpha:draw' && kinds[4] === 'sky-alpha:draw',
     'the disc (first) and the dark disc (last) use the alpha-blended pipeline', kinds.join(' '));
  ok(kinds[1] === 'sky-additive:drawIndexed' && kinds[2] === 'sky-additive:drawIndexed' && kinds[3] === 'sky-additive:drawIndexed',
     'the stars, sun and moon (middle three) use the additive pipeline and are INDEXED draws', kinds.join(' '));
  // the disc's own slot: mode.x plain (0), mode.y fog ON (1) — D-415's horizon fade is armed
  const discOff = rec.calls[0].dynOffset / 256;
  ok(slotWord(discOff, 36) === 0 && slotWord(discOff, 37) === 1,
     "the disc's uniform slot has mode.x=0 (untextured) and mode.y=1 (fog on)",
     slotWord(discOff, 36) + ',' + slotWord(discOff, 37));
  const sunOrMoonOff = rec.calls[2].dynOffset / 256;
  ok(slotWord(sunOrMoonOff, 36) === 1, 'the sun/moon slot has mode.x=1 (textured)', slotWord(sunOrMoonOff, 36));
}

console.log('\n3. anti-vacuity: a full storm silences the sun, the moon AND the stars');
{
  // ⚠⚠ THE DATA IS BROKEN ON PURPOSE: `rain = 1` is not a normal frame, it is the one input
  // this whole pass treats as "hide everything but the discs" (GfxGL.drawSky's own comment:
  // "the sun and moon fade with RAIN, not the time of day"). A `drawSky` that forgot to gate
  // the sun/moon/star draws on `1 - rain` would still issue five draws here, and this is the
  // assertion that would catch it.
  const st = frame(18000, 1);
  const n = drawSky(st);
  okAv(n === 2, 'a full storm leaves only the disc and the dark disc — two draws, not five', n);
}

console.log('\n4. anti-vacuity: Sky.ready = false stops the pass cold');
{
  M.Sky.ready = false;
  const st = frame(18000, 0);
  const n = drawSky(st);
  M.Sky.ready = true;
  okAv(n === 0, 'drawSky draws nothing while NS.Sky.ready is false', n);
}

console.log("\n5. anti-vacuity: the sky projects with skyViewProj, never the world's viewProj (D-304)");
{
  rec.calls.length = 0;
  const st = frame(18000, 0);
  // a decoy: fill the WORLD's viewProj with a value the sky's matrix never contains
  st.viewProj = new Float32Array(16).fill(-99);
  drawSky(st);
  const discOff = rec.calls[0].dynOffset / 256;
  let matches = true;
  for (let i = 0; i < 16; i++) if (Math.abs(slotWord(discOff, i) - st.skyViewProj[i]) > 1e-6) matches = false;
  okAv(matches, "the disc's uniform carries state.skyViewProj, byte for byte", 'slot ' + discOff);
  let leaked = false;
  for (let i = 0; i < 16; i++) if (slotWord(discOff, i) === -99) leaked = true;
  okAv(!leaked, 'and NOT the decoy world viewProj this test poisoned on purpose');
}

console.log('\n6. anti-vacuity: Settings.horizonFade really does flip the fog switch (D-415)');
{
  const st = frame(18000, 0);
  M.Settings = { horizonFade: false };
  drawSky(st);
  const offOff = rec.calls[rec.calls.length - 1].dynOffset / 256;
  const fogOff = slotWord(offOff, 37);
  M.Settings = { horizonFade: true };
  drawSky(st);
  const onOff = rec.calls[rec.calls.length - 1].dynOffset / 256;
  const fogOn = slotWord(onOff, 37);
  okAv(fogOff === 0 && fogOn === 1,
       "the dark disc's mode.y is 0 with horizonFade off and 1 with it on", fogOff + ' -> ' + fogOn);
}

console.log('\n7. the sunrise fan, when the band window has it: its own mode, its own pipeline');
{
  let found = null;
  for (let t = 0; t < 24000 && !found; t += 250) {
    const probe = M.Sky.sunriseFan(M.Sky.skyAngleF(t));
    if (probe) found = t;
  }
  ok(found !== null, 'setup: some dayTime in a full day has a sunrise/sunset band', found);
  if (found !== null) {
    rec.calls.length = 0;
    const st = frame(found, 0);
    const n = drawSky(st);
    ok(!!st.skyFrame.sunrise, 'and Sky.frame agrees the fan is present at that hour');
    ok(n === 6, 'one more draw than the clear-midnight case — the fan (disc, fan, stars, sun, moon, dark)', n);
    const fanCall = rec.calls[1];
    ok(fanCall.pipeline === 'sky-alpha' && fanCall.kind === 'draw',
       'the fan draws on the alpha (not additive) pipeline, non-indexed', fanCall.pipeline + ':' + fanCall.kind);
    const fanOff = fanCall.dynOffset / 256;
    ok(slotWord(fanOff, 36) === 2, "the fan's slot is mode.x=2 (alpha weighted by uv.x, D-657)", slotWord(fanOff, 36));
  }
}

console.log(`\nskygpucheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
if (fails.length) process.exit(1);
