#!/usr/bin/env node
// floatcheck.mjs — nothing in the world stands on nothing (D-140, D-141).
//
//   node tools/floatcheck.mjs [--print]
//
// ⚠ WHY THIS CHECK EXISTS, AND WHY NO EXISTING CHECK COULD HAVE FOUND IT.
//
// Dan played the build at the end of session 3 and reported "tons of floating grass, and a
// floating mob spawner". The suite was green at 675,213 assertions. It was green because every
// feature check COUNTS what a feature produced and compares the count to the data — and a dead
// bush hanging in mid-air is a perfectly correct dead bush by that measure. The bug is not in
// any one stage; it is in the JOIN between W7's carvers and W8's placements, which is where
// every bug in §23 lived too.
//
// The mechanism, stated once: a placement's y comes from `Column.height`, the terrain as it was
// BEFORE the carvers ran (D-134, and that purity is what makes the whole 3x3 architecture
// affordable). W7's carvers then remove the ground, cave mouths reach daylight (D-127), and the
// plant is written into a cell whose floor no longer exists. Vanilla never has this because
// `SimpleBlockFeature.place` asks `state.canSurvive` at write time. D-140 is that call.
//
// Measured on the build that shipped session 3, over 169 chunks at seed 1337:
//     2,864 dead_bush · 1,934 grass · 427 glow_lichen · 47 brown_mushroom   standing on nothing
//       158 spawners in open air, most with no room around them at all
// This check asserts those numbers are ZERO, and it asserts the support table they rest on.
//
// Sections:
//   1. the support table — the classes are the ones the data says, and they reach the runtime
//   2. the world — every generated block obeys its own support rule
//   2d. the placement sets — a plant stands on what VANILLA lets it stand on, not on anything
//       opaque, and the answer does not depend on a graphics setting (D-197)
//   2f. the growing plants — a head hangs from its own BODY, and every vine run ends in one (D-233)
//   3. the spawners — every one of them is inside a room
//   4. determinism — the rule may not depend on which chunk is being written
//   5. anti-vacuity — break the rule and prove sections 2 and 3 catch it

import { loadEngine } from './loadsrc.mjs';

const PRINT = process.argv.includes('--print');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); };

const MCL = loadEngine({});
const G = MCL.Gen, CFG = MCL.CFG, S = MCL.Section, SR = MCL.States, R = MCL.Reg;
const F = MCL.Features;
const H = CFG.CHUNK_H, MINY = CFG.WORLD_MIN_Y;
const SEED = 1337;
G.init(SEED, G.defaults());

const solid = (st) => st > 0 && SR.solid[st] === 1;

// ⚠ A NAMED LUSH AREA, because seed 1337 has no lush cave anywhere near the origin (D-233):
// 169 chunks around (0,0) hold four vine runs and 49 chunks here hold seven hundred.
const LUSH = { cx0: -63, cx1: -57, cz0: 17, cz1: 23 };

/**
 * Every vertical run of cave vine in an area, and what it ends in. ONE implementation, used by
 * section 2f and by section 5's anti-vacuity break, so the break measures what the section does.
 * A "run" is a maximal vertical stack of `cave_vines`/`cave_vines_plant`; vanilla's runs end in a
 * `cave_vines` head 4,285 times out of 4,286 (D-227).
 */
function vineRuns(M, area) {
  const G2 = M.Gen, S2 = M.Section, SR2 = M.States, H2 = M.CFG.CHUNK_H;
  let runs = 0, headless = 0, heads = 0, bodies = 0, longer = 0, len = 0, drip = 0, dripOnStem = 0;
  for (let cx = area.cx0; cx <= area.cx1; cx++) {
    for (let cz = area.cz0; cz <= area.cz1; cz++) {
      const col = G2.genColumn(cx, cz);
      const nm = (x, y, z) => (y < 0 || y >= H2) ? 'air' : SR2.name(S2.get(col.sec[y >> 4], ((y & 15) << 8) | (z << 4) | x));
      const vine = (n) => n === 'cave_vines' || n === 'cave_vines_plant';
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          for (let y = 0; y < H2; y++) {
            const n = nm(x, y, z);
            if (n === 'cave_vines') heads++;
            else if (n === 'cave_vines_plant') bodies++;
            else if (n === 'big_dripleaf') { drip++; if (nm(x, y - 1, z) === 'big_dripleaf_stem') dripOnStem++; }
            if (!vine(n) || vine(nm(x, y + 1, z))) continue;   // only the TOP of a run
            let yy = y, last = n, l = 0;
            while (yy >= 0 && vine(nm(x, yy, z))) { last = nm(x, yy, z); l++; yy--; }
            runs++; len += l;
            if (l > 1) longer++;
            if (last !== 'cave_vines') headless++;
          }
        }
      }
    }
  }
  return { runs, headless, heads, bodies, longer, drip, dripOnStem, mean: len / Math.max(1, runs) };
}

