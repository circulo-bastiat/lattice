// lockstep-insomnia -- #6853 (G17-L152): PhantomSpawner cooldown, TIME_SINCE_REST >= 72000 roll, band 20..34 up, group 1+nextInt(diff+1), 20 salts.
import { loadEngine } from '../loadsrc.mjs';
const M = loadEngine({ extra: ['07zz1_phantom.js'], dom: false, initReg: true });
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const ni = (r, n) => Math.floor(r() * n);
const Ph = M.Phantom;
let fails = 0, breaks = 0, spawnsSeen = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const LEVELS = ['peaceful', 'easy', 'normal', 'hard'];
// Reference = PhantomSpawner.spawn, vanilla draw order. The sleep reset happens at tick 'sleepAt'.
function lane(salt, diff, sky, threshold) {
  const rE = stream(salt), rR = stream(salt), got = [], want = [];
  let sinceRest = 0, cdR = 0;
  const P = { x: 3, y: 70, z: -4, timeSinceRest: 0 }; M.Player = P;
  M.Diff = { LEVELS, get: () => diff };
  M.Sky = { darknessNow: () => 15 };
  M.World = { canSeeSky: () => sky };
  M.Equip = { localDifficulty: () => 3 };
  M.Spawn = { clearForSpawn: () => true };
  M.Commands = null;
  const made = [];
  M.EntityList = { ready: true, random: rE, spawn: (t, x, y, z) => { made.push([Ph.tick, x, y, z]); return { x, y, z }; } };
  Ph.spawnCooldown = 0; Ph.tick = 0;
  const sleepAt = 150000;
  for (let t = 0; t < 200000; t++) {
    Ph.tick = t;
    if (t === sleepAt) { Ph.resetTimeSinceRest(); sinceRest = 0; }
    P.timeSinceRest = sinceRest; sinceRest++;
    Ph.tickSpawner();
    // reference
    if (diff === 'peaceful') continue;
    if (--cdR > 0) continue;
    cdR += (60 + ni(rR, 60)) * 20;
    if (!sky) continue;
    if (!(3 > rR() * 3)) continue;
    const rest = Math.max(1, P.timeSinceRest);
    if (!(ni(rR, rest) >= threshold)) continue;
    const by = 70 + 20 + ni(rR, 15), bx = 3 - 10 + ni(rR, 21), bz = -4 - 10 + ni(rR, 21);
    const n = 1 + ni(rR, LEVELS.indexOf(diff) + 1);
    for (let i = 0; i < n; i++) want.push([t, bx + 0.5, by, bz + 0.5]);
  }
  for (const m of made) got.push(m);
  spawnsSeen += got.length;
  if (got.length !== want.length) return `count ${got.length} vs ${want.length} (${diff} sky=${sky})`;
  for (let i = 0; i < got.length; i++) if (got[i].join() !== want[i].join()) return `spawn ${i} ${got[i]} vs ${want[i]}`;
  for (const g of got) if (g[2] < 90 || g[2] > 104) return 'height band ' + g[2];
  if (!sky && got.length) return 'roofed spawned';
  if (got.length && got[0][0] < 0) return 'neg';
  return null;
}
// edge lane: rest=72000, roll forced to 71999 (no spawn) then 72000-ish (spawn), the exact >= 72000 boundary
function edge(th) {
  const seq = []; const mk = (v) => { seq.push(v); };
  const P = { x: 0, y: 70, z: 0, timeSinceRest: 72000 }; M.Player = P;
  M.Diff = { LEVELS, get: () => 'hard' }; M.Sky = { darknessNow: () => 15 }; M.World = { canSeeSky: () => true };
  M.Equip = { localDifficulty: () => 3 }; M.Spawn = { clearForSpawn: () => true }; M.Commands = null;
  let n = 0; const made = [];
  for (const v of [71999, 72000]) {
    const q = [0.5, 0.0, 71999 / 72000 + 0 * v, 0.5, 0.5, 0.5, 0.5];   // cooldown, rest-cooldown roll, difficulty 0<3, then ...
    if (v === 72000) q[2] = 1 - 1e-12;
    let i = 0; M.EntityList = { ready: true, random: () => q[i++ % q.length], spawn: () => { made.push(v); return {}; } };
    Ph.spawnCooldown = 1; P.timeSinceRest = 72000;
    Ph.tickSpawner();
    const spawned = made.length; made.length = 0;
    const vanilla = Math.floor(q[2] * 72000 * 0 + (q[2] * 72000)) >= th;
    if (vanilla !== !!spawned) return `edge roll ${Math.floor(q[2] * 72000)} spawned=${!!spawned} ref=${vanilla}`;
  }
  return null;
}
const run = (th) => { const e = edge(th); if (e) return e; let first = null; for (let s = 0; s < 20; s++) for (const d of ['easy', 'normal', 'hard']) for (const sky of [true, false]) { const r = lane(s, d, sky, th); if (!first) first = r; } return first; };
const base = run(72000);
ok(!base, 'baseline ' + base);
ok(spawnsSeen > 0, 'scenario never spawned a phantom (vacuous)');
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
brk(!!run(71999), 'threshold 71999');
brk(!!run(72001 + 20000), 'threshold 92001');
console.log(`lockstep-insomnia: ${20 * 6 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
