#!/usr/bin/env node
// beorientcheck.mjs — #7652. Banner, bed and shield ICON orientation, measured on the rasterised picture.
//   node tools/beorientcheck.mjs
// Vanilla: banner item scale(.667,-.667,-.667) and shield item scale(1,-1,-1) are 180deg turns about X; a bed is
// rotZ(180) then rotX(90). Wrong orientation puts the flag above its crossbar, the legs above the mattress,
// or the shield's handle in front of its plate. Every assertion is also run against a deliberately broken
// renderer option set (anti-vacuity, D-30).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const NS = {}; globalThis.MCL = NS;
for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '02g_items.js', '14f_inventory.js',
                 '15e_creative.js', '15h_bemodel.js', '10_gfx.js', '15d_blockicon.js']) {
  new Function('MCL', readFileSync(ROOT + 'src/' + f, 'utf8'))(NS);
}
const mm = JSON.parse(readFileSync(ROOT + 'assets/models.meta.json', 'utf8'));
NS.BEModel.init({ models: readFileSync(ROOT + 'assets/models.bin').toString('base64'), modelsBytes: mm.rawBytes });
const BE = NS.BEModel;
NS.Gui = NS.Gui || {}; NS.Gui.sheets = { t: { canvas: { getContext() {} } } };
const tex = { w: 64, data: new Uint8ClampedArray(64 * 64 * 4).fill(255) };
// a texture whose texels under `targets`' face rectangles are red and everything else white
function redTex(targets) {
  const d = new Uint8ClampedArray(64 * 64 * 4).fill(255);
  for (const p of targets) for (const r of BE.faceRects(p)) {
    for (let y = r[1]; y < r[1] + r[3]; y++) for (let x = r[0]; x < r[0] + r[2]; x++) { const i = (y * 64 + x) * 4; d[i + 1] = 0; d[i + 2] = 0; }
  }
  return { w: 64, data: d };
}
const redCount = (b) => { let n = 0; for (let i = 0; i < S * S; i++) if (b[i * 4 + 3] && b[i * 4 + 1] < 120) n++; return n; };
// share of `target`'s own picture that survives in front of the other parts: <1 means something hides it
function visible(layer, name, parts, target, over) {
  const t = redTex(target);
  const full = redCount(draw(layer, name, parts, Object.assign({ texData: t }, over)));
  const alone = redCount(draw(layer, name, parts, Object.assign({ texData: t }, over), target));
  return alone ? full / alone : NaN;
}
const S = 64;

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

// draw only `keep`, but frame on all of `parts` (hidden parts still set the extent)
function draw(layer, name, parts, over, keep) {
  if (keep) parts = parts.map((p) => keep.includes(p) ? p : Object.assign({}, p, { hidden: true }));
  const g = BE.gui[name];
  return BE.render(layer, 't', S, Object.assign({
    texData: tex, parts, rotX: g.rot[0], rotY: g.rot[1], rotZ: g.rot[2],
    flip: !!BE.FLIP[layer], bed: !!(BE.BED && BE.BED[layer]), turn: !!(BE.TURN && BE.TURN[layer])
  }, over || {}));
}
const cy = (b) => { let s = 0, n = 0; for (let i = 0; i < S * S; i++) if (b[i * 4 + 3]) { s += (i / S | 0); n++; } return n ? s / n : NaN; };
const mask = (b) => { let s = ''; for (let i = 0; i < S * S; i++) s += b[i * 4 + 3] ? '1' : '0'; return s; };

// returns the list of failed expectations for a given option override; [] is healthy
function measure(over) {
  const bad = [];
  const B = BE.layer('banner').parts;
  const bar = B.filter((p) => p.w === 20 && p.h === 2), flag = B.filter((p) => p.h === 40);
  if (!(cy(draw('banner', 'white_banner', B, over, bar)) < cy(draw('banner', 'white_banner', B, over, flag)))) bad.push('banner crossbar below its flag');

  if (!(visible('banner', 'white_banner', B, B.filter((p) => p.w === 2), over) < 0.9)) bad.push('banner pole in front of its flag');

  const H = BE.layer('bed_head').parts;
  const legs = H.filter((p) => p.rx), main = H.filter((p) => !p.rx);
  const bo = Object.assign({}, over);
  if (!(cy(draw('bed_head', 'red_bed', H, bo, legs)) > cy(draw('bed_head', 'red_bed', H, bo, main)))) bad.push('bed legs above mattress');

  const Hd = BE.layer('bed_head').parts, Ft = BE.layer('bed_foot').parts.map((p) => Object.assign({}, p, { py: (p.py || 0) + 16 }));
  const both = Hd.concat(Ft), hm = Hd.filter((p) => !p.rx), fm = Ft.filter((p) => !p.rx);
  const hc = cy(draw('bed_head', 'red_bed', both, bo, hm)), fc = cy(draw('bed_head', 'red_bed', both, bo, fm));
  if (!(hc < fc)) bad.push('bed head and foot swapped');
  if (!(visible('bed_head', 'red_bed', H, legs, bo) < 0.9)) bad.push('bed legs in front of mattress');

  const Sh = BE.layer('shield').parts;
  if (!(visible('shield', 'shield', Sh, Sh.filter((p) => p.h === 6), over) < 0.5)) bad.push('shield handle in front of its plate');
  return bad;
}

const healthy = measure();
ok(healthy.length === 0, 'icon orientation: ' + healthy.join('; '));
console.log('beorientcheck — #7652, banner/bed/shield icon orientation');
console.log('   healthy renderer: ' + (healthy.length ? healthy.join('; ') : 'all four orientations right'));

const breaks = [
  ['banner as a mirror', { turn: false, flip: true }, 'banner'],
  ['banner raw', { turn: false, flip: false }, 'banner'],
  ['shield raw', { turn: false, flip: false }, 'shield'],
  ['bed as a mirror', { bed: false, flip: true }, 'bed'],
  ['bed raw', { bed: false, flip: false }, 'bed']
];
let caught = 0;
for (const [label, over, key] of breaks) {
  const bad = measure(over).filter((m) => m.includes(key));
  const hit = bad.length > 0; if (hit) { caught++; console.log('   ✓ ' + label + ' is caught'); }
  ok(hit, 'anti-vacuity: "' + label + '" was not caught');
}
console.log('   ' + caught + ' breaks caught');
if (fails.length) { for (const f of fails) console.log('FAIL ' + f); process.exit(1); }
console.log('   ' + pass + ' checks passed');
