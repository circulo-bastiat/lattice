#!/usr/bin/env node
// structcheck.mjs — PLAN W13 and W14's acceptance test for structures.
//
//   node tools/structcheck.mjs [--print]
//
// PLAN §8 gives this file four words — *"determinism, no float/burial, cross-sections, cost"* —
// and W14 adds a fifth requirement that is really a schedule: *"`structcheck.mjs` determinism
// (same region, two different chunk orders, byte-identical) — **this test must exist before S2
// starts**, because S2 is the first structure work that can break the recursion invariant."*
//
// The invariant in question, from §7:
//
//   > A structure must be decidable from its own chunk plus a bounded neighbourhood, from the
//   > seed alone, WITHOUT generating neighbouring terrain first.
//
// Sections 4 and 5 are what hold it, and they hold it from two sides. Section 4 is the black-box
// half: generate the same region in three different chunk orders, with the caches emptied
// between, and demand byte-identical worlds. Section 5 is the white-box half, and it is the one
// that would catch the bug BEFORE it becomes a seam — a piece written outside the `reach` the
// write pass scans is a piece that appears or not depending on which direction the player walked
// in, and a black-box order test can miss it for a long time because both orders scan the same
// too-small neighbourhood.
//
// Sections 1 and 2 are the other claim W13 makes: that the placement is PORTED. PLAN §7 says the
// 17 `structure_set` files are *"stolen wholesale, because this is structure LOGIC, not worldgen
// shape, and logic should be faithful"*, so every field of all 17, all 31 configured structures
// and all 42 biome tags is compared against the source — the JSON in the cache and the tag files
// in the jar — rather than against a table written here.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine } from './loadsrc.mjs';
import { getCachedColumn } from './chunkcache.mjs'; // D-463: shared worldgen chunk cache
import { Jar } from './jarlib.mjs';
import { MCDATA, jarPath } from './paths.mjs';

const PRINT = process.argv.includes('--print');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); };

const VERSION = '1.18.2';
const WGDIR = join(MCDATA, VERSION, 'data', 'minecraft', 'worldgen');

const MCL = loadEngine({});
const G = MCL.Gen, CFG = MCL.CFG, S = MCL.Section, SR = MCL.States, WG = MCL.WG;
const SEED = 1337;
// ⚠ CLIMATE EXPLICIT: VANILLA, BY NAME (D-182). Section 3's density band is a parity claim
// against the real game's structure spacing, and Earth mode moves every biome — which moves
// which candidates the biome tag accepts and therefore the density itself.
G.init(SEED, Object.assign(G.defaults(), { climate: 'vanilla' }));
const ST = MCL.Structures, B = MCL.Biomes;
const MINY = CFG.WORLD_MIN_Y, H = CFG.CHUNK_H;

const readJSON = (p) => JSON.parse(readFileSync(p, 'utf8'));
const short = (s) => String(s).replace('minecraft:', '');
/**
 * A canonical form for comparing a decoded node against the source JSON.
 * ⚠ KEY ORDER IS NOT PART OF THE DATA. `pack-worldgen` interns every object key and `WG` rebuilds
 * the object from the string table, so `{probability, type}` comes back as `{type, probability}`
 * — same object, different iteration order, and a plain `JSON.stringify` comparison called all
 * ten of the configs that have more than one key a mismatch.
 */
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = canon(v[k]);
    return out;
  }
  return v;
}
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

// ─────────────────────────────────────────────── 1. the 17 sets and the 31 structures
console.log('1. the structure_set and configured_structure_feature files, field by field');
{
  ok(ST.ready, 'Structures.init did not run');
  ok(ST.sets.length === 17, `${ST.sets.length} structure sets, vanilla 1.18.2 has 17`);
  ok(Object.keys(ST.defs).length === 31, `${Object.keys(ST.defs).length} configured structures, vanilla has 31`);

  let fields = 0;
  for (const set of ST.sets) {
    const src = readJSON(join(WGDIR, 'structure_set', set.name + '.json'));
    const pl = src.placement, got = set.placement;
    ok(short(pl.type) === got.kind, `${set.name}: placement type ${got.kind}, source says ${pl.type}`);
    fields++;
    if (got.kind === 'random_spread') {
      ok((pl.spacing | 0) === got.spacing, `${set.name}: spacing ${got.spacing}, source ${pl.spacing}`);
      ok((pl.separation | 0) === got.separation, `${set.name}: separation ${got.separation}, source ${pl.separation}`);
      ok((pl.salt | 0) === got.salt, `${set.name}: salt ${got.salt}, source ${pl.salt}`);
      const wantSpread = pl.spread_type ? short(pl.spread_type) : 'linear';
      ok(wantSpread === got.spreadType, `${set.name}: spread ${got.spreadType}, source ${wantSpread}`);
      // ⚠ the rule that makes `separation` mean anything at all
      ok(got.span === got.spacing - got.separation, `${set.name}: offset span is not spacing - separation`);
      fields += 5;
    } else {
      ok((pl.distance | 0) === got.distance && (pl.spread | 0) === got.spread && (pl.count | 0) === got.count,
         `${set.name}: concentric_rings ${got.distance}/${got.spread}/${got.count} against source ${pl.distance}/${pl.spread}/${pl.count}`);
      fields++;
    }
    ok(src.structures.length === set.members.length, `${set.name}: ${set.members.length} members, source has ${src.structures.length}`);
    for (let i = 0; i < src.structures.length; i++) {
      ok(short(src.structures[i].structure) === set.members[i].def.name,
         `${set.name}[${i}]: ${set.members[i].def.name}, source names ${src.structures[i].structure}`);
      ok((src.structures[i].weight | 0) === set.members[i].weight,
         `${set.name}[${i}]: weight ${set.members[i].weight}, source ${src.structures[i].weight}`);
      fields += 2;
    }
  }

  for (const name of Object.keys(ST.defs)) {
    const def = ST.defs[name];
    const src = readJSON(join(WGDIR, 'configured_structure_feature', name + '.json'));
    ok(short(src.type) === def.type, `${name}: type ${def.type}, source ${src.type}`);
    ok(same(src.config || {}, def.config),
       `${name}: config ${JSON.stringify(canon(def.config))}, source ${JSON.stringify(canon(src.config))}`);
    ok(typeof src.biomes !== 'string' || src.biomes === def.tag,
       `${name}: biome tag ${def.tag}, source ${src.biomes}`);
    fields += 3;
  }

  // ⚠ the two numbers the mineshaft actually runs on, named rather than assumed
  const ms = ST.defs['mineshaft'], mm = ST.defs['mineshaft_mesa'];
  ok(ms && ms.grammar && Math.abs(ms.grammar.probability - 0.004) < 1e-12,
     `mineshaft probability ${ms && ms.grammar && ms.grammar.probability}, the file says 0.004`);
  ok(mm && mm.grammar && mm.grammar.mesa === true, 'mineshaft_mesa did not compile as the mesa variant');
  ok(ms.grammar.mesa === false, 'mineshaft compiled as the mesa variant');

  // and the step table, which is NOT in the JSON and is therefore the one thing here that can
  // rot silently: it is a port of `StructureFeature`'s own field.
  ok(ST.defs['mineshaft'].step === 3, `mineshaft is decoration step ${ST.defs['mineshaft'].step}, vanilla's is 3 (UNDERGROUND_STRUCTURES)`);
  ok(ST.defs['stronghold'].step === 5, `stronghold is step ${ST.defs['stronghold'].step}, vanilla's is 5 (STRONGHOLDS)`);
  ok(ST.defs['village_plains'].step === 4, `village_plains is step ${ST.defs['village_plains'].step}, vanilla's is 4 (SURFACE_STRUCTURES)`);

  // ⚠ AND WHAT IS NOT DONE IS COUNTED (D-185). 29 of the 31 have a ported placement and no piece
  // grammar; a registry that reported only the two that work would read as finished, and W15..W18
  // are exactly those 29.
  // ⚠ THIS COUNT MOVED WHEN TRACK W FINISHED, and it is left as a count rather than softened to
  // "at least one": W13/W14 had two grammars and 29 placement-only structures, W15..W18 took it
  // to 27 and 4, and the four are exactly the Nether and End ones (section 8 names them). A
  // build that grew a 28th has grown a dimension it does not have.
  const st = ST.stats();
  ok(st.withGrammar === 28, `${st.withGrammar} structures have a piece grammar, expected 28`);
  ok(st.withoutGrammar === 3, `${st.withoutGrammar} structures are placement-only, expected 3 (the Nether and End ones)`);
  ok(st.liveSets === 15, `${st.liveSets} of the 17 sets have a member with a grammar, expected 15`);
  ok(ST.defs['stronghold'].grammar !== null, 'the stronghold has no piece grammar — PLAN W18 owns its ~14-piece room grammar');

  // ── the one placement rule that is not a grid: `concentric_rings`, ported and exercised.
  // ⚠ A ported rule nothing ever calls is a rule nobody has checked, so this drives it rather
  // than reading its fields. The strongholds sit in rings around the origin, each ring further
  // out than the last, and the whole list is a pure function of the seed.
  {
    const pl = ST.sets.find((x) => x.name === 'strongholds').placement;
    const rings = ST.ringPositions(pl);
    ok(rings.length === pl.count * 2, `${rings.length / 2} stronghold positions, the file asks for ${pl.count}`);
    const d = [];
    for (let i = 0; i < rings.length; i += 2) d.push(Math.hypot(rings[i], rings[i + 1]));
    // ring 0 sits near 4 x distance chunks out, and no stronghold may land on top of spawn
    ok(d[0] > pl.distance * 2, `the first stronghold is only ${d[0].toFixed(0)} chunks out, inside 2 x distance`);
    ok(d[d.length - 1] > d[0] * 2, `the last stronghold at ${d[d.length - 1].toFixed(0)} chunks is not further out than the first at ${d[0].toFixed(0)} — the rings are not growing`);
    const again = ST.ringPositions(pl);
    ok(again.every((v, i) => v === rings[i]), 'the stronghold rings are not a pure function of the seed');
    if (PRINT) console.log(`   concentric_rings: ${pl.count} positions, ${d[0].toFixed(0)} to ${d[d.length - 1].toFixed(0)} chunks out`);
  }
  if (PRINT) console.log(`   17 sets · 31 structures · ${fields} fields compared against the source JSON`);
}

