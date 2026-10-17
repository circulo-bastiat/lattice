#!/usr/bin/env node
// columnrefcheck.mjs — infra column-pack (25 Sept 2026): COLUMN-PLANT growth (sugar cane, cactus)
// vs the REAL 1.18.2 server. Same statistical-distribution shape as growthrefcheck.mjs (growth is
// RANDOM, so this compares checkpoint DISTRIBUTIONS, never a tick-exact series -- D-VAR), built
// against columnscen.mjs's fresh direct-count probe rather than growthscen.mjs's dropped one.
//
//   node tools/referee/runcolumn.mjs        # once per machine/store (the real server)
//   node tools/referee/columnrefcheck.mjs [--verbose]
//
// The engine side calls `Behave.randomTickSection` -- the SAME per-section entry `World.randomTick`
// drives in the running game (src/07_world.js:1280-1296) -- at the exact section base
// (sectionY = CFG.WORLD_MIN_Y = -64, matching GY=-61) columnscen.mjs's SCENARIOS occupy on the
// server. This file never re-implements `tickColumnPlant`'s own chance/height logic (D-331); it
// only reads the SAME `src/07b_behaviour.js:1201` function the running game calls.
// No golden -> SKIP.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCENARIOS, origin, SPEED, CHECKPOINTS, GY } from './columnscen.mjs';

const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'column-growth.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'column-growth.json')].find((f) => existsSync(f));
if (!GOLDEN) {
  console.log('columnrefcheck: SKIP (golden not generated -- run node tools/referee/runcolumn.mjs)');
  process.exit(0);
}
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const SECTION_Y = -64; // CFG.WORLD_MIN_Y -- the section GY (-61) sits in, on both sides

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };

function makeEngine() {
  const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js'], dom: false });
  const cells = new Map();
  const key = (x, y, z) => x + ',' + y + ',' + z;
  const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => { cells.set(key(x, y, z), s); } };
  w.getBlock = w.get; w.setBlock = w.set;
  M.Behave.init(w);
  return { M, w };
}

function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Places every scenario's cells (same tick-1 shape as columnscen.mjs's serverPlan), then drives
// `randomTickSpeed` random ticks/section/tick for `T` ticks, sampling {h2, h3} at every checkpoint
// by direct membership (`S.block[state] === R.id[block]`), the same question the h2/h3 storage
// probe asks the real server.
function runEngine(sc, i, T, speedOverride) {
  const RNG = seeded(0x5eed + 7919 * i);
  const { M, w } = makeEngine();
  const S = M.States, B = M.Behave, R = M.Reg;
  const o = origin(i);
  for (const [dx, dz] of sc.cells) {
    const gx = o.x + dx, gz = o.z + dz;
    w.set(gx, GY, gz, S.stateOf(sc.ground));
    let cst = S.stateOf(sc.block);
    cst = B.setProp(cst, 'age', 0);
    w.set(gx, GY + 1, gz, cst);
  }
  for (const [wx, wz] of sc.water) w.set(o.x + wx, GY, o.z + wz, S.stateOf('water'));
  B.world = w;
  const speed = speedOverride || SPEED;
  const blockId = R.id[sc.block];
  const out = {};
  for (let t = 1; t <= T; t++) {
    B.randomTickSection(o.x, SECTION_Y, o.z, RNG, speed);
    if (CHECKPOINTS.includes(t)) {
      let h2 = 0, h3 = 0;
      for (const [dx, dz] of sc.cells) {
        const gx = o.x + dx, gz = o.z + dz;
        const st2 = w.get(gx, GY + 2, gz), st3 = w.get(gx, GY + 3, gz);
        if (st2 !== 0 && S.block[st2] === blockId) h2++;
        if (st3 !== 0 && S.block[st3] === blockId) h3++;
      }
      out[t] = { h2, h3 };
    }
  }
  return out;
}

// two-sample tolerance on a presence FRACTION (binomial): SIGMA=5 (same width as growthrefcheck's
// crop comparison, D-VAR's own reasoning -- height reaching 2 or 3 is itself a two/three-step
// first-passage process, no lower-variance than a crop's age).
const SIGMA = 5;
const tolFrac = (pG, pE, cells, sigma) => { const p = (pG + pE) / 2; return Math.max(1 / cells, sigma * Math.sqrt(p * (1 - p) / cells) + 1 / cells); };

