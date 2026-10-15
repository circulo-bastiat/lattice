#!/usr/bin/env node
// spawnerrefcheck.mjs — infra I6 (s150): the MOB SPAWNER vs the real 1.18.2 server (golden: runspawner.mjs,
// spawner.json; rooms: spawnerscen.mjs). The engine side is `Spawn.tickSpawner` (07l_spawn.js — BaseSpawner.
// serverTick) driving a spawner block entity made by the engine's own `BlockEntities.create(…, 'mob_spawner')`
// (07c_blockentity.js: Delay 20, 200..800, 4 a batch, range 4, 6 nearby — the check owns none of them; only
// the scenario's own NBT RequiredPlayerRange is set), in the SAME room (cell-map world: stone shell, floor,
// the strip, the lamp's block light spread one level per block through the open interior, open rooms at sky
// 15), ENG_REPS rooms per scenario, T ticks each; spawned mobs counted and removed every tick except in keep
// rooms, exactly as the server's tick function does; the atcap rooms carry the 80 un-persistent pen zombies.
// Compared per scenario: the count at each checkpoint and the first-spawn tick, server mean (its rooms) vs
// engine mean, tolerance 4 engine-sd / sqrt(server rooms) + a small floor; an engine that never spawns
// (sd 0) demands the server's exact 0.
// Anti-vacuity (D-30/D-305): maxNearbyEntities 6 -> 3, and every placement allowed, must each break a lane
// that matches today.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { ALL_SCEN as SCEN, Y, T, CHECKPOINTS, RANGE, PEN, floorAt } from './spawnerscen.mjs';

const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'spawner.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'spawner.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('spawnerrefcheck: SKIP (golden not generated -- run node tools/referee/runspawner.mjs)'); process.exit(0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');

const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js', '14e_gamemode.js', '14i_hand.js', '14_player.js', '07c_blockentity.js'];
const MOB_MODS = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
const M = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });

// ── the room, in a cell map (one room at a time, spawner at (0, Y, 0)) ──────────────────────────────
const cells = new Map();
const key = (x, y, z) => x + ',' + y + ',' + z;
let room = null;
const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); } };
w.getBlock = w.get; w.setBlock = w.set;
const inside = (x, y, z) => Math.abs(x) <= 4 && Math.abs(z) <= 4 && y >= Y - 1 && y <= Y + 2;
w.getLight = (x, y, z) => {
  const s = room.s;
  let sky = 0, blk = 0;
  if (!s.sealed && ((inside(x, y, z) || (Math.abs(x) <= 4 && Math.abs(z) <= 4 && y >= Y + 3)) || y > Y + 3)) sky = 15;
  if (s.lamp && inside(x, y, z)) blk = Math.max(0, s.lamp - (Math.abs(x) + Math.abs(y - (Y + 2)) + Math.abs(z)));
  return (sky << 4) | blk;
};
w.canSeeSky = (x, y, z) => ((w.getLight(x, y, z) >> 4) & 15) >= 15;
// SpawnHelper's spawningChunkCount: a full 17x17 of ticking chunks (simulation distance 8, the game's default)
w.chunks = new Map();
for (let cx = -8; cx <= 8; cx++) for (let cz = -8; cz <= 8; cz++) w.chunks.set(cx + ',' + cz, { cx, cz });
w.loadedAt = () => true; w.tickingAt = () => true;
M.World = Object.assign(M.World || {}, w);
if (M.Behave && M.Behave.init) M.Behave.init(M.World);
M.Physics.shapeAt = (x, y, z) => { const id = w.get(Math.floor(x), Math.floor(y), Math.floor(z)); return id && M.States.solid[id] === 1 ? M.Physics.shapesFor(id) : null; };
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.EntityList.init(); M.Ai.init();
if (M.Passive && M.Passive.init) M.Passive.init();
M.Player.init();
M.Gamemode.set(M.Player, M.Gamemode.CREATIVE);
if (M.Diff && M.Diff.set) M.Diff.set('normal');
M.Spawn.init(); M.Spawn.ready = true;
M.BlockEntities.init();
if (M.Sky) { M.Sky.darknessNow = () => 0; M.Sky.isThundering = () => false; }
const { EntityList: EL, Spawn: Sp, States: S } = M;
const P = M.Player;
let seed = 0x5a3e11;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
Math.random = rng; EL.random = rng;
const ENG_REPS = 40;
let beTweak = null;

function build(s) {
  cells.clear();
  const stone = S.stateOf('stone');
  for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) for (let y = Y - 2; y <= Y + 3; y++) {
    const shell = Math.abs(x) === 5 || Math.abs(z) === 5 || y === Y - 2 || (y === Y + 3 && s.sealed);
    if (shell) w.set(x, y, z, stone);
  }
  for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) w.set(x, Y - 2, z, S.stateOf(floorAt({ s, X: 0 }, x, z)));
  w.set(0, Y, 0, S.stateOf('spawner'));
}

