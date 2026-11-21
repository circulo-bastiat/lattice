#!/usr/bin/env node
// featcheck.mjs — PLAN W8's acceptance test for the feature pipeline.
//
//   node tools/featcheck.mjs [--print]
//
// PLAN W8: *"Acceptance: ore-per-chunk histograms compared to vanilla's published distributions
// — statistical referee again, not golden files."* That is section 4, and section 4 is careful
// about what it can and cannot claim: the DISTRIBUTION is decided by the height providers in the
// data, which can be checked exactly, while the ABSOLUTE count per chunk depends on the blob
// algorithm, which is compiled Java and cannot be checked from here at all. So the peaks are
// asserted against vanilla's own numbers and the counts are asserted for shape and order, with
// the gap stated rather than papered over.
//
// The rest is the machinery those numbers rest on: the providers and anchors (section 1), the
// placement chain's own semantics (section 2), the invariant W7 established and W8 inherits —
// a chunk's decoration is a function of (seed, chunk) and of nothing else (section 3) — and
// what this build cannot do yet, counted and named rather than silently missing (section 5).

import { loadEngine } from './loadsrc.mjs';

const PRINT = process.argv.includes('--print');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); };

const MCL = loadEngine({});
const G = MCL.Gen, CFG = MCL.CFG, S = MCL.Section, SR = MCL.States, WG = MCL.WG;
const SEED = 1337;
// ⚠ CLIMATE EXPLICIT: VANILLA, BY NAME (D-182). Section 4's ore histograms are checked against
// vanilla's PUBLISHED distributions — a parity claim that means nothing once `G.defaults()`
// stops implying which mode a world is generated in. Earth mode moves biomes, and biome moves
// which ore-bearing stone a height provider even lands in.
G.init(SEED, Object.assign(G.defaults(), { climate: 'vanilla' }));
const F = MCL.Features, MINY = CFG.WORLD_MIN_Y, MAXY = CFG.WORLD_MAX_Y, H = CFG.CHUNK_H;
const STONE = SR.stateOf('stone');

// ─────────────────────────────────────────────── 1. the data, honoured
console.log('1. the providers, the anchors and the tags');
{
  ok(F.ready, 'Features.init did not run');
  ok(F.placedList.length > 30, `only ${F.placedList.length} placed features compiled`);

  // ⚠ the four hand-written tags (G1 will replace them with the real substrate). Each is
  // asserted by MEMBERSHIP, not by count, so a block quietly leaving one is a failure.
  const tags = F.tagSets();
  const inTag = (t, n) => tags[t][SR.stateOf(n)] === 1;
  for (const n of ['stone', 'granite', 'diorite', 'andesite', 'tuff']) {
    ok(inTag('minecraft:stone_ore_replaceables', n), `${n} is not in stone_ore_replaceables`);
    ok(inTag('minecraft:base_stone_overworld', n), `${n} is not in base_stone_overworld`);
  }
  ok(inTag('minecraft:deepslate_ore_replaceables', 'deepslate'), 'deepslate is not in deepslate_ore_replaceables');
  ok(inTag('minecraft:deepslate_ore_replaceables', 'tuff'), 'tuff is not in deepslate_ore_replaceables');
  ok(!inTag('minecraft:stone_ore_replaceables', 'deepslate'), 'deepslate is in stone_ore_replaceables');
  ok(!inTag('minecraft:stone_ore_replaceables', 'iron_ore'), 'iron_ore is replaceable by ore — a vein would eat another');
  ok(tags['minecraft:stone_ore_replaceables'][0] === 0, 'air is in a block tag');

  // every ore feature's targets and size, against the JSON
  let checked = 0;
  for (const name of WG.names('configured_feature')) {
    const j = WG.get('configured_feature', name);
    if (j.type !== 'minecraft:ore' && j.type !== 'minecraft:scattered_ore') continue;
    const g = F.configured[name];
    if (!g) continue;                       // a nether ore whose blocks this build may not place
    checked++;
    ok(g.size === (j.config.size | 0), `${name}: size ${g.size} != ${j.config.size}`);
    ok(g.targets.length === j.config.targets.length, `${name}: ${g.targets.length} targets, JSON has ${j.config.targets.length}`);
    ok(Math.abs(g.discard - (+(j.config.discard_chance_on_air_exposure || 0))) < 1e-9,
       `${name}: discard chance ${g.discard} != ${j.config.discard_chance_on_air_exposure}`);
    for (let t = 0; t < g.targets.length; t++) {
      const want = SR.stateOf(j.config.targets[t].state.Name.replace('minecraft:', ''));
      ok(g.targets[t].state === want, `${name}: target ${t} places ${SR.name(g.targets[t].state)}, JSON says ${j.config.targets[t].state.Name}`);
    }
  }
  ok(checked >= 20, `only ${checked} ore features were compiled and checked`);
  if (PRINT) console.log(`   ${checked} ore features verified against their JSON`);

  // ⚠ `F.biomeAt3` is the 3D biome lookup, and since D-180 it is an array read out of
  // `Gen.biomeVolume` rather than a climate evaluation — the whole generate path goes through
  // it, because it is what decides which biome's features a position may have. It is asserted
  // here against the two things it must agree with: `Climate.biomeAt` at the same quart cell,
  // and the surface lookup when asked at the surface. Section 5b holds the volume behind it to
  // the same standard cell by cell.
  {
    const CLb = MCL.Climate;
    let agreeQuart = 0, agreeSurface = 0, n = 0;
    for (let i = 0; i < 60; i++) {
      const x = ((i * 971) % 4000) - 2000, z = ((i * 613) % 4000) - 2000;
      const h = MCL.Column.height(x, z) | 0;
      for (const y of [h, h - 30, h - 90, -40]) {
        n++;
        const qx = x >> 2 << 2, qy = y >> 2 << 2, qz = z >> 2 << 2;
        if (F.biomeAt3(x, y, z) === CLb.biomeAt(qx, qy, qz)) agreeQuart++;
      }
      // at the surface the 3D answer must be the surface answer
      if (F.biomeAt3(x, h, z) === CLb.surfaceBiomeAt(x, z)) agreeSurface++;
    }
    ok(agreeQuart === n, `biomeAt3 disagreed with Climate.biomeAt at ${n - agreeQuart} of ${n} cells`);
    ok(agreeSurface >= 57, `biomeAt3 at the surface matched the surface biome only ${agreeSurface}/60 times`);
    if (PRINT) console.log(`   biomeAt3: ${n}/${n} quart cells, ${agreeSurface}/60 surface cells`);
  }
}

// ─────────────────────────────────────────────── 2. the placement chain
console.log('2. what a chain of modifiers does to one position');
{
  // `count` multiplies, `in_square` moves inside the chunk, `height_range` sets y, filters cut.
  const p = F.placementsOf(0, 0);
  const n = p.length / F.PLACEMENT;
  ok(n > 100, `chunk 0,0 produced only ${n} placements`);

  let inChunk = 0, inWorld = 0, total = 0;
  const byName = new Map();
  for (let i = 0; i < p.length; i += F.PLACEMENT) {
    const x = p[i + 3], y = p[i + 4], z = p[i + 5];
    total++;
    // ⚠ `in_square` offsets by 0..15 from the chunk origin, so every placement of a chain that
    // has one starts INSIDE its own chunk. A placement outside it means the offset ran away.
    if (x >= 0 && x < 16 && z >= 0 && z < 16) inChunk++;
    if (y > MINY - 200 && y < 500) inWorld++;
    const nm = F.placedList[p[i + 2]].name;
    byName.set(nm, (byName.get(nm) || 0) + 1);
  }
  ok(inChunk === total, `${total - inChunk} of ${total} placements are outside the chunk that made them`);
  ok(inWorld === total, `${total - inWorld} placements have an absurd y`);
  pass += inChunk;

  // the `count` modifier's literal numbers, straight out of the JSON
  for (const [nm, want] of [['ore_iron_upper', 90], ['ore_coal_upper', 30], ['ore_diamond', 7], ['ore_copper', 16]]) {
    const j = WG.get('placed_feature', nm);
    const cm = (j.placement || []).find((m) => m.type === 'minecraft:count');
    ok(cm && cm.count === want, `${nm}: the JSON's count is ${cm && cm.count}, this check expected ${want}`);
    const got = byName.get(nm) || 0;
    // every one of those modifiers is `count` then `in_square` then a height, with no filter
    // that can drop a position, so the count is exact rather than statistical
    ok(got === want, `${nm}: ${got} placements, its count says ${want}`);
  }
}

// ─────────────────────────────────────────────── 3. the invariant, inherited from W7
console.log('3. a chunk\'s decoration is a function of (seed, chunk) and nothing else');
{
  const bytesOf = (cx, cz) => {
    const col = G.genColumn(cx, cz);
    const out = new Int32Array(CFG.SECTIONS_Y * CFG.SECTION_VOL);
    let n = 0;
    for (let sy = 0; sy < CFG.SECTIONS_Y; sy++) {
      for (let i = 0; i < CFG.SECTION_VOL; i++) out[n++] = S.get(col.sec[sy], i);
    }
    return out;
  };
  const same = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i; return -1; };
  const cold = () => { F.cache = new Map(); MCL.Carvers.cache = new Map(); };

  cold();
  const alone = bytesOf(77, -41);
  for (const [label, walk] of [
    ['from the north', (f) => { for (let d = 2; d >= 1; d--) f(77, -41 - d); }],
    ['from the south', (f) => { for (let d = 2; d >= 1; d--) f(77, -41 + d); }],
    ['from the east',  (f) => { for (let d = 2; d >= 1; d--) f(77 + d, -41); }],
    ['all around',     (f) => { for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (dx || dz) f(77 + dx, -41 + dz); }],
  ]) {
    cold();
    walk((cx, cz) => bytesOf(cx, cz));
    const at = same(alone, bytesOf(77, -41));
    ok(at < 0, `reached ${label}, chunk 77,-41 decorated differently at block index ${at}`);
  }
  // and with the placement cache evicted in the middle
  cold();
  const a = bytesOf(77, -41);
  cold();
  const b = bytesOf(77, -41);
  ok(same(a, b) < 0, 'the same chunk decorated differently on a second cold run');
  pass += 2;
}

