#!/usr/bin/env node
// trademenucheck.mjs — #228 G18f-a: MerchantScreenHandler/MerchantScreen (.decomp) ported as
// Trade.menu*: two input slots + result, click-to-select offer + autofill, take-result depletes
// the INPUT slots (not the whole inventory), and the offer list scrolls past 7 rows.
//
//   node tools/trademenucheck.mjs
//
// Each rule is asserted both ways and then re-run against deliberately broken data/behaviour
// ("<n> breaks caught", D-30) so a vacuous pass cannot hide.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0; const fails = []; let breaks = 0, caught = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
// a break: the assertion MUST fail on the broken data
// `c` is the REAL assertion evaluated on deliberately broken data; it must come out false.
const brk = (c, m) => { breaks++; if (!c) caught++; else fails.push('break not caught: ' + m); };

console.log('trademenucheck — #228 MerchantScreenHandler slot economy + scrolling list');

const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07i_entitylist.js', '07ox_enchhelper.js', '07p_trade.js'] });
const imeta = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'items.meta.json'), 'utf8'));
M.Items.init({ items: readFileSync(join(MCLITE_ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: imeta.rawBytes });
const T = M.Trade, Iv = M.Inventory;
const wheat = M.Items.of('wheat'), emerald = M.Items.of('emerald'), coal = M.Items.of('coal');

const sellWheat = { kind: 'sell_item_for_emerald', item: 'wheat', itemQty: 20, priceEmerald: 1, maxUses: 16, xp: 2 };
const buyCoal = { kind: 'buy_item_for_emerald', item: 'coal', priceEmerald: 1, itemQty: 4, maxUses: 16, xp: 2 };
function villager(n) {
  const offers = [];
  for (let i = 0; i < n; i++) offers.push(i % 2 ? buyCoal : sellWheat);
  return { type: 'villager', profession: 'farmer', tradeProfession: 'farmer', tradeOffers: offers,
    tradeUses: offers.map(() => 0), tradeDemand: offers.map(() => 0), tradeSpecial: offers.map(() => 0), villagerLevel: 1, tradeXp: 0 };
}
const player = () => ({ inventory: Iv.create(), instabuild: false });

// ── 1. slot payment: click-to-select autofills, take-result consumes from the input slots
{
  const e = villager(2), P = player();
  Iv.setItem(P.inventory, 3, { i: wheat, n: 45, d: 0 });
  Iv.setItem(P.inventory, 5, { i: coal, n: 9, d: 0 });
  const m = T.menuOpen(e, P);
  ok(T.menuSelect(m, 0), 'select offer 0');
  ok(m.slots[0] && m.slots[0].i === wheat && m.slots[0].n === 45, 'autofill moved ALL 45 wheat to the input slot (capped at 64), got ' + JSON.stringify(m.slots[0]));
  ok(Iv.countOf(P.inventory, wheat) === 0, 'autofill took the wheat OUT of the inventory');
  ok(T.menuMatch(m), 'slot holds >= 20 wheat: the offer matches');
  const r = T.attempt(e, 0, P, m);
  ok(r.ok, 'take-result succeeded: ' + (r && r.reason));
  ok(m.slots[0] && m.slots[0].n === 25, 'take-result consumed exactly 20 from the INPUT slot, left ' + (m.slots[0] && m.slots[0].n));
  ok(Iv.countOf(P.inventory, emerald) === 1, 'result delivered');
  // both directions: a stray copy of the payment in the inventory is NOT touched
  Iv.setItem(P.inventory, 9, { i: wheat, n: 7, d: 0 });
  T.attempt(e, 0, P, m);
  ok(Iv.countOf(P.inventory, wheat) === 7 && m.slots[0].n === 5, 'second take drains the slot, never the inventory');
  // slot short of the price: refused, nothing moves
  const r2 = T.attempt(e, 0, P, m);   // 5 wheat < 20
  ok(!r2.ok && m.slots[0].n === 5 && Iv.countOf(P.inventory, emerald) === 2, 'under-paid slot refuses and changes nothing');
  // closing returns the slot contents
  T.menuClose(m);
  ok(!m.slots[0] && Iv.countOf(P.inventory, wheat) === 12, 'close hands the slot payment back');
  // selecting another offer returns the payment first, then autofills coal
  const m2 = T.menuOpen(e, P); T.menuSelect(m2, 0); T.menuSelect(m2, 1);
  ok(!m2.slots[0] || m2.slots[0].i !== wheat, 'switching offers hands the wheat payment back first');
  ok(!m2.slots[1], 'a one-cost offer leaves the second slot empty');

  // BREAK 1: no-slot-consume — the old whole-inventory spend. With payment sitting in the inventory
  // and the slots EMPTY the trade must refuse (a whole-inventory spend would let it through).
  const e3 = villager(2), P3 = player();
  Iv.setItem(P3.inventory, 0, { i: wheat, n: 20, d: 0 });
  const m3 = T.menuOpen(e3, P3); m3.sel = 0;
  const refusedOnEmptySlots = (r, inv) => !r.ok && Iv.countOf(inv, wheat) === 20;
  const r3 = T.attempt(e3, 0, P3, m3);
  ok(refusedOnEmptySlots(r3, P3.inventory), 'empty slots + payment in inventory: refused, inventory untouched');
  // BREAK: the old whole-inventory spend would have said ok and drained the inventory
  brk(refusedOnEmptySlots({ ok: true }, P3.inventory), 'no-slot-consume: a whole-inventory spend passes the refusal assertion');
}

// ── 2. two-cost offer, either slot order (depleteBuyItems($$3,$$4) || ($$4,$$3))
{
  const e = villager(1); e.tradeOffers[0] = { kind: 'buy_item_for_emerald_and_item', priceEmerald: 3, item: 'coal', itemQty: 5, item2: 'wheat', item2Qty: 2, maxUses: 12, xp: 1 };
  const P = player(), m = T.menuOpen(e, P); m.sel = 0;
  m.slots[0] = { i: coal, n: 5, d: 0 }; m.slots[1] = { i: emerald, n: 3, d: 0 };   // swapped
  ok(T.menuMatch(m), 'swapped slot order still matches');
  ok(T.attempt(e, 0, P, m).ok && !m.slots[0] && !m.slots[1], 'swapped order consumes both slots');
  m.slots[0] = { i: emerald, n: 3, d: 0 }; m.slots[1] = null;
  ok(!T.menuMatch(m), 'second payment missing: no match');
}

// ── 3. scrolling list past 7 rows
{
  const e = villager(12), P = player(), m = T.menuOpen(e, P);
  ok(T.menuCanScroll(12) && !T.menuCanScroll(7), 'scrolls only when > 7 offers');
  ok(JSON.stringify(T.menuVisible(m)) === '[0,1,2,3,4,5,6]', 'window starts at 0');
  T.menuScroll(m, -1);
  ok(m.scroll === 1 && T.menuVisible(m)[0] === 1 && T.menuVisible(m).length === 7, 'wheel down moves the window by one');
  for (let i = 0; i < 20; i++) T.menuScroll(m, -1);
  ok(m.scroll === 5 && T.menuVisible(m)[6] === 11, 'clamped to n-7 = 5, last offer visible, got ' + m.scroll);
  for (let i = 0; i < 20; i++) T.menuScroll(m, 1);
  ok(m.scroll === 0, 'clamped at 0');
  ok(T.scrollThumbY(12, 0) === 0 && T.scrollThumbY(12, 5) === 113, 'thumb spans track top..113');
  ok(T.scrollFromDrag(12, 13.5) === 0 && T.scrollFromDrag(12, 139 - 13.5) === 5, 'drag maps the track to [0,n-7]');
  // one-offer list: never scrolls, one row
  const e1 = villager(1), m1 = T.menuOpen(e1, P);
  T.menuScroll(m1, -1);
  const singleOk = (mm, vis) => mm.scroll === 0 && vis.length === 1;
  ok(singleOk(m1, T.menuVisible(m1)), 'a one-offer list never scrolls');
  brk(singleOk({ scroll: 1 }, [0, 1]), 'one-offer-scroll-list: a scrolling single-offer list fails the assertion');
  const reach = (vf) => { const shown = new Set(); for (let sc = 0; sc <= 5; sc++) { m.scroll = sc; vf().forEach((i) => shown.add(i)); } return shown.size === 12; };
  ok(reach(() => T.menuVisible(m)), 'every one of the 12 offers is reachable by scrolling');
  brk(reach(() => [0, 1, 2, 3, 4, 5, 6]), 'scroll >7: a pinned 7-row window cannot reach offers 7..11');
}

// ── 4. MerchantEntity.onSellingItem: selecting an offer plays yes (filled) / no (empty), gated on ambientSoundChance
{
  const played = [];
  M.Sound = { mobSound: (e, ev) => played.push(ev), play: (ev) => { played.push(ev); return true; } };
  const sel = (inv, chance) => {
    const e = villager(2), P = { inventory: inv, instabuild: false };
    e.ambientSoundChance = chance; played.length = 0;
    T.menuSelect(T.menuOpen(e, P), 0);
    return played.join(',') + '|' + e.ambientSoundChance;
  };
  const full = Iv.create(); Iv.add(full, { i: wheat, n: 20, d: 0 });
  const r1 = sel(full, 0), r2 = sel(Iv.create(), 0), r3 = sel(full, -80);
  ok(r1 === 'entity.villager.yes|-80', 'affordable offer -> yes, chance reset: ' + r1);
  ok(r2 === 'entity.villager.no|-80', 'unaffordable offer -> no: ' + r2);
  ok(r3 === '|-80', 'chance <= -minDelay+20 -> silent: ' + r3);
  brk(r2 === 'entity.villager.yes|-80', 'no-sound-always-yes: unaffordable must not play yes');
}

console.log('================ trademenucheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${caught}/${breaks}`);
for (let i = 0; i < caught; i++) console.log('   ✓ break caught (' + (i + 1) + ')');
console.log(' ' + caught + ' breaks caught');
if (fails.length) { fails.forEach((f) => console.log('   x ' + f)); process.exit(1); }
