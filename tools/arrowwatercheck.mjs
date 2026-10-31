#!/usr/bin/env node
// arrowwatercheck.mjs — cloud referee-plate-arrow: two halves of `PersistentProjectileEntity.tick()` /
// `onEntityHit` (.decomp/net/minecraft/entity/projectile/PersistentProjectileEntity.java) that
// `Cb.tickArrow` (14j_combat.js) did not have.
//
//   node tools/arrowwatercheck.mjs [--verbose]
//
//   1. water drag — an arrow touching water damps by `getDragInWater()` (0.6F), not 0.99F; the
//      "touching" test is the box against the water's real surface height (8/9 of a source cell),
//      so an arrow whose box sits wholly above that surface is dry.
//   2. the no-damage bounce — a hit the target refuses (its invulnerability window) turns the arrow
//      round at -0.1x its velocity, restores the target's fire ticks, and leaves health alone; a
//      bounce that leaves the arrow all but still (|v|^2 < 1e-7) drops the arrow item (pickup
//      ALLOWED only) and discards it.
//   3. anti-vacuity (D-30/D-305) — 0.99 in water, a surface-blind water test, and a bounce of +1 are each caught.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) { pass++; if (VERBOSE) console.log('   ✓ ' + m); } else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ break caught: ' + m); } else fails.push('anti-vacuity: ' + m); };

console.log('arrowwatercheck — arrow water drag (getDragInWater) and the no-damage bounce');

const M = loadEngine({
  extra: ['07_world.js', '02g_items.js', '14f_inventory.js', '07h_entities.js', '14b_physics.js',
          '07i_entitylist.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '14l_use.js',
          '07b_behaviour.js', '09c_weather.js']
});
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Entities.init();
M.EntityList.init();
M.Combat.init();
const EL = M.EntityList, Cb = M.Combat, W = M.World, CH = M.CH;
const stateOf = (n) => M.States.stateOf(n) | 0;
const WATER = stateOf('water'), STONE = stateOf('stone');
const f32 = Math.fround;

function freshWorld() {
  W.init(1);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
    const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
  }
  const bw = { get: (x, y, z) => W.getBlock(x, y, z), set: (x, y, z, st) => W.setBlock(x, y, z, st), getLight: () => 15 << 4 };
  bw.getBlock = bw.get; bw.setBlock = bw.set;
  M.Behave.init(bw);                                   // Behave.fluidAmount reads the level property
  EL.clear();
}
// a 9x9 pool of source water at y 4..6, stone floor at y 3
function pool() {
  for (let x = -4; x <= 12; x++) for (let z = -4; z <= 4; z++) {
    W.setBlock(x, 3, z, STONE);
    for (let y = 4; y <= 6; y++) W.setBlock(x, y, z, WATER);
  }
}
const near = (a, b) => Math.abs(a - b) < 1e-9;

// one flying tick of a fresh arrow; returns its velocity after the tick
function flyOnce(x, y, z, vx) {
  const a = EL.spawn('arrow', x, y, z, { vx, vy: 0, vz: 0, shooter: null });
  Cb.tickArrow(a);
  return a;
}

function sectionWater() {
  freshWorld(); pool();
  const r = {};
  // deep in the pool (box y 5.0..5.5, cells full of water)
  const a = flyOnce(0.5, 5.0, 0.5, 0.5);
  r.deepVx = a.vx; r.deepVy = a.vy;
  // the top cell (y 6) is a source with AIR above: surface at 6 + 8/9 = 6.888...
  // box bottom 6.95 is above the surface -> dry; box bottom 6.80 is below it -> wet
  const dry = flyOnce(0.5, 6.95, 0.5, 0.5); r.dryVx = dry.vx;
  const wet = flyOnce(0.5, 6.80, 0.5, 0.5); r.wetVx = wet.vx;
  // out of the pool entirely
  const air = flyOnce(0.5, 9.5, 0.5, 0.5); r.airVx = air.vx;
  return r;
}

