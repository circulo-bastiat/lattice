#!/usr/bin/env node
// dolphincheck.mjs — #716: DolphinEntity.initGoals is built (src/07zj2_dolphin.js + Ai.ROSTER.dolphin). Headless trace of the
// real goals through Ai.GoalSelector + Dolphin.travelMob against .decomp DolphinEntity/BreatheAirGoal/DolphinJumpGoal.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };

const MODS = []; for (const m of readFileSync(join(MCLITE_ROOT, 'build.mjs'), 'utf8').matchAll(/'(07[0-9a-z_]+\.js)'/g)) if (!MODS.includes(m[1])) MODS.push(m[1]);
const M = loadEngine({ extra: ['02g_items.js', '14f_inventory.js', '14b_physics.js', '14j_combat.js', '07_world.js'].concat(MODS.filter((f) => f !== '07_world.js')) });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Breed.init && M.Breed.init(); M.Mount.init(); M.World.init(1); M.Behave.init(M.World); M.Ai.init();
if (M.Combat && M.Combat.init) M.Combat.init();
M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8')).rawBytes }); M.Equip.init();
M.Dolphin.init();
const EL = M.EntityList, W = M.World, S = M.States, Dol = M.Dolphin;
for (let cx = -1; cx <= 2; cx++) for (let cz = -1; cz <= 2; cz++) {
  const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
const stone = S.stateOf('stone') | 0, water = S.stateOf('water') | 0;
// a pool: water y 1..10 inside stone walls, air above (y 11..14), open roof
for (let x = -12; x <= 12; x++) for (let z = -12; z <= 12; z++) for (let y = 0; y <= 14; y++) {
  const wall = Math.abs(x) === 12 || Math.abs(z) === 12 || y === 0;
  W.setBlock(x, y, z, wall ? stone : (y <= 10 ? water : 0));
}
M.Player = { x: 100, y: 100, z: 100, EYE: 1.62 };
let seed = 777;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
EL.random = rng;
const fresh = (y) => { EL.list.length = 0; const e = EL.spawn('dolphin', 0.5, y, 0.5); e.inWater = true; if (!e.look) e.look = new M.Ai.LookControl(e); return e; };

console.log('dolphincheck — #716: DolphinEntity.initGoals');
// §1 the roster: the jar's goal priorities, in order
{
  const e = fresh(5.5);
  ok(!!e.ai, 'a spawned dolphin has a goal selector');
  const pris = e.ai.entries.filter((x) => x.flags !== 8).map((x) => x.priority).sort((a, b) => a - b).join(',');
  ok(pris === '0,0,1,2,4,4,5,5,6,8,8,9', `goalSelector priorities 0,0,1,2,4,4,5,5,6,8,8,9 (got ${pris})`);
  const tg = e.ai.entries.filter((x) => x.flags === 8).map((x) => x.priority).join(',');
  ok(tg === '1', `targetSelector RevengeGoal at 1 (got ${tg})`);
  const names = ['BreatheAirGoal', 'MoveIntoWaterGoal', 'LeadToNearbyTreasureGoal', 'SwimWithPlayerGoal', 'DolphinJumpGoal', 'PlayWithItemsGoal', 'ChaseBoatGoal'];
  for (const n of names) ok(e.ai.entries.some((x) => x.goal instanceof Dol[n]), `roster holds Dolphin.${n}`);
  for (const n of ['BreatheAirGoal', 'LeadToNearbyTreasureGoal', 'DolphinJumpGoal']) ok(new Dol[n](e, 10).canStop() === false, `Dolphin.${n}.canStop() is false`);
  // GoalSelector: a prio-1 goal cannot preempt a running canStop()==false prio-5 goal sharing a flag; with canStop true it does
  for (const [stop, want] of [[false, false], [true, true]]) {
    const gs = new M.Ai.GoalSelector(); let hiRan = false, loStopped = false;
    const lo = { canUse: () => true, canContinueToUse: () => true, start() {}, stop() { loStopped = true; }, tick() {}, canStop: () => stop };
    const hi = { canUse: () => hiRan || lo.started, canContinueToUse: () => true, start() { hiRan = true; }, stop() {}, tick() {} };
    gs.add(5, M.Ai.MOVE, lo); gs.tick(); lo.started = true; gs.add(1, M.Ai.MOVE, hi); gs.tick();
    (stop ? okAv : ok)(hiRan === want && loStopped === want, `GoalSelector canStop=${stop}: higher-priority goal ${want ? 'preempts' : 'cannot preempt'}`);
  }
}
// §2 a dolphin placed in water swims around (SwimAroundGoal) and stays in the pool
{
  const e = fresh(5.5); let maxd = 0;
  for (let t = 0; t < 1500; t++) { EL.tickOne(e); maxd = Math.max(maxd, Math.hypot(e.x - 0.5, e.z - 0.5)); }
  ok(maxd > 3, `swims > 3 blocks away in 1500 ticks (got ${maxd.toFixed(2)})`);
  ok(e.y > 0.5 && e.y < 14, `stays in the pool column (y=${e.y.toFixed(2)})`);
}
// §3 BreatheAirGoal: low air sends it to the surface
{
  const e = fresh(3.5); e.air = 100;
  let top = e.y; for (let t = 0; t < 200; t++) { EL.tickOne(e); top = Math.max(top, e.y); }
  okAv(top > 8, `air < 140 -> swims up toward the surface (peak y ${top.toFixed(2)})`);
  const g = fresh(3.5); g.ai = new M.Ai.GoalSelector(); g.air = 100; let top2 = g.y;
  for (let t = 0; t < 200; t++) { EL.tickOne(g); top2 = Math.max(top2, g.y); }
  okAv(top2 < 6, `anti-vacuity: with no goals the same dolphin does not surface (peak y ${top2.toFixed(2)})`);
}
// §4 the air law: submerged air drains, surfacing refills to 4800
{
  const e = fresh(5.5); e.ai = new M.Ai.GoalSelector(); e.air = 4800;
  for (let t = 0; t < 10; t++) EL.tickOne(e);
  ok(e.air === 4790, `submerged: air drops 1/tick (got ${e.air})`);
  e.x = 0.5; e.y = 12.2; e.z = 0.5; e.inWater = false; EL.tickOne(e);
  ok(e.air === 4800, `in air: refilled to getNextAirOnLand=4800 (got ${e.air})`);
}
// §5 DolphinJumpGoal: water 0,1,4,5,6,7 ahead + two air cells above
{
  const e = fresh(10.5); e.yaw = -Math.PI / 2 * 0;   // engine yaw 0 faces -z; the pool has room for 7 cells (z 0..-7)
  const g = new Dol.DolphinJumpGoal(e, 1);
  ok(g.canUse(), 'jump ahead: canStart with a clear surface');
  const st = W.getBlock(0, 11, -4); W.setBlock(0, 11, -4, stone);
  okAv(!new Dol.DolphinJumpGoal(e, 1).canUse(), 'a block above the water 4 cells ahead refuses the jump');
  W.setBlock(0, 11, -4, st);
  g.start();
  ok(Math.abs(e.vy - 0.7) < 1e-9 && Math.abs(e.vz + 0.6) < 1e-9, `start(): velocity += (0.6*dir, 0.7) (vy ${e.vy}, vz ${e.vz})`);
}
// §6 SwimWithPlayerGoal: a swimming player within 10 gets Dolphin's Grace
{
  const e = fresh(5.5); const rec = [];
  const old = M.Effects.addStatusEffect; M.Effects.addStatusEffect = (t, n, d) => { rec.push(n + ':' + d); };
  M.Player = { x: 3.5, y: 5.5, z: 0.5, EYE: 1.62, swimming: true };
  const g = new Dol.SwimWithPlayerGoal(e, 4.0);
  ok(g.canUse(), 'a swimming player within 10 blocks starts the goal');
  g.start(); ok(rec[0] === 'dolphins_grace:100', `applies dolphins_grace for 100 ticks (${rec[0]})`);
  M.Player.swimming = false;
  okAv(!new Dol.SwimWithPlayerGoal(e, 4.0).canUse(), 'a non-swimming player does not');
  M.Effects.addStatusEffect = old; M.Player = { x: 100, y: 100, z: 100, EYE: 1.62 };
}
// §7 PlayWithItemsGoal: a floating item within 8 blocks starts it; nothing near does not
{
  const e = fresh(5.5); const g = new Dol.PlayWithItemsGoal(e);
  okAv(!g.canUse(), 'no item near: not started');
  const it = EL.dropStack(4.5, 5.5, 0.5, M.Items.of('stick'), 1); it.inWater = true; it.pickupDelay = 0;
  ok(g.canUse(), 'an item in water within 8 blocks starts it');
}
// §7b #1872: loot = main hand only (empty), drop chance 2.0, spit after play, delayed item not CAN_TAKE
{
  const e = fresh(5.5); const IT = M.Items, Eq = M.Equip; const g = new Dol.PlayWithItemsGoal(e);
  const helm = EL.dropStack(0.5, 5.5, 0.5, IT.of('iron_helmet'), 1); helm.pickupDelay = 0; helm.inWater = true;
  ok(!Eq.loot(e, helm, Math.random) && !Eq.getEquipped(e, IT.MAINHAND), '#4061: iron_helmet is not picked up (canEquip needs MAINHAND preferred slot)');
  const sw = EL.dropStack(0.5, 5.5, 0.5, IT.of('iron_sword'), 1); sw.pickupDelay = 0; sw.inWater = true;
  ok(Eq.loot(e, sw, Math.random) && Eq.getEquipped(e, IT.MAINHAND) && !Eq.getEquipped(e, IT.HEAD), 'iron_sword goes to the main hand');
  ok(Eq.dropChance(e, IT.MAINHAND) === 2.0, 'handDropChance[mainhand] = 2.0');
  const cod = EL.dropStack(0.5, 5.5, 0.5, IT.of('cod'), 1); cod.pickupDelay = 0;
  ok(!Eq.loot(e, cod, Math.random), 'a full hand takes nothing more');
  const n0 = EL.list.length; g.tick();
  ok(!Eq.getEquipped(e, IT.MAINHAND) && EL.list.length === n0 + 1, 'tick spits the held item out');
  const sp = EL.list[EL.list.length - 1]; sp.inWater = true;
  ok(sp.pickupDelay === 40, 'spat item has pickupDelay 40');
}
{
  const e = fresh(5.5); const it = EL.dropStack(4.5, 5.5, 0.5, M.Items.of('stick'), 1); it.inWater = true; it.pickupDelay = 40;
  okAv(!new Dol.PlayWithItemsGoal(e).canUse(), 'an item with pickup delay is not CAN_TAKE');
}
// #3756: start() plays entity.dolphin.play only when a floating item is near
{
  const e = fresh(5.5); const g = new Dol.PlayWithItemsGoal(e); const ev = []; const em = M.MobVoice.emit; M.MobVoice.emit = (en, v) => { if (en === e) ev.push(v); };
  M.Equip.setEquipped(e, M.Items.MAINHAND, { i: M.Items.of('stick'), n: 1 }); g.start();
  okAv(!ev.includes('entity.dolphin.play'), 'no play sound with no item in range');
  const it = EL.dropStack(e.x + 1, e.y, e.z, M.Items.of('stick'), 1); it.inWater = true; it.pickupDelay = 0; g.start();
  M.MobVoice.emit = em;
  ok(ev.includes('entity.dolphin.play'), 'play sound when an item is in range');
}
// §8 dry-out: out of water the moistness counts down and hurts at 0
{
  const e = fresh(5.5); e.ai = new M.Ai.GoalSelector(); Dol.init1(e); e.moistness = 2; e.x = 0.5; e.y = 12.4; e.z = 0.5; e.inWater = false; e.onGround = false;
  const hp = e.health; for (let t = 0; t < 3; t++) { e.inWater = false; Dol.tick(e); }
  ok(e.moistness < 0 || e.health < hp || e.dead, `moistness runs out (${e.moistness}) and DRYOUT hurts (hp ${hp} -> ${e.health})`);
}
// §9 #1789: priority-4 MOVE goal is SwimAroundGoal(1.0, 10): chance 10 + LookTargetUtil.find(10,7), not the 1-in-120 ground stroll
{
  const e = fresh(5.5);
  const sg = e.ai.entries.find((x) => x.priority === 4 && x.flags === M.Ai.MOVE).goal;
  ok(sg instanceof Dol.SwimAroundGoal && sg.chance === 10, `priority-4 move goal is Dolphin.SwimAroundGoal chance 10 (got ${sg.chance})`);
  const rate = (g) => { let n = 0; for (let t = 0; t < 2400; t++) { e.x = 0.5; e.y = 5.5; e.z = 0.5; e.dolPath = null; if (g.canUse()) n++; } return n; };
  const n10 = rate(sg);
  ok(n10 > 150 && n10 < 320, `idle in open water: ~1 wander start per 10 ticks (${n10}/2400)`);
  okAv(rate(new M.Ai.WanderAroundGoal(e, 1.0, rng)) < 60, 'anti-vacuity: the old default WanderAroundGoal (chance 120) is far rarer');
}

// §10 #1874: water tests are getFluidState(..).isIn(WATER); MoveIntoWaterGoal reaches the nav; airAt takes passable fluid-free cells
{
  const kelp = S.stateOf('kelp') | 0;
  const e = fresh(10.5); e.yaw = 0;
  for (const m of [0, 1, 4, 5, 6, 7]) W.setBlock(0, 10, -m, kelp);
  ok(new Dol.DolphinJumpGoal(e, 1).canUse(), 'kelp cells ahead count as water for the jump');
  const sl = S.stateOf('seagrass') | 0; W.setBlock(0, 10, -4, stone);
  okAv(!new Dol.DolphinJumpGoal(e, 1).canUse(), 'a solid cell in the row still refuses the jump');
  for (const m of [0, 1, 4, 5, 6, 7]) W.setBlock(0, 10, -m, water);
  ok(new Dol.DolphinJumpGoal(e, 1).canUse(), 'open air above the row allows the jump');
  W.setBlock(0, 11, -4, S.stateOf('cobweb') | 0);
  okAv(!new Dol.DolphinJumpGoal(e, 1).canUse(), 'a passable non-air block (cobweb) above the row refuses the jump (isAir)');
  W.setBlock(0, 11, -4, 0);
  W.setBlock(0, 11, -2, S.stateOf('torch') | 0);
  const d = fresh(12.0); d.x = 8.5; d.z = 8.5; d.onGround = true; d.dolPath = null;
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) W.setBlock(8 + x, 11, 8 + z, stone);
  W.setBlock(10, 11, 8, kelp);
  const g = new Dol.MoveIntoWaterGoal(d); g.start();
  okAv(!!d.dolMoveTo && !d.dolPath, 'MoveIntoWaterGoal.start finds the kelp cell, sets only the MoveControl target (no dolPath, as in the jar)');
}

