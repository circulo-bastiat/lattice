#!/usr/bin/env node
// vbgathercheck.mjs — loop/vbgather, QUEUE row 0.2 (VB.OWED residue), TWO sub-units:
//   (a) `VillagerEntity.loot`/`canGather`/`GATHERABLE_ITEMS` (src/07zv6_vbgather.js's own
//       `Gt.lootTick`): a villager picking a dropped gatherable item off the ground into its
//       own 8-slot inventory, gated on `canPickUpLoot`/`mobGriefing` (always true for a
//       villager, java:191/524), only what fits taken, the profession-specific gatherable set
//       (FARMER only) added on top of the shared GATHERABLE_ITEMS seven, called EVERY tick in
//       EVERY activity (not just 'idle' -- it is `MobEntity.tickMovement`'s own dispatcher in
//       vanilla, not a Brain task).
//   (b) `GatherItemsVillagerTask` itself (`Gt.tick`): the food-sharing gate
//       (`wantsToStartBreeding`/`canBreed`, reusing `VB.villagerFoodValue`/`VB.BREED_FOOD_MIN`),
//       the farmer wheat-surplus share, the profession-gatherable-items share, and
//       `giveHalfOfStack`'s own exact halve-or-24 arithmetic -- only while 'idle', only within
//       the real `squaredDistanceTo(partner) > 5.0` gate.
// Every number here is cited in src/07zv6_vbgather.js, read off `.decomp` this session:
// VillagerEntity.java:98-108/802-832, VillagerProfession.java:16-77,
// GatherItemsVillagerTask.java (whole file), LookTargetUtil.java:81-89.
//
//   node tools/vbgathercheck.mjs [--verbose]
//
// Sections:
//   1. static data — GATHERABLE_ITEMS (7) and PROFESSION_GATHERABLE (farmer only, 4 items)
//   2. Gt.lootTick — a gatherable item within the touch box is picked up, only what fits is
//      taken, a non-gatherable item is left alone, a farmer-only item is left for a non-farmer
//      but taken by a farmer, the mobGriefing gamerule gates it, and it runs from VB.tick in
//      EVERY activity (not only 'idle')
//   3. Gt.tick food-sharing — a well-fed villager gives half a big bread stack to a hungry
//      neighbour within range; too far apart, nothing happens
//   4. Gt.tick farmer wheat-surplus share — a non-farmer with >32 wheat gives some to a nearby
//      farmer
//   5. Gt.tick profession-gatherable-items share — a non-farmer holding wheat_seeds gives some
//      to a nearby farmer (profession-diff set), but a farmer holding wheat_seeds does NOT
//      (diff is empty farmer-to-farmer)
//   6. anti-vacuity — breaking this unit's own data/logic and watching the break get caught

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

console.log('vbgathercheck — loop/vbgather: GatherItemsVillagerTask + villager item pickup (NS.VBGather)');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
  '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
  '07i_entitylist.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js',
  '14l_use.js', '07za_explosion.js', '07m_breed.js', '07q_effects.js', '07zu_poi.js', '07o_profession.js',
  '07k_goals.js', '07zv_villagerbrain.js', '07zv2_vbplay.js', '07zv4_vbidle.js', '07zv5_vbbreed.js',
  '07zv6_vbgather.js', '07zx_particle.js', '07zt_wtrader.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Entities.attrs = M.DATA.entities.attrs;
M.Effects.ready = true;
M.Breed.init();

const W = M.World, CH = M.CH, R = M.Reg, SR = M.States;
const Poi = M.Poi, Ai = M.Ai, VB = M.VB, EL = M.EntityList, Prof = M.Profession;
const Gt = M.VBGather, IT = M.Items;

ok(VB, 'NS.VB did not load');
ok(Gt && typeof Gt.tick === 'function' && typeof Gt.lootTick === 'function', 'NS.VBGather did not load (src/07zv6_vbgather.js)');
if (!VB || !Gt) { console.log('\nFAIL vbgathercheck — module missing'); process.exit(1); }

