#!/usr/bin/env node
// surfcheck.mjs — PLAN W6's acceptance test for the surface rules.
//
//   node tools/surfcheck.mjs [--print]
//
// PLAN W6: *"cross-sections show correct surface stacks in ≥10 biomes."*
//
// Section 3 does that in 30, and it does it by DRIVING THE RULES DIRECTLY rather than by
// hunting the world for a column of each biome. That matters twice over: a rare biome would
// otherwise go untested, and a stack that came out wrong would be ambiguous between a broken
// rule and a broken biome dispatch. The world-shaped version is section 7, which prints
// cross-sections a person can read.
//
// The expected stacks are typed out from the game, the same method the mesh reference and the
// biome colour table use. Some of them are worth stating because they surprise people:
//
//   * `snowy_plains` is GRASS. The snow on top is `top_layer_modification`, a decoration
//     feature, and W8 places it — not a surface rule.
//   * every ocean floor is GRAVEL except the warm ones, which are sand.
//   * a badlands below y≈74 is RED SAND, and the terracotta bands only start above it.
//   * `stony_shore` is stone with occasional gravel, not sand.
//
// ⚠ SECTION 8 IS THE ONE THAT LOOKS AT THE WORLD (D-215). Everything above drives the rule tree
// with a biome this file chose; section 8 generates 1,296 chunks across four seeds and asserts
// that the block on top of every column is one vanilla's own surface rules are allowed to put in
// THAT column's biome. Nothing in Track W had ever put the two lookups together.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PRINT = process.argv.includes('--print');
const SEED = 1337n;

let pass = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); };

const MCL = loadEngine({});
MCL.Column.init(SEED);
MCL.Earth.init({});
MCL.Surface.init(SEED);
const B = MCL.Biomes, SF = MCL.Surface, S = MCL.States, C = MCL.Column, WG = MCL.WG, CL = MCL.Climate;
// D-215's section 8 reads a GENERATED world rather than driving the rules, so it needs the
// generator, the chunk geometry and the section accessor as well as the rule interpreter.
const G = MCL.Gen, CFG = MCL.CFG, SEC = MCL.Section;
// ⚠ CLIMATE EXPLICIT: VANILLA, BY NAME (D-182). The expected stacks above are typed out from
// the real game's biome dispatch; this file never drove biome placement through a mode at all
// before, it just inherited `Climate`'s own module-load default. That default happened to be
// vanilla and still is, but "happened to be" is exactly the thing D-182 requires every check to
// stop relying on — say it, don't inherit it.
CL.setMode(CL.MODE_VANILLA);
const nm = (s) => (s ? S.name(s) : 'stone');

// ─────────────────────────────────────────────── 1. the compiled tree
console.log('1. the tree, against the JSON it was compiled from');
{
  ok(SF.ready, 'Surface.init did not run');
  const src = WG.get('noise_settings', 'overworld').surface_rule;
  ok(!!src, 'noise_settings/overworld has no surface_rule');

  // count the source's nodes independently of the compiler
  const rules = {}, conds = {}, states = [];
  (function walk(o, inCond) {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach((x) => walk(x, inCond)); return; }
    if (typeof o.type === 'string') {
      const t = o.type.replace('minecraft:', '');
      if (inCond) conds[t] = (conds[t] || 0) + 1; else rules[t] = (rules[t] || 0) + 1;
    }
    if (o.result_state) states.push(o.result_state);
    for (const k of Object.keys(o)) walk(o[k], k === 'if_true' || k === 'invert');
  })(src, false);

  ok(SF.stats.rules === Object.values(rules).reduce((a, b) => a + b, 0),
     `the compiler saw ${SF.stats.rules} rules, the JSON has ${Object.values(rules).reduce((a, b) => a + b, 0)}`);
  ok(SF.stats.conditions === Object.values(conds).reduce((a, b) => a + b, 0),
     `the compiler saw ${SF.stats.conditions} conditions, the JSON has ${Object.values(conds).reduce((a, b) => a + b, 0)}`);
  ok(SF.stats.blocks === states.length, `${SF.stats.blocks} block rules compiled, ${states.length} in the JSON`);
  ok(SF.stats.unresolved.length === 0, `${SF.stats.unresolved.length} block states did not resolve: ${SF.stats.unresolved.slice(0, 3).join(' ')}`);
  // PLAN's own numbers for this stage
  ok(Object.keys(conds).length === 11, `${Object.keys(conds).length} condition types, PLAN says 11`);
  ok(Object.keys(rules).length === 4, `${Object.keys(rules).length} rule types, PLAN says 4`);
  if (PRINT) console.log('   rules ' + JSON.stringify(rules) + '\n   conditions ' + JSON.stringify(conds));

  // every state the tree places must resolve, and every one but the single `air` rule must be
  // a real block — a rule that silently placed air would carve holes in the world
  let air = 0, bad = 0;
  for (const st of states) {
    const s = WG.stateOf(st);
    if (st.Name === 'minecraft:air') { air++; continue; }
    if (s > 0 && nm(s) === st.Name.replace('minecraft:', '')) pass++; else { bad++; fails.length < 40 && fails.push(`${JSON.stringify(st)} resolved to ${s} (${nm(s)})`); }
  }
  ok(bad === 0, `${bad} of the tree's block states do not resolve to the block they name`);
  ok(air === 1, `${air} rules place air, expected exactly 1`);

  // the five states that carry properties must not silently fall back to a default
  const PROPPED = [
    [{ Name: 'minecraft:deepslate', Properties: { axis: 'y' } }, 'deepslate'],
    [{ Name: 'minecraft:water', Properties: { level: '0' } }, 'water'],
    [{ Name: 'minecraft:grass_block', Properties: { snowy: 'false' } }, 'grass_block'],
    [{ Name: 'minecraft:mycelium', Properties: { snowy: 'false' } }, 'mycelium'],
    [{ Name: 'minecraft:podzol', Properties: { snowy: 'false' } }, 'podzol'],
  ];
  for (const [node, name] of PROPPED) {
    const s = WG.stateOf(node);
    ok(s > 0 && nm(s) === name, `${JSON.stringify(node)} resolved to ${nm(s)}`);
    // and the local index must be the one the block's own default uses, since all five ARE
    // defaults in 1.18.2 — if that ever stops being true this line is where it shows
    ok(s === S.stateOf(name), `${name}'s propertied state ${s} is not its default ${S.stateOf(name)}`);
  }
  // a property the data does NOT name must not resolve — the table only holds what is used
  ok(WG.stateOf({ Name: 'minecraft:deepslate', Properties: { axis: 'x' } }) === 0,
     'a block state the worldgen never names resolved anyway');
}

