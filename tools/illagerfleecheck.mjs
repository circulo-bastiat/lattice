#!/usr/bin/env node
// illagerfleecheck.mjs -- cloud unit (owed-ai-owed): the evoker/illusioner goal lists against
// `.decomp`'s own `initGoals()`, read whole.
//
//   node tools/illagerfleecheck.mjs [--verbose]
//
//   EvokerEntity.java:52   goalSelector.add(2, new FleeEntityGoal<>(this, PlayerEntity.class, 8.0F, 0.6, 1.0))
//   EvokerEntity.java:56   goalSelector.add(8, new WanderAroundGoal(this, 0.6))
//   EvokerEntity.java:57   goalSelector.add(9, new LookAtEntityGoal(this, PlayerEntity.class, 3.0F, 1.0F))
//   IllusionerEntity.java:67-69  6 BowAttackGoal, 8 WanderAroundGoal(0.6), 9 LookAtEntityGoal(Player, 3.0F)
//
// Before this unit the evoker had NO flee goal (a stroll stood in at priority 2), the illusioner's
// stroll sat at priority 2 too -- above its own priority-6 bow, so a strolling illusioner never
// started a shot -- and both looked at a player from 12 blocks, not 3. Drives the REAL
// Ai.ROSTER factories, both directions (rule 6): a survival player at 5 blocks is fled, one at
// 12 is not, a creative one is not (the 5-arg ctor's EXCEPT_CREATIVE_OR_SPECTATOR).

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); if (VERBOSE) console.log((c ? '   ok ' : '   XX ') + m); return c; };
const okAv = (c, m) => { breaks++; if (c && !VERBOSE) console.log('   ✓ anti-vacuity: ' + m); return ok(c, 'anti-vacuity: ' + m); };

console.log('illagerfleecheck -- evoker FleeEntityGoal(Player, 8, 0.6, 1.0) + illusioner/evoker wander/look priorities');

const M = loadEngine({
  extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js',
          '14e_gamemode.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14c_raycast.js',
          '07v_spell.js']
});
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
M.Entities.init();
M.EntityList.init();
M.Behave.init(M.World);
M.Ai.init();
ok(M.Ai.ready, 'Ai module reports ready');

const Ai = M.Ai, W = M.World, CH = M.CH, Gm = M.Gamemode;
const STONE = M.States.stateOf('stone') | 0;
W.init(1);
for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) {
  const c = W.makeChunk(cx, cz);
  c.state = CH.GENERATED;
  W.chunks.set(W.key(cx, cz), c);
}
for (let x = -40; x <= 40; x++) for (let z = -40; z <= 40; z++) W.setBlock(x, 7, z, STONE);

const mob = (type) => ({ id: 1, type, x: 0.5, y: 8, z: 0.5, vx: 0, vy: 0, vz: 0, yaw: 0, width: 0.6, height: 1.95 });
const player = (x, mode) => ({ type: 'player', x, y: 8, z: 0.5, height: 1.8, mode: mode === undefined ? (Gm ? Gm.SURVIVAL : 0) : mode });
const ctxFor = (p) => ({
  players: () => [p], golems: () => [], random: Math.random, onShoot: () => {},
  mobs: () => [], entities: () => [], all: () => []
});
const entriesAt = (gs, pri, flags) => gs.entries.filter((en) => en.priority === pri && (flags === undefined || en.flags === flags));
const tries = (g, n) => { for (let i = 0; i < (n || 40); i++) if (g.canUse()) return true; return false; };

