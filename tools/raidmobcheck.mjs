#!/usr/bin/env node
// raidmobcheck.mjs — QUEUE 0.2 raid loop (loop/illagers-s92): the raid mobs EXIST. Proves the
// three things `07s_raid.js`'s own header used to say were missing for vindicator/evoker/
// pillager/witch/ravager/illusioner — resolved motion (`extract-entity-motion.mjs`'s new
// class-hierarchy walk, GENERIC_CANDIDATES), a real `Ai.ROSTER` entry wired through
// `EL.aiCtx`/`EL.tick()` exactly like `aicheck.mjs` already proves for cow/zombie, and (for
// pillager) the real charge/hold/fire `Ai.CrossbowAttackGoal` state machine — against an
// ACTUALLY SPAWNED mob, not a synthetic fixture. `vex` was, until loop/raidvex-s96, the
// deliberate exception asserted to be UNSPAWNABLE (`VexEntity.tick()`'s own unconditional
// `setNoGravity(true)` — no gravity to resolve). §1 below still proves it has no MEASURED
// motion row (that finding did not change); §2 now proves it spawns anyway, through the
// same `[0, 1]` hardcode `evoker_fangs` already had — the full vex substrate has its own
// check, `raidvexcheck.mjs`.
//
//   node tools/raidmobcheck.mjs [--verbose]

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; if (VERBOSE) console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };

console.log('raidmobcheck — QUEUE 0.2 raid loop: vindicator/evoker/pillager/witch/ravager/illusioner EXIST');

const M = loadEngine({
  // loop/spells-s93 — `07k_goals.js`'s evoker/illusioner roster entries now construct
  // `NS.Spell.*Goal`s (07v_spell.js); AFTER 07q_effects.js (NS.Spell.init needs NS.Effects),
  // BEFORE 07k_goals.js (build.mjs's own order — see there).
  // D-602 (raidergoals) added `02g_items.js`/`02f_tags.js`/`14f_inventory.js`/`07y_equip.js`/
  // `07b_behaviour.js`/`07l_spawn.js` — merchant/iron-golem/johnny targeting, the vindicator's
  // own BreakDoorGoal (needs `M.Diff`, `07l_spawn.js`) and the CrossbowAttackGoal
  // isEntityHoldingCrossbow() gate (needs `NS.Equip`/`NS.Items` real, not the "always assumed"
  // fallback) all need real equipment/items/door-block/difficulty modules §4 never did —
  // `build.mjs`'s own order (villagegolemcheck.mjs's own EXTRA list already proves this exact
  // module set loads and inits cleanly together for villager/iron_golem, reused here).
  extra: ['02g_items.js', '02f_tags.js', '07_world.js', '07b_behaviour.js', '07h_entities.js',
          '07y_equip.js', '07i_entitylist.js', '14b_physics.js', '14d_survival.js',
          '14f_inventory.js', '14i_hand.js', '07q_effects.js', '14j_combat.js', '07v_spell.js',
          '07k_goals.js', '07l_spawn.js', '07s_raid.js',
          // loop/raidvex-s96 -- `Ai.ROSTER.vex` (07k_goals.js) constructs `NS.Fly.
          // VexMoveControl`; `07t_fly.js` is loaded straight after, matching build.mjs's own
          // relative order (it does not matter which loads first — ROSTER factories are only
          // ever CALLED at spawn time, after every module has finished loading).
          '07t_fly.js', '07zx_particle.js']
});
const entitiesJson = JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'));
M.DATA = Object.assign({}, M.DATA, { entities: entitiesJson });
M.Entities.init();
{
  const imeta = JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8'));
  M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: imeta.rawBytes });
}
M.EntityList.init();
M.Hand.init();
M.Combat.init();
M.Ai.init();
M.Equip.init();
ok(M.Entities.ready, 'the entity table loaded');
ok(M.Ai.ready, 'Ai module reports ready');
ok(M.Equip.ready, 'D-602: Equip module reports ready (real crossbow/bow-holding reads, not the "always assumed" fallback)');

const EL = M.EntityList, Ai = M.Ai, Cb = M.Combat, W = M.World, CH = M.CH, Diff = M.Diff, Eq = M.Equip, IT = M.Items;
const stateOf = (n) => M.States.stateOf(n) | 0;
const STONE = stateOf('stone');
const PLAT_Y = 8;
M.Behave.init(M.World);

function freshWorld() {
  W.init(1);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
    const c = W.makeChunk(cx, cz);
    c.state = CH.GENERATED;
    W.chunks.set(W.key(cx, cz), c);
  }
  ok(W.loadedAt(0, 0), 'a chunk is loaded to place into');
}
function plate(radius) {
  for (let x = -radius; x <= radius; x++) for (let z = -radius; z <= radius; z++) {
    W.setBlock(x, PLAT_Y, z, STONE);
  }
}
function mkPlayer(over) {
  return Object.assign({
    x: 0, y: PLAT_Y + 1, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, slot: 0, inventory: null,
    sprinting: false, onGround: true, fallDistance: 0, onClimbable: false, inWater: false,
    walkDist: 0, walkDistO: 0, speed: 0.1, health: 20
  }, over || {});
}

const RAID_MOBS = ['vindicator', 'pillager', 'witch', 'ravager', 'evoker', 'illusioner'];

// ═══ 1. MOTION — extract-entity-motion.mjs's new hierarchy walk actually reached these six ═══
console.log('\n 1. gravity/drag resolved for all six raiders (D-390\'s generic-inherited path)');
for (const name of RAID_MOBS) {
  const row = entitiesJson.motion && entitiesJson.motion[name];
  ok(!!row, `${name} has a motion row in assets/entities.json`);
  if (row) {
    ok(row[0] === 0.08, `${name}'s gravity is 0.08 — LivingEntity's own generic body (axy.h()), same as cow/zombie/villager`);
    ok(Math.abs(row[1] - 0.98) < 1e-6, `${name}'s drag is 0.98 — same generic body`);
  }
}
// vex: the deliberate exclusion. It flies (setNoGravity(true) every tick, VexEntity.java/bmr.k()
// read in full) — it must NOT have gained a motion row, or this whole unit's finding is wrong.
ok(!entitiesJson.motion || !entitiesJson.motion.vex, 'vex carries NO motion row — it has no gravity to resolve, not an unread one');

// ═══ 2. EL.spawn — every raider spawns; vex (loop/raidvex-s96) now spawns too ════════════
console.log('\n 2. EL.spawn accepts all six raiders, and vex (loop/raidvex-s96 — see raidvexcheck.mjs)');
freshWorld();
plate(20);
{
  let x = -15;
  for (const name of RAID_MOBS) {
    const e = EL.spawn(name, x, PLAT_Y + 1, 0);
    x += 4;
    ok(!!e, `EL.spawn('${name}') returns a live entity`);
    ok(!!e && e.ai instanceof Ai.GoalSelector, `the spawned ${name} carries a real GoalSelector (Ai.ROSTER.${name} wired), not a stub`);
  }
  // loop/raidvex-s96 -- vex now spawns too (`EL.motionFor`'s own `[0, 1]` hardcode,
  // 07i_entitylist.js — inert, since `Fl.VexMoveControl` sets `e.noGravity` itself every
  // tick); the FULL vex substrate (motion/goals/summon) has its own check, raidvexcheck.mjs.
  const vex = EL.spawn('vex', 0, PLAT_Y + 1, 5);
  ok(!!vex, "EL.spawn('vex') now succeeds (raidvexcheck.mjs proves the rest)");
  EL.clear();
}

// ANTI-VACUITY: corrupt vindicator's own motion row and prove EL.spawn's refusal fires on it
// too — the same mechanism that (correctly) refuses vex must (correctly) have been the thing
// letting vindicator through, not some other, accidental path.
{
  const saved = entitiesJson.motion.vindicator;
  delete entitiesJson.motion.vindicator;
  const e = EL.spawn('vindicator', 0, PLAT_Y + 1, 0);
  okAv(e === null || e === undefined, "with vindicator's motion row removed, EL.spawn refuses it — the gate is real, not luck");
  entitiesJson.motion.vindicator = saved;
  const e2 = EL.spawn('vindicator', 0, PLAT_Y + 1, 0);
  ok(!!e2, 'restoring the row lets it spawn again');
  EL.clear();
}

