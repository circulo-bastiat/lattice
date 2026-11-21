#!/usr/bin/env node
// enchhelpercheck.mjs — PLAN G18f follow-up (D-48x's Trade.OWED "SellEnchantedToolFactory"
// line), the ENCH-HELPER UNIT: `07ox_enchhelper.js`'s port of
// `EnchantmentHelper.enchant`/`generateEnchantments`/`getPossibleEntries`
// (.decomp/net/minecraft/enchantment/EnchantmentHelper.java:280-386) — the real per-level
// min/max POWER windows (one per `Enchantment` subclass, .decomp/net/minecraft/enchantment/
// *.java), the `canCombine`/`canAccept` exclusion groups, and the multi-enchantment loop
// ("while nextInt(50) <= power", halving power, pruning conflicts) `SellEnchantedToolFactory`
// (TradeOffers.java:874-881) drives directly — plus the `07p_trade.js` call-site wiring itself.
//
//   node tools/enchhelpercheck.mjs [--verbose]
//
// Sections:
//   1. getMinPower/getMaxPower — spot-checked windows against the decomp, both directions
//      (a power inside a level's window is found; one just outside every level's window is not)
//   2. canCombine — every named exclusion group, both a real conflict and a real non-conflict
//   3. getPossibleEntries — target-gating (an armor-only id never offered to a digger) and the
//      "highest satisfying level" rule
//   4. generateEnchantments/enchant — seeded multi-trial: every returned set is internally
//      conflict-free and level-in-range; an item with 0 enchantability returns nothing
//   5. WIRING — the real `Trade` module's `sell_enchanted_tool_for_emeralds` roll, off THE REAL
//      `NS.EnchHelper`, produces target-correct, conflict-free, possibly-multi-enchant tags
//   6. anti-vacuity — `canCombine`/`getMaxPower` deliberately broken, and the very assertions
//      above are shown to catch it

import { loadEngine } from './loadsrc.mjs';

const VERBOSE = process.argv.includes('--verbose');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, m ? 'anti-vacuity: ' + m : m); };

console.log('enchhelpercheck — PLAN G18f follow-up: EnchantmentHelper.enchant port (07ox_enchhelper.js)');

// mulberry32 — a small deterministic PRNG so every trial below is reproducible; stands in for
// `rng()` exactly as the engine's own callers do (Math.floor(rng()*n) === nextInt(n), see
// 07p_trade.js's rollEnchantBook/rollDyedArmor and 07ox_enchhelper.js's own header).
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const M = loadEngine({ extra: ['07ox_enchhelper.js'] });
const EH = M.EnchHelper;
ok(!!EH, 'NS.EnchHelper did not attach to the engine namespace');

// ---- 1. getMinPower/getMaxPower — decomp-cited spot checks, both directions ----
// ProtectionEnchantment.java:17-18 + Type(1,11): L1 [1,12] L2 [12,23] L3 [23,34] L4 [34,45]
ok(EH.getMinPower('protection', 1) === 1 && EH.getMaxPower('protection', 1) === 12, 'protection L1 window should be [1,12]');
ok(EH.getMinPower('protection', 4) === 34 && EH.getMaxPower('protection', 4) === 45, 'protection L4 window should be [34,45]');
// DamageEnchantment.java BASE_POWERS[1,5,5] POWERS_PER_LEVEL[11,8,8], diff 20 all three
ok(EH.getMinPower('sharpness', 1) === 1 && EH.getMaxPower('sharpness', 1) === 21, 'sharpness L1 window should be [1,21]');
ok(EH.getMinPower('smite', 3) === 21 && EH.getMaxPower('smite', 3) === 41, 'smite L3 window should be [21,41] (5+2*8=21)');
// EfficiencyEnchantment.java:13-19
ok(EH.getMinPower('efficiency', 5) === 41 && EH.getMaxPower('efficiency', 5) === 101, 'efficiency L5 window should be [41,101]');
// anti-vacuity, direction 2 (rule 6): a power just outside EVERY level's window for a bounded
// (non-open-ended) enchantment must not be satisfiable at any level
{
  const pool = EH.getPossibleEntries(46, ['armor'], false);           // protection's own max is 45 (L4)
  okAv(!pool.some((p) => p.id === 'protection'), 'anti-vacuity: power 46 is above every protection level\'s own window (max 45) — must not roll protection');
  const pool0 = EH.getPossibleEntries(0, ['armor'], false);
  okAv(pool0.length === 0, 'anti-vacuity: power 0 is below every armor enchantment\'s own L1 minimum — must roll nothing');
}

