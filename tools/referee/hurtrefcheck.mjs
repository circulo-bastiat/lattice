#!/usr/bin/env node
// hurtrefcheck.mjs — infra I6 (s137, 25 Sept 2026): HURT PANIC vs the real 1.18.2 server (golden: runhurt.mjs, hurt.json;
// scenarios: hurtscen.mjs). QUEUE 0.0 (Dan: "run its AI for real ... flee, speed in blocks/s"). A survival player at the
// pen centre punches the animal (the engine: `Cb.attack(P, e)`, src/14j_combat.js, bare hand, facing +x). Compared over
// ticks SKIP..WINDOW after the hit (knockback excluded, vanilla's 100-tick attacker memory): the share of ticks the
// animal moves (engine below half / above double the server's mean = red) and, when both move, the 90th-percentile
// per-tick speed within TOL. The distance from the hurter at tick 60 is printed (vanilla flees to RANDOM spots,
// NoPenaltyTargeting.find(mob,5,4); the engine's Ai.PanicGoal runs straight away) but not compared -- random.
// Every number compared is the SERVER's (D-329). Anti-vacuity (D-30/D-305): golden speed x0.8, golden animal frozen,
// and the engine animal never hit are each caught. Mismatches are FINDINGS (red, exit 1). No golden -> SKIP.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCEN as LIVE, T, R, OFFSET, SKIP, WINDOW } from './hurtscen.mjs';

const VERBOSE = process.argv.includes('--verbose');
const TOL = 0.05; // rabbit moves in discrete hops, so its p75 speed is hop-phase noisy: 10%
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'hurt.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'hurt.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('hurtrefcheck: SKIP (golden not generated -- run node tools/referee/runhurt.mjs)'); process.exit(0); }
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

const { Combat: Cb, Survival: Sv } = M;
const YAW_PLAYER_FACES_EAST = -Math.PI / 2;   // kbrefcheck.mjs's own empirically-confirmed value (its header explains)
const SETTLE = 8;                               // ticks the server's mob has to land before the punch (runhurt ~400 ms)

const PAD = 0;
function buildPen() {
  cells.clear();
  const stone = S.stateOf('stone');
  for (let x = -R - 1; x <= R + 1; x++) for (let z = -R - 1; z <= R + 1; z++) {
    w.set(x, PAD - 1, z, stone);
    if (Math.abs(x) === R + 1 || Math.abs(z) === R + 1) { w.set(x, PAD, z, stone); w.set(x, PAD + 1, z, stone); }
  }
}
function placeP() { P.x = 0.5; P.y = PAD; P.z = 0.5; P.vx = P.vy = P.vz = 0; P.onGround = true; P.yaw = YAW_PLAYER_FACES_EAST; P.dead = false; P.health = P.maxHealth || 20; }
function engineLog(s, opts = {}) {
  buildPen(); EL.list.length = 0;
  if (Sv && Sv.init) Sv.init(P);
  M.Gamemode.set(P, M.Gamemode.SURVIVAL);
  placeP();
  // runhurt.mjs summons with NBT, which skips initialize(): no attribute roll (horse keeps base 0.225 speed), no goat ram-cooldown memory
  const e = EL.spawn(s.mob, 0.5 + OFFSET, PAD, 0.5, s.mob === 'horse' ? { maxHealthAttr: 15, movementSpeedAttr: M.Mount.RIDDEN_MOVEMENT_SPEED } : undefined);
  if (!e) return { err: 'EL.spawn gives nothing' };
  if (s.mob === 'goat') e.ramCooldown = 0;
  e.persistent = true; e.vx = e.vy = e.vz = 0;
  for (let t = 0; t < SETTLE; t++) { placeP(); EL.tick(); }
  placeP();
  if (!opts.noHit) Cb.attack(P, e);
  const log = [];
  for (let t = 0; t < T; t++) {
    if (e.removed || e.dead || !(e.health > 0) || EL.list.indexOf(e) < 0) break;
    log.push([e.x, e.y - PAD, e.z]);
    placeP();
    EL.tick();
  }
  return { log };
}
const MOVE = 0.02;
function stats(log) {
  const sp = [];
  for (let i = SKIP + 1; i < Math.min(log.length, WINDOW); i++) sp.push(Math.hypot(log[i][0] - log[i - 1][0], log[i][2] - log[i - 1][2]));
  const mv = sp.filter((v) => v > MOVE).sort((a, b) => a - b);
  const p60 = log[60] || log[log.length - 1] || [0.5, 0, 0.5];
  return { moving: mv.length / Math.max(1, WINDOW - SKIP - 1), p90: mv.length ? mv[Math.floor(mv.length * 0.75)] : 0,
    dist60: Math.hypot(p60[0] - 0.5, p60[2] - 0.5) };
}
const mean = (a) => a.reduce((p, q) => p + q, 0) / a.length;
const median = (a) => { const b = a.slice().sort((p, q) => p - q); return b[Math.floor(b.length / 2)]; };
const bps = (v) => (v * 20).toFixed(2) + ' b/s';
function compare(s, g, e) {
  if (e.err) return [`${s.id}: ${e.err}`];
  if (!g.logs.length) return [`${s.id}: no server rep landed a hit -- harness`];
  const gs = g.logs.map(stats), es = stats(e.log);
  const gm = mean(gs.map((q) => q.moving));
  if (gm < 0.1 && es.moving < 0.1) return [];   // neither side flees (a turtle on dry land: only knockback tail ticks cross MOVE)
  if (es.moving < gm / 2 || es.moving > Math.min(1, gm * 2)) return [`${s.id}: a punched ${s.mob} moves ${(gm * 100).toFixed(0)}% of ticks ${SKIP}..${WINDOW} after the hit on the server, ${(es.moving * 100).toFixed(0)}% in the engine`];
  const gp = median(gs.map((q) => q.p90).filter((v) => v > 0));
  if (!(gp > 0)) return [];
  const rel = (es.p90 - gp) / gp;
  return Math.abs(rel) <= (s.mob === 'rabbit' ? 0.10 : TOL) ? [] : [`${s.id}: punched ${s.mob} panic speed: server ${bps(gp)}, engine ${bps(es.p90)} (${rel > 0 ? '+' : ''}${(rel * 100).toFixed(1)}%)`];
}

