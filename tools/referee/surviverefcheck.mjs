#!/usr/bin/env node
// surviverefcheck.mjs — infra referee-survive (25 Sept 2026): COLUMN-PLANT SURVIVAL (cactus,
// sugar cane) vs the REAL 1.18.2 server, TICK-EXACT (not statistical -- unlike columnrefcheck's
// growth compare, every event here is deterministic: a support rule either holds or it doesn't).
//
//   node tools/referee/runsurvive.mjs           # once per machine/store (the real server)
//   node tools/referee/surviverefcheck.mjs [--verbose]
//
// Engine side: the REAL `World` module (src/07_world.js) through a real chunk grid, the same
// `W.setBlock` the running game calls for every block change -- not a re-implementation, and not
// the bare get/set stub columnrefcheck.mjs uses (that stub is fine for randomTick growth, which
// never asks `canSurvive`; this pack is ONLY about `canSurvive`, so it needs the real thing).
// `Behave.tick()` runs beside it every iteration, exactly as `ServerWorld.tick` calls block ticks
// before the chunk source, even though nothing here currently schedules through it (see finding).
//
// ── TWO FINDINGS THIS PACK EXISTS TO NAME (both are REAL mismatches -- the check stays red on
// them, correctly, until src/07_world.js changes; neither is fixed here, D-30/D-305) ──────────
//
// FINDING 1 — cactus is NEVER cascade-broken by a live neighbour change, at all.
//   `cascadeFrom` (src/07_world.js:892-905) is the loop that re-checks a block's support whenever
//   a NEIGHBOUR of it changes (the mechanism `W.setBlock` runs after every write, :953). Its
//   guard, src/07_world.js:900, is:
//       if (st === 0 || !NS.States.support[st]) continue;
//   `NS.States.support[st]` is only the SIX GENERIC material-derived classes (floor/ceiling/wall/
//   carpet/any-face/behind); it is 0 for cactus, whose survival rule comes ENTIRELY from the
//   jar's own table (D-346's rule 4, src/07_world.js:227-244) with no generic class backing it
//   (verified live: `S.support[cactusState] === 0`, `S.rule[cactusState] === 4`). So this guard
//   skips cactus outright -- `canSurvive` is never even called for it here. This is EXACTLY the
//   bug the placement guard next to it was already fixed for: src/07_world.js:919-927's own
//   comment says so ("a block whose rule comes from the jar's canSurvive table instead never
//   reached canSurvive at all, and every rule added by D-346 was dead on arrival") and that gate
//   (:927) correctly reads `SRW.support[id] || (SRW.rule && SRW.rule[id])` -- `cascadeFrom`'s
//   gate a few lines above it was never given the same fix. Net effect: a cactus placed next to
//   stone, lava, glass, a fence or a sign NEVER breaks in this engine, ever, no matter how many
//   neighbour changes happen near it (sugar cane is not fully blind to this bug only because it
//   ALSO carries a generic class, `support=1`/floor, alongside its own rule 22 -- the accidental
//   second path is what lets cascadeFrom notice it at all). Confirmed live, and reproduced below
//   with the REAL engine and a ONE-LINE in-memory patch of exactly this guard (not written to
//   src/**, `--verbose` only) matching `cascadeFrom` to the placement gate's own condition.
//
// FINDING 2 — even where the cascade DOES fire (sugar cane, or cactus once Finding 1 is fixed),
//   it fires SYNCHRONOUSLY, one tick earlier than vanilla:
//     CactusBlock.java:73-79 / SugarCaneBlock.java:61-67  getStateForNeighborUpdate, on a
//       neighbour change, calls `createAndScheduleBlockTick(pos, this, 1)` -- ONE TICK LATER.
//     CactusBlock.java:32-36 / SugarCaneBlock.java:33-37  scheduledTick, when that scheduled
//       check finally runs, re-tests canPlaceAt and calls breakBlock only then.
//   `cascadeFrom` pops the block before `W.setBlock` even returns, in the SAME call that changed
//   the neighbour -- there is no scheduling anywhere in the path (07b_behaviour.js's own header
//   names layer 4, `Behave.schedule`/`Behave.tick`, as water/lava only). `cane_base_changed` and
//   `cane_cut_middle`'s top cell below show it directly: server gone at TRIGGER+1, engine gone AT
//   TRIGGER. The 3-tall column makes the same point three times over: vanilla breaks it bottom-up
//   across THREE separate ticks (each break is itself the neighbour change scheduling the next);
//   the engine would pop the whole column in one pass. THIS ONE HAS NO ONE-LINE FIX (it needs an
//   actual scheduling path, not a guard fix) -- `demoFixedRun` below is an ILLUSTRATION, over a
//   small scratch world (not the real engine, not src/**), of the shape that fix would need.
//
// No golden -> SKIP.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, initRegistry, MCLITE_ROOT, SRC, WORKER_FILES } from '../loadsrc.mjs';
import { SCENARIOS, TRIGGER, T, origin, GY } from './survivescen.mjs';