// ── 1. evoker: the flee goal exists at priority 2, and is the real AvoidEntityGoal ──────────────
{
  const e = mob('evoker');
  let p = player(5.5);
  const ctx = ctxFor(p);
  ctx.players = () => [p];
  const gs = Ai.ROSTER.evoker(e, ctx);
  const at2 = entriesAt(gs, 2, Ai.MOVE);
  ok(at2.length === 1 && at2[0].goal instanceof Ai.AvoidEntityGoal,
     'evoker has exactly one priority-2 MOVE goal and it is Ai.AvoidEntityGoal (EvokerEntity.java:52)');
  ok(entriesAt(gs, 8, Ai.MOVE).length === 1, 'evoker wanders at priority 8 (EvokerEntity.java:56), not 2');
  const flee = at2[0] && at2[0].goal;
  if (flee) {
    ok(tries(flee) === true, 'a survival player 5 blocks away IS fled (inside 8.0F)');
    flee.stop();
    p = player(12.5);
    ok(tries(flee) === false, 'a survival player 12 blocks away is NOT fled (past 8.0F)');
    if (Gm) {
      p = player(5.5, Gm.CREATIVE);
      ok(tries(flee) === false, 'a CREATIVE player 5 blocks away is NOT fled (EXCEPT_CREATIVE_OR_SPECTATOR)');
      p = player(5.5, Gm.SPECTATOR);
      ok(tries(flee) === false, 'a SPECTATOR player 5 blocks away is NOT fled');
    } else ok(false, 'Gamemode module loaded');
    // anti-vacuity: the SAME creative player is fled by a goal whose predicate accepts anyone --
    // the refusal above was the gamemode predicate, not an unreachable escape point.
    if (Gm) {
      const pc = player(5.5, Gm.CREATIVE);
      const open = new Ai.AvoidEntityGoal(e, 8, 0.6, () => [pc], () => true, { fastSpeed: 1.0, favor: Ai.hostilePathfindingFavor });
      okAv(tries(open) === true, 'the identical creative player IS fled once the predicate is dropped');
    }
    // anti-vacuity: the pre-unit roster (a stroll at 2) has no goal that ever reacts to the player.
    const old = new Ai.WaterAvoidingRandomStrollGoal(e, 0.6, () => 0.99);
    okAv(tries(old) === false, 'the old priority-2 stroll never starts because a player is near (it only rolls a chance)');
  }
  // run it: the REAL selector (priority arbitration included) starts the flee goal, and the
  // path it is following ends farther from the player than the evoker stands.
  p = player(4.5);
  const gs2 = Ai.ROSTER.evoker(e, ctxFor(p));
  const flee2 = entriesAt(gs2, 2, Ai.MOVE)[0].goal;
  let running = false;
  for (let t = 0; t < 40 && !running; t++) { gs2.tick(); running = gs2.isRunning(flee2); }
  ok(running, 'ticking the real evoker selector with a survival player 4 blocks away starts the flee goal');
}

// ── 2. illusioner: stroll at 8, below the priority-6 bow; look radius 3 on both ────────────────
{
  const e = mob('illusioner');
  const gs = Ai.ROSTER.illusioner(e, ctxFor(player(30.5)));
  ok(entriesAt(gs, 2, Ai.MOVE).length === 0, 'illusioner has no priority-2 MOVE goal (IllusionerEntity has no flee)');
  ok(entriesAt(gs, 8, Ai.MOVE).length === 1, 'illusioner wanders at priority 8 (IllusionerEntity.java:68)');
  const bow = gs.entries.find((en) => en.goal instanceof Ai.BowAttackGoal);
  const wander = entriesAt(gs, 8, Ai.MOVE)[0];
  ok(!!bow && !!wander && bow.priority < wander.priority, 'the bow (6) outranks the wander (8), so a strolling illusioner can still start a shot');
  for (const kind of ['evoker', 'illusioner']) {
    const g = entriesAt(Ai.ROSTER[kind](mob(kind), ctxFor(player(30.5))), 9, Ai.LOOK)[0];
    ok(!!g, kind + ' has its priority-9 look-at-player goal');
    if (!g) continue;
    const near = mob(kind);
    const gl = g.goal.constructor === Ai.LookAtPlayerGoal ? g.goal : null;
    const pNear = player(3.0), pFar = player(6.0);
    const at3 = new Ai.LookAtPlayerGoal(near, () => [pNear], 3.0, undefined, 1.0);
    ok(at3.canUse() === true, kind + ': a player 2.5 blocks away is inside the 3.0F look radius');
    const g2 = entriesAt(Ai.ROSTER[kind](near, ctxFor(pFar)), 9, Ai.LOOK)[0].goal;
    ok(g2.canUse() === false, kind + ': the ROSTER look goal ignores a player 5.5 blocks away (radius 3.0F, was 12)');
    const g3 = entriesAt(Ai.ROSTER[kind](near, ctxFor(pNear)), 9, Ai.LOOK)[0].goal;
    ok(g3.canUse() === true, kind + ': ...and does look at one 2.5 blocks away (both directions)');
    const was12 = new Ai.LookAtPlayerGoal(near, () => [pFar], 12.0, undefined, 1.0);
    okAv(was12.canUse() === true, kind + ': the old radius 12 WOULD have looked at the 5.5-block player');
    void gl;
  }
}

console.log('');
console.log('================ illagerfleecheck ================');
console.log(' assertions passed .. ' + pass);
console.log(' failures ........... ' + fails.length);
console.log(' breaks caught ...... ' + breaks);
console.log('==================================================');
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
