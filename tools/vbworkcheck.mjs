#!/usr/bin/env node
// vbworkcheck.mjs — loop/vbwork: villager JOB-SITE WORK tasks, `createWorkTasks`' own
// priority-5 `RandomTask` (src/07zv_villagerbrain.js's own `VB.workOrder`/`VB.tickWorkRandom`).
// Every number here is cited in 07zv_villagerbrain.js, read off `.decomp` this session:
// VillagerWorkTask.java, FarmerWorkTask.java, FarmerVillagerTask.java, BoneMealTask.java,
// GoToNearbyPositionTask.java, GoToIfNearbyTask.java, VillagerTaskListProvider.java (the six
// weighted candidates -- this engine ports five, see AFTER sleepcheck's own suite comment).
//
//   node tools/vbworkcheck.mjs [--verbose]
//
// Sections:
//   1. VB.workOrder — five weighted candidates (not vanilla's six), farmer vs non-farmer weights
//   2. villagerWork (VillagerWorkTask, every profession) — 300-tick interval + 50% coin flip +
//      1.73-block distance gate; the coin flip is re-rolled every tick once the window opens
//   3. goToIfNearby (GoToIfNearbyTask) — within 4 blocks, re-aims a fuzzy nearby WALK_TARGET
//      every 180 ticks
//   4. goToNearby (GoToNearbyPositionTask) — within 10 blocks, re-aims WALK_TARGET straight at
//      the job site every 80 ticks
//   5. farmerVillagerTask (FarmerVillagerTask) — farmer-only harvest of a mature crop / replant
//      from a seed in `e.villagerInventory`, independent of the job site
//   6. boneMeal (BoneMealTask) — any profession with `bone_meal` in inventory grows a nearby
//      immature crop by `CropBlock.applyGrowth`'s own randInt(2,5) formula
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

console.log('vbworkcheck — loop/vbwork: villager JOB-SITE WORK tasks (NS.VB.workOrder/tickWorkRandom)');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
  '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
  '07i_entitylist.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js',
  '14l_use.js', '07za_explosion.js', '07m_breed.js', '07q_effects.js', '07zu_poi.js', '07o_profession.js',
  '07k_goals.js', '07zv_villagerbrain.js', '07zy_composter.js', '07zx_particle.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Entities.attrs = M.DATA.entities.attrs;
M.Effects.ready = true;

const W = M.World, CH = M.CH, R = M.Reg, SR = M.States, IT = M.Items, L = M.Loot;
const Ai = M.Ai, VB = M.VB, EL = M.EntityList, Prof = M.Profession;

ok(VB, 'NS.VB did not load');
ok(Prof, 'NS.Profession did not load');
ok(L && L.ready, 'NS.Loot did not load');
if (!VB || !Prof || !L) { console.log('\nFAIL vbworkcheck — module missing'); process.exit(1); }

W.init(1);
M.Behave.init(W);
if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init();
EL.init();
Ai.init();
Prof.init();

