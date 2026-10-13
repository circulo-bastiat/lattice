#!/usr/bin/env node
// chaserefcheck.mjs — infra I6 (25 Sept 2026): MOB CHASE SPEED vs the real 1.18.2 server (golden: runchase.mjs,
// chase.json; scenarios: chasescen.mjs). QUEUE 0.0 (Dan, 25 Sept): "speed in blocks/s vs .decomp" for every mob, and
// his "brute too fast" report. Per scenario the engine builds the same stone corridor in a cell map, puts the REAL
// player (14_player.js, SURVIVAL) where the server's growbot stands, spawns the mob (EL.spawn, AI on) START blocks from
// it and runs `EL.tick` T times, logging the mob's x every tick exactly as the server's tick function does.
// The compared number is the CRUISE SPEED: from the first tick the mob has travelled WIN[0] blocks along the lane to
// the first tick it has travelled WIN[1], (x[i2] - x[i1]) / (i2 - i1) blocks/tick; the server's is the median of REPS
// (target acquisition is random, cruising is not). Red when the engine differs by more than TOL (relative), or never
// covers the window. The time to start moving (i1) is printed, not compared (a random-interval target goal).
// Anti-vacuity (D-30/D-305): a golden zombie log slowed 10%, the engine's zombie given +10% movement speed, and a
// window that is never reached are each caught. Mismatches are FINDINGS (red, exit 1). No golden -> SKIP.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { LIVE, T, WIN, REPS, startX, playerX } from './chasescen.mjs';

