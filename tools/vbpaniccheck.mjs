#!/usr/bin/env node
// vbpaniccheck.mjs — loop/vbpanic: villager Activity.PANIC (src/07zv3_vbpanic.js's own
// `NS.VBPanic`, hooked one line into src/07zv_villagerbrain.js's own `VB.tick`).
// Every number here is cited in 07zv3_vbpanic.js, read off `.decomp` this session:
// PanicTask.java, StopPanickingTask.java, VillagerHostilesSensor.java, MemoryModuleType.java,
// LivingEntity.java (getRecentDamageSource), FuzzyTargeting.java, VillagerTaskListProvider.java
// (createPanicTasks), VillagerEntity.java (summonGolem).
//
//   node tools/vbpaniccheck.mjs [--verbose]
//
// Sections:
//   1. HURT_BY substrate: a real Cb.mobAttack hit on a villager flips VB.tick's own activity to
//      'panic' (wasHurt, 40-tick decay), and decays back out once past it (with no hostile near)
//   2. NEAREST_HOSTILE substrate: a hostile within ITS OWN per-type danger distance triggers
//      panic with NO damage at all; the same type just past that distance does not (both
//      directions of the per-type distance table, straight off VillagerHostilesSensor's own
//      SQUARED_DISTANCES_FOR_DANGER map)
//   3. flee direction: a panicking villager actually walks AWAY from the hostile/attacker
//   4. StopPanickingTask's hysteresis: wasHurtByNearbyEntity keeps panic running (attacker still
//      within 6 blocks) even once wasHurt/isHostileNearby both go false, and forgets HURT_BY/
//      HURT_BY_ENTITY the tick it finally does stop
//   5. panic pre-empts the schedule (doExclusively): a villager mid-'work' that gets hurt
//      switches to 'panic', not 'work', that same tick
//   6. the panic-quorum golem summon (PanicTask's own summonGolem(...,3), lower than
//      Village.tickSummon's own quorum-5 poll) — wired through the existing Village hooks
//   7. anti-vacuity — breaking this unit's own data and watching the break get caught

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

// mulberry32 -- a small deterministic PRNG (enchhelpercheck.mjs's own precedent) so section 11's
// fuzz-search retries below are reproducible rather than occasionally timing out on an unlucky
// run of VB.rand()===Math.random() whiffs (FuzzyTargeting's own candidate search, ported as
// VB.localFuzzToward, can legitimately return null a few times in a row).
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

console.log('vbpaniccheck — loop/vbpanic: villager Activity.PANIC (NS.VBPanic, NS.VB.tick hook)');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
  '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
  '07i_entitylist.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js',
  '14l_use.js', '07za_explosion.js', '07m_breed.js', '07q_effects.js', '07zu_poi.js', '07o_profession.js',
  '07k_goals.js', '07zv_villagerbrain.js', '07zv3_vbpanic.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Entities.attrs = M.DATA.entities.attrs;
M.Effects.ready = true;

const W = M.World, CH = M.CH, R = M.Reg, SR = M.States;
const Poi = M.Poi, Ai = M.Ai, VB = M.VB, VBP = M.VBPanic, EL = M.EntityList, Prof = M.Profession;
const Cb = M.Combat, Vg = M.Village;

ok(VB, 'NS.VB did not load');
ok(VBP, 'NS.VBPanic did not load');
ok(Cb, 'NS.Combat did not load');
ok(Vg, 'NS.Village did not load');
if (!VB || !VBP || !Cb || !Vg) { console.log('\nFAIL vbpaniccheck — module missing'); process.exit(1); }

W.init(1);
M.Behave.init(W);
if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init();
EL.init();
Ai.init();
Prof.init();
Cb.init && Cb.init();
ok(Ai.ready, 'Ai module reports ready');
ok(VBP.ready, 'NS.VBPanic reports ready');

for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
const STONE = SR.stateOf('stone');
const PLAT_Y = 63;
function plate(radius, y) { for (let x = -radius; x <= radius; x++) for (let z = -radius; z <= radius; z++) W.setBlock(x, y ?? PLAT_Y, z, STONE); }
plate(28, PLAT_Y);

function spawnStillVillager(x, y, z) {
  const v = EL.spawn('villager', x, y, z);
  v.ai = new Ai.GoalSelector();   // deterministic tick budget, sleepcheck's own precedent
  return v;
}
function tickN(v, n) { for (let i = 0; i < n; i++) VB.tick(v); }
M.Sky = { dayTime: 10 };   // VILLAGER_DEFAULT's own idle window, unless a section overrides it

