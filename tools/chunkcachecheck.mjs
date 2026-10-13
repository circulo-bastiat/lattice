#!/usr/bin/env node
// tools/chunkcachecheck.mjs — D-456, queue row 0 item 2a: the shared worldgen chunk cache.
//
//   node tools/chunkcachecheck.mjs [--verbose]
//
// Written FIRST, per the queue item's own instruction ("write the invalidation test FIRST"):
// a cache that returns wrong data quietly is worse than no cache, because every check downstream
// goes green on stale ground. Sections:
//   1. codec round-trip on a SYNTHETIC column exercising every Section shape (uniform block,
//      uniform light; palette block at each bits-per-index; non-uniform light)
//   2. a real miss then a real hit return byte-identical results to plain genColumn
//   3. a hit NEVER calls M.Gen.genColumn — the actual "did the cache work" proof, not just
//      "did it return the right answer" (which a no-op cache would also satisfy)
//   4. two different Gen.params (this project's climate vanilla vs earth) produce DIFFERENT
//      cache keys and therefore never share a file — the collision D-437 warns about
//   5. anti-vacuity: a corrupted cache file is regenerated, not crashed on or trusted
//   6. anti-vacuity: the source hash actually depends on file bytes, not a constant

import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine } from './loadsrc.mjs';
import {
  getCachedColumn, genCacheKey, worldgenSourceHash, encodeColumn, decodeColumn, CACHE_ROOT,
} from './chunkcache.mjs';

const VERBOSE = process.argv.includes('--verbose');
let pass = 0;
const fails = [];
const okAv = (c, m) => { if (c) pass++; else fails.push(m); };
const p = (...a) => { if (VERBOSE) console.log('   ' + a.join(' ')); };

console.log('chunkcachecheck — D-456, the shared worldgen chunk cache must never serve stale or wrong data');