// ANTI-VACUITY: empty Ai.ROSTER and prove a freshly-spawnable raider gets no goal selector —
// the same rule aicheck.mjs already proves for cow, re-proved here for a NEW roster entry so
// this unit did not accidentally special-case its own six mobs around that gate.
{
  const savedRoster = Ai.ROSTER;
  Ai.ROSTER = {};
  const e = EL.spawn('pillager', 0, PLAT_Y + 1, 0);
  okAv(!!e && e.ai === undefined, 'with Ai.ROSTER emptied, a pillager spawns with no goal selector at all');
  Ai.ROSTER = savedRoster;
  EL.clear();
}

// ═══ 3. vindicator — a live-spawned melee raider actually walks up and swings ══════════════
console.log('\n 3. a live vindicator targets, closes on and attacks the live player');
freshWorld();
plate(20);
{
  // 1.4 blocks away — inside Ai.attackReachSqr once closed, same convention aicheck.mjs's
  // own § 5 uses for zombie ("0.5 blocks away — inside attackReachSqr"); MeleeAttackGoal's own
  // path-vs-attack-reach gap (it stops repathing at Ai.MELEE_REACH, a looser radius than the
  // attack check) means a mob spawned far away converges to just outside strike range and
  // never closes the last half-block — a pre-existing characteristic of the shared goal, not
  // something this unit's six mobs introduced, so the fixture starts close the same way.
  M.Player = mkPlayer({ x: 1.4, y: PLAT_Y + 1, z: 0 });
  const vind = EL.spawn('vindicator', 0, PLAT_Y + 1, 0);
  const hp0 = M.Player.health;
  for (let t = 0; t < 100 && M.Player.health === hp0; t++) EL.tick();
  ok(vind.target === M.Player, "the vindicator's own e.target is the live Player, via NearestAttackableTargetGoal");
  ok(M.Player.health < hp0, `the player's health dropped (${hp0} -> ${M.Player.health}) — MeleeAttackGoal actually landed a hit through Cb.mobAttack, not merely approached`);
  EL.clear();
}

// ═══ 4. pillager — the real CrossbowAttackGoal charge/hold/fire state machine fires an arrow ═
console.log('\n 4. a live pillager runs CrossbowAttackGoal through to a real fired arrow');
freshWorld();
plate(20);
{
  M.Player = mkPlayer({ x: 6, y: PLAT_Y + 1, z: 0 });
  const pil = EL.spawn('pillager', 0, PLAT_Y + 1, 0);
  const arrowsBefore = EL.list.filter((o) => o.type === 'arrow').length;
  let firedAt = -1;
  const snd = []; const origSound = M.Sound;
  M.Sound = { play: (n, o) => { if (/^item\.crossbow\./.test(n)) snd.push(n + '@' + o.source); }, mobSound: (e, n) => { if (/^item\.crossbow\./.test(n)) snd.push(n + '@mob'); return true; } };
  for (let t = 0; t < 200; t++) {
    EL.tick();
    if (firedAt < 0 && EL.list.some((o) => o.type === 'arrow')) firedAt = t;
  }
  ok(pil.target === M.Player, "the pillager's own e.target is the live Player");
  // D-602: `firedAt >= 0`, not a before/after COUNT comparison — a fired arrow can already have
  // ticked itself out (`Combat.tickArrow`) by the end of a 200-tick window once the real
  // `seeingTargetTicker` LOS ramp (this pass) lets the charge cycle start sooner than the old
  // "out of range only" `wantsToMove` did; the count comparison was measuring survival, not firing.
  ok(firedAt >= 0, `CrossbowAttackGoal's charge (${Ai.CROSSBOW_PULL_TICKS} ticks) -> charged-hold -> fire cycle produced a real arrow entity by tick ${firedAt < 0 ? '(never)' : firedAt}`);
  void arrowsBefore;
  M.Sound = origSound;
  const tl = snd.slice(0, 2).join();
  ok(tl === 'item.crossbow.loading_start@mob,item.crossbow.loading_middle@mob', `crossbow charge sound timeline (usageTick): ${tl}`);
  EL.clear();
}

// ANTI-VACUITY: break CROSSBOW_PULL_TICKS to something the 200-tick window can never clear,
// and prove no arrow fires — the goal must actually be gated on the charge timer, not free-firing.
{
  const savedTicks = Ai.CROSSBOW_PULL_TICKS;
  Ai.CROSSBOW_PULL_TICKS = 100000;
  freshWorld();
  plate(20);
  M.Player = mkPlayer({ x: 6, y: PLAT_Y + 1, z: 0 });
  EL.spawn('pillager', 0, PLAT_Y + 1, 0);
  for (let t = 0; t < 200; t++) EL.tick();
  okAv(!EL.list.some((o) => o.type === 'arrow'), 'with the charge time broken to 100000 ticks, no arrow fires in a 200-tick window — the gate is real');
  Ai.CROSSBOW_PULL_TICKS = savedTicks;
  EL.clear();
}

// ═══ 5. witch/evoker/illusioner/ravager — exist, carry a live GoalSelector, do not crash ═════
console.log('\n 5. witch/evoker/illusioner/ravager tick cleanly for 100 real ticks (no crash, no NaN)');
freshWorld();
plate(20);
{
  M.Player = mkPlayer({ x: 5, y: PLAT_Y + 1, z: 0 });
  const mobs = {
    witch: EL.spawn('witch', -6, PLAT_Y + 1, 0),
    evoker: EL.spawn('evoker', -3, PLAT_Y + 1, 4),
    illusioner: EL.spawn('illusioner', 3, PLAT_Y + 1, 4),
    ravager: EL.spawn('ravager', 6, PLAT_Y + 1, -4)
  };
  for (const n in mobs) ok(!!mobs[n], `${n} spawned`);
  for (let t = 0; t < 100; t++) EL.tick();
  for (const n in mobs) {
    const e = mobs[n];
    ok(Number.isFinite(e.x) && Number.isFinite(e.y) && Number.isFinite(e.z), `${n}'s position stayed finite over 100 ticks`);
  }
  const hp0 = M.Player.health;
  ok(M.Player.health <= hp0, 'ravager (real MeleeAttackGoal) did not raise the player\'s health — sanity, not a real assertion of a hit landing this run');
  EL.clear();
}

// ═══ 6. D-602 (raidergoals): vindicator/ravager's own ActiveTargetGoal(Merchant/IronGolem) ═══
console.log('\n 6. vindicator/ravager\'s own ActiveTargetGoal(Merchant)/ActiveTargetGoal(IronGolem)');
freshWorld();
plate(20);
{
  const savedPlayer = M.Player;
  M.Player = null;   // no player at all -> priority-2 ActiveTargetGoal(Player) never fires,
                      // leaving priority-3 Merchant/IronGolem targeting free to prove itself

  const vind = EL.spawn('vindicator', 0, PLAT_Y + 1, 0);
  const villager = EL.spawn('villager', 3, PLAT_Y + 1, 0);
  for (let t = 0; t < 400 && !vind.target; t++) EL.tick();   // reciprocalChance rolls: tick until acquired
  ok(vind.target === villager, "vindicator's own ActiveTargetGoal(Merchant): with no player and a live villager in range, e.target becomes the villager");
  EL.clear();

  // ANTI-VACUITY: no merchant, no golem, no player anywhere -- the vindicator must never
  // acquire a target at all (proves the scan is a real candidate list, not "anything nearby").
  const vind2 = EL.spawn('vindicator', 0, PLAT_Y + 1, 0);
  for (let t = 0; t < 20; t++) EL.tick();
  okAv(!vind2.target, 'anti-vacuity: with no player and no merchant/golem live anywhere, the vindicator never acquires e.target');
  EL.clear();

  const rav = EL.spawn('ravager', 0, PLAT_Y + 1, 0);
  const golem = EL.spawn('iron_golem', 3, PLAT_Y + 1, 0);
  for (let t = 0; t < 400 && !rav.target; t++) EL.tick();
  ok(rav.target === golem, "ravager's own ActiveTargetGoal(IronGolem): e.target becomes the nearby live iron golem");
  EL.clear();

  // ravager's own `ActiveTargetGoal(Merchant, true, !isBaby())` filter -- BOTH directions: a
  // baby villager is refused (the illegal target), an adult one right after is accepted (the
  // legal one) -- "a rule that refuses a legal target is as wrong as one that allows an
  // illegal one" applies to a refusal that never lifts too.
  const rav2 = EL.spawn('ravager', 0, PLAT_Y + 1, 0);
  const babyV = EL.spawn('villager', 2, PLAT_Y + 1, 0);
  babyV.isBaby = true;
  for (let t = 0; t < 20; t++) EL.tick();
  okAv(!rav2.target, "anti-vacuity: ravager's own !isBaby() filter refuses the ONLY live merchant in range when it is a baby villager");
  const adultV = EL.spawn('villager', 5, PLAT_Y + 1, 0);
  for (let t = 0; t < 400 && !rav2.target; t++) EL.tick();
  ok(rav2.target === adultV, 'the SAME ravager targets an adult villager the moment one is live -- the filter refuses the illegal target, not merchants outright');
  EL.clear();

  M.Player = savedPlayer;
}

