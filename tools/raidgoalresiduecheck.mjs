#!/usr/bin/env node
// raidgoalresiduecheck.mjs — #217 (G18b-6): the raid-mob goal residue. PatrolApproachGoal's
// isRaidCenterSet() is PatrolEntity's `patrolling` flag (not hasPatrolTarget); pillager's
// priority-8 goal is a real WanderAroundGoal; vindicator/pillager/ravager's ActiveTargetGoals
// refuse an unseen candidate (TargetPredicate.respectsVisibility) and, with mustSee, drop one
// unseen > 60 ticks (TrackTargetGoal.shouldContinue). Every section breaks its own data.
//
//   node tools/raidgoalresiduecheck.mjs [--verbose]

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
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };

console.log('raidgoalresiduecheck — #217 G18b-6: isRaidCenterSet, pillager WanderAroundGoal, LOS-gated raid target acquisition');

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
          '07k_goals.js', '07l_spawn.js',
          // loop/raidvex-s96 -- `Ai.ROSTER.vex` (07k_goals.js) constructs `NS.Fly.
          // VexMoveControl`; `07t_fly.js` is loaded straight after, matching build.mjs's own
          // relative order (it does not matter which loads first — ROSTER factories are only
          // ever CALLED at spawn time, after every module has finished loading).
          '07t_fly.js']
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

const wallAt = (x) => { for (let y = PLAT_Y + 1; y <= PLAT_Y + 4; y++) W.setBlock(x, y, 0, STONE); };
const tgt = (x) => ({ x, y: PLAT_Y + 1, z: 0, vx: 0, vy: 0, vz: 0, height: 1.8, dead: false, removed: false });

// 1. isRaidCenterSet() == patrolling
{
  freshWorld(); plate(30);
  const v = EL.spawn('vindicator', 0, PLAT_Y + 1, 0);
  v.target = tgt(20);
  v.patrolTarget = { x: 400, y: PLAT_Y + 1, z: 0 }; v.patrolling = false;
  const g = new Ai.PatrolApproachGoal(v, EL.aiCtx(v));
  okAv(!g.canUse(), 'patrolTarget set but patrolling false: canUse() refuses (isRaidCenterSet is `patrolling`)');
  v.patrolTarget = null; v.patrolling = true;
  ok(g.canUse(), 'patrolling true with no patrolTarget: canUse() opens');
  EL.clear();
}

// 2. pillager's own WanderAroundGoal
{
  freshWorld(); plate(30);
  const p = EL.spawn('pillager', 0, PLAT_Y + 1, 0);
  const en = p.ai.entries.find((x) => x.goal.constructor === (Ai.WanderAroundGoal.__orig || Ai.WanderAroundGoal));
  ok(en && en.priority === 8, 'pillager wires Ai.WanderAroundGoal at priority 8 (PillagerEntity.java:71)');
  const g = new Ai.WanderAroundGoal(p, 0.6, () => 0);
  const prevRnd = EL.random; EL.random = () => 0;   // #7410: nextIntOf uses the entity's own RNG unless EL.random overrides
  try { ok(g.canUse(), 'no passenger, roll 0: canStart opens'); } finally { EL.random = prevRnd; }
  p.passenger = {};
  okAv(!g.canUse(), 'hasPassengers(): canStart refuses');
  EL.clear();
}

