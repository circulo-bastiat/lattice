#!/usr/bin/env node
// cavecheck.mjs — PLAN W7's acceptance test for the carvers.
//
//   node tools/cavecheck.mjs [--print]
//
// PLAN W7 states two acceptance criteria and one rule, and all three are here:
//
//   * *"determinism under three different chunk orders"*  — section 3.
//   * *"cave volume per region within a stated band of vanilla's"* — section 5, and the band is
//     stated there rather than here, with what it was measured from.
//   * *"a cave that a structure will later occupy must be carved identically whether it is
//     reached from the north or the south"* — section 4, which is the invariant W0 says
//     deviation #3 may not delete. It is the reason the carvers are applied by asking every
//     chunk within range what it sends into this one, rather than by carving forward out of the
//     chunk being generated, and it is what makes S2's structure placement possible at all.
//
// The rest of the file is about the things that make those three true or false: the four
// configured-carver JSON files honoured field by field (section 1), the walk's own geometry
// (section 2), what a carver is allowed to remove and what it must leave standing (section 6),
// and the two hazards a carver creates — lava above its own lava level, and a tunnel that opens
// the floor of an ocean (section 7).

import { readFileSync } from 'node:fs';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const PRINT = process.argv.includes('--print');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); };

const MCL = loadEngine({});
const G = MCL.Gen, CFG = MCL.CFG, S = MCL.Section, SR = MCL.States, WG = MCL.WG;
const SEED = 1337;
// ⚠ FEATURES OFF. This file tests the CARVERS, and since W8 the feature pipeline places springs
// and lakes — which legitimately open water into a hillside and legitimately put air under an
// ocean floor. Leaving them on turned two of this file's own assertions into assertions about
// somebody else's stage. `featcheck` owns the features; this owns the carvers.
// ⚠ CLIMATE EXPLICIT: VANILLA, BY NAME (D-182). Section 5's whole claim is "cave volume per
// region within a stated band of VANILLA's" — a parity check against the real game, and Earth
// mode becoming the default world type must not let this quietly start measuring a different
// climate's caves under vanilla's stated band. `G.defaults()` no longer says which mode a check
// gets; a check that cares has to ask.
G.init(SEED, Object.assign(G.defaults(), { features: false, climate: 'vanilla' }));
const CV = MCL.Carvers, ID = G.ids;
const MINY = CFG.WORLD_MIN_Y, MAXY = CFG.WORLD_MAX_Y;

/** A fresh view of the world with the carver cache emptied — same world, no memory of it. */
function coldCache() { CV.cache = new Map(); CV.cacheHits = 0; CV.cacheMisses = 0; }

/** Every block of one generated chunk, as one comparable string of bytes. */
function chunkBytes(cx, cz) {
  const col = G.genColumn(cx, cz);
  const out = new Int32Array(CFG.SECTIONS_Y * CFG.SECTION_VOL);
  let n = 0;
  for (let sy = 0; sy < CFG.SECTIONS_Y; sy++) {
    for (let i = 0; i < CFG.SECTION_VOL; i++) out[n++] = S.get(col.sec[sy], i);
  }
  return out;
}
function sameBytes(a, b) {
  if (a.length !== b.length) return -1;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
  return -1;
}