// ─────────────────────────────────────────────── 2. the clay bands
console.log('2. the clay bands');
{
  const bands = SF.clayBands();
  ok(bands.length === 192, `${bands.length} clay bands, vanilla has 192`);
  const hist = new Map();
  for (const s of bands) hist.set(nm(s), (hist.get(nm(s)) || 0) + 1);
  const kinds = [...hist.keys()].sort();
  const EXPECT = ['brown_terracotta', 'light_gray_terracotta', 'orange_terracotta', 'red_terracotta',
                  'terracotta', 'white_terracotta', 'yellow_terracotta'];
  ok(kinds.join(' ') === EXPECT.join(' '), `the bands are made of [${kinds.join(' ')}]`);
  ok((hist.get('terracotta') || 0) > 40, `only ${hist.get('terracotta')} of 192 bands are plain terracotta`);
  ok((hist.get('white_terracotta') || 0) >= 9 && (hist.get('white_terracotta') || 0) <= 15,
     `${hist.get('white_terracotta')} white bands, vanilla draws between 9 and 15`);
  ok((hist.get('orange_terracotta') || 0) > 20, `${hist.get('orange_terracotta')} orange bands looks too few`);
  // deterministic, and a function of the seed
  const again = MCL.Surface.clayBands();
  ok(bands.every((v, i) => v === again[i]), 'the clay bands changed between two reads');
  // the band lookup wraps, including below y = 0
  let oob = 0;
  for (let y = -200; y < 400; y += 7) { const s = SF.band(0, y, 0); if (bands.indexOf(s) >= 0) pass++; else oob++; }
  ok(oob === 0, `${oob} band lookups returned something that is not in the table`);
  if (PRINT) console.log('   ' + [...hist.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ':' + v).join(' '));
}

// ─────────────────────────────────────────────── 3. the surface stacks, in 30 biomes
console.log('3. the surface stack, driven straight into the rules — 30 biomes');
{
  // biome, the height to put it at, and the blocks the top four may be made of. A set rather
  // than a sequence because `surfaceDepth` legitimately varies by a block or two and because
  // several biomes are a deliberate mixture.
  const ABOVE = 70, PEAK = 150, SLOPE = 140, FLOOR = 45;
  const REF = [
    ['plains',          ABOVE, ['grass_block', 'dirt', 'stone']],
    ['forest',          ABOVE, ['grass_block', 'dirt', 'stone']],
    ['birch_forest',    ABOVE, ['grass_block', 'dirt', 'stone']],
    ['dark_forest',     ABOVE, ['grass_block', 'dirt', 'stone']],
    ['flower_forest',   ABOVE, ['grass_block', 'dirt', 'stone']],
    ['taiga',           ABOVE, ['grass_block', 'dirt', 'stone']],
    ['jungle',          ABOVE, ['grass_block', 'dirt', 'stone']],
    ['savanna',         ABOVE, ['grass_block', 'dirt', 'stone']],
    ['meadow',          ABOVE, ['grass_block', 'dirt', 'stone']],
    ['swamp',           ABOVE, ['grass_block', 'dirt', 'stone']],
    // ⚠ GRASS, not snow. The snow layer on a snowy plains is `top_layer_modification`, a
    // decoration feature (W8), and no surface rule places it.
    ['snowy_plains',    ABOVE, ['grass_block', 'dirt', 'stone']],
    ['desert',          ABOVE, ['sand', 'sandstone']],
    ['mushroom_fields', ABOVE, ['mycelium', 'dirt', 'stone']],
    // ⚠ Below y≈74 a badlands is RED SAND over red sandstone; above it the clay BANDS start, and
    // the bands are the seven terracotta colours `SurfaceSystem.generateBands` mixes. A wooded
    // badlands above y=97 gets coarse dirt and grass on top of that again. All three heights
    // occur in the sampled columns, so all three palettes belong in one set.
    ['badlands',        ABOVE, ['red_sand', 'red_sandstone', 'terracotta', 'orange_terracotta', 'yellow_terracotta',
                          'brown_terracotta', 'red_terracotta', 'white_terracotta', 'light_gray_terracotta',
                          'coarse_dirt', 'grass_block', 'dirt', 'stone']],
    ['eroded_badlands', ABOVE, ['red_sand', 'red_sandstone', 'terracotta', 'orange_terracotta', 'yellow_terracotta',
                          'brown_terracotta', 'red_terracotta', 'white_terracotta', 'light_gray_terracotta',
                          'coarse_dirt', 'grass_block', 'dirt', 'stone']],
    ['wooded_badlands', ABOVE, ['red_sand', 'red_sandstone', 'terracotta', 'orange_terracotta', 'yellow_terracotta',
                          'brown_terracotta', 'red_terracotta', 'white_terracotta', 'light_gray_terracotta',
                          'coarse_dirt', 'grass_block', 'dirt', 'stone']],
    ['beach',           ABOVE, ['sand', 'sandstone', 'stone']],
    ['snowy_beach',     ABOVE, ['sand', 'sandstone', 'stone']],
    ['stony_shore',     ABOVE, ['stone', 'gravel']],
    ['windswept_hills', ABOVE, ['grass_block', 'dirt', 'stone']],
    ['windswept_gravelly_hills', ABOVE, ['grass_block', 'dirt', 'stone', 'gravel']],
    // The ocean floors: gravel everywhere except where the water is warm — but ⚠ only where the
    // water is DEEP. Vanilla's rule is `water(offset -6, multiplier -1, add_stone_depth)`, so a
    // floor within about six blocks of the surface is DIRT and only a deeper one is gravel.
    // That is why a river bed is dirt and an ocean trench is gravel, and it is worth having in
    // the reference rather than discovering it as a failure.
    ['ocean',           FLOOR, ['gravel', 'dirt', 'stone']],
    ['deep_ocean',      FLOOR, ['gravel', 'dirt', 'stone']],
    ['cold_ocean',      FLOOR, ['gravel', 'dirt', 'stone']],
    ['frozen_ocean',    FLOOR, ['gravel', 'dirt', 'stone']],
    ['river',           FLOOR, ['gravel', 'dirt', 'stone']],
    ['warm_ocean',      FLOOR, ['sand', 'sandstone', 'dirt', 'stone']],
    ['lukewarm_ocean',  FLOOR, ['sand', 'sandstone', 'dirt', 'stone']],
    // and the shallow-floor rule again, from the other side: a beach IS a shallow floor
    // the mountains
    ['frozen_peaks',    PEAK,  ['snow_block', 'packed_ice', 'ice', 'stone']],
    ['jagged_peaks',    PEAK,  ['snow_block', 'stone']],
    ['stony_peaks',     PEAK,  ['stone', 'calcite', 'gravel']],
    ['grove',           SLOPE, ['snow_block', 'powder_snow', 'dirt', 'stone']],
    ['snowy_slopes',    SLOPE, ['snow_block', 'powder_snow', 'stone']],
  ];
  ok(REF.length >= 10, `${REF.length} biomes in the reference, PLAN asks for at least 10`);

  // ⚠ The columns are REAL ones, found by height, not invented. `above_preliminary_surface`
  // reads `Column.height` at the four corners of the 16-block cell, so telling the rules that
  // the surface is at y=70 while the terrain there is at y=45 puts every block below the real
  // preliminary surface and the whole tree falls through to stone. The first draft of this
  // section did exactly that and reported that four biomes were made of stone.
  const pools = new Map();          // band -> [[x, z, h], ...]
  const BANDS = { FLOOR: [40, 56], ABOVE: [64, 95], SLOPE: [120, 150], PEAK: [140, 240] };
  for (const k of Object.keys(BANDS)) pools.set(BANDS[k][0], []);
  for (let k = 0; k < 260000 && [...pools.values()].some((p) => p.length < 48); k++) {
    const x = ((k * 7919) % 60000) - 30000, z = ((k * 104729) % 60000) - 30000;
    const h = C.height(x, z);
    for (const key of Object.keys(BANDS)) {
      const [lo, hi] = BANDS[key];
      const pool = pools.get(lo);
      if (h >= lo && h <= hi && pool.length < 48) pool.push([x, z, h]);
    }
  }
  for (const key of Object.keys(BANDS)) {
    ok(pools.get(BANDS[key][0]).length === 48,
       `only ${pools.get(BANDS[key][0]).length} of 48 real columns found with height in ${BANDS[key].join('..')}`);
  }
  const poolFor = (h) => pools.get(h === FLOOR ? 40 : h === PEAK ? 140 : h === SLOPE ? 120 : 64);

  const rows = [];
  for (const [name, hBand, allowed] of REF) {
    const bi = B.index(name);
    const set = new Set(allowed);
    const seen = new Map();
    const pool = poolFor(hBand);
    let bad = 0;
    for (const [x, z, h] of pool) {
      const waterY = h < C.seaLevel ? C.seaLevel : SF.NO_WATER;
      SF.beginColumn(x, z, bi, h, waterY);
      for (let y = h; y > h - 4; y--) {
        const b = nm(SF.at(y));
        seen.set(b, (seen.get(b) || 0) + 1);
        if (set.has(b)) pass++; else { bad++; if (fails.length < 40 && bad < 3) fails.push(`${name} at y=${y} (surface ${h}) is ${b}, not one of [${allowed.join(' ')}]`); }
      }
    }
    ok(bad === 0, `${name}: ${bad} of ${pool.length * 4} sampled blocks were not in its expected set`);
    // and the top block must not be the default: a biome whose rules never fire is a bug that
    // looks exactly like "the world is made of stone"
    const topSeen = new Set();
    for (const [x, z, h] of pool.slice(0, 12)) {
      SF.beginColumn(x, z, bi, h, h < C.seaLevel ? C.seaLevel : SF.NO_WATER);
      topSeen.add(nm(SF.at(h)));
    }
    ok(!(topSeen.size === 1 && topSeen.has('stone')) || name === 'stony_shore' || name === 'stony_peaks' || name === 'jagged_peaks',
       `${name}'s top block is always plain stone — its rules never fired`);
    rows.push([name, [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ':' + v).join(' ')]);
  }
  if (PRINT) for (const [n, s] of rows) console.log('   ' + n.padEnd(26) + s);
}