// ─────────────────────────────────────────────── 1. the support table
console.log('1. the support classes, out of the data and into the runtime');
{
  ok(SR.support instanceof Uint8Array, 'States.support is not a table');
  ok(SR.support.length === SR.count, 'States.support is not one entry per real state');
  ok(SR.support[0] === 0, 'air has a support class');

  // The three classes, by example, named. A wrong list is a visible wrong list (D-140).
  const cls = (n) => SR.support[SR.stateOf(n)];
  for (const n of ['grass', 'dead_bush', 'fern', 'brown_mushroom', 'red_mushroom', 'dandelion',
                   'poppy', 'oak_sapling', 'sugar_cane', 'sweet_berry_bush', 'small_dripleaf',
                   'moss_carpet', 'azalea']) {
    ok(cls(n) === 1, `${n} should need a floor, class is ${cls(n)}`);
  }
  for (const n of ['cave_vines', 'hanging_roots', 'spore_blossom']) {
    ok(cls(n) === 2, `${n} hangs from a ceiling, class is ${cls(n)}`);
  }
  for (const n of ['vine', 'glow_lichen']) {
    ok(cls(n) === 3, `${n} is multiface, class is ${cls(n)}`);
  }
  // and the ones that deliberately have no rule, because the class cannot express theirs
  for (const n of ['lily_pad', 'pointed_dripstone', 'stone', 'oak_log', 'water', 'oak_leaves']) {
    ok(cls(n) === 0, `${n} should carry no support rule, class is ${cls(n)}`);
  }
  // every state of a block shares its block's class — the table is per block, spread per state
  for (const n of ['grass', 'vine', 'cave_vines', 'sugar_cane']) {
    const b = R.id[n];
    const s0 = R.realFirst[b], s1 = R.realFirst[b + 1];
    let same = true;
    for (let s = s0; s < s1; s++) if (SR.support[s] !== SR.support[s0]) same = false;
    ok(same, `${n}: its states disagree about their support class`);
  }
  // the classes exist in the numbers the packer reported, so a silently empty table fails here
  let floor = 0, ceiling = 0, any = 0, behind = 0;
  for (let b = 0; b < R.blockCount; b++) {
    const c = R.support(b);
    if (c === 1) floor++; else if (c === 2) ceiling++; else if (c === 3) any++; else if (c === 4) behind++;
  }
  // ⚠ 54 was the plant count. D-167 added the STANDING half of every standing/wall pair — a
  // torch, a sign, a banner, a coral fan all need a floor — because without a rule a torch stuck
  // to the underside of blocks, which Dan found by trying it.
  ok(floor >= 90 && floor <= 110, `${floor} blocks need a floor — expected about 97 (D-140 plants + D-167 standing halves)`);
  ok(behind >= 40 && behind <= 60, `${behind} blocks hang on the block behind them — expected about 45 (D-158)`);
  ok(R.support(R.id.torch) === 1, 'a torch has no floor rule, so it sticks to ceilings (D-167)');
  ok(R.support(R.id.wall_torch) === 4, 'a wall torch does not hang on the block behind it (D-158)');
  ok(ceiling === 6, `${ceiling} blocks hang from a ceiling — expected 6`);
  ok(any === 2, `${any} multiface blocks — expected vine and glow_lichen`);
  if (PRINT) console.log(`   floor ${floor} · ceiling ${ceiling} · any ${any}`);
}


// ⚠ THE JAR'S OWN RULE FIRST, THE WAY BOTH DOORS NOW ASK IT (#19, KW-25). `Features.supported` and
// `World.canSurvive` both put `NS.Survive`'s rule ahead of the support class, so a walk that judged
// only the class would call a vine hanging under a vine "floating" (vanilla keeps it) and a cocoa
// facing its log "unsupported". This asks the ENGINE'S rule over the chunk's cells (D-169: never a
// copy) and answers 1 / 0, or -1 when the block has no rule or the rule needs light.
// ⚠ IT CAN ONLY RESCUE. A rule that says 0 falls through to the class walk below, because the sweep's
// question is "does anything hold this", and a later tree's leaves may overwrite a vine column's upper
// cells exactly as in vanilla's decoration order — `featgroundcheck` §3 measures that residue.
function ruleVerdict(M, get, x, y, z, st) {
  const rule = M.States.rule ? M.States.rule[st] : 0;
  if (!rule) return -1;
  const L = {
    miss: false,
    getBlock: (a, b, c) => { const v = get(a, b, c); return v < 0 ? 0 : v; },
    loadedAt: (a, c) => a >= 0 && a < 16 && c >= 0 && c < 16,
    tag: (n, t) => M.States.inRuleTag(n, t),
    light: () => -1,
    sky: () => -1,
  };
  return M.Survive.eval(L, x, y, z, st, rule);
}

// ─────────────────────────────────────────────── 2. the world
console.log('2. 169 generated chunks — every block stands on something');
const RAD = 6;
const unsupported = new Map();
const spawners = [];
let blocksWalked = 0, supportedSeen = 0;
{
  for (let cx = -RAD; cx <= RAD; cx++) {
    for (let cz = -RAD; cz <= RAD; cz++) {
      const col = G.genColumn(cx, cz);
      const get = (x, y, z) => (x < 0 || x > 15 || z < 0 || z > 15 || y < 0 || y >= H)
        ? -1 : S.get(col.sec[y >> 4], ((y & 15) << 8) | (z << 4) | x);
      for (let y = 1; y < H - 1; y++) {
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) {
            const st = get(x, y, z);
            if (st <= 0) continue;
            blocksWalked++;
            const name = SR.name(st);
            if (name === 'spawner') {
              spawners.push([cx * 16 + x, y + MINY, cz * 16 + z,
                             SR.name(Math.max(0, get(x, y - 1, z))),
                             SR.name(Math.max(0, get(x, y + 4, z)))]);
              continue;
            }
            const c = SR.support[st];
            if (!c) continue;
            supportedSeen++;
            let good;
            const rv = ruleVerdict(MCL, get, x, y, z, st);
            if (rv === 1) continue;                       // the jar's rule holds it: no class verdict needed
            // ⚠ THE ENGINE'S OWN PREDICATES, NOT A COPY (D-169). This block used to restate the
            // rules, and the copy went stale the moment D-165 tightened them: it still accepted a
            // plant standing on any other plant, and on LEAVES, so it would have passed exactly
            // the world Dan was looking at. D-164 had just caught `lightcheck` doing the same
            // thing with the light adapter. A check that reimplements the rule tests the copy.
            if (c === 1) { const b = get(x, y - 1, z); good = b < 0 || SR.floorOk(st, b); }
            else if (c === 2) { const a = get(x, y + 1, z); good = a < 0 || SR.ceilingOk(st, a); }
            else if (c === 4) {
              const f = SR.propValue(st, MCL.Reg.PROP.facing);
              const fi = { 0: 2, 1: 3, 2: 4, 3: 5, 4: 1, 5: 0 }[f];
              if (fi === undefined) good = true;
              else {
                const D = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]][fi];
                const b = get(x - D[0], y - D[1], z - D[2]);
                good = b < 0 || SR.anyFaceOk(b);
              }
            } else {
              good = false;
              for (const [dx, dy, dz] of [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]]) {
                const b = get(x + dx, y + dy, z + dz);
                if (b < 0 || SR.anyFaceOk(b)) { good = true; break; }
              }
            }
            if (!good) unsupported.set(name, (unsupported.get(name) || 0) + 1);
          }
        }
      }
    }
  }
  const total = [...unsupported.values()].reduce((a, b) => a + b, 0);
  ok(supportedSeen > 2000, `only ${supportedSeen} blocks with a support rule were generated — this check is vacuous`);
  ok(total === 0, `${total} blocks stand on nothing: ${[...unsupported].map(([n, c]) => `${c} ${n}`).join(', ')}`);
  for (const n of ['grass', 'dead_bush', 'glow_lichen', 'brown_mushroom']) {
    ok(!unsupported.get(n), `${unsupported.get(n)} floating ${n} — the four Dan reported (D-140)`);
  }
  if (PRINT) console.log(`   ${blocksWalked.toLocaleString()} non-air blocks · ${supportedSeen.toLocaleString()} carry a support rule`);
}

