#!/usr/bin/env node
// dragoncollidecheck.mjs -- #1804: EnderDragonEntity.tickMovement's launchLivingEntities (wings),
// damageLivingEntities (head/neck) and destroyBlocks (head/neck/body, dragon_immune kept).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
console.log('dragoncollidecheck -- #1804 dragon wing launch / head damage / destroyBlocks');

const M = loadEngine({
  extra: ['02g_items.js', '02f_tags.js', '07_world.js', '07b_behaviour.js', '07h_entities.js', '07y_equip.js',
    '07i_entitylist.js', '14b_physics.js', '14d_survival.js', '14f_inventory.js', '14i_hand.js', '07q_effects.js',
    '14j_combat.js', '07k_goals.js', '07zzl_enderdragon.js']
});
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Combat.init(); M.EnderDragon.init();
const W = M.World, CH = M.CH, EL = M.EntityList, ED = M.EnderDragon;
const st = (n) => M.States.stateOf(n) | 0;
const STONE = st('stone'), OBS = st('obsidian'), ENDSTONE = st('end_stone');

function world() {
  W.init(1);
  for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) {
    const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
  }
}
function dragon() {
  const e = EL.spawn('ender_dragon', 0, 90, 0, {});
  e.dragon.latestSegment = -1; e.dragon.tickWingAndSegments();   // fill the segment ring
  return e;
}
function parts(e) { e.dragon.d = e.dragon; e.dragon.hurtTime = 0; e.dragon.tickParts(); }
function fill(box, id) {
  for (let x = Math.floor(box.minX); x <= Math.floor(box.maxX); x++)
    for (let y = Math.floor(box.minY); y <= Math.floor(box.maxY); y++)
      for (let z = Math.floor(box.minZ); z <= Math.floor(box.maxZ); z++) W.setBlock(x, y, z, id);
}

// 1. blocks: stone in the head box goes, obsidian / end_stone stay (dragon_immune)
{
  world(); const e = dragon(); const d = e.dragon; d.entity = e;
  d.tickParts();
  const hb = d.head.getBox();
  const hx = Math.floor((hb.minX + hb.maxX) / 2), hy = Math.floor(hb.minY), hz = Math.floor((hb.minZ + hb.maxZ) / 2);
  W.setBlock(hx, hy, hz, STONE);
  W.setBlock(hx + 0, hy + 1, hz, OBS);
  const ES = W.getBlock(hx, hy, hz);
  ok(ES === STONE, 'setup: stone placed in the head box');
  d.tickParts();
  ok(W.getBlock(hx, hy, hz) === 0, 'stone inside the head hitbox is removed');
  ok(d.slowedDownByBlock === true || d.slowedDownByBlock === 1, 'obsidian left standing sets slowedDownByBlock');
  ok(W.getBlock(hx, hy + 1, hz) === OBS, 'obsidian survives (dragon_immune)');
  W.setBlock(hx, hy, hz, ENDSTONE); d.tickParts();
  ok(W.getBlock(hx, hy, hz) === ENDSTONE, 'end_stone survives (dragon_immune)');
  // anti-vacuity: the tag is what protects it -- without a tag hit stone would be swept
  W.setBlock(hx, hy, hz, STONE);
  const gOff = EL.aiCtx; EL.aiCtx = () => ({ mobGriefing: () => false });
  d.tickParts(); EL.aiCtx = gOff;
  okAv(W.getBlock(hx, hy, hz) === STONE, 'mobGriefing off keeps stone (the removal is really gated)');
  d.tickParts();
  okAv(W.getBlock(hx, hy, hz) === 0, 'with mobGriefing on stone is removed again');
}

// 2. wing launch + head damage on a player
{
  world(); const e = dragon(); const d = e.dragon; d.entity = e; d.tickParts();
  const P = { type: 'player', x: 0, y: 0, z: 0, width: 0.6, height: 1.8, vx: 0, vy: 0, vz: 0, health: 20, maxHealth: 20, age: 100 };
  M.Player = P;
  const wb = d.rightWing.getBox();
  P.x = (wb.minX + wb.maxX) / 2 + 3; P.z = (wb.minZ + wb.maxZ) / 2; P.y = wb.minY - 1;
  d.tickParts();
  ok(Math.hypot(P.vx, P.vz) > 0.01, 'a player beside the wing is launched (vx/vz ' + P.vx + ',' + P.vz + ')');
  ok(P.vy > 0.19, 'launch has the +0.2 upward kick');
  const hp = P.health;
  const hb = d.head.getBox();
  P.vx = P.vz = P.vy = 0; P.x = (hb.minX + hb.maxX) / 2; P.z = (hb.minZ + hb.maxZ) / 2; P.y = hb.minY; P.invulnerableGamemode = false;
  d.tickParts();
  ok(P.health < hp, 'a player in the head box takes damage (' + hp + ' -> ' + P.health + ')');
  const h2 = P.health; P.invulnerableGamemode = true; d.tickParts();
  okAv(P.health === h2, 'creative/spectator players are skipped');
}
console.log(`${pass} checks passed, ${breaks} breaks caught, ${fails.length} failed`);
for (const f of fails) console.log('  FAIL: ' + f);
process.exit(fails.length ? 1 : 0);
