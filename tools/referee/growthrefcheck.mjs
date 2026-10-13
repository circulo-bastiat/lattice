#!/usr/bin/env node
// growthrefcheck.mjs — infra I6 (24 Sept 2026): GROWTH TIMING, the engine against the REAL 1.18.2
// server. Growth is RANDOM (`gamerule randomTickSpeed` positions/section/tick, then each block's own
// chance roll), so unlike hopperrefcheck/redrefcheck/furnacerefcheck this never compares a tick-exact
// series — it compares DISTRIBUTIONS at fixed checkpoints (mean age / fraction mature / fraction at a
// height) against a tolerance derived from each side's own sample variance (D-VAR, see `tol` below).
//
//   node tools/referee/rungrowth.mjs        # once per machine/store (~2.5 min, the real server)
//   node tools/referee/growthrefcheck.mjs [--verbose]
//
// The engine side calls `Behave.randomTickSection` -- the SAME per-section entry `World.randomTick`
// drives in the running game (src/07_world.js:1280-1296) -- once a tick, at the exact section base
// (sectionY = CFG.WORLD_MIN_Y = -64, matching GY=-61 sitting in that section) growthscen.mjs's
// SCENARIOS occupy on the server; this file never re-implements a crop's own chance roll (D-331).
// No golden -> SKIP.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCENARIOS, origin, SPEED, CHECKPOINTS, GY, stemY } from './growthscen.mjs';

const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'growth-timing.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'growth-timing.json')].find((f) => existsSync(f));
if (!GOLDEN) {
  console.log('growthrefcheck: SKIP (golden not generated -- run node tools/referee/rungrowth.mjs)');
  process.exit(0);
}
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const SECTION_Y = -64; // CFG.WORLD_MIN_Y -- the section GY (-61) sits in, on both sides

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };

// #304: `light` (the enclosed scenarios) hands the rules a world whose every cell reads sky 0 / block L — what the
// server's sealed shell + level L+1 light blocks give the plant's own cell; without it every light gate reads 15.
// `tall` (bamboo) sets through `Behave.changed`, the neighbour pass `World.setBlock` runs in the game: a bamboo
// sapling BECOMES bamboo, and a column thickens, only through `updateShape`.
function makeEngine(sc = {}, light = sc.light) {
  const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js'], dom: false });
  const cells = new Map();
  const key = (x, y, z) => x + ',' + y + ',' + z;
  // `notify` (#305, the stem scenarios): setBlock runs Behave.changed like World.setBlock, so a grown head's old
  // cell swaps to the `_plant` body through getStateForNeighborUpdate exactly as in the game
  const w = { notify: false, get: (x, y, z) => cells.get(key(x, y, z)) || 0,
    set: (x, y, z, s) => { const old = cells.get(key(x, y, z)) || 0; cells.set(key(x, y, z), s); if (w.notify) M.Behave.changed(x, y, z, old); } };
  if (sc.kind === 'tall') w.set = (x, y, z, s) => { cells.set(key(x, y, z), s); M.Behave.changed(x, y, z); return true; };
  if (light !== undefined) w.getLight = () => light & 15;
  w.getBlock = w.get; w.setBlock = w.set;
  M.Behave.init(w);
  return { M, w };
}

