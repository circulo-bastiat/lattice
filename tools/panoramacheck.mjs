#!/usr/bin/env node
// panoramacheck.mjs — #11265: the title screen has a spinning panorama behind the buttons.
//
//   node tools/panoramacheck.mjs [dist/mclite.html]
//
// Drives the BUILT page at file://. Installs six synthetic, clearly different test faces (so it needs no Mojang art), screenshots the
// title screen twice a second apart and asserts the background pixels CHANGED (it spins) and are not one flat colour.
// Anti-vacuity: the same scorer must reject (a) a frozen clock, (b) the draw removed (flat stub fill), (c) two identical frames.
// If the build carries no real faces (every jar face is a 1x1 stub) it prints 'PANORAMA STUBBED' as a skip for the real-art part, never green.
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { open, findChrome, sleep } from './cdp.mjs';
import { decodePng } from './pngdec.mjs';

const FILE = resolve(process.argv[2] || 'dist/mclite.html');
if (!existsSync(FILE)) { console.error('no such file: ' + FILE); process.exit(2); }
if (!findChrome()) { console.log('SKIP  panoramacheck: no Chromium found (set $CHROME to run it)'); process.exit(0); }

let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok    ' : 'FAIL  ') + m); if (!c) fails++; };

// background samples: a grid of the screenshot, away from the centre column of buttons and the logo
function sample(png) {
  const im = decodePng(png), ch = im.channels, out = [];
  for (let gy = 0; gy < 6; gy++) for (let gx = 0; gx < 8; gx++) {
    const x = Math.floor((gx + 0.5) / 8 * im.width), y = Math.floor((gy + 0.5) / 6 * im.height);
    if (x > im.width * 0.25 && x < im.width * 0.75 && y < im.height * 0.95) continue;   // buttons/logo column
    const o = (y * im.width + x) * ch; out.push([im.data[o], im.data[o + 1], im.data[o + 2]]);
  }
  return out;
}
const dist = (a, b) => a.reduce((s, p, i) => s + Math.abs(p[0] - b[i][0]) + Math.abs(p[1] - b[i][1]) + Math.abs(p[2] - b[i][2]), 0) / a.length;
const spread = (a) => { let m = 0; for (const p of a) for (const q of a) m = Math.max(m, Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2])); return m; };
// the scorer: verdict for a pair of frames
export const score = (f1, f2) => ({ changed: dist(f1, f2) > 6, flat: spread(f1) < 30 || spread(f2) < 30 });

// blockiness (#11399): in the left background strip (no buttons), the share of horizontal steps that are a STAIRCASE RISER: a jump of >= 6
// (summed RGB) straight after a run of >= 3 identical pixels. A bilinear picture changes a little every pixel; a nearest-neighbour upscale
// holds a value for 3+ pixels then jumps.
export function blockiness(im) {
  const ch = im.channels, x1 = Math.floor(im.width * 0.2); let risers = 0, steps = 0;
  for (let y = Math.floor(im.height * 0.1); y < im.height * 0.9; y += 7) {
    let run = 1;
    for (let x = 1; x < x1; x++) {
      const o = (y * im.width + x) * ch, q = o - ch;
      const d = Math.abs(im.data[o] - im.data[q]) + Math.abs(im.data[o + 1] - im.data[q + 1]) + Math.abs(im.data[o + 2] - im.data[q + 2]);
      if (d === 0) run++; else { if (run >= 3 && d >= 6) risers++; run = 1; }
      steps++;
    }
  }
  return risers / steps;
}
export const blockyCopy = (im, n) => { const d = Buffer.from(im.data); for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) { const o = (y * im.width + x) * im.channels, q = ((y - y % n) * im.width + (x - x % n)) * im.channels; for (let c = 0; c < im.channels; c++) d[o + c] = im.data[q + c]; } return { ...im, data: d }; };
const shot = async (pg) => Buffer.from((await pg.send('Page.captureScreenshot', { format: 'png' })).data, 'base64');

async function run(mode) {
  const pg = await open(FILE);
  if (!pg) return null;
  await pg.evaluate(() => { try { localStorage.removeItem('mclite.world'); } catch (e) { /* none */ } return 1; });
  await pg.send('Page.reload', {});
  await pg.waitFor(() => window.MCL && MCL.Hud && MCL.Hud.mode === 'title' && MCL.Hud.hit && MCL.Hud.hit.length > 0, 60000);
  const info = await pg.evaluate(() => ({ state: MCL.Title.panoramaState, data: MCL.PanoramaData ? MCL.PanoramaData.source : null }));
  await pg.evaluate(() => {
    // six solid-ish test faces: a gradient each, in six hues, so every yaw/pitch shows a different picture
    const hue = [[220, 40, 40], [40, 220, 40], [40, 40, 220], [220, 220, 40], [40, 220, 220], [220, 40, 220]], f = [];
    for (let i = 0; i < 6; i++) { const w = 64, d = new Uint8ClampedArray(w * w * 4); for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4, k = 0.3 + 0.7 * (x / w) * ((y % 16 < 8) ? 1 : 0.6); d[o] = hue[i][0] * k; d[o + 1] = hue[i][1] * k; d[o + 2] = hue[i][2] * k; d[o + 3] = 255; } f.push({ w, h: w, d }); }
    MCL.Title.setFaces(f, 'test'); MCL.Title.fadeStart = 1;   // fade done
    return 1;
  });
  if (mode === 'frozen') await pg.evaluate(() => { MCL.Title.tick = function () { return Date.now(); }; return 1; });
  if (mode === 'nodraw') await pg.evaluate(() => { MCL.Title.faces = null; return 1; });
  await sleep(700);
  const pa = await shot(pg), a = sample(pa);
  const im0 = decodePng(pa), blk = blockiness(im0), blkBad = blockiness(blockyCopy(im0, 6));
  await sleep(1000);
  const b = sample(await shot(pg));
  const same = mode === 'identical' ? score(a, a) : score(a, b);
  await pg.close();
  return { ...same, info, blk, blkBad };
}

const good = await run('live');
if (!good) { console.log('SKIP  panoramacheck: browser did not start'); process.exit(0); }
ok(!good.flat, 'background is not a flat colour');
ok(good.changed, 'background pixels changed over one second (the cube map spins)');
ok(good.blk < 0.006, 'picture is smooth: blockiness ' + good.blk.toFixed(4) + ' < 0.006');
let caught = 0;
{ const bad = good.blkBad >= 0.006; console.log((bad ? 'ok    ✓ ' : 'FAIL  ') + 'break "6px blocks" is rejected by blockiness (' + good.blkBad.toFixed(4) + ')'); if (bad) caught++; else fails++; }
for (const m of ['frozen', 'nodraw', 'identical']) {
  const r = await run(m);
  const bad = r.flat || !r.changed;
  console.log((bad ? 'ok    ✓ ' : 'FAIL  ') + 'break "' + m + '" is rejected by the scorer'); if (bad) caught++; else fails++;
}
if (good.info.state === 'stubbed' || good.info.data === 'stub') console.log('PANORAMA STUBBED  every jar face is a 1x1 stub: the real-art path is a SKIP, not a pass (source: ' + good.info.data + ')');
else ok(good.info.state === 'real', 'built page decoded the real faces (source: ' + good.info.data + ', state ' + good.info.state + ')');
console.log('panoramacheck: ' + (5 + caught) + ' assertions, ' + fails + ' failures, ' + caught + ' breaks caught');
process.exit(fails ? 1 : 0);
