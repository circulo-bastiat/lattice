#!/usr/bin/env node
// projblockhitcheck.mjs - #8660: BlockState.onProjectileHit dispatch (Cb.PROJ_BLOCK_HIT), reached from every
// projectile block hit and from no entity hit. Vanilla: ProjectileEntity.onBlockHit (.decomp).
import { loadEngine, initRegistry } from './loadsrc.mjs';

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js', '14b_physics.js',
          '14f_inventory.js', '07f_redstone.js', '09b_sky.js', '07d_mining.js', '07e_loot.js',
          '07h_entities.js', '07i_entitylist.js', '07k_goals.js', '14j_combat.js', '07zzd_throw.js',
          '07zzh_blaze.js', '07zzi_ghast.js', '07zzm_wither.js'],
  dom: false
});
initRegistry(M);
const cells = new Map(); const k = (x, y, z) => x + ',' + y + ',' + z;
M.World = { getBlock: (x, y, z) => cells.get(k(x, y, z)) || 0, setBlock: (x, y, z, s) => { cells.set(k(x, y, z), s); return true; },
            get: () => null, getLight: () => 240, heightAt: () => 63, chunks: new Map() };
M.Behave.init(M.World);
M.EntityList.list = [];
const S = M.States, Cb = M.Combat;
const STONE = S.stateOf('stone');
const reset = () => { cells.clear(); cells.set(k(0, 0, 0), STONE); };
let calls = [];
Cb.PROJ_BLOCK_HIT.stone = (e, bh) => { calls.push({ e, bh }); return 1; };

// each case: build a projectile flying into the south face of the stone at 0,0,0, tick it with the real tick fn
const wall = (type, extra) => Object.assign({ type, x: 0.5, y: 0.5, z: 1.5, vx: 0, vy: 0, vz: -0.8, shooter: null, age: 0, width: 0.25, height: 0.25 }, extra || {});
const cases = {
  arrow:        () => { const e = wall('arrow', { drag: 0.99, gravity: 0.05 }); Cb.tickArrow(e); },
  trident:      () => { const e = wall('trident', { drag: 0.99, gravity: 0.05 }); Cb.tickTrident(e); },
  snowball:     () => { Cb.tickSnowball(wall('snowball', { horizontalCollision: true, z: 1.05 })); },
  egg:          () => { M.Throw.tickEgg(wall('egg', { horizontalCollision: true, z: 1.05 })); },
  ender_pearl:  () => { M.Throw.tickPearl(wall('ender_pearl', { pearlHit: true, z: 1.05 })); },
  fireball:     () => { M.Ghast.tickFireball(wall('fireball', { explosionPower: 1, powerX: 0, powerY: 0, powerZ: 0 })); },
  small_fireball: () => { M.Blaze.Fireball.tickSmall(wall('small_fireball', { powerX: 0, powerY: 0, powerZ: 0, power: [0, 0, 0] })); },
  wither_skull: () => { M.Wither.tickSkull(wall('wither_skull', { onGround: true, z: 1.05 })); }
};
console.log('projblockhitcheck - Block.onProjectileHit dispatch');
for (const [name, run] of Object.entries(cases)) {
  reset(); calls = [];
  try { run(); } catch (err) { fails.push(name + ' threw ' + err.message); continue; }
  ok(calls.length === 1, name + ' block hit fires the stone handler exactly once (got ' + calls.length + ')');
  if (calls.length) ok(calls[0].bh.cx === 0 && calls[0].bh.cy === 0 && calls[0].bh.cz === 0 && calls[0].e.type === name, name + ': handler gets the hit block and the projectile');
}
// entity hit, no block: nothing fires
{
  reset(); calls = [];
  const mob = { type: 'zombie', x: 10.5, y: 0, z: 10.5, width: 0.6, height: 1.95, maxHealth: 20, health: 20 };
  M.EntityList.list = [mob];
  const e = wall('egg', { x: 10.5, y: 1, z: 10.5 });
  M.Throw.tickEgg(e);
  ok(calls.length === 0 && e.removed, 'egg entity hit does not fire the block handler');
  M.EntityList.list = [];
}
// anti-vacuity: each call site, dropped, must turn its case red
const dropped = [];
for (const name of Object.keys(cases)) {
  reset(); calls = [];
  const real = Cb.projectileBlockHit, realFind = Cb.projectileBlockHitFind;
  Cb.projectileBlockHit = () => -1; Cb.projectileBlockHitFind = () => -1;
  try { cases[name](); } catch (err) { /* a dropped site may not run on */ }
  Cb.projectileBlockHit = real; Cb.projectileBlockHitFind = realFind;
  breaks++;
  if (calls.length === 0) dropped.push(name); else fails.push('anti-vacuity: ' + name + ' still fires with the dispatch cut');
}
ok(dropped.length === Object.keys(cases).length, 'every dropped call site goes red');
pass += 0;
if (fails.length) { console.log('FAIL\n  ' + fails.join('\n  ')); process.exit(1); }
console.log(`${pass} assertions, 0 failures, ${breaks} breaks caught`);
