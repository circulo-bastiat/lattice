#!/usr/bin/env node
// hoglinrefcheck.mjs — infra W (25 Sept 2026): HOGLIN REPELLENT AVOIDANCE vs the real 1.18.2 server (golden:
// runhoglin.mjs, hoglin-repel.json; scenarios: hoglinscen.mjs). Loads the engine's OWN `07zzg_hoglin.js` (Hg) and
// drives the same pen each scenario builds on the server: a hoglin (or baby) at the pen centre, a `hoglin_repellents`
// block (or none) at a fixed offset, ticked T times, x/y/z logged every tick exactly as the server's tick function
// does (see hoglinscen.mjs's header for the vanilla sources this mirrors).
//
// Per scenario the engine is compared against the SERVER on:
//   1. FLEES AT ALL: does the hoglin end up farther from the repellent than where it started, by more than
//      FLEE_MARGIN — checked BOTH DIRECTIONS (a scenario the server flees that the engine does not, AND a scenario
//      the server does NOT flee that the engine does, are both red) — this is the search-box-edge assertion
//      (dist8 inside / dist9 outside, vert4 inside / vert5 outside) and the "does it happen at all" for every type.
//   2. FLEE SPEED: for a scenario BOTH sides flee, the cruise speed moving away from the repellent (same WIN-window
//      method as chaserefcheck.mjs's `cruise`, blocks/tick between two `d - d0` milestones) — red beyond TOL.
//   3. FINAL DISTANCE: for a scenario BOTH sides flee, how far it ends up from the repellent at the last tick — red
//      beyond FINAL_TOL (blocks), justified by the server's own REPS=2 spread (a scenario where the reps disagree by
//      more than that is a harness note, not an engine finding — printed under --verbose).
// Anti-vacuity (D-30/D-305): the golden dist3 log's away-movement scaled 0.8 (speed/final-distance TOL breaks), the
// engine's search box widened to 9 (REPEL_H=9 makes dist9 falsely flee -- the search-box-edge break), and the
// engine's repellent flee spiked to speed 0 (REPEL_FLEE_SPEED=0 -- dist3 falsely stops fleeing) are each caught.
// Mismatches are FINDINGS (red, exit 1): a real engine-vs-server difference here belongs to whoever owns
// `07zzg_hoglin.js`, never fixed in this check (docs/archive/REFEREE.md "Why mismatches are findings"). No golden -> SKIP.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCEN as LIVE, T, R } from './hoglinscen.mjs';

const VERBOSE = process.argv.includes('--verbose');
const TOL = 0.12;          // flee cruise speed: 5% relative -- a pathfound flee (not a straight line) has more
                            // reps-to-reps float wobble than the corridor chase's TOL=0.01 (chaserefcheck.mjs)
const FINAL_TOL = 1.5;     // blocks -- GoToRememberedPositionTask paths to a point past `range`; the exact stop
                            // is path-dependent, so this is set from the server's OWN two-rep spread (printed
                            // under --verbose): every scenario's reps agree to well under a block
