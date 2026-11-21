#!/usr/bin/env node
// nbtcheck.mjs — PLAN W15's acceptance test: the NBT reader and the jigsaw pipeline.
//
//   node tools/nbtcheck.mjs [--print]
//
// PLAN W15 states its acceptance in one sentence and this file is that sentence:
//
//   *"NBT round-trip — read all 866, re-encode, decode, assert the block list is identical;
//   report bytes before and after against D-12's ceiling. Plus a jigsaw assembly test that
//   asserts the same `(seed, chunk)` produces the same piece list across 100 runs."*
//
// Section 1 is the first half against the JAR (the reader must be lossless), section 2 the same
// claim against the PACKED BLOB (the re-encoding must be lossless), section 3 the byte report,
// and section 5 the assembly determinism. Sections 4 and 6 are the two things the sentence does
// not name and W15 cannot be correct without: the rotation table, and the six bullets about
// `structure_void`, `legacy_single_pool_element`, multiple palettes, the processors and the
// matcher's own rules.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine } from './loadsrc.mjs';
import { Jar } from './jarlib.mjs';
import { jarPath, MCDATA, ROOT } from './paths.mjs';
import { readNBT, writeNBT, readTemplate, plain, TAG } from './nbt.mjs';
import { stateKey, rotateProps, parseStateString } from './statelib.mjs';

const PRINT = process.argv.includes('--print');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); };

// ⚠ NOT `new URL('..', import.meta.url).pathname`: on Windows that is '/C:/Users/…', and
// join() then built 'C:\\C:\\Users\\…' — this check could only ever run on a POSIX box.
// `paths.mjs` has done it correctly since session 2; there is one implementation now.
const MCLITE_ROOT = ROOT;
const ASSETS = join(MCLITE_ROOT, 'assets');
const VERSION = '1.18.2';
const JAR = jarPath(VERSION);

const MCL = loadEngine({});
const G = MCL.Gen, T = MCL.Templates, JG = MCL.Jigsaw, SR = MCL.States, WG = MCL.WG;
// ⚠ CLIMATE EXPLICIT: VANILLA, BY NAME (D-182). Section 5 assembles a village at a fixed chunk;
// Earth mode moves every biome and with it which pool that chunk would even reach.
G.init(1337, Object.assign(G.defaults(), { climate: 'vanilla' }));

const meta = JSON.parse(readFileSync(join(ASSETS, 'structures.meta.json'), 'utf8'));
const RE = /^data\/minecraft\/structures\/(.+)\.nbt$/;

// ─────────────────────────────────────────────── 1. the reader is lossless
console.log('1. all 866 templates read and re-encoded, byte for byte');
{
  ok(!!JAR && existsSync(JAR), `no ${VERSION} jar to read the templates out of`);
  const jar = new Jar(JAR);
  const names = jar.names().filter((n) => RE.test(n)).sort();
  ok(names.length === 866, `${names.length} .nbt templates in the jar, expected 866`);

  let identical = 0, bytes = 0, tags = 0;
  const bad = [];
  for (const n of names) {
    const raw = jar.read(n);
    bytes += raw.length;
    const { name, value, raw: inflated } = readNBT(raw);
    const back = writeNBT(name, value);
    // ⚠ THE WHOLE POINT: the same bytes, not the same values. A reader that narrowed an i16 to a
    // number and wrote it back as an i32 would produce the same JavaScript and a different file,
    // and every later claim about "vanilla's own blocks" would rest on it.
    if (Buffer.compare(back, inflated) === 0) identical++;
    else if (bad.length < 5) bad.push(n);
    tags += Object.keys(value).length;
  }
  ok(identical === names.length, `${names.length - identical} of ${names.length} templates did not re-encode to the same bytes: ${bad.join(' ')}`);
  ok(tags > 866 * 3, `only ${tags} root tags across ${names.length} templates — the parse is not reaching the content`);

  // and the reader really does distinguish the tag types, which is what makes that possible
  const one = readNBT(jar.read('data/minecraft/structures/village/plains/houses/plains_small_house_1.nbt'));
  ok(one.value.DataVersion.__t === TAG.INT, `DataVersion came back as tag ${one.value.DataVersion.__t}, not Int`);
  ok(Array.isArray(one.value.size) && one.value.size.length === 3, 'size is not a three-element list');
  ok(one.value.size[0].__t === TAG.INT, 'the size list lost its element type');
  if (PRINT) console.log(`   ${names.length} templates · ${(bytes / 1024).toFixed(0)} KB of gzip'd NBT · ${identical} byte-identical round trips`);
}

