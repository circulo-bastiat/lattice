#!/usr/bin/env node
// llamarefcheck.mjs — infra W-llama (25 Sept 2026): LLAMA SPIT vs WOLVES + WOLF AVOID LLAMA vs the real 1.18.2
// server (golden: runllama.mjs, mob-llama.json; scenes: llamascen.mjs). Loads the WHOLE engine (every 07*.js mob
// module, same standing as avoidrefcheck.mjs/hoglinrefcheck.mjs) and drives the same pens the server builds:
// ENT/TAMED scenes get a llama + a wolf (both ticked together, both logged, `llama_spit` entities tagged the
// tick they first appear); RETALIATE puts a real SURVIVAL player next to a llama and calls `Combat.attack(P, e)`
// once (the same call a player's real Attack packet resolves to, pmeleerefcheck.mjs's own standing).
//
// Compared per ENT/TAMED scene:
//   1. CHASE+SPIT — did the llama ever spit at all (ChaseWolvesGoal target-acquire + ProjectileAttackGoal fire),
//      both directions (rule 6); first-spit tick within the server's own rep spread +-FIRST_TOL; median inter-
//      spit cycle +-CYCLE_TOL.
//   2. WOLF FLEES — final llama-wolf distance farther than the start by FLEE_MARGIN, both directions; final
//      distance vs the server's own rep spread +-FINAL_TOL (avoidrefcheck.mjs's own method, "distance" being the
//      wolf-to-llama LIVE position).
//   3. WOLF HIT — did the wolf's Health ever drop below its start, both directions.
// Compared for RETALIATE: did the llama spit back within the server's own first-spit window (SpitRevengeGoal).
// Mismatches are FINDINGS (red, exit 1): a real engine-vs-server difference here belongs to whoever owns
// `07k_goals.js`/`07ze_llama.js` (docs/archive/REFEREE.md "Why mismatches are findings"), never fixed in this check.
// No golden -> SKIP. Anti-vacuity (D-30/D-305): forged golden values against the engine's REAL summaries, each
// must flip the verdict.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { ENT, R, WOLF_HP, T, spitSummary, med } from './llamascen.mjs';

const VERBOSE = process.argv.includes('--verbose');
const FIRST_TOL = 40, CYCLE_TOL = 8;    // ticks -- same standing as ranged2refcheck.mjs's own TOL/FIRST_TOL
const FINAL_TOL = 2.0;                  // blocks -- avoidrefcheck.mjs's own FINAL_TOL discipline
const FLEE_MARGIN = 1.0;                // blocks farther than the start counts as "fled" (avoidrefcheck.mjs)
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLD = [join(refDir, 'golden', 'mob-llama.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'mob-llama.json')].find((f) => existsSync(f));
if (!GOLD) { console.log('llamarefcheck: SKIP (golden not generated -- run node tools/referee/runllama.mjs)'); process.exit(0); }
const golden = JSON.parse(readFileSync(GOLD, 'utf8'));

// Seeded deterministically (same seed every run, D-497's own "stable red count" requirement): AvoidLlamaGoal's
// isScaredOf and ChaseWolvesGoal's 1/16 reciprocal-chance gate are the only randomness in play here.
let seed = 0x0111a3a0;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

// The engine as the game builds it: every 07*.js mob module (rostered mobs run EL.tickMob) + the real player,
// same module list as avoidrefcheck.mjs/ranged2refcheck.mjs.
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
const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); } };
w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 0; w.tickingAt = () => true; w.biomeAt = () => M.Biomes.index('plains');
M.World = Object.assign(M.World || {}, w);
if (M.Behave && M.Behave.init) M.Behave.init(w);
M.Physics.shapeAt = (x, y, z) => { const id = w.get(Math.floor(x), Math.floor(y), Math.floor(z)); return id && M.States.solid[id] === 1 ? M.Physics.shapesFor(id) : null; };
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.EntityList.init(); M.Ai.init(); M.Equip.init(); M.Breed.init(); M.Tame.init(); M.Passive.init();
if (M.Goat && M.Goat.init) M.Goat.init();
M.Player.init();
if (M.Combat && M.Combat.init) M.Combat.init();
M.Gamemode.set(M.Player, M.Gamemode.SURVIVAL);
if (M.Diff && M.Diff.set) M.Diff.set('normal');
M.EntityList.random = rng;
Math.random = rng;
const { EntityList: EL, States: S } = M;
const P = M.Player;
P.x = 0.5; P.y = 200; P.z = 0.5;   // parked away from every ENT/TAMED pen (matches runllama.mjs -- no player there)

