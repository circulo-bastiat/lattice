#!/usr/bin/env node
// lockstep-siege -- #6852 (G17-L151): lockstep scenario siege, 20 salts. Village door at the origin, player inside, dayTime 12000..60000.
// Reference = ZombieSiegeManager.spawn/spawn(world)/trySpawnZombie/getSpawnVector (.decomp ZombieSiegeManager.java:28-120) replayed draw-for-draw.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'src', '07zzv_siege.js'), 'utf8');
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const PX = 2, PY = 64, PZ = 3, T0 = 12000, T1 = 60000, RANGE = 48;
const near = (x, z) => Math.abs(x) <= RANGE && Math.abs(z) <= RANGE;

function engine(src, salt) {
  const NS = {}; new Function('MCL', src)(NS);
  const Sg = NS.Siege, r = stream(salt), ni = (n) => Math.floor(r() * n);
  const rng = { nextInt: ni, next: (b) => Math.floor(r() * (1 << b)) };
  let t = T0; const out = [], zs = [];
  const ctx = {
    isDay: () => t % 24000 < 12000, skyAngleHalf: () => t % 24000 === 18000, rand: r, randInt: ni,
    players: () => [{ x: PX, y: PY, z: PZ, spectator: false }], nearOccupiedPoi: (x, y, z) => near(x, z), isDesert: () => false,
    spawnVector: (x, y, z) => Sg.findSpawnPos({ topY: () => PY, nearOccupiedPoi: (a, b, c) => near(a, c), canSpawnInDark: () => true }, rng, x, y, z),
    trySpawnZombie: (x, y, z) => Sg.trySpawnZombie({ topY: () => PY, nearOccupiedPoi: (a, b, c) => near(a, c), canSpawnInDark: () => true, spawnZombie: (a, b, c, yaw) => zs.push({ t, x: a, y: b, z: c, yaw }) }, rng, x, y, z)
  };
  Sg.reset();
  for (; t < T1; t++) { const n = Sg.spawn(ctx, true); out.push([n, Sg.state, Sg.remaining, Sg.countdown]); }
  return { out, zs };
}

function reference(salt) {
  const r = stream(salt), ni = (n) => Math.floor(r() * n);
  let state = 2, spawned = false, remaining = 0, countdown = 0, sx = 0, sy = 0, sz = 0;
  const out = [], zs = [];
  const vec = (bx, bz) => { for (let i = 0; i < 10; i++) { const x = bx + ni(16) - 8, z = bz + ni(16) - 8; if (near(x, z)) return [x + 0.5, PY, z + 0.5]; } return null; };
  for (let t = T0; t < T1; t++) {
    let ret = 0;
    const night = t % 24000 >= 12000;
    if (!night) { state = 2; spawned = false; }
    else {
      if (t % 24000 === 18000) state = ni(10) === 0 ? 1 : 2;
      if (state !== 2) {
        let go = true;
        if (!spawned) {
          if (near(PX, PZ)) {
            for (let k = 0; k < 10; k++) {
              const a = r() * (Math.PI * 2);
              sx = PX + Math.floor(Math.cos(a) * 32); sy = PY; sz = PZ + Math.floor(Math.sin(a) * 32);
              if (vec(sx, sz)) { countdown = 0; remaining = 20; break; }
            }
            spawned = true;
          } else go = false;
        }
        if (go) {
          if (countdown > 0) countdown--;
          else {
            countdown = 2;
            if (remaining > 0) { const v = vec(sx, sz); if (v) zs.push({ t, x: v[0], y: v[1], z: v[2], yaw: (Math.floor(r() * (1 << 24)) / 16777216) * 360 }); remaining--; }
            else state = 2;
            ret = 1;
          }
        }
      }
    }
    out.push([ret, state, remaining, countdown]);
  }
  return { out, zs };
}

function run(src, salt) {
  const e = engine(src, salt), f = reference(salt);
  for (let i = 0; i < e.out.length; i++) if (e.out[i].join() !== f.out[i].join()) return { bad: `salt ${salt} tick ${T0 + i}: engine ${e.out[i]} != ref ${f.out[i]}` };
  if (JSON.stringify(e.zs) !== JSON.stringify(f.zs)) return { bad: `salt ${salt}: zombies engine ${JSON.stringify(e.zs).slice(0, 150)} != ref ${JSON.stringify(f.zs).slice(0, 150)}` };
  return { zombies: e.zs.length };
}

let fails = 0, breaks = 0, zombies = 0;
for (let s = 0; s < 20; s++) { const r = run(SRC, s); if (r.bad) { fails++; console.log('  FAIL ' + r.bad.slice(0, 400)); } else zombies += r.zombies; }
if (!zombies) { fails++; console.log('  FAIL vacuous: no siege ever spawned'); }
const mut = (name, f, t) => {
  const src = SRC.replace(f, t);
  if (src === SRC) { fails++; console.log('  FAIL mutation did not apply: ' + name); return; }
  let caught = false;
  for (let s = 0; s < 20 && !caught; s++) caught = !!run(src, s).bad;
  if (caught) { breaks++; console.log('   ✓ break caught: ' + name); } else { fails++; console.log('  ✗ break NOT caught: ' + name); }
};
mut('remaining 20 -> 19 (off by one)', 'Sg.remaining = 20', 'Sg.remaining = 19');
mut('countdown 2 -> 3', 'Sg.countdown = 2;', 'Sg.countdown = 3;');
mut('roll 1-in-10 -> 1-in-9', 'randInt(10)', 'randInt(9)');
mut('ring 32 -> 30', 'Math.cos(a) * 32', 'Math.cos(a) * 30');
console.log(`lockstep-siege: ${20 + 1 + breaks} assertions, ${fails} failures, ${breaks} breaks caught (${zombies} zombies over 20 salts)`);
process.exit(fails ? 1 : 0);