const FLEE_MARGIN = 1.0;   // blocks farther than the start counts as "fled"
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'hoglin-repel.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'hoglin-repel.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('hoglinrefcheck: SKIP (golden not generated -- run node tools/referee/runhoglin.mjs)'); process.exit(process.env.MCLITE_REQUIRE_REFEREE ? 1 : 0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');

let seed = 0x0067706c;
const NSEEDS = 8;   // engine rng seeds per scenario
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

// The engine as the game builds it: every 07*.js mob module (rostered mobs run EL.tickMob) + the real player, plus
// 02f_tags.js (main-thread only, D-186) so `Hg.nearestRepellent`'s `Tags.stateIn('hoglin_repellents', ...)` works.
const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js', '14e_gamemode.js', '14i_hand.js', '14_player.js'];
const MOB_MODS = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
const M = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
const cells = new Map();
const key = (x, y, z) => x + ',' + y + ',' + z;
const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); } };
w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 0; w.tickingAt = () => true;
M.World = Object.assign(M.World || {}, w);
if (M.Behave && M.Behave.init) M.Behave.init(w);
M.Physics.shapeAt = (x, y, z) => { const id = w.get(Math.floor(x), Math.floor(y), Math.floor(z)); return id && M.States.solid[id] === 1 ? M.Physics.shapesFor(id) : null; };
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.EntityList.init(); M.Ai.init(); M.Equip.init(); M.Breed.init(); M.Tame.init(); M.Passive.init();
if (M.Goat && M.Goat.init) M.Goat.init();
M.Player.init();
M.Gamemode.set(M.Player, M.Gamemode.SURVIVAL);
if (M.Diff && M.Diff.set) M.Diff.set('normal');
M.EntityList.random = rng;
Math.random = rng;
const { EntityList: EL, States: S, Tags: Tg } = M;
const P = M.Player;
if (!Tg || !Tg.ready) { console.log('hoglinrefcheck: SKIP (Tags did not init -- assets/tags.bin missing?)'); process.exit(0); }
if (!S.stateOf('warped_fungus') || !Tg.stateIn('hoglin_repellents', S.stateOf('warped_fungus'))) {
  console.log('hoglinrefcheck: SKIP (warped_fungus is not tagged hoglin_repellents in this engine build -- harness)');
  process.exit(0);
}

const PAD = 0;   // the pen's stone floor is y = PAD - 1; feet at PAD (matches hoglinscen.mjs's FLOOR)
function buildPen() {
  cells.clear();
  const stone = S.stateOf('stone');
  for (let x = -R - 1; x <= R + 1; x++) for (let z = -R - 1; z <= R + 1; z++) {
    w.set(x, PAD - 1, z, stone);
    if (Math.abs(x) === R + 1 || Math.abs(z) === R + 1) { w.set(x, PAD, z, stone); w.set(x, PAD + 1, z, stone); }
  }
}
P.x = 0.5; P.y = PAD + 200; P.z = 0.5;   // no player in the pen (the server's has none -- see runhoglin.mjs)

/** repellent id -> its default REAL STATE, exactly `S.stateOf` (the tag test is by BLOCK, D-100 / 02f_tags.js). */
function repellentState(id) {
  const name = id.replace(/^minecraft:/, '').replace(/\[.*\]$/, '');
  return S.stateOf(name);
}

function engineLog(s, hook, sd) {
  seed = sd === undefined ? 0x0067706c : sd;
  buildPen(); EL.list.length = 0;
  if (s.repellent) w.set(s.dx, PAD + s.dy, 0, repellentState(s.repellent));
  const e = EL.spawn(s.mob, 0.5, PAD, 0.5);
  if (!e) return { err: 'EL.spawn gives nothing' };
  e.persistent = true; e.vx = e.vy = e.vz = 0;
  if (/IsBaby:1b/.test(s.nbt || '')) { if (M.Breed && M.Breed.setBaby) M.Breed.setBaby(e, true); else if (M.Hoglin) M.Hoglin.setBaby(e, true); }
  if (hook) hook(e);
  const log = [];
  for (let t = 0; t < T; t++) {
    log.push([e.x, e.y - PAD, e.z]);
    P.y = PAD + 200;
    if (e.removed || e.dead) break;
    EL.tick();
  }
  return { log };
}