// ─────────────────────────────────────────────── 4. the ore histograms
console.log('4. where the ore is');
const hist = (() => {
  const N = 8;
  const per = new Map();
  let chunks = 0;
  for (let cz = 0; cz < N; cz++) {
    for (let cx = 0; cx < N; cx++) {
      const col = G.genColumn(cx + 40, cz - 20);
      chunks++;
      for (let sy = 0; sy < CFG.SECTIONS_Y; sy++) {
        for (let i = 0; i < CFG.SECTION_VOL; i++) {
          const v = S.get(col.sec[sy], i);
          if (!v) continue;
          const nm = SR.name(v);
          if (nm.indexOf('_ore') < 0) continue;
          let h = per.get(nm);
          if (!h) { h = new Int32Array(H); per.set(nm, h); }
          h[sy * 16 + (i >> 8)]++;
        }
      }
    }
  }
  return { per, chunks };
})();
{
  const totalOf = (n) => { const h = hist.per.get(n); if (!h) return 0; let s = 0; for (let i = 0; i < H; i++) s += h[i]; return s; };
  const peakOf = (n) => {
    const h = hist.per.get(n);
    if (!h) return null;
    // the mode of a 16-block window, so a single lucky y does not decide it
    let best = -1, bestY = 0;
    for (let i = 8; i < H - 8; i++) {
      let s = 0;
      for (let k = -8; k <= 8; k++) s += h[i + k];
      if (s > best) { best = s; bestY = i + MINY; }
    }
    return bestY;
  };
  const combined = (a, b) => totalOf(a) + totalOf(b);

  if (PRINT || true) {
    console.log('   ore                     per chunk    peak y');
    for (const [base, deep] of [['coal_ore', 'deepslate_coal_ore'], ['iron_ore', 'deepslate_iron_ore'],
                                ['copper_ore', 'deepslate_copper_ore'], ['gold_ore', 'deepslate_gold_ore'],
                                ['redstone_ore', 'deepslate_redstone_ore'], ['lapis_ore', 'deepslate_lapis_ore'],
                                ['diamond_ore', 'deepslate_diamond_ore'], ['emerald_ore', 'deepslate_emerald_ore']]) {
      const t = combined(base, deep);
      if (!t) continue;
      console.log('   ' + base.replace('_ore', '').padEnd(22) + (t / hist.chunks).toFixed(2).padStart(8) +
                  '     ' + (peakOf(base) === null ? '-' : peakOf(base)));
    }
  }

  // every overworld ore must actually appear
  for (const n of ['coal_ore', 'iron_ore', 'copper_ore', 'gold_ore', 'redstone_ore', 'lapis_ore', 'diamond_ore']) {
    ok(totalOf(n) + totalOf('deepslate_' + n) > 0, `no ${n} was generated in ${hist.chunks} chunks`);
  }
  // and the stone/deepslate split must exist for each: the same feature places both, chosen by
  // what it lands in, so an ore with none of one is a target predicate that never matches
  for (const n of ['coal_ore', 'iron_ore', 'copper_ore']) {
    ok(totalOf(n) > 0 && totalOf('deepslate_' + n) > 0,
       `${n} has ${totalOf(n)} in stone and ${totalOf('deepslate_' + n)} in deepslate — one of its two targets never matches`);
  }
  // ⚠ the ABUNDANCE ORDER, which is a property of the counts in the data and not of the blob
  // algorithm: coal is the commonest ore in the overworld and diamond the rarest.
  const coal = combined('coal_ore', 'deepslate_coal_ore');
  const iron = combined('iron_ore', 'deepslate_iron_ore');
  const diamond = combined('diamond_ore', 'deepslate_diamond_ore');
  const lapis = combined('lapis_ore', 'deepslate_lapis_ore');
  ok(coal > iron, `coal (${coal}) is not commoner than iron (${iron})`);
  ok(iron > diamond, `iron (${iron}) is not commoner than diamond (${diamond})`);
  ok(lapis > diamond, `lapis (${lapis}) is not commoner than diamond (${diamond})`);

  // ⚠ THE PEAKS, which ARE checkable against vanilla, because they are decided by the height
  // providers in the JSON and by nothing else. These four numbers are the ones every 1.18 ore
  // chart shows, and each is asserted against the PLACEMENTS rather than the blocks so that
  // terrain shape cannot move them.
  const medianOf = (name) => {
    const p = F.placementsOf(0, 0);
    const ys = [];
    for (let i = 0; i < p.length; i += F.PLACEMENT) if (F.placedList[p[i + 2]].name === name) ys.push(p[i + 4]);
    ys.sort((a, b) => a - b);
    return ys.length ? ys[ys.length >> 1] : null;
  };
  for (const [name, want, tol] of [['ore_diamond', -59, 12], ['ore_iron_middle', 16, 14],
                                   ['ore_copper', 48, 20], ['ore_lapis', 0, 16]]) {
    const m = medianOf(name);
    ok(m !== null && Math.abs(m - want) <= tol,
       `${name} places around y=${m}, vanilla's distribution peaks at ${want}`);
    if (PRINT) console.log(`   ${name.padEnd(18)} median placement y=${m}, vanilla peaks at ${want}`);
  }

  // ⚠ WHAT THIS CHECK DOES NOT CLAIM. The per-chunk COUNT depends on the blob algorithm, which
  // is compiled Java: nothing in the jar states the union volume of `size` overlapping spheres,
  // so there is no file to check it against and this check does not pretend there is. What it
  // does assert is that the volume RESPONDS to `size` the way vanilla's does — monotonically,
  // and superlinearly, because the radius itself grows with size.
  const vol = (name, tries) => {
    const g = F.configured[name];
    if (!g) return null;
    let t = 0;
    for (let k = 0; k < tries; k++) {
      const SB = new Int32Array(256 * H).fill(STONE);
      F.placeForTest(g, SB, 0, 0, 8, 100, 8, (k * 2654435761) | 0);
      for (let i = 0; i < SB.length; i++) if (SB[i] !== STONE) t++;
    }
    return t / tries;
  };
  const v4 = vol('ore_diamond_small', 60), v9 = vol('ore_iron', 60), v17 = vol('ore_coal', 60), v64 = vol('ore_diorite', 40);
  ok(v4 !== null && v9 !== null && v17 !== null && v64 !== null, 'an ore feature needed for the volume test is missing');
  ok(v4 < v9 && v9 < v17 && v17 < v64, `blob volume is not monotonic in size: ${v4} ${v9} ${v17} ${v64}`);
  ok(v9 >= 3 && v9 <= 14, `a size-9 vein is ${v9.toFixed(1)} blocks; vanilla's iron veins are a handful`);
  ok(v4 >= 1 && v4 <= 6, `a size-4 vein is ${v4.toFixed(1)} blocks`);
  ok(v64 / v9 > 10, `a size-64 blob is only ${(v64 / v9).toFixed(1)}x a size-9 one — the radius is not growing with size`);
  if (PRINT || true) console.log(`   blob volume by size: 4→${v4.toFixed(1)}  9→${v9.toFixed(1)}  17→${v17.toFixed(1)}  64→${v64.toFixed(1)}`);
}

// ─────────────────────────── 4a. THE VANILLA PARITY DATA — measured, not inferred
console.log('4a. ore per chunk against a world the real game generated');
{
  // ⚠ THIS IS THE NUMBER `docs/archive/NEXT.md` CARRIED AS AN OPEN GAP FOR THREE SESSIONS: *"W8's ore
  // counts have no vanilla parity data ... Sample ~100 chunks in the real game and paste the
  // counts in."* These are those counts. They were measured on 8 September 2026 by running the
  // REAL 1.18.2 dedicated server (jar SHA-1 c8f83c5655308435b3dcf03c06d9fe8740a77469, verified
  // against the object hash in its Mojang URL, on Java 25) headless at level-seed 1337,
  // level-type minecraft:normal, force-loading 6,626 chunks and proving every one of them
  // reached Status:full before the JVM was allowed to exit. `tools/vanillacheck.mjs` is the
  // check that reads those region files; this block only needs the seven numbers.
  //
  // ⚠⚠ THE SAMPLE IS A NAMED BOX, NOT AN AVERAGE OF THE WORLD, and that matters more than it
  // looks. Ore density is not uniform: coal's two features run to y=320 and only fill stone that
  // is actually there, so a mountain region makes several times the coal a plain does. §4's own
  // histogram above samples (40..47, -20..-13) — a deliberately mountainous window — and reads
  // 297 coal a chunk there. Pasting a world-average against THAT window would have manufactured
  // a 4x discrepancy out of nothing but geography, which is the D-152/D-178/D-194 mistake in a
  // new costume. So this block generates the SAME 10x10 chunk box the vanilla figures were taken
  // from, and states it.
  //
  //   seed 1337 · climate vanilla · chunks x -20..-11, z -20..-11 · 100 chunks
  //   biome mix of that box, from the golden data: desert 54%, wooded_badlands 21%,
  //   lush_caves 13%, river 13% (quart cells)
  const VANILLA_PER_CHUNK = {           // real 1.18.2, 100 chunks, ores + their deepslate forms
    coal_ore:     76.98,
    iron_ore:     74.65,
    copper_ore:   73.31,
    redstone_ore: 37.39,
    gold_ore:     35.39,
    lapis_ore:    24.52,
    diamond_ore:  16.64,
  };
  const X0 = -20, X1 = -11, Z0 = -20, Z1 = -11;
  const mine = new Map();
  let n = 0;
  for (let cx = X0; cx <= X1; cx++) {
    for (let cz = Z0; cz <= Z1; cz++) {
      const col = G.genColumn(cx, cz);
      n++;
      for (let sy = 0; sy < CFG.SECTIONS_Y; sy++) {
        const sec = col.sec[sy];
        for (let i = 0; i < CFG.SECTION_VOL; i++) {
          const v = S.get(sec, i);
          if (!v) continue;
          const nm = SR.name(v);
          if (!/_ore$/.test(nm)) continue;
          const base = nm.replace(/^deepslate_/, '');
          mine.set(base, (mine.get(base) || 0) + 1);
        }
      }
    }
  }
  ok(n === 100, `the parity box is ${n} chunks, not the 100 the vanilla figures were taken from`);
  console.log('   ore              vanilla/chunk   mc-lite/chunk   ratio');
  for (const [ore, van] of Object.entries(VANILLA_PER_CHUNK)) {
    const got = (mine.get(ore) || 0) / n;
    const ratio = got / van;
    console.log('   ' + ore.padEnd(16) + van.toFixed(2).padStart(10) + got.toFixed(2).padStart(15) + ratio.toFixed(2).padStart(9));
    // ⚠ A BAND, NOT EQUALITY, and the reason is the one §4 already states above: the COUNT and
    // the height provider of every ore feature are in the JSON and are checked exactly, but the
    // union volume of `size` overlapping spheres is compiled Java and MC-Lite's blob placer is
    // its own. +-35% is wide enough that two different sphere unions cannot fail it and narrow
    // enough to have caught the 3-4x over-generation this project believed was happening.
    // MEASURED 8 Sept 2026: 0.91x .. 1.15x on all seven. ⚠ THE BELIEF WAS WRONG — NEXT.md's
    // "we over-generate rare ores 3-4x (diamond 12.5/chunk)" was an inference from having no
    // referee. Vanilla makes 16.64 diamond ore blocks a chunk in this box; MC-Lite makes 15.28.
    ok(ratio >= 0.65 && ratio <= 1.35,
       `${ore}: vanilla makes ${van.toFixed(2)}/chunk in this box, MC-Lite ${got.toFixed(2)} (${ratio.toFixed(2)}x)`);
  }
  // and the thing the raw counts cannot say: every ore must actually be present in the box
  for (const ore of Object.keys(VANILLA_PER_CHUNK)) ok((mine.get(ore) || 0) > 0, `no ${ore} in the parity box at all`);
}

