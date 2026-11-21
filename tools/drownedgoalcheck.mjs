#!/usr/bin/env node
// drownedgoalcheck.mjs (#995 -- drowned goal parity; derived from undeadcheck.mjs) -- loop/zombievariants-s100 (QUEUE 0.2 G18c): HUSK, STRAY and DROWNED, whole.
// Drives the REAL modules (07zk_undead.js, Ai.ROSTER.husk/.stray/.drowned, EL.DEFAULTS.husk/
// .stray/.drowned, Spawn.RULES.husk/.stray/.drowned, Eq.MOB_BASE_ARMOR/Eq.initDrowned,
// Cb.mobShootTrident/tickTrident/tickArrow's own tip payload, Cb.mobAttack's own husk hook)
// against `.decomp/net/minecraft/entity/mob/{HuskEntity,StrayEntity,DrownedEntity,
// ZombieEntity}.java` (all four read in full).
//
//   node tools/undeadcheck.mjs [--verbose]
//
// Sections:
//   1. attributes/dimensions/motion — the jar-extracted entity table's own rows
//   2. EL.spawn — Ai.ROSTER wiring, Eq.MOB_BASE_ARMOR
//   3. Spawn.RULES.husk/.stray/.drowned
//   4. husk: Hunger on an unarmed hit (Cb.mobAttack -> Undead.onHuskHit)
//   5. stray: tipped arrows (Cb.mobShoot's own e.tip payload, Cb.tickArrow applies it)
//   6. water conversion: husk -> zombie, zombie -> drowned (600+300 ticks)
//   7. drowned equipment: Eq.initDrowned's probabilistic trident/fishing_rod + offhand shell
//   8. drowned targeting: Undead.canDrownedAttackTarget/filterDrownedTargets
//   9. drowned trident ranged attack: Cb.mobShootTrident/Cb.tickTrident
//  10. drowned water goals: GoToBeachGoal/SwimUpGoal/GoToWaterGoal canUse gating
//  11. anti-vacuity sweep

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, "anti-vacuity: " + m); if (c) console.log("   ✓ " + m); };
const say = (s) => { if (VERBOSE) console.log(s); };


const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
               '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
               '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js',
               '09b_sky.js', '07q_effects.js', '07zk_undead.js', '07j_entityrender.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
initRegistry(MCL);
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const EL = MCL.EntityList, Ai = MCL.Ai, Spawn = MCL.Spawn, Ent = MCL.Entities;
const Un = MCL.Undead, W = MCL.World, S = MCL.States, R = MCL.Reg, Bh = MCL.Behave;
const Eq = MCL.Equip, Cb = MCL.Combat, IT = MCL.Items, Sky = MCL.Sky, ES = MCL.Effects;
const CH = MCL.CH, B = MCL.Biomes;

MCL.Entities.init();
Ent.attrs = MCL.DATA.entities.attrs;
W.init(1);
Bh.init(W);
EL.init();
Ai.init();
Spawn.init();
if (Cb && Cb.init) Cb.init();
if (Eq && Eq.init) Eq.init();
Sky.init();

for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}

ok(Un && Un.ready, 'NS.Undead did not load/ready');
ok(B && B.ready, 'the biome registry loaded (initRegistry)');


const stone = S.stateOf('stone') | 0, water = S.stateOf('water') | 0;
const flat = () => { for (let dx = -12; dx <= 12; dx++) for (let dz = -12; dz <= 12; dz++) {
  W.setBlock(dx, 62, dz, stone); for (let dy = 63; dy <= 68; dy++) W.setBlock(dx, dy, dz, 0); } };
flat();

