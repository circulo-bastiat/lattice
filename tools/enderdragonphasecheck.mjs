#!/usr/bin/env node
// enderdragonphasecheck.mjs -- G18 leftover (QUEUE 0.00 part 2, D-788 residue): the ender
// dragon's PhaseManager + phase-type skeleton and per-part damage routing
// (src/07zzl_enderdragon.js: ED.PhaseManager, ED.AbstractPhase, ED.HoldingPatternPhase, ED.Path,
// ED.EnderDragonPart, ED.EnderDragonEntity). Builds on enderdragoncheck (PARTS/PHASE_NAMES) and
// enderdragonpathcheck (the 24-node ring + A*) -- this check is the phase manager + damage
// routing that D-788 said HoldingPatternPhase would call them from.
//
//   node tools/enderdragonphasecheck.mjs [--verbose]
//
// Sections:
//   1. PHASE_TYPES -- 11 entries matching PhaseType.java's own registration ORDER exactly (id ==
//      index), and isSittingOrHovering() true for exactly the 4 phases .decomp itself overrides
//      it for (grepped fresh here, not copied)
//   2. PhaseManager -- defaults to Hover (PhaseManager's own ctor), setPhase is a genuine no-op
//      when re-entering the SAME phase (the current instance's beginPhase must not re-fire, or
//      HoldingPatternPhase's own path/pathTarget state could never survive a round trip), and
//      instances are reused (create() called twice for the same type returns the SAME object)
//   3. HoldingPatternPhase -- serverTick actually calls tickInRange/followPath and produces a
//      real path target on the ring (not a no-op phase that "looks wired"); anti-vacuity: a
//      dragon whose pathNodes/findPath is broken (all-zero NODE_CONNECTIONS) proves the
//      HoldingPattern loop still terminates sanely rather than throwing/hanging
//   4. per-part damage routing -- EnderDragonPart.damage -> owner.damagePart, ported math:
//      non-head amount/4+min(amount,1) reduction, head takes it raw; a hit with neither
//      byPlayer nor explosive set applies NO damage (vanilla's own `getAttacker() instanceof
//      Player || isExplosive()` gate); death -> Dying phase (health pinned to 1, NOT 0); Dying
//      phase blocks all further damagePart calls (returns false)
//   5. sitting/hovering damage accumulation -- damage taken while isSittingOrHovering() (a
//      fresh dragon starts in Hover) accumulates in damageDuringSitting and crosses
//      0.25*maxHealth into a forced Takeoff switch, exactly like vanilla's own dragon-farm
//      mechanic; anti-vacuity: proves the accumulator actually RESETS on the switch (a stuck
//      accumulator would re-trigger Takeoff every single tick afterward)
//   6. stub phases are HONEST -- every PHASE_TYPES entry besides HoldingPattern currently
//      resolves through ED.PhaseManager to a bare ED.AbstractPhase (serverTick is the literal
//      no-op, not a phase quietly pretending to fly/land/strafe) -- this is the "stub named on
//      OWED, not half-added" shape the task called for, checked so nobody upgrades one phase's
//      real body without updating this list
//   16. ED.OWED's motionFor/canSpawn item -- loop/enderdragon-wiring (QUEUE 0.00 part 2, D-804's
//      still-owed item, four prior sessions' own decline, this pass's own reversal):
//      .decomp's own EnderDragonEntity.java (read whole) NEVER calls super.tickMovement()
//      anywhere in its file -- its tickMovement() override replaces LivingEntity's entirely, so
//      travel() (and its 0.08 gravity / 0.98 drag literals) is NEVER reached, independently
//      confirmed by tools/extract-entity-motion.mjs's own D-309 anti-vacuity assertion
//      (`reachesLivingEntityUnintercepted`) already refusing ender_dragon for exactly this
//      reason -- still true, still checked below (part a). That makes ender_dragon's real value
//      the SAME "[0, 1] sentinel, own class fully bypasses the framework default, real motion is
//      a bespoke per-tick hook" shape ghast/vex/phantom/wither_skull/area_effect_cloud already
//      use in `src/07i_entitylist.js` -- what four prior sessions (D-804/D-810/D-812) declined
//      was adding that row WITHOUT the hook: every existing `[0, 1]`-sentinel type already has a
//      real per-tick hook driving it (`e.flyMove` for ghast/vex/phantom, `Wi.tickSkull` for
//      wither_skull), and ender_dragon had none -- `ED.EnderDragonEntity.prototype.tickMovement`
//      was real, verbatim-ported .decomp logic, but ran only on a standalone rig with
//      `opts.players`/`opts.heightAt`/`opts.fight` world stand-ins, never on a live spawned `e`.
//      THIS pass builds that missing hook: `ED.initEntity`/`ED.tickEntity`
//      (07zzl_enderdragon.js, dispatched from `EL.tickMob`'s own mobTick slot, the SAME slot
//      `Wi.tickMovement` already occupies) bridge e's live x/y/z/yaw into the standalone rig
//      every tick, run tickMovement() unchanged, and copy the result back -- so
//      `EL.motionFor('ender_dragon')` now returning `[0, 1]` is no longer a statue sentinel, the
//      SAME real-hook shape ghast/wither_skull already stand on. Still NOT built by this pass:
//      EnderDragonFight/the End-dimension substrate (ED.OWED's own item 2, unchanged) -- the
//      dragon is seeded straight into HoldingPattern at spawn (no fight to hand it a real
//      starting phase) rather than through a natural crystal-ring spawn, and the 8-part hitbox's
//      own per-part collision/targeting is still the ordinary single bounding box every other
//      mob uses. This section is now a WIRE-UP test, not a regression guard: it locks in the
//      same confirmed .decomp fact (own class never reaches travel(), part a) alongside the NEW
//      reality that EL.canSpawn('ender_dragon') is true and a spawned dragon genuinely moves
//      (part b), so neither the fact nor the wiring silently drifts.
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// section 16's own engine, loaded separately from `M` above -- it needs `07i_entitylist.js`
// wired against REAL `assets/entities.json` data (the same shape `tools/aicheck.mjs` loads),
// which the rest of this file's `M`/`ED` never needed.

const VERBOSE = process.argv.includes('--verbose');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c && VERBOSE) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };

console.log('enderdragonphasecheck -- PhaseManager + phase-type skeleton + per-part damage routing');

const M = loadEngine({ extra: ['07zzl_enderdragon.js'] });
const ED = M.EnderDragon;

// section 16's own SEPARATE engine instance -- `07i_entitylist.js` wired against REAL
// `assets/entities.json` data, the same shape `tools/aicheck.mjs` already loads it in. Kept
// apart from `M`/`ED` above so this file's other 15 sections' standalone-rig engine is
// untouched by it.
const M16 = loadEngine({
  extra: ['07_world.js', '07h_entities.js', '14b_physics.js', '07k_goals.js', '07i_entitylist.js', '07zzl_enderdragon.js']
});
M16.EnderDragon.init();
M16.DATA = Object.assign({}, M16.DATA, {
  entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8'))
});
M16.Entities.init();
M16.EntityList.init();
const EL16 = M16.EntityList;

ok(ED.ready === true, 'ED.ready is true');
['PHASE_TYPES', 'AbstractPhase', 'PhaseManager', 'HoldingPatternPhase', 'Path', 'EnderDragonPart', 'EnderDragonEntity']
  .forEach((k) => ok(typeof ED[k] !== 'undefined', `ED.${k} is exposed`));

// ============ 1. PHASE_TYPES ==================================================================
const phaseSrc = readFileSync(
  join(MCLITE_ROOT, '.decomp/net/minecraft/entity/boss/dragon/phase/PhaseType.java'), 'utf8');
const wantOrder = [...phaseSrc.matchAll(/register\(\w+\.class, "(\w+)"\)/g)].map((m) => m[1]);
okAv(wantOrder.length === 11, `.decomp's PhaseType.java still registers exactly 11 phases (found ${wantOrder.length})`);
ok(ED.PHASE_TYPES.length === wantOrder.length, `ED.PHASE_TYPES has ${wantOrder.length} entries`);
wantOrder.forEach((name, i) => {
  ok(ED.PHASE_TYPES[i] && ED.PHASE_TYPES[i].name === name && ED.PHASE_TYPES[i].id === i,
    `ED.PHASE_TYPES[${i}] is "${name}" with id ${i}, got ${ED.PHASE_TYPES[i] && ED.PHASE_TYPES[i].name}/${ED.PHASE_TYPES[i] && ED.PHASE_TYPES[i].id}`);
});

