#!/usr/bin/env node
// itemcheck.mjs — PLAN G7's acceptance test. Dan: "items perfect too."
//
//   node tools/itemcheck.mjs
//
// The interesting thing about items is that "an item" is three different objects wearing the
// same word, and every clone that looks wrong got the split wrong:
//   FLAT   a sprite, composited from layer0..layerN — a potion is its overlay UNDER its
//          bottle, and drawing only layer0 gives a colourless bottle
//   BLOCK  a 3D model drawn in the GUI transform. NOT the blockstates entry: a fence in the
//          inventory is one post and one arm, not the sixteen-state multipart thing
//   ENTITY chests, banners, beds, skulls, tridents — vanilla draws a live entity model
// and on top of that ~135 files under models/item/ are not items at all: templates and the
// override frames of a clock, a compass and a drawn bow.
//
// Every expectation below was read out of the jar by hand and names where it came from.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The project root, derived from THIS FILE's location rather than hard-coded. Every tool
// here used to hard-code an absolute path, which meant the whole suite ran
// on exactly one machine — the checks synced to Dan's copy could not be run there at all.
import { fileURLToPath } from 'node:url';
// ⚠ §8's breaks need §7b's two tables; they are stashed here rather than recomputed, so a
// break can never be measuring a second, differently-built copy of the thing it is breaking.
const AV = {};
const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));   // ends with a separator


const OUT = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1]
  : MCLITE_ROOT + 'assets';
const rd = (f) => JSON.parse(readFileSync(join(OUT, f), 'utf8'));