// ═══ 6b. #1604: RavagerEntity.PathNodeMaker.adjustNodeType maps LEAVES -> OPEN ═══════════════
console.log('\n 6b. ravager paths through leaves (OPEN); every other mob treats them as BLOCKED');
freshWorld();
plate(10);
{
  const LEAVES = stateOf('oak_leaves');
  W.setBlock(3, PLAT_Y + 1, 0, LEAVES);
  W.setBlock(3, PLAT_Y + 2, 0, LEAVES);
  const T = Ai.NodeType;
  const rav = EL.spawn('ravager', 0, PLAT_Y + 1, 5);
  const zom = EL.spawn('zombie', 0, PLAT_Y + 1, -5);
  ok(Ai.mobNodeType(rav, 3, PLAT_Y + 1, 0) !== T.BLOCKED, 'ravager: a leaf cell is passable (vanilla LEAVES -> OPEN, so the 2x2 box reads WALKABLE here)');
  ok(Ai.mobNodeType(zom, 3, PLAT_Y + 1, 0) === T.BLOCKED, 'zombie: a leaf cell stays BLOCKED (LandPathNodeMaker)');
  // ANTI-VACUITY: the same ravager with the ravager branch gone (type swapped) must read BLOCKED
  const t0 = rav.type; rav.type = 'zombie';
  okAv(Ai.mobNodeType(rav, 3, PLAT_Y + 1, 0) === T.BLOCKED, 'without the ravager branch the leaf cell reads BLOCKED');
  rav.type = t0;
  EL.clear();
}

// ═══ 7. D-602 (raidergoals): group RevengeGoal (RaiderEntity, cross-species, setGroupRevenge) ═
console.log('\n 7. group RevengeGoal alerts every OTHER live raider regardless of species, and only raiders');
freshWorld();
plate(20);
{
  const savedPlayer = M.Player;
  M.Player = null;
  const attacker = { x: 0, y: PLAT_Y + 1, z: 0, dead: false, removed: false, type: 'zombie' };

  const pil = EL.spawn('pillager', 0, PLAT_Y + 1, 0);
  const pil2 = EL.spawn('pillager', 3, PLAT_Y + 1, 0);      // same class, in range
  const farPil = EL.spawn('pillager', 19, PLAT_Y + 1, 19);  // same class, beyond followRange
  const rav = EL.spawn('ravager', -3, PLAT_Y + 1, 0);       // a DIFFERENT raider type: NOT alerted (callSameTypeForRevenge)
  const cow = EL.spawn('cow', -3, PLAT_Y + 1, 3);
  farPil.x = 200;
  pil.lastHurtByEntity = attacker;
  pil.hurtSeq = (pil.hurtSeq || 0) + 1;
  EL.tick();

  ok(pil.target === attacker, "the hit pillager's own RevengeGoal.start() sets e.target to the attacker");
  ok(pil2.target === attacker, 'a same-class mate in range is alerted');
  okAv(!rav.target, 'a different raider class is NOT alerted');
  okAv(!farPil.target, 'a same-class mate beyond followRange is NOT alerted');
  okAv(!cow.target, 'a non-raider is not alerted');
  EL.clear();
  const r2 = EL.spawn('ravager', 0, PLAT_Y + 1, 0);
  r2.lastHurtByEntity = { x: 1, y: PLAT_Y + 1, z: 0, dead: false, removed: false, type: 'vindicator' };
  r2.hurtSeq = 1;
  EL.tick();
  okAv(!r2.target, 'a ravager never takes revenge on a raider attacker (noRevengeTypes=RaiderEntity)');
  EL.clear();

  M.Player = savedPlayer;
}

// ═══ 8. D-602 (raidergoals): vindicator's own BreakDoorGoal (NORMAL/HARD gate + hasActiveRaid) ═
console.log('\n 8. vindicator\'s own BreakDoorGoal -- real NORMAL/HARD difficulty gate + hasActiveRaid()');
{
  function placeDoor(x, y, z) {
    const lower = stateOf('oak_door');
    const upper = M.Behave.setProp(lower, 'half', 'upper');
    W.setBlock(x, y, z, lower);
    W.setBlock(x, y + 1, z, upper);
  }
  const savedRand = Math.random, savedRM = M.RaidManager, savedRaidNS = M.Raid, savedDiff = Diff.value;
  Math.random = () => 0;   // forces the 1-in-10 canStart roll to always pass, for a deterministic test
  M.Raid = { Status: { ONGOING: 'ongoing' } };
  Diff.set('normal');

  // POSITIVE: an ongoing raid + NORMAL difficulty + an adjacent closed wooden door -> the real
  // 240-tick progress gauge runs to completion and the door is actually gone.
  freshWorld();
  plate(10);
  placeDoor(1, PLAT_Y + 1, 0);
  const e1 = EL.spawn('vindicator', 0, PLAT_Y + 1, 0);
  e1.target = { x: 3, y: PLAT_Y + 1, z: 0, dead: false, removed: false };
  e1.raidId = 1;
  e1.navPath = [0, 1, 2].map(x => ({ x, y: PLAT_Y, z: 0 })); e1.navIdx = 0;   // #5069: BreakDoorGoal reads the live path record
  M.RaidManager = { world: { raids: { 1: { status: 'ongoing' } } } };
  const g1 = new Ai.VindicatorBreakDoorGoal(e1, Object.assign({}, EL.aiCtx(e1), { random: () => 0 }));
  ok(g1.canUse(), 'ongoing raid + NORMAL difficulty + adjacent closed wooden door: canUse() opens');
  g1.start();
  for (let t = 0; t < Ai.DOOR_BREAK_TICKS + 5 && g1.canContinueToUse(); t++) g1.tick();
  ok(Ai.doorAt(1, PLAT_Y + 1, 0) === null, 'the door is gone once the real progress gauge (Ai.DOOR_BREAK_TICKS) runs to completion');
  EL.clear();

  // ANTI-VACUITY #1: identical door/difficulty setup, but the raid is NOT ongoing (VICTORY) --
  // canUse() must refuse outright, proving hasActiveRaid() is a real gate, not decorative.
  freshWorld();
  plate(10);
  placeDoor(1, PLAT_Y + 1, 0);
  const e2 = EL.spawn('vindicator', 0, PLAT_Y + 1, 0);
  e2.target = { x: 3, y: PLAT_Y + 1, z: 0, dead: false, removed: false };
  e2.raidId = 2;
  M.RaidManager = { world: { raids: { 2: { status: 'victory' } } } };
  const g2 = new Ai.VindicatorBreakDoorGoal(e2, EL.aiCtx(e2));
  okAv(!g2.canUse(), 'anti-vacuity: the SAME door/difficulty setup, raid status VICTORY (not ongoing): canUse() refuses');
  EL.clear();

  // ANTI-VACUITY #2: an ongoing raid, but EASY difficulty -- vindicator's own predicate is
  // NORMAL/HARD, the INVERSE half from zombie's own HARD-only gate, not "any non-peaceful" one.
  freshWorld();
  plate(10);
  placeDoor(1, PLAT_Y + 1, 0);
  Diff.set('easy');
  const e3 = EL.spawn('vindicator', 0, PLAT_Y + 1, 0);
  e3.target = { x: 3, y: PLAT_Y + 1, z: 0, dead: false, removed: false };
  e3.raidId = 3;
  M.RaidManager = { world: { raids: { 3: { status: 'ongoing' } } } };
  const g3 = new Ai.VindicatorBreakDoorGoal(e3, EL.aiCtx(e3));
  okAv(!g3.canUse(), "anti-vacuity: EASY difficulty + an ongoing raid: canUse() refuses -- vindicator's own gate is NORMAL/HARD, not EASY/NORMAL and not zombie's HARD-only either");
  EL.clear();

  Diff.value = savedDiff;
  M.RaidManager = savedRM; M.Raid = savedRaidNS;
  Math.random = savedRand;
}

