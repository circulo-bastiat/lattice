#!/usr/bin/env node
// projbellcheck.mjs - #8661: BellBlock.onProjectileHit (.decomp) rings only for sides isPointOnBell accepts.
import { loadEngine, initRegistry } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js', '14b_physics.js', '14f_inventory.js',
          '07f_redstone.js', '09b_sky.js', '07d_mining.js', '07e_loot.js', '07h_entities.js', '07i_entitylist.js',
          '07k_goals.js', '14j_combat.js', '07s_raid.js', '07zv7_vbbell.js'],
  dom: false
});
initRegistry(M);
const cells = new Map(); const k = (x, y, z) => x + ',' + y + ',' + z;
M.World = { getBlock: (x, y, z) => cells.get(k(x, y, z)) || 0, setBlock: (x, y, z, s) => { cells.set(k(x, y, z), s); return true; },
            get: () => null, getLight: () => 240, heightAt: () => 63, chunks: new Map() };
M.Behave.init(M.World); M.BlockEntities.init(); M.EntityList.list = [];
const B = M.Behave, Cb = M.Combat;
const bell = (att, facing) => B.setProp(B.setProp(M.States.stateOf('bell'), 'attachment', att), 'facing', facing);
const FACES = { east: 0, west: 1, up: 2, down: 3, south: 4, north: 5 };
const hit = (st, side, hy) => {
  const x = 0, y = 0, z = 0;
  cells.clear(); cells.set(k(x, y, z), st); M.BlockEntities.clear();
  const f = FACES[side];
  Cb.projectileBlockHit({ type: 'arrow', shooter: null }, { state: st, cx: x, cy: y, cz: z, face: f, hx: 0.5, hy: hy === undefined ? 0.5 : hy, hz: 0.5 });
  const be = M.BlockEntities.get(x, y, z);
  return be && be.ringing ? be : null;
};
// expected per isPointOnBell: [attachment, facing, side, rings]
const T = [
  ['floor', 'north', 'north', true], ['floor', 'north', 'south', true], ['floor', 'north', 'east', false], ['floor', 'east', 'east', true], ['floor', 'east', 'north', false],
  ['single_wall', 'north', 'east', true], ['single_wall', 'north', 'north', false],
  ['double_wall', 'east', 'north', true], ['double_wall', 'east', 'east', false],
  ['ceiling', 'north', 'east', true], ['ceiling', 'north', 'north', true],
  ['floor', 'north', 'up', false], ['ceiling', 'north', 'down', false]
];
console.log('projbellcheck - BellBlock.onProjectileHit');
for (const [att, fa, side, rings] of T) {
  const be = hit(bell(att, fa), side);
  ok(!!be === rings, att + ' ' + fa + ' hit on ' + side + (rings ? ' rings' : ' does not ring'));
  if (rings && be) ok(be.ticks === 0 && be.lastSideHit === side, att + ' ' + side + ': ticks/lastSideHit equal the use-path values');
}
ok(!hit(bell('floor', 'north'), 'north', 0.9), 'hit above y 0.8124 does not ring');
// use-path reference
M.VBBell.ring(0, 0, 0, 'south'); const ref = M.BlockEntities.get(0, 0, 0);
ok(ref.ticks === 0 && ref.lastSideHit === 'south' && ref.ringing, 'use path values');
// anti-vacuity: remove the handler
const real = Cb.PROJ_BLOCK_HIT.bell; delete Cb.PROJ_BLOCK_HIT.bell; breaks++;
ok(!hit(bell('ceiling', 'north'), 'east'), 'handler reverted: bell no longer rings');
Cb.PROJ_BLOCK_HIT.bell = real;
if (fails.length) { console.log('FAIL\n  ' + fails.join('\n  ')); process.exit(1); }
console.log(`${pass} assertions, 0 failures, ${breaks} breaks caught`);