// ─────────────────────────────────────────────── 2b. and not just this seed
console.log('2b. three more seeds — the fix is not a property of seed 1337');
{
  // ⚠ ONE SEED IS AN ANECDOTE. The support rule is derived from block data and enforced at the
  // write chokepoint, so it should hold everywhere — but "should" is what the 5,684 floating
  // plants were before anyone counted them. Three more worlds, 25 columns each, freshly loaded
  // engines so nothing carries over.
  for (const seed of [1, 4242, 777777]) {
    const M2 = loadEngine({});
    const G2 = M2.Gen, S2 = M2.Section, SR2 = M2.States, C2 = M2.CFG;
    G2.init(seed, G2.defaults());
    let bad = 0, ruled = 0, spawn = 0, unhoused = 0;
    for (let cx = -2; cx <= 2; cx++) {
      for (let cz = -2; cz <= 2; cz++) {
        const col = G2.genColumn(cx, cz);
        const get = (x, y, z) => (x < 0 || x > 15 || z < 0 || z > 15 || y < 0 || y >= C2.CHUNK_H)
          ? -1 : S2.get(col.sec[y >> 4], ((y & 15) << 8) | (z << 4) | x);
        const sol = (b) => b > 0 && SR2.solid[b] === 1;
        for (let y = 1; y < C2.CHUNK_H - 1; y++) {
          for (let z = 0; z < 16; z++) {
            for (let x = 0; x < 16; x++) {
              const st = get(x, y, z);
              if (st <= 0) continue;
              if (SR2.name(st) === 'spawner') {
                spawn++;
                if (!sol(get(x, y - 1, z)) || !sol(get(x, y + 4, z))) unhoused++;
                continue;
              }
              const c = SR2.support[st];
              if (!c) continue;
              ruled++;
              let good;
              const rv = ruleVerdict(M2, get, x, y, z, st);
              if (rv === 1) continue;
              if (c === 1) { const b = get(x, y - 1, z); good = b < 0 || (b !== 0 && (sol(b) || SR2.support[b] === 1)); }
              else if (c === 2) { const a = get(x, y + 1, z); good = a < 0 || (a !== 0 && (sol(a) || SR2.support[a] === 2)); }
              else {
                good = false;
                for (const [dx, dy, dz] of [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]]) {
                  const b = get(x + dx, y + dy, z + dz);
                  if (b < 0 || sol(b)) { good = true; break; }
                }
              }
              if (!good) bad++;
            }
          }
        }
      }
    }
    ok(ruled > 50, `seed ${seed} generated only ${ruled} blocks with a support rule — that world proves nothing`);
    ok(bad === 0, `seed ${seed}: ${bad} of ${ruled} blocks stand on nothing`);
    ok(unhoused === 0, `seed ${seed}: ${unhoused} of ${spawn} spawners are unhoused`);
    if (PRINT) console.log(`   seed ${seed}: ${ruled} rule-carrying blocks, ${bad} unsupported · ${spawn} spawners, ${unhoused} unhoused`);
  }
}

// ⚠ THE HEAD/BODY PAIRS, WRITTEN OUT HERE AND NOT READ FROM `States` (D-164, D-233). Sections
// 2c, 2d and 2f all have to tell "a plant standing on a plant", which D-165 forbids, from "a
// growing plant standing on the other half of ITSELF", which vanilla's
// `GrowingPlantBlock.canSurvive` requires. A check that asked `States.attachOk` which was which
// would be asking the table it is judging — the exact shape of the bug D-164 found in
// `lightcheck`. So the pairs are vanilla's, by name, in the direction vanilla allows them:
// "A on B" reads as A resting against the neighbour B in A's own growth direction.
const GROW_PAIRS = new Set([
  'cave_vines/cave_vines_plant', 'cave_vines_plant/cave_vines',           // GrowingPlant, DOWN
  'weeping_vines/weeping_vines_plant', 'weeping_vines_plant/weeping_vines',
  'twisting_vines/twisting_vines_plant', 'twisting_vines_plant/twisting_vines',   // UP
  'kelp/kelp_plant', 'kelp_plant/kelp',
  'big_dripleaf/big_dripleaf_stem',      // DIRECTED: the stem never rests on the leaf (D-233)
]);
const growPair = (a, b) => GROW_PAIRS.has(a + '/' + b);

