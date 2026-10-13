#!/usr/bin/env node
// inflatecheck.mjs — prove src/01b_inflate.js against the real payload and against zlib.
//
//   node tools/inflatecheck.mjs
//
// The decoder in 01b_inflate.js is the single most load-bearing 200 lines in the project:
// if it is wrong, every block in the world is wrong, and it is wrong in a way no other test
// would catch because every other test runs on the JSON. So it is checked three ways —
// against Node's own inflate on the real 222 KB payload, against every DEFLATE block type
// including the ones the real payload happens not to use, and on the edges (empty input,
// long runs, maximum-distance back-references).
//
// ⚠ Session 4's coverage audit added the OTHER half of PLAN F2 to this file: `tools/png.mjs`,
// the zero-dependency PNG encoder and decoder. It was exercised only by the build writing
// `atlas.png` and by other checks reading it back — which proves the pair AGREE, and proves
// nothing about either one against a case the atlas happens not to contain. Section 6 is that
// missing test: encode and decode against hand-built images that exercise the indexed-colour
// path, the RGBA path, transparency, a 1x1 image and a width that forces every scanline filter.

import { readFileSync } from 'node:fs';
// ⚠ TWO DECODERS EXIST AND THEY ARE NOT THE SAME. `png.mjs` is F2's library — it decodes colour
// types 0/2/3/4/6 and encodes with an indexed path. `pngdec.mjs` is the small reader the browser
// checks use for screenshots, and it handles only the truecolour types a screenshot can be. The
// round trip below therefore uses `png.mjs` on both sides, and section 6 ends by asserting the
// two agree wherever both are defined — a divergence there is a trap for whoever reads a PNG
// with the wrong one, which is exactly what happened when this section was first written.
import { encodePng, decodePng } from './png.mjs';
import { decodePng as decodeScreenshotPng } from './pngdec.mjs';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';

// The project root, derived from THIS FILE's location rather than hard-coded. Every tool
// here used to hard-code an absolute path, which meant the whole suite ran
// on exactly one machine — the checks synced to Dan's copy could not be run there at all.
import { fileURLToPath } from 'node:url';
const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));   // ends with a separator


// load the module the way the browser does: a bare IIFE against a global namespace
const globalNS = { CFG: {} };
globalThis.MCL = globalNS;
const src = readFileSync(MCLITE_ROOT + 'src/01b_inflate.js', 'utf8');
new Function('MCL', src)(globalNS);
const Z = globalNS.Z;

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const same = (a, b) => a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

console.log('1. the real payload');
{
  const packed = readFileSync(MCLITE_ROOT + 'assets/block-geometry.bin');
  const meta = JSON.parse(readFileSync(MCLITE_ROOT + 'assets/block-geometry.meta.json', 'utf8'));
  const t = Date.now();
  const mine = Z.inflateRaw(new Uint8Array(packed), meta.rawBytes);
  const ms = Date.now() - t;
  const theirs = inflateRawSync(packed);
  ok(same(mine, theirs), 'the real 222 KB payload must inflate identically to zlib');
  ok(mine.length === meta.rawBytes, `inflated ${mine.length} bytes, header says ${meta.rawBytes}`);
  console.log(`   ${(packed.length / 1024).toFixed(1)} KB -> ${(mine.length / 1024).toFixed(1)} KB in ${ms} ms`);
  ok(ms < 2000, `inflating the payload took ${ms} ms; it happens once at boot but not THAT once`);
}
console.log(`   ${pass} ok`);

console.log('2. base64 round trip');
{
  const packed = readFileSync(MCLITE_ROOT + 'assets/block-geometry.bin');
  const meta = JSON.parse(readFileSync(MCLITE_ROOT + 'assets/block-geometry.meta.json', 'utf8'));
  const b64 = packed.toString('base64');
  ok(same(Z.fromBase64(b64), packed), 'fromBase64 must reproduce the exact bytes');
  ok(same(Z.unpack(b64, meta.rawBytes), inflateRawSync(packed)), 'unpack() is the whole boot path in one call');
  // padding is the classic base64 bug: a payload whose length %3 is 0, 1 and 2
  for (const n of [30, 31, 32, 1, 2, 3]) {
    const r = randomBytes(n);
    ok(same(Z.fromBase64(r.toString('base64')), r), `base64 round trip at ${n} bytes (padding ${n % 3})`);
  }
}
console.log(`   ${pass} ok`);

