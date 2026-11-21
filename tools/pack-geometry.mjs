#!/usr/bin/env node
// pack-geometry.mjs — PLAN F8's size half, and the one D-12 actually cares about.
//
//   node tools/pack-geometry.mjs [--out assets]
//
// `block-geometry.json` is correct and 4.5 MB. D-12's ceiling for the WHOLE GAME is 15 MB,
// and the game still owes it an atlas, 1,235 item models, ~1,100 structure NBTs and a sound
// subset. 4.5 MB of JSON for geometry alone is not a budget, it is most of one.
//
// This packs the same data — bit-for-bit the same quads, verified by a decode-and-compare
// at the end of this file — into a fixed-layout binary, deflates it, and reports the real
// number with base64's +33% already applied. D-7's rule: do not claim a saving that was not
// measured, so both numbers are printed and the round-trip has to pass before either is.
//
// Layout, little-endian throughout:
//   u32  partCount
//   per part:   u16 quadCount, then per quad 44 bytes:
//                 u16 flags   d(3) | cull(3, 7 = none) | shade(1) | tint(3, 0 = none)
//                 u16 tile
//                 12 x i16    corner positions, in 1/16 of a model unit
//                 8  x i16    corner uvs, in 1/16 of a texel
//   u32  blockCount
//   per block:  u8 nameLen, name, u16 stateCount
//               per state: u8 groupCount
//                 per group: u8 altCount, then altCount x (u16 partIndex, u8 weight)
//   u32  'UVRT'  (ASCII, so a truncated file is a wrong magic and not a wrong table)
//   per part:   u8  1 = this part carries a baked per-face UV rotation (D-181)
//
// ⚠ THE TRAILING SECTION IS A SECTION, not a bit stolen from the quad flags. `data1` in the
// greedy vertex format has nothing spare and neither does anything else that is per QUAD — but
// the question the mesher asks is per PART ("can the cube fast path stand in for this?"), so
// the answer belongs in a per-part table, one byte each, 4,027 bytes that deflate to almost
// nothing. It is written last and read last, so a reader that stops after the block table
// still decodes every quad correctly.
//
// Every field is sized from the measured data, not guessed: 4,027 parts and 764 tiles fit
// u16; the largest quad count in a part is small; positions run -16..32 model units, which
// is -256..512 in sixteenths and fits i16 with room to spare. The pack asserts each of
// those bounds rather than trusting them, because a silent overflow here would show up as
// one wrong block somewhere in a 900-block roster.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

// The project root, derived from THIS FILE's location rather than hard-coded. Every tool
// here used to hard-code an absolute path, which meant the whole suite ran
// on exactly one machine — the checks synced to Dan's copy could not be run there at all.
import { fileURLToPath } from 'node:url';
const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));   // ends with a separator


// ⚠ RAW deflate, not zlib-wrapped. The browser side decodes this with a hand-written
// inflate in src/01b_inflate.js (see the note there on why, and on why DecompressionStream
// is not used). A zlib wrapper would mean carrying a 2-byte header and an adler32 that
// nothing checks, and the JS decoder would have to skip them — one more thing to get wrong
// for no benefit.

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const OUT = opt('out', MCLITE_ROOT + 'assets');

const t0 = Date.now();
const src = readFileSync(join(OUT, 'block-geometry.json'), 'utf8');
const G = JSON.parse(src);
const names = Object.keys(G.states);

// ── THE SPRITE PARTS RIDE IN THE SAME ARRAY (D-342) ──────────────────────────────────────────
// ⚠⚠ APPENDED, NOT SHIPPED SEPARATELY, AND THAT IS THE WHOLE POINT. A dropped stick's model is
// a list of quads in exactly the shape a block part already is, so it goes in the same array,
// through the same bounds assertions, the same 44-byte quad layout and the same runtime
// decoder. A second payload would mean a second decoder, a second set of typed arrays and a
// second emit loop — three chances for the winding rule to drift (D-314), to save nothing.
//
// They append at the END, so a block part index is unchanged and `spritePart0` is simply the
// number of block parts. The runtime reaches item tile `t`'s model at `spritePart0 + t`; that
// one number ships through `gen-data` and nothing else changes.
//
// ⚠ ABSENT IS NOT AN ERROR: an older `assets/` with no sprite-geometry.json packs exactly as it
// did before, with `spritePart0` equal to the part count and no sprite parts after it — which
// is a file whose sprite items are invisible, so `spritecheck` asserts the count is non-zero
// rather than letting a silent zero pass for "nothing to do".
let spritePart0 = G.parts.length, spriteParts = [];
try {
  const S = JSON.parse(readFileSync(join(OUT, 'sprite-geometry.json'), 'utf8'));
  spriteParts = S.parts || [];
} catch { /* an assets/ built before D-342 */ }
if (spriteParts.length) {
  const uv = Array.isArray(G.uvrot) ? G.uvrot : new Array(G.parts.length).fill(0);
  for (const p of spriteParts) { G.parts.push(p); uv.push(p.uvRotated ? 1 : 0); }
  G.uvrot = uv;
}