const PAD = 0;
function buildPen() {
  cells.clear();
  const stone = S.stateOf('stone');
  for (let x = -R - 1; x <= R + 1; x++) for (let z = -R - 1; z <= R + 1; z++) {
    w.set(x, PAD - 1, z, stone);
    if (Math.abs(x) === R + 1 || Math.abs(z) === R + 1) { w.set(x, PAD, z, stone); w.set(x, PAD + 1, z, stone); }
  }
}

function spawnAt(type, x, y, z) {
  const e = EL.spawn(type, x, y, z);
  if (!e) return null;
  e.persistent = true; e.vx = e.vy = e.vz = 0;
  return e;
}

function entRun(s) {
  seed = (0x11a30000 + s.id.length * 7919 + (s.strength || 0) * 131 + s.dx) >>> 0;
  buildPen(); EL.list.length = 0;
  const llama = spawnAt('llama', 0.5, PAD, 0.5);
  if (!llama) return { err: 'EL.spawn gives nothing for llama' };
  llama.strength = s.strength;
  const wolf = spawnAt('wolf', s.dx + 0.5, PAD, 0.5);
  if (!wolf) return { err: 'EL.spawn gives nothing for wolf' };
  wolf.maxHealth = WOLF_HP; wolf.health = WOLF_HP;
  if (s.tamed) { wolf.tamed = true; wolf.owner = 'player'; }
  const llog = [], wlog = [], hlog = [], shots = [];
  const seen = new Set();
  for (let t = 0; t < T; t++) {
    llog.push([llama.x, llama.y - PAD, llama.z]);
    wlog.push([wolf.x, wolf.y - PAD, wolf.z]);
    hlog.push(wolf.health);
    P.y = 200;
    if (llama.removed || llama.dead || wolf.removed || wolf.dead) break;
    EL.tick();
    for (const q of EL.list) if (!seen.has(q) && q.type === 'llama_spit') { seen.add(q); shots.push(t + 1); }
  }
  return { llog, wlog, hlog, shots, sum: spitSummary(shots) };
}

function retRun(rep) {
  seed = (0x2e7a1000 + rep * 7919) >>> 0;
  buildPen(); EL.list.length = 0;
  const llama = spawnAt('llama', 0.5, PAD, 0.5);
  if (!llama) return { err: 'EL.spawn gives nothing for llama' };
  llama.strength = 1;
  P.x = 2.5; P.y = PAD; P.z = 0.5; P.vx = P.vy = P.vz = 0; P.dead = false; P.effects = {};
  P.health = P.maxHealth || 20;
  M.Combat.attack(P, llama);
  const shots = []; const seen = new Set();
  for (let t = 0; t < T; t++) {
    P.x = 2.5; P.y = PAD; P.z = 0.5; P.vx = P.vz = 0; P.health = P.maxHealth || 20; P.dead = false;
    if (llama.removed || llama.dead) break;
    EL.tick();
    for (const q of EL.list) if (!seen.has(q) && q.type === 'llama_spit') { seen.add(q); shots.push(t + 1); }
  }
  return { shots, sum: spitSummary(shots) };
}

const distTo = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function pairDist(L, W) { const n = Math.min(L.length, W.length); const out = []; for (let i = 0; i < n; i++) out.push(distTo(L[i], W[i])); return out; }
const fled = (ds) => (ds[ds.length - 1] - ds[0]) > FLEE_MARGIN;

