#!/usr/bin/env node
// endermanrefcheck.mjs — infra w-enderman: ENDERMAN BEHAVIOUR vs the real 1.18.2 server (golden:
// runenderman.mjs, enderman.json; zones/ticks: endermanscen.mjs). Drives src/07zg_enderman.js's
// own PickUpBlockGoal/PlaceBlockGoal/applyWaterDamage against a stub world through the REAL
// registry states + REAL physics (Ph.shapesForState), the same "load the real modules, stub only
// the world" shape floorrefcheck/itemrefcheck already use — never a rewritten copy of the goal.
//
// Two Monte-Carlo RATE zones (pickup/place) run thousands of trials of the goal object itself
// (cheap: pure JS, no real ticking) and compare the resulting CDF, at the server's own checkpoint
// ticks, to the server's measured fraction — tolerance from that sample's own binomial spread
// (never a bare literal). The water/arrow zones are single-call comparisons (does the module's
// own health/position end up where the server's did).
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import {
  G_CHECK, PU_CHECKS, PL_CHECKS, WT_CHECKS, AR_CHECKS,
  P_N as SCEN_P_N, PL_N as SCEN_PL_N, WT_N as SCEN_WT_N, AR_N as SCEN_AR_N, G_N as SCEN_G_N,
} from './endermanscen.mjs';

// deterministic: the sims draw from Math.random / EL.random, and an unseeded run flickered between 6 and 7 reds
let __s = 0x0e4d3a11; const __rng = () => { __s = (__s * 1664525 + 1013904223) >>> 0; return __s / 4294967296; }; Math.random = __rng;
const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'enderman.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'enderman.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('endermanrefcheck: SKIP (golden not generated -- run node tools/referee/runenderman.mjs)'); process.exit(process.env.MCLITE_REQUIRE_REFEREE ? 1 : 0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));

const BASE_MODS = ['02f_tags.js', '07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '14j_combat.js'];
const MOB_MODS = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
const M = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: false, initReg: true });
if (M.EntityList) M.EntityList.random = __rng;
const { States: S, Reg: R, Enderman: EM, Combat: Cb } = M;

// ── stub world: a map of explicitly-set cells, PLUS a synthetic infinite flat floor at y<0 (a
// stone half-space) so `Enderman.teleportTo`'s own "walk the column down to solid ground" scan
// (.decomp teleportRandomly/teleportTo, verbatim in 07zg_enderman.js) always finds ground no
// matter how far the +-32/+-64 random offset lands it — exactly the real flat/superflat world
// runenderman.mjs's own server sits on well below every pen. ─────────────────────────────────
const stoneSt = S.stateOf('stone'), dirtSt = S.stateOf('dirt');
const cells = new Map();
const key = (x, y, z) => x + ',' + y + ',' + z;
const w = {
  get: (x, y, z) => { const v = cells.get(key(x, y, z)); if (v !== undefined) return v; return y < 0 ? stoneSt : 0; },
  set: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); },
};
w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 0; w.tickingAt = () => true; w.loadedAt = () => true;
w.heightAt = () => 0; w.BOTTOM_Y = -64;
M.World = Object.assign(M.World || {}, w);
if (M.Behave && M.Behave.init) M.Behave.init(M.World);
M.EntityList.init();
EM.init();

let griefingOn = true;
M.Commands = Object.assign({}, M.Commands, { ruleGet: (r) => (r === 'mobGriefing' ? (griefingOn ? 'true' : 'false') : undefined) });

function freshEnt(extra) {
  return Object.assign({ x: 0, y: 0, z: 0, dead: false, health: 40, maxHealth: 40, invulnerableTime: 0,
    lastHurt: 0, despawnCounter: 0, hurtTime: 0, carriedBlock: null }, extra);
}

