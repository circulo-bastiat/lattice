#!/usr/bin/env node
// critical arrow CRIT trail: 4 Px.spawn('crit') per flying tick (PersistentProjectileEntity.tick :209-220).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
          '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js',
          '14j_combat.js', '07zw_mobnbt.js'], dom: false });
initRegistry(M);
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Ai.init();
M.World = Object.assign(M.World || {}, { getBlock: () => 0, setBlock: () => true, get: () => null });
const Cb = M.Combat, EL = M.EntityList;
const calls = [];
M.Particle = { spawn: (t, ...a) => { calls.push([t, ...a]); return true; } };
const near = (a, b) => Math.abs(a - b) < 1e-9;
function shoot(type, crit) {
  const e = EL.spawn(type, 0.5, 64, 0.5, { vx: 1.2, vy: 0.4, vz: -0.8 });
  e.critical = crit; return e;
}
const e = shoot('arrow', true);
for (let t = 0; t < 3; t++) {
  const ox = e.x, oy = e.y, oz = e.z, vx = e.vx, vy = e.vy, vz = e.vz;
  calls.length = 0; Cb.tickArrow(e);
  ok(calls.length === 4 && calls.every((c) => c[0] === 'crit'), `tick ${t}: 4 crit, got ${calls.length}`);
  for (let i = 0; i < calls.length; i++) {
    const c = calls[i];
    ok(near(c[1], ox + vx * i / 4) && near(c[2], oy + vy * i / 4) && near(c[3], oz + vz * i / 4), `tick ${t} pt ${i} pos`);
    ok(near(c[4], -vx) && near(c[5], -vy + 0.2) && near(c[6], -vz), `tick ${t} pt ${i} vel`);
  }
}
const h = shoot('arrow', false); calls.length = 0; Cb.tickArrow(h);
ok(calls.length === 0, 'half-draw arrow emits nothing');
const s = shoot('spectral_arrow', true); calls.length = 0; Cb.tickArrow(s);
ok(calls.length === 4, 'spectral arrow emits 4');
const g = shoot('arrow', true); g.stuck = true; calls.length = 0; Cb.tickArrow(g);
ok(calls.length === 0, 'stuck arrow emits nothing');
// break: critical flag dropped -> emit skipped, must be detected
const b = shoot('arrow', false); calls.length = 0; Cb.tickArrow(b);
if (calls.length !== 4) { breaks++; console.log('   ✓ anti-vacuity: break caught'); } else fails.push('break 1 not caught');
M.Particle = null; const b2 = shoot('arrow', true); calls.length = 0; Cb.tickArrow(b2);
if (calls.length !== 4) { breaks++; console.log('   ✓ anti-vacuity: break caught'); } else fails.push('break 2 not caught');
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(` ${breaks} breaks caught`);
process.exit(fails.length || breaks < 2 ? 1 : 0);