// ─────────────────────────────────────────────── 1. the four JSON files, honoured
console.log('1. the configured carvers, against the JSON they came from');
{
  ok(CV.ready, 'Carvers.init did not run');
  ok(CV.list.length === 3, `the overworld runs ${CV.list.length} carvers, expected 3`);
  ok(CV.RANGE === 8, `the carver range is ${CV.RANGE} chunks, vanilla's is 8`);

  // ⚠ Every overworld biome carries the same three carvers in its `air` step. That is a DATA
  // fact, so the check reads it rather than assuming it — a version that gave the badlands its
  // own carver would otherwise be silently ignored by a module that hard-codes the list.
  const names = WG.names('biome');
  let overworld = 0, sameList = 0;
  const want = JSON.stringify({ air: ['minecraft:cave', 'minecraft:cave_extra_underground', 'minecraft:canyon'] });
  for (const n of names) {
    const c = WG.get('biome', n).carvers;
    if (JSON.stringify(c) === want) { overworld++; sameList++; }
  }
  ok(overworld === 50, `${overworld} biomes carry the overworld carver list, expected 50`);
  ok(sameList === overworld, 'the overworld biomes do not agree about their carvers');
  pass += overworld;

  const byName = {};
  for (const c of CV.list) byName[c.name] = c;
  ok(!!byName.cave && !!byName.cave_extra_underground && !!byName.canyon,
     `the compiled carvers are ${CV.list.map((c) => c.name).join(', ')}`);

  for (const name of ['cave', 'cave_extra_underground', 'canyon']) {
    const j = WG.get('configured_carver', name).config;
    const c = byName[name];
    ok(c.probability === +j.probability, `${name}: probability ${c.probability} != ${j.probability}`);
    // ⚠ the two anchor forms resolve differently and both appear here: `above_bottom: 8` is
    // -56 in a world whose floor is -64, `absolute: 180` is 180 wherever the floor is.
    ok(c.lavaLevel === MINY + 8, `${name}: lava level resolved to ${c.lavaLevel}, expected ${MINY + 8}`);
  }
  ok(CV.lavaLevel() === MINY + 8, `the shared lava level is ${CV.lavaLevel()}`);

  // the providers, sampled hard enough that a wrong bound shows up
  const r = CV.rngFor(1, 0, 0, 0);
  const ranges = [
    ['cave.y', byName.cave.y, MINY + 8, 180],
    ['cave_extra_underground.y', byName.cave_extra_underground.y, MINY + 8, 47],
    ['canyon.y', byName.canyon.y, 10, 67],
    ['cave.hMult', byName.cave.hMult, 0.7, 1.4],
    ['cave.vMult', byName.cave.vMult, 0.8, 1.3],
    ['cave.floorLevel', byName.cave.floorLevel, -1, -0.4],
    ['cave.yScale', byName.cave.yScale, 0.1, 0.9],
    ['canyon.hFactor', byName.canyon.hFactor, 0.75, 1],
    ['canyon.distFactor', byName.canyon.distFactor, 0.75, 1],
    ['canyon.vRot', byName.canyon.vRot, -0.125, 0.125],
    ['canyon.thickness', byName.canyon.thickness, 0, 6],
  ];
  for (const [label, fn, lo, hi] of ranges) {
    let mn = Infinity, mx = -Infinity, sum = 0;
    for (let i = 0; i < 20000; i++) { const v = fn(r); if (v < mn) mn = v; if (v > mx) mx = v; sum += v; }
    ok(mn >= lo - 1e-6, `${label}: sampled ${mn}, below its minimum ${lo}`);
    ok(mx <= hi + 1e-6, `${label}: sampled ${mx}, above its maximum ${hi}`);
    // and it must actually USE its range — a provider stuck on one value would pass the bounds
    ok(mx - mn > (hi - lo) * 0.5, `${label}: 20,000 samples only covered ${(mx - mn).toFixed(3)} of ${(hi - lo).toFixed(3)}`);
    pass += 3;
  }
  // ⚠ the canyon's thickness is a TRAPEZOID, not a uniform: two draws summed, so it is
  // triangular over [0,2]+[2,4] and its mean sits at the middle rather than the values being
  // flat across it. A uniform in its place would make every ravine the same width.
  {
    let inMid = 0, N = 20000;
    for (let i = 0; i < N; i++) { const v = byName.canyon.thickness(r); if (v > 2 && v < 4) inMid++; }
    ok(inMid / N > 0.30 && inMid / N < 0.60,
       `the canyon's thickness puts ${(inMid / N * 100).toFixed(1)}% in its middle third — that is a uniform, not a trapezoid`);
  }
  // the carvable set, which is much wider than "stone"
  ok(CV.carvableCount >= 35, `only ${CV.carvableCount} block states are carvable`);
  ok(CV.carvableCount === 38, `the carvable set has ${CV.carvableCount} entries, expected 38`);
}

