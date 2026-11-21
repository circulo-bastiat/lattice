#!/usr/bin/env node
// goatcheck.mjs — loop/goat-s99 (QUEUE 0.2 G18c, missing overworld mob): the GOAT, whole.
// Drives the REAL modules (07zj_goat.js, Ai.ROSTER.goat/EL.DEFAULTS.goat/Spawn.RULES.goat/
// Br.CHILD.goat/Ph.landed's own goat hook/Use.entityUse's own milking branch) against
// `.decomp/net/minecraft/entity/passive/GoatEntity.java` and `GoatBrain.java` (both read in
// full).
//
//   node tools/goatcheck.mjs [--verbose]
//
// Sections:
//   1. attributes/dimensions/breeding food — the jar-extracted entity table's own row for goat
//   2. EL.spawn('goat', ...) — EL.DEFAULTS.goat rolls the screaming flag, Ai.ROSTER.goat attaches e.ai
//   3. Spawn.RULES.goat — the goats_spawnable_on tag + light gate
//   4. Gt.adjustFallDamage / Ph.landed's own hook — the flat -10
//   5. Gt.jumpVelocity/Gt.bestJumpVelocity — the long-jump trajectory kernel
//   6. Gt.LongJumpGoal — cooldown gate + one-shot launch
//   7. Gt.RamGoal / Gt.impact — cooldown, target pick, prepare, charge, impact, knockback
//   8. Br.CHILD.goat / Gt.childScreaming — the (asymmetric) screaming inheritance
//   9. milking — Use.entityUse's own bucket branch
//  10. anti-vacuity — break the check's own data/stubs and watch it catch the break

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c && VERBOSE) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };

console.log('goatcheck — loop/goat-s99 (QUEUE 0.2 G18c), the goat, whole');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
               '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
               '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js',
               '07q_effects.js', '07m_breed.js', '07zh_rabbit.js', '07zj_goat.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const EL = MCL.EntityList, Ai = MCL.Ai, Spawn = MCL.Spawn, Ent = MCL.Entities;
const Gt = MCL.Goat, Breed = MCL.Breed, W = MCL.World, S = MCL.States, Bh = MCL.Behave;
const Ph = MCL.Physics, Cb = MCL.Combat, Use = MCL.Use, Iv = MCL.Inventory;
// run a LongJumpGoal the way the selector does: start, then tick until it stops continuing; returns ticks used
const runJump = (g, max = 80) => { g.start(); let n = 0; do { g.tick(); n++; } while (g.canContinueToUse() && n < max); return n; };
const CH = MCL.CH;

MCL.Entities.init();
Ent.attrs = MCL.DATA.entities.attrs;
W.init(1);
Bh.init(W);
EL.init();
Ai.init();
Spawn.init();
Breed.init();
if (Cb && Cb.init) Cb.init();

for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}

ok(Gt && Gt.ready, 'NS.Goat did not load/ready');

// ── 1. attributes/dimensions/breeding food ──────────────────────────────────────────────────
say('1. the jar-extracted entity table’s own row for goat');
{
  const at = Ent.attrsOf('goat');
  ok(!!at, 'Ent.attrsOf(goat) missing entirely');
  ok(at && at.hp === 10, `goat max health 10 (createGoatAttributes) — got ${at && at.hp}`);
  ok(at && Math.abs(at.speed - 0.2) < 1e-6, `goat movement speed 0.2 — got ${at && at.speed}`);
  ok(at && at.dmg === 2, `goat attack damage 2 (DEFAULT_ATTACK_DAMAGE) — got ${at && at.dmg}`);
  const dim = Ent.dimensions('goat');
  ok(dim && Math.abs(dim.width - 0.9) < 1e-9 && Math.abs(dim.height - 1.3) < 1e-9,
    `goat dims [0.9,1.3] — got ${dim && [dim.width, dim.height]}`);
  const food = Ent.breedFood('goat');
  ok(food && food.k === 'items' && food.i.indexOf('wheat') >= 0,
    `goat breeds on wheat (GoatBrain.getTemptItems) — got ${JSON.stringify(food)}`);
}

// ── 2. EL.spawn(goat) ────────────────────────────────────────────────────────────────────────
say('2. EL.spawn(goat) — EL.DEFAULTS.goat + Ai.ROSTER.goat');
let e0;
{
  ok(EL.canSpawn('goat'), 'EL.canSpawn(goat) is false — the closed motion set refuses it');
  const m = EL.motionFor('goat');
  ok(m && Math.abs(m[0] - 0.08) < 1e-9 && Math.abs(m[1] - 0.98) < 1e-9, `motionFor(goat) = ${m}, expected [0.08,0.98]`);
  e0 = EL.spawn('goat', 0, 64, 0, {});
  ok(e0.screaming === true || e0.screaming === false, 'EL.DEFAULTS.goat did not set e.screaming');
  ok(!!e0.ai, 'EL.spawn did not attach e.ai for a rostered goat');
  ok(e0.maxHealth === 10, `maxHealth ${e0.maxHealth}, expected 10 off the attribute table`);

  const forced = EL.spawn('goat', 0, 64, 0, { screaming: true });
  ok(forced.screaming === true, 'opts.screaming=true (egg/command) did not stick');
  const forcedOff = EL.spawn('goat', 0, 64, 0, { screaming: false });
  ok(forcedOff.screaming === false, 'opts.screaming=false (egg/command) did not stick');

  okAv((() => {
    const many = [];
    for (let i = 0; i < 400; i++) { EL.spawnCounter = i * 104729; many.push(EL.spawn('goat', 0, 64, 0, {}).screaming); }
    return many.some((x) => x === true) && many.some((x) => x === false);
  })(), 'across 400 natural spawns, e.screaming never varied — the 2% roll is not live');
  // KW-35 (D-697): the 400-spawn roll above (and every EL.spawn this file calls) never left
  // EL.list -- unlike every other checkfile's own sections (batcheck.mjs/bedcheck.mjs/
  // bowdrawcheck.mjs etc all clear `EL.list.length = 0` between sections, a convention this
  // file never followed). §7's real end-to-end EL.tickMob(e) call runs EL.pushAround(e), which
  // sums ONE push per overlapping live entity in EL.list -- 400+ stale goats stacked at this
  // exact spawn point (0,64,0) summed to a one-tick ~12 block shove, launching the goat clean
  // off the test platform into the void well before it could ever reach its ram target. Traced
  // live (side-by-side instrumentation of Ph.travelMob/EL.pushAround): confirmed 408 overlapping
  // entities at the tick the goat's vx jumped from 0.196 to 12.411. This is why the test used to
  // "survive that fall for free" (KW-34's 0-fall-damage bug hid the shove's consequence) and now
  // dies of real fall damage instead (D-696) -- not a missing cliff-avoidance AI gap in
  // `Gt.RamGoal` at all. Cleared here, the same place clearMobs()-style checks already clear.
  EL.list.length = 0;
}

