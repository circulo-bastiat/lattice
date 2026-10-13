#!/usr/bin/env node
// blockrefdropcheck.mjs — infra I6 (24 Sept 2026): block drops, the ENGINE's loot interpreter against the REAL
// 1.18.2 server's `/loot ... mine <pos> [tool]` (tools/referee/runblocks.mjs -> golden/block-drops.json).
//
//   node tools/referee/runblocks.mjs --slice s/4 ...   # once per machine/store (4 x ~2 min, the real server)
//   node tools/referee/blockrefdropcheck.mjs [--verbose]
//
// Cases (from the jar, never typed): every blocks/* table that can vary (bonus, chance, match_tool, counts,
// state conditions) x its default state + each state its own block_state_property rows name x the tools that
// table can tell apart (hand; fortune I/III; shears, plain/silk-touch pickaxe). Context on both sides is the
// one `mine` gives: ORIGIN, TOOL, BLOCK_STATE -- NO entity, no explosion. The engine side is Loot.drops
// (the table), not breakDrops (the correct-tool rule is PlayerEntity.canHarvest, minecheck's).
// The neighbourhood is the referee's: the block at 8 -60 8 in a flat world, grass_block under it, air around
// (location_check -- tall_grass / large_fern -- reads it).
//
// Statistics as mobreflootcheck: drop RATE and MEAN count per roll within Z = 5 standard errors; an item seen
// on one side only at > 2% is a mismatch. Anti-vacuity (D-30/D-305): three in-memory breaks of the engine.
// No golden -> SKIP, exit 0. Golden: <referee dir>/golden, else ../mclite-store/golden; never committed (D-6).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { TOOL_CTX } from './runblocks.mjs';

const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'block-drops.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'block-drops.json')].find((f) => existsSync(f));
if (!GOLDEN) {
  console.log('blockrefdropcheck: SKIP (golden not generated -- run node tools/referee/runblocks.mjs)');
  process.exit(0);
}
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };

const M = loadEngine({ extra: ['02f_tags.js', '07d_mining.js', '07e_loot.js'], dom: false });
const L = M.Loot, R = M.Reg, S = M.States;
ok(L && L.ready && S && S.ready, 'Loot.init + States ran');

const N_E = 4000, Z = 5, SEED = 20260924;
const around = (dx, dy, dz) => (dx === 0 && dy === -1 && dz === 0 ? 'grass_block' : 'air');

/** The engine real state for a block + a props object ({} = default); null when a prop/value is unknown. */
function stateFor(block, props) {
  const b = R.id[block];
  if (b === undefined) return null;
  let st = R.realFirst[b] + R.defaultState[b];
  for (const [k, v] of Object.entries(props)) {
    const pid = R.PROP[k], vid = R.PVAL[v];
    if (pid === undefined || vid === undefined) return null;
    st = S.withProp(st, pid, vid);
    if (S.propValue(st, pid) !== vid) return null;
  }
  return st;
}

/** Roll one case N times in the engine -> the golden's own shape. `mutate` (anti-vacuity) edits each roll. */
function engineStats(c, mutate) {
  const rng = L.rng(SEED);
  const st = stateFor(c.block, c.props);
  const rec = { rolls: 0, empty: 0, items: {} };
  for (let i = 0; i < N_E; i++) {
    let drops = L.drops(Object.assign({ state: st, blockName: c.block, rng, blockNameAt: around, noEntity: true }, TOOL_CTX[c.tool]))   // `mine`: no THIS_ENTITY (snow, chorus_flower);
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
console.log(`blockrefdropcheck -- ${cases.length} block-drop cases, engine x${N_E} vs real 1.18.2 server x${golden.rolls} (${golden.generatedAt})`);
let compared = 0;
const byBlock = {};
for (const [key, van] of cases) {
  if (!van.rolls) continue;
  if (!L.hasTable(van.block)) { ok(false, `blocks/${van.block}: the server has it, the engine never packed it`); continue; }
  if (stateFor(van.block, van.props) === null) { ok(false, `${key}: the engine has no state ${JSON.stringify(van.props)}`); continue; }
  const diffs = compare(key, van, engineStats(van));
  compared++;
  if (!ok(!diffs.length, diffs.join('\n     '))) byBlock[van.block] = (byBlock[van.block] || 0) + 1;
  else if (VERBOSE) console.log(`   ✓ ${key}`);
}
ok(compared >= 1500, `compared ${compared} cases (the 1.18.2 jar gives ~2170; a tiny number means the golden or the packing broke)`);

// ── anti-vacuity: break the engine's rolls three ways; each must produce a mismatch ──────────────
console.log('\nanti-vacuity');
const caught = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); console.log('   ' + (c ? '✓' : '✗') + ' ' + m); };
const G = (k) => golden.cases[k];
const k1 = 'diamond_ore|{}|fortune3', k2 = 'gravel|{}|hand', k3 = 'oak_leaves|{}|shears';
if (G(k1)) caught(compare(k1, G(k1), engineStats(G(k1), (d) => d.map((s) => ({ item: s.item, count: s.item === 'diamond' ? 1 : s.count })))).length > 0,
  'fortune III ignored on diamond ore (apply_bonus ore_drops lost) is caught');
else caught(false, 'golden has ' + k1);
if (G(k2)) caught(compare(k2, G(k2), engineStats(G(k2), (d) => d.filter((s) => s.item !== 'flint'))).length > 0,
  'gravel never giving flint (table_bonus 10% lost) is caught');
else caught(false, 'golden has ' + k2);
if (G(k3)) caught(compare(k3, G(k3), engineStats(G(k3), (d) => d.map((s) => (s.item === 'oak_leaves' ? { item: 'oak_sapling', count: 1 } : s)))).length > 0,
  'shears on oak leaves giving a sapling instead of the leaves (match_tool lost) is caught');
else caught(false, 'golden has ' + k3);

console.log('');
console.log('================ blockrefdropcheck (I6) ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks - fails.filter((f) => f.startsWith('anti-vacuity')).length}`);
if (Object.keys(byBlock).length) console.log(` red blocks: ${Object.entries(byBlock).map(([b, n]) => b + (n > 1 ? ' x' + n : '')).join(', ')}`);
for (const f of fails.slice(0, 60)) console.log('   ✗ ' + f);
if (fails.length > 60) console.log(`   ... and ${fails.length - 60} more`);
console.log('========================================================');
process.exit(fails.length ? 1 : 0);
