#!/usr/bin/env node
// inhabitedcheck.mjs — cloud item owed-diff-owed (Diff.OWED "LocalDifficulty regional"). Proves the
// per-chunk INHABITED TIME port (src/07y_equip.js Eq.inhabited/tickInhabited/inhabitedAt) and that
// `Eq.localDifficulty(Eq.at(pos))` reads it the way `World.getLocalDifficulty(pos)` does
// (.decomp World.java:832-840): a loaded chunk gives its own inhabited time + the moon, an
// unloaded one 0 and 0. The tick gate is `ServerChunkManager.tickChunks` (:367-369) +
// `ThreadedAnvilChunkStorage.canTickChunk` (:950-956: non-spectator, chunk centre within 128).
// Expected values are LocalDifficulty.java's own formula at its end points (inhabited saturates at
// 3,600,000 ticks: +0.75 normal/easy-before-halving, +1.0 hard), the same shape equipcheck §3b
// already referees for the day-clock half.
//
//   node tools/inhabitedcheck.mjs [--verbose]

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERBOSE = process.argv.includes('--verbose');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); };
const near = (a, b) => Math.abs(a - b) < 1e-5;

console.log('inhabitedcheck — Chunk.inhabitedTime -> regional LocalDifficulty (Diff.OWED)');

const M = loadEngine({ extra: ['07_world.js', '09b_sky.js', '07y_equip.js', '07l_spawn.js'] });
const Eq = M.Equip, W = M.World, CH = M.CH, Diff = M.Diff;
ok(typeof Eq.tickInhabited === 'function' && typeof Eq.inhabitedAt === 'function' && typeof Eq.at === 'function',
  'Eq.tickInhabited / inhabitedAt / at exist');

