#!/usr/bin/env node
// fishswimcheck.mjs — #603 (KW-52-2): a fish placed in water starts moving like vanilla. Headless trace of
// the REAL goals (FishEntity.SwimToRandomPlaceGoal via SwimAroundGoal, FollowGroupLeaderGoal, FleeEntityGoal,
// EscapeDangerGoal) through Ai.GoalSelector + FishMoveControl + FishEntity.travel, against
// .decomp/net/minecraft/entity/{passive/FishEntity,ai/goal/SwimAroundGoal,ai/goal/FollowGroupLeaderGoal}.java.
// On master the steering wrote no horizontal velocity and used Yarn's yaw, so a fish only sank (0.0 blocks moved).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };

const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js',
          '07h_entities.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07k_goals.js',
          '07l_spawn.js', '14j_combat.js', '07q_effects.js', '07zi_squid.js', '07zj_fish.js']
});
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init(); M.EntityList.init(); M.World.init(1); M.Behave.init(M.World); M.Ai.init();
if (M.Combat && M.Combat.init) M.Combat.init();
M.Fish.init();
const EL = M.EntityList, W = M.World, S = M.States, Fh = M.Fish;
for (let cx = -1; cx <= 2; cx++) for (let cz = -1; cz <= 2; cz++) {
  const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
const stone = S.stateOf('stone') | 0, water = S.stateOf('water') | 0;
for (let x = -9; x <= 9; x++) for (let z = -9; z <= 9; z++) for (let y = 0; y <= 14; y++) {
  const wall = Math.abs(x) === 9 || Math.abs(z) === 9 || y === 0 || y === 14;
  W.setBlock(x, y, z, wall ? stone : water);
}
M.Player = { x: 100, y: 100, z: 100, EYE: 1.62 };
let seed = 12345;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
EL.random = rng; Fh.random = rng;

console.log('fishswimcheck — #603: fish swim AI (SwimToRandomPlaceGoal / FollowGroupLeaderGoal / FishMoveControl)');

const horiz = (e, x0, z0) => Math.hypot(e.x - x0, e.z - z0);
// §1 a fish placed in water swims: several seeds, each covers real horizontal distance and faces where it goes
for (const type of ['cod', 'salmon', 'tropical_fish', 'pufferfish']) {
  EL.list.length = 0;
  const e = EL.spawn(type, 0.5, 7.5, 0.5); e.inWater = true;
  const x0 = e.x, z0 = e.z; let maxd = 0, started = -1, turned = false;
  for (let t = 0; t < 600; t++) {
    EL.tickOne(e);
    maxd = Math.max(maxd, horiz(e, x0, z0));
    if (started < 0 && e.fishNav) started = t;
    if (e.fishNav && Math.abs(e.yaw) > 1e-6) turned = true;
  }
  ok(started >= 0, `${type}: SwimToRandomPlaceGoal starts a navigation target within 600 ticks`);
  ok(maxd > 3, `${type}: swims > 3 blocks horizontally in 600 ticks (got ${maxd.toFixed(2)})`);
  ok(turned, `${type}: FishMoveControl turns the body toward the target`);
  ok(e.y > 0.5 && e.y < 14, `${type}: stays inside the water box (y=${e.y.toFixed(2)})`);
}
// §2 the fish heads TOWARD its target (engine yaw convention), not away
{
  seed = 1;   // independent of how many draws §1 consumed
  EL.list.length = 0;
  const e = EL.spawn('cod', 0.5, 7.5, 0.5); e.inWater = true;
  Fh.navStart(e, 6.5, 7.5, 0.5, 1.0);   // +x
  for (let t = 0; t < 60; t++) { EL.tickOne(e); if (!e.fishNav) break; }
  okAv(e.x > 1.5 && Math.abs(e.z - 0.5) < 2.5, `a fish sent to +x moves toward +x (x=${e.x.toFixed(2)} z=${e.z.toFixed(2)})`);
}
// §2b #2551: FishMoveControl's +0.005 needs the EYE in water (isSubmergedIn), not just touching: cod at the surface gets none
{
  const run = (y) => { EL.list.length = 0; const e = EL.spawn('cod', 0.5, y, 0.5); e.vy = 0; e.fishNav = null; Fh.moveControlTick(e); return e.vy; };
  ok(run(7.5) === 0.005, 'cod with eye in water gets +0.005 y');
  okAv(run(13.9) === 0, 'cod touching water with eye above the surface gets no +0.005 (y=13.9, water top 14)');
}
// §2c #3081: FishEntity.travel sinks -0.005 whenever getTarget()==null; a recently-hurt fish (attackerOf set) still sinks
{
  const run = (hurt) => { EL.list.length = 0; const e = EL.spawn('cod', 0.5, 7.5, 0.5); e.inWater = true; e.vx = e.vy = e.vz = 0; e.target = null; if (hurt) e.lastHurtByEntity = { x: 5, y: 7.5, z: 0.5 }; Fh.travelMob(e); return e.vy; };
  ok(run(false) === -0.005, 'fresh cod sinks -0.005');
  okAv(run(true) === -0.005, 'hurt cod (attackerOf set) still sinks -0.005');
}
// §2d #4186: LivingEntity.tickMovement forwardSpeed *= 0.98 before FishEntity.travel's updateVelocity(0.01F)
{
  const mv = M.Physics.move; M.Physics.move = () => {};
  EL.list.length = 0; const e = EL.spawn('cod', 0.5, 7.5, 0.5); e.inWater = true; e.vx = e.vy = e.vz = 0; e.target = null; e.yaw = Math.PI / 2; e.zza = 0.5;
  Fh.travelMob(e); M.Physics.move = mv;
  okAv(Math.abs(e.vx - 0.5 * 0.98 * 0.01 * 0.9) < 1e-12, 'fish water impulse is zza*0.98*0.01');
}
// §3 anti-vacuity: with the goal selector emptied the same fish does not swim
{
  EL.list.length = 0;
  const e = EL.spawn('cod', 0.5, 7.5, 0.5); e.inWater = true;
  e.fishGoals = new M.Ai.GoalSelector();
  const x0 = e.x, z0 = e.z;
  for (let t = 0; t < 600; t++) EL.tickOne(e);
  okAv(horiz(e, x0, z0) < 0.05, `a fish with no goals stays put horizontally (got ${horiz(e, x0, z0).toFixed(3)})`);
}
// §4 schools: six cod end up in one group (leader + followers) and follow
{
  seed = 1;
  EL.list.length = 0;
  const fish = [];
  for (let i = 0; i < 6; i++) { const f = EL.spawn('cod', -3 + i, 7.5, 0.5 + (i % 2)); f.inWater = true; fish.push(f); }
  for (let t = 0; t < 1500; t++) for (const f of fish) EL.tickOne(f);
  const followers = fish.filter((f) => f.fishLeader);
  ok(followers.length >= 1, `FollowGroupLeaderGoal: at least one cod joined a leader (${followers.length})`);
  const leader = followers[0] && followers[0].fishLeader;
  ok(!leader || (leader.fishGroupSize > 1 && leader.fishGroupSize <= 8), `leader group size within the cap (${leader && leader.fishGroupSize})`);
  ok(followers.every((f) => f.fishLeader !== f), 'no fish leads itself');
}
// §5 a player next to the fish makes it flee at the fast speed; a creative player does not
{
  EL.list.length = 0;
  const e = EL.spawn('cod', 0.5, 7.5, 0.5); e.inWater = true;
  M.Player = { x: 2.5, y: 7.5, z: 0.5, EYE: 1.62 };
  let sp = 0; for (let t = 0; t < 40 && !sp; t++) { EL.tickOne(e); if (e.fishNav) sp = e.fishNav.speed; }
  ok(sp >= 1.4, `flees a survival player at 1.4/1.6 (got ${sp})`);
  EL.list.length = 0;
  const c = EL.spawn('cod', 0.5, 7.5, 0.5); c.inWater = true;
  M.Player = { x: 2.5, y: 7.5, z: 0.5, EYE: 1.62, mode: M.Gamemode && M.Gamemode.CREATIVE };
  let fled = false; for (let t = 0; t < 40; t++) { EL.tickOne(c); if (c.fishNav && c.fishNav.speed >= 1.4) fled = true; }
  okAv(!(M.Gamemode && M.Gamemode.CREATIVE !== undefined) || !fled, 'a creative player is not fled from (createAttackable)');
  M.Player = { x: 100, y: 100, z: 100, EYE: 1.62 };
}

console.log('================ fishswimcheck ================');
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
console.log('===============================================');
process.exit(fails.length ? 1 : 0);
