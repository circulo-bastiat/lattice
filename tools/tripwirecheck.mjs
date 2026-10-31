#!/usr/bin/env node
// tripwirecheck.mjs -- #5610: TripwireBlock + TripwireHookBlock (.decomp block/) in src/14l_use.js.
//   hook-string-hook lines of 1, 41 and 42 strings: an item entity / a mob on the string powers both hooks the
//   tick it lands, both release 10 ticks after it leaves; distance 42 is out of range (hooks never attach).
// Anti-vacuity: string collision removed, release delay 11, hook range 43.
import { loadEngine } from './loadsrc.mjs';

console.log('tripwirecheck -- #5610, tripwire + hook: entity crossing powers both hooks, 10-tick release, range 41');

function scenarios(patch) {
  const fails = []; let n = 0;
  const ok = (c, m) => { n++; if (!c) fails.push(m); return c; };
  const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js', '14b_physics.js', '14f_inventory.js', '07f_redstone.js', '14l_use.js'], dom: false, patch });
  const R = M.Reg, B = M.Behave, Rs = M.Redstone, U = M.Use;
  const SX = 100, OFF = 50, cells = new Map();
  const key = (x, y, z) => x + ',' + y + ',' + z;
  const world = {
    getBlock: (x, y, z) => cells.get(key(x, y, z)) || 0,
    setBlock(x, y, z, id) { const old = cells.get(key(x, y, z)) || 0; cells.set(key(x, y, z), id); B.changed(x, y, z, old); return true; },
    blockLightAt: () => 15,
  };
  B.init(world); Rs.init(); U.init(world);
  M.EntityList = { list: [] };
  const def = (nm) => R.realFirst[R.id[nm]] + R.defaultState[R.id[nm]];
  const P = (st, k) => B.propName(st, k);
  const hookAt = (x) => world.getBlock(x, 0, 0);
  const pw = (x) => P(hookAt(x), 'powered') === 'true';
  const at = (x) => P(hookAt(x), 'attached') === 'true';
  const tick = () => B.tick();
  for (const len of [1, 40, 41]) {
    cells.clear(); B.clearSchedule(); M.EntityList.list.length = 0;
    // west hook faces east (into the line), east hook faces west; strings between
    const x0 = 0, x1 = len + 1;
    for (let x = x0; x <= x1; x++) { cells.set(key(x, -1, 0), def('stone')); }
    for (let x = x0 + 1; x < x1; x++) world.setBlock(x, 0, 0, def('tripwire'));
    world.setBlock(x0, 0, 0, B.setProp(def('tripwire_hook'), 'facing', 'east'));
    world.setBlock(x1, 0, 0, B.setProp(def('tripwire_hook'), 'facing', 'west'));
    const inRange = len <= 40;   // hook update scans i = 1..41; the far hook must be at i <= 41
    const L = 'len ' + len + ': ';
    ok(at(x0) === (len >= 1 && x1 - x0 <= 41 && len > 0 && x1 - x0 > 1), L + 'attached state ' + at(x0));
    if (x1 - x0 > 41) { ok(!at(x0) && !at(x1), L + 'too long never attaches'); continue; }
    ok(at(x0) && at(x1), L + 'both hooks attached');
    ok(!pw(x0) && !pw(x1), L + 'unpowered at rest');
    const mid = Math.max(1, Math.floor((x0 + x1) / 2));
    const item = { type: 'item', x: mid + 0.5, y: 0.0, z: 0.5, width: 0.25, height: 0.25, vy: 0 };
    M.EntityList.list.push(item);
    U.entityCollide(item);
    ok(pw(x0) && pw(x1), L + 'item on string powers both hooks');
    ok(Rs.signal(hookAt(x0), Rs.EAST, x0, 0, 0) === 15, L + 'hook emits 15');
    for (let i = 0; i < 25; i++) tick();
    ok(pw(x0) && pw(x1), L + 'stays powered while the item stays');
    M.EntityList.list.length = 0;
    let off = -1;
    for (let i = 1; i <= 30 && off < 0; i++) { tick(); if (!pw(x0) && !pw(x1)) off = i; }
    ok(off > 0 && off <= 10, L + 'releases within 10 ticks (got ' + off + ')');
    // a mob
    const mob = { type: 'zombie', x: mid + 0.5, y: 0, z: 0.5, width: 0.6, height: 1.95, maxHealth: 20 };
    M.EntityList.list.push(mob); U.entityCollide(mob);
    ok(pw(x0) && pw(x1), L + 'mob powers both hooks');
    M.EntityList.list.length = 0;
    for (let i = 0; i < 9; i++) tick();
    ok(pw(x0), L + 'still powered 9 ticks after the mob left');
    tick();
    ok(!pw(x0) && !pw(x1), L + 'released exactly 10 ticks after the last check');
    // disarmed string powers nothing
    if (len >= 1) {
      cells.set(key(mid, 0, 0), B.setProp(world.getBlock(mid, 0, 0), 'disarmed', true));
      world.setBlock(x0, 0, 0, hookAt(x0));
      M.EntityList.list.push(mob); U.entityCollide(mob);
      ok(!pw(x0), L + 'disarmed string does not power');
      M.EntityList.list.length = 0;
    }
  }
  ok(Rs.OWED_SOURCES.tripwire_hook === undefined, 'OWED_SOURCES.tripwire_hook struck');
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
brk('string collision removed', '14l_use.js', "if (prop(st, 'powered') !== 'true') stringPowered(bx, by, bz);", '');
brk('release delay 11', '14l_use.js', 'Use.TRIPWIRE_TICKS = 10;', 'Use.TRIPWIRE_TICKS = 11;');
brk('hook range 43', '14l_use.js', 'Use.TRIPWIRE_MAX = 42;', 'Use.TRIPWIRE_MAX = 43;');
if (fails.length) { console.log('FAIL\n' + fails.map((f) => ' - ' + f).join('\n')); process.exit(1); }
console.log(`tripwirecheck: ${base.n} assertions, 0 failures, ${breaks} breaks caught`);