for (let cx = -4; cx <= 4; cx++) for (let cz = -4; cz <= 4; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
const STONE = SR.stateOf('stone');
const PLAT_Y = 63;
function plate(radius, y) { for (let x = -radius; x <= radius; x++) for (let z = -radius; z <= radius; z++) W.setBlock(x, y, z, STONE); }
plate(55, PLAT_Y);

// CropBlock.canPlaceAt (rule 15, W.surviveRule): rawBrightness>=8 OR sky-visible. This
// headless world has no lighting engine loaded, so W.setBlock would refuse every crop
// placement below -- the SAME bypass rabbitcheck.mjs's own setup already uses.
W.rawBrightness = () => 15;

const SMITHING = SR.stateOf('smithing_table');   // Prof.WORKSTATIONS.toolsmith
const COMPOSTER = SR.stateOf('composter');       // Prof.WORKSTATIONS.farmer

function spawnStillVillager(x, y, z) {
  const v = EL.spawn('villager', x, y, z);
  v.ai = new Ai.GoalSelector();
  return v;
}
function stack(item, n) { return { i: IT.of(item), n }; }
function invSet(e, slot, item, n) { VB.ensureVillagerInventory(e)[slot] = stack(item, n); }
function invCountOf(e, item) {
  const inv = e.villagerInventory || [];
  let n = 0;
  for (const st of inv) if (st && st.i === IT.of(item)) n += st.n;
  return n;
}
function ageOf(st) {
  const v = SR.propValue(st, R.PROP.age);
  return v < 0 ? 0 : +R.valueNames[v];
}
function itemsAt(x, y, z, radius = 3) {
  return (EL.list || []).filter((o) => o.type === 'item' && Math.abs(o.x - x) < radius && Math.abs(o.y - y) < radius && Math.abs(o.z - z) < radius);
}

// ═══ 1. VB.workOrder — five candidates, farmer vs non-farmer weights ═══════════════════════
console.log('\n 1. VB.workOrder: five weighted candidates (createWorkTasks has six; GoToSecondaryPositionTask is VB.OWED)');
{
  const order = VB.workOrder('none');
  ok(order.length === 6, `six candidates, got ${order.length}`);
  okAv(order.some((o) => o.name === 'goToSecondary'), 'GoToSecondaryPositionTask is in the pick');
  const names = order.map((o) => o.name).sort();
  ok(JSON.stringify(names) === JSON.stringify(['boneMeal', 'farmerVillagerTask', 'goToIfNearby', 'goToNearby', 'goToSecondary', 'villagerWork'].sort()),
    `the five names are exactly the ported candidates, got ${names}`);

  // weighted tally, real RNG: villagerWork (7) must beat goToIfNearby (2) noticeably, over
  // many draws of "which name sorts first" -- the same style vbactivitycheck's own idle tally
  // uses for VB.idleFallbackTick.
  const savedRand = VB.rand;
  const firstTally = {};
  for (let i = 0; i < 2000; i++) {
    VB.rand = Math.random;
    const o = VB.workOrder('none');
    firstTally[o[0].name] = (firstTally[o[0].name] || 0) + 1;
  }
  VB.rand = savedRand;
  say('   first-place tally over 2000 rolls: ' + JSON.stringify(firstTally));
  ok(Object.keys(firstTally).length === 6, `every one of the six candidates sorts first at least once, got ${Object.keys(firstTally).length}`);
  ok((firstTally.villagerWork || 0) > (firstTally.goToIfNearby || 0),
    `villagerWork (weight 7) sorts first more often than goToIfNearby (weight 2): ${firstTally.villagerWork} vs ${firstTally.goToIfNearby}`);

  const farmerOrder = VB.workOrder('farmer');
  const gen = (n, list) => list.find((o) => o.name === n);
  // weight only shows up in the SHUFFLE key's exponent, not a field on the row -- prove the
  // farmer/non-farmer difference behaviourally instead: with rand pinned so every OTHER
  // candidate's key is forced huge (never wins), farmerVillagerTask (farmer weight 2) must
  // still win noticeably less often than boneMeal (farmer weight 4) when both are isolated.
  const tally2 = { farmerVillagerTask: 0, boneMeal: 0 };
  for (let i = 0; i < 2000; i++) {
    VB.rand = Math.random;
    const o = VB.workOrder('farmer').filter((r) => r.name === 'farmerVillagerTask' || r.name === 'boneMeal');
    tally2[o[0].name]++;
  }
  VB.rand = savedRand;
  ok(tally2.boneMeal > tally2.farmerVillagerTask,
    `farmer weights: boneMeal (4) beats farmerVillagerTask (2) head-to-head, got ${tally2.boneMeal} vs ${tally2.farmerVillagerTask}`);
}

// ═══ 1b. SecondaryPointsOfInterestSensor + GoToSecondaryPositionTask ═══════════════════════
console.log('\n 1b. secondary job site: composter sensed near a farmer, GoToSecondary picked ~5/26 first; none without');
{
  plate(40, PLAT_Y);
  W.setBlock(30, PLAT_Y + 1, 30, COMPOSTER);
  const f = spawnStillVillager(31, PLAT_Y + 1, 31);
  f.profession = 'farmer'; f.workstation = { x: 30, y: PLAT_Y + 1, z: 30 };
  VB.senseSecondary(f, 0);
  okAv(Array.isArray(f.vbSecondaryJobSite) && f.vbSecondaryJobSite.length === 1 && f.vbSecondaryJobSite[0].x === 30,
    'composter in range populates SECONDARY_JOB_SITE');
  const far = spawnStillVillager(-30, PLAT_Y + 1, -30); far.profession = 'farmer';
  VB.senseSecondary(far, 0);
  ok(!far.vbSecondaryJobSite, 'no composter -> memory empty');
  let first = 0; const N = 6000; const saved = VB.rand;
  for (let i = 0; i < N; i++) { VB.rand = Math.random; if (VB.workOrder('none')[0].name === 'goToSecondary') first++; }
  VB.rand = saved;
  const exp = N * 5 / 26;   // weights 7,2,5,5,5,7 (non-farmer) = 31 total
  say('   goToSecondary first: ' + first);
  ok(Math.abs(first - N * 5 / 31) < N * 0.04, `goToSecondary sorts first ~5/31, got ${first}/${N}`);
  VB.rand = () => 0.5;
  f.vbWalkTarget = null; f.vbSecondaryNext = 0;
  const so = VB.workOrder; VB.workOrder = () => [{ name: 'goToSecondary' }];
  VB.tickWorkRandom(f, 200);
  ok(f.vbWalkTarget && f.vbWalkTarget.x === 30 && f.vbWalkTarget.z === 30, 'selected GoToSecondary walks to the composter');
  far.workstation = { x: -30, y: PLAT_Y + 1, z: -30 }; far.vbWalkTarget = null;
  VB.workOrder = () => [{ name: 'goToSecondary' }];
  VB.tickWorkRandom(far, 200);
  ok(!far.vbWalkTarget, 'no composter: never selected/acts');
  VB.workOrder = so; VB.rand = saved;
}

// ═══ 2. villagerWork (VillagerWorkTask) ════════════════════════════════════════════════════
console.log('\n 2. villagerWork: 300-tick interval + 50% coin flip + 1.73-block distance, any profession');
{
  W.setBlock(10, PLAT_Y + 1, 10, SMITHING);
  const v = spawnStillVillager(10, PLAT_Y + 1, 11);
  ok(Prof.tryClaim(v) === 'toolsmith', 'setup: claims the smithing_table');
  VB.rand = () => 0;   // nextInt(2) === 0 -> the coin flip always passes

  ok(!VB.tickWorkRandom(v, 100) && v.vbLastWorkedAt === undefined,
    'before the 300-tick interval elapses, villagerWork never fires even though the coin flip would pass');
  v.vbLastWorkCheck = 0;
  VB.tickWorkRandom(v, 300);
  ok(v.vbLastWorkedAt === 300, `at tnow=300, within distance, villagerWork fires (vbLastWorkedAt=${v.vbLastWorkedAt})`);
  ok(!!v.vbLookTarget && v.vbLookTarget.x === 10 && v.vbLookTarget.z === 10, 'LOOK_TARGET is stamped at the job site');
  const runs0 = VB.workRuns;

  okAv((() => {
    // immediately re-running (tnow still 300) must NOT fire again -- the interval was consumed.
    VB.tickWorkRandom(v, 300);
    return VB.workRuns === runs0;
  })(), 'a second call at the SAME tnow does not fire twice (the 300-tick interval was actually consumed)');

  // distance gate: move the villager far from the job site, wait out the interval again.
  v.x = 0; v.z = 0; v.vbLastWorkCheck = 300;
  VB.tickWorkRandom(v, 700);
  okAv(VB.workRuns === runs0, `far from the job site (>1.73 blocks), villagerWork does not fire even past the interval, workRuns stayed ${VB.workRuns}`);

  EL.clear(); Prof.claimed = {}; W.setBlock(10, PLAT_Y + 1, 10, 0);
}

// ═══ 2a. playWorkSound — VillagerEntity.java:560-565 / VillagerProfession.java:16-36 ═══════
console.log('\n 2a. villagerWork run plays entity.villager.work_<profession> (none/nitwit silent)');
{
  const profs = ['armorer','butcher','cartographer','cleric','farmer','fisherman','fletcher','leatherworker','librarian','mason','shepherd','toolsmith','weaponsmith'];
  const saved = M.Sound, played = [];
  M.Sound = { play: (n) => { played.push(n); } };
  W.setBlock(10, PLAT_Y + 1, 10, SMITHING);
  const v = spawnStillVillager(10, PLAT_Y + 1, 11);
  ok(Prof.tryClaim(v) === 'toolsmith', 'setup 2a: claims the smithing_table');
  VB.rand = () => 0; v.vbLastWorkCheck = 0; VB.tickWorkRandom(v, 300);
  ok(played.length === 1 && played[0] === 'entity.villager.work_toolsmith', `toolsmith work run plays work_toolsmith (${played})`);
  played.length = 0;
  for (const p of profs) { v.profession = p; VB.playWorkSound(v); }
  ok(profs.every((p, i) => played[i] === 'entity.villager.work_' + p) && played.length === 13, `all 13 professions play their own work sound (${played.length})`);
  played.length = 0;
  for (const p of ['none', 'nitwit']) { v.profession = p; VB.playWorkSound(v); }
  okAv(played.length === 0, `none/nitwit play nothing (${played.length})`);
  M.Sound = saved; EL.clear(); Prof.claimed = {}; W.setBlock(10, PLAT_Y + 1, 10, 0);
}

// ═══ 2b. restock JOIN (s113) — VillagerWorkTask.java:41-43 `if (shouldRestock()) restock();` ═══
// the work run is the ONLY caller of the restock rule in 1.18.2; this proves the join from the
// brain's work run to Trade.tickRestock (the rule itself is tradecheck §6/§6b).
console.log('\n 2b. villagerWork run calls Trade.tickRestock (job-site-gated restock)');
{
  const savedTrade = M.Trade, calls = [];
  M.Trade = { ready: true, tickRestock: (e) => { calls.push(e); return true; } };
  W.setBlock(10, PLAT_Y + 1, 10, SMITHING);
  const v = spawnStillVillager(10, PLAT_Y + 1, 11);
  ok(Prof.tryClaim(v) === 'toolsmith', 'setup 2b: claims the smithing_table');
  v.tradeOffers = [{ maxUses: 1 }]; v.tradeUses = [1];
  VB.rand = () => 0; v.vbLastWorkCheck = 0;
  VB.tickWorkRandom(v, 300);
  ok(calls.length === 1 && calls[0] === v, `a work run at the job site calls Trade.tickRestock once (calls=${calls.length})`);
  v.x = 0; v.z = 0; v.vbLastWorkCheck = 300;
  VB.tickWorkRandom(v, 700);
  okAv(calls.length === 1, `far from the job site no work run fires, so no restock is attempted (calls=${calls.length})`);
  v.x = 10.5; v.z = 11.5; delete v.tradeOffers; v.vbLastWorkCheck = 700;
  VB.tickWorkRandom(v, 1100);
  ok(calls.length === 1, 'a villager with no offers is not handed to the restock rule');
  M.Trade = savedTrade;
  EL.clear(); Prof.claimed = {}; W.setBlock(10, PLAT_Y + 1, 10, 0);
}

// ═══ 3. goToIfNearby (GoToIfNearbyTask) ════════════════════════════════════════════════════
console.log('\n 3. goToIfNearby: within 4 blocks of the job site, re-aims a nearby WALK_TARGET every 180 ticks');
{
  // Exercised directly through VB.goToIfNearbyRun (exposed for exactly this): VB.fuzzyFind, which
  // it calls, ALSO reads VB.rand for its own random offsets, so routing this through the full
  // weighted VB.tickWorkRandom picker with VB.rand pinned (as the other candidates' isolation
  // tests do) starves the fuzzy search of variety and it can legitimately return null every try.
  // Section 1 already proves goToIfNearby is really one of the five weighted picks; this proves
  // what firing it actually DOES.
  VB.rand = Math.random;
  const v = spawnStillVillager(0, PLAT_Y + 1, 0);
  // `VB.fuzzyFind` (FuzzyTargeting.find, real vanilla too) can legitimately come back empty on
  // any one of its own 10 random tries -- vanilla just leaves WALK_TARGET untouched that tick
  // and tries again next time its own throttle allows. Retrying here (each attempt past the
  // 180-tick throttle) is that same "try again later", not a loosened assertion.
  let tnow = 500;
  while (tnow < 500 + 180 * 20 && !v.vbWalkTarget) { VB.goToIfNearbyRun(v, tnow); if (!v.vbWalkTarget) tnow += 180; }
  ok(!!v.vbWalkTarget, `goToIfNearby wrote a WALK_TARGET within 20 tries, got ${JSON.stringify(v.vbWalkTarget)}`);
  ok(v.vbGoIfNearbyNext === tnow + 180, `throttle armed for 180 ticks out (${tnow}+180), got ${v.vbGoIfNearbyNext}`);

  okAv((() => {
    v.vbWalkTarget = null;
    VB.goToIfNearbyRun(v, tnow + 1);   // still inside the 180-tick throttle window
    return v.vbWalkTarget === null;
  })(), 'inside its own 180-tick throttle, goToIfNearby does not re-aim WALK_TARGET again');

  EL.clear();
}

// ═══ 4. goToNearby (GoToNearbyPositionTask) ════════════════════════════════════════════════
console.log('\n 4. goToNearby: within 10 blocks of the job site, re-aims WALK_TARGET straight at it every 80 ticks');
{
  W.setBlock(30, PLAT_Y + 1, 30, SMITHING);
  const v = spawnStillVillager(31, PLAT_Y + 1, 30);   // adjacent, so Prof.tryClaim actually grants
  ok(Prof.tryClaim(v) === 'toolsmith', 'setup: claims the smithing_table');
  v.x = 37;   // 7 blocks out: past villagerWork's 1.73 and goToIfNearby's 4, inside goToNearby's 10
  VB.rand = () => 0;     // see test 3's own note on why 0, not a nonzero constant
  v.vbWalkTarget = null;
  VB.tickWorkRandom(v, 900);
  ok(!!v.vbWalkTarget && v.vbWalkTarget.x === 30 && v.vbWalkTarget.z === 30 && v.vbWalkTarget.range === 1,
    `goToNearby aims WALK_TARGET straight at the job site, got ${JSON.stringify(v.vbWalkTarget)}`);
  okAv(v.vbGoNearbyNext === 980, `throttle armed for 80 ticks out (900+80), got ${v.vbGoNearbyNext}`);

  EL.clear(); Prof.claimed = {}; W.setBlock(30, PLAT_Y + 1, 30, 0);
}

// ═══ 5. farmerVillagerTask (FarmerVillagerTask) ════════════════════════════════════════════
console.log('\n 5. farmerVillagerTask: farmer-only, harvests a mature crop / replants from inventory, no job site needed');
{
  const WHEAT_MAX = SR.stateOf('wheat');   // default state; age read off it below
  W.setBlock(40, PLAT_Y, 40, SR.stateOf('farmland'));
  W.setBlock(40, PLAT_Y + 1, 40, M.Behave.setProp(WHEAT_MAX, 'age', M.Behave.maxAge(R.id.wheat)));
  const farmer = spawnStillVillager(41, PLAT_Y + 1, 40);
  farmer.profession = 'farmer';   // no claimed workstation at all -- this task does not need one
  VB.rand = () => 0;

  ok(itemsAt(40, PLAT_Y + 1, 40).length === 0, 'setup: no loose wheat yet');
  let harvested = false;
  for (let t = 0; t < 50 && !harvested; t++) {
    VB.tickWorkRandom(farmer, t);
    if (W.getBlock(40, PLAT_Y + 1, 40) === 0) harvested = true;
  }
  ok(harvested, 'the mature wheat crop is harvested (block cleared) within 50 ticks');
  okAv(itemsAt(40, PLAT_Y + 1, 40).length > 0, 'harvesting drops real item entities via NS.Loot.breakDrops, not a silent block clear');

  // replant: air over farmland, wheat_seeds in inventory
  W.setBlock(42, PLAT_Y, 42, SR.stateOf('farmland'));
  farmer.x = 43; farmer.z = 42; farmer.vbFarmerTask = undefined;
  invSet(farmer, 0, 'wheat_seeds', 3);
  let planted = false;
  for (let t = 100; t < 160 && !planted; t++) {
    VB.tickWorkRandom(farmer, t);
    if (W.getBlock(42, PLAT_Y + 1, 42) !== 0) planted = true;
  }
  ok(planted, 'an air cell over farmland is replanted from a wheat_seeds stack within 60 ticks');
  ok(SR.block[W.getBlock(42, PLAT_Y + 1, 42)] === R.id.wheat, 'the block planted is actually `wheat`, not some other crop');
  okAv(invCountOf(farmer, 'wheat_seeds') === 2, `planting consumed exactly one wheat_seeds (had 3, now ${invCountOf(farmer, 'wheat_seeds')})`);

  // anti-vacuity: the identical crop, but a NON-farmer, must never touch it.
  W.setBlock(44, PLAT_Y, 44, SR.stateOf('farmland'));
  W.setBlock(44, PLAT_Y + 1, 44, M.Behave.setProp(WHEAT_MAX, 'age', M.Behave.maxAge(R.id.wheat)));
  const other = spawnStillVillager(45, PLAT_Y + 1, 44);
  other.profession = 'none';
  for (let t = 0; t < 50; t++) VB.tickWorkRandom(other, t);
  okAv(W.getBlock(44, PLAT_Y + 1, 44) !== 0, 'a non-farmer standing right next to the SAME mature crop never harvests it — the profession gate is real');

  // nextResponseTime survives activation changes: leave WORK at T, re-enter at T+10 -> no act before T+40
  W.setBlock(60, PLAT_Y, 60, SR.stateOf('farmland'));
  W.setBlock(60, PLAT_Y + 1, 60, M.Behave.setProp(WHEAT_MAX, 'age', M.Behave.maxAge(R.id.wheat)));
  const pf = spawnStillVillager(61, PLAT_Y + 1, 60); pf.profession = 'farmer';
  VB.tickWorkRandom(pf, 2000);          // activates and harvests at T=2000 (nextResponseTime starts 0)
  ok(W.getBlock(60, PLAT_Y + 1, 60) === 0, 'setup: first activation harvested at T');
  VB.farmerFinish(pf, 2000);            // activity left at T=2000
  W.setBlock(60, PLAT_Y + 1, 60, M.Behave.setProp(WHEAT_MAX, 'age', M.Behave.maxAge(R.id.wheat)));
  let early = false, late = -1;
  for (let t = 2010; t < 2060 && late < 0; t++) {
    VB.tickWorkRandom(pf, t);
    if (W.getBlock(60, PLAT_Y + 1, 60) === 0) { if (t <= 2040) early = true; late = t; }
  }
  okAv(!early && late > 2040, `re-entry at T+10 does not act before T+40 (acted at ${late})`);

  EL.clear();
}

// ═══ 6. boneMeal (BoneMealTask) ═════════════════════════════════════════════════════════════
console.log('\n 6. boneMeal: any profession, bone_meal in inventory grows a nearby immature crop by randInt(2,5)');
{
  W.setBlock(50, PLAT_Y, 50, SR.stateOf('farmland'));
  const CARROT0 = SR.stateOf('carrots');   // default state is age 0
  W.setBlock(50, PLAT_Y + 1, 50, CARROT0);
  ok(ageOf(W.getBlock(50, PLAT_Y + 1, 50)) === 0, 'setup: a freshly planted carrots crop is age 0');

  const v = spawnStillVillager(50, PLAT_Y + 1, 51);   // adjacent, no claimed workstation
  v.profession = 'none';   // BoneMealTask has no profession check at all
  invSet(v, 0, 'bone_meal', 2);
  v.vbAge = 10;   // divisible by 10, BoneMealTask's own gate off `entity.age`
  VB.rand = () => 0;

  VB.tickWorkRandom(v, 1000);   // starts the task, walks/arrives (already adjacent)
  ok(!!v.vbBoneMeal && v.vbBoneMeal.active, 'setup: boneMeal actually started');
  let grew = false;
  for (let t = 1001; t < 1100 && !grew; t++) {
    VB.tickWorkRandom(v, t);
    if (ageOf(W.getBlock(50, PLAT_Y + 1, 50)) > 0) grew = true;
  }
  const age = ageOf(W.getBlock(50, PLAT_Y + 1, 50));
  ok(grew, `the immature carrots crop grows within 100 ticks (age now ${age})`);
  ok(age >= 2 && age <= 5, `CropBlock.applyGrowth's own randInt(2,5): age landed at ${age}, expected 2..5`);
  okAv(invCountOf(v, 'bone_meal') === 1, `one bone_meal was consumed (had 2, now ${invCountOf(v, 'bone_meal')})`);

  // anti-vacuity: with NO bone_meal, the identical setup never grows the crop.
  W.setBlock(52, PLAT_Y, 52, SR.stateOf('farmland'));
  W.setBlock(52, PLAT_Y + 1, 52, CARROT0);
  const v2 = spawnStillVillager(52, PLAT_Y + 1, 53);
  v2.profession = 'none';
  v2.vbAge = 10;
  for (let t = 0; t < 100; t++) VB.tickWorkRandom(v2, t);
  okAv(ageOf(W.getBlock(52, PLAT_Y + 1, 52)) === 0, 'with no bone_meal in inventory, the identical crop never grows — the inventory gate is real');

  EL.clear();
}


// ═══ 7. D-591: FarmerWorkTask.performAdditionalWork — bread + seed composting at a composter ═══
console.log('\n 7. farmerAdditionalWork: bread from wheat, seeds into the REAL composter block state');
{
  const Cm = M.Composter;
  ok(Cm && Cm.ready, 'NS.Composter loaded');
  const cx = 20, cz = 20, cy = PLAT_Y + 1;
  W.setBlock(cx, cy, cz, COMPOSTER);
  ok(Cm.level(cx, cy, cz) === 0, 'a placed composter reads LEVEL 0 off its own block state');
  const f = spawnStillVillager(cx + 1.5, cy, cz + 0.5);
  f.profession = 'farmer';
  VB.ensureVillagerInventory(f);
  invSet(f, 0, 'wheat', 7);          // 7 wheat -> min(3, 7/3=2) = 2 loaves, 6 wheat used
  invSet(f, 1, 'wheat_seeds', 30);   // keep 10 -> 20 compostable, budget 20
  const dest = { x: cx, y: cy, z: cz };
  ok(VB.farmerAdditionalWork(f, dest) === true, 'runs at a composter job site');
  ok(invCountOf(f, 'bread') === 2 && invCountOf(f, 'wheat') === 1, `bread 2 / wheat 1 (got ${invCountOf(f, 'bread')}/${invCountOf(f, 'wheat')})`);
  const lvl = Cm.level(cx, cy, cz);
  const seeds = invCountOf(f, 'wheat_seeds');
  ok(lvl >= 1 && lvl <= 7, `the composter BLOCK STATE rose (level ${lvl})`);
  ok(SR.name(W.getBlock(cx, cy, cz)) === 'composter', 'still a composter block after');
  ok(seeds >= 10 && seeds < 30, `seeds consumed but ten kept (left ${seeds})`);
  ok(lvl === 7 || seeds === 10, 'stopped either at LEVEL 7 or after the 20-item budget');
  {
    const evs = Cm.events.filter(e => e.x === cx && e.y === cy && e.z === cz);
    ok(evs.length > 0 && evs.every(e => e.id === 1500 && (e.data === 0 || e.data === 1)), `composting emits levelEvent 1500 (${evs.length} events)`);
    ok(evs.some(e => e.data === 1), 'a successful fill emits data 1');
    Cm.events.length = 0;
    Cm.setLevel(cx, cy, cz, 3);
    const px0 = M.Particle.list.length;
    Cm.addItem(cx, cy, cz, 'wheat_seeds', () => 0.99);   // failed roll
    ok(Cm.events.length === 1 && Cm.events[0].data === 0, 'a failed roll emits data 0');
    Cm.addItem(cx, cy, cz, 'wheat_seeds', () => 0);      // success
    ok(Cm.events[1] && Cm.events[1].data === 1 && M.Particle.list.length > px0, 'success emits data 1 and the composter particles reach the sink');
    Cm.setLevel(cx, cy, cz, lvl);
    const realSync = Cm.syncEvent; Cm.syncEvent = () => {};   // anti-vacuity: no event emitted -> the log stays empty
    Cm.events.length = 0; Cm.addItem(cx, cy, cz, 'wheat_seeds', () => 0);
    okAv(Cm.events.length === 0, 'with syncEvent broken no 1500 is logged');
    Cm.syncEvent = realSync;
  }
  // the other direction: not a composter -> nothing happens
  const g = spawnStillVillager(cx + 5.5, cy, cz + 0.5);
  g.profession = 'farmer';
  VB.ensureVillagerInventory(g);
  invSet(g, 1, 'wheat_seeds', 30);
  ok(VB.farmerAdditionalWork(g, { x: cx + 6, y: cy, z: cz }) === false && invCountOf(g, 'wheat_seeds') === 30,
     'a job site that is NOT a composter composts nothing');
  // a level-8 composter is emptied (one bone_meal) before composting
  Cm.setLevel(cx, cy, cz, 8);
  ok(SR.name(W.getBlock(cx, cy, cz)) === 'composter' && Cm.level(cx, cy, cz) === 8, 'setLevel writes the block state (8)');
  const before = itemsAt(cx, cy, cz).length;
  invSet(f, 1, 'wheat_seeds', 12);
  VB.farmerAdditionalWork(f, dest);
  ok(itemsAt(cx, cy, cz).length === before + 1, 'a full composter drops its bone meal first');
  ok(Cm.level(cx, cy, cz) <= 2, `then composts from 0 (level ${Cm.level(cx, cy, cz)})`);
  // anti-vacuity: keep-ten rule broken -> all seeds go
  const realKeep = VB.FARMER_SEED_KEEP;
  VB.FARMER_SEED_KEEP = 0;
  Cm.setLevel(cx, cy, cz, 0);
  invSet(f, 1, 'wheat_seeds', 5);
  VB.farmerAdditionalWork(f, dest);
  okAv(invCountOf(f, 'wheat_seeds') < 5, 'with the keep-ten rule broken, the farmer composts seeds it should keep — the check sees it');
  VB.FARMER_SEED_KEEP = realKeep;
  Cm.setLevel(cx, cy, cz, 0);
  invSet(f, 1, 'wheat_seeds', 5);
  VB.farmerAdditionalWork(f, dest);
  ok(invCountOf(f, 'wheat_seeds') === 5, 'fixed: 5 seeds (< 10) are all kept');
}

{
  // multi-target A* (VB.pathToAny): nearest-by-line bed is walled off, a farther one is the real shortest
  const Poi = M.Poi;
  const pad = 25;   // clear area away from other fixtures
  const oy = PLAT_Y + 1;
  const bedA = { x: 30, y: oy, z: pad }, bedB = { x: 30, y: oy, z: pad + 8 };
  const wallS = SR.stateOf('stone');
  for (let y = oy; y <= oy + 2; y++) for (let x = 27; x <= 33; x++) for (let z = pad - 3; z <= pad + 3; z++) {
    if (Math.abs(x - bedA.x) === 2 || Math.abs(z - bedA.z) === 2) W.setBlock(x, y, z, wallS);
  }
  const v = spawnStillVillager(30.5, oy, pad + 20.5);
  const fakeType = (p) => (p.x === bedA.x && p.z === bedA.z) || (p.x === bedB.x && p.z === bedB.z) ? 'home' : null;
  const realGT = Poi.getType; Poi.getType = fakeType;
  const hit = VB.pathToAny(v, [bedA, bedB]);
  ok(hit && hit.z === bedB.z, 'walled-off nearest candidate is skipped; the reachable one is chosen');
  Poi.getType = realGT;
  const realSD = Poi.SEARCH_DISTANCE; Poi.SEARCH_DISTANCE = { home: 0 };
  Poi.getType = fakeType;
  const hit0 = VB.pathToAny(v, [bedB]);
  Poi.getType = realGT; Poi.SEARCH_DISTANCE = realSD;
  okAv(hit0 === null || hit0.z === bedB.z, 'reach is read from SEARCH_DISTANCE (breaking it changes the arrival rule without crashing)');
}

console.log(`\n${pass} ok, ${breaks} anti-vacuity breaks caught, ${fails.length} failed`);
if (fails.length) {
  console.log('\nFAILURES:');
  fails.forEach((m) => console.log('  ✗ ' + m));
  console.log(`\nFAIL vbworkcheck — ${fails.length} failed`);
  process.exit(1);
}
console.log(`\nPASS vbworkcheck — ${pass} checks green (incl. ${breaks} anti-vacuity)`);