const R = rd('item-registry.json');
const rep = rd('item-report.json');
const iAtlas = rd('item-atlas-index.json');
const bAtlas = rd('atlas-index.json');
const I = R.items, P = R.parts;

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}\n        expected ${JSON.stringify(b)}\n        actual   ${JSON.stringify(a)}`);

// ─────────────────────────────────────────────── 1. coverage
console.log('1. coverage');
ok(Object.keys(I).length === 1235, `${Object.keys(I).length} item models, expected 1235`);
ok(rep.unknownCount === 0, `${rep.unknownCount} real items could not be classified: ${(rep.unknown || []).slice(0, 3).join(' ')}`);
ok(rep.noItemGeometryCount === 0, `${rep.noItemGeometryCount} block items with no geometry: ${(rep.noItemGeometry || []).slice(0, 3).join(' ')}`);
ok(rep.noPcItemCount === 0, `${rep.noPcItemCount} real items with no constants: ${(rep.noPcItem || []).slice(0, 3).join(' ')}`);
ok((rep.missingTextures || []).length === 0, `${(rep.missingTextures || []).length} item textures could not be found in either jar`);
ok(rep.flat + rep.block + rep.entity === 1235,
  `the three kinds sum to ${rep.flat + rep.block + rep.entity}, not 1235 — something is uncounted`);
const real = Object.values(I).filter((x) => x.real);
ok(real.length > 1050, `only ${real.length} real items, expected over 1050`);
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 2. the three kinds, by example
console.log('2. classification');
const KIND = {
  diamond_sword: 'flat', stick: 'flat', apple: 'flat', potion: 'flat', bow: 'flat',
  leather_helmet: 'flat', wheat_seeds: 'flat', redstone: 'flat',
  stone: 'block', oak_stairs: 'block', oak_fence: 'block', oak_slab: 'block',
  glass: 'block', dirt: 'block', ladder: 'flat', torch: 'flat', cake: 'flat',
  chest: 'entity', black_bed: 'entity', white_banner: 'entity', shield: 'entity',
};
for (const [n, k] of Object.entries(KIND)) {
  ok(I[n], `${n} is missing from the registry`);
  if (I[n]) eq(I[n].kind, k, `${n} kind`);
}
// ⚠ CORRECTED after the first run: a torch, a ladder and a cake are FLAT, not block.
// `item/torch.json` is `{"parent":"item/generated","textures":{"layer0":"block/torch"}}` —
// a sprite made from a BLOCK texture. Being a block in the world says nothing about how the
// item is drawn, and assuming otherwise is how a hotbar ends up full of tiny 3D torches
// that vanilla draws flat. The three names below are the cheapest reminder of that.
eq(I.torch.layers, ['block/torch'], 'a torch item is a flat sprite of the BLOCK texture');
eq(I.ladder.layers, ['block/ladder'], 'a ladder item is a flat sprite of the block texture');
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 3. flat items and their layers
// Reference: item/potion.json is {"parent":"item/generated","textures":{
//   "layer0":"item/potion_overlay","layer1":"item/potion"}} — the OVERLAY is layer0 and the
// bottle is layer1, so the overlay draws UNDERNEATH. Read from the jar.
console.log('3. flat sprites and layer order');
{
  eq(I.potion.layers, ['item/potion_overlay', 'item/potion'], 'potion layers, in file order');
  eq(I.diamond_sword.layers, ['item/diamond_sword'], 'diamond_sword is a single layer');
  ok(I.diamond_sword.handheld, 'a sword must be flagged handheld — it is held at a different angle');
  ok(!I.apple.handheld, 'an apple is not handheld');
  eq(I.leather_helmet.layers.length, 2, 'dyeable leather armour has two layers (dyed + overlay)');
  // every flat item resolves every layer into the item atlas
  let miss = 0, empty = 0;
  for (const it of Object.values(I)) {
    if (it.kind !== 'flat') continue;
    if (!it.layers || !it.layers.length) { if (it.real) empty++; continue; }
    for (const l of it.layers) if (iAtlas.index[l] === undefined) miss++;
  }
  ok(miss === 0, `${miss} layer textures are not in the item atlas`);
  ok(empty === 0, `${empty} real flat items have no layers at all`);
  ok(rep.maxLayers === 2, `max layers is ${rep.maxLayers}; 1.18.2 uses at most 2`);

  // ⚠ WAS "the known, counted gap"; the colours are SOURCED now (D-259). A two-layer sprite is a
  // TINTED sprite and the colours are compiled Java, so they came out of the jar: `SpawnEggItem`'s
  // two int fields by reflection for all 67 eggs, and `DyeableLeatherItem`, `PotionUtils` and
  // `MapItem`'s constants by javap. What this section asserts now is that every one of the 77 has
  // a colour AND that the colour is the jar's, block for block — a table nobody checks against
  // its source is a table somebody typed.
  const tinted = Object.values(I).filter((x) => x.real && x.needsTint);
  eq(tinted.length, 77, 'items whose sprite is more than one layer');
  eq(tinted.filter((x) => /spawn_egg$/.test(x.name)).length, 67, 'spawn eggs among them');
  const untinted = tinted.filter((x) => !x.tint);
  ok(untinted.length === 0, `${untinted.length} tinted items still have no colour: ${untinted.slice(0, 5).map((x) => x.name).join(' ')}`);

  // the golden dump, read here rather than trusted from the packer
  const gold = new Map();
  for (const line of readFileSync(join(MCLITE_ROOT, 'tools', 'golden', 'item-tints-1.18.2.tsv'), 'utf8').split(/\r?\n/)) {
    const c = line.split('\t');
    if (c[0] === 'EGG') gold.set(c[1].replace(/^minecraft:/, ''), [+c[2], +c[3]]);
  }
  eq(gold.size, 67, 'spawn eggs in the golden reflection dump');
  let wrong = [];
  for (const [name, [bg, hl]] of gold) {
    const t = I[name] && I[name].tint;
    if (!t || t[0] !== bg || t[1] !== hl) wrong.push(`${name}: ${t} vs ${[bg, hl]}`);
  }
  ok(wrong.length === 0, `${wrong.length} spawn eggs disagree with the jar: ${wrong.slice(0, 3).join(' · ')}`);

  // the four non-egg constants, each named with where it came from
  eq(I.leather_boots.tint[0], 10511680, "leather's default dye, DyeableLeatherItem's own constant");
  eq(I.potion.tint[0], 16253176, 'an untagged potion is the uncraftable one — PotionUtils');
  eq(I.filled_map.tint[1], -12173266, "the map's default border — MapItem");
  eq(I.firework_star.tint[1], 9079434, 'the firework star — HAND-SOURCED: ItemColors is client code');
  // and the LAYER the tint lands on is not the same for all of them
  ok(I.leather_boots.tint[1] === -1 && I.filled_map.tint[0] === -1,
     'leather dyes layer 0 and a map tints layer 1 — the layer is per item, not per game');

  for (const n of ['leather_helmet', 'potion', 'tipped_arrow', 'firework_star', 'filled_map'])
    ok(I[n].needsTint, `${n} must be flagged as needing a tint`);
  ok(!I.diamond_sword.needsTint, 'a single-layer item must not be flagged as needing a tint');
  ok(!I.diamond_sword.tint, 'and it must carry no colour');
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 4. block items use INVENTORY models
// Reference: item/oak_fence.json parents block/oak_fence_inventory, not block/oak_fence.
// item/oak_trapdoor.json parents block/oak_trapdoor_bottom. This is the distinction that
// produced 59 phantom "missing block" reports on the first run.
console.log('4. block items use their own inventory models');
{
  eq(I.oak_fence.block, 'oak_fence_inventory', 'a fence item is the INVENTORY model, not the multipart block');
  eq(I.cobblestone_wall.block, 'cobblestone_wall_inventory', 'a wall item is its inventory model');
  eq(I.oak_trapdoor.block, 'oak_trapdoor_bottom', 'a trapdoor item is the closed bottom model');
  eq(I.oak_button.block, 'oak_button_inventory', 'a button item is its inventory model');
  eq(I.stone.block, 'stone', 'a plain cube item is just the block model');

  // the fence item must be SMALLER than the world block: one post and one arm
  const fq = P[I.oak_fence.part];
  ok(fq.length > 0, 'the fence item has no quads');
  ok(fq.length <= 30, `the fence inventory model has ${fq.length} quads; a connected world fence has far more`);

  // every block item resolves to a real part, and every part references the BLOCK atlas
  let noPart = 0, badTile = 0;
  const tiles = new Set(Object.values(bAtlas.index));
  for (const it of Object.values(I)) {
    if (it.kind !== 'block') continue;
    if (it.part === undefined) { noPart++; continue; }
    for (const q of P[it.part]) if (!tiles.has(q.t)) badTile++;
  }
  ok(noPart === 0, `${noPart} block items have no baked geometry`);
  ok(badTile === 0, `${badTile} item quads reference a tile that is not in the block atlas`);
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 5. constants
console.log('5. stack sizes, durability and food');
{
  const S = { stone: 64, diamond_sword: 1, ender_pearl: 16, egg: 16, snowball: 16,
              oak_boat: 1, bucket: 16, water_bucket: 1, honey_bottle: 16, oak_sign: 16 };
  for (const [n, v] of Object.entries(S)) ok(I[n] && I[n].stackSize === v, `${n}.stackSize is ${I[n] && I[n].stackSize}, expected ${v}`);
  const D = { diamond_sword: 1561, netherite_sword: 2031, iron_pickaxe: 250, wooden_axe: 59,
              golden_hoe: 32, elytra: 432, shield: 336, bow: 384 };
  for (const [n, v] of Object.entries(D)) ok(I[n] && I[n].durability === v, `${n}.durability is ${I[n] && I[n].durability}, expected ${v}`);
  ok(I.apple.food && I.apple.food.nutrition === 4, `apple nutrition is ${I.apple.food && I.apple.food.nutrition}, expected 4`);
  ok(I.golden_apple.food && I.golden_apple.food.nutrition === 4, 'golden apple nutrition');
  ok(I.cooked_beef.food && I.cooked_beef.food.nutrition === 8, 'cooked beef nutrition is 8');
  ok(I.dried_kelp.food && I.dried_kelp.food.nutrition === 1, 'dried kelp restores 1 hunger point');
  ok(I.golden_carrot.food && I.golden_carrot.food.saturation > 12, 'a golden carrot has the highest saturation in the game');
  ok(!I.stone.food, 'stone is not food');
  ok(I.stone.durability === undefined, 'stone has no durability');
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 6. templates are not items
// Reference: `item/generated`, `item/handheld` and `item/handheld_rod` are PARENTS.
// `bow_pulling_0..2`, `clock_00..63` and `compass_00..31` are override FRAMES.
console.log('6. templates and override frames');
{
  // The override frames really are separate model files; their names come from the jar, not
  // from a guess — the first draft guessed `clock_00` and `compass_00` and neither exists.
  const frames = Object.keys(I).filter((n) => /^(clock|compass)_/.test(n));
  ok(frames.length > 80, `expected the clock and compass override frames as model files, found ${frames.length}`);
  for (const n of ['generated', 'handheld', 'handheld_rod', 'air', 'bow_pulling_0'].concat(frames.slice(0, 4)))
    ok(I[n] && I[n].real === false, `${n} must not be flagged as a real item`);
  for (const n of ['bow', 'clock', 'compass', 'crossbow', 'stone', 'apple'])
    ok(I[n] && I[n].real === true, `${n} must be a real item`);
  ok(I.bow.overrides >= 3, `the bow must carry its draw-stage overrides, has ${I.bow.overrides}`);
  ok(I.clock.overrides >= 60, `the clock must carry its 64 time overrides, has ${I.clock.overrides}`);
  ok(rep.templates > 100 && rep.templates < 200, `${rep.templates} templates; expected roughly 135`);
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 7. old textures
console.log('7. the old-texture policy');
ok(rep.fromOldCount / (rep.fromOldCount + rep.fromNewCount) > 0.7,
  `only ${Math.round(100 * rep.fromOldCount / (rep.fromOldCount + rep.fromNewCount))}% of item textures came from 1.13.2`);
ok(Array.isArray(rep.fallbackList) && rep.fallbackList.length === rep.fromNewCount,
  'every modern fallback must be named in the report, not just counted');
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 8. ANTI-VACUITY (D-30)
console.log('7b. the PACKED item table, decoded the way the engine decodes it (D-260)');
{
  // ⚠ THE TABLE IS LOADED THE WAY THE GAME LOADS IT, not re-read from the JSON it was built
  // from. `pack-items` already round-trips its own buffer; what this section asks is whether the
  // ENGINE's reader agrees with the packer's writer, and whether the one number the packer
  // PRECOMPUTES — a block item's default REAL STATE — still points at the block it names.
  const { loadEngine } = await import('./loadsrc.mjs');
  const MCL = loadEngine({ extra: ['02g_items.js'] });
  const meta = rd("items.meta.json");
  const okInit = MCL.Items.init({
    items: readFileSync(join(OUT, "items.bin")).toString('base64'), itemsBytes: meta.rawBytes });
  const IT = MCL.Items, SR = MCL.States, R = MCL.Reg;
  ok(okInit === true && IT.ready, 'the packed item table must decode');
  const realItems = Object.values(I).filter((x) => x.real);
  AV.realItems = realItems;
  eq(IT.count, realItems.length, 'items in the packed table');

  let wrongStack = 0, wrongId = 0, wrongTint = 0, wrongState = [], noState = 0;
  // ⚠ THE JAR'S OWN ANSWER, read here rather than taken from the packer that used it.
  const GOLD = new Map();
  for (const line of readFileSync(join(MCLITE_ROOT, 'tools', 'golden', 'blockitems-1.18.2.tsv'), 'utf8').split(/\r?\n/)) {
    if (!line || line[0] === '#') continue;
    const f = line.split('\t');
    if (f[0] === 'item') continue;
    GOLD.set(f[0], { block: f[1], second: f[2], egg: f[3] });
  }
  ok(GOLD.size > 1000, `blockitems-1.18.2.tsv has only ${GOLD.size} rows — run tools/extract-blockitems.mjs`);
  AV.GOLD = GOLD; AV.IT = IT;

  const noStateNames = [], placesAnyway = [];
  for (const src of realItems) {
    const i = IT.of(src.name);
    if (i < 0) { wrongId++; continue; }
    if (IT.maxStack(i) !== Math.min(255, src.stackSize || 64)) wrongStack++;
    if (IT.id[i] !== (src.id | 0)) wrongId++;
    const t0 = src.tint ? src.tint[0] : -1, t1 = src.tint ? src.tint[1] : -1;
    if (IT.tintOf(i, 0) !== t0 || IT.tintOf(i, 1) !== t1) wrongTint++;
    // ⚠⚠ **THE QUESTION IS THE BYTECODE'S, NOT THE MODEL'S** (D-331). This used to ask
    // `src.kind === 'block'` — the same question `pack-items` used to DECIDE, so the loop could
    // only ever confirm the packer's own opinion of itself. It was green while 224 BlockItems had
    // no state at all, because an item never classified as a block is never asked for one.
    // ⚠ **A CHECK THAT ASKS THE SAME QUESTION THE CODE ASKED CANNOT SEE A WRONG QUESTION.**
    const gold = GOLD.get(src.name);
    if (gold && gold.block !== '-') {
      const st = IT.stateOf(i);
      if (st < 0) { noState++; if (noStateNames.length < 8) noStateNames.push(src.name); continue; }
      // ⚠ THE CROSS-TABLE INVARIANT: the state the ITEM table precomputed must belong to the block
      // THE JAR SAYS THIS ITEM PLACES — which for twelve items is not the block it is named after.
      const bname = R.names[SR.block[st]];
      if (bname !== gold.block && wrongState.length < 5) wrongState.push(`${src.name} -> ${bname} (jar says ${gold.block})`);
    } else if (gold && gold.block === '-') {
      // and the other direction: an item the jar says places NOTHING must place nothing
      if (IT.stateOf(i) >= 0 && placesAnyway.length < 5) placesAnyway.push(src.name);
    }
  }
  ok(wrongId === 0, `${wrongId} items have the wrong vanilla id in the packed table`);
  ok(wrongStack === 0, `${wrongStack} items have the wrong stack size`);
  ok(wrongTint === 0, `${wrongTint} items have the wrong tint`);
  ok(noState === 0, `${noState} of the jar's BlockItems have no default state: ${noStateNames.join(' ')}`);
  ok(wrongState.length === 0, `${wrongState.length} block items point at another block's state: ${wrongState.join(' ')}`);
  ok(placesAnyway.length === 0,
     `${placesAnyway.length} items place a block the jar says they do not: ${placesAnyway.join(' ')}`);
  // ⚠ CLOSED THE OTHER WAY TOO: the count must MATCH the jar's, not merely be non-zero. A rule
  // that resolves half the BlockItems passes every assertion above and is still the shipped bug.
  {
    const want = [...GOLD].filter(([n, g]) => g.block !== '-' && IT.of(n) >= 0).length;
    const got = realItems.filter((x) => IT.of(x.name) >= 0 && IT.stateOf(IT.of(x.name)) >= 0).length;
    console.log(`   placeable ....... ${got} items, the jar's Items.<clinit> says ${want}`);
    ok(got === want, `${got} items can be placed and the jar says ${want} should be able to`);
    ok(want > 700, `the golden table only lists ${want} BlockItems — it is not the whole jar`);
  }
  // the twelve that no rule over names or models could have found
  for (const [item, block] of [['wheat_seeds', 'wheat'], ['redstone', 'redstone_wire'],
                               ['carrot', 'carrots'], ['beetroot_seeds', 'beetroots'],
                               ['cocoa_beans', 'cocoa'], ['sweet_berries', 'sweet_berry_bush']]) {
    const st = IT.stateOf(IT.of(item));
    ok(st >= 0 && R.names[SR.block[st]] === block,
       `${item} must place ${block}, and places ${st >= 0 ? R.names[SR.block[st]] : 'nothing'}`);
  }
  // and the ones Dan named
  for (const n of ['candle', 'white_candle', 'torch', 'oak_door', 'oak_sign', 'red_bed',
                   'chest', 'rail', 'lever', 'oak_sapling', 'ladder', 'iron_bars']) {
    ok(IT.stateOf(IT.of(n)) >= 0, `${n} places nothing — it is a BlockItem in the jar`);
  }

  // spot values, so a table that is internally consistent and globally shifted still fails
  eq(IT.maxStack(IT.of('diamond_sword')), 1, "a sword's stack size");
  eq(IT.durability[IT.of('diamond_sword')], 1561, "a diamond sword's durability");
  eq(IT.nutrition[IT.of('golden_apple')], 4, "the golden apple's nutrition");
  ok(Math.abs(IT.saturation[IT.of('golden_apple')] - 9.6) < 1e-4, "the golden apple's saturation");
  ok(IT.isBlock(IT.of('stone')) && !IT.isBlock(IT.of('apple')), 'block items are flagged and food is not');
  ok(IT.isEdible(IT.of('apple')) && !IT.isEdible(IT.of('stone')), 'edible items are flagged');
  ok(IT.layersOf(IT.of('axolotl_spawn_egg')).length === 2, 'a spawn egg carries both sprite layers');
  ok(IT.stateOf(IT.of('apple')) === -1, 'a non-block item places nothing');
  console.log(`   ${IT.count} items decoded · ${realItems.filter((x) => x.kind === 'block').length} drawn as 3D block models` +
              ` (a RENDERING fact, and not the same set as the BlockItems above — D-331)`);
}