// re-derive "isSittingOrHovering" fresh off .decomp rather than trust ED's own table -- every
// phase file that overrides the method to return true, full stop.
const phaseDir = join(MCLITE_ROOT, '.decomp/net/minecraft/entity/boss/dragon/phase');
const overridesTrue = [];
for (const name of wantOrder) {
  // AbstractSittingPhase's three subclasses don't override it themselves -- they extend a class
  // that does, so check the class hierarchy by file content: does <Name>Phase.java say
  // `extends AbstractSittingPhase`, or does it itself say `return true` under the method?
}
const classFiles = { };
for (const f of ['ChargingPlayerPhase', 'DyingPhase', 'HoldingPatternPhase', 'HoverPhase',
  'LandingApproachPhase', 'LandingPhase', 'SittingAttackingPhase', 'SittingFlamingPhase',
  'SittingScanningPhase', 'StrafePlayerPhase', 'TakeoffPhase', 'AbstractSittingPhase']) {
  classFiles[f] = readFileSync(join(phaseDir, f + '.java'), 'utf8');
}
const NAME_TO_CLASS = {
  HoldingPattern: 'HoldingPatternPhase', StrafePlayer: 'StrafePlayerPhase',
  LandingApproach: 'LandingApproachPhase', Landing: 'LandingPhase', Takeoff: 'TakeoffPhase',
  SittingFlaming: 'SittingFlamingPhase', SittingScanning: 'SittingScanningPhase',
  SittingAttacking: 'SittingAttackingPhase', ChargingPlayer: 'ChargingPlayerPhase',
  Dying: 'DyingPhase', Hover: 'HoverPhase'
};
wantOrder.forEach((name) => {
  const cls = classFiles[NAME_TO_CLASS[name]];
  const extendsSitting = /extends AbstractSittingPhase/.test(cls);
  const ownOverrideTrue = /isSittingOrHovering[\s\S]{0,40}return true/.test(cls);
  const want = extendsSitting || ownOverrideTrue;
  const type = ED.PHASE_TYPES.byName[name];
  ok(!!type && type.isSittingOrHovering === want,
    `ED.PHASE_TYPES.byName.${name}.isSittingOrHovering is ${want} (.decomp: ${extendsSitting ? 'extends AbstractSittingPhase' : ownOverrideTrue ? 'own override' : 'AbstractPhase default false'})`);
});
say(`   isSittingOrHovering: ${wantOrder.filter((n) => ED.PHASE_TYPES.byName[n].isSittingOrHovering).join(', ')}`);

// ============ 2. PhaseManager =================================================================
function freshDragon(extra) {
  const nodes = ED.buildPathNodes((x, z) => 60);
  return new ED.EnderDragonEntity(Object.assign({ pathNodes: nodes }, extra));
}

{
  const d = freshDragon();
  const pm = d.getPhaseManager();
  ok(pm.getCurrent().getType().name === 'Hover', `a fresh PhaseManager defaults to Hover, got ${pm.getCurrent().getType().name}`);

  const hp1 = pm.create(ED.PHASE_TYPES.byName.HoldingPattern);
  pm.setPhase(ED.PHASE_TYPES.byName.HoldingPattern);
  hp1.shouldFindNewPath = true; // poke instance state NOT cleared by HoldingPatternPhase.beginPhase (only path/pathTarget are)
  pm.setPhase(ED.PHASE_TYPES.byName.Hover);
  pm.setPhase(ED.PHASE_TYPES.byName.HoldingPattern);
  ok(pm.getCurrent() === hp1, 'setPhase back into a previously-created phase reuses the SAME instance (create() is memoized)');
  ok(pm.getCurrent().shouldFindNewPath === true,
    'the reused instance kept its own state (shouldFindNewPath, which beginPhase does not reset) across the round trip -- proves reuse is real, not a lookalike fresh object');

  let beginCount = 0;
  const origBegin = ED.HoldingPatternPhase.prototype.beginPhase;
  ED.HoldingPatternPhase.prototype.beginPhase = function () { beginCount++; return origBegin.call(this); };
  const d2 = freshDragon();
  d2.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.HoldingPattern);
  const before = beginCount;
  d2.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.HoldingPattern); // re-entering the SAME phase
  ED.HoldingPatternPhase.prototype.beginPhase = origBegin;
  ok(beginCount === before, `setPhase into the CURRENT phase is a no-op -- beginPhase must not re-fire (fired ${beginCount - before} extra time(s))`);
}

// ============ 3. HoldingPatternPhase drives the ring ==========================================
{
  const nodes = ED.buildPathNodes((x, z) => 60);
  const d = new ED.EnderDragonEntity({ pathNodes: nodes, x: nodes[12].x, y: nodes[12].y, z: nodes[12].z, fight: { getAliveEndCrystals: () => 0 } });
  d.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.HoldingPattern);
  const hp = d.getPhaseManager().getCurrent();
  ok(hp.getPathTarget() === null, 'a just-begun HoldingPatternPhase has no path target yet');
  for (let i = 0; i < 80 && hp.getPathTarget() === null; i++) hp.serverTick();
  const target = hp.getPathTarget();
  ok(!!target && typeof target.x === 'number' && typeof target.y === 'number' && typeof target.z === 'number',
    `serverTick() eventually produces a real {x,y,z} path target off the ring (got ${JSON.stringify(target)})`);
  // the target must be a real ring-node position (integer x/z off ED.buildPathNodes), not a
  // random/made-up point -- proves tickInRange really called dragon.findPath, not a stand-in.
  const onRing = nodes.some((n) => n.x === target.x && n.z === target.z);
  ok(onRing, `the path target's x/z (${target.x}, ${target.z}) matches a real ring node's x/z`);

  // anti-vacuity: an all-broken connectivity graph must not hang/throw -- findPath's own
  // closest-node fallback (enderdragonpathcheck already covers findPath itself; this proves
  // HoldingPatternPhase's OWN loop survives it, i.e. it never assumes path is non-null).
  const savedConns = ED.NODE_CONNECTIONS.slice();
  for (let i = 0; i < 24; i++) ED.NODE_CONNECTIONS[i] = 0;
  const d3 = new ED.EnderDragonEntity({ pathNodes: ED.buildPathNodes((x, z) => 60), fight: { getAliveEndCrystals: () => 0 } });
  d3.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.HoldingPattern);
  let threw = false;
  try { for (let i = 0; i < 40; i++) d3.getPhaseManager().getCurrent().serverTick(); } catch (e) { threw = true; }
  for (let i = 0; i < 24; i++) ED.NODE_CONNECTIONS[i] = savedConns[i];
  okAv(!threw, 'a fully disconnected NODE_CONNECTIONS graph does not throw inside HoldingPatternPhase.serverTick (findPath\'s own null/closest-node fallback is respected)');
}

// ============ 4. per-part damage routing =======================================================
{
  const d = freshDragon();
  d.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.Takeoff); // a non-sitting/hovering, non-Dying phase
  ok(d.body instanceof ED.EnderDragonPart, 'd.body is a real ED.EnderDragonPart');

  const noSourceOk = d.body.damage({}, 50);
  ok(noSourceOk === true && d.getHealth() === ED.MAX_HEALTH,
    `a hit with neither byPlayer nor explosive set is accepted (returns true, matching vanilla) but changes NO health (vanilla: only getAttacker() instanceof Player || isExplosive() actually hurts) -- health stayed ${d.getHealth()}`);

  const before = d.getHealth();
  const applied = d.body.damage({ byPlayer: true }, 20);
  const expectNonHead = 20 / 4 + Math.min(20, 1); // 6
  ok(applied === true, 'a real player hit on a non-head part returns true');
  ok(Math.abs((before - d.getHealth()) - expectNonHead) < 1e-9,
    `non-head damage is amount/4 + min(amount,1): 20 -> ${expectNonHead}, health dropped by ${before - d.getHealth()}`);

  const d2 = freshDragon(); d2.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.Takeoff);
  const before2 = d2.getHealth();
  d2.head.damage({ byPlayer: true }, 20);
  ok(Math.abs((before2 - d2.getHealth()) - 20) < 1e-9, `head damage is NOT reduced (raw 20), health dropped by ${before2 - d2.getHealth()}`);

  const d3 = freshDragon(); d3.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.Takeoff);
  for (let i = 0; i < 100 && !d3.isDead(); i++) d3.head.damage({ byPlayer: true }, 50);
  ok(d3.isDead() === false && d3.getHealth() === 1, `death pins health to 1 (vanilla: setHealth(1)), got ${d3.getHealth()} / isDead ${d3.isDead()}`);
  ok(d3.getPhaseManager().getCurrent().getType().name === 'Dying', `death switches the phase to Dying, got ${d3.getPhaseManager().getCurrent().getType().name}`);
  const stillTrue = d3.head.damage({ byPlayer: true }, 999);
  ok(stillTrue === false, 'Dying phase blocks all further damagePart calls (returns false)');
  ok(d3.getHealth() === 1, 'health does not move once Dying blocks further damage');
}

// ============ 5. sitting/hovering damage accumulation ==========================================
{
  const d = freshDragon(); // starts in Hover (isSittingOrHovering true)
  ok(d.getPhaseManager().getCurrent().isSittingOrHovering() === true, 'a fresh dragon starts isSittingOrHovering() true (Hover)');
  let switched = false;
  for (let i = 0; i < 40; i++) {
    d.head.damage({ byPlayer: true }, 10);
    if (d.getPhaseManager().getCurrent().getType().name !== 'Hover') { switched = true; break; }
  }
  ok(switched, 'repeated sitting/hovering damage eventually forces a phase switch (>0.25*maxHealth accumulated)');
  ok(d.getPhaseManager().getCurrent().getType().name === 'Takeoff', `the forced switch goes to Takeoff, got ${d.getPhaseManager().getCurrent().getType().name}`);
  okAv(d.damageDuringSitting === 0, `damageDuringSitting resets to 0 on the Takeoff switch (a stuck accumulator would re-fire every tick), got ${d.damageDuringSitting}`);
}