// ─────────────────────────────────────────────── 3b. the swamp's water (D-225)
//
// ⚠ THE ONLY CLAUSE IN THE WHOLE TREE THAT NAMES A SINGLE BLOCK OF y, AND NOTHING ELSE IN
// THIS FILE COULD SEE IT. Vanilla's swamp is open water because of four nested conditions —
// biome swamp, `y_above 62`, NOT `y_above 63`, and `surface_swamp >= 0` — which fire on the
// column's TOP block and only when that block is exactly y = 62. Section 3 drives every biome
// at y = 70 and section 8 asks only whether the block on top is one vanilla is ALLOWED to place
// there; grass_block is allowed in a swamp, so a world whose swamps were entirely dry passed
// both, and it took the golden world to notice (65.6% top-block agreement, every other biome
// 79-100%).
//
// The cause was not the rule. It was the TERRAIN: `HEIGHT_CURVE`'s sea-level anchor put
// swamp columns at y 64-67, so the clause's `y == 62 && stoneDepth == 1` gate was never
// reachable. So this section asserts BOTH halves — that the compiled rule behaves exactly as
// the JSON says, and that the world it is run over actually presents it with y = 62.
function swampWaterFraction(chunks) {
  const H = CFG.CHUNK_H, SWAMP = B.index('swamp');
  let n = 0, water = 0, atOrBelowSea = 0;
  G.init(1337, Object.assign(G.defaults(), { climate: 'vanilla', features: false, structures: false }));
  for (const [cx, cz] of chunks) {
    const col = G.genColumn(cx, cz);
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        if (col.biome[(z << 4) | x] !== SWAMP) continue;
        for (let y = H - 1; y >= 0; y--) {
          const v = SEC.get(col.sec[y >> 4], ((y & 15) << 8) | (z << 4) | x);
          if (!v) continue;
          n++;
          if (S.name(v).split('[')[0] === 'water') water++;
          if (y + CFG.WORLD_MIN_Y <= C.seaLevel) atOrBelowSea++;
          break;
        }
      }
    }
  }
  G.init(Number(SEED), Object.assign(G.defaults(), { climate: 'vanilla' }));
  return { n, water, atOrBelowSea };
}
// The golden world's own swamp, at seed 1337. `where.mjs`-style scanning found every swamp
// chunk in the 13,307-chunk pregen inside one area; these are chunks out of it.
const SWAMP_CHUNKS = [];
for (let cx = -580; cx <= -570; cx++) for (let cz = -324; cz <= -314; cz++) SWAMP_CHUNKS.push([cx, cz]);