let pass = 0, fails = [], named = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
// ⚠ z=1.5, not a conventional 3-sigma: the server sample sizes here (20-30 lanes) are the
// referee's own real cost budget (a real 1.18.2 server, one RCON round trip), and the ACTUAL
// engine bug this pack exists to catch (PickUpBlockGoal/PlaceBlockGoal's own missing
// Goal.toGoalTicks halving, endermanrefcheck's own named findings below) only clears a stricter
// bound at a couple of checkpoints per rate zone -- verified against the real measured golden
// before this constant was picked, not tuned blind. `Math.max(0.02, ...)` is a noise floor for
// checkpoints near 0%/100% (float/measurement jitter), not a vacuity margin.
function binomTol(pServer, nServer, pEngine) {
  const p = (pServer + pEngine) / 2;
  return Math.max(0.02, 1.5 * Math.sqrt(p * (1 - p) / Math.max(1, nServer)));
}

// ═══════════════════════════ zone G: mobGriefing FALSE control ═══════════════════════════════
{
  griefingOn = false;
  const N = 4000;
  let succeeded = 0;
  for (let i = 0; i < N; i++) {
    const e = freshEnt({});
    const g = new EM.PickUpBlockGoal(e);
    if (g.canUse()) succeeded++;
  }
  const gN = golden.G_N || SCEN_G_N, gCount = golden.g || 0;
  ok(succeeded === 0, `G-zone (mobGriefing false): engine's PickUpBlockGoal.canUse() succeeded ${succeeded}/${N} trials — should be 0 (canUse's own mobGriefing gate)`);
  ok(gCount === 0, `G-zone (mobGriefing false), server: ${gCount}/${gN} endermen picked up a block by t${G_CHECK} — vanilla's own PickUpBlockGoal.canStart (.decomp:449-452) refuses outright when doMobGriefing is false`);
}

// ═══════════════════════════ zone P: PICK-UP rate (mobGriefing true) ═════════════════════════
// pit geometry mirrors runenderman.mjs's own pickupPen: the enderman stands in a 1-deep pit
// (nothing at its own foot cell), ringed by dirt occupying THE SAME y-cell as its feet (the only
// cell PickUpBlockGoal.tick's own `by = floor(e.y + rnd()*3)` range can ever reach -- see that
// file's own header for why "dirt directly underfoot" is unreachable by construction).
function buildPitRing() {
  cells.clear();
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    if (dx === 0 && dz === 0) continue;
    w.set(dx, 0, dz, dirtSt);
  }
}
function simPickupTicks(maxTick) {
  griefingOn = true;
  buildPitRing();
  const e = freshEnt({});
  const g = new EM.PickUpBlockGoal(e);
  for (let t = 1; t <= maxTick; t++) {
    if (g.canUse()) { g.tick(); if (e.carriedBlock) return t; }
  }
  return Infinity;
}
{
  const N = 6000, maxCp = Math.max(...PU_CHECKS);
  const ticks = []; for (let i = 0; i < N; i++) ticks.push(simPickupTicks(maxCp));
  const gPu = golden.pu || {}, gN = golden.P_N || SCEN_P_N;
  for (const cp of PU_CHECKS) {
    const gCount = gPu[cp]; if (gCount === undefined || gCount === null) continue;
    const pServer = gCount / gN;
    const pEngine = ticks.filter((t) => t <= cp).length / N;
    const tol = binomTol(pServer, gN, pEngine);
    const match = Math.abs(pServer - pEngine) <= tol;
    if (!match) {
      named.push(`pickup rate @t${cp}: server ${gCount}/${gN} (${(pServer * 100).toFixed(1)}%) carrying a block, ` +
        `engine sim ${(pEngine * 100).toFixed(1)}% (tol ±${(tol * 100).toFixed(1)}pp) -- the engine's PickUpBlockGoal (src/07zg_enderman.js:286-300, canUse polled EVERY tick here) ` +
        `lands a block faster than the server; root cause NOT settled (vanilla wraps the roll as nextInt(toGoalTicks(20)) = nextInt(10) but runs start checks ` +
        `every 2nd tick, EndermanEntity.java:449 + GoalSelector; the pick position/raycast success rate may also differ) -- re-derive before fixing`);
    } else ok(true, `pickup rate @t${cp}: server ${(pServer * 100).toFixed(1)}%, engine ${(pEngine * 100).toFixed(1)}%`);
  }
}

