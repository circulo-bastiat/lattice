#!/usr/bin/env node
// farmrefcheck.mjs — infra I6 (25 Sept 2026): FARMLAND MOISTURE, the engine against the REAL 1.18.2 server.
//
//   node tools/referee/runfarm.mjs            # once per machine/store (~3 min, the real server)
//   node tools/referee/farmrefcheck.mjs [--verbose]
//
// Engine side: `Behave.tick` then `Behave.randomTickSection` (ServerWorld.tick's order) over a world whose `set` calls
// `Behave.changed` like World.setBlock (src/07_world.js:957); the ground is the server's flat world (grass over dirt), so
// vanilla's grass spreading onto a dried-out cell happens on both sides. Nothing about farmland is re-implemented here.
// Compared, per scenario (farmscen.mjs):
//   1. EXACT: a cell next to water (a waterlogged block counts) ends at moisture 7; a cell under a crop/stem is never dirt
//      and ends at moisture 0; every other dry cell ends as dirt or grass_block — never farmland.
//   2. RATE: S = Σ_samples Σ_cells L, L = moisture+1 while farmland (0 once dirt/grass) for drying cells, L = [moisture<7]
//      for hydrating cells. Each hit is a geometric wait (p = 1-(1-1/4096)^SPEED), so Var S = Σ_cells var(W)·Σ(level²)/EVERY²
//      — a two-sample z test at 4σ.
// No golden -> SKIP.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCENARIOS, SPEED, EVERY, GY, origin, expectedFinal } from './farmscen.mjs';