// ── AND THE BLOCK-ENTITY ITEM PARTS RIDE HERE TOO (PASS 15 JOB 3, G17e) ─────────────────────
// ⚠ SAME TRICK, THIRD TIME (D-341, D-342, now this): a chest, a bed, a banner are each a named
// PART in this same array, appended after the sprite parts. `bePart0 + names[itemName]` is the
// part a dropped block-entity item draws — `ER.emitPart` needs no change to draw it, because a
// part is a part regardless of what baked it. `be-geometry.json`'s own quads already carry the
// FINAL atlas layer in `t` (`tileBase + local index`, computed by `pack-blockentity.mjs`, which
// knows how many block and item layers came before it) — nothing here remaps a tile number.
let bePart0 = G.parts.length, beParts = [], beNames = {};
try {
  const BE = JSON.parse(readFileSync(join(OUT, 'be-geometry.json'), 'utf8'));
  beParts = BE.parts || [];
  beNames = BE.names || {};
} catch { /* an assets/ built before PASS 15 JOB 3 */ }
if (beParts.length) {
  const uv = Array.isArray(G.uvrot) ? G.uvrot : new Array(G.parts.length).fill(0);
  for (const p of beParts) { G.parts.push(p); uv.push(0); }
  G.uvrot = uv;
}

// ---------------------------------------------------------------- bounds, asserted
let maxQuads = 0, maxTile = 0, minP = 0, maxP = 0, minU = 0, maxU = 0, maxAlts = 0, maxGroups = 0;
for (const p of G.parts) {
  maxQuads = Math.max(maxQuads, p.length);
  for (const q of p) {
    maxTile = Math.max(maxTile, q.t);
    for (const v of q.p) { const s = Math.round(v * 16); minP = Math.min(minP, s); maxP = Math.max(maxP, s); }
    for (const v of q.uv) { const s = Math.round(v * 16); minU = Math.min(minU, s); maxU = Math.max(maxU, s); }
  }
}
for (const n of names) for (const st of G.states[n]) {
  maxGroups = Math.max(maxGroups, st.length);
  for (const g of st) maxAlts = Math.max(maxAlts, typeof g === 'number' ? 1 : g.a.length);
}
const bounds = [
  ['parts fit u16', G.parts.length <= 0xffff, G.parts.length],
  ['quads per part fit u16', maxQuads <= 0xffff, maxQuads],
  ['tile index fits u16', maxTile <= 0xffff, maxTile],
  ['positions fit i16', minP >= -32768 && maxP <= 32767, `${minP}..${maxP}`],
  ['uvs fit i16', minU >= -32768 && maxU <= 32767, `${minU}..${maxU}`],
  ['groups per state fit u8', maxGroups <= 255, maxGroups],
  ['alternatives per group fit u8', maxAlts <= 255, maxAlts],
  ['name length fits u8', names.every((n) => Buffer.byteLength(n) <= 255), Math.max(...names.map((n) => n.length))],
  ['states per block fit u16', names.every((n) => G.states[n].length <= 0xffff), Math.max(...names.map((n) => G.states[n].length))],
];
let bad = 0;
for (const [label, ok, val] of bounds) { if (!ok) { console.log(`  ✗ ${label} (${val})`); bad++; } }
if (bad) { console.log(`${bad} field-width assumptions are wrong; refusing to pack.`); process.exit(1); }

// ---------------------------------------------------------------- pack
// D-181: one flag byte per part, from the baker. Absent from an older block-geometry.json,
// in which case every part packs as 0 and the runtime behaves exactly as it did before.
const uvrot = Array.isArray(G.uvrot) ? G.uvrot : new Array(G.parts.length).fill(0);
if (uvrot.length !== G.parts.length) {
  console.log(`✗ uvrot has ${uvrot.length} entries for ${G.parts.length} parts`); process.exit(1);
}
const size = 4 + G.parts.length * 2 + G.parts.reduce((a, p) => a + p.length * 44, 0)
  + 4 + names.reduce((a, n) => a + 1 + Buffer.byteLength(n) + 2
      + G.states[n].reduce((b, st) => b + 1 + st.reduce((c, g) => c + 1 + (typeof g === 'number' ? 3 : g.a.length * 3), 0), 0), 0)
  + 4 + G.parts.length
  + 4 + names.reduce((a, n) => a + G.states[n].length * 2, 0);                  // D-659 PTCL