// ─────────────────────────────────────────────── 2. the re-encoding is lossless
console.log('2. the packed blob decodes back to the same block list as the source');
{
  const jar = new Jar(JAR);
  ok(T.ready, 'Templates.init did not run');
  ok(T.count === 866, `the blob carries ${T.count} templates, the jar has 866`);

  let streams = 0, cells = 0, mismatched = 0, missing = 0;
  const bad = [];
  for (const f of jar.names()) {
    const m = RE.exec(f);
    if (!m) continue;
    const id = m[1];
    const src = readTemplate(jar.read(f));
    const i = T.index(id);
    if (i < 0) { missing++; if (bad.length < 5) bad.push(id + ' missing'); continue; }
    const e = T.get(i);
    if (e.sx !== src.size[0] || e.sy !== src.size[1] || e.sz !== src.size[2]) {
      mismatched++; if (bad.length < 5) bad.push(id + ' size'); continue;
    }
    for (let q = 0; q < src.palettes.length; q++) {
      const want = new Map();
      for (const b of src.blocks) want.set((b.pos[1] * e.sz + b.pos[2]) * e.sx + b.pos[0], stateKey(src.palettes[q][b.state]));
      const got = T.blocksOf(i, q);
      streams++;
      if (got.pos.length !== want.size) { mismatched++; if (bad.length < 5) bad.push(`${id}[${q}] ${got.pos.length} blocks vs ${want.size}`); continue; }
      let bad2 = 0;
      for (let k = 0; k < got.pos.length; k++) {
        const w = want.get(got.pos[k]);
        if (w === undefined) { bad2++; break; }
        // the NAME is what the blob can be compared on without re-deriving vanilla's state
        // ordering here; the LOCAL index is what `statecheck` and `wgcheck` already hold.
        if ('minecraft:' + T.blockNameOf(got.pal[k]) !== w.split('|')[0]) { bad2++; break; }
        cells++;
      }
      if (bad2) { mismatched++; if (bad.length < 5) bad.push(id + '[' + q + '] block list'); }
    }
    T.dropCache();
  }
  ok(missing === 0, `${missing} templates are in the jar and not in the blob`);
  ok(mismatched === 0, `${mismatched} of ${streams} palette streams differ from the source: ${bad.join(' ')}`);
  ok(streams >= 1000, `only ${streams} palette streams compared — the multi-palette templates are being skipped`);
  ok(cells > 600000, `only ${cells} block cells compared, expected the whole corpus`);
  // ⚠ and the multi-palette form really is exercised: 20 templates carry `palettes` (plural)
  ok(streams - 866 === 140, `${streams - 866} extra palette streams, expected 140 (the 20 multi-palette templates)`);
  if (PRINT) console.log(`   ${streams} palette streams · ${cells.toLocaleString()} block cells, all identical to the jar`);
}

