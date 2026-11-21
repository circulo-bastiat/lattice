#!/usr/bin/env node
// concretefallcheck.mjs — #5553: FallingBlockEntity.tick's concrete-powder branch (water cell / SOURCE_ONLY raycast)
// + ConcretePowderBlock.onLanding. Breaks its own data ("breaks caught").
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const EXTRA = ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js', '07h_entities.js', '07i_entitylist.js', '14b_physics.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
MCL.Items.init({ items: readFileSync(join(MCLITE_ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
const EL = MCL.EntityList, S = MCL.States;
const st = (n) => S.stateOf(n) | 0;
const cells = new Map(); const key = (x, y, z) => x + ',' + y + ',' + z;
const W = {
  getBlock: (x, y, z) => (y < 0 ? st('stone') : (cells.get(key(x, y, z)) | 0)),
  setBlock(x, y, z, id) { cells.set(key(x, y, z), id); return true; },
  canSurvive: () => true, get: (x, y, z) => W.getBlock(x, y, z),
};
MCL.World = W;
const SOLID = new Set([st('stone')]);
MCL.Physics.shapeAt = (x, y, z) => (SOLID.has(W.getBlock(x, y, z)) ? MCL.Physics.FULL_CUBE : null);
MCL.Physics.solidAt = (x, y, z) => MCL.Physics.shapeAt(x, y, z) !== null;
MCL.Physics.grounded = (x, y, z, d) => SOLID.has(W.getBlock(Math.floor(x), Math.floor(y - d), Math.floor(z)));
MCL.Entities.init(); EL.init(); MCL.Behave.init(W);
MCL.Commands = { ruleGet: () => 'true' };
const P = st('white_concrete_powder'), C = st('white_concrete'), WA = st('water');
const run = (e, n) => { for (let i = 0; i < n && !e.removed; i++) EL.tickOne(e); };
function drop(setup, x = 0.5, y0 = 14) {
  cells.clear(); EL.init(); setup();
  const e = EL.spawn('falling_block', x, y0, 0.5, { state: P }); run(e, 80); return e;
}
const pool = () => { for (let y = 3; y <= 6; y++) for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) cells.set(key(x, y, z), WA); };
const top = () => { for (let y = 0; y < 30; y++) { const b = W.getBlock(0, y, 0); if (b === C || b === P) return b; } return 0; };

drop(pool); ok(top() === C, 'dropped into a pool: becomes concrete');
drop(() => { for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) cells.set(key(x, 3, z), WA); });
ok(top() === C, 'onto a water surface: concrete');
drop(() => { cells.set(key(1, 0, 0), WA); }); ok(top() === C, 'next to water beside its landing cell: concrete');
drop(() => {}); ok(top() === P, 'dry ground: stays powder');
console.log('   ' + (fails.length ? '✗' : '✓') + ' pool/surface/side/dry cases');

// anti-vacuity: disable the conversion
const B = MCL.Behave, orig = B.powderHardened;
B.powderHardened = () => 0;
drop(pool);
const broke = top() !== C;
B.powderHardened = orig;
ok(broke, 'anti-vacuity: conversion disabled');
console.log('   ✓ 1 breaks caught (conversion disabled -> not concrete)');
if (fails.length) { console.log('FAIL', fails); process.exit(1); }
console.log(pass + ' assertions, 0 failures, 1 breaks caught');