// D-659: one uint16 per visual state, in the SAME block/state order as the tables above — the
// state's particle sprite (`BlockModels.getModelParticleSprite`), 0xFFFF for none. Absent from an
// older block-geometry.json (no `ptile`), every state packs as none.
const PT = G.ptile || {};
const ptileOf = (n, s) => { const v = PT[n]; const t = Array.isArray(v) ? v[s] : v; return (typeof t === 'number' && t >= 0) ? t : 0xFFFF; };
const buf = Buffer.alloc(size);
let o = 0;
buf.writeUInt32LE(G.parts.length, o); o += 4;
for (const p of G.parts) {
  buf.writeUInt16LE(p.length, o); o += 2;
  for (const q of p) {
    const flags = (q.d & 7) | (((q.cull < 0 ? 7 : q.cull) & 7) << 3) | ((q.shade ? 1 : 0) << 6)
      | (((q.tint < 0 ? 0 : q.tint + 1) & 7) << 7);
    buf.writeUInt16LE(flags, o); o += 2;
    buf.writeUInt16LE(q.t, o); o += 2;
    for (let i = 0; i < 12; i++) { buf.writeInt16LE(Math.round(q.p[i] * 16), o); o += 2; }
    for (let i = 0; i < 8; i++) { buf.writeInt16LE(Math.round(q.uv[i] * 16), o); o += 2; }
  }
}
buf.writeUInt32LE(names.length, o); o += 4;
for (const n of names) {
  const nb = Buffer.from(n, 'utf8');
  buf.writeUInt8(nb.length, o); o += 1;
  nb.copy(buf, o); o += nb.length;
  const states = G.states[n];
  buf.writeUInt16LE(states.length, o); o += 2;
  for (const st of states) {
    buf.writeUInt8(st.length, o); o += 1;
    for (const g of st) {
      if (typeof g === 'number') {
        buf.writeUInt8(1, o); o += 1;
        buf.writeUInt16LE(g, o); o += 2; buf.writeUInt8(1, o); o += 1;
      } else {
        buf.writeUInt8(g.a.length, o); o += 1;
        for (let i = 0; i < g.a.length; i++) {
          buf.writeUInt16LE(g.a[i], o); o += 2;
          buf.writeUInt8(Math.min(255, g.w[i] || 1), o); o += 1;
        }
      }
    }
  }
}
buf.write('UVRT', o, 'ascii'); o += 4;                                        // D-181
for (let i = 0; i < G.parts.length; i++) { buf.writeUInt8(uvrot[i] ? 1 : 0, o); o += 1; }
buf.write('PTCL', o, 'ascii'); o += 4;                                        // D-659
for (const n of names) for (let s = 0; s < G.states[n].length; s++) { buf.writeUInt16LE(ptileOf(n, s), o); o += 2; }
if (o !== size) { console.log(`✗ wrote ${o} bytes into a ${size}-byte buffer — the size calculation is wrong`); process.exit(1); }

const packed = deflateRawSync(buf, { level: 9 });
writeFileSync(join(OUT, 'block-geometry.bin'), packed);
// The uncompressed size is written beside it because the browser decoder allocates exactly
// once: it is the output length, not a hint, and a mismatch is a hard error rather than a
// silently truncated world.
writeFileSync(join(OUT, 'block-geometry.meta.json'), JSON.stringify({
  rawBytes: buf.length, packedBytes: packed.length, parts: G.parts.length,
  quads: G.parts.reduce((a, p) => a + p.length, 0), blocks: names.length,
  uvRotatedParts: uvrot.reduce((a, b) => a + (b ? 1 : 0), 0),            // D-181
  spritePart0: spritePart0, spriteParts: spriteParts.length,             // D-342
  bePart0: bePart0, beParts: beParts.length, beNames: beNames,           // PASS 15 JOB 3
}));

