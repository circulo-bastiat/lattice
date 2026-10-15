#!/usr/bin/env node
// dolphinnavcheck.mjs — #4672: the dolphin's goals path through water nodes (SwimNavigation), not the walking A*.
// (header of dolphinmovecheck follows) #717: DolphinEntity.travel (water: *0.9 drag, -0.005 sink w/o target) + AquaticMoveControl
// (body yaw follows the motion target, 10 deg/tick) against .decomp DolphinEntity/AquaticMoveControl.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const fails = []; let pass = 0, breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js',
  '07h_entities.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js',
  '14j_combat.js', '07q_effects.js', '07zjd_dolphin.js', '07zj_fish.js', '07zj2_dolphin.js', '07zz2_dolphin.js'] });
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init(); M.EntityList.init(); M.World.init(1); M.Behave.init(M.World); M.Ai.init();
if (M.Combat && M.Combat.init) M.Combat.init();
M.Dolphin.init();
const EL = M.EntityList, W = M.World, S = M.States;
for (let cx = -1; cx <= 2; cx++) for (let cz = -1; cz <= 2; cz++) {
  const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
const stone = S.stateOf('stone') | 0, water = S.stateOf('water') | 0;
for (let x = -9; x <= 9; x++) for (let z = -9; z <= 9; z++) for (let y = 0; y <= 14; y++)
  W.setBlock(x, y, z, (Math.abs(x) === 9 || Math.abs(z) === 9 || y === 0 || y === 14) ? stone : water);
M.Player = { x: 100, y: 100, z: 100, EYE: 1.62 };
EL.random = () => 0.5;
console.log('dolphinnavcheck — #4672: SwimAround paths via the 6-connected water A*');
EL.list.length = 0; const e = EL.spawn('dolphin', 0.5, 12.5, 0.5); e.inWater = true;
M.Fish.fuzzFind = () => ({ x: 4.5, y: 5.5, z: 3.5 });   // 7 blocks below, off-axis
const g = new M.Dolphin.SwimAroundGoal(e, 1, 1);
g.canUse(); g.start();
const p = e.dolPath && e.dolPath.p;
ok(p && p.length > 1, 'a path was planned');
const steps = (p) => p.slice(1).map((n, i) => Math.abs(n.x - p[i].x) + Math.abs(n.y - p[i].y) + Math.abs(n.z - p[i].z));
ok(p && steps(p).every((d) => d === 1), '6-connected: every step moves exactly one axis by one');
ok(p && p.every((n) => S.waterIn[W.getBlock(Math.floor(n.x), Math.floor(n.y), Math.floor(n.z))]), 'every node is a water cell');
const walk = M.Ai.findPath(e.x, e.y, e.z, 4.5, 5.5, 3.5, { maxDrop: 1, mob: e, partial: true });
const reach = (q) => q && q.length && Math.floor(q[q.length - 1].y) === 5;
ok(reach(p), 'the swim path descends to the goal depth (y=5)');
okAv(!reach(walk), 'the walking A* (old behaviour) stays at the surface and never reaches the goal depth');
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