W.init(1);
M.Behave.init(W);
if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init();
EL.init();
Ai.init();
Prof.init();
ok(Ai.ready, 'Ai module reports ready');

for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
const STONE = SR.stateOf('stone');
const PLAT_Y = 63;
function plate(radius, y) { for (let x = -radius; x <= radius; x++) for (let z = -radius; z <= radius; z++) W.setBlock(x, y, z, STONE); }
plate(30, PLAT_Y);

function spawnVillager(x, y, z, profession) {
  const v = EL.spawn('villager', x, y, z);
  v.ai = new Ai.GoalSelector();
  v.profession = profession || 'none';
  return v;
}
function giveItem(e, name, count) {
  const inv = VB.ensureVillagerInventory(e);
  const idx = IT.of(name);
  for (let i = 0; i < inv.length; i++) if (!inv[i]) { inv[i] = { i: idx, n: count }; return; }
}
function invCountOf(e, name) {
  const inv = e.villagerInventory || [];
  const idx = IT.of(name);
  let n = 0;
  for (const st of inv) if (st && st.i === idx) n += st.n;
  return n;
}
function dropItem(x, y, z, name, count) {
  const e = EL.spawn('item', x, y, z, { item: IT.of(name), count });
  e.pickupDelay = 0;   // EL.spawn's own default (10, 07i_entitylist.js:540) would otherwise
  return e;             // refuse Gt.lootTick's own `(o.pickupDelay | 0) > 0` gate for several
                         // ticks — this check calls Gt.lootTick directly, without a real tick
                         // loop to count it down (entlistcheck.mjs's own convention, same gate).
}
function itemEntitiesOf(name) {
  const idx = IT.of(name);
  // EL.dropStack (the SAME call Gt's own giveItemTo/farmerAdditionalWork use) stores e.item as
  // the NAME STRING it was passed, not the numeric index a direct EL.spawn('item',...,{item:
  // idx}) uses (07i_entitylist.js's own two call shapes) -- match either.
  return EL.list.filter((o) => o.type === 'item' && !o.removed && (o.item === idx || o.item === name));
}
function totalOf(name) { return itemEntitiesOf(name).reduce((n, o) => n + (o.count | 0), 0); }

// ═══ 1. static data ══════════════════════════════════════════════════════════════════════════
console.log('\n 1. GATHERABLE_ITEMS (the shared seven) + PROFESSION_GATHERABLE (farmer only)');
{
  const shared = Gt.GATHERABLE_ITEMS.slice().sort();
  const expectShared = ['bread', 'potato', 'carrot', 'wheat', 'wheat_seeds', 'beetroot', 'beetroot_seeds'].sort();
  ok(JSON.stringify(shared) === JSON.stringify(expectShared), `GATHERABLE_ITEMS is the real seven (VillagerEntity.java:102-104), got [${shared.join(',')}]`);
  ok(Object.keys(Gt.PROFESSION_GATHERABLE).length === 1 && Gt.PROFESSION_GATHERABLE.farmer,
    'only FARMER has a non-empty gatherableItems set (VillagerProfession.java:16-35, every other profession defaults to ImmutableSet.of())');
  const farmerSet = (Gt.PROFESSION_GATHERABLE.farmer || []).slice().sort();
  ok(JSON.stringify(farmerSet) === JSON.stringify(['bone_meal', 'wheat', 'wheat_seeds', 'beetroot_seeds'].sort()),
    `farmer's own gatherableItems is wheat/wheat_seeds/beetroot_seeds/bone_meal, got [${farmerSet.join(',')}]`);
}