// ============ 5b. SittingScanningPhase =========================================================
{
  const run = (players, n, setup) => {
    const d = freshDragon({ players: () => players });
    d.x = 0; d.y = 70; d.z = 0; d.head.x = 0; d.head.z = 0; d.yaw = 0;
    if (setup) setup(d);
    d.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.SittingScanning);
    const seen = [];
    for (let i = 0; i < n; i++) {
      d.getPhaseManager().getCurrent().serverTick();
      const nm = d.getPhaseManager().getCurrent().getType().name;
      if (!seen.length || seen[seen.length - 1][1] !== nm) seen.push([i + 1, nm]);
    }
    return { d, seen };
  };
  let r = run([{ x: 5, y: 70, z: 5 }], 200);
  ok(r.seen[1][1] === 'SittingAttacking' && r.seen[1][0] === 26, `close player: SittingAttacking at tick 26, got ${JSON.stringify(r.seen)}`);
  r = run([{ x: 5, y: 95, z: 5 }], 99);
  ok(r.seen.length === 1, 'player 25 above (|dy|>10) is not "close": no handoff before tick 100');
  r = run([], 100);
  ok(r.seen.length === 2 && r.seen[1][0] === 100 && r.seen[1][1] === 'Takeoff', `no player: Takeoff at tick 100, got ${JSON.stringify(r.seen)}`);
  r = run([], 99);
  ok(r.seen.length === 1, 'no player: still scanning at tick 99');
  r = run([{ x: 100, y: 70, z: 0 }], 100);
  ok(r.d.getPhaseManager().getCurrent().getType().name === 'StrafePlayer', `player 100 away: StrafePlayer, got ${r.d.getPhaseManager().getCurrent().getType().name}`);
  r = run([{ x: 0, y: 70, z: 10 }], 5);
  ok(r.d.yaw !== 0, `yaw steers toward a player off-axis, got ${r.d.yaw}`);
  r = run([{ x: 0, y: 70, z: -10 }], 5);
  ok(r.d.yaw === 0, 'no steering when already facing the player (<=10 deg)');
}

// ============ 6. stub phases are honest =========================================================
{
  const d = freshDragon();
  // only SittingScanningPhase (and the permanently-out-of-scope HoverPhase) are still bare
  // stubs after this pass -- Landing/SittingFlaming/SittingAttacking/ChargingPlayer all closed.
  const stubNames = wantOrder.filter((n) =>
    n !== 'HoldingPattern' && n !== 'StrafePlayer' && n !== 'Dying' &&
    n !== 'LandingApproach' && n !== 'Takeoff' && n !== 'Landing' &&
    n !== 'SittingFlaming' && n !== 'SittingAttacking' && n !== 'ChargingPlayer' && n !== 'SittingScanning' && n !== 'Hover');
  ok(stubNames.length === 0, `no stub phases besides the 11 real phases (got ${stubNames.length}: ${stubNames.join(',')})`);
  stubNames.forEach((name) => {
    const phase = d.getPhaseManager().create(ED.PHASE_TYPES.byName[name]);
    ok(phase.constructor === ED.AbstractPhase,
      `PHASE_TYPES.byName.${name} still resolves to a bare ED.AbstractPhase (not a real subclass) -- update ED.OWED if this changes`);
    ok(phase.serverTick() === undefined, `${name}.serverTick() is still AbstractPhase's literal no-op`);
  });
  // every phase this project has ever closed must NOT be a bare stub any more -- the inverse of
  // the loop above, so a future regression that quietly reverts any of them to ED.AbstractPhase
  // is caught either way.
  const sp = d.getPhaseManager().create(ED.PHASE_TYPES.byName.StrafePlayer);
  ok(sp.constructor === ED.StrafePlayerPhase, 'PHASE_TYPES.byName.StrafePlayer now resolves to a real ED.StrafePlayerPhase, not ED.AbstractPhase');
  const dy = d.getPhaseManager().create(ED.PHASE_TYPES.byName.Dying);
  ok(dy.constructor === ED.DyingPhase, 'PHASE_TYPES.byName.Dying now resolves to a real ED.DyingPhase, not ED.AbstractPhase');
  const la = d.getPhaseManager().create(ED.PHASE_TYPES.byName.LandingApproach);
  ok(la.constructor === ED.LandingApproachPhase, 'PHASE_TYPES.byName.LandingApproach now resolves to a real ED.LandingApproachPhase, not ED.AbstractPhase');
  const to = d.getPhaseManager().create(ED.PHASE_TYPES.byName.Takeoff);
  ok(to.constructor === ED.TakeoffPhase, 'PHASE_TYPES.byName.Takeoff now resolves to a real ED.TakeoffPhase, not ED.AbstractPhase');
  const ld = d.getPhaseManager().create(ED.PHASE_TYPES.byName.Landing);
  ok(ld.constructor === ED.LandingPhase, 'PHASE_TYPES.byName.Landing now resolves to a real ED.LandingPhase, not ED.AbstractPhase');
  const sf = d.getPhaseManager().create(ED.PHASE_TYPES.byName.SittingFlaming);
  ok(sf.constructor === ED.SittingFlamingPhase, 'PHASE_TYPES.byName.SittingFlaming now resolves to a real ED.SittingFlamingPhase, not ED.AbstractPhase');
  ok(sf instanceof ED.AbstractSittingPhase, 'ED.SittingFlamingPhase chains off ED.AbstractSittingPhase, not straight off ED.AbstractPhase');
  const sa = d.getPhaseManager().create(ED.PHASE_TYPES.byName.SittingAttacking);
  ok(sa.constructor === ED.SittingAttackingPhase, 'PHASE_TYPES.byName.SittingAttacking now resolves to a real ED.SittingAttackingPhase, not ED.AbstractPhase');
  ok(sa instanceof ED.AbstractSittingPhase, 'ED.SittingAttackingPhase chains off ED.AbstractSittingPhase, not straight off ED.AbstractPhase');
  const cp = d.getPhaseManager().create(ED.PHASE_TYPES.byName.ChargingPlayer);
  ok(cp.constructor === ED.ChargingPlayerPhase, 'PHASE_TYPES.byName.ChargingPlayer now resolves to a real ED.ChargingPlayerPhase, not ED.AbstractPhase');
  const owedText = ED.OWED.join(' ');
  ok(!/HoverPhase/.test(owedText), 'ED.OWED no longer names a bare-AbstractPhase stub');
  const ss = d.getPhaseManager().create(ED.PHASE_TYPES.byName.SittingScanning);
  ok(ss.constructor === ED.SittingScanningPhase && ss instanceof ED.AbstractSittingPhase, 'SittingScanning is a real ED.SittingScanningPhase');
  ok(!/'DyingPhase, and AbstractSittingPhase/.test(owedText),
    'ED.OWED no longer lists DyingPhase among the still-unported phase bodies');
  ok(!/'LandingPhase, ' \+/.test(owedText),
    'ED.OWED no longer lists LandingPhase among the still-unported phase bodies (this pass closed it)');
  ok(/StrafePlayerPhase/.test(owedText) && /DragonFireballEntity/.test(owedText),
    "ED.OWED still names StrafePlayerPhase's own remaining gap (the fireball attack sub-behavior) in writing");
  ok(/LandingApproachPhase and TakeoffPhase/.test(owedText),
    'ED.OWED records that LandingApproachPhase/TakeoffPhase are real, not listed among the unported bodies');
  ok(/getRotationVectorFromPhase/.test(owedText) && /getPitch/.test(owedText) &&
     /setPitch/.test(owedText) && /getRotationVec/.test(owedText),
    'ED.OWED mentions the four rotation methods LandingApproach/Takeoff depend on');
  ok(/AreaEffectCloudEntity/.test(owedText) && /SittingFlamingPhase/.test(owedText),
    "ED.OWED names SittingFlamingPhase's own remaining gap (the tick-10 dragon-breath-cloud spawn) in writing");
  ok(/source\.source === .projectile./.test(owedText),
    "ED.OWED documents AbstractSittingPhase.modifyDamageTaken's own source.source==='projectile' arrow-immunity flag");
}

