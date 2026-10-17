#!/usr/bin/env node
// leafrefcheck.mjs — infra I6 (25 Sept 2026): LEAF DECAY, the engine against the REAL 1.18.2 server.
//
//   node tools/referee/runleaf.mjs            # once per machine/store (~1.5 min, the real server)
//   node tools/referee/leafrefcheck.mjs [--verbose]
//
// Engine side: `Behave.tick` (scheduled ticks, where LeavesBlock.scheduledTick re-counts DISTANCE) then
// `Behave.randomTickSection` (where LeavesBlock.randomTick decays a distance-7 leaf) — the same two entries the running
// game drives, in ServerWorld.tick's order (block ticks before the chunk source's random ticks). Every write goes
// through a world whose `set` calls `Behave.changed` exactly like World.setBlock (src/07_world.js:957), so the neighbour
// half (getStateForNeighborUpdate's 1-tick schedule) is the engine's own. Nothing about leaves is re-implemented here.
// Compared, per scenario (leafscen.mjs):
//   1. W(t) = leaves gone + leaves at distance 7, every tick — DETERMINISTIC (a leaf only decays from 7 and nothing here
//      regains distance), so it must match the server EXACTLY: it is the distance wave after the cut, tick by tick.
//   2. the final DISTANCE of every leaf cell (0 = gone) — exact.
//   3. the decay RATE: Σ_t d7(t) over every decayable leaf (each leaf's life at 7 is geometric, p ≈ SPEED/4096) — a
//      two-sample z test at 4σ of the geometric variance.
// No golden -> SKIP.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCENARIOS, SPEED, CUT, GY, LEAF, LOG, origin } from './leafscen.mjs';

