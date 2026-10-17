#!/usr/bin/env node
// build-biomesheet.mjs — PLAN W5, the reviewable half. All 61 biomes and every colour each one
// carries, as a page you can open.
//
//   node tools/build-biomesheet.mjs [--out dist/biomes.html]
//
// `biomecheck` proves the numbers against a hand-written reference. This proves them against
// Dan, which is a different and equally necessary test: a colour that is *correct* and looks
// wrong is still worth knowing about, and no assertion can tell you that.
//
// It is the same idea as `gallery.html` for blocks and `gencheck`'s ASCII cross-sections for
// terrain — an artefact a human can look at in ten seconds, generated from the same runtime
// modules the game uses rather than from a parallel description of them.
//
// ⚠ This is NOT the render seam (D-121) — that is `src/06b_tintmap.js`, which landed in W6 and
// is proven by `tools/tintcheck.mjs`. This sheet shows what a biome's colours ARE; the seam is
// what makes a block in the world take one. When the two disagree, one of them is wrong, and
// this page is the half a person can check.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from './png.mjs';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = MCLITE_ROOT + 'src';
const ASSETS = MCLITE_ROOT + 'assets';
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const OUT = opt('out', MCLITE_ROOT + 'dist/biomes.html');

const t0 = Date.now();
const NS = { CFG: {} };
globalThis.MCL = NS;
for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '02d_wgdata.js', '03b_noise.js',
                 '04d_column.js', '04e_climate.js', '04f_earth.js', '04g_biomes.js']) {
  new Function('MCL', readFileSync(join(SRC, f), 'utf8'))(NS);
}
const meta = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
NS.WG.init({
  worldgen: readFileSync(join(ASSETS, 'worldgen.bin')).toString('base64'),
  worldgenBytes: meta('worldgen.meta.json').jsonBytes,
});
NS.Biomes.initColormaps({
  colormaps: readFileSync(join(ASSETS, 'colormaps.bin')).toString('base64'),
  colormapsBytes: meta('colormaps.meta.json').rawBytes,
});
NS.Biomes.init();
NS.Climate.init({
  biomeParams: readFileSync(join(ASSETS, 'biome-params.bin')).toString('base64'),
  biomeParamsBytes: meta('biome-params.meta.json').rawBytes,
});
const B = NS.Biomes, CL = NS.Climate;
const hx = (c) => '#' + (c >>> 0).toString(16).padStart(6, '0');
const short = (n) => n.replace('minecraft:', '');
const overworld = new Set(CL.biomeNames.map(short));

// A readable text colour on a given background — the sheet is unreadable without it on the
// dark End biomes and the pale desert ones alike.
const ink = (c) => (((c >> 16) & 255) * 0.299 + ((c >> 8) & 255) * 0.587 + (c & 255) * 0.114 > 140 ? '#111' : '#eee');

const rows = [];
for (let i = 0; i < B.count; i++) {
  const r = B.at(i);
  const n = short(r.name);
  // The swamp's grass is positional, so the sheet shows both of the two colours it can be.
  const grassCells = r.grassModifier === B.MOD_SWAMP
    ? [B.grassColorAt(i, 0, 0), B.grassColorAt(i, 16, 16)]
    : [B.grassColorAt(i, 0, 0)];
  rows.push({
    name: n,
    where: overworld.has(n) ? 'overworld' : 'other',
    t: r.temperature, d: r.downfall,
    precip: ['none', 'rain', 'snow'][r.precipitation],
    grass: grassCells, foliage: r.foliage, water: r.waterColor,
    waterFog: r.waterFogColor, fog: r.fogColor, sky: r.skyColor,
    over: (r.grassOverride >= 0 ? 'grass' : '') + (r.foliageOverride >= 0 ? (r.grassOverride >= 0 ? '+foliage' : 'foliage') : ''),
    mod: ['', 'dark_forest', 'swamp'][r.grassModifier],
    tmod: r.frozenTemp ? 'frozen' : '',
    spawnGroups: Object.keys(r.spawners).length,
    spawnEntries: Object.values(r.spawners).reduce((a, v) => a + v.length, 0),
    features: r.features.reduce((a, v) => a + v.length, 0),
    carvers: Object.values(r.carvers).reduce((a, v) => a + v.length, 0),
  });
}
rows.sort((a, b) => (a.where === b.where ? a.name.localeCompare(b.name) : (a.where === 'overworld' ? -1 : 1)));

const swatch = (c, label) =>
  `<span class="sw" style="background:${hx(c)};color:${ink(c)}" title="${label || ''}">${hx(c).slice(1).toUpperCase()}</span>`;

const body = rows.map((r) => `<tr class="${r.where}">
<td class="n">${r.name}${r.where === 'other' ? ' <em>·</em>' : ''}</td>
<td class="num">${r.t}</td><td class="num">${r.d}</td><td class="p ${r.precip}">${r.precip}</td>
<td>${r.grass.map((g) => swatch(g)).join('')}${r.mod ? `<b>${r.mod}</b>` : ''}${r.over.indexOf('grass') === 0 ? '<b>override</b>' : ''}</td>
<td>${swatch(r.foliage)}${r.over.indexOf('foliage') >= 0 ? '<b>override</b>' : ''}</td>
<td>${swatch(r.water)}</td><td>${swatch(r.waterFog)}</td>
<td>${swatch(r.fog)}</td><td>${swatch(r.sky)}</td>
<td class="num">${r.spawnEntries}<em>/${r.spawnGroups}</em></td>
<td class="num">${r.features}</td><td class="num">${r.carvers}</td>
<td class="t">${r.tmod}</td></tr>`).join('\n');

