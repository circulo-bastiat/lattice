#!/usr/bin/env node
// shieldworldcheck.mjs — #8080. A banner-patterned shield is drawn in more passes than a plain one
// (BuiltinModelItemRenderer shield branch). Anti-vacuity: the pass builder is broken and must be caught.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const NS = {}; globalThis.MCL = NS;
for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '15h_bemodel.js']) new Function('MCL', readFileSync(join(ROOT, 'src', f), 'utf8'))(NS);
const BE = NS.BEModel;
const whole = inflateRawSync(readFileSync(join(ROOT, 'assets', 'gui.bin')));
const hl = whole.readUInt32LE(0), head = JSON.parse(whole.subarray(4, 4 + hl).toString('utf8'));
const sheets = {};
for (const s of head.sheets) { const data = new Uint8ClampedArray(whole.subarray(4 + hl + s.o, 4 + hl + s.o + s.len)); sheets[s.n] = { w: s.w, h: s.h, canvas: { getContext: () => ({ getImageData: () => ({ data }) }) } }; }
NS.Gui = { sheets };
BE.dye = { white: 0xF9FFFE, red: 0xB02E26, black: 0x1D1D21 };
// pull ER.shieldPasses out of the source so the whole renderer need not boot
const src = readFileSync(join(ROOT, 'src', '07j_entityrender.js'), 'utf8');
const m = src.match(/ER\.shieldPasses = function[\s\S]*?\n  \};\n/);
if (!m) { console.log('  ✗ ER.shieldPasses missing'); process.exit(1); }
const mk = (code) => { const ER = {}; new Function('ER', 'NS', code)(ER, NS); return ER.shieldPasses; };
const tag = { BlockEntityTag: { Base: 1, Patterns: [{ Pattern: 'bs', Color: 14 }, { Pattern: 'bo', Color: 15 }] } };
function audit(passes) {
  const f = [];
  const plain = passes(null), one = passes({ BlockEntityTag: { Base: 1 } }), two = passes(tag);
  if (plain.length !== 1) f.push('plain shield must be one pass, got ' + plain.length);
  if (!(two.length > plain.length)) f.push('patterned shield must have more passes than plain (' + two.length + ')');
  if (two.length !== 3) f.push('base + 2 patterns = 3 passes, got ' + two.length);
  if (plain[0].tex === two[0].tex) f.push('patterned base must be shield_base, not nopattern');
  if (one.length !== 1) f.push('Base only is one pass');
  return f;
}
console.log('shieldworldcheck — #8080');
const good = audit(mk(m[0]));
if (good.length) { good.forEach((x) => console.log('  ✗ ' + x)); process.exit(1); }
let breaks = 0;
const brk = (code, why) => { if (audit(mk(code)).length) { breaks++; console.log('   ✓ ' + why + ' caught'); } else { console.log('  ✗ ' + why + ' not caught'); process.exit(1); } };
brk(m[0].replace('i < look.layers.length', 'i < 0'), 'dropped pattern layers');
brk(m[0].replace("tex: 'be_shield'", "tex: 'x'").replace('if (!look) return', 'if (1) return'), 'always plain');
brk(m[0].replace('look.tex', "'be_shield'"), 'wrong base texture');
console.log(' shieldworldcheck: 5 assertions, 0 failures, ' + breaks + ' breaks caught');
