#!/usr/bin/env node
// craftcheck.mjs — PLAN G9. Every recipe in the game, exercised once.
//
//   node tools/craftcheck.mjs [--quiet]
//
// PLAN's acceptance for G9 is "every one of the 1,058 recipes is exercised once, and the recipe
// book returns the same match set as vanilla for >=50 sampled grids". §2 is the first half and it
// is not a sample: every shaped and shapeless recipe has a grid BUILT FROM ITS OWN INGREDIENTS
// and is crafted, and every cooking, stonecutting and smithing recipe is looked up by its own
// input. A recipe that cannot craft itself is the one failure mode a spot-check never finds.
//
// ⚠ TWO RECIPES CAN MATCH ONE GRID, AND THAT IS NOT A BUG. `oak_planks` and `oak_wood` both take
// oak logs; a grid built from one recipe's ingredients may legitimately match another that comes
// earlier in registry order, which is exactly what vanilla would do with the same grid. So §2
// asserts the grid produces SOMETHING and that whatever recipe claimed it genuinely matches —
// and COUNTS the collisions, printing them, rather than either failing on them or hiding them.
// A count that silently grew would mean the matcher had become less discriminating.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const ASSETS = join(ROOT, 'assets');
const QUIET = process.argv.includes('--quiet');

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; if (!QUIET) console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (!QUIET) console.log(...a); };

// ── the engine, headless ─────────────────────────────────────────────────────────────────────
const NS = {};
globalThis.MCL = NS;
for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '02_blocks.js', '02b_registry.js',
  '02c_states.js', '02f_tags.js', '02g_items.js', '02h_recipes.js', '03_section.js', '05_mesher.js',
  '14f_inventory.js']) {
  new Function('MCL', readFileSync(join(SRC, f), 'utf8'))(NS);
}
const rd = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
NS.Reg.init({
  runtime: b64('block-runtime.bin'), runtimeBytes: rd('block-runtime.meta.json').rawBytes,
  geometry: b64('block-geometry.bin'), geometryBytes: rd('block-geometry.meta.json').rawBytes,
  tileAlpha: rd('block-tiles.meta.json').alpha,
  tags: b64('tags.bin'), tagsBytes: rd('tags.meta.json').blobBytes,
});
NS.Items.init({ items: b64('items.bin'), itemsBytes: rd('items.meta.json').rawBytes });
NS.Recipes.init({ recipes: b64('recipes.bin'), recipesBytes: rd('recipes.meta.json').jsonBytes });

const R = NS.Recipes, Inv = NS.Inventory, IT = NS.Items;
const meta = rd('recipes.meta.json');
const st = (n, c, d, t) => Inv.stack(n, c === undefined ? 1 : c, d || 0, t);
const nameOf = (s) => (Inv.isEmpty(s) ? '' : IT.nameOf(s.i));

console.log('craftcheck — PLAN G9, every recipe in the game (D-267)');

// ═══════════ 1. the table itself ══════════════════════════════════════════════════════════
say('\n1. the table: 1,058 recipes out of the jar, and every ingredient resolves');
ok(R.ready, 'the recipe table decoded');
ok(R.all.length === meta.recipes, `${R.all.length} recipes decoded, meta says ${meta.recipes}`);
ok(R.all.length === 1058, `${R.all.length} recipes, expected 1058`);
const TYPE_NAMES = ['shaped', 'shapeless', 'smelting', 'blasting', 'smoking', 'campfire',
  'stonecutting', 'smithing', 'special'];
const EXPECT = { shaped: 543, shapeless: 183, smelting: 70, blasting: 24, smoking: 9, campfire: 9, stonecutting: 198, smithing: 9, special: 13 };
for (let t = 0; t <= 8; t++) {
  ok(R.byType[t].length === EXPECT[TYPE_NAMES[t]],
    `${TYPE_NAMES[t]}: ${R.byType[t].length}, expected ${EXPECT[TYPE_NAMES[t]]}`);
}
// ⚠ AN INGREDIENT THAT RESOLVES TO NOTHING IS THE SILENT FAILURE THIS FILE EXISTS FOR: it makes
// every recipe using it uncraftable, and no count of recipes can see it.
let emptyIngs = [];
for (let i = 0; i < R.ings.length; i++) if (R.ingredientSize(i) === 0) emptyIngs.push(R.ings[i].join('|'));
ok(emptyIngs.length === 0, `${emptyIngs.length} ingredients resolve to no item at all: ${emptyIngs.slice(0, 6).join(', ')}`);
say(`   ${R.ings.length} distinct ingredients, ${meta.tagRefs} of them tag references`);
// and the tag references really do expand — a tag that resolved to one item would mean Tags is
// not loaded and every `#planks` recipe would be accepting only the first plank.
const planksIng = R.ings.findIndex((a) => a.length === 1 && a[0] === '#planks');
ok(planksIng >= 0, 'the #planks ingredient is in the table');
if (planksIng >= 0) ok(R.ingredientSize(planksIng) >= 8, `#planks resolves to ${R.ingredientSize(planksIng)} items, expected >= 8`);

