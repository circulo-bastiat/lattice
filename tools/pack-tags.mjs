#!/usr/bin/env node
// pack-tags.mjs — PLAN G1. Vanilla's 218 registry tag files into one runtime blob.
//
//   node tools/pack-tags.mjs [--jar ...] [--out assets]
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────
// A tag is how 1.18.2 expresses every SET the game reasons about: which blocks a pickaxe
// mines, which need an iron tool before they drop, which are logs for the axe and for leaf
// decay, which are fences that connect to each other, which items are planks for a recipe.
// PLAN G1's whole argument is that building this ONCE stops G2, G3, G9 and G13 from each
// inventing their own hard-coded list — and a hard-coded list is exactly the thing that is
// wrong six months later and that no test can tell from a right one.
//
// So nothing here is typed. The 218 files under `data/minecraft/tags/{blocks,items,fluids,
// entity_types,game_events}/` are read out of Dan's own 1.18.2 jar, flattened, and shipped.
//
// ── WHAT IS FLATTENED, AND WHY THAT IS SAFE ──────────────────────────────────────────────
// A tag file's `values` may contain `#minecraft:other_tag`, and vanilla resolves that
// recursively at datapack load. `minecraft:logs` is four nested tags deep and would otherwise
// need a graph walk in the engine's inner loops. Flattening here is exact — the same set,
// computed once at build time instead of every call — and it means NO runtime code ever sees
// a `#`. The cost is duplication in the blob, which deflate removes.
//
// ⚠ CYCLES ARE REJECTED, NOT SURVIVED (PLAN G1's acceptance is *"every tag resolves; cycles
// are detected and rejected"*). Vanilla's own loader throws on a cycle; a resolver that
// silently returns the partial set would hand the engine a `#minecraft:logs` missing half its
// members and nothing downstream could tell. `taglib.mjs`'s resolver carries an explicit stack
// and throws with the whole path; the self-test below proves it still does.
//
// ── WHAT IS **NOT** HERE, DELIBERATELY ───────────────────────────────────────────────────
//   * the 52 `tags/worldgen/**` files. 42 of them are the biome tags W13 needs, and they were
//     already packed into `worldgen.bin` by `pack-worldgen.mjs` (D-183) because a structure's
//     `biomes` field is a tag reference and W13 could not place a structure without them.
//     Moving them here would be a second copy of the same bytes. `tagcheck` §1 asserts that
//     this file plus that one account for all 270 tag files in the jar, so the split cannot
//     quietly lose one (D-200).
//   * the READER and the FLATTENER themselves, since D-197: they are `tools/taglib.mjs`, so
//     `pack-worldgen.mjs` can flatten the same block tags for the placement sets that ride
//     `worldgen.bin` without owning a second copy of the rule.
//   * anything that RESOLVES a tag against the registry. That is `src/02f_tags.js`'s job, and
//     keeping the packer registry-blind means a registry regeneration cannot invalidate this
//     blob: it is names, all the way down.
//
// ── THE FORMAT ───────────────────────────────────────────────────────────────────────────
//   'MCLG'                                       magic
//   u16 stringCount, then u8 len + ASCII bytes   every distinct tag name and member name
//   u8  registryCount
//   per registry:  u16 nameIdx · u16 tagCount
//     per tag:     u16 nameIdx · u16 memberCount · memberCount x u16 stringIdx
// then deflate-raw, exactly like worldgen.bin, and base64 into 19_data.gen.js.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { Jar } from './jarlib.mjs';
import { requireJar } from './paths.mjs';
import { readRawTags, makeTagResolver } from './taglib.mjs';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const VERSION = opt('version', '1.18.2');
const OUT = opt('out', join(MCLITE_ROOT, 'assets'));
const JAR = opt('jar', requireJar(VERSION));
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const jar = new Jar(JAR);

// The five REGISTRY tag directories. `worldgen` is deliberately absent — see the header.
const REGISTRIES = ['blocks', 'items', 'fluids', 'entity_types', 'game_events'];

// ── read every tag file, unresolved ────────────────────────────────────
// ⚠ THE READER AND THE FLATTENER MOVED TO `tools/taglib.mjs` (D-197). They are the same code,
// in one place, because `pack-worldgen.mjs` needs the flattened BLOCK tags for the placement
// sets that ride `worldgen.bin` — and a rule with two implementations is a rule with two
// answers (D-164, D-186). `tags.bin` is byte-for-byte what it was before the move.
const { raw, allFiles, worldgenFiles, rawBytes } = readRawTags(jar, REGISTRIES);
// `tags/worldgen/biome/x.json` has a three-segment directory, so the regex there sees
// `worldgen` as the registry and `biome/x` as the name. Counted, then skipped.
if (raw.size === 0) { console.error('pack-tags: no tag files in ' + JAR); process.exit(1); }

