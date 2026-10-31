// mobtexproofcheck (#7522): texture dimension of the mob proof. Per roster mob (tools/mobl3-mobs.json), per engine layer:
// (1) every packed sheet's pixels == the jar PNG (1.18.2 first, 1.13.2 fallback), (2) sheet size == model tw/th and every
// box's UV extent (tu+2d+2w, tv+d+h) is inside the sheet. Oracle = the jars; the model sizes are checked against the sheet, not vice versa.
// Writes tools/mobproof/out/texture.json. NOT covered (ledger tools/mobtexproof-known.json, shrink-only): blend mode and
// the rendered-pixel raster (parts 3/4 of #7522) - listed per mob in notCovered.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Jar } from './jarlib.mjs';
import { decodePng } from './png.mjs';
import { requireJar } from './paths.mjs';

const T = dirname(fileURLToPath(import.meta.url)), A = join(T, '..', 'assets');
const roster = JSON.parse(readFileSync(join(T, 'mobl3-mobs.json'), 'utf8')).mobs;
const known = JSON.parse(readFileSync(join(T, 'mobtexproof-known.json'), 'utf8'));
const bin = inflateRawSync(readFileSync(join(A, 'mob-tex.bin'))), hl = bin.readUInt32LE(0);
const H = JSON.parse(bin.subarray(4, 4 + hl).toString('utf8'));
const L = JSON.parse(inflateRawSync(readFileSync(join(A, 'models.bin'))).toString('utf8')).layers;
const jars = [requireJar('1.18.2'), requireJar('1.13.2')].map((p) => new Jar(p));
const jarPng = (p) => { for (const j of jars) { try { return decodePng(j.read(p)); } catch { /* next */ } } throw new Error('no jar has ' + p); };
// blend mode per overlay layer, vanilla (.decomp RenderLayer + feature renderers) vs the engine's ER.MOB_BLEND literal
const VANILLA_BLEND = { slime_outer: 'translucent', stray_outer: 'cutout', 'drowned_outer#null': 'cutout', spider_eyes: 'additive', enderman_eyes: 'additive',
  phantom_eyes: 'additive', dragon_eyes: 'additive', wither_armor: 'additive', creeper_armor: 'additive' };
// the eyes / energy-swirl rows are read from the decompiled RenderLayer text, not only a literal: getEyes (EYES) and getEnergySwirl must both be ADDITIVE_TRANSPARENCY
const RL = readFileSync(join(T, '..', '.decomp', 'net/minecraft/client/render/RenderLayer.java'), 'utf8');
const decompTransparency = (rl, fn) => { const i = rl.indexOf(fn); const j = i < 0 ? '' : rl.slice(i, i + 900); const m = /\.transparency\((\w+)\)/.exec(j); return m && m[1]; };
const eyesT = (rl) => { const i = rl.indexOf('EYES = '); const m = /\.transparency\((\w+)\)/.exec(rl.slice(i, i + 900)); return i < 0 ? null : m && m[1]; };
const decompRows = (rl) => { const r = [];
  if (eyesT(rl) !== 'ADDITIVE_TRANSPARENCY') r.push('decomp getEyes transparency is ' + eyesT(rl) + ', table says eyes = additive');
  if (decompTransparency(rl, 'RenderLayer getEnergySwirl(') !== 'ADDITIVE_TRANSPARENCY') r.push('decomp getEnergySwirl transparency is ' + decompTransparency(rl, 'RenderLayer getEnergySwirl(') + ', table says additive');
  return r; };
const engineBlend = (src) => JSON.parse(/ER\.MOB_BLEND = (\{[^}]*\});/.exec(src)[1]);
function blendRows(eng, van = VANILLA_BLEND) {
  const r = []; for (const k of Object.keys(van)) if (eng[k] !== van[k]) r.push(`blend ${k}: engine draws ${eng[k]}, vanilla ${van[k]}`); return r;
}
const G = JSON.parse(readFileSync(join(A, 'mob-geometry.json'), 'utf8')).layers;
const cache = new Map(); const png = (p) => cache.get(p) || (cache.set(p, jarPng(p)), cache.get(p));

