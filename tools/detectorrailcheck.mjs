#!/usr/bin/env node
// detectorrailcheck.mjs -- G17-M1 (#5143): DetectorRailBlock (.decomp block/DetectorRailBlock.java) in src/07zzr_minecart.js.
//   a cart in the 0.2-inset box powers the rail the tick it enters; it stays powered, re-checked every 20 ticks, and
//   drops 20 ticks after the cart leaves; weak power 15 everywhere, strong power 15 only for UP (a lamp beside the
//   block below lights); the Rs.OWED_SOURCES.detector_rail and ANALOG 'owed' rows are struck.
// Anti-vacuity: no-carts lookup, tick period 21, strong power in every direction.
import { loadEngine } from './loadsrc.mjs';

console.log('detectorrailcheck -- G17-M1 (#5143), DetectorRailBlock: cart detection, 20-tick period, strong power only UP');

function scenarios(patch) {
  const fails = []; let n = 0;
  const ok = (c, m) => { n++; if (!c) fails.push(m); return c; };
  const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js', '14b_physics.js', '14f_inventory.js', '07f_redstone.js', '07zzq_rail.js', '07zzr_minecart.js'], dom: false, patch });
  const R = M.Reg, B = M.Behave, Mc = M.Minecart, Rs = M.Redstone;
  const N = 24, MID = 12, cells = new Uint16Array(N * N * N);
  const idx = (x, y, z) => (((y + MID) * N + (z + MID)) * N + (x + MID));
  const world = {
    getBlock: (x, y, z) => cells[idx(x, y, z)],
    setBlock(x, y, z, id) { const old = cells[idx(x, y, z)]; cells[idx(x, y, z)] = id; B.changed(x, y, z, old); return true; },
    blockLightAt: () => 15,
  };
  B.init(world); Rs.init(); Mc.world = world;
  M.EntityList = { list: [] };
  const def = (nm) => R.realFirst[R.id[nm]] + R.defaultState[R.id[nm]];
  for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) cells[idx(x, -1, z)] = def('stone');
  cells[idx(1, -1, 0)] = def('redstone_lamp');
  const rail = B.setProp(def('detector_rail'), 'shape', 'east_west');
  world.setBlock(0, 0, 0, rail);
  const powered = () => B.propName(world.getBlock(0, 0, 0), 'powered') === 'true';
  const lit = () => B.propName(world.getBlock(1, -1, 0), 'lit') === 'true';
  const tick = () => { B.tick(); B.gameTime = B.gameTime; };
  ok(!powered(), 'starts unpowered');
  // a cart overlapping only the inset margin does not count (x 0.9 +- 0.49 reaches 0.41 > 0.2 ... use far side)
  const cart = { type: 'minecart', x: 0.5, y: 0, z: 0.5, width: 0.98, height: 0.7 };
  M.EntityList.list.push(cart);
  Mc.detectorCollide(cart);
  ok(powered(), 'powered the tick the cart enters');
  ok(Rs.directSignal(world.getBlock(0, 0, 0), Rs.UP, 0, 0, 0) === 15, 'strong power UP is 15');
  for (const d of [Rs.DOWN, Rs.NORTH, Rs.SOUTH, Rs.EAST, Rs.WEST])
    ok(Rs.directSignal(world.getBlock(0, 0, 0), d, 0, 0, 0) === 0, 'strong power 0 for dir ' + d);
  ok(Rs.signal(world.getBlock(0, 0, 0), Rs.EAST, 0, 0, 0) === 15, 'weak power 15');
  ok(lit(), 'lamp beside the block below lights (strong power into the block below)');
  for (let i = 0; i < 45; i++) tick();
  ok(powered(), 'still powered while the cart stays (re-checked on the period)');
  M.EntityList.list.length = 0;
  let off = -1;
  for (let i = 1; i <= 60 && off < 0; i++) { tick(); if (!powered()) off = i; }
  ok(off > 0 && off <= 20, 'unpowers within 20 ticks of the cart leaving (got ' + off + ')');
  // exactness: enter, leave right after the re-check, the drop lands exactly 20 ticks after the last check
  M.EntityList.list.push(cart); Mc.detectorCollide(cart);
  ok(powered(), 'repowers');
  M.EntityList.list.length = 0;
  for (let i = 1; i < 20; i++) tick();
  ok(powered(), 'still powered 19 ticks after the cart left');
  tick();
  ok(!powered(), 'unpowered exactly 20 ticks after the scheduled check');
  for (let i = 0; i < 5; i++) tick();
  ok(!lit(), 'lamp out again');
  // a cart not in the inset box (x edge) is ignored
  const edge = { type: 'minecart', x: -0.6, y: 0, z: 0.5, width: 0.98, height: 0.7 };
  M.EntityList.list.push(edge); Mc.detectorCollide(edge);
  ok(!powered(), 'cart outside the box does not power');
  M.EntityList.list.length = 0;
  // G17-M2: comparator output
  const rl = () => Rs.analogOutput(0, 0, 0, world.getBlock(0, 0, 0));
  ok(Rs.hasAnalogOutput(world.getBlock(0, 0, 0)), 'detector rail has analog output');
  ok(rl() === 0, 'no cart reads 0');
  const ch = { type: 'chest_minecart', x: 0.5, y: 0, z: 0.5, width: 0.98, height: 0.7, inventory: [] };
  M.EntityList.list.push(ch);
  ok(rl() === 0, 'empty chest cart reads 0');
  for (let i = 0; i < 3; i++) ch.inventory[i] = { item: 'cobblestone', count: 64 };
  ok(rl() === Math.floor(3 / 27 * 14) + 1, 'chest cart with 3 full stacks reads ' + (Math.floor(3 / 27 * 14) + 1) + ', got ' + rl());
  M.EntityList.list.length = 0;
  ok(rl() === 0, 'cart gone reads 0');
  M.EntityList.list.push({ type: 'command_block_minecart', x: 0.5, y: 0, z: 0.5, width: 0.98, height: 0.7, successCount: 7 });
  ok(rl() === 7, 'command block cart reads its success count');
  M.EntityList.list.length = 0;
  ok(Rs.OWED_SOURCES.detector_rail === undefined, 'OWED_SOURCES.detector_rail struck');
  ok(!Rs.ANALOG_SHAPES.some((r) => r[0].includes('detector_rail') && r[1] === 'owed'), 'ANALOG owed row no longer says G18 entities');
  return { fails, n };
}

