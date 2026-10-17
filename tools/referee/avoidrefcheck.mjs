#!/usr/bin/env node
// avoidrefcheck.mjs — infra W (25 Sept 2026): MOB AVOID/FLEE vs the real 1.18.2 server (golden: runavoid.mjs,
// avoid.json; scenarios: avoidscen.mjs). Loads the WHOLE engine (every 07*.js mob module, same as
// hoglinrefcheck.mjs) and drives the same pens the server builds: ENT pens get a fleer + a threat mob (both
// ticked together, both logged); the SHADE pen gets one burning mob near a roofed half.
//
// Per ENT scenario, compared against the SERVER exactly as hoglinrefcheck.mjs compares its repellent scenarios
// (same three questions, "distance" now being fleer-to-THREAT's live position, not a fixed block):
//   1. FLEES AT ALL — final fleer-threat distance farther than the start, by more than FLEE_MARGIN, checked BOTH
//      DIRECTIONS (server flees/engine doesn't, and vice versa, are both red — rule 6).
//   2. FLEE SPEED — cruise speed (chaserefcheck.mjs's WIN-window method) applied to the fleer-threat distance.
//   3. FINAL DISTANCE — how far apart at the last tick, tolerance from the server's own REPS spread.
// Per SHADE scenario, compared on whether the mob ends up under the roof (local x >= SHADE_X0) by the last tick
// — EscapeSunlightGoal SEEKS shade, so this is the mirror of "flees": the assertion is "moved toward/into the
// shaded half", both directions (a control the server does NOT send into shade that the engine sends anyway
// would be red too, same rule 6, though nothing in this engine can currently produce that false positive since
// no sunlight-avoidance code exists at all — see the finding below).
// Mismatches are FINDINGS (red, exit 1): a real engine-vs-server difference here belongs to whoever owns
// `07k_goals.js`/`07zt_wtrader.js`, never fixed in this check (docs/archive/REFEREE.md "Why mismatches are findings").
// No golden -> SKIP.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { ENT, SHADE, T, R, SHADE_R, SHADE_X0, SHADE_SPAWN_X, SHADE_FIRE } from './avoidscen.mjs';

const VERBOSE = process.argv.includes('--verbose');
const TRACE = process.argv.includes('--trace') ? process.argv[process.argv.indexOf('--trace') + 1] : null;
const OWN_TOL = 0.15;     // the fleer's own ground speed (a wandering path is noisier than a separation)
const TOL = 0.05;          // flee cruise speed: 5% relative -- same standing as hoglinrefcheck.mjs's own TOL
                            // (a pathfound flee has more reps-to-reps float wobble than a straight-line chase)
const FINAL_TOL = 1.5;     // blocks -- from the server's OWN rep spread (printed under --verbose), same as hoglin
const FLEE_MARGIN = 1.0;   // blocks farther than the start counts as "fled"
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'avoid.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'avoid.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('avoidrefcheck: SKIP (golden not generated -- run node tools/referee/runavoid.mjs)'); process.exit(process.env.MCLITE_REQUIRE_REFEREE ? 1 : 0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));

let seed = 0x00617664;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

// The engine as the game builds it: every 07*.js mob module (rostered mobs run EL.tickMob) + the real player,
// exactly hoglinrefcheck.mjs's own module list (this pack needs the SAME whole-engine load: creeper/skeleton/
// stray/villager/wandering_trader/rabbit/fox/wolf/cat/ocelot/zombie all live in different 07*.js files).
const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js', '14e_gamemode.js', '14i_hand.js', '14_player.js'];
const MOB_MODS = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
const M = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: false, initReg: true });
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
const cells = new Map();
const key = (x, y, z) => x + ',' + y + ',' + z;
// #1495: the server's pens are cut into an ENDLESS flat world (runavoid: bedrock, dirt, dirt, then the stone that replaced the
// grass at FLOOR - 1), and FuzzyTargeting never asks whether a target is reachable -- a candidate past the wall is a valid
// floor there. So the engine's ground is endless too: those four layers everywhere, the pen's cells on top (wanderrefcheck).
let FLAT = 0;
const w = { get: (x, y, z) => cells.get(key(x, y, z)) || (y >= -4 && y <= -1 ? FLAT : 0), set: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); } };
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
if (M.VB) M.VB.rand = rng;          // VillagerBrain captured Math.random at load (07zv:192) -- else the villager scenes are nondeterministic (s142)
const { EntityList: EL, States: S } = M;
const P = M.Player;
P.x = 0.5; P.y = 200; P.z = 0.5;   // no player anywhere near any pen (matches runavoid.mjs -- no player summoned)

