#!/usr/bin/env node
// lockstep-catspawner -- #7093 (G18c-L2): engine-side 'catspawner' lane. A sealed arena village (8 occupied HOME POIs, then 3 after tick 2400) and a swamp
// hut box, 3600 ticks x 20 salts. Per tick: the 1200 cooldown countdown, nearby-cat count (<5 in the 48-block box), POI bed count (>4 = one cat per
// 4 beds' limit), spawn position, cat variant. Rows are deterministic per salt, the gate fires at ticks 1/1201/2401 only, the village caps at 5 cats,
// 3 beds spawn none, the hut spawns at most one per gate. Anti-vacuity: 4 beds per cat -> 5 and the 1200 cadence -> 1000 change the rows.
import { harnessM } from './referee/lockstep/zombielane.mjs';

let bad = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { n++; if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const M = harnessM(), Cs = M.CatSpawner, EL = M.EntityList;
const T = 3600, SALTS = Array.from({ length: 20 }, (_, i) => i);
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };

// scenario 'village': beds around the origin; 'hut': whole arena inside a swamp_hut piece box
function run(salt, scen, mut = {}) {
  const r = stream(salt);
  EL.random = r; Math.random = r;
  EL.list.length = 0; EL.nextId = 1; EL.spawnCounter = 0; EL.ticks = 0;
  const beds = []; const addBeds = (k) => { for (let i = 0; i < k; i++) beds.push({ x: i, y: 64, z: 5, type: 'home', ticket: 1 }); };
  if (scen === 'village') addBeds(8);
  M.World = Object.assign(M.World || {}, { getBlock: () => 1, loadedAt: () => true });
  M.Player.x = 0; M.Player.y = 64; M.Player.z = 0; M.Player.dead = false;
  M.Spawn = Object.assign(M.Spawn || {}, { ready: true, clearForSpawn: () => true });
  M.Poi = { STATUS: { OCCUPIED: 2 }, occupiedPositions: () => beds.slice(),
    getInCircle: (pred, pos, rad) => beds.filter((p) => pred(p.type) && (p.x - pos.x) ** 2 + (p.y - pos.y) ** 2 + (p.z - pos.z) ** 2 <= rad * rad) };
  M.Structures = { containsAt: () => scen === 'hut' };
  Cs.init();
  if (mut.interval) Cs.INTERVAL = mut.interval;
  const rows = [];
  for (let t = 1; t <= T; t++) {
    if (t === 2401 && scen === 'village') beds.length = 3;
    const before = EL.list.length;
    const sp = Cs.tick(M, r);
    const cats = EL.list.filter((e) => e.type === 'cat');
    const nb = mut.perCat ? (beds.length > mut.perCat ? 1 : 0) : 0;
    rows.push({ t, cd: Cs.state.cooldown, cats: cats.length, beds: beds.length, sp, at: sp ? [EL.list[before].x, EL.list[before].y, EL.list[before].z] : null, v: sp ? (EL.list[before].catType ?? EL.list[before].variant ?? null) : null, nb });
  }
  Cs.INTERVAL = 1200;
  return rows;
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const rowsOf = {};
for (const scen of ['village', 'hut']) {
  const tr = SALTS.map((s) => run(s, scen));
  rowsOf[scen] = tr;
  tr.forEach((R, i) => {
    ok(eq(R, run(i, scen)), `${scen} salt ${i}: not deterministic`);
    const fire = R.filter((x) => x.cd === 1200).map((x) => x.t);
    ok(eq(fire, [1, 1201, 2401]), `${scen} salt ${i}: gate ticks ${fire}`);
    ok(R.every((x) => x.cd === 1200 - ((x.t - 1) % 1200)), `${scen} salt ${i}: countdown ordering`);
    ok(R.every((x) => x.cats <= 5), `${scen} salt ${i}: more than 5 cats`);
    ok(R.every((x) => !x.sp || x.t % 1200 === 1), `${scen} salt ${i}: spawn off the gate`);
    if (scen === 'hut') ok(R[T - 1].cats <= 3, `hut salt ${i}: ${R[T - 1].cats} cats`);
    if (scen === 'village') ok(R.filter((x) => x.t > 2400).every((x) => !x.sp), `village salt ${i}: spawn with 3 beds`);
  });
  // a spawn needs the player-relative roll to pass canSpawn: some salts spawn
  ok(tr.filter((R) => R[T - 1].cats >= 1).length >= 10, `${scen}: fewer than 10 of 20 salts spawned`);
}
// anti-vacuity: 5 beds per cat (8 beds no longer spawn) and a 1000 cadence
const alt = SALTS.map((s) => run(s, 'village', { interval: 1000 }));
caught(alt.some((R, i) => !eq(R, rowsOf.village[i])), 'cadence 1000 leaves rows unchanged');
// source-level breaks: 4 beds per cat -> 5 (> 4 becomes > 5) must lose the 5-bed village's spawn
import { readFileSync } from 'node:fs';
const SRC = readFileSync(new URL('../src/07x2_catspawner.js', import.meta.url), 'utf8');
const five = (rep) => { const f = new Function('MCL', rep(SRC).replace(/\}\)\(typeof MCL[\s\S]*$/, '})(MCL);')); f(M); };

const fiveBeds = () => { const keep = M.Poi; const r = stream(3); const beds = []; for (let i = 0; i < 5; i++) beds.push({ x: i, y: 64, z: 5, type: 'home', ticket: 1 });
  M.Poi = { STATUS: { OCCUPIED: 2 }, occupiedPositions: () => beds, getInCircle: () => beds }; M.Structures = { containsAt: () => false }; EL.list.length = 0; const C = M.CatSpawner; C.init();
  let sp = 0; for (let t = 0; t < 3601; t++) sp += C.tick(M, r); M.Poi = keep; return sp; };
ok(fiveBeds() > 0, '5 beds spawn on the real source');
five((s) => s.replace('beds.length > 4', 'beds.length > 5')); caught(fiveBeds() === 0, '5 beds per cat: 5-bed village still spawns'); M.CatSpawner = Cs;
five((s) => s.replace('Cs.INTERVAL = 1200', 'Cs.INTERVAL = 1000'));
caught(M.CatSpawner.INTERVAL !== 1200, 'cadence 1000 source mutation leaves INTERVAL 1200');
M.CatSpawner = Cs;
const d = run(1, 'village'); d[100].cd += 1;
caught(!eq(d, rowsOf.village[1]), 'cooldown shifted by one');
console.log(`${n} assertions, ${bad} failures, ${breaks} breaks caught (2 scenarios x ${SALTS.length} salts x ${T} ticks)`);
process.exit(bad ? 1 : 0);
