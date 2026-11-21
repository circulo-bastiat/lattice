#!/usr/bin/env node
// ranged2refcheck.mjs — infra I6 (s151, 25 Sept 2026): MOB RANGED II (witch, blaze, trident drowned, evoker, illusioner
// shooting/casting at a still survival player DIST blocks down a walled lane) vs the real 1.18.2 server (golden:
// runranged2.mjs, mob-ranged2.json — recorded by a datapack tick function, exact ticks; scenes: ranged2scen.mjs).
// The engine: the same lane in a cell map, the REAL player (SURVIVAL, Resistance IV + Fire Resistance), the mob via
// EL.spawn (AI on; the drowned handed a trident, as the server's HandItems summon), `EL.tick` T times x REPS seeds.
// Compared per scene: (1) VOLLEY CYCLE — median gap between volley starts (shots < VOLLEY_GAP apart are one volley),
// +-TOL; (2) FIRST VOLLEY within the server's rep range +-FIRST_TOL; (3) VOLLEY SIZE (blaze 3 fireballs, evoker fangs
// per cast); (4) evoker VEX count; (5) witch's first three potion kinds (the WitchEntity.attack choice at 10 blocks);
// (6) illusioner Blindness; ghast + snow golem (vs a pinned NoAI zombie, re-pinned every engine tick) on cycle/first/size iff the server's. Mismatches are FINDINGS (red, exit 1). No golden -> SKIP.
// Anti-vacuity (D-30/D-305): forged golden cycle/vex/potion-order/first-volley values must each flip the verdict.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';

const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');

let seed = 0x0c4a5e02;
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
w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 0; w.tickingAt = () => true; w.biomeAt = () => M.Biomes.index('plains');   // the server's flat world is all plains
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

import { T, REPS, DIST, SCENES, summarize } from './ranged2scen.mjs';
const VERBOSE = process.argv.includes('--verbose');
const TOL = 4, FIRST_TOL = 30;
const GOLD = [join(refDir, 'golden', 'mob-ranged2.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'mob-ranged2.json')].find((f) => existsSync(f));
if (!GOLD) { console.log('ranged2refcheck: SKIP (golden not generated -- run node tools/referee/runranged2.mjs)'); process.exit(0); }
const golden = JSON.parse(readFileSync(GOLD, 'utf8'));
const med = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };

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
  if (sc.open) cells.clear(); else buildLane();
  if (sc.open) { const stone = S.stateOf('stone'); for (let x = -24; x <= 40; x++) for (let z = -24; z <= 24; z++) w.set(x, -1, z, stone); }
  EL.list.length = 0;
  M.Diff.set('normal');
  P.x = 0.5; P.y = 0; P.z = 0.5; P.vx = P.vy = P.vz = 0; P.dead = false; P.effects = {};
  P.health = P.maxHealth || 20;
  if (M.Effects && M.Effects.add) { try { M.Effects.add(P, 'resistance', 20000, 3); M.Effects.add(P, 'fire_resistance', 20000, 0); } catch (e) { /* engine without add */ } }
  const tg = sc.target ? EL.spawn(sc.target.mob, sc.target.at + 0.5, 0, 0.5) : null;
  if (tg) tg.persistent = true;
  const e = EL.spawn(sc.mob, (sc.dist || DIST) + 0.5, sc.up || 0, 0.5);
  if (!e) return { err: 'EL.spawn gives nothing', shots: [] };
  e.persistent = true;
  if (sc.hand) M.Equip.setEquipped(e, M.Items.MAINHAND, M.Equip.stackOf(sc.hand));
  const seen = new Set(), shots = [];
  let blind = false;
  for (let t = 0; t < T; t++) {
    P.x = 0.5; P.y = 0; P.z = 0.5; P.vx = P.vz = 0;
    if (tg) { tg.x = sc.target.at + 0.5; tg.y = 0; tg.z = 0.5; tg.vx = tg.vy = tg.vz = 0; tg.health = tg.maxHealth; tg.target = null; }
    EL.tick();
    if (P.invulnerable > 0) P.invulnerable--;
    if (M.Effects && M.Effects.tick) M.Effects.tick(P);
    for (const q of EL.list) if (!seen.has(q) && sc.kinds.includes(q.type)) { seen.add(q); shots.push([t + 1, q.type, q.type === 'potion' ? String(q.potionId || '?') : null]); }
    if (sc.blind && M.Effects.hasStatusEffect(P, 'blindness')) blind = true;
    if (P.health < 12) P.health = P.maxHealth || 20;
    P.dead = false;
    if (e.removed || e.dead) break;
  }
  return { shots, blind, sum: summarize(sc, shots), err: null };
}

