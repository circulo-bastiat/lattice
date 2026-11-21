#!/usr/bin/env node
// menutextcheck.mjs — #11400 (Dan: "some of the text has slight corruption, like underlines"). In the BUILT dist/mclite.html at file://:
// collect every label on the Title, Options, Select World and Create New World screens (the live Hud.hit list), then draw each one with
// the real Gui font sheet at GUI scale 1-4 x devicePixelRatio 1/1.25/1.5/2 x fractional origins onto a background-filled canvas, and fail
// when ANY device pixel outside the glyph box (text + its shadow, rounded out to whole device pixels) is not background - the stray line.
// ANTI-VACUITY: the same scan runs with one stray device-pixel row drawn under the text and must flag it (4 breaks, "<n> breaks caught").
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { open, findChrome, sleep } from './cdp.mjs';

const FILE = resolve(process.argv[2] || 'dist/mclite.html');
if (!existsSync(FILE)) { console.error('no such file: ' + FILE); process.exit(2); }
if (!findChrome()) { console.log('SKIP  menutextcheck: no Chromium found (set $CHROME to run it)'); process.exit(0); }

const page = await open(FILE, { port: 9463, width: 1280, height: 1000 });
await sleep(600);
await page.send('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.removeItem('mclite.world')}catch(e){}" });
await page.send('Page.reload', {});
await sleep(2500);
const ev = (code) => page.evaluate(new Function('return (' + code + ')'));
const click = async (label) => {
  const r = await ev(`(() => { const h = MCL.Hud.hit.find((q) => q.label === ${JSON.stringify(label)}); return h ? { x: h.x + h.w / 2, y: h.y + h.h / 2 } : null; })()`);
  if (r) { await page.click(r.x, r.y); await sleep(250); }
  return !!r;
};
const labels = new Set(); const screens = [];
const grab = async (name) => {
  const l = await ev('[...MCL.Hud.hit, ...(MCL.Hud.titleView === "options" && MCL.Options.hit ? MCL.Options.hit : [])].map((q) => q.label).filter((s) => typeof s === "string" && s.length)');
  screens.push(`${name}:${l.length}`); for (const s of l) labels.add(s);
};
await grab('title');
await click('Options...'); await grab('options'); await page.key('Escape'); await sleep(200);
await click('Singleplayer'); await grab('select-world');
await click('Create New World'); await grab('create-world');

// verdict(breakKind): all labels x scales x dprs; returns the stray-pixel report
const SCAN = `((labels, brk) => {
  const G = MCL.Gui, bad = [], seen = { n: 0 };
  // each glyph's own ink rows, read off the font sheet: a row of the quad that is blank in the sheet must stay blank on screen
  const sh = G.sheets.ascii, sc = document.createElement('canvas'); sc.width = sh.w; sc.height = sh.h;
  const sx = sc.getContext('2d', { willReadFrequently: true }); sx.drawImage(sh.canvas, 0, 0);
  const sd = sx.getImageData(0, 0, sh.w, sh.h).data, rows = {};
  const inkRows = (ch) => rows[ch] || (rows[ch] = (() => { let lo = 99, hi = -1;
    for (let r = 0; r < G.cell; r++) for (let q = 0; q < G.cell; q++) if (sd[((((ch >> 4) * G.cell + r) * sh.w) + (ch & 15) * G.cell + q) * 4 + 3]) { if (r < lo) lo = r; if (r > hi) hi = r; }
    return [lo, hi]; })());
  for (const dpr of [1, 1.25, 1.5, 2]) for (const s of [1, 2, 3, 4]) for (const [ox, oy] of [[3, 3], [3.37, 4.61]]) for (const str of labels) {
    const last = str.length ? G.widths[Math.min(str.charCodeAt(str.length - 1), 255)] : 0;
    const w = (G.textWidth(str) - last + G.cell) * s + s, h = (G.cell + 1) * s;   // every glyph CELL (the quad), + the shadow's 1 texel in both axes
    const W = Math.ceil((w + 8) * dpr) + 2, H = Math.ceil((h + 8) * dpr) + 2;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d', { willReadFrequently: true });
    c.imageSmoothingEnabled = false; c.fillStyle = '#000'; c.fillRect(0, 0, W, H);   // as the Hud's own context
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    G.text(c, str, ox, oy, s, 0xFFFFFF, true);
    if (brk === 'underline') { c.fillStyle = '#fff'; c.fillRect(ox, Math.ceil((oy + h) * dpr) / dpr, w, 1 / dpr); }
    if (brk === 'overshoot-right') { c.fillStyle = '#fff'; c.fillRect(Math.ceil((ox + w) * dpr) / dpr, oy, 1 / dpr, h); }
    const d = c.getImageData(0, 0, W, H).data;
    let lo = 99, hi = -1; for (let i = 0; i < str.length; i++) { const [a, b] = inkRows(Math.min(str.charCodeAt(i), 255)); if (b >= 0) { if (a < lo) lo = a; if (b > hi) hi = b; } }
    const x0 = Math.floor(ox * dpr), x1 = Math.ceil((ox + w) * dpr);
    const y0 = Math.floor((oy + (hi < 0 ? 0 : lo) * s) * dpr), y1 = Math.ceil((oy + (hi < 0 ? G.cell : hi + 2) * s) * dpr);   // ink rows lo..hi, + the shadow's texel
    seen.n++;
    let ink = 0, stray = 0, first = null;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4; if (d[i] | d[i + 1] | d[i + 2]) {
        if (x >= x0 && x < x1 && y >= y0 && y < y1) ink++;
        else { stray++; if (!first) first = [x, y]; }
      }
    }
    if (stray || (!ink && str.trim())) bad.push({ str, dpr, s, ox, oy, stray, ink, first, lo, hi, y0, y1 });
  }
  return { bad: bad.slice(0, 8), nbad: bad.length, n: seen.n };
})`;
const run = (brk) => ev(`${SCAN}(${JSON.stringify([...labels])}, ${JSON.stringify(brk || '')})`);
const base = await run('');
const problems = page.problems.length;
await page.close();

const fails = []; let pass = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
ok(['title', 'options', 'select-world', 'create-world'].every((n) => screens.some((x) => x.startsWith(n + ':') && !x.endsWith(':0'))), 'a menu screen exposed no labels: ' + screens.join(' '));
ok(labels.has('Singleplayer') && labels.has('Create New World') && labels.size >= 12, `too few menu labels collected (${labels.size}): ${[...labels].slice(0, 8).join(' | ')}`);
ok(base.n === labels.size * 32 && base.nbad === 0, `${base.nbad} of ${base.n} label renders have non-background pixels outside the glyph box, e.g. ${JSON.stringify(base.bad.slice(0, 3))}`);
ok(problems === 0, `${problems} console errors`);
console.log(`menutextcheck: ${labels.size} labels on ${screens.join(' ')}; ${base.n} renders (scale 1-4 x dpr 1/1.25/1.5/2 x 2 origins)`);

// anti-vacuity: re-open (the page was closed above) and run the SAME scan with a deliberate stray line; it must be flagged
const page2 = await open(FILE, { port: 9464, width: 1280, height: 1000 });
await sleep(2500);
const ev2 = (code) => page2.evaluate(new Function('return (' + code + ')'));
let caught = 0;
for (const brk of ['underline', 'overshoot-right']) {
  const r = await ev2(`${SCAN}(${JSON.stringify([...labels])}, ${JSON.stringify(brk)})`);
  if (r.nbad === r.n) { caught++; console.log(`   ✓ break caught: ${brk} (${r.nbad}/${r.n} renders flagged)`); } else fails.push(`break "${brk}" flagged only ${r.nbad} of ${r.n} renders`);
}
// a break in the real code path: a glyph quad 1 device pixel too tall on the bottom edge (snap overshoot)
{
  const r = await ev2(`(() => { const G = MCL.Gui, snap = G.snap; G.snap = (x, y, w, h, c) => { const q = snap(x, y, w, h, c); q[3] += 2 / G.dpr(c); return q; };
    try { return ${SCAN}(${JSON.stringify([...labels])}, ''); } finally { G.snap = snap; } })()`);
  if (r.nbad > 0) { caught++; console.log(`   ✓ break caught: glyph quads 2 device px too tall (${r.nbad}/${r.n} renders flagged)`); } else fails.push('a glyph quad 2 device px too tall was not flagged');
}
// the original bug: glyph quads NOT snapped to whole device pixels (fractional dpr / centred text)
{
  const r = await ev2(`(() => { const G = MCL.Gui, snap = G.snap; G.snap = (x, y, w, h) => [x, y, w, h];
    try { return ${SCAN}(${JSON.stringify([...labels])}, ''); } finally { G.snap = snap; } })()`);
  if (r.nbad > 0) { caught++; console.log(`   ✓ break caught: unsnapped glyph quads (${r.nbad}/${r.n} renders flagged)`); } else fails.push('unsnapped glyph quads were not flagged');
}
await page2.close();
ok(caught === 4, `only ${caught} of 4 breaks caught`);
if (fails.length) { console.log('FAIL:'); for (const f of fails) console.log('   ✗ ' + f); process.exit(1); }
console.log(`menutextcheck: ${pass} assertions, 0 failed, ${caught} breaks caught`);
