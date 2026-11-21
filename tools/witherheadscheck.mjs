#!/usr/bin/env node
// witherheadscheck.mjs — QUEUE 0.00 part 2 (Wi.OWED item 1, D-796): the WITHER's two SIDE
// heads' own independent skull attacks (src/07zzm_wither.js's `Wi.sideHeadsTick`, reusing the
// existing `Wi.SKULL_*`/`Wi.shootSkullAt` machinery `witherattackcheck.mjs` already covers for
// the center head). Non-browser (game-logic only), same precedent witherattackcheck.mjs/
// witherattackcheck.mjs's own header already set (state-level, no rendering needed to verify
// AI + projectile spawn behaviour).
//
//   node tools/witherheadscheck.mjs [--verbose]
//
// Sections:
//   1. a side head acquires a tracked target within its own search window and fires at it
//      within one interval, independently of the center head's own ProjectileAttackGoal
//   2. the two side head slots are independent: each keeps its own cooldown/target
//   3. renderer fields (`e.witherSideYawRel`/`e.witherSidePitch`) are populated and swing
//      toward a tracked target
//   4. re-check gate: an out-of-range/hidden tracked target is dropped, not fired at
//   5. anti-vacuity: the pre-unit `Wi.tickMovement` (no `Wi.sideHeadsTick` call) never fires a
//      side-head skull across many ticks; the real one does
//   6. anti-vacuity: zeroing `SIDE_HEAD_REFIRE_RANGE_SQ` changes whether a far tracked target
//      still gets fired at (a probe with nothing downstream able to reconverge the difference)

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
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('  ✓ break caught: ' + m.slice(0, 60)); };
const say = (s) => { if (VERBOSE) console.log(s); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

console.log('witherheadscheck — QUEUE 0.00 (D-796): the wither’s two side heads’ own skull attacks');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
  '07e_loot.js', '07h_entities.js', '14b_physics.js', '14c_raycast.js', '09b_sky.js',
  '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js', '14j_combat.js',
  '07q_effects.js', '07t_fly.js', '07za_explosion.js', '07zw_mobnbt.js', '07zzh_blaze.js',
  '07zf_bat.js', '07zzi_ghast.js', '07zzm_wither.js', '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js'];
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
ok(typeof Wi.sideHeadsTick === 'function', 'Wi.sideHeadsTick exists (the mobTick+tickMovement port)');
ok(typeof Wi.shootSkullAt === 'function', 'Wi.shootSkullAt exists (the shared spawn path)');

function freshWorld() {
  W.init(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
    const c = W.makeChunk(cx, cz);
    c.state = CH.GENERATED;
    W.chunks.set(W.key(cx, cz), c);
  }
  EL.init();
}
function spawn(type, x, y, z, opts) { return EL.spawn(type, x, y, z, opts); }
function mkPlayer(x, y, z) {
  return { type: 'player', x, y, z, health: 20, maxHealth: 20, height: 1.8,
    vx: 0, vy: 0, vz: 0, knockbackResistance: 0, invulnerableTime: 0, hurtTime: 0, armor: 0, armorToughness: 0 };
}
// `EL.aiCtx(e).players()` reads `NS.Player` directly (07i_entitylist.js), not `EL.list` -- every
// acquisition-search section below sets `MCL.Player` for that reason (the SAME convention
// aicheck.mjs/arrowphysicscheck.mjs/combatcheck.mjs already use), restoring it after.

function skullCount() { return EL.list.filter((e) => e.type === 'wither_skull').length; }
function spawnWither(x, y, z) {
  const w = spawn('wither', x, y, z);
  w.ai = null;   // this file's own §1-4 drive Wi.tickMovement directly, not the goal selector
  return w;
}

Diff.set('normal');

// ═════════════ 1. a side head acquires and fires at a target within one window ═══════════════
{
  say('\n§1 a side head acquires + fires within one window');
  freshWorld();
  const w = spawnWither(0.5, 70, 0.5);
  const plr = mkPlayer(5.5, 70, 0.5);   // well within the real 20-block HEAD_TARGET_PREDICATE range
  MCL.Player = plr;
  ok(w.sideHeadTarget[0] === null && w.sideHeadTarget[1] === null, 'precondition: neither side head has a tracked target yet');
  const before = skullCount();
  // the acquire+recheck cadence is `age+10..19` ticks; the fire-cadence after acquiring is
  // `age+40..59` -- 80 ticks covers both real cooldowns with room to spare, no polling.
  for (let i = 0; i < 80 && skullCount() === before; i++) { w.age = (w.age || 0) + 1; Wi.tickMovement(w); }
  ok(skullCount() > before, `a side head fired a real wither_skull within 80 ticks (got ${skullCount() - before})`);
  ok(w.sideHeadTarget[0] === plr || w.sideHeadTarget[1] === plr, 'the firing head tracked the real player entity (object-reference stand-in)');
  MCL.Player = null;
}

