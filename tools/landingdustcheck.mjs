#!/usr/bin/env node
// #6244: LivingEntity.fall landing block dust: (int)(150*min(0.2+ceil(fd-3)/15, 2.5)) when fd > 3, state non-air.
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({ extra: ['07zx_particle.js'], dom: false });
const Px = M.Particle;
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const run = (count) => {
  const f = [];
  const t = (c, m) => { if (!c) f.push(m); };
  t(count(10) === 100, '10-block fall = 100 (ceil(7)/15+0.2)');
  t(count(100) === 375, 'huge fall clamps at 2.5 -> 375');
  t(count(3) === 0 && count(0.5) === 0, 'fd<=3 spawns none');
  return f;
};
ok(run(Px.landingDustCount).length === 0, 'formula');
const e = { x: 1, y: 2, z: 3, fallDistance: 10 };
Px.list.length = 0;
ok(Px.spawnLandingDust(e, 7, () => 0.5) === 100 && Px.list.length === 100 && Px.list[0].state === 7, '100 block particles carry the state');
Px.list.length = 0;
ok(Px.spawnLandingDust(e, 0, () => 0.5) === 0 && Px.list.length === 0, 'air spawns none');
e.fallDistance = 0.5;
ok(Px.spawnLandingDust(e, 7, () => 0.5) === 0, 'short fall none');
// breaks
const noClamp = (fd) => fd > 3 ? Math.floor(150 * (0.2 + Math.ceil(fd - 3) / 15)) : 0;
const badFormula = (fd) => fd > 3 ? Math.floor(150 * Math.min(0.2 + fd / 15, 2.5)) : 0;
for (const b of [noClamp, badFormula]) if (run(b).length) { breaks++; console.log("   ✓ anti-vacuity: break caught"); }
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(` ${breaks} breaks caught`);
process.exit(fails.length || breaks < 2 ? 1 : 0);
