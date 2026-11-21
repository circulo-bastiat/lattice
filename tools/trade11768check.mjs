#!/usr/bin/env node
// trade11768check.mjs — #11768: 07p_trade.js TradeOfferList / SimpleMerchant / VillagerDataContainer; reachability + source breaks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const A = join(MCLITE_ROOT, 'assets');
const imeta = JSON.parse(readFileSync(join(A, 'items.meta.json'), 'utf8'));
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const MCL = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07i_entitylist.js', '07ox_enchhelper.js', '07p_trade.js'],
    patch: patch ? (f, s) => (f === '07p_trade.js' ? patch(s) : s) : undefined });
  MCL.Items.init({ items: readFileSync(join(A, 'items.bin')).toString('base64'), itemsBytes: imeta.rawBytes });
  const T = MCL.Trade, L = T.OfferList, o = {};
  const wheat = MCL.Items.of('wheat'), coal = MCL.Items.of('coal');
  const sell = { kind: 'sell_item_for_emerald', item: 'wheat', itemQty: 20, priceEmerald: 1, maxUses: 16, xp: 2 };
  const buy = { kind: 'buy_item_for_emerald', item: 'coal', priceEmerald: 1, itemQty: 4, maxUses: 16, xp: 2 };
  const e = { type: 'villager', tradeOffers: [sell, buy, sell], tradeUses: [0, 0, 0], tradeDemand: [0, 0, 0], tradeSpecial: [0, 0, 0] };
  const W = { i: wheat, n: 20, d: 0 }, C = { i: coal, n: 1, d: 0 };
  o.firstScan = L.getValidOffer(e, W, null, 0) === 0;
  o.indexHit = L.getValidOffer(e, W, null, 2) === 2;
  o.indexMissNoScan = L.getValidOffer(e, W, null, 1) === -1;   // index in range but mismatched: null, no scan
  o.outOfRangeScan = L.getValidOffer(e, W, null, 9) === 0;
  o.none = L.getValidOffer(e, C, null, 0) === -1;
  const n = L.toNbt(e), f = L.fromNbt({}, n);
  o.nbt = n.Recipes.length === 3 && f.tradeOffers.length === 3 && f.tradeOffers[1] === buy;
  const m = T.SimpleMerchant({ id: "p" });
  m.setOffersFromServer(f); m.trade(1); m.setExperienceFromServer(7);
  o.merchant = m.getOffers() === f && f.tradeUses[1] === 1 && m.getExperience() === 7 && m.isLeveledMerchant() && m.getCustomer().id === 'p';
  const v = {}; T.VillagerDataContainer.setVillagerData(v, { type: 'desert', profession: 'farmer', level: 3 });
  const d = T.VillagerDataContainer.getVillagerData(v); o.vdata = d.type === 'desert' && d.level === 3 && d.profession === 'farmer';
  const mm = { e, slots: [W, null], sel: 0 }; o.menuReach = T.menuMatch(mm) === true;
  return o;
}
const A0 = trial(null);
for (const k of Object.keys(A0)) ok(A0[k], 'scenario ' + k);
const BR = [
  ['indexScan', 'if (index > 0 && index < n) return', 'if (false) return', ['indexMissNoScan', 'indexHit']],
  ['scanLoop', 'for (var i = 0; i < n; i++) if (L.matchesBuyItems(e, i, a, b)) return i;', 'return -1;', ['firstScan']],
  ['nbtCopy', 'e.tradeOffers.push(rec[i].offer);', 'e.tradeOffers.push(null);', ['nbt']],
  ['merchantTrade', 'm.offers.tradeUses[i] = (m.offers.tradeUses[i] | 0) + 1;', '', ['merchant']],
  ['vdataLevel', 'e.villagerLevel = d.level;', '', ['vdata']],
  ['menuRoute', 'return Trade.OfferList.matchesBuyItems(m.e, m.sel, m.slots[0], m.slots[1]);', 'return false;', ['menuReach']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((s) => { if (s.includes(a)) { hit = true; return s.split(a).join(b); } return s; }); } catch (err) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(`trade11768check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const x of fails) console.log('  FAIL ' + x);
process.exit(fails.length ? 1 : 0);
