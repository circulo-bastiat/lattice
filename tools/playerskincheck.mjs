#!/usr/bin/env node
// playerskincheck.mjs -- #211 G18a-3: the PLAYER model drawn through the mob path with the
// default skin from the jar (steve.png / alex.png).
//
//   node tools/playerskincheck.mjs [--verbose]
//
//   1. the model: `player` (Steve, 4-wide arms) and `player_slim` (Alex, 3-wide) are 14-part
//      layers whose boxes are PlayerEntityModel.getTexturedModelData's (.decomp), incl. the
//      0.25-dilated jacket/sleeves/pants over the base parts.
//   2. the roster: ER.mobLayerFor draws both; `ear` and `cloak` (PlayerEntityModel.renderEars/
//      renderCape -- never from a default skin) cost and emit no quads.
//   3. setupAnim: sleeves/pants/jacket take EXACTLY the pose of the part they cover
//      (PlayerEntityModel.setAngles' copyTransform x5), swing and arm-swing alike.
//   4. the skin: every slice of every drawn face samples the jar's own pixels -- steve.png for
//      `player`, alex.png for `player_slim` -- an independent decode, not the packer's state.
//      (The browser mob stage's pixel probe of the live picture is that stage's job; this is
//      the packed-data half it stands on, like mobtexcheck's.)
//   5. anti-vacuity: each of the above is broken on purpose and the assertion is watched to fire.

import { readFileSync } from 'node:fs';
import { inflateRawSync, constants as ZLIB } from 'node:zlib';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';
import { Jar } from './jarlib.mjs';
import { decodePng } from './png.mjs';
import { requireJar } from './paths.mjs';

const VERBOSE = process.argv.includes('--verbose');
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const caught = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('  ✓ break caught: ' + m); };

console.log('playerskincheck -- #211, the player model + default skin through the mob path');

const A = MCLITE_ROOT + 'assets/';
const M = loadEngine({
  extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
          '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js'],
  dom: false
});
initRegistry(M);
const mm = JSON.parse(readFileSync(A + 'models.meta.json', 'utf8'));
M.BEModel.init({ models: readFileSync(A + 'models.bin').toString('base64'), modelsBytes: mm.rawBytes });
M.Entities.init(); M.EntityList.init(); M.EntityRender.init();
const ER = M.EntityRender, BE = M.BEModel;

const geomRaw = readFileSync(A + 'mob-geometry.json');
const geom = JSON.parse(geomRaw.toString('utf8'));
const { deflateRawSync } = await import('node:zlib');
M.DATA = Object.assign({}, M.DATA, { mobGeometry: deflateRawSync(geomRaw, { level: 9 }).toString('base64'), mobGeometryBytes: geomRaw.length });

// ── 1. the model ──────────────────────────────────────────────────────────────────────────
const NAMES = ['body', 'cloak', 'ear', 'hat', 'head', 'jacket', 'left_arm', 'left_leg', 'left_pants',
               'left_sleeve', 'right_arm', 'right_leg', 'right_pants', 'right_sleeve'];
const part = (L, n) => L.parts.find((p) => p.n === n);
function modelFails(steve, alex) {
  let bad = 0; const b = (c, m) => { if (!c) { bad++; if (VERBOSE) console.log('   x ' + m); } };
  for (const [nm, L, arm] of [['player', steve, 4], ['player_slim', alex, 3]]) {
    b(!!L && L.parts.length === 14, nm + ' is not 14 parts');
    if (!L) continue;
    b(NAMES.every((n) => !!part(L, n)), nm + ' misses a PlayerEntityModel part');
    const la = part(L, 'left_arm'), ra = part(L, 'right_arm'), ls = part(L, 'left_sleeve');
    b(la && la.w === arm && ra && ra.w === arm, nm + ' arm width is not ' + arm);
    b(la && la.tu === 32 && la.tv === 48 && !la.m, nm + ' left_arm is not the 64x64 skin\'s own (32,48) unmirrored arm');
    b(ls && ls.w === arm + 0.5 && ls.h === 12.5 && ls.tu === 48 && ls.tv === 48, nm + ' left_sleeve is not the 0.25-dilated (48,48) box');
    const j = part(L, 'jacket');
    b(j && j.w === 8.5 && j.h === 12.5 && j.d === 4.5 && j.tu === 16 && j.tv === 32, nm + ' jacket');
    const lp = part(L, 'left_pants'), rp = part(L, 'right_pants');
    b(lp && lp.tu === 0 && lp.tv === 48 && rp && rp.tu === 0 && rp.tv === 32, nm + ' pants uv');
    b(la && la.py === (arm === 3 ? 2.5 : 2), nm + ' arm pivot y');
  }
  return bad;
}
ok(modelFails(BE.layer('player'), BE.layer('player_slim')) === 0, 'the player/player_slim boxes are not PlayerEntityModel\'s');
{
  const clone = (L, f) => ({ parts: L.parts.map((p) => f({ ...p })) });
  caught(modelFails(clone(BE.layer('player'), (p) => (p.n === 'left_arm' ? { ...p, w: 3 } : p)), BE.layer('player_slim')) > 0, 'a slim arm on Steve is caught');
  caught(modelFails(BE.layer('player'), clone(BE.layer('player_slim'), (p) => (p.n === 'right_arm' ? { ...p, w: 4 } : p))) > 0, 'a wide arm on Alex is caught');
  caught(modelFails(clone(BE.layer('player'), (p) => (p.n === 'jacket' ? { ...p, w: 8 } : p)), BE.layer('player_slim')) > 0, 'an undilated jacket is caught');
  caught(modelFails(null, BE.layer('player_slim')) > 0, 'a missing player layer is caught');
}

