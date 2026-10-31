#!/usr/bin/env node
// compostercheck.mjs — loop/composter: ComposterBlock's LEVEL-manipulation substrate
// (07zy_composter.js), the piece G18's farmer villager needs (FarmerWorkTask.
// performAdditionalWork composts seeds; 07zv_villagerbrain.js's own VB.OWED names the gap
// this file closes the API side of).
//
//   node tools/compostercheck.mjs [--verbose]
//
// ⚠ WHAT THIS PROVES. Not "does node parse the file" — that a real, non-guessed CHANCE table
// (91 entries, 5 tiers, generated against the ACTUAL 1.18.2 server jar rather than typed by
// hand from an obfuscated-and-Yarn-unnamed source, see 07zy_composter.js's own header) drives
// `addItem`/`extract`/`scheduledTick`/`onUse` exactly the way `.decomp/net/minecraft/block/
// ComposterBlock.java` says: a level-0 composter always takes its first item; the 0.3/0.5/0.65/
// 0.85/1.0 tiers roll at the RIGHT chance, not a uniform one; level 7 refuses a NEW item outright
// (not just level 8); level 7 pops to 8 ONLY after the scheduled 20-tick fires, never on its
// own; extracting a level-8 composter gives exactly one bone_meal and resets it to 0; a
// non-compostable item is refused everywhere, at every level, with zero side effects.

import { loadEngine } from './loadsrc.mjs';

const VERBOSE = process.argv.includes('--verbose');

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; if (VERBOSE) console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };

console.log('compostercheck — loop/composter: ComposterBlock LEVEL substrate (07zy_composter.js)');

// A real World + a real Behave, the same pair hoppercheck/wolfgoalcheck bootstrap: needed so
// `B.tick`'s scheduler (07b_behaviour.js `w.get`) sees a real block at each test position
// instead of always reading air (state 0) and refusing to dispatch to Composter.scheduledTick.
const M = loadEngine({ extra: ['07_world.js', '07b_behaviour.js', '07zy_composter.js'] });
const Cm = M.Composter, W = M.World, CH = M.CH, S = M.States;
M.Behave.init(W);
W.init(1);
for (let cx = -1; cx <= 7; cx++) for (let cz = -1; cz <= 7; cz++) {
  const c = W.makeChunk(cx, cz);
  c.state = CH.GENERATED;
  W.chunks.set(W.key(cx, cz), c);
}
const STONE = S.stateOf('stone') | 0;
ok(STONE > 0, 'the stone block state resolved (a real world to place the fixture blocks into)');
ok(!!Cm && Cm.ready, 'MCL.Composter loaded and reports ready');

// ── 1. THE CHANCE TABLE ITSELF: count + tier histogram, both asserted against the runtime dump
//    generated in 07zy_composter.js's own header (91 entries, 26/11/43/9/2 at 0.3/0.5/0.65/
//    0.85/1.0). This is the anti-"typed it by hand and miscounted" guard for the whole table. ──
{
  const keys = Object.keys(Cm.CHANCE);
  ok(keys.length === 91, 'CHANCE has exactly 91 entries (got ' + keys.length + ')');
  const hist = {};
  for (const k of keys) { const v = Cm.CHANCE[k]; hist[v] = (hist[v] || 0) + 1; }
  const want = { 0.3: 26, 0.5: 11, 0.65: 43, 0.85: 9, 1: 2 };
  for (const tier of Object.keys(want)) {
    ok(hist[tier] === want[tier],
      'tier ' + tier + ' has ' + want[tier] + ' items (got ' + (hist[tier] || 0) + ')');
  }
  // sample points across every tier, transcribed straight from .decomp lines 64-153 plus the
  // runtime-resolved obfuscated ones (see 07zy_composter.js header) — not the whole table.
  const samples = [
    ['oak_sapling', 0.3], ['dried_kelp', 0.3], ['glow_berries', 0.3], ['sweet_berries', 0.3],
    ['cactus', 0.5], ['dried_kelp_block', 0.5], ['glow_lichen', 0.5],
    ['dandelion', 0.65], ['cocoa_beans', 0.65], ['sea_pickle', 0.65],
    ['hay_block', 0.85], ['bread', 0.85], ['cookie', 0.85],
    ['cake', 1.0], ['pumpkin_pie', 1.0]
  ];
  for (const [name, chance] of samples) {
    ok(Cm.CHANCE[name] === chance, 'CHANCE[' + name + '] === ' + chance + ' (got ' + Cm.CHANCE[name] + ')');
  }
  ok(Cm.CHANCE.bone_meal === undefined, 'bone_meal (the OUTPUT) is not itself a CHANCE key');
  ok(Cm.CHANCE.stone === undefined, 'a plain non-compostable item (stone) is not a CHANCE key');
}