const PAD = 0;   // every pen's stone floor is y = PAD - 1; feet at PAD (matches avoidscen.mjs's FLOOR convention)
function buildEntPen() {
  cells.clear();
  const stone = S.stateOf('stone');
  FLAT = stone;
  for (let x = -R - 1; x <= R + 1; x++) for (let z = -R - 1; z <= R + 1; z++) {
    w.set(x, PAD - 1, z, stone);
    if (Math.abs(x) === R + 1 || Math.abs(z) === R + 1) { w.set(x, PAD, z, stone); w.set(x, PAD + 1, z, stone); }
  }
}
function buildShadePen() {
  cells.clear();
  const stone = S.stateOf('stone');
  FLAT = stone;
  for (let x = -SHADE_R - 1; x <= SHADE_R + 1; x++) for (let z = -SHADE_R - 1; z <= SHADE_R + 1; z++) {
    w.set(x, PAD - 1, z, stone);
    if (Math.abs(x) === SHADE_R + 1 || Math.abs(z) === SHADE_R + 1) { w.set(x, PAD, z, stone); w.set(x, PAD + 1, z, stone); }
  }
  for (let x = SHADE_X0; x <= SHADE_R; x++) for (let z = -SHADE_R; z <= SHADE_R; z++) w.set(x, PAD + 2, z, stone);
}

function spawnAt(type, x, y, z, nbt) {
  const e = EL.spawn(type, x, y, z);
  if (!e) return null;
  e.persistent = true; e.vx = e.vy = e.vz = 0;
  if (/IsBaby:1b/.test(nbt || '')) { if (M.Breed && M.Breed.setBaby) M.Breed.setBaby(e, true); }
  return e;
}

function entLog(s) {
  buildEntPen(); EL.list.length = 0;
  const fleer = spawnAt(s.mob, 0.5, PAD, 0.5, s.nbt);
  if (!fleer) return { err: `EL.spawn gives nothing for ${s.mob}` };
  const threat = s.threat ? spawnAt(s.threat, s.dx + 0.5, PAD, 0.5) : null;
  if (s.threat && !threat) return { err: `EL.spawn gives nothing for ${s.threat}` };
  const flog = [], tlog = [];
  for (let t = 0; t < T; t++) {
    flog.push([fleer.x, fleer.y - PAD, fleer.z]);
    if (threat) tlog.push([threat.x, threat.y - PAD, threat.z]);
    P.y = 200;
    if (fleer.removed || fleer.dead) break;
    EL.tick();
  }
  return { flog, tlog: threat ? tlog : null };
}

function shadeLog(s) {
  buildShadePen(); EL.list.length = 0;
  const e = spawnAt(s.mob, SHADE_SPAWN_X + 0.5, PAD, 0.5);
  if (!e) return { err: `EL.spawn gives nothing for ${s.mob}` };
  e.remainingFireTicks = SHADE_FIRE; e.isOnFire = true; e.health = 1000; e.maxHealth = 1000;
  const log = [];
  for (let t = 0; t < T; t++) {
    log.push([e.x, e.y - PAD, e.z]);
    P.y = 200;
    if (e.removed || e.dead) break;
    EL.tick();
  }
  return { log };
}

