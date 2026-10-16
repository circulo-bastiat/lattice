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
const cache = new Map(); const png = (p) => cache.get(p) || (cache.set(p, jarPng(p)), cache.get(p));

// compare one layer against the oracle; mut lets the self-test corrupt its inputs. Returns failed rows.
function checkLayer(name, mut = {}) {
  const f = [], idxs = H.layers[name], m = L[name];
  if (!idxs) return [`${name}: no sheets packed`]; if (!m) return [`${name}: no model`];
  const tw = mut.tw ?? m.tw, th = mut.th ?? m.th;
  for (const i of idxs) {
    const s = H.sheets[i], img = png(s.p);
    if (img.width !== s.w || img.height !== s.h) f.push(`${name}: ${s.p} packed ${s.w}x${s.h} jar ${img.width}x${img.height}`);
    if (s.w !== tw || s.h !== th) f.push(`${name}: ${s.p} sheet ${s.w}x${s.h} != model ${tw}x${th}`);
    const got = Buffer.from(bin.subarray(4 + hl + s.o, 4 + hl + s.o + s.len)), want = Buffer.from(img.data || img.pixels);
    if (mut.px) got[0] ^= 0xff;
    if (got.length !== want.length || Buffer.compare(got, want) !== 0) f.push(`${name}: ${s.p} pixels differ from jar`);
  }
  for (const p of m.parts) {
    const du = (mut.du || 0), u = p.tu + du, g = p.g || 0, w = p.w - 2 * g, h = p.h - 2 * (g + (p.gy || 0)), d = p.d - 2 * g;   // grow is not UV area
    if (u + 2 * d + 2 * w > tw + 1e-6 || p.tv + d + h > th + 1e-6) f.push(`${name}.${p.n}: UV box ${u},${p.tv} ${p.w}x${p.h}x${p.d} outside ${tw}x${th}`);
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
  brk(checkLayer(probe, { du: 100000 }).some((r) => /outside/.test(r)), 'UV shifted');
  brk(checkLayer('no_such_layer').length === 1, 'unknown layer');
  void other;
  console.log(bad ? `FAIL ${bad} mobs/checks bad (${Object.keys(roster).length} mobs)` : `mobtexproofcheck: ${Object.keys(roster).length} mobs, ${caught} breaks caught`);
  process.exit(bad ? 1 : 0);
}