// ── 2. the roster + the two never-drawn parts ─────────────────────────────────────────────
ok(ER.mobLayerFor('player') === 'player' && ER.mobLayerFor('player_slim') === 'player_slim', 'ER.mobLayerFor does not draw the player layers');
function quadsFails(name) {
  const L = BE.layer(name), G = ER.mobGeomFor(name);
  let want = 0;
  for (let k = 0; k < L.parts.length; k++) {
    if (L.parts[k].n === 'ear' || L.parts[k].n === 'cloak') continue;
    for (let f = 0; f < 6; f++) { const s = G && G[k] && G[k][f]; want += (s && s.length) ? s.length : 1; }
  }
  const n = ER.mobQuadCount(name);
  const out = new Uint32Array((n + 64) * 16);
  const end = ER.emitMobLayer(out, 0, name, 0, 0, 0, 1, 0, 15, 0, 3);
  let bad = 0;
  if (n !== want) bad++;
  if (end !== n * 16) bad++;   // emitMobLayer returns a uint32 offset, 16 words a quad
  return bad;
}
for (const nm of ['player', 'player_slim']) ok(quadsFails(nm) === 0, nm + ': ear/cloak are costed or emitted, or the count and the emit disagree');
{
  const saved = ER.DEFAULT_HIDDEN;
  ER.DEFAULT_HIDDEN = {};
  caught(quadsFails('player') > 0, 'drawing the ear and the cloak is caught');
  ER.DEFAULT_HIDDEN = saved;
}

// ── 3. setupAnim: overlays copy their base part ───────────────────────────────────────────
function animFails() {
  let bad = 0;
  const pairs = [['left_sleeve', 'left_arm'], ['right_sleeve', 'right_arm'], ['left_pants', 'left_leg'],
                 ['right_pants', 'right_leg'], ['jacket', 'body']];
  for (const riding of [false, true]) for (const atk of [0, 0.4]) {
    for (const [ov, base] of pairs) {
      const ctxOf = (n) => ({ biped: true, attackTime: atk, rest: { px: n.includes('left') ? 5 : -5, pz: 0 } });
      const a = ER.setupAnimDelta(ov, 3.1, 0.7, 12, 20, riding, 'humanoid', ctxOf(ov));
      const b = ER.setupAnimDelta(base, 3.1, 0.7, 12, 20, riding, 'humanoid', ctxOf(base));
      if (JSON.stringify(a) !== JSON.stringify(b)) bad++;
    }
  }
  // and it is a real swing, not two nulls agreeing
  const s = ER.setupAnimDelta('left_sleeve', 3.1, 0.7, 0, 0, false, 'humanoid', { biped: true });
  if (!s || !(Math.abs(s.rx) > 0.05)) bad++;
  return bad;
}
ok(animFails() === 0, 'a sleeve/pants/jacket does not take its base part\'s pose');
{
  const saved = ER.OVERLAY_OF; ER.OVERLAY_OF = {};
  caught(animFails() > 0, 'sleeves that do not follow the arm are caught');
  ER.OVERLAY_OF = saved;
}

