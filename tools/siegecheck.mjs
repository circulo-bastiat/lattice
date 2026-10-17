// siegecheck: ZombieSiegeManager state machine (src/07zzv_siege.js) vs .decomp ZombieSiegeManager.java.
import { readFileSync } from 'node:fs';
const SRC = readFileSync(new URL('../src/07zzv_siege.js', import.meta.url), 'utf8');
function load(src) { const w = {}; new Function('MCL', src)(w); return w.Siege; }
function drive(src) {
  const S = load(src); const log = []; let day = 24000 * 0 + 12000, rollOut = 0, zombies = 0;
  const ctx = () => ({
    isDay: () => day % 24000 < 13000 || day % 24000 > 23000, skyAngleHalf: () => day % 24000 === 18000,
    rand: () => 0.25, randInt: () => rollOut, players: () => [{ x: 0, y: 64, z: 0, spectator: false }],
    nearOccupiedPoi: () => true, isDesert: () => false, spawnVector: () => ({}), trySpawnZombie: () => zombies++
  });
  const c = ctx();
  for (; day < 24500; day++) { if (day === 18000) rollOut = 0; log.push([day, S.spawn(c, true), S.state, S.remaining]); }
  const at = (t) => log.find((r) => r[0] === t);
  return { S, log, zombies, at };
}
let fails = [];
function run(src, tag) {
  const r = drive(src), bad = [];
  if (r.at(17999)[2] !== 2) bad.push('state before midnight must be DONE');
  if (r.at(18000)[2] === 2 && r.zombies === 0) bad.push('roll 0 at midnight must start ONGOING');
  if (r.zombies !== 20) bad.push('expected 20 zombies, got ' + r.zombies);
  if (r.at(18000)[3] !== 20 - 1) bad.push('remaining after first step ' + r.at(18000)[3]);
  if (r.at(18001)[1] !== 0 || r.at(18002)[1] !== 0 || r.at(18003)[1] !== 1) bad.push('countdown cadence is 2 idle ticks then 1');
  if (r.at(24100)[2] !== 2 || r.S.spawned) bad.push('dawn must reset to DONE/!spawned');
  // roll != 0 -> no siege
  const S = load(src), c = { isDay: () => false, skyAngleHalf: () => true, randInt: () => 3, rand: () => 0, players: () => [], nearOccupiedPoi: () => true, isDesert: () => false, spawnVector: () => ({}) };
  S.spawn(c, true); if (S.state !== 2) bad.push('roll 3 must not start a siege');
  const S2 = load(src); S2.spawn({ ...c, randInt: () => 0, players: () => [{ x: 0, y: 0, z: 0, spectator: true }] }, true); if (S2.spawned) bad.push('spectator must not start a siege');
  // gamerule off aborts
  S.state = 1; S.spawn(c, false); if (S.state !== 2) bad.push('doMobSpawning off must end siege');
  if (bad.length) { if (tag) return false; fails = bad; }
  return !bad.length;
}
const ok = run(SRC);
if (!ok) { console.log('siegecheck FAIL: ' + fails.join('; ')); process.exit(1); }

// placement (G18c-Z4): findSpawnPos vs a transcription, same java.util.Random sequence
function jr(seed) { let s = (BigInt(seed) ^ 0x5DEECE66Dn) & ((1n << 48n) - 1n); const next = (b) => { s = (s * 0x5DEECE66Dn + 0xBn) & ((1n << 48n) - 1n); return Number(BigInt.asIntN(32, s >> BigInt(48 - b))); };
  return { next, nextInt(n) { if ((n & -n) === n) return Number((BigInt(n) * BigInt(next(31))) >> 31n); let b, v; do { b = next(31); v = b % n; } while (b - v + (n - 1) > 2147483647); return v; } }; }
const topY = (x, z) => 60 + ((x * 7 + z * 3) & 3);
const pctx = { topY, nearOccupiedPoi: () => true, canSpawnInDark: (x, y, z, r) => r.nextInt(3) !== 0 };
function ref(r, sx, sz) { for (let i = 0; i < 10; i++) { const x = sx + r.nextInt(16) - 8, z = sz + r.nextInt(16) - 8, y = topY(x, z); if (r.nextInt(3) !== 0) return { x: x + 0.5, y, z: z + 0.5 }; } return null; }
function placement(src) {
  const S = load(src); let bad = 0;
  for (let t = 0; t < 1000; t++) {
    const a = jr(t), b = jr(t), sx = t * 5 - 2000, sz = 900 - t * 3;
    const got = S.findSpawnPos(pctx, a, sx, 64, sz), exp = ref(b, sx, sz);
    if (JSON.stringify(got) !== JSON.stringify(exp)) bad++;
    else if (got && (Math.abs(got.x - 0.5 - sx) > 8 || Math.abs(got.z - 0.5 - sz) > 8 || got.y !== topY(got.x - 0.5, got.z - 0.5))) bad++;
  }
  return bad === 0;
}
if (!placement(SRC)) { console.log('siegecheck FAIL: placement differs from findSpawnPos transcription'); process.exit(1); }
const BREAKS = [
  ['dusk-transition gate removed', (s) => s.replace('if (ctx.skyAngleHalf()) Sg.state', 'if (true) Sg.state')],
  ['roll 1-in-10 -> always', (s) => s.replace('randInt(10) === 0', 'randInt(10) >= 0')],
  ['20 -> 19', (s) => s.replace('Sg.remaining = 20', 'Sg.remaining = 19')],
  ['countdown 2 -> 1', (s) => s.replace('Sg.countdown = 2;', 'Sg.countdown = 1;')],
  ['dawn reset removed', (s) => s.replace('Sg.state = Sg.DONE; Sg.spawned = false; return 0; }', 'return 0; }')],
  ['placement radius 5', (s) => s.replace('rng.nextInt(16) - 8, z = sz + rng.nextInt(16) - 8', 'rng.nextInt(16) - 5, z = sz + rng.nextInt(16) - 5'), placement],
  ['spectator allowed', (s) => s.replace('if (p.spectator) continue;', '')]
];
let caught = 0;
for (const [n, f, alt] of BREAKS) { const m = f(SRC); if (m === SRC) throw new Error('break no-op: ' + n); let r; try { r = (alt || ((q) => run(q, 1)))(m); } catch (e) { r = false; } if (!r) caught++; else console.log('NOT caught: ' + n); }
console.log(`siegecheck: ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(caught === BREAKS.length ? 0 : 1);
