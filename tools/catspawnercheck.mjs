#!/usr/bin/env node
// catspawnercheck.mjs — #1701: src/07x2_catspawner.js against CatSpawner.java on a synthetic world.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'src/07x2_catspawner.js'), 'utf8');
let cadence = null;
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

function seeded(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// A world where `beds` occupied HOME POIs sit around the origin, `cats` cats are already there,
// and `hut` says whether every column is inside a swamp hut.
function run(src, { beds, cats, hut, spawnOn = true, blanket = false, one = false, hole = false }) {
  const NS = {};
  new Function('NS', src.replace(/\}\)\(typeof MCL[\s\S]*$/, '})(NS);').replace('(function (NS) {', '(function (NS) {'))(NS);
  const list = [];
  for (let i = 0; i < cats; i++) list.push({ type: 'cat', x: 3 + i, y: 64, z: 3, dead: false });
  if (blanket) for (let gx = -48; gx <= 48; gx += 16) for (let gz = -48; gz <= 48; gz += 16) list.push({ type: 'cat', x: gx, y: 64, z: gz, dead: false });
  if (one) list.push({ type: 'cat', x: -31, y: 64, z: -31, dead: false });
  const poi = [];
  for (let i = 0; i < beds; i++) poi.push({ x: i, y: 64, z: 5, type: 'home', ticket: 1 });
  NS.World = { getBlock: () => 1, loadedAt: (x, z) => !(hole && ((x >> 4) & 1)) };
  NS.Player = { x: 0, y: 64, z: 0 };
  NS.Spawn = { ready: spawnOn, clearForSpawn: () => true };
  NS.Poi = { STATUS: { OCCUPIED: 2 }, occupiedPositions: () => poi.slice(),
    getInCircle: (pred, pos, r) => poi.filter((p) => pred(p.type) && (p.x - pos.x) ** 2 + (p.y - pos.y) ** 2 + (p.z - pos.z) ** 2 <= r * r) };
  NS.Structures = { containsAt: () => hut };
  NS.EntityList = { list, spawn: (t, x, y, z) => { const e = { type: t, x, y, z }; list.push(e); return e; } };
  NS.CatSpawner.init();
  const rand = one ? () => 0.99 : seeded(7);
  let spawned = 0;
  for (let t = 0; t < 1201; t++) spawned += NS.CatSpawner.tick(NS, rand);
  cadence = NS.CatSpawner.state.cooldown;   // after 3600 ticks: 3 cycles done, cooldown re-armed at 1200 then 1 tick later
  return spawned;
}

function all(src) {
  const r = [];
  const first = run(src, { beds: 5, cats: 0, hut: false }) > 0, cd = cadence;
  r.push(['5 beds, 0 cats spawns', first]);
  r.push(['middle chunk unloaded refuses', run(src, { beds: 5, cats: 0, hut: false, hole: true }) === 0]);
  r.push(['5 beds, 4 cats spawns', run(src, { beds: 5, cats: 4, hut: false }) > 0]);
  r.push(['5 beds, 5 cats refuses', run(src, { beds: 5, cats: 5, hut: false }) === 0]);
  r.push(['4 beds refuses', run(src, { beds: 4, cats: 0, hut: false }) === 0]);
  r.push(['swamp hut spawns exactly when no cat', run(src, { beds: 0, cats: 0, hut: true }) > 0]);
  r.push(['swamp hut with exactly one cat nearby refuses', run(src, { beds: 0, cats: 0, hut: true, one: true }) === 0]);
  r.push(['swamp hut with a cat refuses', run(src, { beds: 0, cats: 0, hut: true, blanket: true }) === 0]);
  r.push(['open field refuses', run(src, { beds: 0, cats: 0, hut: false }) === 0]);
  r.push(['doMobSpawning off refuses', run(src, { beds: 5, cats: 0, hut: false, spawnOn: false }) === 0]);
  r.push(['cooldown re-arms to 1200 (' + cd + ' left)', cd === 1200]);
  return r;
}
const bad = (src) => all(src).filter(([, c]) => !c).map(([m]) => m);
const base = bad(SRC);
if (base.length) base.forEach((m) => fails.push(m)); else pass += 11;
for (const [from, to] of [['> 4 &&', '> 3 &&'], ['< 5) return', '< 6) return'], ['< 1 ? spawnCat', '< 2 ? spawnCat'],
  ['Cs.state.cooldown = Cs.INTERVAL', 'Cs.state.cooldown = 0'], ['NS2.Spawn.ready === false', 'false']]) {
  breaks++;
  if (!SRC.includes(from)) { fails.push('break target missing: ' + from); continue; }
  if (bad(SRC.replace(from, to)).length) { pass++; console.log('   ✓ break caught: ' + from); } else fails.push('break not caught: ' + from);
}
for (const f of fails) console.log('   ✗ ' + f);
console.log(`${fails.length ? 'FAIL' : 'PASS'} catspawnercheck: ${pass} assertions, ${breaks} breaks caught, ${fails.length} failure(s)`);
console.log(`${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