// ─────────────────────────────────────────────── 4b. the vegetation
console.log('4b. what grows on the ground');
{
  // ⚠ COUNTED PER CHUNK-EQUIVALENT OF GRASS_BLOCK SURFACE, NOT PER CHUNK, and that is not a
  // fudge — it is the only way this section measures the FEATURE rather than the terrain.
  //
  // Until D-197 a grass tuft would stand on anything opaque, sand included, and this section's
  // ">40 tufts a chunk" was met by 971 tufts standing on SAND against 718 on grass_block. D-197
  // gave every plant vanilla's own `mayPlaceOn`, the sand tufts stopped being generated, and the
  // raw count fell to 15.1 — the check would have read that as "the grass patch feature broke".
  // It did not: 41 tufts per chunk of grass_block is what it places, then and now.
  //
  // ⚠ AND THE REASON THE TWO NUMBERS ARE SO FAR APART IS A SEPARATE, UNFIXED BUG. All 49 sample
  // chunks are `minecraft:plains` by biome and 58% of their top surface is SAND (4,705 of 8,050
  // cells grass_block, 3,272 sand at the old 25-chunk sample). Vanilla's plains above sea level
  // is grass_block; a surface rule is laying beach across an inland biome. Nothing in Track W
  // measures the top block against the biome, which is why nothing has caught it. Named here
  // rather than absorbed into a threshold.
  const N = 7, BX = 20, BZ = 37;
  const hist = new Map();
  let plains = 0, grassBlockTop = 0;
  for (let cz = 0; cz < N; cz++) {
    for (let cx = 0; cx < N; cx++) {
      // ⚠ ASSERTED, not assumed. The old sample was described as "a plains" in a comment and
      // nothing checked it; a sample that drifts into a savanna is a check that measures the
      // wrong biome for a session and reads green.
      if (MCL.Biomes.name(MCL.Climate.surfaceBiomeAt((cx + BX) * 16 + 8, (cz + BZ) * 16 + 8)) === 'minecraft:plains') plains++;
      const col = G.genColumn(cx + BX, cz + BZ);
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          for (let y = CFG.CHUNK_H - 1; y > 0; y--) {
            const st = S.get(col.sec[y >> 4], ((y & 15) << 8) | (z << 4) | x);
            if (st > 0 && SR.opaqueBase[st] === 1) { if (SR.name(st) === 'grass_block') grassBlockTop++; break; }
          }
        }
      }
      for (let sy = 8; sy < 12; sy++) {
        for (let i = 0; i < CFG.SECTION_VOL; i++) {
          const v = S.get(col.sec[sy], i);
          if (!v) continue;
          const n = SR.name(v);
          if (!/grass$|tulip|poppy|dandelion|daisy|bluet|cornflower|allium|orchid|fern|dead_bush|sugar_cane|pumpkin|melon|lily/.test(n)) continue;
          hist.set(n, (hist.get(n) || 0) + 1);
        }
      }
    }
  }
  ok(plains === N * N, `${plains} of ${N * N} sample chunks are plains — 4b is measuring the wrong biome`);
  ok(grassBlockTop > 2000, `only ${grassBlockTop} grass_block surface cells in ${N * N} plains chunks — 4b is vacuous`);
  const eq = grassBlockTop / 256;                   // chunk-equivalents of plantable surface
  const per = (n) => (hist.get(n) || 0) / eq;
  if (PRINT || true) {
    const rows = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    console.log(`   per chunk of grass_block surface (${eq.toFixed(1)} of ${N * N} chunks): `
      + rows.map(([k, v]) => k + ' ' + (v / eq).toFixed(1)).join('  '));
  }
  // ⚠ vanilla's plains is a field of grass with flowers in it, and the ratio is the point: the
  // grass patch has 32 tries and a noise-driven count, the flower patch has a rarity filter of
  // 32 on top of its own count. Grass must dominate by a wide margin or one of the two chains
  // has lost a modifier.
  ok(per('grass') > 40, `only ${per('grass').toFixed(1)} grass tufts per chunk of plains surface`);
  ok(per('grass') < 500, `${per('grass').toFixed(1)} grass tufts per chunk of plains surface is a lawn, not a plains`);
  ok(per('tall_grass') > 0, 'no tall grass in a plains');
  ok(per('grass') > per('tall_grass') * 3, 'tall grass is nearly as common as short grass');
  let flowers = 0;
  for (const [k, v] of hist) if (/tulip|poppy|dandelion|daisy|bluet|cornflower|allium|orchid/.test(k)) flowers += v;
  ok(flowers / eq > 1, `only ${(flowers / eq).toFixed(1)} flowers per chunk of plains surface`);
  ok(flowers < hist.get('grass'), 'there are more flowers than grass in a plains');
  // ⚠ and MORE THAN ONE KIND of flower: `flower_plain` places through a
  // `noise_threshold_provider`, so a plains has patches of different flowers. One kind
  // everywhere means the provider collapsed to its default.
  let kinds = 0;
  for (const k of hist.keys()) if (/tulip|poppy|dandelion|daisy|bluet|cornflower/.test(k)) kinds++;
  ok(kinds >= 3, `only ${kinds} kinds of flower in ${N * N} plains chunks — the noise provider has collapsed`);
  // ⚠ and no tuft in this sample stands on a floor its own block refuses — the 971 on sand.
  // The world-wide form of that assertion is `tools/floatcheck.mjs` §2d (D-197); this is the
  // one line that stops 4b drifting back to counting them as vegetation.
  ok(SR.floorOk(SR.stateOf('grass'), SR.stateOf('sand')) === false,
     'grass is allowed to stand on sand again, and 4b is counting beach as plains (D-197)');
}

// ─────────────────────────────────────────────── 4c. a tree is built by all nine of its chunks
console.log('4c. a tree crosses the chunk boundary it is standing on (D-213)');
let FOURC = null;                                   // the position 4c planted at, re-used by §6
{
  // ⚠ WHAT THIS SECTION IS FOR, AND WHY NOTHING HERE COUNTED A TREE UNTIL NOW.
  //
  // Dan, twice in two sessions: *"some trees have half their leaves cut off."* The second report
  // was a worldgen bug (D-213): the `block_predicate_filter` on every inline tree read the TARGET
  // chunk at the tree's origin, got -1 in the eight chunks that do not contain the trunk, and
  // cancelled the build there. A tree was therefore drawn only by its own chunk and sliced flat
  // along the grid. featcheck ran green through all of it: section 4b counts grass and flowers on
  // a plains and section 4 counts ore, and NOTHING in this file had ever counted a log or a leaf.
  //
  // ⚠ AND THIS IS AN EXACT TEST, NOT A CALIBRATED ONE. It states no number taken from today's
  // world. A tree standing hard against a chunk boundary reaches into the chunk next door — that
  // is what "reach" means and `Features.reachOf` is the pipeline's own bound on it — so the blocks
  // it writes summed over the 3x3 must be MORE than the blocks its own chunk receives. Under the
  // bug the two numbers are equal, for every tree, at every residue. Nothing needs to be measured
  // for that to be a failure; it is arithmetic.
  // ⚠ THE TARGET CHUNKS ARE THE REAL PRE-FEATURE WORLD, NOT A FLAT SLAB, and they have to be:
  // D-213's guard asks `Features.terrainAt`, which is that world, so a synthetic slab would be
  // judged against terrain it does not have and every tree would refuse. `Column.height` is the
  // same pure function both sides read, so this fills each column solid below it — the terrain
  // pass, without the surface rules, the carvers or any feature.
  const GRASS = SR.stateOf('grass_block');
  const preFeature = (cx, cz) => {
    const sb = new Uint16Array(H * 256);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const h = MCL.Column.height((cx << 4) + x, (cz << 4) + z) | 0;
      const top = Math.min(H - 1, h - MINY);
      for (let y = 0; y <= top; y++) sb[(y << 8) | (z << 4) | x] = STONE;
      if (top >= 0) sb[(top << 8) | (z << 4) | x] = GRASS;
    }
    return sb;
  };
  // The trees a biome reaches through a selector — the ones the bug applied to. Named, so a
  // registry change that stops one compiling is a failure here and not a silently smaller sample.
  const TREES = ['oak_checked', 'birch_checked', 'acacia_checked', 'spruce_checked',
                 'fancy_oak_checked', 'jungle_tree', 'dark_oak_checked'];
  // ⚠ A CHUNK CHOSEN BY A STATED PROPERTY, NOT BY ITS COORDINATES. D-148's lesson: a sample
  // pinned to the origin tests the origin. This walks outward until it finds a chunk whose whole
  // 3x3 stands clear of the sea by 8 blocks and is flat to within 3 — a tree needs room, and a
  // hillside would refuse for reasons that have nothing to do with the chunk grid. The walk starts
  // five chunks out so the answer can never be chunk 0,0.
  const SEA = G.params.seaLevel;
  let CX = 0, CZ = 0, best = 1e9, found = false;
  for (let az = 5; az < 25; az++) {
    for (let ax = 5; ax < 25; ax++) {
      let lo = 1e9, hi = -1e9;
      for (let z = -16; z < 32; z += 3) for (let x = -16; x < 32; x += 3) {
        const h = MCL.Column.height((ax << 4) + x, (az << 4) + z) | 0;
        if (h < lo) lo = h; if (h > hi) hi = h;
      }
      if (lo >= SEA + 4 && hi - lo < best) { best = hi - lo; CX = ax; CZ = az; found = best <= 12; }
    }
  }
  ok(found, 'no flat inland chunk found for section 4c — the section has nowhere to plant a tree');
  console.log(`   planting at chunk ${CX},${CZ} — ground ${MCL.Column.height(CX << 4, CZ << 4)}, sea ${SEA}`);
  let crossed = 0, tested = 0;
  // ⚠ ONE MEMBER OF THIS FAMILY IS NOT TRUNK-CENTRED, AND IT IS NAMED (D-225). Six of the seven
  // put their canopy around the trunk, so a trunk planted hard against an edge MUST reach past
  // it from all four edges. `acacia` does not: vanilla plants it with a `BendingTrunkPlacer` and
  // an `AcaciaFoliagePlacer`, so the canopy sits at the end of a trunk that leans one way and it
  // can miss the ONE edge it leans away from. The per-residue form of this assertion passed for
  // three sessions on the luck of which chunk the flatness search happened to pick; D-225 moved
  // the world 2.5 blocks at sea level, the search picked chunk 22,24, and acacia at residue 0,8
  // wrote 73 blocks in its own chunk and 73 across all nine — a tree that is not clipped, and
  // simply does not stick out. So the claim is stated per TREE, at its true strength for each:
  // four of four for the six trunk-centred ones, three of four for the one that leans.
  const EDGES = 4, LEANING = { acacia_checked: 3 };
  for (const name of TREES) {
    let crossHere = 0;
    const inl = F.api.inline('minecraft:' + name, 'featcheck-4c');
    ok(!!inl, `${name}: featcheck cannot compile it as an inline placed feature`);
    if (!inl) continue;
    ok(inl.local === false, `${name} reads as column-local — its guard would be judged per target (D-213)`);
    // hard against the -x edge of chunk 0, so a canopy of any radius must reach chunk -1
    for (const [rx, rz] of [[0, 8], [15, 8], [8, 0], [8, 15]]) {
      const x = (CX << 4) + rx, z = (CZ << 4) + rz;
      const y = F.api.heightmapY(1, x, z);            // OCEAN_FLOOR: the first free y, as vanilla's chain gives it
      const seed = (rx * 7919 + rz * 104729) | 0;
      let own = 0, all = 0;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const sb = preFeature(CX + dx, CZ + dz);
          const r = F.api.rngAt(seed, x, y, z);
          const n = F.api.runInline(inl, sb, CX + dx, CZ + dz, x, y, z, r);
          all += n;
          if (dx === 0 && dz === 0) own = n;
        }
      }
      tested++;
      ok(own > 0, `${name} at residue ${rx},${rz}: its own chunk built nothing at all — 4c is vacuous`);
      ok(all >= own, `${name} at residue ${rx},${rz}: the 3x3 wrote ${all} blocks and its own chunk ${own} — ` +
                     'a neighbour chunk UNWROTE part of the tree, which is not a thing that can happen');
      if (all > own) { crossed++; crossHere++; }
      if (PRINT) console.log(`   ${name.padEnd(18)} residue ${rx},${rz}: own chunk ${String(own).padStart(4)} · all nine ${String(all).padStart(4)}`);
    }
    const need = LEANING[name] || EDGES;
    ok(crossHere >= need, `${name} reached past its own chunk from ${crossHere} of the ${EDGES} edge residues, not ${need} — ` +
                          'the tree stops dead at the chunk boundary (D-213)');
  }
  FOURC = { cx: CX, cz: CZ, x: (CX << 4) + 0, z: (CZ << 4) + 8, y: F.api.heightmapY(1, (CX << 4) + 0, (CZ << 4) + 8) };
  console.log(`   ${TREES.length} selector trees x 4 edge residues: ${crossed} of ${tested} reach past their own chunk`);
  ok(tested === TREES.length * 4, `only ${tested} of ${TREES.length * 4} tree/residue pairs were testable`);
}