// ═══ 1. HURT_BY substrate — a real hit flips VB.tick's own activity to 'panic' ══════════════
console.log('\n 1. HURT_BY: a real Cb.mobAttack hit flips activity to panic (40-tick decay), then decays back out');
{
  const v = spawnStillVillager(0, PLAT_Y + 1, 0);
  VB.tick(v);
  ok(v.vbActivity === 'idle', 'setup: with nothing around, the villager is idle at dayTime 10');

  const zom = EL.spawn('zombie', 30, PLAT_Y + 1, 30);   // far away — only the HIT itself should matter here
  const hit = Cb.mobAttack(zom, v);   // Cb.mobAttack returns a plain boolean, not {hit} like Cb.attack
  ok(hit === true, 'setup: Cb.mobAttack actually landed on the villager');
  ok(v.vbHurtTick !== undefined, 'Cb.notifyHurt stamped e.vbHurtTick (the HURT_BY stand-in) on a villager');
  ok(v.lastHurtByEntity === zom, 'and e.lastHurtByEntity (the HURT_BY_ENTITY stand-in) is the live attacker');

  VB.tick(v);
  ok(v.vbActivity === 'panic', 'the very next VB.tick call, activity is panic off wasHurt alone');

  // decay: move the zombie far past STOP_MAX_DIST so only the 40-tick HURT_BY window matters
  zom.x = 500; zom.z = 500;
  for (let t = 0; t < VBP.HURT_DECAY_TICKS - 1; t++) VB.tick(v);
  ok(v.vbActivity === 'panic', `still panicking ${VBP.HURT_DECAY_TICKS - 1} ticks after the hit (inside the ${VBP.HURT_DECAY_TICKS}-tick HURT_BY window)`);
  VB.tick(v); VB.tick(v);
  ok(v.vbActivity !== 'panic', `panic ends once HURT_BY has decayed past ${VBP.HURT_DECAY_TICKS} ticks with no hostile nearby`);
  ok(v.vbHurtTick === undefined, 'StopPanickingTask\'s own forget cleared e.vbHurtTick');
  ok(v.lastHurtByEntity === null, 'and cleared e.lastHurtByEntity too');
  EL.clear();
}

// ═══ 2. NEAREST_HOSTILE substrate — per-type danger distance, both directions ═══════════════
console.log('\n 2. NEAREST_HOSTILE: a hostile within ITS OWN danger distance panics a villager with NO damage at all');
{
  // zombie's own danger distance is 8 (VillagerHostilesSensor.SQUARED_DISTANCES_FOR_DANGER)
  const v = spawnStillVillager(0, PLAT_Y + 1, 0);
  const zom = EL.spawn('zombie', 7, PLAT_Y + 1, 0);   // 7 < 8 -- inside
  VB.tick(v);
  ok(v.vbActivity === 'panic', 'a zombie 7 blocks away (inside its own 8-block danger distance) triggers panic, no hit needed');
  ok(v.vbHurtTick === undefined, 'and NOT via wasHurt — this villager was never actually hit');
  EL.clear();

  // ANTI-VACUITY, direction 1: the SAME zombie just past ITS OWN distance does not
  const v2 = spawnStillVillager(0, PLAT_Y + 1, 0);
  const zom2 = EL.spawn('zombie', 9, PLAT_Y + 1, 0);   // 9 > 8 -- outside
  VB.tick(v2);
  okAv(v2.vbActivity !== 'panic', 'the same zombie type 9 blocks away (just past its own 8-block distance) does NOT trigger panic');
  EL.clear();

  // ANTI-VACUITY, direction 2: pillager's own distance is 15 (not 8) — a pillager at 10 blocks
  // (which would be OUTSIDE a zombie's own distance) still panics a villager, proving the table
  // is read PER TYPE and not one constant reused for every hostile.
  const v3 = spawnStillVillager(0, PLAT_Y + 1, 0);
  const pill = EL.spawn('pillager', 10, PLAT_Y + 1, 0);
  VB.tick(v3);
  okAv(v3.vbActivity === 'panic', 'a pillager 10 blocks away (inside ITS OWN 15-block distance, though past a zombie\'s 8) still triggers panic — the per-type table is really read');
  EL.clear();

  // ANTI-VACUITY, direction 3: a passive mob (cow) at point-blank range never triggers panic —
  // the table only matches the fixed hostile list, not "any nearby entity"
  const v4 = spawnStillVillager(0, PLAT_Y + 1, 0);
  EL.spawn('cow', 1, PLAT_Y + 1, 0);
  VB.tick(v4);
  okAv(v4.vbActivity !== 'panic', 'a cow standing right next to the villager never triggers panic — HOSTILE_DANGER_DIST has no cow row');
  EL.clear();
}