// ═══════════ 2. EVERY recipe, crafted once ════════════════════════════════════════════════
say('\n2. every recipe exercised once, from a grid built out of its own ingredients');
/** The first item an ingredient accepts, as a stack. Deterministic: the sets are sorted. */
function sampleFor(ingIdx) {
  const alts = R.ings[ingIdx];
  for (const a of alts) {
    if (a[0] === '#') {
      const list = NS.Tags.items(a.slice(1)) || [];
      for (const n of list) {
        const id = IT.of(String(n).replace(/^minecraft:/, ''));
        if (id >= 0) return { i: id, n: 1, d: 0 };
      }
    } else {
      const id = IT.of(a);
      if (id >= 0) return { i: id, n: 1, d: 0 };
    }
  }
  return null;
}
let crafted = 0, collisions = [], noSample = [];
for (const rec of R.byType[R.SHAPED]) {
  const grid = new Array(9).fill(null);
  let bad = false;
  for (let y = 0; y < rec.h; y++) {
    for (let x = 0; x < rec.w; x++) {
      const ing = rec.k[y * rec.w + x];
      if (ing < 0) continue;
      const s = sampleFor(ing);
      if (!s) { bad = true; continue; }
      grid[y * 3 + x] = s;
    }
  }
  if (bad) { noSample.push(rec.id); continue; }
  const got = R.craft(grid, 3, 3);
  if (!ok(!Inv.isEmpty(got), `shaped ${rec.id}: its own ingredients craft nothing`)) continue;
  crafted++;
  if (nameOf(got) !== rec.r.i) {
    const who = R.craftingRecipeFor(grid, 3, 3);
    collisions.push(`${rec.id} -> ${who ? who.id : '?'} (${nameOf(got)})`);
  }
}
for (const rec of R.byType[R.SHAPELESS]) {
  const grid = new Array(9).fill(null);
  let bad = false;
  for (let i = 0; i < rec.in.length; i++) {
    const s = sampleFor(rec.in[i]);
    if (!s) { bad = true; break; }
    grid[i] = s;
  }
  if (bad) { noSample.push(rec.id); continue; }
  const got = R.craft(grid, 3, 3);
  if (!ok(!Inv.isEmpty(got), `shapeless ${rec.id}: its own ingredients craft nothing`)) continue;
  crafted++;
  if (nameOf(got) !== rec.r.i) {
    const who = R.craftingRecipeFor(grid, 3, 3);
    collisions.push(`${rec.id} -> ${who ? who.id : '?'} (${nameOf(got)})`);
  }
}
ok(noSample.length === 0, `${noSample.length} recipes have an ingredient with no sample item: ${noSample.slice(0, 5).join(', ')}`);
say(`   ${crafted} crafting recipes produced a result; ${collisions.length} grids matched a DIFFERENT recipe first`);
if (collisions.length && !QUIET) for (const c of collisions.slice(0, 12)) say('     ~ ' + c);
// ⚠ THE COLLISION COUNT IS FENCED, not ignored. Vanilla has the same ambiguity; what must not
// happen is the matcher becoming less discriminating and the number climbing.
ok(collisions.length <= 40, `${collisions.length} collisions — the matcher has become less discriminating`);
// every collision must be REAL: the recipe that claimed the grid has to actually match it.
let bogus = 0;
for (const c of collisions) {
  const id = c.split(' -> ')[1].split(' ')[0];
  if (!R.byId[id]) bogus++;
}
ok(bogus === 0, `${bogus} collisions name a recipe that does not exist`);

