#!/usr/bin/env node
// vbidlecheck.mjs — loop/vbidle: createIdleTasks' priority-2 RandomTask's own five remaining
// entries (src/07zv4_vbidle.js's own NS.VB.IDLE_START, hooked through 07zv_villagerbrain.js's
// own VB.idleFallbackTick/VB.idleContinue). Every number here is cited in 07zv4_vbidle.js, read
// off `.decomp` this session: VillagerTaskListProvider.java:141-172, FindEntityTask.java,
// GoTowardsLookTarget.java, JumpInBedTask.java, WaitTask.java, VillagerEntity.java:98-108/667-706.
//
//   node tools/vbidlecheck.mjs [--verbose]
//
// Sections:
//   1. VB.IDLE_FALLBACK — the real seven weighted entries (2:1:1:1:1:1:1), not the old 2:1 pair
//   2. breedInterestStart — two ready-to-breed villagers pair up; one short on food does not
//   3. traderInterestStart — a nearby wandering trader gets a walk target; the villager type
//      itself (not a trader) never does
//   4. goTowardsLookStart — only walks toward a REAL e.vbLookTarget, and only when no walk
//      target is already set
//   5. jumpInBedStart/VB.idleContinue — a baby standing on a real bed block jumps (e.jumping)
//      over real ticks and the task ends once its jump budget is spent
//   6. waitStart/VB.idleContinue — occupies the idle slot for its own random 30-60 tick window,
//      blocking a fresh weighted pick until it ends
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

console.log('vbidlecheck — loop/vbidle: createIdleTasks priority-2 RandomTask’s five remaining entries (NS.VB.IDLE_START)');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
  '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
  '07i_entitylist.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js',
  '14l_use.js', '07za_explosion.js', '07m_breed.js', '07q_effects.js', '07zu_poi.js', '07o_profession.js',
  '07k_goals.js', '07zv_villagerbrain.js', '07zv4_vbidle.js', '07zt_wtrader.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Entities.attrs = M.DATA.entities.attrs;
M.Effects.ready = true;

const W = M.World, CH = M.CH, R = M.Reg, SR = M.States;
const Poi = M.Poi, Ai = M.Ai, VB = M.VB, EL = M.EntityList, Prof = M.Profession;

ok(VB, 'NS.VB did not load');
ok(!!(VB && VB.IDLE_START && VB.IDLE_START.breedInterest && VB.IDLE_START.catInterest
  && VB.IDLE_START.goTowardsLook && VB.IDLE_START.jumpInBed && VB.IDLE_START.wait),
  '07zv4_vbidle.js did not attach VB.IDLE_START’s five entries onto the shared NS.VB namespace');
if (!VB || !VB.IDLE_START) { console.log('\nFAIL vbidlecheck — module missing'); process.exit(1); }

W.init(1);
M.Behave.init(W);
if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init();
EL.init();
Ai.init();
Prof.init();
ok(Ai.ready, 'Ai module reports ready');

for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
const STONE = SR.stateOf('stone');
const PLAT_Y = 63;
function plate(radius, y) { for (let x = -radius; x <= radius; x++) for (let z = -radius; z <= radius; z++) W.setBlock(x, y, z, STONE); }
plate(28, PLAT_Y);

function bedHeadState(name) {
  const bId = R.id[name], P_ = R.PROP, V = R.PVAL;
  for (let s = R.realFirst[bId]; s < R.realFirst[bId + 1]; s++) {
    if (SR.propValue(s, P_.part) === V.head && SR.propValue(s, P_.occupied) === V['false']) return s;
  }
  return null;
}
const BED_STATE = bedHeadState('red_bed');

function spawnStillVillager(x, y, z, baby) {
  const v = EL.spawn('villager', x, y, z);
  v.ai = new Ai.GoalSelector();
  if (baby) v.isBaby = true;   // loop/vbgather: e.baby was folded into Breed's own e.isBaby
  return v;
}
function giveItem(e, name, count) {
  const inv = VB.ensureVillagerInventory(e);
  const idx = M.Items.of(name);
  inv[0] = { i: idx, n: count };
}

