#!/usr/bin/env node
// lockstep-patrol -- #6788 (G17-L140): lockstep scenario patrol, 20 salts. A player on flat ground for 8 in-game days on Normal.
// Reference = PatrolSpawner.spawn (.decomp PatrolSpawner.java:21-82) replayed draw-for-draw on the same Random stream:
// cooldown += 12000 + nextInt(1200); day<5 or night refuses; nextInt(5)!=0 refuses; nextInt(playerCount); (24+nextInt(24)) * (nextBoolean?-1:1) per axis;
// count = ceil(localDifficulty)+1; leader first (captain flag, ominous banner, patrol target = nextInt(1000)-500 twice around the origin), member walk +nextInt(5)-nextInt(5).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, 'src', f), 'utf8');
const SRC = { eq: read('07y_equip.js'), ps: read('07x_patrol.js') };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const DAYS = 8, PX = 3, PZ = -7, PY = 64;

function engine(src, salt) {
  const NS = { Sky: { dayTime: 0, isDay() { return this.dayTime % 24000 < 12000; } }, Diff: { get: () => 'normal' }, Player: { x: PX + 0.5, y: PY, z: PZ + 0.5 } };
  NS.World = { loadedAt: () => true, key: (a, b) => a + ',' + b, chunks: new Map(), heightAt: () => PY - 1 };
  NS.Raid = { canPlaceRaiderAt: () => true };
  const log = [], r = stream(salt);
  NS.EntityList = { random: r, spawn: (type, x, y, z, o) => { const m = { type, x, y, z, reason: o && o.spawnReason }; log.push(m); return m; } };
  new Function('MCL', src.eq)(NS); new Function('MCL', src.ps)(NS);
  NS.Patrol.init(); NS.Equip.ready = false;
  const events = [];
  for (let t = 0; t < DAYS * 24000; t++) {
    NS.Sky.dayTime = t; log.length = 0;
    const n = NS.Patrol.tick(NS);
    if (log.length || n) events.push({ t, n, mobs: log.map((m) => ({ x: m.x, y: m.y, z: m.z, leader: !!m.patrolLeader, banner: !!m.ominousBanner, target: m.patrolTarget && [m.patrolTarget.x, m.patrolTarget.y, m.patrolTarget.z], patrolling: !!m.patrolling, reason: m.reason })) });
  }
  return { events, NS };
}

function reference(salt, NS) {
  const r = stream(salt), ni = (n) => Math.floor(r() * n), events = [];
  let cooldown = 0;
  for (let t = 0; t < DAYS * 24000; t++) {
    cooldown--; if (cooldown > 0) continue;
    cooldown += 12000 + ni(1200);
    if (Math.floor(t / 24000) < 5 || t % 24000 >= 12000) continue;
    if (ni(5) !== 0) continue;
    ni(1);
    const dx = (24 + ni(24)) * (r() < 0.5 ? -1 : 1), dz = (24 + ni(24)) * (r() < 0.5 ? -1 : 1);
    let x = PX + dx, z = PZ + dz;
    const count = Math.ceil(NS.Equip.localDifficulty({ x, z, time: t, difficulty: 'normal' })) + 1;
    const mobs = [];
    for (let i = 0; i < count; i++) {
      const m = { x, y: PY, z, leader: i === 0, banner: i === 0, patrolling: true, reason: 'patrol', target: null };
      if (i === 0) m.target = [-500 + ni(1000), 0, -500 + ni(1000)];
      mobs.push(m);
      x += ni(5) - ni(5); z += ni(5) - ni(5);
    }
    events.push({ t, n: count, mobs });
  }
  return events;
}

// engine's per-tick day counter reads Sky.dayTime; the reference's Equip call uses the same time so the count is the regional one.
function run(src, salt) {
  const { events, NS } = engine(src, salt);
  const ref = reference(salt, NS);
  const canon = (e) => e && JSON.stringify({ t: e.t, n: e.n, mobs: e.mobs.map((m) => [m.x, m.y, m.z, m.leader, m.banner, m.patrolling, m.reason, m.target || null]) });
  for (let i = 0; i < Math.max(events.length, ref.length); i++)
    if (canon(events[i]) !== canon(ref[i])) return { bad: `salt ${salt} event ${i}: engine ${canon(events[i])} != ref ${canon(ref[i])}` };
  return { events: events.length };
}

let fails = 0, breaks = 0, spawns = 0;
for (let s = 0; s < 20; s++) { const r = run(SRC, s); if (r.bad) { fails++; console.log('  FAIL ' + r.bad.slice(0, 400)); } else spawns += r.events; }
if (!spawns) { fails++; console.log('  FAIL vacuous: no patrol ever spawned'); }
const mut = (name, f, t) => {
  const ps = SRC.ps.replace(f, t);
  if (ps === SRC.ps) { fails++; console.log('  FAIL mutation did not apply: ' + name); return; }
  let caught = false;
  for (let s = 0; s < 20 && !caught; s++) caught = !!run({ ...SRC, ps }, s).bad;
  if (caught) { breaks++; console.log('   ✓ break caught: ' + name); } else { fails++; console.log('  ✗ break NOT caught: ' + name); }
};
mut('cooldown base 12000 -> 11000', 'Ps.SPAWN_COOLDOWN_MIN = 12000', 'Ps.SPAWN_COOLDOWN_MIN = 11000');
mut('ring 24 -> 20', 'Ps.MIN_DIST = 24', 'Ps.MIN_DIST = 20');
mut('captain not first', 'i === 0, RNDFB', 'i === 1, RNDFB');
mut('odds 1-in-5 -> 1-in-6', 'Ps.ODDS_DENOM = 5', 'Ps.ODDS_DENOM = 6');
mut('first patrol day 5 -> 4', 'Ps.MIN_DAY = 5', 'Ps.MIN_DAY = 4');
console.log(`lockstep-patrol: ${20 + 1 + breaks} assertions, ${fails} failures, ${breaks} breaks caught (${spawns} patrols over 20 salts)`);
process.exit(fails ? 1 : 0);