// ── flatten, with cycle detection ─────────────────────────────────────
const { resolve, resolved, stack, stats } = makeTagResolver(raw);
for (const key of raw.keys()) resolve(key);
const nestedRefs = stats.nestedRefs;

// ── the cycle detector is proved on a synthetic pair, not assumed ────────────────────────
// ⚠ A DETECTOR NOBODY EVER TRIPPED IS A DETECTOR THAT MIGHT NOT WORK. Vanilla's own tags have
// no cycle, so this build would exit 0 whether the check above worked or not. Two fake tags
// pointing at each other are resolved here, at build time, and the build fails if that does
// NOT throw — the same rule the checks live by (D-30), applied to a build stage.
{
  raw.set('blocks/__cycle_a', { values: ['#minecraft:__cycle_b'] });
  raw.set('blocks/__cycle_b', { values: ['#minecraft:__cycle_a'] });
  let threw = false;
  try { resolve('blocks/__cycle_a'); } catch { threw = true; }
  raw.delete('blocks/__cycle_a'); raw.delete('blocks/__cycle_b');
  resolved.delete('blocks/__cycle_a'); resolved.delete('blocks/__cycle_b');
  stack.length = 0;
  if (!threw) { console.error('pack-tags: the cycle detector did not fire on a cycle'); process.exit(1); }
}

// ── intern ───────────────────────────────────────────────────────────────────────────────
const strings = [];
const strIdx = new Map();
const intern = (s) => {
  if (strIdx.has(s)) return strIdx.get(s);
  if (s.length > 255) throw new Error('pack-tags: name longer than 255 bytes: ' + s);
  strIdx.set(s, strings.length); strings.push(s); return strings.length - 1;
};
const byReg = new Map();
for (const r of REGISTRIES) byReg.set(r, []);
for (const [key, members] of [...resolved.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
  const cut = key.indexOf('/');
  byReg.get(key.slice(0, cut)).push([key.slice(cut + 1), members]);
}
for (const r of REGISTRIES) {
  intern(r);
  for (const [name, members] of byReg.get(r)) { intern(name); for (const m of members) intern(m); }
}
if (strings.length > 65535) throw new Error('pack-tags: more than 65535 distinct strings');

// ── write ────────────────────────────────────────────────────────────────────────────────
let size = 4 + 2;
for (const s of strings) size += 1 + Buffer.byteLength(s);
size += 1;
let tagCount = 0, memberCount = 0;
for (const r of REGISTRIES) {
  size += 2 + 2;
  for (const [, members] of byReg.get(r)) { size += 2 + 2 + members.length * 2; tagCount++; memberCount += members.length; }
}
const buf = Buffer.alloc(size);
let o = 0;
buf.write('MCLG', o, 'ascii'); o += 4;
buf.writeUInt16LE(strings.length, o); o += 2;
for (const s of strings) {
  const b = Buffer.from(s, 'utf8');
  buf.writeUInt8(b.length, o); o += 1; b.copy(buf, o); o += b.length;
}
buf.writeUInt8(REGISTRIES.length, o); o += 1;
for (const r of REGISTRIES) {
  buf.writeUInt16LE(strIdx.get(r), o); o += 2;
  const list = byReg.get(r);
  buf.writeUInt16LE(list.length, o); o += 2;
  for (const [name, members] of list) {
    buf.writeUInt16LE(strIdx.get(name), o); o += 2;
    buf.writeUInt16LE(members.length, o); o += 2;
    for (const m of members) { buf.writeUInt16LE(strIdx.get(m), o); o += 2; }
  }
}
if (o !== size) throw new Error(`pack-tags wrote ${o} of ${size} bytes`);

const deflated = deflateRawSync(buf, { level: 9 });
if (!inflateRawSync(deflated).equals(buf)) { console.error('FATAL: tags.bin does not round-trip'); process.exit(1); }
writeFileSync(join(OUT, 'tags.bin'), deflated);

const perReg = {};
for (const r of REGISTRIES) perReg[r] = byReg.get(r).length;
writeFileSync(join(OUT, 'tags.meta.json'), JSON.stringify({
  version: VERSION, rawBytes, jsonFiles: raw.size, worldgenFiles, allFiles,
  packedBytes: deflated.length, blobBytes: size, strings: strings.length,
  tags: tagCount, members: memberCount, nestedRefs, perRegistry: perReg,
}, null, 2) + '\n');

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log('pack-tags');
console.log(` tag files ......... ${raw.size} of ${allFiles} in the jar (${worldgenFiles} worldgen, packed by pack-worldgen)`);
console.log(` registries ........ ${REGISTRIES.map((r) => r + ' ' + perReg[r]).join(' · ')}`);
console.log(` members ........... ${memberCount} after flattening ${nestedRefs} nested references`);
console.log(` packed ............ ${kb(rawBytes)} of JSON -> ${kb(size)} binary -> ${kb(deflated.length)} deflated`);
console.log(`                     ${kb(deflated.length * 4 / 3)} as base64 in the file`);