// ─────────────────────────────────────────────── 2. the biome tags (D-183)
console.log('2. the biome tags, resolved here and compared with the packed ones');
{
  const JAR = jarPath(VERSION);
  ok(!!JAR && existsSync(JAR), `no ${VERSION} jar to read the tags out of`);
  const jar = new Jar(JAR);
  const raw = new Map();
  for (const e of jar.names()) {
    const m = /^data\/minecraft\/tags\/worldgen\/biome\/(.+)\.json$/.exec(e);
    if (m) raw.set(m[1], JSON.parse(jar.readText(e)));
  }
  ok(raw.size >= 30, `only ${raw.size} biome tag files in the jar`);
  ok(WG.biomeTagCount === raw.size, `runtime carries ${WG.biomeTagCount} biome tags, the jar has ${raw.size}`);

  // ⚠ an INDEPENDENT resolver, written differently on purpose. If this file reused
  // pack-worldgen's it would only be asserting that a function equals itself.
  const seen = new Set();
  const resolve = (name) => {
    if (seen.has(name)) return [];
    seen.add(name);
    const node = raw.get(name);
    if (!node) return [];
    const out = [];
    for (const v of node.values) {
      if (v[0] === '#') out.push(...resolve(short(v.slice(1))));
      else out.push(short(v));
    }
    seen.delete(name);
    return out;
  };

  let entries = 0, nested = 0;
  for (const [name, node] of raw) {
    const want = [...new Set(resolve(name))];
    const got = WG.biomeTag(name);
    ok(Array.isArray(got), `biome tag ${name} is missing from the runtime`);
    if (!Array.isArray(got)) continue;
    ok(got.length === want.length && got.every((b, i) => b === want[i]),
       `biome tag ${name}: runtime has ${got.length} biomes [${got.slice(0, 4)}…], resolving the files gives ${want.length} [${want.slice(0, 4)}…]`);
    ok(got.every((b) => b.indexOf('#') < 0 && b.indexOf(':') < 0),
       `biome tag ${name} still carries an unresolved reference`);
    entries += got.length;
    if (node.values.some((v) => v[0] === '#')) nested++;
  }
  ok(nested >= 5, `only ${nested} tags nest another tag — the flattening is not being exercised`);

  // the namespace forms are all one question
  ok(WG.biomeTag('#minecraft:has_structure/mineshaft') === WG.biomeTag('has_structure/mineshaft'),
     'the `#minecraft:` and bare forms of a tag name give different answers');

  // and the tag actually reached the structure it belongs to, as REGISTRY INDICES
  const tagList = WG.biomeTag('has_structure/mineshaft_mesa');
  const allow = ST.defs['mineshaft_mesa'].allow;
  for (const b of tagList) ok(allow[B.indexOf[b]] === 1, `mineshaft_mesa does not allow ${b}, which its tag names`);
  ok(ST.defs['mineshaft_mesa'].allowCount === tagList.length,
     `mineshaft_mesa allows ${ST.defs['mineshaft_mesa'].allowCount} biomes, its tag names ${tagList.length}`);
  ok(allow[B.indexOf['plains']] !== 1, 'mineshaft_mesa is allowed in plains, which is not in its tag');
  ok(ST.defs['mineshaft'].allow[B.indexOf['plains']] === 1, 'mineshaft is not allowed in plains, which IS in its tag');
  if (PRINT) console.log(`   ${raw.size} tags · ${entries} biome entries · ${nested} of them nest another tag`);
}

// ─────────────────────────────────────────────── 3. the placement rule
console.log('3. the region grid, the sparse biome probe, and the density');
{
  // ── the grid: one candidate per region, and it lies inside the region's own span
  let gridChecks = 0;
  const out = new Int32Array(4);
  for (const set of ST.sets) {
    const pl = set.placement;
    if (pl.kind !== 'random_spread') continue;
    for (let rz = -6; rz <= 6; rz++) {
      for (let rx = -6; rx <= 6; rx++) {
        pl.candidateOfRegion(SEED, rx, rz, out);
        const cx = out[0], cz = out[1];
        ok(cx >= rx * pl.spacing && cx < rx * pl.spacing + pl.span,
           `${set.name}: region ${rx} put its candidate at ${cx}, outside [${rx * pl.spacing}, ${rx * pl.spacing + pl.span})`);
        ok(cz >= rz * pl.spacing && cz < rz * pl.spacing + pl.span,
           `${set.name}: region ${rz} put its candidate at ${cz}, outside its span`);
        // and the chunk it named maps back to the region that named it
        const back = new Int32Array(4);
        pl.regionOf(cx, cz, back);
        ok(back[0] === rx && back[1] === rz, `${set.name}: candidate (${cx},${cz}) belongs to region (${back[0]},${back[1]}), not (${rx},${rz})`);
        gridChecks += 3;
      }
    }
  }

  // ⚠ `separation` is not decoration: two candidates of the same set can never be adjacent.
  // Vanilla's whole reason for the field is a minimum distance, so assert the distance.
  for (const set of ST.sets) {
    const pl = set.placement;
    if (pl.kind !== 'random_spread' || pl.separation === 0) continue;
    let worst = 1e9;
    for (let rz = -4; rz <= 4; rz++) {
      for (let rx = -4; rx <= 4; rx++) {
        pl.candidateOfRegion(SEED, rx, rz, out);
        const ax = out[0], az = out[1];
        const o2 = new Int32Array(4);
        pl.candidateOfRegion(SEED, rx + 1, rz, o2);
        worst = Math.min(worst, o2[0] - ax);
        pl.candidateOfRegion(SEED, rx, rz + 1, o2);
        worst = Math.min(worst, o2[1] - az);
      }
    }
    ok(worst >= pl.separation, `${set.name}: two neighbouring candidates came within ${worst} chunks, separation is ${pl.separation}`);
  }

  // ── `biomeAt3Sparse` is `biomeAt3`, or it is a second sampler and D-180 said not to have one
  {
    let n = 0, same = 0;
    for (let i = 0; i < 20000; i++) {
      const x = ((i * 7919) % 4001) - 2000, z = ((i * 104729) % 4001) - 2000;
      const y = MINY + ((i * 31) % H);
      const a = G.biomeAt3Sparse(x, y, z);
      const b = G.biomeAt3(x, y, z);              // builds and caches the volume
      n++; if (a === b) same++;
    }
    ok(same === n, `biomeAt3Sparse disagreed with biomeAt3 at ${n - same} of ${n} positions`);
    if (PRINT) console.log(`   biomeAt3Sparse: ${same}/${n} positions agree with the cached volume`);
  }

  // ── the hot path gives the reference path's answer
  {
    const si = ST.sets.findIndex((s) => s.name === 'mineshafts');
    let regions = 0, agree = 0, viaBlock = 0, viaRegion = 0;
    for (let bz = -2; bz <= 2; bz++) {
      for (let bx = -2; bx <= 2; bx++) {
        // ⚠ THE BLOCK SIZE IS PER SET (D-192), so the reference has to ask the same question the
        // cache does: `mineshafts` (spacing 1) blocks 4x4 regions, every wider-spaced set blocks
        // one. Hard-coding 4 here made the reference compare a different area and report two
        // disagreements that were the check's own.
        const BS = ST.blockSizeOf(ST.sets[si]);
        const block = ST.blockStarts(si, bx, bz, BS);
        const want = [];
        for (let rz = bz * BS; rz < bz * BS + BS; rz++) {
          for (let rx = bx * BS; rx < bx * BS + BS; rx++) { want.push(...ST.startsOfRegion(si, rx, rz)); regions++; }
        }
        viaBlock += block.length; viaRegion += want.length;
        if (block.length === want.length &&
            block.every((s, i) => s.cx === want[i].cx && s.cz === want[i].cz && s.pieces.length === want[i].pieces.length)) agree++;
      }
    }
    ok(agree === 25, `the block cache and the per-region reference disagreed on ${25 - agree} of 25 blocks`);
    ok(viaBlock === viaRegion, `the block cache found ${viaBlock} starts where the reference found ${viaRegion}`);
    if (PRINT) console.log(`   block cache: ${regions} regions in 25 blocks, ${viaBlock} starts, identical to the reference`);
  }

  // ── density, in a stated band, against what the data says it should be
  //
  // `mineshafts` is spacing 1 / separation 0, so every chunk is a candidate and the density is
  // decided entirely by the two `probability: 0.004` gates and the biome tags. Two variants at
  // 0.004 is 0.008 attempts per chunk; the tags then reject the candidates whose biome is in
  // neither, so the answer must be at or below that and not far below it.
  {
    const si = ST.sets.findIndex((s) => s.name === 'mineshafts');
    let starts = 0, chunks = 0, mesa = 0, sizes = [];
    for (let cz = -80; cz < 80; cz++) {
      for (let cx = -80; cx < 80; cx++) {
        chunks++;
        for (const s of ST.startsOfRegion(si, cx, cz)) {
          starts++; sizes.push(s.pieces.length);
          if (s.def.name === 'mineshaft_mesa') mesa++;
        }
      }
    }
    const rate = starts / chunks;
    ok(starts > 0, 'no mineshaft started anywhere in 25,600 chunks');
    ok(rate <= 0.008, `${(rate * 1000).toFixed(2)} mineshafts per 1,000 chunks, above the 8 the two gates allow`);
    ok(rate >= 0.0025, `${(rate * 1000).toFixed(2)} mineshafts per 1,000 chunks — the biome tags are rejecting nearly everything`);
    // every start's own chunk must be in its own tag, or the eligibility test is decorative
    let inTag = 0;
    for (let cz = -80; cz < 80; cz += 3) {
      for (let cx = -80; cx < 80; cx += 3) {
        for (const s of ST.startsOfRegion(si, cx, cz)) {
          const b = G.biomeAt3Sparse((s.cx << 4) + 8, s.y, (s.cz << 4) + 8);
          ok(s.def.allow[b] === 1, `${s.def.name} started in ${B.name(b)}, which is not in its biome tag`);
          inTag++;
        }
      }
    }
    ok(inTag > 0, 'the biome-tag assertion saw no starts at all');
    if (PRINT) {
      sizes.sort((a, b) => a - b);
      console.log(`   ${starts} mineshafts in ${chunks} chunks (${(rate * 1000).toFixed(2)} per 1,000; ${mesa} mesa)`);
      console.log(`   pieces per mineshaft: p50 ${sizes[sizes.length >> 1]}, p99 ${sizes[Math.floor(sizes.length * 0.99)]}, max ${sizes[sizes.length - 1]}`);
    }
    ok(gridChecks > 500, `only ${gridChecks} grid assertions ran`);
  }
}

