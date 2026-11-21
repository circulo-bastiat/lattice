#!/usr/bin/env node
// witherattackcheck.mjs — QUEUE 0.00 part 2 (G18 leftover, D-787): the WITHER's ranged
// wither-skull attack (src/07zzm_wither.js's `Wi.attack`/`Wi.initSkull`/`Wi.tickSkull`, the
// `wither_skull` projectile registered in src/07i_entitylist.js). Non-browser (game-logic only).
//
//   node tools/witherattackcheck.mjs [--verbose]
//
// Sections:
//   1. wither_skull is a real, spawnable projectile type (motion/hitbox/DEFAULTS all wired)
//   2. Wi.attack (ProjectileAttackGoal's onShoot) spawns it off head 0, aimed at the target
//   3. Wi.tickSkull: an OWNED hit deals 8 damage through the real combat path, heals the
//      shooter 5 on a kill, then always explodes and discards
//   4. Wi.tickSkull: an UNOWNED hit (no shooter) deals the flat 5 magic-damage fallback
//   5. Wi.tickSkull: a block hit (no entity in the way) still always explodes and discards
//   6. the Wither status effect lands on a successful hit, difficulty-scaled (200/800/0 ticks)
//   7. anti-vacuity — the roster BEFORE this unit (no ProjectileAttackGoal row) never fires a
//      skull at all, across many ticks; the real roster (this unit) does, within one cycle

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); if (VERBOSE) console.log((c ? '  ✓ ' : '  ✗ ') + m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

console.log('witherattackcheck — QUEUE 0.00 part 2 (D-787): the wither’s ranged skull attack');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
  '07e_loot.js', '07h_entities.js', '14b_physics.js', '14c_raycast.js', '09b_sky.js',
  '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js', '14j_combat.js',
  '07q_effects.js', '07t_fly.js', '07za_explosion.js', '07zw_mobnbt.js', '07zzh_blaze.js',
  '07zzi_ghast.js', '07zzm_wither.js', '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const W = MCL.World, B = MCL.Behave, CH = MCL.CH, S = MCL.States;
const EL = MCL.EntityList, Ai = MCL.Ai, Ent = MCL.Entities, Cb = MCL.Combat, Sv = MCL.Survival;
const Ex = MCL.Explosion, ES = MCL.Effects, Diff = MCL.Diff, Wi = MCL.Wither, Gh = MCL.Ghast;

B.init(W);
Ent.init();
EL.init();
Ai.init();
Cb.init();
Ex.init();

ok(!!Wi && Wi.ready, 'Wither module reports ready');
ok(typeof Wi.attack === 'function', 'Wi.attack exists (the ProjectileAttackGoal onShoot)');
ok(typeof Wi.tickSkull === 'function', 'Wi.tickSkull exists (the per-tick consequence)');
ok(typeof Wi.initSkull === 'function', 'Wi.initSkull exists (the ctor default)');

function freshWorld() {
  W.init(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
    const c = W.makeChunk(cx, cz);
    c.state = CH.GENERATED;
    W.chunks.set(W.key(cx, cz), c);
  }
  EL.init();
}
function put(x, y, z, name) { W.setBlock(x, y, z, S.stateOf(name) | 0); }
function spawn(type, x, y, z, opts) { return EL.spawn(type, x, y, z, opts); }
function mkTarget(x, y, z) {
  return { type: 'cow', x, y, z, health: 20, maxHealth: 20, width: 0.9, height: 1.4,
    vx: 0, vy: 0, vz: 0, knockbackResistance: 0, invulnerableTime: 0, hurtTime: 0 };
}
function mkPlayer(x, y, z) {
  return { type: 'player', x, y, z, health: 20, maxHealth: 20, height: 1.8,
    vx: 0, vy: 0, vz: 0, knockbackResistance: 0, invulnerableTime: 0, hurtTime: 0, armor: 0, armorToughness: 0 };
}

// ═════════════ 1. wither_skull is a real, spawnable projectile type ═══════════════
{
  say('\n§1 wither_skull is spawnable, hitbox/motion wired');
  ok(EL.canSpawn('wither_skull'), "EL.canSpawn('wither_skull') is true");
  freshWorld();
  const sk = spawn('wither_skull', 5.5, 64.5, 5.5, { power: [0, 0, 1] });
  ok(!!sk, 'EL.spawn actually returns a live wither_skull entity');
  ok(near(sk.width, 0.3125) && near(sk.height, 0.3125), `hitbox is the real 0.3125x0.3125 (got ${sk.width}x${sk.height})`);
  ok(sk.gravity === 0, 'no gravity (a constant power vector drives it, not gravity)');
  ok(near(sk.powerZ, 0.1, 1e-6) && near(sk.powerX, 0, 1e-6) && near(sk.powerY, 0, 1e-6),
    `Wi.initSkull normalized+scaled the (0,0,1) aim to the real 0.1 SPEED_FACTOR (got ${sk.powerX},${sk.powerY},${sk.powerZ})`);
  ok(sk.charged === false, 'uncharged by default when no opts.charged is passed');
}

// ═════════════ 2. Wi.attack spawns off head 0, aimed at the target ═══════════════
{
  say('\n§2 Wi.attack: spawn position/aim');
  freshWorld();
  const w = spawn('wither', 0.5, 64, 0.5);
  const tgt = mkTarget(10.5, 64, 0.5);
  EL.list.push(tgt);
  const before = EL.list.filter((e) => e.type === 'wither_skull').length;
  const proj = Wi.attack(w, tgt);
  ok(!!proj && proj.type === 'wither_skull', 'Wi.attack returns the spawned wither_skull');
  ok(EL.list.filter((e) => e.type === 'wither_skull').length === before + 1, 'exactly one new wither_skull appears in EL.list');
  ok(near(proj.x, w.x) && near(proj.y, w.y + Wi.SKULL_MUZZLE_Y) && near(proj.z, w.z),
    `spawned at head 0 (body position + ${Wi.SKULL_MUZZLE_Y} up), got (${proj.x},${proj.y},${proj.z})`);
  ok(proj.powerX > 0, `aimed toward the target (+X): powerX ${proj.powerX} > 0`);
  ok(proj.shooter === w, 'the wither is recorded as the shooter (owned hit / heal-on-kill / no-self-hit)');
  ok(Wi.attack(w, null) === null, 'Wi.attack refuses a null target rather than throwing');
}

// ═════════════ 3. owned hit: 8 damage, heal-on-kill, always explodes ═══════════════
{
  say('\n§3 Wi.tickSkull: owned hit');
  freshWorld();
  const w = spawn('wither', 0.5, 80, 0.5);
  w.health = 250;
  const sk = spawn('wither_skull', 5.5, 64.5, 5.5, { power: [0, 0, 1], shooter: w });
  const tgt = mkTarget(5.5, 64.5, 5.6);
  EL.list.push(tgt);
  const h0 = tgt.health;
  Wi.tickSkull(sk);
  // the target ALSO sits inside its own onCollision explosion's blast radius -- real vanilla
  // double-dips the same way (WitherSkullEntity.onEntityHit's 8, THEN onCollision's own
  // createExplosion), the SAME standing blazeghastcheck's own big-fireball section already
  // names for this identical shape -- so this only asserts AT LEAST the direct 8.
  ok(h0 - tgt.health >= Wi.SKULL_DAMAGE_OWNED - 1e-3, `an owned hit deals at least the real 8 direct damage (${h0} -> ${tgt.health})`);
  ok(sk.removed === true, 'the skull is discarded on its own hit');

  // heal-on-kill: a one-hit-point target dies to the 8 damage, healing the shooter 5
  freshWorld();
  const w2 = spawn('wither', 0.5, 80, 0.5);
  w2.health = 100;
  const sk2 = spawn('wither_skull', 5.5, 64.5, 5.5, { power: [0, 0, 1], shooter: w2 });
  const weakTgt = mkTarget(5.5, 64.5, 5.6);
  weakTgt.health = 1; weakTgt.maxHealth = 20;
  EL.list.push(weakTgt);
  const hp0 = w2.health;
  Wi.tickSkull(sk2);
  ok(weakTgt.dead === true, 'a lethal owned hit actually kills the target');
  ok(near(w2.health - hp0, Wi.SKULL_HEAL_ON_KILL, 1e-3), `killing the target heals the shooter the real 5 HP (${hp0} -> ${w2.health})`);

  // explosion always fires on a hit, real block break beside it
  freshWorld();
  put(6, 63, 5, 'dirt');
  const w3 = spawn('wither', 0.5, 80, 0.5);
  const sk3 = spawn('wither_skull', 5.5, 64.5, 5.5, { power: [1, 0, 0], shooter: w3 });
  const tgt3 = mkTarget(5.5, 64.5, 5.6);
  EL.list.push(tgt3);
  const before3 = W.getBlock(6, 63, 5);
  Wi.tickSkull(sk3);
  ok(before3 !== 0 && W.getBlock(6, 63, 5) === 0, `the real NS.Explosion.explode broke the dirt beside the hit (${before3} -> ${W.getBlock(6, 63, 5)})`);
}

// ═════════════ 4. unowned hit: flat 5 magic damage ═══════════════
{
  say('\n§4 Wi.tickSkull: unowned hit (no shooter)');
  freshWorld();
  const sk = spawn('wither_skull', 5.5, 64.5, 5.5, { power: [0, 0, 1] });
  ok(sk.shooter === undefined, 'precondition: this skull has no shooter');
  const tgt = mkTarget(5.5, 64.5, 5.6);
  EL.list.push(tgt);
  const h0 = tgt.health;
  Wi.tickSkull(sk);
  // same double-dip as the owned case above -- the target also sits in the same-tick explosion.
  ok(h0 - tgt.health >= Wi.SKULL_DAMAGE_UNOWNED - 1e-3, `an unowned hit deals at least the flat 5 magic damage (${h0} -> ${tgt.health})`);
  ok(sk.removed === true, 'discarded on the unowned hit too');
}

// ═════════════ 5. block hit: always explodes, discards ═══════════════
{
  say('\n§5 Wi.tickSkull: block hit (onGround)');
  freshWorld();
  // `dirt`, the SAME low-resistance block `blazeghastcheck`'s own block-hit test uses -- the
  // skull's own explosion power (1.0) is real and small, not every block yields to it.
  put(6, 63, 5, 'dirt');
  const sk = spawn('wither_skull', 5.5, 64.0, 5.5, { power: [1, -1, 0] });
  sk.onGround = true;
  const before = W.getBlock(6, 63, 5);
  Wi.tickSkull(sk);
  ok(before !== 0 && W.getBlock(6, 63, 5) === 0, `a block hit still explodes for real (dirt ${before} -> ${W.getBlock(6, 63, 5)})`);
  ok(sk.removed === true, 'discarded on the block hit');
}

// ═════════════ 6. Wither status effect, difficulty-scaled ═══════════════
{
  say('\n§6 Wither status effect: difficulty-scaled duration');
  function hitAt(difficulty) {
    freshWorld();
    Diff.set(difficulty);
    const w = spawn('wither', 0.5, 80, 0.5);
    const sk = spawn('wither_skull', 5.5, 64.5, 5.5, { power: [0, 0, 1], shooter: w });
    const tgt = mkTarget(5.5, 64.5, 5.6);
    EL.list.push(tgt);
    Wi.tickSkull(sk);
    return (tgt.effects && tgt.effects.wither) || null;
  }
  const effNormal = hitAt('normal');
  ok(!!effNormal, `NORMAL difficulty: the target has a real 'wither' status effect after the hit (got ${JSON.stringify(effNormal)})`);
  if (effNormal) ok(effNormal.duration === Wi.SKULL_WITHER_TICKS_NORMAL, `NORMAL duration is the real 200 ticks (got ${effNormal.duration})`);

  const effHard = hitAt('hard');
  ok(!!effHard && effHard.duration === Wi.SKULL_WITHER_TICKS_HARD, `HARD difficulty: 800 ticks (got ${effHard && effHard.duration})`);

  const effPeaceful = hitAt('peaceful');
  ok(!effPeaceful, `PEACEFUL difficulty: no Wither effect applied at all (got ${JSON.stringify(effPeaceful)})`);
  Diff.set('normal');   // leave the shared module in its default state for later sections
}

// ═════════════ 7. anti-vacuity: no attack goal ever fires, the real one does ═══════════════
// `Wi.roster` BEFORE this unit built exactly the FlyRandomlyGoal/LookAtPlayerGoal/
// RandomLookAroundGoal/RevengeGoal/NearestAttackableTargetGoal rows (see the file's own header
// and Wi.OWED) and NOTHING that ever calls EL.spawn('wither_skull', ...) -- a targeting wither
// closed distance but never fired a single skull, ever. This reproduces that exact prior
// roster shape directly (not a copy of the module, the real `Ai`/`NS.Ghast` classes this file
// still uses) and asserts it stays at 0 skulls across a long window, then asserts the REAL
// current `Wi.roster` (wired through `Ai.ROSTER.wither`, the same table `EL.spawn` reads) fires
// a real skull within one attack cycle.
{
  say('\n§7 anti-vacuity: pre-unit roster never fires, current roster does');
  function skulls() { return EL.list.filter((e) => e.type === 'wither_skull').length; }

  freshWorld();
  const wOld = spawn('wither', 0.5, 64, 0.5);
  const plrOld = mkPlayer(0.5, 64, 6.5);
  EL.list.push(plrOld);
  wOld.target = plrOld;   // bypass the target-acquire roll -- determinism, not the thing under test
  const gsOld = new Ai.GoalSelector();
  gsOld.add(1, Ai.TARGET, new Ai.RevengeGoal(wOld, { players: () => [plrOld] }, {}));
  gsOld.add(2, Ai.TARGET, new Ai.NearestAttackableTargetGoal(wOld, () => Wi.candidates(wOld, { players: () => [plrOld] })));
  gsOld.add(5, Ai.MOVE, new Wi.FlyGoal(wOld, 1.0));
  gsOld.add(6, Ai.LOOK, new Ai.LookAtPlayerGoal(wOld, () => [plrOld], Wi.LOOK_RANGE));
  gsOld.add(7, Ai.LOOK, new Ai.RandomLookAroundGoal(wOld, Math.random));
  const beforeOld = skulls();
  for (let i = 0; i < 200; i++) gsOld.tick();
  okAv(skulls() === beforeOld, `the pre-unit roster (no ProjectileAttackGoal row) fires 0 skulls across 200 ticks (got ${skulls() - beforeOld})`);

  freshWorld();
  const wNew = spawn('wither', 0.5, 64, 0.5);
  const plrNew = mkPlayer(0.5, 64, 6.5);
  EL.list.push(plrNew);
  ok(!!wNew.ai, "EL.spawn wires a live wither's goal selector off Ai.ROSTER.wither (this unit's registration)");
  wNew.target = plrNew;
  const beforeNew = skulls();
  for (let i = 0; i < Wi.SKULL_INTERVAL + 5 && skulls() === beforeNew; i++) wNew.ai.tick();
  ok(skulls() > beforeNew, `the current, real roster fires a wither_skull within one ${Wi.SKULL_INTERVAL}-tick cycle (got ${skulls() - beforeNew})`);
}


// ═════════════ 8. anti-vacuity: zeroing the heal-on-kill constant is caught ═══════════════
// (NOT the owned-hit damage constant: the skull's own explosion always follows the direct hit
// in the SAME tick, and this engine's real invulnerability "top-up" rule -- new damage only
// applies the amount ABOVE the last hit this invuln window -- means a lower direct-hit constant
// gets silently absorbed by the explosion's own (larger) damage, converging on the identical
// final health either way. The heal-on-kill amount has no such interaction (it targets the
// shooter, untouched by the target's explosion/invulnerability math), so it is a clean probe.
{
  say('\n§8 anti-vacuity: a zeroed SKULL_HEAL_ON_KILL changes the outcome');
  const real = Wi.SKULL_HEAL_ON_KILL;

  function healedWith(healConst) {
    freshWorld();
    const w = spawn('wither', 0.5, 80, 0.5);
    w.health = 100;
    const sk = spawn('wither_skull', 5.5, 64.5, 5.5, { power: [0, 0, 1], shooter: w });
    const weakTgt = mkTarget(5.5, 64.5, 5.6);
    weakTgt.health = 1; weakTgt.maxHealth = 20;
    EL.list.push(weakTgt);
    const hp0 = w.health;
    Wi.SKULL_HEAL_ON_KILL = healConst;
    Wi.tickSkull(sk);
    Wi.SKULL_HEAL_ON_KILL = real;
    return w.health - hp0;
  }

  const healedReal = healedWith(real);
  const healedZero = healedWith(0);
  okAv(healedZero < healedReal - 1e-3,
    `zeroing SKULL_HEAL_ON_KILL changes the heal-on-kill amount (real-constant run healed ${healedReal}, zeroed run healed ${healedZero}) -- proves §3's heal-on-kill assertion is not vacuously true`);
}

// ═════════════ 3b. yaw/pitch follow velocity (#4900) ═══════════════
{
  say('\n§3b skull rotation');
  freshWorld();
  const w = spawn('wither', 0.5, 80, 0.5);
  w.yaw = 1.0; w.pitch = 0.3;
  const sk = spawn('wither_skull', 0.5, 90, 0.5, { power: [1, 0, 0], shooter: w });
  ok(near(sk.yaw, 1.0) && near(sk.pitch, 0.3), 'ctor copies the owner yaw/pitch');
  for (let i = 0; i < 40; i++) Wi.tickSkull(sk);
  ok(Math.abs(sk.yaw - Math.PI / 2) < 0.01 && Math.abs(sk.pitch) < 0.01, `after 40 ticks heading +X: yaw ${sk.yaw} ~ pi/2, pitch ${sk.pitch} ~ 0`);
  // anti-vacuity: with the lerp disabled the rotation would stay at the owner's
  okAv(Math.abs(sk.yaw - 1.0) > 0.3, `ticked yaw moved off the owner's 1.0 (a missing lerp is caught)`);
}

console.log(`\n${pass} passed, ${fails.length} failed (of which ${breaks} anti-vacuity probes)`);
for (const f of fails) console.log('  ✗ ' + f);
process.exit(fails.length ? 1 : 0);