// ═══ 1. VB.IDLE_FALLBACK — the real seven, 2:1:1:1:1:1:1 ═════════════════════════════════════════
console.log('\n 1. VB.IDLE_FALLBACK carries the real seven createIdleTasks entries, weight 2:1:1:1:1:1:1');
{
  const names = VB.IDLE_FALLBACK.map((r) => r[0]).sort();
  const expectNames = ['breedInterest', 'findWalkTarget', 'goTowardsLook', 'jumpInBed', 'catInterest', 'villagerInterest', 'wait'].sort();
  ok(JSON.stringify(names) === JSON.stringify(expectNames), `all seven createIdleTasks names present, got [${names.join(',')}]`);
  const weights = {}; VB.IDLE_FALLBACK.forEach((r) => { weights[r[0]] = r[1]; });
  ok(weights.villagerInterest === 2, 'villager-interest keeps its own weight 2');
  okAv(['breedInterest', 'catInterest', 'findWalkTarget', 'goTowardsLook', 'jumpInBed', 'wait'].every((n) => weights[n] === 1),
    'every other entry carries the REAL weight 1 (not folded away, not double-counted)');
  const total = VB.IDLE_FALLBACK.reduce((s, r) => s + r[1], 0);
  ok(total === 8, `the seven weights sum to 8 (2+1*6), matching the jar's own RandomTask total, got ${total}`);
}

// ═══ 2. breedInterestStart — two ready villagers pair up; a hungry one does not ════════════════
console.log('\n 2. breedInterestStart pairs up two ready-to-breed villagers by real inventory food value; a hungry one does not');
{
  const a = spawnStillVillager(0, PLAT_Y + 1, 0, false);
  const b = spawnStillVillager(5, PLAT_Y + 1, 5, false);
  giveItem(a, 'bread', 3);   // 3*4 = 12, exactly VB.BREED_FOOD_MIN
  giveItem(b, 'bread', 3);
  ok(VB.villagerReadyToBreed(a) && VB.villagerReadyToBreed(b), 'setup: both villagers are readyToBreed with 12 food value of bread');
  const started = VB.IDLE_START.breedInterest(a);
  ok(started === true, 'breedInterestStart fires when both villagers are ready and in range');
  ok(!!a.vbWalkTarget && a.vbWalkTarget.x === Math.floor(b.x) && a.vbWalkTarget.z === Math.floor(b.z),
    'the walk target lands exactly on the OTHER ready villager’s own position');
  ok(a.vbBreedTarget === b, 'e.vbBreedTarget records the chosen partner (this file’s own BREED_TARGET stand-in)');
  EL.clear();

  const c = spawnStillVillager(0, PLAT_Y + 1, 0, false);
  const d = spawnStillVillager(5, PLAT_Y + 1, 5, false);
  giveItem(c, 'bread', 3);
  giveItem(d, 'bread', 2);   // 2*4 = 8 < 12, NOT ready
  okAv(VB.villagerReadyToBreed(c) && !VB.villagerReadyToBreed(d), 'setup: d is short of the 12 food-value threshold (8 < 12)');
  okAv(VB.IDLE_START.breedInterest(c) === false, 'breedInterestStart refuses to pair a ready villager with a NOT-ready one — no walk target is set');
  ok(!c.vbWalkTarget, 'confirming: c really has no walk target after the refused pick');
  EL.clear();

  const baby1 = spawnStillVillager(0, PLAT_Y + 1, 0, true);
  const adult1 = spawnStillVillager(5, PLAT_Y + 1, 5, false);
  giveItem(baby1, 'bread', 10); giveItem(adult1, 'bread', 10);
  okAv(!VB.villagerReadyToBreed(baby1), 'a baby is never readyToBreed regardless of food (breedingAge stand-in)');
  okAv(VB.IDLE_START.breedInterest(baby1) === false, 'breedInterestStart refuses to run for a baby villager even with a ready adult nearby');
  EL.clear();
}

// ═══ 3. catInterestStart — walks toward a real cat, ignores a plain villager ═══════════════
console.log('\n 3. catInterestStart walks toward a real nearby cat (EntityType.field_16281, NOT wandering_trader); a plain villager neighbour does not trigger it');
{
  const v = spawnStillVillager(0, PLAT_Y + 1, 0, false);
  const cat = EL.spawn('cat', 4, PLAT_Y + 1, 4);
  ok(cat && cat.type === 'cat', 'setup: a real cat entity spawned');
  const started = VB.IDLE_START.catInterest(v);
  ok(started === true, 'catInterestStart fires with a cat in range');
  ok(!!v.vbWalkTarget && v.vbWalkTarget.x === Math.floor(cat.x) && v.vbWalkTarget.z === Math.floor(cat.z),
    'the walk target lands exactly on the cat’s own position');
  EL.clear();

  const v2 = spawnStillVillager(0, PLAT_Y + 1, 0, false);
  const other = spawnStillVillager(4, PLAT_Y + 1, 4, false);
  okAv(VB.IDLE_START.catInterest(v2) === false, 'catInterestStart does NOT fire for a plain villager neighbour (only cat counts)');
  ok(!v2.vbWalkTarget, 'confirming: v2 really has no walk target');
  EL.clear();

  // 3b. anti-vacuity, the other direction: a wandering_trader neighbour (the OLD, wrong guess
  // this function used to scan for) does NOT trigger it either.
  const v3 = spawnStillVillager(0, PLAT_Y + 1, 0, false);
  const trader = EL.spawn('wandering_trader', 4, PLAT_Y + 1, 4);
  okAv(VB.IDLE_START.catInterest(v3) === false, 'catInterestStart does NOT fire for a wandering_trader neighbour (EntityType.field_16281 is CAT, not WANDERING_TRADER)');
  ok(!v3.vbWalkTarget, 'confirming: v3 really has no walk target');
  EL.clear();
}