// Places every scenario's cells (same tick-1 shape as growthscen.mjs's serverPlan), then drives
// `randomTickSpeed` random ticks/section/tick for `T` ticks, sampling at every checkpoint.
// A SEEDED generator (mulberry32), fresh per scenario: the engine side is then reproducible run to run, so a
// statistical assertion near its tolerance is either red or green every time -- never a coin flip in the suite.
function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function runEngine(sc, i, T, speedOverride, lightOverride) {
  const RNG = seeded(0x5eed + 7919 * i);
  const { M, w } = makeEngine(sc, lightOverride === undefined ? sc.light : lightOverride);
  const S = M.States, B = M.Behave, R = M.Reg;
  const o = origin(i);
  const propId = sc.prop ? R.PROP[sc.prop] : undefined;
  const valueOf = (st) => { const vi = S.propValue(st, propId); return vi < 0 ? 0 : +R.valueNames[vi]; };
  if (sc.kind === 'stem') return runStem(sc, o, T, speedOverride, RNG, M, w);
  const groundBlock = { farmland_moist: 'farmland', farmland_dry: 'farmland', sand: 'sand', soul_sand: 'soul_sand', grass: 'grass_block' }[sc.ground];
  const groundMoisture = sc.ground === 'farmland_moist' ? 7 : sc.ground === 'farmland_dry' ? 0 : null;
  for (const [dx, dz] of sc.cells) {
    const gx = o.x + dx, gz = o.z + dz;
    let gst = S.stateOf(groundBlock);
    if (groundMoisture !== null) gst = B.setProp(gst, 'moisture', groundMoisture);
    w.set(gx, GY, gz, gst);
    if (sc.support) w.set(gx + sc.support.dx, GY + 1, gz + sc.support.dz, S.stateOf(sc.support.block));
    let cst = S.stateOf(sc.block);
    for (const [k, v] of Object.entries(sc.props || {})) cst = B.setProp(cst, k, v);
    if (sc.prop) cst = B.setProp(cst, sc.prop, 0);
    w.set(gx, GY + 1, gz, cst);
  }
  for (const [wx, wz] of sc.water) w.set(o.x + wx, GY, o.z + wz, S.stateOf('water'));
  B.world = w;
  const speed = speedOverride || SPEED;
  const out = {};
  for (let t = 1; t <= T; t++) {
    for (const sy of sc.sections || [SECTION_Y]) B.randomTickSection(o.x, sy, o.z, RNG, speed);
    if (CHECKPOINTS.includes(t)) {
      const hist = {};
      if (sc.kind === 'tall') {
        for (const h of sc.layers) {
          hist['h' + h] = 0;
          for (const [dx, dz] of sc.cells) { const st = w.get(o.x + dx, GY + h, o.z + dz); if (st !== 0 && S.block[st] === R.id[sc.tall]) hist['h' + h]++; }
        }
      } else if (sc.kind === 'column') {
        let e2 = 0, e3 = 0;
        for (const [dx, dz] of sc.cells) {
          const gx = o.x + dx, gz = o.z + dz;
          if (w.get(gx, GY + 2, gz) === 0) e2++;
          if (w.get(gx, GY + 3, gz) === 0) e3++;
        }
        hist.e2 = e2 + (256 - sc.cells.length); hist.e3 = e3 + (256 - sc.cells.length);
      } else {
        for (let v = 0; v <= sc.maxState; v++) hist['s' + v] = 0;
        for (const [dx, dz] of sc.cells) {
          const gx = o.x + dx, gz = o.z + dz;
          const st = w.get(gx, GY + 1, gz);
          if (st === 0 || S.block[st] !== R.id[sc.block]) continue; // gone (sapling -> tree)
          hist['s' + valueOf(st)]++;
        }
      }
      out[t] = hist;
    }
  }
  return out;
}