const HIRES = { end_crystal: 2 };
// compare one layer against the oracle; mut lets the self-test corrupt its inputs. Returns failed rows.
function checkLayer(name, mut = {}) {
  const f = [], idxs = H.layers[name], m = L[name];
  if (!idxs) return [`${name}: no sheets packed`]; if (!m) return [`${name}: no model`];
  const tw = mut.tw ?? m.tw, th = mut.th ?? m.th;
  for (const i of idxs) {
    const s = H.sheets[i], img = png(s.p);
    if (img.width !== s.w || img.height !== s.h) f.push(`${name}: ${s.p} packed ${s.w}x${s.h} jar ${img.width}x${img.height}`);
    const k = HIRES[name] || 1;   // #8083: vanilla normalises UVs by the model's 64x32, so a 2x sheet is sampled whole at 2x (docs/decisions/8083-end-crystal-sheet.md)
    if (s.w !== tw * k || s.h !== th * k) f.push(`${name}: ${s.p} sheet ${s.w}x${s.h} != model ${tw}x${th}`);
    const got = Buffer.from(bin.subarray(4 + hl + s.o, 4 + hl + s.o + s.len)), want = Buffer.from(img.data || img.pixels);
    if (mut.px) got[0] ^= 0xff;
    if (got.length !== want.length || Buffer.compare(got, want) !== 0) f.push(`${name}: ${s.p} pixels differ from jar`);
  }
  for (const p of m.parts) {
    const du = (mut.du || 0), tv = p.tv + (mut.dv || 0), u = p.tu + du, g = p.g || 0, w = p.w - 2 * g, h = p.h - 2 * (g + (p.gy || 0)), d = p.d - 2 * g;   // grow is not UV area
    // ModelPart.Cuboid: faces with a zero extent have no area; only non-degenerate faces count toward the UV extent
    let ue = 0, ve = 0; const face = (a, b, c, e) => { if (a > 0 && b > 0) { ue = Math.max(ue, c); ve = Math.max(ve, e); } };
    face(w, d, u + d + w, tv + d); face(w, d, u + d + 2 * w, tv + d); face(d, h, u + d, tv + d + h);
    face(w, h, u + d + w, tv + d + h); face(d, h, u + 2 * d + w, tv + d + h); face(w, h, u + 2 * d + 2 * w, tv + d + h);
    // #8160: vanilla samples with GL REPEAT, so a face leaving the sheet is legal IF the baked slices read the wrapped texels:
    // every sheet-leaving face's slices must name in-sheet source texels (su,sv) and their areas sum to the face (ARCH order +X -X +Y -Y +Z -Z)
    const rf = [p.m ? [d, h, u, tv + d] : [d, h, u + d + w, tv + d], p.m ? [d, h, u + d + w, tv + d] : [d, h, u, tv + d], [w, d, u + d + w, tv], [w, d, u + d, tv], [w, h, u + 2 * d + w, tv + d], [w, h, u + d, tv + d]];
    const pi = m.parts.indexOf(p), gp = G[name] && G[name][pi];
    rf.forEach(([fw, fh, fu, fv], fi) => {
      if (!(fw > 0 && fh > 0) || (fu >= 0 && fv >= 0 && fu + fw <= tw + 1e-6 && fv + fh <= th + 1e-6)) return;
      const sl = gp && gp[fi] || [], area = sl.reduce((a, q) => a + q.w * q.h, 0);
      if (mut.noWrap || !sl.length || sl.some((q) => !(q.su >= 0 && q.sv >= 0 && q.su + q.w <= tw && q.sv + q.h <= th) || q.su !== (((fu + q.u0) % tw) + tw) % tw || q.sv !== (((fv + q.v0) % th) + th) % th) || Math.abs(area - fw * fh) > 1e-6) f.push(`${name}.${p.n}: UV box ${u},${tv} ${p.w}x${p.h}x${p.d} outside ${tw}x${th}, face ${fi} not baked as wrapped slices`);
    });
  }
  return f;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = {}; let bad = 0;
  for (const [mob, layers] of Object.entries(roster)) {
    const failed = layers.flatMap((l) => checkLayer(l));
    out[mob] = { pass: failed.length === 0, checked: layers.map((l) => `${l}: jar pixels, sheet size, UV bounds`), notCovered: known.notCovered, failed };
    for (const r of failed) if (!known.failedRows.includes(r)) { bad++; console.log('NEW RED ' + mob + ': ' + r); }
  }
  const seen = new Set(Object.values(out).flatMap((o) => o.failed));
  for (const r of known.failedRows) if (!seen.has(r)) { bad++; console.log('STALE known row (fixed? remove it): ' + r); }
  const blend = blendRows(engineBlend(readFileSync(join(T, '..', 'src', '07j_entityrender.js'), 'utf8'))).concat(decompRows(RL));
  for (const r of blend) if (!known.blendRows.includes(r)) { bad++; console.log('NEW BLEND RED ' + r); }
  for (const r of known.blendRows) if (!blend.includes(r)) { bad++; console.log('STALE blend row: ' + r); }
  for (const mob of Object.keys(roster)) if (!out[mob]) { bad++; console.log('no row ' + mob); }
  mkdirSync(join(T, 'mobproof', 'out'), { recursive: true });
  writeFileSync(join(T, 'mobproof', 'out', 'texture.json'), JSON.stringify(out, null, 1));
  // shrink-only ledger: the list may not grow past the committed length
  if (known.notCovered.length > known.max) { bad++; console.log('notCovered ledger grew'); }
  // anti-vacuity: corrupt each compared field, assert it is caught
  let caught = 0; const probe = Object.values(roster)[0][0], other = Object.values(roster).flat();
  const brk = (c, w) => { if (c) caught++; else { bad++; console.log('NOT CAUGHT ' + w); } };
  brk(checkLayer(probe, { px: 1 }).some((r) => /pixels differ/.test(r)), 'pixel flip');
  brk(checkLayer(probe, { tw: 1 }).some((r) => /!= model/.test(r)), 'model width');
  brk(checkLayer(probe, { th: 1 }).some((r) => /!= model/.test(r)), 'model height');
  brk(checkLayer(probe, { tw: 1, th: 1 }).some((r) => /outside/.test(r)), 'UV outside');
  brk(checkLayer('pufferfish_big', { du: 100001 }).some((r) => /outside/.test(r)), 'UV shifted');
  brk(checkLayer('pufferfish_big', { noWrap: 1 }).some((r) => /top_back_fin.*not baked/.test(r)), 'unwrapped fin');
  brk(checkLayer('pufferfish_big', { du: 5 }).some((r) => /top_back_fin/.test(r)), 'fin u shifted');
  brk(checkLayer('tropical_fish_small', { dv: 3 }).some((r) => /\.tail/.test(r)), 'tail v offset');
  brk(checkLayer('no_such_layer').length === 1, 'unknown layer');
  const eng = engineBlend(readFileSync(join(T, '..', 'src', '07j_entityrender.js'), 'utf8'));
  brk(blendRows({ ...eng, slime_outer: 'cutout' }).some((r) => /slime_outer/.test(r)), 'blend swap');
  brk(blendRows({ ...eng, creeper_armor: 'translucent' }).some((r) => /creeper_armor/.test(r)), 'blend swap 2');
  brk(decompRows(RL.replace('EYES = ', 'EYES = /*').replace('.transparency(ADDITIVE_TRANSPARENCY)', '.transparency(TRANSLUCENT_TRANSPARENCY)')).length > 0, 'decomp eyes transparency');
  brk(decompRows(RL.replace('getEnergySwirl(Identifier', 'getEnergySwirl(Identifier').replace(/(getEnergySwirl\([\s\S]*?)ADDITIVE_TRANSPARENCY/, '$1NO_TRANSPARENCY')).length > 0, 'decomp swirl transparency');
  void other;
  console.log(bad ? `FAIL ${bad} mobs/checks bad (${Object.keys(roster).length} mobs)` : `mobtexproofcheck: ${Object.keys(roster).length} mobs, ${caught} breaks caught`);
  process.exit(bad ? 1 : 0);
}