// ============ 6b. DyingPhase is real (this pass) ================================================
{
  // in-range, no collision -> setHealth(1) every tick (vanilla: dragon "survives" while still
  // descending toward the portal origin)
  const d = freshDragon({ x: 0, y: 64 + 11, z: 0 }); // distSq to (0.5, heightAt(0,0)+1=64, 0.5) ~121, in [100,22500]
  d.setHealth(0);
  d.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.Dying);
  const dy = d.getPhaseManager().getCurrent();
  ok(dy.getPathTarget() === null, 'a just-begun DyingPhase has no path target yet');
  dy.serverTick();
  const target = dy.getPathTarget();
  ok(!!target && Math.abs(target.x - 0.5) < 1e-9 && Math.abs(target.z - 0.5) < 1e-9,
    `serverTick() computes a real portal-origin target (0.5, heightAt(0,0)+1, 0.5), got ${JSON.stringify(target)}`);
  ok(d.getHealth() === 1, `in-range, no collision -> setHealth(1), got ${d.getHealth()}`);

  // out of range (too close, distSq < 100) -> setHealth(0)
  const d2 = freshDragon({ x: 0.5, y: 64, z: 0.5 });
  d2.setHealth(1);
  d2.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.Dying);
  d2.getPhaseManager().getCurrent().serverTick();
  ok(d2.getHealth() === 0, `arrived at the target (distSq < 100) -> setHealth(0), got ${d2.getHealth()}`);

  // anti-vacuity: collision alone (even mid-range distance) forces setHealth(0) too -- proves
  // the check is a real AND of all four vanilla conditions, not just a distance gate.
  const d3 = freshDragon({ x: 0, y: 64 + 11, z: 0 });
  d3.setHealth(1);
  d3.horizontalCollision = true;
  d3.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.Dying);
  d3.getPhaseManager().getCurrent().serverTick();
  okAv(d3.getHealth() === 0, `same in-range position but horizontalCollision=true still forces setHealth(0), got ${d3.getHealth()}`);

  // beginPhase resets the cached target (a stale target from a previous Dying spell must not
  // leak into a fresh one)
  const d4 = freshDragon();
  d4.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.Dying);
  d4.getPhaseManager().getCurrent().serverTick();
  ok(d4.getPhaseManager().getCurrent().getPathTarget() !== null, 'target computed after one tick');
  d4.getPhaseManager().getCurrent().beginPhase();
  okAv(d4.getPhaseManager().getCurrent().getPathTarget() === null, `beginPhase() resets the cached target to null, got ${JSON.stringify(d4.getPhaseManager().getCurrent().getPathTarget())}`);

  ok(d4.getPhaseManager().getCurrent().getMaxYAcceleration() === 3.0, `DyingPhase.getMaxYAcceleration() is 3.0 (.decomp verbatim), got ${d4.getPhaseManager().getCurrent().getMaxYAcceleration()}`);
}

// ============ 7. StrafePlayerPhase + closest-player wiring =====================================
{
  function seqRandom(seq) {
    return {
      nextInt: function (n) { return seq.length ? seq.shift() : 1; },
      nextFloat: function () { return 0; }
    };
  }

  // -- 7a. a HoldingPattern dragon whose path just finished, with a REAL closest player and a
  // random rigged to skip the LandingApproach roll but hit the strafe roll, switches into
  // StrafePlayer with setTargetEntity() actually called (a real target + a real path toward it,
  // not just a phase-type flip).
  const player = { x: 5, y: 70, z: 5 };
  const ringNodes = ED.buildPathNodes((x, z) => 60);
  const d = new ED.EnderDragonEntity({
    pathNodes: ringNodes, fight: { getAliveEndCrystals: () => 0 },
    players: () => [player], heightAt: () => 60,
    random: seqRandom([1, 0]) // 1 -> skip nextInt(aliveCrystals+3)==0 (LandingApproach); 0 -> hit the strafe roll
  });
  d.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.HoldingPattern);
  const hp = d.getPhaseManager().getCurrent();
  hp.path = new ED.Path([]); // real ED.Path, empty -> isFinished() true, drives tickInRange's roll block
  hp.tickInRange();
  ok(d.getPhaseManager().getCurrent().getType().name === 'StrafePlayer',
    `a HoldingPattern dragon with a real closest player rolls into StrafePlayer, got ${d.getPhaseManager().getCurrent().getType().name}`);
  const spInst = d.getPhaseManager().getCurrent();
  ok(spInst.target === player, 'the switch goes through setTargetEntity() -- the StrafePlayer instance actually has the player as its target, not just the right phase type');
  ok(!!spInst.path && !!spInst.getPathTarget(), 'setTargetEntity() actually ran findPath()/followPath() -- a real path + path target, not null');

  // anti-vacuity #1: the SAME rigged-to-always-succeed random must NOT roll into StrafePlayer
  // when getClosestPlayer() finds nobody (empty players list) -- proves the switch is gated on
  // a REAL closest-player lookup, not just the random roll succeeding regardless.
  const d2 = new ED.EnderDragonEntity({
    pathNodes: ringNodes, fight: { getAliveEndCrystals: () => 0 },
    players: () => [], heightAt: () => 60,
    random: seqRandom([1, 0])
  });
  d2.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.HoldingPattern);
  const hp2 = d2.getPhaseManager().getCurrent();
  hp2.path = new ED.Path([]);
  hp2.tickInRange();
  okAv(d2.getPhaseManager().getCurrent().getType().name === 'HoldingPattern',
    `anti-vacuity: with NO closest player available (getClosestPlayer -> null), the SAME rigged-to-succeed random does NOT roll into StrafePlayer (.decomp's own \`$$3 != null &&\` guard) -- got ${d2.getPhaseManager().getCurrent().getType().name}`);

  // -- 7b. StrafePlayerPhase.serverTick() really drives movement via updatePath()/followPath(),
  // not a lookalike that leaves pathTarget alone.
  const d3 = new ED.EnderDragonEntity({ pathNodes: ED.buildPathNodes((x, z) => 60), fight: { getAliveEndCrystals: () => 0 } });
  d3.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.StrafePlayer);
  const sp3 = d3.getPhaseManager().getCurrent();
  sp3.setTargetEntity({ x: 100, y: 70, z: 100 });
  ok(!!sp3.getPathTarget(), 'setTargetEntity() produces a real {x,y,z} path target toward the target (not null)');

  sp3.pathTarget = { x: 10000, y: 70, z: 10000 }; // force serverTick's own out-of-range gate
  const origUpdatePath = ED.StrafePlayerPhase.prototype.updatePath;
  ED.StrafePlayerPhase.prototype.updatePath = function () {};
  sp3.serverTick();
  const brokenTarget = sp3.getPathTarget();
  ED.StrafePlayerPhase.prototype.updatePath = origUpdatePath;
  okAv(brokenTarget.x === 10000 && brokenTarget.z === 10000,
    'anti-vacuity: with updatePath() broken to a no-op, an out-of-range pathTarget is NEVER refreshed by serverTick() (proves serverTick() really calls updatePath(), not a lookalike that recomputes it some other way)');

  sp3.pathTarget = { x: 10000, y: 70, z: 10000 };
  sp3.serverTick();
  const fixedTarget = sp3.getPathTarget();
  ok(!(fixedTarget.x === 10000 && fixedTarget.z === 10000),
    `the REAL updatePath() does refresh an out-of-range pathTarget once restored, got ${JSON.stringify(fixedTarget)}`);

  // target-lost guard: a StrafePlayerPhase with no target reverts to HoldingPattern (.decomp's
  // own null-target fallback), asserted in BOTH directions -- WITH a target it must NOT bounce
  // back, and WITHOUT one it must.
  const d4 = new ED.EnderDragonEntity({ pathNodes: ED.buildPathNodes((x, z) => 60), fight: { getAliveEndCrystals: () => 0 } });
  d4.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.StrafePlayer);
  d4.getPhaseManager().getCurrent().serverTick();
  ok(d4.getPhaseManager().getCurrent().getType().name === 'HoldingPattern',
    `serverTick() with no target set reverts to HoldingPattern, got ${d4.getPhaseManager().getCurrent().getType().name}`);
  const d5 = new ED.EnderDragonEntity({ pathNodes: ED.buildPathNodes((x, z) => 60), fight: { getAliveEndCrystals: () => 0 } });
  d5.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.StrafePlayer);
  d5.getPhaseManager().getCurrent().setTargetEntity({ x: 20, y: 70, z: 20 });
  d5.getPhaseManager().getCurrent().serverTick();
  ok(d5.getPhaseManager().getCurrent().getType().name === 'StrafePlayer',
    `serverTick() with a real target set stays in StrafePlayer (does not spuriously bounce back), got ${d5.getPhaseManager().getCurrent().getType().name}`);
}


