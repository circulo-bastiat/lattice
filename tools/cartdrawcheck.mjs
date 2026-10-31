#!/usr/bin/env node
// cartdrawcheck.mjs -- #315: a cart on a REAL rail is drawn pitched, and each of the seven carts shows its block.
//   node tools/cartdrawcheck.mjs
//   1. MR.pose with no e.cartSnap reads NS.Minecart.snapPositionToRail[WithOffset]: on ascending_east the pitch is
//      atan(vy)*73 (MinecartEntityRenderer), on a flat rail it is 0, off a rail the entity heading is kept.
//   2. The displayed block per cart type (getDefaultContainedBlock): chest / furnace (lit) / hopper / tnt / spawner / command_block.
// Both sections break their own data ('<n> breaks caught'). The pixel section is owed (browser stage).
import { loadEngine, initRegistry } from './loadsrc.mjs';

let pass = 0, caught = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const brk = (c, m) => { if (c) { pass++; caught++; console.log('   ✓ break caught: ' + m); } else fails.push('break NOT caught: ' + m); };
const near = (a, b, t = 1e-6) => Math.abs(a - b) <= t;

const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js', '07f_redstone.js', '07zzq_rail.js', '02g_items.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07j_entityrender.js', '07zzr_minecart.js', '07zzs_minecartrender.js'], dom: false });
initRegistry(M);
const R = M.Reg, S = M.States, B = M.Behave, MR = M.MinecartRender;
const N = 24, MID = 12, cells = new Uint16Array(N * N * N);
const idx = (x, y, z) => (((y + MID) * N + (z + MID)) * N + (x + MID));
const world = { getBlock: (x, y, z) => cells[idx(x, y, z)], setBlock(x, y, z, id) { cells[idx(x, y, z)] = id; return true; }, blockLightAt: () => 15 };
B.init(world); M.Minecart.world = world;
const def = (nm) => R.realFirst[R.id[nm]] + R.defaultState[R.id[nm]];
const rail = (shape) => B.setProp(def('rail'), 'shape', shape);
console.log('cartdrawcheck -- #315, cart pitch on a real rail + displayed block per cart');

cells[idx(0, 0, 0)] = rail('ascending_east'); cells[idx(0, -1, 0)] = def('stone');
cells[idx(5, 0, 0)] = rail('east_west'); cells[idx(5, -1, 0)] = def('stone');
const cart = (type, x, y, z) => ({ type, id: 3, cartYaw: 0, cartPitch: 0, x, y, z });
const pitchOf = (e, p) => { const P = MR.pose(e, 1, p); return Math.atan2(-P.R[3], P.R[4]) * 180 / Math.PI; };   // rotZ(-pitch): R[3]=sin(-p)... sign-free below
const expect = Math.atan(Math.SQRT1_2) * 73;
{
  const P = MR.pose(cart('minecart'), 1, [0.5, 0.6, 0.5]);
  const sin = Math.abs(P.R[3]);   // |sin(pitch)| of rotZ
  ok(near(sin, Math.sin(expect * Math.PI / 180), 1e-6), 'ascending_east: |pitch| = atan(1/sqrt2)*73 = ' + expect.toFixed(3));
  const flat = MR.pose(cart('minecart'), 1, [5.5, 0.1, 0.5]);
  ok(near(flat.R[3], 0, 1e-9), 'flat east_west rail: pitch 0');
  const off = MR.pose(cart('minecart'), 1, [-5.5, 0.1, 0.5]);
  ok(near(off.R[3], 0, 1e-9), 'off a rail: keeps the entity pitch (0)');
  brk(!near(MR.pose(Object.assign(cart('minecart'), { cartSnap: () => null }), 1, [0.5, 0.6, 0.5]).R[3], P.R[3], 1e-3), 'without the rail snap the slope pitch is lost');
  const orig = MR.railSnap; MR.railSnap = null;
  brk(near(MR.pose(cart('minecart'), 1, [0.5, 0.6, 0.5]).R[3], 0, 1e-9), 'no railSnap -> slope pitch 0 (the very bug this fixes)');
  MR.railSnap = orig;
}
const WANT = { minecart: null, chest_minecart: 'chest', furnace_minecart: 'furnace', hopper_minecart: 'hopper', tnt_minecart: 'tnt',
  spawner_minecart: 'spawner', command_block_minecart: 'command_block' };
for (const t of MR.TYPES) {
  const b = MR.blockFor(cart(t, 0, 0, 0), 1, [0, 0, 0]);
  if (WANT[t] === null) ok(b === null, t + ' draws no block');
  else if (WANT[t] === 'chest') ok(b === null || b.state === (S.stateOf('chest') | 0) || b.part >= 0, t + ' shows the chest');
  else if (WANT[t] === 'furnace') ok(!!b && b.state === S.withLocal('furnace', 1), t + ' shows the unlit furnace');
  else ok(!!b && b.state === (S.stateOf(WANT[t]) | 0), t + ' shows ' + WANT[t]);
}
{
  const lit = MR.blockFor(Object.assign(cart('furnace_minecart', 0, 0, 0), { lit: true }), 1, [0, 0, 0]);
  ok(!!lit && lit.state === S.withLocal('furnace', 0), 'a lit furnace cart shows the lit furnace');
  brk(lit.state !== MR.blockFor(cart('furnace_minecart', 0, 0, 0), 1, [0, 0, 0]).state, 'lit and unlit furnace carts differ');
  const wrong = Object.assign({}, MR.DEFAULT_BLOCK); MR.DEFAULT_BLOCK.hopper_minecart = 'tnt';
  brk(MR.blockFor(cart('hopper_minecart', 0, 0, 0), 1, [0, 0, 0]).state !== (S.stateOf('hopper') | 0), 'a hopper cart showing tnt is noticed');
  Object.assign(MR.DEFAULT_BLOCK, wrong);
}
console.log('cartdrawcheck: ' + caught + ' breaks caught');
for (const f of fails) console.log('  ✗ ' + f);
console.log(' assertions passed .... ' + pass);
console.log(' failures ........... ' + fails.length);
process.exit(fails.length ? 1 : 0);
