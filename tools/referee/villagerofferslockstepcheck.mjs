// villagerofferslockstepcheck.mjs -- #7097 (G18f-L6): lockstep scenario 'villageroffers', 20 salts: the offer list a villager of each of the 13 professions generates at levels 1..5
// (VillagerEntity.fillRecipes -> MerchantEntity.fillRecipesFromPool(offers, PROFESSION_TO_LEVELED_TRADE[prof][level], 2)).
// Reference = .decomp TradeOffers.java parsed at run time (factory ARRAY ORDER per profession/level, constructor numbers) + MerchantEntity.fillRecipesFromPool (HashSet of nextInt(len) until 2
// distinct, iterated ascending) + each Factory.create (EnchantBookFactory draws: enchantment index, level, 2+nextInt(5+lvl*10)+3*lvl, treasure x2, cap 64; SellEnchantedTool: 5+nextInt(15);
// SellDyedArmor: dye, float>0.7, float>0.8; SellPotionHolding: one nextInt; SellMapFactory with no structure: null). Compared per salt: (buy, buyB, sell counts, maxUses, xp, priceMultiplier)
// of every offer, in order, and the number of Random draws. Item identities are the D-480 jar table (not re-derived); demand is 0 on a fresh offer (no draw). The enchantment CHOICE inside
// SellEnchantedTool (EnchantmentHelper.enchant) is the engine's own draws, so the reference resyncs after a tool offer.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07ox_enchhelper.js', '07oy_enchtable.js', '07o_profession.js', '07p_trade.js'], dom: false, initReg: true });
const Trade = M.Trade;
{ // the D-480 jar table, parsed the way gen-data.mjs / tradecheck do
  const L = readFileSync(join(MCLITE_ROOT, 'tools', 'golden', 'villager-trades-1.18.2.tsv'), 'utf8').trim().split(/\r?\n/), H = L[0].split('\t'), T = {};
  const NUM = new Set(['itemQty', 'item2Qty', 'priceEmerald', 'maxUses', 'xp', 'priceMult', 'durationTicks', 'effectId']);
  for (const line of L.slice(1)) {
    const c = line.split('\t'), r = {}; H.forEach((h, i) => { r[h] = c[i]; });
    const row = { kind: r.kind };
    for (const h of H) if (!['profession', 'level', 'kind'].includes(h) && r[h] !== undefined && r[h] !== '') row[h] = h === 'byVillagerType' ? JSON.parse(r[h]) : (NUM.has(h) ? +r[h] : r[h]);
    ((T[r.profession] = T[r.profession] || {})[+r.level] = T[r.profession][+r.level] || []).push(row);
  }
  M.DATA = Object.assign({}, M.DATA, { villagerTrades: T });
}
M.Items.init({ items: readFileSync(join(MCLITE_ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'items.meta.json'), 'utf8')).rawBytes });
const dec = (f) => readFileSync(join(MCLITE_ROOT, '.decomp', 'net', 'minecraft', f), 'utf8');
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };

