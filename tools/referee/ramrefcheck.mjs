#!/usr/bin/env node
// ramrefcheck.mjs — infra I6 (s138): the GOAT RAM vs the real 1.18.2 server (golden: runram.mjs -> ram.json; scenarios:
// ramscen.mjs). QUEUE 0.0 (Dan: "run its AI for real ... attack, knockback ... speed in blocks/s vs .decomp"). A ram-ready
// goat (server: NBT-form summon, no ram cooldown; engine: `e.ramCooldown = 0`, 07zj_goat.js `Gt.RamGoal`) stands `dist`
// east of a player at the pen centre. Compared per scene, every number the SERVER's (D-329):
//   1. does it ram at all within T ticks (both directions: a creative player is never a ram target, rule 6);
//   2. where the charge starts, blocks from the player (vanilla walks to a lane start first: PrepareRamTask.findRamStart);
//   3. the charge's peak speed (RamImpactTask speed 3.0), within 5 %;
//   4. the player's knockback, horizontal, through kbrefcheck.mjs's own one-tick ground decay (0.6*0.91, cited there),
//      within 10 %; vertical printed.
// Anti-vacuity (D-30/D-305): golden charge speed x0.8, golden knock x0.5, engine goat never ram-ready -- each caught.
// Mismatches are FINDINGS (red, exit 1). No golden -> SKIP.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCEN, T, R, CHARGE, KNOCK } from './ramscen.mjs';

const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'ram.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'ram.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('ramrefcheck: SKIP (golden not generated -- run node tools/referee/runram.mjs)'); process.exit(process.env.MCLITE_REQUIRE_REFEREE ? 1 : 0); }
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
const PAD = 0;
function buildPen() {
  cells.clear();
  const stone = S.stateOf('stone');
  for (let x = -R - 1; x <= R + 1; x++) for (let z = -R - 1; z <= R + 1; z++) {
    w.set(x, PAD - 1, z, stone);
    if (Math.abs(x) === R + 1 || Math.abs(z) === R + 1) for (let y = 0; y < 3; y++) w.set(x, PAD + y, z, stone);
  }
}
function placeP() { P.x = 0.5; P.y = PAD; P.z = 0.5; P.vx = P.vy = P.vz = 0; P.onGround = true; P.yaw = -Math.PI / 2; P.dead = false; P.health = P.maxHealth || 20; }
function engineLog(s, opts = {}) {
  buildPen(); EL.list.length = 0;
  if (Sv && Sv.init) Sv.init(P);
  M.Gamemode.set(P, s.creative ? M.Gamemode.CREATIVE : M.Gamemode.SURVIVAL);
  placeP();
  const e = EL.spawn(s.mob, 0.5 + s.dist, PAD, 0.5);
  if (!e) return { err: 'EL.spawn gives nothing' };
  e.persistent = true; e.vx = e.vy = e.vz = 0;
  e.isBaby = !!s.baby; if (s.baby) e.age = -24000;
  e.screaming = !!s.screaming;
  e.longJumpCooldown = 1e6;                     // runram's NOJUMP memory
  e.ramCooldown = opts.notReady ? 1e6 : 0;      // runram's NBT-form summon: no ram cooldown
  const log = [], knocks = [];
  for (let t = 0; t < T; t++) {
    if (e.removed || e.dead || EL.list.indexOf(e) < 0) break;
    log.push([e.x, e.y - PAD, e.z]);
    placeP();
    EL.tick();
    if (Math.hypot(P.vx || 0, P.vz || 0) > 1e-6 || (P.vy || 0) > 1e-6) knocks.push([P.vx || 0, P.vy || 0, P.vz || 0]);
  }
  return { log, knocks };
}
const HORIZ_DECAY = 0.6 * 0.91;   // kbrefcheck.mjs's cited one-tick ground decay (LivingEntity.java:2122)
function metrics(log, knocks, decay) {
  let t0 = -1, from = null, peak = 0;
  for (let i = 1; i < log.length; i++) {
    const v = Math.hypot(log[i][0] - log[i - 1][0], log[i][2] - log[i - 1][2]);
    if (v > CHARGE && t0 < 0) { t0 = i; from = Math.hypot(log[i - 1][0] - 0.5, log[i - 1][2] - 0.5); }
    if (t0 >= 0 && i < t0 + 40) peak = Math.max(peak, v);
  }
  const k = knocks.map((q) => [Math.hypot(q[0], q[2]) * decay, q[1]]).find((q) => q[0] > KNOCK * (decay === 1 ? 1 : HORIZ_DECAY));
  return { t0, from, peak, kh: k ? k[0] : 0, kv: k ? k[1] : 0, rammed: t0 >= 0 || !!k };
}
const mean = (a) => a.length ? a.reduce((p, q) => p + q, 0) / a.length : NaN;
function compare(s, g, e) {
  if (e.err) return [`${s.id}: ${e.err}`];
  const gm = g.logs.map((L, i) => metrics(L, g.knocks[i] || [], 1));
  const em = metrics(e.log, e.knocks, HORIZ_DECAY);
  const rammed = gm.filter((q) => q.rammed);
  const out = [];
  if (!rammed.length) {
    if (em.rammed) out.push(`${s.id}: the server goat never rams in ${gm.length} reps; the engine goat rams (charge at tick ${em.t0})`);
    return out;
  }
  if (rammed.length * 2 < gm.length) return [`${s.id}: server rammed in only ${rammed.length}/${gm.length} reps -- harness?`];
  if (!em.rammed) return [`${s.id}: the server goat rams (${rammed.length}/${gm.length} reps, charge ~tick ${mean(rammed.map((q) => q.t0)).toFixed(0)} from ${mean(rammed.map((q) => q.from)).toFixed(2)} blocks); the engine goat never rams in ${T} ticks`];
  const gf = mean(rammed.map((q) => q.from)), gp = mean(rammed.map((q) => q.peak));
  const withK = rammed.filter((q) => q.kh > 0), gk = mean(withK.map((q) => q.kh)), gv = mean(withK.map((q) => q.kv));
  if (Math.abs(em.from - gf) > 0.75) out.push(`${s.id}: charge starts ${gf.toFixed(2)} blocks from the player on the server (the lane start), ${em.from.toFixed(2)} in the engine`);
  if (Math.abs(em.peak - gp) / gp > 0.05) out.push(`${s.id}: charge peak speed server ${(gp * 20).toFixed(2)} b/s, engine ${(em.peak * 20).toFixed(2)} b/s (${((em.peak / gp - 1) * 100).toFixed(1)}%)`);
  if (withK.length && Math.abs(em.kh - gk) / gk > 0.10) out.push(`${s.id}: ram knockback on the player (horizontal, packet-equivalent) server ${gk.toFixed(3)}, engine ${em.kh.toFixed(3)} (${((em.kh / gk - 1) * 100).toFixed(0)}%); vertical server ${gv.toFixed(3)} engine raw ${em.kv.toFixed(3)}`);
  return out;
}