// ── 2. LEVEL 0 ALWAYS TAKES (.decomp:275 collapses to "always" at level 0, whatever the item's
//    own chance is) — proven with an rng that ALWAYS reports "failed the roll" (returns 1, one
//    ULP under never-satisfies `rng() < chance`), so a level bump here can only be the level-0
//    special case, not luck. ──
{
  const neverRoll = () => 0.999999;
  const x = 10, y = 64, z = 10;
  ok(Cm.level(x, y, z) === 0, 'a fresh position starts at level 0');
  const took = Cm.addItem(x, y, z, 'sweet_berries', neverRoll);   // chance 0.3, would fail any real roll
  ok(took === true, 'a level-0 composter accepts a compostable item even on a rng that always fails');
  ok(Cm.level(x, y, z) === 1, 'that acceptance actually bumped LEVEL to 1 (not just consumed=true)');
}

// ── 3. EACH CHANCE TIER ROLLS AT ITS OWN RATE, IN BOTH DIRECTIONS — an rng just under the
//    item's chance succeeds, an rng just at-or-over it fails and leaves LEVEL untouched (but
//    still reports the item as CONSUMED — .decomp:245-249's own unconditional decrement). Tested
//    from level 1 (not 0) so the level-0 special case above cannot mask a wrong per-tier chance. ──
for (const [name, chance] of [['sweet_berries', 0.3], ['cactus', 0.5], ['dandelion', 0.65],
                                ['hay_block', 0.85], ['cake', 1.0]]) {
  const x = 20, y = 64, z = 20;
  Cm.setLevel(x, y, z, 1);
  const under = () => Math.max(0, chance - 0.001);
  const tookLo = Cm.addItem(x, y, z, name, under);
  ok(tookLo === true, name + ' (chance ' + chance + '): consumed on an rng just under its chance');
  ok(Cm.level(x, y, z) === 2, name + ': rng just under chance DID bump the level (1 -> 2)');
  if (chance < 1.0) {
    Cm.setLevel(x, y, z, 1);
    const atOrOver = () => chance;
    const tookHi = Cm.addItem(x, y, z, name, atOrOver);
    ok(tookHi === true, name + ': still consumed on an rng at-or-over its chance');
    ok(Cm.level(x, y, z) === 1, name + ': rng at-or-over chance left the level UNCHANGED (1)');
  }
}

// ── 4. A NON-COMPOSTABLE ITEM IS REFUSED, AT EVERY LEVEL, WITH ZERO SIDE EFFECTS — the
//    "rule that refuses a legal action is as wrong as one allowing an illegal one" direction:
//    this proves the REFUSAL branch itself actually runs (not merely that legal items work). ──
for (const lvl of [0, 1, 6, 7, 8]) {
  const x = 30, y = 64, z = 30 + lvl;
  Cm.setLevel(x, y, z, lvl);
  const before = Cm.level(x, y, z);
  const took = Cm.addItem(x, y, z, 'diamond_pickaxe', () => 0);   // rng=0 would satisfy ANY chance
  ok(took === false, 'a non-compostable item is refused at level ' + lvl + ' even on a guaranteed-pass rng');
  ok(Cm.level(x, y, z) === before, 'the refusal at level ' + lvl + ' left LEVEL untouched');
}

// ── 5. LEVEL 7 REFUSES A NEW ITEM OUTRIGHT — the SAME rule as #4, but the item IS compostable
//    this time. `.decomp`'s own gate is `level < 7`, not `level < MAX_LEVEL(8)`, so this is a
//    DIFFERENT code path than the level-8-is-full case (#6) and needs its own proof. ──
{
  const x = 40, y = 64, z = 40;
  Cm.setLevel(x, y, z, 7);
  const took = Cm.addItem(x, y, z, 'cake', () => 0);   // chance 1.0 — would ALWAYS bump if allowed
  ok(took === false, 'level 7 refuses a new (guaranteed-chance) item');
  ok(Cm.level(x, y, z) === 7, 'level stayed at 7 (did not silently become 8)');
}