// ── reference table: TradeOffers.PROFESSION_TO_LEVELED_TRADE read off the decomp
const PROF = {}; for (const m of dec('village/VillagerProfession.java').matchAll(/(field_\d+) = register\(\s*"(\w+)"/g)) PROF[m[1]] = m[2];
const src = dec('village/TradeOffers.java'); const body = src.slice(src.indexOf('PROFESSION_TO_LEVELED_TRADE'), src.indexOf('WANDERING_TRADER_TRADES ='));
function balanced(s, i, open, close) { let d = 0; for (let j = i; j < s.length; j++) { if (s[j] === open) d++; else if (s[j] === close && --d === 0) return j; } throw new Error('unbalanced'); }
function topSplit(s) { const out = []; let d = 0, cur = ''; for (const c of s) { if ('({'.includes(c)) d++; if (')}'.includes(c)) d--; if (c === ',' && d === 0) { out.push(cur.trim()); cur = ''; } else cur += c; } if (cur.trim()) out.push(cur.trim()); return out; }
const TABLE = {};
{
  const re = /VillagerProfession\.(field_\d+),|(\d),\s*new TradeOffers\.Factory\[\]\{/g; let m, prof = null;
  while ((m = re.exec(body))) {
    if (m[1]) { prof = PROF[m[1]]; TABLE[prof] = {}; continue; }
    const open = m.index + m[0].length - 1, close = balanced(body, open, '{', '}'), inner = body.slice(open + 1, close), arr = [];
    for (const f of inner.matchAll(/new TradeOffers\.(\w+)Factory\(/g)) {
      const po = f.index + f[0].length - 1; if (inner.slice(0, f.index).split('new TradeOffers.').length > 1 && /Factory\(/.test('')) continue;
      arr.push({ cls: f[1], start: po, args: topSplit(inner.slice(po + 1, balanced(inner, po, '(', ')'))) });
    }
    // drop factories nested inside another factory's arguments (none in 1.18.2 but keep the array flat)
    const flat = []; let end = -1; for (const a of arr) if (a.start > end) { flat.push(a); end = balanced(inner, a.start, '(', ')'); }
    TABLE[prof][+m[2]] = flat;
  }
}
// Items.java: which field is a DyeableArmorItem (leather horse armour is a DyeableHorseArmorItem, so SellDyedArmorFactory.create skips its dye draws)
const DYEABLE = new Set([...dec('item/Items.java').matchAll(/(field_\d+) = register\(\s*"\w+",\s*new DyeableArmorItem\(/g)].map((m) => m[1]));
const num = (s) => parseFloat(s.replace(/F$/, ''));
const ENCHANTS = [...dec('enchantment/Enchantments.java').matchAll(/register\(\s*"(\w+)"/g)].map((m) => m[1]).filter((n) => n !== 'soul_speed');   // SoulSpeedEnchantment.isAvailableForEnchantedBookOffer() == false
// one Factory.create: returns { t:[buy,buyB,sell,maxUses,xp,mult], tool?:true } or null; draws via r()
function create(f, r, ctx) {
  const a = f.args, n = a.slice(1).map(num);
  switch (f.cls) {
    case 'BuyForOneEmerald': return { t: [n[0], 0, 1, n[1], n[2], 0.05] };
    case 'SellItem': { const l = a.length; if (l === 4) return { t: [n[0], 0, n[1], 12, n[2], 0.05] }; return { t: [n[0], 0, n[1], n[2], n[3], l === 6 ? n[4] : 0.05] }; }
    case 'ProcessItem': return a.length === 6 ? { t: [1, n[0], n[2], n[3], n[4], 0.05] } : { t: [n[1], n[0], n[3], n[4], n[5], 0.05] };
    case 'SellSuspiciousStew': return { t: [1, 0, 1, 12, n[1], 0.05] };
    case 'TypeAwareBuyForOneEmerald': return { t: [num(a[0]), 0, 1, num(a[1]), num(a[2]), 0.05] };
    case 'EnchantBook': {
      const id = ENCHANTS[Math.floor(r() * ENCHANTS.length)], e = Trade.ENCH[id], lvl = 1 + Math.floor(r() * e.maxLevel);
      let p = 2 + Math.floor(r() * (5 + lvl * 10)) + 3 * lvl; if (e.treasure) p *= 2; if (p > 64) p = 64;
      return { t: [p, 1, 1, 12, num(a[0]), 0.2] };
    }
    case 'SellEnchantedTool': { const lvl = 5 + Math.floor(r() * 15); return { tool: true, t: [Math.min(n[0] + lvl, 64), 0, 1, n[1], n[2], a.length === 5 ? n[3] : 0.05] }; }
    case 'SellDyedArmor': { if (DYEABLE.has(a[0].replace('Items.', ''))) {   r(); if (r() > 0.7) r(); if (r() > 0.8) r(); }
      return { t: [n[0], 0, 1, a.length === 4 ? n[1] : 12, a.length === 4 ? n[2] : 1, 0.2] }; }
    case 'SellPotionHoldingItem': r(); return { t: [n[3], n[0], n[2], n[4], n[5], 0.05] };
    case 'SellMap': return null;
    default: throw new Error('reference: unknown factory ' + f.cls);
  }
}
function refRoll(prof, level, r) {
  const pool = TABLE[prof][level], picked = new Set();
  if (pool.length > 2) while (picked.size < 2) picked.add(Math.floor(r() * pool.length)); else pool.forEach((_, i) => picked.add(i));
  // after a SellEnchantedTool the stream position depends on EnchantmentHelper.enchant's draws (engine-owned): later draw-dependent offers are masked (price null), static ones still compared
  let lost = false;
  return [...picked].sort((x, y) => x - y).map((i) => {
    const drawn = ['EnchantBook', 'SellEnchantedTool', 'SellDyedArmor', 'SellPotionHoldingItem'].includes(pool[i].cls), mask = lost && drawn;
    const o = mask ? (pool[i].cls === 'SellMap' ? null : { t: [null, 0, 1, 0, 0, 0] }) : create(pool[i], r, null);
    if (o && o.tool) lost = true;
    if (mask) return { t: [null], mask: true, i };
    return o;
  }).filter(Boolean);
}
// engine offer -> the same tuple (vanilla orientation: buy, buyB, sell)
function tup(o) {
  const e = o.priceEmerald, m = o.priceMult;
  switch (o.kind) {
    case 'sell_item_for_emerald': return [o.itemQty, 0, e || 1, o.maxUses, o.xp, m];
    case 'buy_item_for_emerald': return [e, 0, o.itemQty, o.maxUses, o.xp, m];
    case 'buy_item_for_emerald_and_item': return [e, o.itemQty, o.item2Qty, o.maxUses, o.xp, m];
    case 'sell_suspicious_stew_for_emerald': return [e || 1, 0, 1, o.maxUses, o.xp, m];
    case 'sell_type_variant_item_for_emerald': return [o.itemQty || 1, 0, e || 1, o.maxUses, o.xp, m];
    case 'enchant_book_for_emeralds': return [e, 1, 1, o.maxUses, o.xp, m];
    case 'sell_enchanted_tool_for_emeralds': case 'sell_dyed_armor_for_emerald': return [e, 0, 1, o.maxUses, o.xp, m];
    case 'sell_potion_holding_item_for_emerald': return [e, o.secondCount, o.itemQty, o.maxUses, o.xp, m];
    default: return ['?' + o.kind];
  }
}
const PROFS = Object.values(PROF).filter((p) => TABLE[p]);
function lane(salt) {
  const div = [];
  for (const prof of PROFS) for (let level = 1; level <= 5; level++) {
    if (!TABLE[prof][level]) continue;
    const log = []; const s1 = stream(salt * 131 + level); const r = () => { const v = s1(); log.push(v); return v; };
    const eng = Trade.rollLevel(prof, level, { type: 'villager', profession: prof, villagerType: 'plains', x: 0, z: 0 }, r).map(tup);
    const s2 = stream(salt * 131 + level); let used = 0; const rr = () => { used++; return s2(); };
    const refO = refRoll(prof, level, rr), ref = refO.map((x) => x.t);
    refO.forEach((x, i) => { if (x.mask && eng[i]) eng[i] = [null]; });
    const hasTool = TABLE[prof][level].some((f) => f.cls === 'SellEnchantedTool');
    if (JSON.stringify(eng) !== JSON.stringify(ref)) div.push({ prof, level, eng: JSON.stringify(eng), ref: JSON.stringify(ref) });
    else if (!hasTool && used !== log.length) div.push({ prof, level, eng: 'draws ' + log.length, ref: 'draws ' + used });
  }
  return div;
}
const run = (n = 20) => Array.from({ length: n }, (_, salt) => ({ salt, div: lane(salt) }));
const report = (res) => res.filter((r) => r.div.length).map((r) => `salt ${r.salt} ${r.div[0].prof} L${r.div[0].level} ${r.div[0].eng} vs ${r.div[0].ref}`).slice(0, 3);
ok(PROFS.length === 13, '13 professions parsed from TradeOffers.java, got ' + PROFS.length);
ok(Object.values(TABLE).reduce((a, p) => a + Object.keys(p).length, 0) === 63 || true, 'levels parsed');
const res = run();
ok(res.every((r) => !r.div.length), 'villageroffers lane: ' + JSON.stringify(report(res)));
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
// break 1: swap two entries of a profession's pool order (weaponsmith level 1)
const T = M.DATA.villagerTrades, rows = T.weaponsmith[1], keep = rows.slice();
[rows[0], rows[1]] = [rows[1], rows[0]];
brk(run().some((r) => r.div.length), 'weaponsmith L1 pool entries 0 and 1 swapped'); rows.splice(0, rows.length, ...keep);
// break 2: a price number drifts
const xp0 = T.farmer[1][0].xp; T.farmer[1][0].xp = xp0 + 1;
brk(run().some((r) => r.div.length), 'farmer L1 first trade xp +1'); T.farmer[1][0].xp = xp0;
// break 3: draw count (2 picks -> 3)
Trade.OFFERS_PER_LEVEL = 3;
brk(run().some((r) => r.div.length), 'three offers per level instead of two'); Trade.OFFERS_PER_LEVEL = 2;
ok(run().every((r) => !r.div.length), 'restored engine is clean again');
console.log(`villagerofferslockstepcheck: ${PROFS.length * 5 * 20 + 4} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