// ============ 8. rotation methods (getPitch/setPitch/getRotationVec/getRotationVectorFromPhase) =
{
  const DEG2RAD = Math.PI / 180.0;

  const d = freshDragon();
  d.setPitch(12.5);
  ok(d.getPitch() === 12.5, 'setPitch/getPitch round-trip');

  // getRotationVec: yaw=0, pitch=0 -> straight along +Z (Entity.getRotationVector, .decomp
  // verbatim: x=sinYaw*cosPitch, y=-sinPitch, z=cosYaw*cosPitch)
  d.setYaw(0); d.setPitch(0);
  const v0 = d.getRotationVec(1.0);
  ok(Math.abs(v0.x) < 1e-9 && Math.abs(v0.y) < 1e-9 && Math.abs(v0.z - 1) < 1e-9,
    `getRotationVec() at yaw=0/pitch=0 is (0,0,1), got (${v0.x}, ${v0.y}, ${v0.z})`);

  // pitch=90 -> straight down (y=-1), regardless of yaw
  d.setPitch(90);
  const vDown = d.getRotationVec(1.0);
  ok(Math.abs(vDown.y - -1) < 1e-6, `getRotationVec() at pitch=90 has y=-1 (straight down), got ${vDown.y}`);

  // getRotationVectorFromPhase: isSittingOrHovering (Hover) forces pitch to -45, then restores it
  const d2 = freshDragon();
  d2.setPitch(30); d2.setYaw(0);
  ok(d2.getPhaseManager().getCurrent().getType().name === 'Hover', 'a fresh dragon is in Hover (isSittingOrHovering)');
  const vecHover = d2.getRotationVectorFromPhase(1.0);
  const radP = -45 * DEG2RAD;
  const expY = -Math.sin(radP), expZ = Math.cos(0) * Math.cos(radP);
  ok(Math.abs(vecHover.y - expY) < 1e-6 && Math.abs(vecHover.z - expZ) < 1e-6,
    `Hover (isSittingOrHovering) forces pitch to -45 for the query, got vec=(${vecHover.x}, ${vecHover.y}, ${vecHover.z})`);
  ok(d2.getPitch() === 30, `getRotationVectorFromPhase restores the real pitch afterward (getPitch()=30), got ${d2.getPitch()}`);

  // Landing/Takeoff branch: pitch swapped to a distance-scaled dive/climb angle, then restored
  const d3 = new ED.EnderDragonEntity({ pathNodes: ED.buildPathNodes((x, z) => 60), heightAt: () => 100, x: 50, y: 60, z: 0 });
  d3.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.Takeoff);
  d3.setPitch(5); d3.setYaw(20);
  const vecTakeoff = d3.getRotationVectorFromPhase(1.0);
  const topY = 100;
  const dist = Math.max(Math.sqrt(Math.pow(0.5 - 50, 2) + Math.pow(topY + 0.5 - 60, 2) + Math.pow(0.5 - 0, 2)) / 4.0, 1.0);
  const factor = 6.0 / dist;
  const expectedPitch = -factor * 1.5 * 5.0;
  const rp = expectedPitch * DEG2RAD, ry = -20 * DEG2RAD;
  const ex = Math.sin(ry) * Math.cos(rp), ey = -Math.sin(rp), ez = Math.cos(ry) * Math.cos(rp);
  ok(Math.abs(vecTakeoff.x - ex) < 1e-9 && Math.abs(vecTakeoff.y - ey) < 1e-9 && Math.abs(vecTakeoff.z - ez) < 1e-9,
    `Takeoff phase's own dive/climb pitch-swap formula matches .decomp's (max(dist/4,1), 6/dist, *1.5*5), got (${vecTakeoff.x}, ${vecTakeoff.y}, ${vecTakeoff.z})`);
  ok(d3.getPitch() === 5, `getRotationVectorFromPhase restores the real pitch afterward under Takeoff too (getPitch()=5), got ${d3.getPitch()}`);

  const plainVec = d3.getRotationVec(1.0); // pitch is back to 5 here
  const realDiffers = Math.abs(vecTakeoff.y - plainVec.y) > 1e-6 || Math.abs(vecTakeoff.z - plainVec.z) > 1e-6;
  ok(realDiffers, "Takeoff's pitch-swapped vector genuinely differs from the base-pitch vector (proves the swap changes the answer, not just restores it)");

  const origSetPitch = ED.EnderDragonEntity.prototype.setPitch;
  ED.EnderDragonEntity.prototype.setPitch = function () {}; // break the swap entirely
  const brokenVec = d3.getRotationVectorFromPhase(1.0);
  ED.EnderDragonEntity.prototype.setPitch = origSetPitch;
  okAv(Math.abs(brokenVec.x - plainVec.x) < 1e-9 && Math.abs(brokenVec.y - plainVec.y) < 1e-9 && Math.abs(brokenVec.z - plainVec.z) < 1e-9,
    'anti-vacuity: with setPitch() broken to a no-op, getRotationVectorFromPhase falls back to the UNCHANGED base-pitch vector under Landing/Takeoff (proves the real code depends on setPitch() actually mutating pitch, not a lookalike that ignores it)');
}

// ============ 9. LandingApproachPhase drives toward the portal, hands off to Landing ===========
{
  const nodes9 = ED.buildPathNodes((x, z) => 60);
  const d9 = new ED.EnderDragonEntity({
    pathNodes: nodes9, x: nodes9[0].x, y: nodes9[0].y, z: nodes9[0].z,
    fight: { getAliveEndCrystals: () => 0 }, heightAt: () => 60, players: () => []
  });
  d9.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.LandingApproach);
  const lap = d9.getPhaseManager().getCurrent();
  ok(lap.getPathTarget() === null, 'a just-begun LandingApproachPhase has no path target yet');
  for (let i = 0; i < 80 && lap.getPathTarget() === null; i++) lap.serverTick();
  const target9 = lap.getPathTarget();
  ok(!!target9 && typeof target9.x === 'number' && typeof target9.y === 'number' && typeof target9.z === 'number',
    `serverTick() eventually produces a real {x,y,z} path target off the ring (no player -> the (40, topY, 0) branch), got ${JSON.stringify(target9)}`);

  // deterministic Landing hand-off: force a 1-node path and drive updatePath() directly (the
  // SAME "rig a real ED.Path by hand" shape section 7 already uses for StrafePlayerPhase).
  const d9x = new ED.EnderDragonEntity({ pathNodes: nodes9, fight: { getAliveEndCrystals: () => 0 }, heightAt: () => 60, players: () => [] });
  d9x.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.LandingApproach);
  const lapx = d9x.getPhaseManager().getCurrent();
  lapx.path = new ED.Path([{ x: 1, y: 60, z: 1 }]);
  lapx.updatePath();
  ok(d9x.getPhaseManager().getCurrent().getType().name === 'Landing',
    `LandingApproachPhase switches to Landing once a 1-node path is exhausted by followPath(), got ${d9x.getPhaseManager().getCurrent().getType().name}`);

  // anti-vacuity: with followPath() broken to a no-op, the SAME 1-node not-yet-finished path
  // never gets consumed, so updatePath() must NOT switch to Landing.
  const d9y = new ED.EnderDragonEntity({ pathNodes: nodes9, fight: { getAliveEndCrystals: () => 0 }, heightAt: () => 60, players: () => [] });
  d9y.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.LandingApproach);
  const lapy = d9y.getPhaseManager().getCurrent();
  lapy.path = new ED.Path([{ x: 1, y: 60, z: 1 }]);
  const origFollow9 = ED.LandingApproachPhase.prototype.followPath;
  ED.LandingApproachPhase.prototype.followPath = function () {};
  lapy.updatePath();
  ED.LandingApproachPhase.prototype.followPath = origFollow9;
  okAv(d9y.getPhaseManager().getCurrent().getType().name === 'LandingApproach',
    'anti-vacuity: with followPath() broken to a no-op, a not-yet-finished 1-node path never gets consumed, so updatePath() never switches to Landing (proves the hand-off really depends on followPath() advancing the path)');

  // the closest-player branch really biases the retarget off the player, not the no-player
  // (40, topY, 0) default -- spy on getNearestPathNodeIndex's own call args.
  const callsA = [];
  const d9c = new ED.EnderDragonEntity({
    pathNodes: nodes9, fight: { getAliveEndCrystals: () => 0 }, heightAt: () => 77,
    players: () => [{ x: 30, y: 5, z: 40 }]
  });
  const origGNPI = d9c.getNearestPathNodeIndex.bind(d9c);
  d9c.getNearestPathNodeIndex = function (x, y, z) { callsA.push([x, y, z]); return origGNPI(x, y, z); };
  d9c.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.LandingApproach);
  d9c.getPhaseManager().getCurrent().updatePath();
  ok(callsA.length === 2, `updatePath() calls getNearestPathNodeIndex exactly twice (from, to), got ${callsA.length}`);
  const len = Math.sqrt(30 * 30 + 40 * 40), normX = 30 / len, normZ = 40 / len;
  const expectedTo = [-normX * 40, 105, -normZ * 40];
  ok(Math.abs(callsA[1][0] - expectedTo[0]) < 1e-9 && callsA[1][1] === expectedTo[1] && Math.abs(callsA[1][2] - expectedTo[2]) < 1e-9,
    `with a real closest player, the 'to' node index call uses -normalize(player.x,player.z)*40 / 105, got ${JSON.stringify(callsA[1])}`);
}