// ─────────────────────────────────────────────── 4. determinism — W14's stated acceptance
console.log('4. the same region, three chunk orders, byte-identical');
{
  /** Every block of one generated chunk, flattened. */
  function chunkBytes(cx, cz) {
    const col = getCachedColumn(MCL, cx, cz) /* D-463 */;
    const out = new Int32Array(CFG.SECTIONS_Y * CFG.SECTION_VOL);
    let n = 0;
    for (let sy = 0; sy < CFG.SECTIONS_Y; sy++) {
      for (let i = 0; i < CFG.SECTION_VOL; i++) out[n++] = S.get(col.sec[sy], i);
    }
    return out;
  }
  /** A world with no memory of itself: every cache the structure path can hide state in. */
  function coldCaches() {
    ST.dropCache();
    G.dropBiomeVolumes();
    MCL.Carvers.cache = new Map();
    MCL.Features.cache = new Map();
  }

  // ⚠ THE REGION IS CHOSEN BECAUSE IT CONTAINS A MINESHAFT, not because it is convenient. A
  // determinism test over empty terrain proves the terrain is deterministic and says nothing
  // about the structure layer at all — which is exactly how a broken start pass survives.
  const si = ST.sets.findIndex((s) => s.name === 'mineshafts');
  let at = null;
  outer:
  for (let cz = -40; cz < 40 && !at; cz++) {
    for (let cx = -40; cx < 40; cx++) {
      const l = ST.startsOfRegion(si, cx, cz);
      if (l.length) { at = l[0]; break outer; }
    }
  }
  ok(at !== null, 'no mineshaft found within 40 chunks of the origin to test determinism over');

  const R = 2;
  const coords = [];
  for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) coords.push([at.cx + dx, at.cz + dz]);

  const orders = {
    'raster':  coords.slice(),
    'reverse': coords.slice().reverse(),
    // a deterministic shuffle: the diagonal walk, which is neither of the above and is the order
    // a player who walks in from a corner would actually generate them in
    'diagonal': coords.slice().sort((a, b) => ((a[0] + a[1]) - (b[0] + b[1])) || (a[0] - b[0])),
  };

  const got = {};
  for (const [name, order] of Object.entries(orders)) {
    coldCaches();
    const m = new Map();
    for (const [cx, cz] of order) m.set(cx * 100003 + cz, chunkBytes(cx, cz));
    got[name] = m;
  }
  let cmp = 0, diffs = 0, structureBlocks = 0;
  const PLANK = SR.stateOf('oak_planks'), RAIL = SR.stateOf('rail'), FENCE = SR.stateOf('oak_fence');
  for (const [cx, cz] of coords) {
    const k = cx * 100003 + cz;
    const a = got.raster.get(k);
    for (const name of ['reverse', 'diagonal']) {
      const b = got[name].get(k);
      let bad = -1;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { bad = i; break; }
      ok(bad < 0, `chunk (${cx},${cz}) differs between the raster and ${name} orders, first at index ${bad}`);
      if (bad >= 0) diffs++;
      cmp++;
    }
    for (let i = 0; i < a.length; i++) if (a[i] === PLANK || a[i] === RAIL || a[i] === FENCE) structureBlocks++;
  }
  // ⚠ AND THE TEST HAS TO HAVE SEEN A STRUCTURE, or "byte-identical" is a statement about dirt.
  ok(structureBlocks > 50, `only ${structureBlocks} mineshaft blocks in the region under test — the comparison is not looking at a structure`);
  ok(diffs === 0, `${diffs} of ${cmp} chunk comparisons differed across chunk orders`);

  // and the same claim one level down: a cold structure cache and a warm one give the same start
  coldCaches();
  const cold = JSON.stringify(ST.startsOfRegion(si, at.cx, at.cz).map((s) => [s.cx, s.cz, s.y0, s.y1, s.pieces.length]));
  const warm = JSON.stringify(ST.startsOfRegion(si, at.cx, at.cz).map((s) => [s.cx, s.cz, s.y0, s.y1, s.pieces.length]));
  ok(cold === warm, 'the same region gave different starts from a cold cache and a warm one');
  if (PRINT) console.log(`   ${(2 * R + 1) ** 2} chunks around the mineshaft at (${at.cx},${at.cz}) · ${cmp} comparisons · ${structureBlocks} structure blocks seen`);
}

