#!/usr/bin/env node
// panicrefcheck.mjs — infra I6 (25 Sept 2026): BURNING-MOB PANIC vs the real 1.18.2 server (golden: runpanic.mjs,
// panic.json; scenarios: panicscen.mjs). QUEUE 0.0 (Dan, 25 Sept: "flee ... speed in blocks/s"). vanilla's
// EscapeDangerGoal panics a mob that is ON FIRE with no attacker (.decomp EscapeDangerGoal.java:47-48). Per scenario the
// engine builds the same stone pen in a cell map, spawns the mob (EL.spawn, AI on) at its centre with FIRE ticks of fire
// (`remainingFireTicks`, the field Cb's fire tick counts down -- what /summon {Fire:n} sets), runs `EL.tick` T times and
// logs x/y/z every tick as the server's tick function does. Compared, per mob (server = over REPS reps):
//   1. PANICS AT ALL: the fraction of ticks the mob moves (> 0.02 b/t horizontally) -- red when the engine's is below
//      half the server's mean (the panic never starting is the failure this catches);
//   2. PANIC SPEED: the 90th percentile of the per-tick horizontal speed over moving ticks -- red beyond TOL (relative);
//   3. DEATH TICK: the tick the mob stops being alive (fire kills the small ones; `@e` skips dead entities) -- red
//      when the engine's differs from the server's (constant over reps) by more than 1 tick.
// Anti-vacuity (D-30/D-305): the golden panic speed scaled 0.8, the engine mob kept from burning, and the golden removal
// tick moved by 20 are each caught. Mismatches are FINDINGS (red, exit 1). No golden -> SKIP.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCEN as LIVE, T, FIRE, R } from './panicscen.mjs';

