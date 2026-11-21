#!/usr/bin/env node
// villagerreftradecheck.mjs — infra I6 (24 Sept 2026): every profession x level's rolled trade offers, the
// ENGINE (07p_trade.js) against the REAL 1.18.2 server (tools/referee/runtrades.mjs -> golden/villager-trades.json).
//
//   node tools/referee/runtrades.mjs            # once per machine/store (~7 min, the real server)
//   node tools/referee/villagerreftradecheck.mjs [--verbose]
//
// Engine side, end to end through the SAME joins a player hits (D-276): Trade.rollLevel(P, L) draws the
// level's offers; Trade.previewFor gives what the trade screen shows AND Trade.attempt charges (one join,
// D-483); the SELL stack is what Trade.attempt actually puts into an instabuild player's inventory (so a
// tag the offer object carries but the payout drops counts as dropped). World facts as the golden's:
// villager type plains, no structures (map offers are dropped on both sides).
//
// Per cell (profession/level), both samples as "per villager" rates:
//   1. offers per villager (mean, 5 sigma; exact when both sides are constant)
//   2. each offer KEY = buy ids + second-buy id + sell id + maxUses + xp + priceMultiplier: its rate
//   3. per key, each stack COUNT: exact when both sides are constant, else mean within 5 sigma
//   4. per key, the sell tag's features: enchantment ids (book:/ench:), potion ids, stew effects, dye colour
//      presence -- rate within 5 sigma; enchantment LEVEL and colour channels as means within 5 sigma
// Rates: an exact binomial test of the golden count against the engine's rate (P < 1e-5 fails).
// Anti-vacuity (D-30/D-305): three in-memory breaks of the engine's outcome, each must add a failure.
// No golden -> SKIP, exit 0. Golden: <referee dir>/golden, else ../mclite-store/golden (never committed, D-6).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { featuresOfTag } from './runtrades.mjs';

const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'villager-trades.json'),
  join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'villager-trades.json')].find((f) => existsSync(f));
if (!GOLDEN) {
  console.log('villagerreftradecheck: SKIP (golden not generated -- run node tools/referee/runtrades.mjs)');
  process.exit(0);
}
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));

let pass = 0, breaks = 0;
const ok = (fails, c, m) => { if (c) pass++; else fails.push(m); return c; };