// ═══ 3. flee direction — a panicking villager actually walks AWAY from the danger ═══════════
console.log('\n 3. a panicking villager actually walks AWAY from the hostile (or its attacker), not toward it');
{
  const savedRand3 = VB.rand;
  VB.rand = mulberry32(3);   // deterministic -- see the mulberry32 header above
  const v = spawnStillVillager(0, PLAT_Y + 1, 0);
  const zom = EL.spawn('zombie', 5, PLAT_Y + 1, 0);   // due +x of the villager
  VB.tick(v);
  ok(v.vbActivity === 'panic', 'setup: panicking off the nearby zombie');
  const d0 = Math.hypot(v.x - zom.x, v.z - zom.z);
  // fleeAwayFrom's own 10-candidate fuzz search can legitimately whiff on any SINGLE tick (the
  // single-block-thick test plate below it means only a narrow vertical fuzz offset lands on
  // real ground) -- FindWalkTargetTask's own fallback then retries a smaller box, and either
  // one gets another 10-candidate roll next tick regardless, the SAME "retry across ticks, not
  // within one" idiom vbactivitycheck.mjs's own §3b already uses for villagerInterest. Give it
  // up to 20 ticks to land a WALK_TARGET at all before judging where it went.
  let gotTarget = !!v.vbWalkTarget, t0 = 0;
  for (; t0 < 20 && !gotTarget; t0++) { VB.tick(v); EL.tick(); gotTarget = !!v.vbWalkTarget; }
  ok(gotTarget, `setup: a flee WALK_TARGET was actually set within ${t0} tick(s)`);
  // ⚠ Past FLEE_RANGE (6), GoToRememberedPositionTask's own shouldRun (loop/vbpanic's
  // `fleeShouldRun`, src/07zv3_vbpanic.js) stops replanning a flee target -- a villager that has
  // put 6+ blocks between itself and the hostile just wanders FindWalkTargetTask's small,
  // UNBIASED box from then on, exactly like real vanilla, so distance is NOT monotonic over a
  // long run any more (the old, pre-fix code fled unconditionally forever, which is why a plain
  // "still farther after 200 ticks" check used to hold). The peak distance reached during the
  // active flee is still the real "fled away" proof; not a fixed heading (FuzzyTargeting's own
  // cone is 90 degrees wide, VBP.FLEE_ANGLE) but growing distance while still fleeing.
  let maxD = d0;
  for (let t = 0; t < 60; t++) {
    VB.tick(v); EL.tick();
    const d = Math.hypot(v.x - zom.x, v.z - zom.z);
    if (d > maxD) maxD = d;
  }
  ok(maxD > d0 + 1, `the villager reached a distance farther from the zombie than it started (${d0.toFixed(2)} -> peak ${maxD.toFixed(2)}), not closer`);
  EL.clear();
  VB.rand = savedRand3;
}

