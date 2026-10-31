#!/usr/bin/env node
// projcampfirecheck.mjs - #8663: CampfireBlock.onProjectileHit via Cb.PROJ_BLOCK_HIT (.decomp CampfireBlock.java).
import { loadEngine, initRegistry } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js', '14b_physics.js',
          '14f_inventory.js', '07f_redstone.js', '09b_sky.js', '07d_mining.js', '07e_loot.js',
          '07h_entities.js', '07i_entitylist.js', '07k_goals.js', '14j_combat.js'],
  dom: false
});
initRegistry(M);
const cells = new Map();
M.World = { getBlock: () => cells.get('c') || 0, setBlock: (x, y, z, s) => { cells.set('c', s); return true; }, get: () => null, getLight: () => 240, heightAt: () => 63, chunks: new Map() };
M.Behave.init(M.World);
const S = M.States, B = M.Behave, Cb = M.Combat;
const mk = (name, props) => { let s = S.stateOf(name); for (const k in props) s = B.setProp(s, k, props[k]); return s; };
const fire = (name, props, burning) => {
  const st = mk(name, props); cells.set('c', st);
  Cb.projectileBlockHit({ type: 'arrow', isOnFire: burning, remainingFireTicks: burning ? 100 : 0 }, { state: st, cx: 0, cy: 0, cz: 0, face: 1, hx: 0, hy: 0, hz: 0 });
  return cells.get('c') === st ? 'same' : B.propName(cells.get('c'), 'lit');
};
console.log('projcampfirecheck - CampfireBlock.onProjectileHit');
const run = () => {
  const r = [];
  for (const n of ['campfire', 'soul_campfire']) {
    r.push([n + ' unlit dry burning lights', fire(n, { lit: false, waterlogged: false }, true), 'true']);
    r.push([n + ' waterlogged unchanged', fire(n, { lit: false, waterlogged: true }, true), 'same']);
    r.push([n + ' already lit unchanged', fire(n, { lit: true, waterlogged: false }, true), 'same']);
    r.push([n + ' not burning unchanged', fire(n, { lit: false, waterlogged: false }, false), 'same']);
  }
  return r;
};
for (const [m, got, want] of run()) ok(got === want, m + ' (got ' + got + ')');
// anti-vacuity: drop the WATERLOGGED test
const real = Cb.PROJ_BLOCK_HIT.campfire;
Cb.PROJ_BLOCK_HIT.campfire = Cb.PROJ_BLOCK_HIT.soul_campfire = (e, bh) => {
  const st = bh.state; if (!(e.isOnFire) || B.propName(st, 'lit') === 'true') return -1;
  M.World.setBlock(0, 0, 0, B.setProp(st, 'lit', true)); return 1;
};
breaks++;
ok(run().some(([, got, want]) => got !== want), 'dropping the waterlogged test goes red');
Cb.PROJ_BLOCK_HIT.campfire = Cb.PROJ_BLOCK_HIT.soul_campfire = real;
if (fails.length) { console.log('FAIL\n  ' + fails.join('\n  ')); process.exit(1); }
console.log(`${pass} assertions, 0 failures, ${breaks} breaks caught`);