const distTo = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function pairDist(flog, tlog) { const n = Math.min(flog.length, tlog ? tlog.length : flog.length); const out = []; for (let i = 0; i < n; i++) out.push(tlog ? distTo(flog[i], tlog[i]) : Math.hypot(flog[i][0] - 0.5, flog[i][1], flog[i][2] - 0.5)); return out; }
/** Cruise speed AWAY from the threat: blocks/tick between the first ticks the distance grew by WIN[0] and WIN[1]. */
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

function entDS(g, e) {
  const gds = g.fleerLogs.map((L, i) => pairDist(L, g.threatLogs[i] || null));
  const eds = pairDist(e.flog, e.tlog);
  return { gds, eds };
}

// The server side is REPS runs of RANDOM goals (FleeEntityGoal's NoPenaltyTargeting.findFrom, the threat's own
// wander), so the engine gets the SAME number of runs (fresh rng stream each, panicrefcheck's rule) and every
// comparison below is median-vs-median, majority-vs-majority, tolerance never tighter than the server's OWN spread.
function entReps(s, n, hook) {
  const runs = [];
  for (let r = 0; r < n; r++) {
    seed = (0x00617664 + r * 0x9e3779b1) >>> 0;
    if (hook) hook(true);
    const e = entLog(s);
    if (hook) hook(false);
    if (e.err) return e;
    runs.push(e);
  }
  return { runs, flog: runs[0].flog, tlog: runs[0].tlog };
}
const spreadOf = (a) => (a.length ? Math.max(...a) - Math.min(...a) : 0);
function compareEnt(s, g, e) {
  if (e.err) return [`${s.id}: ${e.err}`];
  if (e.runs && s.threat) return compareEntReps(s, g, e.runs);
  if (!s.threat) {
    const wander = (fl) => { const d = fl.map((p) => Math.hypot(p[0] - 0.5, p[1], p[2] - 0.5)); return d[d.length - 1] - d[0]; };
    const ds0 = [0, e.runs ? median(e.runs.map((r) => wander(r.flog))) : wander(e.flog)];
    return (ds0[ds0.length - 1] - ds0[0]) > 6 ? [`${s.id}: control ${s.mob} (no threat) wandered ${(ds0[ds0.length - 1] - ds0[0]).toFixed(1)} blocks from spawn in the engine -- looks like a phantom flee`] : [];
  }
  const { gds, eds } = entDS(g, e);
  const sFled = gds.filter(fled).length * 2 > gds.length;
  const eFled = fled(eds);
  if (!gds.every((d) => fled(d) === sFled)) console.log(`  note ${s.id}: the server's reps disagree on fleeing -- majority taken`);
  if (sFled !== eFled) return [`${s.id}: ${s.mob} vs ${s.threat} at ${s.dx}b: server ${sFled ? 'flees' : 'does not flee'}, engine ${eFled ? 'flees' : 'does not flee'}`];
  if (!sFled) return [];
  const out = [];
  const gSpeeds = gds.map(fleeCruise).filter((v) => v != null);
  const gFinals = gds.map((d) => d[d.length - 1]);
  const eSpeed = fleeCruise(eds), eFinal = eds[eds.length - 1];
  if (gSpeeds.length) {
    const svSpeed = median(gSpeeds);
    if (eSpeed == null) out.push(`${s.id}: server flee speed ${bps(svSpeed)}, engine never covers the 1..4 block away-window in ${T} ticks`);
    else { const rel = (eSpeed - svSpeed) / svSpeed; if (Math.abs(rel) > TOL) out.push(`${s.id}: flee SEPARATION rate (threat's motion included): server ${bps(svSpeed)}, engine ${bps(eSpeed)} (${rel > 0 ? '+' : ''}${(rel * 100).toFixed(1)}%)`); }
  }
  // the FLEER'S OWN ground speed (infra s142): the separation rate above folds in the threat's own motion (a cat that
  // wanders off inflates it), so the fleer's displacement from its spawn is judged on its own — same window method, 15%.
  const own = (L) => fleeCruise(L.map((p) => Math.hypot(p[0] - L[0][0], p[2] - L[0][2])));
  const gOwn = g.fleerLogs.map(own).filter((v) => v != null), eOwn = own(e.flog);
  if (gOwn.length && eOwn != null) {
    const sv = median(gOwn), rel = (eOwn - sv) / sv;
    if (Math.abs(rel) > OWN_TOL) out.push(`${s.id}: the fleer's OWN ground speed: server ${bps(sv)}, engine ${bps(eOwn)} (${rel > 0 ? '+' : ''}${(rel * 100).toFixed(1)}%)`);
  } else if (gOwn.length) out.push(`${s.id}: the fleer's own ground speed: server ${bps(median(gOwn))}, engine never covers 1..4 blocks from its spawn`);
  const svFinal = median(gFinals);
  const spread = Math.max(...gFinals) - Math.min(...gFinals);
  if (spread > FINAL_TOL) console.log(`  note ${s.id}: the server's own final-distance spread is ${spread.toFixed(2)} blocks over ${gFinals.length} reps`);
  if (Math.abs(eFinal - svFinal) > FINAL_TOL) out.push(`${s.id}: final distance from the threat: server ${svFinal.toFixed(2)}b (median of ${gFinals.length}), engine ${eFinal.toFixed(2)}b`);
  return out;
}

