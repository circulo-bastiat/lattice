#!/usr/bin/env node
// vbbreedcheck.mjs — loop/vbbreed, QUEUE row 0.2 "raid loop + villager brain", VB.OWED
// remainder, TWO sub-units:
//   (a) VillagerBreedTask itself (src/07zv5_vbbreed.js's own NS.VBBreed.tick): real food
//       consumption (eatForBreeding into a persistent e.vbFoodLevel), the post-breed
//       Breed.getAge cooldown, the courting look/walk + periodic HEART cadence, the
//       reachable-HOME gate (ANGRY when none), createChild (baby villager, child type roll,
//       child HOME memory), the status-12/13 particle counts (MerchantEntity.produceParticles
//       — FIVE, not AnimalEntity's seven).
//   (b) createPlayTasks' OWN priority-5 RandomTask (src/07zv2_vbplay.js's own
//       VB.PLAY_FALLBACK/VB.playFallbackTick): the real six weighted entries (villager-interest
//       2, cat-interest 1, FindWalkTargetTask 1, GoTowardsLookTarget 1, JumpInBedTask 2,
//       WaitTask(20,40) 2), gated on VISIBLE_VILLAGER_BABIES present.
// Every number here is cited in src/07zv5_vbbreed.js/src/07zv2_vbplay.js, read off `.decomp`
// this session: VillagerBreedTask.java, VillagerEntity.java:98-108/660-741/764-777,
// LookTargetUtil.java, MerchantEntity.java:198-204, EmotionParticle.java,
// VillagerTaskListProvider.java:81-101.
//
//   node tools/vbbreedcheck.mjs [--verbose]
//
// Sections:
//   1. villagerReadyToBreed / eatForBreeding — real inventory consumption into e.vbFoodLevel,
//      and the post-breed Breed.getAge cooldown gate
//   2. Px.spawnMerchantParticles — 5, not 7; 'angry_villager' is +0.5y, 'heart' is not
//   3. VBB.tick courting lifecycle — run() rolls the courting window and sets look/walk on
//      BOTH villagers; a mid-course tick can roll the periodic HEART; completion consumes food
//      and calls goHome
//   4. goHome with a reachable home — createChild (baby, growAge -24000, child type, child HOME
//      memory, 5-heart burst), BOTH parents' own breedCooldownAge
//   5. goHome with NO reachable home — ANGRY to both, no child, no cooldown set
//   6. VB.PLAY_FALLBACK / VB.playFallbackTick — the real six entries, gated on a visible baby
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

console.log('vbbreedcheck — loop/vbbreed: VillagerBreedTask (NS.VBBreed) + createPlayTasks’ own RandomTask (VB.playFallbackTick)');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seqRand(values) {
  let i = 0;
  return () => (i < values.length ? values[i++] : 0.999);
}

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
  '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
  '07i_entitylist.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js',
  '14l_use.js', '07za_explosion.js', '07m_breed.js', '07q_effects.js', '07zu_poi.js', '07o_profession.js',
  '07k_goals.js', '07zv_villagerbrain.js', '07zv2_vbplay.js', '07zv4_vbidle.js', '07zv5_vbbreed.js',
  '07zx_particle.js', '07zt_wtrader.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Entities.attrs = M.DATA.entities.attrs;
M.Effects.ready = true;
M.Breed.init();

const W = M.World, CH = M.CH, R = M.Reg, SR = M.States;
const Poi = M.Poi, Ai = M.Ai, VB = M.VB, VBB = M.VBBreed, EL = M.EntityList, Prof = M.Profession;
const Px = M.Particle, Br = M.Breed;

ok(VB, 'NS.VB did not load');
ok(VBB && typeof VBB.tick === 'function', 'NS.VBBreed did not load (src/07zv5_vbbreed.js)');
ok(VB && typeof VB.playFallbackTick === 'function' && Array.isArray(VB.PLAY_FALLBACK), 'VB.PLAY_FALLBACK/VB.playFallbackTick did not load (src/07zv2_vbplay.js)');
if (!VB || !VBB || typeof VB.playFallbackTick !== 'function') { console.log('\nFAIL vbbreedcheck — module missing'); process.exit(1); }