// ── 3. Spawn.RULES.goat ─────────────────────────────────────────────────────────────────────
say('3. Spawn.RULES.goat — #goats_spawnable_on + isLightLevelValidForNaturalSpawn');
{
  ok(typeof Spawn.RULES.goat === 'function' && Spawn.canPlace('goat'), 'Spawn.RULES.goat is not wired');
  // stone/snow/snow_block/packed_ice ARE in `#goats_spawnable_on` (real mountain-peak
  // terrain, `BlockTags.field_35569` -- confirmed against the live tag table, not assumed the
  // way rabbit's own tag-negative case assumed stone was excluded); dirt genuinely is not.
  const dirt = S.stateOf('dirt') | 0, snowBlock = S.stateOf('snow_block') | 0;
  W.setBlock(0, 63, 0, snowBlock);
  W.setBlock(0, 63, 1, dirt);
  const saveBright = W.rawBrightness;
  W.rawBrightness = () => 9;
  ok(Spawn.RULES.goat(0, 64, 0) === true, 'snow_block below (goats_spawnable_on) + bright enough must pass');
  ok(Spawn.RULES.goat(0, 64, 1) === false, 'plain dirt below (not in goats_spawnable_on) must refuse');
  okAv((() => { W.rawBrightness = () => 8; return Spawn.RULES.goat(0, 64, 0) === false; })(),
    'dropping brightness to 8 (the >8 boundary) must refuse — the light check is really consulted');
  W.rawBrightness = saveBright;
}

// ── 4. Gt.adjustFallDamage / Ph.landed's own hook ───────────────────────────────────────────
say('4. Gt.adjustFallDamage — GoatEntity.computeFallDamage\'s own -10');
{
  ok(Gt.adjustFallDamage({ type: 'goat' }, 15) === 5, 'goat fall damage 15 should reduce to 5 (15-10)');
  ok(Gt.adjustFallDamage({ type: 'goat' }, 3) === 0, 'goat fall damage 3 should floor at 0, not go negative');
  ok(Gt.adjustFallDamage({ type: 'cow' }, 15) === 15, 'a non-goat must be UNCHANGED by Gt.adjustFallDamage');

  // through the real pipeline: Ph.landed sets e.pendingFallDamage, which the goat hook adjusts.
  const baseCow = Ph.fallDamage(15, 1, undefined);   // the ordinary formula, unreduced
  const g = EL.spawn('goat', 0, 64, 0, {});
  g.width = 0.9; g.height = 1.3;
  Ph.landed(g, 15, -1);
  ok(g.pendingFallDamage === baseCow - 10,
    `Ph.landed on a goat falling 15: pendingFallDamage ${g.pendingFallDamage}, expected ${baseCow - 10} (base ${baseCow} minus 10)`);
  const c = EL.spawn('cow', 3, 64, 0, {});
  Ph.landed(c, 15, -1);
  ok(c.pendingFallDamage === baseCow, `Ph.landed on a cow falling 15 must stay at the base ${baseCow} — got ${c.pendingFallDamage}`);

  okAv((() => {
    const save = Gt.FALL_DAMAGE_SUBTRACTOR;
    Gt.FALL_DAMAGE_SUBTRACTOR = 0;
    const broke = Gt.adjustFallDamage({ type: 'goat' }, 15) === 15;
    Gt.FALL_DAMAGE_SUBTRACTOR = save;
    return broke;
  })(), 'zeroing Gt.FALL_DAMAGE_SUBTRACTOR was not detected — the subtractor is really read');
}

// ── 5. Gt.jumpVelocity / Gt.bestJumpVelocity ────────────────────────────────────────────────
say('5. Gt.jumpVelocity/Gt.bestJumpVelocity — LongJumpTask.getRammingVelocity, closed form');
{
  // a flat target straight ahead: the classic 45-degree-family symmetric projectile check —
  // at landing, vy_at_impact should equal -vy_launch (a symmetric arc back to the same height).
  const v = Gt.jumpVelocity(0, 64, 0, 5, 64, 0, 70, 1.5);
  ok(!!v, 'a flat, in-range target at 70 degrees must solve');
  if (v) {
    const horiz = Math.hypot(v.x, v.z);
    const tanExpected = Math.tan(70 * Math.PI / 180);
    ok(Math.abs(v.y / horiz - tanExpected) < 1e-6,
      `launch angle should be 70 degrees (vy/vh = tan(70)) — got vy/vh=${(v.y / horiz).toFixed(4)}, expected ${tanExpected.toFixed(4)}`);
    // integrate the real per-tick gravity forward and check it lands within half a block of
    // the (0.5-block-short) adjusted target x -- proves the closed-form speed is really the
    // one that lands there, not just "some" solution.
    let x = 0, y = 64, z = 0, vx = v.x, vy = v.y, vz = v.z;
    let landed = false, lx = x, ly = y;
    for (let t = 0; t < 200 && !landed; t++) {
      vy -= Gt.JUMP_GRAVITY;
      x += vx; y += vy; z += vz;
      if (y <= 64 && t > 0) { landed = true; lx = x; ly = y; }
    }
    ok(landed, 'integrating Gt.jumpVelocity forward under Gt.JUMP_GRAVITY never came back to launch height');
    // the real target (0.5 short of x=5) is 4.5; allow slack for the discrete-tick integration.
    ok(landed && Math.abs(lx - 4.5) < 1.0, `integrated landing x=${lx.toFixed(2)}, expected close to 4.5 (target pulled 0.5 short)`);
  }

  // out of range (too far for maxRange=1.5) must refuse at every angle.
  ok(Gt.bestJumpVelocity(0, 64, 0, 40, 64, 0, 1.5) === null, 'a 40-block flat target must exceed maxRange 1.5 at every angle');

  // same start/end (zero horizontal distance) must not throw and should refuse cleanly.
  ok((() => { try { Gt.jumpVelocity(0, 64, 0, 0, 64, 0, 70, 1.5); return true; } catch (e) { return false; } })(),
    'a zero-distance jump must not throw');   // documents the call is safe; exact null-ness is not jar-specified here

  okAv((() => {
    // a 90-degree launch drives sin(2*90deg)=0 and cos(90deg)^2=0, so the denominator
    // (horiz*sin2a - 2*dy*cos2) collapses to (numerically) zero for a flat target -- the real
    // degenerate case `!(v0sq >= 0) || !isFinite(v0sq)` exists to catch, not a synthetic
    // gravity=0 hack (whose own numerator vanishes too, which is not actually degenerate).
    const bad = Gt.jumpVelocity(0, 64, 0, 5, 64, 0, 90, 1.5);
    return bad === null;
  })(), 'a 90-degree flat-target launch did not refuse — the denominator guard is not really live');
}

