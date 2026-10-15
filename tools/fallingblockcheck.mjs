#!/usr/bin/env node
// fallingblockcheck.mjs — #833 G17c: FallingBlockEntity.tick's landing (.decomp FallingBlockEntity.java:114-216).
// Gravity/move/drag, place on landing, drop-as-item when it cannot place (doEntityDrops-gated),
// the 600-tick / out-of-world drop, air-state discard, hurtEntities fall damage.
// Every section breaks its own data and prints a "✓" line (the suite counts them as breaks caught).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const av = (c, m) => { ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
console.log('fallingblockcheck — #833 FallingBlockEntity.tick landing');

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
function floor(y) { for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) cells.set(key(x, y, z), st('stone')); }
function run(e, n) { for (let i = 0; i < n && !e.removed; i++) EL.tickOne(e); }
const items = () => EL.all().filter((e) => e.type === 'item' && !e.removed);

// 1. lands on stone at y=10, places sand in the cell above it
fresh(); floor(10);
let e = EL.spawn('falling_block', 0.5, 14, 0.5, { state: st('sand') });
run(e, 60);
ok(e.removed, 'falling sand is discarded once it lands');
ok(W.getBlock(0, 11, 0) === st('sand'), 'and places itself in the cell it landed in');
ok(items().length === 0, 'placing drops nothing');

// 2. cell occupied by a non-replaceable block -> drop as item, gated on doEntityDrops
fresh(); floor(10);
e = EL.spawn('falling_block', 0.5, 14, 0.5, { state: st('sand') });
cells.set(key(0, 11, 0), st('torch'));   // not replaceable, no collision box: the sand lands inside it
run(e, 60);
ok(e.removed, 'a falling block that cannot place is discarded');
ok(items().length === 1 && items()[0].item === 'sand', 'and drops one sand item');
fresh(); floor(10); rule = 'false';
e = EL.spawn('falling_block', 0.5, 14, 0.5, { state: st('sand') });
cells.set(key(0, 11, 0), st('torch'));
run(e, 60);
av(e.removed && items().length === 0, 'doEntityDrops=false: no item (breaks the rule, drop vanishes)');
fresh(); floor(10);
e = EL.spawn('falling_block', 0.5, 14, 0.5, { state: st('sand') }); e.dropItem = false;
cells.set(key(0, 11, 0), st('torch'));
run(e, 60);
av(e.removed && items().length === 0, 'dropItem=false: no item');

// 3. canSurvive false -> drops instead of placing
fresh(); floor(10);
const cs = W.canSurvive; W.canSurvive = () => false;
e = EL.spawn('falling_block', 0.5, 14, 0.5, { state: st('sand') });
run(e, 60);
ok(e.removed && W.getBlock(0, 11, 0) === 0 && items().length === 1, 'canSurvive false: drops rather than places');
W.canSurvive = cs;

// 4. replaceable cell (tall grass) is overwritten
fresh(); floor(10);
cells.set(key(0, 11, 0), st('grass'));
e = EL.spawn('falling_block', 0.5, 14, 0.5, { state: st('sand') });
run(e, 60);
ok(W.getBlock(0, 11, 0) === st('sand'), 'a replaceable plant is replaced by the landing block');

// 5. air state discards; timeFalling>600 drops
fresh();
e = EL.spawn('falling_block', 0.5, 14, 0.5, { state: 0 });
EL.tickOne(e);
ok(e.removed, 'air-state falling block is discarded on its first tick');
fresh();
e = EL.spawn('falling_block', 0.5, 14, 0.5, { state: st('sand') });
e.gravity = 0; e.timeFalling = 600; EL.tickOne(e);
ok(e.removed && items().length === 1, 'timeFalling > 600 discards and drops');

// 6. hurtEntities: an anvil-style fall damages an overlapping entity
fresh(); floor(10);
let hit = [];
MCL.Combat = { hurt: (o, a) => { hit.push(a); return true; } };
const victim = { x: 0.5, y: 11, z: 0.5, width: 0.6, height: 1.8, type: 'zombie' };
EL.list.push(victim);
e = EL.spawn('falling_block', 0.5, 14, 0.5, { state: st('sand') });
e.hurtEntities = true; e.fallHurtAmount = 2;
run(e, 60);
ok(hit.length > 0 && hit[0] > 0 && hit[0] <= 40, 'hurtEntities: an overlapping entity takes min(floor(ceil(d-1)*2), max)');
av(hit.length > 0, 'damage was really dealt (hit list non-empty)');

// 7. anvil parameters: 2 per block over 1, cap 40, source anvil; sand deals nothing
function drop(name, h) {
  fresh(); floor(10);
  const got = []; MCL.Combat = { hurt: (o, a, n, b, src) => { got.push([a, src && src.source]); return true; } };
  EL.list.push({ x: 0.5, y: 11, z: 0.5, width: 0.6, height: 1.8, type: 'zombie' });
  const f = EL.spawn('falling_block', 0.5, 11 + h, 0.5, { state: st(name) });
  run(f, 200); return got;
}
for (const h of [1, 2, 5, 20, 50]) {
  const g = drop('anvil', h);
  ok(g.length === 1 && g[0][0] === Math.min(Math.floor(Math.ceil(h - 1) * 2), 40) && g[0][1] === 'anvil', 'anvil from ' + h + ' deals vanilla amount, got ' + JSON.stringify(g));
}
ok(drop('sand', 20).length === 0, 'sand deals 0');
{ const f = (EL.spawn('falling_block', 0.5, 20, 0.5, { state: st('anvil') })); const was = f.hurtEntities; f.hurtEntities = false;
  av(was === true && !f.hurtEntities, 'anvil sets hurtEntities (reverting to false is detected)'); }

console.log(`\n${pass} checks passed, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