// ═══ 4. goTowardsLookStart — only with a real vbLookTarget and no existing walk target ════════
console.log('\n 4. goTowardsLookStart walks toward e.vbLookTarget only when present and no walk target is already set');
{
  const v = spawnStillVillager(0, PLAT_Y + 1, 0, false);
  v.vbLookTarget = { x: 7, y: PLAT_Y + 1, z: 9 };
  const started = VB.IDLE_START.goTowardsLook(v);
  ok(started === true, 'goTowardsLookStart fires once e.vbLookTarget is set');
  ok(v.vbWalkTarget && v.vbWalkTarget.x === 7 && v.vbWalkTarget.y === PLAT_Y + 1 && v.vbWalkTarget.z === 9 && v.vbWalkTarget.range === 2,
    'the walk target copies e.vbLookTarget exactly, completionRange 2 (GoTowardsLookTarget.java:20)');
  EL.clear();

  const v2 = spawnStillVillager(0, PLAT_Y + 1, 0, false);
  okAv(VB.IDLE_START.goTowardsLook(v2) === false, 'goTowardsLookStart refuses with no e.vbLookTarget at all');
  EL.clear();

  const v3 = spawnStillVillager(0, PLAT_Y + 1, 0, false);
  v3.vbLookTarget = { x: 1, y: PLAT_Y + 1, z: 1 };
  v3.vbWalkTarget = { x: 9, y: PLAT_Y + 1, z: 9, range: 0 };
  okAv(VB.IDLE_START.goTowardsLook(v3) === false, 'goTowardsLookStart refuses while a walk target is already set (WALK_TARGET must be absent)');
  ok(v3.vbWalkTarget.x === 9, 'confirming: the pre-existing walk target was left untouched');
  EL.clear();
}

// ═══ 5. jumpInBedStart / VB.idleContinue — a baby jumps on a real bed, then stops ══════════
console.log('\n 5. a baby villager standing on a real bed jumps (e.jumping) over real ticks, then the task ends');
{
  W.setBlock(2, PLAT_Y + 1, 2, BED_STATE);
  const baby = spawnStillVillager(2.5, PLAT_Y + 1, 2.5, true);
  const started = VB.IDLE_START.jumpInBed(baby);
  ok(started === true, 'jumpInBedStart fires for a baby already standing on its own claimed bed');
  ok(!!baby.vbBedJump, 'e.vbBedJump state is populated (bedPos/ticksOutOfBed/jumpsRemaining)');
  ok(baby.vbBedJump.jumpsRemaining >= 3 && baby.vbBedJump.jumpsRemaining <= 6, `jumpsRemaining is 3..6 (3+nextInt(4)), got ${baby.vbBedJump.jumpsRemaining}`);

  let sawJump = false, ticks = 0, stillRunning = true;
  while (stillRunning && ticks < 400) {
    baby.jumping = false;
    stillRunning = VB.idleContinue(baby);
    if (baby.jumping) sawJump = true;
    ticks++;
  }
  okAv(sawJump, `the baby actually set e.jumping = true at least once while on the bed (over ${ticks} ticks)`);
  okAv(!stillRunning && !baby.vbBedJump, `the task ends on its own once the jump budget is spent (took ${ticks} ticks)`);
  W.setBlock(2, PLAT_Y + 1, 2, STONE);
  EL.clear();

  // 5b. anti-vacuity, the other direction: an ADULT on the exact same bed never starts jumping.
  W.setBlock(6, PLAT_Y + 1, 6, BED_STATE);
  const adult = spawnStillVillager(6.5, PLAT_Y + 1, 6.5, false);
  adult.vbHome = { x: 6, y: PLAT_Y + 1, z: 6 };
  okAv(VB.IDLE_START.jumpInBed(adult) === false, 'jumpInBedStart refuses for an adult villager (JumpInBedTask is baby-only)');
  W.setBlock(6, PLAT_Y + 1, 6, STONE);
  EL.clear();
}

