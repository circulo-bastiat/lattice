#!/usr/bin/env node
// lockstep-patrolspawn -- #7945 (G18c-L10): lockstep lane 'patrolspawn', 20 salts x 24 configs x 36000 ticks (start day 4 dawn, day 5 dawn or dusk; PEACEFUL..HARD; a claimed bed
// 32 blocks away (section distance 2, refused) or 64 away (accepted)). Reference = PatrolSpawner.spawn (.decomp PatrolSpawner.java:21-87) replayed draw-for-draw:
// cooldown += 12000 + nextInt(1200); isDay gate; nextInt(5); nextInt(playerCount); isNearOccupiedPointOfInterest(pos, 2); (24+nextInt(24)) * (nextBoolean?-1:1) per axis;
// count = ceil(localDifficulty)+1; peaceful: HostileEntity.canSpawnIgnoreLightLevel refuses the leader so the loop breaks; leader = captain + ominous banner + patrol target; member walk.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, 'src', f), 'utf8');
const SRC = { eq: read('07y_equip.js'), rd: read('07s_raid.js'), ps: read('07x_patrol.js') };
const stream = (salt) => { let s = (salt * 2654435761 + 7945) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const TICKS = 36000, BASE = 5 * 24000, PX = 3, PZ = -7, PY = 64;
const CONFIGS = [];
for (const start of [-24000, 0, 12000]) for (const diff of ['peaceful', 'easy', 'normal', 'hard']) for (const vx of [32, 64]) CONFIGS.push({ start, diff, vx });
function engine(src, salt, cf) {
  const NS = { Sky: { dayTime: 0, isDay() { return this.dayTime % 24000 < 12000; } }, Diff: { get: () => cf.diff }, Player: { x: PX + 0.5, y: PY, z: PZ + 0.5 } };
  NS.World = { loadedAt: () => true, key: (a, b) => a + ',' + b, chunks: new Map(), heightAt: () => PY - 1 };
  NS.Profession = { ready: true, claimed: { [(PX + cf.vx) + ',' + PY + ',' + PZ]: 1 } };
  const log = [], r = stream(salt);
  NS.EntityList = { random: r, spawn: (type, x, y, z, o) => { const m = { type, x, y, z, reason: o && o.spawnReason }; log.push(m); return m; } };
  new Function('MCL', src.eq)(NS); new Function('MCL', src.rd)(NS); NS.Raid.canPlaceRaiderAt = () => true; new Function('MCL', src.ps)(NS);
  NS.Patrol.init(); NS.Equip.ready = false;
  const events = [];
  for (let t = 0; t < TICKS; t++) {
    NS.Sky.dayTime = BASE + cf.start + t; log.length = 0;
    const n = NS.Patrol.tick(NS);
    if (log.length || n) events.push({ t, n, mobs: log.map((m) => ({ x: m.x, y: m.y, z: m.z, leader: !!m.patrolLeader, banner: !!m.ominousBanner, target: m.patrolTarget && [m.patrolTarget.x, m.patrolTarget.y, m.patrolTarget.z], patrolling: !!m.patrolling, reason: m.reason })) });
  }
  return { events, NS };
}

function reference(salt, NS, cf) {
  const r = stream(salt), ni = (n) => Math.floor(r() * n), events = [];
  let cooldown = 0;
  for (let t = 0; t < TICKS; t++) {
    const T = BASE + cf.start + t;
    cooldown--; if (cooldown > 0) continue;
    cooldown += 12000 + ni(1200);
    if (Math.floor(T / 24000) < 5 || T % 24000 >= 12000) continue;
    if (ni(5) !== 0) continue;
    ni(1);
    if (Math.abs(Math.floor(PX / 16) - Math.floor((PX + cf.vx) / 16)) <= 2) continue;
    const dx = (24 + ni(24)) * (r() < 0.5 ? -1 : 1), dz = (24 + ni(24)) * (r() < 0.5 ? -1 : 1);
    let x = PX + dx, z = PZ + dz;
    if (cf.diff === 'peaceful') continue;
    const count = Math.ceil(NS.Equip.localDifficulty({ x, z, time: T, difficulty: cf.diff })) + 1;
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
function run1(src, salt, cf) {
  const { events, NS } = engine(src, salt, cf);
  const ref = reference(salt, NS, cf);
  const canon = (e) => e && JSON.stringify({ t: e.t, n: e.n, mobs: e.mobs.map((m) => [m.x, m.y, m.z, m.leader, m.banner, m.patrolling, m.reason, m.target || null]) });
  for (let i = 0; i < Math.max(events.length, ref.length); i++)
    if (canon(events[i]) !== canon(ref[i])) return { bad: `salt ${salt} ${cf.diff}/${cf.start}/${cf.vx} event ${i}: engine ${canon(events[i])} != ref ${canon(ref[i])}` };
  return { events: events.length };
}

function run(src, salt) { let ev = 0; for (const cf of CONFIGS) { const r = run1(src, salt, cf); if (r.bad) return r; ev += r.events; } return { events: ev }; }

let fails = 0, breaks = 0, spawns = 0;
for (let s = 0; s < 20; s++) { const r = run(SRC, s); if (r.bad) { fails++; console.log('  FAIL ' + r.bad.slice(0, 400)); } else spawns += r.events; }
if (!spawns) { fails++; console.log('  FAIL vacuous: no patrol ever spawned'); }
const mut = (name, f, t) => {
  const ps = SRC.ps.replace(f, t); // no-op if the pattern is not found
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
mut('day gate removed', '|| !Sky.isDay()', '');
mut('village radius 2 -> 1', 'Ps.POI_RADIUS = 2', 'Ps.POI_RADIUS = 1');
mut('village exclusion removed', 'if (claimed && NS2.Raid', 'if (false && NS2.Raid');
console.log(`lockstep-patrolspawn: ${20 + 1 + breaks} assertions, ${fails} failures, ${breaks} breaks caught (${spawns} patrols over 20 salts)`);
process.exit(fails ? 1 : 0);