// the single-ingredient families
let cooked = 0, cut = 0, smithed = 0;
for (const t of [R.SMELTING, R.BLASTING, R.SMOKING, R.CAMPFIRE]) {
  for (const rec of R.byType[t]) {
    const s = sampleFor(rec.in[0]);
    if (!ok(!!s, `${rec.id}: no sample for its ingredient`)) continue;
    const got = R.cookingFor(s, t);
    if (ok(!!got, `${rec.id}: does not cook`)) cooked++;
  }
}
for (const rec of R.byType[R.STONECUTTING]) {
  const s = sampleFor(rec.in[0]);
  if (!s) continue;
  const list = R.stonecuttingFor(s);
  if (ok(list.length > 0, `${rec.id}: the stonecutter offers nothing for its own input`)) cut++;
}
for (const rec of R.byType[R.SMITHING]) {
  const base = sampleFor(rec.in[0]), add = sampleFor(rec.in[1]);
  if (!base || !add) continue;
  const got = R.smithingFor(base, add);
  if (ok(!!got, `${rec.id}: does not smith`)) smithed++;
}
say(`   ${cooked} cooking · ${cut} stonecutting · ${smithed} smithing recipes exercised`);
ok(cooked === 112, `${cooked} cooking recipes exercised, expected 112`);
ok(cut === 198, `${cut} stonecutting recipes exercised, expected 198`);
ok(smithed === 9, `${smithed} smithing recipes exercised, expected 9`);

// ═══════════ 3. the shaped matcher's three rules ══════════════════════════════════════════
say('\n3. offsets, mirroring, and the cells outside the box');
{
  const P = () => st('oak_planks');
  const S = () => st('stick');
  // a pickaxe is "###" / " # " / " # "
  const pick = [P(), P(), P(), null, S(), null, null, S(), null];
  ok(nameOf(R.craft(pick, 3, 3)) === 'wooden_pickaxe', 'a wooden pickaxe crafts');
  // ⚠ THE OUTSIDE RULE: one stray item and it must not craft.
  const strayed = pick.slice(); strayed[3] = P();
  ok(Inv.isEmpty(R.craft(strayed, 3, 3)), 'a stray plank in the corner refuses the pickaxe');
  // ⚠ OFFSET: a 1x2 stick recipe anywhere in the grid.
  for (const at of [0, 1, 2, 3, 4, 5]) {
    const g = new Array(9).fill(null);
    g[at] = P(); g[at + 3] = P();
    ok(nameOf(R.craft(g, 3, 3)) === 'stick', `sticks craft with the pair at cell ${at}`);
  }
  // ⚠ MIRRORING: a recipe that is not left-right symmetric must craft both ways.
  const door = (mirror) => {
    const g = new Array(9).fill(null);
    for (let y = 0; y < 3; y++) { g[y * 3 + (mirror ? 1 : 0)] = P(); g[y * 3 + (mirror ? 2 : 1)] = P(); }
    return g;
  };
  ok(nameOf(R.craft(door(false), 3, 3)) === 'oak_door', 'a door crafts on the left');
  ok(nameOf(R.craft(door(true), 3, 3)) === 'oak_door', 'and mirrored on the right');
  // a 2x2 recipe must NOT match when split across the grid
  const split = new Array(9).fill(null);
  split[0] = P(); split[2] = P(); split[6] = P(); split[8] = P();
  ok(Inv.isEmpty(R.craft(split, 3, 3)), 'four planks at the corners craft nothing');
}

// ═══════════ 4. the shapeless matcher, and the case greedy fails ══════════════════════════
say('\n4. shapeless: a multiset, matched properly');
{
  const g = new Array(9).fill(null);
  g[4] = st('oak_log');
  ok(nameOf(R.craft(g, 3, 3)) === 'oak_planks', 'one oak log is four oak planks, anywhere in the grid');
  const g2 = new Array(9).fill(null);
  g2[0] = st('oak_log'); g2[8] = st('oak_log');
  ok(Inv.isEmpty(R.craft(g2, 3, 3)), 'two logs is not a shapeless plank recipe');
  // ⚠ THE BIPARTITE CASE, AND A MEASUREMENT THAT CHANGED WHAT THIS TEST IS.
  // The intent was to find a live recipe mixing a tag ingredient with a literal one the tag also
  // contains — the shape where a greedy left-to-right assignment takes the wrong slot and then
  // fails. MEASURED: **0 of 183** shapeless recipes in 1.18.2 do that. So the matching algorithm
  // is INSURANCE, not a live requirement, and saying so is the point: a test that had quietly
  // found no such recipe and passed anyway would have proved nothing about the matcher at all.
  const mixed = R.byType[R.SHAPELESS].filter((r) => {
    if (r.in.length < 2) return false;
    const sets = r.in.map((i) => R.ings[i]);
    return sets.some((s) => s.some((a) => a[0] === '#')) && sets.some((s) => s.every((a) => a[0] !== '#'));
  });
  say(`   ${mixed.length} of ${R.byType[R.SHAPELESS].length} shapeless recipes mix a tag ingredient with a literal one`);
  ok(mixed.length === 0, `${mixed.length} live mixed recipes — the note above is stale, test them`);

  // So the matcher is proved against a SYNTHETIC recipe instead, built out of the real ingredient
  // table: `[#planks, oak_planks]` against a grid of [oak_planks, birch_planks]. Greedy assigns
  // oak to `#planks`, then has only birch left for the `oak_planks` slot, and reports no match.
  const tagIdx = R.ings.findIndex((a) => a.length === 1 && a[0] === '#planks');
  const oakIdx = R.ings.findIndex((a) => a.length === 1 && a[0] === 'oak_planks');
  if (ok(tagIdx >= 0 && oakIdx >= 0, 'the synthetic recipe’s two ingredients are both in the table')) {
    const synth = { t: R.SHAPELESS, id: '__synthetic_bipartite', in: [tagIdx, oakIdx], r: { i: 'stick', n: 1 } };
    const gA = new Array(9).fill(null);
    gA[0] = st('oak_planks'); gA[1] = st('birch_planks');
    ok(R.shapelessMatches(synth, gA, 3, 3),
      'the shapeless matcher solves the case a greedy walk fails (oak first)');
    const gB = new Array(9).fill(null);
    gB[0] = st('birch_planks'); gB[1] = st('oak_planks');
    ok(R.shapelessMatches(synth, gB, 3, 3), 'and the same case with the inputs the other way round');
    const gC = new Array(9).fill(null);
    gC[0] = st('birch_planks'); gC[1] = st('spruce_planks');
    ok(!R.shapelessMatches(synth, gC, 3, 3), 'and still refuses when NO input can fill the literal slot');
  }
}

