#!/usr/bin/env node
// foxfallcheck.mjs — #1288: FoxEntity.computeFallDamage = ceil((dist - 5) * mult) (.decomp line 607),
// vs the generic ceil((dist - 3) * mult); Ph.landed routes a fox through Fx.fallDamage.
import { loadEngine } from './loadsrc.mjs';
const MCL = loadEngine({ extra: ['07_world.js', '14b_physics.js', '07zj_fox.js'], dom: false });
const Ph = MCL.Physics, Fx = MCL.Fox;
MCL.World.init(1);
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
console.log('foxfallcheck — #1288 fox fall damage');
const table = [[3, 0], [5, 0], [5.5, 1], [6, 1], [10, 5], [10.5, 6], [20, 15]];
for (const [d, want] of table) ok(Fx.fallDamage(d, 1) === want, `fox fall ${d} = ${want}, got ${Fx.fallDamage(d, 1)}`);
ok(Fx.fallDamage(10, 0.2) === 1, 'hay multiplier 0.2: ceil(5*0.2)=1');
ok(Fx.fallDamage(10, 0) === 0, 'slime multiplier 0');
ok(Ph.fallDamage(10, 1, 0) === 7, 'generic mob still ceil(10-3)=7');
const f = { type: 'fox', x: 0, y: 100, z: 0, effects: {} }, z = { type: 'zombie', x: 0, y: 100, z: 0, effects: {} };
try { Ph.landed(f, 10, -1); Ph.landed(z, 10, -1); } catch (e) { fails.push('Ph.landed threw: ' + e.message); }
ok(f.pendingFallDamage === 5, 'Ph.landed fox 10 blocks = 5, got ' + f.pendingFallDamage);
ok(z.pendingFallDamage === 7, 'Ph.landed zombie 10 blocks = 7, got ' + z.pendingFallDamage);
const real = Fx.fallDamage;
Fx.fallDamage = (d, m) => Ph.fallDamage(d, m, 0);
const f2 = { type: 'fox', x: 0, y: 100, z: 0, effects: {} }; Ph.landed(f2, 10, -1);
okAv(f2.pendingFallDamage !== 5, 'with Fx.fallDamage broken to the generic formula the fox probe still read 5');
Fx.fallDamage = real;
const oldFree = Fx.FALL_FREE; Fx.FALL_FREE = 3;
okAv(Fx.fallDamage(10, 1) !== 5, 'with FALL_FREE=3 the table still passed');
Fx.FALL_FREE = oldFree;
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}`);
for (const x of fails) console.log('   ✗ ' + x);
console.log(` ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
