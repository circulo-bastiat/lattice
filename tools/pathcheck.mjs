#!/usr/bin/env node
// pathcheck.mjs — QUEUE 0.2 / Ai.OWED (s117, loop/pathtypes): vanilla 1.18.2's WHOLE land
// node-type table and the per-mob pathfinding penalties, read off .decomp
// (LandPathNodeMaker.java:250-582, PathNodeType.java:4-29, every constructor
// setPathfindingPenalty). Asserts both directions: what a mob now avoids AND what it still may do.
//
//   node tools/pathcheck.mjs [--verbose]

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); if (VERBOSE) console.log((c ? '   ✓ ' : '   ✗ ') + m); return c; };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); };

console.log('pathcheck — vanilla land node types + per-mob pathfinding penalties');
const M = loadEngine({
  extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js',
          '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14c_raycast.js']
});
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Behave.init(M.World); M.Ai.init();
const Ai = M.Ai, W = M.World, CH = M.CH, T = Ai.NodeType;
ok(Ai.hazardsReady(), 'hazard tag table resolved from real jar tags');
const stateOf = (n) => M.States.stateOf(n) | 0;
const STONE = stateOf('stone');
const PLAT_Y = 8, Y = PLAT_Y + 1;
function fresh(r) {
  W.init(1);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
    const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
  }
  for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) W.setBlock(x, PLAT_Y, z, STONE);
}
const mob = (type, x, z) => ({ id: 1, type, x: x + 0.5, y: Y, z: z + 0.5, width: 0.9, height: 1.4 });

// ── 1. the table itself (PathNodeType.java:4-29) ──
console.log(' 1. PathNodeType: 26 constants, their default penalties, enum order');
{
  const want = { BLOCKED: -1, OPEN: 0, WALKABLE: 0, WALKABLE_DOOR: 0, TRAPDOOR: 0, POWDER_SNOW: -1,
    DANGER_POWDER_SNOW: 0, FENCE: -1, LAVA: -1, WATER: 8, WATER_BORDER: 8, RAIL: 0, UNPASSABLE_RAIL: -1,
    DANGER_FIRE: 8, DAMAGE_FIRE: 16, DANGER_CACTUS: 8, DAMAGE_CACTUS: -1, DANGER_OTHER: 8, DAMAGE_OTHER: -1,
    DOOR_OPEN: 0, DOOR_WOOD_CLOSED: -1, DOOR_IRON_CLOSED: -1, BREACH: 4, LEAVES: -1, STICKY_HONEY: 8, COCOA: 0 };
  const names = Object.keys(want);
  ok(Object.keys(T).length === 26 && Ai.ENUM_ORDER.length === 26, 'all 26 constants exist, in an enum order of 26');
  let bad = names.filter((n) => Ai.DEFAULT_PENALTY[T[n]] !== want[n]);
  ok(bad.length === 0, 'every default penalty matches the jar (' + (bad.join(',') || 'none off') + ')');
  ok(names.every((n, i) => Ai.ENUM_ORDER[i] === T[n]), 'ENUM_ORDER is the declaration order');
}

// ── 2. getCommonNodeType (:527-574) ──
console.log(' 2. getCommonNodeType identities');
{
  fresh(8);
  const put = (n, x) => { W.setBlock(x, Y, -6, stateOf(n)); return Ai.commonNodeType(x, Y, -6); };
  ok(put('honey_block', -6) === T.STICKY_HONEY, 'honey_block -> STICKY_HONEY');
  ok(put('oak_leaves', -4) === T.LEAVES, 'oak_leaves -> LEAVES');
  ok(put('rail', -2) === T.RAIL, 'rail -> RAIL');
  ok(put('oak_fence', 0) === T.FENCE, 'oak_fence -> FENCE');
  ok(put('cobblestone_wall', 2) === T.FENCE, 'cobblestone_wall -> FENCE (walls tag)');
  ok(put('oak_trapdoor', 4) === T.TRAPDOOR, 'oak_trapdoor -> TRAPDOOR');
  ok(put('magma_block', 6) === T.DAMAGE_FIRE, 'magma_block -> DAMAGE_FIRE (inflictsFireDamage)');
  ok(put('oak_fence_gate', 7) === T.FENCE, 'a closed fence gate -> FENCE');
  ok(Ai.commonNodeType(8, Y, -6) === T.OPEN, 'air -> OPEN');
  ok(Ai.commonNodeType(8, PLAT_Y, -6) === T.BLOCKED, 'stone -> BLOCKED');
}