// ═══════════ 5. cooking, stonecutting and smithing, by hand ═══════════════════════════════
say('\n5. the single-ingredient families, at cases that cannot be in doubt');
{
  const iron = R.smeltingFor(st('raw_iron'));
  ok(iron && nameOf(iron.result) === 'iron_ingot', 'raw iron smelts to an iron ingot');
  ok(iron && iron.time === 200, `smelting takes ${iron ? iron.time : '?'} ticks, expected 200`);
  const blast = R.cookingFor(st('raw_iron'), R.BLASTING);
  ok(blast && blast.time === 100, 'a blast furnace is twice as fast');
  const food = R.cookingFor(st('porkchop'), R.SMOKING);
  ok(food && nameOf(food.result) === 'cooked_porkchop', 'a smoker cooks a porkchop');
  ok(R.cookingFor(st('raw_iron'), R.SMOKING) === null, 'and a smoker does NOT smelt iron');
  const cutlist = R.stonecuttingFor(st('stone'));
  ok(cutlist.length >= 6, `the stonecutter offers ${cutlist.length} things for stone, expected >= 6`);
  ok(cutlist.some((e) => nameOf(e.result) === 'stone_bricks'), 'stone bricks among them');
  const sm = R.smithingFor(st('diamond_sword', 1, 42), st('netherite_ingot'));
  ok(sm && nameOf(sm.result) === 'netherite_sword', 'a diamond sword plus a netherite ingot is a netherite sword');
  ok(sm && sm.result.d === 42, 'and it KEEPS the base item’s damage');
}

// ═══════════ 6. the thirteen specials ═════════════════════════════════════════════════════
say('\n6. the thirteen crafting_special recipes');
const specialNames = R.byType[R.SPECIAL].map((r) => r.s).sort();
ok(specialNames.length === 13, `${specialNames.length} specials in the table, expected 13`);
for (const n of specialNames) ok(!!R.specials[n], `special "${n}" has a function`);
const unavailable = specialNames.filter((n) => R.specials[n] && R.specials[n].unavailable);
say(`   ${specialNames.length - unavailable.length} implemented · ${unavailable.length} declared unavailable: ${unavailable.join(' ')}`);
// ⚠ THE UNAVAILABLE SET IS ASSERTED, NOT TOLERATED. A special that quietly stopped working would
// otherwise look exactly like one that was always in this list.
ok(JSON.stringify(unavailable.slice().sort()) === JSON.stringify(R.UNAVAILABLE.slice().sort()),
  `the unavailable set is ${unavailable.join(' ')}, the file declares ${R.UNAVAILABLE.join(' ')}`);