// ═══ 9. D-602 (raidergoals): CrossbowAttackGoal's own isEntityHoldingCrossbow() gate ═══════
console.log('\n 9. CrossbowAttackGoal\'s own isEntityHoldingCrossbow() gate -- a disarmed pillager never fires');
freshWorld();
plate(20);
{
  M.Player = mkPlayer({ x: 6, y: PLAT_Y + 1, z: 0 });
  const pil = EL.spawn('pillager', 0, PLAT_Y + 1, 0);
  ok(Ai.holdsCrossbow(pil), 'a freshly spawned pillager (Eq.initMob -> Eq.WEAPON_FOR.pillager) really holds a crossbow, off the live Equip table');

  // strip the mainhand crossbow the same way losing/dropping it would -- e.equip[MAINHAND] gone
  Eq.setEquipped(pil, IT.MAINHAND, null);
  okAv(!Ai.holdsCrossbow(pil), 'anti-vacuity(substrate): with the mainhand item cleared, Ai.holdsCrossbow reads false -- the read is live, not cached');

  for (let t = 0; t < 200; t++) EL.tick();
  okAv(!EL.list.some((o) => o.type === 'arrow'), 'anti-vacuity: a disarmed pillager, target in range for the WHOLE 200-tick window, never fires -- isEntityHoldingCrossbow() really gates canUse/canContinueToUse, not just canStart once');
  EL.clear();
}

// ═══ 10. D-602 (raidergoals): skeleton/stray reassessWeaponGoal -- no bow means MeleeAttackGoal ═
console.log('\n 10. AbstractSkeletonEntity.updateAttackType: no bow -> Ai.SkeletonMeleeFallbackGoal, not BowAttackGoal');
{
  freshWorld();
  plate(20);
  M.Player = mkPlayer({ x: 6, y: PLAT_Y + 1, z: 0 });
  const skel = EL.spawn('skeleton', 0, PLAT_Y + 1, 0);
  ok(Ai.holdsBow(skel), 'a freshly spawned skeleton (Eq.initMob -> Eq.WEAPON_FOR.skeleton) really holds a bow');
  const bowGoal = new Ai.BowAttackGoal(skel, 1.0, () => {}, Math.random);
  const meleeGoal = new Ai.SkeletonMeleeFallbackGoal(skel, 1.2);
  skel.target = M.Player;
  ok(bowGoal.canUse() && !meleeGoal.canUse(), 'holding a bow: BowAttackGoal.canUse() is true, SkeletonMeleeFallbackGoal.canUse() is false -- mutually exclusive, bow wins');

  Eq.setEquipped(skel, IT.MAINHAND, null);
  okAv(!Ai.holdsBow(skel), 'anti-vacuity(substrate): with the mainhand bow cleared, Ai.holdsBow reads false');
  okAv(!bowGoal.canUse() && meleeGoal.canUse(), 'anti-vacuity: the SAME skeleton with no bow flips -- BowAttackGoal.canUse() now false, SkeletonMeleeFallbackGoal.canUse() now true (reassessWeaponGoal\'s own swap, real)');
  EL.clear();
}

// ═══ 11. D-602 (loop/raiderroar): vindicator/pillager PatrolApproachGoal -- real spot-and-alert ═
console.log('\n 11. vindicator/pillager PatrolApproachGoal -- spot a target, alert every OTHER live raider, close in');
{
  freshWorld();
  plate(30);
  const v1 = EL.spawn('vindicator', 0, PLAT_Y + 1, 0);
  const v2 = EL.spawn('vindicator', 2, PLAT_Y + 1, 0);   // within the 8-block alert radius
  v1.patrolling = true;      // isRaidCenterSet() = patrolling (PatrolEntity.java)
  const farTarget = { x: 30, y: PLAT_Y + 1, z: 0, dead: false, removed: false };   // > 10 blocks away
  v1.target = farTarget;
  const g1 = new Ai.PatrolApproachGoal(v1, EL.aiCtx(v1));
  ok(g1.canUse(), 'no active raid + patrolTarget set + a live target + not already attacking + last attacker not the player: canUse() opens');
  g1.start();
  ok(v2.target === farTarget, "start() alerts every OTHER live raider within 8 blocks -- v2's own target is now v1's target");
  g1.tick();
  ok(!v1.attacking, 'still farther than the 10-block squaredDistance: isAttacking() stays false');
  v1.target = { x: 5, y: PLAT_Y + 1, z: 0, dead: false, removed: false };   // now within 10 blocks
  g1.tick();
  ok(v1.attacking, 'now within the 10-block squaredDistance: tick() sets isAttacking() true, handing off to MeleeAttackGoal');
  EL.clear();

  // ANTI-VACUITY #1: the SAME setup, but the raider was just hit BY THE PLAYER (lastHurtByEntity
  // === player) -- canStart's own `attacker.getType() != PLAYER` half must refuse.
  freshWorld();
  plate(30);
  M.Player = mkPlayer({ x: 50, y: PLAT_Y + 1, z: 0 });
  const v3 = EL.spawn('vindicator', 0, PLAT_Y + 1, 0);
  v3.patrolling = true;
  v3.target = { x: 30, y: PLAT_Y + 1, z: 0, dead: false, removed: false };
  v3.lastHurtByEntity = M.Player;
  const g3 = new Ai.PatrolApproachGoal(v3, EL.aiCtx(v3));
  okAv(!g3.canUse(), 'anti-vacuity: last attacker IS the player: canUse() refuses even though every other condition holds');
  EL.clear();

  // ANTI-VACUITY #2: an ONGOING raid -- getRaid()==null is the very first canStart clause.
  freshWorld();
  plate(30);
  const v4 = EL.spawn('vindicator', 0, PLAT_Y + 1, 0);
  v4.patrolling = true;
  v4.target = { x: 30, y: PLAT_Y + 1, z: 0, dead: false, removed: false };
  v4.raidId = 9;
  const savedRM = M.RaidManager, savedRaidNS = M.Raid;
  M.RaidManager = { world: { raids: { 9: { status: 'ongoing' } } } };
  M.Raid = { Status: { ONGOING: 'ongoing' } };
  const g4 = new Ai.PatrolApproachGoal(v4, EL.aiCtx(v4));
  okAv(!g4.canUse(), 'anti-vacuity: an ONGOING raid (getRaid() != null): canUse() refuses -- PatrolApproachGoal is pre-raid only');
  M.RaidManager = savedRM; M.Raid = savedRaidNS;
  EL.clear();

  // ROSTER wiring: vindicator priority 3, pillager priority 2 -- both callers, both cited.
  freshWorld();
  plate(10);
  const rv = EL.spawn('vindicator', 0, PLAT_Y + 1, 0);
  const rp = EL.spawn('pillager', 3, PLAT_Y + 1, 0);
  const vEntry = rv.ai.entries.find((en) => en.goal.constructor === (Ai.PatrolApproachGoal.__orig || Ai.PatrolApproachGoal));
  const pEntry = rp.ai.entries.find((en) => en.goal.constructor === (Ai.PatrolApproachGoal.__orig || Ai.PatrolApproachGoal));
  ok(vEntry && vEntry.priority === 3, "vindicator's own PatrolApproachGoal is wired at priority 3 (VindicatorEntity.java:62)");
  ok(pEntry && pEntry.priority === 2, "pillager's own PatrolApproachGoal is wired at priority 2 (PillagerEntity.java:70)");
  EL.clear();
}