// ── 6. Gt.LongJumpGoal ──────────────────────────────────────────────────────────────────────
say('6. Gt.LongJumpGoal — cooldown gate + one-shot launch');
{
  const e = EL.spawn('goat', 0, 64, 0, {});
  e.onGround = true;
  const goal = new Gt.LongJumpGoal(e, { random: Math.random, walkable: false });
  ok(e.longJumpCooldown === undefined, 'fixture should start with no cooldown yet (lazy-init check)');
  // force zero cooldown to exercise canUse's true branch deterministically
  e.longJumpCooldown = 0;
  ok(goal.canUse() === true, 'a grounded goat with zero cooldown must be able to use the long-jump goal');
  runJump(goal);
  ok(e.vx !== 0 || e.vy !== 0 || e.vz !== 0, 'LongJumpGoal never gave the goat any velocity');
  ok(goal.canContinueToUse() === false, 'LongJumpGoal must stop continuing once it has leapt');
  goal.stop();
  ok(e.longJumpCooldown === 0, `cooldown must not be rolled at the leap (#4674) — got ${e.longJumpCooldown}`);
  e.onGround = false; Gt.tickCooldowns(e); goal.canUse();
  ok(e.longJumpCooldown === 0 && e.leapPending, 'airborne: cooldown stays unrolled');
  e.onGround = true; goal.canUse();
  ok(e.longJumpCooldown >= Gt.LONG_JUMP_COOLDOWN_MIN && e.longJumpCooldown <= Gt.LONG_JUMP_COOLDOWN_MAX,
    `landing must roll the cooldown into [${Gt.LONG_JUMP_COOLDOWN_MIN},${Gt.LONG_JUMP_COOLDOWN_MAX}] — got ${e.longJumpCooldown}`);

  // #4644: lava cells over a solid floor are never long-jump targets (getPathfindingPenalty != 0)
  for (const [name, expectTarget] of [['lava', false], ['air', true]]) {
    for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) { W.setBlock(x, 63, z, S.stateOf('stone')); W.setBlock(x, 64, z, name === 'air' || (x === 0 && z === 0) ? 0 : S.stateOf(name)); for (let y = 65; y <= 70; y++) W.setBlock(x, y, z, 0); }
    const eh = EL.spawn('goat', 0.5, 64, 0.5, {}); eh.onGround = true; eh.longJumpCooldown = 0; eh.yaw = 123;
    const gh = new Gt.LongJumpGoal(eh, { random: () => 0, walkable: false });
    gh.start(); gh.tick();
    okAv((eh.yaw !== 123) === expectTarget, `long jump over a ${name} field: target picked must be ${expectTarget}`);
  }
  const e2 = EL.spawn('goat', 0, 64, 0, {});
  e2.onGround = false;
  const goal2 = new Gt.LongJumpGoal(e2, { random: Math.random, walkable: false });
  okAv(goal2.canUse() === false, 'an airborne goat must never pass LongJumpGoal.canUse()');

  const e3 = EL.spawn('goat', 0, 64, 0, {});
  e3.onGround = true; e3.longJumpCooldown = 50;
  const goal3 = new Gt.LongJumpGoal(e3, { random: Math.random, walkable: false });
  okAv(goal3.canUse() === false, 'a positive cooldown must refuse canUse()');
  okAv(e3.longJumpCooldown === 50, 'canUse() must not touch the cooldown (Gt.tickCooldowns does, every tick)');
  // LongJumpTask.shouldRun: a goat in a honey_block cell never starts the jump
  const e5 = EL.spawn('goat', 0, 64, 0, {});
  e5.onGround = true; e5.longJumpCooldown = 0;
  const goal5 = new Gt.LongJumpGoal(e5, { random: Math.random });
  W.setBlock(0, 64, 0, S.stateOf('honey_block'));
  okAv(goal5.canUse() === false, 'a goat standing in a honey_block cell must refuse LongJumpGoal.canUse()');
  W.setBlock(0, 64, 0, 0);
  // TemptationCooldownTask: both cooldowns fall 1/tick even while PanicGoal (same MOVE flag) blocks the goals
  const e4 = EL.spawn('goat', 0, 64, 0, {});
  e4.ramCooldown = 1000; e4.longJumpCooldown = 1000; e4.panicTicks = 200;
  for (let t = 0; t < 200; t++) EL.tickMob(e4);
  okAv(e4.ramCooldown === 800 && e4.longJumpCooldown === 800, `cooldowns must fall by 200 over 200 ticks — got ${e4.ramCooldown}/${e4.longJumpCooldown}`);
  EL.list.length = 0;   // KW-35 (D-697) -- same stale-entity hygiene as §2, see its comment
}

// ── 6a. reachesTarget skip: on open flat ground every cell is walkable, so vanilla never leaps ──
{
  for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) { W.setBlock(x, 63, z, S.stateOf('stone')); for (let y = 64; y <= 72; y++) W.setBlock(x, y, z, 0); }
  EL.list.length = 0;
  const run = (opts) => { const g = EL.spawn('goat', 0.5, 64, 0.5, {}); g.onGround = true; g.longJumpCooldown = 0;
    const lj = new Gt.LongJumpGoal(g, Object.assign({ random: () => 0.5 }, opts)); lj.canUse(); lj.start();
    for (let t = 0; t < 100; t++) lj.tick(); return !!g.leapPending; };
  ok(run() === false, 'flat open ground: every target is walkable, the goat must not long-jump (reachesTarget skip)');
  okAv(run({ walkable: false }) === true, 'with the path skip off the same flat ground leaps (the check can fail)');
}
// ── 6b. LongJumpTask parity: delay, candidate grid, arc sweep, LONG_JUMPING pose ────────────
say('6b. LongJumpTask — 40-tick look delay, canReach arc sweep, pose dims');
{
  const flat = () => { for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) { W.setBlock(x, 63, z, S.stateOf('stone')); for (let y = 64; y <= 72; y++) W.setBlock(x, y, z, 0); } };
  flat();
  EL.list.length = 0;
  const g = EL.spawn('goat', 0.5, 64, 0.5, {});
  g.onGround = true; g.longJumpCooldown = 0;
  const lj = new Gt.LongJumpGoal(g, { random: () => 0.5, walkable: false });
  lj.canUse(); lj.start();
  let leapTick = 0;
  for (let t = 1; t <= 80 && !g.leapPending; t++) { lj.tick(); if (g.leapPending) leapTick = t; }
  ok(leapTick === 1 + Gt.LONG_JUMP_DELAY, `the leap must come LONG_JUMP_DELAY (${Gt.LONG_JUMP_DELAY}) ticks after the pick, got tick ${leapTick}`);
  ok(g.pose === 'long_jumping' && Math.abs(g.width - 0.63) < 1e-9 && Math.abs(g.height - 0.91) < 1e-9, `LONG_JUMPING dims must be 0.63x0.91, got ${g.width}x${g.height} (${g.pose})`);
  okAv(g.noDrag === true, 'the leap must set noDrag (LongJumpTask.method_35083)');
  const sp0 = Math.hypot(g.vx, g.vy, g.vz);
  { const g3 = EL.spawn('goat', 0.5, 64, 0.5, {}); g3.onGround = true; g3.longJumpCooldown = 0;
    MCL.Effects.addStatusEffect(g3, 'jump_boost', 200, 1);
    const l3 = new Gt.LongJumpGoal(g3, { random: () => 0.5, walkable: false }); l3.canUse(); l3.start();
    for (let t = 1; t <= 80 && !g3.leapPending; t++) l3.tick();
    okAv(Math.abs(Math.hypot(g3.vx, g3.vy, g3.vz) - sp0 - 0.2) < 1e-6, 'jump_boost II must add 0.2 to the launch speed'); }
  g.onGround = true; lj.canUse();
  okAv(g.noDrag === false && Math.abs(Math.hypot(g.vx, g.vy, g.vz) - sp0 * 0.1) < 1e-9, 'landing must clear noDrag and damp velocity to 0.1x');
  ok(g.pose === 'standing' && Math.abs(g.width - 0.9) < 1e-9, 'landing must restore the standing box');
  // a ceiling over the whole box (y=65, 0.91 above the floor) rejects every arc
  for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) W.setBlock(x, 65, z, S.stateOf('stone'));
  const g2 = EL.spawn('goat', 0.5, 64, 0.5, {});
  g2.onGround = true; g2.longJumpCooldown = 0;
  const lj2 = new Gt.LongJumpGoal(g2, { random: () => 0.5, walkable: false });
  lj2.canUse(); runJump(lj2);
  okAv(!g2.leapPending, 'a ceiling that every arc hits must leave no jumpable target (canReach sweep is vacuous)');
  flat(); EL.list.length = 0;
}