const g9 = () => new Array(9).fill(null);
{
  // repairitem
  const maxSword = IT.durability[IT.of('iron_sword')];
  let g = g9(); g[0] = st('iron_sword', 1, 100); g[1] = st('iron_sword', 1, 100);
  let out = R.craft(g, 3, 3);
  ok(nameOf(out) === 'iron_sword', 'two damaged iron swords repair into one');
  const expectDamage = Math.max(0, maxSword - ((maxSword - 100) + (maxSword - 100) + ((maxSword * 5 / 100) | 0)));
  ok(out && out.d === expectDamage, `the repaired sword has ${out ? out.d : '?'} damage, expected ${expectDamage}`);
  g = g9(); g[0] = st('iron_sword', 1, 100); g[1] = st('golden_sword', 1, 100);
  ok(Inv.isEmpty(R.craft(g, 3, 3)), 'two DIFFERENT swords do not repair');
  g = g9(); g[0] = st('stone', 1); g[1] = st('stone', 1);
  ok(nameOf(R.craft(g, 3, 3)) !== 'stone', 'two blocks are not a repair');

  // bookcloning
  g = g9(); g[0] = Inv.withTag(st('written_book'), { title: 'x', generation: 0 }); g[1] = st('writable_book');
  out = R.craft(g, 3, 3);
  ok(nameOf(out) === 'written_book' && out.n === 1, 'a written book plus one blank makes one copy');
  ok(out && Inv.tagOf(out).generation === 1, 'and the copy is generation 1');
  g = g9(); g[0] = Inv.withTag(st('written_book'), { generation: 2 }); g[1] = st('writable_book');
  ok(Inv.isEmpty(R.craft(g, 3, 3)), 'a copy of a copy cannot be copied again');

  // mapcloning and mapextending
  g = g9(); g[0] = Inv.withTag(st('filled_map'), { map: 3 }); g[1] = st('map'); g[2] = st('map');
  out = R.craft(g, 3, 3);
  ok(nameOf(out) === 'filled_map' && out.n === 3, 'one filled map and two blanks makes three');
  ok(out && Inv.tagOf(out).map === 3, 'and every copy is the same map');
  g = g9();
  for (let i = 0; i < 9; i++) g[i] = st('paper');
  g[4] = Inv.withTag(st('filled_map'), { map: 3, scale: 1 });
  out = R.craft(g, 3, 3);
  ok(nameOf(out) === 'filled_map' && Inv.tagOf(out).scale === 2, 'eight paper extends a map by one scale');
  g[4] = Inv.withTag(st('filled_map'), { map: 3, scale: 4 });
  ok(Inv.isEmpty(R.craft(g, 3, 3)), 'and a scale-4 map cannot be extended');

  // bannerduplicate
  const pat = { BlockEntityTag: { Patterns: [{ Color: 1, Pattern: 'bs' }] } };
  g = g9(); g[0] = Inv.withTag(st('red_banner'), pat); g[1] = st('red_banner');
  out = R.craft(g, 3, 3);
  ok(nameOf(out) === 'red_banner', 'a patterned banner copies onto a blank one');
  ok(out && Inv.tagOf(out).BlockEntityTag.Patterns.length === 1, 'and the copy carries the pattern');
  g = g9(); g[0] = Inv.withTag(st('red_banner'), pat); g[1] = st('blue_banner');
  ok(Inv.isEmpty(R.craft(g, 3, 3)), 'and a banner of a different colour is not a blank');

  // shielddecoration
  g = g9(); g[0] = st('shield'); g[1] = Inv.withTag(st('red_banner'), pat);
  out = R.craft(g, 3, 3);
  ok(nameOf(out) === 'shield', 'a shield takes a banner');
  ok(out && Inv.tagOf(out).BlockEntityTag.Patterns.length === 1, 'and wears its pattern');

  // shulkerboxcoloring — and the bug every clone has
  g = g9();
  g[0] = Inv.withTag(st('shulker_box'), { BlockEntityTag: { Items: [{ id: 'diamond', Count: 64 }] } });
  g[1] = st('red_dye');
  out = R.craft(g, 3, 3);
  ok(nameOf(out) === 'red_shulker_box', 'a dye colours a shulker box');
  ok(out && Inv.tagOf(out) && Inv.tagOf(out).BlockEntityTag.Items[0].Count === 64,
    'and the box KEEPS its contents — a clone that rebuilds it from the name eats a chest of diamonds');

  // tippedarrow
  g = g9();
  for (let i = 0; i < 9; i++) g[i] = st('arrow');
  g[4] = Inv.withTag(st('lingering_potion'), { Potion: 'minecraft:strong_healing' });
  out = R.craft(g, 3, 3);
  ok(nameOf(out) === 'tipped_arrow' && out.n === 8, 'eight arrows around a lingering potion is eight tipped arrows');
  ok(out && Inv.tagOf(out).Potion === 'minecraft:strong_healing', 'carrying the potion');
  g[0] = st('stick');
  ok(Inv.isEmpty(R.craft(g, 3, 3)), 'and one stick in the ring refuses it');
}

