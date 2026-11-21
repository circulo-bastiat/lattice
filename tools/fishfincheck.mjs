#!/usr/bin/env node
// fishfincheck.mjs -- #7655: fish fins are "incredibly thin and sometimes invisible".
//
//   node tools/fishfincheck.mjs
//
// A fin is a zero-thickness box (one of w/h/d = 0). Two things make it vanish:
//   1. GEOMETRY: its two big faces must both be emitted, with opposite windings and a non-zero area
//      (the cutout pass culls back faces, so one side missing = invisible from that side).
//   2. TEXTURE: a fin's face is a 1-6 texel crop in a mostly transparent 16x16 mob tile; the block
//      mip average halves its alpha per level (< the 0.5 cutout) and the fin disappears a few blocks
//      away, where vanilla (no entity mipmaps) still draws it. Every opaque fin crop must keep an
//      opaque texel at every mip level a distant fish reaches (levels 1..3).
// Anti-vacuity (D-30): the old block-style mip rule and a dropped fin face are re-run and must be caught.
import { readFileSync } from 'node:fs';
import { inflateRawSync, deflateRawSync } from 'node:zlib';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
console.log('fishfincheck -- #7655: zero-thickness fish fins drawn from both sides and kept by the mips');

const M = loadEngine({ extra: ['02g_items.js', '06_atlas.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
  '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js'], dom: false });
initRegistry(M);
const mm = JSON.parse(readFileSync(MCLITE_ROOT + 'assets/models.meta.json', 'utf8'));
M.BEModel.init({ models: readFileSync(MCLITE_ROOT + 'assets/models.bin').toString('base64'), modelsBytes: mm.rawBytes });
const raw = readFileSync(MCLITE_ROOT + 'assets/mob-geometry.json');
M.DATA = Object.assign({}, M.DATA, { mobGeometry: deflateRawSync(raw, { level: 9 }).toString('base64'), mobGeometryBytes: raw.length });
M.Entities.init(); M.EntityList.init(); M.EntityRender.init();
const ER = M.EntityRender, BE = M.BEModel, A = M.Atlas;
const geom = JSON.parse(raw.toString('utf8')).layers;
const tmeta = JSON.parse(readFileSync(MCLITE_ROOT + 'assets/mob-tiles.meta.json', 'utf8'));
const tiles = inflateRawSync(readFileSync(MCLITE_ROOT + 'assets/mob-tiles.bin'));
ok(tiles.length === tmeta.rawBytes, 'mob-tiles.bin inflates to its meta size');
const LAYERS = ['cod', 'salmon', 'tropical_fish_small', 'tropical_fish_large', 'pufferfish_small', 'pufferfish_medium', 'pufferfish_big'];

// ── 1. geometry: both big faces of every zero-thickness part, opposite windings, area > 0 ──────────────
function geometry(drop) {
  let bad = 0, parts = 0;
  for (const name of LAYERS) {
    const L = BE.layer(name), n = ER.mobQuadCount(name), out = new Uint32Array(n * 16);
    ER.emitMobLayer(out, 0, name, 0, 0, 0, 1, 0, 15, 0, 3, undefined);
    let q = 0; const G = ER.mobGeomFor(name);
    for (let k = 0; k < L.parts.length; k++) {
      const p = L.parts[k], big = [];
      for (let f = 0; f < 6; f++) {
        let got = false; // #8160: a wrapped face is several slices of one face
        const c = G && G[k] && G[k][f], cnt = (c && c.length) || 1;
        for (let s = 0; s < cnt; s++, q++) {
          const v = [];
          for (let i = 0; i < 4; i++) v.push(M.Mesher.unpackModelVertex(out[(q * 4 + i) * 4], out[(q * 4 + i) * 4 + 1], out[(q * 4 + i) * 4 + 2], out[(q * 4 + i) * 4 + 3]));
          const a = [v[1].px - v[0].px, v[1].py - v[0].py, v[1].pz - v[0].pz], b = [v[2].px - v[0].px, v[2].py - v[0].py, v[2].pz - v[0].pz];
          const cr = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
          if (!got && Math.hypot(...cr) > 0) { big.push(cr); got = true; }
        }
      }
      if (!(p.w === 0 || p.h === 0 || p.d === 0)) continue;
      parts++;
      if (drop) big.pop();
      let paired = big.length === 2 && big[0][0] * big[1][0] + big[0][1] * big[1][1] + big[0][2] * big[1][2] < 0;
      if (!paired) { bad++; if (!drop) ok(false, `${name}.${p.n}: ${big.length} visible faces, not an opposed pair`); }
    }
  }
  return { bad, parts };
}
const g = geometry(false);
ok(g.parts >= 30 && g.bad === 0, `fish fins: ${g.parts} zero-thickness parts, ${g.bad} not drawn from both sides`);

