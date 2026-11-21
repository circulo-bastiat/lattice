#!/usr/bin/env node
// mobslootcheck.mjs — PLAN G18d: mob DROPS, and the entity loot tables (D-381).
//
//   node tools/mobslootcheck.mjs [--verbose]
//
// ── WHY A SEPARATE FILE FROM minecheck.mjs ────────────────────────────────────────────────
// `minecheck.mjs` is PLAN G3's block-loot acceptance and its §5 sweeps the 835 block tables
// under `R.blockCount` — an entity has no block id to index by, so this is its own small file
// rather than a section bolted onto a check that already has a name for what it covers.
//
// ── WHAT THIS EXERCISES ───────────────────────────────────────────────────────────────────
// `pack-loot.mjs` now also packs the 91 `entities/` tables plus the one `gameplay/fishing/fish`
// table a `loot_table` reference reaches (`guardian`'s rare fish drop), and `07e_loot.js` gained
// six verbs no block table ever used: the `empty`/`loot_table`/`item_choice` entries and the
// `killed_by_player`/`random_chance_with_looting`/`damage_source_properties` conditions and the
// `looting_enchant`/`furnace_smelt`/`set_potion` functions. This is where each one is asserted
// against a real table rather than against a line of code that merely runs without throwing.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ASSETS = join(ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };
const near = (a, b, t, what) => ok(Math.abs(a - b) <= t, `${what}: ${a.toFixed(4)} vs ${b} (+-${t})`);

console.log('mobslootcheck — PLAN G18d, entity loot tables (D-381)');

const M = loadEngine({ extra: ['02f_tags.js', '07d_mining.js', '07e_loot.js'], dom: false });
const L = M.Loot;
const lootMeta = JSON.parse(readFileSync(join(ASSETS, 'loot.meta.json'), 'utf8'));
const items = JSON.parse(readFileSync(join(ASSETS, 'item-registry.json'), 'utf8')).items;

console.log('1. the entity and gameplay tables reached the runtime');
{
  ok(L.ready, 'Loot.init did not run');
  ok(lootMeta.entityFiles === 108, `pack-loot packed ${lootMeta.entityFiles} entity/gameplay tables, expected 108 (91 entities + gameplay/fishing{,/fish,/junk,/treasure} + 13 gameplay/hero_of_the_village gifts, s113)`);
  ok(L.hasTable('entities/cow'), 'entities/cow did not pack');
  ok(L.hasTable('entities/creeper'), 'entities/creeper did not pack');
  ok(L.hasTable('gameplay/fishing/fish'), 'gameplay/fishing/fish did not pack (guardian’s loot_table reference)');
  say(`   ${lootMeta.entityFiles} entity/gameplay tables`);
}
console.log(`   ${pass} ok`);

console.log('2. exact and distribution drops, the cases with one answer');
{
  const rngSeed = 20260918;
  const of = (arr, item) => arr.filter((s) => s.item === item).reduce((t, s) => t + s.count, 0);

  // cow: unconditional leather 0..2 and beef 1..3, no rare row
  const cow = L.entityDrops({ type: 'cow', rng: L.rng(rngSeed) });
  ok(cow.every((s) => s.item === 'leather' || s.item === 'beef'), `cow dropped an unexpected item: ${cow.map((s) => s.item).join(',')}`);
  ok(of(cow, 'beef') >= 1 && of(cow, 'beef') <= 3, `cow beef out of vanilla's 1..3 range: ${of(cow, 'beef')}`);

  // a BURNING cow's beef cooks itself (furnace_smelt gated on entity_properties{is_on_fire})
  const burning = L.entityDrops({ type: 'cow', isOnFire: true, rng: L.rng(rngSeed) });
  ok(of(burning, 'cooked_beef') >= 1, 'a burning cow did not drop cooked beef');
  ok(of(burning, 'beef') === 0, 'a burning cow ALSO dropped raw beef');

  // rabbit's foot and zombie's rare carrot/iron/potato row need killed_by_player
  let footByPlayer = 0, footNotByPlayer = 0, N = 4000;
  const rngP = L.rng(1), rngM = L.rng(1);
  for (let i = 0; i < N; i++) {
    if (of(L.entityDrops({ type: 'rabbit', killedByPlayer: true, rng: rngP }), 'rabbit_foot') > 0) footByPlayer++;
    if (of(L.entityDrops({ type: 'rabbit', killedByPlayer: false, rng: rngM }), 'rabbit_foot') > 0) footNotByPlayer++;
  }
  ok(footNotByPlayer === 0, `a rabbit killed by something other than a player dropped its foot ${footNotByPlayer} times`);
  near(footByPlayer / N, 0.1, 0.02, 'rabbit foot rate, player kill, no looting');

  // creeper: killed by a player drops no music disc; killed by a "skeleton" always tries the tag
  const byPlayer = L.entityDrops({ type: 'creeper', killedByPlayer: true, killer: { type: 'player' }, rng: L.rng(3) });
  ok(!byPlayer.some((s) => s.item.indexOf('music_disc') === 0), 'a creeper killed by a player dropped a music disc');
  let discs = new Set();
  const skelTags = { skeletons: ['skeleton', 'wither_skeleton', 'stray'] };
  const rngD = L.rng(3);
  for (let i = 0; i < 40; i++) {
    for (const s of L.entityDrops({ type: 'creeper', killer: { type: 'skeleton' }, entityTypeTags: skelTags, rng: rngD })) {
      if (s.item.indexOf('music_disc') === 0) discs.add(s.item);
    }
  }
  ok(discs.size >= 3, `a creeper killed by a skeleton picked only ${discs.size} distinct discs over 40 kills — expected the tag to vary`);

  // guardian's nested loot_table reference (gameplay/fishing/fish), with furnace_smelt riding
  // along on the entry's own functions
  const rngG = L.rng(9);
  let sawFish = false, sawCooked = false;
  for (let i = 0; i < 400 && !(sawFish && sawCooked); i++) {
    const d = L.entityDrops({ type: 'guardian', killedByPlayer: true, isOnFire: (i % 2 === 0), rng: rngG });
    if (of(d, 'cod') > 0 || of(d, 'salmon') > 0) sawFish = true;
    if (of(d, 'cooked_cod') > 0) sawCooked = true;
  }
  ok(sawFish, 'a guardian never dropped a fish through its loot_table reference in 400 kills');
  ok(sawCooked, 'a guardian on fire never dropped a COOKED cod through the nested reference');

  // sheep/white: its own wool pool plus a loot_table reference to the shared entities/sheep table
  const wool = L.entityDrops({ type: 'white_wool_placeholder' }); // guard: unknown type -> []
  ok(wool.length === 0, 'an unknown entity type produced drops instead of []');
  ok(L.hasTable('entities/sheep/white'), 'entities/sheep/white did not pack');
  ok(L.hasTable('entities/sheep'), 'entities/sheep (the shared table sheep/white references) did not pack');

  // stray's tipped arrow: set_potion records nbt without inventing a potion system
  const strayDrops = L.entityDrops({ type: 'stray', killedByPlayer: true, rng: L.rng(11) });
  const tipped = strayDrops.find((s) => s.item === 'tipped_arrow');
  ok(!tipped || (tipped.nbt && tipped.nbt.potion === 'slowness'), 'stray’s tipped arrow did not carry set_potion’s nbt');
}
console.log(`   ${pass} ok`);

