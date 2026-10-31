#!/usr/bin/env node
// webcheck.mjs — #1344: cobweb slows entities (0.25/0.05/0.25), spiders are immune.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const NS = {}; globalThis.MCL = NS;
new Function('MCL', readFileSync(SRC + '00_ns.js', 'utf8'))(NS);
new Function('MCL', readFileSync(SRC + '14b_physics.js', 'utf8'))(NS);
const Ph = NS.Physics;
Ph.shapeAt = () => null;
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const near = (a, b) => Math.abs(a - b) < 1e-9;
const WEB = [0.25, 0.05, 0.25];

function run(slow, type) {
  const e = { x: 0.5, y: 10, z: 0.5, vx: 0, vy: 0, vz: 0, width: 0.6, height: 1.8, type, fallDistance: 3 };
  slow(e);
  Ph.move(e, 1, -1, 1);
  const first = { x: e.x - 0.5, y: 10 - e.y, z: e.z - 0.5, fd: e.fallDistance };
  Ph.move(e, 1, 0, 0);
  return { first, second: e.x - 0.5 - first.x };
}
function suite(slow) {
  const z = run(slow, 'zombie'), sp = run(slow, 'spider'), cs = run(slow, 'cave_spider');
  return { z, sp, cs };
}
function verify(label, slow, expectCaught) {
  const { z, sp, cs } = suite(slow);
  const c = [
    near(z.first.x, 0.25) && near(z.first.z, 0.25) && near(z.first.y, 0.05),
    near(z.second, 1),
    near(sp.first.x, 1) && near(sp.first.y, 1) && near(cs.first.x, 1),
    z.first.fd === 0 || z.first.fd === 0.05,
  ];
  return c;
}
const good = (e) => Ph.slowMovement(e, WEB, true);
const c0 = verify('real', good);
ok(c0[0], 'zombie in web moves 0.25/0.05/0.25');
ok(c0[1], 'multiplier is consumed after one move');
ok(c0[2], 'spider and cave_spider are immune');
ok(c0[3], 'fall distance reset in web');
// #1395: the spider exemption is cobweb-only (SpiderEntity.slowMovement), so a berry bush still slows one.
const BERRY = [0.8, 0.75, 0.8];
const berry = (flag) => run((e) => Ph.slowMovement(e, BERRY, flag), 'spider').first;
const bs = berry(false);
ok(near(bs.x, 0.8) && near(bs.y, 0.75), 'sweet berry bush (0.8/0.75/0.8) slows a spider');
// #1580: WitherEntity.slowMovement is empty - no block slows a wither, and its fallDistance is untouched.
const witherWeb = (flag, m) => { const e = { type: 'wither', fallDistance: 3 }; Ph.slowMovement(e, m, flag); return e; };
ok(witherWeb(true, WEB).movementMultiplier === undefined && witherWeb(false, BERRY).movementMultiplier === undefined, 'wither: slowMovement leaves movementMultiplier unset');
let breaks = 0;
{ const e = { type: 'zombie', fallDistance: 3 }; Ph.slowMovement(e, WEB, true); if (e.movementMultiplier === undefined) fails.push('ANTI-VACUITY: wither check passes for zombie'); else { breaks++; console.log('   ✓ non-wither still slowed'); } }
{ const b = berry(true); if (near(b.x, 0.8)) fails.push('ANTI-VACUITY: spider exemption on berry not caught'); else { breaks++; console.log('   ✓ spider exempt from berry'); } }
for (const [label, slow, idx] of [
  ['no slowdown at all', () => {}, 0],
  ['web never cleared', (e) => { e.movementMultiplier = WEB; Ph.move = Ph.move; }, -1],
  ['spider not special-cased', (e) => { e.fallDistance = 0; e.movementMultiplier = WEB; }, 2],
]) {
  if (idx === -1) continue;
  const c = verify(label, slow);
  if (!c[idx]) { breaks++; console.log('   ✓ ' + label); } else fails.push('ANTI-VACUITY: ' + label + ' not caught');
}
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}`);
for (const f of fails) console.log('  ✗ ' + f);
console.log(`${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
