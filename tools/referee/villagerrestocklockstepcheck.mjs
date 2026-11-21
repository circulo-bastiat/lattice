// villagerrestocklockstepcheck.mjs -- #7903 (G18f-L2): lockstep scenario 'villagerrestock', 20 salts x (job site kept | job site broken at tick 20000): a villager whose 5 offers a scripted player keeps trading to maxUses, WORK-task runs every 300 ticks (VillagerWorkTask: only while the claimed job site block stands) call shouldRestock()/restock() over 48000 ticks (two day cycles). Per tick: lastRestockTime, restocksToday (max 2), the 2400 gap, lastRestockCheckTime day roll, every offer's uses and demand bonus. Reference = .decomp VillagerEntity.restock/needsRestock/canRestock/shouldRestock/restockAndUpdateDemandBonus + TradeOffer.updateDemandBonus/resetUses, written independently below. The work-task gate (job site present, 300-tick cadence) is modelled by the harness; the brain's own pathing to the site is villagerworkcheck's.
import { readFileSync } from 'node:fs';
import { loadEngine } from '../loadsrc.mjs';
const ROOT = new URL('../../', import.meta.url).pathname;
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07q_effects.js', '07o_profession.js', '07ox_enchhelper.js', '07p_trade.js'], dom: false, initReg: true });
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
const PROFS = ['farmer', 'librarian', 'armorer', 'cleric', 'fisherman', 'fletcher', 'butcher', 'mason', 'shepherd', 'toolsmith'];
M.Sky = M.Sky || {};
const TICKS = 48000, BREAK_AT = 20000;
function lane(salt, broken) {
  const r = stream(salt);
  const e = { type: 'villager', profession: PROFS[salt % PROFS.length], x: 0, y: 64, z: 0 };
  T.ensure(e);
  const n = Math.min(5, e.tradeOffers.length);
  const maxU = e.tradeOffers.map((o) => T.maxUses(o));
  const start = Math.floor(r() * 24000) + 1; // world time at tick 0 (>0 so lastRestockCheckTime logic engages)
  const phase = Math.floor(r() * 300);
  const tradeEvery = 400 + Math.floor(r() * 1500);
  // reference state
  const v = { uses: e.tradeOffers.map(() => 0), demand: e.tradeOffers.map(() => 0), last: 0, today: 0, check: 0 };
  e.tradeUses = e.tradeOffers.map(() => 0); e.tradeDemand = e.tradeOffers.map(() => 0);
  e.tradeLastRestock = 0; e.tradeRestocksToday = 0; e.tradeLastDayMark = 0;
  for (let t = 0; t < TICKS; t++) {
    const time = start + t; // getTime == getTimeOfDay here (daylight cycle on)
    M.Behave.gameTime = time; M.Sky.dayTime = time;
    if (t % tradeEvery === 7) for (let i = 0; i < n; i++) { const u = Math.max(1, maxU[i] - Math.floor(r() * 2)); e.tradeUses[i] = u; v.uses[i] = u; }
    const siteStands = !(broken && t >= BREAK_AT);
    if (siteStands && t % 300 === phase) {
      T.tickRestock(e);
      // reference: shouldRestock() then restock()
      let due = time > v.last + 12000;
      if (v.check > 0) due = due || Math.floor(time / 24000) > Math.floor(v.check / 24000);
      v.check = time;
      if (due) {
        v.last = time;
        const missed = 2 - v.today;
        if (missed > 0) for (let i = 0; i < v.uses.length; i++) v.uses[i] = 0;
        for (let k = 0; k < missed; k++) for (let i = 0; i < v.uses.length; i++) v.demand[i] += v.uses[i] - (maxU[i] - v.uses[i]);
        v.today = 0;
      }
      const can = v.today === 0 || (v.today < 2 && time > v.last + 2400);
      if (can && v.uses.some((u) => u > 0)) {
        for (let i = 0; i < v.uses.length; i++) v.demand[i] += v.uses[i] - (maxU[i] - v.uses[i]);
        v.uses.fill(0); v.last = time; v.today++;
      }
    }
    const eng = [e.tradeLastRestock || 0, e.tradeRestocksToday || 0, e.tradeLastDayMark || 0, e.tradeUses.join(), e.tradeDemand.join()].join('|');
    const ref = [v.last, v.today, v.check, v.uses.join(), v.demand.join()].join('|');
    if (eng !== ref) return 'salt ' + salt + (broken ? ' broken' : '') + ' tick ' + t + ' eng ' + eng + ' ref ' + ref;
    if (v.today > 2) return 'ref exceeded 2 restocks';
  }
  return null;
}
const pass = () => salts.flatMap((s) => [lane(s, false), lane(s, true)]).filter(Boolean);
const base = pass();
ok(base.length === 0, 'lane: ' + base.slice(0, 2).join(' | '));
// the lanes must actually restock (twice in a day) and the broken site must stop it
{
  const e = { type: 'villager', profession: 'farmer', x: 0, y: 64, z: 0 }; T.ensure(e);
  let count = 0; const rs = T.restock; T.restock = (x) => { count++; rs(x); };
  lane(3, false); const full = count; count = 0; lane(3, true); const cut = count; T.restock = rs;
  ok(full >= 4 && cut < full, 'lane restocks (' + full + ' vs ' + cut + ' with the job site broken)');
}
const sr = T.shouldRestock;
T.shouldRestock = (e) => { const x = sr(e); if (!x && (e.tradeRestocksToday || 0) === 2 && T.needsRestock(e) && M.Behave.gameTime > e.tradeLastRestock + 2400) return true; return x; };
brk(pass().length > 0, 'third restock a day caught'); T.shouldRestock = sr;
T.shouldRestock = (e) => { const x = sr(e); return x && M.Behave.gameTime > (e.tradeLastRestock || 0) + 2400 + 1 || (x && !e.tradeLastRestock); };
brk(pass().length > 0, '2400 gap 2400 -> 2401 caught'); T.shouldRestock = sr;
const ud = T.updateDemandBonus;
T.updateDemandBonus = (e) => { ud(e); if (e.tradeDemand) e.tradeDemand[0]++; };
brk(pass().length > 0, 'demand bonus off by one caught'); T.updateDemandBonus = ud;
brk(pass().length === 0, 'unfaulted lane passes after restore');
console.log(`villagerrestocklockstepcheck: ${2 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