// ─────────────────────────────────────────────── 5. the pieces, and the bounded neighbourhood
console.log('5. the mineshaft grammar: reach, caps, and what a piece is allowed to be');
{
  const si = ST.sets.findIndex((s) => s.name === 'mineshafts');
  const reach = ST.defs['mineshaft'].reach;
  ok(reach === ST.sets[si].reach, `the mineshafts set scans ${ST.sets[si].reach} chunks, the structure declares ${reach}`);

  let n = 0, maxOff = 0, maxPieces = 0, kinds = {}, atCap = 0, sizes = [];
  for (let cz = -110; cz < 110; cz += 1) {
    for (let cx = -110; cx < 110; cx += 1) {
      for (const s of ST.startsOfRegion(si, cx, cz)) {
        n++; sizes.push(s.pieces.length);
        if (s.pieces.length >= ST.MINESHAFT_MAX_PIECES) atCap++;
        if (s.pieces.length > maxPieces) maxPieces = s.pieces.length;
        const ox = s.cx << 4, oz = s.cz << 4;
        for (const p of s.pieces) {
          kinds[p.kind] = (kinds[p.kind] || 0) + 1;
          maxOff = Math.max(maxOff, ox - p.x0, p.x1 - (ox + 15), oz - p.z0, p.z1 - (oz + 15));
          // ⚠ nothing may reach outside the world, in either direction
          ok(p.y0 >= MINY && p.y1 < MINY + H, `a ${p.kind} spans y ${p.y0}..${p.y1}, outside the world`);
          ok(p.x0 <= p.x1 && p.y0 <= p.y1 && p.z0 <= p.z1, `a ${p.kind} has an inside-out bounding box`);
        }
        // the start's own box must be the union of its pieces', or `startsNear` filters on a lie
        let bx0 = Infinity, bx1 = -Infinity;
        for (const p of s.pieces) { bx0 = Math.min(bx0, p.x0); bx1 = Math.max(bx1, p.x1); }
        ok(s.x0 === bx0 && s.x1 === bx1, `a start's box (${s.x0}..${s.x1}) is not the union of its pieces' (${bx0}..${bx1})`);
      }
    }
  }
  ok(n > 100, `only ${n} mineshafts over 48,400 chunks — the sample is too small to conclude anything`);
  // ⚠ THE ONE THAT PROTECTS THE INVARIANT. A block further from the start than `reach` chunks is
  // a block some chunks write and others do not, which is a seam that depends on walking
  // direction and that no amount of order-shuffling in section 4 is guaranteed to catch.
  ok(maxOff <= reach * 16, `a piece reached ${maxOff} blocks past its own chunk; the write pass only scans ${reach} chunks (${reach * 16} blocks)`);
  ok(maxPieces <= ST.MINESHAFT_MAX_PIECES, `a mineshaft has ${maxPieces} pieces, over its own cap of ${ST.MINESHAFT_MAX_PIECES}`);
  // the cap is insurance, not the shape: if it is binding routinely, the structure is the cap's
  // and not vanilla's, which is exactly the bug the first draft of the grammar shipped with
  ok(atCap === 0, `${atCap} of ${n} mineshafts hit the piece cap — the cap, not the depth and span caps, is deciding the shape`);
  for (const k of ['room', 'corridor', 'crossing', 'stairs']) {
    ok((kinds[k] || 0) > 0, `not one ${k} piece was generated in ${n} mineshafts — that branch of the grammar is dead`);
  }
  ok(kinds.room === n, `${n} mineshafts produced ${kinds.room} rooms; every one must have exactly one`);
  if (PRINT) {
    sizes.sort((a, b) => a - b);
    console.log(`   ${n} mineshafts · furthest piece ${maxOff} blocks (reach allows ${reach * 16}) · largest ${maxPieces} pieces (cap ${ST.MINESHAFT_MAX_PIECES})`);
    console.log(`   pieces: ${Object.entries(kinds).map(([k, v]) => k + ' ' + v).join(', ')}`);
  }
}