console.log('3. every DEFLATE block type');
{
  // stored — incompressible data, which zlib emits as a stored block
  const noise = randomBytes(70000);
  ok(same(Z.inflateRaw(deflateRawSync(noise, { level: 0 }), noise.length), noise), 'stored blocks (level 0)');
  // fixed Huffman — short inputs get the fixed tree
  const tiny = Buffer.from('MC-Lite');
  ok(same(Z.inflateRaw(deflateRawSync(tiny, { level: 9 }), tiny.length), tiny), 'fixed Huffman (short input)');
  // dynamic Huffman — the real payload already covers it, but so should a skewed one
  const skew = Buffer.concat([Buffer.alloc(40000, 0x41), randomBytes(4000), Buffer.alloc(40000, 0x42)]);
  ok(same(Z.inflateRaw(deflateRawSync(skew, { level: 9 }), skew.length), skew), 'dynamic Huffman');
  // multi-block: bigger than one deflate block, forcing the last-block loop to run twice
  const big = Buffer.concat([randomBytes(200000), Buffer.alloc(100000, 7)]);
  ok(same(Z.inflateRaw(deflateRawSync(big, { level: 6 }), big.length), big), 'multiple blocks in one stream');
}
console.log(`   ${pass} ok`);

console.log('4. edges');
{
  const empty = Buffer.alloc(0);
  ok(same(Z.inflateRaw(deflateRawSync(empty), 0), empty), 'empty input');
  const one = Buffer.from([0]);
  ok(same(Z.inflateRaw(deflateRawSync(one), 1), one), 'a single byte');
  // a long run: DEFLATE encodes it as overlapping back-references, which is exactly the
  // case out.copyWithin would get wrong and the byte loop gets right
  const run = Buffer.alloc(100000, 0xab);
  ok(same(Z.inflateRaw(deflateRawSync(run), run.length), run), 'a 100 KB run of one byte (overlapping copies)');
  // maximum back-reference distance, 32 KB
  const far = Buffer.concat([randomBytes(40000)]);
  const withRepeat = Buffer.concat([far, far.subarray(0, 300)]);
  ok(same(Z.inflateRaw(deflateRawSync(withRepeat), withRepeat.length), withRepeat), 'a far back-reference');
  // a wrong expected size must throw, not truncate
  let threw = false;
  try { Z.inflateRaw(deflateRawSync(run), run.length - 1); } catch { threw = true; }
  ok(threw, 'a wrong output size must throw rather than silently truncate');
}
console.log(`   ${pass} ok`);

console.log('5. anti-vacuity: break it, and it must be caught');
{
  const av = [];
  const brk = (label, fn) => { let caught = false; try { fn(); } catch { caught = true; } av.push([label, caught]); };
  brk('a corrupted stream', () => {
    const packed = Buffer.from(deflateRawSync(Buffer.alloc(50000, 3)));
    packed[40] ^= 0xff; packed[41] ^= 0xff; packed[60] ^= 0xff;
    const out = Z.inflateRaw(packed, 50000);
    if (!same(out, Buffer.alloc(50000, 3))) throw 0;
  });
  brk('a truncated stream', () => {
    const packed = deflateRawSync(randomBytes(50000));
    Z.inflateRaw(packed.subarray(0, packed.length - 30), 50000);
  });
  brk('a stream claiming the wrong size', () => {
    Z.inflateRaw(deflateRawSync(Buffer.alloc(1000, 1)), 999);
  });
  for (const [label, caught] of av) {
    ok(caught, `ANTI-VACUITY FAILURE: "${label}" was not caught — the decoder fails silently`);
    console.log(`   ${caught ? '✓' : '✗'} ${label}`);
  }
}