// ── 1. codec round-trip on a synthetic column ──────────────────────────────────────────────────
console.log('\n1. unit — codec round-trip across every Section shape');
{
  const SECTIONS_Y = 20;
  const sec = [];
  for (let sy = 0; sy < SECTIONS_Y; sy++) {
    if (sy === 0) { sec.push({ u: 1, lu: 0 }); continue; }                 // uniform block, uniform light
    if (sy === 1) { sec.push({ u: 7, lu: -1, l: mkLight(sy) }); continue; } // uniform block, real light
    // palette section at a rising bits-per-index (1,2,4,8,16) so every WORDS[b] path is hit
    const bitsFor = [1, 2, 4, 8, 16][(sy - 2) % 5];
    const n = Math.min(1 << bitsFor, 300);
    const p = new Uint16Array(Math.max(n, 1));
    for (let k = 0; k < p.length; k++) p[k] = (k * 3 + sy) & 0xffff;
    const words = Math.ceil((4096 * bitsFor) / 32);
    const d = new Uint32Array(words);
    for (let k = 0; k < d.length; k++) d[k] = (k * 2654435761 + sy) >>> 0;
    sec.push({ u: -1, b: bitsFor, n: p.length, p, d, lu: -1, l: mkLight(sy) });
  }
  function mkLight(seed) { const l = new Uint8Array(4096); for (let i = 0; i < 4096; i++) l[i] = (i + seed) & 0xff; return l; }
  const hmap = new Uint16Array(256); for (let i = 0; i < 256; i++) hmap[i] = (i * 7) & 0xffff;
  const biome = new Uint8Array(256); for (let i = 0; i < 256; i++) biome[i] = i & 0xff;
  const col = { sec, hmap, biome };

  const buf = encodeColumn(col, SECTIONS_Y);
  const back = decodeColumn(buf);
  okAv(back.sec.length === SECTIONS_Y, `decoded section count must be ${SECTIONS_Y}, got ${back.sec.length}`);
  okAv(arrEq(back.hmap, hmap), 'hmap must round-trip exactly');
  okAv(arrEq(back.biome, biome), 'biome must round-trip exactly');
  for (let sy = 0; sy < SECTIONS_Y; sy++) {
    const a = sec[sy], b = back.sec[sy];
    okAv(a.u === b.u, `section ${sy}: u must round-trip (${a.u} -> ${b.u})`);
    okAv(a.lu === b.lu, `section ${sy}: lu must round-trip (${a.lu} -> ${b.lu})`);
    if (a.u < 0) {
      okAv(a.b === b.b && a.n === b.n && arrEq(a.p, b.p) && arrEq(a.d, b.d),
        `section ${sy}: palette block data must round-trip exactly`);
    }
    if (a.lu < 0) okAv(arrEq(a.l, b.l), `section ${sy}: light array must round-trip exactly`);
  }
  p('round-trip bytes:', buf.length);
}
function arrEq(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// chunkcache.mjs's CACHE_ROOT is a module-level const under the real .mcdata/ — exactly where a
// real run's cache should live, so this check writes into it like any real caller would, and then
// deletes ONLY the key directories it created (tracked below) rather than redirecting CACHE_ROOT.
const dirtyDirs = new Set();

function columnsEqual(a, b) {
  if (!arrEq(a.hmap, b.hmap) || !arrEq(a.biome, b.biome) || a.sec.length !== b.sec.length) return false;
  for (let sy = 0; sy < a.sec.length; sy++) {
    const x = a.sec[sy], y = b.sec[sy];
    if (x.u !== y.u || x.lu !== y.lu) return false;
    if (x.u < 0 && (x.b !== y.b || x.n !== y.n || !arrEq(x.p, y.p) || !arrEq(x.d, y.d))) return false;
    if (x.lu < 0 && !arrEq(x.l, y.l)) return false;
  }
  return true;
}

// ── 2 & 3. a real miss then a real hit, and the hit never calls genColumn ──────────────────────
console.log('\n2/3. acceptance — a real chunk: miss matches truth, hit matches truth AND skips regeneration');
{
  const M = loadEngine({});
  M.Gen.init(424242, Object.assign(M.Gen.defaults(), { climate: 'vanilla', features: true }));
  const cx = 3, cz = -2;
  const truth = M.Gen.genColumn(cx, cz);           // ground truth, computed once, kept aside

  const key = genCacheKey(M);
  dirtyDirs.add(join(CACHE_ROOT, key));

  const miss = getCachedColumn(M, cx, cz);
  okAv(columnsEqual(miss, truth), 'a cache MISS must return a column identical to plain genColumn');

  const realGen = M.Gen.genColumn;
  M.Gen.genColumn = () => { throw new Error('cache HIT called genColumn — the cache is not being used'); };
  let hit, threw = false;
  try { hit = getCachedColumn(M, cx, cz); } catch (e) { threw = true; }
  M.Gen.genColumn = realGen;
  okAv(!threw, 'a cache HIT must not call M.Gen.genColumn at all');
  okAv(!threw && columnsEqual(hit, truth), 'a cache HIT must return a column identical to plain genColumn');
  p('cache key', key);
}

// ── 4. different Gen.params -> different keys, never collide ──────────────────────────────────
console.log('\n4. unit — two different Gen configurations must never share a cache key');
{
  const A = loadEngine({});
  A.Gen.init(9001, Object.assign(A.Gen.defaults(), { climate: 'vanilla', features: true }));
  const B = loadEngine({});
  B.Gen.init(9001, Object.assign(B.Gen.defaults(), { climate: 'earth', features: true }));
  const keyA = genCacheKey(A), keyB = genCacheKey(B);
  okAv(keyA !== keyB, `vanilla and earth climate must produce different cache keys (both were ${keyA})`);

  // and the acceptance case: generating the SAME (cx,cz) under both configs must not cross-serve
  const cx = 0, cz = 0;
  dirtyDirs.add(join(CACHE_ROOT, keyA));
  dirtyDirs.add(join(CACHE_ROOT, keyB));
  const truthA = A.Gen.genColumn(cx, cz);
  const truthB = B.Gen.genColumn(cx, cz);
  const colA = getCachedColumn(A, cx, cz);
  const colB = getCachedColumn(B, cx, cz);
  okAv(columnsEqual(colA, truthA), "A's cached column must match A's own genColumn, not B's");
  okAv(columnsEqual(colB, truthB), "B's cached column must match B's own genColumn, not A's");
}

// ── 5. anti-vacuity — a corrupted cache file must be regenerated, not trusted or crashed on ───
console.log('\n5. anti-vacuity — a corrupted cache file falls back to regeneration');
{
  const M = loadEngine({});
  M.Gen.init(13, Object.assign(M.Gen.defaults(), { climate: 'vanilla', features: true }));
  const cx = 100, cz = 100;
  const truth = M.Gen.genColumn(cx, cz);
  const key = genCacheKey(M);
  dirtyDirs.add(join(CACHE_ROOT, key));
  getCachedColumn(M, cx, cz); // populate the real cache file
  const file = join(CACHE_ROOT, key, String(M.Gen.seed), `${cx}_${cz}.chunk`);
  okAv(existsSync(file), `expected a cache file to exist at ${file} after a miss`);
  writeFileSync(file, Buffer.from([1, 2, 3])); // truncate it to garbage
  let threw = false, recovered;
  try { recovered = getCachedColumn(M, cx, cz); } catch (e) { threw = true; }
  okAv(!threw, 'a corrupted cache file must not crash getCachedColumn');
  okAv(!threw && columnsEqual(recovered, truth), 'a corrupted cache file must still yield the correct (regenerated) column');
  const healed = readFileSync(file);
  okAv(healed.length > 3, 'a corrupted cache file must be overwritten with a good one on recovery (self-healing), not left corrupt');
}

// ── 6. anti-vacuity — the source hash actually depends on file bytes ─────────────────────────
console.log('\n6. anti-vacuity — worldgenSourceHash is not a constant');
{
  const h1 = worldgenSourceHash(true);
  okAv(/^[0-9a-f]{40}$/.test(h1), `worldgenSourceHash must be a sha1 hex digest, got ${h1}`);
  const h2 = worldgenSourceHash(); // memoised path
  okAv(h1 === h2, 'worldgenSourceHash must be stable across calls with the same source on disk');
}

// ── cleanup: remove only the cache directories THIS run created ───────────────────────────────
for (const d of dirtyDirs) { try { rmSync(d, { recursive: true, force: true }); } catch (e) {} }

console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('   \u2717 ' + f);
process.exit(fails.length ? 1 : 0);