const VERBOSE = process.argv.includes('--verbose');
const TOL = 0.01;   // the server's clean reps agree to 4 digits; 1% leaves room for the float path only
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'chase.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'chase.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('chaserefcheck: SKIP (golden not generated -- run node tools/referee/runchase.mjs)'); process.exit(0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');

const SEED0 = 0x0c4a5e01;
let seed = SEED0;
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

const PAD = 0;   // the corridor's stone floor is y = PAD - 1; feet at PAD
function buildLane() {
  cells.clear();
  const stone = S.stateOf('stone');
  for (let x = -4; x <= 26; x++) {
    for (let z = -1; z <= 1; z++) w.set(x, PAD - 1, z, stone);
    for (let y = PAD; y <= PAD + 1; y++) { w.set(x, y, -2, stone); w.set(x, y, 2, stone); }
  }
  for (let z = -1; z <= 1; z++) for (let y = PAD; y <= PAD + 1; y++) { w.set(-4, y, z, stone); w.set(26, y, z, stone); }
}

function engineLog(s, hook, repIndex) {
  seed = (SEED0 + (repIndex || 0) * 0x9e3779b1) >>> 0;   // each scenario (and each rep within it) independent --
  buildLane(); EL.list.length = 0;   // a shared, never-reset seed let one mob's random draws (path-tie-breaks,
  // spawn jitter) shift a LATER, unrelated mob's/rep's outcome
  M.Gamemode.set(P, s.creative ? M.Gamemode.CREATIVE : M.Gamemode.SURVIVAL);
  P.x = playerX(); P.y = PAD; P.z = 0.5; P.vx = P.vy = P.vz = 0; P.dead = false;
  P.health = P.maxHealth || 20;
  const e = EL.spawn(s.mob, startX(), PAD, 0.5);
  if (!e) return { err: 'EL.spawn gives nothing' };
  e.persistent = true; e.vx = e.vy = e.vz = 0;
  // /summon ... {IsBaby:1b}: the engine's own baby switch (EL.spawn's baby path, 07i_entitylist.js:482).
  if (/IsBaby:1b/.test(s.nbt || '')) { if (M.Breed && M.Breed.setBaby) M.Breed.setBaby(e, true); else e.growAge = -24000; }
  if (hook) hook(e);
  const log = [];
  for (let t = 0; t < T; t++) {
    log.push([e.x, e.y - PAD, e.z]);
    P.x = playerX(); P.z = 0.5; P.y = PAD; P.health = P.maxHealth || 20; P.dead = false;   // the growbot stands still, resistance 255
    EL.tick();
    if (e.removed || e.dead) break;
  }
  return { log };
}

/** Cruise speed of one log: blocks/tick between the first ticks at WIN[0] and WIN[1] blocks travelled. */
function cruise(log) {
  if (!log || !log.length) return null;
  const x0 = log[0][0];
  let i1 = -1, i2 = -1;
  for (let i = 0; i < log.length; i++) {
    const d = Math.abs(log[i][0] - x0);
    if (i1 < 0 && d >= WIN[0]) i1 = i;
    if (i2 < 0 && d >= WIN[1]) { i2 = i; break; }
  }
  if (i1 < 0 || i2 <= i1) return { speed: null, i1 };
  return { speed: Math.abs(log[i2][0] - log[i1][0]) / (i2 - i1), i1 };
}
const median = (a) => { const b = a.slice().sort((p, q) => p - q); return b[Math.floor(b.length / 2)]; };
const bps = (v) => (v == null ? 'never' : (v * 20).toFixed(3) + ' b/s');

/** Closest the mob came to the player's x over the log (blocks). */
const closest = (log) => Math.min(...log.map((p) => Math.abs(playerX() - p[0])));
const STAY = 30;
const pursues = (log) => log.filter((p) => Math.abs(playerX() - p[0]) < 2.5).length >= STAY;
function compare(s, g, e) {
  if (e.err) return [`${s.id}: ${e.err}`];
  if (s.creative) {
    // "closes in" = PURSUES: >= STAY ticks within 2.5 blocks. A creative-ignoring wanderer can brush past ~2 blocks by
    // chance (the server's vindicator did once in 3 reps, s137); a chaser parks at its attack reach for 100+ ticks.
    // The engine side is exactly as random-walk-prone as the server's own reps (a fixed-seed corridor wander can
    // drift close by chance, same as the server's), so it is majority-voted over REPS logs too -- one log alone
    // (silverfish_vs_creative, first found with per-scenario seeding) is not enough to tell chase from coincidence.
    const sc = g.logs.map(pursues), ecLogs = e.logs || [e.log], ecc = ecLogs.map(pursues);
    const sv = sc.filter(Boolean).length * 2 > sc.length;                     // majority of the server's reps
    const ec = ecc.filter(Boolean).length * 2 > ecc.length;                   // majority of the engine's reps
    if (!sc.every((v) => v === sc[0])) console.log(`  note ${s.id}: the server's reps disagree (${sc.join('/')}) -- majority taken`);
    if (!ecc.every((v) => v === ecc[0])) console.log(`  note ${s.id}: the engine's reps disagree (${ecc.join('/')}) -- majority taken`);
    return sv === ec ? [] : [`${s.id}: ${s.mob} vs a CREATIVE player: server ${sv ? 'closes in' : 'never closes in'}, engine ${ec ? 'closes in' : 'never closes in'} (closest ${closest(ecLogs[0]).toFixed(1)} blocks)`];
  }
  const gs = g.logs.map(cruise).filter((c) => c && c.speed != null);
  if (!gs.length) return [`${s.id}: the server never covered the ${WIN.join('..')} block window -- harness`];
  const sv = median(gs.map((c) => c.speed));
  const ec = cruise(e.log);
  if (!ec || ec.speed == null) return [`${s.id}: ${s.mob}${s.nbt ? ' ' + s.nbt : ''} chasing a survival player: server cruises ${bps(sv)}, the engine never covers ${WIN[0]}..${WIN[1]} blocks in ${T} ticks (starts moving at tick ${ec ? ec.i1 : '?'})`];
  const rel = (ec.speed - sv) / sv;
  return Math.abs(rel) <= TOL ? [] : [`${s.id}: ${s.mob}${s.nbt ? ' ' + s.nbt : ''} chasing a survival player: server ${bps(sv)}, engine ${bps(ec.speed)} (${rel > 0 ? '+' : ''}${(rel * 100).toFixed(1)}%)`];
}

console.log(`chaserefcheck — mob chase speed vs the real 1.18.2 server (${LIVE.length} mobs, ${golden.generatedAt})`);
const reds = [];
let pass = 0;
const ENG = {};
for (const s of LIVE) {
  const g = golden.cases[s.id];
  if (!g) { reds.push(`${s.id}: no golden case`); continue; }
  const e = engineLog(s);
  if (s.creative && !e.err) { e.logs = []; for (let r = 0; r < REPS; r++) e.logs.push(engineLog(s, null, r).log); }
  ENG[s.id] = e;
  const bad = compare(s, g, e);
  if (bad.length) reds.push(...bad); else pass++;
  if (VERBOSE) {
    const gs = g.logs.map(cruise);
    if (s.creative) { console.log(`  ${s.id.padEnd(16)} server closest ${g.logs.map((L) => closest(L).toFixed(1)).join(' / ')}  engine ${e.err || closest(e.log).toFixed(1)}`); continue; }
    const ec = e.err ? null : cruise(e.log);
    console.log(`  ${s.id.padEnd(16)} server ${gs.map((c) => bps(c && c.speed)).join(' / ')} (moves at ${gs.map((c) => c && c.i1).join('/')})  engine ${e.err || bps(ec && ec.speed)} (moves at ${ec && ec.i1})`);
  }
}
let breaks = 0, caught = 0;
const brk = (name, fired) => { breaks++; if (fired) caught++; else reds.push(`anti-vacuity: break "${name}" was NOT caught`); };
{ const s = LIVE.find((q) => q.id === 'zombie'); const g = JSON.parse(JSON.stringify(golden.cases.zombie));
  g.logs = g.logs.map((L) => L.map((p, i) => [L[0][0] + (p[0] - L[0][0]) * 0.9, p[1], p[2]]));
  brk('golden zombie 10% slower', compare(s, g, ENG.zombie).join() !== compare(s, golden.cases.zombie, ENG.zombie).join()); }
{ const s = LIVE.find((q) => q.id === 'zombie');
  const e = engineLog(s, (m) => { m.speedAttr = M.Ai.movementSpeedOf(m) * 1.1; });
  const moved = cruise(e.log), base = cruise(ENG.zombie.log);
  brk('engine zombie +10% movement speed', !!(moved && base && moved.speed != null && base.speed != null && Math.abs(moved.speed - base.speed) / base.speed > TOL)); }
{ const s = LIVE.find((q) => q.id === 'zombie_vs_creative'); const g = { logs: golden.cases.zombie.logs };
  brk('golden creative zombie that closes in', compare(s, g, ENG[s.id]).length === 1 && compare(s, golden.cases[s.id], ENG[s.id]).length === 0 || compare(s, g, ENG[s.id]).join() !== compare(s, golden.cases[s.id], ENG[s.id]).join()); }
{ const s = LIVE.find((q) => q.id === 'zombie'); const e = { log: ENG.zombie.log.slice(0, 1) };
  brk('engine log that never covers the window', compare(s, golden.cases.zombie, e).length === 1); }
for (const r of reds) console.log('  ✗ ' + r);
console.log(`chaserefcheck: ${pass}/${LIVE.length} mobs match, ${reds.length} red · anti-vacuity ${caught}/${breaks}`);
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${reds.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(reds.length ? 1 : 0);