// ═══ 4. StopPanickingTask's hysteresis — wasHurtByNearbyEntity keeps panic alive ════════════
console.log('\n 4. wasHurtByNearbyEntity: an attacker still within 6 blocks keeps panic running past the 40-tick HURT_BY window');
{
  // An explicit, unambiguous test of wasHurtByNearbyEntity itself. STOP_MAX_DIST (6) is smaller
  // than every HOSTILE_DANGER_DIST row (8+), so an entity close enough for wasHurtByNearbyEntity
  // is always ALSO close enough for isHostileNearby if it is still a listed hostile type — the
  // one way to isolate the third clause is to make the SAME live attacker no longer match the
  // hostile table at all (re-typing the object in place, not swapping in a new entity), so only
  // "it is my own live HURT_BY_ENTITY, within 6 blocks" is left carrying panic.
  const v2 = spawnStillVillager(0, PLAT_Y + 1, 0);
  const zom2 = EL.spawn('zombie', 100, PLAT_Y + 1, 100);
  Cb.notifyHurt(v2, zom2);   // the SAME hook Cb.mobAttack itself calls (aicheck.mjs's own precedent)
  zom2.type = 'cow';        // no longer a HOSTILE_DANGER_DIST row -- isHostileNearby can never see it
  zom2.x = 4; zom2.z = 0;   // inside STOP_MAX_DIST (6)
  VB.tick(v2);
  ok(v2.vbActivity === 'panic', 'setup: panicking (fresh HURT_BY)');
  for (let t = 0; t < VBP.HURT_DECAY_TICKS + 2; t++) VB.tick(v2);
  ok(v2.vbActivity === 'panic', `with the attacker (no longer even a hostile TYPE, so isHostileNearby is never true for it) parked at 4 blocks the whole time, panic is STILL running ${VBP.HURT_DECAY_TICKS + 2} ticks after the hit — wasHurtByNearbyEntity (<= ${VBP.STOP_MAX_DIST} blocks) alone is carrying it`);
  okAv(v2.lastHurtByEntity === zom2, 'anti-vacuity setup: the attacker really is still the live HURT_BY_ENTITY, not cleared early');

  zom2.x = VBP.STOP_MAX_DIST + 2; zom2.z = 0;   // now past STOP_MAX_DIST too
  let stopped = false, t2 = 0;
  for (; t2 < 20 && !stopped; t2++) { VB.tick(v2); stopped = v2.vbActivity !== 'panic'; }
  okAv(stopped, `moving the (still non-hostile-typed) attacker past STOP_MAX_DIST (${VBP.STOP_MAX_DIST}) too, panic finally ends (took ${t2} tick(s)) — proving wasHurtByNearbyEntity's own distance gate is real, not always-true`);
  EL.clear();
}

// ═══ 5. panic pre-empts the schedule — doExclusively's own effect ══════════════════════════
console.log('\n 5. panic pre-empts whatever the schedule says (a mid-work villager that gets hurt switches to panic, not work)');
{
  const v = spawnStillVillager(0, PLAT_Y + 1, 0);
  M.Sky = { dayTime: 2000 };   // VILLAGER_DEFAULT's own work window
  VB.tick(v);
  ok(v.vbActivity === 'work', 'setup: at dayTime 2000 the villager is scheduled work');
  const zom = EL.spawn('zombie', 2, PLAT_Y + 1, 0);
  // VillagerHostilesSensor's own 20-tick cadence (vbpanic's own hostileSenseTick) already fired
  // ONCE above (with no hostile around yet) and won't resense on its own for another 20 ticks --
  // force it, so this section still tests "same tick a hostile is seen, panic pre-empts work",
  // not the cadence delay (section 9, below, tests that on its own).
  v.vbHostileSenseCD = 0;
  VB.tick(v);
  ok(v.vbActivity === 'panic', 'the SAME dayTime (still work\'s own window), a nearby hostile switches activity to panic, not work');
  EL.clear();
  M.Sky = { dayTime: 10 };
}

