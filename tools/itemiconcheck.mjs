#!/usr/bin/env node
// itemiconcheck.mjs — #4982: EVERY ITEM ICON, against the item model and ItemColors.
//
//   node tools/itemiconcheck.mjs [--verbose]
//
// ⚠ WHY. Dan, 10 Oct: in the hotbar and the inventory small dripleaf and chorus plant drew the
// wrong texture, and fern and grass were grey. Three causes, none of them those four items:
//   (a) a block ITEM was drawn from the PLACED BLOCK's default state, not from the item's own
//       model (`item/small_dripleaf` -> block/small_dripleaf_top, `item/chorus_plant` ->
//       block/chorus_plant, a stair at gui [30,135,0]);
//   (b) ItemColors had no entry for the block items it covers (grass, fern, tall grass, large
//       fern, vine, lily pad, six leaves, grass block), so their sprites drew grey;
//   (c) the item's own `gui` display transform was ignored for every block item.
// The expectation below is NOT read from the packer: the item model is the registry JSON the
// extractor read from the jar (assets/item-registry.json), the colours are the constants in the
// decompiled `ItemColors.create` / `BlockColors.create` (.decomp/net/minecraft/client/color), and
// the grass colour is pixel (127,127) of the jar's colormap/grass.png.
//
// For EVERY real item it checks the packed table: sprite layers (right texture, right baked tint),
// block items (right quads, right gui transform, right tint, and the PIXELS of the icon equal an
// independent render of the JSON model), and that no item outside the ItemColors list is tinted.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { loadEngine, initRegistry, MCLITE_ROOT, ASSETS } from './loadsrc.mjs';
import { Jar } from './jarlib.mjs';
import { decodePng } from './png.mjs';
import { JARS } from './paths.mjs';

const VERBOSE = process.argv.includes('--verbose');
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
console.log('itemiconcheck — #4982, every item icon against its model and ItemColors');

const rd = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const REG = rd('item-registry.json');
const AIDX = rd('item-atlas-index.json');
const NS = loadEngine({ extra: ['02g_items.js', '06_atlas.js', '06b_tintmap.js', '10_gfx.js', '15d_blockicon.js'], dom: false });
initRegistry(NS);
const IT = NS.Items, BI = NS.BlockIcon;

// ── the block atlas, as iconcheck builds it (level 0 only: that is all the rasteriser reads) ──
{
  const meta = rd('block-tiles.meta.json');
  const lvl0 = new Uint8Array(inflateRawSync(readFileSync(join(ASSETS, 'block-tiles.bin'))));
  NS.Atlas.mips = [{ size: Math.round(Math.sqrt(lvl0.length / meta.count / 4)), data: lvl0 }];
  NS.Atlas.tiles = meta.count;
}
// ── the item sprite tiles ──
const im = rd('item-tiles.meta.json');
const ITILES = new Uint8Array(inflateRawSync(readFileSync(join(ASSETS, 'item-tiles.bin'))));
const TS = im.tile * im.tile * 4;
const tileBytes = (t) => ITILES.subarray(t * TS, (t + 1) * TS);

const imeta = rd('items.meta.json');
ok(IT.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: imeta.rawBytes }) === true, 'the packed item table decodes');

// ── the vanilla colours (decompiled ItemColors / BlockColors / FoliageColors) ──
let jar = null;
for (const f of [JARS + '/1.18.2.jar', JARS + '/1.18.2/1.18.2.jar']) if (existsSync(f)) { jar = new Jar(f); break; }
ok(!!jar, 'the 1.18.2 jar is reachable for colormap/grass.png');
const gp = decodePng(jar.read('assets/minecraft/textures/colormap/grass.png'));
const gi = (127 * gp.width + 127) * 4;                       // GrassColors.getColor(0.5, 1.0)
const GRASS = (gp.data[gi] << 16) | (gp.data[gi + 1] << 8) | gp.data[gi + 2];
const FOLIAGE = 4764952, SPRUCE = 6396257, BIRCH = 8431445, LILY = 7455580;
const EXPECT = {};                                           // name -> [tint0, tint1]
for (const n of ['grass_block', 'grass', 'fern', 'tall_grass', 'large_fern']) EXPECT[n] = [GRASS, -1];
for (const n of ['oak_leaves', 'jungle_leaves', 'acacia_leaves', 'dark_oak_leaves', 'vine']) EXPECT[n] = [FOLIAGE, -1];
EXPECT.spruce_leaves = [SPRUCE, -1]; EXPECT.birch_leaves = [BIRCH, -1]; EXPECT.lily_pad = [LILY, -1];
for (const l of readFileSync(join(MCLITE_ROOT, 'tools/golden/item-tints-1.18.2.tsv'), 'utf8').split(/\r?\n/)) {
  const c = l.split('\t');
  if (c[0] === 'EGG') EXPECT[c[1].replace('minecraft:', '')] = [+c[2], +c[3]];
  if (c[0] === 'DYEABLE') EXPECT[c[1].replace('minecraft:', '')] = [10511680, -1];
}
for (const n of ['potion', 'splash_potion', 'lingering_potion', 'tipped_arrow']) EXPECT[n] = [16253176, -1];
EXPECT.filled_map = [-1, -12173266]; EXPECT.firework_star = [-1, 9079434];
const rgbOf = (c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];