// ── 3. getLandNodeType + getNodeTypeFromNeighbors (:455-525) ──
console.log(' 3. getLandNodeType: the cell below, then the neighbours');
{
  fresh(8);
  W.setBlock(-4, PLAT_Y, 0, stateOf('honey_block'));
  W.setBlock(4, PLAT_Y, 0, stateOf('magma_block'));
  W.setBlock(0, PLAT_Y, 4, stateOf('sand')); W.setBlock(0, Y, 4, stateOf('cactus'));
  W.setBlock(0, PLAT_Y, -4, stateOf('water'));
  W.setBlock(6, Y, 6, stateOf('oak_fence'));
  ok(Ai.pathTypeAt(-4, Y, 0) === T.STICKY_HONEY, 'standing on honey -> STICKY_HONEY');
  ok(Ai.pathTypeAt(4, Y, 0) === T.DAMAGE_FIRE, 'standing on magma -> DAMAGE_FIRE');
  ok(Ai.pathTypeAt(1, Y, 4) === T.DANGER_CACTUS, 'beside a cactus -> DANGER_CACTUS');
  ok(Ai.pathTypeAt(1, Y, -4) === T.WALKABLE || Ai.pathTypeAt(1, Y, -4) === T.WATER_BORDER, 'beside water (one below) reads a walkable-family type');
  ok(Ai.pathTypeAt(1, PLAT_Y + 1, -3) !== T.BLOCKED, 'no false BLOCKED near water');
  ok(Ai.pathTypeAt(0, Y, 0) === T.WALKABLE, 'plain stone floor, nothing near -> WALKABLE (both directions)');
  ok(Ai.pathTypeAt(6, Y + 1, 6) === T.WALKABLE, 'the cell over a fence is WALKABLE (the 1.5 top is the feetY rule, not the type)');
  ok(Ai.pathTypeAt(0, Y + 3, 0) === T.OPEN, 'air over air -> OPEN');
  Ai.__testNeighborsOff = true;
  okAv(Ai.pathTypeAt(1, Y, 4) === T.WALKABLE, 'with the neighbour scan off, the cactus-adjacent cell reads WALKABLE — the DANGER assertion can fail');
  Ai.__testNeighborsOff = 'common';
  okAv(Ai.pathTypeAt(-4, Y, 0) === T.OPEN, 'with the below-cell rule off, the honey cell reads OPEN');
  Ai.__testNeighborsOff = false;
}

// ── 4. per-mob penalties (constructor setPathfindingPenalty rows) ──
console.log(' 4. MobEntity.getPathfindingPenalty per species');
{
  const P = (t, n) => Ai.pathPenalty({ type: t }, T[n]);
  ok(P('cow', 'DANGER_FIRE') === 16 && P('cow', 'DAMAGE_FIRE') === -1, 'AnimalEntity: DANGER_FIRE 16, DAMAGE_FIRE -1');
  ok(P('zombie', 'DAMAGE_FIRE') === 16 && P('zombie', 'DANGER_FIRE') === 8, 'a zombie keeps the defaults');
  ok(P('villager', 'DAMAGE_FIRE') === -1, 'MerchantEntity rows reach the villager');
  ok(P('chicken', 'WATER') === 0 && P('cow', 'WATER') === 8, 'chicken WATER 0, cow the default 8');
  ok(P('bee', 'FENCE') === -1 && P('bee', 'WATER_BORDER') === 16 && P('bee', 'DANGER_FIRE') === -1, 'bee: FENCE -1, WATER_BORDER 16, and its own DANGER_FIRE -1 overrides AnimalEntity\'s 16');
  ok(P('strider', 'LAVA') === 0 && P('strider', 'DAMAGE_FIRE') === 0, 'strider LAVA 0, DAMAGE_FIRE 0 (over AnimalEntity\'s -1)');
  ok(P('fox', 'DAMAGE_OTHER') === 0 && P('wolf', 'POWDER_SNOW') === -1 && P('blaze', 'WATER') === -1, 'fox/wolf/blaze rows');
  ok(Ai.pathPenalty({ type: 'cow', pathMalus: { [T.WATER]: 0 } }, T.WATER) === 0, 'a goal-set per-entity value wins (FollowOwnerGoal shape)');
  ok(Ai.pathPenalty(null, T.STICKY_HONEY) === 8, 'no mob -> the default');
}