// ═══ 6. the panic-quorum golem summon (PanicTask's own summonGolem(...,3)) ═════════════════
console.log('\n 6. panicking with 3 eligible villagers nearby (PanicTask\'s own lower quorum) summons an iron golem on the 100-tick gate');
{
  const vs = [spawnStillVillager(0, PLAT_Y + 1, 0), spawnStillVillager(2, PLAT_Y + 1, 0), spawnStillVillager(-2, PLAT_Y + 1, 0)];
  for (const vv of vs) vv.vbLastSlept = 0;   // Village.hasRecentlySlept's own gate, villagegolemcheck's own precedent
  const zom = EL.spawn('zombie', 1, PLAT_Y + 1, 5);   // near vs[0], inside its 8-block danger distance
  M.Sky = { dayTime: 10 };   // deliberately NOT a multiple of GOLEM_INTERVAL (100) -- see below
  VB.tick(vs[0]);
  ok(vs[0].vbActivity === 'panic', 'setup: vs[0] is panicking off the nearby zombie');
  ok(!vs[0].golemDetectedUntil, 'setup: no golem summon happened yet (dayTime 10 does not land on the 100-tick gate)');
  const before = EL.list.filter((e) => e.type === 'iron_golem').length;
  M.Sky.dayTime = 100;   // land exactly on GOLEM_INTERVAL's own modulo gate
  VB.tick(vs[0]);
  const after = EL.list.filter((e) => e.type === 'iron_golem').length;
  ok(after === before + 1, `an iron golem was summoned on the 100-tick gate with 3 eligible villagers nearby (PanicTask's own quorum), got ${after - before} new golem(s)`);
  ok(vs.every((vv) => vv.golemDetectedUntil > 0), 'and every nearby eligible villager now carries the GOLEM_DETECTED_RECENTLY cooldown');
  EL.clear();

  // ANTI-VACUITY: only 2 eligible villagers (one short of GOLEM_QUORUM=3) never summons one
  const vs2 = [spawnStillVillager(0, PLAT_Y + 1, 0), spawnStillVillager(2, PLAT_Y + 1, 0)];
  for (const vv of vs2) vv.vbLastSlept = 0;
  const zom2 = EL.spawn('zombie', 1, PLAT_Y + 1, 5);
  M.Sky = { dayTime: 210 };   // again, deliberately off the 100-tick gate for the setup tick
  VB.tick(vs2[0]);
  ok(vs2[0].vbActivity === 'panic', 'setup: vs2[0] is panicking too');
  const before2 = EL.list.filter((e) => e.type === 'iron_golem').length;
  M.Sky.dayTime = 300;
  VB.tick(vs2[0]);
  okAv(EL.list.filter((e) => e.type === 'iron_golem').length === before2, 'two eligible villagers (one short of GOLEM_QUORUM=3) never trigger a panic-summon');
  EL.clear();
  M.Sky = { dayTime: 10 };
}

// ═══ 7. anti-vacuity — breaking this unit's own data ════════════════════════════════════════
console.log('\n 7. anti-vacuity: breaking the danger-distance table itself is what section 2 actually depends on');
{
  const saved = VBP.HOSTILE_DANGER_DIST.zombie;
  delete VBP.HOSTILE_DANGER_DIST.zombie;
  const v = spawnStillVillager(0, PLAT_Y + 1, 0);
  EL.spawn('zombie', 2, PLAT_Y + 1, 0);
  VB.tick(v);
  okAv(v.vbActivity !== 'panic', 'with the zombie row deleted from HOSTILE_DANGER_DIST, the SAME nearby zombie no longer triggers panic — section 2 really reads this table, not a hard-coded "zombie" check');
  VBP.HOSTILE_DANGER_DIST.zombie = saved;
  EL.clear();
}


// ═══ 8. canSee: a solid wall blocks NEAREST_HOSTILE detection (TargetPredicate's own
//      respectsVisibility -> MobEntity.getVisibilityCache().canSee) ═══════════════════════════
console.log('\n 8. canSee: a solid wall between the villager and a hostile blocks NEAREST_HOSTILE detection');
{
  const v = spawnStillVillager(0, PLAT_Y + 1, 0);
  for (let y = PLAT_Y + 1; y <= PLAT_Y + 4; y++) for (let z = -3; z <= 3; z++) W.setBlock(3, y, z, STONE);
  const zom = EL.spawn('zombie', 7, PLAT_Y + 1, 0);   // inside the 8-block danger distance...
  VB.tick(v);
  ok(v.vbActivity !== 'panic', 'a zombie inside its own 8-block danger distance, but behind a solid wall, does NOT trigger panic -- canSee gates it');

  // ANTI-VACUITY: remove the wall -- the SAME zombie, same distance, now triggers panic once resensed
  for (let y = PLAT_Y + 1; y <= PLAT_Y + 4; y++) for (let z = -3; z <= 3; z++) W.setBlock(3, y, z, 0);
  v.vbHostileSenseCD = 0;   // force a fresh sense rather than waiting out the 20-tick cadence (section 9)
  VB.tick(v);
  okAv(v.vbActivity === 'panic', 'with the wall removed (forcing a fresh sense), the SAME zombie at the SAME distance now triggers panic -- proving this really reads canSee, not a stuck "never see"');
  EL.clear();
}