// ═════════════ 2. the two slots are independent ═══════════════
{
  say('\n§2 the two side-head slots are independent');
  freshWorld();
  const w = spawnWither(0.5, 70, 0.5);
  const plr = mkPlayer(5.5, 70, 0.5);
  MCL.Player = plr;
  for (let i = 0; i < 30; i++) { w.age = (w.age || 0) + 1; Wi.tickMovement(w); }
  // force slot 0 onto the player, slot 1 explicitly untracked and cooling down long -- the two
  // arrays must not alias each other.
  w.sideHeadTarget[0] = plr;
  w.sideHeadTarget[1] = null;
  w.skullCooldowns[1] = w.age + 10000;
  const before = skullCount();
  for (let i = 0; i < 80 && skullCount() === before; i++) { w.age++; Wi.tickMovement(w); }
  ok(skullCount() > before, 'slot 0 (tracking the player) still fires while slot 1 is frozen');
  ok(w.sideHeadTarget[1] === null, "slot 1's own tracked-target slot was never touched by slot 0's activity (no cross-slot aliasing)");
  MCL.Player = null;
}

// ═════════════ 3. renderer fields populate and swing toward the target ═══════════════
{
  say('\n§3 e.witherSideYawRel/e.witherSidePitch populate and track');
  freshWorld();
  const w = spawnWither(0.5, 70, 0.5);
  Wi.tickMovement(w);
  ok(Array.isArray(w.witherSideYawRel) && w.witherSideYawRel.length === 2, 'e.witherSideYawRel is a real 2-element array after one tick');
  ok(Array.isArray(w.witherSidePitch) && w.witherSidePitch.length === 2, 'e.witherSidePitch is a real 2-element array after one tick');
  const plr = mkPlayer(0.5, 66, 8.5);   // below and in front -- forces a real nonzero pitch/yaw swing
  w.sideHeadTarget[0] = plr;
  const yaw0 = w.witherSideYawRel[0], pitch0 = w.witherSidePitch[0];
  for (let i = 0; i < 20; i++) { w.age++; Wi.tickMovement(w); }
  ok(w.witherSideYawRel[0] !== yaw0 || w.witherSidePitch[0] !== pitch0,
    `head 0's relative yaw/pitch actually moved once it has a live tracked target (before ${yaw0.toFixed(2)}/${pitch0.toFixed(2)}, after ${w.witherSideYawRel[0].toFixed(2)}/${w.witherSidePitch[0].toFixed(2)})`);
}

// ═════════════ 4. an out-of-range/hidden tracked target is dropped, not fired at ═══════════════
{
  say('\n§4 re-check gate drops a target the real predicate would reject');
  freshWorld();
  const w = spawnWither(0.5, 70, 0.5);
  const farPlr = mkPlayer(500.5, 70, 0.5);   // WAY past the real 30-block (900 sq) refire gate
  w.sideHeadTarget[0] = farPlr;
  w.skullCooldowns[0] = 0;   // gate open on the very next tick
  w.age = 0;
  Wi.tickMovement(w);
  ok(w.sideHeadTarget[0] === null, 'a tracked target far outside SIDE_HEAD_REFIRE_RANGE_SQ is dropped (setTrackedEntityId(i,0))');
  const before = skullCount();
  Wi.shootSkullAt(w, 2, farPlr.x, farPlr.y, farPlr.z);   // the spawn path itself still works
  ok(skullCount() === before + 1, 'sanity: Wi.shootSkullAt itself still spawns fine (the drop above was the gate, not a spawn failure)');
}

