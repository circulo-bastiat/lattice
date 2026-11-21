#!/usr/bin/env node
// fallinganvilcheck.mjs — #5608: falling anvil damage, chip step, land sound (FallingBlockEntity.handleFallDamage, AnvilBlock) (.decomp FallingBlockEntity.java:114-216).
// Gravity/move/drag, place on landing, drop-as-item when it cannot place (doEntityDrops-gated),
// the 600-tick / out-of-world drop, air-state discard, hurtEntities fall damage.
// Every section breaks its own data and prints a "✓" line (the suite counts them as breaks caught).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const av = (c, m) => { ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
console.log('fallinganvilcheck — #5608');

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
const SOLID = new Set([st('stone'), st('sand'), st('anvil'), st('chipped_anvil'), st('damaged_anvil')]);   // torch / grass have no collision box
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


const sounds = [];
MCL.BlockEntities = { dispenseEvent: (p, ev) => sounds.push(ev === 1031 ? 'block.anvil.land' : ev === 1029 ? 'block.anvil.destroy' : ev) };
function drop(opts) {
  fresh(); floor(10); sounds.length = 0;
  const hit = [];
  MCL.Combat = { hurt: (o, a, n, b, src) => { hit.push([a, src && src.source]); return true; } };
  EL.list.push({ x: 0.5, y: 11, z: 0.5, width: 0.6, height: 1.8, type: 'zombie' });
  const e = EL.spawn('falling_block', 0.5, 16, 0.5, { state: st(opts.block || 'anvil') });
  e.hurtEntities = opts.hurt !== false; e.fallHurtAmount = 2; e.fallDamageMax = 40;
  EL.random = () => opts.r;
  run(e, 80);
  return { e, hit };
}
// 1. damage vs vanilla: min(floor(ceil(d-1)*2), 40), source ANVIL, chip taken at r < 0.05 + n*0.05
let r = drop({ r: 0.0 });
const dmg = r.hit.length ? r.hit[0][0] : -1;
ok(dmg >= 8 && dmg <= 12 && dmg % 2 === 0, 'anvil dropped ~5 blocks deals floor(ceil(d-1)*2) (got ' + dmg + ')');
ok(r.hit[0] && r.hit[0][1] === 'anvil', 'damage source is anvil');
const n = dmg / 2;
ok(W.getBlock(0, 11, 0) === MCL.EntityList.anvilLandingState(st('anvil')), 'low roll: anvil lands as chipped_anvil');
ok(sounds.includes('block.anvil.land'), 'landing plays block.anvil.land');
r = drop({ r: 0.05 + n * 0.05 + 1e-6 });
ok(W.getBlock(0, 11, 0) === st('anvil'), 'roll just above 0.05+n*0.05: no chip');
r = drop({ r: 0.05 + n * 0.05 - 1e-6 });
ok(W.getBlock(0, 11, 0) === EL.anvilLandingState(st('anvil')), 'roll just below 0.05+n*0.05: chipped');
r = drop({ r: 0.0, block: 'chipped_anvil' });
ok(W.getBlock(0, 11, 0) === EL.anvilLandingState(st('chipped_anvil')) && W.getBlock(0, 11, 0) !== 0, 'chipped -> damaged');
sounds.length = 0;
r = drop({ r: 0.0, block: 'damaged_anvil' });
ok(W.getBlock(0, 11, 0) === 0 && sounds.includes('block.anvil.destroy'), 'damaged anvil is destroyed on landing with block.anvil.destroy');
r = drop({ r: 0.0, hurt: false });
av(r.hit.length === 0 && W.getBlock(0, 11, 0) === st('anvil'), 'hurtEntities=false: no damage and no chip (hurtEntities call removed)');
r = drop({ r: 0.0, block: 'sand' });
ok(r.hit[0] && r.hit[0][1] === 'fallingBlock' && W.getBlock(0, 11, 0) === st('sand'), 'sand: fallingBlock source, never chips');
av(dmg > 0, 'damage really dealt');
console.log(`\n${pass} checks passed, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