// ═══ 9. VillagerHostilesSensor's own 20-tick cadence (Sensor.tick) ═════════════════════════
console.log('\n 9. sensor cadence: a hostile that appears is only picked up once the sensor actually resenses, not the very next VB.tick');
{
  const v = spawnStillVillager(0, PLAT_Y + 1, 0);
  VB.tick(v);   // first-ever sense: nothing around -- e.vbHostileSenseCD resets to SENSE_INTERVAL
  ok(v.vbActivity !== 'panic', 'setup: nothing around on the first sense');
  const zom = EL.spawn('zombie', 2, PLAT_Y + 1, 0);   // now well inside danger distance
  for (let t = 0; t < VBP.SENSE_INTERVAL - 1; t++) VB.tick(v);
  okAv(v.vbActivity !== 'panic', `still not detected ${VBP.SENSE_INTERVAL - 1} ticks after the zombie appeared -- the sensor has not resensed yet (real Sensor cadence, not "every VB.tick")`);
  VB.tick(v);
  ok(v.vbActivity === 'panic', `on the sensor's own ${VBP.SENSE_INTERVAL}-tick resense gate, the villager finally detects it`);
  EL.clear();
}

// ═══ 10. createPanicTasks' own speed*1.5 boost (VBP.PANIC_SPEED_MUL) ═══════════════════════
console.log('\n 10. the panic speed*1.5 boost actually reaches VB.wanderTick\'s own stepToward call, not just the walk target');
{
  const v = spawnStillVillager(0, PLAT_Y + 1, 0);
  const zom = EL.spawn('zombie', 4, PLAT_Y + 1, 0);   // inside FLEE_RANGE -- a real flee target
  VB.tick(v);
  ok(v.vbActivity === 'panic', 'setup: panicking');
  let got = !!v.vbWalkTarget, t0 = 0;
  for (; t0 < 20 && !got; t0++) { VB.tick(v); EL.tick(); got = !!v.vbWalkTarget; }
  ok(got && v.vbWalkTarget.speedMul === VBP.PANIC_SPEED_MUL, `setup: the walk target carries VBP.PANIC_SPEED_MUL (${VBP.PANIC_SPEED_MUL}) within ${t0} tick(s)`);
  // Drive the shared walker (VB.wanderTick) until it actually plans+steps a path, then read
  // Ai.setMobSpeed's own write (07k_goals.js: `e.mobSpeed = speedModifier * movementSpeedOf(e)`)
  // straight off the entity -- the exact value stepToward just computed.
  let panicSpeed = null;
  for (let i = 0; i < 20 && panicSpeed === null; i++) { VB.wanderTick(v, (v.vbAge || 0) + i + 1); if (v.mobSpeed) panicSpeed = v.mobSpeed; }
  ok(panicSpeed !== null, 'setup: VB.wanderTick actually drove a step (e.mobSpeed got set)');
  const expected = VB.WALK_SPEED * VBP.PANIC_SPEED_MUL * Ai.movementSpeedOf(v);
  ok(Math.abs(panicSpeed - expected) < 1e-6, `e.mobSpeed (${panicSpeed}) matches VB.WALK_SPEED * PANIC_SPEED_MUL * movementSpeedOf (${expected})`);
  const plain = VB.WALK_SPEED * Ai.movementSpeedOf(v);
  okAv(Math.abs(panicSpeed - plain) > 1e-6, 'anti-vacuity: the boosted speed is measurably different from the PLAIN (unboosted) VB.WALK_SPEED*movementSpeedOf');
  EL.clear();
}

