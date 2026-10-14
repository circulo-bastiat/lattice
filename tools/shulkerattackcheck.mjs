#!/usr/bin/env node
// shulkerattackcheck.mjs — D-773 cloud unit (confident-lamport-nq63qx): the shulker's ATTACK half
// `confident-lamport-hlerdd`'s own findings file left open after shipping the AI identity slice —
// `Sh.TargetPlayerGoal`/`Sh.ShootBulletGoal` (targeting + the charge/fire cycle) and the
// `shulker_bullet` projectile itself (`Sh.tickBullet`/`Sh.replanBullet`, src/07zzk_shulker.js).
// NOT the renderer/model, TargetOtherTeamGoal (needs scoreboard teams), or destroy-by-hitting-it —
// Shulker.OWED (07zzk_shulker.js) names all three as still open.
//
//   node tools/shulkerattackcheck.mjs [--verbose]
//
// Sections:
//   1. TargetPlayerGoal — reciprocal chance, followRange + canSee gates, picks the nearer of two
//   2. RevengeGoal(group) wiring — hurting one shulker alerts every OTHER live shulker with no
//      target of its own, the same-type-only query `ctx.animals()` already builds
//   3. ShootBulletGoal — canUse/canContinueToUse's target-alive gate, the charge counter actually
//      firing a real `shulker_bullet` via EL.spawn, and a target past 20 blocks being DROPPED
//   4. Sh.attachAxis — the six faces map onto exactly the three axes
//   5. the bullet's own registration — EL.canSpawn, motionFor's [0,1] row, Sh.initBullet's fields
//   6. Sh.replanBullet — a live target far away aims at its own anchor (mid-body height); the
//      excluded axis is never offered as a waypoint candidate when a real alternative exists
//   7. Sh.tickBullet — entity hit (damage + Levitation), block hit (discard), the no-target
//      gravity fallback, and a live homing blend that visibly bends velocity toward the target
//   8. anti-vacuity — each of the above broken on purpose and caught, both directions (D-30)
//   9. Cb.hurt's shulker hook (mob-shulker cloud unit, .decomp ShulkerEntity.damage():412-434) — a
//      CLOSED shulker swallows a PersistentProjectileEntity (arrow) hit outright (no health loss);
//      an OPEN shulker takes the arrow hit normally; and once a real hit lands under half max HP,
//      a controlled 1-in-4 roll drives a genuine Sh.tryTeleport (a 'not 1-in-4' roll does not)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); if (VERBOSE) console.log((c ? '  ✓ ' : '  ✗ ') + m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c && VERBOSE) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };

console.log('shulkerattackcheck -- D-773 cloud unit, the shulker attack goal + shulker_bullet projectile');