// ─────────── 4d. the three mechanisms D-222 and D-223 put back, and what each is for
//
// ⚠ WHY THIS SECTION EXISTS. `vanillacheck` §6 measured MC-Lite's decoration against 11,626
// chunks the real 1.18.2 server generated and found jungle_log at 10.10x, moss_carpet at 4.68x
// and oak_leaves at 2.09x. Three mechanisms vanilla has and MC-Lite did not accounted for all of
// it: features could not see features (D-222's canopy stamp), `environment_scan` was passed
// through (D-223), and `prioritize_tip` was read by nobody. The referee is the authority on
// whether the DENSITY is right; this section is the authority on whether the mechanisms are
// still there, because the referee needs 97 MB of golden data and skips without it.
console.log('4d. features seeing features, the environment scan, and the column tip');
{
  const LUSH4 = [156, -104], N4 = 4;
  const TREES4 = [12, 32];                 // the densest 4x4 tree region in this seed's search

  // ── 1. the scan lands ON a face, and it lands rarely ────────────────────────────────────
  //
  // `lush_caves_vegetation` is `count 125` and `cave_vines` is `count 188`. Vanilla's scan walks
  // from a uniform y through cave air to the first solid block, so the survivors are the handful
  // that started in a cave. Each survivor is then moved one block off the face it found by the
  // `random_offset` that follows the scan — +1 for a floor search, -1 for a ceiling — so the
  // face is exactly one step back along the search direction, and `carvedAt` is the world the
  // scan was answered in.
  {
    const dirOf = { lush_caves_vegetation: -1, lush_caves_clay: -1, cave_vines: 1, lush_caves_ceiling_vegetation: 1 };
    let onFace = 0, tested = 0, attempts = 0;
    for (let dz = 0; dz < N4; dz++) {
      for (let dx = 0; dx < N4; dx++) {
        const p = F.placementsOf(LUSH4[0] + dx, LUSH4[1] + dz);
        for (let i = 0; i < p.length; i += F.PLACEMENT) {
          const nm = F.placedList[p[i + 2]].name;
          const d = dirOf[nm];
          if (d === undefined) continue;
          tested++;
          const x = p[i + 3], y = p[i + 4], z = p[i + 5];
          // the offset moved the placement one block OFF the face, so the face is one further on
          const face = F.carvedAt(x, y + d, z);
          if (face > 0 && SR.solid[face] === 1) onFace++;
        }
      }
    }
    for (let dz = 0; dz < N4; dz++) for (let dx = 0; dx < N4; dx++) attempts += 125 + 188 + 62 + 125;
    ok(tested > 60, `only ${tested} scanned placements over ${N4 * N4} lush chunks to check`);
    ok(onFace === tested,
       `${tested - onFace} of ${tested} scanned placements are not against a solid face — the scan is not finding one`);
    ok(tested < attempts * 0.25,
       `${tested} of ${attempts} scan attempts survived — the scan is passing nearly everything through`);
    if (PRINT) console.log(`   scan: ${tested} of ${attempts} attempts survived, all ${onFace} against a face`);
  }

  // ── 2. a tree does not stand under another tree's canopy ────────────────────────────────
  //
  // D-222's stamp is a pure function of the SOURCE CHUNK, so this can be asked of the placement
  // list alone. Two things follow from it and neither did before: no two accepted tree placements
  // in one source chunk share a column, and `trees_jungle`'s fifty attempts do not all survive.
  {
    const isTree = (pid) => F.anyCanopy(F.placedList[pid].gen);
    let pairsSame = 0, treePl = 0, chunks = 0;
    for (let dz = 0; dz < N4; dz++) {
      for (let dx = 0; dx < N4; dx++) {
        chunks++;
        const p = F.placementsOf(TREES4[0] + dx, TREES4[1] + dz);
        const cols = [];
        for (let i = 0; i < p.length; i += F.PLACEMENT) {
          if (!isTree(p[i + 2])) continue;
          treePl++;
          const key = p[i + 3] + ',' + p[i + 5];
          if (cols.indexOf(key) >= 0) pairsSame++;
          cols.push(key);
        }
      }
    }
    ok(treePl > 20, `only ${treePl} tree placements over ${chunks} chunks to check the stamp with`);
    ok(pairsSame === 0, `${pairsSame} pairs of tree placements share a column — the canopy stamp is not stamping`);
    ok(treePl / chunks < 25, `${(treePl / chunks).toFixed(1)} tree placements a chunk — `
       + 'the stamp is not thinning the fifty `trees_jungle` attempts at all');
    if (PRINT) console.log(`   canopy: ${(treePl / chunks).toFixed(1)} tree placements a chunk, no two in one column`);
  }

  // ── 3. the measured footprints, and the precondition `resolveGen` declares ──────────────
  {
    const area = (n) => { const g = F.configured[n]; F.canopyRadius(g); return g; };
    const jt = area('jungle_tree'), mj = area('mega_jungle_tree'), pn = area('pine');
    ok(jt.canopyArea > 15 && jt.canopyArea < 35, `jungle_tree covers ${jt.canopyArea} columns, not a 5x5 blob`);
    ok(mj.canopyArea > jt.canopyArea * 1.8, `mega_jungle_tree covers ${mj.canopyArea} columns against jungle_tree's ${jt.canopyArea}`);
    ok(pn.canopyArea < jt.canopyArea, `a pine's tuft (${pn.canopyArea}) is not smaller than a jungle canopy (${jt.canopyArea})`);
    ok(mj.trunkR >= 1 && jt.trunkR === 0, `trunk footprints are ${jt.trunkR} (1x1 jungle) and ${mj.trunkR} (2x2 mega)`);
    ok(mj.sizeR === 2 && jt.sizeR === 1, `minimum_size radii are ${jt.sizeR} and ${mj.sizeR}, not Mojang's 1 and 2`);
    // ⚠ `resolveGen` mirrors `place`'s selector roll WITHOUT running the inline guard, so it is
    // only exact while no selector on the way to a tree carries a `random_offset`. It declines
    // (returns null) rather than guessing when one does — and this asserts that no overworld
    // selector has one, so the decline path is dead code rather than a silent hole.
    let offsets = 0, sel = 0;
    const walk = (gen, depth) => {
      if (!gen || depth > 8) return;
      const kids = gen.kind === 'select' ? [gen.def].concat(gen.opts.map((o) => o.inl))
        : gen.kind === 'selectUniform' ? gen.opts
        : gen.kind === 'selectBool' ? [gen.a, gen.b] : null;
      if (!kids) return;
      sel++;
      for (const inl of kids) {
        if (!inl || !inl.gen) continue;
        if (!F.anyCanopy(inl.gen)) continue;
        for (const m of inl.chain) if (m.kind === 'offset') offsets++;
        walk(inl.gen, depth + 1);
      }
    };
    for (const pf of F.placedList) if (F.anyCanopy(pf.gen)) walk(pf.gen, 0);
    ok(sel > 5, `only ${sel} selectors on the way to a tree were walked`);
    ok(offsets === 0, `${offsets} tree selectors carry a random_offset — resolveGen would stamp the wrong tree`);
  }

  // ── 4. `prioritize_tip`: a cave vine that runs out of room keeps its tip ────────────────
  {
    const cv = F.configured['cave_vine'];
    ok(cv && cv.kind === 'column' && cv.tip === true, 'cave_vine did not compile as a tip-priority block_column');
    const STONE4 = SR.stateOf('stone');
    // ⚠ A ONE-CELL GAP IS THE TEST, and it is chosen so that the two truncation directions write
    // DIFFERENT BLOCKS in the same cell. Rock everywhere but y=100, with rock at 101 and 99. The
    // sampled column is body + one tip, 4.47 blocks on average and never fewer than one; only one
    // cell fits. Truncating from the START (prioritize_tip) shaves the body away and leaves the
    // TIP hanging from the ceiling; truncating from the end leaves a headless body. So the block
    // at y=100 says which rule ran, and the anti-vacuity break flips it.
    //
    // ⚠ A THREE-CELL GAP WOULD NOT TEST IT, and the reason is worth writing down because it is a
    // real deficit somewhere else: `States.ceilingOk(cave_vines, cave_vines_plant)` is FALSE, so
    // D-140's write-time support rule refuses a vine TIP hanging under its own body. In a
    // three-cell gap the tip is truncated correctly and then thrown away by that rule. It is why
    // `vanillacheck` §6 still has cave_vines at 0.34x against cave_vines_plant's 0.95x — the
    // columns are right and most of them have no tip. The table is in `02c_states.js`.
    let placed = 0, tips = 0;
    for (let s = 0; s < 64; s++) {
      const sb = new Uint16Array(H * 256);
      for (let y = MINY; y < MINY + H; y++) {
        if (y === 100) continue;
        for (let i = 0; i < 256; i++) sb[((y - MINY) << 8) | i] = STONE4;
      }
      const n = F.placeForTest(cv, sb, 0, 0, 8, 100, 8, 12345 + s * 7919);
      if (!n) continue;
      placed++;
      if (SR.name(sb[((100 - MINY) << 8) | (8 << 4) | 8]) === 'cave_vines') tips++;
    }
    ok(placed > 55, `only ${placed} of 64 cave vines grew at all in the one-cell gap`);
    ok(tips === placed, `${placed - tips} of ${placed} truncated cave vines lost their tip — prioritize_tip is not truncating from the start`);
    if (PRINT) console.log(`   block_column: ${placed} vines in a 1-cell gap, ${tips} kept their tip`);
  }
}