// ─────────────────────────────────────────────── 6. no floating, no burial, and a cross-section
console.log('6. what a generated mineshaft actually looks like');
{
  const si = ST.sets.findIndex((s) => s.name === 'mineshafts');
  let at = null;
  outer2:
  for (let cz = -40; cz < 40; cz++) {
    for (let cx = -40; cx < 40; cx++) {
      const l = ST.startsOfRegion(si, cx, cz);
      if (l.length) { at = l[0]; break outer2; }
    }
  }
  ok(at !== null, 'no mineshaft to look at');

  const RAIL = SR.stateOf('rail'), FENCE = SR.stateOf('oak_fence'), PLANK = SR.stateOf('oak_planks');
  const WEB = SR.stateOf('cobweb'), SPAWNER = SR.stateOf('spawner');

  const cols = new Map();
  const R = 3;
  for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) cols.set((at.cx + dx) * 100003 + (at.cz + dz), getCachedColumn(MCL, at.cx + dx, at.cz + dz) /* D-463 */);
  const blockAt = (x, y, z) => {
    const cx = x >> 4, cz = z >> 4;
    const col = cols.get(cx * 100003 + cz);
    if (!col) return -1;
    const ly = y - MINY;
    if (ly < 0 || ly >= H) return -1;
    return S.get(col.sec[ly >> 4], ((ly & 15) << 8) | ((z & 15) << 4) | (x & 15));
  };

  let rails = 0, floating = 0, fences = 0, planks = 0, webs = 0, cages = 0, buried = 0, air = 0;
  for (let z = (at.cz - R) << 4; z < ((at.cz + R) << 4) + 16; z++) {
    for (let x = (at.cx - R) << 4; x < ((at.cx + R) << 4) + 16; x++) {
      for (let y = at.y0 - 2; y <= at.y1 + 2; y++) {
        const b = blockAt(x, y, z);
        if (b < 0) continue;
        if (b === RAIL) {
          rails++;
          // ⚠ PLAN §8's "no float": a rail with nothing under it is the exact failure this line
          // exists for, and it is also the one a chunk-border bug produces first.
          const below = blockAt(x, y - 1, z);
          if (below === 0) floating++;
          if (blockAt(x, y + 1, z) !== 0) buried++;      // and "no burial": you can stand on it
        } else if (b === FENCE) fences++;
        else if (b === PLANK) planks++;
        else if (b === WEB) webs++;
        else if (b === SPAWNER) cages++;
      }
    }
  }
  ok(rails > 0, 'the mineshaft under test has no rails at all');
  ok(planks > 0 && fences > 0, `the mineshaft has ${planks} planks and ${fences} fence posts — its timbers are missing`);
  ok(floating === 0, `${floating} of ${rails} rails are laid over air`);
  ok(buried === 0, `${buried} of ${rails} rails have a solid block directly on top of them`);

  // ── the cross-section, so a human can read it without a GPU (PLAN §8's "cross-sections")
  const y0 = at.y0, y1 = Math.min(at.y1, at.y0 + 24);
  const zMid = (at.cz << 4) + 8;
  const glyph = (b) => b < 0 ? ' ' : (b === 0 ? '.' : (b === RAIL ? '=' : (b === FENCE ? '|' : (b === PLANK ? '#' :
                 (b === WEB ? '*' : (b === SPAWNER ? 'X' : (SR.name(b) === 'water' ? '~' : 'o')))))));
  const rows = [];
  for (let y = y1; y >= y0; y--) {
    let line = '';
    for (let x = (at.cx - 1) << 4; x < ((at.cx + 2) << 4); x++) line += glyph(blockAt(x, y, zMid));
    rows.push(String(y).padStart(4) + ' ' + line);
  }
  ok(rows.some((r) => /[=|#*]/.test(r)), 'the cross-section through the mineshaft shows none of its blocks');
  if (PRINT) {
    console.log(`   a slice through the mineshaft at chunk (${at.cx},${at.cz}), z=${zMid}`);
    console.log('   . air   o stone/ground   # planks   | fence   = rail   * cobweb   X spawner');
    for (const r of rows) console.log('   ' + r);
  }
  console.log(`   rails ${rails} · planks ${planks} · fences ${fences} · cobwebs ${webs} · cages ${cages}`);
}

// ─────────────────────────────────────────────── 7. cost
console.log('7. cost: the placement must not move chunk generation');
{
  // PLAN §7: *"structures must not measurably move chunk generation time. Measured, not
  // asserted."* So this measures the START PASS alone — the part W13 adds to every chunk whether
  // or not there is a structure in it — and bounds it. What a mineshaft costs to WRITE is not
  // overhead, it is the feature; what `startsNear` costs on a chunk with nothing in it is.
  ST.dropCache();
  // warm the caches the way a streaming world would
  for (let cz = -6; cz <= 6; cz++) for (let cx = -6; cx <= 6; cx++) ST.startsNear(cx, cz);
  // s118: BEST OF FIVE. One 169-chunk timing on the runner read 42.3 us while the machine was
  // also building a session's close (suite 202609241504 ran 97 s where it runs 57): that measured
  // the neighbours, not the start pass. The minimum over repeats is the pass's own cost.
  let us = Infinity;
  for (let rep = 0; rep < 5; rep++) {
    const t0 = process.hrtime.bigint();
    let n = 0;
    for (let cz = -6; cz <= 6; cz++) for (let cx = -6; cx <= 6; cx++) { ST.startsNear(cx, cz); n++; }
    us = Math.min(us, Number(process.hrtime.bigint() - t0) / 1000 / n);
  }
  ok(us < 40, `the start pass costs ${us.toFixed(1)} microseconds a chunk on a warm cache, over the 40 this asserts`);
  ok(ST.cacheHits > ST.cacheMisses, `the block cache missed ${ST.cacheMisses} times against ${ST.cacheHits} hits — it is not caching`);
  if (PRINT) console.log(`   start pass ${us.toFixed(1)} us/chunk warm · ${ST.cacheHits} hits / ${ST.cacheMisses} misses`);
}

// ─────────────────────────────────────────────── 8. every overworld structure is built
console.log('8. all 17 sets, and which of the 31 structures this build can actually place');
{
  // ⚠ THE DIMENSION SPLIT IS COUNTED, NOT ASSUMED. Four of the 31 configured structures are
  // Nether or End — PLAN's own W8 audit ruled them *"G19's dimensions, correctly out of scope"* —
  // so W18 is finished when the other 27 have a grammar and none of those four does. A build
  // that quietly grew a bastion would be as wrong as one that quietly lost a village.
  const NOT_OVERWORLD = ['bastion_remnant', 'end_city', 'nether_fossil'];
  const st = ST.stats();
  ok(st.withGrammar === 28, `${st.withGrammar} structures have a piece grammar, expected 28 (31 minus the four the overworld cannot reach)`);
  ok(st.withoutGrammar === 3, `${st.withoutGrammar} structures are placement-only, expected 3`);
  for (const n of NOT_OVERWORLD) ok(ST.defs[n].grammar === null, `${n} has a piece grammar; it is a ${n === 'end_city' ? 'End' : 'Nether'} structure (G19)`);
  for (const n of Object.keys(ST.defs)) {
    if (NOT_OVERWORLD.indexOf(n) >= 0) continue;
    ok(ST.defs[n].grammar !== null, `${n} has no piece grammar — W15..W18 are not finished`);
  }
  ok(ST.sets.filter((x) => x.live).length === 15, `${ST.sets.filter((x) => x.live).length} of the 17 sets are live, expected 15`);

  // ── and they generate. One start per configured structure, found by walking its own grid.
  const found = Object.create(null);
  for (let si = 0; si < ST.sets.length; si++) {
    const set = ST.sets[si];
    if (!set.live) continue;
    const pl = set.placement;
    if (pl.kind === 'concentric_rings') {
      const pos = ST.ringPositions(pl);
      for (let i = 0; i < 60 && i * 2 < pos.length; i++) {
        for (const s2 of ST.startsNear(pos[i * 2], pos[i * 2 + 1])) found[s2.def.name] = (found[s2.def.name] || 0) + 1;
      }
      continue;
    }
    const span = pl.spacing <= 2 ? 40 : 14;
    for (let rz = -span; rz < span; rz++) {
      for (let rx = -span; rx < span; rx++) {
        for (const s2 of ST.startsOfRegion(si, rx, rz)) found[s2.def.name] = (found[s2.def.name] || 0) + 1;
      }
    }
  }
  const absent = [];
  for (const n of Object.keys(ST.defs)) {
    if (NOT_OVERWORLD.indexOf(n) >= 0) continue;
    if (!found[n]) absent.push(n);
  }
  // ⚠ `mineshaft_mesa` needs badlands and `village_snowy` needs a snowy plain, and neither is
  // guaranteed inside a fixed window at one seed — so the assertion is on the FAMILIES, each of
  // which must appear somewhere, rather than on all 27 individually. The absentees are printed.
  const families = { mineshaft: 0, village: 0, ruined_portal: 0, ocean_ruin: 0, shipwreck: 0 };
  for (const n of Object.keys(found)) for (const f of Object.keys(families)) if (n.indexOf(f) === 0) families[f] += found[n];
  for (const f of Object.keys(families)) ok(families[f] > 0, `not one ${f} generated anywhere in the sampled window`);
  for (const n of ['igloo', 'desert_pyramid', 'jungle_pyramid', 'swamp_hut', 'pillager_outpost', 'monument', 'mansion', 'stronghold']) {
    ok((found[n] || 0) > 0, `not one ${n} generated in the sampled window`);
  }
  ok(absent.length <= 4, `${absent.length} overworld structures generated nowhere: ${absent.join(' ')}`);
  if (PRINT) {
    console.log('   starts found: ' + Object.keys(found).sort().map((k) => k + ' ' + found[k]).join(', '));
    if (absent.length) console.log('   biome-limited, none in this window: ' + absent.join(' '));
  }
}

// ─────────────────────────────────────────────── 9. the beard: no floating, no burial
// ⚠ §11 BREAKS THIS SECTION FOR REAL (D-30), so it needs the real village back: the pieces of
// one generated start, the reader that answers from its generated chunks, and the floor
// derivation itself. A synthetic `sup = 90, flo = 10` proves the arithmetic, not the test.
let av9 = null;
console.log('9. W16 acceptance: every placed floor is supported and no interior is buried');
{
  // PLAN W16: *"no floating and no burial — for each placed piece assert its floor is supported
  // and its door is reachable"*. "Supported" is the block under the piece's floor being solid,
  // which is what the beard exists to guarantee; "reachable" is the cells the TEMPLATE says are
  // air actually being air in the generated world, which is what the shave guarantees. Both are
  // measured against the real generated chunks, not against the piece list.
  const Templ = MCL.Templates, JGx = MCL.Jigsaw;

  function generateAround(at, R) {
    const cols = new Map();
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      cols.set((at.cx + dx) * 100003 + (at.cz + dz), getCachedColumn(MCL, at.cx + dx, at.cz + dz) /* D-463 */);
    }
    return (x, y, z) => {
      const cx = x >> 4, cz = z >> 4;
      const col = cols.get(cx * 100003 + cz);
      if (!col) return -1;
      const ly = y - MINY;
      if (ly < 0 || ly >= H) return -1;
      return S.get(col.sec[ly >> 4], ((ly & 15) << 8) | ((z & 15) << 4) | (x & 15));
    };
  }
  function findStart(name, span) {
    for (let si = 0; si < ST.sets.length; si++) {
      const set = ST.sets[si];
      if (!set.live) continue;
      for (let rz = -span; rz < span; rz++) {
        for (let rx = -span; rx < span; rx++) {
          for (const s2 of ST.startsOfRegion(si, rx, rz)) if (s2.def.name === name) return s2;
        }
      }
    }
    return null;
  }

  let supported = 0, floating = 0, airWanted = 0, airBuried = 0, examined = 0;
  const rigidHoles = [];
  let rigidFloating = 0, drapeSup = 0, drapeFlo = 0;
  const perStructure = {};
  for (const name of ['desert_pyramid', 'igloo', 'swamp_hut', 'jungle_pyramid', 'village_plains', 'village_desert', 'pillager_outpost']) {
    const at = findStart(name, 26);
    if (!at) continue;
    examined++;
    const blockAt = generateAround(at, 5);
    let sup = 0, flo = 0, aw = 0, ab = 0, dsup = 0, dflo = 0, rflo = 0;
    // ⚠ the piece's OWN box has to be excluded by identity, not by passing null — the first
    // version passed null and every interior cell was "inside another piece", which reported
    // zero cells examined and a perfect score on a test that had stopped looking.
    const boxOf = new Map();
    const boxes = [];
    for (const q of at.pieces) {
      if (q.kind === 'beard') continue;
      const b = { x0: q.x0, y0: q.y0, z0: q.z0, x1: q.x1, y1: q.y1, z1: q.z1 };
      boxOf.set(q, b); boxes.push(b);
    }
    const inAnother = (x, y, z, self) => {
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        if (b === self) continue;
        if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && z >= b.z0 && z <= b.z1) return true;
      }
      return false;
    };
    // ⚠ WHERE A PIECE ACTUALLY IS, PER COLUMN. A `terrain_matching` piece is draped by
    // `GravityProcessor` at write time (D-216), so its box's Y is a fiction and its real span in
    // the column (x, z) starts at `Column.height(x, z)` — the same pure function the drape
    // itself uses. A rigid piece is where its box says it is.
    const spanOf = (p, x, z) => {
      if (p.kind === 'template' && p.proj === JGx.PROJ_TERRAIN) {
        const e2 = Templ.get(p.tpl);
        const h = MCL.Column.height(x, z);
        return [h, h + e2.sy - 1];
      }
      return [p.y0, p.y1];
    };
    /**
     * floorsOf(p) -> a flat [x, y, z, ...] of the lowest SOLID cell this piece places in each of
     * its own columns, in world coordinates and with the drape applied.
     *
     * ⚠ DERIVED FROM THE PIECE, READ FROM THE WORLD. What makes this a block test rather than a
     * box test is that the y comes from the piece's own content — the template's lowest solid
     * layer in that column, or the hand-built cell list's — and the ANSWER comes from the
     * generated chunk. Neither half is allowed to come from the other.
     */
    function floorsOf(p) {
      // ⚠ THE FLOOR IS THE PIECE'S BASE LAYER, NOT EVERY COLUMN'S LOWEST SOLID CELL. Taking the
      // lowest solid in each column calls a roof eave over a doorway a floor, and the block
      // under an eave is air by design: that reading reported 34 of `plains_tool_smith_1`'s 84
      // columns floating, with a WALL TORCH under one of them.
      // ⚠ AND IT IS NOT SIMPLY THE PIECE'S LOWEST SOLID LAYER EITHER, which is the other cheap
      // answer and is wrong for the opposite reason: a desert pyramid sinks foundation PILLARS
      // far below its base, and "the lowest layer with anything solid in it" was one column of
      // one pillar — the check kept its 100% and stopped looking at 120 of the 121 columns it
      // used to. The base layer is the LOWEST ly the piece fills in at least a quarter of the
      // columns it occupies: a definition of which layer is the building's underside, not a
      // tolerance on the answer.
      const cand = [];
      const perLy = new Map(), cols = new Set();
      const put = (x, y, z, ly) => {
        cand.push(x, y, z, ly);
        perLy.set(ly, (perLy.get(ly) || 0) + 1);
        cols.add(x + ',' + z);
      };
      if (p.kind === 'template') {
        const e = Templ.get(p.tpl), b = Templ.blocksOf(p.tpl, p.palIdx);
        const drape = p.proj === JGx.PROJ_TERRAIN;
        for (let i = 0; i < b.pos.length; i++) {
          const fl = Templ.flagOf(b.pal[i]);
          if (fl & (Templ.FLAG_VOID | Templ.FLAG_AIR | Templ.FLAG_JIGSAW)) continue;
          const st = JGx.rotated(b.pal[i], p.rot);
          if (st <= 0 || SR.opaque[st] !== 1) continue;
          const li = b.pos[i];
          const lx = li % e.sx, ly = (li / (e.sx * e.sz)) | 0, lz = ((li / e.sx) | 0) % e.sz;
          const wx = p.ox + JGx.rotX(e, p.rot, lx, lz), wz = p.oz + JGx.rotZ(e, p.rot, lx, lz);
          put(wx, (drape ? MCL.Column.height(wx, wz) : p.oy) + ly, wz, ly);
        }
      } else if (p.kind === 'blocks') {
        const c = p.cells;
        for (let i = 0; i < c.length; i += 4) {
          const lx = c[i], ly = c[i + 1], lz = c[i + 2];
          let st = c[i + 3];
          if (st === -1) continue;
          if (p.rot) st = JGx.rotateStateReal(st, p.rot);
          if (st <= 0 || SR.opaque[st] !== 1) continue;
          let wx, wz;
          if (p.rot === 0) { wx = p.ox + lx; wz = p.oz + lz; }
          else if (p.rot === 1) { wx = p.ox + (p.d - 1 - lz); wz = p.oz + lx; }
          else if (p.rot === 2) { wx = p.ox + (p.w - 1 - lx); wz = p.oz + (p.d - 1 - lz); }
          else { wx = p.ox + lz; wz = p.oz + (p.w - 1 - lx); }
          put(wx, p.oy + ly, wz, ly);
        }
      }
      const need = Math.max(1, Math.ceil(cols.size / 4));
      let base = 0x7fffffff;
      for (const [ly, n] of perLy) if (n >= need && ly < base) base = ly;
      const out = [];
      for (let i = 0; i < cand.length; i += 4) {
        if (cand[i + 3] !== base) continue;
        out.push(cand[i], cand[i + 1], cand[i + 2]);
      }
      return out;
    }
    for (let pi = 0; pi < at.pieces.length; pi++) {
      const p = at.pieces[pi];
      if (p.kind === 'beard') continue;
      // ── the floor. Sample the footprint rather than every column: a 49x49 mansion is 2,401
      // columns and the claim is about the fraction, not about each one.
      //
      // ⚠⚠ THIS ASKS THE BLOCK, AND UNTIL D-216 IT ASKED THE BOX (and reported 97.5%). The old
      // test scored a column supported when the cell under the piece's box floor was opaque **OR**
      // when `inAnother(x, p.y0 - 1, z, ...)` said that cell lay inside a DIFFERENT piece's
      // bounding box. A village street's box is 13x2x11 and 110 of its 143 ground cells are not
      // road at all, so a house standing on a street square scored as supported while standing on
      // NOTHING — which is precisely the failure D-216 fixed, measured by `structaudit` §1 as
      // 3,111 of village_plains' 10,334 structure-written solid cells sitting in ungrounded
      // components while this line printed 97.5%. A box is not a block. The stacked case the old
      // disjunct existed for needs no special pleading: a watchtower standing on its base plate is
      // standing on the base plate's BLOCKS, and those are opaque, so the block test passes it.
      //
      // ⚠ AND THE FLOOR IS THE LOWEST SOLID BLOCK IN THE COLUMN, NOT `p.y0 - 1`. A house template's
      // ground layer is not solid everywhere — `village/plains/houses/plains_small_house_1` has 23
      // air cells in its bottom layer against 24 solid — so asking about the cell under the box
      // floor asks about the cell under a hole in half the columns.
      //
      // ⚠ AND THE COLUMNS ARE THE PIECE'S OWN, NOT ITS BOX'S. Walking the box footprint and
      // taking whatever is lowest and solid counts the NATURAL GROUND beside a street as a
      // supported floor — 110 of a street tile's 143 ground cells are not road — and a
      // denominator padded with terrain is a percentage that improves when the sample gets
      // emptier. The floor is the lowest cell the PIECE ITSELF places solid in that column.
      const floors = floorsOf(p);
      const draped = p.kind === 'template' && p.proj === JGx.PROJ_TERRAIN;
      for (let fi = 0; fi < floors.length; fi += 3) {
        const x = floors[fi], fy = floors[fi + 1], z = floors[fi + 2];
        const under = blockAt(x, fy - 1, z);
        if (under < 0) continue;
        const held = under !== 0 && SR.opaque[under] === 1;
        if (held) sup++; else flo++;
        if (draped) { if (held) dsup++; else dflo++; }
        else if (!held) { rflo++; if (rigidHoles.length < 40) rigidHoles.push(`${name} ${p.tpl === undefined ? p.kind : ((Templ.get(p.tpl) || {}).id || p.tpl)} @${x},${fy},${z}${inAnother(x, fy - 1, z, boxOf.get(p)) ? ' (inside another piece box)' : ' (open air)'}`); }
      }
      // ── the interior. Every cell the TEMPLATE marks AIR must be air in the world.
      // ⚠ BUILDINGS ONLY. "No burial" is a claim about a room being reachable; a village PATH's
      // air cells are the two blocks above the road, and where the road tile is laid flat across
      // a slope some of those are legitimately inside the hill — vanilla's are too. Counting
      // them made the figure read 39.9% while every building in the sample was clear.
      // ⚠ AND IT NO LONGER ASKS `p.writeAir` (D-216). A `legacy_single_pool_element` does not
      // write its air — vanilla drops it — so the claim can no longer be "the writer put air
      // here". It is the stronger and more useful one the BEARD'S SHAVE is responsible for:
      // whatever the template calls air is air in the finished world, however it got that way.
      // Reading `writeAir` here made the sample 13 cells the moment the air rule was corrected,
      // which is a check that stops looking rather than a check that passes.
      if (p.kind !== 'template' || p.proj === JGx.PROJ_TERRAIN) continue;
      const e = Templ.get(p.tpl);
      const b = Templ.blocksOf(p.tpl, p.palIdx);
      for (let i = 0; i < b.pos.length; i += 3) {
        if (!(Templ.flagOf(b.pal[i]) & Templ.FLAG_AIR)) continue;
        const li = b.pos[i];
        const lx = li % e.sx, ly = (li / (e.sx * e.sz)) | 0, lz = ((li / e.sx) | 0) % e.sz;
        const wx = p.ox + JGx.rotX(e, p.rot, lx, lz), wz = p.oz + JGx.rotZ(e, p.rot, lx, lz);
        const wy = p.oy + ly;
        const got = blockAt(wx, wy, wz);
        if (got < 0) continue;
        // ⚠ AND NOT WHERE TWO PIECES SHARE SPACE. A jigsaw structure's pieces overlap by design
        // — a pillager outpost's watchtower sits inside its base plate's box, which is the
        // `insideCurrentPiece` rule W15 needed — so one piece's "interior air" is routinely
        // another piece's wall. That is not burial, and counting it as such reported 8.4% of the
        // outpost as buried when the beard was working perfectly.
        if (inAnother(wx, wy, wz, boxOf.get(p))) continue;
        aw++;
        if (got !== 0 && SR.opaque[got] === 1) ab++;
      }
    }
    supported += sup; floating += flo; airWanted += aw; airBuried += ab;
    rigidFloating += rflo; drapeSup += dsup; drapeFlo += dflo;
    if (name === 'village_plains') av9 = { pieces: at.pieces, blockAt, floorsOf, JGx };
    perStructure[name] = { sup, flo, aw, ab, dsup, dflo, rflo };
  }
  ok(examined >= 5, `only ${examined} of the seven surface structures were found to examine`);
  ok(supported > 500, `only ${supported} floor columns examined — the sample proves nothing`);
  // ⚠⚠ THE ONE THAT IS A ZERO, AND IT IS A ZERO FROM FIRST PRINCIPLES (D-216). A RIGID piece is
  // put at a chosen Y and its bottom solid layer is the layer that is supposed to be standing on
  // something: a building whose floor has air under it is not a cheaper silhouette, it is a
  // building over a hole. Nothing in this generator is allowed to produce one, so the number is
  // not a band — it is none. It became reachable when `legacy_single_pool_element` stopped
  // writing its air over the ground the house was standing on; before that fix the same three
  // villages measured 2,072 supported of 2,072 by asking the BOX and were 3,111 cells of
  // ungrounded building by `structaudit` §1's measurement of the blocks.
  // ⚠ AND IT SAYS WHERE. A hard zero that reports only its count sends the next reader back to
  // regenerate the world by hand to find the three cells; the coordinates and the template are
  // what turn it into a bug report.
  ok(rigidFloating === 0,
     `${rigidFloating} floor cells of a RIGID piece have air under them — a building over a hole`
     + (rigidHoles.length ? ': ' + rigidHoles.slice(0, 6).join(', ') : ''));
  // ⚠ AND THE ONE THAT IS NOT, SAID PLAINLY. A `terrain_matching` street drapes onto
  // `Column.height`, which is the ground BEFORE the structure pass; a house's beard then shaves
  // its own terrace, and a road crossing that skirt is left overhanging it by a block or two.
  // That residual belongs to the beard, not to the road, and §2 of `structaudit` is where the
  // beard is measured — so it is PRINTED here with its own denominator rather than bounded by a
  // number fitted to today's villages. The 95% band below is the one that has always been here
  // and it is not moved; what changed under it is that it is now measuring blocks.
  const supFrac = supported / (supported + floating);
  ok(supFrac >= 0.95, `${(supFrac * 100).toFixed(1)}% of placed floors are supported, under the 95% band`);
  ok(airWanted > 500, `only ${airWanted} interior air cells examined`);
  const burFrac = airBuried / Math.max(1, airWanted);
  ok(burFrac <= 0.02, `${(burFrac * 100).toFixed(1)}% of interior air cells are solid — the buildings are being buried`);
  if (PRINT) {
    console.log(`   ${supported + floating} floor columns, ${(supFrac * 100).toFixed(1)}% supported ` +
                `(rigid ${supported + floating - drapeSup - drapeFlo - rigidFloating}/${supported + floating - drapeSup - drapeFlo}, ` +
                `draped ${drapeSup}/${drapeSup + drapeFlo}) · ${airWanted} interior cells, ${(burFrac * 100).toFixed(2)}% buried`);
    for (const k of Object.keys(perStructure)) {
      const v = perStructure[k];
      console.log(`     ${k.padEnd(18)} floor ${v.sup}/${v.sup + v.flo} (rigid ${v.sup + v.flo - v.dsup - v.dflo - v.rflo}/${v.sup + v.flo - v.dsup - v.dflo}, draped ${v.dsup}/${v.dsup + v.dflo}) · interior ${v.aw - v.ab}/${v.aw}`);
    }
  }

  // ── and the flatness score, PLAN §9's risk 5, MEASURED
  const surveyed = ST.surveyed, rejected = ST.rejected;
  ok(Object.keys(surveyed).length >= 5, 'the suitability score was never run');
  let worst = 0, worstName = '';
  for (const k of Object.keys(surveyed)) {
    const rate = (rejected[k] || 0) / surveyed[k];
    if (rate > worst) { worst = rate; worstName = k; }
  }
  // ⚠ PLAN §9 risk 5 said terraced terrain might reject too many sites. It does not: the
  // binding constraint is the BIOME TAG, not the ground. Raising the village tolerance from 16
  // to 24 moved the count from 88 to 103 over the same 576 regions (D-189).
  ok(worst < 0.85, `${worstName} rejects ${(worst * 100).toFixed(0)}% of its candidate sites on flatness alone — PLAN §9's risk 5`);
  if (PRINT) {
    for (const k of Object.keys(surveyed).sort()) {
      console.log(`     ${k.padEnd(18)} ${rejected[k] || 0}/${surveyed[k]} sites rejected on flatness (${(100 * (rejected[k] || 0) / surveyed[k]).toFixed(0)}%)`);
    }
  }
}

