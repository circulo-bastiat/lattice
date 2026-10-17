#!/usr/bin/env node
// mobreffirecheck.mjs — infra I6 (24 Sept 2026): the cooked-when-burning loot rule, the ENGINE against the REAL
// 1.18.2 server's `/loot ... kill <mob>` on a burning and a cold mob (tools/referee/runfire.mjs ->
// golden/mob-fire-loot.json). Every entity table with an `is_on_fire` row (from the jar), both states.
//
//   node tools/referee/runfire.mjs      # once per machine/store (~1.5 min, the real server)
//   node tools/referee/mobreffirecheck.mjs [--verbose]
//
// Context on both sides: THIS entity = the mob (isOnFire true/false), no killer, no looting, not killed by a
// player. Engine side: Loot.rollTable('entities/<table>', {type, isOnFire}) -- the same interpreter
// Loot.entityDrops runs. Statistics as blockrefdropcheck (rates + means, 5 sigma, pooled variance).
// Anti-vacuity (D-30/D-305): three in-memory breaks. No golden -> SKIP, exit 0. Never committed (D-6).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';

const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'mob-fire-loot.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'mob-fire-loot.json')].find((f) => existsSync(f));
if (!GOLDEN) {
  console.log('mobreffirecheck: SKIP (golden not generated -- run node tools/referee/runfire.mjs)');
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

function engineStats(c, mutate) {
  const rng = L.rng(SEED);
  const rec = { rolls: 0, empty: 0, items: {} };
  for (let i = 0; i < N_E; i++) {
    let drops = L.rollTable('entities/' + c.table, { rng, type: c.mob, isOnFire: c.fire });
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

/** Compare one case: returns a list of human-readable mismatches (empty = agree).
 *  With 160 server rolls a rare drop (a 0.8% apple) is often never seen, so: a one-sided item is only a
 *  mismatch outright when the zero side should have seen >= 10 of it; otherwise the pooled tests decide,
 *  and the mean test uses the POOLED per-roll variance (a side with no hits has variance 0 -- using it
 *  alone made a 0.8%-vs-0/160 apple a 5.6-sigma red). */
function compare(name, van, eng) {
  const out = [];
  const ids = new Set([...Object.keys(van.items), ...Object.keys(eng.items)]);
  const nv = van.rolls, ne = eng.rolls;
  for (const id of ids) {
    const v = van.items[id] || { total: 0, sq: 0, hits: 0, max: 0 };
    const e = eng.items[id] || { total: 0, sq: 0, hits: 0, max: 0 };
    const pv = v.hits / nv, pe = e.hits / ne;
    if ((v.hits === 0 && pe * nv >= 10) || (e.hits === 0 && pv * ne >= 10)) {
      out.push(`${name}: ${id} drops ${(pe * 100).toFixed(1)}% in the engine, ${(pv * 100).toFixed(1)}% on the server`);
      continue;
    }
    const p = (v.hits + e.hits) / (nv + ne);
    const seP = Math.sqrt(p * (1 - p) * (1 / nv + 1 / ne)) || 1e-9;
    if (Math.abs(pe - pv) > Z * seP + 1e-9) out.push(`${name}: ${id} drop rate engine ${(pe * 100).toFixed(1)}% vs server ${(pv * 100).toFixed(1)}% (${(Math.abs(pe - pv) / seP).toFixed(1)} sigma)`);
    const mv = v.total / nv, me = e.total / ne;
    const mp = (v.total + e.total) / (nv + ne);
    const varP = Math.max((v.sq + e.sq) / (nv + ne) - mp * mp, 0);
    const varV = Math.max(v.sq / nv - mv * mv, 0), varE = Math.max(e.sq / ne - me * me, 0);
    const seM = Math.sqrt(Math.max(varV, varP) / nv + Math.max(varE, varP) / ne) || 1e-9;
    if (Math.abs(me - mv) > Z * seM + 1e-9) out.push(`${name}: ${id} mean count engine ${me.toFixed(3)} vs server ${mv.toFixed(3)} per roll (${(Math.abs(me - mv) / seM).toFixed(1)} sigma)`);
  }
  return out;
}

const cases = Object.entries(golden.cases);
console.log(`mobreffirecheck -- ${cases.length} burning/cold cases, engine x${N_E} vs real 1.18.2 server x${golden.rolls} (${golden.generatedAt})`);
ok(!(golden.notes || []).some((n) => /NOT burning/.test(n)), 'every burning mob was still burning after its rolls (golden notes)');
let compared = 0, cooked = 0;
for (const [key, van] of cases) {
  if (!van.rolls) continue;
  if (!L.hasTable('entities/' + van.table)) { ok(false, `entities/${van.table}: the engine never packed it`); continue; }
  const diffs = compare(key, van, engineStats(van));
  compared++;
  if (van.fire && Object.keys(van.items).some((i) => i.startsWith('cooked_'))) cooked++;
  if (ok(!diffs.length, diffs.join('\n     ')) && VERBOSE) console.log(`   ✓ ${key}`);
}
ok(compared >= 20, `compared ${compared} cases (the 1.18.2 jar gives 16 mobs x 2)`);
ok(cooked >= 10, `${cooked} burning cases dropped a cooked_* item on the server (the golden really burned them)`);

console.log('\nanti-vacuity');
const caught = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); console.log('   ' + (c ? '✓' : '✗') + ' ' + m); };
const G = golden.cases;
if (G['cow|fire']) caught(compare('cow|fire', G['cow|fire'], engineStats(G['cow|fire'], (d) => d.map((s) => (s.item === 'cooked_beef' ? { item: 'beef', count: s.count } : s)))).length > 0,
  'a burning cow dropping raw beef (furnace_smelt lost) is caught');
else caught(false, 'golden has cow|fire');
if (G['pig|cold']) caught(compare('pig|cold', G['pig|cold'], engineStats(G['pig|cold'], (d) => d.map((s) => (s.item === 'porkchop' ? { item: 'cooked_porkchop', count: s.count } : s)))).length > 0,
  'a cold pig dropping cooked porkchop (on_fire read as always true) is caught');
else caught(false, 'golden has pig|cold');
if (G['salmon|fire']) caught(compare('salmon|fire', G['salmon|fire'], engineStats(G['salmon|fire'], (d) => d.filter((s) => s.item !== 'bone_meal'))).length > 0,
  'a burning salmon never dropping bone meal (a lost pool) is caught');
else caught(false, 'golden has salmon|fire');

console.log('');
console.log('================ mobreffirecheck (I6) ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks - fails.filter((f) => f.startsWith('anti-vacuity')).length}`);
for (const f of fails.slice(0, 40)) console.log('   ✗ ' + f);
console.log('======================================================');
process.exit(fails.length ? 1 : 0);