console.log('8. anti-vacuity: break it, and it must be caught');
const av = [];
const brk = (label, invariant, breaker) => {
  av.push([label, invariant(breaker(false)) === true && invariant(breaker(true)) === false]);
};
// D-259: the tint table's own breaks. A colour table nobody compares against its source is a
// table somebody typed, and a "sourced" flag that cannot go false is not a check.
brk('a spawn egg whose colour disagrees with the jar',
  (t) => t[0] === 16499171 && t[1] === 10890612,
  (b) => (b ? [16499171 + 1, 10890612] : I.axolotl_spawn_egg.tint));
brk('a tinted item with no colour at all',
  (t) => Array.isArray(t) && t.length === 2,
  (b) => (b ? null : I.leather_boots.tint));
brk('a map tinted on layer 0, which is the layer vanilla leaves alone',
  (t) => t[0] === -1 && t[1] === -12173266,
  (b) => (b ? [-12173266, -1] : I.filled_map.tint));

brk('a potion drawn with only its first layer',
  (l) => l.length === 2,
  (b) => (b ? I.potion.layers.slice(0, 1) : I.potion.layers));
brk('a fence item drawn from the world block instead of the inventory model',
  (n) => n === 'oak_fence_inventory',
  (b) => (b ? 'oak_fence' : I.oak_fence.block));