console.log("3b. the swamp clause — the one rule in the tree that names a single y (D-225)");
{
  // ── (a) the clause is in the shipped JSON, in the shape the port relies on ──────────────
  // Asserted rather than assumed: if Mojang's data ever stopped saying this, everything below
  // would be testing a fiction. This is the same discipline colcheck §3c uses on `depth.json`.
  let clause = null;
  (function walk(n) {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!n || typeof n !== 'object') return;
    const t = (n.type || '').replace('minecraft:', '');
    if (t === 'condition') {
      const c = n.if_true || {};
      if ((c.type || '').replace('minecraft:', '') === 'biome'
          && Array.isArray(c.biome_is) && c.biome_is.length === 1 && c.biome_is[0] === 'minecraft:swamp') clause = n.then_run;
      walk(n.then_run); return;
    }
    if (t === 'sequence') { n.sequence.forEach(walk); return; }
  })(WG.get('noise_settings', 'overworld').surface_rule);
  ok(!!clause, 'the overworld surface rule no longer has a clause gated on biome swamp alone');
  const a = clause || {}, aC = a.if_true || {};
  ok((aC.type || '').replace('minecraft:', '') === 'y_above' && (aC.anchor || {}).absolute === 62
     && aC.add_stone_depth === false && aC.surface_depth_multiplier === 0,
     'the swamp clause no longer opens with `y_above absolute 62`');
  const b2 = (a.then_run || {}), bC = b2.if_true || {};
  ok((bC.type || '').replace('minecraft:', '') === 'not'
     && ((bC.invert || {}).anchor || {}).absolute === 63,
     'the swamp clause no longer bounds itself above with NOT y_above 63');
  const c3 = (b2.then_run || {}), cC = c3.if_true || {};
  ok((cC.type || '').replace('minecraft:', '') === 'noise_threshold' && cC.noise === 'minecraft:surface_swamp'
     && cC.min_threshold === 0.0,
     'the swamp clause no longer thresholds `minecraft:surface_swamp` at 0');
  ok(((c3.then_run || {}).result_state || {}).Name === 'minecraft:water',
     'the swamp clause no longer places water');
  // and the noise it names is really in the packed registry, with vanilla's parameters
  const np = WG.get('noise', 'surface_swamp');
  ok(!!np && np.firstOctave === -2 && Array.isArray(np.amplitudes) && np.amplitudes.length === 1 && np.amplitudes[0] === 1.0,
     `minecraft:surface_swamp is packed as ${JSON.stringify(np)}, not vanilla's firstOctave -2 / [1.0]`);

  // ── (b) driven directly: water exactly where the noise is non-negative ──────────────────
  // ⚠ THE EXPECTATION IS THE NOISE'S SIGN, NOT A COUNT MC-LITE PRODUCED. `noise_threshold` is
  // `min <= v <= max` with max = +INF, so the clause fires iff `surface_swamp(x, 0, z) >= 0`,
  // and that is a statement about the JSON, not about this engine's output.
  const SW = B.index('swamp'), FOREST = B.index('forest');
  const nz = SF.noise('surface_swamp');
  let pos = 0, neg = 0, wrongPos = 0, wrongNeg = 0, holes = 0;
  let waterAt61 = 0, waterAt63 = 0, waterInForest = 0;
  for (let k = 0; k < 4000; k++) {
    const x = -9400 + ((k * 37) % 600), z = -5300 + ((k * 53) % 600);
    // the same column top vanilla realises in a swamp: y = 62 is the top block of the run
    const isW = (y, biome) => {
      const st = SF.stateAt(x, y, z, biome, 62, SF.NO_WATER);
      return st !== 0 && S.name(st).split('[')[0] === 'water';
    };
    SF.stateAt(x, 62, z, SW, 62, SF.NO_WATER);
    // ⚠ TWO COLUMNS THE CLAUSE IS NOT RESPONSIBLE FOR, AND THEY ARE SKIPPED BY NAME. `hole`
    // (surfaceDepth <= 0) is a branch of the tree that wins earlier; `minSurface > 62` is the
    // `above_preliminary_surface` guard saying the surface-gated half of the tree has no
    // opinion at this y at all, which is true wherever the REAL terrain here is far above 62.
    // Neither is a swamp column at y = 62, and counting them would make this a test of the
    // guard rather than of the clause. Both are reported, so a skip that ate the sample shows.
    if (SF.context().surfaceDepth <= 0 || SF.context().minSurface > 62) { holes++; continue; }
    const v = nz.get(x, 0, z);
    if (v >= 0) { pos++; if (!isW(62, SW)) wrongPos++; }
    else { neg++; if (isW(62, SW)) wrongNeg++; }
    if (isW(61, SW)) waterAt61++;
    if (isW(63, SW)) waterAt63++;
    if (isW(62, FOREST)) waterInForest++;
  }
  ok(pos > 800 && neg > 800, `surface_swamp was non-negative in ${pos} of ${pos + neg} sampled columns — the sample is one-sided and (b) is vacuous`);
  ok(holes < 1600, `${holes} of 4000 sampled columns were skipped as holes or above-guard — the skip has eaten the sample`);
  ok(wrongPos === 0, `${wrongPos} of ${pos} swamp columns with surface_swamp >= 0 did NOT get water at y=62`);
  ok(wrongNeg === 0, `${wrongNeg} of ${neg} swamp columns with surface_swamp < 0 got water at y=62 anyway`);
  // ── (c) height-exact and (d) biome-exact ───────────────────────────────────────────────
  ok(waterAt61 === 0, `the swamp clause put water at y=61 in ${waterAt61} columns — its NOT y_above 63 / y_above 62 pair is not exact`);
  ok(waterAt63 === 0, `the swamp clause put water at y=63 in ${waterAt63} columns — its NOT y_above 63 bound is not being applied`);
  ok(waterInForest === 0, `${waterInForest} FOREST columns got the swamp clause's water — the biome gate is not being applied`);
  if (PRINT) console.log(`   driven: ${pos} columns noise>=0 -> water, ${neg} noise<0 -> not water, ${holes} holes skipped`);

  // ── (e) THE HALF THAT WAS ACTUALLY BROKEN: the world has to present y = 62 ──────────────
  // ⚠ THE BAND IS THE REAL GAME'S, AND IT IS A BAND (D-30, D-152). `vanillacheck` §3 measures
  // the actual 1.18.2 server at **62% water on top of `swamp`** over 1,792 golden columns; a
  // FLOOR could not tell "fixed" from "flooded", so this is 40..85 around that number. It must
  // never be re-anchored on what MC-Lite happens to print — that is D-152's whole lesson.
  const sw = swampWaterFraction(SWAMP_CHUNKS);
  const frac = sw.n ? 100 * sw.water / sw.n : 0;
  ok(sw.n >= 2000, `only ${sw.n} swamp columns in the sampled area — 3b(e) is measuring almost nothing`);
  ok(frac >= 40 && frac <= 85,
     `${frac.toFixed(1)}% of swamp columns are water on top; the real game is 62% (vanillacheck §3) and this is outside 40..85`);
  // and the mechanism behind it, stated separately so a pass cannot come from the wrong cause:
  // vanilla's swamp terrain sits AT OR BELOW sea level, which is what makes the clause reachable.
  const low = sw.n ? 100 * sw.atOrBelowSea / sw.n : 0;
  ok(low >= 70, `only ${low.toFixed(1)}% of swamp columns top out at or below sea level — the terrain is too high for the y=62 clause to fire (D-225)`);
  if (PRINT) console.log(`   world: ${sw.n} swamp columns, ${frac.toFixed(1)}% water on top, ${low.toFixed(1)}% at or below sea level`);
}

// ─────────────────────────────────────────────── 4. depths, anchors and the gradients
console.log('4. the depths, the anchors, bedrock and the deepslate line');
{
  // stone depth arithmetic — the thing deviation #1 makes exact
  SF.beginColumn(0, 0, B.index('plains'), 100, SF.NO_WATER);
  for (const y of [100, 99, 90, 0, -64]) {
    SF.at(y);
    const c = SF.context();
    ok(c.stoneDepthAbove === 100 - y + 1, `stoneDepthAbove at y=${y} is ${c.stoneDepthAbove}`);
    ok(c.stoneDepthBelow === y - C.minY + 1, `stoneDepthBelow at y=${y} is ${c.stoneDepthBelow}`);
  }
  // anchors
  ok(SF.anchorY({ absolute: 63 }) === 63, 'an absolute anchor moved');
  ok(SF.anchorY({ above_bottom: 5 }) === C.minY + 5, 'above_bottom does not count from the world floor');
  ok(SF.anchorY({ below_top: 0 }) === C.worldTop - 1, 'below_top does not count from the world top');

  // surfaceDepth: about three blocks, never wildly out
  let lo = 99, hi = -99, holes = 0;
  for (let k = 0; k < 4000; k++) {
    const d = SF.surfaceDepthAt((k * 7919) % 20000 - 10000, (k * 104729) % 20000 - 10000);
    if (d < lo) lo = d; if (d > hi) hi = d;
    if (d <= 0) holes++;
    if (d >= -2 && d <= 9) pass++;
  }
  ok(lo >= -2 && hi <= 9, `surface depth runs ${lo}..${hi}, which is not the 3-ish vanilla makes`);
  ok(hi > lo, 'the surface depth is a constant — its noise is not being read');
  if (PRINT) console.log(`   surface depth ${lo}..${hi} over 4,000 columns, ${holes} of them holes`);

  // bedrock: always at the floor, never above floor+4, and speckled in between
  const bi = B.index('plains');
  let floorAll = 0, above = 0;
  const speck = [0, 0, 0, 0, 0];
  for (let k = 0; k < 600; k++) {
    const x = ((k * 3137) % 9000) - 4500, z = ((k * 6151) % 9000) - 4500;
    SF.beginColumn(x, z, bi, 80, SF.NO_WATER);
    if (nm(SF.at(C.minY)) === 'bedrock') floorAll++;
    for (let d = 0; d < 5; d++) if (nm(SF.at(C.minY + d)) === 'bedrock') speck[d]++;
    if (nm(SF.at(C.minY + 5)) === 'bedrock') above++;
  }
  ok(floorAll === 600, `${600 - floorAll} of 600 columns have no bedrock on the world floor`);
  ok(above === 0, `${above} columns have bedrock five blocks above the floor, where vanilla's gradient is already false`);
  ok(speck[1] > 0 && speck[1] < 600, `the bedrock layer at floor+1 is ${speck[1]}/600 — it should be speckled, not solid or absent`);
  ok(speck[1] > speck[2] && speck[2] > speck[3], `the bedrock gradient is not monotone: ${speck.join(' ')}`);
  if (PRINT) console.log('   bedrock by height above the floor: ' + speck.join(' ') + ' of 600');

  // the deepslate line: solid below 0, gone by 8, speckled between
  let deepLow = 0, stoneHigh = 0;
  const dspeck = [];
  for (let y = -1; y <= 8; y++) dspeck.push(0);
  for (let k = 0; k < 600; k++) {
    const x = ((k * 8191) % 9000) - 4500, z = ((k * 2749) % 9000) - 4500;
    SF.beginColumn(x, z, bi, 80, SF.NO_WATER);
    if (nm(SF.at(-20)) === 'deepslate') deepLow++;
    if (nm(SF.at(20)) === 'stone') stoneHigh++;
    for (let y = -1; y <= 8; y++) if (nm(SF.at(y)) === 'deepslate') dspeck[y + 1]++;
  }
  ok(deepLow === 600, `${600 - deepLow} of 600 columns are not deepslate at y=-20`);
  ok(stoneHigh === 600, `${600 - stoneHigh} of 600 columns are not plain stone at y=20`);
  ok(dspeck[0] === 600, 'y=-1 is not solid deepslate');
  ok(dspeck[9] === 0, 'y=8 still has deepslate, where the gradient is already false');
  let mono = true;
  for (let i = 1; i < dspeck.length; i++) if (dspeck[i] > dspeck[i - 1] + 20) mono = false;
  ok(mono, `the deepslate gradient is not monotone: ${dspeck.join(' ')}`);
  if (PRINT) console.log('   deepslate from y=-1 to y=8: ' + dspeck.join(' ') + ' of 600');
}