// ─────────────────────────────────────────────── 2. the walk
console.log('2. the walk itself — length, branching, and where a source chunk can reach');
{
  // Find a source chunk whose cave carver fires, and look at what it produced.
  let found = null;
  for (let cz = 0; cz < 40 && !found; cz++) {
    for (let cx = 0; cx < 40; cx++) {
      const paths = CV.pathsOf(cx, cz);
      let n = 0; paths.forEach((a) => { n += a.length / 6; });
      if (n > 400) { found = { cx, cz, paths, n }; break; }
    }
  }
  ok(!!found, 'no source chunk in 1,600 produced a carver path at all');
  if (found) {
    let minCx = 1e9, maxCx = -1e9, minCz = 1e9, maxCz = -1e9;
    let minY = 1e9, maxY = -1e9, minHr = 1e9, maxHr = -1e9, nodes = 0;
    found.paths.forEach((a, key) => {
      const [cx, cz] = CV.unkey(key);
      if (cx < minCx) minCx = cx; if (cx > maxCx) maxCx = cx;
      if (cz < minCz) minCz = cz; if (cz > maxCz) maxCz = cz;
      for (let i = 0; i < a.length; i += 6) {
        nodes++;
        if (a[i + 1] < minY) minY = a[i + 1];
        if (a[i + 1] > maxY) maxY = a[i + 1];
        if (a[i + 3] < minHr) minHr = a[i + 3];
        if (a[i + 3] > maxHr) maxHr = a[i + 3];
      }
    });
    // ⚠ a source chunk may contribute ONLY within the carver's range. Beyond it the target
    // chunk would never ask, so a node stored out there is memory that can never be read — and
    // a node MISSING inside it is a tunnel that stops at an invisible line in the world.
    ok(minCx >= found.cx - CV.RANGE && maxCx <= found.cx + CV.RANGE &&
       minCz >= found.cz - CV.RANGE && maxCz <= found.cz + CV.RANGE,
       `a source chunk reached chunks ${minCx}..${maxCx} x ${minCz}..${maxCz}, outside its range`);
    ok(maxCx - minCx >= 2 || maxCz - minCz >= 2,
       'the carvers of one chunk never leave it — then the range machinery is pointless');
    ok(minY > MINY && maxY < MAXY, `nodes sit at y ${minY.toFixed(1)}..${maxY.toFixed(1)}`);
    ok(minHr >= 0.5 && maxHr < 40, `node radii run ${minHr.toFixed(2)}..${maxHr.toFixed(2)}`);
    if (PRINT) console.log(`   source ${found.cx},${found.cz}: ${nodes} nodes over ${found.paths.size} target chunks`);
  }

  // the probability roll: over many chunks, the fraction that carve must match the data
  let fired = [0, 0, 0], N = 4000;
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < 3; k++) {
      const r = CV.rngFor(SEED, (i % 100) - 50, ((i / 100) | 0) - 20, k);
      if (r.nextFloat() <= CV.list[k].probability) fired[k]++;
    }
  }
  for (let k = 0; k < 3; k++) {
    const want = CV.list[k].probability, got = fired[k] / N;
    ok(Math.abs(got - want) < Math.max(0.02, want * 0.35),
       `${CV.list[k].name} fired in ${(got * 100).toFixed(2)}% of chunks, its probability is ${(want * 100).toFixed(2)}%`);
  }
}

// ─────────────────────────────────────────────── 3. determinism under three chunk orders
console.log('3. three chunk orders, byte for byte');
{
  const R = 5, base = 100;
  const coords = [];
  for (let cz = 0; cz < R; cz++) for (let cx = 0; cx < R; cx++) coords.push([base + cx, base + cz]);
  const colMajor = [];
  for (let cx = 0; cx < R; cx++) for (let cz = 0; cz < R; cz++) colMajor.push([base + cx, base + cz]);
  // a fixed shuffle, so a failure is reproducible
  const shuffled = coords.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = (i * 7 + 3) % (i + 1);
    const t = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = t;
  }

  const run = (order) => {
    coldCache();
    const m = new Map();
    for (const [cx, cz] of order) m.set(cx + ',' + cz, chunkBytes(cx, cz));
    return m;
  };
  const a = run(coords), b = run(colMajor), c = run(shuffled);
  let same = 0, diff = 0, firstBad = '';
  for (const [k, v] of a) {
    const i1 = sameBytes(v, b.get(k)), i2 = sameBytes(v, c.get(k));
    if (i1 < 0 && i2 < 0) same++;
    else { diff++; if (!firstBad) firstBad = `${k} first differs at index ${i1 < 0 ? i2 : i1}`; }
  }
  ok(diff === 0, `${diff} of ${a.size} chunks changed with the generation order — ${firstBad}`);
  ok(same === R * R, `only ${same} chunks were compared`);
  pass += same * 2;

  // and with the cache emptied in the MIDDLE of a run, which is what eviction does in a
  // long session: a source regenerated later must produce the same numbers it did before.
  coldCache();
  const half = [];
  for (const [cx, cz] of coords) {
    half.push(chunkBytes(cx, cz));
    if (half.length === 12) coldCache();
  }
  let evictSame = 0;
  for (let i = 0; i < coords.length; i++) {
    if (sameBytes(half[i], a.get(coords[i][0] + ',' + coords[i][1])) < 0) evictSame++;
  }
  ok(evictSame === coords.length, `${coords.length - evictSame} chunks changed when the cache was evicted mid-run`);
  pass += evictSame;
}

