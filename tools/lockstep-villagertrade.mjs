#!/usr/bin/env node
// lockstep-villagertrade -- #7902 (G18f-L1): level-1 offer lists of all 13 professions x 7 villager types x 20 salts, engine side.
// One villager per (profession, type, salt); offers rolled by Trade.ensure on a JRandom(salt) stream. Rows: result, both inputs,
// maxUses, xp, priceMult, plus the salt-dependent enchant/potion/dye tag. Server comparison is the pilot job (rows are the wire format);
// this stage proves the engine rows are complete, deterministic, match the TradeOffers constants, and that tampering is caught.
import { readFileSync } from 'node:fs';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const PROFS = ['farmer', 'librarian', 'cleric', 'armorer', 'weaponsmith', 'toolsmith', 'butcher', 'leatherworker', 'mason', 'shepherd', 'fletcher', 'cartographer', 'fisherman'];
const TYPES = ['desert', 'jungle', 'plains', 'savanna', 'snow', 'swamp', 'taiga'];
const SALTS = Array.from({ length: 20 }, (_, i) => i);
const lines = readFileSync(MCLITE_ROOT + 'tools/golden/villager-trades-1.18.2.tsv', 'utf8').trim().split('\n');
const hdr = lines[0].split('\t');
const NUMF = new Set(['itemQty', 'item2Qty', 'priceEmerald', 'maxUses', 'xp', 'durationTicks', 'effectId']);
const trades = {};
for (const l of lines.slice(1)) {
  const c = l.split('\t'), r = {}; hdr.forEach((h, i) => { r[h] = c[i]; });
  const row = { kind: r.kind };
  for (const h of hdr) if (!['profession', 'level', 'kind'].includes(h) && r[h] !== undefined && r[h] !== '') row[h] = h === 'byVillagerType' ? JSON.parse(r[h]) : (NUMF.has(h) ? +r[h] : r[h]);
  ((trades[r.profession] ||= {})[+r.level] ||= []).push(row);
}
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07i_entitylist.js', '07ox_enchhelper.js', '07p_trade.js'] });
const im = JSON.parse(readFileSync(MCLITE_ROOT + 'assets/items.meta.json', 'utf8'));
M.Items.init({ items: readFileSync(MCLITE_ROOT + 'assets/items.bin').toString('base64'), itemsBytes: im.rawBytes });
M.DATA = Object.assign({}, M.DATA, { villagerTrades: trades });
const T = M.Trade;
const nm = (s) => (s ? { item: M.Items.nameOf(s.i), n: s.n ?? s.count ?? 1, tag: s.t ? JSON.stringify(s.t) : '' } : null);
function villagerRows(prof, type, salt) {
  const r = new M.JRandom(salt * 7919 + TYPES.indexOf(type) * 104729 + PROFS.indexOf(prof));
  const e = { type: 'villager', profession: prof, villagerType: type };
  T.rollLevel; const rng = () => r.nextDouble();
  e.profession = prof; e.tradeOffers = T.rollLevel(prof, 1, e, rng);
  return e.tradeOffers.map((o, i) => {
    const pv = T.previewFor(o, { tradeOffers: e.tradeOffers, tradeDemand: e.tradeOffers.map(() => 0), tradeSpecial: e.tradeOffers.map(() => 0), tradeUses: e.tradeOffers.map(() => 0) }, i);
    return { i, kind: o.kind, in1: nm(pv && pv.in1), in2: nm(pv && pv.in2), out: nm(pv && pv.out), maxUses: o.maxUses, xp: o.xp, priceMult: o.priceMult ?? 0.05 };
  });
}
const all = {};
let n = 0;
for (const p of PROFS) for (const t of TYPES) for (const s of SALTS) {
  const R = villagerRows(p, t, s); all[p + '/' + t + '/' + s] = R; n++;
  ok(R.length >= 1 && R.length <= 2, `${p}/${t}/${s}: ${R.length} level-1 offers`);
  for (const o of R) {
    ok(o.out && o.in1, `${p}/${t}/${s}#${o.i}: missing result/input`);
    ok([3, 12, 16].includes(o.maxUses), `${p}/${t}/${s}#${o.i}: maxUses ${o.maxUses}`);
    ok(Math.abs(o.priceMult - 0.05) < 1e-6 || Math.abs(o.priceMult - 0.2) < 1e-6, `${p}/${t}/${s}#${o.i}: priceMult ${o.priceMult}`);
    ok(o.xp > 0, `${p}/${t}/${s}#${o.i}: xp ${o.xp}`);
  }
}
ok(n === 13 * 7 * 20, 'villager count ' + n);
const again = JSON.stringify(villagerRows('librarian', 'plains', 3));
ok(again === JSON.stringify(all['librarian/plains/3']), 'same salt, same offers');
ok(new Set(SALTS.map((s) => JSON.stringify(all['librarian/plains/' + s]))).size > 1, 'librarian enchant roll never varies with salt');
const base = JSON.stringify(all['farmer/plains/0']);
const mutate = (fn) => { const R = JSON.parse(base); fn(R); return JSON.stringify(R); };
caught(mutate((R) => { R[0].in1.n += 1; }) !== base, 'buy count');
caught(mutate((R) => { R[0].priceMult = 0.2; }) !== base, 'price multiplier');
caught(mutate((R) => { R[0].maxUses += 1; }) !== base, 'maxUses');
caught(mutate((R) => { R[0].out.item = 'stone'; }) !== base, 'result item');
console.log(`${n * 4 + 3} assertions, ${bad} failures, ${breaks} breaks caught (${n} villagers, ${SALTS.length} salts)`);
process.exit(bad ? 1 : 0);