// ─────────────────────────────────────────────── 2c. nothing is stacked on anything soft
console.log('2c. no plant stands on another plant, or on leaves (D-165)');
{
  // ⚠ THE RULE USED TO SAY "a solid block, OR anything that itself has a floor rule", and both
  // halves of that were too wide. Leaves are SOLID — they have a collision box — so grass grew
  // out of tree canopies; and "anything with a floor rule" let plants tower on each other. Dan
  // saw both from inside the game: "multiple small grasses stacked on top of each other, some
  // even stacked on top of flowers, some 3 high, some on tree leaves". Measured over 36 chunks
  // before the fix: 19 on leaves, 7 on plants, `dead_bush on dead_bush` among them.
  let onPlant = 0, onSoft = 0, ruled = 0, first = null;
  for (let cx = -3; cx <= 3; cx++) {
    for (let cz = -3; cz <= 3; cz++) {
      const col = G.genColumn(cx, cz);
      const get = (x, y, z) => S.get(col.sec[y >> 4], ((y & 15) << 8) | (z << 4) | x);
      for (let y = 1; y < H - 1; y++) {
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) {
            const st = get(x, y, z);
            if (st <= 0 || SR.support[st] !== 1) continue;
            ruled++;
            const b = get(x, y - 1, z);
            if (b === 0) continue;
            const stacked = SR.support[b] === 1 && !(SR.block[b] === SR.block[st] && SR.stacksOnSelf(st))
                            && !growPair(SR.name(st), SR.name(b));       // its own body (D-233)
            const soft = SR.opaque[b] !== 1 && SR.support[b] !== 1;
            if (stacked) { onPlant++; if (!first) first = SR.name(st) + ' on ' + SR.name(b); }
            if (soft) { onSoft++; if (!first) first = SR.name(st) + ' on ' + SR.name(b) + ' (not opaque)'; }
          }
        }
      }
    }
  }
  ok(ruled > 300, `only ${ruled} floor-ruled blocks in 49 chunks — section 2c is vacuous`);
  ok(onPlant === 0, `${onPlant} plants stand on another plant (first: ${first}) — D-165`);
  ok(onSoft === 0, `${onSoft} plants stand on something that is not opaque ground, such as leaves (first: ${first}) — D-165`);

  // and the exception is still there, or the fix has broken the two-tall plants it protects
  const tall = SR.stateOf('tall_grass'), cane = SR.stateOf('sugar_cane'), bush = SR.stateOf('dead_bush');
  ok(SR.stacksOnSelf(tall) === true, 'a two-tall grass may no longer stand on its own lower half');
  ok(SR.stacksOnSelf(cane) === true, 'sugar cane may no longer stack');
  ok(SR.stacksOnSelf(bush) === false, 'a dead bush is allowed to stack on itself, which vanilla never does');
  ok(SR.floorOk(tall, tall) === true, 'the two-tall exception does not survive floorOk');
  ok(SR.floorOk(bush, bush) === false, 'floorOk lets a dead bush stand on a dead bush');
  ok(SR.floorOk(SR.stateOf('grass'), SR.stateOf('oak_leaves')) === false, 'floorOk grows grass on leaves');
  ok(SR.floorOk(SR.stateOf('grass'), SR.stateOf('grass_block')) === true, 'floorOk will not grow grass on grass_block');
  if (PRINT) console.log(`   ${ruled} floor-ruled blocks · ${onPlant} on plants · ${onSoft} on soft blocks`);
}