const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'column-survive.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'column-survive.json')].find((f) => existsSync(f));
if (!GOLDEN) {
  console.log('surviverefcheck: SKIP (golden not generated -- run node tools/referee/runsurvive.mjs)');
  process.exit(0);
}
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));

let pass = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };

const EXTRA = ['07_world.js', '02f_tags.js', '07b_behaviour.js'];

/** A fresh engine, one small real chunk grid, ready for `W.setBlock`. */
function makeEngine() {
  const M = loadEngine({ extra: EXTRA, dom: false });
  const W = M.World, CH = M.CH;
  W.init(1);
  for (let cx = -1; cx <= 2; cx++) for (let cz = -1; cz <= 1; cz++) {
    const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
  }
  const w = { get: (x, y, z) => W.getBlock(x, y, z), set: (x, y, z, st) => W.setBlock(x, y, z, st) };
  w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 15 << 4;
  M.Behave.init(w);
  W.canSurvivePatched = false;
  return { M, W };
}

// ── FINDING 1's scratch fix, proven with the REAL engine (--verbose only, src/** never written
// to disk): loads the exact same source files `loadEngine` would, except `07_world.js`'s text is
// patched IN MEMORY, one line, to match `cascadeFrom`'s guard (src/07_world.js:900) to the
// placement gate's own already-correct condition (src/07_world.js:927). If the source text this
// reads no longer contains the guard verbatim, this throws rather than silently proving nothing.
const CASCADE_GUARD = 'if (st === 0 || !NS.States.support[st]) continue;';
const CASCADE_GUARD_FIXED = 'if (st === 0 || !(NS.States.support[st] || (NS.States.rule && NS.States.rule[st]))) continue;';
function loadEnginePatchedCascade() {
  const files = WORKER_FILES.concat(EXTRA);
  const src = files.map((f) => {
    const text = readFileSync(join(SRC, f), 'utf8');
    if (f !== '07_world.js') return text;
    if (!text.includes(CASCADE_GUARD)) throw new Error('scratch fix: cascadeFrom\'s guard text was not found verbatim in src/07_world.js -- the file moved, re-locate the one-line patch before trusting this demo');
    return text.replace(CASCADE_GUARD, CASCADE_GUARD_FIXED);
  }).join('\n');
  const body = "'use strict';\n" + src + '\nreturn MCL;\n';
  const MCL = new Function(body)();
  initRegistry(MCL);
  return MCL;
}
function makeEnginePatchedCascade() {
  const M = loadEnginePatchedCascade();
  const W = M.World, CH = M.CH;
  W.init(1);
  for (let cx = -1; cx <= 2; cx++) for (let cz = -1; cz <= 1; cz++) {
    const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
  }
  const w = { get: (x, y, z) => W.getBlock(x, y, z), set: (x, y, z, st) => W.setBlock(x, y, z, st) };
  w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 15 << 4;
  M.Behave.init(w);
  return { M, W };
}