const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'farmland-moisture.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'farmland-moisture.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('farmrefcheck: SKIP (golden not generated -- run node tools/referee/runfarm.mjs)'); process.exit(0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const T = golden.T;
const SECTION_Y = -64;

function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const blockOf = (S, spec) => {               // 'minecraft:wheat[age=0]' -> a state id via Behave.setProp
  const m = /^minecraft:([a-z_]+)(?:\[(.*)\])?$/.exec(spec);
  return (B) => { let st = S.stateOf(m[1]); for (const kv of (m[2] ? m[2].split(',') : [])) { const [k, v] = kv.split('='); st = B.setProp(st, k, v); } return st; };
};

function runEngine(sc, i, { speed = SPEED, hack, wrapGet } = {}) {
  const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js'], dom: false });
  const S = M.States, B = M.Behave, R = M.Reg;
  const cells = new Map();
  const key = (x, y, z) => x + ',' + y + ',' + z;
  const rawGet = (x, y, z) => cells.get(key(x, y, z)) || 0;
  const w = {
    get: wrapGet ? wrapGet(rawGet, M) : rawGet,
    set: (x, y, z, s) => { if (s === 0) cells.delete(key(x, y, z)); else cells.set(key(x, y, z), s); B.changed(x, y, z); },
    light: () => 15,
  };
  w.getBlock = w.get; w.setBlock = w.set;
  const o = origin(i);
  // the flat world under the scenario: bedrock/dirt/dirt/grass, a chunk plus a one-block ring (grass spreads ±1)
  for (let x = o.x - 1; x <= o.x + 16; x++) for (let z = o.z - 1; z <= o.z + 16; z++) {
    cells.set(key(x, GY, z), S.stateOf('grass_block')); cells.set(key(x, GY - 1, z), S.stateOf('dirt')); cells.set(key(x, GY - 2, z), S.stateOf('dirt'));
  }
  B.init(w); B.world = w;
  if (B.clearSchedule) B.clearSchedule();
  if (hack) hack(M);
  const RNG = seeded(0xfa2 + 7919 * i);
  const at = (x, z, dy = 0) => [o.x + x, GY + dy, o.z + z];
  const peek = (x, z, dy = 0) => rawGet(...at(x, z, dy));
  const water = blockOf(S, sc.waterBlock || 'minecraft:water')(B);
  const farm = B.setProp(S.stateOf('farmland'), 'moisture', sc.moisture);
  const top = sc.top ? blockOf(S, sc.top)(B) : 0;
  const cls = (st) => {
    if (st === 0) return '?';
    const b = R.names[S.block[st]];
    if (b === 'dirt') return 'd';
    if (b === 'grass_block') return 'g';
    if (b === 'farmland') return +R.valueNames[S.propValue(st, R.PROP.moisture)];
    return '?';
  };
  const samples = [];
  for (let k = 1; k <= T; k++) {
    if (k === 1) {
      for (const [x, z] of sc.water) w.set(...at(x, z), water);
      for (const [x, z] of sc.cells) { w.set(...at(x, z), farm); if (top) w.set(...at(x, z, 1), top); }
    }
    if (k % EVERY === 0) samples.push(sc.cells.map(([x, z]) => cls(peek(x, z))));
    B.tick();
    B.randomTickSection(o.x, SECTION_Y, o.z, RNG, speed);
  }
  return { samples, final: sc.cells.map(([x, z]) => cls(peek(x, z))) };
}

// golden -> per-sample class histograms (the server gives counts, not cells)
const LAB = ['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'];
function statGolden(sc, g) {
  const exp = expectedFinal(sc), hyd = exp.every((f) => f === 7) && sc.moisture === 0;
  let S = 0;
  for (let t = 0; t < g.m7.length; t++) S += hyd ? sc.cells.length - g.m7[t] : LAB.reduce((a, l, m) => a + g[l][t] * (m + 1), 0);
  return S;
}
function statEngine(sc, e) {
  const exp = expectedFinal(sc), hyd = exp.every((f) => f === 7) && sc.moisture === 0;
  let S = 0;
  for (const row of e.samples) for (const c of row) S += hyd ? (c === 7 ? 0 : 1) : (typeof c === 'number' ? c + 1 : 0);
  return S;
}
function sdOf(sc) {
  const p = 1 - Math.pow(1 - 1 / 4096, SPEED), varW = (1 - p) / (p * p);
  const exp = expectedFinal(sc);
  let v = 0;
  exp.forEach((f) => {
    if (f === 7) { if (sc.moisture !== 7) v += varW; return; }            // one hit: L 1 -> 0
    let s2 = 0; for (let j = 1; j <= sc.moisture + 1; j++) s2 += j * j;   // levels 8..1 each wait one geometric hit
    if (f === 0) s2 -= 1;                                                  // a crop cell stops at L = 1
    v += varW * s2;
  });
  return Math.sqrt(2 * v) / EVERY;
}

function compare(eng, { quiet } = {}) {
  const f = [];
  SCENARIOS.forEach((sc, i) => {
    const g = golden.cases[sc.id], e = eng[i];
    if (!g) { f.push(`${sc.id}: missing from golden`); return; }
    const exp = expectedFinal(sc);
    // 1. exact
    const bad = (fin) => fin.map((c, j) => exp[j] === 'd' ? (c === 'd' || c === 'g' ? null : c) : (c === exp[j] ? null : c));
    const bg = bad(g.final).filter((x) => x !== null).length, be = bad(e.final).filter((x) => x !== null).length;
    if (bg) f.push(`${sc.id}: GOLDEN breaks vanilla's own rule on ${bg} cells -- harness, not engine`);
    if (be) {
      const first = bad(e.final).findIndex((x) => x !== null);
      f.push(`${sc.id}: ${be}/${sc.cells.length} cells end wrong in the engine (cell ${sc.cells[first]} is ${e.final[first]}, vanilla ${exp[first] === 'd' ? 'dirt/grass' : 'moisture ' + exp[first]})`);
    }
    if (sc.top && e.samples.some((row) => row.includes('d'))) f.push(`${sc.id}: farmland under a crop turned to dirt in the engine`);
    // 2. rate
    const sg = statGolden(sc, g), se = statEngine(sc, e), sd = sdOf(sc);
    if (sd > 0 && Math.abs(sg - se) > 4 * sd) f.push(`${sc.id}: rate S server ${sg} engine ${se} (|Δ| ${Math.abs(sg - se)} > 4σ ${Math.round(4 * sd)})`);
    if (VERBOSE && !quiet) console.log(`  ${sc.id.padEnd(12)} S server ${sg} engine ${se} 4σ ${Math.round(4 * sd)} | final server ${JSON.stringify(hist(g.final))} engine ${JSON.stringify(hist(e.final))}`);
  });
  return f;
}
const hist = (a) => a.reduce((h, v) => (h[v] = (h[v] || 0) + 1, h), {});

let pass = 0;
const fails = [];
if (golden.notes && golden.notes.length) fails.push('golden has notes: ' + golden.notes.join('; ')); else pass++;
const eng = SCENARIOS.map((sc, i) => runEngine(sc, i));
const main = compare(eng);
if (main.length) fails.push(...main); else pass++;

// anti-vacuity (D-30/D-305): real engine changes, each must be caught
let breaks = 0;
const breakCaught = (name, opts, pick) => {
  const runs = SCENARIOS.map((sc, i) => (pick && !pick(sc)) ? eng[i] : runEngine(sc, i, opts));
  if (compare(runs, { quiet: true }).length) { breaks++; pass++; } else fails.push(`anti-vacuity: "${name}" was NOT caught`);
};
breakCaught('3x randomTickSpeed on the drying fields', { speed: SPEED * 3 }, (sc) => sc.id === 'bare' || sc.id === 'edge');
breakCaught('the hydrate field cannot see its water row', {
  wrapGet: (g, M) => (x, y, z) => { const st = g(x, y, z); return (st && y === GY && M.Reg.names[M.States.block[st]] === 'water') ? M.States.stateOf('stone') : st; },
}, (sc) => sc.id === 'hydrate');
breakCaught('crops do not hold farmland (the block above reads as air)', {
  wrapGet: (g) => (x, y, z) => (y === GY + 1 ? 0 : g(x, y, z)),
}, (sc) => !!sc.top);

console.log(`farmrefcheck: ${pass} passed, ${fails.length} failed (${breaks}/3 anti-vacuity breaks caught) [golden ${golden.generatedAt}]`);
for (const f of fails) console.log('  FAIL ' + f);
console.log(` assertions passed .... ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