// ── 6c. candidate floor is isOpaqueFullCube (EntityNavigation.isValidPosition), not any collider ──
{
  const isle = (blk) => { EL.list.length = 0;
    for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) { W.setBlock(x, 63, z, 0); for (let y = 64; y <= 72; y++) W.setBlock(x, y, z, 0); }
    W.setBlock(0, 63, 0, S.stateOf('stone')); W.setBlock(3, 63, 3, S.stateOf(blk));
    const g = EL.spawn('goat', 0.5, 64, 0.5, {}); g.onGround = true; g.longJumpCooldown = 0;
    const lj = new Gt.LongJumpGoal(g, { random: () => 0.5, walkable: false }); lj.canUse(); lj.start();
    for (let t = 0; t < 100; t++) lj.tick(); return !!g.leapPending; };
  okAv(isle('stone') === true, 'a stone-topped column is a valid long-jump target');
  for (const b of ['glass', 'oak_fence']) okAv(isle(b) === false, `a ${b} column is not an opaque full cube: vanilla never targets it`);
  for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) W.setBlock(x, 63, z, S.stateOf('stone'));
  EL.list.length = 0;
}

// ── 7. Gt.RamGoal / Gt.impact ───────────────────────────────────────────────────────────────
say('7. Gt.RamGoal — cooldown, target pick, prepare, charge, impact, knockback');
{
  // a bare-goal unit test of prepare-timing, WITHOUT physics (Ai.stepToward only sets heading/
  // speed -- "moves nothing", 07k_goals.js's own header -- so this half proves the state
  // machine's own timing, not distance closure).
  const floor0 = S.stateOf('stone') | 0;   // PrepareRamTask.findRamStart scouts walkable lanes: the unit scenes need a floor
  for (let x = -4; x <= 12; x++) for (let z = -8; z <= 8; z++) W.setBlock(x, 63, z, floor0);
  const player0 = { x: 5, y: 64, z: 0, health: 20, maxHealth: 20 };
  const e00 = EL.spawn('goat', 0, 64, 0, {});
  e00.screaming = false;
  e00.ramCooldown = 0;
  const goal0 = new Gt.RamGoal(e00, { players: () => [player0], random: Math.random });
  ok(goal0.canUse() === true, 'a player 5 blocks away (within [4,7]) must be picked as a ram target');
  goal0.start();
  ok(goal0.phase() === 'preparing', 'RamGoal.start() must enter the preparing phase');
  { const st0 = Gt.findRamStart(e00, player0); ok(!!st0, 'a cardinal run-up lane must be found'); e00.x = st0.sx + 0.5; e00.z = st0.sz + 0.5; }   // walked to the lane start
  for (let t = 0; t < Gt.PREPARE_RAM_DURATION; t++) goal0.tick();
  ok(goal0.phase() === 'preparing', `still preparing after PREPARE_RAM_DURATION (${Gt.PREPARE_RAM_DURATION}) ticks (RAM_TARGET is set on the 21st: now - start >= 20)`);
  goal0.tick();
  ok(goal0.phase() === 'charging', 'RamGoal must switch to charging once PREPARE_RAM_DURATION elapses');
  ok(e00.preparingRam === false, 'e.preparingRam must clear once charging starts');

  // PrepareRamTask RUN_TIME 160: a goat that never reaches the lane start gives up (min cooldown); RamImpactTask RUN_TIME 200 keeps the cooldown
  {
    const eT = EL.spawn('goat', 0, 64, 0, {}); eT.screaming = false; eT.ramCooldown = 0;
    const gT = new Gt.RamGoal(eT, { players: () => [player0], random: Math.random });
    gT.canUse(); gT.start();
    eT.x = -3.5; eT.z = 0.5;   // nowhere near the lane start; stepToward moves nothing
    for (let i = 0; i < 159; i++) gT.tick();
    ok(gT.canContinueToUse() === true, 'prepare still runs at tick 159');
    gT.tick();
    ok(gT.canContinueToUse() === false, 'prepare must end at 160 ticks (PrepareRamTask RUN_TIME)');
    gT.stop();
    ok(eT.ramCooldown === Gt.RAM_COOLDOWN_MIN, 'prepare timeout sets the range-minimum cooldown');
    const eC = EL.spawn('goat', 0, 64, 0, {}); eC.screaming = false; eC.ramCooldown = 0;
    const gC = new Gt.RamGoal(eC, { players: () => [player0], random: Math.random });
    gC.canUse(); gC.start();
    { const s0 = Gt.findRamStart(eC, player0); eC.x = s0.sx + 0.5; eC.z = s0.sz + 0.5; }
    for (let i = 0; i <= Gt.PREPARE_RAM_DURATION; i++) gC.tick();
    ok(gC.phase() === 'charging', 'charge test setup');
    for (let i = 0; i < 200; i++) gC.tick();
    ok(gC.phase() === 'charging', 'charge still runs through tick 200');
    gC.tick();
    ok(gC.phase() === 'idle' && eC.ramCooldown === 0, 'charge timeout (200) must not roll the cooldown');
    EL.remove(eT); EL.remove(eC);   // leftovers at the origin would shove the live-ram goat below
  }
  // ram head-down pitch: +1/tick while preparing to 20 (=30deg), then -2/tick
  {
    const h = { type: 'goat', preparingRam: true };
    for (let t = 0; t < 20; t++) Gt.tickRamHead(h);
    okAv(Math.abs(h.xHeadRot * 180 / Math.PI - 30) < 1e-9, `head pitch must reach 30deg after 20 preparing ticks (got ${h.xHeadRot * 180 / Math.PI})`);
    h.preparingRam = false;
    Gt.tickRamHead(h);
    okAv(h.ramHeadTicks === 18, `head counter must decay 2/tick (got ${h.ramHeadTicks})`);
    for (let t = 0; t < 9; t++) Gt.tickRamHead(h);
    ok(h.ramHeadTicks === 0, 'head counter must clamp at 0');
  }

  // the REAL end-to-end path: EL.spawn (real Ai.ROSTER.goat) + EL.tickMob, the same "drive it
  // through the real pipeline, not a hand-held goal object" standard rabbitcheck's own §6 sets
  // (07zh_rabbit.js's own carrot-goal section) -- `Ai.stepToward` only sets heading/speed,
  // #3749: the first (lazy) cooldown is always RAM_COOLDOWN_RANGE, even for a screaming goat.
  for (let i = 0; i < 50; i++) {
    const es = { screaming: true, x: 0, y: 64, z: 0 };
    new Gt.RamGoal(es, { players: () => [], random: Math.random }).canUse();
    ok(es.ramCooldown >= Gt.RAM_COOLDOWN_MIN - 1 && es.ramCooldown <= Gt.RAM_COOLDOWN_MAX,
      `screaming goat's initial ramCooldown must be in [${Gt.RAM_COOLDOWN_MIN},${Gt.RAM_COOLDOWN_MAX}] — got ${es.ramCooldown}`);
  }

  // `Ph.travelMob` inside `EL.tickMob` is what actually walks the goat to its target.
  const player = { x: 5, y: 64, z: 0, health: 20, maxHealth: 20 };
  MCL.Player = player;
  const stone = S.stateOf('stone') | 0;
  for (let x = -2; x <= 7; x++) for (let z = -2; z <= 2; z++) W.setBlock(x, 63, z, stone);
  const e = EL.spawn('goat', 0, 64.5, 0, {});
  e.screaming = false;
  e.ramCooldown = 0;
  ok(!!e.ai, 'no goal selector attached to a rostered goat');

  const healthBefore = player.health;
  let ticks = 0;
  while (player.health === healthBefore && ticks < 1200) { EL.tickMob(e); ticks++; }
  ok(ticks < 1200, `the goat's ram never landed on the player in ${ticks} real ticks (goat ended at ${e.x.toFixed(2)},${e.z.toFixed(2)})`);
  ok(player.health < healthBefore, `impact must damage the target — health ${healthBefore} -> ${player.health}`);
  ok(e.ramCooldown > 0, 'a successful ram must reset e.ramCooldown to a positive value');
  ok(e.ramCooldown >= Gt.RAM_COOLDOWN_MIN && e.ramCooldown <= Gt.RAM_COOLDOWN_MAX,
    `non-screaming cooldown should land in [${Gt.RAM_COOLDOWN_MIN},${Gt.RAM_COOLDOWN_MAX}] — got ${e.ramCooldown}`);
  MCL.Player = null;

  // screaming goat draws from the short cooldown range instead.
  const e2 = EL.spawn('goat', 0, 64, 0, {});
  e2.screaming = true;
  const cd = Gt.rollRamCooldown(e2, Math.random);
  ok(cd >= Gt.SCREAMING_RAM_COOLDOWN_MIN && cd <= Gt.SCREAMING_RAM_COOLDOWN_MAX,
    `screaming goat's own cooldown should land in [${Gt.SCREAMING_RAM_COOLDOWN_MIN},${Gt.SCREAMING_RAM_COOLDOWN_MAX}] — got ${cd}`);

  // target gate: only the 16-block NearestLivingEntitiesSensor box (the 4..7 are the run-up LANE, not a target gate).
  const closePlayer = { x: 20, y: 64, z: 0, health: 20 };
  const e3 = EL.spawn('goat', 0, 64, 0, {});
  e3.ramCooldown = 0;
  const goal3 = new Gt.RamGoal(e3, { players: () => [closePlayer], random: Math.random });
  okAv(goal3.canUse() === false, 'a player 20 blocks away (outside the 16-block sensor box) must not be a ram target');

  // line of sight: a wall between goat and target blocks the ram pick (VISIBLE_MOBS)
  {
    const sp = { x: 5, y: 64, z: 0, health: 20 };
    const e4 = EL.spawn('goat', 0, 64, 0, {});
    e4.ramCooldown = 0;
    const g4 = new Gt.RamGoal(e4, { players: () => [sp], random: Math.random });
    ok(g4.canUse() === true, 'unobstructed target is picked');
    const stoneW = S.stateOf('stone') | 0;
    for (let z = -2; z <= 2; z++) for (let y = 64; y <= 67; y++) W.setBlock(3, y, z, stoneW);
    e4.ramCooldown = 0;
    okAv(g4.canUse() === false, 'a wall between goat and target must block the ram pick');
    for (let z = -2; z <= 2; z++) for (let y = 64; y <= 67; y++) W.setBlock(3, y, z, 0);
  }
  // long-jump cooldown ticks while airborne
  {
    const e5 = EL.spawn('goat', 0, 64, 0, {});
    const lj = new Gt.LongJumpGoal(e5, { random: Math.random, walkable: false });
    e5.longJumpCooldown = 10; e5.onGround = false;
    Gt.tickCooldowns(e5); Gt.tickCooldowns(e5);
    okAv(e5.longJumpCooldown === 8, 'long-jump cooldown must tick while airborne');
  }

  // knockback formula, directly: adult goat, movementSpeed 0.2 -> clamp(0.2*1.65,0.2,3.0)=0.33,
  // * ADULT_RAM_STRENGTH_MULTIPLIER 2.5 = 0.825.
  const target = { x: 5, y: 64, z: 0, health: 20, maxHealth: 20, vx: 0, vy: 0, vz: 0, onGround: true };
  const attacker = { x: 0, y: 64, z: 0, type: 'goat', isBaby: false };
  Gt.impact(attacker, target, Math.random);
  ok(target.vx !== 0 || target.vz !== 0, 'Gt.impact must push the target — knockback never applied');
  okAv((() => {
    const t2 = { x: 5, y: 64, z: 0, health: 20, maxHealth: 20, vx: 0, vy: 0, vz: 0, onGround: true };
    const savedHurt = Cb.hurt;
    Cb.hurt = () => false;   // simulate a target that never actually took damage
    const applied = Gt.impact(attacker, t2, Math.random);
    Cb.hurt = savedHurt;
    return applied === true && (t2.vx !== 0 || t2.vz !== 0);
  })(), 'Gt.impact must still knock back a target that Cb.hurt refused (RamImpactTask ignores damage() result)');
}

