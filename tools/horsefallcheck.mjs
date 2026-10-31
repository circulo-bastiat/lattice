#!/usr/bin/env node
// horsefallcheck.mjs — #1351: HorseBaseEntity.computeFallDamage = ceil((dist*0.5 - 3) * mult).
import { loadEngine } from './loadsrc.mjs';
const MCL = loadEngine({ extra: ['07_world.js', '14b_physics.js'], dom: false });
const Ph = MCL.Physics;
MCL.World.init(1);
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
console.log('horsefallcheck — #1351 horse fall damage');
const want = d => Math.max(0, Math.ceil(d * 0.5 - 3));
for (const t of ['horse', 'donkey', 'mule', 'skeleton_horse', 'zombie_horse', 'llama'])
  for (const d of [4, 10, 20]) {
    const e = { type: t, x: 0, y: 100, z: 0, effects: {} }; Ph.landed(e, d, -1);
    ok(e.pendingFallDamage === want(d), `${t} ${d} = ${want(d)}, got ${e.pendingFallDamage}`);
  }
const z = { type: 'zombie', x: 0, y: 100, z: 0, effects: {} }; Ph.landed(z, 10, -1);
ok(z.pendingFallDamage === 7, 'zombie stays generic 7');
const real = Ph.horseFallDamage;
Ph.horseFallDamage = (d, m) => Ph.fallDamage(d, m, 0);
const h = { type: 'horse', x: 0, y: 100, z: 0, effects: {} }; Ph.landed(h, 10, -1);
okAv(h.pendingFallDamage !== 2, 'with the horse formula broken to generic the probe still read 2');
Ph.horseFallDamage = real;
const sav = Ph.HORSE_BASE.horse; delete Ph.HORSE_BASE.horse;
const h2 = { type: 'horse', x: 0, y: 100, z: 0, effects: {} }; Ph.landed(h2, 10, -1);
okAv(h2.pendingFallDamage !== 2, 'with horse removed from HORSE_BASE the probe still read 2');
Ph.HORSE_BASE.horse = sav;
// rider: spend path in 14j_combat
const src = (await import('node:fs')).readFileSync(new URL('../src/14j_combat.js', import.meta.url), 'utf8');
ok(/HorseBaseEntity\.handleFallDamage[\s\S]{0,300}Survival\.hurt\(NS\.Player, 'fall'/.test(src), 'rider hurt wired in 14j_combat');
okAv(!/XHorseBaseEntity\.handleFallDamage[\s\S]{0,300}Survival\.hurt/.test(src), 'rider regex fails on a broken marker');
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}`);
for (const x of fails) console.log('   ✗ ' + x);
console.log(` ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