function serverEntSummary(g) {
  const spitN = g.shots.map((sh) => sh.n);
  const spat = spitN.filter((n) => n > 0).length * 2 > spitN.length;
  const firsts = g.shots.map((sh) => sh.first).filter((v) => v != null);
  const cycles = g.shots.map((sh) => sh.medCycle).filter((v) => v != null);
  const ds = g.llamaLogs.map((L, i) => pairDist(L, g.wolfLogs[i]));
  const fleeFlags = ds.map(fled);
  const fledMaj = fleeFlags.filter(Boolean).length * 2 > fleeFlags.length;
  const finals = ds.map((d) => d[d.length - 1]);
  const hitFlags = g.healthLogs.map((H) => Math.min(...H) < H[0] - 1e-6);
  const hitMaj = hitFlags.filter(Boolean).length * 2 > hitFlags.length;
  return { spat, firstMin: firsts.length ? Math.min(...firsts) : null, firstMax: firsts.length ? Math.max(...firsts) : null,
    cycle: cycles.length ? med(cycles) : null, fled: fledMaj, finalMin: Math.min(...finals), finalMax: Math.max(...finals), hit: hitMaj };
}
function compareEnt(s, g, e) {
  if (e.err) return [`${s.id}: ${e.err}`];
  const sv = serverEntSummary(g);
  const eSpat = e.shots.length > 0;
  const out = [];
  if (sv.spat !== eSpat) out.push(`${s.id}: server ${sv.spat ? 'the llama spits at the wolf' : 'the llama never spits'}, engine ${eSpat ? 'does' : 'does not'}`);
  else if (sv.spat) {
    if (e.sum.first == null) out.push(`${s.id}: server first spit ${sv.firstMin}..${sv.firstMax}, engine never spits in ${T} ticks`);
    else if (e.sum.first > sv.firstMax + FIRST_TOL || e.sum.first < sv.firstMin - FIRST_TOL) out.push(`${s.id}: server first spit ${sv.firstMin}..${sv.firstMax}, engine ${e.sum.first}`);
    if (sv.cycle != null && e.sum.medCycle != null && Math.abs(e.sum.medCycle - sv.cycle) > CYCLE_TOL) out.push(`${s.id}: server spit cycle ${sv.cycle}, engine ${e.sum.medCycle}`);
  }
  const ds = pairDist(e.llog, e.wlog);
  const eFled = fled(ds);
  if (sv.fled !== eFled) out.push(`${s.id}: wolf flee: server ${sv.fled ? 'flees' : 'does not flee'}, engine ${eFled ? 'flees' : 'does not flee'}`);
  else if (sv.fled) {
    const eFinal = ds[ds.length - 1];
    if (eFinal < sv.finalMin - FINAL_TOL || eFinal > sv.finalMax + FINAL_TOL) out.push(`${s.id}: final llama-wolf distance ${sv.finalMin.toFixed(2)}..${sv.finalMax.toFixed(2)} on the server, engine ${eFinal.toFixed(2)}`);
  }
  const eHit = Math.min(...e.hlog) < e.hlog[0] - 1e-6;
  if (sv.hit !== eHit) out.push(`${s.id}: wolf takes spit damage: server ${sv.hit ? 'yes' : 'no'}, engine ${eHit ? 'yes' : 'no'}`);
  return out;
}
function compareRetaliate(g, e) {
  if (e.err) return [`retaliate: ${e.err}`];
  const spitN = g.shots.map((sh) => sh.n);
  const spat = spitN.filter((n) => n > 0).length * 2 > spitN.length;
  const firsts = g.shots.map((sh) => sh.first).filter((v) => v != null);
  const eSpat = e.shots.length > 0;
  const out = [];
  if (spat !== eSpat) out.push(`retaliate: server ${spat ? 'the llama spits back' : 'never spits back'}, engine ${eSpat ? 'does' : 'does not'}`);
  else if (spat && firsts.length) {
    const firstMin = Math.min(...firsts), firstMax = Math.max(...firsts);
    if (e.sum.first > firstMax + FIRST_TOL || e.sum.first < firstMin - FIRST_TOL) out.push(`retaliate: server first spit-back ${firstMin}..${firstMax}, engine ${e.sum.first}`);
  }
  return out;
}