// ============ 10. TakeoffPhase climbs away and hands off to HoldingPattern =====================
{
  const d10 = freshDragon();
  d10.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.Takeoff);
  const tp = d10.getPhaseManager().getCurrent();
  ok(tp.shouldFindNewPath === true, "beginPhase() starts shouldFindNewPath true (forces the very first tick to path)");
  ok(tp.getPathTarget() === null, 'a just-begun TakeoffPhase has no path target yet');
  tp.serverTick();
  ok(tp.shouldFindNewPath === false, "serverTick() flips shouldFindNewPath back to false after the first pathing tick");
  ok(!!tp.path, 'the first serverTick() produced a real ED.Path via updatePath()');

  // WARNING (own doc comment above): followPath() calls path.next() TWICE, not once -- a 1-node
  // path is therefore consumed entirely with NO pathTarget ever set; a 2-node path sets it to
  // the SECOND node. This is the exact quirk that would silently vanish if someone "cleaned up"
  // TakeoffPhase.followPath() to match every other phase's single-next() shape.
  const dOwner = freshDragon();
  const tp1 = new ED.TakeoffPhase(dOwner);
  tp1.path = new ED.Path([{ x: 11, y: 22, z: 33 }]);
  tp1.followPath();
  okAv(tp1.getPathTarget() === null,
    `anti-vacuity: TakeoffPhase.followPath() with a SINGLE-node path calls next() twice, exhausting it before a target is ever read (a single-next() "fix" would wrongly set one here) -- got ${JSON.stringify(tp1.getPathTarget())}`);

  const tp2 = new ED.TakeoffPhase(dOwner);
  tp2.path = new ED.Path([{ x: 11, y: 22, z: 33 }, { x: 44, y: 55, z: 66 }]);
  tp2.followPath();
  ok(!!tp2.getPathTarget() && tp2.getPathTarget().x === 44 && tp2.getPathTarget().z === 66,
    `TakeoffPhase.followPath() with a 2-node path reads/advances past the SECOND node (x=44,z=66), got ${JSON.stringify(tp2.getPathTarget())}`);

  // distance hand-off to HoldingPattern: within 10 blocks (block-CENTER distance) stays put;
  // past it switches. Boundary is checked at EXACTLY distSq===100 (10.0 blocks) since
  // Vec3i.isWithinDistance is strict-<, so 100 itself must count as "not within".
  const near = new ED.EnderDragonEntity({ pathNodes: ED.buildPathNodes((x, z) => 60), fight: { getAliveEndCrystals: () => 0 }, heightAt: () => 60, x: 0, y: 60, z: 0 });
  near.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.Takeoff);
  const tpNear = near.getPhaseManager().getCurrent();
  tpNear.shouldFindNewPath = false; tpNear.path = new ED.Path([{ x: 1, y: 60, z: 1 }]);
  tpNear.serverTick();
  ok(near.getPhaseManager().getCurrent().getType().name === 'Takeoff',
    `well within 10 blocks of the portal's top position, TakeoffPhase stays put, got ${near.getPhaseManager().getCurrent().getType().name}`);

  const far = new ED.EnderDragonEntity({ pathNodes: ED.buildPathNodes((x, z) => 60), fight: { getAliveEndCrystals: () => 0 }, heightAt: () => 60, x: 1000, y: 60, z: 1000 });
  far.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.Takeoff);
  const tpFar = far.getPhaseManager().getCurrent();
  tpFar.shouldFindNewPath = false; tpFar.path = new ED.Path([{ x: 1, y: 60, z: 1 }]);
  tpFar.serverTick();
  ok(far.getPhaseManager().getCurrent().getType().name === 'HoldingPattern',
    `far from the portal's top position, TakeoffPhase switches to HoldingPattern, got ${far.getPhaseManager().getCurrent().getType().name}`);

  const boundary = new ED.EnderDragonEntity({ pathNodes: ED.buildPathNodes((x, z) => 60), fight: { getAliveEndCrystals: () => 0 }, heightAt: () => 60, x: 10.5, y: 60.5, z: 0.5 });
  boundary.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.Takeoff);
  const tpB = boundary.getPhaseManager().getCurrent();
  tpB.shouldFindNewPath = false; tpB.path = new ED.Path([{ x: 1, y: 60, z: 1 }]);
  tpB.serverTick();
  okAv(boundary.getPhaseManager().getCurrent().getType().name === 'HoldingPattern',
    'anti-vacuity: at EXACTLY distSq===100 (10.0 blocks from the portal top BLOCK CENTER), Vec3i.isWithinDistance is strict-< so this is NOT within range -- TakeoffPhase must still switch (a distSq>100 test would wrongly stay in Takeoff here)');

  // updatePath()'s own ring-retarget really goes through getRotationVectorFromPhase(1.0), not a
  // bare getYaw()-only guess -- spy on getNearestPathNodeIndex's 'to' call args.
  const callsB = [];
  const d10e = new ED.EnderDragonEntity({ pathNodes: ED.buildPathNodes((x, z) => 60), fight: { getAliveEndCrystals: () => 0 }, heightAt: () => 60, x: 5, y: 60, z: 5 });
  d10e.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.Takeoff);
  d10e.setPitch(0); d10e.setYaw(90);
  const origGNPI2 = d10e.getNearestPathNodeIndex.bind(d10e);
  d10e.getNearestPathNodeIndex = function (x, y, z) { callsB.push([x, y, z]); return origGNPI2(x, y, z); };
  d10e.getPhaseManager().getCurrent().updatePath();
  const rv = d10e.getRotationVectorFromPhase(1.0); // pitch/yaw are unchanged externally, so this reproduces the same numbers updatePath() used internally
  ok(callsB.length === 2, `TakeoffPhase.updatePath() calls getNearestPathNodeIndex exactly twice (from, to), got ${callsB.length}`);
  ok(Math.abs(callsB[1][0] - (-rv.x * 40)) < 1e-6 && callsB[1][1] === 105 && Math.abs(callsB[1][2] - (-rv.z * 40)) < 1e-6,
    `TakeoffPhase.updatePath()'s 'to' node index call uses getRotationVectorFromPhase(1.0) scaled (-rv.x*40, 105, -rv.z*40), got ${JSON.stringify(callsB[1])}`);
}

// ============ 11. LandingPhase drops onto the portal, hands off to Sitting =====================
{
  const d11 = freshDragon();
  d11.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.Landing);
  const lp = d11.getPhaseManager().getCurrent();
  ok(lp.getPathTarget() === null, 'a just-begun LandingPhase has no path target yet');
  ok(lp.getMaxYAcceleration() === 1.5, `LandingPhase.getMaxYAcceleration() is 1.5 (.decomp verbatim), got ${lp.getMaxYAcceleration()}`);

  // getYawAcceleration() is LandingPhase's OWN override (capped/speed), NOT the default
  // AbstractPhase formula (0.7/capped/speed) -- anti-vacuity: assert the two differ for a
  // real non-trivial speed, so a "just inherited the default" regression is caught.
  d11.velocity = { x: 3, y: 0, z: 4 }; // horizontalSpeed = 5
  const ownYaw = lp.getYawAcceleration();
  const defaultYaw = ED.AbstractPhase.prototype.getYawAcceleration.call(lp);
  okAv(Math.abs(ownYaw - defaultYaw) > 1e-6,
    `LandingPhase.getYawAcceleration() (${ownYaw}) really differs from AbstractPhase's default (${defaultYaw}) -- a "forgot to override" regression would make these equal`);
  const wantYaw = Math.min(5 + 1, 40) / (5 + 1);
  ok(Math.abs(ownYaw - wantYaw) < 1e-9, `LandingPhase.getYawAcceleration() = min(speed,40)/speed = ${wantYaw}, got ${ownYaw}`);
  d11.velocity = { x: 0, y: 0, z: 0 };

  // serverTick(): target caches once (heightAt(0,0)+1 at block-center 0.5,0.5), then hands off
  // to SittingFlaming(.reset())+SittingScanning once within 1.0 block of it.
  const near11 = new ED.EnderDragonEntity({ pathNodes: ED.buildPathNodes((x, z) => 60), heightAt: () => 60, x: 0.5, y: 60.9, z: 0.5 });
  near11.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.Landing);
  const lpNear = near11.getPhaseManager().getCurrent();
  lpNear.serverTick(); // caches target
  const cachedTarget = lpNear.getPathTarget();
  ok(!!cachedTarget && cachedTarget.x === 0.5 && cachedTarget.y === 61 && cachedTarget.z === 0.5,
    `LandingPhase caches target={0.5, heightAt(0,0)+1, 0.5}, got ${JSON.stringify(cachedTarget)}`);
  ok(near11.getPhaseManager().getCurrent().getType().name === 'SittingScanning',
    `within 1.0 block of the target, LandingPhase hands off to SittingScanning, got ${near11.getPhaseManager().getCurrent().getType().name}`);
  const sfAfterLanding = near11.getPhaseManager().phases[ED.PHASE_TYPES.byName.SittingFlaming.id];
  ok(sfAfterLanding && sfAfterLanding.constructor === ED.SittingFlamingPhase,
    'LandingPhase also create()s a real SittingFlamingPhase instance (and calls reset() on it) even though it switches TO SittingScanning');

  // anti-vacuity: far away (>1.0 block), LandingPhase must NOT switch yet.
  const far11 = new ED.EnderDragonEntity({ pathNodes: ED.buildPathNodes((x, z) => 60), heightAt: () => 60, x: 50, y: 60, z: 50 });
  far11.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.Landing);
  far11.getPhaseManager().getCurrent().serverTick();
  okAv(far11.getPhaseManager().getCurrent().getType().name === 'Landing',
    `anti-vacuity: 1.0 block away from the portal target, LandingPhase must still be Landing (not yet switched), got ${far11.getPhaseManager().getCurrent().getType().name}`);

  // beginPhase() resets the cached target to null.
  const d11b = freshDragon();
  d11b.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.Landing);
  d11b.getPhaseManager().getCurrent().serverTick();
  d11b.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.Hover);
  d11b.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.Landing);
  ok(d11b.getPhaseManager().getCurrent().getPathTarget() === null, `beginPhase() resets the cached target to null, got ${JSON.stringify(d11b.getPhaseManager().getCurrent().getPathTarget())}`);
}