let fails = [], breaks = 0;
const base = scenarios();
fails.push(...base.fails);
console.log('   ' + base.n + ' assertions');
const brk = (name, f, from, to) => {
  const patch = (file, src) => (file === f ? (src.includes(from) ? src.split(from).join(to) : (() => { throw new Error('anti-vacuity patch missed: ' + name); })()) : src);
  let r; try { r = scenarios(patch); } catch (e) { r = { fails: ['threw ' + e.message] }; }
  if (r.fails.length) { breaks++; console.log('   ✓ break caught: ' + name); } else fails.push('anti-vacuity: ' + name + ' went unnoticed');
};
brk('cart lookup returns no carts', '07zzr_minecart.js', 'if (!EL || !EL.list) return out;', 'return out;');
brk('inventory branch removed', '07zzr_minecart.js', 'return cartComparator(cs[i]);', 'return 0;');
brk('tick period 21', '07zzr_minecart.js', 'Mc.DETECTOR_PERIOD = 20;', 'Mc.DETECTOR_PERIOD = 21;');
brk('strong power in every direction', '07f_redstone.js', 'if (dir !== Rs.UP) return 0;\n      var ppw', 'var ppw');
if (fails.length) { console.log('FAIL\n' + fails.map((f) => ' - ' + f).join('\n')); process.exit(1); }
console.log(`detectorrailcheck: ${base.n} assertions, 0 failures, ${breaks} breaks caught`);