// ---- 2. canCombine — every named exclusion group + a real non-conflict, both directions ----
const CONFLICTS = [
  ['protection', 'blast_protection'], ['fire_protection', 'projectile_protection'],
  ['sharpness', 'smite'], ['smite', 'bane_of_arthropods'],
  ['fortune', 'silk_touch'], ['looting', 'silk_touch'],
  ['multishot', 'piercing'], ['infinity', 'mending'],
  ['depth_strider', 'frost_walker'], ['riptide', 'loyalty'], ['riptide', 'channeling']
];
for (const [a, b] of CONFLICTS) {
  ok(EH.canCombine(a, b) === false, a + '+' + b + ' must be incompatible (jar-verified canAccept override)');
  ok(EH.canCombine(b, a) === false, b + '+' + a + ' must be incompatible (canCombine is symmetric)');
}
const COMPATIBLE = [
  ['protection', 'feather_falling'], ['sharpness', 'looting'],
  ['efficiency', 'unbreaking'], ['fortune', 'unbreaking'], ['power', 'unbreaking']
];
for (const [a, b] of COMPATIBLE) {
  ok(EH.canCombine(a, b) === true, a + '+' + b + ' should be able to combine (no jar-verified exclusion between them)');
  ok(EH.canCombine(b, a) === true, b + '+' + a + ' should be able to combine (symmetric)');
}
ok(EH.canCombine('sharpness', 'sharpness') === false, 'an enchantment can never combine with itself');

// ---- 3. getPossibleEntries — target gating + highest-satisfying-level ----
{
  const diggerPool = EH.getPossibleEntries(50, ['digger', 'breakable'], false);
  const diggerIds = diggerPool.map((p) => p.id);
  ok(diggerIds.indexOf('efficiency') >= 0, 'power 50 on a digger/breakable item should offer efficiency');
  okAv(diggerIds.indexOf('protection') < 0, 'anti-vacuity: protection (target armor) must never be offered to a digger/breakable item');
  okAv(diggerIds.indexOf('power') < 0, 'anti-vacuity: power (target bow) must never be offered to a digger/breakable item');
  // highest satisfying level: efficiency L5 window is [41,91] (1+10*4=41), L4 is [31,81] — at
  // power 50 BOTH windows contain 50, and getPossibleEntries must return the HIGHEST (L5),
  // exactly as EnchantmentHelper.java:373-380's `for (l = maxLevel; l > minLevel-1; l--) ... break`.
  const eff = diggerPool.find((p) => p.id === 'efficiency');
  ok(!!eff && eff.level === 5, 'getPossibleEntries must pick the HIGHEST level whose window contains the power, got ' + (eff && eff.level));
}

// ---- 4. generateEnchantments/enchant — seeded multi-trial ----
{
  ok(EH.enchant(mulberry32(1), 'stick', [], 20, false).length === 0, 'an item with no ENCHANTABILITY entry (enchantability 0) must never enchant');

  let sawMulti = false, sawAny = false, conflictViolations = 0, rangeViolations = 0, targetViolations = 0;
  const targets = ['digger', 'breakable'];
  for (let seed = 1; seed <= 500; seed++) {
    const rng = mulberry32(seed);
    const picks = EH.enchant(rng, 'diamond_pickaxe', targets, 30, false);
    if (picks.length > 1) sawMulti = true;
    if (picks.length > 0) sawAny = true;
    for (const p of picks) {
      const e = EH.ENCH[p.id];
      if (!e || targets.indexOf(e.target) < 0) targetViolations++;
      if (!e || p.level < 1 || p.level > e.maxLevel) rangeViolations++;
    }
    for (let i = 0; i < picks.length; i++) {
      for (let j = i + 1; j < picks.length; j++) {
        if (!EH.canCombine(picks[i].id, picks[j].id)) conflictViolations++;
      }
    }
  }
  ok(sawAny, '500 seeded trials on a diamond_pickaxe at power 30 produced not a single enchantment');
  ok(sawMulti, '500 seeded trials never produced more than one enchantment — the multi-enchant loop looks dead');
  ok(targetViolations === 0, targetViolations + ' roll(s) offered a non-digger/breakable enchantment to a pickaxe');
  ok(rangeViolations === 0, rangeViolations + ' roll(s) had a level outside [1,maxLevel]');
  ok(conflictViolations === 0, conflictViolations + ' roll(s) produced two enchantments that cannot combine (fortune+silk_touch etc)');
}