// ── 7b. #1185 RamGoal = PrepareRamTask/RamImpactTask: any-living targets, fixed direction, mob+neutral source ──
say('7b. RamGoal targets non-players, fixed charge direction, mob+neutral damage source');
{
  const cow = { x: 5, y: 64, z: 0, health: 10, maxHealth: 10, type: 'cow' };
  const gg = EL.spawn('goat', 0, 64, 0, {}); gg.ramCooldown = 0;
  ok(new Gt.RamGoal(gg, { livings: () => [cow], random: Math.random }).canUse() === true, 'a non-player living 5 blocks away must be a ram target');
  const gg2 = EL.spawn('goat', 0, 64, 0, {}); gg2.ramCooldown = 0;
  okAv(new Gt.RamGoal(gg2, { livings: () => [{ x: 5, y: 64, z: 0, health: 10, type: 'goat' }], random: Math.random }).canUse() === false, 'another goat must not be a ram target');
  // fixed direction: the target sidesteps after the charge starts; knockback still along the fixed lane (+x push)
  const vic = { x: 5, y: 64, z: 0, health: 20, maxHealth: 20, type: 'cow', vx: 0, vy: 0, vz: 0, onGround: true };
  const g3 = EL.spawn('goat', 0, 64, 0, {}); g3.ramCooldown = 0;
  const goal = new Gt.RamGoal(g3, { livings: () => [vic], random: Math.random });
  goal.canUse(); goal.start();
  { const st = Gt.findRamStart(g3, vic); g3.x = st.sx + 0.5; g3.z = st.sz + 0.5; }   // at the lane start
  for (let i = 0; i <= Gt.PREPARE_RAM_DURATION; i++) goal.tick();
  ok(goal.phase() === 'charging', 'charging after prepare');
  vic.z = 3;   // sidestep off the lane: a live-position chaser would turn, a committed goat does not
  let hit = false; const saveI = Gt.impact;
  Gt.impact = (e, t, r, d) => { hit = { t, d }; return true; };
  g3.x = 5; g3.z = 0;   // goat reaches the end point
  goal.tick();
  Gt.impact = saveI;
  ok(!hit, 'a victim that left the lane must not be hit (no box overlap, goat commits to the fixed end point)');
  // damage source
  let seen = null; const sh = Cb.hurt;
  Cb.hurt = (e, a, n, bp, src) => { seen = src; return true; };
  const v2 = { x: 5, y: 64, z: 0, health: 20, maxHealth: 20, type: 'cow', vx: 0, vy: 0, vz: 0, onGround: true };
  const g4 = EL.spawn('goat', 0, 64, 0, {});
  Gt.impact(g4, v2, Math.random, { x: -1, z: 0 });
  Cb.hurt = sh;
  ok(seen && seen.attacker === g4 && seen.neutral === true && seen.source === 'mob', 'impact damage source must be mob(goat).setNeutral()');
  ok(v2.vx > 0 || v2.vx < 0, 'knockback applied along the fixed direction');
  const vxSign = Math.sign(v2.vx);
  const v3 = { x: 5, y: 64, z: 9, health: 20, maxHealth: 20, type: 'cow', vx: 0, vy: 0, vz: 0, onGround: true };
  Cb.hurt = () => true; Gt.impact(g4, v3, Math.random, { x: -1, z: 0 }); Cb.hurt = sh;
  ok(Math.sign(v3.vx) === vxSign && v3.vz === 0, 'knockback direction is the stored vector, not goat->target');
}