// 3. sight-gated acquisition, per raid mob
for (const name of ['vindicator', 'pillager', 'ravager']) {
  freshWorld(); plate(30);
  const m = EL.spawn(name, 0, PLAT_Y + 1, 0);
  m.followBonus = 0;   // #2377: random spawn follow-range bonus must not shrink the 10-block range
  const gs = m.ai.entries.filter((x) => x.goal.constructor === (Ai.NearestAttackableTargetGoal.__orig || Ai.NearestAttackableTargetGoal)).map((x) => x.goal);
  const t = tgt(10);
  const hit = () => { m.target = null; for (let i = 0; i < 200; i++) if (gs.some((g) => g.canUse())) return true; return false; };   // #4117: 1-in-10 reciprocalChance roll
  M.Player = mkPlayer({ x: 10, y: PLAT_Y + 1, z: 0 });
  const pl = M.Player;
  const players = gs[0];
  ok(hit() && m.target === pl, name + ': a player in clear sight is acquired');
  wallAt(5);
  okAv(!hit(), name + ': the same player behind a stone wall is NOT acquired (canSee false)');
  for (let y = PLAT_Y + 1; y <= PLAT_Y + 4; y++) W.setBlock(5, y, 0, 0);
  ok(hit(), name + ': wall removed, acquired again');
  // mustSee: drop after >60 unseen ticks
  m.target = pl; players.start();
  wallAt(5);
  let dropped = -1;
  for (let i = 1; i <= 70; i++) if (!players.canContinueToUse()) { dropped = i; break; }
  ok(dropped === 61, name + ': mustSee drops a target unseen for >60 ticks (dropped at ' + dropped + ')');
  EL.clear();
}
// pillager merchant entry has mustSee=false: never drops for lack of sight
{
  freshWorld(); plate(30);
  const m = EL.spawn('pillager', 0, PLAT_Y + 1, 0);
  const gs = m.ai.entries.filter((x) => x.goal.constructor === (Ai.NearestAttackableTargetGoal.__orig || Ai.NearestAttackableTargetGoal)).map((x) => x.goal);
  const merch = gs[1];
  const t = tgt(10);
  m.target = t; wallAt(5);
  let dropped = false;
  for (let i = 0; i < 100; i++) if (!merch.canContinueToUse()) { dropped = true; break; }
  okAv(!dropped, "pillager's merchant goal (mustSee false) keeps an unseen target");
  const players = gs[0]; m.target = t;
  let d2 = false; for (let i = 0; i < 100; i++) if (!players.canContinueToUse()) { d2 = true; break; }
  ok(d2, "pillager's player goal (mustSee true) drops the same unseen target");
  EL.clear();
}

// 4. #648 evoker target selectors equal EvokerEntity.initGoals' four rows
{
  freshWorld(); plate(30);
  const m = EL.spawn('evoker', 0, PLAT_Y + 1, 0);
  const tg = m.ai.entries.filter((x) => x.priority <= 3 && (x.goal.constructor === (Ai.NearestAttackableTargetGoal.__orig || Ai.NearestAttackableTargetGoal) || x.goal.constructor === (Ai.RevengeGoal.__orig || Ai.RevengeGoal)));
  const rows = tg.map((x) => x.priority + ':' + x.goal.constructor.name).sort().join(',');
  ok(tg.length === 4, 'evoker has four target-selector rows (revenge, player, merchant, golem); got ' + tg.length);
  ok(tg.filter((x) => x.goal.constructor === (Ai.RevengeGoal.__orig || Ai.RevengeGoal)).length === 1 && tg.find((x) => x.goal.constructor === (Ai.RevengeGoal.__orig || Ai.RevengeGoal)).priority === 1, 'evoker row 1 is the group RevengeGoal');
  ok(tg.filter((x) => x.priority === 3).length === 2, 'evoker rows 3 are merchant + golem');
  const nat = tg.filter((x) => x.goal.constructor === (Ai.NearestAttackableTargetGoal.__orig || Ai.NearestAttackableTargetGoal)).map((x) => x.goal);
  const pl = nat[0], merch = nat[1];
  M.Player = mkPlayer({ x: 10, y: PLAT_Y + 1, z: 0 });
  m.target = M.Player; pl.start(); wallAt(5);
  let d = -1; for (let i = 1; i <= 400; i++) if (!pl.canContinueToUse()) { d = i; break; }
  ok(d === 301, 'evoker player goal keeps a target unseen for 300 ticks (dropped at ' + d + ')');
  m.target = tgt(10); let dm = false; for (let i = 0; i < 400; i++) if (!merch.canContinueToUse()) { dm = true; break; }
  okAv(!dm, 'evoker merchant goal (checkVisibility false) keeps an unseen target');
  EL.clear();
}

