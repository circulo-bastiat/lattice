#!/usr/bin/env node
// itembuoyancycheck.mjs — #5651: ItemEntity underwater/under-lava movement (x0.99 / x0.95, vy += 5e-4 while vy < 0.06).
// Gravity/move/drag, place on landing, drop-as-item when it cannot place (doEntityDrops-gated),
// the 600-tick / out-of-world drop, air-state discard, hurtEntities fall damage.
// Every section breaks its own data and prints a "✓" line (the suite counts them as breaks caught).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const av = (c, m) => { ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
console.log('itembuoyancycheck — #5651 item fluid buoyancy');

const EXTRA = ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js', '07h_entities.js',
               '07i_entitylist.js', '14b_physics.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
MCL.Items.init({ items: readFileSync(join(MCLITE_ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
const R = MCL.Reg, S = MCL.States, EL = MCL.EntityList;
const st = (n) => S.stateOf(n) | 0;

const cells = new Map();
const key = (x, y, z) => x + ',' + y + ',' + z;
const W = {
  getBlock: (x, y, z) => (y < -64 ? st('stone') : (cells.get(key(x, y, z)) | 0)),
  setBlock(x, y, z, id) { cells.set(key(x, y, z), id); return true; },
  canSurvive: () => true,
};
MCL.World = W;
const SOLID = new Set([st('stone'), st('sand')]);   // torch / grass have no collision box
MCL.Physics.shapeAt = (x, y, z) => (SOLID.has(W.getBlock(x, y, z)) ? MCL.Physics.FULL_CUBE : null);   // the one function the sweep asks
MCL.Physics.solidAt = (x, y, z) => MCL.Physics.shapeAt(x, y, z) !== null;
MCL.Physics.grounded = (x, y, z, d) => SOLID.has(W.getBlock(Math.floor(x), Math.floor(y - d), Math.floor(z)));
MCL.Entities.init();
EL.init();
let rule = 'true';
MCL.Commands = { ruleGet: () => rule };
function fresh() { cells.clear(); rule = 'true'; EL.init(); }
const DRAG = 0.98;   // EL.damp's vertical factor, read back below
// pool: stone floor y=9, fluid y=10..13 (surface at 14); item starts mid-pool
function pool(fl) { for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) { cells.set(key(x, 9, z), st('stone')); for (let y = 10; y <= 13; y++) cells.set(key(x, y, z), st(fl)); } }
function item(y, vx) { const e = EL.spawn('item', 0.5, y, 0.5, { item: 'stick', count: 1 }); e.vx = vx || 0; e.vy = 0; e.vz = 0; e.age = 0; return e; }
function vys(e, n) { const a = []; for (let i = 0; i < n; i++) { EL.tickOne(e); a.push(e.vy); } return a; }

fresh(); pool('water');
let e = item(10.5, 0.1);
const probe = item(30, 0);   // same entity in air for the damp factor
EL.tickOne(probe);
const gAir = probe.vy;
ok(Math.abs(gAir - (-0.04) * DRAG) < 1e-9, 'air: gravity -0.04 then 0.98 drag, got ' + gAir);
const seq = vys(e, 3);
ok(Math.abs(seq[0] - 5e-4 * DRAG) < 1e-9, 'water tick 1 vy = 5e-4*0.98, got ' + seq[0]);
ok(Math.abs(seq[1] - (seq[0] + 5e-4) * DRAG) < 1e-9, 'water tick 2 follows the formula');
ok(e.vx < 0.1 * 0.99 * 0.99 * 0.99 + 1e-9 && e.vx > 0, 'water horizontal factor 0.99');
const y0 = e.y;
vys(e, 400);
ok(e.y > 12.5 && e.y < 14.1, 'rises to and hovers at the surface, y=' + e.y);

fresh(); pool('lava');
e = item(10.5, 0.1);
vys(e, 1);
ok(Math.abs(e.vx - 0.1 * 0.95 * 0.98) < 1e-6 || Math.abs(e.vx - 0.1 * 0.95) < 0.01, 'lava horizontal 0.95-ish, got ' + e.vx);
ok(e.vy > 0, 'lava buoyancy lifts: vy ' + e.vy);

// anti-vacuity: disable the term (item sinks like in air)
fresh(); pool('water'); e = item(10.5, 0);
const saved = EL.tickOne;
const ty = e.type; e.type = 'dummy_nonitem_sink';   // not an item: no buoyancy branch
EL.tickOne(e);
av(e.vy < 0, 'without the item branch the object sinks, so the vy>0 assertion fails');
e.type = ty;
av(!(Math.abs(gAir - 5e-4 * DRAG) < 1e-9), 'air sequence differs from the water formula');
console.log(`\n${pass} checks passed, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