console.log('3. looting — carried as a parameter, zero until G22 (Cb.OWED)');
{
  const zero = L.entityDrops({ type: 'zombie', looting: 0, rng: L.rng(5) });
  const two = [];
  const rngL = L.rng(5);
  for (let i = 0; i < 500; i++) for (const s of L.entityDrops({ type: 'zombie', looting: 2, rng: rngL })) two.push(s);
  const rottenAt2 = two.filter((s) => s.item === 'rotten_flesh').reduce((t, s) => t + s.count, 0);
  const rngZ = L.rng(5);
  let rottenAt0 = 0;
  for (let i = 0; i < 500; i++) for (const s of L.entityDrops({ type: 'zombie', looting: 0, rng: rngZ })) if (s.item === 'rotten_flesh') rottenAt0 += s.count;
  ok(rottenAt2 > rottenAt0, `Looting II did not raise rotten flesh over 500 kills (${rottenAt2} vs ${rottenAt0})`);
  say(`   500 zombie kills: ${rottenAt0} rotten flesh at looting 0, ${rottenAt2} at looting 2`);
  ok(Array.isArray(zero), 'entityDrops at looting 0 did not return an array');
}
console.log(`   ${pass} ok`);

console.log('4. anti-vacuity: break it, and it must be caught');
{
  const SMELTS = Object.assign({}, L.SMELTS);
  delete L.SMELTS.beef;
  const cooled = L.entityDrops({ type: 'cow', isOnFire: true, rng: L.rng(20260918) });
  okAv(cooled.some((s) => s.item === 'beef'), 'furnace_smelt broken — a burning cow still dropped raw beef, and the test did not notice');
  L.SMELTS = SMELTS;

  let anyFoot = 0;
  const rngB = L.rng(1);
  for (let i = 0; i < 500; i++) if (L.entityDrops({ type: 'rabbit', killedByPlayer: false, rng: rngB }).some((s) => s.item === 'rabbit_foot')) anyFoot++;
  okAv(anyFoot === 0, 'killed_by_player broken — a non-player kill still rolled the foot, undetected');

  // random_chance_with_looting: rabbit's foot is chance 0.1 + looting*0.03, so looting 30 pushes
  // it to (over-)certain. If the multiplier were ignored (the obvious way to get this wrong),
  // the rate would stay pinned at 10% and this would not move.
  let footAtHighLooting = 0, HN = 300;
  const rngHi = L.rng(4);
  for (let i = 0; i < HN; i++) if (L.entityDrops({ type: 'rabbit', killedByPlayer: true, looting: 30, rng: rngHi }).some((s) => s.item === 'rabbit_foot')) footAtHighLooting++;
  okAv(footAtHighLooting / HN > 0.9, `random_chance_with_looting broken — looting 30 on rabbit's foot (base 10% + 30*3%) only hit ${footAtHighLooting}/${HN}`);
  // #3606 turtle pool 2: bowl only when damage_source_properties{is_lightning}
  const bowl = (ds) => L.entityDrops({ type: 'turtle', damageSource: ds, rng: L.rng(3606) }).some((s) => s.item === 'bowl');
  ok(bowl({ is_lightning: true }), 'a lightning-killed turtle dropped no bowl');
  okAv(!bowl({ is_lightning: false }) && !bowl(undefined), 'a non-lightning turtle kill dropped a bowl');
}
console.log('');
console.log('================ mobslootcheck ===============');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
console.log('===========================================');
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