// ── 6. LEVEL 8 (FULL) ALSO REFUSES INSERTION ──────────────────────────────────────────────
{
  const x = 41, y = 64, z = 41;
  Cm.setLevel(x, y, z, 8);
  const took = Cm.addItem(x, y, z, 'cake', () => 0);
  ok(took === false, 'a full (level 8) composter refuses insertion');
  ok(Cm.level(x, y, z) === 8, 'level 8 stayed at 8');
}

// ── 7. LEVEL 7 -> 8 ONLY AFTER THE SCHEDULED TICK, NEVER ON ITS OWN — addToComposter reaching
//    7 must NOT itself set level to 8; only Composter.scheduledTick (fired by B's 20-tick
//    schedule) may. Both directions: the tick does nothing BEFORE it is due, and the RIGHT
//    function (scheduledTick, not some other write) is what performs the pop. ──
{
  const x = 50, y = 64, z = 50;
  W.setBlock(x, y, z, STONE);   // B.tick's scheduledTick dispatcher reads w.get() before it
                                 // reaches Composter.scheduledTick, so a real block must sit here
  Cm.setLevel(x, y, z, 6);
  const took = Cm.addItem(x, y, z, 'cake', () => 0);   // chance 1.0 -- guaranteed to reach 7
  ok(took === true && Cm.level(x, y, z) === 7, 'reaching level 7 via addItem does NOT itself jump to 8');
  ok(M.Behave.scheduled() === 1, 'reaching level 7 scheduled exactly one tick (B.schedule)');
  // advance 19 ticks — one short of the 20-tick delay — and prove nothing popped yet
  for (let i = 0; i < 19; i++) M.Behave.tick();
  ok(Cm.level(x, y, z) === 7, 'still level 7 after 19 of the 20 scheduled ticks');
  M.Behave.tick();   // the 20th tick — this is what should fire ComposterBlock.scheduledTick
  ok(Cm.level(x, y, z) === 8, 'level popped to 8 on exactly the 20th tick, through the real scheduler');
}

// ── 8. Composter.scheduledTick ITSELF: direct-call contract (not only via the scheduler above) —
//    claims (true) a position it owns at level 7, refuses (false, no side effect) everything else,
//    in both directions: a level it should not touch, and a position it never tracked at all. ──
{
  const x = 51, y = 64, z = 51;
  ok(Cm.scheduledTick(x, y, z) === false, 'scheduledTick on an UNTRACKED position (level 0) returns false');
  ok(Cm.level(x, y, z) === 0, 'and does not create a phantom level-0-is-really-something composter');
  Cm.setLevel(x, y, z, 3);
  ok(Cm.scheduledTick(x, y, z) === false, 'scheduledTick at level 3 (not 7) returns false');
  ok(Cm.level(x, y, z) === 3, 'and leaves level 3 untouched');
  Cm.setLevel(x, y, z, 7);
  ok(Cm.scheduledTick(x, y, z) === true, 'scheduledTick at level 7 returns true (it fired)');
  ok(Cm.level(x, y, z) === 8, 'and the level is now 8');
  ok(Cm.scheduledTick(x, y, z) === false, 're-firing at level 8 returns false (nothing left to do)');
}

// ── 9. EXTRACT: exactly one bone_meal at level 8, level resets to 0; refused (null) at every
//    other level, in both directions again. ──
{
  const x = 60, y = 64, z = 60;
  for (const lvl of [0, 1, 7]) {
    Cm.setLevel(x, y, z, lvl);
    ok(Cm.extract(x, y, z) === null, 'extract refuses a level-' + lvl + ' composter (returns null)');
    ok(Cm.level(x, y, z) === lvl, 'and does not touch its level');
  }
  Cm.setLevel(x, y, z, 8);
  const got = Cm.extract(x, y, z);
  ok(!!got && got.item === 'bone_meal' && got.count === 1, 'extracting a full composter gives exactly one bone_meal');
  ok(Cm.level(x, y, z) === 0, 'and resets the composter to level 0');
  ok(Cm.extract(x, y, z) === null, 'extracting the now-empty (level 0) composter again refuses');
}