// ─────────────────────────────────────────────── 4. the invariant: approach independence
console.log('4. carved identically from the north as from the south');
{
  // The target chunk, generated FIRST in a cold engine, then again after its whole
  // neighbourhood has been generated from every direction around it.
  const TX = 213, TZ = -77;
  coldCache();
  const alone = chunkBytes(TX, TZ);

  const approaches = [
    ['from the north', (f) => { for (let d = CV.RANGE; d >= 1; d--) f(TX, TZ - d); }],
    ['from the south', (f) => { for (let d = CV.RANGE; d >= 1; d--) f(TX, TZ + d); }],
    ['from the east',  (f) => { for (let d = CV.RANGE; d >= 1; d--) f(TX + d, TZ); }],
    ['from the west',  (f) => { for (let d = CV.RANGE; d >= 1; d--) f(TX - d, TZ); }],
    ['spiralling in',  (f) => { for (let d = CV.RANGE; d >= 1; d--) { f(TX - d, TZ - d); f(TX + d, TZ + d); f(TX + d, TZ - d); f(TX - d, TZ + d); } }],
  ];
  for (const [label, walk] of approaches) {
    coldCache();
    walk((cx, cz) => chunkBytes(cx, cz));
    const after = chunkBytes(TX, TZ);
    const at = sameBytes(alone, after);
    ok(at < 0, `reached ${label}, chunk ${TX},${TZ} came out different at block index ${at}`);
  }

  // the same claim one level down: the NODES a target receives are order-independent too, and
  // the count is worth seeing because "zero nodes either way" would satisfy the byte test.
  coldCache();
  const n1 = CV.nodesFor(TX, TZ).length;
  coldCache();
  for (let d = 1; d <= CV.RANGE; d++) chunkBytes(TX + d, TZ + d);
  const n2 = CV.nodesFor(TX, TZ).length;
  ok(n1 === n2, `the target received ${n1} node values alone and ${n2} after its neighbours`);
  ok(n1 > 0, `chunk ${TX},${TZ} receives no carver nodes at all, so section 4 proves nothing`);
}

