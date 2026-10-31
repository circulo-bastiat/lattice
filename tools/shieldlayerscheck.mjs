#!/usr/bin/env node
// shieldlayerscheck.mjs — #892 (KW-49-4d). Shield banner overlay: every textured BannerPattern ships an
// `sp_<name>` sheet (entity/shield/<name>.png) plus `be_shield_base`; a shield stack's BlockEntityTag gives
// `BE.shieldLook` (Base-tinted base + sp_ layers) and BE.composite lays them on. "<n> breaks caught".
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const NS = {};
globalThis.MCL = NS;
for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '15h_bemodel.js']) new Function('MCL', readFileSync(join(ROOT, 'src', f), 'utf8'))(NS);
const BE = NS.BEModel;
const whole = inflateRawSync(readFileSync(join(ROOT, 'assets', 'gui.bin')));
const hl = whole.readUInt32LE(0), head = JSON.parse(whole.subarray(4, 4 + hl).toString('utf8'));
const sheets = {};
for (const s of head.sheets) {
  const data = new Uint8ClampedArray(whole.subarray(4 + hl + s.o, 4 + hl + s.o + s.len));
  sheets[s.n] = { w: s.w, h: s.h, canvas: { getContext: () => ({ getImageData: () => ({ data }) }) } };
}
NS.Gui = { sheets };
BE.dye = { white: 0xF9FFFE, red: 0xB02E26, cyan: 0x169C9C, black: 0x1D1D21 };
const golden = readFileSync(join(ROOT, 'tools', 'golden', 'banner-patterns-1.18.2.tsv'), 'utf8').split('\n')
  .filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t')).filter((g) => g[2] === '1');

const opaque = (t) => { let a = 0; if (t) for (let i = 3; i < t.data.length; i += 4) a += t.data[i] ? 1 : 0; return a; };
function audit(sh, look) {
  const fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); };
  NS.Gui.sheets = sh; BE.clearCache();
  for (const [name] of golden) {
    const t = BE.texData('sp_' + name);
    ok(!!t && opaque(t) > 0, 'sp_' + name + ' missing or blank');
  }
  ok(!!BE.texData('be_shield_base') && opaque(BE.texData('be_shield_base')) > 0, 'be_shield_base missing');
  ok(look(null) === null && look({}) === null, 'a plain shield has no look');
  const tg = (p, base) => ({ BlockEntityTag: { Base: base, Patterns: p } });
  const a = look(tg([{ Pattern: 'bs', Color: 14 }], 15));
  ok(a && a.layers.length === 1 && a.layers[0].tex === 'sp_stripe_bottom', 'shield layer must use sp_ sheets');
  ok(!(look(tg([{ Pattern: 'zz', Color: 1 }], 0)) || { layers: [1] }).layers.length, 'unknown pattern dropped');
  const w = look(tg([], 0)), k = look(tg([], 15));
  ok(w && k && w.tint && k.tint && w.tint[0] > k.tint[0] + 0.5, 'Base must tint the base (white vs black)');
  if (a) {
    const plain = BE.composite(a.tex, a.tint, []), one = BE.composite(a.tex, a.tint, a.layers);
    ok(plain && one && Buffer.compare(Buffer.from(plain.data), Buffer.from(one.data)) !== 0, 'a pattern must change the shield');
    let red = 0;
    if (one) for (let i = 0; i < one.data.length; i += 4) if (one.data[i] > one.data[i + 1] + 60 && one.data[i + 3]) red++;
    ok(red > 20, 'a red stripe must show (' + red + ')');
  }
  return fails;
}
console.log('shieldlayerscheck — #892');
const clean = audit(sheets, BE.shieldLook);
if (clean.length) { clean.forEach((f) => console.log('  ✗ ' + f)); console.log(clean.length + ' failures'); process.exit(1); }
console.log(' clean data passes (' + golden.length + ' shield pattern sheets)');
let breaks = 0;
const brk = (f, why) => { if (f.length) { breaks++; console.log('   ✓ anti-vacuity: ' + why + ' caught'); } else { console.log('  ✗ anti-vacuity: ' + why + ' not caught'); process.exit(1); } };
{ const s = { ...sheets }; delete s.sp_stripe_bottom; brk(audit(s, BE.shieldLook), 'dropped sp_ sheet'); }
{ const s = { ...sheets }; delete s.be_shield_base; brk(audit(s, BE.shieldLook), 'dropped base'); }
{ const s = { ...sheets, sp_border: { ...sheets.sp_border, canvas: { getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray(64 * 64 * 4) }) }) } } }; brk(audit(s, BE.shieldLook), 'blank sheet'); }
brk(audit(sheets, (t) => { const r = BE.shieldLook(t); if (r) r.tint = null; return r; }), 'Base ignored');
brk(audit(sheets, (t) => { const r = BE.shieldLook(t); if (r) r.layers = []; return r; }), 'layers dropped');
console.log(' shieldlayerscheck: ' + (golden.length + 10) + ' assertions, 0 failures, ' + breaks + ' breaks caught');