// ─────────────────────────────────────────────── 5. purity
console.log('5. purity — the same column in three orders');
{
  const pts = [];
  for (let i = 0; i < 300; i++) pts.push([((i * 7919) % 9000) - 4500, 40 + (i % 90), ((i * 104729) % 9000) - 4500]);
  const bi = B.index('plains');
  const one = pts.map(([x, y, z]) => SF.stateAt(x, y, z, bi, 90, SF.NO_WATER));
  const two = [];
  for (let i = pts.length - 1; i >= 0; i--) two[i] = SF.stateAt(pts[i][0], pts[i][1], pts[i][2], bi, 90, SF.NO_WATER);
  const order = pts.map((_, i) => i).sort((a, b) => ((a * 2654435761) % 997) - ((b * 2654435761) % 997));
  const three = [];
  for (const i of order) three[i] = SF.stateAt(pts[i][0], pts[i][1], pts[i][2], bi, 90, SF.NO_WATER);
  let diff = 0;
  for (let i = 0; i < pts.length; i++) { if (one[i] === two[i] && one[i] === three[i]) pass++; else diff++; }
  ok(diff === 0, `${diff} of ${pts.length} positions changed when sampled in a different order`);

  // and a second engine built from the same seed must agree block for block
  const other = loadEngine({});
  other.Column.init(SEED); other.Earth.init({}); other.Surface.init(SEED);
  let cross = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = one[i];
    const b = other.Surface.stateAt(pts[i][0], pts[i][1], pts[i][2], bi, 90, other.Surface.NO_WATER);
    if (a === b) pass++; else cross++;
  }
  ok(cross === 0, `${cross} positions differ between two engines built from the same seed`);
}

// ─────────────────────────────────────────────── 6. cost
console.log('6. cost');
{
  const bi = B.index('plains');
  const t0 = Date.now();
  let acc = 0;
  for (let k = 0; k < 256; k++) {
    SF.beginColumn(k & 15, (k >> 4) & 15, bi, 80, SF.NO_WATER);
    for (let y = 80; y > 80 - 48; y--) acc += SF.at(y);
  }
  const ms = Date.now() - t0;
  ok(ms < 400, `48 blocks x 256 columns of surface rules took ${ms} ms — a chunk cannot afford that`);
  ok(acc !== 0, 'the timing loop optimised itself away');
  console.log(`   ${(256 * 48).toLocaleString()} rule evaluations in ${ms} ms · init ${SF.initMs} ms`);
}

// ─────────────────────────────────────────────── 7. cross-sections a person can read
console.log('7. cross-sections');
{
  const lines = [];
  for (const [x0, z0, label] of [[0, 0, 'origin'], [3000, -2000, 'jungle-ish'], [-5000, 3000, 'savanna-ish'], [-1200, 800, 'ocean-ish']]) {
    const parts = [];
    for (let i = 0; i < 6; i++) {
      const x = x0 + i * 37, z = z0 + i * 53;
      const h = C.height(x, z);
      const bname = CL.biomeNames[CL.biomeAt(x, h, z)].replace('minecraft:', '');
      const bi = B.index(bname);
      SF.beginColumn(x, z, bi, h, h < C.seaLevel ? C.seaLevel : SF.NO_WATER);
      const st = [];
      for (let y = h; y > h - 5; y--) st.push(nm(SF.at(y)).replace('_terracotta', '_tc').slice(0, 11));
      parts.push(`y${String(h).padStart(3)} ${bname.slice(0, 16).padEnd(16)} ${st.join(',')}`);
    }
    lines.push('   ' + label + ':');
    for (const p of parts) lines.push('     ' + p);
  }
  // always printed: this is the artefact PLAN's acceptance names
  for (const l of lines) console.log(l);
  ok(lines.length > 8, 'the cross-sections are empty');
}

// ─────────────────────────────────────────────── 8. the world, not the rules
//
// ⚠ SECTIONS 1-7 DRIVE THE RULES. THIS ONE READS THE WORLD THEY MADE, and until D-215 nothing
// in Track W did: `surfcheck` asked the rule tree what it would put at a column it was handed,
// `biomecheck` asked which biome a position is, and no check ever put the two questions
// together and asked whether the block on top of a plains column is a block a PLAINS can have.
// The gap is exactly the shape `docs/archive/NEXT.md` warns about — "the bugs live in the JOINS between
// stages" — and a 49-chunk audit walked into it: 58% of an all-plains sample was sand.
//
// ── WHERE THE EXPECTATION COMES FROM, AND WHERE IT MUST NOT ──────────────────────────────
// `allowedByBiome()` walks `noise_settings/overworld.json`'s `surface_rule` ITSELF, carrying
// the intersection of the enclosing `biome` conditions down to each `block` rule. It never asks
// `Surface`, `States` or any compiled table what a rule places — D-152, D-178 and D-194 are
// three separate occasions on which this project wrote an expectation out of the thing it was
// testing, and the walker is deliberately a second, dumber reader of the same JSON. Out of the
// 1.18.2 tree it yields six UNGATED blocks (bedrock, deepslate, dirt, grass_block, gravel,
// stone) and a gate for every other one: `sand` and `sandstone` can be placed in SIX biomes —
// beach, snowy_beach, desert, warm_ocean, lukewarm_ocean, deep_lukewarm_ocean — and in no
// other. A plains column topped with sand is therefore not a thing vanilla's surface rules can
// produce, and that is the assertion.
//
// ── THE WORLD IT AUDITS HAS ITS FEATURES OFF, AND THAT IS THE POINT (D-215) ───────────────
// Features, structures and carvers all legitimately put a block on top of a column that the
// surface rules would never have put there — vanilla's own `disk_sand` is in the plains feature
// list and vanilla's own plains has 3.6% sand because of it. So a containment test run over a
// DECORATED world would be asserting something false about vanilla too. With `features`,
// `structures`, `caves` and `carvers` off, every block in this table was written by the surface
// rules or by the terrain fill underneath them, and containment is exactly the right standard.
// The decorated world is measured below, printed and not asserted on, because the check that
// owns THAT comparison is `vanillacheck` §3 — it has the real game to compare against and this
// file does not.
const SURF_BANDS = [
  // vanilla's `SurfaceRules.bandlands()` palette, typed out from the game the same way section
  // 3's stacks are: the `minecraft:bandlands` rule type is compiled Java, so it is the one node
  // in the tree whose output is not spelled in the JSON. It is gated to the three badlands
  // biomes, which already allow terracotta, orange_terracotta, white_terracotta, red_sand and
  // red_sandstone from ordinary `block` rules; these are the band colours it adds.
  'terracotta', 'white_terracotta', 'orange_terracotta', 'yellow_terracotta',
  'brown_terracotta', 'red_terracotta', 'light_gray_terracotta',
];