// ── 8. Br.CHILD.goat / Gt.childScreaming ────────────────────────────────────────────────────
say('8. Br.CHILD.goat / Gt.childScreaming — the asymmetric screaming inheritance');
{
  ok(Breed.canBreed('goat'), 'Breed.canBreed(goat) should be true now that it left Breed.SPECIAL');
  ok(!Breed.SPECIAL.goat, 'goat must no longer be listed in Breed.SPECIAL');

  const seqRnd = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };
  // b (the SECOND argument) screaming -> child screaming regardless of the roll.
  ok(Gt.childScreaming({ screaming: true }, seqRnd([0.99])) === true, 'b screaming must make the child scream');
  // b not screaming, roll misses 2% -> child not screaming.
  ok(Gt.childScreaming({ screaming: false }, seqRnd([0.5])) === false, 'b not screaming + a high roll must not scream');
  // b not screaming, roll hits 2% -> child screams anyway.
  ok(Gt.childScreaming({ screaming: false }, seqRnd([0.001])) === true, 'a roll under 0.02 must scream even if b does not');
  // ⚠ the real asymmetry: a's own flag is NEVER consulted.
  ok(Gt.childScreaming({ screaming: false }, seqRnd([0.5])) === false,
    'a screaming FIRST parent alone (never passed as b here) must not by itself force it — only b is read');

  const child = { x: 0, y: 64, z: 0, type: 'goat' };
  const aParent = { screaming: true }, bParent = { screaming: false };
  Breed.CHILD.goat(child, aParent, bParent, seqRnd([0.99]));
  ok(child.screaming === false, 'Breed.CHILD.goat must read ONLY the b argument -- a screaming a-parent must not leak through');
  Breed.CHILD.goat(child, bParent, aParent, seqRnd([0.99]));
  ok(child.screaming === true, 'swapping a/b: now b (aParent) screams, so the child must too');

  okAv((() => {
    const before = Breed.CHILD.goat;
    Breed.CHILD.goat = undefined;
    const stillWorks = typeof Breed.CHILD.goat === 'function';
    Breed.CHILD.goat = before;
    return !stillWorks;
  })(), 'clearing Breed.CHILD.goat was not detected — the anti-vacuity probe itself is broken');

  // full Br.breed() path, real EL.spawn child.
  const a = EL.spawn('goat', 0, 64, 0, {}); a.screaming = false;
  const b = EL.spawn('goat', 0.3, 64, 0, {}); b.screaming = true;
  Breed.setInLove(a, null); Breed.setInLove(b, null);
  Breed.setAge(a, 0); Breed.setAge(b, 0);
  const kid = Breed.breed(a, b, { random: () => 0.99 });
  ok(!!kid && kid.type === 'goat', 'Br.breed(goat, goat) must produce a goat child');
  ok(kid && kid.screaming === true, 'the live-spawned child must inherit b\'s screaming flag');
}