// ─────────────────────────────────────────────── 2d. the placement sets
console.log('2d. every plant stands on a floor its own block accepts (D-197)');
const WG = MCL.WG;
let fastDiffCells = -1;
{
  // ⚠ WHY THIS SECTION EXISTS. Section 2c asserted the floor was OPAQUE, and "opaque" is not a
  // placement rule — it is a whole class of them, and much too wide. Vanilla asks the BLOCK:
  // `BushBlock.mayPlaceOn` is `#minecraft:dirt` or farmland and nothing else. Measured over
  // these same chunks before D-197: 891 grass on SAND, 216 on GRAVEL, 2 on stone, 21 tall_grass
  // on sand, plus poppies, dandelions and lilies of the valley on both. Every one of them
  // passed section 2 and section 2c, because sand is opaque.
  const rules = WG && WG.ready ? WG.placementRules() : [];
  ok(rules.length >= 10, `${rules.length} placement rules reached the runtime — expected 11 (D-197)`);
  ok(SR.placeRule instanceof Uint8Array, 'States.placeRule is not a table — buildPlacement never ran');
  ok(SR.placeRule && SR.placeRule.length === SR.count, 'States.placeRule is not one entry per real state');
  ok(SR.placeBlocks >= 40, `only ${SR.placeBlocks} blocks carry a placement set — expected 41`);
  for (const r of rules) {
    const mem = WG.placementFloors(r) || [];
    ok(mem.length > 0 || WG.placementAnyOpaque(r), `placement set ${r} is empty`);
    ok((WG.placementBlocks(r) || []).length > 0, `placement rule ${r} governs no block`);
  }

  // ⚠ NAMED MEMBERSHIPS, both ways. A set that loaded is not a set that is right, and the
  // measured bug was entirely about what a set must REFUSE.
  const F2 = (a, b) => SR.floorOk(SR.stateOf(a), SR.stateOf(b));
  for (const [a, b] of [['grass', 'grass_block'], ['grass', 'dirt'], ['grass', 'podzol'],
                        ['grass', 'coarse_dirt'], ['grass', 'moss_block'], ['grass', 'farmland'],
                        ['poppy', 'grass_block'], ['oak_sapling', 'dirt'], ['dead_bush', 'sand'],
                        ['dead_bush', 'red_sand'], ['dead_bush', 'white_terracotta'],
                        ['sugar_cane', 'sand'], ['sugar_cane', 'dirt'], ['cactus', 'red_sand'],
                        ['bamboo', 'gravel'], ['azalea', 'snow_block'], ['wither_rose', 'soul_sand'],
                        ['wither_rose', 'netherrack'], ['wither_rose', 'grass_block'],
                        ['brown_mushroom', 'mycelium'], ['brown_mushroom', 'stone'],
                        ['nether_wart', 'soul_sand'], ['small_dripleaf', 'clay']]) {
    ok(F2(a, b) === true, `${a} may not stand on ${b}, and vanilla says it may`);
  }
  for (const [a, b] of [['grass', 'sand'], ['grass', 'gravel'], ['grass', 'stone'],
                        ['grass', 'oak_leaves'], ['grass', 'red_sand'], ['grass', 'netherrack'],
                        ['tall_grass', 'sand'], ['poppy', 'sand'], ['poppy', 'gravel'],
                        ['dandelion', 'sand'], ['lily_of_the_valley', 'gravel'],
                        ['oak_sapling', 'sand'], ['sweet_berry_bush', 'sand'],
                        ['dead_bush', 'stone'], ['dead_bush', 'gravel'],
                        ['sugar_cane', 'stone'], ['cactus', 'stone'],
                        ['wither_rose', 'sand'], ['brown_mushroom', 'oak_leaves'],
                        ['nether_wart', 'netherrack'], ['small_dripleaf', 'stone']]) {
    ok(F2(a, b) === false, `${a} is allowed to stand on ${b}, and vanilla never puts it there`);
  }
  // and the blocks D-197 deliberately did NOT narrow keep the rule they had (D-152, D-178)
  for (const n of ['torch', 'oak_sign', 'white_banner', 'wheat', 'moss_carpet']) {
    ok(SR.placementRule(SR.stateOf(n)) === '', `${n} was given a placement set it has no rule for`);
  }
  ok(SR.floorOk(SR.stateOf('torch'), SR.stateOf('sand')) === true, 'a torch may no longer stand on sand');

  // ⚠ THE WORLD, judged against the packer's OWN sets by NAME, not against `floorOk` — which is
  // the function that generated the world and would agree with itself (D-164).
  const floors = new Map();
  for (const r of rules) floors.set(r, new Set(WG.placementFloors(r) || []));
  const offenders = new Map();
  let planted = 0;
  for (let cx = -3; cx <= 3; cx++) {
    for (let cz = -3; cz <= 3; cz++) {
      const col = G.genColumn(cx, cz);
      const get = (x, y, z) => S.get(col.sec[y >> 4], ((y & 15) << 8) | (z << 4) | x);
      for (let y = 1; y < H - 1; y++) {
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) {
            const st = get(x, y, z);
            if (st <= 0 || SR.support[st] !== 1) continue;
            const rule = SR.placementRule(st);
            if (!rule) continue;
            planted++;
            const b = get(x, y - 1, z);
            if (b <= 0) continue;                        // section 2 owns "stands on nothing"
            if (floors.get(rule).has(SR.name(b))) continue;
            if (WG.placementAnyOpaque(rule) && SR.opaqueBase[b] === 1) continue;
            if (SR.block[b] === SR.block[st] && SR.stacksOnSelf(st)) continue;   // its own lower half
            if (growPair(SR.name(st), SR.name(b))) continue;                     // its own body (D-233)
            const k = `${SR.name(st)} on ${SR.name(b)}`;
            offenders.set(k, (offenders.get(k) || 0) + 1);
          }
        }
      }
    }
  }
  const bad = [...offenders.values()].reduce((a, b) => a + b, 0);
  ok(planted > 300, `only ${planted} plants with a placement set in 49 chunks — section 2d is vacuous`);
  ok(bad === 0, `${bad} plants stand on a floor their own block refuses: ${[...offenders].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, c]) => `${c} ${n}`).join(', ')}`);
  if (PRINT) console.log(`   ${planted} placement-ruled plants · ${bad} on a forbidden floor`);
}

// ─────────────────────────────────────────────── 2e. a graphics setting is not worldgen input
console.log('2e. fast leaves does not change the world (D-197)');
{
  // ⚠ THE REGRESSION FENCE. `SR.setFastLeaves(true)` writes `SR.opaque[leafState] = 1` so the
  // mesher can cull through a canopy, and `floorOk` read `SR.opaque`. So the SAME SEED grew
  // 2,050 plants at one graphics setting and 1,993 at the other, `poppy ON oak_leaves` and
  // `grass ON birch_leaves` among them — 59 cells different in 81 chunks. A rendering table
  // must never be an input to worldgen; `SR.opaqueBase` is the table the renderer cannot reach.
  const worlds = (fast) => {
    const M2 = loadEngine({});
    M2.States.setFastLeaves(fast);
    M2.Gen.init(SEED, M2.Gen.defaults());
    const out = [];
    for (let cx = -2; cx <= 2; cx++) {
      for (let cz = -2; cz <= 2; cz++) {
        const col = M2.Gen.genColumn(cx, cz);
        const a = new Int32Array(M2.CFG.SECTIONS_Y * M2.CFG.SECTION_VOL);
        let n = 0;
        for (let sy = 0; sy < M2.CFG.SECTIONS_Y; sy++) {
          for (let i = 0; i < M2.CFG.SECTION_VOL; i++) a[n++] = M2.Section.get(col.sec[sy], i);
        }
        out.push(a);
      }
    }
    return { out, M2 };
  };
  const A = worlds(false), B = worlds(true);
  let diff = 0, first = null, cells = 0;
  for (let c = 0; c < A.out.length; c++) {
    for (let i = 0; i < A.out[c].length; i++) {
      cells++;
      if (A.out[c][i] !== B.out[c][i]) {
        diff++;
        if (!first) first = `${A.M2.States.name(A.out[c][i])} became ${B.M2.States.name(B.out[c][i])}`;
      }
    }
  }
  fastDiffCells = diff;
  ok(A.M2.States.fastLeaves === false && B.M2.States.fastLeaves === true,
     'the two engines did not actually differ in their leaf setting — 2e is vacuous');
  ok(cells > 100000, `only ${cells} cells compared — 2e is vacuous`);
  ok(diff === 0, `${diff} of ${cells} cells differ between fast and fancy leaves (first: ${first}) — a graphics setting is generating the world (D-197)`);
  if (PRINT) console.log(`   ${cells.toLocaleString()} cells compared across 25 chunks · ${diff} differ`);
}

