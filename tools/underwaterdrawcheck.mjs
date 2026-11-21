#!/usr/bin/env node
// underwaterdrawcheck.mjs — #9241: misc/underwater.png drawn by the 2D HUD layer (Hud.drawUnderwaterOverlay)
// when the eye is in water. The HUD canvas sits over WebGL2 and WebGPU alike, so the active backend is the one tested.
//   MCLITE_PRESET=medium node tools/underwaterdrawcheck.mjs [dist/mclite.html]
import { open, sleep } from './cdp.mjs';
import { decodePng, toRgba } from './pngdec.mjs';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const a0 = process.argv.slice(2).filter((a) => !a.startsWith('--'))[0];
const FILE = a0 ? (a0.startsWith('/') ? a0 : ROOT + a0) : ROOT + 'dist/mclite.html';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m, d) => { if (c) { pass++; console.log('ok    ' + m); } else { fails.push(m); console.log('FAIL  ' + m + (d !== undefined ? '   ' + d : '')); } };
const okAv = (c, m, d) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else { fails.push('anti-vacuity: ' + m); console.log('   x ' + m + (d !== undefined ? '   ' + d : '')); } };
const diff = (a, b) => { let n = 0; for (let i = 0; i < a.data.length; i += 4) if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) > 6) n++; return n; };

const page = await open(FILE, { port: 9461, width: 960, height: 540 });
if (!page) { console.log('SKIP  underwaterdrawcheck: no Chromium found'); process.exit(0); }
try {
  await sleep(1200);
  await page.evaluate(function () { if (window.MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play({}); });
  ok(await page.waitFor(function () { return !!(window.MCL && MCL.Main.ready && MCL.Hud.mode === 'game' && MCL.World.chunks.size > 20); }, 60000), 'the world came up', page.lastThrow);
  const ev = (src) => page.evaluate(new Function(src));
  const shot = async () => {
    await ev('window.__f0 = MCL.Main.frame | 0; return 1;');
    await page.waitFor(new Function('return ((MCL.Main.frame | 0) - window.__f0) >= 4;'), 20000);
    const s = await page.send('Page.captureScreenshot', { format: 'png' });
    if (process.env.SHOTS) writeFileSync('/tmp/uw' + (globalThis.__n = (globalThis.__n | 0) + 1) + '.png', Buffer.from(s.data, 'base64'));
    return toRgba(decodePng(Buffer.from(s.data, 'base64')));
  };
  // Pin the eye-in-water flag (the tick would recompute it, so freeze the game loop's writer by overriding each frame).
  // Pin the scene from inside Hud.draw itself (the physics tick rewrites eyeInWater, an interval would lose the race).
  const setWater = (w, yawDeg) => ev('var P = MCL.Player, H = MCL.Hud;' +
    'if (!window.__pin) { window.__pin = { x: P.x, y: P.y, z: P.z, pitch: P.pitch }; window.__hd = H.draw; }' +
    'window.__w = ' + w + '; window.__yaw = ' + yawDeg + ';' +
    'H.draw = function () { var pn = window.__pin; P.x = pn.x; P.y = pn.y; P.z = pn.z; P.pitch = pn.pitch; P.vx = P.vy = P.vz = 0;' +
    '  P.eyeInWater = window.__w; P.inLava = false; P.yaw = window.__yaw * Math.PI / 180; return window.__hd.apply(H, arguments); }; return 1;');
  console.log('backend: ' + await ev('return MCL.Gfx && MCL.Gfx.name;'));
  ok(await ev('return !!(MCL.Gui.sheets && MCL.Gui.sheets.underwater);'), 'misc/underwater.png is packed as Gui sheet `underwater`');
  await ev('MCL.Hud.drawFluidOverlay = MCL.Hud.drawFluidOverlay; return 1;');

  // The eye-in-water flag also changes the world's own fog/tint, so the baseline is water WITH the overlay draw skipped.
  await ev('window.__d = MCL.Hud.drawUnderwaterOverlay; MCL.Hud.drawUnderwaterOverlay = function () { return true; }; return 1;');
  await setWater(true, 0); await sleep(4000);
  const base = await shot(), base2 = await shot();
  const noise = diff(base, base2);
  await ev('MCL.Hud.drawUnderwaterOverlay = window.__d; return 1;');
  await sleep(1000);
  const wet = await shot();
  const on = diff(base, wet);
  console.log(`   noise ${noise} px, overlay on ${on} px`);
  ok(on > Math.max(2000, noise * 3), 'the overlay changes the picture in water', on);
  const flat = await ev('var sh = MCL.Gui.sheets.underwater; return sh.canvas.width;');
  ok(flat > 0, 'sheet has pixels');

  await ev('window.__sp = MCL.Hud.spectatorHud; MCL.Hud.spectatorHud = function () { return true; }; return 1;');
  await setWater(true, 0); await sleep(300);
  const spec = await shot();
  const specD = diff(base, spec);
  ok(specD < on * 0.5, 'a spectator gets no overlay (' + specD + ' vs ' + on + ')');
  await ev('MCL.Hud.spectatorHud = window.__sp; return 1;');
  okAv(specD < on * 0.5 && diff(wet, spec) > specD, 'break: overlay-on differs from the spectator picture');

  await ev('MCL.Hud.drawUnderwaterOverlay = function () { return true; }; return 1;');
  await sleep(300);
  const skipped = await shot();
  okAv(diff(base, skipped) < on * 0.5, 'break: draw call skipped -> no overlay pixels', diff(base, skipped));
  await ev('MCL.Hud.drawUnderwaterOverlay = function (c) { c.fillStyle = "#000"; c.fillRect(0, 0, MCL.Hud.w, MCL.Hud.h); return true; }; return 1;');
  await sleep(300);
  const black = await shot();
  okAv(diff(wet, black) > 2000, 'break: wrong colour is told apart from the real overlay', diff(wet, black));
  await ev('MCL.Hud.drawUnderwaterOverlay = function (c) { return window.__d(c); }; return 1;');
  await setWater(true, 0); await sleep(300);
  const wet0 = await shot();
  await setWater(true, 40); await sleep(300);
  const wetYaw = await shot();
  const uvA = await ev('var q = MCL.Hud.underwaterOverlayQuad(0, 0, 15), r = MCL.Hud.underwaterOverlayQuad(40, 0, 15); return q.uv[0][0] !== r.uv[0][0];');
  ok(uvA && diff(wet0, wetYaw) > 0, 'the UV slides when yaw changes');

  await ev('MCL.Hud.drawUnderwaterOverlay = window.__d; MCL.Hud.draw = window.__hd; return 1;');
  ok(page.problems.length === 0, 'no page errors', page.problems.slice(0, 2).join(' | '));
} catch (e) { fails.push('harness: ' + (e && e.message)); console.log('FAIL  harness: ' + (e && (e.stack || e.message))); }
finally { await page.close(); }
console.log(`underwaterdrawcheck: ${pass} assertions, ${fails.length} failed, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