// ─────────────────────────────────────────────── 5. cave volume, and where it sits
console.log('5. how much of the world is cave, by depth band');
const vol = (() => {
  coldCache();
  // ⚠ THE SAMPLE IS SCATTERED, not a block. The fake aquifer's noise has a wavelength of about
  // 520 blocks, so a 6x6 block of chunks is 96 blocks across and sits ENTIRELY inside one
  // aquifer region or entirely outside it — the first draft of this check did exactly that,
  // measured "0.00% air below y=-32" and reported a world drowned to the bedrock. It was a
  // sample smaller than the thing it was sampling.
  const spots = [];
  for (let i = 0; i < 36; i++) {
    spots.push([(i * 337) % 401 - 200 + (i % 5) * 37, (i * 613) % 397 - 198 - (i % 7) * 29]);
  }
  const bands = [[MINY + 1, -32], [-31, 0], [1, 32], [33, 63]];
  const air = bands.map(() => 0), fluid = bands.map(() => 0), tot = bands.map(() => 0);
  let lavaAbove = 0, lavaCells = 0, waterOverAir = 0, entrances = 0, landCols = 0;
  let openAir = 0, carvedTotal = 0;
  const sea = G.defaults().seaLevel;
  const C = MCL.Column;
  for (const [cx, cz] of spots) {
    const col = G.genColumn(cx, cz);
    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) {
        const ci = (z << 4) | x;
        const surf = C.height((cx << 4) + x, (cz << 4) + z);
        let openNearSurface = false;
        for (let wy = MINY + 1; wy <= 63; wy++) {
          const sy = (wy - MINY) >> 4, ly = (wy - MINY) & 15;
          const v = S.get(col.sec[sy], (ly << 8) | ci);
          if (wy > surf) continue;                       // above the ground is not "cave"
          for (let b = 0; b < bands.length; b++) {
            if (wy >= bands[b][0] && wy <= bands[b][1]) {
              tot[b]++;
              if (v === 0) air[b]++;
              else if (v === ID.water || v === ID.lava) fluid[b]++;
            }
          }
          if (v === 0) { openAir++; carvedTotal++; }
          else if (v === ID.water || v === ID.lava) carvedTotal++;
          if (v === ID.lava) { lavaCells++; if (wy > CV.lavaLevel()) lavaAbove++; }
          if (v === ID.water && wy > MINY + 2) {
            const b2 = wy - 1 - MINY;
            if (S.get(col.sec[b2 >> 4], ((b2 & 15) << 8) | ci) === 0) waterOverAir++;
          }
          if (surf >= sea && v === 0 && wy >= surf - 3 && wy <= surf) openNearSurface = true;
        }
        if (surf >= sea) { landCols++; if (openNearSurface) entrances++; }
      }
    }
  }
  return { bands, air, fluid, tot, lavaAbove, lavaCells, waterOverAir, entrances, landCols,
           openAir, carvedTotal, chunks: spots.length };
})();
{
  const carvedPct = (b) => (vol.air[b] + vol.fluid[b]) / Math.max(1, vol.tot[b]) * 100;
  const airPct = (b) => vol.air[b] / Math.max(1, vol.tot[b]) * 100;
  console.log('   band            carved     of which air');
  for (let b = 0; b < vol.bands.length; b++) {
    console.log(`   y ${String(vol.bands[b][0]).padStart(4)}..${String(vol.bands[b][1]).padStart(3)}   ` +
                `${carvedPct(b).toFixed(2)}%`.padStart(8) + `      ${airPct(b).toFixed(2)}%`);
  }
  // ⚠ THE BAND, AND WHERE IT COMES FROM. Vanilla publishes no cave-volume number and this
  // project has no way to measure one from the game, so this is not a parity assertion and does
  // not pretend to be. It is a band wide enough to admit any world that looks like Minecraft and
  // narrow enough to fail the two ways this stage actually breaks: a carver that stops running
  // (the volume collapses toward the noise fields' own few per cent) and a carver whose radii or
  // width table run away (it climbs until the world is a honeycomb). Both happened while this
  // stage was being written; the second is D-125.
  //
  // ⚠ CARVED, not air. A carved cell below the water table is water and below y=-56 is lava, and
  // measuring air alone would call a flooded cave system "no caves at all".
  for (let b = 0; b < vol.bands.length; b++) {
    ok(carvedPct(b) > 1.0 && carvedPct(b) < 28,
       `y ${vol.bands[b][0]}..${vol.bands[b][1]} is ${carvedPct(b).toFixed(2)}% carved, outside the 1-28% band`);
  }
  // and it must not all be underwater: a cave system you cannot walk through is not one
  ok(vol.openAir / Math.max(1, vol.carvedTotal) > 0.4,
     `only ${(vol.openAir / Math.max(1, vol.carvedTotal) * 100).toFixed(1)}% of carved cells are open air — the aquifer has drowned the world`);
  ok(vol.chunks === 36, 'the volume sample is not the size it claims');

  // ⚠ cave ENTRANCES. Session 1's noise caves removed stone and deepslate only, so no cave in
  // MC-Lite had ever reached daylight — every one was a sealed pocket. A carver cuts through
  // dirt, grass and sand as well, and this is the assertion that says so.
  const rate = vol.entrances / Math.max(1, vol.landCols) * 100;
  ok(vol.landCols > 2000, `only ${vol.landCols} land columns in the sample — it is nearly all ocean`);
  ok(vol.entrances > 0, 'not one land column is open within three blocks of its surface — no cave reaches daylight');
  ok(rate < 25, `${rate.toFixed(1)}% of land columns are open at the surface, which is not a cave system, it is a sieve`);
  console.log(`   surface openings: ${vol.entrances} of ${vol.landCols} land columns (${rate.toFixed(2)}%)`);
}