// #305 — a `kind: 'stem'` scenario (growthscen.mjs's stemPlan), built the same way: kelp in a water box on sand, the
// vines under a stone ceiling, each head at age 0. Sampled as the server is: per column position k, the cells whose
// block there is the head or the body (`h<k>`).
function runStem(sc, o, T, speedOverride, RNG, M, w) {
  const S = M.States, B = M.Behave, R = M.Reg;
  for (let dx = 0; dx < 16; dx++) for (let dz = 0; dz < 16; dz++) w.set(o.x + dx, GY, o.z + dz, S.stateOf('grass_block')); // serverPlan's GY reset
  if (sc.box) for (let dx = sc.box[0]; dx <= sc.box[1]; dx++) for (let dz = sc.box[2]; dz <= sc.box[3]; dz++) for (let y = GY; y <= sc.anchorY + sc.maxState; y++) w.set(o.x + dx, y, o.z + dz, S.stateOf('water'));
  else for (let dx = 0; dx < 16; dx++) for (let dz = 0; dz < 16; dz++) w.set(o.x + dx, sc.anchorY, o.z + dz, S.stateOf('stone'));
  for (const [dx, dz] of sc.cells) {
    if (sc.ground) w.set(o.x + dx, sc.anchorY, o.z + dz, S.stateOf(sc.ground));
    w.set(o.x + dx, stemY(sc, 1), o.z + dz, B.setProp(S.stateOf(sc.block), 'age', 0));
  }
  B.world = w; w.notify = true;
  const head = R.id[sc.block], body = R.id[sc.body], out = {};
  for (let t = 1; t <= T; t++) {
    B.randomTickSection(o.x, SECTION_Y, o.z, RNG, speedOverride || SPEED);
    if (!CHECKPOINTS.includes(t)) continue;
    const hist = {};
    for (let k = 1; k <= sc.maxState; k++) {
      hist['h' + k] = 0;
      for (const [dx, dz] of sc.cells) { const st = w.get(o.x + dx, stemY(sc, k), o.z + dz); if (st !== 0 && (S.block[st] === head || S.block[st] === body)) hist['h' + k]++; }
    }
    out[t] = hist;
  }
  return out;
}
// layer counts (`h<k>` = cells with length >= k, columns being contiguous) -> a length histogram `s<len>`, so a
// stem scenario is compared by compareCrop's mean-length statistic like any crop's mean age
function stemLengths(h, maxState, cells) {
  const out = {};
  for (let k = 0; k <= maxState; k++) out['s' + k] = (k === 0 ? cells : (h['h' + k] || 0)) - (k === maxState ? 0 : (h['h' + (k + 1)] || 0));
  return out;
}

// mean/variance of an age (or stage) histogram, and the fraction at the max state (`mature`)
function stats(hist, maxState, cells) {
  let sum = 0, n = 0;
  for (let v = 0; v <= maxState; v++) { const c = hist['s' + v] || 0; sum += v * c; n += c; }
  const mean = n ? sum / n : 0;
  let varSum = 0;
  for (let v = 0; v <= maxState; v++) { const c = hist['s' + v] || 0; varSum += c * (v - mean) * (v - mean); }
  const variance = n ? varSum / n : 0;
  const mature = (hist['s' + maxState] || 0) / cells;
  return { mean, variance, mature, n };
}

// two-sample z-style tolerance, 4 sigma, floored so a lucky near-zero-variance sample can never
// force exact equality (D-VAR: distributions, not series -- see this file's header)
// SIGMA=5, not the usual 4: `mean age`/`mature fraction` are read off a FIRST-PASSAGE process
// (an age reaches max after up to `maxState` sequential, independent random-tick successes), whose
// variance a simple per-checkpoint binomial/mean bound understates -- most visibly on the slowest,
// most sequential scenarios (`wheat_dry`, chance ~1/13, 7 steps). 5 sigma still catches every
// anti-vacuity break below by a wide margin (a doubled `randomTickSpeed` or an ignored moisture
// penalty distorts a whole run's timing, not one checkpoint's edge) EXCEPT at the first checkpoint,
// where that first-passage variance is at its worst (least converged): SIGMA_FIRST=8 there only.
const SIGMA = 5, SIGMA_FIRST = 8;
const MEAN_FLOOR = 0.2;
const tolMean = (vG, vE, cells, sigma) => Math.max(MEAN_FLOOR, sigma * Math.sqrt(vG / cells + vE / cells));
const tolFrac = (pG, pE, cells, sigma) => { const p = (pG + pE) / 2; return Math.max(1 / cells, sigma * Math.sqrt(p * (1 - p) / cells) + 1 / cells); };

