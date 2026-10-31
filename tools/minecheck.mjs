#!/usr/bin/env node
// minecheck.mjs — PLAN G3's acceptance: *"a table of >=30 (block, tool, enchantment) triples with
// hand-computed break times, asserted to the tick"* — plus the drops those breaks produce.
//
//   node tools/minecheck.mjs
//
// ── WHAT "HAND-COMPUTED" MEANS HERE, AND WHY IT IS NOT CIRCULAR ──────────────────────────
// Every expected tick count in §3 is written as an arithmetic comment, not as a call into the
// module under test:  ticks = ceil(hardness * bracket / speed), with the bracket 30 when the tool
// can harvest and 100 when it cannot. `stone` with a wooden pickaxe is ceil(1.5*30/2) = ceil(22.5)
// = 23 ticks = 1.15 s, and 1.15 s is the number the wiki, the game and this table all say. A
// table generated from `Mining.ticks` would pass whatever the code did; this one cannot.
//
// ── AND THE DROPS ────────────────────────────────────────────────────────────────────────
// §4 exercises the loot interpreter against the same roster: the exact drops for the cases with
// one answer, and the MEAN over 20,000 rolls for the ones that are distributions — Fortune III on
// diamond ore is 2.2 diamonds and nothing else will do. §5 then sweeps all 835 tables under six
// tool contexts and asserts that every item any of them can emit is an item this build has.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ASSETS = join(ROOT, 'assets');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); };
const near = (a, b, tol, what) => ok(Math.abs(a - b) <= tol, `${what}: ${a.toFixed(4)} vs ${b} (+-${tol})`);

const MCL = loadEngine({ extra: ['02f_tags.js', '07d_mining.js', '07e_loot.js'], dom: false });
const R = MCL.Reg, S = MCL.States, M = MCL.Mining, L = MCL.Loot;
const items = JSON.parse(readFileSync(join(ASSETS, 'item-registry.json'), 'utf8')).items;
const miningMeta = JSON.parse(readFileSync(join(ASSETS, 'mining.meta.json'), 'utf8'));
const lootMeta = JSON.parse(readFileSync(join(ASSETS, 'loot.meta.json'), 'utf8'));
const def = (n) => R.realFirst[R.id[n]] + R.defaultState[R.id[n]];