console.log(`llamarefcheck — llama spit vs wolves + wolf avoid llama vs the real 1.18.2 server (${ENT.length} ent + 1 retaliate, ${golden.generatedAt})`);
const reds = []; let pass = 0;
const ENGE = {};
for (const s of ENT) {
  const g = golden.entCases[s.id];
  if (!g) { reds.push(`${s.id}: no golden case (rerun runllama.mjs)`); continue; }
  const e = entRun(s);
  ENGE[s.id] = e;
  const bad = compareEnt(s, g, e);
  if (bad.length) reds.push(...bad); else pass++;
  if (VERBOSE) {
    const sv = e.err ? null : serverEntSummary(g);
    console.log(`  ${s.id.padEnd(16)} server ${sv ? JSON.stringify(sv) : 'n/a'}`);
    if (!e.err) console.log(`  ${''.padEnd(16)} engine spit ${e.shots.length} first ${e.sum.first} cyc ${e.sum.medCycle} finalDist ${pairDist(e.llog, e.wlog).slice(-1)[0].toFixed(2)} finalHP ${e.hlog[e.hlog.length - 1]}`);
  }
}
const retRuns = Array.from({ length: 3 }, (_, r) => retRun(r));
{
  const bad = retRuns.some((r) => r.err) ? [`retaliate: ${retRuns.find((r) => r.err).err}`] : compareRetaliate(golden.retCases, { shots: retRuns.flatMap((r) => r.shots), sum: spitSummary(retRuns.flatMap((r) => r.shots)), err: null });
  if (bad.length) reds.push(...bad); else pass++;
  if (VERBOSE) console.log(`  retaliate        server ${JSON.stringify(golden.retCases.shots)}\n  ${''.padEnd(16)} engine ${retRuns.map((r) => r.shots.join(',')).join(' | ')}`);
}
for (const r of reds) console.log('  ✗ ' + r);

// Anti-vacuity (D-30/D-305): forged golden values against the engine's REAL summaries -- each must flip the verdict.
let breaks = 0, caught = 0;
const brk = (name, fired) => { breaks++; if (fired) caught++; else reds.push(`anti-vacuity: break "${name}" was NOT caught`); };
const wildHi = ENT.find((q) => q.id === 'wild_s5_dx4');
const wildLo = ENT.find((q) => q.id === 'wild_s1_dx4');
// Each forge is aimed at the OPPOSITE of what the real golden already says (the server truth turned out to be
// "the llama never spits at a wild wolf" and "the wolf is never hit" for every ENT scene tested this pass --
// forging those same facts to their ALREADY-true value would be a vacuous no-op break, D-305's own warning).
if (ENGE[wildHi.id] && !ENGE[wildHi.id].err) {
  const g = golden.entCases[wildHi.id];
  { // claim the server DOES spit at the wolf, like the engine actually does here -- must erase that red.
    const gg = JSON.parse(JSON.stringify(g));
    gg.shots = gg.shots.map(() => ({ n: 4, first: 41, medCycle: 40 }));
    brk('golden wild_s5_dx4 spits injected (server never really spits)', compareEnt(wildHi, gg, ENGE[wildHi.id]).join() !== compareEnt(wildHi, g, ENGE[wildHi.id]).join()); }
  { // collapse the wolf onto the llama's OWN live position every tick -- distance 0 forever, definitely "does not flee".
    const gg = JSON.parse(JSON.stringify(g));
    gg.wolfLogs = gg.wolfLogs.map((W, i) => gg.llamaLogs[i].map((p) => p.slice()));
    brk('golden wild_s5_dx4 wolf flee erased (collapsed onto the llama)', compareEnt(wildHi, gg, ENGE[wildHi.id]).join() !== compareEnt(wildHi, g, ENGE[wildHi.id]).join()); }
}
if (ENGE[wildLo.id] && !ENGE[wildLo.id].err) {
  const g = golden.entCases[wildLo.id];
  // claim the wolf DOES take spit damage (a visible late dip), like the engine actually shows here.
  const gg = JSON.parse(JSON.stringify(g));
  gg.healthLogs = gg.healthLogs.map((H) => H.map((v, i) => (i >= H.length - 20 ? v - 6 : v)));
  brk('golden wild_s1_dx4 wolf damage injected (server never really hits it)', compareEnt(wildLo, gg, ENGE[wildLo.id]).join() !== compareEnt(wildLo, g, ENGE[wildLo.id]).join());
}
console.log(`llamarefcheck: ${pass}/${ENT.length + 1} scenes match, ${reds.length} red · anti-vacuity ${caught}/${breaks}`);
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${reds.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(reds.length ? 1 : 0);