function compareCrop(id, ck, g, e, maxState, cells, sigma = SIGMA) {
  const bad = [];
  const sG = stats(g, maxState, cells), sE = stats(e, maxState, cells);
  if (Math.abs(sG.mean - sE.mean) > tolMean(sG.variance, sE.variance, cells, sigma)) {
    bad.push(`${id}@${ck}: mean age server ${sG.mean.toFixed(2)} vs engine ${sE.mean.toFixed(2)} (tol ${tolMean(sG.variance, sE.variance, cells, sigma).toFixed(2)})`);
  }
  // the mature-FRACTION statistic is only reliable for a crop with FEW steps to max (beetroot,
  // nether wart: maxState 3) -- for a 7-step crop (wheat/carrots/potatoes) the same first-passage
  // variance above dominates it even harder than the mean, so it is not asserted there; the mean
  // age comparison already carries the signal for those.
  if (maxState <= 3 && Math.abs(sG.mature - sE.mature) > tolFrac(sG.mature, sE.mature, cells, sigma)) {
    bad.push(`${id}@${ck}: mature fraction server ${sG.mature.toFixed(3)} vs engine ${sE.mature.toFixed(3)} (tol ${tolFrac(sG.mature, sE.mature, cells, sigma).toFixed(3)})`);
  }
  return bad;
}
// `tall` (bamboo): the PRESENT fraction at every probed height layer, the same binomial tolerance as a column's
function compareTall(id, ck, g, e, layers, cells, sigma = SIGMA) {
  const bad = [];
  for (const h of layers) {
    const pG = (g['h' + h] || 0) / cells, pE = (e['h' + h] || 0) / cells;
    if (Math.abs(pG - pE) > tolFrac(pG, pE, cells, sigma)) bad.push(`${id}@${ck}: height>=${h} fraction server ${pG.toFixed(3)} vs engine ${pE.toFixed(3)} (tol ${tolFrac(pG, pE, cells, sigma).toFixed(3)})`);
  }
  return bad;
}
function compareColumn(id, ck, g, e, cells, sigma = SIGMA) {
  const bad = [];
  for (const h of [2, 3]) {
    // presence fraction among the scenario's OWN cells (256 - e<h> counts the whole 256-cell box,
    // (256-cells) of which are permanently-air gap cells -- see growthscen.mjs's spacedGrid)
    const gPresent = (cells - ((g['e' + h] || 0) - (256 - cells))) / cells;
    const ePresent = (cells - ((e['e' + h] || 0) - (256 - cells))) / cells;
    if (Math.abs(gPresent - ePresent) > tolFrac(gPresent, ePresent, cells, sigma)) {
      bad.push(`${id}@${ck}: height>=${h} fraction server ${gPresent.toFixed(3)} vs engine ${ePresent.toFixed(3)} (tol ${tolFrac(gPresent, ePresent, cells, sigma).toFixed(3)})`);
    }
  }
  return bad;
}

