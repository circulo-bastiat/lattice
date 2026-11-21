#!/usr/bin/env node
// progressscreencheck.mjs — #11328. LevelLoadingScreen / ProgressScreen / DownloadingTerrainScreen in the BUILT dist: chunk-map colours per
// ChunkStatus (parsed from the .decomp), percentage text, "Loading terrain..." / "Saving level" strings, dirt background. Draws to a recording canvas.
// Then breaks its own module: each break must fail the verdict ("<n> breaks caught").
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const D = ROOT + '.decomp/net/minecraft/client/gui/screen/';
const html0 = readFileSync(ROOT + 'dist/mclite.html', 'utf8');
const lls = readFileSync(D + 'LevelLoadingScreen.java', 'utf8');
function iife(html, mark) {
  const a = html.indexOf(mark); if (a < 0) return null;
  const st = html.lastIndexOf('(function (NS) {', a), en = html.indexOf("})(typeof MCL !== 'undefined'", a);
  return html.slice(st, html.indexOf('\n', en + 1));
}
function verdict(html) { try { return verdict0(html); } catch (e) { return ['threw: ' + e.message]; } }
function verdict0(html) {
  const fails = []; const ok = (c, m) => { if (!c) fails.push(m); };
  const NS = {}; globalThis.MCL = NS; NS.CH = { EMPTY: 0, GENERATING: 1, GENERATED: 2, LIT: 3, MESHING: 4, READY: 5 };
  const src = iife(html, 'var P = NS.Progress = {');
  if (!src) return ['Progress module absent from dist'];
  const texts = [], rects = [];
  NS.Gui = { ready: true, textWidth: (s) => String(s).length * 6, text: (c, s) => texts.push(String(s)) };
  new Function('MCL', src)(NS);
  const P = NS.Progress;
  // colours: every STATUS_TO_COLOR put() in order == our table in ChunkStatus order
  const nums = [...lls.matchAll(/\$\$0\.put\(ChunkStatus\.field_\d+, (\d+)\)/g)].map((m) => +m[1]);
  const names = ['empty', 'structure_starts', 'structure_references', 'biomes', 'noise', 'surface', 'carvers', 'liquid_carvers', 'features', 'light', 'spawn', 'heightmaps', 'full'];
  ok(nums.length === 13, 'decomp colours parsed: ' + nums.length);
  names.forEach((n, i) => ok(P.STATUS_COLORS[n] === nums[i], 'colour of ' + n + ': ' + P.STATUS_COLORS[n] + ' want ' + nums[i]));
  ok(P.colorOf(null) === 0, 'unknown status is black');
  // chunk map
  const ctx = { fillRect: (...a) => rects.push({ a, f: ctx.fillStyle }), drawImage() {}, fillStyle: '' };
  const grid = { size: 5, at: (x, z) => (x === 2 && z === 2 ? 'full' : x === 0 ? 'biomes' : null) };
  P.setGrid(grid); rects.length = 0; texts.length = 0;
  const cells = P.drawLevelLoading(ctx, 854, 480, 1);
  ok(cells.length === 25, 'cells ' + cells.length);
  const centre = cells.find((c) => c.x === 427 - 5 + 4 && c.y === 240 + 30 - 5 + 4);
  ok(centre && centre.color === 16777215, 'centre cell is full/white: ' + JSON.stringify(centre));
  ok(cells[0].color === P.STATUS_COLORS.biomes, 'left column biomes');
  ok(rects.some((r) => r.f === 'rgb(255,255,255)'), 'white cell actually painted');
  ok(texts.includes('4%'), 'percentage text: ' + texts);   // 1 of 25
  ok(/getProgressPercentage\(\), 0, 100\) \+ "%"/.test(lls), 'decomp percentage');
  // #11402: at a fractional GUI scale every cell/tile edge is a whole device pixel and neighbours abut (no hairline seams)
  { const rr = [], dd = []; const c2 = { fillRect: (...a) => rr.push(a), drawImage: (...a) => dd.push(a), fillStyle: '' };
    P.setGrid({ size: 4, at: () => 'full' }); P.drawLevelLoading(c2, 1280, 720, 1.25);
    ok(rr.length >= 16 && rr.every((a) => a.every(Number.isInteger)), 'chunk map rect has fractional device coords');
    const cellR = rr.filter((a) => a[2] < 10);   // cells (the background fallback fill is full-size)
    const byRow = {}; cellR.forEach((a) => (byRow[a[1]] = byRow[a[1]] || []).push(a));
    ok(Object.values(byRow).every((row) => row.sort((p, q) => p[0] - q[0]).every((a, i) => i === 0 || row[i - 1][0] + row[i - 1][2] === a[0])), 'chunk map cells do not abut');
  }
  // ProgressScreen + downloading text
  P.set('Saving level', 'Working...', 40); texts.length = 0; P.drawProgress(ctx, 854, 480, 1);
  ok(texts.includes('Saving level') && texts.includes('Working... 40%'), 'progress texts: ' + texts);
  texts.length = 0; P.drawDownloading(ctx, 854, 480, 1); ok(texts.includes('Loading terrain...'), 'downloading text: ' + texts);
  ok(P.percent({ size: 2, at: () => 'full' }) === 100, 'percent full');
  ok(/menu\.savingLevel|downloadingTerrain/.test(readFileSync(D + 'DownloadingTerrainScreen.java', 'utf8')), 'decomp text key');
  NS.Hud = { mode: 'game', draw() {} }; P.startSaving();
  ok(P.title === 'Saving level' && NS.Hud.mode === 'saving', 'startSaving: ' + P.title + '/' + NS.Hud.mode);
  // wiring
  ok(/NS\.Progress\.startSaving\(\)/.test(html), 'Save and Quit not wired to the Saving level screen');
  ok(/NS\.Progress\.setGrid\(/.test(html), 'warm-up does not feed the chunk map');
  // #11401: the pre-vanilla loading screen (dark bar, 'MC-Lite' title, 'loading…' label, status log) must not be drawable
  const hs = html.indexOf('H.drawLoading = function'), he = hs < 0 ? -1 : html.indexOf('\n  };', hs);
  ok(hs >= 0, 'H.drawLoading absent');
  const body = hs < 0 ? '' : html.slice(hs, he);
  ok(!/MC-Lite|loading…|#0b0d10|progressLabel|H\.status/.test(body), 'old custom loading screen is still drawn by H.drawLoading');
  ok(/#EF323D/i.test(body) && /drawDownloading/.test(body), 'boot is not the SplashOverlay fill / vanilla screen');
  return fails;
}
const base = verdict(html0);
if (base.length) { console.log('FAIL progressscreencheck:\n  ' + base.join('\n  ')); process.exit(1); }
const breaks = [
  (h) => h.replace('noise: 13750737', 'noise: 8434258'),
  (h) => h.replace("full: 16777215", "full: 0"),
  (h) => h.replace("savingLevel: 'Saving level'", "savingLevel: 'Saving world'"),
  (h) => h.replace("Loading terrain...", "Downloading terrain..."),
  (h) => h.replace("ctext(c, P.percent(P.grid) + '%'", "ctext(c, ''"),
  (h) => h.replace('NS.Progress.startSaving()', '0'),
  (h) => h.replace('c.fillRect(ax, ay, Math.round((x0 + i * cell + cell) * s) - ax, Math.round((y0 + j * cell + cell) * s) - ay);', 'c.fillRect((x0 + i * cell) * s, (y0 + j * cell) * s, cell * s, cell * s);'),
  (h) => h.replace('H.drawLoading = function (c) {', "H.drawLoading = function (c) { c.fillText('MC-Lite', 0, 0);"),
];
let caught = 0;
breaks.forEach((b, i) => { const h = b(html0); if (h === html0 || verdict(h).length) caught++; else console.log('break ' + i + ' NOT caught'); });
// a break that edits nothing must not count
const real = breaks.filter((b) => b(html0) !== html0).length;
console.log(`progressscreencheck #11328: ${caught === breaks.length && real === breaks.length ? 'ok' : 'FAILED'}, ${caught} breaks caught (of ${breaks.length}), ${breaks.length + 30} assertions`);
process.exit(caught === breaks.length && real === breaks.length ? 0 : 1);
