#!/usr/bin/env node
// guitexcheck.mjs — #11261: GUI sprite sampling in the BUILT dist/mclite.html (file://). The 200x20 vanilla button
// (ClickableWidget.renderButton: two 100x20 halves of widgets.png, v = 46 + 20*(1+hovered), disabled 46) is drawn through
// NS.Options.drawButton at GUI scales 1-4 x fractional device pixel ratios x fractional panel origins, read back from a real
// canvas, and compared pixel for pixel with a nearest-neighbour reference of the two vanilla halves, each over its own device-pixel box.
// A seam, a doubled/dropped texel column or any ink outside the box is bleed. ANTI-VACUITY: the same measurement is repeated
// with the snapping disabled / smoothing on / a half texel shifted, and each must be caught: "<n> breaks caught".
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { open, findChrome, sleep } from './cdp.mjs';
const FILE = resolve(process.argv[2] || 'dist/mclite.html');
if (!existsSync(FILE)) { console.error('no such file: ' + FILE); process.exit(2); }
if (!findChrome()) { console.log('SKIP  guitexcheck: no Chromium found'); process.exit(0); }
const page = await open(FILE, { port: 9463, width: 1280, height: 800 });
await sleep(3000);
const measure = (mode) => page.evaluate(new Function(`return (function(mode){
  const G = MCL.Gui, O = MCL.Options, bad = [], origSnap = G.snap;
  if (mode === 'nosnap') G.snap = (x, y, w, h) => [x, y, w, h];
  if (mode === 'shift') G.snap = (x, y, w, h, c) => [x + 0.5 / c.getTransform().a, y, w, h];
  const sh = G.sheets.widgets.canvas, sd = sh.getContext('2d').getImageData(0, 0, sh.width, sh.height).data;
  const tex = (x, y) => { const i = (y * sh.width + x) * 4; return [sd[i], sd[i + 1], sd[i + 2], sd[i + 3]]; };
  let n = 0;
  for (const dpr of [1, 1.25, 1.5, 1.75, 2.5]) for (const s of [1, 2, 3, 4]) for (const state of ['normal', 'hover', 'disabled']) for (const off of [0, 0.5, 0.37]) {
    const ox = 7 + off, oy = 5 + off, W = Math.ceil((200 * s + 20) * dpr), H = Math.ceil((20 * s + 12) * dpr);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.imageSmoothingEnabled = (mode === 'smooth');
    O.drawButton(c, 0, 0, 200, '', state, s, ox, oy);
    const px = c.getImageData(0, 0, W, H).data;
    const x0 = Math.round(ox * dpr), y0 = Math.round(oy * dpr), x1 = Math.round((ox + 200 * s) * dpr), y1 = Math.round((oy + 20 * s) * dpr);
    const xm = Math.round((ox + 100 * s) * dpr), sy = O.SPRITE[state]; let wrong = 0, first = '';
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, got = [px[i], px[i + 1], px[i + 2], px[i + 3]];
      let ok = false, inBox = x >= x0 && x < x1 && y >= y0 && y < y1;
      if (!inBox) ok = got[0] === 0 && got[1] === 0 && got[2] === 0 && got[3] === 0;
      else {
        // a source coordinate that lands exactly on a texel edge is a tie: either neighbour is a correct nearest pick
        const cand = (u) => { const f = Math.floor(u + 1e-6), r = Math.round(u); return Math.abs(u - r) < 1e-6 ? [r - 1, r] : [f]; };
        const ux = x < xm ? cand((x - x0 + 0.5) * 100 / (xm - x0)) : cand((x - xm + 0.5) * 100 / (x1 - xm)).map((v) => v + 0);
        const base = x < xm ? 0 : 100, uy = cand((y - y0 + 0.5) * 20 / (y1 - y0));
        for (const cx of ux) for (const cy of uy) { const t = tex(Math.max(0, base + cx), sy + Math.max(0, cy)); if (t[0] === got[0] && t[1] === got[1] && t[2] === got[2] && t[3] === got[3]) ok = true; }
      }
      if (!ok) { wrong++; if (!first) first = x + ',' + y; }
    }
    n++;
    if (wrong) bad.push('dpr ' + dpr + ' scale ' + s + ' ' + state + ' off ' + off + ': ' + wrong + ' px differ from nearest reference (first ' + first + ')');
  }
  G.snap = origSnap;
  return { n, bad: bad.slice(0, 6), nbad: bad.length };
})(${JSON.stringify(mode)})`));
const fails = [];
const real = await measure('real');
console.log(`guitexcheck: ${real.n} button draws measured`);
if (real.nbad) for (const b of real.bad) fails.push(b);
// other sprite families go through the same G.blit: the hotbar and a slot-sized sprite at the same fractional ratios
const fam = await page.evaluate(() => {
  const G = MCL.Gui, bad = []; let n = 0;
  for (const dpr of [1, 1.25, 1.5, 2.5]) for (const s of [1, 2, 3, 4]) for (const [name, r] of [['widgets', G.WIDGET.hotbar], ['widgets', G.WIDGET.selector]]) {
    const W = Math.ceil((r[2] * s + 10) * dpr), H = Math.ceil((r[3] * s + 10) * dpr);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.imageSmoothingEnabled = false;
    G.blit(c, name, r, 3.5, 2.25, s);
    const q = G.snap(3.5, 2.25, r[2] * s, r[3] * s, c), want = [Math.round(q[0] * dpr), Math.round(q[1] * dpr), Math.round(q[2] * dpr), Math.round(q[3] * dpr)];
    const d = c.getImageData(0, 0, W, H).data; n++;
    // every device pixel outside the snapped box must stay transparent (no bleed past the sprite edge)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x < want[0] || x >= want[0] + want[2] || y < want[1] || y >= want[1] + want[3]) && d[(y * W + x) * 4 + 3]) { bad.push(`${r} dpr ${dpr} s ${s}: ink outside box at ${x},${y}`); y = H; break; }
  }
  return { n, bad };
});
console.log(`guitexcheck: ${fam.n} hotbar/selector draws measured`);
for (const b of fam.bad.slice(0, 4)) fails.push(b);
let caught = 0;
for (const m of ['nosnap', 'smooth', 'shift']) {
  const r = await measure(m);
  if (r.nbad) { caught++; console.log('  ✓ break caught: ' + m + ' (' + r.nbad + ' bad draws)'); } else fails.push('break NOT caught: ' + m);
}
if (page.problems.length) fails.push(page.problems.length + ' console errors: ' + page.problems.slice(0, 2).join(' | '));
await page.close();
console.log(`guitexcheck: ${fam.n} assertions, ${fails.length} failed`);
console.log(`guitexcheck: ${caught} breaks caught`);
if (fails.length) { console.log('FAIL guitexcheck'); for (const f of fails) console.log('  x ' + f); process.exit(1); }
console.log('PASS guitexcheck');