// §11 #2411: entity.dolphin.attack only when the hit lands
{
  const e = fresh(5.5), t = EL.spawn('cow', 1.0, 5.5, 0.5); t.inWater = true; e.target = t;
  const mg = e.ai.entries.find((x) => x.goal instanceof M.Ai.MeleeAttackGoal).goal;
  const played = []; const emit = M.MobVoice.emit; M.MobVoice.emit = (en, ev) => { if (en === e) played.push(ev); };
  const swing = () => { played.length = 0; t.x = e.x + 0.5; t.y = e.y; t.z = e.z; mg.start(); mg.tick(); return played.filter((v) => v === 'entity.dolphin.attack').length; };
  t.invulnerableTime = 0; const hp0 = t.health, landed = swing(); 
  t.invulnerableTime = 1000; const blocked = swing();
  M.MobVoice.emit = emit;
  ok(landed === 1, `landed hit plays entity.dolphin.attack (${landed})`);
  okAv(blocked === 0, 'target refusing damage (i-frames): no entity.dolphin.attack');
}

// §12 #3760: LeadToNearbyTreasureGoal.tick picks a findTo waypoint toward the treasure + looks; SwimWithPlayerGoal.tick looks
{
  seed = 777;   // pin: earlier sections consume Math.random-seeded state, so the findTo roll was flaky (~25%)
  const e = fresh(5.5); e.hasFish = true; e.dolTreasure = { x: 8, y: 5, z: 8 };
  const g = new Dol.LeadToNearbyTreasureGoal(e); e.dolPath = null; e.look.wanted = null;
  g.tick();
  const w = e.look.wanted;
  ok(!!e.dolPath && !!w, 'treasure tick (nav idle): startMovingTo a waypoint and lookAt it');
  okAv(!!w && w.x !== 8.5 && w.x - 0.5 === Math.floor(w.x), 'waypoint is a findTo block-centre point, not the treasure centre itself');
  const before = e.look.wanted; e.look.wanted = null; e.dolPath = { p: [{ x: 0.5, y: 5.5, z: 0.5 }, { x: 0.5, y: 5.5, z: 40 }], i: 1, speed: 1.3 };
  g.tick(); okAv(e.look.wanted === null, 'nav busy with a far target: tick does nothing');
  const d = fresh(5.5), P = M.Player; P.swimming = true; P.x = 4; P.y = 5; P.z = 0.5;
  const sg = new Dol.SwimWithPlayerGoal(d, 4.0); sg.canUse(); sg.start(); d.look.wanted = null; sg.tick();
  okAv(!!d.look.wanted, 'SwimWithPlayerGoal.tick looks at the player');
  P.eyeHeight = 0.4; sg.tick(); okAv(Math.abs(d.look.wanted.y - (P.y + 0.4)) < 1e-9, 'look target y is the swimming pose eye (0.4), not y+1.62'); P.swimming = false; delete P.eyeHeight;
}

// #4566: the 4-block arrival test is a squared distance from the block centre INCLUDING Y (floor(y)+0.5-y), not xz only
{
  const e = fresh(5.5); e.hasFish = true; e.air = 4800; e.dolTreasure = { x: 8, y: 5, z: 8 };
  const g = new Dol.LeadToNearbyTreasureGoal(e); e.x = 8.5 - 3.99; e.y = 5.9; e.z = 8.5;   // xz^2 15.92 < 16, +dy^2 0.16 -> 16.08
  okAv(g.canContinueToUse() === true, 'xz 3.99 + dy 0.4 is outside 4 blocks: goal continues');
  e.y = 5.5; okAv(g.canContinueToUse() === false, 'same xz at the block centre height (dy 0): arrived');
  e.y = 5.9; g.stop(); okAv(e.hasFish === true, 'stop(): not near (Y counted) keeps the fish');
}

console.log('================ dolphincheck ================');
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
console.log('==============================================');
process.exit(fails.length ? 1 : 0);