// ─────────────────────────────────────────────── 1. the tables decoded and reached the roster
console.log('1. the tool tables decoded against the block roster');
{
  ok(M.ready, 'Mining.init did not run');
  ok(L.ready, 'Loot.init did not run');
  ok(M.unknownBlocks.length === 0, `${M.unknownBlocks.length} packed blocks are not in the registry: ${M.unknownBlocks.join(' ')}`);
  ok(L.tableCount === lootMeta.files, `${L.tableCount} loot tables at runtime, ${lootMeta.files} packed`);
  ok(M.toolCount === miningMeta.tools, `${M.toolCount} tool items, ${miningMeta.tools} packed`);
  // ⚠ the two blocks with no minecraft-data entry must be `default`, not material index 0 —
  // materials.json sorts `coweb` first, and a zero-fill made both of them cobweb.
  ok(M.materialOf(R.id.item_frame) === 'default', `item_frame's material is ${M.materialOf(R.id.item_frame)}`);
  ok(M.materialOf(R.id.stone) === 'mineable/pickaxe', `stone's material is ${M.materialOf(R.id.stone)}`);
  console.log(`   ${M.toolCount} tool items · ${M.materialCount} materials · ${L.tableCount} loot tables`);
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 2. the tier speeds are the data's, not PLAN's
console.log('2. the six tier speeds come out of the packed table');
{
  // PLAN quotes wood 2, stone 4, iron 6, diamond 8, netherite 9, gold 12. Nothing typed them in:
  // they are `materials.json`'s own numbers, and this is where the two are compared.
  const want = { wooden: 2, stone: 4, iron: 6, diamond: 8, netherite: 9, golden: 12 };
  for (const [tier, speed] of Object.entries(want)) {
    for (const kind of ['pickaxe', 'axe', 'shovel', 'hoe']) {
      const block = kind === 'pickaxe' ? 'stone' : kind === 'axe' ? 'oak_log' : kind === 'shovel' ? 'dirt' : 'hay_block';
      ok(M.itemSpeed(`${tier}_${kind}`, R.id[block]) === speed,
         `${tier}_${kind} on ${block} is ${M.itemSpeed(`${tier}_${kind}`, R.id[block])}, expected ${speed}`);
    }
  }
  // the overrides that are not a tier at all
  ok(M.itemSpeed('shears', R.id.white_wool) === 5, 'shears on wool should be 5');
  ok(M.itemSpeed('shears', R.id.oak_leaves) === 15, 'shears on leaves should be 15');
  ok(M.itemSpeed('shears', R.id.cobweb) === 15, 'shears on cobweb should be 15');
  ok(M.itemSpeed('iron_sword', R.id.cobweb) === 15, 'a sword on cobweb should be 15');
  ok(M.itemSpeed('iron_sword', R.id.oak_leaves) === 1.5, 'a sword on leaves should be 1.5');
  ok(M.itemSpeed('iron_pickaxe', R.id.dirt) === 1, 'a pickaxe on dirt should be 1 — the wrong tool is never fast');
  ok(M.itemSpeed('', R.id.stone) === 1, 'a bare hand is 1');
  console.log('   24 tier speeds + 7 overrides');
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 3. the break-time table, to the tick
console.log('3. break times, hand-computed, asserted to the tick');
{
  // block, tool, ctx, expected ticks, the arithmetic.
  // h = hardness, i = 30 when the tool can harvest and 100 when it cannot, s = tool speed.
  //
  // ⚠ THREE ROWS BELOW ARE ONE TICK LONGER THAN THE WIKI'S NUMBER, AND FLOAT32 IS WHY (D-209).
  // Vanilla does this arithmetic in `float`, and `progress = float(float(s/h)/i)` is not the
  // rational number: for cobblestone by hand it is 0.0049999998882, whose reciprocal is
  // 200.0000045, so the block comes apart on tick 201 and not on tick 200. The same lands on
  // obsidian by hand (5001, not 5000) and cobweb by hand (401, not 400). Every other row here
  // rounds the other way and the rational and the float answers are identical — stone by hand is
  // 0.0066666668, reciprocal 149.99999, ceiling 150. This is still hand-computable: it is the
  // same division, done to 24 bits of mantissa instead of 53.
  const T = [
    ['stone', '', {}, 150, 'h1.5 i100 s1  -> ceil(150)    = 150  (7.5 s)'],
    ['stone', 'wooden_pickaxe', {}, 23, 'h1.5 i30 s2   -> ceil(22.5)   = 23   (1.15 s)'],
    ['stone', 'stone_pickaxe', {}, 12, 'h1.5 i30 s4   -> ceil(11.25)  = 12   (0.6 s)'],
    ['stone', 'iron_pickaxe', {}, 8, 'h1.5 i30 s6   -> ceil(7.5)    = 8    (0.4 s)'],
    ['stone', 'diamond_pickaxe', {}, 6, 'h1.5 i30 s8   -> ceil(5.625)  = 6    (0.3 s)'],
    ['stone', 'netherite_pickaxe', {}, 5, 'h1.5 i30 s9   -> ceil(5)      = 5    (0.25 s)'],
    ['stone', 'golden_pickaxe', {}, 4, 'h1.5 i30 s12  -> ceil(3.75)   = 4    (0.2 s)'],
    ['stone', 'wooden_shovel', {}, 150, 'wrong tool: s1, and stone needs one, so i100'],
    ['cobblestone', 'wooden_pickaxe', {}, 30, 'h2 i30 s2     -> ceil(30)     = 30   (1.5 s)'],
    ['cobblestone', '', {}, 201, 'h2 i100 s1: float p = 0.0049999998882, 1/p = 200.0000045 -> 201'],
    ['obsidian', 'diamond_pickaxe', {}, 188, 'h50 i30 s8    -> ceil(187.5)  = 188  (9.4 s)'],
    ['obsidian', 'netherite_pickaxe', {}, 167, 'h50 i30 s9    -> ceil(166.67) = 167  (8.35 s)'],
    ['obsidian', 'iron_pickaxe', {}, 834, 'iron cannot harvest obsidian: i100 s6 -> ceil(833.3) = 834'],
    ['obsidian', '', {}, 5001, 'h50 i100 s1: float p = 0.00019999999495, 1/p = 5000.0001 -> 5001'],
    ['dirt', '', {}, 15, 'h0.5 i30 s1   -> ceil(15)     = 15   (0.75 s)'],
    ['dirt', 'wooden_shovel', {}, 8, 'h0.5 i30 s2   -> ceil(7.5)    = 8    (0.4 s)'],
    ['dirt', 'diamond_shovel', {}, 2, 'h0.5 i30 s8   -> ceil(1.875)  = 2    (0.1 s)'],
    ['oak_log', '', {}, 60, 'h2 i30 s1     -> 60 ticks = 3 s'],
    ['oak_log', 'iron_axe', {}, 10, 'h2 i30 s6     -> ceil(10)     = 10   (0.5 s)'],
    ['oak_planks', 'iron_axe', {}, 10, 'h2 i30 s6     -> 10'],
    ['oak_leaves', '', {}, 6, 'h0.2 i30 s1   -> ceil(6)      = 6    (0.3 s)'],
    ['oak_leaves', 'shears', {}, 1, 'h0.2 i30 s15  -> ceil(0.4)    = 1'],
    ['oak_leaves', 'iron_sword', {}, 4, 'h0.2 i30 s1.5 -> ceil(4)      = 4'],
    ['cobweb', 'shears', {}, 8, 'h4 i30 s15    -> ceil(8)      = 8    (0.4 s)'],
    ['cobweb', 'iron_sword', {}, 8, 'a sword harvests cobweb: i30 s15 -> 8'],
    ['cobweb', '', {}, 401, 'h4 i100 s1: float p = 0.0024999999441, 1/p = 400.0000089 -> 401'],
    ['white_wool', 'shears', {}, 5, 'h0.8 i30 s5   -> ceil(4.8)    = 5    (0.25 s)'],
    ['white_wool', '', {}, 24, 'h0.8 i30 s1   -> 24 ticks = 1.2 s'],
    ['glass', '', {}, 9, 'h0.3 i30 s1   -> 9 ticks = 0.45 s (glass needs no tool)'],
    ['iron_ore', 'stone_pickaxe', {}, 23, 'h3 i30 s4     -> ceil(22.5)   = 23'],
    ['iron_ore', 'wooden_pickaxe', {}, 150, 'wood cannot harvest iron ore: i100 s2 -> 150'],
    ['diamond_ore', 'iron_pickaxe', {}, 15, 'h3 i30 s6     -> 15 ticks = 0.75 s'],
    ['deepslate', 'diamond_pickaxe', {}, 12, 'h3 i30 s8     -> ceil(11.25)  = 12'],
    ['netherite_block', 'diamond_pickaxe', {}, 188, 'h50 i30 s8    -> ceil(187.5)  = 188'],
    // the enchantment and effect arms — vanilla ADDS level^2+1 and only when the base speed > 1
    ['stone', 'diamond_pickaxe', { efficiency: 5 }, 2, 's = 8 + (25+1) = 34 -> ceil(45/34) = ceil(1.32) = 2'],
    ['stone', 'wooden_pickaxe', { efficiency: 1 }, 12, 's = 2 + (1+1) = 4  -> ceil(45/4) = ceil(11.25) = 12'],
    ['dirt', 'diamond_pickaxe', { efficiency: 5 }, 15, 'a pickaxe on dirt is speed 1, so Efficiency does NOT apply: 15'],
    ['stone', 'diamond_pickaxe', { haste: 2 }, 5, 's = 8 * (1 + 0.2*2) = 11.2 -> ceil(45/11.2) = ceil(4.018) = 5'],
    ['stone', 'diamond_pickaxe', { fatigue: 3 }, 2084, 's = 8 * 0.0027 = 0.0216 -> ceil(45/0.0216) = 2084'],
    ['stone', 'diamond_pickaxe', { inWater: true }, 29, 's = 8/5 = 1.6 -> ceil(45/1.6) = ceil(28.125) = 29'],
    ['stone', 'diamond_pickaxe', { inWater: true, aquaAffinity: true }, 6, 'aqua affinity cancels it: back to 6'],
    ['stone', 'diamond_pickaxe', { onGround: false }, 29, 'airborne is the same /5: 29'],
    ['stone', 'diamond_pickaxe', { inWater: true, onGround: false }, 141, 's = 8/25 = 0.32 -> ceil(140.625) = 141'],
    ['stone', 'diamond_pickaxe', { efficiency: 5, haste: 2 }, 1, 's = 34 * 1.4 = 47.6, and 47.6/1.5/30 > 1 — an instant break'],
  ];
  let n = 0;
  for (const [block, tool, ctx, want, why] of T) {
    const got = M.ticks(def(block), Object.assign({ item: tool }, ctx));
    ok(got === want, `${block} + ${tool || 'hand'} ${JSON.stringify(ctx)}: ${got} ticks, expected ${want}  [${why}]`);
    n++;
  }
  ok(n >= 30, `only ${n} break-time triples — PLAN asks for at least 30`);
  ok(M.ticks(def('bedrock'), { item: 'netherite_pickaxe' }) === Infinity, 'bedrock must never break');
  ok(M.ticks(def('barrier'), { item: '' }) === Infinity, 'a barrier must never break');
  ok(M.instant(def('torch'), { item: '' }), 'a torch is an instant break (hardness 0)');
  ok(M.instant(def('wheat'), { item: '' }), 'wheat is an instant break');
  console.log(`   ${n} hand-computed break times, all to the tick`);
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 3b. harvest, from the data's own answer
console.log('3b. requiresCorrectToolForDrops, per (block, tool)');
{
  const H = [
    ['stone', '', false], ['stone', 'wooden_pickaxe', true], ['stone', 'wooden_shovel', false],
    ['iron_ore', 'wooden_pickaxe', false], ['iron_ore', 'stone_pickaxe', true],
    ['diamond_ore', 'stone_pickaxe', false], ['diamond_ore', 'iron_pickaxe', true],
    ['obsidian', 'iron_pickaxe', false], ['obsidian', 'diamond_pickaxe', true],
    ['ancient_debris', 'diamond_pickaxe', true], ['ancient_debris', 'iron_pickaxe', false],
    // ⚠ the four D-102 named: `mineable/pickaxe` contains all of these and none of them needs a tool
    ['ice', '', true], ['rail', '', true], ['glass', '', true], ['dirt', '', true],
    // and cobweb, whose harvest set is swords and shears and no pickaxe at all
    ['cobweb', 'iron_sword', true], ['cobweb', 'shears', true], ['cobweb', 'diamond_pickaxe', false],
    ['cobweb', '', false],
    // gold needs iron, and a GOLDEN pickaxe is tier wood: fast and unable to harvest it
    ['gold_ore', 'golden_pickaxe', false], ['gold_ore', 'iron_pickaxe', true],
  ];
  for (const [block, tool, want] of H) {
    ok(M.canHarvest(R.id[block], tool) === want, `canHarvest(${block}, ${tool || 'hand'}) = ${M.canHarvest(R.id[block], tool)}, expected ${want}`);
  }
  console.log(`   ${H.length} harvest pairs`);
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 4. drops
console.log('4. the loot tables, exactly where they have one answer');
{
  const rng = L.rng(20260908);
  const one = (block, ctx) => L.breakDrops(def(block), Object.assign({ rng }, ctx)).map((s) => s.item + 'x' + s.count).join('+');
  const EXACT = [
    ['stone', { item: 'diamond_pickaxe' }, 'cobblestonex1'],
    ['stone', { item: 'diamond_pickaxe', silkTouch: 1 }, 'stonex1'],
    ['stone', { item: '' }, ''],
    ['stone', { item: 'wooden_shovel' }, ''],
    ['deepslate', { item: 'iron_pickaxe' }, 'cobbled_deepslatex1'],
    ['grass_block', { item: 'iron_shovel' }, 'dirtx1'],
    ['grass_block', { item: 'iron_shovel', silkTouch: 1 }, 'grass_blockx1'],
    ['coal_ore', { item: 'stone_pickaxe' }, 'coalx1'],
    ['coal_ore', { item: 'stone_pickaxe', silkTouch: 1 }, 'coal_orex1'],
    ['diamond_ore', { item: 'iron_pickaxe' }, 'diamondx1'],
    ['glass', { item: '' }, ''],
    ['glass', { item: 'iron_pickaxe', silkTouch: 1 }, 'glassx1'],
    ['oak_log', { item: '' }, 'oak_logx1'],
    ['ice', { item: 'iron_pickaxe' }, ''],
    ['ice', { item: 'iron_pickaxe', silkTouch: 1 }, 'icex1'],
    ['bedrock', { item: 'netherite_pickaxe' }, ''],
    ['clay', { item: 'iron_shovel' }, 'clay_ballx4'],
    ['bookshelf', { item: 'iron_axe' }, 'bookx3'],
    ['bookshelf', { item: 'iron_axe', silkTouch: 1 }, 'bookshelfx1'],
  ];
  for (const [block, ctx, want] of EXACT) {
    const got = one(block, ctx);
    ok(got === want, `${block} + ${ctx.item || 'hand'}${ctx.silkTouch ? ' (silk)' : ''}: "${got}", expected "${want}"`);
  }

  // the state-dependent ones: the same block, two states, two answers
  const stateWith = (block, prop, value) => {
    const b = R.id[block];
    for (let s = R.realFirst[b]; s < R.realFirst[b + 1]; s++) {
      if (R.valueNames[S.propValue(s, R.PROP[prop])] === value) return s;
    }
    return def(block);
  };
  const drops = (st, ctx) => L.breakDrops(st, Object.assign({ rng }, ctx)).map((s) => s.item + 'x' + s.count).join('+');
  ok(drops(stateWith('oak_slab', 'type', 'double'), { item: '' }) === 'oak_slabx2', 'a double slab drops two');
  ok(drops(stateWith('oak_slab', 'type', 'bottom'), { item: '' }) === 'oak_slabx1', 'a single slab drops one');
  ok(drops(stateWith('red_bed', 'part', 'head'), { item: '' }) === 'red_bedx1', 'the head of a bed drops the bed');
  ok(drops(stateWith('red_bed', 'part', 'foot'), { item: '' }) === '', 'the foot of a bed drops nothing — or a bed duplicates itself');
  ok(drops(MCL.States.withLocal('wheat', 7), { item: '' }).indexOf('wheatx1') === 0, 'fully grown wheat drops wheat');
  ok(drops(MCL.States.withLocal('wheat', 0), { item: '' }) === 'wheat_seedsx1', 'unripe wheat drops one seed');

  // ── the distributions. 20,000 rolls each.
  const mean = (block, ctx, n, only) => {
    let t = 0;
    for (let i = 0; i < n; i++) {
      for (const s of L.breakDrops(def(block), Object.assign({ rng }, ctx))) if (!only || s.item === only) t += s.count;
    }
    return t / n;
  };
  near(mean('diamond_ore', { item: 'iron_pickaxe' }, 20000), 1, 0.001, 'diamond ore, no fortune');
  near(mean('diamond_ore', { item: 'iron_pickaxe', fortune: 1 }, 20000), 1.3333, 0.03, 'diamond ore, Fortune I');
  near(mean('diamond_ore', { item: 'iron_pickaxe', fortune: 2 }, 20000), 1.75, 0.04, 'diamond ore, Fortune II');
  near(mean('diamond_ore', { item: 'iron_pickaxe', fortune: 3 }, 20000), 2.2, 0.06, 'diamond ore, Fortune III');
  near(mean('lapis_ore', { item: 'iron_pickaxe' }, 20000), 6.5, 0.06, 'lapis is uniform 4..9');
  near(mean('redstone_ore', { item: 'iron_pickaxe' }, 20000), 4.5, 0.05, 'redstone is uniform 4..5');
  near(mean('redstone_ore', { item: 'iron_pickaxe', fortune: 3 }, 20000), 6, 0.08, 'redstone + Fortune III adds uniform 0..3');
  near(mean('melon', { item: 'iron_axe' }, 20000, 'melon_slice'), 5, 0.06, 'a melon is 3..7 slices');

  // gravel's flint is a table_bonus, and Fortune III makes it certain
  const flintRate = (fortune) => {
    let hits = 0;
    for (let i = 0; i < 20000; i++) {
      const d = L.breakDrops(def('gravel'), { item: 'iron_shovel', fortune, rng });
      if (d.length && d[0].item === 'flint') hits++;
    }
    return hits / 20000;
  };
  near(flintRate(0), 0.10, 0.012, 'gravel drops flint 10% of the time');
  near(flintRate(3), 1.00, 0.001, 'gravel + Fortune III is always flint');

  // leaves: sapling 5%, sticks 2%, and an oak apple at 0.5%
  let sap = 0, stick = 0, apple = 0;
  for (let i = 0; i < 20000; i++) {
    for (const s of L.breakDrops(def('oak_leaves'), { item: '', rng })) {
      if (s.item === 'oak_sapling') sap++; else if (s.item === 'stick') stick += 1; else if (s.item === 'apple') apple++;
    }
  }
  near(sap / 20000, 0.05, 0.005, 'oak leaves drop a sapling 5% of the time');
  near(stick / 20000, 0.02, 0.004, 'oak leaves drop sticks 2% of the time');
  near(apple / 20000, 0.005, 0.002, 'oak leaves drop an apple 0.5% of the time');
  ok(one('oak_leaves', { item: 'shears' }) === 'oak_leavesx1', 'shears take the leaf block');
  console.log(`   ${EXACT.length} exact drops · 6 state-dependent · 13 distributions over 20,000 rolls`);
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 5. the whole corpus, swept
console.log('5. all 835 tables run, and every item they can emit exists');
{
  const rng = L.rng(7);
  const contexts = [
    { item: '' },
    { item: 'netherite_pickaxe' },
    { item: 'netherite_pickaxe', silkTouch: 1 },
    { item: 'netherite_pickaxe', fortune: 3 },
    { item: 'shears' },
    { item: 'netherite_pickaxe', explosionRadius: 5 },
  ];
  const emitted = new Set();
  let evaluated = 0, threw = 0, negative = 0;
  for (let b = 0; b < R.blockCount; b++) {
    const name = R.names[b];
    if (!L.hasTable(name)) continue;
    const st = R.realFirst[b] + R.defaultState[b];
    for (const c of contexts) {
      for (let rep = 0; rep < 3; rep++) {
        try {
          const d = L.drops(Object.assign({ state: st, rng }, c));
          evaluated++;
          for (const s of d) { emitted.add(s.item); if (!(s.count > 0)) negative++; }
        } catch (e) { threw++; if (threw < 4) console.log('     throw on ' + name + ': ' + e.message); }
      }
    }
  }
  ok(threw === 0, `${threw} loot evaluations threw`);
  ok(negative === 0, `${negative} drops came out with a count <= 0`);
  // ⚠ D-381: `lootMeta.files` now also counts the 92 entity/gameplay tables G18d packs
  // alongside the 835 block ones (`pack-loot.mjs`) — this sweep is BLOCKS only, so it is
  // `lootMeta.blockFiles` this assertion owns, not the corpus total.
  ok(evaluated === lootMeta.blockFiles * contexts.length * 3,
     `evaluated ${evaluated}, expected ${lootMeta.blockFiles * contexts.length * 3}`);
  const unknown = [...emitted].filter((i) => !items[i]);
  ok(unknown.length === 0, `${unknown.length} emitted items are not in the item registry: ${unknown.slice(0, 8).join(' ')}`);
  ok(emitted.size > 400, `only ${emitted.size} distinct items came out of 835 tables`);
  console.log(`   ${evaluated} evaluations · ${emitted.size} distinct items · ${threw} throws · ${unknown.length} unknown`);
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 6. cost
console.log('6. what G3 costs');
{
  ok(miningMeta.packedBytes + lootMeta.packedBytes < 40000,
     `the two payloads are ${miningMeta.packedBytes + lootMeta.packedBytes} bytes deflated`);
  console.log(`   mining ${(miningMeta.packedBytes / 1024).toFixed(1)} KB + loot ${(lootMeta.packedBytes / 1024).toFixed(1)} KB deflated ` +
              `= ${((miningMeta.packedBytes + lootMeta.packedBytes) * 4 / 3 / 1024).toFixed(1)} KB of base64 in the file`);
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 7. anti-vacuity (D-30)
console.log('7. anti-vacuity: break it, and it must be caught');
{
  const av = [];
  // ⚠ ONE ENGINE PER BREAK, BOTH ARMS ON IT, clean arm first — see the same note in tagcheck.
  // Decoding the roster is 254 ms and there are six breaks here; a separate engine per arm cost
  // 1.5 s to prove nothing extra.
  let ENGINE = null;
  const brk = (label, judge, run) => {
    ENGINE = loadEngine({ extra: ['02f_tags.js', '07d_mining.js', '07e_loot.js'], dom: false });
    const clean = judge(run(false)) === true;
    const dirty = judge(run(true)) === false;
    av.push([label, clean && dirty]);
  };
  const fresh = () => ENGINE;
  const stoneOf = (E) => E.Reg.realFirst[E.Reg.id.stone] + E.Reg.defaultState[E.Reg.id.stone];

  brk('Efficiency made a multiplier instead of an addition, as PLAN paraphrases it', (t) => t === 2, (broken) => {
    const E = fresh();
    if (broken) {
      E.Mining.playerSpeed = function (block, ctx) {
        const c = ctx || {};
        let f = E.Mining.itemSpeed(c.item, block);
        if (f > 1 && c.efficiency > 0) f *= (c.efficiency * c.efficiency + 1);
        return f;
      };
    }
    return E.Mining.ticks(stoneOf(E), { item: 'diamond_pickaxe', efficiency: 5 });
  });

  brk('the harvest bracket collapsed to 30 for everything', (t) => t === 150, (broken) => {
    const E = fresh();
    if (broken) E.Mining.canHarvest = () => true;
    return E.Mining.ticks(stoneOf(E), { item: '' });
  });

  brk('Silk Touch ignored on stone', (d) => d === 'stone', (broken) => {
    const E = fresh();
    if (broken) E.Loot.enchantLevel = () => 0;
    const out = E.Loot.breakDrops(stoneOf(E), { item: 'diamond_pickaxe', silkTouch: 1, rng: E.Loot.rng(1) });
    return out.length ? out[0].item : '';
  });

  brk('apply_bonus{ore_drops} turned into a flat uniform bonus', (mean) => Math.abs(mean - 2.2) < 0.06, (broken) => {
    const E = fresh();
    const st = E.Reg.realFirst[E.Reg.id.diamond_ore] + E.Reg.defaultState[E.Reg.id.diamond_ore];
    const rng = E.Loot.rng(99);
    if (broken) {
      // the `apply_bonus` sits on a child of the table's `alternatives` entry, so the mutation
      // walks to it rather than assuming a shape — the point is to change the FORMULA the real
      // interpreter then runs, not to reshape the table.
      let hit = 0;
      const walk = (n) => {
        if (Array.isArray(n)) return n.forEach(walk);
        if (!n || typeof n !== 'object') return;
        if (n.function === 'apply_bonus') { n.formula = 'uniform_bonus_count'; n.parameters = { bonusMultiplier: 1 }; hit++; }
        for (const k of Object.keys(n)) walk(n[k]);
      };
      walk(E.Loot.table('diamond_ore'));
      if (!hit) throw new Error('the mutation found no apply_bonus to break');
    }
    let t = 0;
    for (let i = 0; i < 20000; i++) t += E.Loot.breakDrops(st, { item: 'iron_pickaxe', fortune: 3, rng })[0].count;
    return t / 20000;
  });

  brk('a block-state condition that always passes', (foot) => foot === '', (broken) => {
    const E = fresh();
    const b = E.Reg.id.red_bed;
    let foot = 0;
    for (let s = E.Reg.realFirst[b]; s < E.Reg.realFirst[b + 1]; s++) {
      if (E.Reg.valueNames[E.States.propValue(s, E.Reg.PROP.part)] === 'foot') { foot = s; break; }
    }
    // the bed's `part=head` guard is the entry's own condition — remove it and the FOOT drops a
    // bed too, which is the duplication bug this section exists to refuse.
    if (broken) E.Loot.table('red_bed').pools[0].entries[0].conditions = [];
    const out = E.Loot.breakDrops(foot, { item: '', rng: E.Loot.rng(3) });
    return out.length ? out[0].item : '';
  });

  brk('the two blocks with no pc entry zero-filled to material 0', (m) => m === 'default', (broken) => {
    const E = fresh();
    return broken ? E.Mining.materialNames[0] : E.Mining.materialOf(E.Reg.id.item_frame);
  });

  for (const [label, caught] of av) {
    ok(caught, `ANTI-VACUITY FAILURE: "${label}" is not distinguished from correct behaviour`);
    console.log(`   ${caught ? '✓' : '✗'} ${label}`);
  }
}

console.log('');
console.log('================ minecheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails.slice(0, 20)) console.log('   ✗ ' + f);
console.log('==========================================');
process.exit(fails.length ? 1 : 0);