// ============ 12. SittingFlamingPhase: duration timer + timesRun-gated handoff =================
{
  const d12 = freshDragon();
  d12.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.SittingFlaming);
  const sf = d12.getPhaseManager().getCurrent();
  ok(sf.ticks === 0 && sf.timesRun === 1, `beginPhase() zeroes ticks and increments timesRun (first entry), got ticks=${sf.ticks} timesRun=${sf.timesRun}`);
  for (let i = 0; i < 199; i++) sf.serverTick();
  okAv(d12.getPhaseManager().getCurrent().getType().name === 'SittingFlaming',
    `anti-vacuity: at ticks=199 (one tick short of the 200-tick duration), SittingFlamingPhase must NOT have switched yet, got ${d12.getPhaseManager().getCurrent().getType().name}`);
  sf.serverTick(); // ticks -> 200
  ok(d12.getPhaseManager().getCurrent().getType().name === 'SittingScanning',
    `at ticks=200 with timesRun=1 (<4), SittingFlamingPhase hands off to SittingScanning, got ${d12.getPhaseManager().getCurrent().getType().name}`);

  // reset() + 4 full round trips through SittingFlaming must send it to Takeoff instead.
  const d12b = freshDragon();
  d12b.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.SittingFlaming);
  d12b.getPhaseManager().create(ED.PHASE_TYPES.byName.SittingFlaming).reset();
  for (let run = 0; run < 4; run++) {
    d12b.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.Hover);
    d12b.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.SittingFlaming);
    const cur = d12b.getPhaseManager().getCurrent();
    for (let i = 0; i < 200; i++) cur.serverTick();
  }
  ok(d12b.getPhaseManager().getCurrent().getType().name === 'Takeoff',
    `after reset() + 4 full 200-tick SittingFlaming round trips (timesRun reaches 4), the 5th duration timeout hands off to Takeoff instead of SittingScanning, got ${d12b.getPhaseManager().getCurrent().getType().name}`);

  // reset() itself really zeroes timesRun -- anti-vacuity: without calling it, timesRun would
  // already be nonzero from the FIRST setPhase in section 12 above (a fresh instance per dragon
  // proves reset() is a real state mutation, not a no-op).
  const d12c = freshDragon();
  d12c.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.SittingFlaming);
  d12c.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.Hover);
  d12c.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.SittingFlaming);
  const beforeReset = d12c.getPhaseManager().getCurrent().timesRun;
  okAv(beforeReset === 2, `anti-vacuity: two setPhase(SittingFlaming) entries with no reset() gives timesRun=2 (a reset()-always-runs bug would keep this at 1), got ${beforeReset}`);
  d12c.getPhaseManager().getCurrent().reset();
  ok(d12c.getPhaseManager().getCurrent().timesRun === 0, `reset() zeroes timesRun, got ${d12c.getPhaseManager().getCurrent().timesRun}`);
}

// ============ 13. SittingAttackingPhase: 40-tick timer back to SittingFlaming ===================
{
  const d13 = freshDragon();
  d13.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.SittingAttacking);
  const saPhase = d13.getPhaseManager().getCurrent();
  ok(saPhase.ticks === 0, `beginPhase() zeroes ticks, got ${saPhase.ticks}`);
  for (let i = 0; i < 40; i++) saPhase.serverTick();
  okAv(d13.getPhaseManager().getCurrent().getType().name === 'SittingAttacking',
    `anti-vacuity: post-increment semantics (ticks++ >= 40) mean the 40th call (ticks 0..39 consumed) does NOT yet switch, got ${d13.getPhaseManager().getCurrent().getType().name}`);
  saPhase.serverTick(); // the 41st call: ticks was 40, 40>=40 true
  ok(d13.getPhaseManager().getCurrent().getType().name === 'SittingFlaming',
    `the 41st serverTick() (ticks reaches 40) switches to SittingFlaming, got ${d13.getPhaseManager().getCurrent().getType().name}`);
}

// ============ 14. ChargingPlayerPhase: null-target abort + charge timer + distance/collision gate
{
  // null target: aborts to HoldingPattern immediately.
  const d14 = freshDragon();
  d14.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.ChargingPlayer);
  ok(d14.getPhaseManager().getCurrent().getPathTarget() === null, 'a just-begun ChargingPlayerPhase has no path target yet');
  ok(d14.getPhaseManager().getCurrent().getMaxYAcceleration() === 3.0, `ChargingPlayerPhase.getMaxYAcceleration() is 3.0, got ${d14.getPhaseManager().getCurrent().getMaxYAcceleration()}`);
  d14.getPhaseManager().getCurrent().serverTick();
  ok(d14.getPhaseManager().getCurrent().getType().name === 'HoldingPattern',
    `serverTick() with no pathTarget set aborts straight to HoldingPattern, got ${d14.getPhaseManager().getCurrent().getType().name}`);

  // a set target OUTSIDE the [100,22500] distSq band (i.e. mid-flight) does not tick the charge
  // counter at all -- anti-vacuity: only the distance/collision gate increments it.
  const d14b = new ED.EnderDragonEntity({ pathNodes: ED.buildPathNodes((x, z) => 60), x: 0, y: 60, z: 0 });
  d14b.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.ChargingPlayer);
  const cp = d14b.getPhaseManager().getCurrent();
  cp.setPathTarget({ x: 50, y: 60, z: 0 }); // distSq = 2500, inside [100,22500] -> mid-charge, no gate hit
  cp.serverTick();
  okAv(cp.chargingTicks === 0 && d14b.getPhaseManager().getCurrent().getType().name === 'ChargingPlayer',
    `anti-vacuity: a target well inside the [100,22500] band with no collision must NOT tick chargingTicks (chargingTicks=${cp.chargingTicks}) or switch phase yet`);

  // too close (distSq < 100) DOES tick the gate every serverTick from here on. NOTE the real
  // .decomp shape is `chargingTicks > 0 && chargingTicks++ >= 10` as the elseif, with a SEPARATE
  // `chargingTicks++` in the final else -- once chargingTicks > 0, a false elseif check STILL
  // increments it (side effect of evaluating the condition) before falling into the else's OWN
  // increment, so chargingTicks grows by 2 per tick, not 1, after the very first tick: 0->1 (t1,
  // elseif short-circuits at chargingTicks>0 with NO increment) ->3 (t2) ->5 (t3) ->7 (t4) ->9
  // (t5) ->11 (t6, elseif reads pre-increment 9 < 10, false, else adds 2 more) -- the switch
  // itself only fires on t7, when the elseif finally reads the pre-increment value 11 >= 10.
  cp.setPathTarget({ x: 1, y: 60, z: 0 }); // distSq = 1 < 100
  for (let i = 0; i < 6; i++) cp.serverTick();
  okAv(d14b.getPhaseManager().getCurrent().getType().name === 'ChargingPlayer' && cp.chargingTicks === 11,
    `anti-vacuity: the elseif's own chargingTicks++ (a side effect of a FALSE comparison) plus the else's separate increment means chargingTicks is already 11 (>10) after only 6 ticks yet must NOT have switched (the elseif only checks the PRE-increment value each call) -- chargingTicks=${cp.chargingTicks}, phase=${d14b.getPhaseManager().getCurrent().getType().name}`);
  cp.serverTick(); // 7th gate-hitting tick: elseif reads chargingTicks=11 (pre-increment), 11>=10 true
  ok(d14b.getPhaseManager().getCurrent().getType().name === 'HoldingPattern',
    `the 7th distance-gate tick (elseif finally reads chargingTicks>=10) switches back to HoldingPattern, got ${d14b.getPhaseManager().getCurrent().getType().name}`);

  // too far (distSq > 22500) also ticks the gate.
  const d14c = new ED.EnderDragonEntity({ pathNodes: ED.buildPathNodes((x, z) => 60), x: 0, y: 60, z: 0 });
  d14c.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.ChargingPlayer);
  const cp2 = d14c.getPhaseManager().getCurrent();
  cp2.setPathTarget({ x: 200, y: 60, z: 0 }); // distSq = 40000 > 22500
  for (let i = 0; i < 11; i++) cp2.serverTick();
  ok(d14c.getPhaseManager().getCurrent().getType().name === 'HoldingPattern',
    `distSq > 22500 (too far) also ticks the gate, reaching HoldingPattern after 11 ticks, got ${d14c.getPhaseManager().getCurrent().getType().name}`);

  // horizontalCollision/verticalCollision also tick the gate even mid-band.
  const d14d = new ED.EnderDragonEntity({ pathNodes: ED.buildPathNodes((x, z) => 60), x: 0, y: 60, z: 0 });
  d14d.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.ChargingPlayer);
  const cp3 = d14d.getPhaseManager().getCurrent();
  cp3.setPathTarget({ x: 50, y: 60, z: 0 }); // distSq = 2500, mid-band
  d14d.horizontalCollision = true;
  for (let i = 0; i < 11; i++) cp3.serverTick();
  ok(d14d.getPhaseManager().getCurrent().getType().name === 'HoldingPattern',
    `horizontalCollision=true ticks the gate even mid-band, reaching HoldingPattern after 11 ticks, got ${d14d.getPhaseManager().getCurrent().getType().name}`);
}

