#!/usr/bin/env node
// endermite client portal particles: 2 Px.spawn('portal') per EL.tick (EndermiteEntity.tickMovement :126-137).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
          '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js',
          '14j_combat.js', '07zg_enderman.js', '07zn2_endermite.js', '07zw_mobnbt.js'], dom: false });
initRegistry(M);
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Ai.init();
M.World = Object.assign(M.World || {}, { getBlock: () => 0, setBlock: () => true, get: () => null });
const Em = M.Endermite, EL = M.EntityList;
const calls = [];
M.Particle = { spawn: (t, ...a) => { calls.push(t); return true; } };
const e = EL.spawn('endermite', 0.5, 64, 0.5, {});
calls.length = 0;
Em.tick(e); Em.tick(e);
ok(calls.length === 4 && calls.every((t) => t === 'portal'), `2 portal particles per tick — got ${calls.length}`);
// break 1: no Particle module -> nothing spawns (must be detected as != 2)
const saved = M.Particle; M.Particle = null; calls.length = 0; Em.tick(e);
if (calls.length !== 2) { breaks++; console.log("   ✓ anti-vacuity: break caught"); } else fails.push('break 1 not caught');
M.Particle = saved;
// break 2: a removed mite emits nothing
e.removed = true; calls.length = 0; Em.tick(e);
if (calls.length !== 2) { breaks++; console.log("   ✓ anti-vacuity: break caught"); } else fails.push('break 2 not caught');
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(` ${breaks} breaks caught`);
process.exit(fails.length || breaks < 2 ? 1 : 0);
