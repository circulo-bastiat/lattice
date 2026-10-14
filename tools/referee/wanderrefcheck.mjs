#!/usr/bin/env node
// wanderrefcheck.mjs — infra I6 (s147, 25 Sept 2026): IDLE WANDER vs the real 1.18.2 server (golden: runwander.mjs, wander.json;
// scenarios + the question: wanderscen.mjs — does a goal-selector mob start random goals at vanilla's rate, given vanilla evaluates
// canStart only on even ticks, MobEntity.tickNewAi). Per mob the engine builds the same stone pen in a cell map, spawns the mob
// (EL.spawn, AI on, persistent) at its centre, runs `EL.tick` T times logging x/y/z every STEP ticks, PENS x REPS runs. Compared:
//   1. WALK RATE: walks started per 1000 ticks (wanderscen.walks), pooled over runs — red when the Poisson z > 4 AND the ratio is
//      outside 0.8..1.25;
//   2. FIRST WALK: the mean tick of the first walk — red when z > 4 (se from the run spread) AND the ratio is outside 0.8..1.25.
// Server logs cut short by the harness (a mob's selector stops matching mid-rep on a loaded 2-core server, ~1/3 of runs, cause not
// found — see REFEREE.md) count by their logged samples (rate) and only when a walk is inside them (first walk).
// Anti-vacuity (D-30/D-305): the golden cow logs frozen (no walks), the engine cow's walk rate doubled (every sample repeated at half
// the ticks), the golden villager's logs time-compressed x2 — each caught.
// Harness pattern: panicrefcheck.mjs.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCEN, T, STEP, R, PENS, REPS, walks } from './wanderscen.mjs';

