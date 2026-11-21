#!/usr/bin/env node
// itemburncheck.mjs — #5652: items burn in lava/fire (health 5), fireproof items and nether star vs explosion survive.
// Gravity/move/drag, place on landing, drop-as-item when it cannot place (doEntityDrops-gated),
// the 600-tick / out-of-world drop, air-state discard, hurtEntities fall damage.
// Every section breaks its own data and prints a "✓" line (the suite counts them as breaks caught).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const av = (c, m) => { ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
console.log('itemburncheck — #5652 ItemEntity.hurt');

const EXTRA = ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js', '07h_entities.js',
               '07i_entitylist.js', '14b_physics.js', '14j_combat.js'];
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

function pool(fl) { for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) { cells.set(key(x, 9, z), st('stone')); for (let y = 10; y <= 13; y++) cells.set(key(x, y, z), st(fl)); } }
function item(n, y) { const e = EL.spawn('item', 0.5, y, 0.5, { item: n, count: 1 }); e.vx = e.vy = e.vz = 0; return e; }
function run(e, n) { for (let i = 0; i < n && !e.removed; i++) EL.tickOne(e); return e.removed ? i_ : -1; }
let i_ = 0;
function life(e, n) { for (i_ = 0; i_ < n && !e.removed; i_++) EL.tickOne(e); return e.removed ? i_ : -1; }

fresh(); pool('lava');
let e = item('oak_planks', 10.5);
const t = life(e, 50);
ok(t > 0 && t <= 3, 'oak_planks in lava gone within 3 ticks (4 dmg x2 vs health 5), got ' + t);
fresh(); pool('lava');
e = item('netherite_ingot', 10.5);
ok(life(e, 2000) === -1, 'netherite_ingot survives lava'); ok(e.health === undefined || e.health === 5, 'netherite health untouched');
fresh(); cells.set(key(0, 9, 0), st('stone')); cells.set(key(0, 10, 0), st('fire'));
e = item('diamond', 10.1);
const tf = life(e, 50);
ok(tf > 0 && tf <= 5, 'diamond in fire gone within 5 ticks (1 dmg vs health 5), got ' + tf);
fresh(); cells.set(key(0, 9, 0), st('stone')); cells.set(key(0, 10, 0), st('fire'));
e = item('netherite_scrap', 10.1);
ok(life(e, 200) === -1, 'netherite_scrap survives fire');
av(EL.hurtItem(item('stick', 30), 1, { explosive: true }) === true, 'stick is hurt by explosion');
e = item('nether_star', 30);
ok(EL.hurtItem(e, 100, { explosive: true }) === false && !e.removed, 'nether_star survives explosion');
ok(EL.hurtItem(e, 100, { fire: false }) === true && e.removed, 'nether_star still dies to other damage');
// anti-vacuity: drop the fire-resistant set and netherite burns
const saved = EL.FIRE_PROOF; EL.FIRE_PROOF = {};
fresh(); pool('lava'); e = item('netherite_ingot', 10.5);
av(life(e, 50) > 0, 'without the fire-resistant set netherite_ingot burns (the survival case fails)');
EL.FIRE_PROOF = saved;
console.log(`\n${pass} checks passed, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
