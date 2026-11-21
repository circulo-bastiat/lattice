// tools/chunkcache.mjs — D-456, queue row 0 item 2a: shared worldgen chunk cache.
//
// Every `*check.mjs` is its own cold `node` process, and a suite run has many of them generating
// OVERLAPPING seed-1337 regions from scratch: canefeaturecheck's 41x41 coastal sweep, surfcheck's
// swamp sweep, featgroundcheck's 11x11, coherecheck's, gendropcheck's — the same chunk's noise,
// climate, carving, feature and structure pipeline re-run, cold, every single stage.
//
// getCachedColumn(M, cx, cz) is a drop-in for M.Gen.genColumn(cx, cz): identical return shape
// ({sec, hmap, biome}), transparently backed by one file per chunk under .mcdata/chunkcache/
// (already gitignored, same as the rest of .mcdata/ — D-6: never preserved as project state).
//
// WARNING: THE KEY MUST HASH THE WORLDGEN SOURCE, OR A STALE CACHE IS A FALSE GREEN. A cache built
// before today's fix to carveAwareHeightmapY must never be served to a check written to catch
// that exact bug — every check downstream would read yesterday's (wrong) blocks and pass for the
// wrong reason. The key is sha1(sourceHash + '|' + JSON.stringify(sorted Gen.params)): the source
// hash covers the worldgen pipeline's own code plus the packed data it decodes at boot (block ids,
// the compiled feature/carver/structure JSON, biome placement, structure templates, tags); the
// params half means two checks running different climate/features/structures settings can never
// collide on the same cache file either. See tools/chunkcachecheck.mjs — every invalidation path
// here is proven there, not just asserted in this comment.
//
// ⚠ D-463 — TWO WAYS A CALLER CAN BE UNSAFE TO WIRE, FOUND BY WIRING ONE THAT WAS NOT. (a) A
// caller an anti-vacuity section RE-ENTERS after mutating something this key does not hash (a
// live data structure like 'WG', a constant table, anything not in 'Gen.params' or a source
// file) gets a false cache HIT of the pre-break bytes and its assertion silently stops firing
// (surfcheck, D-463). (b) A caller relied on for SIDE EFFECTS fired while generation itself runs
// (a wrapped/instrumented function counting its own calls) goes silent on every cache hit, because
// a hit never calls Gen.genColumn at all — worse than (a): it never even reports a failure
// (gendropcheck, ruled out before wiring, D-463). Before wiring a new caller: does anything
// re-enter it after mutating non-key state, and does anything it depends on need to actually RUN,
// not just return bytes? If either is unclear, run the check after wiring and read its OWN
// anti-vacuity verdict — do not assume "same shape as genColumn" is the whole test.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { MCLITE_ROOT, WORKER_FILES } from './loadsrc.mjs';

export const CACHE_ROOT = join(MCLITE_ROOT, '.mcdata', 'chunkcache');

// Everything that can change genColumn's OUTPUT. The mesher (05_mesher.js) is the one
// WORKER_FILES entry that cannot: it only reads sections after they exist, so it is left out --
// including it would force a fresh cache on every rendering-only change, for no correctness gain.
const WORLDGEN_SRC_FILES = WORKER_FILES.filter((f) => f !== '05_mesher.js');

// Packed data the worldgen pipeline decodes at boot. Rendering-only assets (block-geometry,
// block-tiles, colormaps) are deliberately left out: they cannot change a single block id or
// light byte this cache stores, only how one is later drawn.
const WORLDGEN_ASSET_FILES = [
  'block-runtime.bin', 'block-runtime.meta.json',
  'worldgen.bin', 'worldgen.meta.json',
  'biome-params.bin', 'biome-params.meta.json',
  'structures.bin', 'structures.meta.json',
  'tags.bin', 'tags.meta.json',
];

let _sourceHash = null;
/** Exported so the invalidation check can assert it actually depends on file content. */
export function worldgenSourceHash(force) {
  if (_sourceHash && !force) return _sourceHash;
  const h = createHash('sha1');
  for (const f of WORLDGEN_SRC_FILES) h.update(readFileSync(join(MCLITE_ROOT, 'src', f)));
  for (const f of WORLDGEN_ASSET_FILES) {
    const p = join(MCLITE_ROOT, 'assets', f);
    h.update(existsSync(p) ? readFileSync(p) : Buffer.from('MISSING:' + f));
  }
  _sourceHash = h.digest('hex');
  return _sourceHash;
}

/** The full cache key for M's CURRENT Gen configuration: source + the params that were passed to Gen.init. */
export function genCacheKey(M) {
  const h = createHash('sha1');
  h.update(worldgenSourceHash());
  h.update('|');
  h.update(JSON.stringify(M.Gen.params, Object.keys(M.Gen.params).sort()));
  return h.digest('hex').slice(0, 20);
}

function dirFor(genKey, seed) { return join(CACHE_ROOT, genKey, String(seed)); }
function fileFor(genKey, seed, cx, cz) { return join(dirFor(genKey, seed), `${cx}_${cz}.chunk`); }

