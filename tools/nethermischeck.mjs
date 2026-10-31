#!/usr/bin/env node
// nethermischeck.mjs — #266 G27m: RespawnAnchorBlock.onUse (Sleep.useAnchor, 14m_sleep.js):
// glowstone charges (<4, consumed outside creative), 0 charges passes, overworld explodes
// (power 5, createFire, badRespawnPoint), nether sets the spawn point.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); };

console.log('nethermischeck — #266 respawn anchor use (Sleep.useAnchor)');
const EXTRA = ['02f_tags.js', '07za_explosion.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
  '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
  '07i_entitylist.js', '07l_spawn.js', '14d_survival.js', '14e_gamemode.js', '09b_sky.js',
  '07zq_snowgolem.js', '14f_inventory.js', '14j_combat.js', '14_player.js', '14l_use.js',
  '07m_breed.js', '07q_effects.js', '07zu_poi.js', '07k_goals.js', '07zv_villagerbrain.js', '07zz1_phantom.js', '14m_sleep.js',
  '10_camera.js', '10_gfx.js', '14i_hand.js', '14k_hand3d.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json'),
  monsterTypes: JSON.parse(/monsterTypes:\s*(\[[^\]]*\])/.exec(readFileSync(join(MCLITE_ROOT, 'src', '19_data.gen.js'), 'utf8'))[1]) });
M.Entities.init();
const W = M.World, CH = M.CH, R = M.Reg, SR = M.States, Sleep = M.Sleep, U = M.Use, B = M.Behave, Iv = M.Inventory;
W.init(1); B.init(W); if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init();
M.EntityList.init(); M.Ai.init(); U.init(W); Sleep.init(W); M.Explosion.init();
const msgs = []; M.Hud = { say(m) { msgs.push(m); } };
for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
const AX = 0, AY = 64, AZ = 0;
const anchor = (c) => B.setProp(SR.stateOf('respawn_anchor'), 'charges', c);
const charges = () => +B.propName(W.getBlock(AX, AY, AZ), 'charges');
const glow = (n) => Iv.stack('glowstone', n);
const mkP = (creative) => ({ x: 0.5, y: 65, z: 0.5, px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, yaw: 0, spawnPoint: null, mode: creative ? 1 : 0, instabuild: !!creative, slot: 0 });
function put(c) { W.setBlock(AX, AY, AZ, anchor(c)); }
const run = (P, c, held) => { put(c); return U.blockUse(P, AX, AY, AZ, W.getBlock(AX, AY, AZ), held); };

// charging
{
  const P = mkP(false), h = glow(2);
  const r = run(P, 0, h);
  ok(r === true && charges() === 1, 'glowstone charges 0 -> 1, consumed');
  ok(h.n === 1, 'one glowstone consumed');
  run(P, 3, h); ok(charges() === 4, '3 -> 4');
  Sleep.dimension = 'the_nether';
  const h2 = glow(1); run(P, 4, h2);
  okAv(charges() === 4 && h2.n === 1 && P.spawnPoint, 'a full anchor takes no more glowstone (falls to set-spawn in the nether)');
  Sleep.dimension = 'overworld';
  const hc = glow(3); run(mkP(true), 1, hc); ok(hc.n === 3 && charges() === 2, 'creative keeps the stack');
}
// empty anchor passes
{ const P = mkP(false); const r = run(P, 0, undefined); ok(r === false && charges() === 0 && !P.spawnPoint, 'empty anchor + no glowstone passes'); }
// overworld explodes
{
  Sleep.dimension = 'overworld'; const P = mkP(false);
  const Ex = M.Explosion, real = Ex.explode; let seen = null;
  Ex.explode = function () { seen = Array.prototype.slice.call(arguments); return real.apply(this, arguments); };
  const r = run(P, 2, undefined);
  Ex.explode = real;
  ok(r === true, 'overworld click consumed');
  ok(seen && seen[4] === 5.0 && seen[9] === true && seen[11] === 'badRespawnPoint', 'explosion power 5, createFire, badRespawnPoint');
  ok(W.getBlock(AX, AY, AZ) !== anchor(2) && SR.name(W.getBlock(AX, AY, AZ)) !== 'respawn_anchor', 'anchor removed');
  okAv(!P.spawnPoint, 'overworld explosion does not set the spawn');
}
// nether sets spawn
{
  Sleep.dimension = 'the_nether'; const P = mkP(false); msgs.length = 0;
  const r = run(P, 1, undefined);
  ok(r === true && P.spawnPoint && P.spawnPoint.x === AX && P.spawnPoint.y === AY && P.spawnPoint.z === AZ, 'nether click sets the spawn point');
  ok(msgs.includes('Respawn point set'), 'message sent');
  ok(SR.name(W.getBlock(AX, AY, AZ)) === 'respawn_anchor', 'anchor stays');
  msgs.length = 0; run(P, 1, undefined); ok(msgs.length === 0, 'clicking the same anchor again is silent');
  Sleep.dimension = 'overworld';
}
// lodestone compass (CompassItem.useOnBlock)
{
  const LX = 3, LZ = 3; W.setBlock(LX, AY, LZ, SR.stateOf('lodestone')); Sleep.dimension = 'overworld';
  const P = mkP(false); P.inventory = Iv.create ? Iv.create() : P.inventory;
  const c1 = Iv.stack('compass', 1);
  const r = U.itemUseOn(P, LX, AY, LZ, 1, W.getBlock(LX, AY, LZ), c1);
  ok(r === true && c1.t && c1.t.LodestonePos.X === LX && c1.t.LodestonePos.Z === LZ && c1.t.LodestoneTracked === true
     && c1.t.LodestoneDimension === 'minecraft:overworld', 'single survival compass is bound in place');
  const c2 = Iv.stack('compass', 2); const P2 = mkP(false); P2.inventory = P.inventory;
  U.itemUseOn(P2, LX, AY, LZ, 1, W.getBlock(LX, AY, LZ), c2);
  ok(c2.n === 1 && !c2.t, 'a stack of two keeps one plain compass (one bound copy is split off)');
  const P3 = mkP(true); P3.inventory = P.inventory; const c3 = Iv.stack('compass', 1);
  U.itemUseOn(P3, LX, AY, LZ, 1, W.getBlock(LX, AY, LZ), c3);
  ok(c3.n === 1 && !c3.t, 'creative keeps the plain compass');
  W.setBlock(LX, AY, LZ, 0); const c4 = Iv.stack('compass', 1);
  U.itemUseOn(P, LX, AY - 1, LZ, 1, W.getBlock(LX, AY - 1, LZ), c4);
  okAv(!c4.t, 'a compass on a non-lodestone binds nothing');
}
// anti-vacuity: break the cap in a copy and the same scenario must differ
{
  const src = Sleep.useAnchor.toString().replace('c < 4', 'c < 99');
  const broken = new Function('B', 'W', 'NS', 'changed', 'say', 'Sleep', 'return (' + src + ')');
  const f = broken(B, W, M, () => {}, () => {}, Sleep);
  Sleep.dimension = 'the_nether'; put(4);
  const hh = glow(2); f(mkP(false), AX, AY, AZ, W.getBlock(AX, AY, AZ), hh, true);
  okAv(hh.n === 1, 'a cap-less useAnchor over-charges (the real one does not)');
  Sleep.dimension = 'overworld';
}
console.log(`nethermischeck: ${pass} checks passed, ${fails.length} failures`);
for (let i = 0; i < breaks; i++) console.log(`  ✓ anti-vacuity break ${i + 1} caught`);
console.log(`${breaks} breaks caught`);
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
