#!/usr/bin/env node
// entitylist11579check.mjs — #11579: 07i_entitylist.js classes ConcretePowderBlock/LandingBlock (tickFallingBlock landing + hardening),
// RaycastContext (EL.sourceOnlyRaycast), FlyingEntity/AbstractFireballEntity/ZombieHorseEntity/GolemEntity/ThrownItemEntity (EL.motionFor rows,
// reached by EL.canSpawn/EL.spawn). Each source break must fail its row.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js', '07h_entities.js', '07i_entitylist.js', '14b_physics.js'];
function trial(patch) {
  const MCL = loadEngine({ extra: EXTRA, dom: false, ...(patch ? { patch } : {}) });
  MCL.Items.init({ items: readFileSync(join(MCLITE_ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
  MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
  const EL = MCL.EntityList, S = MCL.States, o = {};
  const st = (n) => S.stateOf(n) | 0;
  const cells = new Map(); const key = (x, y, z) => x + ',' + y + ',' + z;
  const W = { getBlock: (x, y, z) => (y < 0 ? st('stone') : (cells.get(key(x, y, z)) | 0)),
    setBlock(x, y, z, id) { cells.set(key(x, y, z), id); return true; }, canSurvive: () => true, get: (x, y, z) => W.getBlock(x, y, z) };
  MCL.World = W;
  const SOLID = new Set([st('stone')]);
  MCL.Physics.shapeAt = (x, y, z) => (SOLID.has(W.getBlock(x, y, z)) ? MCL.Physics.FULL_CUBE : null);
  MCL.Physics.solidAt = (x, y, z) => MCL.Physics.shapeAt(x, y, z) !== null;
  MCL.Physics.grounded = (x, y, z, d) => SOLID.has(W.getBlock(Math.floor(x), Math.floor(y - d), Math.floor(z)));
  MCL.Entities.init(); EL.init(); MCL.Behave.init(W);
  MCL.Commands = { ruleGet: () => 'true' };
  const P = st('white_concrete_powder'), C = st('white_concrete'), WA = st('water');
  const drop = (setup) => { cells.clear(); EL.init(); setup(); const e = EL.spawn('falling_block', 0.5, 14, 0.5, { state: P });
    for (let i = 0; i < 80 && !e.removed; i++) EL.tickOne(e);
    for (let y = 0; y < 30; y++) { const b = W.getBlock(0, y, 0); if (b === C || b === P) return b; } return 0; };
  const pool = () => { for (let y = 3; y <= 6; y++) for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) cells.set(key(x, y, z), WA); };
  o.poolHardens = drop(pool) === C;
  o.dryStays = drop(() => {}) === P;
  o.sideHardens = drop(() => { cells.set(key(1, 0, 0), WA); }) === C;
  // RaycastContext SOURCE_ONLY: first water source on the segment, collider blocks stop it
  cells.clear(); cells.set(key(0, 5, 0), WA);
  const h = EL.sourceOnlyRaycast(0.5, 8.5, 0.5, 0.5, 3.5, 0.5);
  o.rayWater = !!h && h[0] === 0 && h[1] === 5 && h[2] === 0;
  cells.clear(); cells.set(key(0, 5, 0), st('stone')); cells.set(key(0, 3, 0), WA);
  const h2 = EL.sourceOnlyRaycast(0.5, 8.5, 0.5, 0.5, 2.5, 0.5);
  o.rayStone = !!h2 && h2[1] === 5;
  cells.clear(); o.rayNone = EL.sourceOnlyRaycast(0.5, 8.5, 0.5, 0.5, 3.5, 0.5) === null;
  // motion rows
  const mz = (t) => { const m = EL.motionFor(t); return m && m[0] === 0 && m[1] === 1; };
  o.flying = mz('phantom') && mz('ghast');
  o.fireball = mz('fireball') && mz('small_fireball');
  const zh = EL.motionFor('zombie_horse'), hh = EL.motionFor('horse');
  o.zombieHorse = !!zh && zh[0] === hh[0] && zh[1] === hh[1];
  const sg = EL.motionFor('snow_golem'); o.golem = !!sg && sg[0] === 0.08 && sg[1] === 0.98;
  const ep = EL.motionFor('ender_pearl'); o.thrown = !!ep && ep[0] === Math.fround(0.03) && ep[1] === Math.fround(0.99);
  o.canSpawn = EL.canSpawn('ghast') && EL.canSpawn('zombie_horse') && EL.canSpawn('fireball');
  return o;
}
const LBL = ['poolHardens', 'dryStays', 'sideHardens', 'rayWater', 'rayStone', 'rayNone', 'flying', 'fireball', 'zombieHorse', 'golem', 'thrown', 'canSpawn'];
const base = trial();
for (const k of LBL) ok(base[k] === true, 'baseline row ' + k);
const BR = [
  ['poolHardens', /inWater = EL\.isWaterCell\(NS\.World\.getBlock\(x, y, z\)\);/, 'inWater = false;'],
  ['dryStays', /if \(isPowder\) st = NS\.Behave\.place\(st, x, y, z\);/, 'if (isPowder) st = NS.Behave.concrete(st);'],
  ['sideHardens', /if \(isPowder\) st = NS\.Behave\.place\(st, x, y, z\);/, ''],
  ['rayWater', /if \(NS\.Behave && NS\.Behave\.fluidLevel\(st\) === 0\) return \[cx, cy, cz\];/, ''],
  ['rayStone', /else if \(P\.shapeAt && P\.shapeAt\(cx, cy, cz\)\) return \[cx, cy, cz\];/, ''],
  ['flying', /if \(bare === 'phantom'\) return \[0, 1\];/, ''],
  ['fireball', /if \(bare === 'fireball' \|\| bare === 'small_fireball'\) return \[0, 1\];/, ''],
  ['zombieHorse', /\|\| bare === 'zombie_horse'\) \{ var hm/, ') { var hm'],
  ['thrown', /if \(bare === 'ender_pearl'\) return \[Math\.fround\(0\.03\), Math\.fround\(0\.99\)\];/, ''],
  ['canSpawn', /if \(bare === 'ghast'\) return \[0, 1\];/, ''],
];
const SRC = readFileSync(MCLITE_ROOT + 'src/07i_entitylist.js', 'utf8');
for (const [key, re, rep] of BR) {
  if (!re.test(SRC)) { fails.push('pattern not found: ' + key); continue; }
  breaks++; let hit = false, B;
  try { B = trial((f, src) => { const n = f === '07i_entitylist.js' ? src.replace(re, rep) : src; if (n !== src) hit = true; return n; }); } catch (e) { B = {}; }
  ok(hit, 'break matched: ' + key); ok(!B[key], 'break must be caught: ' + key);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `${pass} ok, ${breaks} breaks caught, 0 failed`);
process.exit(fails.length ? 1 : 0);
