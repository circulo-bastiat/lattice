#!/usr/bin/env node
// pushcheck.mjs — KW-51-4 (#601, part of #582): Entity.pushAwayFrom + LivingEntity.tickCramming.
//   node tools/pushcheck.mjs
// Rules (.decomp Entity.java:1269, LivingEntity.java:2622, EntityPredicates.canBePushedBy):
//   A. two overlapping mobs get equal and opposite horizontal velocity 0.05f*min(1,1/sqrt(d))/sqrt(d)*d
//   B. a sleeping mob neither shoves nor is shoved; a side with passengers keeps its velocity
//   C. dead / climbing others are not pushable
//   D. >= maxEntityCramming-1 overlapping others: 1-in-4 roll, then 6 damage
//   E. the player is shoved by a mob and pushes the mob (symmetric)
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

function run(patch) {
  const M = loadEngine({ patch, extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '14j_combat.js'] });
  const EL = M.EntityList, f = [], mk = (x, z, o) => Object.assign({ x, y: 5, z, vx: 0, vy: 0, vz: 0, width: 0.6, height: 1.0, maxHealth: 10, type: 'cow' }, o || {});
  const setup = (list, P) => { EL.list = list; EL.pushPlayer = () => P || null; };
  let dmg = 0; M.Combat = M.Combat || {}; M.Combat.hurt = (e, a) => { dmg += a; };
  // A
  let a = mk(0, 0), b = mk(0.3, 0); setup([a, b]); EL.pushAround(a);
  const d = Math.sqrt(0.3), exp = 0.3 / d * Math.min(1, 1 / d) * 0.05000000074505806;
  if (Math.abs(b.vx - exp) > 1e-9 || Math.abs(a.vx + exp) > 1e-9) f.push(`A: got a.vx=${a.vx} b.vx=${b.vx}, want +-${exp}`);
  // B
  a = mk(0, 0, { sleeping: true }); b = mk(0.3, 0); setup([a, b]); EL.pushAround(a);
  if (a.vx !== 0 || b.vx !== 0) f.push('B: sleeping mob was pushed');
  a = mk(0, 0, { passenger: {} }); b = mk(0.3, 0); setup([a, b]); EL.pushAround(a);
  if (a.vx !== 0 || b.vx === 0) f.push(`B: passenger side moved (${a.vx}) or other did not (${b.vx})`);
  // C
  a = mk(0, 0); b = mk(0.3, 0, { dead: true }); setup([a, b]); EL.pushAround(a);
  if (a.vx !== 0) f.push('C: dead entity pushed');
  // D
  const crowd = []; for (let i = 0; i < 25; i++) crowd.push(mk(0.01 * i, 0));
  setup(crowd); dmg = 0; EL.random = () => 0; EL.pushAround(crowd[0]);
  if (dmg !== 6) f.push(`D: cramming damage ${dmg}, want 6`);
  setup(crowd.slice(0, 20)); dmg = 0; EL.pushAround(crowd[0]);
  if (dmg !== 0) f.push('D: damage below the cramming limit');
  setup(crowd); dmg = 0; EL.random = () => 0.5; EL.pushAround(crowd[0]);
  if (dmg !== 0) f.push('D: damage without a winning roll');
  // E
  const P = mk(0.3, 0, { type: 'player' }); a = mk(0, 0); setup([a], P); EL.random = () => 0.5; EL.pushAround(a);
  if (!(P.vx > 0 && a.vx < 0)) f.push('E: player/mob push not symmetric');
  a = mk(0, 0); setup([a], P.x === 0 ? P : mk(0.3, 0, { type: 'player' })); const P2 = mk(0.3, 0, { type: 'player' }); setup([a], P2); EL.pushAround(P2);
  if (!(a.vx < 0 && P2.vx > 0)) f.push('E: player-side push did not shove the mob');
  return f;
}

console.log('pushcheck - KW-51-4, pushAwayFrom / tickCramming');
const fails = run();
const breaks = [
  ['no sleeping rule', (f, s) => f === '07i_entitylist.js' ? s.replace('if (q.sleeping || e.sleeping) continue;', '') : s],
  ['no passenger rule', (f, s) => f === '07i_entitylist.js' ? s.replace('if (ea) { e.vx = evx; e.vz = evz; }', '') : s],
  ['dead pushable', (f, s) => f === '07i_entitylist.js' ? s.replace('!o.removed && !o.dead &&', '!o.removed &&') : s],
  ['no cramming', (f, s) => f === '07i_entitylist.js' ? s.replace('hit.length > max - 1 &&', 'false &&') : s],
  ['player not pushed', (f, s) => f === '07i_entitylist.js' ? s.replace('hit.push(P);', '') : s],
];
let caught = 0;
for (const [name, patch] of breaks) {
  let n = 0;
  const probe = (f, s) => { const r = patch(f, s); if (r !== s) n++; return r; };
  let got; try { got = run(probe); } catch (e) { got = ['threw ' + e.message]; }
  if (!n) fails.push(`break "${name}" matched no source`); else if (!got.length) fails.push(`break "${name}" NOT caught`);
  else { caught++; console.log(`   ✓ break caught: ${name}`); }
}
console.log(`   ${caught} breaks caught`);
for (const m of fails) console.log('   x ' + m);
console.log(` pushcheck: 12 assertions, ${fails.length} failures, ${caught} breaks caught`);
process.exit(fails.length ? 1 : 0);