// 5. #1014 illusioner target selectors + LookAtMob equal IllusionerEntity.initGoals (same shape as the evoker)
{
  freshWorld(); plate(30);
  const sig = (m) => m.ai.entries.filter((x) => x.priority <= 3 && (x.goal.constructor === (Ai.NearestAttackableTargetGoal.__orig || Ai.NearestAttackableTargetGoal) || x.goal.constructor === (Ai.RevengeGoal.__orig || Ai.RevengeGoal)))
    .map((x) => x.priority + ':' + x.goal.constructor.name).sort().join(',');
  const il = EL.spawn('illusioner', 0, PLAT_Y + 1, 0), ev = EL.spawn('evoker', 0, PLAT_Y + 1, 0);
  okAv(sig(il) === sig(ev), 'illusioner target rows equal evoker rows: ' + sig(il));
  okAv(il.ai.entries.filter((x) => x.priority === 10 && x.goal.constructor === (Ai.LookAtMobGoal.__orig || Ai.LookAtMobGoal)).length === 1, 'illusioner has exactly one priority-10 LookAtMobGoal (#1259)');
  const nat = il.ai.entries.filter((x) => x.priority <= 3 && x.goal.constructor === (Ai.NearestAttackableTargetGoal.__orig || Ai.NearestAttackableTargetGoal)).map((x) => x.goal);
  M.Player = mkPlayer({ x: 10, y: PLAT_Y + 1, z: 0 });
  il.target = M.Player; nat[0].start(); wallAt(5);
  let d = -1; for (let i = 1; i <= 400; i++) if (!nat[0].canContinueToUse()) { d = i; break; }
  okAv(d === 301, 'illusioner player goal keeps an unseen target 300 ticks (dropped at ' + d + ')');
  EL.clear();
}

// 6. #1826 CrossbowAttackGoal.shouldContinue/stop() equal the vanilla source
{
  freshWorld(); plate(30);
  const m = EL.spawn('pillager', 0, PLAT_Y + 1, 0);
  const g = m.ai.entries.map((x) => x.goal).find((x) => x.constructor === (Ai.CrossbowAttackGoal.__orig || Ai.CrossbowAttackGoal));
  okAv(!!g && Ai.holdsCrossbow(m), 'pillager has a CrossbowAttackGoal and holds a crossbow');
  const t = tgt(12); m.target = t; g.start();
  okAv(g.canContinueToUse(), 'live target + crossbow: continues');
  t.dead = true;
  okAv(!g.canContinueToUse(), 'dead target (hasAliveTarget false): does not continue even while canStart-shaped');
  t.dead = false; m.attacking = true; g.stop();
  okAv(m.attacking === false && m.target === null, 'stop() clears attacking and the target');
  m.target = t; g.start();
  for (let i = 0; i < 3; i++) g.tick();
  m.target = null;
  okAv(!g.canContinueToUse(), 'no target: does not continue');
  EL.clear();
}

// ═══ #1825: CrossbowAttackGoal READY stage fires only while canSee(target) ═══
console.log('\n #1825 ready stage waits without line of sight');
{
  const pil = EL.spawn('pillager', 0, PLAT_Y + 1, 0);
  const tgt = { x: 4, y: PLAT_Y + 1, z: 0, type: 'zombie' };
  const Cb = M.Combat, orig = Cb.mobShootCrossbow; let shots = 0, vis = true;
  Cb.mobShootCrossbow = () => { shots++; };
  const run = (n) => { for (let i = 0; i < n; i++) g.tick(); };
  const g = new Ai.CrossbowAttackGoal(pil, 1.0, 8.0, { canSee: () => vis, random: () => 0 });
  pil.target = tgt; g.start(); run(30);   // charging
  vis = false; run(150);                   // charged -> ready, blind
  const blind = shots;
  vis = true; run(30);
  Cb.mobShootCrossbow = orig;
  ok(shots >= 1, 'with sight the pillager shoots (' + shots + ')');
  okAv(blind === 0, 'blocked LOS: ready stage holds the shot (' + blind + ' shots)');
  EL.clear();
}

// ═══ #1856: IllagerEntity.canTarget refuses a baby merchant ═══
console.log('\n #1856 illager rosters skip baby merchants');
for (const t of ['vindicator', 'pillager', 'evoker', 'illusioner']) {
  freshWorld(); plate(30);
  const m = EL.spawn(t, 0, PLAT_Y + 1, 0);
  const baby = EL.spawn('villager', 3, PLAT_Y + 1, 0), adult = EL.spawn('villager', -3, PLAT_Y + 1, 0);
  baby.isBaby = true;
  const goals = m.ai.entries.map((x) => x.goal).filter((g) => g.getCandidates);
  const c = [].concat(...goals.map((g) => g.getCandidates())).filter((o) => o.type === 'villager');
  okAv(c.includes(adult) && !c.includes(baby), t + ' targets the adult villager, never the baby');
  EL.clear();
}

