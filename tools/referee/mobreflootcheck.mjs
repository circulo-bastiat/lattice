#!/usr/bin/env node
// mobreflootcheck.mjs — infra I6 (24 Sept 2026): every mob loot table, the ENGINE's roller against the
// REAL 1.18.2 server's rolls (tools/referee/runloot.mjs -> golden/mob-loot.json).
//
//   node tools/referee/runloot.mjs          # once per machine/store (a few minutes, the real server)
//   node tools/referee/mobreflootcheck.mjs [--verbose]
//
// Context on both sides is the one `/loot ... loot <table>` gives: ORIGIN only — no killer, no
// looting, not on fire, not killed by a player (LootCommand.executeLoot). So this covers the
// unconditional part of every table: which items, how often, how many (set_count/uniform/binomial,
// random_chance, sheep colour sub-tables). killed_by_player/looting/on-fire rows are mobslootcheck's.
//
// Statistics: the golden holds N_v rolls per table (count, hits, sum, sum of squares, max per item);
// the engine rolls N_e = 4000 with a fixed seed. Per item: drop RATE and MEAN count per roll must
// agree within Z = 5 standard errors (both samples' variance), and an item seen in one and never in
// the other at > 2% is a mismatch. Z = 5 over ~300 comparisons keeps a false red below 1 in 10^4.
// Anti-vacuity (D-30/D-305): three in-memory breaks of the ENGINE's rolls, each must be caught.
//
// No golden -> SKIP, exit 0 (as mobdefaultscheck). Golden: <referee dir>/golden, else the store
// checkout ../mclite-store/golden (a cloud container), never committed to mclite (D-6).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';

const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'mob-loot.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'mob-loot.json')].find((f) => existsSync(f));
if (!GOLDEN) {
  console.log('mobreflootcheck: SKIP (golden not generated -- run node tools/referee/runloot.mjs)');
  process.exit(0);
}
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };

const M = loadEngine({ extra: ['02f_tags.js', '07d_mining.js', '07e_loot.js'], dom: false });
const L = M.Loot;
ok(L && L.ready, 'Loot.init ran');

const N_E = 4000, Z = 5, SEED = 20260924;

/** Roll a table N times in the engine -> the golden's own shape. `mutate` (anti-vacuity) edits each roll. */
function engineStats(table, mutate) {
  const rng = L.rng(SEED);
  const rec = { rolls: 0, empty: 0, items: {} };
  for (let i = 0; i < N_E; i++) {
    let drops = L.rollTable(table.startsWith('gameplay/') ? table : 'entities/' + table, { rng });
    if (mutate) drops = mutate(drops);
    rec.rolls++;
    const per = {};
    for (const s of drops) if (s.count > 0) per[s.item] = (per[s.item] || 0) + s.count;
    if (!Object.keys(per).length) rec.empty++;
    for (const [id, n] of Object.entries(per)) {
      const x = rec.items[id] || (rec.items[id] = { total: 0, sq: 0, hits: 0, max: 0 });
      x.total += n; x.sq += n * n; x.hits++; x.max = Math.max(x.max, n);
    }
  }
  return rec;
}

/** Compare one table: returns a list of human-readable mismatches (empty = agree). */
function compare(table, van, eng) {
  const out = [];
  const ids = new Set([...Object.keys(van.items), ...Object.keys(eng.items)]);
  const nv = van.rolls, ne = eng.rolls;
  for (const id of ids) {
    const v = van.items[id] || { total: 0, sq: 0, hits: 0, max: 0 };
    const e = eng.items[id] || { total: 0, sq: 0, hits: 0, max: 0 };
    const pv = v.hits / nv, pe = e.hits / ne;
    if ((v.hits === 0 && pe > 0.02) || (e.hits === 0 && pv > 0.02)) {
      out.push(`${table}: ${id} drops ${(pe * 100).toFixed(1)}% in the engine, ${(pv * 100).toFixed(1)}% on the server`);
      continue;
    }
    const p = (v.hits + e.hits) / (nv + ne);
    const seP = Math.sqrt(p * (1 - p) * (1 / nv + 1 / ne)) || 1e-9;
    if (Math.abs(pe - pv) > Z * seP + 1e-9) out.push(`${table}: ${id} drop rate engine ${(pe * 100).toFixed(1)}% vs server ${(pv * 100).toFixed(1)}% (${(Math.abs(pe - pv) / seP).toFixed(1)} sigma)`);
    const mv = v.total / nv, me = e.total / ne;
    const varV = Math.max(v.sq / nv - mv * mv, 0), varE = Math.max(e.sq / ne - me * me, 0);
    const seM = Math.sqrt(varV / nv + varE / ne) || 1e-9;
    if (Math.abs(me - mv) > Z * seM + 1e-9) out.push(`${table}: ${id} mean count engine ${me.toFixed(3)} vs server ${mv.toFixed(3)} per roll (${(Math.abs(me - mv) / seM).toFixed(1)} sigma)`);
  }
  return out;
}