// ═══ 12. D-602 (loop/raiderroar): vindicator's own LongDoorInteractGoal -- open, walk through, close ═
console.log('\n 12. vindicator\'s own LongDoorInteractGoal -- real hasActiveRaid()-gated open/close-without-break');
{
  function placeDoor(x, y, z) {
    const lower = stateOf('oak_door');
    const upper = M.Behave.setProp(lower, 'half', 'upper');
    W.setBlock(x, y, z, lower);
    W.setBlock(x, y + 1, z, upper);
  }
  const savedRM = M.RaidManager, savedRaidNS = M.Raid;
  M.Raid = { Status: { ONGOING: 'ongoing' } };

  // POSITIVE: an ongoing raid + a wooden door in the way (horizontalCollision) -> the door
  // opens on start(), stays open while the mob is still on the approach side, and closes again
  // once the mob has walked PAST it (the base class's own dot-product test) and stop() fires.
  freshWorld();
  plate(10);
  placeDoor(1, PLAT_Y + 1, 0);
  const e1 = EL.spawn('vindicator', 0, PLAT_Y + 1, 0);
  e1.horizontalCollision = true;
  e1.raidId = 11;
  M.RaidManager = { world: { raids: { 11: { status: 'ongoing' } } } };
  const g1 = new Ai.VindicatorLongDoorInteractGoal(e1, EL.aiCtx(e1));
  ok(g1.canUse(), 'ongoing raid + horizontalCollision + an adjacent wooden door: canUse() opens');
  g1.start();
  ok(Ai.doorAt(1, PLAT_Y + 1, 0).closed === false, 'start() really opens the door (Ai.setDoorOpen)');
  g1.tick();
  ok(g1.canContinueToUse(), 'still on the approach side of the door: shouldContinue() stays true');
  e1.x = 4;   // walk past the door
  g1.tick();
  okAv(!g1.canContinueToUse(), 'anti-vacuity: once the mob has walked PAST the door (the dot-product flips negative), shouldContinue() goes false');
  g1.stop();
  ok(Ai.doorAt(1, PLAT_Y + 1, 0).closed === true, 'stop() really closes the door again -- it does not stay open forever');
  EL.clear();

  // ANTI-VACUITY #1: identical door/collision setup, but no active raid -- IllagerEntity's own
  // hasActiveRaid() gate must refuse, proving the wrapper is real, not decorative.
  freshWorld();
  plate(10);
  placeDoor(1, PLAT_Y + 1, 0);
  const e2 = EL.spawn('vindicator', 0, PLAT_Y + 1, 0);
  e2.horizontalCollision = true;
  const g2 = new Ai.VindicatorLongDoorInteractGoal(e2, EL.aiCtx(e2));
  M.RaidManager = savedRM; M.Raid = savedRaidNS;
  okAv(!g2.canUse(), 'anti-vacuity: the SAME door/collision setup, no active raid: canUse() refuses');
  EL.clear();

  // ANTI-VACUITY #2: an ongoing raid, but the mob is not pushing against anything
  // (horizontalCollision false) -- the base DoorInteractGoal's own first gate.
  freshWorld();
  plate(10);
  placeDoor(1, PLAT_Y + 1, 0);
  const e3 = EL.spawn('vindicator', 0, PLAT_Y + 1, 0);
  e3.horizontalCollision = false;
  e3.raidId = 12;
  M.Raid = { Status: { ONGOING: 'ongoing' } };
  M.RaidManager = { world: { raids: { 12: { status: 'ongoing' } } } };
  const g3 = new Ai.VindicatorLongDoorInteractGoal(e3, EL.aiCtx(e3));
  okAv(!g3.canUse(), 'anti-vacuity: an ongoing raid but horizontalCollision false (not pushing against the door): canUse() refuses');
  M.RaidManager = savedRM; M.Raid = savedRaidNS;
  EL.clear();

  // ROSTER wiring: priority 2 (VindicatorEntity.java:61), flags=0 (no Goal.Control declared).
  freshWorld();
  plate(10);
  const rv = EL.spawn('vindicator', 0, PLAT_Y + 1, 0);
  const entry = rv.ai.entries.find((en) => en.goal.constructor === (Ai.VindicatorLongDoorInteractGoal.__orig || Ai.VindicatorLongDoorInteractGoal));
  ok(entry && entry.priority === 2 && entry.flags === 0, "vindicator's own LongDoorInteractGoal is wired at priority 2, flags=0 (no Goal.Control in .decomp)");
  EL.clear();
}

// ═══ 13. D-602 (loop/raiderroar): ravager's own AttackGoal reach override + attackTick ══════
console.log('\n 13. ravager\'s own AttackGoal reach override (getWidth()-0.1F) + attackTick set on a landed hit');
{
  freshWorld();
  plate(10);
  const rav = EL.spawn('ravager', 0, PLAT_Y + 1, 0);
  const target = { x: rav.x, y: rav.y, z: rav.z, width: 0.6, dead: false, removed: false, health: 20, maxHealth: 20 };
  const expected = 4 * (rav.width - 0.1) * (rav.width - 0.1) + target.width;
  ok(Math.abs(Ai.ravagerReachSqr(rav, target) - expected) < 1e-9, "Ai.ravagerReachSqr matches RavagerEntity.AttackGoal's own (getWidth()-0.1F)*2 squared + target width formula");
  okAv(Ai.ravagerReachSqr(rav, target) !== Ai.attackReachSqr(rav, target), 'anti-vacuity: the ravager override is NOT the same number as the generic Ai.attackReachSqr formula (the -0.1F really changes it)');

  let attacked = null;
  const goal = new Ai.MeleeAttackGoal(rav, 1.0, Ai.ravagerReachSqr, function (t) { attacked = t; rav.ravagerAttackTick = Ai.RAVAGER_ATTACK_TICKS; });
  rav.target = target;
  goal.start();
  goal.tick();
  ok(attacked === target && rav.ravagerAttackTick === Ai.RAVAGER_ATTACK_TICKS, "landing a hit (target within the ravager's own reach) fires the onAttack hook -- attackTick set to 10, the exact tryAttack()/handleStatus(4) value");
  // #4260/#4340: attackTick=10 freezes 10 ticks: the tick it is set (speed zeroed, read before the decrement) + 9 ticks where the post-decrement flag gates EL.tickMob
  { const rg = new Ai.RavagerRoarGoal(rav, {}); rav.ravagerAttackTick = Ai.RAVAGER_ATTACK_TICKS; let n = 0;
    for (let i = 0; i < 20; i++) { rg.tick(); if (rav.ravagerImmobile) n++; if (i === 0 && rav.speedAttr === 0) n++; }
    ok(n === 10, 'ravager immobile for exactly 10 ticks after tryAttack (got ' + n + ')');
    rav.ravagerAttackTick = 1; rg.tick(); ok(rav.speedAttr === 0, 'speedAttr is 0 on the tick attackTick goes 1->0'); }
  EL.clear();

  // ROSTER wiring: the roster's own MeleeAttackGoal really uses Ai.ravagerReachSqr, not the generic default.
  freshWorld();
  plate(10);
  const rr = EL.spawn('ravager', 0, PLAT_Y + 1, 0);
  const meleeEntry = rr.ai.entries.find((en) => en.goal.constructor === (Ai.MeleeAttackGoal.__orig || Ai.MeleeAttackGoal));
  ok(!!meleeEntry, "ravager's own AttackGoal (Ai.MeleeAttackGoal) is on its roster");
  EL.clear();
}

