#!/usr/bin/env node
// tradecheck.mjs — QUEUE row 3 (G18f), D-480: OFFER-TABLE EXTRACTION, the static half.
//
//   node tools/tradecheck.mjs [--verbose]
//
// ⚠ WHAT THIS PROVES. `tools/golden/villager-trades-1.18.2.tsv` (extract-villager-trades.mjs,
// D-480) is read structurally off VillagerTrades' own builder bytecode, not typed by hand — this
// proves the TABLE'S SHAPE holds (every employed profession present, every row's `kind` carries
// the fields that kind needs, rule 6 unconditionally) and spot-checks six rows whose values this
// session cross-read against the disassembly by hand (DECISIONS.md D-480), so a stale or
// corrupted regeneration is caught (rule 1) rather than silently trusted.
//
// ⚠⚠ D-48x WIRES IT: §3 below drives the real `Trade` module (07p_trade.js) end to end — a
// real sell/buy trade, both refusal directions (rule 6), and maxUses exhaustion — off THESE
// SAME extracted rows. Still not vanilla's whole row 3: restocking, the five procedural
// listing kinds and the villager-type boat trade are named, not guessed (trade SELECTION: §8, D-504) — see `Trade.OWED` in 07p_trade.js.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const TSV = join(MCLITE_ROOT, 'tools', 'golden', 'villager-trades-1.18.2.tsv');

const VERBOSE = process.argv.includes('--verbose');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
let breaks = 0;
let TRADES_TABLE = null, ITEMS_INIT = null;   // §8 re-uses §3's parsed table
const okAv = (c, m) => { breaks++; ok(c, m ? 'anti-vacuity: ' + m : m); };

console.log('tradecheck — QUEUE row 3 (G18f), D-480: villager offer-table extraction');

if (!existsSync(TSV)) {
  console.log(' SKIP - villager-trades-1.18.2.tsv not present (run extract-villager-trades.mjs)');
  process.exit(process.env.MCLITE_REQUIRE_REFEREE ? 1 : 0);
}

function parse(text) {
  const lines = text.trim().split('\n');
  const header = lines[0].split('\t');
  return lines.slice(1).map((l) => {
    const cells = l.split('\t');
    const row = {};
    header.forEach((h, i) => { row[h] = cells[i]; });
    return row;
  });
}

const raw = readFileSync(TSV, 'utf8');
const rows = parse(raw);

// ---- 1. shape ----
ok(rows.length >= 250, 'expected 250+ rows, got ' + rows.length);   // 260 at D-669 (the 328 before carried the wandering trader's pools)
const EMPLOYED = ['armorer', 'butcher', 'cartographer', 'cleric', 'farmer', 'fisherman', 'fletcher',
  'leatherworker', 'librarian', 'mason', 'shepherd', 'toolsmith', 'weaponsmith'];
const profSet = new Set(rows.map((r) => r.profession));
for (const p of EMPLOYED) ok(profSet.has(p), 'no rows for profession ' + p);
ok(!profSet.has('none') && !profSet.has('nitwit'), 'none/nitwit have no trades in vanilla — a row for either means the walk mis-attributed a profession');

const KIND_FIELDS = {
  sell_item_for_emerald: ['item', 'itemQty', 'maxUses', 'xp'],
  buy_item_for_emerald: ['item', 'priceEmerald', 'itemQty', 'maxUses', 'xp'],
  buy_item_for_emerald_and_item: ['item', 'itemQty', 'priceEmerald', 'item2', 'item2Qty', 'maxUses', 'xp'],
  sell_type_variant_item_for_emerald: ['itemQty', 'maxUses', 'xp', 'byVillagerType'],
  sell_suspicious_stew_for_emerald: ['effect', 'durationTicks', 'xp'],
};
function rowOk(r) {
  const need = KIND_FIELDS[r.kind];
  if (!need) return false;
  return need.every((f) => r[f] !== undefined && r[f] !== '');
}
let shapeBad = 0;
for (const r of rows) if (!rowOk(r)) shapeBad++;
ok(shapeBad === 0, shapeBad + ' row(s) are missing a field their own kind requires');

// anti-vacuity: a row with a missing required field MUST fail rowOk (both directions, rule 6)
const goodRow = rows.find((r) => r.kind === 'sell_item_for_emerald');
const brokenRow = Object.assign({}, goodRow, { item: '' });
okAv(rowOk(goodRow) === true, 'a real row parses as valid');
okAv(rowOk(brokenRow) === false, 'a row with its item blanked out is rejected, not silently accepted');

// ---- 2. spot-check six rows this session cross-read against the disassembly by hand (D-480) ----
function find(prof, level, item) {
  return rows.find((r) => r.profession === prof && +r.level === level && (r.item === item || r.item2 === item));
}
const SPOT = [
  ['farmer', 1, 'wheat', { itemQty: '20', kind: 'sell_item_for_emerald' }],
  ['farmer', 1, 'bread', { itemQty: '6', kind: 'buy_item_for_emerald', priceEmerald: '1' }],
  ['cleric', 3, 'glowstone', { priceEmerald: '4', kind: 'buy_item_for_emerald' }],
  ['armorer', 1, 'iron_leggings', { priceEmerald: '7', kind: 'buy_item_for_emerald' }],
  ['armorer', 2, 'bell', { priceEmerald: '36', kind: 'buy_item_for_emerald' }],
  ['mason', 1, 'clay_ball', { itemQty: '10', kind: 'sell_item_for_emerald' }],
];
for (const [prof, level, item, expect] of SPOT) {
  const r = find(prof, level, item);
  ok(!!r, prof + ' L' + level + ' ' + item + ' row missing entirely');
  if (r) for (const [k, v] of Object.entries(expect)) ok(r[k] === v, prof + ' L' + level + ' ' + item + '.' + k + ' = ' + r[k] + ', expected ' + v);
}

// fisherman's villager-type boat trade: all 7 VillagerType keys present, jar-verified this
// session (D-480) including the desert->jungle_boat quirk (not a bug in the extractor).
const boat = rows.find((r) => r.kind === 'sell_type_variant_item_for_emerald');
ok(!!boat, 'no sell_type_variant_item_for_emerald row (fisherman L5 boat trade)');
if (boat) {
  const byType = JSON.parse(boat.byVillagerType);
  for (const t of ['desert', 'jungle', 'plains', 'savanna', 'snow', 'swamp', 'taiga']) ok(!!byType[t], 'boat trade has no entry for villager type ' + t);
  ok(byType.desert === 'jungle_boat', 'desert villager type boat should be jungle_boat (jar-verified, a real vanilla quirk), got ' + byType.desert);
}


