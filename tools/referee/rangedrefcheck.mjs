#!/usr/bin/env node
// rangedrefcheck.mjs — infra I6 (s148, 25 Sept 2026): MOB RANGED (skeleton/stray/pillager shooting a still survival
// player DIST blocks down a walled lane) vs the real 1.18.2 server (golden: runranged.mjs, mob-ranged.json; scenes:
// rangedscen.mjs). Per scene the engine builds the same lane in a cell map, keeps the REAL player (14_player.js,
// SURVIVAL) at its spot, spawns the mob (EL.spawn, AI on, its own spawn gear) and runs `EL.tick` T times x REPS seeds.
// Compared, per scene:
//   (1) CYCLE — the median time between volleys. Server: gaps between hits on the player pooled over reps (an arrow
//       that hits is gone before a poll can tag it, so hits are the clean stream; a rep with < 3 hits uses its tagged
//       launches), gaps >= 1.5x the smallest dropped (a missed volley), then the median. Engine: the median gap between its own arrow spawns. Tolerance TOL (pillager
//       TOL_XBOW: its charged-hold is 20 + nextInt(20)).
//   (2) HIT DAMAGE — the mean raw damage per hit within DMG_TOL (server reads are under Resistance IV, x5 back to raw).
//   (4) FIRST VOLLEY — the engine's median first launch no later than the server's slowest first event + FIRST_TOL.
//   (3) the effect (stray Slowness) is applied iff the server applied it.
// Anti-vacuity (D-30/D-305): golden skeleton@hard cycle +20, mean damage +1, first volley 100 ticks earlier, and a flipped
// stray Slowness are each caught. Mismatches are FINDINGS (red, exit 1). No golden -> SKIP.
// window that is never reached are each caught. Mismatches are FINDINGS (red, exit 1). No golden -> SKIP.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';

const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');

let seed = 0x0c4a5e01;
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