function compareEntReps(s, g, runs) {
  const gds = g.fleerLogs.map((L, i) => pairDist(L, g.threatLogs[i] || null));
  const edss = runs.map((r) => pairDist(r.flog, r.tlog));
  const sFled = gds.filter(fled).length * 2 > gds.length;
  const eFled = edss.filter(fled).length * 2 > edss.length;
  if (!gds.every((d) => fled(d) === sFled)) console.log(`  note ${s.id}: the server's reps disagree on fleeing -- majority taken`);
  if (sFled !== eFled) return [`${s.id}: ${s.mob} vs ${s.threat} at ${s.dx}b: server ${sFled ? 'flees' : 'does not flee'} (${gds.filter(fled).length}/${gds.length}), engine ${eFled ? 'flees' : 'does not flee'} (${edss.filter(fled).length}/${edss.length})`];
  if (!sFled) return [];
  const out = [];
  const gSpeeds = gds.map(fleeCruise).filter((v) => v != null), eSpeeds = edss.map(fleeCruise).filter((v) => v != null);
  if (gSpeeds.length) {
    const sv = median(gSpeeds);
    if (!eSpeeds.length) out.push(`${s.id}: server flee speed ${bps(sv)}, engine never covers the 1..4 block away-window in ${T} ticks`);
    else { const ev = median(eSpeeds), rel = (ev - sv) / sv, tol = Math.max(TOL, spreadOf(gSpeeds) / sv);
      if (Math.abs(rel) > tol) out.push(`${s.id}: flee SEPARATION rate (threat's motion included): server ${bps(sv)}, engine ${bps(ev)} (${rel > 0 ? '+' : ''}${(rel * 100).toFixed(1)}%, tol ${(tol * 100).toFixed(0)}%)`); }
  }
  const own = (L) => fleeCruise(L.map((p) => Math.hypot(p[0] - L[0][0], p[2] - L[0][2])));
  const gOwn = g.fleerLogs.map(own).filter((v) => v != null), eOwn = runs.map((r) => own(r.flog)).filter((v) => v != null);
  if (gOwn.length && eOwn.length) {
    const sv = median(gOwn), ev = median(eOwn), rel = (ev - sv) / sv, tol = Math.max(OWN_TOL, spreadOf(gOwn) / sv);
    if (Math.abs(rel) > tol) out.push(`${s.id}: the fleer's OWN ground speed: server ${bps(sv)}, engine ${bps(ev)} (${rel > 0 ? '+' : ''}${(rel * 100).toFixed(1)}%, tol ${(tol * 100).toFixed(0)}%)`);
  } else if (gOwn.length) out.push(`${s.id}: the fleer's own ground speed: server ${bps(median(gOwn))}, engine never covers 1..4 blocks from its spawn`);
  const gFinals = gds.map((d) => d[d.length - 1]), eFinal = median(edss.map((d) => d[d.length - 1]));
  const svFinal = median(gFinals), ftol = Math.max(FINAL_TOL, spreadOf(gFinals));
  if (Math.abs(eFinal - svFinal) > ftol) out.push(`${s.id}: final distance from the threat: server ${svFinal.toFixed(2)}b (median of ${gFinals.length}, spread ${spreadOf(gFinals).toFixed(1)}), engine ${eFinal.toFixed(2)}b (median of ${edss.length})`);
  return out;
}