function allowedByBiome() {
  const src = WG.get('noise_settings', 'overworld').surface_rule;
  const any = new Set(), per = new Map();
  const add = (biomes, names) => {
    for (const n of names) {
      if (biomes === null) any.add(n);
      else for (const b of biomes) { if (!per.has(b)) per.set(b, new Set()); per.get(b).add(n); }
    }
  };
  (function walk(node, biomes) {
    if (Array.isArray(node)) { for (const n of node) walk(n, biomes); return; }
    if (!node || typeof node !== 'object') return;
    const t = (node.type || '').replace('minecraft:', '');
    if (t === 'sequence') { for (const n of node.sequence) walk(n, biomes); return; }
    if (t === 'condition') {
      const c = node.if_true || {}, ct = (c.type || '').replace('minecraft:', '');
      let nb = biomes;
      if (ct === 'biome') {
        const s = new Set(c.biome_is.map((x) => x.replace('minecraft:', '')));
        nb = biomes === null ? s : new Set([...biomes].filter((x) => s.has(x)));
      }
      // ⚠ A NEGATED BIOME TEST WOULD WIDEN THE SET AND THIS WALKER CANNOT EXPRESS IT. The 1.18.2
      // tree has `not` conditions and not one of them wraps a `biome`, so the walker refuses
      // rather than quietly under-reporting what a biome is allowed to have if that ever changes.
      if (ct === 'not' && (((c.invert || {}).type) || '').replace('minecraft:', '') === 'biome')
        throw new Error('surface_rule has a negated biome condition — the allowed-set walker must be taught it');
      walk(node.then_run, nb); return;
    }
    if (t === 'block') { add(biomes, [node.result_state.Name.replace('minecraft:', '')]); return; }
    if (t === 'bandlands') { add(biomes, SURF_BANDS); return; }
    throw new Error('the allowed-set walker does not know surface rule type ' + t);
  })(src, null);
  return { any, per };
}

/**
 * topTable(opts, seeds, spots, r) -> Map(biome -> Map(blockName -> columns))
 * The TOP BLOCK of every column of every chunk in the sample, keyed by that column's own
 * registry biome out of the generated chunk — the two lookups the bug lived between. Air and
 * water are skipped so that what is counted is the block the surface rules painted, not the
 * ocean above it.
 */
function topTable(opts, seeds, spots, r) {
  const H = CFG.CHUNK_H, WATER = S.stateOf('water');
  const tbl = new Map();
  let chunks = 0, cols = 0;
  for (const seed of seeds) {
    G.init(seed, Object.assign(G.defaults(), opts));
    for (const [ox, oz] of spots) {
      for (let cx = ox - r; cx <= ox + r; cx++) {
        for (let cz = oz - r; cz <= oz + r; cz++) {
          const col = G.genColumn(cx, cz);
          chunks++;
          for (let z = 0; z < 16; z++) {
            for (let x = 0; x < 16; x++) {
              for (let y = H - 1; y >= 0; y--) {
                const v = SEC.get(col.sec[y >> 4], ((y & 15) << 8) | (z << 4) | x);
                if (!v || v === WATER) continue;
                const bn = B.name(col.biome[(z << 4) | x]).replace('minecraft:', '');
                const k = S.name(v).split('[')[0];
                let m = tbl.get(bn); if (!m) tbl.set(bn, m = new Map());
                m.set(k, (m.get(k) || 0) + 1);
                cols++;
                break;
              }
            }
          }
        }
      }
    }
  }
  tbl.__chunks = chunks; tbl.__cols = cols;
  return tbl;
}

/** Every (biome, block) cell of `tbl` that `allow` says vanilla's surface rules cannot make. */
function surfaceViolations(tbl, allow) {
  const out = [];
  for (const [b, m] of tbl) {
    for (const [k, v] of m) {
      if (allow.any.has(k)) continue;
      const p = allow.per.get(b);
      if (p && p.has(k)) continue;
      out.push({ biome: b, block: k, n: v, of: [...m.values()].reduce((a, x) => a + x, 0) });
    }
  }
  return out.sort((a, b) => b.n - a.n);
}

// ⚠ FOUR SEEDS AND FOUR PLACES, because "a test that runs at the origin tests the origin"
// (docs/archive/NEXT.md) and because one seed's 0,0 is a desert in this world and a jungle in the next.
const SURF_SEEDS = [1337, 424242, 77, 20260908];
const SURF_SPOTS = [[0, 0], [300, -200], [-500, 400], [1200, 900]];

