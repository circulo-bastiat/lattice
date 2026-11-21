#!/usr/bin/env node
// bannerlayerscheck.mjs — #891 (KW-49-4c). Banner pattern layers: every `BannerPattern` with a texture
// ships a `bp_<name>` sheet (gui.bin), `BlockEntityTag.Patterns` on a stack resolves to tinted layers,
// and `BE.composite` lays them over the tinted base in order. Anti-vacuity: each assertion group is
// re-run against deliberately broken data and must fail ("<n> breaks caught").
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
  .filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t'));

function audit(sh, codes, compose) {
  const fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); };
  NS.Gui.sheets = sh; BE.clearCache();
  for (const [name, code, tex] of golden) {
    if (tex !== '1') continue;
    const t = BE.texData('bp_' + name);
    ok(!!t, 'no sheet bp_' + name);
    if (t) { let a = 0; for (let i = 3; i < t.data.length; i += 4) a += t.data[i] ? 1 : 0; ok(a > 0, 'bp_' + name + ' is fully transparent'); }
    ok(codes[code] === name, 'code ' + code + ' does not map to ' + name);
  }
  const cnt = (n) => { const t = BE.texData('bp_' + n); let a = 0; if (t) for (let i = 3; i < t.data.length; i += 4) a += t.data[i] ? 1 : 0; return a; };
  ok(cnt('border') > cnt('stripe_bottom'), 'border must cover more of the flag than stripe_bottom (' + cnt('border') + ' vs ' + cnt('stripe_bottom') + ')');
  const plain = BE.composite('be_banner', [1, 1, 1], []);
  const one = BE.composite('be_banner', [1, 1, 1], BE.patternLayers({ BlockEntityTag: { Patterns: [{ Pattern: 'bs', Color: 14 }] } }));
  const byName = BE.composite('be_banner', [1, 1, 1], BE.patternLayers({ BlockEntityTag: { Patterns: [{ Pattern: 'stripe_bottom', Color: 14 }] } }));
  const two = BE.composite('be_banner', [1, 1, 1], BE.patternLayers({ BlockEntityTag: { Patterns: [{ Pattern: 'bs', Color: 14 }, { Pattern: 'bo', Color: 15 }] } }));
  const rev = BE.composite('be_banner', [1, 1, 1], BE.patternLayers({ BlockEntityTag: { Patterns: [{ Pattern: 'bo', Color: 15 }, { Pattern: 'bs', Color: 14 }] } }));
  ok(BE.patternLayers(null).length === 0 && BE.patternLayers({}).length === 0, 'no tag must give no layers');
  ok(BE.patternLayers({ BlockEntityTag: { Patterns: [{ Pattern: 'zz', Color: 1 }] } }).length === 0, 'unknown pattern must be dropped');
  if (plain && one && two && rev) {
    let diff = 0, red = 0, same = 0;
    for (let i = 0; i < plain.data.length; i += 4) {
      if (plain.data[i] !== one.data[i] || plain.data[i + 1] !== one.data[i + 1]) { diff++; if (one.data[i] > one.data[i + 1] + 40) red++; }
      else same++;
    }
    ok(diff > 20 && red > 20, 'a red stripe must recolour pixels (diff ' + diff + ', red ' + red + ')');
    ok(same > diff, 'the stripe must not cover the whole sheet');
    ok(Buffer.compare(Buffer.from(one.data), Buffer.from(byName.data)) === 0, 'name and code must draw the same');
    ok(Buffer.compare(Buffer.from(two.data), Buffer.from(rev.data)) !== 0, 'layer order must matter');
    const A = BE.texData('bp_stripe_bottom'), B = BE.texData('bp_border');
    let both = 0, lastWins = 0;
    if (!A || !B) ok(false, 'pattern sheet missing');
    else for (let i = 0; i < two.data.length; i += 4) if (A.data[i + 3] === 255 && B.data[i + 3] === 255) { both++; if (two.data[i] < two.data[i + 1] + 20) lastWins++; }
    ok(both > 0 && lastWins === both, 'the later layer must cover the earlier one (' + lastWins + '/' + both + ')');
    ok(Buffer.compare(Buffer.from(two.data), Buffer.from(one.data)) !== 0, 'a second layer must change the picture');
  } else ok(false, 'composite returned nothing');
  return fails;
}

const codes = BE.PATTERN_CODES;
const clean = audit(sheets, codes);
console.log('bannerlayerscheck — #891');
if (clean.length) { clean.forEach((f) => console.log('  ✗ ' + f)); console.log(clean.length + ' failures'); process.exit(1); }
console.log(' clean data passes (' + golden.filter((g) => g[2] === '1').length + ' pattern sheets)');

let breaks = 0;
const brk = (fails, why) => { if (fails.length) { breaks++; console.log('   ✓ anti-vacuity: ' + why + ' caught'); } else { console.log('  ✗ anti-vacuity: ' + why + ' not caught'); process.exit(1); } };
{ const s = { ...sheets }; delete s.bp_stripe_bottom; brk(audit(s, codes), 'dropped sheet'); }
{ const s = { ...sheets }; s.bp_stripe_bottom = s.bp_border; brk(audit(s, codes), 'swapped sheet'); }
{ const s = { ...sheets, bp_border: { ...sheets.bp_border, canvas: { getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray(64 * 64 * 4) }) }) } } }; brk(audit(s, codes), 'blank sheet'); }
{ brk(audit(sheets, { ...codes, bs: 'stripe_top' }), 'wrong code'); }
{ const save = BE.composite; BE.composite = (b, t, l) => save(b, t, l.slice().reverse()); brk(audit(sheets, codes), 'reversed layer order'); BE.composite = save; }
console.log(' bannerlayerscheck: ' + (golden.length + 12) + ' assertions, 0 failures, ' + breaks + ' breaks caught');