// ═══ 2. Gt.lootTick — real item pickup ══════════════════════════════════════════════════════
console.log('\n 2. Gt.lootTick: a gatherable item in the touch box is picked up, only what fits, non-gatherable left alone, farmer-only items respect the profession gate');
{
  const v = spawnVillager(0, PLAT_Y + 1, 0, 'none');
  const bread = dropItem(0.3, PLAT_Y + 1, 0, 'bread', 5);
  Gt.lootTick(v);
  ok(invCountOf(v, 'bread') === 5, `bread (a shared GATHERABLE_ITEMS entry) is picked up into the 8-slot inventory, got ${invCountOf(v, 'bread')}`);
  ok(bread.removed === true, 'the item entity itself is removed once its stack empties');

  // only what fits: fill every slot with a near-max bread stack, leave exactly 10 room in one
  const v2 = spawnVillager(5, PLAT_Y + 1, 5, 'none');
  const inv2 = VB.ensureVillagerInventory(v2);
  const breadIdx = IT.of('bread');
  for (let i = 0; i < inv2.length; i++) inv2[i] = { i: breadIdx, n: 64 };
  inv2[7] = { i: breadIdx, n: 54 };   // 10 slots of room left in slot 7
  const big = dropItem(5.3, PLAT_Y + 1, 5, 'bread', 50);
  Gt.lootTick(v2);
  ok(invCountOf(v2, 'bread') === 7 * 64 + 64, `only the 10 that fit were taken (7*64 + 64 = ${7 * 64 + 64}), got ${invCountOf(v2, 'bread')}`);
  ok(!big.removed && big.count === 40, `the un-fitting remainder (50-10=40) stays on the ground, not vanished — got removed=${big.removed} count=${big.count}`);

  // a non-gatherable item is left entirely alone
  const v3 = spawnVillager(10, PLAT_Y + 1, 10, 'none');
  const diamond = dropItem(10.3, PLAT_Y + 1, 10, 'diamond', 3);
  Gt.lootTick(v3);
  ok(!diamond.removed && diamond.count === 3, 'a non-gatherable item (diamond) is never touched');
  ok(invCountOf(v3, 'diamond') === 0, 'and never lands in the inventory either');

  // farmer-only item: bone_meal is in farmer's own gatherableItems (VillagerProfession.java:
  // 21-27) but NOT in the shared GATHERABLE_ITEMS seven -- a 'none' villager leaves it, a
  // 'farmer' takes it (canGather's own profession.getGatherableItems() half, java:826).
  const none = spawnVillager(20, PLAT_Y + 1, 20, 'none');
  const bmForNone = dropItem(20.3, PLAT_Y + 1, 20, 'bone_meal', 4);
  Gt.lootTick(none);
  ok(!bmForNone.removed && bmForNone.count === 4, 'bone_meal is NOT in the shared GATHERABLE_ITEMS set — a non-farmer leaves it alone');

  const farmer = spawnVillager(25, PLAT_Y + 1, 25, 'farmer');
  const bmForFarmer = dropItem(25.3, PLAT_Y + 1, 25, 'bone_meal', 4);
  Gt.lootTick(farmer);
  ok(invCountOf(farmer, 'bone_meal') === 4, `a FARMER's own profession.getGatherableItems() picks up bone_meal too, got ${invCountOf(farmer, 'bone_meal')}`);

  // the mobGriefing gamerule gates the whole dispatcher (MobEntity.java:519)
  const savedRules = M.DATA.gameRules;
  M.DATA.gameRules = { mobGriefing: { d: 'false' } };
  const v4 = spawnVillager(30, PLAT_Y + 1, 30, 'none');
  const breadOff = dropItem(30.3, PLAT_Y + 1, 30, 'bread', 2);
  Gt.lootTick(v4);
  okAv(!breadOff.removed && invCountOf(v4, 'bread') === 0, 'mobGriefing=false refuses the pickup entirely (MobEntity.java:519\'s own DO_MOB_GRIEFING gate)');
  M.DATA.gameRules = savedRules;

  // wired from VB.tick in EVERY activity, not only 'idle' (it is tickMovement's own dispatcher
  // in vanilla, not a Brain task) — drive VB.tick during 'work' and confirm pickup still fires
  const v5 = spawnVillager(40, PLAT_Y + 1, 40, 'none');
  M.Sky = { dayTime: 3000 };   // VILLAGER_DEFAULT's own 'work' window
  const breadWork = dropItem(40.3, PLAT_Y + 1, 40, 'bread', 1);
  VB.tick(v5);
  ok(v5.vbActivity === 'work', 'setup: this villager really is ticking through \'work\', not \'idle\'');
  okAv(invCountOf(v5, 'bread') === 1, 'Gt.lootTick still runs during \'work\' (VB.tick calls it OUTSIDE the idle branch), got ' + invCountOf(v5, 'bread'));
  EL.clear();
}