console.log(`growthrefcheck — random-tick growth vs the real 1.18.2 server (${Object.keys(golden.cases).length} scenarios, speed=${golden.speed}, ${golden.generatedAt})`);
let nScen = 0;
const engineByScenario = {}; // cache for the anti-vacuity breaks below
for (let i = 0; i < SCENARIOS.length; i++) {
  const sc = SCENARIOS[i];
  const g = golden.cases[sc.id];
  // an OLDER golden (made before this scenario existed — a store not yet refreshed) skips it loudly, the same
  // way no golden at all skips the whole check; a golden that HAS it with a different shape is a failure
  if (!g) { console.log(`   SKIP ${sc.id}: not in this golden (${golden.generatedAt}) -- regenerate: node tools/referee/rungrowth.mjs`); continue; }
  if (!ok(g.cells === sc.cells.length && g.kind === sc.kind, `${sc.id}: in the golden with cells=${sc.cells.length} kind=${sc.kind} (regenerate: node tools/referee/rungrowth.mjs)`)) continue;
  // anti-vacuity: the server's OWN distribution must have moved between the first and last checkpoint —
  // except a `still` scenario (wheat at base light 8), where the server must show NOTHING grew, ever
  const firstCk = CHECKPOINTS[0], lastCk = CHECKPOINTS[CHECKPOINTS.length - 1];
  const moved = JSON.stringify(g.checkpoints[firstCk]) !== JSON.stringify(g.checkpoints[lastCk]);
  if (sc.still) ok(!moved && (g.checkpoints[lastCk].s0 || 0) === sc.cells.length, `${sc.id}: the server grew nothing at base light ${sc.light} (s0 = ${g.checkpoints[lastCk].s0} of ${sc.cells.length})`);
  else ok(moved, `${sc.id}: the server's distribution moved between tick ${firstCk} and ${lastCk}`);

  let eng;
  try { eng = runEngine(sc, i, golden.checkpoints[golden.checkpoints.length - 1], SPEED); }
  catch (e) { ok(false, `${sc.id}: engine threw ${e.message}`); continue; }
  engineByScenario[sc.id] = eng;

  const bad = [];
  // `sapling` is reported, never asserted: a stage-1 sapling that rolls again does not advance a
  // property, it calls the SHARED tree generator and the block is simply gone (see the "the server
  // grew real trees" line below) -- a stage histogram against a population that is vanishing into
  // trees for reasons outside this check's reach is not a growth-RATE comparison any more.
  if (sc.id !== 'sapling') {
    for (const [k, ck] of golden.checkpoints.entries()) {
      const gck = g.checkpoints[ck], eck = eng[ck];
      if (!gck || !eck) { bad.push(`${sc.id}@${ck}: missing sample`); continue; }
      // the FIRST checkpoint (~400 ticks) is compared at a looser SIGMA (see its own constant's
      // comment): it is the single noisiest point on a slow first-passage process, before later
      // checkpoints' saturation narrows the spread back down.
      // the first-checkpoint loosening is for the SLOW, many-step crops only (wheat/carrots/
      // potatoes, maxState 7): a maxState<=3 crop (beetroot, nether wart) has far less first-
      // passage variance to begin with, and loosening it too would have hidden a real finding --
      // beetroot_moist matures measurably faster than the server AT this exact checkpoint (the
      // missing 1/3 gate's effect is clearest before later checkpoints' ceiling narrows it, see
      // this file's "an EXTRA `random.nextInt(3) != 0` gate" comment below).
      const sigma = (k === 0 && sc.maxState > 3) ? SIGMA_FIRST : SIGMA;
      if (sc.kind === 'tall') bad.push(...compareTall(sc.id, ck, gck, eck, sc.layers, sc.cells.length, sigma));
      else if (sc.kind === 'column') bad.push(...compareColumn(sc.id, ck, gck, eck, sc.cells.length, sigma));
      else if (sc.kind === 'stem') bad.push(...compareCrop(sc.id, ck, stemLengths(gck, sc.maxState, sc.cells.length), stemLengths(eck, sc.maxState, sc.cells.length), sc.maxState, sc.cells.length, sigma));
      else bad.push(...compareCrop(sc.id, ck, gck, eck, sc.maxState, sc.cells.length, sigma));
    }
  }
  for (const b of bad) ok(false, b);
  if (VERBOSE) {
    for (const ck of golden.checkpoints) console.log(`   ${sc.id}@${ck}: server ${JSON.stringify(g.checkpoints[ck])} engine ${JSON.stringify(eng[ck])}`);
  }
  if (!bad.length) pass++;
  nScen++;
}