// ---------------------------------------------------------------- round-trip
// The pack is only worth anything if it decodes to the same quads. This is the reader the
// engine will use, run here against the data it just wrote.
function unpack(deflated) {
  const b = inflateRawSync(deflated);
  let p = 0;
  const nParts = b.readUInt32LE(p); p += 4;
  const parts = new Array(nParts);
  for (let i = 0; i < nParts; i++) {
    const nq = b.readUInt16LE(p); p += 2;
    const qs = new Array(nq);
    for (let j = 0; j < nq; j++) {
      const flags = b.readUInt16LE(p); p += 2;
      const t = b.readUInt16LE(p); p += 2;
      const pos = new Array(12), uv = new Array(8);
      for (let k = 0; k < 12; k++) { pos[k] = b.readInt16LE(p) / 16; p += 2; }
      for (let k = 0; k < 8; k++) { uv[k] = b.readInt16LE(p) / 16; p += 2; }
      const cull = (flags >> 3) & 7, tint = (flags >> 7) & 7;
      qs[j] = { d: flags & 7, cull: cull === 7 ? -1 : cull, t, tint: tint === 0 ? -1 : tint - 1,
                shade: (flags >> 6) & 1, p: pos, uv };
    }
    parts[i] = qs;
  }
  const nBlocks = b.readUInt32LE(p); p += 4;
  const states = {};
  for (let i = 0; i < nBlocks; i++) {
    const len = b.readUInt8(p); p += 1;
    const name = b.toString('utf8', p, p + len); p += len;
    const ns = b.readUInt16LE(p); p += 2;
    const arr = new Array(ns);
    for (let s = 0; s < ns; s++) {
      const ng = b.readUInt8(p); p += 1;
      const groups = new Array(ng);
      for (let g = 0; g < ng; g++) {
        const na = b.readUInt8(p); p += 1;
        const a = new Array(na), w = new Array(na);
        for (let k = 0; k < na; k++) { a[k] = b.readUInt16LE(p); p += 2; w[k] = b.readUInt8(p); p += 1; }
        groups[g] = na === 1 && w[0] === 1 ? a[0] : { a, w };
      }
      arr[s] = groups;
    }
    states[name] = arr;
  }
  // D-181's trailing section. Read the same way the engine reads it, so the round-trip below
  // proves the flags survived the pack and not just the quads.
  const magic = b.toString('ascii', p, p + 4); p += 4;
  const rot = new Array(nParts).fill(0);
  if (magic === 'UVRT') for (let i = 0; i < nParts; i++) rot[i] = b.readUInt8(p + i);
  p += nParts;
  const pmagic = b.toString('ascii', p, p + 4); p += 4;                     // D-659
  const ptl = [];
  if (pmagic === 'PTCL') while (p + 2 <= b.length) { ptl.push(b.readUInt16LE(p)); p += 2; }
  return { parts, states, uvrot: rot, uvrotMagic: magic, ptile: ptl, ptileMagic: pmagic };
}

const back = unpack(packed);
let diff = 0;
if (JSON.stringify(back.parts) !== JSON.stringify(G.parts)) diff++;
for (const n of names) if (JSON.stringify(back.states[n]) !== JSON.stringify(G.states[n])) diff++;
if (back.uvrotMagic !== 'UVRT') diff++;                                                // D-181
if (JSON.stringify(back.uvrot) !== JSON.stringify(uvrot.map((v) => (v ? 1 : 0)))) diff++;
if (back.ptileMagic !== 'PTCL') diff++;                                                // D-659
{ let k = 0; for (const n of names) for (let s = 0; s < G.states[n].length; s++) if (back.ptile[k++] !== ptileOf(n, s)) { diff++; break; } }

const b64 = packed.toString('base64').length;
const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log('');
console.log('================ pack-geometry ================');
for (const [label, , val] of bounds) console.log(`  ✓ ${label.padEnd(32)} ${val}`);
console.log('');
console.log(` json .............. ${kb(src.length)}`);
console.log(` binary, raw ....... ${kb(buf.length)}   (${(100 - 100 * buf.length / src.length).toFixed(1)}% off the json)`);
console.log(` binary, deflated .. ${kb(packed.length)}   (${(100 - 100 * packed.length / src.length).toFixed(1)}% off the json)`);
console.log(` base64, in the file ${kb(b64)}   <- what D-12 actually counts`);
console.log('');
console.log(` uv-rotated parts .. ${uvrot.reduce((a, b) => a + (b ? 1 : 0), 0)} of ${G.parts.length}   (D-181)`);
console.log(` round-trip ........ ${diff === 0 ? 'IDENTICAL' : diff + ' MISMATCHES'}`);
console.log(` ${Date.now() - t0} ms  ->  ${OUT}/block-geometry.bin`);
console.log('===============================================');
process.exit(diff ? 1 : 0);