// ── 10. Composter.onUse — the player-hook contract 14l_use.js's dead-code-today branch calls.
//     Insert path below 7, no-op click AT 7, extract AT 8, PASS below-level items that are not
//     compostable at all. ──
{
  const x = 70, y = 64, z = 70;
  ok(Cm.onUse(x, y, z, 'stone') === null, 'onUse with a non-compostable item at level 0 is PASS (null)');
  const r1 = Cm.onUse(x, y, z, 'cake');
  ok(!!r1 && r1.consumed === true, 'onUse inserting a compostable item consumes it');
  Cm.setLevel(x, y, z, 7);
  const r2 = Cm.onUse(x, y, z, 'cake');
  ok(!!r2 && r2.consumed === false, 'onUse at level 7 registers the click but consumes nothing');
  ok(Cm.level(x, y, z) === 7, 'and level 7 is unchanged by that no-op click');
  Cm.setLevel(x, y, z, 8);
  const r3 = Cm.onUse(x, y, z, 'cake');
  ok(!!r3 && r3.extracted && r3.extracted.item === 'bone_meal', 'onUse at level 8 extracts bone_meal');
  ok(Cm.level(x, y, z) === 0, 'and the composter is empty again afterward');
}

// ── ANTI-VACUITY: genuinely break the running module (corrupt its real tables, stub its
//    real calls), observe the WRONG outcome that follows, then restore it — not a re-assertion
//    of the rule, a demonstration that removing it changes the answer. ──
say('\n-- anti-vacuity --');
{
  // (a) corrupt the real CHANCE table entry (0.65 -> 0.99) and roll an rng (0.7) that the REAL
  // chance must refuse (0.7 >= 0.65) but the corrupted one wrongly accepts (0.7 < 0.99).
  const x = 90, y = 64, z = 90;
  Cm.setLevel(x, y, z, 1);
  const real = Cm.CHANCE.dandelion;
  Cm.CHANCE.dandelion = 0.99;
  Cm.addItem(x, y, z, 'dandelion', () => 0.7);
  const wrongBump = Cm.level(x, y, z) === 2;
  Cm.CHANCE.dandelion = real;
  okAv(wrongBump, 'corrupting CHANCE.dandelion to 0.99 measurably changes the outcome (0.7 now bumps, proving 0.65 really gated it)');
}
{
  // (b) delete a real table entry and watch the count assertion's own arithmetic disagree.
  const real = Cm.CHANCE.cake;
  delete Cm.CHANCE.cake;
  const shrunk = Object.keys(Cm.CHANCE).length === 90;
  Cm.CHANCE.cake = real;
  okAv(shrunk, 'deleting one CHANCE entry (cake) changes the count from 91 to 90, so §1\'s ===91 would fail');
}
{
  // (c) the level-0 special case must ignore chance ENTIRELY, not just usually win the roll —
  // corrupt the item's own chance to near-zero and confirm level 0 STILL takes it.
  const x = 91, y = 64, z = 91;
  Cm.setLevel(x, y, z, 0);
  const real = Cm.CHANCE.sweet_berries;
  Cm.CHANCE.sweet_berries = 0.0000001;
  const took = Cm.addItem(x, y, z, 'sweet_berries', () => 0.9999999);
  const bumped = Cm.level(x, y, z) === 1;
  Cm.CHANCE.sweet_berries = real;
  okAv(took && bumped, 'even with the item\'s own chance corrupted to ~0, a level-0 composter still always takes it');
}
{
  // (d) stub out the REAL scheduler call `addToComposter` makes (B.schedule) so reaching level 7
  // never actually gets a tick queued, then run the clock far past 20 ticks and confirm level 7
  // is stuck forever — proving the schedule call, not the passage of time itself, is what pops it.
  const x = 92, y = 64, z = 92;
  W.setBlock(x, y, z, STONE);
  Cm.setLevel(x, y, z, 6);
  const realSchedule = M.Behave.schedule;
  M.Behave.schedule = function () { return false; };   // sabotage: scheduling silently does nothing
  Cm.addItem(x, y, z, 'cake', () => 0);                 // reaches level 7, but nothing gets queued
  for (let i = 0; i < 25; i++) M.Behave.tick();          // 25 > the real 20-tick delay
  const stuck = Cm.level(x, y, z) === 7;
  M.Behave.schedule = realSchedule;
  okAv(stuck, 'with B.schedule stubbed to a no-op, level 7 never pops to 8 even 25 ticks later — the schedule call is load-bearing');
}
{
  // (e) LEVEL_READY, not LEVEL_MAX, is addItem's real gate — corrupt it up to 8 and confirm a
  // level-7 composter WRONGLY accepts a brand-new item once that gate is gone.
  const x = 93, y = 64, z = 93;
  Cm.setLevel(x, y, z, 7);
  const real = Cm.LEVEL_READY;
  Cm.LEVEL_READY = 8;
  const took = Cm.addItem(x, y, z, 'cake', () => 0);
  Cm.LEVEL_READY = real;
  okAv(took === true && Cm.level(x, y, z) === 8, 'corrupting LEVEL_READY to 8 makes a level-7 composter wrongly accept a new item — the real 7 gate matters');
}
{
  // (f) LEVEL_MAX is extract's real gate — corrupt it and confirm a genuinely full (8) composter
  // WRONGLY gets refused once "full" no longer means 8.
  const x = 94, y = 64, z = 94;
  Cm.setLevel(x, y, z, 8);
  const real = Cm.LEVEL_MAX;
  Cm.LEVEL_MAX = 100;
  const refused = Cm.extract(x, y, z) === null;
  Cm.LEVEL_MAX = real;
  okAv(refused, 'corrupting LEVEL_MAX to 100 makes extract wrongly refuse a real level-8 composter — the real ===8 check matters');
}