console.log(`hurtrefcheck — hurt-panic vs the real 1.18.2 server (${LIVE.length} mobs, ${golden.generatedAt})`);
const reds = [];
let pass = 0;
const ENG = {};
for (const s of LIVE) {
  const g = golden.cases[s.id];
  if (!g) { reds.push(`${s.id}: no golden case`); continue; }
  const e = engineLog(s);
  ENG[s.id] = e;
  const bad = compare(s, g, e);
  if (bad.length) reds.push(...bad); else pass++;
  if (VERBOSE) {
    const f = (q) => `mv ${(q.moving * 100).toFixed(0)}% p90 ${bps(q.p90)} d60 ${q.dist60.toFixed(1)}`;
    console.log(`  ${s.id.padEnd(10)} server ${g.logs.map((L) => f(stats(L))).join(' | ')}\n             engine ${e.err || f(stats(e.log))}`);
  }
}
let breaks = 0, caught = 0;
const brk = (name, fired) => { breaks++; if (fired) caught++; else reds.push(`anti-vacuity: break "${name}" was NOT caught`); };
const cow = LIVE.find((q) => q.id === 'cow');
const base = compare(cow, golden.cases.cow, ENG.cow).join();
// the speed break needs a mob whose moving share already agrees (a red on moving share would mask it): mooshroom
{ const ms = LIVE.find((q) => q.id === 'mooshroom'); const mb = compare(ms, golden.cases.mooshroom, ENG.mooshroom).join();
  const g = JSON.parse(JSON.stringify(golden.cases.mooshroom)); g.logs = g.logs.map((L) => L.map((p) => [L[0][0] + (p[0] - L[0][0]) * 0.8, p[1], L[0][2] + (p[2] - L[0][2]) * 0.8]));
  brk('golden mooshroom panic speed x0.8', compare(ms, g, ENG.mooshroom).join() !== mb); }
{ const g = JSON.parse(JSON.stringify(golden.cases.cow)); g.logs = g.logs.map((L) => L.map(() => L[0]));
  brk('golden cow frozen', compare(cow, g, ENG.cow).join() !== base); }
{ const e = engineLog(cow, { noHit: true });
  brk('engine cow never hit', compare(cow, golden.cases.cow, e).join() !== base); }
for (const r of reds) console.log('  ✗ ' + r);
console.log(`hurtrefcheck: ${pass}/${LIVE.length} mobs match, ${reds.length} red · anti-vacuity ${caught}/${breaks}`);
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${reds.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(reds.length ? 1 : 0);
