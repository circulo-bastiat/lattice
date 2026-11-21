// drownedtexcheck (#7658): the drowned's skin and outer layer. (1) body sheet == jar zombie/drowned.png (not zombie.png), outer sheet ==
// drowned_outer_layer.png, both 64x64; (2) the drowned_outer model is the drowned grown by Dilation(0.25) (hat 0.75) -- DrownedEntityModel
// .getTexturedModelData(new Dilation(0.25F)); (3) the renderer emits the outer pass (DrownedOverlayFeatureRenderer) with that layer;
// (4) zombie, husk, zombie_villager bind their own 64x64 sheets.
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Jar } from './jarlib.mjs';
import { decodePng } from './png.mjs';
import { requireJar } from './paths.mjs';

const T = dirname(fileURLToPath(import.meta.url)), A = join(T, '..', 'assets');
const bin = inflateRawSync(readFileSync(join(A, 'mob-tex.bin'))), hl = bin.readUInt32LE(0), H = JSON.parse(bin.subarray(4, 4 + hl).toString('utf8'));
const L = JSON.parse(inflateRawSync(readFileSync(join(A, 'models.bin'))).toString('utf8')).layers;
const src = readFileSync(join(T, '..', 'src', '07j_entityrender.js'), 'utf8');
const jar = new Jar(requireJar('1.18.2')), jarPng = (p) => decodePng(jar.read(p));
const ZP = 'assets/minecraft/textures/entity/zombie/';

function audit(m = {}) {
  const f = [], pix = (layer) => { const i = H.layers[layer]?.[0]; if (i === undefined) return null; const s = H.sheets[i]; return { s, d: Buffer.from(bin.subarray(4 + hl + s.o, 4 + hl + s.o + s.len)) }; };
  const want = { drowned: 'drowned.png', 'drowned_outer#null': 'drowned_outer_layer.png', zombie: 'zombie.png', husk: 'husk.png', zombie_villager: '../zombie_villager/zombie_villager.png' };
  for (const [layer, file] of Object.entries(want)) {
    const key = m.zombieSkin && layer === 'drowned' ? 'zombie' : m.noOuter && layer === 'drowned_outer#null' ? 'nope' : layer, got = pix(key);
    if (!got) { f.push(layer + ': no sheet packed'); continue; }
    const j = jarPng('assets/minecraft/textures/entity/' + (file.startsWith('..') ? file.slice(3) : 'zombie/' + file)), w = Buffer.from(j.data || j.pixels);
    if (got.s.w !== 64 || got.s.h !== 64) f.push(layer + ': sheet ' + got.s.w + 'x' + got.s.h);
    if (got.s.p !== 'assets/minecraft/textures/entity/' + (file.startsWith('..') ? file.slice(3) : 'zombie/' + file)) f.push(layer + ': bound ' + got.s.p);
    if (Buffer.compare(got.d, w) !== 0) f.push(layer + ': pixels differ from jar');
  }
  const o = L['drowned_outer#null'], inner = L.drowned;
  if (!o) f.push('drowned_outer#null: no model');
  else for (const p of o.parts) {
    const g = m.ungrown ? 0 : p.g, d = p.n === 'hat' ? 0.75 : 0.25;
    if (Math.abs((g || 0) - d) > 1e-6) f.push('drowned_outer.' + p.n + ': grow ' + g + ' != ' + d);
    const ip = inner.parts.find((q) => q.n === p.n);
    if (!ip || p.tu !== ip.tu || p.tv !== ip.tv) f.push('drowned_outer.' + p.n + ': UV differs from drowned');
  }
  if (!(m.noPass ? src.replace(/mobLayer: 'drowned_outer#null'/g, '') : src).includes("mobLayer: 'drowned_outer#null', texKey: 'drowned_outer#null'")) f.push('renderer never emits the drowned outer pass');
  return f;
}

const base = audit();
let caught = 0, bad = 0;
if (base.length) { console.log(base.join('\n')); bad++; }
for (const [w, mm, re] of [['zombie skin bound', { zombieSkin: 1 }, /pixels differ|bound/], ['outer sheet lost', { noOuter: 1 }, /no sheet/], ['outer ungrown', { ungrown: 1 }, /grow/], ['outer pass not emitted', { noPass: 1 }, /never emits/]]) {
  if (audit(mm).some((r) => re.test(r))) caught++; else { bad++; console.log('NOT CAUGHT ' + w); }
}
console.log(bad ? 'FAIL drownedtexcheck' : `drownedtexcheck: skin + outer layer ok, ${caught} breaks caught`);
process.exit(bad ? 1 : 0);
