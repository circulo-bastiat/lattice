// tools/textsnapcheck.mjs - #11400: menu/GUI text glyph quads must land on whole device pixels (a fractional quad repeats a glyph's
// edge row = the "underline" corruption). Draws labels at GUI scale 1-4, dpr 1/1.25/1.5/2, fractional origins; anti-vacuity below.
import { readFileSync } from 'node:fs';
const SRC = readFileSync(new URL('../src/15b_gui.js', import.meta.url), 'utf8');
const mkcv = () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {}, fillRect() {}, set globalCompositeOperation(v) {}, set fillStyle(v) {} }) });
const verdict = (src) => {
  const NS = {}; globalThis.document = { createElement: mkcv };
  new Function('MCL', src)(NS);
  const G = NS.Gui; G.ready = true; G.cell = 8; G.widths = new Uint8Array(256).fill(6);
  G.sheets = { ascii: { canvas: mkcv(), w: 128, h: 128 } };
  const bad = [];
  for (const dpr of [1, 1.25, 1.5, 2]) for (const s of [1, 2, 3, 4]) {
    const calls = [];
    const c = { getTransform: () => ({ a: dpr, b: 0, c: 0, d: dpr }), drawImage: (...a) => calls.push(a) };
    for (const [x, y] of [[0, 0], [10.37, 21.61], [123.5, 77.3]]) {
      calls.length = 0; G.text(c, 'Singleplayer Options', x, y, s, 0xFFFFFF, true);
      for (const a of calls) for (const v of [a[5], a[6], a[5] + a[7], a[6] + a[8]]) {
        const dv = v * dpr; if (Math.abs(dv - Math.round(dv)) > 1e-6) { bad.push(`dpr${dpr} s${s} @${x},${y}`); break; }
      }
    }
  }
  return [...new Set(bad)];
};
const base = verdict(SRC);
if (base.length) { console.log('FAIL: off-pixel glyph quads', base.slice(0, 5)); process.exit(1); }
const BREAKS = [SRC.replace('var q = G.snap(dx, y, cell * k, cell * k, c);', 'var q = [dx, y, cell * k, cell * k];'),
  SRC.replace('x0 = Math.round(x * d)', 'x0 = Math.floor(x * d)+0.5')];
for (const b of BREAKS) if (b === SRC) { console.log('FAIL: break not found in source (no-op)'); process.exit(1); }
let caught = 0; for (const b of BREAKS) if (b !== SRC && verdict(b).length) { caught++; console.log("   ✓ break caught"); }
if (caught !== BREAKS.length) { console.log('FAIL: only', caught, 'breaks caught'); process.exit(1); }
console.log(`textsnapcheck: 96 assertions, 0 failed, ${caught} breaks caught`);