// ── an independent render of the JSON model, through the same rasteriser ──
function jsonModel(item) {
  const parts = REG.parts[item.part];
  const MAP = [3, 2, 5, 4, 1, 0];
  const pos = new Int16Array(parts.length * 12), uv = new Int16Array(parts.length * 8), quads = [];
  parts.forEach((q, k) => {
    for (let i = 0; i < 12; i++) pos[k * 12 + i] = Math.round(q.p[i] * 16);
    for (let i = 0; i < 8; i++) uv[k * 8 + i] = Math.round(q.uv[i] * 16);
    quads.push({ tile: q.t, face: MAP[q.d], tint: q.tint < 0 ? 0 : q.tint + 1, q: k });
  });
  const g = item.gui || { rotation: [30, 225, 0], translation: [0, 0, 0], scale: [0.625, 0.625, 0.625] };
  const e = EXPECT[item.name];
  return { quads, pos, uv, rotX: g.rotation[0], rotY: g.rotation[1], scale: g.scale[0],
           tx: g.translation[0], ty: g.translation[1], rgb: e && e[0] >= 0 ? rgbOf(e[0]).map((v) => v / 255) : null };
}

// ── THE AUDIT: returns [{item, cls, why}] ────────────────────────────────────────────────────
const real = Object.values(REG.items).filter((i) => i.real);
function audit(opt) {
  const bad = [];
  const flag = (item, cls, why) => bad.push({ item: item.name, cls, why });
  for (const item of real) {
    const idx = IT.index[item.name];
    if (idx === undefined) { flag(item, 'missing', 'not in the packed table'); continue; }
    const want = EXPECT[item.name] || [-1, -1];
    if (IT.tint0[idx] !== want[0] || IT.tint1[idx] !== want[1]) flag(item, 'tint', `tint ${IT.tint0[idx]},${IT.tint1[idx]} want ${want}`);
    if (item.kind === 'flat') {
      const lay = IT.layersOf(idx);
      if (lay.length !== item.layers.length) { flag(item, 'texture', `${lay.length} layers, model has ${item.layers.length}`); continue; }
      lay.forEach((t, L) => {
        const base = AIDX.index[item.layers[L]];
        if (base === undefined) { flag(item, 'texture', `no atlas tile for ${item.layers[L]}`); return; }
        const col = want[L] >= 0 ? rgbOf(want[L]) : null;
        const src = tileBytes(base), got = tileBytes(t);
        for (let o = 0; o < TS; o += 4) {
          for (let c = 0; c < 3; c++) {
            const e = col ? ((src[o + c] * col[c] + 127) / 255 | 0) : src[o + c];
            if (Math.abs(e - got[o + c]) > 1 && got[o + 3] > 0) { flag(item, col ? 'tint' : 'texture', `layer ${L} pixel ${o / 4} differs from ${item.layers[L]}${col ? ' x ' + want[L] : ''}`); return; }
          }
        }
      });
    } else if (item.kind === 'block') {
      if (IT.modelPartOf(idx) < 0) { flag(item, 'shape', 'a block item with no model part (drawn from the placed block)'); continue; }
      const ref = jsonModel(item), M = BI.itemModel(idx);
      const parts = REG.parts[item.part];
      if (!M || M.quads.length !== parts.length) { flag(item, 'shape', `${M ? M.quads.length : 0} quads, model has ${parts.length}`); continue; }
      const g = IT.guiTransform(idx), wg = item.gui ? [...item.gui.rotation, ...item.gui.translation, ...item.gui.scale] : null;
      if ((g === null) !== (wg === null) || (g && g.some((v, i) => Math.abs(v - wg[i]) > 1e-4))) { flag(item, 'gui', `gui transform ${JSON.stringify(g)} want ${JSON.stringify(wg)}`); continue; }
      if (opt && opt.pixels === false) continue;
      const a = BI.renderState(0, 48, M), b = BI.renderState(0, 48, ref);
      let diff = 0;
      for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 2) diff++;
      if (diff) flag(item, 'pixels', `${diff} channel values differ from the model render`);
    }
  }
  return bad;
}