// ═══ 11. GoToRememberedPositionTask's real shouldRun: a flee walk only fires within FLEE_RANGE ═
console.log('\n 11. shouldRun collapse: a flee walk only fires within FLEE_RANGE(6) of the hostile, not at any detection distance');
{
  const v = spawnStillVillager(0, PLAT_Y + 1, 0);
  const zom = EL.spawn('zombie', 7, PLAT_Y + 1, 0);   // inside danger dist (8) but OUTSIDE FLEE_RANGE (6)
  VB.tick(v);
  ok(v.vbActivity === 'panic', 'setup: panicking off the nearby-but-not-that-nearby zombie');
  let got = !!v.vbWalkTarget, t = 0;
  for (; t < 20 && !got; t++) { VB.tick(v); EL.tick(); got = !!v.vbWalkTarget; }
  ok(got, `setup: some walk target was set within ${t} tick(s)`);
  ok(v.vbWalkTarget.range === 0, 'past FLEE_RANGE but inside HOSTILE_DANGER_DIST, only FindWalkTargetTask\'s small wander (range 0) fires, not the flee task (range 6)');
  EL.clear();

  // ANTI-VACUITY: the same zombie moved INSIDE FLEE_RANGE actually gets a real flee target (range 6)
  const savedRand11 = VB.rand;
  VB.rand = mulberry32(11);   // deterministic -- see the mulberry32 header above
  const v2 = spawnStillVillager(0, PLAT_Y + 1, 0);
  const zom2 = EL.spawn('zombie', 4, PLAT_Y + 1, 0);   // inside FLEE_RANGE (6)
  VB.tick(v2);
  okAv(v2.vbActivity === 'panic', 'setup: panicking off the close zombie');
  // Drive VBP.tick directly (not VB.tick+EL.tick's full wander/physics loop): fleeAwayFrom's own
  // 10-candidate fuzz search can whiff on any single call, and going through real movement means
  // a stray FindWalkTargetTask fallback (range 0) can occupy WALK_TARGET for a while before the
  // flee task gets another try, which is real behaviour but makes THIS assertion (does the flee
  // task fire AT ALL within range) needlessly dependent on how physics/pathing timing happens to
  // land. Resetting e.vbWalkTarget before each call isolates exactly the thing under test: does
  // a fresh planning attempt, this close to the hostile, ever produce a range-FLEE_RANGE target.
  let gotFlee2 = false, t2 = 0;
  for (; t2 < 30 && !gotFlee2; t2++) {
    v2.vbWalkTarget = null;
    VBP.tick(v2, 10, (v2.vbAge = (v2.vbAge || 0) + 1));
    gotFlee2 = !!v2.vbWalkTarget && v2.vbWalkTarget.range === VBP.FLEE_RANGE;
  }
  okAv(gotFlee2, `inside FLEE_RANGE, the flee task actually fires (range ${VBP.FLEE_RANGE}) within ${t2} attempt(s) -- the gate is a real distance test, not "always small"`);
  EL.clear();
  VB.rand = savedRand11;
}

// ═══ 12. createBusyFollowTask: panic's own priority-5 look-at-nearby-cat/wolf ═══════════════
console.log('\n 12. createBusyFollowTask: a nearby, visible cat/wolf gets remembered as e.vbLookTarget (LOOK_TARGET stand-in)');
{
  // Force the RandomTask draw deterministically through VB.rand (nextInt's own source): roll 0
  // always lands inside the CAT weight band (BUSY_FOLLOW_CAT_WEIGHT=2, so any roll < 2 does).
  const savedRand = VB.rand;
  VB.rand = () => 0;
  const v = spawnStillVillager(0, PLAT_Y + 1, 0);
  const zom = EL.spawn('zombie', 4, PLAT_Y + 1, 0);   // keeps it panicking
  const cat = EL.spawn('cat', 2, PLAT_Y + 1, 0);      // within BUSY_FOLLOW_DIST (8), visible
  VB.tick(v);
  ok(v.vbActivity === 'panic', 'setup: panicking (off the zombie)');
  ok(!!v.vbLookTarget, 'a nearby, visible cat sets e.vbLookTarget (the forced FollowMobTask(cat) draw)');
  ok(!!v.vbLookTarget && v.vbLookTarget.x === cat.x && v.vbLookTarget.z === cat.z, 'and it points at the cat itself');
  EL.clear();

  // ANTI-VACUITY: the SAME forced CAT draw, but only a WOLF (not a cat) nearby, sets nothing --
  // proving the type filter is real, not "any nearby entity".
  const v2 = spawnStillVillager(0, PLAT_Y + 1, 0);
  const zom2 = EL.spawn('zombie', 4, PLAT_Y + 1, 0);
  const wolf = EL.spawn('wolf', 2, PLAT_Y + 1, 0);
  VB.tick(v2);
  okAv(v2.vbActivity === 'panic', 'setup: panicking (off the zombie) with only a wolf nearby');
  okAv(!v2.vbLookTarget, 'the forced CAT draw with only a wolf nearby sets no LOOK_TARGET -- the type filter really matters');
  EL.clear();
  VB.rand = savedRand;
}

// ═══ report ═══════════════════════════════════════════════════════════════════════════════
console.log(` assertions passed .. ${pass}`); console.log(` failures ........... ${fails.length}`);   // suite.mjs count format
console.log(`\n${pass} ok, ${breaks} anti-vacuity breaks caught, ${fails.length} failed`);
if (fails.length) {
  console.log('\nFAILURES:');
  fails.forEach((m) => console.log('  - ' + m));
  console.log('\nFAIL vbpaniccheck');
  process.exit(1);
}
console.log(`\nPASS vbpaniccheck — ${pass} checks green (incl. ${breaks} anti-vacuity)`);