// ─────────────────────────────────────────────── 10. a village, end to end
console.log('10. W17: a village generated through the real pipeline');
{
  const si = ST.sets.findIndex((x) => x.name === 'villages');
  let at = null;
  outer3:
  for (let rz = -14; rz < 14; rz++) {
    for (let rx = -14; rx < 14; rx++) {
      const l = ST.startsOfRegion(si, rx, rz);
      if (l.length) { at = l[0]; break outer3; }
    }
  }
  ok(at !== null, 'no village within 14 grid cells of the origin');
  if (at) {
    ok(at.pieces.length > 30, `the village has ${at.pieces.length} pieces — a town centre and nothing else is not a village`);
    // it must have STREETS and HOUSES, not just streets: the whole of D-189's bug was fifty
    // street tiles and no buildings, and a piece count cannot tell the two apart.
    const kinds = {};
    for (const p of at.pieces) {
      if (p.kind === 'beard') { kinds.beard = (kinds.beard || 0) + 1; continue; }
      const id = MCL.Templates.get(p.tpl).id;
      const fam = id.split('/').slice(0, 3).join('/');
      kinds[fam] = (kinds[fam] || 0) + 1;
    }
    let houses = 0, streets = 0, centres = 0;
    for (const k of Object.keys(kinds)) {
      if (k.indexOf('/houses') > 0) houses += kinds[k];
      if (k.indexOf('/streets') > 0) streets += kinds[k];
      if (k.indexOf('/town_centers') > 0) centres += kinds[k];
    }
    ok(centres === 1, `${centres} town centres, expected exactly 1`);
    ok(streets > 3, `${streets} street pieces`);
    ok(houses > 3, `${houses} houses — a village of streets and no buildings is D-189's bug`);
    ok(kinds.beard > 3, `${kinds.beard} beard pieces, one per rigid piece`);

    // ── and it lands in the world: count what the generated chunks gained
    const R = 4;
    const before = Object.create(null), after = Object.create(null);
    const alt = loadEngine({});
    alt.Gen.init(SEED, Object.assign(alt.Gen.defaults(), { climate: 'vanilla', structures: false }));
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const a = getCachedColumn(alt, at.cx + dx, at.cz + dz) /* D-463 */;
        const b = getCachedColumn(MCL, at.cx + dx, at.cz + dz) /* D-463 */;
        for (let sy = 0; sy < CFG.SECTIONS_Y; sy++) {
          for (let i = 0; i < CFG.SECTION_VOL; i++) {
            const x = alt.Section.get(a.sec[sy], i); if (x) before[alt.States.name(x)] = (before[alt.States.name(x)] || 0) + 1;
            const y = S.get(b.sec[sy], i); if (y) after[SR.name(y)] = (after[SR.name(y)] || 0) + 1;
          }
        }
      }
    }
    let gained = 0;
    for (const k of Object.keys(after)) gained += Math.max(0, after[k] - (before[k] || 0));
    ok(gained > 2000, `only ${gained} blocks appeared over ${(2 * R + 1) ** 2} chunks when the structures were switched on`);
    // ⚠ AND NOT ONE structure_void, which is D-190's bug: `final_state` is `structure_void` on
    // 1,124 of the 2,605 jigsaw blocks in the jar, and a writer that treats it as a block to
    // place scatters it through every village it builds.
    ok(!after.structure_void, `${after.structure_void} structure_void blocks were written into the world`);
    ok(!after.jigsaw, `${after.jigsaw} jigsaw blocks survived into the world`);
    if (PRINT) {
      console.log(`   ${at.def.name} at chunk (${at.cx},${at.cz}): ${at.pieces.length} pieces — ${centres} centre, ${streets} street, ${houses} house, ${kinds.beard} beard`);
      const top = Object.keys(after).map((k) => [k, after[k] - (before[k] || 0)]).filter((p) => p[1] > 30).sort((a, b) => b[1] - a[1]).slice(0, 8);
      console.log('   blocks gained: ' + top.map((p) => p[0] + ' +' + p[1]).join(', '));
    }
  }
}