W.init(1);
W.camCx = 0; W.camCz = 0;
for (let cx = -12; cx <= 12; cx++) for (let cz = -2; cz <= 2; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
M.Settings = Object.assign(M.Settings || {}, { effectiveSimDistance: () => 12 });
const P = M.Player = { x: 8, y: 64, z: 8 };
if (M.Sky) M.Sky.dayTime = 0;
Diff.set('normal');

// 1. the tick gate
Eq.inhabitedFromJSON(null);
Eq.tickInhabited(1); Eq.tickInhabited(1);
ok(Eq.inhabitedAt(0, 0) === 2, `player's own chunk gains 1 per tick — got ${Eq.inhabitedAt(0, 0)}`);
// chunk 7: centre x = 120, 112 from the player -> in; chunk 8: centre 136, 128 away -> NOT (< 16384 is strict)
ok(Eq.inhabitedAt(7 * 16, 0) === 2, 'chunk centre 112 blocks away ticks');
ok(Eq.inhabitedAt(8 * 16, 0) === 0, `chunk centre exactly 128 blocks away does NOT tick (squared < 16384) — got ${Eq.inhabitedAt(128, 0)}`);
ok(Eq.inhabitedAt(-7 * 16, 0) === 2 && Eq.inhabitedAt(-9 * 16, 0) === 0, 'negative side: -7 in, -9 out');
P.isSpectator = true; Eq.tickInhabited(1); P.isSpectator = false;
ok(Eq.inhabitedAt(0, 0) === 2, 'a spectator inhabits nothing (canTickChunk)');
const savedTick = W.tickingAt; W.tickingAt = () => false; Eq.tickInhabited(1); W.tickingAt = savedTick;
ok(Eq.inhabitedAt(0, 0) === 2, 'a chunk outside simulation distance does not tick (ServerWorld.shouldTick)');

// 2. positional LocalDifficulty (normal, world time 0, full moon: day-clock part 0.75, moon capped at g=0)
Eq.inhabitedFromJSON([[0, 0, 3600000], [-3, -2, 1800000]]);
ok(near(Eq.localDifficulty(Eq.at({ x: 5, z: 5 })), 3.0), `normal, saturated chunk: 2*(0.75+0.75) = 3.0 — got ${Eq.localDifficulty(Eq.at({ x: 5, z: 5 }))}`);
ok(near(Eq.localDifficulty(Eq.at({ x: -40, z: -20 })), 2.25), `normal, half-inhabited chunk (-3,-2): 2*(0.75+0.375) = 2.25 — got ${Eq.localDifficulty(Eq.at({ x: -40, z: -20 }))}`);
ok(near(Eq.localDifficulty(Eq.at({ x: 40, z: 5 })), 1.5), 'normal, fresh chunk: 1.5');
ok(near(Eq.clampedLocalDifficulty(Eq.at({ x: 5, z: 5 })), 0.5), 'clamped of 3.0 is 0.5');
Diff.set('hard');
ok(near(Eq.localDifficulty(Eq.at({ x: 5, z: 5 })), 5.25), `hard, saturated: 3*(0.75+1.0) = 5.25 — got ${Eq.localDifficulty(Eq.at({ x: 5, z: 5 }))}`);
Diff.set('easy');
ok(near(Eq.localDifficulty(Eq.at({ x: 5, z: 5 })), 1.125), 'easy halves the regional part: 1*(0.75+0.375)');
Diff.set('normal');
// moon: day 64 full moon, g = 0.25 -> moon adds 0.25 in a loaded chunk; an UNLOADED position reads moon 0
ok(near(Eq.localDifficulty(Object.assign({ time: 1536000 }, Eq.at({ x: 40, z: 5 }))), 2.5), 'loaded chunk, day 64 full moon: 2*(0.75+0.25+0.25) = 2.5');
ok(near(Eq.localDifficulty(Object.assign({ time: 1536000 }, Eq.at({ x: 40, z: 500 }))), 2.0), 'UNLOADED position: inhabited 0 and moon 0 -> 2*(0.75+0.25) = 2.0');
ok(Eq.at(null) === undefined && near(Eq.localDifficulty(Eq.at(null)), 1.5), 'no position: the global value (old behaviour)');
ok(near(Eq.localDifficulty({ x: 5, z: 5, inhabited: 0 }), 1.5), 'an explicit inhabited override still wins (tests)');

// 3. save round trip, negative coordinates included
const saved = Eq.inhabitedToJSON();
Eq.inhabitedFromJSON(null);
ok(Eq.inhabitedAt(5, 5) === 0, 'a new world clears every chunk');
Eq.inhabitedFromJSON(JSON.parse(JSON.stringify(saved)));
ok(Eq.inhabitedAt(5, 5) === 3600000 && Eq.inhabitedAt(-40, -20) === 1800000, `round trip keeps (0,0) and (-3,-2) — got ${JSON.stringify(saved)}`);
Eq.inhabitedFromJSON([[1, 1, 'x'], [2, 2, -5], 'junk']);
ok(Eq.inhabited.size === 0, 'garbage records are dropped');

// 4. the joins (rule 7): the world tick drives it, the save carries it, the readers pass a position
const src = (f) => readFileSync(join(ROOT, 'src', f), 'utf8');
ok(/NS\.Equip\.tickInhabited\(1\)/.test(src('17_main.js')), '17_main.js worldTick calls Eq.tickInhabited');
ok(/inhabited:\s*\(NS\.Equip/.test(src('16b_save.js')) && /inhabitedFromJSON\(o\.inhabited\)/.test(src('16b_save.js')), '16b_save.js saves and loads it');
for (const [f, re] of [['07y_equip.js', /clampedLocalDifficulty\(Eq\.at\(e\)\)/], ['07zk_undead.js', /huskHungerDuration\(e\)/],
  ['07v_spell.js', /difficultyAboveEasy\(e\)/], ['07zzc_lightning.js', /approxLocalDifficulty\(pos\)/], ['07zd_slime.js', /Eq\.at\(e\)/],
  ['07i_entitylist.js', /NS\.Equip\.at\(e\)/], ['07zz1_phantom.js', /localDifficulty\(\{ x: P\.x, z: P\.z \}\)/]])
  ok(re.test(src(f)), `${f} passes the position to LocalDifficulty`);
ok(!/inhabitedTime[^\n]*always 0/.test(src('07y_equip.js')), 'Eq.OWED no longer names the inhabited-time gap');

// anti-vacuity: each break must change what the checks above observe
Eq.inhabitedFromJSON([[0, 0, 3600000]]);
{ const k = W.key(0, 0), v = Eq.inhabited.get(k); Eq.inhabited.delete(k); Eq.inhabited.set(W.key(1, 0), v);
  okAv(!near(Eq.localDifficulty(Eq.at({ x: 5, z: 5 })), 3.0), 'inhabited time filed under the WRONG chunk is caught'); }
Eq.inhabitedFromJSON([[0, 0, 3600000]]);
{ const L = W.loadedAt; W.loadedAt = () => false;
  okAv(!near(Eq.localDifficulty(Eq.at({ x: 5, z: 5 })), 3.0), 'an unloaded-chunk read (0) is distinguishable from a loaded one'); W.loadedAt = L; }
{ Eq.inhabitedFromJSON(null); const px = P.x; P.x = 8 + 16 * 20; Eq.tickInhabited(1); P.x = px;
  okAv(Eq.inhabitedAt(0, 0) === 0, 'a player 320 blocks away does not inhabit chunk (0,0) — the distance gate can fire'); }

console.log(`  ${pass} passed, ${fails.length} failed, ${breaks} anti-vacuity breaks`);
if (fails.length) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
console.log('OK');