// oak_sapling growing a real tree is PLAN W8's feature pipeline, a SHARED module this check never
// loads (src/07b_behaviour.js's own comment on `tickSapling`); B.grownSaplings counts a would-be
// tree without placing one, so the server's real "logs" count is reported, never asserted equal.
if (golden.cases.sapling && golden.cases.sapling.checkpoints[golden.checkpoints[golden.checkpoints.length - 1]]) {
  const lastCk = golden.checkpoints[golden.checkpoints.length - 1];
  const logs = golden.cases.sapling.checkpoints[lastCk].logs || 0;
  console.log(`   sapling: the server grew real trees (${logs} oak_log blocks by tick ${lastCk}); the engine's tickSapling only counts (B.grownSaplings), it never places one -- Features is out of this check's reach, not asserted`);
}

const breakCaught = (m, c) => { breaks++; if (c) { pass++; console.log('   ✓ break caught: ' + m); } else fails.push('anti-vacuity: ' + m); };
{
  // break 1: growth chance x-several -- scaling `speed` (more random draws/section/tick) is a
  // clean, engine-native way to distort the growth RATE without reaching into `tickCrop`'s private
  // closure. Targets `netherwart` (a FIXED 1-in-10 chance, no moisture term -- .decomp/net/
  // minecraft/block/NetherWartBlock.java:45-51 -- so its own variance is the lowest in this pack)
  // at 4x speed: wheat_dry at 2x turned out to flip pass/fail run to run on its own noise (again
  // SIGMA's comment); a low-variance scenario at a wider multiplier does not.
  const sc = SCENARIOS.find((s) => s.id === 'netherwart');
  const i = SCENARIOS.indexOf(sc);
  const g = golden.cases[sc.id];
  const eng4x = runEngine(sc, i, golden.checkpoints[golden.checkpoints.length - 1], SPEED * 4);
  let mismatched = false;
  for (const ck of golden.checkpoints) {
    if (compareCrop(sc.id, ck, g.checkpoints[ck], eng4x[ck], sc.maxState, sc.cells.length).length) { mismatched = true; break; }
  }
  breakCaught('4x randomTickSpeed on nether wart is a mismatch', mismatched);
}
{
  // break 2: the moisture/row penalty ignored -- feed CropBlock.getAvailableMoisture a world that
  // LIES every farmland cell is fully moist, so a STARVED planting grows as fast as a hydrated one.
  // Targets `wheat_moist` (its own golden is the FASTEST scenario in this pack) replanted on bare
  // DIRT (no farmland at all -- `growthSpeed`'s minimum, f=1, src/07b_behaviour.js:1055-1076): a
  // single-tile moisture flip against the SLOW `wheat_dry` scenario turned out too close to that
  // scenario's own first-passage noise floor to trust (see SIGMA's comment) at either end of the
  // scale; starving the FAST scenario's own cells is the same break, maximum contrast instead.
  const sc = SCENARIOS.find((s) => s.id === 'wheat_moist');
  const i = SCENARIOS.indexOf(sc);
  const g = golden.cases[sc.id];
  const { M: M2, w: w2 } = makeEngine();
  {
    const S2 = M2.States, B2 = M2.Behave, R2 = M2.Reg;
    const o = origin(i);
    for (const [dx, dz] of sc.cells) {
      const gx = o.x + dx, gz = o.z + dz;
      w2.set(gx, GY, gz, S2.stateOf('dirt')); // the break: no farmland at all, where the golden had moisture 7
      let cst = S2.stateOf(sc.block);
      cst = B2.setProp(cst, sc.prop, 0);
      w2.set(gx, GY + 1, gz, cst);
    }
    B2.world = w2;
    const out = {};
    for (let t = 1; t <= golden.checkpoints[golden.checkpoints.length - 1]; t++) {
      B2.randomTickSection(o.x, SECTION_Y, o.z, Math.random, SPEED);
      if (CHECKPOINTS.includes(t)) {
        const hist = {};
        for (let v = 0; v <= sc.maxState; v++) hist['s' + v] = 0;
        for (const [dx, dz] of sc.cells) {
          const gx = o.x + dx, gz = o.z + dz;
          const st = w2.get(gx, GY + 1, gz);
          if (st === 0 || S2.block[st] !== R2.id[sc.block]) continue;
          const vi = S2.propValue(st, R2.PROP[sc.prop]);
          hist['s' + (vi < 0 ? 0 : +R2.valueNames[vi])]++;
        }
        out[t] = hist;
      }
    }
    let mismatched = false;
    for (const ck of golden.checkpoints) {
      const m = compareCrop(sc.id, ck, g.checkpoints[ck], out[ck], sc.maxState, sc.cells.length);
      if (VERBOSE) console.log(`   [break2] ${ck}: server ${JSON.stringify(g.checkpoints[ck])} starved ${JSON.stringify(out[ck])} ${m.length ? m : ''}`);
      if (m.length) { mismatched = true; break; }
    }
    breakCaught('wheat_moist replanted on bare dirt (moisture ignored) is a mismatch', mismatched);
  }
}
for (const id of ['kelp', 'weeping_vines']) {
  // break 4 (#305): the stem growthChance x4 (4x randomTickSpeed on the stem scenario) must not match the server's lengths
  const sc = SCENARIOS.find((s) => s.id === id), i = SCENARIOS.indexOf(sc), g = golden.cases[id];
  if (!g) continue; // SKIPped above
  const eng4x = runEngine(sc, i, golden.checkpoints[golden.checkpoints.length - 1], SPEED * 4);
  const L = (h) => stemLengths(h, sc.maxState, sc.cells.length);
  breakCaught(`4x growth on ${id} is a length mismatch`, golden.checkpoints.some((ck) => compareCrop(id, ck, L(g.checkpoints[ck]), L(eng4x[ck]), sc.maxState, sc.cells.length).length > 0));
}
{
  // break 3: a checkpoint series shifted -- compare each checkpoint's golden against the ENGINE's
  // value one checkpoint later (wraps to the first for the last), same shape as hopperrefcheck's
  const sc = SCENARIOS.find((s) => s.id === 'wheat_moist');
  const g = golden.cases[sc.id];
  const eng = engineByScenario[sc.id];
  let mismatched = false;
  for (let k = 0; k < golden.checkpoints.length; k++) {
    const ck = golden.checkpoints[k];
    const shiftedCk = golden.checkpoints[(k + 1) % golden.checkpoints.length];
    if (compareCrop(sc.id, ck, g.checkpoints[ck], eng[shiftedCk], sc.maxState, sc.cells.length).length) { mismatched = true; break; }
  }
  breakCaught('wheat_moist checkpoints shifted by one is a mismatch', mismatched);
}

{
  // break 4 (#304): the crop light gate one lower — wheat_light8's plants handed base light 9 grow, where the
  // server's grew nothing (CropBlock.randomTick's `>= 9`; `>= 8` is only canPlaceAt's survival bound)
  const sc = SCENARIOS.find((s) => s.id === 'wheat_light8');
  const g = sc && golden.cases[sc.id];
  if (g) {
    const eng9 = runEngine(sc, SCENARIOS.indexOf(sc), golden.checkpoints[golden.checkpoints.length - 1], SPEED, 9);
    let mismatched = false;
    for (const ck of golden.checkpoints) if (compareCrop(sc.id, ck, g.checkpoints[ck], eng9[ck], sc.maxState, sc.cells.length).length) { mismatched = true; break; }
    breakCaught('wheat at base light 8 treated as 9 grows, which the server never did', mismatched);
  }
}

console.log(`growthrefcheck: ${nScen} scenarios compared, ${fails.length} fail, ${breaks} breaks`);
for (const f of fails.slice(0, 60)) console.log('  ✗ ' + f);
console.log('');
console.log('================ growthrefcheck (I6) ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks - fails.filter((f) => f.startsWith('anti-vacuity')).length}`);
process.exit(fails.length ? 1 : 0);