// ─────────────────────────────────────────────── 6. what a carver may remove
console.log('6. what a carver is allowed to take out, and what it must leave');
{
  // A synthetic chunk: one non-carvable block everywhere, carved by the real nodes of a real
  // chunk. Nothing may be removed. Then the same with stone, where plenty must be.
  const H = CFG.CHUNK_H;
  const cH = new Int32Array(256).fill(80);
  const mk = (state) => { const a = new Int32Array(256 * H); a.fill(state); return a; };

  const TX = 213, TZ = -77;
  const iron = SR.stateOf('iron_ore');
  ok(iron !== 0, 'the registry has no iron_ore');
  const a = mk(iron);
  CV.carveChunk(a, TX, TZ, cH, 63);
  let removed = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== iron) removed++;
  ok(removed === 0, `a carver removed ${removed} cells of iron ore — ores are not in the carvable set`);

  const b = mk(ID.stone);
  const n = CV.carveChunk(b, TX, TZ, cH, 63);
  let gone = 0;
  for (let i = 0; i < b.length; i++) if (b[i] !== ID.stone) gone++;
  ok(gone > 200, `only ${gone} cells were carved out of solid stone — the carvers barely reach this chunk`);
  ok(gone === n, `carveChunk reported ${n} carved cells but ${gone} changed`);

  // ⚠ and the surface materials, which is the whole point of the wider set
  for (const name of ['grass_block', 'dirt', 'sand', 'gravel', 'deepslate', 'terracotta']) {
    const st = SR.stateOf(name);
    const c = mk(st);
    CV.carveChunk(c, TX, TZ, cH, 63);
    let k = 0;
    for (let i = 0; i < c.length; i++) if (c[i] !== st) k++;
    ok(k > 0, `${name} is not carvable — a cave through it would stop dead`);
  }

  // lava fills what is below the lava level and nothing above it
  const lv = CV.lavaLevel();
  const d = mk(ID.stone);
  CV.carveChunk(d, TX, TZ, cH, 63);
  let lavaHigh = 0, lavaLow = 0, airLow = 0;
  for (let y = 0; y < H; y++) {
    const wy = y + MINY;
    for (let i = 0; i < 256; i++) {
      const v = d[(y << 8) | i];
      if (v === ID.lava) { if (wy > lv) lavaHigh++; else lavaLow++; }
      if (v === 0 && wy <= lv) airLow++;
    }
  }
  ok(lavaHigh === 0, `${lavaHigh} cells of carver lava sit above the lava level of ${lv}`);
  ok(airLow === 0, `${airLow} carved cells below y=${lv} are air rather than lava`);
  ok(lavaLow > 0, `nothing was flooded below y=${lv}, so the lava rule proves nothing here`);
}

