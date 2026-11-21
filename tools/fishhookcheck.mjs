#!/usr/bin/env node
// fishhookcheck.mjs — G17-F5: hooked entity (FishingBobberEntity.onEntityHit / pullHookedEntity, .decomp lines 263-280, 487-508).
// Runs the check against the real source and against 3 injected faults; each must be caught.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
console.log('fishhookcheck — G17-F5: hooked entity');
const SRC = readFileSync(fileURLToPath(new URL('../src/07zzq_fishing.js', import.meta.url)), 'utf8');
function run(src) {
  const NS = { EntityList: {}, Items: null };
  new Function('MCL', src.replace(/\}\)\(typeof MCL[\s\S]*$/, '})(MCL);'))(NS);
  const Fi = NS.Fishing, f = [];
  const ok = (c, m) => { if (!c) f.push(m); };
  for (const [type, pos] of [['cow', [4, 64, 7]], ['zombie', [-3, 65, 2]]]) {
    const own = { x: 1, y: 64, z: 1 }, b = { x: 2, y: 65, z: 3, vx: 0.5, vy: 0.2, vz: 0.1, owner: own, state: Fi.FLYING };
    const m = { id: 9, type, x: pos[0], y: pos[1], z: pos[2], height: 1.4, health: 20, vx: 0.25, vy: 0, vz: -0.5 };
    const hp = m.health;
    Fi.onEntityHit(b, m);
    ok(m.health === hp, type + ': damage dealt on hit');
    ok(b.hookedEntity === m && b.hookedId === 10, type + ': not hooked');
    const env = { fluidHeight: () => 0, rnd: () => 0, move() {} };
    Fi.removeIfInvalid = () => false;
    Fi.tick(b, env); Fi.tick(b, env);
    ok(b.state === Fi.HOOKED_IN_ENTITY && b.y === m.y + 1.4 * 0.8, type + ': bobber does not ride entity');
    const bx = b.x, by = b.y, bz = b.z, v0 = [m.vx, m.vy, m.vz];
    const dmg = Fi.reel(b, own, null, {});
    ok(dmg === 5, type + ': rod damage ' + dmg);
    ok(m.vx === v0[0] + (own.x - bx) * 0.1 && m.vy === v0[1] + (own.y - by) * 0.1 && m.vz === v0[2] + (own.z - bz) * 0.1, type + ': pull delta');
    m.health = 0; m.dead = true;
    Fi.tick(b, env);
    ok(!b.hookedEntity && b.state === Fi.FLYING, type + ': dead entity keeps the hook');
  }
  return f;
}
const base = run(SRC);
if (base.length) { console.log('FAIL ' + base.join('; ')); process.exit(1); }
const faults = [
  ['0.5 pull factor', (s) => s.replace(/\* 0\.1; h\.vy/, '* 0.5; h.vy')],
  ['damage on hit', (s) => s.replace('Fi.onEntityHit = function (e, other) {', 'Fi.onEntityHit = function (e, other) { other.health -= 1;')],
  ['hook kept after death', (s) => s.replace(' && !H.dead && !(H.health <= 0)', '')],
];
let caught = 0;
for (const [n, fn] of faults) { const m = fn(SRC); if (m === SRC) { console.log('fault did not apply: ' + n); continue; } if (run(m).length) { caught++; console.log('  ✓ caught: ' + n); } else console.log('NOT caught: ' + n); }
if (caught !== faults.length) process.exit(1);
console.log(`OK  ${2 * 6} checks passed, 0 failures; hook/pull/release match .decomp; ${caught} breaks caught`);