// ── 4. the skin: packed pixels == the jar's own steve.png / alex.png ─────────────────────
const tm = JSON.parse(readFileSync(A + 'mob-tiles.meta.json', 'utf8'));
const tiles = inflateRawSync(readFileSync(A + 'mob-tiles.bin'), { finishFlush: ZLIB.Z_SYNC_FLUSH });
const px = (layer, x, y) => { const o = ((layer - tm.base) * 256 + y * 16 + x) * 4; return [tiles[o], tiles[o + 1], tiles[o + 2], tiles[o + 3]]; };
const jar = new Jar(requireJar('1.13.2')), jar18 = new Jar(requireJar('1.18.2'));
// #1533: the packer reads 1.18.2 pixels wherever 1.18.2 has the sheet (#1509), so the oracle does too
const readSheet = (p) => { try { return jar18.read(p); } catch { return jar.read(p); } };
const sheetOf = (nm) => decodePng(readSheet('assets/minecraft/textures/entity/' + (nm === 'player' ? 'steve' : 'alex') + '.png'));
const hdr = JSON.parse((() => { const w = inflateRawSync(readFileSync(A + 'mob-tex.bin')); return w.subarray(4, 4 + w.readUInt32LE(0)).toString('utf8'); })());
const faceRects = (p) => {
  // #633/#1533: a dilated box unwraps its UVs from the UN-grown size (w - 2g), as pack-mobtex does
  const g = p.g || 0, u = p.tu, v = p.tv, w = Math.round((p.w - 2 * g) * 1000) / 1000, h = Math.round((p.h - 2 * g) * 1000) / 1000, d = Math.round((p.d - 2 * g) * 1000) / 1000;
  let west = [u, v + d, d, h], east = [u + d + w, v + d, d, h];
  if (p.m) { const t = west; west = east; east = t; }
  return [east, west, [u + d + w, v, w, d], [u + d, v, w, d], [u + d + w + d, v + d, w, h], [u + d, v + d, w, h]];
};
function skinFails(nm, img, gl, readPx) {
  let bad = 0, probes = 0;
  const L = BE.layer(nm);
  ok(hdr.sheets[hdr.layers[nm][0]].p.endsWith(nm === 'player' ? 'steve.png' : 'alex.png'), nm + ' is not on its own jar skin');
  for (let k = 0; k < L.parts.length; k++) {
    if (L.parts[k].n === 'ear' || L.parts[k].n === 'cloak') continue;
    const rects = faceRects(L.parts[k]);
    for (let f = 0; f < 6; f++) for (const s of ((gl[nm] && gl[nm][k] && gl[nm][k][f]) || [])) {
      const [ru, rv] = rects[f];
      for (const [dx, dy] of [[0, 0], [s.w - 1, 0], [0, s.h - 1], [s.w - 1, s.h - 1], [s.w >> 1, s.h >> 1]]) {
        const sx = Math.round(ru + s.u0) + dx, sy = Math.round(rv + s.v0) + dy;
        // a dilated box's UV rect is taken from its INFLATED size (the golden table stores the
        // grown box -- the convention every dilated part shares, the zombie's hat included), so
        // its last row/column can fall off the 64x64 sheet: that reads as transparent, exactly
        // what the packer bakes.
        const o = (sy * img.width + sx) * 4;
        const inside = sx >= 0 && sy >= 0 && sx < img.width && sy < img.height;
        const want = inside ? [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]] : [0, 0, 0, 0];
        const got = readPx(s.tile, s.ox + dx, s.oy + dy);
        probes++;
        if (want.join() !== got.join()) { bad++; if (process.env.DBG) console.log(nm, L.parts[k].n, f, s, sx, sy, want, got); }
      }
    }
  }
  return probes > 300 ? bad : 1e9;
}
const imgs = { player: sheetOf('player'), player_slim: sheetOf('player_slim') };
ok(imgs.player.width === 64 && imgs.player.height === 64 && imgs.player_slim.height === 64, 'a default skin is not 64x64');
for (const nm of ['player', 'player_slim']) ok(skinFails(nm, imgs[nm], geom.layers, px) === 0, nm + ': a packed skin pixel is not the jar\'s own');
caught(skinFails('player_slim', imgs.player, geom.layers, px) > 0, 'Alex drawn from Steve\'s sheet is caught');
caught(skinFails('player', imgs.player, geom.layers, (l, x, y) => (x === 0 && y === 0 ? [1, 2, 3, 4] : px(l, x, y))) > 0, 'one corrupted packed pixel is caught');
caught(skinFails('player', imgs.player, { player: geom.layers.player.map((pp) => pp.map((ff) => ff.map((s) => ({ ...s, ox: (s.ox + 1) % 16 })))) }, px) > 0, 'a shifted placement offset is caught');

console.log(fails.length ? '\n' + fails.map((f) => '   x ' + f).join('\n') : '');
console.log(`  ${pass} assertions, ${breaks} breaks caught`);
if (fails.length) { console.log('FAILED (' + fails.length + ')'); process.exit(1); }
console.log(`playerskincheck: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