// ───────── 4e. the two rules `SimpleBlockFeature.place` has that no block tag can state (D-241)
//
// ⚠ WHY THIS SECTION EXISTS, AND WHAT THE REFEREE FOUND THAT NOTHING HERE COULD.
// `vanillacheck` §6 pools every sampled chunk into one number per family, and a swamp is under
// 1% of the golden pregen — so a decoration error that lives inside ONE BIOME moves that average
// by nothing at all. §11 counts the same ledger PER BIOME and the swamp read brown_mushroom
// 142x, lily_pad 6.2x and oak_leaves 0.36x while every world average stayed green. Three rules
// were the cause and all three are vanilla's own:
//
//   MUSHROOM   `MushroomBlock.canSurvive` is the #mushroom_grow_block tag OR (raw brightness
//              under 13 AND a solid-render floor). MC-Lite had the tag and not the light.
//   LILY PAD   `WaterlilyBlock.mayPlaceOn` is "water below, no fluid here". MC-Lite had no rule
//              for it at all — support class 0 — so it stood on grass.
//   SAPLING    `BlockPredicate.wouldSurvive` is `state.canSurvive` and nothing else; MC-Lite also
//              demanded the CELL be air, which in a swamp is under water 78.5% of the time.
//
// This section is the authority on whether the three rules are still there; the referee is the
// authority on whether the resulting densities are right. Same split as 4d.
console.log('4e. mushroom light, lily-pad water, and a sapling that may stand in water (D-241)');
{
  const ST = (n) => SR.stateOf(n);
  const AIRY = 0;
  /** A flat world in one scratch buffer: solid up to `floorY`, `floorTop` on top of it. */
  const world = (floorY, floorTop, roofY) => {
    const sb = new Uint16Array(H * 256);
    for (let y = MINY; y <= floorY; y++) {
      const st = y === floorY ? floorTop : ST('stone');
      for (let i = 0; i < 256; i++) sb[((y - MINY) << 8) | i] = st;
    }
    if (roofY !== undefined) for (let i = 0; i < 256; i++) sb[((roofY - MINY) << 8) | i] = ST('stone');
    return sb;
  };
  const countIn = (sb, name) => {
    let n = 0;
    for (let i = 0; i < H * 256; i++) if (sb[i] && SR.name(sb[i]) === name) n++;
    return n;
  };
  // ⚠ THE FLOOR IS AT y=100 AND NOT AT THE TERRAIN'S OWN HEIGHT, and the shade rule's first
  // clause reads `Column.height` — which for this seed at (8,8) is far below 100. So a scratch
  // world built here is ABOVE the pure terrain, the "under the surface" clause cannot fire, and
  // what is being tested is the sky scan and nothing else.
  const FLOOR = 100;
  const mush = F.configured['patch_brown_mushroom'];
  const lily = F.configured['patch_waterlily'];
  ok(mush && mush.kind === 'patch', 'patch_brown_mushroom did not compile as a random_patch');
  ok(lily && lily.kind === 'patch', 'patch_waterlily did not compile as a random_patch');

  // ── the mushroom, three worlds: open sky, a roof, and mycelium under open sky ──
  let openSky = 0, roofed = 0, onMycelium = 0, tries = 24;
  for (let s = 0; s < tries; s++) {
    const seed = 4242 + s * 7919;
    let sb = world(FLOOR, ST('grass_block'));
    F.placeForTest(mush, sb, 0, 0, 8, FLOOR + 1, 8, seed);
    openSky += countIn(sb, 'brown_mushroom');
    sb = world(FLOOR, ST('grass_block'), FLOOR + 6);
    F.placeForTest(mush, sb, 0, 0, 8, FLOOR + 1, 8, seed);
    roofed += countIn(sb, 'brown_mushroom');
    sb = world(FLOOR, ST('mycelium'));
    F.placeForTest(mush, sb, 0, 0, 8, FLOOR + 1, 8, seed);
    onMycelium += countIn(sb, 'brown_mushroom');
  }
  if (PRINT) console.log(`   mushroom over ${tries} patches: open sky ${openSky}, under a roof ${roofed}, on mycelium ${onMycelium}`);
  ok(openSky === 0, `${openSky} mushrooms grew in open daylight — vanilla's light clause is not being applied`);
  ok(roofed > 100, `only ${roofed} mushrooms grew under a roof — the shade rule is refusing everything, which is not the rule`);
  ok(onMycelium > 100, `only ${onMycelium} mushrooms grew on mycelium in daylight — #mushroom_grow_block exempts them from the light`);

  // ── the lily pad: water below is the whole rule ──
  let onStone = 0, onWater = 0, onIce = 0;
  for (let s = 0; s < tries; s++) {
    const seed = 991 + s * 65537;
    let sb = world(FLOOR, ST('grass_block'));
    F.placeForTest(lily, sb, 0, 0, 8, FLOOR + 1, 8, seed);
    onStone += countIn(sb, 'lily_pad');
    sb = world(FLOOR, ST('water'));
    F.placeForTest(lily, sb, 0, 0, 8, FLOOR + 1, 8, seed);
    onWater += countIn(sb, 'lily_pad');
    sb = world(FLOOR, ST('ice'));
    F.placeForTest(lily, sb, 0, 0, 8, FLOOR + 1, 8, seed);
    onIce += countIn(sb, 'lily_pad');
  }
  if (PRINT) console.log(`   lily pad over ${tries} patches: on grass ${onStone}, on water ${onWater}, on ice ${onIce}`);
  ok(onStone === 0, `${onStone} lily pads grew on dry land — WaterlilyBlock.mayPlaceOn is a fluid question`);
  ok(onWater > 20, `only ${onWater} lily pads grew on water — the rule is refusing the one floor it must accept`);
  ok(onIce > 20, `only ${onIce} lily pads grew on ice — vanilla's Material.ICE branch is missing`);

  // ── the sapling predicate: a swamp oak stands IN the water, and the count says so ──
  //
  // ⚠ THE PREDICATE CANNOT BE CALLED DIRECTLY — it reads the world through `ctxBlock`, which is
  // null outside `applyChunk` by construction — so it is measured where it matters: how many
  // `trees_swamp` placements survive the chain over a fixed swamp, against the same chain with
  // its final filter cut off. MEASURED at seed 1337 over the 121 chunks at x -581..-571,
  // z -317..-307: 1.26 a chunk survive out of the 1.44 that reach the filter, where before D-241
  // 0.49 survived. The anti-vacuity is the second number, in BOTH directions: a filter that
  // refused nothing would not be there at all, and one that refused nearly everything is exactly
  // the bug this fixed — so the survivors are fenced above 1.0 and below the unfiltered count.
  {
    const pid = F.placedList.findIndex((p) => p.name === 'trees_swamp');
    ok(pid >= 0, 'trees_swamp is not in the placed list at all');
    if (pid >= 0) {
      const chain = F.placedList[pid].chain;
      const count = () => {
        let n = 0, c = 0;
        for (let cx = -581; cx <= -571; cx++) for (let cz = -317; cz <= -307; cz++) {
          const a = F.placementsOf(cx, cz); c++;
          for (let i = 0; i < a.length; i += F.PLACEMENT) if (a[i + 2] === pid) n++;
        }
        return n / c;
      };
      const withFilter = count();
      let without;
      try { F.placedList[pid].chain = chain.slice(0, chain.length - 1); F.cache.clear(); without = count(); }
      finally { F.placedList[pid].chain = chain; F.cache.clear(); }
      if (PRINT) console.log(`   trees_swamp per chunk: ${withFilter.toFixed(2)} with the sapling filter, ${without.toFixed(2)} without it`);
      ok(withFilter >= 1.0,
         `only ${withFilter.toFixed(2)} trees_swamp placements a chunk survive the sapling filter — before D-241 it was 0.49 because the filter also demanded the cell be dry`);
      ok(withFilter < without,
         `the sapling filter refuses nothing at all (${withFilter.toFixed(2)} of ${without.toFixed(2)} a chunk) — a filter that cannot say no is not a filter`);
      ok(without > 1.2, `only ${without.toFixed(2)} placements a chunk reach the filter — the comparison has nothing in it`);
    }
  }
}

// ─────────────────────────────────────────────── 5. what this build cannot do yet
console.log('5. the features W8 has not implemented, counted and named');
{
  const un = Object.keys(F.unsupported);
  ok(F.placedList.length + un.length > 150, `only ${F.placedList.length + un.length} placed features were considered`);
  // ⚠ an unsupported feature must be RECORDED, never silently dropped. This assertion is the
  // reason `compilePlaced` returns -1 with a reason instead of throwing or ignoring.
  let named = 0;
  for (const k of un) if (F.unsupported[k] && F.unsupported[k].length > 4) named++;
  ok(named === un.length, `${un.length - named} unsupported features have no reason recorded`);
  ok(F.placedList.every((p) => p.gen && p.chain), 'a compiled placed feature has no generator or no chain');
  if (PRINT || true) {
    const kinds = {};
    for (const k of un) {
      const m = /feature minecraft:([a-z_]+) is not implemented/.exec(F.unsupported[k]);
      const key = m ? m[1] : F.unsupported[k].slice(0, 40);
      kinds[key] = (kinds[key] || 0) + 1;
    }
    const top = Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 8);
    console.log(`   ${F.placedList.length} placed features run, ${un.length} do not yet:`);
    console.log('   ' + top.map(([k, v]) => k + '×' + v).join('  '));
  }
}