const t0 = Date.now();
const bad = audit();
const byClass = {};
for (const b of bad) (byClass[b.cls] = byClass[b.cls] || []).push(b.item);
const sprite = real.filter((i) => i.kind === 'flat').length, block = real.filter((i) => i.kind === 'block').length;
console.log(`   ${real.length} real items: ${sprite} sprites, ${block} block models, ${real.length - sprite - block} builtin/entity (BE-rendered, not covered here)`);
console.log(`   tinted by ItemColors: ${Object.keys(EXPECT).length} (${Object.keys(EXPECT).filter((n) => REG.items[n] && REG.items[n].kind === 'block').length} block models, ${Object.keys(EXPECT).filter((n) => REG.items[n] && REG.items[n].kind === 'flat').length} sprites)   audit ${Date.now() - t0} ms`);
for (const k of Object.keys(byClass)) console.log(`   FAIL class ${k}: ${byClass[k].length} items  ${byClass[k].slice(0, 8).join(' ')}`);
ok(bad.length === 0, `${bad.length} items draw wrong: ` + bad.slice(0, 6).map((b) => `${b.item}[${b.cls}] ${b.why}`).join('; '));
// the four named ones, spelled out so a regression names itself
for (const n of ['small_dripleaf', 'chorus_plant', 'fern', 'grass']) ok(!bad.some((b) => b.item === n), `${n} draws right`);
ok(IT.tint0[IT.index.fern] === GRASS && GRASS > 0, `fern is tinted ${GRASS.toString(16)} (GrassColors.getColor(0.5, 1.0))`);

// ── THE MEASUREMENT (#4982): how many block items the OLD path (the placed block's default state, one
// fixed transform, no ItemColors) drew differently from the item model. Informational; the audit above is the gate.
{
  const R = NS.Reg; let differ = 0, guiOnly = 0, empty = 0, tintOnly = 0; const names = [];
  for (const item of real) {
    if (item.kind !== 'block') continue;
    const idx = IT.index[item.name], bid = R.id[item.block] !== undefined ? R.id[item.block] : R.id[item.name];
    const st = IT.stateOf(idx);
    const oldBuf = st > 0 ? BI.renderState(st, 48) : new Uint8ClampedArray(48 * 48 * 4);
    const newBuf = BI.renderItem(idx, 48);
    let d = 0, oa = 0; for (let i = 0; i < newBuf.length; i += 4) { if (oldBuf[i + 3]) oa++; if (Math.abs(oldBuf[i] - newBuf[i]) + Math.abs(oldBuf[i + 1] - newBuf[i + 1]) + Math.abs(oldBuf[i + 2] - newBuf[i + 2]) + Math.abs(oldBuf[i + 3] - newBuf[i + 3]) > 12) d++; }
    if (d) { differ++; if (!oa) empty++; else if (EXPECT[item.name]) tintOnly++; else if (item.gui && item.gui.rotation[1] !== 225) guiOnly++; names.push(item.name); }
  }
  console.log(`   measured: ${differ} of ${block} block items differ from the old placed-block icon (${empty} drew nothing, ${tintOnly} tint-only candidates, ${guiOnly} other gui transform)`);
  if (VERBOSE) console.log('   ' + names.join(' '));
}

// ── ANTI-VACUITY (D-30): break the data and the audit must say so ──
const caught = (name, mutate, undo, cls) => {
  mutate(); const r = audit({ pixels: true }); undo(); breaks++;
  const hit = r.some((b) => !cls || b.cls === cls);
  ok(hit, `anti-vacuity: ${name} not caught`);
  if (hit) console.log('   ✓ ' + name);
};
{
  const fi = IT.index.fern, t = IT.tint0[fi];
  caught('fern loses its tint', () => { IT.tint0[fi] = -1; }, () => { IT.tint0[fi] = t; }, 'tint');
  const lay = IT.layerOff[fi], lt = IT.layerTile[lay], gt = IT.layerTile[IT.layerOff[IT.index.grass]];
  caught('fern draws grass\'s sprite', () => { IT.layerTile[lay] = gt; }, () => { IT.layerTile[lay] = lt; }, null);
  const di = IT.index.small_dripleaf, ci = IT.index.chorus_plant, dp = IT.mPart[di];
  caught('small dripleaf takes chorus plant\'s model', () => { IT.mPart[di] = IT.mPart[ci]; }, () => { IT.mPart[di] = dp; }, 'shape');
  const si = IT.index.oak_stairs, gx = IT.mGuiIdx[si];
  caught('a stair loses its [30,135,0] gui transform', () => { IT.mGuiIdx[si] = 255; }, () => { IT.mGuiIdx[si] = gx; }, 'gui');
  const li = IT.index.birch_leaves, lc = IT.tint0[li];
  caught('birch leaves take the oak foliage colour', () => { IT.tint0[li] = FOLIAGE; }, () => { IT.tint0[li] = lc; }, 'tint');
  caught('an item outside the table (a stick) is tinted', () => { IT.tint0[IT.index.stick] = 0xFF00FF; }, () => { IT.tint0[IT.index.stick] = -1; }, 'tint');
}
if (fails.length) { fails.forEach((f) => console.log('  ✗ ' + f)); console.log(` assertions passed .... ${pass}\n failures ........... ${fails.length}\n ${breaks} breaks caught`); process.exit(1); }
console.log(` assertions passed .... ${pass}\n failures ........... 0\n ${breaks} breaks caught`);
