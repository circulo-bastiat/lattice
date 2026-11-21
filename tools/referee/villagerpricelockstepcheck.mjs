// villagerpricelockstepcheck.mjs -- #7905 (G18f-L4): lockstep scenario 'villagerprice': 20 salts x every offer x (1, 5, 12 purchases) x (no hero | Hero amplifier 0 | 4) x (gossip: none | random | zombie-villager cured): the adjusted first-buy count (base + max(0,floor(base*demand*priceMult)) + special, clamped 1..maxStack, floats via fround) with the reputation special price -floor(rep*priceMult) and the hero discount -max(floor((0.3+0.0625*amp)*base),1), the clear on closing, and demand/uses/special fields vs an independent TradeOffer/VillagerEntity.setSpecialPrices reference. Original comment: lockstep scenario 'villagerrestock', 20 salts x (job site kept | job site broken at tick 20000): a villager whose 5 offers a scripted player keeps trading to maxUses, WORK-task runs every 300 ticks (VillagerWorkTask: only while the claimed job site block stands) call shouldRestock()/restock() over 48000 ticks (two day cycles). Per tick: lastRestockTime, restocksToday (max 2), the 2400 gap, lastRestockCheckTime day roll, every offer's uses and demand bonus. Reference = .decomp VillagerEntity.restock/needsRestock/canRestock/shouldRestock/restockAndUpdateDemandBonus + TradeOffer.updateDemandBonus/resetUses, written independently below. The work-task gate (job site present, 300-tick cadence) is modelled by the harness; the brain's own pathing to the site is villagerworkcheck's.
import { readFileSync } from 'node:fs';
import { loadEngine } from '../loadsrc.mjs';
const ROOT = new URL('../../', import.meta.url).pathname;
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07q_effects.js', '07o_profession.js', '07ox_enchhelper.js', '07l_spawn.js', '07p_trade.js'], dom: false, initReg: true });
const T = M.Trade;
{ // villager-trades table off the golden TSV (as tradecheck §3)
  const lines = readFileSync(ROOT + 'tools/golden/villager-trades-1.18.2.tsv', 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
  const hdr = lines[0].split('\t'), NUMF = new Set(['itemQty', 'item2Qty', 'priceEmerald', 'maxUses', 'xp', 'durationTicks', 'effectId']), trades = {};
  for (const l of lines.slice(1)) {
    const c = l.split('\t'), r = {}; hdr.forEach((h, i) => { r[h] = c[i]; });
    const row = { kind: r.kind };
    for (const h of hdr) { if (h === 'profession' || h === 'level' || h === 'kind' || r[h] === undefined || r[h] === '') continue; row[h] = h === 'byVillagerType' ? JSON.parse(r[h]) : (NUMF.has(h) ? +r[h] : r[h]); }
    ((trades[r.profession] ||= {})[+r.level] ||= []).push(row);
  }
  M.DATA = Object.assign({}, M.DATA, { villagerTrades: trades });
  const im = JSON.parse(readFileSync(ROOT + 'assets/items.meta.json', 'utf8'));
  M.Items.init({ items: readFileSync(ROOT + 'assets/items.bin').toString('base64'), itemsBytes: im.rawBytes });
}
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
const PROFS = ['farmer', 'librarian', 'armorer', 'cleric', 'fisherman', 'fletcher', 'butcher', 'mason', 'shepherd', 'toolsmith', 'cartographer', 'leatherworker', 'weaponsmith'];
const F = Math.fround, GOS = { major_negative: -5, minor_negative: -1, minor_positive: 1, major_positive: 5, trading: 1 };
let cells = 0, capHit = 0, floorHit = 0;
function lane(salt) {
  const r = stream(salt), out = [];
  for (const mode of ['none', 'random', 'cured']) for (const amp of [-1, 0, 4]) for (const buys of [1, 5, 12]) {
    const e = { type: 'villager', profession: PROFS[salt % PROFS.length], level: 1 + (salt % 5), x: 0, y: 64, z: 0 };
    T.ensure(e);
    const n = e.tradeOffers.length;
    const base = e.tradeOffers.map((_, i) => T.needGive(e, i).need[0].n);
    const ids = e.tradeOffers.map((_, i) => T.needGive(e, i).need[0].id);
    const gos = {};
    if (mode === 'random') for (const k of Object.keys(GOS)) if (r() < 0.6) gos[k] = 2 + Math.floor(r() * 60);
    if (mode === 'cured') { M.Village.startGossip(e, 'major_positive', 20); M.Village.startGossip(e, 'minor_positive', 25); gos.major_positive = 20; gos.minor_positive = 25; }
    if (mode === 'random') e.gossip = Object.assign({}, gos);
    const rep = Object.keys(gos).reduce((a, k) => a + gos[k] * GOS[k], 0);
    // the same offer bought `buys` times, then the day's restock folds it into demand
    const maxU = e.tradeOffers.map((o) => T.maxUses(o));
    const uses = e.tradeOffers.map((_, i) => Math.min(buys, maxU[i]));
    e.tradeUses = uses.slice(); e.tradeDemand = e.tradeOffers.map(() => 0);
    T.updateDemandBonus(e);
    const dem = uses.map((u, i) => u - (maxU[i] - u));
    const P = { effects: amp >= 0 ? { hero_of_the_village: { amplifier: amp, duration: 1000 } } : {} };
    T.prepareOffersFor(e, P);
    for (let i = 0; i < n; i++) {
      const pm = F(+e.tradeOffers[i].priceMult || 0);
      let sp = rep !== 0 ? -Math.floor(F(F(rep) * pm)) : 0;
      if (amp >= 0) sp += -Math.max(Math.floor((0.3 + 0.0625 * amp) * base[i]), 1);
      const bonus = Math.max(0, Math.floor(F(F(base[i] * dem[i]) * pm)));
      const raw = base[i] + bonus + sp, mx = M.Items.maxStack(ids[i]);
      const want = Math.min(Math.max(raw, 1), mx);
      if (raw > mx) capHit++; if (raw < 1) floorHit++;
      cells++;
      const got = T.needGive(e, i).need[0].n;
      const f = [got, e.tradeDemand[i], e.tradeUses[i], e.tradeSpecial[i]].join();
      const w = [want, dem[i], uses[i], sp].join();
      if (f !== w) out.push('salt ' + salt + ' ' + mode + ' amp' + amp + ' x' + buys + ' offer ' + i + ' (' + e.tradeOffers[i].kind + ') eng ' + f + ' ref ' + w);
    }
    T.clearSpecialPrices(e);
    if (e.tradeSpecial.some((x) => x !== 0)) out.push('salt ' + salt + ' clear left special');
  }
  return out;
}
const pass = () => salts.flatMap(lane);
const base = pass();
ok(base.length === 0, 'lane: ' + base.slice(0, 2).join(' | '));
ok(cells > 1000 && capHit > 0 && floorHit > 0, 'lane covers ' + cells + ' cells, cap ' + capHit + ', floor ' + floorHit);
const po = T.prepareOffersFor;
T.prepareOffersFor = (e, P) => { const h = P.effects.hero_of_the_village; const hold = P.effects; if (h) P.effects = {}; po(e, P); P.effects = hold; if (h) for (let i = 0; i < e.tradeSpecial.length; i++) { const cnt = T.needGive(e, i).need[0].n - 0; e.tradeSpecial[i] += Math.max(Math.floor((0.3 + 0.0625 * h.amplifier) * cnt), 1); } };
brk(pass().length > 0, 'hero discount sign flipped caught'); T.prepareOffersFor = po;
const ac = T.adjustedFirstCount;
T.adjustedFirstCount = (e, i) => ac(e, i) + 1;
brk(pass().length > 0, 'count off by one caught'); T.adjustedFirstCount = ac;
const ud = T.updateDemandBonus;
T.updateDemandBonus = (e) => { ud(e); e.tradeDemand[0]++; };
brk(pass().length > 0, 'demand off by one caught'); T.updateDemandBonus = ud;
const gr = M.Village.getReputation;
M.Village.getReputation = (e) => -gr(e);
brk(pass().length > 0, 'reputation sign flipped caught'); M.Village.getReputation = gr;
brk(pass().length === 0, 'unfaulted lane passes after restore');
console.log(`villagerpricelockstepcheck: ${2 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