console.log(`mobreflootcheck -- ${Object.keys(golden.tables).length} entity loot tables, engine x${N_E} vs real 1.18.2 server x${golden.rolls} (${golden.generatedAt})`);
let compared = 0;
const missing = [], unpackedGameplay = [];
for (const [table, van] of Object.entries(golden.tables)) {
  if (!van.rolls) continue;
  const full = table.startsWith('gameplay/') ? table : 'entities/' + table;
  if (!L.hasTable(full)) {
    // an entity table the engine lacks is a finding; a gameplay/ table (bartering, cat gifts,
    // fishing junk...) only belongs to a feature that may not exist yet -- listed, not failed.
    if (table.startsWith('gameplay/')) { unpackedGameplay.push(table); continue; }
    missing.push(table); ok(false, `entities/${table}: the server has it, the engine never packed it`); continue;
  }
  const eng = engineStats(table);
  const diffs = compare(table, van, eng);
  compared++;
  ok(!diffs.length, diffs.join('\n     '));
  if (VERBOSE && !diffs.length) console.log(`   ✓ ${table}`);
}
ok(compared >= 50, `compared ${compared} tables (the 1.18.2 jar has ~90 entity tables; a tiny number means the golden or the packing broke)`);

// ── anti-vacuity: break the engine's rolls three ways; each must produce a mismatch ──────────────
console.log('\nanti-vacuity');
const caught = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); console.log('   ' + (c ? '✓' : '✗') + ' ' + m); };
if (golden.tables.cow && golden.tables.cow.rolls >= 50) {
  caught(compare('cow', golden.tables.cow, engineStats('cow', (d) => d.map((s) => (s.item === 'beef' ? { item: s.item, count: s.count + 1 } : s)))).length > 0,
    'cow beef +1 per roll (a set_count off by one) is caught');
  caught(compare('cow', golden.tables.cow, engineStats('cow', (d) => d.filter((s) => s.item !== 'leather'))).length > 0,
    'cow never dropping leather (a lost pool) is caught');
} else { caught(false, 'golden has cow with >= 50 rolls (needed for the breaks)'); caught(false, 'ditto'); }
if (golden.tables.zombie && golden.tables.zombie.rolls >= 50) {
  caught(compare('zombie', golden.tables.zombie, engineStats('zombie', (d) => d.concat([{ item: 'iron_ingot', count: 1 }]))).length > 0,
    'zombie always dropping an iron ingot (a killed_by_player row leaking into a no-killer roll) is caught');
} else caught(false, 'golden has zombie with >= 50 rolls');

console.log('');
console.log('================ mobreflootcheck (I6) ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks - fails.filter((f) => f.startsWith('anti-vacuity')).length}`);
if (unpackedGameplay.length) console.log(` not in the engine (gameplay/, not failed): ${unpackedGameplay.join(', ')}`);
if (missing.length) console.log(` engine lacks ${missing.length} table(s): ${missing.join(', ')}`);
for (const f of fails.slice(0, 40)) console.log('   ✗ ' + f);
if (fails.length > 40) console.log(`   ... and ${fails.length - 40} more`);
console.log('=====================================================');
process.exit(fails.length ? 1 : 0);