function compareColumn(id, ck, g, e, cells, sigma = SIGMA) {
  const bad = [];
  for (const h of [2, 3]) {
    const gP = (g['h' + h] || 0) / cells, eP = (e['h' + h] || 0) / cells;
    const tol = tolFrac(gP, eP, cells, sigma);
    if (Math.abs(gP - eP) > tol) bad.push(`${id}@${ck}: height>=${h} fraction server ${gP.toFixed(3)} vs engine ${eP.toFixed(3)} (tol ${tol.toFixed(3)})`);
  }
  return bad;
}

console.log(`columnrefcheck — column-plant (sugar cane / cactus) random-tick growth vs the real 1.18.2 server (${Object.keys(golden.cases).length} scenarios, speed=${golden.speed}, ${golden.generatedAt})`);
let nScen = 0;
const engineByScenario = {};
for (let i = 0; i < SCENARIOS.length; i++) {
  const sc = SCENARIOS[i];
  const g = golden.cases[sc.id];
  if (!ok(!!g && g.cells === sc.cells.length, `${sc.id}: in the golden with cells=${sc.cells.length} (regenerate: node tools/referee/runcolumn.mjs)`)) continue;

  // the golden itself must be internally consistent (h3 <= h2): runcolumn.mjs already refuses to
  // write a golden that violates this, but a stale/hand-edited golden is checked again here too.
  for (const ck of CHECKPOINTS) {
    const b = g.checkpoints[ck];
    ok(!!b && b.h3 <= b.h2, `${sc.id}@${ck}: golden height>=3 (${b && b.h3}) <= height>=2 (${b && b.h2})`);
  }

  const firstCk = CHECKPOINTS[0], lastCk = CHECKPOINTS[CHECKPOINTS.length - 1];
  const moved = JSON.stringify(g.checkpoints[firstCk]) !== JSON.stringify(g.checkpoints[lastCk]);
  ok(moved, `${sc.id}: the server's distribution moved between tick ${firstCk} and ${lastCk}`);

  let eng;
  try { eng = runEngine(sc, i, CHECKPOINTS[CHECKPOINTS.length - 1], SPEED); }
  catch (e) { ok(false, `${sc.id}: engine threw ${e.message}`); continue; }
  engineByScenario[sc.id] = eng;

  const bad = [];
  for (const ck of CHECKPOINTS) {
    const gck = g.checkpoints[ck], eck = eng[ck];
    if (!gck || !eck) { bad.push(`${sc.id}@${ck}: missing sample`); continue; }
    bad.push(...compareColumn(sc.id, ck, gck, eck, sc.cells.length));
    // the engine's OWN sample must also be monotone -- a real discrepancy here is an engine bug
    // this check should surface, not silently average away.
    if (eck.h3 > eck.h2) bad.push(`${sc.id}@${ck}: engine height>=3 (${eck.h3}) > height>=2 (${eck.h2}) -- engine's own sample is non-monotone`);
  }
  for (const b of bad) ok(false, b);
  if (VERBOSE) {
    for (const ck of CHECKPOINTS) console.log(`   ${sc.id}@${ck}: server ${JSON.stringify(g.checkpoints[ck])} engine ${JSON.stringify(eng[ck])}`);
  }
  if (!bad.length) pass++;
  nScen++;
}

