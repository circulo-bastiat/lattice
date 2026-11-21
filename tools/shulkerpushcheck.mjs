#!/usr/bin/env node
// shulkerpushcheck.mjs — #8753: ShulkerEntity.isPushable() false / pushAwayFrom no-op.
//   8 zombies crowded on a shulker leave its position bit-identical over 200 ticks.
import { loadEngine } from './loadsrc.mjs';

function run(patch) {
  const M = loadEngine({ patch, extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '14j_combat.js'] });
  const EL = M.EntityList;
  const mk = (x, z, type) => ({ x, y: 5, z, vx: 0, vy: 0, vz: 0, width: 0.6, height: 1.0, maxHealth: 10, type });
  const sh = mk(0, 0, 'shulker'), zs = [];
  for (let i = 0; i < 8; i++) zs.push(mk(0.05 * i - 0.2, 0.03 * i - 0.1, 'zombie'));
  EL.list = [sh, ...zs]; EL.pushPlayer = () => null; EL.random = () => 0.5;
  const x0 = sh.x, z0 = sh.z;
  for (let t = 0; t < 200; t++) {
    for (const e of EL.list) if (e.type !== 'bat' && e.type !== 'shulker' && e.type !== 'armor_stand') EL.pushAround(e);
    for (const z of zs) { z.x += z.vx; z.z += z.vz; z.vx = z.vz = 0; }
  }
  const f = [];
  if (!(sh.x === x0 && sh.z === z0 && sh.vx === 0 && sh.vz === 0)) f.push(`shulker moved: ${sh.x},${sh.z} v=${sh.vx},${sh.vz}`);
  // direct: pushAround from a zombie must not touch the shulker either
  const s2 = mk(0, 0, 'shulker'), z2 = mk(0.1, 0, 'zombie'); EL.list = [s2, z2]; const r2 = EL.pushAround(z2);
  if (r2 !== 0) f.push('shulker counted as a pushable other (' + r2 + ')');
  if (s2.vx !== 0 || s2.vz !== 0) f.push('shulker pushed by zombie pushAround');
  // sanity: a cow in place of the shulker IS pushed
  const c = mk(0, 0, 'cow'), z3 = mk(0.1, 0, 'zombie'); EL.list = [c, z3]; EL.pushAround(z3);
  if (c.vx === 0) f.push('control: cow not pushed');
  return f;
}

console.log('shulkerpushcheck - #8753');
const fails = run();
const breaks = [['no pushable opt-out', (f, s) => f === '07i_entitylist.js' ? s.replace("o.type !== 'shulker' && ", '') : s]];
let caught = 0;
for (const [name, patch] of breaks) {
  let n = 0;
  const probe = (f, s) => { const r = patch(f, s); if (r !== s) n++; return r; };
  let got; try { got = run(probe); } catch (e) { got = ['threw ' + e.message]; }
  if (!n) fails.push(`break "${name}" matched no source`); else if (!got.length) fails.push(`break "${name}" NOT caught`);
  else { caught++; console.log(`   ✓ break caught: ${name}`); }
}
for (const m of fails) console.log('   x ' + m);
console.log(` shulkerpushcheck: 3 assertions, ${fails.length} failures, ${caught} breaks caught`);
process.exit(fails.length ? 1 : 0);