// ═══ 14. D-602 (loop/raiderroar): ravager roarTick/stunTick state machine + leaf-breaking ═══
console.log('\n 14. ravager roar/stun state machine (Ai.RavagerRoarGoal) + horizontalCollision leaf-breaking');
{
  // stunTick counting down to 0 sets roarTick=20; roarTick counting down to 10 fires roar(),
  // which damages every non-ravager, non-illager LivingEntity within 4 blocks and knocks back
  // EVERY one of them, illager or not (RavagerEntity.roar, RavagerEntity.java:244-265).
  freshWorld();
  plate(20);
  const rav = EL.spawn('ravager', 0, PLAT_Y + 1, 0);
  const zom = EL.spawn('zombie', 2, PLAT_Y + 1, 0);        // non-ravager, non-illager: takes 6 damage AND knockback
  const pil = EL.spawn('pillager', -2, PLAT_Y + 1, 0);     // an IllagerEntity: knockback only, no damage
  const other = EL.spawn('ravager', 0, PLAT_Y + 1, 10);    // another ravager: excluded entirely (IS_NOT_RAVAGER)
  const P = M.Player; P.x = 0; P.y = PLAT_Y + 1; P.z = 2; P.vx = P.vy = P.vz = 0;   // #2901: the player is not in EL.list
  const pHpBefore = P.health;
  const zomHpBefore = zom.health, pilHpBefore = pil.health, otherHpBefore = other.health;
  const zomVxBefore = zom.vx || 0, pilVxBefore = pil.vx || 0, otherVxBefore = other.vx || 0;
  // #1309: roar damage carries the ravager as attacker; the 40 POOF burst is emitted
  const roarHits = []; const hurt0 = M.Combat.hurt;
  M.Combat.hurt = function (ent, d, src, b, opts) { roarHits.push({ ent, opts }); return hurt0.apply(this, arguments); };
  let roarPoofs = 0; const sr0 = M.Particle.spawnRoar;
  M.Particle.spawnRoar = function () { const n = sr0.apply(this, arguments); roarPoofs += n; return n; };
  const goal = new Ai.RavagerRoarGoal(rav, EL.aiCtx(rav));
  rav.ravagerStunTick = 1;
  goal.tick();   // stunTick 1 -> 0: roarTick set to Ai.RAVAGER_ROAR_TICKS (20)
  ok(rav.ravagerStunTick === 0 && rav.ravagerRoarTick === Ai.RAVAGER_ROAR_TICKS, 'stunTick reaching 0 sets roarTick to Ai.RAVAGER_ROAR_TICKS (RavagerEntity.java:194-199)');
  for (let t = 0; t < Ai.RAVAGER_ROAR_TICKS - Ai.RAVAGER_ROAR_FIRE_AT; t++) goal.tick();   // count down to roarTick === 10
  ok(rav.ravagerRoarTick === Ai.RAVAGER_ROAR_FIRE_AT, 'roarTick counts down one per real tick until it reaches Ai.RAVAGER_ROAR_FIRE_AT (10)');
  ok(zom.health < zomHpBefore, "roar() damages the non-ravager, non-illager zombie (DamageSource.mob(ravager), 6.0)");
  ok(P.health < pHpBefore && P.vz > 0 && P.vy > 0, 'roar() damages AND knocks back the PLAYER (#2901: loop must include NS.Player)');
  ok(pil.health === pilHpBefore, "roar() does NOT damage the pillager -- it IS an IllagerEntity, RavagerEntity.roar's own `!(target instanceof IllagerEntity)` filter");
  ok(other.health === otherHpBefore, 'roar() never touches another ravager at all (IS_NOT_RAVAGER)');
  ok((zom.vx || 0) !== zomVxBefore, 'roar() knocks the zombie back');
  ok((pil.vx || 0) !== pilVxBefore, 'roar() STILL knocks the pillager back even though it took no damage (knockBack() runs unconditionally in the loop body)');
  ok((other.vx || 0) === otherVxBefore, 'roar() does not knock back another ravager either -- excluded from the loop entirely');
  M.Combat.hurt = hurt0; M.Particle.spawnRoar = sr0;
  const zh = roarHits.find(h => h.ent === zom);
  ok(zh && zh.opts && zh.opts.attacker === rav, 'roar() damage passes { attacker: ravager } to Combat.hurt (DamageSource.mob(this), #1309)');
  ok(roarPoofs > 0, 'roar() spawns the POOF burst (' + roarPoofs + ' accepted of 40)');
  okAv(!roarHits.some(h => h.ent === pil), 'anti-vacuity: the illager is never passed to Combat.hurt');
  EL.clear();

  // ANTI-VACUITY: attackTick/roarTick/stunTick all zero -> a tick is a total no-op for the timers
  freshWorld();
  plate(10);
  const rav2 = EL.spawn('ravager', 0, PLAT_Y + 1, 0);
  const goal2 = new Ai.RavagerRoarGoal(rav2, EL.aiCtx(rav2));
  goal2.tick();
  okAv(!rav2.ravagerAttackTick && !rav2.ravagerStunTick && !rav2.ravagerRoarTick && !rav2.ravagerImmobile, 'anti-vacuity: with every timer already at 0, a tick leaves them all at 0 and ravagerImmobile false -- no spontaneous stun/roar');
  EL.clear();

  // leaf-breaking-while-moving (RavagerEntity.java:159-181): horizontalCollision + mobGriefing
  // removes every LeavesBlock inside the mob's own (expanded) bounding box.
  freshWorld();
  plate(10);
  const rav3 = EL.spawn('ravager', 0, PLAT_Y + 1, 0);
  const leavesState = stateOf('oak_leaves');
  W.setBlock(1, PLAT_Y + 1, 0, leavesState);
  rav3.horizontalCollision = true;
  const goal3 = new Ai.RavagerRoarGoal(rav3, EL.aiCtx(rav3));
  goal3.tick();
  ok(W.getBlock(1, PLAT_Y + 1, 0) === 0, 'horizontalCollision + mobGriefing on: a LeavesBlock inside the ravager\'s own expanded bounding box is broken');
  {
    const fl = Ai.ROSTER.ravager(rav3, EL.aiCtx(rav3)).entries.find(g => g.goal instanceof Ai.FloatGoal);
    ok(fl && fl.flags === Ai.JUMP, '#1025: ravager SwimGoal controls JUMP only (not MOVE)');
    freshWorld(); plate(10);
    const rav5 = EL.spawn('ravager', 0, PLAT_Y + 1, 0);
    W.setBlock(1, PLAT_Y + 1, 0, leavesState);
    rav5.horizontalCollision = true;
    const origLoot = M.Loot, origItems = M.Items, origPop = EL.popResource;
    const pops = [];
    M.Loot = { ready: true, breakDrops: () => [{ item: 'stick', count: 1 }] };
    M.Items = { of: () => 7 };
    EL.popResource = (x, y, z, idx, n) => pops.push(idx);
    const origSnd = M.Sound, origPart = M.Particle; let snd = 0, part = 0;
    M.Sound = { blockBreak: () => snd++ }; M.Particle = { addBlockBreakParticles: () => part++ };
    new Ai.RavagerRoarGoal(rav5, EL.aiCtx(rav5)).tick();
    M.Sound = origSnd; M.Particle = origPart;
    ok(snd === 1 && part === 1, '#2904: a leaf the ravager breaks emits the 2001 break sound + particles');
    M.Loot = origLoot; M.Items = origItems; EL.popResource = origPop;
    ok(pops.length === 1, '#1025: a leaf the ravager breaks drops its loot (breakBlock(pos, true, this))');
  }
  EL.clear();

  // ANTI-VACUITY: mobGriefing off -> the SAME leaves block must survive.
  freshWorld();
  plate(10);
  const rav4 = EL.spawn('ravager', 0, PLAT_Y + 1, 0);
  W.setBlock(1, PLAT_Y + 1, 0, leavesState);
  rav4.horizontalCollision = true;
  const ctx4 = Object.assign({}, EL.aiCtx(rav4), { mobGriefing: () => false });
  const goal4 = new Ai.RavagerRoarGoal(rav4, ctx4);
  goal4.tick();
  okAv(W.getBlock(1, PLAT_Y + 1, 0) === leavesState, 'anti-vacuity: with mobGriefing false, the SAME leaves block survives -- the gamerule gate is real, not decorative');
  EL.clear();
}

