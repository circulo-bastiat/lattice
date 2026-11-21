#!/usr/bin/env node
// birdnodecheck.mjs — #5125: BirdPathNodeMaker node types/penalties (parrot: cocoa/fire -1, doors) gate the air A*.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js',
  '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14c_raycast.js'] });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Behave.init(M.World); M.Ai.init();
const Ai = M.Ai, W = M.World, CH = M.CH, T = Ai.NodeType, S = M.States;
const st = (n) => S.stateOf(n) | 0;
function world() {
  W.init(1);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
    const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
  }
}
const parrot = { type: 'parrot', width: 0.5, height: 0.9, id: 1 };
function run() {
  world();
  const Y = 30;
  // floor under (0,Y,0) is stone: open air over stone is WALKABLE (penalty 0 +1)
  W.setBlock(0, Y - 1, 0, st('stone'));
  ok(Ai.birdNodeType(parrot, 0, Y, 0) === T.WALKABLE, 'air over stone is WALKABLE');
  ok(Ai.birdNodePenalty(parrot, 0, Y, 0) === 1, 'WALKABLE penalty +1');
  ok(Ai.birdNodePenalty(parrot, 10, Y + 5, 10) === 0, 'free air penalty 0');
  // fire below -> DAMAGE_FIRE -> refused
  W.setBlock(3, Y - 2, 0, st('stone')); W.setBlock(3, Y - 1, 0, st('fire'));
  ok(W.getBlock(3, Y - 1, 0) === st('fire'), 'fire stands');
  ok(Ai.birdNodePenalty(parrot, 3, Y, 0) < 0, 'air above fire refused (-1)');
  ok(Ai.birdNodePenalty(parrot, 3, Y + 5, 0) === 0, 'air far above fire fine');
  // cocoa beside -> neighbour; cocoa below -> COCOA refused
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) W.setBlock(6 + dx, Y - 1, dz, st('jungle_log'));
  for (let c = st('cocoa'); c < st('cocoa') + 12 && W.getBlock(6, Y - 1, 0) !== c; c++) if (S.block[c] === S.block[st('cocoa')]) W.setBlock(6, Y - 1, 0, c);
  ok(S.block[W.getBlock(6, Y - 1, 0)] === S.block[st('cocoa')], 'cocoa stands');
  ok(Ai.birdNodeType(parrot, 6, Y, 0) === T.COCOA && Ai.birdNodePenalty(parrot, 6, Y, 0) < 0, 'air above cocoa refused');
  // closed wooden door: parrot cannot open doors -> refused
  W.setBlock(9, Y - 1, 0, st('stone')); W.setBlock(9, Y, 0, st('oak_door'));
  ok(W.getBlock(9, Y, 0) === st('oak_door'), 'door stands');
  ok(Ai.birdNodePenalty(parrot, 9, Y, 0) < 0, 'closed wooden door refused (parrot cannot open doors)');
  // a fence below carries up
  W.setBlock(12, Y - 1, 0, st('oak_fence'));
  ok(Ai.birdNodeType(parrot, 12, Y, 0) === T.FENCE, 'air above fence is FENCE');
  // A*: a fire cell at the straight route is detoured / the route never enters refused cells
  W.setBlock(3, Y - 2, 1, st('stone')); W.setBlock(3, Y - 1, 1, st('fire'));
  const p = Ai.findSwimPath(0.5, Y + 0.5, 1.5, 6.5, Y + 0.5, 1.5, { air: true, mob: parrot, maxNodes: 600 });
  ok(!!p && p.every(n => !(n.x === 3 && n.y === Y && n.z === 1)), 'air A* avoids the cell above fire');
  ok(!!p && p.length > 6, 'air A* still reaches the goal');
}
run();
const baseline = fails.length; if (baseline) console.log(fails.join('\n'));
const total = pass;
let breaks = 0;
const orig = { pen: Ai.pathPenalty, def: Ai.birdDefaultNodeType, np: Ai.birdNodePenalty };
const broken = (f) => { fails.length = 0; f(); run(); const c = fails.length > 0; if (c) console.log(' ✓ break caught'); return c; };
if (broken(() => { Ai.pathPenalty = () => 0; })) breaks++;
Ai.pathPenalty = orig.pen;
if (broken(() => { Ai.birdDefaultNodeType = (x, y, z) => Ai.commonNodeType(x, y, z); })) breaks++;
Ai.birdDefaultNodeType = orig.def;
if (broken(() => { Ai.birdNodePenalty = () => 0; })) breaks++;
Ai.birdNodePenalty = orig.np;
console.log('================ birdnodecheck ==================');
console.log(' assertions passed .. ' + total);
console.log(' failures ........... ' + baseline);
console.log(' ' + breaks + ' breaks caught');
if (baseline || breaks < 3) process.exit(1);