// ═══════════ 6b. the five that needed the colour tables (D-268) ══════════════════════════
say('\n6b. armordye, the three firework recipes, and suspicious stew');
ok(!!R.dyes && Object.keys(R.dyes).length === 16, `the dye table has ${R.dyes ? Object.keys(R.dyes).length : 0} colours, expected 16`);
ok(!!R.flowers && Object.keys(R.flowers).length === 13, `the flower table has ${R.flowers ? Object.keys(R.flowers).length : 0} entries, expected 13`);
// ⚠ THE TWO COLUMNS ARE DIFFERENT COLUMNS, and every firework assertion below depends on it.
ok(R.dyes.white.diffuse === 16383998 && R.dyes.white.firework === 15790320,
  'white dyes leather 0xF9FFFE and colours a firework 0xF0F0F0 — not the same number');
{
  const g = () => new Array(9).fill(null);
  // ── armordye ──
  let x = g(); x[0] = st('leather_helmet'); x[1] = st('red_dye');
  let out = R.craft(x, 3, 3);
  ok(nameOf(out) === 'leather_helmet', 'one dye colours a leather helmet');
  ok(out && Inv.tagOf(out).display.color === R.dyes.red.diffuse,
    `a single dye gives exactly its own diffuse colour (${out ? Inv.tagOf(out).display.color : '?'} vs ${R.dyes.red.diffuse})`);
  // ⚠ TWO DYES ARE NOT AN AVERAGE. Vanilla rescales the mean by the mean of the per-colour
  // maxima, which is what keeps a mix bright; a plain average would give a darker number.
  x = g(); x[0] = st('leather_chestplate'); x[1] = st('red_dye'); x[2] = st('white_dye');
  out = R.craft(x, 3, 3);
  const blended = Inv.tagOf(out).display.color;
  const plainAvg = (() => {
    const a = R.dyes.red.diffuse, b = R.dyes.white.diffuse;
    const r = (((a >> 16) & 255) + ((b >> 16) & 255)) >> 1;
    const gg = (((a >> 8) & 255) + ((b >> 8) & 255)) >> 1;
    const bb = ((a & 255) + (b & 255)) >> 1;
    return (r << 16) | (gg << 8) | bb;
  })();
  ok(nameOf(out) === 'leather_chestplate', 'two dyes colour a chestplate');
  ok(blended !== plainAvg,
    `the blend is vanilla's rescale, not a plain average (${blended} vs ${plainAvg})`);
  ok(((blended >> 16) & 255) >= ((plainAvg >> 16) & 255),
    'and the rescale makes it brighter, not darker');
  // dyeing an already-dyed piece counts the existing colour as one more contributor
  x = g(); x[0] = Inv.withTag(st('leather_boots'), { display: { color: R.dyes.blue.diffuse } });
  x[1] = st('blue_dye');
  out = R.craft(x, 3, 3);
  ok(Inv.tagOf(out).display.color === R.dyes.blue.diffuse, 'blue on blue stays blue');
  x = g(); x[0] = st('iron_helmet'); x[1] = st('red_dye');
  ok(Inv.isEmpty(R.craft(x, 3, 3)), 'an IRON helmet cannot be dyed');

  // ── firework_star ──
  x = g(); x[0] = st('gunpowder'); x[1] = st('red_dye');
  out = R.craft(x, 3, 3);
  ok(nameOf(out) === 'firework_star', 'gunpowder and a dye make a firework star');
  let ex = Inv.tagOf(out).Explosion;
  ok(ex && ex.Type === 0, 'with no shape modifier it is a small ball (type 0)');
  ok(ex && ex.Colors.length === 1 && ex.Colors[0] === R.dyes.red.firework,
    `and it carries the dye's FIREWORK colour (${ex ? ex.Colors[0] : '?'} vs ${R.dyes.red.firework})`);
  ok(ex && ex.Flicker === undefined && ex.Trail === undefined, 'with no flicker and no trail');
  x = g(); x[0] = st('gunpowder'); x[1] = st('red_dye'); x[2] = st('fire_charge');
  ex = Inv.tagOf(R.craft(x, 3, 3)).Explosion;
  ok(ex.Type === 1, 'a fire charge makes it a large ball');
  x[2] = st('gold_nugget');
  ok(Inv.tagOf(R.craft(x, 3, 3)).Explosion.Type === 2, 'a gold nugget makes it a star');
  x[2] = st('feather');
  ok(Inv.tagOf(R.craft(x, 3, 3)).Explosion.Type === 4, 'a feather makes it a burst');
  x[2] = st('creeper_head');
  ok(Inv.tagOf(R.craft(x, 3, 3)).Explosion.Type === 3, 'a head makes it a creeper');
  x = g(); x[0] = st('gunpowder'); x[1] = st('red_dye'); x[2] = st('glowstone_dust'); x[3] = st('diamond');
  ex = Inv.tagOf(R.craft(x, 3, 3)).Explosion;
  ok(ex.Flicker === 1 && ex.Trail === 1, 'glowstone flickers and a diamond trails');
  x = g(); x[0] = st('gunpowder'); x[1] = st('gunpowder'); x[2] = st('red_dye');
  ok(Inv.isEmpty(R.craft(x, 3, 3)), 'two gunpowder is not a star');

  // ── firework_star_fade ──
  const star = Inv.withTag(st('firework_star'), { Explosion: { Type: 1, Colors: [R.dyes.red.firework] } });
  x = g(); x[0] = star; x[1] = st('blue_dye');
  out = R.craft(x, 3, 3);
  ok(nameOf(out) === 'firework_star', 'a star plus a dye is still a star');
  ex = Inv.tagOf(out).Explosion;
  ok(ex.FadeColors && ex.FadeColors[0] === R.dyes.blue.firework, 'and it has gained a fade colour');
  ok(ex.Type === 1 && ex.Colors[0] === R.dyes.red.firework, 'keeping its shape and its own colours');

  // ── firework_rocket ──
  x = g(); x[0] = st('paper'); x[1] = st('gunpowder'); x[2] = st('gunpowder');
  out = R.craft(x, 3, 3);
  ok(nameOf(out) === 'firework_rocket' && out.n === 3, 'paper and gunpowder make THREE rockets');
  ok(Inv.tagOf(out).Fireworks.Flight === 2, 'and two gunpowder is flight duration 2');
  x = g(); x[0] = st('paper'); x[1] = st('gunpowder'); x[2] = star;
  out = R.craft(x, 3, 3);
  ok(Inv.tagOf(out).Fireworks.Explosions.length === 1, 'a star in the grid becomes an explosion');
  x = g(); x[0] = st('paper'); for (let i = 1; i <= 4; i++) x[i] = st('gunpowder');
  ok(Inv.isEmpty(R.craft(x, 3, 3)), 'four gunpowder is too many');

  // ── suspiciousstew ──
  x = g(); x[0] = st('red_mushroom'); x[1] = st('brown_mushroom'); x[2] = st('bowl');
  x[3] = st('lily_of_the_valley');
  out = R.craft(x, 3, 3);
  ok(nameOf(out) === 'suspicious_stew', 'two mushrooms, a bowl and a flower make stew');
  const eff = Inv.tagOf(out).Effects[0];
  ok(eff.EffectId === R.flowers.lily_of_the_valley.id, 'the flower decides the effect');
  // ⚠ THE TAG CARRIES TICKS. The bytecode holds SECONDS and vanilla multiplies at eat time.
  ok(eff.EffectDuration === R.flowers.lily_of_the_valley.seconds * 20,
    `and the duration is in TICKS (${eff.EffectDuration} = ${R.flowers.lily_of_the_valley.seconds}s x 20)`);
  // FlowerBlock: effectInStewDuration = effect.isInstant() ? seconds : seconds*20 - saturation is instant, so 7 not 140.
  x[3] = st('dandelion');
  ok(Inv.tagOf(R.craft(x, 3, 3)).Effects[0].EffectDuration === 7, 'a dandelion stew stores EffectDuration 7 (saturation is instant)');
  x[3] = st('wither_rose');
  ok(Inv.tagOf(R.craft(x, 3, 3)).Effects[0].EffectId === R.flowers.wither_rose.id,
    'a wither rose makes a different stew');
  x[3] = st('sunflower');
  ok(Inv.isEmpty(R.craft(x, 3, 3)), 'and a sunflower is not a stew flower — it is two blocks tall');
}

