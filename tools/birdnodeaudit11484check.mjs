#!/usr/bin/env node
// birdnodeaudit11484check.mjs — #11484: BirdPathNodeMaker (getDefaultNodeType / getNodeType / getNode) through the real Ai.* path
// over a real World. Rows the sibling birdnodecheck lacks: cactus/berry/lava-below carry-up, water below stays OPEN,
// neighbour reads for OPEN cells, DOOR_OPEN refused when canEnterOpenDoors=false, closed door + canOpenDoors -> WALKABLE_DOOR,
// 2-high entity scans two cells. Anti-vacuity: each source break of 07k_goals.js must fail its row.
import fs from 'node:fs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js',
    '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14c_raycast.js'], ...(patch ? { patch } : {}) });
  M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8')) });
  M.Entities.init(); M.EntityList.init(); M.Behave.init(M.World); M.Ai.init();
  const Ai = M.Ai, W = M.World, CH = M.CH, T = Ai.NodeType, S = M.States, o = {};
  const st = (n) => S.stateOf(n) | 0;
  W.init(1);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
    const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
  }
  const Y = 30, bird = { type: 'parrot', width: 0.5, height: 0.9, id: 1 };
  const floor = (x, z, name, base) => { W.setBlock(x, Y - 2, z, st(base || 'stone')); W.setBlock(x, Y - 1, z, st(name)); };
  floor(0, 0, 'cactus', 'sand');            o.cactus = Ai.birdNodeType(bird, 0, Y, 0) === T.DAMAGE_CACTUS && Ai.birdNodePenalty(bird, 0, Y, 0) < 0;
  floor(4, 0, 'sweet_berry_bush', 'grass_block');  o.berry = Ai.birdNodeType(bird, 4, Y, 0) === T.DAMAGE_OTHER;
  floor(8, 0, 'lava');              o.lava = Ai.birdNodeType(bird, 8, Y, 0) === T.DAMAGE_FIRE;
  // water below: stays OPEN (not WALKABLE), penalty 0
  floor(12, 0, 'water');            o.water = Ai.birdNodeType(bird, 12, Y, 0) === T.OPEN && Ai.birdNodePenalty(bird, 12, Y, 0) === 0;
  // open air beside a cactus reads the neighbour: DANGER_CACTUS (penalty -1 for parrot? only type asserted)
  W.setBlock(16, Y - 1, 0, st('sand')); W.setBlock(16, Y, 0, st('cactus'));
  o.nbr = Ai.birdDefaultNodeType(17, Y + 5, 0) === T.OPEN && Ai.birdDefaultNodeType(17, Y, 0) === T.DANGER_CACTUS;
  // doors: closed wooden door with canOpenDoors -> WALKABLE_DOOR; open door refused when canEnterOpenDoors false
  W.setBlock(20, Y - 1, 0, st('stone')); W.setBlock(20, Y, 0, st('oak_door'));
  o.doorOpen = Ai.birdDefaultNodeType(20, Y, 0) === T.DOOR_WOOD_CLOSED
    && Ai.birdNodeType({ ...bird, canOpenDoors: true }, 20, Y, 0) === T.WALKABLE_DOOR
    && Ai.birdNodeType(bird, 20, Y, 0) === T.DOOR_WOOD_CLOSED;
  // fence anywhere in the entity box wins (2-high scan: fence below the upper cell)
  floor(24, 0, 'oak_fence');
  o.fence = Ai.birdNodeType({ ...bird, height: 1.8, pathMalus: { [T.FENCE]: 0, [T.OPEN]: 2 } }, 24, Y, 0) === T.FENCE;
  // far air: free, penalty 0, type OPEN
  W.setBlock(28, Y + 9, 0, st('water'));
  o.free = Ai.birdNodeType(bird, 28, Y + 5, 0) === T.OPEN && Ai.birdNodePenalty(bird, 28, Y + 8, 0) === 0
    && Ai.birdNodeType({ ...bird, height: 1.8, pathMalus: { [T.WATER]: 0, [T.OPEN]: 0 } }, 28, Y + 8, 0) === T.OPEN;
  // getNode penalty: WALKABLE is +1; per-entity malus overrides
  W.setBlock(30, Y - 1, 0, st('stone'));
  o.walk = Ai.birdNodePenalty(bird, 30, Y, 0) === 1;
  o.malus = Ai.birdNodePenalty({ ...bird, pathMalus: { [T.WALKABLE]: 5 } }, 30, Y, 0) === 6;
  return o;
}
const LBL = { cactus: 'cactus below -> DAMAGE_CACTUS refused', berry: 'berry bush below -> DAMAGE_OTHER', lava: 'lava below -> DAMAGE_FIRE',
  water: 'water below keeps OPEN', nbr: 'OPEN reads neighbour cactus -> DANGER_CACTUS', doorOpen: 'wooden door WALKABLE_DOOR iff canOpenDoors',
  fence: 'fence in box wins', free: 'free air OPEN 0', walk: 'WALKABLE +1', malus: 'per-entity malus applies' };
