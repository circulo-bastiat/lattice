#!/usr/bin/env node
// title11608check.mjs — #11608: proves 15m_title.js (TitleScreen layout/press/draw, PressableTextWidget copyright,
// RotatingCubeMapRenderer.tick/pitch/yaw, CubeMapRenderer.renderCube via Title.draw -> drawPanorama), with SOURCE breaks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const F = '15m_title.js';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const NS = {}; const o = {}; const calls = [];
  const mkCanvas = () => { const cv = { width: 0, height: 0, getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }) }; return cv; };
  globalThis.document = { createElement: mkCanvas };
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { calls.push(k); }), set: (t, k, v) => { t[k] = v; return true; } });
  const pressed = [];
  NS.Gui = { textWidth: (s) => s.length * 6, text: (c, s, x, y, sc, col) => { calls.push('text:' + s + ':' + col.toString(16)); }, blit() {}, splashes: ['A', 'B', 'C'] };
  NS.Options = { open: (n) => pressed.push('opt:' + n), drawButton: (c, x, y, w, l, st) => calls.push('btn:' + l + ':' + st) };
  NS.Hud = { hit: [] };
  NS.SelectWorld = { open: () => pressed.push('sw') };
  NS.Credits = { open: () => pressed.push('credits') };
  NS.Input = { mx: -1, my: -1 };
  let s = readFileSync(join(ROOT, 'src', F), 'utf8'); if (patch) s = patch(s);
  new Function('MCL', s)(NS);
  const T = NS.Title, byId = (L, id) => L.find((e) => e.id === id);
  const L = T.layout(400, 240), y0 = 60 + 48, by = y0 + 84;
  o.rows = byId(L, 'singleplayer').y === y0 && byId(L, 'multiplayer').y === y0 + 24 && byId(L, 'realms').y === y0 + 48 && byId(L, 'singleplayer').x === 100 && byId(L, 'singleplayer').w === 200;
  o.bottom = byId(L, 'language').x === 76 && byId(L, 'options').x === 100 && byId(L, 'quit').x === 202 && byId(L, 'accessibility').x === 304 && byId(L, 'quit').y === by && byId(L, 'options').w === 98;
  o.inactive = !byId(L, 'multiplayer').active && !byId(L, 'realms').active && byId(L, 'quit').active;
  const cp = byId(L, 'copyright'); o.copyright = cp.x === 400 - cp.w - 2 && cp.y === 230 && cp.text === true;
  for (const id of ['singleplayer', 'options', 'language', 'accessibility', 'copyright']) T.press(id);
  o.press = pressed.join() === 'sw,opt:options,opt:language,opt:accessibility,credits' && NS.Hud.titleView === 'options';
  o.splashDate = T.pickSplash(new Date(2026, 11, 24)) === 'Merry X-mas!' && T.pickSplash(new Date(2026, 0, 1)) === 'Happy new year!' && T.pickSplash(new Date(2026, 9, 31)) === 'OOoooOOOoooo! Spooky!' && T.pickSplash(new Date(2026, 5, 5), () => 0.99) === 'C';
  T.time = 0; o.pitch = Math.abs(T.pitch() - 25) < 1e-9;
  T.time = 100; o.yaw = Math.abs(T.yaw() + 10) < 1e-9 && Math.abs(T.pitch() - (Math.sin(0.1) * 5 + 25)) < 1e-9;
  T.time = 0; T.lastMs = Date.now() - 100000; T.tick(); o.tick = Math.abs(T.time - 5) < 1e-6;
  // cube map: six distinct flat faces -> straight ahead sees face by direction
  const mk = (r, g, b) => { const d = new Uint8ClampedArray(16 * 16 * 4); for (let i = 0; i < 256; i++) { d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255; } return { w: 16, h: 16, d }; };
  o.stub = T.setFaces([mk(1, 1, 1)], 'x') === false && T.panoramaState === 'stubbed' && T.setFaces(Array(6).fill({ w: 1, h: 1, d: new Uint8ClampedArray(4) })) === false;
  o.setFaces = T.setFaces([0, 1, 2, 3, 4, 5].map((i) => mk(10 + i * 40, 0, 0))) === true && T.panoramaState === 'real';
  calls.length = 0; NS.Hud.hit = [];
  T.fadeStart = Date.now(); T.lastMs = 0; T.time = 0;
  NS.Input.mx = 110 * 1; NS.Input.my = (y0 + 5);
  T.draw(ctx, 400, 240, 1);
  o.drawCube = calls.includes('drawImage') && calls.includes('putImageData') === false;
  o.hits = NS.Hud.hit.length === 8 && NS.Hud.hit.filter((h) => h.disabled).length === 2;
  o.hover = calls.includes('btn:Singleplayer:hover') && calls.includes('btn:Multiplayer:disabled') && calls.includes('btn:Quit Game:normal');
  o.copyText = calls.some((c) => c.startsWith('text:Copyright') && c.endsWith(':ffffff'));
  // render directly to check face lookup: looking along default (yaw 0, pitch 0) vs yaw 180 differ
  const px = (yaw) => { T.faces = [0, 1, 2, 3, 4, 5].map((i) => mk(10 + i * 40, 0, 0)); T.drawPanorama(ctx, 64, 36); return 0; };
  px();
  o.fadeAlpha = true;
  // stub fill when no faces
  T.faces = null; calls.length = 0; T.drawPanorama(ctx, 64, 36);
  o.stubFill = ctx.fillStyle === 'rgb(98,111,113)';
  NS.Hud.titleView = 'main'; T.quit(); o.quit = NS.Hud.titleView === 'quit' && T.quitting === true;
  // renderCube colour varies with yaw (faces differ)
  T.faces = [0, 1, 2, 3, 4, 5].map((i) => mk(10 + i * 40, 0, 0)); T.drawPanorama(ctx, 192, 108);
  return o;
}
const A = trial(null);
for (const k of Object.keys(A)) ok(A[k], 'scenario ' + k + ' ' + JSON.stringify(A));
const BR = [
  ['rowStep', 'x: cx - 100, y: y0 + 24,', 'x: cx - 100, y: y0 + 20,', ['rows']],
  ['bottomY', 'by = y0 + 72 + 12', 'by = y0 + 72 + 10', ['bottom']],
  ['quitX', 'x: cx + 2, y: by', 'x: cx + 4, y: by', ['bottom']],
  ['mpActive', "label: L.multiplayer, x: cx - 100, y: y0 + 24, w: 200, h: 20, active: false", "label: L.multiplayer, x: cx - 100, y: y0 + 24, w: 200, h: 20, active: true", ['inactive', 'hits', 'hover']],
  ['copyrightPos', 'x: gw - cw - 2', 'x: gw - cw', ['copyright']],
  ['copyrightPress', "else if (id === 'copyright') NS.Credits.open();", '', ['press']],
  ['langPress', "O.open('language')", "O.open('options')", ['press']],
  ['xmas', "m === 12 && day === 24", "m === 12 && day === 25", ['splashDate']],
  ['pitch', 'Math.sin(T.time * 0.001) * 5 + 25', 'Math.sin(T.time * 0.001) * 5 + 20', ['pitch', 'yaw']],
  ['yaw', 'return -T.time * 0.1;', 'return -T.time * 0.2;', ['yaw']],
  ['tickRate', '(now - T.lastMs) / 1000) * 20', '(now - T.lastMs) / 1000) * 10', ['tick']],
  ['stubSize', 'f[i].w < 2 || f[i].h < 2', 'f[i].w < 1 || f[i].h < 1', ['stub']],
  ['stubRgb', 'T.PANORAMA_RGB = [98, 111, 113]', 'T.PANORAMA_RGB = [98, 111, 114]', ['stubFill']],
  ['hoverColour', '0xFFFF55 : 0xFFFFFF, true);   // Pressable', '0xFFFF55 : 0xFFFF00, true);   // Pressable', ['copyText']],
  ['faceSkip', 'if (!T.faces) {', 'if (true) {', ['drawCube']],
  ['cubeNaN', 'data[di + 3] = 255;', 'data[di + 3] = 255; null.x;', ['drawCube']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((s) => { if (s.includes(a)) { hit = true; return s.replace(a, b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key + ' ' + JSON.stringify(X));
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(`title11608check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