// ─────────────────────────────────────────────── 2f. the growing plants
console.log('2f. a growing plant hangs from its own BODY, and a vine run ends in a head (D-233)');
{
  // ⚠ WHY THIS SECTION EXISTS. `floorOk` and `ceilingOk` both ended with "…or the neighbour is
  // the SAME BLOCK", and the head and the body of a growing plant are DIFFERENT BLOCKS —
  // `cave_vines` hangs under `cave_vines_plant`. So D-140's write-time test refused every vine
  // TIP and `setBlock` returned 0 without writing it. MEASURED against the golden 1.18.2 world at
  // seed 1337 (D-227): vanilla has 4,286 vertical vine runs and 4,285 of them end in a head.
  // MC-Lite had 703 runs with 533 headless, and every run that kept its head was exactly ONE
  // BLOCK LONG — the case where the sampled body length is 0. Every count in section 2 was zero
  // throughout, because a vine that was never written stands on nothing in no chunk at all.
  //
  // ⚠ AND NOT AT THE ORIGIN. Sections 2 to 2e walk chunks around (0,0), where this seed has no
  // lush cave at all: 169 chunks there hold FOUR vine runs. That is why the population walk below
  // goes to a named lush area, and it is D-148 (*a test that runs at the origin tests the origin*)
  // one more time.

  // ── the predicate, by name, both ways ──
  const C2 = (a, b) => SR.ceilingOk(SR.stateOf(a), SR.stateOf(b));
  const F3 = (a, b) => SR.floorOk(SR.stateOf(a), SR.stateOf(b));
  for (const [a, b] of [['cave_vines', 'cave_vines_plant'], ['cave_vines_plant', 'cave_vines_plant'],
                        ['cave_vines_plant', 'cave_vines'], ['cave_vines', 'moss_block'],
                        ['weeping_vines', 'weeping_vines_plant'], ['weeping_vines_plant', 'weeping_vines']]) {
    ok(C2(a, b) === true, `${a} may not hang under ${b}, and vanilla's canAttachTo says it may`);
  }
  for (const [a, b] of [['twisting_vines', 'twisting_vines_plant'], ['twisting_vines_plant', 'twisting_vines'],
                        ['kelp', 'kelp_plant'], ['kelp_plant', 'kelp'],
                        ['big_dripleaf', 'big_dripleaf_stem'], ['big_dripleaf_stem', 'big_dripleaf_stem']]) {
    ok(F3(a, b) === true, `${a} may not stand on ${b}, and vanilla's canSurvive says it may`);
  }
  // ⚠ AND WHAT VANILLA REFUSES, which is the half a "these all attach" rule would get wrong: a
  // DIFFERENT family's body, a leaf, and the directed half of the dripleaf rule —
  // `BigDripleafStemBlock.canSurvive` takes a stem or `#big_dripleaf_placeable`, never the leaf.
  for (const [a, b] of [['cave_vines', 'weeping_vines_plant'], ['cave_vines', 'twisting_vines_plant'],
                        ['cave_vines', 'oak_leaves'], ['weeping_vines', 'cave_vines_plant'],
                        ['hanging_roots', 'cave_vines_plant']]) {
    ok(C2(a, b) === false, `${a} is allowed to hang under ${b}, and vanilla never lets it`);
  }
  for (const [a, b] of [['twisting_vines', 'cave_vines_plant'], ['big_dripleaf_stem', 'big_dripleaf'],
                        ['big_dripleaf', 'big_dripleaf'], ['kelp', 'cave_vines_plant'],
                        ['grass', 'cave_vines_plant'], ['sugar_cane', 'kelp_plant']]) {
    ok(F3(a, b) === false, `${a} is allowed to stand on ${b}, and vanilla never lets it`);
  }
  // the pairing is DERIVED from the block names and must stay derived (D-233): the four
  // `X`/`X_plant` families are eight blocks, the named dripleaf pair is the ninth entry, and
  // `chorus_plant` is deliberately not one of them — there is no block called `chorus`.
  let partnered = 0;
  for (const n of R.names) if (n && SR.attachPartner(SR.stateOf(n)) !== '') partnered++;
  ok(partnered === 9, `${partnered} blocks carry a growing-plant partner — expected 9 (D-233)`);
  ok(SR.attachPartner(SR.stateOf('cave_vines')) === 'cave_vines_plant', 'cave_vines lost its body');
  ok(SR.attachPartner(SR.stateOf('chorus_plant')) === '', 'chorus_plant was paired with a block called chorus');
  ok(SR.attachPartner(SR.stateOf('chorus_flower')) === '', 'chorus_flower was given a growing-plant partner');
  ok(SR.attachPartner(SR.stateOf('big_dripleaf_stem')) === '', 'the dripleaf pair is not directed any more');

  // ── the WRITE-TIME path, which is the one that threw the tips away ──
  // ⚠ NOT `ceilingOk` AGAIN: `Features.supported` is what `setBlock` calls, and the whole bug was
  // that a head the packer had chosen was refused there and silently dropped (D-140, D-169).
  {
    const SB = new Uint16Array(H * 256);
    const head = SR.stateOf('cave_vines'), body = SR.stateOf('cave_vines_plant');
    const at = (y) => ((y - MINY) << 8) | (8 << 4) | 8;
    SB[at(71)] = body;
    ok(F.supported(SB, 0, 0, 8, 70, 8, head) === true,
       'Features.supported refuses a cave_vines head under its own cave_vines_plant body (D-233)');
    ok(F.supported(SB, 0, 0, 8, 70, 8, body) === true,
       'Features.supported refuses a vine body under its own body');
    SB[at(71)] = SR.stateOf('weeping_vines_plant');
    ok(F.supported(SB, 0, 0, 8, 70, 8, head) === false,
       'Features.supported hangs a cave_vines head from a weeping_vines_plant');
    SB[at(71)] = 0;
    ok(F.supported(SB, 0, 0, 8, 70, 8, head) === false,
       'Features.supported hangs a cave_vines head from air');
  }

  // ── the POPULATION: every vine run in a lush area ends in a head ──
  const runsSeen = vineRuns(MCL, LUSH);
  ok(runsSeen.runs > 300, `only ${runsSeen.runs} vine runs in the lush area — section 2f is vacuous`);
  // ⚠ THE BOUND IS VANILLA'S, NOT MC-LITE'S. The golden world's rate is 4,285 headed of 4,286;
  // MC-Lite's own truncation keeps the tip by construction (`prioritize_tip`, featcheck §4), so
  // the honest bound here is ZERO headless rather than vanilla's one-in-four-thousand.
  ok(runsSeen.headless === 0,
     `${runsSeen.headless} of ${runsSeen.runs} vine runs end in a body with air under it — the head was refused (D-233)`);
  ok(runsSeen.heads === runsSeen.runs, `${runsSeen.heads} heads for ${runsSeen.runs} runs — a head is not one per run`);
  // ⚠ AND THE SHAPE OF THE FIX, not just its count: before D-233 the 170 runs that kept a head
  // were ALL exactly one block long, because a head only survived where the body length was 0.
  ok(runsSeen.longer > runsSeen.runs * 0.3,
     `only ${runsSeen.longer} of ${runsSeen.runs} vine runs are longer than one block — the heads that survive are still only the bodyless ones`);
  // the dripleaf is the same defect and the same fix: a leaf standing on its own stem
  ok(runsSeen.dripOnStem > 20,
     `${runsSeen.dripOnStem} big_dripleaf stand on a big_dripleaf_stem — the leaf is still refusing its own stem (D-233)`);
  if (PRINT) {
    console.log(`   ${runsSeen.runs} vine runs · ${runsSeen.headless} headless · mean ${runsSeen.mean.toFixed(2)} blocks`
      + ` · ${runsSeen.dripOnStem} of ${runsSeen.drip} big_dripleaf on their own stem`);
  }
}