// max height: nothing may ever exceed a 3-tall column (h3 present implies the column is already
// at its cap -- SugarCaneBlock.java/CactusBlock.java's own `$$4 < 3` / `$$5 < 3` gate). Checked on
// BOTH sides directly by re-reading height 4 at the last checkpoint (never sampled by the normal
// probe set, so this is a fresh, targeted read).
for (let i = 0; i < SCENARIOS.length; i++) {
  const sc = SCENARIOS[i];
  const g = golden.cases[sc.id];
  if (!g) continue;
  const { M, w } = makeEngine();
  const S = M.States, B = M.Behave, R = M.Reg;
  const o = origin(i);
  for (const [dx, dz] of sc.cells) {
    const gx = o.x + dx, gz = o.z + dz;
    w.set(gx, GY, gz, S.stateOf(sc.ground));
    w.set(gx, GY + 1, gz, B.setProp(S.stateOf(sc.block), 'age', 0));
  }
  for (const [wx, wz] of sc.water) w.set(o.x + wx, GY, o.z + wz, S.stateOf('water'));
  B.world = w;
  const RNG = seeded(0x5eed + 7919 * i);
  const blockId = R.id[sc.block];
  const lastCk = CHECKPOINTS[CHECKPOINTS.length - 1];
  let h4 = 0;
  for (let t = 1; t <= lastCk; t++) {
    B.randomTickSection(o.x, SECTION_Y, o.z, RNG, SPEED);
  }
  for (const [dx, dz] of sc.cells) {
    const gx = o.x + dx, gz = o.z + dz;
    const st4 = w.get(gx, GY + 4, gz);
    if (st4 !== 0 && S.block[st4] === blockId) h4++;
  }
  ok(h4 === 0, `${sc.id}: engine never grows past height 3 (found ${h4} cell(s) at height 4 by tick ${lastCk})`);
}

console.log(`columnrefcheck: ${nScen} scenarios compared, ${fails.length} fail`);