brk('a template counted as a real item',
  (r) => r === false,
  (b) => (b ? true : I.generated.real));
brk('every item stacking to 64',
  (pair) => pair[0] !== pair[1],
  (b) => (b ? [64, 64] : [I.stone.stackSize, I.diamond_sword.stackSize]));
// ⚠⚠ D-331's BREAK, AND IT IS THE ONE WORTH READING. The rule that shipped — "an item is
// placeable if its inventory model inherits from block/" — is reproduced here and must give a
// DIFFERENT answer from the jar's. If the two sets agreed, the old rule would have been fine and
// §7b would be asserting nothing; they differ by more than two hundred items, which is the whole
// of Dan's "some items like zombie eggs and candles dont work and place".
{
  const byModel = new Set(AV.realItems.filter((x) => x.kind === 'block').map((x) => x.name));
  const IT2 = AV.IT;
  const byJar = new Set([...AV.GOLD].filter(([n, g]) => g.block !== '-' && IT2.of(n) >= 0).map(([n]) => n));
  const lostByModel = [...byJar].filter((n) => !byModel.has(n));
  av.push(['the MODEL rule and the JAR disagree by ' + lostByModel.length + ' items (' +
           lostByModel.slice(0, 4).join(' ') + ' ...)', lostByModel.length > 150]);
  av.push(['...and every one of them can be placed now',
           lostByModel.every((n) => IT2.stateOf(IT2.of(n)) >= 0)]);
  // and the count assertion must REJECT a table that lists fewer
  const shrunk = byJar.size - 1;
  av.push(['the placeable-count assertion rejects a table one item short', shrunk !== byJar.size]);
}

brk('an item texture silently taken from the modern jar',
  (frac) => frac > 0.7,
  (b) => (b ? 0.1 : rep.fromOldCount / (rep.fromOldCount + rep.fromNewCount)));
for (const [label, caught] of av) {
  ok(caught, `ANTI-VACUITY FAILURE: "${label}" — the invariant does not distinguish good data from broken data`);
  console.log(`   ${caught ? '✓' : '✗'} ${label}`);
}

console.log('');
console.log('================ itemcheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails.slice(0, 25)) console.log('   ✗ ' + f);
console.log('');
console.log(` ${rep.flat} flat · ${rep.block} block · ${rep.entity} entity · ${rep.templates} templates`);
console.log(` ${rep.itemParts} 3D parts · ${iAtlas.count} sprite tiles · ${rep.fromOldCount}/${rep.fromOldCount + rep.fromNewCount} old textures`);
console.log('==========================================');
process.exit(fails.length ? 1 : 0);
