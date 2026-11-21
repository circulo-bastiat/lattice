#!/usr/bin/env node
// lightmapdrawlive.mjs — #9237: the Brightness slider (Settings.gamma) changes the world picture.
//   MCLITE_PRESET=medium node tools/lightmapdrawlive.mjs [dist/mclite.html]
// Same scene at gamma 0 / 0.5 / 1: mean luminance must rise with gamma, and the gap 0 -> 1 must be real.
// Anti-vacuity: with the gamma uniform pinned (fs.gamma forced to 0.5) the gap collapses. Runs on the active backend.
import { open, sleep } from './cdp.mjs';
import { decodePng, toRgba } from './pngdec.mjs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILE = args[0] ? (args[0].startsWith('/') ? args[0] : ROOT + args[0]) : ROOT + 'dist/mclite.html';
let breaks = 0; const fails = [];
const ok = (c, m, d) => { console.log((c ? 'ok    ' : 'FAIL  ') + m + (d !== undefined ? '   ' + d : '')); if (!c) fails.push(m); return c; };
const okAv = (c, m, d) => { breaks++; console.log((c ? '   ✓ ' : '   x ') + m + (d !== undefined ? '   ' + d : '')); if (!c) fails.push('anti-vacuity: ' + m); };

const page = await open(FILE, {
  port: 9457, width: 640, height: 360,
  initScript: 'window.addEventListener("load", function () { setTimeout(function () { if (window.MCL && MCL.Sky) { MCL.Sky.daylightCycle = false; MCL.Sky.weatherCycle = false; } }, 50); });',
});
if (!page) { console.log('SKIP  lightmapdrawlive: no Chromium found'); process.exit(0); }
try {
  await sleep(1200);
  await page.evaluate(function () { if (window.MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play({}); });
  const up = await page.waitFor(function () { return !!(window.MCL && MCL.Main.ready && MCL.Hud.mode === 'game' && MCL.World.chunks.size > 20); }, 60000);
  if (!ok(up, 'the world came up')) throw new Error('no game');
  await sleep(2000);
  const ev = (src) => page.evaluate(new Function(src));
  const frames = (n) => page.waitFor(new Function(
    'if (window.__fb === undefined) { window.__fb = MCL.Main.frame | 0; return 0; }' +
    'if (((MCL.Main.frame | 0) - window.__fb) < ' + n + ') return 0; window.__fb = undefined; return 1;'), 20000);
  const lum = async (g) => {
    await ev('MCL.Settings.gamma = ' + g + '; return 1;');
    await frames(8);
    const s = await page.send('Page.captureScreenshot', { format: 'png' });
    const im = toRgba(decodePng(Buffer.from(s.data, 'base64')));
    let sum = 0, n = 0;
    for (let i = 0; i < im.data.length; i += 4) { sum += im.data[i] + im.data[i + 1] + im.data[i + 2]; n += 3; }
    return sum / n;
  };
  const backend = await ev('return MCL.Gfx.name;');
  console.log('backend ' + backend);
  const l0 = await lum(0), lm = await lum(0.5), l1 = await lum(1);
  console.log('   luminance gamma 0 / 0.5 / 1: ' + l0.toFixed(2) + ' / ' + lm.toFixed(2) + ' / ' + l1.toFixed(2));
  ok(l0 < lm - 0.5, 'gamma 0 is darker than 0.5');
  ok(l1 > lm + 0.5, 'gamma 1 is brighter than 0.5');
  const lm2 = await lum(0.5);
  ok(Math.abs(lm2 - lm) < 1.0, 'gamma 0.5 is stable (the old look)', lm2.toFixed(2));
  // anti-vacuity: pin the uniform source so the slider cannot reach the shader
  await ev('window.__pin = MCL.Gfx.frameState || null; var s = MCL.Settings; Object.defineProperty(s, "gamma", { get: function () { return 0.5; }, set: function () {}, configurable: true }); return 1;');
  const p0 = await lum(0), p1 = await lum(1);
  okAv(Math.abs(p1 - p0) < 1.0, 'with the gamma source pinned, 0 and 1 look the same', p0.toFixed(2) + ' vs ' + p1.toFixed(2));
  okAv(!(Math.abs(l1 - l0) < 1.0), 'the unpinned gap is real, so the pinned equality above is not vacuous', (l1 - l0).toFixed(2));
  okAv(l0 < l1, 'a swapped-direction shader (brighter at 0) would fail the ordering', 'ordering ' + (l0 < l1));
} catch (e) { fails.push(String(e && e.message || e)); console.log('FAIL  ' + e); }
await page.close();
console.log('\n===========================================');
console.log(' lightmapdrawlive: ' + fails.length + ' failed, ' + breaks + ' breaks caught');
console.log('===========================================');
process.exit(fails.length ? 1 : 0);