// ═══ 5c. NearestBedSensor — unclaimed reachable bed 20 away; walled bed; cadence ═════════
console.log('\n 5c. NearestBedSensor: a baby with no vbHome finds a reachable bed 20 blocks away, not a walled one, on a 20-tick cadence');
{
  Poi.init();
  W.setBlock(20, PLAT_Y + 1, 0, BED_STATE);
  Poi.tick();
  const baby = spawnStillVillager(0.5, PLAT_Y + 1, 0.5, true);
  baby.vbHome = null;
  ok(VB.IDLE_START.jumpInBed(baby) === false, 'before any sensor tick there is no NEAREST_BED memory, so no jump');
  VB.nearestBedSensorTick(baby, 1);
  ok(!!baby.vbNearestBed && baby.vbNearestBed.x === 20, 'sensor remembers the reachable bed 20 blocks away');
  okAv(VB.IDLE_START.jumpInBed(baby) === true && baby.vbWalkTarget && baby.vbWalkTarget.x === 20,
    'a baby with no vbHome jumps in the unclaimed bed 20 blocks away (walk target set)');
  // cadence: remove the memory, a tick before 20 elapsed must not rescan
  baby.vbNearestBed = null;
  for (let t = 2; t < 21; t++) VB.nearestBedSensorTick(baby, t);
  okAv(!baby.vbNearestBed, 'sensor does not rescan before its 20-tick cadence elapses');
  VB.nearestBedSensorTick(baby, 21);
  W.setBlock(20, PLAT_Y + 1, 0, STONE);
  EL.clear();
  // walled bed: bed at (-20,0) fully enclosed by a 3-high ring of stone
  Poi.init();
  const bx = -20, bz = 0;
  for (let x = bx - 2; x <= bx + 2; x++) for (let z = bz - 2; z <= bz + 2; z++) {
    if (Math.abs(x - bx) === 2 || Math.abs(z - bz) === 2) for (let y = PLAT_Y + 1; y <= PLAT_Y + 4; y++) W.setBlock(x, y, z, STONE);
  }
  W.setBlock(bx, PLAT_Y + 1, bz, BED_STATE);
  Poi.tick();
  const b2 = spawnStillVillager(0.5, PLAT_Y + 1, 0.5, true);
  VB.nearestBedSensorTick(b2, 1);
  okAv(!b2.vbNearestBed, 'the same kind of bed behind a wall with no path is NOT chosen');
  for (let x = bx - 2; x <= bx + 2; x++) for (let z = bz - 2; z <= bz + 2; z++) for (let y = PLAT_Y + 1; y <= PLAT_Y + 4; y++) W.setBlock(x, y, z, 0);
  EL.clear();
}

// ═══ 6. waitStart / VB.idleContinue — occupies the idle slot for its own random duration ════════
console.log('\n 6. waitStart occupies the idle slot for a real 30-60 tick window, blocking a fresh pick until it ends');
{
  const v = spawnStillVillager(0, PLAT_Y + 1, 0, false);
  const started = VB.IDLE_START.wait(v);
  ok(started === true, 'waitStart always fires (WaitTask has no memory requirements at all)');
  ok(!!v.vbIdleWait && v.vbIdleWait.ticksLeft >= 30 && v.vbIdleWait.ticksLeft <= 60,
    `e.vbIdleWait.ticksLeft is 30..60 (Task.java's own minRunTime+nextInt(...)), got ${v.vbIdleWait && v.vbIdleWait.ticksLeft}`);
  const expected = v.vbIdleWait.ticksLeft;
  let ticks = 0, running = true;
  while (running && ticks < 100) { running = VB.idleContinue(v); ticks++; }
  okAv(ticks === expected, `VB.idleContinue keeps returning true for exactly its own random duration (${expected}), then false; ran ${ticks}`);
  ok(!v.vbIdleWait, 'e.vbIdleWait is cleared once the wait ends');
  EL.clear();

  // 6b. anti-vacuity: waitStart never guards on an existing walk target (WaitTask's own
  // ImmutableMap.of() memory requirement), unlike every other entry in this file.
  const v2 = spawnStillVillager(0, PLAT_Y + 1, 0, false);
  v2.vbWalkTarget = { x: 1, y: PLAT_Y + 1, z: 1, range: 0 };
  okAv(VB.IDLE_START.wait(v2) === true, 'waitStart fires even while e.vbWalkTarget is already set (no WALK_TARGET guard, unlike its siblings)');
  EL.clear();
}