/** SHADE: did the mob end up UNDER THE ROOF (local x >= SHADE_X0) by the last tick? */
const inShade = (log) => log.length && log[log.length - 1][0] >= SHADE_X0;
function compareShade(s, g, e) {
  if (e.err) return [`${s.id}: ${e.err}`];
  const sIn = g.logs.filter(inShade).length * 2 > g.logs.length;
  const eIn = inShade(e.log);
  if (sIn !== eIn) return [`${s.id}: ${s.mob} on fire at ${s.time === 6000 ? 'noon' : 'midnight'}: server ${sIn ? 'reaches' : 'does not reach'} the shaded half, engine ${eIn ? 'reaches' : 'does not reach'} it`];
  return [];
}

console.log(`avoidrefcheck — mob avoid/flee vs the real 1.18.2 server (${ENT.length} ent + ${SHADE.length} shade scenarios, ${golden.generatedAt})`);
const reds = [];
let pass = 0;
const ENGE = {}, ENGS = {};
for (const s of ENT) {
  const g = golden.entCases[s.id];
  if (!g) { reds.push(`${s.id}: no golden case`); continue; }
  const e = entReps(s, s.threat ? g.fleerLogs.length : 3);
  ENGE[s.id] = e;
  if (TRACE === s.id) {   // --trace <id>: every 20th tick of server and engine reps, fleer (f) and threat (t)
    const fmt = (L, T2) => { let o = ''; for (let t = 0; t < L.length; t += 20) o += ` t${t}:f(${L[t][0].toFixed(1)},${L[t][2].toFixed(1)})` + (T2 && T2[t] ? `t(${T2[t][0].toFixed(1)},${T2[t][2].toFixed(1)})` : ''); return o; };
    g.fleerLogs.forEach((L, i) => console.log(`  server rep ${i}:${fmt(L, g.threatLogs && g.threatLogs[i])}`));
    (e.runs || [e]).forEach((r, i) => r.flog && console.log(`  engine rep ${i}:${fmt(r.flog, r.tlog)}`));
  }
  const bad = compareEnt(s, g, e);
  if (bad.length) reds.push(...bad); else pass++;
  if (VERBOSE) {
    if (!s.threat) { console.log(`  ${s.id.padEnd(20)} control -- engine ${e.err || 'ok'}`); continue; }
    const { gds, eds } = e.err ? { gds: [], eds: null } : entDS(g, e);
    if (e.runs) console.log(`  ${''.padEnd(20)} engine reps fled ${e.runs.map((r) => fled(pairDist(r.flog, r.tlog))).join('/')} final ${e.runs.map((r) => { const d = pairDist(r.flog, r.tlog); return d[d.length - 1].toFixed(1); }).join('/')}`);
    console.log(`  ${s.id.padEnd(20)} server fled ${gds.map(fled).join('/')} final ${gds.map((d) => d[d.length - 1].toFixed(1)).join('/')} speed ${gds.map((d) => bps(fleeCruise(d))).join('/')}` +
      `  engine ${e.err || `fled ${fled(eds)} final ${eds[eds.length - 1].toFixed(1)} speed ${bps(fleeCruise(eds))}`}`);
  }
}
for (const s of SHADE) {
  const g = golden.shadeCases[s.id];
  if (!g) { reds.push(`${s.id}: no golden case`); continue; }
  const e = shadeLog(s);
  ENGS[s.id] = e;
  const bad = compareShade(s, g, e);
  if (bad.length) reds.push(...bad); else pass++;
  if (VERBOSE) console.log(`  ${s.id.padEnd(20)} server reached-shade ${g.logs.map(inShade).join('/')}  engine ${e.err || inShade(e.log)}`);
}