/** setblock-shaped state text -> a packed state int, via the engine's own registry. */
function stateOf(M, spec) {
  if (spec === 'minecraft:air' || spec === 0) return 0;
  const S = M.States;
  const m = /^minecraft:([a-z_0-9]+)(?:\[(.*)\])?$/.exec(spec);
  const name = m ? m[1] : spec.replace(/^minecraft:/, '');
  let st = S.stateOf(name) | 0;
  if (m && m[2]) {
    for (const pair of m[2].split(',')) {
      const [k, v] = pair.split('=');
      st = M.Behave.setProp(st, k, v);
    }
  }
  return st;
}

/**
 * Runs one scenario in a real engine, sampling every probe cell every tick with the SAME clock
 * survivescen.mjs's server plan uses: (k==1 place)(k==TRIGGER change) -> sample -> Behave.tick().
 * `patch(M, W)` lets an anti-vacuity break perturb the fresh engine before it runs.
 */
function runEngine(sc, patch, engineFactory) {
  const { M, W } = (engineFactory || makeEngine)();
  if (patch) patch(M, W);
  const o = origin(0); // one scenario per engine instance -- always its own local (8,*,8)
  const at = (c) => [o.x + c[0], GY + c[1], o.z + c[2]];
  const series = sc.probes.map(() => []);
  for (let k = 1; k <= T; k++) {
    if (k === 1) {
      W.setBlock(...at([8, 0, 8]), stateOf(M, `minecraft:${sc.ground}`));
      for (const s of sc.setup) W.setBlock(...at(s.pos), stateOf(M, s.block));
      for (const p of sc.plant) W.setBlock(...at(p), M.Behave.setProp(stateOf(M, `minecraft:${sc.block}`), 'age', '0'));
    }
    // The server's `setblock` never asks canSurvive; the engine's setBlock gate does (D-155). Waive the gate for the
    // changed cell only, so a floating sign still lands and then dooms its neighbour, as on the server.
    if (k === TRIGGER) for (const c of sc.change) {
      const [cx, cy, cz] = at(c.pos), orig = W.canSurvive;
      W.canSurvive = (x, y, z, st) => (x === cx && y === cy && z === cz) || orig(x, y, z, st);
      try { W.setBlock(cx, cy, cz, stateOf(M, c.to)); } finally { W.canSurvive = orig; }
    }
    const blockId = M.Reg.id[sc.block];
    sc.probes.forEach((p, pi) => {
      const st = W.getBlock(...at(p));
      series[pi].push(st !== 0 && M.States.block[st] === blockId ? 1 : 0);
    });
    M.Behave.tick();
  }
  return series;
}

console.log(`surviverefcheck — cactus/sugar-cane support-loss timing vs the real 1.18.2 server (${SCENARIOS.length} scenarios, TRIGGER=${golden.trigger}, T=${golden.T}, ${golden.generatedAt})`);

function firstDiff(a, b) { for (let t = 0; t < Math.max(a.length, b.length); t++) if ((a[t] | 0) !== (b[t] | 0)) return t; return -1; }

const engineByScenario = {};
for (const sc of SCENARIOS) {
  const g = golden.cases[sc.id];
  if (!ok(!!g && g.series.length === sc.probes.length, `${sc.id}: in the golden with ${sc.probes.length} probe cell(s) (regenerate: node tools/referee/runsurvive.mjs)`)) continue;
  let eng;
  try { eng = runEngine(sc); } catch (e) { ok(false, `${sc.id}: engine threw ${e.message}`); continue; }
  engineByScenario[sc.id] = eng;
  let sawDiff = false;
  sc.probes.forEach((p, pi) => {
    const gs = g.series[pi], es = eng[pi];
    if (!gs || gs.length !== es.length) { ok(false, `${sc.id}.p${pi}: golden has ${gs && gs.length} samples, engine has ${es.length}`); sawDiff = true; return; }
    const t = firstDiff(gs, es);
    if (t >= 0) {
      sawDiff = true;
      ok(false, `${sc.id}.p${pi} (${p.join(',')}): first differs at tick ${t + 1} -- server ${gs[t]} engine ${es[t]} (${sc.expect}) [server ${gs.slice(Math.max(0, t - 2), t + 4).join('')} | engine ${es.slice(Math.max(0, t - 2), t + 4).join('')}]`);
    } else pass++;
  });
  if (VERBOSE) for (const p of sc.probes) console.log(`   ${sc.id} p${sc.probes.indexOf(p)}: server ${g.series[sc.probes.indexOf(p)].join('')} engine ${eng[sc.probes.indexOf(p)].join('')}`);
  if (!sawDiff) pass++;
}