function engineRun(s) {
  const n = CHECKPOINTS.map(() => []), first = [];
  seed = 0x5a3e11;
  for (let rep = 0; rep < ENG_REPS; rep++) {
    room = { s };
    build(s);
    EL.list.length = 0;
    const pen = [];
    if (s.atcap) for (let i = 0; i < PEN.n; i++) { const z = EL.spawn('zombie', 400 + (i % 8), Y, 400 + Math.floor(i / 8)); if (z) { z.persistent = false; pen.push(z); } }
    P.x = 0.5; P.y = Y + 6; P.z = 16.5;
    const be = M.BlockEntities.create(0, Y, 0, 'mob_spawner');
    be.entity = s.mob; be.requiredPlayerRange = s.range || RANGE;
    if (beTweak) beTweak(be);
    let count = 0, f = -1;
    for (let t = 1; t <= T; t++) {
      // the server's tick function runs at the START of tick t, over what the spawner did in tick t-1
      const mine = EL.list.filter((e) => !e.removed && e.type === s.mob && !pen.includes(e) && Math.abs(e.x) < 6 && Math.abs(e.z) < 6);
      if (s.keep) { if (mine.length && f < 0) f = t; }
      else if (mine.length) {
        count += mine.length; if (f < 0) f = t;
        for (const e of mine) { e.removed = true; EL.list.splice(EL.list.indexOf(e), 1); }
      }
      const ci = CHECKPOINTS.indexOf(t);
      if (ci >= 0) n[ci].push(s.keep ? mine.length : count);
      Sp.tickSpawner(be);
    }
    first.push(f);
  }
  return { n, first };
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
function evaluate() {
  const rows = [];
  const runs = SCEN.map((s) => (golden.cases[s.id] ? engineRun(s) : null));
  const pos = (a) => a.filter((x) => x >= 0);
  var F0s = Math.min(...SCEN.flatMap((s) => (golden.cases[s.id] ? pos(golden.cases[s.id].first) : [])));
  var F0e = Math.min(...runs.flatMap((r) => (r ? pos(r.first) : [])));
  for (const [si, s] of SCEN.entries()) {
    const g = golden.cases[s.id];
    if (!g) continue;
    const e = runs[si];
    const bad = [], ns = g.n.length;
    CHECKPOINTS.forEach((cp, ci) => {
      const gs = g.n.map((r) => r[ci]), es = e.n[ci];
      const me = mean(es), ms = mean(gs), tol = 4 * sd(es) / Math.sqrt(ns) + (sd(es) ? 1.5 : 0);
      if (!(Math.abs(ms - me) <= tol)) bad.push(`t${cp}: server ${gs.join('/')} engine mean ${me.toFixed(1)}`);
    });
    // first spawn: which rooms spawned at all must agree, and the share of rooms whose first spawn came within 5
    // ticks of the earliest first spawn that side ever shows (so the two clocks' 1-2 tick offset cancels) — a
    // spawner that retries a failed batch next tick is 'fast' in nearly every room; one that re-rolls 200..799 is not.
    const gf = g.first.filter((x) => x >= 0), ef = e.first.filter((x) => x >= 0);
    if (!gf.length !== !ef.length) bad.push(`first spawn: server ${g.first.join('/')} engine ${ef.length}/${e.first.length} rooms spawned`);
    else if (gf.length) {
      const ps = gf.filter((x) => x <= F0s + 5).length / gf.length, pe = ef.filter((x) => x <= F0e + 5).length / ef.length;
      const tol = 3 * Math.sqrt(pe * (1 - pe) / gf.length) + 1.5 / gf.length;
      if (!(Math.abs(ps - pe) <= tol)) bad.push(`first spawn within 5 ticks of the earliest: server ${(ps * 100).toFixed(0)}% (${g.first.join('/')}) engine ${(pe * 100).toFixed(0)}%`);
    }
    const last = CHECKPOINTS.length - 1;
    rows.push({ id: s.id, ok: !bad.length, msg: bad.length ? bad.join('; ') : `end server ${g.n.map((r) => r[last]).join('/')} engine ${mean(e.n[last]).toFixed(1)}, first ${g.first.join('/')} vs engine mean ${ef.length ? mean(ef).toFixed(1) : '-'} (earliest ${F0s}/${F0e})` });
  }
  return rows;
}

let failed = 0;
const rows = evaluate();
for (const r of rows) { if (!r.ok) failed++; if (!r.ok || VERBOSE) console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.id.padEnd(14)} ${r.msg}`); }
const okIds = rows.filter((r) => r.ok).map((r) => r.id);
let av = 0, avPass = 0;
function breakAndCatch(label, set, restore) {
  av++; set();
  const broke = evaluate().filter((r) => okIds.includes(r.id) && !r.ok).length;
  restore();
  if (broke > 0) avPass++; else { failed++; console.log(`  FAIL anti-vacuity ${label}: no matching lane caught it`); }
}
breakAndCatch('maxNearbyEntities 6 -> 3', () => { beTweak = (be) => { be.maxNearbyEntities = 3; }; }, () => { beTweak = null; });
{ const f = Sp.checkPlacement; breakAndCatch('every placement allowed', () => { Sp.checkPlacement = () => true; }, () => { Sp.checkPlacement = f; }); }
if (golden.notes && golden.notes.length) console.log('  golden notes: ' + golden.notes.filter((x) => !/^t\d/.test(x)).slice(0, 4).join(' | '));
console.log(`spawnerrefcheck: ${okIds.length}/${rows.length} scenarios match the server, anti-vacuity ${avPass}/${av} -- ${failed} failed`);
console.log(` assertions passed .... ${okIds.length + avPass}`);
console.log(` failures ........... ${failed}`);
console.log(` breaks caught ...... ${avPass}`);
process.exit(failed ? 1 : 0);