let breaks = 0, caught = 0;
const brk = (name, fired) => { breaks++; if (fired) caught++; else reds.push(`anti-vacuity: break "${name}" was NOT caught`); };
const traderIn = ENT.find((q) => q.id === 'trader_zombie_4');
const traderOut = ENT.find((q) => q.id === 'trader_zombie_9');
const oceCat6 = ENT.find((q) => q.id === 'creeper_ocelot_6');
{ // golden creeper_ocelot_6: scale the away-movement 0.8x (speed AND final distance both shrink) -- must flip
  // the verdict, exactly hoglinrefcheck.mjs's own dist3 break (same generic golden-side probe).
  const g = JSON.parse(JSON.stringify(golden.entCases.creeper_ocelot_6));
  g.fleerLogs = g.fleerLogs.map((L, i) => {
    const T0 = g.threatLogs[i] || L.map(() => [0, 0, 0]);
    const d0 = distTo(L[0], T0[0]);
    return L.map((p, k) => {
      const c = T0[k] || T0[T0.length - 1];
      const d = distTo(p, c);
      if (d <= d0) return p;
      const t = d0 + (d - d0) * 0.8;
      const dir = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], len = Math.hypot(...dir) || 1;
      return [c[0] + dir[0] / len * t, c[1] + dir[1] / len * t, c[2] + dir[2] / len * t];
    });
  });
  brk('golden creeper_ocelot_6 flee scaled 0.8x', compareEnt(oceCat6, g, ENGE.creeper_ocelot_6).join() !== compareEnt(oceCat6, golden.entCases.creeper_ocelot_6, ENGE.creeper_ocelot_6).join()); }
{ // engine: widen WT.FLEE_TYPES.zombie from 8 to 20 -- trader_zombie_9 (outside vanilla's own 8) now falsely flees
  const before = M.WT.FLEE_TYPES.zombie;
  const e = entReps(traderOut, golden.entCases.trader_zombie_9.fleerLogs.length, (on) => { M.WT.FLEE_TYPES.zombie = on ? 20 : before; });
  brk('engine WT.FLEE_TYPES.zombie widened to 20 (trader_zombie_9 should stay outside)', compareEnt(traderOut, golden.entCases.trader_zombie_9, e).join() !== compareEnt(traderOut, golden.entCases.trader_zombie_9, ENGE.trader_zombie_9).join()); }
{ // engine: zero WT.FLEE_SPEED -- trader_zombie_4 (server flees) now falsely stands still
  const before = M.WT.FLEE_SPEED;
  const e = entReps(traderIn, golden.entCases.trader_zombie_4.fleerLogs.length, (on) => { M.WT.FLEE_SPEED = on ? 0 : before; });
  brk('engine WT.FLEE_SPEED zeroed (trader_zombie_4 should still flee)', compareEnt(traderIn, golden.entCases.trader_zombie_4, e).length > 0); }

for (const r of reds) console.log('  ✗ ' + r);
console.log(`avoidrefcheck: ${pass}/${ENT.length + SHADE.length} scenarios match, ${reds.length} red · anti-vacuity ${caught}/${breaks}`);
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${reds.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(reds.length ? 1 : 0);