// ═══ 15. D-602 (loop/raiderroar): the shield-block stun -- real but currently UNREACHABLE ═══
console.log('\n 15. Ai.ravagerAttackBlockedByShield -- real 50/50 stun-vs-knockback branch (no live caller yet, Ai.OWED)');
{
  freshWorld();
  plate(10);
  const rav = EL.spawn('ravager', 0, PLAT_Y + 1, 0);
  const target = { x: rav.x + 1, y: rav.y, z: rav.z, vx: 0, vy: 0, vz: 0 };
  Ai.ravagerAttackBlockedByShield(rav, target, { random: () => 0 });   // forces the < 0.5 stun branch
  ok(rav.ravagerStunTick === Ai.RAVAGER_STUN_TICKS, 'the stun branch (rand < 0.5) sets stunTick to Ai.RAVAGER_STUN_TICKS (40)');
  ok(target.vx !== 0, 'the stun branch still pushes the shield-blocking target away (pushAwayFrom)');
  ok(Math.abs(target.vx - 0.05) < 1e-9 && target.vz === 0, 'pushAwayFrom magnitude at dist 1 is 0.05 (Entity.java:1269-1295), not a placeholder');

  const rav2 = EL.spawn('ravager', 5, PLAT_Y + 1, 0);
  const target2 = { x: rav2.x + 1, y: rav2.y, z: rav2.z, vx: 0, vy: 0, vz: 0 };
  Ai.ravagerAttackBlockedByShield(rav2, target2, { random: () => 0.9 });   // forces the >= 0.5 knockback branch
  okAv(!rav2.ravagerStunTick, 'anti-vacuity: the >= 0.5 branch does NOT stun the ravager -- ravagerStunTick stays unset');
  ok(target2.vx !== 0, 'the knockback branch still pushes the target back, via the private knockBack(Entity) formula');

  const rav3 = EL.spawn('ravager', 10, PLAT_Y + 1, 0);
  rav3.ravagerRoarTick = 5;   // mid-roar
  const target3 = { x: rav3.x + 1, y: rav3.y, z: rav3.z, vx: 0, vy: 0, vz: 0 };
  Ai.ravagerAttackBlockedByShield(rav3, target3, { random: () => 0 });
  okAv(!rav3.ravagerStunTick && target3.vx === 0, 'anti-vacuity: a ravager already mid-roar (roarTick != 0) cannot be re-stunned -- the whole function is a no-op');
  EL.clear();
}

// ═══ 12. #844: ravager isImmobile speed gate, 0.3/0.35 lerp, canSee blind while stunned/roaring ═══
console.log('\n 12. ravager isImmobile zeroes MOVEMENT_SPEED, lerps toward 0.35 with a target, canSee gate');
freshWorld();
plate(20);
{
  M.Player = mkPlayer({ x: 9, y: PLAT_Y + 1, z: 0 });
  const rav = EL.spawn('ravager', -9, PLAT_Y + 1, 0);
  rav.target = M.Player;
  for (let t = 0; t < 12; t++) EL.tick();
  ok(rav.speedAttr > 0.3 && rav.speedAttr < 0.35 && !rav.ravagerImmobile, `speed lerps toward 0.35 with a target (got ${rav.speedAttr})`);
  okAv(rav.speedAttr > 0, 'anti-vacuity: a mobile ravager does not read speed 0');
  rav.ravagerAttackTick = 10;
  EL.tick();
  ok(rav.speedAttr === 0 && rav.mobSpeed === 0, 'speed is 0 while attackTick > 0');
  rav.ravagerAttackTick = 0; rav.ravagerStunTick = 0;
  for (let t = 0; t < 5; t++) EL.tick();
  ok(rav.speedAttr > 0 && rav.speedAttr < 0.35, 'speed recovers by lerp (not a snap) once immobility ends');
  rav.target = null; M.Player.x = 500; rav.speedAttr = 0;
  for (let t = 0; t < 80; t++) EL.tick();
  ok(Math.abs(rav.speedAttr - 0.3) < 0.01, `speed settles at 0.3 without a target (got ${rav.speedAttr})`);
  M.Player.x = 0; M.Player.z = 0;
  const hidden = EL.spawn('ravager', 0, PLAT_Y + 1, 5);
  hidden.ravagerStunTick = 5;
  ok(Ai.canSee(hidden, M.Player) === false, 'canSee is false while stunned');
  hidden.ravagerStunTick = 0; hidden.ravagerRoarTick = 5;
  ok(Ai.canSee(hidden, M.Player) === false, 'canSee is false while roaring');
  hidden.ravagerRoarTick = 0;
  okAv(Ai.canSee(hidden, M.Player) === true, 'anti-vacuity: canSee is true again once stun/roar end');
  EL.clear();
}

// ═══ 16. #845: roar() is an AABB expand(4.0) overlap, not a feet-centre sphere ═══
console.log('\n 16. ravager roar AABB');
{
  freshWorld();
  plate(20);
  const rav = EL.spawn('ravager', 0, PLAT_Y + 1, 0);
  const corner = EL.spawn('zombie', 3.9, PLAT_Y + 1, 3.9);   // box corner: sphere r=4 missed it
  const high = EL.spawn('zombie', 1, PLAT_Y + 1 + 3.5, 0);   // 3.5 above: inside expand(4) vertically
  const far = EL.spawn('zombie', 7, PLAT_Y + 1, 0);          // outside the box
  const c0 = corner.health, h0 = high.health, f0 = far.health;
  const goal = new Ai.RavagerRoarGoal(rav, EL.aiCtx(rav));
  rav.ravagerRoarTick = Ai.RAVAGER_ROAR_FIRE_AT + 1;
  goal.tick();
  ok(corner.health < c0, 'target at (3.9,0,3.9) is hit by the box roar');
  ok(high.health < h0, 'target at y+3.5 is hit by the box roar');
  okAv(far.health === f0, 'anti-vacuity: a target outside the expanded box is not hit');
  EL.clear();
}

// ═══ 17. #1026: illusioner target roster = IllusionerEntity.initGoals 71-74 ═══
console.log('\n 17. illusioner target selectors');
{
  freshWorld();
  plate(20);
  const ill = EL.spawn('illusioner', 0, PLAT_Y + 1, 0);
  const rev = ill.ai.entries.find((en) => en.goal instanceof Ai.RevengeGoal);
  const nat = ill.ai.entries.filter((en) => en.goal.maxNoSight !== undefined).sort((a, b) => a.priority - b.priority);
  ok(!!rev && rev.priority === 1 && rev.goal.group === true, 'illusioner: group RevengeGoal at priority 1');
  ok(nat.map((n) => n.priority).join() === '2,3,3', 'illusioner: ActiveTargetGoals at priorities 2,3,3');
  ok(nat.every((n) => n.goal.maxNoSight === 300), 'illusioner: every ActiveTargetGoal has maxNoSight 300');
  okAv(!ill.ai.entries.some((en) => en.goal.constructor === (Ai.HurtByTargetGoal.__orig || Ai.HurtByTargetGoal)), 'anti-vacuity: no plain HurtByTargetGoal left');
  okAv(nat.length === 3, 'anti-vacuity: exactly three ActiveTargetGoals counted');
  EL.clear();
}