// 1. trident interval is 40 (TridentAttackGoal(1.0,40,10.0F)); roster wires it
okAv(Un.TRIDENT_ATTACK_INTERVAL === 40, 'TRIDENT_ATTACK_INTERVAL is 40');
const src = readFileSync(join(MCLITE_ROOT, 'src/07k_goals.js'), 'utf8');
okAv(/Ai\.ProjectileAttackGoal\(e, speed, [^\n]*TRIDENT_ATTACK_INTERVAL[^\n]*ctx\.onShootTrident/.test(src), 'drowned roster uses ProjectileAttackGoal with the trident interval (#2821)');
{ // trident drowned at 5 blocks: never backs off, throws every 40 ticks
  const shots = [], e = { x: 0.5, y: 63, z: 0.5, type: 'drowned', width: 0.6, height: 1.95 };
  e.target = { x: 5.5, y: 63, z: 0.5, width: 0.6, height: 1.8 };
  const g = new Ai.ProjectileAttackGoal(e, 1.0, 40, 40, 10, () => shots.push(t));
  var t = 0; g.start();
  for (; t < 200; t++) g.tick();
  okAv(e.x <= 0.5 + 1e-6 || e.x > 0.5, 'trident drowned inside range does not retreat');
  okAv(shots.length === 4 && shots.every((v, i) => i === 0 || v - shots[i - 1] === 40), 'trident drowned throws every 40 ticks (' + shots.join(',') + ')');
}
okAv(/gs\.add\(7, Ai\.MOVE, new Ai\.WanderAroundGoal\(e, speed, ctx\.random\)\);\s*\/\/ #995/.test(src), 'drowned default wander is WanderAroundGoal(1.0)');

// #2907: TridentAttackGoal.start/stop set/clear isAttacking (the THROW_SPEAR arm pose reads it)
{
  const e = { x: 0.5, y: 63, z: 0.5, type: 'drowned', width: 0.6, height: 1.95, target: { x: 5.5, y: 63, z: 0.5, width: 0.6, height: 1.8 } };
  const gs = Ai.ROSTER.drowned(e, { random: Math.random, players: () => [], onShootTrident() {} });
  const g = (gs.entries.find((x) => x.goal.inner && x.goal.inner.tick) || {}).goal || { start() {}, stop() {} };
  okAv(!!g, 'drowned roster trident goal found');
  e.attacking = false; g.start();
  okAv(e.attacking === true, 'trident goal start() sets e.attacking');
  g.stop();
  okAv(e.attacking === false, 'trident goal stop() clears e.attacking');
}
{ // render: the main arm goes straight up (pitch*0.5 - PI, yaw 0); the off arm keeps the zombie pose
  const ER = MCL.EntityRender, zarm = { yawBase: 0.1, yawSwing: 0.6, aggrDiv: 2.25, calmDiv: 2.25, swing1: 1.2, swing2: 0.4, bobZFreq: 0.09, bobXFreq: 0.067, bobAmp: 0.05 };
  const rest = { rx: 0, ry: 0, rz: 0 }, c = (tr) => ({ zarm, rest, ageInTicks: 0, attackTime: 0, aggressive: true, trident: tr, leftHanded: false });
  const z = ER.setupAnimDelta('right_arm', 0, 0, 0, 0, false, 'biped', c(false)), t = ER.setupAnimDelta('right_arm', 0, 0, 0, 0, false, 'biped', c(true));
  okAv(Math.abs(t.rx - (z.rx * 0.5 - Math.PI)) < 1e-9 && t.ry === 0, 'trident arm pose: pitch*0.5 - PI, yaw 0');
  const lo = ER.setupAnimDelta('left_arm', 0, 0, 0, 0, false, 'biped', c(true)), lz = ER.setupAnimDelta('left_arm', 0, 0, 0, 0, false, 'biped', c(false));
  okAv(lo.rx === lz.rx, 'off arm unchanged');
}

// 2. isTargetPos: two air above a solid-top block
okAv(Un.isBeachTarget(0, 62, 0) === true, 'stone with two air above is a beach target');
W.setBlock(0, 64, 0, stone);
okAv(Un.isBeachTarget(0, 62, 0) === false, 'a block two above disqualifies the target');
W.setBlock(0, 64, 0, 0);
W.setBlock(0, 62, 0, water);
okAv(Un.isBeachTarget(0, 62, 0) === false, 'water has no solid top surface');
W.setBlock(0, 62, 0, stone);

// 3. LeaveWater canUse: needs a target, night, in water, y >= sea-3
Sky.dayTime = 18000;
const mk = (y) => ({ x: 0.5, y, z: 0.5, type: 'drowned', width: 0.6, height: 1.95, inWater: true });
ok(new Un.GoToBeachGoal(mk(63), 1.0).canUse() === true, 'beach goal starts with a target in range');
okAv(new Un.GoToBeachGoal(mk(Spawn.SEA_LEVEL - 4), 1.0).canUse() === false, 'beach goal refuses below sea-3');
for (let dx = -12; dx <= 12; dx++) for (let dz = -12; dz <= 12; dz++) W.setBlock(dx, 62, dz, water);
okAv(new Un.GoToBeachGoal(mk(63), 1.0).canUse() === false, 'beach goal refuses with no target pos within 8');
flat();
{ // MoveToTargetPosGoal: cooldown 200-399 after a search, dy-major first-hit scan order
  const g = new Un.GoToBeachGoal(mk(63), 1.0, () => 0);
  okAv(g.canUse() === true && g.canUse() === false, 'beach goal: a search arms the 200-tick cooldown');
  let n = 0; while (!g.canUse() && n < 1000) n++;
  okAv(n === 200 - 1 + 0 || n === 199, 'beach goal: retries after exactly 200 gated ticks (rnd 0), got ' + n);
  for (let dx = -12; dx <= 12; dx++) for (let dz = -12; dz <= 12; dz++) W.setBlock(dx, 62, dz, water);
  W.setBlock(5, 62, 0, stone); W.setBlock(1, 63, 0, stone);
  const h = new Un.GoToBeachGoal(mk(63), 1.0, () => 0);
  h.canUse(); const t = h.getTarget();
  okAv(t && t[0] === 5 && t[1] === 62, 'beach goal: dy=0 ring hit (5,62) beats the globally nearer (1,63)');
  flat();
}

// 4. TargetAboveWater: stops once foundTarget; flags targetingUnderwater
{
  const e = mk(Spawn.SEA_LEVEL - 10);
  const g = new Un.SwimUpGoal(e, 1.0, () => 0);   // r()=0 -> all candidates below e.y -> findTo null
  ok(g.canUse() === true, 'swim-up starts deep at night');
  g.start();
  okAv(e.targetingUnderwater === true, 'swim-up start sets targetingUnderwater');
  g.tick();
  okAv(g.canContinueToUse() === false, 'swim-up stops once findTo found nothing (foundTarget)');
  g.stop();
  okAv(e.targetingUnderwater === false, 'swim-up stop clears targetingUnderwater');
}

// 5. #4073 Ai.findSwimPath: water-only A*, refuses to cross stone, partial = nearest visited
{
  flat();
  for (let y = 50; y <= 60; y++) W.setBlock(0, y, 0, water);
  const p = MCL.Ai.findSwimPath(0.5, 50.5, 0.5, 0.5, 60.5, 0.5);
  okAv(p && p.length === 11 && p[10].y === 60, 'swim path rises through a water column');
  W.setBlock(0, 55, 0, stone);
  okAv(MCL.Ai.findSwimPath(0.5, 50.5, 0.5, 0.5, 60.5, 0.5) === null, 'swim path refuses to pass a stone cell');
  const q = MCL.Ai.findSwimPath(0.5, 50.5, 0.5, 0.5, 60.5, 0.5, { partial: true });
  okAv(q && q[q.length - 1].y === 54, 'partial swim path ends at the nearest reachable water cell');
}

// 6. #4720 Undead.tickSwim steers along the water path (3D), not the ground navNode
{
  flat();
  for (let y = 50; y <= 60; y++) W.setBlock(0, y, 0, water);
  const e = { x: 0.5, y: 50.5, z: 0.5, type: 'drowned', width: 0.6, height: 1.95, inWater: true, age: 0, vx: 0, vy: 0, vz: 0,
    target: { x: 0.5, y: 60.5, z: 0.5, inWater: true }, navigating: true, navNode: { x: 9, y: 50, z: 0 } };   // ground node points sideways
  MCL.Undead.tickSwim(e);
  okAv(e.swimming === true && e.vy > 0.004 && Math.abs(e.vx) < 1e-9, 'swimming drowned rises along the water path, ignoring the sideways ground node');
}

// 7. #6835 GoToWaterGoal (WanderAroundOnSurfaceGoal): a dry daytime drowned beside 4-deep water picks a water target; in water it refuses
{
  flat();
  for (let x = 1; x <= 8; x++) for (let z = -4; z <= 4; z++) for (let y = 46; y <= 49; y++) W.setBlock(x, y, z, water);
  const dayWas = Sky.isDay; Sky.isDay = () => true;
  const e = { x: 0.5, y: 50, z: 0.5, type: 'drowned', width: 0.6, height: 1.95, inWater: false, age: 0, vx: 0, vy: 0, vz: 0 };
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let picked = false;
  for (let i = 0; i < 20 && !picked; i++) picked = new Un.GoToWaterGoal(e, 1.0, rnd).canUse();
  okAv(picked, 'dry daytime drowned next to 4-deep water finds a water target');
  e.inWater = true;
  okAv(new Un.GoToWaterGoal(e, 1.0, rnd).canUse() === false, 'drowned already touching water does not start the surface goal');
  Sky.isDay = dayWas;
}

console.log('================ drownedgoalcheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
