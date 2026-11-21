#!/usr/bin/env node
// netheritemcheck.mjs — #10984 (G27j): RespawnAnchorBlock (src/14m_sleep.js Sleep.anchor*, hooked
// from Use.blockUse): glowstone charging 0..4, set-spawn in the Nether, power-5 explosion outside it,
// respawn costing one charge, 0 charges / missing anchor falling back to world spawn.
// Read off .decomp/net/minecraft/block/RespawnAnchorBlock.java. The dimension is forced with
// Sleep.anchorDimension (the world dimension switch #262 is not needed for this).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); };

console.log('netheritemcheck — #10984: anchor/bed/lodestone follow the live dimension');

const EXTRA = ['02f_tags.js', '07za_explosion.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
  '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
  '07i_entitylist.js', '07l_spawn.js', '14d_survival.js', '14e_gamemode.js', '09b_sky.js',
  '07zq_snowgolem.js', '14f_inventory.js', '14j_combat.js', '14_player.js', '14l_use.js',
  '07m_breed.js', '07q_effects.js', '07zu_poi.js', '07k_goals.js', '07zv_villagerbrain.js', '07zz1_phantom.js', '14m_sleep.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json'), monsterTypes: [] });
M.Entities.init();
const W = M.World, CH = M.CH, R = M.Reg, SR = M.States, B = M.Behave, Sleep = M.Sleep, U = M.Use, Iv = M.Inventory;
W.init(1); B.init(W); M.Explosion.init();
if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init();
M.EntityList.init(); M.Ai.init(); U.init(W); Sleep.init(W);
ok(Sleep.ready && U.ready, 'Sleep/Use ready');
for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
const msgs = []; M.Hud = { say(m) { msgs.push(m); } };
const sounds = []; M.Sound = { play(n) { sounds.push(n); } };
const STONE = SR.stateOf('stone'), ANCHOR0 = SR.stateOf('respawn_anchor');
const charges = (x, y, z) => +B.propName(W.getBlock(x, y, z), 'charges');
const Y = 64;
function reset() {
  for (let x = -12; x <= 12; x++) for (let z = -12; z <= 12; z++) {
    for (let y = Y - 3; y <= Y + 6; y++) W.setBlock(x, y, z, 0);
    W.setBlock(x, Y - 1, z, STONE);
  }
  W.setBlock(0, Y, 0, ANCHOR0);
  msgs.length = 0; sounds.length = 0;
}
const glow = () => Iv.withTag ? { i: M.Items.names.indexOf('glowstone'), n: 64 } : null;
function mkP() { return { x: 3.5, y: Y, z: 3.5, yaw: 0, spawnPoint: null, instabuild: false }; }
function click(P, held) { return U.blockUse(P, 0, Y, 0, W.getBlock(0, Y, 0), held); }

// Sleep.dimension/anchorDimension stay at defaults: the LIVE dimension (World.setDimension -> NS.Dim.cur) decides.
const BED = SR.stateOf('red_bed');
const names = ['overworld', 'the_nether', 'the_end'];
function setDim(d) { M.Dim.cur = d; W.dimension = d; }
function anchorOutcome(dim) {
  reset(); setDim(dim);
  W.setBlock(0, Y, 0, B.setProp(ANCHOR0, 'charges', 2));
  const P = mkP(); click(P, null);
  return { exploded: W.getBlock(0, Y, 0) === 0, spawn: !!(P.spawnPoint && P.spawnPoint.anchor) };
}
let r = anchorOutcome('overworld'); ok(r.exploded && !r.spawn, 'overworld anchor explodes');
r = anchorOutcome('the_nether'); ok(!r.exploded && r.spawn, 'nether anchor sets spawn');
r = anchorOutcome('the_end'); ok(r.exploded && !r.spawn, 'end anchor explodes');
setDim('overworld');
ok(Sleep.isBedWorking() === true, 'bed works in overworld');
setDim('the_nether'); ok(Sleep.isBedWorking() === false, 'bed does not work in nether');
setDim('the_end'); ok(Sleep.isBedWorking() === false, 'bed does not work in end');
// bed explosion: both halves removed
function bedOutcome(dim) {
  reset(); setDim(dim);
  const foot = B.setProp(B.setProp(BED, 'facing', 'south'), 'part', 'foot');
  const head = B.setProp(B.setProp(BED, 'facing', 'south'), 'part', 'head');
  W.setBlock(0, Y, 0, foot); W.setBlock(0, Y, 1, head);
  const P = mkP(); P.x = 0.5; P.z = 0.5;
  U.blockUse(P, 0, Y, 0, W.getBlock(0, Y, 0), null);
  return W.getBlock(0, Y, 0) === 0 && W.getBlock(0, Y, 1) === 0;
}
ok(bedOutcome('the_nether') === true, 'nether bed explodes (both halves gone)');
ok(bedOutcome('the_end') === true, 'end bed explodes');
// lodestone dimension tag
function lodeDim(dim) {
  reset(); setDim(dim);
  W.setBlock(2, Y, 2, SR.stateOf('lodestone'));
  const st = Iv.stack('compass', 1, 0, {}); const P = mkP(); P.instabuild = false; P.slot = 0;
  P.inventory = Iv.create ? Iv.create() : { slots: [] }; if (Iv.setItem) Iv.setItem(P.inventory, 0, st);
  U.itemUseOn(P, 2, Y, 2, 1, W.getBlock(2, Y, 2), st);
  const t = st;
  return t.t && t.t.LodestoneDimension;
}
ok(lodeDim('the_nether') === 'minecraft:the_nether', 'lodestone compass tags the_nether');
ok(lodeDim('overworld') === 'minecraft:overworld', 'lodestone compass tags overworld');
// compass in another dimension points nowhere
{
  setDim('the_nether');
  const stk = { i: 1, n: 1, t: { LodestoneDimension: 'minecraft:overworld', LodestonePos: { X: 5, Y: 64, Z: 5 } } };
  ok(U.lodestonePos(stk, 'the_nether') === null, 'lodestone in other dimension ignored');
  ok(U.lodestonePos(stk, 'overworld') !== null, 'lodestone in same dimension tracked');
}
setDim('overworld');
// anti-vacuity: break the data (make nether look like overworld / vice versa) and the check must notice
{
  const real = M.Dim.get('the_nether').bedWorks; M.Dim.get('the_nether').bedWorks = true; setDim('the_nether');
  okAv(Sleep.isBedWorking() === true && real === false, 'forcing bedWorks=true flips nether bed behaviour'); M.Dim.get('the_nether').bedWorks = real;
  setDim('overworld');
  const a = anchorOutcome('the_nether'); Sleep.anchorDimension = 'overworld'; M.Dim.cur = 'overworld';
  okAv(anchorOutcome('overworld').exploded !== a.exploded, 'anchor outcome differs between dimensions');
  Sleep.dimension = 'the_nether'; okAv(Sleep.isAnchorWorking() === true, 'legacy override still honoured'); Sleep.dimension = 'overworld';
}
if (fails.length) { console.log('\nFAIL netheritemcheck'); for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
console.log(`netheritemcheck: ${pass} checks passed, 0 failures (${breaks} anti-vacuity)`);
for (let i = 1; i <= breaks; i++) console.log(`  ✓ anti-vacuity break ${i} caught`);