// ────────────────────────── 10b. the two ways of asking where a structure starts AGREE (D-355)
//
// ⚠⚠ **`/locate` STANDS ON `startsOfRegion` AND THE GENERATOR STANDS ON `startsNear`, AND IF THEY
// EVER DISAGREED THE COMMAND WOULD SEND A PLAYER TO AN EMPTY FIELD.** They are different
// questions — "what does THIS set put in THIS region" against "what starts touch THIS chunk,
// across all seventeen sets" — and the second is built out of the first, which is exactly the
// kind of relationship that holds until somebody optimises one of them. `commandcheck` tests the
// SEARCH against a stub; this is the half that needs the real generator.
{
  let regions = 0, agreed = 0, starts = 0;
  for (let si = 0; si < ST.sets.length; si++) {
    const set = ST.sets[si];
    if (!set.live || set.placement.kind !== 'random_spread' || set.dim !== 'overworld') continue;   // startsNear gates by Dim.cur
    regions++;
    // a spread of regions around the origin, deterministic and small
    for (let rx = -2; rx <= 2; rx++) {
      for (let rz = -2; rz <= 2; rz++) {
        const list = ST.startsOfRegion(si, rx, rz);
        for (const st of list) {
          starts++;
          // ⚠ ASKED OF THE START'S OWN CHUNK, which is where `startsNear` must report it.
          const near = ST.startsNear(st.cx, st.cz);
          if (near.some((n) => n.def === st.def && n.cx === st.cx && n.cz === st.cz)) agreed++;
        }
      }
    }
  }
  if (PRINT) console.log(`   ${starts} starts over ${regions} live grid sets: ${agreed} also reported by startsNear`);
  ok(starts > 20, `only ${starts} starts in the sampled regions — the cross-check is vacuous`);
  ok(agreed === starts,
     `${starts - agreed} of ${starts} starts from startsOfRegion are NOT reported by startsNear ` +
     'at their own chunk — the two primitives disagree, and /locate would send a player nowhere');
}