// ============ 15. AbstractSittingPhase.modifyDamageTaken: arrow immunity ========================
{
  const d15 = freshDragon();
  d15.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.SittingFlaming); // a real AbstractSittingPhase subclass
  const sf15 = d15.getPhaseManager().getCurrent();
  ok(sf15 instanceof ED.AbstractSittingPhase, 'SittingFlamingPhase really is an AbstractSittingPhase (chain check)');
  const arrowAmount = sf15.modifyDamageTaken({ source: 'projectile' }, 20);
  ok(arrowAmount === 0, `an arrow hit (source.source==='projectile') is reduced to 0 damage, got ${arrowAmount}`);
  const meleeAmount = sf15.modifyDamageTaken({ byPlayer: true }, 20);
  okAv(meleeAmount === 20, `anti-vacuity: a non-projectile hit must pass amount through UNCHANGED (an "always 0" bug would wrongly zero this too), got ${meleeAmount}`);
  const noSourceAmount = sf15.modifyDamageTaken(null, 20);
  ok(noSourceAmount === 20, `a null source (no source && guard) passes amount through unchanged, got ${noSourceAmount}`);

  // end-to-end through the real damagePart() routing this file's own section 4 already covers,
  // proving modifyDamageTaken is actually WIRED (phase.modifyDamageTaken() call inside
  // damagePart), not just a standalone method nobody calls.
  const d15b = freshDragon();
  d15b.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.SittingAttacking);
  const beforeHp = d15b.getHealth();
  const arrowApplied = d15b.head.damage({ byPlayer: true, source: 'projectile' }, 50);
  ok(arrowApplied === false && d15b.getHealth() === beforeHp,
    `damagePart() with an arrow-flagged player hit while sitting/attacking applies NO health loss (modifyDamageTaken zeroed it before the < 0.01 return-false gate), health stayed ${d15b.getHealth()}`);

  // it must be SittingAttacking/SittingFlaming/SittingScanning-SPECIFIC -- a non-sitting phase
  // (Takeoff) must NOT get the same immunity (AbstractPhase's own default modifyDamageTaken is
  // a pass-through, not an override).
  const d15c = freshDragon();
  d15c.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.Takeoff);
  const beforeHp2 = d15c.getHealth();
  d15c.head.damage({ byPlayer: true, source: 'projectile' }, 50);
  okAv(d15c.getHealth() < beforeHp2,
    `anti-vacuity: the SAME arrow-flagged hit against a non-sitting phase (Takeoff) is NOT immune -- health must actually drop (a global "always immune" bug would wrongly leave this unchanged), dropped to ${d15c.getHealth()}`);
}

// ============ 16. ED.OWED's motionFor/canSpawn item: now a real wire-up test ==================
{
  // (a) .decomp fact: EnderDragonEntity.java's own tickMovement() override NEVER calls
  // super.tickMovement() anywhere in the file, so LivingEntity.travel() (0.08 gravity/0.98
  // drag) is never reached -- the fact D-804 asked be pinned down. Still true, still checked.
  const dragonSrc = readFileSync(
    join(MCLITE_ROOT, '.decomp/net/minecraft/entity/boss/dragon/EnderDragonEntity.java'), 'utf8');
  ok(!/super\.tickMovement\(\)/.test(dragonSrc),
    "EnderDragonEntity.java's own tickMovement() override never calls super.tickMovement() -- travel()'s 0.08 gravity/0.98 drag is never reached (D-804/D-309)");

  // anti-vacuity: the SAME regex-based check, pointed at WitherEntity.java (whose own
  // tickMovement() DOES fall through to LivingEntity's default per 07i_entitylist.js's own
  // `wither` row/comment) -- proves this is a real discriminator, not a pattern that can never
  // match `super.tickMovement()` at all.
  const witherSrc = readFileSync(
    join(MCLITE_ROOT, '.decomp/net/minecraft/entity/boss/WitherEntity.java'), 'utf8');
  okAv(/super\.tickMovement\(\)/.test(witherSrc),
    'anti-vacuity: the same check DOES find super.tickMovement() in WitherEntity.java (a class that really does fall through to the LivingEntity default) -- proves the regex can match, not just always report "not found"');

  // (b) loop/enderdragon-wiring: the hook now exists (ED.initEntity/ED.tickEntity,
  // 07zzl_enderdragon.js), so EL.motionFor/EL.canSpawn now accept ender_dragon the SAME
  // "[0, 1] sentinel, real per-tick hook drives it" way ghast/wither_skull already do.
  ok(Array.isArray(EL16.motionFor('ender_dragon')) && EL16.motionFor('ender_dragon')[0] === 0 && EL16.motionFor('ender_dragon')[1] === 1,
    "EL.motionFor('ender_dragon') is now [0, 1] (real per-tick hook, not a statue sentinel) -- got " + JSON.stringify(EL16.motionFor('ender_dragon')));
  ok(EL16.canSpawn('ender_dragon') === true, "EL.canSpawn('ender_dragon') is now true");

  // anti-vacuity: the SAME two calls, for a type this engine has always simulated (`wither`) --
  // proves the true/[0,1] result above is ender_dragon's own real row, not `EL16` itself
  // resolving every type to a truthy default.
  okAv(EL16.canSpawn('wither') === true && Array.isArray(EL16.motionFor('wither')),
    'anti-vacuity: EL.canSpawn(\'wither\')/motionFor(\'wither\') DO resolve on this SAME EL16 instance -- proves ender_dragon\'s new [0,1]/true above is real, not EL16 itself resolving everything to a truthy default');

  // (c) the spawn + one real tick actually moves -- proves the bridge is live, not just the
  // gate flipped with nothing behind it (the exact "permanently motionless statue" this file's
  // own header once warned a bare row would be).
  const dw = EL16.spawn('ender_dragon', 0, 200, 0, {});
  ok(!!dw && dw.type === 'ender_dragon', "EL.spawn('ender_dragon', ...) returns a real dragon");
  ok(!!dw.dragon && dw.dragon.parts.length === 8, 'EL.spawn attaches the 8-part ED.EnderDragonEntity rig (e.dragon)');
  const sx = dw.x, sy = dw.y, sz = dw.z;
  for (let i = 0; i < 20; i++) EL16.tickMob(dw);
  const moved = (dw.x !== sx) || (dw.y !== sy) || (dw.z !== sz);
  okAv(moved, `anti-vacuity: 20 real EL.tickMob(dragon) ticks actually changed x/y/z (${sx},${sy},${sz}) -> (${dw.x},${dw.y},${dw.z}) -- a wired-but-inert bridge would leave position exactly at spawn`);
  ok(dw.dragon.getPhaseManager().getCurrent().getType() === M16.EnderDragon.PHASE_TYPES.byName.HoldingPattern,
    'a fresh /summon-style spawn is seeded into HoldingPattern (no EnderDragonFight to hand it a different starting phase, ED.OWED item 2 still absent)');
}

// ============ #4800 canTarget: creative/spectator players are not targeted =======================
{
  const cre = { type: 'player', x: 0, y: 70, z: 0, invulnerableGamemode: true };
  const sur = { type: 'player', x: 0, y: 70, z: 0 };
  const mk = (ps) => new M16.EnderDragon.EnderDragonEntity({ pathNodes: M16.EnderDragon.buildPathNodes(() => 60), fight: { getAliveEndCrystals: () => 0 }, heightAt: () => 60, players: () => ps });
  const dc = mk([cre]);
  ok(dc.getClosestPlayer(0, 70, 0) === null, 'creative player: getClosestPlayer == null');
  const ds = mk([cre, sur]);
  okAv(ds.getClosestPlayer(0, 70, 0) === sur, 'anti-vacuity: survival player alongside creative is still found');
}

// ============ HoverPhase is a real phase (HoverPhase.java) ====================================
{
  const d = freshDragon();
  const pm = d.getPhaseManager();
  pm.setPhase(ED.PHASE_TYPES.byName.HoldingPattern);
  pm.setPhase(ED.PHASE_TYPES.byName.Hover);
  const h = pm.getCurrent();
  okAv(h instanceof ED.HoverPhase && h.getType().name === 'Hover', 'Hover resolves to ED.HoverPhase, not a bare AbstractPhase');
  ok(h.getPathTarget() === null, 'Hover target null after beginPhase');
  const p0 = { x: d.getX(), y: d.getY(), z: d.getZ() };
  h.serverTick();
  d.setPosition ? d.setPosition(p0.x + 5, p0.y + 3, p0.z - 2) : (d.x += 5);
  for (let i = 0; i < 20; i++) h.serverTick();
  const t = h.getPathTarget();
  ok(t && t.x === p0.x && t.y === p0.y && t.z === p0.z, 'Hover target stays the first-tick position over 20 ticks');
  ok(h.getMaxYAcceleration() === 1.0 && h.isSittingOrHovering() === true, 'Hover maxYAcceleration 1.0, sittingOrHovering true');
  h.beginPhase();
  ok(h.getPathTarget() === null, 'beginPhase clears the Hover target');
}

console.log(`\n${pass} checks passed, ${breaks} anti-vacuity break(s) proved, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log('  x ' + f);
  process.exit(1);
}