// ── #10805: sound assets + hopper I/O + comparator ─────────────────────────────────────
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MCLITE_ROOT } from './loadsrc.mjs';
{
  const AS = join(MCLITE_ROOT, 'assets');
  const rdj = (f) => JSON.parse(readFileSync(join(AS, f), 'utf8'));
  const b64 = (f) => readFileSync(join(AS, f)).toString('base64');
  const EXTRA = ['07zzq_brewing.js', '02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js', '14d_survival.js',
    '14g_menu.js', '07_world.js', '07b_behaviour.js', '07f_redstone.js', '07c_blockentity.js', '07zy_composter.js', '02j_sounds.js',
    '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '13_input.js', '15b_gui.js', '15_hud.js', '07zzr_minecart.js', '14l_use.js'];
  const N = loadEngine({ extra: EXTRA, dom: false });
  N.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  N.Recipes.init({ recipes: b64('recipes.bin'), recipesBytes: rdj('recipes.meta.json').jsonBytes });
  N.DATA = Object.assign({}, N.DATA, { entities: rdj('entities.json') });
  N.BlockEntities.init(); N.Entities.init();
  N.Sound.init({ sounds: b64('sounds.bin'), soundsBytes: rdj('sounds.meta.json').rawBytes });

  // (1) the four composter events really exist in the packed sounds (SoundEvents.java:219-222)
  const evs = ['empty', 'fill', 'fill_success', 'ready'].map((n) => 'block.composter.' + n);
  const missing = evs.filter((e) => !N.Sound.events[e]);
  ok(missing.length === 0, 'composter sound events missing from sounds.bin: ' + missing);
  okAv(!N.Sound.events['block.composter.fill_succes'], 'a misspelt composter event is detected as absent');
  const src = readFileSync(join(MCLITE_ROOT, 'src', '07zy_composter.js'), 'utf8');
  for (const e of evs) ok(src.includes("'" + e + "'"), 'source plays ' + e);

  // (2) hopper above a composter: insert via vanilla chance table; comparator reads LEVEL
  const WW = N.World, BE = N.BlockEntities, SS = N.States, B = N.Behave, Cc = N.Composter, Rs = N.Redstone;
  B.init(WW); WW.init(1); Rs.init();
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) { const c = WW.makeChunk(cx, cz); c.state = N.CH.GENERATED; WW.chunks.set(WW.key(cx, cz), c); }
  const put = (x, y, z, nm) => WW.setBlock(x, y, z, SS.stateOf(nm) | 0);
  put(2, 4, 2, 'composter');
  let hs = B.setProp(SS.stateOf('hopper') | 0, 'facing', 'down');
  WW.setBlock(2, 5, 2, hs);
  const hop = BE.get(2, 5, 2) || BE.create(2, 5, 2, 'hopper');
  const run = (n) => { for (let i = 0; i < n; i++) BE.tick(); };
  const stk = (nm, c) => N.Inventory.stack(nm, c);
  hop.items[0] = stk('wheat_seeds', 5);
  const lvl0 = Cc.level(2, 4, 2);
  run(60);
  const l1 = Cc.level(2, 4, 2);
  ok(lvl0 === 0 && l1 >= 1, 'hopper above a composter inserts a compostable item: level ' + lvl0 + ' -> ' + l1);
  ok(!hop.items[0] || hop.items[0].n < 5, 'hopper consumed the seed');
  // non-compostable never goes in
  hop.items[1] = stk('stick', 3); const before = Cc.level(2, 4, 2);
  const cons = BE.composterInsert(2, 4, 2, 'stick');
  ok(cons === 0 && Cc.level(2, 4, 2) === before, 'non-compostable refused by composter inventory');
  // comparator reads LEVEL
  for (const L of [0, 3, 7, 8]) {
    Cc.setLevel(2, 4, 2, L);
    const out = Rs.analogOutput(2, 4, 2, WW.getBlock(2, 4, 2));
    ok(out === L, 'comparator reads composter LEVEL ' + L + ', got ' + out);
  }
  // hopper BELOW a full composter extracts bone meal and empties it; below level 8 extracts nothing
  put(6, 6, 6, 'composter');
  WW.setBlock(6, 5, 6, hs); const low = BE.get(6, 5, 6) || BE.create(6, 5, 6, 'hopper');
  Cc.setLevel(6, 6, 6, 7); run(30);
  ok(Cc.level(6, 6, 6) === 7 || Cc.level(6, 6, 6) === 8 && false, 'level 7 composter gives nothing to a hopper below');
  Cc.setLevel(6, 6, 6, 8); run(30);
  const got = low.items.some((s) => s && !N.Inventory.isEmpty(s) && N.Items.nameOf(s.i) === 'bone_meal');
  ok(got && Cc.level(6, 6, 6) === 0, 'hopper below a level-8 composter takes 1 bone_meal and resets LEVEL to 0');

  // anti-vacuity: wrong chance table (everything 0 chance -> no rise past first item at lvl>0)
  const realCh = Cc.CHANCE.wheat_seeds;
  Cc.setLevel(2, 4, 2, 3); Cc.CHANCE.wheat_seeds = 0.0001;
  let raised = 0; for (let i = 0; i < 20; i++) { Cc.setLevel(2, 4, 2, 3); BE.composterInsert(2, 4, 2, 'wheat_seeds', () => 0.5); if (Cc.level(2, 4, 2) > 3) raised++; }
  Cc.CHANCE.wheat_seeds = realCh;
  okAv(raised === 0, 'a corrupted (near-zero) chance table stops the hopper raising the level');
  // wrong side: hopper facing sideways instead of down inserts nothing
  Cc.setLevel(2, 4, 2, 0);
  WW.setBlock(2, 5, 2, B.setProp(SS.stateOf('hopper') | 0, 'facing', 'north'));
  const side = BE.get(2, 5, 2) || BE.create(2, 5, 2, 'hopper');
  side.items[0] = stk('wheat_seeds', 5); run(60);
  okAv(Cc.level(2, 4, 2) === 0, 'a hopper facing sideways does not feed the composter below');
  // comparator shape broken: an analog reading of a non-composter differs
  okAv(Rs.analogOutput(2, 4, 2, SS.stateOf('stone') | 0) === 0, 'stone gives comparator 0, not the composter LEVEL');
}


console.log('\n' + pass + ' checks passed, ' + breaks + ' anti-vacuity breaks caught, ' + fails.length + ' failed');
if (fails.length) {
  for (const f of fails.slice(0, 40)) console.log('  FAIL: ' + f);
  process.exit(1);
}
process.exit(0);