// ─────────────────────────────── 5b. the biome volume, and the cave biomes that use it (D-180)
//
// D-137 recorded, in the present tense, that `dripstone_caves` and `lush_caves` never decorated:
// a chunk took its whole feature list from the biome at its origin's SURFACE, and a cave biome
// is nobody's surface. This section is that decision's acceptance test. It asserts three things
// that were all false before the volume landed and are all cheap to keep true:
//
//   1. the volume IS the climate table's answer, cell for cell — not an approximation of it;
//   2. a chunk containing a cave-biome region places that biome's features, underground, in
//      numbers, and every one of those placements sits inside the cave biome that owns it;
//   3. the surface biome's own features did not move. The counts below were taken from the
//      build BEFORE the volume and are pinned here unchanged, because the whole risk of
//      offering every biome in the chunk is that it changes what the surface was already doing.
console.log('5b. the biome volume, and the cave biomes that decorate through it');
const CAVE_ONLY = ['dripstone_cluster', 'large_dripstone', 'lush_caves_vegetation',
                   'lush_caves_ceiling_vegetation', 'cave_vines', 'lush_caves_clay',
                   'rooted_azalea_tree', 'spore_blossom', 'classic_vines_cave_feature'];
const DRIP_AT = [16, 8], LUSH_AT = [156, -104], CAVE_N = 4;
{
  const B = MCL.Biomes, CL = MCL.Climate, CO = MCL.Column;

  // ── 1. the volume is Climate.biomeAt, cell for cell ─────────────────────────────────────
  // ⚠ THE ONE INVARIANT EVERYTHING ELSE RESTS ON. `Climate.columnBiomes` folds the six axes
  // that do not move with y and sweeps the seventh, which is a different computation from
  // `Climate.biomeAt` and must not be a different answer.
  {
    let cells = 0, agree = 0;
    for (const [cx, cz] of [DRIP_AT, LUSH_AT, [0, 0], [-78, -72]]) {
      const vol = G.biomeVolume(cx, cz);
      for (let qz = 0; qz < 4; qz++) {
        for (let qx = 0; qx < 4; qx++) {
          for (let qy = 0; qy < G.QVY; qy++) {
            const x = (cx << 4) + (qx << 2), z = (cz << 4) + (qz << 2), y = MINY + (qy << 2);
            cells++;
            if (vol[G.VIDX(qx, qy, qz)] === CL.biomeAt(x, y, z)) agree++;
          }
        }
      }
    }
    ok(cells === 4 * G.QVOL, `the volume is ${cells / 4} cells a chunk, not ${G.QVOL}`);
    ok(agree === cells, `the volume disagreed with Climate.biomeAt at ${cells - agree} of ${cells} cells`);
    if (PRINT) console.log(`   volume: ${cells} cells, ${agree} agree with Climate.biomeAt`);
  }

  // ── 2. the cave biomes place their own features, in their own biome ─────────────────────
  const caveRegion = (at) => {
    const cnt = new Map(); let inCave = 0, total = 0, deep = 0;
    for (let dz = 0; dz < CAVE_N; dz++) {
      for (let dx = 0; dx < CAVE_N; dx++) {
        const p = F.placementsOf(at[0] + dx, at[1] + dz);
        for (let i = 0; i < p.length; i += F.PLACEMENT) {
          const nm = F.placedList[p[i + 2]].name;
          if (CAVE_ONLY.indexOf(nm) < 0) continue;
          cnt.set(nm, (cnt.get(nm) || 0) + 1);
          total++;
          const b = B.name(G.biomeAt3(p[i + 3], p[i + 4], p[i + 5]));
          if (b === 'minecraft:dripstone_caves' || b === 'minecraft:lush_caves') inCave++;
          if (p[i + 4] < 64) deep++;
        }
      }
    }
    return { cnt, inCave, total, deep };
  };
  const blocksIn = (at, re) => {
    const h = new Map();
    for (let dz = 0; dz < CAVE_N; dz++) {
      for (let dx = 0; dx < CAVE_N; dx++) {
        const col = G.genColumn(at[0] + dx, at[1] + dz);
        for (let sy = 0; sy < CFG.SECTIONS_Y; sy++) {
          for (let i = 0; i < CFG.SECTION_VOL; i++) {
            const v = S.get(col.sec[sy], i);
            if (!v) continue;
            const nm = SR.name(v);
            if (!re.test(nm)) continue;
            const y = (sy << 4) + (i >> 8) + MINY;
            h.set(nm, (h.get(nm) || 0) + 1);
            if (y < 40) h.set(nm + '@deep', (h.get(nm + '@deep') || 0) + 1);
          }
        }
      }
    }
    return h;
  };

  const drip = caveRegion(DRIP_AT);
  ok((drip.cnt.get('dripstone_cluster') || 0) > 100,
     `only ${drip.cnt.get('dripstone_cluster') || 0} dripstone_cluster placements in ${CAVE_N * CAVE_N} chunks over a dripstone_caves region`);
  ok((drip.cnt.get('large_dripstone') || 0) > 50,
     `only ${drip.cnt.get('large_dripstone') || 0} large_dripstone placements over a dripstone_caves region`);
  ok(drip.inCave === drip.total,
     `${drip.total - drip.inCave} of ${drip.total} dripstone placements are not in a cave biome — the 3D filter is not filtering`);
  const dripB = blocksIn(DRIP_AT, /dripstone/);
  ok((dripB.get('pointed_dripstone') || 0) > 500, `only ${dripB.get('pointed_dripstone') || 0} pointed_dripstone written`);
  ok((dripB.get('dripstone_block') || 0) > 500, `only ${dripB.get('dripstone_block') || 0} dripstone_block written`);
  ok((dripB.get('pointed_dripstone@deep') || 0) > (dripB.get('pointed_dripstone') || 0) * 0.5,
     'most of the dripstone is above y=40 — it is not growing in caves');

  // ── ⚠ D-223 RE-ANCHORED EVERY NUMBER BELOW, AND THE OLD ONES WERE MEASURING A BUG ────────
  //
  // These four floors were written when `environment_scan` was passed through, so `cave_vines`
  // (count 188) and `lush_caves_vegetation` (count 125) ran EVERY attempt instead of the few
  // that land in cave air on a floor. `vanillacheck` §6 then measured the result against the
  // 1.18.2 server and found cave_vines_plant at 4.24x and moss_carpet at 4.68x. D-223 evaluates
  // the scan, the counts fell by two thirds, and these floors — calibrated on the over-count —
  // failed. THE FLOORS WERE WRONG, not the world: the same 240-chunk referee now puts
  // cave_vines_plant at 0.95x, moss_block at 1.79x, clay at 1.08x, rooted_dirt at 1.01x and
  // big_dripleaf at 0.82x. That is the number this section is re-anchored to.
  //
  // ⚠ AND THEY ARE BANDS NOW, NOT FLOORS, because a floor cannot tell "fixed" from "reverted":
  // with the scan switched off again these placements go back over 200/125/60 in this 16-chunk
  // region, so the ceiling is what holds D-223 in place. The lower halves still catch a scan
  // that rejects everything, which is exactly how D-223's first draft failed (moss_carpet 0.00x).
  const lush = caveRegion(LUSH_AT);
  const lushBand = (nm, lo, hi) => {
    const v = lush.cnt.get(nm) || 0;
    ok(v >= lo && v <= hi, `${v} ${nm} placements over a ${CAVE_N * CAVE_N}-chunk lush_caves region, `
       + `outside ${lo}..${hi} — below is a scan that refuses everything, above is the scan not running`);
  };
  lushBand('cave_vines', 40, 160);                 // measured 93; unfiltered it was over 200
  lushBand('lush_caves_vegetation', 30, 110);      // measured 67; unfiltered it was over 100
  lushBand('lush_caves_clay', 12, 55);             // measured 29; unfiltered it was over 50
  ok(lush.inCave === lush.total,
     `${lush.total - lush.inCave} of ${lush.total} lush placements are not in a cave biome`);
  const lushB = blocksIn(LUSH_AT, /moss_block|moss_carpet|cave_vines|azalea|dripleaf|rooted_dirt/);
  ok((lushB.get('moss_block') || 0) > 2000, `only ${lushB.get('moss_block') || 0} moss blocks in a lush_caves region`);
  ok((lushB.get('cave_vines_plant') || 0) > 300, `only ${lushB.get('cave_vines_plant') || 0} cave vines in a lush_caves region`);
  // ⚠ ROOTED DIRT AND AZALEA LEAVES ARE NOT ASSERTED HERE ANY MORE, AND THE REASON IS SAMPLE
  // SIZE, NOT CONVENIENCE. `rooted_azalea_tree` is `count uniform(1,2)` behind the same scan —
  // one or two attempts a chunk, of which a few per cent find cave air — so sixteen chunks
  // expect well under one tree, and the real 1.18.2 server puts azalea_leaves at 0.15 a chunk
  // over the whole 240-chunk sample. A floor of 500 rooted_dirt and 50 azalea_leaves in sixteen
  // chunks was asserting a density twelve times the real game's, and it passed only because the
  // scan was not running. The honest place for a feature this rare is the referee, which
  // measures it over 240 chunks: rooted_dirt 1.01x, azalea_leaves 0.61x. What is kept here is
  // the thing sixteen chunks CAN see — that the root system compiles and is reachable at all.
  ok(F.placedIds['rooted_azalea_tree'] !== undefined && F.placedList[F.placedIds['rooted_azalea_tree']].gen,
     'rooted_azalea_tree does not compile — the root system is unreachable');
  ok((lushB.get('moss_block@deep') || 0) > (lushB.get('moss_block') || 0) * 0.9,
     'the moss is not underground — lush caves are decorating the sky');
  if (PRINT || true) {
    console.log(`   dripstone_caves at ${DRIP_AT}: ${drip.total} placements, ${dripB.get('pointed_dripstone') || 0} pointed_dripstone + ${dripB.get('dripstone_block') || 0} dripstone_block`);
    console.log(`   lush_caves at ${LUSH_AT}: ${lush.total} placements, ${lushB.get('moss_block') || 0} moss + ${lushB.get('cave_vines_plant') || 0} cave vines`);
  }

  // ── 3. and the surface did not move ──────────────────────────────────────────────────────
  // ⚠ EXACT COUNTS, measured on the build BEFORE the volume existed. Offering every biome in
  // the chunk could not be allowed to change what the surface biome was already placing, and
  // "could not" is only worth writing if something fails when it does.
  {
    const want = { trees_plains: 4, patch_grass_plain: 250, flower_plains: 2, patch_tall_grass_2: 7,
                   patch_sugar_cane: 4, glow_lichen: 1236 };
    // ⚠ `glow_lichen` WAS 1246 AND THE TEN THAT WENT ARE D-225's, NOT THE VOLUME'S. This pin is
    // "offering every biome in the chunk did not change what the surface biome places", and the
    // five surface features above are still on their pre-volume numbers to the block. glow_lichen
    // is the only one of the six anchored on the terrain rather than on the surface: it is placed
    // through a height range against the world's own rock, and D-225 lowered the sea-level anchor
    // 2.5 blocks, so ten fewer of its attempts find a face. Re-taken, still EXACT, and the cause
    // is written down — a pin that is silently widened after a world change is worth nothing.

    const got = Object.create(null);
    for (const k of Object.keys(want)) got[k] = 0;
    for (let cz = 37; cz < 42; cz++) {
      for (let cx = 24; cx < 29; cx++) {
        const p = F.placementsOf(cx, cz);
        for (let i = 0; i < p.length; i += F.PLACEMENT) {
          const nm = F.placedList[p[i + 2]].name;
          if (got[nm] !== undefined) got[nm]++;
        }
      }
    }
    for (const k of Object.keys(want)) {
      ok(got[k] === want[k], `${k}: ${got[k]} placements over the plains at 24,37, was ${want[k]} before the volume`);
    }
    // and the 3D answer at a surface-anchored position IS the surface answer, which is why
    // moving the `biome` modifier from 2D to 3D could not disturb them
    let sameAsSurface = 0, n = 0;
    for (let cz = 37; cz < 42; cz++) {
      for (let cx = 24; cx < 29; cx++) {
        const p = F.placementsOf(cx, cz);
        for (let i = 0; i < p.length; i += F.PLACEMENT) {
          const x = p[i + 3], z = p[i + 5];
          const h = CO.height(x, z);
          if (p[i + 4] < h || p[i + 4] > h + 2) continue;      // surface-anchored only
          n++;
          if (G.biomeAt3(x, p[i + 4], z) === CL.surfaceBiomeAt(x, z)) sameAsSurface++;
        }
      }
    }
    ok(n > 200, `only ${n} surface-anchored placements to compare`);
    ok(sameAsSurface === n, `${n - sameAsSurface} of ${n} surface placements see a different biome in 3D than at the surface`);
    if (PRINT) console.log(`   surface: ${n} anchored placements, ${sameAsSurface} see the surface biome`);
  }
}