// ── SCRATCH-COPY FIX (not committed, src/** untouched): the one-line change cascadeFrom would
// need -- schedule the break a tick later instead of doing it inline -- reimplemented over a
// plain Map world so its effect on the TIMING can be shown without touching src/07_world.js.
function demoFixedRun(sc) {
  const cells = new Map(); const key = (x, y, z) => x + ',' + y + ',' + z;
  const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => { if (s === 0) cells.delete(key(x, y, z)); else cells.set(key(x, y, z), s); } };
  const isCactus = sc.block === 'cactus';
  const o = origin(0); const at = (c) => [o.x + c[0], GY + c[1], o.z + c[2]];
  const solidBlocks = new Set(['stone', 'glass', 'oak_fence', 'oak_sign']);
  function canPlaceAt(x, y, z) {
    if (isCactus) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nb = w.get(x + dx, y, z + dz);
        if (nb && (solidBlocks.has(nb) || nb === 'lava')) return false;
      }
      const below = w.get(x, y - 1, z);
      if (below !== sc.ground && below !== 'cactus') return false;
      const above = w.get(x, y + 1, z);
      return above !== 'water' && above !== 'lava';
    }
    const below = w.get(x, y - 1, z);
    if (below === 'sugar_cane') return true;
    if (below !== sc.ground) return false;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
      if (w.get(x + dx, y - 1, z + dz) === 'water' || w.get(x + dx, y - 1, z + dz) === 'frosted_ice') return true;
    return false;
  }
  const scheduled = new Map(); // "x,y,z" -> the tick it fires
  const series = sc.probes.map(() => []);
  for (let k = 1; k <= T; k++) {
    if (k === 1) {
      w.set(...at([8, 0, 8]), sc.ground);
      for (const s of sc.setup) w.set(...at(s.pos), s.block.replace(/^minecraft:/, '').replace(/\[.*/, ''));
      for (const p of sc.plant) w.set(...at(p), sc.block);
    }
    if (k === TRIGGER) for (const c of sc.change) {
      w.set(...at(c.pos), c.to.replace(/^minecraft:/, '').replace(/\[.*/, ''));
      // neighbour update, matching getStateForNeighborUpdate: schedule a recheck 1 tick later
      // for every plant cell in this scratch world, not just the changed cell's own neighbours
      // (keeps the demo simple; the real engine only needs the changed cell's six neighbours).
      for (const p of sc.plant) { const [px, py, pz] = at(p); if (!canPlaceAt(px, py, pz)) scheduled.set(key(px, py, pz), k + 1); }
    }
    // scheduled ticks fire at the START of their tick, before the sample below
    for (const [k2, fireAt] of [...scheduled]) if (fireAt === k) {
      const [x, y, z] = k2.split(',').map(Number);
      if (!canPlaceAt(x, y, z)) { w.set(x, y, z, 0); const above = w.get(x, y + 1, z); if (above === sc.block) scheduled.set(key(x, y + 1, z), k + 1); }
      scheduled.delete(k2);
    }
    sc.probes.forEach((p, pi) => { const [x, y, z] = at(p); series[pi].push(w.get(x, y, z) === sc.block ? 1 : 0); });
  }
  return series;
}
if (VERBOSE) {
  console.log('\n  FINDING 1 scratch fix (cascadeFrom guard patched in memory, src/07_world.js:900, src/** never written):');
  {
    const sc = SCENARIOS.find((x) => x.id === 'cactus_beside_stone');
    const before = runEngine(sc); // the real, unpatched engine: cactus never breaks (Finding 1)
    const after = runEngine(sc, null, makeEnginePatchedCascade); // the same engine, one guard line fixed
    console.log(`   cactus_beside_stone p0: unpatched engine ${before[0].join('')} (never breaks -- the bug)`);
    console.log(`   cactus_beside_stone p0: patched engine   ${after[0].join('')} (now breaks -- guard fix alone reaches canSurvive)`);
    console.log(`   still one tick early vs the server (${golden.cases.cactus_beside_stone.series[0].join('')}): that is Finding 2, a different bug, not fixed by this guard`);
  }
  console.log('\n  FINDING 2 illustration (schedule the break 1 tick later instead of breaking it inline, scratch Map world, not the real engine):');
  for (const sc of ['cactus_beside_stone', 'cactus_column3_sand_removed']) {
    const s = SCENARIOS.find((x) => x.id === sc);
    const fixed = demoFixedRun(s);
    const g = golden.cases[sc];
    let matches = true;
    s.probes.forEach((p, pi) => { if (firstDiff(g.series[pi], fixed[pi]) >= 0) matches = false; });
    console.log(`   ${sc}: fixed-demo vs server tick-exact match: ${matches ? 'YES' : 'no'}`);
  }
}

console.log(`surviverefcheck: ${SCENARIOS.length} scenarios compared, ${fails.length} fail`);

// ── anti-vacuity (D-30/D-305): perturb something in memory, assert it is caught ────────────
let breaks = 0;
const breakStart = fails.length;
{
  // break 1: canSurvive patched to always say "yes" -- every scenario that SHOULD break must
  // now mismatch the golden (the plant never goes away on the engine side).
  const breakers = SCENARIOS.filter((sc) => /breaks/.test(sc.expect));
  let allCaught = true;
  for (const sc of breakers) {
    const g = golden.cases[sc.id];
    if (!g) { allCaught = false; continue; }
    const eng = runEngine(sc, (M, W) => { W.canSurvive = () => true; });
    let caught = false;
    sc.probes.forEach((p, pi) => { if (firstDiff(g.series[pi], eng[pi]) >= 0) caught = true; });
    if (!caught) allCaught = false;
  }
  breaks++;
  if (allCaught) { pass++; if (VERBOSE) console.log('   ✓ break caught: canSurvive patched to always return true'); }
  else fails.push('anti-vacuity: "canSurvive always true" was NOT caught on every breaking scenario');
}
{
  // break 2: the golden series shifted one tick -- the comparison itself must be tick-exact
  // (same shape as leafrefcheck's/buttonrefcheck's "golden shifted one tick" anti-vacuity).
  const sc = SCENARIOS.find((s) => s.id === 'cane_base_changed'); // its golden actually moves (unlike cane_water_removed's constant 1s, which a shift can't touch)
  const g = golden.cases[sc.id];
  const eng = engineByScenario[sc.id] || runEngine(sc);
  const shifted = g.series.map((s) => [s[0], ...s.slice(0, -1)]);
  let caught = false;
  sc.probes.forEach((p, pi) => { if (firstDiff(shifted[pi], eng[pi]) >= 0) caught = true; });
  breaks++;
  if (caught) { pass++; if (VERBOSE) console.log('   ✓ break caught: golden shifted one tick'); }
  else fails.push('anti-vacuity: "golden shifted one tick" was NOT caught');
}

const antiVacFails = fails.length - breakStart;
console.log('');
console.log('================ surviverefcheck (infra referee-survive) ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks - antiVacFails}/${breaks}`);
for (const f of fails) console.log('  ✗ ' + f);
process.exit(fails.length ? 1 : 0);
