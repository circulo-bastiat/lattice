#!/usr/bin/env node
// fishxpcheck.mjs — G21: fishing XP goes through Xp.spawn at (player.x, player.y+0.5, player.z+0.5), value nextInt(6)+1
// (FishingBobberEntity.use, .decomp). Runs against the real source and 3 injected faults; each must be caught.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const HDR = 'fishxpcheck — G21: fishing xp via Xp.spawn';
const SRC = readFileSync(fileURLToPath(new URL('../src/07zzq_fishing.js', import.meta.url)), 'utf8');
function run(src) {
  const calls = [], raw = [];
  const NS = {
    EntityList: { dropStack() {}, spawn: (t) => { raw.push(t); return { value: 0 }; } },
    Items: null,
    Loot: { rollTable: () => [{ item: 'minecraft:cod', count: 1 }, { item: 'minecraft:stick', count: 1 }] },
    Xp: { spawn: (x, y, z, n, rand) => { calls.push([x, y, z, n, typeof rand]); return []; } },
  };
  new Function('MCL', src.replace(/\}\)\(typeof MCL[\s\S]*$/, '})(MCL);'))(NS);
  const Fi = NS.Fishing, f = [];
  const P = { x: 3, y: 64, z: -2 };
  let k = 0; const seen = new Set();
  for (let t = 0; t < 200; t++) {
    const rnd = { nextInt: (n) => (k++ % n), nextFloat: () => 0.5 };
    const b = { x: 0, y: 64, z: 0, owner: P, hookCountdown: 5, random: rnd, onGround: false };
    calls.length = 0;
    Fi.reel(b, P, null, { openWater: true });
    if (calls.length !== 2) { f.push('xp spawns per reel: ' + calls.length); break; }
    for (const c of calls) {
      if (c[0] !== 3 || c[1] !== 64.5 || c[2] !== -1.5) f.push('position ' + c.slice(0, 3));
      if (c[3] < 1 || c[3] > 6) f.push('value out of 1..6: ' + c[3]);
      seen.add(c[3]);
    }
  }
  if (raw.includes('experience_orb')) f.push('raw experience_orb spawn bypasses Xp.spawn');
  if (seen.size !== 6) f.push('values seen ' + [...seen].sort());
  return [...new Set(f)];
}
const base = run(SRC);
if (base.length) { console.log('FAIL ' + base.join('; ')); process.exit(1); }
const faults = [
  ['value range 6->7', (s) => s.replace('r.nextInt(6) + 1, function', 'r.nextInt(7) + 1, function')],
  ['wrong y offset', (s) => s.replace('NS.Xp.spawn(P.x, P.y + 0.5,', 'NS.Xp.spawn(P.x, P.y + 1.5,')],
  ['raw orb spawn', (s) => s.replace("if (NS.Xp && NS.Xp.spawn) NS.Xp.spawn(", "EL.spawn('experience_orb', 0, 0, 0); if (NS.Xp && NS.Xp.spawn) NS.Xp.spawn(")],
];
let caught = 0;
for (const [n, fn] of faults) {
  const m = fn(SRC);
  if (m === SRC) { console.log('FAIL fault did not apply: ' + n); process.exit(1); }
  if (run(m).length) caught++; else console.log('NOT CAUGHT: ' + n);
}
if (caught !== faults.length) process.exit(1);
console.log(HDR + ': ' + caught + ' breaks caught');
