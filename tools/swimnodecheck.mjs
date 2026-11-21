#!/usr/bin/env node
// swimnodecheck.mjs -- Ai.findSwimPath uses WaterPathNodeMaker's node classification (#6430):
// the whole mob box must be water (else BLOCKED), air in the box = BREACH (only with opts.breach).
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
console.log('swimnodecheck — findSwimPath node types (box-wide water test, breach)');
const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js',
  '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14c_raycast.js'] });
const W = M.World, CH = M.CH, Ai = M.Ai;
M.Reg && 0;
const st = (n) => M.States.stateOf(n) | 0;
const STONE = st('stone'), WATER = st('water');
W.init(1);
for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
const Y = 20;
function pond(slitOnly) {
  for (let x = -3; x <= 8; x++) for (let y = Y - 1; y <= Y + 4; y++) for (let z = -3; z <= 3; z++) W.setBlock(x, y, z, STONE);
  for (let x = 0; x < 6; x++) for (let y = Y; y <= Y + 2; y++) for (let z = 0; z < 3; z++) {
    if (slitOnly && x === 2 && !(y === Y && z === 1)) continue;   // wall at x=2 with a 1x1 water slit
    W.setBlock(x, y, z, WATER);
  }
  if (slitOnly) for (let y = Y; y <= Y + 2; y++) for (let z = 0; z < 3; z++) W.setBlock(2, y, z, STONE);
  if (slitOnly) W.setBlock(2, Y, 1, WATER);
}
const reach = (p) => !!p && p.length && p[p.length - 1].x === 4;
// 1. slit: 1x1 mob passes, a 2-cell-high box (height 1.5) is refused
pond(true);
const small = Ai.findSwimPath(0.5, Y + 0.5, 1.5, 4.5, Y + 0.5, 1.5, { maxNodes: 400 });
const big = Ai.findSwimPath(0.5, Y + 0.5, 1.5, 4.5, Y + 0.5, 1.5, { maxNodes: 400, box: { w: 0.9, h: 1.5 } });
ok(reach(small), 'cell-centre/1x1 mob swims through the slit');
ok(!reach(big), 'box 0.9x1.5 mob refuses the 1-high slit');
// 2. breach: air layer above a 1-deep pond
pond(false);
for (let x = 0; x < 6; x++) for (let z = 0; z < 3; z++) { W.setBlock(x, Y + 1, z, 0); W.setBlock(x, Y + 2, z, 0); }
const noB = Ai.findSwimPath(0.5, Y + 0.5, 1.5, 4.5, Y + 0.5, 1.5, { box: { w: 0.9, h: 1.5 } });
const yesB = Ai.findSwimPath(0.5, Y + 0.5, 1.5, 4.5, Y + 0.5, 1.5, { box: { w: 0.9, h: 1.5 }, breach: true });
ok(!reach(noB), 'air above the box blocks a non-breaching swimmer');
ok(reach(yesB), 'breach swimmer accepts air-above nodes');
const P0 = Ai.swimNodePenalty(1, Y + 1, 1, 1, 1, 1, true);
ok(P0 === 8, 'breach node in an air cell costs +8 (got ' + P0 + ')');
console.log('\npassed: ' + pass + '\nfailed: ' + fails.length);
if (fails.length) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
// anti-vacuity: break the classifier to the old cell-centre test and the box assertion must fail
Ai.swimNodePenalty = (x, y, z, bx, by, bz, br) => M.States.waterIn[M.Physics.blockAt(x, y, z)] ? 0 : -1;
pond(true);
const old = Ai.findSwimPath(0.5, Y + 0.5, 1.5, 4.5, Y + 0.5, 1.5, { box: { w: 0.9, h: 1.5 } });
let breaks = 0;
if (reach(old)) breaks++;   // cell-centre test lets the tall mob through: caught
console.log('  ✓ ' + breaks + ' breaks caught (cell-centre revert lets the tall mob through)');
if (breaks < 1) process.exit(1);