// ─────────────────────────────────────────────── 3. the spawners
console.log('3. the monster rooms — no cage hangs in the open (D-141)');
{
  const unhoused = spawners.filter(([, , , f, c]) => f === 'air' || c === 'air');
  ok(spawners.length >= 20, `only ${spawners.length} spawners in ${(2 * RAD + 1) ** 2} chunks — D-141 must not have deleted the dungeons`);
  // ⚠ NOT zero, and the reason is written down rather than tuned away. The gate refuses to
  // build a room whose own column has no floor or no ceiling, which is vanilla's abort applied
  // to the part of the footprint a single target chunk may read (D-134). What it cannot prevent
  // is a LATER feature — usually a second, overlapping monster room clearing its own interior —
  // taking the floor back out afterwards. Vanilla has the same interaction. Session 4 measured
  // 158 unhoused of 205 before the gate and 4 of 187 after it; the bound is where a regression
  // would have to land to escape notice.
  ok(unhoused.length <= spawners.length * 0.05,
     `${unhoused.length} of ${spawners.length} spawners are unhoused — was 158 before D-141`);
  if (PRINT) console.log(`   ${spawners.length} spawners · ${unhoused.length} unhoused ${JSON.stringify(unhoused.slice(0, 3))}`);
}

// ─────────────────────────────────────────────── 4. determinism
console.log('4. the rule does not depend on which chunk is being written');
{
  // The whole risk of a write-time block read (D-134): if the answer differs by target chunk,
  // a plant appears on one side of a border and not the other. `supported` treats an unreadable
  // neighbour as support for exactly that reason, and this asserts the consequence.
  const bytes = (cx, cz) => {
    const col = G.genColumn(cx, cz);
    const out = new Int32Array(CFG.SECTIONS_Y * CFG.SECTION_VOL);
    let n = 0;
    for (let sy = 0; sy < CFG.SECTIONS_Y; sy++) for (let i = 0; i < CFG.SECTION_VOL; i++) out[n++] = S.get(col.sec[sy], i);
    return out;
  };
  const a = bytes(3, -5);
  bytes(4, -5); bytes(3, -4); bytes(2, -5);          // its neighbours, in between
  const b = bytes(3, -5);
  let diff = -1;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { diff = i; break; }
  ok(diff < 0, `chunk (3,-5) generated differently the second time, first at index ${diff}`);
  ok(F.supported, 'Features.supported is not exposed — the rule cannot be tested');
}