// ---- the engine, loaded as tradecheck loads it, with the SHIPPED trade table (src/19_data.gen.js) ----
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07i_entitylist.js', '07ox_enchhelper.js', '07p_trade.js'] });
const imeta = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'items.meta.json'), 'utf8'));
M.Items.init({ items: readFileSync(join(MCLITE_ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: imeta.rawBytes });
const gen = readFileSync(join(MCLITE_ROOT, 'src', '19_data.gen.js'), 'utf8');
const vtm = /villagerTrades:\s*(\{.*\}),\s*$/m.exec(gen);
const fails0 = [];
ok(fails0, !!vtm, 'src/19_data.gen.js carries villagerTrades');
M.DATA = Object.assign({}, M.DATA, { villagerTrades: vtm ? JSON.parse(vtm[1]) : {} });
const T = M.Trade, Iv = M.Inventory, name = (i) => M.Items.nameOf(i);
// D-669: the golden reads the offer's RAW buy stack off NBT; what a player pays is
// `TradeOffer.getAdjustedFirstBuyItem()` (TradeOffer.java:74-79), clamped to the item's own max stack
// — librarian L4's `BuyForOneEmeraldFactory(WRITABLE_BOOK, 2, ..)` stores 2, charges 1. The engine side
// is read through previewFor (the adjusted count), so the golden's first-buy count is put through the
// same clamp, with the max stack the ITEM table owns (rule 3), not a number typed here.
for (const c of Object.values(golden.cells)) for (const v of c.offers) for (const o of v) {
  if (!o.a) continue;
  const id = M.Items.of(o.a[0]);
  const mx = id >= 0 && M.Items.maxStack ? M.Items.maxStack(id) : 64;
  if (o.a[1] > mx) o.a[1] = mx;
}

function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const N_E = 4000, Z = 5, SEED = 20260924;

/** N_E fresh villagers of prof at level, each -> [compact offer] in the golden's own shape. */
function engineCell(prof, level) {
  const rng = mulberry(SEED ^ (level * 7919) ^ prof.length * 104729);
  const saved = Math.random; Math.random = rng;            // Trade.attempt's xp-orb roll etc.: seeded too
  const out = [];
  try {
    for (let n = 0; n < N_E; n++) {
      const e = { type: 'villager', profession: prof, tradeProfession: prof, villagerType: 'plains', x: 0, y: 64, z: 0 };
      e.tradeOffers = T.rollLevel(prof, level, e, rng);
      e.villagerLevel = level; e.tradeXp = 0;
      e.tradeUses = e.tradeOffers.map(() => 0); e.tradeDemand = e.tradeOffers.map(() => 0); e.tradeSpecial = e.tradeOffers.map(() => 0);
      const v = [];
      for (let i = 0; i < e.tradeOffers.length; i++) {
        const o = e.tradeOffers[i];
        const pv = T.previewFor(o, e, i);
        const P = { inventory: Iv.create(), instabuild: true };
        const r = T.attempt(e, i, P);
        let got = null;
        if (r.ok) for (let k = 0; k < Iv.SIZE; k++) { const s = Iv.getItem(P.inventory, k); if (!Iv.isEmpty(s)) { got = s; break; } }
        v.push({ a: pv.in1 ? [name(pv.in1.i), pv.in1.n] : null, b: pv.in2 ? [name(pv.in2.i), pv.in2.n] : null,
          s: got ? [name(got.i), got.n] : null, u: o.maxUses, x: o.xp, m: Math.round(Math.fround(+(o.priceMult || 0)) * 1e4) / 1e4,
          t: featuresOfTag(got && got.t) });
      }
      out.push(v);
    }
  } finally { Math.random = saved; }
  return out;
}

const keyOf = (o) => `${o.a ? o.a[0] : '-'}+${o.b ? o.b[0] : '-'}>${o.s ? o.s[0] : '-'} u${o.u} x${o.x} m${o.m}`;
function coarse(f) {   // feature -> [rate key, numeric samples]
  let m;
  if ((m = /^(book|ench):([^:]+):(\d+)$/.exec(f))) return [[`${m[1]}:${m[2]}`, [[`${m[1]}:${m[2]}.lvl`, +m[3]]]]];
  if ((m = /^color:(\d+)$/.exec(f))) { const c = +m[1]; return [['color', [['color.r', c >> 16 & 255], ['color.g', c >> 8 & 255], ['color.b', c & 255]]]]; }
  return [[f, []]];
}
/** A sample (list of villagers) -> stats the comparison reads. */
function summarize(villagers) {
  const S = { n: villagers.length, offers: { sum: 0, sq: 0, min: 1e9, max: -1 }, keys: {} };
  for (const v of villagers) {
    const c = v.length; S.offers.sum += c; S.offers.sq += c * c; S.offers.min = Math.min(S.offers.min, c); S.offers.max = Math.max(S.offers.max, c);
    for (const o of v) {
      const K = S.keys[keyOf(o)] || (S.keys[keyOf(o)] = { hits: 0, per: new Map(), counts: {}, feats: {}, nums: {} });
      K.hits++; K.per.set(v, (K.per.get(v) || 0) + 1);
      for (const [slot, st] of [['a', o.a], ['b', o.b], ['s', o.s]]) if (st) {
        const q = K.counts[slot] || (K.counts[slot] = { sum: 0, sq: 0, min: 1e9, max: -1, n: 0 });
        q.n++; q.sum += st[1]; q.sq += st[1] * st[1]; q.min = Math.min(q.min, st[1]); q.max = Math.max(q.max, st[1]);
      }
      const seen = new Set();
      for (const f of o.t || []) for (const [rk, nums] of coarse(f)) {
        if (!seen.has(rk)) { seen.add(rk); K.feats[rk] = (K.feats[rk] || 0) + 1; }
        for (const [nk, x] of nums) { const q = K.nums[nk] || (K.nums[nk] = { sum: 0, sq: 0, n: 0 }); q.n++; q.sum += x; q.sq += x * x; }
      }
    }
  }
  for (const K of Object.values(S.keys)) {       // occurrences per villager (0, 1 or 2 -- a pool can hold one key twice)
    let sum = 0, sq = 0; for (const c of K.per.values()) { sum += c; sq += c * c; }
    K.pv = { sum, sq, n: S.n }; delete K.per;
  }
  return S;
}
const meanVar = (q) => { const m = q.sum / q.n; return [m, Math.max(0, q.sq / q.n - m * m)]; };
// Exact two-sided binomial test (log space): golden count k of n trials against the ENGINE's rate p, which
// is the model (4000 villagers). Normal approximations misfire at small counts (a 3-of-150 sample has
// almost no variance of its own). A rate the engine never produced is floored at half an engine event.
const P_FAIL = 1e-5;   // ~1,200 comparisons -> about 1% chance of any false red per run
const lgam = (() => { const c = [0]; return (n) => { while (c.length <= n) c.push(c[c.length - 1] + Math.log(c.length)); return c[n]; }; })();
function binomTwoSided(k, n, p) {
  if (n === 0) return 1;
  const lp = Math.log(p), lq = Math.log(1 - p);
  const pmf = (i) => Math.exp(lgam(n) - lgam(i) - lgam(n - i) + i * lp + (n - i) * lq);
  let lo = 0, hi = 0;
  for (let i = 0; i <= k; i++) lo += pmf(i);
  for (let i = k; i <= n; i++) hi += pmf(i);
  return Math.min(1, 2 * Math.min(lo, hi));
}
function rateOk(kE, nE, kG, nG) {   // engine kE of nE, golden kG of nG
  if (!nG) return true;
  const p = Math.min(Math.max(kE / nE, 0.5 / nE), 1 - 0.5 / nE);
  return binomTwoSided(kG, nG, p) >= P_FAIL;
}
const MIN_MEAN_N = 20;   // a mean compared on fewer golden samples than this says nothing
function meanOk(q1, q2) {
  const [m1, v1] = meanVar(q1), [m2, v2] = meanVar(q2);
  return Math.abs(m1 - m2) <= Z * Math.max(Math.sqrt(v1 / q2.n + v1 / q1.n + v2 / q2.n), 1e-9) + 1e-9;
}

/** Compare one cell: engine sample vs golden sample -> list of failure lines (and counts passes). */
function compareCell(cell, eng, gold) {
  const f = [];
  const E = summarize(eng), G = summarize(gold);
  if (E.offers.min === E.offers.max && G.offers.min === G.offers.max) ok(f, E.offers.min === G.offers.min, `${cell}: offers per villager ${E.offers.min} (engine) vs ${G.offers.min} (vanilla)`);
  else ok(f, meanOk({ ...E.offers, n: E.n }, { ...G.offers, n: G.n }), `${cell}: offers per villager mean ${(E.offers.sum / E.n).toFixed(3)} (engine) vs ${(G.offers.sum / G.n).toFixed(3)} (vanilla)`);
  for (const k of new Set([...Object.keys(E.keys), ...Object.keys(G.keys)])) {
    const ek = E.keys[k], gk = G.keys[k];
    const eh = ek ? ek.hits : 0, gh = gk ? gk.hits : 0;
    if (!ok(f, rateOk(eh, E.offers.sum, gh, G.offers.sum),
      `${cell}: offer ${k} per villager ${((ek ? ek.hits : 0) / E.n).toFixed(3)} (engine) vs ${((gk ? gk.hits : 0) / G.n).toFixed(3)} (vanilla)`) || !ek || !gk) continue;
    for (const slot of new Set([...Object.keys(ek.counts), ...Object.keys(gk.counts)])) {
      const qe = ek.counts[slot], qg = gk.counts[slot];
      if (!qe || !qg) { ok(f, false, `${cell}: ${k} ${slot}-stack present only in ${qe ? 'engine' : 'vanilla'}`); continue; }
      if (qe.min === qe.max && qg.min === qg.max) ok(f, qe.min === qg.min, `${cell}: ${k} ${slot} count ${qe.min} (engine) vs ${qg.min} (vanilla)`);
      else ok(f, meanOk(qe, qg), `${cell}: ${k} ${slot} count mean ${(qe.sum / qe.n).toFixed(2)} [${qe.min}..${qe.max}] (engine) vs ${(qg.sum / qg.n).toFixed(2)} [${qg.min}..${qg.max}] (vanilla)`);
    }
    for (const ft of new Set([...Object.keys(ek.feats), ...Object.keys(gk.feats)])) {
      ok(f, rateOk(ek.feats[ft] || 0, ek.hits, gk.feats[ft] || 0, gk.hits),
        `${cell}: ${k} tag ${ft} in ${(((ek.feats[ft] || 0) / ek.hits) * 100).toFixed(1)}% (engine) vs ${(((gk.feats[ft] || 0) / gk.hits) * 100).toFixed(1)}% (vanilla)`);
    }
    for (const nk of Object.keys(gk.nums)) {
      const qe = ek.nums[nk], qg = gk.nums[nk];
      if (!qe || qe.n < MIN_MEAN_N || qg.n < MIN_MEAN_N) continue;
      ok(f, meanOk(qe, qg), `${cell}: ${k} ${nk} mean ${(qe.sum / qe.n).toFixed(2)} (engine) vs ${(qg.sum / qg.n).toFixed(2)} (vanilla)`);
    }
  }
  return f;
}

// ---- 1. every cell ----
console.log(`villagerreftradecheck — engine x${N_E} vs the real 1.18.2 server (${golden.per} villagers/cell, ${golden.generatedAt}; ${GOLDEN})`);
const fails = [...fails0];
const cells = Object.keys(golden.cells).sort();
ok(fails, cells.length >= 65, `golden covers every profession x level (${cells.length}/65 cells)`);
const engineCache = {};
for (const cell of cells) {
  const [prof, lvl] = cell.split('/');
  const eng = engineCache[cell] = engineCell(prof, +lvl);
  const f = compareCell(cell, eng, golden.cells[cell].offers);
  fails.push(...f);
  if (VERBOSE) console.log(`  ${f.length ? '✗' : '✓'} ${cell}${f.length ? ' — ' + f.length + ' mismatch(es)' : ''}`);
}

// ---- 2. anti-vacuity: each break must ADD failures on a cell that otherwise has none of that kind ----
function breakCaught(label, cell, mutate) {
  const base = compareCell(cell, engineCache[cell], golden.cells[cell].offers).length;
  const mutated = engineCache[cell].map((v) => mutate(v.map((o) => ({ ...o, a: o.a && [...o.a], b: o.b && [...o.b], s: o.s && [...o.s], t: [...(o.t || [])] }))));
  const after = compareCell(cell, mutated, golden.cells[cell].offers).length;
  if (after > base) breaks++;
  else fails.push(`anti-vacuity: break "${label}" on ${cell} was NOT caught (${base} -> ${after} mismatches)`);
}
breakCaught('every offer +1 xp', 'farmer/1', (v) => v.map((o) => ({ ...o, x: o.x + 1 })));
breakCaught('sell count +1 on the static offers', 'farmer/2', (v) => v.map((o) => (o.s ? { ...o, s: [o.s[0], o.s[1] + 1] } : o)));
breakCaught('one pool entry never drawn', 'farmer/1', (v) => { const k = keyOf(engineCache['farmer/1'][0][0]); return v.filter((o) => keyOf(o) !== k); });

const uniq = [...new Set(fails)];
console.log(`  ${cells.length} cells · ${pass} comparisons pass · ${uniq.length} mismatch(es) · ${breaks}/3 breaks caught`);
for (const m of uniq.slice(0, VERBOSE ? 400 : 60)) console.log('FAIL  ' + m);
if (!VERBOSE && uniq.length > 60) console.log(`  … ${uniq.length - 60} more (--verbose)`);
for (let i = 0; i < breaks; i++) console.log('  ✓ anti-vacuity break caught');
// suite.mjs reads these two lines (`assertions passed ... N`, `failures ... N`)
console.log(`\n  assertions passed .. ${pass}\n  failures ........... ${uniq.length}\n  breaks caught ...... ${breaks}`);
process.exit(uniq.length ? 1 : 0);