// The server's truth per scene, pooled over reps.
function serverSummary(sc, g) {
  const sums = g.reps.map((r) => r.sum);
  const allGaps = sums.flatMap((s) => s.gaps);
  const seq = (r) => r.shots.filter((s) => s[1] === 'potion').slice(0, 3).map((s) => s[2]).join(',');
  const seqs = g.reps.map(seq);
  const seqMaj = seqs.find((q) => seqs.filter((x) => x === q).length * 2 > seqs.length) || null;
  return {
    cycle: med(allGaps), firstMin: Math.min(...sums.map((s) => s.first ?? T)), firstMax: Math.max(...sums.map((s) => s.first ?? T)),
    sizeMin: Math.min(...sums.map((s) => s.medSize ?? 0)), sizeMax: Math.max(...sums.map((s) => s.medSize ?? 0)),
    vex: sc.kinds.includes('vex') ? Math.min(...sums.map((s) => s.counts.vex || 0)) : null, vexMax: sc.kinds.includes('vex') ? Math.max(...sums.map((s) => s.counts.vex || 0)) : null,
    seq: sc.kinds[0] === 'potion' ? seqMaj : null, blind: g.reps.filter((r) => r.blind).length * 2 > g.reps.length,
  };
}
function engineSummary(sc, runs) {
  const seqs = runs.map((r) => r.shots.filter((s) => s[1] === 'potion').slice(0, 3).map((s) => s[2]).join(','));
  return { cycle: med(runs.flatMap((r) => r.sum.gaps)), first: med(runs.map((r) => r.sum.first ?? T)), size: med(runs.map((r) => r.sum.medSize ?? 0)),
    vex: med(runs.map((r) => r.sum.counts.vex || 0)), seqs, blind: runs.filter((r) => r.blind).length * 2 > runs.length };
}
function compare(sc, s, en) {
  const out = [];
  if (s.cycle === null) out.push(`${sc.id}: server never volleyed twice (harness)`);
  else if (en.cycle === null) out.push(`${sc.id}: server volleys every ${s.cycle} ticks, engine never volleys twice in ${T} ticks (first ${en.first})`);
  else if (Math.abs(en.cycle - s.cycle) > TOL) out.push(`${sc.id}: server volleys every ${s.cycle} ticks, engine every ${en.cycle}`);
  if (en.first > s.firstMax + FIRST_TOL || en.first < s.firstMin - FIRST_TOL) out.push(`${sc.id}: first volley at tick ${s.firstMin}..${s.firstMax} on the server, engine ${en.first}`);
  if (s.cycle !== null && en.cycle !== null && (en.size < s.sizeMin - 2 || en.size > s.sizeMax + 2 || (s.sizeMin === s.sizeMax && en.size !== s.sizeMin)))
    out.push(`${sc.id}: ${sc.kinds[0]} per volley ${s.sizeMin}..${s.sizeMax} on the server, engine ${en.size}`);
  if (s.vex !== null && (en.vex < s.vex || en.vex > s.vexMax)) out.push(`${sc.id}: ${s.vex}..${s.vexMax} vexes summoned in ${T} ticks on the server, engine ${en.vex}`);
  if (s.seq !== null && !en.seqs.every((q) => q === s.seq)) out.push(`${sc.id}: first three potions ${s.seq} on the server, engine ${en.seqs.join(' | ')}`);
  if (sc.blind && en.blind !== s.blind) out.push(`${sc.id}: server ${s.blind ? 'blinds' : 'never blinds'} the player, engine ${en.blind ? 'does' : 'does not'}`);
  return out;
}

const reds = []; let pass = 0; const SV = {}, EN = {};
console.log(`ranged2refcheck — witch/blaze/drowned trident/evoker/illusioner/ghast/snow golem vs the real 1.18.2 server (${golden.generatedAt})`);
for (const sc of SCENES) {
  const g = golden.cases[sc.id];
  if (!g) { reds.push(`${sc.id}: no golden case (rerun runranged2.mjs)`); continue; }
  SV[sc.id] = serverSummary(sc, g);
  const runs = Array.from({ length: REPS }, (_, r) => engineRun(sc, r));
  if (runs.some((r) => r.err)) { reds.push(`${sc.id}: ${runs.find((r) => r.err).err}`); continue; }
  EN[sc.id] = engineSummary(sc, runs);
  const bad = compare(sc, SV[sc.id], EN[sc.id]);
  if (bad.length) reds.push(...bad); else pass++;
  if (VERBOSE) console.log(`  ${sc.id.padEnd(16)} server ${JSON.stringify(SV[sc.id])}\n  ${''.padEnd(16)} engine ${JSON.stringify(EN[sc.id])} shots ${runs.map((r) => r.shots.map((s) => s[0] + (s[2] ? '/' + s[2] : '')).join(',')).join(' ; ')}`);
}
for (const r of reds) console.log('  ✗ ' + r);
// Anti-vacuity (D-30/D-305): forged golden values against the engine's REAL summaries — each must change the verdict.
let breaks = 0, caught = 0;
const brk = (name, id, forge) => {
  const sc = SCENES.find((s) => s.id === id); if (!SV[id] || !EN[id]) return;
  breaks++;
  const base = compare(sc, SV[id], EN[id]).join(), f = compare(sc, Object.assign({}, SV[id], forge(SV[id])), EN[id]).join();
  if (f !== base) caught++; else reds.push(`anti-vacuity: break "${name}" was NOT caught`);
};
brk('golden illusioner cycle +20', 'illusioner', (s) => ({ cycle: s.cycle + 20 }));
brk('golden evoker vex count +9', 'evoker', (s) => ({ vex: s.vex + 9, vexMax: s.vexMax + 9 }));
brk('golden witch potion order reversed', 'witch', (s) => ({ seq: s.seq ? s.seq.split(',').reverse().join(',') : 'x' }));
brk('golden blaze first volley 200 ticks later', 'blaze', (s) => ({ firstMin: s.firstMin + 200, firstMax: s.firstMax + 200 }));
console.log(`ranged2refcheck: ${pass}/${SCENES.length} scenes match, ${reds.length} red · anti-vacuity ${caught}/${breaks}`);
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${reds.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(reds.length ? 1 : 0);
