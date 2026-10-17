// villagertradelockstepcheck.mjs -- #6685 (G17-L114): lockstep scenario 'villagertrade', 20 salts: a farmer's wheat->emerald offer (20 wheat, maxUses 16, priceMult 0.05) traded by a scripted player across 3 game days, working every tick. Per tick: uses, demandBonus, specialPrice, adjusted first-buy count, lastRestockTime, restocksToday. Reference = .decomp VillagerEntity.shouldRestock/canRestock/restock/restockAndUpdateDemandBonus/prepareOffersFor + TradeOffer.updateDemandBonus/getAdjustedFirstBuyItem (written independently below).
// OWED: level-up xp thresholds and the new-level trade rolls from the entity Random are not in this lane (offers are a fixed single row).
import { loadEngine } from '../loadsrc.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07q_effects.js', '07o_profession.js', '07p_trade.js'], dom: false, initReg: true });
const T = M.Trade;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const f = Math.fround, salts = Array.from({ length: 20 }, (_, i) => i);
const MAXU = 16, COUNT = 20, MULT = 0.05;
// reference villager (one offer)
function refNew() { return { uses: 0, demand: 0, special: 0, last: 0, check: 0, today: 0 }; }
function refShould(v, now, tod) {
  let due = now > v.last + 12000;
  if (v.check > 0) due = due || Math.floor(tod / 24000) > Math.floor(v.check / 24000);
  v.check = tod;
  if (due) { v.last = now; const missed = 2 - v.today; if (missed > 0) v.uses = 0; for (let k = 0; k < missed; k++) v.demand += v.uses - (MAXU - v.uses); v.today = 0; }
  return (v.today === 0 || (v.today < 2 && now > v.last + 2400)) && v.uses > 0;
}
function refRestock(v, now) { v.demand += v.uses - (MAXU - v.uses); v.uses = 0; v.last = now; v.today++; }
function refCount(v) { const b = Math.max(0, Math.floor(f(f(COUNT * v.demand) * f(MULT)))); return Math.min(Math.max(COUNT + b + v.special, 1), 64); }
function lane(salt, mutate) {
  const r = stream(salt), rep = Math.floor(r() * 21) - 5, hero = r() < 0.5 ? Math.floor(r() * 3) : -1;
  M.Village = { getReputation: () => rep };
  M.Effects.amplifierOf = () => hero;
  const e = { tradeOffers: [{ kind: 'sell_item_for_emerald', item: 'wheat', itemQty: COUNT, maxUses: MAXU, priceMult: MULT }], tradeUses: [0], tradeDemand: [0], tradeSpecial: [0] };
  const v = refNew(), tradeRate = 0.05 + r() * 0.3, off = Math.floor(r() * 5000);
  const refSpecial = () => { v.special = 0; if (rep) v.special += -Math.floor(f(f(rep) * f(MULT))); if (hero >= 0) v.special += -Math.max(Math.floor((0.3 + 0.0625 * hero) * COUNT), 1); };
  for (let t = 0; t < 72000; t++) {
    const now = t, tod = t + off;
    M.Behave.gameTime = now; M.Sky = { dayTime: tod };
    if (r() < tradeRate && t % 7 === 0) { // player opens the screen, buys once if enabled, closes it
      T.prepareOffersFor(e, {}); refSpecial();
      const dis = T.disabled(e, 0);
      if (dis !== (v.uses >= MAXU)) return 'salt ' + salt + ' tick ' + t + ' disabled';
      if (!dis) { e.tradeUses[0]++; v.uses++; }
      T.clearSpecialPrices(e); v.special = 0;
    }
    const a = T.tickRestock(e), b = refShould(v, now, tod); if (b) refRestock(v, now);
    if (mutate) mutate(e);
    const eng = [e.tradeUses[0], e.tradeDemand[0], e.tradeSpecial[0], T.adjustedFirstCount(e, 0), e.tradeLastRestock || 0, e.tradeRestocksToday || 0, a ? 1 : 0];
    const ref = [v.uses, v.demand, v.special, refCount(v), v.last, v.today, b ? 1 : 0];
    if (eng.join() !== ref.join()) return 'salt ' + salt + ' tick ' + t + ' eng ' + eng + ' ref ' + ref;
  }
  return null;
}
const pass = (mu) => salts.map((s) => lane(s, mu)).filter(Boolean);
const base = pass();
ok(base.length === 0, 'lane: ' + base.slice(0, 2).join(' | '));
const mo = (e) => { e.tradeOffers[0].maxUses = 12; };
brk(pass(mo).length > 0, 'maxUses 16 -> 12 caught');
const ud = T.updateDemandBonus;
T.updateDemandBonus = (e) => { ud(e); e.tradeDemand[0] += 1; };
brk(pass().length > 0, 'demand step +1 caught'); T.updateDemandBonus = ud;
const sr = T.restock; T.restock = (e) => { sr(e); e.tradeRestocksToday = 0; };
brk(pass().length > 0, 'restock limit 2/day lifted caught'); T.restock = sr;
brk(pass().length === 0, 'unfaulted lane passes after restore');
console.log(`villagertradelockstepcheck: ${2 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