// ═══ #4191: non-Player ActiveTargetGoal on illagers searches expand(fr,4,fr): a villager 10 up is not targetable ═══
console.log('\n #4191 illager merchant/golem goals have the +-4 vertical box');
for (const t of ['vindicator', 'pillager', 'ravager', 'evoker', 'illusioner']) {
  freshWorld(); plate(30);
  const m = EL.spawn(t, 0, PLAT_Y + 1, 0);
  const v = EL.spawn('villager', 3, PLAT_Y + 11, 0);
  const gs = m.ai.entries.map((x) => x.goal).filter((g) => g.getCandidates && g.getCandidates().includes(v));
  okAv(gs.length > 0 && !gs.some((g) => { m.target = null; for (let i = 0; i < 200; i++) if (g.canUse()) return true; return false; }), t + ' ignores a villager 10 blocks above');
  EL.clear();
}

// ═══ #2706: witch RaidGoal = RaidGoal(checkVisibility=true): sight, expand(fr,4,fr) box, 60-tick mustSee drop ═══
console.log('\n #2706 witch RaidGoal sight / vertical box');
{
  // 07s_raid.js is not loaded here; RaidGoal only reads RaidManager.world.raids[id].status
  M.Raid = { Status: { ONGOING: 'ongoing' } };
  const RM = M.RaidManager = { world: { raids: { 7: { status: 'ongoing' } } } }, origRm = null;
  const mk = (x, y) => {
    EL.clear(); freshWorld(); plate(30);
    const w = EL.spawn('witch', 0, PLAT_Y + 1, 0); w.raidId = 7; w.witchRaidCooldown = 0;
    const r = EL.spawn('pillager', x, y, 0); r.raidId = 7;
    return { w, r, g: new Ai.RaidGoal(w, { random: () => 0.9 }) };
  };
  let c = mk(5, PLAT_Y + 1);
  ok(c.g.canUse() && c.w.target === c.r, 'open-air raider within range is acquired');
  c = mk(5, PLAT_Y + 1); wallAt(2);
  okAv(!c.g.canUse(), 'raider behind a wall is not acquired (respectsVisibility)');
  c = mk(2, PLAT_Y + 11);
  okAv(!c.g.canUse(), 'raider 10 blocks above is outside the expand(fr,4,fr) box');
  c = mk(5, PLAT_Y + 1); c.g.canUse(); c.g.start(); wallAt(2);
  let n = 0; while (c.g.canContinueToUse() && n < 100) n++;
  okAv(n === 60, 'unseen target dropped after 60 ticks (' + n + ')');
  RM.world = origRm; EL.clear();
}

// ═══ #4192: Johnny VindicatorTargetGoal checkCanNavigate=true (TrackTargetGoal.canNavigateToEntity) ═══
console.log('\n #4192 Johnny target goal honours canNavigate');
{
  const origFp = Ai.findPath;
  const mk = () => {
    EL.clear(); freshWorld(); plate(30);
    const v = EL.spawn('vindicator', 0, PLAT_Y + 1, 0); v.customName = 'Johnny';
    const cow = EL.spawn('cow', 5, PLAT_Y + 1, 0);
    return { v, cow, g: new Ai.VindicatorTargetGoal(v, { players: () => [] }) };
  };
  let c = mk(); Ai.findPath = () => [{ x: 5, y: PLAT_Y + 1, z: 0 }];
  ok(c.g.canUse() && c.v.target === c.cow, 'reachable cow is targeted');
  c = mk(); Ai.findPath = () => null;
  okAv(!c.g.canUse() && !c.v.target, 'cow with no path is not targeted');
  c = mk(); Ai.findPath = () => [{ x: 2, y: PLAT_Y + 1, z: 0 }];
  okAv(!c.g.canUse(), 'path ending 3 blocks short is not targeted');
  Ai.findPath = origFp; EL.clear();
}

console.log(`\n${fails.length === 0 ? 'PASS' : 'FAIL'} raidgoalresiduecheck: ${pass} assertions, ${breaks} breaks caught, ${fails.length} failure(s)`);
console.log(`${breaks} breaks caught`);
if (fails.length) { for (const f of fails.slice(0, 40)) console.log('   x ' + f); process.exit(1); }