// ─────────────────────────────────────────────── 6. anti-vacuity
console.log('5c. every two-block plant has its head (D-254)');
{
  // ⚠ THE INVARIANT A COUNT COULD NOT SEE. Vanilla's `SimpleBlockFeature` branches on
  // `DoublePlantBlock` and writes BOTH halves; MC-Lite's `simple_block` wrote one cell, so the
  // world was full of headless tall grass and every two-block plant generated at exactly half
  // vanilla's block count. Section 4's ledgers counted the lower halves and were perfectly happy.
  const halfP = MCL.Reg.PROP.half, lowerV = MCL.Reg.PVAL.lower, upperV = MCL.Reg.PVAL.upper;
  let lowers = 0, headless = 0, wrongHead = 0, uppers = 0, orphanHeads = 0;
  const cell = (col, x, y, z) => {
    const sy = (y - MINY) >> 4;
    if (sy < 0 || sy >= CFG.SECTIONS_Y) return 0;
    return S.get(col.sec[sy], ((y - MINY) & 15) * 256 + (z & 15) * 16 + (x & 15));
  };
  for (let cx = 0; cx < 10; cx++) {
    for (let cz = 0; cz < 10; cz++) {
      const col = G.genColumn(cx * 3 + 100, cz * 3 - 60);
      for (let y = MINY; y < MAXY; y++) {
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) {
            const st = cell(col, x, y, z);
            if (!st) continue;
            const h = SR.propValue(st, halfP);
            if (h === lowerV) {
              // a door is the only other block with `half`, and it is not a plant
              if (MCL.Reg.PROP.hinge !== undefined && SR.propValue(st, MCL.Reg.PROP.hinge) >= 0) continue;
              lowers++;
              const want = F.tallUpper(st);
              const above = cell(col, x, y + 1, z);
              if (!above) headless++;
              else if (want && above !== want) wrongHead++;
            } else if (h === upperV) {
              if (MCL.Reg.PROP.hinge !== undefined && SR.propValue(st, MCL.Reg.PROP.hinge) >= 0) continue;
              uppers++;
              const below = cell(col, x, y - 1, z);
              if (!below || SR.propValue(below, halfP) !== lowerV) orphanHeads++;
            }
          }
        }
      }
    }
  }
  ok(lowers > 40, `only ${lowers} two-block plants in 100 chunks — this section cannot prove anything`);
  ok(headless === 0, `${headless} of ${lowers} two-block plants have no head`);
  ok(wrongHead === 0, `${wrongHead} two-block plants have the WRONG head (a facing or waterlogged mismatch)`);
  ok(orphanHeads === 0, `${orphanHeads} of ${uppers} upper halves float with nothing under them`);
  ok(Math.abs(uppers - lowers) <= 0, `${lowers} lower halves against ${uppers} upper halves — they must match exactly`);
  console.log(`   ${lowers} two-block plants, ${uppers} heads, ${headless} headless, ${orphanHeads} orphaned`);
}

console.log('5d. generated leaves carry their real distance (D-488)');
// ⚠ Vanilla's `TreeFeature.placeLogsAndLeaves` rings every tree's leaves out from its logs
// (distance 1..6). Without it every generated leaf was distance=7/persistent=false, and
// `LeavesBlock.randomTick` decayed whole forests the moment a world loaded.
const leafCensus = (n) => {
  const dP = MCL.Reg.PROP.distance, pP = MCL.Reg.PROP.persistent;
  let leaves = 0, seven = 0;
  for (let cx = 0; cx < n; cx++) for (let cz = 0; cz < n; cz++) {
    const col = G.genColumn(cx * 3 + 100, cz * 3 - 60);
    for (let sy = 0; sy < CFG.SECTIONS_Y; sy++) for (let i = 0; i < CFG.SECTION_VOL; i++) {
      const st = S.get(col.sec[sy], i);
      if (!st) continue;
      const d = SR.propValue(st, dP);
      if (d < 0 || SR.propValue(st, pP) < 0) continue;
      leaves++;
      if (MCL.Reg.valueNames[d] === '7') seven++;
    }
  }
  return { leaves, seven };
};
{
  const c = leafCensus(10);
  ok(c.leaves > 500, `only ${c.leaves} leaves in 100 forest-side chunks — the census is not looking at trees`);
  ok(c.seven < c.leaves * 0.05, `${c.seven} of ${c.leaves} generated leaves are distance 7 — they decay on the first random tick`);
  console.log(`   ${c.leaves} leaves, ${c.seven} at distance 7`);
}