// ---- 5. WIRING — the real Trade module's sell_enchanted_tool_for_emeralds roll ----
{
  const T = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07i_entitylist.js', '07ox_enchhelper.js', '07p_trade.js'] });
  ok(T.EnchHelper === T.NS?.EnchHelper || !!T.EnchHelper, 'trade-loaded engine should also carry NS.EnchHelper');
  const row = { profession: 'toolsmith', level: 5, kind: 'sell_enchanted_tool_for_emeralds',
    item: 'diamond_pickaxe', basePrice: 13, maxUses: 3, xp: 30, priceMult: 0.2 };
  let anyEnchanted = false, anyMulti = false, badTag = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const rng = mulberry32(seed);
    const offers = T.Trade.resolveOffers([row], { type: 'villager', profession: 'toolsmith' }, rng);
    ok(offers.length === 1, 'sell_enchanted_tool_for_emeralds row must resolve to exactly one offer');
    const o = offers[0];
    ok(o.priceEmerald >= row.basePrice && o.priceEmerald <= 64, 'resolved price ' + o.priceEmerald + ' outside [basePrice,64]');
    if (o.tag && o.tag.Enchantments && o.tag.Enchantments.length) {
      anyEnchanted = true;
      if (o.tag.Enchantments.length > 1) anyMulti = true;
      const ids = o.tag.Enchantments.map((e) => e.id.replace('minecraft:', ''));
      for (let i = 0; i < ids.length; i++) {
        const e = T.EnchHelper.ENCH[ids[i]];
        if (!e || ['digger', 'breakable'].indexOf(e.target) < 0) badTag++;
        for (let j = i + 1; j < ids.length; j++) if (!T.EnchHelper.canCombine(ids[i], ids[j])) badTag++;
      }
    } else {
      ok(o.tag === undefined, 'an enchant-less roll must leave tag undefined (no empty Enchantments array)');
    }
  }
  ok(anyEnchanted, '300 seeded villager rolls of a toolsmith L5 diamond_pickaxe never produced an enchantment');
  ok(anyMulti, '300 seeded villager rolls never produced MORE THAN ONE enchantment — the real wiring is not driving the multi-enchant loop');
  ok(badTag === 0, badTag + ' resolved trade tag(s) carried a wrong-target or conflicting enchantment pair');
}

// ---- 6. anti-vacuity — break the real functions, prove the checks above would have caught it ----
{
  // canCombine broken to always-true: conflicting pairs must now slip through the multi-enchant
  // loop (removeConflicts no longer removes anything), proving §4's conflict scan is real.
  const savedCC = EH.canCombine;
  EH.canCombine = function () { return true; };
  let sawForbiddenPair = false;
  for (let seed = 1; seed <= 2000 && !sawForbiddenPair; seed++) {
    const picks = EH.enchant(mulberry32(seed), 'diamond_pickaxe', ['digger', 'breakable'], 40, false);
    const ids = picks.map((p) => p.id);
    if (ids.indexOf('fortune') >= 0 && ids.indexOf('silk_touch') >= 0) sawForbiddenPair = true;
    if (ids.indexOf('efficiency') >= 0 && ids.indexOf('unbreaking') >= 0 && ids.length > 1 && sawForbiddenPair) break;
  }
  okAv(sawForbiddenPair, 'breaking canCombine to always-true must let fortune+silk_touch co-occur within 2000 seeds — proves the real canCombine is what prevents it');
  EH.canCombine = savedCC;
  // restore, and confirm the SAME 2000 seeds now never produce that forbidden pair
  let stillForbidden = false;
  for (let seed = 1; seed <= 2000; seed++) {
    const picks = EH.enchant(mulberry32(seed), 'diamond_pickaxe', ['digger', 'breakable'], 40, false);
    const ids = picks.map((p) => p.id);
    if (ids.indexOf('fortune') >= 0 && ids.indexOf('silk_touch') >= 0) stillForbidden = true;
  }
  ok(!stillForbidden, 'with the real (restored) canCombine, fortune+silk_touch must never co-occur across the same 2000 seeds');

  // getMaxPower broken to always-permissive: getPossibleEntries must now offer protection's own
  // MAX level (4) at power 1, instead of level 1 — proves §1/§3's "highest satisfying level"
  // check actually depends on a correct getMaxPower.
  // power 46 is ABOVE protection's own real L4 window ([34,45]) but still >= its L4 minimum
  // (34) — with the real getMaxPower it must roll NOTHING (§1 already proves this); with
  // getMaxPower broken permissive, the top-down search (EnchantmentHelper.java:375-380) hits L4
  // first and accepts it immediately.
  const savedMax = EH.getMaxPower;
  const realGap = EH.getPossibleEntries(46, ['armor'], false);
  ok(!realGap.some((p) => p.id === 'protection'), 'sanity: with the real getMaxPower, power 46 must not roll protection at all (re-proves §1)');
  EH.getMaxPower = function () { return 999999; };
  const brokenPool = EH.getPossibleEntries(46, ['armor'], false);
  const brokenProt = brokenPool.find((p) => p.id === 'protection');
  okAv(!!brokenProt && brokenProt.level === 4, 'breaking getMaxPower to always-permissive must roll protection L4 at power 46 (only its OWN min, 34, still gates it) — proves the real getMaxPower is what excludes it');
  EH.getMaxPower = savedMax;
  const fixedPool = EH.getPossibleEntries(46, ['armor'], false);
  ok(!fixedPool.some((p) => p.id === 'protection'), 'with the real getMaxPower restored, power 46 must roll no protection level again');
}

console.log(' ' + pass + ' assertions, ' + fails.length + ' failed, ' + breaks + ' anti-vacuity breaks');
if (VERBOSE || fails.length) for (const f of fails) console.log('  FAIL: ' + f);
process.exit(fails.length ? 1 : 0);
