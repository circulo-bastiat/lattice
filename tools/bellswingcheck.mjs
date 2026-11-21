#!/usr/bin/env node
// bellswingcheck.mjs -- #6393: the bell swing is DRIVEN. Bell.activate(dir) sets lastSideHit, Bell.tick advances
// ticks (stops at 50), and ER.bellAnim gives sin(t/PI)/(4+t/3) toward the hit side. Anti-vacuity: ticks that never advance fail.
import { loadEngine, initRegistry } from './loadsrc.mjs';
const M = loadEngine({ extra: ['02g_items.js', '02f_tags.js', '07b_behaviour.js', '07c_blockentity.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07j_entityrender.js', '07s_raid.js'], dom: false });
initRegistry(M);
const NS = M, ER = M.EntityRender || M.ER;
const run = (tick) => {
  const bad = [];
  M.BlockEntities.init();
  M.Bell.activate(1, 70, 1, 'east');
  const be = M.BlockEntities.get(1, 70, 1);
  if (be.lastSideHit !== 'east') bad.push('lastSideHit not set');
  let last = 0;
  for (let n = 1; n <= 49; n++) {
    tick(be);
    if (n === 1 || n === 10 || n === 49) {
      if (be.ticks !== n) { bad.push('ticks at ' + n + ' = ' + be.ticks); continue; }
      const t = n, s = Math.sin(t / Math.PI) / (4 + t / 3), d = ER.bellAnim(be, 0).deltaFor('bell_body');
      if (Math.abs(d.rz + s) > 1e-9) bad.push('angle at ' + n + ': ' + d.rz + ' vs ' + -s);
    }
  }
  tick(be);
  if (be.ringing || be.ticks !== 0) bad.push('did not stop at 50: ' + be.ticks + ' ringing=' + be.ringing);
  return bad;
};
const real = run(M.Bell.tick);
const breaks = [['ticks never advance', () => {}], ['ticks never stop', (be) => { if (be.ringing) be.ticks++; }]];
let caught = 0;
for (const [n, f] of breaks) { if (run(f).length) { caught++; console.log('   ✓ ' + n); } else console.log(' NOT CAUGHT:', n); }
for (const x of real) console.log(' FAIL:', x);
console.log(` bellswingcheck: 1 assertions, ${real.length} failures, ${caught} breaks caught`);
process.exit(real.length || caught < breaks.length ? 1 : 0);
