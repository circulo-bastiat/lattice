#!/usr/bin/env node
// meltrefcheck.mjs — infra I6 (25 Sept 2026): ICE and SNOW-LAYER MELTING by light, the engine against the REAL 1.18.2 server.
//
//   node tools/referee/runmelt.mjs            # once per machine/store (~5 min, the real server)
//   node tools/referee/meltrefcheck.mjs [--verbose]
//
// Two parts:
//   A. THE JOIN (rule 7, D-276). The live game hands Behave `NS.World` (Behave.init(world || NS.World)); Behave's random
//      ticks read light through `B.w.light`. Here the REAL World module is loaded, its `getLight` (sky<<4 | block, the
//      packing src/07_world.js:92 documents) is stubbed to "sky 15, block 3", and B.w.light must NOT come back 15 — i.e.
//      the world's light must reach the random-tick rules at all.
//   B. THE RULE. Each scenario (meltscen.mjs) runs in the engine over a mock world that answers light with the server's
//      OWN MEASURED block light (both as `blockLightAt` and packed in `getLight`, so whichever the engine reads, it reads
//      the truth; the sky half is 0 inside the closed stone boxes and 15 in the open scenes — construction, not a number
//      the game owns). Compared:
//        1. EXACT: every cell's final block (ice / snow / water / air) — with p ~ 0.031 a tick, every cell that CAN melt
//           has (P(miss) ~ 1e-11), so the final state is the rule itself.
//        2. RATE: S = Σ_samples alive cells, for the cells that melt on both sides; each melts at its first random-tick hit
//           (a geometric wait), Var from that — a two-sample z test at 4σ.
// No golden -> SKIP.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCENARIOS, SPEED, EVERY, GY, origin, cellBlock } from './meltscen.mjs';