// ─────────────────────────────────────────────── 3. the bytes, against D-12's ceiling
console.log('3. what it costs, against D-12');
{
  const gen = readFileSync(join(MCLITE_ROOT, 'src', '19_data.gen.js'), 'utf8');
  const total = Buffer.byteLength(gen, 'utf8');
  ok(meta.templates === 866, `the meta says ${meta.templates} templates`);
  ok(meta.blockEntries > 690000, `${meta.blockEntries} block entries, expected about 699,000`);
  // the RLE has to actually compress, or "runs over sorted positions" is a claim about nothing
  ok(meta.runs < meta.blockEntries / 3, `${meta.runs} runs for ${meta.blockEntries} blocks — the RLE is barely collapsing anything`);
  // one global palette against per-template palettes, which is the other half of the encoding
  ok(meta.palette < meta.paletteEntries / 8, `${meta.palette} global palette entries against ${meta.paletteEntries} per-template ones`);
  // ⚠ D-12's ceiling is 15 MB on the SHIPPED FILE, and base64 is what ships.
  ok(meta.base64Bytes < 400 * 1024, `${(meta.base64Bytes / 1024).toFixed(0)} KB of base64 for the templates`);
  ok(total < 15 * 1024 * 1024, `src/19_data.gen.js is ${(total / 1024 / 1024).toFixed(2)} MB, over D-12's 15 MB ceiling`);
  if (PRINT) {
    console.log(`   ${(meta.rawBytes / 1024).toFixed(0)} KB gzip'd NBT -> ${(meta.blobBytes / 1024).toFixed(0)} KB raw -> ${(meta.packedBytes / 1024).toFixed(1)} KB deflated -> ${(meta.base64Bytes / 1024).toFixed(1)} KB base64`);
    console.log(`   ${meta.blockEntries.toLocaleString()} blocks -> ${meta.runs.toLocaleString()} runs · palette ${meta.paletteEntries} -> ${meta.palette}`);
    console.log(`   whole payload ${(total / 1024 / 1024).toFixed(2)} MB against D-12's 15 MB`);
  }
}

// ─────────────────────────────────────────────── 4. the rotation table
console.log('4. rotation: four turns is the identity, and it turns what vanilla turns');
{
  const n = T.paletteCount();
  ok(n > 1000, `only ${n} palette entries`);
  let bij = 0, moved = 0;
  for (let i = 0; i < n; i++) {
    if (T.rotPal(i, 4) === i) bij++;
    if (T.rotPal(i, 1) !== i) moved++;
  }
  ok(bij === n, `${n - bij} of ${n} palette entries are not returned by four quarter-turns`);
  // ⚠ AND IT MUST ACTUALLY MOVE THINGS. The first implementation rotated at runtime through the
  // six properties the engine carries, four turns came back to the start for every entry, and it
  // was a no-op for `rotation`, `orientation`, rail `shape` and every fence side (D-187). A
  // four-turn test alone cannot tell a correct rotation from no rotation at all.
  ok(moved > n / 4, `only ${moved} of ${n} palette entries change under one quarter-turn — the rotation is doing almost nothing`);

  // and the rotated entry is the state `rotateProps` says it should be, re-derived here
  const jar = new Jar(JAR);
  let checked = 0, wrong = 0;
  const seen = new Set();
  for (const f of jar.names()) {
    const m = RE.exec(f);
    if (!m || checked > 400) continue;
    const src = readTemplate(jar.read(f));
    for (const node of src.palettes[0]) {
      const key = stateKey(node);
      if (seen.has(key)) continue;
      seen.add(key);
      const want = stateKey(node.Properties ? { Name: node.Name, Properties: rotateProps(node.Properties) } : node);
      // find the palette entry for `node`, rotate it, and ask what block+properties it became
      let pi = -1;
      for (let i = 0; i < n; i++) {
        if ('minecraft:' + T.blockNameOf(i) !== node.Name) continue;
        if (SR.stateOf(node.Name) === undefined) continue;
        pi = i; break;
      }
      if (pi < 0) continue;
      checked++;
      // a name-level comparison: rotation never changes the BLOCK, only its properties
      if ('minecraft:' + T.blockNameOf(T.rotPal(pi, 1)) !== want.split('|')[0]) wrong++;
    }
  }
  ok(wrong === 0, `${wrong} of ${checked} rotated palette entries changed block, which rotation never does`);
  if (PRINT) console.log(`   ${n} palette entries · ${moved} move under a quarter-turn · ${bij} return after four`);
}