// ═════════════ 5. anti-vacuity: the pre-unit tickMovement never fires a side-head skull ═══════════════
{
  say('\n§5 anti-vacuity: no Wi.sideHeadsTick call ever fires a side-head skull, the real one does');
  function preUnitTickMovement(e) {
    // the EXACT `Wi.tickMovement` body as it stood before this unit (velocity blend only, no
    // `e.bodyYaw` write, no `Wi.sideHeadsTick` call) -- reproduced here, not re-imported, so a
    // regression in the real function can't silently make this stale copy pass too.
    var vx = e.vx || 0, vy = (e.vy || 0) * 0.6, vz = e.vz || 0;
    var t = e.target;
    if (t && !t.removed && !t.dead) {
      var maxHp = e.maxHealth || 300;
      var overlay = (e.health !== undefined) && e.health <= maxHp / 2;
      var ty = (t.y || 0);
      if (e.y < ty || (!overlay && e.y < ty + 5.0)) { vy = Math.max(0.0, vy); vy += 0.3 - vy * 0.6; }
      var dx = (t.x || 0) - e.x, dz = (t.z || 0) - e.z;
      var distSq = dx * dx + dz * dz;
      if (distSq > 9.0) {
        var len = Math.sqrt(distSq), nx = dx / len, nz = dz / len;
        vx += nx * 0.3 - vx * 0.6; vz += nz * 0.3 - vz * 0.6;
      }
    }
    e.vx = vx; e.vy = vy; e.vz = vz;
    if (vx * vx + vz * vz > 0.05) e.yaw = Math.atan2(vx, -vz);
  }

  freshWorld();
  const wOld = spawnWither(0.5, 70, 0.5);
  const plrOld = mkPlayer(5.5, 70, 0.5);
  MCL.Player = plrOld;
  const beforeOld = skullCount();
  for (let i = 0; i < 300; i++) { wOld.age = (wOld.age || 0) + 1; preUnitTickMovement(wOld); }
  okAv(skullCount() === beforeOld, `the pre-unit tickMovement (no Wi.sideHeadsTick) fires 0 side-head skulls across 300 ticks near a live target (got ${skullCount() - beforeOld})`);

  freshWorld();
  const wNew = spawnWither(0.5, 70, 0.5);
  const plrNew = mkPlayer(5.5, 70, 0.5);
  MCL.Player = plrNew;
  const beforeNew = skullCount();
  for (let i = 0; i < 80 && skullCount() === beforeNew; i++) { wNew.age = (wNew.age || 0) + 1; Wi.tickMovement(wNew); }
  ok(skullCount() > beforeNew, `the current, real Wi.tickMovement (calling Wi.sideHeadsTick) fires a side-head skull within 80 ticks (got ${skullCount() - beforeNew})`);
  MCL.Player = null;
}

// ═════════════ 6. anti-vacuity: zeroing the refire-range gate changes the outcome ═══════════════
// (a directly observable spawn count, not a value anything downstream re-derives or clamps back
// to the same number -- nothing else in the pipeline can reconvergently erase this difference)
{
  say('\n§6 anti-vacuity: SIDE_HEAD_REFIRE_RANGE_SQ actually gates the re-fire');
  function firesAtDistance(rangeSq, dist) {
    freshWorld();
    const w = spawnWither(0.5, 70, 0.5);
    const plr = mkPlayer(0.5 + dist, 70, 0.5);
    EL.list.push(plr);
    w.sideHeadTarget[0] = plr;
    w.skullCooldowns[0] = 0;
    w.age = 0;
    const real = Wi.SIDE_HEAD_REFIRE_RANGE_SQ;
    Wi.SIDE_HEAD_REFIRE_RANGE_SQ = rangeSq;
    const before = skullCount();
    Wi.tickMovement(w);
    Wi.SIDE_HEAD_REFIRE_RANGE_SQ = real;
    return skullCount() > before;
  }
  const dist = 15;   // inside the real 900 sq (30-block) gate, outside a deliberately shrunk one
  const firedReal = firesAtDistance(900.0, dist);
  const firedShrunk = firesAtDistance(1.0, dist);
  ok(firedReal, `precondition: at the real 900 sq gate, a 15-block-away tracked target still gets fired at (got ${firedReal})`);
  okAv(firedShrunk === false, `shrinking SIDE_HEAD_REFIRE_RANGE_SQ to 1.0 changes the outcome -- the SAME target now gets dropped instead of fired at (real-range fired ${firedReal}, shrunk-range fired ${firedShrunk})`);
}