const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'melt.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'melt.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('meltrefcheck: SKIP (golden not generated -- run node tools/referee/runmelt.mjs)'); process.exit(0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const T = golden.T;
const SECTION_Y = -64;

function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const stateOf = (S, B, spec) => {
  const m = /^minecraft:([a-z_]+)(?:\[(.*)\])?$/.exec(spec);
  let st = S.stateOf(m[1]); for (const kv of (m[2] ? m[2].split(',') : [])) { const [k, v] = kv.split('='); st = B.setProp(st, k, v); }
  return st;
};

// ── A. the join ──────────────────────────────────────────────────────────────────────────────────────────────────────
function joinSees(blockLight) {
  const M = loadEngine({ extra: ['02f_tags.js', '03_section.js', '07_world.js', '07b_behaviour.js'], dom: false });
  const W = M.World, B = M.Behave;
  W.getLight = () => (15 << 4) | blockLight;           // the World's own packing: sky high nibble, block low
  B.init(W);
  if (B.world !== W) return { err: 'Behave.init(World) did not bind the World' };
  return { seen: B.w.light(0, GY + 1, 0) };
}

// ── B. the rule ──────────────────────────────────────────────────────────────────────────────────────────────────────
function runEngine(sc, i, { speed = SPEED, lightFn } = {}) {
  const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js'], dom: false });
  const S = M.States, B = M.Behave, R = M.Reg;
  const cells = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
  const o = origin(i);
  const g = golden.cases[sc.id];
  const unprobed = new Set();
  const blockLight = (x, y, z) => {
    if (!sc.box) return 0;                                    // no source within 24 blocks (checked below: reading <= floor)
    const k = `${x - o.x},${y - GY},${z - o.z}`;
    if (k in g.light) return g.light[k];
    unprobed.add(k); return 0;
  };
  const bl = lightFn ? lightFn(blockLight) : blockLight;
  const w = {
    get: (x, y, z) => cells.get(key(x, y, z)) || 0,
    set: (x, y, z, s) => { if (s === 0) cells.delete(key(x, y, z)); else cells.set(key(x, y, z), s); B.changed(x, y, z); },
    blockLightAt: (x, y, z) => bl(x, y, z),
    getLight: (x, y, z) => ((sc.box ? 0 : 15) << 4) | bl(x, y, z),
  };
  w.getBlock = w.get; w.setBlock = w.set;
  const floor = S.stateOf(sc.box ? 'stone' : 'grass_block');
  for (let x = o.x - 1; x <= o.x + 16; x++) for (let z = o.z - 1; z <= o.z + 16; z++) { cells.set(key(x, GY, z), floor); cells.set(key(x, GY - 1, z), S.stateOf('dirt')); }
  if (sc.box) {
    const stone = S.stateOf('stone');
    for (let x = 0; x <= 15; x++) for (let z = 0; z <= 15; z++) for (let dy = 1; dy <= 5; dy++)
      if (dy === 5 || x === 0 || x === 15 || z === 0 || z === 15) cells.set(key(o.x + x, GY + dy, o.z + z), stone);
  }
  B.init(w); B.world = w;
  if (B.clearSchedule) B.clearSchedule();
  for (const [b, [x, dy, z]] of sc.src) cells.set(key(o.x + x, GY + dy, o.z + z), stateOf(S, B, b));
  const cell = stateOf(S, B, cellBlock(sc));
  for (const [x, dy, z] of sc.cells) cells.set(key(o.x + x, GY + dy, o.z + z), cell);
  const cls = (st) => {
    if (st === 0) return 'air';
    const n = R.names[S.block[st]];
    return n === 'ice' || n === 'snow' || n === 'water' ? n : 'other:' + n;
  };
  const peek = ([x, dy, z]) => cls(w.get(o.x + x, GY + dy, o.z + z));
  const RNG = seeded(0x3e17 + 7919 * i);
  const alive = [];
  for (let k = 1; k <= T; k++) {
    if (k % EVERY === 0) alive.push(sc.cells.filter((c) => peek(c) === sc.kind).length);
    B.tick();
    B.randomTickSection(o.x, SECTION_Y, o.z, RNG, speed);
  }
  return { alive, final: sc.cells.map(peek), unprobed: [...unprobed] };
}

function sdOf(n) {                                          // n cells, each alive until its first hit
  const p = 1 - Math.pow(1 - 1 / 4096, SPEED), q = Math.pow(1 - p, EVERY), K = Math.floor(T / EVERY);
  let ey = 0, ey2 = 0;
  for (let k = 1; k <= K; k++) { ey += Math.pow(q, k); for (let j = 1; j <= K; j++) ey2 += Math.pow(q, Math.max(j, k)); }
  return Math.sqrt(2 * n * (ey2 - ey * ey));
}

function compare(eng, { quiet } = {}) {
  const f = [];
  SCENARIOS.forEach((sc, i) => {
    const g = golden.cases[sc.id], e = eng[i];
    if (!g) { f.push(`${sc.id}: missing from golden`); return; }
    if (e.unprobed.length) f.push(`${sc.id}: HARNESS — the engine asked the light at unmeasured ${e.unprobed.slice(0, 4).join(' ')}`);
    const bad = sc.cells.map((c, j) => e.final[j] === g.final[j] ? null : j).filter((j) => j !== null);
    if (bad.length) {
      const j = bad[0], [x, dy, z] = sc.cells[j];
      f.push(`${sc.id}: ${bad.length}/${sc.cells.length} cells end wrong — (${x},${dy},${z}) block light ${sc.box ? g.light[`${x},${dy},${z}`] : 0}, above ${sc.box ? g.light[`${x},${dy + 1},${z}`] : 0}: engine ${e.final[j]}, server ${g.final[j]}`);
    }
    const melters = sc.cells.filter((c, j) => g.final[j] !== sc.kind && e.final[j] !== sc.kind).length;
    const stayers = sc.cells.length - melters;
    if (!bad.length && melters) {
      const sg = g.alive.reduce((a, v) => a + v - stayers, 0), se = e.alive.reduce((a, v) => a + v - stayers, 0), sd = sdOf(melters);
      if (Math.abs(sg - se) > 4 * sd) f.push(`${sc.id}: melt rate S server ${sg} engine ${se} (|Δ| ${Math.abs(sg - se)} > 4σ ${Math.round(4 * sd)})`);
      if (VERBOSE && !quiet) console.log(`  ${sc.id.padEnd(11)} rate S server ${sg} engine ${se} 4σ ${Math.round(4 * sd)}`);
    }
    if (VERBOSE && !quiet) console.log(`  ${sc.id.padEnd(11)} final server ${g.final.join(' ')}\n  ${''.padEnd(11)} final engine ${e.final.join(' ')}`);
  });
  return f;
}

let pass = 0;
const fails = [];
// the golden itself: no notes; the open scenes carry no block light (every night reading at or under the sky floor);
// vanilla's rule reproduced by the server's own answers (a harness that lost a scene's ticks would break this)
if (golden.notes && golden.notes.length) fails.push('golden has notes: ' + golden.notes.join('; ')); else pass++;
for (const sc of SCENARIOS) {
  const g = golden.cases[sc.id];
  if (!g) continue;
  if (!sc.box && Object.values(g.light).some((v) => v > g.floor)) fails.push(`${sc.id}: HARNESS — an open scene reads light above the night sky (${g.floor})`); else pass++;
}

const J = joinSees(3);
if (J.err) fails.push('join: ' + J.err);
else if (J.seen === 15) fails.push(`join: Behave's random-tick light never sees the world — World.getLight says block 3 / sky 15, B.w.light reads ${J.seen} (07b_behaviour.js w.light asks World.blockLightAt, which World does not have, and falls back to 15)`);
else pass++;

const eng = SCENARIOS.map((sc, i) => runEngine(sc, i));
const main = compare(eng);
if (main.length) fails.push(...main); else pass++;

// anti-vacuity (D-30/D-305): each break must add a failure the unbroken run does not have
let breaks = 0;
const base = new Set(main);
const breakCaught = (name, opts, pick) => {
  const runs = SCENARIOS.map((sc, i) => (pick && !pick(sc)) ? eng[i] : runEngine(sc, i, opts));
  if (compare(runs, { quiet: true }).some((m) => !base.has(m))) { breaks++; pass++; } else fails.push(`anti-vacuity: "${name}" was NOT caught`);
};
breakCaught('every block light +4', { lightFn: (f) => (x, y, z) => Math.min(15, f(x, y, z) + 4) }, (sc) => sc.box);
breakCaught('every block light -4', { lightFn: (f) => (x, y, z) => Math.max(0, f(x, y, z) - 4) }, (sc) => sc.box);
breakCaught('no random ticks at all', { speed: 0 });

console.log(`meltrefcheck: ${pass} passed, ${fails.length} failed (${breaks}/3 anti-vacuity breaks caught) [golden ${golden.generatedAt}]`);
for (const f of fails) console.log('  FAIL ' + f);
console.log(` assertions passed .... ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