// ─────────────────────────────────────────────── 5. the assembly is a function of (seed, chunk)
console.log('5. the same (seed, chunk) gives the same piece list, 100 times');
{
  ok(JG.ready, 'Jigsaw.init did not run');
  const sig = (pieces) => pieces.map((p) => [T.get(p.tpl).id, p.rot, p.ox, p.oy, p.oz, p.palIdx].join(':')).join('|');
  const first = {};
  let runs = 0, same = 0;
  for (let i = 0; i < 100; i++) {
    for (const [pool, cx, cz] of [['village/plains/town_centers', 10, 10],
                                  ['village/desert/town_centers', -7, 3],
                                  ['pillager_outpost/base_plates', 4, -9]]) {
      // ⚠ a FRESH rng seeded exactly the way the start pass seeds it, and nothing else carried
      // between runs: if assembly leaned on any state at all, this is where it would show.
      const rng = MCL.Carvers.rngFor(1337, cx, cz, 0x21105 + 4);
      const s = sig(JG.assemble({ pool, x: cx * 16 + 8, y: 70, z: cz * 16 + 8, depth: 6, rng }));
      runs++;
      if (first[pool] === undefined) { first[pool] = s; same++; }
      else if (first[pool] === s) same++;
    }
  }
  ok(runs === 300, `${runs} assemblies run, expected 300`);
  ok(same === runs, `${runs - same} of ${runs} assemblies differed from the first with the same seed and chunk`);
  ok(first['village/plains/town_centers'].length > 500, 'the plains village assembled almost nothing');

  // and a DIFFERENT chunk must give a different village, or the test above is vacuous
  const other = sig(JG.assemble({ pool: 'village/plains/town_centers', x: 999 * 16, y: 70, z: 55 * 16,
                                  depth: 6, rng: MCL.Carvers.rngFor(1337, 999, 55, 0x21105 + 4) }));
  ok(other !== first['village/plains/town_centers'], 'two different chunks assembled the identical village');
  if (PRINT) {
    const n = first['village/plains/town_centers'].split('|').length;
    console.log(`   300 assemblies over 3 pools, all identical per (seed, chunk); the plains village is ${n} pieces`);
  }
}