// ═══════════════════════════ zone PL: PLACE rate (mobGriefing true, pre-carrying) ═════════════
function buildStoneFloor() {
  cells.clear();
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) w.set(dx, -1, dz, stoneSt);
}
function simPlaceTicks(maxTick) {
  griefingOn = true;
  buildStoneFloor();
  const e = freshEnt({ carriedBlock: dirtSt });
  const g = new EM.PlaceBlockGoal(e);
  for (let t = 1; t <= maxTick; t++) {
    if (g.canUse()) { g.tick(); if (!e.carriedBlock) return t; }
  }
  return Infinity;
}
{
  const N = 3000, maxCp = Math.max(...PL_CHECKS);
  const ticks = []; for (let i = 0; i < N; i++) ticks.push(simPlaceTicks(maxCp));
  const gPl = golden.pl || {}, gN = golden.PL_N || SCEN_PL_N;
  for (const cp of PL_CHECKS) {
    const gStillCarrying = gPl[cp]; if (gStillCarrying === undefined || gStillCarrying === null) continue;
    const pServer = 1 - gStillCarrying / gN;      // fraction that HAS placed by cp
    const pEngine = ticks.filter((t) => t <= cp).length / N;
    const tol = binomTol(pServer, gN, pEngine);
    const match = Math.abs(pServer - pEngine) <= tol;
    if (!match) {
      named.push(`place rate @t${cp}: server ${((1 - gStillCarrying / gN) * 100).toFixed(1)}% have placed (${gN - gStillCarrying}/${gN}), ` +
        `engine sim ${(pEngine * 100).toFixed(1)}% (tol ±${(tol * 100).toFixed(1)}pp) -- the engine's PlaceBlockGoal (src/07zg_enderman.js:315-330) places faster ` +
        `than the server; same unsettled cadence question as the pickup rate (vanilla nextInt(toGoalTicks(2000)), EndermanEntity.java:490, start checks every 2nd tick) -- ` +
        `plus the placement position/validity test -- re-derive before fixing`);
    } else ok(true, `place rate @t${cp}: server ${((1 - gStillCarrying / gN) * 100).toFixed(1)}%, engine ${(pEngine * 100).toFixed(1)}%`);
  }
}

// ═══════════════════════════ zone WT: water damage + escape-teleport ═════════════════════════
function simWater(maxTick) {
  cells.clear();
  const e = freshEnt({ inWater: true });
  const snap = {};
  for (let t = 1; t <= maxTick; t++) {
    if (!e.dead) EM.applyWaterDamage(e);
    if (WT_CHECKS.includes(t)) snap[t] = { health: e.health, moved: Math.hypot(e.x, e.y, e.z) > 1.5 };
  }
  return snap;
}
{
  const N = 2000, maxCp = Math.max(...WT_CHECKS);
  const sims = []; for (let i = 0; i < N; i++) sims.push(simWater(maxCp));
  const gWt = golden.wt || {}, gN = golden.WT_N || SCEN_WT_N, gSpawn = golden.wtSpawn || [];
  for (const cp of WT_CHECKS) {
    const rows = gWt[cp]; if (!rows) continue;
    let movedServer = 0, sampled = 0, healthSumServer = 0, healthCountServer = 0;
    rows.forEach((row, i) => {
      if (!row) { movedServer++; sampled++; return; }   // missing read: unloaded far away == moved
      sampled++;
      const sp = gSpawn[i] || { x: 0, z: 0 };
      const dx = row.x - sp.x, dz = row.z - sp.z;
      if (Math.hypot(dx, dz) / 1000 > 1.5) movedServer++;
      healthSumServer += row.h / 100; healthCountServer++;
    });
    const pMovedServer = sampled ? movedServer / sampled : null;
    const pMovedEngine = sims.filter((s) => s[cp] && s[cp].moved).length / N;
    if (pMovedServer !== null) {
      const tol = binomTol(pMovedServer, sampled, pMovedEngine);
      ok(Math.abs(pMovedServer - pMovedEngine) <= tol,
        `water escape-teleport @t${cp}: server ${(pMovedServer * 100).toFixed(1)}% moved (${movedServer}/${sampled}), ` +
        `engine ${(pMovedEngine * 100).toFixed(1)}% (tol ±${(tol * 100).toFixed(1)}pp)`);
    }
    if (healthCountServer) {
      const avgHServer = healthSumServer / healthCountServer;
      const avgHEngine = sims.reduce((s, x) => s + (x[cp] ? x[cp].health : 40), 0) / N;
      ok(Math.abs(avgHServer - avgHEngine) <= 1.5,
        `water damage @t${cp}: server avg health ${avgHServer.toFixed(2)} (n=${healthCountServer}), engine avg ${avgHEngine.toFixed(2)}`);
    }
  }
}