// The two ramps themselves, so that the shape of the triangle and the position of each biome
// on it are both visible. A biome that has drifted onto the wrong part of the ramp is obvious
// here and invisible in a table of hex codes.
//
// Encoded as PNGs and inlined as data URIs rather than drawn as 16,384 `<i>` elements — the
// first draft did that and produced a 1.1 MB page for two 256x256 images.
const GRIDPX = 384;
function rampPng(which) {
  const rgba = Buffer.alloc(256 * 256 * 4);   // a Buffer, not a Uint8Array: png.mjs's row filter uses .copy
  for (let j = 0; j < 256; j++) {
    for (let i = 0; i < 256; i++) {
      const c = B.rampAt(which, i, j);
      const o = (j * 256 + i) * 4;
      rgba[o] = (c >> 16) & 255; rgba[o + 1] = (c >> 8) & 255; rgba[o + 2] = c & 255; rgba[o + 3] = 255;
    }
  }
  return 'data:image/png;base64,' + Buffer.from(encodePng(256, 256, rgba)).toString('base64');
}
const ramps = { grass: rampPng('grass'), foliage: rampPng('foliage') };

// Where each biome sits on the ramp, in the ramp's own coordinates: i across, j down.
const clamp01 = (v) => (v < 0 ? 0 : (v > 1 ? 1 : v));
const marks = rows.filter((r) => r.where === 'overworld' && r.over.indexOf('grass') !== 0).map((r) => {
  const t = clamp01(r.t), h = clamp01(r.d) * t;
  return { name: r.name, x: Math.trunc((1 - t) * 255) / 256 * GRIDPX, y: Math.trunc((1 - h) * 255) / 256 * GRIDPX };
});

const HTML = `<!doctype html><meta charset="utf-8"><title>MC-Lite — biomes</title>
<style>
 body{font:13px ui-monospace,Consolas,monospace;background:#15181c;color:#d8dde4;margin:0;padding:22px}
 h1{font:600 20px system-ui;margin:0 0 2px}
 p.sub{color:#8d95a1;margin:0 0 18px;font:12px system-ui}
 table{border-collapse:collapse;font-size:12px}
 th{text-align:left;padding:5px 8px;color:#8d95a1;font-weight:600;border-bottom:1px solid #333a44;position:sticky;top:0;background:#15181c}
 td{padding:2px 8px;border-bottom:1px solid #22262c;white-space:nowrap}
 td.n{color:#e8e8e8}
 tr.other td.n{color:#8d95a1}
 tr.other{opacity:.72}
 .sw{display:inline-block;min-width:62px;text-align:center;padding:2px 5px;margin-right:3px;border-radius:2px;font-size:11px;letter-spacing:.3px}
 td.num{text-align:right;color:#a8b0ba}
 td em{color:#666d77;font-style:normal}
 td b{font-weight:600;color:#c9a227;margin-left:5px;font-size:10px}
 td.p{font-size:11px}
 .rain{color:#6ea8e8}.snow{color:#cfe3f5}.none{color:#8d7b52}
 .ramps{display:flex;gap:26px;margin:26px 0 8px;flex-wrap:wrap}
 .ramp{position:relative}
 .plot{position:relative;width:${GRIDPX}px;height:${GRIDPX}px}
 .ramp h2{font:600 12px system-ui;color:#8d95a1;margin:0 0 6px}
 .ramp img{image-rendering:pixelated;display:block;border:1px solid #333a44}
 .mark{position:absolute;width:5px;height:5px;border:1px solid #fff;border-radius:50%;transform:translate(-3px,-3px);box-shadow:0 0 0 1px #000}
 .legend{color:#8d95a1;font:11px system-ui;margin-top:6px}
</style>
<h1>MC-Lite — the 61 biomes of 1.18.2</h1>
<p class="sub">Generated by <code>tools/build-biomesheet.mjs</code> from the same runtime modules the game loads.
Grass and foliage come from the two colormaps in the client jar; the rest are literal fields.
The ${rows.filter((r) => r.where === 'other').length} greyed rows are Nether and End biomes the overworld climate table never selects.
The game itself is tinted from these numbers by the W6 tint map, one texel per four blocks.</p>

<div class="ramps">
${['grass', 'foliage'].map((k) => `<div class="ramp"><h2>${k}.png &mdash; temperature across, humidity down</h2>
<div class="plot"><img src="${ramps[k]}" width="${GRIDPX}" height="${GRIDPX}" alt="${k} colormap">
${k === 'grass' ? marks.map((m) => `<div class="mark" style="left:${m.x.toFixed(1)}px;top:${m.y.toFixed(1)}px" title="${m.name}"></div>`).join('') : ''}
</div></div>`).join('')}
</div>
<p class="legend">Marks on the grass ramp are the overworld biomes that use it (the three badlands override it instead).</p>

<table>
<tr><th>biome</th><th>temp</th><th>rain</th><th>precip</th><th>grass</th><th>foliage</th><th>water</th><th>water fog</th><th>fog</th><th>sky</th><th>spawns</th><th>feat</th><th>carv</th><th>temp mod</th></tr>
${body}
</table>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, HTML);

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log('');
console.log('================ build-biomesheet ================');
console.log(` biomes ............ ${rows.length}   (${rows.filter((r) => r.where === 'overworld').length} overworld, ${rows.filter((r) => r.where === 'other').length} other dimensions)`);
console.log(` grass overrides ... ${rows.filter((r) => r.over.indexOf('grass') === 0).length}   foliage overrides ${rows.filter((r) => r.over.indexOf('foliage') >= 0).length}`);
console.log(` grass modifiers ... ${rows.filter((r) => r.mod).length}   temperature modifiers ${rows.filter((r) => r.tmod).length}`);
console.log(` output ............ ${kb(HTML.length)}  ->  ${OUT}`);
console.log(` ${Date.now() - t0} ms`);
console.log('=================================================');