// ── 5. the A* obeys them ──
console.log(' 5. A*: a fence pen holds a cow; honey is routed round; the fire-afraid avoid magma');
{
  fresh(8);
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) {
    if (Math.max(Math.abs(x), Math.abs(z)) === 3) W.setBlock(x, Y, z, stateOf('oak_fence'));
  }
  const cow = mob('cow', 0, 0);
  ok(Ai.findPath(cow.x, cow.y, cow.z, 6.5, Y, 0.5, { maxDrop: 1, mob: cow, maxNodes: 600 }) === null, 'a cow inside a fence ring has no path out');
  ok(Ai.findPath(cow.x, cow.y, cow.z, 2.5, Y, 0.5, { maxDrop: 1, mob: cow }) !== null, 'but can still walk inside it');
  Ai.__testNoFeet = true;
  okAv(Ai.findPath(cow.x, cow.y, cow.z, 6.5, Y, 0.5, { maxDrop: 1, mob: cow, maxNodes: 600 }) !== null, 'with the 1.125 feet rule off, the cow climbs the fence — the pen test can fail');
  Ai.__testNoFeet = false;

  fresh(8);
  for (let z = -2; z <= 2; z++) W.setBlock(0, PLAT_Y, z, stateOf('honey_block'));
  const z0 = mob('zombie', -4, 0);
  const via = (p) => p && p.some((n) => n.x === 0 && Math.abs(n.z) <= 2);
  const p1 = Ai.findPath(z0.x, z0.y, z0.z, 4.5, Y, 0.5, { maxDrop: 1, mob: z0, maxNodes: 800 });
  ok(p1 && !via(p1), 'a zombie routes round a 5-long honey strip (penalty 8) rather than over it');
  Ai.__testNoMalus = true;
  const p2 = Ai.findPath(z0.x, z0.y, z0.z, 4.5, Y, 0.5, { maxDrop: 1, mob: z0, maxNodes: 800 });
  Ai.__testNoMalus = false;
  okAv(via(p2), 'with penalties off, the same path crosses the honey — the detour assertion can fail');

  fresh(8);
  for (let z = -8; z <= 8; z++) W.setBlock(0, PLAT_Y, z, stateOf('magma_block'));
  const c2 = mob('cow', -4, 0), zz = mob('zombie', -4, 0);
  ok(Ai.findPath(c2.x, c2.y, c2.z, 4.5, Y, 0.5, { maxDrop: 1, mob: c2, maxNodes: 900 }) === null, 'a cow will not cross a magma wall (AnimalEntity DAMAGE_FIRE -1)');
  ok(Ai.findPath(zz.x, zz.y, zz.z, 4.5, Y, 0.5, { maxDrop: 1, mob: zz, maxNodes: 900 }) !== null, 'a zombie will (DAMAGE_FIRE 16 is a cost, not a wall)');
}

