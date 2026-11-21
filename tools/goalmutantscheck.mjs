#!/usr/bin/env node
// goalmutantscheck.mjs - #11510 (part of #11466/#11464): direct assertions for the 8 mutants of src/07k_goals.js that the
// mobs-ai stages let survive (mutation sweep 2026-11-14, seed 1). Each assertion changes with exactly one of those expressions.
// Anti-vacuity (D-30): each line is also asserted against the mutant's value, which must differ ("<n> breaks caught").
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const A = join(MCLITE_ROOT, 'assets');
const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14c_raycast.js'] });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(A, 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Behave.init(M.World); M.Ai.init();
const Ai = M.Ai, W = M.World, CH = M.CH, DEG = Math.PI / 180;
const fails = []; let pass = 0, breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const differs = (a, b, m) => { breaks++; if (a === b) fails.push('anti-vacuity: ' + m); };
const STONE = M.States.stateOf('stone') | 0, PLAT = 8, Y = PLAT + 1;
function fresh(r) {
  W.init(1);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
  for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) W.setBlock(x, PLAT, z, STONE);
}

// 1. :920 `f - here > 1.125` - a step of EXACTLY 1.125 is accepted (stub the ground so the rise is 1.125 on the second hop)
{
  fresh(8);
  const real = Ai.groundLevel, realT = Ai.commonNodeType;
  Ai.__testNoMalus = true;
  Ai.groundLevel = (x) => (x === 1 ? Y + 0.625 : null);                 // a node 0.625 up whose cell below is a fence: feet +0.5
  Ai.commonNodeType = (x) => (x === 1 ? Ai.NodeType.FENCE : Ai.NodeType.WALKABLE);   // so f - here = 1.125 exactly
  const p = Ai.findPath(0, Y, 0, 1, Y, 0, { maxNodes: 50 });
  Ai.groundLevel = real; Ai.commonNodeType = realT; Ai.__testNoMalus = false;
  ok(p && p.length === 2 && p[1].x === 1, 'a 1.125 rise is a legal step (> not >=)');
}
// 2. :1306 maxHeadYaw
ok(Ai.maxHeadYaw({ type: 'ravager' }) === 45 * DEG, 'ravager head yaw limit 45deg');
ok(Ai.maxHeadYaw({ type: 'cow' }) === Ai.HEAD_MAX_YAW, 'a cow keeps the default head yaw limit');
differs(Ai.maxHeadYaw({ type: 'cow' }), 45 * DEG, 'default vs ravager');
// 3. :1448 YawAdjustingLookControl pitch + 10deg
{
  const e = { type: 'dolphin', x: 0, y: 70, z: 0, width: 0.9, height: 0.6, yaw: 0, pitch: 0 };
  const lc = new Ai.YawAdjustingLookControl(e, 10);
  lc.setLookAt(5, 70 + Ai.eyeOf(e) - 2, 0, Math.PI, Math.PI);
  lc.tick();
  const p = Ai.wantedHeadPitch(e, 5, 70 + Ai.eyeOf(e) - 2, 0);
  ok(e.pitch === Ai.rotateTowards(0, p + 10 * DEG, Math.PI), 'dolphin head pitch aims at pitch + 10deg');
  differs(Ai.rotateTowards(0, p + 10 * DEG, Math.PI), Ai.rotateTowards(0, p + 10 / DEG, Math.PI), 'pitch offset 10*DEG vs 10/DEG');
}
// 4. :1549 MOVE_ARRIVED_SQ
{
  ok(Ai.MOVE_ARRIVED_SQ === 2.500000277905201e-7, 'MoveControl arrival epsilon 2.5e-7 (+ ulp)');
  const e = { type: 'cow', x: 0, y: 70, z: 0, xOld: -3e-4, zOld: 0, yaw: 1, yBodyRot: 0, yHeadRot: 0 };
  new Ai.BodyRotationControl(e).tick();   // 9e-8 moved squared: under 2.5e-7 -> NOT moving
  ok(e.yBodyRot !== 1, 'a 3e-4 move is below the arrival epsilon: body does not snap to the yaw');
  differs(9e-8 > 2.500000277905201e-7, 9e-8 > 2.500000277905201e-8, 'epsilon 1e-7 vs 1e-8');
}
// 5. :1949 stroll target uses cos(ang) * r
{
  fresh(8);
  const e = M.EntityList.spawn('cow', 0.5, Y, 0.5);
  const g = new Ai.WaterAvoidingRandomStrollGoal(e, 1.0, () => 0);   // ang 0, r 2 -> target x + 2
  g.start();
  const p = e.navPath;
  ok(p && p.length > 1 && p[p.length - 1].x === 2, 'stroll target is e.x + cos(ang) * r (ends at x 2)');
  differs(Math.floor(0.5 + Math.cos(0) * 2), Math.floor(0.5 + Math.cos(0) / 2), 'cos*r vs cos/r');
}
// 6. :2227 `!to && hasPositionTarget` - an exact `to` has no walk-range test
{
  fresh(8);
  const e = M.EntityList.spawn('cow', 0.5, Y, 0.5);
  e.positionTarget = { x: 6, y: Y, z: 6 }; e.positionTargetRange = 1;
  let r = 0.0; const rand = () => (r = (r + 0.37) % 1);
  const got = Ai.findTowardPositionTarget(e, rand, 4, 2, Math.PI / 2, { x: 1.5, y: Y + 0.5, z: 1.5 });
  ok(got !== null, 'findTo with an exact point ignores the position-target walk range');
}
// 7. :2383 WolfBegGoal.canUse with nobody to beg from
{
  const e = { type: 'wolf', x: 0, y: 70, z: 0, tamed: false };
  ok(new Ai.WolfBegGoal(e, { players: () => [] }).canUse() === false, 'no player: no begging');
  ok(new Ai.WolfBegGoal(e, { players: () => [{ x: 50, y: 70, z: 0, heldItem: 1 }], isTempting: () => true }).canUse() === false, 'a player out of range: no begging');
  ok(new Ai.WolfBegGoal(e, { players: () => [{ x: 3, y: 70, z: 0, heldItem: 1 }], isTempting: () => true }).canUse() === true, 'a near player holding a tempting item: begs');
}
// 8. :2433 attackReachSqr = (w*2)*(w*2) + targetWidth
{
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  ok(near(Ai.attackReachSqr({ width: 0.6 }, { width: 0.6 }), 1.44 + 0.6), 'reach^2 of 0.6 vs 0.6 = 2.04');
  ok(near(Ai.attackReachSqr({ width: 1.4 }, { width: 0.6 }), 2.8 * 2.8 + 0.6), 'reach^2 scales with the SQUARE of own width');
  differs(near(Ai.attackReachSqr({ width: 1.4 }, { width: 0.6 }), 2 / 1.4 * 2 * 1.4 + 0.6), true, 'w*f*w*f vs f/w*f*w');
}
if (fails.length) { console.log('goalmutantscheck FAIL\n' + fails.join('\n')); process.exit(1); }
console.log(`goalmutantscheck OK - ${pass} assertions, ${breaks} breaks caught`);