// ─────────────────────────────────────────────── 5. anti-vacuity
console.log('5. anti-vacuity — break the rule and watch it fail');
{
  const av = [];
  const check = (label, fn) => { let caught = false; try { fn(); } catch { caught = true; } av.push([label, caught]); };

  check('a plant with air under it is accepted', () => {
    // The exact bug: air below a floor-class block must be refused by `supported`.
    const SB = new Uint16Array(H * 256);
    const grass = SR.stateOf('grass');
    const okAir = F.supported(SB, 0, 0, 8, 70, 8, grass);
    if (!okAir) throw 0;                              // refused, as it must be
  });

  check('a plant on the floor its own block accepts is refused', () => {
    // ⚠ THIS EXAMPLE USED TO BE STONE, and stone is not a floor for grass in vanilla — the
    // check had ENSHRINED the opaque rule D-197 replaced (the D-152 / D-178 mistake). The
    // assertion is unchanged in shape; only the example is now one vanilla agrees with.
    const SB = new Uint16Array(H * 256);
    const grass = SR.stateOf('grass'), ground = SR.stateOf('grass_block');
    SB[((70 - 1 - MINY) << 8) | (8 << 4) | 8] = ground;
    if (F.supported(SB, 0, 0, 8, 70, 8, grass)) throw 0;   // accepted, as it must be
  });

  check('a ceiling block judged by what is under it', () => {
    const SB = new Uint16Array(H * 256);
    const vine = SR.stateOf('cave_vines'), stone = SR.stateOf('stone');
    SB[((70 - 1 - MINY) << 8) | (8 << 4) | 8] = stone;     // floor, not ceiling
    const onFloor = F.supported(SB, 0, 0, 8, 70, 8, vine);
    SB[((70 - 1 - MINY) << 8) | (8 << 4) | 8] = 0;
    SB[((70 + 1 - MINY) << 8) | (8 << 4) | 8] = stone;     // ceiling
    const onCeil = F.supported(SB, 0, 0, 8, 70, 8, vine);
    if (!onFloor && onCeil) throw 0;                       // the right way up, as it must be
  });

  check('a plant is allowed to stand on sand', () => {
    // The measured bug, exactly: 891 grass on sand in 81 chunks, all of them opaque-legal.
    const SB = new Uint16Array(H * 256);
    const grass = SR.stateOf('grass'), sand = SR.stateOf('sand');
    SB[((70 - 1 - MINY) << 8) | (8 << 4) | 8] = sand;
    if (!F.supported(SB, 0, 0, 8, 70, 8, grass)) throw 0;  // refused, as it must be
  });

  check('the placement sets read as empty', () => {
    // If the packer stopped writing them, or `buildPlacement` never ran, section 2d would pass
    // on an empty rule set and every plant would be back on the opaque test.
    let n = 0;
    for (let s = 1; s < SR.count; s++) if (SR.placeRule[s] !== 255) n++;
    if (n >= 120) throw 0;                            // 41 blocks is 153 states
  });

  check('section 2e comparing two identical engines', () => {
    // ⚠ THE FENCE MUST BE ABLE TO FAIL. Two worlds are generated with the PRE-D-197 floorOk
    // put back — the opaque table, which `setFastLeaves` writes — and they MUST come out
    // different, or 2e's `diff === 0` proves nothing. 9 chunks was 7 cells before the fix.
    const old = (SRx) => function (st, below) {
      if (below === 0) return false;
      if (SRx.opaque[below] === 1) return true;
      return SRx.block[below] === SRx.block[st] && SRx.stacksOnSelf(st);
    };
    const gen = (fast) => {
      const M2 = loadEngine({});
      M2.States.floorOk = old(M2.States);
      M2.Survive.eval = () => -1;                  // the class door alone, as before #19: the rule would mask the old floorOk
      M2.States.setFastLeaves(fast);
      M2.Gen.init(SEED, M2.Gen.defaults());
      const out = [];
      for (let cx = -1; cx <= 1; cx++) {
        for (let cz = -1; cz <= 1; cz++) {
          const col = M2.Gen.genColumn(cx, cz);
          for (let sy = 0; sy < M2.CFG.SECTIONS_Y; sy++) {
            for (let i = 0; i < M2.CFG.SECTION_VOL; i++) out.push(M2.Section.get(col.sec[sy], i));
          }
        }
      }
      return out;
    };
    const a = gen(false), b = gen(true);
    let d = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
    if (d > 0) throw 0;                               // the old rule DID depend on the setting
  });

  check('a vine head that may not hang from its own body', () => {
    // ⚠ THE FENCE MUST BE ABLE TO FAIL. The PRE-D-233 tail is put back in a second engine — "…or
    // the neighbour is the SAME BLOCK" — and the same lush chunks are regenerated. That rule
    // measured 717 runs with 554 of them headless, so section 2f's `headless === 0` is a claim
    // about the world and not about the walk.
    const M2 = loadEngine({});
    const S2 = M2.States;
    S2.ceilingOk = function (st, above) {
      if (above === 0) return false;
      if (S2.opaqueBase[above] === 1) return true;
      return S2.block[above] === S2.block[st] && S2.stacksOnSelf(st);
    };
    M2.Survive.eval = () => -1;                    // the class door alone, as before #19: rule 34 would mask the old ceilingOk
    M2.Gen.init(SEED, M2.Gen.defaults());
    const r = vineRuns(M2, LUSH);
    if (r.headless > 0) throw 0;                      // the old rule DID lose the heads
  });

  check('a head allowed to hang from another plant\'s body', () => {
    // The other direction, and the one a lazy fix gets wrong: "anything with a partner attaches
    // to anything with a partner" would hang a cave vine under a weeping vine. Section 2f's
    // refusals are what catch that, so they must be able to.
    const M2 = loadEngine({});
    const S2 = M2.States;
    S2.attachOk = (st, nb) => nb !== 0 && S2.attachPartner(st) !== '' && S2.attachPartner(nb) !== '';
    if (S2.ceilingOk(S2.stateOf('cave_vines'), S2.stateOf('weeping_vines_plant'))) throw 0;
  });

  check('section 2f walking an area with no vines in it', () => {
    // The walk itself: an area with no lush cave says nothing, which is why 2f leaves the origin.
    if (vineRuns(MCL, { cx0: 0, cx1: 2, cz0: 0, cz1: 2 }).runs === 0) throw 0;
  });

  check('the support table read as all-zero', () => {
    // If the packer stopped writing the class, section 2 would pass on an empty rule set.
    let n = 0;
    for (let s = 1; s < SR.count; s++) if (SR.support[s]) n++;
    if (n >= 100) throw 0;                            // 54 blocks is hundreds of states
  });

  check('section 2 walking a world with no plants in it', () => {
    if (supportedSeen > 0 && blocksWalked > 0) throw 0;
  });

  for (const [label, caught] of av) {
    ok(caught, `ANTI-VACUITY FAILURE: "${label}" was not caught — this check proves nothing`);
    console.log(`   ${caught ? '✓' : '✗'} ${label}`);
  }
}

console.log('');
console.log('================ floatcheck ===============');
console.log(` assertions passed .. ${pass.toLocaleString()}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails.slice(0, 20)) console.log('   ✗ ' + f);
console.log('==========================================');
process.exit(fails.length ? 1 : 0);