import { T, REPS, DIST, SCENES } from './rangedscen.mjs';
const VERBOSE = process.argv.includes('--verbose');
const TOL = 4, TOL_XBOW = 12, DMG_TOL = 0.4, FIRST_TOL = 40;
const refDir2 = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLD = [join(refDir2, 'golden', 'mob-ranged.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'mob-ranged.json')].find((f) => existsSync(f));
if (!GOLD) { console.log('rangedrefcheck: SKIP (golden not generated -- run node tools/referee/runranged.mjs)'); process.exit(0); }
const golden = JSON.parse(readFileSync(GOLD, 'utf8'));

const med = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
const gaps = (a) => { const o = []; for (let i = 1; i < a.length; i++) o.push(a[i] - a[i - 1]); return o; };

function buildLane() {
  cells.clear();
  const stone = S.stateOf('stone');
  for (let x = -3; x <= DIST + 3; x++) {
    for (let z = -1; z <= 1; z++) w.set(x, -1, z, stone);
    for (let y = 0; y <= 2; y++) { w.set(x, y, -2, stone); w.set(x, y, 2, stone); }
  }
  for (let z = -1; z <= 1; z++) for (let y = 0; y <= 2; y++) { w.set(-3, y, z, stone); w.set(DIST + 3, y, z, stone); }
}

function engineRun(sc, rep) {
  seed = (0x5eed0000 + rep * 7919 + sc.id.length * 131) >>> 0;
  buildLane(); EL.list.length = 0;
  M.Diff.set(sc.diff);
  P.x = 0.5; P.y = 0; P.z = 0.5; P.vx = P.vy = P.vz = 0; P.dead = false; P.effects = {};
  P.health = P.maxHealth || 20;
  const e = EL.spawn(sc.mob, DIST + 0.5, 0, 0.5);
  if (!e) return { err: 'EL.spawn gives nothing' };
  e.persistent = true;
  const seen = new Set(), shots = [], dmg = [];
  let eff = false;
  for (let t = 0; t < T; t++) {
    P.x = 0.5; P.y = 0; P.z = 0.5; P.vx = P.vz = 0;
    const h0 = P.health;
    EL.tick();
    // the player's own per-tick survival bookkeeping (the invulnerability countdown lives there, 14d_survival.js Sv.tick);
    // without it the first hit's 20-tick window never closes and every later arrow bounces.
    if (P.invulnerable > 0) P.invulnerable--;
    if (M.Effects && M.Effects.tick) M.Effects.tick(P);
    for (const q of EL.list) if (/arrow/.test(q.type) && !seen.has(q)) { seen.add(q); shots.push(t); }
    if (P.health < h0) dmg.push(Math.round((h0 - P.health) * 100) / 100);
    if (sc.effect && M.Effects.hasStatusEffect(P, sc.effect)) eff = true;
    if (P.health < 10) P.health = P.maxHealth || 20;
    P.dead = false;
    if (e.removed || e.dead) break;
  }
  return { shots, dmg, eff, err: null };
}

function serverSummary(g) {
  // Pooled gaps over reps (hits when a rep has >= 3, else its tagged launches); a missed volley doubles a gap, so keep
  // only gaps < 1.5 x the smallest before taking the median.
  const pool = [], dmg = new Set(), dl = [], firsts = []; let effN = 0;
  for (const r of g.reps) {
    const hitT = r.hits.map((h) => h[0]);
    pool.push(...(hitT.length >= 3 ? gaps(hitT) : gaps(r.shots)).filter((v) => v > 5));
    for (const h of r.hits) { const d = Math.round(h[1] * 5) / 100; dmg.add(d); dl.push(d); }   // Resistance IV: 20% of raw, x100 fixed point
    const f = Math.min(r.shots.length ? r.shots[0] : Infinity, r.hits.length ? r.hits[0][0] : Infinity);
    if (f !== Infinity) firsts.push(f);
    if (r.effect) effN++;
  }
  const lo = pool.length ? Math.min(...pool) : null;
  return { cycle: lo === null ? null : med(pool.filter((v) => v < lo * 1.5)), dmg, mean: dl.length ? dl.reduce((a, b) => a + b, 0) / dl.length : null,
    firstMax: firsts.length ? Math.max(...firsts) : null, eff: effN * 2 >= g.reps.length };
}

function compare(sc, s, runs) {
  const out = [];
  if (runs.some((r) => r.err)) return [`${sc.id}: ${runs.find((r) => r.err).err}`];
  const eCyc = med(runs.map((r) => med(gaps(r.shots))).filter((v) => v !== null));
  const tol = sc.mob === 'pillager' ? TOL_XBOW : TOL;
  if (s.cycle === null) out.push(`${sc.id}: server never fired twice (harness)`);
  else if (eCyc === null) out.push(`${sc.id}: server fires every ~${s.cycle} ticks, engine never fires twice in ${T} ticks`);
  else if (Math.abs(eCyc - s.cycle) > tol) out.push(`${sc.id}: server fires every ~${s.cycle} ticks, engine every ${eCyc}`);
  // (2) HIT DAMAGE — the mean over every hit (the per-shot damage is a gaussian roll for a bow, flat 2.0 x speed for a
  // crossbow): |engine - server| <= DMG_TOL.
  const eAll = runs.flatMap((r) => r.dmg), eMean = eAll.length ? eAll.reduce((a, b) => a + b, 0) / eAll.length : null;
  if (s.mean !== null && eMean === null) out.push(`${sc.id}: server arrows hit (mean ${s.mean.toFixed(2)}), engine arrows never hit`);
  else if (s.mean !== null && Math.abs(eMean - s.mean) > DMG_TOL) out.push(`${sc.id}: arrow hits average ${s.mean.toFixed(2)} on the server (${[...s.dmg].sort((a, b) => a - b).join('/')}), engine ${eMean.toFixed(2)} (${[...new Set(eAll)].sort((a, b) => a - b).join('/')})`);
  // (4) FIRST VOLLEY — the engine's median first launch must come no later than the server's slowest rep + FIRST_TOL
  // (target acquisition and the first draw/charge are random; this catches a mob that is minutes slow to open fire).
  const eFirst = med(runs.map((r) => r.shots.length ? r.shots[0] : T));
  if (s.firstMax !== null && eFirst > s.firstMax + FIRST_TOL) out.push(`${sc.id}: first volley by tick ${s.firstMax} on the server (every rep), engine ${eFirst}`);
  if (sc.effect) { const eE = runs.filter((r) => r.eff).length * 2 >= runs.length; if (eE !== s.eff) out.push(`${sc.id}: server ${s.eff ? 'applies' : 'never applies'} ${sc.effect}, engine ${eE ? 'does' : 'does not'}`); }
  return out;
}

const reds = []; let pass = 0; const SV = {}, EN = {};
console.log(`rangedrefcheck — mob ranged vs the real 1.18.2 server (${Object.keys(golden.cases).length} scenes, ${golden.generatedAt})`);
for (const sc of SCENES) {
  const g = golden.cases[sc.id];
  if (!g) { reds.push(`${sc.id}: no golden case (rerun runranged.mjs)`); continue; }
  SV[sc.id] = serverSummary(g);
  EN[sc.id] = Array.from({ length: REPS }, (_, r) => engineRun(sc, r));
  const bad = compare(sc, SV[sc.id], EN[sc.id]);
  if (bad.length) reds.push(...bad); else pass++;
  if (VERBOSE) console.log(`  ${sc.id.padEnd(16)} server cycle ${SV[sc.id].cycle} dmg ${[...SV[sc.id].dmg].join('/')} | engine ${EN[sc.id].map((r) => `shots ${r.shots.join(',')} dmg ${r.dmg.join(',')}`).join(' ; ')}`);
}
for (const r of reds) console.log('  ✗ ' + r);
let breaks = 0, caught = 0;
const brk = (name, fired) => { breaks++; if (fired) caught++; else reds.push(`anti-vacuity: break "${name}" was NOT caught`); };
const sk = SCENES.find((s) => s.id === 'skeleton@hard'), st = SCENES.find((s) => s.id === 'stray@normal');
if (SV[sk.id]) {
  const base = compare(sk, SV[sk.id], EN[sk.id]).join();
  brk('golden skeleton@hard cycle +20', compare(sk, Object.assign({}, SV[sk.id], { cycle: SV[sk.id].cycle + 20 }), EN[sk.id]).join() !== base);
  brk('golden skeleton@hard mean damage +1', compare(sk, Object.assign({}, SV[sk.id], { mean: SV[sk.id].mean + 1 }), EN[sk.id]).join() !== base);
  brk('golden skeleton@hard first volley forged 100 ticks earlier', compare(sk, Object.assign({}, SV[sk.id], { firstMax: SV[sk.id].firstMax - 100 }), EN[sk.id]).join() !== base);
}
if (SV[st.id]) {
  const base = compare(st, SV[st.id], EN[st.id]).join();
  brk('golden stray@normal Slowness flipped', compare(st, Object.assign({}, SV[st.id], { eff: !SV[st.id].eff }), EN[st.id]).join() !== base);
}
console.log(`rangedrefcheck: ${pass}/${SCENES.length} scenes match, ${reds.length} red · anti-vacuity ${caught}/${breaks}`);
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${reds.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(reds.length ? 1 : 0);