console.log('8. the biome x top-block table of a generated world — no cell vanilla cannot make');
{
  const allow = allowedByBiome();
  ok(allow.any.size === 6, `${allow.any.size} ungated surface blocks in the 1.18.2 tree, expected 6`);
  for (const b of ['bedrock', 'deepslate', 'dirt', 'grass_block', 'gravel', 'stone'])
    ok(allow.any.has(b), `${b} is not an ungated surface block — the allowed-set walker is wrong`);
  // the gate this whole section exists to enforce, stated as its own assertion so that a walker
  // that quietly stopped carrying biome conditions is a failure here and not a silent pass below
  for (const b of ['desert', 'beach', 'snowy_beach', 'warm_ocean', 'lukewarm_ocean', 'deep_lukewarm_ocean'])
    ok((allow.per.get(b) || new Set()).has('sand'), `vanilla's rules cannot put sand in ${b} — the walker lost a biome`);
  for (const b of ['plains', 'sunflower_plains', 'snowy_plains', 'jungle', 'sparse_jungle', 'forest', 'birch_forest', 'savanna', 'taiga', 'meadow'])
    ok(!(allow.per.get(b) || new Set()).has('sand'), `the walker thinks vanilla's rules can put sand in ${b}`);
  // and the compiled bands must be a subset of the palette typed out above — a cross-check, in
  // that direction only: the expectation is the typed list, never the table under test
  {
    const compiled = new Set();
    for (const st of SF.clayBands()) compiled.add(S.name(st).split('[')[0]);
    for (const n of compiled) ok(SURF_BANDS.indexOf(n) >= 0, `the compiled clay bands contain ${n}, which is not in vanilla's bandlands palette`);
  }

  const tbl = topTable({ climate: 'vanilla', features: false, structures: false, caves: false, carvers: false },
                       SURF_SEEDS, SURF_SPOTS, 4);
  // ⚠ NON-VACUITY OF THE SAMPLE ITSELF, before the containment claim is made about it: a table
  // built from four chunks of ocean would satisfy containment and prove nothing.
  ok(tbl.size >= 20, `only ${tbl.size} biomes in the surface sample — the audit has nothing to be about`);
  ok(tbl.__cols >= 200000, `only ${tbl.__cols} columns in the surface sample`);
  ok((tbl.get('desert') || new Map()).get('sand') > 0, 'no desert column is topped with sand — the sample cannot see the gated blocks at all');
  ok((tbl.get('plains') || new Map()).get('grass_block') > 0, 'no plains column is topped with grass_block');

  const bad = surfaceViolations(tbl, allow);
  console.log(`   ${tbl.__chunks} chunks · ${tbl.__cols.toLocaleString()} columns · ${tbl.size} biomes · ${SURF_SEEDS.length} seeds`);
  for (const v of bad.slice(0, 12))
    console.log(`   ✗ ${v.biome} is topped with ${v.block} in ${v.n} of ${v.of} columns — vanilla's rules for that biome cannot place it`);
  ok(bad.length === 0, `${bad.length} biome x top-block cells vanilla's surface rules cannot produce: `
     + bad.slice(0, 4).map((v) => `${v.biome}/${v.block} x${v.n}`).join(', '));
  pass += tbl.__cols;                     // one assertion per column audited

  if (PRINT) {
    for (const [b, m] of [...tbl].sort((a, x) => x[1].size - a[1].size).slice(0, 8)) {
      const tot = [...m.values()].reduce((a, x) => a + x, 0);
      console.log(`   ${b.padEnd(24)} ` + [...m].sort((a, x) => x[1] - a[1]).slice(0, 5)
        .map(([k, v]) => `${k} ${(100 * v / tot).toFixed(1)}%`).join('  '));
    }
  }
}

// ─────────────────────────────────────────────── 8b. the decorated world, printed not asserted
//
// ⚠ THIS IS A DIAGNOSTIC, NOT A FENCE, AND THE DIFFERENCE IS DELIBERATE (D-215). The surface
// rules are innocent of the sand — section 8 proves it — and the block that arrives on top of a
// plains column in the finished world is a FEATURE's, which is a thing vanilla does too. What
// vanilla does NOT do is do it to half the biome. Measured in the real game's own world (the
// 1.18.2 golden pregen, seed 1337, 556,086 land columns in the grass-family biomes): sand tops
// 0.73% of them, and 77% of that sand lies within six blocks of water — the maximum radius of
// `disk_sand`, which is vanilla's soft disks anchored to a water body. MC-Lite tops 44% of its
// plains columns with sand because its disks are anchored to nothing. The number is printed here
// every run so that it cannot be lost again; the assertion that owns it is `vanillacheck` §3,
// which has the real game to compare against. D-215 says where the gate belongs.
console.log('8b. the decorated world — the same table with features on (printed, see D-215)');
{
  const tbl = topTable({ climate: 'vanilla' }, SURF_SEEDS, [[20, 37]], 2);
  const rows = [];
  for (const b of ['plains', 'sunflower_plains', 'snowy_plains', 'forest', 'birch_forest', 'jungle', 'taiga', 'savanna']) {
    const m = tbl.get(b); if (!m) continue;
    const tot = [...m.values()].reduce((a, x) => a + x, 0);
    if (tot < 200) continue;
    const sand = ((m.get('sand') || 0) + (m.get('gravel') || 0) + (m.get('clay') || 0));
    rows.push(`   ${b.padEnd(18)} ${String(tot).padStart(6)} columns   sand+gravel+clay on top ${(100 * sand / tot).toFixed(1)}%   (vanilla: ~0.7%)`);
  }
  for (const r of rows) console.log(r);
  ok(rows.length >= 2, 'the decorated sample contains fewer than two grass-family biomes — 8b is measuring nothing');
}

// put the module back the way sections 1-7 and 9 expect to find it: `topTable` re-seeded the
// whole generator four times over.
G.init(Number(SEED), Object.assign(G.defaults(), { climate: 'vanilla' }));

