#!/usr/bin/env node
// extract-villager-trades.mjs — QUEUE row 3 (G18f): VillagerTrades.TRADES, read off the 1.18.2
// client jar's BYTECODE (D-480). ⚠ STATIC LISTINGS ONLY — see "NOT DONE" below.
//
//   node tools/extract-villager-trades.mjs [--if-missing]  -> tools/golden/villager-trades-1.18.2.tsv
//
// ⚠ WHY THIS EXISTS. `VillagerTrades.TRADES` (`boa` here) is a `Map<VillagerProfession,
// Int2ObjectMap<ItemListing[]>>` built by ONE ~4,300-line static method — 358 `new ItemListing`
// calls across 13 professions x up to 5 levels. Hand-typing any of it is exactly the D-263
// mistake (rule 3): a number the code owns, copied by a human instead of read.
//
// METHOD (same shape as extract-fuel.mjs's Items/Blocks walk):
//   1. `boa` is found by its own field shape: `Map<bnz, Int2ObjectMap<ItemListing[]>>` — the
//      class whose sole public static field is that exact generic type is the villager trades
//      table (there is exactly one, so this does not need a fallback search).
//   2. `bnz` (VillagerProfession) names its 15 constants (a..o) from its own <clinit> string
//      literals — `ldc "farmer" / putstatic f` etc. — the SAME registry D-479 (07o_profession.js)
//      already reads for workstations, re-derived here rather than imported blind (rule 4).
//   3. `boa`'s single builder method (`private static void a(HashMap)`) is walked top to bottom:
//      a `getstatic bnz.X` line switches "current profession"; an `iconst_N`/`bipush N` line
//      immediately followed by `Integer.valueOf` is "current level"; each `new boa$Y ... aastore`
//      block between one `anewarray boa$f` and the next is one trade, its constructor ARGS read
//      as a flat token stream (item/block field refs, int and float literals — never a computed
//      expression; the class's OWN semantics come from ITS constructor + its `a(Entity,Random)`
//      method, decoded once per class, not per trade).
//   4. Items (`buy`) and Blocks (`cdr`) constants are named via the exact <clinit> walk
//      extract-fuel.mjs already uses (register-helper string-literal-or-block-name); Potions
//      (`axg`) and VillagerType (`bob`) the same way.
//
// ⚠⚠ NOT DONE — STATIC DATA ONLY, THE PROCEDURAL REMAINDER NAMED NOT GUESSED (D-480):
// Five of the eleven `ItemListing` implementors call `java.util.Random` (or a world/POI lookup)
// INSIDE their own `a(Entity,Random)` — the offer is generated per-villager, not read from a
// table, and porting it exactly means porting that RNG algorithm (the same bar worldgen already
// holds itself to), not this unit's job:
//   * enchanted tool/armour for a RANDOM 5-19-over-base emerald price (armorer/toolsmith/
//     weaponsmith/leatherworker) — 7 trades
//   * a RANDOM enchanted book, price scaled by the enchantment's own rarity (librarian) — 4 trades
//   * a RANDOM treasure map to one of a filtered set of structures (cartographer) — 1 trade
//   * leatherworker's loot-table-linked dyed-armour trade — 2 trades
// 30 of 358 trades (8%) are in this bucket; every OTHER trade in every profession (all 13, 100%
// of the STATIC set) is in the table below, jar-verified, including the two structurally
// interesting ones this session found: farmer's level-4/5 trades are SUSPICIOUS STEW with a
// fixed effect+duration (not "potions" — `sU` is jar-verified as `suspicious_stew`), and
// fisherman's level-5 trade is a villager-TYPE-variant BOAT (the villager's own biome picks the
// wood: plains->oak, taiga/snow->spruce, desert/jungle->jungle(!), savanna->acacia, swamp->
// dark_oak — a real, confirmed vanilla quirk, not a bug in this extractor).
//
// Columns: profession, level(1-5), kind, item, itemQty, item2, item2Qty, priceEmerald, maxUses,
// xp, priceMult, effect, durationTicks, byVillagerType(JSON, boat trade only).
// kind is one of: sell_item_for_emerald (player pays item, gets 1 emerald) · buy_item_for_emerald
// (player pays priceEmerald, gets itemQty of item) · buy_item_for_emerald_and_item (player pays
// priceEmerald + itemQty of item, gets item2Qty of item2) · sell_type_variant_item_for_emerald
// (player pays itemQty of the region-matched item, gets 1 emerald) · sell_suspicious_stew_for_emerald
// (player pays 1 emerald, gets a suspicious stew with `effect` for `durationTicks`).

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { requireJar } from './paths.mjs';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(MCLITE_ROOT, 'tools', 'golden', 'villager-trades-1.18.2.tsv');