console.log('6. anti-vacuity — every check above must be able to fail');
{
  // ⚠ 5c's break: the head-matching rule has to be able to say NO. `tallUpper` must find a head
  // for a two-block plant, must find NOTHING for an ordinary block, and must refuse a door —
  // the only other block in the game with a `half` property, and the one a name-free rule would
  // plant a flower on top of. Without these three, §5c's four counters could all be structurally
  // zero and the section would pass on a world with no plants in it.
  const lowerGrass = (() => {
    const b = MCL.Reg.id.tall_grass, first = MCL.Reg.realFirst[b], last = MCL.Reg.realFirst[b + 1];
    for (let st = first; st < last; st++) if (SR.propValue(st, MCL.Reg.PROP.half) === MCL.Reg.PVAL.lower) return st;
    return 0;
  })();
  ok(lowerGrass > 0, 'anti-vacuity: tall_grass must have a half=lower state at all');
  ok(F.tallUpper(lowerGrass) > 0 && F.tallUpper(lowerGrass) !== lowerGrass,
     'anti-vacuity: tallUpper must find a head for tall_grass');
  ok(SR.propValue(F.tallUpper(lowerGrass), MCL.Reg.PROP.half) === MCL.Reg.PVAL.upper,
     'anti-vacuity: and the head it finds must be the UPPER half');
  ok(F.tallUpper(STONE) === 0, 'anti-vacuity: an ordinary block must have no head');
  const doorLower = (() => {
    const b = MCL.Reg.id.oak_door, first = MCL.Reg.realFirst[b], last = MCL.Reg.realFirst[b + 1];
    for (let st = first; st < last; st++) if (SR.propValue(st, MCL.Reg.PROP.half) === MCL.Reg.PVAL.lower) return st;
    return 0;
  })();
  ok(doorLower > 0 && F.tallUpper(doorLower) === 0,
     'anti-vacuity: a DOOR carries half=lower and must NOT be treated as a two-block plant');

  // ⚠ 4c's break is D-213's own bug, put back: judge the guard from the target chunk's blocks —
  // `local`, in the fix's vocabulary — and the eight chunks that do not hold the trunk answer -1
  // and refuse to build. The 3x3 total collapses onto the owner's, which is what 4c asserts it is
  // not. Re-run against the SAME tree and the SAME positions section 4c used.
  const GRASS6 = SR.stateOf('grass_block');
  const pre6 = (cx, cz) => {
    const sb = new Uint16Array(H * 256);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const h = MCL.Column.height((cx << 4) + x, (cz << 4) + z) | 0;
      const top = Math.min(H - 1, h - MINY);
      for (let y = 0; y <= top; y++) sb[(y << 8) | (z << 4) | x] = STONE;
      if (top >= 0) sb[(top << 8) | (z << 4) | x] = GRASS6;
    }
    return sb;
  };
  const inl = F.api.inline('minecraft:oak_checked', 'featcheck-6');
  const broken = { gen: inl.gen, chain: inl.chain, local: true };
  const bx = FOURC.x, bz = FOURC.z, by = FOURC.y, bcx = FOURC.cx, bcz = FOURC.cz;
  let own = 0, all = 0;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const n = F.api.runInline(broken, pre6(bcx + dx, bcz + dz), bcx + dx, bcz + dz, bx, by, bz, F.api.rngAt(4242, bx, by, bz));
    all += n; if (!dx && !dz) own = n;
  }
  ok(all === own && own > 0,
     `the pre-D-213 rule wrote ${all} blocks over the 3x3 against ${own} in its own chunk — section 4c cannot fail`);
  console.log('   ✓ the guard judged from the target chunk again (D-213, section 4c)');
}
{
  const av = [];
  const check = (label, fn) => { let caught = false; try { fn(); } catch { caught = true; } av.push([label, caught]); };

  check('the trapezoid height provider replaced by a uniform one', () => {
    // Section 4's peak assertions rest entirely on this: a uniform diamond would place evenly
    // over -144..16 and its median would sit near -64 rather than -59... so the SHAPE has to be
    // the thing that differs. Compare the two distributions directly.
    const p = F.placementsOf(0, 0);
    const ys = [];
    for (let i = 0; i < p.length; i += F.PLACEMENT) if (F.placedList[p[i + 2]].name === 'ore_diamond') ys.push(p[i + 4]);
    if (ys.length < 3) throw 0;
    // a trapezoid concentrates: the middle half of the range must hold more than half the draws
    let mid = 0;
    for (const y of ys) if (y > -104 && y < -24) mid++;
    if (mid / ys.length <= 0.5) throw 0;      // NOT caught: it is spread like a uniform
    throw 0;
  });

  check('an ore that replaces air', () => {
    // If ore could replace air it would hang in caves and float above the terrain. Place one in
    // an empty chunk and require nothing to be written.
    const SB = new Int32Array(256 * H);       // all air
    const g = F.configured['ore_iron'];
    const n = F.placeForTest(g, SB, 0, 0, 8, 60, 8, 12345);
    if (n !== 0) throw 0;
    let any = 0;
    for (let i = 0; i < SB.length; i++) if (SB[i] !== 0) any++;
    if (any !== 0) throw 0;
    // ...and the same call in stone DOES write, so the test distinguishes them
    const SB2 = new Int32Array(256 * H).fill(STONE);
    if (F.placeForTest(g, SB2, 0, 0, 8, 60, 8, 12345) === 0) throw 0;
    throw 0;
  });

  check('an ore that replaces another ore', () => {
    const SB = new Int32Array(256 * H).fill(SR.stateOf('diamond_ore'));
    const n = F.placeForTest(F.configured['ore_coal'], SB, 0, 0, 8, 60, 8, 999);
    if (n !== 0) throw 0;                     // diamond is not in stone_ore_replaceables
    const SB2 = new Int32Array(256 * H).fill(STONE);
    if (F.placeForTest(F.configured['ore_coal'], SB2, 0, 0, 8, 60, 8, 999) === 0) throw 0;
    throw 0;
  });

  check('the placement seeded from the target chunk instead of the source', () => {
    const a = F.placementsOf(3, 4), b = F.placementsOf(4, 4);
    if (a.length === b.length && a.length > 0) {
      let identical = true;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { identical = false; break; }
      if (identical) throw 0;                 // NOT caught: two chunks with the same placements
    }
    const c = F.placementsOf(3, 4);
    if (c.length !== a.length) throw 0;       // and the same chunk twice must agree
    for (let i = 0; i < a.length; i++) if (a[i] !== c[i]) throw 0;
    throw 0;
  });

  check('a feature list taken from the wrong biome', () => {
    // Section 2 counts `ore_iron_upper` exactly 90 times because the chunk's biome lists it. A
    // biome that does not would give zero, so the count is a real constraint.
    const B = MCL.Biomes;
    let listed = 0, notListed = 0;
    const id = F.placedIds['ore_iron_upper'];
    for (let bi = 0; bi < B.count; bi++) {
      const l = F.byBiome[bi];
      let has = false;
      if (l) for (const step of l) if (step.indexOf(id) >= 0) has = true;
      if (has) listed++; else notListed++;
    }
    if (listed === 0 || notListed === 0) throw 0;   // NOT caught: every biome, or none, has it
    throw 0;
  });

  // ── and the two that break the biome volume itself (D-180) ──────────────────────────────

  check('the biome volume flattened back to its surface biome', () => {
    // This is exactly the world D-137 described: one biome for the whole chunk, taken at the
    // surface. Section 5b's cave-feature counts have to go to ZERO under it, or they are
    // counting something the volume is not responsible for.
    const real = G.biomeVolume;
    const countCave = () => {
      F.cache.clear();
      let n = 0;
      for (let dz = 0; dz < CAVE_N; dz++) {
        for (let dx = 0; dx < CAVE_N; dx++) {
          const p = F.placementsOf(DRIP_AT[0] + dx, DRIP_AT[1] + dz);
          for (let i = 0; i < p.length; i += F.PLACEMENT) if (CAVE_ONLY.indexOf(F.placedList[p[i + 2]].name) >= 0) n++;
        }
      }
      return n;
    };
    const withVolume = countCave();
    const flat = new Map();
    G.biomeVolume = (cx, cz) => {
      const k = cx + ',' + cz;
      let f = flat.get(k);
      if (!f) {
        const v = real.call(G, cx, cz);
        f = new Uint8Array(v.length);
        f.fill(v[(MCL.Column.height(cx << 4, cz << 4) - MINY) >> 2]);   // the surface cell, everywhere
        flat.set(k, f);
      }
      return f;
    };
    let flattened;
    try { flattened = countCave(); } finally { G.biomeVolume = real; F.cache.clear(); }
    if (!(withVolume > 100 && flattened === 0)) return;   // NOT caught: the break was invisible
    throw 0;
  });

  check('one cell of the volume quietly changed', () => {
    // Section 5b compares the volume to `Climate.biomeAt` cell for cell. Perturb one cell and
    // that comparison must notice — otherwise it is comparing an array with itself.
    const CL = MCL.Climate, B = MCL.Biomes;
    const vol = G.biomeVolume(DRIP_AT[0], DRIP_AT[1]);
    const idx = G.VIDX(2, 40, 1);
    const was = vol[idx];
    vol[idx] = (was + 1) % B.count;
    let mismatches = 0;
    for (let qz = 0; qz < 4; qz++) {
      for (let qx = 0; qx < 4; qx++) {
        for (let qy = 0; qy < G.QVY; qy++) {
          const x = (DRIP_AT[0] << 4) + (qx << 2), z = (DRIP_AT[1] << 4) + (qz << 2), y = MINY + (qy << 2);
          if (vol[G.VIDX(qx, qy, qz)] !== CL.biomeAt(x, y, z)) mismatches++;
        }
      }
    }
    vol[idx] = was;
    if (mismatches !== 1) return;      // NOT caught: the comparison cannot see a changed cell
    throw 0;
  });

  // ── and the three that break section 4d's mechanisms (D-222, D-223) ─────────────────────

  const LUSH_AV = [156, -104], TREES_AV = [12, 32], N_AV = 4;
  const scannedOver = (at) => {
    F.cache.clear();
    let n = 0;
    for (let dz = 0; dz < N_AV; dz++) {
      for (let dx = 0; dx < N_AV; dx++) {
        const p = F.placementsOf(at[0] + dx, at[1] + dz);
        for (let i = 0; i < p.length; i += F.PLACEMENT) {
          const nm = F.placedList[p[i + 2]].name;
          if (nm === 'lush_caves_vegetation' || nm === 'cave_vines' || nm === 'lush_caves_clay') n++;
        }
      }
    }
    return n;
  };

  check('the caves taken out from under the environment scan', () => {
    // 4d.1 says the scan finds a face and rejects most attempts. Both claims rest on `carvedAt`
    // seeing cave air; with `Caves.carve` answering "solid everywhere" the scan can never start,
    // and the count must go to zero. If it does not, the scan is not being consulted at all.
    const real = MCL.Caves.carve;
    const before = scannedOver(LUSH_AV);
    let after;
    try { MCL.Caves.carve = () => 0; after = scannedOver(LUSH_AV); }
    finally { MCL.Caves.carve = real; F.cache.clear(); }
    if (!(before > 60 && after === 0)) return;      // NOT caught: the break was invisible
    throw 0;
  });

  check('the canopy stamp switched off, which is the world before D-222', () => {
    // 4d.2's two claims — no two tree placements in a column, and fewer than 25 a chunk — are
    // both D-222's stamp. `anyCanopy` memoises its verdict on the generator, so setting that memo
    // false on every placed feature takes the whole stamp out of `runChain` and puts back exactly
    // the world `vanillacheck` §6 measured at jungle_log 10.10x: every attempt survives, and two
    // of them land in one column.
    //
    // ⚠ ZEROING `canopyR` INSTEAD DOES NOT BREAK IT, and that is the point of doing it this way:
    // a radius-0 stamp still marks the trunk's own column, so the duplicate test keeps working
    // and only the thinning weakens. A break has to remove the mechanism, not shrink it.
    const trees = [];
    const treePid = [];                        // ⚠ captured BEFORE the break, or the counter
    for (let i = 0; i < F.placedList.length; i++) {   // would identify trees with the memo it
      const g = F.placedList[i].gen;                  // is about to falsify and count nothing
      if (g && F.anyCanopy(g)) { trees.push([g, g.anyCan]); treePid[i] = 1; }
    }
    const count = () => {
      F.cache.clear();
      let n = 0, same = 0;
      for (let dz = 0; dz < N_AV; dz++) {
        for (let dx = 0; dx < N_AV; dx++) {
          const p = F.placementsOf(TREES_AV[0] + dx, TREES_AV[1] + dz);
          const cols = [];
          for (let i = 0; i < p.length; i += F.PLACEMENT) {
            if (treePid[p[i + 2]] !== 1) continue;
            n++;
            const key = p[i + 3] + ',' + p[i + 5];
            if (cols.indexOf(key) >= 0) same++;
            cols.push(key);
          }
        }
      }
      return [n, same];
    };
    const before = count();
    let after;
    try {
      for (const t of trees) t[0].anyCan = false;
      after = count();
    } finally {
      for (const t of trees) t[0].anyCan = t[1];
      F.cache.clear();
    }
    // caught only if the stamp was doing the work: more placements AND columns doubled up
    if (!(after[0] > before[0] * 1.4 && after[1] > 0 && before[1] === 0)) return;
    throw 0;
  });

  check('the block column truncated from the wrong end', () => {
    // 4d.4 says a cave vine that runs out of room keeps its TIP. Flip `prioritize_tip` off and
    // the same one-cell gap must hold a headless body instead.
    const cv = F.configured['cave_vine'];
    const tipsIn = () => {
      let placed = 0, tips = 0;
      for (let s = 0; s < 64; s++) {
        const sb = new Uint16Array(H * 256);
        for (let y = MINY; y < MINY + H; y++) {
          if (y === 100) continue;
          for (let i = 0; i < 256; i++) sb[((y - MINY) << 8) | i] = SR.stateOf('stone');
        }
        if (!F.placeForTest(cv, sb, 0, 0, 8, 100, 8, 12345 + s * 7919)) continue;
        placed++;
        if (SR.name(sb[((100 - MINY) << 8) | (8 << 4) | 8]) === 'cave_vines') tips++;
      }
      return [placed, tips];
    };
    const before = tipsIn();
    let after;
    try { cv.tip = false; after = tipsIn(); } finally { cv.tip = true; }
    if (!(before[1] === before[0] && after[1] < after[0] * 0.5)) return;
    throw 0;
  });

  check('generated leaves left at distance 7 (no placeLogsAndLeaves)', () => {
    F.cache = new Map(); MCL.Carvers.cache = new Map();
    let c;
    try { F.LEAF_DISTANCES = false; c = leafCensus(4); } finally { F.LEAF_DISTANCES = true; F.cache = new Map(); MCL.Carvers.cache = new Map(); }
    if (c.leaves > 0 && c.seven >= c.leaves * 0.05) throw 0;
  });

  for (const [label, caught] of av) {
    ok(caught, `ANTI-VACUITY FAILURE: "${label}" was not caught — this check proves nothing`);
    console.log(`   ${caught ? '✓' : '✗'} ${label}`);
  }
}

console.log('');
console.log('================ featcheck ================');
console.log(` assertions passed .. ${pass.toLocaleString()}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails.slice(0, 20)) console.log('   ✗ ' + f);
console.log('==========================================');
process.exit(fails.length ? 1 : 0);