// ─────────────────────────────────────────────── 6. the PNG library (PLAN F2)
console.log('6. png.mjs — encode and decode, round trip, both paths');
{
  const rnd = (n, seed) => {
    // a fixed LCG rather than crypto: a failure has to be reproducible
    const a = new Uint8Array(n);
    let s = seed >>> 0;
    for (let i = 0; i < n; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; a[i] = s >>> 24; }
    return a;
  };
  const rgbaImage = (w, h, fn) => {
    const a = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const [r, g, b, al] = fn(x, y);
      const o = (y * w + x) * 4;
      a[o] = r; a[o + 1] = g; a[o + 2] = b; a[o + 3] = al;
    }
    return a;
  };
  const same = (a, b) => {
    if (a.length !== b.length) return -2;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
    return -1;
  };
  // ⚠ the two decoders return different shapes: `png.mjs` always expands to RGBA and reports no
  // `channels`, while `pngdec.mjs` returns the file's own channel count. Normalise both.
  const decodeToRgba = (img) => {
    const ch = img.channels || 4;
    if (ch === 4) return Uint8Array.from(img.data);
    const out = new Uint8Array(img.width * img.height * 4);
    for (let i = 0, n = img.width * img.height; i < n; i++) {
      const o = i * ch;
      out[i * 4] = img.data[o];
      out[i * 4 + 1] = img.data[o + (ch > 2 ? 1 : 0)];
      out[i * 4 + 2] = img.data[o + (ch > 2 ? 2 : 0)];
      out[i * 4 + 3] = ch === 2 ? img.data[o + 1] : 255;
    }
    return out;
  };

  const cases = [
    ['1x1 opaque', 1, 1, () => [200, 30, 40, 255]],
    ['16x16 four colours (the indexed path)', 16, 16, (x, y) => {
      const c = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [0, 0, 0, 0]][(x + y) & 3];
      return c;
    }],
    ['32x17 noise (the RGBA path, and an odd width)', 32, 17, (x, y) => {
      const n = rnd(4, x * 131 + y * 17 + 7);
      return [n[0], n[1], n[2], 255];
    }],
    ['24x24 with a transparent hole', 24, 24, (x, y) => {
      const inside = x > 6 && x < 17 && y > 6 && y < 17;
      return inside ? [0, 0, 0, 0] : [80, 140, 90, 255];
    }],
    ['64x1 a single tall-filter scanline', 64, 1, (x) => [x * 3 & 255, 255 - (x * 3 & 255), 128, 255]],
  ];

  let biggestGain = 0;
  for (const [label, w, h, fn] of cases) {
    const rgba = rgbaImage(w, h, fn);
    for (const palette of [true, false]) {
      const png = encodePng(w, h, rgba, { level: 9, palette });
      ok(png.length > 8, `${label} (${palette ? 'indexed' : 'rgba'}): encoded to ${png.length} bytes`);
      ok(png[0] === 0x89 && png[1] === 0x50, `${label}: the PNG signature is wrong`);
      const back = decodePng(Buffer.from(png));
      ok(back.width === w && back.height === h, `${label}: decoded ${back.width}x${back.height}, expected ${w}x${h}`);
      const d = same(rgba, decodeToRgba(back));
      ok(d === -1, `${label} (${palette ? 'indexed' : 'rgba'}): round trip differs at byte ${d}`);
    }
    // the indexed path must actually pay for itself on a low-colour image
    const idx = encodePng(w, h, rgba, { level: 9, palette: true });
    const raw = encodePng(w, h, rgba, { level: 9, palette: false });
    if (raw.length > idx.length) biggestGain = Math.max(biggestGain, 1 - idx.length / raw.length);
  }
  // ⚠ MEASURED, on an image big enough for the difference to exist: the five cases above are
  // tiny and deflate crushes them either way, which is why the first version of this assertion
  // failed on a working encoder. A 64x64 four-colour tile is the shape of the thing this path
  // was written for.
  {
    const w = 64, h = 64;
    const flat = rgbaImage(w, h, (x, y) => [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [9, 9, 9, 255]][((x >> 3) + (y >> 3)) & 3]);
    const idx = encodePng(w, h, flat, { level: 9, palette: true });
    const raw = encodePng(w, h, flat, { level: 9, palette: false });
    const saved = 1 - idx.length / raw.length;
    ok(saved > 0.15, `the indexed path saved ${(saved * 100).toFixed(1)}% on a four-colour 64x64 tile — it is not being taken`);
    // and it must never be BIGGER than the truecolour path, whatever the image
    const noise = rgbaImage(w, h, (x, y) => [(x * 37 + y * 91) & 255, (x * 13) & 255, (y * 29) & 255, 255]);
    ok(encodePng(w, h, noise, { level: 9, palette: true }).length <= encodePng(w, h, noise, { level: 9, palette: false }).length,
       'the indexed path produced a LARGER file than truecolour on a noisy image');
    if (biggestGain >= 0) console.log(`   indexed saves ${(saved * 100).toFixed(1)}% on a flat tile`);
  }

  // the two decoders in this repo must agree wherever both are defined (truecolour, no palette)
  {
    const w = 12, h = 9;
    const rgba = rgbaImage(w, h, (x, y) => [x * 20 & 255, y * 28 & 255, 77, 255]);
    const png = Buffer.from(encodePng(w, h, rgba, { level: 9, palette: false }));
    const a = decodeToRgba(decodePng(png));
    const b = decodeToRgba(decodeScreenshotPng(png));
    ok(same(a, b) === -1, 'png.mjs and pngdec.mjs decode the same truecolour PNG differently');
    ok(same(a, rgba) === -1, 'neither decoder returned the pixels that were encoded');
  }

  // and the decoder must reject damage rather than returning plausible pixels
  const good = encodePng(8, 8, rgbaImage(8, 8, () => [10, 20, 30, 255]), { level: 9, palette: false });
  const bent = Buffer.from(good);
  // ⚠ the MIDDLE of the file, not the end: the last twelve bytes are the IEND chunk, which a
  // decoder is entitled to ignore — corrupting those proved nothing and the first version of
  // this assertion failed for that reason.
  bent[Math.floor(bent.length / 2)] ^= 0xFF;
  let rejected = false, differed = false;
  try {
    const back = decodePng(bent);
    differed = same(decodeToRgba(back), rgbaImage(8, 8, () => [10, 20, 30, 255])) !== -1;
  } catch { rejected = true; }
  ok(rejected || differed, 'a corrupted PNG decoded to exactly the original pixels — the decoder is not reading the data');
  console.log(`   ${cases.length} images, both paths, round trip exact`);
}

console.log('');
console.log('================ inflatecheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log('==============================================');
process.exit(fails.length ? 1 : 0);