console.log(' 7. s119 — canPathfindThrough(LAND) off the jar\'s override table; groundLevel refuses by the mob\'s own penalty');
{
  const tab = M.DATA && M.DATA.pathLand;
  ok(tab && Object.keys(tab).length >= 250, `NS.DATA.pathLand is loaded (${tab ? Object.keys(tab).length : 0} rows)`);
  // referee: re-derive the table from .decomp itself (extract-pathfind's derive(), not the golden)
  const DEC = join(ROOT, '.decomp', 'net', 'minecraft', 'block');
  if (existsSync(DEC)) {
    const { derive } = await import('./extract-pathfind.mjs');
    const d = derive(DEC);
    const want = Object.fromEntries(d.rows.map(r => [r[0], r[1]]));
    const diff = Object.keys(Object.assign({}, want, tab)).filter(k => want[k] !== tab[k]);
    ok(diff.length === 0 && d.unjoined.length === 0 && d.unclassified.length === 0,
       `the table equals .decomp's own override walk (${diff.slice(0, 5).join(',') || 'no diff'})`);
  }
  fresh(8);
  const at = (n, x) => { W.setBlock(x, Y, 6, typeof n === 'number' ? n : stateOf(n)); return Ai.commonNodeType(x, Y, 6); };
  ok(at('white_carpet', -6) === T.OPEN, 'a carpet (not a full cube, no override) -> OPEN, where the collision stand-in said BLOCKED');
  ok(at('ladder', -5) === T.OPEN, 'a ladder -> OPEN (base !isFullCube)');
  ok(at('oak_slab', -4) === T.BLOCKED, 'a slab -> BLOCKED (SlabBlock LAND false)');
  ok(at('oak_stairs', -3) === T.BLOCKED, 'stairs -> BLOCKED (StairsBlock false)');
  ok(at('iron_bars', -2) === T.BLOCKED, 'iron bars -> BLOCKED (HorizontalConnectingBlock false)');
  ok(at('chest', -1) === T.BLOCKED, 'a chest -> BLOCKED (ChestBlock false)');
  const snowN = (k) => { for (let st = stateOf('snow'); st < stateOf('snow') + 8; st++) if (M.States.block[st] === M.States.block[stateOf('snow')] && M.Behave.propName(st, 'layers') === String(k)) return st; return -1; };
  ok(at(snowN(4), 0) === T.OPEN, 'snow 4 layers -> OPEN (LAYERS < 5)');
  ok(at(snowN(5), 1) === T.BLOCKED, 'snow 5 layers -> BLOCKED');
  ok(at('stone', 2) === T.BLOCKED, 'stone (full cube) -> BLOCKED');
  Ai.__testLandStandIn = true;
  okAv(Ai.commonNodeType(-6, Y, 6) === T.BLOCKED, 'the old collision stand-in calls the carpet BLOCKED — the carpet assertion can fail');
  Ai.__testLandStandIn = false;
  // groundLevel: a fire floor cell costs a zombie 16 (a cost), refuses a cow (-1), and cactus refuses both
  fresh(8);
  W.setBlock(3, Y, 0, stateOf('fire'));
  W.setBlock(-3, PLAT_Y, 0, stateOf('sand'));
  W.setBlock(-3, Y, 0, stateOf('cactus'));
  ok(W.getBlock(-3, Y, 0) === stateOf('cactus'), 'the cactus stands (on sand)');
  const zb = mob('zombie', 0, 0), cw = mob('cow', 0, 0);
  ok(Ai.groundLevel(3, Y, 0, 0, zb) === Y, 'a fire cell is a legal floor for a zombie (DAMAGE_FIRE 16, not < 0)');
  ok(Ai.groundLevel(3, Y, 0, 0, cw) === null, 'but not for a cow (AnimalEntity DAMAGE_FIRE -1)');
  ok(Ai.groundLevel(-3, Y, 0, 0, zb) === null, 'a cactus cell refuses a zombie too (DAMAGE_CACTUS -1)');
  ok(Ai.groundLevel(3, Y, 0, 0) === null, 'a mob-less caller keeps the everyone-refuses answer');
  const tweaked = Object.assign({}, zb, { pathMalus: { [T.DAMAGE_FIRE]: -1 } });
  okAv(Ai.groundLevel(3, Y, 0, 0, tweaked) === null, 'a zombie whose own DAMAGE_FIRE penalty is -1 IS refused — the per-mob rule is really read');
}

// ── creeper getSafeFallDistance: 3 with no target, 3 + (int)(health-1) with one ──
{
  console.log(' creeper safe fall distance');
  fresh(8);
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) W.setBlock(x, PLAT_Y + 10, z, STONE); // ledge 10 up
  const drop = (m) => { const p = Ai.findPath(0.5, PLAT_Y + 11, 0.5, 0.5, Y, 0.5, { maxDrop: 1, mob: m }); return !!p; };
  const cr = (t, h) => Object.assign(mob('creeper', 0, 0), { y: PLAT_Y + 11, target: t, health: h });
  ok(!drop(cr(null, 20)), 'no target: a 10-block drop is refused (max 3)');
  ok(drop(cr({}, 20)), 'targeting at full health: a 10-block drop is pathed (max 22)');
  ok(!drop(cr({}, 5)), 'targeting at health 5: max 7, 10-block drop refused');
  okAv(!drop(Object.assign(mob('zombie', 0, 0), { y: PLAT_Y + 11, target: {}, health: 20 })), 'a zombie with a target still stops at 1 — the creeper rule is type-gated');
}

console.log('');
console.log('================ pathcheck ==================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` ${breaks} breaks caught`);
console.log('==============================================');
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