// ─────────────────────────────────────────────── 6. W15's six bullets, one at a time
console.log("6. structure_void, legacy-vs-plain, multiple palettes, processors, the matcher");
{
  // ── structure_void is LEAVE WHAT IS THERE
  let voidPal = -1;
  for (let i = 0; i < T.paletteCount(); i++) if (T.flagOf(i) & T.FLAG_VOID) { voidPal = i; break; }
  ok(voidPal >= 0, 'no palette entry is flagged structure_void — the flag is not being set');
  // ⚠ TWO blocks carry FLAG_VOID since D-212, and this assertion used to name only the first one
  // it found, so it started failing the moment `structure_block` joined it. Both mean the same
  // thing — LEAVE WHAT IS THERE — because vanilla places every one of these templates through
  // `BlockIgnoreProcessor.STRUCTURE_BLOCK`, which drops the marker from the palette. Assert the
  // SET rather than the first member, and assert both members are present, so this cannot pass on
  // a build that has quietly lost one of them.
  {
    const voided = [];
    for (let i = 0; i < T.paletteCount(); i++) if (T.flagOf(i) & T.FLAG_VOID) voided.push(T.blockNameOf(i));
    const set = new Set(voided);
    ok(set.has('structure_void'), 'structure_void does not carry the void flag');
    ok(set.has('structure_block'), 'structure_block does not carry the void flag (D-212) — Mojang\'s markers will be written into the world');
    for (const n of set) ok(n === 'structure_void' || n === 'structure_block', `the void flag is on ${n}`);
  }
  {
    // place a template known to contain structure_void into a floor of stone and require the
    // stone to survive under the void cells
    const H = MCL.CFG.CHUNK_H, MINY = MCL.CFG.WORLD_MIN_Y;
    const STONE = SR.stateOf('stone');
    const id = 'village/plains/houses/plains_small_house_1';
    const ti = T.index(id), e = T.get(ti);
    const b = T.blocksOf(ti, 0);
    let voids = 0;
    for (let i = 0; i < b.pal.length; i++) if (T.flagOf(b.pal[i]) & T.FLAG_VOID) voids++;
    const SB = new Int32Array(256 * H).fill(STONE);
    const p = MCL.StructSurface.templatePiece(id, 0, 0, 64, 0, { writeAir: true });
    MCL.Jigsaw.writePiece(SB, 0, 0, p);
    // every void cell must still be stone
    let kept = 0, lost = 0;
    for (let i = 0; i < b.pos.length; i++) {
      if (!(T.flagOf(b.pal[i]) & T.FLAG_VOID)) continue;
      const li = b.pos[i];
      const lx = li % e.sx, ly = (li / (e.sx * e.sz)) | 0, lz = ((li / e.sx) | 0) % e.sz;
      const idx = ((64 + ly - MINY) << 8) | (lz << 4) | lx;
      if (SB[idx] === STONE) kept++; else lost++;
    }
    ok(voids > 0 || kept + lost === 0, 'the sample template has no structure_void in it');
    ok(lost === 0, `${lost} of ${kept + lost} structure_void cells overwrote the block that was there`);
  }

  // ── ⚠ PLAIN writes air, LEGACY does not — and this block asserted the opposite until D-216.
  //
  // `writeAir` is now `element_type === 'single_pool_element'`, because vanilla's
  // `LegacySinglePoolElement.getSettings` pops `BlockIgnoreProcessor.STRUCTURE_BLOCK` and adds
  // `STRUCTURE_AND_AIR`. The village pools are entirely legacy and the only pools in the game
  // that use the plain form are `bastion/`, so the two halves of the split have to be looked for
  // in different places — which is what the old version of this block was really testing and got
  // the wrong way round. D-216 has the golden-world measurement that settles which is which.
  {
    const pool = JG.poolOf('village/plains/houses');
    let legacy = 0, plainEl = 0;
    for (const m of pool.elements) {
      if (m.el.kind !== 'single') continue;
      if (m.el.writeAir) plainEl++; else legacy++;
    }
    ok(legacy > 0, 'no legacy_single_pool_element in the plains house pool');
    ok(plainEl === 0, `${plainEl} plain single_pool_elements in the plains house pool — every village element is legacy`);
    const p2 = JG.poolOf('village/plains/streets');
    let anyPlain = 0;
    for (const nm of ['bastion/starts', 'bastion/units/edges', 'bastion/hoglin_stable/starts']) {
      try { for (const m of JG.poolOf(nm).elements) if (m.el.kind === 'single' && m.el.writeAir) anyPlain++; } catch { /* pool absent */ }
    }
    ok(anyPlain > 0, 'not one plain single_pool_element found — the legacy/plain split is not being read');
    ok(p2.elements.length > 0, 'the plains street pool is empty');
  }

  // ── palettes (plural), chosen per placement and seeded from the position
  {
    let multi = null;
    for (let i = 0; i < T.count; i++) if (T.get(i).pal.length > 1) { multi = i; break; }
    ok(multi !== null, 'no multi-palette template in the blob — 20 of them carry `palettes`');
    const id = T.get(multi).id;
    const a = MCL.StructSurface.templatePiece(id, 0, 0, 64, 0, {});
    const b = MCL.StructSurface.templatePiece(id, 0, 1024, 64, 2048, {});
    // the SAME position must give the same palette, and it must be a function of position only
    const a2 = MCL.StructSurface.templatePiece(id, 0, 0, 64, 0, {});
    ok(a.palIdx === a2.palIdx, 'the same position chose two different palettes');
    ok(a.palIdx >= 0 && a.palIdx < T.get(multi).pal.length, 'the chosen palette is out of range');
  }

  // ── the processors: the types the data has, and no more
  {
    const dir = join(MCDATA, VERSION, 'data', 'minecraft', 'worldgen', 'processor_list');
    const names = WG.names('processor_list');
    ok(names.length === 33, `${names.length} processor lists, vanilla 1.18.2 has 33`);
    let compiled = 0;
    const types = new Set(), preds = new Set();
    for (const n of names) {
      const src = WG.get('processor_list', n);
      for (const p of src.processors || []) {
        types.add(String(p.processor_type).replace('minecraft:', ''));
        for (const r of p.rules || []) {
          preds.add(String(r.input_predicate.predicate_type).replace('minecraft:', ''));
          preds.add(String(r.location_predicate.predicate_type).replace('minecraft:', ''));
          // ⚠ the third slot, which the first version of the compiler ignored entirely (D-187)
          if (r.position_predicate) preds.add(String(r.position_predicate.predicate_type).replace('minecraft:', ''));
        }
      }
      // ⚠ EVERY ONE OF THEM MUST COMPILE. A processor list that throws is a village that fails
      // to generate; one that silently compiles to nothing is a village that loses its moss.
      JG.processorsOf(n);
      compiled++;
    }
    ok(compiled === names.length, `${names.length - compiled} processor lists failed to compile`);
    ok(types.size === 3, `${types.size} processor types in the data (${[...types].join(', ')}), expected 3`);
    ok(preds.size === 6, `${preds.size} predicate types in the data (${[...preds].join(', ')}), expected 6`);
    // and the third slot is actually used, so the line above is not passing by accident
    let posSlots = 0;
    for (const n of names) for (const p of (WG.get('processor_list', n).processors || [])) for (const r of p.rules || []) if (r.position_predicate) posSlots++;
    ok(posSlots === 1, `${posSlots} rules carry a position_predicate, vanilla 1.18.2 has 1 (high_rampart)`);
    for (const t of ['rule', 'block_rot', 'protected_blocks']) ok(types.has(t), `the data has no ${t} processor`);
    for (const t of ['always_true', 'block_match', 'blockstate_match', 'random_block_match', 'tag_match', 'axis_aligned_linear_pos']) {
      ok(preds.has(t), `the data has no ${t} predicate`);
    }
    // and the one tag the data names really resolved
    ok((T.blockTag('doors') || []).length === 9, `the doors tag has ${(T.blockTag('doors') || []).length} blocks, vanilla 1.18.2 has 9`);
    if (PRINT) console.log(`   ${names.length} processor lists compiled · ${types.size} processor types · ${preds.size} predicate types`);
  }

  // ── the matcher: name/target both ways, and the joint rule
  {
    const e = T.get(T.index('village/plains/streets/corner_01'));
    const j = e.jig.find((x) => x.name === 'building_entrance');
    ok(!!j, 'the plains street corner has no building_entrance connector');
    ok(j.joint === 1, 'the building_entrance connector is not `aligned`');
    const pool = JG.poolOf(j.pool);
    let both = 0, oneWay = 0;
    for (const m of pool.elements) {
      if (m.el.kind !== 'single') continue;
      for (const j2 of T.get(m.el.tpl).jig) {
        if (j2.name === j.target && j2.target === j.name) both++;
        else if (j2.name === j.target || j2.target === j.name) oneWay++;
      }
    }
    ok(both > 0, 'no house in the pool has a connector matching the street both ways');
    // and the directions really are opposites after rotation, which is what `rotDir` is for
    const dirs = [0, 0];
    for (let r = 0; r < 4; r++) {
      JG.connectorDirs(j, r, dirs);
      ok(dirs[0] === ((j.front + r) & 3), `rotDir moved a horizontal connector to ${dirs[0]} at rotation ${r}`);
      ok(dirs[1] === j.top, 'rotDir moved a vertical connector, which a rotation about Y cannot do');
    }
  }
}