// ═══ 3. Gt.tick — food-sharing (wantsToStartBreeding / canBreed) ═══════════════════════════
console.log('\n 3. Gt.tick: a well-fed villager gives half a big bread stack to a hungry neighbour within range; too far apart, nothing happens');
{
  const giver = spawnVillager(0, PLAT_Y + 1, 0, 'none');
  const hungry = spawnVillager(1, PLAT_Y + 1, 0, 'none');   // distSq == 1, inside MAX_RANGE_SQ (5.0)
  giveItem(giver, 'bread', 40);   // 40 > 32 (maxStack/2) -> give = floor(40/2) = 20
  ok(VB.villagerFoodValue(giver) >= Gt.WANTS_BREED_FOOD, 'setup: 40 bread (160 food value) clears wantsToStartBreeding\'s own >=24');
  ok(VB.villagerFoodValue(hungry) < VB.BREED_FOOD_MIN, 'setup: an empty-handed neighbour is under canBreed\'s own <12');
  Gt.tick(giver, 0, 1);
  ok(invCountOf(giver, 'bread') === 20, `giveHalfOfStack halved the 40-bread stack (40 > 32 -> floor(40/2)=20), got ${invCountOf(giver, 'bread')}`);
  const thrown = itemEntitiesOf('bread').filter((o) => o !== undefined);
  ok(thrown.length === 1 && thrown[0].count === 20, `the other 20 bread was thrown as a real ItemEntity (LookTargetUtil.give), got ${thrown.length ? thrown[0].count : 'none'}`);
  const vx = thrown[0] ? thrown[0].vx : 0, vz = thrown[0] ? thrown[0].vz : 0;
  ok(vx > 0, 'the toss velocity points toward the neighbour (positive x, the neighbour is at x=1)');

  // too far apart — same setup, but past MAX_RANGE_SQ
  const giver2 = spawnVillager(10, PLAT_Y + 1, 10, 'none');
  const hungry2 = spawnVillager(20, PLAT_Y + 1, 10, 'none');
  giveItem(giver2, 'bread', 40);
  Gt.tick(giver2, 0, 1);
  okAv(invCountOf(giver2, 'bread') === 40, 'a neighbour outside the real squaredDistanceTo <= 5.0 gate gets nothing — no partner found at all');
  EL.clear();
}