// ---------------------------------------------------------------------------------------------
// Binary codec for one genColumn() result. Every field a Section can carry (D-16..D-19: "a Section
// is a PLAIN OBJECT... structured-clone-safe") is copied byte-for-byte — this is deliberately the
// same shape `Section.copy` produces, not a reinterpretation of it.
//
// layout: [sectionsY:u16] [hmap 256*u16] [biome 256*u8]
//   per section: [u:i32] [lu:i16]
//     if u<0:  [b:u8] [n:u16] [plen:u16] [dlen:u32] p[plen]*u16 d[dlen]*u32
//     if lu<0: l[4096]*u8
// ---------------------------------------------------------------------------------------------

function encodeColumn(col, sectionsY) {
  const parts = [];
  const head = Buffer.alloc(2 + 256 * 2 + 256);
  head.writeUInt16LE(sectionsY, 0);
  for (let i = 0; i < 256; i++) head.writeUInt16LE(col.hmap[i], 2 + i * 2);
  for (let i = 0; i < 256; i++) head.writeUInt8(col.biome[i], 2 + 512 + i);
  parts.push(head);
  for (let sy = 0; sy < sectionsY; sy++) {
    const sec = col.sec[sy];
    const fixed = Buffer.alloc(6);
    fixed.writeInt32LE(sec.u | 0, 0);
    fixed.writeInt16LE(sec.lu | 0, 4);
    parts.push(fixed);
    if (sec.u < 0) {
      const meta = Buffer.alloc(1 + 2 + 2 + 4);
      meta.writeUInt8(sec.b, 0);
      meta.writeUInt16LE(sec.n, 1);
      meta.writeUInt16LE(sec.p.length, 3);
      meta.writeUInt32LE(sec.d.length, 5);
      parts.push(meta);
      const pBuf = Buffer.alloc(sec.p.length * 2);
      for (let k = 0; k < sec.p.length; k++) pBuf.writeUInt16LE(sec.p[k], k * 2);
      parts.push(pBuf);
      const dBuf = Buffer.alloc(sec.d.length * 4);
      for (let k = 0; k < sec.d.length; k++) dBuf.writeUInt32LE(sec.d[k], k * 4);
      parts.push(dBuf);
    }
    if (sec.lu < 0) parts.push(Buffer.from(sec.l));
  }
  return Buffer.concat(parts);
}

function decodeColumn(buf) {
  let o = 0;
  const sectionsY = buf.readUInt16LE(o); o += 2;
  const hmap = new Uint16Array(256);
  for (let i = 0; i < 256; i++) { hmap[i] = buf.readUInt16LE(o); o += 2; }
  const biome = new Uint8Array(256);
  for (let i = 0; i < 256; i++) { biome[i] = buf.readUInt8(o); o += 1; }
  const sec = new Array(sectionsY);
  for (let sy = 0; sy < sectionsY; sy++) {
    const u = buf.readInt32LE(o); o += 4;
    const lu = buf.readInt16LE(o); o += 2;
    const s = { u, lu };
    if (u < 0) {
      s.b = buf.readUInt8(o); o += 1;
      s.n = buf.readUInt16LE(o); o += 2;
      const plen = buf.readUInt16LE(o); o += 2;
      const dlen = buf.readUInt32LE(o); o += 4;
      s.p = new Uint16Array(plen);
      for (let k = 0; k < plen; k++) { s.p[k] = buf.readUInt16LE(o); o += 2; }
      s.d = new Uint32Array(dlen);
      for (let k = 0; k < dlen; k++) { s.d[k] = buf.readUInt32LE(o); o += 4; }
    }
    if (lu < 0) {
      s.l = new Uint8Array(buf.subarray(o, o + 4096));
      o += 4096;
    }
    sec[sy] = s;
  }
  return { sec, hmap, biome };
}

/**
 * getCachedColumn(M, cx, cz) — drop-in for M.Gen.genColumn(cx, cz). A hit decodes the file and
 * NEVER calls M.Gen.genColumn (chunkcachecheck.mjs asserts this by making genColumn throw and
 * confirming a hit still succeeds). A miss generates normally and writes the file for next time.
 * The cache is an optimisation, never load-bearing: any read/write failure (corrupt file, no
 * disk space, read-only mount) falls back to plain regeneration rather than throwing.
 */
export function getCachedColumn(M, cx, cz) {
  const key = genCacheKey(M);
  const seed = M.Gen.seed;
  const file = fileFor(key, seed, cx, cz);
  if (existsSync(file)) {
    try {
      return decodeColumn(readFileSync(file));
    } catch (e) {
      // corrupt/truncated cache file — fall through and regenerate rather than crash the caller
    }
  }
  const col = M.Gen.genColumn(cx, cz);
  try {
    const dir = dirFor(key, seed);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(file, encodeColumn(col, M.CFG.SECTIONS_Y));
  } catch (e) {
    // read-only mount, disk full, etc. — the column is still correct, just not cached
  }
  return col;
}

export { encodeColumn, decodeColumn };