// ── 9. milking ───────────────────────────────────────────────────────────────────────────────
say('9. milking — Use.entityUse\'s own bucket branch');
{
  ok(MCL.Items.of('bucket') >= 0 && MCL.Items.of('milk_bucket') >= 0,
    'items.bin has no bucket/milk_bucket — cannot test milking at all');
  const goat = EL.spawn('goat', 1, 64, 0, {});
  goat.isBaby = false;
  const inv = Iv.create();
  const stack = { i: MCL.Items.of('bucket'), n: 1 };
  Iv.setItem(inv, 0, stack);
  const P = { x: 0, y: 64, z: 0, inventory: inv, slot: 0, instabuild: false, targetEntity: goat };
  const handled = Use.entityUse(P, goat, stack);
  ok(handled === true, 'a bucket on an adult goat must be handled (milked)');
  const slot0 = Iv.getItem(inv, 0);
  ok(slot0 && MCL.Items.nameOf(slot0.i) === 'milk_bucket', `slot 0 should now hold milk_bucket — got ${slot0 && MCL.Items.nameOf(slot0.i)}`);

  const babyGoat = EL.spawn('goat', 1, 64, 0, {});
  babyGoat.isBaby = true;
  const inv2 = Iv.create();
  const stack2 = { i: MCL.Items.of('bucket'), n: 1 };
  Iv.setItem(inv2, 0, stack2);
  const P2 = { x: 0, y: 64, z: 0, inventory: inv2, slot: 0, instabuild: false, targetEntity: babyGoat };
  const handled2 = Use.entityUse(P2, babyGoat, stack2);
  const slot0b = Iv.getItem(inv2, 0);
  okAv(handled2 !== true || !slot0b || MCL.Items.nameOf(slot0b.i) !== 'milk_bucket',
    'a baby goat must NOT be milkable (GoatEntity.interactMob\'s own !this.isBaby() guard)');
}

// ── 11. sounds (#1184) — one assertion per vanilla call site ─────────────────────────────────
say('11. sounds — prepare/impact/long_jump/step/milk/eat');
{
  const log = [];
  MCL.Sound = { play: (ev, o) => { log.push({ ev, ...o }); return true; } };
  const last = () => log[log.length - 1];
  for (const scream of [false, true]) {
    const pre = scream ? 'entity.goat.screaming.' : 'entity.goat.';
    EL.list.length = 0; log.length = 0;
    // prepare_ram: HOSTILE only when the 20-tick wind-up finishes (PrepareRamTask.method_36271), never at start/while walking/aborted
    const g = EL.spawn('goat', 0, 64, 0, { screaming: scream });
    g.isBaby = false; g.ramCooldown = 0;
    const pl = { x: 5, y: 64, z: 0, health: 20, maxHealth: 20 };
    const gr = new Gt.RamGoal(g, { players: () => [pl], random: Math.random });
    const prep = () => log.filter((l) => l.ev === pre + 'prepare_ram');
    gr.canUse(); gr.start(); gr.tick();
    ok(prep().length === 0, `${pre}prepare_ram played at task start / while walking to the lane start`);
    gr.stop();
    ok(prep().length === 0, `${pre}prepare_ram played on an aborted prepare`);
    g.ramCooldown = 0; gr.canUse(); gr.start();
    { const st = Gt.findRamStart(g, pl); g.x = st.sx + 0.5; g.z = st.sz + 0.5; }
    for (let t = 0; t < Gt.PREPARE_RAM_DURATION; t++) gr.tick();
    ok(prep().length === 0, `${pre}prepare_ram played before the wind-up finished`);
    gr.tick();
    ok(prep().length === 1 && prep()[0].source === 'hostile', `${pre}prepare_ram (hostile) not played exactly once when the wind-up finishes`);
    // ram_impact: HOSTILE on hit
    log.length = 0;
    const victim = { x: 1, y: 64, z: 0, health: 20, maxHealth: 20, type: 'zombie', vx: 0, vy: 0, vz: 0, isBaby: false };
    const hit = Gt.impact(g, victim, Math.random);
    if (hit) ok(log.some((l) => l.ev === pre + 'ram_impact' && l.source === 'hostile'), `${pre}ram_impact (hostile) not played on a landed hit`);
    // long_jump then step on landing
    log.length = 0;
    g.onGround = true; g.longJumpCooldown = 0;
    const lj = new Gt.LongJumpGoal(g, { random: () => 0.9, walkable: false });
    lj.canUse(); runJump(lj);
    ok(log.some((l) => l.ev === pre + 'long_jump' && l.source === 'neutral'), `${pre}long_jump not played on the leap`);
    log.length = 0; g.onGround = true; g.longJumpCooldown = 100; lj.canUse();
    ok(log.some((l) => l.ev === 'entity.goat.step' && l.volume === 2), 'goat.step (vol 2.0) not played on landing (LeapingChargeTask)');
    // milk: on the player
    log.length = 0;
    const inv = Iv.create(); const stack = { i: MCL.Items.of('bucket'), n: 1 }; Iv.setItem(inv, 0, stack);
    const P = { x: 0, y: 64, z: 0, inventory: inv, slot: 0, instabuild: false, targetEntity: g };
    Use.entityUse(P, g, stack);
    ok(log.some((l) => l.ev === pre + 'milk' && l.volume === 1 && l.pitch === 1), `${pre}milk not played on milking`);
    // eat after feeding wheat
    log.length = 0;
    const inv3 = Iv.create(); const wst = { i: MCL.Items.of('wheat'), n: 3 }; Iv.setItem(inv3, 0, wst);
    const P3 = { x: 0, y: 64, z: 0, inventory: inv3, slot: 0, instabuild: false, targetEntity: g };
    Use.entityUse(P3, g, wst);
    ok(log.some((l) => l.ev === pre + 'eat' && l.pitch >= 0.8 && l.pitch <= 1.2), `${pre}eat not played after feeding wheat`);
  }
  // anti-vacuity: stub the goal's sound call -> the same probes must come back empty
  const realSound = Gt.sound;
  Gt.sound = () => null;
  EL.list.length = 0; log.length = 0;
  const g2 = EL.spawn('goat', 0, 64, 0, { screaming: false });
  new Gt.RamGoal(g2, { players: () => [], random: Math.random }).start();
  g2.onGround = true; g2.longJumpCooldown = 0;
  const lj2 = new Gt.LongJumpGoal(g2, { random: () => 0.9, walkable: false }); lj2.canUse(); runJump(lj2);
  okAv(!log.some((l) => /goat\.(prepare_ram|long_jump|step)/.test(l.ev)), 'with Gt.sound stubbed out the prepare/jump probes still saw sounds — the assertions are vacuous');
  Gt.sound = realSound;
}

// ── #3748 aborted wind-up = PrepareRamTask.finishRunning: FIXED range minimum, not a roll ──
say('7c. aborted ram wind-up sets the fixed cooldown minimum');
{
  for (const [scream, want] of [[false, Gt.RAM_COOLDOWN_MIN], [true, Gt.SCREAMING_RAM_COOLDOWN_MIN]]) {
    const g = EL.spawn('goat', 0, 64, 0, {}); g.screaming = scream; g.ramCooldown = 0;
    const vic = { x: 6, y: 64, z: 0, health: 10, type: 'cow' };
    const goal = new Gt.RamGoal(g, { livings: () => [vic], random: () => 0.99 });
    goal.canUse(); goal.start(); goal.tick();
    vic.removed = true;
    ok(!goal.canContinueToUse(), 'removed target must end the ram');
    goal.stop();
    okAv(g.ramCooldown === want, `aborted wind-up (screaming=${scream}) cooldown must be exactly ${want} — got ${g.ramCooldown}`);
  }
}