function sectionBounce() {
  freshWorld();
  for (let x = -4; x <= 12; x++) for (let z = -4; z <= 4; z++) W.setBlock(x, 3, z, STONE);
  const r = {};
  // a target inside its invulnerability window, already hit harder than an arrow can hit
  const t = EL.spawn('turtle', 3, 4, 0);         // box (inflated 0.3) from x 2.1
  t.maxHealth = t.health = 1000;
  t.invulnerableTime = 20; t.lastHurt = 10000;
  t.remainingFireTicks = 0; t.isOnFire = false;
  const a = EL.spawn('arrow', 0.5, 4.1, 0, { vx: 2, vy: 0, vz: 0, shooter: null });
  a.isOnFire = true;                                    // a flaming arrow would set it alight...
  Cb.tickArrow(a);
  r.health = t.health;
  r.removed = a.removed;
  r.vx = a.vx;                                           // after bounce (-0.2), drag, gravity
  r.x = a.x;
  r.fire = t.remainingFireTicks;                         // ...but a refused hit puts the fire back
  // an all-but-still bounce: the arrow is discarded, and drops its item only when pickup is ALLOWED
  const drops = {};
  for (const pk of [Cb.PICKUP_ALLOWED, Cb.PICKUP_DISALLOWED]) {
    t.invulnerableTime = 20; t.lastHurt = 10000;
    const s = EL.spawn('arrow', 3 - 0.3 - 0.25 - 0.0001, 4.1, 0, { vx: 0.0002, vy: 0, vz: 0, shooter: null });
    s.noGravity = true;
    s.pickupType = pk;
    const before = EL.list.filter((o) => o.type === 'item' && !o.removed).length;
    Cb.tickArrow(s);
    const after = EL.list.filter((o) => o.type === 'item' && !o.removed).length;
    drops[pk] = { removed: s.removed, items: after - before };
  }
  r.drops = drops;
  return r;
}

// ═══════════ 1. water drag ═════════════════════════════════════════════════════════════════
console.log('\n1. water drag — 0.6F touching water, 0.99F dry, the surface at 8/9 of a source cell');
ok(M.Weather && M.Weather.fluidHeight, '09c_weather.js is loaded (Wx.fluidHeight supplies the surface height)');
const w = sectionWater();
ok(near(w.deepVx, 0.5 * f32(0.6)), `an arrow in deep water keeps 0.6F of its speed (vx ${w.deepVx}, want ${0.5 * f32(0.6)})`);
ok(near(w.deepVy, -M.EntityList.motionFor('arrow')[0]), `gravity still applies after the water drag (vy ${w.deepVy})`);
ok(near(w.wetVx, 0.5 * f32(0.6)), `a box whose bottom is under the 6.888 surface is wet (vx ${w.wetVx})`);
ok(!near(w.dryVx, 0.5 * f32(0.6)) && near(w.dryVx, w.airVx), `a box wholly above the surface is dry, damped as in air (vx ${w.dryVx} = air ${w.airVx})`);
ok(w.airVx > 0.49, `an arrow in air keeps ~0.99 of its speed (vx ${w.airVx})`);

// ═══════════ 2. the bounce ═════════════════════════════════════════════════════════════════
console.log('\n2. the no-damage bounce — onEntityHit\'s else branch');
const b = sectionBounce();
ok(b.health === 1000, `the refused hit did no damage (health ${b.health})`);
ok(b.removed === false, 'the arrow survives a refused hit');
ok(b.vx < 0, `it turned round (vx ${b.vx})`);
ok(near(b.vx, 2 * -0.1 * f32(M.EntityList.motionFor('arrow')[1])), `at -0.1x its speed, then this tick's drag (vx ${b.vx})`);
ok(b.x < 0.5, `and this tick's move already used the bounced velocity (x ${b.x})`);
ok(b.fire === 0, `the target's fire ticks were put back (${b.fire}), not the flaming arrow's 100`);
ok(b.drops[Cb.PICKUP_ALLOWED].removed && b.drops[Cb.PICKUP_ALLOWED].items === 1, 'an all-but-still ALLOWED arrow is discarded and drops one item');
ok(b.drops[Cb.PICKUP_DISALLOWED].removed && b.drops[Cb.PICKUP_DISALLOWED].items === 0, 'an all-but-still DISALLOWED arrow is discarded and drops nothing');

// ═══════════ 3. anti-vacuity ═══════════════════════════════════════════════════════════════
console.log('\n3. anti-vacuity');
{
  const keep = Cb.ARROW_WATER_DRAG;
  Cb.ARROW_WATER_DRAG = 0.99;
  const w2 = sectionWater();
  Cb.ARROW_WATER_DRAG = keep;
  okAv(!near(w2.deepVx, 0.5 * f32(0.6)), 'an arrow that keeps 0.99 in water is a mismatch');
}
{
  const keep = Cb.arrowTouchingWater;
  Cb.arrowTouchingWater = () => true;
  const w2 = sectionWater();
  Cb.arrowTouchingWater = keep;
  okAv(near(w2.dryVx, 0.5 * f32(0.6)), 'a water test that ignores the surface height makes the dry box wet');
}
{
  const keep = Cb.ARROW_BOUNCE;
  Cb.ARROW_BOUNCE = 1;
  const b2 = sectionBounce();
  Cb.ARROW_BOUNCE = keep;
  okAv(!(b2.vx < 0), 'an arrow that flies on through a refused hit is a mismatch');
}

console.log(`\n${pass} checks passed, ${fails.length} failed (${breaks} anti-vacuity)`);
for (const f of fails) console.log('  ✗ ' + f);
console.log('');
console.log('================ arrowwatercheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks - fails.filter((f) => f.startsWith('anti-vacuity')).length}`);
process.exit(fails.length ? 1 : 0);
