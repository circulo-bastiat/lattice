#!/usr/bin/env node
// vbaudit11483check.mjs — #11483: drives 07i_entitylist.js through the real EntityList path for classes the audit listed
// unchecked: ConcretePowderBlock + LandingBlock (FallingBlockEntity landing: harden in water, anvil 1031 event),
// RaycastContext (SOURCE_ONLY water raycast of a fast powder block), LunarWorldView (MOON_SIZES), ZombieHorseEntity
// (initAttributes jump roll), FlyingEntity/ThrownItemEntity/GolemEntity/AbstractFireballEntity (EL.canSpawn motion rows,
// THROWN raycast set, fireball power init), DataTracker (EndCrystal defaults), PlayDeadTimerTask (Ax.tickPlayDead),
// EntityHitResult (pearlSweep wiring). Anti-vacuity: each scenario is broken by a source patch and must fail.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js', '07h_entities.js', '07i_entitylist.js', '14b_physics.js', '07zm_axolotl.js', '07zzh_blaze.js'];
function trial(patch) {
  const MCL = loadEngine({ extra: EXTRA, dom: false, ...(patch ? { patch } : {}) });
  MCL.Items.init({ items: readFileSync(join(MCLITE_ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
  MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
  const S = MCL.States, EL = MCL.EntityList, o = {};
  const st = (n) => S.stateOf(n) | 0;
  const cells = new Map(); const key = (x, y, z) => x + ',' + y + ',' + z;
  const W = { getBlock: (x, y, z) => (y < -64 ? st('stone') : (cells.get(key(x, y, z)) | 0)), setBlock(x, y, z, id) { cells.set(key(x, y, z), id); return true; }, canSurvive: () => true };
  MCL.World = W;
  const SOLID = new Set([st('stone'), st('anvil'), st('white_concrete_powder'), st('white_concrete')]);
  MCL.Physics.shapeAt = (x, y, z) => (SOLID.has(W.getBlock(x, y, z)) ? MCL.Physics.FULL_CUBE : null);
  MCL.Physics.solidAt = (x, y, z) => MCL.Physics.shapeAt(x, y, z) !== null;
  MCL.Physics.grounded = (x, y, z, d) => SOLID.has(W.getBlock(Math.floor(x), Math.floor(y - d), Math.floor(z)));
  MCL.Behave.init(W); MCL.Entities.init(); EL.init();
  MCL.Commands = { ruleGet: () => 'true' };
  const events = []; MCL.BlockEntities = { dispenseEvent: (p, ev) => events.push(ev) };
  const run = (e, n) => { for (let i = 0; i < n && !e.removed; i++) EL.tickOne(e); };
  const floor = (y) => { for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) cells.set(key(x, y, z), st('stone')); };
  // ConcretePowderBlock: lands in water -> concrete; dry stays powder
  floor(10); cells.set(key(0, 11, 0), st('water'));
  run(EL.spawn('falling_block', 0.5, 14, 0.5, { state: st('white_concrete_powder') }), 60);
  o.harden = W.getBlock(0, 11, 0) === st('white_concrete');
  run(EL.spawn('falling_block', 2.5, 14, 0.5, { state: st('white_concrete_powder') }), 60);
  o.dry = W.getBlock(2, 11, 0) === st('white_concrete_powder');
  // LandingBlock.onLanding (anvil): event 1031 on landing, silent mutes it
  events.length = 0;
  run(EL.spawn('falling_block', -0.5, 14, 0.5, { state: st('anvil') }), 60);
  o.anvilEvent = W.getBlock(-1, 11, 0) === st('anvil') && events.includes(1031);
  events.length = 0;
  const sa = EL.spawn('falling_block', -2.5, 14, 0.5, { state: st('anvil') }); sa.silent = true; run(sa, 60);
  o.anvilSilent = events.length === 0 && W.getBlock(-3, 11, 0) === st('anvil');
  // RaycastContext(SOURCE_ONLY): water source found along the segment, flowing water / empty air is not
  cells.set(key(1, 20, 1), st('water'));
  const h = EL.sourceOnlyRaycast(1.5, 24, 1.5, 1.5, 18, 1.5);
  o.rayWater = !!h && h[0] === 1 && h[1] === 20 && h[2] === 1;
  o.rayAir = EL.sourceOnlyRaycast(-2.5, 24, 1.5, -2.5, 18, 1.5) === null;
  cells.set(key(-2, 20, 1), st('stone'));
  const hs = EL.sourceOnlyRaycast(-1.5, 24, 1.5, -1.5, 18, 1.5); o.rayBlock = hs === null;
  cells.set(key(-1, 20, 1), st('stone'));
  const hb = EL.sourceOnlyRaycast(-0.5 - 1, 24, 1.5, -0.5 - 1, 18, 1.5); o.rayBlock = !!hb && hb[1] === 20;
  // LunarWorldView.getMoonSize
  o.moon = JSON.stringify(EL.MOON_SIZES) === '[1,0.75,0.5,0.25,0,0.25,0.5,0.75]';
  // ZombieHorseEntity.initAttributes
  MCL.Mount = { childJumpStrengthBonus: () => 0.77 };
  const zh = EL.spawn('zombie_horse', 0.5, 11, 0.5, {});
  o.zhorse = !!zh && zh.jumpStrengthAttr === 0.77;
  // FlyingEntity / GolemEntity / ThrownItemEntity / fireball rows exist; thrown raycast set
  o.flying = EL.canSpawn('phantom') && EL.canSpawn('ghast');
  o.golem = EL.canSpawn('iron_golem') && EL.canSpawn('snow_golem') && EL.canSpawn('shulker');
  o.thrown = EL.THROWN.snowball === 1 && EL.THROWN.egg === 1 && EL.RAYCAST_THROWN.snowball === 1 && EL.RAYCAST_THROWN.egg === 1 && !EL.RAYCAST_THROWN.ender_pearl;
  const fb = EL.spawn('small_fireball', 0.5, 12, 0.5, { power: [0, -0.5, 0] });
  o.fireball = !!fb && typeof fb.powerY === 'number' && fb.powerY !== 0;
  // DataTracker defaults (EndCrystalEntity.initDataTracker)
  const ec = EL.spawn('end_crystal', 5.5, 12, 5.5, {});
  o.tracker = !!ec && ec.showBottom === true && ec.beamTarget === null;
  // PlayDeadTimerTask
  const ax = { type: 'axolotl', playingDead: true, playDeadTicks: 2 };
  MCL.Axolotl.tickPlayDead(ax); const mid = ax.playingDead; MCL.Axolotl.tickPlayDead(ax);
  o.playDead = mid === true && ax.playingDead === false;
  // EntityHitResult: pearlSweep is consulted for an ender pearl flight and its entity wins
  MCL.Throw = { pearlSweep: () => ({ id: 'victim' }) };
  const pe = EL.spawn('ender_pearl', 0.5, 20, 0.5, {});
  if (pe) { pe.vx = 0; pe.vy = 0.5; pe.vz = 0; run(pe, 1); }
  o.entityHit = !!pe && pe.pearlEntity && pe.pearlEntity.id === 'victim' && pe.pearlHit === true;
  return o;
}
const LBL = { harden: 'ConcretePowderBlock hardens in water', dry: 'ConcretePowderBlock stays powder dry', anvilEvent: 'LandingBlock anvil 1031 event', anvilSilent: 'LandingBlock silent mutes', rayWater: 'RaycastContext SOURCE_ONLY finds water source', rayAir: 'RaycastContext empty segment null', rayBlock: 'RaycastContext collider hit', moon: 'LunarWorldView MOON_SIZES', zhorse: 'ZombieHorseEntity jump roll', flying: 'FlyingEntity rows', golem: 'GolemEntity rows', thrown: 'ThrownItemEntity raycast set', fireball: 'AbstractFireballEntity power', tracker: 'DataTracker defaults', playDead: 'PlayDeadTimerTask countdown', entityHit: 'EntityHitResult pearlSweep wins' };
const A = trial(null);
for (const [k, m] of Object.entries(LBL)) ok(A[k], m);
const BR = [
  ['harden', 'EntityList', /if \(NS\.Behave && NS\.Behave\.concrete && SR\.waterIn\[cur\][\s\S]*?NS\.Behave\.place\(st, x, y, z\);/, ''],
  ['dry', 'EntityList', /SR\.waterIn\[cur\] && NS\.Behave\.concrete/, 'true && NS.Behave.concrete'],
  ['anvilEvent', 'EntityList', /dispenseEvent\(\{ x: x, y: y, z: z \}, 1031, 0\)/, 'dispenseEvent({ x: x, y: y, z: z }, 1030, 0)'],
  ['anvilSilent', 'EntityList', /if \(!e\.silent && NS\.BlockEntities\) NS\.BlockEntities\.dispenseEvent\(\{ x: x, y: y, z: z \}, 1031/, 'if (NS.BlockEntities) NS.BlockEntities.dispenseEvent({ x: x, y: y, z: z }, 1031'],
  ['rayWater', 'EntityList', /fluidLevel\(st\) === 0\) return \[cx, cy, cz\]/, 'fluidLevel(st) === 99) return [cx, cy, cz]'],
  ['rayBlock', 'EntityList', /else if \(P\.shapeAt && P\.shapeAt\(cx, cy, cz\)\) return/, 'else if (false) return'],
  ['moon', 'EntityList', /\[1\.0, 0\.75, 0\.5, 0\.25, 0\.0, 0\.25, 0\.5, 0\.75\]/, '[1.0, 0.75, 0.5, 0.25, 0.25, 0.25, 0.5, 0.75]'],
  ['zhorse', 'EntityList', /zombie_horse: function \(e\) \{\n\s*if \(e\.jumpStrengthAttr === undefined/, 'zombie_horse: function (e) {\n if (false'],
  ['flying', 'EntityList', /if \(bare === 'ghast'\) return \[0, 1\];/, ''],
  ['thrown', 'EntityList', /RAYCAST_THROWN = \{ snowball: 1, egg: 1 \}/, 'RAYCAST_THROWN = { snowball: 1 }'],
  ['tracker', 'EntityList', /e\.showBottom = true;/, 'e.showBottom = false;'],
  ['playDead', 'axolotl', /e\.playDeadTicks = \(e\.playDeadTicks \| 0\) - 1;/, 'e.playDeadTicks = (e.playDeadTicks | 0) - 2;'],
  ['entityHit', 'EntityList', /if \(peh\) \{ e\.pearlEntity = peh;/, 'if (false) { e.pearlEntity = peh;'],
  ['fireball', 'blaze', /if \(p\) Fb\.initPower\(e, p\[0\], p\[1\], p\[2\]\); else/, 'if (false) Fb.initPower(e, p[0], p[1], p[2]); else'],
];
const FILE = { EntityList: '07i_entitylist.js', axolotl: '07zm_axolotl.js', blaze: '07zzh_blaze.js' };
for (const [key, f, re, rep] of BR) {
  breaks++;
  let hit = false;
  const B = trial((fn, src) => { const n = fn === FILE[f] ? src.replace(re, rep) : src; if (n !== src) hit = true; return n; });
  ok(hit, 'break pattern matched: ' + key); ok(!B[key], 'break must be caught: ' + key);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `${pass} ok, ${breaks} breaks caught, 0 failed`);
process.exit(fails.length ? 1 : 0);
