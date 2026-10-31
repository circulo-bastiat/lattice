#!/usr/bin/env node
// lockstep-phantomspawn -- #7944 (G18c-L9): lockstep lane 'phantomspawn', 20 salts x 6000 ticks. A survival player awake 0 / 72000 / 144000 ticks since rest on EASY / NORMAL / HARD,
// sometimes under a roof, below sea level, or in water-blocked air; Phantom.tickSpawner compared every tick (return value, cooldown, spawn positions, random stream state) with an
// oracle re-derived from .decomp PhantomSpawner.spawn: cooldown (60+nextInt(60))*20, isHarderThan(nextFloat*3), nextInt(max(1,rest)) >= 72000, up(20+nextInt(15)), east/south -10+nextInt(21),
// isClearForSpawn, group 1+nextInt(difficultyId+1).
import { loadEngine } from './loadsrc.mjs';

let bad = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL ' + m); } };
const M = loadEngine({ extra: ['07zz1_phantom.js'], dom: false });
const Ph = M.Phantom;
const stream = (salt) => { let s = (salt * 2654435761 + 7) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const DIFFS = ['easy', 'normal', 'hard'], RESTS = [0, 72000, 144000], TICKS = 6000;
const LD = { easy: 0.9, normal: 1.8, hard: 2.7 };

// vanilla PhantomSpawner.spawn on its own stream; `env` supplies the world answers
function oracle(env) {
  let cooldown = 0;
  return (r, rest) => {
    cooldown--; if (cooldown > 0) return [];
    cooldown += (60 + Math.floor(r() * 60)) * 20;
    if (env.dark < 5) return [];
    const py = Math.floor(env.y);
    if (!(py >= 63 && env.sky)) return [];
    if (!(LD[env.diff] > r() * 3.0)) return [];
    if (!(Math.floor(r() * Math.max(1, rest)) >= 72000)) return [];
    const y = py + 20 + Math.floor(r() * 15), x = Math.floor(env.x) - 10 + Math.floor(r() * 21), z = Math.floor(env.z) - 10 + Math.floor(r() * 21);
    if (env.blocked(x, y, z)) return [];
    const g = 1 + Math.floor(r() * (DIFFS.indexOf(env.diff) + 2));
    return Array.from({ length: g }, () => [x + 0.5, y, z + 0.5]);
  };
}

function run(salt) {
  const out = { div: '', spawns: 0, rolls: 0 };
  for (const diff of DIFFS) for (const rest0 of RESTS) {
    const env = { diff, dark: 10, y: salt % 5 === 3 ? 50 : 70, x: salt * 3.2, z: -salt * 1.7, sky: salt % 4 !== 1, blocked: (x, y, z) => ((x * 31 + y * 17 + z * 7 + salt) & 3) === 0 };
    const spawned = [];
    M.Sky = { darknessNow: () => env.dark };
    M.Commands = { ruleGet: () => 'true' };
    M.Gamemode = { isSpectator: () => false };
    M.Player = { SEA_LEVEL: 63, x: env.x, y: env.y, z: env.z, timeSinceRest: rest0 };
    M.World = { canSeeSky: () => env.sky };
    M.Equip = { localDifficulty: () => LD[diff] };
    M.Diff = { LEVELS: ['peaceful', 'easy', 'normal', 'hard'], get: () => diff };
    M.Spawn = { clearForSpawn: (t, x, y, z) => !env.blocked(x, y, z) };
    const ra = stream(salt * 11 + DIFFS.indexOf(diff) * 3 + RESTS.indexOf(rest0)), rb = stream(salt * 11 + DIFFS.indexOf(diff) * 3 + RESTS.indexOf(rest0));
    M.EntityList = { ready: true, random: ra, spawn: (t, x, y, z) => { const e = { t, x, y, z }; spawned.push(e); return e; } };
    Ph.spawnCooldown = 0;
    const orc = oracle(env);
    for (let t = 0; t < TICKS; t++) {
      M.Player.timeSinceRest++;
      spawned.length = 0;
      const got = Ph.tickSpawner();
      const want = orc(rb, M.Player.timeSinceRest);
      const gotPos = spawned.map((e) => [e.x, e.y, e.z].join()).join(';'), wantPos = want.map((p) => p.join()).join(';');
      if (got !== want.length || gotPos !== wantPos || ra() !== rb()) { out.div = `salt ${salt} ${diff} rest ${rest0} tick ${t}: spawned ${got}/${want.length} ${gotPos}|${wantPos}`; return out; }
      if (want.length) out.spawns++;
    }
  }
  return out;
}

const all = () => { const r = []; for (let s = 0; s < 20; s++) r.push(run(s)); return r; };
const runs = all();
const div = runs.filter((r) => r.div).map((r) => r.div);
ok(div.length === 0, 'divergences: ' + div[0]);
ok(runs.reduce((a, r) => a + r.spawns, 0) > 10, 'lane vacuous: ' + runs.map((r) => r.spawns));
ok(JSON.stringify(run(3)) === JSON.stringify(runs[3]), 'not deterministic');

let caught = 0;
const tryBreak = (name, apply, undo) => { apply(); const x = all().some((r) => r.div); undo(); n++; if (x) caught++; else { bad++; console.log('NOT CAUGHT ' + name); } };
tryBreak('72000 -> 36000', () => { Ph.REST_GATE = 36000; }, () => { Ph.REST_GATE = 72000; });
const ot = Ph.tickSpawner;
tryBreak('sky ignored', () => { Ph.tickSpawner = function () { const w = M.World; const f = w.canSeeSky; w.canSeeSky = () => true; try { return ot.apply(this, arguments); } finally { w.canSeeSky = f; } }; }, () => { Ph.tickSpawner = ot; });
tryBreak('clear check ignored', () => { Ph.tickSpawner = function () { const s = M.Spawn; const f = s.clearForSpawn; s.clearForSpawn = () => true; try { return ot.apply(this, arguments); } finally { s.clearForSpawn = f; } }; }, () => { Ph.tickSpawner = ot; });
tryBreak('group size capped at 1', () => { Ph.tickSpawner = function () { const el = M.EntityList; const f = el.spawn; let c = 0; el.spawn = (...a) => (c++ ? null : f(...a)); try { return ot.apply(this, arguments); } finally { el.spawn = f; } }; }, () => { Ph.tickSpawner = ot; });
tryBreak('cooldown 1 tick', () => { Ph.tickSpawner = function () { const r = ot.apply(this, arguments); Ph.spawnCooldown = Math.min(Ph.spawnCooldown, 1200); return r; }; }, () => { Ph.tickSpawner = ot; });
console.log(`${n} assertions, ${bad} failures, phantomspawn: ${caught} breaks caught, ${div.length} divergences${div[0] ? ' ' + div[0] : ''}`);
process.exit(bad === 0 && caught === 5 ? 0 : 1);