const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'wander.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'wander.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('wanderrefcheck: SKIP (golden not generated -- run node tools/referee/runwander.mjs)'); process.exit(0); }
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
// #1495: the server's pens are cut into an ENDLESS flat world (runwander: bedrock, dirt, dirt, then the stone that replaced
// the grass at FLOOR - 1), and FuzzyTargeting never asks whether a target is reachable -- a candidate past the wall is a
// valid floor there. So the engine's ground is endless too: those four layers everywhere, the pen's cells on top.
let FLAT = 0;
const w = { get: (x, y, z) => cells.get(key(x, y, z)) || (y >= PAD - 4 && y <= PAD - 1 ? FLAT : 0), set: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); } };
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
  FLAT = stone;
  for (let x = -R - 1; x <= R + 1; x++) for (let z = -R - 1; z <= R + 1; z++) {
    w.set(x, PAD - 1, z, stone);
    if (Math.abs(x) === R + 1 || Math.abs(z) === R + 1) { w.set(x, PAD, z, stone); w.set(x, PAD + 1, z, stone); }
  }
}
P.x = 0.5; P.y = PAD + 200; P.z = 0.5;   // no player near the pen (the server has none)
const VD = SCEN.find((q) => q.id === 'villager');
function engineLogs(s) {
  const logs = [];
  for (let run = 0; run < PENS * REPS; run++) {
    buildPen(); EL.list.length = 0;
    const e = EL.spawn(s.mob, 0.5, PAD, 0.5);
    if (!e) return { err: 'EL.spawn gives nothing' };
    e.persistent = true; e.vx = e.vy = e.vz = 0;
    if (s === VD && e.villagerData) e.villagerData.profession = 'none';
    const log = [];
    for (let t = 0; t < T; t++) {
      if (t % STEP === 0) log.push([e.x, e.y - PAD, e.z]);
      if (e.removed || EL.list.indexOf(e) < 0) break;
      P.y = PAD + 200;
      EL.tick();
    }
    logs.push(log);
  }
  return { logs };
}
function summary(logs) {
  let n = 0, samples = 0;
  const firsts = [];
  for (const L of logs) {
    const q = walks(L);
    n += q.n; samples += L.length - 1;
    if (q.first < L.length || L.length >= T / STEP) firsts.push(q.first * STEP);
  }
  const mf = firsts.reduce((a, b) => a + b, 0) / Math.max(1, firsts.length);
  const sd = Math.sqrt(firsts.reduce((a, b) => a + (b - mf) * (b - mf), 0) / Math.max(1, firsts.length - 1));
  return { n, ticks: samples * STEP, rate: 1000 * n / Math.max(1, samples * STEP), mf, se: sd / Math.sqrt(Math.max(1, firsts.length)), runs: firsts.length };
}
const off = (r) => r < 0.8 || r > 1.25;
function compare(s, g, e) {
  if (e.err) return [`${s.id}: ${e.err}`];
  const a = summary(g.logs), b = summary(e.logs), out = [];
  const zr = Math.abs(a.rate - b.rate) / (1000 * Math.sqrt(a.n / (a.ticks * a.ticks) + b.n / (b.ticks * b.ticks)) || 1e-9);
  if (zr > 4 && off(b.rate / a.rate)) out.push(`${s.id}: an idle ${s.mob} alone in a pen starts ${a.rate.toFixed(2)} walks per 1000 ticks on the server, ${b.rate.toFixed(2)} in the engine (x${(b.rate / a.rate).toFixed(2)}, z ${zr.toFixed(1)})`);
  const zf = Math.abs(a.mf - b.mf) / Math.sqrt(a.se * a.se + b.se * b.se || 1e-9);
  if (zf > 4 && off(b.mf / a.mf)) out.push(`${s.id}: its first walk starts at tick ${a.mf.toFixed(0)} on the server (mean of ${a.runs}), ${b.mf.toFixed(0)} in the engine (z ${zf.toFixed(1)})`);
  return out;
}
console.log(`wanderrefcheck — idle wander (goal-selector start rate) vs the real 1.18.2 server (${SCEN.length} mobs, ${golden.generatedAt})`);
const reds = [];
let pass = 0;
const ENG = {};
for (const s of SCEN) {
  const g = golden.cases[s.id];
  if (!g) { reds.push(`${s.id}: no golden case`); continue; }
  const e = ENG[s.id] = engineLogs(s);
  const bad = compare(s, g, e);
  if (bad.length) reds.push(...bad); else pass++;
  if (VERBOSE) { const a = summary(g.logs), b = e.err ? null : summary(e.logs);
    console.log(`  ${s.id.padEnd(11)} server ${a.rate.toFixed(2)}/1000t first ${a.mf.toFixed(0)}±${a.se.toFixed(0)} (${a.runs}) · engine ${b ? `${b.rate.toFixed(2)}/1000t first ${b.mf.toFixed(0)}±${b.se.toFixed(0)} (${b.runs})` : e.err}`); }
}
let breaks = 0, caught = 0;
const brk = (name, fired) => { breaks++; if (fired) caught++; else reds.push(`anti-vacuity: break "${name}" was NOT caught`); };
const cow = SCEN.find((q) => q.id === 'cow'), vil = SCEN.find((q) => q.id === 'villager');
{ const g = { logs: golden.cases.cow.logs.map((L) => L.map(() => L[0])) }; brk('golden cow logs frozen', compare(cow, g, ENG.cow).length > 0); }
{ const e = { logs: ENG.cow.logs.map((L) => { const o = []; for (let i = 0; i < L.length; i += 2) o.push(L[i]); return o.concat(o.map((p) => p)); }) };
  brk('engine cow walks x2 (time-compressed)', compare(cow, golden.cases.cow, e).length > 0); }
{ const g = { logs: golden.cases.villager.logs.map((L) => { const o = []; for (let i = 0; i < L.length; i += 2) o.push(L[i]); return o; }) };
  brk('golden villager time-compressed x2', compare(vil, g, ENG.villager).length > 0 || compare(vil, golden.cases.villager, ENG.villager).length > 0); }
for (const r of reds) console.log('  ✗ ' + r);
console.log(`wanderrefcheck: ${pass}/${SCEN.length} mobs match, ${reds.length} red · anti-vacuity ${caught}/${breaks}`);
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${reds.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(reds.length ? 1 : 0);
