#!/usr/bin/env node
// chunkborderdrawcheck.mjs — #9240: F3+G chunk borders reach a real GPU draw call (WebGL2 / WebGPU, whichever
// MCL.Gfx.name is active), proven by pixels (toggle on vs off) and by a draw-call spy. Prints "<n> breaks caught".
import { open, sleep } from './cdp.mjs';
import { decodePng, toRgba } from './pngdec.mjs';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const a0 = process.argv.slice(2).filter((a) => !a.startsWith('--'))[0];
const FILE = a0 ? (a0.startsWith('/') ? a0 : ROOT + a0) : ROOT + 'dist/mclite.html';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m, d) => { if (c) { pass++; console.log('ok    ' + m); } else { fails.push(m + (d !== undefined ? ' (' + d + ')' : '')); console.log('FAIL  ' + m + (d !== undefined ? '   ' + d : '')); } return c; };
const okAv = (c, m, d) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else { fails.push('anti-vacuity: ' + m + (d !== undefined ? ' (' + d + ')' : '')); console.log('   x ' + m + (d !== undefined ? '   ' + d : '')); } };
/** Pixels in the geometry's own colours (yellow, teal, blue); robust to scene motion, unlike a frame diff. */
function linepx(a) {
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const r = a.data[i], g = a.data[i + 1], b = a.data[i + 2];
    if ((r > 225 && g > 225 && b < 60) || (r < 40 && g > 135 && g < 175 && b > 135 && b < 175) || (r > 50 && r < 80 && g > 50 && g < 80 && b > 235)) n++;
  }
  return n;
}
function compare(a, b) {
  if (a.width !== b.width || a.height !== b.height) return -1;
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) > 12) n++;
  return n;
}
const page = await open(FILE, {
  port: 9457, width: 960, height: 540,
  initScript: 'window.addEventListener("load", function () { setTimeout(function () { if (window.MCL && MCL.Sky) { MCL.Sky.daylightCycle = false; MCL.Sky.weatherCycle = false; } }, 50); });',
});
if (!page) { console.log('SKIP  chunkborderdrawcheck: no Chromium found'); process.exit(0); }
try {
  await sleep(1200);
  await page.evaluate(function () { if (window.MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play({}); });
  const up = await page.waitFor(function () { return !!(window.MCL && MCL.Main.ready && MCL.Hud.mode === 'game' && MCL.World.chunks.size > 20); }, 60000);
  if (!ok(up, 'the world came up', page.lastThrow)) throw new Error('never reached the game');
  await page.evaluate(function () { if (MCL.Spawn) MCL.Spawn.ready = false; if (MCL.EntityList) MCL.EntityList.list.length = 0; });
  await sleep(2500);
  const ev = (src) => page.evaluate(new Function(src));
  const frames = (n) => page.waitFor(new Function(
    'if (window.__fb === undefined) { window.__fb = MCL.Main.frame | 0; return 0; }' +
    'if (((MCL.Main.frame | 0) - window.__fb) < ' + n + ') return 0; window.__fb = undefined; return 1;'), 20000);
  const shot = async () => { await frames(6); const s = await page.send('Page.captureScreenshot', { format: 'png' }); return toRgba(decodePng(Buffer.from(s.data, 'base64'))); };
  // stand 40 blocks above the ground on a chunk corner, looking straight down: the edge lines run through the view over open ground
  await ev('var P = MCL.Player, W = MCL.World; P.flying = true; if (P.abilities) P.abilities.flying = true;' +
    'var cx = Math.floor(P.x / 16) * 16, cz = Math.floor(P.z / 16) * 16; P.x = cx + 8; P.z = cz + 8;' +
    'var y = 200; while (y > 0 && W.getBlock(cx, y, cz) === 0) y--; P.y = y + 45; P.vx = P.vy = P.vz = 0; P.pitch = -1.5; if (P.interpolate) P.interpolate(1);' +
    'return 1;');
  await sleep(1500);
  const backend = await ev('return MCL.Gfx.name;');
  ok(backend === 'webgl2' || backend === 'webgpu', 'a real GPU backend is active (' + backend + ')');
  await ev('MCL.ChunkBorder.on = false; return 1;');
  const off1 = await shot(); const off2 = await shot();
  const noise = compare(off1, off2);
  await ev('MCL.ChunkBorder.on = true; window.__cb = 0; var ER = MCL.EntityRender, n = MCL.Gfx.name === "webgpu" ? "renderCrystalBeamsGPU" : "renderCrystalBeamsGL2", o = ER[n];' +
    'window.__cbO = o; window.__cbN = n; ER[n] = function () { window.__cb++; if (!window.__dbg && arguments[3]) { var v = arguments[3], m = arguments[1].viewProj, x = v[0], y = v[1], z = v[2]; window.__dbg = JSON.stringify({ n: v.length, v: v.slice(0, 7), c: [x*m[0]+y*m[4]+z*m[8]+m[12], x*m[1]+y*m[5]+z*m[9]+m[13], x*m[3]+y*m[7]+z*m[11]+m[15]] }); } var r = o.apply(ER, arguments); if (arguments[3]) { var gl = MCL.Gfx.backend.gl; window.__err = "cm=" + gl.getParameter(gl.COLOR_WRITEMASK) + " df=" + gl.getParameter(gl.DEPTH_FUNC) + " sc=" + gl.isEnabled(gl.SCISSOR_TEST) + " st=" + gl.isEnabled(gl.STENCIL_TEST) + " ds=" + gl.getParameter(gl.DEPTH_RANGE) + " prog=" + gl.getParameter(gl.CURRENT_PROGRAM) + " depthTest=" + gl.isEnabled(gl.DEPTH_TEST) + " vp=" + gl.getParameter(gl.VIEWPORT) + " fbo=" + gl.getParameter(gl.FRAMEBUFFER_BINDING); } return r; }; return 1;');
  const on = await shot();
  const calls = await ev('return window.__cb;');
  const diff = linepx(on) - linepx(off2);
  console.log('   noise ' + noise + ' px, toggle-on delta ' + diff + ' px, draw calls ' + calls);
  ok(calls > 0, 'toggle on reaches the backend draw function (' + calls + ' calls)');
  ok(diff > 150, 'toggle on adds pixels in the geometry colours (' + diff + ')');
  await ev('MCL.EntityRender[window.__cbN] = window.__cbO; MCL.ChunkBorder.on = false; return 1;');
  const off3 = await shot();
  ok(linepx(off3) - linepx(off2) < 50, 'toggle off removes the line colours again (' + linepx(off3) + ' vs ' + linepx(off2) + ')');
  // anti-vacuity: a skipped draw call and a wrong-colour draw must both be caught
  await ev('var ER = MCL.EntityRender, n = window.__cbN, o = window.__cbO; window.__cb = 0; ER[n] = function () { window.__cb++; }; MCL.ChunkBorder.on = true; return 1;');
  const skipped = await shot();
  okAv(linepx(skipped) - linepx(off2) <= 150, 'draw call skipped -> no line colours, so the pixel assertion fails on it (' + (linepx(skipped) - linepx(off2)) + ' px)');
  await ev('var ER = MCL.EntityRender, n = window.__cbN, o = window.__cbO; ER[n] = function (G, c, p, v, nd) { for (var i = 0; i < v.length; i += 7) { v[i + 3] = 1; v[i + 4] = 0; v[i + 5] = 1; } window.__cbBad = v[3] + "," + v[4] + "," + v[5]; var r = o.apply(ER, arguments); if (arguments[3]) { var gl = MCL.Gfx.backend.gl; window.__err = "cm=" + gl.getParameter(gl.COLOR_WRITEMASK) + " df=" + gl.getParameter(gl.DEPTH_FUNC) + " sc=" + gl.isEnabled(gl.SCISSOR_TEST) + " st=" + gl.isEnabled(gl.STENCIL_TEST) + " ds=" + gl.getParameter(gl.DEPTH_RANGE) + " prog=" + gl.getParameter(gl.CURRENT_PROGRAM) + " depthTest=" + gl.isEnabled(gl.DEPTH_TEST) + " vp=" + gl.getParameter(gl.VIEWPORT) + " fbo=" + gl.getParameter(gl.FRAMEBUFFER_BINDING); } return r; }; return 1;');
  await shot();
  okAv(await ev('return window.__cbBad;') !== '0.25,0.25,1', 'wrong-colour verts are distinguishable from the geometry\'s colours');
  await ev('MCL.EntityRender[window.__cbN] = window.__cbO; MCL.ChunkBorder.on = false; return 1;');
} catch (e) { fails.push('threw: ' + (e && e.message)); console.log('FAIL  ' + (e && e.message)); }
await page.close();
console.log(`\n${pass} checks passed, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