const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'leaf-decay.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'leaf-decay.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('leafrefcheck: SKIP (golden not generated -- run node tools/referee/runleaf.mjs)'); process.exit(process.env.MCLITE_REQUIRE_REFEREE ? 1 : 0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const T = golden.T;
const SECTION_Y = -64; // CFG.WORLD_MIN_Y: GY+1..GY+6 (-60..-55) all sit in the section at -64, on both sides

function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Run scenario i in a fresh engine. `hack(M)` perturbs the engine for an anti-vacuity break. */
function runEngine(sc, i, { speed = SPEED, hack, persistent = sc.persistent } = {}) {
  const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js'], dom: false });
  const S = M.States, B = M.Behave, R = M.Reg;
  const cells = new Map();
  const key = (x, y, z) => x + ',' + y + ',' + z;
  const w = {
    get: (x, y, z) => cells.get(key(x, y, z)) || 0,
    set: (x, y, z, s) => { if (s === 0) cells.delete(key(x, y, z)); else cells.set(key(x, y, z), s); B.changed(x, y, z); },
    light: () => 15,
  };
  w.getBlock = w.get; w.setBlock = w.set;
  B.init(w); B.world = w;
  if (B.clearSchedule) B.clearSchedule();
  if (hack) hack(M);
  const RNG = seeded(0x1eaf + 7919 * i);
  const o = origin(i);
  const at = (c) => [o.x + c[0], GY + c[1], o.z + c[2]];
  const leafOf = (d) => B.setProp(B.setProp(S.stateOf(LEAF), 'distance', d), 'persistent', persistent ? 'true' : 'false');
  const distOf = (st) => { if (st === 0 || S.block[st] !== R.id[LEAF]) return 0; const v = S.propValue(st, R.PROP.distance); return +R.valueNames[v]; };
  const n = [], d7 = [];
  for (let k = 1; k <= T; k++) {
    if (k === 1) {
      for (const c of sc.logs) w.set(...at(c), S.stateOf(LOG));
      sc.leaves.forEach((c, j) => w.set(...at(c), leafOf(sc.dist[j])));
    }
    if (k === CUT) for (const c of sc.cut) w.set(...at(c), 0);
    let cn = 0, c7 = 0;
    for (const c of sc.leaves) { const d = distOf(w.get(...at(c))); if (d) cn++; if (d === 7) c7++; }
    n.push(cn); d7.push(c7);
    B.tick();
    B.randomTickSection(o.x, SECTION_Y, o.z, RNG, speed);
  }
  const final = sc.leaves.map((c) => distOf(w.get(...at(c))));
  return { n, d7, final };
}

const W = (r, n0) => r.n.map((v, t) => n0 - v + r.d7[t]);
const firstDiff = (a, b) => { for (let t = 0; t < Math.max(a.length, b.length); t++) if (a[t] !== b[t]) return t; return -1; };

/** Compare a full engine run set to golden; returns a list of failure strings. */
function compare(eng, { quiet } = {}) {
  const f = [];
  let sumS = 0, sumE = 0, K = 0;
  SCENARIOS.forEach((sc, i) => {
    const g = golden.cases[sc.id], e = eng[i];
    if (!g) { f.push(`${sc.id}: missing from golden`); return; }
    const n0 = sc.leaves.length;
    const wg = W(g, n0), we = W(e, n0);
    const t = firstDiff(wg, we);
    if (t >= 0) f.push(`${sc.id}: wave W(t) differs first at tick ${t + 1}: server ${wg[t]} engine ${we[t]} (server ${wg.slice(Math.max(0, t - 2), t + 6).join(' ')} | engine ${we.slice(Math.max(0, t - 2), t + 6).join(' ')})`);
    const ft = firstDiff(g.final, e.final);
    if (ft >= 0) f.push(`${sc.id}: final distances differ (server ${g.final.join('')} engine ${e.final.join('')})`);
    if (!sc.persistent) {
      sumS += g.d7.reduce((a, b) => a + b, 0); sumE += e.d7.reduce((a, b) => a + b, 0);
      K += wg[T - 1];              // every leaf that ever reached 7 on the server
    }
  });
  const p = 1 - Math.pow(1 - 1 / 4096, SPEED);
  const sd = Math.sqrt(2 * K * (1 - p) / (p * p));
  if (Math.abs(sumS - sumE) > 4 * sd) f.push(`decay rate: Σd7 server ${sumS} engine ${sumE} (|Δ| ${Math.abs(sumS - sumE)} > 4σ ${Math.round(4 * sd)}, K=${K})`);
  if (VERBOSE && !quiet) console.log(`  decay rate: Σd7 server ${sumS} engine ${sumE}, 4σ ${Math.round(4 * sd)}, K=${K}`);
  return f;
}

let pass = 0;
const fails = [];
// server self-consistency first: replicas of the same scenario must have the same wave (the wave is deterministic)
for (const [a, b] of [['felled_a', 'felled_b'], ['felled_a', 'felled_c'], ['twologs_a', 'twologs_b'], ['line_a', 'line_b']]) {
  const sa = SCENARIOS.find((s) => s.id === a), ga = golden.cases[a], gb = golden.cases[b];
  if (!ga || !gb) { fails.push(`golden lacks ${a}/${b}`); continue; }
  const t = firstDiff(W(ga, sa.leaves.length), W(gb, sa.leaves.length));
  if (t >= 0) fails.push(`golden self-check: ${a} and ${b} waves differ at tick ${t + 1} -- the harness, not the engine`); else pass++;
}
if (golden.notes && golden.notes.length) fails.push('golden has notes: ' + golden.notes.join('; '));

const eng = SCENARIOS.map((sc, i) => runEngine(sc, i));
const main = compare(eng);
if (main.length) fails.push(...main); else pass++;
if (VERBOSE) SCENARIOS.forEach((sc, i) => {
  const g = golden.cases[sc.id], e = eng[i];
  console.log(`  ${sc.id.padEnd(18)} W server ${W(g, sc.leaves.length).slice(CUT - 1, CUT + 10).join(' ')} | engine ${W(e, sc.leaves.length).slice(CUT - 1, CUT + 10).join(' ')} | end n ${g.n[T - 1]}/${e.n[T - 1]}`);
});

// anti-vacuity (D-30/D-305): each break is a REAL change to the engine's behaviour, and the comparison must catch it
let breaks = 0;
const breakCaught = (name, opts, pick) => {
  const runs = SCENARIOS.map((sc, i) => (pick && !pick(sc)) ? eng[i] : runEngine(sc, i, typeof opts === 'function' ? opts(sc) : opts));
  if (compare(runs, { quiet: true }).length) { breaks++; pass++; } else fails.push(`anti-vacuity: "${name}" was NOT caught`);
};
breakCaught('2x randomTickSpeed', { speed: SPEED * 2 }, (sc) => !sc.persistent);
breakCaught('leaf neighbour schedule delay 2 instead of 1', {
  hack: (M) => { const s = M.Behave.schedule; M.Behave.schedule = (x, y, z, d, p) => s(x, y, z, (d | 0) + 1, p); },
}, (sc) => sc.cut.length > 0);
breakCaught('persistent leaves placed as non-persistent', (sc) => ({ persistent: false }), (sc) => sc.persistent);
breakCaught('neighbour updates never schedule a leaf tick', {
  hack: (M) => { M.Behave.schedule = () => false; },
}, (sc) => sc.cut.length > 0);

console.log(`leafrefcheck: ${pass} passed, ${fails.length} failed (${breaks}/4 anti-vacuity breaks caught) [golden ${golden.generatedAt}]`);
for (const f of fails) console.log('  FAIL ' + f);
console.log(` assertions passed .... ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