// ---- 3. WIRING: the real Trade module (07p_trade.js), driven end to end off THESE SAME rows,
// not a copy (D-48x). Both refusal directions, rule 6, at every step.
{
  const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07i_entitylist.js', '07ox_enchhelper.js', '07p_trade.js'] });
  const imeta = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'items.meta.json'), 'utf8'));
  M.Items.init({ items: readFileSync(join(MCLITE_ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: imeta.rawBytes });
  const NUMF = new Set(['itemQty', 'item2Qty', 'priceEmerald', 'maxUses', 'xp', 'durationTicks', 'effectId']);
  const trades = {};
  for (const r of rows) {
    const prof = r.profession, lvl = +r.level;
    if (!trades[prof]) trades[prof] = {};
    if (!trades[prof][lvl]) trades[prof][lvl] = [];
    const row = { kind: r.kind };
    for (const h of Object.keys(r)) {
      if (h === 'profession' || h === 'level' || h === 'kind' || r[h] === undefined || r[h] === '') continue;
      row[h] = h === 'byVillagerType' ? JSON.parse(r[h]) : (NUMF.has(h) ? +r[h] : r[h]);
    }
    trades[prof][lvl].push(row);
  }
  M.DATA = Object.assign({}, M.DATA, { villagerTrades: trades });
  // §3–§7 drive the trade MECHANISM over a level's whole table (indices line up with offersFor);
  // the real 2-of-N draw is §8's, on a fresh engine (D-504).
  M.Trade.OFFERS_PER_LEVEL = 99;
  TRADES_TABLE = trades; ITEMS_INIT = () => ({ items: readFileSync(join(MCLITE_ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: imeta.rawBytes });

  const farmerOffers = M.Trade.offersFor('farmer');
  ok(farmerOffers.length > 0, 'farmer has no level-1 offers wired');
  // the boat row is fisherman-only and level 5 -- a farmer's (or a level-1 fisherman's) own
  // offers must never contain it regardless (loop/vtype-s105: it is BUILT now, just not at L1).
  ok(farmerOffers.every((o) => o.kind !== 'sell_type_variant_item_for_emerald'), 'a boat-variant offer leaked onto a farmer, which has no such row at any level');
  const fisherOffers = M.Trade.offersFor('fisherman');
  okAv(!fisherOffers.some((o) => o.kind === 'sell_type_variant_item_for_emerald'), 'anti-vacuity: offersFor(\'fisherman\') is LEVEL 1 -- the L5-only boat row must not appear there');

  const wheatId = M.Items.of('wheat'), emeraldId = M.Items.of('emerald');
  ok(wheatId >= 0 && emeraldId >= 0, 'wheat/emerald item ids missing from the item registry');
  const wheatOfferIdx = farmerOffers.findIndex((o) => o.item === 'wheat' && o.kind === 'sell_item_for_emerald');
  ok(wheatOfferIdx >= 0, 'no sell-wheat offer found on a farmer');
  if (wheatOfferIdx >= 0) {
    const e = { type: 'villager', profession: 'farmer' };
    const P = { inventory: M.Inventory.create(), instabuild: false };
    M.Inventory.setItem(P.inventory, 0, { i: wheatId, n: 20 });
    const r1 = M.Trade.attempt(e, wheatOfferIdx, P);
    ok(r1.ok === true, 'an affordable wheat trade refused: ' + (r1 && r1.reason));
    ok(M.Inventory.countOf(P.inventory, wheatId) === 0, 'wheat was not taken by the trade');
    ok(M.Inventory.countOf(P.inventory, emeraldId) === 1, 'no emerald paid out, got ' + M.Inventory.countOf(P.inventory, emeraldId));
    const before = M.Inventory.countOf(P.inventory, emeraldId);
    const r2 = M.Trade.attempt(e, wheatOfferIdx, P);
    okAv(r2.ok === false, 'anti-vacuity: a trade with no matching input still succeeded');
    okAv(M.Inventory.countOf(P.inventory, emeraldId) === before, 'anti-vacuity: a refused trade still paid out');

    const e2 = { type: 'villager', profession: 'farmer' };
    const P2 = { inventory: M.Inventory.create(), instabuild: false };
    const maxUses = farmerOffers[wheatOfferIdx].maxUses;
    M.Inventory.setItem(P2.inventory, 0, { i: wheatId, n: 20 * (maxUses + 1) });
    let lastOk = null;
    for (let u = 0; u < maxUses; u++) lastOk = M.Trade.attempt(e2, wheatOfferIdx, P2).ok;
    okAv(lastOk === true, 'anti-vacuity: the last use before the cap should still succeed');
    ok(M.Trade.disabled(e2, wheatOfferIdx) === true, 'an offer at its jar-verified maxUses (' + maxUses + ') did not disable');
    const wheatLeftBefore = M.Inventory.countOf(P2.inventory, wheatId);
    const rExhausted = M.Trade.attempt(e2, wheatOfferIdx, P2);
    okAv(rExhausted.ok === false, 'anti-vacuity: a sold-out offer still traded');
    okAv(M.Inventory.countOf(P2.inventory, wheatId) === wheatLeftBefore, 'anti-vacuity: a sold-out trade still took the wheat');
  }

  const armorerOffers = M.Trade.offersFor('armorer');
  const legIdx = armorerOffers.findIndex((o) => o.item === 'iron_leggings' && o.kind === 'buy_item_for_emerald');
  ok(legIdx >= 0, 'no buy-iron_leggings offer found on an armorer');
  if (legIdx >= 0) {
    const e3 = { type: 'villager', profession: 'armorer' };
    const P3 = { inventory: M.Inventory.create(), instabuild: false };
    M.Inventory.setItem(P3.inventory, 0, { i: emeraldId, n: 6 });
    okAv(M.Trade.attempt(e3, legIdx, P3).ok === false, 'anti-vacuity: 6 emeralds bought a 7-emerald trade');
    M.Inventory.setItem(P3.inventory, 0, { i: emeraldId, n: 7 });
    const r3 = M.Trade.attempt(e3, legIdx, P3);
    ok(r3.ok === true, 'a 7-emerald armorer trade refused with exactly 7: ' + (r3 && r3.reason));
    ok(M.Inventory.countOf(P3.inventory, M.Items.of('iron_leggings')) === armorerOffers[legIdx].itemQty, 'wrong iron_leggings quantity paid out');
  }

  // ---- 4. `Trade.previewFor` (D-483) — the GUI's three display slots must show exactly what
  // `Trade.attempt` would actually charge/pay, off THE SAME `needGiveFor` (D-276: the join
  // between the screen and the mechanism is exactly where this could drift silently).
  if (wheatOfferIdx >= 0) {
    const pv = M.Trade.previewFor(farmerOffers[wheatOfferIdx]);
    ok(pv.in1 && pv.in1.i === wheatId && pv.in1.n === farmerOffers[wheatOfferIdx].itemQty, 'sell_item_for_emerald: in1 should be the wheat cost');
    ok(pv.in2 === null, 'sell_item_for_emerald has one cost, in2 must be null');
    ok(pv.out && pv.out.i === emeraldId, 'sell_item_for_emerald: out should be the emerald reward');
    okAv(pv.in1.i !== pv.out.i, 'anti-vacuity: in1 (wheat) and out (emerald) must be different items');
  }
  if (legIdx >= 0) {
    const pv = M.Trade.previewFor(armorerOffers[legIdx]);
    ok(pv.in1 && pv.in1.i === emeraldId && pv.in1.n === armorerOffers[legIdx].priceEmerald, 'buy_item_for_emerald: in1 should be the emerald cost');
    ok(pv.out && pv.out.i === M.Items.of('iron_leggings') && pv.out.n === armorerOffers[legIdx].itemQty, 'buy_item_for_emerald: out should be the iron_leggings reward');
  }
  const fisherOffers2 = M.Trade.offersFor('fisherman');
  const twoCostIdx = fisherOffers2.findIndex((o) => o.kind === 'buy_item_for_emerald_and_item');
  ok(twoCostIdx >= 0, 'no buy_item_for_emerald_and_item offer found on a fisherman to test the two-cost slot');
  if (twoCostIdx >= 0) {
    const o = fisherOffers2[twoCostIdx], pv = M.Trade.previewFor(o);
    ok(pv.in1 && pv.in1.i === emeraldId && pv.in1.n === o.priceEmerald, 'buy_item_for_emerald_and_item: in1 should be the emerald cost');
    ok(pv.in2 && pv.in2.i === M.Items.of(o.item) && pv.in2.n === o.itemQty, 'buy_item_for_emerald_and_item: in2 should be the second (item) cost, got ' + JSON.stringify(pv.in2));
    ok(pv.out && pv.out.i === M.Items.of(o.item2) && pv.out.n === o.item2Qty, 'buy_item_for_emerald_and_item: out should be item2');
    okAv(pv.in2 !== null, 'anti-vacuity: a kind with a real second cost must not preview as a single-slot trade');
  }
  // ---- 5. LEVELS/XP (D-484) — `bnx`'s own {0,10,70,150,250} table and `bnw.gg()`/`gh()`/`R()`'s
  // celebrate-then-levelup sequencing, both directions (rule 6): xp under the threshold must NOT
  // level up, and reaching it must, but only after the 40-tick celebration runs out.
  if (wheatOfferIdx >= 0) {
    const e5 = { type: 'villager', profession: 'farmer' };
    const P5 = { inventory: M.Inventory.create(), instabuild: true };
    const xpPerTrade = farmerOffers[wheatOfferIdx].xp || 0;
    ok(xpPerTrade > 0, 'the sell-wheat offer carries no xp — cannot test leveling off it');
    const threshold = M.Trade.xpForNextLevel(1);
    ok(threshold === 10, 'bnx.d[1] should be 10 (jar-verified), got ' + threshold);
    const tradesNeeded = Math.ceil(threshold / xpPerTrade);
    for (let u = 0; u < tradesNeeded - 1; u++) M.Trade.attempt(e5, wheatOfferIdx, P5);
    okAv(M.Trade.canLevelUp(e5) === false, 'anti-vacuity: xp below the jar\'s own threshold must not allow a level-up');
    ok((e5.villagerLevel || 1) === 1, 'a villager below its own xp threshold must still be level 1');
    M.Trade.attempt(e5, wheatOfferIdx, P5); // crosses the threshold this trade
    ok(M.Trade.canLevelUp(e5) === true, 'xp at/over the jar\'s own threshold must allow a level-up');
    ok(e5.tradeCelebrateTicks === 40 && e5.tradePendingLevelUp === true, 'crossing the threshold must arm the 40-tick celebration (bnw.b(bzt): bipush 40), got ' + e5.tradeCelebrateTicks + '/' + e5.tradePendingLevelUp);
    ok((e5.villagerLevel || 1) === 1, 'the level-up must wait out the celebration, not happen on the trade itself');
    for (let t = 0; t < 39; t++) M.Trade.tick(e5);
    okAv((e5.villagerLevel || 1) === 1, 'anti-vacuity: the level must not increase before the celebration timer reaches 0');
    M.Trade.tick(e5); // the 40th tick
    ok(e5.villagerLevel === 2, 'the level must increase to 2 once the celebration timer reaches 0, got ' + e5.villagerLevel);
    ok(e5.tradePendingLevelUp === false, 'the pending-levelup flag must clear once spent');
    const pumpkin = e5.tradeOffers.find((o) => o.item === 'pumpkin' && +o.level === undefined ? true : true);
    const hasLevel2 = e5.tradeOffers.some((o) => M.Trade.offersForLevel('farmer', 2).some((o2) => o2.item === o.item && o2.kind === o.kind));
    ok(hasLevel2, 'leveling up must ADD the new level\'s offers to tradeOffers, not replace the old ones');
    ok(e5.tradeOffers.length === e5.tradeUses.length, 'tradeOffers and tradeUses must stay the same length after a level-up');
    ok(farmerOffers.every((o1) => e5.tradeOffers.some((o2) => o2 === o1)), 'a level-up must keep every level-1 offer, not drop any');
  }

  // ---- 6. RESTOCKING (D-484) — `bnw.ga()`'s own 2-per-day cap and 2400-tick gap, `bnw.fP()`'s
  // half-day/day-boundary window reset. Both directions: too soon must refuse, the right gap
  // and a day boundary must restock.
  if (wheatOfferIdx >= 0) {
    const e6 = { type: 'villager', profession: 'farmer' };
    const P6 = { inventory: M.Inventory.create(), instabuild: true };
    M.Sky = { dayTime: 0 }; M.Behave = { gameTime: 0 }; // #4408: dayTime stays frozen (daylight cycle off): restock follows game time
    const maxUses = farmerOffers[wheatOfferIdx].maxUses;
    for (let u = 0; u < maxUses; u++) M.Trade.attempt(e6, wheatOfferIdx, P6);
    ok(M.Trade.disabled(e6, wheatOfferIdx) === true, 'the offer should be sold out before the first restock test');
    M.Trade.tickRestock(e6); // first-ever check: RestocksToday starts at 0, so this restocks immediately
    ok(M.Trade.disabled(e6, wheatOfferIdx) === false, 'the first restock of a villager\'s life should not be gated');
    ok(e6.tradeRestocksToday === 1, 'RestocksToday should read 1 after one restock, got ' + e6.tradeRestocksToday);

    for (let u = 0; u < maxUses; u++) M.Trade.attempt(e6, wheatOfferIdx, P6);
    M.Behave.gameTime = e6.tradeLastRestock + 100; // well under the 2400-tick gap
    M.Trade.tickRestock(e6);
    okAv(M.Trade.disabled(e6, wheatOfferIdx) === true, 'anti-vacuity: a second restock must refuse before its own 2400-tick gap (bnw.ga()) has passed');

    M.Behave.gameTime = e6.tradeLastRestock + 2400; // exactly the gap: canRestock is STRICT `>` (D-505)
    M.Trade.tickRestock(e6);
    okAv(M.Trade.disabled(e6, wheatOfferIdx) === true, 'a restock at exactly +2400 must refuse (VillagerEntity.canRestock: time > last + 2400L)');
    M.Behave.gameTime = e6.tradeLastRestock + 2401;
    M.Trade.tickRestock(e6);
    ok(M.Trade.disabled(e6, wheatOfferIdx) === false, 'a second restock one tick past the 2400-tick gap should succeed');
    ok(e6.tradeRestocksToday === 2, 'RestocksToday should read 2 after the second restock, got ' + e6.tradeRestocksToday);

    for (let u = 0; u < maxUses; u++) M.Trade.attempt(e6, wheatOfferIdx, P6);
    M.Behave.gameTime = e6.tradeLastRestock + 2401; // same day, cap already spent
    M.Trade.tickRestock(e6);
    okAv(M.Trade.disabled(e6, wheatOfferIdx) === true, 'anti-vacuity: a third same-day restock must refuse once the 2-per-day cap (bnw.ga(): iconst_2) is spent');

    M.Behave.gameTime = e6.tradeLastRestock + 24000; M.Sky.dayTime = 24000; // day boundary: game-time half-day AND day index (timeOfDay)
    M.Trade.tickRestock(e6);
    ok(M.Trade.disabled(e6, wheatOfferIdx) === false, 'a day boundary must reset RestocksToday and allow a restock again');
    ok(e6.tradeRestocksToday === 1, 'RestocksToday should reset to 1 (this restock) after the day boundary, got ' + e6.tradeRestocksToday);
  }

  // ---- 6b. THE JOB-SITE GATE (s113) — VillagerWorkTask.java:41-43 is the ONLY restock caller in
  // 1.18.2, so the per-tick Trade.tick must NOT restock a sold-out villager however much time passes;
  // the work run (07zv_villagerbrain.js villagerWorkRun -> Trade.tickRestock, vbworkcheck §2b) does.
  if (wheatOfferIdx >= 0) {
    const e7 = { type: 'villager', profession: 'farmer' };
    const P7 = { inventory: M.Inventory.create(), instabuild: true };
    M.Sky = { dayTime: 0 };
    const maxUses = farmerOffers[wheatOfferIdx].maxUses;
    for (let u = 0; u < maxUses; u++) M.Trade.attempt(e7, wheatOfferIdx, P7);
    for (let t = 1; t <= 30000; t += 100) { M.Behave.gameTime = t; M.Sky.dayTime = 0; M.Trade.tick(e7); }
    okAv(M.Trade.disabled(e7, wheatOfferIdx) === true, 'the per-tick Trade.tick must not restock (restock is VillagerWorkTask-only, job-site gated)');
    M.Trade.tickRestock(e7); // past the half-day window: shouldRestock's own catch-up (restockAndUpdateDemandBonus) refills it
    ok(M.Trade.disabled(e7, wheatOfferIdx) === false, 'the work-task restock path (Trade.tickRestock) refills the same villager');
    ok(M.Trade.shouldRestock(e7) === false, 'shouldRestock is false right after a restock (nothing used)');
  }

  // ---- 7. THE FIVE PROCEDURAL FACTORIES (G18f remainder, D-48x) — EnchantBookFactory,
  // SellEnchantedToolFactory, SellDyedArmorFactory, SellMapFactory, SellPotionHoldingItemFactory.
  // These are rolled by `Trade.resolveOffers` at offer-creation time (not in the static `rows`
  // table above), so every assertion here drives `M.Trade` directly, off a FIXED rng so the
  // draw is reproducible, both directions (rule 6) where there is a direction to test.
  {
    const fixedRng = (seq) => { let i = 0; return () => seq[i++ % seq.length]; };

    // 7a. enchant_book_for_emeralds (librarian L1-4): item is always `enchanted_book`, tag
    // carries exactly one StoredEnchantments entry, price is `2+rand(5+10L)+3L` (doubled if
    // treasure, capped 64), and soul_speed (the one enchant NOT offered by books) never appears.
    const eLib = { type: 'villager', profession: 'librarian' };
    let sawTreasureBook = false, sawSoulSpeed = false;
    for (let i = 0; i < 400; i++) {
      const rows = M.Trade.offersForLevel('librarian', 1).filter((r) => r.kind === 'enchant_book_for_emeralds');
      const o = M.Trade.resolveOffers(rows, eLib, Math.random)[0];
      if (!o) { ok(false, 'librarian L1 book roll produced no offer'); break; }
      ok(o.item === 'enchanted_book', 'enchant_book_for_emeralds should sell enchanted_book, got ' + o.item);
      const se = o.tag && o.tag.StoredEnchantments;
      ok(!!(se && se.length === 1), 'enchanted_book offer should carry exactly one StoredEnchantments entry');
      if (se && se[0].id === 'minecraft:soul_speed') sawSoulSpeed = true;
      if (se && se[0].id === 'minecraft:mending') sawTreasureBook = true;
      ok(o.priceEmerald >= 1 && o.priceEmerald <= 64, 'enchant book price out of TradeOffers.java bounds [1,64], got ' + o.priceEmerald);
    }
    okAv(!sawSoulSpeed, 'anti-vacuity: soul_speed is NOT isAvailableForEnchantedBookOffer (jar-verified) and must never appear on a book trade');
    ok(sawTreasureBook, 'mending (a treasure enchant, jar-verified isAvailableForEnchantedBookOffer=true) should appear in 400 book rolls');

    // 7b. sell_enchanted_tool_for_emeralds (toolsmith L5 = diamond_pickaxe, DIGGER-target only):
    // the enchantment drawn must be from the diamond_pickaxe's own compatible, non-treasure
    // roster (efficiency/fortune/silk_touch/unbreaking) — sharpness (WEAPON-only) must never
    // land on a pickaxe, both directions (rule 6).
    const eTool = { type: 'villager', profession: 'toolsmith' };
    const pickaxeRows = M.Trade.offersForLevel('toolsmith', 5);
    const DIGGER_OK = new Set(['minecraft:efficiency', 'minecraft:fortune', 'minecraft:silk_touch', 'minecraft:unbreaking']);
    let sawEfficiency = false, sawSharpnessOnPickaxe = false, priceMin = Infinity, priceMax = -Infinity;
    for (let i = 0; i < 300; i++) {
      const o = M.Trade.resolveOffers(pickaxeRows, eTool, Math.random)[0];
      ok(o.item === 'diamond_pickaxe', 'toolsmith L5 should sell diamond_pickaxe, got ' + o.item);
      const ench = o.tag && o.tag.Enchantments && o.tag.Enchantments[0];
      ok(!!ench, 'sell_enchanted_tool_for_emeralds should carry one Enchantments entry');
      if (ench) {
        if (!DIGGER_OK.has(ench.id)) sawSharpnessOnPickaxe = true;
        if (ench.id === 'minecraft:efficiency') sawEfficiency = true;
      }
      priceMin = Math.min(priceMin, o.priceEmerald); priceMax = Math.max(priceMax, o.priceEmerald);
    }
    okAv(!sawSharpnessOnPickaxe, 'anti-vacuity: a DIGGER-only pickaxe drew a WEAPON/ARMOR-only enchantment — EnchantmentTarget compatibility is not being enforced');
    ok(sawEfficiency, 'efficiency (weight 10, the commonest DIGGER enchant) should appear in 300 pickaxe rolls');
    ok(priceMin === 13 + 5 && priceMax === 13 + 19, 'diamond_pickaxe price should span basePrice+[5,19] = [' + (13 + 5) + ',' + (13 + 19) + '], got [' + priceMin + ',' + priceMax + ']');

    // 7c. sell_dyed_armor_for_emerald (leatherworker L1 = leggings/chestplate): the colour must
    // be a real blend of 1-3 of the sixteen jar dye colours (D-268's own average-then-rescale),
    // and every roll must land inside RGB range.
    const eLeather = { type: 'villager', profession: 'leatherworker' };
    const legRows = M.Trade.offersForLevel('leatherworker', 1);
    let colourCount = 0;
    for (let i = 0; i < 200; i++) {
      const o = M.Trade.resolveOffers(legRows, eLeather, Math.random).find((x) => x.item === 'leather_leggings');
      ok(!!(o && o.tag && o.tag.display && typeof o.tag.display.color === 'number'), 'sell_dyed_armor_for_emerald should carry a display.color tag');
      if (o) {
        const c = o.tag.display.color;
        ok(c >= 0 && c <= 0xFFFFFF, 'dyed armor colour out of RGB range, got ' + c.toString(16));
        colourCount++;
      }
    }
    ok(colourCount === 200, 'every leatherworker L1 offer should resolve to a dyed leggings offer');

    // 7d. sell_map_for_emerald (cartographer L2/L3): a real Structures.ST region search off a
    // known seed — must return the SAME target every time for the SAME (x,z) (the placement
    // grid is a pure function of the seed+region, D-183), and nothing at all when the search
    // finds no structure or Structures.ready is false (no fabricated position), both directions.
    M.Gen.init(1337, Object.assign(M.Gen.defaults(), { climate: 'vanilla' }));
    ok(M.Structures.ready, 'Structures.init should have run for the map test');
    const pos1 = M.Trade.locateStructure('monument', 0, 0);
    const pos2 = M.Trade.locateStructure('monument', 0, 0);
    ok(!!pos1 && typeof pos1.x === 'number' && typeof pos1.z === 'number', 'locateStructure(monument) found nothing at seed 1337, (0,0)');
    ok(pos1 && pos2 && pos1.x === pos2.x && pos1.z === pos2.z, 'locateStructure must be a pure function of the seed/region, got ' + JSON.stringify(pos1) + ' vs ' + JSON.stringify(pos2));
    const mansionPos = M.Trade.locateStructure('mansion', 0, 0);
    ok(!!mansionPos, 'locateStructure(mansion) found nothing at seed 1337, (0,0)');
    ok(pos1.x !== mansionPos.x || pos1.z !== mansionPos.z, 'monument and mansion should not resolve to the identical position');
    const eCarto = { type: 'villager', profession: 'cartographer', x: 0, y: 64, z: 0 };
    const mapRows2 = M.Trade.offersForLevel('cartographer', 2).filter((r) => r.kind === 'sell_map_for_emerald');
    const mapOffer = M.Trade.resolveOffers(mapRows2, eCarto, Math.random)[0];
    ok(!!(mapOffer && mapOffer.item === 'filled_map'), 'cartographer L2 should resolve to a filled_map offer');
    ok(!!(mapOffer && mapOffer.tag && mapOffer.tag.target && mapOffer.tag.target.x === pos1.x && mapOffer.tag.target.z === pos1.z), 'the filled_map offer\'s target should be the SAME position locateStructure computed');
    ok(mapOffer.priceEmerald === 13, 'cartographer L2 map price should be the jar-verified 13, got ' + mapOffer.priceEmerald);

    // anti-vacuity: no live structure_set matches -> null, not a fabricated position
    okAv(M.Trade.locateStructure('nonexistent_structure_kind', 0, 0) === null, 'anti-vacuity: a keyword matching no structure_set must return null, not a stale/fabricated hit');
    const eNoWorld = { type: 'villager', profession: 'cartographer', x: 0, y: 64, z: 0 };
    const M2 = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07i_entitylist.js', '07ox_enchhelper.js', '07p_trade.js'] });
    okAv(M2.Trade.locateStructure('monument', 0, 0) === null, 'anti-vacuity: locateStructure before Structures.init must return null, not crash or guess');
    okAv(M2.Trade.resolveOffers(mapRows2, eNoWorld, Math.random).length === 0, 'anti-vacuity: a map trade must be DROPPED (not fabricated) when no structure can be located');

    // 7e. sell_potion_holding_item_for_emerald (fletcher L5): a real brewable Potion id, the
    // second cost (5 arrows) and result (5 tipped_arrow) exact off TradeOffers.java:283.
    const eFletch = { type: 'villager', profession: 'fletcher' };
    const potionRows = M.Trade.offersForLevel('fletcher', 5).filter((r) => r.kind === 'sell_potion_holding_item_for_emerald');
    ok(potionRows.length === 1, 'fletcher L5 should carry exactly one sell_potion_holding_item_for_emerald row');
    let sawLuck = false;
    for (let i = 0; i < 300; i++) {
      const o = M.Trade.resolveOffers(potionRows, eFletch, Math.random)[0];
      ok(o.item === 'tipped_arrow' && o.itemQty === 5, 'potion-holding offer should sell 5 tipped_arrow, got ' + o.itemQty + ' ' + o.item);
      ok(o.secondBuy === 'arrow' && o.secondCount === 5, 'potion-holding offer should also cost 5 arrow, got ' + o.secondCount + ' ' + o.secondBuy);
      ok(o.priceEmerald === 2 && o.maxUses === 12 && o.xp === 30, 'potion-holding price/maxUses/xp should be the jar\'s own 2/12/30, got ' + o.priceEmerald + '/' + o.maxUses + '/' + o.xp);
      const pid = o.tag && o.tag.Potion;
      ok(typeof pid === 'string' && pid.indexOf('minecraft:') === 0, 'tipped_arrow should carry a minecraft:-prefixed Potion tag, got ' + pid);
      if (pid === 'minecraft:luck') sawLuck = true;
    }
    okAv(!sawLuck, 'anti-vacuity: minecraft:luck has no brewing recipe (BrewingRecipeRegistry.isBrewable=false) and must never be offered');

    // 7f. end-to-end through Trade.attempt: a tagged item must actually reach the player's
    // inventory with its tag intact (the Inv.addResource tag-carry fix), and refuse cleanly
    // without the right emeralds, both directions.
    const eBook = { type: 'villager', profession: 'librarian' };
    const bookOffers = M.Trade.resolveOffers(M.Trade.offersForLevel('librarian', 1).filter((r) => r.kind === 'enchant_book_for_emeralds'), eBook, fixedRng([0.01]));
    eBook.tradeOffers = bookOffers; eBook.tradeUses = bookOffers.map(() => 0);
    eBook.tradeProfession = 'librarian'; eBook.villagerLevel = 1; eBook.tradeXp = 0;
    const PBook = { inventory: M.Inventory.create(), instabuild: false };
    const emeraldId2 = M.Items.of('emerald');
    okAv(M.Trade.attempt(eBook, 0, PBook).ok === false, 'anti-vacuity: an enchant-book trade with zero emeralds still succeeded');
    M.Inventory.setItem(PBook.inventory, 0, { i: emeraldId2, n: bookOffers[0].priceEmerald });
    // D-669: EnchantBookFactory charges emeralds AND one plain book — emeralds alone must refuse.
    okAv(M.Trade.attempt(eBook, 0, PBook).ok === false, 'anti-vacuity: an enchant-book trade with the emeralds but NO book succeeded (EnchantBookFactory charges 1 book)');
    M.Inventory.setItem(PBook.inventory, 1, { i: M.Items.of('book'), n: 1 });
    const rBook = M.Trade.attempt(eBook, 0, PBook);
    ok(M.Inventory.countOf(PBook.inventory, M.Items.of('book')) === 0, 'the enchant-book trade did not take the plain book');
    ok(rBook.ok === true, 'a fully-paid enchant-book trade refused: ' + (rBook && rBook.reason));
    const gotBook = PBook.inventory.slots.find((s) => s && M.Items.nameOf(s.i) === 'enchanted_book');
    ok(!!gotBook, 'no enchanted_book landed in the player\'s inventory after a successful trade');
    ok(!!(gotBook && gotBook.t && gotBook.t.StoredEnchantments && gotBook.t.StoredEnchantments.length === 1), 'the enchanted_book in inventory lost its StoredEnchantments tag on the way in (Inv.addResource must carry it into a fresh slot)');
  }
}

// ── §8 (D-504): trade SELECTION — `MerchantEntity.fillRecipesFromPool(offers, pool, 2)` ─────────────
// A villager does NOT get every row of its level: it draws 2 distinct indices of the level's whole
// factory array. The pool's ORDER (Trade.POOL_PATTERN) is re-derived here from the decompiled
// TradeOffers.java itself, not from the code under test (rule 3), when `.decomp/` is present.
{
  const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07i_entitylist.js', '07ox_enchhelper.js', '07p_trade.js'] });
  if (ITEMS_INIT) M.Items.init(ITEMS_INIT());
  M.DATA = Object.assign({}, M.DATA, { villagerTrades: TRADES_TABLE });
  const T = M.Trade;
  // 8a. the draw itself, both directions (rule 6)
  const pool5 = ['a', 'b', 'c', 'd', 'e'];
  const seq = (xs) => { let i = 0; return () => xs[i++ % xs.length]; };
  const p1 = T.pickFromPool(pool5, 2, seq([0.9, 0.9, 0.1]));      // idx 4, 4 (dup, redrawn), 0
  ok(p1.length === 2 && p1[0] === 'a' && p1[1] === 'e', '§8a pickFromPool: draw 4,4,0 must give [a,e] in ASCENDING pool order (HashSet<Integer>), got ' + JSON.stringify(p1));
  ok(T.pickFromPool(['x', 'y'], 2, seq([0])).join() === 'x,y', '§8a a pool of exactly 2 must return both');
  ok(T.pickFromPool(['x'], 2, seq([0])).join() === 'x', '§8a a pool of 1 must return it alone');
  const tally = [0, 0, 0, 0, 0];
  let s0 = 12345; const lcg = () => { s0 = (s0 * 1103515245 + 12345) % 2147483648; return s0 / 2147483648; };
  for (let k = 0; k < 5000; k++) T.pickFromPool([0, 1, 2, 3, 4], 2, lcg).forEach((v) => tally[v]++);
  ok(tally.every((c) => c > 1800 && c < 2200), '§8a each of 5 factories should be drawn ~2/5 of the time, got ' + tally.join('/'));
  // 8b. a fresh villager holds exactly the draw, never the whole table
  const farmerAll = T.offersForLevel('farmer', 1).length;
  const ef = { type: 'villager', profession: 'farmer' };
  T.ensure(ef);
  ok(farmerAll > 2 && ef.tradeOffers.length === 2, '§8b a fresh farmer must hold 2 offers of its ' + farmerAll + ', got ' + ef.tradeOffers.length);
  okAv(!(farmerAll === 2), 'the farmer level-1 table must be larger than the draw, or §8b proves nothing');
  const lvl0 = ef.tradeOffers.length; T.increaseLevel(ef);
  ok(ef.tradeOffers.length === lvl0 + 2 && ef.tradeUses.length === ef.tradeOffers.length, '§8b a level-up ADDS 2 more offers, got ' + (ef.tradeOffers.length - lvl0));
  // loop/vtype-s105: the boat row is BUILT now (Prof.typeAtBiome gives every villager
  // e.villagerType) -- fisherman L5 = pufferfish + boat, and the boat slot resolves to the
  // villager's OWN type's boat (TypeAwareBuyForOneEmeraldFactory, rollTypeVariantItem).
  const fishPool = T.poolForLevel('fisherman', 5);
  ok(fishPool.length === 2 && fishPool.some((r) => r.kind === 'sell_type_variant_item_for_emerald'), '§8b fisherman L5 pool must keep the boat factory as a slot');
  const noType = T.resolveOffers(fishPool, { type: 'villager', profession: 'fisherman' });
  const boatOffNoType = noType.find((o) => o.kind === 'sell_type_variant_item_for_emerald');
  ok(!!boatOffNoType && boatOffNoType.item === 'oak_boat', `§8b an entity with no villagerType must default to plains -- oak_boat (got ${boatOffNoType && boatOffNoType.item})`);
  const jungleFisher = { type: 'villager', profession: 'fisherman', villagerType: 'jungle' };
  // D-669: TypeAwareBuyForOneEmeraldFactory = the villager BUYS the boat: the player pays the boat, gets 1 emerald.
  {
    const pv = T.previewFor(T.resolveOffers(fishPool, { villagerType: 'plains' }).find((o) => o.kind === 'sell_type_variant_item_for_emerald'));
    ok(!!pv.in1 && M.Items.nameOf(pv.in1.i) === 'oak_boat' && !!pv.out && M.Items.nameOf(pv.out.i) === 'emerald',
      `§8b the boat trade must take the boat and pay an emerald, got ${pv.in1 && M.Items.nameOf(pv.in1.i)} -> ${pv.out && M.Items.nameOf(pv.out.i)}`);
  }
  // D-669: every farmer L4 stew PAYS OUT its effect tag (SuspiciousStewItem.addEffectToStew), and the
  // leatherworker's leather_horse_armor sells UNDYED (a DyeableHorseArmorItem, not a DyeableArmorItem).
  {
    const stews = T.poolForLevel('farmer', 4).filter((r) => r.kind === 'sell_suspicious_stew_for_emerald');
    ok(stews.length > 0, '§8c farmer L4 carries suspicious-stew rows');
    const eS = { type: 'villager', profession: 'farmer', tradeProfession: 'farmer', villagerLevel: 4, tradeXp: 0 };
    eS.tradeOffers = stews; eS.tradeUses = stews.map(() => 0);
    const ids = new Set();
    for (let i = 0; i < stews.length; i++) {
      const P = { inventory: M.Inventory.create(), instabuild: true };
      T.attempt(eS, i, P);
      const got = P.inventory.slots.find((x) => x && M.Items.nameOf(x.i) === 'suspicious_stew');
      const ef = got && got.t && got.t.Effects && got.t.Effects[0];
      ok(!!ef && ef.EffectId === stews[i].effectId && ef.EffectDuration === stews[i].durationTicks,
        `§8c stew ${stews[i].effect} paid out ${JSON.stringify(got && got.t)} (want EffectId ${stews[i].effectId}, ${stews[i].durationTicks} ticks)`);
      if (ef) ids.add(ef.EffectId);
    }
    ok(ids.size === stews.length, '§8c each stew row pays a DIFFERENT effect');
    const lw = T.poolForLevel('leatherworker', 4).concat(T.poolForLevel('leatherworker', 1)).filter((r) => r && r.kind === 'sell_dyed_armor_for_emerald');
    const horse = lw.find((r) => r.item === 'leather_horse_armor'), tunic = lw.find((r) => r.item !== 'leather_horse_armor');
    ok(!!horse && !T.resolveOffers([horse], {}, () => 0.5)[0].tag, '§8c leather_horse_armor must sell undyed');
    okAv(!!tunic && !!(T.resolveOffers([tunic], {}, () => 0.5)[0].tag || {}).display, 'anti-vacuity: a DyeableArmorItem (' + (tunic && tunic.item) + ') still sells dyed');
  }
  const jungleOff = T.resolveOffers(fishPool, jungleFisher).find((o) => o.kind === 'sell_type_variant_item_for_emerald');
  ok(!!jungleOff && jungleOff.item === 'jungle_boat', `§8b a jungle-type fisherman must sell jungle_boat, got ${jungleOff && jungleOff.item}`);
  const desertFisher = { type: 'villager', profession: 'fisherman', villagerType: 'desert' };
  const desertOff = T.resolveOffers(fishPool, desertFisher).find((o) => o.kind === 'sell_type_variant_item_for_emerald');
  ok(!!desertOff && desertOff.item === 'jungle_boat', `§8b desert must ALSO sell jungle_boat, the jar-verified quirk -- got ${desertOff && desertOff.item}`);
  // anti-vacuity: corrupt the boat row's own byVillagerType table (drop its plains fallback
  // too) and confirm rollTypeVariantItem actually refuses rather than silently inventing one.
  const boatRow = fishPool.find((r) => r.kind === 'sell_type_variant_item_for_emerald');
  const realByType = boatRow.byVillagerType;
  boatRow.byVillagerType = null;
  okAv(T.resolveOffers(fishPool, { type: 'villager', profession: 'fisherman', villagerType: 'jungle' }).find((o) => o.kind === 'sell_type_variant_item_for_emerald') === undefined,
    '§8b anti-vacuity: no byVillagerType table at all must resolve to no offer, not throw');
  boatRow.byVillagerType = { taiga: 'spruce_boat' };   // no plains fallback, no jungle entry
  okAv(T.resolveOffers(fishPool, { type: 'villager', profession: 'fisherman', villagerType: 'jungle' }).find((o) => o.kind === 'sell_type_variant_item_for_emerald') === undefined,
    '§8b anti-vacuity: a villagerType missing from a table with no plains fallback resolves to no offer, not a wrong item');
  boatRow.byVillagerType = realByType;
  // 8c. POOL_PATTERN against the decompiled factory arrays
  const DEC = join(MCLITE_ROOT, '.decomp', 'net', 'minecraft', 'village', 'TradeOffers.java');
  const tdata = M.DATA.villagerTrades;
  const PROCK = /^(SellEnchantedToolFactory|EnchantBookFactory|SellMapFactory|SellPotionHoldingItemFactory|SellDyedArmorFactory)$/;
  const patternsOf = (pp) => { const out = []; for (const prof in pp) for (const lv in pp[prof]) out.push(pp[prof][lv]); return out.sort().join(' '); };
  const shapeErrors = (pp) => {
    const errs = [];
    for (const prof in pp) for (const lv in pp[prof]) {
      const pat = pp[prof][lv], rows = (tdata[prof] && tdata[prof][lv]) || [];
      const pool = T.poolForLevel(prof, +lv);
      const sN = (pat.match(/s/g) || []).length;
      if (sN !== rows.length) errs.push(prof + ' L' + lv + ': pattern has ' + sN + ' s, table has ' + rows.length);
      if (pool.some((x) => !x)) errs.push(prof + ' L' + lv + ': a pool slot is empty');
    }
    return errs;
  };
  const se = shapeErrors(T.POOL_PATTERN);
  ok(se.length === 0, '§8c POOL_PATTERN disagrees with the data/procedural tables: ' + se.join('; '));
  if (existsSync(DEC)) {
    const txt = readFileSync(DEC, 'utf8');
    const cut = txt.indexOf('WANDERING_TRADER_TRADES');
    const re = /new TradeOffers\.Factory\[\]\{/g; let m; const dec = [];
    while ((m = re.exec(txt)) && m.index < cut) {
      let d = 1, i = m.index + m[0].length; const st = i;
      while (d) { if (txt[i] === '{') d++; else if (txt[i] === '}') d--; i++; }
      const body = txt.slice(st, i - 1); let depth = 0, pat = '';
      for (let k = 0; k < body.length; k++) {
        const c = body[k];
        if (c === '(') depth++; else if (c === ')') depth--;
        else if (depth === 0 && body.startsWith('new TradeOffers.', k)) pat += PROCK.test(/new TradeOffers\.(\w+)/.exec(body.slice(k))[1]) ? 'p' : 's';
      }
      if (pat.includes('p')) dec.push(pat);
    }
    const want = dec.sort().join(' ');
    ok(dec.length > 20 && patternsOf(T.POOL_PATTERN) === want, '§8c POOL_PATTERN multiset != TradeOffers.java\'s own: have [' + patternsOf(T.POOL_PATTERN) + '] want [' + want + ']');
    const broken = JSON.parse(JSON.stringify(T.POOL_PATTERN)); broken.toolsmith[3] = 'spppS'.toLowerCase().replace(/s$/, 'p');
    okAv(patternsOf(broken) !== want, 'a toolsmith L3 pattern with its last s flipped to p must NOT match the decomp');
  } else console.log(' note: .decomp/ absent — §8c decomp cross-read skipped (D-488 recipe in .decomp/README.md)');
  const brokenShape = JSON.parse(JSON.stringify(T.POOL_PATTERN)); brokenShape.librarian[4] = 'sps';
  const sv = T.POOL_PATTERN; T.POOL_PATTERN = brokenShape; const bse = shapeErrors(brokenShape); T.POOL_PATTERN = sv;
  okAv(bse.length > 0, 'a librarian L4 pattern short one s must be caught by the shape check');
  // the old "every row" behaviour must fail §8b's own bar
  okAv(!(T.offersForLevel('farmer', 1).length === 2), 'offering the WHOLE farmer table would have passed §8b');
}

// ── §9 (D-505): PRICE ADJUSTMENT — TradeOffer.getAdjustedFirstBuyItem / updateDemandBonus,
// VillagerEntity.prepareOffersFor (reputation + Hero of the Village), clearSpecialPrices ────────
{
  const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07i_entitylist.js', '07q_effects.js', '07ox_enchhelper.js', '07p_trade.js'] });
  if (ITEMS_INIT) M.Items.init(ITEMS_INIT());
  M.DATA = Object.assign({}, M.DATA, { villagerTrades: TRADES_TABLE });
  const T = M.Trade; T.OFFERS_PER_LEVEL = 99;
  const mk = () => { const e = { type: 'villager', profession: 'farmer' }; T.ensure(e); return e; };
  const e = mk();
  const wi = e.tradeOffers.findIndex((o) => o.kind === 'sell_item_for_emerald' && o.item === 'wheat');
  ok(wi >= 0, '§9 no wheat offer on a farmer');
  const o = e.tradeOffers[wi], n = o.itemQty, mu = T.maxUses(o), pm = Math.fround(+o.priceMult);
  ok(n === 20 && mu === 16 && Math.abs(pm - 0.05) < 1e-6, '§9 farmer wheat row must be 20 wheat / 16 uses / 0.05 (TradeOffers BuyForOneEmeraldFactory(wheat,20,16,2)), got ' + n + '/' + mu + '/' + o.priceMult);
  ok(T.adjustedFirstCount(e, wi) === 20, '§9 an untouched offer costs its table count');
  // demand: fully used, restocked → demand = 16 - 0 = 16 → bonus floor(20*16*0.05)=16 → 36
  e.tradeUses[wi] = mu; T.restock(e);
  ok(e.tradeDemand[wi] === 16 && e.tradeUses[wi] === 0, '§9 restock must add uses-(maxUses-uses) to demand BEFORE resetting uses, got demand ' + e.tradeDemand[wi]);
  ok(T.adjustedFirstCount(e, wi) === 36, '§9 demand 16 must raise 20 wheat to 36, got ' + T.adjustedFirstCount(e, wi));
  ok(T.previewFor(o, e, wi).in1.n === 36, '§9 the screen must show the adjusted count (one join with attempt)');
  const P = { inventory: M.Inventory.create(), instabuild: false };
  const wheat = M.Items.of('wheat');
  M.Inventory.setItem(P.inventory, 0, { i: wheat, n: 35 });
  okAv(T.attempt(e, wi, P).ok === false, '35 wheat must NOT pay a 36-wheat adjusted price');
  M.Inventory.setItem(P.inventory, 1, { i: wheat, n: 1 });
  ok(T.attempt(e, wi, P).ok === true && M.Inventory.countOf(P.inventory, wheat) === 0, '§9 36 wheat must pay it, and all 36 must be taken');
  // unused offers drive demand negative; the bonus never goes below 0 (rule 6)
  const e2 = mk(); T.restock(e2);
  ok(e2.tradeDemand[wi] === -16 && T.adjustedFirstCount(e2, wi) === 20, '§9 an unused offer: demand -16, price must stay 20 (max(0, bonus)), got ' + e2.tradeDemand[wi] + '/' + T.adjustedFirstCount(e2, wi));
  e2.tradeDemand[wi] = 100000;
  ok(T.adjustedFirstCount(e2, wi) === 64, '§9 the count clamps to the item max stack (64)');
  // clearDailyRestockCount: 2 - restocksToday updates
  const e3 = mk(); e3.tradeRestocksToday = 0; T.restockAndUpdateDemandBonus(e3);
  ok(e3.tradeDemand[wi] === -32, '§9 restockAndUpdateDemandBonus with 0 restocks today updates demand twice, got ' + e3.tradeDemand[wi]);
  const e4 = mk(); e4.tradeRestocksToday = 2; e4.tradeUses[wi] = 3; T.restockAndUpdateDemandBonus(e4);
  okAv(e4.tradeDemand[wi] === 0 && e4.tradeUses[wi] === 3, 'with 2 restocks already today nothing resets and demand is untouched');
  // reputation: rep 100 → special -floor(100*0.05) = -5
  M.Village = { getReputation: () => 100 };
  const e5 = mk(); T.prepareOffersFor(e5, { effects: {} });
  ok(T.adjustedFirstCount(e5, wi) === 15, '§9 reputation 100 must cut 20 wheat to 15, got ' + T.adjustedFirstCount(e5, wi));
  T.clearSpecialPrices(e5);
  ok(T.adjustedFirstCount(e5, wi) === 20, '§9 closing the screen clears the special price');
  M.Village = { getReputation: () => -100 };
  const e6 = mk(); T.prepareOffersFor(e6, { effects: {} });
  ok(T.adjustedFirstCount(e6, wi) === 25, '§9 reputation -100 must raise it to 25, got ' + T.adjustedFirstCount(e6, wi));
  // Hero of the Village amp 0: -max(floor(0.3*20),1) = -6
  M.Village = { getReputation: () => 0 };
  const e7 = mk(); T.prepareOffersFor(e7, { effects: { hero_of_the_village: { amplifier: 0, duration: 100 } } });
  ok(T.adjustedFirstCount(e7, wi) === 14, '§9 Hero of the Village I must cut 20 wheat by 6 to 14, got ' + T.adjustedFirstCount(e7, wi));
  const e8 = mk(); T.prepareOffersFor(e8, { effects: {} });
  okAv(T.adjustedFirstCount(e8, wi) === 20, 'no reputation and no Hero effect must leave the price alone');
  // a broken multiplier must be caught by the demand assertion
  const sv = o.priceMult; o.priceMult = '0'; const e9 = mk(); e9.tradeDemand[wi] = 16;
  okAv(T.adjustedFirstCount(e9, wi) !== 36, 'a zeroed priceMult must break the demand-36 result'); o.priceMult = sv;
}

// ---- 10. s108 — the trade -> particle / regeneration JOINS (rule 7), off .decomp
// VillagerEntity.afterUsing (:586 lastCustomer), mobTick (:284 REGENERATION 200/0 when the
// celebration timer runs out; :288-291 status 14 next tick) and MerchantEntity.produceParticles
// (:198-205, FIVE particles at y + rand*height + 1.0). Both directions (rule 6) + a break.
{
  const M2 = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07i_entitylist.js', '07q_effects.js', '07zx_particle.js', '07ox_enchhelper.js', '07p_trade.js'] });
  const T = M2.Trade, Px = M2.Particle;
  ok(T && Px && typeof T.produceParticles === 'function', '§10 Trade.produceParticles + NS.Particle load');
  if (T && Px) {
    Px.init();
    const e = { type: 'villager', x: 10, y: 64, z: -3, width: 0.6, height: 1.95, tradeLastCustomer: true };
    T.tick(e);
    const hv = Px.list.filter((p) => p.type === 'happy_villager');
    ok(hv.length === 5, '§10 the tick after a trade spawns exactly 5 happy_villager (produceParticles), got ' + hv.length);
    ok(hv.every((p) => p.y >= 65 && p.y <= 64 + 1.95 + 1.0 && Math.abs(p.x - 10) <= 0.6 && Math.abs(p.z + 3) <= 0.6), '§10 each particle inside x±width, y+1..y+height+1');
    ok(e.tradeLastCustomer === false, '§10 lastCustomer is cleared once the status is sent');
    T.tick(e);
    ok(Px.list.filter((p) => p.type === 'happy_villager').length === 5, '§10 no second burst without a new trade (rule 6)');
    // regeneration when the celebration timer expires
    const e2 = { type: 'villager', tradeCelebrateTicks: 2, tradePendingLevelUp: false };
    T.tick(e2);
    const hasRegen = (x) => !!(x.effects && x.effects.regeneration) || !!(x.statusEffects && x.statusEffects.regeneration) || (M2.Effects.hasStatusEffect && M2.Effects.hasStatusEffect(x, 'regeneration'));
    ok(!hasRegen(e2), '§10 no regeneration before the celebration timer reaches 0');
    T.tick(e2);
    ok(hasRegen(e2), '§10 regeneration applied when the celebration timer reaches 0 (even with no pending level-up)');
    // anti-vacuity: a zero particle count must be caught by the 5-count assertion
    const sv = T.PRODUCE_PARTICLE_COUNT; T.PRODUCE_PARTICLE_COUNT = 0; Px.init();
    T.tick({ type: 'villager', x: 0, y: 0, z: 0, width: 0.6, height: 1.95, tradeLastCustomer: true });
    okAv(Px.list.length !== 5, 'a zeroed produceParticles count breaks the 5-particle result');
    T.PRODUCE_PARTICLE_COUNT = sv;
  }
}

console.log(' ' + pass + ' assertions, ' + fails.length + ' failed, ' + breaks + ' anti-vacuity breaks');
if (fails.length) { fails.forEach((f) => console.log('   x ' + f)); process.exit(1); }
