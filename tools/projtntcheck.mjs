#!/usr/bin/env node
// projtntcheck.mjs - #8662: TntBlock.onProjectileHit via Cb.PROJ_BLOCK_HIT.tnt.
import { loadEngine, initRegistry } from './loadsrc.mjs';
import fs from 'fs';

const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js', '14b_physics.js',
          '14f_inventory.js', '07f_redstone.js', '09b_sky.js', '07d_mining.js', '07e_loot.js',
          '07h_entities.js', '07i_entitylist.js', '07k_goals.js', '14j_combat.js', '14l_use.js'],
  dom: false
});
initRegistry(M);
const cells = new Map(); const k = (x, y, z) => x + ',' + y + ',' + z;
M.World = { getBlock: (x, y, z) => cells.get(k(x, y, z)) || 0, setBlock: (x, y, z, s) => { cells.set(k(x, y, z), s); return true; },
            get: () => null, getLight: () => 240, heightAt: () => 63, chunks: new Map() };
M.Behave.init(M.World); M.Use.init(M.World);
const Cb = M.Combat, TNT = M.States.stateOf('tnt');
const spawned = [];
M.EntityList.ready = true; M.EntityList.canSpawn = () => true;
M.EntityList.spawn = (t, x, y, z, o) => { spawned.push({ t, x, y, z, o }); return {}; };
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const shooter = { type: 'player', health: 20 };
function shoot(x, fire) {
  cells.clear(); spawned.length = 0; cells.set(k(x, 0, 0), TNT);
  const e = { type: 'arrow', isOnFire: fire, shooter, x, y: 0.5, z: 0.5, vx: 0, vy: 0, vz: 0 };
  Cb.projectileBlockHit(e, { state: TNT, cx: x, cy: 0, cz: 0, face: 'south', hx: x + .5, hy: .5, hz: 1 });
  return cells.get(k(x, 0, 0)) | 0;
}
let cell = shoot(0, true);
ok(spawned.length === 1 && spawned[0].t === 'tnt', 'burning arrow primes one tnt');
ok(spawned[0] && spawned[0].o.fuse === 80 && spawned[0].o.igniter === shooter, 'fuse 80, shooter is igniter');
ok(cell === 0, 'cell is air');
shoot(0, false); ok(spawned.length === 0, 'cold arrow does nothing');
cell = shoot(30000000, true); ok(spawned.length === 0 && cell === TNT, 'burning arrow outside border does nothing');
// anti-vacuity
let breaks = 0;
const src = fs.readFileSync(new URL('../src/14j_combat.js', import.meta.url), 'utf8');
const orig = Cb.PROJ_BLOCK_HIT.tnt;
Cb.PROJ_BLOCK_HIT.tnt = (e, bh) => orig(Object.assign(e, { isOnFire: true }), bh);
shoot(0, false); breaks++;
if (spawned.length === 1) { /* dropped isOnFire test primes a cold arrow: caught */ } else fails.push('anti-vacuity: isOnFire drop not detected');
Cb.PROJ_BLOCK_HIT.tnt = orig;
if (fails.length) { console.log('FAIL\n  ' + fails.join('\n  ')); process.exit(1); }
console.log(`${pass} assertions, 0 failures, ${breaks} breaks caught`);