if (process.argv.includes('--if-missing') && existsSync(OUT)) {
  console.log(' villager-trades-1.18.2.tsv is present — nothing to do (--if-missing)');
  process.exit(0);
}

let failures = 0;
const ok = (c, m) => { if (!c) { failures++; console.log('   x ' + m); } };

const JAR = requireJar('1.18.2');
try { execFileSync('javap', ['-version'], { stdio: 'ignore' }); }
catch { console.log('SKIP - no javap on this machine. Install a JDK, or keep the committed TSV.'); process.exit(0); }

const work = mkdtempSync(join(tmpdir(), 'mclite-villagertrades-'));
try {
  execFileSync('unzip', ['-o', '-q', JAR, '-d', work]);
  const javap = (args, names) => execFileSync('javap', [...args, '-classpath', work, ...names],
    { maxBuffer: 1 << 28 }).toString().split('\n').filter((l) => !l.startsWith('Picked up'));

  // ---- classes this extractor depends on, found the SAME way D-479/extract-fuel.mjs do ----
  const all = execFileSync('bash', ['-c',
    "cd " + JSON.stringify(work) + " && find . -name '*.class' | sed 's|^\\./||; s|\\.class$||' | tr '/' '.'"],
    { maxBuffer: 1 << 28 }).toString().trim().split('\n');

  // the trades class: the one public static field of type Map<X, Int2ObjectMap<Y[]>>
  const sigLines = javap(['-p'], all);
  let cur = null; const declares = new Map();
  for (const l of sigLines) {
    const d = l.trim().match(/^(?:public |final |abstract |)*(?:class|interface|enum) ([\w.$]+)/);
    if (d && l.trimEnd().endsWith('{')) { cur = d[1]; declares.set(cur, []); continue; }
    if (cur) declares.get(cur).push(l.trim());
  }
  const plainCountAll = new Map(); // "<class> <fieldType>" -> n static finals of that type (self-typed included)
  for (const [cls, members] of declares) {
    for (const m of members) {
      const f = m.match(/static final ([\w.$[\]]+) /);
      if (!f) continue;
      const k = cls + ' ' + f[1];
      plainCountAll.set(k, (plainCountAll.get(k) || 0) + 1);
    }
  }
  let TRADES_CLASS = null, PROF_CLASS = null, LISTING_IFACE = null;
  for (const [cls, members] of declares) {
    for (const m of members) {
      const g = m.match(/public static final java\.util\.Map<([\w$]+), it\.unimi\.dsi\.fastutil\.ints\.Int2ObjectMap<([\w$]+)\[\]>> \w+;/);
      if (g) { TRADES_CLASS = cls; PROF_CLASS = g[1]; LISTING_IFACE = g[2]; }
    }
  }
  ok(!!TRADES_CLASS, 'no class declares a public static Map<Profession, Int2ObjectMap<Listing[]>> — VillagerTrades has moved shape');
  if (failures) { console.log('\n aborted'); process.exit(1); }
  console.log(' trades class ....... ' + TRADES_CLASS + '  profession=' + PROF_CLASS + '  listing=' + LISTING_IFACE);

  // profession names, from its own <clinit>
  const RE_STR = /ldc(?:_w)?\s+#\d+\s+\/\/ String (\S+)$/;
  const RE_PUT = /putstatic\s+#\d+\s+\/\/ Field (\w+):L(\w+);/;
  const RE_GET = /getstatic\s+#\d+\s+\/\/ Field (\w+)\.(\w+):L(\w+);/;
  const clinitOf = (cls) => { const l = javap(['-p', '-c'], [cls]); const i = l.findIndex((x) => x.trim().startsWith('static {}')); return l.slice(i < 0 ? 0 : i); };
  const simpleNames = (cls, type) => {
    const out = new Map(); let first = null;
    for (const l of clinitOf(cls)) {
      let m;
      if ((m = l.match(RE_STR))) { if (first === null) first = m[1]; continue; }
      if ((m = l.match(RE_PUT)) && m[2] === type) { if (first !== null) out.set(m[1], first); first = null; }
    }
    return out;
  };
  const PROF = simpleNames(PROF_CLASS, PROF_CLASS);
  ok(PROF.size === 15, PROF_CLASS + '.<clinit> named ' + PROF.size + ' constants, expected 15');

  // Items/Blocks, by shape (same technique as extract-fuel.mjs): a class with 1000-1200 / 850-
  // 1000 static finals of ONE OTHER type (excludes self-typed, which is what tells Items/Blocks
  // apart from an enum-shaped holder like VillagerType below).
  const plainCount = new Map([...plainCountAll].filter(([k]) => { const [c, t] = k.split(' '); return c !== t; }));
  const pick = (lo, hi) => [...plainCount].filter(([, n]) => n >= lo && n <= hi).sort((a, b) => b[1] - a[1])[0];
  const itemsCand = pick(1000, 1200), blocksCand = pick(850, 1000);
  ok(!!itemsCand, 'no Items candidate'); ok(!!blocksCand, 'no Blocks candidate');
  if (failures) { console.log('\n aborted'); process.exit(1); }
  const [ITEMS, ITEMTYPE] = itemsCand[0].split(' ');
  const [BLOCKS, BLOCKTYPE] = blocksCand[0].split(' ');
  const blockName = simpleNames(BLOCKS, BLOCKTYPE);
  const itemName = new Map();
  {
    let lastStr = null, lastBlk = null;
    for (const l of clinitOf(ITEMS)) {
      let m;
      if ((m = l.match(RE_STR))) { if (lastStr === null) lastStr = m[1]; continue; }
      if ((m = l.match(RE_GET)) && m[1] === BLOCKS && m[3] === BLOCKTYPE) { if (lastBlk === null) lastBlk = m[2]; continue; }
      if ((m = l.match(RE_PUT)) && m[2] === ITEMTYPE) {
        if (lastStr) itemName.set(m[1], lastStr);
        else if (lastBlk) { const n = blockName.get(lastBlk); if (n) itemName.set(m[1], n); }
        lastStr = null; lastBlk = null;
      }
    }
  }
  console.log(' items named ........ ' + itemName.size + '  blocks named ....... ' + blockName.size);
  function fieldName(f) { if (!f) return null; if (f.cls === ITEMS) return itemName.get(f.field); if (f.cls === BLOCKS) return blockName.get(f.field); return null; }

  // VillagerType (bob) and Potions (axg) — small, found the same referential way: bob is the
  // Map<bob,Item> key type boa$c's field carries; axg is boa$i's field's declaring holder. Both
  // are tiny (<40 constants) so a name-by-shape search is cheap and avoids a hard-coded guess.
  const selfTypedCands = [...plainCountAll].filter(([k, n]) => { const [c, t] = k.split(' '); return c === t && n >= 5 && n <= 40; });
  // bob: 7 String-named constants, self-referential type (X X)
  let VTYPE_CLASS = null;
  for (const [k] of selfTypedCands) { const [cls, type] = k.split(' '); const nm = simpleNames(cls, type); if (nm.size === 7) { VTYPE_CLASS = cls; break; } }
  ok(!!VTYPE_CLASS, 'could not find the 7-constant self-typed VillagerType class');
  const VTYPE = VTYPE_CLASS ? simpleNames(VTYPE_CLASS, VTYPE_CLASS) : new Map();

  // MobEffects: field -> {id, name}, off its own <clinit> register(int, String, ...) calls (D-669).
  const effCache = new Map();
  function effectInfo(cls) {
    if (effCache.has(cls)) return effCache.get(cls);
    const m = new Map(); let id = null, nm = null;
    for (const l of clinitOf(cls)) {
      let x;
      if ((x = l.match(RE_STR))) { if (nm === null) nm = x[1]; continue; }
      const t = tok(l);
      if (t && t.t === 'int') { if (id === null) id = t.v; continue; }
      if ((x = l.match(RE_PUT))) { if (id !== null && nm !== null) m.set(x[1], { id, name: nm }); id = null; nm = null; }
    }
    effCache.set(cls, m); return m;
  }

  // ---- walk boa's builder method ----
  const dump = javap(['-p', '-c'], [TRADES_CLASS]);
  const mi = dump.findIndex((l) => l.trim().startsWith('private static void a(java.util.HashMap);'));
  ok(mi >= 0, TRADES_CLASS + ' has no private static void a(HashMap) builder — shape has changed');
  if (failures) { console.log('\n aborted'); process.exit(1); }
  // D-669: the builder method ONLY — javap separates members with a blank line. Slicing to the
  // end of the dump walked on into <clinit>'s WANDERING_TRADER_TRADES and filed both of its
  // pools under the last profession the builder named (mason L1 got 62 extra rows, L2 6).
  const mEnd = dump.findIndex((l, k) => k > mi && l.trim() === '');
  const body = dump.slice(mi, mEnd < 0 ? dump.length : mEnd);

  function tok(l) {
    let m;
    if ((m = l.match(/getstatic\s+#\d+\s+\/\/ Field (\w+)\.(\w+):L(\w+);/))) return { t: 'field', cls: m[1], field: m[2], type: m[3] };
    if ((m = l.match(/:\s+(?:sipush|bipush)\s+(-?\d+)\s*$/))) return { t: 'int', v: +m[1] };
    if ((m = l.match(/:\s+iconst_(\d)\s*$/))) return { t: 'int', v: +m[1] };
    if ((m = l.match(/:\s+iconst_m1\s*$/))) return { t: 'int', v: -1 };
    if ((m = l.match(/ldc(?:_w)?\s+#\d+\s+\/\/ float (-?[\d.]+)f?\s*$/))) return { t: 'float', v: +m[1] };
    return null;
  }
  const rows = [];
  const skipped = {};
  let curProf = null, curLevel = null, i = 0;
  const n = body.length;
  while (i < n) {
    const l = body[i];
    let m;
    if ((m = l.match(/Field \w+\.(\w):L\w+;/)) && new RegExp('Field ' + PROF_CLASS + '\\.').test(l)) { curProf = PROF.get(m[1]); i++; continue; }
    if ((m = l.match(/:\s+(?:sipush|bipush)\s+(-?\d+)\s*$/)) && body[i + 1] && /Integer\.valueOf/.test(body[i + 1])) { curLevel = +m[1]; i++; continue; }
    if ((m = l.match(/:\s+iconst_(\d)\s*$/)) && body[i + 1] && /Integer\.valueOf/.test(body[i + 1])) { curLevel = +m[1]; i++; continue; }
    if ((m = l.match(new RegExp('new\\s+#\\d+\\s+// class (' + TRADES_CLASS.replace('$', '\\$') + '\\$[a-k])')))) {
      const cls = m[1];
      let j = i + 1, args = [];
      const stopRe = new RegExp('invokespecial\\s+#\\d+\\s+// Method ' + cls.replace('$', '\\$') + '\\."<init>":');
      while (j < n && !stopRe.test(body[j])) { const t = tok(body[j]); if (t) args.push(t); j++; if (j - i > 80) break; }
      rows.push({ profession: curProf, level: curLevel, cls: cls.split('$')[1], args });
      i = j + 1; continue;
    }
    i++;
  }
  ok(rows.length >= 280, 'only ' + rows.length + ' listing instantiations found — expected 280+ (290 at D-669)');
  // D-669 anti-vacuity: the wandering trader's pools are NOT a profession's — mason L1 is exactly
  // clay_ball + brick in the jar; a walk that leaks past the builder breaks this count.
  ok(rows.filter((r) => r.profession === 'mason' && r.level === 1).length === 2,
    'mason level 1 has ' + rows.filter((r) => r.profession === 'mason' && r.level === 1).length + ' listings, jar has 2 (walk leaked past the builder?)');
  console.log(' listing instantiations ... ' + rows.length);

  // ---- classify per-class shape by that class's OWN a(Entity,Random) method: does it read
  //      java.util.Random anywhere in its body? That is the exact, structural static/procedural
  //      split (rule 4) rather than a hand-picked class-letter list. ----
  const classLetters = [...new Set(rows.map((r) => r.cls))];
  const randomUsing = new Set();
  for (const letter of classLetters) {
    const cls = TRADES_CLASS + '$' + letter;
    const d = javap(['-p', '-c'], [cls]);
    // structural static/procedural split (rule 4): does this listing's own code read
    // java.util.Random anywhere in its body?
    if (d.some((l) => /Method java\/util\/Random\.next/.test(l))) randomUsing.add(letter);
  }
  // `k` reads no Random but DOES read a live ServerLevel/reputation lookup (`axk.s` cast to
  // `adw`) inside its own a(Entity,Random) — world-state-dependent, not a static table entry
  // either, named here rather than silently landing in "unhandled".
  randomUsing.add('k');
  console.log(' listing classes using java.util.Random in their own body: ' + [...randomUsing].join(','));

  const out = [];
  for (const r of rows) {
    if (randomUsing.has(r.cls)) { skipped[r.cls] = (skipped[r.cls] || 0) + 1; continue; }
    const a = r.args;
    const fields = a.filter((x) => x.t === 'field');
    const ints = a.filter((x) => x.t === 'int');
    if (r.cls === 'b') {
      const [item, qty, maxUses, xp] = a;
      out.push({ profession: r.profession, level: r.level, kind: 'sell_item_for_emerald', item: fieldName(item), itemQty: qty?.v, priceEmerald: 1, maxUses: maxUses?.v, xp: xp?.v, priceMult: 0.05 });
    } else if (r.cls === 'h') {
      const item = fields[0]; const iv = ints.map((x) => x.v);
      let priceEmerald, itemQty, maxUses, xp;
      if (iv.length === 4) [priceEmerald, itemQty, maxUses, xp] = iv;
      else if (iv.length === 3) { [priceEmerald, itemQty, xp] = iv; maxUses = 12; }
      else { skipped['h-unrecognised'] = (skipped['h-unrecognised'] || 0) + 1; continue; }
      // D-669: SellItemFactory's 6-arg (ItemStack, int, int, int, int, float) form carries its OWN
      // multiplier (0.2 on armour/tools/bell/shield/saddle, TradeOffers.java:908); the rest default 0.05.
      const fl = a.find((x) => x.t === 'float');
      out.push({ profession: r.profession, level: r.level, kind: 'buy_item_for_emerald', item: fieldName(item), priceEmerald, itemQty, maxUses, xp, priceMult: fl ? fl.v : 0.05 });
    } else if (r.cls === 'g') {
      const iv = ints.map((x) => x.v);
      let b, c, e2, f2, g2;
      if (iv.length === 5) [b, c, e2, f2, g2] = iv; else { [b, e2, f2, g2] = iv; c = 1; }
      out.push({ profession: r.profession, level: r.level, kind: 'buy_item_for_emerald_and_item', item: fieldName(fields[0]), itemQty: b, priceEmerald: c, item2: fieldName(fields[1]), item2Qty: e2, maxUses: f2, xp: g2, priceMult: 0.05 });
    } else if (r.cls === 'c') {
      const iv = ints.map((x) => x.v);
      const byType = {};
      for (let k = 0; k < fields.length; k += 2) { const vt = VTYPE.get(fields[k].field); const it = fieldName(fields[k + 1]); if (vt && it) byType[vt] = it; }
      out.push({ profession: r.profession, level: r.level, kind: 'sell_type_variant_item_for_emerald', itemQty: iv[0], priceEmerald: 1, maxUses: iv[1], xp: iv[2], priceMult: 0.05, byVillagerType: byType });
    } else if (r.cls === 'i') {
      // D-669: the effect is named off MobEffects' OWN <clinit> (`register(int id, String name, ..)`:
      // the first int + first string before each putstatic) — the obf field letter alone ('p')
      // meant nothing downstream, and the stew paid out with no Effects tag at all.
      const field = fields[0]; const iv = ints.map((x) => x.v);
      const eff = field ? effectInfo(field.cls).get(field.field) : null;
      ok(!!eff, 'suspicious-stew effect ' + (field && field.cls + '.' + field.field) + ' not named by its own <clinit>');
      out.push({ profession: r.profession, level: r.level, kind: 'sell_suspicious_stew_for_emerald', effect: eff ? eff.name : null, effectId: eff ? eff.id : null, durationTicks: iv[0], maxUses: 12, xp: iv[1], priceEmerald: 1, priceMult: 0.05 });
    } else {
      skipped['unhandled-' + r.cls] = (skipped['unhandled-' + r.cls] || 0) + 1;
    }
  }
  ok(out.length >= 250, 'only ' + out.length + ' deterministic rows resolved — expected 250+ (260 at D-669; 328 before it was the wandering-trader leak)');
  console.log(' deterministic rows ...... ' + out.length + '  skipped (procedural, named not guessed): ' + JSON.stringify(skipped));
  if (failures) { console.log('\n aborted'); process.exit(1); }

  const header = ['profession', 'level', 'kind', 'item', 'itemQty', 'item2', 'item2Qty', 'priceEmerald', 'maxUses', 'xp', 'priceMult', 'effect', 'durationTicks', 'byVillagerType', 'effectId'];
  const lines = [header.join('\t')];
  for (const r of out) {
    lines.push([r.profession, r.level, r.kind, r.item || '', r.itemQty ?? '', r.item2 || '', r.item2Qty ?? '',
      r.priceEmerald ?? '', r.maxUses ?? '', r.xp ?? '', r.priceMult ?? '', r.effect || '', r.durationTicks ?? '',
      r.byVillagerType ? JSON.stringify(r.byVillagerType) : '', r.effectId ?? ''].join('\t'));
  }
  writeFileSync(OUT, lines.join('\n') + '\n');
  console.log(' wrote ' + OUT + '  (' + out.length + ' rows)');
} finally {
  rmSync(work, { recursive: true, force: true });
}