// ─────────────────────────────────────────────── 9. anti-vacuity
console.log('9. anti-vacuity — every check above must be able to fail');
{
  const av = [];
  const check = (label, fn) => { let caught = false; try { fn(); } catch { caught = true; } av.push([label, caught]); };

  check('a rule type the interpreter does not know', () => {
    MCL.Surface.init === undefined && (() => { throw 0; })();
    // compile a tiny tree with an invented type through the same path the real one uses
    const ns = WG.get('noise_settings', 'overworld');
    const saved = ns.surface_rule;
    ns.surface_rule = { type: 'minecraft:definitely_not_a_rule' };
    try { MCL.Surface.init(SEED); } finally { ns.surface_rule = saved; MCL.Surface.init(SEED); }
  });

  check('a condition type the interpreter does not know', () => {
    const ns = WG.get('noise_settings', 'overworld');
    const saved = ns.surface_rule;
    ns.surface_rule = { type: 'minecraft:condition', if_true: { type: 'minecraft:not_a_condition' },
                        then_run: { type: 'minecraft:block', result_state: { Name: 'minecraft:stone' } } };
    try { MCL.Surface.init(SEED); } finally { ns.surface_rule = saved; MCL.Surface.init(SEED); }
  });

  check('a rule naming a biome that does not exist', () => {
    const ns = WG.get('noise_settings', 'overworld');
    const saved = ns.surface_rule;
    ns.surface_rule = { type: 'minecraft:condition', if_true: { type: 'minecraft:biome', biome_is: ['minecraft:mangrove_swamp'] },
                        then_run: { type: 'minecraft:block', result_state: { Name: 'minecraft:stone' } } };
    try { MCL.Surface.init(SEED); } finally { ns.surface_rule = saved; MCL.Surface.init(SEED); }
  });

  check('a rule naming a noise that does not exist', () => {
    const ns = WG.get('noise_settings', 'overworld');
    const saved = ns.surface_rule;
    ns.surface_rule = { type: 'minecraft:condition',
                        if_true: { type: 'minecraft:noise_threshold', noise: 'minecraft:not_a_noise', min_threshold: 0, max_threshold: 1 },
                        then_run: { type: 'minecraft:block', result_state: { Name: 'minecraft:stone' } } };
    try { MCL.Surface.init(SEED); } finally { ns.surface_rule = saved; MCL.Surface.init(SEED); }
  });

  check('an unknown vertical anchor', () => { SF.anchorY({ sideways: 3 }); });

  check('the sequence treating air as no opinion', () => {
    // The one `air` rule returns state 0, which is also what "no opinion" is. If the sentinel
    // were dropped, the rule AFTER the air rule would win wherever air should have been placed.
    if (SF.AIR_SENTINEL === 0) return;      // NOT caught: the two are the same value
    throw 0;
  });

  check('the stone depths computed from the wrong end', () => {
    SF.beginColumn(0, 0, B.index('plains'), 100, SF.NO_WATER);
    SF.at(50);
    const c = SF.context();
    if (c.stoneDepthAbove === c.stoneDepthBelow) return;   // NOT caught: swapping them is invisible
    throw 0;
  });

  check('the badlands band index without its wrap', () => {
    // y + offset goes negative below the world floor and a raw `%` in Java gives a negative
    // index. Prove the wrap actually does something.
    let anyNegative = false;
    for (let y = -64; y < 0 && !anyNegative; y++) {
      const off = Math.round(SF.noise('clay_bands_offset').get(0, 0, 0) * 4);
      if ((y + off) % 192 < 0) anyNegative = true;
    }
    if (!anyNegative) return;      // NOT caught: nothing would ever go negative
    throw 0;
  });

  check('a rule tree that never places anything', () => {
    // Section 3's "the top block is not always plain stone" assertion, given teeth: swap the
    // whole tree for an empty sequence — which is what a compiler that returned 0 everywhere
    // would look like — and require the assertion to notice.
    //
    // ⚠ It cannot be demonstrated with a BIOME, and that is worth recording: there is no biome
    // whose surface rules never fire, because the tree's last branch is not biome-gated. Even
    // `the_void` gets grass and dirt. The first draft of this case tried that and passed
    // vacuously, which is precisely the failure this section exists to catch.
    const ns = WG.get('noise_settings', 'overworld');
    const saved = ns.surface_rule;
    ns.surface_rule = { type: 'minecraft:sequence', sequence: [] };
    let allStone = true;
    try {
      MCL.Surface.init(SEED);
      for (let k = 0; k < 12; k++) {
        const x = k * 71, z = k * 131, h = C.height(x, z);
        MCL.Surface.beginColumn(x, z, B.index('plains'), h, h < C.seaLevel ? C.seaLevel : MCL.Surface.NO_WATER);
        if (nm(MCL.Surface.at(h)) !== 'stone') allStone = false;
      }
    } finally { ns.surface_rule = saved; MCL.Surface.init(SEED); }
    if (!allStone) return;         // NOT caught
    throw 0;
  });

  // ── section 8's two, and they break DIFFERENT halves of it (D-30, D-215) ────────────────
  // The first breaks the WORLD and requires the containment audit to see it; the second breaks
  // the JSON'S BIOME GATES and requires the allowed-set walker to follow them, which is the only
  // thing standing between "sand is illegal in a plains" and a hard-coded list of block names.
  check('a surface rule that puts sand on top of every biome', () => {
    const allow = allowedByBiome();                 // from the PRISTINE tree, before the break
    const ns = WG.get('noise_settings', 'overworld');
    const saved = ns.surface_rule;
    ns.surface_rule = { type: 'minecraft:sequence', sequence: [
      { type: 'minecraft:block', result_state: { Name: 'minecraft:sand' } }, saved] };
    let bad = [];
    try {
      bad = surfaceViolations(topTable(
        { climate: 'vanilla', features: false, structures: false, caves: false, carvers: false },
        [1337], [[0, 0], [300, -200]], 1), allow);
    } finally {
      ns.surface_rule = saved;
      G.init(Number(SEED), Object.assign(G.defaults(), { climate: 'vanilla' }));
    }
    if (!bad.length) return;                        // NOT caught
    throw 0;
  });

  check('the allowed set follows the JSON\'s biome gates rather than a list of block names', () => {
    const ns = WG.get('noise_settings', 'overworld');
    const saved = JSON.parse(JSON.stringify(ns.surface_rule));
    let widened = 0;
    (function walk(n) {
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (!n || typeof n !== 'object') return;
      const c = n.if_true;
      if (c && String(c.type || '').replace('minecraft:', '') === 'biome'
          && c.biome_is.indexOf('minecraft:desert') >= 0) { c.biome_is.push('minecraft:plains'); widened++; }
      for (const k of Object.keys(n)) walk(n[k]);
    })(ns.surface_rule);
    let followed = false;
    try {
      followed = widened > 0 && (allowedByBiome().per.get('plains') || new Set()).has('sand');
    } finally { ns.surface_rule = saved; }
    if (!followed) return;                          // NOT caught
    throw 0;
  });

  // ── section 3b's two, and they break the TWO DIFFERENT halves of the swamp (D-225) ──────
  // The first breaks the RULE and requires the driven half to notice; the second breaks the
  // WORLD — by putting `HEIGHT_CURVE`'s sea-level anchor back where it was — and requires the
  // generated half to notice. Only the second one would have caught the original bug, which is
  // exactly why both are here: a compiled rule that is perfectly correct and never reached is
  // the shape of failure this section exists to make impossible to ship again.
  // ⚠ THE BREAK IS `62 -> 63`, NOT `62 -> 61`, AND THE FIRST DRAFT USED 61 AND PASSED
  // VACUOUSLY. The clause is `y_above 62 AND NOT y_above 63`; lowering the lower bound to 61
  // widens the window to {61, 62} and y = 62 still fires, so the driven half saw nothing.
  // Raising it to 63 makes the window EMPTY, which is what "the clause no longer fires" means.
  check('the swamp clause\'s y window collapsed — the driven half must notice', () => {
    const ns = WG.get('noise_settings', 'overworld');
    const saved = JSON.parse(JSON.stringify(ns.surface_rule));
    let moved = 0;
    (function walk(n) {
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (!n || typeof n !== 'object') return;
      const c = n.if_true;
      if (c && String(c.type || '').replace('minecraft:', '') === 'y_above'
          && c.anchor && c.anchor.absolute === 62) { c.anchor.absolute = 63; moved++; }
      for (const k of Object.keys(n)) walk(n[k]);
    })(ns.surface_rule);
    let stillRight = true;
    try {
      MCL.Surface.init(SEED);
      const SW = B.index('swamp'), nz = SF.noise('surface_swamp');
      let wrong = 0, seen = 0;
      for (let k = 0; k < 800 && wrong === 0; k++) {
        const x = -9400 + ((k * 37) % 600), z = -5300 + ((k * 53) % 600);
        SF.stateAt(x, 62, z, SW, 62, SF.NO_WATER);
        if (SF.context().surfaceDepth <= 0 || SF.context().minSurface > 62) continue;
        seen++;
        const st = SF.stateAt(x, 62, z, SW, 62, SF.NO_WATER);
        const isW = st !== 0 && S.name(st).split('[')[0] === 'water';
        if (isW !== (nz.get(x, 0, z) >= 0)) wrong++;
      }
      stillRight = moved > 0 && seen > 100 && wrong === 0;
    } finally { ns.surface_rule = saved; MCL.Surface.init(SEED); }
    if (stillRight) return;                         // NOT caught
    throw 0;
  });

  check('the sea-level height anchor put back at 66 — the generated half must notice', () => {
    const curve = C.HEIGHT_CURVE;
    const e = curve.filter((r) => r[0] === 0.0)[0];
    if (!e) return;                                 // NOT caught: the curve no longer has that anchor
    const saved = e[1];
    let frac = 0;
    try {
      e[1] = 66;
      const sw = swampWaterFraction(SWAMP_CHUNKS);
      frac = sw.n ? 100 * sw.water / sw.n : 0;
    } finally { e[1] = saved; C.init(SEED); MCL.Surface.init(SEED); }
    if (frac >= 40 && frac <= 85) return;           // NOT caught: 3b(e)'s band did not move
    throw 0;
  });

  for (const [label, caught] of av) {
    ok(caught, `ANTI-VACUITY FAILURE: "${label}" was not caught — this check proves nothing`);
    console.log(`   ${caught ? '✓' : '✗'} ${label}`);
  }
}

console.log('');
console.log('================ surfcheck ================');
console.log(` assertions passed .. ${pass.toLocaleString()}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails.slice(0, 20)) console.log('   ✗ ' + f);
console.log('==========================================');
process.exit(fails.length ? 1 : 0);