const A = trial(null);
for (const [k, m] of Object.entries(LBL)) ok(A[k], m);
const BR = [
  ['cactus', /else if \(b === T\.DAMAGE_CACTUS\) t = T\.DAMAGE_CACTUS;/, ''],
  ['berry', /else if \(b === T\.DAMAGE_OTHER\) t = T\.DAMAGE_OTHER;/, ''],
  ['lava', /if \(b === T\.DAMAGE_FIRE \|\| b === T\.LAVA\) t = T\.DAMAGE_FIRE;/, 'if (b === T.DAMAGE_FIRE) t = T.DAMAGE_FIRE;'],
  ['water', /b !== T\.WALKABLE && b !== T\.OPEN && b !== T\.WATER\) \? T\.WALKABLE/, 'b !== T.WALKABLE && b !== T.OPEN) ? T.WALKABLE'],
  ['nbr', /if \(t === T\.WALKABLE \|\| t === T\.OPEN\) t = fromNeighbors\(x, y, z, t\);\n    return t;\n  \};\n  \/\*\* `BirdPathNodeMaker\.getNodeType/, 'if (t === T.WALKABLE) t = fromNeighbors(x, y, z, t);\n    return t;\n  };\n  /** `BirdPathNodeMaker.getNodeType'],
  ['doorOpen', /if \(t === T\.DOOR_WOOD_CLOSED && canOpen && canEnter\) t = T\.WALKABLE_DOOR;\n      if \(t === T\.DOOR_OPEN && !canEnter\) t = T\.BLOCKED;\n      if \(i === 0 && j === 0 && k === 0\) origin = t;\n      if \(seen\.indexOf\(t\) < 0\) seen\.push\(t\);\n    \}\n    if \(seen\.indexOf\(T\.FENCE\)/, 'if (t === T.DOOR_WOOD_CLOSED) t = T.WALKABLE_DOOR;\n      if (i === 0 && j === 0 && k === 0) origin = t;\n      if (seen.indexOf(t) < 0) seen.push(t);\n    }\n    if (seen.indexOf(T.FENCE)'],
  ['fence', /if \(seen\.indexOf\(T\.FENCE\) >= 0\) return T\.FENCE;\n    var best = T\.BLOCKED;\n    for \(var n = 0; n < Ai\.ENUM_ORDER\.length; n\+\+\) \{\n      var tt = Ai\.ENUM_ORDER\[n\];\n      if \(seen\.indexOf\(tt\) < 0\) continue;\n      var pen = Ai\.pathPenalty\(e, tt\);\n      if \(pen < 0\) return tt;\n      if \(pen >= Ai\.pathPenalty\(e, best\)\) best = tt;\n    \}\n    return \(origin === T\.OPEN && Ai\.pathPenalty\(e, best\) === 0\) \? T\.OPEN/, 'var best = T.BLOCKED;\n    for (var n = 0; n < Ai.ENUM_ORDER.length; n++) {\n      var tt = Ai.ENUM_ORDER[n];\n      if (seen.indexOf(tt) < 0) continue;\n      var pen = Ai.pathPenalty(e, tt);\n      if (pen < 0) return tt;\n      if (pen >= Ai.pathPenalty(e, best)) best = tt;\n    }\n    return (origin === T.OPEN && Ai.pathPenalty(e, best) === 0) ? T.OPEN'],
  ['free', /return \(origin === T\.OPEN && Ai\.pathPenalty\(e, best\) === 0\) \? T\.OPEN : best;\n  \};\n  \/\*\* `BirdPathNodeMaker\.getNode`/, 'return best;\n  };\n  /** `BirdPathNodeMaker.getNode`'],
  ['walk', /return t === T\.WALKABLE \? p \+ 1 : p;/, 'return p;'],
];
const SRC = fs.readFileSync(new URL('../src/07k_goals.js', import.meta.url), 'utf8');
for (const [key, re, rep] of BR) {
  if (!re.test(SRC)) { fails.push('pattern not found: ' + key); continue; }
  breaks++; let hit = false;
  const B = trial((f, src) => { const n = f === '07k_goals.js' ? src.replace(re, rep) : src; if (n !== src) hit = true; return n; });
  ok(hit, 'break pattern matched: ' + key); ok(!B[key], 'break must be caught: ' + key);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `${pass} ok, ${breaks} breaks caught, 0 failed`);
process.exit(fails.length ? 1 : 0);