// ═══════════════════════════ zone AR: projectile hit — dodge vs damage ═══════════════════════
// KW-42 (fixed): `Cb.hurt`'s own `e.type === 'enderman' && src.source === 'projectile'` gate
// (src/14j_combat.js), wired from `Cb.tickArrow`'s entity-hit branch -- up to 64
// `teleportRandomly()` attempts, real damage() never reached (.decomp EndermanEntity.java:
// 351-364). This reproduces exactly that call, the real code an arrow hit runs through today,
// on an entity actually TYPED `enderman` (teleportRandomly is a no-op for anything else) so a
// regression back to the old blanket `Cb.hurt(t, dmg, ...)` call (no type/source gate at all)
// shows up here as a mismatch again.
function simArrow() {
  const e = freshEnt({ type: 'enderman' });
  Cb.hurt(e, 6, undefined, false, { attacker: null, source: 'projectile' });
  return { healthSame: e.health === 40, moved: Math.hypot(e.x, e.y, e.z) > 1.5 };
}
{
  const N = 2000;
  const sims = []; for (let i = 0; i < N; i++) sims.push(simArrow());
  const gAr = golden.ar || {}, gN = golden.AR_N || SCEN_AR_N, gSpawn = golden.arSpawn || [];
  for (const cp of AR_CHECKS) {
    const rows = gAr[cp]; if (!rows) continue;
    let movedServer = 0, healthSameServer = 0, sampled = 0;
    rows.forEach((row, i) => {
      if (!row) { movedServer++; sampled++; return; }
      sampled++;
      const sp = gSpawn[i] || { x: 0, z: 0 };
      const dx = row.x - sp.x, dz = row.z - sp.z;
      if (Math.hypot(dx, dz) / 1000 > 1.5) movedServer++;
      if (row.h / 100 >= 39.5) healthSameServer++;
    });
    if (!sampled) continue;
    const pMovedServer = movedServer / sampled, pHSameServer = healthSameServer / sampled;
    const pMovedEngine = sims.filter((s) => s.moved).length / N, pHSameEngine = sims.filter((s) => s.healthSame).length / N;
    const movedMatch = Math.abs(pMovedServer - pMovedEngine) <= binomTol(pMovedServer, sampled, pMovedEngine);
    const healthMatch = Math.abs(pHSameServer - pHSameEngine) <= binomTol(pHSameServer, sampled, pHSameEngine);
    if (!movedMatch || !healthMatch) {
      named.push(`arrow hit @t${cp}: server ${(pMovedServer * 100).toFixed(0)}% teleported / ${(pHSameServer * 100).toFixed(0)}% health unchanged ` +
        `(${sampled} lanes), engine ${(pMovedEngine * 100).toFixed(0)}% teleported / ${(pHSameEngine * 100).toFixed(0)}% health unchanged -- ` +
        `EndermanEntity.damage()'s ProjectileDamageSource override (.decomp:351-364: 64 attempts at teleportRandomly, ` +
        `real damage() is never even called unless all 64 fail) is unwired: src/14j_combat.js:1387 applies arrow damage ` +
        `to an enderman exactly like any other mob, no teleport-dodge at all`);
    } else ok(true, `arrow hit @t${cp}: server/engine agree (moved ${(pMovedServer * 100).toFixed(0)}%, health-same ${(pHSameServer * 100).toFixed(0)}%)`);
  }
}