// ═══ 4. Gt.tick — farmer wheat-surplus share ═══════════════════════════════════════════════
console.log('\n 4. Gt.tick: a non-farmer with >32 wheat gives some to a nearby farmer (and, same tick, the profession-diff branch below takes ANOTHER real bite)');
{
  const giver = spawnVillager(0, PLAT_Y + 1, 0, 'none');
  const farmer = spawnVillager(1, PLAT_Y + 1, 0, 'farmer');
  giveItem(giver, 'wheat', 50);   // 50 > 32 -> branch 2 gives floor(50/2)=25, leaving 25
  Gt.tick(giver, 0, 1);
  // ⚠ WHEAT IS ALSO IN FARMER'S OWN GATHERABLE SET, so the SAME tick's own section-5 branch
  // (getGatherableItems(self, partner), java:63-68) sees 25 wheat still `containsAny` its own
  // diff set and takes ANOTHER bite in the SAME call: 25 is not > 32 but IS > 24, so
  // giveHalfOfStack's own second half-rule fires too (25-24=1) -- real vanilla runs both `if`s
  // unconditionally in the same per-tick body (method_19018, no early return between them), so
  // this cascade is not a bug, it is the faithful port of what the jar actually does.
  ok(invCountOf(giver, 'wheat') === 24, `50 wheat -> 25 (branch 2) -> 24 (branch 3's own cascade), got ${invCountOf(giver, 'wheat')}`);
  ok(totalOf('wheat') === 26, `26 wheat total was thrown away across the two separate ItemEntity gifts (25+1), got ${totalOf('wheat')}`);
  ok(itemEntitiesOf('wheat').length === 2, `TWO separate ItemEntity gifts, not one merged stack (no EL.tick() ran to merge them), got ${itemEntitiesOf('wheat').length}`);

  // a non-farmer partner never gets the wheat share (partner.profession == FARMER only) --
  // and with a non-farmer partner, branch 3's own diff is empty too (professionGatherable of
  // a non-farmer partner is []), so NOTHING happens at all, cascade included.
  const giver2 = spawnVillager(10, PLAT_Y + 1, 10, 'none');
  const other = spawnVillager(11, PLAT_Y + 1, 10, 'none');
  giveItem(giver2, 'wheat', 50);
  Gt.tick(giver2, 0, 1);
  okAv(invCountOf(giver2, 'wheat') === 50, 'a non-farmer neighbour never triggers the wheat-surplus share (or the profession-diff share)');
  EL.clear();
}

// ═══ 5. Gt.tick — profession-gatherable-items share ════════════════════════════════════════
console.log('\n 5. Gt.tick: a non-farmer holding wheat_seeds gives some to a nearby farmer; farmer-to-farmer shares nothing (empty diff)');
{
  const giver = spawnVillager(0, PLAT_Y + 1, 0, 'none');
  const farmer = spawnVillager(1, PLAT_Y + 1, 0, 'farmer');
  giveItem(giver, 'wheat_seeds', 30);   // 30 > 24, not > 32 -> give = 30-24 = 6
  Gt.tick(giver, 0, 1);
  ok(invCountOf(giver, 'wheat_seeds') === 24, `30 wheat_seeds down to 24 (30-24=6 given, the "> 24" half-branch), got ${invCountOf(giver, 'wheat_seeds')}`);
  ok(itemEntitiesOf('wheat_seeds').length === 1 && itemEntitiesOf('wheat_seeds')[0].count === 6, 'the other 6 wheat_seeds was thrown as a real ItemEntity');

  // farmer -> farmer: getGatherableItems(self, partner) is partner's set MINUS self's own —
  // both FARMER, so the diff is empty and nothing is ever offered
  const farmerA = spawnVillager(10, PLAT_Y + 1, 10, 'farmer');
  const farmerB = spawnVillager(11, PLAT_Y + 1, 10, 'farmer');
  giveItem(farmerA, 'wheat_seeds', 30);
  Gt.tick(farmerA, 0, 1);
  okAv(invCountOf(farmerA, 'wheat_seeds') === 30, 'farmer-to-farmer shares nothing (getGatherableItems diff is empty, GatherItemsVillagerTask.java:63-68)');
  EL.clear();
}