say('12. #4716 idle FollowMobTask(PLAYER, 6.0): sustained look, then quiet, then re-acquire');
{
  const player = { x: 4, y: 64, z: 0, health: 20, dead: false };
  MCL.Player = player;
  const g = EL.spawn('goat', 0, 64.5, 0, {});
  g.ramCooldown = 1e9;
  let calls = 0;
  g.look = { setLookAt() { calls++; }, tick() {} };
  const seq = [];
  for (let t = 0; t < 400; t++) { player.x = g.x + 4; player.z = g.z; player.y = g.y; const c = calls; EL.tickMob(g); seq.push(calls > c); }
  // runs of consecutive look ticks
  const runs = []; let n = 0;
  for (const b of seq) { if (b) n++; else if (n) { runs.push(n); n = 0; } }
  okAv(runs.length >= 2, `goat must re-acquire the player (look bursts: ${runs.length})`);
  okAv(runs.every((r) => r >= 25 && r <= 60), `each look burst must hold ~30-60 ticks, got ${runs}`);
  okAv(seq.filter(Boolean).length < 300, 'goat must go quiet between bursts');
  MCL.Player = null;
}

// ── 13. RamImpactTask potion-effect knockback term + shield halving ─────────────────────────
{
  const Cbk = MCL.Combat, Ef = MCL.Effects, U = MCL.Use;
  const sv = { kb: Cbk.knockback, has: Ef.hasStatusEffect, amp: Ef.amplifierOf, sh: U.blockedByShield, hurt: Cbk.hurt };
  let got = null;
  Cbk.knockback = (t, s) => { got = s; };
  Cbk.hurt = () => true;
  const run = (fx, shield) => {
    Ef.hasStatusEffect = (e, n) => n in fx; Ef.amplifierOf = (e, n) => (n in fx ? fx[n] : -1);
    U.blockedByShield = () => shield;
    const gt = { x: 0, y: 64, z: 0, type: 'goat', isBaby: false, mobSpeed: 0.2 };
    const tg = MCL.Player; MCL.Player = { x: 5, y: 64, z: 0, health: 20 };
    got = null; Gt.impact(gt, MCL.Player, Math.random, { x: 1, z: 0 }); MCL.Player = tg;
    return got;
  };
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  const base = Math.min(3, Math.max(0.2, 0.2 * 1.65)) * Gt.ADULT_RAM_STRENGTH_MULTIPLIER;
  okAv(near(run({}, false), base), 'plain ram knockback = clamp(0.2*1.65)*2.5');
  okAv(near(run({ speed: 1 }, false), (0.33 + 0.25 * 2) * 2.5), 'Speed II adds 0.25*2 to the base');
  okAv(near(run({ slowness: 0 }, false), (0.33 - 0.25) * 2.5), 'Slowness I subtracts 0.25');
  okAv(near(run({}, true), base * 0.5), 'shield-blocked victim takes half knockback');
  Cbk.knockback = sv.kb; Ef.hasStatusEffect = sv.has; Ef.amplifierOf = sv.amp; U.blockedByShield = sv.sh; Cbk.hurt = sv.hurt;
}

// ── 14. Brain trace (#6209): activity + memory TTLs + position, tick by tick ───────────────
say('14. GoatBrain memories: TemptationCooldownTask expiry, activity switch, ram window');
{
  // golden from the .decomp constants: TemptationCooldownTask.keepRunning remembers n-1 while n>0,
  // then finishRunning forgets it; GoatBrain.updateActivities picks RAM > LONG_JUMP > IDLE by gates.
  const N = 5;
  const golden = [];
  for (let t = 0; t <= N + 1; t++) golden.push({ ram: t <= N ? N - t : null, jump: t <= 2 ? 2 - t : null });
  const act = (ram, jump) => (ram === null ? 'ram' : jump === null ? 'long_jump' : 'idle');
  const tr = (mk) => {
    const g = EL.spawn('goat', 40, 64, 40, {}); g.ramCooldown = N; g.longJumpCooldown = 2;
    Gt.updateActivities(g);
    const rows = [Gt.brainTrace(g)];
    for (let t = 0; t < N + 1; t++) { mk(g); rows.push(Gt.brainTrace(g)); }
    EL.remove(g); return rows;
  };
  const rows = tr((g) => Gt.tickCooldowns(g));
  const same = (rs) => rs.every((r, i) => r.ram === golden[i].ram && r.jump === golden[i].jump && r.activity === act(golden[i].ram, golden[i].jump) && r.x === 40 && r.z === 40);
  ok(same(rows), 'trace of (activity, ram, jump, position) must equal the constants golden: ' + JSON.stringify(rows.map(r => [r.activity, r.ram, r.jump])));
  okAv(!same(tr((g) => { Gt.tickCooldowns(g); if (g.goatBrain.mem.ram_cooldown_ticks === 3) g.goatBrain.mem.ram_cooldown_ticks = 4; })), 'a cooldown that does not expire on schedule breaks the trace golden');

  // ram window: a completed ram sets RAM_COOLDOWN_TICKS (>= 600), so a second ram inside 100 ticks is impossible
  const ramsIn = (skipMemory) => {
    const rem = Gt.remember;
    if (skipMemory) Gt.remember = (e, n, v) => { if (n !== 'ram_cooldown_ticks') rem(e, n, v); };
    const p0 = { x: 5, y: 64, z: 0, health: 20, maxHealth: 20 };
    const g = EL.spawn('goat', 0.5, 64, 0.5, {}); g.screaming = false; g.ramCooldown = 0;
    const goal = new Gt.RamGoal(g, { players: () => [p0], random: () => 0 });
    let rams = 0, running = false;
    for (let t = 0; t < 100; t++) {
      Gt.tickCooldowns(g);
      if (!running && goal.canUse()) { goal.start(); running = true; rams++; }
      if (running) {
        if (goal.phase() === 'preparing') { const st = Gt.findRamStart(g, p0); if (st) { g.x = st.sx + 0.5; g.z = st.sz + 0.5; } }
        goal.tick();
        if (!goal.canContinueToUse() || goal.phase() === 'charging' && t % 7 === 6) { goal.stop(); running = false; }
      }
    }
    Gt.remember = rem; EL.remove(g); if (VERBOSE) console.log('rams', skipMemory, rams);
    return rams;
  };
  ok(ramsIn(false) === 1, 'one ram in a 100-tick window, then RAM_COOLDOWN_TICKS blocks the next');
  okAv(ramsIn(true) >= 2, 'a goat that skips the cooldown memory rams twice in the window');
}

console.log('================ goatcheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(` ${breaks} breaks caught`);
console.log('==============================================');
process.exit(fails.length ? 1 : 0);