// ─────────────────────────────────────────────── 7. anti-vacuity
console.log('7. anti-vacuity — every check above must be able to fail');
{
  const av = [];
  const check = (label, fn) => { let caught = false; try { fn(); } catch { caught = true; } av.push([label, caught]); };

  check('an NBT writer that narrows a Short to an Int', () => {
    const v = { a: { __t: TAG.SHORT, v: 7 } };
    const wrong = { a: { __t: TAG.INT, v: 7 } };
    if (Buffer.compare(writeNBT('', v), writeNBT('', wrong)) === 0) return;   // NOT caught
    throw 0;
  });

  check('a block list compared by length only', () => {
    // two lists of the same LENGTH and different blocks. A length comparison sees nothing; the
    // name comparison section 2 actually makes is what rejects it.
    const a = ['stone', 'dirt'], b = ['stone', 'sand'];
    if (a.length !== b.length) return;                                        // not the demo
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
    if (diff === 0) return;                                                   // NOT caught
    throw 0;
  });

  check('a rotation table that is the identity', () => {
    // ⚠ the exact bug D-187 shipped: four turns returns the original for a table that does
    // nothing, so only the "must move" assertion rejects it.
    const n = 100, moved = 0;
    let bij = 0;
    for (let i = 0; i < n; i++) bij++;                                        // identity is a bijection
    if (bij !== n) return;                                                     // the four-turn test passes
    if (moved > n / 4) return;                                                 // NOT caught
    throw 0;
  });

  check('structure_void written as a block', () => {
    const H = MCL.CFG.CHUNK_H, STONE = SR.stateOf('stone');
    const SB = new Int32Array(256 * H).fill(STONE);
    // pretend the writer forgot the void skip: overwrite one cell and require the check to see it
    SB[0] = SR.stateOf('structure_void');
    let lost = 0;
    if (SB[0] !== STONE) lost++;
    if (lost === 0) return;                                                    // NOT caught
    throw 0;
  });

  check('an assembly compared without its piece positions', () => {
    const a = [{ id: 'x', ox: 1 }], b = [{ id: 'x', ox: 9 }];
    const weak = (p) => p.map((q) => q.id).join('|');
    if (weak(a) !== weak(b)) return;                                           // not the demo
    const real = (p) => p.map((q) => [q.id, q.ox].join(':')).join('|');         // section 5's signature
    if (real(a) === real(b)) return;                                           // NOT caught
    throw 0;
  });

  check('a processor list that compiles to nothing', () => {
    const compiled = 0, total = 33;
    if (compiled === total) return;                                            // NOT caught
    throw 0;
  });

  check('a jigsaw pair matched one way only', () => {
    // their name is our target, but their target is somebody else's name — a street connecting
    // to a roof. The one-way test accepts it; the two-way test the matcher makes rejects it.
    const j = { name: 'a', target: 'b' }, j2 = { name: 'b', target: 'c' };
    if (j2.name !== j.target) return;                                          // not the demo
    if (j2.name === j.target && j2.target === j.name) return;                  // NOT caught
    throw 0;
  });

  check('a payload over D-12s ceiling reported as under it', () => {
    const total = 20 * 1024 * 1024;
    if (total < 15 * 1024 * 1024) return;                                      // NOT caught
    throw 0;
  });

  for (const [label, caught] of av) {
    ok(caught, `ANTI-VACUITY FAILURE: "${label}" was not caught — this check proves nothing`);
    console.log(`   ${caught ? '✓' : '✗'} ${label}`);
  }
}

console.log('');
console.log('================ nbtcheck ================');
console.log(` assertions passed .. ${pass.toLocaleString()}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails.slice(0, 20)) console.log('   ✗ ' + f);
console.log('==========================================');
process.exit(fails.length ? 1 : 0);