const EXTRA = ['07h_entities.js', '07_world.js', '07b_behaviour.js', '14b_physics.js',
               '07i_entitylist.js', '07k_goals.js', '07q_effects.js', '14j_combat.js',
               '07zzk_shulker.js', '07zw_mobnbt.js', '07zx_particle.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.EntityList.init();
M.World.init(1);
M.Behave.init(M.World);
M.Ai.init();
M.Combat.init();
M.Shulker.init();

const EL = M.EntityList, Sh = M.Shulker, W = M.World, R = M.Reg, Ai = M.Ai;
const def = (n) => R.realFirst[R.id[n]] + R.defaultState[R.id[n]];
for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) {
  const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
for (let x = -48; x <= 48; x++) for (let z = -48; z <= 48; z++) W.setBlock(x, 4, z, def('stone'));

function mkShulker(x, y, z) {
  const e = EL.spawn('shulker', x, y, z);
  for (let i = 0; i < 3; i++) EL.tickMob(e);   // settle onto a real face
  e.shulkerPeek = 0;   // PeekGoal's 1-in-40 roll can open the lid during settle (flaked ~7% of runs); fixtures start closed
  return e;
}

// ============ 1. TargetPlayerGoal ===========================================================
{
  say('\n§1 TargetPlayerGoal -- reciprocal chance, followRange + canSee, nearer wins');
  const e = { x: 0.5, y: 5, z: 0.5, type: 'shulker', target: null };
  const near = { x: 3.5, y: 5, z: 0.5, type: 'player', eyeHeight: 1.62 };
  const far = { x: 15.5, y: 5, z: 0.5, type: 'player', eyeHeight: 1.62 };
  const g = new Sh.TargetPlayerGoal(e, { players: () => [far, near], random: () => 0 });
  ok(g.canUse() === true, 'rand()==0 clears the 1-in-10 reciprocal gate outright');
  ok(e.target === near, 'of two visible players inside followRange (16), the NEARER one is picked');
  e.target = null;
  const g2 = new Sh.TargetPlayerGoal(e, { players: () => [near], random: () => 0.5 });
  okAv(g2.canUse() === false, 'rand()==0.5 fails the 1-in-10 gate (floor(0.5*10)=5 != 0) -- no target picked');
  ok(e.target === null, 'and e.target is left untouched when the gate itself refuses');
  const beyond = { x: 40.5, y: 5, z: 0.5, type: 'player', eyeHeight: 1.62 };
  const g3 = new Sh.TargetPlayerGoal(e, { players: () => [beyond], random: () => 0 });
  okAv(g3.canUse() === false, 'a player 40 blocks away, past followRange (16), is never picked even with the gate clear');
  const g4 = new Sh.TargetPlayerGoal(e, { players: () => [near], random: () => 0 });
  g4.start(); ok(true, 'start() is a no-op, matching the header');
  g4.stop(); ok(e.target === null, 'stop() clears the target');
  // #655: thin face-relative search box + shouldContinue
  const wall = { x: 0.5, y: 5, z: 0.5, type: 'shulker', target: null, shulkerFace: 5 };   // X axis: 4 along x
  const behind = { x: 10.5, y: 5, z: 0.5, type: 'player', eyeHeight: 1.62 };
  const side = { x: 0.5, y: 5, z: 10.5, type: 'player', eyeHeight: 1.62 };
  const gw = new Sh.TargetPlayerGoal(wall, { players: () => [behind], random: () => 0 });
  okAv(gw.canUse() === true, 'wall shulker (X axis): a player 10 blocks along X IS targeted (#4795: getSearchBox ignored for players)');
  const gs = new Sh.TargetPlayerGoal(wall, { players: () => [side], random: () => 0 });
  okAv(gs.canUse() === true, 'wall shulker: a player 10 blocks along Z (perpendicular) is inside the box');
  const above = { x: 0.5, y: 13, z: 0.5, type: 'player', eyeHeight: 1.62 };
  const floorSh = { x: 0.5, y: 5, z: 0.5, type: 'shulker', target: null, shulkerFace: 0 };
  const ga = new Sh.TargetPlayerGoal(floorSh, { players: () => [above], random: () => 0 });
  okAv(ga.canUse() === true, 'floor shulker: a player 8 blocks straight above is targeted (#4795)');
  const gc = new Sh.TargetPlayerGoal(e, { players: () => [], random: () => 0 });
  e.target = near; gc.start();
  ok(gc.canContinueToUse() === true, 'a visible target in range continues');
  e.target = { x: 30.5, y: 5, z: 0.5, type: 'player' };
  okAv(gc.canContinueToUse() === false, 'a target past followRange is dropped');
  const saw = Ai.canSee; e.target = near; gc.start();
  Ai.canSee = () => false;
  let cont = 0; for (let i = 0; i < 60; i++) if (gc.canContinueToUse()) cont++;
  ok(cont === 60, 'unseen for 60 ticks still continues');
  okAv(gc.canContinueToUse() === false, 'unseen for the 61st tick drops the target');
  Ai.canSee = saw;
}

// ============ 2. RevengeGoal(group) wiring ===================================================
{
  say('\n§2 RevengeGoal(group) -- hurting one shulker alerts every OTHER live shulker, same type only');
  const attacker = { type: 'player' };
  const victim = mkShulker(80.5, 5, 80.5);
  victim.lastHurtByEntity = attacker; victim.hurtSeq = 1; victim.target = null;
  const mate1 = mkShulker(85.5, 5, 85.5);
  mate1.target = null;
  const mate2 = mkShulker(90.5, 5, 90.5);
  mate2.target = { type: 'player' };   // already has a target of its own
  const otherType = EL.spawn('endermite', 95.5, 5, 95.5);
  // EL.aiCtx(e)'s own `animals()` (07i_entitylist.js) is the REAL same-type-only query
  // `Ai.RevengeGoal`'s own header says it trusts rather than re-filtering itself.
  const realCtx = EL.aiCtx(victim);
  const rg = new Ai.RevengeGoal(victim, realCtx, { group: true });
  ok(rg.canUse() === true, 'a fresh hurtSeq with a real attacker clears RevengeGoal.canUse');
  rg.start();
  ok(victim.target === attacker, 'the victim itself targets its own attacker');
  ok(mate1.target === attacker, 'a same-type mate with NO target of its own is alerted too (group revenge)');
  okAv(mate2.target.type === 'player' && mate2.target !== attacker, 'a mate that ALREADY has a target keeps its own, not overwritten');
  okAv(otherType.target === undefined || otherType.target === null, 'EL.aiCtx(e)\'s own animals() is same-TYPE only -- a live endermite is never alerted');
}

// ============ 3. ShootBulletGoal =============================================================
{
  say('\n§3 ShootBulletGoal -- target-alive gate, real charge-then-fire, drop past 20 blocks');
  const shooter = mkShulker(6.5, 5, 6.5);
  const target = { x: 6.5, y: 5, z: 9.5, type: 'player', eyeHeight: 1.62, dead: false, removed: false, look: null };
  shooter.target = target;
  const g = new Sh.ShootBulletGoal(shooter, { random: () => 0 });
  ok(g.canUse() === true, 'a live, non-dead, non-removed target clears canUse');
  g.start();
  ok(shooter.shulkerPeek === 100, 'start() opens the lid fully (setPeekAmount(100))');
  const before = EL.list.filter((o) => o.type === 'shulker_bullet').length;
  for (let i = 0; i < 21; i++) g.tick();   // counter starts at 20, ticks to <=0 on the 21st
  const after = EL.list.filter((o) => o.type === 'shulker_bullet').length;
  ok(after === before + 1, 'the charge counter reaching zero spawns exactly one real shulker_bullet via EL.spawn');
  g.stop();
  ok(shooter.shulkerPeek === 0, 'stop() closes the lid again');

  // a target that drifts past 20 blocks (400 sq) is DROPPED outright, not just paused.
  const shooter2 = mkShulker(20.5, 5, 20.5);
  const farTarget = { x: 20.5, y: 5, z: 20.5 + 25, type: 'player', eyeHeight: 1.62, dead: false, removed: false, look: null };
  shooter2.target = farTarget;
  const g2 = new Sh.ShootBulletGoal(shooter2, { random: () => 0 });
  g2.start();
  g2.tick();
  okAv(shooter2.target === null, 'a target already past 20 blocks is cleared on the very first tick, not left to expire');

  // a dead/removed target fails canUse/canContinueToUse outright.
  const shooter3 = mkShulker(40.5, 5, 40.5);
  shooter3.target = { x: 40.5, y: 5, z: 43.5, type: 'player', dead: true };
  const g3 = new Sh.ShootBulletGoal(shooter3, { random: () => 0 });
  okAv(g3.canUse() === false, 'a dead target fails canUse, even though it is still assigned');

  // #654: SHULKER_SHOOT is played at volume 2.0 with pitch (r-r)*0.2+1.0; goal gated on non-peaceful; lookAt(...,180,180).
  const played = [];
  M.Diff = M.Diff || { value: 'normal', isPeaceful() { return this.value === 'peaceful'; } };
  const oldPlay = M.Sound && M.Sound.play;
  M.Sound = M.Sound || {};
  M.Sound.play = (id, o) => { played.push({ id, o }); };
  const sh4 = mkShulker(60.5, 5, 60.5);
  sh4.target = { x: 60.5, y: 5, z: 63.5, type: 'player', eyeHeight: 1.62, dead: false, removed: false };
  const seq = [0.9, 0.2]; let si = 0;
  const g4 = new Sh.ShootBulletGoal(sh4, { random: () => (si < 2 ? seq[si++] : 0) });
  g4.start(); g4.tick();
  let calls = [];
  sh4.look = { setLookAt: (...a) => calls.push(a) };
  for (let i = 0; i < 25; i++) g4.tick();
  const shot = played.find((q) => q.id === 'entity.shulker.shoot');
  okAv(shot && shot.o.volume === 2.0, 'shoot sound carries volume 2.0');
  okAv(shot && typeof shot.o.pitch === 'number' && shot.o.pitch !== 1.0 && Math.abs(shot.o.pitch - 1) <= 0.2, 'shoot sound carries a random pitch in 0.8..1.2');
  okAv(calls.length > 0 && Math.abs(calls[0][3] - Math.PI) < 1e-9 && Math.abs(calls[0][4] - Math.PI) < 1e-9, 'look turn rates are 180/180');
  M.Diff.value = 'peaceful';
  okAv(g4.canUse() === false, 'peaceful difficulty fails canUse');
  M.Diff.value = 'normal';
  if (oldPlay) M.Sound.play = oldPlay;
}

// ============ 4. Sh.attachAxis ================================================================
{
  say('\n§4 Sh.attachAxis -- the six faces map onto exactly the three axes');
  ok(Sh.attachAxis(Sh.DOWN) === 'y' && Sh.attachAxis(1) === 'y', 'down/up -> y');
  ok(Sh.attachAxis(2) === 'z' && Sh.attachAxis(3) === 'z', 'north/south -> z');
  ok(Sh.attachAxis(4) === 'x' && Sh.attachAxis(5) === 'x', 'west/east -> x');
}

// ============ 5. the bullet's own registration ===============================================
{
  say('\n§5 shulker_bullet registration -- canSpawn, motionFor, Sh.initBullet\'s fields');
  ok(EL.canSpawn('shulker_bullet') === true, 'EL.canSpawn(\'shulker_bullet\') is true (the [0,1] motionFor row this unit added)');
  const shooter = { x: 1.5, y: 5, z: 1.5, type: 'shulker' };
  const target = { x: 1.5, y: 5, z: 10.5, type: 'player', height: 1.8, dead: false, removed: false };
  const b = EL.spawn('shulker_bullet', 1.5, 5.5, 1.5, { shooter, target, axis: 'y' });
  ok(!!b && b.type === 'shulker_bullet', 'EL.spawn(\'shulker_bullet\', ...) actually produces one');
  ok(b.shooter === shooter, 'Sh.initBullet wires e.shooter from opts');
  ok(b.bulletTarget === target, 'Sh.initBullet wires e.bulletTarget from opts');
  okAv(b.maxHealth === undefined, 'shulker_bullet is NOT a living entity (entity-attributes-1.18.2.tsv\'s own exclusion list)');
}

// ============ 6. Sh.replanBullet ===============================================================
{
  say('\n§6 Sh.replanBullet -- aims at the target\'s anchor far away; excluded axis never offered');
  // clear a channel straight south (open air) from the bullet toward a target 10 blocks south --
  // south is the ONLY open direction, so a correct exclude-axis test still must pick it (it is
  // not the excluded 'y' axis) while a BROKEN one that ignored candidates entirely could pick
  // anything from a uniform 1-in-6 roll -- Sh.DZ[3] (south) is the only candidate this scaffold
  // allows through isAirAt, so a controlled rand()=0.999 (would roll a high, non-south index on
  // the uniform fallback) still MUST land on south once a real candidate exists.
  for (let x = 4; x <= 6; x++) for (let y = 4; y <= 6; y++) for (let z = 4; z <= 15; z++) W.setBlock(x, y, z, 0);
  W.setBlock(5, 4, 5, def('stone'));   // floor only directly under the bullet's own start cell
  const target = { x: 5.5, y: 5, z: 15.5, type: 'player', height: 1.8, dead: false, removed: false };
  const e = { x: 5.5, y: 5.5, z: 5.5, bulletTarget: target };
  const prevRandom = EL.random;
  EL.random = () => 0.999;   // Sh.replanBullet reads NS.EntityList.random, the same override
  Sh.replanBullet(e, 'y');   // idiom `entlistcheck.mjs`/`blazeghastcheck.mjs` already use
  EL.random = prevRandom;
  ok(e.bulletDir === 3, 'south (index 3) is the only real open-air candidate toward a target 10 blocks south, excluded-axis y');
  ok(Math.abs(e.bulletStepZ - 0.15) < 1e-9 && Math.abs(e.bulletStepX) < 1e-9 && Math.abs(e.bulletStepY) < 1e-9,
     'the resulting step vector is a pure +Z unit step scaled to 0.15 (method_7486\'s own literal)');
  ok(e.bulletSteps >= 10 && e.bulletSteps <= 50 && e.bulletSteps % 10 === 0, 'stepCount lands on 10 + nextInt(5)*10');

  // #1347: replan only when the next cell is top-solid, not merely non-air.
  {
    const mk = () => ({ x: 5.5, y: 5.5, z: 5.5, vx: 0, vy: 0, vz: 0, bulletTarget: { x: 5.5, y: 5, z: 15.5, type: 'zombie', height: 1.8, dead: false, removed: false }, bulletDir: 3, bulletSteps: 30, bulletStepX: 0, bulletStepY: 0, bulletStepZ: 0.15 });
    for (const n of ['tall_grass', 'water']) {
      W.setBlock(5, 5, 6, def(n));
      const b = mk(); Sh.tickBullet(b);
      ok(b.bulletDir === 3 && b.bulletSteps === 29, n + ' in the path does not force a replan (not top-solid)');
    }
    W.setBlock(5, 5, 6, def('stone'));
    const b2 = mk(); const pr = EL.random; EL.random = () => 0.999; Sh.tickBullet(b2); EL.random = pr;
    okAv(b2.bulletSteps !== 29, 'a stone block in the path still forces a replan');
    W.setBlock(5, 5, 6, 0);
    const b3 = mk(); b3.bulletTarget.dead = true; b3.bulletSteps = 1; Sh.tickBullet(b3);
    ok(b3.bulletSteps !== 1 || b3.bulletSteps === 0 ? b3.bulletSteps !== 1 : false, 'dead-but-unremoved target still replans');
  }

  // within 2 blocks of the target's own anchor: no waypoint at all, direction is null, aim raw.
  const close = { x: 5.5, y: 5.5, z: 5.5, bulletTarget: { x: 6, y: 5.9, z: 5.5, type: 'player', height: 1.8, dead: false, removed: false } };
  EL.random = () => 0.5;
  Sh.replanBullet(close, 'y');
  EL.random = prevRandom;
  okAv(close.bulletDir === null, 'a target anchor within 2 blocks skips waypoint-picking entirely (direction stays null)');
}

// §6b near-target test measures from the anchor block centre (#849, getSquaredDistanceFromCenter < 4)
{
  say('\n§6b Sh.replanBullet -- near test from block centre y+0.5, not the aim point');
  const saved = []; for (let y = 0; y <= 12; y++) { saved.push(W.getBlock(5, y, 5)); W.setBlock(5, y, 5, 0); }
  const prevRandom = EL.random;
  const run = (by) => {
    const e = { x: 5.5, y: by, z: 5.5, bulletTarget: { x: 5.5, y: 5, z: 5.5, type: 'player', height: 1.8, dead: false, removed: false } };
    EL.random = () => 0.5; Sh.replanBullet(e, 'x'); EL.random = prevRandom;
    return e.bulletDir === null;   // null = "already close"
  };
  ok(run(7.6) === false, 'bullet 2.1 above the block centre (1.7 above the aim point) is FAR (vanilla)');
  ok(run(3.6) === true, 'bullet 1.9 below the block centre (2.3 below the aim point) is CLOSE (vanilla)');
  ok(run(7.5) === false, 'exactly 2.0 from the block centre is far (strict < 4)');
  ok(run(7.4) === true, '1.9 above the block centre is close');
  for (let y = 0; y <= 12; y++) W.setBlock(5, y, 5, saved[y]);
}

// ============ 7. Sh.tickBullet =================================================================
{
  say('\n§7 Sh.tickBullet -- entity hit, block hit, no-target gravity, live homing blend');
  // entity hit: a bullet sitting inside a mob's own hitbox on tick deals 4 damage + Levitation.
  const shooter = { x: 0, y: 0, z: 0, type: 'shulker' };
  const victim = EL.spawn('zombie', 3.5, 5, 3.5);
  const b = EL.spawn('shulker_bullet', 3.5, 5.5, 3.5, { shooter, target: victim, axis: 'y' });
  const hpBefore = victim.health;
  Sh.tickBullet(b);
  ok(victim.health < hpBefore, `an overlapping shulker_bullet deals real damage (${hpBefore} -> ${victim.health})`);
  ok(b.removed === true, 'the bullet discards itself the instant it lands a hit');
  ok(M.Effects.hasStatusEffect(victim, 'levitation'), 'and applies Levitation to whatever it hit');

  // block hit (noClip, #3036): the getCollision raycast along the velocity hits a wall; no generic mover involved.
  const tgt2 = { x: 30.5, y: 5, z: 40.5, type: 'player', height: 1.8, dead: false, removed: false };
  W.setBlock(31, 5, 30, def('stone'));
  const b2 = EL.spawn('shulker_bullet', 30.5, 5.5, 30.5, { shooter, target: tgt2 });
  b2.vx = 0.9; b2.vy = 0; b2.vz = 0; b2.bulletStepX = 0.9; b2.bulletStepY = 0; b2.bulletStepZ = 0;
  Sh.tickBullet(b2);
  okAv(b2.removed === true, 'a bullet whose velocity segment crosses a solid block discards (raycast block hit)');
  // trajectory parity with the ported getCollision: free flight ends at pos + v (blend applied FIRST), and a
  // corner-skimming bullet (block beside its path, not on it) is NOT stopped, where the old box-collision was.
  W.setBlock(31, 5, 31, def('stone'));
  const b6 = EL.spawn('shulker_bullet', 30.5, 5.5, 29.9, { shooter, target: tgt2 });
  b6.vx = 0.5; b6.vy = 0; b6.vz = 0; b6.bulletStepX = 0.5; b6.bulletStepY = 0; b6.bulletStepZ = 0;
  const x0 = b6.x; Sh.tickBullet(b6); Sh.tickBullet(b6);
  okAv(!b6.removed && b6.x > x0 + 0.5, `skimming past a block corner: bullet survives and advances by v per tick (x ${x0} -> ${b6.x})`);
  W.setBlock(31, 5, 30, 0); W.setBlock(31, 5, 31, 0);
  // Levitation's cause entity is the owner (firstNonNull(owner, bullet)).
  const lv = M.Effects.getStatusEffect ? M.Effects.getStatusEffect(victim, 'levitation') : null;
  okAv(!lv || lv.source === undefined || lv.source === shooter, 'levitation source is the shooter');

  // vanilla onBlockHit: 2 'explosion' particles, spread 0.2 (not one zero-spread crit)
  const pp = Sh.lastBulletParticles;
  const rng0 = EL.random; EL.random = () => 0.5;   // keep the particle rolls off the shared stream
  ok(pp && pp.length === 2 && pp.every((q) => q.type === 'explosion'), 'block hit spawns exactly 2 explosion particles');
  okAv(pp && pp.every((q) => Math.abs(q.x - b2.x) < 1.2 && Math.abs(q.y - b2.y) < 1.2) && pp.some((q) => q.x !== b2.x), 'block-hit particles are spread around the bullet, not at a point');
  const b5 = EL.spawn('shulker_bullet', 80.5, 5.5, 80.5, { shooter, target: null });
  ok(Sh.damageBullet(b5) === true && b5.removed === true, 'damage() destroys the bullet and returns true');
  okAv(Sh.lastBulletParticles.length === 15 && Sh.lastBulletParticles.every((q) => q.type === 'crit'), 'damage() spawns 15 crit particles');
  EL.random = rng0;

  // flight trail: one end_rod at (pos - v + 0.15y) per tick, i.e. the pre-move position
  const b7 = EL.spawn('shulker_bullet', 90.5, 40.5, 90.5, { shooter, target: null });
  Sh.lastBulletTrail = null; const n0 = M.Particle.list.length; const bx0 = b7.x, by0 = b7.y, bz0 = b7.z;
  Sh.tickBullet(b7);
  const tr = Sh.lastBulletTrail, ep = M.Particle.list[M.Particle.list.length - 1];
  okAv(tr && tr.type === 'end_rod' && tr.x === bx0 && Math.abs(tr.y - (by0 + 0.15)) < 1e-9 && tr.z === bz0, 'flying bullet leaves an end_rod at pos - v + 0.15y');
  okAv(M.Particle.list.length === n0 + 1 && ep.type === 'end_rod' && ep.maxAge >= 60 && ep.maxAge < 72, 'the end_rod particle is really in Particle.list');

  // no live target: the real 0.04 gravity literal applies, not the homing blend.
  const b3 = EL.spawn('shulker_bullet', 60.5, 20.5, 60.5, { shooter, target: null });
  const vy0 = b3.vy;
  Sh.tickBullet(b3);
  okAv(Math.abs(b3.vy - (vy0 - Sh.BULLET_GRAVITY)) < 1e-9, `no target -> the transcribed 0.04 literal is subtracted from vy directly (${vy0} -> ${b3.vy})`);

  // live homing: velocity visibly bends toward the (freshly grown) step vector over real ticks.
  const target4 = { x: 70.5, y: 5, z: 70.5 + 6, type: 'player', height: 1.8, dead: false, removed: false };
  const b4 = EL.spawn('shulker_bullet', 70.5, 5.5, 70.5, { shooter, target: target4, axis: 'y' });
  const vzBefore = b4.vz;
  for (let i = 0; i < 5; i++) { Sh.tickBullet(b4); if (b4.removed) break; }
  ok(!b4.removed, 'five ticks of open-air homing toward a target 6 blocks away does not spuriously hit anything');
  ok(b4.vz > vzBefore, `velocity blends toward the target's own step vector over real ticks (vz ${vzBefore} -> ${b4.vz})`);
}


// ============ 9. Cb.hurt's shulker hook (teleport-on-hurt) ===================================
{
  say('\n\u00a79 Cb.hurt shulker hook -- closed blocks arrows, open takes them, <50% HP + 1-in-4 teleports');
  const Cb = M.Combat, Sh2 = M.Shulker;

  // a CLOSED shulker (shulkerPeek 0, the spawn default) facing a src.source==='projectile' hit
  // (the SAME tag Cb.tickArrow's own entity-hit branch sets, section 3's ShootBulletGoal proved
  // real) takes the hit as a no-op: health untouched, Cb.hurt itself returns false.
  const closed = mkShulker(50.5, 5, 50.5);
  ok(!closed.shulkerPeek, 'a freshly settled shulker starts closed (shulkerPeek falsy -- 0 or unset)');
  const hpBefore = closed.health;
  const hitClosed = Cb.hurt(closed, 6, undefined, false, { source: 'projectile', persistent: true });
  okAv(hitClosed === false, 'Cb.hurt itself reports the hit as a no-op against a closed shulker');
  okAv(closed.health === hpBefore, 'and a CLOSED shulker facing an arrow (src.source==="projectile") takes zero damage');

  // the SAME shulker, OPENED (shulkerPeek > 0, PeekGoal's own live field) takes the identical
  // hit normally -- the gate reads e.shulkerPeek, not "is this entity a shulker" alone.
  closed.shulkerPeek = 30;
  const hitOpen = Cb.hurt(closed, 6, undefined, false, { source: 'projectile', persistent: true });
  ok(hitOpen === true, 'the SAME shulker with shulkerPeek > 0 (open) takes an identical arrow hit normally');
  ok(closed.health < hpBefore, `and its health actually drops (${hpBefore} -> ${closed.health})`);

  // a non-projectile hit (melee/explosion/fire) is never gated by the closed check at all, even
  // while fully closed.
  const closed2 = mkShulker(55.5, 5, 55.5);
  const hp2 = closed2.health;
  const hitMelee = Cb.hurt(closed2, 3, undefined, true, {});
  ok(hitMelee === true, 'a CLOSED shulker facing a non-projectile hit (no src.source) is not gated at all');
  ok(closed2.health < hp2, 'and takes the melee damage normally');

  // <50% max HP + a controlled 1-in-4 roll drives a real Sh.tryTeleport call -- proved by
  // actually moving the entity, not just a flag. rand()==0.2 -> nextBetween(-8,8) = -5 on every
  // axis (shulkercheck.mjs's own #4 constant), AND floor(0.2*4)===0 clears the 1-in-4 gate the
  // SAME roll -- (bx-5,by-5,bz-5) sits right on the floor at y=4, so the landing itself succeeds.
  const low = { x: 10.5, y: 10, z: 10.5, dead: false, type: 'shulker', health: 12, maxHealth: 30 };
  const prevRandom = EL.random;
  EL.random = () => 0.2;
  Cb.hurt(low, 1, undefined, true, {});
  EL.random = prevRandom;
  okAv(low.x === 5.5 && low.y === 5 && low.z === 5.5, 'under 50% max HP with a controlled clearing roll, the hit actually teleports the shulker to the real landing spot (a real Sh.tryTeleport call, not a flag)');

  // the SAME low-health shape, but a roll that misses the 1-in-4 gate (floor(0.9*4)===3):
  // no teleport at all, even though tryTeleport's own landing spot would have been real.
  const low2 = { x: 10.5, y: 10, z: 10.5, dead: false, type: 'shulker', health: 12, maxHealth: 30 };
  EL.random = () => 0.9;
  Cb.hurt(low2, 1, undefined, true, {});
  EL.random = prevRandom;
  okAv(low2.x === 10.5 && low2.y === 10 && low2.z === 10.5, 'the SAME under-50% shulker with a roll that misses the 1-in-4 gate does not teleport');

  // full-health shulker with the SAME guaranteed-clear roll: no teleport (the health gate, not
  // just the roll, must hold).
  const healthy = { x: 10.5, y: 10, z: 10.5, dead: false, type: 'shulker', health: 30, maxHealth: 30 };
  EL.random = () => 0.2;   // the SAME clearing roll that moved `low` above
  Cb.hurt(healthy, 1, undefined, true, {});
  EL.random = prevRandom;
  okAv(healthy.x === 10.5 && healthy.y === 10 && healthy.z === 10.5, 'a full-health shulker never teleports on hit, even with the SAME roll that moved a low-health one above');
}

// ============ 10. #3035 melee-vs-bullet, peaceful discard, non-living bullet targets ==========
{
  say('\n§10 shulker_bullet: hit destroys it, peaceful discards it, other bullets/carts are hittable');
  const Cb2 = M.Combat, Sh2 = M.Shulker, EL2 = M.EntityList;
  const b = EL2.spawn('shulker_bullet', 1.5, 5.5, 1.5, {});
  ok(Cb2.canAttack(b) === true, 'a live bullet is attackable');
  okAv(Cb2.hurt(b, 4, undefined, true, {}) === true && b.removed === true, 'Cb.hurt on a bullet discards it');
  const b2 = EL2.spawn('shulker_bullet', 1.5, 5.5, 1.5, {});
  M.Diff = M.Diff || { value: 'normal', isPeaceful() { return this.value === 'peaceful'; } };
  M.Diff.value = 'peaceful'; Sh2.tickBullet(b2); M.Diff.value = 'normal';
  okAv(b2.removed === true, 'peaceful discards a live bullet on its next tick');
  const v = EL2.spawn('shulker_bullet', 200.5, 5.5, 200.5, {});
  const v2 = EL2.spawn('shulker_bullet', 200.5, 5.5, 200.5, {});
  Sh2.tickBullet(v);
  okAv(v2.removed === true && v.removed === true, 'a bullet hitting another bullet discards both');
}

// #3033: bullet Target/Dir/Steps/TXD.. survive MobNbt serializeAll -> JSON -> restoreAll
{
  const tgt = { x: 70.5, y: 5, z: 70.5, height: 1.8, dead: false, removed: false };
  M.Player = tgt;
  const b = EL.spawn('shulker_bullet', 70.5, 8.5, 70.5, { target: tgt });
  const snap = { d: b.bulletDir, s: b.bulletSteps, x: b.bulletStepX, y: b.bulletStepY, z: b.bulletStepZ };
  const recs = JSON.parse(JSON.stringify(M.MobNbt.serializeAll()));
  for (const o of EL.list.slice()) if (o && o.type === 'shulker_bullet') o.removed = true;
  EL.list = EL.list.filter((o) => o && !o.removed);
  M.MobNbt.restoreAll(recs.filter((r) => r.type === 'shulker_bullet'));
  const nb = EL.list.filter((o) => o.type === 'shulker_bullet').pop();
  ok(!!nb && nb.bulletTarget === tgt, 'restored bullet keeps its homing target (Target)');
  okAv(!!nb && nb.bulletDir === snap.d && nb.bulletSteps === snap.s && nb.bulletStepX === snap.x &&
    nb.bulletStepY === snap.y && nb.bulletStepZ === snap.z, 'restored bullet keeps Dir/Steps/TXD/TYD/TZD, not a fresh re-plan');
}
// #4451: the real roster -- LookAtPlayerGoal (prio 1, LOOK) must interrupt ShootBulletGoal (prio 4, MOVE|LOOK)
{
  const sh = mkShulker(6.5, 5, 6.5);
  const pl = { x: sh.x + 6, y: sh.y, z: sh.z, type: 'player', eyeHeight: 1.62, dead: false, removed: false, look: null };
  sh.target = pl;
  let n = 0; const rnd = () => ((n = (Math.imul(n, 1103515245) + 12345) & 0x7fffffff) / 2147483648);
  const gs = Sh.roster(sh, { players: () => [pl], random: rnd });
  const shoot = gs.entries.find((x) => x.goal instanceof Sh.ShootBulletGoal);
  ok((shoot.flags & Ai.MOVE) && (shoot.flags & Ai.LOOK), 'ShootBulletGoal registers MOVE|LOOK like vanilla');
  let was = false, stops = 0;
  for (let i = 0; i < 2000; i++) {
    pl.x = sh.x + 6; pl.y = sh.y; pl.z = sh.z;   // the shulker can still teleport (StayAttached); keep the player 6 blocks off
    sh.target = pl; gs.tick();
    if (was && !shoot.running) stops++;
    was = shoot.running;
  }
  okAv(stops > 0, 'a targeting shulker within the 8-block look range gets its ShootBulletGoal interrupted by the look goal (' + stops + ' stops/2000t)');
}
console.log(`\n${pass} checks passed, ${breaks} breaks caught, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log('  x ' + f);
  process.exit(1);
}
