#!/usr/bin/env node
// storagecartcheck.mjs -- #313 (#313): chest / hopper minecarts (StorageMinecartEntity, ChestMinecartEntity,
// HopperMinecartEntity) in src/07zzr_minecart.js, headless: items survive a save, a hopper cart pulls from a chest
// above and stops on a powered activator rail, a detector under a half-full chest cart reads
// ScreenHandler.calculateComparatorOutput. Anti-vacuity: edited source must fail.
import { loadEngine } from './loadsrc.mjs';
console.log('storagecartcheck -- #313 (#313), chest and hopper minecarts');

function scenarios(patch) {
  const fails = []; let n = 0;
  const ok = (c, m) => { n++; if (!c) fails.push(m); };
  const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js', '07f_redstone.js', '07zzq_rail.js', '07zzr_minecart.js'], dom: false, patch });
  const Mc = M.Minecart;
  const world = { getBlock: () => 0, setBlock: () => true, blockLightAt: () => 15 };
  M.Behave.init(world); M.Redstone.init(); Mc.world = world;
  const mk = (type, x, y, z) => { const e = { id: 1, type, x, y, z, px: x, py: y, pz: z, vx: 0, vy: 0, vz: 0, yaw: 0, width: 0.98, height: 0.7, age: 0, removed: false, onGround: true, fallDistance: 0 }; Mc.init(e, {}); return e; };

  // 1. items survive a save (writeNbt -> readNbt), both kinds, slot bounds respected
  const c = mk('chest_minecart', 0.5, 5, 0.5);
  c.inventory[0] = { item: 'cobblestone', count: 64 }; c.inventory[26] = { item: 'apple', count: 3 };
  const nb = JSON.parse(JSON.stringify(Mc.writeNbt(c)));
  const c2 = mk('chest_minecart', 0.5, 5, 0.5); Mc.readNbt(c2, nb);
  ok(c2.inventory[0] && c2.inventory[0].item === 'cobblestone' && c2.inventory[0].count === 64 && c2.inventory[26].item === 'apple' && c2.inventory[26].count === 3, 'chest cart items round trip');
  const h = mk('hopper_minecart', 0.5, 5, 0.5);
  h.inventory[4] = { item: 'stick', count: 7 }; h.inventory[5] = { item: 'stick', count: 1 };
  const hn = Mc.writeNbt(h);
  ok(hn.Items.length === 1 && hn.Items[0].Slot === 4, 'hopper cart saves 5 slots only');
  const h2 = mk('hopper_minecart', 0.5, 5, 0.5); Mc.readNbt(h2, JSON.parse(JSON.stringify(hn)));
  ok(h2.inventory[4].count === 7, 'hopper cart items round trip');
  ok(Mc.INVENTORY.chest_minecart === 27 && Mc.INVENTORY.hopper_minecart === 5, 'sizes 27 and 5');

  // 2. hopper cart pulls from a chest above, stops under a powered activator rail
  const chest = { type: 'chest', items: [{ i: 1, n: 2 }, null] };
  M.BlockEntities = { get: (x, y, z) => (x === 0 && y === 6 && z === 0 ? chest : null), isHopperTarget: (t) => t === 'chest',
    hopperSlotsFor: () => [0, 1], hopperMayTake: () => true };
  M.Items = { nameOf: () => 'dirt' };
  M.Inventory = { isEmpty: (s) => !s || !(s.n > 0), maxStackSize: () => 64, stack: (i) => ({ item: i }) };
  const hc = mk('hopper_minecart', 0.5, 5, 0.5);
  Mc.onActivatorRail(hc, false);
  const pulled = () => hc.inventory.reduce((a, s) => a + (s ? s.count : 0), 0);
  ok(pulled() >= 0, 'sanity');
  const before = chest.items[0].n;
  Mc.canOperate(hc);
  ok(pulled() === 1 && chest.items[0].n === before - 1, 'hopper cart sucks one item from the chest above');
  const hl = mk('hopper_minecart', 0.5, 5, 0.5);
  Mc.onActivatorRail(hl, true);
  ok(hl.hopperEnabled === false, 'powered activator rail locks it');
  const left = chest.items[0].n;
  hl.transferCooldown = 0; hl.age = 0;
  for (let i = 0; i < 6; i++) { hl.px = hl.x; hl.py = hl.y; hl.pz = hl.z; Mc.tick(hl); }
  ok(chest.items[0].n === left && hl.inventory.every((s) => !s), 'locked hopper cart takes nothing over 6 ticks');
  const he = mk('hopper_minecart', 0.5, 5, 0.5);
  for (let i = 0; i < 6; i++) { he.px = he.x; he.py = he.y; he.pz = he.z; Mc.tick(he); }
  ok(he.inventory.some((s) => s && s.count > 0), 'enabled hopper cart ticking pulls items');

  // 3. comparator of a half-full chest cart = calculateComparatorOutput
  const half = mk('chest_minecart', 0.5, 0, 0.5);
  for (let i = 0; i < 13; i++) half.inventory[i] = { item: 'cobblestone', count: 64 };
  M.EntityList = { list: [half], remove() {} };
  // floor(13 / 27 * 14) + 1 = 7
  ok(Mc.detectorComparator(0, 0, 0) === 7, 'detector under a 13/27 chest cart reads 7 (got ' + Mc.detectorComparator(0, 0, 0) + ')');
  half.inventory.length = 0; half.inventory[0] = { item: 'apple', count: 1 };
  ok(Mc.detectorComparator(0, 0, 0) === 1, 'a single item reads 1');
  half.inventory[0] = null;
  ok(Mc.detectorComparator(0, 0, 0) === 0, 'empty reads 0');
  return { fails, n };
}

const real = scenarios();
const fails = real.fails.slice(); let breaks = 0;
for (const [label, a, b] of [
  ['activator lock ignored', 'var en = !powered;', 'var en = true;'],
  ['hopper disabled flag not honoured', 'if (e.hopperEnabled) {\n        // `currentBlockPos`', 'if (true) {\n        // `currentBlockPos`'],
  ['comparator fixed 15', 'return Math.floor(f / size * 14) + (n > 0 ? 1 : 0);', 'return 15;'],
  ['comparator no +1', '(n > 0 ? 1 : 0);', '0;'],
  ['chest size 27 -> 9', 'chest_minecart: 27', 'chest_minecart: 9'],
  ['items not saved', 'o.Items.push({ Slot: i,', 'o.Items.push({ Slot: 99,'],
]) {
  let matched = false;
  const patch = (f, src) => { if (f !== '07zzr_minecart.js') return src; if (src.includes(a)) matched = true; return src.split(a).join(b); };
  let r; try { r = scenarios(patch); } catch (err) { r = { fails: ['threw'] }; }
  if (!matched) fails.push('edit matched nothing: ' + label);
  else if (r.fails.length) { breaks++; console.log('   ✓ break caught: ' + label); } else fails.push('unnoticed break: ' + label);
}
if (fails.length) { console.log('FAIL'); fails.forEach((f) => console.log('  ' + f)); process.exit(1); }
console.log(`storagecartcheck: ${real.n} assertions, 0 failures, ${breaks} breaks caught`);