// ═══════════════════════════ ANTI-VACUITY (D-30/D-305) ════════════════════════════════════════
// Two independent breaks, each required to flip an assert this run just marked PASSING (never
// one already failing above -- that would prove nothing).
let breaks = 0, breakPass = 0;
function breakAndCatch(label, run) {
  breaks++;
  let broke = false;
  try { broke = run(); } catch (e) { broke = false; }
  if (broke) { breakPass++; pass++; if (VERBOSE) console.log('  ✓ break caught: ' + label); }
  else fails.push('anti-vacuity: ' + label + ' -- did not flip a currently-matching assert');
}
// break 1: mobGriefing gate bypassed entirely -- the G-zone control (currently 0/N both sides)
// must start succeeding.
breakAndCatch('PickUpBlockGoal.canUse\'s own mobGriefing gate bypassed', () => {
  griefingOn = false;
  const savedRuleGet = M.Commands.ruleGet;
  M.Commands.ruleGet = () => 'true';   // pretend griefing is always on, regardless of the real flag
  let succeeded = 0;
  for (let i = 0; i < 500; i++) { const e = freshEnt({}); if (new EM.PickUpBlockGoal(e).canUse()) succeeded++; }
  M.Commands.ruleGet = savedRuleGet;
  return succeeded > 0 && (golden.g || 0) === 0;   // the server-measured baseline this would have matched
});
// break 2: water damage disabled outright -- the water-escape/health asserts above (whichever
// checkpoints matched) must start disagreeing with the server's own measured teleport rate.
breakAndCatch('Enderman.applyWaterDamage disabled outright', () => {
  const saved = EM.applyWaterDamage;
  EM.applyWaterDamage = function () {};
  const cp = WT_CHECKS[WT_CHECKS.length - 1];
  const rows = (golden.wt || {})[cp];
  let broke = false;
  if (rows) {
    let movedServer = 0, sampled = 0;
    rows.forEach((row, i) => {
      if (!row) { movedServer++; sampled++; return; }
      sampled++;
      const sp = (golden.wtSpawn || [])[i] || { x: 0, z: 0 };
      if (Math.hypot(row.x - sp.x, row.z - sp.z) / 1000 > 1.5) movedServer++;
    });
    const pServer = sampled ? movedServer / sampled : 0;
    let movedEngine = 0;
    for (let i = 0; i < 300; i++) { const s = simWater(cp); if (s[cp] && s[cp].moved) movedEngine++; }
    const pEngine = movedEngine / 300;
    broke = sampled > 0 && Math.abs(pServer - pEngine) > binomTol(pServer, sampled, pEngine);
  }
  EM.applyWaterDamage = saved;
  return broke;
});

// ═══════════════════════════ orchestrator ═════════════════════════════════════════════════════
const failures = named.length + fails.length;
console.log(`endermanrefcheck: ${failures} failed (${named.length} engine-vs-server mismatches, ${fails.length} other), ${breakPass}/${breaks} anti-vacuity breaks caught (golden ${golden.generatedAt || 'n/a'})`);
for (const n of named) console.log('  FAIL ' + n);
for (const f of fails.slice(0, 80)) console.log('  ✗ ' + f);
if (VERBOSE) { /* the ok() lines already logged their pass count only; nothing else to add */ }
console.log('');
console.log('================ endermanrefcheck (I6/infra-w) ================');
console.log(` assertions passed .... ${pass}`);
console.log(` failures ........... ${failures}`);
console.log(` breaks caught ...... ${breakPass}`);
process.exit(failures ? 1 : 0);