W.init(1);
M.Behave.init(W);
if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init();
EL.init();
Ai.init();
Prof.init();
Px.init();
ok(Ai.ready, 'Ai module reports ready');

for (let cx = -4; cx <= 4; cx++) for (let cz = -4; cz <= 4; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
const STONE = SR.stateOf('stone');
const PLAT_Y = 63;
function plate(radius, y, cx, cz) {
  for (let x = -radius; x <= radius; x++) for (let z = -radius; z <= radius; z++) W.setBlock(cx + x, y, cz + z, STONE);
}
plate(40, PLAT_Y, 0, 0);

function bedHeadState(name) {
  const bId = R.id[name], P_ = R.PROP, V = R.PVAL;
  for (let s = R.realFirst[bId]; s < R.realFirst[bId + 1]; s++) {
    if (SR.propValue(s, P_.part) === V.head && SR.propValue(s, P_.occupied) === V['false']) return s;
  }
  return null;
}
const BED_STATE = bedHeadState('red_bed');
function reconcile() { for (let i = 0; i < Poi.RESCAN_INTERVAL; i++) Poi.tick(); }

function spawnVillager(x, y, z) {
  const v = EL.spawn('villager', x, y, z);
  v.ai = new Ai.GoalSelector();
  return v;
}
function giveBread(e, count) {
  const inv = VB.ensureVillagerInventory(e);
  const idx = M.Items.of('bread');
  inv[0] = { i: idx, n: count };
}
function breadCount(e) {
  const inv = e.villagerInventory;
  const idx = M.Items.of('bread');
  let n = 0;
  for (const st of inv) if (st && st.i === idx) n += st.n;
  return n;
}

// ═══ 1. villagerReadyToBreed / eatForBreeding ═══════════════════════════════════════════════
console.log('\n 1. villagerReadyToBreed real food consumption + post-breed Breed.getAge cooldown');
{
  const a = spawnVillager(0, PLAT_Y + 1, 0);
  giveBread(a, 3);   // 3*4 = 12 == VB.BREED_FOOD_MIN
  ok(VB.villagerReadyToBreed(a), 'setup: 3 bread (12 food value) is ready');
  ok((a.vbFoodLevel | 0) === 0, 'setup: e.vbFoodLevel starts at 0, same default as a fresh villager’s foodLevel');

  // eatForBreeding is private to 07zv5_vbbreed.js -- exercised indirectly through VBB.tick's
  // own courting-completion branch, section 3/4 below. Here, section 1 checks the DIRECT
  // consequence any such call must leave: consumeAvailableFood (real item removal) +
  // depleteFood(12) (java:676-692/705-708).
  const b = spawnVillager(1, PLAT_Y + 1, 0);
  giveBread(b, 3);
  a.vbBreedTarget = b; b.vbBreedTarget = a;
  VB.rand = () => 0;                       // courtEnd = tnow + 275 + 0
  VBB.tick(a, 0, 1);                       // run() -- starts courting, consumes nothing yet
  ok(breadCount(a) === 3, 'setup: no food consumed yet at courting START (eatForBreeding only fires at completion)');
  VBB.tick(a, 0, 1 + 275);                 // completion tick
  ok(breadCount(a) === 0, `eatForBreeding really removed a’s 3 bread (consumeAvailableFood), got ${breadCount(a)} left`);
  ok(breadCount(b) === 0, `eatForBreeding really removed b’s 3 bread too (BOTH parents eat, java:51-52), got ${breadCount(b)} left`);
  ok((a.vbFoodLevel | 0) === 0, `depleteFood(12): foodLevel went 0(default)+12(consumed)-12(depleted) = 0, got ${a.vbFoodLevel}`);
  okAv(!VB.villagerReadyToBreed(a), 'a is no longer readyToBreed right after eating its own food down to 0 again');

  // the post-breed cooldown gate this section's own header names: growAge===0 required.
  const c = spawnVillager(10, PLAT_Y + 1, 0);
  giveBread(c, 3);
  ok(VB.villagerReadyToBreed(c), 'setup: c is ready before any cooldown is applied');
  Br.setAge(c, Br.C.breedCooldownAge);
  okAv(!VB.villagerReadyToBreed(c), 'a villager on the real 6000-tick breedCooldownAge is NOT readyToBreed even with full food');
  for (let i = 0; i < Br.C.breedCooldownAge; i++) Br.tickAge(c);
  ok(Br.getAge(c) === 0, 'setup: Breed.tickAge alone (the SAME per-entity clock every entity already gets) walked growAge back to 0');
  ok(VB.villagerReadyToBreed(c), 'c is readyToBreed again once growAge naturally returns to 0, no extra wiring needed');
  EL.clear();
}

// ═══ 2. Px.spawnMerchantParticles — 5, not 7; angry_villager is +0.5y ═══════════════════════
console.log('\n 2. Px.spawnMerchantParticles: FIVE particles (MerchantEntity.produceParticles, not AnimalEntity’s seven); angry_villager is y+0.5, heart is not');
{
  Px.init();
  const n = Px.spawnMerchantParticles('heart', 5, 64, -2, () => 0.5);
  ok(n === 5, `spawnMerchantParticles('heart', ...) returns 5 (MerchantEntity.java:199 \`for (i=0;i<5;i++)\`), got ${n}`);
  ok(Px.list.length === 5 && Px.list.every((p) => p.type === 'heart' && p.y === 64), 'every heart particle sits at y (no offset, HeartFactory.method_3035)');

  Px.init();
  Px.spawnMerchantParticles('angry_villager', 5, 64, -2, () => 0.5);
  ok(Px.list.length === 5 && Px.list.every((p) => p.type === 'angry_villager' && p.y === 64.5),
    'every angry_villager particle sits at y+0.5 (AngryVillagerFactory.method_3034, EmotionParticle.java:39)');

  // anti-vacuity: a zeroed burst count would be caught by the 5-count assertion
  const savedCount = Px.MERCHANT_BURST_COUNT;
  Px.MERCHANT_BURST_COUNT = 0;
  Px.init();
  Px.spawnMerchantParticles('heart', 0, 64, 0, () => 0.5);
  okAv(Px.list.length !== 5, 'a zeroed MERCHANT_BURST_COUNT breaks the 5-particle result');
  Px.MERCHANT_BURST_COUNT = savedCount;
}

// ═══ 3. VBB.tick courting lifecycle — run() + a mid-course HEART roll ═══════════════════════
console.log('\n 3. VBB.tick: run() rolls the courting window and sets look/walk on BOTH villagers; a mid-course tick can roll the periodic HEART (java:54-57)');
{
  const a = spawnVillager(0, PLAT_Y + 1, 0);
  const b = spawnVillager(1, PLAT_Y + 1, 0);   // distSq == 1, inside KEEP_RUNNING_DIST_SQ (5.0)
  giveBread(a, 3); giveBread(b, 3);
  a.vbBreedTarget = b; b.vbBreedTarget = a;

  VB.rand = seqRand([0.5]);   // courtEnd roll only: floor(0.5*50) = 25
  VBB.tick(a, 0, 1);
  ok(!!a.vbBreed && a.vbBreed.end === 1 + 275 + 25, `run() rolled a real courtEnd (275 + floor(0.5*50) = 300), got ${a.vbBreed && a.vbBreed.end}`);
  ok(!b.vbBreed, 'b’s OWN VBB.tick has not run yet -- each villager runs its own independent Task instance (file header)');
  ok(a.vbLookTarget && a.vbLookTarget.x === b.x, 'a looks at b (lookAtEachOther, both directions)');
  ok(b.vbLookTarget && b.vbLookTarget.x === a.x, 'b ALSO looks at a, from a’s own run() call (LookTargetUtil sets memory on BOTH sides)');
  ok(a.vbWalkTarget && a.vbWalkTarget.x === Math.floor(b.x) && a.vbWalkTarget.range === 2, 'a walks toward b, completionRange 2 (LookTargetUtil.java:65)');
  ok(b.vbWalkTarget && b.vbWalkTarget.x === Math.floor(a.x) && b.vbWalkTarget.range === 2, 'b ALSO gets a walk target toward a');

  Px.init();
  VB.rand = seqRand([0]);   // nextInt(35) == 0 -- forces the periodic heart (java:54)
  VBB.tick(a, 0, 150);      // mid-course, still well before end (300)
  ok(!!a.vbBreed, 'still courting mid-course (150 < 300)');
  const hearts = Px.list.filter((p) => p.type === 'heart');
  ok(hearts.length === 10, `nextInt(35)==0 fires status 12 (HEART) to BOTH a and b, 5 particles each = 10 total, got ${hearts.length}`);

  Px.init();
  VB.rand = seqRand([34 / 35 + 0.0001]);   // nextInt(35) != 0 this time
  VBB.tick(a, 0, 151);
  okAv(Px.list.filter((p) => p.type === 'heart').length === 0, 'a roll that does NOT hit nextInt(35)==0 spawns no heart that tick');

  // too-far-apart gate: java:48's own `> 5.0` wraps the ENTIRE per-tick body, not just the heart.
  const savedTarget = { x: b.vbWalkTarget.x };
  b.x = 100;   // now far outside KEEP_RUNNING_DIST_SQ
  a.vbWalkTarget = null;
  VB.rand = seqRand([0]);   // would force a heart if the gate were skipped
  Px.init();
  VBB.tick(a, 0, 152);
  okAv(!a.vbWalkTarget, 'too far apart: NOT EVEN the look/walk re-aim happens this tick (java:48 wraps the whole body)');
  okAv(Px.list.length === 0, 'too far apart: no heart roll happens either, even with a forced nextInt(35)==0');
  b.x = savedTarget.x + 1;   // restore a workable position isn't needed further; entities are cleared next
  EL.clear();
}

// ═══ 4. goHome with a reachable home — createChild, both parents' cooldown ══════════════════
console.log('\n 4. goHome with a reachable home: a baby villager is created, gets a real HOME memory, and BOTH parents get the real 6000-tick cooldown');
{
  W.setBlock(4, PLAT_Y + 1, 4, BED_STATE);
  reconcile();
  ok(Poi.getType({ x: 4, y: PLAT_Y + 1, z: 4 }) === Poi.HOME, 'setup: the bed really registered as a HOME poi');

  const a = spawnVillager(0, PLAT_Y + 1, 0);
  const b = spawnVillager(1, PLAT_Y + 1, 0);
  giveBread(a, 3); giveBread(b, 3);
  a.vbBreedTarget = b; b.vbBreedTarget = a;
  const beforeCount = EL.list.length;

  VB.rand = seqRand([0, 0.999, 0.1]);   // [courtEnd roll, no-heart on any mid tick we skip, child-type roll < 0.5 -> biome]
  VBB.tick(a, 0, 1);                    // run()
  VBB.tick(a, 0, 1 + 275);              // completion (rand[0]=0 -> courtEnd = 1+275+0 = 276, so tnow=276 is exactly it)

  ok(EL.list.length === beforeCount + 1, `createChild really appended ONE new villager entity, got ${EL.list.length - beforeCount}`);
  const child = EL.list[EL.list.length - 1];
  ok(child.type === 'villager', 'the new entity is a villager');
  ok(child.isBaby === true, 'child.isBaby is true (loop/vbgather closed the second `.baby` flag -- single source of truth, Breed.setBaby)');
  ok(Br.isBaby(child) && Br.getAge(child) === -24000, `child.growAge is the real -24000 (VillagerEntity.java:106, via Breed.setBaby), got ${Br.getAge(child)}`);
  ok(typeof child.villagerType === 'string' && child.villagerType.length > 0, 'child.villagerType was rolled to a real type string');
  ok(!!child.vbHome && child.vbHome.x === 4 && child.vbHome.z === 4, `setChildHome remembered the real bed position, got ${JSON.stringify(child.vbHome)}`);
  ok(Math.abs(child.x - a.x) < 1e-9, 'the child spawns at the SELF (task-owner) parent’s own position (java:107)');

  ok(Br.getAge(a) === Br.C.breedCooldownAge, `parent a’s own breedingAge is set to the real 6000 (setBreedingAge(6000), java:104), got ${Br.getAge(a)}`);
  ok(Br.getAge(b) === Br.C.breedCooldownAge, `parent b ALSO gets the 6000-tick cooldown (java:105 -- BOTH parents), got ${Br.getAge(b)}`);
  ok(!a.vbBreedTarget && !a.vbBreed, 'a’s own BREED_TARGET/courting state is forgotten once the task completes');

  const heartsAtChild = Px.list.filter((p) => p.type === 'heart' && Math.abs(p.x - child.x) < 1);
  ok(heartsAtChild.length >= 5, `the child gets its own 5-particle HEART burst on spawn (createChild's own status 12, java:109), got ${heartsAtChild.length}`);
  EL.clear();
}

// ═══ 5. goHome with NO reachable home — ANGRY to both, no child, no cooldown ════════════════
console.log('\n 5. goHome with NO reachable home (nothing within 48 blocks): ANGRY (status 13) to BOTH, no child, no breedingAge cooldown either');
{
  // far away from the one bed section 4 placed -- outside VBB.HOME_SEARCH_RADIUS (48).
  const a = spawnVillager(500, PLAT_Y + 1, 500);
  const b = spawnVillager(501, PLAT_Y + 1, 500);
  plate(3, PLAT_Y, 500, 500);
  a.y = PLAT_Y + 1; b.y = PLAT_Y + 1;
  giveBread(a, 3); giveBread(b, 3);
  a.vbBreedTarget = b; b.vbBreedTarget = a;
  const beforeCount = EL.list.length;

  Px.init();
  VB.rand = seqRand([0]);
  VBB.tick(a, 0, 1);
  VBB.tick(a, 0, 1 + 275);

  ok(EL.list.length === beforeCount, 'no reachable home: no child entity was created at all');
  const angry = Px.list.filter((p) => p.type === 'angry_villager');
  ok(angry.length === 10, `no reachable home: status 13 (ANGRY) fires to BOTH parents, 5 particles each = 10 total, got ${angry.length}`);
  okAv(Br.getAge(a) === 0 && Br.getAge(b) === 0, 'the 6000-tick cooldown is NOT applied when no home was found (only createChild’s own success path sets it, java:104-105) -- food was still spent though (section 1’s own point)');
  ok(breadCount(a) === 0, 'eatForBreeding still ran (food is spent regardless of whether a home was found, java:50-52)');
  EL.clear();
}

// ═══ 6. VB.PLAY_FALLBACK / VB.playFallbackTick — the real six entries ═══════════════════════
console.log('\n 6. VB.PLAY_FALLBACK carries createPlayTasks’ own six weighted entries (2:1:1:1:2:2), gated on a visible baby');
{
  const names = VB.PLAY_FALLBACK.map((r) => r[0]).sort();
  const expectNames = ['villagerInterest', 'catInterest', 'findWalkTarget', 'goTowardsLook', 'jumpInBed', 'wait'].sort();
  ok(JSON.stringify(names) === JSON.stringify(expectNames), `all six createPlayTasks names present, got [${names.join(',')}]`);
  const weights = {}; VB.PLAY_FALLBACK.forEach((r) => { weights[r[0]] = r[1]; });
  ok(weights.villagerInterest === 2 && weights.catInterest === 1 && weights.findWalkTarget === 1
    && weights.goTowardsLook === 1 && weights.jumpInBed === 2 && weights.wait === 2,
    `weights match VillagerTaskListProvider.java:90-96 exactly (2,1,1,1,2,2), got ${JSON.stringify(weights)}`);

  const adult = spawnVillager(0, PLAT_Y + 1, 0);   // the acting villager for the dispatch below

  okAv(VB.playFallbackTick(adult) === null && !adult.vbWalkTarget, 'with NO visible villager baby anywhere, the whole RandomTask refuses (VISIBLE_VILLAGER_BABIES absent, java:88)');

  const baby = spawnVillager(0, PLAT_Y + 1, 0); Br.setBaby(baby, true);   // loop/vbgather: e.isBaby is the only flag now

  // put a real baby in range so VISIBLE_VILLAGER_BABIES is present, then isolate ONE entry at
  // a time by shrinking VB.PLAY_FALLBACK to just that entry (the same technique
  // vbidlecheck.mjs's own section 7 already uses).
  const savedFallback = VB.PLAY_FALLBACK;

  const cat = EL.spawn('cat', 3, PLAT_Y + 1, 0);
  VB.PLAY_FALLBACK = [['catInterest', 1]];
  const picked = VB.playFallbackTick(adult);
  ok(picked === 'catInterest', `cat-interest fires with a real cat in range and a visible baby present, got ${picked}`);
  ok(!!adult.vbWalkTarget && adult.vbWalkTarget.x === Math.floor(cat.x), 'the walk target lands on the real cat');
  adult.vbWalkTarget = null;

  VB.PLAY_FALLBACK = [['wait', 1]];
  VB.rand = () => 0;   // PLAY_WAIT_MIN_TICKS + floor(0 * (40+1-20)) = 20
  const picked2 = VB.playFallbackTick(adult);
  ok(picked2 === 'wait', 'wait fires (WaitTask has no memory requirements, same as createIdleTasks’ own copy)');
  ok(!!adult.vbIdleWait && adult.vbIdleWait.ticksLeft === 20, `PLAY’s own WaitTask(20,40) window, NOT idle’s (30,60) -- got ticksLeft=${adult.vbIdleWait && adult.vbIdleWait.ticksLeft}`);
  adult.vbIdleWait = null;

  VB.PLAY_FALLBACK = savedFallback;
  okAv(VB.PLAY_FALLBACK.length === 6, 'restoring VB.PLAY_FALLBACK brings the real six back');
  const revertNames = savedFallback.map((r) => r[0]).sort();
  okAv(JSON.stringify(revertNames) === JSON.stringify(expectNames), 'section 6’s own name assertion shape catches a reversion to a narrower table too');
  EL.clear();
}

// ═══ 7. anti-vacuity — a mutant VBB.tick / getReachableHome is itself caught ════════════════
console.log('\n 7. anti-vacuity: a stubbed-out VBB.tick, and a KEEP_RUNNING_DIST_SQ of 0, are themselves detectable');
{
  const a = spawnVillager(0, PLAT_Y + 1, 0);
  const b = spawnVillager(1, PLAT_Y + 1, 0);
  giveBread(a, 3); giveBread(b, 3);
  a.vbBreedTarget = b; b.vbBreedTarget = a;
  const savedTick = VBB.tick;
  VBB.tick = function () {};   // reproduces "never wired" bug
  VB.rand = () => 0;
  VBB.tick(a, 0, 1);
  okAv(!a.vbBreed, 'a stubbed-out VBB.tick that does nothing is itself detectable (no courting state gets created)');
  VBB.tick = savedTick;

  const savedDist = VBB.KEEP_RUNNING_DIST_SQ;
  VBB.KEEP_RUNNING_DIST_SQ = 0;   // even 1 block apart now fails the gate
  VBB.tick(a, 0, 1);              // run() itself has no distance gate -- starts courting normally
  a.vbWalkTarget = null;
  VBB.tick(a, 0, 2);              // the NEXT tick's gate is what section 3 exercises
  okAv(!a.vbWalkTarget, 'a zeroed KEEP_RUNNING_DIST_SQ blocks the mid-course re-aim even at 1 block apart, matching section 3’s own real-gate assertion');
  VBB.KEEP_RUNNING_DIST_SQ = savedDist;
  EL.clear();
}

// ═══ report ════════════════════════════════════════════════════════════
console.log(` assertions passed .. ${pass}`); console.log(` failures ........... ${fails.length}`);
console.log(`\n${pass} ok, ${breaks} anti-vacuity breaks caught, ${fails.length} failed`);
if (fails.length) {
  console.log('\nFAILURES:');
  fails.forEach((m) => console.log('  - ' + m));
  console.log('\nFAIL vbbreedcheck');
  process.exit(1);
}
console.log(`\nPASS vbbreedcheck — ${pass} checks green (incl. ${breaks} anti-vacuity)`);