// ═════════════ 6b. attack-distance scaling (#4268) ═══════════════
{
  say('\n§6b sneaking targets shrink the head search range');
  function n18(mod) {
    freshWorld();
    const w = spawnWither(0.5, 70, 0.5);
    const plr = mkPlayer(18.5, 70, 0.5); mod(plr);
    MCL.Player = plr;
    const n = Wi.headTargetCandidates(w, EL.aiCtx(w)).length;
    MCL.Player = null;
    return n;
  }
  ok(n18(() => {}) === 1, 'precondition: a standing player 18 blocks away is a candidate');
  okAv(n18((p) => { p.crouching = true; }) === 0, 'a sneaking player 18 blocks away (range 16) is not a candidate');
}

// ═════════════ 7. creative/spectator players are not head targets (#1582) ═══════════════
{
  say('\n§7 creative player in range is not a side-head target');
  function cands(inv) {
    freshWorld();
    const w = spawnWither(0.5, 70, 0.5);
    const plr = mkPlayer(15.5, 70, 0.5);
    plr.invulnerableGamemode = inv;
    MCL.Player = plr;
    const n = Wi.headTargetCandidates(w, EL.aiCtx(w)).length;
    MCL.Player = null;
    return n;
  }
  ok(cands(false) === 1, 'precondition: a survival player 15 blocks away is a candidate');
  okAv(cands(true) === 0, 'an invulnerable (creative/spectator) player yields no candidates');
  freshWorld();
  const wv = spawnWither(0.5, 70, 0.5);
  MCL.Player = mkPlayer(0.5, 85, 0.5);
  okAv(Wi.headTargetCandidates(wv, EL.aiCtx(wv)).length === 0, 'a player 15 blocks directly above is outside the expand(20,8,20) box -> no candidates');
  MCL.Player = null;
  freshWorld();
  const w2 = spawnWither(0.5, 70, 0.5);
  const cp = mkPlayer(15.5, 70, 0.5); cp.invulnerableGamemode = true;
  MCL.Player = cp; w2.sideHeadTarget[0] = cp; w2.skullCooldowns[0] = 0; w2.age = 0;
  const b = skullCount(); Wi.tickMovement(w2);
  okAv(skullCount() === b && w2.sideHeadTarget[0] === null, 'an already-tracked creative player is dropped, not fired at');
  MCL.Player = null;
}

// ═════════════ 8. charged random skulls fire on NORMAL and HARD, not EASY (#2780) ═══════════════
{
  say('\n§8 chargedSkullCooldowns barrage by difficulty');
  function charged(d) {
    freshWorld();
    Diff.set(d);
    const w = spawnWither(0.5, 70, 0.5);
    w.age = 100; w.skullCooldowns = [0, 0]; w.chargedSkullCooldowns = [16, 16];
    Wi.sideHeadsTick(w);
    Diff.set('normal');
    return w.chargedSkullCooldowns[0] === 0 || w.chargedSkullCooldowns[1] === 0;
  }
  ok(charged('normal'), 'normal: a charged side-head skull fires (counter reset)');
  ok(charged('hard'), 'hard: a charged side-head skull fires');
  okAv(charged('easy') === false, 'easy: no charged skull (counter frozen)');
}

// ═════════════ 9. side heads aim at getStandingEyeHeight*0.5, not the sneaking pose height (#4812) ═══════════════
{
  say('\n§9 sneaking player: side-head aim y == centre-head aim y == y+0.81');
  function sideAimY(eyeHeight) {
    freshWorld();
    const w = spawnWither(0.5, 70, 0.5);
    const plr = mkPlayer(5.5, 70, 0.5); plr.eyeHeight = eyeHeight;
    EL.list.push(plr); MCL.Player = plr;
    w.sideHeadTarget[0] = plr; w.skullCooldowns = [0, 0]; w.age = 100;
    const orig = Wi.shootSkullAt; let y = null;
    Wi.shootSkullAt = function (e, h, tx, ty) { if (h === 2 && y === null) y = ty; return null; };
    Wi.sideHeadsTick(w);
    Wi.shootSkullAt = orig; MCL.Player = null;
    return y;
  }
  ok(near(sideAimY(1.27), 70.81), 'sneaking (eyeHeight 1.27): side head aims at y+0.81');
  okAv(!near(sideAimY(1.27), 70 + 1.27 * 0.5), 'the pose-height aim (y+0.635) is not what the side head fires at');
}

console.log(`\n${pass} passed, ${fails.length} failed (of which ${breaks} anti-vacuity probes)`);
console.log(`witherheadscheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  ✗ ' + f);
process.exit(fails.length ? 1 : 0);