const breakCaught = (m, c) => { breaks++; if (c) { pass++; console.log('   ✓ break caught: ' + m); } else fails.push('anti-vacuity: ' + m); };
{
  // break 1: max column height raised (engine perturbation) -- simulate a bug where the column
  // cap is 4 tall instead of 3 by re-implementing the growth loop inline with a raised cap.
  // ⚠ h2/h3 alone CANNOT see this break: both saturate to "every cell present" within a few
  // hundred ticks regardless of the cap (a taller cap still passes through height 2 and 3 on the
  // way up, it does not skip them), so the normal per-checkpoint h2/h3 comparison stays green.
  // The real, catchable symptom is height 4 becoming occupied at all -- something a real 1.18.2
  // server (and this check's OWN "engine never grows past height 3" assertion just above, on the
  // real, unperturbed engine) never produces. So this break is caught by reading height 4
  // directly off the broken engine's world, the same direct-membership read the golden's own h2/
  // h3 probe uses -- not by feeding it back through compareColumn.
  const sc = SCENARIOS.find((s) => s.id === 'cactus_sand');
  const i = SCENARIOS.indexOf(sc);
  const g = golden.cases[sc.id];
  const RNG = seeded(0x5eed + 7919 * i);
  const { M, w } = makeEngine();
  const S = M.States, B = M.Behave, R = M.Reg;
  const o = origin(i);
  for (const [dx, dz] of sc.cells) {
    const gx = o.x + dx, gz = o.z + dz;
    w.set(gx, GY, gz, S.stateOf(sc.ground));
    w.set(gx, GY + 1, gz, B.setProp(S.stateOf(sc.block), 'age', 0));
  }
  const blockId = R.id[sc.block];
  const P = R.PROP.age;
  const lastCk = CHECKPOINTS[CHECKPOINTS.length - 1];
  const out = {};
  function brokenTickCactus(x, y, z) {
    const st = w.get(x, y, z);
    if (st === 0 || S.block[st] !== blockId) return false;
    if (w.get(x, y + 1, z) !== 0) return false;
    let h = 1;
    while (h < 4) { const below = w.get(x, y - h, z); if (below !== 0 && S.block[below] === blockId) h++; else break; } // BROKEN: cap 4, not 3
    if (h >= 4) return false;
    const vi = S.propValue(st, P);
    const age = vi < 0 ? 0 : +R.valueNames[vi];
    if (age < 15) { w.set(x, y, z, B.setProp(st, 'age', age + 1)); return true; }
    w.set(x, y, z, B.setProp(st, 'age', 0));
    w.set(x, y + 1, z, R.realFirst[blockId] + R.defaultState[blockId]);
    return true;
  }
  for (let t = 1; t <= lastCk; t++) {
    for (let k = 0; k < SPEED; k++) {
      const rx = o.x + ((RNG() * 16) | 0), ry = SECTION_Y + ((RNG() * 16) | 0), rz = o.z + ((RNG() * 16) | 0);
      brokenTickCactus(rx, ry, rz);
    }
  }
  let h4 = 0;
  for (const [dx, dz] of sc.cells) {
    const gx = o.x + dx, gz = o.z + dz;
    const st4 = w.get(gx, GY + 4, gz);
    if (st4 !== 0 && S.block[st4] === blockId) h4++;
  }
  if (VERBOSE) console.log(`   [break1] broken(cap4) cactus_sand height>=4 by tick ${lastCk}: ${h4}/${sc.cells.length} cells (real engine and the real server never reach height 4)`);
  breakCaught('cactus with a 4-tall cap (instead of 3) reaches height 4, which the real game never does', h4 > 0);
}
{
  // break 2: age threshold lowered from 15 to 7 -- doubles the growth rate (half as many random-
  // tick hits needed per step), targets `sugar_cane_water` (the fastest-converging scenario, so
  // the rate difference is most visible by the middle checkpoints before both sides saturate).
  const sc = SCENARIOS.find((s) => s.id === 'sugar_cane_water');
  const i = SCENARIOS.indexOf(sc);
  const g = golden.cases[sc.id];
  const RNG = seeded(0x5eed + 7919 * i);
  const { M, w } = makeEngine();
  const S = M.States, B = M.Behave, R = M.Reg;
  const o = origin(i);
  for (const [dx, dz] of sc.cells) {
    const gx = o.x + dx, gz = o.z + dz;
    w.set(gx, GY, gz, S.stateOf(sc.ground));
    w.set(gx, GY + 1, gz, B.setProp(S.stateOf(sc.block), 'age', 0));
  }
  for (const [wx, wz] of sc.water) w.set(o.x + wx, GY, o.z + wz, S.stateOf('water'));
  const blockId = R.id[sc.block];
  const P = R.PROP.age;
  const lastCk = CHECKPOINTS[CHECKPOINTS.length - 1];
  const out = {};
  function brokenTickCane(x, y, z) {
    const st = w.get(x, y, z);
    if (st === 0 || S.block[st] !== blockId) return false;
    if (w.get(x, y + 1, z) !== 0) return false;
    let h = 1;
    while (h < 3) { const below = w.get(x, y - h, z); if (below !== 0 && S.block[below] === blockId) h++; else break; }
    if (h >= 3) return false;
    const vi = S.propValue(st, P);
    const age = vi < 0 ? 0 : +R.valueNames[vi];
    if (age < 7) { w.set(x, y, z, B.setProp(st, 'age', age + 1)); return true; } // BROKEN: threshold 7, not 15
    w.set(x, y, z, B.setProp(st, 'age', 0));
    w.set(x, y + 1, z, R.realFirst[blockId] + R.defaultState[blockId]);
    return true;
  }
  for (let t = 1; t <= lastCk; t++) {
    for (let k = 0; k < SPEED; k++) {
      const rx = o.x + ((RNG() * 16) | 0), ry = SECTION_Y + ((RNG() * 16) | 0), rz = o.z + ((RNG() * 16) | 0);
      brokenTickCane(rx, ry, rz);
    }
    if (CHECKPOINTS.includes(t)) {
      let h2 = 0, h3 = 0;
      for (const [dx, dz] of sc.cells) {
        const gx = o.x + dx, gz = o.z + dz;
        const st2 = w.get(gx, GY + 2, gz), st3 = w.get(gx, GY + 3, gz);
        if (st2 !== 0 && S.block[st2] === blockId) h2++;
        if (st3 !== 0 && S.block[st3] === blockId) h3++;
      }
      out[t] = { h2, h3 };
    }
  }
  let mismatched = false;
  for (const ck of CHECKPOINTS) {
    if (compareColumn(sc.id, ck, g.checkpoints[ck], out[ck], sc.cells.length).length) { mismatched = true; break; }
  }
  if (VERBOSE) console.log(`   [break2] golden@first ${JSON.stringify(g.checkpoints[CHECKPOINTS[0]])} broken(age7)@first ${JSON.stringify(out[CHECKPOINTS[0]])}`);
  breakCaught('sugar cane with an age-7 grow threshold (instead of 15) is a mismatch', mismatched);
}

console.log('');
console.log('================ columnrefcheck (infra column-pack) ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks - fails.filter((f) => f.startsWith('anti-vacuity')).length}`);
for (const f of fails.slice(0, 60)) console.log('  ✗ ' + f);
process.exit(fails.length ? 1 : 0);