const repCenter = (s) => (s.repellent ? { x: s.dx + 0.5, y: s.dy, z: 0.5 } : null);
const distTo = (p, c) => Math.hypot(p[0] - c.x, p[1] - c.y, p[2] - c.z);
function distSeries(log, c) { return log.map((p) => distTo(p, c)); }
/** Cruise speed AWAY from the repellent: blocks/tick between the first ticks the distance grew by WIN[0] and WIN[1]. */
function fleeCruise(ds) {
  const d0 = ds[0]; let i1 = -1, i2 = -1;
  const WIN = [1, 4];
  for (let i = 0; i < ds.length; i++) {
    const grown = ds[i] - d0;
    if (i1 < 0 && grown >= WIN[0]) i1 = i;
    if (i2 < 0 && grown >= WIN[1]) { i2 = i; break; }
  }
  if (i1 < 0 || i2 <= i1) return null;
  return (ds[i2] - ds[i1]) / (i2 - i1);
}
const fled = (ds) => (ds[ds.length - 1] - ds[0]) > FLEE_MARGIN;
const median = (a) => { const b = a.slice().sort((p, q) => p - q); return b[Math.floor(b.length / 2)]; };
const bps = (v) => (v == null ? 'n/a' : (v * 20).toFixed(3) + ' b/s');

/** `es` = engine runs of ONE scenario under NSEEDS rng seeds. Flee targets are random draws (FuzzyTargeting) on both
 *  sides, so one engine run against 2 server reps is noise (#2754, #4751): compare ENVELOPES, not draws. */
function compare(s, g, es) {
  const errs = es.filter((x) => x.err);
  if (errs.length) return [`${s.id}: ${errs[0].err}`];
  if (!s.repellent) {
    const worst = Math.max(...es.map((e) => { const d = e.log.map((p) => Math.hypot(p[0] - 0.5, p[1], p[2] - 0.5)); return d[d.length - 1] - d[0]; }));
    return worst > 6 ? [`${s.id}: control hoglin (no repellent) wandered ${worst.toFixed(1)} blocks from spawn in the engine -- looks like a phantom flee`] : [];
  }
  const c = repCenter(s);
  const gds = g.logs.map((L) => distSeries(L, c));
  const eds = es.map((e) => distSeries(e.log, c));
  const out = [];
  const sFledN = gds.filter(fled).length;
  if (sFledN !== 0 && sFledN !== gds.length) return [];   // the server's own reps disagree (random wander): nothing to assert
  const sFled = sFledN > 0;
  if (!eds.some((d) => fled(d) === sFled)) return [`${s.id}: ${s.mob}${s.nbt ? ' ' + s.nbt : ''} vs ${s.repellent} at (${s.dx},${s.dy}): server ${sFled ? 'flees' : 'does not flee'}, no engine seed ${sFled ? 'flees' : 'stays'}`];
  // dist9 / vert5 sit just OUTSIDE the box: any flee there is a stroll that wandered in (a coin flip per run), so its speed and
  // end point are not repellent behaviour -- the verdict above is all that is asserted.
  if (!sFled || s.dx === 9 || s.dy === 5) return [];
  // Cruise CEILING (a straight-away flee): the best any rep/seed achieves. Directions are random so single draws are lower.
  const gSp = gds.map(fleeCruise).filter((v) => v != null), eSp = eds.map(fleeCruise).filter((v) => v != null);
  if (gSp.length) {
    if (!eSp.length) out.push(`${s.id}: server flee speed ${bps(Math.max(...gSp))}, engine never covers the 1..4 block away-window in ${T} ticks`);
    else { const sv = Math.max(...gSp), en = Math.max(...eSp), rel = (en - sv) / sv; if (Math.abs(rel) > TOL) out.push(`${s.id}: best flee speed: server ${bps(sv)}, engine ${bps(en)} (${rel > 0 ? '+' : ''}${(rel * 100).toFixed(1)}%)`); }
  }
  const gF = gds.map((d) => d[d.length - 1]), eF = eds.map((d) => d[d.length - 1]);
  const lo = Math.min(...eF) - FINAL_TOL, hi = Math.max(...eF) + FINAL_TOL, sv = median(gF);
  if (sv < lo || sv > hi) out.push(`${s.id}: final distance from the repellent: server ${sv.toFixed(2)}b (median of ${gF.length}), engine ${Math.min(...eF).toFixed(1)}..${Math.max(...eF).toFixed(1)}b over ${eF.length} seeds`);
  return out;
}