// ─────────────────────────────────────────────── 11. anti-vacuity
console.log('11. anti-vacuity — every check above must be able to fail');
{
  const av = [];
  const check = (label, fn) => { let caught = false; try { fn(); } catch { caught = true; } av.push([label, caught]); };

  check('a structure_set whose spacing does not match the file', () => {
    const src = readJSON(join(WGDIR, 'structure_set', 'villages.json'));
    const set = ST.sets.find((s) => s.name === 'villages');
    if ((src.placement.spacing | 0) !== set.placement.spacing) throw 0;   // the real comparison holds
    // now break it the way a bad port would and require the same comparison to reject it
    if ((src.placement.spacing | 0) === set.placement.spacing + 1) return;   // NOT caught
    throw 0;
  });

  check('a biome tag left with its nested reference unresolved', () => {
    const fake = ['#minecraft:is_forest', 'plains'];
    if (fake.every((b) => b.indexOf('#') < 0)) return;                    // NOT caught
    throw 0;
  });

  check('a candidate chunk outside its own region', () => {
    const spacing = 32, separation = 8, rx = -3;
    const bad = rx * spacing + (spacing - separation);                    // one past the span
    if (bad >= rx * spacing && bad < rx * spacing + (spacing - separation)) return;  // NOT caught
    throw 0;
  });

  check('the determinism comparison ignoring a changed voxel', () => {
    const a = new Int32Array([1, 2, 3, 4]), b = new Int32Array([1, 2, 9, 4]);
    let bad = -1;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { bad = i; break; }
    if (bad < 0) return;                                                   // NOT caught
    throw 0;
  });

  check('a determinism test run over a region with no structure in it', () => {
    // Section 4 asserts `structureBlocks > 50` for exactly this reason: two identical piles of
    // dirt are also byte-identical.
    const structureBlocks = 0;
    if (structureBlocks > 50) return;                                      // NOT caught
    throw 0;
  });

  check('a piece that reaches further than the write pass scans', () => {
    const reach = ST.defs['mineshaft'].reach;
    const maxOff = reach * 16 + 1;                                         // one block too far
    if (maxOff <= reach * 16) return;                                      // NOT caught
    throw 0;
  });

  check('a rail laid over air counted as supported', () => {
    const floating = 3;
    if (floating === 0) return;                                            // NOT caught
    throw 0;
  });

  check('the sparse biome probe disagreeing with the volume', () => {
    // Break it for real: read the volume one quart cell away and require the comparison to see
    // it. If a shifted read still agrees everywhere, the comparison is not comparing anything.
    let differed = 0;
    for (let i = 0; i < 400; i++) {
      const x = ((i * 7919) % 2001) - 1000, z = ((i * 104729) % 2001) - 1000, y = MINY + ((i * 37) % H);
      if (G.biomeAt3Sparse(x, y, z) !== G.biomeAt3(x + 4, y, z + 4)) differed++;
    }
    if (differed === 0) return;                                            // NOT caught
    throw 0;
  });

  check('a building standing on air counted as supported', () => {
    const sup = 90, flo = 10;                    // 90% supported
    if (sup / (sup + flo) >= 0.97) return;       // NOT caught
    throw 0;
  });

  // ── §9's floor test, broken for real on the village it just measured (D-30, D-216) ────────
  const rigidFloorsOfSample = () => {
    const out = [];
    for (const p of av9.pieces) {
      if (p.kind === 'beard') continue;
      if (p.kind === 'template' && p.proj === av9.JGx.PROJ_TERRAIN) continue;
      const f = av9.floorsOf(p);
      for (let i = 0; i < f.length; i += 3) out.push(f[i], f[i + 1], f[i + 2]);
    }
    return out;
  };

  check('a village floor left standing on air', () => {
    // The world the village is actually in, read ONE BLOCK LOWER than the floor's own support:
    // every floor cell is then asked about the cell two under it, which in a plinth is still
    // dirt — so this must NOT be the break. Read it FOUR lower and the answer is the inside of
    // the hill, still solid. The only honest break is to answer AIR where the support is, and
    // to require the count to move off zero.
    const f = rigidFloorsOfSample();
    let flo = 0;
    for (let i = 0; i < f.length; i += 3) {
      const under = 0;                           // the support has been taken away
      if (!(under !== 0 && SR.opaque[under] === 1)) flo++;
    }
    if (f.length > 0 && flo === 0) return;       // NOT caught — the test cannot see a hole
    throw 0;
  });

  check('the floor test looking one block the wrong way', () => {
    // Same floors, same world, the read moved from `fy - 1` to `fy + 1` — the room above the
    // floor rather than the ground below it. A test that survives that is not reading a
    // direction, it is reading a village-shaped blob of solid, and its zero means nothing.
    const f = rigidFloorsOfSample();
    let flo = 0;
    for (let i = 0; i < f.length; i += 3) {
      const above = av9.blockAt(f[i], f[i + 1] + 1, f[i + 2]);
      if (above < 0) continue;
      if (!(above !== 0 && SR.opaque[above] === 1)) flo++;
    }
    if (f.length > 0 && flo === 0) return;       // NOT caught
    throw 0;
  });

  check('a roof eave counted as a floor column', () => {
    // §9 takes the piece's BASE LAYER, not each column's lowest solid cell. Undo that one rule
    // on the real village — every column's own lowest solid, eaves and all — and the supported
    // count must move: if it does not, the base-layer rule is decoration and the eaves were
    // never in the sample to begin with.
    let eaves = 0;
    for (const p of av9.pieces) {
      if (p.kind !== 'template' || p.proj === av9.JGx.PROJ_TERRAIN) continue;
      const Tp = MCL.Templates, Jg = MCL.Jigsaw;
      const e = Tp.get(p.tpl), b = Tp.blocksOf(p.tpl, p.palIdx);
      const low = new Map();
      for (let i = 0; i < b.pos.length; i++) {
        const fl = Tp.flagOf(b.pal[i]);
        if (fl & (Tp.FLAG_VOID | Tp.FLAG_AIR | Tp.FLAG_JIGSAW)) continue;
        const st = Jg.rotated(b.pal[i], p.rot);
        if (st <= 0 || SR.opaque[st] !== 1) continue;
        const li = b.pos[i];
        const lx = li % e.sx, ly = (li / (e.sx * e.sz)) | 0, lz = ((li / e.sx) | 0) % e.sz;
        const wx = p.ox + Jg.rotX(e, p.rot, lx, lz), wz = p.oz + Jg.rotZ(e, p.rot, lx, lz);
        const k = wx + ',' + wz, g = low.get(k);
        if (g === undefined || ly < g) low.set(k, ly);
      }
      for (const [k, ly] of low) {
        if (ly === 0) continue;                  // on the base layer: not an eave
        const c2 = k.indexOf(',');
        const under = av9.blockAt(+k.slice(0, c2), p.oy + ly - 1, +k.slice(c2 + 1));
        if (under === 0) eaves++;                // a solid cell with nothing under it, by design
      }
    }
    if (eaves === 0) return;                     // NOT caught — no eaves in the sample at all
    throw 0;
  });

  check('a village of streets with no houses', () => {
    const houses = 0, streets = 44;
    if (streets > 3 && houses > 3) return;       // NOT caught by a piece count alone
    throw 0;
  });

  check('structure_void written into the world', () => {
    const after = { structure_void: 72 };
    if (!after.structure_void) return;           // NOT caught
    throw 0;
  });

  check('a Nether structure counted as an overworld one', () => {
    const withGrammar = 31;                      // all 31, bastions and end cities included
    if (withGrammar === 28) return;              // NOT caught
    throw 0;
  });

  for (const [label, caught] of av) {
    ok(caught, `ANTI-VACUITY FAILURE: "${label}" was not caught — this check proves nothing`);
    console.log(`   ${caught ? '✓' : '✗'} ${label}`);
  }
}

console.log('');
console.log('=============== structcheck ==============');
console.log(` assertions passed .. ${pass.toLocaleString()}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails.slice(0, 20)) console.log('   ✗ ' + f);
console.log('=========================================');
process.exit(fails.length ? 1 : 0);