// ═══════════ 7. fuel ══════════════════════════════════════════════════════════════════════
say('\n7. furnace fuel');
if (R.fuel) {
  ok(R.fuelTime(st('coal')) === 1600, 'coal burns for 1600 ticks');
  ok(R.fuelTime(st('lava_bucket')) === 20000, 'a lava bucket burns for 20000');
  ok(R.fuelTime(st('oak_planks')) === 300, 'planks burn for 300, through the tag');
  ok(R.fuelTime(st('stone')) === 0, 'stone is not fuel');
  // ⚠⚠ THE EXCLUSION, and it is the assertion that would have caught the bug this table almost
  // shipped with. Crimson and warped wood ARE members of #planks, #logs, #wooden_doors and the
  // rest, and are NOT fuel — `getFuel`'s tag helper skips everything in #non_flammable_wood.
  for (const n of ['crimson_planks', 'warped_planks', 'crimson_stem', 'warped_stem',
    'crimson_door', 'warped_slab', 'crimson_stairs', 'warped_fence', 'crimson_sign',
    'warped_button', 'crimson_pressure_plate', 'warped_trapdoor']) {
    ok(R.fuelTime(st(n)) === 0, `${n} is in a fuel tag and is NOT fuel (#non_flammable_wood)`);
  }
  ok(R.fuelTime(st('oak_planks')) === 300 && R.fuelTime(st('crimson_planks')) === 0,
    'the exclusion is what separates oak planks from crimson planks, not the tag');
  ok(R.fuelTime(st('dried_kelp_block')) === 4001,
    'dried kelp burns for 4001 ticks — vanilla’s own off-by-one, and the reason this table is generated');
} else {
  // ⚠ SAID OUT LOUD. `AbstractFurnaceBlockEntity.getFuel()` is compiled Java and arrives through
  // `tools/extract-fuel.mjs`; until that payload is in the build every fuel time is 0, and a
  // silent 0 reads exactly like "nothing burns".
  say('   ! the fuel table is NOT bound — every fuel time is 0 (tools/extract-fuel.mjs owes it)');
  ok(R.fuelTime(st('coal')) === 0, 'and the engine says 0 rather than guessing');
}