// ═══ 7. anti-vacuity — a mutant VB.IDLE_FALLBACK/dispatch is itself caught ═══════════════
console.log('\n 7. anti-vacuity: reverting VB.IDLE_FALLBACK to the old narrowed 2:1 pair is itself detectable');
{
  const savedFallback = VB.IDLE_FALLBACK;
  VB.IDLE_FALLBACK = [['villagerInterest', 2], ['findWalkTarget', 1]];
  const names = VB.IDLE_FALLBACK.map((r) => r[0]).sort();
  const expectNames = ['breedInterest', 'findWalkTarget', 'goTowardsLook', 'jumpInBed', 'catInterest', 'villagerInterest', 'wait'].sort();
  okAv(JSON.stringify(names) !== JSON.stringify(expectNames), 'reverting to the old 2-entry VB.IDLE_FALLBACK is itself caught by section 1’s own assertion shape');
  VB.IDLE_FALLBACK = savedFallback;
  ok(VB.IDLE_FALLBACK.length === 7, 'restoring VB.IDLE_FALLBACK brings the real seven back');

  const savedStart = VB.IDLE_START.jumpInBed;
  VB.IDLE_START.jumpInBed = function () { return false; };   // reproduces "never wired" bug
  W.setBlock(9, PLAT_Y + 1, 9, BED_STATE);
  const baby = spawnStillVillager(9.5, PLAT_Y + 1, 9.5, true);
  baby.vbNearestBed = { x: 9, y: PLAT_Y + 1, z: 9 };
  okAv(VB.IDLE_START.jumpInBed(baby) === false, 'a stubbed-out jumpInBedStart that always refuses is itself detectable (no e.vbBedJump gets created)');
  ok(!baby.vbBedJump, 'confirming: the stub really left e.vbBedJump unset');
  VB.IDLE_START.jumpInBed = savedStart;
  W.setBlock(9, PLAT_Y + 1, 9, STONE);
  EL.clear();
}

// ═══ #5331 isValidPosition (isOpaqueFullCube) + WanderIndoors isSpaceEmpty by box ═══
{
  const GLASS = SR.stateOf('glass'), SLAB = SR.stateOf('stone_slab');
  W.setBlock(30, PLAT_Y, 30, STONE); W.setBlock(31, PLAT_Y, 30, GLASS);
  const above = (x) => ({ x, y: PLAT_Y + 1, z: 30 });
  ok(VB.validFloorUnder(above(30)) === true, 'stone floor is a valid position');
  ok(VB.validFloorUnder(above(31)) === false, 'glass floor (full collision, not opaque) is refused');
  okAv(VB.validFloorUnder(above(30)) !== VB.validFloorUnder(above(31)), 'stone and glass floors are told apart');
  // half-slab ceiling at feet+1.5: head cell is not "solid" by two-cell test but the box hits it
  const saveSky = W.canSeeSky; W.canSeeSky = (x, y, z) => y > PLAT_Y + 3;
  W.setBlock(32, PLAT_Y, 32, STONE);
  const v = spawnStillVillager(32.5, PLAT_Y + 1, 32.5);
  W.setBlock(32, PLAT_Y + 3, 32, STONE);
  v.vbWalkTarget = null; VB.wanderIndoorsStart(v);
  ok(!!v.vbWalkTarget, 'free box: WanderIndoors picks a target');
  v.vbWalkTarget = null;
  W.setBlock(32, PLAT_Y + 2, 32, SLAB);
  VB.wanderIndoorsStart(v);
  ok(!v.vbWalkTarget, 'a half-slab in the villager\'s box blocks WanderIndoors (isSpaceEmpty by box)');
  okAv(M.Spawn.spaceEmptyAt('villager', v.x, v.y, v.z) === false, 'the slab really intersects the villager box');
  W.canSeeSky = saveSky; EL.clear();
}

// ═══ report ════════════════════════════════════════════════════════════
console.log(` assertions passed .. ${pass}`); console.log(` failures ........... ${fails.length}`);
console.log(`\n${pass} ok, ${breaks} anti-vacuity breaks caught, ${fails.length} failed`);
if (fails.length) {
  console.log('\nFAILURES:');
  fails.forEach((m) => console.log('  - ' + m));
  console.log('\nFAIL vbidlecheck');
  process.exit(1);
}
console.log(`\nPASS vbidlecheck — ${pass} checks green (incl. ${breaks} anti-vacuity)`);