// ── 2. texture: an opaque crop keeps an opaque texel at mips 1..3 ───────────────────────────────────────
function mipCheck(useMobRule) {
  const total = tmeta.base + tmeta.count;
  const lvl0 = new Uint8Array(total * 1024); lvl0.set(tiles, tmeta.base * 1024);
  const mips = [{ size: 16, data: lvl0 }];
  for (let s = 16; s > 1; s >>= 1) mips.push({ size: s >> 1, data: new Uint8Array(total * (s >> 1) * (s >> 1) * 4) });
  A.mips = mips; A.mobTile0 = useMobRule ? tmeta.base : 0; A.mobTiles = useMobRule ? tmeta.count : 0; A.dynDirty = [];
  for (let t = tmeta.base; t < total; t++) A.writeTile(t, lvl0.subarray(t * 1024, t * 1024 + 1024));
  let bad = 0, crops = 0;
  const seen = new Set();
  for (const name of LAYERS) {
    const L = BE.layer(name);
    for (let k = 0; k < L.parts.length; k++) {
      const p = L.parts[k];
      if (!(p.w === 0 || p.h === 0 || p.d === 0)) continue;
      for (const sl of [].concat(...(geom[name][k] || []))) {
        const key = sl.tile + ':' + sl.ox + ':' + sl.oy + ':' + sl.w + ':' + sl.h; if (seen.has(key)) continue; seen.add(key);
        let opaque = false;
        for (let y = sl.oy; y < sl.oy + sl.h; y++) for (let x = sl.ox; x < sl.ox + sl.w; x++) if (lvl0[sl.tile * 1024 + (y * 16 + x) * 4 + 3] >= 128) opaque = true;
        if (!opaque) continue;
        crops++;
        for (let lv = 1; lv <= 3; lv++) {
          const m = mips[lv], sz = m.size, sc = 16 / sz; let keep = false;
          for (let y = Math.floor(sl.oy / sc); y <= Math.floor((sl.oy + sl.h - 1) / sc); y++) for (let x = Math.floor(sl.ox / sc); x <= Math.floor((sl.ox + sl.w - 1) / sc); x++)
            if (m.data[sl.tile * sz * sz * 4 + (y * sz + x) * 4 + 3] >= 128) keep = true;
          if (!keep) { bad++; break; }
        }
      }
    }
  }
  return { bad, crops };
}
const t = mipCheck(true);
ok(t.crops >= 20, `${t.crops} opaque fin crops measured`);
ok(t.bad === 0, `${t.bad} of ${t.crops} fin crops lose every opaque texel at a mip level 1..3`);

// ── anti-vacuity ────────────────────────────────────────────────────────────────────────────────────────
let caught = 0;
const old = mipCheck(false);
if (ok(old.bad > 0, 'anti-vacuity: the old block mip rule loses no fin crop')) { caught++; console.log(`   ✓ caught: block-style mips drop ${old.bad} of ${old.crops} fin crops`); }
const dr = geometry(true);
if (ok(dr.bad === dr.parts && dr.parts > 0, 'anti-vacuity: a dropped fin face was not caught on every fin')) { caught++; console.log(`   ✓ caught: dropped face on ${dr.bad} fins`); }

console.log(`    ${caught} breaks caught`);
if (fails.length) { console.log('FAIL ' + fails.length + ':\n  ' + fails.join('\n  ')); process.exit(1); }
console.log(`fishfincheck: ${pass} checks passed`);