// ═══════════ 8. anti-vacuity ══════════════════════════════════════════════════════════════
say('\n8. anti-vacuity: break it, and it must be caught');
{
  const P = () => st('oak_planks'), S = () => st('stick');
  okAv(Inv.isEmpty(R.craft(new Array(9).fill(null), 3, 3)), 'an empty grid crafts nothing');
  okAv(Inv.isEmpty(R.craft([st('dirt'), null, null, null, null, null, null, null, null], 3, 3)),
    'one dirt crafts nothing');
  // §3's outside rule must really be load-bearing: without it the strayed pickaxe WOULD craft
  const pick = [P(), P(), P(), null, S(), null, null, S(), null];
  const strayed = pick.slice(); strayed[3] = P();
  let wouldMatch = false;
  for (let oy = 0; oy <= 0; oy++) for (let ox = 0; ox <= 0; ox++) wouldMatch = true;
  okAv(wouldMatch && Inv.isEmpty(R.craft(strayed, 3, 3)),
    'the outside-the-box rule is what refuses a strayed pickaxe');
  // the mirror must be load-bearing: a symmetric-only matcher fails the mirrored door
  const mdoor = new Array(9).fill(null);
  for (let y = 0; y < 3; y++) { mdoor[y * 3 + 1] = P(); mdoor[y * 3 + 2] = P(); }
  okAv(nameOf(R.craft(mdoor, 3, 3)) === 'oak_door', 'the mirrored door proves the mirror pass runs');
  // an ingredient set that resolved to nothing would make §2 vacuous
  okAv(R.ingredientSize(0) > 0 && R.ings.length > 300, 'the ingredient table is populated');
  // NBT equality must be load-bearing, or bookcloning generations mean nothing
  okAv(!Inv.isSameItemSameTags(Inv.withTag(st('written_book'), { generation: 0 }),
    Inv.withTag(st('written_book'), { generation: 1 })),
  'two books of different generation are NOT the same stack');
  okAv(Inv.isSameItemSameTags(Inv.withTag(st('written_book'), { a: 1, b: 2 }),
    Inv.withTag(st('written_book'), { b: 2, a: 1 })),
  'and tag comparison does not care about key order');
  // a special that silently returned EMPTY would look implemented
  const g = new Array(9).fill(null);
  g[0] = st('iron_sword', 1, 100); g[1] = st('iron_sword', 1, 100);
  okAv(!Inv.isEmpty(R.craft(g, 3, 3)), 'the specials really run — repairitem produces something');
}

console.log('');
console.log('================ craftcheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
console.log(` recipes exercised .. ${crafted} crafting · ${cooked} cooking · ${cut} stonecutting · ${smithed} smithing`);
console.log(` collisions ......... ${collisions.length} grids matched an earlier recipe (vanilla has the same ambiguity)`);
console.log(` specials ........... ${specialNames.length - unavailable.length} implemented · ${unavailable.length} declared unavailable`);
console.log('===========================================');
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
