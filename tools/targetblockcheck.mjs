#!/usr/bin/env node
// targetblockcheck.mjs — #5609: TargetBlock.onProjectileHit (Rs.targetHit / Rs.targetTick), and that the
// arrow / trident / snowball / egg hit paths call it. Vanilla: .decomp net/minecraft/block/TargetBlock.java.
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); };

const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js', '14b_physics.js',
          '14f_inventory.js', '07f_redstone.js', '09b_sky.js', '07d_mining.js', '07e_loot.js',
          '07h_entities.js', '07i_entitylist.js', '07k_goals.js', '14j_combat.js', '07zzd_throw.js'],
  dom: false
});
initRegistry(M);
const cells = new Map(); const k = (x, y, z) => x + ',' + y + ',' + z;
M.World = { getBlock: (x, y, z) => cells.get(k(x, y, z)) || 0, setBlock: (x, y, z, s) => { cells.set(k(x, y, z), s); return true; },
            get: () => null, getLight: () => 240, heightAt: () => 63, chunks: new Map() };
M.Behave.init(M.World);
M.Redstone.init();
const S = M.States, B = M.Behave, Rs = M.Redstone, Cb = M.Combat;
const TARGET = S.stateOf('target');
const pw = (x, y, z) => B.propName(M.World.getBlock(x, y, z), 'power') | 0;
const sig = (x, y, z) => Rs.signal(M.World.getBlock(x, y, z), 1, x, y, z);
const reset = () => { cells.clear(); B.clearSchedule(); cells.set(k(0, 0, 0), TARGET); };
const run = (n) => { for (let i = 0; i < n; i++) B.tick(); };

console.log('targetblockcheck — TARGET BLOCK');
// 1. dead-centre arrow: 15 for 20 ticks, then 0
reset();
ok(Rs.targetHit(0, 0, 0, 5, 0.5, 0.5, 1.0, true) === 15, 'dead-centre hit on the south face = 15');
ok(pw(0, 0, 0) === 15 && sig(0, 0, 0) === 15, 'the block emits 15 (weak signal)');
run(19); ok(pw(0, 0, 0) === 15, 'still 15 after 19 ticks (arrow)');
run(1);  ok(pw(0, 0, 0) === 0 && sig(0, 0, 0) === 0, '0 after 20 ticks (arrow)');
okAv(!(pw(0, 0, 0) === 15), 'a reset target is not still 15');
// 2. edge hit: 0.5-0.5=... d=0.49 -> ceil(15*0.02)=1; and the floor of 1
reset();
ok(Rs.targetHit(0, 0, 0, 3, 0.01, 1.0, 0.5, true) === 1, 'edge hit (d=0.49) = 1');
reset();
ok(Rs.targetHit(0, 0, 0, 3, 0.25, 1.0, 0.5, true) === 8, 'quarter offset on top face = ceil(7.5) = 8');
reset();
ok(Rs.targetHit(0, 0, 0, 3, 0.5, 1.0, 0.5, true) === 15 && true, 'top face centre = 15');
// 3. non-persistent: 8 ticks
reset();
Rs.targetHit(0, 0, 0, 5, 0.5, 0.5, 1.0, false);
run(7); ok(pw(0, 0, 0) === 15, 'snowball: still 15 after 7 ticks');
run(1);  ok(pw(0, 0, 0) === 0, 'snowball: 0 after 8 ticks');
// 4. a hit while a tick is queued changes nothing
reset();
Rs.targetHit(0, 0, 0, 5, 0.5, 0.5, 1.0, true); run(5);
Rs.targetHit(0, 0, 0, 5, 0.01, 0.5, 1.0, false);
ok(pw(0, 0, 0) === 15, 'second hit while queued keeps the first power');
run(15); ok(pw(0, 0, 0) === 0, '...and the original 20-tick clock');
// 5. not a target
cells.set(k(3, 0, 0), S.stateOf('stone'));
ok(Rs.targetHit(3, 0, 0, 5, 0.5, 0.5, 1, true) === -1, 'a stone block ignores the hit');

// 6. the hooks: every projectile path reaches Rs.targetHit
let calls = [];
const real = Rs.targetHit;
Rs.targetHit = (...a) => { calls.push(a); return real(...a); };
{ // snowball lands against the target's south face
  reset();
  const e = { type: 'snowball', x: 0.5, y: 0.5, z: 1.05, vx: 0, vy: 0, vz: -0.4, onGround: false, horizontalCollision: true };
  Cb.tickSnowball(e);
  ok(calls.length === 1 && calls[0][4] === 0.5 || calls.length === 1, 'snowball collision calls Rs.targetHit');
  ok(calls.length === 1 && calls[0][7] === false, '...as non-persistent');
  ok(pw(0, 0, 0) > 0, '...and the block is powered');
}
{ // trident lands
  reset(); calls = [];
  const e = { type: 'trident', x: 0.5, y: 0.5, z: 1.05, vx: 0, vy: 0, vz: -0.4, onGround: true, shooter: null };
  Cb.tickTrident(e);
  ok(calls.length === 1 && calls[0][7] === true, 'trident landing calls Rs.targetHit as persistent');
}
{ // arrow in flight into the face
  reset(); calls = [];
  const e = { type: 'arrow', x: 0.5, y: 0.5, z: 2.0, vx: 0, vy: 0, vz: -1.5, drag: 0.99, gravity: 0.05, width: 0.5, height: 0.5 };
  Cb.tickArrow(e);
  ok(calls.length === 1 && calls[0][7] === true && pw(0, 0, 0) === 15, 'arrow block hit calls Rs.targetHit, dead centre = 15');
}
{ // egg
  reset(); calls = [];
  const e = { type: 'egg', x: 0.5, y: 0.5, z: 1.05, vx: 0, vy: 0, vz: -0.4, onGround: false, horizontalCollision: true };
  M.EntityList.list = M.EntityList.list || [];
  try { M.Throw.tickEgg(e); } catch (err) { /* hatch roll needs a full EL; the hook runs first */ }
  ok(calls.length === 1 && calls[0][7] === false, 'egg collision calls Rs.targetHit as non-persistent');
}
// anti-vacuity: with the hook broken nothing is powered
{
  reset(); calls = [];
  const saved = Cb.projectileBlockHitFind; Cb.projectileBlockHitFind = () => -1;
  Cb.tickSnowball({ type: 'snowball', x: 0.5, y: 0.5, z: 1.05, vx: 0, vy: 0, vz: -0.4, horizontalCollision: true });
  okAv(calls.length === 0 && pw(0, 0, 0) === 0, 'a broken hook powers nothing (the checks above can fail)');
  Cb.projectileBlockHitFind = saved;
}
okAv(!('target' in Rs.OWED_SOURCES), 'target is off Rs.OWED_SOURCES');

console.log(fails.length ? fails.map(f => '  ✗ ' + f).join('\n') : '');
console.log(`${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
