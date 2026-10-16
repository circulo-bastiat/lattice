#!/usr/bin/env node
// texl1check.mjs — GATE M, layer L1 (DATA), #1504: every shipped entity texture, pixel for pixel, against the 1.18.2 jar.
//
//   node tools/texl1check.mjs [--print]
//
// Dan, 2 Oct: "i want textures audited systematically and automatically with advanced, pixel perfect ways
// that isnt just looking at the atlas". Source of truth = the 1.18.2 JAR, decoded fresh here to RGBA; never
// the pack the engine ships. Two joins, each compared on EVERY pixel incl. alpha:
//   A. SHEETS  - every sheet in assets/mob-tex.bin (the full mob/variant roster, 340) vs the jar PNG at the
//                same path: size + all texels. Class: identical | differs | absent-in-1.18.2.
//   B. TILES   - every slice mob-geometry.json hands the renderer (all 458 layers/variants, every part, face,
//                texel) vs the jar PNG pixels under the face rect (rect recomputed here from the ModelPart.Cuboid
//                layout: u+d+w, v ... mirror swaps west/east). This is what the GPU actually samples.
//   C. WEATHER - rain/snow sheets.
// Non-identical sheets are a RATCHET (tools/texl1-known.json): a new difference fails, a fixed one must be
// removed from the list, so the list only goes down. `--print` lists them with mismatching pixel counts.
// #1508 adds D particle-tex (32px tiles), E xp orb sheet, F gui.bin (1.13.2 jar; patterns 1.18.2), G item + block tiles
// (frame 0 of a strip, baked tint, D-146 alpha bleed), H .mcmeta first frames, I block-entity crops (recipes in
// be-tiles.meta.json) + transparent padding. Mip generation is on the GPU and not in any shipped bin.
import { readFileSync, existsSync } from 'node:fs';
import { inflateRawSync, constants as ZLIB } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Jar, texturePath } from './jarlib.mjs';
import { decodePng } from './png.mjs';
import { requireJar, skipCheck } from './paths.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const A = join(ROOT, 'assets');
const PRINT = process.argv.includes('--print');
let pass = 0, caught = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 60) fails.push(m); return c; };
console.log('texl1check — GATE M L1: shipped entity textures vs the 1.18.2 jar, every pixel incl. alpha');
if (!existsSync(join(A, 'mob-tex.bin'))) { skipCheck('texl1check', 'assets missing, run the build stages'); }
let jar; try { jar = new Jar(requireJar('1.18.2')); } catch (e) { skipCheck('texl1check', 'no 1.18.2 jar'); }

const whole = inflateRawSync(readFileSync(join(A, 'mob-tex.bin')));
const hl = whole.readUInt32LE(0);
const H = JSON.parse(whole.subarray(4, 4 + hl).toString('utf8'));
const body = whole.subarray(4 + hl);
const tm = JSON.parse(readFileSync(join(A, 'mob-tiles.meta.json'), 'utf8'));
const tiles = inflateRawSync(readFileSync(join(A, 'mob-tiles.bin')), { finishFlush: ZLIB.Z_SYNC_FLUSH });
const TILE = tm.tile;
const geom = JSON.parse(readFileSync(join(A, 'mob-geometry.json'), 'utf8'));
const models = JSON.parse(inflateRawSync(readFileSync(join(A, 'models.bin')), { finishFlush: ZLIB.Z_SYNC_FLUSH }).toString('utf8')).layers;
const known = JSON.parse(readFileSync(join(ROOT, 'tools', 'texl1-known.json'), 'utf8'));

// ── the jar side: fresh decode, cached
const names = new Set(jar.names());
const cache = new Map();
const jarPathOf = (p) => { const m = /^(assets\/minecraft\/textures\/entity\/)(squid|iron_golem)\.png$/.exec(p); return !names.has(p) && m && names.has(`${m[1]}${m[2]}/${m[2]}.png`) ? `${m[1]}${m[2]}/${m[2]}.png` : p; };   // 1.18.2 keeps squid at entity/squid/squid.png
function jarImg(p) {
  p = jarPathOf(p);
  if (cache.has(p)) return cache.get(p);
  let r = null;
  if (names.has(p)) { const d = decodePng(jar.read(p)); r = { w: d.width, h: d.height, data: d.data }; }
  cache.set(p, r); return r;
}

// ── A. sheets
function auditSheets(shipped) {   // shipped(i) -> {w,h,data}
  const out = { identical: 0, differs: [], absent: [], px: {} };
  H.sheets.forEach((s, i) => {
    const j = jarImg(s.p), m = shipped(i);
    if (!j) { out.absent.push(s.p); return; }
    if (j.w !== m.w || j.h !== m.h) { out.differs.push(s.p); out.px[s.p] = -1; return; }
    let bad = 0;
    for (let k = 0; k < j.data.length; k += 4)
      if (j.data[k] !== m.data[k] || j.data[k + 1] !== m.data[k + 1] || j.data[k + 2] !== m.data[k + 2] || j.data[k + 3] !== m.data[k + 3]) bad++;
    if (bad) { out.differs.push(s.p); out.px[s.p] = bad; } else out.identical++;
  });
  return out;
}
const sheetReal = (i) => { const s = H.sheets[i]; return { w: s.w, h: s.h, data: body.subarray(s.o, s.o + s.len) }; };