console.log(`ramrefcheck — goat ram vs the real 1.18.2 server (${SCEN.length} scenes, ${golden.generatedAt})`);
const reds = []; let pass = 0; const ENG = {};
for (const s of SCEN) {
  const g = golden.cases[s.id];
  if (!g) { reds.push(`${s.id}: no golden case`); continue; }
  const e = engineLog(s); ENG[s.id] = e;
  const bad = compare(s, g, e);
  if (bad.length) reds.push(...bad); else pass++;
  if (VERBOSE) {
    const f = (q) => `t0 ${q.t0} from ${q.from === null ? '-' : q.from.toFixed(2)} peak ${(q.peak * 20).toFixed(2)}b/s knock h${q.kh.toFixed(3)} v${q.kv.toFixed(3)}`;
    console.log(`  ${s.id.padEnd(13)} server ${g.logs.map((L, i) => f(metrics(L, g.knocks[i] || [], 1))).join(' | ')}\n                engine ${e.err || f(metrics(e.log, e.knocks, HORIZ_DECAY))}`);
  }
}
let breaks = 0, caught = 0;
const brk = (name, fired) => { breaks++; if (fired) caught++; else reds.push(`anti-vacuity: break "${name}" was NOT caught`); };
const a5 = SCEN.find((q) => q.id === 'adult_d7');
const base = compare(a5, golden.cases[a5.id], ENG[a5.id]).join();
{ const g = JSON.parse(JSON.stringify(golden.cases[a5.id]));
  g.logs = g.logs.map((L) => L.map((p, i) => i === 0 ? p : [L[0][0] + (p[0] - L[0][0]) * 0.8, p[1], L[0][2] + (p[2] - L[0][2]) * 0.8]));
  brk('golden charge speed x0.8', compare(a5, g, ENG[a5.id]).join() !== base); }
{ const g = JSON.parse(JSON.stringify(golden.cases[a5.id])); g.knocks = g.knocks.map((K) => K.map((k) => [k[0] * 0.5, k[1], k[2] * 0.5]));
  brk('golden knock x0.5', compare(a5, g, ENG[a5.id]).join() !== base); }
{ const e = engineLog(a5, { notReady: true });
  brk('engine goat never ram-ready', compare(a5, golden.cases[a5.id], e).join() !== base); }
for (const r of reds) console.log('  ✗ ' + r);
console.log(`ramrefcheck: ${pass}/${SCEN.length} scenes match, ${reds.length} red · anti-vacuity ${caught}/${breaks}`);
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${reds.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(reds.length ? 1 : 0);
