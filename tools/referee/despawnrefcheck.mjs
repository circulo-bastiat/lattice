#!/usr/bin/env node
// despawnrefcheck.mjs — infra I6 (s149): DESPAWNING vs the real 1.18.2 server (golden:
// rundespawn.mjs, despawn.json; lanes: despawnscen.mjs). The engine side is `Spawn.despawnTick`
// (07l_spawn.js — MobEntity.checkDespawn + the despawnCounter bumps) run over EL.spawn'd mobs
// placed in the SAME lanes (same x/y/z, same light at eye height, the player at the same spot),
// ENG_N mobs per lane, survivors counted at the same checkpoints. Nothing here owns a despawn
// number: bands, idle gate, odds and per-type kinds are the engine's own.
// Match rule per lane x checkpoint: |server share - engine share| <= 3 sigma (binomial at the
// engine share, server n) + 1.5/n — so an engine share of 0 or 1 demands the server's exactly.
// Anti-vacuity (D-30/D-305): the idle gate zeroed, and a never-despawn kind turned into a plain
// mob, must each break a lane that matches today.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { LANES, PLAYER, CHECKPOINTS, N, zOf } from './despawnscen.mjs';

const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'despawn.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'despawn.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('despawnrefcheck: golden not generated -- run node tools/referee/rundespawn.mjs (skipped)'); process.exit(0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');

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
// the lanes' light: block light `light` in each lit lane's eye-height row, 0 everywhere else, no sky
const lit = new Map();
for (const l of LANES) if (l.light) for (let z = -4; z <= 4; z++) lit.set(`${l.D},${l.y0 + 1},${z}`, l.light);
const w = { get: () => 0, set: () => {} };
w.getBlock = w.get; w.setBlock = w.set; w.tickingAt = () => true;
w.getLight = (x, y, z) => lit.get(`${x},${y},${z}`) || 0;
M.World = Object.assign(M.World || {}, w);
if (M.Behave && M.Behave.init) M.Behave.init(w);
M.EntityList.init(); M.Ai.init();
if (M.Passive && M.Passive.init) M.Passive.init();
M.Player.init();
M.Gamemode.set(M.Player, M.Gamemode.SURVIVAL);
if (M.Diff && M.Diff.set) M.Diff.set('normal');
M.Spawn.init(); M.Spawn.ready = false;
if (M.Sky) M.Sky.darknessNow = () => 0;
const { EntityList: EL, Spawn: Sp } = M;
const P = M.Player;
P.x = PLAYER.x; P.y = PLAYER.y; P.z = PLAYER.z;
let seed = 0x0de5a1;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
Math.random = rng;
const ENG_N = 400;

function engineRun() {
  seed = 0x0de5a1;
  EL.list.length = 0;
  const byLane = LANES.map((l) => {
    const mobs = [];
    for (let i = 0; i < ENG_N; i++) {
      const e = EL.spawn(l.mob, l.D + 0.5, l.y0, zOf(i % N));
      if (e) { e.persistent = false; e.despawnCounter = 0; mobs.push(e); }
    }
    return mobs;
  });
  const out = LANES.map(() => []);
  const last = CHECKPOINTS[CHECKPOINTS.length - 1];
  for (let t = 1; t <= last; t++) {
    Sp.despawnTick();
    const ci = CHECKPOINTS.indexOf(t);
    if (ci >= 0) byLane.forEach((mobs, k) => { out[k][ci] = mobs.length ? mobs.filter((e) => !e.removed && EL.list.includes(e)).length / mobs.length : NaN; });
  }
  return out;
}

function evaluate() {
  const eng = engineRun();
  const rows = [];
  LANES.forEach((l, k) => {
    const g = golden.cases[l.id];
    if (!g) return;
    const bad = [];
    CHECKPOINTS.forEach((cp, ci) => {
      const ps = g.alive[ci] / g.n, pe = eng[k][ci];
      const tol = 3 * Math.sqrt(Math.max(pe * (1 - pe), 0) / g.n) + 1.5 / g.n;
      if (!(Math.abs(ps - pe) <= tol)) bad.push(`t${cp}: server ${g.alive[ci]}/${g.n} engine ${(pe * 100).toFixed(1)}%`);
    });
    rows.push({ id: l.id, ok: bad.length === 0, msg: bad.length ? bad.join(', ') : `server ${g.alive.join('/')} of ${g.n}, engine ${eng[k].map((p) => Math.round(p * g.n)).join('/')}` });
  });
  return rows;
}

let failed = 0;
const rows = evaluate();
for (const r of rows) { if (!r.ok) failed++; if (!r.ok || VERBOSE) console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.id.padEnd(18)} ${r.msg}`); }
const okIds = rows.filter((r) => r.ok).map((r) => r.id);
let av = 0, avPass = 0;
function breakAndCatch(label, set, restore) {
  av++; set();
  const broke = evaluate().filter((r) => okIds.includes(r.id) && !r.ok).length;
  restore();
  if (broke > 0) avPass++; else { failed++; console.log(`  FAIL anti-vacuity ${label}: no matching lane caught it`); }
}
{ const k = Sp.DESPAWN_IDLE_TICKS; breakAndCatch('DESPAWN_IDLE_TICKS=0', () => { Sp.DESPAWN_IDLE_TICKS = 0; }, () => { Sp.DESPAWN_IDLE_TICKS = k; }); }
{ const t = Sp.DESPAWN_TYPES.villager, k = t[1]; breakAndCatch('villager despawns like a mob', () => { t[1] = 'mob'; }, () => { t[1] = k; }); }
if (golden.notes && golden.notes.length) console.log('  golden notes: ' + golden.notes.slice(0, 3).join(' | '));
console.log(`despawnrefcheck: ${okIds.length}/${rows.length} lanes match the server, anti-vacuity ${avPass}/${av} -- ${failed} failed`);
console.log(` assertions passed .... ${okIds.length + avPass}`);
console.log(` failures ........... ${failed}`);
console.log(` breaks caught ...... ${avPass}`);
process.exit(failed ? 1 : 0);