// ── B. tiles: ModelPart.Cuboid rects, recomputed from the part (tu,tv,w,h,d, grow g, mirror m)
function rects(p) {
  const g = p.g || 0, r = (x) => Math.round((x - 2 * g) * 1000) / 1000;
  const u = p.tu, v = p.tv, w = r(p.w), h = r(p.h), d = r(p.d);
  let west = [u, v + d, d, h], east = [u + d + w, v + d, d, h];
  if (p.m) { const t = west; west = east; east = t; }
  return [east, west, [u + d + w, v, w, d], [u + d, v, w, d], [u + d + w + d, v + d, w, h], [u + d, v + d, w, h]].map((q) => q.map(Math.round));
}
function sheetIdxFor(name) {
  if (H.layers[name]) return H.layers[name][0];
  const m = /^(.*)#(\d+)$/.exec(name);
  if (m && H.layers[m[1]] && H.layers[m[1]][+m[2]] != null) return H.layers[m[1]][+m[2]];
  return null;
}
function auditTiles(tileBuf, sheetOf) {
  const per = {}, cmp = {}; let px = 0, bad = 0, unverif = 0;
  for (const name of Object.keys(geom.layers)) {
    const L = models[name] || models[name.replace(/#\d+$/, '')]; if (!L) continue;   // villager#k clothing overlays reuse the base model's parts (#1796)
    const si = sheetOf(name); if (si == null) continue;
    const j = jarImg(H.sheets[si].p);
    if (!j) { unverif++; continue; }
    geom.layers[name].forEach((faces, k) => {
      const R = rects(L.parts[k]);
      faces.forEach((slices, f) => slices.forEach((s) => {
        for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
          // #5852: a sheet of another size than the model's texture is sampled at sheet/model scale (plain layers only)
          const kx = name.includes('#') ? 1 : j.w / (L.tw || j.w), ky = name.includes('#') || (kx === 1 && j.h > j.w && j.h % (L.th || j.h) === 0 && j.h % j.w === 0) ? 1 : j.h / (L.th || j.h);
          const sx = Math.floor((R[f][0] + s.u0 + x + 0.5) * kx), sy = Math.floor((R[f][1] + s.v0 + y + 0.5) * ky);
          let e = [0, 0, 0, 0];
          if (sx >= 0 && sy >= 0 && sx < j.w && sy < j.h) { const q = (sy * j.w + sx) * 4; e = [j.data[q], j.data[q + 1], j.data[q + 2], j.data[q + 3]]; }
          const o = ((s.tile - geom.tileBase) * TILE * TILE + (s.oy + y) * TILE + s.ox + x) * 4;
          px++; cmp[name] = (cmp[name] || 0) + 1;
          if (e[3] === 0 && tileBuf[o + 3] === 0) continue;   // fully transparent == transparent
          if (e[0] !== tileBuf[o] || e[1] !== tileBuf[o + 1] || e[2] !== tileBuf[o + 2] || e[3] !== tileBuf[o + 3]) { bad++; per[name] = (per[name] || 0) + 1; }
        }
      }));
    });
  }
  return { px, bad, per, unverif, cmp };
}

// A
const sa = auditSheets(sheetReal);
console.log(`A. sheets: ${H.sheets.length} shipped — ${sa.identical} identical to the 1.18.2 jar, ${sa.differs.length} differ, ${sa.absent.length} have no such path in 1.18.2`);
const knownD = new Set(known.differs), knownA = new Set(known.absent);
for (const p of sa.differs) ok(knownD.has(p), `NEW sheet differs from the 1.18.2 jar: ${p} (${sa.px[p]} px)`);
for (const p of sa.absent) ok(knownA.has(p), `NEW sheet with no 1.18.2 path: ${p}`);
for (const p of known.differs) ok(sa.differs.includes(p), `tools/texl1-known.json lists ${p} as differing but it is now identical — remove it (ratchet only goes down)`);
for (const p of known.absent) ok(sa.absent.includes(p), `tools/texl1-known.json lists ${p} as absent but it is no longer — remove it`);
// #1596: guardian/elder_guardian must be shipped AND pixel-identical (not parked in the known-differs ratchet)
for (const g of ['guardian', 'guardian_elder']) {
  const p = `assets/minecraft/textures/entity/${g}.png`;
  ok(H.sheets.some((s) => s.p === p) && !sa.differs.includes(p) && !sa.absent.includes(p), `${p} is not shipped identical to the 1.18.2 jar`);
}
ok(sa.identical > 100, `only ${sa.identical} sheets verified identical`);
if (PRINT) { for (const p of sa.differs) console.log(`   differs ${p}  ${sa.px[p]} px`); for (const p of sa.absent) console.log(`   absent  ${p}`); }

// B
const tb = auditTiles(tiles, sheetIdxFor);
console.log(`B. tiles: ${tb.px} texels in ${Object.keys(geom.layers).length} layers/variants compared — ${tb.bad} differ from the jar PNG (${tb.unverif} layers on sheets absent from 1.18.2, not comparable)`);
for (const [n, c] of Object.entries(tb.per)) {
  const si = sheetIdxFor(n), p = H.sheets[si].p;
  ok(knownD.has(p), `layer ${n}: ${c} packed texels differ from the 1.18.2 jar (${p})`);
  if (PRINT) console.log(`   tile mismatch ${n}: ${c}`);
}
ok(tb.px > 100000, `only ${tb.px} texels compared`);
// B3 (#3928): llama + trader_llama bodies and the carpet decor layer (16 dyes + trader_llama.png) each really compared
const LROWS = { llama: /^llama(#\d+)?$/, trader_llama: /^trader_llama(#\d+)?$/, decor: /^decor#null(#\d+)?$/ };
for (const [mob, want] of [['llama', 4], ['trader_llama', 4], ['decor', 17]]) {
  const rows = Object.keys(tb.cmp).filter((n) => LROWS[mob].test(n));
  console.log(`B3. ${mob}: ${rows.length} of ${want} layer rows compared, ${rows.reduce((a, n) => a + tb.cmp[n], 0)} texels`);
  ok(rows.length >= want, `${mob}: only ${rows.length} of ${want} texture layers compared against the jar`);
  if (PRINT) for (const n of rows) console.log(`   ${n}: ${tb.cmp[n]} texels vs ${H.sheets[sheetIdxFor(n)].p}`);
}
// B2 (#1796): the villager family's base + type + profession + level layers must each really be compared, not skipped
const vrows = (re) => Object.keys(tb.cmp).filter((n) => re.test(n));
const VROWS = { villager: /^villager(#\d+)?$/, wandering_trader: /^wandering_trader$/, witch: /^witch$/, giant: /^giant(#[bc])?$/, zombie_villager: /^zombie_villager(#[bc])?(#\d+)?$/ };
for (const [mob, re] of Object.entries(VROWS)) {
  // zombie_villager: 29 = 27 skin keys + #b + #c (armour layers, #1548: the armour sheet, not 26 per-skin copies each)
  const rows = vrows(re), want = mob === 'villager' ? 27 : mob === 'zombie_villager' ? 29 : mob === 'giant' ? 3 : 1;
  console.log(`B2. ${mob}: ${rows.length} of ${want} layer rows compared, ${rows.reduce((a, n) => a + tb.cmp[n], 0)} texels`);
  ok(rows.length >= want, `${mob}: only ${rows.length} of ${want} texture layers compared against the jar`);
  if (PRINT) for (const n of rows) console.log(`   ${n}: ${tb.cmp[n]} texels vs ${H.sheets[sheetIdxFor(n)].p}`);
}

// B3 (#1881): evoker_fangs (illager/evoker_fangs.png, 64x32) must have its three parts really compared, not skipped
{
  const n = 'evoker_fangs', si = sheetIdxFor(n);
  console.log(`B3. ${n}: ${tb.cmp[n] || 0} texels vs ${si == null ? '(no sheet)' : H.sheets[si].p}`);
  ok(si != null && H.sheets[si].p.endsWith('illager/evoker_fangs.png') && tb.cmp[n] === 1480, `${n}: expected 1480 texels compared against illager/evoker_fangs.png, got ${tb.cmp[n]}`);
}

// C
const wm = JSON.parse(readFileSync(join(A, 'weather-tex.meta.json'), 'utf8'));
const wb = inflateRawSync(readFileSync(join(A, 'weather-tex.bin')));
let wbad = 0;
wm.layers.forEach((n, i) => {
  const j = decodePng(jar.read(`assets/minecraft/textures/environment/${n}.png`));
  const sz = j.width * j.height * 4;
  if (j.width !== wm.width || j.height !== wm.height) { wbad++; return; }
  for (let k = 0; k < sz; k++) if (j.data[k] !== wb[i * sz + k]) { wbad++; break; }
});
console.log(`C. weather: ${wm.layers.length} sheets, ${wbad} differ`);
ok(wbad === 0, `weather sheets differ from the jar (${wbad})`);

// ── D–I (#1508): particles, xp orb, GUI sheets, item tiles, mcmeta frames, block-entity tiles
let jar13 = null; try { jar13 = new Jar(requireJar('1.13.2')); } catch { /* sections needing it SKIP */ }
const inf = (f) => inflateRawSync(readFileSync(join(A, f)), { finishFlush: ZLIB.Z_SYNC_FLUSH });
const decode = (j, p) => { const d = decodePng(j.read(p)); return { w: d.width, h: d.height, data: d.data }; };
const diff = (a, b, n) => { let bad = 0; for (let k = 0; k < n; k++) if (a[k] !== b[k]) bad++; return bad; };
const nearestUp = (img, T) => {   // integer nearest upscale, w x w -> T x T (what extract-particletex does)
  const k = T / img.w, out = Buffer.alloc(T * T * 4);
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    const si = (Math.floor(y / k) * img.w + Math.floor(x / k)) * 4, di = (y * T + x) * 4;
    for (let c = 0; c < 4; c++) out[di + c] = img.data[si + c];
  }
  return out;
};

// D. particle-tex.bin: every 32x32 layer vs its jar sprite (8x8 at 4x, 16x16 item icons at 2x, 32x32 as is)
const pm = JSON.parse(readFileSync(join(A, 'particle-tex.meta.json'), 'utf8'));
function auditParticles(raw) {
  let bad = 0, px = 0, n = 0; const per = [];
  pm.layerNames.forEach((nm, i) => {
    if (nm.startsWith('dust:')) {   // entity sprite, nearest-resampled to the tile (extract-particletex resampleN)
      const id = nm.slice(5), ent = id === 'bell' ? 'bell/bell_body' : id === 'conduit' ? 'conduit/base' : 'shulker/shulker' + (id === 'shulker_box' ? '' : '_' + id.slice(0, -12));
      const ep = `assets/minecraft/textures/entity/${ent}.png`;
      if (!names.has(ep)) { bad++; per.push(nm + ' (no jar png)'); return; }
      const j = jarImg(ep), T = pm.tile, e = Buffer.alloc(T * T * 4);
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
        const si = (Math.floor(y * j.h / T) * j.w + Math.floor(x * j.w / T)) * 4, di = (y * T + x) * 4;
        for (let c = 0; c < 4; c++) e[di + c] = j.data[si + c];
      }
      const got = raw.subarray(i * T * T * 4, (i + 1) * T * T * 4), d = diff(e, got, e.length);
      px += T * T; n++; if (d) { bad += d; per.push(`${nm} ${d}`); }
      return;
    }
    const vm = /^vibration_(\d)$/.exec(nm);
    if (vm) {   // #6060: frame f of the 18x126 strip, padded top-left into the tile
      const vp = 'assets/minecraft/textures/particle/vibration.png';
      if (!names.has(vp)) { bad++; per.push(nm + ' (no jar png)'); return; }
      const j = jarImg(vp), T = pm.tile, f = +vm[1], e = Buffer.alloc(T * T * 4);
      for (let y = 0; y < 18; y++) j.data.copy(e, y * T * 4, (f * 18 + y) * 18 * 4, (f * 18 + y + 1) * 18 * 4);
      const got = raw.subarray(i * T * T * 4, (i + 1) * T * T * 4), d = diff(e, got, e.length);
      px += T * T; n++; if (d) { bad += d; per.push(`${nm} ${d}`); }
      return;
    }
    const p = nm.startsWith('item:') ? `assets/minecraft/textures/item/${nm.slice(5)}.png` : `assets/minecraft/textures/particle/${nm}.png`;
    if (!names.has(p)) { bad++; per.push(nm + ' (no jar png)'); return; }
    const j = jarImg(p), T = pm.tile;
    if (j.w !== j.h || T % j.w) { bad++; per.push(nm + ' (size)'); return; }
    const e = nearestUp(j, T), got = raw.subarray(i * T * T * 4, (i + 1) * T * T * 4), d = diff(e, got, e.length);
    px += T * T; n++; if (d) { bad += d; per.push(`${nm} ${d}`); }
  });
  return { bad, px, n, per, size: raw.length === pm.count * pm.tile * pm.tile * 4 };
}
const pRaw = inf('particle-tex.bin'), pa = auditParticles(pRaw);
console.log(`D. particles: ${pa.n} layers (${pa.px} texels) vs the jar — ${pa.bad} differ`);
ok(pa.size && pa.bad === 0 && pa.n === pm.count, `particle-tex.bin differs from the jar: ${pa.per.join(', ')}`);

// E. xporb-tex.bin: the 64x64 sheet
const xRaw = inf('xporb-tex.bin'), xj = jarImg('assets/minecraft/textures/entity/experience_orb.png');
const auditXp = (raw) => (xj && raw.length === xj.data.length ? diff(xj.data, raw, raw.length) : -1);
const xb = auditXp(xRaw);
console.log(`E. xp orb sheet: 64x64, ${xb} bytes differ`);
ok(xb === 0, `xporb-tex.bin differs from the jar (${xb})`);

// F. gui.bin: every sheet, from the jar build-gui reads it from (1.13.2; banner/shield pattern sheets 1.18.2)
if (jar13) {
  const GUI = 'assets/minecraft/textures/gui/', CON = GUI + 'container/', ENT = 'assets/minecraft/textures/entity/';
  const table = (f) => readFileSync(join(ROOT, 'tools', 'golden', f), 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t'));
  const T = (p) => 'assets/minecraft/textures/' + p + '.png';
  const src = { widgets: GUI + 'widgets.png', icons: GUI + 'icons.png', bars: GUI + 'bars.png', inventory: CON + 'inventory.png', crafting_table: CON + 'crafting_table.png',
    furnace: CON + 'furnace.png', generic_54: CON + 'generic_54.png', shulker_box: CON + 'shulker_box.png', hopper: CON + 'hopper.png',
    dispenser: CON + 'dispenser.png', anvil: CON + 'anvil.png', brewing_stand: CON + 'brewing_stand.png', merchant: CON + 'villager.png',
    horse: CON + 'horse.png', creative_items: CON + 'creative_inventory/tab_items.png', creative_search: CON + 'creative_inventory/tab_item_search.png',
    creative_inv: CON + 'creative_inventory/tab_inventory.png', creative_tabs: CON + 'creative_inventory/tabs.png', enchanting_table: CON + 'enchanting_table.png',
    grindstone: CON + 'grindstone.png', ascii: T('font/ascii'), ascii_sga: T('font/ascii_sga'), enchant_glint: T('misc/enchanted_item_glint'),
    steve: T('entity/steve'), sun: T('environment/sun'), moon_phases: T('environment/moon_phases'),
    empty_helmet: T('item/empty_armor_slot_helmet'), empty_chestplate: T('item/empty_armor_slot_chestplate'),
    empty_leggings: T('item/empty_armor_slot_leggings'), empty_boots: T('item/empty_armor_slot_boots'), empty_shield: T('item/empty_armor_slot_shield'),
    be_chest: ENT + 'chest/normal.png', be_chest_left: ENT + 'chest/normal_double.png', be_trapped_chest: ENT + 'chest/trapped.png',
    be_ender_chest: ENT + 'chest/ender.png', be_shulker_box: ENT + 'shulker/shulker.png', be_banner: ENT + 'banner_base.png',
    be_shield: ENT + 'shield_base_nopattern.png', be_skeleton_skull: ENT + 'skeleton/skeleton.png', be_wither_skeleton_skull: ENT + 'skeleton/wither_skeleton.png',
    be_zombie_head: ENT + 'zombie/zombie.png', be_creeper_head: ENT + 'creeper/creeper.png', be_dragon_head: ENT + 'enderdragon/dragon.png',
    be_conduit: ENT + 'conduit/base.png', be_conduit_cage: ENT + 'conduit/cage.png', be_conduit_wind: ENT + 'conduit/wind.png',
    be_conduit_wind_vertical: ENT + 'conduit/wind_vertical.png', be_conduit_open_eye: ENT + 'conduit/open_eye.png', be_conduit_closed_eye: ENT + 'conduit/closed_eye.png', be_shield_base: ENT + 'shield_base.png' };
  const dyes = table('dye-colours-1.18.2.tsv').map((c) => c[0]);
  for (const d of dyes) { src['be_' + d + '_bed'] = ENT + 'bed/' + d + '.png'; src['be_' + d + '_shulker_box'] = ENT + 'shulker/shulker_' + d + '.png'; }
  for (const c of table('banner-patterns-1.18.2.tsv')) if (c[2] === '1') { src['bp_' + c[0]] = ENT + 'banner/' + c[0] + '.png'; src['sp_' + c[0]] = ENT + 'shield/' + c[0] + '.png'; }
  const gwhole = inf('gui.bin'), ghl = gwhole.readUInt32LE(0), GH = JSON.parse(gwhole.subarray(4, 4 + ghl).toString('utf8')), gbody = gwhole.subarray(4 + ghl);
  const auditGui = (buf, sheetPath) => {
    let bad = 0, n = 0, unk = []; const per = [];
    GH.sheets.forEach((s) => {
      const p = sheetPath(s.n);
      if (!p) { unk.push(s.n); return; }
      const j = /^(bp_|sp_|be_shield_base$|grindstone$)/.test(s.n) ? jarImg(p) : (jar13.has(p) ? decode(jar13, p) : null);
      if (!j || j.w !== s.w || j.h !== s.h || j.data.length !== s.len) { bad++; per.push(s.n + ' (missing/size)'); return; }
      const d = diff(j.data, buf.subarray(s.o, s.o + s.len), s.len); n++;
      if (d) { bad++; per.push(`${s.n} ${d}`); }
    });
    return { bad, n, unk, per };
  };
  const ga = auditGui(gbody, (n) => src[n]);
  console.log(`F. gui.bin: ${ga.n} of ${GH.sheets.length} sheets vs the jars — ${ga.bad} differ, ${ga.unk.length} with no known source`);
  ok(ga.bad === 0 && ga.unk.length === 0, `gui.bin sheets differ from the jar: ${ga.per.concat(ga.unk.map((u) => u + ' (no source)')).join(', ')}`);
  var guiBreak = () => { const b = Buffer.from(gbody); b[GH.sheets[0].o + 3] ^= 0x40; return auditGui(b, (n) => src[n]).bad > ga.bad; };
} else console.log('F. gui.bin: SKIP — no 1.13.2 jar');

// G/H. item-tiles.bin: sprite from the 1.13.2 jar (else 1.18.2), frame 0 of an animation strip; tinted layers = baked multiply
const itm = JSON.parse(readFileSync(join(A, 'item-tiles.meta.json'), 'utf8'));
const iai = JSON.parse(readFileSync(join(A, 'item-atlas-index.json'), 'utf8'));
const iRaw = inf('item-tiles.bin'), IT = iai.tile;
const itemSrc = (id) => { const p = texturePath(id); const s = jar13 && jar13.has(p) ? decode(jar13, p) : jarImg(p); return s; };
// bleed: build-atlas's alpha bleed (D-146) recolours alpha-0 texels from their opaque neighbours; alpha and every
// visible texel must be untouched, and a recoloured hidden texel must carry a colour that exists in its own tile (or stay as the jar had it).
function sameTile(e, got, bleed) {
  if (!bleed) return diff(e, got, e.length) === 0;
  const vis = new Set(); let any = false;
  for (let o = 0; o < e.length; o += 4) if (e[o + 3] > 0) { vis.add((e[o] << 16) | (e[o + 1] << 8) | e[o + 2]); any = true; }
  for (let o = 0; o < e.length; o += 4) {
    if (got[o + 3] !== e[o + 3]) return false;
    if (e[o + 3] > 0) { if (got[o] !== e[o] || got[o + 1] !== e[o + 1] || got[o + 2] !== e[o + 2]) return false; }
    else if (any && !vis.has((got[o] << 16) | (got[o + 1] << 8) | got[o + 2]) && (got[o] !== e[o] || got[o + 1] !== e[o + 1] || got[o + 2] !== e[o + 2])) return false;
  }
  return true;
}
function auditItems(buf, idx = iai.index, tint = iai.tintIndex, bleed = false) {
  let bad = 0, n = 0; const per = [], anim = [];
  const tile = (i) => buf.subarray(i * IT * IT * 4, (i + 1) * IT * IT * 4);
  const exp = new Map();
  for (const [id, ti] of Object.entries(idx)) {
    const s = itemSrc(id); if (!s) { bad++; per.push(id + ' (no jar png)'); continue; }
    if (s.h > s.w && s.h % s.w === 0) anim.push(id);
    let e = s.data.subarray(0, IT * IT * 4);
    const quad = bleed && s.w === 32 && /^block\/(water_flow|lava_flow)$/.test(id);   // #2002: 32x32 frames, packed as the top-left 16x16 quadrant
    if (quad) { e = Buffer.alloc(IT * IT * 4); for (let r = 0; r < IT; r++) s.data.copy(e, r * IT * 4, r * 32 * 4, r * 32 * 4 + IT * 4); }
    exp.set(id, e); n++;
    if ((s.w !== IT && !quad) || !sameTile(e, tile(ti), bleed)) { bad++; per.push(id); }
  }
  for (const [key, ti] of Object.entries(tint)) {
    const [id, col] = key.split('@'), e0 = exp.get(id); if (!e0) { bad++; per.push(key + ' (no base)'); continue; }
    const c = +col, r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255, e = Buffer.alloc(e0.length);
    for (let o = 0; o < e0.length; o += 4) { e[o] = (e0[o] * r + 127) / 255 | 0; e[o + 1] = (e0[o + 1] * g + 127) / 255 | 0; e[o + 2] = (e0[o + 2] * b + 127) / 255 | 0; e[o + 3] = e0[o + 3]; }
    n++; if (diff(e, tile(ti), e.length)) { bad++; per.push(key); }
  }
  return { bad, n, per, anim };
}
const ia = auditItems(iRaw);
console.log(`G. item tiles: ${ia.n} sprites+tinted layers (of ${itm.count} tiles) vs the jar — ${ia.bad} differ`);
ok(ia.bad === 0 && iRaw.length === itm.count * IT * IT * 4, `item-tiles.bin differs from the jar: ${ia.per.slice(0, 20).join(', ')}`);
// G2. block-tiles.bin: same rule for the block atlas (frame 0 of a strip, 16x16), modulo the D-146 alpha bleed
const bti = JSON.parse(readFileSync(join(A, 'atlas-index.json'), 'utf8')), bRawBlk = inf('block-tiles.bin');
const blkM = JSON.parse(readFileSync(join(A, 'block-tiles.meta.json'), 'utf8'));
const ba2 = auditItems(bRawBlk, bti.index, {}, true);
console.log(`G2. block tiles: ${ba2.n} atlas sprites (of ${blkM.count} tiles) vs the jar — ${ba2.bad} differ`);
ok(ba2.bad === 0 && bRawBlk.length === blkM.count * IT * IT * 4, `block-tiles.bin differs from the jar: ${ba2.per.slice(0, 20).join(', ')}`);
ia.anim.push(...ba2.anim);
// H. an animated sprite is packed as frame 0 of the strip: vanilla's first drawn frame must BE frame 0
const mcmetaBad = [];
for (const id of ia.anim) {
  const p = texturePath(id) + '.mcmeta', J = jar13 && jar13.has(p) ? jar13 : names.has(p) ? jar : null;
  if (!J) { mcmetaBad.push(id + ' (animated strip, no .mcmeta)'); continue; }
  const fr = JSON.parse(J.readText(p)).animation?.frames, f0 = fr ? (typeof fr[0] === 'object' ? fr[0].index : fr[0]) : 0;
  if (f0 !== 0) mcmetaBad.push(`${id} (first frame is ${f0})`);
}
// ratchet: sprites whose vanilla first frame is not the strip's frame 0 (tools/texl1-known.json "firstFrame")
const knownFF = new Set(known.firstFrame || []), nowFF = mcmetaBad.map((m) => m.split(' ')[0]);
for (const id of nowFF) ok(knownFF.has(id), `NEW animated sprite whose first frame is not frame 0: ${id}`);
for (const id of knownFF) ok(nowFF.includes(id), `tools/texl1-known.json firstFrame lists ${id} but it starts on frame 0 now — remove it`);
mcmetaBad.length = 0;
console.log(`H. mcmeta: ${ia.anim.length} animated item sprites packed as frame 0 — ${mcmetaBad.length} start elsewhere`);
ok(mcmetaBad.length === 0, `animated item sprite packed as the wrong first frame: ${mcmetaBad.join(', ')}`);
ok(ia.anim.length > 10, `only ${ia.anim.length} animated sprites found — the mcmeta audit is not looking`);

// I. be-tiles.bin: every crop recipe re-derived from the jar (dye multiply), and everything outside a crop must be transparent padding
const bm = JSON.parse(readFileSync(join(A, 'be-tiles.meta.json'), 'utf8')), BT = bm.tile;
const bRaw = inf('be-tiles.bin');
const jar18 = jar;
function auditBe(buf, recipes = bm.recipes) {
  let bad = 0, px = 0, pad = 0; const per = new Set(), cov = new Uint8Array(bm.count * BT * BT);
  for (const m of recipes) {
    const rel = m.tex.replace(/^@18:/, ''), J = m.tex.startsWith('@18:') ? jar18 : jar13;
    const img = J && J.has(rel) ? decode(J, rel) : null;
    const dr = m.dyeTint === undefined ? 1 : ((m.dyeTint >> 16) & 255) / 255, dg = m.dyeTint === undefined ? 1 : ((m.dyeTint >> 8) & 255) / 255, db = m.dyeTint === undefined ? 1 : (m.dyeTint & 255) / 255;
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      const o = (m.layer * BT * BT + (m.y + y) * BT + m.x + x); cov[o] = 1; px++;
      const sx = m.u + x, sy = m.v + y;
      let e = [0, 0, 0, 0];
      if (img && sx >= 0 && sy >= 0 && sx < img.w && sy < img.h) { const q = (sy * img.w + sx) * 4; e = [Math.round(img.data[q] * dr), Math.round(img.data[q + 1] * dg), Math.round(img.data[q + 2] * db), img.data[q + 3]]; }
      for (let c = 0; c < 4; c++) if (buf[o * 4 + c] !== e[c]) { bad++; per.add(m.tex.split('/').pop()); break; }
    }
  }
  for (let o = 0; o < cov.length; o++) if (!cov[o]) for (let c = 0; c < 4; c++) if (buf[o * 4 + c]) { pad++; break; }
  return { bad, px, pad, per: [...per] };
}
if (jar13 && bm.recipes) {
  const ba = auditBe(bRaw);
  console.log(`I. block-entity tiles: ${bm.recipes.length} crops (${ba.px} texels) vs the jar — ${ba.bad} differ; ${ba.pad} non-transparent padding texels`);
  ok(ba.bad === 0, `be-tiles.bin crops differ from the jar: ${ba.per.join(', ')}`);
  ok(ba.pad === 0, `be-tiles.bin has ${ba.pad} non-transparent texels outside every crop`);
  ok(bRaw.length === bm.count * BT * BT * 4, 'be-tiles.bin size');
  var beBreak = () => { const b = Buffer.from(bRaw); const m = bm.recipes[0]; b[(m.layer * BT * BT + m.y * BT + m.x) * 4 + 1] ^= 0x20; return auditBe(b).bad > ba.bad; };
  var padBreak = () => { const b = Buffer.from(bRaw); const cv = new Uint8Array(bm.count * BT * BT); for (const m of bm.recipes) for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) cv[m.layer * BT * BT + (m.y + y) * BT + m.x + x] = 1;
    const o = cv.indexOf(0); b[o * 4 + 2] = 7; return auditBe(b).pad > ba.pad; };
} else console.log('I. block-entity tiles: SKIP — no 1.13.2 jar or no recipes in be-tiles.meta.json (re-run pack-blockentity)');

// ── deliberate breaks: the audit must see each corruption of its own inputs
const brk = (label, c) => { if (ok(c, `anti-vacuity: ${label} NOT caught`)) { caught++; console.log(`   ✓ break caught: ${label}`); } };
{ // one texel of one sheet
  const i = H.sheets.findIndex((s) => jarImg(s.p) && !known.differs.includes(s.p));
  const bad = (k) => { const r = sheetReal(k); if (k !== i) return r; const d = Buffer.from(r.data); d[0] ^= 0x10; return { w: r.w, h: r.h, data: d }; };
  const r = auditSheets(bad);
  brk('one texel of one shipped sheet flipped', r.differs.length === known.differs.length + 1);
}
{ // one alpha value
  const i = H.sheets.findIndex((s) => jarImg(s.p) && !known.differs.includes(s.p));
  const r = auditSheets((k) => { const s = sheetReal(k); if (k !== i) return s; const d = Buffer.from(s.data); d[3] = d[3] === 255 ? 254 : 255; return { w: s.w, h: s.h, data: d }; });
  brk('one alpha byte changed', r.differs.length === known.differs.length + 1);
}
// layers whose sheet is already identical to the jar: corrupting these must raise the count
const CLEAN = Object.keys(geom.layers).filter((n) => models[n] && sheetIdxFor(n) != null && jarImg(H.sheets[sheetIdxFor(n)].p) && !tb.per[n] && geom.layers[n][0] && geom.layers[n][0][0].length);
{ // one packed texel
  const t = Buffer.from(tiles);
  const s0 = geom.layers[CLEAN[0]][0][0][0];
  t[((s0.tile - geom.tileBase) * TILE * TILE + s0.oy * TILE + s0.ox) * 4 + 1] ^= 0x20;
  const r = auditTiles(t, sheetIdxFor);
  brk(`one packed texel of ${CLEAN[0]} changed`, r.bad > tb.bad);
}
{ // a villager profession-overlay tile (#1796): one alpha byte of villager#15's first slice
  const t = Buffer.from(tiles), s0 = geom.layers['villager#15'][0].find((f) => f.length)[0];
  t[((s0.tile - geom.tileBase) * TILE * TILE + s0.oy * TILE + s0.ox) * 4 + 3] ^= 0x80;
  const r = auditTiles(t, sheetIdxFor);
  brk('one alpha byte of villager#15 (a profession overlay) changed', r.bad > tb.bad && (r.per['villager#15'] || 0) > 0);
}
{ // #3928: the trader_llama carpet (decor#null#16) bound to the white carpet sheet
  const r = auditTiles(tiles, (n) => (n === 'decor#null#16' ? sheetIdxFor('decor#null') : sheetIdxFor(n)));
  brk('decor#null#16 (trader_llama.png) bound to the white carpet sheet', r.bad > tb.bad && (r.per['decor#null#16'] || 0) > 0);
}
{ // a layer bound to another layer's sheet (wrong texture bound)
  const a = CLEAN[0], b = CLEAN.find((n) => sheetIdxFor(n) !== sheetIdxFor(a) && jarImg(H.sheets[sheetIdxFor(n)].p).w === jarImg(H.sheets[sheetIdxFor(a)].p).w);
  const r = auditTiles(tiles, (n) => (n === a ? sheetIdxFor(b) : sheetIdxFor(n)));
  brk(`${a} bound to the ${b} sheet`, r.bad > tb.bad);
}
{ // a tile's pixels shifted by one column
  const t = Buffer.from(tiles);
  const s0 = geom.layers[CLEAN[0]][0][0][0], base = (s0.tile - geom.tileBase) * TILE * TILE * 4;
  for (let y = 0; y < TILE; y++) for (let x = TILE - 1; x > 0; x--) for (let c = 0; c < 4; c++) t[base + (y * TILE + x) * 4 + c] = t[base + (y * TILE + x - 1) * 4 + c];
  const r = auditTiles(t, sheetIdxFor);
  brk('first clean tile shifted one column', r.bad > tb.bad);
}
{ // #1508 breaks
{ // the frame-0 rule must be able to fail: a sheet whose .mcmeta starts on frame 2
  const f0 = (fr) => (fr ? (typeof fr[0] === 'object' ? fr[0].index : fr[0]) : 0);
  brk('mcmeta frames [2,0,1] read as a non-zero first frame', f0([2, 0, 1]) !== 0 && f0([{ index: 3, time: 2 }]) !== 0 && f0(undefined) === 0);
}
  const b = Buffer.from(pRaw); b[40 * 4096 + 5] ^= 0x08;
  brk('one texel of a particle layer flipped', auditParticles(b).bad > pa.bad);
  const b2 = Buffer.from(pRaw); b2.copyWithin(0, 4096, 8192);   // layer 0 replaced by layer 1
  brk('particle layer 0 overwritten by layer 1', auditParticles(b2).bad > pa.bad);
  const x = Buffer.from(xRaw); x[16 * 4 * 5 + 2] ^= 0x01;
  brk('one xp orb texel flipped', auditXp(x) > xb);
  if (typeof guiBreak === 'function') brk('one alpha byte of the widgets sheet flipped', guiBreak());
  const bt = Buffer.from(bRawBlk); bt[3 + 40 * IT * IT * 4] ^= 0x80;   // alpha of a block tile
  brk('one block tile alpha byte flipped', auditItems(bt, bti.index, {}, true).bad > ba2.bad);
  const bh = Buffer.from(bRawBlk); let hi = -1;   // a hidden texel in a partly-visible tile, recoloured to a colour the tile does not have
  for (let k = 0; k < bti.count && hi < 0; k++) { const T = bh.subarray(k * 1024, k * 1024 + 1024); let v = 0, h = -1; for (let o = 0; o < 1024; o += 4) { if (T[o + 3]) v++; else h = o; } if (v && h >= 0) hi = k * 1024 + h; }
  bh[hi] = 1; bh[hi + 1] = 2; bh[hi + 2] = 3;
  brk('bleed colour not present in its own tile', auditItems(bh, bti.index, {}, true).bad > ba2.bad);
  const bv = Buffer.from(bRawBlk); const vi = bv.findIndex((v, k) => k % 4 === 0 && bv[k + 3] === 255 && k > 4096); bv[vi] ^= 0x40;
  brk('one visible block texel recoloured', auditItems(bv, bti.index, {}, true).bad > ba2.bad);
  const t = Buffer.from(iRaw); t[100 * IT * IT * 4 + 7] ^= 0x10;
  brk('one item tile texel flipped', auditItems(t).bad > ia.bad);
  const sw = { ...iai.index }, ks = Object.keys(sw); [sw[ks[0]], sw[ks[1]]] = [sw[ks[1]], sw[ks[0]]];
  brk('two item sprites bound to each other\'s tiles', auditItems(iRaw, sw).bad > ia.bad);
  if (typeof beBreak === 'function') { brk('one block-entity tile texel flipped', beBreak()); brk('bleed into block-entity tile padding', padBreak()); }
}
console.log(`${caught} breaks caught`);
console.log(`\ntexl1check: ${pass} assertions, ${fails.length} failed`);
for (const f of fails) console.log('   ✗ ' + f);
process.exit(fails.length ? 1 : 0);