// ═══ 18. #1200: PillagerEntity.addBonusForWave / Raid.getEnchantmentChance ═══
console.log('\n 18. raid pillager enchanted crossbow roll');
{
  const Rd = M.Raid;
  const chance = (l) => Rd.getEnchantmentChance({ badOmenLevel: l });
  ok([0, 1, 2, 3, 4, 5].map(chance).join() === '0,0,0.1,0.25,0.5,0.75', 'getEnchantmentChance by bad omen level');
  const ench = (m) => ((Eq.getEquipped(m, IT.MAINHAND) || {}).t || {}).Enchantments || [];
  const lv = (m, id) => { const e = ench(m).find((x) => x.id === 'minecraft:' + id); return e ? e.lvl : 0; };
  const roll = (type, wave, omen, f) => {
    const m = { type }; Rd.addBonusForWave({ badOmenLevel: omen }, m, wave, { nextFloat: () => f }); return m;
  };
  for (const [wave, q] of [[3, 0], [5, 0], [6, 1], [7, 1], [8, 2]]) {
    const m = roll('pillager', wave, 5, 0.5);
    ok(lv(m, 'multishot') === 1 && lv(m, 'quick_charge') === q, `wave ${wave}: multishot 1, quick_charge ${q}`);
  }
  ok(ench(roll('pillager', 8, 5, 0.9)).length === 0, 'roll above chance: nothing equipped');
  ok(ench(roll('pillager', 8, 2, 0.1)).length === 2 && ench(roll('pillager', 8, 2, 0.11)).length === 0, 'nextFloat <= chance is inclusive at 0.1');
  const ax = (w, f) => roll('vindicator', w, 5, f);
  ok(lv(ax(3, 0), 'sharpness') === 1 && lv(ax(8, 0), 'sharpness') === 2 && lv(ax(5, 0), 'sharpness') === 1, 'vindicator: sharpness 1, 2 past normal max wave');
  ok((Eq.getEquipped(ax(3, 0.99), IT.MAINHAND) || {}).i === IT.of('iron_axe') && ench(ax(3, 0.99)).length === 0, 'vindicator: plain iron_axe on a failed roll');
  ok(ench(roll('zombie', 8, 5, 0)).length === 0, 'other types untouched');
  const saved = Rd.getEnchantmentChance;
  Rd.getEnchantmentChance = () => 0;
  okAv(ench(roll('pillager', 8, 5, 0.5)).length === 0 && lv(roll('vindicator', 8, 5, 0.5), 'sharpness') === 0, 'anti-vacuity: chance forced to 0 -> no enchanted crossbow/axe');
  Rd.getEnchantmentChance = saved;
}

// ═══ 19. #1280: witch targetSelector 1 = RevengeGoal(this, RaiderEntity.class) ═══
console.log('\n 19. witch ignores raider attackers');
{
  freshWorld();
  plate(20);
  const savedPlayer = M.Player;
  M.Player = null;
  const w = EL.spawn('witch', 0, PLAT_Y + 1, 0);
  const rev = w.ai.entries.find((en) => en.goal instanceof Ai.RevengeGoal);
  ok(!!rev && rev.priority === 1, 'witch: RevengeGoal at priority 1');
  for (const t of ['vindicator', 'pillager', 'witch', 'ravager', 'evoker', 'illusioner'])
    ok(!!rev && rev.goal.noRevengeTypes[t] === 1, `witch: noRevengeTypes has ${t}`);
  okAv(!w.ai.entries.some((en) => en.goal.constructor === (Ai.HurtByTargetGoal.__orig || Ai.HurtByTargetGoal)), 'anti-vacuity: no plain HurtByTargetGoal left');
  const hit = (type) => {
    w.target = null;
    w.lastHurtByEntity = { x: 1, y: PLAT_Y + 1, z: 0, dead: false, removed: false, type };
    w.hurtSeq = (w.hurtSeq || 0) + 1;
    EL.tick();
    return w.target;
  };
  ok(hit('ravager') === null, 'witch hurt by a ravager keeps target null');
  ok(hit('witch') === null, 'witch hurt by another witch keeps target null');
  okAv(!!hit('zombie'), 'anti-vacuity: a non-raider attacker still makes the witch retaliate');
  EL.clear();
  M.Player = savedPlayer;
}

// ═══ #3637: illagers are each other's teammates -> no revenge, no group alert ═══
console.log('\n 19b. illager RevengeGoal ignores illager attackers (#3637)');
{
  freshWorld();
  plate(20);
  const savedPlayer = M.Player;
  M.Player = null;
  const p = EL.spawn('pillager', 0, PLAT_Y + 1, 0);
  const q = EL.spawn('vindicator', 2, PLAT_Y + 1, 0);
  const hit = (type) => {
    p.target = null; q.target = null;
    p.lastHurtByEntity = { x: 1, y: PLAT_Y + 1, z: 0, dead: false, removed: false, type };
    p.hurtSeq = (p.hurtSeq || 0) + 1;
    EL.tick();
    return [p.target, q.target];
  };
  for (const t of ['pillager', 'vindicator', 'evoker', 'illusioner', 'ravager', 'witch']) {
    const r = hit(t);
    ok(r[0] === null && r[1] === null, `pillager hurt by ${t}: no target, no alert`);
  }
  for (const t of ['player']) ok(!!hit(t)[0], `pillager hurt by ${t}: retaliates`);
  const saved = Ai.ILLAGER_TYPES;
  const rev = p.ai.entries.find((en) => en.goal instanceof Ai.RevengeGoal).goal;
  const savedN = rev.noRevengeTypes.pillager;
  delete rev.noRevengeTypes.pillager;
  okAv(!!hit('pillager')[0], 'anti-vacuity: without the exclusion a pillager attacker is retaliated against');
  rev.noRevengeTypes.pillager = savedN;
  EL.clear();
  M.Player = savedPlayer;
}

// ═══ #1827: CrossbowAttackGoal walks the path EVERY tick (startMovingTo once per cooldown) ═══
console.log('\n 19. pillager approach: continuous walking, rate-limited turn (#1827)');
{
  const walk = () => {
    freshWorld();
    plate(40);
    M.Player = mkPlayer({ x: 30, y: PLAT_Y + 1, z: 0 });
    const pil = EL.spawn('pillager', 0, PLAT_Y + 1, 0);
    pil.target = M.Player; // ponytail: acquisition is a 1-in-10 roll; this test measures walking
    for (let t = 0; t < 100; t++) EL.tick();
    const d = Math.hypot(pil.x, pil.z);
    EL.clear();
    return d;
  };
  const d = walk();
  // vanilla: 0.35 speed attr * 0.98 drag-ish ~ 0.1+ b/tick after accel; a once-per-20-40t step covers ~1/4 of this
  ok(d > 8, `pillager covers ${d.toFixed(1)} blocks in 100 ticks toward a target 30 away (continuous pathing)`);
  const saved = Ai.stepToward;
  Ai.stepToward = () => {};
  const dBroken = walk();
  Ai.stepToward = saved;
  okAv(dBroken < 1, `anti-vacuity: with stepToward disabled the pillager does not move (${dBroken.toFixed(2)})`);
}

// ═══ #3786: crossbow arrows carry flat 2.0 damage (no bow-style roll) ═══
console.log('\n #3786 mobShootCrossbow arrowDamage is flat 2');
{
  const pil = EL.spawn('pillager', 0, PLAT_Y + 1, 0);
  const tgt = { x: 8, y: PLAT_Y + 1, z: 0, height: 1.8 };
  const Cb = M.Combat;
  const flat = (shoot) => { let r = true; for (let i = 0; i < 20; i++) for (const a of shoot()) if (!a || a.arrowDamage !== 2) r = false; return r; };
  ok(flat(() => Cb.mobShootCrossbow(pil, tgt, { id: 'crossbow', count: 1 }, Math.random)), 'crossbow arrows all deal exactly 2.0');
  okAv(!flat(() => [Cb.mobShoot(pil, tgt, 1)]), 'bow-style mobShoot is not flat 2 (check can fail)');
  EL.clear();
}

console.log(`\n${fails.length === 0 ? 'PASS' : 'FAIL'} raidmobcheck — ${pass} assertions, ${breaks} breaks caught, ${fails.length} failure(s)`);
if (fails.length) { for (const f of fails.slice(0, 40)) console.log('   x ' + f); process.exit(1); }