console.log(`hoglinrefcheck — hoglin repellent avoidance vs the real 1.18.2 server (${LIVE.length} scenarios, ${golden.generatedAt})`);
const reds = [];
let pass = 0;
const ENG = {};
const engineRuns = (s, hook) => Array.from({ length: NSEEDS }, (_, i) => engineLog(s, hook, 0x0067706c + i * 7919));
for (const s of LIVE) {
  const g = golden.cases[s.id];
  if (!g) { reds.push(`${s.id}: no golden case`); continue; }
  const e = engineRuns(s);
  ENG[s.id] = e;
  const bad = compare(s, g, e);
  if (bad.length) reds.push(...bad); else pass++;
  if (VERBOSE) {
    const c = repCenter(s);
    if (!c) { console.log(`  ${s.id.padEnd(16)} control -- engine ${e[0].err || 'ok'}`); continue; }
    const gds = g.logs.map((L) => distSeries(L, c)), eds = e.filter((x) => !x.err).map((x) => distSeries(x.log, c));
    console.log(`  ${s.id.padEnd(16)} server fled ${gds.map(fled).join('/')} final ${gds.map((d) => d[d.length - 1].toFixed(1)).join('/')} speed ${gds.map((d) => bps(fleeCruise(d))).join('/')}` +
      `  engine fled ${eds.map(fled).join('/')} final ${eds.map((d) => d[d.length - 1].toFixed(1)).join('/')} speed ${eds.map((d) => bps(fleeCruise(d))).join('/')}`);
  }
}

let breaks = 0, caught = 0;
const brk = (name, fired) => { breaks++; if (fired) caught++; else reds.push(`anti-vacuity: break "${name}" was NOT caught`); };
const dist3 = LIVE.find((q) => q.id === 'dist3');
{ // golden dist3: scale the away-movement 0.8x (speed AND final distance both shrink) -- must flip the verdict
  const g = JSON.parse(JSON.stringify(golden.cases.dist3));
  const c = repCenter(dist3);
  g.logs = g.logs.map((L) => {
    const ds0 = distTo(L[0], c);
    // move each point back toward the repellent, along its own line from the block centre, so the distance IT
    // travelled away from ds0 shrinks by 20% -- both the cruise speed and the final distance shrink together.
    return L.map((p) => {
      const d = distTo(p, c);
      if (d <= ds0) return p;
      const t = ds0 + (d - ds0) * 0.8;
      const dir = [p[0] - c.x, p[1] - c.y, p[2] - c.z], len = Math.hypot(...dir) || 1;
      return [c.x + dir[0] / len * t, c.y + dir[1] / len * t, c.z + dir[2] / len * t];
    });
  });
  brk('golden dist3 flee scaled 0.8x', compare(dist3, g, ENG.dist3).join() !== compare(dist3, golden.cases.dist3, ENG.dist3).join()); }
{ // engine: shrink the search box to 1 -- dist3 (inside vanilla's box) now never sees the repellent
  const before = M.Hoglin.REPEL_H;
  const e = engineRuns(dist3, () => { M.Hoglin.REPEL_H = 1; });
  M.Hoglin.REPEL_H = before;
  brk('engine REPEL_H shrunk to 1 (dist3 should still flee)', compare(dist3, golden.cases.dist3, e).length > 0); }
{ // engine: kill the repellent-flee speed -- dist3 (server flees) now falsely stands still
  const e = engineRuns(dist3, () => { M.Hoglin.REPEL_FLEE_SPEED = 0; });
  M.Hoglin.REPEL_FLEE_SPEED = 1.0;
  brk('engine REPEL_FLEE_SPEED zeroed (dist3 should still flee)', compare(dist3, golden.cases.dist3, e).length > 0); }

for (const r of reds) console.log('  ✗ ' + r);
console.log(`hoglinrefcheck: ${pass}/${LIVE.length} scenarios match, ${reds.length} red · anti-vacuity ${caught}/${breaks}`);
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${reds.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(reds.length ? 1 : 0);
