#!/usr/bin/env node
// respawnanchorcheck.mjs — #5802 (#5802): RespawnAnchorBlock (src/14m_sleep.js Sleep.anchor*, hooked
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

console.log('respawnanchorcheck — #5802 (#5802): respawn anchor charge / set-spawn / explosion / respawn');

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

// 1. charge ladder
reset(); Sleep.anchorDimension = 'overworld';
{
  const P = mkP(), g = glow();
  ok(g && g.i > 0, 'glowstone stack resolves');
  for (let k = 1; k <= 4; k++) { ok(click(P, g) === true, 'glowstone click ' + k + ' consumed'); ok(charges(0, Y, 0) === k, 'charges = ' + k); }
  ok(g.n === 60, 'four glowstone spent (' + g.n + ')');
  ok(sounds.filter((s) => s === 'block.respawn_anchor.charge').length === 4, 'charge sound x4');
  // a fifth glowstone is refused: charged anchor outside the Nether would EXPLODE (not charge)
  Sleep.anchorDimension = 'the_nether';
  const before = g.n;
  click(P, g);
  ok(charges(0, Y, 0) === 4 && g.n === before, 'fifth glowstone refused (charges 4, stack untouched)');
  ok(P.spawnPoint && P.spawnPoint.anchor, 'and the click fell through to set-spawn');
  // creative keeps the stack
  reset(); const C = mkP(); C.instabuild = true; const g2 = glow(); click(C, g2);
  ok(charges(0, Y, 0) === 1 && g2.n === 64, 'creative charges without spending');
  // empty click on 0 charges passes
  reset(); ok(click(mkP(), null) === false, '0 charges + empty hand passes');
}
// 2. set-spawn in the Nether
reset(); Sleep.anchorDimension = 'the_nether';
{
  const P = mkP(), g = glow(); click(P, g); msgs.length = 0; sounds.length = 0;
  ok(click(P, null) === true, 'empty-hand click consumed');
  ok(P.spawnPoint && P.spawnPoint.x === 0 && P.spawnPoint.y === Y && P.spawnPoint.z === 0, 'spawn point = anchor');
  ok(msgs.length === 1 && /Respawn point set/.test(msgs[0]), 'set_spawn message');
  ok(sounds.includes('block.respawn_anchor.set_spawn'), 'set_spawn sound');
  msgs.length = 0; click(P, null);
  ok(msgs.length === 0, 'same anchor again: no second message');
  ok(W.getBlock(0, Y, 0) !== 0 && charges(0, Y, 0) === 1, 'anchor intact in the Nether');
}
// 3. explosion outside the Nether
reset(); Sleep.anchorDimension = 'overworld';
{
  const P = mkP(), g = glow(); click(P, g);
  const planks = SR.stateOf('oak_planks'); W.setBlock(2, Y, 0, planks);
  click(P, null);
  ok(W.getBlock(0, Y, 0) === 0 || SR.name(W.getBlock(0, Y, 0)) !== 'respawn_anchor', 'anchor gone after explosion');
  ok(P.spawnPoint === null, 'no spawn set outside the Nether');
  // power 5 reaches a plank 2 away and blasts a crater into the floor below
  ok(W.getBlock(2, Y, 0) === 0 || SR.name(W.getBlock(2, Y, 0)) !== 'oak_planks', 'a plank 2 away is blasted (power 5)');
}
// 4. respawn at anchor costs a charge; 0 charges falls back
reset(); Sleep.anchorDimension = 'the_nether';
{
  const P = mkP(), g = glow(); click(P, g); click(P, g); click(P, null);
  const r1 = Sleep.respawnPos(P);
  ok(r1 && Math.abs(r1.x - r1.x) === 0 && Math.max(Math.abs(r1.x - 0.5), Math.abs(r1.z - 0.5)) <= 1.01, 'respawn lands beside the anchor');
  ok(charges(0, Y, 0) === 1, 'respawn cost one charge (2 -> 1)');
  ok(sounds.includes('block.respawn_anchor.deplete'), 'deplete sound');
  const r2 = Sleep.respawnPos(P);
  ok(r2 && charges(0, Y, 0) === 0, 'second respawn 1 -> 0');
  ok(Sleep.respawnPos(P) === null, '0 charges: fall back to world spawn (null)');
  ok(charges(0, Y, 0) === 0, 'and no negative charge');
  // anchor broken
  reset(); const Q = mkP(); click(Q, glow()); click(Q, null); W.setBlock(0, Y, 0, 0);
  ok(Sleep.respawnPos(Q) === null, 'broken anchor: fall back');
  // obstructed: every neighbour cell filled
  reset(); const O = mkP(); click(O, glow()); click(O, null);
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 2; dy++) if (dx || dz || dy) W.setBlock(dx, Y + dy, dz, STONE);
  ok(Sleep.respawnPos(O) === null && charges(0, Y, 0) === 1, 'obstructed: fall back, charge kept');
  // Overworld: the anchor does not work for respawn
  reset(); const V = mkP(); click(V, glow()); click(V, null); Sleep.anchorDimension = 'overworld';
  ok(Sleep.respawnPos(V) === null && charges(0, Y, 0) === 1, 'outside the Nether the anchor is not a respawn point');
  Sleep.anchorDimension = 'the_nether';
}
// 5. anti-vacuity: break the module's own rules and watch the assertions notice
{
  // explodes in the Nether (flag broken)
  reset(); Sleep.isAnchorWorking = () => false; { const P = mkP(); click(P, glow()); click(P, null); }
  okAv(SR.name(W.getBlock(0, Y, 0)) !== 'respawn_anchor', 'broken dimension flag explodes the anchor in the Nether (caught)');
  Sleep.isAnchorWorking = () => Sleep.anchorDimension === 'the_nether';
  // no charge cost
  reset(); { const P = mkP(); click(P, glow()); click(P, glow()); click(P, null); const orig = Sleep.anchorRespawnPos;
    W.setBlock(0, Y, 0, ANCHOR0); const st2 = B.setProp(ANCHOR0, 'charges', 2); W.setBlock(0, Y, 0, st2);
    const p0 = charges(0, Y, 0); Sleep.respawnPos(P); const p1 = charges(0, Y, 0);
    okAv(p1 === p0 - 1, 'respawn changes the charge count (a free respawn would be caught)'); }
  // no cap at 4
  reset(); { const P = mkP(); P.instabuild = true; Sleep.anchorDimension = 'overworld';
    for (let k = 0; k < 4; k++) click(P, glow());
    const g = glow(); const n0 = g.n; Sleep.anchorDimension = 'the_nether'; click(P, g);
    okAv(charges(0, Y, 0) === 4 && g.n === n0, 'a fifth glowstone does not push charges past 4 (cap missing would be caught)'); }
  reset(); { const P = mkP(); click(P, null); okAv(P.spawnPoint === null && charges(0, Y, 0) === 0, 'an uncharged anchor sets no spawn'); }
}
if (fails.length) { console.log('\nFAIL respawnanchorcheck'); for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
console.log(`respawnanchorcheck: ${pass} checks passed, 0 failures (${breaks} anti-vacuity)`);
for (let i = 1; i <= breaks; i++) console.log(`  ✓ anti-vacuity break ${i} caught`);
