#!/usr/bin/env node
// trade11624check.mjs — #11624: proves 07p_trade.js MerchantScreen (scroll/list), MerchantScreenHandler (autofill/switchTo),
// TradeOutputSlot (take depletes inputs), MerchantInventory (updateOffers match), EnchantmentTarget (TARGET_OF -> enchant roster),
// DyeableItem (blendAndSetColor), VillagerType (boat by type). Behaviour, reachability from Hud/Use, and SOURCE breaks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const A = join(MCLITE_ROOT, 'assets');
const imeta = JSON.parse(readFileSync(join(A, 'items.meta.json'), 'utf8'));
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const seq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };
function trial(patch) {
  const MCL = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07i_entitylist.js', '07ox_enchhelper.js', '07p_trade.js'],
    patch: patch ? (f, s) => (f === '07p_trade.js' ? patch(s) : s) : undefined });
  MCL.Items.init({ items: readFileSync(join(A, 'items.bin')).toString('base64'), itemsBytes: imeta.rawBytes });
  const T = MCL.Trade, Iv = MCL.Inventory, o = {};
  const wheat = MCL.Items.of('wheat'), emerald = MCL.Items.of('emerald'), coal = MCL.Items.of('coal');
  const sell = { kind: 'sell_item_for_emerald', item: 'wheat', itemQty: 20, priceEmerald: 1, maxUses: 16, xp: 2 };
  const buy = { kind: 'buy_item_for_emerald', item: 'coal', priceEmerald: 1, itemQty: 4, maxUses: 16, xp: 2 };
  const vil = (n, extra) => { const of = []; for (let i = 0; i < n; i++) of.push(i % 2 ? buy : sell);
    return Object.assign({ type: 'villager', profession: 'farmer', tradeProfession: 'farmer', tradeOffers: of, tradeUses: of.map(() => 0),
      tradeDemand: of.map(() => 0), tradeSpecial: of.map(() => 0), villagerLevel: 1, tradeXp: 0 }, extra || {}); };
  const P = () => ({ inventory: Iv.create(), instabuild: false });
  // MerchantScreenHandler.autofill + switchTo + TradeOutputSlot take + MerchantInventory match
  { const e = vil(2), p = P(); Iv.setItem(p.inventory, 3, { i: wheat, n: 45, d: 0 }); Iv.setItem(p.inventory, 5, { i: coal, n: 9, d: 0 });
    const m = T.menuOpen(e, p); T.menuSelect(m, 0, true);
    o.autofill = !!m.slots[0] && m.slots[0].n === 45 && Iv.countOf(p.inventory, wheat) === 0;
    o.match = T.menuMatch(m);
    const r = T.attempt(e, 0, p, m);
    o.take = r.ok && m.slots[0].n === 25 && Iv.countOf(p.inventory, emerald) === 1;
    const r2 = (T.attempt(e, 0, p, m), T.attempt(e, 0, p, m));
    o.short = !r2.ok && m.slots[0].n === 5;
    T.menuSelect(m, 1, true);
    o.switchTo = (!m.slots[0] || m.slots[0].i !== wheat) && Iv.countOf(p.inventory, wheat) >= 5;
    const m3 = T.menuOpen(vil(2), P()); o.noSlotRefuse = !T.attempt(m3.e, 0, m3.P, m3).ok;
    const e4 = vil(2), p4 = P(); Iv.setItem(p4.inventory, 3, { i: wheat, n: 25, d: 0 });
    o.ownSlots = T.attempt(e4, 0, p4).ok && Iv.countOf(p4.inventory, wheat) === 5 && Iv.countOf(p4.inventory, emerald) === 1; }
  // MerchantScreen scroll list
  { const e = vil(10), m = T.menuOpen(e, P());
    o.scroll = T.menuScroll(m, -1) === 1 && T.menuScroll(m, -9) === 3 && T.menuScroll(m, 9) === 0 && T.menuVisible(m).length === 7;
    const s = T.menuOpen(vil(7), P()); o.noScroll = T.menuScroll(s, -1) === 0 && !T.menuCanScroll(7);
    o.thumb = T.scrollThumbY(10, 3) > 0 && T.scrollFromDrag(10, 500) === 3; }
  // DyeableItem.blendAndSetColor
  { const rows = [{ kind: 'sell_dyed_armor_for_emerald', item: 'leather_helmet', price: 5, maxUses: 12, xp: 5 }];
    const r = T.resolveOffers(rows, { type: 'villager' }, seq([0, 0.5, 0.1]))[0];   // dye 0 (white), no extras
    o.dyeWhite = r && r.tag && r.tag.display.color === 0xF9FFFE;
    const r2 = T.resolveOffers(rows, { type: 'villager' }, seq([0.07, 0.8, 0.2, 0.1]))[0];   // orange+blue blended
    o.dyeBlend = r2 && r2.tag.display.color === ((233 << 16) | (233 << 8) | 187);
    const h = T.resolveOffers([{ kind: 'sell_dyed_armor_for_emerald', item: 'leather_horse_armor', price: 5, maxUses: 12, xp: 5 }], {}, seq([0]))[0];
    o.dyeHorse = h && !h.tag; }
  // VillagerType boat trade
  { const row = { kind: 'sell_type_variant_item_for_emerald', itemQty: 1, maxUses: 12, xp: 30, byVillagerType: { plains: 'oak_boat', desert: 'jungle_boat', snow: 'spruce_boat' } };
    const f = (t) => T.resolveOffers([row], { villagerType: t }, seq([0]))[0].item;
    o.vtype = f('desert') === 'jungle_boat' && f('snow') === 'spruce_boat' && f(undefined) === 'oak_boat' && f('swamp') === 'oak_boat'; }
  // EnchantmentTarget: TARGET_OF categories steer the enchant roster
  { const row = (item) => ({ kind: 'sell_enchanted_tool_for_emeralds', item, basePrice: 5, maxUses: 3, xp: 10, priceMult: 0.2 });
    const ids = (item) => { const s = new Set(); for (let k = 0; k < 400; k++) { const r = T.resolveOffers([row(item)], {}, (() => { let x = k * 7919 + 1; return () => (x = (x * 16807) % 2147483647) / 2147483647; })())[0];
      if (r && r.tag) for (const en of r.tag.Enchantments) s.add(en.id.replace('minecraft:', '')); } return s; };
    const sw = ids('diamond_sword'), bw = ids('bow');
    o.tgtWeapon = sw.has('sharpness') && !sw.has('power') && !sw.has('protection');
    o.tgtBow = bw.has('power') && !bw.has('sharpness') && !bw.has('efficiency'); }
  // reachability
  const rd = (f) => readFileSync(join(MCLITE_ROOT, 'src', f), 'utf8'), hud = rd('15_hud.js'), use = rd('14l_use.js');
  o.reach = hud.includes('NS.Trade.menuOpen(e, NS.Player)') && hud.includes('NS.Trade.menuScroll(H.tradeMenu') && hud.includes('NS.Trade.menuClose(H.tradeMenu')
    && use.includes('NS.Hud.openTrading(e)');
  return o;
}
const A0 = trial(null);
for (const k of Object.keys(A0)) ok(A0[k], 'scenario ' + k);
const BR = [
  ['autofillCap', 'var mv = Math.min(maxc - have, st.n);', 'var mv = Math.min(1, st.n);', ['autofill']],
  ['closeReturn', 'if (Iv.add(m.P.inventory, s) > 0) ok = false; else m.slots[k] = null;', 'm.slots[k] = null;', ['switchTo']],
  ['depleteSlots', 'take(s0, need[0].n);', 'take(s0, 0);', ['take']],
  ['matchQty', 'if (!sameKind(x, n0.id) || x.n < n0.n) return false;', 'if (!sameKind(x, n0.id)) return false;', ['short']],
  ['ownSlots', 'if (!menu && !P.instabuild) {', 'if (false) {', ['ownSlots']],
  ['scrollClamp', 'Math.min(n - Trade.MAX_LIST_ROWS, Math.trunc(m.scroll - dy))', 'Math.trunc(m.scroll - dy)', ['scroll']],
  ['scrollGate', 'return n > Trade.MAX_LIST_ROWS;', 'return n > 3;', ['noScroll']],
  ['dragMap', 'var cap = n - 7;', 'var cap = n - 6;', ['thumb']],
  ['dyeBlend', 'if (mx > 0) {', 'if (false) {', ['dyeBlend']],
  ['dyeHorse', 'if (!DYEABLE_ARMOR[row.item]) {', 'if (false) {', ['dyeHorse']],
  ['vtypeIndex', "var type = (e && e.villagerType) || 'plains';", "var type = 'plains';", ['vtype']],
  ['targetWeapon', "iron_sword: ['weapon', 'breakable']", "iron_sword: ['bow', 'breakable']", []],
  ['targetBow', "bow: ['bow', 'breakable'],", "bow: ['weapon', 'breakable'],", ['tgtBow']],
  ['targetDiaSword', "diamond_sword: ['weapon', 'breakable']", "diamond_sword: ['bow', 'breakable']", ['tgtWeapon']],
];
for (const [key, a, b, expect] of BR) {
  if (!expect.length) continue;
  breaks++; let hit = false, X;
  try { X = trial((s) => { if (s.includes(a)) { hit = true; return s.split(a).join(b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(`trade11624check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