// ═══ 5b. Gt.tick — talkWithVillager (java:47): gossip + the summonGolem(...,5) it carries ════
console.log('\n 5b. Gt.tick talks with the partner (talkWithVillager, java:47) — gossip moves, a far villager is never heard, and five eligible villagers summon a golem');
{
  const Vg = M.Village;
  ok(Vg && typeof Vg.talkWithVillager === 'function', 'NS.Village.talkWithVillager loaded (07l_spawn.js)');
  const p = spawnVillager(0, PLAT_Y + 1, 0, 'none'), q = spawnVillager(2, PLAT_Y + 1, 0, 'none');
  const far = spawnVillager(3, PLAT_Y + 1, 0, 'none');
  q.gossip = { major_negative: 40 }; far.gossip = { minor_negative: 100 };
  Gt.tick(p, 200000, 1);
  ok(p.gossip && p.gossip.major_negative === 30, `p talks with q (dist^2 4 <= 5) and hears 40-10=30, got ${JSON.stringify(p.gossip)}`);
  okAv(!p.gossip || !p.gossip.minor_negative, 'and never with the villager at dist^2 9 (> 5)');
  const sq = Gt.MAX_RANGE_SQ;
  Gt.MAX_RANGE_SQ = 0.5; p.gossip = null; p.gossipStartTime = undefined; q.gossipStartTime = undefined;
  Gt.tick(p, 200000, 2);
  okAv(!p.gossip, 'with the task range shrunk below the pair\'s spacing no gossip moves — the talk goes through the task\'s own distance gate');
  Gt.MAX_RANGE_SQ = sq;
  const tw = Vg.talkWithVillager; Vg.talkWithVillager = () => false; p.gossipStartTime = undefined; q.gossipStartTime = undefined;
  Gt.tick(p, 200000, 3);
  okAv(!p.gossip, 'with talkWithVillager stubbed out no gossip moves — Gt.tick is the one caller');
  Vg.talkWithVillager = tw;
  EL.clear();

  const vs = [];
  for (let i = 0; i < 5; i++) { const v = spawnVillager(i, PLAT_Y + 1, 5, 'none'); v.vbLastSlept = 300000; vs.push(v); }
  Gt.tick(vs[0], 300000, 1);
  ok(EL.list.filter((o) => o.type === 'iron_golem').length === 1, 'five villagers that slept recently: one Gt.tick conversation summons exactly one iron golem');
  EL.clear();
}

// ═══ 6. anti-vacuity — a stubbed-out Gt.tick / an emptied GATHERABLE_ITEMS is itself caught ═
console.log('\n 6. anti-vacuity: a stubbed-out Gt.tick, and an emptied GATHERABLE_ITEMS, are themselves detectable');
{
  const giver = spawnVillager(0, PLAT_Y + 1, 0, 'none');
  const hungry = spawnVillager(1, PLAT_Y + 1, 0, 'none');
  giveItem(giver, 'bread', 40);
  const savedTick = Gt.tick;
  Gt.tick = function () {};   // a mutant that does nothing
  const before = invCountOf(giver, 'bread');
  Gt.tick(giver, 0, 1);
  okAv(invCountOf(giver, 'bread') === before, 'a stubbed-out Gt.tick leaves the bread stack untouched — the real one does not, section 3 above already proved it');
  Gt.tick = savedTick;

  const savedItems = Gt.GATHERABLE_ITEMS;
  Gt.GATHERABLE_ITEMS = [];
  const v = spawnVillager(20, PLAT_Y + 1, 20, 'none');
  const bread = dropItem(20.3, PLAT_Y + 1, 20, 'bread', 5);
  Gt.lootTick(v);
  okAv(!bread.removed && invCountOf(v, 'bread') === 0, 'an emptied GATHERABLE_ITEMS refuses the SAME pickup section 2 above proved works');
  Gt.GATHERABLE_ITEMS = savedItems;
  EL.clear();
}

console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(`\n${pass} ok, ${breaks} anti-vacuity breaks caught, ${fails.length} failed`);
if (fails.length) {
  console.log('\nFAILURES:');
  for (const f of fails) console.log('  - ' + f);
  console.log('\nFAIL vbgathercheck');
  process.exit(1);
} else {
  console.log(`\nPASS vbgathercheck — ${pass} checks green (incl. ${breaks} anti-vacuity)`);
}