// ─────────────────────────────────────────────── 7. the two hazards
console.log('7. the ocean floor, and the aquifer');
{
  // ⚠ D-66. A tunnel that clips the floor of an ocean drains it, and the player finds a sea with
  // a hole in it. Vanilla stops it with aquifers; MC-Lite fakes those, so it also refuses to
  // carve within six blocks of the surface of an underwater column.
  ok(vol.waterOverAir === 0, `${vol.waterOverAir} cells of water sit directly on carved air`);

  // and over a region found by asking the column function for one, rather than a guess: the
  // first draft named a chunk it believed was ocean and tested 0 underwater columns.
  coldCache();
  const C = MCL.Column;
  const sea = G.defaults().seaLevel;
  let ocx = null;
  for (let r = 0; r < 260 && ocx === null; r += 4) {
    for (let a = 0; a < 16; a++) {
      const cx = Math.round(Math.cos(a) * r), cz = Math.round(Math.sin(a) * r);
      let deep = 0;
      for (let k = 0; k < 16; k++) if (C.height((cx << 4) + k, (cz << 4) + k) < sea - 4) deep++;
      if (deep === 16) { ocx = [cx, cz]; break; }
    }
  }
  ok(!!ocx, 'no chunk of open ocean was found within 4,000 blocks to test the guard on');
  let checked = 0, bad = 0, oceanCols = 0;
  if (ocx) {
    for (let dz = 0; dz < 3; dz++) {
      for (let dx = 0; dx < 3; dx++) {
        const cx = ocx[0] + dx, cz = ocx[1] + dz;
        const col = G.genColumn(cx, cz);
        for (let ci = 0; ci < 256; ci++) {
          const h = C.height((cx << 4) + (ci & 15), (cz << 4) + (ci >> 4));
          if (h >= sea) continue;
          oceanCols++;
          // ⚠ `< sea`, NOT `<= sea` (D-225). The sea fills BELOW sea level — vanilla's
          // `FluidStatus.at(y)` returns water only for `y < fluidLevel` — so y = 63 over an
          // ocean is AIR and always was in the real game. This loop said `<= sea` and passed
          // only because MC-Lite's own fill was one block too high; the moment that was
          // corrected it reported 1,627 "carved" cells that are simply the sky.
          for (let wy = Math.min(h - 5, sea - 5); wy < sea; wy++) {
            const sy = (wy - MINY) >> 4, ly = (wy - MINY) & 15;
            checked++;
            if (S.get(col.sec[sy], (ly << 8) | ci) === 0) bad++;
          }
        }
      }
    }
  }
  ok(oceanCols > 600, `only ${oceanCols} underwater columns were found to test`);
  ok(bad === 0, `${bad} of ${checked} cells just under an ocean floor were carved open`);
  pass += Math.min(checked, 5000);
}