const VERBOSE = process.argv.includes('--verbose');
const TOL = 0.03;
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'panic.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'panic.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('panicrefcheck: SKIP (golden not generated -- run node tools/referee/runpanic.mjs)'); process.exit(0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');

let seed = 0x0a41c001;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

// The engine as the game builds it: every 07*.js mob module (rostered mobs run EL.tickMob) + the real player.
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
const { EntityList: EL, States: S } = M;
const P = M.Player;

const PAD = 0;
function buildPen() {
  cells.clear();
  const stone = S.stateOf('stone');
  for (let x = -R - 1; x <= R + 1; x++) for (let z = -R - 1; z <= R + 1; z++) {
    w.set(x, PAD - 1, z, stone);
    if (Math.abs(x) === R + 1 || Math.abs(z) === R + 1) { w.set(x, PAD, z, stone); w.set(x, PAD + 1, z, stone); }
  }
}
P.x = 0.5; P.y = PAD + 200; P.z = 0.5;   // no player in the pen (the server's has none)
function engineLog(s, hook) {
  buildPen(); EL.list.length = 0;
  const e = EL.spawn(s.mob, 0.5, PAD, 0.5);
  if (!e) return { err: 'EL.spawn gives nothing' };
  e.persistent = true; e.vx = e.vy = e.vz = 0;
  e.remainingFireTicks = FIRE; e.isOnFire = true;
  // runpanic.mjs summons WITH NBT (`{Fire:..}`), and SummonCommand only calls `MobEntity.initialize` for an EMPTY
  // nbt -- so the server's horse keeps its REGISTERED movement_speed (0.225), never `HorseEntity.initAttributes`'
  // roll. EL.spawn is the initialize path (Mount.rollAttributes) -- undo the roll to summon what the server summoned.
  if (s.mob === 'horse') delete e.movementSpeedAttr;
  if (hook) hook(e);
  const log = [];
  for (let t = 0; t < T; t++) {
    // the server's `@e[tag=..]` matches LIVING entities only (EntitySelector's isAlive filter), so its log ends at
    // DEATH, not at removal 20 ticks later -- the engine's must too.
    if (e.removed || e.dead || !(e.health > 0) || EL.list.indexOf(e) < 0) break;
    log.push([e.x, e.y - PAD, e.z]);
    P.y = PAD + 200;
    EL.tick();
  }
  return { log };
}
const MOVE = 0.02;
function stats(log) {
  const sp = [];
  for (let i = 1; i < log.length; i++) sp.push(Math.hypot(log[i][0] - log[i - 1][0], log[i][2] - log[i - 1][2]));
  const mv = sp.filter((v) => v > MOVE).sort((a, b) => a - b);
  return { moving: mv.length / Math.max(1, T - 1), p90: mv.length ? mv[Math.floor(mv.length * 0.9)] : 0,
    onset: sp.findIndex((v) => v > MOVE), removed: log.length < T ? log.length : -1 };
}
const mean = (a) => a.reduce((p, q) => p + q, 0) / a.length;
const median = (a) => { const b = a.slice().sort((p, q) => p - q); return b[Math.floor(b.length / 2)]; };
const bps = (v) => (v * 20).toFixed(2) + ' b/s';
// The server side is REPS independent runs of a RANDOM goal (EscapeDangerGoal's NoPenaltyTargeting.find), so one
// engine run against the server's median compares a single random draw with a distribution: the engine gets the
// SAME number of reps (fresh rng stream each) and is judged on its own median p90 / mean moving fraction.
function engineReps(s, n, hook) {
  const out = [];
  for (let r = 0; r < n; r++) { seed = (0x0a41c001 + r * 0x9e3779b1) >>> 0; out.push(engineLog(s, hook)); }
  return out;
}
function repStats(runs) {
  const ss = runs.map((r) => stats(r.log));
  const mvs = ss.filter((q) => q.p90 > 0).map((q) => q.p90);
  return { moving: mean(ss.map((q) => q.moving)), p90: mvs.length ? median(mvs) : 0, onset: ss[0].onset, removed: ss[0].removed };
}
function compare(s, g, e) {
  if (e.err) return [`${s.id}: ${e.err}`];
  const gs = g.logs.map(stats), es = e.runs ? repStats(e.runs) : stats(e.log);
  const out = [];
  const gm = mean(gs.map((q) => q.moving));
  if (es.moving < gm / 2) out.push(`${s.id}: a burning ${s.mob} moves ${(gm * 100).toFixed(0)}% of ${T} ticks on the server (panic, EscapeDangerGoal.isOnFire), ${(es.moving * 100).toFixed(0)}% in the engine`);
  else {
    const gps = gs.map((q) => q.p90).filter((v) => v > 0);
    const gp = median(gps);
    const rel = (es.p90 - gp) / gp;
    // the server's OWN rep-to-rep spread widens TOL (avoidrefcheck's FINAL_TOL rule): a hopping rabbit's p90 is
    // bimodal on the server itself (8.90..10.62 b/s over 4 reps), no engine can sit inside 3% of that median.
    const tol = Math.max(TOL, (Math.max(...gps) - Math.min(...gps)) / gp);
    if (Math.abs(rel) > tol) out.push(`${s.id}: burning ${s.mob} panic speed: server ${bps(gp)}, engine ${bps(es.p90)} (${rel > 0 ? '+' : ''}${(rel * 100).toFixed(1)}%)`);
  }
  const gr = gs.map((q) => q.removed);
  if (gr.every((v) => v === gr[0])) {
    if (gr[0] !== es.removed && !(gr[0] > 0 && es.removed > 0 && Math.abs(gr[0] - es.removed) <= 1))
      out.push(`${s.id}: burning ${s.mob} (fire ${FIRE} ticks) leaves the world at tick ${gr[0] < 0 ? 'never (lives)' : gr[0]} on the server, ${es.removed < 0 ? 'never (lives)' : es.removed} in the engine`);
  } else out.push(`${s.id}: the server's removal tick varies over reps (${gr.join('/')}) -- harness`);
  return out;
}

console.log(`panicrefcheck — burning-mob panic vs the real 1.18.2 server (${LIVE.length} mobs, ${golden.generatedAt})`);
const reds = [];
let pass = 0;
const ENG = {};
for (const s of LIVE) {
  const g = golden.cases[s.id];
  if (!g) { reds.push(`${s.id}: no golden case`); continue; }
  const runs = engineReps(s, g.logs.length);
  const bad0 = runs.find((r) => r.err);
  const e = bad0 || { runs, log: runs[0].log };
  ENG[s.id] = e;
  const bad = compare(s, g, e);
  if (bad.length) reds.push(...bad); else pass++;
  if (VERBOSE) {
    const f = (q) => `mv ${(q.moving * 100).toFixed(0)}% p90 ${bps(q.p90)} on ${q.onset} rm ${q.removed}`;
    console.log(`  ${s.id.padEnd(10)} server ${g.logs.map((L) => f(stats(L))).join(' | ')}\n             engine ${e.err || e.runs.map((r) => f(stats(r.log))).join(' | ')}`);
  }
}
let breaks = 0, caught = 0;
const brk = (name, fired) => { breaks++; if (fired) caught++; else reds.push(`anti-vacuity: break "${name}" was NOT caught`); };
const cow = LIVE.find((q) => q.id === 'cow');
{ const g = JSON.parse(JSON.stringify(golden.cases.cow)); g.logs = g.logs.map((L) => L.map((p) => [L[0][0] + (p[0] - L[0][0]) * 0.8, p[1], L[0][2] + (p[2] - L[0][2]) * 0.8]));
  brk('golden cow panic speed x0.8', compare(cow, g, ENG.cow).join() !== compare(cow, golden.cases.cow, ENG.cow).join()); }
{ const e = { runs: engineReps(cow, golden.cases.cow.logs.length, (m) => { m.remainingFireTicks = 0; m.isOnFire = false; }) };
  const st = repStats(e.runs), base = repStats(ENG.cow.runs);
  brk('engine cow not burning', st.moving < base.moving || base.moving === 0 && compare(cow, golden.cases.cow, e).length > 0); }
{ const s = LIVE.find((q) => q.id === 'chicken'); const g = JSON.parse(JSON.stringify(golden.cases.chicken));
  g.logs = g.logs.map((L) => L.concat(Array.from({ length: Math.min(20, T - L.length) }, () => L[L.length - 1])));
  brk('golden chicken removal tick +20', compare(s, g, ENG.chicken).join() !== compare(s, golden.cases.chicken, ENG.chicken).join()); }
for (const r of reds) console.log('  ✗ ' + r);
console.log(`panicrefcheck: ${pass}/${LIVE.length} mobs match, ${reds.length} red · anti-vacuity ${caught}/${breaks}`);
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${reds.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(reds.length ? 1 : 0);
