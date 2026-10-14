#!/usr/bin/env node
// pack-models.mjs — PLAN G10c. The model-layer boxes, from the golden TSV into the runtime.
//
//   node tools/pack-models.mjs [--out assets]
//
// ⚠ THE WHOLE TABLE SHIPS, not the ten layers the icons need today. It is 310 boxes — about six
// kilobytes of JSON before deflate — and the alternative is a hand-picked subset, which is the
// second roster D-313 spent a session learning not to write. G17c needs the other sixty-odd
// layers and they will already be there.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Jar } from './jarlib.mjs';
import { resolveModel } from './models.mjs';
import { JARS as MCLITE_JARS } from './paths.mjs';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const OUT = opt('out', join(MCLITE_ROOT, 'assets'));
// ⚠ THE 1.13.2 JAR, like every other texture and model this game ships (D-5).
const JAR = (() => {
  const flat = MCLITE_JARS + '/1.13.2.jar';
  return existsSync(flat) ? flat : MCLITE_JARS + '/1.13.2/1.13.2.jar';
})();
mkdirSync(OUT, { recursive: true });

const SRC = join(MCLITE_ROOT, 'tools', 'golden', 'models-1.18.2.tsv');
const layers = Object.create(null);
let boxes = 0;
for (const line of readFileSync(SRC, 'utf8').split(/\r?\n/)) {
  if (!line || line.startsWith('#')) continue;
  const c = line.split('\t');
  if (c.length < 19) continue;
  const name = c[0];
  if (!layers[name]) layers[name] = { tw: +c[17], th: +c[18], parts: [] };
  layers[name].parts.push({
    n: c[1], tu: +c[2], tv: +c[3],
    x: +c[4], y: +c[5], z: +c[6], w: +c[7], h: +c[8], d: +c[9],
    px: +c[10], py: +c[11], pz: +c[12],
    rx: +c[13], ry: +c[14], rz: +c[15], m: +c[16], g: +c[19] || 0, gy: +c[20] || 0   // #633: the CubeDeformation; #2548: extra y-only grow
  });
  boxes++;
}
// G18a-1 (#209): the `boat` layer, from tools/extract-boat.mjs (BoatEntityModel.getTexturedModelData —
// `createBoat(type)` is a factory, not a static `ModelLayers` field, so the bytecode walk above misses it).
{
  const bf = join(MCLITE_ROOT, 'tools', 'golden', 'boat-model-1.18.2.tsv');
  for (const line of readFileSync(bf, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const c = line.split('\t');
    if (!layers[c[0]]) layers[c[0]] = { tw: +c[17], th: +c[18], parts: [] };
    layers[c[0]].parts.push({
      n: c[1], tu: +c[2], tv: +c[3], x: +c[4], y: +c[5], z: +c[6], w: +c[7], h: +c[8], d: +c[9],
      px: +c[10], py: +c[11], pz: +c[12], rx: +c[13], ry: +c[14], rz: +c[15], m: +c[16]
    });
    boxes++;
  }
}
// ⚠ TWO LAYERS THE WALK CANNOT REGISTER (they were `BE.OWED`), added from the decompiled classes:
//  - `dragon_head` is `DragonHeadEntityModel.getTexturedModelData()`: the ender dragon's own `head`
//    and `jaw` boxes (already in the table above, read out of the bytecode) on the same 256x256
//    sheet. Two things the walk loses are put back from that source: the `scale` and `nostril`
//    boxes at x = -5 follow `.mirrored(true)`, and `setHeadRotation(0, ...)` leaves the jaw at
//    pitch `(sin(0) + 1) * 0.2` = 0.2 rad, which is how the item is drawn (animation progress 0).
//  - `conduit` is `ConduitBlockEntityRenderer.getShellTexturedModelData()`: one 6x6x6 box at
//    uv (0, 0) on a 32x16 sheet, what an inactive conduit (the item) draws with `base.png`.
if (layers.ender_dragon) {
  const dh = { tw: 256, th: 256, parts: [] };
  for (const p of layers.ender_dragon.parts) {
    if (p.n !== 'head' && p.n !== 'jaw') continue;
    const q = Object.assign({}, p);
    if (p.n === 'head' && p.w === 2) q.m = p.x === -5 ? 1 : 0;   // #1565 mirrors all four in the ender_dragon rows; DragonHeadEntityModel mirrors only the x=-5 pair
    if (p.n === 'jaw') q.rx = 0.2;
    dh.parts.push(q);
  }
  if (dh.parts.length !== 7) { console.error('pack-models: ender_dragon head+jaw is ' + dh.parts.length + ' boxes, not 7'); process.exit(1); }
  layers.dragon_head = dh;
  boxes += dh.parts.length;
}
layers.conduit = { tw: 32, th: 16, parts: [
  { n: 'shell', tu: 0, tv: 0, x: -3, y: -3, z: -3, w: 6, h: 6, d: 6, px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, m: 0 }
] };
boxes += 1;
// #6373: `SignBlockEntityRenderer.getTexturedModelData()` (.decomp): the board and the stick, 64x32.
layers.sign = { tw: 64, th: 32, parts: [
  { n: 'sign', tu: 0, tv: 0, x: -12, y: -14, z: -1, w: 24, h: 12, d: 2, px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, m: 0 },
  { n: 'stick', tu: 0, tv: 14, x: -1, y: -2, z: -1, w: 2, h: 14, d: 2, px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, m: 0 }
] };
boxes += 2;
// #5541: the active conduit's other four layers (`ConduitBlockEntityRenderer.get*TexturedModelData`).
const cbox = (n, x, w, h, d, g) => Object.assign({ n, tu: 0, tv: 0, x, y: x, z: x, w, h, d, px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, m: 0 }, g ? { g } : {});
layers.conduit_cage = { tw: 32, th: 16, parts: [cbox('shell', -4, 8, 8, 8)] };
layers.conduit_wind = { tw: 64, th: 32, parts: [cbox('wind', -8, 16, 16, 16)] };
layers.conduit_eye = { tw: 16, th: 16, parts: [Object.assign(cbox('eye', -4.01, 8.02, 8.02, 0.02, 0.01), { z: -0.01 })] };   // stored GROWN (g=0.01), like every dilated box
boxes += 3;
// #1128: `stray_outer` = EntityModels' STRAY_OUTER, `BipedEntityModel.getModelData(new Dilation(0.25F), 0)`
// on 64x32 -- the walk cannot register it (it is a local `TexturedModelData.of`, not a createMesh
// call). Its boxes are the biped's own (`skeleton#b`: 4-wide arms/legs, pivots 1.9/5) grown 0.25 on
// every side, the hat 0.75 (Dilation.add(0.5)); the tsv stores boxes already inflated by `grow`.
if (layers['skeleton#b']) {
  const so = { tw: 64, th: 32, parts: [] };
  for (const p of layers['skeleton#b'].parts) {
    const d = p.n === 'hat' ? 0.75 : 0.25, g0 = p.g || 0, add = d - g0, q = Object.assign({}, p);
    q.x = p.x - add; q.y = p.y - add; q.z = p.z - add; q.w = p.w + 2 * add; q.h = p.h + 2 * add; q.d = p.d + 2 * add; q.g = d;
    so.parts.push(q);
  }
  layers.stray_outer = so;
  boxes += so.parts.length;
}
// #1869: `slime_outer` = SlimeEntityModel.getOuterTexturedModelData (a local TexturedModelData.of the walk cannot see):
// one 8x8x8 gel cube, uv 0,0, 64x32 -- SlimeOverlayFeatureRenderer draws it over the inner model.
layers.slime_outer = { tw: 64, th: 32, parts: [
  { n: 'cube', tu: 0, tv: 0, x: -4, y: 16, z: -4, w: 8, h: 8, d: 8, px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, m: 0 }
] };
boxes += 1;
// #2540: magma_cube's cube0..7 slices are loop-built (MagmaCubeEntityModel.getTexturedModelData), invisible to the walk:
// 8x1x8 slices at y 16+i (uv 0,i; slice 2 -> 24,10; slice 3 -> 24,19) plus the walk's own inside_cube.
if (layers.magma_cube) {
  const uv = (i) => (i === 2 ? [24, 10] : i === 3 ? [24, 19] : [0, i]);
  const sl = [];
  for (let i = 0; i < 8; i++) sl.push({ n: 'cube' + i, tu: uv(i)[0], tv: uv(i)[1], x: -4, y: 16 + i, z: -4, w: 8, h: 1, d: 8, px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, m: 0 });
  boxes += 8;
  layers.magma_cube.parts = sl.concat(layers.magma_cube.parts.filter((p) => p.n === 'inside_cube'));
}
// #1548: the humanoid armour layers (`<mob>#b` inner, `<mob>#c` outer) are `BipedEntityModel.getModelData(dilation, 0)`
// (EntityModels.java: inner HAT_DILATION 0.5, outer ARMOR_DILATION 1.0; piglin/zombified_piglin outer Dilation(1.02);
// drowned's outer is the same 0.5 as its inner; ZombieVillagerEntityModel.getArmorTexturedModelData adds 0.1 to
// body and legs). The walk read the boxes but not the Dilation, so every box came out ungrown (g 0, hat 0.5) - grow
// each one to its true dilation here (the tsv stores boxes already inflated by `g`, as stray_outer above).
// zombified_piglin#c is the boat's model in the walk (a name collision on the `$$3` slot): it is the 1.02 biped.
if (layers['zombified_piglin#b'] && layers['zombified_piglin#c'] && layers['zombified_piglin#c'].parts.some((p) => p.n === 'water_patch')) {
  boxes += layers['zombified_piglin#b'].parts.length - layers['zombified_piglin#c'].parts.length;
  layers['zombified_piglin#c'] = { tw: layers['zombified_piglin#b'].tw, th: layers['zombified_piglin#b'].th, parts: layers['zombified_piglin#b'].parts.map((p) => Object.assign({}, p)) };
}
for (const mob of ['armor_stand', 'drowned', 'giant', 'husk', 'piglin', 'piglin_brute', 'player', 'player_slim', 'skeleton', 'stray',
                   'wither_skeleton', 'zombie', 'zombie_villager', 'zombified_piglin']) {
  for (const sfx of ['b', 'c']) {
    const L = layers[mob + '#' + sfx];
    if (!L) continue;
    const dil = sfx === 'b' ? 0.5 : /piglin/.test(mob) ? 1.02 : mob === 'drowned' ? 0.5 : 1.0;
    for (const p of L.parts) {
      const d = dil + (p.n === 'hat' ? 0.5 : mob === 'zombie_villager' && /^(body|left_leg|right_leg)$/.test(p.n) ? 0.1 : 0);
      const add = d - (p.g || 0);
      p.x -= add; p.y -= add; p.z -= add; p.w += 2 * add; p.h += 2 * add; p.d += 2 * add; p.g = d;
    }
  }
}
// Horse-family baby legs: `Dilation.add(0, 5.5F, 0)` grows Y only (HorseEntityModel.getModelData). The walk keeps one scalar
// grow, so state the grown box and the Y-only grow (`gy`, read by faceRects) here, for all four legs of every horse layer.
for (const k of Object.keys(layers)) for (const p of layers[k].parts) if (/^(left|right)_(front|hind)_baby_leg$/.test(p.n)) { p.y = -6.51; p.h = 22; p.g = 0; p.gy = 5.5; }
const names = Object.keys(layers);
if (names.length < 50 || boxes < 200) {
  console.error(`pack-models: ${names.length} layers and ${boxes} boxes — run tools/extract-models.mjs`);
  process.exit(1);
}
// ⚠ THE LAYERS THE SIXTY BLANK ICONS NEED, asserted by NAME here rather than discovered at
// runtime: a payload that shipped without `chest` would give a creative inventory that still has
// blank slots in it and a build that said nothing.
for (const need of ['chest', 'bed_head', 'bed_foot', 'shulker', 'banner', 'shield',
                    'player_head', 'zombie_head', 'creeper_head', 'skeleton_skull',
                    'wither_skeleton_skull', 'dragon_head', 'conduit']) {
  if (!layers[need]) { console.error('pack-models: no "' + need + '" layer in the golden table'); process.exit(1); }
}

// ── the display transforms, out of the jar's own item models ────────────────────────────────
// ⚠⚠ **VANILLA GIVES EVERY ONE OF THESE ITEMS ITS OWN `gui` TRANSFORM AND THEY ARE NOT THE SAME.**
// A chest is `[30, 45, 0]` at 0.625; a banner is `[30, 20, 0]` at 0.5325 with a -3.25 lift; a bed
// is `[30, 160, 0]` at 0.5325 with a +2, +3 shift. Rendering all of them at the block icon's
// `[30, 225, 0]` gives a banner seen almost edge-on — which is exactly what the first version of
// this did, and the flag came out four pixels wide.
//
// The transforms live in `models/item/<name>.json`, often behind a `parent` chain
// (`white_banner` -> `item/template_banner` -> `builtin/entity`), and `resolveModel` follows it.
const GUI = Object.create(null);
{
  const jar = new Jar(JAR);
  const cache = new Map();
  const names = jar.names()
    .filter((n) => n.startsWith('assets/minecraft/models/item/') && n.endsWith('.json'))
    .map((n) => n.slice('assets/minecraft/models/item/'.length, -5));
  let builtin = 0;
  // ⚠ ONLY THE `builtin/entity` ITEMS. Every other item model's gui transform is already used by
  // the path that draws it — a sprite or a block model — and shipping 364 of them would be 300
  // numbers nothing reads (D-289's shape). The test is the PARENT CHAIN, walked here rather than
  // guessed from the name: a `builtin/entity` model is the only kind with no elements and no
  // layer0, which is exactly why these items had no icon in the first place.
  const chainOf = (id) => {
    const out = [];
    let cur = id, guard = 0;
    while (cur && guard++ < 16) {
      out.push(cur);
      if (cur === 'builtin/entity') break;
      const path = 'assets/minecraft/models/' + cur.replace(/^minecraft:/, '') + '.json';
      if (!jar.names().includes(path)) break;
      let j2;
      try { j2 = JSON.parse(Buffer.from(jar.read(path)).toString('utf8')); } catch (e) { break; }
      cur = j2.parent;
    }
    return out;
  };
  for (const n of names) {
    const chain = chainOf('item/' + n);
    if (chain.indexOf('builtin/entity') < 0) continue;
    builtin++;
    let m;
    try { m = resolveModel(jar, 'minecraft:item/' + n, cache); } catch (e) { continue; }
    if (!m || !m.display || !m.display.gui) continue;
    const g = m.display.gui;
    GUI[n] = {
      rot: (g.rotation || [0, 0, 0]).map(Number),
      tr: (g.translation || [0, 0, 0]).map(Number),
      sc: (g.scale || [1, 1, 1]).map(Number)
    };
  }
  console.log(' builtin/entity ..... ' + builtin + ' item models, ' + Object.keys(GUI).length
    + ' of them with a gui transform');
}

// ── the sixteen dye colours ─────────────────────────────────────────────────────────────────
// ⚠ A BANNER IS ONE WHITE TEXTURE TINTED SIXTEEN WAYS. Beds and shulker boxes each ship their own
// coloured PNG; banners do not — `BannerRenderer` draws `banner_base.png` through
// `DyeColor.getTextureDiffuseColors()`. Without these, all sixteen banners are white, which is
// exactly what the first build of this did. The values are the bytecode's own, out of
// `tools/golden/dye-colours-1.18.2.tsv`, and `textureDiffuseColor` is the column vanilla uses —
// NOT `fireworkColor`, which is a different set of sixteen numbers for the same sixteen names.
const DYE = Object.create(null);
{
  const f = join(MCLITE_ROOT, 'tools', 'golden', 'dye-colours-1.18.2.tsv');
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const c = line.split('\t');
    if (c.length >= 3 && c[0]) DYE[c[0]] = parseInt(c[2], 10) | 0;
  }
  if (Object.keys(DYE).length !== 16) {
    console.error('pack-models: the dye table has ' + Object.keys(DYE).length + ' colours, not 16');
    process.exit(1);
  }
  // ⚠ anchored, because a column read one to the left is sixteen plausible wrong colours
  if (DYE.white !== 0xF9FFFE || DYE.black !== 0x1D1D21 || DYE.red !== 0xB02E26) {
    console.error('pack-models: the dye column is not textureDiffuseColor — white is 0x'
      + (DYE.white >>> 0).toString(16) + ', vanilla\'s is 0xF9FFFE');
    process.exit(1);
  }
}

const whole = Buffer.from(JSON.stringify({ layers: layers, gui: GUI, dye: DYE }), 'utf8');
const packed = deflateRawSync(whole, { level: 9 });
if (Buffer.compare(inflateRawSync(packed), whole) !== 0) {
  console.error('pack-models: the deflate round trip does not match');
  process.exit(1);
}
writeFileSync(join(OUT, 'models.bin'), packed);
writeFileSync(join(OUT, 'models.meta.json'),
  JSON.stringify({ rawBytes: whole.length, packedBytes: packed.length, layers: names.length,
                   boxes, gui: Object.keys(GUI).length }));

console.log('=============== pack-models ===============');
console.log(` layers ............. ${names.length}`);
console.log(` boxes .............. ${boxes}`);
console.log(` gui transforms ..... ${Object.keys(GUI).length}`);
console.log(` dye colours ........ ${Object.keys(DYE).length}`);
console.log(` models.bin ......... ${(whole.length / 1024).toFixed(1)} KB raw -> ${(packed.length / 1024).toFixed(1)} KB deflated`);
console.log('===========================================');