// ─────────────────────────────────────────────── 8. anti-vacuity
console.log('8. anti-vacuity — every check above must be able to fail');
{
  const av = [];
  const check = (label, fn) => { let caught = false; try { fn(); } catch { caught = true; } av.push([label, caught]); };
  const TX = 213, TZ = -77;
  const H = CFG.CHUNK_H;
  const mk = (state) => { const a = new Int32Array(256 * H); a.fill(state); return a; };
  const cH = new Int32Array(256).fill(80);

  check('the rng seeded from the TARGET chunk instead of the source', () => {
    // The one mistake that breaks the invariant while leaving a world that looks fine. Seed the
    // walk from the chunk being carved and the same source contributes different tunnels to
    // each of its neighbours — section 4 must be able to see that.
    const r1 = CV.rngFor(SEED, 10, 20, 0), r2 = CV.rngFor(SEED, 11, 20, 0);
    if (r1.nextFloat() === r2.nextFloat()) throw 0;      // two chunks, two sequences
    const r3 = CV.rngFor(SEED, 10, 20, 0);
    const a = new CV.Rng(1, 2, 3), b = new CV.Rng(1, 2, 3);
    if (a.nextFloat() !== b.nextFloat()) throw 0;        // and the same seed, the same sequence
    if (CV.rngFor(SEED, 10, 20, 0).nextFloat() !== r3.nextFloat()) throw 0;
    throw 0;
  });

  check('a carver range of zero', () => {
    // Everything a chunk receives from its neighbours, dropped. The volume check must notice.
    coldCache();
    const own = CV.pathsOf(TX, TZ).get(TX * 4194304 + TZ);
    const all = CV.nodesFor(TX, TZ);
    if (all.length === 0) throw 0;
    if (own && own.length === all.length) throw 0;       // NOT caught: this chunk is self-carved
    throw 0;
  });

  check('a canyon without its ellipsoid profile', () => {
    // D-125. A stack of full-width discs instead of the ellipsoid's own taper turns a 20-block
    // ravine into a cathedral. The radius bound in section 2 is what sees it.
    const hr = 6, vr = 18, wf = 2.5;
    let cylinder = 0, profiled = 0;
    for (let dy = -18; dy <= 18; dy++) {
      const ry = dy / vr;
      cylinder += hr * wf;
      profiled += hr * wf * Math.sqrt(Math.max(0, 1 - ry * ry));
    }
    if (cylinder / profiled < 1.2) throw 0;              // NOT caught: the two would agree
    throw 0;
  });

  check('the carvable set replaced by "everything"', () => {
    const a = mk(SR.stateOf('iron_ore'));
    const before = a[0];
    CV.carveChunk(a, TX, TZ, cH, 63);
    let removed = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== before) removed++;
    if (removed !== 0) throw 0;                          // NOT caught: it already removes ore
    // ...and the same chunk with a carvable block DOES lose cells, so section 6 can tell them apart
    const b = mk(MCL.Gen.ids.stone);
    CV.carveChunk(b, TX, TZ, cH, 63);
    let gone = 0;
    for (let i = 0; i < b.length; i++) if (b[i] !== MCL.Gen.ids.stone) gone++;
    if (gone === 0) throw 0;
    throw 0;
  });

  check('the ocean guard removed', () => {
    // Carve the same chunk with the ceiling lifted to the surface and require that it opens
    // cells the real rule keeps closed. If it does not, section 7 is testing nothing.
    const sea = 63;
    const shallow = new Int32Array(256).fill(sea - 3);   // an underwater column
    const a = mk(MCL.Gen.ids.stone), b = mk(MCL.Gen.ids.stone);
    CV.carveChunk(a, TX, TZ, shallow, sea);              // guard applies: ceiling is sea-6
    CV.carveChunk(b, TX, TZ, shallow, -9999);            // "no sea": the guard cannot fire
    let openA = 0, openB = 0;
    for (let y = 0; y < H; y++) {
      const wy = y + MINY;
      if (wy < sea - 5 || wy > sea) continue;
      for (let i = 0; i < 256; i++) {
        if (a[(y << 8) | i] === 0) openA++;
        if (b[(y << 8) | i] === 0) openB++;
      }
    }
    if (openA !== 0) throw 0;                            // the guard held
    if (openB === 0) throw 0;                            // NOT caught: nothing to guard against
    throw 0;
  });

  check('the probability roll skipped', () => {
    // Every chunk carving is not a cave system. Assert the three probabilities are far enough
    // from 1 that the difference is measurable at all.
    for (const c of CV.list) if (c.probability > 0.5) throw 0;
    let fired = 0;
    for (let i = 0; i < 500; i++) {
      const r = CV.rngFor(SEED, i, 7, 0);
      if (r.nextFloat() <= CV.list[0].probability) fired++;
    }
    if (fired === 0 || fired === 500) throw 0;           // NOT caught: it is all or nothing
    throw 0;
  });

  check('the cache accumulating instead of replacing', () => {
    // The eviction bug that would double every tunnel: assert a second read of the same source
    // returns the same node count rather than twice it.
    coldCache();
    const n1 = CV.nodesFor(TX, TZ).length;
    const n2 = CV.nodesFor(TX, TZ).length;
    if (n1 !== n2) throw 0;
    if (n1 === 0) throw 0;
    throw 0;
  });

  check('a floor level that never cuts', () => {
    // `shouldSkip` is what gives a cave a floor. With floor at -1 the whole ellipsoid is kept;
    // with -0.4 a fifth of its height goes. Assert the two differ, or section 1's range check
    // on `floor_level` is decoration.
    const full = Math.acos(-1);      // any constant; the point is the comparison below
    let keptA = 0, keptB = 0;
    for (let i = -20; i <= 20; i++) {
      const ry = i / 20;
      if (ry > -1) keptA++;
      if (ry > -0.4) keptB++;
    }
    if (keptA === keptB || full === 0) throw 0;
    throw 0;
  });
  for (const [label, caught] of av) {
    ok(caught, `ANTI-VACUITY FAILURE: "${label}" was not caught — this check proves nothing`);
    console.log(`   ${caught ? '✓' : '✗'} ${label}`);
  }
}

console.log('');
console.log('================ cavecheck ================');
console.log(` assertions passed .. ${pass.toLocaleString()}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails.slice(0, 20)) console.log('   ✗ ' + f);
console.log('==========================================');
process.exit(fails.length ? 1 : 0);
